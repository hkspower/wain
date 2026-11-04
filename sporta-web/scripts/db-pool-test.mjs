#!/usr/bin/env node
// DATABASE CONNECTION POOLING — the proof that opt-in persistent connections are SAFE, and that the safety is real.
//
//   npm run test:db-pool                 the whole suite, then the mutation checks
//   node scripts/db-pool-test.mjs --no-mutants      skip the mutants (faster)
//   node scripts/db-pool-test.mjs --no-apache       skip the Apache prefork section
//   node scripts/db-pool-test.mjs --only leak,cap   run named sections only
//
// WHAT IS UNDER TEST: dropin/php-store/db-pool.php, reached the way production reaches it: through store_db(),
// knet_pdo(), cbk_pdo() and sporta_seo_db() of the PATCHED backend (ops/db/db-pooling.patch). If the repository's
// own tree is not patched yet, the suite patches a scratch COPY and says so; once the patch is applied it uses the
// tree as it is. Either way it also proves that the patch applies to a pristine copy of HEAD.
//
// THE PRIVATE STACK (scripts/lib/pool-rig.mjs): its own MariaDB (restartable), a staged copy of the backend, and
// either `php -S` (one process per worker, which is what a persistent connection belongs to) or a real Apache
// 2.4 with mpm_prefork + mod_php, the runtime of the live image. It never touches the shared test rig, the
// database `sporta`, ports 8095-8100, 8188, 4173, dist/ or a config.php of the repository.
//
// WHAT "NO LEAK" MEANS HERE. Request A leaves something behind on purpose and ends. Request B is served by the SAME
// PHP process (one worker, or MaxRequestWorkers 1) and reports its session. B must look like a brand-new connection:
// no lock, no open transaction, default sql_mode, time zone, character set, no user variable, no temporary table,
// no changed isolation level or limits. Where the pool can repair the state it must keep the connection (same
// connection id: the pool is doing its job); where it cannot it must replace it.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXTURES, WEB, DROPIN, have, sleep, startPoolRig } from './lib/pool-rig.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const NO_MUTANTS = argv.includes('--no-mutants')
const NO_APACHE = argv.includes('--no-apache')
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? new Set(argv[i + 1].split(',')) : null })()
const want = (s) => !ONLY || ONLY.has(s)
const MUT_FILTER = (() => { const i = argv.indexOf('--mutant'); return i >= 0 ? argv[i + 1] : null })()

let fails = 0, passes = 0
let capture = null // while a mutant runs, failures are collected instead of counted
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) }
const bad = (n, d = '') => { if (capture) { capture.push(n); return } fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => { if (c) { if (!capture) ok(n, d) } else bad(n, d); return !!c }
const info = (n, d = '') => { if (!capture) console.log(`info ${n}${d ? `  - ${d}` : ''}`) }
const head = (t) => { if (!capture) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`) }

// ------------------------------------------------------------------ the tree under test
const tmpRoot = mkdtempSync(join(tmpdir(), 'sporta-dbpool-'))
process.on('exit', () => { try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ } })
const PATCH = join(WEB, 'ops', 'db', 'db-pooling.patch')
const read = (p) => readFileSync(p, 'utf8')

let TREE = DROPIN
let patchedHere = false
{
  head('the tree under test')
  const storeSrc = read(join(DROPIN, 'php-store', 'store.php'))
  const poolFile = join(DROPIN, 'php-store', 'db-pool.php')
  is(existsSync(poolFile), 'dropin/php-store/db-pool.php exists')
  is(spawnSync('php', ['-l', poolFile]).status === 0, 'db-pool.php has no syntax error')
  is(existsSync(PATCH), 'ops/db/db-pooling.patch exists (the change to the existing files)')
  const applied = storeSrc.includes('sporta_db_connect(')
  if (!applied) {
    // 1. against the files as they are in the working tree
    TREE = join(tmpRoot, 'tree', 'dropin')
    mkdirSync(join(tmpRoot, 'tree'), { recursive: true })
    cpSync(DROPIN, TREE, { recursive: true })
    const r = spawnSync('patch', ['-p1', '-d', join(tmpRoot, 'tree'), '-i', PATCH], { encoding: 'utf8' })
    is(r.status === 0, 'ops/db/db-pooling.patch applies to the working tree', (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | '))
    patchedHere = r.status === 0
    info('the repository tree is not patched yet', 'the suite tests a patched COPY of dropin/')
  } else {
    info('the repository tree already carries the patch', 'testing it as it is')
  }
  // 2. against a pristine copy of HEAD (what the orchestrator applies), only while HEAD is unpatched
  if (!applied && have('git')) {
    const pristine = join(tmpRoot, 'pristine')
    mkdirSync(pristine, { recursive: true })
    const tar = spawnSync('sh', ['-c', `git -C "${WEB}" archive HEAD dropin | tar -x -C "${pristine}"`], { encoding: 'utf8' })
    if (tar.status === 0 && existsSync(join(pristine, 'dropin'))) {
      const r = spawnSync('patch', ['-p1', '--dry-run', '-d', pristine, '-i', PATCH], { encoding: 'utf8' })
      is(r.status === 0, 'the patch applies to a pristine copy of HEAD', (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | '))
    } else info('git archive unavailable', 'the pristine-HEAD check is skipped')
  }
  // 3. the five connection sites go through the one helper, and nothing else is left
  const sites = {
    'php-store/store.php': /sporta_db_connect\(\s*sporta_db_role_for_script\(\)/,
    'php-store/seo-runtime.php': /sporta_db_connect\('store'/,
    'php-store/assistant.php': /sporta_db_connect\('cron'/,
    'php-knet/knet.php': /sporta_db_connect\('knet'/,
    'php-cbk/cbk.php': /sporta_db_connect\('cbk'/,
  }
  for (const [f, re] of Object.entries(sites)) {
    const src = read(join(TREE, f))
    is(re.test(src), `${f} opens its connection through sporta_db_connect()`)
    const direct = (src.match(/new PDO\(/g) || []).length
    is(direct <= 1, `${f}: at most the one documented plain-PDO fallback remains`, `${direct} "new PDO(" left`)
  }
  is(/db-pool\\\.php/.test(read(join(TREE, 'php-store', '.htaccess'))), 'api/.htaccess denies db-pool.php by name (it is an include, never an endpoint)')
  const storeNew = read(join(TREE, 'php-store', 'store.php'))
  is(/require_once __DIR__ \. '\/db-pool\.php'/.test(storeNew), 'store.php loads db-pool.php')

  // 4. the facts the design rests on: the application never changes the SESSION
  head('what the application does to a session (why the guard\'s allow-list is short)')
  const phpFiles = []
  for (const d of ['php-store', 'php-knet', 'php-cbk']) {
    for (const f of spawnSync('sh', ['-c', `ls "${join(DROPIN, d)}"/*.php`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) phpFiles.push(f)
  }
  const live = (f) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join('\n')
  const appFiles = phpFiles.filter((f) => !/db-pool\.php$/.test(f))
  const sessionWords = [
    ['a user variable assignment (@x :=)', /@[a-z_]\w*\s*:=/i],
    ['CREATE TEMPORARY TABLE', /create\s+temporary\s+table/i],
    ['LOCK TABLES', /lock\s+tables/i],
    ['a server-side PREPARE ... FROM', /prepare\s+\w+\s+from/i],
    ['USE <database>', /['"`]\s*use\s+\w+\s*['"`]/i],
  ]
  for (const [label, re] of sessionWords) {
    const hits = appFiles.filter((f) => re.test(live(f)))
    is(hits.length === 0, `no application PHP issues ${label}`, hits.map((h) => h.split('/').slice(-2).join('/')).join(', '))
  }
  // The one session change the application DOES make: both gateway callbacks cap the row-lock wait. On a plain
  // connection it dies with the request; on a naive persistent one it would ride along into every later request
  // on that child. The guard sees it and discards the connection when the request ends.
  const setRe = /['"`\s]set\s+(?:session|global|@|names|autocommit|time_zone|sql_mode|transaction|innodb_\w+|max_statement_time|character)[^'"`;]*/gi
  const setHits = appFiles.flatMap((f) => [...live(f).matchAll(setRe)].map((m) => `${f.split('/').slice(-2).join('/')}: ${m[0].trim().replace(/^['"`]/, '').replace(/\s+/g, ' ').slice(0, 50)}`))
  is(setHits.length === 2 && setHits.every((h) => /callback\.php: set session innodb_lock_wait_timeout/.test(h)),
     'the ONLY SET the application issues is the callbacks\' innodb_lock_wait_timeout cap (the guard discards that connection when the request ends)', setHits.join(' | '))
  const withLocks = appFiles.filter((f) => /get_lock\s*\(/i.test(read(f))).map((f) => f.split('/').pop()).sort()
  info('GET_LOCK is used by', withLocks.join(', '))
}

// ------------------------------------------------------------------ the unit checks (no database)
if (want('unit')) {
  head('retry rules, error classification, roles and the CLI gate (php CLI, no database)')
  const runUnit = (poolFile) => spawnSync('php', ['-d', 'error_log=/dev/null', '-d', 'display_errors=0', join(FIXTURES, 'pool-unit.php'), poolFile], { encoding: 'utf8' })
  const r = runUnit(join(TREE, 'php-store', 'db-pool.php'))
  const rows = r.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { n: `unparsable unit output: ${l.slice(0, 80)}`, ok: false } } })
  is(rows.length >= 35 && r.status === 0, 'the unit script ran to the end', `${rows.length} checks, exit ${r.status} ${(r.stderr || '').slice(0, 120)}`)
  for (const x of rows) is(x.ok, x.n, x.d)
}

// ------------------------------------------------------------------ the private stack
const probeFile = join(FIXTURES, 'pool-probe.php')
const rig = await startPoolRig({
  tree: TREE, label: 'dbpool', server: 'cli-server', workers: 1, maxWorkers: 150,
  extraFiles: { 'api/pool-probe.php': probeFile, 'knet/pool-probe.php': probeFile, 'pay/pool-probe.php': probeFile },
  config: { db_persistent: false }, dbMaxConnections: 300,
})
if (rig.skip) { console.log(`SKIP db-pool: ${rig.skip}. The unit checks above ran; nothing against a database was tested.`); process.exit(fails ? 1 : 0) }
await rig.sql('create table if not exists pool_marker (id int auto_increment primary key, tag varchar(40), at timestamp default current_timestamp)')
const dbv = await rig.vars()
head('the private stack')
is(true, `own MariaDB ${dbv.version} on :${rig.DB_PORT}, ${rig.kind} on ${rig.SITE.replace('http://', '')}, a staged copy of the backend`)

let ipSeq = 0
const ip = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}` }
const J = async (u, init = {}) => {
  let res
  try { res = await fetch(`${rig.SITE}${u}`, { ...init, headers: { 'X-Forwarded-For': ip(), ...(init.headers ?? {}) } }) } catch (e) { return { status: 0, j: null, t: String(e) } }
  const t = await res.text()
  let j = null
  try { j = JSON.parse(t) } catch { /* not json */ }
  return { status: res.status, j, t }
}
const probe = (dir, qs = '') => J(`/${dir}/pool-probe.php?${qs}`)
const info_ = (dir = 'api', extra = '') => probe(dir, `act=info${extra}`)
const dirty = (what, extra = '') => probe('api', `act=dirty&what=${what}${extra}`)
const setPool = (over) => rig.writeApi({ db_persistent: true, ...over })
const setPlain = () => rig.writeApi({ db_persistent: false })
const idleOf = (user) => rig.num(`select count(*) from information_schema.processlist where user = '${user}' and command = 'Sleep'`)
const settle = async (user, n, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await idleOf(user)) <= n) return; await sleep(100) } }
const SLOT_NAMES = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
const slotsHeld = async (prefix, n) => {
  let held = 0
  for (const nm of SLOT_NAMES(prefix, n)) if ((await rig.one(`select is_used_lock('${nm}') is not null`)) === '1') held++
  return held
}

// the state a brand-new connection has, read from the server itself with pooling off
setPlain()
const FRESH = (await info_()).j
const FRESH_KEYS = ['db', 'sql_mode', 'tz', 'cs', 'coll', 'mst', 'ac', 'tx', 'lwt', 'leak', 'lock_held', 'limit_changed', 'iso', 'temp', 'marker_rows', 'pdo_in_txn']
const sameAsFresh = (b) => FRESH_KEYS.every((k) => b[k] === FRESH[k])
const diffFromFresh = (b) => FRESH_KEYS.filter((k) => b[k] !== FRESH[k]).map((k) => `${k}=${JSON.stringify(b[k])} (fresh ${JSON.stringify(FRESH[k])})`).join('; ')

// ------------------------------------------------------------------ 1. nothing changes while it is off
async function sectionPlain() {
  head('1. pooling OFF: today\'s behaviour, unchanged')
  for (const [label, cfg] of [['db_persistent absent from the config', {}], ['db_persistent => false', { db_persistent: false }]]) {
    rig.writeApi(cfg)
    const a = await info_(), b = await info_()
    is(a.j?.class === 'PDO' && b.j?.class === 'PDO', `${label}: the store gets a plain PDO, not the pooled subclass`, a.j?.class)
    is(a.j?.cid !== b.j?.cid, `${label}: every request has a connection of its own`, `${a.j?.cid} then ${b.j?.cid}`)
    for (const dir of ['knet', 'pay']) {
      const g = await info_(dir)
      is(g.j?.class === 'PDO', `${label}: ${dir} gets a plain PDO`, g.j?.class)
    }
    const s = await info_('api', '&via=seo')
    is(s.j?.class === 'PDO', `${label}: the SEO pages get a plain PDO`, s.j?.class)
  }
  rig.writeApi({ db_persistent: false })
  const direct = await J('/api/db-pool.php')
  is(direct.status === 404 && direct.t === '', 'asked for by URL, db-pool.php answers 404 and nothing else (an include, not an endpoint)', `${direct.status} ${direct.t.length} bytes`)
  // the same answers, byte for byte, off and on
  const routes = ['products', 'stock', 'slides', 'checkout_config', 'brands']
  const off = {}
  for (const r of routes) off[r] = (await J(`/api/api.php?r=${r}`)).t
  setPool({})
  const on = {}
  for (const r of routes) on[r] = (await J(`/api/api.php?r=${r}`)).t
  for (const r of routes) is(off[r].length >= 2 && off[r] === on[r], `?r=${r} answers the same bytes with pooling on and off`, `${off[r].length} bytes`)
  const slug = await rig.one('select slug from products where active = 1 order by slug limit 1')
  setPlain(); const p0 = await J(`/product/${slug}`)
  setPool({}); const p1 = await J(`/product/${slug}`)
  const strip = (t) => t.replace(/<meta[^>]*generated[^>]*>/gi, '')
  is(p0.status === 200 && strip(p0.t) === strip(p1.t), 'the server-rendered product page (SEO) is identical with pooling on and off', `${p0.t.length} bytes`)
  setPlain()
}

// ------------------------------------------------------------------ 2. the leak tests
const SCEN = [
  // [label, what, extra, expectSameConnection]  (true: repairable, the pool must KEEP the connection; false: not repairable, must REPLACE it; null: either)
  ['an open GET_LOCK', 'lock', '', true],
  ['an open transaction (exit() in the middle of one)', 'txn', '', true],
  ['a raw START TRANSACTION', 'rawtxn', '', true],
  ['an aborted statement (duplicate key) inside a transaction', 'abort', '', true],
  ['a statement aborted by max_statement_time', 'timeout', '', false],
  ['a changed sql_mode', 'sqlmode', '', false],
  ['a user variable (SET @leak = 42)', 'uservar', '', false],
  ['a user variable (SELECT @leak := 43)', 'uservar_sel', '', false],
  ['a temporary table', 'temp', '', false],
  ['a changed time zone', 'tz', '', false],
  ['SET NAMES latin1', 'names', '', false],
  ['USE another database', 'usedb', '', false],
  ['a server-side PREPARE', 'prepare', '', false],
  ['a changed isolation level', 'isolation', '', false],
  ['a changed sql_select_limit', 'limit', '', false],
  ['a changed innodb_lock_wait_timeout', 'lockwait', '', false],
  ['autocommit switched off', 'autocommit', '', false],
  ['a changed max_statement_time', 'mst', '', false],
  ['a result set read only in part', 'pending', '', null],
  ['everything at once', 'lock,txn,sqlmode,uservar,temp,tz,names,limit,abort', '', false],
]

async function leakScenario([label, what, extra, sameConn], { tag = '', abandon = false, raw = false } = {}) {
  const q = `${raw ? '&raw=1' : ''}${abandon ? '&abandon=1' : ''}${extra}`
  const name = `${tag}${label}`
  const a = await dirty(what, q)
  if (!is(a.status === 200 && a.j && a.j.done, `${name}: request A ran`, a.t.slice(0, 120))) return
  // the end of A, seen from outside, BEFORE any other request: nothing of A's may still hold anything
  if (!abandon) {
    if (what.split(',').includes('lock')) {
      is(await rig.num("select is_free_lock('leak-lock')") === 1, `${name}: the lock is free the moment A ends (a second session can take it)`)
    }
    if (/txn|abort/.test(what)) {
      const trx = await rig.num(`select count(*) from information_schema.innodb_trx where trx_mysql_thread_id = ${a.j.conn}`)
      is(trx === 0, `${name}: A's transaction is rolled back the moment A ends, not when the next request arrives`, `${trx} open`)
    }
  }
  const b = await info_()
  if (!is(b.status === 200 && b.j && b.j.cid, `${name}: request B ran`, b.t.slice(0, 120))) return
  is(b.j.pid === a.j.pid, `${name}: B was served by the same PHP process as A`, `${a.j.pid}`)
  is(sameAsFresh(b.j), `${name}: B sees a brand-new session`, diffFromFresh(b.j))
  if (sameConn === true) is(b.j.cid === a.j.conn, `${name}: the connection was KEPT (the pool repaired it)`, `${a.j.conn} -> ${b.j.cid}`)
  if (sameConn === false) is(b.j.cid !== a.j.conn, `${name}: the connection was REPLACED (the pool does not guess)`, `${a.j.conn} -> ${b.j.cid}`)
}

async function sectionNaked() {
  head('2-. the reason the pool exists: a bare PDO::ATTR_PERSISTENT connection, no pool (measured)')
  setPlain()
  const a = await probe('api', 'act=naked&phase=a')
  const b = await probe('api', 'act=naked&phase=b')
  if (!is(a.j?.cid && b.j?.cid === a.j.cid, 'the next request is handed the SAME connection (that is what persistent means)', `${a.j?.cid} -> ${b.j?.cid}`)) return
  info('a bare persistent connection, request B sees', `open transaction: ${b.j.tx ? 'YES' : 'no (PHP rolls it back when the object is destroyed)'}; user variable: ${b.j.uservar == null ? 'no' : 'YES'}; GET_LOCK still held: ${b.j.lock_held ? 'YES' : 'no'}; sql_mode ANSI: ${/ANSI/.test(b.j.sql_mode) ? 'YES' : 'no'}; temporary table: ${b.j.temp ? 'YES' : 'no'}`)
  is(Boolean(b.j.lock_held) && b.j.uservar != null && /ANSI/.test(b.j.sql_mode) && b.j.temp === 1, 'a bare persistent connection LEAKS the lock, the user variable, the sql_mode and the temporary table to the next request', 'the pool exists to stop exactly this')
  await rig.sql(`kill ${b.j.cid}`).catch(() => {})
  await rig.sql("delete from pool_marker where tag = 'naked'")
}

async function sectionLeak() {
  head('2. pooling ON, one PHP process: what request A leaves, request B must not see')
  setPool({})
  const warm = await info_()
  is(warm.j?.class === 'SportaPooledPDO' && warm.j.pool?.slot > 0, 'pooling is really on: the store gets the pooled connection and holds a slot', JSON.stringify(warm.j?.pool))
  const again = await info_()
  is(again.j?.cid === warm.j?.cid && again.j.pool.reused === true, 'a second request reuses the connection (the point of pooling)', `${warm.j?.cid} -> ${again.j?.cid}`)
  is(sameAsFresh(again.j), 'and a reused connection looks exactly like a new one', diffFromFresh(again.j))
  for (const s of SCEN) await leakScenario(s)

  head('2b. the same, when the end-of-request cleanup did NOT run (the next request must clean up by itself)')
  for (const s of SCEN.filter((x) => x[3] === true)) await leakScenario(s, { tag: '[cleanup skipped] ', abandon: true })

  head('2c. state set around the statement guard (raw PDO::exec): what the reset itself can undo')
  for (const [label, what, sameConn] of [['a changed sql_mode', 'sqlmode', true], ['a changed time zone', 'tz', true], ['autocommit off', 'autocommit', true], ['a changed max_statement_time', 'mst', true]]) {
    await leakScenario([label, what, '', sameConn], { tag: '[guard bypassed] ', raw: true, abandon: true })
  }
  // a user variable set around the guard cannot be seen by anything: say so, do not pretend
  await dirty('uservar', '&raw=1&abandon=1')
  const lk = await info_()
  info('[guard bypassed] a user variable set around the guard', lk.j?.leak == null ? 'did not survive' : `SURVIVES (@leak = ${lk.j.leak}); the guard is the only detector for user variables, nothing else in the application sets any`)
  // clean the connection we just dirtied on purpose
  await rig.sql(`kill ${lk.j.cid}`).catch(() => {})
  await sleep(200)

  head('2d. a lock held by a request that exits mid-way, seen from another session')
  const e = await probe('api', 'act=lock_exit')
  is(e.status === 200, 'request A took a GET_LOCK and exited without releasing it')
  is(await rig.num("select is_free_lock('probe-lock')") === 1, 'a second session can take that lock at once (it did not survive A)')
  const f = await info_()
  is(sameAsFresh(f.j), 'and the next request is clean')
}

// ------------------------------------------------------------------ 2e. the baseline is the connection's own
// Review finding: the reset used to put sql_mode / time_zone / max_statement_time / autocommit back to the server's
// GLOBAL values. An account that carries its own limit (ALTER USER ... WITH MAX_STATEMENT_TIME, the way
// ops/db/DB-CONNECT.md recommends) gives every NEW connection a session value that is not the GLOBAL one, so every
// reused connection silently lost the limit.
async function sectionBaseline() {
  head('2e. an account with its own MAX_STATEMENT_TIME keeps it on a reused connection (the baseline is the connection\'s own)')
  await rig.sql("alter user 'pool_app'@'127.0.0.1' with max_statement_time 2", '')
  try {
    setPlain(); await rig.serverRestart()
    const fresh = await info_()
    is(Number(fresh.j?.mst) === 2, 'pooling off: a new connection runs with the account limit (2 s) although the GLOBAL value is 0', `${fresh.j?.mst}`)
    const slowPlain = await probe('api', 'act=sleep&ms=3500')
    is(slowPlain.status === 500, 'pooling off: a 3.5 s statement is aborted by the account limit', `${slowPlain.status}`)
    setPool({}); await rig.serverRestart()
    const a = await info_(), b = await info_(), c = await info_()
    is(c.j?.pool?.reused === true && b.j?.pool?.reused === true, 'pooling on: the next requests reuse the connection', `${a.j?.cid} ${b.j?.cid} ${c.j?.cid}`)
    is(Number(a.j?.mst) === 2 && Number(b.j?.mst) === 2 && Number(c.j?.mst) === 2, 'and the account limit is still 2 s on the reused connection (it was 0 before the baseline was the connection\'s own)', `${a.j?.mst} ${b.j?.mst} ${c.j?.mst}`)
    const slow = await probe('api', 'act=sleep&ms=3500')
    is(slow.status === 500, 'pooling on: a 3.5 s statement on the reused connection is aborted by the account limit too', `${slow.status}`)
    // the limit is part of the baseline, so changing it for one request is still repaired, to 2 and not to the GLOBAL 0
    const m = await dirty('mst', '&raw=1&abandon=1')
    const after = await info_()
    is(m.status === 200 && Number(after.j?.mst) === 2 && after.j?.pool?.reused === true, 'a max_statement_time changed around the guard is put back to the account\'s 2 s, on the same connection', `${after.j?.mst}`)
  } finally {
    await rig.sql("alter user 'pool_app'@'127.0.0.1' with max_statement_time 0", '')
    setPlain(); await rig.serverRestart()
  }
  setPool({}); await rig.serverRestart()
  await info_()
  await leakScenario(['a handle set up by an older version of the pool', 'oldgen', '', false], { tag: '[generation] ', raw: true })
  setPlain()
}

// ------------------------------------------------------------------ 3. connection counts and identity
async function sectionCount() {
  head('3. connection counts: N sequential requests')
  const N = 30
  for (const mode of ['off', 'on']) {
    mode === 'on' ? setPool({}) : setPlain()
    await rig.serverRestart()   // a fresh PHP process: no handle from an earlier section
    await settle('pool_app', 0, 6000)
    const before = await rig.counters()
    const cids = new Set()
    for (let i = 0; i < N; i++) cids.add((await info_()).j?.cid)
    const after = await rig.counters()
    const app = after.Connections - before.Connections - 1 // the second snapshot's own connection
    // (the server-up check that follows a restart has already opened the pooled connection, so "on" opens 0 or 1)
    is(mode === 'on' ? app <= 1 && cids.size === 1 : app === N, `pooling ${mode}: ${N} sequential requests opened ${mode === 'on' ? 'at most one connection and used one' : `${N} connections`}`, `${app} opened, ${cids.size} distinct connection id(s)`)
  }

  head('3b. one handle per ROLE, never shared')
  setPool({})
  await rig.serverRestart()
  const store = await info_('api'), knet = await info_('knet'), pay = await info_('pay')
  is(new Set([store.j?.cid, knet.j?.cid, pay.j?.cid]).size === 3, 'store, KNET and T-Pay each get their own connection', `${store.j?.cid}, ${knet.j?.cid}, ${pay.j?.cid}`)
  is(store.j?.usr.startsWith('pool_app@') && knet.j?.usr.startsWith('pool_knet@') && pay.j?.usr.startsWith('pool_pay@'), 'and each as its own database account (the least-privilege split)', `${store.j?.usr} ${knet.j?.usr} ${pay.j?.usr}`)
  const k2 = await info_('knet'), s2 = await info_('api')
  is(k2.j?.cid === knet.j?.cid && s2.j?.cid === store.j?.cid, 'and each is reused by its own role')
  // two roles on ONE account (the single-account setup): still two handles
  rig.writeKnet({ mysql_user: 'pool_app', mysql_pass: rig.PW.app })
  await rig.serverRestart()
  const s3 = await info_('api'), k3 = await info_('knet')
  is(s3.j?.usr === k3.j?.usr && s3.j?.cid !== k3.j?.cid, 'two roles on the same account do not share a handle (the role is part of the persistent identity)', `${s3.j?.cid} vs ${k3.j?.cid}`)
  const s4 = await info_('api'), k4 = await info_('knet')
  is(s4.j?.cid === s3.j?.cid && k4.j?.cid === k3.j?.cid, 'and each keeps its own across requests')
  rig.writeKnet({})
  const sFromSeo = await info_('api', '&via=seo')
  is(sFromSeo.j?.cid === s3.j?.cid, 'the SEO pages ride the store handle (same role, same account)', `${sFromSeo.j?.cid} vs ${s3.j?.cid}`)

  setPool({})
  const tw = await probe('api', 'act=twice')
  is(tw.j?.same === true && tw.j?.held === 1, 'the store and the SEO pages in ONE request share one wrapper, so the second does not release the first one\'s lock', JSON.stringify(tw.j))
  setPlain()

  head('3c. config parsing (asked of the real function through the server)')
  setPlain()
  const S = async (role, cfg) => (await probe('api', `act=settings&role=${role}&cfg=${encodeURIComponent(JSON.stringify(cfg))}`)).j
  const x = await S('store', {})
  is(x?.settings === null && x?.sapi === 'cli-server', 'no key: not pooled', JSON.stringify(x?.settings))
  is((await S('store', { db_persistent: false })).settings === null, 'db_persistent false: not pooled')
  is((await S('store', { db_persistent: 'yes' })).settings === null, 'a string that is not "all": not pooled (no loose truthiness)')
  is((await S('store', { db_persistent: 1 })).settings === null, 'the integer 1: not pooled (only the boolean true or "all" turns it on)')
  const t = await S('store', { db_persistent: true })
  is(t.settings?.slots === 20, 'true: store gets the default 20 slots', JSON.stringify(t.settings))
  is((await S('knet', { db_persistent: true })).settings?.slots === 4 && (await S('cbk', { db_persistent: true })).settings?.slots === 4, 'true: KNET and T-Pay default to 4 slots each (the account cap is 15)')
  is((await S('admin', { db_persistent: true })).settings?.slots === 4, 'true: admin defaults to 4')
  is((await S('cron', { db_persistent: true })).settings === null, 'true never pools the cron role')
  is((await S('cron', { db_persistent: 'all' })).settings?.slots === 2, '"all" does, with 2 slots')
  is((await S('knet', { db_persistent: ['store'] })).settings === null && (await S('store', { db_persistent: ['store'] })).settings !== null, 'a list pools exactly the roles named')
  is((await S('store', { db_persistent: true, db_persistent_slots: 7 })).settings?.slots === 7, 'an integer db_persistent_slots applies to every role')
  is((await S('knet', { db_persistent: true, db_persistent_slots: { knet: 9, store: 3 } })).settings?.slots === 9, 'a per-role map applies to its role')
  is((await S('cbk', { db_persistent: true, db_persistent_slots: { knet: 9 } })).settings?.slots === 4, 'a role missing from the map keeps its default')
  is((await S('store', { db_persistent: true, db_persistent_slots: 0 })).settings?.slots === 1, 'slots 0 is clamped to 1')
  is((await S('store', { db_persistent: true, db_persistent_slots: 100000 })).settings?.slots === 128, 'slots 100000 is clamped to 128')
  is((await S('store', { db_persistent: true, db_persistent_slots: 'many' })).settings?.slots === 20, 'a non-integer slot count falls back to the default')
  is((await S('nobody', { db_persistent: true })).settings === null, 'an unknown role is never pooled')
  // the gateways read the STORE's config when their own does not say
  setPool({ db_persistent_slots: 5 })
  const g = await info_('knet')
  is(g.j?.class === 'SportaPooledPDO' && g.j.pool.slots === 5, 'KNET (whose own config says nothing) follows the store config: pooled, 5 slots', JSON.stringify(g.j?.pool))
  rig.writeKnet({ db_persistent: false })
  const g2 = await info_('knet')
  is(g2.j?.class === 'PDO', 'a gateway config that says db_persistent => false wins over the store config')
  rig.writeKnet({})
  setPlain()
}

// ------------------------------------------------------------------ 4. the hard cap
// Requests started a few tens of milliseconds apart, each holding its connection for `ms`. A burst sent in the same
// tick is not concurrent on `php -S`: the first worker to wake accepts every waiting connection and serves them one
// after another, so the staggering is what makes the workers overlap. (Apache prefork does not need it.)
async function burst(n, ms, stagger = 40) {
  return Promise.all(Array.from({ length: n }, (_, i) => sleep(i * stagger).then(() => probe('api', `act=sleep&ms=${ms}`))))
}
async function sectionCap(label = '') {
  head(`4. the hard cap${label}`)
  for (const [slots, expect] of [[3, (n) => n <= 3 && n >= 1], [30, (n) => n >= 5]]) {
    setPool({ db_persistent_slots: slots })
    await rig.serverRestart({ workers: 8 })
    await settle('pool_app', 0, 6000)
    const aborted0 = (await rig.counters()).Aborted_clients
    const res = await burst(24, 400)
    is(res.every((r) => r.status === 200), `${slots} slots, 24 concurrent requests on 8 workers: every request is served`, res.filter((r) => r.status !== 200).map((r) => r.status).join(','))
    await sleep(500)
    // a connection the pool discards is closed with KILL, which the server counts as an aborted client: say so
    info(`${slots} slots: Aborted_clients rose by`, `${(await rig.counters()).Aborted_clients - aborted0} (one per discarded connection; an alert on Aborted_clients sees pooling's disposals)`)
    const idle = await idleOf('pool_app')
    const prefix = res.find((r) => r.j?.pool?.prefix)?.j.pool.prefix
    const held = prefix ? await slotsHeld(prefix, slots) : -1
    if (slots === 3) {
      is(expect(idle), `${slots} slots: ${idle} connection(s) are left open after the burst (never more than ${slots}, however many workers ran)`, `${idle} idle`)
      is(held === idle, `${slots} slots: the slot locks and the idle connections are the same set`, `${held} locks, ${idle} idle`)
      is(res.some((r) => r.j?.pool?.slot === 0), `${slots} slots: requests that found every slot taken still ran (on a connection that is closed when they end)`,
         `slots seen ${res.map((r) => r.j?.pool?.slot).join(',')}; ${new Set(res.map((r) => r.j?.pid)).size} PHP processes of ${rig.serverPids().length} workers`)
    } else {
      is(expect(idle), `${slots} slots: with room, the workers keep their connections (${idle} idle)`, `${idle} idle`)
    }
  }
  setPlain()
}

// Review finding: db_persistent_slots is read on every request, but a connection that already held a slot kept it
// whatever the new number was, so lowering the cap (the first thing an operator does under connection pressure)
// changed nothing for connections that were already open.
async function sectionLower() {
  head('4b. lowering the cap at runtime reaches the connections that are already open')
  setPool({ db_persistent_slots: 6 })
  await rig.serverRestart({ workers: 8 })
  await settle('pool_app', 0, 6000)
  const spread = async (rounds) => {
    let last = null
    for (let r = 0; r < rounds; r++) last = await Promise.all(Array.from({ length: 16 }, (_, i) => sleep(i * 30).then(() => info_())))
    return last
  }
  await spread(3); await sleep(600)
  const before = await idleOf('pool_app')
  is(before >= 3 && before <= 6, `6 slots: ${before} pooled connections are open`, `${before}`)
  setPool({ db_persistent_slots: 2 })
  const last = await spread(8); await sleep(900)
  const after = await idleOf('pool_app')
  is(after <= 2, `slots lowered to 2: ${after} pooled connection(s) are open once every worker has served a request (never more than 2)`, `${before} -> ${after}`)
  const prefix = last.find((r) => r.j?.pool?.prefix)?.j.pool.prefix
  const held = prefix ? await slotsHeld(prefix, 6) : -1
  is(held === after, 'and the slot locks are the same set as the open connections (nothing above slot 2 is still held)', `${held} locks, ${after} open`)
  is(last.every((r) => r.status === 200), 'every request in the meantime was served')
  setPlain()
}

// ------------------------------------------------------------------ 5. the database goes away
async function sectionRestart() {
  head('5. the database restarts, is killed, or is down')
  setPool({})
  await rig.serverRestart({ workers: 1 })
  const a = await info_()
  const noiseBefore = rig.phpErrors().length
  is(a.j?.class === 'SportaPooledPDO', 'a pooled connection is open')

  await rig.dbRestart()
  const b = await info_()
  is(b.status === 200 && b.j?.cid, 'graceful MariaDB restart between two requests: the next request is served', `status ${b.status}`)
  // (connection ids restart from 1 when the server does, so "new" is read from the pool, not from the id)
  is(b.j && b.j.pool?.reused === false, 'on a NEW connection (the dead handle was dropped, one retry at most)', `${a.j.cid} -> ${b.j?.cid}`)
  is(b.j && sameAsFresh(b.j), 'with a clean state', b.j ? diffFromFresh(b.j) : '')
  is(b.j?.pool?.slot > 0, 'and it holds a slot again')
  const b2 = await info_()
  is(b2.j?.cid === b.j?.cid && b2.j?.pool?.reused, 'and is reused after that')

  await rig.dbRestart({ crash: true })
  const c = await info_()
  is(c.status === 200 && c.j && c.j.pool?.reused === false && sameAsFresh(c.j), 'a CRASH (SIGKILL) of MariaDB between two requests: the next request recovers on a clean new connection', c.j ? diffFromFresh(c.j) : `status ${c.status}`)

  // someone kills the pooled connection from outside (an operator, wait_timeout, a firewall)
  await rig.sql(`kill ${c.j.cid}`)
  const d = await info_()
  is(d.status === 200 && d.j && d.j.cid !== c.j.cid && sameAsFresh(d.j), 'KILL of the pooled connection from outside: the next request recovers', d.j ? `${c.j.cid} -> ${d.j.cid}` : `status ${d.status}`)

  // wait_timeout closing an idle handle: a connection made while the global is 2 seconds inherits it
  await rig.sql('set global wait_timeout = 2', '')
  await rig.sql(`kill ${d.j.cid}`)
  const w0 = await info_()
  await sleep(3500)
  const w1 = await info_()
  await rig.sql('set global wait_timeout = 28800', '')
  is(w1.status === 200 && w1.j && w1.j.cid !== w0.j.cid && sameAsFresh(w1.j), 'wait_timeout closed the idle handle: the next request recovers on a new connection', w1.j ? `${w0.j.cid} -> ${w1.j.cid}` : `status ${w1.status}`)
  const stuck = rig.phpErrors().slice(noiseBefore)
  is(!/runs unpooled/.test(stuck), 'none of that fell back to the unpooled path', stuck.trim().slice(0, 120))

  // the database is DOWN: same answer as today, then it comes back
  await rig.dbStop()
  const down = await J('/api/api.php?r=checkout_config')
  is(down.status === 500 && down.j?.error === 'db_unreachable', 'MariaDB down: the API answers db_unreachable exactly as it does without pooling', `${down.status} ${down.t.slice(0, 80)}`)
  await rig.dbStart()
  const up = await info_()
  is(up.status === 200 && up.j && sameAsFresh(up.j), 'MariaDB back: the very next request works and is clean')

  head('5b. a restart INSIDE a transaction fails loudly and replays nothing')
  const dir = rig.WRITABLE
  await rig.sql("delete from pool_marker where tag like 'tx%'")
  rmSync(join(dir, 'tx1.started'), { force: true }); rmSync(join(dir, 'tx1.go'), { force: true })
  const pending = probe('api', `act=txn_hold&tag=tx1&dir=${encodeURIComponent(dir)}`)
  for (let i = 0; i < 200 && !existsSync(join(dir, 'tx1.started')); i++) await sleep(50)
  is(existsSync(join(dir, 'tx1.started')), 'the request opened a transaction and inserted its first row')
  await rig.dbRestart({ crash: true })
  writeFileSync(join(dir, 'tx1.go'), '1')
  const r = await pending
  is(r.status === 500 && r.j?.ok === false, 'the statement that meets the restart FAILS (500), it is not retried', `${r.status} ${r.t.slice(0, 100)}`)
  is(r.j?.attempts === 1, 'the application ran exactly one insert: nothing was replayed behind its back', `${r.j?.attempts}`)
  is([2006, 2013, 1927, 1053, 2002].includes(Number(r.j?.code)), 'with a lost-connection error, not a silent success', `${r.j?.code}`)
  is(await rig.num("select count(*) from pool_marker where tag like 'tx1%'") === 0, 'and no row of that transaction exists afterwards (neither the original nor a replay)')
  const after = await info_()
  is(after.status === 200 && after.j && sameAsFresh(after.j), 'the next request is served on a clean connection')
  setPlain()
}

// ------------------------------------------------------------------ 6. real traffic through pooled connections
async function sectionTraffic() {
  head('6. real checkouts through pooled connections (8 workers, COD with its advisory lock)')
  setPool({ db_persistent_slots: 6 })
  await rig.serverRestart({ workers: 8 })
  await rig.sql('delete from fulfilment_outbox; delete from order_items; delete from orders')
  const cfg = await J('/api/api.php?r=checkout_config')
  const methods = cfg.j?.methods ?? cfg.j?.payment_methods ?? []
  info('checkout_config', JSON.stringify(cfg.j).slice(0, 160))
  const cust = (phone) => ({ name: 'Pool Tester', phone, governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' })
  const mk = (n, method) => ({ track_id: `PL${method.toUpperCase().slice(0, 1)}${String(n).padStart(8, '0')}`, payment_method: method,
    items: [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'l', fit: 'Oversize' }], customer: cust(`9${String(3000000 + n).padStart(7, '0')}`) })
  const post = (body) => J('/api/api.php?r=order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const N = 24
  const results = await Promise.all(Array.from({ length: N }, (_, i) => post(mk(i + 1, i % 2 ? 'cod' : 'knet'))))
  const okN = results.filter((r) => r.status === 200).length
  is(okN === N, `${N} concurrent orders (half COD, half KNET) through pooled connections: all accepted`, `${okN} ok; ${results.filter((r) => r.status !== 200).map((r) => `${r.status}:${r.t.slice(0, 60)}`).slice(0, 3).join(' | ')}`)
  is(await rig.num('select count(*) from orders') === okN && await rig.num('select count(distinct track_id) from orders') === okN, 'each order exists exactly once')
  await sleep(500)
  is(await rig.num("select count(*) from information_schema.innodb_trx") === 0, 'no transaction is left open once the burst ends')
  const codLocks = await rig.num("select count(*) from (select is_used_lock(concat('sporta:cod:', substr(sha2(concat(database(), ':', customer_phone), 256), 1, 50))) as u from orders where payment_method = 'cod') t where u is not null")
  is(codLocks === 0, 'no COD advisory lock is held by any connection afterwards', `${codLocks} held`)
  const idle = await idleOf('pool_app')
  is(idle <= 6, 'and the account has no more than the 6 pooled connections open', `${idle}`)

  // the COD cap refuses the 4th open order of one phone: a refusal that exits INSIDE the lock
  const phone = '95550001'
  const outs = []
  for (let i = 0; i < 5; i++) outs.push(await post({ ...mk(100 + i, 'cod'), customer: cust(phone) }))
  const refused = outs.filter((r) => r.status !== 200).length
  is(refused >= 1, 'a COD order refused by the per-phone cap (the code path that exits while holding its lock)', outs.map((r) => r.status).join(','))
  await sleep(300)
  const phoneLock = await rig.num(`select is_used_lock(concat('sporta:cod:', substr(sha2(concat(database(), ':', '${phone}'), 256), 1, 50))) is not null`)
  is(phoneLock === 0, 'the lock that refused order was held under is released when it ends')
  const nxt = await info_()
  is(nxt.j && sameAsFresh(nxt.j), 'and the next request on that process is clean')
  setPlain()
}

// ------------------------------------------------------------------ 7. Apache prefork + mod_php
async function sectionApache() {
  head('7. Apache 2.4, mpm_prefork, mod_php (the live image\'s runtime)')
  if (NO_APACHE || !rig.hasApache) { info('skipped', NO_APACHE ? '--no-apache' : 'no mod_php available on this machine'); return }
  setPool({ db_persistent_slots: 3 })
  const up = await rig.serverRestart({ kind: 'apache', maxWorkers: 1, keepAlive: false })
  if (!is(up, 'Apache prefork with MaxRequestWorkers 1 started')) return
  const a = await info_(), b = await info_()
  is(a.j?.pid === b.j?.pid && b.j?.cid === a.j?.cid && b.j?.class === 'SportaPooledPDO', 'one Apache child serves both requests and reuses the connection', `pid ${a.j?.pid}, conn ${a.j?.cid}`)
  for (const s of SCEN.filter((x) => ['lock', 'txn', 'abort', 'sqlmode', 'uservar', 'temp', 'tz', 'names', 'everything at once'].includes(x[1]) || x[0] === 'everything at once')) {
    await leakScenario(s, { tag: '[apache] ' })
  }
  await leakScenario(['an open transaction', 'txn', '', true], { tag: '[apache, cleanup skipped] ', abandon: true })
  await leakScenario(['an open GET_LOCK', 'lock', '', true], { tag: '[apache, cleanup skipped] ', abandon: true })
  // the cap, with real prefork children
  const up2 = await rig.serverRestart({ kind: 'apache', maxWorkers: 12, keepAlive: false })
  is(up2, 'Apache prefork with MaxRequestWorkers 12 started')
  await settle('pool_app', 0, 6000)
  const res = await burst(36, 500)
  is(res.every((r) => r.status === 200), 'prefork: 36 concurrent requests on 12 children are all served')
  await sleep(600)
  const idle = await idleOf('pool_app')
  is(idle >= 1 && idle <= 3, `prefork: ${idle} connection(s) stay open after the burst with 3 slots and ${new Set(res.map((r) => r.j?.pid)).size} children used`, `${idle}`)
  const pids = new Set(res.map((r) => r.j?.pid))
  is(pids.size >= 4, 'and many children ran (so the cap, not the child count, is what limited it)', `${pids.size} children`)
  setPlain()
  await rig.serverRestart({ kind: 'cli-server', workers: 1 })
}

// ------------------------------------------------------------------ 8. mutation checks
// NOT here, on purpose: "an open transaction is not rolled back when the next request starts". PHP's own pdo_mysql
// rolls back an open transaction (even one started with a raw START TRANSACTION) when the PDO object of a persistent
// connection is destroyed, so removing the pool's second line changes nothing a request can observe on PHP 8.3 (the
// suite measures this in section 2b). The pool keeps the rollback anyway: it must not depend on a PHP version.
const MUTANTS = [
  { name: 'the statement guard sees nothing', find: "        $w = strtolower(substr(ltrim($sql), 0, 9));\n", repl: "        return;\n        $w = strtolower(substr(ltrim($sql), 0, 9));\n", run: ['leak'] },
  { name: 'a dirty connection is never killed', find: "        try { parent::exec('KILL ' . $id); } catch (Throwable $e) { /* 1927 Connection was killed */ }", repl: "", run: ['leak'] },
  { name: 'locks are not released when the next request starts', find: 'IF(RELEASE_ALL_LOCKS() >= 0, COALESCE', repl: 'IF(1 >= 0, COALESCE', run: ['leak'] },
  { name: 'the settings are not put back', find: "        if ((int)$r['vars_ok'] !== 1) {", repl: "        if (false) {", run: ['leak'] },
  { name: 'nothing is cleaned when a request ends', find: "            if ($this->inTransaction() || $this->poolTxn) parent::exec('ROLLBACK');\n            if ($this->poolLocks) {", repl: "            if (false) {", run: ['leak'] },
  { name: 'the slot cap is not enforced', find: "$chain .= ' ELSE 0 END';", repl: "$chain .= ' ELSE 1 END';", run: ['cap'] },
  { name: 'a connection without a slot is kept anyway', find: "if ($this->poolSlot === 0) $this->poolDispose = true; // every slot taken: behave like today", repl: "", run: ['cap'] },
  { name: 'roles share one persistent handle', find: "[PDO::ATTR_PERSISTENT => 'sporta-' . $role] + $options", repl: "[PDO::ATTR_PERSISTENT => 'sporta-shared'] + $options", run: ['count'] },
  { name: 'a dead handle is never retried', find: "if ($try === 0 && sporta_db_lost($e)) continue; // dead before the caller had it: ONE more attempt", repl: "", unit: true },
  { name: 'every error is retried, not only a lost connection', find: "            if ($try === 0 && sporta_db_lost($e)) continue;\n            throw $e;", repl: "            if ($try === 0) continue;\n            throw $e;", unit: true },
  { name: 'a failure in the pool fails the request instead of falling back', find: "            return $plain();\n        }\n        // Queue", repl: "            throw $e;\n        }\n        // Queue", unit: true },
  { name: 'the CLI is pooled too', find: "    if (in_array(PHP_SAPI, ['cli', 'phpdbg'], true)) return null;\n", repl: "", unit: true },
  { name: 'a second caller in the same request gets a second wrapper', find: "    if (isset($open[$key]) && $open[$key]->poolAlive()) return $open[$key];\n", repl: "", run: ['count'] },
  { name: 'the config switch is ignored', find: "    if (!$on) return null;\n", repl: "", run: ['plain'] },
  // review findings
  { name: 'the four settings are compared with and restored to the server\'s GLOBAL values, not the connection\'s own',
    find: "'(@@sql_mode <=> @sporta_pool_sm AND @@time_zone <=> @sporta_pool_tz '\n            . 'AND @@max_statement_time <=> @sporta_pool_mst AND @@autocommit <=> @sporta_pool_ac) AS vars_ok, '",
    repl: "'(@@sql_mode = @@GLOBAL.sql_mode AND @@time_zone = @@GLOBAL.time_zone '\n            . 'AND @@max_statement_time = @@GLOBAL.max_statement_time AND @@autocommit = @@GLOBAL.autocommit) AS vars_ok, '",
    more: [["'SET SESSION sql_mode = @sporta_pool_sm, time_zone = @sporta_pool_tz, '\n                . 'max_statement_time = @sporta_pool_mst, autocommit = @sporta_pool_ac'",
            "'SET SESSION sql_mode = @@GLOBAL.sql_mode, time_zone = @@GLOBAL.time_zone, '\n                . 'max_statement_time = @@GLOBAL.max_statement_time, autocommit = @@GLOBAL.autocommit'"]],
    run: ['baseline'] },
  { name: 'a connection set up by another pool generation is reused', find: "        if ((int)$r['gen'] !== self::POOL_GEN) { $this->poolKill(); throw new SportaPoolRecycle('pool generation changed'); }\n", repl: "", run: ['baseline'] },
  { name: 'a lowered cap is ignored by connections that already hold a slot', find: "        if ($this->poolSlot > $this->poolSlots) {", repl: "        if (false) {", run: ['lower'] },
]

async function sectionMutants() {
  head('8. mutation checks: take a behaviour away and a check must fail')
  const poolPath = 'api/db-pool.php'
  const orig = rig.stageRead(poolPath)
  for (const m of MUTANTS.filter((x) => !MUT_FILTER || x.name.includes(MUT_FILTER))) {
    const parts = orig.split(m.find)
    if (!is(parts.length === 2, `mutant "${m.name}": its anchor is in db-pool.php exactly once`, `${parts.length - 1} found`)) continue
    let mutated = parts.join(m.repl)
    let anchored = true
    for (const [f2, r2] of m.more ?? []) {
      const p2 = mutated.split(f2)
      if (!is(p2.length === 2, `mutant "${m.name}": its second anchor is in db-pool.php exactly once`, `${p2.length - 1} found`)) { anchored = false; break }
      mutated = p2.join(r2)
    }
    if (!anchored) continue
    let killed = 0
    if (m.unit) {
      const tmp = join(tmpRoot, `mutant-${Math.random().toString(36).slice(2)}.php`)
      writeFileSync(tmp, mutated)
      const r = spawnSync('php', ['-d', 'error_log=/dev/null', join(FIXTURES, 'pool-unit.php'), tmp], { encoding: 'utf8' })
      if (r.status !== 0 && !r.stdout) killed = 1
      for (const l of r.stdout.split('\n').filter(Boolean)) { try { if (!JSON.parse(l).ok) killed++ } catch { killed++ } }
    } else {
      rig.stageWrite(poolPath, mutated)
      capture = []
      try {
        await rig.serverRestart({ workers: m.run.includes('cap') ? 8 : 1 })
        for (const g of m.run) {
          if (g === 'leak') await sectionLeak()
          if (g === 'cap') await sectionCap(' (mutant)')
          if (g === 'baseline') await sectionBaseline()
          if (g === 'lower') await sectionLower()
          if (g === 'count') await sectionCount()
          if (g === 'plain') await sectionPlain()
        }
      } catch (e) { capture.push(`threw ${e.message}`) }
      killed = capture.length
      capture = null
      rig.stageWrite(poolPath, orig)
    }
    is(killed > 0, `mutant "${m.name}" is caught`, `${killed} check${killed === 1 ? '' : 's'} fail without it`)
  }
  rig.stageWrite(poolPath, orig)
  await rig.serverRestart({ workers: 1 })
}

// ------------------------------------------------------------------ run
try {
  if (want('plain')) await sectionPlain()
  if (want('leak')) { await sectionNaked(); await sectionLeak() }
  if (want('baseline')) await sectionBaseline()
  if (want('count')) await sectionCount()
  if (want('cap')) { await sectionCap(); await sectionLower() }
  if (want('restart')) await sectionRestart()
  if (want('traffic')) await sectionTraffic()
  if (want('apache')) await sectionApache()
  if (!NO_MUTANTS && want('mutants')) await sectionMutants()
} catch (e) {
  fails++
  console.log(`FAIL the suite stopped: ${e.stack || e}`)
}
const errs = rig.phpErrors()
const unexpected = errs.split('\n').filter((l) => l && !/this request runs unpooled|MySQL server has gone away|Connection was killed/.test(l))
info('PHP error log', unexpected.length ? unexpected.slice(0, 3).join(' | ').slice(0, 300) : 'no unexpected lines')
console.log(`\n${passes} ok, ${fails} failed`)
rig.stop()
process.exit(fails ? 1 : 0)
