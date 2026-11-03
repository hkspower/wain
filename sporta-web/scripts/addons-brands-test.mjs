// The brand add-ons, in a real browser, against the LIVE markup.
//
// WHY THIS EXISTS. The live storefront and admin are a compiled build whose
// source is not in this repo, so brand work reaches them only through the
// add-on files the live index.html already loads:
//   public/sporta-features.js     /shop?brand=<slug> banner, product plate link,
//                                 home strip fit guard
//   public/sporta-images.css      home strip text tiles as wordmarks (English)
//   public/sporta-admin-brands.js /backends Brands: Remove (slug fix), counts,
//                                 "Tag products with a brand" panel
//   public/sporta-admin-knet.css  focus/hover for that panel
// None of that can be checked by building the repo's own app. So each page is
// a small fixture that reproduces the live markup measured on
// www.sporta.com.kw (the class names, the "/brand/<slug>" monospace line, the
// plate's <img alt>), served from a fake origin under the live CSP
// (script-src 'self', so an inline script or an eval in an add-on fails here
// the way it would fail live), with /api/api.php and /api/admin.php mocked to
// the contract the backend implements. A tiny "React" (fixture.js) renders the
// page after the add-ons start and can re-render it wholesale, which is what
// the compiled app does to nodes it owns.
//
//   npm run test:addons-brands      (no database, no PHP: everything is mocked)
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PUB = new URL('../public/', import.meta.url)
const FILES = {
  '/sporta-features.js': ['text/javascript', readFileSync(new URL('sporta-features.js', PUB))],
  '/sporta-images.css': ['text/css', readFileSync(new URL('sporta-images.css', PUB))],
  '/sporta-admin-brands.js': ['text/javascript', readFileSync(new URL('sporta-admin-brands.js', PUB))],
  '/sporta-admin-knet.css': ['text/css', readFileSync(new URL('sporta-admin-knet.css', PUB))],
}
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
// A real PNG (1x1): the banner's <img> must actually load.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const DATA_URI = `data:image/png;base64,${PNG.toString('base64')}`

let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// SHOTS=/some/dir saves a screenshot of each surface, for a human to look at.
const shot = async (pg, name, sel) => {
  if (!process.env.SHOTS) return
  const path = `${process.env.SHOTS}/${name}.png`
  if (sel) await pg.locator(sel).first().screenshot({ path }); else await pg.screenshot({ path, fullPage: true })
}

// ------------------------------------------------------------------ the data
// The 46 live product slugs. Only vanquish-tank-navy carries a brand, as live.
const SLUGS = `cagliari-calcio-backpack cagliari-calcio-backpack-navy cagliari-calcio-sweatshirt-navy cheetahs-rugby-t-shirt
cloudsoft-jacket-army-green cloudsoft-jacket-cherry-red cloudsoft-jacket-coffee-brown cloudsoft-leggings-army-green
cloudsoft-leggings-cherry-red cloudsoft-leggings-coffee-brown cloudsoft-leggings-grey cloudsoft-leggings-navy
cloudsoft-leggings-onyx-black cloudsoft-top-grey cloudsoft-top-navy cloudsoft-top-onyx-black define-jacket-iris-purple
define-jacket-onyx-black define-jacket-steel-grey denver-nuggets-cap-navy energy-t-shirt-red-white flash-shorts-green
flash-shorts-red gymshark-phone-strap naples-leggings-black naples-sports-bra-pink sculpt-jacket-black sculpt-jacket-grey
sculpt-jacket-navy sculpt-jacket-taupe-brown sculpt-leggings-black sculpt-leggings-grey sculpt-leggings-navy
sculpt-leggings-taupe-brown sculpt-top-black sculpt-top-grey sculpt-top-navy sculpt-top-taupe-brown sgomma-t-shirt-navy
street-pants-navy tekno-shorts-black tekno-shorts-royal vanquish-stringer-vest-white vanquish-t-shirt-navy-blue
vanquish-t-shirt-white vanquish-tank-navy`.split(/\s+/)
// Names: the house mark "Sporta" leads 41 of the 46 (89%), so a naive
// "name contains a brand" rule would tag the whole catalogue as Sporta.
const title = (s) => s.replace(/t-shirt/g, 'tshirt').split('-').map((w) => w === 'tshirt' ? 'T-Shirt' : w[0].toUpperCase() + w.slice(1)).join(' ')
const nameFor = (slug) => (/^(vanquish|gymshark)-/.test(slug) ? '' : 'Sporta ') + title(slug)

const BRANDS = [
  // slug, name_en, name_ar, has logo, active
  ['sporta', 'Sporta', 'سبورتا', false, 1],
  ['ahed', 'AHED', 'AHED', true, 1],
  ['rheo', 'RHEO', 'ريو', false, 1],
  ['vanquish', 'Vanquish', 'فانكويش', true, 1],
  ['gymshark', 'Gymshark', 'جيم شارك', false, 1],
  ['eyesportwear', 'Eyesportwear', 'آي سبورت وير', false, 1],
  ['nba', 'NBA', 'إن بي إيه', false, 1],
  // Hidden, so absent from the public list — and "tek" is a SUBSTRING of
  // "tekno-shorts", never a word in it: a suggestion for it is a bug.
  ['tek', 'Tek', 'تك', false, 0],
]

let state
function reset() {
  state = {
    brands: BRANDS.map(([slug, en, ar, logo, active], i) => ({
      id: i + 1, slug, name_en: en, name_ar: ar, logo: logo ? DATA_URI : null, active, sort: i,
    })),
    products: SLUGS.map((slug) => ({
      slug, name_en: nameFor(slug), name_ar: 'منتج ' + slug, brand_slug: slug === 'vanquish-tank-navy' ? 'vanquish' : null,
      // One hidden product, so "products" and "products_active" can differ.
      active: slug === 'cagliari-calcio-backpack' ? 0 : 1,
      category: /leggings|bra|top/.test(slug) ? 'women' : 'men',
    })),
    publicCounts: {},          // slug -> forced `products` in the public list
    publicAsStrings: false,    // PDO may hand numbers back as strings
    hits: {},                  // "api:brands" -> request count
    posts: [],                 // every admin POST: {r, csrf, ctype, body}
    assignDelay: 0,
    failNext: null,            // {status, body} for the next brand_assign
  }
}
const unmatched = []         // requests no route answered, across every scenario
reset()
const activeCount = (slug) => state.products.filter((p) => p.brand_slug === slug && p.active === 1).length
function publicBrands() {
  return state.brands.filter((b) => b.active === 1).map((b) => {
    const n = b.slug in state.publicCounts ? state.publicCounts[b.slug] : activeCount(b.slug)
    return {
      slug: b.slug, name_en: b.name_en, name_ar: b.name_ar,
      has_logo: state.publicAsStrings ? String(b.logo ? 1 : 0) : (b.logo ? 1 : 0),
      logo_v: b.logo ? 'bbbbbbbbbbbb' : 'e3b0c44298fc',
      products: state.publicAsStrings ? String(n) : n,
    }
  })
}
function adminBrands() {
  return state.brands.map((b) => ({
    ...b,
    products: state.products.filter((p) => p.brand_slug === b.slug).length,
    products_active: activeCount(b.slug),
  }))
}
function adminProducts() {
  return state.products
    .map(({ slug, name_en, name_ar, brand_slug, active, category }) => ({ slug, name_en, name_ar, brand_slug, active, category }))
    .sort((a, b) => a.name_en.localeCompare(b.name_en) || a.slug.localeCompare(b.slug))
}

// ------------------------------------------------------- the fake compiled app
const FIXTURE_CSS = `
body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#0f172a}
.brand-bar{background:rgb(23,26,30);padding:16px}
.campaign-brand-bar__heading{display:flex;justify-content:space-between;color:#fff}
.brand-bar__track{display:flex;gap:12px;list-style:none;margin:0;padding:0;overflow-x:auto}
.brand-bar__item{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:132px;height:68px;padding:0 12px;
  border:1px solid rgba(255,255,255,.18);border-radius:14px;color:#fff;font-size:15px;font-weight:800;letter-spacing:normal;
  text-transform:none;text-decoration:none;overflow:hidden;flex:none}
.brand-bar__logo{max-width:100%;max-height:100%;object-fit:contain;filter:grayscale(1) brightness(0) invert(1)}
.catalog{padding:16px}
.catalog-filters{display:flex;flex-wrap:wrap;gap:8px}
.catalog-filter{min-height:44px;padding:0 16px;border:1px solid #cbd5e1;border-radius:999px;background:#fff}
.catalog-toolbar{display:flex;justify-content:space-between;align-items:center}
.campaign-brand-plate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.campaign-brand-plate__maker{display:inline-flex;align-items:center}
.campaign-brand-plate__maker-logo{width:112px;height:28px}
.h-7{height:1.75rem}.w-auto{width:auto}
`
// Stands in for the compiled React app: renders after the add-ons start, sets
// the title like an effect on [pathname], re-renders wholesale on demand.
const FIXTURE_JS = `
(function () {
  var q = new URLSearchParams(location.search)
  var L = q.get('lang') === 'en' ? 'en' : 'ar'
  document.documentElement.lang = L
  document.documentElement.dir = L === 'en' ? 'ltr' : 'rtl'
  window.fxSubmits = 0
  var lastPath = null
  var BRANDS = ${JSON.stringify(BRANDS.filter((b) => b[4] === 1).map((b) => b.slice(0, 4)))}
  var CATALOGUE = [['vanquish-tank-navy', 'Vanquish Tank Navy', 'vanquish']]
  var LOGO = ${JSON.stringify(DATA_URI)}
  function en() { return document.documentElement.lang === 'en' }
  function fx(name) { return new URLSearchParams(location.search).get('fx') === name }
  function home() {
    var tiles = BRANDS.map(function (b) {
      return b[3]
        ? '<li><a class="brand-bar__item" aria-label="' + b[1] + '" href="/shop?brand=' + b[0] + '"><img class="brand-bar__logo" alt="" width="144" height="64" loading="lazy" decoding="async" src="/api/api.php?r=brand_logo&slug=' + b[0] + '&v=x"></a></li>'
        : '<li><a class="brand-bar__item" aria-label="' + b[1] + '" href="/shop?brand=' + b[0] + '" data-discover="true"><span dir="auto">' + (en() ? b[1] : b[2]) + '</span></a></li>'
    })
    if (fx('arabictile')) tiles.push('<li><a class="brand-bar__item" aria-label="x" href="/shop?brand=sporta"><span dir="auto">سبورتا</span></a></li>')
    return '<section class="brand-bar campaign-brand-bar campaign-brand-bar--sticky" aria-labelledby="brand-bar-title"><div class="campaign-brand-bar__heading">' +
      '<h2 id="brand-bar-title">' + (en() ? 'Brands we trust' : 'ماركات نثق بها') + '</h2><a class="brand-bar__cta" href="/shop">' + (en() ? 'Explore brands' : 'استكشف الماركات') + '</a></div>' +
      '<ul class="brand-bar__track">' + tiles.join('') + '</ul></section>'
  }
  function shop() {
    var brand = new URLSearchParams(location.search).get('brand')
    var items = CATALOGUE.filter(function (c) { return !brand || c[2] === brand })
    var grid = items.length
      ? items.map(function (c) { return '<a href="/product/' + c[0] + '">' + c[1] + '</a>' }).join('')
      : '<div class="catalog-empty"><p>' + (en() ? 'No matching products' : 'لم نجد منتجات مطابقة') + '</p></div>'
    return '<div class="catalog"><div class="catalog-heading"><p class="eyebrow">' + (en() ? 'SPORTA / THE COLLECTION' : 'سبورتا / المجموعة') + '</p>' +
      '<div class="catalog-heading-copy"><h1 class="text-3xl font-extrabold text-slate-900">' + (en() ? 'Shop sportswear in Kuwait' : 'تسوّق الملابس الرياضية في الكويت') + '</h1><p class="max-w-2xl text-slate-600">…</p></div></div>' +
      '<div class="catalog-toolbar"><p>' + items.length + ' products</p><select aria-label="Sort"><option>Featured</option></select></div>' +
      (fx('nofilters') ? '' : '<div class="catalog-filters"><button class="catalog-filter flex min-h-11">All</button><button class="catalog-filter flex min-h-11">Women</button><button class="catalog-filter flex min-h-11">Men</button></div>') +
      '<div class="catalog-grid">' + grid + '</div></div>'
  }
  function product() {
    var slug = location.pathname.split('/')[2]
    var maker = slug === 'vanquish-tank-navy'
      ? '<span class="campaign-brand-plate__maker"><img alt="Vanquish" width="112" height="28" loading="lazy" decoding="async" class="campaign-brand-plate__maker-logo object-contain" src="/api/api.php?r=brand_logo&slug=vanquish&v=bbbbbbbbbbbb"></span>'
      : slug === 'ahed-hoodie'
        ? '<span class="campaign-brand-plate__maker"><img alt=" ahed " width="112" height="28" class="campaign-brand-plate__maker-logo object-contain" src="' + LOGO + '"></span>'
        : '<span class="campaign-brand-plate__maker text-sm font-bold">' + (en() ? 'Gymshark' : 'جيم شارك') + '</span>'
    return '<div class="product"><h1>' + slug + '</h1><div class="campaign-brand-plate mt-4"><div class="campaign-brand-plate__owner"><img alt="Sporta Sports Wear" width="132" height="41" class="h-7 w-auto" src="/logo.png"></div>' +
      maker + '<span class="campaign-brand-plate__authentic text-xs font-semibold text-slate-600">' + (en() ? 'Authentic · sold by Sporta' : 'أصلي · تبيعه سبورتا') + '</span></div></div>'
  }
  function card(b) {
    var mark = b[3]
      ? '<img alt="" class="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1" src="' + LOGO + '">'
      : '<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-500">' + b[1].slice(0, 2).toUpperCase() + '</div>'
    return '<li class="admin-brand-card flex items-center gap-3 rounded-2xl border p-3 border-slate-200 bg-white">' + mark +
      '<div class="min-w-0 flex-1"><p class="truncate font-bold text-slate-800">' + b[1] + '</p><p class="truncate text-sm text-slate-500" dir="rtl">' + b[2] + '</p>' +
      '<p class="truncate font-mono text-[0.7rem] text-slate-400">/brand/' + b[0] + '</p></div>' +
      '<div class="flex flex-col items-end gap-2"><label class="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><input class="h-4 w-4 accent-indigo-600" type="checkbox" checked>Shown</label>' +
      '<button type="button" class="text-xs font-bold text-indigo-600 hover:underline">Edit</button></div></li>'
  }
  function admin() {
    // Wrapped in a form whose default button is "Add a brand" (no type =
    // submit): Enter in a text field inside it would submit — unless stopped.
    return '<div class="admin-shell"><main class="admin-content"><form id="fxform"><section>' +
      '<div class="flex items-center justify-between"><div><h2 class="text-xl font-bold">Brands</h2><p class="text-sm text-slate-500">' + BRANDS.length + ' shown · 0 hidden</p></div>' +
      '<button class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Add a brand</button></div>' +
      '<input id="fxprobe" type="text" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">' +
      '<ul class="mt-4 grid gap-3">' + BRANDS.map(card).join('') + '</ul></section></form></main></div>'
  }
  // The signed-out /backends, as the compiled login renders it (class names
  // from the live DOM, 2026-11-02). Only the session line matters here.
  function login() {
    return '<div class="admin-login text-left text-slate-950"><main class="admin-login__shell admin-login__shell--split">' +
      '<section class="admin-login__form-panel"><form class="mx-auto w-full max-w-sm space-y-5">' +
      '<button class="flex w-full items-center justify-center rounded-xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white" disabled>Sign in securely</button>' +
      '<p class="text-center text-xs leading-5 text-slate-600">Sessions expire after 8 hours idle.</p>' +
      '<p class="fx-other text-xs">Sessions expire after 8 hours idle. Ask the owner.</p>' +
      '</form></section></main></div>'
  }
  function titleFor(p) {
    if (p === '/shop') return en() ? 'Shop — Sporta' : 'المتجر — سبورتا'
    if (p.indexOf('/product/') === 0) return 'Product — Sporta'
    if (p === '/backends') return 'Admin — Sporta'
    return 'Sporta'
  }
  function render() {
    var p = location.pathname
    var html = p === '/' ? home() : p === '/shop' ? shop() : p.indexOf('/product/') === 0 ? product() : p === '/backends' ? (fx('login') ? login() : admin()) :
      p === '/backends/catalogue' ? '<div class="admin-shell"><main class="admin-content"><h2>Catalogue</h2></main></div>' : '<p>404</p>'
    document.getElementById('root').innerHTML = html
    var sl = document.querySelector('.admin-login p.text-center')
    window.fxLoginNode = sl ? sl.firstChild : null
    if (p !== lastPath) { lastPath = p; document.title = titleFor(p) }
    window.fxRenders = (window.fxRenders || 0) + 1
  }
  window.fxRerender = render
  window.fxNavigate = function (u) { history.pushState({}, '', u); render() }
  window.fxLang = function (l) { document.documentElement.lang = l; document.documentElement.dir = l === 'en' ? 'ltr' : 'rtl'; lastPath = null; render() }
  window.fxSetTitle = function (t) { document.title = t }
  window.fxAddBrand = function (b) { BRANDS.push(b); render() }
  window.addEventListener('popstate', render)
  document.addEventListener('submit', function (e) { e.preventDefault(); window.fxSubmits++ }, true)
  setTimeout(render, 30)
})()
`
const page = () => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta</title>
<link rel="stylesheet" href="/fixture.css"><link rel="stylesheet" href="/sporta-images.css"><link rel="stylesheet" href="/sporta-admin-knet.css">
<script src="/fixture.js" defer></script>
<script src="/sporta-features.js" defer></script>
<script src="/sporta-admin-brands.js" defer></script>
</head><body><div id="root"></div></body></html>`

// ------------------------------------------------------------------- routing
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) })
async function handle(route) {
  const req = route.request()
  const url = new URL(req.url())
  const p = url.pathname
  if (p === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS })
  if (p === '/fixture.css') return route.fulfill({ status: 200, contentType: 'text/css', body: FIXTURE_CSS })
  if (FILES[p]) return route.fulfill({ status: 200, contentType: FILES[p][0], body: FILES[p][1] })
  if (p === '/logo.png') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  if (p === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
  // sporta-features.js asks for the small-copies list (2026-11-03, scripts/make-image-variants.mjs) on every storefront page; here, as on a
  // server where nobody has run the maker yet, there is none, and the block must then do nothing at all (npm run test:sizes-weight proves that).
  if (p === '/images/products/responsive/variants.txt') return route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8', body: 'no' })
  if (p === '/api/api.php') {
    const r = url.searchParams.get('r')
    state.hits[`api:${r}`] = (state.hits[`api:${r}`] || 0) + 1
    if (r === 'brands') return json(route, 200, publicBrands())
    if (r === 'brand_logo') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (r === 'stock') return json(route, 200, [])
    unmatched.push(req.url())
    return json(route, 404, { error: 'not_found' })
  }
  if (p === '/api/admin.php') return handleAdmin(route, req, url)
  if (p === '/' || p === '/shop' || p.startsWith('/product/') || p === '/backends') {
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: page() })
  }
  unmatched.push(req.url())
  return route.fulfill({ status: 404, body: '' })
}
async function handleAdmin(route, req, url) {
  const r = url.searchParams.get('r')
  const method = req.method()
  const h = req.headers()
  let body = null
  if (method === 'POST') {
    try { body = JSON.parse(req.postData() || 'null') } catch { body = null }
    state.posts.push({ r, csrf: h['x-sporta-admin'], ctype: h['content-type'], body })
  }
  if (h['x-sporta-admin'] !== '1') return json(route, 400, { error: 'bad_request' })
  state.hits[`admin:${r}`] = (state.hits[`admin:${r}`] || 0) + 1
  if (method === 'GET' && r === 'brands') return json(route, 200, adminBrands())
  if (method === 'GET' && r === 'brand_products') return json(route, 200, adminProducts())
  if (method !== 'POST') { unmatched.push(`GET ${req.url()}`); return json(route, 404, { error: 'not_found' }) }
  if (r === 'brand_assign') {
    if (state.assignDelay) await sleep(state.assignDelay)
    if (state.failNext) { const f = state.failNext; state.failNext = null; return json(route, f.status, f.body) }
    // The contract, as admin.php implements it.
    if (!body || !('brand_slug' in body)) return json(route, 400, { error: 'bad_request' })
    const want = body.brand_slug
    if (want !== null && typeof want !== 'string') return json(route, 400, { error: 'bad_request' })
    if (want && !state.brands.some((b) => b.slug === want)) return json(route, 400, { error: 'unknown_brand' })
    const list = body.products
    if (!Array.isArray(list) || list.length < 1 || list.length > 200 || list.some((s) => typeof s !== 'string')) {
      return json(route, 400, { error: 'bad_request' })
    }
    let updated = 0, skipped = 0
    for (const s of new Set(list)) {
      const p = state.products.find((x) => x.slug === s)
      if (!p) { skipped++; continue }
      if (p.brand_slug !== (want || null)) { p.brand_slug = want || null; updated++ }
    }
    return json(route, 200, { updated, skipped })
  }
  if (r === 'brand_delete') {
    const b = state.brands.find((x) => x.id === Number(body && body.id))
    if (!b) return json(route, 404, { error: 'brand_not_found' })
    if (state.products.some((p) => p.brand_slug === b.slug)) return json(route, 409, { error: 'brand_in_use' })
    state.brands = state.brands.filter((x) => x !== b)
    return json(route, 200, { id: b.id, deleted: true })
  }
  unmatched.push(`POST ${req.url()}`)
  return json(route, 404, { error: 'not_found' })
}

// ------------------------------------------------------------------- helpers
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
await context.route(`${ORIGIN}/**`, handle)
const errors = []
async function open(path, { width = 390 } = {}) {
  const pg = await context.newPage()
  await pg.setViewportSize({ width, height: 900 })
  pg.on('pageerror', (e) => errors.push(`${path}: ${e.message}`))
  // "Failed to load resource" is the browser logging a non-2xx answer — the
  // admin scenarios provoke 400/401/500 on purpose. A request nothing mocked
  // is caught by `unmatched` instead; CSP refusals and script errors stay here.
  pg.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(`${path}: console: ${m.text()}`) })
  await pg.goto(ORIGIN + path)
  await pg.waitForFunction(() => (window.fxRenders || 0) > 0)
  await frames(pg)
  return pg
}
const frames = (pg) => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
const settle = async (pg) => { await frames(pg); await sleep(60); await frames(pg) }
const waitBanner = (pg) => pg.waitForFunction(() => {
  const b = document.getElementById('sporta-brand-banner'), img = b && b.querySelector('img')
  return !!b && (!img || img.complete)
}, null, { timeout: 5000 })
// For "nothing appears" checks: wait until the brand list has actually arrived
// and been acted on, so an absent banner means "decided against", not "not yet".
const afterBrands = async (pg) => {
  for (let i = 0; i < 200 && !state.hits['api:brands']; i++) await sleep(10)
  await settle(pg)
}
const banner = (pg) => pg.evaluate(() => {
  const all = document.querySelectorAll('#sporta-brand-banner')
  const b = all[0]
  if (!b) return { n: 0 }
  const a = b.querySelector('[data-sporta-brand-clear]')
  const img = b.querySelector('img')
  const filters = document.querySelector('.catalog-filters')
  return {
    n: all.length,
    beforeFilters: !!filters && b.nextElementSibling === filters,
    afterHeading: b.previousElementSibling === document.querySelector('.catalog-heading-copy'),
    dir: b.getAttribute('dir'),
    lang: b.getAttribute('lang'),
    name: b.querySelector('h2').textContent,
    count: (b.querySelector('[data-sporta-brand-count]') || {}).textContent || null,
    link: a.textContent, href: a.getAttribute('href'), linkH: a.getBoundingClientRect().height,
    img: img ? img.getAttribute('src') : null, imgLoaded: img ? img.complete && img.naturalWidth > 0 : null,
    wordmark: img ? null : b.querySelector('[aria-hidden] span').textContent,
    wordmarkCase: img ? null : getComputedStyle(b.querySelector('[aria-hidden] span')).textTransform,
    right: b.getBoundingClientRect().right, vw: document.documentElement.clientWidth,
    scrollW: document.documentElement.scrollWidth,
    title: document.title,
  }
})

// ==================================================== 1. the count, unit test
head('count wording (unit)')
{
  const pg = await open('/shop?lang=en')
  const got = await pg.evaluate(() => {
    const f = window.SportaAddons && window.SportaAddons.brandCount
    if (!f) return null
    const ns = [0, 1, 2, 3, 10, 11, 12, 99, 100, 101, 102, 103, 110, 111, 200]
    return { en: ns.map((n) => f(n, 'en')), ar: ns.map((n) => f(n, 'ar')) }
  })
  is(!!got, 'the count function is exposed as SportaAddons.brandCount')
  if (got) {
    const AR = ['لا توجد منتجات', 'منتج واحد', 'منتجان', '٣ منتجات', '١٠ منتجات', '١١ منتجًا', '١٢ منتجًا', '٩٩ منتجًا',
      '١٠٠ منتج', '١٠١ منتج', '١٠٢ منتج', '١٠٣ منتجات', '١١٠ منتجات', '١١١ منتجًا', '٢٠٠ منتج']
    const EN = ['No products', '1 product', '2 products', '3 products', '10 products', '11 products', '12 products', '99 products',
      '100 products', '101 products', '102 products', '103 products', '110 products', '111 products', '200 products']
    is(JSON.stringify(got.en) === JSON.stringify(EN), 'English: "1 product", otherwise "{n} products", zero is "No products"', got.en.slice(0, 4).join(' / '))
    const wrong = AR.map((w, i) => (got.ar[i] === w ? null : `${got.ar[i]} ≠ ${w}`)).filter(Boolean)
    is(wrong.length === 0, 'Arabic: 0 لا توجد · 1 واحد · 2 dual · 3–10 plural · 11–99 منتجًا · restarting each hundred', wrong.join(', ') || got.ar.slice(0, 7).join(' / '))
    is(got.ar.every((s) => !/[0-9]/.test(s)), 'Arabic counts use Arabic-Indic digits only')
    is(got.ar.filter((s) => s.includes('منتج')).every((s) => !s.includes('اً')), 'tanwin is written ـًا, never ـاً')
  }
  await pg.close()
}

// ====================================================== 2. the /shop banner
head('/shop?brand=vanquish in English')
{
  reset()
  const pg = await open('/shop?brand=vanquish&lang=en')
  await waitBanner(pg)
  let b = await banner(pg)
  is(b.n === 1, 'one banner', `${b.n}`)
  is(b.beforeFilters, 'it sits immediately before .catalog-filters')
  is(b.dir === 'ltr' && b.lang === 'en', 'English, left-to-right', `${b.dir} ${b.lang}`)
  is(b.name === 'Vanquish', 'names the brand', b.name)
  is(b.count === '1 product', 'singular count from the public list', b.count)
  is(b.link === 'All brands' && b.href === '/shop?lang=en', '"All brands" clears the brand and keeps ?lang=en', `${b.link} → ${b.href}`)
  is(b.linkH >= 44, 'the link is a 44px tap target', `${b.linkH}px`)
  is(b.img === '/api/api.php?r=brand_logo&slug=vanquish&v=bbbbbbbbbbbb' && b.imgLoaded, 'shows the logo, by slug and content hash', b.img)
  is(b.title === 'Vanquish — Sporta', 'document.title names the brand', b.title)
  is(b.right <= b.vw && b.scrollW <= b.vw, 'no horizontal overflow at 390px', `${b.right} / ${b.scrollW} / ${b.vw}`)
  await shot(pg, 'shop-en-phone')

  for (let i = 0; i < 3; i++) { await pg.evaluate(() => window.fxRerender()); await settle(pg) }
  b = await banner(pg)
  is(b.n === 1 && b.beforeFilters, 'after three wholesale re-renders: still exactly one, still in place', `${b.n}`)
  await pg.evaluate(() => window.fxSetTitle('Shop — Sporta'))
  await settle(pg)
  is((await pg.title()) === 'Vanquish — Sporta', 'the compiled app rewriting its title is undone')
  is(state.hits['api:brands'] === 1, 'r=brands was fetched once for the whole page life', `${state.hits['api:brands']}`)

  await pg.evaluate(() => window.fxNavigate('/shop?lang=en'))
  await settle(pg)
  b = await banner(pg)
  is(b.n === 0, 'SPA navigation to /shop without ?brand removes it')
  is((await pg.title()) === 'Shop — Sporta', 'and gives the compiled title back', await pg.title())
  await pg.evaluate(() => history.back())
  await settle(pg)
  b = await banner(pg)
  is(b.n === 1 && b.title === 'Vanquish — Sporta', 'Back (popstate) brings it back', `${b.n} ${b.title}`)
  await pg.close()
}

head('/shop?brand=gymshark in Arabic, nothing tagged')
{
  reset()
  const pg = await open('/shop?brand=gymshark')
  await waitBanner(pg)
  let b = await banner(pg)
  is(b.n === 1 && b.dir === 'rtl' && b.lang === 'ar', 'Arabic by default, right-to-left', `${b.dir}`)
  is(b.name === 'جيم شارك', 'the Arabic name', b.name)
  is(b.count === 'لم نُضف قطع جيم شارك إلى هذه الصفحة بعد.', 'says the PAGE has none yet — not that the shop has none', b.count)
  is(b.link === 'تصفّح كل المنتجات' && b.href === '/shop', 'and offers the full collection', `${b.link} → ${b.href}`)
  is(b.title === 'جيم شارك — سبورتا', 'Arabic title', b.title)
  await shot(pg, 'shop-ar-empty', '#sporta-brand-banner')
  await pg.setViewportSize({ width: 1280, height: 900 })
  await shot(pg, 'shop-ar-desktop', '#sporta-brand-banner')
  is(b.wordmark === 'Gymshark' && b.wordmarkCase === 'uppercase', 'no logo: the Latin name as an uppercase wordmark', `${b.wordmark} ${b.wordmarkCase}`)
  await pg.evaluate(() => window.fxLang('en'))
  await settle(pg)
  b = await banner(pg)
  is(b.n === 1 && b.dir === 'ltr' && b.count === 'We haven’t added Gymshark pieces to this page yet.' && b.link === 'Browse the full collection',
    'the language toggle rebuilds it in English', `${b.count} / ${b.link}`)
  is(b.title === 'Gymshark — Sporta', 'and retitles it', b.title)
  await pg.close()
}

head('banner count wording, both languages')
{
  const EXPECT = {
    en: { 1: '1 product', 2: '2 products', 3: '3 products', 11: '11 products', 12: '12 products', 101: '101 products' },
    ar: { 1: 'منتج واحد', 2: 'منتجان', 3: '٣ منتجات', 11: '١١ منتجًا', 12: '١٢ منتجًا', 101: '١٠١ منتج' },
  }
  for (const L of ['en', 'ar']) {
    const seen = []
    let good = true
    for (const n of [1, 2, 3, 11, 12, 101]) {
      reset()
      state.publicCounts.vanquish = n
      state.publicAsStrings = n === 12          // "12" as a string must read the same
      const pg = await open(`/shop?brand=vanquish${L === 'en' ? '&lang=en' : ''}`)
      await waitBanner(pg)
      const b = await banner(pg)
      seen.push(b.count)
      if (b.count !== EXPECT[L][n] || b.link !== (L === 'en' ? 'All brands' : 'كل الماركات')) good = false
      await pg.close()
    }
    is(good, `${L}: 1 / 2 / 3 / 11 / 12 / 101`, seen.join(' · '))
  }
}

head('nothing where nothing belongs')
{
  reset()
  let pg = await open('/shop?brand=nope&lang=en')
  await afterBrands(pg)
  is((await banner(pg)).n === 0 && (await pg.title()) === 'Shop — Sporta', 'an unknown slug: no banner, title untouched')
  await pg.close()
  reset()
  pg = await open('/shop?brand=tek&lang=en')
  await afterBrands(pg)
  is((await banner(pg)).n === 0 && state.hits['api:brands'] === 1,
    'a hidden brand (the server leaves it out of the public list): no banner, same as an unknown slug')
  await pg.close()
  reset()
  pg = await open('/shop?lang=en')
  await settle(pg)
  is((await banner(pg)).n === 0 && !state.hits['api:brands'], 'no ?brand: no banner, and r=brands is not even asked')
  await pg.close()
  reset()
  pg = await open('/?lang=en&brand=vanquish')
  await settle(pg)
  is((await banner(pg)).n === 0, '?brand on another page: nothing')
  await pg.close()
  reset()
  pg = await open('/shop?brand=vanquish&lang=en&fx=nofilters')
  await waitBanner(pg)
  const b = await banner(pg)
  is(b.n === 1 && b.afterHeading, 'no .catalog-filters on the page: right after .catalog-heading-copy')
  await pg.close()
}

// ================================================== 3. the product plate link
head('product plate links to the brand page')
{
  reset()
  const waitLink = (p) => p.waitForFunction(() => !!document.querySelector('[data-sporta-plate-link]'), null, { timeout: 5000 })
  let pg = await open('/product/vanquish-tank-navy')
  await waitLink(pg)
  const plate = (p) => p.evaluate(() => {
    const m = document.querySelector('.campaign-brand-plate__maker')
    const as = m.querySelectorAll('[data-sporta-plate-link]')
    const a = as[0]
    const rects = () => [...document.querySelector('.campaign-brand-plate').children].map((c) => {
      const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(',')
    }).join(' ')
    const withLink = rects()
    if (a) a.style.display = 'none'
    const without = rects()
    if (a) a.style.display = ''
    return {
      n: as.length, href: a && a.getAttribute('href'), label: a && a.getAttribute('aria-label'),
      h: a ? a.getBoundingClientRect().height : 0, same: withLink === without,
      hit: a ? document.elementFromPoint(m.getBoundingClientRect().x + 20, m.getBoundingClientRect().y + 10) === a : false,
    }
  })
  let r = await plate(pg)
  is(r.n === 1 && r.href === '/shop?brand=vanquish', 'the maker logo links to /shop?brand=vanquish', r.href)
  is(r.label === 'تسوّق فانكويش', 'labelled in Arabic', r.label)
  is(r.same, 'the plate\'s row is laid out exactly as before')
  is(r.hit && r.h >= 44, 'the mark itself is the click target, 44px tall', `${r.h}px`)
  await pg.evaluate(() => window.fxRerender())
  await settle(pg)
  r = await plate(pg)
  is(r.n === 1, 'one link after a re-render')
  await pg.close()

  pg = await open('/product/vanquish-tank-navy?lang=en')
  await waitLink(pg)
  r = await plate(pg)
  is(r.href === '/shop?brand=vanquish&lang=en' && r.label === 'Shop Vanquish', 'English: keeps ?lang=en, "Shop Vanquish"', `${r.href} ${r.label}`)
  await Promise.all([pg.waitForURL(/\/shop\?brand=vanquish/), pg.click('[data-sporta-plate-link]')])
  await pg.waitForFunction(() => !!document.getElementById('sporta-brand-banner'))
  is(true, 'clicking it lands on the brand page, banner and all')
  await pg.close()

  reset()
  pg = await open('/product/gymshark-phone-strap')
  await afterBrands(pg)
  r = await plate(pg)
  is(r.n === 0, 'a brand with no listed products gets no link (text maker, matched by name)')
  await pg.close()
  reset()
  state.publicCounts.gymshark = 2
  pg = await open('/product/gymshark-phone-strap')
  await waitLink(pg)
  r = await plate(pg)
  is(r.n === 1 && r.href === '/shop?brand=gymshark' && r.label === 'تسوّق جيم شارك', 'a text maker matched by its Arabic name', `${r.href} ${r.label}`)
  // React updating the maker IN PLACE (its text set with textContent, which
  // takes the overlay with it) rather than re-rendering the whole page.
  await pg.evaluate(() => { document.querySelector('.campaign-brand-plate__maker').textContent = 'Gymshark' })
  await settle(pg)
  r = await plate(pg)
  is(r.n === 1 && r.href === '/shop?brand=gymshark', 'the maker\'s text rewritten in place: exactly one link comes back', `${r.n} ${r.href}`)
  await pg.close()

  reset()
  state.publicCounts.ahed = 2
  pg = await open('/product/vanquish-tank-navy?lang=en')
  await waitLink(pg)
  // Product → product with the same layout: only the URL and the logo's src
  // attribute change, no node is added or removed.
  await pg.evaluate(() => {
    history.pushState({}, '', '/product/ahed-hoodie?lang=en')
    document.querySelector('.campaign-brand-plate__maker img').setAttribute('src', '/api/api.php?r=brand_logo&slug=ahed&v=bbbbbbbbbbbb')
  })
  await pg.waitForFunction(() => /brand=ahed/.test(document.querySelector('[data-sporta-plate-link]').getAttribute('href')), null, { timeout: 3000 }).catch(() => {})
  r = await plate(pg)
  is(r.n === 1 && r.href === '/shop?brand=ahed&lang=en' && r.label === 'Shop AHED', 'only the logo\'s src changed: the link follows it', `${r.href} ${r.label}`)
  await pg.close()
  reset()
  state.publicCounts.ahed = 3
  pg = await open('/product/ahed-hoodie?lang=en')
  await waitLink(pg)
  r = await plate(pg)
  is(r.n === 1 && r.href === '/shop?brand=ahed&lang=en', 'a logo without the brand_logo URL is matched by its alt, trimmed, any case', r.href)
  await pg.close()
}

// ======================================================== 4. the home strip
head('home strip text tiles')
{
  reset()
  let pg = await open('/?lang=en&fx=arabictile')
  const tiles = (p) => p.evaluate(() => [...document.querySelectorAll('.brand-bar__item')].map((a) => {
    const s = a.querySelector(':scope > span'), img = a.querySelector('img')
    if (img) return { logo: true, filter: getComputedStyle(img).filter, ls: getComputedStyle(a).letterSpacing }
    const cs = getComputedStyle(s), ia = getComputedStyle(a)
    const range = document.createRange(); range.selectNodeContents(s)
    const room = a.clientWidth - parseFloat(ia.paddingLeft) - parseFloat(ia.paddingRight)
    return { text: s.textContent, tt: cs.textTransform, ls: cs.letterSpacing, fs: parseFloat(cs.fontSize), fits: range.getBoundingClientRect().width <= room + 0.5 }
  }))
  let t = await tiles(pg)
  await shot(pg, 'strip-en', '.brand-bar')
  const latin = t.filter((x) => !x.logo && /^[A-Za-z]+$/.test(x.text))
  is(latin.length === 5 && latin.every((x) => x.tt === 'uppercase'), 'English: every Latin text tile is in capitals', latin.map((x) => x.text).join(' '))
  is(latin.every((x) => Math.abs(parseFloat(x.ls) - 0.06 * x.fs) < 0.05), 'tracked at 0.06em', latin.map((x) => x.ls).join(' '))
  is(t.filter((x) => !x.logo).every((x) => x.fits), 'and every one still fits its 132px tile ("EYESPORTWEAR" shrinks)',
    t.filter((x) => !x.logo).map((x) => `${x.text}:${x.fs}`).join(' '))
  is(latin.find((x) => x.text === 'Gymshark').fs === 15, 'a name that fits keeps its 15px')
  const arTile = t.find((x) => !x.logo && x.text === 'سبورتا')
  is(arTile && arTile.tt === 'none' && arTile.ls === 'normal', 'an Arabic name on the English page is never letter-spaced', arTile && arTile.ls)
  is(t.filter((x) => x.logo).length === 2 && t.filter((x) => x.logo).every((x) => x.filter === 'grayscale(1) brightness(0) invert(1)'),
    'logo tiles untouched (still made white by their filter)')
  await pg.evaluate(() => window.fxLang('ar'))
  await settle(pg)
  t = await tiles(pg)
  is(t.filter((x) => !x.logo).every((x) => x.tt === 'none' && x.ls === 'normal' && x.fs === 15), 'Arabic: no capitals, no tracking, no shrinking',
    t.filter((x) => !x.logo).map((x) => `${x.ls}/${x.fs}`).join(' '))
  is(!state.hits['api:brands'], 'the home page does not fetch r=brands')
  await pg.close()
}

// ============================================================ 5. the admin
head('/backends Brands screen')
{
  reset()
  const dialogs = []
  const pg = await open('/backends', { width: 1280 })
  let dismissNext = false
  pg.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); if (dismissNext) { dismissNext = false; d.dismiss() } else d.accept() })
  await pg.waitForFunction(() => /of 46/.test((document.querySelector('[data-sporta-tag-summary]') || {}).textContent || ''))
  await settle(pg)
  const cardInfo = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('li.admin-brand-card')].map((li) => {
    const s = li.querySelector('[data-sporta-brand-stats]')
    const a = s && s.querySelector('a')
    const span = s && s.querySelector('span')
    return [li.querySelector('p.font-mono').textContent.replace('/brand/', ''), {
      text: span ? span.textContent : null, color: span ? getComputedStyle(span).color : null,
      href: a && a.getAttribute('href'), target: a && a.target, rel: a && a.rel, link: a && a.textContent,
      afterMono: !!s && s.previousElementSibling === li.querySelector('p.font-mono'),
      remove: li.querySelectorAll('[data-sporta-remove-btn]').length, hidden: li.style.display === 'none',
    }]
  })))
  let c = await cardInfo()
  is(c.vanquish.text === '1 product · 1 shown', 'Vanquish card: "1 product · 1 shown"', c.vanquish.text)
  is(c.vanquish.href === '/shop?brand=vanquish' && c.vanquish.target === '_blank' && c.vanquish.rel === 'noopener' && c.vanquish.link === 'View on site ↗',
    '"View on site ↗" opens the real brand page in a new tab', c.vanquish.href)
  is(c.vanquish.afterMono, 'the line sits right under the web address')
  is(c.nba.text === 'No products tagged — this brand opens an empty page' && c.nba.color === 'rgb(190, 18, 60)',
    'an empty brand is called out in rose', `${c.nba.text} ${c.nba.color}`)
  is(Object.values(c).every((x) => x.remove === 1), 'every card has exactly one Remove')
  // Hidden in the shop: no tile, so no "opens an empty page".
  await pg.uncheck('li.admin-brand-card:nth-child(7) input[type=checkbox]')
  await settle(pg)
  c = await cardInfo()
  is(c.nba.text === 'No products tagged' && c.nba.color === 'rgb(100, 116, 139)',
    'unticking Shown: a hidden empty brand gets the fact in grey, without the warning', `${c.nba.text} ${c.nba.color}`)
  await pg.check('li.admin-brand-card:nth-child(7) input[type=checkbox]')
  await settle(pg)
  is((await cardInfo()).nba.text === 'No products tagged — this brand opens an empty page', 'ticked again: the warning is back')

  const panel = () => pg.evaluate(() => {
    const ps = document.querySelectorAll('[data-sporta-brand-tagger]')
    const p = ps[0]
    const sug = [...p.querySelectorAll('[data-sporta-tag-suggestions] input')].map((i) => `${i.getAttribute('data-product')}>${i.getAttribute('data-brand')}${i.checked ? '' : '(off)'}`)
    return {
      dir: getComputedStyle(p).direction, statsDir: getComputedStyle(document.querySelector('[data-sporta-brand-stats]')).direction,
      n: ps.length, beforeList: p.nextElementSibling === document.querySelector('li.admin-brand-card').parentNode,
      summary: p.querySelector('[data-sporta-tag-summary]').textContent, sug,
      status: p.querySelector('[data-sporta-tag-apply]').nextElementSibling.textContent,
      manStatus: p.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling.textContent,
      manColor: getComputedStyle(p.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling).color,
      picked: p.querySelector('[data-sporta-tag-all]').nextElementSibling.textContent,
      visible: [...p.querySelectorAll('[data-sporta-tag-products] > label')].filter((l) => l.style.display !== 'none').map((l) => l.querySelector('input').getAttribute('data-product')),
      lastRow: [...p.querySelectorAll('[data-sporta-tag-products] > label')].slice(-1).map((l) => l.textContent)[0],
    }
  })
  let p = await panel()
  await shot(pg, 'admin-brands')
  is(p.n === 1 && p.beforeList, 'one tagging panel, directly above the brand list')
  is(p.dir === 'ltr' && p.statsDir === 'ltr', 'English, left-to-right, even when the page is right-to-left', `${p.dir} ${p.statsDir}`)
  is(p.summary === '45 of 46 products have no brand.', 'it counts the untagged', p.summary)
  const by = (b) => p.sug.filter((s) => s.split('>')[1].replace('(off)', '') === b)
  is(by('vanquish').length === 3 && by('vanquish').every((s) => !s.includes('(off)')), 'suggests the three untagged Vanquish pieces, ticked', by('vanquish').join(' '))
  is(by('gymshark').length === 1 && by('gymshark')[0] === 'gymshark-phone-strap>gymshark', 'and the Gymshark strap', by('gymshark').join(' '))
  is(by('sporta').length === 0, '"Sporta" in 41 of 46 names (89%) suggests nothing — not the whole catalogue')
  is(by('tek').length === 0, '"tek" inside "tekno" is not a word: no suggestion')
  is(p.sug.length === 4, 'four suggestions in all', `${p.sug.length}`)
  is(!/no brand/i.test(p.lastRow) && /Vanquish/.test(p.lastRow), 'manual list: untagged first, the tagged one last with its brand', p.lastRow)

  // Remove: the slug is "/brand/eyesportwear" on the card, the id is 6.
  await pg.click('li.admin-brand-card:nth-child(6) [data-sporta-remove-btn]')
  const gone = await pg.waitForFunction(() => document.querySelector('li.admin-brand-card:nth-child(6)').style.display === 'none', null, { timeout: 3000 })
    .then(() => true, () => false)
  is(gone && (await pg.evaluate(() => document.querySelectorAll('li.admin-brand-card').length)) === 7,
    'the removed card is HIDDEN, not detached (React owns that <li>)')
  const del = state.posts.filter((x) => x.r === 'brand_delete')
  is(del.length === 1 && del[0].body.id === 6 && del[0].csrf === '1', 'Remove finds the id behind "/brand/<slug>" and posts brand_delete', JSON.stringify(del[0] && del[0].body))
  is(dialogs.length === 1 && dialogs[0].startsWith('confirm:'), 'one confirm, no "Could not find this brand" alert', dialogs.join(' | '))

  // Apply suggestions, one unticked.
  state.posts = []
  state.assignDelay = 300
  await pg.uncheck('[data-sporta-tag-suggestions] input[data-product="vanquish-t-shirt-white"]')
  await pg.click('[data-sporta-tag-apply]')
  const disabled = await pg.evaluate(() => ['apply', 'go', 'all'].every((k) => document.querySelector(`[data-sporta-tag-${k}]`).disabled))
  is(disabled, 'buttons are disabled while saving')
  await pg.waitForFunction(() => /Tagged/.test(document.querySelector('[data-sporta-tag-apply]').nextElementSibling.textContent), null, { timeout: 5000 })
  state.assignDelay = 0
  await settle(pg)
  const assigns = state.posts.filter((x) => x.r === 'brand_assign')
  const bodies = Object.fromEntries(assigns.map((x) => [x.body.brand_slug, x.body.products]))
  is(assigns.length === 2 && assigns.every((x) => x.csrf === '1' && /application\/json/.test(x.ctype)), 'Apply: one POST per brand, with X-Sporta-Admin and JSON', `${assigns.length}`)
  is(JSON.stringify(bodies.vanquish) === JSON.stringify(['vanquish-stringer-vest-white', 'vanquish-t-shirt-navy-blue']) &&
     JSON.stringify(bodies.gymshark) === JSON.stringify(['gymshark-phone-strap']), 'the unticked one is left out', JSON.stringify(bodies))
  p = await panel()
  is(/Tagged 2 products with Vanquish\./.test(p.status) && /Tagged 1 product with Gymshark\./.test(p.status), 'reports what was tagged', p.status)
  is(p.summary === '42 of 46 products have no brand.' && p.sug.length === 1 && p.sug[0] === 'vanquish-t-shirt-white>vanquish(off)',
    'and redraws in place: counts, and the one suggestion left still unticked', `${p.summary} · ${p.sug.join(' ')}`)
  c = await cardInfo()
  is(c.vanquish.text === '3 products · 3 shown' && c.gymshark.text === '1 product · 1 shown', 'the cards\' counts follow', `${c.vanquish.text} / ${c.gymshark.text}`)

  // Manual tagger.
  state.posts = []
  await pg.selectOption('[data-sporta-tag-brand]', 'nba')
  await pg.fill('[data-sporta-tag-filter]', 'denver')
  p = await panel()
  is(JSON.stringify(p.visible) === '["denver-nuggets-cap-navy"]', 'the filter narrows the list', p.visible.join(' '))
  const rowDisplay = await pg.evaluate(() => getComputedStyle([...document.querySelectorAll('[data-sporta-tag-products] > label')].find((l) => l.style.display !== 'none')).display)
  is(rowDisplay === 'flex', 'a row the filter shows keeps its own layout', rowDisplay)
  // The harness can see a submit: Enter in a plain field of the same form does submit.
  await pg.press('#fxprobe', 'Enter')
  const probe = await pg.evaluate(() => window.fxSubmits)
  await pg.evaluate(() => { window.fxSubmits = 0 })
  await pg.press('[data-sporta-tag-filter]', 'Enter')
  await sleep(250)
  is(probe === 1 && (await pg.evaluate(() => window.fxSubmits)) === 0 && state.posts.length === 0, 'Enter in the filter submits nothing and posts nothing', `probe ${probe}`)
  // A checkbox in a form submits it on Enter too (Chromium): every input in the panel is guarded.
  const probeBox = await pg.evaluate(() => {
    const f = document.getElementById('fxform'), b = document.createElement('input')
    b.type = 'checkbox'; b.id = 'fxprobebox'; f.appendChild(b); return true
  })
  await pg.focus('#fxprobebox')
  await pg.keyboard.press('Enter')
  const boxProbe = await pg.evaluate(() => { const n = window.fxSubmits; window.fxSubmits = 0; document.getElementById('fxprobebox').remove(); return n })
  await pg.focus('[data-sporta-tag-suggestions] input')
  await pg.keyboard.press('Enter')
  await pg.focus('[data-sporta-tag-products] > label:not([style*="none"]) input')
  await pg.keyboard.press('Enter')
  await sleep(250)
  is(probeBox && boxProbe === 1 && (await pg.evaluate(() => window.fxSubmits)) === 0 && state.posts.length === 0,
    'Enter on a suggestion checkbox or a product checkbox submits nothing either', `probe ${boxProbe}`)
  await pg.click('[data-sporta-tag-all]')
  p = await panel()
  is(p.picked === '1 selected', '"Tick all in this list" ticks what the filter shows', p.picked)
  await pg.click('[data-sporta-tag-go]')
  await pg.waitForFunction(() => /Tagged/.test(document.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling.textContent))
  await settle(pg)
  is(state.posts.length === 1 && JSON.stringify(state.posts[0].body) === JSON.stringify({ brand_slug: 'nba', products: ['denver-nuggets-cap-navy'] }) && state.posts[0].csrf === '1',
    'Tag selected posts {brand_slug, products}', JSON.stringify(state.posts[0] && state.posts[0].body))
  p = await panel()
  is(p.manStatus === 'Tagged 1 product with NBA.' && p.picked === '0 selected', 'reports it and clears the ticks', `${p.manStatus} · ${p.picked}`)
  c = await cardInfo()
  is(c.nba.text === '1 product · 1 shown', 'the NBA card stops saying it is empty', c.nba.text)

  // Re-branding a product that has ANOTHER brand asks first; declining sends nothing.
  state.posts = []
  dialogs.length = 0
  await pg.selectOption('[data-sporta-tag-brand]', 'rheo')
  await pg.click('[data-sporta-tag-all]')
  dismissNext = true
  await pg.click('[data-sporta-tag-go]')
  await settle(pg)
  p = await panel()
  is(dialogs.length === 1 && dialogs[0] === 'confirm: 1 of these already has another brand. Replace it with RHEO?' &&
     state.posts.length === 0 && p.manStatus === 'Nothing was changed.',
    'replacing a brand asks first, and "Cancel" changes nothing', `${dialogs.join(' | ')} · ${state.posts.length} · ${p.manStatus}`)
  dialogs.length = 0

  // Untag.
  state.posts = []
  await pg.selectOption('[data-sporta-tag-brand]', '__none__')
  await pg.click('[data-sporta-tag-all]')
  await pg.click('[data-sporta-tag-go]')
  await pg.waitForFunction(() => /Removed/.test(document.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling.textContent))
  is(state.posts.length === 1 && state.posts[0].body.brand_slug === null, '"No brand" posts brand_slug null', JSON.stringify(state.posts[0] && state.posts[0].body))
  is(dialogs.length === 1 && dialogs[0] === 'confirm: Remove the brand from 1 product?', 'after asking "Remove the brand from 1 product?"', dialogs.join(' | '))
  is((await panel()).manStatus === 'Removed the brand from 1 product.', 'and says so')

  // Errors read as sentences.
  state.posts = []
  await pg.click('[data-sporta-tag-go]')
  p = await panel()
  is(p.manStatus === 'Tick at least one product.' && state.posts.length === 0, 'nothing ticked: a sentence, no request', p.manStatus)
  state.failNext = { status: 400, body: { error: 'unknown_brand' } }
  await pg.selectOption('[data-sporta-tag-brand]', 'rheo')
  await pg.fill('[data-sporta-tag-filter]', 'street')
  await pg.click('[data-sporta-tag-all]')
  await pg.click('[data-sporta-tag-go]')
  await pg.waitForFunction(() => /exists/.test(document.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling.textContent))
  p = await panel()
  is(p.manStatus === 'That brand no longer exists. Refresh the page.' && p.manColor === 'rgb(190, 18, 60)', '400 unknown_brand → a plain sentence, in rose', p.manStatus)
  state.failNext = { status: 500, body: { error: 'failed' } }
  await pg.click('[data-sporta-tag-go]')
  await pg.waitForFunction(() => /Could not save/.test(document.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling.textContent))
  is((await panel()).manStatus === 'Could not save (failed).', 'anything else: "Could not save (code)."')
  state.failNext = { status: 401, body: { error: 'not_signed_in' } }
  await pg.click('[data-sporta-tag-go]')
  await pg.waitForFunction(() => /session/.test(document.querySelector('[data-sporta-tag-go]').parentNode.nextElementSibling.textContent))
  is((await panel()).manStatus === 'Your session ended. Sign in again.', 'not_signed_in → sign in again')

  // React replaces the whole screen.
  await pg.evaluate(() => window.fxRerender())
  await settle(pg)
  p = await panel()
  c = await cardInfo()
  is(p.n === 1 && p.beforeList, 'after a wholesale re-render: one panel, back above the list')
  is(Object.values(c).every((x) => x.remove === 1 && x.afterMono), 'and every card has its Remove and count line again')
  is((await pg.inputValue('[data-sporta-tag-filter]')) === 'street', 'the panel kept its state (the filter text)')
  is(state.posts.every((x) => x.csrf === '1'), 'every admin POST carried X-Sporta-Admin: 1')
  await pg.close()
}

head('/backends Brands: re-read on entry and on a new brand')
{
  reset()
  const pg = await open('/backends', { width: 1280 })
  pg.on('dialog', (d) => d.accept())
  await pg.waitForFunction(() => /of 46/.test((document.querySelector('[data-sporta-tag-summary]') || {}).textContent || ''))
  await settle(pg)
  const hits = () => state.hits['admin:brands'] || 0
  const text = (slug) => pg.evaluate((s) => {
    const li = [...document.querySelectorAll('li.admin-brand-card')].find((x) => x.querySelector('p.font-mono').textContent === '/brand/' + s)
    const sp = li && li.querySelector('[data-sporta-brand-stats] span')
    return sp ? sp.textContent : null
  }, slug)
  const summary = () => pg.evaluate(() => document.querySelector('[data-sporta-tag-summary]').textContent)
  const options = () => pg.evaluate(() => [...document.querySelectorAll('[data-sporta-tag-brand] option')].map((o) => o.value))
  const h0 = hits()
  for (let i = 0; i < 3; i++) { await pg.evaluate(() => window.fxRerender()); await settle(pg) }
  is(hits() === h0, 're-renders of the same screen do not re-read anything', `${h0} → ${hits()}`)

  // Leave, tag three Vanquish pieces and the hidden backpack in "the Catalogue", come back.
  await pg.evaluate(() => window.fxNavigate('/backends/catalogue'))
  await settle(pg)
  is((await pg.evaluate(() => document.querySelectorAll('[data-sporta-brand-tagger]').length)) === 0, 'no panel on another admin screen')
  for (const p of state.products) {
    if (/^vanquish-/.test(p.slug)) p.brand_slug = 'vanquish'
    if (p.slug === 'cagliari-calcio-backpack') p.brand_slug = 'rheo'
  }
  await pg.evaluate(() => window.fxNavigate('/backends'))
  await pg.waitForFunction(() => /^41 of 46/.test((document.querySelector('[data-sporta-tag-summary]') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {})
  await settle(pg)
  is(hits() === h0 + 1, 'coming back to Brands reads the brands again, once', `${h0} → ${hits()}`)
  is((await summary()) === '41 of 46 products have no brand.', 'the panel counts what was tagged elsewhere', await summary())
  is((await text('vanquish')) === '4 products · 4 shown', 'and the card follows', await text('vanquish'))
  const sug = await pg.evaluate(() => document.querySelectorAll('[data-sporta-tag-suggestions] input').length)
  is(sug === 1, 'products tagged meanwhile are no longer suggested', `${sug} left`)
  is((await text('rheo')) === '1 product · 0 shown — this brand opens an empty page',
    'a shown brand whose only product is hidden is called out too', await text('rheo'))

  // The compiled "Add a brand" saves Puma: a card for a slug nobody has read yet.
  state.brands.push({ id: 99, slug: 'puma', name_en: 'Puma', name_ar: 'بوما', logo: null, active: 1, sort: 99 })
  const h1 = hits()
  await pg.evaluate(() => window.fxAddBrand(['puma', 'Puma', 'بوما', false]))
  await pg.waitForFunction(() => [...document.querySelectorAll('[data-sporta-tag-brand] option')].some((o) => o.value === 'puma'), null, { timeout: 3000 }).catch(() => {})
  await settle(pg)
  is(hits() === h1 + 1 && (await options()).includes('puma'), 'a new brand card reads the list again: it can be tagged at once', `${h1} → ${hits()}`)
  is((await text('puma')) === 'No products tagged — this brand opens an empty page', 'and its card has its count line', await text('puma'))

  // A card whose slug the server does not know (yet): asked about ONCE.
  const h2 = hits()
  await pg.evaluate(() => window.fxAddBrand(['ghost', 'Ghost', 'شبح', false]))
  await settle(pg); await sleep(200)
  for (let i = 0; i < 3; i++) { await pg.evaluate(() => window.fxRerender()); await settle(pg) }
  is(hits() === h2 + 1, 'an unknown slug is asked about once, never in a loop', `${h2} → ${hits()}`)
  await pg.close()
}

head('sign-in screen: the session line says what the server does')
{
  const NEW = 'You stay signed in on this browser for 30 days. 7 days without use signs you out.'
  const pg = await open('/backends?fx=login&lang=en')
  await settle(pg)
  const line = () => pg.evaluate(() => document.querySelector('.admin-login p.text-center').textContent)
  is((await line()) === NEW, 'the 8-hour line now says 30 days / 7 days unused', await line())
  is(await pg.evaluate(() => document.querySelector('.admin-login p.text-center').firstChild === window.fxLoginNode),
    'the text node React rendered is edited in place, not replaced')
  await pg.evaluate(() => window.fxRerender()); await settle(pg)
  is((await line()) === NEW, 'and again after the app re-renders the login wholesale', await line())
  const other = await pg.evaluate(() => document.querySelector('.admin-login p.fx-other').textContent)
  is(other === 'Sessions expire after 8 hours idle. Ask the owner.', 'a line worded differently is left alone (exact match only)', other)
  await pg.close()
  const pa = await open('/backends')
  await settle(pa)
  is(await pa.evaluate(() => !document.querySelector('.admin-login')), 'the signed-in admin fixture is untouched by it')
  await pa.close()
}

head('no page errors, nothing unmocked')
is(errors.length === 0, 'no page errors or console errors in any scenario (CSP included)', errors.slice(0, 5).join(' | ') || 'none')
is(unmatched.length === 0, 'every request was answered by the fixture', unmatched.slice(0, 5).join(' '))

await browser.close()
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
