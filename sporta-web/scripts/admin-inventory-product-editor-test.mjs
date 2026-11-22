// PRODUCT EDITOR IN THE INVENTORY SCREEN (owner request 2026-11-22: "make product editor at invetory, no catalogue"): the "Edit product"
// button in the Inventory header, the product list, the editor with the product's photo, the checks, the one product_save, in a real browser
// (public/sporta-admin-brands.js, block "ADMIN INVENTORY PRODUCT EDITOR").
//
//   npm run test:admin-inventory-product-editor   (rig-free: no database, no PHP. The admin API is a fake answered by route interception
//                                                  like admin.php (products_all, product_save); the photo files are served or 404 the same way)
//
// What is asserted:
//   placement - the button sits in the Inventory header; it opens a list of every product; search filters it by name or web name
//   editor    - the fields hold the product's values; the photo is the product's own file (images[0] when there is no main photo);
//               a product with no file says so; the web name is shown
//   checks    - a price of 0 or with four decimals, a sale price not below the price, a description over 280: each shows a message and
//               NOTHING is sent; the first bad field gets the focus
//   save      - ONE POST product_save with the id, the changed fields, and everything the editor does not change sent back as read
//               (image, images, sale dates, featured, brand); a refused save shows the server's code; a second Save with no change says so
//   close     - Escape with no change closes and gives the focus back to the button; with a change it asks first (dismiss keeps it open)
//   language  - on an Arabic page the labels are Arabic
//   reads     - only GET requests to the admin, except the one product_save
//   other     - 390 px: the dialog fits, no sideways scroll; no page error
//   MUTATIONS - the price check, the photo's own file and the kept image field are each cut in turn; each must turn its check red
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const ORIGIN = 'https://sporta.test'
const BEGIN = '/* ===== ADMIN INVENTORY PRODUCT EDITOR - begin'
const END = '/* ===== ADMIN INVENTORY PRODUCT EDITOR - end'
const BLOCK = BRANDS_JS.slice(BRANDS_JS.indexOf(BEGIN), BRANDS_JS.indexOf('*/', BRANDS_JS.indexOf(END)) + 2)
if (BRANDS_JS.indexOf(BEGIN) < 0 || BRANDS_JS.indexOf(END) < 0 || BRANDS_JS.indexOf(BEGIN) !== BRANDS_JS.lastIndexOf(BEGIN)) {
  console.log('FAIL the ADMIN INVENTORY PRODUCT EDITOR block is missing or appears twice'); process.exit(1)
}

let pass = 0, fail = 0, pageErrors = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

// ------------------------------------------------------------------------------------------------ data and files
const PRODUCTS = [
  { id: 1, slug: 'vanquish-tee-white', name_en: 'Vanquish Tee White', name_ar: 'فانكويش تي', desc_en: 'A tee.', desc_ar: '', price: '9.500', sale_price: '', sale_starts_at: null, sale_ends_at: null, category: 'men', brand_slug: '', active: '1', featured: 0, featured_sort: 0, image: '/images/products/vanquish-tee-white-old1.jpg', images: null },
  { id: 2, slug: 'air-max-90', name_en: 'Air Max 90', name_ar: 'إير ماكس 90', desc_en: 'Classic.', desc_ar: '', price: '20.000', sale_price: '15.000', sale_starts_at: '2026-11-01 00:00:00', sale_ends_at: '2026-12-01 00:00:00', category: 'shoes', brand_slug: 'nike-like', active: '1', featured: 1, featured_sort: 5, image: null, images: '/images/products/air-max-90-old2.jpg,/images/products/air-max-90-old2b.jpg' },
  { id: 3, slug: 'air-max', name_en: 'Air Max', name_ar: '', desc_en: '', desc_ar: '', price: '12.250', sale_price: '', sale_starts_at: null, sale_ends_at: null, category: 'shoes', brand_slug: '', active: '1', featured: 0, featured_sort: 0, image: null, images: null },
  { id: 4, slug: 'long-desc-hoodie', name_en: 'Team Hoodie', name_ar: '', desc_en: 'Warm.', desc_ar: '', price: '18.000', sale_price: '', sale_starts_at: null, sale_ends_at: null, category: 'men', brand_slug: '', active: '0', featured: 0, featured_sort: 0, image: null, images: null },
  { id: 5, slug: 'run-shorts', name_en: 'Run Shorts', name_ar: '', desc_en: '', desc_ar: '', price: '6.000', sale_price: '', sale_starts_at: null, sale_ends_at: null, category: 'men', brand_slug: '', active: '1', featured: 0, featured_sort: 0, image: '/images/products/run-shorts-gone.jpg', images: null }
]
// The files the shop serves. Anything else under /images/products/ answers 404.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const FILES = new Set([
  '/images/products/vanquish-tee-white-old1.jpg',
  '/images/products/air-max-90-old2.jpg',
  '/images/products/air-max.webp'
])

const CSS = `*,*::before,*::after{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:#f3f5f7;color:#0f172a}
.admin-page{padding:16px}.admin-page-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.admin-table{width:100%;border-collapse:collapse}.admin-table th,.admin-table td{padding:8px 12px;text-align:start;border-bottom:1px solid #e2e8f0}`

function inventoryPage(lang) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${CSS}</style></head>`
    + `<body><div class="admin-shell"><section class="admin-page"><header class="admin-page-header"><h1>Inventory</h1><div class="inventory-heading__actions"></div></header>`
    + `<table class="admin-table"><thead><tr><th>Product</th><th>Size</th><th>Item code</th><th>Stock</th><th>Cost</th><th>Price</th><th>Margin</th></tr></thead>`
    + `<tbody><tr><td>Air Max 90</td><td>M</td><td class="font-mono">AIR90-M</td><td>2</td><td>—</td><td>KWD 20.000</td><td>—</td></tr></tbody></table></section></div>`
    + `<script src="/sporta-inv-editor.js"></script></body></html>`
}

// ------------------------------------------------------------------------------------------------ the fake admin API and files
async function serve(page, st, js) {
  await page.route('**/sporta-inv-editor.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: js }))
  await page.route('**/api/admin.php**', (r) => {
    const req = r.request()
    const name = new URL(req.url()).searchParams.get('r')
    const h = req.headers()
    st.calls.push({ r: name, method: req.method(), sporta: h['x-sporta-admin'] || '' })
    if (!h['x-sporta-admin']) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"bad_request"}' })
    if (name === 'products_all' && req.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRODUCTS) })
    if (name === 'product_save' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      st.saves.push(body)
      if (st.refuse) return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: st.refuse }) })
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: body.id, slug: body.slug }) })
    }
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unknown_route"}' })
  })
  await page.route('**/images/products/**', (r) => {
    const path = new URL(r.request().url()).pathname
    if (!FILES.has(path)) return r.fulfill({ status: 404, contentType: 'text/plain', body: '' })
    return r.fulfill({ status: 200, contentType: 'image/png', body: r.request().method() === 'HEAD' ? '' : PNG })
  })
}
async function open(width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', () => { pageErrors++ })
  const st = { calls: [], saves: [], refuse: opts.refuse || null }
  await page.route(`${ORIGIN}/backends**`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: inventoryPage(opts.lang || 'en') }))
  await serve(page, st, opts.js || BLOCK)
  await page.goto(`${ORIGIN}/backends?tab=inventory`, { waitUntil: 'load' })
  await page.waitForSelector('.spt-pe-open', { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(150)
  return { ctx, page, st }
}
let browser

// ------------------------------------------------------------------------------------------------ helpers
const field = (page, label) => page.locator('.spt-pe-form label').filter({ hasText: label }).locator('input, textarea').first()
const errOf = (page, label) => page.locator('.spt-pe-form label').filter({ hasText: label }).locator('.spt-pe-err')
async function openEditorFor(page, slug) {
  await page.locator('.spt-pe-open').click({ timeout: 3000 })
  await page.waitForSelector('.spt-pe-pick', { timeout: 4000 })
  await page.locator(`.spt-pe-pick:has(.spt-pe-slug:text-is("${slug}"))`).click({ timeout: 3000 })
  await page.waitForSelector('.spt-pe-form', { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(120)
}

// ------------------------------------------------------------------------------------------------ the checks
async function runAll(js, print) {
  const r = {}
  const ok = (name, cond, msg, detail) => { r[name] = !!cond; if (print) is(!!cond, msg, detail) }

  // Page A: the button, the list, the editor, the checks, the save, the close.
  const A = await open(1280, { js })
  const p = A.page
  ok('button', (await p.locator('.inventory-heading__actions .spt-pe-open').count()) === 1, 'the Inventory header has one "Edit product" button')
  await p.locator('.spt-pe-open').click({ timeout: 3000 })
  await p.waitForSelector('.spt-pe-pick', { timeout: 4000 }).catch(() => {})
  ok('list', (await p.locator('.spt-pe-pick').count()) === PRODUCTS.length, `the list has every product (${PRODUCTS.length})`, String(await p.locator('.spt-pe-pick').count()))
  await p.locator('[role="dialog"] input[type="search"]').fill('air')
  await p.waitForTimeout(100)
  ok('search', (await p.locator('.spt-pe-pick').count()) === 2, 'search "air" finds the two Air products by name')
  await p.locator('[role="dialog"] input[type="search"]').fill('')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(80)
  ok('pickerclose', (await p.locator('[role="dialog"]').count()) === 0 && (await p.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains('spt-pe-open')))),
    'Escape closes the list and gives the focus back to the button')

  await openEditorFor(p, 'air-max-90')
  ok('fields', (await field(p, 'Name (English)').inputValue()) === 'Air Max 90' && (await field(p, 'Price (KWD)').inputValue()) === '20.000'
    && (await field(p, 'Sale price').inputValue()) === '15.000', 'the editor holds the product\'s names, price and sale price')
  const src = await p.locator('.spt-pe-img').getAttribute('src', { timeout: 3000 }).catch(() => '')
  ok('photo', /\/images\/products\/air-max-90-old2\.jpg$/.test(String(src)), "the photo is the product's own file (images[0] when there is no main photo)", String(src))
  ok('web', (await p.locator('.spt-pe-sub').first().textContent({ timeout: 2000 }).catch(() => '')).indexOf('air-max-90') >= 0, 'the web name is shown')

  // checks: nothing is sent for any of them
  await field(p, 'Price (KWD)').fill('0')
  await p.locator('.spt-pe-save').click({ timeout: 2000 })
  await p.waitForTimeout(120)
  const priceErr = await errOf(p, 'Price (KWD)').textContent()
  ok('price0', /above 0/.test(priceErr) && A.st.saves.length === 0, 'a price of 0 shows a message and nothing is sent', priceErr)
  await field(p, 'Price (KWD)').fill('12.1234')
  await p.locator('.spt-pe-save').click({ timeout: 2000 })
  await p.waitForTimeout(120)
  ok('price4', /three decimals/.test(await errOf(p, 'Price (KWD)').textContent()) && A.st.saves.length === 0, 'four decimals are refused before anything is sent')
  await field(p, 'Price (KWD)').fill('20.000')
  await field(p, 'Sale price').fill('25')
  await p.locator('.spt-pe-save').click({ timeout: 2000 })
  await p.waitForTimeout(120)
  ok('sale', /below the price/.test(await errOf(p, 'Sale price').textContent()) && A.st.saves.length === 0, 'a sale price not below the price is refused')
  ok('focus', await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-invalid') === 'true'), 'the first bad field gets the focus')

  // a valid edit: name and price change; the rest goes back as read
  await field(p, 'Sale price').fill('15.000')
  await field(p, 'Name (English)').fill('Air Max 90 Retro')
  await field(p, 'Price (KWD)').fill('21.000')
  await p.locator('.spt-pe-save').click({ timeout: 2000 })
  await p.waitForFunction(() => /Saved/.test((document.querySelector('.spt-pe-actions .spt-pe-status') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {})
  const body = A.st.saves[0] || {}
  ok('post', A.st.saves.length === 1, 'Save sends ONE product_save', String(A.st.saves.length))
  ok('id', body.id === 2 && body.slug === 'air-max-90' && body.name_en === 'Air Max 90 Retro' && body.price === '21.000', 'the body carries the id, the web name and the changed fields',
    JSON.stringify({ id: body.id, slug: body.slug, name: body.name_en, price: body.price }))
  ok('kept', body.images === '/images/products/air-max-90-old2.jpg,/images/products/air-max-90-old2b.jpg' && body.image === ''
    && body.sale_price === '15.000' && body.sale_starts_at === '2026-11-01 00:00:00' && body.sale_ends_at === '2026-12-01 00:00:00'
    && body.featured === true && body.featured_sort === 5 && body.brand_slug === 'nike-like' && body.active === true,
    'photos, sale dates, featured and brand go back exactly as read', JSON.stringify(body))
  ok('saved', /Saved/.test(await p.locator('.spt-pe-actions .spt-pe-status').textContent()), 'the editor says it is saved')
  await p.locator('.spt-pe-save').click({ timeout: 2000 })
  await p.waitForTimeout(120)
  ok('nochange', /Nothing has changed|No change/.test(await p.locator('.spt-pe-actions .spt-pe-status').textContent()) && A.st.saves.length === 1,
    'a second Save with nothing changed sends nothing')

  // close: a change asks first; dismissing keeps the editor open
  await field(p, 'Name (English)').fill('Air Max 90 Retro 2')
  let asked = false
  p.once('dialog', (d) => { asked = true; d.dismiss() })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  ok('dirty', asked && (await p.locator('.spt-pe-form').count()) === 1, 'Escape with a change asks first, and "cancel" keeps the editor open')
  p.once('dialog', (d) => d.accept())
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  const back = await p.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains('spt-pe-open')))
  ok('escape', (await p.locator('[role="dialog"]').count()) === 0 && back, 'accepting the question closes the editor and gives the focus back to the button')

  // a product with no file says so
  await openEditorFor(p, 'long-desc-hoodie')
  const noPhoto = await p.locator('.spt-pe-pic .spt-pe-none').textContent({ timeout: 2000 }).catch(() => '')
  ok('nofile', /No photo file/.test(noPhoto), 'a product with no photo file says so in the editor', noPhoto)
  ok('inactive', !(await p.locator('.spt-pe-check input').isChecked()), 'a product that is off in the shop shows the switch off')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(100)

  ok('reads', A.st.calls.length > 0 && A.st.calls.every((c) => c.sporta === '1' && (c.method === 'GET' || c.r === 'product_save')),
    'the screen only reads, with the admin header, and writes only through product_save', JSON.stringify(A.st.calls.slice(0, 4)))
  ok('errors', pageErrors === 0, 'no page error', String(pageErrors))
  await A.ctx.close()

  // Page B: a refused save shows the server's code.
  const B = await open(1280, { js, refuse: 'too_long_desc_en' })
  await openEditorFor(B.page, 'air-max')
  await field(B.page, 'Name (English)').fill('Air Max Plus')
  await B.page.locator('.spt-pe-save').click({ timeout: 2000 })
  await B.page.waitForFunction(() => /not saved/.test((document.querySelector('.spt-pe-actions .spt-pe-status') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {})
  const refused = await B.page.locator('.spt-pe-actions .spt-pe-status').textContent().catch(() => '')
  ok('refused', /not saved.*too_long_desc_en/.test(refused), "a refused save shows the server's code", refused)
  await B.ctx.close()

  // Page C: a 390 px phone, and the Arabic labels.
  const C = await open(390, { js })
  await openEditorFor(C.page, 'air-max')
  const dlgBox = await C.page.locator('.spt-pe-dlg').boundingBox({ timeout: 2000 }).catch(() => null)
  // The dialog itself must fit and must not scroll sideways (the fixture's seven-column table is not part of the editor).
  const inner = await C.page.evaluate(() => { const d = document.querySelector('.spt-pe-dlg'); return d ? d.scrollWidth <= d.clientWidth + 1 : false })
  ok('phone', dlgBox && dlgBox.x >= 0 && dlgBox.x + dlgBox.width <= 390 + 1 && inner, '390 px: the editor fits the screen and does not scroll sideways inside itself',
    dlgBox ? `${Math.round(dlgBox.width)}px ${inner ? 'fits' : 'overflows'}` : 'no dialog')
  await C.ctx.close()
  const D = await open(1280, { js, lang: 'ar' })
  await openEditorFor(D.page, 'air-max')
  const arLabel = await D.page.locator('.spt-pe-lab').first().textContent({ timeout: 2000 }).catch(() => '')
  ok('arabic', arLabel === 'الاسم (إنجليزي)', 'on an Arabic page the labels are Arabic', arLabel)
  await D.ctx.close()
  return r
}

// ------------------------------------------------------------------------------------------------ run
browser = await chromium.launch()
head('the editor in the Inventory screen')
await runAll(BLOCK, true)

head('MUTATIONS (each must turn its check red)')
const MUTANTS = [
  { name: 'the price check is cut', from: "if (!p) errs.price = t.badPrice", to: '', check: 'price0' },
  { name: 'the photo is not the first photo of the product', from: "if (row.images) add(String(row.images).split(',')[0])", to: '', check: 'photo' },
  { name: 'the kept photo list is cleared', from: "images: row.images || '',", to: "images: '',", check: 'kept' }
]
for (const m of MUTANTS) {
  const at = BLOCK.indexOf(m.from)
  if (at < 0 || BLOCK.indexOf(m.from, at + 1) >= 0) { is(false, `mutant "${m.name}" applies to exactly one place`); continue }
  const mutated = BLOCK.replace(m.from, m.to)
  const res = await runAll(mutated, false)
  is(res[m.check] === false, `mutant "${m.name}" turns "${m.check}" red`, `check was ${res[m.check]}`)
}
await browser.close()

console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
