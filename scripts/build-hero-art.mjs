/**
 * Bundles the shop's own hero banners into the app.
 *
 *   node scripts/build-hero-art.mjs
 *
 * The website's slider art lives in sporta-site/public_html/hero/mobile as
 * .webp. It is bundled for the same reason the category tiles are: a home page
 * whose banner is empty until the network answers looks broken on a lift, in a
 * basement gym, and on first launch. The server copy still wins when it is
 * reachable, so replacing a banner on the site still changes the app with no
 * release.
 *
 * .jpg rather than .webp on purpose. expo-image reads both, but Metro's asset
 * pipeline and the web export handle jpg everywhere without a per-platform
 * caveat, and these are photographs — jpg at 0.86 is within a rounding error of
 * the webp for this content, measured at 60-90 kB a frame.
 *
 * Chromium does the decoding because this container has no PIL, no sharp and no
 * ImageMagick — the same reason scripts/make-rtl-art.mjs uses it.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'sporta-site/public_html/hero/mobile')
const OUT = join(ROOT, 'assets/hero')

let names
try {
  names = readdirSync(SRC).filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''))
} catch {
  console.error(`no hero art at ${SRC} — the storefront package is not restored`)
  process.exit(1)
}
if (!names.length) {
  console.error(`no .webp in ${SRC}`)
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage()

for (const name of names) {
  const data = readFileSync(join(SRC, `${name}.webp`)).toString('base64')
  const out = await p.evaluate(async (d) => {
    const img = new Image()
    img.src = 'data:image/webp;base64,' + d
    await img.decode()
    const c = document.createElement('canvas')
    // The source is now 1600 wide and is kept as it is — never upscaled, never
    // thrown away.
    //
    // IT USED TO BE 1000, and this comment used to say that was "already the
    // right size for a phone at 3x on a 390pt screen once it is cropped to the
    // band". The arithmetic never supported it: 390pt at 3x is 1170 device
    // pixels, and 1000 cannot reach that even with NO crop at all, let alone
    // after the band takes ~17% of the width. Measured in Chromium on the
    // website, which shares this artwork, a 393px phone at DPR 3 was upscaling
    // it 1.4x. At 1600 the same phone gets 1334 usable pixels against 1179
    // wanted, and is sharp.
    //
    // The cost is real and is the trade: these five bundle into the app for
    // the offline case, and they went from 304 kB to 532 kB together.
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d').drawImage(img, 0, 0)
    return { w: c.width, h: c.height, url: c.toDataURL('image/jpeg', 0.86) }
  }, data)
  const bytes = Buffer.from(out.url.split(',')[1], 'base64')
  writeFileSync(join(OUT, `${name}.jpg`), bytes)
  console.log(`  ${name}.jpg`.padEnd(30), `${out.w}x${out.h}`, `${Math.round(bytes.length / 1024)} kB`)
}

await b.close()
console.log(`\n${names.length} banners -> assets/hero/`)
