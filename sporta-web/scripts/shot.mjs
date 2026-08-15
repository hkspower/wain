// Screenshots a route at phone + desktop, in both languages, for eyeballing.
//   node scripts/shot.mjs /product/cloudsoft-jacket-army-green out-dir
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const route = process.argv[2] ?? '/'
const outDir = process.argv[3] ?? 'shots'
const theme = process.argv[4] ?? 'light'
// '', 'bag' (a cart only) or 'saved' (a cart plus saved delivery details).
const seed = process.argv[5] ?? ''
const dist = new URL('../dist/', import.meta.url)

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0])
  for (const candidate of [path.replace(/^\//, ''), 'index.html']) {
    try {
      const body = await readFile(new URL(candidate, dist))
      res.writeHead(200, { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' })
      return res.end(body)
    } catch { /* fall through to the SPA shell */ }
  }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

await mkdir(new URL(`../${outDir}/`, import.meta.url), { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const shots = []

for (const [device, viewport, dpr] of [
  ['phone', { width: 390, height: 844 }, 3],
  ['desktop', { width: 1440, height: 900 }, 2],
]) {
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr })
    const page = await ctx.newPage()
    await page.addInitScript(([l, th, seed]) => {
      localStorage.setItem('lang', l)
      localStorage.setItem('sporta_theme', th)
      // /cart and /checkout return their empty state early, so without a bag
      // the screenshot is a picture of "Your bag is empty" — which is not the
      // screen anyone wanted to look at. `--seed` also saves delivery details,
      // which is what puts the quick-checkout card on screen.
      if (seed) {
        localStorage.setItem(
          'sporta_cart',
          JSON.stringify([
            {
              key: 'cloudsoft-jacket-army-green__L__normal',
              slug: 'cloudsoft-jacket-army-green',
              size: 'L',
              fit: 'normal',
              name: { en: 'Cloudsoft Jacket — Army Green', ar: 'جاكيت كلاودسوفت — أخضر عسكري' },
              price: 10,
              image: '',
              qty: 2,
            },
          ]),
        )
        if (seed === 'saved') {
          localStorage.setItem(
            'sporta.delivery',
            JSON.stringify({
              name: 'Test Shopper', phone: '99887766', governorate: 'capital',
              area: 'Salmiya', block: '4', street: '12', building: '5',
              floor: '', flat: '', note: '',
            }),
          )
        } else {
          localStorage.removeItem('sporta.delivery')
        }
      }
    }, [lang, theme, seed])
    await page.goto(base + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const file = join(outDir, `${device}-${lang}${theme === 'dark' ? '-dark' : ''}.png`)
    await page.screenshot({ path: fileURLToPath(new URL(`../${file}`, import.meta.url)), fullPage: true })
    shots.push(file)
    await ctx.close()
  }
}
await browser.close()
server.close()
console.log(shots.join('\n'))
