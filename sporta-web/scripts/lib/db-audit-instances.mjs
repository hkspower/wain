// Two PRIVATE MariaDB instances for test:db-audit, and nothing else.
//
//   startInsecure()   a database that is wrong in every way the audit looks for
//   startHardened()   the same shop schema, locked down from ops/db/sporta-db-hardening.cnf
//
// Each lives in its own temp directory with its own port (33400 and up) and a
// unix socket, started with --defaults-file (never the system configuration),
// bound to 127.0.0.1 only. Nothing here touches the shared test rig (database
// `sporta` on the default socket, ports 8095-8100, 4173, dist/). Every secret is
// generated at run time and held in memory; the repo contains none.
//
// Canary values (strings starting CANARY, a test card number, a documentation
// IP) are planted in personal-data and secret columns so the suite can prove the
// audit prints none of them.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')
const SQLDIR = join(WEB, 'dropin', 'php-store')
export const HARDENING_CNF = join(WEB, 'ops', 'db', 'sporta-db-hardening.cnf')

export const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
export const installDb = () => ['mariadb-install-db', 'mysql_install_db'].find(have)
export function prerequisites() {
  const missing = []
  for (const b of ['mariadbd', 'mariadb']) if (!have(b)) missing.push(b)
  if (!installDb()) missing.push('mariadb-install-db')
  if (!have('openssl')) missing.push('openssl')
  return missing
}

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
export async function freePort(from = 33400) { for (let p = from; p < from + 200; p++) if (await isFree(p)) return p; throw new Error('no free port') }

export const secret = (n = 12) => 'Zz9-' + randomBytes(n).toString('hex') // satisfies simple_password_check (upper, lower, digit, other, >= 16)

const live = []
export function stopAll() { for (const i of live.splice(0)) i.stop() }
process.on('exit', stopAll)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

// ---------------------------------------------------------------------------
// A running instance
// ---------------------------------------------------------------------------
async function start(name, { cnf, port, root }) {
  const dir = mkdtempSync(join(tmpdir(), `sporta-dba-${name}-`))
  const data = join(dir, 'data'); mkdirSync(data)
  let sockDir = dir
  if (join(dir, 'db.sock').length > 100) sockDir = mkdtempSync('/tmp/dba-')
  const sock = join(sockDir, 'db.sock')
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const r = spawnSync(installDb(), ['--no-defaults', `--datadir=${data}`, '--auth-root-authentication-method=normal', '--skip-test-db', ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (r.status !== 0) throw new Error('could not initialise a private data directory')
  const file = join(dir, 'instance.cnf')
  writeFileSync(file, cnf({ dir, data, sock, port }))
  const log = join(dir, 'mariadbd.log')
  const proc = spawn('mariadbd', [`--defaults-file=${file}`], { stdio: ['ignore', 'ignore', openSync(log, 'a')] })
  const inst = {
    name, dir, data, sock, port, proc, rootPassword: '',
    // Synchronous on purpose (it also runs from process 'exit'): ask the server to
    // stop, wait until it has, then remove its directory.
    stop() {
      try { proc.kill('SIGTERM') } catch { /* gone */ }
      const until = Date.now() + 15000
      while (Date.now() < until) {
        try { process.kill(proc.pid, 0) } catch { break }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
      try { process.kill(proc.pid, 'SIGKILL') } catch { /* already gone */ }
      for (const d of [dir, sockDir]) if (d && (d === dir || d !== dir)) try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    },
    log: () => (existsSync(log) ? readFileSync(log, 'utf8') : ''),
    // Run SQL as root over the socket (client, not the audit tool).
    sql(text, db = '', { user = 'root', password } = {}) {
      const args = ['--no-defaults', '-S', sock, `-u${user}`, '--default-character-set=utf8mb4', ...(db ? [db] : []), '-N', '-B']
      const res = spawnSync('mariadb', args, { input: text, encoding: 'utf8', env: { ...process.env, MYSQL_PWD: password ?? (user === 'root' ? inst.rootPassword : '') } })
      if (res.status !== 0) throw new Error(`mariadb: ${String(res.stderr).trim().split('\n')[0]}`)
      return res.stdout.trim()
    },
  }
  live.push(inst)
  for (let i = 0; i < 150; i++) {
    try { inst.sql('select 1'); return inst } catch { await new Promise((ok) => setTimeout(ok, 200)) }
  }
  throw new Error(`the private MariaDB did not start: ${inst.log().trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`)
}

const baseCnf = ({ dir, data, sock, port }) =>
  `[mysqld]\ndatadir=${data}\nport=${port}\nsocket=${sock}\nbind-address=127.0.0.1\npid-file=${dir}/db.pid\nuser=root\ninnodb_flush_log_at_trx_commit=0\n`

// The shop's own schema: install.mysql.sql plus every additive migration, the
// way scripts/xss-config-test.mjs loads it.
function loadSchema(inst, db) {
  inst.sql(`create database ${db} character set utf8mb4 collate utf8mb4_unicode_ci`)
  inst.sql(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'), db)
  const skip = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
  for (const f of readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !skip.has(n)).sort()) inst.sql(readFileSync(join(SQLDIR, f), 'utf8'), db)
  inst.sql('alter table customer_accounts add column if not exists birthday date null default null, add column if not exists birthday_set_at datetime null default null, add column if not exists birthday_sent_year smallint null default null', db)
}

// ---------------------------------------------------------------------------
// Canaries: values the audit must never print.
// ---------------------------------------------------------------------------
export const CANARY = {
  name: 'CANARYNAME Al-Sabah',
  email: 'canary.person@example.invalid',
  phone: '55501234',
  note: 'CANARYNOTE deliver to the blue door',
  token: 'CANARYTOKEN0123456789abcdef0123456789abcdef',
  plainPassword: 'CANARYPASSWORD-hunter2',
  hashLike: '$2y$10$CANARYHASHabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ', // bcrypt-shaped, 60 chars
  totp: 'CANARYTOTPSEEDJBSWY3DPEHPK3PXP',
  card: '4111111111111111', cardSpaced: '4111 1111 1111 1111',
  apiKey: 'CANARYAPIKEYabcdefghijklmnop123456',
  ip: '203.0.113.77',
  mapLink: 'https://www.google.com/maps?q=29.3759,47.9774',
}
export const canaryNeedles = () => [
  'CANARY', CANARY.email, CANARY.phone, CANARY.card, CANARY.cardSpaced, CANARY.ip.replace(/\.\d+$/, '.77'), '29.3759,47.9774', 'JBSWY3DPEHPK3PXP',
]

// ---------------------------------------------------------------------------
// INSECURE
// ---------------------------------------------------------------------------
export async function startInsecure() {
  const port = await freePort()
  const inst = await start('insecure', {
    port,
    cnf: (p) => baseCnf(p) + [
      'local-infile=1', 'general_log=1', `general_log_file=${p.dir}/general.log`, 'slow_query_log=1', `slow_query_log_file=${p.dir}/slow.log`,
      "sql_mode=''", 'event_scheduler=ON', 'character-set-server=latin1', 'collation-server=latin1_swedish_ci',
      'log_bin=insecure-bin', 'tls_version=TLSv1.1,TLSv1.2', // binary log with no expiry; old TLS offered
      'wait_timeout=28800', 'max_connections=2000', 'max_allowed_packet=512M',
    ].join('\n') + '\n',
  })
  loadSchema(inst, 'sporta')
  // ---- accounts
  inst.sql(`
    create user ''@'localhost';
    create user 'root'@'%';                                   -- no password, reachable from anywhere
    grant all privileges on *.* to 'root'@'%' with grant option;
    create user 'sporta_app'@'%' identified by 'app-pass-1';  -- the "web account": wildcard host, owns the schema
    grant all privileges on sporta.* to 'sporta_app'@'%';
    grant process, file on *.* to 'sporta_app'@'%';
    -- the anonymous localhost account shadows 'sporta_app'@'%' for local logins (a classic): this row lets the suite sign in
    create user 'sporta_app'@'127.0.0.1' identified by 'app-pass-1';
    grant all privileges on sporta.* to 'sporta_app'@'127.0.0.1';
    grant process, file on *.* to 'sporta_app'@'127.0.0.1';
    create user 'ghost'@'%' identified by 'ghost-pass-1';     -- nothing to use
    create user 'olddb'@'%' identified by 'olddb-pass-1';
    grant select on gone_db.* to 'olddb'@'%';                 -- a schema that no longer exists
  `)
  // ---- schema defects, in the shop's own database
  inst.sql(`
    create database test;
    create database scratch_copy;
    create table customers_legacy_20261021 (name varchar(80), phone varchar(20), note text) engine=InnoDB default charset=latin1;
    create table stock_log (sku varchar(30), delta int, at datetime) engine=MyISAM default charset=utf8mb4;
    create table rate_bucket (k varchar(40), hits int) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_general_ci;
    create table admin_sessions (id int primary key auto_increment, token varchar(64) not null, created_at datetime default current_timestamp) engine=InnoDB default charset=utf8mb4;
    create table legacy_accounts (id int primary key auto_increment, email varchar(120), password varchar(120)) engine=InnoDB default charset=utf8mb4;
    create table push_subscriptions (id int primary key auto_increment, endpoint varchar(300), auth_secret varchar(80)) engine=InnoDB default charset=utf8mb4;
    create definer='root'@'%' sql security definer view v_orders_public as select id, track_id, amount from orders;
    create definer='root'@'%' trigger orders_touch before update on orders for each row set new.cbk_message = new.cbk_message;
    create definer='root'@'%' event ev_cleanup on schedule every 1 day disable do delete from rate_limit where hits = 0;
  `, 'sporta')
  // ---- personal data and secrets (canaries)
  const c = CANARY
  inst.sql(`
    insert into admin_sessions (token) values ('${c.token}'), ('${c.token.slice(0, -4)}ffff');
    insert into legacy_accounts (email, password) values ('${c.email}', '${c.plainPassword}'), ('x@example.invalid', 'd41d8cd98f00b204e9800998ecf8427e');
    insert into push_subscriptions (endpoint, auth_secret) values ('https://push.example.invalid/x', 'CANARYAUTHSECRET1234567890');
    insert into customers_legacy_20261021 values ('${c.name}', '${c.phone}', '${c.note}');
    insert into admin_users (email, password_hash, totp_enabled, totp_secret) values ('cs@example.invalid', '${c.hashLike}', 1, '${c.totp.replace('CANARYTOTPSEED', '')}');
    insert into settings (name, value) values ('legacy_gateway', '{"api_key":"${c.apiKey}","mode":"live"}');
    insert into orders (track_id, amount, subtotal, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_governorate, customer_area,
                        customer_block, customer_street, customer_building, customer_note, created_at)
      values ('TRK-OLD-0001', 12.000, 12.000, 'paid', 'cod', 'delivered', '${c.name}', '${c.phone}', 'hawalli', 'Salmiya', '4', '12', '5', 'Location: ${c.mapLink}', '2026-01-01 10:00:00'),
             ('TRK-OLD-0002', 9.500, 9.500, 'paid', 'cod', 'delivered', 'Old Customer', '55509999', 'hawalli', 'Salmiya', '4', '12', '5', 'plain note', '2022-03-01 10:00:00');
    insert into support_tickets (reference, customer_name, customer_email, customer_phone, subject, status, priority) values ('SUP-1', '${c.name}', '${c.email}', '${c.phone}', 'refund', 'open', 'normal');
    insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer)
      select id, 'customer', '${c.name}', 'my card is ${c.cardSpaced} exp 12/29 please charge it', 1 from support_tickets limit 1;
    insert into admin_password_resets (admin_id, token_hash, expires_at, request_ip, created_at)
      select id, sha2('x', 256), now() - interval 30 day, '${c.ip}', now() - interval 31 day from admin_users limit 1;
    insert into admin_activity_log (actor_email, action_key, created_at) values ('${c.email}', 'login', now() - interval 700 day);
  `, 'sporta')
  return inst
}

// ---------------------------------------------------------------------------
// HARDENED
// ---------------------------------------------------------------------------
function makeCerts(dir) {
  const t = join(dir, 'tls'); mkdirSync(t)
  const run = (args, input) => { const r = spawnSync('openssl', args, { cwd: t, input, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`openssl ${args[0]}: ${r.stderr.trim().split('\n')[0]}`) }
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '365', '-subj', '/CN=sporta-test-ca'])
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'])
  writeFileSync(join(t, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n')
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '365', '-extfile', 'ext.cnf'])
  spawnSync('chmod', ['0400', join(t, 'server.key')])
  return t
}

export async function startHardened() {
  const port = await freePort(33450)
  let tlsDir = ''
  const files = []
  const inst = await start('hardened', {
    port,
    cnf: (p) => {
      tlsDir = makeCerts(p.dir)
      const filesDir = join(p.dir, 'files'); mkdirSync(filesDir); files.push(filesDir)
      // THE SHIPPED FILE, with only environment-specific paths rewritten.
      const shipped = readFileSync(HARDENING_CNF, 'utf8')
        .replaceAll('/etc/mysql/tls/', tlsDir + '/')
        .replaceAll('/var/lib/mysql-files', filesDir)
      return baseCnf(p) + shipped.replace(/^\[mysqld\]\s*$/m, '') +
        '\n# test-only additions (the shipped file leaves these to the owner)\nrequire_secure_transport=ON\n'
    },
  })
  inst.tlsDir = tlsDir
  inst.caFile = join(tlsDir, 'ca.crt')
  loadSchema(inst, 'sporta')
  // ---- accounts: sporta_web is DML-only; sporta_audit sees everything but cannot change data
  const pw = { root: secret(), web: secret(), audit: secret(), audit1: secret() }
  inst.pw = pw
  inst.sql(`
    drop user if exists 'root'@'127.0.0.1'; drop user if exists 'root'@'::1'; drop user if exists 'root'@'vm';
    create user 'sporta_web'@'127.0.0.1' identified by '${pw.web}' with max_user_connections 40;
    grant select, insert, update, delete on sporta.* to 'sporta_web'@'127.0.0.1';
    -- the auditor, full visibility: reads the account tables and every schema, can see triggers. NOTE: TRIGGER lets
    -- it CREATE triggers too, so this account is granted for the duration of an audit only (HOST-CHECKLIST.md).
    create user 'sporta_audit'@'127.0.0.1' identified by '${pw.audit}' with max_user_connections 2;
    grant select on mysql.* to 'sporta_audit'@'127.0.0.1';
    grant process, show databases on *.* to 'sporta_audit'@'127.0.0.1';
    grant select, show view, trigger on sporta.* to 'sporta_audit'@'127.0.0.1';
    -- the auditor without TRIGGER: cannot see triggers, and must say so
    create user 'sporta_audit1'@'127.0.0.1' identified by '${pw.audit1}' with max_user_connections 2;
    grant select on mysql.* to 'sporta_audit1'@'127.0.0.1';
    grant process, show databases on *.* to 'sporta_audit1'@'127.0.0.1';
    grant select, show view on sporta.* to 'sporta_audit1'@'127.0.0.1';
    alter user 'root'@'localhost' identified by '${pw.root}';
  `)
  inst.rootPassword = pw.root
  // ---- clean data: hashed credentials, no free-text card numbers, no old location lines
  const hash = '$2y$10$' + randomBytes(40).toString('base64').replace(/[^A-Za-z0-9]/g, '.').padEnd(53, '.').slice(0, 53)
  inst.sql(`
    insert into admin_users (email, password_hash, totp_enabled) values ('cs@example.invalid', '${hash}', 0);
    insert into customer_accounts (name, email, password_hash, phone) values ('Test Customer', 'cust@example.invalid', '${hash}', '55500000');
    insert into admin_password_resets (admin_id, token_hash, expires_at, request_ip) select id, sha2('t', 256), now() + interval 1 day, '10.0.0.5' from admin_users limit 1;
    insert into orders (track_id, amount, subtotal, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_governorate, customer_area,
                        customer_block, customer_street, customer_building, customer_note)
      values ('TRK-NEW-0001', 12.000, 12.000, 'pending', 'cod', 'unfulfilled', 'Test Customer', '55500000', 'hawalli', 'Salmiya', '4', '12', '5', 'ring twice');
    insert into support_tickets (reference, customer_name, customer_email, customer_phone, subject, status, priority) values ('SUP-9', 'Test Customer', 'cust@example.invalid', '55500000', 'size', 'open', 'normal');
    insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) select id, 'customer', 'Test Customer', 'does the jacket come in L?', 1 from support_tickets limit 1;
  `, 'sporta')
  return inst
}

// An account to connect as, with its password, for the suite's CLI runs.
export const connectEnv = (inst, user, password, extra = {}) => ({
  DB_HOST: '127.0.0.1', DB_PORT: String(inst.port), DB_USER: user, DB_PASSWORD: password ?? '', DB_NAME: 'sporta', ...extra,
})
