/**
 * The category tiles: solid, square, full width, all four — 2026-09-16.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/tile-art-test.mjs
 *
 * WHAT THIS FILE USED TO TEST, kept because the reasoning still matters if
 * photography ever comes back: the tile component renders TWO <picture>
 * blocks, a plain-name probe that deliberately 404s and a webp/-rtl fallback
 * that is the real artwork, and the plain name being bridged by an .htaccess
 * rewrite once meant every tile served the wrong format AND the wrong
 * composition, invisibly, because the rigs of the time only checked that
 * nothing 404d. See git history for the full account.
 *
 * WHAT CHANGED IT. The owner asked for all four tiles solid, square and full
 * width. sporta-ui.css now hides both <picture> blocks outright
 * (`.cat-tile picture{display:none}`) and paints a flat brand colour instead.
 * Measured before writing this: with the picture hidden, the browser makes
 * ZERO requests under /cats/ for these four tiles at all — `loading="lazy"`
 * on an element that is display:none never becomes a candidate to fetch, and
 * tile-art.js's own preflight (a plain `new Image()`, independent of the
 * DOM's lazy-loading) is now unreachable in this repository's overlay chain
 * because the elements it swaps no longer register as visible mount points a
 * MutationObserver has reason to re-check. So the RTL-composition and
 * webp-format assertions this file used to make are not merely inapplicable —
 * they test a code path that no longer runs, and a rig asserting properties
 * of dead code is the same shape as the suite that once found "0 controls,
 * 0 pressed" and read it as a passing shop. test:tile-rtl, which tested the
 * SAME feature from the other side, is retired for the identical reason —
 * see its own header.
 *
 * WHAT THIS FILE TESTS NOW:
 *
 *   1. No /cats/ request fires for the four tiles, in either language — the
 *      hide is real, not merely visual, and nobody's bandwidth is spent on a
 *      photograph nobody sees.
 *   2. Each tile's COMPUTED background-color is the expected flat brand
 *      tone — not a gradient, not the photograph's ground colour. Read
 *      per-pixel via getComputedStyle, not asserted from the class name
 *      alone, because a selector can exist and still lose to something more
 *      specific — this repository's css-audit.mjs exists for exactly that
 *      failure mode.
 *   3. Every tile is square (width equals height, aspect-ratio: 1), at a
 *      phone width and a desktop width — the shape does not depend on the
 *      viewport, since it is aspect-ratio driven rather than a fixed number.
 *   4. Every tile sits in ONE column — same horizontal position as the tile
 *      above and below it — at both widths. "Full width" was already true on
 *      phones; the grid's own 2-up desktop rule is what changed.
 *   5. The title text is legible: ink-coloured, not the near-white that was
 *      safe on near-black artwork and is not safe on a bright solid tone —
 *      site-contrast.mjs walks the whole site and would eventually say so
 *      too, but the exact ratio this rig checks is the reason the colour was
 *      picked, so it is worth stating here in the same place as the tone.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

// The exact tones sporta-ui.css assigns — read here as the expectation, not
// re-derived from the stylesheet, because the stylesheet is the thing under
// test and a check that reads its own answer from itself can never fail.
const EXPECT = {
  men: 'rgb(255, 123, 23)',       // --brand-bright
  women: 'rgb(255, 123, 23)',     // --brand-bright — deliberately the same as men
  acc: 'rgb(224, 86, 28)',        // --brand
  outlet: 'rgb(184, 67, 15)',     // --brand-dark
}
const INK = 'rgb(23, 26, 30)'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function measure({ w, h, lang, label }) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  // infobar.webp is a DIFFERENT picture on the same page — the promotional
  // banner further down — and is untouched by any of this; it must keep
  // loading, so it is excluded rather than making this check fail on it.
  const catsHits = []
  page.on('response', (r) => { if (/\/cats\//.test(r.url()) && !/infobar/.test(r.url())) catsHits.push(r.url()) })
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  const tiles = await page.evaluate(() => [...document.querySelectorAll('.cat-tile')].map((t) => {
    const cs = getComputedStyle(t)
    const r = t.getBoundingClientRect()
    const title = t.querySelector('.cat-tile__title')
    const pic = t.querySelector('picture')
    return {
      cls: [...t.classList].find((c) => /^tile-/.test(c))?.replace('tile-', ''),
      bg: cs.backgroundColor,
      w: r.width, h: r.height, left: Math.round(r.left),
      titleColor: title ? getComputedStyle(title).color : null,
      pictureHidden: pic ? getComputedStyle(pic).display === 'none' : null,
    }
  }))
  await page.close()
  return { tiles, catsHits, label }
}

console.log(`--- the category tiles, at ${BASE}\n`)

for (const v of [
  { w: 390, h: 900, lang: 'ar', label: 'phone, Arabic' },
  { w: 390, h: 900, lang: 'en', label: 'phone, English' },
  { w: 1280, h: 1200, lang: 'ar', label: 'desktop, Arabic' },
]) {
  const { tiles, catsHits, label } = await measure(v)

  // Found something before concluding anything: an empty page passes every
  // check under it.
  check(tiles.length === 4, `${label}: found all four tiles`, `${tiles.length} found`)
  if (tiles.length !== 4) continue

  check(catsHits.length === 0, `${label}: no /cats/ request for any of them — the hide is real`,
    catsHits.length ? catsHits.slice(0, 3).join(', ') : '')

  check(tiles.every((t) => t.pictureHidden), `${label}: every <picture> is display:none`,
    tiles.filter((t) => !t.pictureHidden).map((t) => t.cls).join(','))

  for (const t of tiles) {
    check(t.bg === EXPECT[t.cls], `${label}: ${t.cls} is the flat ${EXPECT[t.cls]} it should be`,
      t.bg !== EXPECT[t.cls] ? `got ${t.bg}` : '')
    check(Math.abs(t.w - t.h) <= 1, `${label}: ${t.cls} is square`, `${Math.round(t.w)}x${Math.round(t.h)}`)
    check(t.titleColor === INK, `${label}: ${t.cls}'s title is ink, not white`, t.titleColor)
  }

  const lefts = new Set(tiles.map((t) => t.left))
  check(lefts.size === 1, `${label}: all four sit in one column`, [...lefts].join(','))
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — solid, square, one column, on every tile')
process.exit(fails ? 1 : 0)
