/** The utility pages share one title, one primary button and one starting height. node scripts/utility-pages-test.mjs */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [name, vp, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) for (const lang of ['en', 'ar']) {
  const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
  const seen = {}
  for (const u of ['/cart', '/wishlist', '/track', '/about', '/terms']) {
    await p.goto(`${BASE}${u}?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
    seen[u] = await p.evaluate(() => {
      const h = document.querySelector('main h1'); const cs = getComputedStyle(h); const bar = getComputedStyle(h, '::after')
      const hr = h.getBoundingClientRect(), hd = document.querySelector('header').getBoundingClientRect()
      const btn = [...document.querySelectorAll('main a')].find((a) => /Back to shop|العودة|تسوق|المتجر/.test(a.textContent))
      return { font: cs.fontFamily.split(',')[0].replace(/['"]/g, ''), weight: cs.fontWeight, color: cs.color, bar: bar.width, top: Math.round(hr.top - hd.bottom),
        btn: btn ? getComputedStyle(btn).backgroundColor : null, align: cs.textAlign }
    })
  }
  const L = `${name} ${lang}`
  const vals = Object.values(seen)
  check(vals.every((v) => v.font === 'Alexandria' && v.weight === '700' && v.color === 'rgb(23, 26, 30)' && v.bar === '56px'), `${L}: every utility page title is the same (Alexandria 700, dark ink on the white body, orange bar)`, Object.entries(seen).map(([k, v]) => `${k}:${v.font}/${v.weight}/${v.bar}`).join(' '))
  const tops = vals.map((v) => v.top)
  check(Math.max(...tops) - Math.min(...tops) <= 12, `${L}: and every one starts at the same height under the header (within 12px)`, Object.entries(seen).map(([k, v]) => `${k}:${v.top}`).join(' '))
  check(seen['/cart'].btn && seen['/cart'].btn === seen['/wishlist'].btn, `${L}: the empty bag and the empty wishlist share one "Back to shop" button`, `${seen['/cart'].btn} vs ${seen['/wishlist'].btn}`)
  check(seen['/cart'].align === 'center' && seen['/wishlist'].align !== 'center', `${L}: a centred page keeps a centred title, the others start-aligned`)
  await p.context().close()
}
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
