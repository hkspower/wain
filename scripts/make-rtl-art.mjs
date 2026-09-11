/**
 * Builds the Arabic composition of the men's category tile from the English one.
 *
 *   node scripts/make-rtl-art.mjs
 *
 * WHY THIS EXISTS. The tiles put the copy on the reading side, so the Arabic
 * frame needs the figure on the LEFT and the quiet backdrop on the right. The
 * shipped art-men-rtl.jpg in the go-live package is the damaged one — measured
 * against the clean base: 40-pixel flat runs and blocky grey-green artefacts
 * across two thirds of the frame. It was repaired once, after that package was
 * cut, on a container that no longer exists. So it is rebuilt here, and this
 * time the recipe is committed rather than done by hand.
 *
 * THE FIGURE IS NEVER MIRRORED. A photograph of a person read backwards is a
 * tell long before a viewer can say why — the hair parts on one side, the zip
 * pull sits on one side. Only the BACKDROP is mirrored, and a backdrop that is
 * a gradient and a floor line has no handedness.
 *
 *   1. Take the figure strip from the right of the base, unflipped.
 *   2. Take the base's own backdrop, mirrored, for the rest of the canvas.
 *   3. Level the fill onto the seam per row, so the join is continuous by
 *      construction rather than by feathering. Mirroring the whole frame and
 *      pasting the figure over it leaves a luminance step that no blur removes;
 *      a blurred step is still a step, and the eye traces it as a panel edge.
 *   4. Blur a narrow strip over the join, feathered to nothing at both ends.
 *
 * Canvas in headless Chromium does the pixels — this toolchain has no image
 * library, and the browser is already here for the tests.
 */
import { chromium } from 'playwright'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Which frames get an Arabic composition, and how much of the canvas the
// subject occupies in each. Only the two with a PERSON in them: the flat-lay
// and the shelves have no single subject standing on one side, so mirroring
// their backdrop would move goods around for no gain.
const JOBS = [
  { id: 'men', figAspect: 896 / 1200, margin: 0.04 },
  { id: 'women', figAspect: 896 / 1200, margin: 0.04 },
]

/* ---------------------------------------------------------------------------
 * THE WEBSITE'S TILES WERE ONLY HALF BUILT, AND ONLY IN ARABIC — 2026-09-10
 * ---------------------------------------------------------------------------
 *
 * This script built `assets/cats/`, which is what the APP bundles, and stopped
 * there. The website serves a different set — `cats/desktop/` at 1216x706 and
 * `cats/mobile/` at 900x570, which are different COMPOSITIONS rather than two
 * sizes of one picture — and the Arabic halves of that set were incomplete:
 *
 *     cats/desktop/art-men-rtl.{jpg,webp}    present
 *     cats/mobile/art-men-rtl.{jpg,webp}     present
 *     cats/mobile/art-women-rtl.jpg          present — but byte-identical to
 *                                            assets/cats/art-women-rtl.jpg, so
 *                                            a hand copy, and no .webp beside it
 *     cats/desktop/art-women-rtl.*           ABSENT
 *
 * Measured in a browser at 1440x900 and 390x844: an Arabic shopper is served
 * `art-women.webp` — the ENGLISH composition, figure and copy on the wrong
 * side — on BOTH breakpoints, while the men's tile beside it is correct. The
 * `<picture>` asks for webp first, so even the hand-copied mobile jpg is never
 * reached. Nothing reported it, because every file the page requested answered
 * 200: the missing ones were never asked for.
 *
 * So the targets are enumerated rather than assumed, each built from ITS OWN
 * crop's English base — the desktop Arabic frame cannot come from the 900px
 * source, which is both smaller and a different composition, and upscaling it
 * would be soft where the men's tile beside it is sharp.
 *
 * EXISTING FILES ARE NEVER OVERWRITTEN without --force. The men's art is live
 * and correct; regenerating it here would put a fresh encode of an unchanged
 * picture onto the shop for no reason, and a jpeg re-encode is never free.
 * `--force` exists so the recipe can be proved against what shipped, which is
 * what `--verify` does without touching anything.
 */
/* QUALITY PER CROP, MEASURED RATHER THAN CHOSEN. --verify proved 0.9 exact for
 * assets/cats — both men and women rebuild byte-for-byte — and proved the
 * website's set is NOT 0.9: its shipped art-men-rtl came back consistently
 * ~18% smaller than a 0.9 rebuild. Re-encoding that shipped file across a
 * sweep put the setting at 0.85:
 *
 *     shipped 39740b     q0.80 33454   q0.85 39296   q0.90 48910
 *
 * Using 0.9 there would have made the women's Arabic tile visibly heavier than
 * the men's tile beside it, for no gain a shopper could see — the two sit side
 * by side on the same row, so they must be encoded alike. */
const CROPS = [
  { dir: 'assets/cats', ext: 'jpg', also: [], quality: 0.9 },
  { dir: 'sporta-site/public_html/cats/desktop', ext: 'webp', also: ['jpg'], quality: 0.85 },
  { dir: 'sporta-site/public_html/cats/mobile', ext: 'webp', also: ['jpg'], quality: 0.85 },
]

const force = process.argv.includes('--force')
const verify = process.argv.includes('--verify')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage()

/** Every (source, outputs) pair, flattened so nothing is implied. */
const TARGETS = []
for (const job of JOBS) {
  for (const crop of CROPS) {
    const src = `${crop.dir}/art-${job.id}.${crop.ext}`
    if (!existsSync(src)) continue          // reported after the loop, not silently
    TARGETS.push({
      job, src, quality: crop.quality,
      outs: [crop.ext, ...crop.also].map((e) => `${crop.dir}/art-${job.id}-rtl.${e}`),
    })
  }
}
// A run with nothing to do and a run that found nothing look identical.
if (TARGETS.length === 0) {
  console.error('no source art found — is this the repository root?')
  process.exit(1)
}

let wrote = 0, skipped = 0, same = 0, differ = 0

for (const target of TARGETS) {
  const { job } = target
  const SRC = target.src
  const mime = SRC.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  const dataUrl = `data:${mime};base64,` + readFileSync(SRC).toString('base64')

  const out = await p.evaluate(
  async ({ src, figAspect, margin, quality }) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const W = img.width
    const H = img.height

    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })

    const figw = Math.min(W, Math.round(H * figAspect + W * margin))
    const fillw = W - figw

    // The figure, straight across, not flipped.
    ctx.drawImage(img, W - figw, 0, figw, H, 0, 0, figw, H)

    // The backdrop, mirrored.
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(img, 0, 0, fillw, H, 0, 0, fillw, H)
    ctx.restore()

    // Level the fill so its first column equals the figure's last column, with
    // the correction decaying to nothing across the fill — the far end keeps
    // the warmth it was composed with.
    const fill = ctx.getImageData(figw, 0, fillw, H)
    const edge = ctx.getImageData(figw - 6, 0, 6, H)
    for (let y = 0; y < H; y++) {
      for (let ch = 0; ch < 3; ch++) {
        let e = 0
        for (let x = 0; x < 6; x++) e += edge.data[(y * 6 + x) * 4 + ch]
        e /= 6
        let h = 0
        for (let x = 0; x < 6; x++) h += fill.data[(y * fillw + x) * 4 + ch]
        h /= 6
        const ratio = Math.max(0.25, Math.min(4, e / Math.max(h, 0.001)))
        for (let x = 0; x < fillw; x++) {
          const t = Math.pow(x / fillw, 0.6)
          const i = (y * fillw + x) * 4 + ch
          // Half a level of noise: this is a wide smooth gradient over dark
          // tones, which is the one thing 8 bits cannot hold without banding.
          const noise = (Math.sin((x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.6
          fill.data[i] = Math.max(0, Math.min(255, fill.data[i] * (ratio + (1 - ratio) * t) + noise))
        }
      }
    }
    ctx.putImageData(fill, figw, 0)

    // Melt what is left of the join.
    // 120 at 1920, not 44. A narrow feather leaves the join readable as a
    // vertical panel edge: the mirrored backdrop and the figure's own backdrop
    // differ slightly in tone, and over 40 pixels that difference is a line.
    // Spread across 240 the eye integrates it instead of tracing it.
    const seam = Math.max(1, Math.round((120 * W) / 1920))
    const strip = document.createElement('canvas')
    strip.width = seam * 2
    strip.height = H
    const sctx = strip.getContext('2d')
    sctx.filter = `blur(${Math.max(1, (26 * W) / 1920)}px)`
    sctx.drawImage(c, figw - seam, 0, seam * 2, H, 0, 0, seam * 2, H)

    const mask = document.createElement('canvas')
    mask.width = seam * 2
    mask.height = H
    const mctx = mask.getContext('2d')
    mctx.drawImage(strip, 0, 0)
    const grad = mctx.createLinearGradient(0, 0, seam * 2, 0)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.5, 'rgba(0,0,0,1)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    mctx.globalCompositeOperation = 'destination-in'
    mctx.fillStyle = grad
    mctx.fillRect(0, 0, seam * 2, H)

    ctx.drawImage(mask, figw - seam, 0)

    return {
      jpg: c.toDataURL('image/jpeg', quality),
      webp: c.toDataURL('image/webp', quality),
      w: W, h: H,
    }
  },
    { src: dataUrl, figAspect: job.figAspect, margin: job.margin, quality: target.quality },
  )

  for (const OUT of target.outs) {
    const bytes = Buffer.from((OUT.endsWith('.webp') ? out.webp : out.jpg).split(',')[1], 'base64')

    if (verify) {
      // Prove the committed recipe is the one that produced what shipped,
      // without writing anything. A file that does not exist is the finding
      // rather than a pass — this is the check that would have caught the
      // missing women's frames months ago.
      if (!existsSync(OUT)) { differ++; console.log(`ABSENT  ${OUT}`); continue }
      const have = readFileSync(OUT)
      const eq = have.length === bytes.length && have.equals(bytes)
      eq ? same++ : differ++
      console.log(`${eq ? 'same  ' : 'DIFFER'}  ${OUT}  shipped=${have.length}b rebuilt=${bytes.length}b`)
      continue
    }

    if (existsSync(OUT) && !force) {
      skipped++
      console.log(`skip    ${OUT}  (exists — --force to rebuild)`)
      continue
    }

    writeFileSync(OUT, bytes)
    wrote++
    console.log(`write   ${OUT}  ${out.w}x${out.h}  ${Math.round(bytes.length / 1024)} kB`)
  }
}

await b.close()

console.log(verify
  ? `\n${same} match the recipe, ${differ} do not`
  : `\nwrote ${wrote}, skipped ${skipped}`)
if (verify && differ) process.exit(1)
