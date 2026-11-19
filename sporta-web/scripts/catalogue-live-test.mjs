// CATALOGUE V2 (CATALOGUE-V2.md, slice B): the /catalogue page and the engine against a FAKE `api.php?r=catalogue` (the new live route) on the REAL
// compiled storefront (the capture of the live client, scripts/lib/add-to-cart-ux-live.mjs) with this repo's add-ons on top.
//
//   npm run test:catalogue-live     (needs the live capture like the other real-app suites; says so and skips when it is absent)
//
// The fake route answers like the contract: { revision, generated_at, count, settings, categories, brands, products }, Cache-Control: no-cache, an ETag that is
// the revision, 304 on If-None-Match (also with the -gzip / W/ forms Apache's mod_deflate produces). Faults on request: 404, 500, a body that is not a catalogue.
// Everything else is the capture (so the app, its header and its other routes are real). Time is controlled with Playwright's clock for the 60 s poll.
//
// Asserted:
//   - SOURCE: the engine reads ONE route (catalogue) and never the three old ones; the result has the contract's shape (source 'catalogue', revision, settings,
//     categories and brands with counts, products with the contract's fields) and no SKU / quantity / cost; two readers at once share one request; a 404, a 500 and a
//     body that is not a catalogue each fall back to the three old routes (source 'legacy') and the page still shows every product;
//   - SETTINGS: title / intro / note per language reach the heading, the lead and the footnote (ar and en); each switch (prices, sizes, brand, sold out) removes
//     what it names from the cards AND the controls that would reveal it (price range, sale toggle, price sorts, brand chips, in-stock toggle) and an address that
//     asks for it is cleaned; per_page and the cover switch change the PDF (page counts), prices off removes the price badge pixels from the PDF;
//   - THE PAGE: category and brand chips with counts that follow the other filters (a faceted count), logo chips, the photo chain (a failing small copy falls back to
//     the original), srcset, search in Arabic and English (diacritics, ta marbuta, case, accents, two words), 320 / 390 / 768 / 1280 px in both languages (no sideways
//     scroll, 44 px targets, centred headings, right to left grid), dark theme contrast, no red anywhere, the icon set only (no emoji, aria-hidden svg);
//   - LIVE: 304 changes nothing (same nodes, "Updated just now"); a changed revision updates IN PLACE (unchanged cards are the very same nodes, the changed card is
//     replaced, a new one appears, a removed one goes, the scroll position and an unchanged card's place do not move, a polite announcement); a hidden tab sends nothing
//     and one request is made when it comes back; errors back off (60, 120, 240 ... s, capped) and a good answer resets it; offline sends nothing and says so; the
//     ETag goes back as the revision in If-None-Match (a -gzip or W/ ETag is stripped); a route that vanishes mid-session falls back without an error screen;
//   - A server-made CollectionPage in the head is not duplicated by the page's own;
//   - MUTATIONS: with the rule cut out of the engine the matching check goes red (the poll's If-None-Match, the hidden-tab guard, the back-off, the in-place update,
//     the legacy fallback, the settings switches, the faceted counts).
import { chromium } from 'playwright'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveLive, liveDir, PUB } from './lib/add-to-cart-ux-live.mjs'
import { genImages } from './lib/catalogue-fx.mjs'
import { png } from './lib/png.mjs'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const L = liveDir()
if (!L) { console.log('SKIP no live capture (set SPORTA_LIVE_CAPTURE)'); process.exit(0) }
if (spawnSync('pdfinfo', ['-v']).error) { console.log('SKIP poppler is not installed'); process.exit(0) }

const ENGINE = readFileSync(join(PUB, 'sporta-catalogue.js'), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const tmp = mkdtempSync(join(tmpdir(), 'sporta-catlive-'))
const gen = await browser.newPage(); const IMAGES = await genImages(gen); await gen.close()
const J = (f) => JSON.parse(readFileSync(join(L, 'api', f), 'utf8'))
const PHOTO = new Set(['cloudsoft-leggings-grey', 'sculpt-top-grey', 'sculpt-top-navy', 'sgomma-t-shirt-navy', 'tekno-shorts-black'])
const ORDER = ['men', 'women', 'outerwear', 'accessories']
const CATN = { men: ['Men', 'رجال'], women: ['Women', 'نساء'], outerwear: ['Hoodies & Jackets', 'هوديز وجواكيت'], accessories: ['Accessories', 'إكسسوارات'] }

// ------------------------------------------------------------------------------------------------------------------ the fake shop
const DEFAULT_SETTINGS = { title_ar: '', title_en: '', intro_ar: '', intro_en: '', note_ar: '', note_en: '', show_prices: true, show_sold_out: true, show_sizes: true, show_brand: true, cover: true, per_page: 9 }
let fake
const fresh = () => {
  const products = J('products.json'), stock = J('stock.json')
  const brandOf = (i) => (i < 4 ? 'vanquish' : i < 7 ? 'ahed' : '')
  const men = products.filter((p) => p.category === 'men')
  // two men on sale and pinned: they are always on the first men page of the PDF
  fake = { products, stock, settings: { ...DEFAULT_SETTINGS }, mode: 'ok', etagForm: 'plain', hits: [], routes: [], onSale: new Set([men[0].slug, men[1].slug]), pinned: new Set([men[0].slug, men[1].slug]), brandOf, hidden: new Set() }
}
const sizesOf = (slug) => fake.stock.filter((s) => s.slug === slug).map((s) => ({ size: s.size, in_stock: !!s.in_stock }))
function payload() {
  const prods = fake.products.filter((p) => !fake.hidden.has(p.slug)).map((p, i) => {
    const sizes = sizesOf(p.slug), sale = fake.onSale.has(p.slug), list = sale ? Math.round((p.price + 3) * 1000) / 1000 : p.price
    const orig = fake.products.indexOf(p), has = PHOTO.has(p.slug), soldOut = sizes.length > 0 && !sizes.some((s) => s.in_stock)
    return {
      slug: p.slug, name_ar: p.name_ar, name_en: p.name_en, category: p.category, brand: fake.brandOf(orig), price: p.price, list_price: list, pct_off: sale ? Math.round((1 - p.price / list) * 100) : 0, on_sale: sale,
      featured: !!p.featured, pinned: fake.pinned.has(p.slug), in_stock: !soldOut, sizes, image: has ? '/images/products/' + p.slug + '.jpg' : '', image_small: has && orig % 2 === 0 ? '/images/products/responsive/' + p.slug + '-640.webp' : '', images: has ? ['/images/products/' + p.slug + '.jpg'] : [],
    }
  }).filter((p) => fake.settings.show_sold_out || p.in_stock)
  prods.sort((a, b) => (b.pinned - a.pinned) || ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || (b.featured - a.featured) || (a.name_en < b.name_en ? -1 : 1))
  const cats = ORDER.map((c) => ({ slug: c, name_ar: CATN[c][1], name_en: CATN[c][0], count: prods.filter((p) => p.category === c).length })).filter((c) => c.count)
  const brands = [['vanquish', 'Vanquish', 'فانكويش'], ['ahed', 'AHED', 'أحد']].map(([s, en, ar]) => ({ slug: s, name_ar: ar, name_en: en, logo: `/api/api.php?r=brand_logo&slug=${s}&v=abc123def456`, count: prods.filter((p) => p.brand === s).length })).filter((b) => b.count)
  return { revision: '', generated_at: new Date().toISOString(), count: prods.length, settings: fake.settings, categories: cats, brands, products: prods }
}
const revOf = (p) => createHash('sha256').update(JSON.stringify({ ...p, generated_at: '' }).replace(/"revision":"[^"]*"/, '')).digest('hex').slice(0, 12)
const clean = (h) => String(h || '').replace(/^W\//, '').replace(/-gzip"?$/, '"').replace(/^"|"$/g, '')
const liveShop = await serveLive({})
const livePort = new URL(liveShop.base).port
const shop = await new Promise((ok) => {
  const server = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    if (u.pathname === '/api/api.php') {
      const route = u.searchParams.get('r') || ''; fake.routes.push(route)
      if (route === 'brand_logo') { r.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return r.end(readFileSync(join(PUB, 'favicon.png'))) }
      if (route === 'catalogue') {
        const hit = { inm: q.headers['if-none-match'] || '', status: 0, t: Date.now() }; fake.hits.push(hit)
        if (fake.mode === '404') { hit.status = 404; r.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return r.end('{"error":"not_found"}') }
        if (fake.mode === '429') { hit.status = 429; r.writeHead(429, { 'content-type': 'application/json', 'retry-after': '5' }); return r.end('{"error":"rate_limited"}') }
        if (fake.mode === '500') { hit.status = 500; r.writeHead(500, { 'content-type': 'application/json' }); return r.end('{"error":"server"}') }
        if (fake.mode === 'bad') { hit.status = 200; r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"nothing":true}') }
        const p = payload(); p.revision = revOf(p)
        const tag = fake.etagForm === 'gzip' ? `"${p.revision}-gzip"` : fake.etagForm === 'weak' ? `W/"${p.revision}"` : `"${p.revision}"`
        if (hit.inm && clean(hit.inm) === p.revision) { hit.status = 304; r.writeHead(304, { etag: tag, 'cache-control': 'no-cache' }); return r.end() }
        hit.status = 200; r.writeHead(200, { 'content-type': 'application/json', etag: tag, 'cache-control': 'no-cache' }); return r.end(JSON.stringify(p))
      }
    }
    const up = http.request({ host: '127.0.0.1', port: livePort, path: q.url, method: q.method, headers: q.headers }, (x) => { r.writeHead(x.statusCode, x.headers); x.pipe(r) })
    up.on('error', () => { r.writeHead(502); r.end() }); q.pipe(up)
  }).listen(0, '127.0.0.1', () => ok({ server, base: 'http://127.0.0.1:' + server.address().port }))
})
const BASE = shop.base

async function open(lang, w, path = '/catalogue', o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: o.h || 844 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) { /* ignore */ } }, lang)
  await ctx.route('**/images/products/**', (route) => {
    const m = /\/images\/products\/([^/]+)\.(jpg|png|webp|jpeg)$/.exec(new URL(route.request().url()).pathname)
    if (m && m[2] === 'jpg' && PHOTO.has(m[1])) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(IMAGES.jpg, 'base64') })
    return route.fulfill({ status: 404, body: 'nf' })
  })
  const page = await ctx.newPage(), errs = []
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource|500/.test(m.text())) errs.push(m.text()) })
  if (o.clock) { await page.clock.install(); await page.clock.resume() }
  await page.goto(BASE + path)
  if (!o.noWait) { await page.waitForSelector('.scat-card', { timeout: 20000 }); await page.waitForTimeout(250) }
  return { ctx, page, errs }
}
const urlsOf = (file) => String(spawnSync('pdfinfo', ['-url', file], { encoding: 'utf8' }).stdout).split('\n').map((l) => /^\s*(\d+)\s+Annotation\s+(\S+)/.exec(l)).filter(Boolean).map((m) => m[2])
const pdfPages = (file) => { const o = spawnSync('pdfinfo', [file], { encoding: 'utf8' }); const m = /Pages:\s+(\d+)/.exec(String(o.stdout)); return m ? +m[1] : 0 }
const slugs = (page) => page.evaluate(() => [...document.querySelectorAll('.scat-card')].map((n) => n.getAttribute('data-slug')))
const orange = (file, pageNo) => {
  const pre = join(tmp, 'o' + Math.random().toString(36).slice(2, 7))
  spawnSync('pdftoppm', ['-r', '150', '-png', '-f', String(pageNo), '-l', String(pageNo), file, pre])
  const f = spawnSync('ls', [tmp], { encoding: 'utf8' }).stdout.split('\n').find((x) => x.startsWith(pre.split('/').pop()) && x.endsWith('.png'))
  const im = png(readFileSync(join(tmp, f))); let n = 0
  for (let y = 180; y < 1600; y += 2) for (let x = 40; x < 1200; x += 2) { const c = im.at(x, y); if (Math.abs(c.r - 255) + Math.abs(c.g - 123) + Math.abs(c.b - 23) < 40) n++ }
  return n
}
const rd = async (page) => page.evaluate(async () => { const r = await window.SportaCatalogue.load({ force: true }); return JSON.parse(JSON.stringify({ source: r.source, revision: r.revision, settings: r.settings, cats: r.categories, brands: r.brands, n: r.products.length, first: r.products[0], keys: Object.keys(r.products[0]) })) })

// ===================================================================================================================== the source
head('the engine reads the catalogue route')
fresh()
{
  const c = await open('en', 1280)
  const before = fake.routes.length
  const R = await rd(c.page), after = fake.routes.slice(before)
  is(eq(after, ['catalogue']), 'load() makes ONE request: r=catalogue (not products, stock, brands)', after.join(','))
  is(R.source === 'catalogue' && /^[0-9a-f]{12}$/.test(R.revision) && R.n === 46 && eq(R.settings, DEFAULT_SETTINGS), 'the result: source catalogue, a 12-hex revision, 46 products, the settings', JSON.stringify([R.source, R.revision, R.n]))
  is(R.cats.map((x) => x.slug + ':' + x.count).join() === ORDER.map((k) => k + ':' + J('products.json').filter((p) => p.category === k).length).join() && R.brands.map((b) => b.slug + ':' + b.count).join() === 'vanquish:4,ahed:3', 'categories (in the server order) and brands with their counts', JSON.stringify([R.cats.map((x) => x.slug + ':' + x.count), R.brands.map((b) => b.slug + ':' + b.count)]))
  const CONTRACT = ['slug', 'name_ar', 'name_en', 'category', 'brand', 'price', 'list_price', 'pct_off', 'on_sale', 'featured', 'pinned', 'in_stock', 'sizes', 'image', 'image_small', 'images']
  is(CONTRACT.every((k) => R.keys.includes(k)) && !/SKU|"sku"|"stock"|cost|quantity/i.test(JSON.stringify(R.first)), 'a product carries the contract fields and no SKU, quantity or cost')
  const two = await c.page.evaluate(async () => { const a = window.SportaCatalogue.load(), b = window.SportaCatalogue.load(); const x = await Promise.all([a, b]); return x[0] === x[1] || x[0].revision === x[1].revision })
  is(two, 'two readers at once get the same answer')
  const n0 = fake.routes.length
  await c.page.evaluate(() => Promise.all([window.SportaCatalogue.load(), window.SportaCatalogue.load()]))
  is(fake.routes.slice(n0).filter((r) => r === 'catalogue').length === 1, 'two readers at the same moment share ONE request')
  is(c.errs.length === 0, 'no page errors', c.errs.join(' | '))
  await c.ctx.close()
}
for (const [mode, label] of [['404', 'an older API (404)'], ['bad', 'a body that is not a catalogue']]) {
  fresh(); fake.mode = mode
  const c = await open('en', 1280)
  const R = await rd(c.page), n = (await slugs(c.page)).length
  is(R.source === 'legacy' && R.n === 46 && n === 46 && R.revision.length === 12, `${label}: the engine falls back to the three old routes (source legacy), the page still shows all 46`, JSON.stringify([R.source, R.n, n]))
  is(fake.routes.includes('products') && fake.routes.includes('stock') && fake.routes.includes('brands'), `${label}: products, stock and brands were read`)
  await c.ctx.close()
}

// C3 (review 2026-11-19): a transient 429 / 500 on the route is NOT "an older API". Falling back would show the products the owner hid, in the wrong order, with the
// default settings, and nothing would say so. The engine rejects, the page shows its retry state and reads nothing from the three old routes.
const withEngine = (text) => new Promise((ok) => {
  const server = http.createServer((q, r) => {
    if (new URL(q.url, 'http://x').pathname === '/sporta-catalogue.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(text) }
    const up = http.request({ host: '127.0.0.1', port: new URL(BASE).port, path: q.url, method: q.method, headers: q.headers }, (x) => { r.writeHead(x.statusCode, x.headers); x.pipe(r) })
    up.on('error', () => { r.writeHead(502); r.end() }); q.pipe(up)
  }).listen(0, '127.0.0.1', () => ok({ server, base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((d) => server.close(d)) }))
})
async function openOn(base, lang, w, path, pollMs) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, acceptDownloads: true })
  await ctx.addInitScript(([l, ms]) => { try { localStorage.setItem('lang', l) } catch (e) { /* ignore */ } if (ms) window.__sportaCataloguePollMs = ms }, [lang, pollMs || 0])
  await ctx.route('**/images/products/**', (route) => route.fulfill({ status: 404, body: 'nf' }))
  const page = await ctx.newPage(); await page.goto(base + path)
  return { ctx, page }
}
const errState = (page) => page.evaluate(() => ({ cards: document.querySelectorAll('.scat-card').length, retry: !!document.querySelector('[data-scat="body"] .btn-primary'), text: (document.querySelector('[data-scat="body"]') || {}).textContent || '' }))
head('C3: a 429 or a 500 is an error state, not the old routes')
for (const mode of ['500', '429']) {
  fresh(); fake.mode = mode
  const c = await open('en', 1280, '/catalogue', { noWait: true }); await c.page.waitForTimeout(1500)
  const E = await errState(c.page)
  const R = await c.page.evaluate(() => window.SportaCatalogue.load({ force: true }).then(() => 'resolved', (e) => 'rejected ' + (e && e.http)))
  is(E.cards === 0 && E.retry && /could not be loaded/i.test(E.text) && /^rejected/.test(R), `HTTP ${mode} on the route: load() rejects and the page shows its retry state (no products from nowhere)`, JSON.stringify([E.cards, E.retry, R]))
  is(!fake.routes.some((r) => r === 'products' || r === 'stock' || r === 'brands'), `HTTP ${mode} on the route: the three old routes are never read`, fake.routes.join(','))
  fake.mode = 'ok'; await c.page.click('[data-scat="body"] .btn-primary'); await c.page.waitForSelector('.scat-card', { timeout: 15000 })
  is((await slugs(c.page)).length === 46, `HTTP ${mode}: Retry brings the real catalogue back`)
  await c.ctx.close()
}
{
  const m = await withEngine(ENGINE.replace("if (e && (e.http === 404 || e.bad)) return loadLegacy(); throw e", 'return loadLegacy()'))
  fresh(); fake.mode = '500'
  const c = await openOn(m.base, 'en', 1280, '/catalogue'); await c.page.waitForSelector('.scat-card', { timeout: 15000 }).catch(() => {})
  is(fake.routes.includes('products') && (await slugs(c.page)).length === 46, 'C3 mutation: with the fallback on any error the page shows the legacy list on a 500 (so the check above is not vacuous)')
  fake.mode = 'ok'; await c.ctx.close(); await m.close()
}

// C6 (review 2026-11-19): a /catalogue?pdf=en link whose first read failed starts its download when the page recovers by itself (the poll), not only on Retry.
head('C6: the live PDF link recovers by itself')
{
  const run = async (engineText) => {
    fresh(); fake.mode = '500'
    const m = engineText ? await withEngine(engineText) : null
    const c = await openOn(m ? m.base : BASE, 'en', 1280, '/catalogue?pdf=en', 500)
    await c.page.waitForTimeout(1200)
    const before = await errState(c.page)
    const w = c.page.waitForEvent('download', { timeout: 12000 }).then((d) => d.suggestedFilename(), () => '')
    fake.mode = 'ok'
    const name = await w
    await c.page.waitForSelector('.scat-card', { timeout: 15000 }).catch(() => {})
    await c.ctx.close(); if (m) await m.close()
    return { before, name }
  }
  const R = await run(null)
  is(R.before.cards === 0 && R.before.retry && /^Sporta-Catalogue-EN-.*\.pdf$/.test(R.name), 'the first read fails (error state), the poll recovers the page and the promised PDF downloads without a click', JSON.stringify(R))
  const M = await run(ENGINE.replace('if (!wasReady) autoStart()', ''))
  is(M.name === '', 'C6 mutation: without the call from apply() the recovered page never downloads', M.name)
}

// ==================================================================================================================== the settings
head('the owner\'s copy and switches reach the page')
for (const [lang, w] of [['en', 1280], ['ar', 390]]) {
  fresh(); Object.assign(fake.settings, { title_en: 'Spring Edit', title_ar: 'مختارات الربيع', intro_en: 'Picked for the new season.', intro_ar: 'اختيارنا للموسم الجديد.', note_en: 'Prices can change.', note_ar: 'الأسعار قابلة للتغيير.' })
  const c = await open(lang, w)
  const F = await c.page.evaluate(() => ({ h1: document.querySelector('#sporta-catalogue h1').textContent, lead: document.querySelector('.page-lead').textContent, foot: document.querySelector('[data-scat="footnote"]').textContent, hid: document.querySelector('[data-scat="footnote"]').hidden }))
  is(F.h1 === (lang === 'ar' ? 'مختارات الربيع' : 'Spring Edit') && F.lead === (lang === 'ar' ? 'اختيارنا للموسم الجديد.' : 'Picked for the new season.') && F.foot === (lang === 'ar' ? 'الأسعار قابلة للتغيير.' : 'Prices can change.') && !F.hid, `${lang}: the settings' title, intro and note are the heading, the lead and the footnote`, JSON.stringify(F))
  await c.ctx.close()
}
{
  fresh()
  const c = await open('en', 1280)
  const F = await c.page.evaluate(() => ({ foot: document.querySelector('[data-scat="footnote"]').hidden, h1: document.querySelector('#sporta-catalogue h1').textContent }))
  is(F.foot && F.h1 === 'Sporta product catalogue', 'with no copy set the defaults stay and there is no footnote')
  await c.ctx.close()
}
{
  fresh(); fake.settings.show_prices = false
  const c = await open('en', 1280, '/catalogue?sale=1&min=5&sort=price_asc&q=a')
  const F = await c.page.evaluate(() => ({
    price: document.querySelectorAll('.scat-price,.scat-was,.scat-badge').length, vis: (s) => 0,
    sale: !document.querySelector('[data-scat="sale"]').offsetParent, min: !document.querySelector('[data-scat="min"]').offsetParent, max: !document.querySelector('[data-scat="max"]').offsetParent,
    sorts: [...document.querySelectorAll('[data-scat="sort"] option')].map((o) => o.value), search: location.search, cards: document.querySelectorAll('.scat-card').length, text: document.querySelector('[data-scat="body"]').innerText,
  }))
  is(F.price === 0 && !/KWD|\d\.\d{3}|% off/.test(F.text), 'show_prices off: no price, no struck price, no percent badge on any card', JSON.stringify([F.price, F.text.slice(0, 80)]))
  is(F.sale && F.min && F.max && eq(F.sorts, ['featured', 'name']), 'show_prices off: the sale toggle, the price range and the price sorts are gone', JSON.stringify([F.sale, F.min, F.max, F.sorts]))
  is(!/sale=|min=|sort=price/.test(F.search) && /q=a/.test(F.search), 'show_prices off: an address asking for sale / price / price sort is cleaned (the search stays)', F.search)
  await c.ctx.close()
}
{
  fresh(); fake.settings.show_sizes = false; fake.settings.show_brand = false
  const c = await open('en', 1280, '/catalogue?brand=vanquish')
  const F = await c.page.evaluate(() => ({ sizes: document.querySelectorAll('.scat-sizes').length, brand: document.querySelectorAll('.scat-brand').length, box: !document.querySelector('[data-scat="brands"]').offsetParent, cards: document.querySelectorAll('.scat-card').length, search: location.search }))
  is(F.sizes === 0 && F.brand === 0 && F.box && F.cards === 46 && !/brand=/.test(F.search), 'show_sizes and show_brand off: no sizes line, no brand label, no brand chips, a brand in the address is dropped', JSON.stringify(F))
  await c.ctx.close()
}
{
  fresh(); fake.settings.show_sold_out = false
  const soldOutSlug = fake.products.find((p) => { const s = sizesOf(p.slug); return s.length && !s.some((x) => x.in_stock) })
  const c = await open('en', 1280, '/catalogue?stock=1')
  const F = await c.page.evaluate(() => ({ band: document.querySelectorAll('.scat-sold').length, toggle: !document.querySelector('[data-scat="stock"]').offsetParent, search: location.search, n: document.querySelectorAll('.scat-card').length }))
  is(soldOutSlug && F.band === 0 && F.toggle && !/stock=/.test(F.search) && F.n === fake.products.length - fake.products.filter((p) => { const s = sizesOf(p.slug); return s.length && !s.some((x) => x.in_stock) }).length, 'show_sold_out off: sold-out products are not on the page, the in-stock toggle is gone', JSON.stringify(F))
  await c.ctx.close()
}

// ====================================================================================================================== the page
head('chips, counts, photos, search')
{
  fresh()
  const c = await open('en', 1280)
  const P = fake.products
  const chips = await c.page.evaluate(() => [...document.querySelectorAll('[data-scat-cat]')].map((b) => b.getAttribute('data-scat-cat') + '=' + b.textContent))
  is(eq(chips, ['all=All (46)', ...ORDER.map((k) => `${k}=${CATN[k][0]} (${P.filter((p) => p.category === k).length})`)]), 'category chips in the server order with their counts', chips.join(' | '))
  const bchips = await c.page.evaluate(() => [...document.querySelectorAll('[data-scat-brand]')].map((b) => ({ k: b.getAttribute('data-scat-brand'), label: b.getAttribute('aria-label'), img: b.querySelector('img') ? b.querySelector('img').getAttribute('src') : '', text: b.textContent })))
  is(bchips.length === 3 && bchips[1].k === 'vanquish' && /^\/api\/api\.php\?r=brand_logo&slug=vanquish/.test(bchips[1].img) && bchips[1].label === 'Vanquish (4)' && bchips[1].text === '(4)', 'brand chips show the logo (its name is the accessible label) and the count', JSON.stringify(bchips))
  await c.page.click('[data-scat-brand="vanquish"]')
  const f1 = await c.page.evaluate(() => ({ n: document.querySelectorAll('.scat-card').length, cats: [...document.querySelectorAll('[data-scat-cat]')].map((b) => b.textContent + (b.disabled ? '!' : '')), search: location.search }))
  is(f1.n === 4 && f1.search === '?brand=vanquish' && /^All \(4\)/.test(f1.cats[0]) && f1.cats.some((t) => /!$/.test(t)), 'a brand chip filters (4 products), the address says so, the category counts follow it and an empty category is disabled', JSON.stringify(f1))
  await c.page.click('[data-scat-brand="all"]'); await c.page.click('[data-scat-cat="women"]')
  const f2 = await c.page.evaluate(() => [...document.querySelectorAll('[data-scat-brand]')].map((b) => b.getAttribute('aria-label')))
  is(f2[0] === 'All (' + P.filter((p) => p.category === 'women').length + ')', 'brand counts follow the category too', f2.join())
  await c.page.click('[data-scat-cat="all"]')
  // photos: a product whose small copy fails falls back to the original; srcset present only with both
  const ph = await c.page.evaluate(() => [...document.querySelectorAll('.scat-card')].map((n) => { const im = n.querySelector('img'); return { s: n.getAttribute('data-slug'), src: im.getAttribute('src'), set: im.getAttribute('srcset'), done: im.complete && im.naturalWidth > 0, cur: im.currentSrc } }))
  await c.page.evaluate(async () => { for (const n of document.querySelectorAll('.scat-card')) { n.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 45)) } scrollTo(0, 0) }); await c.page.waitForTimeout(900)
  const phs = await c.page.evaluate(() => [...document.querySelectorAll('.scat-card')].map((n) => { const im = n.querySelector('img'); return { s: n.getAttribute('data-slug'), cur: im.currentSrc, ok: im.complete && im.naturalWidth > 0 } }))
  const withSmall = ph.filter((x) => x.set)
  is(withSmall.length > 0 && withSmall.every((x) => /-640\.webp 640w, \/images\/products\/[^ ]+\.jpg 1200w/.test(x.set)), 'a product with a small copy and an original gets a srcset (640w, 1200w)', JSON.stringify(withSmall[0]))
  const fell = phs.filter((x) => PHOTO.has(x.s) && x.ok && /\.jpg$/.test(x.cur))
  is(fell.length === 5, 'a photo whose small copy is missing (404) falls back to the original and shows it (5 photos)', JSON.stringify(phs.filter((x) => PHOTO.has(x.s))))
  is(phs.filter((x) => !PHOTO.has(x.s)).every((x) => /product-photo-unavailable\.svg$/.test(x.cur)), 'a product with no photo shows the shop’s own plate')
  // search
  const find = async (q) => { await c.page.fill('[data-scat="search"]', q); return (await slugs(c.page)).length }
  const cag = P.filter((p) => /cagliari/i.test(p.name_en)).length
  is((await find('CAGLIARI')) === cag && cag > 2 && (await find('Cägliari')) === cag && (await find(' cagliari  ')) === cag, 'search is case, accent and space insensitive', String(cag))
  const bp = P.filter((p) => /backpack/i.test(p.name_en) && /cagliari/i.test(p.name_en)).length
  is((await find('backpack cagliari')) === bp && bp >= 1 && (await find('cagliari zzz')) === 0, 'two words must both match', String(bp))
  const ar = P.find((p) => /حقيبة/.test(p.name_ar)).name_ar
  const nAr = P.filter((p) => /حقيبة/.test(p.name_ar)).length
  is((await find('حقيبة')) === nAr && (await find('حَقِيبَة')) === nAr && (await find('حقيبه')) === nAr && (await find('ظهر كالياري')) >= 1, 'Arabic search: with diacritics (حَقِيبَة), with ta marbuta written as ha (حقيبه), two words', ar)
  const brandSet = P.filter((p, i) => i < 4).map((p) => p.slug), byNameEn = P.filter((p) => /vanquish/i.test(p.name_en)).map((p) => p.slug), byNameAr = P.filter((p) => /فانكويش/.test(p.name_ar)).map((p) => p.slug)
  await find('vanquish'); const sEn = await slugs(c.page); await find('فانكويش'); const sAr = await slugs(c.page)
  is(eq(sEn.slice().sort(), [...new Set([...brandSet, ...byNameEn])].sort()) && eq(sAr.slice().sort(), [...new Set([...brandSet, ...byNameAr])].sort()), 'a brand name finds the brand\u2019s four products (and any product that says it in its name), in English and in Arabic', sEn.length + ' ' + sAr.length)
  await c.ctx.close()
}

head('every width, both languages')
for (const lang of ['en', 'ar']) {
  for (const w of [320, 390, 768, 1280]) {
    fresh(); const c = await open(lang, w)
    const F = await c.page.evaluate(() => {
      const vis = (e) => e.getClientRects().length > 0
      const ctl = [...document.querySelectorAll('#sporta-catalogue button, #sporta-catalogue input, #sporta-catalogue select, #sporta-catalogue a.btn')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.height), Math.round(r.width)] })
      const h1 = document.querySelector('#sporta-catalogue h1'), name = document.querySelector('.scat-name'), cs = getComputedStyle(h1)
      const cards = [...document.querySelectorAll('.scat-card')].slice(0, 2).map((n) => n.getBoundingClientRect())
      const bad = []
      const red = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); if (!m) return false; const [r, g, b] = [+m[1], +m[2], +m[3]]; return r > 180 && g < 90 && b < 110 }
      for (const e of document.querySelectorAll('#sporta-catalogue *')) { const s = getComputedStyle(e); for (const k of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor']) if (red(s[k])) bad.push(e.className + ':' + k + ':' + s[k]) }
      const svgs = [...document.querySelectorAll('#sporta-catalogue svg')]
      const emoji = /\p{Extended_Pictographic}/u.test(document.querySelector('#sporta-catalogue').textContent)
      return {
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: ctl.filter((x) => x[0] < 44 || x[1] < 44).length, n: ctl.length, align: cs.textAlign, nameAlign: getComputedStyle(name).textAlign, dir: document.documentElement.dir,
        rtl: cards.length === 2 ? (cards[0].top === cards[1].top ? cards[0].left > cards[1].left : null) : null, red: bad.slice(0, 3), svgs: svgs.length, svgBad: svgs.filter((s) => s.getAttribute('aria-hidden') !== 'true' || s.getAttribute('stroke-width') !== '1.75').length, emoji,
        h1x: Math.round((h1.getBoundingClientRect().left + h1.getBoundingClientRect().right) / 2), vw: document.documentElement.clientWidth,
      }
    })
    const tag = `${lang} ${w}px`
    is(F.scroll <= 0, `${tag}: no sideways scroll`, String(F.scroll))
    is(F.small === 0 && F.n >= 40, `${tag}: every visible control is at least 44 x 44 px`, `${F.small} of ${F.n}`)
    is(F.align === 'center' && F.nameAlign === 'center' && Math.abs(F.h1x - F.vw / 2) <= 24, `${tag}: the heading and the product names are centred`, JSON.stringify([F.align, F.nameAlign, F.h1x, F.vw]))
    is(F.dir === (lang === 'ar' ? 'rtl' : 'ltr') && F.rtl === (lang === 'ar'), `${tag}: ${lang === 'ar' ? 'the grid starts at the right' : 'the grid starts at the left'}`, JSON.stringify([F.dir, F.rtl]))
    is(F.red.length === 0, `${tag}: no red anywhere (the shop is one orange and black)`, F.red.join(' | '))
    is(F.svgs >= 8 && F.svgBad === 0 && !F.emoji, `${tag}: the icons are the line set (aria-hidden, 1.75 stroke) and there is no emoji`, JSON.stringify([F.svgs, F.svgBad, F.emoji]))
    is(c.errs.length === 0, `${tag}: no page errors`, c.errs.join(' | '))
    await c.ctx.close()
  }
}
{
  fresh(); const c = await open('en', 390)
  await c.page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.setAttribute('data-theme', 'dark') }); await c.page.waitForTimeout(300)
  const F = await c.page.evaluate(() => {
    const lum = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(c); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]) }
    const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor, m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(c); if (m && (m[4] === undefined || +m[4] > 0.5)) return c } return 'rgb(255, 255, 255)' }
    const ratio = (e) => { const a = lum(getComputedStyle(e).color), b = lum(bgOf(e)), hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05) }
    const pick = (s) => document.querySelector(s)
    return { h1: ratio(pick('#sporta-catalogue h1')), lead: ratio(pick('.page-lead')), count: ratio(pick('[data-scat="count"]')), cap: ratio(pick('.scat-field span')), chip: ratio(pick('.scat-chip')), name: ratio(pick('.scat-name')), now: ratio(pick('.scat-now')), status: ratio(pick('.scat-status')) }
  })
  is(Object.values(F).every((v) => v >= 4.5), 'dark theme: the heading, lead, status, count, labels, chips, names and prices all reach 4.5:1', JSON.stringify(F))
  await c.page.focus('[data-scat-cat="men"]'); await c.page.keyboard.press('Tab'); await c.page.keyboard.press('Shift+Tab')
  is(await c.page.evaluate(() => /255, 123, 23/.test(getComputedStyle(document.activeElement).outlineColor)), 'dark theme: the focus ring is the logo orange')
  await c.ctx.close()
}

// ========================================================================================================================== live
head('live: the revision poll')
{
  fresh()
  const c = await open('en', 1280, '/catalogue', { clock: true })
  const mark = () => c.page.evaluate(() => document.querySelectorAll('.scat-card').forEach((n, i) => { n.__m = i + 1 }))
  const state = () => c.page.evaluate(() => ({ cards: [...document.querySelectorAll('.scat-card')].map((n) => [n.getAttribute('data-slug'), n.__m || 0]), status: document.querySelector('.scat-status').textContent, live: document.querySelector('[data-scat="live"]').textContent }))
  const step = async (ms) => { await c.page.clock.runFor(ms); await c.page.waitForTimeout(350) }
  await mark()
  const rev0 = (await rd(c.page)).revision
  fake.hits.length = 0
  // 1. 304
  await step(61000)
  const h1 = fake.hits[fake.hits.length - 1]
  const s1 = await state()
  is(fake.hits.length === 1 && h1.inm === `"${rev0}"` && h1.status === 304, 'after 60 s the page asks again with If-None-Match: "<revision>" and is answered 304', JSON.stringify(fake.hits))
  is(s1.cards.length === 46 && s1.cards.every((x) => x[1] > 0), '304: no card was touched (the very same nodes)')
  is(/Updated just now/.test(s1.status), '304: the "updated" stamp reads just now (the data was confirmed current)', s1.status)
  // 2. a change: price, a sale starts, a new product at the end, one dropped at the end
  const P = fake.products, A = P[0], B = P[5], dropped = P[P.length - 1], last = P[P.length - 2]
  await c.page.evaluate(() => window.scrollTo(0, 700)); await c.page.waitForTimeout(200)
  const anchor = await c.page.evaluate(() => { const cs = [...document.querySelectorAll('.scat-card')].map((n) => ({ s: n.getAttribute('data-slug'), t: n.getBoundingClientRect().top })).filter((x) => x.t > 80 && x.t < 500); return cs[cs.length - 1] })
  const sy0 = await c.page.evaluate(() => scrollY)
  const keep = (await state()).cards.filter((x) => ![A.slug, B.slug, dropped.slug].includes(x[0]))
  A.price = Math.round((A.price + 1.5) * 1000) / 1000; fake.onSale.add(B.slug); fake.hidden.add(dropped.slug)
  P.push({ ...last, slug: 'brand-new-product', name_en: 'Zzz Brand New Product', name_ar: 'منتج جديد', category: 'accessories', price: 2.5, featured: false })
  fake.stock.push({ slug: 'brand-new-product', size: 'M', sku: 'X', stock: 5, in_stock: true })
  fake.hits.length = 0
  await step(61000)
  await c.page.waitForFunction(() => document.querySelector('[data-slug="brand-new-product"]'), null, { timeout: 8000 })
  const s2 = await state(), h2 = fake.hits[0]
  is(h2.status === 200 && h2.inm.length > 0, 'a changed revision answers 200 to the conditional request', JSON.stringify(h2))
  const byS = Object.fromEntries(s2.cards)
  is(keep.every((x) => byS[x[0]] === x[1]), 'in place: every unchanged card is the very same node (no flash of everything)', String(keep.filter((x) => byS[x[0]] !== x[1]).length))
  is(byS[A.slug] === 0 && byS[B.slug] === 0 && byS['brand-new-product'] === 0 && !(dropped.slug in byS), 'the changed cards are new nodes, the new product is there, the dropped one is gone', JSON.stringify([byS[A.slug], byS[B.slug], dropped.slug in byS]))
  const shown = await c.page.evaluate(([a, b]) => ({ a: document.querySelector(`[data-slug="${a}"] .scat-now`).textContent, b: !!document.querySelector(`[data-slug="${b}"] .scat-badge`) }), [A.slug, B.slug])
  is(shown.a.includes(A.price.toFixed(3)) && shown.b, 'the new price and the new sale badge show', JSON.stringify(shown))
  const after = await c.page.evaluate((s) => ({ sy: scrollY, t: document.querySelector(`[data-slug="${s}"]`).getBoundingClientRect().top }), anchor.s)
  is(after.sy === sy0 && Math.abs(after.t - anchor.t) <= 1, 'no scroll jump: the scroll position and an unchanged card’s place are the same', JSON.stringify([sy0, after.sy, anchor.t, after.t]))
  is(/updated/i.test(s2.live) && /Updated just now/.test(s2.status), 'the change is announced politely ("The catalogue was updated.") and the stamp refreshed', s2.live + ' / ' + s2.status)
  // 3. a hidden tab sends nothing; coming back sends one request
  await c.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }) })
  fake.hits.length = 0
  await step(400000)
  is(fake.hits.length === 0, 'a hidden tab sends no request (400 s passed)', String(fake.hits.length))
  await c.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }); await c.page.waitForTimeout(500)
  is(fake.hits.length === 1 && fake.hits[0].status === 304, 'coming back to the tab asks once, at once', JSON.stringify(fake.hits))
  // 4. errors back off, a good answer resets
  fake.mode = '500'; fake.hits.length = 0
  const hits = []
  await step(61000); hits.push(fake.hits.length)       // t=61  -> request 1, next in 120 s (t=181)
  await step(100000); hits.push(fake.hits.length)      // t=161 -> none
  await step(25000); hits.push(fake.hits.length)       // t=186 -> request 2, next in 240 s (t=426)
  await step(200000); hits.push(fake.hits.length)      // t=386 -> none
  await step(45000); hits.push(fake.hits.length)       // t=431 -> request 3, next in 480 s
  is(eq(hits, [1, 1, 2, 2, 3]), 'on errors the poll backs off: 60 s, then 120 s, then 240 s', JSON.stringify(hits))
  is((await state()).cards.length > 40 && !(await c.page.evaluate(() => /could not be loaded/.test(document.querySelector('[data-scat="body"]').textContent))), '...and the page keeps showing the last list (no error screen)')
  fake.mode = 'ok'
  await step(481000); const n4 = fake.hits.length
  await step(61000)
  is(fake.hits.length === n4 + 1, 'after a good answer the interval is 60 s again', `${n4} -> ${fake.hits.length}`)
  // 5. offline
  await c.ctx.setOffline(true); const n5 = fake.hits.length
  await step(61000)
  const off = await c.page.evaluate(() => document.querySelector('[data-scat="note"]').textContent)
  is(fake.hits.length === n5 && /offline/i.test(off), 'offline: no request is sent and the page says it shows the last update', off)
  await c.ctx.setOffline(false); await c.page.waitForTimeout(700)
  is(fake.hits.length > n5 && !/offline/i.test(await c.page.evaluate(() => document.querySelector('[data-scat="note"]').textContent)), 'coming back online asks at once and clears the sentence')
  // 6. the route vanishes mid-session: legacy, no error screen
  fake.mode = '404'; const r6 = fake.routes.length
  await step(600000)
  const s6 = await state()
  is(s6.cards.length >= 40 && fake.routes.slice(r6).includes('products') && c.errs.length === 0, 'the route disappearing mid-session (404) falls back to the three routes without an error screen or a script error', JSON.stringify([s6.cards.length, c.errs]))
  await c.ctx.close()
}
for (const form of ['gzip', 'weak']) {
  fresh(); fake.etagForm = form
  const c = await open('en', 1280, '/catalogue', { clock: true })
  fake.hits.length = 0
  const rev = (await rd(c.page)).revision; fake.hits.length = 0
  await c.page.clock.runFor(61000); await c.page.waitForTimeout(350)
  is(fake.hits.length === 1 && fake.hits[0].inm === `"${rev}"` && fake.hits[0].status === 304, `an ETag in the ${form === 'gzip' ? 'mod_deflate "-gzip"' : 'weak W/'} form is sent back as the plain revision and still gets a 304`, JSON.stringify(fake.hits))
  await c.ctx.close()
}

head('a CollectionPage from the server is not duplicated')
{
  fresh()
  const c = await open('en', 1280, '/catalogue', { noWait: true })
  await c.page.waitForSelector('.scat-card')
  is(await c.page.evaluate(() => document.querySelectorAll('script[data-sporta-catalogue-ld]').length) === 1, 'with no CollectionPage in the head the page adds its own (one)')
  await c.ctx.close()
  const d = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await d.route('**/catalogue', async (route) => {
    const resp = await route.fetch(); let body = await resp.text()
    body = body.replace('</head>', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"server"}</script></head>')
    route.fulfill({ response: resp, body })
  })
  const pg = await d.newPage(); await pg.goto(BASE + '/catalogue'); await pg.waitForSelector('.scat-card'); await pg.waitForTimeout(300)
  is(await pg.evaluate(() => ({ mine: document.querySelectorAll('script[data-sporta-catalogue-ld]').length, all: document.querySelectorAll('script[type="application/ld+json"]').length })).then((x) => x.mine === 0 && x.all >= 1), 'when the server already put a CollectionPage in the head the page adds none')
  await d.close()
}

head('the PDF follows the settings')
{
  const dl = async (c, sel = '[data-scat="dl"]') => { const w = c.page.waitForEvent('download', { timeout: 60000 }); await c.page.click(sel); const d = await w; const f = join(tmp, 'p' + Math.random().toString(36).slice(2, 6) + '.pdf'); await d.saveAs(f); return { f, name: d.suggestedFilename() } }
  fresh()
  const c1 = await open('en', 1280); const a = await dl(c1); const onO = orange(a.f, 2)
  is(pdfPages(a.f) === 9 && urlsOf(a.f).filter((u) => /\/product\//.test(u)).length === 46, 'default settings: cover + 8 pages of nine for 46 products, a link each', String(pdfPages(a.f)))
  await c1.ctx.close()
  fresh(); fake.settings.per_page = 12
  const c2 = await open('en', 1280); const b = await dl(c2)
  is(pdfPages(b.f) === 6, 'per_page 12: cover + 5 pages (men 1, women 2, hoodies 1, accessories 1)', String(pdfPages(b.f)))
  await c2.ctx.close()
  fresh(); fake.settings.per_page = 12; fake.settings.cover = false
  const c3 = await open('en', 1280); const d3 = await dl(c3)
  is(pdfPages(d3.f) === 5, 'cover off: the five content pages only', String(pdfPages(d3.f)))
  await c3.ctx.close()
  fresh(); fake.settings.show_prices = false
  const c4 = await open('en', 1280); const e = await dl(c4); const offO = orange(e.f, 2)
  is(onO > 150 && offO === 0, 'show_prices off: the PDF has no price badge at all (orange pixels in the cards: ' + onO + ' with prices, ' + offO + ' without)')
  await c4.ctx.close()
  fresh(); fake.settings.show_sold_out = false
  const c5 = await open('en', 1280); const g = await dl(c5)
  is(urlsOf(g.f).filter((u) => /\/product\//.test(u)).length === fake.products.length - fake.products.filter((p) => { const s = sizesOf(p.slug); return s.length && !s.some((x) => x.in_stock) }).length, 'show_sold_out off: no sold-out product in the PDF')
  await c5.ctx.close()
}

// =================================================================================================================== mutations
head('mutations: the engine with one rule cut')
const MUTANTS = [
  ['the conditional request is not sent', ENGINE.replace("if (etag) headers['If-None-Match'] = '\"' + etag + '\"'", ''), async (c) => { fake.hits.length = 0; await c.page.clock.runFor(61000); await c.page.waitForTimeout(400); return fake.hits.length === 1 && fake.hits[0].status === 304 }],
  ['a hidden tab still polls', ENGINE.replace("if (document.hidden) { schedule(); return }            // a hidden tab sends nothing", ''), async (c) => { await c.page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true })); fake.hits.length = 0; await c.page.clock.runFor(130000); await c.page.waitForTimeout(400); return fake.hits.length === 0 }],
  ['no back-off', ENGINE.replace('Math.min(pollMs() * Math.pow(2, failures), POLL_MAX)', 'pollMs()'), async (c) => { fake.mode = '500'; fake.hits.length = 0; await c.page.clock.runFor(61000); await c.page.waitForTimeout(300); await c.page.clock.runFor(100000); await c.page.waitForTimeout(300); fake.mode = 'ok'; return fake.hits.length === 1 }],
  ['every card is redrawn on an update', ENGINE.replace('if (n && n._sig === sig) delete have[p.slug]', 'if (false) delete have[p.slug]'), async (c) => { await c.page.evaluate(() => document.querySelectorAll('.scat-card').forEach((n) => { n.__m = 1 })); fake.products[0].price += 1; await c.page.clock.runFor(61000); await c.page.waitForTimeout(500); fake.products[0].price -= 1; return await c.page.evaluate(() => [...document.querySelectorAll('.scat-card')].filter((n) => n.__m !== 1).length === 1) }],
  ['no fallback to the old routes', ENGINE.replace('.then(null, function (e) { if (e && (e.http === 404 || e.bad)) return loadLegacy(); throw e })', ''), async (c) => { fake.mode = '404'; const n = await c.page.evaluate(() => window.SportaCatalogue.load({ force: true }).then((r) => r.source, () => 'error')); fake.mode = 'ok'; return n === 'legacy' }],
  ['the server\u2019s CollectionPage is duplicated', ENGINE.replace("for (var i = 0; i < other.length; i++) if (!other[i].hasAttribute('data-sporta-catalogue-ld') && /\"CollectionPage\"/.test(other[i].textContent)) return", ''), async (c) => {
    await c.ctx.route('**/catalogue', async (route) => { const resp = await route.fetch(); route.fulfill({ response: resp, body: (await resp.text()).replace('</head>', '<script type="application/ld+json">{"@type":"CollectionPage","name":"server"}</script></head>') }) })
    await c.page.goto(new URL(c.page.url()).origin + '/catalogue'); await c.page.waitForSelector('.scat-card'); await c.page.waitForTimeout(300)
    return (await c.page.evaluate(() => document.querySelectorAll('script[data-sporta-catalogue-ld]').length)) === 0 }],
  ['show_prices is ignored', ENGINE.replace("if (s.show_prices) {\n        var pr = el('p', 'scat-price')", "if (true) {\n        var pr = el('p', 'scat-price')"), async (c) => { fake.settings.show_prices = false; fake.products[2].price += 1; await c.page.clock.runFor(61000); await c.page.waitForTimeout(500); const n = await c.page.evaluate(() => document.querySelectorAll('.scat-price').length); fake.settings.show_prices = true; fake.products[2].price -= 1; return n === 0 }],
  ['counts ignore the other filters', ENGINE.replace("var forCat = applyView(S.products, baseView({ cat: '' }), l)", 'var forCat = S.products'), async (c) => { await c.page.click('[data-scat-brand="vanquish"]'); return await c.page.evaluate(() => /^All \(4\)/.test(document.querySelector('[data-scat-cat="all"]').textContent)) }],
]
for (const [label, text, check] of MUTANTS) {
  if (text === ENGINE) { is(false, `mutation "${label}": the cut text was found`); continue }
  fresh()
  const m = await new Promise((ok) => {
    // the mutated engine is served instead of the real one by a second small proxy in front of the shop
    const server = http.createServer((q, r) => {
      if (new URL(q.url, 'http://x').pathname === '/sporta-catalogue.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(text) }
      const up = http.request({ host: '127.0.0.1', port: new URL(BASE).port, path: q.url, method: q.method, headers: q.headers }, (x) => { r.writeHead(x.statusCode, x.headers); x.pipe(r) })
      up.on('error', () => { r.writeHead(502); r.end() }); q.pipe(up)
    }).listen(0, '127.0.0.1', () => ok({ server, base: 'http://127.0.0.1:' + server.address().port }))
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch (e) { /* ignore */ } })
  const page = await ctx.newPage(); await page.clock.install(); await page.clock.resume()
  await page.goto(m.base + '/catalogue'); await page.waitForSelector('.scat-card', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(300)
  let ok = false; try { ok = await check({ page, ctx }) } catch (e) { ok = false }
  is(ok === false, `mutation "${label}": its check goes red`)
  fake.mode = 'ok'
  await ctx.close(); await new Promise((d) => m.server.close(d))
}

await new Promise((d) => shop.server.close(d)); await liveShop.close(); await browser.close(); rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
