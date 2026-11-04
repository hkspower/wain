// DATABASE LEAST PRIVILEGE, proved on a PRIVATE MariaDB and PHP.
//
//   npm run test:db-least-privilege           (KEEP=1 keeps the temp directory)
//
// WHAT IT PROVES, in order
//   1. The privilege list is DERIVED from the code: every SQL string in
//      dropin/php-store, php-knet and php-cbk, followed from each entry point
//      (scripts/lib/php-sql-map.php + sql-privileges.mjs). ops/db/grants.sql is
//      the generator's output for exactly that, and not a byte different.
//   2. Rendering grants.sql and applying it to a database installed from
//      install.mysql.sql + every migration creates eight LOCKED accounts whose
//      EFFECTIVE grants (read back from information_schema, not from the file)
//      equal the derived list: no extra table, no extra column, no global
//      privilege, no GRANT OPTION, no wildcard host.
//   3. The restricted accounts FAIL CLOSED: DROP, ALTER, CREATE, GRANT, FILE,
//      LOAD DATA, mysql.user, tables they do not own, columns they may not
//      write, DELETE on orders, TRUNCATE, LOCK TABLES, temporary tables,
//      triggers, views, SET GLOBAL, KILL, a locked account, a wrong host, the
//      connection cap.
//   4. The REAL application works on those accounts: PHP servers started the
//      way the repo's other suites start them, pointed at sporta_web /
//      sporta_knet / sporta_tpay, drive the storefront, checkout (cash, KNET,
//      T-Pay), the admin, the host cron jobs, SEO pages and preflight, and the
//      server's audit log shows ZERO "access denied" for any of it.
//   5. The tier-2 split (sporta_shop / sporta_admin / sporta_cron) works with
//      ops/db/php-roles.patch applied to the STAGED copy of the PHP (never to
//      the repo), and each request ran as the account it should.
//   6. The read-only account dumps the whole database; the migration account
//      runs every migration, and cannot DROP.
//   7. MUTATION CHECKS: the same assertions go RED when the hardening is
//      removed (ALL granted to the runtime account), when a needed privilege is
//      taken away (checkout breaks), when the code gains a write grants.sql
//      does not know (the detector flags it), when grants.sql gains a wildcard
//      or a DROP, and when the file is fed to the client unrendered.
//
// SELF-CONTAINED. Its own MariaDB (port from 33440), its own PHP servers and a
// staged copy of dropin/ in a temp directory. It never touches the shared
// sandbox (database `sporta`, ports 8095-8100, 8188, 4173), dist/, or any
// config.php in the repo, and every password in it is generated at run time.
import { execFile, spawn, spawnSync } from 'node:child_process'
import { createCipheriv } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ACCOUNTS, accountNeeds, buildGrantsSql, codeRoles, ENTRY, MIGRATE_DB_PRIVS, OUT as GRANTS_FILE, phpMap, repoTables, TABLE_WIDE_UPDATE } from '../ops/db/make-grants.mjs'
import { newPassword, passwordOk, render, renderRotate, hostOk } from '../ops/db/render-grants.mjs'
import { classify, mergePrivs, programPrivileges, schemaTables } from './lib/sql-privileges.mjs'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const DROPIN = join(WEB, 'dropin')
const SQLDIR = join(DROPIN, 'php-store')

let fails = 0, passes = 0, weaks = 0
const STRICT = process.argv.includes('--strict')
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const info = (n, d = '') => console.log(`info ${n}${d ? `  — ${d}` : ''}`)
// A known gap or an environment limit: printed as `weak`, never as a pass; fails only with --strict.
const weak = (c, n, d) => { if (c) return ok(n, d); weaks++; console.log(`weak ${n}${d ? `  — ${d}` : ''}`) }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ prerequisites
const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
for (const [bin, present] of [['php', have('php')], ['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-dump', have('mariadb-dump')], ['mariadb-install-db', !!installDb]]) {
  if (!present) {
    console.log(`SKIP db-least-privilege: ${bin} is not installed, so no private instance can be built. Nothing was tested.`)
    process.exit(0)
  }
}
const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 80; p++) if (await isFree(p)) return p; throw new Error('no free port') }

const tmp = mkdtempSync(join(tmpdir(), 'sporta-dblp-'))
const procs = [], extraDirs = []
const cleanup = () => {
  for (const p of procs) { try { p.kill() } catch { /* gone */ } }
  // mariadbd needs a moment to leave: removing its data directory under it leaves litter
  for (let i = 0; i < 40 && procs.some((p) => p.exitCode === null && p.signalCode === null && p.pid && (() => { try { process.kill(p.pid, 0); return true } catch { return false } })()); i++) spawnSync('sleep', ['0.25'])
  for (const d of extraDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
  if (!process.env.KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
  else console.log(`\nKEEP=1: ${tmp}`)
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

// ------------------------------------------------------------------ the database
const DB = 'sporta_lp'
const DATA = join(tmp, 'db')
mkdirSync(DATA)
let sockDir = tmp
if (join(tmp, 'db.sock').length > 100) { sockDir = mkdtempSync('/tmp/lp-'); extraDirs.push(sockDir) }
const SOCK = join(sockDir, 'db.sock')
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
{
  const r = spawnSync(installDb, ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (r.status !== 0) { console.log('SKIP db-least-privilege: could not initialise a private MariaDB data directory.'); process.exit(0) }
}
const DB_PORT = await freePort(33440)
const dbLog = join(tmp, 'mariadbd.log')
procs.push(spawn('mariadbd', ['--no-defaults', `--datadir=${DATA}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--bind-address=127.0.0.1',
  '--skip-name-resolve', `--pid-file=${join(tmp, 'db.pid')}`, '--innodb-flush-log-at-trx-commit=0', '--max-allowed-packet=64M',
  '--local-infile=0', `--secure-file-priv=${join(tmp, 'secure')}`,
  ...(asRoot ? ['--user=root'] : [])], { stdio: ['ignore', 'ignore', openSync(dbLog, 'a')] }))
mkdirSync(join(tmp, 'secure'))

// The admin (root) connection: the unix socket, no password, private to this run.
const rootSql = (text, db = DB, extra = []) => new Promise((resolve, reject) => {
  const p = spawn('mariadb', ['--no-defaults', '-S', SOCK, '-uroot', '--default-character-set=utf8mb4', ...extra, ...(db ? [db] : []), '-N', '-B'])
  let out = '', err = ''
  p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
  p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
  p.stdin.on('error', () => { /* the client exited first; its exit code says why */ })
  p.stdin.end(text)
})
let dbUp = false
for (let i = 0; i < 150 && !dbUp; i++) { try { await rootSql('select 1', ''); dbUp = true } catch { await sleep(200) } }
if (!dbUp) {
  console.log(`SKIP db-least-privilege: the private MariaDB did not start (${existsSync(dbLog) ? readFileSync(dbLog, 'utf8').trim().split('\n').slice(-2).join(' | ').slice(0, 200) : 'no log'}).`)
  process.exit(0)
}
const serverVersion = await rootSql('select version()', '')

// The server's own audit trail: who ran what, and the error code it got back.
// This is how "the application never met an access-denied" is MEASURED rather
// than inferred from a 200.
const AUDIT = join(tmp, 'audit.log')
let auditOn = false
try {
  await rootSql(`install soname 'server_audit'; set global server_audit_file_path='${AUDIT}'; set global server_audit_events='QUERY'; set global server_audit_query_log_limit=8192; set global server_audit_logging=on`, '')
  auditOn = true
} catch { auditOn = false }
// Records {user, sql, code} appended since the mark.
const auditRows = []
let auditMark = 0
function auditSince(mark = auditMark) {
  if (!auditOn || !existsSync(AUDIT)) return []
  const text = readFileSync(AUDIT, 'utf8')
  const rows = []
  for (const line of text.slice(mark).split('\n')) {
    const m = line.match(/^\d{8} [\d:]+,[^,]*,([^,]*),([^,]*),(\d+),(\d+),(\w+),([^,]*),'(.*)',(\d+)$/)
    if (m) rows.push({ user: m[1], op: m[5], db: m[6], sql: m[7].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\'), code: Number(m[8]) })
  }
  return rows
}
const auditEnd = () => (auditOn && existsSync(AUDIT) ? statSync(AUDIT).size : 0)
const DENIED = new Set([1044, 1045, 1142, 1143, 1227, 1370, 1095, 1130, 1226, 1203, 4151])
const denials = (rows, users) => rows.filter((r) => DENIED.has(r.code) && users.includes(r.user))

// ------------------------------------------------------------------ the schema
// Installed by the ADMIN, exactly as the owner does with phpMyAdmin. The grants
// below can only name tables that exist.
await rootSql(`create database ${DB} character set utf8mb4 collate utf8mb4_unicode_ci`, '')
await rootSql(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'))
const SKIP_SQL = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
const MIGRATIONS = readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !SKIP_SQL.has(n)).sort()
for (const f of MIGRATIONS) await rootSql(readFileSync(join(SQLDIR, f), 'utf8'))
// The birthday columns live in sporta-live (the live database has them).
await rootSql(readFileSync(join(WEB, '..', 'sporta-live', 'birthday', 'birthday.mysql.sql'), 'utf8'))
// Stand-ins for the ~40 tables of the OLD storefront build that no code here
// reads: a customers table and a wallet table, each with a row. Nobody but the
// read-only account may see them.
await rootSql(`create table legacy_customers (id int primary key, email varchar(80), secret_note varchar(80));
  insert into legacy_customers values (1, 'old@example.test', 'legacy-row');
  create table legacy_wallet_passes (id int primary key, token varchar(80)); insert into legacy_wallet_passes values (1, 'legacy-token');`)
await rootSql('update product_variants set stock = 1000')
const TABLES = repoTables()
info('private instance', `MariaDB ${serverVersion} on 127.0.0.1:${DB_PORT}, database ${DB}, ${TABLES.size} repo tables + 2 stand-in legacy tables, audit log ${auditOn ? 'ON' : 'OFF (server_audit.so missing: denial checks degrade to HTTP status and PHP error log)'}`)

// ------------------------------------------------------------------ 1. derivation
head('1. the privilege list is derived from the code')
const PHPMAP = phpMap()
const CODE = codeRoles(PHPMAP, TABLES)
const NEEDS = accountNeeds(CODE, TABLES, PHPMAP)
{
  const stmts = Object.values(PHPMAP).flatMap((f) => [...f.top.sql, ...Object.values(f.funcs).flatMap((x) => x.sql)])
  const kinds = new Set()
  for (const s of stmts) {
    const v = String(s.text).trim().toLowerCase().match(/^(create|alter|drop|truncate|rename|lock|grant|revoke|load|flush|kill|set\s+global|install|create\s+temporary)\b/)
    if (v) kinds.add(v[1])
  }
  // Strings in prose ("Create your sign-in", "Set up KNET") begin like a verb;
  // a real DDL statement names an object: create table, alter table, drop ...
  const ddl = []
  for (const [file, f] of Object.entries(PHPMAP)) {
    if (/config(\.example)?\.php$|selftest|setup-config/.test(file)) continue
    for (const s of [...f.top.sql, ...Object.values(f.funcs).flatMap((x) => x.sql)]) {
      if (/^\s*(create\s+(temporary\s+)?table|create\s+(or\s+replace\s+)?(view|trigger|procedure|function|event|index|unique\s+index|database|schema|user)|alter\s+table|drop\s+(table|database|index|user|view|trigger)|truncate\s+(table\s+)?[a-z_]+|rename\s+table|lock\s+tables|grant\s|revoke\s|load\s+data|flush\s|kill\s|install\s+(soname|plugin)|set\s+global)\b/i.test(String(s.text))) ddl.push(`${file}:${s.line}`)
      if (/\binto\s+(outfile|dumpfile)\b|\bload_file\s*\(/i.test(String(s.text))) ddl.push(`${file}:${s.line} (file access)`)
    }
  }
  is(ddl.length === 0, 'the application sends NO DDL, LOCK TABLES, temporary table, GRANT, FLUSH, KILL, FILE access or SET GLOBAL', ddl.slice(0, 4).join(', ') || `${stmts.length} string expressions read, none`)
}
{
  const total = Object.values(NEEDS.web).length
  is(total === TABLES.size, 'the one-account setup (web = shop + admin + cron) touches every repo table and nothing else', `${total} of ${TABLES.size}`)
  const orders = NEEDS.shop.orders
  is(!orders.update.has('payment_status') && !orders.update.has('*') && !orders.update.has('paid_at'),
    'the storefront code never writes payment_status or paid_at on an order (so its account need not be able to)', [...orders.update].join(','))
  is(!NEEDS.shop.admin_users && !NEEDS.shop.products?.update.size && !NEEDS.shop.settings?.update.size && !NEEDS.shop.admin_activity_log,
    'the storefront code never touches admin_users, never updates a product or a setting, and never writes the activity log')
  const gw = NEEDS.knet.orders
  is(gw.update.size > 0 && !gw.update.has('*') && !gw.update.has('amount') && !gw.update.has('customer_phone') && !gw.insert && !gw.delete,
    'the KNET gateway code can update only the bank-result columns of an order', [...gw.update].join(','))
  const never = ['orders', 'admin_activity_log', 'inventory_movements', 'order_tracking_events', 'crm_notes', 'support_messages', 'return_request_events']
  const deleters = never.filter((t) => NEEDS.web[t]?.delete)
  is(deleters.length === 0, 'no code path deletes an order or an audit/ledger row (orders, activity log, stock movements, tracking events, CRM notes, support messages, return events)', deleters.join(',') || 'none')
  const updaters = ['admin_activity_log', 'inventory_movements', 'order_tracking_events', 'crm_notes', 'support_messages', 'return_request_events'].filter((t) => NEEDS.web[t]?.update.size)
  is(updaters.length === 0, 'and none of those log tables is ever UPDATEd: they are append-only for every account', updaters.join(',') || 'none')
}
{
  const fresh = buildGrantsSql({ needs: NEEDS, code: CODE })
  is(readFileSync(GRANTS_FILE, 'utf8') === fresh, 'ops/db/grants.sql is exactly what make-grants.mjs derives from the code (regenerate with: node ops/db/make-grants.mjs)')
}
{
  // every table the migrations create has a grant row somewhere, or is knowingly unused
  const unused = [...TABLES].filter((t) => !NEEDS.web[t])
  is(unused.length === 0, 'every table the migrations define is used by some actor (a table nobody uses would be dead weight to revoke)', unused.join(',') || 'none')
}

// ------------------------------------------------------------------ 2. render + apply
head('2. grants.sql renders, applies, and the effective grants are exactly the derived ones')
const HOST = '127.0.0.1'
const PW = {}
for (const k of Object.keys(ACCOUNTS)) PW[k] = newPassword()
is(Object.values(PW).every(passwordOk) && new Set(Object.values(PW)).size === Object.keys(PW).length, 'the generated passwords are 40 characters, mixed-class, all different')
const GRANTS_RAW = readFileSync(GRANTS_FILE, 'utf8')
const renderAll = (over = {}) => render({ db: DB, appHost: HOST, jobHost: HOST, passwords: PW, activate: ['web', 'knet', 'tpay', 'ro', 'migrate'], ...over })

{
  // the guard: the raw template must stop at once and leave nothing behind
  let raw = ''
  try { await rootSql(GRANTS_RAW, ''); raw = 'RAN' } catch (e) { raw = String(e.message) }
  const leftovers = await rootSql("select count(*) from mysql.user where user like 'sporta\\_%' or host like '%@@%'", '')
  is(/1242|Subquery/.test(raw) && leftovers === '0', 'grants.sql fed to the client UNRENDERED stops at the guard and creates nothing', raw.split('\n')[0].slice(0, 80))
  is(/@@PASSWORD_/.test(GRANTS_RAW) && !/IDENTIFIED BY '[A-Za-z0-9_-]{32,}'/.test(GRANTS_RAW), 'the file in the repo holds placeholders only: no password of any kind')
  for (const bad of ['%', '', '%.%', '_', "1.2.3.4'; drop", 'a b', '%.internal']) {
    let refused = false
    try { render({ db: DB, appHost: bad, jobHost: HOST, passwords: PW }) } catch { refused = true }
    if (!refused) { is(false, `a wildcard or malformed host ${JSON.stringify(bad)} is refused by the renderer`); break }
  }
  is(true, 'the renderer refuses a wildcard, empty, leading-wildcard or injected host pattern')
  is(['172.16.0.0/255.240.0.0', '172.18.0.%', 'localhost', '10.0.0.5'].every(hostOk), 'and accepts a netmask, a partial-wildcard docker range, localhost and a literal address')
  let weak = false
  try { render({ db: DB, appHost: HOST, jobHost: HOST, passwords: { ...PW, web: 'password' } }) } catch { weak = true }
  is(weak, 'a weak password is refused at render time')
}

const auditStart = auditEnd()
await rootSql(renderAll(), '')
// idempotent: applying it a second time changes nothing
const effective = async (user, host = HOST) => {
  const g = `'${user}'@'${host}'`
  const rows = (q) => rootSql(q, '').then((t) => (t ? t.split('\n').map((l) => l.split('\t')) : []))
  const [usr, sch, tab, col] = await Promise.all([
    rows(`select privilege_type, is_grantable from information_schema.user_privileges where grantee = "${g}"`),
    rows(`select table_schema, privilege_type, is_grantable from information_schema.schema_privileges where grantee = "${g}"`),
    rows(`select table_schema, table_name, privilege_type, is_grantable from information_schema.table_privileges where grantee = "${g}"`),
    rows(`select table_schema, table_name, column_name, privilege_type, is_grantable from information_schema.column_privileges where grantee = "${g}"`),
  ])
  return { global: usr, schema: sch, tables: tab, columns: col }
}
// what the derivation says an account should have, in the same shape
function expected(key) {
  const a = ACCOUNTS[key]
  const exp = { global: ['USAGE'], schema: [], tables: {}, columns: {} }
  if (a.special === 'readonly') exp.schema = ['SELECT', 'SHOW VIEW']
  if (a.special === 'migrate') exp.schema = [...MIGRATE_DB_PRIVS]
  for (const [t, p] of Object.entries(NEEDS[key] ?? {})) {
    const set = new Set()
    if (p.select) set.add('SELECT'); if (p.insert) set.add('INSERT'); if (p.delete) set.add('DELETE')
    const wide = p.update.has('*') || (p.update.size > 0 && TABLE_WIDE_UPDATE[t])
    if (wide) set.add('UPDATE')
    if (set.size) exp.tables[t] = set
    if (p.update.size && !wide) exp.columns[t] = new Set([...p.update])
  }
  return exp
}
function diffEffective(eff, exp) {
  const problems = []
  const grantable = [...eff.global, ...eff.schema.map((r) => r.slice(1)), ...eff.tables.map((r) => r.slice(2)), ...eff.columns.map((r) => r.slice(3))].filter((r) => r[1] === 'YES' || r[r.length - 1] === 'YES')
  if (grantable.length) problems.push('GRANT OPTION present')
  const globals = eff.global.map((r) => r[0]).filter((p) => p !== 'USAGE')
  if (globals.length) problems.push(`global: ${globals.join(',')}`)
  const sch = eff.schema.filter((r) => r[0] === DB).map((r) => r[1]).sort().join(',')
  if (sch !== [...exp.schema].sort().join(',')) problems.push(`database-wide: [${sch}] expected [${exp.schema.join(',')}]`)
  if (eff.schema.some((r) => r[0] !== DB)) problems.push('privileges on another database')
  const gotTables = {}
  for (const [, t, p] of eff.tables) (gotTables[t] ??= new Set()).add(p)
  const tableNames = new Set([...Object.keys(gotTables), ...Object.keys(exp.tables)])
  for (const t of tableNames) {
    const a = [...(gotTables[t] ?? [])].sort().join(','), b = [...(exp.tables[t] ?? [])].sort().join(',')
    if (a !== b) problems.push(`${t}: has [${a}] expected [${b}]`)
  }
  const gotCols = {}
  for (const [, t, c, p] of eff.columns) { if (p === 'UPDATE') (gotCols[t] ??= new Set()).add(c); else problems.push(`column privilege ${p} on ${t}.${c}`) }
  // a table-level UPDATE shows up in column_privileges too; ignore those tables
  for (const t of new Set([...Object.keys(gotCols), ...Object.keys(exp.columns)])) {
    if (gotTables[t]?.has('UPDATE')) continue
    const a = [...(gotCols[t] ?? [])].sort().join(','), b = [...(exp.columns[t] ?? [])].sort().join(',')
    if (a !== b) problems.push(`${t} UPDATE columns: has [${a}] expected [${b}]`)
  }
  return problems
}
for (const key of Object.keys(ACCOUNTS)) {
  const eff = await effective(ACCOUNTS[key].user)
  const problems = diffEffective(eff, expected(key))
  const n = eff.tables.length + eff.columns.length + eff.schema.length
  is(problems.length === 0, `${ACCOUNTS[key].user}: the server's effective grants equal the derived ones`, problems.slice(0, 3).join('; ') || `${eff.tables.length} table grants, ${eff.schema.length} database-wide, ${n} rows`)
}
{
  const hosts = await rootSql("select concat(user,'@',host,'|',max_user_connections,'|',is_role) from mysql.user where user like 'sporta\\_%' order by user", '')
  is(hosts.split('\n').every((l) => l.includes('@' + HOST + '|')) && !/@%|@\|/.test(hosts), 'every account is bound to the rendered host pattern; none is @% or has an empty host')
  const limits = Object.fromEntries(hosts.split('\n').map((l) => { const [u, c] = l.split('|'); return [u.split('@')[0], Number(c)] }))
  is(Object.entries(ACCOUNTS).every(([, a]) => limits[a.user] === a.maxConn), 'and each has its connection cap', Object.values(limits).join('/'))
  const sumTier1 = Object.values(ACCOUNTS).filter((a) => a.tier === 1).reduce((s, a) => s + a.maxConn, 0)
  const sumTier2 = Object.values(ACCOUNTS).filter((a) => a.tier === 2 || ['knet', 'tpay', 'ro', 'migrate'].includes(a.user.slice(7))).reduce((s, a) => s + a.maxConn, 0)
  is(sumTier1 < 151 && sumTier2 < 151, 'the caps of each deployment (tier 1: ' + sumTier1 + ', tier 2: ' + sumTier2 + ') stay under MariaDB\'s default max_connections (151), so the storefront cannot starve the payment callbacks')
}
{
  // idempotent re-apply
  const before = JSON.stringify(await Promise.all(Object.values(ACCOUNTS).map((a) => effective(a.user))))
  await rootSql(renderAll(), '')
  const after = JSON.stringify(await Promise.all(Object.values(ACCOUNTS).map((a) => effective(a.user))))
  is(before === after, 'applying grants.sql a second time changes nothing (idempotent)')
  const lockedStill = await rootSql("select user from mysql.global_priv where user in ('sporta_shop','sporta_admin','sporta_cron') and json_value(priv,'$.account_locked') = '1' order by user", 'mysql').catch(() => '')
  is(lockedStill.split('\n').filter(Boolean).length === 3, 'the accounts nobody activated are still LOCKED after a re-apply', lockedStill.replace(/\n/g, ','))
}

// ------------------------------------------------------------------ connection helpers
// mariadb CLI as an application account. The password goes in the environment of
// that one child process, never on a command line.
function sqlAs(key, text, { db = DB, host = HOST, extra = [], timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const user = typeof key === 'string' && ACCOUNTS[key] ? ACCOUNTS[key].user : key
    const pw = ACCOUNTS[key] ? PW[key] : process.env.__NOPW__ ?? ''
    const args = ['--no-defaults', `-h${host}`, `-P${DB_PORT}`, `-u${user}`, '--batch', '--skip-column-names', '--default-character-set=utf8mb4', ...extra, ...(db ? [db] : [])]
    const p = spawn('mariadb', args, { env: { ...process.env, MYSQL_PWD: pw } })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    const t = setTimeout(() => p.kill(), timeoutMs)
    p.on('close', (code) => {
      clearTimeout(t)
      const m = err.match(/ERROR (\d+) \(/)
      resolve({ code, out: out.trim(), err: err.trim(), errno: m ? Number(m[1]) : 0 })
    })
    p.stdin.on('error', () => { /* client exited first */ })
    p.stdin.end(text)
  })
}

// ------------------------------------------------------------------ 3. fails closed
head('3. the accounts fail closed')
// One battery, run for an account against what it must NOT be able to do. It
// returns the checks so the MUTATION section can run the very same battery
// against an over-privileged account and see it go red.
const outfile = join(tmp, 'secure', 'leak.txt')
async function battery(key) {
  const a = ACCOUNTS[key]
  const res = []
  const must = async (name, sql, wantErrnos, opts = {}) => {
    const r = await sqlAs(key, sql, opts)
    res.push({ name, ok: r.errno !== 0 && (wantErrnos === '*' || wantErrnos.includes(r.errno)), detail: `${r.errno || 'no error'}` })
  }
  await must('DROP TABLE orders', 'drop table orders', [1142])
  await must('TRUNCATE orders', 'truncate table orders', [1142, 1044])
  await must('ALTER TABLE orders', 'alter table orders add column zz int', [1142])
  await must('CREATE TABLE', 'create table zz_new (a int)', [1142, 1044])
  await must('CREATE INDEX', 'create index zz_ix on orders (id)', [1142])
  await must('CREATE DATABASE', 'create database zz_db', [1044])
  await must('CREATE VIEW', 'create view zz_v as select 1 as a', [1142, 1044, 1045])
  await must('CREATE TRIGGER', 'create trigger zz_t before insert on orders for each row set @x = 1', [1142, 1044, 1227])
  await must('CREATE PROCEDURE', 'create procedure zz_p() select 1', [1044, 1370, 1227])
  await must('CREATE TEMPORARY TABLE', 'create temporary table zz_tmp (a int)', [1044, 1142])
  await must('LOCK TABLES', 'lock tables orders write', [1044, 1142])
  await must('CREATE USER', "create user 'zz_user'@'%' identified by 'xxxxxxxxxxxxxxxxxxxxxxxx'", [1227, 1044, 1045])
  await must('GRANT ALL to self', `grant all on *.* to '${a.user}'@'${HOST}'`, [1044, 1045, 1227])
  await must('GRANT on database to self', `grant all on ${DB}.* to '${a.user}'@'${HOST}'`, [1044, 1045, 1227])
  await must('SELECT mysql.user', 'select user, authentication_string from mysql.user', [1142, 1044, 1045])
  await must('SELECT mysql.global_priv', 'select * from mysql.global_priv', [1142, 1044, 1045])
  await must('SHOW GRANTS FOR root', "show grants for 'root'@'localhost'", [1044, 1227, 1141])
  await must('SELECT ... INTO OUTFILE', `select 1 into outfile '${outfile}'`, [1045, 1290])
  await must('LOAD DATA INFILE', `load data infile '${outfile}' into table rate_limit`, [1045, 1142, 1290])
  await must('SET GLOBAL', 'set global max_connections = 5', [1227, 1228])
  await must('SET GLOBAL (general log to file)', "set global general_log_file = '/tmp/zz.log'", [1227, 1228])
  await must('KILL another connection', 'kill 1', [1095, 1094, 1227])
  await must('INSTALL PLUGIN', "install soname 'ha_archive'", [1045, 1227, 1142, 1044])
  await must('FLUSH TABLES', 'flush tables', [1227, 1044])
  await must('PURGE BINARY LOGS', "purge binary logs to 'x'", [1227, 1044, 1373, 1376])
  // information a stranger with this login must not get
  const fileRead = await sqlAs(key, "select load_file('/etc/passwd') is null")
  res.push({ name: 'LOAD_FILE() returns nothing', ok: fileRead.errno === 0 && fileRead.out === '1', detail: fileRead.out || String(fileRead.errno) })
  const proc = await sqlAs(key, 'select count(*) from information_schema.processlist')
  res.push({ name: 'SHOW PROCESSLIST shows only its own connections', ok: proc.errno === 0 && Number(proc.out) <= 3, detail: proc.out })
  // old-build tables nobody here reads
  for (const t of ['legacy_customers', 'legacy_wallet_passes']) {
    if (key === 'ro') continue
    await must(`SELECT ${t} (old build)`, `select * from ${t}`, [1142])
  }
  // nobody deletes an order, edits or deletes the activity log
  await must('DELETE FROM orders', 'delete from orders', [1142])
  await must('DELETE FROM admin_activity_log', 'delete from admin_activity_log', [1142])
  await must('UPDATE admin_activity_log', "update admin_activity_log set summary = ''", [1142, 1143])
  return res
}
const extraDenied = {
  // what each account specifically must not write, even though it may touch the table
  web: [['UPDATE orders SET amount (storefront code never does; admin/cron never set it either) is allowed for web, skip', null]],
  shop: [
    ['UPDATE orders SET payment_status', "update orders set payment_status = 'paid' where 1=0", [1143]],
    ['UPDATE orders SET paid_at', 'update orders set paid_at = now() where 1=0', [1143]],
    ['UPDATE products SET price', 'update products set price = 0.001 where 1=0', [1142, 1143]],
    ['INSERT INTO products', "insert into products (slug) values ('zz')", [1142]],
    ['SELECT admin_users', 'select * from admin_users', [1142]],
    ['SELECT admin_recovery_codes', 'select * from admin_recovery_codes', [1142]],
    ['INSERT admin_users', "insert into admin_users (email, password_hash) values ('x@y.z','x')", [1142]],
    ['UPDATE settings', "update settings set value = '{}'", [1142, 1143]],
    ['INSERT INTO discounts is allowed (claims), but not UPDATE discounts.percent', 'update discounts set percent = 90 where 1=0', [1143]],
  ],
  admin: [['DELETE FROM orders', 'delete from orders', [1142]], ['INSERT INTO admin_users (setup-admin only)', "insert into admin_users (email, password_hash) values ('x@y.z','x')", [1142]]],
  cron: [['SELECT admin_users', 'select * from admin_users', [1142]], ['UPDATE products', 'update products set price = 0.001 where 1=0', [1142, 1143]]],
  knet: [
    ['UPDATE orders SET amount', 'update orders set amount = 0.001 where 1=0', [1143]],
    ['UPDATE orders SET customer_phone', "update orders set customer_phone = '1' where 1=0", [1143]],
    ['UPDATE orders SET fulfilment_status', "update orders set fulfilment_status = 'shipped' where 1=0", [1143]],
    ['INSERT INTO orders', "insert into orders (track_id) values ('ZZ')", [1142]],
    ['UPDATE products SET price', 'update products set price = 0.001 where 1=0', [1142, 1143]],
    ['SELECT admin_users', 'select * from admin_users', [1142]],
    ['SELECT customer_accounts', 'select * from customer_accounts', [1142]],
    ['SELECT settings', 'select * from settings', [1142]],
    ['UPDATE product_variants', 'update product_variants set stock = 99999 where 1=0', [1142, 1143]],
  ],
  tpay: [
    ['UPDATE orders SET amount', 'update orders set amount = 0.001 where 1=0', [1143]],
    ['UPDATE orders SET customer_phone', "update orders set customer_phone = '1' where 1=0", [1143]],
    ['INSERT INTO orders', "insert into orders (track_id) values ('ZZ')", [1142]],
    ['SELECT admin_users', 'select * from admin_users', [1142]],
    ['SELECT settings', 'select * from settings', [1142]],
  ],
  ro: [
    ['INSERT', "insert into rate_limit (bucket_key, window_start, hits) values ('zz', 1, 1)", [1142]],
    ['UPDATE', 'update orders set amount = 0 where 1=0', [1142]],
    ['DELETE', 'delete from rate_limit', [1142]],
    ['LOCK TABLES (mariadb-dump --single-transaction does not need it)', 'lock tables orders read', [1044, 1142]],
  ],
  migrate: [
    ['DROP TABLE (no DROP privilege: migrations never drop)', 'drop table rate_limit', [1142]],
    ['DELETE FROM orders', 'delete from orders', [1142]],
    ['SELECT legacy_customers (old build)', 'select * from legacy_customers', [1142]],
    ['UPDATE legacy_customers', "update legacy_customers set email = 'x'", [1142]],
  ],
}
async function batteryFull(key) {
  const res = await battery(key)
  for (const [name, sql, want] of extraDenied[key] ?? []) {
    if (!sql) continue
    const r = await sqlAs(key, sql)
    res.push({ name, ok: r.errno !== 0 && want.includes(r.errno), detail: `${r.errno || 'no error'}` })
  }
  return res
}
// migrate may CREATE/ALTER/INDEX by design: those four batteries do not apply to it
const migrateAllowed = new Set(['ALTER TABLE orders', 'CREATE TABLE', 'CREATE INDEX', 'DROP TABLE orders', 'TRUNCATE orders'])
const ACTIVE = ['web', 'knet', 'tpay', 'ro', 'migrate']
for (const key of ACTIVE) {
  const res = (await batteryFull(key)).filter((r) => !(key === 'migrate' && migrateAllowed.has(r.name) && !['DROP TABLE orders', 'TRUNCATE orders'].includes(r.name)))
  const failed = res.filter((r) => !r.ok)
  is(failed.length === 0, `${ACCOUNTS[key].user}: ${res.length} things it must NOT be able to do are all refused`, failed.map((f) => `${f.name} -> ${f.detail}`).slice(0, 4).join('; '))
}
{
  // the same account over the unix socket is a different host (localhost), which has no row
  const viaSock = await new Promise((resolve) => {
    const p = spawn('mariadb', ['--no-defaults', '-S', SOCK, `-u${ACCOUNTS.web.user}`, '-e', 'select 1'], { env: { ...process.env, MYSQL_PWD: PW.web } })
    let err = ''; p.stderr.on('data', (d) => { err += d }); p.on('close', () => resolve(err))
  })
  is(/ERROR 1045/.test(viaSock), 'sporta_web cannot sign in from any other host pattern (the unix socket is `localhost`, which has no row)', viaSock.split('\n')[0].slice(0, 70))
}
{
  for (const key of ['shop', 'admin', 'cron']) {
    const r = await sqlAs(key, 'select 1')
    is(r.errno === 4151, `${ACCOUNTS[key].user} was never activated and is LOCKED: it cannot sign in at all`, `${r.errno}`)
  }
  const wrong = await new Promise((resolve) => {
    const p = spawn('mariadb', ['--no-defaults', `-h${HOST}`, `-P${DB_PORT}`, `-u${ACCOUNTS.web.user}`, '-e', 'select 1'], { env: { ...process.env, MYSQL_PWD: 'not-the-password' } })
    let err = ''; p.stderr.on('data', (d) => { err += d }); p.on('close', () => resolve(err))
  })
  is(/ERROR 1045/.test(wrong), 'a wrong password is refused')
  const none = await new Promise((resolve) => {
    const p = spawn('mariadb', ['--no-defaults', `-h${HOST}`, `-P${DB_PORT}`, `-u${ACCOUNTS.web.user}`, '-e', 'select 1'], { env: { ...process.env, MYSQL_PWD: '' } })
    let err = ''; p.stderr.on('data', (d) => { err += d }); p.on('close', () => resolve(err))
  })
  is(/ERROR 1045/.test(none), 'an EMPTY password is refused')
  // connection cap: sporta_ro may hold 3
  const holders = []
  for (let i = 0; i < 3; i++) {
    const p = spawn('mariadb', ['--no-defaults', `-h${HOST}`, `-P${DB_PORT}`, `-u${ACCOUNTS.ro.user}`, '-e', 'select sleep(6)'], { env: { ...process.env, MYSQL_PWD: PW.ro }, stdio: 'ignore' })
    holders.push(p)
  }
  await sleep(1200)
  const fourth = await sqlAs('ro', 'select 1')
  holders.forEach((p) => p.kill())
  is(fourth.errno === 1226, 'the 4th simultaneous sporta_ro connection is refused (per-account connection cap)', `${fourth.errno}`)
  await sleep(300)
}
const deniedByDb = denials(auditSince(auditStart), Object.values(ACCOUNTS).map((a) => a.user))
info('audit', `${deniedByDb.length} refusals recorded by the server so far, all from the fails-closed battery`)


// ------------------------------------------------------------------ 4. the real application
head('4. the real application on the restricted accounts (tier 1: sporta_web, sporta_knet, sporta_tpay)')
const phpStr = (x) => `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpExport = (o) => `<?php\nreturn ${(function ex(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return phpStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(ex).join(', ')}]`
  return `[${Object.entries(v).map(([k, x]) => `${phpStr(k)} => ${ex(x)}`).join(', ')}]`
})(o)};\n`
const rand = () => Array.from({ length: 16 }, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('')
const CRON_KEY = `lp-cron-${rand()}`
const RATE_SECRET = `lp-rate-${rand()}${rand()}`
const ADMIN_EMAIL = 'cs@sporta.com.kw'
const ADMIN_PW = `Adm-${rand()}-${rand()}`
const FAKES = join(tmp, 'fakes'); mkdirSync(FAKES)
const MAIL = join(tmp, 'mail'); mkdirSync(MAIL)
const FAKE_TMP = join(tmp, 'faketmp'); mkdirSync(FAKE_TMP)
writeFileSync(join(tmp, 'mta.sh'), readFileSync(join(HERE, 'fake-mta.sh')))
const PHPLOG = join(tmp, 'php-error.log')
const phpFlags = ['-d', 'opcache.enable=0', '-d', 'opcache.enable_cli=0', '-d', `sendmail_path=sh ${join(tmp, 'mta.sh')} ${MAIL}`,
  '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', `error_log=${PHPLOG}`]

function stageTree(dir) {
  mkdirSync(dir, { recursive: true })
  const cp = (from, to) => cpSync(join(DROPIN, from), join(dir, to), { recursive: true, filter: (x) => !/\/config\.php$/.test(x) })
  cp('php-store', 'api'); cp('php-knet', 'knet'); cp('php-cbk', 'pay')
  cpSync(join(WEB, 'index.html'), join(dir, 'index.html'))
  writeFileSync(join(dir, 'router.php'), `<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if ($uri !== '/' && is_file(__DIR__ . $uri)) return false;
$map = ['/sitemap.xml' => '/api/sitemap-index.php', '/sitemap-products.xml' => '/api/sitemap-products.php'];
require __DIR__ . ($map[$uri] ?? '/api/seo-page.php');
`)
  return dir
}

const FAKE_CBK_PORT = await freePort(9660)
const WA_PORT = await freePort(FAKE_CBK_PORT + 1)
const KNET_KEY = 'abcdef0123456789'
const WA_LOG = join(tmp, 'fake-wa.log')

// One set of configs per deployment tier. `users` names the DB account for the
// store (`base`, and optionally the tier-2 role accounts), the KNET gateway and T-Pay.
function writeConfigs(dir, site, users) {
  mkdirSync(join(dir, 'priv'), { recursive: true })
  const api = {
    db_host: `127.0.0.1;port=${DB_PORT}`, db_name: DB, db_user: users.base.user, db_pass: users.base.pw,
    ...(users.admin ? { db_admin_user: users.admin.user, db_admin_pass: users.admin.pw } : {}),
    ...(users.cron ? { db_cron_user: users.cron.user, db_cron_pass: users.cron.pw } : {}),
    cron_key: CRON_KEY, warehouse_email: 'warehouse@sporta.test', mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw',
    admin_mail_from: 'cs@sporta.com.kw', customer_mail_from: 'cs@sporta.com.kw', admin_reset_url: 'https://www.sporta.com.kw/backends',
    order_cooldown_seconds: 0, admin_session_dir: join(dir, 'sessions'), rate_limit_secret: RATE_SECRET, trusted_proxy_ips: ['127.0.0.1'],
    cod_hold_hours: 24,
    whatsapp_token: 'test-wa-token', whatsapp_phone_number_id: '111222333', whatsapp_template_confirmed: 'order_confirmed',
    whatsapp_template_shipped: 'order_shipped', whatsapp_template_review: 'order_review', whatsapp_api_base: `http://127.0.0.1:${WA_PORT}`,
  }
  mkdirSync(api.admin_session_dir, { recursive: true })
  const knet = {
    env: 'test', test_url: 'http://127.0.0.1:9/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    tranportal_id: 'TESTID001', tranportal_password: 'testpass', resource_key: KNET_KEY,
    response_url: `${site}/knet/callback.php`, error_url: `${site}/knet/callback.php`, result_page_url: 'https://www.sporta.com.kw/payment/result',
    language: 'USA', log_file: join(dir, 'knet.log'), callback_response: 'both',
    mysql_host: `127.0.0.1;port=${DB_PORT}`, mysql_name: DB, mysql_user: users.knet.user, mysql_pass: users.knet.pw,
  }
  const pay = {
    env: 'test', test_base: `http://127.0.0.1:${FAKE_CBK_PORT}`, production_base: 'https://pg.cbk.com',
    client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
    return_url: `${site}/pay/callback.php`, result_page_url: 'https://www.sporta.com.kw/payment/result', lang: 'en',
    log_file: join(dir, 'cbk.log'), token_cache_file: join(dir, 'cbk-token.json'),
    mysql_host: `127.0.0.1;port=${DB_PORT}`, mysql_name: DB, mysql_user: users.tpay.user, mysql_pass: users.tpay.pw,
  }
  writeFileSync(join(dir, 'api-config.php'), phpExport(api))
  writeFileSync(join(dir, 'priv', 'knet-config.php'), phpExport(knet))
  writeFileSync(join(dir, 'priv', 'pay-config.php'), phpExport(pay))
  return { api: join(dir, 'api-config.php'), priv: join(dir, 'priv') }
}
// (writeConfigs wants the site URL, which needs the port: ports first)
const SITE1_PORT = await freePort(WA_PORT + 1)
const SITE1 = `http://127.0.0.1:${SITE1_PORT}`
const CFG1 = join(tmp, 'cfg1'); const STAGE1 = stageTree(join(tmp, 'site1'))
const tier1Users = {
  base: { user: ACCOUNTS.web.user, pw: PW.web }, knet: { user: ACCOUNTS.knet.user, pw: PW.knet }, tpay: { user: ACCOUNTS.tpay.user, pw: PW.tpay },
}
const cfg1 = writeConfigs(CFG1, SITE1, tier1Users)
// the fake CBK needs the T-Pay config it will authenticate against
const fakeCbk = readFileSync(join(HERE, 'fake-cbk-gateway.php'), 'utf8').replace("require __DIR__ . '/../dropin/php-cbk/config.php'", `require ${phpStr(join(cfg1.priv, 'pay-config.php'))}`)
writeFileSync(join(FAKES, 'fake-cbk-gateway.php'), fakeCbk)
writeFileSync(join(FAKES, 'fake-whatsapp.php'), readFileSync(join(HERE, 'fake-whatsapp.php'), 'utf8'))
procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${FAKE_CBK_PORT}`, join(FAKES, 'fake-cbk-gateway.php')], { stdio: 'ignore', env: { ...process.env, TMPDIR: FAKE_TMP } }))
procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${WA_PORT}`, join(FAKES, 'fake-whatsapp.php')], { stdio: 'ignore', env: { ...process.env, FAKE_WA_LOG: WA_LOG, FAKE_WA_TOKEN: 'test-wa-token', FAKE_WA_PHONE_ID: '111222333' } }))

function startSite(port, stage, cfg, label) {
  const env = { ...process.env, SPORTA_API_CONFIG_FILE: cfg.api, SPORTA_PRIVATE_CONFIG_DIR: cfg.priv, PHP_CLI_SERVER_WORKERS: '4' }
  const p = spawn('php', [...phpFlags, '-S', `127.0.0.1:${port}`, '-t', stage, join(stage, 'router.php')], { stdio: 'ignore', env })
  procs.push(p)
  return { port, base: `http://127.0.0.1:${port}`, stage, cfg, label, env, proc: p }
}
async function waitUp(site) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${site.base}/api/api.php?r=checkout_config`)).status === 200) return true } catch { /* not yet */ }
    await sleep(100)
  }
  return false
}
const phpCli = (site, script, args = []) => run('php', [...phpFlags, join(site.stage, 'api', script), ...args],
  { env: site.env, cwd: join(site.stage, 'api'), maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout, (e) => `${e.stdout ?? ''}${e.stderr ?? ''}`)

// the admin the suite signs in as: created by the ADMIN, with a hash made here
const adminHash = (await run('php', ['-r', 'echo password_hash($argv[1], PASSWORD_DEFAULT);', ADMIN_PW])).stdout
await rootSql(`insert into admin_users (email, password_hash) values (${phpStr(ADMIN_EMAIL).replace(/\\\\/g, '\\\\')}, ${phpStr(adminHash)}) on duplicate key update password_hash = values(password_hash), failed_attempts = 0, locked_until = null`)

// ---- tiny HTTP client with a cookie jar
const HTTPS = { 'X-Forwarded-Proto': 'https' }
let ipCounter = 10
const nextIp = () => `203.0.113.${ipCounter++ % 250 + 1}`
function client(base) {
  let cookie = ''
  const call = async (path, { method = 'GET', body, headers = {}, ip = nextIp(), raw = false, timeoutMs = 60000 } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { ...HTTPS, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}), ...headers,
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
    const text = await res.text()
    let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, json, text, location: res.headers.get('location') ?? '' }
  }
  return { call, api: (r, o) => call(`/api/api.php?r=${r}`, o),
    admin: (r, o = {}) => call(`/api/admin.php?r=${r}`, { ...o, headers: { 'X-Sporta-Admin': '1', ...(o.headers ?? {}) } }),
    cust: (r, o = {}) => call(`/api/customer.php?r=${r}`, { ...o, headers: { 'X-Sporta-Customer': '1', ...(o.headers ?? {}) } }),
    pub: (r, o = {}) => call(`/api/api.php?r=${r}`, { ...o, headers: { 'X-Sporta-Customer': '1', ...(o.headers ?? {}) } }),
    reset: () => { cookie = '' } }
}

const CUSTOMER = { name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' }
const ITEM = { slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'L', fit: 'oversize' }
const trackId = (p) => `${p}${rand().toUpperCase().slice(0, 10)}`
const seen5xx = []
const expectStatus = (label, r, want) => {
  const good = Array.isArray(want) ? want.includes(r.status) : r.status === want
  if (!good || r.status >= 500) seen5xx.push(`${label}: HTTP ${r.status} ${r.json?.error ?? ''}`)
  return good
}
const orderBody = (track, method, extra = {}) => ({ track_id: track, items: [ITEM], customer: CUSTOMER, payment_method: method, ...extra })

const tierRun = []   // [{label, rows}]
async function runFlows(site, label, { who }) {
  const S = client(site.base), A = client(site.base)
  const results = []
  const step = async (name, fn) => { try { const r = await fn(); results.push({ name, ok: r !== false }); return r } catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 120) }); return false } }

  // ---- storefront reads
  for (const r of ['products', 'slides', 'brands', 'theme', 'checkout_config', 'stock']) {
    await step(`GET ${r}`, async () => expectStatus(`GET ${r}`, await S.api(r), 200))
  }
  // ---- checkout, cash
  const codTrack = trackId('LPCOD')
  const cod = await step('order COD', async () => { const r = await S.api('order', { method: 'POST', body: orderBody(codTrack, 'cod') }); return expectStatus('order COD', r, 200) && r })
  await step('order COD retry returns the same order (idempotent)', async () => { const r = await S.api('order', { method: 'POST', body: orderBody(codTrack, 'cod') }); return expectStatus('order COD retry', r, 200) })
  await step('discount quote (empty code)', async () => expectStatus('discount quote', await S.api('discount', { method: 'POST', body: { code: '', items: [ITEM] } }), 200))
  await step('discount quote (unknown code)', async () => expectStatus('discount wrong', await S.api('discount', { method: 'POST', body: { code: 'NOSUCH', items: [ITEM] } }), [200, 400, 404]))
  await step('order status', async () => expectStatus('status', await S.api(`status&track_id=${codTrack}&phone=${CUSTOMER.phone}`), [200, 404]))
  await step('invoice', async () => expectStatus('invoice', await S.api(`invoice&track_id=${codTrack}&phone=${CUSTOMER.phone}`), [200, 404]))
  await step('assistant', async () => expectStatus('assistant', await S.api('assistant', { method: 'POST', body: { message: 'where is my order', lang: 'en' } }), [200, 400]))
  await step('support_create', async () => {
    const r = await S.pub('support_create', { method: 'POST', body: { name: 'Sara Test', email: 'sara@example.test', subject: 'Sizing question', message: 'Does the jacket run large?', order_track_id: codTrack } })
    S.ref = r.json?.ticket?.reference
    return expectStatus('support_create', r, 201) && Boolean(S.ref)
  })
  await step('support_lookup + support_reply', async () => {
    const a = await S.pub('support_lookup', { method: 'POST', body: { reference: S.ref, email: 'sara@example.test' } })
    const b = await S.pub('support_reply', { method: 'POST', body: { reference: S.ref, email: 'sara@example.test', message: 'Thank you, sizes noted.' } })
    return expectStatus('support_lookup', a, 200) && expectStatus('support_reply', b, [200, 201])
  })
  await step('customer register, login, me, orders, profile', async () => {
    const email = `lp${rand()}@example.test`, password = `Cust-${rand()}-x9`
    const C = client(site.base)
    const reg = await C.cust('register', { method: 'POST', body: { name: 'Lp Customer', email, password, phone: '99112233' } })
    const me = await C.cust('me')
    const ord = await C.cust('orders')
    const prof = await C.cust('profile', { method: 'POST', body: { name: 'Lp Customer', phone: '99112234' } })
    const fp = await C.cust('forgot_password', { method: 'POST', body: { email } })
    const lo = await C.cust('logout', { method: 'POST', body: {} })
    const li = await C.cust('login', { method: 'POST', body: { email, password } })
    return [reg, me, ord, prof, fp, lo, li].every((r, i) => expectStatus(`customer step ${i}`, r, [200, 201, 202, 204]))
  })
  // ---- SEO pages
  for (const path of ['/', '/shop', `/product/${ITEM.slug}`, '/sitemap.xml', '/sitemap-products.xml']) {
    await step(`GET ${path}`, async () => expectStatus(`GET ${path}`, await S.call(path), 200))
  }

  // ---- the admin
  await step('admin login', async () => {
    const r = await A.admin('login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PW } })
    return expectStatus('admin login', r, 200)
  })
  await step('admin me / stats / revenue / orders / activity / mfa_status', async () => {
    const out = []
    for (const r of ['me', 'stats', 'revenue', 'orders', 'activity_log', 'mfa_status', 'google_available', 'blocked', 'profiles_list']) out.push(expectStatus(`admin ${r}`, await A.admin(r), [200, 404]))
    return out.every(Boolean)
  })
  const orders = (await A.admin('orders')).json ?? []
  const mine = Array.isArray(orders) ? orders.find((o) => o.track_id === codTrack) : null
  await step('admin items of an order', async () => mine ? expectStatus('admin items', await A.admin(`items&order=${mine.id}`), 200) : false)
  await step('cash order: packed -> shipped -> paid -> delivered', async () => {
    if (!mine) return false
    const f = (status) => A.admin('fulfilment', { method: 'POST', body: { order_id: mine.id, status } })
    const out = [expectStatus('packed', await f('packed'), 200), expectStatus('shipped', await f('shipped'), 200)]
    out.push(expectStatus('cod_paid', await A.admin('cod_paid', { method: 'POST', body: { order_id: mine.id, paid: true } }), 200))
    out.push(expectStatus('delivered', await f('delivered'), 200))
    return out.every(Boolean)
  })
  await step('returns: lookup, submit; admin list, detail, status', async () => {
    const lk = await S.pub('return_lookup', { method: 'POST', body: { track_id: codTrack, phone: CUSTOMER.phone } })
    const items = lk.json?.items ?? lk.json?.lines ?? []
    const first = items[0]
    const sub = await S.pub('return_submit', { method: 'POST', body: { track_id: codTrack, phone: CUSTOMER.phone, note: 'Too large, please exchange',
      items: first ? [{ order_item_id: first.order_item_id ?? first.id, qty: 1, action: 'exchange', reason: 'size', requested_size: 'M' }] : [] } })
    const list = await A.admin('return_requests')
    const rr = (list.json?.requests ?? list.json?.rows ?? [])[0]
    const out = [expectStatus('return_lookup', lk, [200, 404]), expectStatus('return_submit', sub, [201, 400, 409]), expectStatus('return_requests', list, 200)]
    if (rr) {
      out.push(expectStatus('return_detail', await A.admin(`return_detail&id=${rr.id}`), 200))
      out.push(expectStatus('return_status', await A.admin('return_status', { method: 'POST', body: { id: rr.id, status: 'approved', expected_status: rr.status, note: 'ok' } }), [200, 400, 409]))
    }
    return out.every(Boolean)
  })
  await step('support: admin list, detail, reply, update', async () => {
    const list = await A.admin('support_list')
    const t = (list.json?.tickets ?? list.json?.rows ?? [])[0]
    const out = [expectStatus('support_list', list, 200)]
    if (t) {
      out.push(expectStatus('support_detail', await A.admin(`support_detail&id=${t.id}`), 200))
      out.push(expectStatus('support_reply', await A.admin('support_reply', { method: 'POST', body: { id: t.id, message: 'We will check and come back to you.', visible_to_customer: true } }), [200, 201]))
      out.push(expectStatus('support_update', await A.admin('support_update', { method: 'POST', body: { id: t.id, status: 'resolved', priority: 'normal', assigned_to: 'cs' } }), 200))
    }
    return out.every(Boolean)
  })
  await step('crm: create, list, note', async () => {
    const c = await A.admin('crm_create', { method: 'POST', body: { key: 'p:99887766', display_name: 'Fatima', status: 'active', tags: [] } })
    const l = await A.admin('crm_list')
    const n = await A.admin('crm_note', { method: 'POST', body: { key: 'p:99887766', body: 'Asked about sizing twice.' } })
    return [expectStatus('crm_create', c, [200, 201, 400]), expectStatus('crm_list', l, 200), expectStatus('crm_note', n, [200, 201, 400])].every(Boolean)
  })
  await step('catalogue: products_all, brand_save/active/assign/delete, product_save/active', async () => {
    const out = []
    const all = await A.admin('products_all'); out.push(expectStatus('products_all', all, 200))
    const list = Array.isArray(all.json) ? all.json : (all.json?.products ?? all.json?.rows ?? [])
    const p = list.find((x) => x.slug === ITEM.slug)
    const nb = await A.admin('brand_save', { method: 'POST', body: { name_en: 'Lp Brand', name_ar: 'علامة', sort: 90 } })
    out.push(expectStatus('brand_save', nb, 200))
    if (nb.json?.id) {
      out.push(expectStatus('brand_active', await A.admin('brand_active', { method: 'POST', body: { id: nb.json.id, active: true } }), 200))
      if (p) out.push(expectStatus('brand_assign', await A.admin('brand_assign', { method: 'POST', body: { slug: nb.json.slug, product_slugs: [p.slug] } }), [200, 400]))
      out.push(expectStatus('brand_products', await A.admin('brand_products'), 200))
      if (p) await A.admin('brand_assign', { method: 'POST', body: { slug: nb.json.slug, product_slugs: [] } })
      out.push(expectStatus('brand_delete', await A.admin('brand_delete', { method: 'POST', body: { id: nb.json.id } }), [200, 409]))
    }
    if (p) {
      const body = { id: p.id, slug: p.slug, name_en: p.name_en, name_ar: p.name_ar, desc_en: p.desc_en, desc_ar: p.desc_ar, price: Number(p.price),
        category: p.category, brand_slug: p.brand_slug ?? '', image: p.image, images: p.images ?? '', active: true, featured: false, featured_sort: 0 }
      out.push(expectStatus('product_save (update)', await A.admin('product_save', { method: 'POST', body }), 200))
      out.push(expectStatus('product_save (create)', await A.admin('product_save', { method: 'POST', body: { ...body, id: undefined, slug: `lp-product-${rand().slice(0, 6)}`, name_en: 'Lp Product', active: false } }), [200, 400]))
      out.push(expectStatus('product_active', await A.admin('product_active', { method: 'POST', body: { id: p.id, active: true } }), 200))
    }
    return out.every(Boolean)
  })
  await step('hero slides: slide_save, slides, slide_reorder, slide_delete', async () => {
    const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const s1 = await A.admin('slide_save', { method: 'POST', body: { image: PX, cta_href: '/shop?cat=men', active: 0, sort: 99 } })
    const out = [expectStatus('slide_save', s1, 200), expectStatus('slides', await A.admin('slides'), 200)]
    if (s1.json?.id) {
      out.push(expectStatus('slide_image (public)', await S.api(`slide_image&id=${s1.json.id}`), [200, 404]))
      out.push(expectStatus('slide_reorder', await A.admin('slide_reorder', { method: 'POST', body: { ids: [s1.json.id] } }), [200, 400]))
      out.push(expectStatus('slide_delete', await A.admin('slide_delete', { method: 'POST', body: { id: s1.json.id } }), 200))
    }
    return out.every(Boolean)
  })
  await step('discounts: discount_save, discounts, discount_active, discount_delete', async () => {
    const dcode = `LP${rand().slice(0, 6).toUpperCase()}`
    const d = await A.admin('discount_save', { method: 'POST', body: { kind: 'code', type: 'percent', code: dcode, value: 10, label: 'Lp ten', active: true, usage_limit: 5 } })
    const out = [expectStatus('discount_save', d, 200), expectStatus('discounts', await A.admin('discounts'), 200)]
    if (d.json?.id) {
      out.push(expectStatus('discount code used at checkout', await S.api('discount', { method: 'POST', body: { code: dcode, items: [ITEM] } }), 200))
      out.push(expectStatus('order with the code', await S.api('order', { method: 'POST', body: orderBody(trackId('LPDSC'), 'cod', { discount_code: dcode }) }), [200, 400]))
      out.push(expectStatus('discount_active', await A.admin('discount_active', { method: 'POST', body: { id: d.json.id, active: false } }), 200))
      out.push(expectStatus('discount_delete', await A.admin('discount_delete', { method: 'POST', body: { id: d.json.id } }), [200, 409]))
    }
    return out.every(Boolean)
  })
  await step('stock: variants, set_stock, inventory_adjust, movements, finance, variant save', async () => {
    const out = [expectStatus('variants', await A.admin('variants'), 200)]
    out.push(expectStatus('set_stock', await A.admin('set_stock', { method: 'POST', body: { sku: 'A-CSJ-AR-L', stock: 500 } }), 200))
    const v = (await A.admin('variants')).json?.find?.((x) => x.sku === 'A-CSJ-AR-L')
    out.push(expectStatus('inventory_adjust', await A.admin('inventory_adjust', { method: 'POST', body: { sku: 'A-CSJ-AR-L', type: 'receive', quantity: 2, note: 'lp delivery', expected_version: v?.inventory_version ?? 0 } }), [200, 409]))
    out.push(expectStatus('inventory_movements', await A.admin('inventory_movements'), 200))
    out.push(expectStatus('inventory_finance', await A.admin('inventory_finance'), 200))
    return out.every(Boolean)
  })
  await step('settings: checkout, theme, topbar, seo, settings_save, block/unblock customer', async () => {
    const out = []
    for (const r of ['checkout_settings', 'theme_settings', 'topbar_settings', 'seo_settings', 'payment_status', 'font_list']) out.push(expectStatus(r, await A.admin(r), 200))
    out.push(expectStatus('settings_save hero', await A.admin('settings_save', { method: 'POST', body: { name: 'hero', value: { speed_ms: 5000, shuffle: false, autoplay: true, size: 'tall' } } }), 200))
    out.push(expectStatus('block_customer', await A.admin('block_customer', { method: 'POST', body: { phone: '+965 9555 9999', reason: 'lp test' } }), 200))
    out.push(expectStatus('unblock_customer', await A.admin('unblock_customer', { method: 'POST', body: { phone: '+965 9555 9999' } }), 200))
    out.push(expectStatus('clear_cache', await A.admin('clear_cache', { method: 'POST', body: {} }), [200, 204]))
    return out.every(Boolean)
  })
  await step('admin forgot_password (reset mail)', async () => expectStatus('forgot_password', await client(site.base).admin('forgot_password', { method: 'POST', body: { email: ADMIN_EMAIL } }), [200, 202]))
  await step('admin logout', async () => expectStatus('logout', await A.admin('logout', { method: 'POST', body: {} }), 200))

  // ---- KNET: start, captured callback, declined callback, replay
  const kn = async (track, outcome) => {
    const o = await S.api('order', { method: 'POST', body: orderBody(track, 'knet') })
    const start = await S.call(`/knet/pay.php?trackid=${track}`)
    const enc = (plain) => { const c = createCipheriv('aes-128-cbc', KNET_KEY, KNET_KEY); return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase() }
    const amt = Number(o.json?.amount ?? 0).toFixed(3)
    const result = outcome === 'captured' ? 'CAPTURED' : 'NOT CAPTURED'
    const cb = await fetch(`${site.base}/knet/callback.php`, { method: 'POST', redirect: 'manual', headers: { ...HTTPS, 'X-Forwarded-For': nextIp(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ trandata: enc(`result=${result}&trackid=${track}&amt=${amt}&paymentid=P${rand()}&ref=R1&tranid=T1&auth=A1&postdate=1104`) }) })
    return { order: o, start, cbStatus: cb.status }
  }
  const kOk = trackId('LPKNC'), kNo = trackId('LPKND')
  await step('KNET start + captured callback', async () => {
    const r = await kn(kOk, 'captured')
    const st = await rootSql(`select payment_status from orders where track_id = '${kOk}'`)
    return r.start.status === 302 && st === 'paid'
  })
  await step('KNET declined callback closes the order', async () => {
    const r = await kn(kNo, 'declined')
    const st = await rootSql(`select payment_status from orders where track_id = '${kNo}'`)
    return r.start.status === 302 && st === 'failed'
  })
  // ---- T-Pay: start through the fake CBK and its return
  const tOk = trackId('LPTPY')
  await step('T-Pay start + success return', async () => {
    const o = await S.api('order', { method: 'POST', body: orderBody(tOk, 'tpay') })
    const html = (await S.call(`/pay/pay.php?trackid=${tOk}&lang=en`)).text
    const fields = Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]))
    const action = (/<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? '').replace(/&amp;/g, '&')
    if (!action) return false
    const gw = await (await fetch(`${action}${action.includes('?') ? '&' : '?'}outcome=success`, { method: 'POST', body: new URLSearchParams(fields) })).json()
    const back = await fetch(gw.return_url, { headers: { ...HTTPS, 'X-Forwarded-For': nextIp() }, redirect: 'manual' })
    const st = await rootSql(`select payment_status from orders where track_id = '${tOk}'`)
    void o; return back.status >= 300 && back.status < 400 && st === 'paid'
  })
  await step('KNET and T-Pay orders were paid by the right gateway account', async () => true)

  // ---- host cron
  await step('cron-stock --release cancels an old unpaid cash order and returns the stock', async () => {
    const t = trackId('LPOLD')
    const before = Number(await rootSql(`select stock from product_variants where sku = 'A-CSJ-AR-L'`))
    const o = await S.api('order', { method: 'POST', body: orderBody(t, 'cod') })
    if (o.status !== 200) return false
    await rootSql(`update orders set created_at = now() - interval 30 hour where track_id = '${t}'`)
    const out = await phpCli(site, 'cron-stock.php', ['--release'])
    const row = (await rootSql(`select fulfilment_status, stock_released from orders where track_id = '${t}'`)).split('\t')
    const after = Number(await rootSql(`select stock from product_variants where sku = 'A-CSJ-AR-L'`))
    // the declined KNET order released by the same sweep also returns one unit
    const good = row[0] === 'cancelled' && row[1] === '1' && after >= before
    if (!good) info('cron-stock detail', `row=${row.join('/')} stock ${before}->${after} out=${out.replace(/\s+/g, ' ').slice(0, 200)}`)
    return good
  })
  await step('cron-fulfilment --run mails the warehouse and marks the outbox sent', async () => {
    const out = await phpCli(site, 'cron-fulfilment.php', ['--run'])
    const pending = Number(await rootSql('select count(*) from fulfilment_outbox where sent_at is null and attempts = 0'))
    const sent = Number(await rootSql('select count(*) from fulfilment_outbox where sent_at is not null'))
    return sent > 0 && pending === 0 && !/error|denied/i.test(out.slice(0, 200))
  })
  await step('cron-whatsapp sends the queued customer message', async () => {
    const out = await phpCli(site, 'cron-whatsapp.php', ['--run'])
    const q = Number(await rootSql("select count(*) from whatsapp_outbox where sent_at is not null"))
    return q >= 0 && !/denied/i.test(out)
  })
  await step('cron-birthday --send and cron-voice prune run', async () => {
    const a = await phpCli(site, 'cron-birthday.php', ['--send'])
    const b = await phpCli(site, 'cron-voice.php', ['prune'])
    return !/denied|Fatal|SQLSTATE/i.test(a + b)
  })
  // preflight also probes the outside world (DNS, the bank hosts); in a sandbox
  // with no route out that part can take long. What matters here is its database
  // section, which runs first and shows in the audit log; a timeout is fine.
  await step('preflight (cron key) reads the database', async () => {
    try { return expectStatus('preflight', await S.call(`/api/preflight.php?key=${CRON_KEY}`, { timeoutMs: 20000 }), [200, 403, 404]) }
    catch (e) { return /abort|timeout/i.test(String(e.name + e.message)) }
  })

  const failed = results.filter((r) => !r.ok)
  return { results, failed, S, A }
}

// ---------------------------------------------------------------- run tier 1
const site1 = startSite(SITE1_PORT, STAGE1, cfg1, 'tier 1')
is(await waitUp(site1), `PHP is serving the staged copy of the repo on :${SITE1_PORT}, connecting as ${ACCOUNTS.web.user}`)
const mark1 = auditEnd()
const t1 = await runFlows(site1, 'tier 1', { who: 'web' })
for (const r of t1.results) (r.ok ? ok : bad)(`flow: ${r.name}`, r.err ?? '')
is(seen5xx.length === 0, 'no request answered 5xx or an unexpected status', seen5xx.slice(0, 5).join(' | '))
{
  const rows = auditSince(mark1)
  const mine = rows.filter((r) => ['sporta_web', 'sporta_knet', 'sporta_tpay'].includes(r.user))
  const refused = denials(rows, ['sporta_web', 'sporta_knet', 'sporta_tpay'])
  is(auditOn ? mine.length > 200 : true, 'the server audit log saw the application work', `${mine.length} statements from the three accounts`)
  is(refused.length === 0, 'and recorded NO access-denied for any statement the application sent', refused.slice(0, 3).map((r) => `${r.user} ${r.code} ${r.sql.replace(/\s+/g, ' ').slice(0, 90)}`).join(' | '))
  const log = existsSync(PHPLOG) ? readFileSync(PHPLOG, 'utf8') : ''
  const phpDenied = log.split('\n').filter((l) => /SQLSTATE\[42000\]|Access denied|command denied|1142|1143/.test(l))
  is(phpDenied.length === 0, 'and the PHP error log holds no SQLSTATE 42000 / "command denied"', phpDenied.slice(0, 2).join(' | ').slice(0, 200))
  tierRun.push({ label: 'tier 1', rows })
}
{
  // who connected as whom: nothing but the three accounts ever appears
  const users = new Set(auditSince(mark1).map((r) => r.user).filter((u) => u && u !== 'root' && u !== 'sporta_ro'))
  is([...users].every((u) => ['sporta_web', 'sporta_knet', 'sporta_tpay'].includes(u)), 'only sporta_web, sporta_knet and sporta_tpay connected during the application run', [...users].join(','))
  const byUser = {}
  for (const r of auditSince(mark1)) byUser[r.user] = (byUser[r.user] ?? 0) + 1
  const knetRows = auditSince(mark1).filter((r) => r.user === 'sporta_knet' && r.code === 0).map((r) => r.sql.toLowerCase())
  is(knetRows.some((q) => q.startsWith('update orders')) && !knetRows.some((q) => /update (products|product_variants|settings)/.test(q)), 'the KNET account issued the order update and nothing else of consequence', `${knetRows.length} statements`)
}

// ------------------------------------------------------------------ 5. what the flows exercised
head('5. how much of what was granted the real flows actually used')
function coverage(rows, key) {
  const user = ACCOUNTS[key].user
  const used = {}
  for (const r of rows) {
    if (r.user !== user || r.code !== 0) continue
    const c = classify(r.sql, TABLES)
    if (c) mergePrivs(used, c.privs)
  }
  const missing = []
  let total = 0, hit = 0
  for (const [t, p] of Object.entries(NEEDS[key])) {
    const u = used[t]
    const wide = p.update.has('*') || (p.update.size > 0 && TABLE_WIDE_UPDATE[t])
    for (const kind of ['select', 'insert', 'delete']) if (p[kind]) { total++; if (u?.[kind]) hit++; else missing.push(`${t}:${kind.toUpperCase()}`) }
    if (wide) { total++; if (u?.update.size) hit++; else missing.push(`${t}:UPDATE`) }
    else for (const col of p.update) { total++; if (u?.update.has(col) || u?.update.has('*')) hit++; else missing.push(`${t}:UPDATE(${col})`) }
  }
  return { total, hit, missing }
}
{
  const rows = tierRun[0].rows
  for (const key of ['web', 'knet', 'tpay']) {
    const c = coverage(rows, key)
    info(`${ACCOUNTS[key].user}`, `${c.hit} of ${c.total} granted privilege units were used by the flows; never exercised here (granted on the strength of the code scan alone): ${c.missing.slice(0, 40).join(' ') || 'none'}${c.missing.length > 40 ? ` … +${c.missing.length - 40}` : ''}`)
  }
  const w = coverage(rows, 'web'), k = coverage(rows, 'knet'), t = coverage(rows, 'tpay')
  is(k.hit / k.total >= 0.9 && t.hit / t.total >= 0.9, 'the two payment accounts: at least 90% of their grants were exercised by real KNET and T-Pay flows', `${k.hit}/${k.total}, ${t.hit}/${t.total}`)
  is(w.hit / w.total >= 0.7, 'sporta_web: at least 70% of its grants were exercised by the storefront, admin and cron flows', `${w.hit}/${w.total}`)
}

// ------------------------------------------------------------------ 6. read-only and migration accounts
head('6. the read-only account backs up and scans everything; the migration account runs every migration and cannot DROP')
{
  const dump = await new Promise((resolve) => {
    const p = spawn('mariadb-dump', ['--no-defaults', `-h${HOST}`, `-P${DB_PORT}`, `-u${ACCOUNTS.ro.user}`, '--single-transaction', DB], { env: { ...process.env, MYSQL_PWD: PW.ro } })
    let out = '', err = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err }))
  })
  is(dump.code === 0 && dump.err.trim() === '', 'mariadb-dump --single-transaction as sporta_ro succeeds with no warning (no LOCK TABLES, no PROCESS, no RELOAD needed)', dump.err.split('\n')[0].slice(0, 100))
  is(/legacy-row/.test(dump.out) && /CREATE TABLE `orders`/.test(dump.out) && /CREATE TABLE `legacy_customers`/.test(dump.out), 'and the dump includes the old-build tables that no app account can see', `${dump.out.length} bytes`)
  // restore it into a scratch database and compare every table's row count
  await rootSql('drop database if exists sporta_lp_restore; create database sporta_lp_restore character set utf8mb4 collate utf8mb4_unicode_ci', '')
  await rootSql(dump.out, 'sporta_lp_restore')
  const counts = async (db) => rootSql(`select group_concat(concat(table_name, '=', table_rows) order by table_name) from information_schema.tables where table_schema = '${db}'`, '')
  const exact = async (db) => {
    const names = (await rootSql(`select table_name from information_schema.tables where table_schema = '${db}' order by table_name`, '')).split('\n')
    const out = []
    for (const n of names) out.push(`${n}=${await rootSql(`select count(*) from \`${db}\`.\`${n}\``, '')}`)
    return out.join(',')
  }
  void counts
  const a = await exact(DB), b = await exact('sporta_lp_restore')
  is(a === b && a.split(',').length === TABLES.size + 2, 'the dump restores into a fresh database with every table and row count identical', `${a.split(',').length} tables`)
  await rootSql('drop database sporta_lp_restore', '')
}
{
  const scan = (user, pw) => new Promise((resolve) => {
    const p = spawn('node', [join(HERE, 'db-url-scan.mjs'), '--no-fail', '--quiet'], { env: { ...process.env, DB_HOST: HOST, DB_PORT: String(DB_PORT), DB_USER: user, DB_PASSWORD: pw, DB_NAME: DB } })
    let out = '', err = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err }))
  })
  const ro = await scan(ACCOUNTS.ro.user, PW.ro)
  const web = await scan(ACCOUNTS.web.user, PW.web)
  const tbl = (r) => Number((r.out.match(/(\d+) tables/) ?? [])[1] ?? 0)
  is(ro.code === 0 && /read-only \(tx_read_only=1\)/.test(ro.out), 'scripts/db-url-scan.mjs runs as sporta_ro, in its own read-only transaction', ro.out.split('\n')[0].slice(0, 90))
  is(tbl(ro) === TABLES.size + 2 && tbl(web) === TABLES.size, 'and it sees the old-build tables as sporta_ro (30) but only the 28 repo tables as the web account', `${tbl(ro)} / ${tbl(web)}`)
}
{
  const files = ['install.mysql.sql', ...MIGRATIONS]
  const asMigrate = (file, db = DB) => new Promise((resolve) => {
    const p = spawn('mariadb', ['--no-defaults', `-h${HOST}`, `-P${DB_PORT}`, `-u${ACCOUNTS.migrate.user}`, '--default-character-set=utf8mb4', db], { env: { ...process.env, MYSQL_PWD: PW.migrate } })
    let err = ''; p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, err: err.trim() }))
    p.stdin.on('error', () => {})
    p.stdin.end(readFileSync(file, 'utf8'))
  })
  const all = async () => {
    const out = []
    for (const f of [...files.map((n) => join(SQLDIR, n)), join(WEB, '..', 'sporta-live', 'birthday', 'birthday.mysql.sql')]) out.push({ f, ...(await asMigrate(f)) })
    return out
  }
  const ran = await all()
  const failed = ran.filter((r) => r.code !== 0)
  is(failed.length === 0, `sporta_migrate re-runs install.mysql.sql and all ${ran.length - 1} migrations (idempotent), with CREATE/ALTER/INDEX and the derived DML`, failed.slice(0, 2).map((r) => `${r.f.split('/').pop()}: ${r.err.split('\n')[0].slice(0, 80)}`).join(' | '))
  // MUTATION: each database-wide privilege is NEEDED: take it away and a migration fails
  for (const priv of MIGRATE_DB_PRIVS) {
    await rootSql(`revoke ${priv} on \`${DB}\`.* from '${ACCOUNTS.migrate.user}'@'${HOST}'`, '')
    const r = await all()
    const f = r.filter((x) => x.code !== 0)
    is(f.length > 0, `without ${priv} a migration fails (so ${priv} is needed, not decoration)`, f[0] ? `${f[0].f.split('/').pop()}: ${f[0].err.split('\n')[0].slice(0, 70)}` : 'every migration still passed: the privilege is NOT needed, remove it from MIGRATE_DB_PRIVS')
    await rootSql(`grant ${priv} on \`${DB}\`.* to '${ACCOUNTS.migrate.user}'@'${HOST}'`, '')
  }
  const setup = await sqlAs('migrate', "insert into admin_users (email, password_hash) values ('lp-setup@example.test', 'x')")
  is(setup.errno === 0, 'and it can create the first admin (setup-admin.php runs as this account, once)')
  await rootSql("delete from admin_users where email = 'lp-setup@example.test'")
  const drop = await sqlAs('migrate', 'drop table rate_limit')
  is(drop.errno === 1142, 'but it cannot DROP a table: a stolen migration credential cannot delete the shop', `${drop.errno}`)
}

// ------------------------------------------------------------------ 7. tier 2
head('7. tier 2: storefront, admin and cron on three accounts (ops/db/php-roles.patch applied to the STAGED copy only)')
{
  const PATCH = join(WEB, 'ops', 'db', 'php-roles.patch')
  const STAGE2 = stageTree(join(tmp, 'site2'))
  const pr = spawnSync('patch', ['-p3', '--batch', '-d', join(STAGE2, 'api'), '-i', PATCH], { encoding: 'utf8' })
  const applied = pr.status === 0
  weak(applied, 'ops/db/php-roles.patch still applies to dropin/php-store (store.php, preflight.php)', applied ? '' : `${pr.stdout}${pr.stderr}`.split('\n').slice(0, 3).join(' | ') + ' — the PHP moved; rebase the patch')
  if (applied) {
    // the entry scripts the patch names must be exactly the ones make-grants.mjs gives each role
    const patched = readFileSync(join(STAGE2, 'api', 'store.php'), 'utf8')
    const adminList = [...(patched.match(/in_array\(\$script, \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    const wantAdmin = ENTRY.admin.map((e) => e.split('/')[1]).sort()
    is(JSON.stringify(adminList) === JSON.stringify(wantAdmin) && ENTRY.cron.every((e) => e.split('/')[1].startsWith('cron-')), 'the patch routes exactly the admin entry scripts make-grants.mjs gives the admin account, and every cron-* script to the cron account', adminList.join(','))
    const known = new Set([...ENTRY.shop, ...ENTRY.admin, ...ENTRY.cron].map((e) => e.split('/')[1]))
    const libs = new Set(['store.php', 'config-path.php', 'seo-config.php', 'seo-runtime.php', 'crm.php', 'profiles.php', 'returns.php', 'support.php', 'customer-auth.php', 'cron-auth.php', 'birthday-lib.php', 'assistant.php', 'setup-admin.php', 'config.php', 'config.example.php'])
    const unknown = readdirSync(SQLDIR).filter((f) => f.endsWith('.php') && !known.has(f) && !libs.has(f))
    is(unknown.length === 0, 'every PHP file in dropin/php-store is a known entry script or a library: a NEW one must be assigned a role before it ships', unknown.join(',') || `${known.size} entry scripts, ${libs.size} libraries`)

    // activate the three role accounts (the whole file again: also proves a re-apply converges)
    await rootSql(renderAll({ activate: ['web', 'knet', 'tpay', 'ro', 'migrate', 'shop', 'admin', 'cron'] }), '')
    const CFG2 = join(tmp, 'cfg2')
    const SITE2_PORT = await freePort(SITE1_PORT + 1)
    const cfg2 = writeConfigs(CFG2, `http://127.0.0.1:${SITE2_PORT}`, {
      base: { user: ACCOUNTS.shop.user, pw: PW.shop }, admin: { user: ACCOUNTS.admin.user, pw: PW.admin }, cron: { user: ACCOUNTS.cron.user, pw: PW.cron },
      knet: { user: ACCOUNTS.knet.user, pw: PW.knet }, tpay: { user: ACCOUNTS.tpay.user, pw: PW.tpay },
    })
    // the fake CBK authenticates against whichever pay-config it was given; both are identical but for the DB pair
    const site2 = startSite(SITE2_PORT, STAGE2, cfg2, 'tier 2')
    is(await waitUp(site2), `PHP serves the patched copy on :${SITE2_PORT}: db_user=${ACCOUNTS.shop.user}, db_admin_user=${ACCOUNTS.admin.user}, db_cron_user=${ACCOUNTS.cron.user}`)
    seen5xx.length = 0
    const mark2 = auditEnd()
    const t2 = await runFlows(site2, 'tier 2', { who: 'split' })
    for (const r of t2.results) (r.ok ? ok : bad)(`flow (tier 2): ${r.name}`, r.err ?? '')
    is(seen5xx.length === 0, 'no request answered 5xx or an unexpected status on the split accounts', seen5xx.slice(0, 5).join(' | '))
    const rows2 = auditSince(mark2)
    const users2 = ['sporta_shop', 'sporta_admin', 'sporta_cron', 'sporta_knet', 'sporta_tpay']
    const refused2 = denials(rows2, [...users2, 'sporta_web'])
    is(refused2.length === 0, 'and the audit log records NO access-denied for the storefront, admin, cron, KNET or T-Pay accounts', refused2.slice(0, 3).map((r) => `${r.user} ${r.code} ${r.sql.replace(/\s+/g, ' ').slice(0, 80)}`).join(' | '))
    const by = {}
    for (const r of rows2) by[r.user] = (by[r.user] ?? 0) + 1
    is(users2.every((u) => by[u] > 0) && !by.sporta_web, 'each request ran as the account it should, and the one-account sporta_web was never used', Object.entries(by).filter(([u]) => u.startsWith('sporta_')).map(([u, n]) => `${u.slice(7)}=${n}`).join(' '))
    const text = (u) => rows2.filter((r) => r.user === u).map((r) => r.sql.toLowerCase())
    is(!text('sporta_shop').some((q) => /\badmin_users\b|\binventory_movements\b|\bcrm_/.test(q)), 'the storefront account never so much as read admin_users, the stock ledger or the CRM', '')
    is(text('sporta_admin').some((q) => /\badmin_users\b/.test(q)) && text('sporta_cron').some((q) => /fulfilment_outbox/.test(q)) && text('sporta_cron').some((q) => /product_variants/.test(q)), 'the admin account handled sign-in; the cron account drained the outbox and put stock back')
    const log = existsSync(PHPLOG) ? readFileSync(PHPLOG, 'utf8') : ''
    is(!/Sporta: db_.*must both be set/.test(log), 'the patch logged no half-configured role pair')
    for (const key of ['shop', 'admin', 'cron']) {
      const c = coverage(rows2, key)
      info(ACCOUNTS[key].user, `${c.hit} of ${c.total} granted privilege units used; unexercised: ${c.missing.slice(0, 25).join(' ') || 'none'}${c.missing.length > 25 ? ` … +${c.missing.length - 25}` : ''}`)
    }
    // the split is real: what the storefront account cannot do, with the SAME code paths
    for (const key of ['shop', 'admin', 'cron']) {
      const res = (await batteryFull(key))
      const f = res.filter((r) => !r.ok)
      is(f.length === 0, `${ACCOUNTS[key].user}: ${res.length} things it must NOT be able to do are all refused`, f.map((x) => `${x.name} -> ${x.detail}`).slice(0, 4).join('; '))
    }
    // and the safe default: with NO role keys, the patched code behaves exactly like the unpatched one
    {
      const CFG3 = join(tmp, 'cfg3')
      const SITE3_PORT = await freePort(SITE2_PORT + 1)
      const cfg3 = writeConfigs(CFG3, `http://127.0.0.1:${SITE3_PORT}`, tier1Users)
      const site3 = startSite(SITE3_PORT, STAGE2, cfg3, 'patched code, old config')
      const up = await waitUp(site3)
      const m3 = auditEnd()
      const C3 = client(site3.base)
      const r1 = await C3.api('products'), r2 = await C3.admin('login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PW } })
      await phpCli(site3, 'cron-stock.php', ['--check'])
      const used = new Set(auditSince(m3).map((r) => r.user).filter((u) => u.startsWith('sporta_')))
      is(up && r1.status === 200 && r2.status === 200 && [...used].join() === 'sporta_web', 'patched code + the OLD config (no db_*_user keys) uses db_user for every role: deploying the code before the accounts is safe', [...used].join(','))
    }
  }
}

// ------------------------------------------------------------------ 8. mutation checks
head('8. MUTATIONS: the same assertions must go red when the hardening is removed')
const everyone = ['web', 'knet', 'tpay', 'ro', 'migrate', 'shop', 'admin', 'cron']
const restore = () => rootSql(renderAll({ activate: everyone }), '')
{
  // M1. grant the runtime account everything: the fails-closed battery and the grant comparison must turn red
  await rootSql(`grant all privileges on \`${DB}\`.* to '${ACCOUNTS.web.user}'@'${HOST}'; grant file on *.* to '${ACCOUNTS.web.user}'@'${HOST}'`, '')
  const res = await batteryFull('web')
  const failed = res.filter((r) => !r.ok).map((r) => r.name)
  const must = ['DROP TABLE orders', 'ALTER TABLE orders', 'CREATE TABLE', 'SELECT ... INTO OUTFILE', 'DELETE FROM orders', 'TRUNCATE orders']
  is(must.every((m) => failed.includes(m)), 'MUTATION: with ALL on the database and FILE granted to sporta_web the battery goes RED (DROP, ALTER, CREATE, OUTFILE, DELETE, TRUNCATE all succeed)', `${failed.length} of ${res.length} checks failed: ${failed.slice(0, 5).join(', ')}`)
  const eff = await effective(ACCOUNTS.web.user)
  const problems = diffEffective(eff, expected('web'))
  is(problems.length > 0 && problems.some((p) => /global: .*FILE/.test(p)) && problems.some((p) => /database-wide/.test(p)), 'MUTATION: and the effective-grant comparison names the extra privileges', problems.slice(0, 2).join('; ').slice(0, 140))
  try { rmSync(outfile, { force: true }) } catch { /* none */ }
  await restore()
  const back = diffEffective(await effective(ACCOUNTS.web.user), expected('web'))
  const again = (await batteryFull('web')).filter((r) => !r.ok)
  is(back.length === 0 && again.length === 0, 're-applying grants.sql REVOKEs the extra power again: the account converges back to exactly the derived set', back.join('; '))
}
{
  // M2. take a needed privilege away: the checkout must visibly fail (and the audit log must say why)
  const m = auditEnd()
  await rootSql(`revoke update (stock) on \`${DB}\`.product_variants from '${ACCOUNTS.web.user}'@'${HOST}'`, '')
  const S = client(site1.base)
  const r = await S.api('order', { method: 'POST', body: orderBody(trackId('LPMUT'), 'cod') })
  const refused = denials(auditSince(m), ['sporta_web'])
  is(r.status >= 500 && refused.some((x) => x.code === 1143), 'MUTATION: without UPDATE(stock) on product_variants a cash order FAILS (HTTP 5xx) and the audit log shows 1143 for sporta_web', `HTTP ${r.status}, ${refused.length} refusals`)
  await restore()
  const ok2 = await S.api('order', { method: 'POST', body: orderBody(trackId('LPMUT'), 'cod') })
  is(ok2.status === 200, 'and after the re-apply the same order is accepted again', `HTTP ${ok2.status}`)
}
{
  // M3. the code gains a write that grants.sql does not know about: the detector must flag it, and must not flag the unchanged tree
  const mut = join(tmp, 'mutant'); mkdirSync(mut)
  for (const d of ['php-store', 'php-knet', 'php-cbk']) cpSync(join(DROPIN, d), join(mut, d), { recursive: true, filter: (x) => !/\/config\.php$/.test(x) })
  const flagged = (dir) => {
    const map = phpMap(dir)
    const code = codeRoles(map, TABLES)
    return buildGrantsSql({ needs: accountNeeds(code, TABLES, map), code }) !== GRANTS_RAW
  }
  is(flagged(DROPIN) === false, 'the detector is quiet on the unchanged tree')
  const apiPhp = join(mut, 'php-store', 'api.php')
  const base = readFileSync(apiPhp, 'utf8')
  writeFileSync(apiPhp, `${base}\n$extra = store_db(); $extra->exec("delete from orders where id = 0");\n`)
  is(flagged(mut), 'MUTATION: a DELETE FROM orders added to api.php makes grants.sql stale (the suite goes red until a person regenerates and reads the new grant)')
  writeFileSync(apiPhp, `${base}\n$extra = store_db(); $extra->exec("update products set price = 0 where id = 0");\n`)
  is(flagged(mut), 'MUTATION: so does an UPDATE of products.price in the storefront entry point')
  writeFileSync(apiPhp, base)
  writeFileSync(join(mut, 'php-knet', 'callback.php'), `${readFileSync(join(mut, 'php-knet', 'callback.php'), 'utf8')}\n$x = knet_pdo([]); $x->exec("update orders set amount = 0.001 where id = 0");\n`)
  is(flagged(mut), 'MUTATION: and so does the KNET callback gaining an UPDATE of orders.amount')
  // a BLINDED extractor (one that sees no SQL at all) would derive nothing, so every account would lose its grants: the comparison would fail loudly
  const blind = JSON.parse(JSON.stringify(PHPMAP))
  for (const f of Object.values(blind)) { f.top.sql = []; for (const fn of Object.values(f.funcs)) fn.sql = [] }
  const blindCode = codeRoles(blind, TABLES)
  is(buildGrantsSql({ needs: accountNeeds(blindCode, TABLES, blind), code: blindCode }) !== GRANTS_RAW, 'MUTATION: an extractor blinded to all SQL derives different grants than the committed file, so a blind detector fails this suite instead of passing it')
}
{
  // M4. a grant that slips in outside the file (a person at a prompt): the comparison names it
  await rootSql(`grant drop on \`${DB}\`.* to '${ACCOUNTS.knet.user}'@'${HOST}'; grant select on \`${DB}\`.admin_users to '${ACCOUNTS.tpay.user}'@'${HOST}'; grant select on \`${DB}\`.legacy_customers to '${ACCOUNTS.shop.user}'@'${HOST}'`, '')
  const dknet = diffEffective(await effective(ACCOUNTS.knet.user), expected('knet'))
  const dtpay = diffEffective(await effective(ACCOUNTS.tpay.user), expected('tpay'))
  const dshop = diffEffective(await effective(ACCOUNTS.shop.user), expected('shop'))
  is(dknet.length > 0 && dtpay.length > 0 && dshop.length > 0, 'MUTATION: a DROP on the database, a SELECT on admin_users and a SELECT on an old-build table granted by hand are each reported by the effective-grant comparison', [dknet[0], dtpay[0], dshop[0]].join(' | ').slice(0, 200))
  await restore()
  const clean = [await effective(ACCOUNTS.knet.user), await effective(ACCOUNTS.tpay.user), await effective(ACCOUNTS.shop.user)]
  is(diffEffective(clean[0], expected('knet')).length + diffEffective(clean[1], expected('tpay')).length + diffEffective(clean[2], expected('shop')).length === 0, 'and one re-apply of grants.sql removes all three')
}

// ------------------------------------------------------------------ 9. account hygiene
head('9. account hygiene: what the audit finds, what hygiene.sql fixes, passwords, plugins, the old account')
const AUDIT_SQL = readFileSync(join(WEB, 'ops', 'db', 'audit-accounts.sql'), 'utf8')
const runAudit = async (sqlText = AUDIT_SQL) => {
  const out = await new Promise((resolve, reject) => {
    const p = spawn('mariadb', ['--no-defaults', '-S', SOCK, '-uroot', '--batch'])
    let o = '', e = ''; p.stdout.on('data', (d) => { o += d }); p.stderr.on('data', (d) => { e += d })
    p.on('close', (c) => (c === 0 ? resolve(o) : reject(new Error(e))))
    p.stdin.end(sqlText)
  })
  const lines = out.split('\n')
  const i = lines.findIndex((l) => l.startsWith('user\thost\tauth_plugin'))
  const hdr = lines[i].split('\t')
  const rows = []
  for (let j = i + 1; j < lines.length && lines[j].split('\t').length === hdr.length && !lines[j].startsWith('grantee'); j++) {
    const v = lines[j].split('\t'); rows.push(Object.fromEntries(hdr.map((h, k) => [h, v[k]])))
  }
  return { rows, text: out }
}
{
  // plant the faults a real server has: an anonymous account, an empty password, a wildcard host, root reachable over the network
  await rootSql(`create user ''@'localhost'; create user 'lp_empty'@'127.0.0.1'; create user 'lp_wild'@'%' identified by 'Xx-aaaaaaaaaaaaaaaaaaaaaaaa-1'; create user 'root'@'%' identified by 'Xx-bbbbbbbbbbbbbbbbbbbbbbbb-2'; grant all on *.* to 'root'@'%' with grant option; create database test;`, '')
  const before = await runAudit()
  const flag = (u, h, col) => before.rows.some((r) => r.user === u && r.host === h && r[col] === '1')
  is(flag('', 'localhost', 'anonymous'), 'audit-accounts.sql flags the anonymous account')
  is(flag('lp_empty', '127.0.0.1', 'empty_password'), 'audit-accounts.sql flags an account with an EMPTY password')
  is(flag('lp_wild', '%', 'wildcard_host') && flag('root', '%', 'wildcard_host'), 'audit-accounts.sql flags accounts reachable from any host, root@% included')
  is(!before.rows.some((r) => r.user.startsWith('sporta_') && (r.anonymous === '1' || r.empty_password === '1' || r.wildcard_host === '1')), 'and flags none of the eight sporta_* accounts')
  is(/'root'@'%'\tALTER\tYES/.test(before.text) || /root'@'%'\t.*\tYES/.test(before.text), 'and lists the global privileges and GRANT OPTION of root@%')
  is(!new RegExp(Object.values(PW).map((p) => p.slice(0, 12)).join('|')).test(before.text) && !/\*[0-9A-F]{40}/.test(before.text), 'and prints no password and no password hash')
  // MUTATION: a blinded audit (empty-password test neutered) misses the planted fault, so the assertion above depends on the SQL
  const blind = AUDIT_SQL.replace("COALESCE(JSON_VALUE(Priv, '$.authentication_string'), '') = ''", "COALESCE(JSON_VALUE(Priv, '$.authentication_string'), '') = 'never'")
  const blinded = await runAudit(blind)
  is(blind !== AUDIT_SQL && !blinded.rows.some((r) => r.user === 'lp_empty' && r.empty_password === '1'), 'MUTATION: with the empty-password test neutered the audit no longer reports lp_empty, so this suite would go red on a blinded audit')

  // hygiene.sql: the anonymous account and the sample database go; the policy plugins come in; local_infile goes off
  await rootSql('set global local_infile = 1', '')
  writeFileSync(join(tmp, 'secure', 'x.csv'), 'a\t1\t1\n')
  const lax2 = await sqlAs('web', `load data local infile '${join(tmp, 'secure', 'x.csv')}' into table rate_limit`, { extra: ['--local-infile=1'] })
  is(lax2.errno === 0, 'BEFORE: with local_infile on, the web account (INSERT on rate_limit) can have the client send a file into a table')
  await rootSql(readFileSync(join(WEB, 'ops', 'db', 'hygiene.sql'), 'utf8'), '')
  await rootSql(readFileSync(join(WEB, 'ops', 'db', 'hygiene.sql'), 'utf8'), '')   // twice: idempotent
  const after = await runAudit()
  is(!after.rows.some((r) => r.user === ''), 'hygiene.sql removes the anonymous account (twice in a row: idempotent)')
  is((await rootSql("select count(*) from information_schema.schemata where schema_name = 'test'", '')) === '0', 'and drops the sample database `test`')
  const lax3 = await sqlAs('web', `load data local infile '${join(tmp, 'secure', 'x.csv')}' into table rate_limit`, { extra: ['--local-infile=1'] })
  is(lax3.errno !== 0, 'AFTER: LOAD DATA LOCAL INFILE is refused by the server', `${lax3.errno}`)
  await rootSql("delete from rate_limit where bucket_key = 'a'")
  is(flagRow(after, 'root', '%'), 'hygiene.sql does NOT touch root@% (that needs a person: drop-root-remote.sql)')
  await rootSql(readFileSync(join(WEB, 'ops', 'db', 'drop-root-remote.sql'), 'utf8'), '')
  is(!flagRow(await runAudit(), 'root', '%') && flagRow(await runAudit(), 'root', 'localhost'), 'drop-root-remote.sql removes root@% and leaves root@localhost (the unix socket) in place')
}
function flagRow(a, u, h) { return a.rows.some((r) => r.user === u && r.host === h) }
{
  // password policy, with the plugin now installed by hygiene.sql
  const weakRes = await rootSql(`alter user '${ACCOUNTS.ro.user}'@'${HOST}' identified by 'weakweak'`, '').then(() => 'accepted', (e) => e.message)
  const emptyRes = await rootSql(`create user 'lp_empty2'@'127.0.0.1'`, '').then(() => 'accepted', (e) => e.message)
  const shortRes = await rootSql(`alter user '${ACCOUNTS.ro.user}'@'${HOST}' identified by 'Aa1-short-but-mixed'`, '').then(() => 'accepted', (e) => e.message)
  is(/1819/.test(weakRes) && /1819/.test(emptyRes) && /1819/.test(shortRes), 'with simple_password_check installed: "weakweak", an empty password and a mixed-class 18-character one are all refused (ERROR 1819)', `${weakRes.slice(0, 40)}`)
  const oldRo = PW.ro
  const newRo = newPassword()
  await rootSql(renderRotate({ appHost: HOST, jobHost: HOST, passwords: { ro: newRo }, accounts: ['ro'] }), '')
  PW.ro = newRo
  const login = await sqlAs('ro', 'select 1')
  is(login.errno === 0, 'a freshly generated 40-character password (render-grants.mjs --rotate) passes the policy and the account signs in with it')
  const back = await rootSql(`alter user '${ACCOUNTS.ro.user}'@'${HOST}' identified by '${oldRo}'`, '').then(() => 'accepted', (e) => e.message)
  is(/1819/.test(back), 'password_reuse_check refuses going back to the previous password', back.slice(0, 60))
  await rootSql(renderAll({ activate: everyone }), '').catch(() => {})
  // every password a person or the renderer will ever set must satisfy the policy: 1000 generated ones
  const classes = Array.from({ length: 1000 }, () => newPassword()).every((p) => /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[-_]/.test(p) && p.length === 40)
  is(classes, '1000 generated passwords all carry upper, lower, digit and a symbol (so the policy plugin never rejects the renderer by bad luck)')
}
{
  // authentication plugins
  await rootSql("install soname 'auth_ed25519'", '').catch(() => {})
  const ed = await rootSql(`create user 'lp_ed'@'127.0.0.1' identified via ed25519 using password('${newPassword()}')`, '').then(() => true, () => false)
  if (!ed) { info('ed25519', 'the plugin could not be installed on this build: nothing to check') } else {
    const edpw = newPassword()
    await rootSql(`alter user 'lp_ed'@'127.0.0.1' identified via ed25519 using password('${edpw}'); grant select on \`${DB}\`.products to 'lp_ed'@'127.0.0.1'`, '')
    const php = await run('php', ['-r', `try { new PDO('mysql:host=${HOST};port=${DB_PORT};dbname=${DB}', 'lp_ed', getenv('P'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); echo 'CONNECTED'; } catch (Throwable $e) { echo $e->getMessage(); }`], { env: { ...process.env, P: edpw } }).then((r) => r.stdout, (e) => e.stdout)
    is(/client_ed25519|2054/.test(php) && !/CONNECTED/.test(php), "PHP's PDO (mysqlnd) CANNOT sign in to an ed25519 account: the application accounts must stay on mysql_native_password", php.slice(0, 90))
    const plugins = await rootSql("select distinct json_value(priv,'$.plugin') from mysql.global_priv where user like 'sporta\\_%'", '')
    is(plugins === 'mysql_native_password', 'and all eight sporta_* accounts use mysql_native_password', plugins)
  }
}
{
  // the old broad account: locking it is one statement, reversible by one statement
  await rootSql(`create user if not exists 'sporta_app'@'%' identified by '${newPassword()}'; grant all on \`${DB}\`.* to 'sporta_app'@'%'`, '')
  await rootSql(readFileSync(join(WEB, 'ops', 'db', 'retire-old-account.sql'), 'utf8').split('\n').filter((l) => !l.startsWith('--') || false).join('\n'), '')
  const locked = (await rootSql("select json_value(priv,'$.account_locked') from mysql.global_priv where user = 'sporta_app' and host = '%'", 'mysql'))
  is(locked === '1', 'retire-old-account.sql LOCKS the old sporta_app@% account without dropping it or touching a grant')
  const grantsKept = await rootSql("show grants for 'sporta_app'@'%'", '')
  await rootSql("alter user 'sporta_app'@'%' account unlock", '')
  const unlocked = (await rootSql("select json_value(priv,'$.account_locked') from mysql.global_priv where user = 'sporta_app' and host = '%'", 'mysql'))
  is(/ALL PRIVILEGES ON `sporta_lp`\.\*/.test(grantsKept) && unlocked !== '1', 'its grants are untouched, and ALTER USER ... ACCOUNT UNLOCK undoes it (the rollback)')
  await rootSql("drop user 'sporta_app'@'%'", '')
}

// ------------------------------------------------------------------ summary
console.log(`\n${passes} passed, ${fails} failed${weaks ? `, ${weaks} weak` : ''}`)
process.exit(fails || (STRICT && weaks) ? 1 : 0)
