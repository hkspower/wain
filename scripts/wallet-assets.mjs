/**
 * Renders the eight Wallet images once, into the API's own folder.
 *
 *   node scripts/wallet-assets.mjs
 *
 * PHP does the signing and the zipping at request time; it does not do image
 * work. Canvas resampling in PHP means GD, a second code path, and a per-request
 * cost for pictures that change about once a year. They are built here and
 * committed, and api/wallet.php copies them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const SRC = 'sporta-site/public_html'
const OUT = 'sporta-site/public_html/api/wallet-assets'
// 2026-10-03 ("fresh design"): the shop's header grey #2d3034, and a DRAWN strip — the same orange
// slanted band and thin stripes as the home page's category tiles — in place of a crop of the
// share picture, which carried text that a 375x123 strip cut in half.
const BG = '#2d3034'
const IMAGES = [
  { name: 'icon.png', w: 29, h: 29, source: 'favicon.png', fit: 'contain', bg: BG },
  { name: 'icon@2x.png', w: 58, h: 58, source: 'favicon.png', fit: 'contain', bg: BG },
  { name: 'icon@3x.png', w: 87, h: 87, source: 'favicon.png', fit: 'contain', bg: BG },
  { name: 'logo.png', w: 160, h: 50, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'logo@2x.png', w: 320, h: 100, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'logo@3x.png', w: 480, h: 150, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'strip.png', w: 375, h: 123, draw: 'band', bg: BG },
  { name: 'strip@2x.png', w: 750, h: 246, draw: 'band', bg: BG },
  { name: 'strip@3x.png', w: 1125, h: 369, draw: 'band', bg: BG },
]

mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await b.newPage()
for (const img of IMAGES) {
  const src = img.source ? `data:image/png;base64,${readFileSync(join(SRC, img.source)).toString('base64')}` : ''
  const data = await page.evaluate(
    async ({ src, w, h, fit, bg, draw }) => {
      if (draw === 'band') {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const x = c.getContext('2d')
        x.fillStyle = bg
        x.fillRect(0, 0, w, h)
        const s = h * 0.32                                   // the slant, as on the tiles
        const band = (x0, x1, colour) => {
          x.fillStyle = colour
          x.beginPath()
          x.moveTo(x0 + s, 0); x.lineTo(x1 + s, 0); x.lineTo(x1 - s, h); x.lineTo(x0 - s, h)
          x.closePath(); x.fill()
        }
        band(w * 0.52, w * 1.1, '#e0561c')                   // the orange band, right side
        for (let i = 0; i < 6; i++) band(w * (0.36 + i * 0.022), w * (0.36 + i * 0.022) + w * 0.006, 'rgba(224,86,28,.55)')
        const g = x.createLinearGradient(0, 0, 0, h)         // a soft shade so white text above reads
        g.addColorStop(0, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g
        x.fillRect(0, 0, w, h)
        return c.toDataURL('image/png')
      }
      const image = new Image()
      image.src = src
      await image.decode()
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (bg !== 'transparent') {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
      }
      const scale =
        fit === 'cover'
          ? Math.max(w / image.width, h / image.height)
          : Math.min(w / image.width, h / image.height)
      const dw = image.width * scale
      const dh = image.height * scale
      ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh)
      return c.toDataURL('image/png')
    },
    { src, w: img.w, h: img.h, fit: img.fit, bg: img.bg, draw: img.draw },
  )
  writeFileSync(join(OUT, img.name), Buffer.from(data.split(',')[1], 'base64'))
  console.log(`  ${img.name.padEnd(14)} ${img.w}x${img.h}`)
}
await b.close()
