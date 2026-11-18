// PRICE TOOLS (owner, 2026-11-18: "make total prices and original prices and make sale price by percent and fix amounts increase"):
// the Prices list of /backends and the % off box of the product editor, in a real browser.
//
//   npm run test:admin-price-tools   (rig-free: no database, no PHP; the admin API is a fake answered by route interception that
//                                     validates like the real product_save; the REAL add-on file, real Tailwind and the real
//                                     public/sporta-admin-knet.css are on the page; the clock is fixed so "on sale now" is repeatable)
//
// What is asserted:
//   the list     - one "Prices" button in the Catalogue header (not on other screens); every product with its original price, sale price,
//                  % off and what it sells at now (a sale counts only inside its dates); the totals of what is shown and of what is ticked;
//                  filters (search, category, on sale, switched off) and sorts; a ticked product the filter hides is counted and said;
//   % off        - the sale price becomes the original minus the share, rounded to the step (exact, 0.050, 0.250...), the real % shown per
//                  row; Arabic digits and a decimal comma read; a bad percent shows no preview; sale dates kept / cleared / set in Kuwait time
//                  (typed 10:00 is stored 07:00 UTC) and a sale that ends before it starts refused before anything is sent;
//   fixed amount - +1.000 / -0.500 on the original price; a product on sale either keeps its % (sale follows) or its sale price; a price that
//                  would reach 0, or a kept sale price that would not stay below the price, is BLOCKED and named, never sent;
//   take off sale - the sale price and both dates go;
//   writing      - NOTHING is sent until Apply and a second click; then ONE product_save per changed product, the whole row as the list gave
//                  it (featured and active as booleans, the long description untouched), only the price fields different; the list is read
//                  AGAIN first and a product that changed since is skipped and named; a refusal, a 401 and a dropped connection each say so
//                  and a 401 / drop stops the rest; ticks are cleared after a run; Undo puts the before values back (only where the product
//                  still holds what this run wrote); the CSV has before and after and neutralises a formula in a name;
//   the editor   - a "% off" box beside the Sale price of the compiled product form: type a percent and the sale price fills in through an
//                  input event (the React form follows); type a sale price and the % shows; changing the regular price re-fills; no box on a
//                  form without the two price boxes;
//   Arabic RTL, no sideways scroll at 390, 44 px buttons, Escape closes, one style element, no page errors. MUTATIONS at the end.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE, PRODUCTS, SCREEN, ORDERS, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clone = (x) => JSON.parse(JSON.stringify(x))

// ------------------------------------------------------------------------------------------------ the page
const EDITOR = '<section class="admin-page"><div class="admin-page-layout"><header class="admin-page-header"><h1 class="text-2xl font-bold text-slate-900">Catalogue</h1></header>'
  + '<div class="product-section"><div class="product-section__head"><h4>Pricing and promotion</h4></div><div class="grid gap-3 sm:grid-cols-2">'
  + '<label class="block"><span class="mb-1.5 block text-xs font-bold text-slate-600">Regular price (KWD)</span><input id="fx-reg" required min="0.001" step="0.001" inputmode="decimal" placeholder="10.000" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" type="number" value=""></label>'
  + '<label class="block"><span class="mb-1.5 block text-xs font-bold text-slate-600">Sale price (KWD)</span><input id="fx-sale" min="0.001" step="0.001" inputmode="decimal" placeholder="Leave empty for no sale" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" type="number" value=""></label>'
  + '<label class="block"><span class="mb-1.5 block text-xs font-bold text-slate-600">Featured order</span><input min="0" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" type="number" value="0"></label>'
  + '<label class="block"><span class="mb-1.5 block text-xs font-bold text-slate-600">Sale starts</span><input id="fx-from" disabled class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" type="datetime-local"></label>'
  + '</div></div></div></section>'
const ONEBOX = EDITOR.replace(/<label class="block"><span[^>]*>Sale price[\s\S]*?<\/label>/, '')
const SCREENS = { catalogue: SCREEN, orders: ORDERS, editor: EDITOR, onebox: ONEBOX }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'price-tools-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ ar, screen }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`
// A stand-in for the React form: it follows "input" events (not the value property), like the real one.
const REACT_LIKE = ';(function(){window.__ev={sale:0,reg:0};document.addEventListener("input",function(e){var f=document.getElementById("fx-from");if(e.target.id==="fx-sale"){window.__ev.sale++;if(f)f.disabled=!e.target.value}if(e.target.id==="fx-reg")window.__ev.reg++},true)})()'

// ------------------------------------------------------------------------------------------------ the fake admin API
const MONEY = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/
const KEYS = ['id', 'slug', 'name_en', 'name_ar', 'desc_en', 'desc_ar', 'price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'featured', 'featured_sort', 'category', 'brand_slug', 'image', 'images', 'active'].sort().join()
function makeApi() {
  const st = { rows: clone(PRODUCTS), calls: [], faults: [], signedIn: true, bad: [], delay: 3, beforeList: null }
  const out = (status, body) => ({ status, body })
  const num3 = (s) => Number(s).toFixed(3)
  function save(b) {
    if (Object.keys(b).sort().join() !== KEYS) st.bad.push('product_save body keys: ' + Object.keys(b).sort().join())
    const row = st.rows.find((r) => String(r.id) === String(b.id))
    if (!Number.isInteger(b.id) || !row) return out(404, { error: 'product_not_found' })
    if (typeof b.price !== 'string' || !MONEY.test(b.price) || !(Number(b.price) > 0)) return out(400, { error: 'invalid_price' })
    let sale = null, from = null, to = null
    if (b.sale_price !== null && b.sale_price !== '') {
      if (typeof b.sale_price !== 'string' || !MONEY.test(b.sale_price) || !(Number(b.sale_price) > 0)) return out(400, { error: 'invalid_sale_price' })
      if (Number(b.sale_price) >= Number(b.price)) return out(400, { error: 'sale_not_lower' })
      sale = num3(b.sale_price)
      from = b.sale_starts_at || null; to = b.sale_ends_at || null
      if (from && to && from > to) return out(400, { error: 'sale_dates_backwards' })
    }
    if (typeof b.featured !== 'boolean') return out(400, { error: 'invalid_featured' })
    if (typeof b.active !== 'boolean') return out(400, { error: 'invalid_active' })
    if (!Number.isInteger(b.featured_sort) || b.featured_sort < 0) return out(400, { error: 'invalid_featured_sort' })
    for (const k of ['desc_en', 'desc_ar']) if (b[k] && b[k].length > 280 && b[k] !== row[k]) return out(400, { error: 'too_long_' + k })
    Object.assign(row, { price: num3(b.price), sale_price: sale, sale_starts_at: from, sale_ends_at: to })
    return out(200, clone(row))
  }
  async function handle(route) {
    const req = route.request(), u = new URL(req.url())
    const rec = { r: u.searchParams.get('r') || '', method: req.method(), body: null }
    st.calls.push(rec)
    await sleep(st.delay)
    let res
    if (!['brands', 'products_all', 'product_save', 'variants'].includes(rec.r)) { st.bad.push('unknown route ' + rec.r); res = out(404, { error: 'not_found' }) }
    else if (!st.signedIn) res = out(401, { error: 'not_signed_in' })
    else {
      if (req.headers()['x-sporta-admin'] !== '1') st.bad.push('missing X-Sporta-Admin on ' + rec.r)
      if (rec.method === 'POST') { try { rec.body = JSON.parse(req.postData() || '') } catch { st.bad.push('not json ' + rec.r) } }
      const f = st.faults.length && st.faults[0].r === rec.r ? st.faults.shift() : null
      if (f && f.drop) return route.abort('failed')
      if (f) res = out(f.status, f.body)
      else if (rec.r === 'brands') res = out(200, [])
      else if (rec.r === 'variants') res = out(200, [])
      else if (rec.r === 'products_all') { if (st.beforeList) { st.beforeList(st); st.beforeList = null } res = out(200, clone(st.rows)) }
      else res = save(rec.body || {})
    }
    rec.status = res.status
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) })
  }
  return { st, handle, writes: () => st.calls.filter((c) => c.method === 'POST') }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const R = '[data-spt-root]'
const D = (k) => `${R} [data-spt="${k}"]`
async function open({ w = 1280, h = 900, ar = false, screen = 'catalogue', js = BRANDS_JS, api = makeApi() } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', acceptDownloads: true })
  await ctx.clock.setFixedTime(new Date('2026-11-18T12:00:00Z'))
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    if (u.pathname === '/api/admin.php') return api.handle(route)
    if (u.pathname === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}` + REACT_LIKE })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: js })
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: pageHtml({ ar: u.searchParams.get('ar') === '1' || ar, screen: u.searchParams.get('screen') || screen }) })
  })
  await pg.goto(`${ORIGIN}/backends`)
  await pg.waitForTimeout(800)
  return { ctx, pg, errors, api }
}
async function openPrices(o = {}) {
  const t = await open(o)
  await t.pg.click('[data-sporta-prices-open]')
  await t.pg.waitForSelector(R)
  await t.pg.waitForSelector(D('body') + ' table')
  return t
}
const txt = async (pg, k) => (await pg.locator(D(k)).first().textContent()) || ''
const tick = (pg, slug) => pg.locator(`${R} tr:has(.spt-slug:text-is("${slug} · ${PRODUCTS.find((p) => p.slug === slug).category}")) input[type=checkbox]`).first().check()
const rowText = async (pg, slug) => ((await pg.locator(`${R} tbody tr:has(.spt-slug:text-is("${slug} · ${PRODUCTS.find((p) => p.slug === slug).category}"))`).first().innerText()) || '').replace(/\s+/g, ' ')
const setOp = (pg, v) => pg.selectOption(`${R} [data-spt-op]`, v)
const fillPct = (pg, v) => pg.locator(`${R} [data-spt-pct]`).fill(v)
const fillAmt = (pg, v) => pg.locator(`${R} [data-spt-amount]`).fill(v)
const waitDone = (pg) => pg.waitForFunction(() => { const r = document.querySelector('[data-spt-root]'); return r && r.getAttribute('data-busy') === '0' && /Done:|Put back:/.test(r.textContent) }, null, { timeout: 8000 })
const saved = (api) => api.writes().filter((c) => c.r === 'product_save')

// =============================================================================================== 1. the entry and the list
head('the Prices button and the list')
{
  const { pg, errors, api } = await open()
  is(await pg.locator('[data-sporta-prices-open]').count() === 1, 'one "Prices" button on the Catalogue screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-prices-open]'); return !!b.closest('.admin-page-header') && b.textContent.trim() === 'Prices' }), 'it sits in the Catalogue header and reads "Prices"')
  await pg.goto(`${ORIGIN}/backends?screen=orders`); await pg.waitForTimeout(700)
  is(await pg.locator('[data-sporta-prices-open]').count() === 0, 'no "Prices" button on the Orders screen')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  void api
}
{
  const { pg, errors, api } = await openPrices()
  const body = await txt(pg, 'body')
  is(PRODUCTS.every((p) => body.includes(p.slug)), 'every product is in the list (' + PRODUCTS.length + ')')
  const air = await rowText(pg, 'air-max-90')
  is(/42\.000/.test(air) && /35\.500/.test(air) && /15\.5%/.test(air), 'air-max-90: original 42.000, sale 35.500, 15.5% off', air)
  is((air.match(/35\.500/g) || []).length >= 2, '... and it sells at 35.500 now (its sale window holds on the fixed day)', air)
  is(/on sale/.test(air), '... and says it is on sale', air)
  const tot = await txt(pg, 'totals')
  is(/Shown: 6 products/.test(tot) && /original total 130\.750/.test(tot) && /selling total 124\.250/.test(tot) && /sales save 6\.500/.test(tot), 'the totals line: 6 products, original 130.750, selling 124.250, sales save 6.500', tot)
  is(await pg.locator(`${R} [data-spt-bulk]`).count() === 2, 'tick all shown / untick all')
  await tick(pg, 'run-shorts'); await tick(pg, 'hidden-cap')
  const tot2 = await txt(pg, 'totals')
  is(/Ticked: 2 products/.test(tot2) && /original total 16\.250/.test(tot2), 'ticking two products adds a ticked totals line (original 16.250)', tot2)
  // filters
  await pg.fill(`${R} [data-spt-q]`, 'AIR')
  is((await pg.locator(`${R} tbody tr`).count()) === 2, 'search "AIR" leaves the two Air Max rows')
  is(/2 ticked are not shown by the filter/.test(await txt(pg, 'totals')), 'the two ticked products the filter hides are counted and said')
  await pg.fill(`${R} [data-spt-q]`, '')
  await pg.selectOption(`${R} [data-spt-show]`, 'sale')
  is((await pg.locator(`${R} tbody tr`).count()) === 1, '"On sale now" shows only the product whose sale is live')
  await pg.selectOption(`${R} [data-spt-show]`, 'all')
  await pg.selectOption(`${R} [data-spt-cat]`, 'shoes')
  is((await pg.locator(`${R} tbody tr`).count()) === 2, 'category "shoes" shows two products')
  await pg.selectOption(`${R} [data-spt-cat]`, '')
  await pg.selectOption(`${R} [data-spt-sort]`, 'hi')
  is(/^\s*air-max-90|air-max-90/.test(await pg.locator(`${R} tbody tr`).first().innerText()), 'sorted by original price, high to low: the 42.000 product first')
  await pg.selectOption(`${R} [data-spt-sort]`, 'new')
  await pg.click(`${R} [data-spt-bulk="none"]`)
  is((await pg.locator(`${R} tbody tr.spt-ticked`).count()) === 0, '"Untick all" clears the ticks')
  await pg.click(`${R} [data-spt-bulk="all"]`)
  is((await pg.locator(`${R} tbody tr.spt-ticked`).count()) === 6, '"Tick all shown" ticks every row shown')
  is(api.writes().length === 0, 'reading and ticking wrote nothing')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}

// =============================================================================================== 2. sale price by percent
head('% off')
{
  const { pg, errors, api } = await openPrices()
  await tick(pg, 'run-shorts'); await tick(pg, 'vanquish-tee-white'); await tick(pg, 'hidden-cap')
  is(/Fix the box above/.test(await txt(pg, 'preview')), 'no percent typed: the preview asks for it, no after columns')
  await fillPct(pg, '20')
  is(/3 will change/.test(await txt(pg, 'preview')), '20%: three products will change')
  const a = await rowText(pg, 'run-shorts'), b = await rowText(pg, 'vanquish-tee-white'), c = await rowText(pg, 'hidden-cap')
  is(/9\.000/.test(a) && /20%/.test(a), 'run-shorts 11.250 -> sale 9.000 (20%), at the 0.050 step', a)
  is(/7\.600/.test(b) && /20%/.test(b), 'vanquish-tee-white 9.500 -> sale 7.600', b)
  is(/4\.000/.test(c), 'hidden-cap 5.000 -> sale 4.000', c)
  is(/Original total of these products: 25\.750 → 25\.750\. Selling total: 25\.750 → 20\.600/.test(await txt(pg, 'preview')), 'the preview totals: original unchanged 25.750, selling 25.750 -> 20.600', await txt(pg, 'preview'))
  await pg.selectOption(`${R} [data-spt-step]`, '1')
  await fillPct(pg, '15')
  is(/9\.563/.test(await rowText(pg, 'run-shorts')), 'exact step, 15%: 11.250 -> 9.563 (9.5625 rounded to the fil)', await rowText(pg, 'run-shorts'))
  await pg.selectOption(`${R} [data-spt-step]`, '250')
  await fillPct(pg, '20')
  const q = await rowText(pg, 'vanquish-tee-white')
  is(/7\.500/.test(q) && /21\.1%/.test(q), '0.250 step: 9.500 at 20% -> 7.500, and the real share (21.1%) is shown', q)
  await fillPct(pg, '0.1'); await pg.selectOption(`${R} [data-spt-step]`, '1000')
  is(/4\.000/.test(await rowText(pg, 'hidden-cap')), 'a sale that would round up to the price is stepped down: 5.000 at 0.1% on the 1.000 step -> 4.000', await rowText(pg, 'hidden-cap'))
  await pg.selectOption(`${R} [data-spt-step]`, '50')
  await fillPct(pg, '٢٠')
  is(/3 will change/.test(await txt(pg, 'preview')) && /9\.000/.test(await rowText(pg, 'run-shorts')), 'Arabic digits (٢٠) are read as 20')
  await fillPct(pg, '12,5')
  is(/9\.850/.test(await rowText(pg, 'run-shorts')), 'a decimal comma is read: 12,5% of 11.250 -> 9.850 (9.84375 at the 0.050 step)', await rowText(pg, 'run-shorts'))
  for (const bad of ['0', '96', '-5', 'abc', '']) { await fillPct(pg, bad); is(/Fix the box above/.test(await txt(pg, 'preview')) && !(await pg.locator(`${R} [data-spt="apply"]`).count()), `"${bad}" is not a percent: no preview, no Apply`) }
  // a product already on sale is overwritten, dates kept
  await fillPct(pg, '10'); await tick(pg, 'air-max-90')
  const air = await rowText(pg, 'air-max-90')
  is(/37\.800/.test(air) && /10%/.test(air), 'air-max-90 (on sale 35.500) at 10% -> 37.800', air)
  // dates
  await pg.selectOption(`${R} [data-spt-dates]`, 'set')
  await pg.fill(`${R} [data-spt-from]`, '2026-12-05T10:00'); await pg.fill(`${R} [data-spt-to]`, '2026-12-01T10:00')
  is(/not valid, or the sale ends before it starts/.test(await txt(pg, 'preview')) && !(await pg.locator(`${R} [data-spt="apply"]`).count()), 'a sale that ends before it starts is refused before anything is sent')
  await pg.fill(`${R} [data-spt-to]`, '2026-12-31T23:30')
  is(await pg.locator(`${R} [data-spt="apply"]`).count() === 1, 'valid dates: Apply is offered')
  is(api.writes().length === 0, 'nothing was written while editing')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}

// =============================================================================================== 3. apply, confirm, bodies, undo
head('apply, the second click, the bodies and undo')
{
  const { pg, errors, api } = await openPrices()
  await tick(pg, 'run-shorts'); await tick(pg, 'long-desc-hoodie'); await tick(pg, 'air-max-90')
  await fillPct(pg, '20')
  await pg.selectOption(`${R} [data-spt-dates]`, 'set')
  await pg.fill(`${R} [data-spt-from]`, '2026-12-01T10:00'); await pg.fill(`${R} [data-spt-to]`, '2026-12-31T23:30')
  await pg.click(D('apply'))
  is(api.writes().length === 0, 'the first click on Apply sends nothing (it asks to confirm)')
  is(/changes live prices on the shop for 3 products/.test(await txt(pg, 'preview')) && await pg.locator(D('yes')).count() === 1, 'the confirmation names the number of products and offers "Yes, change 3 products now"')
  await pg.click(D('yes'))
  await waitDone(pg)
  const w = saved(api)
  is(w.length === 3, 'one product_save per changed product (3)', String(w.length))
  const by = (slug) => w.map((c) => c.body).find((b) => b.slug === slug)
  const rs = by('run-shorts')
  is(rs && rs.price === '11.250' && rs.sale_price === '9.000' && rs.sale_starts_at === '2026-12-01 07:00:00' && rs.sale_ends_at === '2026-12-31 20:30:00', 'run-shorts body: price 11.250, sale 9.000, dates typed in Kuwait time stored 3 hours earlier (UTC)', JSON.stringify(rs))
  is(rs && typeof rs.featured === 'boolean' && typeof rs.active === 'boolean' && Number.isInteger(rs.featured_sort) && rs.id === 1, 'featured and active go as booleans, featured_sort and id as numbers (the strings of products_all are converted)')
  const hd = by('long-desc-hoodie'), orig = PRODUCTS.find((p) => p.slug === 'long-desc-hoodie')
  is(hd && hd.desc_en === orig.desc_en && hd.price === '24.000' && hd.sale_price === '19.200', 'the 300-character description is sent exactly as read (the server only refuses a changed long text)', hd && hd.sale_price)
  is(api.st.bad.length === 0, 'no unknown route, missing header or malformed body', api.st.bad.join(' | '))
  const rep = await txt(pg, 'report')
  is(/Done: 3 saved, 0 skipped, 0 failed\./.test(rep), 'the report says 3 saved', rep)
  is((await pg.locator(`${R} tbody tr.spt-ticked`).count()) === 0, 'the ticks are cleared after a run (a second click cannot apply the same change twice)')
  is(/Reload the Catalogue/.test(rep), 'it tells the owner to reload the Catalogue page')
  is(/11\.250/.test(await rowText(pg, 'run-shorts')) && /9\.000/.test(await rowText(pg, 'run-shorts')), 'the list shows the saved prices')
  // CSV
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click(D('csv'))])
  const csv = readFileSync(await dl.path(), 'utf8')
  is(/^\ufeffid,slug,name_en/.test(csv) && /"run-shorts"/.test(csv) && /"9\.000"/.test(csv) && /"saved"/.test(csv), 'the CSV has before, after and the result', csv)
  // undo
  api.st.calls.length = 0
  await pg.click(D('undo'))
  await waitDone(pg)
  const u = saved(api)
  const ur = u.map((c) => c.body).find((b) => b.slug === 'run-shorts')
  is(u.length === 3 && ur && ur.sale_price === null && ur.sale_starts_at === null && ur.price === '11.250', 'Undo puts the before values back (no sale on run-shorts), one save per product', JSON.stringify(ur))
  const air = u.map((c) => c.body).find((b) => b.slug === 'air-max-90')
  is(air && air.sale_price === '35.500' && air.sale_starts_at === '2026-11-01 00:00:00' && air.sale_ends_at === '2026-11-30 23:59:00', 'air-max-90 gets its old sale price AND old dates back', JSON.stringify(air))
  is(/Put back: 3 restored, 0 skipped, 0 failed\./.test(await txt(pg, 'report')), 'the report says 3 restored')
  is(await pg.locator(D('undo')).count() === 0, 'no second Undo')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}

// =============================================================================================== 4. the stale list, refusals, 401, a dropped connection
head('a changed product, a refusal, 401, a dropped connection')
{
  const { pg, api } = await openPrices()
  await tick(pg, 'run-shorts'); await tick(pg, 'hidden-cap'); await tick(pg, 'vanquish-tee-white')
  await fillPct(pg, '20')
  await pg.click(D('apply'))
  api.st.beforeList = (st) => { st.rows.find((r) => r.slug === 'hidden-cap').price = '6.000'; st.rows.splice(st.rows.findIndex((r) => r.slug === 'vanquish-tee-white'), 1) }
  api.st.calls.length = 0
  await pg.click(D('yes')); await waitDone(pg)
  is(saved(api).length === 1 && saved(api)[0].body.slug === 'run-shorts', 'a product whose price changed since the preview, and one deleted since, are NOT written; the other is', saved(api).map((c) => c.body.slug).join())
  const rep = await txt(pg, 'report')
  is(/Done: 1 saved, 2 skipped, 0 failed\./.test(rep) && /changed since this list was opened/.test(rep) && /no longer exists/.test(rep), 'the report names both skips and why', rep)
}
{
  const { pg, api } = await openPrices()
  await tick(pg, 'run-shorts'); await tick(pg, 'hidden-cap')
  await fillPct(pg, '20'); await pg.click(D('apply'))
  api.st.calls.length = 0
  api.st.faults.push({ r: 'product_save', status: 400, body: { error: 'sale_not_lower' } })
  await pg.click(D('yes')); await waitDone(pg)
  is(saved(api).length === 2 && /Done: 1 saved, 0 skipped, 1 failed\./.test(await txt(pg, 'report')) && /the sale price must be lower than the price/.test(await txt(pg, 'report')), 'a refusal is named in plain words and the next product is still tried', await txt(pg, 'report'))
}
{
  const { pg, api } = await openPrices()
  await tick(pg, 'run-shorts'); await tick(pg, 'hidden-cap'); await tick(pg, 'air-max')
  await fillPct(pg, '20'); await pg.click(D('apply'))
  api.st.calls.length = 0
  api.st.faults.push({ r: 'product_save', status: 401, body: { error: 'not_signed_in' } })
  await pg.click(D('yes')); await waitDone(pg)
  is(saved(api).length === 1 && /signed out/.test(await txt(pg, 'report')) && /Done: 0 saved, 0 skipped, 3 failed\./.test(await txt(pg, 'report')), '401: it stops, writes nothing more, and says to sign in again', await txt(pg, 'report'))
}
{
  const { pg, api } = await openPrices()
  await tick(pg, 'run-shorts'); await tick(pg, 'hidden-cap')
  await fillPct(pg, '20'); await pg.click(D('apply'))
  api.st.calls.length = 0
  api.st.faults.push({ r: 'product_save', drop: true })
  await pg.click(D('yes')); await waitDone(pg)
  is(/connection was lost/.test(await txt(pg, 'report')) && /Done: 0 saved, 0 skipped, 2 failed\./.test(await txt(pg, 'report')), 'a dropped connection stops the run and says so', await txt(pg, 'report'))
}

// =============================================================================================== 5. fixed amounts
head('raise or lower by an amount')
{
  const { pg, api } = await openPrices()
  await setOp(pg, 'raise')
  await tick(pg, 'run-shorts'); await tick(pg, 'air-max-90')
  await fillAmt(pg, '+1.000')
  const a = await rowText(pg, 'run-shorts'), air = await rowText(pg, 'air-max-90')
  is(/12\.250/.test(a), 'run-shorts +1.000: 11.250 -> 12.250', a)
  is(/43\.000/.test(air) && /36\.350/.test(air), 'air-max-90 +1.000, sale follows its %: original 43.000, sale 36.350 (35.500/42.000 of 43.000, at 0.050)', air)
  await pg.selectOption(`${R} [data-spt-follow]`, 'keep')
  is(/43\.000/.test(await rowText(pg, 'air-max-90')) && /35\.500/.test(await rowText(pg, 'air-max-90')), 'keeping the sale price: original 43.000, sale 35.500 unchanged')
  await fillAmt(pg, '−0.500')
  is(/10\.750/.test(await rowText(pg, 'run-shorts')) && /41\.500/.test(await rowText(pg, 'air-max-90')), 'a typographic minus (−0.500) lowers the originals')
  await fillAmt(pg, '-7')
  is(/the sale price would not stay below the new price/.test(await rowText(pg, 'air-max-90')) && /1 cannot be changed/.test(await txt(pg, 'preview')), 'a lowered price that would reach the kept sale price is BLOCKED and named')
  await pg.click(`${R} [data-spt-bulk="none"]`); await tick(pg, 'hidden-cap'); await tick(pg, 'run-shorts')
  await fillAmt(pg, '-5')
  is(/the price would be 0 or less/.test(await rowText(pg, 'hidden-cap')) && /1 will change/.test(await txt(pg, 'preview')), 'a price that would reach 0 is BLOCKED; the other product can still change')
  for (const bad of ['0', '1.2345', 'x', '']) { await fillAmt(pg, bad); is(!(await pg.locator(D('apply')).count()), `"${bad}" is not an amount: no Apply`) }
  await fillAmt(pg, '1')
  await pg.click(`${R} [data-spt-bulk="none"]`); await tick(pg, 'air-max-90')
  await pg.selectOption(`${R} [data-spt-follow]`, 'pct')
  await pg.click(D('apply')); await pg.click(D('yes')); await waitDone(pg)
  const body = saved(api)[0].body
  is(saved(api).length === 1 && body.price === '43.000' && body.sale_price === '36.350' && body.sale_starts_at === '2026-11-01 00:00:00', 'the saved body: price 43.000, sale 36.350, the sale dates kept', JSON.stringify(body))
}
head('take off sale')
{
  const { pg, api } = await openPrices()
  await setOp(pg, 'off')
  await tick(pg, 'air-max-90'); await tick(pg, 'run-shorts')
  is(/1 will change/.test(await txt(pg, 'preview')) && /1 unchanged/.test(await txt(pg, 'preview')), 'one product has a sale to take off, the other is unchanged')
  await pg.click(D('apply')); await pg.click(D('yes')); await waitDone(pg)
  const b = saved(api)[0].body
  is(saved(api).length === 1 && b.slug === 'air-max-90' && b.sale_price === null && b.sale_starts_at === null && b.sale_ends_at === null && b.price === '42.000', 'the sale price and both dates are cleared, the price untouched', JSON.stringify(b))
}

// =============================================================================================== 6. the editor box
head('the % off box of the product editor')
{
  const { pg, errors } = await open({ screen: 'editor' })
  is(await pg.locator('[data-sporta-pct-box]').count() === 1, 'one % off box in the editor form')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-pct-box]'), g = document.querySelector('#fx-sale').closest('.grid'); return b.parentElement === g && b.previousElementSibling === document.querySelector('#fx-sale').closest('label') }), 'it sits right after the Sale price box, in the same grid')
  await pg.fill('#fx-reg', '10.000')
  await pg.fill('[data-pb="pct"]', '15')
  is(await pg.inputValue('#fx-sale') === '8.500', '15% of 10.000: the Sale price box is filled with 8.500', await pg.inputValue('#fx-sale'))
  is(await pg.evaluate(() => window.__ev.sale > 0 && !document.getElementById('fx-from').disabled), 'the fill went through an input event (the form followed: the sale dates box woke up)')
  is(/8\.500 KWD · 15% off/.test(await pg.textContent('[data-pb="note"]')), 'the note says 8.500 KWD, 15% off')
  await pg.fill('#fx-sale', '7.5')
  is(await pg.inputValue('[data-pb="pct"]') === '25', 'typing a sale price of 7.5 shows 25 in the % box', await pg.inputValue('[data-pb="pct"]'))
  await pg.fill('[data-pb="pct"]', '12.5')
  is(await pg.inputValue('#fx-sale') === '8.750', '12.5% of 10.000 -> 8.750', await pg.inputValue('#fx-sale'))
  await pg.fill('#fx-reg', '20.000')
  is(await pg.inputValue('#fx-sale') === '17.500', 'changing the regular price re-fills the sale price from the same %', await pg.inputValue('#fx-sale'))
  await pg.selectOption('[data-pb="step"]', '250')
  is(await pg.inputValue('#fx-sale') === '17.500', 'the 0.250 step: 17.500 stays')
  await pg.fill('#fx-reg', '9.500'); await pg.fill('[data-pb="pct"]', '20')
  is(await pg.inputValue('#fx-sale') === '7.500', '9.500 at 20% on the 0.250 step -> 7.500', await pg.inputValue('#fx-sale'))
  await pg.fill('[data-pb="pct"]', '٣٠')
  is(await pg.inputValue('#fx-sale') === '6.750', 'Arabic digits in the box (٣٠): 9.500 at 30% -> 6.750 (6.650 at 0.250 step = 6.750)', await pg.inputValue('#fx-sale'))
  await pg.fill('[data-pb="pct"]', '99')
  is(/A percent from 0\.1 to 95/.test(await pg.textContent('[data-pb="note"]')) && await pg.inputValue('#fx-sale') === '6.750', 'a percent above 95 is refused and the sale price is left alone')
  await pg.fill('#fx-reg', ''); await pg.fill('[data-pb="pct"]', '10')
  is(/Enter the regular price first/.test(await pg.textContent('[data-pb="note"]')), 'a percent with no regular price asks for the regular price')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await open({ screen: 'onebox' })
  is(await pg.locator('[data-sporta-pct-box]').count() === 0, 'a form without a Sale price box gets no % off box')
}
{
  const { pg } = await open({ screen: 'editor', ar: true })
  is(await pg.evaluate(() => document.querySelector('[data-sporta-pct-box]').getAttribute('lang')) === 'ar' && /نسبة التخفيض/.test(await pg.textContent('[data-sporta-pct-box]')), 'the box speaks Arabic in the Arabic admin')
}

head('the % off box of the New product form')
{
  const { pg, errors } = await open()
  await pg.click('[data-sporta-np-open]'); await pg.waitForSelector('[data-sporta-newproduct]')
  const N = (k) => `[data-sporta-newproduct] [data-spn="${k}"]`
  is(await pg.locator(N('sale-pct')).count() === 1, 'the New product form has a % off box')
  await pg.fill(N('sale-pct'), '15')
  is(await pg.inputValue(N('sale')) === '', 'a percent with no price yet leaves the sale price empty')
  await pg.fill(N('price'), '10.000'); await pg.fill(N('sale-pct'), '15')
  is(await pg.inputValue(N('sale')) === '8.500', '15% of 10.000 fills the sale price with 8.500', await pg.inputValue(N('sale')))
  await pg.fill(N('sale-pct'), '٢٠')
  is(await pg.inputValue(N('sale')) === '8.000', 'Arabic digits (٢٠): 8.000', await pg.inputValue(N('sale')))
  await pg.fill(N('price'), '9.500'); await pg.fill(N('sale-pct'), '12.5')
  is(await pg.inputValue(N('sale')) === '8.300', '12.5% of 9.500 -> 8.3125, at the 0.050 step 8.300', await pg.inputValue(N('sale')))
  await pg.fill(N('sale-pct'), '0.1')
  is(await pg.inputValue(N('sale')) === '9.450', '0.1% of 9.500 would round back up to the price: it is stepped down to 9.450 (always below the price)', await pg.inputValue(N('sale')))
  await pg.fill(N('price'), '0.040'); await pg.fill(N('sale-pct'), '95')
  is(await pg.inputValue(N('sale')) === '9.450', 'a price too small to leave a positive sale price leaves the sale price alone', await pg.inputValue(N('sale')))
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}

// =============================================================================================== 7. Arabic, phone, keyboard
head('Arabic, a phone, the keyboard')
{
  const { pg, errors } = await openPrices({ ar: true })
  is(await pg.evaluate(() => document.querySelector('[data-spt-root]').getAttribute('dir')) === 'rtl', 'the dialog is right to left in the Arabic admin')
  is(/الأسعار/.test(await pg.textContent(R)) && /مجموع الأصلي/.test(await txt(pg, 'totals')), 'Arabic title and totals line')
  await tick(pg, 'run-shorts'); await fillPct(pg, '٢٠')
  is(/9\.000/.test(await rowText(pg, 'run-shorts')), 'Arabic digits work in the Arabic admin too')
  await pg.keyboard.press('Escape')
  is(await pg.locator(R).count() === 0, 'Escape closes the dialog')
  is(await pg.locator('#spt-style').count() === 1, 'one style element')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg, errors } = await openPrices({ w: 390, h: 800 })
  const sw = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, dlg: document.querySelector('.spt-dlg').scrollWidth, dlgw: document.querySelector('.spt-dlg').clientWidth }))
  is(sw.doc <= sw.win + 1 && sw.dlg <= sw.dlgw + 1, 'no sideways scroll at 390 px', JSON.stringify(sw))
  const small = await pg.evaluate(() => [...document.querySelectorAll('.spt-dlg button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim()))
  is(small.length === 0, 'every button is at least 44 px tall', small.join())
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await openPrices()
  await tick(pg, 'run-shorts')
  const act = await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-spt-tick'))
  is(act === '1', 'the keyboard focus stays on the ticked box after the list redraws', String(act))
  await pg.evaluate(() => { const b = document.querySelector('[data-spt-root]'); b.querySelector('[data-spt-bulk="none"]').focus() })
  await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Tab')
  is(await pg.evaluate(() => !!document.activeElement.closest('[data-spt-root]')), 'Tab stays inside the dialog')
}
{
  const api = makeApi()
  const t = await open({ api })
  api.st.faults.push({ r: 'products_all', status: 500, body: { error: 'x' } })
  await t.pg.click('[data-sporta-prices-open]'); await t.pg.waitForSelector(R)
  await t.pg.waitForFunction(() => /Could not read/.test(document.querySelector('[data-spt-root]').textContent))
  is(await t.pg.locator(`${R} button:text-is("Try again")`).count() === 1, 'an unreadable list says so, with Try again')
  await t.pg.click(`${R} button:text-is("Try again")`)
  await t.pg.waitForSelector(D('body') + ' table')
  is(true, 'Try again reads the list')
}

// =============================================================================================== 8. mutations
head('mutations (each must turn the suite red)')
async function mutant(name, edit, probe) {
  const js = edit(BRANDS_JS)
  if (js === BRANDS_JS) { is(false, `${name}: the edit did not apply`); return }
  const out = await probe(js)
  is(out, `${name}: caught`)
}
await mutant('no second click (Apply writes at once)', (s) => s.replace("ap.addEventListener('click', function () { S.confirm = true; draw(); var y = q('yes'); if (y) y.focus() })", "ap.addEventListener('click', function () { applyNow() })"), async (js) => {
  const { pg, api } = await openPrices({ js })
  await tick(pg, 'run-shorts'); await fillPct(pg, '20'); await pg.click(D('apply')); await pg.waitForTimeout(300)
  return api.writes().length > 0
})
await mutant('no re-read guard (a stale preview overwrites)', (s) => s.replace("if (!same(before(view(row)), c.from)) { skipped.push({ c: c, key: 'r_changed' }); next(); return }", ''), async (js) => {
  const { pg, api } = await openPrices({ js })
  await tick(pg, 'hidden-cap'); await fillPct(pg, '20'); await pg.click(D('apply'))
  api.st.beforeList = (st) => { st.rows.find((r) => r.slug === 'hidden-cap').price = '6.000' }
  await pg.click(D('yes')); await waitDone(pg)
  return saved(api).length === 1
})
await mutant('featured sent as the database string', (s) => s.replace("featured: !!Number(row.featured), featured_sort: Number(row.featured_sort) || 0,\n      category: row.category == null ? null : row.category, brand_slug: row.brand_slug == null ? '' : row.brand_slug,\n      image: row.image == null || String(row.image).trim() === ''", "featured: String(row.featured), featured_sort: Number(row.featured_sort) || 0,\n      category: row.category == null ? null : row.category, brand_slug: row.brand_slug == null ? '' : row.brand_slug,\n      image: row.image == null || String(row.image).trim() === ''"), async (js) => {
  const { pg, api } = await openPrices({ js })
  await tick(pg, 'run-shorts'); await fillPct(pg, '20'); await pg.click(D('apply')); await pg.click(D('yes')); await waitDone(pg)
  return /1 failed/.test(await txt(pg, 'report'))
})
await mutant('ticks kept after a run', (s) => s.replace("    S.undo = kind === 'apply' && saved.length ? saved : null\n    S.sel = {}", "    S.undo = kind === 'apply' && saved.length ? saved : null"), async (js) => {
  const { pg } = await openPrices({ js })
  await tick(pg, 'run-shorts'); await fillPct(pg, '20'); await pg.click(D('apply')); await pg.click(D('yes')); await waitDone(pg)
  return (await pg.locator(`${R} tbody tr.spt-ticked`).count()) > 0
})
await mutant('a sale that rounds up to the price is not stepped down', (s) => s.replace('if (x >= ceil) x = ceil - step', ''), async (js) => {
  const { pg } = await openPrices({ js })
  await tick(pg, 'hidden-cap'); await fillPct(pg, '0.1'); await pg.selectOption(`${R} [data-spt-step]`, '1000')
  return !/4\.000/.test(await rowText(pg, 'hidden-cap'))
})
await mutant('the % box does not fire an input event', (s) => s.replace("try { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) } finally { boxBusy = false }", "try { set.call(input, value) } finally { boxBusy = false }"), async (js) => {
  const { pg } = await open({ screen: 'editor', js })
  await pg.fill('#fx-reg', '10.000'); await pg.fill('[data-pb="pct"]', '15')
  return await pg.evaluate(() => document.getElementById('fx-from').disabled === true)
})
await mutant('Kuwait time stored as typed (no 3 hour shift)', (s) => s.replace('- 3 * 3600 * 1000)', '- 0)'), async (js) => {
  const { pg, api } = await openPrices({ js })
  await tick(pg, 'run-shorts'); await fillPct(pg, '20'); await pg.selectOption(`${R} [data-spt-dates]`, 'set'); await pg.fill(`${R} [data-spt-from]`, '2026-12-01T10:00')
  await pg.click(D('apply')); await pg.click(D('yes')); await waitDone(pg)
  return saved(api)[0].body.sale_starts_at === '2026-12-01 10:00:00'
})

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
