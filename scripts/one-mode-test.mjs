/**
 * One mode, dark only — and a returning visitor who once chose light must
 * not still be able to see it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/one-mode-test.mjs
 *
 * THIS IS both-modes-test.mjs INVERTED, THE SECOND TIME. On 2026-09-09 the
 * shop was pinned to one mode; on 2026-09-10 the owner asked the toggle
 * back and this file's predecessor was replaced by both-modes-test.mjs; now
 * asked for again, 2026-09-20. Same reasoning both times: a guard has to
 * turn round with the decision or it fails the shop for doing what was
 * asked.
 *
 * WHY IT RUNS IN A BROWSER, AFTER HYDRATION, same as its predecessor: the
 * bundle's ThemeProvider reads localStorage in an effect after hydration, so
 * a static read of index.html proves only the first frame.
 *
 * WHAT IT ASSERTS:
 *
 *   1. The toggle is NOT on screen. Not merely inert — gone, so a shopper is
 *      never shown a control that does nothing, which is worse than no
 *      control at all.
 *   2. A visitor who had PREVIOUSLY chosen light — seeded and loaded cold,
 *      the exact case this change works by breaking — still gets dark. This
 *      is the one this file's own history says matters most: the write in
 *      index.html's boot script is what actually pins everyone, and a check
 *      that only loads fresh would never catch a stale light choice
 *      surviving.
 *   3. The shop actually REPAINTS dark, not just the attribute — a computed
 *      background luminance, not the label alone, which would pass on a
 *      shop whose dark rules had quietly stopped applying.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

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

// --- 1. the toggle is gone, in both languages -----------------------------
for (const lang of ['en', 'ar']) {
  const { ctx, page } = await open(null)
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1500)
  const toggle = page.locator(SELECTOR).first()
  const visible = await toggle.count() > 0 && await toggle.isVisible().catch(() => false)
  check(!visible, `the theme toggle is gone for a shopper (${lang})`,
    visible ? `still matched ${await toggle.getAttribute('aria-label')}` : '')
  await ctx.close()
}

// --- 2 & 3. a visitor who once chose light gets dark, and it really paints -
// Seeded and loaded COLD — the case this change works by breaking: the boot
// script must overwrite the stored choice before any module runs.
for (const seeded of ['light', 'dark', null]) {
  const { ctx, page } = await open(seeded)
  const got = await page.evaluate(LOOK)
  check(got.theme === 'dark',
    `a visitor ${seeded ? `who chose ${seeded} before` : 'with no saved choice'} gets dark`,
    `data-theme=${got.theme} bg=${got.bg}`)
  // The colour, not just the attribute — an attribute that says 'dark' over
  // deleted rules is a label with nothing behind it.
  check(got.lum !== null && got.lum < 60,
    'and the page actually paints dark, not just the attribute',
    `background luminance ${got.lum}`)
  await ctx.close()
}

// --- 4. it survives a reload too, not only a cold load --------------------
{
  const { ctx, page } = await open('light')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const got = await page.evaluate(LOOK)
  check(got.theme === 'dark', 'and survives a reload of a page that started light',
    `data-theme=${got.theme}`)
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — one mode, dark only, and nobody can still be pinned to light')
process.exit(fails ? 1 : 0)
