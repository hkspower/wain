// The native PHP + MySQL backend, end to end against the real stack:
// MariaDB loaded from schema.mysql.sql + seed.mysql.sql, PHP 8 serving
// dropin/php-store. No mocks anywhere — the point of this suite is that the
// native backend enforces the SAME contract as the Supabase one, token for
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
    is(body?.error === want, `${name} is rejected with the same token as Supabase`, body?.error)
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

console.log(fails ? `\n${fails} problem(s) in the native backend` : '\nnative backend: same contract, no Supabase')
process.exit(fails ? 1 : 0)
