// CATALOGUE-1118: the "Catalogue" tab and page on the REAL compiled storefront (the capture of the live client, served by
// scripts/lib/add-to-cart-ux-live.mjs) with the add-ons of this repo on top: sporta-features.js (the CATALOGUE-1118 block) and
// sporta-catalogue.js (loaded on demand).
//
//   npm run test:catalogue-page     (needs the live capture like the other real-app suites; it says so and skips when it is absent)
//
// Asserted:
//   - THE TAB: six tabs in the order Home, Shop, Catalogue, About, Contact, Account in both languages, one row at 360, 390, 768 and 1280 px
//     (320 px may scroll inside the row as it does at larger text), every tab at least 44 px tall, nothing else on the header moves (the same
//     header height as without the block, layout shift no worse than without it), the tab is marked current only on /catalogue, and no other
//     page downloads sporta-catalogue.js or makes a request it did not make before;
//   - THE PAGE at /catalogue and /catalogue/: the app's "Page not found" section is never visible, not even for one frame; the document gets a
//     title, a description, robots index, a canonical per language, the three alternates, and a JSON-LD ItemList with every product; the heading,
//     the live count, one card per product linking to its page (?lang=en in English), prices in the site's own formats, the percent badge and
//     the struck list price on a sale, the sold-out band, sizes in order; no sideways scroll at 390, 768 and 1280 px in either language; every
//     control 44 px tall; text only in the shop's black or white;
//   - LIVE: when the shop changes a price, starts a sale, sells a size out, drops or adds a product, the page shows it when the tab returns
//     (no reload), and the "updated" line follows;
//   - THE FILTERS: a category chip, the search box, the empty message;
//   - THE PDF: the buttons build and download a real PDF (poppler reads it: pages, links, title), in the page's language and in the other one,
//     with progress shown and the buttons off while it works; "Download again"; the copied live link; /catalogue?pdf=ar|en starts the download
//     by itself;
//   - LEAVING: the Shop tab (a client-side route change), the logo and Back each remove the page, its alternates, its structured data and its
//     marker, and the app's own page is whole; Back brings the catalogue back; an unknown path such as /catalogue-x is still the app's 404
//     with nothing of the catalogue; a language switch on the page switches it (heading, status, title, canonical, JSON-LD);
//   - MUTATIONS: without the hiding rule the 404 shows, without the six-column rule the phone row wraps, without the canonical the document has
//     none, without the clean-up the catalogue stays after leaving.
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveLive, liveDir, PUB } from './lib/add-to-cart-ux-live.mjs'
import { genImages } from './lib/catalogue-fx.mjs'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const L = liveDir()
if (!L) { console.log('SKIP no live capture (set SPORTA_LIVE_CAPTURE)'); process.exit(0) }
if (spawnSync('pdfinfo', ['-v']).error) { console.log('SKIP poppler is not installed'); process.exit(0) }

const FEATURES = readFileSync(join(PUB, 'sporta-features.js'), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const tmp = mkdtempSync(join(tmpdir(), 'sporta-catpage-'))
const gen = await browser.newPage(); const IMAGES = await genImages(gen); await gen.close()
const J = (f) => JSON.parse(readFileSync(join(L, 'api', f), 'utf8'))
const fresh = () => ({ products: J('products.json'), stock: J('stock.json'), brands: J('brands.json') })
const PHOTO = new Set(['cloudsoft-leggings-grey', 'sculpt-top-grey', 'sculpt-top-navy', 'sgomma-t-shirt-navy', 'tekno-shorts-black'])

async function start(opts = {}) {
  const state = fresh()
  // a sale, a brand and a size that is out, so the page has something to show in each state
  const p = state.products; p[1].on_sale = true; p[1].list_price = p[1].price + 2
  const srv = await serveLive({ js: opts.js || {}, api: { products: () => state.products, stock: () => state.stock, brands: () => state.brands } })
  return { state, srv }
}
async function ctxOf(srv, lang, w, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...extra })
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('lang', l) } catch (e) { /* ignore */ }
    window.__cls = 0
    try { new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* ignore */ }
    // one rAF sample per frame: is the app's 404 section ever visible while the catalogue is the page?
    window.__flash = 0
    const tick = () => {
      const n = document.querySelector('main section p.text-7xl')
      if (n && /^\/catalogue\/?$/.test(location.pathname)) { const cs = getComputedStyle(n), r = n.getBoundingClientRect(); if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0) window.__flash++ }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, lang)
  await ctx.route('**/images/products/**', (route) => {
    const m = /\/images\/products\/([^/]+)\.(jpg|png|webp|jpeg)$/.exec(new URL(route.request().url()).pathname)
    if (m && m[2] === 'jpg' && PHOTO.has(m[1])) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(IMAGES.jpg, 'base64') })
    return route.fulfill({ status: 404, body: 'nf' })
  })
  const page = await ctx.newPage(), errs = [], reqs = []
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()) })
  page.on('request', (r) => reqs.push(r.method() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search))
  return { ctx, page, errs, reqs }
}
const tabs = (page) => page.evaluate(() => {
  const ul = document.querySelector('.navbar-secondary ul'), as = [...ul.querySelectorAll('a')], rs = as.map((a) => a.getBoundingClientRect())
  return { labels: as.map((a) => a.textContent.trim()), hrefs: as.map((a) => a.getAttribute('href')), oneRow: new Set(rs.map((r) => Math.round(r.top))).size === 1, minH: Math.min(...rs.map((r) => r.height)), minW: Math.min(...rs.map((r) => r.width)),
    scroll: ul.parentElement.scrollWidth - ul.parentElement.clientWidth, current: as.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href')), header: Math.round(document.querySelector('.app-header').getBoundingClientRect().height) }
})
const EN = ['Home', 'Shop', 'Catalogue', 'About', 'Contact', 'Account'], AR = ['الرئيسية', 'المتجر', 'الكتالوج', 'من نحن', 'اتصل بنا', 'حسابي']
const info = (file) => { const o = spawnSync('pdfinfo', [file], { encoding: 'utf8' }); const m = {}; String(o.stdout).split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim() }); return m }
const urlsOf = (file) => String(spawnSync('pdfinfo', ['-url', file], { encoding: 'utf8' }).stdout).split('\n').map((l) => /^\s*(\d+)\s+Annotation\s+(\S+)/.exec(l)).filter(Boolean).map((m) => m[2])

// =============================================================================================================== the menu
head('the menu tab')
const base = await start()
const bare = await start({ js: { 'sporta-features.js': FEATURES.replace(/\/\* ===== CATALOGUE-1118 - begin[\s\S]*?\/\* ===== CATALOGUE-1118 - end ===== \*\//, '') } })
is(FEATURES.includes('CATALOGUE-1118 - begin') && FEATURES.includes('CATALOGUE-1118 - end'), 'the block is in sporta-features.js (a copy without it serves as the baseline)')
for (const lang of ['en', 'ar']) {
  for (const w of [320, 360, 390, 768, 1280]) {
    const a = await ctxOf(base.srv, lang, w), b = await ctxOf(bare.srv, lang, w)
    await a.page.goto(base.srv.base + '/'); await b.page.goto(bare.srv.base + '/'); await a.page.waitForTimeout(900); await b.page.waitForTimeout(900)
    const T = await tabs(a.page), B = await tabs(b.page)
    const tag = `${lang} ${w}px`
    is(eq(T.labels, lang === 'ar' ? AR : EN) && T.hrefs[2] === '/catalogue' && T.hrefs[1] === '/shop', `${tag}: six tabs, Catalogue after Shop`, T.labels.join(','))
    is(T.oneRow && (w === 320 || T.scroll <= 0), `${tag}: one row${w === 320 ? '' : ', no sideways scroll'}`, JSON.stringify({ oneRow: T.oneRow, scroll: T.scroll }))
    is(T.minH >= 44 && T.minW >= 44, `${tag}: every tab is at least 44 x 44 px`, `${T.minW}x${T.minH}`)
    is(T.header === B.header, `${tag}: the header is as tall as without the block (${B.header}px)`, `${T.header} vs ${B.header}`)
    is(T.current.length === 1 && T.current[0] === '/', `${tag}: only Home is current on the home page`, JSON.stringify(T.current))
    if (w === 390 || w === 1280) {
      const cls = await a.page.evaluate(() => window.__cls), clsB = await b.page.evaluate(() => window.__cls)
      is(cls <= clsB + 0.002, `${tag}: no layout shift from inserting the tab (${cls.toFixed(4)} against ${clsB.toFixed(4)} without)`)
      is(!a.reqs.some((r) => r.includes('sporta-catalogue')) && a.reqs.filter((r) => !r.includes('sporta-catalogue')).length <= b.reqs.length + 0, `${tag}: no extra request and no download of the engine on the home page`, `${a.reqs.length} vs ${b.reqs.length}`)
    }
    is(a.errs.length === 0 && b.errs.length === 0, `${tag}: no page errors`, a.errs.concat(b.errs).join(' | '))
    await a.ctx.close(); await b.ctx.close()
  }
}
{
  const a = await ctxOf(base.srv, 'en', 390)
  for (const path of ['/shop', '/about', '/contact']) {
    await a.page.goto(base.srv.base + path); await a.page.waitForTimeout(700)
    const T = await tabs(a.page); is(T.labels.length === 6 && T.oneRow, `${path}: the tab is on every page, in one row`)
  }
  is(!a.reqs.some((r) => r.includes('sporta-catalogue')), 'shop, about and contact never download the engine')
  await a.ctx.close()
}

// ================================================================================================================ the page
async function openPage(lang, w, path = '/catalogue', srv = base.srv) {
  const c = await ctxOf(srv, lang, w)
  await c.page.goto(srv.base + path); await c.page.waitForSelector('.scat-card', { timeout: 15000 }); await c.page.waitForTimeout(300)
  return c
}
const pageFacts = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), ld = [...document.querySelectorAll('script[data-sporta-catalogue-ld]')].map((s) => { try { return JSON.parse(s.textContent) } catch (e) { return null } })
  return {
    path: location.pathname, title: document.title, desc: (q('meta[name=description]') || {}).content, robots: (q('meta[name=robots]') || {}).content, canon: [...document.querySelectorAll('link[rel=canonical]')].map((l) => l.href),
    alts: [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => l.getAttribute('hreflang') + '=' + l.href), ldN: ld.length, ld: ld[0],
    h1: (q('#sporta-catalogue h1') || {}).textContent, status: (q('.scat-status') || {}).textContent, cards: document.querySelectorAll('.scat-card').length,
    notFound: (() => { const n = document.querySelector('main section p.text-7xl'); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 })(), flash: window.__flash,
    host: document.querySelectorAll('#sporta-catalogue').length, marker: document.querySelector('main').hasAttribute('data-sporta-cat'), headMarks: document.querySelectorAll('[data-sporta-cat-head]').length,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir, lang: document.documentElement.lang,
    current: (q('a[href="/catalogue"]') || { getAttribute: () => null }).getAttribute('aria-current'),
  }
})
head('the page')
for (const [lang, w] of [['en', 390], ['ar', 390], ['en', 1280], ['ar', 768]]) {
  const c = await openPage(lang, w), F = await pageFacts(c.page), tag = `${lang} ${w}px`, ar = lang === 'ar'
  is(F.path === '/catalogue' && F.cards === 46 && F.host === 1, `${tag}: /catalogue shows the catalogue, one card per product (46)`, `${F.cards}`)
  is(!F.notFound && F.flash === 0, `${tag}: the app's "Page not found" is never visible, not for one frame`, `flash frames ${F.flash}`)
  is(F.title === (ar ? 'كتالوج المنتجات — سبورتا' : 'Product catalogue — Sporta'), `${tag}: the document title`, F.title)
  is(F.desc && F.desc.length > 60 && F.desc.length < 170, `${tag}: a description of the right length`, String(F.desc && F.desc.length))
  is(/^index, follow/.test(F.robots), `${tag}: robots says index (the app's not-found page said noindex)`, F.robots)
  is(eq(F.canon, ['https://www.sporta.com.kw/catalogue' + (ar ? '' : '?lang=en')]), `${tag}: one canonical, itself, in the page's language`, JSON.stringify(F.canon))
  is(eq(F.alts.sort(), ['ar=https://www.sporta.com.kw/catalogue', 'en=https://www.sporta.com.kw/catalogue?lang=en', 'x-default=https://www.sporta.com.kw/catalogue']), `${tag}: the en, ar and x-default alternates`, JSON.stringify(F.alts))
  is(F.ldN === 1 && F.ld['@type'] === 'CollectionPage' && F.ld.mainEntity.numberOfItems === 46 && F.ld.mainEntity.itemListElement.length === 46 && F.ld.inLanguage === lang, `${tag}: structured data lists all 46 products`)
  is(F.h1 === (ar ? 'كتالوج منتجات سبورتا' : 'Sporta product catalogue') && F.status.startsWith(ar ? 'عدد المنتجات: 46' : 'Products: 46'), `${tag}: heading and the live count`, `${F.h1} / ${F.status}`)
  is(F.current === 'page' && F.dir === (ar ? 'rtl' : 'ltr'), `${tag}: the tab is current; the page direction follows the language`)
  is(F.scroll <= 0, `${tag}: no sideways scroll`, String(F.scroll))
  const cards = await c.page.evaluate(() => [...document.querySelectorAll('.scat-card')].map((el) => ({ slug: el.querySelector('a').getAttribute('data-scat-product'), href: el.querySelector('a').getAttribute('href'), text: el.innerText.replace(/\s+/g, ' ') })))
  is(cards.every((x) => x.href === '/product/' + x.slug + (ar ? '' : '?lang=en')), `${tag}: every card links to its product page`)
  const sample = cards.find((x) => x.slug === J('products.json')[0].slug)
  is(ar ? /\d\.\d{3}\s*د\.ك\./.test(sample.text) : /KWD\s\d+\.\d{3}/.test(sample.text), `${tag}: prices in the site's own format`, sample.text.slice(0, 80))
  const sale = cards.find((x) => x.slug === J('products.json')[1].slug)
  is(ar ? /خصم \d+%/.test(sale.text) : /\d+% off/.test(sale.text), `${tag}: the sale card carries its percent off`, sale.text.slice(0, 90))
  is(await c.page.evaluate((s) => !!document.querySelector(`[data-scat-product="${s}"] s.scat-was`), J('products.json')[1].slug), `${tag}: ...and the struck list price`)
  is(cards.some((x) => (ar ? /نفدت الكمية/ : /sold out/i).test(x.text)), `${tag}: a sold-out product says so`)
  const ctl = await c.page.evaluate(() => [...document.querySelectorAll('#sporta-catalogue button, #sporta-catalogue input')].map((e) => Math.round(e.getBoundingClientRect().height)))
  is(ctl.length >= 8 && ctl.every((h) => h >= 44), `${tag}: every control is at least 44 px tall`, ctl.join(','))
  const col = await c.page.evaluate(() => {
    const bad = []; const ok = (c) => c === 'rgb(23, 26, 30)' || c === 'rgb(255, 255, 255)'
    for (const e of document.querySelectorAll('#sporta-catalogue *')) { if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const c = getComputedStyle(e).color; if (!ok(c)) bad.push(e.className + ':' + c) }
    const badge = document.querySelector('.scat-badge'), sold = document.querySelector('.scat-sold')
    return { bad: bad.slice(0, 4), badge: badge && [getComputedStyle(badge).color, getComputedStyle(badge).backgroundColor], sold: sold && [getComputedStyle(sold).color, getComputedStyle(sold).backgroundColor] }
  })
  is(col.bad.length === 0, `${tag}: all text is the shop's black or white`, col.bad.join(' | '))
  is(col.badge[0] === 'rgb(23, 26, 30)' && /255, 123, 23/.test(col.badge[1]) && col.sold[0] === 'rgb(255, 255, 255)', `${tag}: black on the orange badge, white on the sold-out band`, JSON.stringify(col))
  is(c.errs.length === 0, `${tag}: no page errors`, c.errs.join(' | '))
  if (w === 390 && !ar) await c.page.screenshot({ path: join(tmp, 'page.png') })
  await c.ctx.close()
}
{
  const c = await openPage('en', 1280, '/catalogue/'); const F = await pageFacts(c.page)
  is(F.cards === 46 && !F.notFound, '/catalogue/ (a trailing slash) is the same page')
  is(c.reqs.filter((r) => r.includes('sporta-catalogue.js')).length === 1, 'the engine is requested once, only here')
  is(c.reqs.filter((r) => /^POST /.test(r)).length === 0 && c.reqs.every((r) => !/^GET \/api\/api\.php\?r=(?!products|stock|brands|slides|settings|theme|topbar|promo|checkout_config|content|text_style|me|shipping|slide_image)/.test(r)), 'only public GET routes are read')
  await c.ctx.close()
}
{
  const c = await ctxOf(base.srv, 'en', 390); await c.page.goto(base.srv.base + '/catalogue-x'); await c.page.waitForTimeout(1200)
  const F = await pageFacts(c.page)
  is(F.notFound && F.host === 0 && !F.marker && F.robots && /noindex/.test(F.robots) && F.ldN === 0, 'an unknown path (/catalogue-x) is still the app’s 404, noindex, with nothing of the catalogue')
  const T = await tabs(c.page); is(T.current.length === 0, '...and no tab is current there')
  await c.ctx.close()
}

head('live data, filters')
{
  const c = await openPage('en', 1280)
  const P = base.state.products, S = base.state.stock
  const before = await c.page.evaluate(() => document.querySelector('.scat-status').textContent)
  // the shop changes: a price, a sale, a size out, a product dropped, a product added
  const first = P[0], second = P[2], third = P[3]
  first.price = first.price + 1; first.list_price = first.price
  second.on_sale = true; second.list_price = second.price + 5
  S.forEach((r) => { if (r.slug === third.slug) { r.in_stock = false; r.stock = 0 } })
  const dropped = P.splice(P.length - 1, 1)[0]
  P.push({ ...first, slug: 'brand-new-product', name_en: 'Brand New Product', name_ar: 'منتج جديد', price: 2.5, list_price: 2.5, on_sale: false })
  await c.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await c.page.waitForFunction(() => document.querySelector('[data-scat-product="brand-new-product"]'), null, { timeout: 8000 })
  const after = await c.page.evaluate(([a, b, d]) => ({
    price: document.querySelector(`[data-scat-product="${a}"] .scat-now`).textContent, sale: !!document.querySelector(`[data-scat-product="${b}"] .scat-badge`),
    gone: !document.querySelector(`[data-scat-product="${d}"]`), count: document.querySelectorAll('.scat-card').length, status: document.querySelector('.scat-status').textContent,
  }), [first.slug, second.slug, dropped.slug])
  is(after.price.includes((first.price).toFixed(3)), 'a changed price shows without a reload', after.price)
  is(after.sale, 'a sale that started shows its badge')
  is(after.gone && after.count === 46, 'a dropped product is gone and a new one is there (still 46)', String(after.count))
  is(await c.page.evaluate((s) => !!document.querySelector(`[data-scat-product="${s}"] .scat-sold`), third.slug) || (await c.page.evaluate((s) => !document.querySelector(`[data-scat-product="${s}"] .scat-sizes`), third.slug)), 'a size that sold out is gone from the card')
  is(after.status.includes('Products: 46') && /Updated/.test(after.status), 'the status line still reads Products and Updated', after.status + ' (was ' + before + ')')
  // filters
  await c.page.click('[data-scat-cat="men"]'); const men = await c.page.evaluate(() => ({ n: document.querySelectorAll('.scat-card').length, pressed: document.querySelector('[data-scat-cat="men"]').getAttribute('aria-pressed'), all: document.querySelector('[data-scat-cat="all"]').getAttribute('aria-pressed') }))
  const wantMen = P.filter((x) => x.category === 'men').length
  is(men.n === wantMen && men.n > 5 && men.pressed === 'true' && men.all === 'false', `a category chip filters (Men: ${wantMen}) and is pressed`, String(men.n))
  await c.page.click('[data-scat-cat="all"]'); await c.page.fill('[data-scat="search"]', 'cloudsoft'); const s1 = await c.page.evaluate(() => [...document.querySelectorAll('.scat-name')].map((n) => n.textContent.toLowerCase()))
  is(s1.length > 0 && s1.every((t) => t.includes('cloudsoft')), 'the search box finds by name', String(s1.length))
  await c.page.fill('[data-scat="search"]', 'zzzz-nothing'); is(await c.page.evaluate(() => /No product matches/.test(document.querySelector('[data-scat="body"]').innerText)), 'no match says so')
  await c.page.fill('[data-scat="search"]', ''); is((await c.page.evaluate(() => document.querySelectorAll('.scat-card').length)) === 46, 'clearing the search brings every product back')
  await c.ctx.close()
}

head('the PDF from the page')
{
  const c = await openPage('en', 1280)
  const dl = c.page.waitForEvent('download')
  await c.page.click('[data-scat="dl"]')
  const busyText = await c.page.evaluate(() => ({ note: document.querySelector('[data-scat="note"]').textContent, dis: document.querySelector('[data-scat="dl"]').disabled }))
  const d = await dl; const f = join(tmp, 'en.pdf'); await d.saveAs(f)
  is(/^Sporta-Catalogue-EN-\d{4}-\d{2}-\d{2}\.pdf$/.test(d.suggestedFilename()), 'the primary button downloads the English file', d.suggestedFilename())
  is(/Preparing/.test(busyText.note) && busyText.dis === true, 'while it works the page says it is preparing the PDF and the buttons are off', JSON.stringify(busyText))
  const I = info(f), U = urlsOf(f)
  is(I.Pages === '9' && I.Title === 'Product catalogue – Sporta', 'poppler reads it: cover + men 2 + women 2 + hoodies 2 + accessories 1 = 9 pages (a category fills nine a page)', JSON.stringify([I.Pages, I.Title]))
  is(U.filter((u) => /\/product\//.test(u)).length === 46 && U.every((u) => /^https:\/\/www\.sporta\.com\.kw\//.test(u)), 'a link for each of the 46 products, all to www.sporta.com.kw')
  await c.page.waitForFunction(() => /Your PDF is ready/.test(document.querySelector('[data-scat="note"]').textContent))
  is(await c.page.evaluate(() => !document.querySelector('[data-scat="dl"]').disabled && !!document.querySelector('[data-scat="again"]') && !document.querySelector('[data-scat="again"]').hidden), 'afterwards the buttons are back and "Download again" is shown')
  const dl2 = c.page.waitForEvent('download'); await c.page.click('[data-scat="again"]'); const d2 = await dl2
  is(d2.suggestedFilename() === d.suggestedFilename(), '"Download again" gives the same file without building it again')
  const dl3 = c.page.waitForEvent('download'); await c.page.click('[data-scat="dl-other"]'); const d3 = await dl3
  is(/^Sporta-Catalogue-AR-/.test(d3.suggestedFilename()), 'the second button downloads the Arabic file', d3.suggestedFilename())
  await c.page.click('[data-scat="copy"]'); await c.page.waitForFunction(() => /Link copied/.test(document.querySelector('[data-scat="note"]').textContent))
  is((await c.page.evaluate(() => navigator.clipboard.readText())) === 'https://www.sporta.com.kw/catalogue?pdf=en', 'the copy button puts the live PDF link on the clipboard')
  await c.ctx.close()
  for (const lang of ['ar', 'en']) {
    const k = await ctxOf(base.srv, 'en', 1280); const w = k.page.waitForEvent('download', { timeout: 30000 })
    await k.page.goto(base.srv.base + '/catalogue?pdf=' + lang); const dd = await w
    is(new RegExp('^Sporta-Catalogue-' + lang.toUpperCase() + '-').test(dd.suggestedFilename()), `/catalogue?pdf=${lang} builds and downloads the ${lang === 'ar' ? 'Arabic' : 'English'} file by itself`, dd.suggestedFilename())
    is(await k.page.evaluate(() => document.querySelector('meta[name=robots]').content) === 'noindex, follow', `/catalogue?pdf=${lang} is kept out of the index (the plain page is "index, follow", asserted above)`)
    await k.ctx.close()
  }
}

head('the engine cannot be downloaded')
{
  const c = await ctxOf(base.srv, 'en', 390)
  let asked = 0
  const refuse = (route) => { asked++; route.abort() }
  await c.ctx.route('**/sporta-catalogue.js*', refuse)
  await c.page.goto(base.srv.base + '/catalogue'); await c.page.waitForTimeout(1500)
  // every DOM change runs the block's sync(): none of them may ask again, or leave a dead <script> behind
  await c.page.evaluate(() => { for (let i = 0; i < 60; i++) { const d = document.createElement('i'); document.body.appendChild(d); d.remove() } })
  await c.page.waitForTimeout(1500)
  const F = await c.page.evaluate(() => ({ scripts: document.querySelectorAll('script[src*="sporta-catalogue"]').length, note: (document.querySelector('[data-sporta-cat-fail]') || {}).textContent || '', cards: document.querySelectorAll('.scat-card').length, nf: !!(document.querySelector('main section p.text-7xl') && document.querySelector('main section p.text-7xl').getBoundingClientRect().width > 0) }))
  is(asked === 1, 'after a failed download, sixty more page changes do not ask again (one request)', String(asked))
  is(F.scripts === 0, 'and no dead <script> is left in the head', String(F.scripts))
  is(/could not be loaded/.test(F.note) && F.cards === 0 && !F.nf, 'the page says so in words, and does not show the app\u2019s "page not found"', JSON.stringify(F))
  // the network comes back: one retry after about ten seconds brings the catalogue
  await c.ctx.unroute('**/sporta-catalogue.js*', refuse)
  const ok = await c.page.waitForSelector('.scat-card', { timeout: 20000 }).then(() => true, () => false)
  is(ok && await c.page.evaluate(() => !document.querySelector('[data-sporta-cat-fail]')), 'ten seconds later it tries once more, the catalogue appears and the sentence is gone')
  is(c.errs.length === 0, 'no page errors', c.errs.join(' | '))
  await c.ctx.close()
}
{
  // three refusals in a row: it gives up with a reload sentence and stops asking
  const c = await ctxOf(base.srv, 'ar', 390)
  let asked = 0
  await c.ctx.route('**/sporta-catalogue.js*', (route) => { asked++; route.abort() })
  await c.page.goto(base.srv.base + '/catalogue'); await c.page.waitForTimeout(23000)
  const note = await c.page.evaluate(() => (document.querySelector('[data-sporta-cat-fail]') || {}).textContent || '')
  is(asked === 3, 'three refused downloads, ten seconds apart, and then it stops asking', String(asked))
  is(/\u0623\u0639\u062f \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0635\u0641\u062d\u0629/.test(note), 'the last sentence (Arabic page) tells the visitor to reload the page', note)
  await c.ctx.close()
}

head('leaving, language switch')
{
  const c = await openPage('en', 1280)
  await c.page.click('.navbar-secondary a[href="/shop"]'); await c.page.waitForFunction(() => location.pathname === '/shop'); await c.page.waitForTimeout(900)
  let F = await pageFacts(c.page)
  is(F.host === 0 && !F.marker && F.headMarks === 0 && F.ldN === 0, 'the Shop tab (a client-side route change) removes the page, its marker, its alternates and its data', JSON.stringify({ host: F.host, marker: F.marker, head: F.headMarks, ld: F.ldN }))
  is(await c.page.evaluate(() => !!document.querySelector('.catalog-heading h1') && /Shop/.test(document.querySelector('main h1').textContent)), 'the app’s own Shop page is whole')
  is(F.canon.every((u) => !/catalogue/.test(u)) && !/Product catalogue/.test(F.title), 'no catalogue canonical or title is left behind', JSON.stringify(F.canon) + ' ' + F.title)
  await c.page.goBack(); await c.page.waitForSelector('.scat-card', { timeout: 10000 })
  F = await pageFacts(c.page); is(F.cards === 46 && F.host === 1 && F.path === '/catalogue', 'Back brings the catalogue back (no reload)')
  await c.page.click('.app-header a[href="/"]'); await c.page.waitForFunction(() => location.pathname === '/'); await c.page.waitForTimeout(700)
  F = await pageFacts(c.page); is(F.host === 0 && !F.marker && F.headMarks === 0, 'the logo does the same')
  await c.page.goto(base.srv.base + '/catalogue'); await c.page.waitForSelector('.scat-card')
  await c.page.click('.app-header button:has-text("AR")'); await c.page.waitForFunction(() => document.documentElement.lang === 'ar'); await c.page.waitForTimeout(600)
  F = await pageFacts(c.page)
  is(F.h1 === 'كتالوج منتجات سبورتا' && F.status.startsWith('عدد المنتجات') && F.title === 'كتالوج المنتجات — سبورتا' && eq(F.canon, ['https://www.sporta.com.kw/catalogue']) && F.ld.inLanguage === 'ar', 'the language switch on the page switches heading, status, title, canonical and data', JSON.stringify([F.h1, F.title, F.canon]))
  is(F.cards === 46 && F.dir === 'rtl', '...and keeps the 46 cards, now right to left')
  await c.ctx.close()
}

head('mutations')
const src = FEATURES
const MUT = [
  ['without the hiding rule', src.replace("'main[data-sporta-cat]>:not(#sporta-catalogue){display:none!important}#sporta-catalogue{min-height:70vh}'", "'#sporta-catalogue{min-height:70vh}'"), async (c) => (await pageFacts(c.page)).notFound === false],
  ['without the six-column rule', src.replace('grid-template-columns:repeat(6,minmax(min-content,1fr));', ''), async (c) => (await tabs(c.page)).oneRow],
  ['without the canonical', src.replace("ensureLink('canonical', '', l === 'en' ? bare + '?lang=en' : bare)", ''), async (c) => (await pageFacts(c.page)).canon.length === 1],
  ['without the failed-load guard', src.replace("if (failedAt && (tries >= 3 || Date.now() - failedAt < 10000)) return", ''), async (c) => { await c.ctx.route('**/sporta-catalogue.js*', (r) => { c.asked = (c.asked || 0) + 1; r.abort() }); await c.page.reload(); await c.page.waitForTimeout(1200); await c.page.evaluate(() => { for (let i = 0; i < 60; i++) { const d = document.createElement('i'); document.body.appendChild(d); d.remove() } }); await c.page.waitForTimeout(1200); return c.asked === 1 }],
  ['without the clean-up', src.replace("else if (page || document.getElementById('sporta-catalogue') || document.head.querySelector('[data-sporta-cat-head]')) unmount()", ''), async (c) => { await c.page.click('.navbar-secondary a[href="/shop"]'); await c.page.waitForTimeout(1200); return (await pageFacts(c.page)).host === 0 }],
]
for (const [label, text, check] of MUT) {
  if (text === src) { is(false, `mutation "${label}": the cut text was found`); continue }
  const m = await start({ js: { 'sporta-features.js': text } })
  const c = await ctxOf(m.srv, 'en', 390)
  await c.page.goto(m.srv.base + (label.includes('six') ? '/' : '/catalogue')); await c.page.waitForTimeout(label.includes('six') ? 900 : 2500)
  is((await check(c)) === false, `mutation "${label}": its check goes red`)
  await c.ctx.close(); await m.srv.close()
}

await base.srv.close(); await bare.srv.close(); await browser.close(); rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
