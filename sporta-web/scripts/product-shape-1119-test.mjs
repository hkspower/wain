// PRODUCT SHAPE 1119 of public/sporta-product-fix.css (owner, 2026-11-19: "make products page only one shape and center name"):
//   the product page is ONE shape - the rounded rectangle of the shop's own system (16px card or sheet, 12px control, 8px chip) - with no pill
//   and no circle; and the product NAME is centred on its column (the wishlist heart is out of the flow, the title balances its room).
//
//   npm run test:product-shape-1119     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled product page (sculpt-jacket-black, with a sale price so the "-N%" tag is on the page), ar + en, 390 and 1280 px:
//   [ps-0] every rounded element of the page has a radius from the system (2px bars, 6 / 8 / 10 / 12 / 16 px, in rem), none is a pill or a circle
//   [ps-1] the wishlist heart, every colour swatch and the lightbox's close button are 12px rounded squares
//   [ps-2] the swatches' dots are 8px rounded squares; a slider dot is a 2px bar
//   [ps-3] the "!" mark of the size message is a 6px rounded square
//   [ps-4] the title's box is the column (equal padding both sides), its middle is the column's middle (<= 1px), the heart sits at the end corner
//          and over no word of the title; in both languages, with a short and a long name
//   the phone bar's sheet has the 16px card radius; no sideways scroll, no page error.
// MUTATION: each [ps-N] block is cut in turn and the matching check must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-product-fix.css'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const LONG_EN = 'Sculpt Seamless High-Waist Performance Training Jacket With Side Pocket Edition', LONG_AR = 'جاكيت سكَلبت عالي الخصر للتدريب الرياضي المكثف مع جيب جانبي - الإصدار الخاص'
const state = { long: false }
const products = (body) => body.map((p) => (p.slug === 'sculpt-jacket-black' ? { ...p, price: 8, list_price: 10, on_sale: true, ...(state.long ? { name_en: LONG_EN, name_ar: LONG_AR } : {}) } : p))
const PHOTO = photoPng(800, 800)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive({ api: { products }, ...opts }); try { return await fn(srv) } finally { await srv.close() } }
const open = async (srv, { w, lang }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }))
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}/product/sculpt-jacket-black?lang=${lang}`, { waitUntil: 'load' })
  await p.waitForSelector('.catalog-product-title', { timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(1500)
  return { ctx, p, errs }
}

const MEASURE = () => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const page = document.querySelector('.catalog-product-page')
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  // a synthetic slider dot, exactly the build's markup, so the dot rule is measured even on a one-photo product
  const gal = page.querySelector('.catalog-gallery')
  const dots = document.createElement('div'); dots.className = 'mt-3 flex justify-center gap-0.5 lg:hidden'; dots.setAttribute('data-test-dots', '')
  dots.innerHTML = '<button type="button" class="group/dot grid h-6 min-w-6 place-items-center"><span class="block h-1.5 rounded-full w-5 bg-ink"></span></button>'
  gal.appendChild(dots)
  const shapes = []
  for (const e of [page, ...page.querySelectorAll('*')]) {
    if (!shown(e)) continue
    const cs = getComputedStyle(e), r = e.getBoundingClientRect()
    for (const k of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      const v = parseFloat(cs[k])
      if (!(v > 0)) continue
      const pill = v >= Math.min(r.width, r.height) / 2 - 0.5 && Math.min(r.width, r.height) >= 12
      shapes.push({ who: e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 2).join('.') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height), v, pill, k })
    }
  }
  const radius = (sel) => { const e = page.querySelector(sel); return e ? parseFloat(getComputedStyle(e).borderTopLeftRadius) : null }
  const col = page.querySelector('.catalog-product-summary'), title = page.querySelector('.catalog-product-title')
  const heart = col.querySelector(':scope > div > button[aria-pressed]'), cr = col.getBoundingClientRect(), tr = title.getBoundingClientRect(), hr = heart.getBoundingClientRect()
  const rg = document.createRange(); rg.selectNodeContents(title)
  const lines = [...rg.getClientRects()].map((q) => ({ l: q.left, r: q.right }))
  const left = Math.min(...lines.map((q) => q.l)), right = Math.max(...lines.map((q) => q.r))
  const alert = document.createElement('div'); alert.id = 'product-size-options'; alert.style.cssText = 'position:absolute;left:0;top:0'; alert.innerHTML = '<p role="alert">x</p>'; document.body.appendChild(alert)
  const bang = parseFloat(getComputedStyle(alert.firstChild, '::before').borderTopLeftRadius)
  alert.remove()
  const bar = page.querySelector('.action-bar')
  return {
    rem, shapes, over: document.documentElement.scrollWidth - innerWidth, rtl: document.documentElement.dir === 'rtl',
    heart: radius('.catalog-product-summary > div > button[aria-pressed]'), swatches: [...page.querySelectorAll('.catalog-colour-swatch')].map((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)),
    dots: [...page.querySelectorAll('.catalog-colour-swatch__dot')].map((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)),
    smallDot: (() => { const e = page.querySelector('span.h-4.w-4.rounded-full'); return e ? parseFloat(getComputedStyle(e).borderTopLeftRadius) : null })(),
    sliderDot: parseFloat(getComputedStyle(dots.querySelector('span')).borderTopLeftRadius), bang,
    title: { boxMid: (tr.left + tr.right) / 2, colMid: (cr.left + cr.right) / 2, boxL: tr.left - cr.left, boxR: cr.right - tr.right, textMid: (left + right) / 2, textL: left, textR: right, lines: lines.length },
    heartBox: { l: hr.left, r: hr.right, t: hr.top, b: hr.bottom, pos: getComputedStyle(heart).position, nearEnd: document.documentElement.dir === 'rtl' ? Math.abs(hr.left - cr.left) : Math.abs(cr.right - hr.right) },
    barTop: bar ? parseFloat(getComputedStyle(bar).borderTopLeftRadius) : null, barShown: bar ? shown(bar) : false,
  }
}
const ALLOWED = (rem) => [2, 0.25 * rem, 0.375 * rem, 0.5 * rem, 0.625 * rem, 0.75 * rem, rem]
const near = (v, list) => list.some((x) => Math.abs(v - x) <= 1)
const CHECK = {
  oneShape: (m) => m.shapes.length > 8 && m.shapes.every((s) => !s.pill && near(s.v, ALLOWED(m.rem))),
  controls: (m) => m.heart !== null && Math.abs(m.heart - 0.75 * m.rem) <= 1 && m.swatches.length >= 3 && m.swatches.every((v) => Math.abs(v - 0.75 * m.rem) <= 1),
  dots: (m) => m.dots.length >= 3 && m.dots.every((v) => Math.abs(v - 0.5 * m.rem) <= 1) && Math.abs(m.sliderDot - 2) <= 0.5 && m.smallDot !== null && Math.abs(m.smallDot - 0.25 * m.rem) <= 1,
  bang: (m) => Math.abs(m.bang - 0.375 * m.rem) <= 1,
  centred: (m) => Math.abs(m.title.boxMid - m.title.colMid) <= 1 && Math.abs(m.title.boxL - m.title.boxR) <= 1 && (m.title.lines > 1 || Math.abs(m.title.textMid - m.title.colMid) <= 1.5),
  heartOut: (m) => m.heartBox.pos === 'absolute' && m.heartBox.nearEnd <= 1 && (m.rtl ? m.heartBox.r <= m.title.textL + 0.5 : m.heartBox.l >= m.title.textR - 0.5),
}
const run = async (opts, o, long = false) => withServer(opts, async (srv) => { state.long = long; const t = await open(srv, o); const m = await t.p.evaluate(MEASURE); await t.ctx.close(); state.long = false; return { m, errs: t.errs } })

head('the real file, on the real compiled product page')
for (const [w, lang] of [[390, 'en'], [390, 'ar'], [1280, 'en'], [1280, 'ar']]) {
  const tag = `${lang} ${w}px`
  const { m, errs } = await run({}, { w, lang })
  is(CHECK.oneShape(m), `${tag}: every rounded element is from the system (2px bars, 4 / 6 / 8 / 10 / 12 / 16 px): no pill, no circle`, JSON.stringify(m.shapes.filter((s) => s.pill || !near(s.v, ALLOWED(m.rem))).slice(0, 5)))
  is(CHECK.controls(m), `${tag}: the wishlist heart and every colour swatch are 12px rounded squares`, `heart ${m.heart} swatches ${m.swatches.join(',')}`)
  is(CHECK.dots(m), `${tag}: the colour dots are 8px rounded squares and the 16px colour dot in the details a 4px one, a slider dot a 2px bar`, `${m.dots.join(',')} / ${m.sliderDot}`)
  is(CHECK.bang(m), `${tag}: the "!" mark of the size message is a 6px rounded square`, String(m.bang))
  is(CHECK.centred(m), `${tag}: the title's box is the column (equal sides) and its middle is the column's middle`, JSON.stringify(m.title))
  is(CHECK.heartOut(m), `${tag}: the heart sits at the end corner and over no word of the title`, JSON.stringify(m.heartBox))
  if (w < 500) is(m.barShown && Math.abs(m.barTop - m.rem) <= 1, `${tag}: the phone bar's sheet has the 16px card radius`, String(m.barTop))
  is(m.over <= 0 && errs.length === 0, `${tag}: no sideways scroll, no page error`, `${m.over}px ${errs.join(' | ')}`)
  const long = await run({}, { w, lang }, true)
  is(CHECK.centred(long.m) && CHECK.heartOut(long.m), `${tag}: a long name wraps inside the same centred box and the heart stays clear of it`, JSON.stringify(long.m.title))
}
{ // the lightbox close button
  await withServer({}, async (srv) => {
    for (const w of [390, 1280]) {
      const t = await open(srv, { w, lang: 'en' })
      await t.p.click('.catalog-gallery-stage'); await t.p.waitForSelector('.catalog-product-lightbox', { timeout: 5000 }).catch(() => {})
      const r = await t.p.evaluate(() => { const b = document.querySelector('.catalog-product-lightbox > button'); return b ? parseFloat(getComputedStyle(b).borderTopLeftRadius) / parseFloat(getComputedStyle(document.documentElement).fontSize) : null })
      is(r !== null && Math.abs(r - 0.75) <= 0.07, `${w}px: the lightbox's close button is a 12px rounded square`, String(r))
      await t.ctx.close()
    }
  })
}

head('mutants: with one block cut, the matching check fails')
const block = (css, n) => {
  const a = css.indexOf(`/* [ps-${n}] */`)
  const next = [css.indexOf(`/* [ps-${n + 1}] */`, a), css.indexOf('/* ==== end PRODUCT SHAPE 1119 */', a)].filter((x) => x > 0)
  return a < 0 ? css : css.slice(0, a) + css.slice(Math.min(...next))
}
const MUT = [
  ['ps-1 control corners', block(CSS, 1), { w: 390, lang: 'en' }, CHECK.controls],
  ['ps-2 dots', block(CSS, 2), { w: 390, lang: 'en' }, CHECK.dots],
  ['ps-3 the "!" mark', block(CSS, 3), { w: 390, lang: 'en' }, CHECK.bang],
  ['ps-4 the centred name', block(CSS, 4), { w: 1280, lang: 'en' }, (m) => CHECK.centred(m) && CHECK.heartOut(m)],
  ['ps-4 the centred name (Arabic phone)', block(CSS, 4), { w: 390, lang: 'ar' }, (m) => CHECK.centred(m) && CHECK.heartOut(m)],
  ['the sheet radius edited in place', CSS.replace('border-radius: 1rem 1rem 0 0;   /* PRODUCT SHAPE 1119', 'border-radius: 1.25rem 1.25rem 0 0;   /* PRODUCT SHAPE 1119'), { w: 390, lang: 'en' }, (m) => Math.abs(m.barTop - m.rem) <= 1],
]
for (const [label, css, o, check] of MUT) {
  if (css === CSS) { is(false, `mutant "${label}": the cut text was found`); continue }
  const good = check((await run({}, o)).m), bad = check((await run({ css: { [CSS_F]: css } }, o)).m)
  is(good === true, `mutant "${label}": the check passes on the real file`)
  is(bad === false, `mutant "${label}": and goes red with it cut`)
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
