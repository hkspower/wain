// CATALOGUE V2, the /backends side: the four tabs of the Catalogue dialog (Content, Products, Share, Status) and their ONE Save
// (block ADMIN CATALOGUE PDF in public/sporta-admin-brands.js), in a real browser, with the real block and the real engine (public/sporta-catalogue.js),
// against a fake admin.php that answers the way dropin/php-store/catalogue.php does (catalogue_settings, catalogue_settings_save) and a fake shop.
//
//   npm run test:admin-catalogue-settings   (rig-free)
//
// Asserted:
//   - NOTHING is requested before the dialog opens; opening reads catalogue_settings once (GET, X-Sporta-Admin) plus the shop's public routes through the
//     engine; the only write the block can make is catalogue_settings_save; no request to another host;
//   - tabs: tablist / tab / tabpanel roles, aria-selected, roving tabindex, Arrow / Home / End keys (reversed in Arabic);
//   - CONTENT: every field shows the stored value, counters ("n / max", a warning from 90%), the limits come from the server, switches, per page, the category
//     order (position, up / down with the ends disabled, a spoken note) and visibility;
//   - SAVE: the body is exactly {settings: {every field}} in the contract's names; Save is off until something changes; after a save the settings are READ again
//     from the server and the form shows what the server holds; a refusal (each kind), a lost connection or a signed-out session keeps the draft and says why,
//     and Save can be pressed again; nothing is half saved (Discard returns to the stored values);
//   - UNSAVED CHANGES: Close and Escape ask first (Keep editing / Discard and close), the browser's own leave warning is armed only while there is something to lose;
//   - PRODUCTS: the list, search (English, Arabic, address name, category), the filters, a hide and a pin switch per product that reach the save, the limit of
//     200, "Show more", the products the shop keeps out with the reason (translated) and no switch on them;
//   - SHARE: the page and live PDF links in both languages exactly, copy, WhatsApp, a link for one category / brand, a QR code drawn from the engine's modules
//     (and no QR button while the engine has none);
//   - STATUS: the numbers, the revision (and whether the public page shows it), "what a crawler sees" (GET of /catalogue in both languages, the ItemList count
//     read from the JSON-LD against what is expected, http errors, an empty head, noindex);
//   - DOWNLOAD: prices and sold-out switches reach buildPdf, "this view" is everything, the file language still decides the file;
//   - an API that does not know the routes yet: the tabs say so and the download works; Arabic is right to left; light and dark are readable (4.5:1); 390 px
//     has no sideways scroll on any tab and every control is 44 px; the admin's `.7rem` button rule does not win;
//   - MUTATIONS: without the settings wrapper, the unsaved-changes guard, the counter limit, the order direction, the 200 limit, the keep-the-draft rule, the
//     read after save, the prices option, the ItemList count, the QR drawing, the WhatsApp encoding or the radius rule, the matching check fails.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LIVE, SCREEN, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'
import { ROOT, PUB, engineSource, makeData } from './lib/catalogue-fx.mjs'

const FULL = readFileSync(join(PUB, 'sporta-admin-brands.js'), 'utf8')
const A = FULL.indexOf('/* ===== ADMIN CATALOGUE PDF - begin'), Z = FULL.indexOf('/* ===== ADMIN CATALOGUE PDF - end')
if (A < 0 || Z < A) { console.log('FAIL the ADMIN CATALOGUE PDF block is not in public/sporta-admin-brands.js'); process.exit(1) }
const BLOCK = FULL.slice(A, FULL.indexOf('*/', Z) + 2)   // the block alone: the rest of the file belongs to the compiled admin and adds requests of its own
const KNET_CSS = readFileSync(join(PUB, 'sporta-admin-knet.css'), 'utf8')
let pass = 0, fail = 0
// an engine whose qr() draws a diagonal 21 x 21 code (the shipped engine's own encoder is proven by test:qr); null = an engine that cannot draw one
const withQr = (on) => engineSource().replace(', qr: qr, fold: fold', on ? ", qr: function (t) { var n = 21, rows = []; for (var y = 0; y < n; y++) { var r = ''; for (var x = 0; x < n; x++) r += (x === y ? '1' : '0'); rows.push(r) } return { size: n, rows: rows, text: t } }, fold: fold" : ', qr: function () { return null }, fold: fold')
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const classes = [...new Set([...[SCREEN].concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'catalogue-settings-fixture.css') })).css
const RULE = '.admin-shell .admin-page :where(button, .btn){border-radius:.7rem}'   // what the compiled admin does to every button
const pageHtml = ({ ar, dark }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" ${dark ? 'class="dark" data-theme="dark" style="color-scheme:dark"' : 'data-theme="light" style="color-scheme:light"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style><style>${RULE}</style></head><body${dark ? ' style="background:#0f1419"' : ''}><div id="root">${screenHtml(SCREEN)}</div><script src="/fixture.js"></script><script src="/block.js"></script></body></html>`

// ------------------------------------------------------------------------------------------------ the fake server
const DEFAULT_ORDER = ['men', 'women', 'outerwear', 'accessories']
const NAMES = { men: ['رجال', 'Men'], women: ['نساء', 'Women'], outerwear: ['هوديز وجواكيت', 'Hoodies & Jackets'], accessories: ['إكسسوارات', 'Accessories'], kids: ['أطفال', 'Kids'] }
const P = (slug, en, ar, category, price, o = {}) => ({ slug, name_en: en, name_ar: ar, category, brand: o.brand ?? null, price, image: '/images/products/' + slug + '.jpg', active: true, listed: true, hidden_reasons: [], sold: false, sale: false, ...o })
const baseProducts = () => [
  P('men-alpha-top', 'Alpha Top', 'توب ألفا', 'men', 12, { brand: 'vanquish' }), P('men-zeta-top', 'Zeta Top', 'توب زيتا', 'men', 9), P('men-sale-shorts', 'Sale Shorts', 'شورت التخفيض', 'men', 8, { sale: true }),
  P('women-leggings', 'Cloudsoft Leggings', 'ليقنز كلاودسوفت', 'women', 14, { brand: 'ahed' }), P('women-top', 'Sculpt Top', 'توب سكلبت', 'women', 9.5, { sold: true }),
  P('outer-hoodie', 'Cagliari Hoodie', 'هودي كالياري', 'outerwear', 18), P('acc-cap', 'Denver Cap', 'كاب دنفر', 'accessories', 6),
  P('photoless-tee', 'Photoless Tee', 'تيشيرت بلا صورة', 'men', 7, { listed: false, hidden_reasons: ['photo'], image: null }), P('free-cap', 'Free Cap', 'كاب مجاني', 'accessories', 0, { listed: false, hidden_reasons: ['price'] }),
  P('bare-hoodie', 'Bare Hoodie', 'هودي بلا مقاسات', 'outerwear', 20, { listed: false, hidden_reasons: ['sku', 'photo'], image: null }), P('old-vest', 'Old Vest', 'سترة قديمة', 'men', 5, { listed: false, active: false, hidden_reasons: [] })
]
const baseSettings = () => ({
  title_ar: 'كتالوج سبورتا', title_en: 'Sporta Catalogue', intro_ar: '', intro_en: 'Fresh drops, every week.', note_ar: '', note_en: '',
  show_prices: true, show_sold_out: true, show_sizes: true, show_brand: true, cover: true, per_page: 9,
  categories_order: [], hidden_categories: [], hidden_slugs: [], pinned_slugs: ['men-alpha-top']
})
const LIMITS = { title: 80, intro: 400, note: 200 }
const O = 'https://www.sporta.com.kw/catalogue'
function makeWorld(o = {}) {
  const W = { settings: baseSettings(), products: baseProducts(), calls: [], posts: [], offHost: [], saveFault: null, readFault: null, drop: false, delay: 0, rev: 'rev111111aaaa', publicRev: 'rev111111aaaa', crawl: {}, engineJs: null, v2: true, ...o }
  if (o.settings) W.settings = { ...baseSettings(), ...o.settings }
  return W
}
function catsOf(W) {
  const s = W.settings, slugs = [...new Set(W.products.filter((p) => p.listed).map((p) => p.category))]
  const known = [...s.categories_order.filter((c) => slugs.includes(c)), ...DEFAULT_ORDER.filter((c) => slugs.includes(c) && !s.categories_order.includes(c)), ...slugs.filter((c) => !DEFAULT_ORDER.includes(c) && !s.categories_order.includes(c)).sort()]
  return known.map((slug) => ({ slug, name_ar: (NAMES[slug] || [slug, slug])[0], name_en: (NAMES[slug] || [slug, slug])[1], count: W.products.filter((p) => p.listed && p.category === slug).length, hidden: s.hidden_categories.includes(slug) }))
}
function adminRead(W) {
  const s = W.settings, cats = catsOf(W)
  const products = W.products.map((p) => ({
    slug: p.slug, name_ar: p.name_ar, name_en: p.name_en, category: p.category, brand: p.brand, price: p.price, image: p.image, active: p.active, listed: p.listed, hidden_reasons: p.hidden_reasons,
    hidden_from_catalogue: s.hidden_slugs.includes(p.slug), category_hidden: s.hidden_categories.includes(p.category), pinned: s.pinned_slugs.includes(p.slug),
    in_catalogue: p.listed && !s.hidden_slugs.includes(p.slug) && !s.hidden_categories.includes(p.category) && !(p.sold && !s.show_sold_out)
  }))
  const inn = products.filter((p) => p.in_catalogue)
  const links = (q) => ({ page: { ar: O + (q ? '?' + q : ''), en: O + '?' + (q ? q + '&' : '') + 'lang=en' }, pdf: { ar: O + '?' + (q ? q + '&' : '') + 'pdf=ar', en: O + '?' + (q ? q + '&' : '') + 'pdf=en' } })
  const brands = [...new Set(W.products.map((p) => p.brand).filter(Boolean))]
  return {
    settings: s, defaults: baseSettings(), limits: { ...LIMITS, per_page: [6, 9, 12], list: 200 }, categories: cats, products,
    share: { ...links(''), categories: cats.map((c) => ({ slug: c.slug, ...links('cat=' + c.slug) })), brands: brands.map((b) => ({ slug: b, ...links('brand=' + b) })) },
    status: { revision: W.rev, generated_at: '2026-11-19T12:00:00Z', listed: W.products.filter((p) => p.listed).length, in_catalogue: W.statusIn ?? inn.length, on_sale: W.products.filter((p) => p.sale && p.listed).length, sold_out: W.products.filter((p) => p.sold && p.listed).length,
      hidden_by_owner: products.filter((p) => p.hidden_from_catalogue || p.category_hidden).length, hidden_by_rules: products.filter((p) => p.active && p.hidden_reasons.length).length, pinned: inn.filter((p) => p.pinned).length }
  }
}
/** The save, the way store_catalogue_save does it: the request's keys over the stored ones, validated whole, nothing written unless everything passes. */
function saveWorld(W, body) {
  const inn = body && typeof body === 'object' && body.settings && typeof body.settings === 'object' ? body.settings : body
  if (!inn || typeof inn !== 'object') return { status: 400, body: { error: 'bad_request' } }
  const cur = W.settings, next = { ...cur }, fail = (e) => ({ status: 400, body: { error: e } })
  for (const k of Object.keys(cur)) {
    if (!(k in inn)) continue
    const v = inn[k]
    if (/^(title|intro|note)_(ar|en)$/.test(k)) { if (typeof v !== 'string') return fail('invalid_' + k); const c = v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); if (c.length > LIMITS[k.split('_')[0]]) return fail('invalid_' + k); next[k] = c }
    else if (typeof cur[k] === 'boolean') { if (typeof v !== 'boolean') return fail('invalid_' + k); next[k] = v }
    else if (k === 'per_page') { if (![6, 9, 12].includes(v)) return fail('invalid_per_page'); next[k] = v }
    else if (k === 'categories_order' || k === 'hidden_categories') {
      if (!Array.isArray(v)) return fail('invalid_' + k)
      const known = [...new Set(W.products.map((p) => p.category))]; if (v.some((x) => !known.includes(x))) return fail('unknown_category'); next[k] = [...new Set(v)]
    } else if (k === 'hidden_slugs' || k === 'pinned_slugs') {
      if (!Array.isArray(v) || v.length > 400) return fail('invalid_' + k)
      if (v.some((x) => !W.products.some((p) => p.slug === x))) return fail('unknown_product'); next[k] = [...new Set(v)]
      if (next[k].length > 200) return fail('invalid_' + k)
    }
  }
  W.settings = next; W.rev = 'rev' + String(W.posts.length + 2).padStart(9, '0') + 'z'
  return { status: 200, body: adminRead(W) }
}
const ldHtml = (n, o = {}) => `<!doctype html><html><head><meta charset="utf-8"><title>Catalogue</title>${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}${n == null ? '' : `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Catalogue', mainEntity: { '@type': 'ItemList', numberOfItems: n, itemListElement: Array.from({ length: n }, (_, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Product', name: 'P' + i } })) } })}</script>`}</head><body></body></html>`
const catalogueV2 = (W) => {
  const sizes = (p) => (p.sold ? [{ size: 'M', in_stock: false }] : [{ size: 'S', in_stock: true }, { size: 'M', in_stock: true }])
  const listed = W.products.filter((p) => p.listed)
  const settings = { title_ar: '', title_en: '', intro_ar: '', intro_en: '', note_ar: '', note_en: '', show_prices: W.settings.show_prices, show_sold_out: W.settings.show_sold_out, show_sizes: true, show_brand: true, cover: true, per_page: 9 }
  return { revision: W.publicRev, generated_at: '2026-11-19T12:00:00Z', count: listed.length, settings,
    categories: catsOf(W).map((c) => ({ slug: c.slug, name_ar: c.name_ar, name_en: c.name_en, count: c.count })), brands: [],
    products: listed.map((p) => ({ slug: p.slug, name_ar: p.name_ar, name_en: p.name_en, category: p.category, brand: '', price: p.price, list_price: p.sale ? p.price + 2 : p.price, pct_off: p.sale ? 20 : 0, on_sale: p.sale, featured: false, pinned: false, in_stock: !p.sold, sizes: sizes(p), image: '', image_small: null, images: [] })) }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function open(W, { w = 1280, h = 900, ar = false, dark = false, js = BLOCK, grant = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', acceptDownloads: true })
  if (grant) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {})
  const pg = await ctx.newPage(), errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), method = req.method()
    if (u.origin !== ORIGIN) { W.offHost.push(req.url()); return route.abort() }
    const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => route.fulfill({ status, body, headers: { 'content-type': type, ...headers } })
    const json = (status, b) => send(status, JSON.stringify(b), 'application/json')
    W.calls.push({ method, path: u.pathname, search: u.search, route: u.searchParams.get('r') || '', admin: req.headers()['x-sporta-admin'] || '', ct: req.headers()['content-type'] || '' })
    if (method !== 'GET') W.posts.push({ route: u.searchParams.get('r') || u.pathname, ct: req.headers()['content-type'] || '', admin: req.headers()['x-sporta-admin'] || '', body: (() => { try { return JSON.parse(req.postData() || 'null') } catch (e) { return '__unparsable__' } })() })
    if (u.pathname === '/api/admin.php') {
      const r = u.searchParams.get('r')
      if (W.noApi) return json(404, { error: 'not_found' })
      if (r === 'catalogue_settings' && method === 'GET') { if (W.readFault) return json(W.readFault.status ?? 500, W.readFault.body ?? { error: 'x' }); return json(200, adminRead(W)) }
      if (r === 'catalogue_settings_save' && method === 'POST') {
        if (W.delay) await sleep(W.delay)
        if (W.drop) return route.abort('failed')
        if (W.saveFault) return json(W.saveFault.status ?? 400, W.saveFault.body ?? { error: W.saveFault.token })
        const out = saveWorld(W, W.posts[W.posts.length - 1].body)
        return json(out.status, out.body)
      }
      return json(200, {})
    }
    if (u.pathname === '/api/api.php') {
      const r = u.searchParams.get('r')
      if (r === 'catalogue') return W.v2 ? json(200, catalogueV2(W)) : json(404, { error: 'not_found' })
      const D = makeData()
      return json(200, r === 'products' ? D.products : r === 'stock' ? D.stock : r === 'brands' ? D.brands : [])
    }
    if (u.pathname === '/catalogue') {
      const en = u.searchParams.get('lang') === 'en', k = en ? 'en' : 'ar', c = W.crawl[k] ?? { n: Math.min(adminRead(W).status.in_catalogue, 100) }
      if (c.status) return send(c.status, 'no', 'text/plain')
      return send(200, ldHtml(c.n, c))
    }
    if (u.pathname === '/fixture.js') return send(200, FIXTURE_JS + `;window.fx.screens=${JSON.stringify({ catalogue: SCREEN })}`, 'text/javascript')
    if (u.pathname === '/block.js') return send(200, js, 'text/javascript')
    if (u.pathname === '/sporta-catalogue.js') return send(200, W.engineJs || engineSource(), 'text/javascript')
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    const f = join(PUB, decodeURIComponent(u.pathname))
    if (/^\/(fonts|logo-white\.png)/.test(u.pathname) && !f.includes('..') && existsSync(f)) return send(200, readFileSync(f), u.pathname.endsWith('.png') ? 'image/png' : 'font/woff2')
    if (u.pathname.startsWith('/images/')) return send(404, 'no', 'text/plain')
    return send(200, pageHtml({ ar, dark }), 'text/html; charset=utf-8', { 'content-security-policy': CSP })
  })
  await pg.goto(`${ORIGIN}/backends?screen=catalogue`); await pg.waitForTimeout(700)
  return { ctx, pg, errors, W }
}
const R = '[data-scp-root]'
const sel = (k) => `[data-scp="${k}"]`
async function openDlg(pg, tab) {
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R)
  await pg.waitForFunction(() => document.querySelector('[data-scp="foot"]') && !document.querySelector('[data-scp="foot"]').hidden, null, { timeout: 10000 })
  await pg.waitForFunction(() => document.querySelector('[data-scp="download"]') && !document.querySelector('[data-scp="download"]').disabled, null, { timeout: 15000 })
  if (tab) await pg.click(sel('tab-' + tab))
}
const val = (pg, k) => pg.inputValue(sel('f-' + k))
const text = (pg, s) => pg.textContent(s)
const txt = (pg, s) => pg.evaluate((q) => (document.querySelector(q) || {}).innerText || '', s)
const saveBtn = (pg) => pg.isDisabled(sel('save'))
const settingsCalls = (W) => W.calls.filter((c) => c.path === '/api/admin.php' && /catalogue_settings/.test(c.route))
const cats = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-scp^="cat-"]')].map((n) => n.getAttribute('data-scp').slice(4)))
async function dismissSave(pg, expectKind) { await pg.waitForFunction((k) => document.querySelector('[data-scp="save-note"]').getAttribute('data-kind') === k, expectKind, { timeout: 8000 }).catch(() => {}) }

// ============================================================================================================= 1. entry
head('nothing before the dialog; what opening reads')
{
  const W = makeWorld(), { pg, errors } = await open(W)
  is(W.calls.filter((c) => c.path === '/api/admin.php' || c.path === '/api/api.php' || c.path === '/sporta-catalogue.js' || c.path === '/catalogue').length === 0, 'no admin, public-API, engine or page request before the dialog opens', JSON.stringify(W.calls.map((c) => c.path + c.search)))
  is(await pg.locator('[data-sporta-cpdf-open]').count() === 1, 'one entry button in the Catalogue header')
  await openDlg(pg)
  const sc = settingsCalls(W)
  is(sc.length === 1 && sc[0].method === 'GET' && sc[0].route === 'catalogue_settings' && sc[0].admin === '1', 'opening reads catalogue_settings once, GET, with the admin header', JSON.stringify(sc))
  const pub = W.calls.filter((c) => c.path === '/api/api.php').map((c) => c.route)
  is(pub.length >= 1 && pub.every((r) => ['catalogue', 'products', 'stock', 'brands'].includes(r)), 'the shop is read through the public routes only', pub.join(','))
  is(W.posts.length === 0 && W.offHost.length === 0, 'reading writes nothing and asks no other host', JSON.stringify([W.posts, W.offHost]))
  is(await pg.locator('[data-scp="crawl-run"]').count() === 0 && !W.calls.some((c) => c.path === '/catalogue'), 'the crawler check is not run by itself')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  const dlg = pg.locator(`${R} [role="dialog"]`)
  is(await dlg.getAttribute('aria-modal') === 'true' && await dlg.getAttribute('aria-labelledby') === 'scp-title', 'a modal dialog labelled by its title')
  is(await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('scp-x')), 'focus starts on the Close button')
}

// ============================================================================================================= 2. tabs
head('tabs')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg)
  const info = await pg.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => [t.textContent, t.getAttribute('aria-selected'), t.tabIndex, t.getAttribute('aria-controls')]))
  is(eq(info.map((i) => i[0]), ['Content', 'Products', 'Share', 'Status']) && eq(info.map((i) => i[1]), ['true', 'false', 'false', 'false']) && eq(info.map((i) => i[2]), [0, -1, -1, -1]), 'four tabs, the first selected, roving tabindex', JSON.stringify(info))
  is(await pg.getAttribute('[role="tablist"]', 'aria-label') === 'Catalogue settings' && await pg.getAttribute('[role="tabpanel"]', 'aria-labelledby') === 'scp-tab-content', 'the tablist is named and the panel is labelled by the selected tab')
  await pg.focus(sel('tab-content')); await pg.keyboard.press('ArrowRight')
  is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-products' && await pg.getAttribute(sel('tab-products'), 'aria-selected') === 'true', 'ArrowRight moves to Products and shows it')
  await pg.keyboard.press('End'); is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-status', 'End goes to the last tab')
  await pg.keyboard.press('ArrowRight'); is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-content', 'ArrowRight from the last wraps to the first')
  await pg.keyboard.press('ArrowLeft'); is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-status', 'ArrowLeft from the first wraps to the last')
  await pg.keyboard.press('Home'); is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-content', 'Home goes to the first tab')
  const ar = await open(makeWorld(), { ar: true }); await openDlg(ar.pg)
  await ar.pg.focus(sel('tab-content')); await ar.pg.keyboard.press('ArrowLeft')
  is(await ar.pg.evaluate(() => document.activeElement.id) === 'scp-tab-products', 'in Arabic the arrows are reversed: ArrowLeft goes on to the next tab')
  is(eq(await ar.pg.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)), ['المحتوى', 'المنتجات', 'المشاركة', 'الحالة']), 'the Arabic tab names')
}

// ============================================================================================================= 3. content
head('content: wording, switches, per page, category order')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg)
  is(await val(pg, 'title_en') === 'Sporta Catalogue' && await val(pg, 'title_ar') === 'كتالوج سبورتا' && await val(pg, 'intro_en') === 'Fresh drops, every week.' && await val(pg, 'note_en') === '', 'every field shows what the server stores')
  is(await pg.getAttribute(sel('f-title_ar'), 'dir') === 'rtl' && await pg.getAttribute(sel('f-title_en'), 'dir') === 'ltr', 'Arabic fields are right to left, English fields left to right')
  is(eq(await pg.evaluate(() => ['title', 'intro', 'note'].map((b) => document.querySelector(`[data-scp="f-${b}_en"]`).maxLength)), [80, 400, 200]), 'the limits are 80, 400 and 200 characters')
  is(await text(pg, sel('n-title_en')) === '16 / 80' && await text(pg, sel('n-intro_en')) === '24 / 400', 'the counters read "n / max"', await text(pg, sel('n-title_en')))
  await pg.fill(sel('f-title_en'), 'x'.repeat(60))
  is(await text(pg, sel('n-title_en')) === '60 / 80' && await pg.getAttribute(sel('n-title_en'), 'data-warn') === '0', 'the counter follows the typing')
  await pg.fill(sel('f-title_en'), 'x'.repeat(72))
  is(await pg.getAttribute(sel('n-title_en'), 'data-warn') === '1', 'from 90% of the limit the counter warns')
  await pg.fill(sel('f-title_en'), 'x'.repeat(100))
  is((await val(pg, 'title_en')).length === 80, 'the field refuses more than the limit (100 typed, 80 kept)')
  is(await pg.isChecked(sel('sw-show_prices')) && await pg.isChecked(sel('sw-cover')) && await pg.isChecked(sel('per-9')) && !(await pg.isChecked(sel('per-6'))), 'the five switches and the per-page choice show the stored values')
  await pg.click(sel('discard'))
  is(eq(await cats(pg), ['men', 'women', 'outerwear', 'accessories']), 'the categories come in the server’s order', JSON.stringify(await cats(pg)))
  is(await pg.isDisabled(sel('up-men')) && !(await pg.isDisabled(sel('down-men'))) && await pg.isDisabled(sel('down-accessories')) && !(await pg.isDisabled(sel('up-accessories'))), 'the first cannot go up, the last cannot go down')
  is(await pg.getAttribute(sel('up-women'), 'aria-label') === 'Move Women up' && await pg.getAttribute(sel('vis-women'), 'aria-label') === 'Show Women', 'the order buttons and the visible switch are named for their category')
  is(await pg.getAttribute(sel('vis-men'), 'role') === 'switch' && await pg.isChecked(sel('vis-men')), 'a visible category is a switch that is on')
  await pg.click(sel('down-men'))
  is(eq(await cats(pg), ['women', 'men', 'outerwear', 'accessories']), 'Move down puts Men after Women')
  is(/Men is now number 2 of 4/.test(await text(pg, sel('order-note'))), 'the move is said in a status line', await text(pg, sel('order-note')))
  is(await pg.evaluate(() => document.activeElement.getAttribute('data-scp')) === 'down-men', 'focus stays on the button that was pressed')
  await pg.click(sel('up-men'))
  is(eq(await cats(pg), ['men', 'women', 'outerwear', 'accessories']) && await saveBtn(pg), 'moving it back leaves nothing to save (Save is off again)')
  is(await text(pg, sel('state')) === 'No unsaved changes', 'the bar says there is nothing to save')
  await pg.fill(sel('f-intro_ar'), 'مقدمة')
  is(!(await saveBtn(pg)) && await text(pg, sel('state')) === 'Unsaved changes', 'typing makes Save available and says so')
  await pg.click(sel('discard'))
  is(await val(pg, 'intro_ar') === '' && await saveBtn(pg), 'Discard puts the stored values back')
  is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-content', 'after Discard focus goes to the open tab (the buttons are off)')
}

// ============================================================================================================= 4. save
head('save: the exact body, the read after it, the refusals')
{
  const W = makeWorld(), { pg, errors } = await open(W); await openDlg(pg)
  await pg.fill(sel('f-title_ar'), '  كتالوج جديد  '); await pg.fill(sel('f-note_en'), 'Prices in KWD')
  await pg.click(sel('sw-show_prices')); await pg.click(sel('per-12')); await pg.click(sel('down-men')); await pg.click(sel('vis-accessories'))
  await pg.click(sel('tab-products'))
  await pg.click(sel('hide-men-zeta-top')); await pg.click(sel('pin-women-leggings')); await pg.click(sel('pin-men-alpha-top'))
  const calls0 = W.calls.length
  await pg.click(sel('save')); await dismissSave(pg, 'ok')
  const post = W.posts.filter((p) => p.route === 'catalogue_settings_save')
  const want = { settings: {
    title_ar: '  كتالوج جديد  ', title_en: 'Sporta Catalogue', intro_ar: '', intro_en: 'Fresh drops, every week.', note_ar: '', note_en: 'Prices in KWD',
    show_prices: false, show_sold_out: true, show_sizes: true, show_brand: true, cover: true, per_page: 12,
    categories_order: ['women', 'men', 'outerwear', 'accessories'], hidden_categories: ['accessories'], hidden_slugs: ['men-zeta-top'], pinned_slugs: ['women-leggings'] } }
  is(post.length === 1 && eq(post[0].body, want), 'one POST with exactly {settings: {all 17 fields}} in the contract’s names', JSON.stringify(post[0] && post[0].body))
  is(post.length === 1 && post[0].admin === '1' && /^application\/json/.test(post[0].ct), 'the save carries the admin header and a JSON content type')
  const after = W.calls.slice(calls0).filter((c) => /catalogue_settings/.test(c.route)).map((c) => c.method + ' ' + c.route)
  is(eq(after, ['POST catalogue_settings_save', 'GET catalogue_settings']), 'after the save the settings are read again from the server', after.join(' > '))
  is(/^Saved\./.test(await text(pg, sel('save-note'))) && await pg.getAttribute(sel('save-note'), 'data-kind') === 'ok', 'success is said')
  is(await saveBtn(pg) && await text(pg, sel('state')) === 'No unsaved changes', 'the bar is clean again')
  is(await pg.evaluate(() => document.activeElement.getAttribute('data-scp')) === 'save-note', 'after a good save focus moves to the status line')
  await pg.click(sel('tab-content'))
  is(await pg.evaluate(() => document.activeElement.id) === 'scp-tab-content', 'clicking a tab keeps focus on that tab')
  is(await val(pg, 'title_ar') === 'كتالوج جديد' && await val(pg, 'note_en') === 'Prices in KWD', 'the form shows what the server holds (the title came back trimmed)')
  is(!(await pg.isChecked(sel('sw-show_prices'))) && await pg.isChecked(sel('per-12')) && eq(await cats(pg), ['women', 'men', 'outerwear', 'accessories']) && !(await pg.isChecked(sel('vis-accessories'))), 'switches, per page, order and visibility match the stored settings')
  is(W.posts.length === 1 && errors.length === 0, 'one write in all, no page errors', errors.join(' | '))
  // pinned list order is kept, an unchanged list is sent as it was
  await pg.click(sel('tab-products')); await pg.click(sel('pin-men-alpha-top')); await pg.click(sel('save')); await dismissSave(pg, 'ok')
  is(eq(W.posts[1].body.settings.pinned_slugs, ['women-leggings', 'men-alpha-top']) && eq(W.posts[1].body.settings.categories_order, ['women', 'men', 'outerwear', 'accessories']), 'a new pin goes after the existing one; the stored category order is sent back unchanged')
}
{
  const faults = [
    ['a too-long value', { status: 400, token: 'invalid_title_en' }, /not valid \(invalid_title_en\)/],
    ['a product that no longer exists', { status: 400, token: 'unknown_product' }, /no longer exists/],
    ['a category that no longer exists', { status: 400, token: 'unknown_category' }, /category in your lists no longer exists/],
    ['a request that is too large', { status: 413, token: 'request_too_large' }, /too large/],
    ['an unknown refusal', { status: 403, token: 'bad_request' }, /refused the save \(bad_request\)/],
    ['a signed-out session', { status: 401, body: {} }, /signed out/],
    ['a server error', { status: 500, body: {} }, /could not be saved/]
  ]
  for (const [label, f, re] of faults) {
    const W = makeWorld({ saveFault: f }), { pg } = await open(W); await openDlg(pg)
    await pg.fill(sel('f-title_en'), 'Changed title'); await pg.click(sel('save')); await dismissSave(pg, 'err')
    const note = await text(pg, sel('save-note'))
    is(re.test(note) && await pg.getAttribute(sel('save-note'), 'data-kind') === 'err', `${label}: the reason is said`, note)
    is(await val(pg, 'title_en') === 'Changed title' && !(await saveBtn(pg)) && await text(pg, sel('state')) === 'Unsaved changes', `${label}: the draft is kept and Save can be pressed again`)
    is(settingsCalls(W).filter((c) => c.method === 'GET').length === 1, `${label}: no read after a failed save (nothing was applied)`)
  }
  const W = makeWorld({ drop: true }), { pg } = await open(W); await openDlg(pg)
  await pg.click(sel('sw-cover')); await pg.click(sel('save')); await dismissSave(pg, 'err')
  is(/could not be saved\. Nothing was changed/.test(await text(pg, sel('save-note'))) && !(await pg.isChecked(sel('sw-cover'))), 'a lost connection: said, and the switch stays as the owner left it')
  W.drop = false; await pg.click(sel('save')); await dismissSave(pg, 'ok')
  is(W.settings.cover === false && /^Saved/.test(await text(pg, sel('save-note'))), 'the same draft saves once the connection is back')
  const W2 = makeWorld({ saveFault: { status: 400, token: 'invalid_per_page' } }), t2 = await open(W2); await openDlg(t2.pg)
  await t2.pg.click(sel('per-6')); await t2.pg.click(sel('save')); await dismissSave(t2.pg, 'err'); await t2.pg.click(sel('discard'))
  is(await t2.pg.isChecked(sel('per-9')) && await saveBtn(t2.pg) && eq(W2.settings, baseSettings()), 'after a refusal, Discard returns to the stored values; the server row never changed')
  const W3 = makeWorld({ delay: 600 }), t3 = await open(W3); await openDlg(t3.pg)
  await t3.pg.fill(sel('f-title_en'), 'Slow'); await t3.pg.click(sel('save'))
  is(await t3.pg.isDisabled(sel('save')) && await t3.pg.isDisabled(sel('discard')) && /Saving/.test(await text(t3.pg, sel('state'))) && await t3.pg.getAttribute(sel('panel'), 'aria-busy') === 'true', 'while saving: Save and Discard are off and the form is busy')
  await t3.pg.keyboard.press('Escape')
  is(await t3.pg.locator(R).count() === 1, 'the dialog cannot be closed in the middle of a save')
  await dismissSave(t3.pg, 'ok')
}

// ============================================================================================================= 5. unsaved changes
head('unsaved changes')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg)
  await pg.click(sel('sw-cover')); await pg.click(`${R} .scp-x`)
  is(await pg.locator(R).count() === 1 && await pg.locator(sel('leave')).isVisible() && /unsaved changes/.test(await text(pg, sel('leave'))), 'Close with a change asks first')
  is(await pg.evaluate(() => document.activeElement.getAttribute('data-scp')) === 'leave-keep', 'focus goes to "Keep editing"')
  await pg.click(sel('leave-keep'))
  is(await pg.locator(R).count() === 1 && !(await pg.locator(sel('leave')).isVisible()) && !(await pg.isChecked(sel('sw-cover'))), 'Keep editing returns to the form, the change is still there')
  await pg.keyboard.press('Escape')
  is(await pg.locator(sel('leave')).isVisible(), 'Escape asks too')
  await pg.keyboard.press('Escape')
  is(await pg.locator(R).count() === 1 && !(await pg.locator(sel('leave')).isVisible()), 'Escape on the question keeps editing')
  await pg.click(`${R} .scp-x`); await pg.click(sel('leave-go'))
  is(await pg.locator(R).count() === 0 && await pg.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-cpdf-open')), 'Discard and close closes it and returns focus to the button')
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R); await pg.waitForFunction(() => !document.querySelector('[data-scp="foot"]').hidden)
  is(await pg.isChecked(sel('sw-cover')) && W.posts.length === 0, 'reopened: the discarded change is gone and nothing was saved')
  await pg.keyboard.press('Escape')
  is(await pg.locator(R).count() === 0, 'with nothing to lose Escape closes at once')
  // the browser's own warning
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R); await pg.waitForFunction(() => !document.querySelector('[data-scp="foot"]').hidden)
  await pg.click(sel('sw-cover'))
  const ev = await pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
  is(ev === true, 'with unsaved changes the browser’s leave warning is armed')
  await pg.click(sel('discard'))
  const ev2 = await pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
  is(ev2 === false, 'with nothing to lose it is not')
  await pg.click(sel('sw-cover')); await pg.keyboard.press('Escape'); await pg.click(sel('leave-go'))
  const ev3 = await pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
  is(ev3 === false, 'once the dialog is closed the warning is gone')
}

// ============================================================================================================= 6. products
head('products')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg, 'products')
  const rows = await pg.evaluate(() => [...document.querySelectorAll('[data-scp^="prod-"]')].map((n) => n.getAttribute('data-scp').slice(5)))
  is(eq(rows, ['men-alpha-top', 'men-zeta-top', 'men-sale-shorts', 'women-leggings', 'women-top', 'outer-hoodie', 'acc-cap']), 'the seven listed products are rows, in the server’s order', rows.join(','))
  is(/In the list: 7 · Hidden by you: 0 · Pinned: 1/.test(await text(pg, sel('p-summary'))), 'the summary counts the list')
  is(await pg.isChecked(sel('pin-men-alpha-top')) && !(await pg.isChecked(sel('hide-men-alpha-top'))) && /Pinned/.test(await text(pg, sel('prod-men-alpha-top'))), 'a pinned product shows its pin switch on and a Pinned badge')
  is(await pg.getAttribute(sel('hide-men-zeta-top'), 'aria-label') === 'Hide Zeta Top from the catalogue' && await pg.getAttribute(sel('pin-men-zeta-top'), 'aria-label') === 'Pin Zeta Top to the top', 'each switch is named for its product')
  const kept = await pg.evaluate(() => [...document.querySelectorAll('[data-scp^="kept-"]')].map((n) => [n.getAttribute('data-scp').slice(5), n.innerText.replace(/\s+/g, ' ')]))
  is(eq(kept.map((k) => k[0]), ['photoless-tee', 'free-cap', 'bare-hoodie', 'old-vest']), 'the four products the shop keeps out are listed apart')
  is(/no photo/.test(kept[0][1]) && /no price/.test(kept[1][1]) && /no size or SKU · no photo/.test(kept[2][1]) && /switched off/.test(kept[3][1]), 'each says why, in words', JSON.stringify(kept.map((k) => k[1])))
  is(await pg.locator('[data-scp^="kept-"] input').count() === 0, 'a kept-out product has no switch')
  is(/Kept out by the shop’s own rules \(4\)/.test(await text(pg, sel('panel'))), 'the section names its count')
  await pg.click(sel('hide-men-zeta-top'))
  is(await pg.isChecked(sel('hide-men-zeta-top')) && /Hidden by you/.test(await text(pg, sel('prod-men-zeta-top'))) && /Hidden by you: 1/.test(await text(pg, sel('p-summary'))) && !(await saveBtn(pg)), 'hiding a product shows it at once, counts it and makes Save available')
  is(await pg.evaluate(() => document.activeElement.getAttribute('data-scp')) === 'hide-men-zeta-top', 'focus stays on the switch')
  await pg.click(sel('tab-content')); await pg.click(sel('vis-women')); await pg.click(sel('tab-products'))
  is(/Category hidden/.test(await text(pg, sel('prod-women-top'))), 'a product whose category is switched off says so')
  // search
  const names = () => pg.evaluate(() => [...document.querySelectorAll('[data-scp^="prod-"]')].map((n) => n.getAttribute('data-scp').slice(5)))
  await pg.fill(sel('p-search'), 'top'); is(eq(await names(), ['men-alpha-top', 'men-zeta-top', 'women-top']), 'search finds by English name', (await names()).join())
  await pg.fill(sel('p-search'), 'ليقنز'); is(eq(await names(), ['women-leggings']), 'search finds by Arabic name')
  await pg.fill(sel('p-search'), 'هُودِي'); is(eq(await names(), ['outer-hoodie']), 'search ignores Arabic diacritics', (await names()).join())
  await pg.fill(sel('p-search'), 'acc-cap'); is(eq(await names(), ['acc-cap']), 'search finds by address name')
  await pg.fill(sel('p-search'), 'OUTERWEAR'); is(eq(await names(), ['outer-hoodie']), 'search finds by category, any case')
  await pg.fill(sel('p-search'), 'photoless'); is(eq(await names(), []) && await pg.locator('[data-scp="kept-photoless-tee"]').count() === 1, 'search reaches the kept-out list too')
  await pg.fill(sel('p-search'), 'zzzz'); is(/No product matches/.test(await text(pg, sel('p-list'))), 'no match is said')
  await pg.fill(sel('p-search'), '')
  await pg.click(sel('pf-hidden')); is(eq(await names(), ['men-zeta-top']) && await pg.getAttribute(sel('pf-hidden'), 'aria-pressed') === 'true', 'the "Hidden by you" filter shows only those')
  await pg.click(sel('pf-pinned')); is(eq(await names(), ['men-alpha-top']), 'the "Pinned" filter shows only those')
  await pg.click(sel('pf-all')); is((await names()).length === 7, '"All" shows the list again')
  await pg.click(sel('save')); await dismissSave(pg, 'ok')
  is(eq(W.settings.hidden_slugs, ['men-zeta-top']) && eq(W.settings.hidden_categories, ['women']) && eq(W.settings.pinned_slugs, ['men-alpha-top']), 'the hide, the category and the pin reach the server as chosen', JSON.stringify(W.settings))
  const ar = await open(makeWorld(), { ar: true }); await openDlg(ar.pg, 'products')
  is(/توب ألفا/.test(await text(ar.pg, sel('prod-men-alpha-top'))) && /تثبيت في الأعلى/.test(await text(ar.pg, sel('prod-men-alpha-top'))), 'in Arabic the rows use the Arabic names and words')
}
{
  // 130 listed products: paging, and the limit of 200
  const many = Array.from({ length: 230 }, (_, i) => P('bulk-' + String(i).padStart(3, '0'), 'Bulk ' + i, 'منتج ' + i, 'men', 5 + i))
  const W = makeWorld(); W.products = baseProducts().concat(many)
  const { pg } = await open(W); await openDlg(pg, 'products')
  const n1 = await pg.locator('[data-scp^="prod-"]').count()
  is(n1 === 60 && /Showing 60 of 237/.test(await text(pg, sel('p-list'))), 'a long list shows 60 rows and says so', String(n1))
  await pg.click(sel('p-more')); is(await pg.locator('[data-scp^="prod-"]').count() === 120, '"Show more" adds 60')
  await pg.fill(sel('p-search'), 'Bulk'); is(await pg.locator('[data-scp^="prod-"]').count() === 60, 'a new search starts at 60 again')
  await pg.fill(sel('p-search'), '')
  // sixty switches, then the rest, all in the page (the list is rebuilt after each one)
  const hideAll = () => pg.evaluate(() => { for (;;) { const b = [...document.querySelectorAll('[data-scp^="hide-"]')].find((x) => !x.checked && !x.dataset.t); if (!b) break; b.dataset.t = '1'; b.click() } })
  const more = () => pg.evaluate(() => { const m = document.querySelector('[data-scp="p-more"]'); if (m) m.click() })
  await hideAll()
  is(/Hidden by you: 60/.test(await text(pg, sel('p-summary'))), 'sixty switches are on after sixty clicks', await text(pg, sel('p-summary')))
  for (let i = 0; i < 4; i++) { await more(); await hideAll() }
  const s2 = await text(pg, sel('p-summary')), nn = await text(pg, sel('p-note'))
  is(/Hidden by you: 200\b/.test(s2) && /At most 200 products can be hidden/.test(nn), 'the 200th hide is accepted and the 201st is refused with a note', s2 + ' | ' + nn)
  is(await pg.evaluate(() => [...document.querySelectorAll('[data-scp^="hide-"]')].filter((b) => b.checked).length) === 200, 'exactly 200 switches are on; the refused one went back off')
}

// ============================================================================================================= 7. share
head('share')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg, 'share')
  const url = (k) => pg.evaluate((q) => document.querySelector(`[data-scp="url-${q}"]`).textContent, k)
  is(await url('page') === O && await url('pageEn') === O + '?lang=en' && await url('pdfAr') === O + '?pdf=ar' && await url('pdfEn') === O + '?pdf=en', 'the page and the live PDF links, both languages, exactly')
  const a = pg.locator(`${R} a.scp-link`)
  is(await a.count() === 1 && await a.getAttribute('href') === O && await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel')), 'the page link opens in a new tab with rel noopener')
  for (const [k, v] of [['page', O], ['pageEn', O + '?lang=en'], ['pdfAr', O + '?pdf=ar'], ['pdfEn', O + '?pdf=en']]) {
    await pg.click(sel('copy-' + k)); await pg.waitForFunction((q) => document.querySelector(`[data-scp="copy-${q}"]`).textContent === 'Copied', k, { timeout: 4000 }).catch(() => {})
    is(await pg.evaluate(() => navigator.clipboard.readText()) === v, `Copy puts exactly ${v} on the clipboard`)
  }
  is(await pg.getAttribute(sel('wa-pdfAr'), 'href') === 'https://wa.me/?text=' + encodeURIComponent('Sporta catalogue ' + O + '?pdf=ar') && await pg.getAttribute(sel('wa-pdfAr'), 'target') === '_blank', 'WhatsApp opens wa.me with the text and the link, encoded, in a new tab')
  { const W0 = makeWorld({ engineJs: withQr(false) }), t0 = await open(W0); await openDlg(t0.pg, 'share'); is(await t0.pg.locator('[data-scp^="qr-"]').count() === 0, 'no QR button while the engine cannot draw one (SportaCatalogue.qr answers null)'); await t0.ctx.close() }
  is(await pg.locator('[data-scp^="qr-"]').count() === 8, 'with the shipped engine (its own QR encoder) every address gets a QR button (4 + 4)')
  // one category / brand
  const eng = (fn) => pg.evaluate(fn)
  await pg.selectOption(sel('pick-cat'), 'men')
  const p1 = [await url('selPage'), await url('selPageEn'), await url('selPdfAr'), await url('selPdfEn')]
  const expect1 = await eng(() => { const E = window.SportaCatalogue, v = E.viewOf(''); v.cat = 'men'; return [E.pageLink('ar', v), E.pageLink('en', v), E.pdfLink('ar', v), E.pdfLink('en', v)] })
  is(eq(p1, expect1) && /cat=men/.test(p1[0]) && /pdf=ar/.test(p1[2]) && /lang=en/.test(p1[1]) && p1.every((u) => u.startsWith('https://www.sporta.com.kw/catalogue')), 'one category: the four links are the engine’s own (the page reads the same parameters)', p1.join(' '))
  await pg.selectOption(sel('pick-brand'), 'ahed')
  const p2 = await url('selPdfEn')
  is(/cat=men/.test(p2) && /brand=ahed/.test(p2) && /pdf=en/.test(p2), 'a category and a brand together', p2)
  await pg.selectOption(sel('pick-cat'), ''); await pg.selectOption(sel('pick-brand'), '')
  is(await url('selPdfAr') === O + '?pdf=ar', 'back to "All" gives the plain links again')
  is(eq(await pg.evaluate(() => [...document.querySelectorAll('[data-scp="pick-cat"] option')].map((o) => o.textContent)), ['All categories', 'Men', 'Women', 'Hoodies & Jackets', 'Accessories']), 'the category list has every category by name')
  is(eq(await pg.evaluate(() => [...document.querySelectorAll('[data-scp="pick-brand"] option')].map((o) => o.value)), ['', 'vanquish', 'ahed']), 'the brand list has the brands of the products')
}
{
  // a QR code from an engine that has one: modules on the diagonal
  const stub = withQr(true)
  const W = makeWorld({ engineJs: stub }), { pg } = await open(W); await openDlg(pg, 'share')
  is(stub !== engineSource() && await pg.locator('[data-scp^="qr-"]').count() === 8, 'with an engine that has a QR code every address gets a QR button (4 + 4)')
  await pg.click(sel('qr-pdfAr'))
  const px = await pg.evaluate(() => {
    const c = document.querySelector('[data-scp="qrbox-pdfAr"] canvas'), g = c.getContext('2d'), scale = Math.floor(288 / (21 + 8)), at = (mx, my) => [...g.getImageData((mx + 4) * scale + 2, (my + 4) * scale + 2, 1, 1).data]
    return { w: c.width, label: c.getAttribute('aria-label'), dark: at(3, 3), light: at(3, 4), corner: [...g.getImageData(1, 1, 1, 1).data], expanded: document.querySelector('[data-scp="qr-pdfAr"]').getAttribute('aria-expanded') }
  })
  is(px.w === 29 * 9 && px.dark[0] < 40 && px.light[0] > 240 && px.corner[0] > 240, 'the canvas draws the engine’s modules: dark where a module is "1", white elsewhere, a quiet zone round it', JSON.stringify(px))
  is(/QR code of https:\/\/www\.sporta\.com\.kw\/catalogue\?pdf=ar/.test(px.label) && px.expanded === 'true', 'the QR code is labelled with its address and the button says it is open')
  await pg.click(sel('qr-pdfEn'))
  is(await pg.locator('[data-scp^="qrbox-"]').count() === 1 && await pg.locator(sel('qrbox-pdfEn')).count() === 1, 'one QR code is open at a time')
  const dl = pg.waitForEvent('download'); await pg.click(sel('qrsave-pdfEn')); const d = await dl
  is(/^sporta-catalogue-qr\.png$/.test(d.suggestedFilename()), 'Save image downloads the picture', d.suggestedFilename())
  await pg.click(sel('qr-pdfEn')); is(await pg.locator('[data-scp^="qrbox-"]').count() === 0, 'Hide QR closes it')
}

// ============================================================================================================= 8. status
head('status and what a crawler sees')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg, 'status')
  const stat = (k) => pg.evaluate((q) => document.querySelector(`[data-scp="stat-${q}"] b`).textContent, k)
  is(eq([await stat('listed'), await stat('in_catalogue'), await stat('on_sale'), await stat('sold_out'), await stat('hidden_by_owner'), await stat('hidden_by_rules'), await stat('pinned')], ['7', '7', '1', '1', '0', '3', '1']), 'the numbers are the server’s: listed 7, in the catalogue 7, on sale 1, sold out 1, hidden 0, kept out by rules 3, pinned 1')
  is(await text(pg, sel('rev')) === 'rev111111aaaa' && /Made: .*2026/.test(await text(pg, sel('panel'))), 'the revision and the time it was made')
  is(/Public page revision: rev111111aaaa/.test(await text(pg, sel('public-rev'))) && /shows this revision/.test(await text(pg, sel('public-rev'))), 'the public page shows the same revision, and it says so', await text(pg, sel('public-rev')))
  const before = W.calls.filter((c) => c.path === '/catalogue').length
  is(before === 0, 'the crawler check has made no request yet')
  await pg.click(sel('crawl-run')); await pg.waitForSelector(sel('crawl-en'))
  const cr = W.calls.filter((c) => c.path === '/catalogue')
  is(cr.length === 2 && cr.every((c) => c.method === 'GET') && eq(cr.map((c) => c.search), ['', '?lang=en']), 'it reads /catalogue and /catalogue?lang=en, GET, nothing else', JSON.stringify(cr))
  is(/Arabic: 7 products in the page head \(expected 7\)\./.test(await text(pg, sel('crawl-ar'))) && await pg.getAttribute(sel('crawl-ar'), 'data-k') === 'ok' && await pg.getAttribute(sel('crawl-en'), 'data-k') === 'ok', 'both languages: the ItemList has the expected 7 products', await text(pg, sel('crawl-box')))
  W.crawl = { ar: { n: 3 }, en: { n: null } }
  await pg.click(sel('crawl-run')); await pg.waitForFunction(() => document.querySelector('[data-scp="crawl-en"]') && /lists no products/.test(document.querySelector('[data-scp="crawl-en"]').textContent))
  is(/Arabic: 3 products in the page head, expected 7\./.test(await text(pg, sel('crawl-ar'))) && await pg.getAttribute(sel('crawl-ar'), 'data-k') === 'bad', 'a head with the wrong count is flagged')
  is(/English: the page answers but lists no products in its head/.test(await text(pg, sel('crawl-en'))), 'a page with no product list says so')
  W.crawl = { ar: { status: 500 }, en: { n: 7, robots: 'noindex, follow' } }
  await pg.click(sel('crawl-run')); await pg.waitForFunction(() => document.querySelector('[data-scp="crawl-en"]') && /noindex/.test(document.querySelector('[data-scp="crawl-en"]').textContent))
  is(/Arabic: the page answered 500/.test(await text(pg, sel('crawl-ar'))) && /marked noindex/.test(await text(pg, sel('crawl-en'))), 'an http error and a noindex page are named')
  is(W.posts.length === 0, 'the status tab only reads')
  W.publicRev = 'rev222222bbbb'; await pg.click(sel('status-reload')); await pg.waitForFunction(() => /another revision/.test(document.querySelector('[data-scp="public-rev"]').textContent), null, { timeout: 8000 }).catch(() => {})
  is(/Public page revision: rev222222bbbb/.test(await text(pg, sel('public-rev'))) && /another revision/.test(await text(pg, sel('public-rev'))), 'a public page on another revision is said, and "Read again" reads both', await text(pg, sel('public-rev')))
}
{
  // the cap of 100 items, and the unsaved case
  const W = makeWorld(); W.statusIn = 150; W.crawl = { ar: { n: 100 }, en: { n: 100 } }
  const { pg } = await open(W); await openDlg(pg, 'status')
  await pg.click(sel('crawl-run')); await pg.waitForSelector(sel('crawl-en'))
  is(/Arabic: 100 products in the page head \(expected 100\)/.test(await text(pg, sel('crawl-ar'))) && await pg.getAttribute(sel('crawl-ar'), 'data-k') === 'ok', 'a catalogue of 150 is expected to show 100 in the head (the server’s cap)')
  await pg.click(sel('tab-content')); await pg.click(sel('sw-cover')); await pg.click(sel('tab-status'))
  is(await pg.isDisabled(sel('status-reload')) && /Save or discard/.test(await text(pg, sel('panel'))), 'with unsaved changes "Read again" is off and says why')
}

// ============================================================================================================= 9. the download options
head('the download')
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg)
  await pg.evaluate(() => { const E = window.SportaCatalogue, o = E.buildPdf; window.__bp = []; E.buildPdf = function (a) { window.__bp.push({ lang: a.lang, prices: a.prices, soldOut: a.soldOut, n: a.products.length, view: a.view, hasSettings: !!a.settings }); return o.apply(this, arguments) } })
  is(await pg.isChecked(sel('opt-prices')) && await pg.isChecked(sel('opt-sold')) && /whole catalogue/.test(await text(pg, '[data-scp="dl"] .scp-sub')), 'prices and sold-out products are on by default; the file is the whole catalogue')
  await pg.click(sel('opt-prices')); await pg.click(sel('opt-sold')); await pg.click(sel('lang-ar'))
  const dl = pg.waitForEvent('download'); await pg.click(sel('download')); const d = await dl
  const bp = await pg.evaluate(() => window.__bp)
  is(bp.length === 1 && bp[0].prices === false && bp[0].soldOut === false && bp[0].lang === 'ar' && bp[0].n === 7 && bp[0].hasSettings, 'buildPdf gets prices off, sold-out off, the file language and all 7 products', JSON.stringify(bp))
  is(bp[0].view && bp[0].view.cat === '' && bp[0].view.q === '' && bp[0].view.sale === false && bp[0].view.stock === false, '"this view" is the blank view (everything)', JSON.stringify(bp[0].view))
  is(/^Sporta-Catalogue-AR-/.test(d.suggestedFilename()), 'the Arabic file is named for its language', d.suggestedFilename())
  await pg.waitForFunction(() => /Ready:/.test(document.querySelector('[data-scp="status"]').textContent))
  is(await pg.locator(sel('again')).count() === 1, '"Download again" is offered once it is made')
  // the shop's own switches can only tighten
  const W2 = makeWorld({ settings: { show_prices: false, show_sold_out: false } }), t2 = await open(W2); await openDlg(t2.pg)
  is(!(await t2.pg.isChecked(sel('opt-prices'))) && await t2.pg.isDisabled(sel('opt-prices')) && /The shop hides prices/.test(await text(t2.pg, '[data-scp="dl"]')) && await t2.pg.isDisabled(sel('opt-sold')), 'when the shop already hides prices and sold-out products the two options are off and locked, with the reason')
  // unsaved edits and the file
  await t2.pg.click(sel('sw-cover'))
  is(/save your changes first/.test(await text(t2.pg, '[data-scp="dl"] .scp-sub')), 'with unsaved edits the download card says the file uses the saved settings')
}

// ============================================================================================================= 10. an API without the routes
head('an API that does not know the settings yet')
{
  const W = makeWorld({ noApi: true, v2: false }), { pg } = await open(W); await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R)
  await pg.waitForFunction(() => document.querySelector('[data-scp="download"]') && !document.querySelector('[data-scp="download"]').disabled, null, { timeout: 15000 })
  is(/not on the server yet/.test(await text(pg, sel('panel'))) && await pg.locator(sel('foot')).isHidden(), 'the Content tab says the settings are not on the server yet; there is no save bar')
  await pg.click(sel('tab-products')); is(/not on the server yet/.test(await text(pg, sel('panel'))), 'so does Products')
  await pg.click(sel('tab-share'))
  const u = await pg.evaluate(() => document.querySelector('[data-scp="url-pdfEn"]').textContent)
  is(u === O + '?pdf=en' && await pg.locator(sel('copy-pdfAr')).count() === 1, 'Share still works with the default addresses')
  await pg.click(sel('tab-status'))
  is(await text(pg, sel('stat-in_catalogue') + ' b') === '19', 'Status still shows the numbers the engine can count (19 products)')
  is(/older data routes/.test(await text(pg, sel('public-rev'))), 'and says the public page is on the older routes (no revision)')
  const dl = pg.waitForEvent('download'); await pg.click(sel('download')); await dl
  is(W.posts.length === 0, 'the download works and nothing is written')
  const W2 = makeWorld({ readFault: { status: 500 } }), t2 = await open(W2); await t2.pg.click('[data-sporta-cpdf-open]'); await t2.pg.waitForSelector(R)
  await t2.pg.waitForSelector(sel('admin-retry'))
  is(/could not be read/.test(await text(t2.pg, sel('panel'))), 'a failing settings read is said, with a retry')
  W2.readFault = null; await t2.pg.click(sel('admin-retry')); await t2.pg.waitForSelector(sel('f-title_en'))
  is(await val(t2.pg, 'title_en') === 'Sporta Catalogue', 'Try again recovers')
  const W3 = makeWorld({ readFault: { status: 401, body: {} } }), t3 = await open(W3); await t3.pg.click('[data-sporta-cpdf-open]'); await t3.pg.waitForSelector(R)
  await t3.pg.waitForFunction(() => /signed out/.test(document.querySelector('[data-scp="panel"]').textContent))
  is(await t3.pg.locator(sel('admin-retry')).count() === 0, 'a signed-out session is said, without a retry button')
}

// ============================================================================================================= 11. Arabic, phone, dark, accessibility
head('Arabic, a phone, light and dark')
async function metrics(pg) {
  return pg.evaluate(() => {
    const sc = document.querySelector('.scp-scroll'), vis = (e) => e.getClientRects().length > 0
    const targets = [...document.querySelectorAll('[data-scp-root] button, [data-scp-root] select, [data-scp-root] input:not([type=radio]):not([type=checkbox]), [data-scp-root] textarea, [data-scp-root] .scp-sw, [data-scp-root] .scp-radio, [data-scp-root] a.scp-btn')].filter(vis)
    return { sw: sc.scrollWidth - sc.clientWidth, pageSw: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: targets.filter((e) => Math.round(e.getBoundingClientRect().height) < 44).map((e) => (e.getAttribute('data-scp') || e.className) + ':' + Math.round(e.getBoundingClientRect().height)), n: targets.length }
  })
}
for (const ar of [false, true]) {
  const W = makeWorld(), { pg, errors } = await open(W, { w: 390, h: 844, ar }); await openDlg(pg)
  for (const tab of ['content', 'products', 'share', 'status']) {
    await pg.click(sel('tab-' + tab))
    if (tab === 'status') { await pg.click(sel('crawl-run')); await pg.waitForSelector(sel('crawl-en')) }
    const m = await metrics(pg)
    is(m.sw <= 0 && m.pageSw <= 0 && m.small.length === 0 && m.n > 3, `${ar ? 'Arabic' : 'English'}, 390 px, ${tab}: no sideways scroll and every control at least 44 px`, JSON.stringify(m))
  }
  is(errors.length === 0, `${ar ? 'Arabic' : 'English'} phone: no page errors`, errors.join(' | '))
}
{
  const W = makeWorld(), { pg } = await open(W, { ar: true }); await openDlg(pg)
  is(await pg.getAttribute(R, 'dir') === 'rtl' && /الصياغة/.test(await text(pg, sel('panel'))) && await text(pg, sel('save')) === 'حفظ', 'the Arabic dialog is right to left, in Arabic, with Arabic buttons')
  const knob = await pg.evaluate(() => { const l = document.querySelector('[data-scp="sw-cover"]').parentElement.querySelector('.scp-trk'), r = l.getBoundingClientRect(), a = getComputedStyle(l, '::after'); return { w: r.width, left: a.insetInlineStart, dir: getComputedStyle(l).direction } })
  is(knob.dir === 'rtl' && /px/.test(knob.left), 'a switch knob is placed with logical offsets (it follows the direction)', JSON.stringify(knob))
}
// a switch changes its look when it is on, by more than colour alone (the knob moves)
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg)
  const pos = (k) => pg.evaluate((q) => { const t = document.querySelector(`[data-scp="${q}"]`).parentElement.querySelector('.scp-trk'); return getComputedStyle(t, '::after').insetInlineStart }, k)
  const on = await pos('sw-cover'); await pg.click(sel('sw-cover')); const off = await pos('sw-cover')
  is(on !== off, 'the knob moves between on and off', on + ' / ' + off)
  is(await pg.evaluate(() => { const i = document.querySelector('[data-scp="sw-cover"]'); return i.getBoundingClientRect().height >= 44 && i.getBoundingClientRect().width >= 44 }), 'the switch’s hit area is at least 44 px')
  await pg.focus(sel('sw-cover')); await pg.keyboard.press('Space')
  is(await pg.isChecked(sel('sw-cover')), 'Space toggles a switch from the keyboard')
}
const CONTRAST = () => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bgOf = (e) => { let n = e; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.99) return c; n = n.parentElement } return { r: 255, g: 255, b: 255 } }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const out = []
  const pick = (q, label) => { const e = [...document.querySelectorAll(q)].find((n) => n.getClientRects().length); if (!e) { out.push([label, 0]); return } out.push([label, Math.round(ratio(parse(getComputedStyle(e).color), bgOf(e)) * 100) / 100]) }
  return { pick, out, ratio, parse, bgOf }
}
for (const dark of [false, true]) {
  const W = makeWorld(), { pg } = await open(W, { dark }); await openDlg(pg)
  const probe = async (qs) => pg.evaluate(([qs2, src]) => { const h = new Function('return (' + src + ')')()(); qs2.forEach(([q, l]) => h.pick(q, l)); return h.out }, [qs, CONTRAST.toString()])
  const cs = [['#scp-title', 'title'], ['.scp-intro', 'intro'], ['.scp-sum', 'summary'], ['.scp-btn.scp-primary', 'primary button'], ['.scp-btn:not(.scp-primary)', 'button'], ['.scp-tab[aria-selected="true"]', 'tab'], ['.scp-tab[aria-selected="false"]', 'tab, not selected'], ['.scp-flab', 'field label'], ['.scp-cnt', 'counter'], ['.scp-swh', 'switch hint'], ['.scp-state', 'state'], ['.scp-sec', 'heading'], ['.scp-in', 'input text'], ['.scp-sub', 'sub text']]
  const r1 = await probe(cs)
  await pg.click(sel('tab-products')); const r2 = await probe([['.scp-badge', 'badge'], ['.scp-rname', 'row name'], ['.scp-chip', 'chip']])
  await pg.click(sel('pf-hidden')); const r2b = await probe([['.scp-chip[aria-pressed="true"]', 'pressed chip']]); await pg.click(sel('pf-all'))
  await pg.click(sel('tab-share')); const r3 = await probe([['a.scp-link', 'link'], ['.scp-k', 'link label'], ['.scp-hint', 'hint']])
  await pg.click(sel('tab-status')); await pg.click(sel('crawl-run')); await pg.waitForSelector(sel('crawl-en')); const r4 = await probe([['.scp-stat span', 'stat label'], ['.scp-res', 'crawler result']])
  const low = [...r1, ...r2, ...r2b, ...r3, ...r4].filter((x) => x[1] < 4.5)
  is(low.length === 0, `${dark ? 'dark' : 'light'} theme: every text is at least 4.5:1`, JSON.stringify(low))
  const bg = await pg.evaluate(() => getComputedStyle(document.querySelector('.scp-dlg')).backgroundColor)
  is(dark ? bg === 'rgb(21, 27, 33)' : bg === 'rgb(255, 255, 255)', `${dark ? 'dark' : 'light'} theme: the dialog takes its own ground`, bg)
}
{
  const W = makeWorld(), { pg } = await open(W); await openDlg(pg)
  const r = await pg.evaluate(() => {
    const host = document.querySelector('.admin-page'), b = document.createElement('button'); b.className = 'scp-btn'; b.textContent = 'x'; host.appendChild(b)
    const out = getComputedStyle(b).borderRadius; b.remove(); return out
  })
  is(r === '12px', 'inside the admin page a dialog button keeps the .75rem radius (the admin’s .7rem rule does not win)', r)
  const sh = await pg.evaluate(() => [...document.querySelectorAll('[data-scp-root] button, [data-scp-root] .scp-x')].filter((e) => e.getClientRects().length).map((e) => getComputedStyle(e).borderRadius))
  is(sh.length > 5 && sh.every((x) => x === '12px' || /^12px/.test(x) || x === '12px 12px 0px 0px'), 'every dialog button has the .75rem radius', JSON.stringify([...new Set(sh)]))
  is(await pg.evaluate(() => document.querySelectorAll('style[id^="scp"]').length) === 1, 'one style element')
  // focus trap
  await pg.focus(`${R} .scp-x`); await pg.keyboard.press('Shift+Tab')
  is(await pg.evaluate(() => !!document.activeElement.closest('[data-scp-root]')), 'Shift+Tab from the first control stays inside the dialog')
  for (let i = 0; i < 80; i++) { await pg.keyboard.press('Tab'); if (!(await pg.evaluate(() => !!document.activeElement.closest('[data-scp-root]')))) break }
  is(await pg.evaluate(() => !!document.activeElement.closest('[data-scp-root]')), '80 Tab presses never leave the dialog')
  await pg.keyboard.press('Escape')
  is(await pg.locator(R).count() === 0 && await pg.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-cpdf-open')), 'Escape closes it and focus returns to the entry button')
  is(W.posts.length === 0 && W.offHost.length === 0, 'this whole session wrote nothing and asked no other host')
}

// ============================================================================================================= 12. mutations
head('mutations')
const rep = (a, b) => { if (!BLOCK.includes(a)) throw new Error('mutation text not found: ' + a.slice(0, 60)); return BLOCK.replace(a, b) }
const MUT = [
  ['without the {settings} wrapper', rep("{ settings: payload() }", 'payload()'), async (pg, W) => { await pg.fill(sel('f-title_en'), 'M1'); await pg.click(sel('save')); await sleep(500); const p = W.posts[0]; return !!(p && p.body && p.body.settings && p.body.settings.title_en === 'M1') }],
  ['without the unsaved-changes guard', rep("    if (dirty()) { S.leave = true; updateBar(); try { R.keep.focus() } catch (e) { /* courtesy */ } return }\n", ''), async (pg) => { await pg.click(sel('sw-cover')); await pg.click(`${R} .scp-x`); return (await pg.locator(R).count()) === 1 }],
  ['without the counter limit', rep('inp.maxLength = max; ', ''), async (pg) => { await pg.fill(sel('f-title_en'), 'x'.repeat(100)); return (await val(pg, 'title_en')).length === 80 }],
  ['with the order direction reversed', rep('j = i + d\n', 'j = i - d\n'), async (pg) => { await pg.click(sel('down-men')); return eq(await cats(pg), ['women', 'men', 'outerwear', 'accessories']) }],
  ['without keeping the draft after a refusal', rep("S.note = refuse(res); S.kind = 'err'\n    }, function ()", "S.note = refuse(res); S.kind = 'err'; S.D = draftOf(S.admin.settings || {})\n    }, function ()"), async (pg, W) => { W.saveFault = { status: 400, token: 'invalid_title_en' }; await pg.fill(sel('f-title_en'), 'Keep me'); await pg.click(sel('save')); await dismissSave(pg, 'err'); return (await val(pg, 'title_en')) === 'Keep me' }],
  ['without the read after the save', rep("return req('catalogue_settings').then(function (r2) {", "return Promise.resolve({ ok: false }).then(function (r2) {"), async (pg, W) => { await pg.click(sel('sw-cover')); await pg.click(sel('save')); await dismissSave(pg, 'ok'); await sleep(200); return W.calls.filter((c) => /catalogue_settings$/.test(c.route) && c.method === 'GET').length === 2 }],
  ['with the prices option ignored', rep('prices: S.optPrices,', 'prices: true,'), async (pg) => { await pg.evaluate(() => { const E = window.SportaCatalogue, o = E.buildPdf; window.__bp = []; E.buildPdf = function (a) { window.__bp.push(a.prices); return o.apply(this, arguments) } }); await pg.click(sel('opt-prices')); const d = pg.waitForEvent('download'); await pg.click(sel('download')); await d; return (await pg.evaluate(() => window.__bp))[0] === false }],
  ['with the ItemList count broken', rep("out.count = (out.count || 0) + n.itemListElement.length", "out.count = 0"), async (pg) => { await pg.click(sel('tab-status')); await pg.click(sel('crawl-run')); await pg.waitForSelector(sel('crawl-en')); return /: 7 products in the page head/.test(await text(pg, sel('crawl-ar'))) }],
  ['with the QR drawing inverted', rep("if (row.charAt(x) === '1') g.fillRect", "if (row.charAt(x) === '0') g.fillRect"), async (pg) => { await pg.click(sel('tab-share')); await pg.click(sel('qr-pdfAr')); const d = await pg.evaluate(() => { const c = document.querySelector('[data-scp="qrbox-pdfAr"] canvas'), g = c.getContext('2d'); return g.getImageData((3 + 4) * 9 + 2, (3 + 4) * 9 + 2, 1, 1).data[0] }); return d < 40 }, { qr: true }],
  ['without the WhatsApp encoding', rep("'https://wa.me/?text=' + encodeURIComponent(t('waText') + ' ' + url)", "'https://wa.me/?text=' + (t('waText') + ' ' + url)"), async (pg) => { await pg.click(sel('tab-share')); return (await pg.getAttribute(sel('wa-pdfAr'), 'href')) === 'https://wa.me/?text=' + encodeURIComponent('Sporta catalogue ' + O + '?pdf=ar') }],
  ['without the radius rule', rep('.admin-shell .admin-page .scp-btn,.admin-shell .admin-page .scp-x{border-radius:.75rem}', ''), async (pg) => pg.evaluate(() => { const b = document.createElement('button'); b.className = 'scp-btn'; document.querySelector('.admin-page').appendChild(b); const r = getComputedStyle(b).borderRadius; b.remove(); return r === '12px' })],
  ['with the beforeunload warning removed', rep("if (root && dirty()) { e.preventDefault(); e.returnValue = '' }", ''), async (pg) => { await pg.click(sel('sw-cover')); return pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }) }],
  ['with the hide switch writing to the pin list', rep("if (!toggleList(S.D.hs, p.slug, v)) { inp.checked = false;", "if (!toggleList(S.D.pin, p.slug, v)) { inp.checked = false;"), async (pg, W) => { await pg.click(sel('tab-products')); await pg.click(sel('hide-men-zeta-top')); await pg.click(sel('save')); await sleep(500); return eq(W.settings.hidden_slugs, ['men-zeta-top']) }]
]
for (const [label, js, check, extra] of MUT) {
  const W = makeWorld()
  if (extra && extra.qr) W.engineJs = withQr(true)
  const t = await open(W, { js }); await openDlg(t.pg)
  let ok
  try { ok = await check(t.pg, W) } catch (e) { ok = false }
  is(ok === false, `mutation "${label}": its check goes red`)
  await t.ctx.close()
}
{
  // the 200-limit mutation needs its own check (the page loop above is the real proof; here the cut rule lets a 201st through)
  const many = baseProducts().concat(Array.from({ length: 230 }, (_, i) => P('lim-' + String(i).padStart(3, '0'), 'Lim ' + i, 'ح' + i, 'men', 5)))
  const run = async (js) => {
    const W = makeWorld(); W.products = many
    const t = await open(W, { js }); await openDlg(t.pg, 'products')
    const n = await t.pg.evaluate(async () => {
      for (let round = 0; round < 6; round++) {
        for (;;) { const b = [...document.querySelectorAll('[data-scp^="hide-"]')].find((x) => !x.checked && !x.dataset.t); if (!b) break; b.dataset.t = '1'; b.click() }
        const m = document.querySelector('[data-scp="p-more"]'); if (m) m.click()
      }
      return [...document.querySelectorAll('[data-scp^="hide-"]')].filter((b) => b.checked).length
    })
    const s = await text(t.pg, sel('p-summary')); await t.ctx.close(); return [n, s]
  }
  const real = await run(BLOCK), cut = await run(rep('if (count(map) >= MAX_LIST) {', 'if (false) {'))
  is(/Hidden by you: 200\b/.test(real[1]), 'the real block stops at 200 hidden products', real[1])
  is(!/Hidden by you: 200\b/.test(cut[1]) && /Hidden by you: (2[1-9]\d|[3-9]\d\d)/.test(cut[1]), 'with the limit cut the 201st goes through (so the limit check above is not vacuous)', cut[1])
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
