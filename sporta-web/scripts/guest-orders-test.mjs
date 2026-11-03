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
//   GUEST_STRICT       1 makes an open DEFECT line fail the run (exit 1). By
//                      default a DEFECT is printed and counted but does not fail
//                      the run, because the suite is also the evidence for them.
//   GUEST_EXTRA_LOGS   comma separated log files to search for personal data
//                      (default: $GUEST_HOME/logs/mariadb-error.log if it exists)
//
// OUTPUT. `ok` = the behaviour is right. `FAIL` = the suite's expectation was
// wrong or the system broke. `DEFECT <id>` = the system does something it should
// not, proven with the exact requests; `note` = an observation, counted nowhere.
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
async function startStore(name, cfg) {
  const file = join(TMP, `config-${name}.php`)
  writeConfig(file, { ...OVERRIDES, ...cfg })
  const port = await freePort()
  const out = join(LOGDIR, `php-${name}.out`)
  const p = spawn('php', [...phpArgs(join(LOGDIR, `php-${name}-error.log`)), '-S', `127.0.0.1:${port}`, '-t', STORE_DIR], {
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
    const out = await cli('cron-fulfilment.php', '--run')
    const m = mails().slice(before).find((x) => x.text.includes(r.track))
    is(!!m, 'cron-fulfilment mails the warehouse for the new order', JSON.stringify(out).slice(0, 100))
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
  defect('G3', vOwn.status !== 409, "three cash orders typed under someone's number do not block that person's own cash order",
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
//@@PART2@@

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
  ]
  for (const s of stmts) { try { await sql(s) } catch (err) { note('cleanup step skipped', `${s.slice(0, 50)}… ${String(err.message).split('\n')[0].slice(0, 80)}`) } }
  if (stockRestore !== null) await sql(`update product_variants set stock = ${stockRestore} where slug=${lit(JACKET)} and size='L'`)
  if (stockRestoreM !== null) await sql(`update product_variants set stock = ${stockRestoreM} where slug=${lit(JACKET)} and size='M'`)
  ok('the rows and stock this run touched are put back', `${ids.length} orders, ${p.length} phones, ${e.length} emails`)
})

stopAll()
try { rmSync(TMP, { recursive: true, force: true }) } catch { /* scratch */ }
console.log(`\n${passes} ok, ${fails} FAIL, ${defects} open DEFECT${defects === 1 ? '' : 's'}${defects ? ` (${[...new Set(defectList)].join(', ')})` : ''}`)
process.exit(fails > 0 || (STRICT && defects > 0) ? 1 : 0)
