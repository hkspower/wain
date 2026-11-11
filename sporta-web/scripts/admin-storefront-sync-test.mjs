// What the owner sets in /backends must show on the storefront, and what the storefront
// quotes must be what is charged. One suite, one section per admin-editable thing:
// write through the ADMIN route, read through the PUBLIC route the storefront (and its
// add-ons) read, compare. Real MariaDB + php -S, no mocks, like test:native.
//
//   npm run test:admin-storefront     (needs `bash scripts/sandbox.sh`: MariaDB and php -S :8095)
//
// Found by this pass (each has its own section below, marked FIX):
//   - renaming a PRODUCT's slug left its sizes behind (public stock and the admin Stock
//     screen lost them; the product could then be ordered with no size)
//   - renaming a BRAND without sending its slug re-derived the slug from the new name and
//     detached every product (no brand on the page, brand gone from the public list)
//   - a category typed as "Men" over "men" saved fine and then matched nothing: the piece left
//     /shop?category=men, and a discount rule aimed at it was shown as live and never applied
//   - a description over 280 characters was saved "successfully" minus its tail
// Everything the suite creates is named sync-test-* / SPSYNC* and removed again.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'

let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const sql = (q) => run('mariadb', ['sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())

const api = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/api.php?r=${route}`, { headers: { 'Content-Type': 'application/json' }, ...opts })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}
let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, {
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
    method: opts.method ?? 'GET', body: opts.body,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}
const post = (route, body) => admin(route, { method: 'POST', body: JSON.stringify(body) })
const products = async () => (await api('products')).body
const pub = async (slug) => (await products()).find((p) => p.slug === slug)
const stockOf = async (slug) => (await api('stock')).body.filter((s) => s.slug === slug)

const CUSTOMER = { name: 'Fatima Al-Sabah', phone: '٩٩٨٨٧٧٦٦', governorate: 'hawalli', area: 'Salmiya',
  block: '4', street: '12', building: '5', floor: '3', flat: '7', note: '' }
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const utc = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().slice(0, 16) // datetime-local, read by the server as UTC

const SLUG = 'sync-test-tee', SLUG2 = 'sync-test-tee-renamed'
const cleanup = () => sql(
  "delete oi from order_items oi join orders o on o.id = oi.order_id where o.track_id like 'SPSYNC%'; " +
  "delete from fulfilment_outbox where order_id in (select id from orders where track_id like 'SPSYNC%'); " +
  "delete from orders where track_id like 'SPSYNC%'; " +
  "delete from inventory_movements where sku like 'SYNCTEST-%'; delete from product_variants where slug like 'sync-test-%'; delete from products where slug like 'sync-test-%'; " +
  "delete from brands where slug like 'sync-test-%'; delete from discounts where label like 'sync-test%'; " +
  "delete from hero_slides where title_en like 'sync-test%'; delete from rate_limit; " +
  'update admin_users set failed_attempts = 0, locked_until = null')
await cleanup()

const signIn = await post('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

// A product the suite owns: three sizes of stock in the table (the admin Stock screen writes the same rows).
const baseProduct = { id: 0, slug: SLUG, name_en: 'Sync Test Tee', name_ar: 'قميص اختبار', price: '10.5', category: 'men', active: true,
  desc_en: 'A plain test tee.', desc_ar: 'قميص اختبار بسيط.', featured: true, featured_sort: 3, brand_slug: '', image: '', images: '' }
const made = await post('product_save', baseProduct)
is(made.status === 200 && made.body?.id > 0, 'a product is created through the admin', `${made.status} ${made.body?.error ?? ''}`)
const PID = made.body.id
await sql(`insert into product_variants (sku, slug, size, stock) values ('SYNCTEST-M', '${SLUG}', 'M', 5), ('SYNCTEST-L', '${SLUG}', 'L', 0)`)

// ======================================================================= products
{
  const p = await pub(SLUG)
  is(!!p && p.name_en === 'Sync Test Tee' && p.name_ar === 'قميص اختبار', 'PRODUCT name_en / name_ar reach the public list', `${p?.name_en}`)
  is(p?.price === 10.5 && p?.list_price === 10.5 && p?.on_sale === false && typeof p.price === 'number', 'PRODUCT price 10.5 is 10.500 on the shelf, a number, not on sale', `${p?.price}`)
  is(p?.featured === true && p?.desc_en === 'A plain test tee.' && p?.desc_ar === 'قميص اختبار بسيط.', 'PRODUCT featured flag and both descriptions reach the public list')
  is(p?.category === 'men', 'PRODUCT category is the one the shop filters by', `${p?.category}`)

  const fils = await post('product_save', { ...baseProduct, id: PID, price: '10.125' })
  is((await pub(SLUG))?.price === 10.125, 'PRODUCT a three-decimal KWD price (10.125) is served exactly', `${(await pub(SLUG))?.price}`)

  // sale window, read in UTC (the admin form says so)
  const open = await post('product_save', { ...baseProduct, id: PID, price: '10', sale_price: '8', sale_starts_at: utc(-3600e3), sale_ends_at: utc(3600e3) })
  let q = await pub(SLUG)
  is(open.status === 200 && q.price === 8 && q.list_price === 10 && q.on_sale === true, 'SALE inside its window: price is the sale price, list_price the old one, on_sale true', `${q?.price}/${q?.list_price}/${q?.on_sale}`)
  is(!('sale_price' in q) && !('sale_starts_at' in q), 'SALE the window dates and raw sale_price are never sent to the browser')
  await post('product_save', { ...baseProduct, id: PID, price: '10', sale_price: '8', sale_starts_at: utc(3600e3), sale_ends_at: utc(7200e3) })
  q = await pub(SLUG)
  is(q.price === 10 && q.on_sale === false, 'SALE not started yet: the list price is charged and shown', `${q.price}/${q.on_sale}`)
  await post('product_save', { ...baseProduct, id: PID, price: '10', sale_price: '8', sale_starts_at: utc(-7200e3), sale_ends_at: utc(-3600e3) })
  q = await pub(SLUG)
  is(q.price === 10 && q.on_sale === false, 'SALE already ended: back to the list price', `${q.price}/${q.on_sale}`)
  const above = await post('product_save', { ...baseProduct, id: PID, price: '10', sale_price: '12' })
  is(above.body?.error === 'sale_not_lower', 'SALE a "sale" above the list price is refused, not saved and ignored', above.body?.error)
  await post('product_save', { ...baseProduct, id: PID, price: '10', sale_price: '' })

  // photos
  const ph = await post('product_save', { ...baseProduct, id: PID, price: '10', image: '/images/products/sync-test-a.jpg', images: '/images/products/sync-test-b.jpg, /images/products/sync-test-c.jpg ,' })
  q = await pub(SLUG)
  is(ph.status === 200 && q.image === '/images/products/sync-test-a.jpg' && q.images === '/images/products/sync-test-b.jpg,/images/products/sync-test-c.jpg',
     'PHOTOS the main image and the extra list (comma separated, blanks dropped) reach the public list', `${q.image} | ${q.images}`)
  const off = await post('product_save', { ...baseProduct, id: PID, price: '10', image: 'https://evil.example/x.jpg' })
  is(off.body?.error === 'invalid_link', 'PHOTOS an off-site image address cannot be saved', off.body?.error)
  await post('product_save', { ...baseProduct, id: PID, price: '10' })

  // visible / hidden
  await post('product_active', { id: PID, active: false })
  is(!(await pub(SLUG)) && (await stockOf(SLUG)).length === 0, 'ACTIVE off: the product and its stock rows leave the public feeds')
  const hiddenOrder = await api('order', { method: 'POST', body: JSON.stringify({ track_id: 'SPSYNC0000', items: [{ slug: SLUG, qty: 1, size: 'M' }], customer: CUSTOMER, payment_method: 'cod' }) })
  is(hiddenOrder.body?.error === `unavailable_${SLUG}`, 'ACTIVE off: and it cannot be ordered either', hiddenOrder.body?.error)
  await post('product_active', { id: PID, active: true })
  is(!!(await pub(SLUG)), 'ACTIVE on: it is back at once (no cache between the admin and the shopper)')

  // FIX: category spelling
  const cat = await post('product_save', { ...baseProduct, id: PID, price: '10', category: ' Men ' })
  is(cat.body?.category === 'men' && (await pub(SLUG)).category === 'men', 'FIX CATEGORY "Men" typed over the shop\'s "men" is saved as "men" (the filter key), not as a new category', `${cat.body?.category}`)
  const newCat = await post('product_save', { ...baseProduct, id: PID, price: '10', category: 'Sync-Test-Cat' })
  is(newCat.body?.category === 'Sync-Test-Cat', 'CATEGORY a genuinely new category is kept as typed')
  const longCat = await post('product_save', { ...baseProduct, id: PID, price: '10', category: 'x'.repeat(41) })
  is(longCat.status === 400 && longCat.body?.error === 'too_long_category', 'FIX CATEGORY 41 characters (the column holds 40) is refused, not a 500', `${longCat.status} ${longCat.body?.error}`)
  await post('product_save', { ...baseProduct, id: PID, price: '10', category: 'men' })

  // FIX: descriptions are not cut in silence
  const d280 = 'ا'.repeat(280)
  const exact = await post('product_save', { ...baseProduct, id: PID, price: '10', desc_ar: d280, desc_en: 'e'.repeat(280) })
  is(exact.status === 200 && (await pub(SLUG)).desc_ar === d280, 'DESCRIPTION exactly 280 characters (Arabic) is stored whole', `${exact.body?.error ?? ''}`)
  const over = await post('product_save', { ...baseProduct, id: PID, price: '10', desc_en: 'y'.repeat(281) })
  is(over.status === 400 && over.body?.error === 'too_long_desc_en', 'FIX DESCRIPTION 281 characters is refused with a token the admin can show, not saved minus its tail', `${over.status} ${over.body?.error}`)
  is((await pub(SLUG)).desc_en === 'e'.repeat(280), 'DESCRIPTION and the refused save changed nothing')
  await sql(`update products set desc_en = '${'z'.repeat(400)}' where id = ${PID}`)
  const keep = await post('product_save', { ...baseProduct, id: PID, price: '11', desc_en: 'z'.repeat(400) })
  is(keep.status === 200 && (await pub(SLUG)).desc_en.length === 400 && (await pub(SLUG)).price === 11,
     'DESCRIPTION an already-stored long text is kept whole, so an unrelated price edit is never blocked by it', `${keep.status} ${keep.body?.error ?? ''}`)
  await post('product_save', { ...baseProduct, id: PID, price: '10' })
}

// ================================================================ sizes and stock
{
  const rows = await stockOf(SLUG)
  is(rows.length === 2 && rows.find((r) => r.size === 'M')?.in_stock === true && rows.find((r) => r.size === 'L')?.in_stock === false,
     'STOCK public list: M in stock, L sold out (in_stock is a boolean)', JSON.stringify(rows.map((r) => [r.size, r.stock, r.in_stock])))
  await post('set_stock', { sku: 'SYNCTEST-L', stock: 2 })
  is((await stockOf(SLUG)).find((r) => r.size === 'L')?.stock === 2, 'STOCK a count set in the admin is on the public feed at once')
  await post('set_stock', { sku: 'SYNCTEST-L', stock: 0 })

  // FIX: rename the product, the sizes follow
  const ren = await post('product_save', { ...baseProduct, id: PID, slug: SLUG2, price: '10' })
  is(ren.status === 200 && ren.body?.slug === SLUG2, 'RENAME a product web name is changed through the admin')
  is((await stockOf(SLUG2)).length === 2 && (await stockOf(SLUG)).length === 0,
     'FIX RENAME its sizes and stock moved with it (public stock list)', `${(await stockOf(SLUG2)).length} under the new name, ${(await stockOf(SLUG)).length} under the old`)
  const adminVariants = (await admin('variants')).body.filter((v) => v.slug === SLUG2)
  is(adminVariants.length === 2 && adminVariants.every((v) => v.name_en === 'Sync Test Tee'), 'FIX RENAME and on the admin Stock screen, with the product name joined')
  const noSize = await api('order', { method: 'POST', body: JSON.stringify({ track_id: 'SPSYNC0001', items: [{ slug: SLUG2, qty: 1 }], customer: CUSTOMER, payment_method: 'cod' }) })
  is(noSize.body?.error === `size_required_${SLUG2}`, 'FIX RENAME the renamed product still demands a size (it was orderable with none)', noSize.body?.error)
  const back = await post('product_save', { ...baseProduct, id: PID, slug: SLUG, price: '10' })
  is(back.status === 200 && (await stockOf(SLUG)).length === 2, 'RENAME and back again moves them back')
  const clash = await post('product_save', { ...baseProduct, id: 0, slug: SLUG, price: '10' })
  is(clash.body?.error === 'slug_taken', 'RENAME a web name already in use is refused', clash.body?.error)
}

// ===================================================================== brands
{
  const bmade = await post('brand_save', { name_en: 'Sync Test Brand', name_ar: 'علامة اختبار', sort: 5, logo: PX })
  is(bmade.body?.slug === 'sync-test-brand', 'BRAND created, web name derived from the English name', bmade.body?.slug)
  const BID = bmade.body.id
  is(!(await api('brands')).body.some((b) => b.slug === 'sync-test-brand'), 'BRAND with no listed product is not on the storefront (owner rule: hidden until tagged)')
  await post('brand_assign', { brand_slug: 'sync-test-brand', products: [SLUG] })
  const row = (await api('brands')).body.find((b) => b.slug === 'sync-test-brand')
  is(row?.has_logo == 1 && row?.products === 1 && row?.name_ar === 'علامة اختبار' && /^[0-9a-f]{12}$/.test(row?.logo_v ?? ''), 'BRAND tagged: public list carries names, logo flag + hash and the product count', JSON.stringify(row))
  const p = await pub(SLUG)
  is(p.brand_slug === 'sync-test-brand' && p.brand_name_en === 'Sync Test Brand' && p.brand_has_logo === 1, 'BRAND the product carries the brand name and logo flag', `${p.brand_name_en}`)
  const logo = await fetch(`${BASE}/api.php?r=brand_logo&slug=sync-test-brand&v=${row.logo_v}`)
  is(logo.status === 200 && /image\/png/.test(logo.headers.get('content-type') ?? '') && /immutable/.test(logo.headers.get('cache-control') ?? ''), 'BRAND logo is served as an image on a hashed, immutable URL', `${logo.status} ${logo.headers.get('content-type')}`)

  // FIX: rename with and without the slug
  const r1 = await post('brand_save', { id: BID, name_en: 'Sync Test Brand Two', name_ar: 'علامة اختبار ٢' })
  is(r1.body?.slug === 'sync-test-brand', 'FIX BRAND a rename with no slug in the form keeps the web name', r1.body?.slug)
  const p1 = await pub(SLUG)
  is(p1.brand_slug === 'sync-test-brand' && p1.brand_name_en === 'Sync Test Brand Two', 'FIX BRAND the product still carries it, under the new name', `${p1.brand_slug} ${p1.brand_name_en}`)
  is((await api('brands')).body.some((b) => b.slug === 'sync-test-brand' && b.name_en === 'Sync Test Brand Two'), 'FIX BRAND and it stays on the public list')
  is(r1.body?.logo?.startsWith('data:image/png') ?? false, 'BRAND the logo is untouched by a rename that omits it')
  const r2 = await post('brand_save', { id: BID, slug: 'sync-test-brand-new', name_en: 'Sync Test Brand Two', name_ar: 'علامة اختبار ٢' })
  const p2 = await pub(SLUG)
  is(r2.body?.slug === 'sync-test-brand-new' && p2.brand_slug === 'sync-test-brand-new' && p2.brand_name_en === 'Sync Test Brand Two',
     'FIX BRAND an explicit new web name is carried to every product that has the brand', `${p2.brand_slug}`)
  is((await admin('brands')).body.find((b) => b.slug === 'sync-test-brand-new')?.products === 1, 'FIX BRAND and the admin count follows')
  await post('brand_save', { id: BID, slug: 'sync-test-brand', name_en: 'Sync Test Brand Two', name_ar: 'علامة اختبار ٢' })

  // off / on / in use
  await post('brand_active', { id: BID, active: false })
  const hid = await pub(SLUG)
  is(!(await api('brands')).body.some((b) => b.slug === 'sync-test-brand') && !hid.brand_name_en && hid.brand_has_logo === 0, 'BRAND switched off: gone from the list and from its products, the products stay')
  await post('brand_active', { id: BID, active: true })
  is((await pub(SLUG)).brand_name_en === 'Sync Test Brand Two', 'BRAND switched on: back at once')
  const inUse = await post('brand_delete', { id: BID })
  is(inUse.status === 409 && inUse.body?.error === 'brand_in_use', 'BRAND in use cannot be deleted', `${inUse.status}`)
  await post('brand_assign', { brand_slug: '', products: [SLUG] })
  is((await post('brand_delete', { id: BID })).body?.deleted === true, 'BRAND untagged, it can be deleted')
}

// ======================================================= discounts and what is charged
{
  const quote = (code = '', items = [{ slug: SLUG, qty: 2, size: 'M' }]) => api('discount', { method: 'POST', body: JSON.stringify({ code, items }) })
  const base = (await quote()).body
  is(base.subtotal === 20 && base.discount === 0 && base.delivery === 1 && base.total === 21, 'QUOTE no rule: 2 x 10.000 + 1.000 delivery', JSON.stringify(base))

  // FIX: a category typed in another case
  const rule = await post('discount_save', { kind: 'auto', label: 'sync-test auto', type: 'percent', value: 10, category: 'Men', active: true })
  is(rule.status === 200 && rule.body?.category === 'men', 'FIX DISCOUNT a rule aimed at "Men" is stored against "men", the spelling the products carry', `${rule.status} ${rule.body?.category} ${rule.body?.error ?? ''}`)
  const RID = rule.body.id
  const withRule = (await quote()).body
  is(withRule.discount === 2 && withRule.total === 19 && withRule.applied?.[0]?.label === 'sync-test auto', 'DISCOUNT the automatic rule is in the quote: 10% of 20.000 = 2.000, total 19.000', JSON.stringify(withRule))
  const ghost = await post('discount_save', { kind: 'auto', label: 'sync-test ghost', type: 'percent', value: 10, category: 'no-such-category', active: true })
  is(ghost.status === 400 && ghost.body?.error === 'unknown_category', 'FIX DISCOUNT a category no product carries is refused (it would show as live and apply to nothing)', `${ghost.status} ${ghost.body?.error}`)

  // quote === charge: the same cart, placed as a cash order
  const placed = await api('order', { method: 'POST', body: JSON.stringify({ track_id: 'SPSYNC0002', items: [{ slug: SLUG, qty: 2, size: 'M' }], customer: CUSTOMER, payment_method: 'cod' }) })
  is(placed.status === 200 && placed.body?.amount === withRule.total, 'CHARGE the order amount is the quoted total to the fil', `${placed.status} order ${placed.body?.amount} vs quote ${withRule.total} ${placed.body?.error ?? ''}`)
  is((await stockOf(SLUG)).find((r) => r.size === 'M')?.stock === 3, 'STOCK the public count dropped by the quantity ordered (5 -> 3), no stale number')

  // switched off / typed code / min order / window
  await post('discount_active', { id: RID, active: false })
  is((await quote()).body.discount === 0, 'DISCOUNT switched off in the admin: gone from the quote at once')
  await post('discount_active', { id: RID, active: true })
  await post('discount_save', { id: RID, kind: 'auto', label: 'sync-test auto', type: 'percent', value: 10, category: 'men', active: true, min_order: 50 })
  is((await quote()).body.discount === 0, 'DISCOUNT a minimum order of 50.000 holds a 20.000 cart back')
  await post('discount_save', { id: RID, kind: 'auto', label: 'sync-test auto', type: 'percent', value: 10, category: 'men', active: true, starts_at: utc(3600e3) })
  is((await quote()).body.discount === 0 && (await admin('discounts')).body.find((d) => d.id === RID).live === false, 'DISCOUNT not started: not in the quote, and the admin list says not live')
  await post('discount_delete', { id: RID })
  const code = await post('discount_save', { kind: 'code', code: 'sync-test 5', label: 'sync-test code', type: 'fixed', value: 5, active: true })
  is(code.body?.code === 'SYNCTEST5', 'DISCOUNT a typed code is saved upper-case, letters and digits only', code.body?.code)
  const typed = (await quote('synctest5')).body
  is(typed.discount === 5 && typed.total === 16, 'DISCOUNT the customer may type it in any case: 5.000 off', JSON.stringify(typed))
  const unknown = await quote('NOPE999')
  is(unknown.status === 400 && unknown.body?.error === 'discount_unknown', 'DISCOUNT an unknown code is named, not ignored', unknown.body?.error)
  await post('discount_delete', { id: code.body.id })
}

// ================================================== home: slides, promo bar, hero
{
  const s = await post('slide_save', { image: PX, width: 1, height: 1, title_en: 'sync-test slide', title_ar: 'شريحة', subtitle_en: 'Sub', subtitle_ar: 'فرعي', cta_label_en: 'Shop', cta_label_ar: 'تسوق', cta_href: '/shop?cat=men', active: true, sort: 900, focal_x: 20, focal_y: 80 })
  is(s.status === 200 && s.body?.id > 0, 'SLIDE created through the admin', `${s.status} ${s.body?.error ?? ''}`)
  const SID = s.body.id
  let slides = (await api('slides')).body
  const mine = slides.slides.find((x) => x.id === SID)
  is(mine?.title_en === 'sync-test slide' && mine?.title_ar === 'شريحة' && mine?.cta_label_ar === 'تسوق' && mine?.cta_href === '/shop?cat=men' && mine?.focal_x === 20 && mine?.focal_y === 80,
     'SLIDE both languages, button and focal point reach the public answer', JSON.stringify(mine))
  const img = await fetch(`${BASE}/${mine.image}`)
  is(img.status === 200 && /image\/png/.test(img.headers.get('content-type') ?? ''), 'SLIDE its picture is served from the hashed URL it carries', `${img.status}`)
  await post('slide_save', { id: SID, title_en: 'sync-test slide', active: false, sort: 900 })
  is(!(await api('slides')).body.slides.some((x) => x.id === SID), 'SLIDE switched off: gone from the home page at once')
  await post('slide_save', { id: SID, title_en: 'sync-test slide', active: true, sort: -5 })
  is((await api('slides')).body.slides[0]?.id === SID, 'SLIDE sort order decides the first slide')
  await post('slide_delete', { id: SID })
  is(!(await api('slides')).body.slides.some((x) => x.id === SID), 'SLIDE deleted: gone')

  await post('settings_save', { name: 'hero', value: { speed_ms: 9000, size: 'full', autoplay: false, shuffle: true } })
  is(JSON.stringify((await api('slides')).body.hero) === JSON.stringify({ speed_ms: 9000, shuffle: true, size: 'full', autoplay: false }), 'HERO speed, size, shuffle and autoplay reach the public answer', JSON.stringify((await api('slides')).body.hero))
  await post('settings_save', { name: 'hero', value: { speed_ms: 6500, size: 'tall', autoplay: true, shuffle: false } })

  const bar = (v) => post('settings_save', { name: 'promo_bar', value: { text_en: 'Free delivery', text_ar: 'توصيل مجاني', tone: 'ink', alignment: 'start', show_dot: false, href: '/shop', enabled: true, ...v } })
  await bar({})
  let b = (await api('slides')).body.promo_bar
  is(b.live === true && b.text_en === 'Free delivery' && b.text_ar === 'توصيل مجاني' && b.tone === 'ink' && b.alignment === 'start' && b.show_dot === false && b.href === '/shop',
     'PROMO BAR text in both languages, tone, alignment, dot and link reach the public answer; live now', JSON.stringify(b))
  is(!('starts_at' in b) && !('ends_at' in b), 'PROMO BAR the schedule is resolved on the server (live), never sent')
  await bar({ starts_at: utc(3600e3) }); b = (await api('slides')).body.promo_bar
  is(b.enabled === true && b.live === false, 'PROMO BAR scheduled for later: enabled but not live', `${b.enabled}/${b.live}`)
  await bar({ starts_at: utc(-7200e3), ends_at: utc(-3600e3) }); b = (await api('slides')).body.promo_bar
  is(b.live === false, 'PROMO BAR past its end: not live', `${b.live}`)
  await bar({ enabled: false }); b = (await api('slides')).body.promo_bar
  is(b.live === false && b.enabled === false, 'PROMO BAR switched off: not live')
  const noText = await bar({ text_ar: '' })
  is(noText.body?.error === 'topbar_text_required', 'PROMO BAR on with one language empty is refused (no half-empty bar)', noText.body?.error)
  await post('settings_save', { name: 'promo_bar', value: { enabled: false, text_en: '', text_ar: '' } })
}

// ============================================ checkout, theme, content, returns
{
  const save = (v) => post('settings_save', { name: 'checkout', value: { delivery_fee: 1, knet: true, cod: true, default_method: 'knet', notice_en: '', notice_ar: '', ...v } })
  await save({ delivery_fee: 2.5, cod: false, notice_en: 'Kuwait only', notice_ar: 'داخل الكويت فقط' })
  const c = (await api('checkout_config')).body
  is(c.delivery_fee === 2.5 && c.notice_en === 'Kuwait only' && c.notice_ar === 'داخل الكويت فقط' && !c.methods.includes('cod'),
     'CHECKOUT delivery fee (KWD), both notices and the cash switch reach the public answer', JSON.stringify(c))
  is((await quoteDelivery()) === 2.5, 'CHECKOUT the fee in the price quote is the same 2.500 the checkout shows')
  const none = await post('settings_save', { name: 'checkout', value: { delivery_fee: 1, knet: false, cod: false, tpay: true } })
  is(none.body?.error === 'payment_method_required', 'CHECKOUT switching off every method (T-Pay is not a shopper method) is refused', none.body?.error)
  await save({ cod: true, knet: false, default_method: 'knet' })
  const only = (await api('checkout_config')).body
  is(only.methods.join() === 'cod' && only.default_method === 'cod', 'CHECKOUT with card off, cash is the only and the default method', JSON.stringify(only))
  await save({})
  is(!(await api('checkout_config')).body.methods.includes('tpay'), 'CHECKOUT T-Pay never appears as a shopper method')
  const fee = await save({ delivery_fee: 101 })
  is(fee.body?.error === 'invalid_delivery_fee', 'CHECKOUT a delivery fee over 100 is refused', fee.body?.error)

  const th = await post('settings_save', { name: 'theme', value: { brand: '#112233', accent: '#445566', canvas: '#fafafa', radius: '24', dark: true } })
  const t = (await api('theme')).body
  is(th.status === 200 && t.brand === '#112233' && t.accent === '#445566' && t.canvas === '#fafafa' && t.radius === '24' && t.dark === true && t.fonts?.body_en,
     'THEME colours, radius, dark switch and the four font choices reach the public answer', JSON.stringify(t))
  await post('settings_save', { name: 'theme', value: { brand: '#c76a42', accent: '#99452b', canvas: '#ffffff', radius: '16', dark: false } })

  const sc = await post('content_save', { overrides: [{ page: '/about', lang: 'ar', match: 'نص قديم', text: 'نص جديد' }], contact: { phone: '+965 2209 1914', email: 'hello@sporta.com.kw', instagram: '@sporta_kw', address_en: 'Kuwait City' } })
  const cc = (await api('content')).body
  is(sc.status === 200 && cc.overrides.length === 1 && cc.contact.phone === '+96522091914' && cc.contact.instagram === 'https://www.instagram.com/sporta_kw' && cc.contact.address_en === 'Kuwait City',
     'CONTENT overrides and contact values reach the public answer, normalised (phone digits, social link rebuilt)', JSON.stringify(cc.contact))
  await post('content_save', { overrides: [], contact: {} })
  is((await api('content')).body.overrides.length === 0, 'CONTENT cleared in the admin: empty on the public answer')

  const rp = await post('returns_policy_save', { window_days: 30, allow_return: true, allow_exchange: false, intro_en: 'Hello', intro_ar: 'مرحبا', points_en: ['One'], points_ar: ['واحد'] })
  const rr = (await api('content')).body.returns
  is(rp.status === 200 && rr.window_days === 30 && rr.allow_exchange === false && rr.intro_ar === 'مرحبا' && rr.points_en[0] === 'One', 'RETURNS window, both switches and the wording reach the public answer', JSON.stringify(rr))
  await post('returns_policy_save', { window_days: 14, allow_return: true, allow_exchange: true, intro_en: '', intro_ar: '', points_en: [], points_ar: [] })
}
async function quoteDelivery() {
  const r = await api('discount', { method: 'POST', body: JSON.stringify({ code: '', items: [{ slug: SLUG, qty: 1, size: 'M' }] }) })
  return r.body?.delivery
}

// =============================================================== caching
{
  // Every public JSON answer is "no-store" at Apache (api/.htaccess); the only cacheable answers are the
  // hashed images. Nothing in api.php may widen that for a settings route.
  const htaccess = readFileSync(join(ROOT, 'dropin/php-store/.htaccess'), 'utf8')
  is(/Header set Cache-Control "no-store"/.test(htaccess), 'CACHE api/.htaccess marks every answer no-store')
  const apiSrc = readFileSync(join(ROOT, 'dropin/php-store/api.php'), 'utf8')
  const publicCache = [...apiSrc.matchAll(/header\('Cache-Control: public[^']*'\)/g)].length
  is(publicCache === 2, 'CACHE only the two hashed-image routes (slide_image, brand_logo) send a public cache header', `${publicCache}`)
  const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')
  is(/url\.origin !== location\.origin/.test(sw) && !/\/api\//.test(sw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
     'CACHE the service worker has no rule for /api (network first, so a saved change is never hidden behind a stored answer)')
}

await cleanup()
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
