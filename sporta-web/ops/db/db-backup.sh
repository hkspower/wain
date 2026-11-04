#!/bin/sh
# db-backup.sh - nightly, encrypted, verified logical backup of the Sporta database.
#
#   db-backup.sh run                 take a backup (the default action)
#   db-backup.sh verify [FILE]       prove a backup is intact and decryptable (newest when no FILE)
#   db-backup.sh prune [--dry-run]   apply the retention rule (14 daily + 8 weekly + 6 monthly)
#   db-backup.sh status              one line: how old is the newest backup, is the last run ok
#   db-backup.sh selftest            check tools, key, directory, database login; writes nothing
#   db-backup.sh alert-test          raise a harmless test row in the shop's Activity log
#
# STATUS: built and proven on a private MariaDB (npm run test:db-backup). NOT installed on the
# live server. Installation is a one-shot job, see ops/db/BACKUP.md. Nothing here runs by itself.
#
# WHERE IT RUNS, AND WHY (decision, not habit)
#   On the HOST, from /etc/cron.d, like the four jobs that already exist
#   (`docker exec ... php cron-*.php`). Reasons:
#     * The database container is the official mariadb image. The only thing needed from it is
#       `mariadb-dump`, which it always has. Compression, encryption, hashing, locking, retention
#       and alerting run on the host, where openssl, gzip, flock and sha256sum are part of the
#       Ubuntu base. Nothing is installed into the database container (it is not rebuilt for this).
#     * The key and the backups live on the host, in directories no container mounts. A job inside
#       the database container would have the key in the same place as the data it protects.
#     * Host cron already exists and is already how this shop schedules work. No new daemon.
#   The database login is passed to the client on STDIN (`--defaults-extra-file=/dev/stdin`), so no
#   password ever appears in a process list, an environment or a log.
#
# WHAT IT WRITES
#   $BACKUP_DIR/sporta-db-YYYYMMDDTHHMMSSZ.sql.gz.enc    gzip, then AES-256-CBC (openssl enc,
#                                                        PBKDF2-SHA256, 600000 rounds, random salt)
#   $BACKUP_DIR/sporta-db-YYYYMMDDTHHMMSSZ.sql.gz.enc.sha256   `sha256sum -c` compatible
#   $BACKUP_DIR/backup.log        one line per run, counts and names only, NO personal data
#   $BACKUP_DIR/last-status       ok|fail, epoch, exit code, reason
#   $BACKUP_DIR/last-success      epoch and file name of the newest verified backup
#   Directory 0700, files 0600, root only, OUTSIDE the web root and mounted into no container.
#   The key is a separate file in a different directory, 0400 (see KEY below).
#
# THE KEY
#   $KEY_FILE, a random passphrase (>= 32 characters), mode 0400 or 0600, owned by the user that
#   runs this script. It is used with `openssl enc -pass file:`, so it never reaches a command line.
#   Wrong mode, wrong owner, a symlink, empty or short: the run STOPS (exit 3) and writes nothing.
#   A key that other users could read is treated as compromised, not silently used.
#   Lose the key and every backup is unreadable: keep a copy OFF this server (BACKUP.md section 5).
#
# INTEGRITY
#   Every backup is checked after it is written, before it is renamed into place: the sha256
#   sidecar, then a full decrypt + gunzip, and the `-- Dump completed` trailer that mariadb-dump
#   writes only when it reached the end. gzip carries a CRC32 of the whole plaintext, so a flipped
#   bit anywhere in the ciphertext (CBC garbles the block it lands in) fails the CRC.
#   CBC is not authenticated encryption: an attacker who can WRITE to the backup directory could
#   corrupt a backup (detected) but not forge one without the key. They would be root already.
#
# EXIT CODES   0 ok | 2 usage | 3 configuration, key, tool or permission (fail closed) | 4 another
#   run is in progress | 5 disk space | 6 dump failed | 7 verification failed | 8 prune failed |
#   9 off-site copy failed (the local backup IS good) | 1 anything else
#
# ENVIRONMENT (all optional; the defaults are the live layout)
#   SPORTA_BACKUP_DIR, SPORTA_BACKUP_SECRETS_DIR, SPORTA_BACKUP_KEY_FILE, SPORTA_BACKUP_DUMP_CNF,
#   SPORTA_DOCKER, SPORTA_DB_CONTAINER, SPORTA_WEB_CONTAINER, SPORTA_DB_NAME,
#   SPORTA_BACKUP_KEEP_DAILY/WEEKLY/MONTHLY, SPORTA_BACKUP_MIN_FREE_MB, SPORTA_DUMP_OPTS,
#   SPORTA_DUMP_BINLOG_POS=1 (adds --master-data=2 for point-in-time restore; needs RELOAD and
#   BINLOG MONITOR on the backup account), SPORTA_ALERT_CMD (replaces the Activity-log alert),
#   SPORTA_ALERT=none, SPORTA_ALERT_ON_OK=1 (a daily heartbeat row), SPORTA_OFFSITE_CMD.

set -u
umask 077
LC_ALL=C; export LC_ALL
PATH="${PATH:-/usr/bin:/bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin"

BACKUP_DIR=${SPORTA_BACKUP_DIR:-/docker/sporta/private/backups}
SECRETS_DIR=${SPORTA_BACKUP_SECRETS_DIR:-/docker/sporta/private/backup-secrets}
KEY_FILE=${SPORTA_BACKUP_KEY_FILE:-$SECRETS_DIR/db-backup.key}
DUMP_CNF=${SPORTA_BACKUP_DUMP_CNF:-$SECRETS_DIR/dump.cnf}
DOCKER=${SPORTA_DOCKER:-docker}
DB_CONTAINER=${SPORTA_DB_CONTAINER:-sporta-db-mariadb-1}
WEB_CONTAINER=${SPORTA_WEB_CONTAINER:-apache-sporta-1}
DB_NAME=${SPORTA_DB_NAME:-sporta}
KEEP_DAILY=${SPORTA_BACKUP_KEEP_DAILY:-14}
KEEP_WEEKLY=${SPORTA_BACKUP_KEEP_WEEKLY:-8}
KEEP_MONTHLY=${SPORTA_BACKUP_KEEP_MONTHLY:-6}
MIN_FREE_MB=${SPORTA_BACKUP_MIN_FREE_MB:-1024}
STALE_HOURS=${SPORTA_BACKUP_STALE_HOURS:-36}
ITER=600000
DUMP_OPTS_DEFAULT="--single-transaction --quick --routines --events --triggers --hex-blob --default-character-set=utf8mb4 --skip-add-locks --max-allowed-packet=128M"
DUMP_OPTS=${SPORTA_DUMP_OPTS:-$DUMP_OPTS_DEFAULT}
[ "${SPORTA_DUMP_BINLOG_POS:-0}" = 1 ] && DUMP_OPTS="$DUMP_OPTS --master-data=2"

NAME_PREFIX=sporta-db-
NAME_SUFFIX=.sql.gz.enc
LOG_FILE=$BACKUP_DIR/backup.log
STATUS_FILE=$BACKUP_DIR/last-status
SUCCESS_FILE=$BACKUP_DIR/last-success
LOCK_FILE=$BACKUP_DIR/.lock

TMPD=
LOCK_DIR_FALLBACK=
SECS_START=$(date +%s)

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# One line to the log and to stdout (cron appends stdout to /var/log/sporta-cron.log).
# Only names, counts and codes are ever passed here. Never a row, never an error text from SQL.
log() {
  line="$(now_iso) ${SPORTA_LOG_TAG:-db-backup} $*"
  printf '%s\n' "$line"
  if [ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ]; then
    printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null
    # keep the log small: the last 2000 lines
    if [ "$(wc -l <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 2400 ]; then
      tail -n 2000 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
  fi
}

cleanup() {
  [ -n "$TMPD" ] && [ -d "$TMPD" ] && rm -rf -- "$TMPD"
  [ -n "$LOCK_DIR_FALLBACK" ] && rmdir "$LOCK_DIR_FALLBACK" 2>/dev/null
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

# ---------------------------------------------------------------- alerting
# The shop's own alarm is the Activity screen in /backends: a row written by store_system_event()
# (the same call cron-fulfilment uses for a warehouse mail that did not go). It is raised through
# the web container's PHP so it uses the shop's own database login and needs no new account.
# SPORTA_ALERT_CMD replaces it (receives $SPORTA_ALERT_KEY); SPORTA_ALERT=none turns it off.
# An alert that cannot be raised is logged and never changes the exit code of the run.
alert() {
  key=$1
  case $key in *[!a-z0-9_]*|'') return 0 ;; esac
  [ "${SPORTA_ALERT:-activity}" = none ] && return 0
  if [ -n "${SPORTA_ALERT_CMD:-}" ]; then
    SPORTA_ALERT_KEY=$key sh -c "$SPORTA_ALERT_CMD" >/dev/null 2>&1; arc=$?
  else
    if command -v timeout >/dev/null 2>&1; then T="timeout 60"; else T=""; fi
    # shellcheck disable=SC2086
    $T "$DOCKER" exec -u www-data "$WEB_CONTAINER" php -r \
      'require "/var/www/html/api/store.php"; store_system_event(store_db(), $argv[1]);' -- "$key" >/dev/null 2>&1; arc=$?
  fi
  if [ "$arc" -eq 0 ]; then log "alert=$key sent=yes"; else log "alert=$key sent=no rc=$arc"; fi
  command -v logger >/dev/null 2>&1 && logger -t sporta-db-backup -p cron.err "$key" 2>/dev/null
  return 0
}

record_status() {
  # record_status ok|fail CODE REASON
  printf '%s %s %s %s\n' "$1" "$(date +%s)" "$2" "$3" >"$STATUS_FILE.tmp" 2>/dev/null && mv "$STATUS_FILE.tmp" "$STATUS_FILE" 2>/dev/null
  return 0
}

# fail CODE REASON ALERTKEY - the one way a run ends badly.
fail() {
  code=$1; reason=$2; akey=${3:-db_backup_failed}
  log "run=fail code=$code reason=$reason"
  [ -d "$BACKUP_DIR" ] && record_status fail "$code" "$reason"
  [ -n "$akey" ] && alert "$akey"
  exit "$code"
}

# ---------------------------------------------------------------- checks
need_tool() {
  command -v "$1" >/dev/null 2>&1 || fail 3 "tool_missing_$1"
}

file_mode_owner() { stat -c '%a %u' "$1" 2>/dev/null; }

check_tools() {
  for t in openssl gzip sha256sum stat date df awk sed tail wc sort mv rm cat tr cut head grep mktemp id dirname; do need_tool "$t"; done
  command -v "$DOCKER" >/dev/null 2>&1 || fail 3 "tool_missing_docker"
  date -u -d 2026-01-05 +%G-W%V >/dev/null 2>&1 || fail 3 "date_not_gnu"
  stat -c %a / >/dev/null 2>&1 || fail 3 "stat_not_gnu"
}

# Key: fail closed. Exists, a regular file (not a link), mode 400/600, ours, long enough.
check_key() {
  [ -e "$KEY_FILE" ] || fail 3 key_missing
  [ -L "$KEY_FILE" ] && fail 3 key_is_symlink
  [ -f "$KEY_FILE" ] || fail 3 key_not_regular
  mo=$(file_mode_owner "$KEY_FILE") || fail 3 key_unreadable
  mode=${mo% *}; owner=${mo#* }
  case $mode in 400|600) ;; *) fail 3 key_mode_not_400 ;; esac
  [ "$owner" = "$(id -u)" ] || fail 3 key_owner_not_us
  [ -r "$KEY_FILE" ] || fail 3 key_unreadable
  klen=$(tr -d '\n\r' <"$KEY_FILE" | wc -c)
  [ "$klen" -ge 32 ] || fail 3 key_too_short
  # the key directory must not be open to others either
  kd=$(dirname "$KEY_FILE"); dm=$(file_mode_owner "$kd") || fail 3 key_dir_unreadable
  case ${dm% *} in 700|500) ;; *) fail 3 key_dir_not_700 ;; esac
}

check_cnf() {
  [ -f "$DUMP_CNF" ] && [ ! -L "$DUMP_CNF" ] || fail 3 dump_cnf_missing
  mo=$(file_mode_owner "$DUMP_CNF") || fail 3 dump_cnf_unreadable
  case ${mo% *} in 400|600) ;; *) fail 3 dump_cnf_mode_not_400 ;; esac
  [ "${mo#* }" = "$(id -u)" ] || fail 3 dump_cnf_owner_not_us
}

# Backup directory: ours, 0700. Created if missing, tightened if looser (and said so), refused if
# it cannot be made private.
ensure_dir() {
  if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p -- "$BACKUP_DIR" 2>/dev/null || fail 3 backup_dir_cannot_create
    chmod 700 "$BACKUP_DIR" 2>/dev/null
  fi
  [ -L "$BACKUP_DIR" ] && fail 3 backup_dir_is_symlink
  mo=$(file_mode_owner "$BACKUP_DIR") || fail 3 backup_dir_unreadable
  if [ "${mo% *}" != 700 ]; then
    chmod 700 "$BACKUP_DIR" 2>/dev/null
    mo=$(file_mode_owner "$BACKUP_DIR")
    [ "${mo% *}" = 700 ] || fail 3 backup_dir_not_700
    log "note=backup_dir_tightened_to_700"
  fi
  [ "${mo#* }" = "$(id -u)" ] || fail 3 backup_dir_owner_not_us
  [ -w "$BACKUP_DIR" ] || fail 3 backup_dir_not_writable
}

take_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE" || fail 3 lock_cannot_open
    flock -n 9 || { log "run=skipped reason=another_run_in_progress"; exit 4; }
  else
    LOCK_DIR_FALLBACK=$BACKUP_DIR/.lock.d
    mkdir "$LOCK_DIR_FALLBACK" 2>/dev/null || { LOCK_DIR_FALLBACK=; log "run=skipped reason=another_run_in_progress"; exit 4; }
  fi
}

# ---------------------------------------------------------------- names
# The exact pattern of a file this script wrote: fixed prefix, a REAL UTC date and time, fixed suffix.
# Month 13, day 32, hour 25 or 7 digits do not match. Retention touches nothing else.
NAME_RE='^sporta-db-[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3])[0-5][0-9]([0-5][0-9]|60)Z\.sql\.gz\.enc$'
is_backup_name() {
  printf '%s\n' "$1" | grep -Eq "$NAME_RE" || return 1
  _nd=${1#"$NAME_PREFIX"}; _nd=${_nd%%T*}
  [ "$(date -u -d "$(printf %s "$_nd" | sed 's/^\(....\)\(..\)\(..\)$/\1-\2-\3/')" +%Y%m%d 2>/dev/null)" = "$_nd" ]   # 31 February is not a date
}
is_sidecar_name() {
  case $1 in *.sha256) is_backup_name "${1%.sha256}" ;; *) return 1 ;; esac
}

# Newest sealed backup (name only), or nothing.
newest_backup() {
  for f in "$BACKUP_DIR"/${NAME_PREFIX}*${NAME_SUFFIX}; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    n=${f##*/}; is_backup_name "$n" && printf '%s\n' "$n"
  done | sort | tail -n 1
}

# ---------------------------------------------------------------- crypto
enc_to() {  # stdin -> encrypted file $1
  openssl enc -aes-256-cbc -md sha256 -pbkdf2 -iter "$ITER" -salt -pass "file:$KEY_FILE" -out "$1"
}
dec_from() {  # encrypted file $1 -> stdout
  openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter "$ITER" -pass "file:$KEY_FILE" -in "$1"
}

# verify_file PATH [SIDECAR]: 0 only if the sidecar matches, the file decrypts, gunzips cleanly and
# ends with mariadb-dump's completion trailer. Prints the reason code on failure.
verify_file() {
  vf=$1; vs=${2:-$1.sha256}
  vt=$(mktemp -d "${TMPDIR:-/tmp}/sporta-verify.XXXXXX") || { echo verify_tmp; return 1; }
  if [ -f "$vs" ]; then
    want=$(awk '{print $1; exit}' "$vs"); got=$(sha256sum <"$vf" | awk '{print $1}')
    if [ -z "$want" ] || [ "$want" != "$got" ]; then rm -rf -- "$vt"; echo sha256_mismatch; return 1; fi
  elif [ "${3:-}" != nosidecar ]; then
    rm -rf -- "$vt"; echo sidecar_missing; return 1
  fi
  # Nothing of the plaintext is written to disk: only the status codes and a count of trailer lines.
  ( dec_from "$vf" 2>/dev/null; echo $? >"$vt/rc1" ) | ( gzip -dc 2>/dev/null; echo $? >"$vt/rc2" ) | tail -c 700 2>/dev/null | grep -c -- '^-- Dump completed' >"$vt/trailer" 2>/dev/null
  r1=$(cat "$vt/rc1" 2>/dev/null || echo 99); r2=$(cat "$vt/rc2" 2>/dev/null || echo 99)
  if [ "$r1" != 0 ]; then rm -rf -- "$vt"; echo decrypt_failed; return 1; fi
  if [ "$r2" != 0 ]; then rm -rf -- "$vt"; echo gunzip_failed; return 1; fi
  if [ "$(cat "$vt/trailer" 2>/dev/null || echo 0)" != 1 ]; then rm -rf -- "$vt"; echo trailer_missing; return 1; fi
  rm -rf -- "$vt"
  return 0
}

# ---------------------------------------------------------------- retention
# Keep the newest backup of each of the last KEEP_DAILY distinct days, KEEP_WEEKLY distinct ISO
# weeks and KEEP_MONTHLY distinct months THAT HAVE A BACKUP. "Distinct buckets present", not
# "calendar days back", so a server that was off for a month does not wipe its history when it
# wakes up. Only names that match is_backup_name() are ever candidates; everything else (notes,
# partial files, links, directories, another tool's dumps) is left alone.
keep_list() {
  # prints the names to KEEP, one per line
  names=$(for f in "$BACKUP_DIR"/${NAME_PREFIX}*${NAME_SUFFIX}; do
            [ -f "$f" ] && [ ! -L "$f" ] || continue
            n=${f##*/}; is_backup_name "$n" && printf '%s\n' "$n"
          done | sort -r)
  [ -n "$names" ] || return 0
  seen_d=" "; seen_w=" "; seen_m=" "; nd=0; nw=0; nm=0
  for n in $names; do
    stamp=${n#"$NAME_PREFIX"}; day=${stamp%%T*}; month=$(printf %s "$day" | cut -c1-6)
    iso=$(printf %s "$day" | sed 's/^\(....\)\(..\)\(..\)$/\1-\2-\3/')
    week=$(date -u -d "$iso" +%G-W%V 2>/dev/null || echo "bad-$day")
    k=0
    case $seen_d in *" $day "*) ;; *) if [ "$nd" -lt "$KEEP_DAILY" ]; then k=1; seen_d="$seen_d$day "; nd=$((nd+1)); fi ;; esac
    case $seen_w in *" $week "*) ;; *) if [ "$nw" -lt "$KEEP_WEEKLY" ]; then k=1; seen_w="$seen_w$week "; nw=$((nw+1)); fi ;; esac
    case $seen_m in *" $month "*) ;; *) if [ "$nm" -lt "$KEEP_MONTHLY" ]; then k=1; seen_m="$seen_m$month "; nm=$((nm+1)); fi ;; esac
    [ "$k" = 1 ] && printf '%s\n' "$n"
  done
}

do_prune() {
  dry=${1:-}
  for v in "$KEEP_DAILY" "$KEEP_WEEKLY" "$KEEP_MONTHLY"; do
    case $v in ''|*[!0-9]*|0) fail 8 retention_numbers_invalid db_backup_failed ;; esac
  done
  keep=$(keep_list); pruned=0; kept=0
  for f in "$BACKUP_DIR"/${NAME_PREFIX}*${NAME_SUFFIX}; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    n=${f##*/}; is_backup_name "$n" || continue
    if printf '%s\n' "$keep" | grep -qxF -- "$n"; then kept=$((kept+1)); continue; fi
    if [ "$dry" = --dry-run ]; then log "prune=would_delete file=$n"; else
      rm -f -- "$BACKUP_DIR/$n" "$BACKUP_DIR/$n.sha256" || fail 8 prune_rm_failed db_backup_failed
    fi
    pruned=$((pruned+1))
  done
  # a sidecar whose backup is gone (an interrupted prune or a manual delete): same pattern rule
  for f in "$BACKUP_DIR"/${NAME_PREFIX}*${NAME_SUFFIX}.sha256; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    n=${f##*/}; is_sidecar_name "$n" || continue
    [ -e "$BACKUP_DIR/${n%.sha256}" ] && continue
    [ "$dry" = --dry-run ] || rm -f -- "$f"
  done
  # abandoned partial files from a run that was killed (older than a day, our exact pattern)
  for f in "$BACKUP_DIR"/.sporta-db-*.partial; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    [ -n "$(find "$f" -maxdepth 0 -mmin +1440 2>/dev/null)" ] && [ "$dry" != --dry-run ] && rm -f -- "$f"
  done
  log "prune=done kept=$kept pruned=$pruned dry=$([ "$dry" = --dry-run ] && echo yes || echo no) policy=${KEEP_DAILY}d/${KEEP_WEEKLY}w/${KEEP_MONTHLY}m"
}

# ---------------------------------------------------------------- actions
free_kib() { df -Pk "$BACKUP_DIR" 2>/dev/null | awk 'NR==2{print $4}'; }

do_run() {
  check_tools; check_key; check_cnf; ensure_dir; take_lock

  # free disk: at least MIN_FREE_MB, and three times the newest backup (a backup is about as big as the last)
  need=$((MIN_FREE_MB * 1024)); nb=$(newest_backup)
  if [ -n "$nb" ]; then
    sz=$(stat -c %s "$BACKUP_DIR/$nb" 2>/dev/null || echo 0); three=$(( sz * 3 / 1024 ))
    [ "$three" -gt "$need" ] && need=$three
  fi
  have=$(free_kib); have=${have:-0}
  [ "$have" -ge "$need" ] || fail 5 "disk_low_have_${have}KiB_need_${need}KiB"

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  final=$NAME_PREFIX$stamp$NAME_SUFFIX
  [ -e "$BACKUP_DIR/$final" ] && fail 1 name_collision_wait_a_second
  partial=$BACKUP_DIR/.$final.partial
  TMPD=$(mktemp -d "$BACKUP_DIR/.run.XXXXXX") || fail 3 tmp_cannot_create
  : >"$partial" || fail 3 partial_cannot_create

  # The dump. Its exit status cannot travel through a pipe in POSIX sh, so it is written to a file.
  # The database login goes in on STDIN; mariadb-dump reads it as an option file and never shows it.
  # shellcheck disable=SC2086
  ( "$DOCKER" exec -i "$DB_CONTAINER" mariadb-dump --defaults-extra-file=/dev/stdin $DUMP_OPTS "$DB_NAME" <"$DUMP_CNF" 2>"$TMPD/dump.err"
    echo $? >"$TMPD/dump.rc" ) | gzip -c -6 | enc_to "$partial"
  enc_rc=$?
  drc=$(cat "$TMPD/dump.rc" 2>/dev/null || echo 99)
  if [ "$drc" != 0 ] || [ "$enc_rc" != 0 ]; then
    ecode=$(grep -o '([0-9]\{3,5\})' "$TMPD/dump.err" 2>/dev/null | tail -n 1 | tr -d '()')
    rm -f -- "$partial"
    fail 6 "dump_failed_rc=${drc}_enc=${enc_rc}_sqlerr=${ecode:-none}"
  fi
  size=$(stat -c %s "$partial" 2>/dev/null || echo 0)
  [ "$size" -ge 200 ] || { rm -f -- "$partial"; fail 6 dump_empty; }

  # Seal: hash, verify the file as it will be restored, then two atomic renames.
  hash=$(sha256sum <"$partial" | awk '{print $1}')
  printf '%s  %s\n' "$hash" "$final" >"$TMPD/side" || { rm -f -- "$partial"; fail 3 sidecar_cannot_write; }
  if ! why=$(verify_file "$partial" "$TMPD/side"); then rm -f -- "$partial"; fail 7 "verify_$why"; fi
  command -v sync >/dev/null 2>&1 && sync "$partial" 2>/dev/null
  mv -- "$partial" "$BACKUP_DIR/$final" || fail 3 rename_failed
  mv -- "$TMPD/side" "$BACKUP_DIR/$final.sha256" || fail 3 sidecar_rename_failed
  printf '%s %s\n' "$(date +%s)" "$final" >"$SUCCESS_FILE.tmp" && mv "$SUCCESS_FILE.tmp" "$SUCCESS_FILE"

  secs=$(( $(date +%s) - SECS_START ))
  log "run=ok file=$final bytes=$size secs=$secs binlog_pos=$([ "${SPORTA_DUMP_BINLOG_POS:-0}" = 1 ] && echo yes || echo no)"
  record_status ok 0 ok

  rc=0
  do_prune || rc=$?

  if [ -n "${SPORTA_OFFSITE_CMD:-}" ]; then
    SPORTA_BACKUP_FILE="$BACKUP_DIR/$final" SPORTA_BACKUP_SHA256="$BACKUP_DIR/$final.sha256" sh -c "$SPORTA_OFFSITE_CMD" >/dev/null 2>&1
    orc=$?
    if [ "$orc" -ne 0 ]; then log "offsite=failed rc=$orc"; record_status fail 9 offsite_failed; alert db_backup_offsite_failed; exit 9; fi
    log "offsite=ok"
  fi
  [ "${SPORTA_ALERT_ON_OK:-0}" = 1 ] && alert db_backup_ok
  return "$rc"
}

do_verify() {
  check_tools; check_key; ensure_dir
  target=${1:-}
  if [ -z "$target" ]; then n=$(newest_backup); [ -n "$n" ] || fail 7 no_backup_to_verify db_backup_failed; target=$BACKUP_DIR/$n; fi
  case $target in /*) ;; *) [ -e "$BACKUP_DIR/$target" ] && target=$BACKUP_DIR/$target ;; esac
  [ -f "$target" ] || fail 7 file_not_found db_backup_failed
  if why=$(verify_file "$target"); then log "verify=ok file=${target##*/}"; return 0; fi
  log "verify=fail file=${target##*/} reason=$why"
  alert db_backup_failed
  return 7
}

do_status() {
  ensure_dir
  nb=$(newest_backup); st=$(cat "$STATUS_FILE" 2>/dev/null || echo "none 0 0 never_ran")
  set -- $st; s_state=$1; s_code=$3; s_reason=$4
  age_h=-1; [ -n "$nb" ] && age_h=$(( ( $(date +%s) - $(stat -c %Y "$BACKUP_DIR/$nb") ) / 3600 ))
  count=0; for f in "$BACKUP_DIR"/${NAME_PREFIX}*${NAME_SUFFIX}; do [ -f "$f" ] && is_backup_name "${f##*/}" && count=$((count+1)); done
  off=no; [ -n "${SPORTA_OFFSITE_CMD:-}" ] && off=configured
  echo "backups=$count newest=${nb:-none} age_hours=$age_h last_run=$s_state code=$s_code reason=$s_reason offsite=$off"
  if [ -z "$nb" ] || [ "$age_h" -gt "$STALE_HOURS" ]; then alert db_backup_stale; return 1; fi
  [ "$s_state" = fail ] && return 2
  return 0
}

do_selftest() {
  check_tools; check_key; check_cnf; ensure_dir
  t=$(mktemp -d "${TMPDIR:-/tmp}/sporta-self.XXXXXX") || fail 3 tmp_cannot_create
  TMPD=$t
  printf 'selftest\n-- Dump completed on now\n' | gzip -c | enc_to "$t/x.enc" || fail 3 selftest_encrypt
  verify_file "$t/x.enc" "$t/none" nosidecar >/dev/null || fail 3 selftest_roundtrip
  # a real login, one cheap read-only statement (no table is touched)
  ( "$DOCKER" exec -i "$DB_CONTAINER" mariadb --defaults-extra-file=/dev/stdin -N -B -e 'select 1' "$DB_NAME" <"$DUMP_CNF" >"$t/q.out" 2>"$t/q.err"; echo $? >"$t/q.rc" )
  [ "$(cat "$t/q.rc")" = 0 ] && [ "$(tr -d '\n' <"$t/q.out")" = 1 ] || fail 3 database_login_failed
  # A schema-only dump with the SAME object flags the nightly run uses: an account that cannot see routines,
  # triggers or events is found here, tonight's install, not on the night a restore is needed.
  # shellcheck disable=SC2086
  ( "$DOCKER" exec -i "$DB_CONTAINER" mariadb-dump --defaults-extra-file=/dev/stdin --no-data --single-transaction --routines --events --triggers --default-character-set=utf8mb4 "$DB_NAME" <"$DUMP_CNF" 2>"$t/probe.err"; echo $? >"$t/probe.rc" ) | tail -c 700 | grep -c -- '^-- Dump completed' >"$t/probe.n"
  if [ "$(cat "$t/probe.rc" 2>/dev/null || echo 99)" != 0 ] || [ "$(cat "$t/probe.n" 2>/dev/null || echo 0)" != 1 ]; then
    fail 3 "dump_probe_failed_account_cannot_dump_every_object_kind"
  fi
  log "selftest=ok free_kib=$(free_kib) keep=${KEEP_DAILY}d/${KEEP_WEEKLY}w/${KEEP_MONTHLY}m"
  return 0
}

# db-restore-test.sh sources this file for the shared checks (SPORTA_DB_BACKUP_SOURCED=1) and
# supplies its own entry point.
if [ "${SPORTA_DB_BACKUP_SOURCED:-0}" != 1 ]; then
  cmd=${1:-run}
  [ $# -gt 0 ] && shift
  case $cmd in
    run)        do_run ;;
    verify)     do_verify "${1:-}" ;;
    prune)      check_tools; ensure_dir; take_lock; do_prune "${1:-}" ;;
    status)     do_status ;;
    selftest)   do_selftest ;;
    alert-test) alert db_backup_alert_test; exit 0 ;;
    -h|--help|help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "usage: db-backup.sh run|verify [FILE]|prune [--dry-run]|status|selftest|alert-test" >&2; exit 2 ;;
  esac
  exit $?
fi
