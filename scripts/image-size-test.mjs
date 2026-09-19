/**
 * No image is delivered smaller than the screen will stretch it — and the
 * mobile artwork is really mobile artwork.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/image-size-test.mjs
 *
 * TWO FAILURES, ONE OF WHICH HAD ALREADY HAPPENED.
 *
 *   1. THE DUPLICATE DIRECTORY. hero/mobile/ and hero/desktop/ were
 *      BYTE-IDENTICAL, all five frames, same sha256 — measured 2026-09-10. The
 *      split existed in the paths and delivered nothing: every phone downloaded
 *      the full 1600px desktop frame to show it in a 390px box, ~294 kB for the
 *      set. Nothing reported it, because every file was present and every URL
 *      answered 200. A directory can be wrong about what it is FOR while being
 *      right about what it contains.
 *
 *   2. THE UPSCALE. An image narrower than the device pixels it is stretched
 *      across is soft, and the softness is invisible to every check this
 *      project owns: the bytes are correct, the hash matches, the URL is 200.
 *      Only a browser at a real device density can see it, so that is what this
 *      uses — the same reason the tap-target scan had to emulate a coarse
 *      pointer before its media query would match.
 *
 * THE ALLOWLIST IS SELF-CLEANING, and that is the part worth keeping. A known
 * gap that cannot be closed here — the desktop hero needs a ~3200px master and
 * the repository has no copy of the artwork above 1600px — would otherwise make
 * this rig red for ever, and a permanently red check is one nobody reads. So it
 * is allowed BY NAME, with the ratio recorded. Two things follow:
 *
 *   - it fails if the ratio gets WORSE, so the gap cannot quietly widen
 *   - it fails if the ratio gets BETTER, telling you to delete the entry. An
 *     allowlist that outlives its reason is how a real signal is trained into
 *     noise, which this repository has already paid for twice.
 */
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const HERO = 'sporta-site/public_html/hero'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}

/** Upscales that cannot be fixed from this repository, with why and how bad.
 *  `ratio` is what was measured when the entry was written. */
const ALLOWED = [
  {
    match: /hero\/desktop\//,
    density: 'desktop 2x',
    ratio: 1.98,
    why: 'the desktop hero needs a ~3200px master; the repo has no copy of this '
       + 'artwork above 1600px, so only the owner can close it',
  },
  {
    // The mobile tiles are a DIFFERENT COMPOSITION from the desktop ones, not a
    // scale of them — measured: desktop art-men is 1.72:1 and mobile is 1.58:1,
    // and the infobar goes 9.90:1 to 2.38:1. So the wider desktop file cannot be
    // resized into a sharper mobile one; it would have to be re-CROPPED, and the
    // crops are deliberate (the tiles put the copy on the reading side). That is
    // a design decision and the owner's, not something to take in passing.
    match: /cats\/mobile\//,
    density: 'phone 3x',
    ratio: 1.19,
    why: 'the mobile tiles are 900px and a 3x phone stretches them to 1074px; '
       + 'they are a different composition from the desktop art, so a sharper '
       + 'one needs the owner to supply or re-crop it at ~1100px',
  },
  {
    match: /cats\/desktop\/infobar/,
    density: 'desktop 2x',
    ratio: 1.36,
    why: 'the info bar is 1920px and a 1440px screen at 2x stretches it to '
       + '2618px; it is the widest thing on the page at 9.90:1, so it needs a '
       + '~2600px master from the owner',
  },
]

/* ------------------------------------------------- 1. the two directories -- */

let names = []
try {
  names = readdirSync(join(HERO, 'desktop')).filter((f) => f.endsWith('.webp'))
} catch { /* reported below */ }

// A rig that finds nothing passes every loop under it. Assert the count first.
check(names.length > 0, 'found the desktop hero artwork', `${names.length} files`)

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

let identical = []
for (const n of names) {
  try {
    if (sha(join(HERO, 'desktop', n)) === sha(join(HERO, 'mobile', n))) identical.push(n)
  } catch {
    identical.push(`${n}(missing)`)
  }
}
check(names.length > 0 && identical.length === 0,
  'the mobile hero is not simply a copy of the desktop hero',
  identical.length ? `${identical.length} identical: ${identical.join(', ')}` : '')

/* ------------------------------------------ 2. what a real screen stretches */

const DENSITIES = [
  ['phone 2x', 390, 844, 2],
  ['phone 3x', 390, 844, 3],
  ['desktop 1x', 1440, 900, 1],
  ['desktop 2x', 1440, 900, 2],
]

// 1.15 rather than 1.00: a browser resampling by a few per cent is not visible,
// and demanding exactness would make every layout tweak a failing test.
const TOLERANCE = 1.15

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const seen = []

try {
  for (const [label, w, h, dpr] of DENSITIES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)

    const rows = await page.evaluate((dpr) => [...document.images]
      .filter((i) => i.currentSrc && i.naturalWidth > 0
        && (i.currentSrc.includes('/hero/') || i.currentSrc.includes('/cats/')))
      .map((i) => {
        const r = i.getBoundingClientRect()
        return {
          src: new URL(i.currentSrc).pathname,
          natural: i.naturalWidth,
          need: Math.round(r.width * dpr),
        }
      }), dpr)

    // Zero images and zero faults produce identical output — this repository's
    // oldest lesson. The count is asserted before anything is concluded from it.
    check(rows.length > 0, `${label}: found images to measure`, `${rows.length}`)

    for (const row of rows) {
      const ratio = +(row.need / row.natural).toFixed(2)
      seen.push({ ...row, ratio, density: label })
    }
    await page.close()
  }
} finally {
  await browser.close()
}

/* --------------------------------------------------------- 3. the verdict -- */

const over = seen.filter((s) => s.ratio > TOLERANCE)

for (const s of over) {
  const allow = ALLOWED.find((a) => a.match.test(s.src) && a.density === s.density)
  if (!allow) {
    check(false, `${s.density}: ${s.src} is not upscaled`,
      `have ${s.natural}px, stretched to ${s.need}px (x${s.ratio})`)
    continue
  }
  check(s.ratio <= allow.ratio,
    `${s.density}: ${s.src} is no worse than the known gap (x${allow.ratio})`,
    `now x${s.ratio} — ${allow.why}`)
}

// The self-cleaning half: an allowlisted case that is now FINE must be removed,
// or the list outlives its reason and stops meaning anything.
for (const a of ALLOWED) {
  const still = seen.some((s) => a.match.test(s.src) && s.density === a.density && s.ratio > TOLERANCE)
  check(still,
    `the allowance for ${a.match.source} at ${a.density} is still needed`,
    'it is no longer upscaled — delete this entry from ALLOWED in this file')
}

const worst = seen.filter((s) => s.ratio <= TOLERANCE)
  .sort((x, y) => y.ratio - x.ratio)[0]
if (worst) {
  console.log(`\n     tightest passing margin: ${worst.src} at ${worst.density}`
    + ` — ${worst.natural}px for ${worst.need}px (x${worst.ratio})`)
}

console.log(fails
  ? `\n${fails} failed`
  : `\nall ok — ${seen.length} renderings measured across ${DENSITIES.length} densities`)
process.exit(fails ? 1 : 0)
