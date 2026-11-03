// The images / grid add-on rules, proven on the live markup:
//
//   npm run test:images-layout      (no sandbox needed: fixtures, the live rules, the add-on CSS)
//
//   public/sporta-grid.css    .catalog-page { min-height: calc(100vh - 6rem) }
//     /shop?brand=<slug> first paints short (heading, toolbar, filters, a brief empty state). On a tall
//     window the 715px footer then sat INSIDE the first screen and was pushed down twice as the banner
//     and the products arrived (live CLS 0.226 at 768x1024). Asserted, at every window from 320x568
//     to 1280x1024, in Arabic (RTL, the default) and English (LTR):
//       - in the first-paint (short) state the footer starts at or below the fold, so it is never
//         "visible, then moved";
//       - the section is exactly a window minus 6rem tall in that state (border-box, padding included);
//       - a page already taller than a window (4 cards, 36 cards) is NOT changed: its height is the
//         same with and without the rule.
//
//   public/sporta-images.css  gallery stage cap on short desktop windows
//     At 1280x720 the sticky gallery column (576px square, top 10rem = 168px) ended 24px under the fold and
//     cut the frame's lower border. Asserted, with the page scrolled so the column is stuck:
//       - on windows 1024px+ and up to 800px tall the column's lower edge is inside the window;
//       - the stage is still a square, centred in its column, and the photograph is not cropped
//         (object-fit: contain, the image box is the stage box);
//       - nothing changes on a window taller than 800px, and nothing changes under 1024px wide, where the
//         gallery is not sticky (the rule must not touch phones or the tablet layout).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shop, product } from './fixtures/images-layout.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GRID = process.env.GRID_CSS_FILE ? readFileSync(process.env.GRID_CSS_FILE, 'utf8') : readFileSync(join(ROOT, 'public/sporta-grid.css'), 'utf8')
const IMAGES = process.env.IMAGES_CSS_FILE ? readFileSync(process.env.IMAGES_CSS_FILE, 'utf8') : readFileSync(join(ROOT, 'public/sporta-images.css'), 'utf8')

// sporta-grid.css also carries the product-grid gutters; the "without the rule" baseline drops only the
// .catalog-page block so a difference in height can only come from the min-height.
const GRID_WITHOUT = GRID.replace(/\.catalog-page\s*\{[^}]*\}/, '')
if (GRID_WITHOUT === GRID) { console.log('FAIL sporta-grid.css has no .catalog-page rule'); process.exit(1) }

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const near = (a, b, t) => Math.abs(a - b) <= t

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const open = async (w, h, html, lang = 'ar') => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  await pg.setContent(lang === 'ar' ? html : html.replace('lang="ar" dir="rtl"', 'lang="en" dir="ltr"'))
  return { ctx, pg }
}

// ---- 1. brand / shop page: the footer stays under the fold while the catalogue loads --------------------
const shopSizes = [[1280, 1024], [1280, 800], [1024, 768], [768, 1024], [768, 1180], [600, 900], [390, 844], [360, 740], [320, 568]]
const measureShop = () => {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const sec = document.querySelector('.catalog-page').getBoundingClientRect()
  const foot = document.querySelector('footer').getBoundingClientRect()
  return { root, secH: sec.height, footTop: foot.top + scrollY, docH: document.documentElement.scrollHeight, innerH: innerHeight, over: document.documentElement.scrollWidth - innerWidth }
}
for (const lang of ['ar', 'en']) {
  for (const [w, h] of shopSizes) {
    head(`${lang} shop ${w}x${h}`)
    const hdr = w < 768 ? 96 : 145
    const a = await open(w, h, shop(GRID, { state: 'shell', hdr }), lang)
    const m = await a.pg.evaluate(measureShop)
    is(m.footTop >= m.innerH - 0.5, 'first paint: the footer starts at or below the fold', `footer top ${Math.round(m.footTop)}px, window ${m.innerH}px`)
    is(near(m.secH, h - 6 * m.root, 1) || m.secH > h - 6 * m.root, 'the catalogue section is at least a window minus 6rem', `${Math.round(m.secH)}px vs ${Math.round(h - 6 * m.root)}px`)
    is(m.over <= 0, 'nothing overflows sideways', `${m.over}px`)
    await a.ctx.close()
    // a page that is already taller than the window is not changed by the rule
    for (const n of [4, 36]) {
      const withRule = await open(w, h, shop(GRID, { state: 'loaded', n, hdr }), lang)
      const without = await open(w, h, shop(GRID_WITHOUT, { state: 'loaded', n, hdr }), lang)
      const [x, y] = [await withRule.pg.evaluate(measureShop), await without.pg.evaluate(measureShop)]
      // the rule only ever adds air to a section SHORTER than a window minus 6rem; a taller one keeps its height
      const want = Math.max(y.secH, h - 6 * y.root)
      is(near(x.secH, want, 1), `${n} cards: section is max(its content, window - 6rem)`, `${Math.round(x.secH)}px, content ${Math.round(y.secH)}px, window - 6rem ${Math.round(h - 6 * y.root)}px`)
      if (y.secH >= h - 6 * y.root) is(near(x.docH, y.docH, 0.5), `${n} cards, section already taller than a window: page height unchanged`, `${x.docH} vs ${y.docH}`)
      await withRule.ctx.close(); await without.ctx.close()
    }
  }
}

// ---- 2. product page: the sticky gallery fits a short desktop window ------------------------------------
const measureGallery = () => {
  const vis = document.querySelector('.catalog-product-visual'), stage = document.querySelector('.catalog-gallery-stage'), img = document.querySelector('.catalog-gallery-photo')
  window.scrollTo(0, 500)
  const v = vis.getBoundingClientRect(), s = stage.getBoundingClientRect(), i = img.getBoundingClientRect()
  return {
    pos: getComputedStyle(vis).position, fit: getComputedStyle(img).objectFit, root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    visTop: v.top, visBottom: v.bottom, visLeft: v.left, visRight: v.right, visW: v.width,
    stW: s.width, stH: s.height, stLeft: s.left, stRight: s.right, stBottom: s.bottom,
    imgW: i.width, imgH: i.height, over: document.documentElement.scrollWidth - innerWidth, innerH: innerHeight,
  }
}
const gallerySizes = [[1280, 800], [1280, 720], [1366, 650], [1440, 768], [1100, 700], [1024, 600], [1280, 900], [1280, 1000], [1920, 1080], [1000, 700], [768, 1024], [390, 844], [320, 568]]
for (const lang of ['ar', 'en']) {
  for (const [w, h] of gallerySizes) {
    head(`${lang} product ${w}x${h}`)
    const a = await open(w, h, product(IMAGES), lang)
    const b = await open(w, h, product(''), lang)
    const m = await a.pg.evaluate(measureGallery), base = await b.pg.evaluate(measureGallery)
    is(m.over <= 0, 'nothing overflows sideways', `${m.over}px`)
    if (w >= 1024 && h <= 800) {
      is(m.pos === 'sticky', 'the gallery column is sticky', m.pos)
      is(m.visBottom <= h + 0.5 || m.stH <= 320.5, 'the stuck column ends inside the window', `bottom ${Math.round(m.visBottom)}px, window ${h}px`)
      is(near(m.stW, m.stH, 1), 'the stage is still a square', `${Math.round(m.stW)}x${Math.round(m.stH)}`)
      is(m.stH >= 320 - 0.5, 'never smaller than 320px', `${Math.round(m.stH)}px`)
      is(near(m.stLeft - m.visLeft, m.visRight - m.stRight, 1.5), 'the stage is centred in its column', `${(m.stLeft - m.visLeft).toFixed(1)} | ${(m.visRight - m.stRight).toFixed(1)}`)
      is(m.fit === 'contain' && near(m.imgW, m.stW - 2, 2) && near(m.imgH, m.stH - 2, 2), 'the photograph is contained, not cropped, and fills the stage', `${m.fit} ${Math.round(m.imgW)}x${Math.round(m.imgH)}`)
      is(m.stH <= base.stH + 0.5, 'never makes the stage bigger', `${Math.round(m.stH)} vs ${Math.round(base.stH)}`)
      // window height 190px under the stuck column's top is exactly where the cap starts to act
      if (base.visBottom <= h - 22 + 0.5) is(near(m.stH, base.stH, 0.5), 'a window the gallery already fits is left alone', `${Math.round(m.stH)} vs ${Math.round(base.stH)}`)
      // 22px of air at a 16px root; the sticky offset is 10rem, so on a very wide window (root up to 17.4px) it is ~16px
      else is(m.visBottom <= h - 14 || m.stH <= 320.5, 'it did not fit (baseline bottom ' + Math.round(base.visBottom) + 'px): now at least 14px of air under it', `bottom ${Math.round(m.visBottom)}px`)
    } else {
      is(near(m.stW, base.stW, 0.5) && near(m.stH, base.stH, 0.5) && near(m.stLeft, base.stLeft, 0.5), 'untouched: same stage as without the rule', `${Math.round(m.stW)}x${Math.round(m.stH)} vs ${Math.round(base.stW)}x${Math.round(base.stH)}`)
      if (w < 1024) is(m.pos !== 'sticky', 'not sticky under 1024px', m.pos)
    }
    await a.ctx.close(); await b.ctx.close()
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
