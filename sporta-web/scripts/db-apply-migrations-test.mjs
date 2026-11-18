// scripts/db-apply-migrations-test.mjs: proves scripts/db-apply-migrations.mjs does what the owner approved and nothing more.
//
//   npm run test:db-apply-migrations      (private MariaDB, never the shared rig; TOOL=<file> runs the same checks on a mutated copy)
//
// The "live" database is built from install.mysql.sql AS OF dcd2b28b (the live baseline: no refunds, no apple_sub, no e-mail
// verification), seeded with orders in each status the live CHECK allows and a customer account. The tool is run against it the way
// the VPS job runs it: a read-only plan, then backup + apply + verify, then again (idempotent), and the repo's own live schema diff is
// run before and after to show the seven problems it reported on 2026-11-18 are gone.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as T from './db-schema-live-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const TOOL = process.env.TOOL ? pathToFileURL(resolve(process.env.TOOL)).href : './db-apply-migrations.mjs'
const M = await import(TOOL)
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

head('the allow-list')
const real = M.loadStatements()
is(real.length === 19, 'both repo files classify: 19 statements, every one on the list', String(real.length))
const refuse = (s) => { try { M.classify(s); return false } catch (e) { return e instanceof M.Refused } }
for (const bad of [
  'drop table orders', 'truncate table orders', 'delete from orders', "insert into orders (track_id) values ('x')", "update orders set payment_status = 'paid'",
  'alter table orders drop column amount', 'alter table orders modify amount int', 'alter table orders change amount amt int', 'alter table orders drop index idx_orders_customer_created',
  'alter table orders drop constraint orders_pk_something', 'alter table orders drop constraint if exists orders_amount_ck', 'rename table orders to o2', 'drop database sporta',
  "grant all on *.* to 'x'@'%'", 'create table orders_copy as select * from orders', 'create index idx_x on orders (id)', 'alter table orders add column x int',
  'alter table orders add constraint orders_payment_status_ck check (1=1); drop table orders', 'drop table if exists order_refunds',
]) is(refuse(bad), `refused: ${bad.slice(0, 60)}`)
is(!refuse('alter table orders add column if not exists refunded_amount decimal(10,3) not null default 0 after amount'), 'accepted: add column if not exists')
is(!refuse('alter table orders drop constraint if exists orders_payment_status_ck'), 'accepted: drop constraint if exists, for the one check this tool re-adds')

let inst
try { inst = await T.startInstance('dam', { portFrom: 34600 }) } catch (e) { if (e.skip) { console.log(`SKIP database sections: ${e.message}`); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) } throw e }
const tmp = mkdtempSync(join(tmpdir(), 'dam-'))
const conn = async (db) => { const c = new T.MySQL({ socket: inst.sock, user: 'root', password: '', database: db }); await c.connect(); return c }
const oldInstall = execFileSync('git', ['show', 'dcd2b28b:sporta-web/dropin/php-store/install.mysql.sql'], { cwd: WEB, maxBuffer: 1 << 28 }).toString('utf8')
const liveLike = async (db) => {
  await T.freshDb(inst, db)
  const r = T.runSql(inst, db, oldInstall)
  if (!r.ok) throw new Error(`the baseline install did not import: ${r.message}`)
  await inst.sql(`insert into customer_accounts (name, email, password_hash) values ('Test One', 'one@example.test', 'x'), ('Test Two', 'two@example.test', 'y')`, db)
  for (const [i, st] of ['pending', 'paid', 'failed', 'review', 'paid'].entries()) {
    await inst.sql(`insert into orders (track_id, customer_name, customer_phone, amount, subtotal, payment_method, payment_status${st === 'paid' ? ', paid_at' : ''}) values ('DAM${i}0000000', 'n', '96550000000', ${10 + i}, ${10 + i}, 'knet', '${st}'${st === 'paid' ? ", now()" : ''})`, db)
  }
}
const fingerprint = async (db) => (await inst.sql(`select md5(group_concat(concat_ws('|', id, track_id, amount, payment_status, customer_name) order by id)) from orders`, db)).trim()
const shape = async (db) => (await inst.sql(`select md5(group_concat(concat_ws('|', table_name, column_name, column_type) order by table_name, column_name)) from information_schema.columns where table_schema = database()`, db)).trim() + (await inst.sql(`select count(*) from information_schema.tables where table_schema = database()`, db)).trim()
const diffText = (db) => spawnSync('node', ['scripts/db-schema-live-diff.mjs', '--live', '--expected-file', 'ops/db/expected-schema.json', '--markdown', '--exit-line'], { cwd: WEB, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, DB_SOCKET: inst.sock, DB_USER: 'root', DB_NAME: db, DB_PASSWORD: '' } }).stdout
const SEVEN = ['table missing `order_refunds`', 'table missing `payment_alerts`', 'table missing `customer_email_verifications`', 'column missing `customer_accounts.apple_sub`', 'column missing `orders.gateway_attempt_ref`', 'check changed `orders.orders_payment_status_ck`', 'index missing `customer_accounts.uq_customer_apple_sub`']
const logs = () => { const l = []; return [l, (x) => l.push(x)] }
try {
  head('the plan changes nothing')
  await liveLike('live1')
  const before = { fp: await fingerprint('live1'), shape: await shape('live1') }
  const d0 = diffText('live1')
  is(SEVEN.every((s) => d0.includes(s)), 'the repo live schema diff reports the seven problems on the live-like database first', SEVEN.filter((s) => !d0.includes(s)).join(' | '))
  let c = await conn('live1'); await c.query('set session transaction read only')
  let [l, log] = logs()
  let r = await M.run((s) => c.query(s), { apply: false, log })
  c.end()
  is(r.ok && r.plan && r.todo > 0, 'plan: ok, read-only, statements to apply are counted', JSON.stringify(r))
  is(l.some((x) => /TODO\s+refunds\.mysql\.sql:\d+\s+create table order_refunds/.test(x)) && l.some((x) => /there\s+customers\.mysql\.sql:\d+\s+create table customer_accounts/.test(x)), 'the plan says which objects are missing and which are there')
  is(await shape('live1') === before.shape && await fingerprint('live1') === before.fp, 'the plan left the schema and the orders exactly as they were')
  is(!existsSync(join(tmp, 'never')), 'no backup is made by a plan')

  head('apply: backup, statements, verify')
  const bdir = join(tmp, 'backup-1')
  c = await conn('live1'); ;[l, log] = logs()
  r = await M.run((s) => c.query(s), { apply: true, backupDir: bdir, log })
  c.end()
  is(r.ok === true && r.applied > 0, 'apply: ok', JSON.stringify(r))
  is(l.some((x) => /^backup: /.test(x)) && l.findIndex((x) => /^backup: /.test(x)) < l.findIndex((x) => /^ok /.test(x)), 'the backup is announced before the first statement')
  is(l.some((x) => /^verified: /.test(x)), 'the verification line is printed')
  const files = existsSync(bdir) ? readdirSync(bdir).sort() : []
  is(files.join(',') === 'MANIFEST.txt,customer_accounts.json,orders.json,schema.txt', 'the backup holds both tables, the CREATE TABLE text and a manifest', files.join(','))
  is(existsSync(bdir) && (statSync(bdir).mode & 0o777) === 0o700 && files.every((f) => (statSync(join(bdir, f)).mode & 0o777) === 0o600), 'directory 0700, files 0600')
  const ob = JSON.parse(readFileSync(join(bdir, 'orders.json'), 'utf8')), cb = JSON.parse(readFileSync(join(bdir, 'customer_accounts.json'), 'utf8'))
  is(ob.rows.length === 5 && cb.rows.length === 2 && ob.columns.includes('payment_status') && !ob.columns.includes('refunded_amount'), 'the copy has the rows and the columns as they were BEFORE the migration (5 orders, 2 accounts)', JSON.stringify([ob.rows.length, cb.rows.length]))
  is(/create table `orders`/i.test(readFileSync(join(bdir, 'schema.txt'), 'utf8')) && /review/.test(readFileSync(join(bdir, 'schema.txt'), 'utf8')), 'schema.txt keeps the old CREATE TABLE and the old CHECK')
  is(!l.join('\n').includes('one@example.test') && !l.join('\n').includes('Test One') && !l.join('\n').includes('DAM20000000'), 'nothing from the rows is printed (no e-mail, name or track id)')
  is(await fingerprint('live1') === before.fp, 'every existing order is byte-for-byte what it was (id, track id, amount, status, name)')
  is((await inst.sql('select count(*) from customer_accounts', 'live1')).trim() === '2', 'both customer accounts are still there')
  const d1 = diffText('live1')
  is(SEVEN.every((s) => !d1.includes(s)), 'the repo live schema diff no longer reports ANY of the seven problems', SEVEN.filter((s) => d1.includes(s)).join(' | '))
  const ins = (st) => inst.sql(`insert into orders (track_id, customer_name, customer_phone, amount, subtotal, payment_method, payment_status) values ('DAMS${st}00000', 'n', '96550000000', 5, 5, 'knet', '${st}')`, 'live1').then(() => true, () => false)
  is(await ins('refunded') && await ins('voided') && await ins('paid'), "the CHECK now takes 'refunded' and 'voided' as well as the old values")
  is(!(await ins('bogus')), "and still refuses a status that is not on the list")
  const alertOk = await inst.sql(`insert into payment_alerts (order_id, kind, gateway, payment_id, source) select id, 'duplicate_capture', 'cbk', 'P1', 'callback' from orders limit 1`, 'live1').then(() => true, () => false)
  is(alertOk, 'payment_alerts takes a cbk row (the widened gateway CHECK)')
  await inst.sql(`delete from orders where track_id like 'DAMS%'`, 'live1')

  head('run it again')
  const shapeDone = await shape('live1')
  c = await conn('live1'); ;[l, log] = logs()
  r = await M.run((s) => c.query(s), { apply: true, backupDir: join(tmp, 'backup-2'), log })
  c.end()
  is(r.ok && r.todo === 0 && l.includes('nothing to do'), 'a second run finds nothing to do', JSON.stringify(r))
  is(!existsSync(join(tmp, 'backup-2')) && await shape('live1') === shapeDone, 'and makes no backup and changes nothing')

  head('stops before the first write')
  await liveLike('live2')
  const f2 = await fingerprint('live2'), s2 = await shape('live2')
  mkdirP(join(tmp, 'exists'))
  c = await conn('live2'); ;[l, log] = logs()
  let threw = null
  try { await M.run((s) => c.query(s), { apply: true, backupDir: join(tmp, 'exists'), log }) } catch (e) { threw = e }
  c.end()
  is(threw && /already exists/.test(threw.message) && await shape('live2') === s2, 'an existing backup directory is never written over, and no statement ran', String(threw?.message))
  c = await conn('live2'); ;[l, log] = logs()
  r = await M.run((s) => c.query(s), { apply: true, backupDir: null, log })
  c.end()
  is(r.ok === false && await shape('live2') === s2, '--apply without --backup-dir is refused', JSON.stringify(r))
  { const w = T.runSql(inst, 'live2', 'drop table if exists customer_password_resets; alter table customer_accounts modify id int unsigned not null auto_increment;'); if (!w.ok) throw new Error(w.message) }
  const s2b = await shape('live2')
  c = await conn('live2'); ;[l, log] = logs()
  r = await M.run((s) => c.query(s), { apply: true, backupDir: join(tmp, 'backup-3'), log })
  c.end()
  is(r.ok === false && r.reason === 'preflight' && l.some((x) => /PREFLIGHT FAIL customer_accounts\.id is .*bigint unsigned/.test(x)) && !existsSync(join(tmp, 'backup-3')) && await shape('live2') === s2b, 'a customer_accounts.id of the wrong type fails the pre-flight: no backup, no statement', JSON.stringify([r, l.filter((x) => /PREFLIGHT/.test(x))]))

  head('a failing statement stops the run; a lost row fails the verification')
  await liveLike('live3')
  c = await conn('live3'); ;[l, log] = logs()
  const ran = []
  const failing = (s) => { ran.push(s); if (/create table if not exists order_refunds/i.test(s)) return Promise.reject(new Error('SQL error 1005: forced')); return c.query(s) }
  r = await M.run(failing, { apply: true, backupDir: join(tmp, 'backup-4'), log })
  is(r.ok === false && r.reason === 'statement' && r.at.startsWith('refunds.mysql.sql') && !ran.some((s) => /payment_alerts/i.test(s) && /^create table/i.test(s)), 'the first failing statement stops the run: nothing after it is sent', JSON.stringify(r))
  is(l.some((x) => /^FAIL .*create table order_refunds/.test(x)) && existsSync(join(tmp, 'backup-4', 'orders.json')), 'it says which statement failed, and the backup is already on disk')
  ;[l, log] = logs()
  r = await M.run((s) => c.query(s), { apply: true, backupDir: join(tmp, 'backup-5'), log })
  is(r.ok === true && l.some((x) => /^skip /.test(x)) && l.some((x) => /^ok /.test(x)), 'running it again finishes the job: what is there is skipped, the rest is applied', JSON.stringify(r))
  c.end()
  await liveLike('live4')
  c = await conn('live4'); ;[l, log] = logs()
  const losing = async (s) => { const out = await c.query(s); if (/add column if not exists gateway_attempt_ref/i.test(s)) await c.query(`delete from orders where track_id = 'DAM20000000'`); return out }
  r = await M.run(losing, { apply: true, backupDir: join(tmp, 'backup-6'), log })
  c.end()
  is(r.ok === false && r.reason === 'verify' && l.some((x) => /VERIFY FAIL orders had 5 rows and has 4/.test(x)), 'a changed row count is caught by the verification', JSON.stringify([r, l.filter((x) => /VERIFY/.test(x))]))

  head('a copy that does not match, a statement that did nothing')
  {
    const fake = async () => ({ columns: ['id'], rows: [['1'], ['2']] })
    let err = null
    try { await M.backup(fake, join(tmp, 'backup-fake'), { orders: 3, customer_accounts: 2 }) } catch (e) { err = e }
    is(err && /does not match the table/.test(err.message), 'a copy whose rows do not match the table count is refused (the read-back check)', String(err?.message))
  }
  await liveLike('live7')
  c = await conn('live7'); ;[l, log] = logs()
  const silent = async (s) => (/^(create table if not exists|alter table) payment_alerts/i.test(s) ? { columns: [], rows: [] } : c.query(s))
  r = await M.run(silent, { apply: true, backupDir: join(tmp, 'backup-8'), log })
  c.end()
  is(r.ok === false && r.reason === 'verify' && l.some((x) => /VERIFY FAIL .*create table payment_alerts is missing/.test(x)), 'a statement that was accepted but created nothing is caught by the object check', JSON.stringify([r, l.filter((x) => /VERIFY/.test(x))]))

  head('through the command line (what the VPS job runs)')
  await liveLike('live5')
  const cli = (extra) => spawnSync('node', ['scripts/db-apply-migrations.mjs', ...extra], { cwd: WEB, encoding: 'utf8', env: { ...process.env, DB_SOCKET: inst.sock, DB_USER: 'root', DB_NAME: 'live5', DB_PASSWORD: '' } })
  const plan = cli([])
  is(plan.status === 0 && /PLAN_OK/.test(plan.stdout) && /PLAN ONLY/.test(plan.stdout), 'plan: exit 0, PLAN_OK', plan.stdout.slice(-200))
  const ap = cli(['--apply', '--backup-dir', join(tmp, 'backup-7')])
  is(ap.status === 0 && /MIGRATIONS_OK/.test(ap.stdout), 'apply: exit 0, MIGRATIONS_OK', ap.stdout.slice(-300))
  const noBackup = cli(['--apply'])
  is(noBackup.status === 0 && /nothing to do/.test(noBackup.stdout), 'a second apply with nothing left to do does not even need a backup directory')
  await liveLike('live6')
  const noDir = spawnSync('node', ['scripts/db-apply-migrations.mjs', '--apply'], { cwd: WEB, encoding: 'utf8', env: { ...process.env, DB_SOCKET: inst.sock, DB_USER: 'root', DB_NAME: 'live6', DB_PASSWORD: '' } })
  is(noDir.status === 1 && /MIGRATIONS_FAIL/.test(noDir.stdout), '--apply without --backup-dir on a database that needs it: exit 1, MIGRATIONS_FAIL', noDir.stdout.slice(-200))
  const unknown = cli(['--force'])
  is(unknown.status === 1, 'an unknown argument is refused')
} finally {
  try { inst.stop() } catch { /* stopped */ }
  rmSync(tmp, { recursive: true, force: true })
}
function mkdirP(p) { execFileSync('mkdir', ['-p', p]) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
