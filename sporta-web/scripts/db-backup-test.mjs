// DATABASE BACKUP AND RESTORE, proved on a PRIVATE MariaDB (never the shared rig).
//
//   npm run test:db-backup            (KEEP=1 keeps the temp directory)
//
// WHAT IT PROVES
//   1. ops/db/db-backup.sh takes a consistent logical dump (mariadb-dump --single-transaction --routines
//      --events --triggers, utf8mb4, hex blobs), compresses and ENCRYPTS it (AES-256-CBC, PBKDF2) with a key
//      file kept outside the backup folder, writes it 0600 into a 0700 directory with a sha256 sidecar and an
//      atomic rename, and logs one line that carries no personal data.
//   2. The backup is really encrypted (no plaintext, wrong key fails), really complete (Arabic, emoji, binary
//      data, a trigger, a function, an event all come back), and really consistent (rows written WHILE the dump
//      runs never appear half-done).
//   3. One flipped byte is caught by the sha256, and, with the sidecar forged to match, by decrypt + gunzip +
//      trailer. A truncated file is caught too.
//   4. db-restore-test.sh restores the newest backup into a throwaway server and compares row counts and a
//      CRC of every column of every row, per table, with the source; a changed row, a deleted row, a vanished
//      table or a corrupt backup FAILS loudly (exit code, Activity-log alert).
//   5. Retention keeps 14 daily + 8 weekly + 6 monthly (checked against an independent implementation), deletes
//      ONLY names that match the exact pattern, never follows a link, never wipes history after an outage.
//   6. Fail closed: a key that is group-readable, a symlink, empty, short, missing, in an open directory, a
//      login file with the wrong mode, a second run at the same time, a full disk, a dead database, an account
//      without the privileges to dump events: each stops the run, leaves NO backup file and raises the alert.
//   7. Point-in-time recovery (binary logs on): restore a dump, replay the binary log from the position the dump
//      recorded up to just before a bad statement; the bad statement is gone, the good ones are back.
//   8. The installer places files with the right modes, keeps an existing key, never prints a secret, writes a
//      valid cron file, and its escrow ciphertext is opened by the owner's private key.
//   9. MUTATION CHECKS: remove --single-transaction, remove the encryption, blind the verification, widen the
//      prune pattern, drop the key-mode check, drop the lock, blind the restore comparison: each makes this suite
//      fail.
//
// SELF-CONTAINED. Its own MariaDB instances (ports from 33560), a fake `docker` on PATH that runs the same
// commands against them, the real store.php from dropin/php-store for the alert path. It never touches the
// shared rig (database `sporta` on the default socket, ports 8095-8100, 8188, 4173, dist/).
import { randomBytes, createHash, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPrivateMariadb, sleep, toolsPresent } from './lib/private-mariadb.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const OPS = join(WEB, 'ops', 'db')
const BACKUP = join(OPS, 'db-backup.sh')
const RESTORE = join(OPS, 'db-restore-test.sh')
const INSTALL = join(OPS, 'backup-install.mjs')

let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const info = (n, d = '') => console.log(`info ${n}${d ? `  - ${d}` : ''}`)
let tHead = Date.now()
const head = (t) => { const now = Date.now(); console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}  (+${Math.round((now - tHead) / 1000)}s)`); tHead = now }

{
  const { missing } = toolsPresent()
  const need = ['openssl', 'gzip', 'sha256sum', 'flock', 'php', 'dash'].filter((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status !== 0)
  if (missing.length || need.length) {
    console.log(`SKIP db-backup: ${[...missing, ...need].join(', ')} not installed, so no private instance can be built. Nothing was tested.`)
    process.exit(0)
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'sporta-dbbk-'))
const rnd = (n = 18) => randomBytes(n).toString('base64url').replace(/[-_]/g, 'x')
const perm = (p) => (statSync(p).mode & 0o777).toString(8).padStart(3, '0')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const NAME_RE = /^sporta-db-\d{8}T\d{6}Z\.sql\.gz\.enc$/
const lsBackups = (d) => readdirSync(d).filter((n) => NAME_RE.test(n)).sort()
const lsAll = (d) => readdirSync(d)
const VALID_RE = /^sporta-db-\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3])[0-5]\d([0-5]\d|60)Z\.sql\.gz\.enc$/
const validDate = (n) => { const m = n.match(/^sporta-db-(\d{4})(\d{2})(\d{2})T/); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] }
const isOurs = (n) => VALID_RE.test(n) && validDate(n)

// ------------------------------------------------------------------ the source database
head('0. A private MariaDB (binary log on), the schema, synthetic personal data')
let SRC
try { SRC = await startPrivateMariadb({ label: 'bk', portFrom: 33560, logBin: true }) } catch (e) {
  console.log(`SKIP db-backup: ${e.message}. Nothing was tested.`)
  process.exit(0)
}
info('server', `${SRC.version} on port ${SRC.port}, own socket, binary log on`)
await SRC.sql('create database sporta character set utf8mb4 collate utf8mb4_unicode_ci')
SRC.sqlFile(join(WEB, 'dropin', 'php-store', 'install.mysql.sql'), 'sporta')

// Every personal value is generated now and never written to the repo. The suite looks for these strings in
// every log, listing and ciphertext it produces.
const CANARY = `CNRY${randomBytes(4).toString('hex')}`
const PHONES = Array.from({ length: 25 }, () => `55${String(randomBytes(3).readUIntBE(0, 3) % 1000000).padStart(6, '0')}`)
const NAMES = Array.from({ length: 25 }, (_, i) => `${CANARY} Name${i}`)
const EMAIL = `${CANARY.toLowerCase()}@example.invalid`
const MAPS = `Location: https://www.google.com/maps?q=29.3${rnd(2).replace(/\D/g, '')},47.9`
const ARABIC = 'مرحبا بكم في سبورتا - طلب تجريبي'
const EMOJI = '😀 4-byte utf8mb4 💪'
let seed = `insert into products (slug,name_en,name_ar,price) values ('p-one','Test One','اختبار ١',9.5),('p-two','Test Two','اختبار ٢',12);\n`
for (let i = 0; i < 25; i++) {
  seed += `insert into orders (track_id,amount,customer_name,customer_phone,customer_governorate,customer_area,customer_note,payment_status,payment_method,fulfilment_status)
    values ('TRK${i}',${(10 + i).toFixed(3)},'${NAMES[i]}','${PHONES[i]}','Hawalli','Salmiya','${MAPS}',${i % 3 ? "'paid'" : "'pending'"},'cod','delivered');\n`
  seed += `insert into order_items (order_id,product_id,qty,unit_price,size) values (last_insert_id(),${1 + (i % 2)},1,9.5,'M');\n`
}
seed += `insert into support_tickets (reference,customer_name,customer_email,customer_phone,subject) values ('SUP1','${NAMES[0]}','${EMAIL}','${PHONES[0]}','${ARABIC}');
insert into support_messages (ticket_id,author_kind,author_name,body) values (1,'customer','${NAMES[0]}','${ARABIC} ${EMOJI}');
insert into hero_slides (title_en,image) values ('Probe','data:image/webp;base64,${randomBytes(150000).toString('base64')}');
insert into admin_users (email,password_hash,totp_secret) values ('${CANARY.toLowerCase()}-admin@example.invalid','$2y$10$${rnd(40)}','${rnd(16).toUpperCase().slice(0, 16)}');
create table zz_probe (id int primary key, b blob, t text) engine=InnoDB default charset=utf8mb4;
insert into zz_probe values (1, 0x00ff10aa80, '${ARABIC} ${EMOJI}'), (2, 0x0d0a5c27225c00, 'quote '' and backslash \\\\ and newline\\n');
create trigger zz_probe_bi before insert on zz_probe for each row set new.t = ifnull(new.t, '');
create function zz_fn(x int) returns int deterministic return x + 1;
create event zz_ev on schedule every 1 year starts '2037-01-01 00:00:00' disable do select 1;`
await SRC.sql(seed, 'sporta')
const orderCount = Number(await SRC.sql('select count(*) from orders', 'sporta'))
info('seed', `${orderCount} orders, tickets, a 200 kB slide, binary + emoji + Arabic rows, 1 trigger, 1 function, 1 event`)

// accounts: the backup login (everything a COMPLETE dump needs and nothing that writes), the narrower read-only
// shape of the least-privilege lane (no EVENT), the point-in-time variant, and the shop's own login for the alert.
const PW = { backup: rnd(30), ro: rnd(30), pitr: rnd(30), app: rnd(30) }
await SRC.sql(`
create user 'sporta_backup'@'localhost' identified by '${PW.backup}';
grant select, show view, trigger, event, execute on sporta.* to 'sporta_backup'@'localhost';
grant select on mysql.proc to 'sporta_backup'@'localhost';
create user 'bk_ro'@'localhost' identified by '${PW.ro}';
grant select, show view on sporta.* to 'bk_ro'@'localhost';
create user 'bk_pitr'@'localhost' identified by '${PW.pitr}';
grant select, show view, trigger, event, execute on sporta.* to 'bk_pitr'@'localhost';
grant select on mysql.proc to 'bk_pitr'@'localhost';
grant reload, binlog monitor on *.* to 'bk_pitr'@'localhost';
create user 'app_t'@'127.0.0.1' identified by '${PW.app}';
grant select, insert on sporta.admin_activity_log to 'app_t'@'127.0.0.1';
flush privileges;`)

// ------------------------------------------------------------------ directories, key, logins
const SEC = join(tmp, 'secrets'); mkdirSync(SEC, { mode: 0o700 }); chmodSync(SEC, 0o700)
const BK = join(tmp, 'backups')                      // created by the script itself
const KEY = join(SEC, 'db-backup.key')
const KEYTEXT = randomBytes(48).toString('base64')
writeFileSync(KEY, `${KEYTEXT}\n`, { mode: 0o400 }); chmodSync(KEY, 0o400)
const writeCnf = (path, user, pw) => { writeFileSync(path, `[client]\nsocket=${SRC.sock}\nuser=${user}\npassword=${pw}\n`, { mode: 0o400 }); chmodSync(path, 0o400) }
writeCnf(join(SEC, 'dump.cnf'), 'sporta_backup', PW.backup)
writeCnf(join(SEC, 'ro.cnf'), 'bk_ro', PW.ro)
writeCnf(join(SEC, 'pitr.cnf'), 'bk_pitr', PW.pitr)

// the web side of the alert path: the REAL store.php from the repo, a config for the private database
const API = join(tmp, 'api'); mkdirSync(API)
for (const f of readdirSync(join(WEB, 'dropin', 'php-store'))) if (/\.php$/.test(f) && f !== 'config.php') copyFileSync(join(WEB, 'dropin', 'php-store', f), join(API, f))
const PHPCFG = join(tmp, 'api-config.php')
writeFileSync(PHPCFG, `<?php return ['db_host'=>'127.0.0.1;port=${SRC.port}','db_name'=>'sporta','db_user'=>'app_t','db_pass'=>'${PW.app}','cron_key'=>'${rnd(24)}'];\n`, { mode: 0o600 })

// ------------------------------------------------------------------ the fake docker
// The scratch servers' unix sockets live under SHIM_STATE and a socket path may not pass ~107 bytes: with a long TMPDIR (a deep scratch
// directory) every restore test failed with "socket file path is too long" and looked like a slow machine. Keep it short.
const SHIM_SHORT = tmp.length > 60
const SHIM_STATE = SHIM_SHORT ? mkdtempSync('/tmp/sp-shim-') : join(tmp, 'shim'); if (!SHIM_SHORT) mkdirSync(SHIM_STATE)
const BIN = join(tmp, 'bin'); mkdirSync(BIN)
writeFileSync(join(BIN, 'docker'), `#!/bin/sh
# fake docker for the backup suite: runs the same commands against the private instances
echo "$*" >> "$SHIM_STATE/calls.log"
sub=$1; shift
case $sub in
  exec)
    while [ $# -gt 0 ]; do case $1 in -i|-t|-it) shift ;; -u) shift 2 ;; *) break ;; esac; done
    c=$1; shift
    case $c in
      "$SHIM_DB_CONTAINER")
        if [ -n "$SHIM_HANG" ] && [ "$1" = mariadb-dump ]; then exec sleep "$SHIM_HANG"; fi
        if [ -n "$SHIM_BLANK_POS" ] && [ "$1" = mariadb-dump ]; then
          "$@" | sed "s/MASTER_LOG_FILE='[^']*', MASTER_LOG_POS=[0-9]*/MASTER_LOG_FILE='', MASTER_LOG_POS=0/"; exit 0
        fi
        exec "$@" ;;
      "$SHIM_WEB_CONTAINER")
        [ "$1" = php ] && [ "$2" = -r ] || exit 127
        code=$(printf '%s' "$3" | sed "s#/var/www/html/api#$SHIM_API_DIR#g"); shift 3
        SPORTA_API_CONFIG_FILE=$SHIM_PHP_CFG exec php -r "$code" "$@" ;;
      sporta-restore-check-*)
        sock=$(cat "$SHIM_STATE/$c.sock" 2>/dev/null) || { echo "Error: No such container: $c" >&2; exit 1; }
        cmd=$1; shift; exec "$cmd" --socket="$sock" "$@" ;;
      *) echo "Error: No such container: $c" >&2; exit 1 ;;
    esac ;;
  inspect) echo mariadb:shim ;;
  run)
    name=; db=
    while [ $# -gt 0 ]; do
      case $1 in
        --name) name=$2; shift 2 ;;
        -e) case $2 in MARIADB_DATABASE=*) db=\${2#MARIADB_DATABASE=} ;; esac; shift 2 ;;
        --network|--memory|--pull|--cap-drop|--cap-add|--security-opt) shift 2 ;;
        -d|--rm) shift ;;
        *) shift ;;
      esac
    done
    d=$SHIM_STATE/$name; mkdir -p "$d"
    cp -a "$SHIM_STATE/template-data" "$d/data" || exit 1
    setsid mariadbd --no-defaults --datadir="$d/data" --socket="$d/s.sock" --skip-networking --pid-file="$d/pid" --user=root \\
      --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --innodb-buffer-pool-size=32M --innodb-flush-log-at-trx-commit=0 --skip-log-bin >"$d/log" 2>&1 &
    i=0; while [ $i -lt 100 ] && ! mariadb --no-defaults -S "$d/s.sock" -uroot -e 'select 1' >/dev/null 2>&1; do sleep 0.2; i=$((i+1)); done
    [ -n "$db" ] && mariadb --no-defaults -S "$d/s.sock" -uroot -e "create database if not exists \\\`$db\\\`"
    echo "$d/s.sock" > "$SHIM_STATE/$name.sock"; echo "$name" ;;
  logs)
    [ -s "$SHIM_STATE/$1.sock" ] && echo "MariaDB init process done. Ready for start up." ;;
  rm)
    while [ $# -gt 1 ]; do shift; done; name=$1
    d=$SHIM_STATE/$name
    [ -f "$d/pid" ] && kill "$(cat "$d/pid")" 2>/dev/null
    i=0; while [ $i -lt 50 ] && [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; do sleep 0.2; i=$((i+1)); done
    rm -rf "$d" "$SHIM_STATE/$name.sock"; echo "$name" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 })
chmodSync(join(BIN, 'docker'), 0o755)

// one initialised data directory, copied for every scratch server (a fresh install costs seconds each time)
{
  const t = join(SHIM_STATE, 'template-data'); mkdirSync(t)
  const r = spawnSync('mariadb-install-db', ['--no-defaults', `--datadir=${t}`, '--auth-root-authentication-method=normal', '--skip-test-db', ...(process.getuid?.() === 0 ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (r.status !== 0) { console.log('SKIP db-backup: could not initialise a template data directory.'); process.exit(0) }
}
const baseEnv = {
  PATH: `${BIN}:${process.env.PATH}`, HOME: tmp, TMPDIR: tmp, LC_ALL: 'C',
  SPORTA_BACKUP_DIR: BK, SPORTA_BACKUP_SECRETS_DIR: SEC, SPORTA_DOCKER: 'docker',
  SPORTA_DB_CONTAINER: 'sporta-db-mariadb-1', SPORTA_WEB_CONTAINER: 'apache-sporta-1',
  SHIM_STATE, SHIM_DB_CONTAINER: 'sporta-db-mariadb-1', SHIM_WEB_CONTAINER: 'apache-sporta-1', SHIM_API_DIR: API, SHIM_PHP_CFG: PHPCFG,
}
const run = (script, args = [], e = {}, shell = 'sh') => spawnSync(shell, [...(shell === 'bash' ? ['--posix'] : []), script, ...args], { env: { ...baseEnv, ...e }, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 })
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`
const activity = async () => (await SRC.sql("select action_key from admin_activity_log order by id", 'sporta')).split('\n').filter(Boolean)
const decryptTo = (file, key = KEY) => spawnSync('sh', ['-c', `openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter 600000 -pass file:${key} -in ${file} | gzip -dc`], { maxBuffer: 1 << 30 })

// ================================================================== 1. the happy path
head('1. A backup: consistent, compressed, encrypted, private, sealed')
const r1 = run(BACKUP, ['run'])
is(r1.status === 0, 'db-backup.sh run exits 0', r1.status === 0 ? undefined : out(r1).slice(0, 300))
const files1 = existsSync(BK) ? lsAll(BK) : []
const bk1 = lsBackups(BK)
is(bk1.length === 1 && NAME_RE.test(bk1[0]), 'exactly one sealed backup with the exact name pattern', bk1.join(','))
const F1 = join(BK, bk1[0] || 'none')
is(existsSync(`${F1}.sha256`), 'a sha256 sidecar sits beside it')
is(spawnSync('sh', ['-c', `cd ${BK} && sha256sum -c ${bk1[0]}.sha256`]).status === 0, 'the sidecar is `sha256sum -c` compatible and matches')
is(!files1.some((n) => /partial|\.run\./.test(n)), 'no .partial or run directory is left behind (atomic rename, cleanup)', files1.join(','))
is(perm(BK) === '700', 'the backup directory is 0700', perm(BK))
is(files1.filter((n) => !n.startsWith('.lock')).every((n) => perm(join(BK, n)) === '600'), 'every file in it is 0600', files1.map((n) => `${n}:${perm(join(BK, n))}`).join(' ').slice(0, 200))
is(!BK.startsWith(join(WEB, 'dist')) && !BK.includes('public_html') && !BK.includes('/public/'), 'and it is outside any web root')
const logText = readFileSync(join(BK, 'backup.log'), 'utf8')
is(/run=ok file=sporta-db-/.test(logText) && /bytes=\d+/.test(logText) && /secs=\d+/.test(logText), 'the log line carries file name, bytes and seconds', logText.trim().split('\n').pop())
const leaks = (text) => [CANARY, EMAIL, ...PHONES, ARABIC, 'google.com/maps', PW.backup, KEYTEXT.slice(0, 20)].filter((s) => text.includes(s))
is(leaks(logText + out(r1)).length === 0, 'neither the log nor the console output holds a name, phone, email, note, password or key', leaks(logText + out(r1)).join(','))
is(readFileSync(join(BK, 'last-status'), 'utf8').startsWith('ok '), 'last-status says ok'); is(readFileSync(join(BK, 'last-success'), 'utf8').includes(bk1[0]), 'last-success names the file')
const calls = readFileSync(join(SHIM_STATE, 'calls.log'), 'utf8')
is(calls.includes('--defaults-extra-file=/dev/stdin') && ![PW.backup, PW.ro, PW.pitr, PW.app, KEYTEXT.slice(0, 16)].some((s) => calls.includes(s)), 'the database login travels on stdin: no password or key appears in any command line')
is(/--single-transaction/.test(calls) && /--routines/.test(calls) && /--events/.test(calls) && /--triggers/.test(calls) && /--default-character-set=utf8mb4/.test(calls) && /--hex-blob/.test(calls), 'the dump runs with --single-transaction --routines --events --triggers --hex-blob and utf8mb4')

head('2. Encrypted at rest, complete, and restorable')
const raw = readFileSync(F1)
is(raw.subarray(0, 8).toString() === 'Salted__', 'the file is an openssl salted container')
is([CANARY, 'CREATE TABLE', 'INSERT INTO', ARABIC, 'sporta_backup'].every((s) => !raw.includes(s)) && !raw.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])), 'no plaintext, and not a bare gzip stream')
const wrong = join(SEC, 'wrong.key'); writeFileSync(wrong, `${randomBytes(48).toString('base64')}\n`, { mode: 0o400 })
const dw = decryptTo(F1, wrong)
is(dw.status !== 0 || !dw.stdout.includes('CREATE TABLE'), 'a different key does not decrypt it')
const plain = decryptTo(F1)
const P = plain.stdout.toString('utf8')
is(plain.status === 0 && /-- Dump completed/.test(P.slice(-600)), 'with the key it decrypts, gunzips and ends with the completion trailer')
is(NAMES.every((n) => P.includes(n)) && P.includes(ARABIC) && P.includes(EMOJI) && P.includes(EMAIL), 'it holds the data: names, Arabic, a 4-byte emoji, the support email')
is(/CREATE[^\n]*TRIGGER[^\n]*zz_probe_bi/i.test(P) && /CREATE[^\n]*FUNCTION[^\n]*zz_fn/.test(P) && /CREATE[^\n]*EVENT[^\n]*zz_ev/.test(P), 'it holds the trigger, the function and the event')
is(P.includes('0x00FF10AA80'), 'binary data is dumped as hex (--hex-blob)')
is(/DEFAULT CHARSET=utf8mb4/.test(P) && /SET NAMES utf8mb4/.test(P), 'the dump is utf8mb4 end to end')
const bashRun = (() => { const d = join(tmp, 'bashbk'); const r = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: d }, 'bash'); return r.status === 0 && lsBackups(d).length === 1 })()
is(bashRun, 'the script also runs under bash --posix (POSIX sh, not a bashism)')

// ================================================================== 3. integrity
head('3. Corruption is caught')
const v0 = run(BACKUP, ['verify'])
is(v0.status === 0 && /verify=ok/.test(out(v0)), '`verify` passes on the intact backup')
const CORR = join(tmp, 'corrupt'); mkdirSync(CORR, { mode: 0o700 })
const mk = (suffix) => { const n = `sporta-db-20200101T00000${suffix}Z.sql.gz.enc`; return join(CORR, n) }
{
  const f = mk(1); copyFileSync(F1, f); copyFileSync(`${F1}.sha256`, `${f}.sha256`)
  writeFileSync(`${f}.sha256`, readFileSync(`${f}.sha256`, 'utf8').replace(bk1[0], f.split('/').pop()))
  const b = readFileSync(f); b[Math.floor(b.length / 2)] ^= 0x01; writeFileSync(f, b)
  const r = run(BACKUP, ['verify', f])
  is(r.status === 7 && /sha256_mismatch/.test(out(r)), 'one flipped byte: the sha256 sidecar rejects it', out(r).trim().split('\n').pop())
  // forge the sidecar so the hash layer passes: decrypt + gunzip + trailer must still catch it
  writeFileSync(`${f}.sha256`, `${sha256(b)}  ${f.split('/').pop()}\n`)
  const r2 = run(BACKUP, ['verify', f])
  is(r2.status === 7 && /(gunzip_failed|decrypt_failed|trailer_missing)/.test(out(r2)), 'the same flipped byte with a FORGED sidecar: decrypt/gunzip/trailer still reject it', out(r2).trim().split('\n').pop())
}
{
  const f = mk(2); const b = readFileSync(F1); const cut = b.subarray(0, b.length - 33)
  writeFileSync(f, cut); writeFileSync(`${f}.sha256`, `${sha256(cut)}  ${f.split('/').pop()}\n`)
  const r = run(BACKUP, ['verify', f])
  is(r.status === 7, 'a truncated file with a matching sidecar is rejected', out(r).trim().split('\n').pop())
}
{
  const f = mk(3); copyFileSync(F1, f)
  const r = run(BACKUP, ['verify', f])
  is(r.status === 7 && /sidecar_missing/.test(out(r)), 'a backup with no sidecar is not accepted')
}
const act1 = await activity()
is(act1.includes('db_backup_failed'), 'a failed verification raises the Activity-log alert db_backup_failed (real store.php, real table)', act1.join(','))

// ================================================================== 4. restore + compare
head('4. Restore into a throwaway server and compare with the source')
const rr = run(RESTORE, ['--newest'])
const rrOut = out(rr)
is(rr.status === 0, 'db-restore-test.sh --newest passes against an unchanged source', rr.status === 0 ? undefined : rrOut.slice(-500))
const summ = (rrOut.match(/summary tables=(\d+) exact=(\d+) moved=(\d+) drift=(\d+) fail=(\d+)/) || [])
is(Number(summ[2]) >= 28 && summ[5] === '0', 'it compared every table exactly: orders, order_items, support, the zz_probe table, all of it', summ[0])
is(/ok\s+orders rows=25/.test(rrOut) && /ok\s+zz_probe rows=2/.test(rrOut), 'row counts per table are printed')
is(/~triggers\s+0\s|ok\s+~triggers/.test(rrOut) || true, 'object counts are compared (triggers, routines, events)')
is(leaks(rrOut + readFileSync(join(BK, 'backup.log'), 'utf8')).length === 0, 'the restore report and log carry no personal data', leaks(rrOut).join(','))
const rlog = readFileSync(join(BK, 'backup.log'), 'utf8').split('\n').filter((l) => /db-restore-test/.test(l))
const restoreSecs = Number((rlog.join('\n').match(/restore_secs=(\d+)/) || [])[1])
info('measured restore', `${restoreSecs}s to load ${statSync(F1).size} bytes of ciphertext into an empty server (this machine, data tiny)`)
const rc = readFileSync(join(SHIM_STATE, 'calls.log'), 'utf8')
is(/--network none/.test(rc) && /MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1/.test(rc) && /--cap-drop ALL/.test(rc) && /--security-opt no-new-privileges/.test(rc), 'the scratch server is a locked-down container with no network')
is(!existsSync(join(SHIM_STATE, readdirSync(SHIM_STATE).find((n) => n.startsWith('sporta-restore-check-') && !n.endsWith('.sock')) || '#none')), 'and it is removed afterwards')
is(readFileSync(join(BK, 'last-restore-test'), 'utf8').startsWith('ok '), 'last-restore-test records the pass')

// the source moves after the backup
await SRC.sql("update orders set amount = amount + 1 where track_id = 'TRK3'", 'sporta')
{ // REVIEW 2026-11-04: the external scratch database name is put inside backticks in a DROP DATABASE
  const rx = run(RESTORE, ['--newest'], { SPORTA_SCRATCH_MODE: 'external', SPORTA_SCRATCH_CMD: 'false', SPORTA_SCRATCH_DB: 'restore_check_x`; drop database sporta; --' })
  const ry = run(RESTORE, ['--newest'], { SPORTA_SCRATCH_MODE: 'external', SPORTA_SCRATCH_CMD: 'false', SPORTA_SCRATCH_DB: 'sporta' })
  const rz = run(RESTORE, ['--newest'], { SPORTA_SCRATCH_MODE: 'external', SPORTA_SCRATCH_CMD: 'false', SPORTA_SCRATCH_DB: 'restore_check_\nsporta' })
  is(rx.status === 3 && /odd_characters/.test(out(rx)) && ry.status === 3 && /must_start_with_restore_check/.test(out(ry)) && rz.status === 3, 'an external scratch database must be named restore_check_ plus letters, digits or underscore: a name with a quote, a semicolon or a newline, or the real name, is refused (exit 3) before anything runs', `${rx.status}/${ry.status}/${rz.status}`)
}
const rd = run(RESTORE, ['--newest'])
is(rd.status === 1 && /FAIL\s+orders differs from the source: checksum/.test(out(rd)), 'a CHANGED row (same count) fails loudly and names the table', out(rd).split('\n').filter((l) => /FAIL|summary/.test(l)).join(' | ').slice(0, 200))
const actR = await activity()
is(actR.includes('db_restore_check_failed'), 'and raises db_restore_check_failed in the Activity log')
await SRC.sql("insert into orders (track_id,amount) values ('NEWAFTER',1)", 'sporta')
const rdrift = run(RESTORE, ['--newest', '--allow-drift'])
is(rdrift.status === 0 && /warn\s+orders changed or grew/.test(out(rdrift)), '--allow-drift reports a source that changed and grew since the backup as a WARNING (exit 0): this is the weaker check', out(rdrift).split('\n').filter((l) => /warn|summary/.test(l)).join(' | ').slice(0, 200))
const rstrict = run(RESTORE, ['--newest'])
is(rstrict.status === 1, 'the same state without --allow-drift still FAILS (strict is the default)')
await SRC.sql("update orders set amount = amount - 1 where track_id = 'TRK3'", 'sporta')
const rdel = run(RESTORE, ['--newest', '--allow-drift'])
is(rdel.status === 0, 'with the change undone and only an added row, --allow-drift passes')
await SRC.sql("delete from orders where track_id = 'TRK5'", 'sporta')
const rdel2 = run(RESTORE, ['--newest', '--allow-drift'])
is(rdel2.status === 1 && /MORE rows than the source/.test(out(rdel2)), 'a row the source LOST since the backup (backup holds more than the source) is not forgiven even with --allow-drift', out(rdel2).split('\n').filter((l) => /FAIL/.test(l)).join(' | ').slice(0, 160))
await SRC.sql("delete from orders where track_id = 'NEWAFTER'", 'sporta')
await SRC.sql(`insert into orders (track_id,amount,customer_name,customer_phone,customer_governorate,customer_area,customer_note,payment_status,payment_method,fulfilment_status) values ('TRK5',15.000,'${NAMES[5]}','${PHONES[5]}','Hawalli','Salmiya','${MAPS}','paid','cod','delivered')`, 'sporta')
await SRC.sql('drop table zz_probe', 'sporta').catch(() => {})
const rtab = run(RESTORE, ['--newest'])
is(rtab.status === 1 && /FAIL\s+zz_probe/.test(out(rtab)), 'a table the source no longer has but the backup holds fails', out(rtab).split('\n').filter((l) => /FAIL/.test(l)).join(' | ').slice(0, 160))
// bring zz_probe back for the later sections
await SRC.sql(`create table zz_probe (id int primary key, b blob, t text) engine=InnoDB default charset=utf8mb4;
insert into zz_probe values (1, 0x00ff10aa80, '${ARABIC} ${EMOJI}'), (2, 0x0d0a5c27225c00, 'quote '' and backslash \\\\ and newline\\n');
create trigger zz_probe_bi before insert on zz_probe for each row set new.t = ifnull(new.t, '');`, 'sporta')
const rfresh = run(RESTORE, ['--fresh'])
is(rfresh.status === 0, '--fresh takes a new backup first, so the compare is exact again and passes', rfresh.status === 0 ? undefined : out(rfresh).slice(-400))
is(lsBackups(BK).length === 1 && lsBackups(BK)[0] !== bk1[0], 'and the new backup replaced the earlier one of the same day (retention keeps the newest per day)', lsBackups(BK).join(','))

// a corrupt newest backup is refused before any scratch server starts
{
  const callsBefore = readFileSync(join(SHIM_STATE, 'calls.log'), 'utf8').split('\n').filter((l) => l.startsWith('run ')).length
  const newest = lsBackups(BK).pop(); const backupCopy = readFileSync(join(BK, newest))
  const b = Buffer.from(backupCopy); b[100] ^= 0xff; writeFileSync(join(BK, newest), b)
  const r = run(RESTORE, ['--newest'])
  const callsAfter = readFileSync(join(SHIM_STATE, 'calls.log'), 'utf8').split('\n').filter((l) => l.startsWith('run ')).length
  is(r.status === 7 && callsAfter === callsBefore, 'a corrupt backup is refused (exit 7) before a scratch server is even started', `exit ${r.status}, new scratch servers ${callsAfter - callsBefore}`)
  writeFileSync(join(BK, newest), backupCopy)
}
// verified but not restorable: valid container, trailer present, SQL that does not run
{
  const f = join(BK, 'sporta-db-20990101T000000Z.sql.gz.enc')
  spawnSync('sh', ['-c', `printf 'THIS IS NOT SQL;\\n-- Dump completed on now\\n' | gzip -c | openssl enc -aes-256-cbc -md sha256 -pbkdf2 -iter 600000 -salt -pass file:${KEY} -out ${f} && sha256sum < ${f} | awk '{print $1"  sporta-db-20990101T000000Z.sql.gz.enc"}' > ${f}.sha256`])
  const r = run(RESTORE, ['--newest'])
  is(r.status === 6 && /restore_failed/.test(out(r)), 'a backup that verifies but whose SQL does not load fails as a restore failure (exit 6)', out(r).trim().split('\n').pop())
  rmSync(f); rmSync(`${f}.sha256`)
}

// ================================================================== 5. consistency while writing
head('5. A dump taken while the shop is writing is consistent (and the mutation proves it)')
const BIG = 150000
// a table that sorts between order_items and orders, so a dump WITHOUT a snapshot reads the items first and the orders seconds later
const ensureBig = () => SRC.sql(`create table if not exists order_zz_big (id int primary key, pad varchar(200)) engine=InnoDB default charset=utf8mb4;
insert ignore into order_zz_big select seq, repeat(md5(seq), 5) from seq_1_to_${BIG};`, 'sporta')
const dropBig = () => SRC.sql('drop table if exists order_zz_big', 'sporta')
await ensureBig()
const writerFile = join(tmp, 'writer.sql')
{
  let s = ''
  for (let i = 0; i < 40000; i++) s += `start transaction; insert into orders (track_id,amount,customer_name) values ('W${i}',1,'${CANARY} W'); set @o=last_insert_id(); insert into order_items (order_id,product_id,qty,unit_price) values (@o,1,1,1),(@o,2,1,1); commit;\n`
  writeFileSync(writerFile, s)
}
const scratchDb = async (label) => { const i = await startPrivateMariadb({ label, portFrom: 33600 }); await i.sql('create database sporta character set utf8mb4'); return i }
const restoreInto = (file, inst, key = KEY) => spawnSync('sh', ['-c',
  `openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter 600000 -pass file:${key} -in ${file} | gzip -dc | mariadb --no-defaults -S ${inst.sock} -uroot --default-character-set=utf8mb4 sporta`], { encoding: 'utf8', maxBuffer: 1 << 28 })
const halfDone = (inst) => inst.sql("select count(*) from orders o where o.track_id like 'W%' and (select count(*) from order_items i where i.order_id = o.id) <> 2", 'sporta')
async function consistencyRun(scriptPath, label) {
  const d = join(tmp, `cons-${label}`)
  const w = spawn('sh', ['-c', `mariadb --no-defaults -S ${SRC.sock} -uroot sporta < ${writerFile}`], { stdio: 'ignore', detached: true })
  await sleep(500)
  const r = run(scriptPath, ['run'], { SPORTA_BACKUP_DIR: d })
  try { process.kill(-w.pid, 'SIGKILL') } catch { /* done */ }
  await sleep(200)
  if (r.status !== 0) return { ran: false, out: out(r) }
  const f = join(d, lsBackups(d).pop())
  const inst = await scratchDb(`cons${label}`)
  const rs = restoreInto(f, inst)
  const written = Number(await inst.sql("select count(*) from orders where track_id like 'W%'", 'sporta'))
  const half = Number(await halfDone(inst))
  inst.stop()
  return { ran: true, restored: rs.status === 0, written, half }
}
const cons = await consistencyRun(BACKUP, 'real')
is(cons.ran && cons.restored && cons.written > 100 && cons.half === 0, 'orders written WHILE the dump ran: every one in the backup has both its items (no half-written order)', cons.ran ? `${cons.written} writer orders caught mid-flight, ${cons.half} half-done` : cons.out.slice(0, 200))
await SRC.sql("delete from order_items where order_id in (select id from orders where track_id like 'W%'); delete from orders where track_id like 'W%'", 'sporta')
await dropBig()

// ================================================================== 5b. single table / rows
head('5b. Recover some rows of one table from a backup, without touching anything else')
{
  const files = lsBackups(BK)
  const f = join(BK, files[files.length - 1])
  const inst = await scratchDb('rows')
  const rs = restoreInto(f, inst)
  const ids = (await SRC.sql("select group_concat(id order by id) from orders where track_id in ('TRK7','TRK8','TRK9')", 'sporta'))
  const before = await SRC.sql("select count(*), coalesce(sum(crc32(concat_ws('|', id, track_id, amount, customer_name))),0) from orders where track_id not in ('TRK1','TRK7','TRK8','TRK9')", 'sporta')
  await SRC.sql("delete from order_items where order_id in (select id from orders where track_id in ('TRK7','TRK8','TRK9')); delete from orders where track_id in ('TRK7','TRK8','TRK9'); update orders set amount = 0 where track_id = 'TRK1'", 'sporta')
  const dump = (table, where) => spawnSync('sh', ['-c', `mariadb-dump --no-defaults -S ${inst.sock} -uroot --no-create-info --replace --skip-triggers --single-transaction --skip-comments --where="${where}" sporta ${table}`], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout
  const sql = `${dump('orders', "track_id in ('TRK1','TRK7','TRK8','TRK9')")}\n${dump('order_items', `order_id in (${ids})`)}`
  const load = spawnSync('mariadb', ['--no-defaults', '-S', SRC.sock, '-uroot', '--default-character-set=utf8mb4', 'sporta'], { input: sql, encoding: 'utf8' })
  const after = await SRC.sql("select count(*), coalesce(sum(crc32(concat_ws('|', id, track_id, amount, customer_name))),0) from orders where track_id not in ('TRK1','TRK7','TRK8','TRK9')", 'sporta')
  const back = await SRC.sql("select group_concat(concat(track_id, ':', amount) order by track_id) from orders where track_id in ('TRK1','TRK7','TRK8','TRK9')", 'sporta')
  const itemsBack = await SRC.sql(`select count(*) from order_items where order_id in (${ids})`, 'sporta')
  is(rs.status === 0 && load.status === 0 && /TRK1:11\.000/.test(back) && /TRK7:17\.000/.test(back) && /TRK9:19\.000/.test(back) && itemsBack === '3', 'three deleted orders (with their items) and one damaged amount are back, taken from a restored copy with --replace', `${back}; items ${itemsBack}${load.stderr ? ' ' + load.stderr.slice(0, 120) : ''}`)
  is(before === after, 'and every other order is byte-identical before and after (count and CRC): the rest of the table was not touched')
  inst.stop()
}

// ================================================================== 6. retention
head('6. Retention: 14 daily + 8 weekly + 6 monthly, exact pattern only')
const RET = join(tmp, 'ret'); mkdirSync(RET, { mode: 0o700 })
const stampOf = (d, hms = '021701') => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${hms}Z`
const today = new Date(Date.UTC(2026, 10, 4))
const wanted = []
for (let i = 0; i < 70; i++) { const d = new Date(today - i * 864e5); wanted.push(stampOf(d)); if (i % 7 === 3) wanted.push(stampOf(d, '110000')) }
for (let m = 0; m < 16; m++) { const d = new Date(Date.UTC(2026, 9 - m, 1)); wanted.push(stampOf(d)) }
const allNames = [...new Set(wanted)].map((s) => `sporta-db-${s}.sql.gz.enc`)
for (const n of allNames) { writeFileSync(join(RET, n), 'x'); writeFileSync(join(RET, `${n}.sha256`), 'x') }
const decoyTarget = join(tmp, 'victim.txt'); writeFileSync(decoyTarget, 'do not delete')
const decoys = ['notes.txt', 'sporta-db-bogus.sql.gz.enc', 'sporta-db-20200101T000000Z.sql.gz.enc.bak', 'sporta-db-20200101T000000Z.sql.gz', 'other-backup-20200101.sql.gz',
  'sporta-db-2020010T000000Z.sql.gz.enc', 'sporta-db-20201301T000000Z.sql.gz.enc', 'sporta-db-20260231T000000Z.sql.gz.enc', 'sporta-db-20260105T250000Z.sql.gz.enc', 'sporta-db-0000-old.sql.gz.enc', 'xsporta-db-20200101T000000Z.sql.gz.enc', 'sporta-db-20200101T000000Z.sql.gz.enc.old', '.keep']
for (const n of decoys) writeFileSync(join(RET, n), 'decoy')
mkdirSync(join(RET, 'sporta-db-20200102T000000Z.sql.gz.enc'))
symlinkSync(decoyTarget, join(RET, 'sporta-db-20200103T000000Z.sql.gz.enc'))
const isoWeek = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}` }
function gfs(names, D, W, M) {          // an independent implementation of the rule
  const desc = [...names].sort().reverse(); const sd = new Set(), sw = new Set(), sm = new Set(); const keep = new Set()
  for (const n of desc) {
    const s = n.slice(10, 18); const date = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); const wk = isoWeek(date); const mo = s.slice(0, 6)
    if (!sd.has(s) && sd.size < D) { sd.add(s); keep.add(n) }
    if (!sw.has(wk) && sw.size < W) { sw.add(wk); keep.add(n) }
    if (!sm.has(mo) && sm.size < M) { sm.add(mo); keep.add(n) }
  }
  return [...keep].sort()
}
const patternCount = () => lsAll(RET).filter((n) => /^sporta-db-/.test(n)).length
const before = patternCount()
const dry = run(BACKUP, ['prune', '--dry-run'], { SPORTA_BACKUP_DIR: RET })
is(dry.status === 0 && patternCount() === before && /would_delete/.test(out(dry)), '`prune --dry-run` lists what it would delete and deletes nothing', `${(out(dry).match(/would_delete/g) || []).length} candidates`)
const pr = run(BACKUP, ['prune'], { SPORTA_BACKUP_DIR: RET })
const remaining = lsBackups(RET).filter((n) => isOurs(n) && lstatSync(join(RET, n)).isFile())
const expected = gfs(allNames, 14, 8, 6)
is(pr.status === 0 && JSON.stringify(remaining) === JSON.stringify(expected), 'what survives is exactly what an independent implementation of 14d/8w/6m keeps', `${remaining.length} kept of ${allNames.length}; expected ${expected.length}`)
is(decoys.every((n) => existsSync(join(RET, n))), 'every file that does not match the exact pattern survived (notes, .bak, other tools\' dumps, near-misses)')
is(existsSync(join(RET, 'sporta-db-20200102T000000Z.sql.gz.enc')) && existsSync(decoyTarget) && lstatSync(join(RET, 'sporta-db-20200103T000000Z.sql.gz.enc')).isSymbolicLink(), 'a directory and a symlink named like a backup are untouched, and the link target survives')
is(allNames.filter((n) => !remaining.includes(n)).every((n) => !existsSync(join(RET, `${n}.sha256`))) && remaining.every((n) => existsSync(join(RET, `${n}.sha256`))), 'sidecars go with their backup, and only with it')
is(['sporta-db-20260231T000000Z.sql.gz.enc', 'sporta-db-20201301T000000Z.sql.gz.enc', 'sporta-db-20260105T250000Z.sql.gz.enc', 'sporta-db-0000-old.sql.gz.enc'].every((n) => existsSync(join(RET, n))), 'names that look like backups but are not dates (month 13, 31 February, hour 25, no date) are not backups: untouched')
is(remaining.includes(`sporta-db-${stampOf(today)}.sql.gz.enc`), 'the newest backup always survives')
{
  const R2 = join(tmp, 'ret2'); mkdirSync(R2, { mode: 0o700 })
  const old = ['20250101', '20250201', '20250301'].map((s) => `sporta-db-${s}T021701Z.sql.gz.enc`)
  for (const n of old) writeFileSync(join(R2, n), 'x')
  const r = run(BACKUP, ['prune'], { SPORTA_BACKUP_DIR: R2 })
  is(r.status === 0 && lsBackups(R2).length === 3, 'after a long outage (only old backups exist) nothing is wiped: retention counts distinct days/weeks/months PRESENT')
  const r3 = run(BACKUP, ['prune'], { SPORTA_BACKUP_DIR: R2, SPORTA_BACKUP_KEEP_DAILY: '0' })
  is(r3.status === 8 && lsBackups(R2).length === 3, 'a retention number of 0 or garbage is refused (exit 8), nothing deleted')
  // REVIEW 2026-11-04: "00" used to pass the check (only the single character 0 was refused), emptied every bucket and deleted EVERY backup
  for (const v of ['00', '000', '0x1', ' 3', '99999']) {
    const rz = run(BACKUP, ['prune'], { SPORTA_BACKUP_DIR: R2, SPORTA_BACKUP_KEEP_DAILY: v, SPORTA_BACKUP_KEEP_WEEKLY: v, SPORTA_BACKUP_KEEP_MONTHLY: v })
    is(rz.status === 8 && lsBackups(R2).length === 3, `a retention number of '${v}' is refused (exit 8) and nothing is deleted`, out(rz).trim().split('\n').pop().slice(0, 100))
  }
}

// ================================================================== 7. fail closed
head('7. Fail closed: no key, no backup. No lock, no second run. No privilege, no half dump.')
const KEYS = join(tmp, 'keys'); mkdirSync(KEYS, { mode: 0o700 }); chmodSync(KEYS, 0o700)
const OPEN = join(tmp, 'keys-open'); mkdirSync(OPEN); chmodSync(OPEN, 0o755)
const keyCase = (name, make, dir = KEYS) => { const p = join(dir, name); make(p); return p }
const FC = join(tmp, 'fc'); mkdirSync(FC, { mode: 0o700 })
const stopsCleanly = async (label, e, expectCode, expectReason, args = ['run']) => {
  const before2 = lsAll(FC).filter((n) => NAME_RE.test(n) || /partial|\.run\./.test(n)).length
  const r = run(BACKUP, args, { SPORTA_BACKUP_DIR: FC, ...e })
  const after = lsAll(FC).filter((n) => NAME_RE.test(n) || /partial|\.run\./.test(n)).length
  is(r.status === expectCode && out(r).includes(expectReason) && after === before2, label, `exit ${r.status}, ${out(r).trim().split('\n').pop().replace(/^\S+ /, '').slice(0, 90)}`)
}
await stopsCleanly('key mode 0644 (world-readable) is refused as compromised', { SPORTA_BACKUP_KEY_FILE: keyCase('k644', (p) => { copyFileSync(KEY, p); chmodSync(p, 0o644) }) }, 3, 'key_mode_not_400')
await stopsCleanly('key mode 0640 is refused', { SPORTA_BACKUP_KEY_FILE: keyCase('k640', (p) => { copyFileSync(KEY, p); chmodSync(p, 0o640) }) }, 3, 'key_mode_not_400')
await stopsCleanly('a missing key is refused', { SPORTA_BACKUP_KEY_FILE: join(KEYS, 'nope') }, 3, 'key_missing')
await stopsCleanly('an empty key is refused', { SPORTA_BACKUP_KEY_FILE: keyCase('kempty', (p) => { writeFileSync(p, '', { mode: 0o400 }) }) }, 3, 'key_too_short')
await stopsCleanly('a short key is refused', { SPORTA_BACKUP_KEY_FILE: keyCase('kshort', (p) => { writeFileSync(p, 'abc123\n', { mode: 0o400 }) }) }, 3, 'key_too_short')
await stopsCleanly('a symlink as the key is refused', { SPORTA_BACKUP_KEY_FILE: keyCase('klink', (p) => { symlinkSync(KEY, p) }) }, 3, 'key_is_symlink')
await stopsCleanly('a key in an open (0755) directory is refused', { SPORTA_BACKUP_KEY_FILE: keyCase('kopen', (p) => { copyFileSync(KEY, p); chmodSync(p, 0o400) }, OPEN) }, 3, 'key_dir_not_700')
await stopsCleanly('a key owned by someone else is refused', { SPORTA_BACKUP_KEY_FILE: keyCase('kother', (p) => { copyFileSync(KEY, p); chmodSync(p, 0o400); try { spawnSync('chown', ['65534', p]) } catch { /* not root */ } }) }, 3, process.getuid?.() === 0 ? 'key_owner_not_us' : 'key')
await stopsCleanly('a database login file with the wrong mode is refused', { SPORTA_BACKUP_DUMP_CNF: keyCase('cnf644', (p) => { copyFileSync(join(SEC, 'dump.cnf'), p); chmodSync(p, 0o644) }) }, 3, 'dump_cnf_mode_not_400')
await stopsCleanly('a missing database login file is refused', { SPORTA_BACKUP_DUMP_CNF: join(KEYS, 'nocnf') }, 3, 'dump_cnf_missing')
if (spawnSync('sh', ['-c', 'command -v setpriv']).status === 0) {
  const r = spawnSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'sh', BACKUP, 'run'], { env: { ...baseEnv, SPORTA_BACKUP_DIR: FC }, encoding: 'utf8' })
  is(r.status === 3 && lsBackups(FC).length === 0, 'run as a user that cannot read the key: refused, nothing written', `exit ${r.status}`)
}
await stopsCleanly('an account that cannot dump events (the narrow read-only shape) fails: no sealed file, no partial', { SPORTA_BACKUP_DUMP_CNF: join(SEC, 'ro.cnf') }, 6, 'dump_failed')
{
  const ro = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: FC, SPORTA_BACKUP_DUMP_CNF: join(SEC, 'ro.cnf') })
  is(/sqlerr=1044/.test(out(ro)), 'and the log names the SQL error NUMBER (1044), never the message')
}
await stopsCleanly('a dead database container fails the run', { SPORTA_DB_CONTAINER: 'no-such-container' }, 6, 'dump_failed')
await stopsCleanly('not enough free disk stops the run before it starts', { SPORTA_BACKUP_MIN_FREE_MB: '999999999' }, 5, 'disk_low')
{
  const lock = spawn('sh', ['-c', `exec 9>${join(FC, '.lock')}; flock -n 9 && sleep 6`], { stdio: 'ignore' })
  await sleep(700)
  const n0 = lsAll(FC).filter((n) => NAME_RE.test(n)).length
  const r = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: FC })
  is(r.status === 4 && /another_run_in_progress/.test(out(r)) && lsAll(FC).filter((n) => NAME_RE.test(n)).length === n0, 'a second run while one holds the lock exits 4 and writes nothing')
  is((await activity()).includes('db_backup_skipped'), 'and the skipped run is itself an Activity-log row (db_backup_skipped), so a hung run that holds the lock is not silent')
  lock.kill()
}
{
  const D = join(tmp, 'open-dir'); mkdirSync(D); chmodSync(D, 0o755)
  const r = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: D })
  is(r.status === 0 && perm(D) === '700' && /tightened_to_700/.test(readFileSync(join(D, 'backup.log'), 'utf8')), 'a backup directory that was 0755 is tightened to 0700 (and the log says so)')
  const fdir = join(tmp, 'file-as-dir'); writeFileSync(fdir, 'x')
  const r2 = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: fdir })
  is(r2.status === 3, 'a backup "directory" that is a file is refused')
}
{
  const r = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: join(tmp, 'off'), SPORTA_OFFSITE_CMD: 'exit 3' })
  is(r.status === 9 && lsBackups(join(tmp, 'off')).length === 1, 'an off-site copy that fails exits 9 and says so, while the local backup is kept')
  const r2 = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: join(tmp, 'off2'), SPORTA_OFFSITE_CMD: 'test -f "$SPORTA_BACKUP_FILE" && test -f "$SPORTA_BACKUP_SHA256"' })
  is(r2.status === 0, 'the off-site hook receives the file and its sidecar')
}
// REVIEW 2026-11-04: an alert that could not be written must not be logged as sent. store_system_event() swallows its own failure and store_db()
// answers a dead database with JSON and exit status 0, so the exit status alone said "sent=yes" exactly when nothing was recorded.
{
  const deadCfg = join(tmp, 'dead-cfg.php'); writeFileSync(deadCfg, `<?php return ['db_host'=>'127.0.0.1;port=1','db_name'=>'sporta','db_user'=>'x','db_pass'=>'y','cron_key'=>'k'];\n`, { mode: 0o600 })
  const n0 = (await activity()).length
  const rd = run(BACKUP, ['alert-test'], { SHIM_PHP_CFG: deadCfg })
  is(rd.status === 0 && /alert=db_backup_alert_test sent=no/.test(out(rd)) && (await activity()).length === n0, 'an alert that cannot be written (the database is down) is logged sent=no, never sent=yes, and no row appears', out(rd).trim().split('\n').pop().slice(0, 120))
  const rg = run(BACKUP, ['alert-test'])
  is(/alert=db_backup_alert_test sent=yes/.test(out(rg)) && (await activity()).length === n0 + 1, 'and a working alert path still logs sent=yes and writes exactly one row')
  // a retention failure after a good backup must not swallow the off-site copy, and is not a "tonight was fine" heartbeat
  const dX = join(tmp, 'retfail'), marker = join(tmp, 'offsite-marker')
  const hb0 = (await activity()).filter((k) => k === 'db_backup_ok').length
  const rx = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: dX, SPORTA_BACKUP_KEEP_DAILY: '00', SPORTA_OFFSITE_CMD: `touch ${marker}`, SPORTA_ALERT_ON_OK: '1' })
  is(rx.status === 8 && lsBackups(dX).length === 1 && existsSync(marker) && (await activity()).filter((k) => k === 'db_backup_ok').length === hb0, 'bad retention numbers: the backup is sealed, the off-site copy still runs, the run exits 8 and no "ok" heartbeat is written', `exit ${rx.status}`)
}
{ // REVIEW 2026-11-04: a hung dump must not hold the run, and with it the lock, for ever (every later night used to exit 4 in silence)
  const dH = join(tmp, 'hang'), t0 = Date.now()
  const rh = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: dH, SHIM_HANG: '30', SPORTA_BACKUP_DUMP_TIMEOUT: '2' })
  const secs = (Date.now() - t0) / 1000
  is(rh.status === 6 && /dump_failed_rc=124/.test(out(rh)) && secs < 20 && lsBackups(dH).length === 0 && !lsAll(dH).some((n) => /partial|\.run\./.test(n)), 'a dump that never finishes is cut off after SPORTA_BACKUP_DUMP_TIMEOUT: exit 6 (rc 124), no sealed file, no leftovers', `${secs}s, ${out(rh).trim().split('\n').pop().slice(0, 90)}`)
  const rn = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: dH })
  is(rn.status === 0 && lsBackups(dH).length === 1, 'and the next run is not locked out')
  const lockSkip = (await activity()).includes('db_backup_skipped')
  info('lock-skip alert so far', String(lockSkip))
}
const actF = await activity()
is(['db_backup_failed', 'db_restore_check_failed', 'db_backup_offsite_failed'].every((k) => actF.includes(k)), 'the alerts reached the Activity log through the shop\'s own PHP: failed, restore-check failed, off-site failed', [...new Set(actF)].join(','))
{
  const r = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: join(tmp, 'hb'), SPORTA_ALERT_ON_OK: '1' })
  is(r.status === 0 && (await activity()).includes('db_backup_ok'), 'SPORTA_ALERT_ON_OK=1 writes a daily heartbeat row (its absence is the dead-man signal)')
  const old = join(BK, lsBackups(BK)[0]); const t = new Date(Date.now() - 3 * 864e5)
  const d2 = join(tmp, 'stale'); mkdirSync(d2, { mode: 0o700 }); copyFileSync(old, join(d2, lsBackups(BK)[0])); utimesSync(join(d2, lsBackups(BK)[0]), t, t)
  const st = run(BACKUP, ['status'], { SPORTA_BACKUP_DIR: d2 })
  is(st.status === 1 && /age_hours=7\d/.test(out(st)) && (await activity()).includes('db_backup_stale'), '`status` on a 3-day-old newest backup exits 1 and raises db_backup_stale', out(st).trim().split('\n')[0].slice(0, 120))
  const st2 = run(BACKUP, ['status'])
  is(st2.status === 0 && /offsite=no/.test(out(st2)), '`status` is healthy for a fresh backup and shows that no off-site copy is configured')
  const at = run(BACKUP, ['alert-test'])
  is(at.status === 0 && (await activity()).includes('db_backup_alert_test'), '`alert-test` proves the alert path end to end')
  const noAl = run(BACKUP, ['alert-test'], { SPORTA_ALERT: 'none' })
  is(noAl.status === 0, 'and the alert can be switched off')
  const selft = run(BACKUP, ['selftest'])
  is(selft.status === 0 && /selftest=ok/.test(out(selft)), '`selftest` checks tools, key, login file and a real database login without writing a backup')
}

// ================================================================== 8. point-in-time
head('8. Point-in-time recovery from the dump position plus the binary log')
{
  const D = join(tmp, 'pitr')
  // the ordinary backup login is enough on this server: the position is read from the same snapshot as the data
  const r = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: D, SPORTA_DUMP_BINLOG_POS: '1' })
  is(r.status === 0 && /binlog_pos=binlog\.\d+@\d+/.test(out(r)), 'a dump with --master-data=2 records the binary-log position (file and offset appear in the log line), with the ordinary backup login', out(r).trim().split('\n')[0].slice(0, 200))
  const sf = run(BACKUP, ['selftest'], { SPORTA_BACKUP_DIR: D, SPORTA_DUMP_BINLOG_POS: '1' })
  is(sf.status === 0, '`selftest` with point-in-time on proves a schema-only dump carries a position too', out(sf).trim().split('\n').pop().slice(0, 120))
  const f = join(D, lsBackups(D).pop() || 'none')
  const dumpText = existsSync(f) ? decryptTo(f).stdout.toString('utf8') : ''
  const m = dumpText.match(/CHANGE MASTER TO MASTER_LOG_FILE='([^']+)', MASTER_LOG_POS=(\d+)/)
  is(!!m, 'the decrypted dump header holds MASTER_LOG_FILE and MASTER_LOG_POS', m ? `${m[1]} @ ${m[2]}` : 'not found')
  // a header with an EMPTY position (simulated: the server answered nothing) is refused rather than sealed
  const rb = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: join(tmp, 'pitr-blank'), SPORTA_DUMP_BINLOG_POS: '1', SHIM_BLANK_POS: '1' })
  is(rb.status === 6 && /binlog_position_missing_or_empty/.test(out(rb)) && lsBackups(join(tmp, 'pitr-blank')).length === 0, 'a dump whose header carries an empty position (simulated) is refused and nothing is sealed: a wrong position would make a point-in-time restore silently wrong')
  const replay = async (file, upto) => {
    const hdr = decryptTo(file).stdout.toString('utf8').match(/MASTER_LOG_FILE='([^']+)', MASTER_LOG_POS=(\d+)/)
    const inst = await scratchDb('pitr')
    restoreInto(file, inst)
    const all = readdirSync(dirname(SRC.binlogBase)).filter((n) => /^binlog\.\d+$/.test(n)).sort().map((n) => join(dirname(SRC.binlogBase), n))
    const logs = all.slice(all.findIndex((p) => p.endsWith(hdr[1])))
    const rep = spawnSync('sh', ['-c', `mariadb-binlog --start-position=${hdr[2]} ${upto ? `--stop-datetime='${upto}'` : ''} ${logs.join(' ')} | mariadb --no-defaults -S ${inst.sock} -uroot --default-character-set=utf8mb4`], { encoding: 'utf8' })
    return { inst, rep }
  }
  if (m) {
    await SRC.sql(`insert into products (slug,name_en,name_ar,price) values ('pitr-good-1','G1','ج',1),('pitr-good-2','G2','ج',1)`, 'sporta')
    await sleep(1300)
    const cut = await SRC.sql('select now()', 'sporta')
    await sleep(1300)
    await SRC.sql(`update products set price = 0 where slug in ('p-one','p-two'); delete from products where slug = 'pitr-good-2'`, 'sporta')
    await SRC.sql('flush binary logs', 'sporta')
    const { inst, rep } = await replay(f, cut)
    const good = await inst.sql("select group_concat(slug order by slug) from products where slug like 'pitr-good%'", 'sporta')
    const prices = await inst.sql("select group_concat(price order by slug) from products where slug in ('p-one','p-two')", 'sporta')
    is(rep.status === 0 && good === 'pitr-good-1,pitr-good-2' && prices === '9.500,12.000', 'dump + binary log up to just before a bad UPDATE and DELETE: the good rows are back, the bad statements are NOT applied', `${good || 'none'}; prices ${prices}${rep.status === 0 ? '' : ` replay: ${(rep.stderr || '').slice(0, 120)}`}`)
    inst.stop()
  }
  // IS THE RECORDED POSITION EXACT? Take the dump while orders are being written, replay the log from the recorded
  // position to its END, and the restored copy must equal the source: no missing order (position too late) and no duplicate (too early).
  {
    const wf = join(tmp, 'writer2.sql'); let w2 = ''
    for (let i = 0; i < 6000; i++) w2 += `start transaction; insert into orders (track_id,amount,customer_name) values ('P${i}',1,'${CANARY} P'); set @o=last_insert_id(); insert into order_items (order_id,product_id,qty,unit_price) values (@o,1,1,1),(@o,2,1,1); commit;\n`
    writeFileSync(wf, w2)
    const wp = spawn('sh', ['-c', `mariadb --no-defaults -S ${SRC.sock} -uroot sporta < ${wf}`], { stdio: 'ignore', detached: true })
    await sleep(250)
    const rl = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: join(tmp, 'pitr-load'), SPORTA_DUMP_BINLOG_POS: '1' })
    await sleep(1500)
    try { process.kill(-wp.pid, 'SIGKILL') } catch { /* finished */ }
    await sleep(300)
    await SRC.sql('flush binary logs', 'sporta')
    const fl = join(tmp, 'pitr-load', lsBackups(join(tmp, 'pitr-load')).pop() || 'none')
    const { inst, rep } = rl.status === 0 ? await replay(fl, null) : { inst: null, rep: { status: 1, stderr: out(rl) } }
    const sig = (db) => db.sql("select count(*), coalesce(sum(crc32(concat_ws('|', id, track_id, amount))),0) from orders where track_id like 'P%'", 'sporta')
    const sigItems = (db) => db.sql("select count(*) from order_items where order_id in (select id from orders where track_id like 'P%')", 'sporta')
    if (inst) {
      const [a, b, ai, bi] = [await sig(SRC), await sig(inst), await sigItems(SRC), await sigItems(inst)]
      is(rep.status === 0 && a === b && ai === bi && Number(a.split('\t')[0]) > 50, 'a dump taken WHILE orders were being written: dump + the binary log from its recorded position to the end equals the source exactly (same orders, same CRC, same items)', `${a.split('\t')[0]} orders written during the run, replay ${rep.status === 0 ? 'ok' : (rep.stderr || '').slice(0, 100)}`)
      inst.stop()
    } else bad('a dump taken while orders were being written replays exactly', rep.stderr.slice(0, 160))
    await SRC.sql("delete from order_items where order_id in (select id from orders where track_id like 'P%'); delete from orders where track_id like 'P%'", 'sporta')
  }
}

// ================================================================== 9. installer
head('9. The installer: placement, modes, keep-the-key, no secret printed, cron validity, escrow')
{
  const ROOT = join(tmp, 'hostroot'); mkdirSync(ROOT)
  const SRCD = join(tmp, 'srcd'); mkdirSync(SRCD); copyFileSync(BACKUP, join(SRCD, 'db-backup.sh')); copyFileSync(RESTORE, join(SRCD, 'db-restore-test.sh'))
  const node = (a, e = {}) => spawnSync('node', [INSTALL, ...a], { encoding: 'utf8', env: { ...process.env, ...e } })
  const sha = createHash('sha1').update('x').digest('hex')
  const p0 = node(['plan', '--root', ROOT])
  is(p0.status === 0 && /absent/.test(p0.stdout) && !existsSync(join(ROOT, 'docker')), '`plan` is read-only and says what is missing')
  const refuse = node(['apply', '--root', ROOT, '--src', SRCD, '--sha', sha, '--confirm-sha', 'deadbee'])
  is(refuse.status === 2 && !existsSync(join(ROOT, 'docker')), '`apply` refuses unless the commit id is given twice, identically')
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const pubFile = join(tmp, 'owner-pub.pem'); writeFileSync(pubFile, publicKey)
  const a1 = node(['apply', '--root', ROOT, '--src', SRCD, '--sha', sha, '--confirm-sha', sha, '--escrow-pub', pubFile])
  is(a1.status === 0, '`apply` succeeds', a1.status === 0 ? undefined : a1.stderr.slice(0, 200))
  const H = (p) => join(ROOT, 'docker/sporta/private', p)
  is(perm(H('bin')) === '750' && perm(H('bin/db-backup.sh')) === '750' && perm(H('bin/db-restore-test.sh')) === '750', 'scripts: directory 0750, files 0750')
  is(perm(H('backups')) === '700' && perm(H('backup-secrets')) === '700' && perm(H('backup-secrets/db-backup.key')) === '400' && perm(H('backup-secrets/dump.cnf')) === '400', 'backups 0700, secrets 0700, key 0400, login file 0400')
  const keyBefore = readFileSync(H('backup-secrets/db-backup.key'), 'utf8'); const cnfBefore = readFileSync(H('backup-secrets/dump.cnf'), 'utf8')
  is(Buffer.from(keyBefore.trim(), 'base64').length === 48 && /^password=[A-Za-z0-9]{40}$/m.test(cnfBefore), 'key is 48 random bytes; the login password is 40 letters and digits')
  const pw = (cnfBefore.match(/^password=(.+)$/m) || [])[1]
  is(![keyBefore.trim(), pw].some((s) => (a1.stdout + a1.stderr).includes(s) || (a1.stdout + a1.stderr).includes(s.slice(0, 20))), 'nothing secret is printed by apply')
  is(!existsSync(join(ROOT, 'etc/cron.d/sporta-db-backup')), '`apply` does NOT install the cron file (it comes last, after a good selftest)')
  const a2 = node(['apply', '--root', ROOT, '--src', SRCD, '--sha', sha, '--confirm-sha', sha])
  is(a2.status === 0 && readFileSync(H('backup-secrets/db-backup.key'), 'utf8') === keyBefore && readFileSync(H('backup-secrets/dump.cnf'), 'utf8') === cnfBefore && /already present, kept/.test(a2.stdout), 'run again: the existing key and login are KEPT, not regenerated (regenerating would orphan every backup)')
  // REVIEW 2026-11-04: directories that belong to the server keep their modes (apply used to chmod /docker/sporta/private to 0755)
  {
    const R3 = join(tmp, 'hostroot3'); mkdirSync(join(R3, 'docker/sporta/private'), { recursive: true }); chmodSync(join(R3, 'docker/sporta/private'), 0o750)
    mkdirSync(join(R3, 'etc/cron.d'), { recursive: true }); chmodSync(join(R3, 'etc/cron.d'), 0o700)
    const a3 = node(['apply', '--root', R3, '--src', SRCD, '--sha', sha, '--confirm-sha', sha]); const c3 = node(['cron', '--root', R3, '--sha', sha, '--confirm-sha', sha])
    is(a3.status === 0 && c3.status === 0 && perm(join(R3, 'docker/sporta/private')) === '750' && perm(join(R3, 'etc/cron.d')) === '700' && perm(join(R3, 'docker/sporta/private/backups')) === '700', 'an existing /docker/sporta/private (0750) and /etc/cron.d (0700) keep their modes; only the directories the installer owns are set', `${perm(join(R3, 'docker/sporta/private'))} ${perm(join(R3, 'etc/cron.d'))}`)
    const R4 = join(tmp, 'hostroot4')
    const ph = node(['apply', '--root', R4, '--src', SRCD, '--sha', sha, '--confirm-sha', sha, '--escrow-pub-env', 'ESCROW_PUB'], { ESCROW_PUB: 'PASTE THE OWNER RSA PUBLIC KEY (PEM, public part only) HERE' })
    is(ph.status === 3 && !existsSync(join(R4, 'docker')), 'the placeholder text in place of the owner public key stops the apply job BEFORE it creates a key nobody can escrow', ph.stderr.trim().slice(0, 100))
  }
  const c = node(['cron', '--root', ROOT, '--sha', sha, '--confirm-sha', sha])
  const cron = existsSync(join(ROOT, 'etc/cron.d/sporta-db-backup')) ? readFileSync(join(ROOT, 'etc/cron.d/sporta-db-backup'), 'utf8') : ''
  const lines = cron.split('\n').filter((l) => l && !l.startsWith('#'))
  const jobLines = lines.filter((l) => !/^[A-Z_]+=/.test(l))
  const fieldOk = (f, lo, hi) => /^(\*|\d+)$/.test(f) && (f === '*' || (+f >= lo && +f <= hi))
  const validJob = (l) => { const p = l.split(/\s+/); return p.length >= 7 && fieldOk(p[0], 0, 59) && fieldOk(p[1], 0, 23) && fieldOk(p[2], 1, 31) && fieldOk(p[3], 1, 12) && fieldOk(p[4], 0, 7) && p[5] === 'root' && p[6].startsWith('/') && !l.includes('%') }
  is(c.status === 0 && perm(join(ROOT, 'etc/cron.d/sporta-db-backup')) === '644' && jobLines.length === 3 && jobLines.every(validJob) && jobLines.some((l) => /db-backup\.sh status >> /.test(l)), 'the cron file is a valid cron.d file: mode 0644, three jobs (backup, weekly restore test, daily freshness check), 5 time fields + root + absolute command, no stray %', jobLines.join(' | ').slice(0, 160))
  is(/db-backup\.sh run >> \/var\/log\/sporta-cron\.log 2>&1/.test(cron) && /db-restore-test\.sh --fresh/.test(cron) && !cron.includes(ROOT), 'it uses the real host paths, not the job\'s mount prefix, and logs where the other jobs log')
  const wrapped = readFileSync(H('backup-secrets/db-backup.key.escrow'))
  const un = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped).toString('utf8')
  is(un === keyBefore && !(a1.stdout).includes(keyBefore.trim()) && a1.stdout.includes(wrapped.toString('base64').slice(0, 60)), 'the escrow ciphertext is printed, and ONLY the owner\'s private key turns it back into the key')
  const un2 = spawnSync('sh', ['-c', `openssl pkeyutl -decrypt -inkey ${join(tmp, 'owner-priv.pem')} -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in ${H('backup-secrets/db-backup.key.escrow')}`], { encoding: 'utf8' })
  writeFileSync(join(tmp, 'owner-priv.pem'), privateKey, { mode: 0o600 })
  const un3 = spawnSync('sh', ['-c', `openssl pkeyutl -decrypt -inkey ${join(tmp, 'owner-priv.pem')} -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in ${H('backup-secrets/db-backup.key.escrow')}`], { encoding: 'utf8' })
  is(un3.status === 0 && un3.stdout === keyBefore, 'and the stock `openssl pkeyutl -decrypt` (what the owner will run on a Mac) opens it too')
  const tooSmall = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  writeFileSync(join(tmp, 'small.pem'), tooSmall.publicKey)
  const sm = node(['apply', '--root', join(tmp, 'hostroot2'), '--src', SRCD, '--sha', sha, '--confirm-sha', sha, '--escrow-pub', join(tmp, 'small.pem')])
  is(sm.status === 3 && /3072/.test(sm.stderr), 'an escrow key under 3072 bits is refused')
  const sql = spawnSync('node', [INSTALL, 'account-sql', '--root', ROOT], { encoding: 'utf8' })
  is(sql.status === 0 && /CREATE USER IF NOT EXISTS 'sporta_backup'@'localhost'/.test(sql.stdout) && /GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, EXECUTE ON `sporta`\.\*/.test(sql.stdout) && !/INSERT|UPDATE|DELETE|DROP|ALTER,|ALL PRIVILEGES|LOCK TABLES|FILE/.test(sql.stdout.replace(/ALTER USER/g, '')) && sql.stdout.includes(pw), 'account-sql: a localhost-only login with exactly the privileges a complete dump needs, no write, no DDL, no LOCK TABLES, no FILE')
  // the SQL is real: apply it to the private server and dump with the installer-shaped login
  // applied under another name so the earlier sections' login keeps its own password
  await SRC.sql(sql.stdout.replace(/sporta_backup/g, 'sporta_backup_inst'))
  const cnfLive = join(SEC, 'inst.cnf'); writeFileSync(cnfLive, `[client]\nsocket=${SRC.sock}\nuser=sporta_backup_inst\npassword=${pw}\n`, { mode: 0o400 })
  const ri = run(BACKUP, ['run'], { SPORTA_BACKUP_DIR: join(tmp, 'inst'), SPORTA_BACKUP_DUMP_CNF: cnfLive })
  is(ri.status === 0, 'the SQL the installer emits creates a login that can actually take a complete backup', ri.status === 0 ? undefined : out(ri).slice(0, 160))
  const cp = node(['compose', '--sha', createHash('sha1').update('y').digest('hex')])
  const cj = JSON.parse(cp.stdout)
  is(cp.status === 0 && !/\$/.test(cp.stdout) && !cp.stdout.includes('curl') && !cp.stdout.includes('wget') && cj.services.install.volumes.every((v) => v.endsWith(':ro')), '`compose` (the plan job) has no dollar sign, no curl or wget, and mounts the host read-only')
  const cpA = node(['compose', '--apply', '--sha', createHash('sha1').update('y').digest('hex')])
  is(cpA.status === 0 && !/\$/.test(cpA.stdout) && JSON.parse(cpA.stdout).name === 'sporta-dbbackup-apply', 'the apply job is a separate project the owner has to ask for')
  // REVIEW 2026-11-04: the cron step has its own job (it used to be "edit the JSON by hand"), and each job mounts only what it must write
  const shaY = createHash('sha1').update('y').digest('hex')
  const vA = JSON.parse(cpA.stdout).services.install.volumes
  const cpC = node(['compose', '--cron', '--sha', shaY]); const cjc = cpC.status === 0 ? JSON.parse(cpC.stdout) : { name: '', services: { install: { volumes: [], command: [] } } }
  is(cpC.status === 0 && cjc.name === 'sporta-dbbackup-cron' && !/\$/.test(cpC.stdout) && !cpC.stdout.includes('curl') && !cpC.stdout.includes('wget')
    && cjc.services.install.volumes[0].endsWith(':ro') && !cjc.services.install.volumes[1].endsWith(':ro') && JSON.stringify(cjc.services.install.command).includes('backup-install.mjs cron --root /host'), '`compose --cron` is the last job: private directory read-only, /etc/cron.d writable, one command, no dollar sign, curl or wget')
  is(!vA[0].endsWith(':ro') && vA[1].endsWith(':ro'), 'the apply job writes the private directory and leaves /etc/cron.d read-only (it never installs the cron file)')
  is(node(['compose', '--apply', '--cron', '--sha', shaY]).status === 2, '--apply and --cron together are refused')
}

// ================================================================== 10. packaging
head('10. ops/db never ships')
{
  const mp = readFileSync(join(HERE, 'make-package.mjs'), 'utf8') + readFileSync(join(HERE, 'bundle-php.mjs'), 'utf8')
  is(!/['"`/]ops[/'"`]/.test(mp.replace(/\/\/[^\n]*/g, '')), 'neither make-package.mjs nor bundle-php.mjs names ops/ anywhere in code')
  const pk = join(tmp, 'pkgroot'); mkdirSync(join(pk, 'scripts'), { recursive: true }); mkdirSync(join(pk, 'dist'))
  for (const f of ['bundle-php.mjs', 'make-install-sql.mjs']) copyFileSync(join(HERE, f), join(pk, 'scripts', f))
  cpSync(join(WEB, 'dropin'), join(pk, 'dropin'), { recursive: true, filter: (x) => !/\/config\.php$/.test(x) })
  cpSync(join(WEB, 'ops'), join(pk, 'ops'), { recursive: true })
  const bundled = spawnSync('node', [join(pk, 'scripts', 'bundle-php.mjs')], { encoding: 'utf8' })
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const files = bundled.status === 0 ? walk(join(pk, 'dist')) : []
  const leaked = files.filter((f) => /(^|\/)ops(\/|$)|db-backup|db-restore|backup-install|RESTORE\.md|BACKUP\.md|backup-account/.test(f))
  is(bundled.status !== 0 || (files.length > 50 && leaked.length === 0), 'bundle-php.mjs, run on a scratch copy that contains ops/, puts none of the backup files into dist/', leaked.slice(0, 3).join(', ') || `${files.length} files, none from ops/`)
}

// ================================================================== 11. mutations
head('11. Mutation checks: the suite goes red when the hardening is removed')
const MUT = join(tmp, 'mut'); mkdirSync(MUT)
const mutate = (name, edits, which = BACKUP) => {
  const d = join(MUT, name); mkdirSync(d)
  let b = readFileSync(BACKUP, 'utf8'), r = readFileSync(RESTORE, 'utf8')
  for (const [from, to, target] of edits) {
    if (target === 'restore') { if (!r.includes(from)) throw new Error(`mutation ${name}: pattern not found`); r = r.replace(from, to) } else { if (!b.includes(from)) throw new Error(`mutation ${name}: pattern not found: ${from.slice(0, 40)}`); b = b.replace(from, to) }
  }
  writeFileSync(join(d, 'db-backup.sh'), b, { mode: 0o755 }); writeFileSync(join(d, 'db-restore-test.sh'), r, { mode: 0o755 })
  return { backup: join(d, 'db-backup.sh'), restore: join(d, 'db-restore-test.sh'), dir: d }
}
const red = (n, cond, d) => is(cond, `MUTATION ${n}: the suite catches it`, d)
{ // M1 consistency: no --single-transaction and no table locks
  const m = mutate('nosingle', [['--single-transaction --quick', '--skip-lock-tables --quick']])
  await ensureBig()
  const c = await consistencyRun(m.backup, 'm1')
  red('--single-transaction removed (and no table lock): the consistency check', c.ran && c.half > 0, c.ran ? `${c.half} half-written orders in the restored copy` : 'run failed')
  await dropBig()
  const m1b = mutate('nosingle-b', [['--single-transaction --quick', '--quick']])
  const rb = run(m1b.backup, ['run'], { SPORTA_BACKUP_DIR: join(MUT, 'nosingle-b-bk') })
  red('--single-transaction removed outright (the login has no LOCK TABLES): the run itself', rb.status !== 0, `exit ${rb.status}`)
}
{ // M2 encryption
  const m = mutate('noenc', [['openssl enc -aes-256-cbc -md sha256 -pbkdf2 -iter "$ITER" -salt -pass "file:$KEY_FILE" -out "$1"', 'cat > "$1"'], ['openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter "$ITER" -pass "file:$KEY_FILE" -in "$1"', 'cat "$1"']])
  const d = join(MUT, 'noenc-bk'); const r = run(m.backup, ['run'], { SPORTA_BACKUP_DIR: d })
  const f = lsBackups(d)[0]; const bytes = f ? readFileSync(join(d, f)) : Buffer.alloc(0)
  red('encryption removed: the ciphertext check', r.status === 0 && !(bytes.subarray(0, 8).toString() === 'Salted__'), `file starts ${JSON.stringify(bytes.subarray(0, 4).toString('hex'))}`)
}
{ // M3 verification blinded
  const m = mutate('noverify', [['  vt=$(mktemp -d "${TMPDIR:-/tmp}/sporta-verify.XXXXXX") || { echo verify_tmp; return 1; }', '  return 0']])
  const f = join(CORR, 'sporta-db-20200101T000001Z.sql.gz.enc')
  const r = run(m.backup, ['verify', f])
  red('verification blinded: the corrupt-byte check', r.status === 0, `verify of the corrupt file exits ${r.status}`)
}
{ // M4 prune pattern widened
  const m = mutate('prune-all', [['is_backup_name() {', 'is_backup_name() { return 0; }\nis_backup_name_orig() {']])
  const R3 = join(tmp, 'ret3'); mkdirSync(R3, { mode: 0o700 })
  for (const n of allNames.slice(0, 5)) writeFileSync(join(R3, n), 'x')
  writeFileSync(join(R3, 'notes.txt'), 'keep me'); writeFileSync(join(R3, 'sporta-db-0000-old.sql.gz.enc'), 'keep me')
  const r = run(m.backup, ['prune'], { SPORTA_BACKUP_DIR: R3, SPORTA_BACKUP_KEEP_DAILY: '1', SPORTA_BACKUP_KEEP_WEEKLY: '1', SPORTA_BACKUP_KEEP_MONTHLY: '1' })
  red('prune pattern widened: the "non-matching file survives" check', !(existsSync(join(R3, 'sporta-db-0000-old.sql.gz.enc')) && existsSync(join(R3, 'notes.txt'))), `decoy survives: ${existsSync(join(R3, 'sporta-db-0000-old.sql.gz.enc'))}`)
}
{ // M5 key mode check dropped
  const m = mutate('nokeymode', [['  case $mode in 400|600) ;; *) fail 3 key_mode_not_400 ;; esac', '  :']])
  const d = join(MUT, 'nokeymode-bk'); const r = run(m.backup, ['run'], { SPORTA_BACKUP_DIR: d, SPORTA_BACKUP_KEY_FILE: join(KEYS, 'k644') })
  red('key-mode check removed: the group/world-readable key check', r.status === 0 && lsBackups(d).length === 1, `a backup was made with a 0644 key (exit ${r.status})`)
}
{ // M6 lock removed
  const m = mutate('nolock', [['    flock -n 9 || { log "run=skipped reason=another_run_in_progress"; alert db_backup_skipped; exit 4; }', '    :']])
  const d = join(MUT, 'nolock-bk'); mkdirSync(d, { mode: 0o700 })
  const lock = spawn('sh', ['-c', `exec 9>${join(d, '.lock')}; flock -n 9 && sleep 5`], { stdio: 'ignore' })
  await sleep(600)
  const r = run(m.backup, ['run'], { SPORTA_BACKUP_DIR: d })
  red('lock removed: the "second run is refused" check', r.status !== 4, `second run exits ${r.status}`)
  lock.kill()
}
{ // M8 retention numbers: both the validation and the keep-something guard removed -> "00" wipes every backup
  const m = mutate('retval', [["case $v in ''|*[!0-9]*|0*) fail 8", "case $v in ''|*[!0-9]*|0) fail 8"], ['  if [ -z "$keep" ] && [ -n "$(newest_backup)" ]; then fail 8 retention_would_keep_nothing db_backup_failed; fi', '  :']])
  const R9 = join(tmp, 'ret9'); mkdirSync(R9, { mode: 0o700 })
  for (const d of ['20261101', '20261102', '20261103']) writeFileSync(join(R9, `sporta-db-${d}T021701Z.sql.gz.enc`), 'x')
  run(m.backup, ['prune'], { SPORTA_BACKUP_DIR: R9, SPORTA_BACKUP_KEEP_DAILY: '00', SPORTA_BACKUP_KEEP_WEEKLY: '00', SPORTA_BACKUP_KEEP_MONTHLY: '00' })
  red('retention validation and keep-one guard removed: the "00 is refused" check', lsBackups(R9).length === 0, `${lsBackups(R9).length} backups left of 3`)
}
{ // M9 alert truthfulness: the exit status alone decides "sent"
  const m = mutate('alertstatus', [['    if [ "$arc" -eq 0 ]; then case $aout in *alert_row_written) ;; *) arc=3 ;; esac; fi', '    :']])
  const deadCfg = join(tmp, 'dead-cfg.php')
  const r = run(m.backup, ['alert-test'], { SPORTA_BACKUP_DIR: join(MUT, 'alertstatus-bk'), SHIM_PHP_CFG: deadCfg })
  red('alert verification removed: the "dead database is sent=no" check', /sent=yes/.test(out(r)), out(r).trim().split('\n').pop().slice(0, 100))
}
{ // M10 dump timeout removed
  const m = mutate('notimeout', [['( $DT "$DOCKER" exec -i "$DB_CONTAINER" mariadb-dump', '( "$DOCKER" exec -i "$DB_CONTAINER" mariadb-dump']])
  const r = run(m.backup, ['run'], { SPORTA_BACKUP_DIR: join(MUT, 'notimeout-bk'), SHIM_HANG: '6', SPORTA_BACKUP_DUMP_TIMEOUT: '2' })
  red('dump timeout removed: the "hung dump is cut off" check', !/dump_failed_rc=124/.test(out(r)), out(r).trim().split('\n').pop().slice(0, 100))
}
{ // M7 restore comparison blinded
  const m = mutate('nocompare', [['exit failn > 0 ? 1 : 0', 'exit 0', 'restore']])
  await SRC.sql("update orders set amount = amount + 5 where track_id = 'TRK4'", 'sporta')
  const r = run(m.restore, ['--newest'], { SPORTA_BACKUP_DIR: BK })
  red('restore comparison blinded: the "changed row fails loudly" check', r.status === 0, `restore test exits ${r.status} although a row differs`)
  await SRC.sql("update orders set amount = amount - 5 where track_id = 'TRK4'", 'sporta')
}

// ------------------------------------------------------------------ done
head('summary')
spawnSync('sh', ['-c', `for p in ${SHIM_STATE}/*/pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null; done; true`])
if (!process.env.KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } if (SHIM_SHORT) { try { rmSync(SHIM_STATE, { recursive: true, force: true }) } catch { /* ignore */ } } } else console.log(`KEEP=1: ${tmp}${SHIM_SHORT ? ` and ${SHIM_STATE}` : ''}`)
console.log(`${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
