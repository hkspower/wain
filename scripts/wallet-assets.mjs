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
const IMAGES = [
  { name: 'icon.png', w: 29, h: 29, source: 'favicon.png', fit: 'contain', bg: '#2b3138' },
  { name: 'icon@2x.png', w: 58, h: 58, source: 'favicon.png', fit: 'contain', bg: '#2b3138' },
  { name: 'icon@3x.png', w: 87, h: 87, source: 'favicon.png', fit: 'contain', bg: '#2b3138' },
  { name: 'logo.png', w: 160, h: 50, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'logo@2x.png', w: 320, h: 100, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'logo@3x.png', w: 480, h: 150, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'strip.png', w: 375, h: 123, source: 'og-image.png', fit: 'cover', bg: '#2b3138' },
  { name: 'strip@2x.png', w: 750, h: 246, source: 'og-image.png', fit: 'cover', bg: '#2b3138' },
]

mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage()
for (const img of IMAGES) {
  const src = `data:image/png;base64,${readFileSync(join(SRC, img.source)).toString('base64')}`
  const data = await page.evaluate(
    async ({ src, w, h, fit, bg }) => {
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
    { src, w: img.w, h: img.h, fit: img.fit, bg: img.bg },
  )
  writeFileSync(join(OUT, img.name), Buffer.from(data.split(',')[1], 'base64'))
  console.log(`  ${img.name.padEnd(14)} ${img.w}x${img.h}`)
}
await b.close()
