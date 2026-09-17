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
 *   3. THE BOX IS THE PICTURE'S OWN SHAPE, in BOTH directions — 2026-09-17.
 *      This check used to be "the 60svh cap still binds at 1280x900", pinning
 *      the hero to the 60% the owner had chosen twice. They then asked for the
 *      banner full size and picked "the whole picture everywhere" out of three
 *      measured options, so the cap and our 1.90 ratio are gone and the only
 *      rule left is 100vw/2.52. That makes the invariant stronger and simpler
 *      than the pair it replaces: a box TALLER than the artwork crops its
 *      sides, a box SHORTER crops its top and bottom, so requiring the two
 *      ratios to be equal is the whole of "full size" and cannot be satisfied
 *      by a crop in either direction.
 *
 *      It is measured against the image's OWN natural size, so a wider banner
 *      keeps testing the truth rather than a 2.52 copied out of a comment.
 *
 * WHAT IT REPORTS BUT DOES NOT FAIL: source pixels per CSS pixel, which is the
 * sharpness question and is bounded by the artwork rather than by any rule
 * here. The five frames exist only at 1600px wide, and at 1920 the box is 2112
 * CSS px, so the banner is upscaled before a retina screen doubles anything —
 * 0.76 measured. No stylesheet fixes that; it needs a bigger master. Failing on
 * it would make the suite red for a condition no change in this repository can
 * clear, so it is printed and the phone alone is asserted, where the right
 * files do exist.
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
      // SHARPNESS, as source pixels per CSS pixel of rendered width. Under
      // `cover` the image is magnified to fill whichever axis binds, so the
      // rendered width is not the box width when the two ratios differ —
      // taking the larger of the two is what the browser actually paints.
      natW: img ? img.naturalWidth : 0,
      drawnW: ib && ib.height
        ? Math.max(ib.width, ib.height * (img.naturalWidth / img.naturalHeight))
        : 0,
      file: img ? (img.currentSrc || img.src).split('/').slice(-2).join('/') : '',
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

// --- 3. the box IS the picture's shape, so nothing is cropped either way ---
// The owner asked for the banner full size on 2026-09-17. A box taller than
// the artwork crops its sides; a box shorter crops its top and bottom. Equal
// ratios is the whole of it, and unlike the pair of checks it replaces it
// cannot be satisfied by a crop in either direction.
//
// 1% of slack, because the rendered box is a fractional number of CSS pixels
// and 2.52 is itself a rounding of 1600/635.
const offShape = rows.filter((r) => r.art && Math.abs(r.box - r.art) / r.art > 0.01)
check(offShape.length === 0,
  'every viewport shows the WHOLE banner — the box is the artwork\'s own ratio',
  offShape.map((r) => `${r.w}x${r.h} box ${r.box.toFixed(2)}:1 vs art ${r.art.toFixed(2)}:1 — ${Math.round(100 * Math.min(r.box, r.art) / Math.max(r.box, r.art))}% of it visible`).join(', '))

// --- sharpness: reported, and asserted only where it is ours to control ----
console.log('\n     viewport      file                             srcPx/cssPx')
for (const r of rows) {
  const d = r.drawnW ? r.natW / r.drawnW : 0
  console.log(`     ${`${r.w}x${r.h}`.padEnd(13)} ${(r.file || '?').padEnd(32)} ${d.toFixed(2)}${d < 1 ? '   <- upscaled at 1x' : ''}`)
}

// The phone is the one where the right file already exists (hero/mobile is
// 1200px for a box ~430 CSS px wide), so an upscale there would be a mistake
// in this repository rather than a limit of the artwork.
const phone = rows.find((r) => r.w === 390)
const phoneD = phone && phone.drawnW ? phone.natW / phone.drawnW : 0
check(phoneD >= 1.5, 'the phone banner is not upscaled',
  phone ? `${phoneD.toFixed(2)} source px per CSS px from ${phone.file}` : 'not measured')

// Reported: the desktop ceiling, which is the artwork and not a rule here.
const soft = rows.filter((r) => r.drawnW && r.natW / r.drawnW < 1)
if (soft.length) {
  console.log(`\n--   ${soft.length} viewport(s) upscale the banner even at 1x DPR:`)
  for (const r of soft) {
    console.log(`       ${r.w}x${r.h}  needs ${Math.round(r.drawnW)}px of artwork, has ${r.natW}px`)
  }
  console.log('     The five frames exist only at 1600px wide and nothing here can add')
  console.log('     detail that is not in the file. This clears when the 3200px masters')
  console.log('     land in hero/desktop/ — not before, and not by upscaling them.')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the whole banner, at every size, with the shell agreeing')
process.exit(fails ? 1 : 0)
