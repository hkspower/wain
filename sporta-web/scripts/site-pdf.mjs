// Renders the whole Sporta site to PDF at vector quality.
//
// Chromium's page.pdf() keeps text as real text and vectors as vectors, so the
// output is resolution-independent — "highest quality" here means no raster
// step at all, not a big screenshot.
//
// Each route becomes ONE continuous page sized to its own content, rather than
// being chopped into A4. A web layout has no page breaks designed into it, so
// paginating it cuts product cards and headings in half.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = 'http://www.sporta.com.kw'
const OUT = process.argv[2] ?? '/tmp/pdfout'
mkdirSync(OUT, { recursive: true })

// Catalog drives the product pages, same source of truth as the sitemap.
const src = readFileSync('/home/user/wain/sporta-html5/assets/products.js', 'utf8')
const w = {}
new Function('window', src)(w)
const PRODUCTS = w.SPORTA_PRODUCTS

const ROUTES = [
  ['/', 'Home', 'الرئيسية'],
  ['/shop', 'Shop', 'المتجر'],
  ['/about', 'About', 'من نحن'],
  ['/contact', 'Contact', 'اتصل بنا'],
  ['/returns', 'Returns & Exchange', 'الإرجاع والاستبدال'],
  ['/track', 'Track Order', 'تتبع الطلب'],
]

// Print CSS. The site's header is sticky and its cart drawer is a fixed
// overlay — both are correct on screen and wrong in a document, where a
// sticky bar would either float mid-page or repeat.
const PRINT_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; }
  header, .site-header, [class*="sticky"] { position: static !important; }
  .cart-drawer, [role="dialog"], [data-radix-popper-content-wrapper] { display: none !important; }
  html, body { scroll-behavior: auto !important; }
`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  // The canonical hostname is mapped to the local Apache instance so every
  // page renders under its real URL. --no-proxy-server is required: the
  // sandbox's HTTPS_PROXY would otherwise try to tunnel to the real host,
  // which this environment cannot reach.
  args: [
    '--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188',
    '--no-proxy-server',
  ],
})

async function render(lang, path, file) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: lang === 'ar' ? 'ar-KW' : 'en-KW',
    ignoreHTTPSErrors: true,
  })
  // The language toggle persists in localStorage, so seeding it before the
  // app boots renders the page in that language from the first paint —
  // no toggle click, no flash of the wrong direction.
  await ctx.addInitScript((l) => localStorage.setItem('lang', l), lang)
  const page = await ctx.newPage()

  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.addStyleTag({ content: PRINT_CSS })

  // Lazy content and web fonts: scroll the full height once, then wait for
  // the font set to settle. Without this, images below the fold render blank
  // and headings fall back to a system face.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
    await document.fonts.ready
  })
  await page.waitForTimeout(400)

  const height = await page.evaluate(() =>
    Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)),
  )

  await page.pdf({
    path: join(OUT, file),
    width: '1280px',
    height: `${height}px`,
    printBackground: true,
    pageRanges: '1', // content height == page height, so there is exactly one
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  })
  await ctx.close()
  return { file, height }
}

const index = []
for (const lang of ['en', 'ar']) {
  for (const [path, en, ar] of ROUTES) {
    const file = `${lang}-${path === '/' ? 'home' : path.slice(1)}.pdf`
    const r = await render(lang, path, file)
    index.push({ ...r, lang, title: lang === 'ar' ? ar : en, group: lang === 'ar' ? 'الصفحات' : 'Pages' })
    console.log(`${lang} ${path} -> ${r.height}px`)
  }
  for (const p of PRODUCTS) {
    const file = `${lang}-product-${p.slug}.pdf`
    const r = await render(lang, `/product/${p.slug}`, file)
    index.push({ ...r, lang, title: p.name[lang], group: lang === 'ar' ? 'المنتجات' : 'Products' })
    console.log(`${lang} /product/${p.slug} -> ${r.height}px`)
  }
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
await browser.close()
console.log(`\n${index.length} pages rendered`)
