// PERFORMANCE TEST of the LIVE storefront (read-only, GET only). For each page x language it loads the page cold (empty cache)
// RUNS times on a throttled phone profile (390x844, CPU x4, 1.6 Mbps down / 0.75 up / 150 ms RTT, the same profile test:perf
// uses) and once on an unthrottled desktop (1280x800), and reports the MEDIAN of: TTFB, FCP, LCP (and which element), CLS,
// total blocking time (long tasks over 50 ms between FCP and load), DOMContentLoaded, load, requests, transferred bytes by
// type, JS bytes, third-party requests, and the heaviest 5 resources. Then a warm reload (cache primed) for the repeat-visit
// cost. Pass marks follow Google's "good" thresholds: LCP <= 2.5 s, CLS <= 0.1, TBT <= 200 ms, FCP <= 1.8 s, TTFB <= 0.8 s.
//   env: BASE, RUNS (default 3), PAGES (comma list of paths), LANGS (ar,en)
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const RUNS = Number(process.env.RUNS || 3)
const LANGS = (process.env.LANGS || 'ar,en').split(',')
const out = (s) => console.log(s)
let slug = ''
try { const j = await (await fetch(B + '/api/api.php?r=products')).json(); slug = '/product/' + (j.products || j)[0].slug } catch (e) {}
const PAGES = (process.env.PAGES ? process.env.PAGES.split(',') : ['/', '/shop', slug, '/about', '/contact', '/account', '/cart']).filter(Boolean)
const med = (a) => { const s = a.filter((x) => x != null).slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const f1 = (n) => (n == null ? '-' : Math.round(n))
const kb = (n) => Math.round(n / 1024)
const INIT = () => {
  window.__m = { lcp: 0, lcpEl: '', cls: 0, fcp: 0, longs: [] }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m.lcp = e.startTime; window.__m.lcpEl = (e.element ? e.element.tagName + '.' + String(e.element.className || '').split(' ')[0].slice(0, 30) : '') + ' ' + (e.url ? e.url.replace(location.origin, '').slice(-40) : '') } }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime }).observe({ type: 'paint', buffered: true })
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.longs.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
}
const browser = await chromium.launch({ args: ['--no-sandbox'] })
async function once(path, lang, profile, warm, ctx0) {
  const ctx = ctx0 || await browser.newContext({ viewport: profile === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: profile === 'phone' ? 2 : 1, isMobile: profile === 'phone', hasTouch: profile === 'phone', locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const page = await ctx.newPage()
  await page.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  const cdp = await ctx.newCDPSession(page)
  if (profile === 'phone') {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (0.75 * 1024 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  await page.addInitScript(INIT)
  const reqs = []
  page.on('response', async (r) => { try { const h = r.headers(); reqs.push({ url: r.url(), status: r.status(), type: (h['content-type'] || '').split(';')[0], len: Number(h['content-length'] || 0), enc: h['content-encoding'] || '', fromCache: r.fromServiceWorker() }) } catch (e) {} })
  const t0 = Date.now()
  await page.goto(B + path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'load', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(profile === 'phone' ? 3500 : 1800)
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource')
    const long = window.__m.longs.filter(([s]) => s >= window.__m.fcp)
    return { ttfb: nav.responseStart, fcp: window.__m.fcp, lcp: window.__m.lcp, lcpEl: window.__m.lcpEl, cls: window.__m.cls, tbt: long.reduce((a, [, d]) => a + Math.max(0, d - 50), 0), dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, n: res.length + 1, xfer: res.reduce((a, r) => a + (r.transferSize || 0), 0) + (nav.transferSize || 0), items: res.map((r) => ({ n: r.name.replace(location.origin, '').slice(0, 70), t: r.initiatorType, b: r.transferSize || 0, d: Math.round(r.duration) })) }
  })
  const by = {}
  for (const x of m.items) { const k = /\.js(\?|$)/.test(x.n) ? 'js' : /\.css(\?|$)/.test(x.n) ? 'css' : /\.(png|jpe?g|webp|avif|svg|gif)(\?|$)|brand_logo|slide_image/.test(x.n) ? 'img' : /\.woff2?(\?|$)/.test(x.n) ? 'font' : /\/api\//.test(x.n) ? 'api' : 'other'; by[k] = (by[k] || 0) + x.b }
  const third = m.items.filter((x) => /^https?:/.test(x.n)).length
  if (!ctx0) await ctx.close(); else await page.close()
  return { ...m, by, third, top: m.items.sort((a, b) => b.b - a.b).slice(0, 5), wall: Date.now() - t0 }
}
const mark = (v, good, ok) => (v == null ? '?' : v <= good ? 'good' : v <= ok ? 'NEEDS-WORK' : 'POOR')
for (const lang of LANGS) for (const path of PAGES) for (const profile of ['phone', 'desktop']) {
  const rs = []
  for (let i = 0; i < (profile === 'phone' ? RUNS : 1); i++) { try { rs.push(await once(path, lang, profile, false)) } catch (e) { out('RUNERR ' + path + ' ' + e) } }
  if (!rs.length) continue
  const M = (k) => med(rs.map((r) => r[k]))
  const lcp = M('lcp'), cls = M('cls'), tbt = M('tbt'), fcp = M('fcp'), ttfb = M('ttfb')
  const last = rs[rs.length - 1]
  out('== ' + lang + ' ' + profile + ' ' + path + ' (' + rs.length + ' run' + (rs.length > 1 ? 's' : '') + ')')
  out('   TTFB ' + f1(ttfb) + 'ms ' + mark(ttfb, 800, 1800) + ' | FCP ' + f1(fcp) + 'ms ' + mark(fcp, 1800, 3000) + ' | LCP ' + f1(lcp) + 'ms ' + mark(lcp, 2500, 4000) + ' | CLS ' + (cls == null ? '-' : cls.toFixed(3)) + ' ' + mark(cls, 0.1, 0.25) + ' | TBT ' + f1(tbt) + 'ms ' + mark(tbt, 200, 600) + ' | DCL ' + f1(M('dcl')) + ' | load ' + f1(M('load')))
  out('   requests ' + M('n') + ' | transferred ' + kb(M('xfer')) + 'KB | by type KB ' + JSON.stringify(Object.fromEntries(Object.entries(last.by).map(([k, v]) => [k, kb(v)]))) + ' | third-party ' + last.third + ' | LCP element: ' + last.lcpEl)
  out('   heaviest: ' + last.top.map((x) => x.n + ' ' + kb(x.b) + 'KB/' + x.d + 'ms').join(' ; '))
}
// warm reload of the home page (repeat visit, cache primed) on the phone profile
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' })
  const a = await once('/', 'ar', 'phone', false, ctx)
  const b = await once('/', 'ar', 'phone', true, ctx)
  out('== REPEAT VISIT (ar phone /): cold LCP ' + f1(a.lcp) + 'ms ' + kb(a.xfer) + 'KB ' + a.n + ' req  ->  warm LCP ' + f1(b.lcp) + 'ms ' + kb(b.xfer) + 'KB ' + b.n + ' req')
  await ctx.close()
}
await browser.close()
out('PROBE_DONE')
