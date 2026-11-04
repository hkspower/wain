// A stand-in for the two admin routes of dropin/php-store/abandoned.php, in the shapes the contract documents
// (scratchpad CONTRACT.md; the backend suite scripts/abandoned-orders-test.mjs asserts the real key set). Used by
// scripts/abandoned-ui-test.mjs and scripts/abandoned-ui-live-check.mjs to drive the admin panel without a database.
//
// Everything here is synthetic: made-up names (a few chosen to be hostile to a spreadsheet or to markup), SPTEST track ids,
// 9655550xxxx phones. Nothing is a real customer.
//
// The rules of the real routes that the panel depends on are re-implemented here from the contract, on purpose small:
//   - GET abandoned_orders: reason (all = unpaid, expired, declined, cod_expired), from / to (inclusive, from <= to), q (track id,
//     name, phone by its digits), include_recovered, page (20 a page), unknown reason or bad value -> 400 invalid_filter (this is
//     also what the panel's one probe relies on), summary over from / to / q only, money in integer fils;
//   - POST abandoned_followup: order_id, state (4 + none), note <= 280 characters with control characters turned into spaces,
//     404 for an order that does not exist, 409 not_abandoned for one the list could not show, one row per order;
//   - both need the admin session cookie and the X-Sporta-Admin header (401 / 400), a write needs a JSON body.
export const ME = 'owner@sporta.test'
export const SESSION_COOKIE = 'sporta_admin'
const REASONS = ['unpaid', 'expired', 'declined', 'cod_expired']
const OTHER = ['waiting', 'cancelled']
const STATES = ['contacted', 'not_interested', 'wrong_number', 'recovered_manually']
export const PAGE_SIZE = 20

const NAMES = ['Sara Al-Ahmad', 'سارة الأحمد', 'Khalid Al-Mutairi', 'فهد العتيبي', 'Noor Hassan', 'ريم الصباح', 'Yousef Ali', 'Dana K.', 'Ahmad Salem']
// The newest orders (the first page, which is newest first) carry the names a spreadsheet or a page would choke on.
const HOSTILE = {
  44: '<img src=x onerror="window.__xss=1">', 43: '=HYPERLINK("http://evil.test","click")', 42: 'Mona "Mimi", Al-Sabah',
  41: '+965 trick', 40: '@admin', 39: '-5 dash',
}
const ITEMS = [
  { name_en: 'Cloudsoft Top - Navy', name_ar: 'توب كلاودسوفت - كحلي', size: 'L', fit: null },
  { name_en: 'Sculpt Leggings - Black', name_ar: 'ليقنز سكلبت - أسود', size: 'M', fit: 'Regular' },
  { name_en: 'Flash Shorts "Pro", Red', name_ar: 'شورت فلاش', size: 'S', fit: null },
  { name_en: 'Define Jacket - Steel Grey', name_ar: 'جاكيت ديفاين', size: 'XL', fit: null },
  { name_en: 'Denver Nuggets Cap', name_ar: 'قبعة', size: null, fit: null },
]

/** The dataset: 45 orders. Deterministic. */
export function makeOrders() {
  const seq = ['unpaid', 'expired', 'declined', 'cod_expired', 'unpaid', 'declined', 'waiting', 'cancelled', 'expired', 'unpaid']
  const mins = { unpaid: 45, expired: 190, declined: 70, cod_expired: 1700, waiting: 12, cancelled: 60 }
  const out = []
  for (let i = 0; i < 45; i++) {
    const reason = seq[i % seq.length]
    const id = 200 + i
    const ago = mins[reason] + i * 7
    const day = 4 - Math.floor(ago / 1440) - (i % 3 === 0 ? 0 : 0)
    const hh = String((23 - (i % 12))).padStart(2, '0'), mm = String((i * 7) % 60).padStart(2, '0')
    const nLines = i % 5 === 0 ? 0 : i === 43 ? 7 : 1 + (i % 3)
    const lines = Array.from({ length: nLines }, (_, k) => ({ ...ITEMS[(i + k) % ITEMS.length], qty: 1 + ((i + k) % 2) }))
    const historic = i === 41
    out.push({
      id, track_id: 'SPTEST' + String(1000 + i), created_at: `2026-11-${String(Math.max(1, day)).padStart(2, '0')} ${hh}:${mm}:07`, minutes_ago: ago,
      reason, abandoned: REASONS.includes(reason),
      payment_method: reason === 'cod_expired' ? 'cod' : i % 4 === 1 ? 'tpay' : 'knet',
      payment_status: reason === 'declined' ? 'failed' : 'pending',
      fulfilment_status: reason === 'cancelled' ? 'cancelled' : 'unfulfilled',
      amount: Math.round((5 + i * 1.25) * 1000) / 1000,
      item_count: lines.reduce((s, l) => s + l.qty, 0) + (i === 43 ? 4 : 0),
      items: lines.slice(0, 5), items_more: Math.max(0, lines.length - 5),
      customer_name: HOSTILE[i] || NAMES[i % 9],
      customer_phone: historic ? '+965 5522-2759' : '9655550' + String(1000 + i),
      whatsapp_phone: historic ? null : '9655550' + String(1000 + i),
      customer_governorate: ['hawalli', 'farwaniya', 'capital', 'ahmadi'][i % 4], customer_area: ['Salmiya', 'Jabriya', 'Mishref', 'Fahaheel', 'الروضة'][i % 5],
      customer_lang: i % 3 === 0 ? 'ar' : i % 3 === 1 ? 'en' : null,
      stock_released: reason === 'expired' || reason === 'cancelled' || (reason === 'declined' && i % 2 === 0),
      discount_released: reason === 'expired' && i % 2 === 0,
      laterOrder: (reason === 'unpaid' || reason === 'declined') && i % 7 === 3,   // a later paid order recovered it
      followup: null,
    })
  }
  // two follow-ups to start from: one contacted with a note, one marked recovered by hand
  // (on the newest orders, so they are on the first page)
  out[38].followup = { state: 'contacted', note: 'called, will pay tomorrow', by: ME, at: '2026-11-04 06:50:00' }
  const manual = [...out].reverse().find((o) => o.reason === 'unpaid' && !o.laterOrder && !o.followup && o.id < 244)
  manual.followup = { state: 'recovered_manually', note: 'paid by bank transfer', by: ME, at: '2026-11-04 06:55:00' }
  return out
}

const isRecovered = (o) => o.laterOrder || (o.followup && o.followup.state === 'recovered_manually')
const recoveredBy = (o) => (o.laterOrder ? 'order' : o.followup && o.followup.state === 'recovered_manually' ? 'manual' : null)
const fils = (v) => Math.round(Number(v) * 1000)

/** The row exactly as the route answers it (the complete key set of the contract). */
export function publicRow(o) {
  return {
    id: o.id, track_id: o.track_id, created_at: o.created_at, minutes_ago: o.minutes_ago, reason: o.reason, abandoned: o.abandoned,
    payment_method: o.payment_method, payment_status: o.payment_status, fulfilment_status: o.fulfilment_status, amount: o.amount,
    item_count: o.item_count, items: o.items, items_more: o.items_more, customer_name: o.customer_name, customer_phone: o.customer_phone,
    whatsapp_phone: o.whatsapp_phone, customer_governorate: o.customer_governorate, customer_area: o.customer_area, customer_lang: o.customer_lang,
    stock_released: o.stock_released, discount_released: o.discount_released, recovered: !!isRecovered(o), recovered_by: recoveredBy(o),
    followup: o.followup ? { state: o.followup.state, note: o.followup.note, by: o.followup.by, at: o.followup.at } : null,
  }
}

const digitsOf = (s) => String(s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D+/g, '')
function filters(q) {
  const get = (k, d) => (q.has(k) ? q.get(k) : d)
  const reason = get('reason', 'all')
  if (!['all', ...REASONS, ...OTHER].includes(reason)) return 'invalid_filter'
  const dates = {}
  for (const k of ['from', 'to']) {
    const v = get(k, '')
    if (v === '') { dates[k] = null; continue }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
    if (!m || +m[1] < 2000) return 'invalid_filter'
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return 'invalid_filter'
    dates[k] = v
  }
  if (dates.from && dates.to && dates.from > dates.to) return 'invalid_filter'
  const text = get('q', '')
  if (text.length > 80 || /[\u0000-\u001f\u007f]/.test(text)) return 'invalid_filter'
  const inc = get('include_recovered', '0')
  if (!['0', '1'].includes(inc)) return 'invalid_filter'
  const page = get('page', '1')
  if (!/^[1-9][0-9]{0,2}$/.test(page) || +page > 500) return 'invalid_filter'
  return { reason, from: dates.from, to: dates.to, q: text.trim(), rec: inc === '1', page: +page }
}
const matchText = (o, q) => {
  if (!q) return true
  const low = q.toLowerCase()
  if (o.track_id.toLowerCase().includes(low) || o.customer_name.toLowerCase().includes(low)) return true
  const dq = digitsOf(q)
  return dq.length >= 3 && digitsOf(o.customer_phone).includes(dq)
}
const inDates = (o, f) => (!f.from || o.created_at.slice(0, 10) >= f.from) && (!f.to || o.created_at.slice(0, 10) <= f.to)

export function summaryOf(all, f) {
  const rows = all.filter((o) => inDates(o, f) && matchText(o, f.q))
  const by = {}
  for (const r of REASONS) by[r] = { count: 0, f: 0, recovered_count: 0, rf: 0 }
  let waiting = { count: 0, f: 0 }, cancelled = { count: 0, f: 0 }
  for (const o of rows) {
    if (REASONS.includes(o.reason)) { const b = by[o.reason]; if (isRecovered(o)) { b.recovered_count++; b.rf += fils(o.amount) } else { b.count++; b.f += fils(o.amount) } }
    else if (o.reason === 'waiting') { waiting.count++; waiting.f += fils(o.amount) }
    else if (o.reason === 'cancelled') { cancelled.count++; cancelled.f += fils(o.amount) }
  }
  const sum = (k) => REASONS.reduce((s, r) => s + by[r][k], 0)
  const lost = sum('count'), rec = sum('recovered_count')
  return {
    abandoned: { count: lost, value: sum('f') / 1000, recovered_count: rec, recovered_value: sum('rf') / 1000, recovery_rate: lost + rec ? Math.round((rec / (lost + rec)) * 1000) / 10 : null },
    by_reason: Object.fromEntries(REASONS.map((r) => [r, { count: by[r].count, value: by[r].f / 1000, recovered_count: by[r].recovered_count, recovered_value: by[r].rf / 1000 }])),
    waiting: { count: waiting.count, value: waiting.f / 1000 }, cancelled_by_shop: { count: cancelled.count, value: cancelled.f / 1000 },
  }
}

export function listOf(all, f) {
  let rows = all.filter((o) => inDates(o, f) && matchText(o, f.q))
  if (f.reason === 'all') rows = rows.filter((o) => REASONS.includes(o.reason))
  else rows = rows.filter((o) => o.reason === f.reason)
  if (f.reason !== 'waiting' && f.reason !== 'cancelled' && !f.rec) rows = rows.filter((o) => !isRecovered(o))
  rows = rows.slice().sort((a, b) => b.id - a.id)
  const start = (f.page - 1) * PAGE_SIZE
  return { rows: rows.slice(start, start + PAGE_SIZE), more: rows.length > start + PAGE_SIZE }
}

/** One request in, one answer out. info: {method, query (URLSearchParams), headers (lower-case), cookie, body (string)}. */
export function createMock({ orders = makeOrders(), routePresent = true } = {}) {
  const st = { orders, routePresent, calls: [], limit: 0 }
  st.handle = (info) => {
    const route = info.query.get('r')
    st.calls.push({ route, method: info.method, query: info.query.toString(), body: info.body || '' })
    if (!['abandoned_orders', 'abandoned_followup'].includes(route) || !st.routePresent) return { status: 404, body: { error: 'not_found' } }
    if (!(info.cookie || '').includes(SESSION_COOKIE + '=')) return { status: 401, body: { error: 'not_signed_in' } }
    if (info.headers['x-sporta-admin'] !== '1') return { status: 400, body: { error: 'bad_request' } }
    if (route === 'abandoned_orders') {
      if (info.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } }
      if (st.limit && st.calls.filter((c) => c.route === 'abandoned_orders').length > st.limit) return { status: 429, headers: { 'Retry-After': '2' }, body: { error: 'too_many_attempts', retry_after: 2 } }
      const f = filters(info.query)
      if (typeof f === 'string') return { status: 400, body: { error: f } }
      const page = listOf(st.orders, f)
      return {
        status: 200,
        body: {
          settings: { abandoned_after_minutes: 30, hold_minutes: 120, cod_hold_hours: 24 },
          filters: { reason: f.reason, from: f.from, to: f.to, q: f.q, include_recovered: f.rec },
          summary: summaryOf(st.orders, f), orders: page.rows.map(publicRow), page: f.page, has_more: page.more,
        },
      }
    }
    if (info.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } }
    if (!/^application\/json/i.test(info.headers['content-type'] || '')) return { status: 403, body: { error: 'bad_request' } }
    let b
    try { b = JSON.parse(info.body || '') } catch { return { status: 400, body: { error: 'invalid_order' } } }
    const id = typeof b.order_id === 'string' && /^[1-9][0-9]{0,9}$/.test(b.order_id) ? +b.order_id : b.order_id
    if (!Number.isInteger(id) || id < 1) return { status: 400, body: { error: 'invalid_order' } }
    if (typeof b.state !== 'string' || ![...STATES, 'none'].includes(b.state)) return { status: 400, body: { error: 'invalid_state' } }
    let note = b.note == null ? '' : b.note
    if (typeof note !== 'string') return { status: 400, body: { error: 'invalid_note' } }
    note = note.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
    if ([...note].length > 280) return { status: 400, body: { error: 'note_too_long' } }
    const o = st.orders.find((x) => x.id === id)
    if (!o) return { status: 404, body: { error: 'not_found' } }
    if (b.state === 'none') { o.followup = null; return { status: 200, body: { followup: null } } }
    o.followup = { state: b.state, note, by: ME, at: '2026-11-04 07:02:11' }
    return { status: 200, body: { followup: { order_id: id, ...o.followup } } }
  }
  return st
}
