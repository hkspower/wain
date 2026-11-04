// ABANDONED ORDERS (owner: "make abandon order list"): the /backends list of
// orders that were started and never completed, with the owner's follow-up
// note on each. Backend only; the screen is built on this contract.
//
//   npm run test:abandoned-orders     (add --keep to leave the temp directory)
//
// WHAT IS PROVED, and on what. Everything runs on a PRIVATE stack: its own
// MariaDB (own datadir and socket, port from 34200), its own PHP servers, a
// staged copy of dropin/php-store in a temp directory. It never touches the
// shared sandbox (database `sporta`, ports 8095-8100/8188/4173, dist/).
//
//   1. the migration: abandoned.mysql.sql is idempotent, rebuilds the table
//      identically on a database that lacks it, and is repeated byte for byte in
//      schema.mysql.sql (so install.mysql.sql carries it);
//   2. the DEFINITION, on orders placed through the real create_order route and
//      moved through every state the shop has - including the REAL sweeper
//      (cron-stock.php --release) and the REAL owner cancel (admin fulfilment):
//      paid card, pending inside / beyond the threshold, failed, review, expired
//      and released, expired with no stock, cash confirmed / expired / inside its
//      hold, cancelled by the owner, packed, a historic cash 'failed' import,
//      recovered by phone / account / confirmed cash / manually, and the near
//      misses (a cash order still awaiting confirmation, an EARLIER paid order);
//   3. counts, values and the recovery rate in the summary; the threshold
//      setting and its clamp; the hold and cash-hold settings;
//   4. pagination and the `has_more` flag at the exact boundary, search by
//      phone (spaces, +965, Arabic digits) / name / track id, LIKE characters
//      taken literally, the date range;
//   5. admin only: 401 without a session, 400 without X-Sporta-Admin, 405 on the
//      wrong method, 403 on a cross-site or non-JSON write, 429 on throttle;
//   6. privacy: the response's key set is exactly the documented one, none of
//      the forbidden columns' values (planted as sentinels) appear anywhere,
//      nothing personal reaches the PHP error log, an error names no value;
//   7. the follow-up: validation, one atomic UPSERT (16 concurrent HTTP writes
//      and 16 concurrent PHP processes), 'none' removes it, the activity log
//      records each successful write once;
//   8. READ-ONLY: a checksum of the order, stock, discount, outbox and timeline
//      tables is identical before and after every read AND every follow-up write;
//   9. 20,000 orders: EXPLAIN shows no full scan of orders, the page costs a
//      constant number of SELECTs (no N+1), and it is fast;
//  10. MUTATIONS: 16 deliberate faults (the threshold, the recovered test, the
//      review exclusion, the cancel attribution, a leaked field, the CSRF test,
//      the `more` flag, the date bound, a non-atomic upsert, an N+1, ...) each
//      served by a mutated copy of abandoned.php; every one must make its probe
//      FAIL, so the suite cannot pass without the property it names.
//
// If MariaDB or PHP is missing it says so and exits 0 (nothing was tested).
import { execFile, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const DROPIN = join(WEB, 'dropin')
const KEEP = process.argv.includes('--keep') || !!process.env.KEEP

let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const info = (n, d = '') => console.log(`info ${n}${d ? `  — ${d}` : ''}`)
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ prerequisites
const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
for (const [bin, present] of [['php', have('php')], ['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-install-db', !!installDb]]) {
  if (!present) { console.log(`SKIP abandoned-orders: ${bin} is not installed, so no private instance can be built. Nothing was tested.`); process.exit(0) }
}
const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 300; p++) if (await isFree(p)) return p; throw new Error('no free port') }

const tmp = mkdtempSync(join(tmpdir(), 'sporta-aband-'))
const procs = []
const extraDirs = []
const cleanup = () => {
  for (const p of procs) { try { p.kill() } catch { /* gone */ } }
  for (const d of extraDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
  if (!KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

// ---------------------------------------------------------------- the database
const DATA = join(tmp, 'db')
mkdirSync(DATA)
let sockDir = tmp
if (join(tmp, 'db.sock').length > 100) { sockDir = mkdtempSync('/tmp/ab-'); extraDirs.push(sockDir) }
const SOCK = join(sockDir, 'db.sock')
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
{
  const r = spawnSync(installDb, ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (r.status !== 0) { console.log('SKIP abandoned-orders: could not initialise a private MariaDB data directory.'); process.exit(0) }
}
const DB_PORT = await freePort(34200 + Math.floor(Math.random() * 30) * 4)
procs.push(spawn('mariadbd', ['--no-defaults', `--datadir=${DATA}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--bind-address=127.0.0.1',
  '--skip-name-resolve', `--pid-file=${join(tmp, 'db.pid')}`, '--innodb-flush-log-at-trx-commit=0', '--max-allowed-packet=64M',
  '--max-connections=300', '--innodb-lock-wait-timeout=20', ...(asRoot ? ['--user=root'] : [])],
  { stdio: ['ignore', 'ignore', openSync(join(tmp, 'mariadbd.log'), 'a')] }))
const mysqlRaw = (text, db = 'abtest') => new Promise((resolve, reject) => {
  const p = spawn('mariadb', ['--no-defaults', '-S', SOCK, '-uroot', '--default-character-set=utf8mb4', ...(db ? [db] : []), '-N', '-B'])
  let out = '', err = ''
  p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
  p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
  p.stdin.on('error', () => { /* the client exited first; its exit code says why */ })
  p.stdin.end(text)
})
let dbUp = false
for (let i = 0; i < 600 && !dbUp; i++) { try { await mysqlRaw('select 1', ''); dbUp = true } catch { await sleep(250) } }
if (!dbUp) { console.log('SKIP abandoned-orders: the private MariaDB did not start.'); process.exit(0) }
await mysqlRaw("create database abtest character set utf8mb4 collate utf8mb4_unicode_ci; create database abscale character set utf8mb4 collate utf8mb4_unicode_ci; " +
  "create user 'x'@'127.0.0.1' identified by 'xp'; grant all on abtest.* to 'x'@'127.0.0.1'; grant all on abscale.* to 'x'@'127.0.0.1';", '')
const SQLDIR = join(DROPIN, 'php-store')
const SKIP_SQL = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
const loadSchema = async (db) => {
  await mysqlRaw(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'), db)
  for (const f of readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !SKIP_SQL.has(n)).sort()) {
    await mysqlRaw(readFileSync(join(SQLDIR, f), 'utf8'), db)
  }
}
const sql = (text, db) => mysqlRaw(text, db)
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\0/g, '\\0')}'`
const rows = async (text, db) => (await sql(text, db)).split('\n').filter(Boolean).map((l) => l.split('\t'))

// ------------------------------------------------------------ 1. the migration
head('1. the migration: additive, idempotent, repeated in schema and install')
const MIG = readFileSync(join(SQLDIR, 'abandoned.mysql.sql'), 'utf8')
{
  const stmt = MIG.slice(MIG.indexOf('create table if not exists abandoned_followup'))
  const schema = readFileSync(join(SQLDIR, 'schema.mysql.sql'), 'utf8')
  const install = readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8')
  is(stmt.length > 200 && schema.includes(stmt.trim()), 'schema.mysql.sql repeats the migration statement byte for byte')
  is(install.includes(stmt.trim()), 'install.mysql.sql (generated from schema) carries it too')
  is(!/\b(drop|truncate)\s+(table|index|column|database|view)\b|\bdelete\s+from\b|\bupdate\s+\w+\s+set\b|\binsert\s+into\b/i.test(MIG.replace(/--[^\n]*/g, '')), 'the migration contains no DROP, TRUNCATE, DELETE, UPDATE or INSERT: it only creates a table')
  is(!/\balter\s+table\s+orders\b/i.test(MIG.replace(/--[^\n]*/g, '')), 'and does not alter orders: it adds one table and touches no existing one')
}
await loadSchema('abtest')
const shape = () => sql("select column_name, column_type, is_nullable, ifnull(column_default,'~'), column_key from information_schema.columns where table_schema = 'abtest' and table_name = 'abandoned_followup' order by ordinal_position", '')
const shapeA = await shape()
is(shapeA.split('\n').length === 5 && /order_id\tint\(10\) unsigned\tNO\t~\tPRI/.test(shapeA), 'the table has five columns and order_id is its primary key (one row per order)', shapeA.split('\n').map((l) => l.split('\t')[0]).join(','))
await sql(MIG)
is((await shape()) === shapeA, 'applying the migration again changes nothing (idempotent)')
await sql('drop table abandoned_followup')
await sql(MIG)
is((await shape()) === shapeA, 'on a database set up before this feature (table absent) it adds the same table, and nothing else', 'no re-import')
{
  const fk = await rows("select constraint_name, delete_rule, referenced_table_name from information_schema.referential_constraints where constraint_schema = 'abtest' and table_name = 'abandoned_followup'", '')
  is(fk.length === 1 && fk[0][1] === 'CASCADE' && fk[0][2] === 'orders', 'its note goes with its order: foreign key to orders ON DELETE CASCADE', fk.map((r) => r.join(' ')).join(';'))
  let refused = ''
  await sql("insert into orders (track_id, amount, payment_status, payment_method) values ('ABCHK00001', 1, 'pending', 'knet'); " +
            "insert into abandoned_followup (order_id, state, updated_by) select id, 'bogus', 'x' from orders where track_id = 'ABCHK00001'").catch((e) => { refused = e.message })
  is(/check|constraint/i.test(refused), 'the database itself refuses a state outside the four', refused.split('\n').filter(Boolean).pop().slice(0, 90))
  await sql("insert into abandoned_followup (order_id, state, updated_by) select id, 'contacted', 'x' from orders where track_id = 'ABCHK00001'")
  await sql("delete from orders where track_id = 'ABCHK00001'")
  is((await sql('select count(*) from abandoned_followup')) === '0', 'deleting the order deletes its follow-up (cascade)')
}

// -------------------------------------------------------------- the staged tree
const STAGE = join(tmp, 'site'), PRIV = join(tmp, 'private'), MAIL = join(tmp, 'mail'), SESS = join(tmp, 'sessions')
for (const d of [STAGE, PRIV, MAIL, SESS]) mkdirSync(d, { recursive: true })
const noConfig = (s) => !/\/config\.php$/.test(s)
cpSync(join(DROPIN, 'php-store'), join(STAGE, 'api'), { recursive: true, filter: noConfig })
// admin.php is gate-owned: this feature's two-line registration reaches it as a patch
// (abandoned-orders-registration.patch), applied after the release gate. Until then the
// run is only meaningful on a staged copy that carries the registration, so it is added
// to the COPY here, exactly as the patch writes it, and the missing registration in the
// real file is reported as a failure of its own. Nothing outside the temp directory changes.
{
  const adminPath = join(STAGE, 'api', 'admin.php')
  let src = readFileSync(adminPath, 'utf8')
  const registered = src.includes('abandoned_dispatch($db, $r, $method, $admin)') && /'abandoned_followup',\s*\];/.test(src)
  if (!registered) {
    const anchor = '// --------------------------------------------------- customer support queue\n'
    const actions = "    'discount_active', 'discount_delete',\n];"
    if (src.split(anchor).length !== 2 || src.split(actions).length !== 2) { bad('admin.php has the anchors the registration patch needs', 'the file moved; rebase abandoned-orders-registration.patch'); process.exit(1) }
    src = src.replace(anchor, () => `// abandoned orders (staged by the test, as the patch writes it)\nif (in_array($r, ['abandoned_orders', 'abandoned_followup'], true)) {\n    require_once __DIR__ . '/abandoned.php';\n    abandoned_dispatch($db, $r, $method, $admin);\n}\n\n${anchor}`)
    src = src.replace(actions, () => "    'discount_active', 'discount_delete', 'abandoned_followup',\n];")
    writeFileSync(adminPath, src)
  }
  head('0. the registration in admin.php')
  is(registered, 'admin.php dispatches abandoned_orders and abandoned_followup, and logs the write in the activity list', registered ? '' : 'NOT YET: apply abandoned-orders-registration.patch (this run used a staged copy that carries it)')
}
writeFileSync(join(STAGE, 'router.php'), `<?php\n$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';\nif ($uri !== '/' && is_file(__DIR__ . $uri)) return false;\nhttp_response_code(404);\n`)
writeFileSync(join(tmp, 'mta.sh'), readFileSync(join(HERE, 'fake-mta.sh')))
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpExport = (o) => `<?php\nreturn ${(function ex(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return phpStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `[${Object.entries(v).map(([k, x]) => `${phpStr(k)} => ${ex(x)}`).join(', ')}]`
})(o)};\n`
const CRON_KEY = 'ab-cron-key-0123456789'
const baseConfig = (db = 'abtest') => ({
  db_host: `127.0.0.1;port=${DB_PORT}`, db_name: db, db_user: 'x', db_pass: 'xp', cron_key: CRON_KEY,
  warehouse_email: 'warehouse@sporta.test', mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw',
  admin_mail_from: 'cs@sporta.com.kw', customer_mail_from: 'cs@sporta.com.kw',
  admin_reset_url: 'https://www.sporta.com.kw/backends', order_cooldown_seconds: 0,
  admin_session_dir: SESS, rate_limit_secret: 'ab-rate-secret-0123456789', trusted_proxy_ips: ['127.0.0.1'],
})
const CFG = join(tmp, 'api-config.php')
const setConfig = (over = {}, db = 'abtest') => writeFileSync(CFG, phpExport({ ...baseConfig(db), ...over }))
setConfig()
const phpEnv = { ...process.env, SPORTA_API_CONFIG_FILE: CFG, SPORTA_PRIVATE_CONFIG_DIR: PRIV }
const phpErrLog = join(tmp, 'php-error.log')
const phpFlags = ['-d', 'opcache.enable=0', '-d', 'opcache.enable_cli=0', '-d', `sendmail_path=sh ${join(tmp, 'mta.sh')} ${MAIL}`,
  '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', `error_log=${phpErrLog}`]
const startPhp = async (docroot, port) => {
  procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${port}`, '-t', docroot, join(docroot, 'router.php')], { stdio: 'ignore', env: { ...phpEnv, PHP_CLI_SERVER_WORKERS: '8' } }))
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/api.php?r=checkout_config`)).status === 200) return true } catch { /* starting */ }
    await sleep(150)
  }
  return false
}
const SITE_PORT = await freePort(34400)
const SITE = `http://127.0.0.1:${SITE_PORT}`
await sql('update product_variants set stock = 100000')
head('the private stack')
const siteUp = await startPhp(STAGE, SITE_PORT)
is(siteUp, `own MariaDB :${DB_PORT}, own PHP :${SITE_PORT}, staged copy of dropin/php-store`)
if (!siteUp) process.exit(1)
const phpCli = (script, args = [], opts = {}) => run('php', [...phpFlags, ...(opts.stage ? [join(opts.stage, 'api', script)] : [join(STAGE, 'api', script)]), ...args],
  { env: { ...phpEnv, ...(opts.env ?? {}) }, cwd: join(opts.stage ?? STAGE, 'api'), maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout, (e) => `${e.stdout ?? ''}${e.stderr ?? ''}`)

// ---------------------------------------------------------------- http helpers
const ADMIN = 'ab-admin@sporta.test', ADMIN_PW = 'ab-Correct-Horse-Battery-9'
{
  const hash = (await run('php', ['-r', `echo password_hash(${phpStr(ADMIN_PW)}, PASSWORD_DEFAULT);`])).stdout
  await sql(`insert into admin_users (email, password_hash) values (${q(ADMIN)}, ${q(hash)})`)
}
let cookie = ''
const clearLimits = () => sql('delete from rate_limit')
// One call to admin.php. `headers` overrides the defaults; set a header to null to drop it.
const adm = async (route, { method = 'GET', qs = '', body, headers = {}, base = SITE, jar = true, raw = false } = {}) => {
  const h = { 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(jar && cookie ? { Cookie: cookie } : {}), ...headers }
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k]
  const res = await fetch(`${base}/api/admin.php?r=${route}${qs}`, { method, headers: h, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0]
    if (/^(__Host-)?sporta_admin=/.test(pair)) cookie = /=(deleted)?$/.test(pair) ? '' : pair
  }
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers }
}
const login = await adm('login', { method: 'POST', body: { email: ADMIN, password: ADMIN_PW } })
is(login.status === 200 && login.json?.email === ADMIN, 'the private admin signs in through the real route', `${login.status} ${login.json?.error ?? ''}`)
if (login.status !== 200) process.exit(1)
const ABQ = (params = {}) => '&' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
const list = (params = {}, opts = {}) => adm('abandoned_orders', { qs: ABQ(params), ...opts })
const follow = (body, opts = {}) => adm('abandoned_followup', { method: 'POST', body, ...opts })

// ------------------------------------------------------------------ the seeds
const TAG = Date.now().toString(36).toUpperCase().slice(-4).padStart(4, 'X')
const tr = (label) => `ABT${TAG}${label}`            // 'ABT' + 4 + label: track ids are 6..30 alphanumerics
let phoneN = 0
const newPhone = () => `5550${String(1000 + (++phoneN)).padStart(4, '0')}`
const canon = (p) => `965${p}`
const O = {}                                          // label -> { track, id, phone, name, amount }
const place = async (label, { method = 'cod', items = [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }], phone = newPhone(), name = `Test ${label}`, area = 'Salmiya', lang = 'ar' } = {}) => {
  await clearLimits()
  const res = await fetch(`${SITE}/api/api.php?r=order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ track_id: tr(label), items, payment_method: method, lang,
      customer: { name, phone, governorate: 'hawalli', area, block: '4', street: '12', building: '5' } }),
  })
  const body = await res.json().catch(() => null)
  if (res.status !== 200) throw new Error(`could not place ${label}: ${res.status} ${JSON.stringify(body)}`)
  O[label] = { track: tr(label), id: body.order_id, phone, name, amount: Number(body.amount) }
  return O[label]
}
const upd = (label, set) => sql(`update orders set ${set} where track_id = ${q(tr(label))}`)
const ago = (label, minutes) => upd(label, `created_at = now() - interval ${Math.round(minutes)} minute`)
const asCard = (label, method, status = 'pending') => upd(label, `payment_method = '${method}', payment_status = '${status}'${status === 'paid' ? ', paid_at = now()' : ''}`)
const cancelByOwner = async (label) => {
  await clearLimits()
  const r = await adm('fulfilment', { method: 'POST', body: { order_id: O[label].id, status: 'cancelled' } })
  if (r.status !== 200) throw new Error(`owner cancel of ${label}: ${r.status} ${r.text.slice(0, 120)}`)
}
const state = async (label) => (await rows(`select payment_status, fulfilment_status, stock_released, discount_released, stock_claimed from orders where track_id = ${q(tr(label))}`))[0]

head('2. seeding every state the shop has (real create_order, real sweeper, real owner cancel)')
const STOCKED = await rows("select p.slug, v.size from product_variants v join products p on p.slug = v.slug where p.active = 1 and v.stock > 0 and p.slug <> 'cloudsoft-top-navy' group by p.slug order by p.slug limit 8")

await place('PAIDCARD', { name: 'Paid Card' });                 await asCard('PAIDCARD', 'knet', 'paid'); await ago('PAIDCARD', 180)
await place('PENDINSIDE', { name: 'Layla Inside' });            await asCard('PENDINSIDE', 'knet');       await ago('PENDINSIDE', 1)
await place('PENDFIVE', { name: 'Fatima Seven Minutes' });      await asCard('PENDFIVE', 'knet');         await ago('PENDFIVE', 7)
await place('PENDBEYOND', { name: 'سارة الأحمد', items: [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 2 }], lang: 'ar' }); await asCard('PENDBEYOND', 'knet'); await ago('PENDBEYOND', 45)
await place('FAILEDCARD', { name: 'Mariam Declined', lang: 'en' }); await asCard('FAILEDCARD', 'tpay', 'failed'); await ago('FAILEDCARD', 300)
await place('REVIEWCARD', { name: 'Review Case' });              await asCard('REVIEWCARD', 'knet', 'review'); await ago('REVIEWCARD', 240)
await place('EXPIREDSWEPT', { name: 'Noor Swept', items: [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }, { slug: STOCKED[0][0], size: STOCKED[0][1], qty: 1 }] })
await asCard('EXPIREDSWEPT', 'knet'); await ago('EXPIREDSWEPT', 180)
// an accessories-only card order that holds a discount use and no stock: the sweeper CANCELS it
await sql("insert into discounts (kind, code, label, type, value, active) values ('auto', null, 'Test ten percent', 'percent', 10, 1)")
await place('EXPIREDNOSTK', { name: 'Hessa Accessories', items: [{ slug: 'cagliari-calcio-backpack', qty: 1 }] })
await sql("update discounts set active = 0 where label = 'Test ten percent'")
await asCard('EXPIREDNOSTK', 'tpay'); await ago('EXPIREDNOSTK', 180)
await place('CODCONFIRM', { name: 'Cash Confirmed' });           await upd('CODCONFIRM', "fulfilment_status = 'packed'"); await ago('CODCONFIRM', 30 * 60)
await place('CODEXPSWEPT', { name: 'Cash Expired' });           await ago('CODEXPSWEPT', 26 * 60)
await place('CODINSIDE', { name: 'Cash Inside Hold' });         await ago('CODINSIDE', 120)
await place('CANCELCARD', { name: 'Cancelled Card' });          await asCard('CANCELCARD', 'knet'); await ago('CANCELCARD', 20); await cancelByOwner('CANCELCARD')
await place('CANCELCOD', { name: 'Cancelled Cash' });           await ago('CANCELCOD', 180); await cancelByOwner('CANCELCOD')
await place('CODFAILOLD', { name: 'Historic Cash Failed' });    await upd('CODFAILOLD', "payment_status = 'failed', fulfilment_status = 'cancelled'"); await ago('CODFAILOLD', 40 * 1440)
await place('PACKEDCARD', { name: 'Packed Card' });             await asCard('PACKEDCARD', 'knet'); await upd('PACKEDCARD', "fulfilment_status = 'packed'"); await ago('PACKEDCARD', 120)
await place('DECLINEDOLD', { name: 'Old Declined' });           await asCard('DECLINEDOLD', 'knet', 'failed'); await ago('DECLINEDOLD', 40 * 1440)

// recovery: the abandoned order first, the LATER order second (higher id)
await place('RECPHONE', { name: 'Recovered By Phone' });        await asCard('RECPHONE', 'knet'); await ago('RECPHONE', 50)
const acct = await sql("insert into customer_accounts (name, email, password_hash, phone) values ('Account Owner', 'account.owner@sporta.test', 'x', null); select last_insert_id()")
await place('RECACCOUNT', { name: 'Recovered By Account' });    await asCard('RECACCOUNT', 'knet'); await ago('RECACCOUNT', 60); await upd('RECACCOUNT', `customer_account_id = ${acct}`)
await place('RECCOD', { name: 'Recovered By Cash' });           await asCard('RECCOD', 'tpay', 'failed'); await ago('RECCOD', 240)
await place('NOTREC', { name: 'Later Cash Unconfirmed' });      await asCard('NOTREC', 'knet'); await ago('NOTREC', 90)
// EARLIERPAID is a PAID order of a phone, placed BEFORE (lower id) the abandoned order of the same phone: it must not recover it
await place('EARLIERPAID', { name: 'Earlier Paid' });           await asCard('EARLIERPAID', 'knet', 'paid'); await ago('EARLIERPAID', 3 * 1440)
await place('SAMEPHONE', { name: 'Earlier Paid Then Abandoned', phone: O.EARLIERPAID.phone }); await asCard('SAMEPHONE', 'knet'); await ago('SAMEPHONE', 100)
await place('MANUAL', { name: 'Recovered Manually' });          await asCard('MANUAL', 'knet'); await ago('MANUAL', 70)

// the LATER orders that recover (or do not)
await place('LATERPHONE', { phone: O.RECPHONE.phone, name: 'Recovered By Phone' }); await asCard('LATERPHONE', 'knet', 'paid'); await ago('LATERPHONE', 5)
await place('LATERACCT', { name: 'Recovered By Account' });     await asCard('LATERACCT', 'knet', 'paid'); await upd('LATERACCT', `customer_account_id = ${acct}`)
await place('LATERCOD', { phone: O.RECCOD.phone, name: 'Recovered By Cash' }); await upd('LATERCOD', "fulfilment_status = 'packed'")
await place('LATERCODPEND', { phone: O.NOTREC.phone, name: 'Later Cash Unconfirmed' })   // pending + unfulfilled: not yet a sale

// forbidden-field sentinels, planted on listed orders: they must NEVER come back
const SENT = { note: 'SENTINEL_NOTE_9f3a', block: 'SENTBLK', street: 'SENTSTREET_4c', building: 'SENTBLD', cbk: 'SENTINEL_CBK_77b', utm: 'SENTINEL_UTM_21d', ref: 'sentinel-ref-host.example' }
await upd('PENDBEYOND', `customer_note = ${q(SENT.note)}, customer_block = ${q(SENT.block)}, customer_street = ${q(SENT.street)}, customer_building = ${q(SENT.building)}, cbk_message = ${q(SENT.cbk)}, cbk_paymentid = ${q(SENT.cbk)}, utm_source = ${q(SENT.utm)}, referrer_host = ${q(SENT.ref)}`)
await upd('FAILEDCARD', `customer_note = ${q(SENT.note)}, cbk_message = ${q(SENT.cbk)}, cbk_receipt = ${q(SENT.cbk)}, utm_campaign = ${q(SENT.utm)}`)

// the REAL sweeper, as the host cron runs it
const sweep = JSON.parse((await phpCli('cron-stock.php', ['--release'])).trim().split('\n').pop())
is(sweep.dry_run === false && sweep.released >= 4, 'the real sweeper (cron-stock.php --release) ran and released orders', `released ${sweep.released}, candidates ${sweep.candidates}, failed ${JSON.stringify(sweep.failed)}`)
{
  const s = async (l) => (await state(l)).join('/')
  is((await state('EXPIREDSWEPT'))[0] === 'pending' && (await state('EXPIREDSWEPT'))[1] === 'unfulfilled' && (await state('EXPIREDSWEPT'))[2] === '1', 'sweeper: a card order past its hold stays pending and its stock is put back', await s('EXPIREDSWEPT'))
  is((await state('EXPIREDNOSTK'))[1] === 'cancelled' && (await state('EXPIREDNOSTK'))[3] === '1' && (await state('EXPIREDNOSTK'))[4] === '0', 'sweeper: a no-stock card order holding a discount use is CANCELLED and gives the use back', await s('EXPIREDNOSTK'))
  is((await state('CODEXPSWEPT'))[1] === 'cancelled' && (await state('CODEXPSWEPT'))[2] === '1', 'sweeper: a cash order unconfirmed after 24 h is CANCELLED and its stock put back', await s('CODEXPSWEPT'))
  is((await state('FAILEDCARD'))[2] === '1', 'sweeper: a declined card order has its stock put back', await s('FAILEDCARD'))
  is((await state('CODCONFIRM'))[1] === 'packed' && (await state('CODCONFIRM'))[2] === '0', 'sweeper: a PACKED cash order is never touched, at any age', await s('CODCONFIRM'))
  is((await state('CODINSIDE'))[1] === 'unfulfilled', 'sweeper: a cash order inside its hold is left alone', await s('CODINSIDE'))
  is((await state('CANCELCARD'))[1] === 'cancelled' && (await state('CANCELCOD'))[1] === 'cancelled', 'the owner cancels (real admin route): both are cancelled', `${await s('CANCELCARD')} ${await s('CANCELCOD')}`)
}
// created AFTER the sweep, so they stay as the sweeper would find them within 15 minutes
await place('CODEXPWAIT', { name: 'Cash Past Hold Awaiting Sweep' }); await ago('CODEXPWAIT', 26 * 60)
await place('EXPIREDWAIT', { name: 'Card Past Hold Awaiting Sweep' }); await asCard('EXPIREDWAIT', 'knet'); await ago('EXPIREDWAIT', 150)
// seven lines: the page shows five and counts the rest
await place('MANYLINES', { name: 'Seven Lines', method: 'cod', items: STOCKED.slice(0, 7).map(([slug, size]) => ({ slug, size, qty: 1 })) })
await asCard('MANYLINES', 'knet'); await ago('MANYLINES', 90)
is(Object.keys(O).length >= 30, 'orders seeded through the real route', `${Object.keys(O).length} orders`)

// --- expectations written from the DEFINITION, independent of the code under test
const EXPECT = {
  PENDINSIDE: 'waiting', PENDFIVE: 'waiting', PENDBEYOND: 'unpaid', FAILEDCARD: 'declined', EXPIREDSWEPT: 'expired', EXPIREDNOSTK: 'expired',
  CODEXPSWEPT: 'cod_expired', CANCELCARD: 'cancelled', CANCELCOD: 'cancelled', DECLINEDOLD: 'declined',
  RECPHONE: 'unpaid', RECACCOUNT: 'unpaid', RECCOD: 'declined', NOTREC: 'unpaid', SAMEPHONE: 'unpaid',
  MANUAL: 'unpaid', CODEXPWAIT: 'cod_expired', EXPIREDWAIT: 'expired', MANYLINES: 'unpaid',
}
const NEVER = ['PAIDCARD', 'REVIEWCARD', 'CODCONFIRM', 'CODINSIDE', 'CODFAILOLD', 'PACKEDCARD', 'LATERPHONE', 'LATERACCT', 'LATERCOD', 'LATERCODPEND', 'EARLIERPAID']
const RECOVERED = ['RECPHONE', 'RECACCOUNT', 'RECCOD']          // MANUAL joins them once the owner marks it
const byTrack = (r) => Object.fromEntries((r.json?.orders ?? []).map((o) => [o.track_id, o]))
const labelOf = (track) => track.startsWith(`ABT${TAG}`) ? track.slice(7) : track
const Q = { q: `ABT${TAG}` }                                      // isolates the seeded set from any filler

// =========================================================================== 3
head('3. the definition: each state lands in the right reason')
await clearLimits()
const all = await list({ ...Q, reason: 'all', include_recovered: '1' })
is(all.status === 200 && Array.isArray(all.json?.orders), 'the list answers 200', `${all.status} ${all.text.slice(0, 100)}`)
const got = Object.fromEntries((all.json?.orders ?? []).map((o) => [labelOf(o.track_id), o.reason]))
for (const [label, reason] of Object.entries(EXPECT)) {
  if (reason === 'waiting' || reason === 'cancelled') continue
  is(got[label] === reason, `${label} is listed as ${reason}`, `got ${got[label] ?? 'not listed'}`)
}
const wanted = Object.keys(EXPECT).filter((l) => !['waiting', 'cancelled'].includes(EXPECT[l])).sort().join(',')
is(Object.keys(got).sort().join(',') === wanted, 'and nothing else is in the abandoned list (exactly the expected set)', `listed ${Object.keys(got).length}, expected ${wanted.split(',').length}`)
for (const label of NEVER) is(!(label in got), `${label} is never listed`)
{
  const w = await list({ ...Q, reason: 'waiting' }), c = await list({ ...Q, reason: 'cancelled' })
  is(w.json?.orders?.map((o) => labelOf(o.track_id)).sort().join() === 'PENDFIVE,PENDINSIDE', 'reason=waiting lists only the card orders still inside the threshold', w.json?.orders?.map((o) => labelOf(o.track_id)).sort().join())
  is(c.json?.orders?.map((o) => labelOf(o.track_id)).sort().join() === 'CANCELCARD,CANCELCOD', 'reason=cancelled lists only the orders the OWNER cancelled before the hold ran out (not abandonment)', c.json?.orders?.map((o) => labelOf(o.track_id)).sort().join())
  is(!('PENDINSIDE' in got) && !('CANCELCARD' in got) && !('CANCELCOD' in got), 'waiting and owner-cancelled orders are NOT in "all"')
  // the per-reason query is NARROWED for the index (a redundant sargable restatement); it must still give exactly what the one classification gives
  const union = [...all.json.orders, ...w.json.orders, ...c.json.orders]
  for (const r of ['unpaid', 'expired', 'declined', 'cod_expired', 'waiting', 'cancelled']) {
    const want = union.filter((o) => o.reason === r).map((o) => labelOf(o.track_id)).sort().join()
    const have = ((await list({ ...Q, reason: r, include_recovered: '1' })).json?.orders ?? []).map((o) => labelOf(o.track_id)).sort().join()
    is(want !== '' && have === want, `reason=${r}: the narrowed query returns exactly the rows the full classification gives`, want === have ? want.split(',').length + ' rows' : `want ${want} got ${have}`)
  }
  is(w.json?.orders?.[0]?.abandoned === false && c.json?.orders?.[0]?.abandoned === false && all.json.orders.every((o) => o.abandoned === true), 'each row says whether it counts as abandoned')
}

head('3b. recovery: a LATER paid or confirmed order from the same phone or account')
{
  const def = await list({ ...Q })
  const t = byTrack(def)
  const abandonedLabels = Object.entries(EXPECT).filter(([, r]) => !['waiting', 'cancelled'].includes(r)).map(([l]) => l)
  const defGot = Object.keys(t).map(labelOf).sort().join()
  const defWant = abandonedLabels.filter((l) => !RECOVERED.includes(l)).sort().join()
  is(defGot === defWant, 'the DEFAULT list is exactly the abandoned orders that nobody recovered (a list that is empty would pass every "hidden" check below, so this one names the set)', `${Object.keys(t).length} listed`)
  for (const l of RECOVERED) is(!(tr(l) in t), `${l} is hidden by default: a later order recovered it`)
  for (const l of ['NOTREC', 'SAMEPHONE']) is(tr(l) in t && t[tr(l)].recovered === false, `${l} is still listed and NOT recovered`, l === 'NOTREC' ? 'the later cash order is only pending' : 'the paid order of this phone is EARLIER')
  const a = byTrack(all)
  is(a[tr('RECPHONE')]?.recovered === true && a[tr('RECPHONE')]?.recovered_by === 'order', 'recovered by the same phone: recovered_by "order"')
  is(a[tr('RECACCOUNT')]?.recovered === true, 'recovered by the same signed-in account (one email = one account): hidden, countable')
  is(a[tr('RECCOD')]?.recovered === true, 'recovered by a later cash order the shop has PACKED')
  is(a[tr('NOTREC')]?.recovered === false, 'a later cash order still awaiting confirmation does not recover')
  // the owner takes MANUAL by phone
  const m = await follow({ order_id: O.MANUAL.id, state: 'recovered_manually', note: 'ordered by phone' })
  is(m.status === 200 && m.json?.followup?.state === 'recovered_manually', 'the owner marks one recovered_manually', `${m.status}`)
  const after = byTrack(await list({ ...Q }))
  is(!(tr('MANUAL') in after) && Object.keys(after).map(labelOf).sort().join() === abandonedLabels.filter((l) => !RECOVERED.includes(l) && l !== 'MANUAL').sort().join(), 'and it leaves the default list (the rest of the set is unchanged)')
  const withRec = byTrack(await list({ ...Q, include_recovered: '1' }))
  is(withRec[tr('MANUAL')]?.recovered === true && withRec[tr('MANUAL')]?.recovered_by === 'manual', 'include_recovered=1 brings it back, recovered_by "manual"')
}

{
  // two historic rows with an EMPTY phone are not one customer
  await sql(`insert into orders (track_id, amount, payment_status, payment_method, customer_name, customer_phone) values (${q(tr('BLANKA'))}, 5, 'failed', 'knet', 'Blank Phone A', ''), (${q(tr('BLANKB'))}, 5, 'paid', 'knet', 'Blank Phone B', '')`)
  const bl = byTrack(await list({ ...Q }))
  is(tr('BLANKA') in bl && bl[tr('BLANKA')].recovered === false, 'two orders with an EMPTY phone are not "the same customer": the earlier one is not recovered by the later')
  await sql(`delete from orders where track_id in (${q(tr('BLANKA'))}, ${q(tr('BLANKB'))})`)
}

head('3c. the summary: counts, values, recovery rate')
{
  const r = await list({ ...Q })
  const s = r.json?.summary
  const amt = (labels) => Math.round(labels.reduce((a, l) => a + O[l].amount, 0) * 1000) / 1000
  const groups = { unpaid: [], expired: [], declined: [], cod_expired: [] }
  for (const [l, reason] of Object.entries(EXPECT)) if (groups[reason]) groups[reason].push(l)
  const REC = ['RECPHONE', 'RECACCOUNT', 'RECCOD', 'MANUAL']
  let lostN = 0, lostV = 0, recN = 0, recV = 0
  for (const [reason, labels] of Object.entries(groups)) {
    const rec = labels.filter((l) => REC.includes(l)), lost = labels.filter((l) => !REC.includes(l))
    const b = s?.by_reason?.[reason]
    is(b?.count === lost.length && Math.abs(b.value - amt(lost)) < 0.0005 && b?.recovered_count === rec.length && Math.abs(b.recovered_value - amt(rec)) < 0.0005,
      `${reason}: ${lost.length} still lost (${amt(lost).toFixed(3)} KD), ${rec.length} recovered (${amt(rec).toFixed(3)} KD)`, JSON.stringify(b))
    lostN += lost.length; lostV += amt(lost); recN += rec.length; recV += amt(rec)
  }
  is(s?.abandoned?.count === lostN && Math.abs(s.abandoned.value - lostV) < 0.001, `total still lost: ${lostN} orders, ${lostV.toFixed(3)} KD`, JSON.stringify(s?.abandoned))
  is(s?.abandoned?.recovered_count === recN && Math.abs(s.abandoned.recovered_value - recV) < 0.001, `total recovered: ${recN} orders, ${recV.toFixed(3)} KD`)
  const rate = Math.round(recN * 1000 / (recN + lostN)) / 10
  is(s?.abandoned?.recovery_rate === rate, `recovery rate ${rate}% = recovered / all abandoned`, `got ${s?.abandoned?.recovery_rate}`)
  is(s?.waiting?.count === 2 && Math.abs(s.waiting.value - amt(['PENDINSIDE', 'PENDFIVE'])) < 0.0005, 'waiting: counted apart, not as abandoned', JSON.stringify(s?.waiting))
  is(s?.cancelled_by_shop?.count === 2 && Math.abs(s.cancelled_by_shop.value - amt(['CANCELCARD', 'CANCELCOD'])) < 0.0005, 'cancelled by the shop: counted apart, not as lost', JSON.stringify(s?.cancelled_by_shop))
  const none = await list({ q: 'NO-SUCH-ORDER-ZZZ' })
  is(none.json?.summary?.abandoned?.recovery_rate === null && none.json?.summary?.abandoned?.count === 0 && none.json.orders.length === 0, 'with nothing to count the rate is null, not a division by zero')
}

head('3d. the row: every field the owner needs, item summary included')
{
  const t = byTrack(all)
  const c = t[tr('PENDBEYOND')], many = t[tr('MANYLINES')], f = t[tr('FAILEDCARD')], x = t[tr('EXPIREDNOSTK')], sw = t[tr('EXPIREDSWEPT')]
  is(c.id === O.PENDBEYOND.id && c.payment_method === 'knet' && c.payment_status === 'pending' && Math.abs(c.amount - O.PENDBEYOND.amount) < 0.0005, 'id, track id, payment method and amount (KD)', `${c.payment_method} ${c.amount}`)
  is(c.minutes_ago >= 45 && c.minutes_ago < 105, 'minutes_ago counts from created_at on the database clock (45 when seeded)', String(c.minutes_ago))
  is(c.customer_name === 'سارة الأحمد' && c.customer_phone === canon(O.PENDBEYOND.phone) && c.whatsapp_phone === canon(O.PENDBEYOND.phone) && c.customer_area === 'Salmiya' && c.customer_lang === 'ar', 'name (Arabic intact), phone, WhatsApp number, area, language')
  is(c.item_count === 2 && c.items.length === 1 && c.items[0].qty === 2 && c.items[0].size === 'L' && /Cloudsoft/i.test(c.items[0].name_en) && /./.test(c.items[0].name_ar), 'item count 2 and the line "Cloudsoft … L × 2" with both names', JSON.stringify(c.items))
  is(f.customer_lang === 'en' && f.payment_method === 'tpay' && f.stock_released === true, 'a declined T-Pay order: language en, stock released', `stock_released ${f.stock_released}`)
  is(sw.stock_released === true && sw.item_count === 2 && sw.items.length === 2, 'the swept card order: stock released, two lines')
  is(x.stock_released === false && x.discount_released === true && x.fulfilment_status === 'cancelled', 'the swept no-stock order: discount use given back, no stock to release, cancelled by the sweeper')
  is(many.item_count === 7 && many.items.length === 5 && many.items_more === 2, 'seven lines: five shown, items_more 2, item_count 7', `${many.item_count}/${many.items.length}/${many.items_more}`)
  is(t[tr('PENDBEYOND')].followup === null, 'a row with no follow-up says followup: null')
}

// =========================================================================== 4
head('4. the settings: threshold, hold, cash hold')
{
  const reasonOf = async (label, params = {}) => {
    const r = await list({ ...Q, reason: 'waiting', ...params })
    if ((r.json?.orders ?? []).some((o) => o.track_id === tr(label))) return 'waiting'
    const a = byTrack(await list({ ...Q, include_recovered: '1', ...params }))
    const c = byTrack(await list({ ...Q, reason: 'cancelled', ...params }))
    return (a[tr(label)] ?? c[tr(label)])?.reason ?? 'none'
  }
  const settings = async () => (await list({ ...Q })).json?.settings
  is(JSON.stringify(await settings()) === JSON.stringify({ abandoned_after_minutes: 30, hold_minutes: 120, cod_hold_hours: 24 }), 'defaults in code: 30 minutes, hold 120 minutes, cash hold 24 hours', JSON.stringify(await settings()))
  setConfig({ abandoned_after_minutes: 60 })
  is((await reasonOf('PENDBEYOND')) === 'waiting' && (await settings()).abandoned_after_minutes === 60, 'abandoned_after_minutes 60: a 45-minute card order is only waiting')
  setConfig({ abandoned_after_minutes: 5 })
  is((await reasonOf('PENDFIVE')) === 'unpaid' && (await reasonOf('PENDINSIDE')) === 'waiting', 'abandoned_after_minutes 5: a 7-minute card order is abandoned, a 1-minute one is not')
  setConfig({ abandoned_after_minutes: 1 })
  is((await settings()).abandoned_after_minutes === 5, 'a value below the floor is raised to 5 (a shopper entering an OTP is not abandoned)')
  setConfig({ abandoned_after_minutes: 999 })
  is((await settings()).abandoned_after_minutes === 120 && (await reasonOf('PENDBEYOND')) === 'waiting', 'never later than the sweeper hold: 999 becomes the hold, 120')
  setConfig({ abandoned_after_minutes: 'abc' })
  is((await settings()).abandoned_after_minutes === 5, 'a non-numeric value does not crash (treated as the floor)')
  setConfig({ stock_hold_minutes: 20 })
  is(JSON.stringify(await settings()) === JSON.stringify({ abandoned_after_minutes: 20, hold_minutes: 20, cod_hold_hours: 24 }) && (await reasonOf('PENDBEYOND')) === 'expired' && (await reasonOf('PENDINSIDE')) === 'waiting',
    'stock_hold_minutes 20: the hold follows cron-stock.php, the threshold is clamped under it, a 45-minute order is expired', JSON.stringify(await settings()))
  setConfig({ stock_hold_minutes: 5 })
  is((await settings()).hold_minutes === 15, 'a hold below 15 is read as 15, exactly as the sweeper reads it')
  setConfig({ cod_hold_hours: 48 })
  is((await reasonOf('CODEXPSWEPT')) === 'cancelled' && (await reasonOf('CODEXPWAIT')) === 'none', 'cod_hold_hours 48: a cash order cancelled at 26 h was cancelled BEFORE the hold, so it is a person\'s decision, and a 26 h order is still live')
  setConfig({ cod_hold_hours: 0 })
  is((await reasonOf('CODEXPWAIT')) === 'none' && (await reasonOf('CODEXPSWEPT')) === 'cancelled' && (await settings()).cod_hold_hours === 0, 'cod_hold_hours 0 (rule off): no cash order is "expired"')
  setConfig()
  is((await reasonOf('CODEXPSWEPT')) === 'cod_expired' && (await reasonOf('PENDBEYOND')) === 'unpaid', 'and back to the defaults everything is as it was')
}

// =========================================================================== 5
head('5. search, date range, pagination')
{
  const found = async (qq, extra = {}) => (await list({ q: qq, reason: 'all', include_recovered: '1', ...extra })).json?.orders?.map((o) => labelOf(o.track_id)) ?? []
  const p = O.PENDBEYOND.phone
  is((await found(p)).includes('PENDBEYOND'), 'search by phone: the 8 digits')
  is((await found(`+965 ${p.slice(0, 4)} ${p.slice(4)}`)).includes('PENDBEYOND'), 'search by phone typed with +965 and spaces')
  is((await found([...p].map((d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]).join(''))).includes('PENDBEYOND'), 'search by phone typed in Arabic-Indic digits')
  is((await found(`00965 ${p.slice(0, 4)} ${p.slice(4)}`)).includes('PENDBEYOND'), 'search by phone typed with the 00965 prefix (its digits never occur in a stored 965XXXXXXXX)')
  is((await found('الأحمد')).join() === 'PENDBEYOND', 'search by name, Arabic', (await found('الأحمد')).join())
  is((await found('declined')).includes('FAILEDCARD') && !(await found('declined')).includes('PENDBEYOND'), 'search by name, English, case-insensitive')
  is((await found(tr('FAILEDCARD'))).join() === 'FAILEDCARD', 'search by track id')
  is((await found('%')).length === 0, 'a typed % is a literal, not a wildcard that matches everything')
  is((await found('_')).length === 0, 'and so is _')
  is((await found("x' or '1'='1")).length === 0, 'a quote does not reach the SQL')
  const sum = (await list({ q: 'Declined' })).json?.summary
  is(sum?.by_reason?.declined?.count === 2 && sum?.abandoned?.count === 2, 'the summary follows the search (it counts what matches)', JSON.stringify(sum?.abandoned))
  for (const bad of ['a'.repeat(81), 'x\u0007y']) {
    const r = await list({ q: bad })
    is(r.status === 400 && r.json?.error === 'invalid_filter' && !r.text.includes('xxxx'), 'an over-long or control-character search is refused with a bare token', `${r.status} ${r.text.slice(0, 60)}`)
  }
  // malformed UTF-8 (a lone 0xFF, an overlong slash, a truncated euro sign): it used to pass every check and come back as an EMPTY 200
  // (json_encode failed on the echoed filter), which the admin page reads as "route absent". Added in the independent review.
  for (const raw of ['%FF%FE', '%C0%AF', '%E2%82']) {
    const r = await adm('abandoned_orders', { qs: `&q=${raw}` })
    is(r.status === 400 && r.json?.error === 'invalid_filter', `a malformed UTF-8 search (?q=${raw}) is refused with a bare token, not an empty 200`, `${r.status} ${JSON.stringify(r.text.slice(0, 40))}`)
  }
  // dates, from the database's own clock
  const day = (offset) => sql(`select date_format(now() - interval ${offset} day, '%Y-%m-%d')`)
  const today = await day(0), d30 = await day(30), d41 = await day(41)
  const ids = async (extra) => (await list({ ...Q, reason: 'all', include_recovered: '1', ...extra })).json?.orders?.map((o) => labelOf(o.track_id)) ?? []
  is(!(await ids({ from: today })).includes('DECLINEDOLD') && (await ids({ from: today })).includes('PENDBEYOND'), 'from=today leaves out a 40-day-old order')
  is((await ids({ to: d30 })).join() === 'DECLINEDOLD', 'to=30 days ago finds only the 40-day-old one', (await ids({ to: d30 })).join())
  is((await ids({ from: d41, to: d30 })).join() === 'DECLINEDOLD', 'from/to together')
  is((await ids({ from: today, to: today })).includes('PENDBEYOND'), 'to is INCLUSIVE: an order created later today is in from=today&to=today')
  is((await list({ from: today, to: d30 })).status === 400 && (await list({ from: '2026-13-40' })).status === 400 && (await list({ to: '2026-02-30' })).status === 400 && (await list({ from: 'yesterday' })).status === 400,
    'from after to, a date that does not exist, and a non-date are refused (400 invalid_filter)')
  const sd = (await list({ ...Q, to: d30 })).json?.summary
  is(sd?.abandoned?.count === 1 && sd?.by_reason?.declined?.count === 1, 'the summary follows the date range', JSON.stringify(sd?.abandoned))
  for (const bad of [{ reason: 'bogus' }, { include_recovered: '2' }, { page: '0' }, { page: '501' }, { page: 'x' }, { page: '1.5' }, { reason: 'unpaid&reason=declined' }]) {
    const r = await list(bad)
    is(r.status === 400 && r.json?.error === 'invalid_filter', `refused: ${JSON.stringify(bad)}`, `${r.status}`)
  }
  const arr = await adm('abandoned_orders', { qs: '&reason[]=unpaid' })
  is(arr.status === 400, 'an array-valued filter is refused, not coerced')
}

// =========================================================================== 6
head('6. admin only')
{
  await clearLimits()
  const noSession = await adm('abandoned_orders', { jar: false })
  is(noSession.status === 401 && noSession.json?.error === 'not_signed_in', 'no session: 401 not_signed_in', `${noSession.status}`)
  is(!/phone|customer|SENTINEL/i.test(noSession.text), 'and the refusal carries no data')
  const noHdr = await list({}, { headers: { 'X-Sporta-Admin': null } })
  is(noHdr.status === 400 && noHdr.json?.error === 'bad_request', 'session but no X-Sporta-Admin header: 400 bad_request (the CSRF header)', `${noHdr.status}`)
  const noSessPost = await follow({ order_id: O.PENDBEYOND.id, state: 'contacted' }, { jar: false })
  is(noSessPost.status === 401, 'the write without a session: 401')
  const noHdrPost = await follow({ order_id: O.PENDBEYOND.id, state: 'contacted' }, { headers: { 'X-Sporta-Admin': null } })
  is(noHdrPost.status === 400, 'the write without the CSRF header: 400')
  const xsite = await follow({ order_id: O.PENDBEYOND.id, state: 'contacted' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
  is(xsite.status === 403, 'the write from a cross-site request: 403', `${xsite.status}`)
  const noCt = await follow({ order_id: O.PENDBEYOND.id, state: 'contacted' }, { headers: { 'Content-Type': 'text/plain' } })
  is(noCt.status === 403, 'the write with a non-JSON content type: 403', `${noCt.status}`)
  is((await adm('abandoned_orders', { method: 'POST', body: {} })).status === 405 && (await adm('abandoned_followup', { method: 'GET' })).status === 405, 'the wrong method on either route: 405')
  is((await sql(`select count(*) from abandoned_followup where order_id = ${O.PENDBEYOND.id}`)) === '0', 'none of the refused writes wrote a row')
  const direct = await fetch(`${SITE}/api/abandoned.php`)
  is(direct.status === 403 && (await direct.text()) === '', 'abandoned.php requested directly answers 403 and nothing (it is an include)', String(direct.status))
}

head('6b. throttling')
{
  // The limiter counts in WINDOWS ALIGNED to the clock minute, so a burst that straddles :00 is split in two and never
  // reaches the limit. The bursts start just after a minute boundary (the whole thing takes seconds) and are counted,
  // not ordered: 95 parallel reads and 33 parallel writes; the reads must give exactly 90 x 200 and 5 x 429, the
  // writes exactly 30 x 200 and 3 x 429. A burst that did cross a boundary is run again.
  const burst = async (n, fn) => {
    const out = []
    for (let i = 0; i < n; i += 10) out.push(...await Promise.all(Array.from({ length: Math.min(10, n - i) }, (_, k) => fn(i + k))))
    return out
  }
  let readStatuses = [], writeStatuses = [], r429 = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() % 60000 > 20000) await sleep(60300 - (Date.now() % 60000))
    await clearLimits()
    const w0 = Math.floor(Date.now() / 60000)
    const xff = { 'X-Forwarded-For': `203.0.113.${77 + attempt * 4}` }
    readStatuses = (await burst(95, () => list({ q: 'zz' }, { headers: xff }))).map((r) => r.status)
    r429 = await list({ q: 'zz' }, { headers: xff })
    writeStatuses = (await burst(33, (i) => follow({ order_id: O.PENDBEYOND.id, state: 'contacted', note: `n${i}` }, { headers: { 'X-Forwarded-For': `203.0.113.${78 + attempt * 4}` } }))).map((r) => r.status)
    if (Math.floor(Date.now() / 60000) === w0) break
    info('a burst crossed a minute boundary: counted again', `attempt ${attempt + 1}`)
  }
  const n = (arr, s) => arr.filter((x) => x === s).length
  is(n(readStatuses, 200) === 90 && n(readStatuses, 429) === 5, 'reads: 90 a minute per client, then 429', `95 requests: ${n(readStatuses, 200)} x 200, ${n(readStatuses, 429)} x 429`)
  is(r429.status === 429 && r429.json?.error === 'too_many_attempts' && Number(r429.headers.get('retry-after')) >= 1 && r429.json?.retry_after >= 1, '429 carries Retry-After and a bare token', r429.text.slice(0, 80))
  const other = await list({ q: 'zz' }, { headers: { 'X-Forwarded-For': '203.0.113.99' } })
  is(other.status === 200, 'another client is not affected')
  is(n(writeStatuses, 200) === 30 && n(writeStatuses, 429) === 3, 'writes: 30 a minute per client, then 429', `33 requests: ${n(writeStatuses, 200)} x 200, ${n(writeStatuses, 429)} x 429`)
  await clearLimits()
  await sql(`delete from abandoned_followup where order_id = ${O.PENDBEYOND.id}`)
}

// =========================================================================== 7
head('7. privacy: the response is exactly what is documented, and nothing else')
const KEYS = {
  top: 'filters,has_more,orders,page,settings,summary',
  settings: 'abandoned_after_minutes,cod_hold_hours,hold_minutes',
  filters: 'from,include_recovered,q,reason,to',
  summary: 'abandoned,by_reason,cancelled_by_shop,waiting',
  abandoned: 'count,recovered_count,recovered_value,recovery_rate,value',
  reason: 'count,recovered_count,recovered_value,value',
  waiting: 'count,value',
  order: 'abandoned,amount,created_at,customer_area,customer_governorate,customer_lang,customer_name,customer_phone,discount_released,followup,fulfilment_status,id,item_count,items,items_more,minutes_ago,payment_method,payment_status,reason,recovered,recovered_by,stock_released,track_id,whatsapp_phone',
  item: 'fit,name_ar,name_en,qty,size',
  followup: 'at,by,note,state',
}
const keySet = (o) => Object.keys(o).sort().join(',')
const documented = (j) => {
  const bad = []
  const eq = (path, o, want) => { if (keySet(o) !== want) bad.push(`${path}: ${keySet(o)}`) }
  eq('top', j, KEYS.top); eq('settings', j.settings, KEYS.settings); eq('filters', j.filters, KEYS.filters); eq('summary', j.summary, KEYS.summary)
  eq('summary.abandoned', j.summary.abandoned, KEYS.abandoned)
  for (const [k, v] of Object.entries(j.summary.by_reason)) eq(`by_reason.${k}`, v, KEYS.reason)
  eq('waiting', j.summary.waiting, KEYS.waiting); eq('cancelled_by_shop', j.summary.cancelled_by_shop, KEYS.waiting)
  for (const o of j.orders) {
    eq('order', o, KEYS.order)
    for (const it of o.items) eq('item', it, KEYS.item)
    if (o.followup) eq('followup', o.followup, KEYS.followup)
  }
  return bad
}
{
  await follow({ order_id: O.PENDBEYOND.id, state: 'contacted', note: 'called, will pay tomorrow' })
  const r = await list({ ...Q, include_recovered: '1' })
  const bad = documented(r.json)
  is(bad.length === 0 && r.json.orders.some((o) => o.followup) && r.json.orders.some((o) => o.items.length), 'the key set at every level is exactly the documented one (so a new field fails this test until a person reads it)', bad.slice(0, 3).join(' | '))
  const text = r.text
  for (const [name, v] of Object.entries(SENT)) is(!text.includes(v), `the value planted in a forbidden column never appears: ${name}`)
  is(!/password|token|user_agent|"ip"|cbk_|customer_note|customer_block|customer_street|customer_building|referrer|utm_|session|secret/i.test(text), 'and no forbidden column NAME appears anywhere in the response')
  is(!text.includes(ADMIN_PW) && !/\$2y\$|argon/i.test(text), 'no password or hash')
  is(/"by":"ab-admin@sporta.test"/.test(text), 'the follow-up names the admin who made it (staff, not customer, data)')
  const err = await list({ q: 'x'.repeat(90) + ' 96555501003 سارة' })
  is(err.status === 400 && err.text === '{"error":"invalid_filter"}', 'an error is a bare token: it names no value the caller sent', err.text)
  const err2 = await follow({ order_id: O.PENDBEYOND.id, state: 'contacted', note: 'n'.repeat(281) })
  is(err2.status === 400 && err2.text === '{"error":"note_too_long"}', 'same for a refused note', err2.text)
  await sql(`delete from abandoned_followup where order_id = ${O.PENDBEYOND.id}`)
  const hdr = await list({ ...Q })
  is(/no-store/.test(hdr.headers.get('cache-control') ?? '') && /json/.test(hdr.headers.get('content-type') ?? ''), 'the answer is JSON with Cache-Control: no-store (admin.php sets it for every route)', hdr.headers.get('cache-control'))
  const log = existsSync(phpErrLog) ? readFileSync(phpErrLog, 'utf8') : ''
  const pii = [...Object.values(O).flatMap((o) => [o.phone, o.name]), 'سارة', 'account.owner@sporta.test', ADMIN].filter((v) => v && log.includes(v))
  is(pii.length === 0, 'nothing personal reached the PHP error log (names, phones, emails)', pii.length ? pii.slice(0, 3).join(',') : `${log.split('\n').filter(Boolean).length} lines`)
}

// =========================================================================== 8
head('8. the follow-up: validation, one atomic upsert, activity log')
{
  await clearLimits()
  const id = O.PENDBEYOND.id
  const logCount = () => sql("select count(*) from admin_activity_log where action_key = 'abandoned_followup'")
  const l0 = Number(await logCount())
  const a = await follow({ order_id: id, state: 'contacted', note: 'اتصلت — سيدفع غداً' })
  is(a.status === 200 && a.json?.followup?.state === 'contacted' && a.json.followup.note === 'اتصلت — سيدفع غداً' && a.json.followup.by === ADMIN && /^\d{4}-/.test(a.json.followup.at), 'sets contacted with an Arabic note; answers the stored row', a.text.slice(0, 120))
  const b = await follow({ order_id: id, state: 'wrong_number', note: '' })
  is(b.status === 200 && b.json.followup.state === 'wrong_number' && b.json.followup.note === '', 'a second write REPLACES it (same row)')
  is((await sql(`select count(*) from abandoned_followup where order_id = ${id}`)) === '1', 'one row per order, ever')
  const again = await follow({ order_id: id, state: 'wrong_number', note: '' })
  is(again.status === 200 && JSON.stringify({ ...again.json.followup, at: 0 }) === JSON.stringify({ ...b.json.followup, at: 0 }), 'repeating the same request gives the same state (idempotent)')
  const l1 = Number(await logCount())
  is(l1 - l0 === 3, 'the activity log recorded each successful write once (key abandoned_followup)', `+${l1 - l0}`)
  const lst = byTrack(await list({ ...Q }))
  is(lst[tr('PENDBEYOND')]?.followup?.state === 'wrong_number', 'the list shows the follow-up state on the row')
  for (const s of ['contacted', 'not_interested']) is((await follow({ order_id: id, state: s })).status === 200, `state ${s} is accepted`)
  const refused = [
    [{ order_id: id, state: 'sent' }, 'invalid_state'], [{ order_id: id }, 'invalid_state'], [{ order_id: id, state: ['contacted'] }, 'invalid_state'],
    [{ order_id: 0, state: 'contacted' }, 'invalid_order'], [{ state: 'contacted' }, 'invalid_order'], [{ order_id: '1; drop table orders', state: 'contacted' }, 'invalid_order'],
    [{ order_id: -4, state: 'contacted' }, 'invalid_order'], [{ order_id: 1.5, state: 'contacted' }, 'invalid_order'], [{ order_id: 99999999999, state: 'contacted' }, 'invalid_order'],
    [{ order_id: id, state: 'contacted', note: 'x'.repeat(281) }, 'note_too_long'], [{ order_id: id, state: 'contacted', note: 'ع'.repeat(281) }, 'note_too_long'],
    [{ order_id: id, state: 'contacted', note: 123 }, 'invalid_note'], [{ order_id: id, state: 'contacted', note: { a: 1 } }, 'invalid_note'],
  ]
  for (const [body, token] of refused) {
    const r = await follow(body)
    is(r.status === 400 && r.json?.error === token, `refused ${JSON.stringify(body).slice(0, 60)} → ${token}`, `${r.status} ${r.json?.error}`)
  }
  is((await follow(null, { raw: true, body: '{not json' })).status === 400, 'a body that is not JSON is refused')
  is((await follow({ order_id: id, state: 'contacted', note: 'ع'.repeat(280) })).status === 200 && (await sql(`select char_length(note) from abandoned_followup where order_id = ${id}`)) === '280', 'exactly 280 characters is accepted (Arabic counted in characters, not bytes)')
  const ctl = await follow({ order_id: id, state: 'contacted', note: 'line one\nline two\t\u0000tail' })
  is(ctl.status === 200 && ctl.json.followup.note === 'line one line two tail', 'control characters are replaced by spaces, never stored', JSON.stringify(ctl.json?.followup?.note))
  const nul = await follow({ order_id: id, state: 'contacted', note: null })
  is(nul.status === 200 && nul.json.followup.note === '', 'a null note is an empty note')
  is((await follow({ order_id: 99999999, state: 'contacted' })).status === 404, 'an order that does not exist: 404')
  is((await follow({ order_id: O.PAIDCARD.id, state: 'contacted' })).json?.error === 'not_abandoned', 'a paid order: 409 not_abandoned (the table never fills with notes on live orders)')
  is((await follow({ order_id: O.CODINSIDE.id, state: 'contacted' })).status === 409 && (await follow({ order_id: O.REVIEWCARD.id, state: 'contacted' })).status === 409, 'a cash order inside its hold and a review order: 409')
  is((await follow({ order_id: O.PENDINSIDE.id, state: 'contacted' })).status === 200 && (await follow({ order_id: O.CANCELCARD.id, state: 'not_interested' })).status === 200, 'waiting and owner-cancelled orders can carry a note (the owner sees them on request)')
  const del = await follow({ order_id: id, state: 'none' })
  is(del.status === 200 && del.json.followup === null && (await sql(`select count(*) from abandoned_followup where order_id = ${id}`)) === '0', 'state "none" removes the follow-up; doing it twice is fine')
  is((await follow({ order_id: id, state: 'none' })).status === 200, 'removing what is not there is not an error')
  await sql('delete from abandoned_followup')
}

head('8a. a database that is behind the code')
{
  await clearLimits()
  await sql('rename table abandoned_followup to abandoned_followup_x')
  const r1 = await list({ ...Q }), r2 = await follow({ order_id: O.NOTREC.id, state: 'contacted' })
  await sql('rename table abandoned_followup_x to abandoned_followup')
  is(r1.status === 503 && r1.json?.error === 'no_table' && r2.status === 503 && r2.json?.error === 'no_table', 'without abandoned.mysql.sql both routes answer 503 no_table (the admin screens name the fix), not a 500 and not a stack trace', `${r1.status} ${r1.text.slice(0, 40)} / ${r2.status}`)
  await sql('rename table order_tracking_events to order_tracking_events_x')
  const lst = await list({ ...Q, reason: 'cancelled' }), alls = await list({ ...Q, include_recovered: '1' })
  await sql('rename table order_tracking_events_x to order_tracking_events')
  const cl = (lst.json?.orders ?? []).map((o) => labelOf(o.track_id)).sort().join()
  is(lst.status === 200 && cl === 'CANCELCARD,CANCELCOD,CODEXPSWEPT,EXPIREDNOSTK' && !(alls.json?.orders ?? []).some((o) => ['CODEXPSWEPT', 'EXPIREDNOSTK'].includes(labelOf(o.track_id))),
    'without the order timeline the list still works, and a cancelled order is "cancelled" (never claimed to be the sweeper\'s: the time is the only evidence)', `${lst.status} ${cl}`)
}

head('8b. 16 concurrent writers: one row, one writer\'s whole value')
{
  const states = ['contacted', 'not_interested', 'wrong_number', 'recovered_manually']
  const roundHttp = async (orderId, tag) => {
    await clearLimits()
    const res = await Promise.all(Array.from({ length: 16 }, (_, i) => follow({ order_id: orderId, state: states[i % 4], note: `${tag}-${i}` }, { headers: { 'X-Forwarded-For': `198.51.100.${10 + i}` } })))
    const row = (await rows(`select state, note, updated_by from abandoned_followup where order_id = ${orderId}`))
    const sent = new Set(res.map((r, i) => `${states[i % 4]}|${tag}-${i}`))
    return { statuses: res.map((r) => r.status), n: row.length, whole: row.length === 1 && sent.has(`${row[0][0]}|${row[0][1]}`) }
  }
  const h1 = await roundHttp(O.RECPHONE.id, 'http-new')
  is(h1.statuses.every((s) => s === 200) && h1.n === 1 && h1.whole, '16 simultaneous HTTP writes to a NEW follow-up: all 200, exactly one row, state and note from the same request', `${h1.statuses.join(',')} rows ${h1.n}`)
  const h2 = await roundHttp(O.RECPHONE.id, 'http-existing')
  is(h2.statuses.every((s) => s === 200) && h2.n === 1 && h2.whole, '16 more to the EXISTING row: all 200, still one row, whole value', `rows ${h2.n}`)
  const cliRound = async (orderId, tag, stage = STAGE) => {
    const when = (Date.now() / 1000 + 6).toFixed(3)
    const script = join(tmp, 'fu.php')
    writeFileSync(script, `<?php
require ${phpStr(join(stage, 'api', 'store.php'))}; require ${phpStr(join(stage, 'api', 'abandoned.php'))};
$t = (float)$argv[5]; while (microtime(true) < $t) usleep(300);
$db = store_db();
$in = abandoned_followup_input(['order_id' => (int)$argv[1], 'state' => $argv[2], 'note' => $argv[3]]);
echo json_encode(abandoned_followup_set($db, $in, 'cli' . $argv[4] . '@sporta.test'));
`)
    const outs = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      run('php', [...phpFlags, script, String(orderId), states[i % 4], `${tag}-${i}`, String(i), when], { env: phpEnv }).then((r) => ({ ok: true, out: r.stdout }), (e) => ({ ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.slice(0, 160) }))))
    const row = await rows(`select state, note from abandoned_followup where order_id = ${orderId}`)
    const sent = new Set(Array.from({ length: 16 }, (_, i) => `${states[i % 4]}|${tag}-${i}`))
    return { okAll: outs.every((o) => o.ok && /"followup":\{/.test(o.out)), n: row.length, whole: row.length === 1 && sent.has(`${row[0][0]}|${row[0][1]}`), firstFail: outs.find((o) => !o.ok)?.out }
  }
  await sql('delete from abandoned_followup')
  const c1 = await cliRound(O.RECACCOUNT.id, 'cli-new')
  is(c1.okAll && c1.n === 1 && c1.whole, '16 PHP processes starting on the same millisecond, NEW key: none fails, one row, whole value', c1.firstFail ?? `rows ${c1.n}`)
  const c2 = await cliRound(O.RECACCOUNT.id, 'cli-existing')
  is(c2.okAll && c2.n === 1 && c2.whole, '16 more on the existing key: same', c2.firstFail ?? `rows ${c2.n}`)
  const c3 = await cliRound(O.RECCOD.id, 'cli-new-2')
  is(c3.okAll && c3.n === 1 && c3.whole, 'and again on another new key', c3.firstFail ?? `rows ${c3.n}`)
  await sql('delete from abandoned_followup')
  globalThis.__cliRound = cliRound
}

// =========================================================================== 9
head('9. read-only: orders, stock, discounts, outbox and timeline are never changed')
{
  const TABLES = ['orders', 'order_items', 'product_variants', 'products', 'discounts', 'fulfilment_outbox', 'order_tracking_events', 'inventory_movements']
  const sums = async () => (await rows(`checksum table ${TABLES.join(', ')}`)).map((r) => r.join('=')).join(' ')
  const before = await sums()
  await clearLimits()
  const calls = [{}, { reason: 'unpaid' }, { reason: 'expired' }, { reason: 'declined' }, { reason: 'cod_expired' }, { reason: 'waiting' }, { reason: 'cancelled' },
    { include_recovered: '1' }, { page: '2' }, { q: '5550' }, { q: 'سارة' }, { from: '2026-01-01', to: '2026-12-31' }, Q, { ...Q, include_recovered: '1' }]
  for (const c of calls) await list(c)
  is((await sums()) === before, `${calls.length} reads of every kind: identical checksums of ${TABLES.length} tables`, TABLES.join(', '))
  await clearLimits()
  for (const s of ['contacted', 'wrong_number', 'recovered_manually']) await follow({ order_id: O.NOTREC.id, state: s, note: 'x' })
  await follow({ order_id: O.NOTREC.id, state: 'none' })
  await follow({ order_id: O.PAIDCARD.id, state: 'contacted' })           // refused
  is((await sums()) === before, 'and after follow-up writes (set, replace, remove, refused): the same, to the byte')
}

// ========================================================================== 10
head('10. 20,000 orders: EXPLAIN, constant query count, speed')
const SCALE = { n: 20000 }
{
  await loadSchema('abscale')
  await sql('update product_variants set stock = 100000', 'abscale')
  // 20,000 orders over 40,000 minutes (about 4 weeks) from about 13,400 phones (1.5 orders a phone; the live
  // shop has 1.35): every third order repeats the phone of order seq/3, a different class of order. The mix:
  // 70% paid, 7% declined, 7% pending card, 4% pending cash, 3% cancelled, 3% review, 6% paid cash
  const t0 = Date.now()
  await sql(`insert into orders (track_id, amount, subtotal, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_area, customer_lang, stock_claimed, stock_released, created_at)
    select concat('ABS', seq), 12.5, 11.5,
      case when seq % 100 < 70 then 'paid' when seq % 100 < 77 then 'failed' when seq % 100 < 84 then 'pending' when seq % 100 < 88 then 'pending' when seq % 100 < 91 then 'pending' when seq % 100 < 94 then 'review' else 'paid' end,
      case when seq % 100 < 70 then ELT(1 + seq % 3, 'knet', 'tpay', 'cod') when seq % 100 < 77 then 'knet' when seq % 100 < 84 then ELT(1 + seq % 2, 'knet', 'tpay') when seq % 100 < 91 then 'cod' when seq % 100 < 94 then 'knet' else 'cod' end,
      case when seq % 100 < 70 then 'delivered' when seq % 100 between 88 and 90 then 'cancelled' when seq % 100 between 94 and 99 then 'shipped' else 'unfulfilled' end,
      concat('Scale ', seq), concat('965', 50000000 + if(seq % 3 = 0, seq div 3, seq)), 'Salmiya', 'ar', 1, if(seq % 3 = 0, 1, 0),
      now() - interval ((seq * 2) % 40000) minute
    from seq_1_to_${SCALE.n}`, 'abscale')
  await sql(`insert into order_items (order_id, product_id, qty, unit_price, size) select o.id, p.id, 1 + (o.id % 2), 5, 'L' from orders o join products p on p.id = 1 + (o.id mod 40)`, 'abscale')
  const cnt = await rows('select count(*), (select count(*) from order_items) from orders', 'abscale')
  is(cnt[0][0] === String(SCALE.n) && Number(cnt[0][1]) >= SCALE.n, `${cnt[0][0]} orders and ${cnt[0][1]} order lines seeded`, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
  // realistic neighbours: the cancel events of the cancelled orders, and some follow-ups already made
  await sql(`insert into order_tracking_events (order_id, status, created_at) select id, 'cancelled', created_at + interval 3 hour from orders where fulfilment_status = 'cancelled'`, 'abscale')
  await sql(`insert into abandoned_followup (order_id, state, updated_by) select id, 'contacted', 'seed' from orders where payment_status = 'failed' limit 300`, 'abscale')
  await sql('analyze table orders, order_items, abandoned_followup, order_tracking_events', 'abscale')

  const scaleCfg = join(tmp, 'scale-config.php')
  writeFileSync(scaleCfg, phpExport(baseConfig('abscale')))
  const harness = join(tmp, 'scale.php')
  writeFileSync(harness, `<?php
$stage = getenv('ABAND_STAGE');
require $stage . '/api/store.php'; require $stage . '/api/abandoned.php';
$db = store_db();
$mode = $argv[1] ?? 'plan';
$f = abandoned_filters(['reason' => 'all']);
$variants = [
    'page' => [abandoned_page_query($db, $f)],
    'page_with_recovered' => [abandoned_page_query($db, abandoned_filters(['include_recovered' => '1']))],
    'page_declined' => [abandoned_page_query($db, abandoned_filters(['reason' => 'declined']))],
    'page_cod_expired' => [abandoned_page_query($db, abandoned_filters(['reason' => 'cod_expired']))],
    'page_search' => [abandoned_page_query($db, abandoned_filters(['q' => 'Scale 1999']))],
    'page_dates' => [abandoned_page_query($db, abandoned_filters(['from' => date('Y-m-d', time() - 5 * 86400), 'to' => date('Y-m-d')]))],
    'summary' => [abandoned_summary_query($db, $f)],
    'summary_dates' => [abandoned_summary_query($db, abandoned_filters(['from' => date('Y-m-d', time() - 5 * 86400)]))],
];
$reads = static function () use ($db) {
    $o = 0;
    foreach ($db->query("show session status like 'Handler_read%'")->fetchAll(PDO::FETCH_NUM) as $r) $o += (int)$r[1];
    return $o;
};
if ($mode === 'plan') {
    $out = [];
    foreach ($variants as $name => [[$sql, $args]]) {
        $e = $db->prepare('explain ' . $sql); $e->execute($args);
        $out[$name] = $e->fetchAll(PDO::FETCH_ASSOC);
    }
    echo json_encode($out);
} elseif ($mode === 'time') {
    abandoned_list($db, $f); abandoned_summary($db, $f);            // warm the per-request caches
    $page = []; $sum = [];
    for ($i = 0; $i < 15; $i++) {
        $t = hrtime(true); $l = abandoned_list($db, $f); $page[] = (hrtime(true) - $t) / 1e6;
        $t = hrtime(true); abandoned_summary($db, $f); $sum[] = (hrtime(true) - $t) / 1e6;
    }
    sort($page); sort($sum);
    $work = [];
    foreach (['page' => fn() => abandoned_list($db, $f), 'page_with_recovered' => fn() => abandoned_list($db, abandoned_filters(['include_recovered' => '1'])),
              'page_declined' => fn() => abandoned_list($db, abandoned_filters(['reason' => 'declined'])),
              'page_cod_expired' => fn() => abandoned_list($db, abandoned_filters(['reason' => 'cod_expired'])),
              'page_search' => fn() => abandoned_list($db, abandoned_filters(['q' => 'Scale 1999'])),
              'summary' => fn() => abandoned_summary($db, $f)] as $name => $fn) {
        $a = $reads(); $t = hrtime(true); $fn(); $work[$name] = ['ms' => round((hrtime(true) - $t) / 1e6, 1), 'reads' => $reads() - $a];
    }
    echo json_encode(['page_min' => $page[0], 'page_med' => $page[7], 'sum_min' => $sum[0], 'sum_med' => $sum[7], 'rows' => count($l['orders']), 'more' => $l['has_more'], 'work' => $work]);
} elseif ($mode === 'selects') {
    // Com_select before and after ONE page: constant in the number of rows on it
    $count = static fn() => (int)$db->query("show session status like 'Com_select'")->fetch(PDO::FETCH_NUM)[1];
    abandoned_list($db, $f);                                          // warm
    $track = (string)$db->query("select track_id from orders where payment_status = 'failed' order by id desc limit 1")->fetchColumn();
    $one = abandoned_filters(['reason' => 'all', 'include_recovered' => '1', 'q' => $track]);
    $a = $count(); $r1 = abandoned_list($db, $one); $b = $count();
    $c = $count(); $r20 = abandoned_list($db, $f); $d = $count();
    echo json_encode(['one_row_selects' => $b - $a, 'full_page_selects' => $d - $c, 'rows1' => count($r1['orders']), 'rows20' => count($r20['orders'])]);
}
`)
  globalThis.__scale = (mode, stage = STAGE) => run('php', [...phpFlags, harness, mode], { env: { ...phpEnv, SPORTA_API_CONFIG_FILE: scaleCfg, ABAND_STAGE: stage }, maxBuffer: 16 * 1024 * 1024 })
    .then((r) => r.stdout, (e) => `${e.stdout ?? ''}${e.stderr ?? ''}`)
  const plan = JSON.parse((await globalThis.__scale('plan')).trim().split('\n').pop() || '{}')
  const real = (r) => !/^<(derived|subquery)/.test(r.table ?? '')
  for (const name of Object.keys(plan)) {
    const acc = plan[name].filter(real)
    const scans = acc.filter((r) => r.type === 'ALL' && Number(r.rows) > 5)
    is(acc.length >= 3 && scans.length === 0 && acc.every((r) => r.type === 'ALL' || r.key), `EXPLAIN ${name}: no table is read by a full scan (every access names an index)`, acc.map((r) => `${r.table}:${r.type}:${r.key ?? '-'}:${r.rows}`).join('  '))
  }
  const itemsPlan = await (async () => {
    const e = await rows("explain select oi.order_id, oi.qty from order_items oi left join products p on p.id = oi.product_id where oi.order_id in (1,2,3,4,5) order by oi.order_id, oi.id", 'abscale')
    return e
  })()
  is(itemsPlan.some((r) => r[2] === 'oi') && itemsPlan.filter((r) => r[2] === 'oi').every((r) => r[3] !== 'ALL' && r[6] !== 'NULL'), 'EXPLAIN items: the item lines of the page use idx_items_order (one IN() query, no scan)', itemsPlan.map((r) => `${r[2]}:${r[3]}:${r[6]}`).join(' '))
  const tm = JSON.parse((await globalThis.__scale('time')).trim().split('\n').pop() || '{}')
  info('timing at 20,000 orders (this machine is shared and heavily loaded; wall time is noisy, Handler reads are not)',
    `page min ${tm.page_min?.toFixed(1)} ms median ${tm.page_med?.toFixed(1)}; summary min ${tm.sum_min?.toFixed(1)} median ${tm.sum_med?.toFixed(1)}`)
  info('rows read by the engine per request (Handler_read_*)', Object.entries(tm.work ?? {}).map(([k, v]) => `${k} ${v.reads} (${v.ms} ms)`).join('; '))
  is(tm.rows === 20 && tm.more === true, 'the default page really holds 20 abandoned orders (the timing is of a full page)', `${tm.rows} rows, more ${tm.more}`)
  is(tm.page_min < 50, 'the page (default filters, recovered hidden) takes under 50 ms (best of 15, PDO + PHP, warm)', `${tm.page_min?.toFixed(1)} ms`)
  is(tm.work?.page?.reads < 1500 && tm.work?.page_with_recovered?.reads < 1500, 'and it READS under 1,500 rows of the engine to do it (stops at the page, does not walk the 20,000)', `${tm.work?.page?.reads} / ${tm.work?.page_with_recovered?.reads}`)
  is(tm.work?.page_declined?.reads < 4000 && tm.work?.page_cod_expired?.reads < 8000 && tm.work?.page_search?.reads < 20000, 'a rare reason or a search stays bounded too (declined / cod_expired / search: the search reads only the unpaid and failed orders, not all 20,000)', `${tm.work?.page_declined?.reads} / ${tm.work?.page_cod_expired?.reads} / ${tm.work?.page_search?.reads}`)
  is(tm.work?.summary?.reads < 60000, 'the all-time summary is ONE pass over the unpaid and failed orders only (under 60,000 engine reads for 20,000 orders)', `${tm.work?.summary?.reads} reads; ${tm.sum_min?.toFixed(1)} ms best of 15 on this box, not asserted`)
  const sel = JSON.parse((await globalThis.__scale('selects')).trim().split('\n').pop() || '{}')
  is(sel.rows20 === 20 && sel.rows1 === 1 && sel.one_row_selects === sel.full_page_selects && sel.full_page_selects <= 3, 'no N+1: a page of 20 orders runs exactly as many SELECTs as a page of 1 (the page, plus ONE IN() for the lines)', JSON.stringify(sel))
  // wall-clock over HTTP for the record, on the scale database
  info('the total over HTTP is not asserted: PHP startup, the session and the shared box dominate it')
}

// ========================================================================== 11
head('11. MUTATIONS: each fault must make its probe fail')
const stageN = { n: 0 }
const mutantStage = (edits) => {
  const dir = join(tmp, `mut${++stageN.n}`)
  cpSync(STAGE, dir, { recursive: true })
  for (const [file, from, to] of edits) {
    const p = join(dir, 'api', file)
    const src = readFileSync(p, 'utf8')
    const n = src.split(from).length - 1
    if (n !== 1) throw new Error(`mutation target found ${n} times in ${file}: ${from.slice(0, 70)}`)
    writeFileSync(p, src.replace(from, () => to))
  }
  return dir
}
const mutantServer = async (edits) => {
  const dir = mutantStage(edits)
  const port = await freePort(34500 + stageN.n * 2)
  const up = await startPhp(dir, port)
  return { dir, base: `http://127.0.0.1:${port}`, up }
}
const labels = async (base, params) => ((await list(params, { base })).json?.orders ?? []).map((o) => labelOf(o.track_id))
// re-seed the follow-up the probes rely on
const MUTANTS = [
  { name: 'the per-reason narrowing wrong (declined asks for pending orders)',
    edits: [['abandoned.php', "'declined'    => \"o.payment_status = 'failed' and o.payment_method in ('knet','tpay')\",", "'declined'    => \"o.payment_status = 'pending' and o.payment_method in ('knet','tpay')\","]],
    probe: async (m) => (await labels(m.base, { ...Q, reason: 'declined', include_recovered: '1' })).sort().join() === 'DECLINEDOLD,FAILEDCARD,RECCOD' },
  { name: 'the threshold ignored (every pending card order is "unpaid")',
    edits: [['abandoned.php', "when o.created_at < now() - interval {$thr} minute then 'unpaid'", "when o.created_at < now() - interval 0 minute then 'unpaid'"]],
    probe: async (m) => (await labels(m.base, { ...Q, reason: 'waiting' })).sort().join() === 'PENDFIVE,PENDINSIDE' },
  { name: 'the recovered test dropped (a customer who came back is still "lost")',
    edits: [['abandoned.php', "return '(exists (select 1 from orders rp", "return '0 and (exists (select 1 from orders rp"]],
    probe: async (m) => { const l = await labels(m.base, { ...Q }); return !l.includes('RECPHONE') && !l.includes('RECCOD') } },
  { name: 'the account arm of the recovered test dropped',
    edits: [['abandoned.php', "or (o.customer_account_id is not null and exists", "or (0 and exists"]],
    probe: async (m) => !(await labels(m.base, { ...Q })).includes('RECACCOUNT') },
  { name: 'a later cash order that is only pending counts as a sale',
    edits: [['abandoned.php', "and {$a}.fulfilment_status in ('packed','shipped','delivered'))))", "and {$a}.fulfilment_status in ('unfulfilled','packed','shipped','delivered'))))"]],
    probe: async (m) => (await labels(m.base, { ...Q })).includes('NOTREC') },
  { name: 'an EARLIER paid order recovers (the id comparison reversed)',
    edits: [['abandoned.php', "rp.id > o.id and", "rp.id < o.id and"]],
    probe: async (m) => (await labels(m.base, { ...Q })).includes('SAMEPHONE') },
  { name: 'orders under review are listed',
    edits: [['abandoned.php', "o.payment_status in ('pending','failed')\n     and ((", "o.payment_status in ('pending','failed','review')\n     and (("], ['abandoned.php', "array_merge([\"payment_status in ('pending','failed')\"], $dc)", "array_merge([\"payment_status in ('pending','failed','review')\"], $dc)"], ['abandoned.php', "          when 'failed' then 'declined'\n", "          when 'failed' then 'declined'\n          when 'review' then 'declined'\n"]],
    probe: async (m) => !(await labels(m.base, { ...Q, include_recovered: '1' })).includes('REVIEWCARD') },
  { name: 'a historic cash order marked failed is listed as declined',
    edits: [['abandoned.php', "      when o.payment_method = 'cod' and o.payment_status = 'pending' then", "      when o.payment_method = 'cod' and o.payment_status = 'failed' then 'declined'\n      when o.payment_method = 'cod' and o.payment_status = 'pending' then"], ['abandoned.php', "o.payment_status in ('pending','failed')\n     and ((", "o.payment_status in ('pending','failed')\n     and ((o.payment_method = 'cod' and o.payment_status = 'failed') or ("]],
    probe: async (m) => !(await labels(m.base, { ...Q, include_recovered: '1' })).includes('CODFAILOLD') },
  { name: 'who cancelled it ignored (an owner cancel counts as "expired")',
    edits: [['abandoned.php', "case when {$cancelAt} >= o.created_at + interval {$hold} minute then 'expired' else 'cancelled' end", "case when {$cancelAt} >= o.created_at + interval 0 minute then 'expired' else 'cancelled' end"]],
    probe: async (m) => (await labels(m.base, { ...Q, reason: 'cancelled' })).sort().join() === 'CANCELCARD,CANCELCOD' },
  { name: 'waiting orders leak into "all"',
    edits: [['abandoned.php', "$f['reason'] === 'all' ? ABANDONED_REASONS : [$f['reason']]", "$f['reason'] === 'all' ? array_merge(ABANDONED_REASONS, ['waiting']) : [$f['reason']]"]],
    probe: async (m) => !(await labels(m.base, { ...Q })).includes('PENDINSIDE') },
  { name: 'a manual recovery does not hide the row',
    edits: [['abandoned.php', "' and x.rec_order = 0 and x.rec_manual = 0'", "' and x.rec_order = 0'"]],
    probe: async (m) => { await follow({ order_id: O.MANUAL.id, state: 'recovered_manually' }); const ok2 = !(await labels(m.base, { ...Q })).includes('MANUAL'); await sql('delete from abandoned_followup'); return ok2 } },
  { name: 'a leaked field (the client address added to every row)',
    edits: [['abandoned.php', "'customer_lang' => $r['customer_lang'] ===", "'ip' => (string)($_SERVER['REMOTE_ADDR'] ?? ''), 'customer_lang' => $r['customer_lang'] ==="]],
    probe: async (m) => documented((await list({ ...Q }, { base: m.base })).json).length === 0 },
  { name: 'the CSRF test on the write loses its cross-site check',
    edits: [['abandoned.php', " || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);", ") store_fail('bad_request', 403);"]],
    probe: async (m) => (await follow({ order_id: O.NOTREC.id, state: 'contacted' }, { base: m.base, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403 },
  { name: 'the "more" flag off by one (exactly 20 left looks like more)',
    edits: [['abandoned.php', "$more = count($rows) > ABANDONED_PAGE_SIZE;", "$more = count($rows) >= ABANDONED_PAGE_SIZE;"]],
    probe: async (m) => (await list({ q: 'PAGEFILL', page: '2' }, { base: m.base })).json?.has_more === false },
  { name: 'a phone typed with the 00965 prefix is not understood (the canonical alternative removed)',
    edits: [['abandoned.php', "if ($canon !== null && $canon !== $phone) {", "if (false) {"]],
    probe: async (m) => { const p = O.PENDBEYOND.phone; return ((await list({ q: `00965 ${p.slice(0, 4)} ${p.slice(4)}`, reason: 'all', include_recovered: '1' }, { base: m.base })).json?.orders ?? []).some((o) => labelOf(o.track_id) === 'PENDBEYOND') } },
  { name: 'a malformed UTF-8 search is accepted (the encoding check removed)',
    edits: [['abandoned.php', "preg_match('//u', $q) !== 1 || ", ""]],
    probe: async (m) => { const r = await adm('abandoned_orders', { qs: '&q=%FF%FE', base: m.base }); return r.status === 400 && r.json?.error === 'invalid_filter' } },
  { name: 'the date range excludes its last day',
    edits: [['abandoned.php', "->modify('+1 day')", "->modify('+0 day')"]],
    probe: async (m) => { const today = await sql("select date_format(now(), '%Y-%m-%d')"); return (await labels(m.base, { ...Q, from: today, to: today, reason: 'all', include_recovered: '1' })).includes('PENDBEYOND') } },
  { name: 'the threshold may exceed the sweeper\'s hold (the clamp removed)',
    edits: [['abandoned.php', "$after = max(ABANDONED_AFTER_MIN, min($after, $hold));", "$after = max(ABANDONED_AFTER_MIN, $after);"]],
    probe: async (m) => { setConfig({ abandoned_after_minutes: 999 }); const s = (await list({}, { base: m.base })).json?.settings; setConfig(); return s?.abandoned_after_minutes === 120 } },
  { name: 'an N+1: the lines fetched one order at a time',
    edits: [['abandoned.php', "    $items = abandoned_items($db, array_map(static fn(array $r): int => (int)$r['id'], $rows));", "    $items = []; foreach ($rows as $one) $items += abandoned_items($db, [(int)$one['id']]);"]],
    cli: true,
    probe: async (m) => { const sel = JSON.parse((await globalThis.__scale('selects', m.dir)).trim().split('\n').pop() || '{}'); return sel.rows20 === 20 && sel.one_row_selects === sel.full_page_selects } },
  { name: 'a non-atomic upsert (read, then write)',
    edits: [['abandoned.php', "            $db->prepare('insert into abandoned_followup (order_id, state, note, updated_by) values (?, ?, ?, ?)\n                          on duplicate key update state = values(state), note = values(note),\n                                                  updated_by = values(updated_by), updated_at = current_timestamp')\n               ->execute([$id, $input['state'], $note, mb_substr($adminEmail, 0, 120)]);",
      "            $has = $db->prepare('select 1 from abandoned_followup where order_id = ?'); $has->execute([$id]); usleep(40000);\n            if ($has->fetchColumn() === false) $db->prepare('insert into abandoned_followup (order_id, state, note, updated_by) values (?, ?, ?, ?)')->execute([$id, $input['state'], $note, mb_substr($adminEmail, 0, 120)]);\n            else $db->prepare('update abandoned_followup set state = ?, note = ?, updated_by = ?, updated_at = current_timestamp where order_id = ?')->execute([$input['state'], $note, mb_substr($adminEmail, 0, 120), $id]);"]],
    cli: true,
    probe: async (m) => { await sql('delete from abandoned_followup'); const r = await globalThis.__cliRound(O.RECPHONE.id, 'mut', m.dir); await sql('delete from abandoned_followup'); return r.okAll && r.n === 1 && r.whole } },
]
{
  // PAGEFILL: exactly 40 declined orders for the boundary probe, inserted straight (the real route is rate limited)
  await sql(`insert into orders (track_id, amount, subtotal, payment_status, payment_method, customer_name, customer_phone, customer_area, created_at)
    select concat('ABF${TAG}', seq), 5, 4, 'failed', 'knet', concat('PAGEFILL ', seq), concat('965', 55600000 + seq), 'Hawalli', now() - interval (200 + seq) minute from seq_1_to_40`)
  const p1 = await list({ q: 'PAGEFILL' }), p2 = await list({ q: 'PAGEFILL', page: '2' }), p3 = await list({ q: 'PAGEFILL', page: '3' })
  is(p1.json.orders.length === 20 && p1.json.has_more === true && p2.json.orders.length === 20 && p2.json.has_more === false && p3.json.orders.length === 0 && p3.json.has_more === false, 'pagination at the boundary: 40 orders are 20 + 20, has_more true then false (not true), and page 3 is empty', `${p1.json.orders.length}/${p1.json.has_more} ${p2.json.orders.length}/${p2.json.has_more} ${p3.json.orders.length}/${p3.json.has_more}`)
  const ids1 = p1.json.orders.map((o) => o.id), ids2 = p2.json.orders.map((o) => o.id)
  const sortedDesc = [...p1.json.orders, ...p2.json.orders].every((o, i, a) => i === 0 || a[i - 1].created_at >= o.created_at)
  is(new Set([...ids1, ...ids2]).size === 40 && sortedDesc, 'the pages do not overlap, miss nothing, and run newest first')
  is(p1.json.page === 1 && p2.json.page === 2, 'the page number is echoed')
  const s = (await list({ q: 'PAGEFILL' })).json.summary
  is(s.abandoned.count === 40 && s.by_reason.declined.count === 40, 'and the summary counts all 40, not the 20 on the page')
}
for (const m of MUTANTS) {
  let killed = false, detail = ''
  try {
    const srv = await mutantServer(m.edits)
    if (!srv.up) { detail = 'the mutated server did not start' }
    else {
      await clearLimits()
      const survived = await m.probe(srv)
      killed = survived === false
      detail = killed ? 'the probe failed on the mutant' : 'THE PROBE PASSED ON THE MUTANT: the suite does not guard this'
    }
  } catch (e) { detail = e.message.slice(0, 160) }
  is(killed, `MUTANT killed: ${m.name}`, detail)
}
{
  // and every probe PASSES on the real code (a probe that always fails would "kill" anything)
  const real = { base: SITE, dir: STAGE }
  let allPass = true
  const failing = []
  for (const m of MUTANTS) {
    await clearLimits()
    let pass = false
    try { pass = (await m.probe(real)) === true } catch { pass = false }
    if (!pass) { allPass = false; failing.push(m.name) }
  }
  is(allPass, `all ${MUTANTS.length} probes PASS on the unmutated code (so a kill means something)`, failing.join(' | '))
}

head('12. summary')
{
  const log = existsSync(phpErrLog) ? readFileSync(phpErrLog, 'utf8').split('\n').filter((l) => /abandoned/i.test(l) && /fatal|warning|notice|deprecated/i.test(l)) : []
  is(log.length === 0, 'abandoned.php wrote no PHP warning, notice or deprecation to the error log', log.slice(0, 2).join(' | '))
  console.log(`\n${passes} passed, ${fails} failed`)
  if (KEEP) console.log(`kept: ${tmp}`)
  process.exit(fails ? 1 : 0)
}
