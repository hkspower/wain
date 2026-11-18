// The Invoices screen of /backends (block "ADMIN INVOICES" in public/sporta-admin-brands.js), in a real browser.
//
//   npm run test:admin-invoices   (rig-free: no database, no PHP; the admin API is a fake answered by route interception that behaves like
//                                  the real GET orders and GET items; the REAL add-on file, real Tailwind and the real
//                                  public/sporta-admin-knet.css are on the page)
//
// The owner's brief (2026-11-18): "make invoice system" in /backends. /backends had no invoice: the only one was the public page, which
// leaves out the phone and (without a key) the street. What is asserted:
//   the entry      one "Invoices" button in the Orders header, nowhere else, once; MUTATION: with the block cut out there is none;
//   the list       one row per order, numbered INV- + the order id in six digits; the Kuwait date (UTC+3: an order placed at 22:00 UTC on
//                  31 Oct is a 1 Nov order); status pills; the count / total / paid total add up in whole fils; "Check" only on an order
//                  whose total is not subtotal - discount + delivery (never on an old order with no subtotal);
//   find           search sends the server's own search (a phone typed any way), the payment filter sends the server's own filter, the month
//                  filter works on what is read; Load more / Load all page through the orders (200 / 500 at a time) and stop at the end;
//   the invoice    an A4 sheet in Arabic first (RTL) or English: the shop, number, order number, dates, method and state, the buyer's name,
//                  phone and whole address, every line (name in the sheet's language, size, qty, unit, amount), subtotal / discount (with
//                  its code) / delivery / total as the row holds them, the bank's Payment ID and reference, the note; a cash order says
//                  "to be paid on delivery", a cancelled order says so, an old order shows its total without a breakdown;
//   print          the browser's print window is opened with the invoice number as the title and the title is put back; in print media only
//                  the sheet is left (the admin and the dialog's header are hidden, the sheet is on white);
//   CSV            the visible rows, a BOM, every cell quoted, a cell that starts with = is written as text, named for the month;
//   safety         read-only (every call is a GET with the admin header), a name with markup stays text, an unreadable order list or items
//                  list says so with Try again, signed out says so;
//   Arabic RTL, light and dark, no sideways scroll at 390, 44 px targets on a phone, Escape closes and focus returns, one style element.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE, SCREEN, ORDERS, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN INVOICES - begin')
const END = BRANDS_JS.indexOf('/* ===== ADMIN INVOICES - end')
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN INVOICES block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clone = (x) => JSON.parse(JSON.stringify(x))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------------------------------------------------------ the page
// The Orders header as the live admin draws it (scripts/fixtures/sizes-admin/orders.html): the title block, and beside it the group of the
// screen's own buttons. The plain `orders` screen has no group (the add-on then puts its button in the header itself).
const ORDERS_LIVE = '<section class="admin-page"><div class="admin-page-layout space-y-6"><header class="admin-page-header flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-2xl font-bold text-slate-800">Orders</h1><p class="mt-1 text-sm text-slate-500">7 orders shown</p></div><div class="flex w-full flex-wrap gap-2 sm:w-auto"><button type="button" class="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:flex-none">Refresh</button><button type="button" class="min-h-11 flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 sm:flex-none">Export shown CSV</button></div></header></div></section>'
const SCREENS = { catalogue: SCREEN, orders: ORDERS, orders_live: ORDERS_LIVE }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'invoices-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ ar, screen, dark }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" ${dark ? 'class="dark" data-theme="dark" style="color-scheme:dark"' : 'data-theme="light" style="color-scheme:light"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`

// ------------------------------------------------------------------------------------------------ the data
const base = (o) => ({
  track_id: 'SPX' + String(o.id).padStart(5, '0'), amount: 0, subtotal: 0, discount_amount: 0, discount_code: null, delivery_fee: 0,
  payment_status: 'pending', payment_method: 'cod', fulfilment_status: 'unfulfilled', paid_at: null, created_at: '2026-11-17 08:30:00',
  customer_name: 'Customer', customer_phone: '96550000000', customer_area: null, customer_note: null, customer_governorate: null, customer_block: null,
  customer_street: null, customer_building: null, customer_floor: null, customer_flat: null, cbk_paymentid: null, cbk_reference: null, cbk_status: null,
  utm_source: null, utm_medium: null, utm_campaign: null, referrer_host: null, ...o,
})
const ORDER_ROWS = [
  base({ id: 123, created_at: '2026-11-17 08:30:00', paid_at: '2026-11-17 08:35:10', payment_method: 'knet', payment_status: 'paid', amount: 19, subtotal: 20, discount_amount: 3, discount_code: 'SAVE3', delivery_fee: 2,
    customer_name: 'Mona Ali', customer_phone: '96598765432', customer_governorate: 'Hawalli', customer_area: 'Salmiya', customer_block: '10', customer_street: 'Salem Al Mubarak', customer_building: '7', customer_floor: '3', customer_flat: '12',
    customer_note: 'Ring twice', cbk_paymentid: 'PID-778899', cbk_reference: 'REF-5521' }),
  base({ id: 124, created_at: '2026-11-17 09:00:00', amount: 10, subtotal: 10, customer_name: 'Omar Khalid', customer_phone: '+965 5522-2759' }),
  base({ id: 125, created_at: '2026-11-16 12:00:00', payment_method: 'knet', amount: 15, subtotal: 15, customer_name: 'Sara N' }),
  base({ id: 126, created_at: '2026-11-15 12:00:00', payment_method: 'knet', payment_status: 'refunded', paid_at: '2026-11-15 12:05:00', amount: 12.5, subtotal: 12.5, customer_name: 'Layla H' }),
  base({ id: 127, created_at: '2026-11-14 12:00:00', amount: 13, subtotal: 10, delivery_fee: 2, customer_name: 'Does Notadd' }),
  base({ id: 128, created_at: '2026-11-10 12:00:00', amount: 8, subtotal: 0, payment_status: 'paid', paid_at: '2026-11-10 12:30:00', payment_method: 'knet', customer_name: 'Old Order' }),
  base({ id: 129, created_at: '2026-11-09 12:00:00', fulfilment_status: 'cancelled', amount: 6, subtotal: 6, customer_name: '=HYPERLINK("http://x.test")' }),
  base({ id: 130, created_at: '2026-11-08 12:00:00', amount: 4, subtotal: 4, customer_name: '<img src=x onerror=window.__xss=1><b>bold</b>' }),
  // placed at 22:00 UTC on 31 October = 01:00 on 1 November in Kuwait
  base({ id: 100, created_at: '2026-10-31 22:00:00', payment_method: 'knet', payment_status: 'paid', paid_at: '2026-10-31 22:01:00', amount: 30, subtotal: 30, customer_name: 'Boundary Buyer' }),
  base({ id: 99, created_at: '2026-10-12 10:00:00', payment_method: 'knet', payment_status: 'paid', paid_at: '2026-10-12 10:01:00', amount: 25, subtotal: 25, customer_name: 'October Buyer' }),
]
const ITEMS = {
  123: [
    { id: 1, qty: 2, unit_price: 7.5, size: 'M', fit: null, products: { slug: 'run-shorts', name_en: 'Run Shorts', name_ar: 'شورت الجري' } },
    { id: 2, qty: 1, unit_price: 5, size: 'L', fit: null, products: { slug: 'air-max', name_en: 'Air Max', name_ar: 'اير ماكس' } },
  ],
}
const dflt = (id) => [{ id: id * 10, qty: 1, unit_price: 1, size: 'M', fit: null, products: { slug: 'x', name_en: 'Item ' + id, name_ar: 'صنف ' + id } }]

function makeApi({ bulk = 0, ordersStatus = 200 } = {}) {
  const rows = clone(ORDER_ROWS)
  for (let i = 0; i < bulk; i++) rows.push(base({ id: 1000 + i, created_at: '2026-09-' + String(1 + (i % 27)).padStart(2, '0') + ' 10:00:00', amount: 1, subtotal: 1, customer_name: 'Bulk ' + i }))
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
  const st = { calls: [], faults: {}, signedIn: true, bad: [], delay: 6, rows }
  const out = (status, body) => ({ status, body })
  const fault = (r) => (st.faults[r] || []).shift()
  const needle = (q) => { const d = String(q).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)); return /^[+0-9 ().-]{3,24}$/.test(d) && d.replace(/\D/g, '').replace(/^(00)?965/, '').length >= 3 ? d.replace(/\D/g, '').replace(/^(00)?965/, '') : null }
  function orders(u) {
    const payment = u.searchParams.get('payment') || 'all', term = (u.searchParams.get('search') || '').trim()
    let list = st.rows.filter((o) => {
      if (payment === 'unpaid') return ['pending', 'review', 'failed'].includes(o.payment_status)
      if (payment !== 'all') return o.payment_status === payment
      return true
    })
    if (term) {
      const nd = needle(term)
      list = list.filter((o) => o.track_id.toLowerCase().includes(term.toLowerCase()) || o.customer_name.toLowerCase().includes(term.toLowerCase())
        || o.customer_phone.includes(term) || (nd && o.customer_phone.replace(/\D/g, '').includes(nd)))
    }
    const limit = Math.max(1, Math.min(500, Number(u.searchParams.get('limit') || 100))), offset = Math.max(0, Number(u.searchParams.get('offset') || 0))
    return out(200, clone(list.slice(offset, offset + limit)))
  }
  async function handle(route) {
    const req = route.request(), u = new URL(req.url())
    const rec = { r: u.searchParams.get('r') || '', method: req.method(), url: u.search, status: 0 }
    st.calls.push(rec)
    await sleep(st.delay)
    let res
    if (!['orders', 'items'].includes(rec.r)) res = out(rec.r === 'payment_alerts' ? 200 : 404, rec.r === 'payment_alerts' ? [] : { error: 'not_found' })   // other add-on blocks ask for their own routes
    else if (!st.signedIn) res = out(401, { error: 'not_signed_in' })
    else {
      if (req.headers()['x-sporta-admin'] !== '1') st.bad.push('missing X-Sporta-Admin on ' + rec.r)
      const f = fault(rec.r)
      if (f) res = out(f.status, f.body || { error: 'x' })
      else if (rec.r === 'orders') res = ordersStatus === 200 ? orders(u) : out(ordersStatus, { error: 'x' })
      else if (rec.r === 'items') { const id = Number(u.searchParams.get('order')); res = out(200, clone(ITEMS[id] || dflt(id))) }
      else res = out(200, [])
    }
    rec.status = res.status
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) })
  }
  const fail = (r, ...list) => { st.faults[r] = (st.faults[r] || []).concat(list) }
  return { st, handle, fail }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ROOTSEL = '[data-sporta-inv-root]'
const D = (k) => `${ROOTSEL} [data-sinv="${k}"]`
async function open({ w = 1280, h = 900, ar = false, dark = false, screen = 'orders', js = BRANDS_JS, api = makeApi() } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', acceptDownloads: true })
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.addInitScript(() => { window.__prints = []; window.print = () => { window.__prints.push(document.title) } })
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    if (u.pathname === '/api/admin.php') return api.handle(route)
    if (u.pathname === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}` })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: js })
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: pageHtml({ ar: u.searchParams.get('ar') === '1' || ar, screen: u.searchParams.get('screen') || screen, dark }) })
  })
  await pg.goto(`${ORIGIN}/backends`)
  await pg.waitForTimeout(700)
  return { ctx, pg, errors, api }
}
async function openList(o = {}) {
  const t = await open(o)
  t.api.st.calls.length = 0
  await t.pg.click('[data-sporta-inv-open]')
  await t.pg.waitForSelector(ROOTSEL)
  await t.pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length > 0 || /Could not|ended|slow/.test(document.querySelector('[data-sinv="error"]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {})
  return t
}
const rowsCount = (pg) => pg.locator(D('row')).count()
const rowIds = (pg) => pg.locator(D('row')).evaluateAll((l) => l.map((b) => b.getAttribute('data-order')))
const txt = async (pg, k) => ((await pg.locator(D(k)).first().textContent()) || '').trim()
const openInv = async (pg, id) => { await pg.click(`${D('row')}[data-order="${id}"]`); await pg.waitForSelector(D('doc'), { timeout: 5000 }) }
const docText = (pg) => pg.locator(D('doc')).evaluate((d) => d.textContent.replace(/\s+/g, ' ').trim())
const fils = (v) => Math.round(Number(v) * 1000)
const kwd = (f) => { let s = String(Math.abs(f)); while (s.length < 4) s = '0' + s; return (f < 0 ? '-' : '') + s.slice(0, -3) + '.' + s.slice(-3) }

// =============================================================================================== 1. the entry
head('the button, in the live Orders header')
{
  const { pg, errors } = await open({ screen: 'orders_live' })
  is(await pg.locator('[data-sporta-inv-open]').count() === 1, 'one "Invoices" button')
  const place = await pg.evaluate(() => {
    const b = document.querySelector('[data-sporta-inv-open]'), g = b.parentElement, kids = [...g.children].map((x) => x.textContent.trim())
    const refresh = [...g.children].find((x) => x.textContent.trim() === 'Refresh')
    return { inGroup: g.className.includes('flex w-full') && !!g.closest('.admin-page-header'), kids, sameClass: b.className === refresh.className, style: b.getAttribute('style'), h: Math.round(b.getBoundingClientRect().height) }
  })
  is(place.inGroup && eq(place.kids, ['Refresh', 'Invoices', 'Export shown CSV']), 'it sits in the group of the screen\'s own buttons, between Refresh and Export shown CSV', JSON.stringify(place.kids))
  is(place.sameClass && !place.style, 'in the style of Refresh (the same classes, no inline box of its own)', JSON.stringify(place))
  is(place.h >= 40 && place.h <= 48, 'about the height of its neighbours (44px, min-h-11)', String(place.h))
  await pg.click('[data-sporta-inv-open]')
  await pg.waitForSelector(ROOTSEL)
  is(await pg.locator(D('doc')).count() === 0 && await pg.locator(ROOTSEL).count() === 1, 'it opens the screen')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

head('the button')
{
  const { pg, errors, api } = await open()
  const count = () => pg.locator('[data-sporta-inv-open]').count()
  is(await count() === 1, 'one "Invoices" button on the Orders screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-inv-open]'); return !!b.closest('.admin-page-header') && b.textContent.trim() === 'Invoices' && b.closest('.admin-page').querySelector('h1').textContent.trim() === 'Orders' }), 'it sits in the Orders page header and reads "Invoices"')
  // a screen change in the app is a click on its menu: that is what the block listens to
  await pg.click('.admin-sidebar [data-go="catalogue"]'); await pg.evaluate(() => window.fx.go('catalogue')); await pg.waitForTimeout(800)
  is(await count() === 0, 'no button on the Catalogue screen')
  await pg.click('.admin-sidebar [data-go="orders"]'); await pg.evaluate(() => window.fx.go('orders')); await pg.waitForTimeout(800)
  is(await count() === 1, 'back on Orders: one button (not two)')
  is(await pg.evaluate(() => document.querySelectorAll('style[data-sporta-invoices-style]').length) === 0, 'nothing is added to the head until the screen is opened')
  is(api.st.calls.every((c) => c.method === 'GET') && !api.st.calls.some((c) => c.r === 'orders'), 'nothing is read until the button is pressed, and nothing is written')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  const m = await open({ js: WITHOUT })
  is(await m.pg.locator('[data-sporta-inv-open]').count() === 0, 'MUTATION: with the block cut out of the file there is no button')
  await m.ctx.close(); await pg.context().close()
}

// =============================================================================================== 2. the list
head('the list')
{
  const { pg, errors, api } = await openList()
  const ids = await rowIds(pg)
  is(ids.length === ORDER_ROWS.length, 'one row per order', `${ids.length} of ${ORDER_ROWS.length}`)
  is(eq(ids, ['123', '124', '125', '126', '127', '128', '129', '130', '100', '99'].filter((x) => ORDER_ROWS.some((o) => String(o.id) === x)).sort((a, b) => { const A = ORDER_ROWS.find((o) => String(o.id) === a), B = ORDER_ROWS.find((o) => String(o.id) === b); return A.created_at < B.created_at ? 1 : A.created_at > B.created_at ? -1 : B.id - A.id })), 'newest first (the Orders route\'s own order)')
  const r123 = pg.locator(`${D('row')}[data-order="123"]`)
  const t123 = ((await r123.textContent()) || '').replace(/\s+/g, ' ')
  is(t123.includes('INV-000123') && t123.includes('Mona Ali') && t123.includes('Paid') && t123.includes('19.000 KWD') && t123.includes('17 Nov 2026 11:30'), 'a row: INV-000123, the name, Paid, 19.000 KWD and the Kuwait time (08:30 UTC is 11:30)', t123)
  const t124 = ((await pg.locator(`${D('row')}[data-order="124"]`).textContent()) || '')
  is(t124.includes('Awaiting payment') === false && t124.includes('To be paid on delivery'), 'a cash order that is not paid yet says it is paid on delivery')
  is(((await pg.locator(`${D('row')}[data-order="126"]`).textContent()) || '').includes('Refunded'), 'a refunded order says Refunded')
  const bd = ((await pg.locator(`${D('row')}[data-order="100"]`).textContent()) || '')
  is(bd.includes('01 Nov 2026 01:00'), '22:00 UTC on 31 Oct is shown as 01 Nov 01:00 (Kuwait is UTC+3)', bd)
  is(eq(await pg.locator(D('check')).evaluateAll((l) => l.map((e) => e.closest('button').getAttribute('data-order'))), ['127']), '"Check" is on the one order whose total is not subtotal - discount + delivery (127), not on the old order with no subtotal (128)')
  const tot = ORDER_ROWS.reduce((s, o) => s + fils(o.amount), 0), paid = ORDER_ROWS.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + fils(o.amount), 0)
  is((await txt(pg, 'summary')) === `Invoices: ${ORDER_ROWS.length} · Total ${kwd(tot)} KWD · Paid ${kwd(paid)} KWD`, 'the summary adds up in whole fils', await txt(pg, 'summary'))
  is(api.st.calls.filter((c) => c.r === 'orders').length === 1 && /limit=200&offset=0/.test(api.st.calls[0].url), 'one orders read, 200 at a time', api.st.calls.map((c) => c.url).join(' | '))
  is(await pg.locator(D('load-more')).isHidden(), 'no Load more when everything fit')
  // filters
  await pg.selectOption(D('payment'), 'unpaid')
  const unpaid = ORDER_ROWS.filter((o) => ['pending', 'review', 'failed'].includes(o.payment_status)).map((o) => String(o.id)).sort()
  await pg.waitForFunction((n) => document.querySelectorAll('[data-sinv="row"]').length === n, unpaid.length)
  is(api.st.calls.some((c) => /payment=unpaid/.test(c.url)) && eq((await rowIds(pg)).sort(), unpaid), 'the payment filter asks the server for unpaid and shows only those', JSON.stringify(await rowIds(pg)))
  await pg.selectOption(D('payment'), 'all')
  await pg.waitForFunction((n) => document.querySelectorAll('[data-sinv="row"]').length === n, ORDER_ROWS.length)
  const opts = await pg.locator(D('month') + ' option').evaluateAll((l) => l.map((o) => o.textContent + '=' + o.value))
  is(eq(opts, ['All months=', 'Nov 2026=2026-11', 'Oct 2026=2026-10']), 'the month menu lists the months read, newest first', JSON.stringify(opts))
  await pg.selectOption(D('month'), '2026-11')
  const nov = ORDER_ROWS.filter((o) => { const d = new Date(Date.parse(o.created_at.replace(' ', 'T') + 'Z') + 3 * 3600000); return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 10 })
  is((await rowsCount(pg)) === nov.length && (await rowIds(pg)).includes('100') && !(await rowIds(pg)).includes('99'), 'November shows the Kuwait-November orders, the 22:00 UTC one on 31 Oct included, October\'s not', `${await rowsCount(pg)} of ${nov.length}`)
  is((await txt(pg, 'summary')).startsWith(`Invoices: ${nov.length} · Total ${kwd(nov.reduce((s, o) => s + fils(o.amount), 0))} KWD`), 'and the summary follows the month')
  await pg.selectOption(D('month'), '')
  // search
  await pg.fill(D('search'), '9876 5432')
  await pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length === 1, null, { timeout: 4000 })
  is(eq(await rowIds(pg), ['123']) && api.st.calls.some((c) => /search=9876%205432/.test(c.url)), 'a phone typed with a space finds the order (the server\'s own search)')
  await pg.fill(D('search'), 'SPX00124')
  await pg.press(D('search'), 'Enter')
  await pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length === 1 && document.querySelector('[data-sinv="row"]').getAttribute('data-order') === '124', null, { timeout: 4000 })
  is(true, 'Enter searches at once; an order number finds the order')
  await pg.fill(D('search'), 'zzzz-no-one')
  await pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length === 0, null, { timeout: 4000 })
  // the block hides "No invoice matches." while the search is still being read (busy), so wait for the answer to land
  await pg.waitForFunction((sel) => Array.prototype.some.call(document.querySelectorAll(sel + ' .sinv-hint'), (p) => p.textContent === 'No invoice matches.' && !p.hidden), ROOTSEL, { timeout: 4000 })
  is(await pg.locator(`${ROOTSEL} .sinv-hint`).evaluateAll((l) => l.some((p) => p.textContent === 'No invoice matches.' && !p.hidden)), 'nothing matches: it says so')
  is(api.st.bad.length === 0 && api.st.calls.every((c) => c.method === 'GET'), 'every call is a GET with the admin header', api.st.bad.join(' | '))
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

// =============================================================================================== 3. paging
head('Load more / Load all')
{
  const { pg, api } = await openList({ api: makeApi({ bulk: 450 }) })
  is(await rowsCount(pg) === 200 && await pg.locator(D('load-more')).isVisible() && (await txt(pg, 'more')).includes('more orders than are shown'), 'the first read shows 200 and says there are more (the totals do not claim to be complete)')
  await pg.click(D('load-more'))
  await pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length === 400, null, { timeout: 5000 })
  is(/offset=200/.test(api.st.calls[1].url), 'Load more reads the next 200 from offset 200', api.st.calls.map((c) => c.url).join(' | '))
  await pg.click(D('load-all'))
  await pg.waitForFunction((n) => document.querySelectorAll('[data-sinv="row"]').length === n && document.querySelector('[data-sinv="load-all"]').hidden, 460, { timeout: 8000 })
  is(await rowsCount(pg) === 460 && await pg.locator(D('more')).isHidden(), 'Load all reads the rest (460 orders) and the "more" notes go away')
  is(/limit=500&offset=400/.test(api.st.calls[2].url), 'in pages of 500', api.st.calls[2].url)
  await pg.context().close()
}

// =============================================================================================== 4. the invoice
head('the invoice')
{
  const { pg, errors, api } = await openList()
  await openInv(pg, 123)
  const dir = await pg.locator(D('doc')).getAttribute('dir'), lg = await pg.locator(D('doc')).getAttribute('lang')
  is(dir === 'rtl' && lg === 'ar', 'the sheet opens in Arabic, right to left (the shop\'s own language)')
  let d = await docText(pg)
  is(d.includes('فاتورة') && d.includes('INV-000123') && d.includes('SPX00123') && d.includes('SPORTA'), 'Arabic: the title, the invoice number, the order number and the shop', d.slice(0, 160))
  is(d.includes('17 نوفمبر 2026 11:30') && d.includes('17 نوفمبر 2026 11:35'), 'Arabic: the order and payment dates in Kuwait time, Latin digits', d)
  is(d.includes('+965 9876 5432') && d.includes('Mona Ali'), 'the buyer\'s name and the phone, written +965 9876 5432 (the public invoice leaves the phone out; this one has it)')
  is(d.includes('المحافظة: Hawalli') && d.includes('القطعة: 10') && d.includes('الشارع: Salem Al Mubarak') && d.includes('المبنى: 7') && d.includes('الدور: 3') && d.includes('الشقة: 12'), 'the whole address: governorate, area, block, street, building, floor, flat')
  is(d.includes('شورت الجري') && d.includes('اير ماكس') && d.includes('15.000') && d.includes('7.500') && d.includes('5.000'), 'the lines in Arabic: names, unit price, line amount (2 x 7.500 = 15.000)')
  is(d.includes('20.000 د.ك') && d.includes('-3.000 د.ك') && d.includes('SAVE3') && d.includes('2.000 د.ك') && d.includes('19.000 د.ك'), 'subtotal 20.000, discount -3.000 (SAVE3), delivery 2.000, total 19.000 د.ك, as the row holds them')
  is(d.includes('PID-778899') && d.includes('REF-5521') && d.includes('Ring twice'), 'the bank\'s Payment ID and reference, and the buyer\'s note')
  is((await txt(pg, 'doc-state')) === 'مدفوعة' && d.includes('كي نت'), 'state مدفوعة, method كي نت')
  await pg.click(D('doclang-en'))
  d = await docText(pg)
  is(await pg.locator(D('doc')).getAttribute('dir') === 'ltr' && d.includes('Invoice') && d.includes('Run Shorts') && d.includes('Air Max') && d.includes('19.000 KWD') && d.includes('Discount (SAVE3)') && (await txt(pg, 'doc-state')) === 'Paid', 'English: the same sheet, left to right, names and words in English')
  is(d.includes('17 Nov 2026 11:30') && d.includes('Payment ID') && d.includes('KNET'), 'English dates and labels')
  // a cash order not yet paid
  await pg.click(D('back'))
  await openInv(pg, 124)
  is((await txt(pg, 'doc-state')) === 'تُدفع عند التسليم', 'a cash order: "to be paid on delivery"')
  is(await pg.locator(D('doc-sub')).count() === 1 && await pg.locator(D('doc-disc')).count() === 0 && (await txt(pg, 'doc-del')).includes('مجاني'), 'no discount row without a discount; a free delivery says free')
  await pg.click(D('back'))
  // the old order: no stored subtotal
  await openInv(pg, 128)
  is(await pg.locator(D('doc-sub')).count() === 0 && await pg.locator(D('doc-del')).count() === 0 && (await txt(pg, 'doc-total')).includes('8.000'), 'an old order with no stored subtotal shows its total with no invented breakdown')
  await pg.click(D('back'))
  // the one that does not add up: the server's numbers are shown as they are
  await openInv(pg, 127)
  is((await txt(pg, 'doc-total')).includes('13.000') && (await txt(pg, 'doc-sub')).includes('10.000'), 'an order whose total does not add up still shows the stored numbers (flagged in the list, not corrected)')
  await pg.click(D('back'))
  await openInv(pg, 129)
  is(((await docText(pg)).includes('الطلب ملغى')), 'a cancelled order says so')
  await pg.click(D('back'))
  // markup stays text
  await openInv(pg, 130)
  is(await pg.locator(`${D('doc')} img, ${D('doc')} b`).count() === 0 && (await docText(pg)).includes('<img src=x') && await pg.evaluate(() => !window.__xss), 'a name with markup is text on the sheet (no element, no script)')
  await pg.click(D('back'))
  await openInv(pg, 129)
  is(await pg.locator(`${ROOTSEL} [data-sinv="row"]`).count() === 0, 'the list is not on screen behind the sheet')
  is(api.st.calls.filter((c) => c.r === 'items').length >= 6 && api.st.calls.every((c) => c.method === 'GET'), 'each sheet read its items with a GET')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

// =============================================================================================== 5. print
head('print')
{
  const { pg } = await openList()
  await openInv(pg, 123)
  const before = await pg.title()
  await pg.click(D('print'))
  is(eq(await pg.evaluate(() => window.__prints), ['INV-000123']) && (await pg.title()) === before, 'the print window is opened with the invoice number as the title, and the title is put back', JSON.stringify(await pg.evaluate(() => window.__prints)))
  await pg.emulateMedia({ media: 'print' })
  const m = await pg.evaluate(() => {
    const disp = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'missing' }
    const doc = document.querySelector('[data-sinv="doc"]'), r = doc.getBoundingClientRect()
    return { app: disp('#root'), tabbar: disp('.m-tabbar'), head: disp('.sinv-head'), actions: disp('.sinv-noprint'), root: getComputedStyle(document.querySelector('.sinv-root')).position,
      bg: getComputedStyle(doc).backgroundColor, w: r.width, h: r.height, color: getComputedStyle(doc).color, dlgBorder: getComputedStyle(document.querySelector('.sinv')).borderTopWidth }
  })
  is(m.app === 'none' && m.tabbar === 'none' && m.head === 'none' && m.actions === 'none', 'in print media the admin, the dialog header and the buttons are hidden', JSON.stringify(m))
  is(m.root === 'static' && m.w > 300 && m.h > 200 && m.bg === 'rgb(255, 255, 255)' && m.color === 'rgb(17, 17, 17)' && m.dlgBorder === '0px', 'and the sheet is left, on white, black text, with no frame', JSON.stringify(m))
  await pg.emulateMedia({ media: 'screen' })
  await pg.context().close()
  const dk = await openList({ dark: true })
  await openInv(dk.pg, 123)
  is(await dk.pg.locator(D('doc')).evaluate((d) => getComputedStyle(d).backgroundColor) === 'rgb(255, 255, 255)', 'in the dark admin the sheet is still white (it is a page to print)')
  await dk.pg.context().close()
}

// =============================================================================================== 6. CSV
head('CSV')
{
  const { pg } = await openList()
  const grab = async () => { const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click(D('csv'))]); const p = await dl.path(); return { name: dl.suggestedFilename(), text: readFileSync(p, 'utf8') } }
  let f = await grab()
  const lines = f.text.replace(/^﻿/, '').trim().split('\r\n')
  is(f.text.startsWith('﻿') && lines.length === ORDER_ROWS.length + 1 && /^invoices-\d{4}-\d{2}-\d{2}\.csv$/.test(f.name), 'a CSV of every row shown, with a BOM, named for today', `${lines.length} lines, ${f.name}`)
  is(lines[0].startsWith('"Invoice","Order","Date (Kuwait)","Customer","Phone"') && lines[0].includes('"Total KWD"') && lines[0].includes('"Checked"'), 'its header')
  const l123 = lines.find((l) => l.includes('INV-000123'))
  is(l123.includes('"96598765432"') && l123.includes('"17 Nov 2026 11:30"') && l123.includes('"19.000"') && l123.includes('"PID-778899"') && l123.includes('"REF-5521"'), 'a row: number, phone, Kuwait time, total, bank ids', l123)
  is(lines.find((l) => l.includes('INV-000127')).includes('DOES NOT ADD UP') && !l123.includes('DOES NOT ADD UP'), 'the order that does not add up is marked in the file')
  is(lines.find((l) => l.includes('INV-000129')).includes('"\'=HYPERLINK(""http://x.test"")"'), 'a name that starts with = is written as text (a spreadsheet will not run it)', lines.find((l) => l.includes('INV-000129')))
  await pg.selectOption(D('month'), '2026-10')
  f = await grab()
  is(f.name === 'invoices-2026-10.csv' && f.text.replace(/^﻿/, '').trim().split('\r\n').length === 1 + 1, 'with a month chosen only that month is in the file, named for it', `${f.name}`)
  await pg.context().close()
}

// =============================================================================================== 7. failures
head('failures')
{
  const bad = await openList({ api: makeApi({ ordersStatus: 500 }) })
  is((await txt(bad.pg, 'error')) === 'Could not read the orders.' && await bad.pg.locator(D('retry')).isVisible() && await rowsCount(bad.pg) === 0, 'an unreadable order list says so and offers Try again')
  await bad.pg.context().close()
  const out = await openList()
  out.api.st.signedIn = false
  await out.pg.selectOption(D('payment'), 'paid')
  await out.pg.waitForFunction(() => /ended/.test(document.querySelector('[data-sinv="error"]')?.textContent || ''), null, { timeout: 4000 })
  is(true, 'signed out says the session ended')
  out.api.st.signedIn = true
  await out.pg.click(D('retry'))
  await out.pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length > 0, null, { timeout: 4000 })
  is(await out.pg.locator(D('error')).evaluate((e) => e.textContent === ''), 'Try again reads the list and clears the message')
  await out.pg.context().close()
  const it = await openList()
  it.api.fail('items', { status: 500, body: { error: 'x' } })
  await it.pg.click(`${D('row')}[data-order="123"]`)
  await it.pg.waitForFunction(() => /Could not read the items/.test(document.querySelector('[data-sinv="doc-status"]')?.textContent || ''), null, { timeout: 4000 })
  is(await it.pg.locator(D('print')).isDisabled() && await it.pg.locator(D('doc')).count() === 0, 'items that cannot be read: no sheet, Print is off, the message says why')
  await it.pg.click(D('back'))
  is(await rowsCount(it.pg) === ORDER_ROWS.length && await it.pg.locator(D('search')).evaluate((e) => document.activeElement === e), 'Back returns to the list with the search box focused')
  await it.pg.context().close()
}

// =============================================================================================== 8. Arabic, dark, phone
head('Arabic, dark, 390 px')
{
  const { pg, errors } = await open({ ar: true, w: 390, h: 800 })
  is((await pg.locator('[data-sporta-inv-open]').textContent()).trim() === 'الفواتير', 'the button reads الفواتير')
  await pg.click('[data-sporta-inv-open]')
  await pg.waitForSelector(ROOTSEL)
  await pg.waitForFunction(() => document.querySelectorAll('[data-sinv="row"]').length > 0)
  is((await pg.locator(`${ROOTSEL} .sinv-title`).textContent()) === 'الفواتير' && await pg.locator(ROOTSEL).getAttribute('dir') === 'rtl', 'the title is Arabic and the dialog is RTL')
  const r = ((await pg.locator(`${D('row')}[data-order="123"]`).textContent()) || '').replace(/\s+/g, ' ')
  is(r.includes('مدفوعة') && r.includes('17 نوفمبر 2026') && r.includes('19.000 د.ك'), 'a row in Arabic: state, month name, د.ك', r)
  is((await txt(pg, 'summary')).startsWith('الفواتير: 10 ·'), 'the summary is Arabic')
  const mList = await pg.evaluate(() => {
    const root = document.querySelector('[data-sporta-inv-root]'), small = []
    root.querySelectorAll('button,select,input').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && b.height && b.height < 43.5) small.push((e.getAttribute('data-sinv') || e.tagName) + ':' + Math.round(b.height)) })
    return { rootSW: root.scrollWidth, rootCW: root.clientWidth, page: document.documentElement.scrollWidth, small }
  })
  is(mList.rootSW <= mList.rootCW + 1 && mList.page <= 391 && mList.small.length === 0, 'the list: no sideways scroll at 390 px and every control 44 px or more', JSON.stringify(mList))
  await pg.click(`${D('row')}[data-order="123"]`)
  await pg.waitForSelector(D('doc'))
  const mDoc = await pg.evaluate(() => {
    const root = document.querySelector('[data-sporta-inv-root]'), w = document.querySelector('.sinv-paper-wrap'), small = []
    root.querySelectorAll('button').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && b.height && b.height < 43.5) small.push((e.getAttribute('data-sinv') || e.tagName) + ':' + Math.round(b.height)) })
    return { rootSW: root.scrollWidth, rootCW: root.clientWidth, page: document.documentElement.scrollWidth, wrapSW: w.scrollWidth, wrapCW: w.clientWidth, small }
  })
  is(mDoc.rootSW <= mDoc.rootCW + 1 && mDoc.page <= 391 && mDoc.small.length === 0, 'the sheet: the dialog does not scroll sideways at 390 px and its buttons are 44 px', JSON.stringify(mDoc))
  await pg.keyboard.press('Escape')
  await pg.waitForTimeout(100)
  is(await pg.locator(ROOTSEL).count() === 0 && await pg.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-inv-open')) && await pg.evaluate(() => document.body.style.overflow !== 'hidden'), 'Escape closes, the page scroll is released and focus goes back to the button')
  is(await pg.evaluate(() => document.querySelectorAll('style[data-sporta-invoices-style]').length) === 1, 'one style element')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
  const dk = await openList({ dark: true })
  const c = await dk.pg.evaluate(() => { const s = getComputedStyle(document.querySelector('.sinv')); return [s.backgroundColor, getComputedStyle(document.querySelector('.sinv-root')).color] })
  is(c[0] === 'rgb(21, 27, 33)', 'the dark admin gets the dark dialog', JSON.stringify(c))
  await dk.pg.context().close()
}

// =============================================================================================== 9. the guards, one mutant each
head('the guards (each is cut once and the matching check above must be able to fail)')
{
  const BLOCK = BRANDS_JS.slice(BEGIN, END)
  const mut = (from, to) => { if (!BLOCK.includes(from)) return null; return BRANDS_JS.slice(0, BEGIN) + BLOCK.replace(from, to) + BRANDS_JS.slice(END) }
  const m1 = mut('+ 3 * 3600000)', '+ 0)')
  const m2 = mut('off: !plain && tot !== sub - disc + del', 'off: false')
  const m3 = mut('s = "\'" + s', 's = s')
  const m4 = mut('document.title = S.cur ? invNo(S.cur) : prev', 'document.title = prev')
  is(m1 && m2 && m3 && m4, 'set-up: the four guards are in the block')
  const a = await openList({ js: m1 })
  is(((await a.pg.locator(`${D('row')}[data-order="100"]`).textContent()) || '').includes('31 Oct 2026 22:00'), 'MUTATION: without the three hours, the 31 Oct 22:00 UTC order stays on 31 Oct (the Kuwait-date check would fail)')
  await a.pg.context().close()
  const b = await openList({ js: m2 })
  is(await b.pg.locator(D('check')).count() === 0, 'MUTATION: without the arithmetic there is no "Check" on the order that does not add up (the Check test would fail)')
  await b.pg.context().close()
  const c = await openList({ js: m3 })
  const [dl] = await Promise.all([c.pg.waitForEvent('download'), c.pg.click(D('csv'))])
  is(readFileSync(await dl.path(), 'utf8').includes('"=HYPERLINK('), 'MUTATION: without the guard a name that starts with = reaches the file as a formula (the CSV test would fail)')
  await c.pg.context().close()
  const d = await openList({ js: m4 })
  await openInv(d.pg, 123)
  await d.pg.click(D('print'))
  is(!eq(await d.pg.evaluate(() => window.__prints), ['INV-000123']), 'MUTATION: without the title the file would not be named for the invoice (the Print test would fail)')
  await d.pg.context().close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
