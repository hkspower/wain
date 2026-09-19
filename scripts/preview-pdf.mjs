/**
 * Builds a PDF contact sheet of the app — every screen, at phone size, in the
 * language it ships in.
 *
 *   python3 scripts/mock-admin.py 8899 &
 *   EXPO_PUBLIC_ASSET_BASE=http://127.0.0.1:8877 npx expo export --platform web --clear
 *   python3 scripts/serve-dist.py &
 *   node scripts/preview-pdf.mjs [out.pdf]
 *
 * For review, not for release. The screenshots are captured from the exported
 * web build, so what is in the PDF is the real app — the same components,
 * copy and layout the phone runs — rendered by Chromium rather than by iOS or
 * Android. Fonts and the tab bar are where the two differ most.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const OUT = process.argv[2] ?? '/tmp/sporta-preview.pdf'
const W = 390
const H = 844

/** [path, caption, setup] — setup runs before the shot. */
const SHOTS = [
  ['/', 'الرئيسية — Home', null],
  ['/shop', 'المتجر — Shop', null],
  ['/product/trail-shoe-40', 'المنتج — Product', null],
  ['/product/desert-runner-short', 'Product — size chosen, added', async (p) => {
    await p.getByRole('button', { name: 'M' }).first().click()
    await p.getByRole('button', { name: 'أضف إلى السلة' }).click()
    await p.waitForTimeout(400)
  }],
  ['/cart', 'السلة — Cart', null],
  ['/checkout', 'إتمام الطلب — Checkout', null],
  ['/order/SP-2601', 'تم الطلب — Order placed', null],
  ['/account', 'حسابي — Account', null],
  ['/', 'Home — English', async (p) => {
    await p.goto(BASE + '/account', { waitUntil: 'networkidle' })
    await p.getByRole('radio', { name: 'English' }).click()
    await p.waitForTimeout(300)
    await p.goto(BASE + '/', { waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
  }],
  ['/backends', 'backends — sign in', null],
  ['/backends', 'backends — today', async (p) => {
    await p.getByLabel('Email').fill('manager@sporta.com.kw')
    await p.getByLabel('Password').fill('correct horse')
    await p.getByRole('button', { name: 'Sign in' }).click()
    await p.waitForTimeout(1000)
  }],
  ['/backends/orders', 'backends — orders', null],
  ['/backends/order/1', 'backends — one order', null],
  ['/backends/stock', 'backends — stock', null],
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
// One context, so signing in to the panel carries across the shots that follow
// it — the alternative is a login page where the orders list should be.
const p = await ctx.newPage()

const pages = []
for (const [path, caption, setup] of SHOTS) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  if (setup) await setup(p)
  await p.waitForTimeout(600)
  const png = await p.screenshot({ type: 'png' })
  pages.push({ caption, data: png.toString('base64') })
  console.log(`captured  ${caption}`)
}
await p.close()

// The sheet: one screen per page, captioned, on A4. Built as HTML and printed
// by the same browser, which is why no PDF library is needed here.
const sheet = `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #14161a; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; gap: 8mm; }
  .cover h1 { margin: 0; font-size: 34pt; letter-spacing: 1pt; }
  .cover p { margin: 0; font-size: 11pt; color: #5c6570; max-width: 120mm; line-height: 1.6; }
  .rule { height: 3mm; width: 40mm; background: #e0561c; border-radius: 2mm; }
  .page { page-break-before: always; height: 250mm; display: flex; flex-direction: column; }
  .cap { font-size: 11pt; font-weight: 700; margin: 0 0 4mm; }
  .cap span { font-weight: 400; color: #5c6570; }
  .shot { flex: 1; display: flex; align-items: flex-start; justify-content: center; }
  img { height: 100%; max-height: 235mm; width: auto; border: 1px solid #e6e1da; border-radius: 4mm; }
</style>
<div class="cover">
  <div class="rule"></div>
  <h1>SPORTA</h1>
  <p>The native app — iOS, Android and web from one codebase. ${pages.length} screens,
     captured from the exported build at 390 × 844. Arabic is the default; the
     English screen is included to show the switch. The category artwork in this
     document is placeholder, served from the test rig — the real photographs
     load from /cats/ on the shop's own server.</p>
</div>
${pages
  .map(
    (s) => `<div class="page">
  <p class="cap">${s.caption}</p>
  <div class="shot"><img src="data:image/png;base64,${s.data}"></div>
</div>`,
  )
  .join('\n')}`

// Duplicate captures are worth catching: a screen whose setup silently failed
// produces a page that looks plausible and is a copy of the one before it.
const seen = new Map()
for (const s of pages) {
  const prev = seen.get(s.data)
  if (prev) console.log(`WARNING  "${s.caption}" is identical to "${prev}"`)
  else seen.set(s.data, s.caption)
}

const printer = await ctx.newPage()
await printer.setContent(sheet, { waitUntil: 'load' })
// PREVIEW_PNG=1 also writes the sheet as a picture. Print CSS is the one part
// of this that cannot be checked by looking at the PDF from a terminal — a
// clipped screenshot or a caption that fell off the page looks fine in a byte
// count.
if (process.env.PREVIEW_PNG) {
  await printer.setViewportSize({ width: 794, height: 1123 })
  await printer.screenshot({ path: OUT.replace(/\.pdf$/, '-sheet.png'), fullPage: true })
}
await printer.pdf({ path: OUT, format: 'A4', printBackground: true })
await b.close()
console.log(`\n${OUT}  —  ${pages.length} screens, ${seen.size} distinct`)
