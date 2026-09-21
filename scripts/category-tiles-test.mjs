/**
 * The home page's four category tiles open their own page, not /shop.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/category-tiles-test.mjs
 *
 * A REAL CLICK, not just the href attribute. category-tiles.js's own header
 * explains why: these are React Router Links, and changing the DOM href
 * alone does not stop the SPA's own click handler from client-routing to
 * whatever it was originally built with. This rig clicks each tile the way
 * a shopper would and asserts the resulting URL, which is the only way to
 * catch a fix that corrected the attribute and missed the click.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4300'
let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const TILES = [
  ['tile-men', '/men'],
  ['tile-women', '/women'],
  ['tile-acc', '/accessories'],
  ['tile-outlet', '/outlet'],
]

for (const [cls, want] of TILES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    const href = await page.evaluate((c) => document.querySelector('.' + c)?.getAttribute('href'), cls)
    check(href === want, `.${cls}'s href attribute is ${want}`, `got ${href}`)

    await page.click('.' + cls)
    await page.waitForTimeout(1200)
    const path = new URL(page.url()).pathname
    check(path === want, `clicking .${cls} actually navigates to ${want}`, `landed on ${path}`)
    check(!page.url().includes('/shop'), `.${cls} does not fall back to /shop`)
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — every home-page tile opens its own category page')
process.exit(fails ? 1 : 0)
