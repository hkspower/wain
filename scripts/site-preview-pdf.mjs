/**
 * A full-page, high-resolution PDF of the WEBSITE — the restored storefront in
 * sporta-site/, not the app.
 *
 *   cd sporta-site/public_html && php -S 127.0.0.1:4300 -t . &
 *   node scripts/site-preview-pdf.mjs [out.pdf]
 *
 * Desktop viewport (1440x900) captured at deviceScaleFactor 2, so every page is
 * rendered at 2880 physical pixels wide and stays sharp when the PDF is zoomed
 * or printed. Whole pages, not viewports: each screenshot runs the full height
 * of the document, which for the home page is about seven thousand pixels.
 *
 * WHAT IS AND IS NOT REAL HERE. The pages, the artwork, the copy, the layout
 * and the front-end code are the real site. The catalogue is not: /api needs
 * MySQL and a config.php that lives only on the server, so anything that lists
 * products comes back empty and /backends says so itself. That is a property of
 * previewing a database-backed site with no database, and it is stated on the
 * cover rather than cropped out.
 */
import { chromium } from 'playwright'

const BASE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
const OUT = process.argv[2] ?? '/tmp/sporta-website.pdf'
const W = 1440
const H = 900

const PAGES = [
  ['/', 'الرئيسية — Home'],
  ['/shop', 'المتجر — Shop'],
  ['/about', 'من نحن — About'],
  ['/contact', 'اتصل بنا — Contact'],
  ['/cart', 'السلة — Cart'],
  ['/terms', 'الشروط — Terms'],
  ['/privacy', 'الخصوصية — Privacy'],
  ['/backends', 'backends — the admin panel'],
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
const p = await ctx.newPage()

const shots = []
for (const [path, caption] of PAGES) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  // Walk the page before capturing it: images below the fold are lazy, and a
  // full-page screenshot of a page that was never scrolled is a full page of
  // placeholders.
  await p.evaluate(async () => {
    const step = window.innerHeight
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 220))
    }
    window.scrollTo(0, 0)
  })
  await p.waitForTimeout(900)
  const png = await p.screenshot({ fullPage: true, type: 'jpeg', quality: 88 })
  const size = await p.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.body.scrollHeight }))
  shots.push({ caption, data: png.toString('base64'), ...size })
  console.log(`captured  ${caption.padEnd(30)} ${size.w}x${size.h} css  ${Math.round(png.length / 1024)} kB`)
}
await p.close()

// FULL PAGES, SLICED — not one screenshot squeezed onto one sheet.
//
// The home page is 1440x3561, which at the width of an A4 landscape sheet
// renders about 680mm tall. The first version of this put each screenshot in a
// fixed-height box with overflow hidden, so every long page came out cropped at
// the fold: a "full-page preview" showing the top quarter. Browsers will not
// split an image across printed pages either — it is moved whole to the next
// one and clipped there instead.
//
// So each screenshot is cut into sheet-height slices, each on its own page,
// numbered. The image is drawn at full width inside a window of one sheet's
// height and shifted up by one sheet per slice. Nothing is scaled down, so the
// resolution captured is the resolution printed.
const SHEET_W = 277 // A4 landscape minus 10mm margins, in mm
const SHEET_H = 177

const slicesFor = (shot) => {
  const renderedH = (shot.h / shot.w) * SHEET_W // mm
  return Math.max(1, Math.ceil(renderedH / SHEET_H))
}

const sheet = `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #14161a; }
  .cover { height: ${SHEET_H}mm; display: flex; flex-direction: column; justify-content: center; gap: 7mm; }
  .cover h1 { margin: 0; font-size: 40pt; letter-spacing: 2pt; }
  .cover p { margin: 0; font-size: 10.5pt; color: #5c6570; max-width: 170mm; line-height: 1.6; }
  .rule { height: 3mm; width: 46mm; background: #e0561c; border-radius: 2mm; }
  .page { page-break-before: always; height: ${SHEET_H}mm; display: flex; flex-direction: column; }
  .cap { font-size: 9.5pt; font-weight: 700; margin: 0 0 2mm; }
  .cap span { font-weight: 400; color: #5c6570; }
  .window { flex: 1; overflow: hidden; position: relative; border: 1px solid #e2e4e8; }
  .window img { position: absolute; top: 0; left: 0; width: 100%; height: auto; display: block; }
</style>
<div class="cover">
  <div class="rule"></div>
  <h1>SPORTA</h1>
  <p><strong>www.sporta.com.kw — full-page preview.</strong> ${shots.length} pages, captured at
     1440 × 900 and rendered at twice that resolution, each one the full height of
     its document and cut across as many sheets as it takes.</p>
  <p>The pages, artwork, copy, layout and front-end code here are the real site,
     restored from the go-live package. The catalogue is not: /api needs MySQL and
     a config.php that exists only on the server, so pages that list products come
     back empty and the admin panel says outright that the backend is not
     configured. That is what previewing a database-backed site without its
     database looks like — nothing has been cropped to hide it.</p>
</div>
${shots
  .map((s) => {
    const n = slicesFor(s)
    return Array.from({ length: n }, (_, i) => `<div class="page">
  <p class="cap">${s.caption} <span>— ${s.w}×${s.h}${n > 1 ? `, sheet ${i + 1} of ${n}` : ''}</span></p>
  <div class="window"><img style="top:-${i * SHEET_H}mm" src="data:image/jpeg;base64,${s.data}"></div>
</div>`).join('\n')
  })
  .join('\n')}`

const printer = await ctx.newPage()
await printer.setContent(sheet, { waitUntil: 'load' })
// PREVIEW_PNG=1 writes the sheet as a picture too. Print CSS is the one part
// that cannot be checked by looking at the PDF from a terminal: a slice that
// is cropped, doubled or blank looks identical in a byte count.
if (process.env.PREVIEW_PNG) {
  // Screenshot individual .page elements rather than the whole document: at
  // screen zoom the sheet is thousands of pixels tall and a full-page capture
  // of it came back blank, which says nothing about the PDF.
  const pages = printer.locator('.page')
  const n = Math.min(await pages.count(), 4)
  for (let i = 0; i < n; i++) {
    await pages.nth(i).screenshot({ path: OUT.replace(/\.pdf$/, `-p${i + 1}.png`) })
  }
}
await printer.pdf({ path: OUT, format: 'A4', landscape: true, printBackground: true })
await b.close()
console.log(`\n${OUT}`)
