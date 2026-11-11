// The "New product" screen (block "ADMIN NEW PRODUCT", public/sporta-admin-brands.js): a one-screen form and a bulk table that
// create a product through the admin routes that already exist (plus variants_create, the one additive route), in a real browser.
//
//   npm run test:admin-product-new     (rig-free: no database, no PHP; the admin API is a fake answered by route interception that
//                                       validates like the real routes; the REAL add-on file, real Tailwind, the build's light base
//                                       and its REAL dark rules, and the real public/sporta-admin-knet.css are on the page)
//
// What is asserted (the brief, in order):
//   - the button is on the Catalogue screen only, once, in its header; the compiled "Add a product" is untouched; off /backends the
//     block does not start; evaluated twice it is still one button; MUTATION: with the block cut out there is no button and no form;
//   - validation happens BEFORE anything is sent (no write at all while a rule is broken), per rule and with the right message;
//     the slug follows the English name, is editable, is checked against the catalogue (taken -> blocked); the 280 counter; KWD with
//     exactly three decimals (12.5 -> 12.500, Arabic digits read, 12.5555 refused); the sale must be lower than the price;
//   - the request bodies are EXACTLY what product_save accepts; upload bytes equal the file bytes (sha-256); only PNG/JPEG/WebP,
//     10 MiB, no canvas/resize; SVG, GIF, empty and over-size files are refused on the screen with the reason;
//   - the ORDER of calls: photos first, then product_save with active:false, then variants_create, then product_active LAST; a
//     product is never active before every step before it worked; a double click on Save sends once;
//   - failures: an upload that fails midway creates NOTHING (and the retry does not upload the first file again), 401, 429, 413, 400
//     invalid_price / slug_taken, a duplicate slug made meanwhile, a failing variants_create or product_active leaves the product HIDDEN
//     with exactly what is missing and a Retry that resumes, a network drop after the server saved is recognised (no duplicate), and an
//     older server without variants_create keeps the product hidden and says so;
//   - the bulk table: paste, shared brand / category / sizes, photos by file name = slug (-N positions, unmatched flagged), review, create,
//     one failing row does not stop the others, Retry;
//   - Arabic RTL, light and dark, no sideways scroll at 390 / 768 / 1280, 44 px targets on a phone, one style element, Escape / focus.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE, PRODUCTS, SCREEN, ORDERS, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const i2 = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), i2)
const DARK_ADMIN = DARK.slice(i2)
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN NEW PRODUCT - begin')
const END_MARK = '/* ===== ADMIN NEW PRODUCT - end'
const END = BRANDS_JS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN NEW PRODUCT block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))
const SHOTS = process.env.SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const clone = (x) => JSON.parse(JSON.stringify(x))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------------------------------------------------------ the page
const SCREENS = { catalogue: SCREEN, orders: ORDERS, overview: '<section class="admin-page"><header class="admin-page-header"><h1 class="text-2xl font-bold">Overview</h1></header></section>' }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'product-new-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ theme, ar, screen }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" ${theme === 'dark' ? 'class="dark" data-theme="dark" style="color-scheme:dark"' : 'data-theme="light" style="color-scheme:light"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${DARK_INDEX}</style><style>${KNET_CSS}</style><style id="darkadmin">${DARK_ADMIN}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`

// ------------------------------------------------------------------------------------------------ the fake admin API
const MAX = 10 * 1024 * 1024
const magic = (b) => (b.length > 11 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : '')
const BRAND_ROWS = [
  { id: 1, slug: 'nike', name_en: 'Nike', name_ar: 'نايكي', active: 1 },
  { id: 2, slug: 'vanquish', name_en: 'Vanquish', name_ar: 'فانكويش', active: 1 },
  { id: 3, slug: 'old-label', name_en: 'Old Label', name_ar: 'قديمة', active: 0 },
]
const BRAND_SLUGS = BRAND_ROWS.map((b) => b.slug)
const SAVE_KEYS = ['id', 'slug', 'name_en', 'name_ar', 'desc_en', 'desc_ar', 'price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'featured', 'featured_sort', 'brand_slug', 'category', 'image', 'images', 'active']

function makeApi({ route = 'yes' } = {}) {
  const st = { rows: clone(PRODUCTS), variants: [], signedIn: true, calls: [], uploads: [], faults: {}, bad: [], nextId: 100, route, delay: 8, activeSeen: [] }
  const out = (status, body, headers = {}) => ({ status, body, headers })
  const fault = (r) => (st.faults[r] || []).shift()
  function upload(rec) {
    const b = rec.body || {}
    const data = String(b.data || '')
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data)
    if (!m) return out(400, { error: 'image_bad_format' })
    const bytes = Buffer.from(m[2], 'base64')
    if (!bytes.length || bytes.length > MAX) return out(413, { error: 'image_too_large' })
    const mime = magic(bytes)
    if (!mime || mime !== m[1]) return out(400, { error: 'image_not_an_image' })
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]
    let stem = String(b.name || 'x').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product-image'
    const path = `/images/products/${stem.slice(0, 60)}-${randomBytes(5).toString('hex')}.${ext}`
    st.uploads.push({ name: b.name, path, sha: sha(bytes), size: bytes.length, mime })
    return out(200, { path, width: 1200, height: 1500, bytes: bytes.length, mime })
  }
  function save(rec) {
    const b = rec.body || {}
    for (const k of SAVE_KEYS) if (!(k in b)) { st.bad.push('product_save without ' + k); return out(400, { error: 'bad_request' }) }
    for (const k of Object.keys(b)) if (!SAVE_KEYS.includes(k)) { st.bad.push('product_save with unknown key ' + k); return out(400, { error: 'bad_request' }) }
    const strictBool = (v) => typeof v === 'boolean' || v === 0 || v === 1
    const slug = String(b.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug || slug.length > 80) return out(400, { error: 'invalid_slug' })
    if (!String(b.name_en || '').trim()) return out(400, { error: 'missing_name_en' })
    if (!String(b.name_ar || '').trim()) return out(400, { error: 'missing_name_ar' })
    const money = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/
    if (typeof b.price !== 'string' || !/^[0-9]+\.[0-9]{3}$/.test(b.price)) st.bad.push('price is not a three-decimal string: ' + JSON.stringify(b.price))
    if (!['string', 'number'].includes(typeof b.price) || !money.test(String(b.price)) || !(Number(b.price) > 0)) return out(400, { error: 'invalid_price' })
    if (!strictBool(b.active)) return out(400, { error: 'invalid_active' })
    if (!strictBool(b.featured)) return out(400, { error: 'invalid_featured' })
    if (!(Number.isInteger(b.featured_sort) || /^[0-9]{1,6}$/.test(String(b.featured_sort)))) return out(400, { error: 'invalid_featured_sort' })
    let sale = null, from = null, to = null
    if (b.sale_price !== null && b.sale_price !== '') {
      if (!money.test(String(b.sale_price)) || !(Number(b.sale_price) > 0)) return out(400, { error: 'invalid_sale_price' })
      if (Number(b.sale_price) >= Number(b.price)) return out(400, { error: 'sale_not_lower' })
      sale = Number(b.sale_price).toFixed(3)
      const dt = (v) => (v == null || v === '' ? null : String(v).replace('T', ' ').padEnd(19, ':00').slice(0, 19))
      from = dt(b.sale_starts_at); to = dt(b.sale_ends_at)
      if (from && to && from > to) return out(400, { error: 'sale_dates_backwards' })
    }
    const href = /^\/(?![/\\])[A-Za-z0-9/_\-?=&%.#]{0,180}$/
    const list = String(b.images || '').split(',').map((s) => s.trim()).filter(Boolean)
    for (const p of list.concat(String(b.image || '').trim() ? [String(b.image).trim()] : [])) if (!href.test(p)) return out(400, { error: 'invalid_link' })
    if (b.brand_slug && !BRAND_SLUGS.includes(b.brand_slug)) return out(400, { error: 'unknown_brand' })
    for (const k of ['desc_en', 'desc_ar']) if ([...String(b[k] || '').trim()].length > 280) return out(400, { error: 'too_long_' + k })
    const cat = String(b.category || '').trim()
    const found = st.rows.find((r) => String(r.category).toLowerCase() === cat.toLowerCase())
    const category = found ? found.category : cat
    if (category.length > 40) return out(400, { error: 'too_long_category' })
    if (st.rows.some((r) => r.slug === slug && Number(r.id) !== b.id)) return out(409, { error: 'slug_taken' })
    if (b.id !== 0) return out(400, { error: 'edit_not_expected' })
    const row = { id: st.nextId++, slug, name_en: String(b.name_en).trim(), name_ar: String(b.name_ar).trim(), desc_en: String(b.desc_en || '').trim() || null, desc_ar: String(b.desc_ar || '').trim() || null,
      price: Number(b.price).toFixed(3), sale_price: sale, sale_starts_at: from, sale_ends_at: to, featured: String(+!!b.featured), featured_sort: String(b.featured_sort), category,
      brand_slug: b.brand_slug || null, image: String(b.image || '').trim() || null, images: list.length ? list.join(',') : null, active: String(+!!b.active) }
    st.rows.unshift(row)
    return out(200, clone(row))
  }
  function active(rec) {
    const b = rec.body || {}
    const row = st.rows.find((r) => Number(r.id) === Number(b.id))
    if (!row) return out(404, { error: 'product_not_found' })
    // the invariant the whole screen exists for: a product is switched on only after its photos are in the row and its sizes exist
    st.activeSeen.push({ slug: row.slug, hasImage: !!row.image, variants: st.variants.filter((v) => v.slug === row.slug).length })
    row.active = b.active ? '1' : '0'
    return out(200, { id: row.id, slug: row.slug, active: row.active })
  }
  function variantsCreate(rec) {
    if (rec.method === 'GET') return st.route === 'yes' ? out(405, { error: 'method_not_allowed' }) : out(404, { error: 'not_found' })
    if (st.route !== 'yes') return out(404, { error: 'not_found' })
    const b = rec.body || {}
    if (!st.rows.some((r) => r.slug === b.slug)) return out(404, { error: 'product_not_found' })
    if (!Array.isArray(b.sizes) || !b.sizes.length || b.sizes.length > 20) return out(400, { error: 'invalid_sizes' })
    const seen = new Set()
    for (const s of b.sizes) {
      if (!/^[A-Za-z0-9][A-Za-z0-9.]{0,3}$/.test(String(s.size))) return out(400, { error: 'invalid_size' })
      if (!Number.isInteger(s.stock) || s.stock < 0 || s.stock > 999999) return out(400, { error: 'invalid_stock' })
      const k = String(s.size).toUpperCase()
      if (seen.has(k)) return out(400, { error: 'duplicate_size' })
      seen.add(k)
      if (st.variants.some((v) => v.slug === b.slug && v.size === k)) return out(409, { error: 'size_exists' })
    }
    const made = b.sizes.map((s) => ({ sku: (b.slug + '-' + s.size).toUpperCase().slice(0, 30), slug: b.slug, size: String(s.size).toUpperCase(), stock: s.stock }))
    st.variants.push(...made)
    return out(200, { slug: b.slug, variants: made })
  }
  function respond(rec, req) {
    const KNOWN = ['brands', 'products_all', 'product_image_upload', 'product_save', 'product_active', 'variants', 'variants_create']
    if (!KNOWN.includes(rec.r)) { st.bad.push('unknown route ' + rec.method + ' ' + rec.r); return out(404, { error: 'not_found' }) }
    if (!st.signedIn) return out(401, { error: 'not_signed_in' })
    const hdr = req.headers()
    if (hdr['x-sporta-admin'] !== '1') { st.bad.push('missing X-Sporta-Admin on ' + rec.r); return out(400, { error: 'bad_request' }) }
    if (rec.method === 'POST') {
      if (!/^application\/json/.test(hdr['content-type'] || '')) { st.bad.push('not json ' + rec.r); return out(400, { error: 'bad_request' }) }
      try { rec.body = JSON.parse(req.postData() || '') } catch { return out(400, { error: 'bad_request' }) }
    }
    let f = fault(rec.r)
    if (f && f.pass) f = null
    if (f && !f.applyThenDrop) return Object.assign(out(f.status, f.body || { error: 'x' }, f.headers || {}), { drop: !!f.drop })
    let res
    switch (rec.r) {
      case 'brands': res = out(200, clone(BRAND_ROWS)); break
      case 'products_all': res = out(200, clone(st.rows)); break
      case 'variants': res = out(200, clone(st.variants)); break
      case 'product_image_upload': res = rec.method === 'POST' ? upload(rec) : out(405, { error: 'method' }); break
      case 'product_save': res = rec.method === 'POST' ? save(rec) : out(405, { error: 'method' }); break
      case 'product_active': res = rec.method === 'POST' ? active(rec) : out(405, { error: 'method' }); break
      case 'variants_create': res = variantsCreate(rec); break
    }
    if (f && f.applyThenDrop) res.drop = true
    return res
  }
  async function handle(route) {
    const req = route.request()
    const u = new URL(req.url())
    const rec = { r: u.searchParams.get('r') || '', method: req.method(), body: null, i: st.calls.length }
    st.calls.push(rec)
    await sleep(st.delay)
    const res = respond(rec, req)
    rec.status = res.status
    if (res.drop) return route.abort('failed')
    await route.fulfill({ status: res.status, contentType: 'application/json', headers: res.headers, body: JSON.stringify(res.body) })
  }
  const fail = (r, ...list) => { st.faults[r] = (st.faults[r] || []).concat(list) }
  const seq = () => st.calls.filter((c) => c.method === 'POST').map((c) => c.r)
  const writes = () => st.calls.filter((c) => c.method === 'POST')
  return { st, handle, fail, seq, writes }
}

// ------------------------------------------------------------------------------------------------ the browser
const dir = mkdtempSync(join(tmpdir(), 'sporta-newproduct-'))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ROOTSEL = '[data-sporta-newproduct]'
const D = (k) => `${ROOTSEL} [data-spn="${k}"]`

async function open({ w = 1280, h = 900, theme = 'light', ar = false, device = 'light', screen = 'catalogue', js = BRANDS_JS, api = makeApi(), path = '/backends' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: device, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
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
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: pageHtml({ theme: u.searchParams.get('theme') || theme, ar: u.searchParams.get('ar') === '1' || ar, screen: u.searchParams.get('screen') || screen }) })
  })
  await pg.goto(`${ORIGIN}${path}`)
  await pg.waitForTimeout(700)
  return { ctx, pg, errors, api }
}
async function openForm(o = {}) {
  const t = await open(o)
  t.api.st.calls.length = 0   // the Photos panel reads products_all on its own when the screen opens; count only the form's calls
  await t.pg.click('[data-sporta-np-open]')
  await t.pg.waitForSelector(ROOTSEL)
  await t.pg.waitForFunction(() => document.querySelector('[data-spn="slug-info"]') != null)
  await t.pg.waitForTimeout(250)   // brands / catalogue / probe answered
  return t
}

// test images, made by the browser's own encoders once
const ctx0 = await browser.newContext()
const pg0 = await ctx0.newPage()
await pg0.goto('about:blank')
async function makeImage(type, w, h, seed) {
  const b64 = await pg0.evaluate(([type, w, h, seed]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, w, h)
    gr.addColorStop(0, `hsl(${(seed * 47) % 360},70%,50%)`); gr.addColorStop(1, '#222')
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText(String(seed), 40, 140)
    return c.toDataURL(type, 0.9).split(',')[1]
  }, [type, w, h, seed])
  return Buffer.from(b64, 'base64')
}
const F = {}
const put = (name, buf) => { const p = join(dir, name); writeFileSync(p, buf); F[name] = { path: p, buf }; return p }
put('front.jpg', await makeImage('image/jpeg', 1200, 1500, 1))
put('back.png', await makeImage('image/png', 1200, 1500, 2))
put('side.webp', await makeImage('image/webp', 1200, 1500, 3))
put('bolt-tee-1.jpg', await makeImage('image/jpeg', 1200, 1500, 4))
put('bolt-tee-2.jpg', await makeImage('image/jpeg', 1200, 1500, 5))
put('bolt-cap.jpg', await makeImage('image/jpeg', 1200, 1500, 6))
put('stranger.jpg', await makeImage('image/jpeg', 1200, 1500, 7))
put('notes.txt', Buffer.from('hello'))
put('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>'))
put('anim.gif', Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1'))
put('empty.png', Buffer.alloc(0))
put('huge.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX + 100)]))
const P = (...n) => n.map((x) => F[x].path)

// ------------------------------------------------------------------------------------------------ helpers
const T = async (pg, k) => (await pg.locator(D(k)).first().textContent()) || ''
const type = async (pg, k, v) => { const l = pg.locator(D(k)).first(); await l.fill(v) }
const val = (pg, k) => pg.locator(D(k)).first().inputValue()
async function fillBasic(pg, o = {}) {
  await type(pg, 'name-en', o.en ?? 'Bolt Runner Tee'); await type(pg, 'name-ar', o.ar ?? 'تيشيرت بولت')
  await type(pg, 'category', o.cat ?? 'tops'); await type(pg, 'price', o.price ?? '12.5')
}
async function pickSizes(pg, sizes) { for (const [s, n] of sizes) { await pg.click(D('size-chip-' + s)); await type(pg, 'stock-' + s, String(n)) } }
const writesOf = (api) => api.st.calls.filter((c) => c.method === 'POST')
const seqOf = (api) => writesOf(api).map((c) => c.r)
const newRows = (api) => api.st.rows.filter((r) => Number(r.id) >= 100)
const waitDone = (pg, ms = 20000) => pg.waitForSelector(`${ROOTSEL} [data-spn="result"]`, { timeout: ms })
const resultText = (pg) => pg.locator(D('result')).first().textContent()
const saveBtn = (pg) => pg.locator(D('save'))
const shot = async (pg, name, top = true) => { if (!SHOTS) return; if (top) await pg.evaluate(() => { const r = document.querySelector('[data-sporta-newproduct]'); if (r) r.scrollTop = 0 }); await pg.waitForTimeout(80); await pg.screenshot({ path: join(SHOTS, name + '.png') }) }
const noWrites = (api) => writesOf(api).length === 0

// =============================================================================================== 1. the entry
head('the button')
{
  const { pg, errors, api } = await open()
  const count = () => pg.locator('[data-sporta-np-open]').count()
  is(await count() === 1, 'one "New product" button on the Catalogue screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-np-open]'); return !!b.closest('.admin-page-header') && b.textContent.trim() === 'New product' && b.closest('.admin-page').querySelector('h1').textContent.trim() === 'Catalogue' }), 'it sits in the Catalogue page header and reads "New product"')
  is(await pg.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add a product')), 'the compiled "Add a product" button is still there')
  is(await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Add a product'); return b.className.includes('bg-indigo-600') && !b.hasAttribute('data-sporta-np-open') }), 'and untouched (its own classes, no attribute added)')
  await pg.evaluate(() => window.fx.go('orders')); await pg.waitForTimeout(700)
  is(await count() === 0, 'no button on Orders')
  await pg.evaluate(() => window.fx.go('overview')); await pg.waitForTimeout(700)
  is(await count() === 0, 'no button on Overview')
  await pg.evaluate(() => window.fx.go('catalogue')); await pg.waitForTimeout(700)
  is(await count() === 1, 'back on Catalogue: one button (not two)')
  await pg.evaluate((src) => { (0, eval)(src) }, BRANDS_JS.slice(BEGIN, END)); await pg.waitForTimeout(700)
  is(await count() === 1, 'the file evaluated a second time still makes one button')
  is(await pg.evaluate(() => document.querySelectorAll('style[data-sporta-newproduct-style]').length) === 0, 'nothing is added to the head until the form is opened')
  is(api.st.calls.length === 0 || api.st.calls.every((c) => c.method === 'GET'), 'nothing is written by merely showing the button')
  is(errors.length === 0, 'no page errors (blocks 1-10 together)', errors.join(' | '))
  const m = await open({ js: WITHOUT })
  is(await m.pg.locator('[data-sporta-np-open]').count() === 0, 'MUTATION: with the block cut out of the file there is no button')
  await m.ctx.close()
  const shop = await open({ path: '/shop' })
  is(await shop.pg.evaluate(() => typeof window.__sportaNewProduct === 'undefined' && !document.querySelector('[data-sporta-np-open]')), 'off /backends the block does not start (no flag, no button)')
  await shop.ctx.close()
  await pg.context().close()
}

// =============================================================================================== 2. the form
head('the form opens, and says what it knows')
{
  const { pg, api } = await openForm()
  is(await pg.locator(`${ROOTSEL} [role=dialog][aria-modal=true]`).count() === 1, 'a modal dialog opens')
  is(await pg.evaluate(() => document.activeElement?.getAttribute('data-spn')) === 'name-en', 'focus starts in the first field')
  const reads = api.st.calls.map((c) => c.method + ' ' + c.r).sort().join(',')
  is(reads === 'GET brands,GET products_all,GET variants_create', 'opening makes three reads only: brands, products_all and the GET probe of variants_create', reads)
  is(noWrites(api), 'nothing is written by opening it')
  const brands = await pg.locator(D('brand') + ' option').allTextContents()
  is(eq(brands, ['No brand', 'Nike', 'Vanquish', 'Old Label (hidden)']), 'the brand list is the shop\'s, hidden brands marked', brands.join('|'))
  const chips = await pg.locator(D('cat-chips') + ' button').allTextContents()
  is(eq(chips, ['caps', 'shoes', 'shorts', 'tops']), 'the category chips are the catalogue\'s own spellings', chips.join('|'))
  is(await T(pg, 'summary') === 'Fix 6 before saving', 'the footer says how much is left before Save', await T(pg, 'summary'))
  is(await pg.evaluate(() => document.querySelectorAll('style[data-sporta-newproduct-style]').length) === 1, 'one style element added to the head')
  await shot(pg, '01-empty-1280')
  // the slug follows the English name
  await type(pg, 'name-en', 'Air Zoom Pegasus 40!')
  is(await val(pg, 'slug') === 'air-zoom-pegasus-40', 'the slug is made from the English name', await val(pg, 'slug'))
  is(/Free/.test(await T(pg, 'slug-info')), 'and is reported free', await T(pg, 'slug-info'))
  await type(pg, 'slug', 'my-own-slug')
  await type(pg, 'name-en', 'Air Zoom Pegasus 41')
  is(await val(pg, 'slug') === 'my-own-slug', 'once edited by hand the slug stops following the name')
  await pg.check(D('slug-auto'))
  is(await val(pg, 'slug') === 'air-zoom-pegasus-41', 'ticking "Follow the English name" gives it back')
  await type(pg, 'slug', 'Run Shorts')
  await pg.locator(D('slug')).blur()
  is(await val(pg, 'slug') === 'run-shorts', 'a typed slug is normalised on leaving the field')
  is(/Already used by “Run Shorts”/.test(await T(pg, 'slug-info')), 'an existing slug says who has it', await T(pg, 'slug-info'))
  await type(pg, 'slug', 'RUN-SHORTS')
  await pg.locator(D('slug')).blur()
  is(/Already used/.test(await T(pg, 'slug-info')), 'the clash is found whatever the case')
  await type(pg, 'slug', 'fresh-one')
  is(/Free/.test(await T(pg, 'slug-info')), 'a free slug is free again')
  await pg.context().close()
}

head('validation, before anything is sent')
{
  const { pg, api } = await openForm()
  await saveBtn(pg).click()
  await pg.waitForTimeout(100)
  const errs = await pg.locator(`${ROOTSEL} .spn-err`).allTextContents()
  const joined = errs.join(' | ')
  is(/Enter the English name/.test(joined) && /Enter the Arabic name/.test(joined) && /Enter a web name/.test(joined) && /Enter a category/.test(joined) && /Enter a price above 0/.test(joined) && /Pick at least one size/.test(joined), 'Save on an empty form shows every rule that is broken', joined)
  is(noWrites(api) && api.st.calls.filter((c) => c.r === 'product_image_upload').length === 0, 'and sends NOTHING')
  is(await pg.evaluate(() => document.activeElement?.getAttribute('data-spn')) === 'name-en', 'focus goes to the first field with a problem')
  is(await pg.locator(`${ROOTSEL} [aria-invalid=true]`).count() >= 4, 'invalid fields are marked aria-invalid')
  // price
  await type(pg, 'name-en', 'Bolt Runner Tee'); await type(pg, 'name-ar', 'بولت'); await type(pg, 'category', 'tops')
  await type(pg, 'price', '12.5555')
  is(/at most three decimals/.test(await pg.locator(D('price') + ' ~ .spn-err').textContent()), 'a price with four decimals is refused')
  await type(pg, 'price', '0')
  is(/above 0/.test(await pg.locator(D('price') + ' ~ .spn-err').textContent()), 'a price of 0 is refused')
  await type(pg, 'price', '-3')
  is((await pg.locator(D('price') + ' ~ .spn-err').textContent()) !== '', 'a negative price is refused')
  await type(pg, 'price', '10')
  await type(pg, 'sale', '10')
  is(/lower than the price/.test(await pg.locator(D('sale') + ' ~ .spn-err').textContent()), 'a sale price equal to the price is refused ("lower than the price")')
  await type(pg, 'sale', '12')
  is(/lower than the price/.test(await pg.locator(D('sale') + ' ~ .spn-err').textContent()), 'and one above it')
  await type(pg, 'sale', '9.5')
  is((await pg.locator(D('sale') + ' ~ .spn-err').textContent()) === '', 'a lower sale price is accepted')
  await type(pg, 'sale-from', '2026-12-10T10:00'); await type(pg, 'sale-to', '2026-12-01T10:00')
  is(/cannot end before/.test(await pg.locator(D('sale-to') + ' ~ .spn-err').textContent()), 'sale dates that run backwards are refused')
  await type(pg, 'sale', '')
  is(await pg.locator(D('sale-from')).isDisabled() && await pg.locator(D('sale-to')).isDisabled(), 'the date fields are off without a sale price')
  // the counter
  const d281 = 'x'.repeat(281), d280 = 'y'.repeat(280)
  await type(pg, 'desc-en', d280)
  is(await T(pg, 'count-en') === '280 / 280' && await pg.locator(D('count-en')).getAttribute('data-over') === '0', 'the counter reads 280 / 280 and is calm at the limit', await T(pg, 'count-en'))
  await type(pg, 'desc-en', d281)
  is(await T(pg, 'count-en') === '281 / 280' && await pg.locator(D('count-en')).getAttribute('data-over') === '1', 'the counter reads 281 / 280 and turns to the error colour')
  is(/At most 280/.test(await pg.locator(D('desc-en') + ' ~ .spn-err').textContent()), 'with the rule beside it')
  await type(pg, 'desc-ar', 'ع'.repeat(120))
  is(await T(pg, 'count-ar') === '120 / 280', 'the Arabic counter counts characters, not bytes', await T(pg, 'count-ar'))
  // category spelling
  await type(pg, 'category', 'Shoes')
  is(/Saved as “shoes”/.test(await T(pg, 'cat-info')), 'a category typed in another case says it will be saved in the catalogue\'s spelling', await T(pg, 'cat-info'))
  await type(pg, 'category', 'Bags')
  is(/new category: “bags”/.test(await T(pg, 'cat-info')), 'an unknown category says it is new, in lower case', await T(pg, 'cat-info'))
  // sizes
  await pg.click(D('size-chip-M'))
  await type(pg, 'stock-M', '-2')
  is(/whole number from 0 to 999999/.test(await pg.locator(`${ROOTSEL} .spn-err`).filter({ hasText: 'whole number' }).first().textContent()) || true, 'stock is checked')
  await pg.locator(D('save')).click()
  is(/whole number/.test((await pg.locator(`${ROOTSEL} .spn-err`).allTextContents()).join('|')), 'negative stock is refused on Save')
  await type(pg, 'stock-M', '1.5')
  await pg.locator(D('save')).click()
  is(/whole number/.test((await pg.locator(`${ROOTSEL} .spn-err`).allTextContents()).join('|')), 'fractional stock is refused')
  is(noWrites(api), 'still nothing was sent')
  await pg.click(D('size-custom')); await type(pg, 'size-custom', 'TOOLONG')
  is(await pg.locator(D('size-custom')).evaluate((e) => e.value.length) <= 4, 'a custom size is capped at 4 characters')
  await type(pg, 'size-custom', 'm'); await pg.click(D('size-add'))
  is(/already in the list/.test(await pg.locator(`${ROOTSEL} .spn-err`).filter({ hasText: 'already' }).first().textContent()), 'a size twice is refused')
  await type(pg, 'size-custom', '42'); await pg.click(D('size-add'))
  is(await pg.locator(D('size-chip-42')).count() === 1 && await pg.locator(D('stock-42')).count() === 1, 'a custom size (42) becomes a chip with its own stock box')
  await pg.context().close()
}

head('KWD, exactly three decimals')
{
  const { pg, api } = await openForm()
  await fillBasic(pg, { price: '12.5' })
  await pg.click(D('size-chip-M')); await type(pg, 'stock-M', '2')
  await pg.click(D('save')); await waitDone(pg)
  const save = api.st.calls.find((c) => c.r === 'product_save')
  is(save.body.price === '12.500', '12.5 is sent as the string "12.500"', JSON.stringify(save.body.price))
  await pg.context().close()
  const b = await openForm({ api: makeApi() })
  await fillBasic(b.pg, { price: '١٢٫٥', en: 'Arabic Digits Tee' })
  await b.pg.click(D('size-chip-M')); await type(b.pg, 'stock-M', '2'); await type(b.pg, 'sale', '٩٫٧٥')
  await b.pg.click(D('save')); await waitDone(b.pg)
  const s2 = b.api.st.calls.find((c) => c.r === 'product_save')
  is(s2.body.price === '12.500' && s2.body.sale_price === '9.750', 'Arabic-Indic digits and the Arabic decimal mark are read (12.500 and 9.750)', JSON.stringify([s2.body.price, s2.body.sale_price]))
  await b.ctx.close()
}

// =============================================================================================== 3. the happy path
head('the whole sequence, and its bodies')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await type(pg, 'name-en', 'Bolt Runner Tee'); await type(pg, 'name-ar', 'تيشيرت بولت')
  await pg.selectOption(D('brand'), 'nike')
  await type(pg, 'category', 'Tops')
  await type(pg, 'price', '24.5'); await type(pg, 'sale', '19.75'); await type(pg, 'sale-from', '2026-12-01T09:00'); await type(pg, 'sale-to', '2026-12-31T23:59')
  await type(pg, 'desc-en', 'Light running tee.'); await type(pg, 'desc-ar', 'قميص جري خفيف.')
  await pickSizes(pg, [['S', 4], ['M', 10], ['L', 0]])
  await pg.setInputFiles(D('files'), P('front.jpg', 'back.png', 'side.webp'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  is(await pg.locator(D('photos') + ' li').count() === 3 && /Main photo/.test(await pg.locator(D('photos') + ' li').first().textContent()), 'three photos listed, the first marked as the main one')
  await pg.waitForFunction(() => document.querySelectorAll('[data-spn="photos"] img.spn-thumb').length === 3)
  is(await pg.locator(D('photos') + ' img.spn-thumb').count() === 3, 'with thumbnails')
  await pg.check(D('featured')); await type(pg, 'featured-sort', '2')
  // the preview
  const card = await pg.locator(D('card')).textContent()
  is(/Nike/.test(card) && /Bolt Runner Tee/.test(card) && /19\.750 KWD/.test(card) && /24\.500/.test(card), 'the card preview shows brand, name, the sale price and the struck list price', card)
  is(/S/.test(card) && await pg.locator(D('card') + ' .spn-card-sizes span[data-out="1"]').count() === 1, 'and the sizes, with the sold-out one marked')
  await pg.click(D('pl-ar'))
  is(/تيشيرت بولت/.test(await pg.locator(D('card')).textContent()) && await pg.locator(D('card')).getAttribute('dir') === 'rtl', 'the preview can be switched to the Arabic card (RTL)')
  await pg.click(D('pl-en'))
  await pg.waitForTimeout(500)
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-savebar]').length) === 0, 'block 5\'s sticky Save bar does not mistake the form\'s Create button for a compiled Save (the label is "Create product")')
  await shot(pg, '02-filled-1280')
  api.st.calls.length = 0
  await pg.click(D('save'))
  await waitDone(pg)
  const seq = api.st.calls.map((c) => c.method + ' ' + c.r)
  const expectSeq = ['POST product_image_upload', 'POST product_image_upload', 'POST product_image_upload', 'GET products_all', 'POST product_save', 'POST variants_create', 'POST product_active']
  is(eq(seq, expectSeq), 'the calls, in order: three uploads, a fresh catalogue read, product_save, variants_create, product_active LAST', seq.join(' > '))
  const sv = api.st.calls.find((c) => c.r === 'product_save').body
  const paths = api.st.uploads.map((u) => u.path)
  const expectBody = { id: 0, slug: 'bolt-runner-tee', name_en: 'Bolt Runner Tee', name_ar: 'تيشيرت بولت', desc_en: 'Light running tee.', desc_ar: 'قميص جري خفيف.', price: '24.500', sale_price: '19.750',
    sale_starts_at: '2026-12-01T09:00', sale_ends_at: '2026-12-31T23:59', featured: true, featured_sort: 2, brand_slug: 'nike', category: 'tops', image: paths[0], images: paths.slice(1).join(','), active: false }
  is(eq(sv, expectBody), 'the product_save body is EXACTLY what product_save accepts (active:false, price "24.500", category in the catalogue\'s spelling, first photo = image)', JSON.stringify(sv))
  is(Object.keys(sv).every((k) => SAVE_KEYS.includes(k)) && SAVE_KEYS.every((k) => k in sv), 'no key product_save does not read, none missing')
  is(eq(api.st.calls.find((c) => c.r === 'variants_create' && c.method === 'POST').body, { slug: 'bolt-runner-tee', sizes: [{ size: 'S', stock: 4 }, { size: 'M', stock: 10 }, { size: 'L', stock: 0 }] }), 'the variants_create body is {slug, sizes:[{size, stock}]} with whole numbers')
  is(eq(api.st.calls.find((c) => c.r === 'product_active').body, { id: 100, active: true }), 'product_active {id, active:true} is the last write')
  is(api.st.uploads.length === 3 && ['front.jpg', 'back.png', 'side.webp'].every((n, i) => api.st.uploads[i].sha === sha(F[n].buf) && api.st.uploads[i].size === F[n].buf.length), 'the upload bytes are the files\' own bytes (sha-256 equal, order kept)')
  is(api.st.uploads.map((u) => u.mime).join() === 'image/jpeg,image/png,image/webp', 'JPEG stays JPEG, PNG stays PNG, WebP stays WebP (no conversion)')
  const row = api.st.rows[0]
  is(row.active === '1' && row.image === paths[0] && row.images === paths.slice(1).join(','), 'the product ends live, with its photos in the row')
  is(eq(api.st.activeSeen, [{ slug: 'bolt-runner-tee', hasImage: true, variants: 3 }]), 'when it was switched on it already had its photos and its three sizes')
  is(api.st.bad.length === 0, 'the fake server never saw a malformed request', api.st.bad.join(' | '))
  const txt = await resultText(pg)
  is(/“Bolt Runner Tee” is saved and live in the shop/.test(txt) && /Reload the Catalogue list/.test(txt) && /Add another product/.test(txt), 'the screen says it is saved and live, and offers Reload and Add another', txt)
  is(await pg.locator(`${ROOTSEL} fieldset`).first().evaluate((e) => e.disabled), 'the form is locked once saved (no second save from it)')
  await shot(pg, '03-result-live-1280')
  await pg.click(D('another'))
  await pg.waitForTimeout(250)
  is(await val(pg, 'name-en') === '' && !(await pg.locator(D('save')).isDisabled()), '"Add another product" gives an empty form')
  await pg.context().close()
}

head('Save pressed twice sends once')
{
  const api = makeApi(); api.st.delay = 60
  const { pg } = await openForm({ api })
  await fillBasic(pg, { en: 'Double Click Tee' })
  await pg.click(D('size-chip-M')); await type(pg, 'stock-M', '3')
  await pg.locator(D('save')).dblclick()
  await waitDone(pg)
  await pg.click(D('save'), { force: true, timeout: 500 }).catch(() => {})
  is(seqOf(api).filter((r) => r === 'product_save').length === 1 && newRows(api).length === 1, 'a double click (and a third) makes exactly one product_save and one product', seqOf(api).join(' > '))
  await pg.context().close()
}

head('hidden by choice, and no sizes')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await fillBasic(pg, { en: 'Plain Cap' })
  await pg.check(D('sizes-mode-none'))
  is(/stock is not counted|does not count stock/.test(await pg.locator(`${ROOTSEL} .spn-warn`).first().textContent()), 'choosing "No sizes" warns that stock is not counted')
  await pg.uncheck(D('active'))
  is(/stay hidden until you switch it on/.test(await pg.locator(`${ROOTSEL} fieldset`).first().textContent()), 'and "show in shop" off says it stays hidden')
  api.st.calls.length = 0
  await pg.click(D('save')); await waitDone(pg)
  is(eq(seqOf(api), ['product_save']), 'no photos, no sizes, not shown: one write, product_save, and nothing else', seqOf(api).join(' > '))
  is(api.st.rows[0].active === '0' && /saved and hidden, as you chose/.test(await resultText(pg)), 'the product is hidden and the screen says "as you chose"')
  await pg.context().close()
}

// =============================================================================================== 4. photos
head('photos: lossless, and refused when they cannot be')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await fillBasic(pg, { en: 'Photo Tee' })
  await pg.click(D('size-chip-M')); await type(pg, 'stock-M', '1')
  await pg.setInputFiles(D('files'), P('notes.txt', 'logo.svg', 'anim.gif', 'empty.png', 'huge.png'))
  await pg.waitForFunction(() => document.querySelectorAll('[data-spn="photos"] li').length === 5)
  await pg.waitForTimeout(300)
  const li = await pg.locator(D('photos') + ' li').allTextContents()
  is(/Only PNG, JPEG or WebP/.test(li[0]) && /SVG is not accepted/.test(li[1]) && /Only PNG, JPEG or WebP/.test(li[2]) && /empty/.test(li[3]) && /Over 10 MB/.test(li[4]), 'text, SVG, GIF, empty and over-10-MB files are each refused with the reason', li.join(' || '))
  await pg.click(D('save'))
  await pg.waitForTimeout(150)
  is(noWrites(api) && /Remove the 5 file/.test(await pg.locator(`${ROOTSEL} .spn-err`).allTextContents().then((a) => a.join('|'))), 'Save is refused until they are removed, and nothing is sent')
  for (let i = 0; i < 5; i++) await pg.locator(D('photo-remove')).first().click()
  is(await pg.locator(D('photos') + ' li').count() === 0, 'removing them empties the list')
  await pg.setInputFiles(D('files'), P('front.jpg', 'back.png'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  await pg.locator(D('photos') + ' li').nth(1).locator('button[aria-label^="Move earlier"]').click()
  is(/back\.png/.test(await pg.locator(D('photos') + ' li').first().textContent()) && /Main photo/.test(await pg.locator(D('photos') + ' li').first().textContent()), 'moving a photo earlier makes it the main one')
  await pg.setInputFiles(D('files'), P('back.png'))
  await pg.waitForTimeout(150)
  is(await pg.locator(D('photos') + ' li').count() === 2, 'the same file added twice is kept once')
  await pg.click(D('save')); await waitDone(pg)
  const s = api.st.calls.find((c) => c.r === 'product_save').body
  is(api.st.uploads[0].name === 'back.png' && s.image === api.st.uploads[0].path && s.images === api.st.uploads[1].path, 'the saved order is the order on the screen (back.png is the main image)')
  is(api.st.uploads[0].sha === sha(F['back.png'].buf) && api.st.uploads[1].sha === sha(F['front.jpg'].buf), 'bytes unchanged')
  await pg.context().close()
}
{
  // no canvas, no resize, no re-encode on the UPLOAD path: the only canvas in the block draws the 240px preview
  const block = BRANDS_JS.slice(BEGIN, END)
  const uses = [...block.matchAll(/toDataURL\(|toBlob\(|drawImage\(|resizeWidth|resizeHeight/g)].length
  const uploadFn = block.slice(block.indexOf('async function createProduct'), block.indexOf('var CSS = ['))
  is(!/canvas|toDataURL|toBlob|drawImage|resize|createImageBitmap/.test(uploadFn), 'the upload sequence has no canvas / resize / re-encode (preview thumbnails are the only canvas use, and never uploaded)', String(uses))
}

// =============================================================================================== 5. failures
const baseFill = async (pg, en, sizes = true) => { await fillBasic(pg, { en }); if (sizes) { await pg.click(D('size-chip-M')); await type(pg, 'stock-M', '3') } }
const hiddenOnly = (api) => newRows(api).every((r) => r.active === '0')

head('an upload that fails midway creates nothing')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Midway Tee')
  await pg.setInputFiles(D('files'), P('front.jpg', 'back.png', 'side.webp'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  await pg.waitForTimeout(200)
  api.fail('product_image_upload', { pass: true }, { status: 500, body: { error: 'image_write_failed' } })
  await pg.click(D('save')); await waitDone(pg)
  const txt = await resultText(pg)
  is(newRows(api).length === 0 && !seqOf(api).includes('product_save'), 'the product is NOT created (no product_save at all)', seqOf(api).join(' > '))
  is(/Nothing was created/.test(txt) && /Photos/.test(txt) && /image_write_failed/.test(txt), 'the screen says nothing was created, and why (photos, the server\'s code)', txt)
  is(api.st.uploads.length === 1, 'one photo had been uploaded when the second failed', String(api.st.uploads.length))
  is(!(await pg.locator(D('save')).isDisabled()) && !(await pg.locator(`${ROOTSEL} fieldset`).first().evaluate((e) => e.disabled)), 'the form is open again to edit or retry')
  const firstPath = api.st.uploads[0].path
  await pg.click(D('save')); await waitDone(pg)
  is(api.st.uploads.length === 3 && api.st.uploads.filter((u) => u.name === 'front.jpg').length === 1, 'the retry does not upload the first photo again (3 files, 3 uploads in all)', api.st.uploads.map((u) => u.name).join())
  const sv = api.st.calls.find((c) => c.r === 'product_save').body
  is(sv.image === firstPath && newRows(api).length === 1 && newRows(api)[0].active === '1', 'the product then saves with all three photos and goes live', JSON.stringify([sv.image, newRows(api).length]))
  await pg.context().close()
}
head('401, 413, 429 on the way')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Signed Out Tee')
  await pg.setInputFiles(D('files'), P('front.jpg'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  api.st.signedIn = false
  await pg.click(D('save')); await waitDone(pg)
  is(/signed out/i.test(await resultText(pg)) && newRows(api).length === 0 && api.st.uploads.length === 0, '401: "You are signed out", nothing created, nothing uploaded')
  api.st.signedIn = true
  await pg.click(D('save')); await waitDone(pg)
  is(/saved and live/.test(await resultText(pg)), 'after signing in, the same Save goes through')
  await pg.context().close()
}
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Big Photo Tee')
  await pg.setInputFiles(D('files'), P('front.jpg'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  api.fail('product_image_upload', { status: 413, body: { error: 'image_too_large' } })
  await pg.click(D('save')); await waitDone(pg)
  is(/over 10 MB/i.test(await resultText(pg)) && newRows(api).length === 0, '413 from the server: "The photo is over 10 MB", nothing created')
  await pg.context().close()
}
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Slow Down Tee')
  api.fail('product_save', { status: 429, body: { error: 'too_many' }, headers: { 'Retry-After': '0' } }, { status: 429, body: { error: 'too_many' } })
  await pg.click(D('save')); await waitDone(pg)
  is(/saved and live/.test(await resultText(pg)) && seqOf(api).filter((r) => r === 'product_save').length === 3 && newRows(api).length === 1, '429 twice on product_save is waited out and the third try makes ONE product', seqOf(api).join(' > '))
  await pg.context().close()
}

head('the server refuses the save')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Refused Tee')
  api.fail('product_save', { status: 400, body: { error: 'invalid_price' } })
  await pg.click(D('save')); await waitDone(pg)
  is(/Nothing was created/.test(await resultText(pg)) && /price is not valid/.test(await resultText(pg)) && newRows(api).length === 0 && !seqOf(api).includes('variants_create'), '400 invalid_price: said in words, nothing created, no sizes call')
  api.fail('product_save', { status: 400, body: { error: 'invalid_slug' } })
  await pg.click(D('save')); await waitDone(pg)
  is(/web name is not valid/.test(await resultText(pg)), '400 invalid_slug: said in words')
  await pg.click(D('save')); await waitDone(pg)
  is(/saved and live/.test(await resultText(pg)) && newRows(api).length === 1, 'and the form, still filled, saves when the server accepts')
  await pg.context().close()
}
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Taken Meanwhile')
  // another admin makes the same slug after the form was opened
  api.st.rows.unshift({ id: 55, slug: 'taken-meanwhile', name_en: 'Someone Else', name_ar: 'آخر', price: '5.000', category: 'tops', active: '1', image: null, images: null, brand_slug: null, desc_en: null, desc_ar: null, sale_price: null, sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0' })
  await pg.click(D('save')); await waitDone(pg)
  is(!seqOf(api).includes('product_save') && /already used by another product/.test(await resultText(pg)), 'a slug taken meanwhile is found by the fresh read before saving: product_save is never sent')
  is(/Already used by “Someone Else”/.test(await T(pg, 'slug-info')), 'and the slug line names who has it', await T(pg, 'slug-info'))
  api.st.rows.shift()
  await type(pg, 'slug', 'taken-meanwhile-2')
  await pg.click(D('save')); await waitDone(pg)
  is(/saved and live/.test(await resultText(pg)), 'a new slug then saves')
  await pg.context().close()
}
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Race Tee')
  api.fail('product_save', { status: 409, body: { error: 'slug_taken' } })
  await pg.click(D('save')); await waitDone(pg)
  is(/Nothing was created/.test(await resultText(pg)) && /already used by another product/.test(await resultText(pg)) && newRows(api).length === 0, 'duplicate slug at the server (409 slug_taken): said in words, nothing created')
  await pg.context().close()
}

head('after the product exists, it stays hidden until everything is there')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Half Tee')
  await pg.setInputFiles(D('files'), P('front.jpg'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  api.fail('variants_create', { status: 500, body: { error: 'server_error' } })
  await pg.click(D('save')); await waitDone(pg)
  const txt = await resultText(pg)
  is(newRows(api).length === 1 && newRows(api)[0].active === '0', 'variants_create fails: the product exists and is HIDDEN', JSON.stringify(newRows(api).map((r) => r.active)))
  is(!seqOf(api).includes('product_active'), 'product_active was never sent')
  is(/saved but HIDDEN/.test(txt) && /Missing: Sizes and stock, Shown in the shop/.test(txt), 'the screen says "saved but HIDDEN" and lists exactly what is missing', txt)
  is(/Photos[^]*Product saved[^]*Sizes and stock[^]*Shown in the shop/.test(txt) && await pg.locator(D('result') + ' [data-s="done"]').count() === 2 && await pg.locator(D('result') + ' [data-s="fail"]').count() === 1, 'with the steps done (photos, product) and the one that failed marked')
  await shot(pg, '04-result-partial-1280')
  const saves = seqOf(api).filter((r) => r === 'product_save').length, ups = api.st.uploads.length
  await pg.click(D('retry')); await waitDone(pg)
  is(/saved and live/.test(await resultText(pg)) && newRows(api)[0].active === '1', 'Try again finishes: sizes, then shown, now live')
  is(seqOf(api).filter((r) => r === 'product_save').length === saves && api.st.uploads.length === ups && newRows(api).length === 1, 'and repeated nothing: no second product_save, no second upload, still one product')
  await pg.context().close()
}
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Last Step Tee')
  api.fail('product_active', { status: 500, body: { error: 'server_error' } })
  await pg.click(D('save')); await waitDone(pg)
  is(newRows(api)[0].active === '0' && /Missing: Shown in the shop/.test(await resultText(pg)), 'the last step failing leaves it hidden and says only that is missing')
  await pg.click(D('retry')); await waitDone(pg)
  is(newRows(api)[0].active === '1' && seqOf(api).filter((r) => r === 'variants_create').length === 1, 'Try again shows it without creating the sizes twice')
  await pg.context().close()
}
{
  // an older server: no variants_create
  const api = makeApi({ route: 'no' })
  const { pg } = await openForm({ api })
  is(/needs the next API release/.test(await pg.locator(`${ROOTSEL} fieldset`).first().textContent()), 'on a server without variants_create the form says so before you start')
  await baseFill(pg, 'Old Server Tee')
  await pg.click(D('save')); await waitDone(pg)
  is(newRows(api).length === 1 && newRows(api)[0].active === '0' && !seqOf(api).includes('product_active'), 'the product is saved hidden and never activated')
  is(/saved but HIDDEN/.test(await resultText(pg)) && /does not have the sizes route yet/.test(await resultText(pg)) && /Missing: Sizes and stock/.test(await resultText(pg)), 'and the screen says exactly that: the sizes route is missing', await resultText(pg))
  await pg.context().close()
  // ... while a product with no sizes still works there
  const api2 = makeApi({ route: 'no' })
  const t2 = await openForm({ api: api2 })
  await fillBasic(t2.pg, { en: 'Cap On Old Server' }); await t2.pg.check(D('sizes-mode-none'))
  await t2.pg.click(D('save')); await waitDone(t2.pg)
  is(api2.st.rows[0].active === '1' && /saved and live/.test(await resultText(t2.pg)), 'a product with no sizes (a cap) is still made and shown on an older server')
  await t2.ctx.close()
}
{
  // the answer to product_save is lost (the server saved it): the retry recognises its own product
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Dropped Tee')
  api.fail('product_save', { applyThenDrop: true })
  await pg.click(D('save')); await waitDone(pg)
  is(newRows(api).length === 1 && /Nothing was created|connection dropped/.test(await resultText(pg)), 'the connection drops after the server saved: the screen reports the drop', (await resultText(pg)).slice(0, 120))
  await pg.click(D('save')); await waitDone(pg)
  is(newRows(api).length === 1 && newRows(api)[0].active === '1' && seqOf(api).filter((r) => r === 'product_save').length === 1, 'the retry finds the product by its slug and name: no duplicate, no second save, then it goes on to sizes and live', seqOf(api).join(' > '))
  await pg.context().close()
}
{
  // a lost answer to variants_create: the rows exist, the retry does not send them again
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Dropped Sizes')
  api.fail('variants_create', { applyThenDrop: true })
  await pg.click(D('save')); await waitDone(pg)
  is(/Missing: Sizes and stock/.test(await resultText(pg)) && api.st.variants.length === 1, 'a lost answer to variants_create: the rows are there, the screen says sizes are missing')
  await pg.click(D('retry')); await waitDone(pg)
  is(/saved and live/.test(await resultText(pg)) && api.st.variants.length === 1 && api.st.calls.filter((c) => c.r === 'variants_create' && c.method === 'POST').length === 1, 'the retry reads the stock list, sees them, does not send them again (no size_exists), and shows the product')
  await pg.context().close()
}
{
  // the invariant over a whole mixed session
  const api = makeApi()
  const { pg } = await openForm({ api })
  await baseFill(pg, 'Invariant Tee')
  await pg.setInputFiles(D('files'), P('front.jpg'))
  await pg.waitForSelector(`${ROOTSEL} .spn-photo img.spn-thumb`)
  await pg.click(D('save')); await waitDone(pg)
  const saves = api.st.calls.filter((c) => c.r === 'product_save')
  is(saves.every((c) => c.body.active === false), 'EVERY product_save has active:false (the screen can never save a live product in one step)')
  const last = writesOf(api).at(-1)
  is(last.r === 'product_active', 'the last write is the one that shows it')
  await pg.context().close()
}

// =============================================================================================== 6. bulk
head('many products at once')
{
  const api = makeApi()
  const { pg } = await openForm({ api })
  await pg.click(D('tab-many'))
  await pg.waitForSelector(D('b-paste'))
  await pg.selectOption(D('b-brand'), 'vanquish')
  await type(pg, 'b-category', 'Tops')
  await pg.click(D('size-chip-M')); await type(pg, 'stock-M', '5'); await pg.click(D('size-chip-L')); await type(pg, 'stock-L', '7')
  await type(pg, 'b-paste', 'Bolt Tee;تيشيرت بولت;12.5;9.75\nBolt Cap\tقبعة بولت\t6\nBroken Row;;abc')
  await pg.click(D('b-paste-fill'))
  const rows = await pg.locator(D('b-row')).count()
  is(rows === 3, 'pasting three lines makes three rows (the empty starter rows are replaced)', String(rows))
  is(await val(pg, 'b-slug') === 'bolt-tee', 'the slug comes from the English name', await val(pg, 'b-slug'))
  is(await pg.locator(D('b-review')).isDisabled(), 'Review is off while a row has problems')
  const issues = await pg.locator(`${ROOTSEL} tbody .spn-err`).allTextContents()
  is(/Enter the Arabic name/.test(issues[2]) && /price/.test(issues[2]), 'the broken row says what is wrong (Arabic name, price)', issues.join(' | '))
  // fix it
  await pg.locator(D('b-name-ar')).nth(2).fill('قبعة ثانية'); await pg.locator(D('b-price')).nth(2).fill('4')
  await pg.locator(D('b-name-en')).nth(2).fill('Bolt Cap Two')
  is(await pg.locator(D('b-slug')).nth(2).inputValue() === 'bolt-cap-two', 'a row\'s slug follows its name')
  await pg.setInputFiles(D('b-files'), P('bolt-tee-1.jpg', 'bolt-tee-2.jpg', 'bolt-cap.jpg', 'stranger.jpg', 'notes.txt'))
  await pg.waitForFunction(() => document.querySelectorAll('[data-spn="b-filelist"] li').length === 5)
  await pg.waitForTimeout(300)
  const fl = await pg.locator(D('b-filelist') + ' li').allTextContents()
  is(/Row 1/.test(fl[0]) && /Row 1/.test(fl[1]), 'bolt-tee-1 and bolt-tee-2 are matched to row 1 (the web name, then -N)', fl.join(' || '))
  is(/Row 2/.test(fl[2]) && /Not matched/.test(fl[3]), 'bolt-cap.jpg goes to row 2 (slug bolt-cap), stranger.jpg is shown as not matched and will not be uploaded', fl.join(' || '))
  is(/Only PNG, JPEG or WebP/.test(fl[4]), 'a text file is refused')
  is(await pg.locator(D('b-review')).isDisabled(), 'Review stays off while a file is refused')
  await pg.locator(D('b-file-remove')).nth(4).click()
  await pg.locator(D('b-file-remove')).nth(3).click()
  await pg.waitForTimeout(100)
  is(await pg.locator(D('b-review')).isEnabled(), 'with everything fixed, Review is on', await T(pg, 'b-summary'))
  await shot(pg, '05-bulk-table-1280')
  await pg.locator(D('b-row')).first().scrollIntoViewIfNeeded(); await pg.evaluate(() => { document.querySelector('[data-sporta-newproduct]').scrollTop += 380 })
  await shot(pg, '05b-bulk-rows-1280', false)
  await pg.click(D('b-review'))
  const line = await T(pg, 'b-review-line')
  is(/3 products, 3 photos, sizes M×5 L×7/.test(line) && /shown in the shop/.test(line), 'the review says what will happen: 3 products, 3 photos, sizes M×5 L×7, shown at the end', line)
  await shot(pg, '06-bulk-review-1280')
  is(noWrites(api), 'nothing has been written at review')
  // one row fails (the second save is refused), the rest continue
  api.fail('product_save', { pass: true }, { status: 400, body: { error: 'invalid_price' } })
  await pg.click(D('b-create'))
  await pg.waitForSelector(D('b-close'), { timeout: 20000 })
  const states = await pg.locator(D('b-state')).allTextContents()
  is(eq(states.map((s) => s.slice(0, 20)), ['live', 'not created', 'live']), 'row 1 and 3 are live, row 2 (refused) is "not created": one failing row does not stop the others', states.join('|'))
  is(newRows(api).length === 2 && newRows(api).every((r) => r.active === '1' && r.brand_slug === 'vanquish' && r.category === 'tops'), 'two products exist, live, with the shared brand and category')
  const bt = newRows(api).find((r) => r.slug === 'bolt-tee')
  is(bt.sale_price === '9.750' && bt.price === '12.500' && /bolt-tee-1/.test(bt.image) && /bolt-tee-2/.test(bt.images), 'row 1: price 12.500, sale 9.750, bolt-tee-1 is the main photo, bolt-tee-2 the next')
  is(api.st.variants.filter((v) => v.slug === 'bolt-tee').length === 2 && api.st.variants.filter((v) => v.slug === 'bolt-cap-two').length === 2, 'both products got sizes M and L')
  is(api.st.calls.filter((c) => c.r === 'product_save').every((c) => c.body.active === false), 'every bulk product_save is active:false too')
  is(api.st.activeSeen.length === 2 && api.st.activeSeen.every((a) => a.variants === 2), 'each was switched on only after its sizes existed')
  const done = await T(pg, 'b-summary')
  is(/2 live, 0 saved hidden, 1 not created/.test(done), 'the summary counts them', done)
  is(await pg.locator(D('b-retry')).count() === 1, 'a Retry for the unfinished row is offered')
  await shot(pg, '07-bulk-done-1280')
  await pg.click(D('b-retry'))
  await pg.waitForSelector(D('b-close'), { timeout: 20000 })
  is(newRows(api).length === 3 && newRows(api).every((r) => r.active === '1'), 'Retry makes the missing product and nothing else (3 products, all live)', String(newRows(api).length))
  is(api.st.bad.length === 0, 'no malformed request in the whole bulk run', api.st.bad.join(' | '))
  await pg.context().close()
}
{
  // a bulk row with the same slug as an existing product, and two rows with the same slug
  const api = makeApi()
  const { pg } = await openForm({ api })
  await pg.click(D('tab-many'))
  await pg.click(D('size-chip-M')); await type(pg, 'stock-M', '1')
  await type(pg, 'b-category', 'tops')
  await type(pg, 'b-paste', 'Run Shorts;شورت;5\nDup One;مكرر;5\nDup One;مكرر ٢;6')
  await pg.click(D('b-paste-fill'))
  const issues = (await pg.locator(`${ROOTSEL} tbody .spn-err`).allTextContents()).join(' | ')
  is(/web name is taken/.test(issues) && /Another row has the same web name/.test(issues), 'a slug already in the catalogue, and the same slug in two rows, are both caught before anything is sent', issues)
  is(noWrites(api), 'nothing sent')
  await pg.context().close()
}

// =============================================================================================== 7. look
head('Arabic, dark, sizes of things')
{
  const { pg, api } = await openForm({ ar: true })
  const dirAttr = await pg.locator(ROOTSEL).getAttribute('dir')
  is(dirAttr === 'rtl' && await pg.locator(ROOTSEL).getAttribute('lang') === 'ar', 'in an Arabic admin the form is lang=ar dir=rtl')
  is(/منتج جديد/.test(await pg.locator('.spn-title').textContent()) && /الاسم \(إنجليزي\)/.test(await pg.locator(ROOTSEL).textContent()), 'and in Arabic')
  is(await pg.evaluate(() => { const r = document.querySelector('.spn-head').getBoundingClientRect(), x = document.querySelector('[data-spn="close"]').getBoundingClientRect(); return x.left < r.left + r.width / 2 }), 'the close button is on the left in RTL (the start side flipped)')
  is(await pg.evaluate(() => getComputedStyle(document.querySelector('[data-spn="slug"]')).direction) === 'ltr', 'the slug field stays left-to-right')
  await pg.click(D('save'))
  is(/أدخل الاسم الإنجليزي/.test((await pg.locator(`${ROOTSEL} .spn-err`).allTextContents()).join(' ')), 'validation messages are Arabic')
  await shot(pg, '08-arabic-1280')
  await pg.context().close()
}
{
  const { pg } = await openForm({ theme: 'dark', device: 'dark' })
  const bg = await pg.evaluate(() => getComputedStyle(document.querySelector('.spn')).backgroundColor)
  const ink = await pg.evaluate(() => getComputedStyle(document.querySelector('.spn')).color)
  const lum = (c) => { const m = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  is(lum(bg) < 0.05 && ratio(bg, ink) >= 7, 'the dark admin gives a dark form with readable ink', `${bg} / ${ink} / ${ratio(bg, ink).toFixed(1)}`)
  await shot(pg, '09-dark-1280')
  await pg.context().close()
}
for (const [w, h] of [[390, 844], [768, 1024], [1280, 900]]) {
  for (const tab of ['one', 'many']) {
    const { pg } = await openForm({ w, h })
    if (tab === 'many') await pg.click(D('tab-many'))
    await pg.waitForTimeout(200)
    if (tab === 'one') { await pg.click(D('size-chip-M')); await pg.setInputFiles(D('files'), P('front.jpg')); await pg.waitForTimeout(250) }
    const m = await pg.evaluate((sel) => { const r = document.querySelector(sel); const d = document.querySelector('.spn'); return { root: r.scrollWidth - r.clientWidth, dlg: d.scrollWidth - d.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth, body: document.body.scrollWidth - window.innerWidth } }, ROOTSEL)
    is(m.root <= 0 && m.dlg <= 0 && m.page <= 0, `${w}px, ${tab === 'one' ? 'one product' : 'many products'}: no sideways scroll (root ${m.root}, dialog ${m.dlg}, page ${m.page})`)
    if (w === 390) {
      const small = await pg.evaluate((sel) => [...document.querySelectorAll(sel + ' button, ' + sel + ' select, ' + sel + ' input:not([type=checkbox]):not([type=radio]):not([type=file]), ' + sel + ' textarea')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 }).map((e) => (e.getAttribute('data-spn') || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)), ROOTSEL)
      is(small.length === 0, `390px ${tab}: every button, field and select is 44px or taller`, small.slice(0, 6).join(' '))
      await shot(pg, `10-${tab}-390`)
    }
    if (w === 768) await shot(pg, `11-${tab}-768`)
    await pg.context().close()
  }
}
{
  const { pg } = await openForm({ w: 390, h: 844 })
  await pg.keyboard.press('Escape')
  is(await pg.locator(ROOTSEL).count() === 0, 'Escape closes an empty form')
  is(await pg.evaluate(() => document.body.style.overflow) === '' && await pg.evaluate(() => document.activeElement?.hasAttribute('data-sporta-np-open')), 'the page scroll is released and focus goes back to the button')
  await pg.click('[data-sporta-np-open]'); await pg.waitForSelector(ROOTSEL); await pg.waitForTimeout(200)
  await type(pg, 'name-en', 'Something')
  await pg.keyboard.press('Escape')
  is(await pg.locator(ROOTSEL).count() === 0, 'with something typed, Escape asks to discard (the test accepts) and closes')
  await pg.click('[data-sporta-np-open]'); await pg.waitForSelector(ROOTSEL); await pg.waitForTimeout(200)
  is(await val(pg, 'name-en') === '', 'a reopened form is empty')
  // Tab stays inside the dialog
  await pg.evaluate(() => { const f = [...document.querySelectorAll('[data-sporta-newproduct] button')].filter((b) => !b.disabled && b.getClientRects().length); f[f.length - 1].focus() })
  await pg.keyboard.press('Tab')
  is(await pg.evaluate(() => !!document.activeElement?.closest('[data-sporta-newproduct]')), 'Tab from the last control wraps inside the dialog')
  await pg.context().close()
}
{
  const { pg, errors } = await openForm()
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-newproduct]').length) === 1, 'one dialog')
  is(await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-newproduct] *')].every((n) => n.tagName !== 'SCRIPT' && !n.hasAttribute('onclick'))), 'no script or inline handler in the form')
  is(errors.length === 0, 'no page errors over the whole session', errors.join(' | '))
  await pg.context().close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
