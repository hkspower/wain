import { PRODUCTS } from '../lib/products'
import { phpAdmin, phpBase } from '../lib/backend'

export const PAYMENT_STATES = ['paid', 'pending', 'review', 'failed']
export const FULFILMENT_STATES = ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']

// Every admin screen talks to /api/admin.php through this one call, so the
// answers that are NOT data get turned into flags here instead of being
// re-decided screen by screen:
//
//   needsMigration  the SQL has not been imported yet. Told apart from a real
//                   outage on purpose — the fix is "run schema.mysql.sql in
//                   phpMyAdmin", and a screen that just says "failed" sends
//                   the owner looking for a broken server instead.
//   signedOut       the session expired. `error` says so, in words, so every
//                   screen that shows errors shows this one too; a write
//                   carries it back to its caller and is never reported saved.
//   error           anything else, as a sentence a person can act on. The
//                   server's own token is kept in `token` for the screens'
//                   matching below and is never shown.
//
// A thrown fetch (server down, no network) must not blank the dashboard
// either, so it comes back as an ordinary error too. A 2xx whose body is not a
// JSON object (a PHP warning printed before the JSON, a host page) is an error
// as well: read as data it became an empty list, and read as a save it closed
// the dialog as saved.
//
// Every sentence here is in both languages. A sentence is chosen when it is
// needed, not at load, so it follows the language the operator is working in:
// LanguageContext keeps <html lang> in step with it (lib/backend.js reads it
// the same way). Arabic is the default.
const isArabic = () => typeof document !== 'undefined' && !!document.documentElement.lang?.startsWith('ar')
const say = (en, ar) => (isArabic() ? ar : en)

const NETWORK_ERROR = () => say(
  'Cannot reach the server. Check that the site is up, then retry.',
  'تعذّر الوصول إلى الخادم. تحقّق من أن الموقع يعمل، ثم أعد المحاولة.',
)
const SIGNED_OUT = () => say(
  'Your admin session has ended. Reload this page and sign in again.',
  'انتهت جلسة الإدارة. أعد تحميل الصفحة وسجّل الدخول من جديد.',
)
const UNREADABLE = () => say(
  'The server answered with something unreadable. Reload and try again; if it keeps happening, check the site.',
  'ردّ الخادم بشيء لا يمكن قراءته. أعد التحميل وحاول مرة أخرى، وإن تكرر ذلك فتحقّق من الموقع.',
)
const SERVER_ERROR = () => say(
  'The server could not complete this. Try again; if it keeps happening, check the site.',
  'تعذّر على الخادم إتمام هذا الإجراء. حاول مرة أخرى، وإن تكرر ذلك فتحقّق من الموقع.',
)

async function php(route, opts) {
  let res
  try {
    res = await phpAdmin(route, opts)
  } catch {
    return { error: NETWORK_ERROR() }
  }
  const { status, data } = res
  if (status === 401 || status === 403) return { signedOut: true, error: SIGNED_OUT() }
  if (status >= 200 && status < 300 && !data?.error) {
    if (data === null || typeof data !== 'object') return { error: UNREADABLE() }
    return { data }
  }

  const token = String(data?.error ?? `http_${status}`)
  // MySQL 1146: "Table 'sporta.orders' doesn't exist" — the schema import was
  // skipped. store.php reports it as this token rather than a bare 500.
  if (token === 'no_table' || token === 'missing_table' || /doesn'?t exist/i.test(token)) {
    return { needsMigration: true }
  }
  return { error: SERVER_ERROR(), token }
}

// AHED purchase cost in KWD per SKU, and the dirham rate. The server holds the table; the storefront never has it.
export async function fetchAhedCost() {
  const r = await php('ahed_cost')
  return r.data ? r.data : r
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

// The one shape of "sold out" the server names: out_of_stock_<slug>_<size>_<left>.
const SOLD_OUT = /^out_of_stock_(.+)_([^_]+)_(\d+)$/

export async function setFulfilment(orderId, status) {
  const r = await php('fulfilment', { method: 'POST', body: { order_id: orderId, status } })
  if (r.data) return {}
  // Putting a cancelled order back claims its garments again (store.php
  // store_order_reinstate). When a size has sold out since, the server names it
  // as out_of_stock_<slug>_<size>_<left>; say so in words the operator can act on.
  const m = r.token ?? ''
  const oos = m.match(SOLD_OUT)
  if (oos) return { error: say(
    `That size is sold out (${oos[2]}, ${oos[3]} left). Restock it, then put the order back.`,
    `نفد هذا المقاس (${oos[2]}، المتبقي ${oos[3]}). أعد تخزينه، ثم أعد الطلب إلى وضعه السابق.`,
  ) }
  if (m.includes('discount_used_up')) return { error: say(
    'The discount code on this order has no uses left, so it cannot be put back as it was.',
    'كود الخصم على هذا الطلب لم يعد له أي استخدام متبقٍّ، لذلك لا يمكن إعادته كما كان.',
  ) }
  // A delivered or shipped order is with the customer; a cancel would tell the
  // warehouse a parcel that has left is not to ship. Returns settles those.
  if (m.includes('order_already_shipped')) return { error: say(
    'This order has already left the shop, so it cannot be cancelled. Handle it through Returns.',
    'غادر هذا الطلب المتجر بالفعل، لذلك لا يمكن إلغاؤه. عالجه من خلال قسم المرتجعات.',
  ) }
  // A paid order keeps its garment claimed; cancelling it here would hold that
  // garment for ever. The refund and the return are handled by hand.
  if (m.includes('order_paid')) return { error: say(
    'This order is paid, so it cannot be cancelled here. Refund it and handle it through Returns.',
    'هذا الطلب مدفوع، لذلك لا يمكن إلغاؤه من هنا. استرجع المبلغ وعالجه من خلال قسم المرتجعات.',
  ) }
  // A cash order past its hold is cancelled again by the sweeper if it goes
  // back as unfulfilled. Packed keeps it.
  if (m.includes('cod_hold_expired')) return { error: say(
    'This cash order is past its hold, so it cannot go back as unfulfilled: the sweeper would cancel it again. Mark it packed instead.',
    'انتهت مهلة حجز هذا الطلب النقدي، لذلك لا يمكن إعادته إلى "غير منفّذ"، لأن المنظّف سيلغيه من جديد. ضع عليه علامة "مُعبّأ" بدلاً من ذلك.',
  ) }
  // A card order the bank has not confirmed cannot leave the shop: admin.php
  // refuses it until the payment is recorded on the order.
  if (m.includes('payment_required_before_dispatch')) return { error: say(
    'This card order is not paid yet, so it cannot be marked shipped or delivered. Record the payment on the order first, with the payment ID from the KNET portal.',
    'طلب البطاقة هذا غير مدفوع بعد، لذلك لا يمكن تعليمه مشحوناً أو مُسلَّماً. سجّل الدفعة على الطلب أولاً، بمعرّف الدفع من بوابة KNET.',
  ) }
  // A payment refunded or voided is closed: putting the order back would ship
  // goods the customer has been paid back for.
  if (m.includes('order_refunded')) return { error: say(
    'This payment was refunded or voided, so the order cannot be put back. It stays cancelled.',
    'استُرجعت هذه الدفعة أو أُلغيت، لذلك لا يمكن إعادة هذا الطلب. سيبقى ملغى.',
  ) }
  return r
}

// Settle (or un-settle) a cash-on-delivery order — the one narrow path that
// may touch payment_status, and it refuses any order that is not 'cod'. A CARD
// is confirmed by the bank's callback and never by a person with an admin
// session; settleCard() below is the audited exception, for a payment the bank
// took but never reported.
export async function setCodPaid(orderId, paid = true) {
  const r = await php('cod_paid', { method: 'POST', body: { order_id: orderId, paid } })
  if (r.data) return { order: r.data }
  const m = r.token ?? ''
  if (m.includes('not_a_cash_order')) return { error: say(
    'That is not a cash order — card payments are confirmed by the bank, not here.',
    'هذا ليس طلباً نقدياً. مدفوعات البطاقة يؤكدها البنك، وليس من هذه الشاشة.',
  ) }
  if (m.includes('order_not_pending')) return { error: say(
    'Only a pending cash order can be marked paid.',
    'لا يمكن تعليم إلا طلب نقدي قيد الانتظار بأنه مدفوع.',
  ) }
  if (m.includes('order_not_paid')) return { error: say(
    'That order is not marked paid.',
    'هذا الطلب غير مُعلَّم كمدفوع.',
  ) }
  if (m.includes('order_not_found')) return { error: say(
    'Order not found — refresh the list.',
    'الطلب غير موجود. حدّث القائمة.',
  ) }
  // A cancelled order holds no garment, so it cannot be paid for as a sale.
  if (m.includes('order_cancelled')) return { error: say(
    'This order is cancelled, so it cannot be marked paid. Put it back on first.',
    'هذا الطلب ملغى، لذلك لا يمكن تعليمه مدفوعاً. أعده إلى النشط أولاً.',
  ) }
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
  const m = r.token ?? ''
  if (m.includes('bank_reference_required')) {
    return { error: say(
      'Enter the payment ID exactly as the KNET portal shows it (at least 6 characters).',
      'أدخل معرّف الدفع كما يظهر في بوابة KNET تماماً (6 أحرف على الأقل).',
    ) }
  }
  if (m.includes('not_a_card_order')) return { error: say(
    'That is a cash order — use "Cash collected" instead.',
    'هذا طلب نقدي. استخدم "Cash collected" بدلاً من ذلك.',
  ) }
  if (m.includes('order_already_paid')) return { error: say(
    'That order is already paid.',
    'هذا الطلب مدفوع بالفعل.',
  ) }
  if (m.includes('order_not_found')) return { error: say(
    'Order not found — refresh the list.',
    'الطلب غير موجود. حدّث القائمة.',
  ) }
  // Cancelled by hand or by the sweeper: put it back first, then settle it.
  if (m.includes('order_cancelled')) return { error: say(
    'This order is cancelled, so the payment cannot be recorded here. Put the order back on first, then settle it.',
    'هذا الطلب ملغى، لذلك لا يمكن تسجيل الدفعة هنا. أعد الطلب إلى النشط أولاً، ثم سجّل الدفعة.',
  ) }
  // A payment the owner refunded or voided is closed: settling it here would
  // put it back in revenue and mail "ship it".
  if (m.includes('order_refunded')) return { error: say(
    'This payment was refunded or voided, so it cannot be recorded as paid.',
    'استُرجعت هذه الدفعة أو أُلغيت، لذلك لا يمكن تسجيلها كمدفوعة.',
  ) }
  // The sweeper put the garment back while the order sat unpaid, and the size
  // has sold out since: nothing is marked paid against an empty shelf.
  const oos = m.match(SOLD_OUT)
  if (oos) return { error: say(
    `That size has sold out since the order was placed (${oos[2]}, ${oos[3]} left), so the order cannot be marked paid. Refund the payment at the bank, or restock the size and try again.`,
    `نفد هذا المقاس بعد إنشاء الطلب (${oos[2]}، المتبقي ${oos[3]})، لذلك لا يمكن تعليم الطلب كمدفوع. استرجع المبلغ من البنك، أو أعد تخزين المقاس وحاول مرة أخرى.`,
  ) }
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
  return r.data ? { brand: r.data } : { ...r, error: brandError(r.token) || r.error }
}

export async function setBrandActive(id, active) {
  const r = await php('brand_active', { method: 'POST', body: { id, active } })
  return r.data ? { brand: r.data } : { ...r, error: brandError(r.token) || r.error }
}

// Remove a brand. The server refuses (brand_in_use) while any product still
// uses it; hiding is the way to take a brand out of the shop in that case.
export async function deleteBrand(id) {
  const r = await php('brand_delete', { method: 'POST', body: { id } })
  return r.data ? { deleted: true } : { ...r, error: brandError(r.token) || r.error }
}

// The route's machine tokens, turned into something an operator can act on.
// A token not listed here returns '' and the caller keeps the generic sentence
// from php(); the raw token is never shown.
function brandError(m = '') {
  const s = String(m)
  if (s.includes('brand_in_use')) {
    return say(
      'Products still use this brand. Move or remove them first, or hide the brand instead.',
      'ما زالت منتجات تستخدم هذه العلامة. انقلها أو احذفها أولاً، أو أخفِ العلامة بدلاً من ذلك.',
    )
  }
  if (s.includes('brand_not_found')) {
    return say(
      'That brand no longer exists. Refresh the list.',
      'هذه العلامة لم تعد موجودة. حدّث القائمة.',
    )
  }
  if (s.includes('logo_too_large') || s.includes('brands_logo_ck')) {
    return say(
      'That logo is too large or not a PNG/JPEG/WebP. Try a smaller image.',
      'هذا الشعار كبير جداً أو ليس بصيغة PNG أو JPEG أو WebP. جرّب صورة أصغر.',
    )
  }
  if (s.includes('logo_bad_format') || s.includes('logo_not_an_image')) {
    return say(
      'That file is not a real PNG, JPEG or WebP image.',
      'هذا الملف ليس صورة PNG أو JPEG أو WebP حقيقية.',
    )
  }
  if (s.includes('slug_taken') || s.includes('duplicate') || s.includes('23505')) {
    return say(
      'Another brand already uses that web name.',
      'توجد علامة أخرى تستخدم اسم الموقع هذا.',
    )
  }
  if (s.includes('missing_name_en') || s.includes('missing_name_ar')) {
    return say(
      'Both the English and Arabic names are required.',
      'الاسمان بالإنجليزية وبالعربية مطلوبان معاً.',
    )
  }
  if (s.includes('invalid_slug') || s.includes('brands_slug_ck')) {
    return say(
      'The web name may only contain letters, numbers and dashes.',
      'اسم الموقع لا يقبل إلا الحروف الإنجليزية والأرقام والشرطة (-).',
    )
  }
  // products.brand_slug holds 64 characters at most, so a longer brand web name
  // cannot be put on the products that carry the brand (admin.php refuses it).
  if (s.includes('brand_slug_too_long')) {
    return say(
      'That web name is too long for the products that use this brand. Use a shorter one.',
      'اسم الموقع هذا طويل جداً على المنتجات التي تستخدم هذه العلامة. استخدم اسماً أقصر.',
    )
  }
  return ''
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
// never duplicates. It only ever INSERTS (see syncCatalog).
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
  // A 2xx object that is not a list would throw on .map below. Report it as an
  // unreadable answer instead, so the screen shows an error rather than hanging.
  if (!Array.isArray(r.data)) return { error: UNREADABLE(), rows: [] }
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

// Insert-only. The server's sync upserts every row it is sent: it overwrites the
// name, description, category and price with the shipped copy, and it sets
// active from the row (a row without active is switched OFF). So a product the
// owner edited or took off sale must never be in the payload. Only slugs the
// database does not hold yet are sent; an existing product's price, name or
// status is changed in Products, not here.
export async function syncCatalog() {
  const state = await php('products_state')
  if (!state.data) return state
  const held = new Set(state.data.map((x) => x.slug))
  const rows = catalogRows().filter((row) => !held.has(row.slug))
  if (!rows.length) return { count: 0 }
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
    let s = v == null ? '' : String(v)
    // A spreadsheet runs a cell that starts with = + - @ (or a tab or CR) as a
    // formula. Shoppers type the name, area, street, building and note, so a
    // leading apostrophe makes such a cell plain text, and the value is otherwise
    // unchanged.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
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
  const m = r.token ?? ''
  if (m.includes('slug_taken')) return { error: say(
    'Another product already uses that web name.',
    'يوجد منتج آخر يستخدم اسم الموقع هذا.',
  ) }
  if (m.includes('invalid_price')) return { error: say(
    'Enter a price greater than zero.',
    'أدخل سعراً أكبر من صفر.',
  ) }
  if (m.includes('invalid_slug')) return { error: say(
    'The web name may only contain letters, numbers and dashes.',
    'اسم الموقع لا يقبل إلا الحروف الإنجليزية والأرقام والشرطة (-).',
  ) }
  if (m.includes('missing_name')) return { error: say(
    'Both the English and Arabic names are required.',
    'الاسمان بالإنجليزية وبالعربية مطلوبان معاً.',
  ) }
  // The server compares the sale with the price it stores, so a sale at or
  // above the price is refused rather than saved and ignored.
  if (m.includes('sale_not_lower')) return { error: say(
    'The sale price must be lower than the price. Leave the sale price empty to take the product off sale.',
    'يجب أن يكون سعر التخفيض أقل من السعر. اترك حقل سعر التخفيض فارغاً لإيقاف التخفيض.',
  ) }
  if (m.includes('sale_dates_backwards')) return { error: say(
    'The sale ends before it starts. Check the sale start and end dates.',
    'تاريخ انتهاء التخفيض قبل تاريخ بدايته. تحقّق من تاريخي بداية التخفيض ونهايته.',
  ) }
  if (m.includes('unknown_brand')) return { error: say(
    'That brand is not in the Brands list. Pick one from the list, or leave the brand empty.',
    'هذه العلامة غير موجودة في قائمة العلامات. اختر علامة من القائمة، أو اترك حقل العلامة فارغاً.',
  ) }
  if (m.includes('brand_slug_too_long')) return { error: say(
    "The brand's web name is too long to put on a product. Shorten it under Brands.",
    'اسم الموقع لهذه العلامة طويل جداً ليُوضع على المنتج. اختصره من قسم العلامات.',
  ) }
  // Photos are paths on this site (store.php): a link to another host is refused.
  if (m.includes('invalid_link')) return { error: say(
    'A photo link must be a path on this site, like /photos/jacket.jpg. Links to other sites are not allowed.',
    'رابط الصورة يجب أن يكون مساراً على هذا الموقع، مثل /photos/jacket.jpg. الروابط إلى مواقع أخرى غير مسموحة.',
  ) }
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
  const m = r.token ?? ''
  if (m.includes('stock_cannot_be_negative') || m.includes('stock_out_of_range')) return { error: say(
    'Stock must be between 0 and 999,999.',
    'يجب أن يكون المخزون بين 0 و999,999.',
  ) }
  if (m.includes('stock_must_be_whole_number')) return { error: say(
    'Stock must be a whole number.',
    'يجب أن يكون المخزون رقماً صحيحاً.',
  ) }
  if (m.includes('sku_not_found')) return { error: say(
    'That item code is not in the inventory — refresh.',
    'رمز هذا الصنف غير موجود في المخزون. حدّث الصفحة.',
  ) }
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
  const m = r.token ?? ''
  if (m.includes('image_required')) return { error: say(
    'A slide needs a photograph.',
    'الشريحة تحتاج إلى صورة.',
  ) }
  if (m.includes('logo_too_large')) return { error: say(
    'That image is too large even after downscaling. Try a smaller one.',
    'هذه الصورة كبيرة جداً حتى بعد تصغيرها. جرّب صورة أصغر.',
  ) }
  if (m.includes('logo_bad_format') || m.includes('logo_not_an_image')) {
    return { error: say(
      'That file is not a PNG, JPEG or WebP image. (SVG is refused — it can carry script.)',
      'هذا الملف ليس صورة PNG أو JPEG أو WebP. (صيغة SVG مرفوضة لأنها قد تحمل نصاً برمجياً.)',
    ) }
  }
  if (m.includes('invalid_link')) return { error: say(
    'The button link must be a path on this site, like /shop.',
    'رابط الزر يجب أن يكون مساراً على هذا الموقع، مثل /shop.',
  ) }
  return r
}

export const deleteSlide = (id) => php('slide_delete', { method: 'POST', body: { id } })
export const reorderSlides = (ids) => php('slide_reorder', { method: 'POST', body: { ids } })

export async function saveSettings(name, value) {
  const r = await php('settings_save', { method: 'POST', body: { name, value } })
  if (r.data) return { value: r.data }
  if ((r.token ?? '').includes('invalid_link')) {
    return { error: say(
      'The link must be a path on this site, like /shop.',
      'الرابط يجب أن يكون مساراً على هذا الموقع، مثل /shop.',
    ) }
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
  const m = r.token ?? ''
  if (m.includes('code_taken')) return { error: say(
    'Another discount already uses that code.',
    'يوجد خصم آخر يستخدم هذا الكود.',
  ) }
  if (m.includes('invalid_code')) return { error: say(
    'A code needs 3–24 letters or numbers.',
    'الكود يحتاج إلى ما بين 3 و24 حرفاً أو رقماً.',
  ) }
  if (m.includes('invalid_percent')) return { error: say(
    'A percentage must be between 1 and 90.',
    'النسبة المئوية يجب أن تكون بين 1 و90.',
  ) }
  if (m.includes('invalid_amount')) return { error: say(
    'Enter an amount greater than zero.',
    'أدخل مبلغاً أكبر من صفر.',
  ) }
  if (m.includes('sale_dates_backwards')) return { error: say(
    'The end date is before the start date.',
    'تاريخ الانتهاء قبل تاريخ البداية.',
  ) }
  if (m.includes('missing_label')) return { error: say(
    'Give it a name — the customer sees it at checkout.',
    'أعطِه اسماً، فالعميل يراه عند الدفع.',
  ) }
  if (m.includes('invalid_date')) return { error: say(
    'Check the dates.',
    'تحقّق من التواريخ.',
  ) }
  return r
}

export const setDiscountActive = (id, active) =>
  php('discount_active', { method: 'POST', body: { id, active } })

export async function deleteDiscount(id) {
  const r = await php('discount_delete', { method: 'POST', body: { id } })
  if ((r.token ?? '').includes('discount_in_use')) {
    return { error: say(
      'Orders were placed with this code, so it cannot be deleted. Switch it off instead.',
      'وُضعت طلبات بهذا الكود، لذلك لا يمكن حذفه. أوقفه بدلاً من ذلك.',
    ) }
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
