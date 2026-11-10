// READ-ONLY scan of the whole LIVE site. Loads pages and reads them; clicks nothing, types nothing, POSTs nothing.
//
//   1. every URL in the sitemaps: status (fetch)
//   2. every internal link found on the scanned pages: status (fetch)
//   3. one page of each kind, in a browser, phone and desktop, Arabic and English: console errors, failed
//      requests, sideways scroll, headings, broken images, layout shift, title / description / canonical / hreflang
//
// Run on the VPS in the Playwright image (see live-images-scan.mjs). Output is compact: only what is wrong is
// printed per page, plus one OK line. The job log keeps 300 entries.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const get = async (u, o) => { try { const r = await fetch(u.startsWith('http') ? u : B + u, Object.assign({ redirect: 'manual' }, o)); return { s: r.status, t: await r.text(), h: r.headers } } catch (e) { return { s: 0, t: '', h: new Map() } } }

// ---- 1. sitemaps
const locs = new Set()
const readMap = async (u, depth) => { const r = await get(u); if (r.s !== 200) { console.log('SITEMAP ' + r.s + ' ' + u); return } for (const m of r.t.matchAll(/<loc>([^<]+)<\/loc>/g)) { const x = m[1].replace(/&amp;/g, '&'); if (/\.xml(\?|$)/.test(x) && depth < 2) await readMap(x, depth + 1); else locs.add(x) } }
await readMap('/sitemap.xml', 0)
let bad = 0
for (const u of locs) { const r = await get(u); if (r.s !== 200) { bad++; console.log('SITEMAP-URL ' + r.s + ' ' + u.replace(B, '')) } }
console.log('SITEMAP urls ' + locs.size + ' not-200 ' + bad)
const products = [...locs].filter((u) => /\/product\//.test(u) && !/lang=/.test(u)).map((u) => u.replace(B, ''))

// ---- 3. pages in a browser
const PAGES = ['/', '/shop', '/shop?category=men', '/shop?category=women', '/shop?category=accessories', '/shop?brand=vanquish', products[0], products[Math.floor(products.length / 2)], products[products.length - 1], '/about', '/returns', '/exchange', '/support', '/track', '/cart', '/checkout', '/account', '/wishlist', '/privacy', '/terms', '/contact', '/no-such-page-scan'].filter(Boolean)
const b = await chromium.launch()
const links = new Map()
for (const [lang, w] of [['ar', 390], ['ar', 1280], ['en', 390]]) {
  for (const path of PAGES) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 800 } }); const page = await ctx.newPage()
    await page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* older engine */ } })
    const errs = [], fails = []
    page.on('pageerror', (e) => errs.push('JS ' + String(e).slice(0, 110)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CON ' + m.text().slice(0, 110)) })
    page.on('response', (r) => { if (r.status() >= 400) fails.push(r.status() + ' ' + r.url().replace(B, '').slice(0, 70)) })
    page.on('requestfailed', (r) => fails.push('FAILED ' + r.url().replace(B, '').slice(0, 70)))
    const url = path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : '')
    const resp = await page.goto(B + url, { waitUntil: 'networkidle' }).catch(() => null)
    await page.waitForTimeout(1200)
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } scrollTo(0, 0) }).catch(() => null)
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const vis = (e) => { const c = getComputedStyle(e); const q = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && q.width > 0 && q.height > 0 }
      const q = (s) => document.querySelector(s)
      const imgs = [...document.querySelectorAll('img')].filter(vis)
      const main = q('main') || document.body
      const wide = [...main.querySelectorAll('*')].filter((e) => vis(e) && (e.getBoundingClientRect().right > innerWidth + 2) && !e.closest('[class*=overflow-x],[class*=scroll],[class*=track],[class*=slider],[class*=carousel]')).slice(0, 3).map((e) => e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 2).join('.'))
      const small = [...main.querySelectorAll('a[href],button')].filter((e) => vis(e) && (e.getBoundingClientRect().width < 40 || e.getBoundingClientRect().height < 40) && !e.closest('p,li,nav[aria-label*=readcrumb],.catalog-breadcrumb')).slice(0, 4).map((e) => (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))
      return {
        lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, h1: [...document.querySelectorAll('h1')].filter(vis).length, h1t: (q('h1') || {}).innerText || '',
        desc: (q('meta[name=description]') || {}).content || '', canon: (q('link[rel=canonical]') || {}).href || '', hre: [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => l.hreflang).join(','), robots: (q('meta[name=robots]') || {}).content || '',
        ov: document.documentElement.scrollWidth - innerWidth, text: main.innerText.length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => (i.currentSrc || i.src).slice(-50)), noAlt: imgs.filter((i) => !i.hasAttribute('alt')).length, plates: imgs.filter((i) => /unavailable/.test(i.src)).length, imgs: imgs.length,
        wide, small, cls: Number(window.__cls.toFixed(3)), emptyLinks: [...document.querySelectorAll('a[href]')].filter((a) => vis(a) && !(a.textContent || '').trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""]),svg[aria-label],svg title')).length,
        hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/') && !h.startsWith('//')),
        latinInAr: document.documentElement.lang === 'ar' ? [...main.querySelectorAll('h1,h2,h3,button,label,a')].filter((e) => vis(e) && e.children.length === 0 && /^[A-Za-z][A-Za-z ,.'!?&-]{5,}$/.test((e.textContent || '').trim())).slice(0, 4).map((e) => (e.textContent || '').trim().slice(0, 28)) : [],
      }
    }).catch((e) => ({ error: String(e).slice(0, 120) }))
    for (const h of m.hrefs || []) if (!links.has(h)) links.set(h, path)
    const tag = lang + ' ' + w + ' ' + path
    const issues = []
    const st = resp ? resp.status() : 0
    if (m.error) issues.push('EVAL ' + m.error)
    if (st !== 200) issues.push('status ' + st)
    if (m.lang !== lang) issues.push('lang=' + m.lang)
    if (m.h1 !== 1) issues.push('h1 count ' + m.h1)
    if (!m.title || m.title.length < 8) issues.push('title "' + m.title + '"')
    if (!m.desc || m.desc.length < 40) issues.push('description ' + (m.desc || '').length + ' chars')
    if (!m.canon) issues.push('no canonical')
    if (!/ar/.test(m.hre) || !/en/.test(m.hre)) issues.push('hreflang "' + m.hre + '"')
    if (m.ov > 1) issues.push('sideways scroll ' + m.ov + 'px ' + (m.wide || []).join(' '))
    if (m.text < 120) issues.push('text only ' + m.text + ' chars')
    if ((m.broken || []).length) issues.push('broken images ' + m.broken.join(' '))
    if (m.noAlt) issues.push('images without alt ' + m.noAlt)
    if (m.cls > 0.1) issues.push('layout shift ' + m.cls)
    if (m.emptyLinks) issues.push('links with no name ' + m.emptyLinks)
    if ((m.latinInAr || []).length) issues.push('English in Arabic page: ' + m.latinInAr.join(' / '))
    if ((m.small || []).length && w < 500) issues.push('small targets: ' + m.small.join(' / '))
    if (errs.length) issues.push([...new Set(errs)].slice(0, 3).join(' ; '))
    if (fails.length) issues.push('requests: ' + [...new Set(fails)].slice(0, 4).join(' ; '))
    console.log((issues.length ? 'ISSUE ' : 'OK    ') + tag + ' | h1 "' + (m.h1t || '').replace(/\s+/g, ' ').slice(0, 34) + '" plates ' + m.plates + '/' + m.imgs + ' cls ' + m.cls + (m.robots ? ' robots ' + m.robots : '') + (issues.length ? ' || ' + issues.join(' || ') : ''))
    await ctx.close()
  }
}
await b.close()

// ---- 2. internal links
let lbad = 0
for (const [h, from] of links) { if (/^\/(api|knet|pay)\//.test(h)) continue; const r = await get(h); const soft404 = r.s === 200 && /no-such-page|page-not-found/.test(''); if (r.s >= 400 || r.s === 0 || soft404) { lbad++; console.log('LINK ' + r.s + ' ' + h + ' (on ' + from + ')') } else if (r.s >= 300) { const to = r.h.get('location') || ''; if (!/^https:\/\/www\.sporta\.com\.kw/.test(to) && !to.startsWith('/')) console.log('LINK ' + r.s + ' ' + h + ' -> ' + to) } }
console.log('LINKS checked ' + links.size + ' bad ' + lbad)
console.log('SCAN_DONE')
