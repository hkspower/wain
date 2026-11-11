// READ-ONLY probe for the 2026-11-11 full scan: (1) every tel:/mailto: link on /contact, its box and its ancestors'
// classes, ar and en, phone width; (2) the layout-shift entries on /about at 1280 Arabic, with the nodes that moved and
// their before/after boxes. Loads pages and reads the DOM. Clicks nothing, types nothing, sends nothing.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const b = await chromium.launch()
for (const lang of ['ar', 'en']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage()
  await p.goto(B + '/contact' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const r = await p.evaluate(() => [...document.querySelectorAll('main a[href^="tel:"], main a[href^="mailto:"], main a[href*="wa.me"]')].map((a) => {
    const q = a.getBoundingClientRect(); const chain = []
    for (let n = a; n && n !== document.body && chain.length < 6; n = n.parentElement) chain.push(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 4).join('.') : ''))
    const c = getComputedStyle(a)
    return a.getAttribute('href').slice(0, 30) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height) + ' disp=' + c.display + ' | ' + chain.join(' < ')
  }))
  for (const x of r) console.log('CONTACT ' + lang + ' ' + x)
  await ctx.close()
}
for (const run of [1, 2]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage()
  await p.addInitScript(() => { window.__ls = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ v: e.value, t: Math.round(e.startTime), s: (e.sources || []).map((s) => { const n = s.node; let d = '?'; if (n && n.nodeType === 1) d = n.tagName.toLowerCase() + '.' + String(n.className || '').trim().split(/\s+/).slice(0, 3).join('.') + ' "' + (n.textContent || '').trim().slice(0, 30) + '"'; else if (n) d = '#text "' + (n.textContent || '').trim().slice(0, 30) + '"'; return d + ' ' + JSON.stringify([Math.round(s.previousRect.y), Math.round(s.previousRect.height), Math.round(s.currentRect.y), Math.round(s.currentRect.height)]) }) }) }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {} })
  await p.goto(B + '/about', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
  const ls = await p.evaluate(() => window.__ls)
  for (const e of ls) console.log('ABOUT run' + run + ' shift ' + e.v.toFixed(3) + ' @' + e.t + 'ms ' + e.s.join(' ; ').slice(0, 900))
  const kids = await p.evaluate(() => [...document.querySelectorAll('main > *, main > * > *')].slice(0, 14).map((e) => e.tagName.toLowerCase() + '.' + String(e.className || '').trim().split(/\s+/).slice(0, 3).join('.') + ' y=' + Math.round(e.getBoundingClientRect().top) + ' h=' + Math.round(e.getBoundingClientRect().height)))
  if (run === 1) console.log('ABOUT tree ' + kids.join(' | ').slice(0, 1500))
  await ctx.close()
}
await b.close()
console.log('PROBE_DONE')
