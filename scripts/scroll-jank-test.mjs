/**
 * Scrolling stays smooth on the pages with product grids, 2026-10-02.
 * The owner reported Chrome feeling frozen while scrolling; the cause was grid-name-fit.js
 * re-measuring every product name on every page change (thousands of style writes and
 * 54-162ms long tasks per scroll on a phone). This scrolls each page with the mouse wheel and
 * fails on any long task over 50ms or on the card titles being rewritten over and over.
 *
 * 2026-10-03: the card's colour circles and size boxes (card-options.js) are held to the same
 * rule, on the server-drawn category page (/women) too. /shop loads more cards as it scrolls and
 * each newcomer gets its rows ONCE, so what fails is any one caption being given rows twice, or
 * any data-cardopt attribute being written twice on one element — the shape grid-name-fit.js's
 * freeze had.
 *
 * AN IDLE PAGE INSERTS NOTHING (2026-10-03). nav-menu.js rewrote its "Terms" link's text every
 * 80ms for ever — assigning textContent replaces the text node even when the words are the same,
 * and that insertion re-armed its own observer. On this shop every insertion restyles the WHOLE
 * document (its :has() rules), so a page doing nothing was restyled ~12 times a second, and that
 * was the largest single cost of a scroll on a throttled phone (test:scroll /shop: 15% of frames
 * over 33ms with it, 4% without). Each page now sits for two seconds before it is scrolled, and
 * any childList mutation in that window fails it, naming where it happened.
 */
import { chromium, devices } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [n,o] of [['desktop',{viewport:{width:1280,height:900}}],['phone',devices['Pixel 7']]]) for (const path of ['/','/shop','/women']) {
  const c = await b.newContext(o); const p = await c.newPage()
  await p.addInitScript(() => {
    window.__lt = []; window.__mut = 0; window.__frames = []
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true })
    addEventListener('DOMContentLoaded', () => new MutationObserver(r => { window.__mut += r.length }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }))
  })
  await p.goto(BASE + path + '?lang=en', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
  const idle = await p.evaluate(() => new Promise((res) => { const seen = {}; let n = 0
    const mo = new MutationObserver((rs) => rs.forEach((m) => { if (m.type !== 'childList') return; n++; const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; const k = t ? t.tagName.toLowerCase() + '.' + String(t.className).split(' ')[0] + (t.closest('header') ? ' in header' : '') : '?'; seen[k] = (seen[k] || 0) + 1 }))
    mo.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(() => { mo.disconnect(); res({ n, where: Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 4) }) }, 2000) }))
  if (idle.n > 0) fails++
  console.log(`${idle.n === 0 ? 'ok  ' : 'FAIL'} ${n} ${path}: an idle page inserts nothing for two seconds (every insertion restyles the whole document here)${idle.n ? '   ' + idle.n + ' insertions: ' + JSON.stringify(idle.where) : ''}`)
  await p.evaluate(() => { window.__lt = []; window.__mut = 0; window.__attrs = {}; window.__coEl = new Map(); new MutationObserver(r => r.forEach(m => { if (m.type==='childList' && [...m.addedNodes].some(n => n.nodeType === 1 && n.matches('.cardopt-colours, .cardopt-sizes'))) { const e = window.__coEl.get(m.target) || {}; e.rows = (e.rows || 0) + 1; window.__coEl.set(m.target, e) } if (m.type==='attributes') { const k=(m.target.className||m.target.tagName).toString().slice(0,30)+'@'+m.attributeName; window.__attrs[k]=(window.__attrs[k]||0)+1; if (/cardopt/.test(m.attributeName)) { const e = window.__coEl.get(m.target) || {}; e[m.attributeName] = (e[m.attributeName] || 0) + 1; window.__coEl.set(m.target, e) } } })).observe(document.body,{attributes:true,childList:true,subtree:true}) })
  const cdp = await c.newCDPSession(p)
  await p.evaluate(() => { let last = performance.now(); window.__frames = []; const f = t => { window.__frames.push(t - last); last = t; if (window.__frames.length < 400) requestAnimationFrame(f) }; requestAnimationFrame(f) })
  for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(40) }
  await p.waitForTimeout(600)
  const fitted = await p.evaluate(() => [...document.querySelectorAll('main div.grid > article h3')].filter(h => h.classList.contains('gnf')).length + '/' + document.querySelectorAll('main div.grid > article h3').length)
  const r = await p.evaluate(() => { const f = window.__frames.slice(2); f.sort((a,b)=>b-a); return { longTasks: window.__lt, mutations: window.__mut, worstFrames: f.slice(0,5).map(Math.round), over50: f.filter(x=>x>50).length, frames: f.length, topAttrs: Object.entries(window.__attrs).sort((a,b)=>b[1]-a[1]).slice(0,6),
    cardoptWrites: Object.entries(window.__attrs).filter(([k]) => /cardopt/.test(k)).reduce((a, [, v]) => a + v, 0),
    cardoptTwice: [...window.__coEl.values()].filter(e => Object.values(e).some(v => v > 1)).length,
    boxes: document.querySelectorAll('.cardopt-colours, .cardopt-sizes').length } })
  const titleWrites = r.topAttrs.filter(([k]) => k.startsWith('line-clamp')).reduce((a, [, v]) => a + v, 0)
  const bad = r.longTasks.filter(x => x > 50)
  // a fitter that crashed or never ran is perfectly smooth, so the names must actually be fitted
  const [fit, all] = fitted.split('/').map(Number)
  // and the card rows likewise: a card-options.js that drew nothing writes nothing
  const ok = bad.length === 0 && titleWrites <= 120 && all > 0 && fit === all && r.boxes > 0 && r.cardoptTwice === 0
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${path}: no long task over 50ms, the card titles are not rewritten and no card is given its colour/size rows twice while scrolling   longTasks=${JSON.stringify(r.longTasks)} titleWrites=${titleWrites} cardoptWrites=${r.cardoptWrites} cardoptTwice=${r.cardoptTwice} boxes=${r.boxes} worstFrame=${r.worstFrames[0]}ms fitted=${fitted}`)
  await c.close()
}
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — scrolling stays smooth')
process.exit(fails ? 1 : 0)
