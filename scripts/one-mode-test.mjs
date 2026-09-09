/**
 * ONE MODE, NOT TWO — the guard that the light theme is unreachable.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/one-mode-test.mjs
 *   BASE=https://www.sporta.com.kw node scripts/one-mode-test.mjs
 *
 * The owner asked on 2026-09-09 for one mode rather than a dark/light pair.
 * Three separate things had to agree for that to be true, and each of them can
 * be undone by an ordinary edit somewhere else:
 *
 *   index.html      pins data-theme and overwrites the `sporta_theme` key
 *                   before the bundle loads
 *   sporta-dark.css hides the header's toggle, which is the only control that
 *                   ever set the key
 *   the bundle      initialises its ThemeProvider from that key and writes
 *                   data-theme back in an effect, AFTER hydration
 *
 * THE THIRD IS WHY A STATIC CHECK WOULD NOT DO. Reading index.html and finding
 * `dataset.theme = 'dark'` proves what the first frame looks like and nothing
 * about the frame after React starts — and the frame after React starts is the
 * one the customer reads. Every assertion here is made on a live page, after
 * hydration, in a real browser.
 *
 * THE LIGHT SEED IS THE POINT OF THE SECOND CASE. A visitor who chose light
 * before today still has 'light' in localStorage; if the pin only ran when the
 * key was absent, they would be the one person still seeing the old shop, and
 * nobody would ever notice because a fresh browser looks correct.
 *
 * It writes nothing to the shop: it sets a key in its own throwaway browser
 * profile and reads the DOM.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
  if (!ok) fails++
}

/** The four labels the header's theme button can carry — it shows the mode it
 *  would switch TO, in whichever language is loaded. Kept in step with the
 *  selector in sporta-dark.css; if the bundle is ever rebuilt with different
 *  wording, BOTH move together or this rig passes by finding nothing, which is
 *  this project's favourite way to be lied to. That is why the last case
 *  asserts the button EXISTS in the DOM rather than only that it is invisible:
 *  a label change makes the CSS miss, and a rig that only asked "is anything
 *  visible?" would report success at the moment the toggle came back. */
const LABELS = ['Light mode', 'Dark mode', 'الوضع الفاتح', 'الوضع الليلي']

/* The container's Chromium, by absolute path — the same line every other
   browser rig here carries. Playwright's own bundled build is not installed
   and PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD stops it fetching one. */
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

/** Load `/` with `seed` already in localStorage, and report what settles. */
async function look(seed, colorScheme) {
  const ctx = await browser.newContext({ colorScheme })
  const page = await ctx.newPage()
  // Set before ANY script on the page runs — this is the returning visitor's
  // browser as index.html finds it, not a value poked in afterwards.
  if (seed) {
    await page.addInitScript((t) => {
      try { localStorage.setItem('sporta_theme', t) } catch {}
    }, seed)
  }
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  // The header is rendered by React; waiting for it is waiting for hydration,
  // which is exactly the moment the ThemeProvider's effect has run.
  await page.waitForSelector('header.app-header', { timeout: 15000 })

  const seen = await page.evaluate((labels) => {
    const el = document.documentElement
    const buttons = labels.flatMap((l) =>
      [...document.querySelectorAll(`header.app-header button[aria-label="${l}"]`)]
    )
    return {
      theme: el.dataset.theme ?? '(none)',
      colorScheme: el.style.colorScheme,
      stored: (() => { try { return localStorage.getItem('sporta_theme') } catch { return '(unreadable)' } })(),
      // A page painted light and a page painted dark are told apart by the
      // pixels, not by the attribute that is supposed to cause them. If the
      // stylesheet were ever detached from data-theme, this is what would
      // catch it.
      bodyBg: getComputedStyle(document.body).backgroundColor,
      toggles: buttons.length,
      visibleToggles: buttons.filter((b) => b.offsetParent !== null).length,
    }
  }, LABELS)

  await ctx.close()
  return seen
}

console.log(`--- one mode, at ${BASE}\n`)

/** rgb(r,g,b) -> luminance-ish. A dark page is dark in any of the three. */
const isDark = (css) => {
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(css)
  if (!m) return false
  return (+m[1] + +m[2] + +m[3]) / 3 < 90
}

// 1. A first-time visitor, on a laptop set to light.
const fresh = await look(null, 'light')
check(fresh.theme === 'dark', 'a first-time visitor gets the dark shop', `data-theme=${fresh.theme}`)
check(isDark(fresh.bodyBg), 'and the page is actually painted dark', `body=${fresh.bodyBg}`)

// 2. The returning visitor who chose light before today.
const returning = await look('light', 'light')
check(returning.theme === 'dark', 'a visitor who had chosen light gets dark too', `data-theme=${returning.theme}`)
check(isDark(returning.bodyBg), 'and their page is painted dark as well', `body=${returning.bodyBg}`)
check(returning.stored === 'dark', 'the stored choice is rewritten, not just overridden', `sporta_theme=${returning.stored}`)

// 3. The control that could undo all of it.
check(fresh.toggles > 0, 'the theme button is still found by its label', `matched=${fresh.toggles}`)
check(fresh.visibleToggles === 0, 'and no theme toggle is visible in the header', `visible=${fresh.visibleToggles}`)

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — one mode, and nothing on the page can reach the other')
process.exit(fails ? 1 : 0)
