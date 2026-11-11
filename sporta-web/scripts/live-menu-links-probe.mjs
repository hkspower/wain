// READ-ONLY check of every MENU / NAV / FOOTER link on the LIVE storefront, ar + en, phone and desktop. For each page in a
// sample it collects the links in header, nav, footer and the mobile menu; then loads every distinct target and reports
// status, redirect chain, h1, title, canonical, noindex, console errors, and mismatches (label vs destination, links to
// '#', empty hrefs, target=_blank without rel, tel/mailto/wa.me shape, language kept on ?lang=en). GET only; no clicks that submit.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
const browser = await chromium.launch()
const found = new Map()   // href -> {labels:Set, where:Set}
const SAMPLE = ['/', '/shop', '/about', '/contact', '/returns', '/cart']
for (const lang of ['ar', 'en']) for (const w of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  for (const path of SAMPLE) {
    await p.goto(B + path + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
    await p.waitForTimeout(600)
    const rows = await p.evaluate(() => {
      const t = (e) => (e.getAttribute('aria-label') || e.textContent || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      const where = (a) => a.closest('footer') ? 'footer' : a.closest('header') ? 'header' : a.closest('nav') ? 'nav' : a.closest('[role=dialog],.cart-drawer') ? 'drawer' : null
      return [...document.querySelectorAll('header a, nav a, footer a, [role=dialog] a')].map((a) => ({ href: a.getAttribute('href'), label: t(a), where: where(a), blank: a.target === '_blank', rel: a.rel, vis: (() => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 })() }))
    })
    for (const r of rows) {
      const k = r.href == null ? '(no href)' : r.href
      const e = found.get(k) || { labels: new Set(), where: new Set(), blank: false, norel: false, pages: new Set() }
      e.labels.add(lang + ':' + r.label); e.where.add(r.where); e.pages.add(path)
      if (r.blank) { e.blank = true; if (!/noopener/.test(r.rel || '')) e.norel = true }
      found.set(k, e)
    }
  }
  await ctx.close()
}
out('DISTINCT MENU/NAV/FOOTER HREFS: ' + found.size)
const internal = [], other = []
for (const [h, e] of found) {
  if (h === '(no href)' || h === '#' || h === '' || /^javascript:/i.test(h)) other.push(['BAD', h, e]); else if (/^(tel:|mailto:|https?:\/\/(?!www\.sporta\.com\.kw))/.test(h)) other.push(['EXT', h, e]); else internal.push(h)
}
out('== NON-INTERNAL / SUSPECT')
for (const [k, h, e] of other) out('  ' + k + ' ' + h + ' | ' + [...e.labels].slice(0, 3).join(' / ') + ' | in ' + [...e.where].join(',') + (e.norel ? ' | target=_blank WITHOUT noopener' : ''))
out('== INTERNAL TARGETS')
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW' })
const p = await ctx.newPage()
await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
for (const h of [...new Set(internal)].sort()) {
  const url = h.startsWith('http') ? h : B + h
  const errs = []
  const onerr = (e) => errs.push(String(e.message || e).slice(0, 80)); p.on('pageerror', onerr)
  let res = null
  try { res = await p.goto(url, { waitUntil: 'networkidle', timeout: 25000 }) } catch (e) { errs.push('NAV ' + String(e).slice(0, 60)) }
  await p.waitForTimeout(500)
  p.off('pageerror', onerr)
  const d = await p.evaluate(() => ({ title: document.title.slice(0, 60), h1: (document.querySelector('h1') || {}).textContent, canon: (document.querySelector('link[rel=canonical]') || {}).href, noindex: !!document.querySelector('meta[name=robots][content*=noindex]'), url: location.pathname + location.search, notFound: /404|لم نجد|not found/i.test(document.body.innerText.slice(0, 600)) && !document.querySelector('.product-grid-card, h1') }))
  const e = found.get(h)
  out('  ' + (res ? res.status() : 'ERR') + ' ' + h + ' -> ' + d.url + ' | h1 "' + String(d.h1 || '').trim().slice(0, 40) + '" | canon ' + (d.canon || '-').replace(B, '') + (d.noindex ? ' | NOINDEX' : '') + (d.notFound ? ' | LOOKS-LIKE-404' : '') + (errs.length ? ' | ERR ' + errs.join(';') : '') + ' | labels ' + [...e.labels].slice(0, 2).join(' / '))
}
await browser.close()
out('PROBE_DONE')
