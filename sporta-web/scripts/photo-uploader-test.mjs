// The Photos panel (block "ADMIN PHOTO UPLOADER", the last one in public/sporta-admin-brands.js): the bulk
// product-photo uploader on the admin Catalogue screen, in a real browser.
//
//   npm run test:photo-uploader      (rig-free: no database, no PHP, no server; the admin API is a fake answered by
//                                     route interception; the REAL add-on file, real Tailwind, the build's own light base
//                                     and its REAL dark rules, and the real public/sporta-admin-knet.css are on the page)
//
// What is asserted:
//   - the panel exists on the Catalogue screen only (above the product table), once, and leaves with the screen;
//   - file name -> product: slug, name, separators, -N / _N / " N" / (N) positions, a whole-name match beating a split
//     (air-max-90 is not air-max, position 90), an ambiguous name left for the owner, unmatched files flagged; the owner
//     can change the product from a searchable list (keyboard only) and the position;
//   - thumbnails, size, pixel size and format; warnings under 1200 px, off 4:5, over 10 MiB (not queued); non-image,
//     SVG, GIF and empty files refused; a product whose description product_save would cut at 280 characters is HELD
//     BACK and nothing of it is uploaded;
//   - ONE request in flight at a time over the whole run; queue order (by product, by position); the upload body is the
//     file's own bytes (sha-256 equal), named as the file; the fake route validates like the real one (magic number,
//     declared type, 10 MiB, name stem, XSRF header, JSON type);
//   - the product rows saved, EXACT bodies: every field as read, only image/images changed (main when the product has
//     none or the file is position 1, else appended in order), PDO-style string numbers coerced for the strict checks;
//   - HTTP 429 backed off and retried (Retry-After honoured; 1, 2, 4 ... otherwise; gives up after 6 tries with a Retry
//     button); 401 stops cleanly with the rest still waiting and continues after signing in; an upload failure and a
//     save failure are shown per file, and retrying a file that was uploaded does NOT upload it again;
//   - only the three routes named in the brief are called, only two of them by POST, and nothing is ever deleted;
//   - the log of paths written (with what each product had before) in the panel, copyable, kept for the next visit;
//   - nothing outside the panel changes (DOM diff of the rest of the screen, one <style> added to the head), the Save
//     bar of block 5 never mistakes a panel button for a Save, and blocks 1-4 do not start throwing;
//   - 390 px (touch, 44 px targets, no sideways scroll) and 1280 px; English LTR and Arabic RTL (Arabic-Indic digits only,
//     the Arabic comma, tanwin written ـًا); light, dark (the admin's own switch: html.dark / data-theme, a stored light
//     choice on a dark device stays light) with every text element at 4.5:1 or better; visible focus ring; aria-live text;
//   - it keeps working when the compiled screen re-renders (main rebuilt, the table swapped, the whole list replaced);
//   - MUTATION CHECK: with the block cut out of the file the same screen has no panel.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE, PRODUCTS, BRANDS, SCREEN, ORDERS, LIST, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const i2 = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), i2)
const DARK_ADMIN = DARK.slice(i2)
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN PHOTO UPLOADER - begin')
const END_MARK = '/* ===== ADMIN PHOTO UPLOADER - end'
const END = BRANDS_JS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN PHOTO UPLOADER block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))

let pass = 0, fail = 0
let sink = null
const is = (ok, msg, detail = '') => {
  if (sink) { sink.push({ ok: !!ok, msg }); return }
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const clone = (x) => JSON.parse(JSON.stringify(x))

// ------------------------------------------------------------------------------------------------ the page
const SCREENS = { catalogue: SCREEN, orders: ORDERS, overview: '<section class="admin-page"><h1 class="text-2xl font-bold">Overview</h1></section>', brands: '<section class="admin-page"><h1 class="text-2xl font-bold">Brands</h1></section>' }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'photo-uploader-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ theme, ar, screen }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" ${theme === 'dark' ? 'class="dark" data-theme="dark" style="color-scheme:dark"' : 'data-theme="light" style="color-scheme:light"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${DARK_INDEX}</style><style>${KNET_CSS}</style><style id="darkadmin">${DARK_ADMIN}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`

// ------------------------------------------------------------------------------------------------ the fake admin API
const MAX = 10 * 1024 * 1024
function dimsOf(b, mime) {
  if (mime === 'image/png') return [b.readUInt32BE(16), b.readUInt32BE(20)]
  if (mime === 'image/webp') {
    const tag = b.toString('latin1', 12, 16)
    if (tag === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
    if (tag === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)] }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
  }
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
    if (m === 0xd8 || m === 0xff) { i += m === 0xff ? 1 : 2; continue }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return [0, 0]
}
const magic = (b) => (b.length > 11 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : '')
const KEYS = ['id', 'slug', 'name_en', 'name_ar', 'desc_en', 'desc_ar', 'price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'featured', 'featured_sort', 'category', 'brand_slug', 'image', 'images', 'active']

function makeApi() {
  const st = { rows: clone(PRODUCTS), signedIn: true, calls: [], inflight: 0, maxInflight: 0, uploads: [], saves: [], truncated: 0, unknown: [], uploadFaults: [], saveFaults: [], readFaults: [], delay: 12, badRequests: [] }
  const out = (status, body, headers = {}) => ({ status, body, headers })
  const bad = (msg) => { st.badRequests.push(msg); return out(400, { error: 'bad_request' }) }
  function upload(rec) {
    const fault = st.uploadFaults.shift()
    if (fault) return out(fault.status, fault.body || { error: 'x' }, fault.headers)
    const b = rec.body || {}
    const data = String(b.data || '')
    if (data.length > 14 * 1024 * 1024) return out(413, { error: 'image_too_large' })
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data)
    if (!m) return out(400, { error: 'image_bad_format' })
    const bytes = Buffer.from(m[2], 'base64')
    if (!bytes.length || bytes.length > MAX) return out(413, { error: 'image_too_large' })
    const mime = magic(bytes)
    if (!mime || mime !== m[1]) return out(400, { error: 'image_not_an_image' })
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]
    let stem = String(b.name || 'product-image').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!stem) stem = 'product-image'
    stem = stem.slice(0, 60)
    const path = `/images/products/${stem}-${randomBytes(5).toString('hex')}.${ext}`
    const [w, h] = dimsOf(bytes, mime)
    st.uploads.push({ name: b.name, path, sha: sha(bytes), size: bytes.length, mime, w, h, t: Date.now() })
    return out(200, { path, width: w, height: h, bytes: bytes.length, mime })
  }
  function save(rec) {
    const fault = st.saveFaults.shift()
    if (fault) return out(fault.status, fault.body || { error: 'x' }, fault.headers)
    const b = rec.body || {}
    for (const k of KEYS) if (!(k in b)) return bad('product_save without ' + k)
    const strictBool = (v) => typeof v === 'boolean' || v === 0 || v === 1
    if (!Number.isInteger(b.id) || b.id < 0) return out(400, { error: 'invalid_product_id' })
    const slug = String(b.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug || slug.length > 80) return out(400, { error: 'invalid_slug' })
    if (!String(b.name_en || '').trim() || !String(b.name_ar || '').trim()) return out(400, { error: 'missing_name_en' })
    const money = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/
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
    }
    const href = /^\/(?![/\\])[A-Za-z0-9/_\-?=&%.#]{0,180}$/
    const list = String(b.images || '').split(',').map((s) => s.trim()).filter(Boolean)
    for (const p of list.concat(String(b.image || '').trim() ? [String(b.image).trim()] : [])) if (!href.test(p)) return out(400, { error: 'invalid_link' })
    if (b.brand_slug && !BRANDS.includes(b.brand_slug)) return out(400, { error: 'unknown_brand' })
    const cut = (v) => { const t = v == null ? '' : String(v).trim(); if (!t) return null; if ([...t].length > 280) st.truncated++; return [...t].slice(0, 280).join('') }
    const row = st.rows.find((r) => Number(r.id) === b.id)
    if (!row) return out(404, { error: 'product_not_found' })
    Object.assign(row, { slug, name_en: String(b.name_en).trim(), name_ar: String(b.name_ar).trim(), desc_en: cut(b.desc_en), desc_ar: cut(b.desc_ar),
      price: Number(b.price).toFixed(3), sale_price: sale, sale_starts_at: from, sale_ends_at: to, featured: String(+!!b.featured), featured_sort: String(b.featured_sort),
      category: cut(b.category), brand_slug: b.brand_slug || null, image: String(b.image || '').trim() || null, images: list.length ? list.join(',') : null, active: String(+!!b.active) })
    st.saves.push({ body: clone(b), t: Date.now() })
    return out(200, clone(row))
  }
  function respond(rec, req) {
    if (rec.r === 'brands' || rec.r === 'brand_products') return out(200, [])
    if (!['products_all', 'product_image_upload', 'product_save'].includes(rec.r)) { st.unknown.push(rec.method + ' ' + rec.r); return out(404, { error: 'not_found' }) }
    if (!st.signedIn) return out(401, { error: 'not_signed_in' })
    const hdr = req.headers()
    if (rec.method === 'POST') {
      if (hdr['x-sporta-admin'] !== '1') return bad('missing X-Sporta-Admin')
      if (!/^application\/json/.test(hdr['content-type'] || '')) return bad('not json')
      try { rec.body = JSON.parse(req.postData() || '') } catch { return bad('body is not JSON') }
    } else if (hdr['x-sporta-admin'] !== '1') return bad('GET without X-Sporta-Admin')
    if (rec.r === 'products_all') { const f = st.readFaults.shift(); if (f) return out(f.status, f.body || { error: 'x' }); return out(200, clone(st.rows)) }
    if (rec.r === 'product_image_upload') return rec.method === 'POST' ? upload(rec) : out(405, { error: 'method' })
    return rec.method === 'POST' ? save(rec) : out(405, { error: 'method' })
  }
  async function handle(route) {
    const req = route.request()
    const u = new URL(req.url())
    const rec = { r: u.searchParams.get('r') || '', method: req.method(), t: Date.now(), body: null }
    st.calls.push(rec)
    st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight)
    await sleep(st.delay)
    let res
    try { res = respond(rec, req) } finally { st.inflight-- }
    rec.status = res.status
    await route.fulfill({ status: res.status, contentType: 'application/json', headers: res.headers, body: JSON.stringify(res.body) })
  }
  const mine = (st2 = st) => st2.calls.filter((c) => ['products_all', 'product_image_upload', 'product_save'].includes(c.r))
  return { st, handle, mine }
}

// ------------------------------------------------------------------------------------------------ the browser
const dir = mkdtempSync(join(tmpdir(), 'sporta-photos-'))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const SEL = '[data-sporta-photos]'

async function open({ w = 1280, h = 900, theme = 'light', ar = false, device = 'light', screen = 'catalogue', js = BRANDS_JS, api = makeApi(), pace = 5, backoff = 30, goto = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: device, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', acceptDownloads: true })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {})
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.addInitScript(([pc, bo]) => { window.SPORTA_PHOTOS = { paceMs: pc, backoffMs: bo } }, [pace, backoff])
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    if (u.pathname === '/api/admin.php') return api.handle(route)
    if (u.pathname === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}` })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: js })
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: pageHtml({ theme: u.searchParams.get('theme') || theme, ar: u.searchParams.get('ar') === '1' || ar, screen: u.searchParams.get('screen') || screen }) })
  })
  if (goto) { await pg.goto(`${ORIGIN}/backends`); await pg.waitForTimeout(450) }
  return { ctx, pg, errors, api }
}

// Test images, made by the browser's own encoders once, written to disk.
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
put('vanquish-tee-white-1.jpg', await makeImage('image/jpeg', 1200, 1500, 1))
put('vanquish-tee-white-2.png', await makeImage('image/png', 1200, 1500, 2))
put('Vanquish_Tee_White 3.webp', await makeImage('image/webp', 1200, 1500, 3))
put('air-max-90.jpg', await makeImage('image/jpeg', 1000, 1000, 4))
put('air-max-2.jpg', await makeImage('image/jpeg', 1600, 2000, 5))
put('mystery.jpg', await makeImage('image/jpeg', 1200, 1500, 6))
put('long-desc-hoodie-1.jpg', await makeImage('image/jpeg', 1200, 1500, 7))
put('team-hoodie.jpg', await makeImage('image/jpeg', 1200, 1500, 8))
put('run-shorts (2).jpg', await makeImage('image/jpeg', 1200, 1500, 9))
put('notes.txt', Buffer.from('hello'))
put('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>'))
put('anim.gif', Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1'))
put('empty.png', Buffer.alloc(0))
put('huge.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX + 100)]))
const P = (...names) => names.map((n) => F[n].path)

// ------------------------------------------------------------------------------------------------ helpers
const rowsOf = (pg) => pg.evaluate((sel) => [...document.querySelectorAll(sel + ' .sph-row')].map((li) => ({
  name: li.querySelector('.sph-name')?.textContent || '', state: li.getAttribute('data-state'),
  slug: li.querySelector('.sph-who code')?.textContent || '', who: li.querySelector('.sph-who')?.textContent || '',
  pos: li.querySelector('select[data-k=pos]')?.value ?? null, meta: li.querySelector('.sph-meta')?.textContent || '',
  warns: [...li.querySelectorAll('.sph-warns li')].map((x) => x.textContent), detail: [...li.querySelectorAll('.sph-detail')].map((x) => x.textContent).join(' | '),
  badge: li.querySelector('.sph-badge')?.textContent || '', thumb: !!li.querySelector('img.sph-thumb'), buttons: [...li.querySelectorAll('button')].map((b) => b.getAttribute('data-k')),
})), SEL)
const rowFor = async (pg, name) => (await rowsOf(pg)).find((r) => r.name === name)
const addFiles = async (pg, paths) => { await pg.setInputFiles(`${SEL} [data-sph=input]`, paths); await pg.waitForFunction((sel) => [...document.querySelectorAll(sel + ' .sph-row')].every((li) => li.getAttribute('data-state') !== 'checking'), SEL, { timeout: 10000 }); await pg.waitForTimeout(80) }
const waitIdle = (pg) => pg.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-busy') === 'false', SEL, { timeout: 30000 })
const startBtn = (pg) => pg.locator(`${SEL} [data-k=start]`)
const statusOf = (pg) => pg.locator(`${SEL} [data-sph=status]`).textContent()
const uploadAll = async (pg) => { await startBtn(pg).click(); await pg.waitForTimeout(30); await waitIdle(pg) }
// the screen, without the panel and without the injected style: what "nothing else changed" compares
const shellHtml = (pg) => pg.evaluate((sel) => { const c = document.querySelector('.admin-shell').cloneNode(true); c.querySelectorAll(sel).forEach((n) => n.remove()); return c.outerHTML }, SEL)
const mainOnly = (pg) => pg.evaluate((sel) => { const c = document.querySelector('#main').cloneNode(true); c.querySelectorAll(sel).forEach((n) => n.remove()); return c.innerHTML }, SEL)
const rowOf = (api, id) => api.st.rows.find((r) => r.id === id)

const GOOD = ['vanquish-tee-white-1.jpg', 'vanquish-tee-white-2.png', 'Vanquish_Tee_White 3.webp', 'air-max-90.jpg', 'air-max-2.jpg']

// =============================================================================================== 1. the screen
head('the panel is on the Catalogue screen only')
{
  const { pg, errors, api } = await open()
  const count = () => pg.locator(SEL).count()
  is(await count() === 1, 'one panel on the Catalogue screen')
  is(await pg.evaluate((sel) => { const p = document.querySelector(sel); return p.nextElementSibling?.id === 'product-table-wrap' && p.parentElement.id === 'product-list' }, SEL), 'it sits directly above the product table, inside the product list section')
  is(await pg.evaluate((sel) => !!document.querySelector(sel)?.closest('main'), SEL), 'inside the main content area')
  is(await pg.evaluate(() => document.querySelectorAll('style[data-sporta-photos-style]').length) === 1, 'one style element added to the head')
  is(await pg.locator(`${SEL} h3`).textContent() === 'Photos', 'titled Photos')
  const before = await shellHtml(pg)
  await pg.evaluate(() => window.fx.go('orders')); await pg.waitForTimeout(200)
  is(await count() === 0, 'the panel is gone when the screen is Orders')
  await pg.evaluate(() => window.fx.go('overview')); await pg.waitForTimeout(150)
  is(await count() === 0, 'and on Overview')
  await pg.evaluate(() => window.fx.go('catalogue')); await pg.waitForTimeout(250)
  is(await count() === 1, 'it comes back with the Catalogue screen')
  is(await shellHtml(pg) === before, 'the screen without the panel is byte-for-byte what it was')
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-savebar]').length) === 0, 'the Save bar of block 5 is not triggered by the panel')
  is(api.st.calls.filter((c) => c.r === 'products_all').length >= 1, 'products are read from products_all')
  is(await pg.locator(`${SEL} [role=status]`).count() >= 2, 'status text is in aria-live regions')
  is(errors.length === 0, 'no page errors (blocks 1-6 together)', errors.join(' | '))
  // evaluated twice: still one panel
  await pg.evaluate((src) => { (0, eval)(src) }, BRANDS_JS.slice(BEGIN, END)); await pg.waitForTimeout(150)
  is(await count() === 1, 'the file evaluated a second time still makes one panel')
  // mutation
  const m = await open({ js: WITHOUT })
  is(await m.pg.locator(SEL).count() === 0, 'MUTATION: with the block cut out of the file there is no panel')
  await m.ctx.close()
  await pg.context().close()
}

// =============================================================================================== 2. matching
head('file name -> product')
{
  const { pg, api } = await open()
  await addFiles(pg, P(...GOOD, 'mystery.jpg', 'team-hoodie.jpg', 'long-desc-hoodie-1.jpg', 'run-shorts (2).jpg'))
  const R = Object.fromEntries((await rowsOf(pg)).map((r) => [r.name, r]))
  const expect = (name, slug, pos) => is(R[name]?.slug === slug && R[name]?.pos === pos, `${name} -> ${slug || '(none)'} position ${pos === '' ? 'auto' : pos}`, JSON.stringify(R[name]))
  expect('vanquish-tee-white-1.jpg', 'vanquish-tee-white', '1')
  expect('vanquish-tee-white-2.png', 'vanquish-tee-white', '2')
  expect('Vanquish_Tee_White 3.webp', 'vanquish-tee-white', '3')
  expect('air-max-90.jpg', 'air-max-90', '')
  expect('air-max-2.jpg', 'air-max', '2')
  expect('run-shorts (2).jpg', 'run-shorts', '2')
  expect('long-desc-hoodie-1.jpg', 'long-desc-hoodie', '1')
  is(R['mystery.jpg'].slug === '' && R['mystery.jpg'].state === 'needs', 'an unmatched file is flagged "Choose a product"', JSON.stringify(R['mystery.jpg']))
  is(R['team-hoodie.jpg'].slug === '' && R['team-hoodie.jpg'].state === 'needs' && R['team-hoodie.jpg'].warns.some((w) => /more than one/.test(w)), 'two products called "Team Hoodie": not guessed, said so', JSON.stringify(R['team-hoodie.jpg']))
  is(R['long-desc-hoodie-1.jpg'].state === 'held' && /280/.test(R['long-desc-hoodie-1.jpg'].warns.join(' ')), 'a product whose description is over 280 characters is held back, with the reason')
  // thumbnails, size, dimensions, format
  const a = R['vanquish-tee-white-1.jpg']
  is(a.thumb, 'a thumbnail is shown')
  is(/1200×1500 px/.test(a.meta) && /JPEG/.test(a.meta) && /(KB|MB)/.test(a.meta), 'size, pixel size and format are shown', a.meta)
  is(R['vanquish-tee-white-2.png'].meta.includes('PNG') && R['Vanquish_Tee_White 3.webp'].meta.includes('WebP'), 'PNG and WebP are recognised by their bytes')
  is(R['vanquish-tee-white-1.jpg'].warns.length === 0, 'a 1200x1500 (4:5) photo has no warning', R['vanquish-tee-white-1.jpg'].warns.join('|'))
  is(R['air-max-90.jpg'].warns.some((w) => /1000×1000.*under 1200/.test(w)) && R['air-max-90.jpg'].warns.some((w) => /Not 4:5/.test(w)), '1000x1000: warns about the 1200 px floor and the 4:5 frame', R['air-max-90.jpg'].warns.join('|'))
  is(R['air-max-2.jpg'].warns.length === 0, '1600x2000 is fine')
  is((await startBtn(pg).textContent()) === 'Upload 6 photos', 'Upload counts only the ready files (the unmatched, ambiguous and held ones are not)', await startBtn(pg).textContent())
  is(/ready/.test(await pg.locator(`${SEL} .sph-hint`).textContent()) && /need a product/.test(await pg.locator(`${SEL} .sph-hint`).textContent()), 'ready / need-a-product counts are shown')

  // refusals
  await addFiles(pg, P('notes.txt', 'logo.svg', 'anim.gif', 'empty.png', 'huge.png'))
  const R2 = Object.fromEntries((await rowsOf(pg)).map((r) => [r.name, r]))
  is(['notes.txt', 'anim.gif'].every((n) => R2[n].state === 'refused' && /Only PNG, JPEG and WebP/.test(R2[n].warns.join(' '))), 'a text file and a GIF are refused as formats')
  is(R2['logo.svg'].state === 'refused' && /SVG/.test(R2['logo.svg'].warns.join(' ')), 'SVG is refused, and says why')
  is(R2['empty.png'].state === 'refused' && /empty/.test(R2['empty.png'].warns.join(' ')), 'an empty file is refused')
  is(R2['huge.png'].state === 'toolarge' && /Over 10 MB/.test(R2['huge.png'].warns.join(' ')) && /Nothing was shrunk/.test(R2['huge.png'].warns.join(' ')), 'a file over 10 MiB is not queued and is never shrunk')
  is(!R2['notes.txt'].buttons.includes('change') && !R2['huge.png'].buttons.includes('change'), 'refused files offer no product choice, only Remove')
  is((await startBtn(pg).textContent()) === 'Upload 6 photos', 'refused files do not change the upload count')
  // duplicates
  await pg.setInputFiles(`${SEL} [data-sph=input]`, P('mystery.jpg')); await pg.waitForTimeout(150)
  is((await rowsOf(pg)).filter((r) => r.name === 'mystery.jpg').length === 1 && /already in the list/.test(await statusOf(pg)), 'the same file added twice is listed once, and said so')

  // the owner changes the product from a searchable list, by keyboard only
  await pg.locator(`.sph-row:has(.sph-name:text-is("mystery.jpg")) [data-k=change]`).focus()
  await pg.keyboard.press('Enter')
  is(await pg.evaluate(() => document.activeElement?.getAttribute('data-k')) === 'psearch', 'Change opens the search list and puts the cursor in it')
  await pg.keyboard.type('shorts')
  is(await pg.locator(`${SEL} .sph-row:has(.sph-name:text-is("mystery.jpg")) .sph-results button`).count() === 1, 'typing narrows the list (name or web name)')
  await pg.keyboard.press('Escape')
  is(await pg.evaluate(() => document.activeElement?.getAttribute('data-k')) === 'change' && (await rowFor(pg, 'mystery.jpg')).slug === '', 'Escape closes it, nothing chosen, focus back on Change')
  await pg.keyboard.press('Enter'); await pg.keyboard.type('هودي')
  is(await pg.locator(`${SEL} .sph-row:has(.sph-name:text-is("mystery.jpg")) .sph-results button`).count() === 1, 'the Arabic name is searchable too')
  await pg.keyboard.press('Control+a'); await pg.keyboard.type('run')
  await pg.keyboard.press('Tab'); await pg.keyboard.press('Enter')
  const m1 = await rowFor(pg, 'mystery.jpg')
  is(m1.slug === 'run-shorts' && m1.state === 'ready', 'Tab to the match and Enter chooses it: the file is ready', JSON.stringify(m1))
  is(await pg.evaluate(() => document.activeElement?.getAttribute('data-k')) === 'change', 'focus returns to Change')
  await pg.locator(`.sph-row:has(.sph-name:text-is("mystery.jpg")) [data-k=pos]`).selectOption('3')
  is((await rowFor(pg, 'mystery.jpg')).pos === '3', 'the position can be changed')
  await pg.locator(`.sph-row:has(.sph-name:text-is("mystery.jpg")) [data-k=remove]`).click()
  is(!(await rowFor(pg, 'mystery.jpg')), 'Remove takes a file off the list (nothing on the server)')
  is(api.mine().every((c) => c.method === 'GET'), 'nothing was written while only matching')
  await pg.context().close()
}

// =============================================================================================== 3. the run
head('the run: order, bodies, lossless, one at a time')
{
  const { pg, api, errors } = await open()
  await addFiles(pg, P(...GOOD, 'long-desc-hoodie-1.jpg', 'mystery.jpg', 'notes.txt'))
  const rowsBefore = clone(api.st.rows)
  await uploadAll(pg)
  const st = api.st
  // order: products in the order their first file appears in the list, positions ascending inside a product
  const listed = (await rowsOf(pg)).map((r) => r.name)
  const exp = []
  const group = {}
  for (const n of listed) { const pr = { 'vanquish-tee-white-1.jpg': 'v', 'vanquish-tee-white-2.png': 'v', 'Vanquish_Tee_White 3.webp': 'v', 'air-max-90.jpg': 'a90', 'air-max-2.jpg': 'am' }[n]; if (pr) (group[pr] ||= []).push(n) }
  const posOf = { 'vanquish-tee-white-1.jpg': 1, 'vanquish-tee-white-2.png': 2, 'Vanquish_Tee_White 3.webp': 3, 'air-max-90.jpg': 1.5, 'air-max-2.jpg': 2 }
  const seen = []
  for (const n of listed) { const pr = { 'vanquish-tee-white-1.jpg': 'v', 'vanquish-tee-white-2.png': 'v', 'Vanquish_Tee_White 3.webp': 'v', 'air-max-90.jpg': 'a90', 'air-max-2.jpg': 'am' }[n]; if (pr && !seen.includes(pr)) { seen.push(pr); exp.push(...group[pr].sort((x, y) => posOf[x] - posOf[y])) } }
  is(JSON.stringify(st.uploads.map((u) => u.name)) === JSON.stringify(exp), 'files are uploaded product by product, lowest position first', st.uploads.map((u) => u.name).join(', ') + ' vs ' + exp.join(', '))
  is(st.uploads.length === 5, 'exactly the five ready files were uploaded (not the held, unmatched or refused ones)', String(st.uploads.length))
  is(st.maxInflight === 1, 'never more than one request in flight over the whole run', String(st.maxInflight))
  // per file: upload, then read, then save, then the next upload
  const seq = api.mine().map((c) => c.r === 'product_image_upload' ? 'U' : c.r === 'products_all' ? 'R' : 'S').join('')
  is(/^R(URS){5}$/.test(seq), 'order of calls: one read at the start, then upload, read, save for each file', seq)
  // lossless
  is(st.uploads.every((u) => u.sha === sha(F[u.name].buf) && u.size === F[u.name].buf.length), 'every upload body decodes to bytes identical to the file (sha-256)')
  is(st.uploads.every((u) => /^\/images\/products\/[a-z0-9-]+-[0-9a-f]{10}\.(jpg|png|webp)$/.test(u.path)), 'the route answered with a path under /images/products/')
  is(st.badRequests.length === 0, 'the fake route accepted every request: XSRF header, JSON type, the magic number and declared type agree', st.badRequests.join(' | '))
  // the saved rows
  const up = (n) => st.uploads.find((u) => u.name === n).path
  const v = rowOf(api, 6), a90 = rowOf(api, 5), am = rowOf(api, 4)
  is(v.image === up('vanquish-tee-white-1.jpg') && v.images === [up('vanquish-tee-white-2.png'), up('Vanquish_Tee_White 3.webp')].join(','), 'product 1 (none before): -1 is the main photo, -2 and -3 follow in order', `${v.image} / ${v.images}`)
  is(a90.image === '/images/products/air-max-90-old0000001.jpg' && a90.images === ['/images/products/air-max-90-old0000002.jpg', up('air-max-90.jpg')].join(','), 'air-max-90 (has a main, no suffix): added at the end, the main photo kept', `${a90.image} / ${a90.images}`)
  is(am.image === up('air-max-2.jpg') && !am.images, 'air-max (no photo, file says -2): the first photo of a product with none becomes its main one')
  const body = (id, n) => st.saves.filter((s) => s.body.id === id)[n].body
  const orig = (id) => rowsBefore.find((r) => r.id === id)
  const exactBody = (id, image, images) => {
    const o = orig(id)
    return { id, slug: o.slug, name_en: o.name_en, name_ar: o.name_ar, desc_en: o.desc_en, desc_ar: o.desc_ar, price: o.price, sale_price: o.sale_price, sale_starts_at: o.sale_starts_at, sale_ends_at: o.sale_ends_at,
      featured: !!+o.featured, featured_sort: +o.featured_sort, category: o.category, brand_slug: o.brand_slug || '', image, images, active: !!+o.active }
  }
  is(JSON.stringify(body(5, 0)) === JSON.stringify(exactBody(5, '/images/products/air-max-90-old0000001.jpg', ['/images/products/air-max-90-old0000002.jpg', up('air-max-90.jpg')].join(','))), 'exact product_save body for the product on sale: price strings, sale dates, featured, order, brand, category all as read', JSON.stringify(body(5, 0)))
  is(JSON.stringify(body(6, 0)) === JSON.stringify(exactBody(6, up('vanquish-tee-white-1.jpg'), '')), 'exact body of the first save of product 1')
  is(JSON.stringify(body(6, 2)) === JSON.stringify(exactBody(6, up('vanquish-tee-white-1.jpg'), [up('vanquish-tee-white-2.png'), up('Vanquish_Tee_White 3.webp')].join(','))), 'exact body of the third save of product 1 (the list carries all earlier photos)')
  is(st.saves.every((s) => Object.keys(s.body).length === 17 && KEYS.every((k) => k in s.body)), 'every product_save carries all 17 fields')
  is(st.truncated === 0, 'no description was ever cut by a save')
  is(JSON.stringify(rowOf(api, 3)) === JSON.stringify(rowsBefore.find((r) => r.id === 3)) && !st.saves.some((s) => s.body.id === 3), 'the held product was not touched at all')
  is(JSON.stringify(rowOf(api, 1)) === JSON.stringify(rowsBefore.find((r) => r.id === 1)) && JSON.stringify(rowOf(api, 2)) === JSON.stringify(rowsBefore.find((r) => r.id === 2)), 'other products are untouched')
  // routes, writes, deletes
  const routes = new Set(st.calls.map((c) => c.r))
  is([...routes].every((r) => ['products_all', 'product_image_upload', 'product_save', 'brands', 'brand_products'].includes(r)) && st.unknown.length === 0, 'only existing routes were called', [...routes].join(','))
  is(st.calls.every((c) => c.method === 'GET' || ['product_image_upload', 'product_save'].includes(c.r)), 'POST only to the upload route and product_save')
  is(st.calls.every((c) => c.method === 'GET' || c.method === 'POST'), 'no DELETE, PUT or PATCH: nothing is ever deleted')
  // the panel afterwards
  const R = Object.fromEntries((await rowsOf(pg)).map((r) => [r.name, r]))
  is(GOOD.every((n) => R[n].state === 'done'), 'all five rows read Done', GOOD.map((n) => R[n].state).join(','))
  is(/Added to .*as main photo/.test(R['vanquish-tee-white-1.jpg'].detail) && /photo 3/.test(R['Vanquish_Tee_White 3.webp'].detail), 'each row says what happened to its product', R['Vanquish_Tee_White 3.webp'].detail)
  is(await pg.locator(`${SEL} [data-sph=summary]`).isVisible() && /5 uploaded, 5 added to products, 0 failed\./.test(await pg.locator(`${SEL} [data-sph=summary]`).textContent()), 'summary: uploaded, attached, failed', await pg.locator(`${SEL} [data-sph=summary]`).textContent())
  is(/Finished\. 5 uploaded, 5 added to products, 0 failed\./.test(await statusOf(pg)), 'the live status line says the same')
  is(await pg.locator(`${SEL} .sph-overall progress`).evaluate((p) => p.value === 5 && p.max === 5), 'overall progress 5 of 5')
  const logText = await pg.locator(`${SEL} [data-sph=log]`).textContent()
  is(st.uploads.every((u) => logText.includes(u.path)) && /was image=- images=-/.test(logText) && logText.includes('was image=/images/products/air-max-90-old0000001.jpg images=/images/products/air-max-90-old0000002.jpg'), 'the log lists every path written and what the product had before')
  is(await pg.locator(`${SEL} details summary`).textContent() === 'Files written (5)', 'log count')
  // copy
  await pg.locator(`${SEL} details summary`).click()
  await pg.locator(`${SEL} [data-k=logcopy]`).click(); await pg.waitForTimeout(100)
  const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => null)
  is(clip === null || st.uploads.every((u) => clip.includes(u.path)), 'Copy list puts every path on the clipboard', clip === null ? 'clipboard not readable here' : '')
  const dl = pg.waitForEvent('download')
  await pg.locator(`${SEL} [data-k=logsave]`).click()
  const d = await dl
  is(d.suggestedFilename() === 'sporta-photos-written.txt', 'Download list saves a text file')
  // persisted for the next visit
  await pg.reload(); await pg.waitForTimeout(500)
  is(await pg.locator(`${SEL} details summary`).textContent() === 'Files written (5)', 'the log survives a reload (kept in this browser only)')
  // nothing else changed
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-savebar]').length) === 0, 'the Save bar of block 5 stayed away after a full run')
  is(errors.length === 0, 'no page errors during the run', errors.join(' | '))
  await pg.context().close()
}

// =============================================================================================== 4. the rest of the screen
head('nothing outside the panel changes')
{
  const { pg } = await open()
  const before = await shellHtml(pg)
  const headBefore = await pg.evaluate(() => document.head.children.length)
  await addFiles(pg, P(...GOOD))
  await uploadAll(pg)
  is(await shellHtml(pg) === before, 'after adding and uploading, the screen outside the panel is byte-for-byte the same DOM')
  is(await pg.evaluate(() => document.head.children.length) === headBefore, 'the head gained nothing new while running (the one style was added at load)')
  is(await pg.evaluate(() => getComputedStyle(document.querySelector('.admin-table')).display) !== 'none', 'the compiled table still renders')
  await pg.context().close()
}

// =============================================================================================== 5. 429, 401, failures
head('429 backoff, 401 stop, partial failure and retry')
{
  // 429 on the upload: two refusals, then success; waits grow
  const a = await open({ backoff: 60 })
  a.api.st.uploadFaults.push({ status: 429, body: { error: 'too_many_attempts' } }, { status: 429, body: { error: 'too_many_attempts' } })
  await addFiles(a.pg, P('vanquish-tee-white-1.jpg'))
  const sawWait = a.pg.waitForFunction((sel) => /Waiting \d+ s \(too many requests\)/.test(document.querySelector(sel + ' [data-sph=status]').textContent), SEL, { timeout: 5000 }).then(() => true, () => false)
  await uploadAll(a.pg)
  const ups = a.api.st.calls.filter((c) => c.r === 'product_image_upload')
  is(ups.length === 3 && ups[2].status === 200 && a.api.st.uploads.length === 1, '429, 429, then the upload goes through: three attempts, one file written', ups.map((u) => u.status).join(','))
  is((ups[1].t - ups[0].t) >= 60 && (ups[2].t - ups[1].t) >= 120, 'backoff doubles (1x, 2x the base)', `${ups[1].t - ups[0].t}ms, ${ups[2].t - ups[1].t}ms`)
  is(await sawWait, 'the wait is shown to the owner')
  is((await rowFor(a.pg, 'vanquish-tee-white-1.jpg')).state === 'done', 'and the file ends Done')
  await a.ctx.close()

  // Retry-After honoured
  const b = await open({ backoff: 10 })
  b.api.st.uploadFaults.push({ status: 429, body: { error: 'too_many_attempts' }, headers: { 'Retry-After': '1' } })
  await addFiles(b.pg, P('vanquish-tee-white-1.jpg'))
  await uploadAll(b.pg)
  const ub = b.api.st.calls.filter((c) => c.r === 'product_image_upload')
  is(ub.length === 2 && ub[1].t - ub[0].t >= 950, 'Retry-After: 1 is waited out', `${ub[1].t - ub[0].t}ms`)
  await b.ctx.close()

  // 429 without end: gives up after six tries, Retry button, then it works
  const c = await open({ backoff: 5 })
  for (let i = 0; i < 6; i++) c.api.st.uploadFaults.push({ status: 429, body: { error: 'too_many_attempts' } })
  await addFiles(c.pg, P('vanquish-tee-white-1.jpg'))
  await uploadAll(c.pg)
  const rc = await rowFor(c.pg, 'vanquish-tee-white-1.jpg')
  is(c.api.st.calls.filter((x) => x.r === 'product_image_upload').length === 6 && rc.state === 'failed' && /Too many requests/.test(rc.detail), 'six 429s: gave up with a clear reason', JSON.stringify(rc))
  is(rc.buttons.includes('retry') && c.api.st.uploads.length === 0, 'a Retry button is offered; nothing was written')
  is(/0 uploaded, 0 added to products, 1 failed/.test(await c.pg.locator(`${SEL} [data-sph=summary]`).textContent()), 'the summary counts the failure')
  await c.pg.locator('.sph-row [data-k=retry]').click(); await c.pg.waitForTimeout(30); await waitIdle(c.pg)
  is((await rowFor(c.pg, 'vanquish-tee-white-1.jpg')).state === 'done' && c.api.st.uploads.length === 1, 'Retry uploads it')
  await c.ctx.close()

  // 401 stops cleanly
  const d = await open()
  await addFiles(d.pg, P('vanquish-tee-white-1.jpg', 'vanquish-tee-white-2.png', 'air-max-2.jpg'))
  // sign out after the first file has been fully handled
  const watcher = (async () => { while (d.api.st.saves.length < 1) await sleep(5); d.api.st.signedIn = false })()
  await startBtn(d.pg).click(); await watcher; await d.pg.waitForTimeout(30); await waitIdle(d.pg)
  const rd = Object.fromEntries((await rowsOf(d.pg)).map((r) => [r.name, r]))
  is(d.api.st.uploads.length === 1 && d.api.st.saves.length === 1, '401: the first file is done, nothing more is written', `${d.api.st.uploads.length} uploads`)
  is(Object.values(rd).filter((r) => r.state === 'done').length === 1 && Object.values(rd).filter((r) => r.state === 'ready').length === 2, 'the others are back to Ready, not Failed', Object.values(rd).map((r) => r.state).join(','))
  is(/session ended/.test(await statusOf(d.pg)) && /Nothing was lost/.test(await statusOf(d.pg)), 'the panel says the session ended and nothing was lost')
  is(!(await startBtn(d.pg).isDisabled()) && /Upload 2 photos/.test(await startBtn(d.pg).textContent()), 'Upload is available again for the rest')
  is(d.api.st.calls.filter((c2) => c2.status === 401).length >= 1 && d.api.st.maxInflight === 1, 'the run stopped on the first 401 (no hammering)')
  d.api.st.signedIn = true
  const callsBefore = d.api.st.uploads.length
  await uploadAll(d.pg)
  is(d.api.st.uploads.length === 3 && d.api.st.uploads.filter((u) => u.name === 'vanquish-tee-white-1.jpg').length === 1, 'after signing in, Upload continues with the remaining files and does not repeat the finished one', String(callsBefore))
  await d.ctx.close()

  // an upload failure and a save failure, then retry
  const e = await open()
  await addFiles(e.pg, P('vanquish-tee-white-1.jpg', 'air-max-2.jpg'))
  e.api.st.uploadFaults.push({ status: 413, body: { error: 'image_too_large' } })        // first file (air-max-2 sorts first)
  await startBtn(e.pg).click(); await e.pg.waitForTimeout(30)
  // the second file's save fails
  while (e.api.st.uploads.length < 1) await sleep(5)
  e.api.st.saveFaults.push({ status: 500, body: { error: 'failed' } })
  await waitIdle(e.pg)
  const re = Object.fromEntries((await rowsOf(e.pg)).map((r) => [r.name, r]))
  const states = Object.values(re).map((r) => r.state).sort().join(',')
  is(states === 'failed,unattached', 'one upload refused (413) and one save failed: Failed and "Uploaded, not added"', states)
  const f1 = Object.values(re).find((r) => r.state === 'failed'), f2 = Object.values(re).find((r) => r.state === 'unattached')
  is(/too large/.test(f1.detail) && /Could not save the product \(failed\)/.test(f2.detail) && f2.detail.includes('/images/products/'), 'each says why, and the one that was uploaded shows where its file is', `${f1.detail} || ${f2.detail}`)
  is(/1 uploaded, 0 added to products, 2 failed/.test(await e.pg.locator(`${SEL} [data-sph=summary]`).textContent()), 'summary: 1 uploaded, 0 added, 2 failed')
  is(!(await e.pg.locator(`${SEL} [data-k=retryall]`).isHidden()) && /Retry failed \(2\)/.test(await e.pg.locator(`${SEL} [data-k=retryall]`).textContent()), 'Retry failed (2) is offered')
  const uploadsBefore = e.api.st.uploads.length
  await e.pg.locator(`${SEL} [data-k=retryall]`).click(); await e.pg.waitForTimeout(30); await waitIdle(e.pg)
  is(e.api.st.uploads.length === uploadsBefore + 1, 'Retry uploads the refused file but NOT the one already on the server', `${uploadsBefore} -> ${e.api.st.uploads.length}`)
  is(Object.values(await rowsOf(e.pg)).every((r) => r.state === 'done'), 'both end Done')
  is(e.api.st.rows.find((r) => r.id === 4).image && e.api.st.rows.find((r) => r.id === 6).image, 'both products have their photo')
  // a retried attach does not add the path twice
  is(new Set(e.api.st.rows.flatMap((r) => [r.image, ...(r.images || '').split(',')]).filter(Boolean)).size === e.api.st.rows.flatMap((r) => [r.image, ...(r.images || '').split(',')]).filter(Boolean).length, 'no path is on any product twice')
  await e.ctx.close()

  // Stop after this photo
  const g = await open({ pace: 120 })
  await addFiles(g.pg, P(...GOOD))
  await startBtn(g.pg).click()
  while (g.api.st.saves.length < 1) await sleep(5)
  await g.pg.locator(`${SEL} [data-k=stop]`).click()
  await waitIdle(g.pg)
  const rg = (await rowsOf(g.pg)).map((r) => r.state)
  is(g.api.st.uploads.length >= 1 && g.api.st.uploads.length < 5 && rg.filter((s) => s === 'ready').length === 5 - g.api.st.uploads.length, 'Stop finishes the photo in hand and leaves the rest Ready', `${g.api.st.uploads.length} done, ${rg.join(',')}`)
  is(/Stopped\. \d+ photos are still waiting/.test(await statusOf(g.pg)), 'and says so')
  await g.ctx.close()

  // a product that changed meanwhile: its description became long between the list and the save
  const h = await open()
  await addFiles(h.pg, P('vanquish-tee-white-1.jpg'))
  h.api.st.rows.find((r) => r.id === 6).desc_en = 'x'.repeat(400)
  await startBtn(h.pg).click(); await h.pg.waitForTimeout(30); await waitIdle(h.pg)
  const rh = await rowFor(h.pg, 'vanquish-tee-white-1.jpg')
  is(rh.state === 'unattached' && /280/.test(rh.detail) && h.api.st.saves.length === 0 && h.api.st.truncated === 0, 'a description that became long after the list was read: uploaded, NOT saved (it would have been cut), path shown', JSON.stringify(rh))
  await h.ctx.close()
}

// =============================================================================================== 5b. load failure, odd rows
head('products that cannot be read, rows the save would refuse')
{
  const api = makeApi()
  api.st.readFaults.push({ status: 500, body: { error: 'failed' } })
  const { pg } = await open({ api })
  is(/Could not load the products \(failed\)/.test(await pg.locator(`${SEL} .sph-prod`).textContent()) && await pg.locator(`${SEL} [data-k=reload]`).isVisible(), 'products_all failing: said so, with a Reload button')
  await addFiles(pg, P('vanquish-tee-white-1.jpg'))
  is((await rowFor(pg, 'vanquish-tee-white-1.jpg')).state === 'needs' && await startBtn(pg).isDisabled(), 'nothing can be matched or uploaded until products load')
  await pg.locator(`${SEL} [data-k=reload]`).click(); await pg.waitForTimeout(150)
  is((await rowFor(pg, 'vanquish-tee-white-1.jpg')).slug === 'vanquish-tee-white' && /6 products loaded/.test(await pg.locator(`${SEL} .sph-prod`).textContent()), 'Reload loads them and matches the file already in the list')
  await pg.context().close()

  const api2 = makeApi()
  api2.st.rows.find((r) => r.id === 6).image = 'https://cdn.example.com/x.jpg'
  api2.st.rows.find((r) => r.id === 1).price = '0.000'
  api2.st.rows.find((r) => r.id === 4).slug = 'Air Max'
  const o = await open({ api: api2 })
  await addFiles(o.pg, P('vanquish-tee-white-1.jpg', 'run-shorts (2).jpg', 'air-max-2.jpg'))
  const R = Object.fromEntries((await rowsOf(o.pg)).map((r) => [r.name, r]))
  is(Object.values(R).every((r) => r.state === 'held'), 'an off-site photo address, a zero price and an abnormal web name are each held back', Object.values(R).map((r) => r.state).join(','))
  is(/address the server would refuse/.test(R['vanquish-tee-white-1.jpg'].warns.join('')) && /price/.test(R['run-shorts (2).jpg'].warns.join('')) && /normal form/.test(R['air-max-2.jpg'].warns.join('')), 'each says which problem')
  is(o.api.mine().filter((c) => c.method === 'POST').length === 0, 'and nothing was uploaded or saved')
  await o.ctx.close()
}

// =============================================================================================== 6. re-render
head('it survives the compiled screen re-rendering')
{
  const { pg, api } = await open()
  await addFiles(pg, P('vanquish-tee-white-1.jpg', 'vanquish-tee-white-2.png'))
  await pg.evaluate(() => window.fx.rerenderMain()); await pg.waitForTimeout(250)
  is(await pg.locator(SEL).count() === 1 && (await rowsOf(pg)).length === 2, 'main rebuilt: one panel again, with the same two files')
  await pg.evaluate(() => window.fx.replaceTable()); await pg.waitForTimeout(250)
  is(await pg.locator(SEL).count() === 1 && await pg.evaluate((s) => document.querySelector(s).nextElementSibling?.id === 'product-table-wrap', SEL), 'the table swapped: panel still right above it, only one')
  await pg.evaluate(() => window.fx.replaceList()); await pg.waitForTimeout(250)
  is(await pg.locator(SEL).count() === 1, 'the whole list replaced: one panel')
  // re-render in the middle of a run
  await startBtn(pg).click()
  await pg.evaluate(() => window.fx.rerenderMain())
  await pg.waitForTimeout(30)
  await waitIdle(pg)
  is(api.st.uploads.length === 2 && api.st.saves.length === 2 && api.st.maxInflight === 1, 'a re-render during the run does not stop it or double anything', `${api.st.uploads.length} uploads`)
  is((await rowsOf(pg)).every((r) => r.state === 'done') && await pg.locator(SEL).count() === 1, 'and the rows end Done')
  await pg.context().close()
}

// =============================================================================================== 7. layout, touch, languages
async function layout(w, ar) {
  const { pg, ctx, errors } = await open({ w, h: w < 500 ? 844 : 800, ar })
  await addFiles(pg, P(...GOOD, 'mystery.jpg', 'notes.txt', 'huge.png'))
  const tag = `@${w}${ar ? ' ar' : ''}`
  // The tap-target floor: 44px on a phone / touch screen, 40px on a mouse screen from 768px. The 40 is the SIZES section of
  // public/sporta-admin-knet.css (owner request 2026-11-03, "reduce over sizes all"; scripts/sizes-admin-test.mjs): its block 4 takes the
  // uploader's 2.75rem floors down to max(40px, 2.4rem) when the pointer is fine and the screen is 768px or wider.
  const floor = w < 768 ? 44 : 40
  const m = await pg.evaluate(([sel, floor]) => {
    const p = document.querySelector(sel), r = p.getBoundingClientRect()
    const bad = []
    for (const e of p.querySelectorAll('button, select, input[type=search], summary')) {
      const b = e.getBoundingClientRect()
      if (!b.width || e.closest('[hidden]')) continue
      if (b.height < floor - 0.5) bad.push(`${e.tagName}.${e.getAttribute('data-k') || ''} ${Math.round(b.height)}px`)
    }
    const rows = [...p.querySelectorAll('.sph-row')]
    const row = rows[0], cols = getComputedStyle(row).gridTemplateColumns.split(' ').length
    return { docW: document.documentElement.scrollWidth, vw: innerWidth, pw: p.scrollWidth, pcw: p.clientWidth, panelLeft: r.left, panelRight: r.right, bad, cols, dir: getComputedStyle(p).direction, lang: p.getAttribute('lang'),
      overflowRows: rows.filter((x) => x.scrollWidth > x.clientWidth + 1).length, thumbs: rows.filter((x) => x.querySelector('img.sph-thumb')).length }
  }, [SEL, floor])
  is(m.docW <= m.vw, `${tag}: no sideways page scroll`, `${m.docW} > ${m.vw}`)
  is(m.pw <= m.pcw + 1 && m.overflowRows === 0, `${tag}: nothing in the panel overflows it`, `${m.pw}/${m.pcw}, rows ${m.overflowRows}`)
  is(m.panelLeft >= -0.5 && m.panelRight <= m.vw + 0.5, `${tag}: the panel is inside the viewport`)
  is(m.bad.length === 0, `${tag}: buttons, selects and the search field are at least ${floor} px tall${w < 768 ? '' : ' (a mouse screen: the SIZES section of the add-on)'}`, m.bad.join(', '))
  is(m.cols === (w < 500 ? 2 : 3), `${tag}: ${w < 500 ? 'two' : 'three'} columns per file row`, String(m.cols))
  is(m.dir === (ar ? 'rtl' : 'ltr') && m.lang === (ar ? 'ar' : 'en'), `${tag}: ${ar ? 'right-to-left Arabic' : 'left-to-right English'}`, `${m.dir} ${m.lang}`)
  is(m.thumbs >= 5, `${tag}: thumbnails are drawn`)
  if (w < 500) {
    is(await pg.evaluate((sel) => { const i = document.querySelector(sel + ' [data-sph=input]'); return i.multiple && /image\/png/.test(i.accept) }, SEL), `${tag}: the chooser takes many files and offers photos (touch needs no drag)`)
    const fc = pg.waitForEvent('filechooser')
    await pg.locator(`${SEL} [data-k=choose]`).tap()
    const ch = await fc
    is(ch.isMultiple(), `${tag}: tapping Choose photos opens the file chooser, multiple`)
  }
  // drag and drop
  const before = (await rowsOf(pg)).length
  await pg.evaluate(async ([sel, b64, name]) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer(); dt.items.add(new File([bin], name, { type: 'image/png' }))
    const z = document.querySelector(sel + ' .sph-drop')
    z.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    window.__over = z.getAttribute('data-over')
    z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, [SEL, F['vanquish-tee-white-2.png'].buf.toString('base64'), 'run-shorts-1.png'])
  await pg.waitForTimeout(250)
  is((await rowsOf(pg)).length === before + 1 && await pg.evaluate(() => window.__over) === '1', `${tag}: dropping a file adds it (and the zone lights up while over it)`)
  return { pg, ctx, errors }
}
head('390 px, touch')
{ const l = await layout(390, false); is(l.errors.length === 0, '@390: no page errors', l.errors.join('|')); await l.ctx.close() }
head('1280 px')
{ const l = await layout(1280, false); is(l.errors.length === 0, '@1280: no page errors', l.errors.join('|')); await l.ctx.close() }
head('Arabic, right-to-left')
{
  const l = await layout(390, true); await l.ctx.close()
  const l2 = await layout(1280, true)
  const pg = l2.pg
  const txt = await pg.evaluate((sel) => {
    const out = []
    const w = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT)
    for (let n; (n = w.nextNode());) {
      const s = n.textContent.trim(); if (!s) continue
      const p = n.parentElement
      if (p.closest('code, .sph-name, [dir=ltr], option, select, [data-sph=log]') || getComputedStyle(p).display === 'none') continue
      out.push(s)
    }
    return out
  }, SEL)
  const all = txt.join('\n')
  is(/[؀-ۿ]/.test(all) && !/Upload|Choose photos|Photos\b/.test(all.replace(/PNG|JPEG|WebP/g, '')), 'the panel text is Arabic (only the format names stay Latin)', all.slice(0, 120))
  is(!/[0-9]/.test(all.replace(/PNG|JPEG|WebP/g, '')), 'Arabic-Indic digits only: no Western digit in the panel text', (all.match(/.{0,12}[0-9].{0,12}/) || [''])[0])
  is(/[٠-٩]/.test(all), 'and there are Arabic-Indic digits (counts, sizes)')
  is(!/[,;?]/.test(all), 'no Latin comma, semicolon or question mark in Arabic text', (all.match(/.{0,12}[,;?].{0,12}/) || [''])[0])
  const arSrc = BRANDS_JS.slice(BRANDS_JS.indexOf("    ar: {\n      title: 'الصور'"), BRANDS_JS.indexOf("unit: 'بكسل'"))
  is(arSrc.length > 3000 && !/اً/.test(arSrc), 'tanwin is written ـًا, never ـاً, in the Arabic strings')
  is(/،/.test(arSrc) && !/[A-Za-z]\s*,\s*[؀-ۿ]|[؀-ۿ]\s*,\s*[؀-ۿ]/.test(arSrc.replace(/\{[a-z]\}/g, '')), 'the Arabic comma ، is used inside the Arabic strings')
  const arValues = [...arSrc.matchAll(/: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\{[a-z]\}/g, '').replace(/PNG|JPEG|WebP/g, ''))
  is(arValues.length > 80 && arValues.every((v) => !/[0-9]/.test(v)), 'no Western digit in any Arabic string', arValues.filter((v) => /[0-9]/.test(v)).join(' | '))
  is(await pg.evaluate((sel) => { const c = document.querySelector(sel + ' .sph-drop button'); const t = document.querySelector(sel + ' .sph-drop p'); return c.getBoundingClientRect().left > t.getBoundingClientRect().left }, SEL), 'right-to-left: the first control sits at the right of the drop zone')
  // switching the page language re-draws the panel in place
  await pg.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr' }); await pg.waitForTimeout(250)
  is(await pg.locator(`${SEL} h3`).textContent() === 'Photos' && (await rowsOf(pg)).length >= 5, 'a language change re-draws the panel and keeps the file list')
  await l2.ctx.close()
}

// =============================================================================================== 8. colour, focus
head('light and dark, contrast, focus')
const contrast = (pg) => pg.evaluate((sel) => {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
  const g = cv.getContext('2d', { willReadFrequently: true })
  const num = (str) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = str; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const mix = (top, bottom) => { const a = top[3]; return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1] }
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const bgOf = (e) => { const layers = []; for (let x = e; x; x = x.parentElement) { const c = num(getComputedStyle(x).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break } let col = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) col = mix(layers[i], col); return col }
  const out = []
  const root = document.querySelector(sel)
  for (const e of root.querySelectorAll('*')) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getBoundingClientRect().width || e.closest('[hidden]')) continue
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
    const field = e.tagName === 'INPUT' && e.type === 'search'
    if (!own && !field) continue
    const bg = bgOf(e), fg = mix(num(cs.color), bg)
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    const ratio = (a + 0.05) / (b + 0.05), px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5
    out.push({ ratio, need, what: `${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/)[0]} "${(own || e.placeholder || '').slice(0, 30)}" ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)})` })
  }
  return out
}, SEL)
async function showcase(opts) {
  const o = await open(opts)
  const { pg, api } = o
  await addFiles(pg, P(...GOOD, 'mystery.jpg', 'team-hoodie.jpg', 'long-desc-hoodie-1.jpg', 'notes.txt', 'huge.png', 'logo.svg'))
  api.st.uploadFaults.push({ status: 413, body: { error: 'image_too_large' } })        // the first file fails
  await startBtn(pg).click(); await pg.waitForTimeout(30)
  while (api.st.uploads.length < 2) await sleep(5)
  api.st.saveFaults.push({ status: 500, body: { error: 'failed' } })
  await waitIdle(pg)
  await pg.locator(`.sph-row:has(.sph-name:text-is("mystery.jpg")) [data-k=change]`).click()      // an open picker
  await pg.keyboard.type('a')
  await pg.locator(`${SEL} details summary`).click()
  return o
}
for (const [label, opts] of [
  ['light @1280', { w: 1280, theme: 'light', device: 'light' }], ['light @390', { w: 390, theme: 'light', device: 'light' }],
  ['dark @1280', { w: 1280, theme: 'dark', device: 'dark' }], ['dark @390', { w: 390, theme: 'dark', device: 'dark' }],
  ['dark theme on a light device @1280', { w: 1280, theme: 'dark', device: 'light' }],
  ['light theme on a dark device @1280', { w: 1280, theme: 'light', device: 'dark' }],
  ['Arabic dark @390', { w: 390, theme: 'dark', device: 'dark', ar: true }], ['Arabic light @1280', { w: 1280, theme: 'light', device: 'light', ar: true }],
]) {
  const o = await showcase(opts)
  if (process.env.SHOTS) await o.pg.locator(SEL).screenshot({ path: join(process.env.SHOTS, label.replace(/[^a-z0-9]+/gi, '-') + '.png') })
  const rows = await contrast(o.pg)
  const low = rows.filter((r) => r.ratio < r.need)
  is(rows.length > 40 && low.length === 0, `${label}: every text element (${rows.length}) is 4.5:1 or better (3:1 for large)`, low.slice(0, 4).map((r) => r.ratio.toFixed(2) + ' ' + r.what).join(' || '))
  const paint = await o.pg.evaluate((sel) => { const p = document.querySelector(sel); const c = getComputedStyle(p); return { bg: c.backgroundColor, text: c.color } }, SEL)
  const dark = opts.theme === 'dark'
  const lumv = (s) => { const v = s.match(/[\d.]+/g).slice(0, 3).map(Number); return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255 }
  is(dark ? lumv(paint.bg) < 0.2 && lumv(paint.text) > 0.7 : lumv(paint.bg) > 0.9 && lumv(paint.text) < 0.3, `${label}: the panel follows the admin's theme (${dark ? 'dark' : 'light'}), not the device`, JSON.stringify(paint))
  if (label === 'dark @1280') {
    // the admin chunk's rules can be appended AFTER the panel's style at run time: move them, measure again
    await o.pg.evaluate(() => document.head.appendChild(document.getElementById('darkadmin')))
    const again = (await contrast(o.pg)).filter((r) => r.ratio < r.need)
    is(again.length === 0, `${label}: still 4.5:1 with the admin stylesheet appended after the panel's`, again.slice(0, 3).map((r) => r.ratio.toFixed(2) + ' ' + r.what).join(' || '))
  }
  await o.ctx.close()
}
{
  // MUTATION: without the panel's own !important field colours the admin add-on's dark-on-dark ink shows through
  const cut = BRANDS_JS.replace(".sph :is(select,input[type=\"search\"]){color:var(--sph-text)!important;background-color:var(--sph-bg)!important}", '')
  is(cut !== BRANDS_JS, 'mutation set up')
  const o = await showcase({ w: 1280, theme: 'dark', device: 'dark', js: cut })
  // Until 2026-11-10 that alone failed: the admin add-on forced its light field ink (#18212a) in the dark theme too. Section 10 [full-1] of
  // sporta-admin-knet.css now gives that ink a dark value through the --ak-* tokens, so the admin's own rule keeps these fields readable
  // and the panel's !important colours are a second line of defence. The check can still tell: take the tokens away as well and it fails.
  is(!(await contrast(o.pg)).some((r) => r.ratio < r.need), 'without the panel\'s own field colours the fields are still readable in the dark theme (the admin add-on\'s ink follows the theme now)')
  const stripped = await o.pg.evaluate(() => { const st = [...document.querySelectorAll('style')].find((e) => e.textContent.includes('--ak-ink:')); if (!st) return false; st.textContent = st.textContent.replace(/--ak-[\w-]+:[^;}]+;?/g, ''); return true })
  is(stripped, 'mutation set up: the --ak-* dark tokens are taken out of the admin add-on on the page')
  is((await contrast(o.pg)).some((r) => r.ratio < r.need), 'MUTATION: without the field colours AND without the admin add-on\'s dark tokens the dark contrast check FAILS (it can tell)')
  await o.ctx.close()
}
{
  const { pg } = await open({ w: 1280, theme: 'dark', device: 'dark' })
  await addFiles(pg, P('vanquish-tee-white-1.jpg'))
  // keyboard: tab to the first button and read its focus ring
  await pg.locator(`${SEL} [data-k=choose]`).focus()
  await pg.keyboard.press('Tab')
  const ring = await pg.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { k: e.getAttribute('data-k'), style: c.outlineStyle, w: parseFloat(c.outlineWidth), col: c.outlineColor } })
  is(ring.style === 'solid' && ring.w >= 2, 'a focused control has a visible 2 px outline', JSON.stringify(ring))
  // every control can be reached by Tab and used with the keyboard: Start with Enter
  await pg.locator(`${SEL} [data-k=start]`).focus()
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(30); await waitIdle(pg)
  is((await rowFor(pg, 'vanquish-tee-white-1.jpg')).state === 'done', 'Enter on Upload runs it (keyboard only)')
  is(await pg.locator(`${SEL} input[type=file]`).getAttribute('tabindex') === '-1', 'the hidden file input is not a second tab stop; the Choose button is')
  await pg.context().close()
}

// =============================================================================================== 8b. the review round
// Each block below is one finding of the independent review of the first version.
// A JPEG with an EXIF Orientation segment spliced in after the SOI marker (the bytes the phone's camera writes).
function withExif(jpeg, orientation, bigEndian) {
  const tiff = bigEndian
    ? Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0])
    : Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0])
  const body = Buffer.concat([Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]), tiff])
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body])
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)])
}
put('turned-be.jpg', withExif(await makeImage('image/jpeg', 1500, 1200, 11), 6, true))
put('turned-le.jpg', withExif(await makeImage('image/jpeg', 1500, 1200, 12), 8, false))
put('upright-exif.jpg', withExif(await makeImage('image/jpeg', 1200, 1500, 13), 1, false))
put('flat.jpg', await makeImage('image/jpeg', 1500, 1200, 14))
put('air-max-15.jpg', await makeImage('image/jpeg', 1600, 2000, 15))
put('air-max-90-1.jpg', await makeImage('image/jpeg', 1200, 1500, 16))

head('review 1: the compiled product list goes stale after a run')
{
  const { pg, api } = await open()
  is(!(await pg.locator(`${SEL} [data-sph=stale]`).isVisible()), 'before any save there is no stale-list notice')
  await addFiles(pg, P('vanquish-tee-white-1.jpg'))
  await uploadAll(pg)
  const box = pg.locator(`${SEL} [data-sph=stale]`)
  is(await box.isVisible() && /Reload the page before you edit a product/.test(await box.textContent()) && /old photos back/.test(await box.textContent()), 'after a save the panel says the list is out of date and to reload before editing', await box.textContent())
  is(/Reload the page before editing products\./.test(await statusOf(pg)), 'the end-of-run line (an aria-live region) says it too', await statusOf(pg))
  is(await box.getAttribute('role') === 'alert' && await pg.locator(`${SEL} [data-k=reloadpage]`).isVisible(), 'the notice is an alert and carries a Reload the page button')
  await pg.locator(`${SEL} [data-k=clear]`).click()
  is(await box.isVisible(), 'clearing the file list does not hide it: the page is still stale')
  await pg.evaluate(() => { window.__marker = 1 })
  await Promise.all([pg.waitForNavigation(), pg.locator(`${SEL} [data-k=reloadpage]`).click()])
  await pg.waitForTimeout(450)
  is(await pg.evaluate(() => window.__marker === undefined), 'the button reloads the page')
  is(!(await pg.locator(`${SEL} [data-sph=stale]`).isVisible()), 'and after the reload the notice is gone')
  // a run in which nothing was saved does not claim the list is stale
  const api2 = makeApi(); api2.st.saveFaults.push({ status: 500, body: { error: 'boom' } })
  const o = await open({ api: api2 })
  await addFiles(o.pg, P('vanquish-tee-white-1.jpg')); await uploadAll(o.pg)
  is(!(await o.pg.locator(`${SEL} [data-sph=stale]`).isVisible()) && !/Reload the page/.test(await statusOf(o.pg)), 'a run whose save failed saved nothing: no stale notice')
  await o.ctx.close()
  // on a phone: no sideways scroll, and the button is a 44 px target
  const ph = await open({ w: 390 })
  await addFiles(ph.pg, P('vanquish-tee-white-1.jpg')); await uploadAll(ph.pg)
  const geo = await ph.pg.evaluate((sel) => { const b = document.querySelector(sel + ' [data-k=reloadpage]').getBoundingClientRect(); const r = document.querySelector(sel + ' [data-sph=stale]').getBoundingClientRect(); return { h: b.height, over: document.documentElement.scrollWidth - window.innerWidth, inside: r.right <= window.innerWidth + 1 && r.left >= -1 } }, SEL)
  is(geo.h >= 44 && geo.over <= 0 && geo.inside, '@390: the notice fits the screen and its button is a 44 px target', JSON.stringify(geo))
  await ph.ctx.close()
  const a = await open({ ar: true })
  await addFiles(a.pg, P('vanquish-tee-white-1.jpg')); await uploadAll(a.pg)
  is(/أعد تحميل الصفحة قبل تعديل المنتجات/.test(await statusOf(a.pg)) && /إعادة تحميل الصفحة/.test(await a.pg.locator(`${SEL} [data-sph=stale]`).textContent()), 'and in Arabic')
  await a.ctx.close()
  await pg.context().close()
}

head('review 2: -1 over an existing main photo')
{
  const MAIN = '/images/products/air-max-90-old0000001.jpg', EXTRA = '/images/products/air-max-90-old0000002.jpg'
  const { pg, api } = await open()
  await addFiles(pg, P('air-max-90-1.jpg', 'vanquish-tee-white-1.jpg', 'air-max-90.jpg'))
  const R = Object.fromEntries((await rowsOf(pg)).map((r) => [r.name, r]))
  is(R['air-max-90-1.jpg'].pos === '1' && R['air-max-90-1.jpg'].slug === 'air-max-90', 'air-max-90-1.jpg -> air-max-90, position 1')
  is(R['air-max-90-1.jpg'].warns.some((w) => /becomes the main photo/.test(w) && /moves to second place; nothing is deleted/.test(w)), 'position 1 over a product that has a main photo warns BEFORE any upload', R['air-max-90-1.jpg'].warns.join('|'))
  is(!R['vanquish-tee-white-1.jpg'].warns.some((w) => /main photo/.test(w)), 'no warning when the product has no main photo yet')
  is(!R['air-max-90.jpg'].warns.some((w) => /main photo/.test(w)), 'no warning for an unnumbered file (it is added at the end)')
  is(api.mine().filter((c) => c.method === 'POST').length === 0, 'nothing was sent yet')
  for (const n of ['vanquish-tee-white-1.jpg', 'air-max-90.jpg']) await pg.locator(`${SEL} li.sph-row:has(.sph-name:text-is("${n}")) [data-k=remove]`).click()
  await uploadAll(pg)
  const up = api.st.uploads.find((u) => u.name === 'air-max-90-1.jpg').path
  const row = rowOf(api, 5)
  is(row.image === up, 'the new file is the main photo', row.image)
  is(row.images === [MAIN, EXTRA].join(','), 'the old main photo is not dropped: it leads the other photos, then the old extra', row.images)
  const body = api.st.saves.find((x) => x.body.id === 5).body
  is(body.image === up && body.images === [MAIN, EXTRA].join(','), 'the product_save body says the same')
  const after = (await rowsOf(pg)).find((r) => r.name === 'air-max-90-1.jpg')
  is(/Added to .*as main photo\. The previous main photo is now photo 2\./.test(after.detail), 'the row says what moved', after.detail)
  is(!after.warns.some((w) => /main photo/.test(w)), 'the warning goes away once it is done')
  const log = await pg.locator(`${SEL} [data-sph=log]`).textContent()
  is(log.includes('was image=' + MAIN + ' images=' + EXTRA), 'and the log still has what the product had before')
  // the old main is also one of the extras: no duplicate
  const api2 = makeApi(); rowOf(api2, 5).images = MAIN + ',' + EXTRA
  const o = await open({ api: api2 })
  await addFiles(o.pg, P('air-max-90-1.jpg')); await uploadAll(o.pg)
  is(rowOf(api2, 5).images === [MAIN, EXTRA].join(','), 'a main photo that is also listed among the others is not listed twice', rowOf(api2, 5).images)
  await o.ctx.close()
  const a = await open({ ar: true })
  await addFiles(a.pg, P('air-max-90-1.jpg'))
  is((await rowsOf(a.pg))[0].warns.some((w) => /الصورة الرئيسية الحالية/.test(w)), 'the warning exists in Arabic')
  await a.ctx.close()
  const b = await open()
  const copy = await b.pg.locator(`${SEL} .sph-ex`).textContent()
  is(/added after the photos the product already has/.test(copy) && !/second photo/.test(copy), 'the example text says -2 goes AFTER the product\'s photos, not into slot 2', copy)
  await b.ctx.close()
  await pg.context().close()
}

head('review 3: Arabic counts agree with their nouns')
{
  const arSrc = BRANDS_JS.slice(BRANDS_JS.indexOf("    ar: {\n      title: 'الصور'"), BRANDS_JS.indexOf("unit: 'بكسل'"))
  // {k} is excluded: "الصورة {k}" is the photo's number (an ordinal label), not a count
  is(!/\{[a-jl-z]\}\s*(صورة|ملف|منتج|ثانية|ثوان)/.test(arSrc) && !/(صورة|ملف|منتج)\s*\{[a-jl-z]\}/.test(arSrc), 'no Arabic string puts a bare digit in front of a singular count noun')
  const toks = [...arSrc.matchAll(/\{[a-z]+\|[^{}]*\}/g)].map((m) => m[0])
  is(toks.length >= 10 && toks.every((tk) => tk.slice(1, -1).split('|').length === 6), `every count token has the five forms (${toks.length} tokens)`, toks.filter((tk) => tk.slice(1, -1).split('|').length !== 6).join(' '))
  const extra = Array.from({ length: 6 }, (_, i) => ({ ...clone(PRODUCTS[5]), id: 100 + i, slug: 'extra-' + i, name_en: 'Extra ' + i, name_ar: 'إضافي ' + i }))
  const api = makeApi(); api.st.rows = api.st.rows.concat(extra)
  const a = await open({ ar: true, api })
  const prod = () => a.pg.locator(`${SEL} .sph-prod`).textContent()
  is(/تم تحميل ١٢ منتجًا\./.test(await prod()), '12 products: تم تحميل ١٢ منتجًا (singular after eleven)', await prod())
  await addFiles(a.pg, P('vanquish-tee-white-1.jpg'))
  is(await startBtn(a.pg).textContent() === 'رفع صورة واحدة', 'one file: رفع صورة واحدة', await startBtn(a.pg).textContent())
  is(/تمت إضافة ملف واحد\./.test(await statusOf(a.pg)) && /ملف واحد جاهز\./.test(await a.pg.locator(`${SEL} .sph-hint`).textContent()), 'one file added / ready: ملف واحد', await statusOf(a.pg))
  await addFiles(a.pg, P('vanquish-tee-white-2.png'))
  is(await startBtn(a.pg).textContent() === 'رفع صورتين', 'two files: the dual, رفع صورتين', await startBtn(a.pg).textContent())
  is(/ملفان جاهزان\./.test(await a.pg.locator(`${SEL} .sph-hint`).textContent()), 'two ready: ملفان جاهزان', await a.pg.locator(`${SEL} .sph-hint`).textContent())
  await addFiles(a.pg, P('Vanquish_Tee_White 3.webp', 'air-max-2.jpg', 'run-shorts (2).jpg'))
  is(await startBtn(a.pg).textContent() === 'رفع ٥ صور', 'five files: the plural, رفع ٥ صور', await startBtn(a.pg).textContent())
  is(/تمت إضافة ٣ ملفات\./.test(await statusOf(a.pg)), 'three added: ٣ ملفات', await statusOf(a.pg))
  await addFiles(a.pg, P('vanquish-tee-white-1.jpg'))
  is(/ملف واحد موجود في القائمة أصلًا\./.test(await statusOf(a.pg)), 'one duplicate: ملف واحد موجود في القائمة أصلًا', await statusOf(a.pg))
  await addFiles(a.pg, P('mystery.jpg', 'team-hoodie.jpg'))
  is(/ملفان يحتاجان إلى منتج\./.test(await a.pg.locator(`${SEL} .sph-hint`).textContent()), 'two need a product: ملفان يحتاجان إلى منتج', await a.pg.locator(`${SEL} .sph-hint`).textContent())
  await uploadAll(a.pg)
  const sumAr = await a.pg.locator(`${SEL} [data-sph=summary]`).textContent()
  is(/رُفعت ٥ صور،/.test(sumAr) && /أُضيفت ٥ صور إلى المنتجات/.test(sumAr) && /لم تفشل أي صورة/.test(sumAr), 'the summary counts its nouns too', sumAr)
  await a.ctx.close()
  // the stop line
  const b = await open({ ar: true })
  await addFiles(b.pg, P('vanquish-tee-white-1.jpg', 'vanquish-tee-white-2.png', 'Vanquish_Tee_White 3.webp'))
  await startBtn(b.pg).click(); await b.pg.locator(`${SEL} [data-k=stop]`).click(); await waitIdle(b.pg)
  const st = await statusOf(b.pg)
  is(/(ما زالت صورتان|ما زالت صورة واحدة|ما زالت ٣ صور) بانتظار الرفع/.test(st) || /اكتمل/.test(st), 'after a stop: the waiting photos are counted by their noun', st)
  await b.ctx.close()
}

head('review 4: more rows held before anything is uploaded')
{
  const api = makeApi()
  rowOf(api, 6).name_en = '   '
  rowOf(api, 1).name_ar = 'ا'.repeat(161)
  Object.assign(rowOf(api, 4), { sale_price: '30.000', sale_starts_at: '2026-12-01 00:00:00', sale_ends_at: '2026-11-01 00:00:00' })
  const { pg } = await open({ api })
  await addFiles(pg, P('vanquish-tee-white-1.jpg', 'run-shorts (2).jpg', 'air-max-2.jpg'))
  const R = Object.fromEntries((await rowsOf(pg)).map((r) => [r.name, r]))
  is(R['vanquish-tee-white-1.jpg'].state === 'held' && /empty or over 160/.test(R['vanquish-tee-white-1.jpg'].warns.join('')), 'an empty (spaces only) name is held with the reason', JSON.stringify(R['vanquish-tee-white-1.jpg']))
  is(R['run-shorts (2).jpg'].state === 'held' && /empty or over 160/.test(R['run-shorts (2).jpg'].warns.join('')), 'a 161-character Arabic name is held')
  is(R['air-max-2.jpg'].state === 'held' && /ends before it starts/.test(R['air-max-2.jpg'].warns.join('')), 'sale dates that run backwards (with a sale price) are held', JSON.stringify(R['air-max-2.jpg']))
  is(await startBtn(pg).isDisabled(), 'so nothing is ready to upload')
  is(api.mine().filter((c) => c.method === 'POST').length === 0, 'and nothing was uploaded or saved')
  await pg.context().close()

  // what the server accepts is not held: 160 characters, equal dates, backwards dates WITHOUT a sale price
  const api2 = makeApi()
  rowOf(api2, 6).name_ar = 'ا'.repeat(160)
  Object.assign(rowOf(api2, 4), { sale_price: '30.000', sale_starts_at: '2026-11-01 00:00:00', sale_ends_at: '2026-11-01 00:00:00' })
  Object.assign(rowOf(api2, 1), { sale_price: null, sale_starts_at: '2026-12-01 00:00:00', sale_ends_at: '2026-11-01 00:00:00' })
  const o = await open({ api: api2 })
  await addFiles(o.pg, P('vanquish-tee-white-1.jpg', 'run-shorts (2).jpg', 'air-max-2.jpg'))
  const R2 = Object.fromEntries((await rowsOf(o.pg)).map((r) => [r.name, r]))
  is(Object.values(R2).every((r) => r.state === 'ready'), '160 characters, equal dates, and dates with no sale price at all are not held', Object.values(R2).map((r) => r.state).join(','))
  is(/sale dates but no sale price.*clears the dates/.test(R2['run-shorts (2).jpg'].warns.join('')), 'a row with sale dates but no sale price warns that saving clears them', R2['run-shorts (2).jpg'].warns.join('|'))
  is(!R2['air-max-2.jpg'].warns.some((w) => /sale dates/.test(w)) && !R2['vanquish-tee-white-1.jpg'].warns.some((w) => /sale dates/.test(w)), 'and rows with a sale price (or no dates) do not')
  await uploadAll(o.pg)
  const r1 = rowOf(api2, 1)
  is(r1.sale_starts_at === null && r1.sale_ends_at === null && /^\/images\/products\/run-shorts-2-[0-9a-f]{10}\.jpg$/.test(r1.image) && r1.images.split(',').length === 2, 'the warned row was saved and the server did clear the dates, as announced (the photo is on it: this product had no main photo, so the file is its main one)', JSON.stringify([r1.sale_starts_at, r1.sale_ends_at, r1.image, r1.images]))
  is(rowOf(api2, 4).sale_starts_at === '2026-11-01 00:00:00', 'a row with a real sale keeps its dates')
  await o.ctx.close()
  // an unknown brand (only possible after a hand edit of the database) ends honestly, with a reason and a Retry
  const api3 = makeApi(); rowOf(api3, 6).brand_slug = 'gone-brand'
  const u = await open({ api: api3 })
  await addFiles(u.pg, P('vanquish-tee-white-1.jpg')); await uploadAll(u.pg)
  const ru = await rowFor(u.pg, 'vanquish-tee-white-1.jpg')
  is(ru.state === 'unattached' && /brand that no longer exists/.test(ru.detail) && ru.buttons.includes('retry') && /Written to \/images\/products\//.test(ru.detail), 'unknown brand: Uploaded, not added, with the reason, the path and a Retry', ru.detail)
  await u.ctx.close()
}

head('review 5: finding the screen')
{
  // a table headed Product / Web name / Site price / ...: only a word-wise header match tells it from the product list
  SCREENS.cmponly = SCREEN.replace(LIST, '').replace('>Slug</th>', '>Web name</th>')
  SCREENS.kwd = SCREEN.replace('<th class="p-3 text-end">Price</th>', '<th class="p-3 text-end">Price (KWD)</th>')
  is(SCREENS.cmponly !== SCREEN && SCREENS.kwd !== SCREEN, 'the two variant screens were built')
  const a = await open({ screen: 'cmponly' })
  is(await a.pg.locator(SEL).count() === 0, 'a screen with only a Comparison-style table (Product / Web name / Site price / Database) gets no panel: "Site price" is not "Price"')
  await a.ctx.close()
  const b = await open({ screen: 'kwd' })
  is(await b.pg.locator(SEL).count() === 1 && await b.pg.evaluate((sel) => document.querySelector(sel).nextElementSibling?.id === 'product-table-wrap', SEL), 'a header "Price (KWD)" still finds the product table, and the panel sits above it, not above Comparison')
  await b.ctx.close()
}

head('review 6: the small edges')
{
  const { pg, api } = await open()
  // (a) a finished file removed, then added again, is not written twice
  await addFiles(pg, P('vanquish-tee-white-1.jpg'))
  await uploadAll(pg)
  is(api.st.uploads.length === 1 && api.st.saves.length === 1, 'first run: one upload, one save')
  await pg.locator(`${SEL} [data-sph=list] li`).first().locator('[data-k=remove]').click()
  await addFiles(pg, P('vanquish-tee-white-1.jpg'))
  const again = await rowFor(pg, 'vanquish-tee-white-1.jpg')
  is(again.state === 'ready' && again.warns.some((w) => /already uploaded in this session/.test(w)), 'the same file added again says it was already uploaded', JSON.stringify(again))
  await uploadAll(pg)
  is(api.st.uploads.length === 1, 'removed and added again: NOT uploaded a second time', String(api.st.uploads.length))
  is(rowOf(api, 6).image === api.st.uploads[0].path && !rowOf(api, 6).images, 'and the product has the photo once')
  await pg.locator(`${SEL} [data-k=clear]`).click()
  await addFiles(pg, P('vanquish-tee-white-1.jpg'))
  await uploadAll(pg)
  is(api.st.uploads.length === 1, 'cleared and added again: still one upload')
  is(await pg.locator(`${SEL} details summary`).textContent() === 'Files written (1)', 'the "files written" count counts the one file, not the repeats', await pg.locator(`${SEL} details summary`).textContent())
  is(/same file, not written again/.test(await pg.locator(`${SEL} [data-sph=log]`).textContent()), 'the repeats are in the list, marked')
  await pg.context().close()
  // an uploaded-but-not-added file that is removed and re-added is only added, not uploaded again
  const api2 = makeApi(); api2.st.saveFaults.push({ status: 500, body: { error: 'boom' } })
  const o = await open({ api: api2 })
  await addFiles(o.pg, P('run-shorts (2).jpg')); await uploadAll(o.pg)
  is(api2.st.uploads.length === 1 && (await rowFor(o.pg, 'run-shorts (2).jpg')).state === 'unattached', 'a save failed after the upload')
  await o.pg.locator(`${SEL} [data-sph=list] li`).first().locator('[data-k=remove]').click()
  await addFiles(o.pg, P('run-shorts (2).jpg')); await uploadAll(o.pg)
  is(api2.st.uploads.length === 1 && rowOf(api2, 1).image === api2.st.uploads[0].path, 'removed and re-added: only added to the product, the file is not on the server twice')
  await o.ctx.close()

  // (c) a phone photo stored sideways: the 4:5 check is on the picture as it is seen
  const p2 = await open()
  await addFiles(p2.pg, P('turned-be.jpg', 'turned-le.jpg', 'upright-exif.jpg', 'flat.jpg'))
  const R = Object.fromEntries((await rowsOf(p2.pg)).map((r) => [r.name, r]))
  is(/1200×1500/.test(R['turned-be.jpg'].meta) && !R['turned-be.jpg'].warns.some((w) => /4:5/.test(w)), 'JPEG 1500x1200 with EXIF turn 6 (big-endian): shown as 1200x1500, no 4:5 warning', R['turned-be.jpg'].meta + ' ' + R['turned-be.jpg'].warns.join('|'))
  is(/1200×1500/.test(R['turned-le.jpg'].meta) && !R['turned-le.jpg'].warns.some((w) => /4:5/.test(w)), 'the same with turn 8 (little-endian)')
  is(/1200×1500/.test(R['upright-exif.jpg'].meta) && R['upright-exif.jpg'].warns.length === 0, 'EXIF turn 1 leaves the size alone')
  is(/1500×1200/.test(R['flat.jpg'].meta) && R['flat.jpg'].warns.some((w) => /Not 4:5/.test(w)), 'a landscape JPEG with no EXIF still warns', R['flat.jpg'].warns.join('|'))
  await p2.ctx.close()

  // (d) a suffix over 12 is a real option
  const p3 = await open()
  await addFiles(p3.pg, P('air-max-15.jpg'))
  const r15 = await rowFor(p3.pg, 'air-max-15.jpg')
  is(r15.slug === 'air-max' && r15.pos === '15', 'air-max-15.jpg -> position 15, not a blank select', JSON.stringify(r15))
  is(await p3.pg.locator(`${SEL} select[data-k=pos] option`).evaluateAll((o) => o.map((x) => x.value).join(',')) === ',1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', 'the position list runs to the number the file name asked for')
  await p3.ctx.close()
}

// =============================================================================================== 9. rest of the file
head('the file')
{
  const { execFileSync } = await import('node:child_process')
  let ok = true, msg = ''
  try { execFileSync(process.execPath, ['--check', join(ROOT, 'public/sporta-admin-brands.js')], { stdio: 'pipe' }) } catch (e) { ok = false; msg = String(e.stderr || e).slice(0, 200) }
  is(ok, 'node --check public/sporta-admin-brands.js', msg)
  is(!/product_image_upload_new|image_upload_batch|\?r=photos/.test(BRANDS_JS.slice(BEGIN, END)), 'the block names no new route')
  const used = [...new Set([...BRANDS_JS.slice(BEGIN, END).matchAll(/(?:call|\?r=)\(?'?(products_all|product_save|product_image_upload|[a-z_]+)'?/g)].map((m) => m[1]))].filter((x) => /^(products_all|product_save|product_image_upload)$/.test(x))
  is(used.length === 3, 'the block calls exactly products_all, product_save and product_image_upload', used.join(','))
  is(!/\.\s*(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(BRANDS_JS.slice(BEGIN, END)), 'DOM is built with textContent only (no innerHTML)')
  is(!/canvas\.toBlob|\.toBlob\(/.test(BRANDS_JS.slice(BEGIN, END)) && /readAsDataURL\(file\)/.test(BRANDS_JS.slice(BEGIN, END)), 'photos go as the file\'s own base64: no canvas re-encode of what is uploaded (the canvas draws only the preview)')
}

await browser.close()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
