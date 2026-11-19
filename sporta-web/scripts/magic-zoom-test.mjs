// MAGIC ZOOM-1119 (public/sporta-features.js) + its CSS (public/sporta-product-fix.css), owner 2026-11-19: "make magic zoom".
//
//   npm run test:magic-zoom      (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled product page (the live build's gallery) with a synthetic photo (a colour gradient: red = x, green = y, a dark grid every
// 100px), Arabic and English, 1024 and 1280 px, a mouse:
//   1  hover: ONE lens layer inside the stage, the stage marked, the build's own scale of the photo switched off, the layer shows the page's
//      copy at once (the first frame) and the ORIGINAL file once it has arrived; nothing moves (stage box and page height unchanged)
//   2  the picture: read from the screenshot's pixels, the point under the pointer keeps its colour and a point 90px beside it shows the
//      picture 2.5x larger (not the page's own 1x), within a few levels, at two places of the photo
//   3  the glide: a jump of the pointer is followed over about 80 ms (not at once), reaches it, and with prefers-reduced-motion is at once
//      with no fade
//   4  leaving the stage removes the lens and hands the photo back to the build; the viewer (a click) takes over: no lens under it
//   5  a touch device, the "no photo" plate and /backends get no lens at all
// MUTATION: the lens, the glide, the geometry, the mouse-only rule, the mark that hides the build's scale and the CSS switch are cut in turn.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'
import { png } from './lib/png.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const JS_F = 'sporta-features.js', CSS_F = 'sporta-product-fix.css'
const JS = readFileSync(join(PUB, JS_F), 'utf8'), CSS = readFileSync(join(PUB, CSS_F), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const BIG = photoPng(1600, 1600), SMALL = photoPng(400, 400)
const Z = 2.5
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

const open = async (srv, { w = 1280, lang = 'en', touch = false, calm = false, photos = true, path = '/product/sculpt-jacket-black', log = null }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: touch, hasTouch: touch, serviceWorkers: 'block', reducedMotion: calm ? 'reduce' : 'no-preference' })
  await ctx.route('**/images/products/**', (r) => {
    const u = r.request().url()
    if (log) log.push(u.replace(srv.base, ''))
    if (!photos) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' })
    return r.fulfill({ status: 200, contentType: 'image/png', body: /small\.png/.test(u) ? SMALL : BIG })
  })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}${path}?lang=${lang}`, { waitUntil: 'load' })
  await p.waitForSelector('.catalog-gallery-stage', { timeout: 15000 }).catch(() => {})
  await p.waitForFunction(() => { const i = document.querySelector('.catalog-gallery-stage img'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(500)
  return { ctx, p, errs }
}
const stageBox = (p) => p.evaluate(() => { const r = document.querySelector('.catalog-gallery-stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
const lensInfo = (p) => p.evaluate(() => {
  const st = document.querySelector('.catalog-gallery-stage'), lens = [...st.querySelectorAll('[data-sporta-lens]')], img = st.querySelector('.catalog-gallery-track > img')
  const l = lens[lens.length - 1], cs = l && getComputedStyle(l)
  return { n: lens.length, mz: st.hasAttribute('data-sporta-mz'), opacity: cs ? cs.opacity : null, bg: cs ? cs.backgroundImage : '', size: cs ? cs.backgroundSize : '', pos: cs ? cs.backgroundPosition : '', imgTransform: getComputedStyle(img).transform, aria: l ? l.getAttribute('aria-hidden') : null, pe: cs ? cs.pointerEvents : '', page: document.documentElement.scrollHeight, lightbox: !!document.querySelector('.catalog-product-lightbox') }
})
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
// the colour of the screenshot at (x, y) (median of a 5x5 square: the photo's dark grid lines are outliers)
const pixel = async (p, x, y) => {
  const buf = await p.screenshot({ clip: { x: Math.round(x) - 2, y: Math.round(y) - 2, width: 5, height: 5 } })
  const im = png(buf), ch = [[], [], []]
  for (let j = 0; j < im.h; j++) for (let i = 0; i < im.w; i++) { const c = im.at(i, j); ch[0].push(c.r); ch[1].push(c.g); ch[2].push(c.b) }
  return ch.map(median)
}
// where (in content units 0..1) the photo shows at a point of the stage when the lens is OFF (1x) and ON (Z x, pointer at (px, py))
const content = (st, px, py, x, y, z) => ({ u: (px - st.x) / st.w + (x - px) / (st.w * z), v: (py - st.y) / st.h + (y - py) / (st.h * z) })

const run = async (files, o, fn) => {
  const srv = await serveLive({ js: files.js ? { [JS_F]: files.js } : {}, css: files.css ? { [CSS_F]: files.css } : {} })
  try { const t = await open(srv, o); try { return await fn(t, srv) } finally { await t.ctx.close() } } finally { await srv.close() }
}

// -------------------------------------------------------------------------------------------------------------------- the scenarios
const hoverScenario = async (t, w) => {
  const st = await stageBox(t.p), cx = st.x + st.w * 0.5, cy = st.y + st.h * 0.5
  const before = await t.p.evaluate(() => ({ page: document.documentElement.scrollHeight }))
  await t.p.mouse.move(cx - 40, cy - 40); await t.p.mouse.move(cx, cy, { steps: 4 })
  await t.p.waitForTimeout(700)
  const info = await lensInfo(t.p), after = await stageBox(t.p)
  return { info, before, shifted: Math.abs(after.w - st.w) > 0.5 || Math.abs(after.h - st.h) > 0.5 || Math.abs(after.y - st.y) > 0.5 || info.page !== before.page }
}
const pixelScenario = async (t) => {
  const st = await stageBox(t.p), res = []
  for (const [fx, fy] of [[0.2537, 0.3981], [0.6137, 0.5481]]) {
    const px = st.x + st.w * fx, py = st.y + st.h * fy
    await t.p.mouse.move(px - 30, py - 30); await t.p.mouse.move(px, py, { steps: 3 }); await t.p.waitForTimeout(900)
    // a sample whose zoomed content point is mid-cell (the photo's grid lines are 3px of 1600, 7.5px of screen when zoomed)
    let dx = 90, dy = 90
    const mid = (c) => { const m = (c * 1600) % 100; return m >= 25 && m <= 75 }
    for (let k = 0; k < 80 && !(mid(content(st, px, py, px + dx, py, Z).u) && mid(content(st, px, py, px, py + dy, Z).v)); k++) { if (!mid(content(st, px, py, px + dx, py, Z).u)) dx++; if (!mid(content(st, px, py, px, py + dy, Z).v)) dy++ }
    const sx = px + dx, sy = py + dy
    const got = await pixel(t.p, sx, sy)
    const z = content(st, px, py, sx, sy, Z), one = content(st, px, py, sx, sy, 1)
    const want = [Math.round(z.u * 255), Math.round(z.v * 255)], plain = [Math.round(one.u * 255), Math.round(one.v * 255)]
    res.push({ got, want, plain, ok: Math.abs(got[0] - want[0]) <= 9 && Math.abs(got[1] - want[1]) <= 9 && (Math.abs(got[0] - plain[0]) > 12 || Math.abs(got[1] - plain[1]) > 12) })
  }
  return res
}
const glideScenario = async (t) => {
  const st = await stageBox(t.p)
  await t.p.mouse.move(st.x + st.w * 0.2, st.y + st.h * 0.2, { steps: 3 }); await t.p.waitForTimeout(600)
  const a = await lensInfo(t.p)
  await t.p.mouse.move(st.x + st.w * 0.8, st.y + st.h * 0.8)
  await t.p.waitForTimeout(22)
  const early = await lensInfo(t.p)
  await t.p.waitForTimeout(900)
  const late = await lensInfo(t.p)
  const num = (s) => (s.match(/-?[\d.]+/g) || []).map(Number)
  const d = (x, y) => Math.hypot(num(x.pos)[0] - num(y.pos)[0], num(x.pos)[1] - num(y.pos)[1])
  return { total: d(a, late), early: d(early, late), after: d(late, late) }
}

head('the real files: hover, picture, glide, leave')
for (const [w, lang] of [[1280, 'en'], [1280, 'ar'], [1024, 'en']]) {
  const tag = `${lang} ${w}px`
  await run({}, { w, lang }, async (t) => {
    const h = await hoverScenario(t, w)
    const i = h.info
    is(i.n === 1 && i.mz && i.opacity === '1' && i.aria === 'true' && i.pe === 'none', `${tag}: hover draws ONE lens in the stage, marked, aria-hidden, taking no pointer event`, JSON.stringify(i))
    is(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(i.imgTransform), `${tag}: the build's own scale of the photo is switched off while the lens is drawn`, i.imgTransform)
    is(/sculpt-jacket-black\.jpg/.test(i.bg), `${tag}: the lens shows the photo's original file`, i.bg)
    is(!h.shifted, `${tag}: nothing moves (stage box and page height unchanged)`)
    const px = await pixelScenario(t)
    is(px.every((r) => r.ok), `${tag}: the picture under the lens is the photo at 2.5x around the pointer (pixels read from the screenshot)`, JSON.stringify(px))
    is(t.errs.length === 0, `${tag}: no page error`, t.errs.join(' | '))
    const st = await stageBox(t.p)
    await t.p.mouse.move(2, 2); await t.p.waitForTimeout(500)
    const gone = await lensInfo(t.p)
    is(gone.n === 0 && !gone.mz, `${tag}: leaving the stage removes the lens and the mark`, JSON.stringify(gone))
    is(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(gone.imgTransform), `${tag}: the photo is the build's again (unscaled)`, gone.imgTransform)
    await t.p.mouse.move(st.x + st.w / 2, st.y + st.h / 2, { steps: 3 }); await t.p.waitForTimeout(400)
    await t.p.mouse.click(st.x + st.w / 2, st.y + st.h / 2); await t.p.waitForTimeout(600)
    const lb = await lensInfo(t.p)
    is(lb.lightbox && lb.n === 0, `${tag}: a click opens the viewer and the lens is gone from under it`, JSON.stringify({ lb: lb.lightbox, n: lb.n }))
  })
}
await run({}, { w: 1280, lang: 'en' }, async (t) => {
  const g = await glideScenario(t)
  is(g.total > 150 && g.early > 25 && g.early < g.total, 'the lens glides: 22 ms after a jump of the pointer it is still on its way', JSON.stringify(g))
  is(g.after <= 1, 'and it reaches the pointer', JSON.stringify(g))
})
await run({}, { w: 1280, lang: 'en', calm: true }, async (t) => {
  const g = await glideScenario(t)
  is(g.early <= 2, 'prefers-reduced-motion: no glide, the lens is on the pointer at once', JSON.stringify(g))
  const tr = await t.p.evaluate(() => { const l = document.querySelector('[data-sporta-lens]'); return l ? getComputedStyle(l).transitionDuration : null })
  is(parseFloat(tr) <= 0.001, 'and no fade (the shop\'s reduced-motion rule makes every transition instant)', String(tr))
})
{ // the page's copy first, the original once it has arrived
  const log = []
  await run({}, { w: 1280, lang: 'en', log }, async (t) => {
    await t.p.evaluate(() => { const i = document.querySelector('.catalog-gallery-track > img'); i.sizes = '100vw'; i.srcset = '/images/products/small.png 400w' })
    await t.p.waitForTimeout(400)
    const st = await stageBox(t.p)
    log.length = 0
    await t.p.mouse.move(st.x + st.w * 0.4, st.y + st.h * 0.4, { steps: 2 }); await t.p.waitForTimeout(60)
    const first = await lensInfo(t.p)
    await t.p.waitForTimeout(900)
    const later = await lensInfo(t.p)
    is(/small\.png/.test(first.bg) && /sculpt-jacket-black\.jpg/.test(later.bg), 'the first frame shows the copy the page has, then the lens sharpens to the original', JSON.stringify({ first: first.bg, later: later.bg }))
    is(log.some((u) => /sculpt-jacket-black\.jpg/.test(u)), 'the original is requested once the pointer has rested (a drive-by asks for nothing)', JSON.stringify(log))
  })
  const log2 = []
  await run({}, { w: 1280, lang: 'en', log: log2 }, async (t) => {
    await t.p.evaluate(() => { const i = document.querySelector('.catalog-gallery-track > img'); i.sizes = '100vw'; i.srcset = '/images/products/small.png 400w' })
    await t.p.waitForTimeout(400)
    const st = await stageBox(t.p); log2.length = 0
    await t.p.mouse.move(st.x + 20, st.y + 20); await t.p.mouse.move(st.x + 60, st.y + 60); await t.p.mouse.move(2, 2); await t.p.waitForTimeout(600)
    is(!log2.some((u) => /sculpt-jacket-black\.jpg/.test(u)), 'a drive-by of the pointer across the stage downloads nothing', JSON.stringify(log2))
  })
}

head('no lens where there must not be one')
await run({}, { w: 390, lang: 'en', touch: true }, async (t) => {
  const st = await stageBox(t.p); await t.p.mouse.move(st.x + 100, st.y + 100); await t.p.mouse.move(st.x + 150, st.y + 150); await t.p.waitForTimeout(500)
  const i = await lensInfo(t.p); is(i.n === 0 && !i.mz, 'a touch device (no hover, coarse pointer) gets no lens', JSON.stringify(i))
})
await run({}, { w: 1280, lang: 'en', photos: false }, async (t) => {
  const st = await stageBox(t.p); await t.p.mouse.move(st.x + 100, st.y + 100); await t.p.mouse.move(st.x + 150, st.y + 150); await t.p.waitForTimeout(500)
  const i = await lensInfo(t.p); is(i.n === 0 && !i.mz, 'the "no photo" plate gets no lens', JSON.stringify(i))
})
{
  const srv = await serveLive({})
  try {
    const t = await open(srv, { w: 1280, lang: 'en', path: '/backends' })
    const n = await t.p.evaluate(() => [window.__sportaMagicZoom, document.querySelectorAll('[data-sporta-lens]').length])
    is(n[0] === undefined && n[1] === 0, 'nothing is installed on /backends', JSON.stringify(n))
    await t.ctx.close()
  } finally { await srv.close() }
}

head('mutants: with one part cut, the matching check fails')
const cut = (text, from, to, label) => { const c = text.replace(from, to); if (c === text) throw new Error('mutation did not apply: ' + label); return c }
const probe = async (files, o) => run(files, o, async (t) => {
  const h = await hoverScenario(t, o.w || 1280)
  const px = h.info.n ? await pixelScenario(t) : [{ ok: false }]
  const g = await glideScenario(t)
  return { hover: h.info.n === 1 && h.info.mz && /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(h.info.imgTransform), px: px.every((r) => r.ok), glide: g.early > 25 && g.early < g.total, bgOriginal: /sculpt-jacket-black\.jpg/.test(h.info.bg), imgTransform: h.info.imgTransform }
})
const MUT = [
  ['the lens is never created', { js: cut(JS, 'if (!S || S.stage !== st) { if (S) end(true); begin(st, e) }', 'if (!S) return', 'begin') }, (r) => r.hover],
  ['the picture geometry (the point under the pointer)', { js: cut(JS, "(s.py - v * dh * Z) + 'px'", "(s.py - v * dh * Z * 0.5) + 'px'", 'geometry') }, (r) => r.px],
  ['the glide (the pointer is followed at once)', { js: cut(JS, 'var k = calm() || !s.last ? 1 : 1 - Math.exp(-Math.min(34, Math.max(1, t - s.last)) / GLIDE_MS)   // a frame is at most 34 ms: after a rest the first step is a normal one', 'var k = 1', 'glide') }, (r) => r.glide],
  ['the mark that hides the build\'s scale is never set', { js: cut(JS, "s.stage.setAttribute(ON, '')", '', 'mark') }, (r) => r.hover],
  ['the CSS that switches the build\'s scale off', { css: cut(CSS, '.catalog-gallery-stage[data-sporta-mz] .catalog-gallery-photo { transform: none !important; }', '', 'css') }, (r) => r.hover],
]
for (const [label, files, check] of MUT) {
  const good = check(await probe({}, { w: 1280, lang: 'en' })), bad = check(await probe(files, { w: 1280, lang: 'en' }))
  is(good === true, `mutant "${label}": the check passes on the real files`)
  is(bad === false, `mutant "${label}": and goes red with it cut`)
}
{ // the mouse-only rule
  const mut = cut(JS, 'if (!fine()) { if (S) end(true); return }', '', 'fine')
  const lens = async (files) => run(files, { w: 390, lang: 'en', touch: true }, async (t) => { const st = await stageBox(t.p); await t.p.mouse.move(st.x + 100, st.y + 100); await t.p.mouse.move(st.x + 150, st.y + 150); await t.p.waitForTimeout(500); return (await lensInfo(t.p)).n })
  const good = await lens({}), bad = await lens({ js: mut })
  is(good === 0, 'mutant "the mouse-only rule": no lens on a touch device with the real file')
  is(bad > 0, 'mutant "the mouse-only rule": and a lens appears with the rule cut', String(bad))
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
