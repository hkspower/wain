// Does the stock move correctly when a customer checks out? — proven over real
// HTTP against a real MariaDB, with real PHP workers racing each other.
//
//   npm run test:inventory-checkout
//
// WHAT "CORRECTLY" MEANS HERE (the owner asked: "check inventory update with
// checkout"). When an order is placed the unit is claimed
//   * exactly once, for the right product and the right size,
//   * atomically with the order (a refused or failed order leaves NOTHING),
//   * never below zero, whatever the customers do at the same instant,
//   * released once — and only once — when the order is cancelled, expires or
//     the payment fails; a late callback or a second sweep puts back nothing,
//   * recorded (the movement ledger) and visible to the storefront at once.
// After every section the invariant is re-proved for every variant this run
// created:  initial stock - units held by orders that still own them
//           + the admin's recorded adjustments == stock now.
//
// IT DOES NOT ASSUME THE SHARED RIG. Everything it needs comes from the
// environment, with defaults that match a PRIVATE instance (a second
// mariadbd on :3399 holding database `invchk`, store workers on :8301/:8302,
// KNET on :8303 with a fake bank on :8304, T-Pay on :8305 with a fake gateway
// on :8306). To aim it at the shared rig, set the variables below.
//
//   INV_API        store, order cooldown OFF          http://127.0.0.1:8301
//   INV_API_CD     store, order cooldown 60 s         http://127.0.0.1:8302  (optional)
//   INV_KNET       dropin/php-knet                    http://127.0.0.1:8303
//   INV_BANK       fake KNET bank                     http://127.0.0.1:8304
//   INV_CBK        dropin/php-cbk (T-Pay)             http://127.0.0.1:8305
//   INV_DB_HOST / INV_DB_PORT / INV_DB_SOCKET / INV_DB_NAME / INV_DB_USER / INV_DB_PASS
//   INV_STORE_DIR  dropin/php-store (for cron-stock.php, run as a CLI)
//   INV_API_CONFIG the store config file cron-stock.php must use
//   INV_REPORT     a path: a JSON report of every check is written there
//   INV_STRICT_LEDGER=1  make the known ledger gaps fail the run (see GAP below)
//
// It creates its own products (slug invchk-<run>-*), variants (sku IV<run>*),
// a discount code, a throw-away admin and one trigger, and removes all of them
// at the end (and on a crash exit). cron-stock.php is global to the database:
// on a shared rig it would also release OTHER suites' expired orders.
//
// MEASURED 2026-11-03 on a private MariaDB 10.11 (REPEATABLE-READ) + 16 PHP workers
// per port, code at 79bae2ee: 222 ok, 0 FAIL, 9 GAP, 9 info (about 80 s). The GAPs:
//   1. the ledger never records a sale or a release (scenarios 1, 14a, 15);
//   2. carts claim their lines in CART ORDER with no retry, so two carts that
//      list the same products in opposite order deadlock InnoDB (1213) on
//      idx_variants_slug and the loser is answered 500 `failed`: 41-42 of 120
//      customers with 100 units on both shelves (scenario 14b). Measured fix, on a
//      scratch copy only: sort the lines by slug|size inside store_stock_claim()
//      -> 0 of 360 requests failed and Innodb_deadlocks did not move. A UNIQUE key
//      on (slug,size) alone does NOT fix it (67 of 120 failed): it removes the gap
//      locks that used to serialise carts, so the plain A,B / B,A cross appears;
//   3. an admin-cancelled order that was under REVIEW keeps its units for ever;
//   4. a size with two variant rows (no unique key on slug,size) is unbuyable;
//   5. the 60 s phone rule leaks for card orders (2-5 of 5 rounds let several in).
// Stock itself stayed exact in every one of them: the invariant held throughout.
//
// Output: `ok` / `FAIL` as in the other suites, plus
//   `GAP`  behaviour that is real, understood and NOT yet fixed — printed
//          every run so it cannot be forgotten, counted separately, and only
//          fatal with INV_STRICT_LEDGER=1;
//   `info` an observation that is neither right nor wrong (recorded in the report).
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const env = process.env
const API = env.INV_API ?? 'http://127.0.0.1:8301'
const API_CD = env.INV_API_CD ?? 'http://127.0.0.1:8302'
const KNET = env.INV_KNET ?? 'http://127.0.0.1:8303'
const BANK = env.INV_BANK ?? 'http://127.0.0.1:8304'
const CBK = env.INV_CBK ?? 'http://127.0.0.1:8305'
const REPO = new URL('..', import.meta.url).pathname
const STORE_DIR = env.INV_STORE_DIR ?? `${REPO}dropin/php-store`
const API_CONFIG = env.INV_API_CONFIG
  ?? '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/invchk/api-config.php'
const DB = {
  host: env.INV_DB_HOST ?? '127.0.0.1', port: env.INV_DB_PORT ?? '3399', socket: env.INV_DB_SOCKET ?? '',
  name: env.INV_DB_NAME ?? 'invchk', user: env.INV_DB_USER ?? 'invchk', pass: env.INV_DB_PASS ?? 'invchk-pass',
}
const STRICT = env.INV_STRICT_LEDGER === '1'

// ------------------------------------------------------------------ reporting
let passes = 0, fails = 0, gaps = 0, infos = 0
const results = []
let section = ''
const head = (t) => { section = t; console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`) }
const rec = (kind, name, detail) => { results.push({ section, kind, name, detail }); }
const ok = (n, d = '') => { passes++; rec('ok', n, d); console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; rec('fail', n, d); console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d = '') => (c ? ok(n, d) : bad(n, d))
const gap = (c, n, d = '') => {
  if (c) return ok(n)
  gaps++; rec('gap', n, d); console.log(`GAP  ${n}${d ? `  — ${d}` : ''}`)
}
const info = (n, d = '') => { infos++; rec('info', n, d); console.log(`info ${n}${d ? `  — ${d}` : ''}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ database
const dbArgs = [
  '--no-defaults', ...(DB.socket ? ['-S', DB.socket] : ['-h', DB.host, '-P', String(DB.port)]),
  '-u', DB.user, DB.name, '-N', '-B', '--default-character-set=utf8mb4',
]
const dbEnv = { ...env, MYSQL_PWD: DB.pass }
const q = async (sql) => (await run('mariadb', [...dbArgs, '-e', sql], { env: dbEnv, maxBuffer: 1 << 26 })).stdout.trim()
const rows = async (sql) => { const t = await q(sql); return t === '' ? [] : t.split('\n').map((l) => l.split('\t')) }
const one = async (sql) => (await rows(sql))[0]?.[0] ?? null
const sqlErr = async (sql) => {
  try { await q(sql); return null } catch (e) { return String(e.stderr ?? e.message) }
}
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// ------------------------------------------------------------- run identity
const RUN = env.INV_RUN ?? crypto.randomBytes(3).toString('hex')
const ipRun = crypto.randomBytes(1)[0]
let ipSeq = 0
const nextIp = () => { ipSeq++; return `10.${ipRun}.${(ipSeq >> 8) & 255}.${(ipSeq & 255) || 1}` }
let phoneSeq = crypto.randomBytes(3).readUIntBE(0, 3) % 4_000_000
const nextPhone = () => `9${String(++phoneSeq).padStart(7, '0')}`
let trackSeq = 0
const nextTrack = () => `IV${RUN}${(++trackSeq).toString(36).padStart(4, '0')}`

const created = { skus: [], slugs: [], codes: [], admins: [], triggers: [] }
let cleaned = false
const cleanup = async () => {
  if (cleaned) return
  cleaned = true
  try {
    for (const t of created.triggers) await sqlErr(`drop trigger if exists ${t}`)
    await sqlErr(`delete o from orders o join order_items oi on oi.order_id = o.id join products p on p.id = oi.product_id
                   where p.slug like 'invchk-${RUN}-%'`)
    await sqlErr(`delete from inventory_movements where sku like 'IV${RUN}%'`)
    await sqlErr(`delete from product_variants where slug like 'invchk-${RUN}-%'`)
    await sqlErr(`delete from products where slug like 'invchk-${RUN}-%'`)
    await sqlErr(`delete from discounts where code like 'INVCHK${RUN}%'`)
    for (const e of created.admins) await sqlErr(`delete from admin_users where email = '${esc(e)}'`)
  } catch { /* best effort */ }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
process.on('SIGTERM', async () => { await cleanup(); process.exit(143) })

// ----------------------------------------------------------------- products
const products = []
/** A product with tracked sizes: mkProduct('a', {S:5, M:5}). Untracked: stock = null. */
const mkProduct = async (tag, stock, { price = '10.000', active = 1 } = {}) => {
  const slug = `invchk-${RUN}-${tag}`
  await q(`insert into products (slug, name_en, name_ar, price, category, active)
           values ('${slug}', 'Invchk ${tag}', 'اختبار ${tag}', ${price}, 'tops', ${active})`)
  const id = Number(await one(`select id from products where slug = '${slug}'`))
  const skus = {}
  const init = {}
  for (const [size, n] of Object.entries(stock ?? {})) {
    const sku = `IV${RUN}${tag}-${size}`.slice(0, 30)
    await q(`insert into product_variants (sku, slug, size, stock) values ('${sku}', '${slug}', '${size}', ${n})`)
    skus[size] = sku
    init[size] = n
  }
  created.slugs.push(slug)
  const p = { slug, id, skus, init, tag }
  products.push(p)
  return p
}
/** stock + version per size, straight from the table */
const snap = async (p) => {
  const out = {}
  for (const [size, stock, ver] of await rows(
    `select size, stock, inventory_version from product_variants where slug = '${p.slug}' order by size`)) {
    out[size] = { stock: Number(stock), ver: Number(ver) }
  }
  return out
}
const stocks = async (p) => Object.fromEntries(Object.entries(await snap(p)).map(([s, v]) => [s, v.stock]))
/** what the storefront's own availability route says (?r=stock) */
const avail = async (p) => {
  const res = await fetch(`${API}/api.php?r=stock`, { headers: { 'X-Forwarded-For': nextIp() } })
  const list = await res.json()
  return Object.fromEntries(list.filter((r) => r.slug === p.slug).map((r) => [r.size, { stock: r.stock, in_stock: r.in_stock }]))
}
const ledger = async (p) => rows(
  `select m.sku, m.type, m.before_stock, m.after_stock, m.delta, m.inventory_version from inventory_movements m
    join product_variants v on v.sku = m.sku where v.slug = '${p.slug}' order by m.id`)
const orderRow = async (track) => {
  const r = (await rows(`select id, payment_status, payment_method, fulfilment_status, stock_claimed, stock_released,
                                amount, discount_released from orders where track_id = '${track}'`))[0]
  return r ? { id: Number(r[0]), pay: r[1], method: r[2], ful: r[3], claimed: Number(r[4]), released: Number(r[5]),
               amount: r[6], discRel: Number(r[7]) } : null
}
const itemsOf = async (track) => rows(
  `select p.slug, oi.size, oi.qty, oi.unit_price from order_items oi join orders o on o.id = oi.order_id
     join products p on p.id = oi.product_id where o.track_id = '${track}' order by oi.id`)
const age = (track, interval) => q(`update orders set created_at = now() - interval ${interval} where track_id = '${track}'`)
const usedCount = async (code) => Number(await one(`select used_count from discounts where code = '${code}'`))
const outboxCount = async (track, kind) => Number(await one(
  `select count(*) from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id = '${track}' and f.kind = '${kind}'`))
const countOrdersFor = async (p) => Number(await one(
  `select count(distinct oi.order_id) from order_items oi where oi.product_id = ${p.id}`))

// ------------------------------------------------------------------- orders
const CUSTOMER = (phone, name = 'Fatima Al-Sabah') => ({
  name, phone, governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5',
})
const post = async (base, body, ip) => {
  const res = await fetch(`${base}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, body: json, text, headers: res.headers }
}
/**
 * Place an order. items: a list of {slug,size,qty}. rawItems: a JSON TEXT for
 * the items array, for values JSON.stringify cannot write (2.0, 1e9).
 */
const placeOrder = async ({ items, rawItems, method = 'cod', phone, ip, track, name, discount, base = API, extra = {} } = {}) => {
  const t = track ?? nextTrack()
  const ph = phone ?? nextPhone()
  const body = JSON.stringify({
    track_id: t, items: rawItems ? '@@ITEMS@@' : items, customer: CUSTOMER(ph, name),
    payment_method: method, ...(discount ? { discount_code: discount } : {}), ...extra,
  }).replace('"@@ITEMS@@"', rawItems ?? 'null')
  const r = await post(base, body, ip ?? nextIp())
  return { ...r, track: t, phone: ph, err: r.body?.error ?? null }
}
const line = (p, size, qty = 1) => ({ slug: p.slug, size, qty })

// ----------------------------------------------------------- invariants (15)
// For every variant this run created:
//   initial - units held by orders that still own them + sum of the admin's
//   recorded deltas == stock now.
// "Own" = stock_claimed = 1 and stock_released = 0 (the schema's own flags);
// separately, no order that is failed/cancelled may be left holding units once
// a sweep has run (checked where a sweep has run).
const invariant = async (label) => {
  const bad_ = []
  for (const p of products) {
    for (const size of Object.keys(p.skus)) {
      const stock = Number(await one(`select stock from product_variants where sku = '${p.skus[size]}'`))
      const held = Number(await one(
        `select coalesce(sum(oi.qty), 0) from order_items oi join orders o on o.id = oi.order_id
          where oi.product_id = ${p.id} and oi.size = '${size}' and o.stock_claimed = 1 and o.stock_released = 0`))
      const adj = Number(await one(`select coalesce(sum(delta), 0) from inventory_movements where sku = '${p.skus[size]}'`))
      const expect = p.init[size] - held + adj
      if (stock < 0 || stock !== expect) bad_.push(`${p.tag}/${size}: stock ${stock} != ${p.init[size]} - held ${held} + adjustments ${adj} = ${expect}`)
    }
  }
  is(bad_.length === 0, `invariant after "${label}": initial - held + adjustments == stock, for ${products.reduce((n, p) => n + Object.keys(p.skus).length, 0)} variants`,
     bad_.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- the cron CLI
const cron = async () => {
  const { stdout } = await run('php', [`${STORE_DIR}/cron-stock.php`, '--release'],
    { env: { ...env, SPORTA_API_CONFIG_FILE: API_CONFIG }, maxBuffer: 1 << 24 })
  return JSON.parse(stdout)
}

// -------------------------------------------------------------------- the admin
const ADMIN_PASSWORD = 'correct-horse-battery-kw'
const adminEmail = `invchk-${RUN}@test.invalid`
const adminSessions = []
const adminSignIn = async () => {
  const ip = nextIp()
  const res = await fetch(`${API}/admin.php?r=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email: adminEmail, password: ADMIN_PASSWORD }),
  })
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  if (res.status !== 200 || !cookie) throw new Error(`admin sign-in failed: ${res.status} ${await res.text()}`)
  const s = { cookie, ip }
  adminSessions.push(s)
  return s
}
const admin = async (s, route, { method = 'GET', body } = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', Cookie: s.cookie, 'X-Forwarded-For': s.ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* */ }
  return { status: res.status, body: json, err: json?.error ?? null }
}

// ------------------------------------------------------------------ KNET + CBK
const KEY = 'abcdef0123456789'
const encrypt = (plain) => {
  const c = crypto.createCipheriv('aes-128-cbc', KEY, KEY)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase()
}
const HTTPS = { 'X-Forwarded-Proto': 'https' }
const get = (url) => fetch(url, { headers: HTTPS, redirect: 'manual' })
const knetPay = async (track) => {
  const res = await get(`${KNET}/pay.php?trackid=${track}`)
  return { status: res.status, loc: res.headers.get('location') ?? '' }
}
/** the customer goes to the bank and the bank answers: captured | notcaptured | canceled */
const knetBank = async (track, outcome, extra = '') => {
  const pay = await knetPay(track)
  if (!pay.loc) return { error: `pay.php ${pay.status}` }
  return (await fetch(`${BANK}/fake-knet-bank.php?${new URL(pay.loc).searchParams}&outcome=${outcome}${extra}`)).json()
}
/** a callback posted straight at the merchant (a replay, or a late answer) */
const knetCallback = async (track, result, amount, paymentid = 'PID' + crypto.randomBytes(3).toString('hex')) => {
  const res = await fetch(`${KNET}/callback.php`, {
    method: 'POST', redirect: 'manual',
    headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ trandata: encrypt(`result=${result}&trackid=${track}&amt=${amount}&paymentid=${paymentid}&ref=R1&auth=A1&tranid=T1`) }),
  })
  return res.status
}
const fmt3 = (n) => Number(n).toFixed(3)
const formFields = (html) => Object.fromEntries(
  [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const formAction = (html) => /<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? ''
/** T-Pay: the hosted page, then the return to the merchant's callback */
const tpay = async (track, outcome) => {
  const res = await get(`${CBK}/pay.php?trackid=${track}`)
  const html = await res.text()
  if (res.status !== 200 || !html.includes('<form')) return { error: `pay.php ${res.status}` }
  const action = formAction(html).replace(/&amp;/g, '&')
  const gw = await (await fetch(`${action}${action.includes('?') ? '&' : '?'}outcome=${outcome}`, {
    method: 'POST', body: new URLSearchParams(formFields(html)),
  })).json()
  const back = await get(gw.return_url)
  return { gw, location: back.headers.get('location') ?? '', status: back.status, returnUrl: gw.return_url }
}

// ============================================================================
//                                    RUN
// ============================================================================
const started = Date.now()
try {
  // ---- preflight: the rig is what this suite thinks it is
  const probe = await fetch(`${API}/api.php?r=checkout_config`).then((r) => r.json()).catch(() => null)
  if (!probe?.methods) { console.error(`FATAL the store at ${API} did not answer ?r=checkout_config`); process.exit(2) }
  const must = ['inventory_movements', 'product_variants']
  for (const t of must) {
    if ((await sqlErr(`select 1 from ${t} limit 1`)) !== null) { console.error(`FATAL table ${t} missing in ${DB.name}: the inventory migration is not applied`); process.exit(2) }
  }
  const invCols = await one(`select count(*) from information_schema.columns where table_schema = database()
    and table_name = 'product_variants' and column_name = 'inventory_version'`)
  if (invCols !== '1') { console.error('FATAL product_variants.inventory_version missing: this is the 2026-11-02 incident'); process.exit(2) }
  const hash = (await run('php', ['-r', `echo password_hash('${ADMIN_PASSWORD}', PASSWORD_DEFAULT);`])).stdout
  await q(`insert into admin_users (email, password_hash) values ('${adminEmail}', '${esc(hash)}')`)
  created.admins.push(adminEmail)
  const admin1 = await adminSignIn()
  console.log(`inventory-checkout run ${RUN}  api=${API}  db=${DB.socket || `${DB.host}:${DB.port}`}/${DB.name}`)

  // ================================================================ 1
  head('1  a COD order for one unit of size M')
  {
    const P = await mkProduct('s1', { S: 5, M: 5, L: 5 })
    const before = await snap(P)
    const r = await placeOrder({ items: [line(P, 'M', 1)] })
    is(r.status === 200 && r.body?.order_id > 0, 'the order is accepted', `${r.status} ${r.err ?? ''}`)
    const after = await snap(P)
    is(after.M.stock === 4 && after.S.stock === 5 && after.L.stock === 5, 'M drops by exactly 1; S and L are untouched',
       JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.stock]))))
    is(after.M.ver === before.M.ver + 1 && after.S.ver === before.S.ver && after.L.ver === before.L.ver,
       'inventory_version moves on M only (+1)', `${before.M.ver} -> ${after.M.ver}`)
    const o = await orderRow(r.track)
    is(o?.claimed === 1 && o?.released === 0 && o?.pay === 'pending' && o?.method === 'cod', 'the order says it owns the unit (stock_claimed=1, released=0)', JSON.stringify(o))
    const items = await itemsOf(r.track)
    is(items.length === 1 && items[0][0] === P.slug && items[0][1] === 'M' && items[0][2] === '1' && items[0][3] === '10.000',
       'order_items: one line, right product, size M, qty 1, server price 10.000', JSON.stringify(items))
    is(o?.amount === '11.000', 'amount = goods 10.000 + delivery 1.000, priced by the server', o?.amount)
    const a = await avail(P)
    is(a.M.stock === 4 && a.M.in_stock === true && a.S.stock === 5 && a.L.stock === 5,
       'the storefront availability API shows the new quantity at once', JSON.stringify(a))
    const adm = await admin(admin1, 'variants')
    const mrow = (adm.body ?? []).find((v) => v.sku === P.skus.M)
    is(mrow?.stock === 4 && mrow?.sold_qty === 1, 'the admin Stock screen shows stock 4 and sold 1', JSON.stringify({ stock: mrow?.stock, sold: mrow?.sold_qty }))
    const lg = await ledger(P)
    gap(lg.length === 1 && lg[0][2] === '5' && lg[0][3] === '4' && lg[0][4] === '-1',
        'the movement ledger has ONE row for the sale (before 5, after 4, delta -1)',
        `ledger rows: ${lg.length} (inventory_movements only ever holds admin events; its type CHECK has no sale type)`)
    await invariant('1')
  }

  // ================================================================ 2
  head('2  quantity 3 of one size')
  {
    const P = await mkProduct('s2', { S: 5, M: 5, L: 5 })
    const r = await placeOrder({ items: [line(P, 'L', 3)] })
    is(r.status === 200, 'accepted', `${r.status} ${r.err ?? ''}`)
    is(same(await stocks(P), { L: 2, M: 5, S: 5 }), 'L 5 -> 2; M and S untouched', JSON.stringify(await stocks(P)))
    const it = await itemsOf(r.track)
    is(it.length === 1 && it[0][2] === '3', 'one line, qty 3', JSON.stringify(it))
    const a = await avail(P)
    is(a.L.stock === 2, 'availability API: 2 left', JSON.stringify(a.L))
    is((await orderRow(r.track)).amount === '31.000', 'amount = 3 x 10.000 + 1.000', (await orderRow(r.track)).amount)
    await invariant('2')
  }

  // ================================================================ 3
  head('3  a cart with two different products and sizes')
  {
    const P1 = await mkProduct('s3a', { M: 4, L: 4 })
    const P2 = await mkProduct('s3b', { M: 6, XL: 6 })
    const r = await placeOrder({ items: [line(P1, 'M', 1), line(P2, 'XL', 2)] })
    is(r.status === 200, 'accepted', `${r.status} ${r.err ?? ''}`)
    is(same(await stocks(P1), { L: 4, M: 3 }) && same(await stocks(P2), { M: 6, XL: 4 }), 'both products decrease, on the right sizes only',
       JSON.stringify([await stocks(P1), await stocks(P2)]))
    is((await itemsOf(r.track)).length === 2, 'two order_items rows')
    const a1 = await avail(P1), a2 = await avail(P2)
    is(a1.M.stock === 3 && a2.XL.stock === 4, 'availability reflects both at once')
    await invariant('3')
  }

  // ================================================================ 4
  head('4  the SAME variant on two cart lines')
  {
    const P = await mkProduct('s4', { M: 20, L: 20 })
    const r = await placeOrder({ items: [line(P, 'M', 2), line(P, 'M', 3)] })
    is(r.status === 200, 'two lines of one variant: accepted', `${r.status} ${r.err ?? ''}`)
    is((await stocks(P)).M === 15, 'claimed one line after the other: 20 - 2 - 3 = 15 (not double counted, not merged away)', JSON.stringify(await stocks(P)))
    const it = await itemsOf(r.track)
    is(it.length === 2 && Number(it[0][2]) + Number(it[1][2]) === 5, 'both lines are kept in order_items (2 + 3)', JSON.stringify(it))

    const capOk = await placeOrder({ items: [line(P, 'M', 5), line(P, 'M', 5)] })
    is(capOk.status === 200 && (await stocks(P)).M === 5, '5 + 5 = 10 of one variant is exactly the per-variant cap: accepted, stock 15 -> 5', `${capOk.status} ${capOk.err ?? ''}`)

    const P2 = await mkProduct('s4b', { M: 30 })
    const over = await placeOrder({ items: [line(P2, 'M', 6), line(P2, 'M', 5)] })
    is(over.status === 400 && over.err === 'cart_too_large', 'the cap is on the MERGED variant: 6 + 5 = 11 -> cart_too_large', `${over.status} ${over.err}`)
    is((await stocks(P2)).M === 30 && !(await orderRow(over.track)), 'and nothing was claimed, no order row')

    const P3 = await mkProduct('s4c', { M: 4 })
    const short = await placeOrder({ items: [line(P3, 'M', 2), line(P3, 'M', 3)] })
    is(short.status === 409 && /^out_of_stock_/.test(short.err ?? ''), '2 + 3 against a shelf of 4 is refused with out_of_stock_*', `${short.status} ${short.err}`)
    is((await stocks(P3)).M === 4 && !(await orderRow(short.track)), 'the first line was rolled back: shelf still 4, no order')
    info('the token for merged duplicate lines reports what is left AFTER the first line was taken, not what the shop had',
         `shelf 4, cart 2+3 -> ${short.err} (a shopper is told "2 left" when 4 are on the shelf)`)
    await invariant('4')
  }

  // ================================================================ 5
  head('5  exactly the last unit')
  {
    const P = await mkProduct('s5', { M: 1, L: 3 })
    const r = await placeOrder({ items: [line(P, 'M', 1)] })
    is(r.status === 200, 'the last unit is sold', `${r.status} ${r.err ?? ''}`)
    is((await stocks(P)).M === 0, 'stock is exactly 0')
    const a = await avail(P)
    is(a.M.stock === 0 && a.M.in_stock === false && a.L.in_stock === true, 'the storefront marks M sold out at once, L still in stock', JSON.stringify(a))
    const again = await placeOrder({ items: [line(P, 'M', 1)] })
    is(again.status === 409 && again.err === `out_of_stock_${P.slug}_M_0`, 'the next customer is refused with the exact token', `${again.status} ${again.err}`)
    is((await stocks(P)).M === 0 && !(await orderRow(again.track)), 'stock stays 0 (never negative), no order')
    const e = await sqlErr(`update product_variants set stock = stock - 1 where sku = '${P.skus.M}'`)
    is(e !== null && /variants_stock_ck|CONSTRAINT/i.test(e), 'the database itself refuses a negative stock (CHECK variants_stock_ck is the backstop)', (e ?? '').split('\n')[0].slice(0, 90))
    await invariant('5')
  }

  // ================================================================ 6
  head('6  one short line in a 3-line cart')
  {
    const code = `INVCHK${RUN}A`
    await q(`insert into discounts (kind, code, label, type, value, usage_limit, used_count, active)
             values ('code', '${code}', 'invchk', 'percent', 10, 5, 0, 1)`)
    const A = await mkProduct('s6a', { S: 5 })
    const B = await mkProduct('s6b', { M: 5 })
    const C = await mkProduct('s6c', { L: 2 })
    const okOrder = await placeOrder({ items: [line(A, 'S', 1)], discount: code })
    is(okOrder.status === 200 && (await usedCount(code)) === 1, 'control: an order with the code is accepted and uses the code once', `${okOrder.status} ${okOrder.err ?? ''}`)
    const before = [await stocks(A), await stocks(B), await stocks(C)]
    const ordersBefore = Number(await one(`select count(*) from orders`))
    const outboxBefore = Number(await one(`select count(*) from fulfilment_outbox`))
    const r = await placeOrder({ items: [line(A, 'S', 1), line(B, 'M', 1), line(C, 'L', 5)], discount: code })
    is(r.status === 409 && r.err === `out_of_stock_${C.slug}_L_2`, 'the short LAST line refuses the whole order: out_of_stock_<slug>_L_2', `${r.status} ${r.err}`)
    const after = [await stocks(A), await stocks(B), await stocks(C)]
    is(same(before, after), 'NO stock changed anywhere (the two lines claimed before it were rolled back)', JSON.stringify(after))
    is(!(await orderRow(r.track)) && Number(await one(`select count(*) from orders`)) === ordersBefore, 'no order row')
    is(Number(await one(`select count(*) from fulfilment_outbox`)) === outboxBefore, 'no warehouse message queued')
    is((await usedCount(code)) === 1, 'the discount use was NOT consumed (still 1 of 5)', String(await usedCount(code)))
    is((await ledger(A)).length === 0 && (await ledger(B)).length === 0 && (await ledger(C)).length === 0, 'no ledger row')
    const a = await avail(B)
    is(a.M.stock === 5, 'availability unchanged for the line that was claimed and rolled back', JSON.stringify(a))
    const first = await placeOrder({ items: [line(C, 'L', 5), line(A, 'S', 1)] })
    is(first.status === 409 && same([await stocks(A), await stocks(C)], [before[0] && { S: 4 }, { L: 2 }]), 'short line FIRST: refused, nothing claimed', `${first.status} ${first.err}`)
    await invariant('6')
  }

  // ================================================================ 7
  head('7  bad quantities')
  {
    const P = await mkProduct('s7', { S: 40, M: 40, L: 40 })
    const refuse = async (label, raw, token, status = 400) => {
      const before = await stocks(P)
      const r = await placeOrder({ rawItems: `[{"slug":"${P.slug}","size":"M","qty":${raw}}]` })
      const okk = r.status === status && r.err === token && same(before, await stocks(P)) && !(await orderRow(r.track))
      is(okk, `qty ${label}: ${token}, no stock change, no order`, `${r.status} ${r.err}`)
    }
    await refuse('0', '0', 'invalid_qty')
    await refuse('-1', '-1', 'invalid_qty')
    await refuse('1.5', '1.5', 'invalid_qty')
    await refuse('2.0 (a float)', '2.0', 'invalid_qty')
    await refuse('"2.5"', '"2.5"', 'invalid_qty')
    await refuse('"abc"', '"abc"', 'invalid_qty')
    await refuse('"02"', '"02"', 'invalid_qty')
    await refuse('"1e1"', '"1e1"', 'invalid_qty')
    await refuse('"" (empty string)', '""', 'invalid_qty')
    await refuse('" 2"', '" 2"', 'invalid_qty')
    await refuse('[1] (array)', '[1]', 'invalid_qty')
    await refuse('{"a":1} (object)', '{"a":1}', 'invalid_qty')
    await refuse('true', 'true', 'invalid_qty')
    await refuse('false', 'false', 'invalid_qty')
    await refuse('100', '100', 'invalid_qty')
    await refuse('1e9 (a float in JSON)', '1e9', 'invalid_qty')
    await refuse('1000000000000', '1000000000000', 'invalid_qty')
    await refuse('99999999999999999999', '99999999999999999999', 'invalid_qty')
    await refuse('99 (valid shape, over the cap)', '99', 'cart_too_large')
    await refuse('11 (over the 10 per variant cap)', '11', 'cart_too_large')
    await refuse('"11" as a string', '"11"', 'cart_too_large')

    // the lenient ones: documented, asserted so that a change is noticed
    const b1 = await stocks(P)
    const s2 = await placeOrder({ rawItems: `[{"slug":"${P.slug}","size":"M","qty":"2"}]` })
    is(s2.status === 200 && (await stocks(P)).M === b1.M - 2, 'qty "2" (a numeric string) is accepted as 2 and claims exactly 2 (older clients)', `${s2.status} M ${b1.M} -> ${(await stocks(P)).M}`)
    const b2 = await stocks(P)
    const nl = await placeOrder({ rawItems: `[{"slug":"${P.slug}","size":"M","qty":null}]` })
    is(nl.status === 200 && (await stocks(P)).M === b2.M - 1, 'qty null counts as 1 and claims exactly 1', `${nl.status} M ${b2.M} -> ${(await stocks(P)).M}`)
    const b3 = await stocks(P)
    const nq = await placeOrder({ rawItems: `[{"slug":"${P.slug}","size":"M"}]` })
    is(nq.status === 200 && (await stocks(P)).M === b3.M - 1, 'qty missing counts as 1 and claims exactly 1', `${nq.status}`)
    info('qty null / missing is read as 1 rather than refused', 'the storefront always sends qty, so this only matters to a hand-written client')

    // caps
    const capCase = async (label, items, token) => {
      const before = await stocks(P)
      const r = await placeOrder({ items })
      if (token) is(r.status === 400 && r.err === token && same(before, await stocks(P)) && !(await orderRow(r.track)), `${label}: ${token}, nothing claimed`, `${r.status} ${r.err}`)
      else is(r.status === 200, `${label}: accepted`, `${r.status} ${r.err}`)
    }
    await capCase('10 + 10 across two sizes = 20 units, the order cap exactly', [line(P, 'M', 10), line(P, 'L', 10)], null)
    await capCase('10 + 10 + 1 = 21 units', [line(P, 'M', 10), line(P, 'L', 10), line(P, 'S', 1)], 'cart_too_large')
    await capCase('7 + 7 + 7 = 21 units', [line(P, 'M', 7), line(P, 'L', 7), line(P, 'S', 7)], 'cart_too_large')
    await capCase('7 + 7 + 6 = 20 units', [line(P, 'M', 7), line(P, 'L', 7), line(P, 'S', 6)], null)
    const big = await placeOrder({ items: Array.from({ length: 51 }, () => line(P, 'S', 1)) })
    is(big.status === 400 && big.err === 'cart_too_large' && !(await orderRow(big.track)), '51 lines: cart_too_large', `${big.status} ${big.err}`)
    const emp = await placeOrder({ items: [] })
    is(emp.status === 400 && emp.err === 'empty_cart', 'an empty cart: empty_cart', `${emp.status} ${emp.err}`)
    const obj = await placeOrder({ items: { a: line(P, 'M') } })
    is(obj.status === 400 && obj.err === 'invalid_item', 'items as an object: invalid_item', `${obj.status} ${obj.err}`)
    await invariant('7')
  }

  // ================================================================ 8
  head('8  unknown size, unknown or unpublished product')
  {
    const P = await mkProduct('s8', { S: 5, M: 5 })
    const U = await mkProduct('s8u', null)
    const H = await mkProduct('s8h', { M: 5 }, { active: 0 })
    const chk = async (label, items, status, token, stockSame = true) => {
      const before = [await stocks(P), await stocks(H)]
      const r = await placeOrder({ items })
      is(r.status === status && r.err === token && (!stockSame || same(before, [await stocks(P), await stocks(H)])) && !(await orderRow(r.track)),
         `${label}: ${token}, no stock change, no order`, `${r.status} ${r.err}`)
    }
    await chk('size XS (not a size the shop sells)', [line(P, 'XS')], 400, 'invalid_size')
    await chk('size "ONE SIZE"', [line(P, 'ONE SIZE')], 400, 'invalid_size')
    await chk('size 6XL', [line(P, '6XL')], 400, 'invalid_size')
    await chk('a valid size the product has no row for (XL)', [line(P, 'XL')], 409, `out_of_stock_${P.slug}_XL_0`)
    info('a size the product does not have is reported as out_of_stock_..._0, the same as sold out', 'the shopper cannot tell "no such size" from "sold out"')
    await chk('size missing on a sized product', [{ slug: P.slug, qty: 1 }], 400, `size_required_${P.slug}`)
    await chk('unknown product', [{ slug: `invchk-${RUN}-nope`, size: 'M', qty: 1 }], 400, `unavailable_invchk-${RUN}-nope`)
    await chk('an UNPUBLISHED product (active = 0)', [line(H, 'M')], 400, `unavailable_${H.slug}`)
    await chk('slug in capitals', [{ slug: P.slug.toUpperCase(), size: 'M', qty: 1 }], 400, 'invalid_slug')
    await chk('a slug with a path in it', [{ slug: '../etc/passwd', size: 'M', qty: 1 }], 400, 'invalid_slug')
    await chk('a bad fit', [{ ...line(P, 'M'), fit: 'tent' }], 400, 'invalid_fit')
    const lower = await placeOrder({ items: [{ slug: P.slug, size: ' m ', qty: 1 }] })
    is(lower.status === 200 && (await stocks(P)).M === 4, 'size " m " is trimmed and upper-cased: claims M (not a new variant)', `${lower.status} ${JSON.stringify(await stocks(P))}`)
    const un = await placeOrder({ items: [{ slug: U.slug, size: 'M', qty: 2 }] })
    const uo = await orderRow(un.track)
    is(un.status === 200 && uo?.claimed === 0, 'a product with NO variant rows is untracked: the order is accepted and claims nothing (stock_claimed=0)', `${un.status} claimed=${uo?.claimed}`)
    const hid = await stocks(H)
    is(hid.M === 5, 'the unpublished product kept its stock')
    await invariant('8')
  }

  head('8b  a duplicated (slug, size) variant row')
  {
    const P = await mkProduct('s8d', { M: 5 })
    // product_variants has no unique key on (slug, size): only the sku is the primary key
    const dupSku = `IV${RUN}s8dDUP`
    const dupErr = await sqlErr(`insert into product_variants (sku, slug, size, stock) values ('${dupSku}', '${P.slug}', 'M', 7)`)
    if (dupErr !== null) {
      is(/Duplicate entry|1062/.test(dupErr), 'the database refuses a second variant row for the same (slug, size): the duplicate cannot exist', dupErr.split('\n')[0].slice(0, 100))
    } else {
      const r = await placeOrder({ items: [line(P, 'M', 1)] })
      const rows_ = await rows(`select sku, stock from product_variants where slug = '${P.slug}' order by sku`)
      const sumNow = rows_.reduce((n, x) => n + Number(x[1]), 0)
      is(sumNow === 12 || sumNow === 10, 'no unit was created or destroyed (5 + 7 = 12 on the two rows, or 10 after one accepted unit on each)', JSON.stringify(rows_))
      gap(r.status === 200, 'a size with two variant rows can still be ordered',
          `the order was ${r.status} ${r.err ?? ''}: the claim updates both rows, sees rowCount 2 instead of 1 and reports the size as out of stock; nothing is oversold, but the size becomes unbuyable until the duplicate is removed`)
    }
    await q(`delete from product_variants where sku = '${dupSku}'`)
  }

  // ================================================================ 9
  head('9  a failure AFTER the claim rolls the stock back')
  {
    const code = `INVCHK${RUN}B`
    await q(`insert into discounts (kind, code, label, type, value, usage_limit, used_count, active)
             values ('code', '${code}', 'invchk', 'percent', 10, 5, 0, 1)`)
    const P = await mkProduct('s9', { S: 60, M: 60 })
    // 9a: the warehouse-message insert (the LAST write before the commit) blows up.
    const trg = `invchk_boom_${RUN}`
    const mk = await sqlErr(`delimiter //
create trigger ${trg} before insert on fulfilment_outbox for each row
begin
  if (select customer_name from orders where id = new.order_id) = 'Invchk Boom' then
    signal sqlstate '45000' set message_text = 'invchk forced failure';
  end if;
end//
delimiter ;`)
    if (mk !== null) {
      info('9a skipped: the database user cannot create a trigger', mk.split('\n')[0].slice(0, 120))
    } else {
      created.triggers.push(trg)
      const before = await stocks(P)
      const track = nextTrack()
      const r = await placeOrder({ track, items: [line(P, 'S', 2), line(P, 'M', 3)], name: 'Invchk Boom', discount: code })
      is(r.status === 500 && r.err === 'failed', 'a forced failure after the claim answers 500 failed (no 200 with a half-order)', `${r.status} ${r.err}`)
      is(same(before, await stocks(P)), 'the claim was rolled back with the order: both lines back on the shelf', JSON.stringify(await stocks(P)))
      is(!(await orderRow(track)) && (await itemsOf(track)).length === 0, 'no order row, no order_items')
      is((await usedCount(code)) === 0, 'the discount use claimed before it was rolled back too (0 of 5)')
      is((await ledger(P)).length === 0, 'no ledger row')
      const snapVer = await snap(P)
      is(snapVer.S.ver === 0 && snapVer.M.ver === 0, 'inventory_version did not move either (the bump rolled back)', JSON.stringify(snapVer))
      await q(`drop trigger ${trg}`)
      created.triggers = created.triggers.filter((t) => t !== trg)
      const retry = await placeOrder({ track, items: [line(P, 'S', 2), line(P, 'M', 3)], name: 'Invchk Boom', discount: code })
      is(retry.status === 200 && same(await stocks(P), { M: 57, S: 58 }), 'the same attempt retried once the fault is gone claims exactly once', `${retry.status} ${JSON.stringify(await stocks(P))}`)
    }
    // 9b: the REAL late refusal: the per-client budget of 40 unpaid pieces, checked after the claim
    const Q = await mkProduct('s9b', { S: 30, M: 30 })
    const ip = nextIp()
    const o1 = await placeOrder({ ip, items: [line(Q, 'S', 10), line(Q, 'M', 10)] })
    const o2 = await placeOrder({ ip, items: [line(Q, 'S', 10), line(Q, 'M', 10)] })
    const before = await stocks(Q)
    const o3 = await placeOrder({ ip, items: [line(Q, 'S', 1)] })
    is(o1.status === 200 && o2.status === 200, 'control: a client may hold 2 x 20 = 40 unpaid pieces', `${o1.status} ${o2.status}`)
    is(o3.status === 429 && o3.err === 'previous_order_pending', 'the 41st piece is refused AFTER the claim (429 previous_order_pending)', `${o3.status} ${o3.err}`)
    is(same(before, await stocks(Q)) && same(before, { M: 10, S: 10 }) && !(await orderRow(o3.track)), 'and that claim was rolled back: stock unchanged, no order', JSON.stringify(await stocks(Q)))
    await invariant('9')
  }

  // ================================================================ 10
  head('10  KNET: a failed payment releases the stock exactly once')
  const knetFlow = {}
  {
    const P = await mkProduct('s10', { L: 10, M: 10 })
    const o = await placeOrder({ method: 'knet', items: [line(P, 'L', 2)] })
    is(o.status === 200 && (await stocks(P)).L === 8, 'a KNET order claims at checkout, before the bank is contacted: L 10 -> 8', `${o.status} ${o.err ?? ''}`)
    const bank = await knetBank(o.track, 'notcaptured')
    is(bank.bank_result === 'NOT CAPTURED' && bank.merchant_code === 200, 'the bank declines and the callback answers', JSON.stringify(bank).slice(0, 100))
    let row = await orderRow(o.track)
    is(row.pay === 'failed', 'the order is failed', row.pay)
    info('after a declined card the units stay claimed until cron-stock.php runs (up to 15 min on the VPS)',
         `stock ${(await stocks(P)).L}, stock_released=${row.released}, availability says ${(await avail(P)).L.stock}`)
    is((await stocks(P)).L === 8 && row.released === 0, 'the callback itself neither released nor double-claimed anything (still 8)')
    const c1 = await cron()
    is(c1.track_ids.includes(o.track), 'cron-stock --release lists the failed order', `released ${c1.released}`)
    row = await orderRow(o.track)
    is((await stocks(P)).L === 10 && row.released === 1, 'released: L back to 10, stock_released=1', JSON.stringify(await stocks(P)))
    is((await avail(P)).L.stock === 10, 'availability shows 10 again')
    const c2 = await cron()
    is(!c2.track_ids.includes(o.track) && (await stocks(P)).L === 10, 'a second sweep is a no-op')
    const st = await knetCallback(o.track, 'NOT CAPTURED', fmt3(o.body.amount))
    is(st === 200 && (await stocks(P)).L === 10, 'a SECOND failure callback does not release again (still 10, not 12)', `${st} L=${(await stocks(P)).L}`)
    await cron()
    is((await stocks(P)).L === 10, 'and a sweep after it does not either')
    const again = await knetPay(o.track)
    is(again.status === 409 && !again.loc, 'a failed order cannot be sent to the bank again (409)', String(again.status))
    knetFlow.P = P; knetFlow.track = o.track; knetFlow.amount = o.body.amount

    // a CAPTURED answer that arrives AFTER the release
    const cap = await knetCallback(o.track, 'CAPTURED', fmt3(o.body.amount))
    row = await orderRow(o.track)
    const reason = await one(`select cbk_status from orders where track_id = '${o.track}'`)
    is(cap === 200 && row.pay === 'review' && reason === 'STOCK_RESERVATION_RELEASED', 'a late CAPTURED after the release is parked for review (STOCK_RESERVATION_RELEASED), not marked paid', `${row.pay} ${reason}`)
    is((await stocks(P)).L === 10 && row.released === 1, 'and it does NOT re-claim: stock stays 10, so the 2 units are on sale again; the money is the operator\'s to refund')
    await cron()
    is((await stocks(P)).L === 10, 'a sweep never touches a review order')
    await invariant('10 failed-payment path')

    // success: no double claim
    const o2 = await placeOrder({ method: 'knet', items: [line(P, 'M', 3)] })
    is((await stocks(P)).M === 7, 'second KNET order claims 3: M 10 -> 7')
    const b2 = await knetBank(o2.track, 'captured')
    is(b2.bank_result === 'CAPTURED' && (await orderRow(o2.track)).pay === 'paid', 'captured -> paid', JSON.stringify(b2).slice(0, 80))
    is((await stocks(P)).M === 7, 'a CAPTURED success does not claim a second time (M stays 7)')
    await knetCallback(o2.track, 'CAPTURED', fmt3(o2.body.amount), 'REPLAYX')
    await knetCallback(o2.track, 'NOT CAPTURED', fmt3(o2.body.amount), 'LATEFAIL')
    await cron()
    const r2 = await orderRow(o2.track)
    is((await stocks(P)).M === 7 && r2.pay === 'paid' && r2.released === 0, 'a replay, a late failure and a sweep leave a paid order and its stock alone', JSON.stringify(r2))

    // failure then capture BEFORE the sweep: still held, now paid
    const o3 = await placeOrder({ method: 'knet', items: [line(P, 'M', 1)] })
    await knetBank(o3.track, 'notcaptured')
    const cap3 = await knetCallback(o3.track, 'CAPTURED', fmt3(o3.body.amount))
    const r3 = await orderRow(o3.track)
    is(cap3 === 200 && r3.pay === 'paid' && r3.released === 0 && (await stocks(P)).M === 6, 'declined, then captured BEFORE any sweep: paid, still holding its unit (M 7 -> 6, not released)', JSON.stringify(r3))
    await cron()
    is((await stocks(P)).M === 6, 'and the sweep leaves it')

    // wrong amount: review while the units are held
    const o4 = await placeOrder({ method: 'knet', items: [line(P, 'M', 1)] })
    await knetBank(o4.track, 'captured', '&amt=0.100')
    const r4 = await orderRow(o4.track)
    is(r4.pay === 'review' && r4.claimed === 1 && r4.released === 0 && (await stocks(P)).M === 5, 'captured for the wrong amount: review, units still held (M 6 -> 5)', JSON.stringify(r4))
    knetFlow.reviewTrack = o4.track; knetFlow.reviewP = P
    await invariant('10 KNET')
  }

  head('10b  T-Pay (CBK): the same four questions')
  {
    const P = await mkProduct('s10t', { L: 10, M: 10 })
    const o = await placeOrder({ method: 'tpay', items: [line(P, 'L', 2)] })
    is(o.status === 200 && (await stocks(P)).L === 8, 'a T-Pay order claims at checkout: L 10 -> 8', `${o.status} ${o.err ?? ''}`)
    const t = await tpay(o.track, 'failed')
    let row = await orderRow(o.track)
    is(!t.error && row.pay === 'failed', 'the gateway declines: the order is failed', `${t.error ?? ''} ${row.pay}`)
    is((await stocks(P)).L === 8 && row.released === 0, 'the callback did not release (that is the sweep\'s job) and did not double-claim')
    const c1 = await cron()
    is(c1.track_ids.includes(o.track) && (await stocks(P)).L === 10, 'cron-stock --release puts the 2 units back: L 8 -> 10', JSON.stringify(await stocks(P)))
    const rep = await get(t.returnUrl)
    await cron()
    is(rep.status === 302 && (await stocks(P)).L === 10, 'a replayed return does not release again (still 10)', `${rep.status} L=${(await stocks(P)).L}`)
    const pay2 = await get(`${CBK}/pay.php?trackid=${o.track}`)
    is(pay2.status === 409, 'a failed order cannot be paid through T-Pay again (409)', String(pay2.status))
    // success
    const o2 = await placeOrder({ method: 'tpay', items: [line(P, 'M', 2)] })
    const ts = await tpay(o2.track, 'success')
    const r2 = await orderRow(o2.track)
    is(!ts.error && r2.pay === 'paid' && (await stocks(P)).M === 8, 'a successful T-Pay payment: paid and no second claim (M 10 -> 8)', `${ts.error ?? ''} ${r2.pay} M=${(await stocks(P)).M}`)
    const rep2 = await get(ts.returnUrl)
    await cron()
    is(rep2.status === 302 && (await stocks(P)).M === 8, 'replay + sweep leave it alone')
    // cancelled at the gateway
    const o3 = await placeOrder({ method: 'tpay', items: [line(P, 'M', 1)] })
    await tpay(o3.track, 'cancelled')
    const r3 = await orderRow(o3.track)
    await cron()
    is(r3.pay === 'failed' && (await stocks(P)).M === 8 && (await orderRow(o3.track)).released === 1, 'cancelled at the gateway: failed, then released once (M 7 -> 8)', `${r3.pay} M=${(await stocks(P)).M}`)
    await invariant('10b T-Pay')
  }

  // ================================================================ 11
  head('11  expiry: cron-stock.php --release')
  {
    const code = `INVCHK${RUN}C`
    await q(`insert into discounts (kind, code, label, type, value, usage_limit, used_count, active)
             values ('code', '${code}', 'invchk', 'percent', 10, 5, 0, 1)`)
    const P = await mkProduct('s11', { M: 40, L: 40 })
    // an old pending COD order with two lines of one variant and a discount code
    const codOld = await placeOrder({ items: [line(P, 'M', 2), line(P, 'M', 3)], discount: code })
    const codYoung = await placeOrder({ items: [line(P, 'L', 1)] })
    const codPacked = await placeOrder({ items: [line(P, 'L', 1)] })
    const knetOld = await placeOrder({ method: 'knet', items: [line(P, 'L', 2)] })
    const knetYoung = await placeOrder({ method: 'knet', items: [line(P, 'L', 3)] })
    const knetPaid = await placeOrder({ method: 'knet', items: [line(P, 'L', 4)] })
    await knetBank(knetPaid.track, 'captured')
    is((await stocks(P)).M === 35 && (await stocks(P)).L === 29 && (await usedCount(code)) === 1, 'setup: M 40 -> 35, L 40 -> 29, one code use', JSON.stringify(await stocks(P)))
    await q(`update orders set fulfilment_status = 'packed' where track_id = '${codPacked.track}'`)
    await age(codOld.track, '25 hour'); await age(codYoung.track, '23 hour'); await age(codPacked.track, '30 hour')
    await age(knetOld.track, '3 hour'); await age(knetYoung.track, '1 hour'); await age(knetPaid.track, '5 hour')
    const before = await orderRow(codOld.track)
    const c1 = await cron()
    const ours = (t) => c1.track_ids.includes(t)
    is(ours(codOld.track) && c1.cod_cancelled.includes(codOld.track), 'the 25 h COD order is cancelled and released', `released ${c1.released}`)
    const co = await orderRow(codOld.track)
    is(co.ful === 'cancelled' && co.released === 1 && co.pay === 'pending', 'it is cancelled + stock_released=1', JSON.stringify(co))
    is((await stocks(P)).M === 40, 'its TWO lines of one variant came back summed: M 35 -> 40, exactly 5 (not 10, not 2)', JSON.stringify(await stocks(P)))
    is((await usedCount(code)) === 0 && co.discRel === 1, 'its discount use went back once (0 of 5)')
    is((await outboxCount(codOld.track, 'cancel')) === 1, 'one "cancel / do not ship" message for the warehouse', String(await outboxCount(codOld.track, 'cancel')))
    is(!ours(codYoung.track) && (await orderRow(codYoung.track)).released === 0, 'a 23 h COD order is left alone')
    is(!ours(codPacked.track) && (await orderRow(codPacked.track)).ful === 'packed' && (await orderRow(codPacked.track)).released === 0, 'a COD order the shop has packed is never touched, at any age')
    is(ours(knetOld.track), 'the 3 h pending KNET order (hold is 120 min) is released')
    const ko = await orderRow(knetOld.track)
    is(ko.released === 1 && ko.pay === 'pending' && ko.ful === 'unfulfilled', 'released but NOT cancelled: it stays pending, unfulfilled', JSON.stringify(ko))
    const pay = await knetPay(knetOld.track)
    is(pay.status === 409, 'and pay.php refuses to take its money (409), so a released order is never charged', String(pay.status))
    is(!ours(knetYoung.track) && (await orderRow(knetYoung.track)).released === 0, 'a 1 h pending KNET order is left alone')
    is(!ours(knetPaid.track) && (await orderRow(knetPaid.track)).released === 0, 'a PAID KNET order is never released, whatever its age')
    is(same(await stocks(P), { L: 29 + 2, M: 40 }), 'L: only the released KNET order came back (29 -> 31)', JSON.stringify(await stocks(P)))
    const m1 = await stocks(P)
    const c2 = await cron()
    is(![codOld, knetOld].some((o) => c2.track_ids.includes(o.track)) && same(m1, await stocks(P)) && (await usedCount(code)) === 0, 'a second run is a no-op: nothing released again, no code use given back twice')
    is((await outboxCount(codOld.track, 'cancel')) === 1, 'and no second cancel message')
    // an old COD order and then a pre-existing one released by hand (cancelled by the sweeper, then the admin saves cancelled again)
    await invariant('11')
  }

  // ================================================================ 12
  head('12  admin cancel / reinstate')
  {
    const P = await mkProduct('s12', { L: 20, M: 20, S: 20 })
    const o = await placeOrder({ items: [line(P, 'L', 2)] })
    const r1 = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: (await orderRow(o.track)).id, status: 'cancelled' } })
    is(r1.status === 200 && r1.body?.ok === true && (await orderRow(o.track)).ful === 'cancelled', 'the admin cancels a COD order', `${r1.status} ${r1.err ?? ''}`)
    info('an admin cancel does not release by itself: the units come back at the next sweep',
         `stock right after the cancel: L=${(await stocks(P)).L} (20 - 2 = 18), stock_released=${(await orderRow(o.track)).released}`)
    is((await stocks(P)).L === 18, 'right after the cancel the shelf still shows 18 (nothing double-released)')
    const c1 = await cron()
    is(c1.track_ids.includes(o.track) && (await stocks(P)).L === 20 && (await orderRow(o.track)).released === 1, 'the sweep releases it once: L 18 -> 20')
    const r2 = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: (await orderRow(o.track)).id, status: 'cancelled' } })
    await cron()
    is(r2.status === 200 && (await stocks(P)).L === 20 && (await outboxCount(o.track, 'cancel')) === 1, 'a SECOND cancel is a no-op: stock 20, one cancel message', `${r2.status} L=${(await stocks(P)).L} cancels=${await outboxCount(o.track, 'cancel')}`)

    // cancel after the sweeper expired it
    const e = await placeOrder({ items: [line(P, 'M', 3)] })
    await age(e.track, '26 hour')
    await cron()
    const eo = await orderRow(e.track)
    is(eo.ful === 'cancelled' && eo.released === 1 && (await stocks(P)).M === 20, 'control: the sweeper expired an old COD order and put its 3 back (M 17 -> 20)')
    const r3 = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: eo.id, status: 'cancelled' } })
    await cron()
    is(r3.status === 200 && (await stocks(P)).M === 20 && (await outboxCount(e.track, 'cancel')) === 1, 'an admin cancel AFTER the expiry is a no-op: M stays 20, still one cancel message', `${r3.status} M=${(await stocks(P)).M}`)

    // cancel is refused where releasing would be wrong
    const paidK = await placeOrder({ method: 'knet', items: [line(P, 'S', 1)] })
    await knetBank(paidK.track, 'captured')
    const rp = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: (await orderRow(paidK.track)).id, status: 'cancelled' } })
    is(rp.status === 409 && rp.err === 'order_paid' && (await stocks(P)).S === 19, 'cancelling a PAID order is refused (order_paid): its unit stays claimed', `${rp.status} ${rp.err}`)
    const shipped = await placeOrder({ items: [line(P, 'S', 1)] })
    const sid = (await orderRow(shipped.track)).id
    await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: sid, status: 'shipped' } })
    const rs = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: sid, status: 'cancelled' } })
    is(rs.status === 409 && rs.err === 'order_already_shipped' && (await stocks(P)).S === 18, 'cancelling a SHIPPED order is refused (order_already_shipped)', `${rs.status} ${rs.err}`)

    // reinstate: cancelled + released -> packed claims again, once
    const re = await placeOrder({ items: [line(P, 'L', 4)] })
    const rid = (await orderRow(re.track)).id
    await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: rid, status: 'cancelled' } })
    await cron()
    const lBefore = (await stocks(P)).L
    const ri = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: rid, status: 'packed' } })
    is(ri.status === 200 && (await stocks(P)).L === lBefore - 4 && (await orderRow(re.track)).released === 0, 'putting a cancelled order back (packed) claims its 4 again, once', `${ri.status} L ${lBefore} -> ${(await stocks(P)).L}`)
    await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: rid, status: 'packed' } })
    await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: rid, status: 'shipped' } })
    is((await stocks(P)).L === lBefore - 4, 'saving it packed/shipped again does not claim again')
    // reinstate refused when the size sold meanwhile
    const re2 = await placeOrder({ items: [line(P, 'M', 10)] })
    const re2id = (await orderRow(re2.track)).id
    await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: re2id, status: 'cancelled' } })
    await cron()
    const taker = await placeOrder({ items: [line(P, 'M', 10)] })
    const taker2 = await placeOrder({ items: [line(P, 'M', 10)] })
    const mNow = (await stocks(P)).M
    const rf = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: re2id, status: 'packed' } })
    is(taker.status === 200 && taker2.status === 200 && rf.status === 409 && /^out_of_stock_/.test(rf.err ?? '') && (await stocks(P)).M === mNow && (await orderRow(re2.track)).ful === 'cancelled',
       'reinstating when the size sold meanwhile is refused with out_of_stock_*; the order stays cancelled and the shelf is untouched', `${rf.status} ${rf.err}`)

    // a card order under REVIEW that holds its units, then cancelled
    const R = await mkProduct('s12r', { M: 10 })
    const rv = await placeOrder({ method: 'knet', items: [line(R, 'M', 2)] })
    await knetBank(rv.track, 'captured', '&amt=0.100')
    const rvr = await orderRow(rv.track)
    const rc = await admin(admin1, 'fulfilment', { method: 'POST', body: { order_id: rvr.id, status: 'cancelled' } })
    await cron()
    const rvr2 = await orderRow(rv.track)
    gap(rvr.pay === 'review' && rc.status === 200 && rvr2.ful === 'cancelled' && rvr2.released === 1 && (await stocks(R)).M === 10,
        'cancelling an order that is under REVIEW gives its units back (M 8 -> 10)',
        `review order cancelled by the admin: fulfilment=${rvr2.ful} stock_released=${rvr2.released} shelf M=${(await stocks(R)).M} — store_stock_release() excludes 'review', so the 2 units stay claimed by a cancelled order for ever`)
    await invariant('12')
  }

  // ================================================================ 13
  head('13  admin stock edits concurrent with checkouts')
  {
    const P = await mkProduct('s13', { M: 80 })
    const sessions = [admin1, await adminSignIn(), await adminSignIn(), await adminSignIn()]
    // deterministic: a stale expected_version is refused, with the current figures
    const v0 = (await snap(P)).M.ver
    await placeOrder({ items: [line(P, 'M', 1)] })
    const stale = await admin(admin1, 'inventory_adjust', { method: 'POST', body: { sku: P.skus.M, type: 'receive', quantity: 5, expected_version: v0, note: 'stale version' } })
    is(stale.status === 409 && stale.err === 'stock_changed' && stale.body.stock === 79 && stale.body.inventory_version === v0 + 1,
       'an edit made on a screen opened before a sale is refused (409 stock_changed) and returns the current figures', `${stale.status} ${stale.err} stock=${stale.body?.stock}`)
    is((await stocks(P)).M === 79, 'and changed nothing')
    // the race
    let conflicts = 0, receivedTotal = 0, damagedTotal = 0
    const adjustLoop = async (s, type, qty, times) => {
      for (let i = 0; i < times; i++) {
        for (let tries = 0; tries < 60; tries++) {
          const v = (await snap(P)).M.ver
          const r = await admin(s, 'inventory_adjust', { method: 'POST', body: { sku: P.skus.M, type, quantity: qty, expected_version: v, note: `race ${type} ${i}` } })
          if (r.status === 200) { if (type === 'receive') receivedTotal += qty; else damagedTotal += qty; break }
          if (r.status === 409 && r.err === 'stock_changed') { conflicts++; continue }
          bad(`inventory_adjust ${type}`, `${r.status} ${r.err}`); break
        }
      }
    }
    const orders = Array.from({ length: 40 }, () => placeOrder({ items: [line(P, 'M', 1)] }))
    const edits = [adjustLoop(sessions[0], 'receive', 2, 6), adjustLoop(sessions[1], 'receive', 3, 4), adjustLoop(sessions[2], 'damage', 1, 5)]
    const legacy = (async () => {
      await sleep(30)
      const v = await admin(sessions[3], 'set_stock', { method: 'POST', body: { sku: P.skus.M, stock: 70 } })
      return v
    })()
    const [res, , lg] = [await Promise.all(orders), await Promise.all(edits), await legacy]
    const okOrders = res.filter((r) => r.status === 200).length
    const other = res.filter((r) => r.status !== 200 && !/^out_of_stock_/.test(r.err ?? ''))
    is(other.length === 0, '40 checkouts raced 15 relative edits and a legacy set_stock: no 5xx, no surprise status', other.slice(0, 3).map((r) => `${r.status} ${r.err}`).join(','))
    is(lg.status === 200, 'the legacy absolute set_stock (no expected_version) lands', `${lg.status} ${lg.err ?? ''}`)
    const lgr = await ledger(P)
    const setRow = lgr.find((r) => r[1] === 'legacy_set_stock')
    is(!!setRow && setRow[3] === '70' && Number(setRow[4]) === 70 - Number(setRow[2]), 'its ledger row is internally exact: after 70, delta = 70 - the stock it really replaced', JSON.stringify(setRow))
    info('the legacy set_stock is an ABSOLUTE write: it overwrites the units held by unshipped orders as if they were not there',
         `${okOrders} orders were placed; the screen's count (70) replaced the shelf at one instant`)
    info(`optimistic locking under load: ${conflicts} edit attempts met a 409 stock_changed and were retried`, `received ${receivedTotal}, damaged ${damagedTotal}`)
    await invariant('13')
  }

  // ================================================================ 14
  head('14a  30 customers, the last 5 units of one size')
  {
    const run30 = async (label, make, expectOk, expectLeft) => {
      const P = await mkProduct(`s14${label}`, { M: 5, L: 5 })
      const res = await Promise.all(Array.from({ length: 30 }, (_, i) => placeOrder(make(P, i))))
      const okN = res.filter((r) => r.status === 200).length
      const oos = res.filter((r) => r.status === 409 && new RegExp(`^out_of_stock_${P.slug}_M_\\d+$`).test(r.err ?? '')).length
      const odd = res.filter((r) => r.status !== 200 && !(r.status === 409 && /^out_of_stock_/.test(r.err ?? '')))
      is(okN === expectOk && oos === 30 - expectOk && odd.length === 0, `${label}: exactly ${expectOk} succeed, ${30 - expectOk} get out_of_stock`, `ok=${okN} out_of_stock=${oos} other=${odd.map((r) => `${r.status}${r.err}`).join(',')}`)
      is((await stocks(P)).M === expectLeft && (await stocks(P)).L === 5, `${label}: stock ends at exactly ${expectLeft} (never negative); L untouched`, JSON.stringify(await stocks(P)))
      const claimedUnits = Number(await one(`select coalesce(sum(oi.qty),0) from order_items oi join orders o on o.id = oi.order_id where oi.product_id = ${P.id} and o.stock_claimed = 1`))
      is(claimedUnits === 5 - expectLeft && Number(await one(`select count(distinct oi.order_id) from order_items oi where oi.product_id = ${P.id}`)) === expectOk, `${label}: units on the accepted orders = 5 - ${expectLeft}; one order row per success`, `${claimedUnits}`)
      is((await avail(P)).M.stock === expectLeft, `${label}: availability API agrees`)
      return P
    }
    await run30('cod1', (P) => ({ items: [line(P, 'M', 1)] }), 5, 0)
    await run30('cod2', (P) => ({ items: [line(P, 'M', 2)] }), 2, 1)
    await run30('mixed', (P, i) => ({ method: ['cod', 'knet', 'tpay'][i % 3], items: [line(P, 'M', 1)] }), 5, 0)
    const lg = await ledger(products.find((p) => p.tag === 's14cod1'))
    gap(lg.length === 5, 'the ledger holds one row per accepted order (5)', `${lg.length} rows`)
    await invariant('14a')
  }

  head('14b  carts in opposite line order (A,B vs B,A)')
  {
    let total500 = 0, totalOk = 0
    for (let round = 1; round <= 4; round++) {
      const A = await mkProduct(`s14ab${round}a`, { M: 30, S: 30 })
      const B = await mkProduct(`s14ab${round}b`, { M: 30, S: 30 })
      const mixSizes = round >= 3 // rounds 3-4: same product, different sizes, opposite order
      const make = (i) => mixSizes
        ? { items: i % 2 ? [line(A, 'M'), line(A, 'S')] : [line(A, 'S'), line(A, 'M')] }
        : { items: i % 2 ? [line(A, 'M'), line(B, 'M')] : [line(B, 'M'), line(A, 'M')] }
      const res = await Promise.all(Array.from({ length: 60 }, (_, i) => placeOrder(make(i))))
      const okN = res.filter((r) => r.status === 200).length
      const fail500 = res.filter((r) => r.status >= 500)
      const refused = res.filter((r) => r.status === 409 && /^out_of_stock_/.test(r.err ?? '')).length
      const weird = res.filter((r) => r.status !== 200 && r.status < 500 && !(r.status === 409 && /^out_of_stock_/.test(r.err ?? '')))
      total500 += fail500.length; totalOk += okN
      const sa = await stocks(A), sb = await stocks(B)
      const consistent = mixSizes ? sa.M === 30 - okN && sa.S === 30 - okN : sa.M === 30 - okN && sb.M === 30 - okN
      is(weird.length === 0 && okN + fail500.length + refused === 60, `round ${round} (${mixSizes ? 'one product, sizes M/S in opposite order' : 'two products in opposite order'}): every request answered 200 / 409 out_of_stock / 5xx only`, `ok=${okN} out_of_stock=${refused} 5xx=${fail500.length} other=${weird.map((r) => r.status).join(',')}`)
      is(consistent, `round ${round}: the final stock equals 30 minus the successful orders on every line (no half-claim survived)`, JSON.stringify([sa, sb]))
      is(Math.min(sa.M, mixSizes ? sa.S : sb.M) >= 0, `round ${round}: never negative`)
      if (fail500.length) info(`round ${round}: ${fail500.length} order(s) answered ${fail500[0].status} ${fail500[0].err} — a deadlock victim is rolled back, never retried`, `${okN} of 60 succeeded while ${60 - okN - refused} were lost to deadlocks: the shelf had ${mixSizes ? sa.M : sb.M} left of 30`)
    }
    // with PLENTY of stock every cart should succeed: any 5xx here is a customer turned away for nothing
    let lost = 0
    for (let round = 1; round <= 3; round++) {
      const A = await mkProduct(`s14pl${round}a`, { M: 100 })
      const B = await mkProduct(`s14pl${round}b`, { M: 100 })
      const res = await Promise.all(Array.from({ length: 40 }, (_, i) => placeOrder({ items: i % 2 ? [line(A, 'M'), line(B, 'M')] : [line(B, 'M'), line(A, 'M')] })))
      const okN = res.filter((r) => r.status === 200).length
      const f5 = res.filter((r) => r.status >= 500)
      lost += f5.length
      const sa = (await stocks(A)).M, sb = (await stocks(B)).M
      is(sa === 100 - okN && sb === 100 - okN && res.every((r) => r.status === 200 || r.status >= 500), `plenty-of-stock round ${round}: 40 carts, A,B vs B,A: both shelves fell by exactly the ${okN} accepted orders`, `ok=${okN} 5xx=${f5.length} A=${sa} B=${sb}`)
    }
    total500 += lost
    gap(lost === 0, 'with plenty of stock no customer is turned away by a deadlock', `${lost} of 120 customers got a 5xx ${'`failed`'} although both shelves held 100 units`)
    gap(total500 === 0, 'no order is lost to a deadlock (5xx) when carts claim lines in opposite order', `${total500} of 360 requests answered 5xx (the claim has no retry on a deadlock and does not order cart lines)`)
    await invariant('14b')
  }

  head('14c  a customer double-submitting')
  {
    // the same attempt (same track_id) twice, and six times, at once
    for (const n of [2, 6]) {
      const P = await mkProduct(`s14dup${n}`, { M: 10 })
      const track = nextTrack(), phone = nextPhone(), ip = nextIp()
      const res = await Promise.all(Array.from({ length: n }, () => placeOrder({ track, phone, ip, items: [line(P, 'M', 2)] })))
      const statuses = res.map((r) => r.status).join(',')
      const ids = new Set(res.filter((r) => r.status === 200).map((r) => r.body.order_id))
      const orders = Number(await one(`select count(*) from orders where track_id = '${track}'`))
      is(orders === 1 && (await stocks(P)).M === 8, `the same attempt sent ${n}x at once: ONE order, claimed ONCE (M 10 -> 8)`, `statuses ${statuses}; stock ${(await stocks(P)).M}`)
      is(res.every((r) => r.status === 200) && ids.size === 1, `all ${n} answers are the one order (idempotent), none is an error`, `${statuses} ids ${[...ids].join(',')}`)
    }
    // the same attempt, different IPs (a retry through another network)
    {
      const P = await mkProduct('s14dupip', { M: 10 })
      const track = nextTrack(), phone = nextPhone()
      const res = await Promise.all(Array.from({ length: 4 }, () => placeOrder({ track, phone, items: [line(P, 'M', 2)] })))
      is(Number(await one(`select count(*) from orders where track_id = '${track}'`)) === 1 && (await stocks(P)).M === 8, 'the same attempt from four addresses at once: one order, claimed once', res.map((r) => r.status).join(','))
    }
    // the same phone, different attempts, cooldown OFF: only the open-COD cap (3) limits it
    {
      const P = await mkProduct('s14phone', { M: 20 })
      const phone = nextPhone()
      const res = await Promise.all(Array.from({ length: 6 }, () => placeOrder({ phone, items: [line(P, 'M', 1)] })))
      const okN = res.filter((r) => r.status === 200).length
      const capped = res.filter((r) => r.err === 'too_many_open_cod').length
      is(okN === 3 && capped === 3 && (await stocks(P)).M === 17, 'one phone, six DIFFERENT COD attempts at once: exactly 3 open (the cap), 3 too_many_open_cod; stock 20 -> 17', `ok=${okN} capped=${capped} stock=${(await stocks(P)).M}`)
    }
    // the cooldown store: one order a minute per phone and per client
    const cd = await fetch(`${API_CD}/api.php?r=checkout_config`).then((r) => r.ok).catch(() => false)
    if (!cd) info('cooldown races skipped: INV_API_CD is not reachable', API_CD)
    else {
      for (const [label, method] of [['COD', 'cod'], ['KNET', 'knet']]) {
        let leaks = 0, rounds = 0, inconsistent = 0
        for (let i = 0; i < 5; i++) {
          rounds++
          const P = await mkProduct(`s14cd${method}${i}`, { M: 20 })
          const phone = nextPhone()
          const res = await Promise.all(Array.from({ length: 8 }, () => placeOrder({ base: API_CD, method, phone, ip: nextIp(), items: [line(P, 'M', 1)] })))
          const okN = res.filter((r) => r.status === 200).length
          const cool = res.filter((r) => r.status === 429 && r.err === 'previous_order_pending').length
          if ((20 - (await stocks(P)).M) !== okN || okN + cool !== 8) inconsistent++
          if (okN !== 1) leaks++
        }
        is(inconsistent === 0, `${label}, one phone from 8 addresses at once, cooldown 60 s, ${rounds} rounds: the stock claimed always equals the orders accepted`, `${inconsistent} inconsistent rounds`)
        gap(leaks === 0, `${label}: exactly one order is accepted for one phone from 8 addresses at once (${rounds} rounds)`,
            `${leaks} of ${rounds} rounds accepted more than one — the phone check of a ${label} order is not serialised, each transaction reads its snapshot before the others commit. Stock stays consistent; the 60 s rule leaks.`)
      }
      const P = await mkProduct('s14cdip', { M: 20 })
      const ip = nextIp()
      const res = await Promise.all(Array.from({ length: 8 }, () => placeOrder({ base: API_CD, method: 'knet', ip, items: [line(P, 'M', 1)] })))
      const okN = res.filter((r) => r.status === 200).length
      is(okN === 1 && (await stocks(P)).M === 19, 'one address, eight different phones at once, cooldown 60 s: exactly one accepted, claimed once', `ok=${okN} stock=${(await stocks(P)).M}`)
    }
    await invariant('14c')
  }

  head('14d  checkout racing an admin cancel and the cron release')
  {
    const P = await mkProduct('s14d', { M: 6 })
    const X = await placeOrder({ items: [line(P, 'M', 3)] })
    const Y = await placeOrder({ items: [line(P, 'M', 3)] })
    is((await stocks(P)).M === 0, 'setup: the shelf is empty (two COD orders of 3)')
    const xid = (await orderRow(X.track)).id
    const pick = () => adminSessions[Math.floor(Math.random() * adminSessions.length)]
    // 12 buyers keep trying (up to 60 x 40 ms) until they win a unit; at the same
    // moment 3 admin cancels of X and 4 sweeps start. X's 3 units are freed ONCE,
    // so exactly 3 buyers can win — a double release would let 6 win.
    let tries = 0
    const buyer = async () => {
      for (let i = 0; i < 60; i++) {
        const r = await placeOrder({ items: [line(P, 'M', 1)] })
        tries++
        if (r.status === 200) return r
        if (r.status >= 500) return r
        await sleep(40)
      }
      return null
    }
    const buyers = Array.from({ length: 12 }, buyer)
    const cancels = Array.from({ length: 3 }, () => admin(pick(), 'fulfilment', { method: 'POST', body: { order_id: xid, status: 'cancelled' } }))
    const crons = Array.from({ length: 4 }, async (_, i) => { await sleep(i * 120); return cron() })
    const [cres, , bres] = [await Promise.all(cancels), await Promise.all(crons), await Promise.all(buyers)]
    await cron()
    const bad5 = bres.filter((r) => r && r.status >= 500)
    const won = bres.filter((r) => r && r.status === 200).length
    const xr = await orderRow(X.track)
    is(cres.every((r) => r.status === 200) && xr.ful === 'cancelled', '3 concurrent cancels of one order all answer 200; it is cancelled', cres.map((r) => r.status).join(','))
    is(xr.released === 1 && Number(await one(`select count(*) from fulfilment_outbox f where f.order_id = ${xid} and f.kind = 'cancel'`)) === 1, 'released exactly once and ONE cancel message, despite 3 cancels and 4 sweeps')
    is(bad5.length === 0, 'no buyer got a 5xx while the order was cancelled and released under them', `${tries} attempts`)
    is(won === 3 && (await stocks(P)).M === 0, 'exactly the 3 freed units were sold, to 3 of the 12 buyers: a double release would have sold 6', `won=${won} shelf=${(await stocks(P)).M}`)
    void Y
    await invariant('14d cancel/cron')

    // a late bank CAPTURED racing the sweeper on an aged KNET order: one of two outcomes, never a mix
    const outcomes = {}
    let mix = 0
    for (let i = 0; i < 6; i++) {
      const Q = await mkProduct(`s14k${i}`, { M: 4 })
      const o = await placeOrder({ method: 'knet', items: [line(Q, 'M', 2)] })
      await age(o.track, '3 hour')
      await Promise.all([cron(), knetCallback(o.track, 'CAPTURED', fmt3(o.body.amount)), cron()])
      const r = await orderRow(o.track)
      const key = `${r.pay}/released=${r.released}`
      outcomes[key] = (outcomes[key] ?? 0) + 1
      const shelf = (await stocks(Q)).M
      const consistent = (r.pay === 'paid' && r.released === 0 && shelf === 2) || (r.pay === 'review' && r.released === 1 && shelf === 4)
      if (!consistent) mix++
    }
    is(mix === 0, 'a bank CAPTURED racing the sweeper ends either paid+held or review+released, never paid+released or held+released (6 rounds)', JSON.stringify(outcomes))
    await invariant('14d capture/sweep')
  }

  head('15  the invariant, over everything this run did')
  {
    await invariant('final')
    const chain = []
    for (const p of products) for (const size of Object.keys(p.skus)) {
      const m = await rows(`select before_stock, after_stock, delta from inventory_movements where sku = '${p.skus[size]}' order by id`)
      for (let i = 1; i < m.length; i++) if (m[i][0] !== m[i - 1][1]) { chain.push(`${p.tag}/${size}`); break }
    }
    gap(chain.length === 0, 'the ledger replays as one unbroken chain (each row\'s before == the previous row\'s after)',
        `${chain.length} variant(s) with a break, e.g. ${chain.slice(0, 3).join(', ')} — sales and releases move the stock between ledger rows without writing one`)
    const dead = Number(await one(`select count(*) from orders o join order_items oi on oi.order_id = o.id join products p on p.id = oi.product_id
      where p.slug like 'invchk-${RUN}-%' and o.stock_claimed = 1 and o.stock_released = 0
        and (o.payment_status = 'failed' or o.fulfilment_status = 'cancelled') and o.payment_status <> 'review'`))
    is(dead === 0, 'after the sweeps, no failed or cancelled (non-review) order of this run still holds units', String(dead))
    const held = await rows(`select o.track_id, o.payment_status, o.fulfilment_status, o.stock_released from orders o join order_items oi on oi.order_id = o.id
      join products p on p.id = oi.product_id where p.slug like 'invchk-${RUN}-%' and o.payment_status = 'review' and o.fulfilment_status = 'cancelled' and o.stock_released = 0 group by o.id`)
    gap(held.length === 0, 'no cancelled order is left owning units because it was under review', `${held.length} order(s)`)
  }
} catch (e) {
  bad('the suite crashed', String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '))
} finally {
  await cleanup()
}

const secs = Math.round((Date.now() - started) / 1000)
console.log(`\n${passes} ok, ${fails} FAIL, ${gaps} GAP (known, unfixed), ${infos} info — ${secs}s`)
if (gaps) console.log('GAPs are real behaviour, printed every run; INV_STRICT_LEDGER=1 makes them fatal.')
if (env.INV_REPORT) writeFileSync(env.INV_REPORT, JSON.stringify({ run: RUN, passes, fails, gaps, infos, secs, results }, null, 1))
process.exit(fails > 0 || (STRICT && gaps > 0) ? 1 : 0)
