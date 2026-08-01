// The native PHP + MySQL backend, end to end against the real stack:
// MariaDB loaded from schema.mysql.sql + seed.mysql.sql, PHP 8 serving
// dropin/php-store. No mocks anywhere — the point of this suite is that the
// backend enforces the SAME contract the frontend expects, token for
// token, because the storefront's error messages and the admin's screens are
// written against that contract.
//
//   npm run test:native     (needs MariaDB up and `php -S 127.0.0.1:8095`)
const BASE = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))

const api = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/api.php?r=${route}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// The admin API needs the session cookie carried between calls, which fetch
// does not do on its own in Node — a one-line jar is enough.
let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Sporta-Admin': '1',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers ?? {}),
    },
    method: opts.method ?? 'GET',
    body: opts.body,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}

// A clean slate, so the suite can run twice in a row: previous orders would
// otherwise trip the idempotency guard, and the throttle section deliberately
// leaves the admin account locked.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
await run('mariadb', ['sporta', '-e',
  'delete from fulfilment_outbox; delete from order_items; delete from orders; ' +
  'update admin_users set failed_attempts = 0, locked_until = null; ' +
  "delete from admin_users where email <> 'cs@sporta.com.kw'; " +
  // the brand this suite creates, so a second run starts from the seed again
  "delete from brands where slug in ('test-brand','renamed');"])

const CUSTOMER = {
  name: 'Fatima Al-Sabah', phone: '٩٩٨٨٧٧٦٦', governorate: 'hawalli', area: 'Salmiya',
  block: '4', street: '12', building: '5', floor: '3', flat: '7', note: 'Ring twice',
}
const order = (track, items, extra = {}) =>
  api('order', {
    method: 'POST',
    body: JSON.stringify({ track_id: track, items, customer: CUSTOMER, payment_method: 'knet', ...extra }),
  })

// ------------------------------------------------------------------ catalogue
{
  const { body } = await api('products')
  is(Array.isArray(body) && body.length === 46, 'the catalogue is served', `${body?.length} products`)
  is(body.every((p) => typeof p.price === 'number'), 'prices are numbers, not strings')
  is(body.some((p) => /جاكيت/.test(p.name_ar)), 'Arabic names survive MySQL (utf8mb4)')

  const { body: stock } = await api('stock')
  is(stock.length === 42 && 'in_stock' in stock[0], 'stock has the product_stock view shape', `${stock.length} rows`)
  is(!JSON.stringify(stock).includes('cost'), 'the public stock endpoint never leaks the wholesale cost')
}

// ---------------------------------------------------------------- create order
{
  const { status, body } = await order('SPNAT0001', [
    { slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'l', fit: 'Oversize' },
    { slug: 'cagliari-calcio-backpack', qty: 1 },
  ])
  is(status === 200 && body.track_id === 'SPNAT0001', 'an order is created', JSON.stringify(body))
  // 2 × 10.000 + 4.000 — priced from the TABLE. The request carried no price.
  is(body.amount === 24, 'the amount is computed server-side from stored prices', `${body.amount}`)

  const again = await order('SPNAT0001', [{ slug: 'cagliari-calcio-backpack', qty: 9 }])
  is(again.body.amount === 24 && again.body.order_id === body.order_id,
     'the same track id returns the SAME order — a double tap cannot buy twice',
     `still ${again.body.amount}`)

  const { body: inv } = await api('invoice&id=SPNAT0001')
  is(inv.items.length === 2 && inv.items.some((i) => i.size === 'L' && i.fit === 'oversize'),
     "the invoice carries size and fit, case-normalised ('l'/'Oversize' in)", JSON.stringify(inv.items[1] ?? {}))
  is(!JSON.stringify(inv).includes('9988'), 'the invoice does not return the phone number')

  const { body: st } = await api('status&id=SPNAT0001')
  is(st.payment_status === 'pending' && st.amount === 24, 'status works by order number')
}

// ------------------------------------------------------------------ validation
{
  const cases = [
    ['bad track id', order('x!', [{ slug: 'cagliari-calcio-backpack', qty: 1 }]), 'invalid_track_id'],
    ['empty cart', order('SPNATV001', []), 'empty_cart'],
    ['qty 0', order('SPNATV002', [{ slug: 'cagliari-calcio-backpack', qty: 0 }]), 'invalid_qty'],
    ['unknown product', order('SPNATV003', [{ slug: 'no-such-thing', qty: 1 }]), 'unavailable_no-such-thing'],
    ['made-up size', order('SPNATV004', [{ slug: 'cheetahs-rugby-t-shirt', qty: 1, size: 'XXS' }]), 'invalid_size'],
    ['made-up fit', order('SPNATV005', [{ slug: 'cheetahs-rugby-t-shirt', qty: 1, fit: 'skintight' }]), 'invalid_fit'],
  ]
  for (const [name, p, want] of cases) {
    const { body } = await p
    is(body?.error === want, `${name} is rejected with the documented token`, body?.error)
  }

  const badPhone = await api('order', {
    method: 'POST',
    body: JSON.stringify({ track_id: 'SPNATV006', items: [{ slug: 'cagliari-calcio-backpack', qty: 1 }],
      customer: { ...CUSTOMER, phone: '12345678' } }),
  })
  is(badPhone.body?.error === 'invalid_phone', 'a non-Kuwaiti number is rejected', badPhone.body?.error)
}

// -------------------------------------------------------------------- outbox
{
  const codRes = await order('SPNATCOD1', [{ slug: 'cheetahs-rugby-t-shirt', qty: 1, size: 'M' }],
    { payment_method: 'cod' })
  is(codRes.status === 200, 'a cash order is created')
}

// ---------------------------------------------------------------- admin: auth
{
  const anon = await admin('orders')
  is(anon.status === 401, 'the admin API refuses without a session', `${anon.status}`)

  const wrong = await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'wrong-password' }) })
  is(wrong.status === 401 && wrong.body?.error === 'bad_credentials', 'a wrong password is refused')

  const right = await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })
  is(right.status === 200 && right.body?.email === 'cs@sporta.com.kw', 'the right password signs in')

  const me = await admin('me')
  is(me.body?.email === 'cs@sporta.com.kw', 'the session survives across requests')
}

// -------------------------------------------------------------- admin: orders
{
  const { body: orders } = await admin('orders')
  is(orders.length >= 2 && orders[0].track_id, 'the admin sees the orders', `${orders.length} orders`)

  const cod = orders.find((o) => o.payment_method === 'cod')
  const { body: items } = await admin(`items&order=${orders[0].id}`)
  is(items[0]?.products?.name_en !== undefined, 'items come with the nested product names the UI renders')

  // Cash settles; cards must not be settleable by hand.
  const card = orders.find((o) => o.payment_method === 'knet')
  const refuse = await admin('cod_paid', { method: 'POST',
    body: JSON.stringify({ order_id: card.id, paid: true }) })
  is(refuse.body?.error === 'not_a_cash_order',
     'a card order cannot be marked paid by an admin — only the bank confirms cards')

  const settle = await admin('cod_paid', { method: 'POST',
    body: JSON.stringify({ order_id: cod.id, paid: true }) })
  is(settle.body?.payment_status === 'paid' && settle.body?.paid_at, 'a cash order settles with paid_at')

  const ful = await admin('fulfilment', { method: 'POST',
    body: JSON.stringify({ order_id: cod.id, status: 'shipped' }) })
  is(ful.body?.ok === true, 'fulfilment status updates')

  const { body: stats } = await admin('stats')
  is(Number(stats.paid_count) === 1 && Number(stats.paid_revenue) === 8,
     'the stats see the settled cash order', `paid=${stats.paid_count} revenue=${stats.paid_revenue}`)
  is('cod_awaiting_count' in stats && 'revenue_7d' in stats, 'stats carry the exact keys Overview reads')
}

// --------------------------------------------------------------- admin: stock
{
  const set = await admin('set_stock', { method: 'POST',
    body: JSON.stringify({ sku: 'A-CSJ-AR-L', stock: 7 }) })
  is(set.body?.stock === 7, 'stock moves through the admin')
  const neg = await admin('set_stock', { method: 'POST',
    body: JSON.stringify({ sku: 'A-CSJ-AR-L', stock: -1 }) })
  is(neg.body?.error === 'stock_cannot_be_negative', 'negative stock is refused with the familiar token')
  const ghost = await admin('set_stock', { method: 'POST',
    body: JSON.stringify({ sku: 'A-NOPE-1', stock: 1 }) })
  is(ghost.body?.error === 'sku_not_found', 'an unknown SKU is named, not silently ignored')
  const { body: variants } = await admin('variants')
  is(variants.some((v) => v.cost_aed != null), 'the ADMIN variants do include the wholesale cost')
}

// -------------------------------------------------------------------- brands
{
  const { body: list } = await admin('brands')
  is(Array.isArray(list) && list.length >= 8, 'the admin sees the seeded brands', `${list?.length}`)

  const made = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ name_en: 'Test Brand', name_ar: 'علامة', sort: 99 }) })
  is(made.body?.slug === 'test-brand', 'a new brand is created, slug derived from the name', made.body?.slug)
  const id = made.body?.id

  const dupe = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ name_en: 'Test Brand', name_ar: 'علامة' }) })
  is(dupe.body?.error === 'slug_taken', 'two brands cannot share one web name', dupe.body?.error)

  const renamed = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ id, slug: 'test-brand', name_en: 'Renamed', name_ar: 'مُعاد' }) })
  is(renamed.body?.name_en === 'Renamed', 'a brand can be renamed')
  is(renamed.body?.logo === null, 'and omitting the logo leaves it alone')

  // A 1x1 PNG, the smallest real image there is.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const withLogo = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ id, slug: 'test-brand', name_en: 'Renamed', name_ar: 'مُعاد', logo: PNG }) })
  is(withLogo.body?.logo?.startsWith('data:image/png;base64,'), 'a logo is stored on the row')

  // The guards. Each of these would otherwise be served from our own origin.
  const svg = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ id, name_en: 'X', name_ar: 'X', logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }) })
  is(svg.body?.error === 'logo_bad_format', 'an SVG logo is refused — it can carry script', svg.body?.error)

  const liar = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ id, name_en: 'X', name_ar: 'X',
      // Padded past the 32-byte sanity floor on purpose, so this reaches the
      // MAGIC NUMBER check rather than being turned away for being too short —
      // the point is that the bytes are inspected, not just the label.
      logo: 'data:image/png;base64,' + Buffer.from(
        '<html><script>alert(1)</script><!-- ' + 'x'.repeat(64) + ' -->').toString('base64') }) })
  is(liar.body?.error === 'logo_not_an_image',
     'a file CLAIMING to be a png is checked against the real magic number', liar.body?.error)

  const huge = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ id, name_en: 'X', name_ar: 'X', logo: 'data:image/png;base64,' + 'A'.repeat(200000) }) })
  is(huge.body?.error === 'logo_too_large', 'an oversized logo is refused', huge.body?.error)

  const noName = await admin('brand_save', { method: 'POST',
    body: JSON.stringify({ name_en: '', name_ar: '' }) })
  is(noName.body?.error === 'missing_name_en', 'a brand needs a name', noName.body?.error)

  // The switch, and what the PUBLIC endpoint does about it.
  const before = await api('brands')
  is(before.body.some((b) => b.slug === 'test-brand'), 'an active brand is public')
  const off = await admin('brand_active', { method: 'POST', body: JSON.stringify({ id, active: false }) })
  is(Number(off.body?.active) === 0, 'a brand can be hidden')
  const after = await api('brands')
  is(!after.body.some((b) => b.slug === 'test-brand'),
     'a hidden brand disappears from the storefront — the switch means something')
  const { body: adminList } = await admin('brands')
  is(adminList.some((b) => b.slug === 'test-brand'),
     'but the ADMIN still sees it, or it could never be turned back on')
  is(!JSON.stringify(after.body).includes('sort'),
     'the public endpoint sends only what a storefront needs')
}

// -------------------------------------------------------------------- throttle
{
  cookie = '' // fresh, signed-out client
  for (let i = 0; i < 5; i++) {
    await admin('login', { method: 'POST',
      body: JSON.stringify({ email: 'brute@example.com', password: `guess-${i}` }) })
  }
  const sixth = await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'brute@example.com', password: 'guess-6' }) })
  // An account that does not exist cannot lock — but a real one must.
  const realLock = await (async () => {
    for (let i = 0; i < 5; i++) {
      await admin('login', { method: 'POST',
        body: JSON.stringify({ email: 'cs@sporta.com.kw', password: `wrong-${i}` }) })
    }
    return admin('login', { method: 'POST',
      body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })
  })()
  is(realLock.status === 429 && realLock.body?.error === 'locked',
     'five failures lock the account — even the RIGHT password waits out the lock',
     `${realLock.status}`)
  void sixth
}

// ---------------------------------------------------------------------------
// A HALF-SET-UP SERVER MUST SAY SO.
//
// Every one of these used to reach the owner as "Wrong email or password",
// because that was the login's only failure branch. The password was fine in
// all three cases; the shop simply was not finished. The owner retypes it,
// gets the same lie, and eventually locks the account they are trying to
// reach. The admin screen keys its setup instructions off these exact tokens,
// so they are contract, not detail.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PROMOTIONS AND DISCOUNTS.
//
// Every check here is about ONE property: the server decides what an order
// costs. A sale price, a coupon and an automatic rule are three more numbers
// the browser would love to name, and orders.amount is what /knet/pay.php
// hands the bank — so anything able to move it is able to move what is
// collected. These are the tests that hold that line.
// ---------------------------------------------------------------------------
// -------------------------------------------------------- sale prices
{
  await run('mariadb', ['sporta', '-e',
    "update products set sale_price = 7.500, sale_starts_at = null, sale_ends_at = null " +
    "where slug = 'cloudsoft-jacket-army-green'"])

  const { body } = await api('products')
  const jacket = body.find((p) => p.slug === 'cloudsoft-jacket-army-green')
  is(jacket.price === 7.5 && jacket.list_price === 10 && jacket.on_sale === true,
     'a live sale replaces `price` and keeps the old one as `list_price`',
     `${jacket.price} was ${jacket.list_price}`)
  is(!('sale_starts_at' in jacket) && !('sale_ends_at' in jacket),
     'the sale WINDOW never reaches the browser — it is not the browser’s decision')

  const paid = await order('SPSALE0001', [{ slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'L' }])
  is(paid.body.amount === 15, 'and CHECKOUT charges the sale price, not the list price', `${paid.body.amount}`)

  // Expired, and dated in the future: both must fall back to the list price.
  for (const [from, to, what] of [
    ["'2020-01-01 00:00:00'", "'2020-02-01 00:00:00'", 'an EXPIRED sale'],
    ["'2099-01-01 00:00:00'", 'null', 'a sale dated in the FUTURE'],
  ]) {
    await run('mariadb', ['sporta', '-e',
      `update products set sale_starts_at = ${from}, sale_ends_at = ${to} where slug = 'cloudsoft-jacket-army-green'`])
    const { body: b2 } = await api('products')
    const j = b2.find((p) => p.slug === 'cloudsoft-jacket-army-green')
    is(j.price === 10 && j.on_sale === false, `${what} is not applied`, `${j.price}`)
  }
  await run('mariadb', ['sporta', '-e',
    "update products set sale_price = null, sale_starts_at = null, sale_ends_at = null " +
    "where slug = 'cloudsoft-jacket-army-green'"])
}

// ---------------------------------------------------------- discounts
{
  await run('mariadb', ['sporta', '-e',
    'delete from orders; delete from discounts; ' +
    "insert into discounts (kind, code, label, type, value, min_order, active) values " +
    "('code','SAVE10','10% welcome','percent',10,5,1), " +
    "('code','TENOFF','10 KWD off','fixed',10,0,1), " +
    "('auto',null,'3 KWD over 30','fixed',3,30,1)"])

  const cart = [{ slug: 'cloudsoft-jacket-army-green', qty: 4, size: 'L' }] // 40.000

  const check = async (code) => {
    const res = await fetch(`${BASE}/api.php?r=discount`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, code }),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  const stacked = await check('SAVE10')
  is(stacked.body.discount === 7 && stacked.body.total === 33,
     'an automatic rule and a code STACK, automatic first', JSON.stringify(stacked.body.applied?.map((a) => a.amount)))

  // Lowercase in, uppercase matched: a customer retyping a code off a poster
  // does not get "invalid" for a capital letter.
  is((await check('save10')).body.discount === 7, 'a code is matched case-insensitively')

  is((await check('NOSUCH')).body.error === 'discount_unknown', 'an unknown code is REPORTED, not ignored')

  // Silently ignoring an unusable code is the failure that costs trust: the
  // customer believes they were given a discount and was not.
  await run('mariadb', ['sporta', '-e', "update discounts set min_order = 999 where code = 'SAVE10'"])
  is((await check('SAVE10')).body.error === 'discount_min_order', 'a code under its minimum says so')
  await run('mariadb', ['sporta', '-e', "update discounts set min_order = 5 where code = 'SAVE10'"])

  await run('mariadb', ['sporta', '-e',
    "update discounts set ends_at = '2020-01-01 00:00:00' where code = 'SAVE10'"])
  is((await check('SAVE10')).body.error === 'discount_expired', 'an expired code says so')
  await run('mariadb', ['sporta', '-e', "update discounts set ends_at = null where code = 'SAVE10'"])

  // ---- the line that matters most ----
  const cheat = await fetch(`${BASE}/api.php?r=order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: 'SPCHEAT001', items: cart, customer: CUSTOMER, payment_method: 'knet',
      amount: 0.1, subtotal: 0.1, discount_amount: 39.9, discount_code: 'SAVE10',
    }),
  })
  const cheated = await cheat.json()
  is(cheated.amount === 33 && cheated.discount === 7,
     'a browser-supplied amount and discount are IGNORED — the server recomputes both',
     `charged ${cheated.amount}`)
  const stored = (await run('mariadb', ['sporta', '-N', '-B', '-e',
    "select amount, subtotal, discount_amount, discount_code from orders where track_id = 'SPCHEAT001'"])).stdout.trim()
  is(stored === '33.000\t40.000\t7.000\tSAVE10', 'and MySQL holds the server’s figures', stored)

  // ---- the stack cap ----
  await run('mariadb', ['sporta', '-e',
    "update discounts set value = 90, type = 'percent' where code = 'SAVE10'; " +
    "update discounts set value = 50, type = 'percent', min_order = 0 where kind = 'auto'"])
  const capped = await check('SAVE10')
  is(capped.body.discount === 24 && capped.body.total === 16,
     'two rules that would give 140% off are capped at 60% of the order',
     `${capped.body.discount} off ${capped.body.subtotal}`)
  await run('mariadb', ['sporta', '-e',
    "update discounts set value = 10 where code = 'SAVE10'; " +
    "update discounts set value = 3, type = 'fixed', min_order = 30 where kind = 'auto'"])

  // ---- single use, under concurrency ----
  await run('mariadb', ['sporta', '-e',
    "delete from orders; " +
    "update discounts set usage_limit = 1, used_count = 0 where code = 'TENOFF'; " +
    // The automatic rule is switched off for this section so the only thing
    // being raced is the single-use code.
    "update discounts set active = 0 where kind = 'auto'"])

  const races = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    fetch(`${BASE}/api.php?r=order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: `SPRACE000${i}`, items: cart, customer: CUSTOMER,
        payment_method: 'knet', discount_code: 'TENOFF',
      }),
    }).then((r) => r.json())))
  const granted = races.filter((r) => r.discount === 10).length
  is(granted === 1, 'eight simultaneous checkouts, one single-use code, exactly ONE gets it', `${granted} granted`)
  const used = (await run('mariadb', ['sporta', '-N', '-B', '-e',
    "select used_count from discounts where code = 'TENOFF'"])).stdout.trim()
  is(used === '1', 'and used_count says 1, not 8', used)

  await run('mariadb', ['sporta', '-e', 'delete from orders; delete from discounts'])
}

// ------------------------------------------------------- hero + settings
{
  const { body } = await api('slides')
  is(Array.isArray(body.slides), 'the slides endpoint answers with a list')
  is(typeof body.hero?.speed_ms === 'number' && body.hero.speed_ms >= 2000,
     'and carries the playback settings', `${body.hero?.speed_ms}ms`)
  is(typeof body.promo_bar?.live === 'boolean',
     'the promo bar’s SCHEDULE is resolved server-side, not left to the browser')
  is(!('starts_at' in (body.promo_bar ?? {})),
     'so its dates never reach the browser at all')
}


// ---------------------------------------------------------------------------
// SECURITY: the two that were wrong, and must not come back.
// ---------------------------------------------------------------------------
// ------------------------------------------- the session cookie behind a proxy
{
  await run('mariadb', ['sporta', '-e',
    'update admin_users set failed_attempts = 0, locked_until = null'])

  // Hostinger terminates TLS at a proxy, so PHP sees plain HTTP on a request
  // the browser made over https://. Reading $_SERVER['HTTPS'] alone left the
  // admin session cookie WITHOUT the Secure flag on the live site.
  const login = async (headers) => {
    const res = await fetch(`${BASE}/admin.php?r=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...headers },
      body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }),
    })
    return res.headers.get('set-cookie') ?? ''
  }

  const behindProxy = await login({ 'X-Forwarded-Proto': 'https' })
  is(/;\s*secure/i.test(behindProxy),
     'behind an SSL-terminating proxy the admin cookie is Secure', behindProxy.split(';').slice(1).join(';').trim())
  is(/HttpOnly/i.test(behindProxy) && /SameSite=Strict/i.test(behindProxy),
     'and still HttpOnly + SameSite=Strict')

  await run('mariadb', ['sporta', '-e',
    'update admin_users set failed_attempts = 0, locked_until = null'])
  const plain = await login({})
  is(!/;\s*secure/i.test(plain),
     'on genuinely plain HTTP it is not, or local development cannot sign in at all')
}

// --------------------------------------------- the discount-code guessing wall
{
  await run('mariadb', ['sporta', '-e',
    'delete from rate_limit; delete from orders; delete from discounts; ' +
    "insert into discounts (kind, code, label, type, value, active) " +
    "values ('code','REALCODE','a code that exists','percent',10,1)"])

  const cart = [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'L' }]
  const check = async (code) => {
    const res = await fetch(`${BASE}/api.php?r=discount`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, code }),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  // A public endpoint that says whether a code is real is an oracle, and an
  // unthrottled oracle is a code generator: SAVE10, SAVE15, SAVE20 …
  let blockedAt = 0
  for (let i = 1; i <= 40 && !blockedAt; i++) {
    const r = await check(`NOPE${i}`)
    if (r.body?.error === 'too_many_attempts') blockedAt = i
  }
  is(blockedAt > 0 && blockedAt <= 35, 'guessing discount codes is cut off', `blocked on attempt ${blockedAt}`)
  is((await check('NOPE99')).status === 429, 'and stays cut off, with 429')

  // The whole point of counting only FAILURES: a customer whose code works is
  // not attacking anything, and throttling them breaks the feature to protect it.
  const real = await check('REALCODE')
  is(real.body?.discount === 1,
     'but a REAL code still works from the same address — only failures are counted',
     JSON.stringify(real.body?.applied?.[0]?.code))

  await run('mariadb', ['sporta', '-e', 'delete from rate_limit; delete from discounts'])
}


// ------------------------------------------------ a half-set-up server
{
  cookie = ''
  await run('mariadb', ['sporta', '-e',
    'create table if not exists admin_users_probe like admin_users; ' +
    'delete from admin_users_probe; ' +
    'insert into admin_users_probe select * from admin_users; delete from admin_users;'])

  const me = await admin('me')
  is(me.status === 409 && me.body?.error === 'no_admin_account',
     'with no account, ?r=me says so BEFORE a password is ever typed',
     `${me.status} ${me.body?.error}`)

  const login = await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })
  is(login.status === 409 && login.body?.error === 'no_admin_account',
     'and the RIGHT password is not called wrong — it is nobody’s password yet',
     `${login.status} ${login.body?.error}`)

  await run('mariadb', ['sporta', '-e',
    'insert into admin_users select * from admin_users_probe; drop table admin_users_probe; ' +
    'update admin_users set failed_attempts = 0, locked_until = null;'])

  // A table that was never imported is not an outage, and the fix is different.
  await run('mariadb', ['sporta', '-e', 'rename table admin_users to admin_users_hidden;'])
  const missing = await admin('me')
  is(missing.status === 503 && missing.body?.error === 'no_table',
     'a database with no tables reports no_table, not a generic failure',
     `${missing.status} ${missing.body?.error}`)
  is(!/admin_users|SQLSTATE|select /i.test(JSON.stringify(missing.body)),
     'and the reply names no table, no SQL and no database',
     JSON.stringify(missing.body))
  await run('mariadb', ['sporta', '-e', 'rename table admin_users_hidden to admin_users;'])

  const back = await admin('me')
  is(back.status === 200, 'everything answers normally again afterwards', `${back.status}`)
}

// ------------------------------------ config.php that MySQL will not accept
//
// The most common way a live install is broken, and for a long time the worst
// reported: a typo in db_pass threw out of `new PDO`, the exception handler
// flattened it to the generic 'failed', the admin had no branch for that, and
// it fell through to the last message on the list — "Wrong email or password."
// So the owner retyped a CORRECT password five times and locked the account
// for fifteen minutes over a wrong DATABASE password.
//
// Each of the four values is broken in turn, against a throwaway PHP server so
// the suite's own backend is never touched. MySQL says which one is wrong and
// the reply has to pass that on, because the fix differs: a bad db_name is a
// different hPanel screen from a bad db_host.
{
  const { mkdtempSync, cpSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawn } = await import('node:child_process')

  const dir = mkdtempSync(join(tmpdir(), 'sporta-badcfg-'))
  cpSync(new URL('../dropin/php-store', import.meta.url).pathname, dir, { recursive: true })

  const good = { db_host: 'localhost', db_name: 'sporta', db_user: 'sporta', db_pass: 'test-pass' }
  const cases = [
    ['db_pass', { db_pass: 'not-the-password' }, /db_user or db_pass/],
    ['db_name', { db_name: 'no_such_database_here' }, /db_name|privileges/],
    ['db_host', { db_host: '10.255.255.1' }, /db_host/],
  ]

  let port = 8241
  for (const [label, override, wants] of cases) {
    const cfg = { ...good, ...override, cron_key: 'x'.repeat(24) }
    // Hand-built, not JSON.stringify with the quotes swapped: PHP wants
    // `['k' => 'v']`, and `{"k":"v"}` is a parse error that shows up as the
    // generic failure this very test is here to rule out.
    writeFileSync(join(dir, 'config.php'),
      `<?php return [\n` +
      Object.entries(cfg).map(([k, v]) => `  '${k}' => '${v}',`).join('\n') +
      `\n];\n`)
    const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore' })
    let body = null, status = 0
    for (let i = 0; i < 40 && status === 0; i++) {
      await new Promise((r) => setTimeout(r, 150))
      try {
        const res = await fetch(`http://127.0.0.1:${port}/admin.php?r=me`,
                                { headers: { 'X-Sporta-Admin': '1' } })
        status = res.status
        body = await res.json().catch(() => null)
      } catch { /* still starting */ }
    }
    srv.kill()
    is(body?.error === 'db_unreachable',
       `a wrong ${label} says the DATABASE is unreachable, not that the password is wrong`,
       `${status} ${JSON.stringify(body)}`)
    is(wants.test(body?.cause ?? ''),
       `and names which value to fix`, body?.cause ?? '(none)')
    is(!/test-pass|SQLSTATE|Access denied/i.test(JSON.stringify(body)),
       'without echoing the credential or the driver error', JSON.stringify(body))
    port++
  }
  rmSync(dir, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} problem(s) in the native backend` : '\nnative backend: every check passed')
process.exit(fails ? 1 : 0)
