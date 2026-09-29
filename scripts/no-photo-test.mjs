// A product with no photograph must show the Sporta placeholder, and one with a
// photograph must keep its photograph. Reads the COMPUTED content, not the CSS.
import { chromium } from 'playwright-core'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
let bad = 0
const check = (ok, m) => { console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) bad++ }
for (const [w, h] of [[390, 844], [1280, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${BASE}/product/cagliari-calcio-backpack?lang=en`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  const ph = await p.$$eval('img[src^="data:image/svg+xml"]', (a) =>
    a.map((i) => ({ c: getComputedStyle(i).content, w: i.getBoundingClientRect().width })).filter((x) => x.w > 100))
  check(ph.length > 0, `${w}px: the no-photo product shows placeholder pictures (${ph.length})`)
  check(ph.every((x) => x.c.includes('no-photo.svg')), `${w}px: every one is the Sporta placeholder`)
  await p.goto(`${BASE}/product/vanquish-tank-navy?lang=en`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  const real = await p.$$eval('img[src*="product_image"]', (a) => a.map((i) => getComputedStyle(i).content))
  check(real.length > 0 && real.every((c) => c === 'normal'), `${w}px: a real photograph is left alone (${real.length})`)
  await p.close()
}
const svg = await (await fetch(`${BASE}/assets/no-photo.svg`)).text()
check(svg.includes('Photo coming soon') && svg.includes('data:image/webp'), 'the placeholder file serves, with its logo embedded')
await b.close()
console.log(bad ? `\n${bad} failed` : '\nall ok — an empty product shows the Sporta placeholder')
process.exit(bad ? 1 : 0)
