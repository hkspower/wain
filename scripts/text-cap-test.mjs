/** No text above the ceiling anywhere: 26px on a phone, 30px from 768px (the 404 numeral 56px). node scripts/text-cap-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0, measured = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const PAGES = ['/', '/shop', '/men', '/women', '/product/vanquish-tank-navy', '/about', '/contact', '/returns', '/terms', '/privacy', '/track', '/checkout', '/wishlist', '/nope']
for (const [w, touch] of [[390, true], [768, false], [1280, false], [1600, false]]) {
  const cap = w < 768 ? 26 : 30
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage()
  const over = []
  for (const lang of ['en', 'ar']) for (const u of PAGES) {
    await p.goto(`${BASE}${u}?lang=${lang}`, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(700)
    const r = await p.evaluate((cap) => {
      const out = []; let n = 0
      for (const e of document.querySelectorAll('body *')) {
        if (![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue
        const rc = e.getBoundingClientRect(); if (!rc.width || !rc.height) continue
        if (e.closest('script,style,noscript,svg')) continue
        n++
        const fs = parseFloat(getComputedStyle(e).fontSize)
        const limit = e.matches('p.font-display') && /^\d{3}$/.test(e.textContent.trim()) ? 56 : cap
        if (fs > limit + 0.5) out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${Math.round(fs)}px "${e.textContent.trim().slice(0, 18)}"`)
      }
      return { out, n }
    }, cap)
    measured += r.n
    for (const o of r.out) over.push(`${u} ${lang}: ${o}`)
  }
  check(over.length === 0, `${w}px: nothing above ${cap}px`, [...new Set(over)].slice(0, 4).join(' | '))
  await ctx.close()
}
check(measured > 5000, 'a real number of text elements was measured (an empty scan proves nothing)', String(measured))
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
