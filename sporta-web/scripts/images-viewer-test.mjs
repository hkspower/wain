// npm run test:images-viewer - the IMAGE VIEWER block of public/sporta-features.js + VIEWER-1112 in public/sporta-shadows.css,
// on the LIVE product gallery: scripts/fixtures/gallery/live-gallery.mjs is a verbatim excerpt of the compiled build (stage,
// arrows, dots, thumbnails, the full-screen lightbox), run with React 19 inside the captured live product page under the live
// rules and every add-on stylesheet (scripts/lib/gallery-page.mjs). The excerpt is first checked against the capture: a
// one-photo render must be byte for byte the captured live markup.
//
// Pages: 390px (phone, touch, DPR 2), 768px (tablet, touch, DPR 2), 1280px (mouse); Arabic and English; light and dark.
// Products: four photos (the live denver-nuggets-cap-navy set), one photo, the "no photo" plate, a photo whose full-size file
// fails inside the viewer. The photos are stand-ins drawn here (the measured live studio backdrop round a garment).
//
// What is proven, per page: the full-size original is not downloaded before the viewer opens, and is when it opens; the
// dialog is described and labelled in the page's language, every control is 44px and on screen, previous / next sit on the
// reading direction's sides and point there, focus stays inside; previous / next / arrow keys move in the reading direction
// (Arabic: ArrowLeft = next); swipe moves the same way as the stage; pinch, double-tap, double-click, wheel, keys and the zoom
// button zoom, a zoomed photo pans and a drag then does not change the photo; swipe down, Escape and the X close and focus
// returns to the stage; a drag that ends on the backdrop does not close; the page does not scroll and nothing shifts
// (layout-shift = 0; with a classic scrollbar the page does not move sideways); the plate opens nothing; a photo that fails in
// the viewer cannot be zoomed; the photo backdrop block still paints the gallery and never the viewer.
// Mutations (must FAIL): the block not run (the live behaviour), the CSS section removed.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as G from './lib/gallery-page.mjs'
import * as PRD from './lib/sizes-product-page.mjs'

const ROOT = G.ROOT
const JS_ALL = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const JS = JS_ALL.slice(JS_ALL.indexOf('/* ===== IMAGE VIEWER (2026'), JS_ALL.indexOf('/* ===== IMAGE VIEWER - end'))
const BACKDROP = JS_ALL.slice(JS_ALL.indexOf('/* ===== PHOTO BACKDROP (2026'), JS_ALL.indexOf('/* ===== PHOTO BACKDROP - end'))
const SH_FILE = join(ROOT, 'public/sporta-shadows.css')
const SH = readFileSync(SH_FILE, 'utf8')
const SECTION = SH.slice(SH.indexOf('/* ==== VIEWER-1112'), SH.indexOf('/* ==== end VIEWER-1112'))
const SH_OFF = SH.replace(SECTION, '')

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')); if (process.env.DEBUG) console.log('FAIL ' + msg + ' ' + detail) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ---- static -----------------------------------------------------------------------------------------------------------
head('static')
is(JS.length > 4000 && JS_ALL.indexOf('/* ===== IMAGE VIEWER') > JS_ALL.indexOf('/* ===== PHOTO BACKDROP - end') && JS_ALL.indexOf('/* ===== IMAGE VIEWER') < JS_ALL.indexOf('Product names: the full name as a tooltip'), 'the IMAGE VIEWER block sits after PHOTO BACKDROP and before the title block (which stays the last IIFE)')
is(!/innerHTML|outerHTML|insertAdjacentHTML|\.src\s*=|setAttribute\('src'|fetch\(|XMLHttpRequest|new Image|localStorage|sessionStorage/.test(JS), 'the block never writes markup or a src, makes a request or stores anything')
is(/\/backends/.test(JS) && /__sportaImageViewer/.test(JS), 'the block stands down on /backends and runs once per page')
is(SECTION.length > 1000 && SH.indexOf('/* ==== VIEWER-1112') < SH.indexOf('/* ==== ICON SET') && SH.indexOf('/* ==== VIEWER-1112') > SH.indexOf('/* ==== end ICON USE'), 'VIEWER-1112 is one section of sporta-shadows.css, before ICON SET')
is(!/https?:\/\//.test(SECTION), 'no external URL in the section')
is(SECTION.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter((r) => r.includes('{') && !/@keyframes|^\s*to\s*\{/.test(r)).every((r) => /data-sporta-viewer|sporta-viewer-|data-sporta-zoomed|data-sporta-plate|data-sporta-loading|data-sporta-noview|@media|^\s*\.catalog-product-lightbox \.sporta/.test(r) || /^\s*$/.test(r.split('{')[0])), 'every rule is keyed on something only the block writes')

// ---- stand-in photographs ------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const PHOTOS = []
{
  const p = await browser.newPage()
  for (const garment of ['rgb(28,36,64)', 'rgb(120,30,40)', 'rgb(40,90,50)', 'rgb(90,70,30)']) {
    PHOTOS.push(Buffer.from(await p.evaluate((garment) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 900
      const x = c.getContext('2d')
      x.fillStyle = 'rgb(195,192,184)'; x.fillRect(0, 0, 900, 900)
      x.fillStyle = garment; x.fillRect(250, 200, 400, 520)
      x.fillStyle = '#fff'; x.fillRect(300, 260, 60, 60)   // a detail to zoom into
      return c.toDataURL('image/jpeg', 0.92).split(',')[1]
    }, garment), 'base64'))
  }
  await p.close()
}
const photoFor = (path) => { const m = path.match(/view-(\d)/); return PHOTOS[m ? +m[1] - 1 : 0] }
const PLATE = readFileSync(join(ROOT, 'public/product-photo-unavailable.svg'))
const isOriginal = (u) => /\/images\/products\/(?!responsive\/)[^/]+\.(jpg|png)$/.test(u)

const ref = { current: null }
const srv = await G.serve(ref)
const ALT = { en: 'Denver Nuggets Cap — Navy', ar: 'قبعة دنفر ناغتس — كحلي' }
const DEV = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  768: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1280: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
}

// open the product page with a scenario; mode: 'on' (block + section), 'js-off' (live), 'css-off' (block, section removed)
async function open(set, lang, w, { mode = 'on', dark = false, fail404 = null, br = browser } = {}) {
  const ctx = await br.newContext(DEV[w])
  const p = await ctx.newPage()
  const reqs = []
  await p.addInitScript(() => {
    window.__cls = 0
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {}
  })
  await p.route('**/images/products/**', (r) => {
    const u = new URL(r.request().url()).pathname
    reqs.push(u)
    if (fail404 && fail404.test(u)) return r.fulfill({ status: 404, body: '' })
    return r.fulfill({ status: 200, contentType: 'image/jpeg', body: photoFor(u) })
  })
  await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLATE }))
  ref.current = { addons: { ...PRD.addonFiles(), 'sporta-shadows.css': mode === 'css-off' ? SH_OFF : SH }, extra: G.extraCss() }
  await p.goto(`${srv.base}/__gx/${G.SETS[set].fx}-${lang}-${w}${dark ? '-dark' : ''}`)
  if (mode !== 'js-off') { await p.addScriptTag({ content: BACKDROP }); await p.addScriptTag({ content: JS }) }
  await p.evaluate(([images, alt, lang]) => window.__fxMount({ images, alt, lang }), [G.SETS[set].images, ALT[lang], lang])
  await p.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 3000)), Promise.all([...document.querySelectorAll('.catalog-gallery img')].map((i) => i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r) })))]))
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(250)
  await p.evaluate(() => { window.__cls = 0 })   // what the harness's mount moved is not the viewer's
  const cdp = DEV[w].hasTouch ? await ctx.newCDPSession(p) : null
  return { p, ctx, reqs, cdp }
}

// in-page state of the viewer
const S = () => {
  const b = document.querySelector('.catalog-product-lightbox')
  const img = b && b.querySelector(':scope > img')
  const m = img ? getComputedStyle(img).transform : 'none'
  const mm = m && m !== 'none' ? m.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0]
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } }
  const btns = b ? [...b.querySelectorAll('button')].filter((x) => getComputedStyle(x).display !== 'none' && x.getClientRects().length) : []
  const hint = b && b.getAttribute('aria-describedby') ? document.getElementById(b.getAttribute('aria-describedby')) : null
  const cnt = b && b.querySelector(':scope > p:not(.sporta-viewer-hint)')
  const one = (sel) => { const e = b && b.querySelector(sel); if (!e) return null; const bs = getComputedStyle(e, '::before'); return { ...R(e), shown: getComputedStyle(e).display !== 'none', label: e.getAttribute('aria-label'), mask: bs.maskImage || bs.webkitMaskImage || '', color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor, pressed: e.getAttribute('aria-pressed') } }
  const stage = document.querySelector('.catalog-gallery-stage')
  return {
    open: !!b, role: b && b.getAttribute('role'), modal: b && b.getAttribute('aria-modal'), label: b && b.getAttribute('aria-label'),
    hint: hint ? hint.textContent : '', hintVisible: hint ? R(hint).w > 2 : false,
    src: img ? img.getAttribute('src') : null, scale: mm[0], tx: mm[4], ty: mm[5], tagged: img ? img.hasAttribute('data-sporta-bg') : false,
    plate: b ? b.hasAttribute('data-sporta-plate') : false, loading: b ? b.hasAttribute('data-sporta-loading') : false,
    count: cnt ? cnt.textContent : '', live: cnt ? cnt.getAttribute('aria-live') : null,
    btns: btns.map((x) => ({ ...R(x), label: x.getAttribute('aria-label') })), vw: innerWidth, vh: innerHeight,
    prev: one('.sporta-viewer-prev'), next: one('.sporta-viewer-next'), zoom: one('.sporta-viewer-zoom'),
    focusIn: !!(b && b.contains(document.activeElement)), focusStage: document.activeElement === stage,
    scrollY, docH: document.documentElement.scrollHeight, over: document.documentElement.scrollWidth - innerWidth, cls: window.__cls,
    stage: stage ? { ...R(stage), noview: stage.hasAttribute('data-sporta-noview'), dis: stage.getAttribute('aria-disabled'), pop: stage.getAttribute('aria-haspopup'), cursor: getComputedStyle(stage).cursor, badge: getComputedStyle(stage.querySelector('.catalog-gallery-zoom')).visibility } : null,
    title: (() => { const e = document.querySelector('.catalog-product-title'); return e ? R(e) : null })(),
    galleryTagged: [...document.querySelectorAll('.catalog-gallery-track > img')].some((i) => i.hasAttribute('data-sporta-bg')),
  }
}
const st = (p) => p.evaluate(S)
const settle = (p, ms = 320) => p.waitForTimeout(ms)
const center = async (p) => p.evaluate(() => { const i = document.querySelector('.catalog-product-lightbox > img'); const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })

// touch through the DevTools protocol (Playwright has tap only)
const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })) })
async function swipe(cdp, from, to, steps = 8, ms = 120) {
  await T(cdp, 'touchStart', [from])
  for (let i = 1; i <= steps; i++) { await T(cdp, 'touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await new Promise((r) => setTimeout(r, ms / steps)) }
  await T(cdp, 'touchEnd', [])
}
async function pinch(cdp, c, d0, d1, steps = 8) {
  const at = (d) => [[c.x - d, c.y], [c.x + d, c.y]]
  await T(cdp, 'touchStart', at(d0))
  for (let i = 1; i <= steps; i++) { await T(cdp, 'touchMove', at(d0 + (d1 - d0) * i / steps)); await new Promise((r) => setTimeout(r, 15)) }
  await T(cdp, 'touchEnd', [])
}
async function dtap(cdp, x, y) {
  for (let k = 0; k < 2; k++) { await T(cdp, 'touchStart', [[x, y]]); await T(cdp, 'touchEnd', []); await new Promise((r) => setTimeout(r, 90)) }
}
const openViewer = async (o, w, expectOpen = true) => {
  for (let k = 0; k < (expectOpen ? 3 : 1); k++) {
    if (DEV[w].hasTouch) await o.p.tap('.catalog-gallery-stage', { force: true }); else await o.p.click('.catalog-gallery-stage', { force: true })
    if (!expectOpen) { await settle(o.p, 250); return }
    if (await o.p.waitForSelector('.catalog-product-lightbox', { timeout: 1500 }).then(() => true, () => false)) break
  }
  await settle(o.p, 250)
}

// ---- fidelity of the excerpt ------------------------------------------------------------------------------------------------
head('the live gallery excerpt renders the captured live markup')
for (const lang of ['ar', 'en']) for (const [set, fx] of [['single', 'full'], ['plate', 'one']]) {
  const raw = readFileSync(join(PRD.FX, `${fx}-${lang}.html`), 'utf8')
  const capt = raw.slice(raw.indexOf('<div class="catalog-gallery">'), raw.indexOf('<div class="catalog-product-summary'))
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage()
  ref.current = { addons: PRD.addonFiles(), extra: '' }
  await p.goto(`${srv.base}/__gx/${fx}-${lang}-390`)
  const captured = await p.evaluate(() => document.querySelector('.catalog-product-visual').innerHTML)
  const alt = raw.match(/class="catalog-gallery-photo[^>]*/) ? (raw.match(/<img[^>]*alt="([^"]*)"[^>]*catalog-gallery-photo/) || [])[1] : ''
  await p.evaluate(([images, alt, lang]) => window.__fxMount({ images, alt, lang }), [G.SETS[set].images, alt.replace(/&amp;/g, '&'), lang])
  const rendered = await p.evaluate(() => document.querySelector('.catalog-product-visual').innerHTML)
  is(capt.length > 500 && rendered === captured, `${lang} ${set}: the excerpt's one-photo render equals the captured live gallery`, rendered === captured ? '' : `${captured.length} vs ${rendered.length}: ` + [...rendered].findIndex((c, i) => c !== captured[i]) + ' ' + rendered.slice([...rendered].findIndex((c, i) => c !== captured[i]) - 60, [...rendered].findIndex((c, i) => c !== captured[i]) + 60))
  await ctx.close()
}

// ---- per page --------------------------------------------------------------------------------------------------------------
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const blank = () => ({ nav: [], rtlKey: [], swipe: [], pinch: [], dbl: [], plate: [], drag: [], size: [], desc: [] })
const mut = { 'js-off': blank(), 'css-off': blank() }
for (const lang of ['ar', 'en']) for (const w of [390, 768, 1280]) for (const dark of [false, true]) {
  if (ONLY && !ONLY.some((o) => { const [a, b] = o.split(':'); return (!a || a === lang) && (!b || +b === w) })) continue
  const tag = `${lang} ${w}px${dark ? ' dark' : ''}`
  const touch = !!DEV[w].hasTouch, rtl = lang === 'ar'
  head(tag)
  for (const mode of ['on', 'js-off', 'css-off']) {
    const on = mode === 'on'
    const lab = `${tag} [${mode}]`
    const M = mut[mode] || blank()
    // ---------- four photos
    const o = await open('multi', lang, w, { mode, dark, fail404: /denver-nuggets-cap-navy-view-3\.jpg$/ })
    const { p, cdp } = o
    const s0 = await st(p)
    if (on) {
      is(o.reqs.some((u) => /denver/.test(u)) && !o.reqs.some((u) => /denver/.test(u) && isOriginal(u)), `${lab}: before the viewer opens no full-size original of the gallery is downloaded (stage and thumbnails use the small copies)`, o.reqs.filter((u) => /denver/.test(u) && isOriginal(u)).join())
      is(s0.stage.pop === 'dialog' && !s0.stage.noview, `${lab}: the stage says it opens a dialog`)
      is(s0.over <= 0, `${lab}: no sideways scroll`, String(s0.over))
    }
    if (mode === 'js-off') { const b = await open('multi', lang, w, { mode: 'on', dark }); const sb = await st(b.p); is(Math.abs(sb.docH - s0.docH) < 0.5 && Math.abs(sb.stage.w - s0.stage.w) < 0.5 && Math.abs(sb.stage.y - s0.stage.y) < 0.5, `${tag}: the block changes nothing on the page itself (height, stage box)`, `${s0.docH}/${sb.docH}`); await b.ctx.close() }
    await p.evaluate(() => window.scrollTo(0, 60)); await settle(p, 100)
    const sB = await st(p)
    await openViewer(o, w)
    let s = await st(p)
    if (on) is(Math.abs(s.title.x - sB.title.x) < 0.5 && Math.abs(s.title.r - sB.title.r) < 0.5 && Math.abs(s.title.y - sB.title.y) < 0.5, `${lab}: the page behind the open viewer has not moved (the product title's box)`, JSON.stringify([sB.title, s.title]))
    if (on) {
      is(s.open && s.role === 'dialog' && s.modal === 'true' && s.label === ALT[lang], `${lab}: the viewer opens as a labelled modal dialog`)
      is(o.reqs.some((u) => u === '/images/products/denver-nuggets-cap-navy.jpg'), `${lab}: opening it downloads the full-size original`)
      is(rtl ? /[؀-ۿ]/.test(s.hint) && !/zoom/i.test(s.hint) : /zoom/i.test(s.hint) && /Escape/.test(s.hint), `${lab}: the dialog is described in the page's language`, s.hint.slice(0, 50))
      is(!s.hintVisible, `${lab}: the description is for screen readers only (not drawn)`)
      is(s.live === 'polite', `${lab}: "image n of N" is announced (polite live region)`)
      is(s.focusIn, `${lab}: focus is inside the viewer`)
      is(s.scrollY === 60, `${lab}: the page did not move`, String(s.scrollY))
    }
    // controls
    const small = s.btns.filter((b) => b.w < 43.5 || b.h < 43.5 || b.x < 0 || b.r > s.vw + 0.5 || b.y < 0 || b.b > s.vh + 0.5)
    if (on) {
      is(s.btns.length === 4 && !small.length, `${lab}: close, zoom, previous, next: every control 44px and on screen`, `${s.btns.length} ${JSON.stringify(small)}`)
      is(s.prev && s.next && s.prev.label === (rtl ? 'الصورة السابقة' : 'Previous photo') && s.next.label === (rtl ? 'الصورة التالية' : 'Next photo'), `${lab}: previous / next are labelled in the page's language`)
      is(s.prev && (rtl ? s.prev.x > s.next.x : s.prev.x < s.next.x), `${lab}: previous on the reading direction's start side, next on the end side`)
      is(s.prev && (rtl ? /chevron-right/.test(s.prev.mask) && /chevron-left/.test(s.next.mask) : /chevron-left/.test(s.prev.mask) && /chevron-right/.test(s.next.mask)), `${lab}: the glyphs point the way they go (the set's chevrons)`)
      is(s.zoom && s.zoom.color === 'rgb(255, 255, 255)' && s.zoom.label === (rtl ? 'تكبير' : 'Zoom in') && s.zoom.pressed === 'false', `${lab}: the zoom button: white on the dark backdrop (both themes), labelled, not pressed`)
    } else M.size.push(s.btns.length === 4 && !small.length)
    if (!on) M.desc.push(!!s.hint)
    // focus trap (the build's): Tab never leaves
    let inside = true
    for (let k = 0; k < 6; k++) { await p.keyboard.press('Tab'); inside = inside && await p.evaluate(() => document.querySelector('.catalog-product-lightbox').contains(document.activeElement)) }
    if (on) is(inside, `${lab}: Tab stays inside the viewer`)
    // previous / next
    if (on) {
      await p.click('.sporta-viewer-next'); await settle(p, 150); s = await st(p)
      is(/view-2/.test(s.src) && s.count.includes('2') && s.open, `${lab}: "next" shows photo 2 and keeps the viewer open`, s.src + ' ' + s.count)
      await p.click('.sporta-viewer-prev'); await settle(p, 150); s = await st(p)
      is(s.src === '/images/products/denver-nuggets-cap-navy.jpg' && s.open, `${lab}: "previous" goes back to photo 1`, s.src)
    } else M.nav.push(!!s.next)
    // arrow keys in the reading direction
    await p.evaluate(() => document.querySelector('.catalog-product-lightbox > button').focus())
    await p.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight'); await settle(p, 120); s = await st(p)
    const keyOk = /view-2/.test(s.src)
    await p.keyboard.press(rtl ? 'ArrowRight' : 'ArrowLeft'); await settle(p, 120); s = await st(p)
    const keyBack = s.src === '/images/products/denver-nuggets-cap-navy.jpg'
    if (on) is(keyOk && keyBack, `${lab}: the ${rtl ? 'left' : 'right'} arrow key is "next", the other "previous"`)
    else if (rtl) M.rtlKey.push(keyOk && keyBack)
    // the photo is loaded before the gestures (the spinner is gone)
    await p.waitForFunction(() => { const i = document.querySelector('.catalog-product-lightbox > img'); return i && i.complete }, null, { timeout: 4000 }).catch(() => {})
    s = await st(p)
    if (on) is(!s.loading, `${lab}: the spinner goes once the full-size photo has loaded`)
    let c = await center(p)
    if (touch) {
      // swipe: the finger to the left is "next" in English, "previous" in Arabic (the stage's own rule)
      await swipe(cdp, [c.x + 120, c.y], [c.x - 120, c.y]); await settle(p, 200); s = await st(p)
      const sw = rtl ? /view-4/.test(s.src) : /view-2/.test(s.src)
      if (on) is(sw && s.open, `${lab}: a swipe to the left shows the ${rtl ? 'previous' : 'next'} photo`, s.src)
      else M.swipe.push(sw)
      await swipe(cdp, [c.x - 120, c.y], [c.x + 120, c.y]); await settle(p, 200); s = await st(p)
      if (on) is(s.src === '/images/products/denver-nuggets-cap-navy.jpg', `${lab}: a swipe back returns to photo 1`, s.src)
      c = await center(p)
      // double-tap zooms at the finger, again unzooms
      await dtap(cdp, c.x - 40, c.y - 40); await settle(p); s = await st(p)
      const dz = s.scale > 2.2
      if (on) is(dz && s.open, `${lab}: double-tap zooms in (x${s.scale.toFixed(2)})`)
      else M.dbl.push(dz)
      if (on) {
        // a zoomed photo pans with a finger and the drag does not change the photo
        const before = s
        await swipe(cdp, [c.x, c.y], [c.x + 90, c.y + 60]); await settle(p, 150); s = await st(p)
        is(s.src === before.src && Math.abs(s.tx - before.tx) > 30 && s.scale > 2.2 && s.open, `${lab}: a zoomed photo pans (translate ${before.tx.toFixed(0)} -> ${s.tx.toFixed(0)}) and stays the same photo`)
        const img = await center(p)
        is(s.tx <= (img.w * s.scale) / 2 + 1, `${lab}: panning stops at the photo's edge`)
        await dtap(cdp, c.x, c.y); await settle(p); s = await st(p)
        is(Math.abs(s.scale - 1) < 0.01 && Math.abs(s.tx) < 0.5, `${lab}: double-tap again returns to the whole photo`, `x${s.scale}`)
      }
      // pinch
      await pinch(cdp, c, 30, 130); await settle(p, 150); s = await st(p)
      const pz = s.scale > 1.6
      if (on) is(pz && s.scale <= 4.001 && s.open, `${lab}: pinch zooms (x${s.scale.toFixed(2)}, at most x4)`)
      else M.pinch.push(pz)
      if (on) { await pinch(cdp, c, 130, 20); await settle(p); s = await st(p); is(Math.abs(s.scale - 1) < 0.01, `${lab}: pinching in returns to the whole photo (never smaller)`, `x${s.scale}`) }
      // the page does not scroll through the viewer
      await swipe(cdp, [c.x, c.y + 150], [c.x, c.y - 150]); await settle(p, 200); s = await st(p)
      if (on) is(s.scrollY === 60 && s.open, `${lab}: a vertical swipe on the viewer does not scroll the page`, String(s.scrollY))
      // swipe down closes, focus back on the stage
      if (on) {
        c = await center(p)
        await swipe(cdp, [c.x, c.y - 60], [c.x, c.y + 200]); await settle(p, 250); s = await st(p)
        is(!s.open && s.focusStage, `${lab}: swipe down closes the viewer and gives focus back to the stage`, `open ${s.open} stage ${s.focusStage}`)
        await openViewer(o, w)
        if (process.env.DEBUG) console.log('reopen', JSON.stringify((({ open, src, scrollY, stage }) => ({ open, src, scrollY, stage }))(await st(p))))
      }
    } else {
      // mouse: double-click zooms at the pointer, wheel zooms, drag pans, keys, the zoom button
      await p.mouse.dblclick(c.x - 60, c.y - 60); await settle(p); s = await st(p)
      const dz = s.scale > 2.2
      if (on) is(dz && s.open, `${lab}: double-click zooms in (x${s.scale.toFixed(2)})`)
      else M.dbl.push(dz)
      if (on) {
        const before = s
        await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x + 100, c.y + 80, { steps: 6 }); await p.mouse.up(); await settle(p, 150); s = await st(p)
        is(s.src === before.src && Math.abs(s.tx - before.tx) > 30 && s.open, `${lab}: a zoomed photo pans with the mouse and stays the same photo`)
        await p.keyboard.press('0'); await settle(p); s = await st(p)
        is(Math.abs(s.scale - 1) < 0.01, `${lab}: 0 returns to the whole photo`)
        await p.keyboard.press('+'); await settle(p); s = await st(p)
        is(s.scale > 1.4, `${lab}: + zooms in`)
        await p.keyboard.press('-'); await settle(p); s = await st(p)
        is(Math.abs(s.scale - 1) < 0.01, `${lab}: - zooms out`)
        await p.click('.sporta-viewer-zoom'); await settle(p); s = await st(p)
        is(s.scale > 2.2 && s.zoom.pressed === 'true' && s.zoom.label === (rtl ? 'تصغير' : 'Zoom out') && s.open, `${lab}: the zoom button zooms and says "zoom out", pressed`)
        await p.click('.sporta-viewer-zoom'); await settle(p); s = await st(p)
        is(Math.abs(s.scale - 1) < 0.01 && s.zoom.pressed === 'false', `${lab}: and back`)
        await p.mouse.move(c.x, c.y); await p.mouse.wheel(0, -300); await settle(p, 200); s = await st(p)
        is(s.scale > 1.3 && s.scrollY === 60, `${lab}: the wheel zooms the photo, not the page (x${s.scale.toFixed(2)})`, String(s.scrollY))
        await p.keyboard.press('0'); await settle(p)
        await p.mouse.move(20, c.y); await p.mouse.wheel(0, 400); await settle(p, 200); s = await st(p)
        is(s.scrollY === 60, `${lab}: the wheel on the backdrop does not scroll the page`, String(s.scrollY))
      }
      // a drag from the photo that ends on the backdrop does not close
      c = await center(p)
      await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(8, 8, { steps: 6 }); await p.mouse.up(); await settle(p, 150); s = await st(p)
      if (on) is(s.open, `${lab}: a drag that ends on the backdrop does not close the viewer`)
      if (!s.open) await openViewer(o, w)
    }
    if (on) {
      // the photo that fails in the viewer (the build swaps in the plate): no zoom
      await p.click('.sporta-viewer-next'); await p.click('.sporta-viewer-next'); await settle(p, 400); s = await st(p)
      is(/unavailable/.test(s.src) && s.plate && !s.zoom.shown, `${lab}: a full-size photo that fails shows the plate, which has no zoom button`, s.src)
      c = await center(p)
      if (touch) await dtap(cdp, c.x, c.y); else await p.mouse.dblclick(c.x, c.y)
      await settle(p); s = await st(p)
      is(Math.abs(s.scale - 1) < 0.01 && s.open, `${lab}: and the plate cannot be zoomed`)
      // the photo backdrop block paints the gallery, never the viewer
      is(!s.tagged, `${lab}: the viewer's photo is never painted by the photo backdrop block`)
      // Escape closes; the X closes; focus returns
      await p.keyboard.press('Escape'); await settle(p, 200); s = await st(p)
      is(!s.open && s.focusStage, `${lab}: Escape closes and focus returns to the stage`)
      is(s.galleryTagged, `${lab}: the photo backdrop block still paints the gallery's photos`)
      await openViewer(o, w)
      await p.click('.catalog-product-lightbox > button:not(.sporta-viewer-btn)'); await settle(p, 200); s = await st(p)
      is(!s.open, `${lab}: the X closes`)
      is(s.cls < 0.001, `${lab}: nothing shifted the whole time (layout shift ${s.cls.toFixed(4)})`)
      is(await p.evaluate(() => !document.documentElement.hasAttribute('data-sporta-viewer-lock')), `${lab}: the page lock is released on close`)
    }
    await o.ctx.close()

    // ---------- the "no photo" plate
    const q = await open('plate', lang, w, { mode, dark })
    let t = await st(q.p)
    if (on) is(t.stage.noview && t.stage.dis === 'true' && t.stage.pop === null && t.stage.cursor !== 'zoom-in' && t.stage.badge === 'hidden', `${lab}: the plate's stage is marked unavailable: no dialog promise, no zoom cursor, no zoom badge`, JSON.stringify(t.stage))
    await openViewer(q, w, false)
    t = await st(q.p)
    if (!t.open) { await q.p.focus('.catalog-gallery-stage'); await q.p.keyboard.press('Enter'); await settle(q.p, 200); t = await st(q.p) }
    if (on) is(!t.open, `${lab}: tapping, clicking or Enter on the plate opens nothing`)
    else M.plate.push(!t.open)
    if (on && !touch) {
      const box = t.stage
      await q.p.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.3); await settle(q.p, 150)
      const lens = await q.p.evaluate(() => getComputedStyle(document.querySelector('.catalog-gallery-photo')).transform)
      is(lens === 'none' || /matrix\(1, 0, 0, 1/.test(lens), `${lab}: and the hover lens does not magnify the plate`, lens)
    }
    await q.ctx.close()

    // ---------- one photo: the viewer has no previous / next, zoom still works
    if (on) {
      const r = await open('single', lang, w, { mode, dark })
      await openViewer(r, w)
      let u = await st(r.p)
      is(u.open && !u.prev && !u.next && u.btns.length === 2, `${lab}: one photo: close and zoom only`, `${u.btns.length}`)
      await r.p.keyboard.press('+'); await settle(r.p); u = await st(r.p)
      is(u.scale > 1.4, `${lab}: one photo: + zooms`)
      await r.ctx.close()
    }
  }
}

// ---- the page behind does not move sideways (a classic scrollbar: desktop Windows / Linux) ----------------------------------------
head('scrollbar')
{
  const sb = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', ignoreDefaultArgs: ['--hide-scrollbars'] })
  const res = {}
  for (const mode of ['on', 'js-off', 'css-off']) for (const lang of ['ar', 'en']) {
    const o = await open('multi', lang, 1280, { mode, br: sb })
    const edges = () => o.p.evaluate(() => { const r = document.querySelector('.catalog-product-title').getBoundingClientRect(); return [innerWidth - document.documentElement.clientWidth, r.left, r.right] })
    const x0 = await edges()
    await o.p.click('.catalog-gallery-stage'); await settle(o.p, 250)
    const x1 = await edges()
    await o.p.keyboard.press('Escape'); await settle(o.p, 200)
    const x2 = await edges()
    const dd = (a) => Math.max(Math.abs(a[1] - x0[1]), Math.abs(a[2] - x0[2]))
    res[mode + lang] = { bar: x0[0], d: dd(x1), back: dd(x2) }
    await o.ctx.close()
  }
  for (const lang of ['ar', 'en']) {
    const r = res['on' + lang]
    is(r.bar > 0 && r.d < 0.5 && r.back < 0.5, `${lang} 1280px: with a scrollbar the page behind the viewer does not move sideways (opening or closing)`, JSON.stringify(r))
    is(res['js-off' + lang].d > 2, `${lang} 1280px: the live build alone moves it (by the scrollbar's width)`, JSON.stringify(res['js-off' + lang]))
    is(res['css-off' + lang].d > 2, `${lang} 1280px: mutation, the CSS section removed: it moves again`, JSON.stringify(res['css-off' + lang]))
  }
  await sb.close()
}

// ---- mutations --------------------------------------------------------------------------------------------------------------
head('mutations')
const any = (a) => a.length > 0 && a.some(Boolean)
const all = (a) => a.length > 0 && a.every(Boolean)
const J = mut['js-off'], C = mut['css-off']
console.log(JSON.stringify(mut))
is(J.nav.length > 0 && !any(J.nav), 'mutation, the block not run: the viewer has no previous / next (the live look)')
is(J.rtlKey.length > 0 && !any(J.rtlKey), 'mutation, the block not run: the Arabic arrow keys go the wrong way in the viewer (the live bug)')
is(J.swipe.length > 0 && !any(J.swipe), 'mutation, the block not run: a swipe does not change the photo')
is(J.pinch.length > 0 && !any(J.pinch), 'mutation, the block not run: pinch does not zoom the photo')
is(J.dbl.length > 0 && !any(J.dbl), 'mutation, the block not run: double-tap / double-click do not zoom')
is(J.plate.length > 0 && !any(J.plate), 'mutation, the block not run: the plate opens a viewer (the live behaviour)')
is(J.desc.length > 0 && !any(J.desc), 'mutation, the block not run: the dialog has no description')
is(C.size.length > 0 && !any(C.size), 'mutation, the section removed: the added controls are not 44px / not placed')

await browser.close(); srv.server.close()
console.log(`\n${pass} passed, ${fail} failed`)
if (fails.length) { console.log('\nFAILED:'); for (const f of fails) console.log('  ' + f) }
process.exit(fail ? 1 : 0)
