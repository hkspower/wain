/**
 * The product page's desktop two-column split: image 55% / info 45%, at the
 * owner's request 2026-09-20 ("For Sporta, I'd make the image area very
 * large. Desktop: 55% image / 45% information. Mobile: 100% image / 100%
 * information").
 *
 *   bash scripts/sandbox.sh   (starts the PHP server on 4300 serving the
 *                              real storefront bundle in sporta-site/public_html —
 *                              NOT this repo's own `dist/`, a separate Expo
 *                              app with no relation to the live storefront)
 *   node scripts/product-column-split-test.mjs
 *
 * MEASURED BEFORE CHANGING ANYTHING: the product page already had a real
 * two-column CSS grid on desktop (`.grid.gap-8.md:grid-cols-2`), not a stack
 * — but at 1.5fr/1fr, i.e. 60%/40%, from an earlier owner request ("a larger
 * photograph", 2026-09-04). This test does not assume a layout; it measures
 * `getBoundingClientRect()` on the grid's own two children and checks the
 * ratio, so it would have caught the 60/40 starting point just as it checks
 * 55/45 now.
 *
 * RTL: Arabic swaps which PHYSICAL side (left/right) each column sits on,
 * not which one is the image column or its share of the grid — so this test
 * finds the image column by content (`.md\:sticky` — the sticky image rail,
 * confirmed against the real DOM, not by left/right position) and checks
 * its percentage of the grid, in both languages, rather than asserting a
 * side.
 *
 * MOBILE REGRESSION: confirms the grid collapses to one column (no split)
 * at 390px, matching product-mobile-layout.js's own scope
 * (`max-width: 767px`) and mirrored here as the CSS's own
 * `min-width: 768px` breakpoint — and that there is no horizontal overflow.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const productsRes = await fetch(BASE + '/api/api.php?r=products').catch(() => null)
let slug = 'cagliari-calcio-backpack'
if (productsRes && productsRes.ok) {
  const products = await productsRes.json()
  if (products[0] && products[0].slug) slug = products[0].slug
}

const TARGET = 55 // percent, image column
const TOLERANCE = 2 // points

for (const lang of ['en', 'ar']) {
  for (const width of [1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(`${BASE}/product/${slug}?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)

    const info = await page.evaluate(() => {
      const h1 = document.querySelector('h1.product-title')
      if (!h1) return null
      let grid = h1
      while (grid && !/md:grid-cols-2/.test(grid.className || '')) grid = grid.parentElement
      if (!grid) return null
      const children = Array.from(grid.children)
      const imageCol = children.find((el) => /\bmd:sticky\b/.test(el.className))
      const infoCol = children.find((el) => el !== imageCol)
      if (!imageCol || !infoCol) return null
      const iw = imageCol.getBoundingClientRect().width
      const fw = infoCol.getBoundingClientRect().width
      return { imagePct: (iw / (iw + fw)) * 100 }
    })

    check(!!info, `${lang} ${width}px: two-column grid found`)
    if (info) {
      const within = Math.abs(info.imagePct - TARGET) <= TOLERANCE
      check(within, `${lang} ${width}px: image column ~${TARGET}%`, `got ${info.imagePct.toFixed(1)}%`)
    }
    await page.close()
  }
}

// Mobile regression: no split, no overflow.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  for (const lang of ['en', 'ar']) {
    await page.goto(`${BASE}/product/${slug}?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    const mobileInfo = await page.evaluate(() => {
      const h1 = document.querySelector('h1.product-title')
      let grid = h1
      while (grid && !/md:grid-cols-2/.test(grid.className || '')) grid = grid.parentElement
      const gridStyle = grid ? getComputedStyle(grid).gridTemplateColumns : null
      const isSingleColumn = gridStyle ? gridStyle.trim().split(/\s+/).length === 1 : null
      return {
        isSingleColumn,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }
    })
    check(mobileInfo.isSingleColumn === true, `${lang} 390px: desktop split does not apply (single column)`)
    check(mobileInfo.scrollWidth <= mobileInfo.clientWidth, `${lang} 390px: no horizontal overflow`,
      `scrollWidth=${mobileInfo.scrollWidth} clientWidth=${mobileInfo.clientWidth}`)
  }
  await page.close()
}

await browser.close()
console.log(fails === 0 ? `\nALL PASS` : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
