// npm run test:images-backdrop - IMAGES-1112 in public/sporta-images.css + the PHOTO BACKDROP block of public/sporta-features.js,
// on the CAPTURED LIVE MARKUP under the LIVE compiled rules and every add-on stylesheet the live index.html links:
//   product page   scripts/fixtures/sizes-product (full: square gallery stage + "Complete the look" cards), light and dark
//   /shop          scripts/fixtures/grid/shop-out (12 cards, photos and "no photo" plates)
//   home           scripts/fixtures/sizes-screen/home (the essentials cards)
// at 390 / 768 / 1280px, Arabic and English.
//
// The live photographs are not in the repo. They are stood in for by JPEGs drawn here with the measured live backdrop
// (live-images-scan.mjs, 2026-11-10: about 195/192/184, a little lighter in the middle) round a navy garment, in the
// shapes that make bands: 4:5 (side bands in the square stage), 1:1 (bands above and below a 4:5 card), 3:4; plus a
// "busy" photo whose garment runs off its left edge (must be left alone) and the real "no photo" plate.
//
// What is measured, on a screenshot of the page (what a shopper sees, not a computed style):
//   band step   the colour step between a band of the frame and the photo's edge next to it. Without the add-on that
//               step is white against beige (~60/255); with it it must be under 8.
//   untouched   the busy photo, the plate and every frame's size; the page height; no sideways scroll; no layout shift
//               while the script works (PerformanceObserver layout-shift = 0).
// Mutations (must FAIL): the CSS section removed (the script alone paints nothing); the script not run.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as PRD from './lib/sizes-product-page.mjs'
import * as SCR from './lib/sizes-screen-page.mjs'
import { CAP } from './lib/storefront-polish-page.mjs'

const ROOT = PRD.ROOT
const CSS_FILE = join(ROOT, 'public/sporta-images.css')
const CSS = readFileSync(CSS_FILE, 'utf8')
const JS_ALL = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const JS = JS_ALL.slice(JS_ALL.indexOf('/* ===== PHOTO BACKDROP (2026'), JS_ALL.indexOf('/* ===== PHOTO BACKDROP - end'))
const SECTION = CSS.slice(CSS.indexOf('/* ==== IMAGES-1112'), CSS.indexOf('/* ==== end IMAGES-1112'))
const CSS_OFF = CSS.replace(SECTION, '')

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ---- static -----------------------------------------------------------------------------------------------------------
head('static')
is(SECTION.length > 200 && CSS.indexOf('/* ==== IMAGES-1112') > CSS.indexOf('/* ==== FRAMES'), 'IMAGES-1112 is one section, after FRAMES')
is(JS.length > 2000 && JS_ALL.indexOf('/* ===== PHOTO BACKDROP') < JS_ALL.indexOf('Product names: the full name as a tooltip'), 'the PHOTO BACKDROP block sits before the title block (which stays the last IIFE)')
is(!/innerHTML|textContent\s*=|\.src\s*=|setAttribute\('src'|fetch\(|XMLHttpRequest|toDataURL|toBlob/.test(JS), 'the block never changes a src, writes markup, makes a request or encodes an image')
is(/\/backends/.test(JS) && /product-photo-unavailable/.test(JS), 'the block stands down on /backends and never reads the plate')
is(!/https?:\/\//.test(SECTION), 'no external URL in the section')

// ---- stand-in photographs ----------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const PHOTOS = {}
{
  const p = await browser.newPage()
  const draw = (w, h, busy) => p.evaluate(([w, h, busy]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d')
    const g = x.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h / 2, Math.max(w, h) * 0.75)
    g.addColorStop(0, 'rgb(205,202,194)'); g.addColorStop(1, 'rgb(186,183,175)')
    x.fillStyle = g; x.fillRect(0, 0, w, h)
    x.fillStyle = 'rgb(28,36,64)'
    if (busy) x.fillRect(0, h * 0.2, w * 0.7, h * 0.8)   // a cropped shot: the garment runs off the left and the bottom edge
    else { x.beginPath(); x.moveTo(w * 0.3, h * 0.2); x.lineTo(w * 0.7, h * 0.2); x.lineTo(w * 0.78, h * 0.35); x.lineTo(w * 0.68, h * 0.4); x.lineTo(w * 0.68, h * 0.8); x.lineTo(w * 0.32, h * 0.8); x.lineTo(w * 0.32, h * 0.4); x.lineTo(w * 0.22, h * 0.35); x.closePath(); x.fill() }
    return c.toDataURL('image/jpeg', 0.92).split(',')[1]
  }, [w, h, busy])
  PHOTOS.p45 = Buffer.from(await draw(800, 1000, false), 'base64')
  PHOTOS.p11 = Buffer.from(await draw(900, 900, false), 'base64')
  PHOTOS.p34 = Buffer.from(await draw(750, 1000, false), 'base64')
  PHOTOS.busy = Buffer.from(await draw(900, 900, true), 'base64')
  await p.close()
}
// which stand-in each live file name gets (the gallery's main photo is 4:5: two side bands and a ring in the square stage)
const pick = (name) => /sgomma-t-shirt-navy/.test(name) ? 'p45' : /cagliari-calcio-sweatshirt/.test(name) ? 'p11' : /army-green/.test(name) ? 'busy'
  : /cherry-red|coffee/.test(name) ? 'p34' : 'p11'
const PLATE = readFileSync(join(ROOT, 'public/product-photo-unavailable.svg'))

const prdRef = { current: null }, scrRef = { current: null }
const prd = await PRD.serve(prdRef), scr = await SCR.serve(scrRef)

// open a page; css = the full sporta-images.css to use; js = run the block
async function open(kind, n, lang, w, { css, js, dark = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    window.__cls = 0
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: false }) } catch (e) {}
  })
  await p.route('**/images/products/**', (r) => {
    const name = new URL(r.request().url()).pathname
    return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PHOTOS[pick(name)] })
  })
  await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLATE }))
  if (kind === 'prd') { prdRef.current = { ...PRD.addonFiles(), 'sporta-images.css': css }; await p.goto(`${prd.base}/__fx/${n}-${lang}-${w}${dark ? '-dark' : ''}`) }
  else if (kind === 'scr') { scrRef.current = { ...SCR.addonFiles(), 'sporta-images.css': css }; await p.goto(`${scr.base}/__fx/${n}-${lang}`) }
  else {
    // the captured /shop page carries the live sporta-images.css inside its CSSOM dump: swap it for ours too
    const html = CAP[n](lang, readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')).split(/(?=\/\* ---- )/).map((b) => /^\/\* ---- \/sporta-images\.css/.test(b) ? '/* ---- repo sporta-images.css ---- */\n' + css + '\n' + b.slice(b.indexOf('</style>')) : b).join('')
    await p.route('http://fx.test/**', (r) => { const u = new URL(r.request().url()).pathname; return u === '/' ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.fallback() })
    await p.goto('http://fx.test/')
    if (process.env.DEBUG) console.log('cap imgs', await p.evaluate(() => document.querySelectorAll('img.catalog-card-photo').length + ' ' + location.href))
    if (dark) await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.classList.add('dark') })
  }
  // every photo is loaded before measuring (the fixtures' lazy cards below the fold would otherwise never load in a headless page)
  await p.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 4000)), Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r) }) }))]))
  await p.evaluate(() => document.fonts.ready)
  const before = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, frames: [...document.querySelectorAll('.catalog-card-image, .catalog-gallery-stage')].map((f) => { const r = f.getBoundingClientRect(); return [r.width, r.height].map(Math.round).join('x') }).join() }))
  await p.waitForTimeout(300)
  await p.evaluate(() => { window.__cls = 0 })   // only what moves once the script is on the page counts
  if (js) await p.addScriptTag({ content: JS })
  await p.waitForTimeout(900)
  if (process.env.DEBUG) { p.on('console', (m) => console.log('  pg:', m.text())); await p.evaluate(() => { window.__dbg = 1 }) }
  if (process.env.DEBUG) console.log(await p.evaluate(() => [...document.querySelectorAll('[data-sporta-bg]')].map((i) => i.src.slice(-40) + ' ' + i.getBoundingClientRect().width + 'x' + i.getBoundingClientRect().height + ' n' + i.naturalWidth + 'x' + i.naturalHeight + ' :: ' + getComputedStyle(i).background.slice(0, 400)).join('\n')))
  return { p, ctx, before }
}

// in-page: every product photo, its frame and the pairs of points to compare (a point in a band, the photo's own edge beside it).
// A point covered by something else (a badge, the wishlist heart, the zoom button) is dropped: only the photo's own pixels count.
const boxes = async () => {
  const out = []
  const list = [...document.querySelectorAll('img.catalog-card-photo, .catalog-gallery img')]
  for (let k = 0; k < list.length; k++) {
    const i = list[k]
    const f = i.closest('.catalog-card-image, .catalog-gallery-stage') || i
    const cs = getComputedStyle(i), b = i.getBoundingClientRect()
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom)
    const cw = b.width - pl - pr, ch = b.height - pt - pb, ra = i.naturalWidth / i.naturalHeight
    if (!(ra > 0 && cw > 0 && ch > 0)) { out.push({ k, src: i.src, plate: /unavailable/.test(i.src), tagged: i.hasAttribute('data-sporta-bg'), bands: false, pairs: [], frame: {} }); continue }
    let dw = cw, dh = ch
    if (ra < cw / ch) dw = ch * ra; else dh = cw / ra
    const px = b.left + pl + (cw - dw) / 2, py = b.top + pt + (ch - dh) / 2
    const gapL = px - b.left, gapT = py - b.top
    const pairs = []
    if (gapL > 4) for (const t of [0.15, 0.5, 0.85]) { const y = py + dh * t; pairs.push([[b.left + gapL / 2, y], [px + 2, y]], [[b.right - gapL / 2, y], [px + dw - 3, y]]) }
    if (gapT > 4) for (const t of [0.15, 0.5, 0.85]) { const x = px + dw * t; pairs.push([[x, b.top + gapT / 2], [x, py + 2]], [[x, b.bottom - gapT / 2], [x, py + dh - 3]]) }
    const own = (x, y) => document.elementFromPoint(x, y) === i
    if (window.__dbg) console.log(i.src.slice(-30), pairs.map(([u, v]) => { const e = document.elementFromPoint(u[0], u[1]); return e ? e.tagName + '.' + String(e.className).slice(0, 40) : 'null' }).join(' | '))
    const keep = pairs.filter(([u, v]) => own(u[0], u[1]) && own(v[0], v[1])).map((pr2) => pr2.map(([x, y]) => [x, y + scrollY]))
    out.push({
      k, src: (i.currentSrc || i.src).replace(location.origin, ''), plate: /unavailable/.test(i.src), tagged: i.getAttribute('data-sporta-bg') === '1',
      bands: pairs.length > 0, pairs: keep, frame: (() => { const r = f.getBoundingClientRect(); return { w: r.width, h: r.height } })(),
    })
  }
  return out
}

// read the pixel pairs off a full-page screenshot (in a scratch page, through a canvas): the largest colour step per photo
async function steps(p, list) {
  const shot = (await p.screenshot()).toString('base64')
  const q = await browser.newPage()
  const out = await q.evaluate(async ([shot, list]) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + shot; await im.decode()
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height
    const x = c.getContext('2d'); x.drawImage(im, 0, 0)
    const px = ([a, b]) => { const d = x.getImageData(Math.round(a), Math.round(b), 1, 1).data; return [d[0], d[1], d[2]] }
    const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
    return list.map((o) => ({ k: o.k, bands: o.bands && o.pairs.length > 0, step: o.pairs.length ? Math.max(...o.pairs.map(([u, v]) => diff(px(u), px(v)))) : 0 }))
  }, [shot, list])
  await q.close()
  return out
}

const PAGES = [
  { id: 'product', kind: 'prd', n: 'full', dark: [false, true] },
  { id: 'shop', kind: 'cap', n: 'shop', dark: [false, true] },
  { id: 'home', kind: 'scr', n: 'home', dark: [false] },
]
const summary = []
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null   // e.g. ONLY=product:ar:390 for a quick look
for (const pg of PAGES) for (const lang of ['ar', 'en']) for (const w of [390, 768, 1280]) for (const dark of pg.dark) {
  if (ONLY && !ONLY.some((o) => { const [a, b, c] = o.split(':'); return a === pg.id && (!b || b === lang) && (!c || +c === w) })) continue
  const tag = `${pg.id} ${lang} ${w}px${dark ? ' dark' : ''}`
  head(tag)
  const runs = {}
  for (const [name, opt] of [['off', { css: CSS_OFF, js: false }], ['on', { css: CSS, js: true }], ['js-only', { css: CSS_OFF, js: true }], ['css-only', { css: CSS, js: false }]]) {
    const { p, ctx, before } = await open(pg.kind, pg.n, lang, w, { ...opt, dark })
    const page = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, over: document.documentElement.scrollWidth - innerWidth, cls: window.__cls, frames: [...document.querySelectorAll('.catalog-card-image, .catalog-gallery-stage')].map((f) => { const r = f.getBoundingClientRect(); return [r.width, r.height].map(Math.round).join('x') }).join() }))
    // the pixels are read with the whole page in one window (so every point can be hit-tested); the script follows the resize
    await p.setViewportSize({ width: w, height: Math.min(7000, page.h) }); await p.waitForTimeout(800)
    const list = await p.evaluate(boxes)
    const st = await steps(p, list)
    runs[name] = { list, st, page, before }
    await ctx.close()
  }
  const { off, on } = runs
  // photos that are real backdrop photos and show bands in this frame
  const real = on.list.filter((o) => !o.plate && pick(o.src) !== 'busy')
  const banded = on.st.filter((s, i) => { const o = on.list[i]; return s.bands && !o.plate && pick(o.src) !== 'busy' })
  const offBanded = off.st.filter((s, i) => { const o = off.list[i]; return s.bands && !o.plate && pick(o.src) !== 'busy' })
  const worstOff = Math.max(0, ...offBanded.map((s) => s.step)), worstOn = Math.max(0, ...banded.map((s) => s.step))
  if (banded.length) {
    is(worstOff >= 30, `${tag}: add-on off, the frame's white bands stand out from the photo's backdrop (the live look)`, `step ${worstOff}`)
    is(worstOn <= 8, `${tag}: the bands continue the photo's own backdrop (${banded.length} photo(s) with bands)`, `worst step ${worstOn}; ` + banded.filter((s) => s.step > 8).map((s) => on.list[s.k].src + ' ' + s.step).join(' | '))
    const jo = Math.max(0, ...runs['js-only'].st.filter((s, i) => s.bands && !runs['js-only'].list[i].plate && pick(runs['js-only'].list[i].src) !== 'busy').map((s) => s.step))
    const co = Math.max(0, ...runs['css-only'].st.filter((s, i) => s.bands && !runs['css-only'].list[i].plate && pick(runs['css-only'].list[i].src) !== 'busy').map((s) => s.step))
    is(jo >= 30, `${tag}: mutation, the CSS section removed: the script alone paints nothing`, `step ${jo}`)
    is(co >= 30, `${tag}: mutation, the script not run: the section alone paints nothing`, `step ${co}`)
  }
  is(real.every((o) => o.tagged === on.st[o.k].bands || o.tagged), `${tag}: every real photo that shows bands is tagged`, real.filter((o) => on.st[o.k].bands && !o.tagged).map((o) => o.src).join())
  const busy = on.list.filter((o) => pick(o.src) === 'busy' && !o.plate)
  is(busy.every((o) => !o.tagged), `${tag}: a photo whose garment runs off its edge is left exactly as it was`, busy.map((o) => o.src).join())
  is(on.list.filter((o) => o.plate).every((o) => !o.tagged), `${tag}: the "no photo" plate is never painted`)
  is(on.page.frames === off.page.frames && on.page.frames === on.before.frames, `${tag}: every frame keeps its size (before / after the script, add-on off)`)
  is(Math.abs(on.page.h - off.page.h) < 0.5, `${tag}: the page height is unchanged`, `${off.page.h} -> ${on.page.h}`)
  is(on.page.over <= 0, `${tag}: no sideways scroll`, `${on.page.over}px`)
  is(on.page.cls === 0, `${tag}: no layout shift while the script works`, `CLS ${on.page.cls}`)
  summary.push(`${tag.padEnd(26)} photos ${String(on.list.length).padStart(2)}  with bands ${String(banded.length).padStart(2)}  band step off ${String(worstOff).padStart(3)} -> on ${String(worstOn).padStart(2)}  tagged ${on.list.filter((o) => o.tagged).length}`)
}

// the load path: React changes a photo's src in place (a gallery slide, a reused card); the new photo is read afresh, and a
// photo that becomes the plate loses its paint
head('src changed in place')
{
  const { p, ctx } = await open('prd', 'full', 'ar', 390, { css: CSS, js: true })
  const a = await p.evaluate(async () => {
    const i = document.querySelector('.catalog-gallery img'); const t0 = i.getAttribute('data-sporta-bg')
    await new Promise((r) => { i.onload = r; i.src = '/images/products/cloudsoft-leggings-army-green.jpg' })
    await new Promise((r) => setTimeout(r, 700)); const t1 = i.getAttribute('data-sporta-bg')
    await new Promise((r) => { i.onload = r; i.src = '/images/products/sgomma-t-shirt-navy.jpg?b' })
    await new Promise((r) => setTimeout(r, 700)); const t2 = i.getAttribute('data-sporta-bg')
    await new Promise((r) => { i.onload = r; i.src = '/product-photo-unavailable.svg' })
    await new Promise((r) => setTimeout(r, 700)); const t3 = i.getAttribute('data-sporta-bg')
    return [t0, t1, t2, t3]
  })
  is(a[0] === '1' && a[1] === null && a[2] === '1' && a[3] === null, 'gallery photo: painted, then a busy photo clears it, a backdrop photo paints again, the plate clears it', JSON.stringify(a))
  await ctx.close()
}
head('/backends')
{
  const ctx = await browser.newContext(); const p = await ctx.newPage()
  await p.route('http://fx.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<div class="catalog-card-image"><img class="catalog-card-photo" style="object-fit:contain;width:200px;height:250px" src="/images/products/x.jpg"></div>' }))
  await p.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: PHOTOS.p11 }))
  await p.goto('http://fx.test/backends/products'); await p.addScriptTag({ content: JS }); await p.waitForTimeout(600)
  is(await p.evaluate(() => !document.querySelector('[data-sporta-bg]')), 'nothing is painted on /backends')
  await ctx.close()
}

prd.server.close(); scr.server.close()
await browser.close()
console.log('\n' + summary.join('\n'))
if (fails.length) console.log('\nFAILED:\n  ' + fails.join('\n  '))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
