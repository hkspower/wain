/** The home "Best sellers" grid asks for sized copies, not the 2000px original. node scripts/home-grid-images-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })).newPage()
// Give the first product a real-shaped photo URL; the sandbox's own photographs are 1px.
await p.route('**/api.php?r=products*', async (route) => {
  const res = await route.fetch(); const j = await res.json()
  const list = Array.isArray(j) ? j : j.products
  if (list && list[0]) list[0].image = 'api.php?r=product_image&id=1&v=abcdef123456'
  await route.fulfill({ response: res, json: j })
})
await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
const m = await p.evaluate(() => { const i = document.querySelector('.sporta-home-products__frame img'); return i && { src: i.getAttribute('src'), srcset: i.getAttribute('srcset'), sizes: i.getAttribute('sizes') } })
check(!!m, 'the first best seller has a photo')
check(m && /[?&]w=400&q=2/.test(m.src), 'the default picture is the 400px copy', m && m.src)
check(m && / 400w,.* 600w,.* 800w/.test(m.srcset || ''), 'and the srcset offers 400, 600 and 800', m && m.srcset)
check(m && /50vw/.test(m.sizes || ''), 'with sizes, so a 3x phone picks what it needs')
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
