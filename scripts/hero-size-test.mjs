/**
 * The hero: never cropped, never jumping, and still capped where the cap works.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/hero-size-test.mjs
 *
 * WHY THIS EXISTS. sporta-ui.css spends two hundred lines on the hero's height,
 * and every one of them was written because somebody changed it and something
 * broke. The height has moved eight times; nothing has ever measured it.
 *
 * WHAT WENT WRONG THE LAST TIME, which is what the first check here is for.
 * Every line of reasoning in that file is about a box TALLER than the artwork's
 * 2.52:1 — it crops the SIDES, the crop is pinned at 15%, and the banner's
 * typography lives in the left half and survives. The `60svh` cap silently
 * inverts that: once it binds, `min(100vw/1.90, 60svh)` is no longer a ratio,
 * and on a wide window the box comes out WIDER than 2.52 — so `cover` crops the
 * HEIGHT, and `object-position: 15% center` takes equal bites off the top and
 * the bottom. Measured before the fix:
 *
 *   1920x1080   box 2.96:1    85% of the banner's height    (every 16:9 screen)
 *   1440x700    box 3.43:1    74%    — the strapline clipped off the bottom
 *
 * 16:9 is the commonest desktop shape there is, so that was the normal case.
 * The fix put a floor under the cap — max(100vw/2.52, min(100vw/1.90, 60svh))
 * — and this rig is what stops the floor being tidied away by the next person
 * who reads `max()` inside a `min()` and thinks it is a mistake.
 *
 * WHAT IT ASSERTS, at eight real viewports from a 390px phone to 2560x1440:
 *
 *   1. THE BANNER IS NEVER CROPPED VERTICALLY. Measured as the rendered box's
 *      aspect against the image's OWN naturalWidth/naturalHeight, so it follows
 *      the artwork rather than repeating 2.52 — swap in a wider banner and this
 *      keeps testing the truth instead of a number copied out of a comment.
 *      A side crop is expected and deliberate and is NOT failed.
 *   2. THE SHELL AND THE MOUNTED HERO ARE THE SAME HEIGHT. index.html paints a
 *      .boot-hero before React exists and sporta-ui.css sizes the real one;
 *      the two carry the same formula written out twice, in two files, and had
 *      silently disagreed by up to 152px. That is the single failure the boot
 *      script exists to prevent, and CLS cannot see it — the shell is REMOVED
 *      wholesale rather than moved, so nothing "shifts" by the metric's
 *      definition. It is only ever visible to a person.
 *   3. THE CAP STILL BINDS WHERE IT IS NOT THE PROBLEM. A floor that quietly
 *      became the only rule would give the owner back the tall hero they cut
 *      twice, so 1280x900 is pinned at the 60% they chose.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

// Real shapes, not a sweep: a phone, a tablet, the laptop the cap was tuned on,
// two 16:9 screens, and the short-wide window where the crop was worst.
const VIEWPORTS = [
  [390, 844], [768, 1024], [1280, 900], [1366, 768],
  [1440, 700], [1600, 900], [1920, 1080], [2560, 1440],
]

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const rows = []
for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()

  // THE PRE-PAINT SHELL, caught before React replaces it. `commit` returns as
  // soon as the navigation lands, and the poll then waits for the stylesheet to
  // apply — reading before that measures index.html's inline fallback rather
  // than what a visitor sees, which is a different number and not the one under
  // test.
  await page.goto(BASE + '/', { waitUntil: 'commit' }).catch(() => {})
  let shell = 0
  for (let i = 0; i < 120; i++) {
    shell = await page.evaluate(() => {
      const e = document.querySelector('.boot-hero')
      return e ? Math.round(e.getBoundingClientRect().height) : 0
    }).catch(() => 0)
    if (shell) break
    await page.waitForTimeout(25)
  }
  await page.waitForTimeout(2600)

  const m = await page.evaluate(() => {
    const s = document.querySelector('.hero-strength')
    if (!s) return null
    const r = s.getBoundingClientRect()
    const img = s.querySelector('img')
    const ib = img ? img.getBoundingClientRect() : null
    return {
      hero: Math.round(r.height),
      pct: Math.round((r.height / window.innerHeight) * 100),
      box: ib && ib.height ? ib.width / ib.height : 0,
      // The ARTWORK's own shape, read off the decoded file rather than assumed.
      art: img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
      loaded: !!(img && img.naturalWidth),
    }
  })
  rows.push({ w, h, shell, ...(m ?? {}) })
  await ctx.close()
}
await browser.close()

console.log(`--- the hero at ${VIEWPORTS.length} viewports\n`)
console.log('     viewport      shell  mounted  boxAR  artAR  heightKept  ofScreen')
for (const r of rows) {
  const kept = r.box && r.art ? Math.min(1, r.art / r.box) : 0
  console.log(
    `     ${`${r.w}x${r.h}`.padEnd(13)} ${String(r.shell).padEnd(6)} ${String(r.hero).padEnd(8)} ` +
    `${(r.box || 0).toFixed(2).padEnd(6)} ${(r.art || 0).toFixed(2).padEnd(6)} ` +
    `${`${Math.round(kept * 100)}%`.padEnd(11)} ${r.pct}%`)
}
console.log('')

// The rig has to have found a hero at all — otherwise every check below passes
// by measuring nothing, which is this repository's favourite way to be lied to.
const missing = rows.filter((r) => !r.hero)
check(missing.length === 0, 'the hero renders at every viewport',
  missing.map((r) => `${r.w}x${r.h}`).join(', '))
const unloaded = rows.filter((r) => !r.loaded)
check(unloaded.length === 0, 'and its banner decoded, so its real shape is known',
  unloaded.map((r) => `${r.w}x${r.h}`).join(', '))

// --- 1. never cropped vertically ------------------------------------------
// A box WIDER than the artwork crops the top and the bottom. A box taller
// crops the sides, which is deliberate and is not failed here.
const cropped = rows.filter((r) => r.art && r.box > r.art * 1.01)
check(cropped.length === 0, 'no viewport crops the banner top and bottom',
  cropped.map((r) => `${r.w}x${r.h} box ${r.box.toFixed(2)}:1 vs art ${r.art.toFixed(2)}:1 — ${Math.round(100 * r.art / r.box)}% kept`).join(', '))

// --- 2. the shell and the hero are the same height -------------------------
const jump = rows.filter((r) => Math.abs(r.hero - r.shell) > 2)
check(jump.length === 0, 'the pre-paint shell matches the mounted hero everywhere',
  jump.map((r) => `${r.w}x${r.h} ${r.shell}px -> ${r.hero}px (${r.hero - r.shell >= 0 ? '+' : ''}${r.hero - r.shell})`).join(', '))

// --- 3. the cap still does its job ----------------------------------------
// 1280x900 is the window the 60svh cap was tuned on, and the owner cut the
// hero to 60% of it twice. A floor that swallowed the cap would hand that back.
const laptop = rows.find((r) => r.w === 1280 && r.h === 900)
check(!!laptop && laptop.pct <= 62 && laptop.pct >= 58,
  'the 60svh cap still binds on a 1280x900 laptop',
  laptop ? `${laptop.hero}px, ${laptop.pct}% of the screen` : 'not measured')

// Reported: how much of the first screen the banner takes once the floor wins.
const tall = rows.filter((r) => r.pct > 75)
if (tall.length) {
  console.log(`\n--   ${tall.length} viewport(s) where the floor beats the cap and the hero is over 75%:`)
  for (const r of tall) console.log(`       ${r.w}x${r.h}  ${r.hero}px, ${r.pct}% of the first screen`)
  console.log('     This is the trade the owner chose on 2026-09-10: a whole banner,')
  console.log('     edge to edge, at the cost of the fold on short wide windows.')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the whole banner, at every size, with the shell agreeing')
process.exit(fails ? 1 : 0)
