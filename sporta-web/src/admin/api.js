import { PRODUCTS } from '../lib/products'
import { phpAdmin, phpBase } from '../lib/backend'

export const PAYMENT_STATES = ['paid', 'pending', 'review', 'failed']
export const FULFILMENT_STATES = ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']

// Every admin screen talks to /api/admin.php through this one call, so the
// three answers that are NOT data get turned into flags here instead of being
// re-decided screen by screen:
//
//   needsMigration  the SQL has not been imported yet. Told apart from a real
//                   outage on purpose — the fix is "run schema.mysql.sql in
//                   phpMyAdmin", and a screen that just says "failed" sends
//                   the owner looking for a broken server instead.
//   signedOut       the session expired. AdminApp shows the login again.
//   error           anything else, as a sentence a person can act on.
//
// A thrown fetch (server down, no network) must not blank the dashboard
// either, so it comes back as an ordinary error too.
async function php(route, opts) {
  let res
  try {
    res = await phpAdmin(route, opts)
  } catch {
    return { error: 'Cannot reach the server. Check that the site is up, then retry.' }
  }
  const { status, data } = res
  if (status === 401 || status === 403) return { signedOut: true }
  if (status >= 200 && status < 300 && !data?.error) return { data }

  const token = data?.error ?? `http_${status}`
  // MySQL 1146: "Table 'sporta.orders' doesn't exist" — the schema import was
  // skipped. store.php reports it as this token rather than a bare 500.
  if (token === 'no_table' || token === 'missing_table' || /doesn'?t exist/i.test(token)) {
    return { needsMigration: true }
  }
  return { error: token }
}

export async function fetchStats() {
  const r = await php('stats')
  return r.data ? { stats: r.data } : r
}

export async function fetchRevenueDaily(days = 14) {
  const r = await php(`revenue&days=${days}`)
  return { ...r, series: r.data ?? [] }
}

export async function fetchOrders({ payment = 'all', fulfilment = 'all', search = '', limit = 100 } = {}) {
  const r = await php(
    `orders&payment=${payment}&fulfilment=${fulfilment}&search=${encodeURIComponent(search)}&limit=${limit}`,
  )
  return { ...r, orders: r.data ?? [] }
}

// Line items for one order, with the product names resolved.
export async function fetchOrderItems(orderId) {
  const r = await php(`items&order=${orderId}`)
  return { items: r.data ?? [], error: r.error }
}

export async function setFulfilment(orderId, status) {
  const r = await php('fulfilment', { method: 'POST', body: { order_id: orderId, status } })
  return r.data ? {} : r
}

// Settle (or un-settle) a cash-on-delivery order — the one narrow path that
// may touch payment_status, and it refuses any order that is not 'cod'. A CARD
// is confirmed by the bank's callback and never by a person with an admin
// session; settleCard() below is the audited exception, for a payment the bank
// took but never reported.
export async function setCodPaid(orderId, paid = true) {
  const r = await php('cod_paid', { method: 'POST', body: { order_id: orderId, paid } })
  if (r.data) return { order: r.data }
  const m = r.error ?? ''
  if (m.includes('not_a_cash_order')) return { error: 'That is not a cash order — card payments are confirmed by the bank, not here.' }
  if (m.includes('order_not_pending')) return { error: 'Only a pending cash order can be marked paid.' }
  if (m.includes('order_not_paid')) return { error: 'That order is not marked paid.' }
  if (m.includes('order_not_found')) return { error: 'Order not found — refresh the list.' }
  return r
}

// Settle a CARD order the bank took but never reported back — see the long
// note on the card_settled route in dropin/php-store/admin.php.
export async function settleCard(orderId, bankReference) {
  const r = await php('card_settled', {
    method: 'POST',
    body: { order_id: orderId, bank_reference: bankReference },
  })
  if (r.data) return { order: r.data }
  const m = r.error ?? ''
  if (m.includes('bank_reference_required')) {
    return { error: 'Enter the payment ID exactly as the KNET portal shows it (at least 6 characters).' }
  }
  if (m.includes('not_a_card_order')) return { error: 'That is a cash order — use "Cash collected" instead.' }
  if (m.includes('order_already_paid')) return { error: 'That order is already paid.' }
  if (m.includes('order_not_found')) return { error: 'Order not found — refresh the list.' }
  return r
}

// --------------------------------------------------------------------- brands
// The brands the shop carries: name, logo, and whether the storefront shows
// them. The logo is a capped data: URL held in the row — see the note in
// dropin/php-store/schema.mysql.sql for why it is never a file.

export async function fetchBrands() {
  const r = await php('brands')
  return r.data ? { brands: r.data } : r
}

export async function saveBrand(brand) {
  const r = await php('brand_save', { method: 'POST', body: brand })
  return r.data ? { brand: r.data } : { ...r, error: r.error && brandError(r.error) }
}

export async function setBrandActive(id, active) {
  const r = await php('brand_active', { method: 'POST', body: { id, active } })
  return r.data ? { brand: r.data } : { ...r, error: r.error && brandError(r.error) }
}

// The route's machine tokens, turned into something an operator can act on.
function brandError(m = '') {
  const s = String(m)
  if (s.includes('logo_too_large') || s.includes('brands_logo_ck')) {
    return 'That logo is too large or not a PNG/JPEG/WebP. Try a smaller image.'
  }
  if (s.includes('logo_bad_format') || s.includes('logo_not_an_image')) {
    return 'That file is not a real PNG, JPEG or WebP image.'
  }
  if (s.includes('slug_taken') || s.includes('duplicate') || s.includes('23505')) {
    return 'Another brand already uses that web name.'
  }
  if (s.includes('missing_name_en') || s.includes('missing_name_ar')) {
    return 'Both the English and Arabic names are required.'
  }
  if (s.includes('invalid_slug') || s.includes('brands_slug_ck')) {
    return 'The web name may only contain letters, numbers and dashes.'
  }
  return s || 'Could not save the brand.'
}

export const slugify = (s = '') =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export async function saveCustomer(orderId, fields) {
  const r = await php('customer', { method: 'POST', body: { order_id: orderId, fields } })
  return r.data ? {} : r
}

// ---------------------------------------------------------------------------
// Catalogue sync.
//
// Orders are priced from the products table, so an empty table means every
// checkout dies with "Order has no payable amount". This pushes the catalogue
// that ships with the front end into MySQL, matching on slug so re-running it
// updates rather than duplicating.
// ---------------------------------------------------------------------------
function catalogRows() {
  return PRODUCTS.map((p) => ({
    slug: p.slug,
    name_en: p.name.en,
    name_ar: p.name.ar,
    desc_en: p.desc?.en ?? null,
    desc_ar: p.desc?.ar ?? null,
    price: Number(p.price),
    category: p.category ?? null,
    // Placeholder art is a data: URI and far too long for a row; leave the
    // column empty so real photo URLs can be pasted in later.
    image: p.image?.startsWith('http') ? p.image : null,
    active: true,
  }))
}

export async function fetchCatalogState() {
  const r = await php('products_state')
  if (!r.data) return { ...r, rows: [] }
  const bySlug = new Map(r.data.map((x) => [x.slug, x]))
  const local = catalogRows()
  return {
    rows: local.map((row) => {
      const remote = bySlug.get(row.slug)
      return {
        slug: row.slug,
        name_en: row.name_en,
        price: row.price,
        state: !remote ? 'missing' : Number(remote.price) !== row.price ? 'differs' : 'ok',
        remotePrice: remote ? Number(remote.price) : null,
      }
    }),
    extra: r.data.filter((x) => !local.some((l) => l.slug === x.slug)).map((x) => x.slug),
  }
}

export async function syncCatalog() {
  const rows = catalogRows()
  const r = await php('sync', { method: 'POST', body: { rows } })
  return r.data ? { count: r.data.count } : r
}

// ---------------------------------------------------------------------------

export function toCsv(orders) {
  // Ordered so the sheet reads left to right as order → money → who → where,
  // which is how it gets handed to a courier.
  const cols = [
    // payment_method belongs next to the money: without it the courier sheet
    // cannot tell the driver which deliveries have cash to collect, which is
    // the one thing the driver has to know.
    'track_id', 'created_at', 'paid_at', 'amount', 'payment_status', 'payment_method',
    'fulfilment_status', 'customer_name', 'customer_phone',
    'customer_governorate', 'customer_area', 'customer_block', 'customer_street',
    'customer_building', 'customer_floor', 'customer_flat', 'customer_note',
    'cbk_paymentid', 'cbk_reference',
  ]
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...orders.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n')
}

// ---------------------------------------------------------------------------
// Inventory — AHED sizes and stock.
//
// This route returns cost_aed, what Sporta paid AHED per piece; the PUBLIC
// stock endpoint does not. The session is the line between them.
// ---------------------------------------------------------------------------
// The single-product editor, alongside the whole-catalogue sync above.
export async function fetchAllProducts() {
  const r = await php('products_all')
  return { ...r, rows: r.data ?? [] }
}

export async function saveProduct(product) {
  const r = await php('product_save', { method: 'POST', body: product })
  if (r.data) return { product: r.data }
  const m = r.error ?? ''
  if (m.includes('slug_taken')) return { error: 'Another product already uses that web name.' }
  if (m.includes('invalid_price')) return { error: 'Enter a price greater than zero.' }
  if (m.includes('invalid_slug')) return { error: 'The web name may only contain letters, numbers and dashes.' }
  if (m.includes('missing_name')) return { error: 'Both the English and Arabic names are required.' }
  return r
}

// On sale / off sale. Never a delete: order_items point at products, and a
// shop that deletes a sold product loses the line on every invoice that ever
// contained it.
export async function setProductActive(id, active) {
  const r = await php('product_active', { method: 'POST', body: { id, active } })
  return r.data ? { product: r.data } : r
}

export async function fetchVariants() {
  const r = await php('variants')
  return { ...r, rows: r.data ?? [] }
}

// Counting stock goes through an RPC, not an UPDATE, so the admin can only ever
// move the count — never the SKU it belongs to, the slug or the wholesale cost.
// Counting stock goes through its own route, not a table update, so the admin
// can only ever move the count — never the SKU it belongs to, the slug, or the
// wholesale cost.
export async function setStock(sku, stock) {
  const r = await php('set_stock', { method: 'POST', body: { sku, stock } })
  if (r.data) return { variant: r.data }
  const m = r.error ?? ''
  if (m.includes('stock_cannot_be_negative')) return { error: 'Stock cannot be negative.' }
  if (m.includes('sku_not_found')) return { error: 'That item code is not in the inventory — refresh.' }
  return r
}

// ---------------------------------------------------------------------------
// The home hero.
//
// The image never travels as a file. It is read in the browser, downscaled on
// a canvas and sent as a data: URL that lands in a database row — the same
// rule the brand logos follow, because an endpoint that writes into the web
// root is a way in, and this server once hosted exactly that.
//
// It comes BACK as a URL, though, not as base64: a hero photograph is two
// orders of magnitude bigger than a logo, and a list of them inlined into JSON
// would be a megabyte of uncacheable response on every load. api.php serves
// the bytes with a content hash and a one-year cache instead.
// ---------------------------------------------------------------------------
export async function fetchSlides() {
  const r = await php('slides')
  // Same relative-URL resolution the storefront does — admin.php cannot know
  // where the API is mounted, and this side has to render the thumbnails.
  const slides = (r.data?.slides ?? []).map((s) => ({
    ...s, image: s.image ? `${phpBase()}/${s.image}` : null,
  }))
  return { ...r, slides, hero: r.data?.hero ?? null }
}

export async function saveSlide(slide) {
  const r = await php('slide_save', { method: 'POST', body: slide })
  if (r.data) return { id: r.data.id }
  const m = r.error ?? ''
  if (m.includes('image_required')) return { error: 'A slide needs a photograph.' }
  if (m.includes('logo_too_large')) return { error: 'That image is too large even after downscaling. Try a smaller one.' }
  if (m.includes('logo_bad_format') || m.includes('logo_not_an_image')) {
    return { error: 'That file is not a PNG, JPEG or WebP image. (SVG is refused — it can carry script.)' }
  }
  if (m.includes('invalid_link')) return { error: 'The button link must be a path on this site, like /shop.' }
  return r
}

export const deleteSlide = (id) => php('slide_delete', { method: 'POST', body: { id } })
export const reorderSlides = (ids) => php('slide_reorder', { method: 'POST', body: { ids } })

export async function saveSettings(name, value) {
  const r = await php('settings_save', { method: 'POST', body: { name, value } })
  if (r.data) return { value: r.data }
  if ((r.error ?? '').includes('invalid_link')) {
    return { error: 'The link must be a path on this site, like /shop.' }
  }
  return r
}

// ---------------------------------------------------------------------------
// Discounts.
//
// Everything here is a rule the SERVER applies. The browser can name a code at
// checkout; it can never name an amount. That is the same rule that stops it
// naming a price, and it matters more here — a discount is a number the
// customer actively wants to be bigger.
// ---------------------------------------------------------------------------
export async function fetchDiscounts() {
  const r = await php('discounts')
  return { ...r, rows: r.data ?? [] }
}

export async function saveDiscount(d) {
  const r = await php('discount_save', { method: 'POST', body: d })
  if (r.data) return { discount: r.data }
  const m = r.error ?? ''
  if (m.includes('code_taken')) return { error: 'Another discount already uses that code.' }
  if (m.includes('invalid_code')) return { error: 'A code needs 3–24 letters or numbers.' }
  if (m.includes('invalid_percent')) return { error: 'A percentage must be between 1 and 90.' }
  if (m.includes('invalid_amount')) return { error: 'Enter an amount greater than zero.' }
  if (m.includes('sale_dates_backwards')) return { error: 'The end date is before the start date.' }
  if (m.includes('missing_label')) return { error: 'Give it a name — the customer sees it at checkout.' }
  if (m.includes('invalid_date')) return { error: 'Check the dates.' }
  return r
}

export const setDiscountActive = (id, active) =>
  php('discount_active', { method: 'POST', body: { id, active } })

export async function deleteDiscount(id) {
  const r = await php('discount_delete', { method: 'POST', body: { id } })
  if ((r.error ?? '').includes('discount_in_use')) {
    return { error: 'Orders were placed with this code, so it cannot be deleted. Switch it off instead.' }
  }
  return r
}

// ------------------------------------------------------- blocked customers
// The manual half of the cash-on-delivery defence. The automatic cap stops one
// number flooding the courier; this is where a number that already cost the
// shop three wasted trips gets recorded.
//
// 'cod' refuses cash on delivery and still lets them pay up front, which is the
// proportionate answer — a prepaid order costs the shop nothing. 'all' is for
// when the person, not the payment method, is the problem.
export const fetchBlocked = () => php('blocked')

export const blockCustomer = (phone, reason, scope = 'cod') =>
  php('block_customer', { method: 'POST', body: { phone, reason, scope } })

export const unblockCustomer = (phone) =>
  php('unblock_customer', { method: 'POST', body: { phone } })
