// NO ZOOM BADGE 1119 of public/sporta-product-fix.css (owner, 2026-11-19: "remove zoon icon at images"):
//   the 40px white tile with a magnifier that the compiled build draws in the end-bottom corner of the product photo is gone.
//   The photo stays the control: the cursor still says zoom-in, a click or a tap still opens the full-screen viewer.
//
//   npm run test:no-zoom-badge     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled product page (sculpt-jacket-black), ar + en, 390 and 1280 px, under the add-on files of this repo:
//   [nz-1] the badge element exists in the build's markup (so the test is measuring something) and is NOT drawn: display none,
//          a 0x0 box, nothing from it under the photo's end-bottom corner (elementFromPoint there is the photo, not the tile)
//   [nz-2] no magnifier svg is painted anywhere inside the photo stage
//   [nz-3] the stage still says zoom-in and still opens the full-screen viewer on a click
//   [nz-4] the photo stage keeps its size (the badge was absolute: nothing moves) and the page has no sideways scroll, no page error
//   [nz-5] the repo's own gallery component (src/components/ProductGallery.jsx) has no badge glyph either
// MUTATION: with the NO ZOOM BADGE block cut the badge is drawn again and [nz-1] / [nz-2] fail; a rule that targets a
// class the build does not use (a typo) hides nothing and fails the same way.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, WEB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-product-fix.css'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const PHOTO = photoPng(800, 800)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive(opts); try { return await fn(srv) } finally { await srv.close() } }
const open = async (srv, { w, lang }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }))
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}/product/sculpt-jacket-black?lang=${lang}`, { waitUntil: 'load' })
  await p.waitForSelector('.catalog-gallery-stage', { timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(1500)
  return { ctx, p, errs }
}

const MEASURE = () => {
  const stage = document.querySelector('.catalog-gallery-stage')
  const badge = stage && stage.querySelector('.catalog-gallery-zoom')
  const sr = stage ? stage.getBoundingClientRect() : null
  const br = badge ? badge.getBoundingClientRect() : null
  // the point where the tile used to sit: 12px in from the end-bottom corner, a little inside the 40px tile
  const rtl = document.documentElement.dir === 'rtl'
  let hit = null
  if (sr) {
    const x = rtl ? sr.left + 12 + 20 : sr.right - 12 - 20, y = sr.bottom - 12 - 20
    const e = document.elementFromPoint(x, y)
    hit = e ? { cls: String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className), inBadge: !!(badge && (e === badge || badge.contains(e))) } : null
  }
  const drawn = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  return {
    has: !!badge, display: badge ? getComputedStyle(badge).display : null, box: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null, hit,
    svgs: stage ? [...stage.querySelectorAll('svg')].filter(drawn).map((s) => (s.parentElement ? String(s.parentElement.className).slice(0, 60) : '?')) : null,
    cursor: stage ? getComputedStyle(stage).cursor : null,
    stage: sr ? { w: Math.round(sr.width), h: Math.round(sr.height) } : null,
    over: document.documentElement.scrollWidth - innerWidth,
  }
}
const CHECK = {
  gone: (m) => m.has && m.display === 'none' && m.box && m.box.w === 0 && m.box.h === 0 && m.hit && !m.hit.inBadge,
  noSvg: (m) => Array.isArray(m.svgs) && m.svgs.length === 0,
}
const run = (opts, o) => withServer(opts, async (srv) => { const t = await open(srv, o); const m = await t.p.evaluate(MEASURE); await t.ctx.close(); return { m, errs: t.errs } })

head('the real file, on the real compiled product page')
for (const [w, lang] of [[390, 'en'], [390, 'ar'], [1280, 'en'], [1280, 'ar']]) {
  const tag = `${lang} ${w}px`
  const { m, errs } = await run({}, { w, lang })
  is(CHECK.gone(m), `${tag}: the badge is in the markup and is not drawn (display none, 0x0, nothing under the corner)`, JSON.stringify({ d: m.display, b: m.box, h: m.hit }))
  is(CHECK.noSvg(m), `${tag}: no icon svg is painted inside the photo stage`, JSON.stringify(m.svgs))
  is(m.cursor === 'zoom-in' || m.cursor === 'pointer', `${tag}: the stage still invites a click (cursor ${m.cursor})`)
  is(m.stage && m.stage.w > 200 && m.stage.h > 200, `${tag}: the photo stage keeps its size`, JSON.stringify(m.stage))
  is(m.over <= 0 && errs.length === 0, `${tag}: no sideways scroll, no page error`, `${m.over}px ${errs.join(' | ')}`)
}
{ // the photo is still the control
  await withServer({}, async (srv) => {
    for (const w of [390, 1280]) {
      const t = await open(srv, { w, lang: 'en' })
      await t.p.click('.catalog-gallery-stage', { position: { x: 40, y: 40 } })
      const opened = await t.p.waitForSelector('.catalog-product-lightbox', { timeout: 5000 }).then(() => true, () => false)
      is(opened, `${w}px: a tap on the photo still opens the full-screen viewer`)
      await t.ctx.close()
    }
  })
}
{ // the repo's own gallery
  const src = readFileSync(join(WEB, 'src', 'components', 'ProductGallery.jsx'), 'utf8')
  is(!src.includes('⤢'), 'src/components/ProductGallery.jsx: no zoom glyph is drawn over the photo')
  is(/cursor-zoom-in/.test(src) && /onClick=\{\(\) => \{ if \(!moved\.current\) onZoom\(\)/.test(src), 'src/components/ProductGallery.jsx: the frame is still the control (cursor zoom-in, click opens the viewer)')
}

head('mutants: with the block cut, the badge comes back')
const A = CSS.indexOf('/* ==== NO ZOOM BADGE 1119'), Z = CSS.indexOf('/* ==== end NO ZOOM BADGE 1119 */')
is(A > 0 && Z > A, 'the NO ZOOM BADGE 1119 section is in the file')
const cut = A > 0 && Z > A ? CSS.slice(0, A) + CSS.slice(Z + '/* ==== end NO ZOOM BADGE 1119 */'.length) : CSS
const typo = CSS.slice(0, A) + CSS.slice(A, Z).replaceAll('.catalog-gallery-zoom', '.catalog-gallery-zoomx') + CSS.slice(Z)
for (const [label, css] of [['the block cut', cut], ['the selector misspelt', typo]]) {
  if (css === CSS) { is(false, `mutant "${label}": the cut text was found`); continue }
  const good = await run({}, { w: 1280, lang: 'en' }), bad = await run({ css: { [CSS_F]: css } }, { w: 1280, lang: 'en' })
  is(CHECK.gone(good.m), `mutant "${label}": the check passes on the real file`)
  is(CHECK.gone(bad.m) === false, `mutant "${label}": and goes red with it`, JSON.stringify({ d: bad.m.display, b: bad.m.box }))
}
{ // the badge really is the magnifier: with the block cut, the icon is the one svg inside the tile
  const bad = await run({ css: { [CSS_F]: cut } }, { w: 1280, lang: 'en' })
  is(CHECK.noSvg(bad.m) === false, 'mutant "the block cut": the magnifier svg is painted again (so [nz-2] measures the real thing)', JSON.stringify(bad.m.svgs))
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
