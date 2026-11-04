#!/usr/bin/env node
// backup-install.mjs - puts the database backup on the VPS. Runs INSIDE a one-shot job, never by itself.
//
//   node backup-install.mjs plan    [--root /host]              read-only: what apply would do
//   node backup-install.mjs apply   [--root /host] --src DIR --sha SHA --confirm-sha SHA [--escrow-pub PEM]
//   node backup-install.mjs cron    [--root /host] --sha SHA --confirm-sha SHA      installs the cron file LAST, after a good selftest
//   node backup-install.mjs account-sql [--cnf FILE] [--db sporta] [--pitr]
//                                    SQL for the backup login; the password is read from the cnf. Refuses a terminal.
//   node backup-install.mjs compose --sha SHA [--apply | --cron]  the job's compose document, as JSON (plan by default; --apply for the
//                                    writing job; --cron for the last job, which installs the cron file after a good selftest)
//
// STATUS: built and proven against a temporary root directory (npm run test:db-backup). NOT run on the
// live server. A live run needs the owner's go, the Hostinger connector, and goes through the project's
// job route (a compose project on VM 2058651). Never SSH, never a PHP endpoint, never CI.
//
// WHAT `apply` DOES (every step idempotent; run it twice and nothing changes the second time)
//   1. /docker/sporta/private/bin/                 0750 root   db-backup.sh, db-restore-test.sh (0750)
//   2. /docker/sporta/private/backups/             0700 root   the encrypted dumps (created empty)
//   3. /docker/sporta/private/backup-secrets/      0700 root   db-backup.key (0400, 48 random bytes, base64)
//                                                              dump.cnf     (0400, the backup login)
//      A key or cnf that already exists is KEPT, never regenerated: regenerating a key would orphan
//      every backup made with the old one.
//   4. `cron` (a second command, run only after selftest and one manual run are green):
//      /etc/cron.d/sporta-db-backup                0644 root   three lines (see CRON below). A separate file on
//      purpose: cron ignores a WHOLE cron.d file that has one bad line, and /etc/cron.d/sporta-cron holds
//      the stock, fulfilment, voice and birthday jobs. An install must not be able to stop those.
//   5. With --escrow-pub: the key wrapped to the owner's RSA PUBLIC key (OAEP-SHA256) and printed as base64.
//      Ciphertext only: safe in a job log. Only the owner's private key opens it. This is the off-server
//      copy of the key; without one, losing this server loses every backup.
//   Nothing secret is ever printed. The job prints paths, modes and sha256 of the two scripts.
//
// `--root` is a prefix for FILE ACCESS only (the job mounts the host's /docker/sporta/private and
// /etc/cron.d under /host); every path written INTO a file (the cron lines) is the real host path.
import { constants, createHash, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HOST = {
  private: '/docker/sporta/private',
  bin: '/docker/sporta/private/bin',
  backups: '/docker/sporta/private/backups',
  secrets: '/docker/sporta/private/backup-secrets',
  cron: '/etc/cron.d/sporta-db-backup',
  log: '/var/log/sporta-cron.log',
}
export const CRON = (h = HOST) => [
  '# Sporta database backup. Installed by ops/db/backup-install.mjs (see ops/db/BACKUP.md).',
  '# Remove this file to stop it. It is separate from sporta-cron on purpose: cron drops a whole file for one bad line.',
  'SHELL=/bin/sh',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'SPORTA_ALERT_ON_OK=1',
  `17 2 * * * root ${h.bin}/db-backup.sh run >> ${h.log} 2>&1`,
  `47 3 * * 0 root ${h.bin}/db-restore-test.sh --fresh >> ${h.log} 2>&1`,
  // The only thing that notices a night that never ran (a hung or skipped run writes no heartbeat): `status` raises
  // db_backup_stale when the newest backup is older than 36 hours.
  `47 8 * * * root ${h.bin}/db-backup.sh status >> ${h.log} 2>&1`,
  '',
].join('\n')

const args = process.argv.slice(2)
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'plan'
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d }
const flag = (n) => args.includes(`--${n}`)
const ROOT = (opt('root', '') || '').replace(/\/$/, '')
const P = (p) => `${ROOT}${p}`
const say = (s) => console.log(s)
const die = (m, c = 3) => { console.error(`backup-install: ${m}`); process.exit(c) }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const modeOf = (p) => (statSync(p).mode & 0o777).toString(8).padStart(3, '0')

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function newPassword(n = 40) {
  // rejection sampling: no modulo bias
  let out = ''
  while (out.length < n) for (const b of randomBytes(64)) { if (b < 248 && out.length < n) out += B62[b % 62] }
  return out
}

// ensureDir: a directory THIS INSTALLER OWNS (bin, backups, backup-secrets): created, and forced to `mode`.
// createOnly: a directory that belongs to the server (/docker/sporta/private, /etc/cron.d): created if missing (a temporary
// root), but an existing one is NEVER chmod-ed. Reviewed 2026-11-04: apply used to set an existing private/ to 0755 (it may
// be stricter) and /etc/cron.d to 0755, which in a hardening job is a regression, not a no-op.
function ensureDir(p, mode, { createOnly = false } = {}) {
  const existed = existsSync(p)
  if (!existed) mkdirSync(p, { recursive: true, mode })
  if (lstatSync(p).isSymbolicLink()) die(`${p} is a symlink`)
  if (!(createOnly && existed)) chmodSync(p, mode)
}

function plan() {
  const rows = []
  const st = (label, p, want) => {
    if (!existsSync(P(p))) rows.push([label, p, 'absent', `would create ${want}`])
    else { const m = modeOf(P(p)); rows.push([label, p, m, m === want.replace(/^.*(\d{3})$/, '$1') ? 'ok' : `would set ${want}`]) }
  }
  st('scripts dir', HOST.bin, '750'); st('backups dir', HOST.backups, '700'); st('secrets dir', HOST.secrets, '700')
  st('encryption key', `${HOST.secrets}/db-backup.key`, '400'); st('backup login', `${HOST.secrets}/dump.cnf`, '400')
  st('db-backup.sh', `${HOST.bin}/db-backup.sh`, '750'); st('db-restore-test.sh', `${HOST.bin}/db-restore-test.sh`, '750')
  st('cron file', HOST.cron, '644')
  for (const r of rows) say(`${r[0].padEnd(20)} ${r[1].padEnd(52)} ${String(r[2]).padEnd(7)} ${r[3]}`)
  say('\nnothing was changed (plan is read-only). To apply: apply --src DIR --sha <40 hex> --confirm-sha <the same 40 hex>')
}

function apply() {
  const sha = String(opt('sha', '')), confirm = String(opt('confirm-sha', ''))
  if (!/^[0-9a-f]{7,40}$/.test(sha) || sha !== confirm) die('apply needs --sha and --confirm-sha, the same commit id twice (7 to 40 hex characters)', 2)
  const src = opt('src'); if (!src || src === true) die('apply needs --src DIR holding db-backup.sh and db-restore-test.sh', 2)
  for (const f of ['db-backup.sh', 'db-restore-test.sh']) if (!existsSync(join(src, f))) die(`${join(src, f)} not found`, 2)

  // The escrow key is checked FIRST: a bad or placeholder key must stop the job before it creates a key nobody can escrow.
  let escrowKey = null
  {
    const pub = opt('escrow-pub'), pubEnv = opt('escrow-pub-env')
    let pubPem = null
    if (pub && pub !== true) pubPem = readFileSync(pub, 'utf8')
    else if (pubEnv && pubEnv !== true) pubPem = process.env[pubEnv] || null
    if (pubPem) {
      try { escrowKey = createPublicKey(pubPem) } catch { die('the escrow key is not a PEM public key (nothing was created)') }
      if (escrowKey.asymmetricKeyType !== 'rsa' || (escrowKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) die('the escrow key must be an RSA public key of 3072 bits or more (nothing was created)')
    }
  }
  ensureDir(P(HOST.private), 0o755, { createOnly: true }) // exists already on the VPS (never chmod-ed); only created in a temporary root
  ensureDir(P(HOST.bin), 0o750); ensureDir(P(HOST.backups), 0o700); ensureDir(P(HOST.secrets), 0o700)
  for (const f of ['db-backup.sh', 'db-restore-test.sh']) {
    const dst = P(`${HOST.bin}/${f}`)
    writeFileSync(dst, readFileSync(join(src, f)), { mode: 0o750 }); chmodSync(dst, 0o750)
    say(`placed ${HOST.bin}/${f} mode 750 sha256 ${sha256(readFileSync(dst))}`)
  }
  // The key: created once, never overwritten.
  const keyPath = P(`${HOST.secrets}/db-backup.key`)
  if (existsSync(keyPath)) { chmodSync(keyPath, 0o400); say('key: already present, kept (mode 400)') } else {
    writeFileSync(keyPath, `${randomBytes(48).toString('base64')}\n`, { mode: 0o400, flag: 'wx' }); chmodSync(keyPath, 0o400)
    say('key: created (mode 400, 48 random bytes). It is not printed. Escrow it: see --escrow-pub')
  }
  // The backup login: created once. The password is only ever in this file.
  const cnfPath = P(`${HOST.secrets}/dump.cnf`)
  if (existsSync(cnfPath)) { chmodSync(cnfPath, 0o400); say('dump.cnf: already present, kept (mode 400)') } else {
    writeFileSync(cnfPath, `[client]\nhost=localhost\nuser=sporta_backup\npassword=${newPassword()}\n`, { mode: 0o400, flag: 'wx' }); chmodSync(cnfPath, 0o400)
    say('dump.cnf: created (mode 400). Create the matching database login next: account-sql | admin client')
  }
  // escrow: the key wrapped to the owner's RSA PUBLIC key. Node's crypto, so the job image needs no openssl binary.
  if (escrowKey) {
    let wrapped
    try { wrapped = publicEncrypt({ key: escrowKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, readFileSync(keyPath)) } catch { die('could not wrap the key with that public key') }
    writeFileSync(P(`${HOST.secrets}/db-backup.key.escrow`), wrapped, { mode: 0o600 })
    say('key escrow (base64 of the RSA-OAEP-SHA256 ciphertext; only the owner\'s private key opens it):')
    say(wrapped.toString('base64').replace(/(.{76})/g, '$1\n'))
  } else say('key escrow: NOT done (pass --escrow-pub FILE or --escrow-pub-env NAME with the owner RSA public key). Without an off-server copy of the key, losing this server loses every backup.')
  say('apply: done. The cron file is NOT installed yet. Next: create the database login (account-sql), db-backup.sh selftest, db-backup.sh run, db-restore-test.sh --fresh, then `cron`.')
}

function installCron() {
  const sha = String(opt('sha', '')), confirm = String(opt('confirm-sha', ''))
  if (!/^[0-9a-f]{7,40}$/.test(sha) || sha !== confirm) die('cron needs --sha and --confirm-sha, the same commit id twice', 2)
  for (const f of ['db-backup.sh', 'db-restore-test.sh', 'dump.cnf']) {
    const p = f === 'dump.cnf' ? P(`${HOST.secrets}/${f}`) : P(`${HOST.bin}/${f}`)
    if (!existsSync(p)) die(`${p} is missing: run apply first`)
  }
  ensureDir(dirname(P(HOST.cron)), 0o755, { createOnly: true })
  writeFileSync(P(HOST.cron), CRON(), { mode: 0o644 }); chmodSync(P(HOST.cron), 0o644)
  say(`cron: ${HOST.cron} mode 644 (daily 02:17 UTC backup, daily 08:47 UTC freshness check, Sunday 03:47 UTC restore test)`)
}

function accountSql() {
  if (process.stdout.isTTY) die('refusing to print a password to a terminal: pipe this into the database client')
  const cnf = opt('cnf', P(`${HOST.secrets}/dump.cnf`))
  const text = readFileSync(cnf, 'utf8')
  const pw = (text.match(/^password=(.+)$/m) || [])[1]
  if (!pw || !/^[A-Za-z0-9]{32,}$/.test(pw)) die('the cnf has no usable password (32+ letters and digits)')
  const db = String(opt('db', 'sporta')); if (!/^[A-Za-z0-9_]{1,64}$/.test(db)) die('bad database name', 2)
  const rp = String(opt('routines-priv', 'auto'))
  if (!['auto', 'show-create-routine', 'mysql-proc'].includes(rp)) die('--routines-priv is auto, show-create-routine or mysql-proc', 2)
  const who = "'sporta_backup'@'localhost'"
  const lines = [
    `CREATE USER IF NOT EXISTS ${who} IDENTIFIED BY '${pw}' WITH MAX_USER_CONNECTIONS 2;`,
    `ALTER USER ${who} IDENTIFIED BY '${pw}' WITH MAX_USER_CONNECTIONS 2;`,
    // everything mariadb-dump needs to write a COMPLETE logical dump (--routines --events --triggers):
    // read the data, see views, triggers, events and routines. No INSERT/UPDATE/DELETE, no CREATE/ALTER/DROP, no LOCK TABLES.
    // (TRIGGER and EVENT are what MariaDB requires to SEE those objects; they also permit creating them. See BACKUP.md section 1.)
    `GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, EXECUTE ON \`${db}\`.* TO ${who};`,
  ]
  // Reading a routine's source (SHOW CREATE FUNCTION/PROCEDURE) by an account that did not define it needs
  // SELECT on mysql.proc up to MariaDB 10.11 and the SHOW CREATE ROUTINE privilege from 11.3. Without it
  // mariadb-dump stops with "insufficient privileges" (measured on 10.11). `auto` chooses by server version;
  // the 11.x branch could not be run on the build machine (10.11): `db-backup.sh selftest` proves it on the live server.
  if (rp === 'mysql-proc') lines.push(`GRANT SELECT ON mysql.proc TO ${who};`)
  else if (rp === 'show-create-routine') lines.push(`GRANT SHOW CREATE ROUTINE ON \`${db}\`.* TO ${who};`)
  else lines.push(
    "SET @sporta_v = CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) * 100 + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED);",
    `SET @sporta_g = IF(@sporta_v >= 1103, "GRANT SHOW CREATE ROUTINE ON \`${db}\`.* TO ${who}", "GRANT SELECT ON mysql.proc TO ${who}");`,
    'PREPARE sporta_s FROM @sporta_g; EXECUTE sporta_s; DEALLOCATE PREPARE sporta_s;')
  if (flag('pitr')) lines.push(`GRANT RELOAD, BINLOG MONITOR ON *.* TO ${who};`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

function compose() {
  const sha = String(opt('sha', ''))
  if (!/^[0-9a-f]{40}$/.test(sha)) die('compose needs --sha <the full 40-hex commit id that was pushed>', 2)
  const raw = `https://raw.githubusercontent.com/hkspower/wain/${sha}/sporta-web/ops/db`
  // Node fetches (the API refuses curl and wget in a compose file); no dollar sign anywhere (compose interpolates it).
  const fetchJs = "const fs=require('fs');const base='" + raw + "';(async()=>{fs.mkdirSync('/src',{recursive:true});" +
    "for(const f of ['db-backup.sh','db-restore-test.sh','backup-install.mjs']){const r=await fetch(base+'/'+f);if(!r.ok)throw new Error(f+' '+r.status);fs.writeFileSync('/src/'+f,Buffer.from(await r.arrayBuffer()));}})().catch(e=>{console.error(e.message);process.exit(1)})"
  const doApply = flag('apply'), doCron = flag('cron')
  if (doApply && doCron) die('--apply and --cron are two separate jobs', 2)
  const mode = doCron ? 'cron' : doApply ? 'apply' : 'plan'
  const run = mode === 'apply'
    ? `node /src/backup-install.mjs apply --root /host --src /src --sha ${sha} --confirm-sha ${sha} --escrow-pub-env ESCROW_PUB`
    : mode === 'cron'
      ? `node /src/backup-install.mjs cron --root /host --sha ${sha} --confirm-sha ${sha}`
      : 'node /src/backup-install.mjs plan --root /host'
  // The same shape as the other job files in ops/db (a compose document with `services`); `name` is the project name to create it under.
  const project = {
    name: `sporta-dbbackup-${mode}`,
    services: {
      install: {
        image: 'node:24-alpine',
        restart: 'no',
        // plan: both read-only. apply: writes the private directory (the scripts, the key, the login file) and leaves /etc/cron.d read-only.
        // cron: reads the private directory (it only checks the files are there) and writes ONE file in /etc/cron.d.
        volumes: [`/docker/sporta/private:/host/docker/sporta/private${mode === 'apply' ? '' : ':ro'}`, `/etc/cron.d:/host/etc/cron.d${mode === 'cron' ? '' : ':ro'}`],
        environment: mode === 'apply' ? { ESCROW_PUB: 'PASTE THE OWNER RSA PUBLIC KEY (PEM, public part only) HERE' } : {},
        command: ['sh', '-c', `node -e "${fetchJs.replace(/"/g, '\\"')}" && ${run}`],
      },
    },
  }
  say(JSON.stringify(project, null, 2))
}

if (process.argv[1] && process.argv[1].endsWith('backup-install.mjs')) {
  if (cmd === 'plan') plan()
  else if (cmd === 'apply') apply()
  else if (cmd === 'cron') installCron()
  else if (cmd === 'account-sql') accountSql()
  else if (cmd === 'compose') compose()
  else die('usage: plan | apply | account-sql | compose', 2)
}
