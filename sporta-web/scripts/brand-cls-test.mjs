// /shop?brand=<slug> must not move while it loads (BRAND-CLS-1112 in public/sporta-features.js).
//
//   npm run test:brand-cls      (no rig: the fixture of the live markup + the real add-ons, headless Chromium)
//
// Live, 2026-11-12 (scripts/live-site-scan.mjs): /shop?brand=vanquish CLS 0.078 ar 390, 0.085 en 390, 0.033 ar 1280,
// the highest on the site; every other shop page 0-0.002. scripts/live-brand-cls-probe.mjs named the element: the
// compiled page's .catalog-empty box (products still loading) pushed 174px down by the brand banner sporta-features.js
// inserts. Its timeline: the brand list answered at +2583 ms, the shop was first drawn at +2935 ms, the banner went in
// at +2960 ms, one frame after that paint (the module's observer only schedules a requestAnimationFrame).
//
// The page here is fixtures/brand-cls.mjs: the live markup, the live CSS, the real sporta-features.js, sporta-grid.css
// and sporta-images.css, served under the live CSP, with /api?r=brands answering after BRANDS_MS and the "app"
// swapping the empty box for the grid after the products arrive. Each run sums the layout-shift entries (the same
// observer the live scan uses) and lists their sources. Asserted, ar and en, at 320 / 390 / 768 / 1280:
//   - logo brand (vanquish) and wordmark brand (gymshark): CLS under 0.005;
//   - before the list answers there is a reserve in the banner's place: dark box, content hidden, aria-hidden, no
//     link target, no id clash, no logo request; after, the real banner is just before .catalog-filters and the
//     reserve is gone; the reserve is as tall as the banner (within 1px);
//   - /shop without ?brand=: no reserve ever enters the page (watched by a MutationObserver from the first byte);
//   - an unknown slug: the reserve is removed and no banner comes; with the list remembered from an earlier visit,
//     an unknown slug gets no reserve and CLS 0; the list failing (500) leaves no reserve behind;
//   - "list first" (the live order: list answers, then the app commits from inside a frame callback, so a rAF-only
//     add-on misses the first paint): CLS under 0.005, and no reserve is needed;
//   - mutations, each must show the live shift (vanquish 390 above 0.05 in both languages): the reserveBanner() hook
//     taken out (slow list), and the synchronous observer taken out (list first). The suite cannot pass without both.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { page as pageHtml, shell, FIXTURE_JS } from './fixtures/brand-cls.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FEATURES = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const HOOK = 'if (!rows) { load(); reserveBanner(slug); return }'
if (!FEATURES.includes(HOOK)) { console.log('FAIL sporta-features.js has no BRAND-CLS-1112 reserveBanner hook in mountBanner'); process.exit(1) }
const WITHOUT = FEATURES.replace(HOOK, 'if (!rows) { load(); return }')
const SYNC = "    if (document.body) syncWatch()\n    else document.addEventListener('DOMContentLoaded', syncWatch, { once: true })"
if (!FEATURES.includes(SYNC)) { console.log('FAIL sporta-features.js has no BRAND-CLS-1112 syncWatch start'); process.exit(1) }
const NOSYNC = FEATURES.replace(SYNC, '    void 0')
const CSS = {
  '/sporta-grid.css': readFileSync(join(ROOT, 'public/sporta-grid.css'), 'utf8'),
  '/sporta-images.css': readFileSync(join(ROOT, 'public/sporta-images.css'), 'utf8'),
}
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const BRANDS = [
  { slug: 'sporta', name_en: 'Sporta', name_ar: 'سبورتا', has_logo: false, logo_v: '', products: 41 },
  { slug: 'vanquish', name_en: 'Vanquish', name_ar: 'فانكويش', has_logo: true, logo_v: '24f9e5f69b4b', products: 4 },
  { slug: 'gymshark', name_en: 'Gymshark', name_ar: 'جيم شارك', has_logo: false, logo_v: '', products: 1 },
]
const BRANDS_MS = 700, PRODUCTS_MS = 1300

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) pass++; else fail++; console.log((ok ? 'ok   ' : 'FAIL ') + msg + (detail ? '  - ' + detail : '')) }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

/** One page load. Returns the shifts, what the DOM held at 300 ms (list not answered yet) and at the end. */
async function load({ slug = 'vanquish', lang = 'ar', w = 390, features = FEATURES, brands = 200, remembered = null, brandsMs = BRANDS_MS, first = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 800 } })
  const reqs = []
  const t0 = Date.now()
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    reqs.push({ at: Date.now() - t0, url: p + u.search })
    if (p === '/shop') return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: pageHtml(lang) })
    if (p === '/shell.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shell(u.searchParams.get('lang') || 'ar') })
    if (p === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS })
    if (p === '/sporta-features.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: features })
    if (CSS[p]) return route.fulfill({ status: 200, contentType: 'text/css', body: CSS[p] })
    if (p === '/api/api.php') {
      const r = u.searchParams.get('r')
      if (r === 'brands') {
        await sleep(brandsMs)
        if (brands !== 200) return route.fulfill({ status: brands, contentType: 'application/json', body: '{"error":"x"}' })
        return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(BRANDS) })
      }
      if (r === 'brand_logo') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  const pg = await ctx.newPage()
  await pg.addInitScript((rem) => {
    try { if (rem) localStorage.setItem('sporta_brand_slugs', rem) } catch (e) {}
    window.__ls = []
    window.__reserveSeen = 0
    const d = (n) => (n && n.tagName ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + [...n.classList].slice(0, 2).join('.') : String(n && n.nodeName))
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ v: e.value, s: (e.sources || []).map((s) => d(s.node) + ' ' + Math.round(s.previousRect.y) + '->' + Math.round(s.currentRect.y)).join(' | ') })
    }).observe({ type: 'layout-shift', buffered: true })
    new MutationObserver((recs) => {
      for (const r of recs) for (const n of r.addedNodes) if (n.id === 'sporta-brand-banner-reserve') window.__reserveSeen++
    }).observe(document, { childList: true, subtree: true })
  }, remembered)
  const q = (slug ? 'brand=' + encodeURIComponent(slug) + '&' : '') + (lang === 'en' ? 'lang=en&' : '') + 'pm=' + PRODUCTS_MS + (first ? '&sd=400&raf=1' : '')
  await pg.goto(ORIGIN + '/shop?' + q)
  await sleep(300)
  const snap = () => {
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { y: r.y, h: r.height, w: r.width } }
    const rv = document.getElementById('sporta-brand-banner-reserve')
    const bn = document.getElementById('sporta-brand-banner')
    const f = document.querySelector('.catalog-filters')
    return {
      reserve: rv ? {
        box: box(rv), bg: getComputedStyle(rv).backgroundColor, ariaHidden: rv.getAttribute('aria-hidden'),
        kidsHidden: [...rv.children].every((c) => getComputedStyle(c).visibility === 'hidden'),
        href: rv.querySelector('[href]') ? 1 : 0, ids: [...rv.querySelectorAll('[id]')].map((e) => e.id), imgs: rv.querySelectorAll('img').length,
        beforeFilters: rv.nextElementSibling === f, labelledby: rv.getAttribute('aria-labelledby'),
      } : null,
      banner: bn ? { box: box(bn), beforeFilters: bn.nextElementSibling === f } : null,
      ids: document.querySelectorAll('#sporta-brand-banner').length,
    }
  }
  const early = await pg.evaluate(snap)
  await sleep(brandsMs + PRODUCTS_MS + (first ? 400 : 0) + 600)
  const late = await pg.evaluate(snap)
  const ls = await pg.evaluate(() => window.__ls)
  const seen = await pg.evaluate(() => window.__reserveSeen)
  const gridShown = await pg.evaluate(() => !!document.querySelector('.product-grid .catalog-card') && !document.querySelector('.catalog-empty'))
  await ctx.close()
  const cls = ls.reduce((a, e) => a + e.v, 0)
  return { cls, ls, early, late, seen, gridShown, reqs }
}
const f3 = (n) => n.toFixed(4)
const worst = (r) => (r.ls.length ? r.ls.slice().sort((a, b) => b.v - a.v)[0].s : '')

const notes = []
for (const lang of ['ar', 'en']) {
  for (const w of [320, 390, 768, 1280]) {
    head(`vanquish (logo) ${lang} ${w}`)
    const r = await load({ lang, w })
    notes.push(`vanquish ${lang} ${w}: CLS ${f3(r.cls)}`)
    is(r.gridShown, 'the page reached its loaded state (grid shown, empty box gone)')
    is(r.cls < 0.005, `CLS ${f3(r.cls)} < 0.005`, worst(r))
    is(!!r.early.reserve, 'before the list answers, the reserve holds the banner place')
    if (r.early.reserve) {
      const e = r.early.reserve
      is(e.beforeFilters, 'reserve sits just before .catalog-filters (where the banner goes)')
      is(e.bg === 'rgb(23, 26, 30)' && e.kidsHidden, 'reserve: the dark box shows, its content is hidden', e.bg)
      is(e.ariaHidden === 'true' && !e.labelledby && e.href === 0 && e.ids.length === 0 && e.imgs === 0, 'reserve: aria-hidden, no link target, no ids, no image', JSON.stringify(e))
      is(!r.early.banner && r.early.ids === 0, 'no banner (and no second #sporta-brand-banner) before the list')
      if (r.late.banner) is(Math.abs(e.box.h - r.late.banner.box.h) < 1 && Math.abs(e.box.y - r.late.banner.box.y) < 1, `reserve ${e.box.h.toFixed(1)}px tall at y ${e.box.y.toFixed(0)} = banner ${r.late.banner.box.h.toFixed(1)}px at y ${r.late.banner.box.y.toFixed(0)}`)
    }
    is(!!r.late.banner && r.late.banner.beforeFilters && !r.late.reserve && r.late.ids === 1, 'after: one banner just before .catalog-filters, reserve gone')
    const logo = r.reqs.find((q) => /r=brand_logo/.test(q.url)), list = r.reqs.find((q) => /r=brands/.test(q.url))
    is(!!logo && !!list && logo.at >= list.at + BRANDS_MS - 50, 'the logo is requested only once the list answered (the reserve asks for nothing)', logo ? 'logo at ' + logo.at + ' ms' : 'no logo request')
  }
  for (const w of [320, 390, 1280]) {
    head(`gymshark (wordmark) ${lang} ${w}`)
    const r = await load({ slug: 'gymshark', lang, w })
    notes.push(`gymshark ${lang} ${w}: CLS ${f3(r.cls)}`)
    is(r.cls < 0.005 && !!r.late.banner && !r.late.reserve, `CLS ${f3(r.cls)} < 0.005, banner up, reserve gone`, worst(r))
  }
}

for (const lang of ['ar', 'en']) {
  for (const w of [320, 390, 1280]) {
    head(`list first (live order) vanquish ${lang} ${w}`)
    const r = await load({ lang, w, brandsMs: 20, first: true })
    notes.push(`list first vanquish ${lang} ${w}: CLS ${f3(r.cls)}`)
    is(r.gridShown && !!r.late.banner && r.late.banner.beforeFilters && r.late.ids === 1, 'loaded, one banner just before .catalog-filters')
    is(r.cls < 0.005, `CLS ${f3(r.cls)} < 0.005`, worst(r))
    is(r.seen === 0, 'no reserve needed (the list was there): the banner went in with the first commit', 'seen ' + r.seen)
  }
}

head('pages that must not get a reserve')
for (const lang of ['ar', 'en']) {
  const r = await load({ slug: '', lang })
  is(r.seen === 0 && !r.late.reserve && !r.late.banner, `/shop (${lang}): no reserve ever entered the page, no banner`, 'seen ' + r.seen)
  is(r.cls < 0.005, `/shop (${lang}): CLS ${f3(r.cls)}`)
}
{
  const r = await load({ slug: 'nike' })
  is(!!r.early.reserve && !r.late.reserve && !r.late.banner, 'unknown slug, first visit: reserve while loading, then removed, no banner')
  notes.push(`nike (unknown, first visit): CLS ${f3(r.cls)}`)
  const k = await load({ slug: 'nike', remembered: JSON.stringify(['sporta', 'vanquish', 'gymshark']) })
  is(k.seen === 0 && !k.late.banner && k.cls < 0.005, `unknown slug, list remembered: no reserve, CLS ${f3(k.cls)}`)
  const v = await load({ slug: 'vanquish', remembered: JSON.stringify(['sporta', 'vanquish']) })
  is(!!v.early.reserve && v.cls < 0.005, `known slug, list remembered: reserve, CLS ${f3(v.cls)}`)
  const bad = await load({ slug: 'vanquish', brands: 500 })
  is(!bad.late.reserve && !bad.late.banner && bad.late.ids === 0, 'list request fails (500): no reserve left behind, no banner')
}

head('mutation: the synchronous observer taken out (list first)')
for (const lang of ['ar', 'en']) {
  for (const w of [390, 1280]) {
    const r = await load({ lang, w, features: NOSYNC, brandsMs: 20, first: true })
    notes.push(`WITHOUT sync, list first vanquish ${lang} ${w}: CLS ${f3(r.cls)} (${worst(r)})`)
    is(r.cls > (w === 390 ? 0.05 : 0.01), `without the observer, vanquish ${lang} ${w} shifts like live: CLS ${f3(r.cls)}`, worst(r))
  }
}

head('mutation: the reserveBanner() hook taken out')
for (const lang of ['ar', 'en']) {
  for (const w of [390, 1280]) {
    const r = await load({ lang, w, features: WITHOUT })
    notes.push(`WITHOUT fix vanquish ${lang} ${w}: CLS ${f3(r.cls)} (${worst(r)})`)
    if (w === 390) is(r.cls > 0.05, `without the hook, vanquish ${lang} ${w} shifts like live: CLS ${f3(r.cls)} > 0.05`, worst(r))
    else is(r.cls > 0.01, `without the hook, vanquish ${lang} ${w} shifts: CLS ${f3(r.cls)} > 0.01`, worst(r))
  }
}

await browser.close()
console.log('\n' + notes.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
