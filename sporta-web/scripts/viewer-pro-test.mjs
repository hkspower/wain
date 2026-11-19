// npm run test:viewer-pro - PRO-1119 of the IMAGE VIEWER block of public/sporta-features.js + VIEWER PRO 1119 in public/sporta-shadows.css
// (owner, 2026-11-19: "make zoom full image view pro"), on the LIVE product gallery (the same harness as test:images-viewer: the
// compiled build's gallery and lightbox, run with React 19 inside the captured live product page, under every add-on stylesheet).
//
// What is proven (four photos, then one photo, then nine; Arabic and English; a phone, a desktop and a phone on its side):
//   [vp-1] the opening: the viewer fades in (a CSS animation), none with reduced motion
//   [vp-2] the FILMSTRIP: one 56px thumbnail per photo, labelled "Image n of N" in the page's language, the current one ringed in the
//          logo orange (#FF7B17) and aria-current, in reading order (Arabic: the first at the right), all on screen and under the photo;
//          the counter is in the top room, level with the buttons; the photo stays centred in the box; none for a single photo
//   [vp-3] a tap on a thumbnail shows that photo (through the page's own thumbnail button: the page and the viewer agree), the zoom
//          is reset, Home / End go to the first / last photo, the arrow keys still step one photo when the photo is whole
//   [vp-4] zoomed in, the strip fades away and leaves the tab order, and is back after 0 (reset)
//   [vp-5] zoomed in, the arrow keys MOVE the photo (80px, Shift 240, clamped at the edge) and never change the photo
//   [vp-6] the stand-in: while the original downloads the small copy the page already shows is painted behind the spinner (pixels
//          read from a screenshot: the photo's own backdrop colour, not the black), and it is gone when the original arrived;
//          the stand-in is a URL the page had already requested
//   [vp-7] the fling: a fast pan release glides on and then stops inside the edges; a touch on the gliding photo catches it; none
//          with reduced motion
//   [vp-8] a trackpad pinch (ctrl + wheel) zooms in fine steps (and the page does not zoom); a plain wheel is unchanged
//   [vp-9] the zoom still keeps the point under the cursor still (the strip's room is symmetric); many photos: the strip scrolls and
//          keeps the current thumbnail in view
//   MUTATIONS (each must FAIL the matching check): the strip not built, the fling cut, the keyboard pan cut, the placeholder cut,
//   the pinch factor cut, and the whole CSS section removed.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as G from './lib/gallery-page.mjs'
import * as PRD from './lib/sizes-product-page.mjs'

const ROOT = G.ROOT
const JS_ALL = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const A = JS_ALL.indexOf('/* ===== IMAGE VIEWER (2026'), Z = JS_ALL.indexOf('/* ===== IMAGE VIEWER - end')
const JS = JS_ALL.slice(A, Z)
const BACKDROP = JS_ALL.slice(JS_ALL.indexOf('/* ===== PHOTO BACKDROP (2026'), JS_ALL.indexOf('/* ===== PHOTO BACKDROP - end'))
const SH = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')
const S0 = SH.indexOf('/* ==== VIEWER PRO 1119'), S1 = SH.indexOf('/* ==== end VIEWER PRO 1119 */')
const SECTION = SH.slice(S0, S1 + '/* ==== end VIEWER PRO 1119 */'.length)
const SH_OFF = SH.replace(SECTION, '')

let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++ } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ---- static -----------------------------------------------------------------------------------------------------------
head('static')
is(A > 0 && Z > A && /PRO-1119/.test(JS), 'the IMAGE VIEWER block carries PRO-1119')
is(!/innerHTML|outerHTML|insertAdjacentHTML|\.src\s*=|setAttribute\('src'|fetch\(|XMLHttpRequest|new Image|localStorage|sessionStorage/.test(JS), 'the block still never writes markup or a src, makes a request or stores anything')
is(S0 > 0 && S1 > S0 && S0 > SH.indexOf('/* ==== end VIEWER-1112 */') && S0 < SH.indexOf('/* ==== ICON SET'), 'VIEWER PRO 1119 is one section of sporta-shadows.css, after VIEWER-1112 and before ICON SET')
is(!/https?:\/\//.test(SECTION), 'no external URL in the section')
{
  const rules = SECTION.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => r.includes('{') && !/^@keyframes|^(from|to)\s*\{/.test(r) && !/^\s*(from|to)\s*\{/.test(r))
  const keyed = (r) => /data-sporta-|sporta-viewer-|@media|@keyframes/.test(r.split('{')[0])
  is(rules.length > 10 && rules.filter((r) => !r.startsWith('@media') && !keyed(r)).length === 0, 'every rule of the section is keyed on something only the viewer block writes', rules.filter((r) => !r.startsWith('@media') && !keyed(r)).slice(0, 2).join(' | '))
}
is(/#ff7b17/i.test(SECTION) && !/#(e11d48|be123c|e70044|dc2626|ef4444)|rgb\(2[0-9]{2}, ?[0-4][0-9]?, ?[0-9]{1,2}\)/i.test(SECTION), 'the current thumbnail is ringed in the logo orange and the section has no red')

// ---- stand-in photographs -----------------------------------------------------------------------------------------------
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const browser = await chromium.launch({ executablePath: CHROME })
const PHOTOS = []
{
  const p = await browser.newPage()
  for (const garment of ['rgb(28,36,64)', 'rgb(120,30,40)', 'rgb(40,90,50)', 'rgb(90,70,30)']) {
    PHOTOS.push(Buffer.from(await p.evaluate((garment) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 900
      const x = c.getContext('2d')
      x.fillStyle = 'rgb(195,192,184)'; x.fillRect(0, 0, 900, 900)
      x.fillStyle = garment; x.fillRect(250, 200, 400, 520)
      x.fillStyle = '#fff'; x.fillRect(300, 260, 60, 60)
      return c.toDataURL('image/jpeg', 0.92).split(',')[1]
    }, garment), 'base64'))
  }
  await p.close()
}
const photoFor = (path) => { const m = path.match(/view-(\d+)/); return PHOTOS[((m ? +m[1] : 1) - 1) % 4] }
const NINE = Array.from({ length: 9 }, (_, i) => `/images/products/denver-nuggets-cap-navy${i ? '-view-' + (i + 1) : ''}.jpg`)
const ref = { current: null }
const srv = await G.serve(ref)
const ALT = { en: 'Denver Nuggets Cap — Navy', ar: 'قبعة دنفر ناغتس — كحلي' }
const DEV = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  844: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1280: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
}
const isOriginal = (u) => /\/images\/products\/(?!responsive\/)[^/]+\.(jpg|png)$/.test(u)

// js: the block's source (mutants change it); css: the shadows sheet; delay: ms an original takes; images: the photo list
async function open(lang, w, { set = 'multi', js = JS, css = SH, delay = 0, images = null, reduced = false } = {}) {
  const ctx = await browser.newContext({ ...DEV[w], reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const p = await ctx.newPage()
  const reqs = []
  await p.route('**/images/products/**', async (r) => {
    const u = new URL(r.request().url()).pathname
    reqs.push(u)
    if (delay && isOriginal(u)) await new Promise((res) => setTimeout(res, delay))
    return r.fulfill({ status: 200, contentType: 'image/jpeg', body: photoFor(u) })
  })
  await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: readFileSync(join(ROOT, 'public/product-photo-unavailable.svg')) }))
  ref.current = { addons: { ...PRD.addonFiles(), 'sporta-shadows.css': css }, extra: G.extraCss() }
  await p.goto(`${srv.base}/__gx/${G.SETS[set].fx}-${lang}-${w === 844 ? 390 : w}`)
  await p.addScriptTag({ content: BACKDROP }); await p.addScriptTag({ content: js })
  await p.evaluate(([imgs, alt, lang]) => window.__fxMount({ images: imgs, alt, lang }), [images || G.SETS[set].images, ALT[lang], lang])
  await p.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 3000)), Promise.all([...document.querySelectorAll('.catalog-gallery img')].map((i) => i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r) })))]))
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(250)
  const cdp = DEV[w].hasTouch ? await ctx.newCDPSession(p) : null
  return { p, ctx, reqs, cdp }
}
const openViewer = async (o, w) => {
  for (let k = 0; k < 3; k++) {
    if (DEV[w].hasTouch) await o.p.tap('.catalog-gallery-stage', { force: true }); else await o.p.click('.catalog-gallery-stage', { force: true })
    if (await o.p.waitForSelector('.catalog-product-lightbox', { timeout: 1500 }).then(() => true, () => false)) break
  }
  await o.p.waitForTimeout(450)   // the 160-200 ms fade is over
}
const settle = (p, ms = 320) => p.waitForTimeout(ms)

// in-page state of the viewer
const STATE = () => {
  const b = document.querySelector('.catalog-product-lightbox')
  if (!b) return { open: false }
  const img = b.querySelector(':scope > img')
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } }
  const m = img ? getComputedStyle(img).transform : 'none'
  const mm = m && m !== 'none' ? m.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0]
  const strip = b.querySelector('.sporta-viewer-strip'), cnt = b.querySelector(':scope > p:not(.sporta-viewer-hint)'), bar = b.querySelector('.sporta-viewer-zoombar')
  const thumbs = strip ? [...strip.querySelectorAll('.sporta-viewer-thumb')] : []
  const pageThumbs = [...document.querySelectorAll('.catalog-gallery-thumbs > button')]
  const x = b.querySelector(':scope > button:not(.sporta-viewer-btn)')
  const cs = (e, k) => (e ? getComputedStyle(e)[k] : null)
  return {
    open: true, vw: innerWidth, vh: innerHeight, src: img ? img.getAttribute('src') : null, scale: mm[0], tx: mm[4], ty: mm[5],
    img: img ? { ...R(img), cx: R(img).x + R(img).w / 2, cy: R(img).y + R(img).h / 2 } : null,
    box: { padTop: parseFloat(cs(b, 'paddingTop')), padBottom: parseFloat(cs(b, 'paddingBottom')), anim: cs(b, 'animationName'), imgAnim: cs(img, 'animationName'), strip: b.hasAttribute('data-sporta-strip'), loading: b.hasAttribute('data-sporta-loading'), zoomed: b.hasAttribute('data-sporta-zoomed'), ph: b.style.getPropertyValue('--sporta-viewer-ph') },
    count: cnt ? cnt.textContent : '', cnt: cnt ? R(cnt) : null, cntTop: cnt ? cs(cnt, 'top') : null,
    close: x ? R(x) : null,
    strip: strip ? { ...R(strip), pos: cs(strip, 'position'), vis: cs(strip, 'visibility'), op: parseFloat(cs(strip, 'opacity')), label: strip.getAttribute('aria-label'), role: strip.getAttribute('role'), scrollW: strip.scrollWidth, clientW: strip.clientWidth, scrollLeft: strip.scrollLeft } : null,
    thumbs: thumbs.map((t) => ({ ...R(t), label: t.getAttribute('aria-label'), cur: t.getAttribute('aria-current'), outline: cs(t, 'outlineColor'), outW: cs(t, 'outlineWidth'), img: !!t.querySelector('img'), loading: t.querySelector('img') ? t.querySelector('img').getAttribute('loading') : null })),
    pageCur: pageThumbs.findIndex((t) => t.getAttribute('aria-current') === 'true'),
    bar: bar ? { ...R(bar), vis: cs(bar, 'display') } : null,
    hint: (() => { const h = document.getElementById(b.getAttribute('aria-describedby') || ''); return h ? h.textContent : '' })(),
    activeInStrip: !!(strip && strip.contains(document.activeElement)),
    over: document.documentElement.scrollWidth - innerWidth,
  }
}
const st = (p) => p.evaluate(STATE)
const near = (a, b, t = 2) => Math.abs(a - b) <= t
const TXT = { en: (n, t) => `Image ${n} of ${t}`, ar: (n, t) => `صورة ${n} من ${t}` }
const key = (p, k) => p.keyboard.press(k)

// touch helpers (the DevTools protocol; Playwright has tap only)
const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })) })
async function swipe(cdp, from, to, steps = 8, ms = 100, hold = false) {
  await T(cdp, 'touchStart', [from])
  for (let i = 1; i <= steps; i++) { await T(cdp, 'touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await new Promise((r) => setTimeout(r, ms / steps)) }
  if (!hold) await T(cdp, 'touchEnd', [])
}

// ---- per page ---------------------------------------------------------------------------------------------------------------
const FILM = {}   // what each page measured, for the mutants
for (const lang of ['en', 'ar']) for (const w of [390, 1280]) {
  const tag = `${lang} ${w}px`
  const touch = !!DEV[w].hasTouch, rtl = lang === 'ar'
  head(tag)
  const o = await open(lang, w)
  const { p, cdp } = o
  const before = await st(p)
  is(!before.open, `${tag}: the viewer is not open before it is asked for`)
  await openViewer(o, w)
  const s = await st(p)
  is(s.open && s.box.strip, `${tag}: four photos: the viewer has a filmstrip`)
  // [vp-1]
  is(/sporta-viewer-fade/.test(s.box.anim), `${tag}: the viewer's opening is a CSS fade (animation name ${s.box.anim})`)
  {
    // a fresh open, read in the first frames: the animation is running
    await p.keyboard.press('Escape'); await settle(p, 250)
    const first = await p.evaluate(async () => {
      const stage = document.querySelector('.catalog-gallery-stage'); stage.click()
      await new Promise((r) => requestAnimationFrame(r))
      const b = document.querySelector('.catalog-product-lightbox')
      return b ? { name: getComputedStyle(b).animationName, op: parseFloat(getComputedStyle(b).opacity), imgName: getComputedStyle(b.querySelector(':scope > img')).animationName } : null
    })
    is(first && /sporta-viewer-fade/.test(first.name) && /sporta-viewer-settle/.test(first.imgName), `${tag}: the fade and the settle run as the viewer opens`, JSON.stringify(first))
    await settle(p, 450)
  }
  const s1 = await st(p)
  // [vp-2]
  is(s1.strip && s1.strip.role === 'group' && s1.strip.label === (rtl ? 'الصور' : 'Photos'), `${tag}: the strip is a labelled group in the page's language`, JSON.stringify(s1.strip && s1.strip.label))
  is(s1.thumbs.length === 4 && s1.thumbs.every((t, i) => t.label === TXT[lang](i + 1, 4)), `${tag}: one thumbnail per photo, each labelled "${TXT[lang](1, 4)}"...`, JSON.stringify(s1.thumbs.map((t) => t.label)))
  is(s1.thumbs.every((t) => t.w >= 44 && t.h >= 44 && near(t.w, 56, 1) && t.img && t.loading === 'eager'), `${tag}: every thumbnail is 56px (44px floor) and carries its small photo`, JSON.stringify(s1.thumbs.map((t) => [t.w, t.h, t.loading])))
  is(s1.thumbs.every((t) => t.x >= 0 && t.r <= s1.vw && t.y >= 0 && t.b <= s1.vh), `${tag}: every thumbnail is on screen`)
  is(s1.thumbs[0].cur === 'true' && s1.thumbs.slice(1).every((t) => t.cur === 'false'), `${tag}: the first photo's thumbnail is the current one`)
  is(/255, ?123, ?23/.test(s1.thumbs[0].outline) && s1.thumbs[0].outW === '2px' && !/255, ?123, ?23/.test(s1.thumbs[1].outline + (s1.thumbs[1].outW === '0px' ? '' : 'x')), `${tag}: the current thumbnail is ringed in the logo orange, the others are not`, s1.thumbs[0].outline + ' ' + s1.thumbs[0].outW)
  const order = s1.thumbs.map((t) => t.x)
  is(rtl ? order.every((x, i) => i === 0 || x < order[i - 1]) : order.every((x, i) => i === 0 || x > order[i - 1]), `${tag}: the thumbnails follow the reading direction`, order.join())
  is(s1.strip.pos === 'absolute' && s1.img.b <= s1.strip.y + 1, `${tag}: the strip is under the photo (photo bottom ${Math.round(s1.img.b)} <= strip top ${Math.round(s1.strip.y)})`)
  is(near(s1.strip.x + s1.strip.w / 2, s1.vw / 2, 1.5) && s1.strip.b <= s1.vh, `${tag}: the strip is centred and inside the screen`)
  is(near(s1.img.cx, s1.vw / 2, 1.5) && near(s1.img.cy, s1.vh / 2, 1.5), `${tag}: the photo is centred in the screen (symmetric room)`, `${s1.img.cx},${s1.img.cy} in ${s1.vw}x${s1.vh}`)
  is(s1.cnt && s1.cnt.b <= s1.img.y + 1 && near(s1.cnt.y + s1.cnt.h / 2, s1.close.y + s1.close.h / 2, 3), `${tag}: the counter is in the top room, level with the close button`, JSON.stringify([s1.cnt, s1.close]))
  is(s1.count === TXT[lang](1, 4), `${tag}: the counter reads "${TXT[lang](1, 4)}"`, s1.count)
  is(s1.over <= 0, `${tag}: no sideways scroll`)
  is(/Home/.test(s1.hint) && /(arrow|الأسهم)/i.test(s1.hint), `${tag}: the description screen readers hear mentions the arrow keys and Home / End`)
  FILM[tag] = s1

  // [vp-3] a tap on a thumbnail
  await p.click('.sporta-viewer-thumb:nth-child(3)', { force: true }); await settle(p, 350)
  let s2 = await st(p)
  is(s2.open && /view-3/.test(s2.src) && s2.pageCur === 2, `${tag}: a tap on the third thumbnail shows the third photo, and the page's own gallery agrees`, `${s2.src} cur ${s2.pageCur}`)
  is(s2.thumbs[2].cur === 'true' && s2.thumbs[0].cur === 'false' && s2.count === TXT[lang](3, 4), `${tag}: the ring and the counter follow (${s2.count})`)
  is(s2.scale === 1 && s2.open, `${tag}: the viewer stays open and the photo is whole`)
  await key(p, 'End'); await settle(p, 350)
  s2 = await st(p); is(/view-4/.test(s2.src) && s2.pageCur === 3, `${tag}: End goes to the last photo`, s2.src)
  await key(p, 'Home'); await settle(p, 350)
  s2 = await st(p); is(!/view-/.test(s2.src) && s2.pageCur === 0, `${tag}: Home goes to the first photo`, s2.src)
  await key(p, 'Home'); await settle(p, 200)
  s2 = await st(p); is(s2.open && s2.pageCur === 0, `${tag}: Home on the first photo changes nothing`)
  await key(p, rtl ? 'ArrowLeft' : 'ArrowRight'); await settle(p, 350)
  s2 = await st(p); is(s2.pageCur === 1, `${tag}: the arrow key still steps one photo when the photo is whole`, String(s2.pageCur))
  await key(p, 'Home'); await settle(p, 300)

  // [vp-4] zoomed: the strip fades away, back after reset
  await key(p, '+'); await key(p, '+'); await settle(p, 450)
  const z = await st(p)
  is(z.scale > 1.5 && z.box.zoomed, `${tag}: + + zooms in (x${z.scale.toFixed(2)})`)
  is(z.strip.vis === 'hidden' && z.strip.op < 0.05, `${tag}: zoomed in, the strip is gone (visibility ${z.strip.vis}, opacity ${z.strip.op})`)
  is(z.bar && z.bar.vis !== 'none' && z.bar.b <= z.vh && z.bar.y > z.img.y, `${tag}: the zoom bar is still on screen, lower down`, JSON.stringify(z.bar))
  // [vp-5] keys move the photo
  const base = { x: z.tx, y: z.ty, count: z.count, src: z.src }
  await key(p, 'ArrowRight'); await settle(p, 300)
  const k1 = await st(p)
  is(k1.src === base.src && k1.count === base.count, `${tag}: zoomed, an arrow key never changes the photo`)
  is(k1.tx < base.x - 20 || near(k1.tx, base.x, 0.5) && z.img.w < z.vw, `${tag}: ArrowRight moves the zoomed photo toward the start (${base.x.toFixed(0)} -> ${k1.tx.toFixed(0)})`)
  await key(p, 'ArrowLeft'); await key(p, 'ArrowLeft'); await settle(p, 300)
  const k2 = await st(p)
  is(k2.tx > k1.tx + 20, `${tag}: ArrowLeft moves it back (${k1.tx.toFixed(0)} -> ${k2.tx.toFixed(0)})`)
  await key(p, 'Shift+ArrowRight'); await settle(p, 300)
  const k3 = await st(p)
  is(k3.tx < k2.tx - 100 || k3.img.r <= k3.vw + 1, `${tag}: Shift + ArrowRight moves it further (or it is at the edge)`, `${k2.tx.toFixed(0)} -> ${k3.tx.toFixed(0)}`)
  await key(p, 'ArrowDown'); await key(p, 'ArrowDown'); await settle(p, 300)
  const k4 = await st(p)
  is(k4.ty <= k3.ty + 0.5, `${tag}: ArrowDown never moves the photo the wrong way (${k3.ty.toFixed(0)} -> ${k4.ty.toFixed(0)})`)
  is((k4.img.w <= k4.vw || (k4.img.x <= 1 && k4.img.r >= k4.vw - 1)) && (k4.img.h <= k4.vh || (k4.img.y <= 1 && k4.img.b >= k4.vh - 1)), `${tag}: the zoomed photo never leaves the screen: where it is larger than the screen it still covers it`, JSON.stringify([k4.img.x, k4.img.y, k4.img.r, k4.img.b]))
  await key(p, '0'); await settle(p, 450)
  const rz = await st(p)
  is(rz.scale === 1 && rz.strip.vis === 'visible' && rz.strip.op > 0.95, `${tag}: 0 resets the zoom and the strip is back`, `${rz.scale} ${rz.strip.vis} ${rz.strip.op}`)

  // [vp-8] trackpad pinch
  const pinch = await p.evaluate(() => {
    const img = document.querySelector('.catalog-product-lightbox > img'), r = img.getBoundingClientRect()
    const fire = (ctrl, n, dy) => { let prevented = 0; for (let i = 0; i < n; i++) { const e = new WheelEvent('wheel', { deltaY: dy, ctrlKey: ctrl, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }); img.dispatchEvent(e); if (e.defaultPrevented) prevented++ } return prevented }
    const scale = () => { const m = getComputedStyle(img).transform; return m && m !== 'none' ? +m.match(/matrix\(([^)]+)\)/)[1].split(',')[0] : 1 }
    const a = fire(false, 10, -10); const sPlain = scale()
    return { a, sPlain }
  })
  await settle(p, 100)
  await key(p, '0'); await settle(p, 400)
  const pinch2 = await p.evaluate(() => {
    const img = document.querySelector('.catalog-product-lightbox > img'), r = img.getBoundingClientRect()
    let prevented = 0
    for (let i = 0; i < 10; i++) { const e = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }); img.dispatchEvent(e); if (e.defaultPrevented) prevented++ }
    const m = getComputedStyle(img).transform
    return { prevented, s: m && m !== 'none' ? +m.match(/matrix\(([^)]+)\)/)[1].split(',')[0] : 1 }
  })
  is(pinch.a === 10 && pinch.sPlain > 1.15 && pinch.sPlain < 1.45, `${tag}: a plain wheel is unchanged (ten small turns: x${pinch.sPlain.toFixed(2)})`)
  is(pinch2.prevented === 10 && pinch2.s > 2.3 && pinch2.s <= 4, `${tag}: a trackpad pinch (ctrl + wheel) zooms in fine steps and the page does not zoom (ten pinches: x${pinch2.s.toFixed(2)})`)
  await key(p, '0'); await settle(p, 400)

  // [vp-9] the point under the cursor stays under it
  {
    const b = await st(p)
    const px = b.img.x + b.img.w * 0.3, py = b.img.y + b.img.h * 0.5
    const u = (px - b.img.x) / b.img.w, v = (py - b.img.y) / b.img.h
    await p.mouse.move(px, py)
    await p.evaluate(([x, y]) => { const img = document.querySelector('.catalog-product-lightbox > img'); img.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: x, clientY: y, bubbles: true, cancelable: true })) }, [px, py])
    await settle(p, 120)
    const a = await st(p)
    const qx = a.img.x + u * a.img.w, qy = a.img.y + v * a.img.h
    is(a.scale > 1.2 && near(qx, px, 2.5) && near(qy, py, 2.5), `${tag}: a wheel zoom keeps the point under the cursor still (${Math.abs(qx - px).toFixed(1)}, ${Math.abs(qy - py).toFixed(1)} px off)`)
    await key(p, '0'); await settle(p, 400)
  }

  // [vp-7] the fling (mouse on the desktop, a finger on the phone)
  {
    await key(p, '+'); await key(p, '+'); await key(p, '+'); await settle(p, 450)
    const z3 = await st(p)
    const c = { x: z3.vw / 2, y: z3.vh / 2 }
    const sample = async () => (await st(p)).tx
    if (touch) { await swipe(cdp, [c.x - 40, c.y], [c.x + 90, c.y], 6, 70) } else {
      await p.mouse.move(c.x - 40, c.y); await p.mouse.down()
      for (let i = 1; i <= 6; i++) { await p.mouse.move(c.x - 40 + (130 * i) / 6, c.y); await p.waitForTimeout(12) }
      await p.mouse.up()
    }
    const t0 = await sample(); await p.waitForTimeout(120)
    const t1 = await sample(); await p.waitForTimeout(1500)
    const t2 = await sample(); await p.waitForTimeout(400)
    const t3 = await sample()
    const end = await st(p)
    is(Math.abs(t1 - t0) > 6, `${tag}: a fast release glides on (${t0.toFixed(0)} -> ${t1.toFixed(0)} within 120 ms)`)
    is(near(t2, t3, 1), `${tag}: the glide stops (${t2.toFixed(1)} == ${t3.toFixed(1)})`)
    is(end.img.x <= 1 && end.img.r >= end.vw - 1, `${tag}: the glide stops inside the edges: the photo still covers the screen`, JSON.stringify([end.img.x, end.img.r]))
    // a touch on the gliding photo catches it
    await key(p, '0'); await settle(p, 400)
    await key(p, '+'); await key(p, '+'); await key(p, '+'); await settle(p, 450)
    if (touch) { await swipe(cdp, [c.x + 60, c.y], [c.x - 110, c.y], 6, 60) } else {
      await p.mouse.move(c.x + 60, c.y); await p.mouse.down()
      for (let i = 1; i <= 6; i++) { await p.mouse.move(c.x + 60 - (170 * i) / 6, c.y); await p.waitForTimeout(12) }
      await p.mouse.up()
    }
    await p.waitForTimeout(40)
    const ga = await sample(); await p.waitForTimeout(40); const gb = await sample()
    if (touch) { await T(cdp, 'touchStart', [[c.x, c.y]]) } else { await p.mouse.move(c.x, c.y); await p.mouse.down() }
    await p.waitForTimeout(40); const g1 = await sample(); await p.waitForTimeout(200); const g2 = await sample()
    if (touch) { await T(cdp, 'touchEnd', []) } else { await p.mouse.up() }
    is(Math.abs(gb - ga) > 0.5, `${tag}: the photo was gliding before the touch (${ga.toFixed(1)} -> ${gb.toFixed(1)})`)
    is(near(g1, g2, 0.8), `${tag}: a touch on the gliding photo catches it, and it stays caught (${g1.toFixed(1)} == ${g2.toFixed(1)})`)
    await key(p, '0'); await settle(p, 300)
  }
  await o.ctx.close()
}

// ---- reduced motion: no fade, no fling --------------------------------------------------------------------------------------
head('reduced motion')
{
  const o = await open('en', 1280, { reduced: true })
  await openViewer(o, 1280)
  const s = await st(o.p)
  is(s.box.anim === 'none' && s.box.imgAnim === 'none', 'reduced motion: the viewer has no fade and no settle', `${s.box.anim} / ${s.box.imgAnim}`)
  await key(o.p, '+'); await key(o.p, '+'); await key(o.p, '+'); await settle(o.p, 400)
  const c = { x: 640, y: 450 }
  await o.p.mouse.move(c.x - 40, c.y); await o.p.mouse.down()
  for (let i = 1; i <= 6; i++) { await o.p.mouse.move(c.x - 40 + (130 * i) / 6, c.y); await o.p.waitForTimeout(12) }
  await o.p.mouse.up()
  const a = (await st(o.p)).tx; await o.p.waitForTimeout(500); const b = (await st(o.p)).tx
  is(near(a, b, 0.6), `reduced motion: the photo stops where the hand lifted (${a.toFixed(1)} == ${b.toFixed(1)})`)
  await o.ctx.close()
}

// ---- the stand-in while the original downloads ------------------------------------------------------------------------------
head('the stand-in photo')
for (const [lang, w] of [['en', 1280], ['ar', 390]]) {
  const tag = `${lang} ${w}px`
  const o = await open(lang, w, { delay: 1600 })
  const stageReqs = o.reqs.filter((u) => /denver/.test(u)).length
  if (DEV[w].hasTouch) await o.p.tap('.catalog-gallery-stage', { force: true }); else await o.p.click('.catalog-gallery-stage', { force: true })
  await o.p.waitForSelector('.catalog-product-lightbox', { timeout: 3000 })
  await o.p.waitForTimeout(500)
  const s = await st(o.p)
  const ph = s.box.ph
  is(s.box.loading && /^url\("/.test(ph), `${tag}: while the original downloads the viewer holds a stand-in (${ph.slice(0, 70)})`)
  const phPath = (ph.match(/url\("([^"]+)"\)/) || [])[1]
  let phUrlPath = ''
  try { phUrlPath = new URL(phPath, 'http://x').pathname } catch (e) {}
  is(phUrlPath && !isOriginal(phUrlPath) && o.reqs.slice(0, stageReqs).includes(phUrlPath), `${tag}: the stand-in is a copy the page had already requested, not the original`, phUrlPath)
  // pixels: the top-left corner of the photo's frame is the photo's own light backdrop, not the black
  const side = Math.min(s.vw - 32, s.vh - (s.box.strip ? 168 : 32))   // the photo's box: the room the strip keeps top and bottom
  const probeAt = { x: Math.round(s.vw / 2 - 0.4 * side), y: Math.round(s.vh / 2 - 0.4 * side) }   // 10% in from its top corner: the photo's backdrop
  const probe = async () => {
    const q = await o.p.evaluate(() => { const b = document.querySelector('.catalog-product-lightbox'); const cs = getComputedStyle(b, '::before'); return { bg: cs.backgroundImage.slice(0, 40), pos: cs.position } })
    const png = await o.p.screenshot({ clip: { x: probeAt.x - 6, y: probeAt.y - 6, width: 12, height: 12 } })
    const lum = await o.p.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += (d[i] + d[i + 1] + d[i + 2]) / 3; return t / (d.length / 4) }, png.toString('base64'))
    return { ...q, lum }
  }
  const during = await probe()
  is(/url\(/.test(during.bg) && during.lum > 120, `${tag}: the stand-in is painted: the photo's own light backdrop shows, not the black (luminance ${during.lum.toFixed(0)})`, JSON.stringify(during))
  await o.p.waitForTimeout(2200)
  const after = await st(o.p)
  is(!after.box.loading && after.box.ph === '', `${tag}: when the original has arrived the stand-in is gone and the original shows`, JSON.stringify(after.box))
  is((await probe()).lum > 120, `${tag}: the original is on screen (luminance up)`)
  await o.ctx.close()
}

// ---- one photo, a short screen, many photos ----------------------------------------------------------------------------------
head('one photo')
{
  const o = await open('en', 390, { set: 'single' })
  await openViewer(o, 390)
  const s = await st(o.p)
  is(s.open && !s.box.strip && !s.strip && s.box.padTop === 16 && s.box.padBottom === 16, 'one photo: no filmstrip and the room stays as it was (16px)', JSON.stringify([s.box.strip, s.box.padTop, s.box.padBottom]))
  is(s.cnt === null || s.cnt.y > s.img.b - 1, 'one photo: no counter at all, or it stays below the photo as before')
  await key(o.p, 'Home'); await settle(o.p, 200)
  is((await st(o.p)).open, 'one photo: Home does nothing and the viewer stays open')
  await o.ctx.close()
}
head('a phone on its side (844 x 390)')
{
  const o = await open('en', 844)
  await openViewer(o, 844)
  const s = await st(o.p)
  is(s.open && s.box.strip && s.thumbs.length === 4, 'a short screen: the filmstrip is there')
  is(s.box.padTop === 16 && s.thumbs.every((t) => near(t.w, 44, 1) && t.y >= 0 && t.b <= s.vh), 'a short screen: no room is given up (16px) and the thumbnails are 44px, on screen', JSON.stringify([s.box.padTop, s.thumbs[0] && s.thumbs[0].w]))
  is(s.cnt && s.cnt.y > s.vh / 2, 'a short screen: the counter stays at the foot')
  await o.ctx.close()
}
head('nine photos')
for (const [lang, w] of [['en', 390], ['ar', 390]]) {
  const tag = `${lang} ${w}px, nine photos`
  const o = await open(lang, w, { images: NINE })
  await openViewer(o, w)
  const s = await st(o.p)
  is(s.thumbs.length === 9 && s.strip.scrollW > s.strip.clientW + 40, `${tag}: nine thumbnails and the strip scrolls (${s.strip.scrollW} > ${s.strip.clientW})`)
  is(s.strip.x >= 0 && s.strip.r <= s.vw, `${tag}: the strip stays inside the screen`)
  await key(o.p, 'End'); await settle(o.p, 500)
  const e = await st(o.p)
  const cur = e.thumbs[8]
  is(e.pageCur === 8 && cur.cur === 'true' && cur.x >= e.strip.x - 1 && cur.r <= e.strip.r + 1, `${tag}: End shows the ninth photo and scrolls its thumbnail into view`, JSON.stringify([e.pageCur, cur.x, cur.r, e.strip.x, e.strip.r]))
  await key(o.p, 'Home'); await settle(o.p, 500)
  const h = await st(o.p)
  is(h.pageCur === 0 && h.thumbs[0].x >= h.strip.x - 1 && h.thumbs[0].r <= h.strip.r + 1, `${tag}: Home scrolls the first thumbnail back into view`)
  await o.ctx.close()
}

// ---- mutations: with a part cut, the matching check must fail ---------------------------------------------------------------
head('mutants')
const cut = (src, from, to) => { if (!src.includes(from)) throw new Error('mutant text not found: ' + from.slice(0, 60)); return src.replace(from, to) }
const MUTS = [
  ['the filmstrip not built', cut(JS, '      buildStrip()\n      level()', '      level()'), async (js) => { const o = await open('en', 1280, { js }); await openViewer(o, 1280); const s = await st(o.p); await o.ctx.close(); return s.open && s.box.strip && s.thumbs.length === 4 }],
  ['the fling cut', cut(JS, 'startFling(g.vx || 0, g.vy || 0)', 'void 0'), async (js) => {
    const o = await open('en', 1280, { js }); await openViewer(o, 1280)
    for (let i = 0; i < 3; i++) await key(o.p, '+')
    await settle(o.p, 450)
    await o.p.mouse.move(600, 450); await o.p.mouse.down()
    for (let i = 1; i <= 6; i++) { await o.p.mouse.move(600 + (130 * i) / 6, 450); await o.p.waitForTimeout(12) }
    await o.p.mouse.up()
    const a = (await st(o.p)).tx; await o.p.waitForTimeout(120); const b = (await st(o.p)).tx; await o.ctx.close(); return Math.abs(b - a) > 6
  }],
  ['the keyboard pan cut', cut(JS, 'var pan = V.s > 1.01 && !plateIn() ? ARROWS[k] : null', 'var pan = null'), async (js) => {
    const o = await open('en', 1280, { js }); await openViewer(o, 1280)
    await key(o.p, '+'); await key(o.p, '+'); await settle(o.p, 400)
    const a = await st(o.p); await key(o.p, 'ArrowRight'); await settle(o.p, 400); const b = await st(o.p); await o.ctx.close()
    return b.src === a.src && b.count === a.count && b.tx < a.tx - 20
  }],
  ['the stand-in cut', cut(JS, "      placeholder()\n    }\n    var mk", '    }\n    var mk'), async (js) => {
    const o = await open('en', 1280, { js, delay: 1600 }); await o.p.click('.catalog-gallery-stage', { force: true }); await o.p.waitForSelector('.catalog-product-lightbox'); await o.p.waitForTimeout(500)
    const s = await st(o.p); await o.ctx.close(); return s.box.loading && /^url\("/.test(s.box.ph)
  }],
  ['the pinch factor cut', cut(JS, '(e.ctrlKey ? 0.01 : 0.0025)', '0.0025'), async (js) => {
    const o = await open('en', 1280, { js }); await openViewer(o, 1280)
    const r = await o.p.evaluate(() => { const img = document.querySelector('.catalog-product-lightbox > img'), q = img.getBoundingClientRect(); for (let i = 0; i < 10; i++) img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: q.left + q.width / 2, clientY: q.top + q.height / 2, bubbles: true, cancelable: true })); const m = getComputedStyle(img).transform; return m && m !== 'none' ? +m.match(/matrix\(([^)]+)\)/)[1].split(',')[0] : 1 })
    await o.ctx.close(); return r > 2.3
  }],
  ['the whole CSS section removed', null, async (js, css) => { const o = await open('en', 1280, { css }); await openViewer(o, 1280); const s = await st(o.p); await o.ctx.close(); return s.open && s.strip && s.strip.pos === 'absolute' && s.thumbs.every((t) => near(t.w, 56, 1)) && s.box.padTop > 60 }],
]
for (const [label, js, check] of MUTS) {
  const real = await check(JS, SH)
  const bad = js === null ? await check(JS, SH_OFF) : await check(js, SH)
  is(real === true, `mutant "${label}": the check passes on the real files`)
  is(bad === false, `mutant "${label}": and goes red with it`)
}

await browser.close()
srv.server.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
