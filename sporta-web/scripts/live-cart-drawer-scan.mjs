// READ-ONLY look at the bag drawer on the LIVE storefront, exactly as served.
//
//   node scripts/live-cart-drawer-scan.mjs
//
// Opens the drawer and measures it at 390 and 1280px (Arabic, the default language).
// Adds nothing to the cart, types nothing, submits nothing. It is the check behind
// public/sporta-cart-drawer.css: the live storefront is a compiled build whose source
// is not in this repo, so the drawer's layout can only be changed by add-on CSS and
// only confirmed by measuring the real page.
//
// Run on the VPS in the Playwright image (npm i playwright@1.49.0 with
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), the same way as admin-payments-scan.mjs.
//
// Expected with sporta-cart-drawer.css live (an empty bag):
//   - the brand tile in the header is hidden (display none)
//   - the count is a pill (height 28)
//   - the empty-state icon sits in a 104px tile, the copy is 18px, the button is at
//     least 224x52
//   - close button and "Back to shop" are at least 44px
//   - nothing overflows sideways
import { chromium } from 'playwright'

const B = 'https://www.sporta.com.kw/'

const measure = (page) => page.evaluate(() => {
  const R = (e) => { if (!e) return 'none'; const b = e.getBoundingClientRect(); return `x${Math.round(b.left)} y${Math.round(b.top)} w${Math.round(b.width)} h${Math.round(b.height)}` }
  const d = document.querySelector('.campaign-cart-drawer')
  if (!d) return ['DRAWER NOT FOUND']
  const hd = d.querySelector(':scope > header')
  const title = hd && hd.querySelector('h2')
  const cnt = hd && hd.querySelector('.purchase-count')
  const mark = hd && hd.querySelector('.cart-drawer__mark')
  const close = hd && hd.querySelector('button')
  const empty = d.querySelector(':scope > div.flex-1')
  const svg = empty && empty.querySelector(':scope > svg')
  const p = empty && empty.querySelector(':scope > p')
  const btn = empty && empty.querySelector(':scope > a.btn')
  const fs = (e) => (e ? getComputedStyle(e).fontSize : '-')
  return [
    `header ${R(hd)}`,
    `close ${R(close)}`,
    `title ${R(title)} fs${fs(title)}`,
    `count ${R(cnt)} fs${fs(cnt)} "${cnt && cnt.textContent}" bg ${cnt ? getComputedStyle(cnt).backgroundColor : '-'}`,
    `brand tile ${mark ? getComputedStyle(mark).display : 'absent'}`,
    `empty ${R(empty)}`,
    `icon ${R(svg)}`,
    `copy ${R(p)} fs${fs(p)}`,
    `button ${R(btn)} fs${fs(btn)} "${btn && btn.textContent.trim()}"`,
    `scrollW ${document.documentElement.scrollWidth} innerW ${innerWidth}`,
  ]
})

const browser = await chromium.launch({ args: ['--no-sandbox'] })
try {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-KW' })
    const pg = await ctx.newPage()
    await pg.goto(B, { waitUntil: 'load', timeout: 90000 })
    await pg.waitForTimeout(2500)
    await pg.evaluate(() => {
      const b = [...document.querySelectorAll('button,a')].find((x) => /cart|bag|حقيب|سلة/i.test(x.getAttribute('aria-label') || ''))
      if (b) b.click()
    })
    await pg.waitForTimeout(1500)
    console.log(`\n== ${w}x${h}`)
    for (const l of await measure(pg)) console.log('  ' + l)
    await ctx.close()
  }
} catch (e) {
  console.log('PROBE_FAIL ' + String(e.message).slice(0, 300))
  process.exitCode = 1
} finally {
  await browser.close()
}
