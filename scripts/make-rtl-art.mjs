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
import { readFileSync, writeFileSync } from 'node:fs'

// Which frames get an Arabic composition, and how much of the canvas the
// subject occupies in each. Only the two with a PERSON in them: the flat-lay
// and the shelves have no single subject standing on one side, so mirroring
// their backdrop would move goods around for no gain.
const JOBS = [
  { id: 'men', figAspect: 896 / 1200, margin: 0.04 },
  { id: 'women', figAspect: 896 / 1200, margin: 0.04 },
]
const QUALITY = 0.9

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage()

for (const job of JOBS) {
  const SRC = `assets/cats/art-${job.id}.jpg`
  const OUT = `assets/cats/art-${job.id}-rtl.jpg`
  const dataUrl = 'data:image/jpeg;base64,' + readFileSync(SRC).toString('base64')

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

    return { data: c.toDataURL('image/jpeg', quality), w: W, h: H }
  },
    { src: dataUrl, figAspect: job.figAspect, margin: job.margin, quality: QUALITY },
  )

  writeFileSync(OUT, Buffer.from(out.data.split(',')[1], 'base64'))
  console.log(`${OUT}  ${out.w}x${out.h}  ${Math.round(readFileSync(OUT).length / 1024)} kB`)
}

await b.close()
