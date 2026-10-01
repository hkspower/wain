/** Every control icon is the same weight: 1.5px, round, non-scaling. node scripts/icon-weight-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
let seen = 0
for (const [vp, touch] of [[{ width: 390, height: 844 }, true], [{ width: 1280, height: 800 }, false]]) {
  for (const lang of ['en', 'ar']) for (const path of ['/', '/shop', '/product/vanquish-tank-navy', '/about', '/contact', '/track']) {
    const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
    await p.goto(`${BASE}${path}?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
    const bad = await p.evaluate(() => {
      const out = []; let n = 0
      for (const s of document.querySelectorAll('svg')) {
        const r = s.getBoundingClientRect()
        if (!r.width || r.width > 40 || s.closest('.cat-tile') || s.closest('picture')) continue
        if (s.parentElement && s.parentElement.matches('article > a > button:not([aria-pressed])')) continue   // the owner's bold card "+" (44-product-grid-spec.css)
        if (s.getAttribute('fill') !== 'none' || s.getAttribute('stroke') !== 'currentColor') continue
        n++
        const cs = getComputedStyle(s); const sh = s.querySelector('path, circle, line, polyline, polygon, rect, ellipse')
        const ve = sh ? getComputedStyle(sh).vectorEffect : ''
        if (cs.strokeWidth !== '1.5px' || cs.strokeLinecap !== 'round' || cs.strokeLinejoin !== 'round' || ve !== 'non-scaling-stroke')
          out.push([Math.round(r.width), cs.strokeWidth, cs.strokeLinecap, ve].join(' '))
      }
      return { out, n }
    })
    seen += bad.n
    check(bad.out.length === 0, `${vp.width}px ${lang} ${path}: ${bad.n} icons all 1.5px round non-scaling`, bad.out.slice(0, 3).join(' | '))
    await p.context().close()
  }
}
check(seen > 100, 'a real number of icons was measured (a rig that finds none proves nothing)', String(seen))
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
