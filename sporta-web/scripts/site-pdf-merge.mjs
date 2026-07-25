// Builds the cover page and stitches the per-route PDFs into one document.
// Run after site-pdf.mjs.

import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv[2] ?? '/tmp/pdfout'
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'))
const built = process.argv[3] ?? new Date().toISOString().slice(0, 10)

const logo = readFileSync(
  new URL('../public/logo-white.png', import.meta.url),
).toString('base64')

// The cover is sized to the same 1280px width as the captured pages so the
// document has one consistent page width throughout.
const cover = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
  @font-face { font-family: X; src: local('sans-serif'); }
  html,body { margin:0; padding:0; }
  body {
    width:1280px; height:1600px; box-sizing:border-box;
    background: radial-gradient(1200px 700px at 50% 110%, #e0561c 0%, #b8430f 32%, #171a1e 72%), #171a1e;
    color:#fff; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    display:flex; flex-direction:column; justify-content:center; align-items:center;
    text-align:center; padding:0 120px;
  }
  img { width:300px; margin-bottom:56px; }
  h1 { font-size:74px; margin:0 0 18px; letter-spacing:-1.5px; font-weight:800; }
  .ar { font-size:44px; margin:0 0 40px; opacity:.92; }
  .url { font-size:30px; color:#ffb488; letter-spacing:.5px; margin-bottom:64px; }
  .meta { font-size:22px; line-height:2; opacity:.8; border-top:1px solid rgba(255,255,255,.22); padding-top:34px; }
</style></head><body>
  <img src="data:image/png;base64,${logo}" alt="Sporta">
  <h1>Complete Website</h1>
  <p class="ar">النسخة الكاملة للموقع</p>
  <p class="url">www.sporta.com.kw</p>
  <div class="meta">
    ${index.filter((e) => e.lang === 'en' && e.group === 'Pages').length} site pages ·
    ${index.filter((e) => e.lang === 'en' && e.group === 'Products').length} product pages<br>
    Each in English and العربية — ${index.length} pages<br>
    Captured ${built}
  </div>
</body></html>`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } })
await page.setContent(cover, { waitUntil: 'load' })
await page.pdf({
  path: join(DIR, '00-cover.pdf'),
  width: '1280px',
  height: '1600px',
  printBackground: true,
  pageRanges: '1',
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
})
await browser.close()
console.log('cover rendered')
