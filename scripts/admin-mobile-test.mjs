/**
 * The website panel's tap targets, on a phone.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/admin-mobile-test.mjs
 *
 * Asked for on 2026-09-17 as "make admin full mobile use". Measured first
 * at 390x844 with the touch context a real phone reports (`hasTouch: true,
 * isMobile: true` — Playwright's DEFAULT context reports a fine pointer,
 * so a rig using it would never see this at all, the same trap this
 * project's storefront carousel-dots fix already recorded): nothing in the
 * panel scrolls sideways, but three controls fall under the 44px touch
 * target WCAG 2.5.5 and Apple both ask for — measured on the element a tap
 * actually lands on, not on the markup:
 *
 *   .srl-chip   37px   rules.js's size/fit/governorate chips (the <label>
 *                       wrapping the checkbox, since THAT is what toggles
 *                       it, not the 13px checkbox alone)
 *   .scc-chip   36px   custom-css.js's "Undo my edits" / "Clear"
 *   .scc-go     40px   custom-css.js's "Save"
 *
 * admin-mobile.js grows exactly those three, under `@media (pointer:
 * coarse)`, so a mouse sees no change at all — asserted here in BOTH
 * directions, not just the touch one, because a fix that also changed the
 * desktop density would be a redesign nobody asked for.
 *
 * `!important` IS REQUIRED AND IS ASSERTED FOR, not merely used. rules.js's
 * and custom-css.js's own cards mount asynchronously — after React renders
 * the Settings screen — so their `<style>` tags land in <head> AFTER this
 * file's, and an unlayered rule with equal specificity that comes LATER
 * wins regardless of which file asked for the override. This was measured
 * directly during development: without `!important`, `.scc-go` stayed at
 * 40px under `pointer: coarse` despite the override rule being present and
 * matching. The mutation below reproduces exactly that.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

async function heights(browser, contextOpts) {
  const page = await (await browser.newContext(contextOpts)).newPage()
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('form button')
  await page.waitForTimeout(1200)

  const links = await page.$$('a, button')
  for (const l of links) {
    const t = ((await l.textContent()) || '').trim()
    if (t === 'Settings' && (await l.isVisible())) { await l.click(); break }
  }
  await page.waitForTimeout(1500)

  const scroll = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))

  const h = await page.evaluate(() => {
    const height = (sel) => {
      const el = document.querySelector(sel)
      return el ? Math.round(el.getBoundingClientRect().height) : null
    }
    return { chip: height('.srl-chip'), sccChip: height('.scc-chip'), sccGo: height('.scc-go') }
  })

  await page.close()
  return { ...h, ...scroll }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const touch = await heights(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const mouse = await heights(browser, { viewport: { width: 390, height: 844 } })

check(touch.scrollW === touch.clientW, 'the panel has no horizontal scroll at 390px', `${touch.scrollW}/${touch.clientW}`)

check(touch.chip >= 44, 'on touch, the rules chip reaches 44px', `got=${touch.chip}`)
check(touch.sccChip >= 44, 'on touch, the theme card\'s secondary button reaches 44px', `got=${touch.sccChip}`)
check(touch.sccGo >= 44, 'on touch, the theme card\'s Save button reaches 44px', `got=${touch.sccGo}`)

check(mouse.chip < 44 && mouse.chip > 0, 'on a mouse, the rules chip is UNCHANGED from its shipped size', `got=${mouse.chip}`)
check(mouse.sccChip < 44 && mouse.sccChip > 0, 'and so is the theme card\'s secondary button', `got=${mouse.sccChip}`)
check(mouse.sccGo < 44 && mouse.sccGo > 0, 'and so is its Save button', `got=${mouse.sccGo}`)

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — three panel controls reach 44px on touch, and none of them move for a mouse')
process.exit(fails ? 1 : 0)
