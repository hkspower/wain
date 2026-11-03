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
  // the brands (and the hidden product) this suite creates, so a second run
  // starts from the seed again even if a previous one was killed mid-way
  "update products set brand_slug = null where brand_slug like 'test-assign%'; " +
  "delete from products where slug = 'test-assign-hidden-product'; " +
  "delete from brands where slug in ('test-brand','renamed') or slug like 'test-assign%';"])

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

  // Only LISTED products. A switched-off product's sizes and counts, and the
  // variants of a product whose row is gone, are not shop-window data — the
  // live feed carried five such rows until the JSON scan counted them.
  const hidden = stock[0].slug
  const hiddenRows = stock.filter((r) => r.slug === hidden).length
  await run('mariadb', ['sporta', '-e',
    `update products set active = 0 where slug = '${hidden}'; ` +
    "insert into product_variants (sku, slug, size, stock) values ('ORPHAN-TEST', 'no-such-product', 'm', 5)"])
  const { body: listed } = await api('stock')
  is(!listed.some((r) => r.slug === hidden) && listed.length === 42 - hiddenRows,
     'a product switched off in the admin takes its stock rows out of the public feed', `${listed.length} rows`)
  is(!listed.some((r) => r.sku === 'ORPHAN-TEST'), 'variants with no product row are not served either')
  await run('mariadb', ['sporta', '-e',
    `update products set active = 1 where slug = '${hidden}'; delete from product_variants where sku = 'ORPHAN-TEST'`])
  is((await api('stock')).body.length === 42, 'and switching it back on restores them')
}

// ---------------------------------------------------------------- create order
{
  const { status, body } = await order('SPNAT0001', [
    { slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'l', fit: 'Oversize' },
    { slug: 'cagliari-calcio-backpack', qty: 1 },
  ])
  is(status === 200 && body.track_id === 'SPNAT0001', 'an order is created', JSON.stringify(body))
  // 2 × 10.000 + 4.000 — priced from the TABLE. The request carried no price.
  // 2 x 10.000 + 4.000 of goods, then DELIVERY on top: 24 + 1 = 25. The fee is
  // added after the discount and is never discounted — see STORE_DELIVERY_FEE_FILS.
  is(body.amount === 25, 'the amount is computed server-side from stored prices, delivery included', `${body.amount}`)
  is(body.delivery === 1, 'and the 1.000 KWD delivery fee is named in the answer', `${body.delivery}`)

  const again = await order('SPNAT0001', [{ slug: 'cagliari-calcio-backpack', qty: 9 }])
  is(again.body.amount === 25 && again.body.order_id === body.order_id,
     'the same track id returns the SAME order — a double tap cannot buy twice',
     `still ${again.body.amount}`)

  const { body: inv } = await api('invoice&id=SPNAT0001')
  is(inv.items.length === 2 && inv.items.some((i) => i.size === 'L' && i.fit === 'oversize'),
     "the invoice carries size and fit, case-normalised ('l'/'Oversize' in)", JSON.stringify(inv.items[1] ?? {}))
  is(!JSON.stringify(inv).includes('9988'), 'the invoice does not return the phone number')

  const { body: st } = await api('status&id=SPNAT0001')
  is(st.payment_status === 'pending' && st.amount === 25, 'status works by order number')
}

// ------------------------------------------------------------------ validation
{
  // The other half of the same rule, and the reason it is conditional rather
  // than a flat "size is mandatory": nineteen active products have no size
  // rows at all — a backpack, a cap, a phone strap — and must stay orderable
  // without one. The rejection case below and this one have to both hold.
  const accessory = await order('SPNATA001', [{ slug: 'cagliari-calcio-backpack', qty: 1 }])
  is(!accessory.body?.error, 'a product with NO size rows is still orderable without a size',
     accessory.body?.error ?? 'accepted')

  const cases = [
    ['bad track id', order('x!', [{ slug: 'cagliari-calcio-backpack', qty: 1 }]), 'invalid_track_id'],
    ['empty cart', order('SPNATV001', []), 'empty_cart'],
    ['qty 0', order('SPNATV002', [{ slug: 'cagliari-calcio-backpack', qty: 0 }]), 'invalid_qty'],
    ['unknown product', order('SPNATV003', [{ slug: 'no-such-thing', qty: 1 }]), 'unavailable_no-such-thing'],
    ['made-up size', order('SPNATV004', [{ slug: 'cheetahs-rugby-t-shirt', qty: 1, size: 'XXS' }]), 'invalid_size'],
    ['made-up fit', order('SPNATV005', [{ slug: 'cheetahs-rugby-t-shirt', qty: 1, fit: 'skintight' }]), 'invalid_fit'],
    // An ABSENT size, on a product that HAS sizes. Only an invalid size was
    // ever rejected, so the browser's size ladder was the only thing enforcing
    // this — and anything posting straight to /api could book a jacket with no
    // size, which the warehouse cannot pack.
    ['no size on a sized product',
     order('SPNATV006', [{ slug: 'cloudsoft-jacket-army-green', qty: 1 }]),
     'size_required_cloudsoft-jacket-army-green'],
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
  is(Number(stats.paid_count) === 1 && Number(stats.paid_revenue) === 9,
     'the stats see the settled cash order', `paid=${stats.paid_count} revenue=${stats.paid_revenue}`)
  is('cod_awaiting_count' in stats && 'revenue_7d' in stats, 'stats carry the exact keys Overview reads')

  // ------------------------------------ a hero button cannot leave the site
  // The hero button is the most prominent link on the shop, so store.php has
  // always insisted it be a same-origin path. It did not actually insist:
  // //evil.com starts with a slash and contains only permitted characters, so
  // it passed — and a leading double slash is not a path, it is a hostname.
  // The browser reads it as https://evil.com.
  //
  // It takes an admin session to set one, which is why this is a hardening
  // check rather than an open door. The difference it makes is between one
  // compromised login and a phishing page customers reach by clicking a
  // button on sporta.com.kw. Backslash is the same trick in other
  // punctuation — react-router follows browsers in treating it as a slash
  // (CVE-2025-68470) — so it is checked here too.
  // A real 1x1 PNG: slide_save requires a photograph before it looks at the
  // link, so without one this tests image_required and proves nothing.
  const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
           + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  for (const href of ['//evil.com', '///evil.com', '/\\evil.com', 'https://evil.com']) {
    const r = await admin('slide_save', { method: 'POST',
      body: JSON.stringify({ image: PX, cta_href: href, active: 0, sort: 99 }) })
    is(r.status === 400 && r.body?.error === 'invalid_link',
       `a hero button may not point at ${href}`, `${r.status} ${r.body?.error ?? ''}`)
  }
  // And an ordinary internal path still saves, or the guard has eaten the feature.
  const okHref = await admin('slide_save', { method: 'POST',
    body: JSON.stringify({ image: PX, cta_href: '/shop?cat=men', active: 0, sort: 99 }) })
  is(okHref.status === 200, 'but an ordinary internal path still saves',
     `${okHref.status} ${okHref.body?.error ?? ''}`)
  if (okHref.body?.id) {
    await admin('slide_delete', { method: 'POST', body: JSON.stringify({ id: okHref.body.id }) })
  }
}

// --------------------------------------------------------------- admin: stock
{
  const set = await admin('set_stock', { method: 'POST',
    body: JSON.stringify({ sku: 'A-CSJ-AR-L', stock: 7 }) })
  is(set.body?.stock === 7, 'stock moves through the admin')
  const neg = await admin('set_stock', { method: 'POST',
    body: JSON.stringify({ sku: 'A-CSJ-AR-L', stock: -1 }) })
  // stock_out_of_range covers below 0 and above 999999 (the live admin's token;
  // src/admin/api.js turns it into words).
  is(neg.body?.error === 'stock_out_of_range', 'negative stock is refused with the familiar token', neg.body?.error)
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

  // The switch, and what the PUBLIC endpoint does about it. A brand reaches
  // the storefront only once a LISTED product carries it (owner's choice,
  // "hide it until tagged"), so one is tagged for these checks and untagged
  // again below, before the remove test needs it gone.
  const untagged = await api('brands')
  is(!untagged.body.some((b) => b.slug === 'test-brand'),
     'an active brand with no listed product is NOT public — hidden until tagged')
  await run('mariadb', ['sporta', '-e',
    "update products set brand_slug = 'test-brand' where active = 1 order by id limit 1;"])
  const before = await api('brands')
  is(before.body.some((b) => b.slug === 'test-brand' && b.products === 1),
     'tag one listed product and the brand is public, with its count')
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

  // Remove. A brand any product still points at is refused; an unused one goes.
  await run('mariadb', ['sporta', '-e',
    "update products set brand_slug = 'test-brand' order by id limit 1;"])
  const busy = await admin('brand_delete', { method: 'POST', body: JSON.stringify({ id }) })
  is(busy.status === 409 && busy.body?.error === 'brand_in_use',
     'a brand that a product still uses cannot be removed', `${busy.status} ${busy.body?.error}`)
  await run('mariadb', ['sporta', '-e',
    "update products set brand_slug = null where brand_slug = 'test-brand';"])
  const gone = await admin('brand_delete', { method: 'POST', body: JSON.stringify({ id }) })
  is(gone.body?.deleted === true, 'an unused brand is removed', JSON.stringify(gone.body))
  const { body: listAfter } = await admin('brands')
  is(!listAfter.some((b) => b.slug === 'test-brand'), 'and it is gone from the admin list too')
  const again = await admin('brand_delete', { method: 'POST', body: JSON.stringify({ id }) })
  is(again.status === 404 && again.body?.error === 'brand_not_found',
     'removing it twice is a clean 404, not a 500', `${again.status} ${again.body?.error}`)
}

// -------------------------------------------- brands: counts and bulk tagging
// The live catalogue had ONE of 46 products tagged with a brand, so six of the
// seven tiles on the home strip led to "No matching products", and the only
// way to tag the rest was the product editor, one product at a time. These
// checks hold the two answers to that: every brand row says how many products
// it has (public: listed ones; admin: all, and listed), and brand_assign tags
// or untags a whole list in one statement. A hidden PRODUCT is inserted for
// the occasion rather than switching a real one off, so nothing else reading
// this database sees the catalogue shrink while it runs.
{
  const SLUG = 'test-assign-brand'
  const LONG = 'test-assign-' + 'x'.repeat(60)          // 72 > products.brand_slug's 64
  const SHOWN = ['tekno-shorts-black', 'tekno-shorts-royal']
  const EXTRA = 'street-pants-navy'
  const HIDDEN = 'test-assign-hidden-product'
  const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
  const tagOf = (slug) => sql(`select coalesce(brand_slug, 'NULL') from products where slug = '${slug}'`)
  const assign = (body) => admin('brand_assign', { method: 'POST', body: JSON.stringify(body) })
  const pub = async () => (await api('brands')).body.find((b) => b.slug === SLUG)
  const adm = async () => (await admin('brands')).body.find((b) => b.slug === SLUG)
  const logged = () => sql("select count(*) from admin_activity_log where action_key = 'brand_assign'").then(Number)
  const firstLog = Number(await sql('select coalesce(max(id), 0) from admin_activity_log'))

  await sql(`delete from products where slug = '${HIDDEN}';` +
    `insert into products (slug, name_en, name_ar, price, active, category) ` +
    `values ('${HIDDEN}', 'Test Hidden Product', 'منتج مخفي', 1.000, 0, 'men')`)
  try {
    const made = await admin('brand_save', { method: 'POST',
      body: JSON.stringify({ name_en: 'Test Assign Brand', name_ar: 'علامة الاختبار', sort: 98 }) })
    const id = made.body?.id
    is(made.body?.slug === SLUG, 'a brand to tag products with', made.body?.slug)

    // The fields, as built: integers, and 0 for a brand with nothing yet.
    const p0 = await pub()
    is(p0 === undefined, 'a brand with nothing listed is left out of the PUBLIC list (hidden until tagged)', JSON.stringify(p0))
    const a0 = await adm()
    is(a0?.products === 0 && a0?.products_active === 0,
       'the ADMIN brand row carries both counts, as integers', JSON.stringify({ p: a0?.products, a: a0?.products_active }))

    // The product list the brand screen tags from: every product, hidden ones
    // too, exactly the agreed fields, and nothing commercial.
    const list = await admin('brand_products')
    const total = Number(await sql('select count(*) from products'))
    is(Array.isArray(list.body) && list.body.length === total,
       'brand_products lists EVERY product, shown and hidden', `${list.body?.length} of ${total}`)
    const keys = Object.keys(list.body?.[0] ?? {}).sort().join(',')
    is(keys === 'active,brand_slug,category,name_ar,name_en,slug',
       'with exactly slug, names, brand, shown/hidden and category', keys)
    is(!/price|cost|image|desc/.test(JSON.stringify(list.body)),
       'and no prices, costs, images or descriptions')
    const hid = list.body?.find((p) => p.slug === HIDDEN)
    is(hid?.active === 0, 'a hidden product is on it, marked active 0', JSON.stringify(hid))
    const byName = (await sql('select slug from products order by name_en, slug')).split('\n').join(',')
    is(list.body?.map((p) => p.slug).join(',') === byName, 'ordered by English name')

    // Tag two listed products, one hidden one and one that does not exist.
    const before = await logged()
    const tagged = await assign({ brand_slug: SLUG, products: [...SHOWN, HIDDEN, 'no-such-product'] })
    is(tagged.status === 200 && tagged.body?.updated === 3 && tagged.body?.skipped === 1,
       'brand_assign tags a list in one call and counts the unknown slug as skipped', JSON.stringify(tagged.body))
    is((await tagOf(SHOWN[0])) === SLUG && (await tagOf(HIDDEN)) === SLUG,
       'and the products really carry the brand')
    is((await logged()) === before + 1, 'a bulk tag is written to the activity log like every admin write')

    const a1 = await adm()
    is(a1?.products === 3 && a1?.products_active === 2,
       'the admin counts every tagged product, and separately the listed ones',
       `${a1?.products} / ${a1?.products_active}`)
    const p1 = await pub()
    is(p1?.products === 2, 'the public count is LISTED products only — a hidden one is nowhere to send a shopper',
       `${p1?.products}`)
    is(!JSON.stringify((await api('brands')).body).includes('"logo"'),
       'and the public endpoint still never inlines a logo')
    const ahed = (await api('brands')).body.find((b) => b.slug === 'ahed')
    is(ahed === undefined, 'another brand with nothing listed stays off the public list', JSON.stringify(ahed))

    const again = await assign({ brand_slug: SLUG, products: [SHOWN[0], SHOWN[0]] })
    is(again.body?.updated === 0 && again.body?.skipped === 0,
       're-tagging with the same brand changes nothing and says so; a duplicate is not "skipped"',
       JSON.stringify(again.body))
    // "Skipped" means UNKNOWN, decided the way the database compares slugs:
    // the column ignores case and trailing spaces, so these all name a real
    // product (and the UPDATE reaches it) — only the last one is unknown.
    const spelt = await assign({ brand_slug: SLUG,
      products: [SHOWN[0], SHOWN[0].toUpperCase(), SHOWN[0] + ' ', 'no-such-product'] })
    is(spelt.body?.updated === 0 && spelt.body?.skipped === 1,
       'a known product in another spelling is not counted as skipped', JSON.stringify(spelt.body))

    // A HIDDEN brand can be tagged (any state), and is still not public.
    await admin('brand_active', { method: 'POST', body: JSON.stringify({ id, active: false }) })
    is((await pub()) === undefined, 'a hidden brand is still left out of the public list, counts or not')
    const a2 = await adm()
    is(a2?.products === 3, 'while the admin keeps its counts', `${a2?.products}`)
    const hiddenTag = await assign({ brand_slug: SLUG.toUpperCase(), products: [EXTRA] })
    is(hiddenTag.status === 200 && hiddenTag.body?.updated === 1,
       'a hidden brand can still be assigned — tag first, switch on later',
       `${hiddenTag.status} ${JSON.stringify(hiddenTag.body)}`)
    is((await tagOf(EXTRA)) === SLUG, 'stored in the brand row’s own spelling, not the request’s', await tagOf(EXTRA))
    await admin('brand_active', { method: 'POST', body: JSON.stringify({ id, active: true }) })
    is((await pub())?.products === 3, 'switched back on, it is public again with the new count', `${(await pub())?.products}`)

    // Clearing: null, and "" the way a "No brand" <select> option sends it.
    const cleared = await assign({ brand_slug: null, products: [EXTRA] })
    is(cleared.body?.updated === 1 && (await tagOf(EXTRA)) === 'NULL',
       'brand_slug null clears the brand', JSON.stringify(cleared.body))
    is((await pub())?.products === 2, 'and the public count follows', `${(await pub())?.products}`)
    const blank = await assign({ brand_slug: '', products: SHOWN })
    is(blank.body?.updated === 2 && (await tagOf(SHOWN[0])) === 'NULL' && (await tagOf(SHOWN[1])) === 'NULL',
       'an empty brand clears it too', JSON.stringify(blank.body))
    const p3 = await pub()
    is(p3 === undefined, 'untag its last LISTED product and the brand leaves the public list — a hidden one does not keep it there',
       JSON.stringify(p3))
    const a3 = await adm()
    is(a3?.products === 1 && a3?.products_active === 0, 'the hidden product is still counted in the admin',
       `${a3?.products} / ${a3?.products_active}`)

    // Refusals. Each must change NOTHING — checked on a product left untagged.
    const loggedBefore = await logged()
    const unknown = await assign({ brand_slug: 'no-such-brand', products: [SHOWN[0]] })
    is(unknown.status === 400 && unknown.body?.error === 'unknown_brand',
       'an unknown brand is refused, not stored as a tag that matches nothing', `${unknown.status} ${unknown.body?.error}`)
    await sql(`update products set brand_slug = '${SLUG}' where slug = '${SHOWN[1]}'`)
    const spaces = await assign({ brand_slug: '   ', products: [SHOWN[1]] })
    is(spaces.status === 400 && spaces.body?.error === 'unknown_brand' && (await tagOf(SHOWN[1])) === SLUG,
       'a brand of only spaces is refused, not taken as "no brand" — a padded field must not untag anything',
       `${spaces.status} ${spaces.body?.error} ${await tagOf(SHOWN[1])}`)
    await sql(`update products set brand_slug = null where slug = '${SHOWN[1]}'`)
    const tooMany = await assign({ brand_slug: SLUG,
      products: [SHOWN[0], ...Array.from({ length: 200 }, (_, i) => `nope-${i}`)] })
    is(tooMany.status === 400 && tooMany.body?.error === 'bad_request',
       'more than 200 products in one call is refused', `${tooMany.status} ${tooMany.body?.error}`)
    for (const [products, what] of [
      [[], 'an empty list'], ['tekno-shorts-black', 'a string instead of a list'],
      [{ a: 'tekno-shorts-black' }, 'an object instead of a list'], [[SHOWN[0], 7], 'a non-string slug'],
      [undefined, 'no list at all'],
    ]) {
      const res = await assign({ brand_slug: SLUG, products })
      is(res.status === 400 && res.body?.error === 'bad_request', `${what} is refused`, `${res.status} ${res.body?.error}`)
    }
    const noKey = await assign({ products: [HIDDEN] })
    is(noKey.status === 400 && noKey.body?.error === 'bad_request' && (await tagOf(HIDDEN)) === SLUG,
       'a body with no brand_slug key is refused — a forgotten field must not untag anything',
       `${noKey.status} ${noKey.body?.error}`)
    const long = await admin('brand_save', { method: 'POST',
      body: JSON.stringify({ name_en: LONG, name_ar: 'طويل' }) })
    const longTag = await assign({ brand_slug: LONG, products: [SHOWN[0]] })
    is(long.body?.slug === LONG && longTag.status === 400 && longTag.body?.error === 'brand_slug_too_long',
       'a brand slug longer than the products column holds is refused, not a 500 or a truncated tag',
       `${longTag.status} ${longTag.body?.error}`)
    if (long.body?.id) await admin('brand_delete', { method: 'POST', body: JSON.stringify({ id: long.body.id }) })

    // The gate every admin write sits behind: a session, and the CSRF header.
    const bare = (headers) => fetch(`${BASE}/admin.php?r=brand_assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ brand_slug: SLUG, products: [SHOWN[0]] }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
    const anon = await bare({ 'X-Sporta-Admin': '1' })
    is(anon.status === 401 && anon.body?.error === 'not_signed_in',
       'brand_assign requires sign-in', `${anon.status} ${anon.body?.error}`)
    const noHeader = await bare({ Cookie: cookie })
    is(noHeader.status === 400 && noHeader.body?.error === 'bad_request',
       'and the X-Sporta-Admin header, even with a valid session cookie', `${noHeader.status} ${noHeader.body?.error}`)
    const viaGet = await admin('brand_assign')
    is(viaGet.status === 404, 'a GET does not assign anything', `${viaGet.status}`)

    is((await tagOf(SHOWN[0])) === 'NULL', 'none of those refusals touched the product')
    is((await logged()) === loggedBefore, 'and none of them reached the activity log')
  } finally {
    // Whatever happened above: no tag, no test product, no test brands, and
    // none of this block's own audit rows.
    await sql(`update products set brand_slug = null where brand_slug in ('${SLUG}', '${LONG}');` +
      `delete from products where slug = '${HIDDEN}';` +
      `delete from brands where slug in ('${SLUG}', '${LONG}');` +
      `delete from admin_activity_log where id > ${firstLog} and action_key like 'brand\\_%'`)
  }
}

// -------------------------------------------------------------------- throttle
{
  cookie = '' // fresh, signed-out client
  // ------------------------------------------ editing a product keeps its sale
  // The product editor saves the whole product. product_save treats an ABSENT
  // sale or featured field as "clear it", so an editor that did not send them
  // ended a product's sale and took it off the featured row on every save.
{
  await run('mariadb', ['sporta', '-e',
    "update products set sale_price = 7.500, sale_starts_at = '2099-01-01 00:00:00', " +
    "sale_ends_at = null, featured = 1, featured_sort = 3 where slug = 'cloudsoft-jacket-army-green'"])
  // Sign in here: earlier checks in this suite change the session cookie.
  const signedIn = await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })
  is(signedIn.status === 200, 'the admin can sign in for the product save', `${signedIn.status}`)
  // Read the row the way the editor would receive it. Straight from MariaDB:
  // the admin session is not what this check is about.
  //
  // utf8mb4 ON THE CLIENT, or the Arabic name comes back as «?????» — the
  // CLI's default here is latin1 — and the save below writes those question
  // marks into the row for real, corrupting the sandbox for every suite that
  // runs after this one (the assistant's Arabic search among them).
  const { stdout: rowJson } = await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e',
    "select json_object('id', id, 'slug', slug, 'name_en', name_en, 'name_ar', name_ar, " +
    "'desc_en', desc_en, 'desc_ar', desc_ar, 'price', price, 'category', category, " +
    "'brand_slug', brand_slug, 'image', image, 'images', images, 'active', active, " +
    "'sale_price', sale_price, 'sale_starts_at', date_format(sale_starts_at, '%Y-%m-%d %H:%i:%s'), " +
    "'sale_ends_at', date_format(sale_ends_at, '%Y-%m-%d %H:%i:%s'), 'featured', featured, " +
    "'featured_sort', featured_sort) from products where slug = 'cloudsoft-jacket-army-green'"])
  const listed = JSON.parse(rowJson.trim())
  // The payload the editor builds: the listed row, sale and featured included.
  const saved = await admin('product_save', { method: 'POST', body: JSON.stringify({
    id: listed.id, slug: listed.slug, name_en: listed.name_en, name_ar: listed.name_ar,
    desc_en: listed.desc_en, desc_ar: listed.desc_ar, price: Number(listed.price),
    category: listed.category, brand_slug: listed.brand_slug ?? '', image: listed.image,
    images: listed.images ?? '', active: !!Number(listed.active),
    sale_price: listed.sale_price == null ? null : Number(listed.sale_price),
    sale_starts_at: listed.sale_starts_at ? listed.sale_starts_at.slice(0, 16).replace(' ', 'T') : null,
    sale_ends_at: listed.sale_ends_at ? listed.sale_ends_at.slice(0, 16).replace(' ', 'T') : null,
    featured: !!Number(listed.featured), featured_sort: Number(listed.featured_sort) || 0,
  }) })
  is(saved.status === 200, 'an editor-shaped save is accepted', `${saved.status}`)
  const { stdout: afterRow } = await run('mariadb', ['sporta', '-N', '-B', '-e',
    "select sale_price, sale_starts_at, featured, featured_sort from products where slug = 'cloudsoft-jacket-army-green'"])
  const after = afterRow.trim()
  is(saved.status === 200 && after === '7.500\t2099-01-01 00:00:00\t1\t3',
     'and it keeps the sale, its start date, the featured row and its order', after)
  await run('mariadb', ['sporta', '-e',
    "update products set sale_price = null, sale_starts_at = null, sale_ends_at = null, " +
    "featured = 0, featured_sort = 0 where slug = 'cloudsoft-jacket-army-green'"])
}

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
  // The sixth attempt is refused by the per-account window BEFORE the
  // password is hashed — 429 too_many_attempts, the same answer whether or not
  // the account exists, so the window cannot be used to discover accounts.
  //
  // RELABELLED. This used to say "five failures lock the account", and a row
  // lock (locked_until) stood behind the window. Wrong PASSWORDS no longer
  // touch the row — that lock was a lever anyone could pull against the owner
  // — so what is proved here is the window, for a browser this account has
  // never signed in from (this jar keeps no device cookie). A browser the
  // owner HAS used gets its own window: see the proxied section below.
  is(realLock.status === 429 && realLock.body?.error === 'too_many_attempts',
     'five failures fill the account window for an unknown browser — even the RIGHT password waits',
     `${realLock.status} ${realLock.body?.error}`)
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
  is(paid.body.amount === 16, 'and CHECKOUT charges the sale price, not the list price (+1 delivery)', `${paid.body.amount}`)

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
  is(stacked.body.discount === 7 && stacked.body.total === 34,
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
  is(cheated.amount === 34 && cheated.discount === 7,
     'a browser-supplied amount and discount are IGNORED — the server recomputes both',
     `charged ${cheated.amount}`)
  const stored = (await run('mariadb', ['sporta', '-N', '-B', '-e',
    "select amount, subtotal, discount_amount, delivery_fee, discount_code from orders where track_id = 'SPCHEAT001'"])).stdout.trim()
  // 40 goods − 7 discount + 1 delivery = 34. The delivery fee is stored on the
  // row, not inferred from a constant, so this invoice still reads correctly
  // after the fee changes.
  is(stored === '34.000\t40.000\t7.000\t1.000\tSAVE10', 'and MySQL holds the server’s figures', stored)

  // ---- the stack cap ----
  await run('mariadb', ['sporta', '-e',
    "update discounts set value = 90, type = 'percent' where code = 'SAVE10'; " +
    "update discounts set value = 50, type = 'percent', min_order = 0 where kind = 'auto'"])
  const capped = await check('SAVE10')
  is(capped.body.discount === 24 && capped.body.total === 17,
     'two rules that would give 140% off are capped at 60% of the order',
     `${capped.body.discount} off ${capped.body.subtotal}`)
  await run('mariadb', ['sporta', '-e',
    "update discounts set value = 10 where code = 'SAVE10'; " +
    "update discounts set value = 3, type = 'fixed', min_order = 30 where kind = 'auto'"])

  // ---- single use, under concurrency ----
  await run('mariadb', ['sporta', '-e',
    "delete from orders; delete from rate_limit; " +
    // Eight carts of four jackets each: stock must not be what decides the
    // race — the store claims garments inside the order now.
    "update product_variants set stock = 1000; " +
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
  // The other seven are REFUSED, not placed at full price: the claim runs
  // inside the order's transaction and a lost claim rolls the whole order back
  // with discount_used_up, so nobody is charged a total they were not quoted.
  const lost = races.filter((r) => r.error === 'discount_used_up').length
  is(granted === 1 && lost === 7, 'eight simultaneous checkouts, one single-use code, exactly ONE gets it',
     `${granted} granted, ${lost} told discount_used_up${races.find((r) => r.error && r.error !== 'discount_used_up') ? `, other: ${races.find((r) => r.error && r.error !== 'discount_used_up').error}` : ''}`)
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
  // The lockout check above leaves the identity window full; without clearing
  // it the RIGHT password is refused here, no cookie is set, and the plain-HTTP
  // check below would pass on an empty header.
  await run('mariadb', ['sporta', '-e',
    'delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null'])

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
    'delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null'])
  const plain = await login({})
  is(/sporta/i.test(plain) && !/;\s*secure/i.test(plain),
     'on genuinely plain HTTP it is not, or local development cannot sign in at all',
     plain ? plain.split(';').slice(1).join(';').trim() : 'no cookie was set')
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

  // THIS USED TO ASSERT THE HOLE. It checked that a REAL code still got 200
  // from the blocked address — and that is exactly what made the limiter an
  // oracle: wrong codes got 429, right codes got 200, so the 429 itself said
  // "wrong" and a script kept guessing at full speed. A full bucket now
  // refuses every lookup from that client, right codes included. Only
  // FAILURES are still counted, so successes from a client that is not over
  // the limit cost nothing (proved from separate addresses in the proxied
  // section below, where one sandbox server can tell clients apart).
  const real = await check('REALCODE')
  is(real.status === 429 && real.body?.error === 'too_many_attempts',
     'and a REAL code from the blocked address is refused too — the 429 no longer means "wrong"',
     `${real.status} ${real.body?.error ?? JSON.stringify(real.body?.applied?.[0]?.code)}`)

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

// ------------------------------------------------- the session cookie itself
//
// Everything about this cookie IS the admin: it is the only thing standing
// between the internet and the screen that sets prices. Four properties, each
// asserted because each is one word away from being absent.
{
  const res = await fetch(`${BASE}/admin.php?r=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1',
               // Hostinger terminates TLS in front of PHP, so this is the
               // header the live server is actually judged on.
               'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }),
  })
  const set = res.headers.get('set-cookie') ?? ''
  is(/^__Host-sporta_admin=/.test(set),
     'over HTTPS the cookie takes the __Host- prefix, so no other host can write it',
     set.split(';')[0])
  is(/HttpOnly/i.test(set), 'HttpOnly — script cannot read the thing that IS the admin')
  is(/SameSite=Strict/i.test(set), 'SameSite=Strict — no cross-site request carries it')
  is(/Secure/i.test(set), 'Secure — and __Host- would be REFUSED by the browser without it')
  // Case-insensitively: PHP emits `path=/` in lower case, and a case-sensitive
  // check here failed on a cookie that was entirely correct.
  is(!/domain=/i.test(set) && /path=\/(;|$)/i.test(set),
     'no Domain and Path=/, which __Host- also requires', set)

  // Plain HTTP has to keep working, or a local or half-configured server locks
  // the owner out: a browser must REJECT a __Host- cookie that is not Secure.
  const plain = await fetch(`${BASE}/admin.php?r=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }),
  })
  const plainSet = plain.headers.get('set-cookie') ?? ''
  is(/^sporta_admin=/.test(plainSet),
     'without HTTPS it falls back to the unprefixed name rather than a cookie no browser will store',
     plainSet.split(';')[0])
}

// --------------------------------------------- and how long it stays valid
//
// The server keeps its own two clocks — 7 days idle, 30 days absolute (the
// owner's 30-day sign-in, 2026-11-02; test:admin-session proves the cookie,
// the session directory and the sweep). They are tested by winding the
// session file back, which is the only way to test a timeout without waiting
// a week for it. The file lives in admin_session_dir (store_admin_session_dir),
// which the sandbox config names.
{
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs')
  const storeConfig = new URL('../dropin/php-store/config.php', import.meta.url).pathname
  const dir = (await run('php', ['-r', `$c = require ${JSON.stringify(storeConfig)}; echo $c['admin_session_dir'] ?? (ini_get('session.save_path') ?: sys_get_temp_dir());`])).stdout
  const sign = async () => {
    const r = await fetch(`${BASE}/admin.php?r=login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })
    return (r.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const me = (c) => fetch(`${BASE}/admin.php?r=me`, { headers: { 'X-Sporta-Admin': '1', Cookie: c } })
  const rewind = (c, key, seconds) => {
    const f = `${dir}/sess_${c.split('=')[1]}`
    if (!existsSync(f)) return false
    const t = Math.floor(Date.now() / 1000) - seconds
    writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`${key}\\|i:\\d+;`), `${key}|i:${t};`))
    return true
  }

  const live = await sign()
  is((await me(live)).status === 200, 'a fresh session is accepted')

  // ?r=me is checked as well as the data routes, and that is the point of the
  // test. The first version put the expiry only in store_require_admin(), which
  // ?r=me does not call — so an expired session still answered "signed in", the
  // dashboard rendered, and every panel on it then 401'd. An expiry that
  // reports itself as eight broken screens is worse than none.
  const workday = await sign()
  if (rewind(workday, 'seen_at', 9 * 3600)) {
    const r = await me(workday)
    is(r.status === 200 && (await r.json())?.email === 'cs@sporta.com.kw',
       'nine hours idle is still signed in (the 30-day sign-in; it was 8 hours)')
  } else { bad('could not locate the session file to age it') }

  const idle = await sign()
  if (rewind(idle, 'seen_at', 8 * 86400)) {
    const r = await me(idle)
    is(r.status === 200 && (await r.json()) === null,
       'eight days idle reads as signed OUT, on ?r=me and not only on the data routes')
  } else { bad('could not locate the session file to age it') }

  const oldSession = await sign()
  if (rewind(oldSession, 'started_at', 31 * 86400)) {
    const r = await me(oldSession)
    is(r.status === 200 && (await r.json()) === null,
       'and thirty-one days old expires even if it was used a moment ago')
  } else { bad('could not locate the session file to age it') }

  // Signing out has to take the cookie with it. Emptying $_SESSION alone left
  // the browser holding an id that a not-yet-collected session still answered.
  const bye = await sign()
  const out = await fetch(`${BASE}/admin.php?r=logout`, { method: 'POST',
    headers: { 'X-Sporta-Admin': '1', Cookie: bye } })
  is(/(^|;)\s*(__Host-)?sporta_admin=(;|\s|$)/.test(out.headers.get('set-cookie') ?? '')
     || /expires=/i.test(out.headers.get('set-cookie') ?? ''),
     'signing out clears the cookie, not just the server side',
     out.headers.get('set-cookie') ?? '(none)')
  is((await me(bye)).status === 200 && (await (await me(bye)).json()) === null,
     'and the old cookie no longer resolves to anybody')
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

// ------------------------------------------- every route has a rate limit
// THE CHECK THAT KEEPS THE TABLE HONEST, and the reason the table exists.
//
// Throttling used to be opt-in — a line typed inside each route's own if
// block — and seven of eleven routes had none, including the one that turns a
// request into mail to the warehouse. The fix is a table applied once on
// arrival, but a table is only worth having if adding a route to api.php
// without adding it to the table FAILS. That is what this asserts: it reads
// the routes out of the source and demands each one appear.
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../dropin/php-store/api.php', import.meta.url), 'utf8')
  // Routes are dispatched two ways: `$r === 'x'` and `in_array($r, ['x', 'y'], …)`.
  const routes = [
    ...[...src.matchAll(/\$r === '(\w+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/in_array\(\$r, \[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])),
  ]
  const table = src.slice(src.indexOf('$STORE_LIMITS = ['), src.indexOf('];', src.indexOf('$STORE_LIMITS = [')))
  const listed = [...table.matchAll(/'(\w+)'\s*=>/g)].map((m) => m[1])

  const missing = [...new Set(routes)].filter((x) => !listed.includes(x))
  is(missing.length === 0, 'every route in api.php appears in $STORE_LIMITS',
     missing.length ? `NOT LISTED: ${missing.join(', ')}` : `${listed.length} routes`)

  const stale = listed.filter((x) => !routes.includes(x))
  is(stale.length === 0, 'and the table has no entries for routes that no longer exist',
     stale.join(', ') || 'none')

  // And it is really applied, not merely declared. ?r=stock is the cheapest
  // one to prove it on: it is a full scan of product_variants that anyone can
  // call in a loop, and it had no guard at all until the table.
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  let hit429 = false
  for (let i = 0; i < 125 && !hit429; i++) {
    if ((await api('stock')).status === 429) hit429 = true
  }
  is(hit429, 'and a GET route is really limited, not just listed — ?r=stock stops')
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
}

// ------------------------------------ order creation cannot be used as a cannon
// LAST, because it deliberately exhausts the budget.
//
// Why the cap exists is argued in full at the store_throttle call in api.php's
// ?r=order route. What is proven here: the cap holds against a burst, the
// warehouse is not mailed once per request, and a real shopper is still served
// after the window.
{
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  let limited = 0
  const outboxRows = async () =>
    Number((await run('mariadb',
      ['sporta', '-N', '-B', '-e', 'select count(*) from fulfilment_outbox'])).stdout.trim())
  const before = await outboxRows()
  for (let i = 0; i < 30; i++) {
    const { status } = await order(`SPFLOOD${i}`, [{ slug: 'cagliari-calcio-backpack', qty: 1 }])
    if (status === 429) limited++
  }
  is(limited > 0, 'a burst of thirty orders is cut off', `${limited} refused`)
  const after = await outboxRows()
  is(after - before <= 20,
     'so the warehouse cannot be mailed thirty times by a stranger',
     `${after - before} messages queued`)

  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  const ok2 = await order('SPFLOODOK', [{ slug: 'cagliari-calcio-backpack', qty: 1 }])
  is(ok2.status === 200, 'and a real shopper is served once the window passes', `${ok2.status}`)
}

// ---------------------------------------------------------------------------
// A DATABASE BEHIND THE CODE SAYS SO, INSTEAD OF JUST FAILING
//
// Publishing the files is one step and importing the additive SQL beside them
// is another, and they happen minutes apart. In between, the server runs new
// code against an old database — which is the shape of every upgrade, not an
// exotic case.
//
// The handler used to recognise only a missing TABLE (1146). A missing COLUMN
// (1054) is what an UPGRADED shop actually hits, and it produced a bare 500
// "failed" on the Orders screen: no cause, no fix, on the one screen the owner
// opens to find out what is wrong.
{
  const q = async (s) => (await run('mariadb', ['sporta', '-N', '-B', '-e', s])).stdout.trim()

  // The throttle section above deliberately leaves the account locked and the
  // cookie spent, so sign in first — otherwise this reads 401 and the failure
  // looks like the schema check rather than a missing session.
  await run('mariadb', ['sporta', '-e',
    'update admin_users set failed_attempts = 0, locked_until = null'])
  await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })

  // ALGORITHM=COPY, a real rebuild. MariaDB drops a column INSTANTLY by
  // default, which keeps it in every row as a hidden field — and this runs on
  // every pass of the suite, so the hidden copies pile up until the orders
  // table is at InnoDB's row-size limit and ANY new column is refused with
  // error 1118 (measured on the sandbox: even a tinyint). A rebuild drops it
  // for real.
  await run('mariadb', ['sporta', '-e', 'alter table orders drop column utm_source, algorithm=copy'])
  const broken = await admin('orders')
  is(broken.status === 503 && broken.body?.error === 'no_table',
     'a column the SQL has not added yet reads as "import the SQL", not as an outage',
     `${broken.status} ${broken.body?.error}`)

  // Put it back exactly as attribution.mysql.sql would.
  await run('mariadb', ['sporta', '-e',
    'alter table orders add column if not exists utm_source varchar(60) null'])
  const fixed = await admin('orders')
  is(fixed.status === 200, 'and the screen works again once the column exists', String(fixed.status))
  is((await q("show columns from orders like 'utm_source'")).length > 0, 'the column really is back')
}

// ---------------------------------------------------------------------------
// CASH ON DELIVERY IS THE ONLY METHOD THAT SPENDS MONEY BEFORE ANYONE PAYS
//
// A fake card order costs nothing — the bank never settled it. A fake COD order
// has already sent a courier to an address, and the shop pays for that trip
// whether or not a door opens. Measured before the guard existed: ONE phone
// number placed twelve COD orders in a few seconds, all accepted, each queuing
// a picking list.
{
  const q = async (s) => (await run('mariadb', ['sporta', '-N', '-B', '-e', s])).stdout.trim()
  const PHONE = '95559999'
  const CANON = '96595559999'
  await run('mariadb', ['sporta', '-e',
    `delete from orders where customer_phone = '${CANON}'; delete from blocked_customers;`])

  const buy = async (method) => {
    const track = 'SPCOD' + Math.random().toString(36).slice(2, 9).toUpperCase()
    const res = await api('order', {
      method: 'POST',
      body: JSON.stringify({ track_id: track, items: [{ slug: 'cagliari-calcio-backpack', qty: 1 }],
        customer: { ...CUSTOMER, phone: PHONE }, payment_method: method }),
    })
    return { status: res.status, err: res.body?.error, track }
  }

  // The cap lets a real customer through and stops a flood.
  const first = []
  for (let i = 0; i < 3; i++) first.push(await buy('cod'))
  is(first.every((r) => r.status === 200), 'three open cash orders are fine — a real customer is not throttled',
     first.map((r) => r.status).join(','))
  const fourth = await buy('cod')
  is(fourth.status === 409 && fourth.err === 'too_many_open_cod',
     'the fourth undelivered cash order from one phone is refused', `${fourth.status} ${fourth.err}`)

  // ...but the cap is COD-only. A prepaid order is money in before anything
  // ships, so throttling it would be all cost and no benefit.
  const prepaid = await buy('knet')
  is(prepaid.status === 200, 'a PREPAID order from the same phone is still accepted', String(prepaid.status))

  // THE RULE THAT KEEPS THIS SHIPPABLE: delivered orders free the slot, so the
  // shop's best customers are never the ones it blocks.
  await run('mariadb', ['sporta', '-e',
    `update orders set fulfilment_status = 'delivered' where customer_phone = '${CANON}' and payment_method = 'cod' limit 1`])
  const afterDelivery = await buy('cod')
  is(afterDelivery.status === 200,
     'once an order is delivered the customer can order again', String(afterDelivery.status))

  // The blocklist, keyed on the canonical phone. The admin types it however
  // they like; it must still match what the checkout writes.
  //
  // Sign in FIRST: the throttle section above deliberately leaves the account
  // locked and the cookie spent, so an admin call here would 401 and the
  // failure would read as "the blocklist is broken" rather than "the session
  // is gone".
  await run('mariadb', ['sporta', '-e',
    'update admin_users set failed_attempts = 0, locked_until = null'])
  await admin('login', { method: 'POST',
    body: JSON.stringify({ email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }) })

  const block = await admin('block_customer', {
    method: 'POST',
    body: JSON.stringify({ phone: '+965 9555 9999', reason: 'three refused deliveries' }),
  })
  is(block.body?.phone === CANON,
     'a block typed as "+965 9555 9999" is stored in the form the checkout uses', block.body?.phone)

  const blockedCod = await buy('cod')
  is(blockedCod.status === 403 && blockedCod.err === 'cod_blocked',
     'a blocked number cannot use cash on delivery', `${blockedCod.status} ${blockedCod.err}`)
  const blockedCard = await buy('knet')
  is(blockedCard.status === 200,
     'but scope=cod still lets them pay up front — prepaid costs the shop nothing',
     String(blockedCard.status))

  await admin('block_customer', { method: 'POST',
    body: JSON.stringify({ phone: PHONE, scope: 'all', reason: 'fraud' }) })
  const blockedAll = await buy('knet')
  is(blockedAll.status === 403 && blockedAll.err === 'customer_blocked',
     'scope=all refuses every payment method', `${blockedAll.status} ${blockedAll.err}`)

  await admin('unblock_customer', { method: 'POST',
    body: JSON.stringify({ phone: '00965 95559999' }) })
  const unblocked = await buy('knet')
  is(unblocked.status === 200, 'and unblocking works from any spelling of the number',
     String(unblocked.status))

  await run('mariadb', ['sporta', '-e',
    `delete from orders where customer_phone = '${CANON}'; delete from blocked_customers;`])
}

// ---------------------------------------------------------------------------
// WHICH AD PAID FOR THE ORDER
//
// The shop advertises, and without this the owner sees forty sales and cannot
// tell which campaign produced them — so the budget is split by instinct and
// the campaign that works is as likely to be cut as kept.
//
// The rule that matters just as much: attribution is REPORTING. It decides
// nothing about price, stock or fulfilment, so a malformed campaign label must
// never cost a sale. Every check below asserts the order still succeeds.
{
  const buy = async (attribution) => {
    const track = 'SPUTM' + Math.random().toString(36).slice(2, 9).toUpperCase()
    const res = await order(track, [{ slug: 'cagliari-calcio-backpack', qty: 1 }], { attribution })
    return { track, status: res.status }
  }
  const q = async (s) => (await run('mariadb', ['sporta', '-N', '-B', '-e', s])).stdout.trim()
  const col = (track, c) => q(`select coalesce(${c}, '<null>') from orders where track_id = '${track}'`)

  const real = await buy({ utm_source: 'instagram', utm_medium: 'paid_social',
                           utm_campaign: 'summer_sale', referrer_host: 'l.instagram.com' })
  is(real.status === 200, 'an order from an ad is accepted', String(real.status))
  is(await col(real.track, 'utm_source') === 'instagram', 'and records the campaign source')
  is(await col(real.track, 'utm_campaign') === 'summer_sale', 'and the campaign name')
  is(await col(real.track, 'referrer_host') === 'l.instagram.com', 'and the site it arrived from')

  const direct = await buy(undefined)
  is(direct.status === 200, 'a direct visit still orders fine', String(direct.status))
  is(await col(direct.track, 'utm_source') === '<null>',
     'and records no campaign, rather than inventing one')

  // A query string is attacker-controlled, and all of this arrives from one.
  const huge = await buy({ utm_source: 'x'.repeat(4000), utm_campaign: 'y'.repeat(4000) })
  is(huge.status === 200, 'a 4 kB campaign label does NOT fail the order', String(huge.status))
  is((await col(huge.track, 'utm_source')).length === 60, 'it is truncated to fit the column')

  const junk = await buy({ utm_source: ['array'], utm_medium: 42, utm_campaign: true })
  is(junk.status === 200, 'wrong types do not fail the order', String(junk.status))
  is(await col(junk.track, 'utm_source') === '<null>', 'they are simply not recorded')

  const notObj = await buy('not-an-object')
  is(notObj.status === 200, 'attribution that is not an object is ignored, not fatal', String(notObj.status))

  const inject = await buy({ utm_source: "insta'; drop table orders; --" })
  is(inject.status === 200, 'a SQL-shaped campaign label is just a label', String(inject.status))
  is(Number(await q('select count(*) from orders')) > 0, 'and the orders table is still there')
}

// ---------------------------------------------------------------------------
// ONE ORDER CANNOT HOLD THE WHOLE SHOP
//
// Stock is claimed at checkout, before anyone pays, and the order limit
// counts REQUESTS, not garments. Measured on a live-shaped sandbox: four cash
// orders built from the public ?r=stock feed held all 1,236 units.
// store_order_size_guard() caps what one order may claim — 20 pieces in all,
// 10 of one item in one size — with no IP involved, so shoppers sharing a
// carrier address are untouched. Every payment method. The refusal is the
// token cart_too_large (the live checkout's own token, see store.php), not a
// second one: the tests below expect that token.
{
  const q = async (s) => (await run('mariadb', ['sporta', '-N', '-B', '-e', s])).stdout.trim()
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  const SKUS = ['A-CSL-GR-L', 'A-CSL-NA-L', 'A-CST-GR-L']
  const inList = SKUS.map((s) => `'${s}'`).join(',')
  const saved = await q(`select group_concat(concat(sku, '=', stock)) from product_variants where sku in (${inList})`)
  await run('mariadb', ['sporta', '-e', `update product_variants set stock = 10 where sku in (${inList})`])
  const stockSum = async () => Number(await q(`select sum(stock) from product_variants where sku in (${inList})`))
  const rows = async (track) => Number(await q(`select count(*) from orders where track_id = '${track}'`))
  const G = { slug: 'cloudsoft-leggings-grey', size: 'L' }
  const N = { slug: 'cloudsoft-leggings-navy', size: 'L' }
  const T = { slug: 'cloudsoft-top-grey', size: 'L' }
  try {
    const big = await order('SPBIG0001', [{ ...G, qty: 10 }, { ...N, qty: 10 }, { ...T, qty: 1 }])
    is(big.status === 400 && big.body?.error === 'cart_too_large',
       '21 pieces in one order are refused with cart_too_large', `${big.status} ${big.body?.error}`)
    is(await rows('SPBIG0001') === 0, 'and no order row is written for it')
    const left = await stockSum()
    is(left === 30, 'and not one garment was claimed by it', `${left} of 30 left`)

    const bigCod = await order('SPBIG0002', [{ ...G, qty: 10 }, { ...N, qty: 10 }, { ...T, qty: 1 }],
      { payment_method: 'cod', customer: { ...CUSTOMER, phone: '95550201' } })
    is(bigCod.status === 400 && bigCod.body?.error === 'cart_too_large',
       'the same cap holds for cash on delivery — every payment method', `${bigCod.status} ${bigCod.body?.error}`)

    // Stock is counted per item and size, so that is how the cap counts too:
    // two lines (here, two fits) of one size are one variant.
    const split = await order('SPBIG0003', [{ ...G, qty: 6 }, { ...G, qty: 5, fit: 'oversize' }])
    is(split.status === 400 && split.body?.error === 'cart_too_large',
       'one size split across two lines is still one size: 6 + 5 of it is refused',
       `${split.status} ${split.body?.error}`)

    const most = await order('SPBIG0004', [{ ...G, qty: 10 }, { ...N, qty: 10 }])
    is(most.status === 200 && !most.body?.error,
       'exactly 20 pieces, 10 of each of two sizes, is accepted', `${most.status} ${most.body?.error ?? ''}`)
    const after = await stockSum()
    is(after === 10, 'and claims exactly those twenty', `${after} of 30 left`)

    const bags = await order('SPBIG0005', [{ slug: 'cagliari-calcio-backpack', qty: 21 }])
    is(bags.status === 400 && bags.body?.error === 'cart_too_large',
       'an untracked accessory counts towards the total too — 21 backpacks are refused',
       `${bags.status} ${bags.body?.error}`)
  } finally {
    for (const pair of saved.split(',')) {
      const [sku, n] = pair.split('=')
      await run('mariadb', ['sporta', '-e', `update product_variants set stock = ${Number(n)} where sku = '${sku}'`])
    }
    await run('mariadb', ['sporta', '-e', "delete from orders where track_id like 'SPBIG%'; delete from rate_limit"])
  }
}

// ---------------------------------------------------------------------------
// TELLING CLIENTS APART — a second store, behind a "proxy"
//
// The store on :8095 trusts no proxy, so every request reaches it from
// 127.0.0.1 and no per-client or per-account rule can be tested there: every
// "other client" is the same client. So a second store is started here on
// the same code and the same database, whose config trusts 127.0.0.1 as its
// proxy — the VPS shape, Traefik in front — so X-Forwarded-For names the
// client. It has a known rate_limit_secret, so a test can find one bucket's
// row and move its window, and its mail goes to a fake MTA on disk
// (scripts/fake-mta.sh). A third, with a slow MTA, is there for checks that
// compare response times. Both run several workers, so requests sent at once
// really are handled at once. Both are killed when this block ends.
{
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawn } = await import('node:child_process')
  const { createHmac, createHash } = await import('node:crypto')
  const net = await import('node:net')

  const ROOT = new URL('..', import.meta.url).pathname
  const STORE_DIR = join(ROOT, 'dropin/php-store')
  const MTA = join(ROOT, 'scripts/fake-mta.sh')
  const tmp = mkdtempSync(join(tmpdir(), 'sporta-proxied-'))
  const maildir = join(tmp, 'mail')
  const slowMaildir = join(tmp, 'mail-slow')
  mkdirSync(maildir)
  mkdirSync(slowMaildir)

  // A PHP config that is the sandbox's own config.php plus a few keys. The
  // extra keys come FIRST in the union, so they win even if config.php ever
  // grows the same ones.
  const RL_SECRET = 'test-rl'
  const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const phpVal = (v) => (typeof v === 'number' ? String(v)
    : Array.isArray(v) ? `[${v.map(phpStr).join(', ')}]` : phpStr(v))
  const writeConfig = (file, extra) => writeFileSync(file,
    `<?php\nreturn [\n${Object.entries(extra).map(([k, v]) => `  ${phpStr(k)} => ${phpVal(v)},`).join('\n')}\n]` +
    ` + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)
  const CFG = join(tmp, 'api-config.php')
  writeConfig(CFG, {
    trusted_proxy_ips: ['127.0.0.1'],
    rate_limit_secret: RL_SECRET,
    cron_key: 'test-cron-key-0123456789',
    cod_hold_hours: 24,
    admin_mail_from: 'cs@sporta.com.kw',
    customer_mail_from: 'noreply@sporta.com.kw',
  })

  // Free ports, never assumed: the sandbox already runs the KNET rig on
  // :8097/:8098, and another suite may be holding anything else.
  const isFree = (p) => new Promise((res) => {
    const s = net.createServer().once('error', () => res(false))
      .once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
  })
  const freePort = async (from) => {
    for (let p = from; p < from + 100; p++) if (await isFree(p)) return p
    throw new Error(`no free port from ${from}`)
  }
  const servers = []
  const killAll = () => { for (const s of servers) { try { s.kill() } catch { /* gone */ } } }
  process.on('exit', killAll)
  const startStore = async (port, dir, env = {}) => {
    const srv = spawn('php', ['-d', `sendmail_path=sh ${MTA} ${dir}`, '-S', `127.0.0.1:${port}`, '-t', STORE_DIR], {
      stdio: 'ignore',
      env: { ...process.env, SPORTA_API_CONFIG_FILE: CFG, PHP_CLI_SERVER_WORKERS: '4', ...env },
    })
    servers.push(srv)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100))
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api.php?r=checkout_config`)
        if (r.status === 200) return true
      } catch { /* still starting */ }
    }
    return false
  }
  const PORT = await freePort(Number(process.env.PROXIED_PORT ?? 8197))
  is(await startStore(PORT, maildir), `a second store, behind a trusted "proxy", is up on :${PORT}`)
  const SLOW_PORT = await freePort(Math.max(PORT + 1, Number(process.env.PROXIED_SLOW_PORT ?? 8198)))
  is(await startStore(SLOW_PORT, slowMaildir, { MTA_DELAY: '0.4' }),
     `and a third with a slow mail relay, on :${SLOW_PORT}`)

  const PBASE = `http://127.0.0.1:${PORT}`
  const sql = async (s) =>
    (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', s])).stdout.trim()
  // The bucket key store_rate_limit_key() computes, with this config's secret.
  const rlKey = (bucket, id) => createHmac('sha256', RL_SECRET).update(`${bucket}|${id}`).digest('hex').slice(0, 32)
  // One request "from" a client. A jar, when given, is a Map of every cookie
  // the server set — all of them: the one-line jar at the top of this file
  // keeps only the first, and would lose the device cookie.
  const at = async (ip, path, { method = 'GET', body, jar, headers = {}, base = PBASE } = {}) => {
    const res = await fetch(`${base}/${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip,
        'X-Sporta-Admin': '1',
        'Sec-Fetch-Site': 'same-origin',
        ...(jar && jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (jar) {
      for (const c of set) {
        const pair = c.split(';')[0]
        const i = pair.indexOf('=')
        const name = pair.slice(0, i).trim()
        const value = pair.slice(i + 1).trim()
        if (value === '' || value === 'deleted' || /max-age=0(;|$)/i.test(c)) jar.delete(name)
        else jar.set(name, value)
      }
    }
    return { status: res.status, body: await res.json().catch(() => null), set }
  }
  const mails = (dir = maildir) =>
    readdirSync(dir).filter((f) => f.endsWith('.eml')).sort().map((f) => readFileSync(join(dir, f), 'utf8'))
  const mailsTo = (addr, dir = maildir) =>
    mails(dir).filter((m) => m.split(/\r?\n/).some((l) => /^To:/i.test(l) && l.includes(addr)))
  // RFC 6238, the same six digits a phone shows: HMAC-SHA1 over the 30-second
  // step, dynamic truncation, mod 10^6.
  const base32 = (s) => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = ''
    for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, '0')
    const out = []
    for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
    return Buffer.from(out)
  }
  const totp = (secret, t = Date.now() / 1000) => {
    const step = Buffer.alloc(8)
    step.writeBigUInt64BE(BigInt(Math.floor(t / 30)))
    const h = createHmac('sha1', base32(secret)).update(step).digest()
    const o = h[19] & 15
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
  }
  // Six digits that are certainly WRONG right now (the server accepts the
  // step either side of the current one; two either side are avoided here).
  const wrongCode = (secret) => {
    const now = Date.now() / 1000
    const valid = new Set([-60, -30, 0, 30, 60].map((d) => totp(secret, now + d)))
    for (let i = 0; ; i++) {
      const c = String((123457 + i * 7919) % 1e6).padStart(6, '0')
      if (!valid.has(c)) return c
    }
  }
  // Poll for something written after a response has already been sent.
  const waitFor = async (fn, ms = 3000) => {
    for (let t = 0; t < ms; t += 50) {
      const v = fn()
      if (v) return v
      await new Promise((r) => setTimeout(r, 50))
    }
    return fn()
  }
  const hashOf = async (pw) => (await run('php', ['-r',
    `require ${phpStr(join(STORE_DIR, 'store.php'))}; echo store_admin_hash_password(${phpStr(pw)});`])).stdout

  // Accounts of the suite's own, so nothing here changes the password, the
  // phone code or the lock of the sandbox admin other suites sign in as. The
  // top of this file deletes every admin but cs@ on the next run anyway.
  const OWNER = 'rl-owner@example.test'
  const OWNER_PW = 'rl-owner-password-0001'
  const MFA = 'rl-mfa@example.test'
  const MFA_PW = 'rl-mfa-password-0001'
  const OTHER = 'rl-other@example.test'
  const SECRET = 'JBSWY3DPEHPK3PXP'
  const RECOVERY = 'ABCDEF0123ABCDEF0123'
  for (const f of ['admin-totp.mysql.sql', 'admin-recovery-codes.mysql.sql', 'customers.mysql.sql']) {
    await run('mariadb', ['sporta', '-e', `source ${join(STORE_DIR, f)}`])
  }
  await sql(`delete from admin_users where email in ('${OWNER}', '${MFA}', '${OTHER}')`)
  await sql(`insert into admin_users (email, password_hash) values
             ('${OWNER}', '${await hashOf(OWNER_PW)}'), ('${MFA}', '${await hashOf(MFA_PW)}')`)
  const MFA_ID = await sql(`select id from admin_users where email = '${MFA}'`)
  await sql(`update admin_users set totp_enabled = 1, totp_secret = '${SECRET}', totp_last_step = null where id = ${MFA_ID}`)
  await sql(`insert into admin_recovery_codes (admin_id, code_hash)
             values (${MFA_ID}, '${createHash('sha256').update(RECOVERY).digest('hex')}')`)
  await sql('delete from rate_limit')

  const login = (ip, email, password, jar, headers) =>
    at(ip, 'admin.php?r=login', { method: 'POST', body: { email, password }, jar, headers })

  try {
    // ------------------------------------------- admin: a browser the owner uses
    //
    // Five wrong passwords used to set the account's locked_until, and the
    // per-address window refused the sixth attempt from ANY browser — so a
    // stranger who knew the admin address kept the only owner out for about
    // five requests every fifteen minutes. Wrong passwords now lock no row,
    // and a browser that has signed in before is counted in a window of its
    // own.
    {
      const DEV = 'sporta_dev'
      const b1 = new Map()
      const b2 = new Map()
      const first = await login('203.0.113.10', OWNER, OWNER_PW, b1)
      const devSet = first.set.find((c) => c.startsWith(`${DEV}=`)) ?? ''
      is(first.status === 200 && /^[a-f0-9]{32}\.[a-f0-9]{32}$/.test(b1.get(DEV) ?? ''),
         'a successful sign-in gives the browser a device cookie', b1.get(DEV) ?? first.set.join(' | '))
      is(/HttpOnly/i.test(devSet) && /SameSite=Strict/i.test(devSet) && /path=\/(;|$)/i.test(devSet)
         && /Max-Age=15552000/i.test(devSet) && !/domain=/i.test(devSet),
         'HttpOnly, SameSite=Strict, Path=/, no Domain, kept for 180 days', devSet)
      is(/^sporta_admin=/.test(first.set[0] ?? ''),
         'and the SESSION cookie is still the first one a sign-in sets', first.set[0] ?? '(none)')

      const second = await login('203.0.113.11', OWNER, OWNER_PW, b2)
      is(second.status === 200 && b2.get(DEV) && b2.get(DEV) !== b1.get(DEV),
         'a second browser gets a device id of its own')
      const again = await login('203.0.113.10', OWNER, OWNER_PW, b1)
      is(again.status === 200 && !again.set.some((c) => c.startsWith(`${DEV}=`)),
         'and a browser already holding a valid one keeps it — it is not re-issued on every sign-in')
      const secure = await login('203.0.113.12', OWNER, OWNER_PW, new Map(), { 'X-Forwarded-Proto': 'https' })
      const secureSet = secure.set.find((c) => c.startsWith('__Host-sporta_dev=')) ?? ''
      is(secure.status === 200 && /;\s*secure/i.test(secureSet),
         'over HTTPS it is __Host-sporta_dev and Secure, like the session cookie', secureSet || secure.set.join(' | '))

      const stranger = []
      for (let i = 0; i < 6; i++) stranger.push((await login('198.51.100.66', OWNER, `wrong-${i}`)).status)
      is(stranger.join(',') === '401,401,401,401,429,429',
         'six wrong passwords from a stranger: 401 four times, then 429', stranger.join(','))
      const row = await sql(`select failed_attempts, coalesce(locked_until, 'NULL') from admin_users where email = '${OWNER}'`)
      is(row === '0\tNULL', 'and the account ROW is untouched — a wrong password locks nothing', row)

      const devOnly = (jar) => new Map(jar.has(DEV) ? [[DEV, jar.get(DEV)]] : [])
      const known = await login('192.0.2.10', OWNER, OWNER_PW, devOnly(b1))
      is(known.status === 200, 'the owner, on a browser they have used, still signs in — from a new address too',
         `${known.status} ${known.body?.error ?? ''}`)
      const unknown = await login('192.0.2.11', OWNER, OWNER_PW)
      is(unknown.status === 429 && unknown.body?.error === 'too_many_attempts',
         'a browser never used before waits the window out — the accepted trade-off',
         `${unknown.status} ${unknown.body?.error ?? ''}`)

      const [devId = '', mac = ''] = (b1.get(DEV) ?? '').split('.')
      const flipped = mac.slice(0, -1) + (mac.endsWith('0') ? '1' : '0')
      const tampered = await login('192.0.2.12', OWNER, OWNER_PW, new Map([[DEV, `${devId}.${flipped}`]]))
      is(tampered.status === 429, 'a device cookie whose MAC does not verify counts as an unknown browser',
         `${tampered.status} ${tampered.body?.error ?? ''}`)
      for (let i = 0; i < 5; i++) await login('198.51.100.67', OTHER, `wrong-${i}`)
      const borrowed = await login('192.0.2.13', OTHER, 'any-password-at-all', devOnly(b1))
      is(borrowed.status === 429, "and one account's device cookie is no good for another account",
         `${borrowed.status} ${borrowed.body?.error ?? ''}`)

      const own = []
      for (let i = 0; i < 6; i++) own.push((await login(`192.0.2.${20 + i}`, OWNER, `typo-${i}`, devOnly(b1))).status)
      is(own.join(',') === '401,401,401,401,429,429',
         'a known browser has a window of its own, the same size — five, not more', own.join(','))
      const otherBrowser = await login('192.0.2.30', OWNER, OWNER_PW, devOnly(b2))
      is(otherBrowser.status === 200, 'and filling it does not reach the owner’s other browser',
         `${otherBrowser.status} ${otherBrowser.body?.error ?? ''}`)

      // A reset is proof of the mailbox, and how a NEW browser gets in.
      const mailedBefore = mailsTo(OWNER).length
      const forgot = await at('192.0.2.31', 'admin.php?r=forgot_password', { method: 'POST', body: { email: OWNER } })
      // The answer now goes out BEFORE the mail is written (see the timing
      // check further down), so wait for the mail rather than expecting it.
      const token = (await waitFor(() => mailsTo(OWNER).slice(mailedBefore)
        .map((m) => m.match(/#reset=([a-f0-9]{64})/)?.[1]).find(Boolean)))
      is(forgot.status === 200 && !!token, 'forgot password mails the owner a reset link', `${forgot.status} ${token ? 'token' : 'no mail'}`)
      const NEW_PW = 'rl-owner-password-0002'
      const reset = await at('192.0.2.32', 'admin.php?r=reset_password', { method: 'POST', body: { token, password: NEW_PW } })
      is(reset.status === 200, 'the link resets the password', `${reset.status} ${reset.body?.error ?? ''}`)
      const fresh = await login('192.0.2.33', OWNER, NEW_PW)
      is(fresh.status === 200,
         'and the NEW password works at once from a browser never used before — the reset empties the shared window',
         `${fresh.status} ${fresh.body?.error ?? ''}`)
    }

    // ------------------------------------------------------ coupon guessing
    //
    // Only failures are counted, so a 429 used to mean "wrong" and a 200 still
    // came back for a right code from the same client. Now a full bucket
    // refuses every lookup from that client, and both routes that take a code
    // share one budget.
    {
      await sql('delete from rate_limit; delete from discounts')
      await sql("insert into discounts (kind, code, label, type, value, min_order, active) values ('code','REALCODE','1 off','fixed',1,0,1)")
      const cart = [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'L' }]
      const check = (ip, code) => at(ip, 'api.php?r=discount', { method: 'POST', body: { items: cart, code } })
      const orderAt = (ip, track, code) => at(ip, 'api.php?r=order', { method: 'POST',
        body: { track_id: track, items: cart, customer: CUSTOMER, payment_method: 'knet', discount_code: code } })
      const [A, B, C, D, E] = ['198.18.0.1', '198.18.0.2', '198.18.0.3', '198.18.0.4', '198.18.0.5']

      const a = []
      for (let i = 0; i < 30; i++) a.push((await check(A, `WRONG${i}`)).status)
      is(a.every((s) => s === 400), 'thirty wrong codes from one client are each answered 400', [...new Set(a)].join(','))
      const aReal = await check(A, 'REALCODE')
      is(aReal.status === 429 && aReal.body?.error === 'too_many_attempts',
         'then the next lookup is refused EVEN WITH A REAL CODE — a 429 says nothing about the code',
         `${aReal.status} ${aReal.body?.error ?? aReal.body?.discount}`)
      const bReal = await check(B, 'REALCODE')
      is(bReal.status === 200 && bReal.body?.discount === 1, 'the same real code from another client works',
         `${bReal.status} ${bReal.body?.discount ?? bReal.body?.error}`)
      const c = []
      for (let i = 0; i < 40; i++) c.push((await check(C, 'REALCODE')).status)
      is(c.every((s) => s === 200), 'forty successful checks from one client are never counted — only failures are',
         [...new Set(c)].join(','))

      const d = []
      for (let i = 0; i < 30; i++) {
        // The ORDER route has its own arrival limit (20 per ten minutes); move
        // that one bucket out of the way, or it would answer first.
        if (i === 15) await sql(`delete from rate_limit where bucket_key = '${rlKey('order', D)}'`)
        d.push((await orderAt(D, `SPGUESS${i}`, `WRONG${i}`)).body?.error)
      }
      is(d.every((e) => e === 'discount_unknown'), 'thirty wrong codes through the ORDER route are each refused as unknown',
         [...new Set(d)].join(','))
      const dReal = await orderAt(D, 'SPGUESSREAL', 'REALCODE')
      is(dReal.status === 429 && dReal.body?.error === 'too_many_attempts',
         'and they use up the same budget: a real code is then refused there too',
         `${dReal.status} ${dReal.body?.error ?? ''}`)
      is(await sql("select count(*) from orders where track_id like 'SPGUESS%'") === '0',
         'and none of it wrote an order')

      const e = []
      for (let i = 0; i < 15; i++) e.push((await orderAt(E, `SPMIX${i}`, `WRONGO${i}`)).status)
      for (let i = 0; i < 15; i++) e.push((await check(E, `WRONGD${i}`)).status)
      const eNext = await check(E, 'REALCODE')
      is(e.every((s) => s === 400) && eNext.status === 429,
         'one budget across both routes: 15 wrong orders + 15 wrong previews, then 429',
         `${[...new Set(e)].join(',')} then ${eNext.status}`)

      const noCode = await orderAt(A, 'SPNOCODE1', '')
      is(noCode.status === 200, 'but an order WITHOUT a code is not a guess, and is served even from a client over the limit',
         `${noCode.status} ${noCode.body?.error ?? ''}`)
      await sql("delete from rate_limit; delete from discounts; delete from orders where track_id like 'SPNOCODE%'")
    }

    // ------------------------------------------------ the phone-code step
    //
    // Only somebody holding the password gets here, and the row lock alone
    // still let them try ~480 codes a day. Now: 20 code checks per account
    // per day, counted before the code is looked at; the lock count restarts
    // once a lock has expired; and the account is mailed once per lock and
    // once per day — never once per guess.
    {
      await sql('delete from rate_limit')
      await sql(`update admin_users set failed_attempts = 0, locked_until = null, totp_last_step = null where id = ${MFA_ID}`)
      let n = 0
      const ip = () => { n++; return `100.64.${Math.floor(n / 250)}.${(n % 250) + 1}` }
      // One pending sign-in, and one address for its codes (the 'totp' bucket
      // is ten per client per five minutes; no session here sends more than five).
      const signIn = async () => {
        const jar = new Map()
        const r = await login(ip(), MFA, MFA_PW, jar)
        return { jar, status: r.status, ip: ip() }
      }
      const code = (s, value) => at(s.ip, 'admin.php?r=login_code', { method: 'POST', body: { code: value }, jar: s.jar })
      const expire = () => sql(`update admin_users set locked_until = now() - interval 1 second
                                 where id = ${MFA_ID} and locked_until is not null`)
      const alerts = () => mailsTo(MFA).length

      const m0 = alerts()
      const s1 = await signIn()
      is(s1.status === 202, 'the password is right, so a phone code is asked for (202)', String(s1.status))
      const five = []
      for (let i = 0; i < 5; i++) five.push(await code(s1, wrongCode(SECRET)))
      is(five.slice(0, 4).every((r) => r.status === 401 && r.body?.error === 'bad_code')
         && five[4].status === 429 && five[4].body?.error === 'locked',
         'four wrong codes are 401 bad_code; the fifth locks the account (429 locked)',
         five.map((r) => `${r.status} ${r.body?.error}`).join(', '))
      is(alerts() - m0 === 1,
         'and the account is mailed ONCE that somebody has its password — one mail per lock, not one per code',
         `${alerts() - m0} mail(s)`)

      await expire()
      const s2 = await signIn()
      const sixth = await code(s2, wrongCode(SECRET))
      is(sixth.status === 401 && sixth.body?.error === 'bad_code',
         'once a lock has expired the count starts again — the next wrong code is 401, not an instant re-lock',
         `${sixth.status} ${sixth.body?.error}`)
      const counter = await sql(`select failed_attempts from admin_users where id = ${MFA_ID}`)
      is(counter === '1', 'the counter restarted at one', counter)

      // Code checks 7 to 20 of the day, letting each lock run out as it trips.
      let s = s2
      for (let evals = 6; evals < 20;) {
        const r = await code(s, wrongCode(SECRET))
        evals++
        if (r.status === 429) { await expire(); if (evals < 20) s = await signIn() }
      }
      await expire()
      const s5 = await signIn()
      const before = alerts()
      const right = await code(s5, totp(SECRET))
      const rowLocked = await sql(`select coalesce(locked_until > now(), 0) from admin_users where id = ${MFA_ID}`)
      is(right.status === 429 && right.body?.error === 'locked' && rowLocked === '0',
         'after twenty code checks in a day even the RIGHT code is refused — by the daily ceiling, not the row lock',
         `${right.status} ${right.body?.error} row locked=${rowLocked}`)
      await code(s5, totp(SECRET))
      await code(s5, wrongCode(SECRET))
      is(alerts() - before === 1, 'and the account is told once for the day, not once per attempt',
         `${alerts() - before} mail(s)`)
      const alert = mailsTo(MFA).at(-1) ?? ''
      is(/wrong sign-in codes/i.test(alert) && /Forgot password/.test(alert) && !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(alert),
         'the mail says what happened and what to do, and carries no address', alert.split(/\r?\n/).find((l) => /^Subject:/i.test(l)) ?? '')
      const rec = await code(s5, RECOVERY)
      is(rec.status === 200 && rec.body?.email === MFA,
         'a recovery code still gets the owner in — it is not six guessable digits', `${rec.status} ${rec.body?.error ?? ''}`)

      // Many at once. The row lock is checked, then the code: requests that
      // arrive together all see "not locked". The daily ceiling is counted
      // BEFORE the check, so however many arrive, at most twenty are tried.
      await sql(`delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null where id = ${MFA_ID}`)
      const pending = []
      for (let i = 0; i < 48; i++) pending.push(await signIn())
      is(pending.every((p) => p.status === 202), 'forty-eight sign-ins are each waiting for a code',
         [...new Set(pending.map((p) => p.status))].join(','))
      const burstBefore = alerts()
      const burst = await Promise.all(pending.map((p) => code(p, wrongCode(SECRET))))
      const tried = burst.filter((r) => r.body?.error === 'bad_code').length
      is(tried <= 20, 'forty-eight wrong codes sent at once: at most twenty are ever checked',
         `${tried} bad_code, ${burst.length - tried} refused`)
      const burstMail = alerts() - burstBefore
      is(burstMail >= 1 && burstMail <= 2, 'and the burst cannot flood the inbox — one lock mail, at most one daily one',
         `${burstMail} mail(s)`)
    }

    // --------------------------------------- unconfirmed cash orders expire
    //
    // Owner's decision, 2026-11-02: a COD order still pending and unfulfilled
    // 24 hours after it was placed is cancelled and its stock put back, by the
    // same sweeper the VPS runs every fifteen minutes. Anything packed or paid
    // is never touched.
    {
      const PHONE = '95550101'
      const CANON = '96595550101'
      const SKU = 'A-CST-NA-L'
      await sql(`delete from orders where customer_phone = '${CANON}'; delete from rate_limit`)
      const s0 = Number(await sql(`select stock from product_variants where sku = '${SKU}'`))
      const stock = async () => Number(await sql(`select stock from product_variants where sku = '${SKU}'`))
      const tag = Date.now().toString(36).toUpperCase()
      const track = (i) => `SPHOLD${i}${tag}`
      const codOrder = (t) => at('203.0.113.50', 'api.php?r=order', { method: 'POST', body: {
        track_id: t, items: [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }],
        customer: { ...CUSTOMER, phone: PHONE }, payment_method: 'cod' } })
      const state = (t) => sql(`select fulfilment_status, stock_released from orders where track_id = '${t}'`)
      const cron = async (configFile) => {
        const env = { ...process.env }
        delete env.SPORTA_API_CONFIG_FILE
        if (configFile) env.SPORTA_API_CONFIG_FILE = configFile
        const { stdout } = await run('php', [join(STORE_DIR, 'cron-stock.php'), '--release'], { env })
        return JSON.parse(stdout)
      }
      try {
        const placed = []
        for (let i = 1; i <= 3; i++) placed.push((await codOrder(track(i))).status)
        is(placed.every((st) => st === 200) && await stock() === s0 - 3,
           'three cash orders from one phone are accepted, each holding its garment', placed.join(','))
        const full = await codOrder(track(4))
        is(full.status === 409 && full.body?.error === 'too_many_open_cod',
           'and a fourth is refused while those three are open', `${full.status} ${full.body?.error}`)

        await sql(`update orders set created_at = now() - interval 25 hour where track_id = '${track(1)}';
                   update orders set created_at = now() - interval 23 hour where track_id = '${track(2)}';
                   update orders set created_at = now() - interval 25 hour, fulfilment_status = 'packed'
                    where track_id = '${track(3)}'`)
        const out = await cron(CFG)
        // Only this block's orders are judged: the sandbox database is shared.
        const mine = (out.cod_cancelled ?? []).filter((t) => t.endsWith(tag))
        is(out.cod_hold_hours === 24 && mine.length === 1 && mine[0] === track(1),
           'the sweeper cancels the unconfirmed cash order older than 24 hours — and only that one',
           JSON.stringify(mine))
        is(await state(track(1)) === 'cancelled\t1', 'it is CANCELLED and its stock released, together', await state(track(1)))
        is(await state(track(2)) === 'unfulfilled\t0', 'a cash order 23 hours old is left alone', await state(track(2)))
        is(await state(track(3)) === 'packed\t0', 'and one the shop has PACKED is never touched, however old',
           await state(track(3)))
        is(await stock() === s0 - 2, 'the cancelled order’s garment is back on the shelf', `${s0 - await stock()} held`)
        const hasEvents = await sql("select count(*) from information_schema.tables where table_schema = 'sporta' and table_name = 'order_tracking_events'")
        if (hasEvents === '1') {
          const ev = await sql(`select count(*) from order_tracking_events e join orders o on o.id = e.order_id
                                 where o.track_id = '${track(1)}' and e.status = 'cancelled'`)
          is(ev === '1', 'and the customer’s tracking timeline says cancelled', ev)
        }
        const freed = await codOrder(track(5))
        is(freed.status === 200, "the phone's cash slot is free again — a new order is accepted",
           `${freed.status} ${freed.body?.error ?? ''}`)
        const rerun = await cron(CFG)
        is(!rerun.track_ids.includes(track(1)) && await stock() === s0 - 3,
           'and a second run puts nothing back twice', JSON.stringify(rerun.track_ids))

        await sql(`update orders set created_at = now() - interval 25 hour where track_id = '${track(2)}'`)
        const CFG0 = join(tmp, 'api-config-hold-off.php')
        writeConfig(CFG0, { cod_hold_hours: 0 })
        const off = await cron(CFG0)
        is(off.cod_hold_hours === 0 && await state(track(2)) === 'unfulfilled\t0',
           'cod_hold_hours = 0 switches the expiry off', `${off.cod_hold_hours} ${await state(track(2))}`)
        const dflt = await cron(null)
        is(dflt.cod_hold_hours === 24 && await state(track(2)) === 'cancelled\t1',
           'and a config that does not mention it gets the default, 24 hours',
           `${dflt.cod_hold_hours} ${await state(track(2))}`)
      } finally {
        await sql(`delete from orders where customer_phone = '${CANON}';
                   update product_variants set stock = ${s0} where sku = '${SKU}'; delete from rate_limit`)
      }
    }

    // ------------------------------- a cash order the warehouse has heard of
    //
    // A cash order's picking list says COLLECT CASH, which means ship. Putting
    // the order back on the shelf in the database does not stop a van, so
    // every cancel queues a 'cancel' row ("CANCELLED — do not ship") in the
    // SAME transaction, and the drain mails it. Reinstating an order that was
    // answered with a do-not-ship sends the picking list again, marked
    // REINSTATED. Cash cannot be marked paid once cancelled, and a paid order
    // that has left the shop gets no "ship it". Every step below is a real
    // path — the order API, the sweeper, the admin routes and the drain. No
    // outbox row is written by hand; the only state that is set directly is an
    // age, or a block on a picking list, which the earlier checks do the same.
    {
      const WH = 'warehouse-cash@example.test'
      const CFG_W = join(tmp, 'api-config-cash.php')
      writeConfig(CFG_W, { warehouse_email: WH, mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw', warehouse_retry_window_minutes: 0 })
      const subjectOf = (m) => {
        const raw = m.split(/\r?\n/).find((l) => /^Subject:/i.test(l)) ?? ''
        const b = raw.match(/=\?UTF-8\?B\?([^?]+)\?=/i)?.[1]
        return b ? Buffer.from(b, 'base64').toString('utf8') : raw
      }
      // Every message the warehouse has been sent about one order, oldest first.
      const heard = (track) => mailsTo(WH).filter((m) => subjectOf(m).includes(track))
      const subjects = (track) => heard(track).map(subjectOf)
      const drain = async () => {
        for (let i = 0; i < 30; i++) {
          const env = { ...process.env, SPORTA_API_CONFIG_FILE: CFG_W }
          const out = JSON.parse((await run('php', ['-d', `sendmail_path=sh ${MTA} ${maildir}`,
            join(STORE_DIR, 'cron-fulfilment.php'), '--run'], { env })).stdout)
          if (!out.claimed) break
        }
      }
      const release = async () => {
        const env = { ...process.env, SPORTA_API_CONFIG_FILE: CFG }
        return JSON.parse((await run('php', [join(STORE_DIR, 'cron-stock.php'), '--release'], { env })).stdout)
      }
      // Fixed-width numbers, so no track id is a prefix of another.
      const tag = Date.now().toString(36).toUpperCase()
      const T = (n) => `SP${tag}C${String(n).padStart(2, '0')}`
      const idOf = async (n) => Number(await sql(`select id from orders where track_id = '${T(n)}'`))
      const cashOrder = (n, phone) => at(`198.31.0.${n}`, 'api.php?r=order', { method: 'POST', body: {
        track_id: T(n), items: [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }],
        customer: { ...CUSTOMER, phone }, payment_method: 'cod' } })
      const outbox = async (n, kind, open = false) => Number(await sql(`select count(*) from fulfilment_outbox f
          join orders o on o.id = f.order_id
         where o.track_id = '${T(n)}' and f.kind = '${kind}'${open ? ' and f.sent_at is null' : ''}`))
      const stock = async () => Number(await sql("select stock from product_variants where slug = 'cloudsoft-top-navy' and size = 'L'"))
      const status = async (n) => sql(`select fulfilment_status from orders where track_id = '${T(n)}'`)
      const age = (n, hours) => sql(`update orders set created_at = now() - interval ${hours} hour where track_id = '${T(n)}'`)
      const JAR = new Map()
      const adminAt = (route, body) => at('198.31.9.1', `admin.php?r=${route}`, { method: 'POST', body, jar: JAR })
      const stock0 = await stock()
      try {
        await sql("delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null where email = 'cs@sporta.com.kw'")
        const signed = await at('198.31.9.1', 'admin.php?r=login', { method: 'POST',
          body: { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }, jar: JAR })
        is(signed.status === 200, 'the owner signs in to the admin for the cash checks', `${signed.status} ${signed.body?.error ?? ''}`)

        // 1. The picking list HAS gone, and the sweeper cancels the order.
        const c1 = await cashOrder(1, '95550601')
        is(c1.status === 200, 'cash order 1 is placed', String(c1.status))
        await drain()
        is(subjects(T(1)).some((s) => /COLLECT CASH/.test(s)), 'its picking list has reached the warehouse')
        await age(1, 25)
        const out1 = await release()
        is(out1.cod_cancelled?.includes(T(1)), 'the sweeper cancels it at 25 hours')
        is(await outbox(1, 'cancel', true) === 1,
           'and queues the do-not-ship in the same transaction — one open cancel row', String(await outbox(1, 'cancel', true)))
        await drain()
        const cancelMail = heard(T(1)).filter((m) => /CANCELLED/.test(subjectOf(m)))
        is(cancelMail.length === 1 && /do not ship/.test(subjectOf(cancelMail[0])),
           'the warehouse is told: CANCELLED — do not ship', subjects(T(1)).join(' | '))
        is(cancelMail.length === 1 && !cancelMail[0].includes('Fatima') && !cancelMail[0].includes('95550601'),
           'and the do-not-ship names no customer, phone or address')

        // 2. The warehouse never heard of it: cancelled, and nothing is mailed.
        const c2 = await cashOrder(2, '95550602')
        is(c2.status === 200, 'cash order 2 is placed, and no picking list is sent for it', String(c2.status))
        await age(2, 25)
        const out2 = await release()
        is(out2.cod_cancelled?.includes(T(2)), 'and the sweeper cancels it too')
        await drain()
        is(subjects(T(2)).length === 0, 'an order the warehouse never heard of is NOT mailed at all — not even the do-not-ship',
           subjects(T(2)).join(' | '))

        // 3. The shop cancels by hand.
        const c3 = await cashOrder(3, '95550603')
        is(c3.status === 200, 'cash order 3 is placed', String(c3.status))
        await drain()
        const id3 = await idOf(3)
        const byHand = await adminAt('fulfilment', { order_id: id3, status: 'cancelled' })
        is(byHand.status === 200 && byHand.body?.ok === true, 'the admin cancels cash order 3 by hand', `${byHand.status} ${byHand.body?.error ?? ''}`)
        is(await outbox(3, 'cancel', true) === 1, 'and that queues the same do-not-ship, once')
        const again = await adminAt('fulfilment', { order_id: id3, status: 'cancelled' })
        is(again.status === 200 && await outbox(3, 'cancel') === 1,
           'saving a cancelled order again does not queue a second do-not-ship', `${again.status} ${await outbox(3, 'cancel')}`)
        await drain()
        is(subjects(T(3)).some((s) => /CANCELLED.*do not ship/.test(s)), 'the warehouse is told by hand, too')

        // 4. Put it back: the picking list goes again, marked REINSTATED.
        const back = await adminAt('fulfilment', { order_id: id3, status: 'packed' })
        is(back.status === 200 && back.body?.ok === true, 'the admin puts cancelled order 3 back to packed', `${back.status} ${back.body?.error ?? ''}`)
        await drain()
        is(subjects(T(3)).some((s) => /REINSTATED/.test(s)),
           'and the warehouse is told it is on again: REINSTATED, the picking list once more', subjects(T(3)).join(' | '))

        // …and the garment comes back with it. Released by the sweeper, then
        // put back by hand while its size has sold out: refused, and the order
        // stays cancelled. Then the shelf is restocked and it goes through.
        const before4 = await stock()
        const c4 = await cashOrder(4, '95550604')
        is(c4.status === 200 && await stock() === before4 - 1, 'cash order 4 is placed, holding its garment', String(c4.status))
        const id4 = await idOf(4)
        await adminAt('fulfilment', { order_id: id4, status: 'cancelled' })
        await release()
        is(await stock() === before4, 'cancelled by hand, the sweeper puts its garment back', `${before4} expected, ${await stock()} now`)
        await sql("update product_variants set stock = 0 where slug = 'cloudsoft-top-navy' and size = 'L'")
        const sold = await adminAt('fulfilment', { order_id: id4, status: 'packed' })
        is(sold.status === 409 && sold.body?.error === 'out_of_stock_cloudsoft-top-navy_L_0',
           'putting a sold-out cash order back is refused, with the checkout\'s own token', `${sold.status} ${sold.body?.error}`)
        is(await status(4) === 'cancelled', 'and the order stays cancelled', await status(4))
        await sql("update product_variants set stock = 1 where slug = 'cloudsoft-top-navy' and size = 'L'")
        const restocked = await adminAt('fulfilment', { order_id: id4, status: 'packed' })
        is(restocked.status === 200 && await status(4) === 'packed' && await stock() === 0,
           'and once the size is back it claims the garment again', `${restocked.status} ${await status(4)} stock ${await stock()}`)

        // 5. A cancelled order cannot be marked paid — the stock is not held.
        // The last check left this size at zero; the shelf is stocked again
        // for the checks that place orders.
        await sql("update product_variants set stock = 1000 where slug = 'cloudsoft-top-navy' and size = 'L'")
        const c5 = await cashOrder(5, '95550605')
        is(c5.status === 200, 'cash order 5 is placed', String(c5.status))
        const id5 = await idOf(5)
        await adminAt('fulfilment', { order_id: id5, status: 'cancelled' })
        const settled = await adminAt('cod_paid', { order_id: id5, paid: true })
        is(settled.status === 409 && settled.body?.error === 'order_cancelled',
           'a cancelled cash order cannot be marked paid — 409 order_cancelled', `${settled.status} ${settled.body?.error}`)
        is(await sql(`select payment_status from orders where id = ${id5}`) === 'pending' && await outbox(5, 'payment') === 0,
           'and it stays unpaid, with no payment message queued')

        // 6. Paid after it has left the shop: the money is kept, no "ship it".
        const c6 = await cashOrder(6, '95550606')
        is(c6.status === 200, 'cash order 6 is placed', String(c6.status))
        await drain()
        const id6 = await idOf(6)
        const dlv = await adminAt('fulfilment', { order_id: id6, status: 'delivered' })
        const paid6 = await adminAt('cod_paid', { order_id: id6, paid: true })
        is(dlv.status === 200 && paid6.status === 200 && paid6.body?.payment_status === 'paid',
           'a DELIVERED cash order is marked paid — the money was collected', `${paid6.status} ${paid6.body?.payment_status}`)
        is(await outbox(6, 'payment') === 0, 'and no "ship it" is queued for it')
        await drain()
        is(!subjects(T(6)).some((s) => /PAYMENT CONFIRMED/.test(s)), 'and the warehouse hears nothing of a payment to ship')

        const c7 = await cashOrder(7, '95550607')
        is(c7.status === 200, 'cash order 7 is placed', String(c7.status))
        const id7 = await idOf(7)
        const paid7 = await adminAt('cod_paid', { order_id: id7, paid: true })
        is(paid7.status === 200 && await outbox(7, 'payment') === 1,
           'control: a cash order not yet with the courier still gets its PAYMENT CONFIRMED — ship it', `${paid7.status}`)
        await drain()
        is(subjects(T(7)).some((s) => /PAYMENT CONFIRMED — ship it/.test(s)), 'and the warehouse is told to ship it')

        // 7. The picking list is blocked; payment goes out; the shop cancels;
        // the blocked picking list is released last. It must NOT be mailed.
        const c8 = await cashOrder(8, '95550608')
        is(c8.status === 200, 'cash order 8 is placed', String(c8.status))
        const id8 = await idOf(8)
        await sql(`update fulfilment_outbox set attempts = 5 where order_id = ${id8} and kind = 'new'`)
        await drain()
        const paid8 = await adminAt('cod_paid', { order_id: id8, paid: true })
        await drain()
        is(paid8.status === 200 && subjects(T(8)).some((s) => /PAYMENT CONFIRMED/.test(s)) && !subjects(T(8)).some((s) => /COLLECT CASH/.test(s)),
           'the picking list is blocked while the payment reaches the warehouse', subjects(T(8)).join(' | '))
        // A PAID order cannot be cancelled (409 order_paid, round 2): the money
        // is in, and a do-not-ship sent after a "ship it" would be an instruction
        // the warehouse acts on and the shop has not decided. So the blocked
        // picking list is not followed by a do-not-ship here: it goes out once,
        // after the payment, as the picking list it is.
        const cancel8 = await adminAt('fulfilment', { order_id: id8, status: 'cancelled' })
        is(cancel8.status === 409 && cancel8.body?.error === 'order_paid',
           'a PAID cash order cannot be cancelled — 409 order_paid', `${cancel8.status} ${cancel8.body?.error}`)
        await sql(`update fulfilment_outbox set attempts = 0 where order_id = ${id8} and kind = 'new'`)
        await drain()
        const r8 = subjects(T(8))
        // A picking list is the subject that counts items; payment and do-not-ship
        // subjects do not. Cash is in by now, so this one reads PAID, not COLLECT.
        const lists8 = r8.filter((s) => /item\(s\)/.test(s))
        is(lists8.length === 1 && !/REINSTATED/.test(lists8[0]) && !r8.some((s) => /CANCELLED/.test(s)),
           'and the held picking list goes out ONCE, after the payment — no do-not-ship, no REINSTATED',
           `${lists8.length} list(s): ${r8.join(' | ')}`)

        // 9. A release that throws for one order does not stop the others.
        const c9 = await cashOrder(9, '95550609')
        const c10 = await cashOrder(10, '95550610')
        is(c9.status === 200 && c10.status === 200, 'cash orders 9 and 10 are placed', `${c9.status} ${c10.status}`)
        const id9 = await idOf(9)
        await age(9, 25)
        await age(10, 25)
        // The fault: this one order's do-not-ship row is refused by the table
        // itself (a CHECK, as the real constraint would refuse a bad kind), so
        // only that order's release throws.
        await sql(`alter table fulfilment_outbox add constraint sp_test_refuse_cancel
                   check (not (order_id = ${id9} and kind = 'cancel'))`)
        const partial = await release()
        is(partial.failed?.includes(T(9)) && partial.cod_cancelled?.includes(T(10)),
           'one order that cannot be released is reported, and the next one is still released',
           `failed=${JSON.stringify(partial.failed)} cancelled=${JSON.stringify(partial.cod_cancelled)}`)
        is(await status(9) === 'unfulfilled' && await sql(`select stock_released from orders where id = ${id9}`) === '0',
           'and the refused order is untouched — its release rolled back whole')
        is(await outbox(9, 'cancel') === 0 && await outbox(9, 'cancel', true) === 0,
           'and no do-not-ship survives that rolled-back release — not even an unsent one')
        await sql('alter table fulfilment_outbox drop constraint if exists sp_test_refuse_cancel')
        const after = await release()
        is(after.cod_cancelled?.includes(T(9)) && (after.failed ?? []).length === 0,
           'once the refusal is gone the next run cancels it', `${JSON.stringify(after.cod_cancelled)}`)
      } finally {
        await sql('alter table fulfilment_outbox drop constraint if exists sp_test_refuse_cancel')
        await sql(`delete f from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id like 'SP${tag}%';
                   delete i from order_items i join orders o on o.id = i.order_id where o.track_id like 'SP${tag}%';
                   delete from orders where track_id like 'SP${tag}%';
                   update product_variants set stock = ${stock0} where slug = 'cloudsoft-top-navy' and size = 'L';
                   delete from rate_limit`)
      }
    }

    // ------------------- round 2: what the warehouse is told, and in which order
    //
    // The shop's decisions reach the warehouse as messages in fulfilment_outbox,
    // and a message that has not gone yet can still be overtaken by the next
    // decision. Every step below is a real path: the order API, the admin routes,
    // the sweeper and the drain. Set by hand: an age, a picking list blocked at
    // five attempts (the way the checks above block one), and a legacy order
    // with no picking list. No outbox row is written by a test.
    {
      const WH = 'warehouse-round2@example.test'
      const CFG_R = join(tmp, 'api-config-round2.php')
      // A sender the store refuses: sporta_send_mail() returns false, mails nothing.
      const CFG_BAD = join(tmp, 'api-config-round2-badmail.php')
      writeConfig(CFG_R, { warehouse_email: WH, mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw', warehouse_retry_window_minutes: 0 })
      writeConfig(CFG_BAD, { warehouse_email: WH, mail_from: 'not-sporta@example.test', mail_reply_to: 'cs@sporta.com.kw', warehouse_retry_window_minutes: 0 })
      const subjectOf = (m) => {
        const raw = m.split(/\r?\n/).find((l) => /^Subject:/i.test(l)) ?? ''
        const b = raw.match(/=\?UTF-8\?B\?([^?]+)\?=/i)?.[1]
        return b ? Buffer.from(b, 'base64').toString('utf8') : raw
      }
      const subjects = (track) => mailsTo(WH).filter((m) => subjectOf(m).includes(track)).map(subjectOf)
      // One drain run, as the VPS runs it every five minutes.
      const cronOnce = async (config = CFG_R, mta = MTA) => JSON.parse((await run('php', [
        '-d', `sendmail_path=sh ${mta} ${maildir}`, join(STORE_DIR, 'cron-fulfilment.php'), '--run',
      ], { env: { ...process.env, SPORTA_API_CONFIG_FILE: config } })).stdout)
      const drain = async (config = CFG_R, mta = MTA) => {
        for (let i = 0; i < 30; i++) {
          if (!(await cronOnce(config, mta)).claimed) break
        }
      }
      const sweep = async () => JSON.parse((await run('php', [join(STORE_DIR, 'cron-stock.php'), '--release'], {
        env: { ...process.env, SPORTA_API_CONFIG_FILE: CFG },
      })).stdout)

      const tag = Date.now().toString(36).toUpperCase()
      const T = (n) => `SQ${tag}${String(n).padStart(2, '0')}`
      const SLUG = 'cloudsoft-top-navy'
      // Each order its own phone and its own address, so no per-phone or per-client
      // limit is in play; the phone is Kuwaiti (8 digits, starts 9).
      const PHONE = (n) => `9557${String(n).padStart(4, '0')}`
      const place = (n, method = 'cod') => at(`198.32.1.${n}`, 'api.php?r=order', { method: 'POST', body: {
        track_id: T(n), items: [{ slug: SLUG, size: 'L', qty: 1 }],
        customer: { ...CUSTOMER, phone: PHONE(n) }, payment_method: method } })
      const idOf = async (n) => Number(await sql(`select id from orders where track_id = '${T(n)}'`))
      const status = async (n) => sql(`select fulfilment_status from orders where track_id = '${T(n)}'`)
      const stock = async () => Number(await sql(`select stock from product_variants where slug = '${SLUG}' and size = 'L'`))
      const rows = async (n, kind, open = false) => Number(await sql(`select count(*) from fulfilment_outbox f
          join orders o on o.id = f.order_id
         where o.track_id = '${T(n)}' and f.kind = '${kind}'${open ? ' and f.sent_at is null' : ''}`))
      const age = (n, hours) => sql(`update orders set created_at = now() - interval ${hours} hour where track_id = '${T(n)}'`)
      const JAR = new Map()
      const adminAt = (route, body) => at('198.31.9.1', `admin.php?r=${route}`, { method: 'POST', body, jar: JAR })
      const mark = async (n, s) => adminAt('fulfilment', { order_id: await idOf(n), status: s })
      const isCollect = (s) => /COLLECT CASH/.test(s)
      const isList = (s) => /item\(s\)/.test(s)
      const isCancel = (s) => /CANCELLED.*do not ship/.test(s)
      const isReinstate = (s) => /REINSTATED/.test(s)
      const isShipIt = (s) => /PAYMENT CONFIRMED — ship it/.test(s)

      const stock0 = await stock()
      try {
        await sql("delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null where email = 'cs@sporta.com.kw'")
        const signed = await at('198.31.9.1', 'admin.php?r=login', { method: 'POST',
          body: { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }, jar: JAR })
        is(signed.status === 200, 'the owner signs in for the round-2 cash checks', `${signed.status} ${signed.body?.error ?? ''}`)

        // 1. A cash order that has LEFT THE SHOP cannot be cancelled. The garment
        // is with the customer; a do-not-ship is a lie, and the sweeper would put
        // a garment back on the shelf that is not there.
        for (const n of [1, 2, 3]) {
          const r = await place(n)
          is(r.status === 200, `cash order ${n} is placed`, String(r.status))
        }
        await drain()
        const dlv1 = await mark(1, 'delivered')
        const shp2 = await mark(2, 'shipped')
        is(dlv1.status === 200 && shp2.status === 200,
           'order 1 is delivered and order 2 shipped, the cash not yet recorded for either',
           `${dlv1.status} ${shp2.status}`)
        const held1 = await stock()
        const cancel1 = await mark(1, 'cancelled')
        const cancel2 = await mark(2, 'cancelled')
        is(cancel1.status === 409 && cancel1.body?.error === 'order_already_shipped'
           && cancel2.status === 409 && cancel2.body?.error === 'order_already_shipped',
           'a delivered or shipped order cannot be cancelled — 409 order_already_shipped',
           `${cancel1.status} ${cancel1.body?.error} / ${cancel2.status} ${cancel2.body?.error}`)
        await sweep()
        is(await status(1) === 'delivered' && await status(2) === 'shipped'
           && await rows(1, 'cancel') === 0 && await rows(2, 'cancel') === 0,
           'and neither is cancelled, nor is a do-not-ship queued for it',
           `${await status(1)} ${await status(2)}`)
        is(await stock() === held1, 'the sweeper does not put back the garments of a delivered or shipped order',
           `${held1} before, ${await stock()} after`)

        // 2. A PAID cash order cannot be cancelled either (409 order_paid): the
        // money is in, and a cancelled paid order keeps its garment claimed for
        // ever, because a paid order is never released.
        const paid3 = await adminAt('cod_paid', { order_id: await idOf(3), paid: true })
        is(paid3.status === 200, 'order 3 is marked paid on delivery of the cash', String(paid3.status))
        const held3 = await stock()
        const cancel3 = await mark(3, 'cancelled')
        is(cancel3.status === 409 && cancel3.body?.error === 'order_paid',
           'a paid cash order cannot be cancelled — 409 order_paid', `${cancel3.status} ${cancel3.body?.error}`)
        await sweep()
        is(await status(3) === 'unfulfilled' && await stock() === held3 && await rows(3, 'cancel') === 0,
           'and it stays open, with its garment still held and no do-not-ship', await status(3))

        // 3. Delivered inside the drain window. A cash order marked paid before the
        // drain ran, then delivered before it ran again: its "ship it" is not sent
        // for a parcel already out, and nor is its picking list.
        const r4 = await place(4)
        is(r4.status === 200, 'cash order 4 is placed', String(r4.status))
        const paid4 = await adminAt('cod_paid', { order_id: await idOf(4), paid: true })
        const dlv4 = await mark(4, 'delivered')
        is(paid4.status === 200 && dlv4.status === 200, 'order 4 is marked paid, then delivered, before the drain runs',
           `${paid4.status} ${dlv4.status}`)
        await drain()
        is(!subjects(T(4)).some(isShipIt) && !subjects(T(4)).some(isCollect),
           'so its PAYMENT CONFIRMED — ship it and its picking list are both NOT mailed',
           subjects(T(4)).join(' | ') || 'nothing mailed')

        // …and the variant: the picking list was held back (five attempts) and is
        // reset only after the parcel has gone.
        const r5 = await place(5)
        is(r5.status === 200, 'cash order 5 is placed', String(r5.status))
        await sql(`update fulfilment_outbox set attempts = 5 where order_id = ${await idOf(5)} and kind = 'new'`)
        const dlv5 = await mark(5, 'delivered')
        await sql(`update fulfilment_outbox set attempts = 0 where order_id = ${await idOf(5)} and kind = 'new'`)
        await drain()
        is(dlv5.status === 200 && !subjects(T(5)).some(isCollect),
           'a held picking list for an order delivered in the meantime is NOT mailed afterwards',
           subjects(T(5)).join(' | ') || 'nothing mailed')

        // 4. Cancel, reinstate, cancel, reinstate, one drain: the warehouse holds
        // ONE REINSTATED picking list, not one per reinstate.
        await place(6)
        await drain()
        await mark(6, 'cancelled')
        await drain()
        const back6 = await mark(6, 'packed')
        const again6 = await mark(6, 'cancelled')
        const back6b = await mark(6, 'packed')
        await drain()
        const re6 = subjects(T(6)).filter(isReinstate)
        is(back6.status === 200 && again6.status === 200 && back6b.status === 200 && re6.length === 1,
           'cancel, drain, reinstate, cancel, reinstate, drain: exactly ONE REINSTATED picking list',
           `${re6.length} REINSTATED: ${subjects(T(6)).join(' | ')}`)

        // 5. A reinstate's picking list that is still waiting when the order is
        // cancelled again is NOT mailed: the do-not-ship that follows it is the
        // last word, and a picking list between two do-not-ships is a van sent.
        await place(7)
        await drain()
        await mark(7, 'cancelled')
        await drain()
        await mark(7, 'packed')
        await mark(7, 'cancelled')
        await drain()
        const lists7 = subjects(T(7)).filter(isList)
        is(lists7.length === 1 && !lists7.some(isReinstate),
           'a REINSTATED list queued before a re-cancel is not mailed while the order is cancelled',
           subjects(T(7)).join(' | '))

        // 6. The owner puts an order back WHILE the drain is mailing another. The
        // hook sendmail below is a test stand-in that does exactly that: when the
        // message for order 9 is handed to it, it puts order 8 back through the
        // admin route. Order 8's do-not-ship was claimed in the same run, after
        // order 9's picking list. Once order 8 is back on, its do-not-ship must not
        // be sent: the warehouse must not be told not to ship a live order.
        await place(8)
        await drain()
        await place(9)
        await mark(8, 'cancelled')
        const hook = join(tmp, 'round2-hook-mta.sh')
        const cookie = [...JAR].map(([k, v]) => `${k}=${v}`).join('; ')
        writeFileSync(hook, `#!/bin/sh
# Test stand-in for sendmail. Stores the message as fake-mta.sh does; when it is
# the message for ${T(9)}, the owner puts order ${await idOf(8)} back on through
# the admin route, before the drain has finished the run.
dir=$1
f="$dir/$(date +%s%N).$$"
cat > "$f.tmp"
mv "$f.tmp" "$f.eml"
if grep -q '${T(9)}' "$f.eml"; then
  curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Sporta-Admin: 1' \\
    -H 'X-Forwarded-For: 198.31.9.1' -H 'Sec-Fetch-Site: same-origin' -H 'Cookie: ${cookie.replace(/'/g, '')}' \\
    --data '{"order_id":${await idOf(8)},"status":"packed"}' '${PBASE}/admin.php?r=fulfilment'
fi
`, { mode: 0o755 })
        await drain(CFG_R, hook)
        const s8 = subjects(T(8))
        is(await status(8) === 'packed' && !s8.some(isCancel),
           'the owner puts order 8 back while order 9 is being mailed: its do-not-ship is never sent',
           `status ${await status(8)}; ${s8.join(' | ')}`)
        is(subjects(T(9)).some(isList), 'and order 9 is mailed as usual', subjects(T(9)).join(' | '))

        // 7. A do-not-ship that the warehouse is never sent (five failed attempts)
        // is reported to the owner: one activity row, on the fifth failure only.
        await place(10)
        await drain()
        await mark(10, 'cancelled')
        const alerts = async () => Number(await sql("select count(*) from admin_activity_log where action_key like 'warehouse_mail_failed%'"))
        const alertsBefore = await alerts()
        for (let i = 0; i < 4; i++) await cronOnce(CFG_BAD)
        const afterFour = await alerts()
        await cronOnce(CFG_BAD)
        const afterFive = await alerts()
        is(afterFour === alertsBefore && afterFive === alertsBefore + 1,
           'a do-not-ship that fails four times writes no alert; the fifth failure writes exactly one',
           `${afterFour - alertsBefore} after four, ${afterFive - alertsBefore} after five`)
        is(await sql("select actor_email from admin_activity_log where action_key like 'warehouse_mail_failed%' order by id desc limit 1") === 'system',
           'and the alert names the system, not an administrator')
        is(await rows(10, 'cancel', true) === 1 && await sql(`select f.attempts from fulfilment_outbox f join orders o on o.id = f.order_id
           where o.track_id = '${T(10)}' and f.kind = 'cancel'`) === '5',
           'the do-not-ship stays unsent and visible, with its five attempts counted')

        // 8. A picking list that failed five times is sent again once the owner
        // puts the order back: it was never heard of, so it is not a REINSTATED one.
        await place(11)
        for (let i = 0; i < 5; i++) await cronOnce(CFG_BAD)
        is(await sql(`select f.attempts from fulfilment_outbox f join orders o on o.id = f.order_id
           where o.track_id = '${T(11)}' and f.kind = 'new'`) === '5',
           'the picking list of order 11 has failed five times', '')
        await mark(11, 'cancelled')
        const back11 = await mark(11, 'packed')
        await drain()
        const l11 = subjects(T(11))
        is(back11.status === 200 && l11.filter(isList).length === 1 && !l11.some(isReinstate),
           'put back, its failed picking list goes out once, as the picking list it is',
           `${back11.status}: ${l11.join(' | ')}`)

        // 9. A cash order the sweeper cancelled at 25 hours cannot be put back as
        // unfulfilled: the sweeper would cancel it again within fifteen minutes.
        // Put back as PACKED, the sweeper never touches it, so that one is kept.
        await place(12)
        await place(13)
        await drain()
        await age(12, 25)
        await age(13, 25)
        const sw1 = await sweep()
        is(sw1.cod_cancelled?.includes(T(12)) && sw1.cod_cancelled?.includes(T(13)),
           'the sweeper cancels both cash orders at 25 hours', JSON.stringify(sw1.cod_cancelled))
        const back12 = await mark(12, 'unfulfilled')
        is(back12.status === 409 && back12.body?.error === 'cod_hold_expired' && await status(12) === 'cancelled',
           'putting it back as unfulfilled is refused — 409 cod_hold_expired, and it stays cancelled',
           `${back12.status} ${back12.body?.error}`)
        const sw2 = await sweep()
        is(!sw2.cod_cancelled?.includes(T(12)) && await rows(12, 'cancel') === 1,
           'and a second sweep does not cancel it again: one do-not-ship in all',
           `cancel rows ${await rows(12, 'cancel')}; cancelled again: ${JSON.stringify(sw2.cod_cancelled)}`)
        const packed13 = await mark(13, 'packed')
        const sw3 = await sweep()
        is(packed13.status === 200 && await status(13) === 'packed' && !sw3.cod_cancelled?.includes(T(13)),
           'put back as packed, the same order is kept', `${packed13.status} ${await status(13)}`)

        // 10. A hand cancel after the sweeper has cancelled an order queues no
        // second do-not-ship, and a paid-for cancelled order is refused (the
        // owner's own rule, pinned here: a cash order the sweeper cancelled is
        // not marked paid; it is put back first).
        await place(14)
        await drain()
        await age(14, 25)
        await sweep()
        is(await status(14) === 'cancelled' && await rows(14, 'cancel') === 1,
           'the sweeper cancels order 14 and queues exactly one do-not-ship', `${await rows(14, 'cancel')} row(s)`)
        const again14 = await mark(14, 'cancelled')
        is(again14.status === 200 && await rows(14, 'cancel') === 1,
           'a hand cancel after that queues no second do-not-ship', `${again14.status} ${await rows(14, 'cancel')} row(s)`)
        const settled14 = await adminAt('cod_paid', { order_id: await idOf(14), paid: true })
        is(settled14.status === 409 && settled14.body?.error === 'order_cancelled',
           'pinned (owner decision): a cash order the sweeper cancelled cannot be marked paid — 409 order_cancelled',
           `${settled14.status} ${settled14.body?.error}`)

        // 11. A cancelled order that the warehouse was never sent a picking list for
        // (placed before the outbox existed) is not mailed at all.
        await place(15)
        await sql(`delete from fulfilment_outbox where order_id = ${await idOf(15)}`)
        await mark(15, 'cancelled')
        await drain()
        is(subjects(T(15)).length === 0, 'a cash order with no picking list, cancelled by hand, mails nothing',
           subjects(T(15)).join(' | '))

        // 12. A card order cancelled while pending cannot be settled by hand: the
        // bank reference would mark paid a garment that is back on the shelf.
        const card16 = await place(16, 'knet')
        is(card16.status === 200, 'card order 16 is placed, pending at the bank', String(card16.status))
        const c16 = await mark(16, 'cancelled')
        const settled16 = await adminAt('card_settled', { order_id: await idOf(16), bank_reference: '100202998877' })
        is(c16.status === 200 && settled16.status === 409 && settled16.body?.error === 'order_cancelled'
           && await sql(`select payment_status from orders where track_id = '${T(16)}'`) === 'pending'
           && await rows(16, 'payment') === 0,
           'a cancelled card order cannot be settled by hand — 409 order_cancelled, still pending, no payment message',
           `${settled16.status} ${settled16.body?.error}`)

        // ===================== round 3: the review of the release's warehouse mail

        // 13. A picking list CLOSED because the order was cancelled is sent after
        // all when the order is put back. (The reinstate step looked for such a
        // row with `sent_at is null`; a closed row has sent_at SET, so only a
        // list that had failed five times was ever revived, and the live order
        // stayed invisible to the warehouse.)
        const closedRows = (n) => sql(`select group_concat(concat(f.kind, ':', coalesce(f.last_error, '-')) order by f.id separator ' | ')
            from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id = '${T(n)}'`)
        await place(17)
        await mark(17, 'cancelled')
        await drain()
        is(subjects(T(17)).length === 0 && await closedRows(17) === 'new:order cancelled | cancel:order cancelled',
           'a cash order cancelled before the first drain: the warehouse hears nothing, both rows are closed',
           `${subjects(T(17)).join(' | ')} / ${await closedRows(17)}`)
        const back17 = await mark(17, 'packed')
        await drain()
        const l17 = subjects(T(17))
        is(back17.status === 200 && l17.length === 1 && isList(l17[0]) && isCollect(l17[0]) && !isReinstate(l17[0]),
           'put back, its picking list goes out ONCE, plain (never heard of, so not REINSTATED) — the live order is visible',
           `${back17.status}: ${l17.join(' | ')}`)
        await drain()
        is(subjects(T(17)).length === 1, 'and a further drain mails nothing more', String(subjects(T(17)).length))

        await place(18)
        await age(18, 25)
        const sw18 = await sweep()
        await drain()
        is(sw18.cod_cancelled?.includes(T(18)) && subjects(T(18)).length === 0,
           'a cash order the sweeper cancelled before its picking list went: nothing is mailed', subjects(T(18)).join(' | '))
        const back18 = await mark(18, 'packed')
        await drain()
        const l18 = subjects(T(18))
        is(back18.status === 200 && l18.length === 1 && isCollect(l18[0]) && !isReinstate(l18[0]),
           'put back as packed, the sweeper-cancelled order gets its picking list too', `${back18.status}: ${l18.join(' | ')}`)

        // 14. A REINSTATED picking list is a dispatch instruction (items, address,
        // COLLECT CASH). It is never mailed for an order that has already shipped
        // or been delivered — the way the owner corrects a cash order the sweeper
        // cancelled after the van had gone is to move it out of 'cancelled'.
        for (const [n, target] of [[19, 'delivered'], [20, 'shipped']]) {
          await place(n)
          await drain()
          await mark(n, 'cancelled')
          await drain()
          const mv = await mark(n, target)
          await drain()
          const s = subjects(T(n))
          is(mv.status === 200 && s.filter(isList).length === 1 && s.filter(isCancel).length === 1 && !s.some(isReinstate),
             `cancelled, then recorded as ${target}: the REINSTATED picking list is NOT mailed`,
             `${mv.status}: ${s.join(' | ')}`)
          is((await closedRows(n)).endsWith('reinstate:order shipped'),
             `and its row is closed as "order shipped" (${target})`, await closedRows(n))
        }

        // 15. The closing rule, every kind against every status, and then the
        // same rule through the real drain in BOTH passes. The pure table is
        // store_outbox_closed_reason() itself.
        {
          const out = JSON.parse((await run('php', ['-r', `
            require ${phpStr(join(STORE_DIR, 'store.php'))};
            $r = [];
            foreach (['new', 'reinstate', 'payment', 'cancel'] as $k)
              foreach (['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled'] as $s)
                foreach ([false, true] as $h)
                  $r[$k . '/' . $s . '/' . ($h ? 'heard' : 'unheard')] = store_outbox_closed_reason($k, $s, $h);
            echo json_encode($r);`])).stdout)
          const C = 'order cancelled', S = 'order shipped'
          const expect = (k, s, h) => {
            if (s === 'cancelled') return (k === 'new' || k === 'reinstate') ? C : (h ? null : C)
            if (s === 'shipped' || s === 'delivered') return k === 'cancel' ? null : S
            return k === 'cancel' ? 'order reinstated' : null
          }
          const wrong = Object.entries(out).filter(([key, v]) => {
            const [k, s, h] = key.split('/')
            return v !== expect(k, s, h === 'heard')
          })
          is(wrong.length === 0 && Object.keys(out).length === 40,
             'the closing rule, 4 kinds x 5 statuses x heard/unheard, is exactly the documented table',
             wrong.map(([k, v]) => `${k}=${v}`).join(', ') || '40 cells')
        }
        // Pass 2: the shop decides AFTER the row was claimed and BEFORE it is
        // sent. A stand-in sendmail changes the target order through the real
        // admin route while the drain is mailing the decoy ahead of it.
        const cookieOf = () => [...JAR].map(([k, v]) => `${k}=${v}`).join('; ').replace(/'/g, '')
        const hookTo = (decoyTrack, targetId, newStatus, name) => {
          const f = join(tmp, `round3-hook-${name}.sh`)
          writeFileSync(f, `#!/bin/sh
# Test stand-in for sendmail: when the message is for ${decoyTrack}, order ${targetId} is
# moved to ${newStatus} through the admin route, mid-run.
dir=$1
f="$dir/$(date +%s%N).$$"
cat > "$f.tmp"
mv "$f.tmp" "$f.eml"
if grep -q '${decoyTrack}' "$f.eml"; then
  curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Sporta-Admin: 1' \\
    -H 'X-Forwarded-For: 198.31.9.1' -H 'Sec-Fetch-Site: same-origin' -H 'Cookie: ${cookieOf()}' \\
    --data '{"order_id":${targetId},"status":"${newStatus}"}' '${PBASE}/admin.php?r=fulfilment'
fi
`, { mode: 0o755 })
          return f
        }
        {
          // a. picking list ('new'): the order is delivered mid-run.
          await place(21); await place(22)   // 21 is the decoy, ahead of 22 in the queue
          await drain(CFG_R, hookTo(T(21), await idOf(22), 'delivered', 'a'))
          is(await status(22) === 'delivered' && subjects(T(22)).length === 0
             && await closedRows(22) === 'new:order shipped',
             'pass 2: a picking list whose order is delivered after the claim is closed "order shipped", not mailed',
             `${await status(22)}; ${await closedRows(22)}; ${subjects(T(22)).join(' | ')}`)
          // b. picking list ('new'): the order is cancelled mid-run.
          await place(23); await place(24)
          await drain(CFG_R, hookTo(T(23), await idOf(24), 'cancelled', 'b'))
          await drain()
          is(await status(24) === 'cancelled' && subjects(T(24)).length === 0
             && await closedRows(24) === 'new:order cancelled | cancel:order cancelled',
             'pass 2: a picking list whose order is cancelled after the claim is closed "order cancelled" — and so is the do-not-ship nobody needs',
             `${await status(24)}; ${await closedRows(24)}; ${subjects(T(24)).join(' | ')}`)
          // c. 'reinstate': the order is delivered mid-run.
          await place(25); await drain()
          await mark(25, 'cancelled'); await drain()
          await place(26)    // the decoy, queued AFTER 25's cancel and BEFORE its reinstate
          await mark(25, 'packed')
          await drain(CFG_R, hookTo(T(26), await idOf(25), 'delivered', 'c'))
          const s25 = subjects(T(25))
          is(await status(25) === 'delivered' && !s25.some(isReinstate) && (await closedRows(25)).endsWith('reinstate:order shipped'),
             'pass 2: a REINSTATED list whose order is delivered after the claim is closed "order shipped", not mailed',
             `${await status(25)}; ${await closedRows(25)}; ${s25.join(' | ')}`)
          // d. 'payment': a card order is settled, then shipped mid-run.
          await place(27, 'knet'); await drain()
          await place(28)
          await adminAt('card_settled', { order_id: await idOf(27), bank_reference: '100202112233' })
          await drain(CFG_R, hookTo(T(28), await idOf(27), 'shipped', 'd'))
          is(await status(27) === 'shipped' && !subjects(T(27)).some(isShipIt) && (await closedRows(27)).endsWith('payment:order shipped'),
             'pass 2: a "ship it" for an order shipped after the claim is closed "order shipped", not mailed',
             `${await status(27)}; ${await closedRows(27)}; ${subjects(T(27)).join(' | ')}`)
          // The same four through pass 1 (the order was already in that state
          // when the drain began): the reinstate row, by the real route.
          await place(29); await drain()
          await mark(29, 'cancelled'); await drain()
          await mark(29, 'packed')
          await sql(`update orders set fulfilment_status = 'shipped' where track_id = '${T(29)}'`)
          await drain()
          is(!subjects(T(29)).some(isReinstate) && (await closedRows(29)).endsWith('reinstate:order shipped'),
             'pass 1: a waiting REINSTATED list of an order that is already shipped is closed, not mailed',
             `${await closedRows(29)}; ${subjects(T(29)).join(' | ')}`)
        }

        // 16. The mail is NOT sent while the order's row lock is held. A bank
        // callback (knet_settle_order, cbk_update_order) and the sweeper take that
        // same lock; a relay that stalls for longer than the database's lock wait
        // made them fail with 1205, and a captured payment was parked for review.
        {
          await place(30)
          const slowEnv = { ...process.env, SPORTA_API_CONFIG_FILE: CFG_R, MTA_DELAY: '7' }
          const t0 = Date.now()
          const slowRun = run('php', ['-d', `sendmail_path=sh ${MTA} ${maildir}`, join(STORE_DIR, 'cron-fulfilment.php'), '--run'],
            { env: slowEnv })
          await new Promise((r) => setTimeout(r, 2500))
          let got = 'locked'
          try {
            // What a bank callback does: lock the order row, with a short wait.
            await run('mariadb', ['sporta', '-e', `set session innodb_lock_wait_timeout = 2;
              start transaction; select id from orders where id = ${await idOf(30)} for update; commit;`])
            got = 'free'
          } catch (e) { got = String(e.stderr ?? e.message).slice(0, 120) }
          const waited = Date.now() - t0
          await slowRun
          is(got === 'free', 'while the relay is stalled mid-mail, the order row is free for a callback to lock',
             `${got} after ${waited} ms`)
          is(subjects(T(30)).filter(isList).length === 1, 'and the picking list is still mailed once', subjects(T(30)).join(' | '))
          // An admin cancel made while the list is in the relay is not lost: the
          // do-not-ship follows it on the next run.
          await place(31)
          const slow2 = run('php', ['-d', `sendmail_path=sh ${MTA} ${maildir}`, join(STORE_DIR, 'cron-fulfilment.php'), '--run'],
            { env: { ...process.env, SPORTA_API_CONFIG_FILE: CFG_R, MTA_DELAY: '5' } })
          await new Promise((r) => setTimeout(r, 2000))
          const c31 = await mark(31, 'cancelled')
          await slow2
          await drain()
          const s31 = subjects(T(31))
          is(c31.status === 200 && s31.filter(isList).length === 1 && s31.filter(isCancel).length === 1,
             'a cancel made while the list is in the relay goes out right after it: list, then do-not-ship',
             `${c31.status}: ${s31.join(' | ')}`)
        }

        // 17. A message that fails is not lost for good, and the alert says which.
        {
          const CFG_SLOW = join(tmp, 'api-config-round3-slow.php')
          writeConfig(CFG_SLOW, { warehouse_email: WH, mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw',
            warehouse_retry_window_minutes: 60 })
          await place(32)
          for (let i = 0; i < 5; i++) await cronOnce(CFG_BAD)
          const key = `warehouse_mail_failed_new_${T(32).toLowerCase()}`
          is(await sql(`select count(*) from admin_activity_log where action_key = '${key}'`) === '1',
             'the fifth failure names the kind and the order in its alert', key)
          await drain()
          is(subjects(T(32)).length === 0 && await rows(32, 'new', true) === 1,
             'outside the slow-retry window a row at five attempts stays put', subjects(T(32)).join(' | '))
          await cronOnce(CFG_SLOW)
          is(subjects(T(32)).filter(isList).length === 1 && await rows(32, 'new', true) === 0,
             'inside it, the mail having recovered, the stranded picking list is sent', subjects(T(32)).join(' | '))
          await place(33)
          await sql(`update fulfilment_outbox f join orders o on o.id = f.order_id set f.attempts = 23 where o.track_id = '${T(33)}'`)
          await cronOnce(CFG_BAD)   // CFG_BAD has the window closed: attempts 23 is not claimed
          await sql(`update fulfilment_outbox f join orders o on o.id = f.order_id set f.attempts = 23 where o.track_id = '${T(33)}'`)
          const badSlow = join(tmp, 'api-config-round3-badslow.php')
          writeConfig(badSlow, { warehouse_email: WH, mail_from: 'not-sporta@example.test', mail_reply_to: 'cs@sporta.com.kw',
            warehouse_retry_window_minutes: 60 })
          await cronOnce(badSlow)
          is(await sql(`select count(*) from admin_activity_log where action_key = 'warehouse_mail_gave_up_new_${T(33).toLowerCase()}'`) === '1',
             'and the last attempt says it gave up, naming the order', '')
          await sql(`update fulfilment_outbox f join orders o on o.id = f.order_id set f.sent_at = now(), f.last_error = 'test: tidy' where o.track_id = '${T(33)}'`)
        }

        // 18. A card order the sweeper released (its 120-minute hold passed) and
        // the owner then settles by hand claims its garments AGAIN. Before, it
        // was marked paid with its units back on sale.
        {
          const stockNow = stock
          await sweep()      // earlier cards in this block are let go first: a clean baseline
          const before = await stockNow()
          await place(34, 'knet')
          const afterOrder = await stockNow()
          await age(34, 3)
          await sweep()
          const released = await stockNow()
          is(afterOrder === before - 1 && released === before
             && await sql(`select stock_released from orders where track_id = '${T(34)}'`) === '1'
             && await status(34) === 'unfulfilled',
             'the sweeper lets go of an abandoned card order: its garment is back on the shelf, the order still open',
             `${before} -> ${afterOrder} -> ${released}`)
          const settled = await adminAt('card_settled', { order_id: await idOf(34), bank_reference: '100202445566' })
          is(settled.status === 200 && await stockNow() === before - 1
             && await sql(`select stock_released from orders where track_id = '${T(34)}'`) === '0'
             && await rows(34, 'payment') === 1,
             'settling it by hand claims the garment again (stock back down), and the "ship it" goes out',
             `${settled.status} ${settled.body?.error ?? ''}; stock ${await stockNow()}`)
          // …and refuses when the size has sold in the meantime.
          await place(35, 'knet')
          await age(35, 3)
          await sweep()
          await sql(`update product_variants set stock = 0 where slug = '${SLUG}' and size = 'L'`)
          const refused = await adminAt('card_settled', { order_id: await idOf(35), bank_reference: '100202778899' })
          is(refused.status === 409 && /^out_of_stock_/.test(refused.body?.error ?? '')
             && await sql(`select payment_status from orders where track_id = '${T(35)}'`) === 'pending'
             && await rows(35, 'payment') === 0,
             'and refuses with the checkout\'s own out_of_stock token when that size has sold since — still pending, nothing mailed',
             `${refused.status} ${refused.body?.error}`)
        }
      } finally {
        await sql(`delete f from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id like 'SQ${tag}%';
                   delete i from order_items i join orders o on o.id = i.order_id where o.track_id like 'SQ${tag}%';
                   delete from orders where track_id like 'SQ${tag}%';
                   update product_variants set stock = ${stock0} where slug = '${SLUG}' and size = 'L';
                   delete from rate_limit`)
      }
    }

    // ---------------------------------------------------- customer accounts
    //
    // Every "per-email" customer limit used store_throttle, which keys on the
    // CLIENT, so each was really per (email, address): rotate addresses and
    // there was no limit at all. Reset mail, sign-in and change_password are
    // now counted per account.
    {
      const C = { 'X-Sporta-Customer': '1' }
      const cust = (ip, route, body, jar) => at(ip, `customer.php?r=${route}`,
        { method: body === undefined ? 'GET' : 'POST', body, jar, headers: C })
      const resetMails = (addr) => mailsTo(addr).filter((m) => /#token=[a-f0-9]{64}/.test(m))
      const tokenOf = (m) => m.match(/#token=([a-f0-9]{64})/)?.[1]
      const tag = Date.now().toString(36)
      const FLOOD = `rl-flood-${tag}@example.test`
      const DAILY = `rl-daily-${tag}@example.test`
      const VICTIM = `rl-victim-${tag}@example.test`
      const VICTIM_ACCENT = VICTIM.replace('victim', 'víctim')
      const PW = 'customer-password-0001'
      let n = 0
      const ip = () => `198.19.${Math.floor(++n / 250)}.${(n % 250) + 1}`
      await sql("delete from rate_limit")
      for (const email of [FLOOD, DAILY, VICTIM]) {
        const r = await cust(ip(), 'register', { name: 'Rate Test', email, password: PW })
        if (r.status !== 201) bad(`register ${email}`, `${r.status} ${r.body?.error}`)
      }
      try {
        // The cost is NAMED, so an unknown address (checked against a fixed
        // $2y$12$ dummy) costs exactly what a real account costs on every PHP.
        const hash = await sql(`select password_hash from customer_accounts where email = '${VICTIM}'`)
        is(hash.startsWith('$2y$12$'), 'a customer password is hashed at bcrypt cost 12, the dummy’s cost', hash.slice(0, 7))

        // --- reset mail: three an hour, ten a day, per ADDRESS
        const before = resetMails(FLOOD).length
        const flood = []
        for (let i = 0; i < 12; i++) flood.push(await cust(ip(), 'forgot_password', { email: FLOOD }))
        is(flood.every((r) => r.status === 200 && r.body?.ok === true),
           'twelve reset requests for one address from twelve clients are all answered {ok:true}',
           [...new Set(flood.map((r) => r.status))].join(','))
        is(resetMails(FLOOD).length - before === 3,
           'but the inbox gets three mails, not twelve — the hourly window is per address now',
           `${resetMails(FLOOD).length - before} mail(s)`)
        const ghost = []
        const ghostBefore = mails().length
        for (let i = 0; i < 12; i++) ghost.push((await cust(ip(), 'forgot_password', { email: `nobody-${tag}@example.test` })).status)
        is(ghost.every((st) => st === 200) && mails().length === ghostBefore,
           'an address with no account gets the same answer, and no mail', ghost.join(','))

        const dailyBefore = resetMails(DAILY).length
        for (let round = 0; round < 4; round++) {
          for (let i = 0; i < 3; i++) await cust(ip(), 'forgot_password', { email: DAILY })
          await sql(`update rate_limit set window_start = window_start - 3600
                      where bucket_key = '${rlKey('customer_reset_email', DAILY)}'`)
        }
        is(resetMails(DAILY).length - dailyBefore === 10,
           'with the hour moved on each time, one address still gets at most ten in a day',
           `${resetMails(DAILY).length - dailyBefore} mail(s)`)

        // Two resets from two clients: the row records each CLIENT, as an HMAC.
        const rows = (await sql(`select r.request_ip from customer_password_resets r
                                   join customer_accounts a on a.id = r.customer_id
                                  where a.email = '${FLOOD}' order by r.id limit 2`)).split('\n')
        const sha127 = createHash('sha256').update('127.0.0.1').digest('hex')
        is(rows.length === 2 && rows[0] !== rows[1] && !rows.includes(sha127),
           'each reset row records its own client, not the proxy', rows.join(' '))
        is(rows[0] === rlKey('customer_reset_ip', '198.19.0.5'),
           'and records it as an HMAC, which a list of every IPv4 address cannot reverse', rows[0])

        // --- sign-in: ten tries per ACCOUNT, from anywhere
        const wrong = []
        for (let i = 0; i < 10; i++) wrong.push((await cust(ip(), 'login', { email: VICTIM, password: `wrong-${i}-xxxxxx` })).status)
        is(wrong.every((st) => st === 401), 'ten wrong passwords for one customer from ten clients: 401 each', wrong.join(','))
        const eleventh = await cust(ip(), 'login', { email: VICTIM, password: 'wrong-again-xxxxx' })
        is(eleventh.status === 429, 'the eleventh, from yet another client, is refused — the window is the account’s',
           `${eleventh.status} ${eleventh.body?.error}`)
        const rightButLocked = await cust(ip(), 'login', { email: VICTIM, password: PW })
        is(rightButLocked.status === 429,
           'and so is the right password while it lasts (the accepted trade-off: fifteen minutes)',
           `${rightButLocked.status}`)

        const vBefore = resetMails(VICTIM).length
        await cust(ip(), 'forgot_password', { email: VICTIM })
        const token = tokenOf(resetMails(VICTIM).slice(vBefore)[0] ?? '')
        const NEW_PW = 'customer-password-0002'
        const reset = await cust(ip(), 'reset_password', { token, password: NEW_PW })
        const afterReset = await cust(ip(), 'login', { email: VICTIM, password: NEW_PW })
        is(reset.status === 200 && afterReset.status === 200,
           'a password reset empties the account window: the new password works at once',
           `${reset.status} ${afterReset.status} ${afterReset.body?.error ?? ''}`)

        const accent = []
        for (let i = 0; i < 12; i++) accent.push((await cust(ip(), 'login', { email: VICTIM_ACCENT, password: `guess-${i}-xxxxxxx` })).status)
        const stillOpen = await cust(ip(), 'login', { email: VICTIM, password: NEW_PW })
        is(accent.every((st) => st === 401) && stillOpen.status === 200,
           'a look-alike spelling (víctim@) is refused before the database is asked, and costs the real account nothing',
           `${[...new Set(accent)].join(',')} then ${stillOpen.status}`)

        const sprayIp = '198.19.200.1'
        const spray = []
        for (let i = 0; i < 21; i++) spray.push((await cust(sprayIp, 'login', { email: `spray-${i}-${tag}@example.test`, password: 'x-guess-0000000' })).status)
        is(spray.slice(0, 20).every((st) => st === 401) && spray[20] === 429,
           'one client trying twenty different accounts is stopped on the twenty-first', spray.join(','))

        // --- change_password: five tries per account, then the session ends
        const jar = new Map()
        await cust(ip(), 'login', { email: VICTIM, password: NEW_PW }, jar)
        const cp = []
        for (let i = 0; i < 6; i++) {
          cp.push(await cust(ip(), 'change_password', { current_password: `not-it-${i}-xxxxxx`, new_password: 'customer-password-0003' }, jar))
        }
        is(cp.slice(0, 5).every((r) => r.status === 401 && r.body?.error === 'invalid_credentials')
           && cp[5].status === 401 && cp[5].body?.error === 'not_authenticated',
           'five wrong current passwords (from five clients) are 401; the sixth ends the session',
           cp.map((r) => r.body?.error).join(','))
        const me = await cust(ip(), 'me', undefined, jar)
        is(me.status === 200 && me.body === null, 'and that browser is signed out', JSON.stringify(me.body))

        // --- the admin's Profiles screen
        //
        // It selected customer_accounts.last_login_at, a column no migration
        // ever created, so it answered no_table on every database.
        const adminJar = new Map()
        await sql(`delete from rate_limit where bucket_key = '${rlKey('admin_login_identity', OWNER)}'`)
        const signedIn = await login('198.19.250.1', OWNER, 'rl-owner-password-0002', adminJar)
        const list = await at('198.19.250.1', 'admin.php?r=profiles_list', { jar: adminJar })
        const row = list.body?.profiles?.find((p) => p.email === VICTIM)
        is(signedIn.status === 200 && list.status === 200 && !!row && 'last_login_at' in row,
           'the Profiles list answers 200 with its rows, last_login_at included',
           `${signedIn.status} ${list.status} ${list.body?.error ?? ''} ${row ? 'row' : 'no row'}`)
        const detail = await at('198.19.250.1', `admin.php?r=profile_detail&id=${row?.id}`, { jar: adminJar })
        is(detail.status === 200 && detail.body?.profile?.email === VICTIM && 'last_login_at' in (detail.body?.profile ?? {}),
           'and a profile opens', `${detail.status} ${detail.body?.error ?? ''}`)
      } finally {
        await sql(`delete r from customer_password_resets r join customer_accounts a on a.id = r.customer_id
                    where a.email like 'rl-%@example.test';
                   delete from customer_accounts where email like 'rl-%@example.test'; delete from rate_limit`)
      }
    }

    // ----------------------------------------------- IPv6: one client, one /64
    //
    // A phone on IPv6 has a /64 and can use any address in it. Keyed on the
    // full address, each was a fresh bucket.
    {
      await sql("delete from rate_limit; delete from discounts")
      const cart = [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'L' }]
      const check = (ip, code) => at(ip, 'api.php?r=discount', { method: 'POST', body: { items: cart, code } })
      const v6 = []
      for (let i = 1; i <= 31; i++) v6.push((await check(`2001:db8:1:2::${i.toString(16)}`, `WRONG${i}`)).status)
      is(v6.slice(0, 30).every((st) => st === 400) && v6[30] === 429,
         'thirty-one wrong codes from thirty-one addresses in ONE /64 are one client: the 31st is 429',
         `${v6.slice(0, 30).every((st) => st === 400) ? '400×30' : v6.join(',')}, then ${v6[30]}`)
      const next64 = await check('2001:db8:1:3::1', 'WRONG')
      is(next64.status === 400, 'the next /64 is somebody else', String(next64.status))
      const mixed = []
      for (let i = 0; i < 30; i++) mixed.push((await check(i % 2 ? '::ffff:203.0.113.5' : '203.0.113.5', `WRONG${i}`)).status)
      const plain = await check('203.0.113.5', 'WRONG')
      const neighbour = await check('203.0.113.6', 'WRONG')
      is(mixed.every((st) => st === 400) && plain.status === 429 && neighbour.status === 400,
         'an IPv4-mapped address is the IPv4 it carries — one bucket — and the next IPv4 is not',
         `${plain.status} ${neighbour.status}`)
      await sql('delete from rate_limit')
      // The payment gateways use the SAME rule (api/config-path.php), with the
      // proxy list they borrow from this config: KNET's log used to record
      // REMOTE_ADDR, i.e. the proxy, on every line.
      const knetIp = (await run('php', ['-r', `
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
        $_SERVER['HTTP_X_FORWARDED_FOR'] = '9.9.9.9, 203.0.113.9';
        require ${phpStr(join(STORE_DIR, 'config-path.php'))};
        require ${phpStr(join(ROOT, 'dropin/php-knet/knet.php'))};
        echo knet_client_ip(['trusted_proxy_ips' => ['127.0.0.1']]), ' ', knet_client_ip([]);`])
        .catch((e) => ({ stdout: `(php failed) ${e.stderr ?? e.message}`.slice(0, 200) }))).stdout
      is(knetIp === '203.0.113.9 127.0.0.1',
         'KNET names the client by the same rule — and trusts no forwarded address without a proxy list', knetIp)
    }

    // ------------------------------------- a cancelled order is not mailed
    {
      const WAREHOUSE = 'warehouse@example.test'
      const CFG_F = join(tmp, 'api-config-fulfilment.php')
      writeConfig(CFG_F, { warehouse_email: WAREHOUSE, mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw', warehouse_retry_window_minutes: 0 })
      const subjectOf = (m) => {
        const raw = m.split(/\r?\n/).find((l) => /^Subject:/i.test(l)) ?? ''
        const b = raw.match(/=\?UTF-8\?B\?([^?]+)\?=/i)?.[1]
        return b ? Buffer.from(b, 'base64').toString('utf8') : raw
      }
      const sentFor = (track) => mailsTo(WAREHOUSE).filter((m) => subjectOf(m).includes(track)).length
      // Until nothing is left to claim: the sandbox outbox holds the rest of
      // this suite's orders too, twenty are claimed per run, and only these
      // track ids are judged.
      const cronF = async () => {
        let suppressed = 0
        for (let i = 0; i < 30; i++) {
          const env = { ...process.env, SPORTA_API_CONFIG_FILE: CFG_F }
          const out = JSON.parse((await run('php', ['-d', `sendmail_path=sh ${MTA} ${maildir}`,
            join(STORE_DIR, 'cron-fulfilment.php'), '--run'], { env })).stdout)
          suppressed += out.suppressed ?? 0
          if (!out.claimed) break
        }
        return { suppressed }
      }
      const tag = Date.now().toString(36).toUpperCase()
      const place = (track, phone) => at(`198.20.0.${Number(phone.slice(-2))}`, 'api.php?r=order', { method: 'POST', body: {
        track_id: track, items: [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }],
        customer: { ...CUSTOMER, phone }, payment_method: 'cod' } })
      const [GONE, KEPT, LATE] = [`SPCAN1${tag}`, `SPCAN2${tag}`, `SPCAN3${tag}`]
      try {
        const placed = [await place(GONE, '95550301'), await place(KEPT, '95550302'), await place(LATE, '95550303')]
        is(placed.every((r) => r.status === 200), 'three cash orders, each with a picking list queued',
           placed.map((r) => r.status).join(','))
        // LATE's picking list goes out first, THEN it is cancelled.
        await sql(`update fulfilment_outbox set attempts = 5 where order_id in
                    (select id from orders where track_id in ('${GONE}', '${KEPT}'))`)
        await cronF()
        await sql(`update fulfilment_outbox set attempts = 0 where order_id in
                    (select id from orders where track_id in ('${GONE}', '${KEPT}'))`)
        is(sentFor(LATE) === 1, 'one picking list has really gone to the warehouse', String(sentFor(LATE)))
        await sql(`update orders set fulfilment_status = 'cancelled' where track_id in ('${GONE}', '${LATE}');
                   insert into fulfilment_outbox (order_id, kind, payload)
                   select id, 'payment', json_object('track_id', track_id, 'payment_status', 'failed')
                     from orders where track_id = '${LATE}'`)
        const out = await cronF()
        is(sentFor(GONE) === 0, 'a cancelled order the warehouse never heard of is NOT mailed', String(sentFor(GONE)))
        const gone = await sql(`select f.sent_at is not null, f.last_error from fulfilment_outbox f
                                 join orders o on o.id = f.order_id where o.track_id = '${GONE}'`)
        is(gone === '1\torder cancelled', 'its row is closed and says why', gone)
        is(sentFor(KEPT) === 1, 'an order that is still on is mailed as before', String(sentFor(KEPT)))
        is(sentFor(LATE) === 2,
           'and once a picking list HAS gone, the follow-up for a cancelled order still goes — it is the "do not ship"',
           `${sentFor(LATE)} mail(s), suppressed=${out?.suppressed}`)
      } finally {
        await sql(`delete f from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id like 'SPCAN%';
                   delete i from order_items i join orders o on o.id = i.order_id where o.track_id like 'SPCAN%';
                   delete from orders where track_id like 'SPCAN%'; delete from rate_limit`)
      }
    }

    // ---------------------------- a cancelled order gives its discount back
    {
      const tag = Date.now().toString(36).toUpperCase()
      const cronS = async () => {
        const env = { ...process.env, SPORTA_API_CONFIG_FILE: CFG }
        return JSON.parse((await run('php', [join(STORE_DIR, 'cron-stock.php'), '--release'], { env })).stdout)
      }
      await sql(`delete from rate_limit; delete from discounts;
                 insert into discounts (kind, code, label, type, value, min_order, active, usage_limit)
                 values ('code', 'LAUNCH3', 'launch', 'fixed', 1, 0, 1, 3)`)
      const used = async () => Number(await sql("select used_count from discounts where code = 'LAUNCH3'"))
      const place = (track, phone, items, method = 'cod') => at(`198.21.0.${Number(phone.slice(-2))}`, 'api.php?r=order', {
        method: 'POST', body: { track_id: track, items, customer: { ...CUSTOMER, phone }, payment_method: method,
          discount_code: 'LAUNCH3' } })
      const TOP = [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }]
      const BAG = [{ slug: 'cagliari-calcio-backpack', qty: 1 }]
      try {
        const three = []
        for (let i = 1; i <= 3; i++) three.push((await place(`SPLA${i}${tag}`, `9555040${i}`, TOP)).status)
        const ids = await sql(`select discount_ids from orders where track_id = 'SPLA1${tag}'`)
        const discountId = await sql("select id from discounts where code = 'LAUNCH3'")
        const recorded = /^\[/.test(ids) ? JSON.parse(ids) : []
        is(three.every((st) => st === 200) && await used() === 3 && recorded.includes(Number(discountId)),
           'three orders use a three-use code up, and each order records which rules it used',
           `${three.join(',')} used=${await used()} ids=${ids}`)
        const fourth = await place(`SPLA4${tag}`, '95550404', TOP)
        is(fourth.status === 400, 'a fourth is refused: the code is used up', `${fourth.status} ${fourth.body?.error}`)

        await sql(`update orders set fulfilment_status = 'cancelled' where track_id like 'SPLA_${tag}'`)
        await cronS()
        is(await used() === 0, 'cancel all three and the sweeper gives every use back', `used=${await used()}`)
        await cronS()
        is(await used() === 0, 'and a second run gives nothing back twice', `used=${await used()}`)

        const paid = await place(`SPLP${tag}`, '95550405', TOP, 'knet')
        await sql(`update orders set payment_status = 'paid' where track_id = 'SPLP${tag}'`)
        await cronS()
        is(paid.status === 200 && await used() === 1, 'a PAID order keeps its use', `used=${await used()}`)

        const bag = await place(`SPLB${tag}`, '95550406', BAG)
        is(bag.status === 200 && await used() === 2, 'an accessories-only order (it holds no stock) uses one too',
           `${bag.status} used=${await used()}`)
        await sql(`update orders set fulfilment_status = 'cancelled' where track_id = 'SPLB${tag}'`)
        await cronS()
        is(await used() === 1, 'and gives it back when cancelled — though it had no stock to release',
           `used=${await used()}`)

        // An ABANDONED card order that held only a use. Nobody cancelled it: the
        // shopper closed the bank page. It claimed no stock (an accessory), so
        // the sweeper's candidate query used to skip it, and a limited code was
        // burned for good by every such order.
        const fresh = await place(`SPLF${tag}`, '95550408', BAG, 'knet')
        const abandoned = await place(`SPLC${tag}`, '95550407', BAG, 'knet')
        const usedBefore = await used()
        await sql(`update orders set created_at = now() - interval 3 hour where track_id = 'SPLC${tag}'`)
        const swept = await cronS()
        const stOf = (t) => sql(`select concat(fulfilment_status, '/', payment_status, '/', discount_released) from orders where track_id = '${t}'`)
        is(fresh.status === 200 && abandoned.status === 200
           && await used() === usedBefore - 1 && await stOf(`SPLC${tag}`) === 'cancelled/pending/1',
           'a card order that held only a use and was abandoned for 3 hours is cancelled and gives the use back',
           `used ${usedBefore} -> ${await used()}; ${await stOf(`SPLC${tag}`)}; swept ${JSON.stringify(swept.track_ids)}`)
        is(await stOf(`SPLF${tag}`) === 'unfulfilled/pending/0',
           'while one still inside its hold is left alone', await stOf(`SPLF${tag}`))
        const usedAfter = await used()
        await cronS()
        is(await used() === usedAfter, 'and a second run gives nothing back twice', `used=${await used()}`)
      } finally {
        await sql(`delete f from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id like 'SPL%${tag}';
                   delete i from order_items i join orders o on o.id = i.order_id where o.track_id like 'SPL%${tag}';
                   delete from orders where track_id like 'SPL%${tag}'; delete from discounts; delete from rate_limit`)
      }
    }

    // ------------- a card order UNDER REVIEW that the owner cancels gives it all back
    //
    // A bank capture that does not match the order (wrong amount, no payment id,
    // an unrecognised result) is parked as payment_status 'review' and keeps its
    // garments claimed on purpose: the money may be real. When the owner settles
    // it at the bank and cancels the order in /backends, the cancel was accepted
    // but every release path excluded 'review', so the order stayed
    // stock_claimed=1 / stock_released=0 / discount_released=0 for ever: the
    // shelf short by its pieces and a limited code short by its spent use.
    // Measured before the fix: shelf 10, order of 2 leaves 8, cancel and sweep
    // still 8, sweeper candidates 0. A review order that is NOT cancelled must
    // still hold everything (that is what review is for), and a PAID one too.
    {
      const tag = Date.now().toString(36).toUpperCase()
      const cronR = async () => {
        const env = { ...process.env, SPORTA_API_CONFIG_FILE: CFG }
        return JSON.parse((await run('php', [join(STORE_DIR, 'cron-stock.php'), '--release'], { env })).stdout)
      }
      const JARR = new Map()
      const adminR = (route, body) => at('198.41.9.1', `admin.php?r=${route}`, { method: 'POST', body, jar: JARR })
      const shelf = async () => Number(await sql("select stock from product_variants where slug = 'cloudsoft-top-navy' and size = 'L'"))
      const used = async () => Number(await sql("select used_count from discounts where code = 'REVIEW2'"))
      const row = (t) => sql(`select concat(payment_status, '/', fulfilment_status, '/', stock_claimed, '/', stock_released, '/', discount_released) from orders where track_id = '${t}'`)
      const idR = async (t) => Number(await sql(`select id from orders where track_id = '${t}'`))
      const TOP2 = [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 2 }]
      const place = (track, phone, method) => at(`198.41.0.${Number(phone.slice(-2))}`, 'api.php?r=order', {
        method: 'POST', body: { track_id: track, items: TOP2, customer: { ...CUSTOMER, phone }, payment_method: method,
          discount_code: 'REVIEW2' } })
      const stock0 = await shelf()
      try {
        await sql(`delete from rate_limit; delete from discounts;
                   update admin_users set failed_attempts = 0, locked_until = null where email = 'cs@sporta.com.kw';
                   insert into discounts (kind, code, label, type, value, min_order, active, usage_limit)
                   values ('code', 'REVIEW2', 'review', 'fixed', 1, 0, 1, 2)`)
        const signed = await at('198.41.9.1', 'admin.php?r=login', { method: 'POST',
          body: { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' }, jar: JARR })
        is(signed.status === 200, 'the owner signs in for the review-order checks', `${signed.status} ${signed.body?.error ?? ''}`)

        for (const method of ['knet', 'tpay']) {
          const A = `SPRV${method === 'knet' ? 'K' : 'T'}${tag}`
          const before = await shelf()
          const placed = await place(A, method === 'knet' ? '95560701' : '95560702', method)
          is(placed.status === 200 && await shelf() === before - 2 && await used() === 1,
             `a ${method} order for 2 claims both pieces and one code use`, `${placed.status} shelf ${before}->${await shelf()} used=${await used()}`)
          // the capture lands in review, as the callbacks leave it
          await sql(`update orders set payment_status = 'review' where track_id = '${A}'`)
          await sql(`update orders set created_at = now() - interval 3 hour where track_id = '${A}'`)
          const held = await cronR()
          is(!held.track_ids?.includes(A) && await shelf() === before - 2 && await used() === 1
             && await row(A) === 'review/unfulfilled/1/0/0',
             `control: a ${method} order under review that is NOT cancelled keeps its pieces and its use, however old`,
             `${await row(A)} shelf=${await shelf()} used=${await used()}`)
          const c = await adminR('fulfilment', { order_id: await idR(A), status: 'cancelled' })
          is(c.status === 200, `the owner cancels the ${method} order under review`, `${c.status} ${c.body?.error ?? ''}`)
          const swept = await cronR()
          is(swept.track_ids?.includes(A) && await shelf() === before && await used() === 0
             && await row(A) === 'review/cancelled/1/1/1',
             `and the sweep gives its 2 pieces and its code use back (${method})`,
             `${await row(A)} shelf=${await shelf()} (want ${before}) used=${await used()} swept=${JSON.stringify(swept.track_ids)}`)
          await cronR()
          is(await shelf() === before && await used() === 0, `a second sweep gives nothing back twice (${method})`,
             `shelf=${await shelf()} used=${await used()}`)
        }

        // A review order cancelled and swept can be put back: it claims again, once.
        const B = `SPRVB${tag}`
        const b0 = await shelf()
        await place(B, '95560703', 'knet')
        await sql(`update orders set payment_status = 'review' where track_id = '${B}'`)
        await adminR('fulfilment', { order_id: await idR(B), status: 'cancelled' })
        await cronR()
        const back = await adminR('fulfilment', { order_id: await idR(B), status: 'unfulfilled' })
        is(back.status === 200 && await shelf() === b0 - 2 && await used() === 1 && await row(B) === 'review/unfulfilled/1/0/0',
           'putting a released review order back claims its pieces and its use again, once',
           `${back.status} ${back.body?.error ?? ''} ${await row(B)} shelf ${b0}->${await shelf()} used=${await used()}`)

        // A PAID order is never released, cancelled or not (the admin refuses the cancel).
        const P = `SPRVP${tag}`
        const p0 = await shelf()
        await place(P, '95560704', 'knet')
        await sql(`update orders set payment_status = 'paid', fulfilment_status = 'cancelled' where track_id = '${P}'`)
        await cronR()
        is(await shelf() === p0 - 2 && await row(P) === 'paid/cancelled/1/0/0',
           'a PAID order is never released by the sweeper, even if its fulfilment says cancelled', `${await row(P)} shelf=${await shelf()}`)
      } finally {
        await sql(`delete f from fulfilment_outbox f join orders o on o.id = f.order_id where o.track_id like 'SPRV%${tag}';
                   delete i from order_items i join orders o on o.id = i.order_id where o.track_id like 'SPRV%${tag}';
                   delete from orders where track_id like 'SPRV%${tag}'; delete from discounts; delete from rate_limit;
                   update product_variants set stock = ${stock0} where slug = 'cloudsoft-top-navy' and size = 'L'`)
      }
    }

    // ------------------------------------------- what one password guess costs
    {
      const ARGON = 'rl-argon@example.test'
      const ARGON_PW = 'rl-argon-password-0001'
      // An account hashed with PHP's old defaults (64 MiB, four passes).
      const old = (await run('php', ['-r',
        `echo '$sporta-admin-v1$' . password_hash(hash('sha256', ${phpStr(ARGON_PW)}), PASSWORD_ARGON2ID);`])).stdout
      await sql(`delete from admin_users where email = '${ARGON}';
                 insert into admin_users (email, password_hash) values ('${ARGON}', '${old}')`)
      try {
        const r = await login('198.22.0.1', ARGON, ARGON_PW)
        const now = await sql(`select password_hash from admin_users where email = '${ARGON}'`)
        is(old.includes('m=65536,t=4,p=1') && r.status === 200 && now.includes('$argon2id$v=19$m=19456,t=2,p=1$'),
           'a sign-in upgrades an older hash to 19 MiB and two passes', now.slice(0, 48))
        const src = readFileSync(join(STORE_DIR, 'store.php'), 'utf8')
        const opts = src.match(/STORE_ADMIN_ARGON_OPTS\s*=\s*\['memory_cost'\s*=>\s*(\d+),\s*'time_cost'\s*=>\s*(\d+),\s*'threads'\s*=>\s*(\d+)\]/)
        const dummy = src.match(/\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/)
        is(opts && dummy && opts.slice(1).join() === dummy.slice(1).join(),
           'and the unknown-email dummy hash uses the very same parameters, so timing says nothing',
           `${opts?.slice(1).join()} vs ${dummy?.slice(1).join()}`)
      } finally {
        await sql(`delete from admin_users where email = '${ARGON}'; delete from rate_limit`)
      }
    }

    // ------------------------- admin forgot_password: the answer comes first
    //
    // The mail relay here takes 0.4 s per message, the way a real one can.
    // Before, a real admin address waited for it and an unknown one did not.
    {
      const RESET = 'rl-reset@example.test'
      await sql(`delete from admin_users where email = '${RESET}';
                 insert into admin_users (email, password_hash) values ('${RESET}', '${await hashOf('rl-reset-password-0001')}')`)
      const SBASE = `http://127.0.0.1:${SLOW_PORT}`
      let k = 0
      const timed = async (email) => {
        await sql(`delete from rate_limit where bucket_key = '${rlKey('admin_password_reset_identity', email)}'`)
        const t0 = performance.now()
        const r = await at(`198.23.0.${++k}`, 'admin.php?r=forgot_password', { method: 'POST', body: { email }, base: SBASE })
        return { ms: performance.now() - t0, r }
      }
      const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      try {
        const real = []
        const none = []
        for (let i = 0; i < 7; i++) {
          real.push(await timed(RESET))
          // Let that request's mail land before the next request, so a worker
          // still busy with the relay is never what a later one waits behind.
          await waitFor(() => mailsTo(RESET, slowMaildir).length > i || null, 4000)
          none.push(await timed('rl-nobody@example.test'))
        }
        const dReal = median(real.map((x) => x.ms))
        const dNone = median(none.map((x) => x.ms))
        is(real.concat(none).every((x) => x.r.status === 200 && x.r.body?.ok === true) && Math.abs(dReal - dNone) < 150,
           'a real admin address and an unknown one answer in the same time (median of seven)',
           `${Math.round(dReal)} ms vs ${Math.round(dNone)} ms`)
        const arrived = await waitFor(() => mailsTo(RESET, slowMaildir).length >= 7 || null, 8000)
        is(!!arrived, 'and the mails are still sent — after the answer', `${mailsTo(RESET, slowMaildir).length} of 7`)
        const tokens = mailsTo(RESET, slowMaildir).map((m) => m.match(/#reset=([a-f0-9]{64})/)?.[1])
        const older = await at('198.23.1.1', 'admin.php?r=reset_password',
          { method: 'POST', body: { token: tokens[0], password: 'rl-reset-password-0002' }, base: SBASE })
        is(older.status === 400 && older.body?.error === 'invalid_reset_token',
           'and a newer mail still retires the older link', `${older.status} ${older.body?.error}`)
        const rowIp = await sql(`select request_ip from admin_password_resets r join admin_users u on u.id = r.admin_id
                                  where u.email = '${RESET}' order by r.id limit 1`)
        is(rowIp === rlKey('admin_reset_ip', '198.23.0.1'),
           'the admin reset row records the client as an HMAC, not a reversible SHA-256', rowIp)
      } finally {
        await sql(`delete r from admin_password_resets r join admin_users u on u.id = r.admin_id where u.email = '${RESET}';
                   delete from admin_users where email = '${RESET}'; delete from rate_limit`)
      }
    }
  } finally {
    killAll()
    await sql(`delete from admin_users where email in ('${OWNER}', '${MFA}', '${OTHER}'); delete from rate_limit`)
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// RATE LIMITING FAILS CLOSED
//
// The dispatcher used to read `isset($STORE_LIMITS[$r])`, and isset() is false
// for a null — so a route deliberately opted out and a route somebody FORGOT
// were indistinguishable, and both ran unthrottled. The table was complete at
// the time; the bug was the next route added.
//
// Last in the file on purpose: these checks deliberately exhaust buckets, and
// anything running after them would be measuring the damage.
{
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])

  // A route that is not in the table at all — the forgotten-route case.
  let unlisted = 0
  for (let i = 0; i < 70; i++) {
    const res = await fetch(`${BASE}/api.php?r=noSuchRouteExists`)
    if (res.status === 429) { unlisted = i + 1; break }
  }
  is(unlisted > 0, 'an UNLISTED route is throttled by the default, not waved through',
     unlisted ? `429 after ${unlisted}` : 'never limited in 70')

  // ...but an explicit null must still mean unlimited, or the fix has broken
  // the home page: one visit legitimately asks for every slide at once.
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  let slideLimited = 0
  for (let i = 0; i < 80; i++) {
    const res = await fetch(`${BASE}/api.php?r=slide_image&id=1&v=x`)
    if (res.status === 429) { slideLimited = i + 1; break }
  }
  is(slideLimited === 0, 'an explicit null opt-out is still unlimited',
     slideLimited ? `throttled after ${slideLimited}` : 'unlimited, as intended')

  // The account lockout is PER ACCOUNT: it cannot see one guess sprayed across
  // many addresses, and for an unknown email there is no row to lock at all.
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  let spray = 0
  // What the spray actually got. Without this the failure reads "never limited
  // in 60" and says nothing about WHY — a spray answered 409 no_admin_account
  // never reaches the throttle at all, and looks identical to a broken guard.
  const spraySaw = {}
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${BASE}/admin.php?r=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ email: `spray${i}@example.com`, password: 'guess' }),
    })
    const tag = `${res.status} ${(await res.json().catch(() => ({})))?.error ?? ''}`.trim()
    spraySaw[tag] = (spraySaw[tag] ?? 0) + 1
    if (res.status === 429) { spray = i + 1; break }
  }
  is(spray > 0, 'a login spray across unknown emails is stopped by IP, not just by account',
     spray ? `429 after ${spray}` : `never limited in 60 — saw ${JSON.stringify(spraySaw)}`)

  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
}

console.log(fails ? `\n${fails} problem(s) in the native backend` : '\nnative backend: every check passed')
process.exit(fails ? 1 : 0)
