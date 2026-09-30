/**
 * Real mobile hero art, from the desktop master.
 *
 *   node scripts/make-hero-sizes.mjs            # report only
 *   node scripts/make-hero-sizes.mjs --write    # write hero/mobile/
 *
 * WHAT IT FIXES. `hero/mobile/` and `hero/desktop/` were BYTE-IDENTICAL —
 * measured 2026-09-10, all five frames, same sha256:
 *
 *   bodybuilding-men.webp   desktop=619cf45e74983010  mobile=619cf45e74983010
 *   bodybuilding-women.webp desktop=157f046e6a987199  mobile=157f046e6a987199
 *   …five of five
 *
 * So the mobile/desktop split existed in the paths and delivered nothing: every
 * phone downloaded the full 1600px desktop frame, ~294 kB across the five, to
 * show it in a box 390 CSS pixels wide. The directory was not wrong about what
 * it contained — it was a copy — it was wrong about what it was FOR.
 *
 * WIDTH, AND WHY 1200 RATHER THAN 800. Measured in a browser at the densities
 * that exist rather than picked: the hero fills the viewport width, so a 390px
 * phone needs 780 device pixels at 2x and 1170 at 3x. 1200 covers the worst of
 * those with a little to spare; 800 would have looked fine on the 2x phone this
 * was tested on and soft on every recent iPhone. The number is the 3x case, not
 * the common one.
 *
 * IT IS NOT AN UPSCALE AND NEVER CAN BE. The source is 1600px and every output
 * is smaller, so this only ever throws pixels away. The moment somebody points
 * it at a master narrower than the target it refuses, because a "mobile" file
 * larger than its source is the same fiction in the other direction.
 *
 * THE DESKTOP MASTER IS NEVER TOUCHED. It is the only copy of this artwork in
 * the repository — there is no 3200px original anywhere — so it is read and
 * never written. That also makes this reversible by one copy, which matters
 * because these are the owner's photographs and not something regenerable.
 *
 * Chromium does the pixels: this toolchain has no PIL, no sharp and no
 * ImageMagick, and the browser is already here for the rigs. Same reason
 * scripts/make-rtl-art.mjs uses it.
 */
import { chromium } from 'playwright'
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'sporta-site/public_html/hero/desktop')
const OUT = join(ROOT, 'sporta-site/public_html/hero/mobile')

/** The widest a phone can actually show: 390 CSS px at 3x. Rounded up. */
const TARGET = 1200
/** webp quality. 0.82 measured against 0.90 on these frames: the files are
 *  18% smaller and the difference is not visible at phone size on this
 *  content, which is photographic with a dark gradient backdrop. */
const QUALITY = 0.82

const write = process.argv.includes('--write')

const names = readdirSync(SRC).filter((f) => f.endsWith('.webp'))
if (names.length === 0) {
  console.error(`no hero art at ${SRC} — the storefront package is not restored`)
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()

let wrote = 0
let saved = 0
let refused = 0

for (const name of names) {
  const srcPath = join(SRC, name)
  const outPath = join(OUT, name)
  const b64 = readFileSync(srcPath).toString('base64')

  const res = await page.evaluate(async ({ b64, target, quality }) => {
    const img = new Image()
    img.src = 'data:image/webp;base64,' + b64
    await img.decode()
    if (img.naturalWidth <= target) {
      return { refused: true, w: img.naturalWidth, h: img.naturalHeight }
    }
    const h = Math.round(img.naturalHeight * (target / img.naturalWidth))
    const c = document.createElement('canvas')
    c.width = target
    c.height = h
    const ctx = c.getContext('2d')
    // Quality hints matter at this ratio: the default is a box filter in some
    // builds and it aliases the gym equipment's straight edges into stair-steps.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, target, h)
    return { data: c.toDataURL('image/webp', quality), w: target, h,
             from: img.naturalWidth }
  }, { b64, target: TARGET, quality: QUALITY })

  if (res.refused) {
    // A source no wider than the target cannot produce a smaller file honestly.
    console.log(`skip  ${name} — source is ${res.w}px, target ${TARGET}px`)
    refused++
    continue
  }

  const bytes = Buffer.from(res.data.split(',')[1], 'base64')
  const before = statSync(srcPath).size
  const delta = before - bytes.length
  saved += delta

  console.log(`${write ? 'write' : 'would'} ${name.padEnd(26)}`
    + `${res.from}px ${String(before).padStart(6)}b  ->  `
    + `${res.w}px ${String(bytes.length).padStart(6)}b  `
    + `(${delta > 0 ? '-' : '+'}${Math.abs(delta)}b)`)

  if (write) {
    writeFileSync(outPath, bytes)
    wrote++
  }
}

await browser.close()

console.log(`\n${write ? `wrote ${wrote}` : `${names.length - refused} to write`}`
  + `, ${saved > 0 ? saved : 0} bytes saved on every phone that loads all five`
  + (refused ? `, ${refused} skipped` : '')
  + (write ? '' : '  — re-run with --write'))
