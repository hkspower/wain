/** "Best sellers" heading matches "Shop by category": same band, face, weight, size, colour. node scripts/best-sellers-bar-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [name, vp, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  for (const lang of ['ar', 'en']) {
    const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
    await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(2500)
    const m = await p.evaluate(() => {
      const cat = [...document.querySelectorAll('h2')].find((h) => h.className.includes('text-slate-900'))
      const best = document.querySelector('.sporta-home-products__heading')
      if (!cat || !best) return null
      const f = (h) => { const c = getComputedStyle(h), a = getComputedStyle(h, '::after'), r = h.getBoundingClientRect()
        return { bg: c.backgroundColor, color: c.color, font: c.fontFamily.split(',')[0], weight: c.fontWeight, size: c.fontSize, align: c.textAlign,
          pad: c.padding, barW: a.width, barH: a.height, barBg: a.backgroundColor, barBottom: a.bottom, left: Math.round(r.left), width: Math.round(r.width) } }
      return { cat: f(cat), best: f(best) }
    })
    const t = `${name} ${lang}`
    if (!m) { check(false, `${t}: both headings found`); continue }
    for (const k of Object.keys(m.cat)) check(m.cat[k] === m.best[k], `${t}: ${k} matches`, m.cat[k] === m.best[k] ? '' : `${m.cat[k]} vs ${m.best[k]}`)
    const cardsInside = await p.evaluate(() => { const g = document.querySelector('.sporta-home-products__grid'); const r = g.firstElementChild.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 })
    check(cardsInside, `${t}: cards keep a gutter`)
    await p.context().close()
  }
}
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
