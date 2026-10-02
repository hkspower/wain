/**
 * Scrolling stays smooth on the pages with product grids, 2026-10-02.
 * The owner reported Chrome feeling frozen while scrolling; the cause was grid-name-fit.js
 * re-measuring every product name on every page change (thousands of style writes and
 * 54-162ms long tasks per scroll on a phone). This scrolls each page with the mouse wheel and
 * fails on any long task over 50ms or on the card titles being rewritten over and over.
 */
import { chromium, devices } from 'playwright'
let fails = 0
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [n,o] of [['desktop',{viewport:{width:1280,height:900}}],['phone',devices['Pixel 7']]]) for (const path of ['/','/shop']) {
  const c = await b.newContext(o); const p = await c.newPage()
  await p.addInitScript(() => {
    window.__lt = []; window.__mut = 0; window.__frames = []
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true })
    addEventListener('DOMContentLoaded', () => new MutationObserver(r => { window.__mut += r.length }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }))
  })
  await p.goto('http://127.0.0.1:4300' + path + '?lang=en', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
  await p.evaluate(() => { window.__lt = []; window.__mut = 0; window.__attrs = {}; new MutationObserver(r => r.forEach(m => { if (m.type==='attributes') { const k=(m.target.className||m.target.tagName).toString().slice(0,30)+'@'+m.attributeName; window.__attrs[k]=(window.__attrs[k]||0)+1 } })).observe(document.body,{attributes:true,subtree:true}) })
  const cdp = await c.newCDPSession(p)
  await p.evaluate(() => { let last = performance.now(); window.__frames = []; const f = t => { window.__frames.push(t - last); last = t; if (window.__frames.length < 400) requestAnimationFrame(f) }; requestAnimationFrame(f) })
  for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(40) }
  await p.waitForTimeout(600)
  const fitted = await p.evaluate(() => [...document.querySelectorAll('main div.grid > article h3')].filter(h => h.classList.contains('gnf')).length + '/' + document.querySelectorAll('main div.grid > article h3').length)
  const r = await p.evaluate(() => { const f = window.__frames.slice(2); f.sort((a,b)=>b-a); return { longTasks: window.__lt, mutations: window.__mut, worstFrames: f.slice(0,5).map(Math.round), over50: f.filter(x=>x>50).length, frames: f.length, topAttrs: Object.entries(window.__attrs).sort((a,b)=>b[1]-a[1]).slice(0,6) } })
  const titleWrites = r.topAttrs.filter(([k]) => k.startsWith('line-clamp')).reduce((a, [, v]) => a + v, 0)
  const bad = r.longTasks.filter(x => x > 50)
  // a fitter that crashed or never ran is perfectly smooth, so the names must actually be fitted
  const [fit, all] = fitted.split('/').map(Number)
  const ok = bad.length === 0 && titleWrites <= 120 && all > 0 && fit === all
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${path}: no long task over 50ms and the card titles are not rewritten while scrolling   longTasks=${JSON.stringify(r.longTasks)} titleWrites=${titleWrites} worstFrame=${r.worstFrames[0]}ms fitted=${fitted}`)
  await c.close()
}
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — scrolling stays smooth')
process.exit(fails ? 1 : 0)
