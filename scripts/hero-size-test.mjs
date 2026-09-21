/**
 * The hero: fills the screen, never jumps, and crops symmetrically doing it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/hero-size-test.mjs
 *
 * WHY THIS EXISTS. sporta-ui.css spends two hundred lines on the hero's height,
 * and every one of them was written because somebody changed it and something
 * broke. The height has moved nine times; nothing has ever measured it.
 *
 * THE OLD INVARIANT WAS "NEVER CROPPED" AND IT IS GONE — 2026-09-18, asked for
 * in as many words: fill the whole screen, sides cropped rather than the whole
 * banner shown. That is a straight reversal of the 2026-09-17 choice this file
 * used to assert, made with the trade named plainly before it shipped rather
 * than discovered after. The history below is kept because the cap-inversion
 * bug it documents can recur under a fixed-height rule exactly as it did under
 * a ratio one — a box whose proportions differ from the artwork's always
 * crops SOMETHING, and which axis depends on which one is currently used as
 * the height source.
 *
 * WHAT WENT WRONG WHEN THIS FIRST HAD A CAP, kept for the shape of the bug:
 * every early version of the reasoning was about a box TALLER than the
 * artwork's 2.52:1 — it crops the SIDES, the crop is pinned at 15%, and the
 * banner's typography lives in the left half and survives. A `60svh` cap
 * silently inverted that once it bound: the box came out WIDER than 2.52, so
 * `cover` cropped the HEIGHT instead, and `object-position: 15% center` took
 * equal bites off the top and the bottom — the strapline clipped off the
 * bottom at 1440x700. 16:9 is the commonest desktop shape there is, so that
 * was the normal case, not an edge one.
 *
 * WHAT IT ASSERTS, at eight real viewports from a 390px phone to 2560x1440:
 *
 *   1. THE HERO IS THE WHOLE SCREEN. The rendered box's height must equal
 *      window.innerHeight, not a fraction of it and not more — the box is
 *      measured against the LIVE viewport rather than a percentage copied out
 *      of a comment, so a future cap re-added here is caught the same way a
 *      missing floor was caught before.
 *   2. THE SHELL AND THE MOUNTED HERO ARE THE SAME HEIGHT. index.html paints a
 *      .boot-hero before React exists and sporta-ui.css sizes the real one;
 *      the two carry the same formula written out twice, in two files, and had
 *      silently disagreed by up to 152px before. That is the single failure
 *      the boot script exists to prevent, and CLS cannot see it — the shell is
 *      REMOVED wholesale rather than moved, so nothing "shifts" by the
 *      metric's definition. It is only ever visible to a person.
 *
 * WHAT IT REPORTS BUT DOES NOT FAIL: how much of the banner's width survives
 * the crop, and source pixels per CSS pixel. Both are the artwork's own
 * resolution and the viewport's own shape deciding, not a rule here — failing
 * on either would make the suite red for a condition nothing in this
 * repository can clear on its own. The phone number is worth reading anyway:
 * filling the screen means a phone box is far narrower relative to its height
 * than the artwork is, so `cover` scales off the HEIGHT rather than the width
 * and the 1200px mobile master — sized for the old ratio-based box — is now
 * upscaled rather than downscaled. That clears only with a taller mobile
 * composition of its own, which is a design decision and not a number to
 * tune.
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

  // THE PRE-PAINT SHELL, caught before React replaces it. A 25ms poll loop
  // used to do this and MISSED it outright at some viewports (measured:
  // 1440x700 came back "0" on a run where the shell demonstrably existed —
  // a manual per-25ms trace of the same page found it alive for exactly one
  // tick before React swapped it out). Hydrating a bundle already sitting on
  // local disk is fast enough that the shell's whole lifetime can be shorter
  // than the poll interval that was supposed to catch it. A MutationObserver
  // installed before navigation (via addInitScript, so it exists from the
  // very first paint) records the height the INSTANT `.boot-hero` appears,
  // synchronously in its own callback, rather than sampling and hoping the
  // window lines up.
  await page.addInitScript(() => {
    window.__shellH = 0
    const capture = () => {
      const e = document.querySelector('.boot-hero')
      if (!e) return false
      window.__shellH = Math.round(e.getBoundingClientRect().height)
      return true
    }
    // Observe `document` itself, not `document.documentElement` — an
    // init script runs before the parser has produced an `<html>` element at
    // all, so `document.documentElement` is null at this point and calling
    // `.observe()` on it throws, silently, inside the page — every capture
    // this was meant to make came back 0 the one time that mistake shipped.
    // `document` always exists, parsed or not, and `<html>` arriving is
    // itself a childList mutation on it.
    if (!capture()) {
      const mo = new MutationObserver(() => { if (capture()) mo.disconnect() })
      mo.observe(document, { childList: true, subtree: true })
    }
  })
  await page.goto(BASE + '/', { waitUntil: 'commit' }).catch(() => {})
  await page.waitForTimeout(600)
  let shell = await page.evaluate(() => window.__shellH).catch(() => 0)
  await page.waitForTimeout(2600)

  const m = await page.evaluate(() => {
    // NOT `.hero-strength`. That was a real class name once, for a themed
    // fallback banner this bundle no longer renders when hero_slides has
    // active rows — checked live: with four real slides in the database, the
    // class exists nowhere in the DOM, and a rig that keys off it finds
    // nothing at EVERY viewport rather than failing on the one theme that
    // changed. The hero is a horizontal carousel track instead: three
    // (or more) full-viewport slides sit side by side, each an <img> whose
    // src carries `r=slide_image`, translated so only one is at x=0 at a
    // time. Finding the CONTENT (a slide photograph) rather than a class
    // Tailwind or a future redesign can rename is what survives the next
    // theme change the way this test's own comment already argues for
    // everything else it measures.
    const imgs = Array.from(document.querySelectorAll('img[src*="r=slide_image"]'))
    if (!imgs.length) return null
    // Whichever slide is CURRENTLY SCROLLED INTO VIEW — its wrapper's left
    // edge sits at the viewport's left edge; the others are translated a
    // full viewport width away in either direction.
    let img = imgs[0]
    let s = img.parentElement
    let best = Infinity
    for (const candidate of imgs) {
      const wrap = candidate.parentElement
      const left = Math.abs(wrap.getBoundingClientRect().left)
      if (left < best) { best = left; img = candidate; s = wrap }
    }
    const r = s.getBoundingClientRect()
    const ib = img.getBoundingClientRect()
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

// --- 1. the hero IS the screen, AT EVERY VIEWPORT — 2026-09-21 -------------
// Reversed back to "every shape", on the owner's explicit instruction after
// being shown what it costs: phone and portrait-tablet had been carved out
// (2026-09-18/20) specifically to avoid cropping the banner's width down to
// as little as 18-30% — "full height, any crop" asks for exactly that crop
// back, on every viewport, no exception. pct is round((box height / window
// height) * 100); 1 point of slack for rounding across the two.
const short = rows.filter((r) => Math.abs(r.pct - 100) > 1)
check(short.length === 0, 'the hero fills the whole screen at every viewport',
  short.map((r) => `${r.w}x${r.h} box ${r.hero}px vs window ${r.h}px (${r.pct}%)`).join(', '))

// --- 2. the shell and the hero are the same height -------------------------
const jump = rows.filter((r) => Math.abs(r.hero - r.shell) > 2)
check(jump.length === 0, 'the pre-paint shell matches the mounted hero everywhere',
  jump.map((r) => `${r.w}x${r.h} ${r.shell}px -> ${r.hero}px (${r.hero - r.shell >= 0 ? '+' : ''}${r.hero - r.shell})`).join(', '))

// --- reported: how much of the banner's width the crop keeps ---------------
// Not asserted, deliberately — every ordinary window now crops SOME width,
// which is the whole point of 2026-09-18. Printed so a future change to the
// crop is visible in the log even though it cannot fail the suite.
console.log('\n     viewport      box    art    width kept')
for (const r of rows) {
  const kept = r.box && r.art ? Math.round(100 * Math.min(r.box, r.art) / Math.max(r.box, r.art)) : 0
  console.log(`     ${`${r.w}x${r.h}`.padEnd(13)} ${(r.box || 0).toFixed(2).padEnd(6)} ${(r.art || 0).toFixed(2).padEnd(6)} ${kept}%`)
}

// --- sharpness: reported, and asserted only where it is ours to control ----
console.log('\n     viewport      file                             srcPx/cssPx')
for (const r of rows) {
  const d = r.drawnW ? r.natW / r.drawnW : 0
  console.log(`     ${`${r.w}x${r.h}`.padEnd(13)} ${(r.file || '?').padEnd(32)} ${d.toFixed(2)}${d < 1 ? '   <- upscaled at 1x' : ''}`)
}

// The phone assertion this used to be — hero/mobile is 1200px for a box
// ~430 CSS px wide, sized for the pre-2026-09-18 ratio-based box — no longer
// holds under a fixed-height box: `cover` now scales off the HEIGHT on a
// phone, not the width, and 1200px is not enough to cover a full screen's
// height without upscaling. Reported below with the desktop ceiling rather
// than asserted, because fixing it needs a taller mobile composition — a
// design decision, not a stylesheet number.
const soft = rows.filter((r) => r.drawnW && r.natW / r.drawnW < 1)
if (soft.length) {
  console.log(`\n--   ${soft.length} viewport(s) upscale the banner even at 1x DPR:`)
  for (const r of soft) {
    console.log(`       ${r.w}x${r.h}  needs ${Math.round(r.drawnW)}px of artwork, has ${r.natW}px  (${r.file})`)
  }
  console.log('     The desktop frames exist only at 1600px wide and the mobile ones at')
  console.log('     1200px; nothing here can add detail that is not in the file. The')
  console.log('     desktop ceiling clears when the 3200px masters land in hero/desktop/.')
  console.log('     The phone ceiling needs a mobile composition built for a full-screen')
  console.log('     box rather than the artwork\'s own ratio — the owner\'s to commission.')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — full screen at every size, with the shell agreeing')
process.exit(fails ? 1 : 0)
