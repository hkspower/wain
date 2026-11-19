// SIZES-1118 (owner, 2026-11-18: "improve sizes selecter at backends"): the sizes picker of /backends, in a real browser.
//
//   npm run test:admin-sizes-selector   (rig-free: no database, no PHP; the admin API is a fake answered by route interception that
//                                        validates like the real variants_create; the REAL add-on file, real Tailwind and the real
//                                        public/sporta-admin-knet.css are on the page)
//
// What the owner had: a size picker with seven clothing chips and one box for "another size", in the New product screen only. A product
// that already existed could NOT get a size anywhere in /backends (the Stock screen changes counts of sizes that exist; variants_create
// had one caller, the New product screen), so a product with no size rows stayed "untracked": orderable with no size and without limit.
// What is asserted:
//   the picker (New product and Add sizes alike)
//     - three quick sets (clothes S-2XL, clothes S-5XL, one size) that ADD the sizes not yet chosen and never remove one;
//       SIZES-1119 (inventory scan INV-02): ONLY the nine sizes the order path takes (S M L XL 2XL 3XL 4XL 5XL ONE) can be picked or typed;
//       XS, shoe sizes and kids' sizes used to be offered, created and then refused at checkout (invalid_size); "xxl" folds into 2XL;
//     - rows are listed in size order whatever order they were picked in (S M L XL 2XL 3XL 4XL 5XL, then ONE);
//     - "several at once": "S:4 M:6 L" adds three sizes with the counts, all or nothing, a bad token adds nothing and is named;
//     - "same count for every size" fills every row (Arabic digits read); a total line; Enter moves to the next size's box;
//     - a size typed in Arabic digits ("٤٤") is the plain one; "Clear all" empties the choice; no change to the yes/no choice of New product;
//   Add sizes (a product that exists)
//     - a button in the Catalogue header and in the Stock screen's header, once each, nowhere else; MUTATION: without the mount call no button;
//     - the product list, the sizes it has now (with counts, a sold-out size marked), the sizes it has ticked off and disabled in the picker,
//       and a product with no sizes says it is not counted and warns that adding sizes starts counting;
//     - ONE write, variants_create, with exactly the new sizes and counts (never an existing size); nothing is written for an empty or
//       invalid choice; the list then shows the new sizes; MUTATION: if a quick set added a size the product has, the body would carry it;
//     - failures: an older server (route 404) disables saving and says why; size_exists re-reads and ticks the size off; 401, a dropped
//       connection and an unreadable catalogue each say so, with Try again where it helps;
//   Arabic RTL, no sideways scroll at 390, 44 px targets on a phone, Escape closes, one style element, no page errors.
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------------------------------------------------------ the page
const STOCK = '<section class="admin-page"><div class="admin-page-layout"><header class="admin-page-header inventory-heading"><h1 class="text-2xl font-bold text-slate-900">Stock</h1><div class="inventory-heading__actions"><span class="inventory-live-status">Live</span><button type="button" class="inventory-refresh">Refresh</button><button type="button" class="inventory-refresh">Export CSV</button></div></header></div></section>'
const SCREENS = { catalogue: SCREEN, orders: ORDERS, stock: STOCK }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'sizes-selector-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ ar, screen }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`

// ------------------------------------------------------------------------------------------------ the fake admin API
// The size rows the Stock list answers, as the real route shapes them (only slug, size and stock are read).
const VARIANTS = [
  { sku: 'RUN-SHORTS-S', slug: 'run-shorts', size: 'S', stock: 5 }, { sku: 'RUN-SHORTS-M', slug: 'run-shorts', size: 'M', stock: 0 }, { sku: 'RUN-SHORTS-L', slug: 'run-shorts', size: 'L', stock: 3 },
  { sku: 'AIR-MAX-90-XL', slug: 'air-max-90', size: 'XL', stock: 2 }, { sku: 'AIR-MAX-90-2XL', slug: 'air-max-90', size: '2XL', stock: 4 },
]
// the only sizes the real variants_create takes (store.php STORE_SIZES) and the spellings it folds into them (store_size_canonical)
const NINE = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE']
const ALIAS = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', XXXXXL: '5XL' }
function makeApi({ route = 'yes' } = {}) {
  const st = { variants: clone(VARIANTS), calls: [], faults: {}, route, signedIn: true, bad: [], delay: 6 }
  const out = (status, body) => ({ status, body })
  const fault = (r) => (st.faults[r] || []).shift()
  function create(rec) {
    if (rec.method === 'GET') return st.route === 'yes' ? out(405, { error: 'method_not_allowed' }) : out(404, { error: 'not_found' })
    if (st.route !== 'yes') return out(404, { error: 'not_found' })
    const b = rec.body || {}
    if (!PRODUCTS.some((r) => r.slug === b.slug)) return out(404, { error: 'product_not_found' })
    if (!Array.isArray(b.sizes) || !b.sizes.length || b.sizes.length > 20) return out(400, { error: 'invalid_sizes' })
    const seen = new Set()
    for (const s of b.sizes) {
      if (!/^[A-Za-z0-9][A-Za-z0-9.]{0,3}$/.test(String(s.size))) return out(400, { error: 'invalid_size' })
      const up = String(s.size).toUpperCase(), k = ALIAS[up] || up
      if (!NINE.includes(k)) return out(400, { error: 'invalid_size' })
      if (!Number.isInteger(s.stock) || s.stock < 0 || s.stock > 999999) return out(400, { error: 'invalid_stock' })
      if (seen.has(k)) return out(400, { error: 'duplicate_size' })
      seen.add(k)
      if (st.variants.some((v) => v.slug === b.slug && v.size === k)) return out(409, { error: 'size_exists' })
    }
    const made = b.sizes.map((s) => { const up = String(s.size).toUpperCase(), k = ALIAS[up] || up; return { sku: (b.slug + '-' + k).toUpperCase().slice(0, 30), slug: b.slug, size: k, stock: s.stock } })
    st.variants.push(...made)
    return out(200, { slug: b.slug, variants: made })
  }
  async function handle(route) {
    const req = route.request()
    const u = new URL(req.url())
    const rec = { r: u.searchParams.get('r') || '', method: req.method(), body: null }
    st.calls.push(rec)
    await sleep(st.delay)
    let res
    if (!['brands', 'products_all', 'variants', 'variants_create'].includes(rec.r)) { st.bad.push('unknown route ' + rec.r); res = out(404, { error: 'not_found' }) }
    else if (!st.signedIn) res = out(401, { error: 'not_signed_in' })
    else {
      const hdr = req.headers()
      if (hdr['x-sporta-admin'] !== '1') st.bad.push('missing X-Sporta-Admin on ' + rec.r)
      if (rec.method === 'POST') { try { rec.body = JSON.parse(req.postData() || '') } catch { st.bad.push('not json ' + rec.r) } }
      const f = rec.r === 'variants_create' && rec.method === 'GET' ? null : fault(rec.r)
      if (f) { if (f.drop) return route.abort('failed'); res = out(f.status, f.body || { error: 'x' }) }
      else if (rec.r === 'brands') res = out(200, [])
      else if (rec.r === 'products_all') res = out(200, clone(PRODUCTS))
      else if (rec.r === 'variants') res = out(200, clone(st.variants))
      else res = create(rec)
    }
    rec.status = res.status
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) })
  }
  const fail = (r, ...list) => { st.faults[r] = (st.faults[r] || []).concat(list) }
  const writes = () => st.calls.filter((c) => c.method === 'POST')
  return { st, handle, fail, writes }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ROOTSEL = '[data-sporta-newproduct]'
const D = (k) => `${ROOTSEL} [data-spn="${k}"]`
async function open({ w = 1280, h = 900, ar = false, screen = 'catalogue', js = BRANDS_JS, api = makeApi() } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  pg.on('dialog', (d) => d.accept())
  await pg.addInitScript(() => { window.SPORTA_NEWPRODUCT = { paceMs: 5, backoffMs: 30 } })
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    if (u.pathname === '/api/admin.php') return api.handle(route)
    if (u.pathname === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}` })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: js })
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: pageHtml({ ar: u.searchParams.get('ar') === '1' || ar, screen: u.searchParams.get('screen') || screen }) })
  })
  await pg.goto(`${ORIGIN}/backends`)
  await pg.waitForTimeout(700)
  return { ctx, pg, errors, api }
}
// "Add sizes" opened from the Catalogue header, with the catalogue and the stock list read
async function openSizes(o = {}) {
  const t = await open(o)
  t.api.st.calls.length = 0
  await t.pg.click('[data-sporta-np-sizes]')
  await t.pg.waitForSelector(ROOTSEL)
  await t.pg.waitForFunction(() => { const s = document.querySelector('[data-spn="sz-product"]'); return s && !s.disabled }, null, { timeout: 4000 }).catch(() => {})
  return t
}
const pick = async (pg, slug) => { await pg.selectOption(D('sz-product'), slug); await pg.waitForSelector(D('size-sets'), { state: 'visible' }) }
const rowsText = (pg) => pg.locator(`${ROOTSEL} .spn-sizerow label`).allTextContents()
const stockOf = (pg, s) => pg.locator(D('stock-' + s)).first().inputValue()
const type = (pg, k, v) => pg.locator(D(k)).first().fill(v)
const txt = async (pg, k) => (await pg.locator(D(k)).first().textContent()) || ''
const chipOn = (pg, s) => pg.locator(D('size-chip-' + s)).first().getAttribute('aria-pressed')
const writesOf = (api) => api.st.calls.filter((c) => c.method === 'POST')

// =============================================================================================== 1. the entries
head('the "Add sizes" button')
{
  const { pg, errors, api } = await open()
  const count = () => pg.locator('[data-sporta-np-sizes]').count()
  is(await count() === 1, 'one "Add sizes" button on the Catalogue screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-np-sizes]'); return !!b.closest('.admin-page-header') && b.textContent.trim() === 'Add sizes' && !!b.closest('.admin-page-header').querySelector('[data-sporta-np-open]') }), 'it sits in the Catalogue header beside "New product" and reads "Add sizes"')
  await pg.evaluate(() => window.fx.go('orders')); await pg.waitForTimeout(700)
  is(await count() === 0, 'no button on Orders')
  await pg.evaluate(() => window.fx.go('stock')); await pg.waitForTimeout(800)
  is(await count() === 1, 'one button on the Stock screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-np-sizes]'); return b.parentNode.classList.contains('inventory-heading__actions') && b.classList.contains('inventory-refresh') && b.textContent.trim() === 'Add sizes' }), 'in its header actions, in the same style as Refresh and Export CSV')
  await pg.evaluate(() => window.fx.go('catalogue')); await pg.waitForTimeout(800)
  is(await count() === 1, 'back on Catalogue: one button (not two)')
  is(api.st.calls.every((c) => c.method === 'GET') && !writesOf(api).length, 'nothing is written by merely showing the button')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  const cut = BRANDS_JS.replace('ensure(); ensureSizes()', 'ensure()')
  is(cut !== BRANDS_JS, 'MUTATION set-up: the mount call is in the file')
  const m = await open({ js: cut })
  is(await m.pg.locator('[data-sporta-np-sizes]').count() === 0 && await m.pg.locator('[data-sporta-np-open]').count() === 1, 'MUTATION: without the mount call there is no "Add sizes" button')
  await m.ctx.close(); await pg.context().close()
}

// =============================================================================================== 2. a product that has sizes
head('Add sizes: a product that has sizes')
{
  const { pg, errors, api } = await openSizes()
  is(await pg.locator(D('tab-one')).count() === 0, 'the dialog has no New product / Many products tabs')
  is((await pg.locator(`${ROOTSEL} .spn-title`).textContent()) === 'Add sizes to a product', 'its title is "Add sizes to a product"')
  is(await pg.locator(D('sz-product') + ' option').count() === PRODUCTS.length + 1, 'the product list holds every catalogue product and a "Choose" line', String(await pg.locator(D('sz-product') + ' option').count()))
  is(await pg.locator(D('size-sets')).isVisible() === false, 'the picker is hidden until a product is chosen')
  is(await pg.locator(D('sz-save')).isDisabled() && (await txt(pg, 'sz-save')).trim() === 'Add sizes (0)', 'Save is off and says "Add sizes (0)"')
  is(await pg.locator(D('sizes-mode-none')).count() === 0, 'there is no "No sizes" choice here (the screen only adds sizes)')
  await pick(pg, 'run-shorts')
  is(eq(await pg.locator(D('sz-have') + ' span').allTextContents(), ['S · 5', 'M · 0', 'L · 3']), 'the sizes it has now are listed in size order with their counts')
  is(await pg.locator(D('sz-have') + ' span[data-out="1"]').count() === 1, 'a size at zero is marked (struck through)')
  for (const s of ['S', 'M', 'L']) is(await pg.locator(D('size-chip-' + s)).isDisabled() && (await txt(pg, 'size-chip-' + s)).includes('✓'), `${s} is ticked off and disabled in the picker`)
  is(await pg.locator(D('size-chip-4XL')).isEnabled() && await chipOn(pg, '4XL') === 'false', 'a size it does not have is enabled')
  is(await pg.locator(D('size-chip-XS')).count() === 0, 'there is no XS chip: the shop does not sell XS (SIZES-1119)')
  await pg.click(D('size-chip-4XL'))
  is(await chipOn(pg, '4XL') === 'true' && eq(await rowsText(pg), ['4XL']), 'choosing 4XL opens its count row')
  is(await pg.locator(D('sz-save')).isDisabled(), 'Save stays off until 4XL has a count')
  await type(pg, 'stock-4XL', '4')
  is(await pg.locator(D('sz-save')).isEnabled() && (await txt(pg, 'sz-save')).trim() === 'Add sizes (1)', 'with a count, Save is on and says "Add sizes (1)"')

  // the quick set adds the sizes it names that are free, and skips the ones the product has
  await pg.click(D('size-set-setAll'))
  is(eq(await rowsText(pg), ['XL', '2XL', '3XL', '4XL', '5XL']), 'the "Clothes S-5XL" set adds XL 2XL 3XL 5XL, skips S M L (it has them), keeps 4XL, in size order', JSON.stringify(await rowsText(pg)))
  is(await stockOf(pg, '4XL') === '4', 'the count already typed for 4XL survives the set')
  await type(pg, 'size-all', '٥')
  await pg.click(D('size-all-apply'))
  is(eq(await Promise.all(['XL', '2XL', '3XL', '4XL', '5XL'].map((s) => stockOf(pg, s))), ['5', '5', '5', '5', '5']), 'one count for every size (typed in Arabic digits) fills every row')
  is((await txt(pg, 'size-total')).trim() === 'Sizes: 5 · Pieces: 25', 'the total line reads Sizes: 5 · Pieces: 25', await txt(pg, 'size-total'))
  await type(pg, 'stock-3XL', '7')
  is((await txt(pg, 'size-total')).trim() === 'Sizes: 5 · Pieces: 27', 'and follows what is typed, without redrawing the box being typed in', await txt(pg, 'size-total'))
  await type(pg, 'stock-3XL', '5')
  api.st.calls.length = 0
  await pg.click(D('sz-save'))
  await pg.waitForFunction(() => /Sizes added/.test(document.querySelector('[data-spn="sz-status"]')?.textContent || ''), null, { timeout: 4000 })
  const w = writesOf(api)
  is(w.length === 1 && w[0].r === 'variants_create', 'one write, variants_create', JSON.stringify(w.map((c) => c.r)))
  is(eq(w[0].body, { slug: 'run-shorts', sizes: [{ size: 'XL', stock: 5 }, { size: '2XL', stock: 5 }, { size: '3XL', stock: 5 }, { size: '4XL', stock: 5 }, { size: '5XL', stock: 5 }] }), 'the body holds exactly the five NEW sizes with whole-number counts (no size it already has)', JSON.stringify(w[0].body))
  is(eq(api.st.variants.filter((v) => v.slug === 'run-shorts').map((v) => v.size + v.stock), ['S5', 'M0', 'L3', 'XL5', '2XL5', '3XL5', '4XL5', '5XL5']), 'the server now holds eight sizes for it, the old three untouched')
  is((await txt(pg, 'sz-status')).startsWith('Sizes added: 5. Product: Run Shorts.'), 'the line says how many sizes were added and to which product', await txt(pg, 'sz-status'))
  is(await pg.locator(D('sz-reload')).isVisible(), 'a "Reload the page" button appears (the Stock screen reads its list when it opens)')
  is(eq(await pg.locator(D('sz-have') + ' span').allTextContents(), ['S · 5', 'M · 0', 'L · 3', 'XL · 5', '2XL · 5', '3XL · 5', '4XL · 5', '5XL · 5']), 'the list of sizes it has now was re-read and shows all eight in order')
  is(await pg.locator(D('size-chip-4XL')).isDisabled(), 'the new sizes are ticked off in the picker')
  is(eq(await rowsText(pg), []) && await pg.locator(D('sz-save')).isDisabled(), 'the choice is empty again and Save is off')
  is(api.st.bad.length === 0, 'every call carried the admin header and was JSON', api.st.bad.join(' | '))
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

// =============================================================================================== 3. the picker itself
head('the picker: several at once, the nine sizes, order, Enter, Arabic digits')
{
  const { pg, errors, api } = await openSizes()
  await pick(pg, 'air-max-90')
  is(eq(await pg.locator(D('sz-have') + ' span').allTextContents(), ['XL · 2', '2XL · 4']), 'a product with larger sizes lists them in the shop\'s ladder order')
  await type(pg, 'size-list', 'S:4 M:6 L')
  await pg.click(D('size-list-add'))
  is(eq(await rowsText(pg), ['S', 'M', 'L']) && await stockOf(pg, 'S') === '4' && await stockOf(pg, 'M') === '6' && await stockOf(pg, 'L') === '', '"S:4 M:6 L" adds three sizes with their counts (L has none yet)')
  await type(pg, 'size-list', 's x9999')
  await pg.click(D('size-list-add'))
  is(eq(await rowsText(pg), ['S', 'M', 'L']), 'a bad token adds nothing')
  is(await pg.locator(`${ROOTSEL} .spn-err`).evaluateAll((l) => l.map((e) => e.textContent).join('|').includes('x9999')), 'and the message names the bad token (x9999)')
  await type(pg, 'size-list', 'S M')
  await pg.click(D('size-list-add'))
  is(await pg.locator(`${ROOTSEL} .spn-err`).evaluateAll((l) => l.map((e) => e.textContent).join('|').includes('already in the list')), 'sizes that are all in the list already say so')
  await pg.click(D('size-set-setAll'))
  is(eq(await rowsText(pg), ['S', 'M', 'L', '3XL', '4XL', '5XL']), 'the "Clothes S-5XL" set adds 3XL 4XL 5XL (the product has XL and 2XL); S M L were chosen already', JSON.stringify(await rowsText(pg)))
  await pg.click(D('size-set-setOne'))
  is(eq(await rowsText(pg), ['S', 'M', 'L', '3XL', '4XL', '5XL', 'ONE']), 'the "One size" set adds ONE, listed after the ladder', JSON.stringify(await rowsText(pg)))
  // SIZES-1119: a size outside the nine is refused with a sentence, never added (XS, shoe and kids sizes used to be accepted and then failed at checkout)
  const errText = () => pg.locator(`${ROOTSEL} .spn-err`).evaluateAll((l) => l.map((e) => e.textContent).join('|'))
  for (const bad of ['XS', '42', '٤٤', '4', 'XXS']) {
    await type(pg, 'size-custom', bad)
    await pg.click(D('size-add'))
    is(eq(await rowsText(pg), ['S', 'M', 'L', '3XL', '4XL', '5XL', 'ONE']) && (await errText()).includes('The shop sells only S M L XL 2XL 3XL 4XL 5XL and ONE'), `"${bad}" is refused: the shop does not sell it, and the message names the nine`, await errText())
  }
  await type(pg, 'size-list', 'M 42')
  await pg.click(D('size-list-add'))
  is(eq(await rowsText(pg), ['S', 'M', 'L', '3XL', '4XL', '5XL', 'ONE']) && (await errText()).includes('42'), 'a list with one size outside the nine adds nothing and names it (42)', await errText())
  await type(pg, 'size-custom', '3xl')
  await pg.click(D('size-add'))
  is(await errText().then((x) => x.includes('already in the list')), 'a size that is already chosen (3xl is 3XL) is refused as a duplicate')
  await pg.click(D('size-clear'))
  is(eq(await rowsText(pg), []), '"Clear all" empties the choice')
  await type(pg, 'size-custom', 'xxl')
  await pg.click(D('size-add'))
  is(eq(await rowsText(pg), []) && (await errText()).includes('already in the list'), 'xxl is the shop\'s 2XL, which this product already has: refused as one it has')
  await type(pg, 'size-custom', 'xxxl')
  await pg.click(D('size-add'))
  is(eq(await rowsText(pg), ['3XL']), 'xxxl typed is the plain size 3XL (the server folds it the same way)')
  await type(pg, 'size-custom', 'XL')
  await pg.click(D('size-add'))
  is(eq(await rowsText(pg), ['3XL']), 'a size the product already has (XL) is refused')
  await pg.click(D('size-set-setClothes'))
  is(eq(await rowsText(pg), ['S', 'M', 'L', '3XL']), 'the clothes set skips XL and 2XL (the product has them): S M L join 3XL')
  await pg.locator(D('stock-S')).focus()
  await pg.keyboard.press('Enter')
  is(await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-spn')) === 'stock-M', 'Enter in a count moves to the next size\'s count')
  await pg.locator(D('stock-3XL')).first().focus()
  const writesBefore = writesOf(api).length
  await pg.keyboard.press('Enter')
  is(writesOf(api).length === writesBefore, 'Enter in the last count writes nothing')
  // switching product with a choice made asks first (the test accepts) and starts clean
  await pick(pg, 'run-shorts')
  is(eq(await rowsText(pg), []) && await pg.locator(D('size-chip-S')).isDisabled() && await pg.locator(D('size-chip-XL')).isEnabled(), 'another product: the choice is cleared and the ticks follow the new product (XL is free here, S is ticked)')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

// =============================================================================================== 4. a product with no sizes
head('Add sizes: a product with no sizes (not counted)')
{
  const { pg, api } = await openSizes()
  await pick(pg, 'hidden-cap')
  is((await txt(pg, 'sz-none')).includes('does not count stock'), 'it says the shop does not count stock for it')
  is(await pg.locator(`${ROOTSEL} .spn-sec`).evaluate((s) => /Once it has sizes/.test(s.textContent)), 'and warns that sizes make customers choose one and the shop count each')
  await type(pg, 'size-list', 'M:2 L:3')
  await pg.click(D('size-list-add'))
  api.st.calls.length = 0
  await pg.click(D('sz-save'))
  await pg.waitForFunction(() => /Sizes added: 2/.test(document.querySelector('[data-spn="sz-status"]')?.textContent || ''), null, { timeout: 4000 })
  is(eq(writesOf(api)[0].body, { slug: 'hidden-cap', sizes: [{ size: 'M', stock: 2 }, { size: 'L', stock: 3 }] }), 'the sizes are created with their opening counts', JSON.stringify(writesOf(api)[0].body))
  is(await pg.locator(D('sz-none')).count() === 0 && eq(await pg.locator(D('sz-have') + ' span').allTextContents(), ['M · 2', 'L · 3']), 'it now lists its sizes instead of the warning')
  await pg.context().close()
}

// =============================================================================================== 5. nothing invalid is sent
head('nothing invalid is sent')
{
  const { pg, api } = await openSizes()
  await pick(pg, 'air-max')
  await pg.click(D('size-chip-M'))
  is(await pg.locator(D('sz-save')).isDisabled(), 'a size with no count: Save is off')
  await type(pg, 'stock-M', '-2')
  is(await pg.locator(D('sz-save')).isDisabled() && (await txt(pg, 'sz-status')).includes('whole number'), 'a negative count: Save is off and the status says why', await txt(pg, 'sz-status'))
  await type(pg, 'stock-M', '1.5')
  is(await pg.locator(D('sz-save')).isDisabled(), 'a count with a decimal: Save is off')
  await type(pg, 'stock-M', '1000000')
  is(await pg.locator(D('sz-save')).isDisabled(), 'a count over 999999: Save is off')
  await type(pg, 'stock-M', '٣')
  is(await pg.locator(D('sz-save')).isEnabled(), 'Arabic digits are a valid count')
  await pg.click(D('size-set-setClothes'))
  await type(pg, 'size-all', 'abc')
  await pg.click(D('size-all-apply'))
  is(await stockOf(pg, 'M') === '٣', 'a bad "same count" changes nothing')
  is(writesOf(api).length === 0, 'no write happened for any of it')
  await pg.context().close()
}

// =============================================================================================== 6. failures
head('failures')
{
  // an older server: the route is not there
  const old = await openSizes({ api: makeApi({ route: 'no' }) })
  await pick(old.pg, 'run-shorts')
  is((await txt(old.pg, 'sz-status')).includes('cannot add sizes yet'), 'an older server: the screen says it needs the next API release')
  await old.pg.click(D('size-chip-4XL')); await type(old.pg, 'stock-4XL', '3')
  is(await old.pg.locator(D('sz-save')).isDisabled() && writesOf(old.api).length === 0, 'and Save stays off, nothing is sent')
  await old.pg.context().close()

  // someone added the size meanwhile: 409, re-read, ticked off
  const race = await openSizes()
  await pick(race.pg, 'run-shorts')
  await race.pg.click(D('size-chip-4XL')); await type(race.pg, 'stock-4XL', '3')
  race.api.st.variants.push({ sku: 'RUN-SHORTS-4XL', slug: 'run-shorts', size: '4XL', stock: 9 })
  await race.pg.click(D('sz-save'))
  await race.pg.waitForFunction(() => /already has one of these sizes/.test(document.querySelector('[data-spn="sz-status"]')?.textContent || ''), null, { timeout: 4000 })
  is(await race.pg.locator(D('size-chip-4XL')).isDisabled() && eq(await rowsText(race.pg), []), 'size_exists: said so, re-read, 4XL is now ticked off and dropped from the choice')
  is(race.api.st.variants.find((v) => v.size === '4XL').stock === 9, 'and the count someone else set is untouched')
  await race.pg.context().close()

  // signed out
  const out = await openSizes()
  await pick(out.pg, 'run-shorts')
  await out.pg.click(D('size-chip-4XL')); await type(out.pg, 'stock-4XL', '3')
  out.api.st.signedIn = false
  await out.pg.click(D('sz-save'))
  await out.pg.waitForFunction(() => /signed out/.test(document.querySelector('[data-spn="sz-status"]')?.textContent || ''), null, { timeout: 4000 })
  is(await out.pg.locator(D('sz-save')).isEnabled(), 'signed out: it says so and the choice is kept so Save can be pressed again')
  out.api.st.signedIn = true
  await out.pg.click(D('sz-save'))
  await out.pg.waitForFunction(() => /Sizes added: 1/.test(document.querySelector('[data-spn="sz-status"]')?.textContent || ''), null, { timeout: 4000 })
  is(out.api.st.variants.some((v) => v.slug === 'run-shorts' && v.size === '4XL' && v.stock === 3), 'after signing in again the same press adds the size once')
  await out.pg.context().close()

  // a dropped connection
  const drop = await openSizes()
  await pick(drop.pg, 'run-shorts')
  await drop.pg.click(D('size-chip-XL')); await type(drop.pg, 'stock-XL', '3')
  drop.api.fail('variants_create', { drop: true })
  await drop.pg.click(D('sz-save'))
  await drop.pg.waitForFunction(() => /connection dropped/.test(document.querySelector('[data-spn="sz-status"]')?.textContent || ''), null, { timeout: 4000 })
  is(await drop.pg.locator(D('sz-save')).isEnabled() && await stockOf(drop.pg, 'XL') === '3', 'a dropped connection: it says so, keeps the choice and lets the owner press Save again')
  await drop.pg.context().close()

  // an unreadable catalogue, then Try again
  const bad = await open()
  bad.api.st.calls.length = 0
  bad.api.fail('products_all', { status: 500, body: { error: 'x' } })
  await bad.pg.click('[data-sporta-np-sizes]')
  await bad.pg.waitForSelector(D('sz-retry') + ':visible', { timeout: 4000 })
  is((await txt(bad.pg, 'sz-load')).includes('Could not read the catalogue') && await bad.pg.locator(D('sz-product')).isDisabled(), 'an unreadable catalogue: said so, the list stays off')
  await bad.pg.click(D('sz-retry'))
  await bad.pg.waitForFunction(() => { const s = document.querySelector('[data-spn="sz-product"]'); return s && !s.disabled }, null, { timeout: 4000 })
  is(await bad.pg.locator(D('sz-product') + ' option').count() === PRODUCTS.length + 1, 'Try again reads it and fills the list')
  await bad.pg.context().close()
}

// =============================================================================================== 7. the New product picker
head('New product: the same picker, the yes/no choice kept')
{
  const { pg, errors } = await open()
  await pg.click('[data-sporta-np-open]')
  await pg.waitForSelector(ROOTSEL)
  await pg.waitForFunction(() => document.querySelector('[data-spn="slug-info"]') != null)
  is(await pg.locator(D('sizes-mode-sizes')).count() === 1 && await pg.locator(D('sizes-mode-none')).count() === 1, 'the "has sizes / no sizes" choice is still there')
  await pg.click(D('size-chip-5XL'))
  await pg.click(D('size-set-setClothes'))
  is(eq(await rowsText(pg), ['S', 'M', 'L', 'XL', '2XL', '5XL']), '5XL picked first is listed last, after the clothes set\'s five rows (size order)')
  is(await pg.locator(D('size-chip-XS')).count() === 0 && await pg.locator(D('size-set-setShoes')).count() === 0 && await pg.locator(D('size-set-setKids')).count() === 0, 'New product offers no XS chip and no shoe or kids set (SIZES-1119)')
  await pg.check(D('sizes-mode-none'))
  is(await pg.locator(D('size-sets')).count() === 0, '"No sizes" hides the picker')
  await pg.check(D('sizes-mode-sizes'))
  is(eq(await rowsText(pg), ['S', 'M', 'L', 'XL', '2XL', '5XL']), 'and bringing it back keeps the choice')
  is(await pg.locator('style[data-sporta-newproduct-style]').count() === 1, 'one style element')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

// =============================================================================================== 8. the guard
head('the guard (a quick set must not add a size the product has)')
{
  const bug = BRANDS_JS.replace('if (!sizeOk(s) || owned(s) || has(s) >= 0) return\n        m.sizes.push', 'if (!sizeOk(s) || has(s) >= 0) return\n        m.sizes.push')
  is(bug !== BRANDS_JS, 'MUTATION set-up: the guard is in the file')
  const { pg } = await openSizes({ js: bug })
  await pick(pg, 'run-shorts')
  await pg.click(D('size-set-setClothes'))
  is((await rowsText(pg)).includes('S'), 'MUTATION: without the guard the set would add S, which the product has')
  await pg.context().close()
}

// =============================================================================================== 9. Arabic, phone
head('Arabic, and a 390 px phone')
{
  const { pg, errors } = await open({ w: 390, h: 800, ar: true })
  is((await pg.locator('[data-sporta-np-sizes]').textContent()).trim() === 'إضافة مقاسات', 'the button reads إضافة مقاسات')
  await pg.click('[data-sporta-np-sizes]')
  await pg.waitForSelector(ROOTSEL)
  await pg.waitForFunction(() => { const s = document.querySelector('[data-spn="sz-product"]'); return s && !s.disabled })
  is((await pg.locator(`${ROOTSEL} .spn-title`).textContent()) === 'إضافة مقاسات إلى منتج' && await pg.locator(ROOTSEL).getAttribute('dir') === 'rtl', 'the title is Arabic and the dialog is RTL')
  await pick(pg, 'run-shorts')
  is(await pg.locator(D('size-set-setOne')).textContent() === 'مقاس واحد' && await pg.locator(D('size-set-setAll')).textContent() === 'ملابس S–5XL', 'the quick sets are in Arabic')
  await type(pg, 'size-custom', 'XS')
  await pg.click(D('size-add'))
  is((await pg.locator(`${ROOTSEL} .spn-err`).evaluateAll((l) => l.map((e) => e.textContent).join('|'))).includes('مقاس غير مقبول'), 'a size outside the nine is refused in Arabic too')
  await pg.click(D('size-set-setAll'))
  await type(pg, 'size-all', '٣')
  await pg.click(D('size-all-apply'))
  is((await txt(pg, 'size-total')).trim() === 'المقاسات: 5 · القطع: 15', 'the total line is Arabic', await txt(pg, 'size-total'))
  const m = await pg.evaluate(() => {
    const r = document.querySelector('[data-sporta-newproduct]'), small = []
    r.querySelectorAll('button,select,input').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && b.height && (b.height < 43.5)) small.push((e.getAttribute('data-spn') || e.tagName) + ':' + Math.round(b.height)) })
    return { rootSW: r.scrollWidth, rootCW: r.clientWidth, page: document.documentElement.scrollWidth, small }
  })
  is(m.rootSW <= m.rootCW + 1 && m.page <= 391, 'no sideways scroll at 390 px', JSON.stringify(m))
  is(m.small.length === 0, 'every control is at least 44 px tall on a phone', m.small.join(', '))
  await pg.keyboard.press('Escape')
  await pg.waitForTimeout(150)
  is(await pg.locator(ROOTSEL).count() === 0, 'Escape closes the dialog (the choice made is asked about first and the test accepts)')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await pg.context().close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
