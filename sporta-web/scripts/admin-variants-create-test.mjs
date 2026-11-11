// admin.php?r=variants_create: the SMALLEST server change the "New product" screen needs (sizes + opening stock in one
// all-or-nothing call). Real MariaDB + php -S, no mocks, like test:admin-storefront.
//   npm run test:variants-create     (needs `bash scripts/sandbox.sh`)
// Everything the suite creates is named vc-test-* / VCT* and removed again.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
let fails = 0, passes = 0
const is = (c, n, d = '') => { if (c) { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) } }
const sql = (q) => run('mariadb', ['sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, {
    headers: { ...(opts.noType ? {} : { 'Content-Type': 'application/json' }), 'X-Sporta-Admin': '1', ...(cookie && !opts.anon ? { Cookie: cookie } : {}) },
    method: opts.method ?? 'GET', body: opts.body,
  })
  const set = res.headers.get('set-cookie')
  if (set && !opts.anon) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}
const post = (route, body, o = {}) => admin(route, { method: 'POST', body: JSON.stringify(body), ...o })
const api = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/api.php?r=${route}`, { headers: { 'Content-Type': 'application/json' }, ...opts })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const cleanup = () => sql(
  "delete oi from order_items oi join orders o on o.id = oi.order_id where o.track_id like 'VCT%'; " +
  "delete from fulfilment_outbox where order_id in (select id from orders where track_id like 'VCT%'); delete from orders where track_id like 'VCT%'; " +
  "delete from inventory_movements where sku like 'VC-TEST%'; delete from product_variants where slug like 'vc-test-%'; delete from products where slug like 'vc-test-%'; " +
  "delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null")
await cleanup()
const signIn = await post('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

const base = { id: 0, slug: 'vc-test-tee', name_en: 'VC Test Tee', name_ar: 'قميص', price: '9.5', category: 'men', active: false, desc_en: '', desc_ar: '', featured: false, featured_sort: 0, brand_slug: '', image: '', images: '' }
is((await post('product_save', base)).status === 200, 'a hidden product is created')

// probe: the New product screen asks with GET whether the route exists (an old server answers 404 not_found)
const probe = await admin('variants_create')
is(probe.status === 405 && probe.body?.error === 'method_not_allowed', 'GET answers 405 (how the screen tells a server that has the route from one that has not)', `${probe.status}`)
is((await admin('variants_create', { method: 'POST', body: '{}', anon: true })).status === 401, 'without the admin session it is refused (401)')
is((await admin('variants_create', { method: 'POST', body: JSON.stringify({ slug: 'vc-test-tee', sizes: [{ size: 'M', stock: 1 }] }), noType: true })).body?.error === 'bad_request', 'a body that is not application/json is refused')

// validation: each leaves the table untouched
const count = async () => Number(await sql("select count(*) from product_variants where slug = 'vc-test-tee'"))
const bad = async (body, code, name) => { const r = await post('variants_create', body); is(r.body?.error === code && (await count()) === 0, name, `${r.status} ${r.body?.error}`) }
await bad({ slug: 'vc-test-tee', sizes: [] }, 'invalid_sizes', 'no sizes is refused')
await bad({ slug: 'vc-test-tee', sizes: 'M' }, 'invalid_sizes', 'sizes must be a list')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'M', stock: 1 }, { size: 'm', stock: 2 }] }, 'duplicate_size', 'the same size twice (M and m) is refused')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'TOOLONG', stock: 1 }] }, 'invalid_size', 'a size over 4 characters is refused')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'M L', stock: 1 }] }, 'invalid_size', 'a size with a space is refused')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'M', stock: -1 }] }, 'stock_out_of_range', 'negative stock is refused')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'M', stock: 1000000 }] }, 'stock_out_of_range', 'stock over 999999 is refused')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'M', stock: 1.5 }] }, 'invalid_stock', 'fractional stock is refused')
await bad({ slug: 'vc-test-tee', sizes: Array.from({ length: 21 }, (_, i) => ({ size: 'S' + i, stock: 1 })) }, 'invalid_sizes', 'more than 20 sizes is refused')
await bad({ slug: 'vc-test-tee', sizes: [{ size: 'M', stock: 3 }, { size: 'BAD SIZE', stock: 1 }] }, 'invalid_size', 'one bad size in the list writes NOTHING (all or nothing)')
{ const r = await post('variants_create', { slug: 'vc-test-nope', sizes: [{ size: 'M', stock: 1 }] }); is(r.status === 404 && r.body?.error === 'product_not_found', 'an unknown product is 404 product_not_found') }
{ const r = await post('variants_create', { slug: '', sizes: [{ size: 'M', stock: 1 }] }); is(r.body?.error === 'invalid_slug', 'an empty slug is refused') }

// the happy path
const made = await post('variants_create', { slug: 'vc-test-tee', sizes: [{ size: 'm', stock: 5 }, { size: 'L', stock: '0' }, { size: 'XL', stock: 12 }] })
is(made.status === 200 && made.body?.variants?.length === 3, 'three sizes are created in one call', `${made.status} ${made.body?.error ?? ''}`)
const rows = await sql("select sku, size, stock, inventory_version from product_variants where slug = 'vc-test-tee' order by size")
is(rows === 'VC-TEST-TEE-L\tL\t0\t1\nVC-TEST-TEE-M\tM\t5\t1\nVC-TEST-TEE-XL\tXL\t12\t1', 'sku = SLUG-SIZE in capitals, size upper-cased, stock as sent, version 1', rows.replace(/\n/g, ' | '))
const mv = await sql("select type, before_stock, after_stock, delta, note from inventory_movements where sku like 'VC-TEST-TEE-%' order by sku")
is(mv.split('\n').length === 3 && mv.split('\n').every((l) => l.startsWith('count\t0\t')), 'each size opens a "count" movement 0 -> stock', mv.replace(/\n/g, ' | '))
const inv = (await admin('variants')).body.filter((v) => v.slug === 'vc-test-tee')
is(inv.length === 3 && inv.every((v) => v.inventory_version === 1), 'the admin Stock screen reads them (variants route)')
is((await post('set_stock', { sku: 'VC-TEST-TEE-M', stock: 4 })).status === 200, 'set_stock now works on the new row (it answered sku_not_found for a row that did not exist)')

// never overwrite
{ const r = await post('variants_create', { slug: 'vc-test-tee', sizes: [{ size: 'S', stock: 1 }, { size: 'M', stock: 99 }] })
  is(r.status === 409 && r.body?.error === 'size_exists', 'a size the product already has is refused 409 size_exists', `${r.status} ${r.body?.error}`)
  is((await sql("select stock from product_variants where sku = 'VC-TEST-TEE-M'")) === '4' && (await count()) === 3, 'and nothing else of that call was written (S not added, M not overwritten)') }
{ const r = await post('variants_create', { slug: 'vc-test-tee', sizes: [{ size: 'S', stock: 2 }] })
  is(r.status === 200 && (await count()) === 4, 'adding a NEW size later is allowed') }

// a size is then demanded by the order path (the guard the product had no way to get before)
const CUSTOMER = { name: 'Fatima Al-Sabah', phone: '٩٩٨٨٧٧٦٦', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5', floor: '3', flat: '7', note: '' }
await post('product_active', { id: Number(await sql("select id from products where slug = 'vc-test-tee'")), active: true })
{ const st = (await api('stock')).body.filter((x) => x.slug === 'vc-test-tee')
  is(st.length === 4, 'the public stock list shows the sizes (M L XL S) once the product is on sale', `${st.length}`) }
{ const r = await api('order', { method: 'POST', body: JSON.stringify({ track_id: 'VCT0001', items: [{ slug: 'vc-test-tee', qty: 1 }], customer: CUSTOMER, payment_method: 'cod' }) })
  is(r.body?.error === 'size_required_vc-test-tee', 'once it has sizes an order with no size is refused', `${r.body?.error}`) }
{ const r = await api('order', { method: 'POST', body: JSON.stringify({ track_id: 'VCT0002', items: [{ slug: 'vc-test-tee', qty: 9, size: 'M' }], customer: CUSTOMER, payment_method: 'cod' }) })
  is(/out_of_stock/.test(String(r.body?.error ?? '')), 'and one more than the opening stock is refused as out of stock', `${r.body?.error}`) }

// sku clash between two long slugs
const long = 'vc-test-' + 'x'.repeat(40)
await post('product_save', { ...base, slug: long + 'a', name_en: 'Long A' })
await post('product_save', { ...base, slug: long + 'b', name_en: 'Long B' })
const a = await post('variants_create', { slug: long + 'a', sizes: [{ size: 'M', stock: 1 }] })
const b = await post('variants_create', { slug: long + 'b', sizes: [{ size: 'M', stock: 1 }] })
is(a.status === 200 && b.status === 200 && a.body.variants[0].sku !== b.body.variants[0].sku && a.body.variants[0].sku.length <= 30 && b.body.variants[0].sku.length <= 30,
   'two long slugs that cut to the same 30 characters still get distinct skus', `${a.body?.variants?.[0]?.sku} / ${b.body?.variants?.[0]?.sku}`)
const act = await sql("select count(*) from admin_activity_log where action_key = 'variants_create'")
is(Number(act) >= 3, 'the successful calls are in the activity log', act)
await cleanup()
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
