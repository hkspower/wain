#!/bin/sh
# db-restore-test.sh - prove a backup can be RESTORED, and that what comes back equals the source.
#
#   db-restore-test.sh [--newest | --fresh | --file NAME] [--allow-drift]
#
#   --newest   (default) restore the newest sealed backup in the backup directory
#   --fresh    take a new backup first (db-backup.sh run), restore THAT, compare. This is the
#              scheduled form: the source and the backup are minutes apart, so the compare is exact.
#   --file     restore one named backup from the backup directory
#   --allow-drift  an older backup is expected to differ from a live source that kept moving:
#              a table that grew since is a warning, not a failure. Anything the backup holds that
#              the source does not (a deleted row, a table that vanished) still fails.
#
# A database you cannot restore is not secure. A backup that was never restored is a hope.
#
# WHAT IT DOES
#   1. Verifies the file (sha256, decrypt, gunzip, dump trailer).
#   2. Starts a THROWAWAY database server: a container of the same image as the live database, on
#      `--network none` (nothing can connect to it), empty root password, anonymous volume removed
#      with the container. The live database server is never written to. (SPORTA_SCRATCH_MODE=external
#      with SPORTA_SCRATCH_CMD + SPORTA_SCRATCH_DB=restore_check_* uses an existing scratch server.)
#   3. Restores the backup into it and times the restore.
#   4. Reads a MANIFEST of every base table from the source (before and after) and from the restored
#      copy: the row count and a CRC32 sum over EVERY column of every row (binary-cast, NULL-marked,
#      UTC), inside one consistent snapshot per side. Plus the number of triggers, routines, events.
#   5. Compares. A table whose source manifest changed while the test ran is reported `moved` and
#      is judged by presence only; every other table must match exactly. `rate_limit` (ephemeral
#      counters) is judged by presence only.
#   6. Removes the scratch server and prints PASS or FAIL. On FAIL it exits non-zero and raises
#      the Activity-log alert `db_restore_check_failed`.
#
# What it prints: table names, row counts, checksums, seconds. Never a row value.
#
# EXIT CODES  0 pass | 1 compare failed | 3 configuration, key or tool | 6 restore failed |
#             7 the backup file did not verify | 2 usage

SPORTA_DB_BACKUP_SOURCED=1
SPORTA_LOG_TAG=db-restore-test
export SPORTA_LOG_TAG
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/db-backup.sh"
STATUS_FILE=$BACKUP_DIR/last-restore-test

MODE=newest; WANT_FILE=; DRIFT=no
while [ $# -gt 0 ]; do
  case $1 in
    --newest) MODE=newest ;;
    --fresh)  MODE=fresh ;;
    --file)   MODE=file; WANT_FILE=${2:-}; shift ;;
    --allow-drift) DRIFT=yes ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "usage: db-restore-test.sh [--newest|--fresh|--file NAME] [--allow-drift]" >&2; exit 2 ;;
  esac
  shift
done

SCRATCH_MODE=${SPORTA_SCRATCH_MODE:-container}
SCRATCH_NAME=sporta-restore-check-$$
SCRATCH_DB=$DB_NAME
SKIP_TABLES=${SPORTA_COMPARE_SKIP:-rate_limit}
SCRATCH_STARTED=no

scratch_cleanup() {
  if [ "$SCRATCH_STARTED" = yes ]; then
    if [ "$SCRATCH_MODE" = container ]; then
      "$DOCKER" rm -f -v "$SCRATCH_NAME" >/dev/null 2>&1
    else
      scratch_sql "drop database if exists \`$SCRATCH_DB\`" >/dev/null 2>&1
    fi
    SCRATCH_STARTED=no
  fi
  cleanup
}
trap scratch_cleanup EXIT
trap 'exit 130' INT TERM HUP

# SQL on the scratch server, from an argument. Never the source.
scratch_sql() {  # scratch_sql "SQL" [db]
  if [ "$SCRATCH_MODE" = container ]; then
    "$DOCKER" exec -i "$SCRATCH_NAME" mariadb -uroot --default-character-set=utf8mb4 -N -B -e "$1" ${2:+"$2"}
  else
    # shellcheck disable=SC2086
    $SPORTA_SCRATCH_CMD -N -B -e "$1" ${2:+"$2"}
  fi
}
# restore: SQL from stdin into the scratch database
scratch_load() {
  if [ "$SCRATCH_MODE" = container ]; then
    "$DOCKER" exec -i "$SCRATCH_NAME" mariadb -uroot --default-character-set=utf8mb4 "$SCRATCH_DB"
  else
    # shellcheck disable=SC2086
    $SPORTA_SCRATCH_CMD --default-character-set=utf8mb4 "$SCRATCH_DB"
  fi
}
# SQL on the SOURCE through the read-only login on stdin. The statement is passed as an argument.
source_sql() {
  "$DOCKER" exec -i "$DB_CONTAINER" mariadb --defaults-extra-file=/dev/stdin --default-character-set=utf8mb4 -N -B -e "$1" "$DB_NAME" <"$DUMP_CNF"
}

GEN_SQL=$(cat <<'EOF'
SET SESSION group_concat_max_len = 4194304;
SELECT CONCAT('SELECT ''', c.table_name, ''' AS t, COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT(',
  GROUP_CONCAT(CONCAT('IFNULL(CAST(`', c.column_name, '` AS BINARY),0x00)') ORDER BY c.ordinal_position SEPARATOR ',0x1f,'),
  '))),0) AS c FROM `', c.table_name, '`;')
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
WHERE c.table_schema = DATABASE() GROUP BY c.table_name ORDER BY c.table_name;
EOF
)
OBJ_SQL="SELECT CONCAT('~triggers\t', COUNT(*), '\t0') FROM information_schema.triggers WHERE trigger_schema = DATABASE() UNION ALL SELECT CONCAT('~routines\t', COUNT(*), '\t0') FROM information_schema.routines WHERE routine_schema = DATABASE() UNION ALL SELECT CONCAT('~events\t', COUNT(*), '\t0') FROM information_schema.events WHERE event_schema = DATABASE()"

# manifest SRC|DST -> stdout: "table<TAB>rows<TAB>crc", sorted by table. The generator query builds one
# SELECT per base table from information_schema; the statements then run inside ONE consistent
# snapshot, read-only, with the session time zone pinned to UTC so a TIMESTAMP prints the same on
# both sides.
manifest() {
  side=$1
  if [ "$side" = SRC ]; then stm=$(source_sql "$GEN_SQL" 2>/dev/null) || return 1
  else stm=$(scratch_sql "$GEN_SQL" "$SCRATCH_DB" 2>/dev/null) || return 1; fi
  [ -n "$stm" ] || return 1
  script="SET SESSION TRANSACTION READ ONLY; SET time_zone='+00:00'; START TRANSACTION WITH CONSISTENT SNAPSHOT; $(printf '%s' "$stm" | tr '\n' ' ') COMMIT;"
  if [ "$side" = SRC ]; then
    { source_sql "$script" && source_sql "$OBJ_SQL"; } | sort
  else
    { scratch_sql "$script" "$SCRATCH_DB" && scratch_sql "$OBJ_SQL" "$SCRATCH_DB"; } | sort
  fi
  return 0
}

run_restore_test() {
  check_tools; check_key; check_cnf; ensure_dir
  case $SCRATCH_MODE in
    container) ;;
    external)
      [ -n "${SPORTA_SCRATCH_CMD:-}" ] || fail 3 scratch_cmd_missing db_restore_check_failed
      SCRATCH_DB=${SPORTA_SCRATCH_DB:-}
      case $SCRATCH_DB in restore_check_*) ;; *) fail 3 scratch_db_must_start_with_restore_check_ db_restore_check_failed ;; esac ;;
    *) fail 3 scratch_mode_unknown ;;
  esac
  [ "$SCRATCH_NAME" != "$DB_CONTAINER" ] || fail 3 scratch_is_source

  case $MODE in
    fresh)
      log "step=fresh_backup"
      sh "$SCRIPT_DIR/db-backup.sh" run >/dev/null 2>&1 || fail 6 fresh_backup_failed db_restore_check_failed
      target=$(newest_backup) ;;
    file)
      is_backup_name "${WANT_FILE##*/}" || fail 3 file_name_not_ours db_restore_check_failed
      target=${WANT_FILE##*/} ;;
    *) target=$(newest_backup) ;;
  esac
  [ -n "$target" ] && [ -f "$BACKUP_DIR/$target" ] || fail 7 no_backup_to_restore db_restore_check_failed
  path=$BACKUP_DIR/$target
  bytes=$(stat -c %s "$path")

  if ! why=$(verify_file "$path"); then fail 7 "verify_$why" db_restore_check_failed; fi
  log "step=verified file=$target bytes=$bytes"

  # ---- scratch server
  t0=$(date +%s)
  if [ "$SCRATCH_MODE" = container ]; then
    image=$("$DOCKER" inspect -f '{{.Config.Image}}' "$DB_CONTAINER" 2>/dev/null) || fail 3 db_image_unknown db_restore_check_failed
    [ -n "$image" ] || fail 3 db_image_unknown db_restore_check_failed
    "$DOCKER" run -d --rm --name "$SCRATCH_NAME" --network none --pull never \
      -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 -e "MARIADB_DATABASE=$DB_NAME" \
      --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETGID --cap-add SETUID \
      --security-opt no-new-privileges --memory "${SPORTA_RESTORE_MEM:-768m}" \
      "$image" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --skip-log-bin >/dev/null 2>&1 \
      || fail 6 scratch_start_failed db_restore_check_failed
    SCRATCH_STARTED=yes
    ready=no; i=0
    while [ "$i" -lt 150 ]; do
      if "$DOCKER" logs "$SCRATCH_NAME" 2>&1 | grep -q 'Ready for start up'; then
        scratch_sql 'select 1' >/dev/null 2>&1 && { sleep 2; scratch_sql 'select 1' >/dev/null 2>&1 && { ready=yes; break; }; }
      fi
      sleep 1; i=$((i+1))
    done
    [ "$ready" = yes ] || fail 6 scratch_not_ready db_restore_check_failed
  else
    SCRATCH_STARTED=yes
    scratch_sql "drop database if exists \`$SCRATCH_DB\`; create database \`$SCRATCH_DB\` character set utf8mb4 collate utf8mb4_unicode_ci" >/dev/null 2>&1 || fail 6 scratch_cannot_create db_restore_check_failed
  fi

  # ---- source manifest BEFORE (a snapshot), restore, source manifest AFTER
  TMPD=$(mktemp -d "$BACKUP_DIR/.run.XXXXXX") || fail 3 tmp_cannot_create
  manifest SRC >"$TMPD/src_a" || fail 6 source_manifest_failed db_restore_check_failed
  t1=$(date +%s)
  ( dec_from "$path" 2>/dev/null; echo $? >"$TMPD/r1" ) | ( gzip -dc 2>/dev/null; echo $? >"$TMPD/r2" ) | scratch_load 2>"$TMPD/load.err"
  lrc=$?
  r1=$(cat "$TMPD/r1" 2>/dev/null || echo 99); r2=$(cat "$TMPD/r2" 2>/dev/null || echo 99)
  if [ "$lrc" != 0 ] || [ "$r1" != 0 ] || [ "$r2" != 0 ]; then
    ecode=$(grep -o 'ERROR [0-9]\{3,5\}' "$TMPD/load.err" 2>/dev/null | head -n 1 | tr -d 'ERROR ')
    fail 6 "restore_failed_load=${lrc}_dec=${r1}_gz=${r2}_sqlerr=${ecode:-none}" db_restore_check_failed
  fi
  t2=$(date +%s)
  manifest DST >"$TMPD/dst" || fail 6 restored_manifest_failed db_restore_check_failed
  manifest SRC >"$TMPD/src_b" || fail 6 source_manifest_failed db_restore_check_failed
  log "step=restored restore_secs=$((t2 - t1)) scratch_start_secs=$((t1 - t0)) bytes=$bytes"

  # ---- compare
  awk -F '\t' -v drift="$DRIFT" -v skip=" $(printf '%s' "$SKIP_TABLES" | tr ',' ' ') " '
    FILENAME==ARGV[1] { a[$1]=$2 "\t" $3; next }
    FILENAME==ARGV[2] { d[$1]=$2 "\t" $3; next }
    { b[$1]=$2 "\t" $3 }
    END {
      for (t in a) names[t]=1; for (t in b) names[t]=1; for (t in d) names[t]=1
      n=0; exact=0; moved=0; driftn=0; failn=0
      for (t in names) {
        n++
        skipped = index(skip, " " t " ") > 0
        if (!(t in d)) { printf "L FAIL %s missing from the restored copy\n", t; failn++; continue }
        if (!(t in a) || !(t in b)) { printf "L FAIL %s exists only in the restored copy\n", t; failn++; continue }
        split(a[t], A, "\t"); split(d[t], D, "\t")
        stable = (a[t] == b[t])
        if (skipped) { printf "L ok   %s present (not compared)\n", t; continue }
        if (a[t] == d[t] && stable) { printf "L ok   %s rows=%s\n", t, D[1]; exact++; continue }
        if (!stable) { printf "L warn %s moved while the test ran (source rows %s, restored %s)\n", t, A[1], D[1]; moved++; continue }
        if (drift == "yes" && (D[1]+0) <= (A[1]+0) && substr(t,1,1) != "~") { printf "L warn %s drifted since the backup (source rows %s, restored %s)\n", t, A[1], D[1]; driftn++; continue }
        why = (A[1] != D[1]) ? "row count" : "checksum"
        printf "L FAIL %s differs from the source: %s (source rows %s, restored rows %s)\n", t, why, A[1], D[1]; failn++
      }
      printf "S summary tables=%d exact=%d moved=%d drift=%d fail=%d\n", n, exact, moved, driftn, failn
      exit failn > 0 ? 1 : 0
    }' "$TMPD/src_a" "$TMPD/dst" "$TMPD/src_b" >"$TMPD/report"
  arc=$?
  grep '^L ' "$TMPD/report" | sort -k3 | cut -c3-
  summ=$(grep '^S ' "$TMPD/report" | cut -c3-)
  compared=$(printf '%s' "$summ" | sed 's/.*exact=\([0-9]*\).*/\1/')
  if [ "$arc" != 0 ]; then
    log "restore_test=FAIL file=$target $summ"
    fail 1 compare_failed db_restore_check_failed
  fi
  # a pass that compared nothing is not a pass
  if [ "${compared:-0}" -lt 1 ]; then
    log "restore_test=FAIL file=$target $summ"
    fail 1 nothing_was_compared db_restore_check_failed
  fi
  log "restore_test=PASS file=$target $summ total_secs=$(( $(date +%s) - t0 ))"
  record_status ok 0 restore_test_ok
  [ "${SPORTA_ALERT_ON_OK:-0}" = 1 ] && alert db_restore_check_ok
  return 0
}

run_restore_test
exit $?
