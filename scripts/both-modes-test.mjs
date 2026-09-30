/**
 * Dark AND white, both reachable, and the shopper's choice remembered.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/both-modes-test.mjs
 *
 * THIS IS one-mode-test.mjs INVERTED. On 2026-09-09 the shop was pinned to one
 * mode and that rig asserted the light theme could not be reached; on
 * 2026-09-10 the owner asked for the toggle back, and the guard has to turn
 * round with the decision or it fails the shop for doing what was asked.
 *
 * WHY IT RUNS IN A BROWSER, AFTER HYDRATION. The bundle's ThemeProvider reads
 * `localStorage.sporta_theme` and writes `data-theme` in an effect AFTER
 * hydration. A static read of index.html therefore proves only what the FIRST
 * frame looks like, and the first frame is not where either theme is decided.
 * Every check below runs against a mounted page.
 *
 * WHAT IT ASSERTS:
 *
 *   1. The toggle is on screen. It has no id and no class of its own — the
 *      bundle gives it `tap flex items-center …`, shared with the cart and
 *      wishlist buttons — so it is found by aria-label, and all four strings
 *      are listed because the button names the mode it would switch TO, in
 *      whichever language is loaded.
 *   2. Pressing it changes `data-theme` AND a real computed colour. The
 *      attribute alone would pass on a shop whose light rules had been
 *      deleted, which is exactly the state this repository was one careless
 *      cleanup away from.
 *   3. The choice SURVIVES A RELOAD. That is the whole feature: a preference
 *      nobody remembers is a button that does nothing on the next page.
 *   4. NEITHER mode is pinned. A returning visitor who chose light gets light,
 *      and one who chose dark gets dark — asserted by seeding the key and
 *      loading cold, which is the case the one-mode change worked by breaking.
 *
 * It writes only to the browser's localStorage.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

// The button names the mode it would switch TO, in whichever language loaded.
const TOGGLE = ['Light mode', 'Dark mode', 'الوضع الفاتح', 'الوضع الليلي']
const SELECTOR = TOGGLE.map((l) => `[aria-label="${l}"]`).join(', ')

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

/** Relative luminance of the body's background, as the browser paints it —
 *  the thing a shopper actually sees, rather than the attribute claiming it. */
const LOOK = () => {
  const cs = getComputedStyle(document.body)
  const m = (cs.backgroundColor || '').match(/[\d.]+/g)
  const lum = m ? Math.round(0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]) : null
  return { theme: document.documentElement.getAttribute('data-theme'), bg: cs.backgroundColor, lum }
}

const open = async (seed) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  if (seed) await page.addInitScript((v) => { try { localStorage.setItem('sporta_theme', v) } catch (e) {} }, seed)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  return { ctx, page }
}

// --- 1. the toggle exists -------------------------------------------------
let { ctx, page } = await open(null)
const toggle = page.locator(SELECTOR).first()
const visible = await toggle.count() > 0 && await toggle.isVisible().catch(() => false)
check(visible, 'the theme toggle is on screen for a shopper',
  visible ? await toggle.getAttribute('aria-label') : 'no element matched any of the four labels')

// --- 2. it changes the attribute AND the paint ----------------------------
if (visible) {
  const before = await page.evaluate(LOOK)
  await toggle.click()
  await page.waitForTimeout(1200)
  const after = await page.evaluate(LOOK)

  check(before.theme !== after.theme, 'pressing it switches the mode',
    `${before.theme} -> ${after.theme}`)
  // The colour, not just the attribute: an attribute that flips over deleted
  // rules is a toggle that does nothing a shopper can see.
  check(before.lum !== null && after.lum !== null && Math.abs(after.lum - before.lum) > 60,
    'and the shop actually repaints, not just the attribute',
    `background luminance ${before.lum} -> ${after.lum}`)

  // --- 3. and it is remembered --------------------------------------------
  const chosen = after.theme
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const back = await page.evaluate(LOOK)
  check(back.theme === chosen, 'the choice survives a reload',
    `chose ${chosen}, came back ${back.theme}`)
}
await ctx.close()

// --- 4. neither mode is pinned -------------------------------------------
// Seeded and loaded COLD, because this is the case the one-mode change worked
// by breaking: it overwrote the stored value before any module ran, so a
// visitor who had chosen light silently got dark.
for (const want of ['light', 'dark']) {
  const o = await open(want)
  const got = await o.page.evaluate(LOOK)
  check(got.theme === want, `a returning visitor who chose ${want} gets ${want}`,
    `data-theme=${got.theme} bg=${got.bg}`)
  await o.ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — both modes, the shopper chooses, and the choice sticks')
process.exit(fails ? 1 : 0)
