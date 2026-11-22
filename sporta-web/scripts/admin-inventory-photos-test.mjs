// PRODUCT PHOTOS IN THE INVENTORY SCREEN (owner request 2026-11-22: "add product image preview for invetory"): the photo in front of
// each product name in the Inventory table and on each card of the phone list, and the preview that opens when a photo is tapped
// (public/sporta-admin-brands.js, block "ADMIN INVENTORY PHOTOS"), in a real browser.
//
//   npm run test:admin-inventory-photos   (rig-free: no database, no PHP. The admin API is a fake answered by route interception that
//                                          answers variants and products_all like admin.php; the photo files are served (or 404) by the
//                                          same interception; the REAL add-on block is on the page, the Inventory table is drawn like
//                                          src/admin/Inventory.jsx)
//
// What is asserted:
//   placement - one photo in every row of the table and on every card of the phone list; the photo's button has the product's name
//   files     - the shop's small copy where responsive/variants.txt lists one; the product's own photo (images[0]) before the file named
//               after the slug; a listed photo that is missing falls back to the slug files; no file at all: a grey "No photo"
//   preview   - a click opens the full photo with the product's name; Escape closes and gives the focus back to the photo; a product
//               with no file says so; Close closes
//   redraw    - when React draws the rows again the photos come back, a row added later gets one, and a second drawing adds none
//   reads     - only GET requests, each with the admin header; nothing is written
//   other     - no photo on another screen; on a 390 px phone the photos are 44 px and the page does not scroll sideways; 1280 px: 44 px
//   errors    - no page error
//   MUTATIONS - the observer, the slug fallback, the small copy, the click and Escape are each cut in turn; each must turn its check red
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const ORIGIN = 'https://sporta.test'
const BEGIN = '/* ===== ADMIN INVENTORY PHOTOS - begin'
const END = '/* ===== ADMIN INVENTORY PHOTOS - end'
const BLOCK = BRANDS_JS.slice(BRANDS_JS.indexOf(BEGIN), BRANDS_JS.indexOf('*/', BRANDS_JS.indexOf(END)) + 2)
if (BRANDS_JS.indexOf(BEGIN) < 0 || BRANDS_JS.indexOf(END) < 0 || BRANDS_JS.indexOf(BEGIN) !== BRANDS_JS.lastIndexOf(BEGIN)) {
  console.log('FAIL the ADMIN INVENTORY PHOTOS block is missing or appears twice'); process.exit(1)
}

let pass = 0, fail = 0, pageErrors = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

// ------------------------------------------------------------------------------------------------ data and files
// Six rows on the screen; the stock list also knows AIR90-L, which a later step adds to the table (a size added in another session).
const VARIANTS = [
  { sku: 'VAN-TEE-M', slug: 'vanquish-tee-white', name_en: 'Vanquish Tee White', size: 'M', stock: 4 },
  { sku: 'VAN-TEE-L', slug: 'vanquish-tee-white', name_en: 'Vanquish Tee White', size: 'L', stock: 0 },
  { sku: 'AIR90-M', slug: 'air-max-90', name_en: 'Air Max 90', size: 'M', stock: 2 },
  { sku: 'AIR90-L', slug: 'air-max-90', name_en: 'Air Max 90', size: 'L', stock: 1 },
  { sku: 'AIRMAX-M', slug: 'air-max', name_en: 'Air Max', size: 'M', stock: 1 },
  { sku: 'HOOD-M', slug: 'long-desc-hoodie', name_en: 'Team Hoodie', size: 'M', stock: 3 },
  { sku: 'RUN-ONE', slug: 'run-shorts', name_en: 'Run Shorts', size: 'ONE', stock: 5 }
]
const SHOWN_AT_START = ['VAN-TEE-M', 'VAN-TEE-L', 'AIR90-M', 'AIRMAX-M', 'HOOD-M', 'RUN-ONE']
const PRODUCTS = [
  { id: 1, slug: 'vanquish-tee-white', name_en: 'Vanquish Tee White', image: '/images/products/vanquish-tee-white-old1.jpg', images: null, active: '1' },
  { id: 2, slug: 'air-max-90', name_en: 'Air Max 90', image: null, images: '/images/products/air-max-90-old2.jpg', active: '1' },
  { id: 3, slug: 'air-max', name_en: 'Air Max', image: null, images: null, active: '1' },
  { id: 4, slug: 'long-desc-hoodie', name_en: 'Team Hoodie', image: null, images: null, active: '1' },
  { id: 5, slug: 'run-shorts', name_en: 'Run Shorts', image: '/images/products/run-shorts-gone.jpg', images: null, active: '1' }
]
// The files the shop serves. Anything else under /images/products/ answers 404.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const FILES = new Set([
  '/images/products/vanquish-tee-white-old1.jpg',
  '/images/products/responsive/vanquish-tee-white-old1-320.webp',
  '/images/products/air-max-90-old2.jpg',
  '/images/products/air-max.webp'
])
const VARIANTS_TXT = '# sporta-variants v1\nvanquish-tee-white-old1 320,640\n'

const rowHtml = (v, shown = true) => `<tr${shown ? '' : ' data-new="1"'}><td>${v.name_en}<span class="ms-2 text-xs">Men</span></td><td>${v.size}</td>`
  + `<td class="font-mono">${v.sku}</td><td><input type="number" value="${v.stock}"></td><td>—</td><td>KWD 9.500</td><td>—</td></tr>`
const rowsHtml = (list) => list.map((v) => rowHtml(v)).join('')
const cardsHtml = (list) => list.map((v) => `<div class="m-row"><div class="m-row__top"><span class="m-row__title">${v.name_en}</span>`
  + `<span class="chip">${v.size}</span></div><div class="m-row__meta"><span class="font-mono">${v.sku}</span><input type="number" value="${v.stock}"></div>`
  + `<div class="m-row__meta"><span>Cost —</span><span>Price KWD 9.500</span></div></div>`).join('')
const SHOWN = VARIANTS.filter((v) => SHOWN_AT_START.includes(v.sku))

const CSS = `*,*::before,*::after{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:#f3f5f7;color:#0f172a}
.admin-page{padding:16px}.admin-table{width:100%;border-collapse:collapse}.admin-table th,.admin-table td{padding:8px 12px;text-align:start;border-bottom:1px solid #e2e8f0;vertical-align:middle}
.m-list{display:none}.m-row{padding:10px 0;border-bottom:1px solid #e2e8f0}.m-row__top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.m-row__meta{display:flex;justify-content:space-between;gap:8px;margin-top:4px}.chip{padding:2px 8px;border-radius:6px;background:#e2e8f0}
@media (max-width:767px){.admin-table{display:none}.m-list{display:block}}`

function inventoryPage({ screen = 'inventory' }) {
  const body = screen === 'orders'
    ? `<section class="admin-page"><h1>Orders</h1><table class="admin-table"><thead><tr><th>Track ID</th><th>Customer</th><th>Amount</th></tr></thead><tbody><tr><td>SP1000</td><td>Test</td><td>9.500</td></tr></tbody></table></section>`
    : `<section class="admin-page"><header class="admin-page-header"><h1>Inventory</h1></header>
       <table class="admin-table"><thead><tr><th>Product</th><th>Size</th><th>Item code</th><th>Stock</th><th>Cost</th><th>Price</th><th>Margin</th></tr></thead>
       <tbody>${rowsHtml(SHOWN)}</tbody></table><div class="m-list">${cardsHtml(SHOWN)}</div></section>`
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${CSS}</style></head><body><div class="admin-shell">${body}</div><script src="/sporta-inv-photos.js"></script></body></html>`
}

// ------------------------------------------------------------------------------------------------ the fake admin API and files
function makeApi() { return { calls: [] } }
async function serve(page, st, js) {
  await page.route('**/sporta-inv-photos.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: js }))
  await page.route('**/api/admin.php**', (r) => {
    const req = r.request()
    const name = new URL(req.url()).searchParams.get('r')
    const h = req.headers()
    st.calls.push({ r: name, method: req.method(), sporta: h['x-sporta-admin'] || '' })
    if (!h['x-sporta-admin']) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"bad_request"}' })
    if (name === 'variants') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: VARIANTS }) })
    if (name === 'products_all') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRODUCTS) })
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unknown_route"}' })
  })
  await page.route('**/images/products/**', (r) => {
    const path = new URL(r.request().url()).pathname
    const has = FILES.has(path) || (path === '/images/products/responsive/variants.txt')
    if (path === '/images/products/responsive/variants.txt') {
      return r.fulfill({ status: 200, contentType: 'text/plain', body: VARIANTS_TXT })
    }
    if (!has) return r.fulfill({ status: 404, contentType: 'text/plain', body: '' })
    return r.fulfill({ status: 200, contentType: 'image/png', body: r.request().method() === 'HEAD' ? '' : PNG })
  })
}
async function open(width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', () => { pageErrors++ })
  const st = makeApi()
  await page.route(`${ORIGIN}/backends**`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: inventoryPage(opts) }))
  await serve(page, st, opts.js || BLOCK)
  await page.goto(`${ORIGIN}/backends?tab=${opts.screen === 'orders' ? 'orders' : 'inventory'}`, { waitUntil: 'load' })
  if (opts.screen !== 'orders') await page.waitForFunction(() => document.querySelectorAll('[data-spt-ip]').length > 0, null, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(250)
  return { ctx, page, st }
}
let browser

// ------------------------------------------------------------------------------------------------ the checks
const srcOf = (page, sku) => page.evaluate((sku) => {
  const tr = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.children[2] && r.children[2].textContent.trim() === sku)
  if (!tr) return 'no-row'
  const img = tr.querySelector('[data-spt-ip] img')
  if (img) return img.getAttribute('src')
  return tr.querySelector('.spt-ip-none') ? 'plate' : 'none'
}, sku)
const thumbs = (page, scope) => page.locator(`${scope} [data-spt-ip]`).count()

async function runAll(js, print) {
  const r = {}
  const ok = (name, cond, msg, detail) => {
    r[name] = !!cond
    if (print) is(!!cond, msg, detail)
  }
  // Page A: the desktop table, the decorations, the preview, the redraws.
  const A = await open(1280, { js })
  const p = A.page
  ok('rows', (await thumbs(p, 'table tbody tr')) === SHOWN.length, `one photo in every row of the Inventory table (${SHOWN.length})`, String(await thumbs(p, 'table tbody tr')))
  ok('label', (await p.locator('[data-spt-ip="air-max-90"]').first().getAttribute('aria-label', { timeout: 2000 }).catch(() => '')) === 'Preview photo of Air Max 90',
    'each photo button says which product it previews')
  const small = await srcOf(p, 'VAN-TEE-M')
  ok('small', /\/responsive\/vanquish-tee-white-old1-320\.webp$/.test(String(small)), "the shop's small copy is used where responsive/variants.txt lists one", String(small))
  const own = await srcOf(p, 'AIR90-M')
  ok('own', /\/images\/products\/air-max-90-old2\.jpg$/.test(String(own)), "the product's own photo (images[0]) is used when it has no main photo", String(own))
  const slug = await srcOf(p, 'AIRMAX-M')
  ok('fallback', /\/images\/products\/air-max\.webp$/.test(String(slug)), 'with no photo set, the file named after the slug is used', String(slug))
  const hood = await srcOf(p, 'HOOD-M')
  ok('plate', hood === 'plate', 'a product with no photo file shows a grey "No photo" square', String(hood))
  const run = await srcOf(p, 'RUN-ONE')
  ok('missing', run === 'plate', 'a photo that is listed but missing falls back, and then to "No photo"', String(run))
  // preview
  await p.locator('tbody tr [data-spt-ip="air-max-90"]').first().click({ timeout: 2000 }).catch(() => {})
  await p.waitForSelector('[role="dialog"] .spt-ipv-img', { timeout: 4000 }).catch(() => {})
  const dlg = await p.locator('[role="dialog"]').count()
  const dlgTitle = dlg ? (await p.locator('.spt-ipv-title').textContent({ timeout: 2000 }).catch(() => '')) : ''
  const dlgSrc = dlg ? (await p.locator('.spt-ipv-img').getAttribute('src', { timeout: 2000 }).catch(() => '')) : ''
  ok('preview', dlg === 1 && dlgTitle === 'Air Max 90' && /air-max-90-old2\.jpg$/.test(String(dlgSrc)),
    'a click opens the full photo with the product name', `${dlg} "${dlgTitle}" ${dlgSrc}`)
  await p.keyboard.press('Escape')
  const focusBack = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-spt-ip'))
  ok('escape', (await p.locator('[role="dialog"]').count()) === 0 && focusBack === 'air-max-90',
    'Escape closes the preview and gives the focus back to the photo', String(focusBack))
  await p.locator('tbody tr [data-spt-ip="long-desc-hoodie"]').first().click({ timeout: 2000 }).catch(() => {})
  await p.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {})
  const noFile = await p.locator('.spt-ipv-none').textContent({ timeout: 2000 }).catch(() => '')
  ok('nofile', /No photo file for this product yet/.test(noFile), 'a product with no photo file says so in its preview', noFile)
  await p.locator('.spt-ipv-close').click({ timeout: 2000 }).catch(() => {})
  ok('close', (await p.locator('[role="dialog"]').count()) === 0, 'Close closes the preview')
  // redraw: React draws the rows again (new nodes, no photos), then a size is added in another session.
  await p.evaluate((html) => { document.querySelector('tbody').innerHTML = html }, rowsHtml(SHOWN))
  await p.waitForTimeout(300)
  ok('redraw', (await thumbs(p, 'table tbody tr')) === SHOWN.length, 'when the rows are drawn again the photos come back')
  await p.evaluate((html) => { document.querySelector('tbody').insertAdjacentHTML('beforeend', html) }, rowHtml(VARIANTS.find((v) => v.sku === 'AIR90-L')))
  await p.waitForTimeout(300)
  ok('adds', (await thumbs(p, 'table tbody tr')) === SHOWN.length + 1 && (await srcOf(p, 'AIR90-L')) !== 'no-row' && (await srcOf(p, 'AIR90-L')) !== 'none',
    'a size added later gets its product photo at once')
  await p.evaluate(() => { for (let i = 0; i < 4; i++) document.querySelector('.admin-page').appendChild(document.createElement('span')) })
  await p.waitForTimeout(200)
  ok('once', (await thumbs(p, 'table tbody tr')) === SHOWN.length + 1, 'one photo per row, however often the screen is drawn')
  const big = (await thumbs(p, 'table tbody tr')) ? await p.locator('tbody tr [data-spt-ip]').first().boundingBox({ timeout: 2000 }).catch(() => null) : null
  ok('desktop44', big && big.width >= 44 && big.height >= 44, 'desktop: the photo button is at least 44 px', big ? `${big.width}x${big.height}` : 'none')
  ok('reads', A.st.calls.length > 0 && A.st.calls.every((c) => c.method === 'GET' && c.sporta === '1'),
    'the screen only reads: GET requests to the admin, each with the admin header', JSON.stringify(A.st.calls.slice(0, 4)))
  ok('errors', pageErrors === 0, 'no page error on the Inventory screen', String(pageErrors))
  await A.ctx.close()

  // Page B: a 390 px phone, the card list.
  const B = await open(390, { js })
  const cards = await thumbs(B.page, '.m-list .m-row')
  ok('cards', cards === SHOWN.length, 'one photo on every card of the phone list', String(cards))
  const pb = cards ? await B.page.locator('.m-list [data-spt-ip]').first().boundingBox({ timeout: 2000 }).catch(() => null) : null
  ok('phone44', pb && pb.width >= 44 && pb.height >= 44, 'phone: the photo is at least 44 px', pb ? `${pb.width}x${pb.height}` : 'none')
  const overflow = await B.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok('phoneflow', overflow <= 0, 'phone: the page does not scroll sideways', String(overflow))
  await B.ctx.close()

  // Page C: another screen.
  const C = await open(1280, { js, screen: 'orders' })
  ok('other', (await thumbs(C.page, 'body')) === 0, 'no product photo on another screen')
  await C.ctx.close()
  return r
}

browser = await chromium.launch()
try {
  head('the photos in the Inventory table and the phone list')
  await runAll(BLOCK, true)

  head('with the whole admin file on the page')
  const full = await runAll(BRANDS_JS, false)
  is(Object.values(full).every(Boolean), 'the same checks pass with every other admin block on the page', JSON.stringify(full))

  head('mutations: each cut must turn its check red')
  const MUTANTS = [
    { name: 'the observer is not attached (no redraw)', from: 'mo.observe(document.body || document.documentElement, { childList: true, subtree: true })', to: 'void 0', must: 'redraw' },
    { name: 'no slug-named fallback', from: "['.jpg', '.jpeg', '.png', '.webp'].forEach(function (ext) { add(DIR + slug + ext) })", to: 'void 0', must: 'fallback' },
    { name: 'the small copy is never used', from: 'if (m && maps.small[m[1]]) small.push(', to: 'if (false) small.push(', must: 'small' },
    { name: 'a click does not open the preview', from: 'b.addEventListener(\'click\', function () { openPreview(slug, name, b) })', to: 'void 0', must: 'preview' },
    { name: 'Escape does not close the preview', from: "function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done() }", to: 'function onKey(e) { if (false) { done() }', must: 'escape' }
  ]
  for (const m of MUTANTS) {
    if (!BLOCK.includes(m.from)) { is(false, `mutant "${m.name}": its text is in the block`); continue }
    const cut = BLOCK.replace(m.from, () => m.to)
    const res = await runAll(cut, false)
    is(res[m.must] === false, `mutant "${m.name}" turns "${m.must}" red`, res[m.must] ? 'still green' : '')
  }
  head('errors')
  is(pageErrors === 0, 'no page error on any page', String(pageErrors))
} finally {
  await browser.close()
}
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
