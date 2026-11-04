// Lane U2 of "improve the UX/UI of the checkout, the cart and add to cart" (2026-11-04): the bag PAGE (/cart) and the bag
// DRAWER, proven in a real browser.
//
//   npm run test:cart-ux      (rig-free: no database, no server of the project, no dist/, no port of the test rig)
//
// What is under test (all of it add-on code for the compiled live storefront; src/ is not live and is not touched):
//   public/sporta-bag-touch.css     section "UX: BAG PAGE"     blocks [ux-cart-1] .. [ux-cart-7] and the copy preamble
//   public/sporta-cart-drawer.css   section "UX: BAG DRAWER"   blocks [ux-drawer-1] .. [ux-drawer-7] and the copy preamble
//   public/sporta-footer-call.js    the second block, "bag accessibility" (aria-describedby, live regions, focus after remove)
//
// Two layers, because the live build's source is not in the repo:
//   A  FIXTURES (always runs). The LIVE rendered markup of the bag page and of the open drawer (scripts/fixtures/sizes-screen),
//      under the live compiled rules (live.css) and the 14 add-on stylesheets in the order the live index.html links them.
//      Arabic (RTL, the default) and English, at 320, 360, 390, 768, 1023 and 1280px (the drawer: 320-1280, plus a landscape
//      phone). Every assertion is a measurement: a box, a computed style, a contrast ratio, a scroll position.
//   B  THE REAL APP (runs when the capture of the live storefront is on this machine: SPORTA_LIVE_CAPTURE=<dir>, default the
//      session scratchpad's scan-words/live; skipped with a message otherwise). The real compiled client, with the live /api
//      JSON, a bag stored exactly as the app stores it, POSTs fulfilled locally (nothing reaches a real server). It proves what
//      a fixture cannot: the order POST body is BYTE-IDENTICAL with the add-on, without it, with its script throwing and with
//      its script blocked; the stored bag is identical after the same taps; CLS is not worse; the closed drawer's shadow is gone
//      from the page edge (pixels); focus, the hidden status message and the keyboard order in the real DOM.
//
// MUTATION: the suite cuts the whole UX section out of both files (and the script block out of the third) and requires the
// checks to fail; then cuts EACH numbered block on its own and requires at least one check to fail, so no block is dead weight.
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium-1243/chrome-linux64/chrome), CART_UX_SKIP_REAL=1 (layer A only),
// CART_UX_SKIP_MUTANTS=1 (no mutation pass).
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ADDON_ORDER, MY_FILES, PUB, WEB, addonFiles, uxOf, blocksOf, without, serveFx } from './lib/cart-ux-page.mjs'
import { liveDir, serveLive, line as bagLine, BAG } from './lib/cart-ux-live.mjs'
import { png } from './lib/png.mjs'

const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const FILES = addonFiles()
const JS_PATH = join(PUB, 'sporta-footer-call.js')
const JS = readFileSync(JS_PATH, 'utf8')
const JS_MARK = '/* Sporta — bag accessibility'
const jsOf = (js) => { const i = js.indexOf(JS_MARK); return i < 0 ? { before: js, block: '' } : { before: js.slice(0, i), block: js.slice(i) } }
const JS_WITHOUT = jsOf(JS).before

const NOTE = { ar: 'تظهر رسوم التوصيل وأي خصم عند إتمام الشراء', en: 'Delivery fee and any discount are shown at checkout' }
const MAX = { ar: 'الحد الأقصى المتاح', en: 'Maximum available' }
const REMOVED = { ar: (n) => `تمت إزالة «${n}» من الحقيبة`, en: (n) => `Removed from your bag: ${n}` }

let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const note = (t) => out.push('     ' + t)
const flush = () => { console.log(out.join('\n')); out.length = 0 }
const near = (a, b, t) => Math.abs(a - b) <= t
const f1 = (n) => (n == null || Number.isNaN(n) ? 'n/a' : (Math.round(n * 10) / 10).toString())

// ============================================================================================================ in-page helpers
const INSTALL = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1) }
  const bgOf = (el) => {
    const chain = []
    for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor))
    let acc = [255, 255, 255, 1]
    for (let i = chain.length - 1; i >= 0; i--) acc = over(chain[i], acc)
    return acc
  }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (fg, bg) => { const f = over(fg, bg); const [x, y] = [lum(f), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 } }
  const ink = (n) => { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom } }
  const contrast = (el, prop = 'color', pseudo = null) => ratio(rgba(getComputedStyle(el, pseudo)[prop]), bgOf(el))
  const pseudo = (el, which = '::after') => { const c = getComputedStyle(el, which); return { content: c.content === 'none' || c.content === 'normal' ? 'none' : c.content.replace(/^"|"$/g, ''), display: c.display, fs: parseFloat(c.fontSize), fw: c.fontWeight, ratio: c.content === 'none' || c.content === 'normal' ? null : contrast(el, 'color', which) } }
  window.__h = { rgba, bgOf, ratio, contrast, $, $$, R, ink, pseudo }
}
const LONG = { ar: 'ليقنز رياضي كلاودسوفت للنساء بخامة ناعمة عالية المرونة — أخضر عسكري — مقاس كبير جداً', en: 'Cloudsoft High-Waisted Seamless Training Leggings With Pocket — Army Green — Extra Large' }

// the bag PAGE: five lines (the first with an enabled "+", the second with a disabled one, the last with a long name)
const NORMALISE_PAGE = (lang) => {
  const h = window.__h
  const list = h.$('.purchase-cart__layout > div.min-w-0')
  const lines = h.$$(':scope > .cart-line', list)
  const plus = (l) => l.querySelector('.purchase-quantity > button:last-of-type')
  plus(lines[0]).disabled = false
  plus(lines[1]).disabled = true
  while (list.children.length < 5) { const c = lines[0].cloneNode(true); plus(c).disabled = false; list.appendChild(c) }
  const last = list.lastElementChild; last.querySelector('h3').textContent = lang === 'ar' ? 'ليقنز رياضي كلاودسوفت للنساء بخامة ناعمة عالية المرونة — أخضر عسكري — مقاس كبير جداً' : 'Cloudsoft High-Waisted Seamless Training Leggings With Pocket — Army Green — Extra Large'
}
// the DRAWER: three lines (first enabled "+", second disabled)
const NORMALISE_DRAWER = () => {
  const h = window.__h
  const ul = h.$('.campaign-cart-drawer > ul')
  const lis = h.$$(':scope > li', ul)
  const plus = (l) => l.querySelector('.purchase-quantity > button:last-of-type')
  plus(lis[0]).disabled = false
  plus(lis[1]).disabled = true
  while (ul.children.length < 3) { const c = lis[0].cloneNode(true); plus(c).disabled = false; ul.appendChild(c) }
}

// ============================================================================================================ probes
const PROBE_PAGE = (lang) => {
  const h = window.__h, { $, $$, R, ink, pseudo, contrast } = h
  const plusOf = (l) => l.querySelector('.purchase-quantity > button:last-of-type')
  const vw = innerWidth, vh = innerHeight, rtl = document.documentElement.dir === 'rtl'
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const P = { vw, vh, rem, docW: document.documentElement.scrollWidth, rtl }
  const lines = $$('.purchase-cart .cart-line')
  const info = (l) => l.querySelector(':scope > div:not(.cart-line__controls)')
  const startOf = (r) => (rtl ? r.r : r.l)
  const l0 = lines[0], l1 = lines[1]
  // [ux-cart-1] where the size and the name start, against the start edge of their column
  const sp = l0.querySelector('p[dir="auto"]'), nm = l0.querySelector('h3'), ib = R(info(l0))
  P.sizeGap = Math.abs(startOf(ink(sp)) - startOf(ib)); P.nameGap = Math.abs(startOf(ink(nm)) - startOf(ib))
  // [ux-cart-2] the hint, on a line whose "+" is disabled and not on one whose is enabled; and it follows the attribute
  const hint = (l) => pseudo(info(l).lastElementChild)
  P.hintOff = hint(l0); P.hintOn = hint(l1)
  const p1 = plusOf(l1), p0 = plusOf(l0)
  p1.disabled = false; P.hintOnWhenEnabled = hint(l1).content; p1.disabled = true
  p0.disabled = true; P.hintOffWhenDisabled = hint(l0).content; p0.disabled = false
  const lr = R(l1), ir = R(info(l1)); P.hintInside = ir.b <= lr.b + 0.5 && ir.t >= lr.t - 0.5 && l1.scrollWidth <= l1.clientWidth + 1
  // [ux-cart-3] remove
  const rm = l0.querySelector('.cart-line__controls > button:last-child')
  P.remove = { ratio: contrast(rm), w: R(rm).w, h: R(rm).h, ta: getComputedStyle(rm).touchAction }
  P.stepper = $$('.purchase-quantity button', l0).map((b) => ({ ta: getComputedStyle(b).touchAction, w: R(b).w, h: R(b).h }))
  // [ux-cart-5..7] the summary
  const s = $('.purchase-cart__summary'), sc = getComputedStyle(s), total = $('.purchase-total', s)
  const label = total.children[0], amount = total.children[1]
  const as = $('.purchase-assurance', s), co = $('a.purchase-continue', s), cta = $('a.btn-primary', s), h2 = $('h2', s)
  P.sum = { position: sc.position, topPx: sc.top, rect: R(s), h2: { pos: getComputedStyle(h2).position, display: getComputedStyle(h2).display, vis: getComputedStyle(h2).visibility, w: R(h2).w, h: R(h2).h } }
  P.label = { fs: parseFloat(getComputedStyle(label).fontSize), fw: getComputedStyle(label).fontWeight, ratio: contrast(label) }
  P.amount = { fs: parseFloat(getComputedStyle(amount).fontSize), fw: getComputedStyle(amount).fontWeight, ratio: contrast(amount) }
  P.assur = { display: getComputedStyle(as).display, fs: parseFloat(getComputedStyle(as).fontSize), ratio: contrast(as) }
  P.cont = { display: getComputedStyle(co).display, fs: parseFloat(getComputedStyle(co).fontSize), h: R(co).h, ratio: contrast(co) }
  const cc = getComputedStyle(cta)
  P.cta = { fs: parseFloat(cc.fontSize), fw: cc.fontWeight, h: R(cta).h, w: R(cta).w, ratio: contrast(cta), color: cc.color }
  P.noteAside = pseudo(s); P.noteTotal = pseudo(total)
  P.totalBorder = parseFloat(getComputedStyle(total).borderTopWidth)
  P.totalCol = { dir: getComputedStyle(total).flexDirection }
  // scroll geometry
  const last = lines[lines.length - 1], header = $('.app-header'), footer = $('footer.app-footer')
  const to = (y) => scrollTo({ top: y, left: 0, behavior: 'instant' })
  const at = (y) => { to(y); return { y: scrollY, bar: R(s), cta: R(cta), last: R(last), footer: footer ? R(footer) : null, header: header ? R(header) : null, l0: R(l0), lines: lines.map(R) } }
  P.max = document.documentElement.scrollHeight - vh
  P.s0 = at(0)
  if (vw <= 1023) {
    P.sMid = at(Math.round(P.max / 2)); P.sEnd = at(P.max)
    to(0); document.documentElement.style.setProperty('--sa-bottom', '34px'); const sa = R(cta), sbar = R(s); P.safe = { ctaBottom: sa.b, vh, barPadB: parseFloat(getComputedStyle(s).paddingBottom), barBottom: sbar.b }
    document.documentElement.style.removeProperty('--sa-bottom')
    P.barPadB0 = parseFloat(getComputedStyle(s).paddingBottom)
  } else {
    P.sDesk = at(Math.min(400, P.max))
  }
  to(0)
  // targets: every button of every line, the call to action
  P.targets = $$('.cart-line button').map((b) => Math.min(R(b).w, R(b).h))
  P.order = $$('.cart-line:first-child button').map((b) => b.getAttribute('aria-label'))
  return P
}

const PROBE_DRAWER = () => {
  const h = window.__h, { $, $$, R, pseudo, contrast } = h
  const plusOf = (l) => l.querySelector('.purchase-quantity > button:last-of-type')
  const vw = innerWidth, vh = innerHeight, rtl = document.documentElement.dir === 'rtl'
  const D = { vw, vh, rtl, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) }
  const aside = $('.campaign-cart-drawer'), ul = $(':scope > ul', aside), footer = $(':scope > footer', aside), header = $(':scope > header', aside)
  const lis = $$(':scope > li', ul)
  const startOf = (r) => (rtl ? r.r : r.l), endOf = (r) => (rtl ? r.l : r.r)
  // [ux-drawer-1] shadow: open, closed (the class the bundle puts on it), closed and inert
  const open = aside.className
  D.shadowOpen = getComputedStyle(aside).boxShadow
  aside.className = open.replace('translate-x-0', 'pointer-events-none translate-x-full'); D.shadowClosedClass = getComputedStyle(aside).boxShadow
  aside.className = open; aside.setAttribute('inert', ''); D.shadowInert = getComputedStyle(aside).boxShadow; aside.removeAttribute('inert')
  D.shadowOpenAgain = getComputedStyle(aside).boxShadow
  // [ux-drawer-2] a line, no hint: l0
  const geo = (li) => {
    const img = $(':scope > img', li), nameP = $(':scope > div > p:first-child', li), priceP = $(':scope > div > p:nth-child(2)', li), total = $('.cart-drawer__line-total', li)
    const st = $('.purchase-quantity', li), rm = $('.cart-drawer__remove', li), lr = R(li)
    const ri = R(img), rn = R(nameP), rp = R(priceP), rt = R(total), rs = R(st), rr = R(rm)
    const overlap = !(rt.l >= rp.r - 0.5 || rt.r <= rp.l + 0.5 || rt.t >= rp.b - 0.5 || rt.b <= rp.t + 0.5)
    const btns = $$('button', li).map((b) => Math.min(R(b).w, R(b).h))
    return { h: lr.h, totalEnd: Math.abs(endOf(rt) - endOf(lr)), removeEnd: Math.abs(endOf(rr) - endOf(lr)), stepStart: Math.abs(startOf(rs) - startOf(rn)), totalDy: Math.abs(rt.cy - rp.cy), ctlDy: Math.abs(rs.cy - rr.cy), imgTop: Math.abs(ri.t - rn.t), imgW: ri.w, overlap, btns, over: li.scrollWidth - li.clientWidth, rowsOrdered: rn.b <= rp.t + 1 && rp.b <= rs.t + 1, ta: [...$$('.purchase-quantity button', li), rm].map((b) => getComputedStyle(b).touchAction) }
  }
  D.l0 = geo(lis[0]); D.l1 = geo(lis[1]); D.lis = lis.map((l) => R(l).h)
  // [ux-drawer-3]
  const hint = (li) => pseudo($(':scope > div > p:nth-child(2)', li))
  D.hintOff = hint(lis[0]); D.hintOn = hint(lis[1])
  const p1 = plusOf(lis[1]); p1.disabled = false; D.hintOnWhenEnabled = hint(lis[1]).content; p1.disabled = true
  // [ux-drawer-4] footer
  const t0 = $(':scope > div:first-child', footer), as = $(':scope > p', footer), back = $(':scope > a[href="/shop"]', footer), cta = $(':scope > a.btn-primary', footer)
  D.note = pseudo(t0); D.assur = { display: getComputedStyle(as).display, fs: parseFloat(getComputedStyle(as).fontSize), ratio: contrast(as) }
  D.back = { display: getComputedStyle(back).display, ratio: contrast(back), h: R(back).h }
  D.cta = { fs: parseFloat(getComputedStyle(cta).fontSize), fw: getComputedStyle(cta).fontWeight, h: R(cta).h }
  D.footer = { h: R(footer).h, b: R(footer).b }; D.ul = { h: R(ul).h, clientH: ul.clientHeight }; D.header = { h: R(header).h }
  D.totalLabel = { ratio: contrast($(':scope > span:first-child', t0)) }
  // [ux-drawer-7] padding with and without an inset
  const pad = () => [header, ul, footer].map((e) => ({ l: parseFloat(getComputedStyle(e).paddingLeft), r: parseFloat(getComputedStyle(e).paddingRight) }))
  D.pad0 = pad()
  document.documentElement.style.setProperty('--sa-left', '47px'); document.documentElement.style.setProperty('--sa-right', '0px'); D.padL = pad()
  document.documentElement.style.setProperty('--sa-left', '0px'); document.documentElement.style.setProperty('--sa-right', '47px'); D.padR = pad()
  document.documentElement.style.removeProperty('--sa-left'); document.documentElement.style.removeProperty('--sa-right')
  D.docW = document.documentElement.scrollWidth; D.asideOver = aside.scrollWidth - aside.clientWidth
  return D
}

// ============================================================================================================ the matrix
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const ref = { current: FILES, script: '' }
const { server, base } = await serveFx(ref)
const LANGS = ['ar', 'en']
const PAGE_VIEWS = [[320, 640], [360, 740], [390, 844], [768, 1024], [1023, 768], [1280, 800]]
const DRAWER_VIEWS = [[320, 640], [360, 740], [390, 844], [768, 1024], [1280, 800]]
const key = (...a) => a.join('|')

// variants: files as shipped, the whole UX section cut (the "before"), and each block cut on its own
const SECTIONS = Object.fromEntries(Object.keys(MY_FILES).map((f) => [f, uxOf(f, FILES[f])]))
const BLOCKS = Object.fromEntries(Object.keys(MY_FILES).map((f) => [f, blocksOf(f, SECTIONS[f].ux)]))
const variants = { after: {}, before: Object.fromEntries(Object.keys(MY_FILES).map((f) => [f, without(f, FILES[f], 'all')])) }
const mutants = []
for (const f of Object.keys(MY_FILES)) for (const b of BLOCKS[f]) { const n = `${f} ${b.id}`; variants[n] = { [f]: without(f, FILES[f], [b.id]) }; mutants.push(n) }
const SETSTYLE = ([name, css]) => { document.querySelector(`style[data-addon="${name}"]`).textContent = css }
const applyVariant = (pg, v) => Promise.all(Object.keys(MY_FILES).map((f) => pg.evaluate(SETSTYLE, [f, variants[v][f] ?? FILES[f]])))
const CUT = process.env.CART_UX_SKIP_MUTANTS ? [] : mutants
const ORDER = ['after', 'before', ...CUT]
const MP = {}  // MP[variant][lang|w] page metrics
const MD = {}  // MD[variant][lang|w] drawer metrics
const ML = {}  // ML[variant][lang] landscape drawer
for (const lang of LANGS) {
  for (const [w, h] of PAGE_VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg = await ctx.newPage()
    await pg.goto(`${base}/__fx/cart-${lang}`, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
    await pg.evaluate(INSTALL); await pg.evaluate(NORMALISE_PAGE, lang)
    for (const v of ORDER) { await applyVariant(pg, v); ;(MP[v] ||= {})[key(lang, w)] = await pg.evaluate(PROBE_PAGE, lang) }
    await ctx.close()
  }
  for (const [w, h] of DRAWER_VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg = await ctx.newPage()
    await pg.goto(`${base}/__fx/drawer-${lang}`, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
    await pg.evaluate(INSTALL); await pg.evaluate(NORMALISE_DRAWER)
    for (const v of ORDER) { await applyVariant(pg, v); ;(MD[v] ||= {})[key(lang, w)] = await pg.evaluate(PROBE_DRAWER) }
    await ctx.close()
  }
  { // a landscape phone
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg = await ctx.newPage()
    await pg.goto(`${base}/__fx/drawer-${lang}`, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
    await pg.evaluate(INSTALL); await pg.evaluate(NORMALISE_DRAWER)
    for (const v of ORDER) { await applyVariant(pg, v); ;(ML[v] ||= {})[lang] = await pg.evaluate(PROBE_DRAWER) }
    await ctx.close()
  }
}

// ============================================================================================================ the checks
// Each check is evaluated for one variant's metrics; `base` is the "before" (UX section cut) for relative checks.
// run(v, record) returns nothing: record(name, ok, detail) is called once per case; the caller aggregates.
const checksFor = (v, rec) => {
  const P = MP[v], D = MD[v], L = ML[v], B = { P: MP.before, D: MD.before }
  for (const lang of LANGS) {
    for (const [w] of PAGE_VIEWS) {
      const p = P[key(lang, w)], b = B.P[key(lang, w)], c = `${lang} ${w}px`
      const bar = w <= 1023
      rec('page: no sideways overflow', p.docW <= p.vw, `${c}: ${p.docW} > ${p.vw}`)
      rec('page: the size and the name start on the column\'s own start edge (Arabic: the right)', p.sizeGap <= 1.5 && p.nameGap <= 1.5, `${c}: size ${f1(p.sizeGap)}px, name ${f1(p.nameGap)}px off`)
      rec('page: a line with a disabled "+" says why, in the page\'s language, in the accent colour (4.5:1)', p.hintOn.content === MAX[lang] && p.hintOn.display === 'block' && p.hintOn.ratio >= 4.5 && p.hintOn.fs >= 14, `${c}: ${JSON.stringify(p.hintOn)}`)
      rec('page: a line with an enabled "+" says nothing, and the hint follows the attribute both ways', p.hintOff.content === 'none' && p.hintOnWhenEnabled === 'none' && p.hintOffWhenDisabled === MAX[lang], `${c}: ${p.hintOff.content} / ${p.hintOnWhenEnabled} / ${p.hintOffWhenDisabled}`)
      rec('page: the hint stays inside its card', p.hintInside, c)
      rec('page: the remove icon is 4.5:1 or better on the card (was 2.6:1) and a 44px target', p.remove.ratio >= 4.5 && p.remove.w >= 44 && p.remove.h >= 44, `${c}: ${f1(p.remove.ratio)}:1 ${p.remove.w}x${p.remove.h}`)
      rec('page: the stepper and remove ask the browser for no double-tap zoom (touch-action: manipulation)', p.remove.ta === 'manipulation' && p.stepper.every((s) => s.ta === 'manipulation'), `${c}: ${p.remove.ta}`)
      rec('page: every button of every line is 44 x 44 or more', p.targets.every((t) => t >= 43.5), `${c}: ${Math.min(...p.targets)}`)
      rec('page: the call to action is 16px / 800, 48px tall, near-black on the bright orange (4.5:1)', near(p.cta.fs / p.rem, 1, 0.01) && p.cta.fw === '800' && p.cta.h >= 48 && p.cta.ratio >= 4.5, `${c}: ${p.cta.fs}px ${p.cta.fw} ${f1(p.cta.h)}px ${f1(p.cta.ratio)}:1`)
      rec('page: the amount is the figure (20px+, 800) and its label is not heavier than it', p.amount.fs >= 20 && p.amount.fw === '800' && p.label.fs <= p.amount.fs && (bar ? p.label.fs >= 14 : near(p.label.fs / p.rem, 1, 0.01) && p.label.fw === '600'), `${c}: label ${p.label.fs}/${p.label.fw} amount ${p.amount.fs}/${p.amount.fw}`)
      rec('page: exactly ONE delivery-and-discount line is shown, with the right words (in the bar, under the button row; on a desktop, in the total)', (() => { const shown = [p.noteAside, p.noteTotal].filter((n) => n.content !== 'none' && n.display !== 'none'); return shown.length === 1 && shown[0].content === NOTE[lang] && shown[0].fs >= 14 && shown[0].ratio >= 4.5 && (bar ? p.noteAside.content === NOTE[lang] : p.noteTotal.content === NOTE[lang]) })(), `${c}: aside ${JSON.stringify(p.noteAside)} total ${JSON.stringify(p.noteTotal)}`)
      rec('page: the heading "Order summary" stays in the accessibility tree in the bar (1px, clipped, not display:none)', !bar || (p.sum.h2.display !== 'none' && p.sum.h2.vis === 'visible' && p.sum.h2.w <= 1 && p.sum.h2.h <= 1), `${c}: ${JSON.stringify(p.sum.h2)}`)
      rec('page: the order of the buttons in a line is unchanged', JSON.stringify(p.order) === JSON.stringify(b.order), `${c}: ${p.order}`)
      if (bar) {
        rec('page bar: the summary is a sticky bar at the bottom edge of the screen, full-bleed', p.sum.position === 'sticky' && near(p.s0.bar.b, p.vh, 1) && near(p.s0.bar.l, 0, 1) && near(p.s0.bar.r, p.vw, 1), `${c}: ${p.sum.position} bar ${f1(p.s0.bar.l)}..${f1(p.s0.bar.r)} bottom ${f1(p.s0.bar.b)} of ${p.vh}`)
        rec('page bar: at the top of a five-line bag the button is already on screen (before: below the fold)', p.s0.cta.b <= p.vh && p.s0.cta.t >= 0 && (b.s0.cta.b > b.vh), `${c}: button bottom ${f1(p.s0.cta.b)} of ${p.vh} (before ${f1(b.s0.cta.b)})`)
        rec('page bar: it stays a bar, not a block: 130px or less and a fifth of the screen at most', p.s0.bar.h <= 130 && p.s0.bar.h <= 0.2 * p.vh, `${c}: ${f1(p.s0.bar.h)}px of ${p.vh}`)
        rec('page bar: mid-page it rides the bottom edge and the lines scroll under it', near(p.sMid.bar.b, p.vh, 1) && p.sMid.lines.some((l) => l.b > p.sMid.bar.t + 4 && l.t < p.sMid.bar.t), `${c}: bar bottom ${f1(p.sMid.bar.b)}`)
        rec('page bar: at the end of the page it rests below the last line and above the footer (nothing hidden under it)', p.sEnd.last.b <= p.sEnd.bar.t + 0.5 && (!p.sEnd.footer || p.sEnd.bar.b <= p.sEnd.footer.t + 0.5), `${c}: last line bottom ${f1(p.sEnd.last.b)} bar ${f1(p.sEnd.bar.t)}..${f1(p.sEnd.bar.b)} footer ${p.sEnd.footer ? f1(p.sEnd.footer.t) : '-'}`)
        rec('page bar: the home-indicator inset (--sa-bottom) is added below the button (34px: the bar grows by 34px and the button stays 12px clear of it)', near(p.safe.barPadB - p.barPadB0, 34, 0.5) && p.safe.ctaBottom <= p.vh - 34 - 11, `${c}: padding ${f1(p.barPadB0)} -> ${f1(p.safe.barPadB)}, button bottom ${f1(p.safe.ctaBottom)} of ${p.vh}`)
        rec('page bar: the payment line, the quick-checkout hint and "back to shop" wait for the page proper (hidden here)', p.assur.display === 'none' && p.cont.display === 'none', `${c}: ${p.assur.display}/${p.cont.display}`)
        rec('page bar: the total reads label over amount', p.totalCol.dir === 'column', `${c}: ${p.totalCol.dir}`)
      } else {
        rec('page desktop: the summary is sticky and parks below the header (9.5rem), not under it', p.sum.position === 'sticky' && near(parseFloat(p.sum.topPx), 9.5 * p.rem, 0.5) && p.sDesk.bar.t >= p.sDesk.header.b - 0.5 && p.sDesk.bar.t <= p.sDesk.header.b + 20, `${c}: top ${p.sum.topPx} bar top ${f1(p.sDesk.bar.t)} header bottom ${f1(p.sDesk.header.b)}`)
        rec('page desktop: the payment line and "back to shop" are shown at 14px, the link a 44px target, 4.5:1', p.assur.display !== 'none' && near(p.assur.fs / p.rem, 0.875, 0.01) && p.cont.display !== 'none' && near(p.cont.fs / p.rem, 0.875, 0.01) && p.cont.h >= 44 && p.assur.ratio >= 4.5 && p.cont.ratio >= 4.5, `${c}: ${JSON.stringify([p.assur, p.cont])}`)
        rec('page desktop: a hairline and 12px each side separate the heading from the total', p.totalBorder === 1, `${c}: border ${p.totalBorder}`)
      }
    }
    for (const [w] of DRAWER_VIEWS) {
      const d = D[key(lang, w)], b = B.D[key(lang, w)], c = `${lang} ${w}px`
      rec('drawer: no sideways overflow', d.docW <= d.vw && d.asideOver <= 1 && d.l0.over <= 1 && d.l1.over <= 1, `${c}: ${d.docW}/${d.vw} aside ${d.asideOver} lines ${d.l0.over}/${d.l1.over}`)
      rec('drawer: a closed drawer casts no shadow (class pointer-events-none, or inert); an open one still does', d.shadowClosedClass === 'none' && d.shadowInert === 'none' && d.shadowOpen !== 'none' && d.shadowOpenAgain !== 'none', `${c}: closed ${d.shadowClosedClass.slice(0, 30)} inert ${d.shadowInert.slice(0, 30)} open ${d.shadowOpen.slice(0, 30)}`)
      rec('drawer: a line is shorter than before (20px or more; 5px at 320px where the price wraps): the total no longer has a row of its own', d.l0.h <= b.l0.h - (w <= 320 ? 5 : 20), `${c}: ${f1(d.l0.h)}px (before ${f1(b.l0.h)}px)`)
      rec('drawer: the line total ends the price row (same row, end edge), the stepper starts under the name, remove ends the last row', d.l0.totalEnd <= 1 && d.l0.removeEnd <= 1 && d.l0.stepStart <= 1 && d.l0.totalDy <= 8 && d.l0.ctlDy <= 2 && d.l0.rowsOrdered && d.l1.totalEnd <= 1 && d.l1.removeEnd <= 1, `${c}: total ${f1(d.l0.totalEnd)} remove ${f1(d.l0.removeEnd)} stepper ${f1(d.l0.stepStart)} dy ${f1(d.l0.totalDy)}/${f1(d.l0.ctlDy)} ordered ${d.l0.rowsOrdered}`)
      rec('drawer: the photo keeps 72px and starts level with the name', near(d.l0.imgW, 4.5 * d.rem, 1) && d.l0.imgTop <= 1.5, `${c}: ${f1(d.l0.imgW)}px, ${f1(d.l0.imgTop)}px off`)
      rec('drawer: the price and the line total never overlap', !d.l0.overlap && !d.l1.overlap, c)
      rec('drawer: every button is 44 x 44 or more', [...d.l0.btns, ...d.l1.btns].every((t) => t >= 43.5), `${c}: ${Math.min(...d.l0.btns, ...d.l1.btns)}`)
      rec('drawer: the stepper and remove ask for no double-tap zoom (touch-action: manipulation)', d.l0.ta.every((t) => t === 'manipulation'), `${c}: ${d.l0.ta}`)
      rec('drawer: a disabled "+" says why (accent, 4.5:1, 14px), an enabled one says nothing, and it follows the attribute', d.hintOn.content === MAX[lang] && d.hintOn.ratio >= 4.5 && d.hintOn.fs >= 14 && d.hintOff.content === 'none' && d.hintOnWhenEnabled === 'none', `${c}: ${JSON.stringify(d.hintOn)} / ${d.hintOff.content} / ${d.hintOnWhenEnabled}`)
      rec('drawer: the footer says what the total leaves out (right words, 14px, 4.5:1)', d.note.content === NOTE[lang] && near(d.note.fs / d.rem, 0.875, 0.01) && d.note.ratio >= 4.5, `${c}: ${JSON.stringify(d.note)}`)
      rec('drawer: the payment line and "back to shop" are 14px / 4.5:1 or better (was 4.4:1), the link a 44px target', near(d.assur.fs / d.rem, 0.875, 0.01) && d.assur.ratio >= 4.5 && d.back.ratio >= 4.5 && d.back.h >= 44, `${c}: ${JSON.stringify([d.assur, d.back])}`)
      rec('drawer: the button is 16px / 800 and at least 48px tall', near(d.cta.fs / d.rem, 1, 0.01) && d.cta.fw === '800' && d.cta.h >= 47.5, `${c}: ${d.cta.fs}px ${d.cta.fw} ${f1(d.cta.h)}px`)
      const pad = (rows, side, v2) => rows.every((x) => near(x[side], v2, 0.6))
      const base = (w <= 379 ? 1 : 1.5) * d.rem
      rec('drawer: no inset, the content keeps its 1.5rem (1rem under 380px) margins', pad(d.pad0, 'l', base) && pad(d.pad0, 'r', base), `${c}: ${JSON.stringify(d.pad0)}`)
      const [sideA, sideB] = lang === 'ar' ? ['l', 'r'] : ['r', 'l']
      // --sa-left 47px: in Arabic the physical LEFT is the end edge... the rule maps the inset onto the side it names, in either direction
      rec('drawer: a notch on the left pushes the content in on the left, one on the right on the right (Arabic and English)', pad(d.padL, 'l', 47) && pad(d.padL, 'r', base) && pad(d.padR, 'r', 47) && pad(d.padR, 'l', base), `${c}: left ${JSON.stringify(d.padL)} right ${JSON.stringify(d.padR)}`)
      void sideA; void sideB
    }
    {
      const d = L[lang], b = B.D[key(lang, 390)], c = `${lang} 844x390 landscape`
      rec('drawer landscape: the small print waits (note, payment line, back link hidden), the footer is 130px or less', d.note.display === 'none' || d.footer.h <= 130, c)
      rec('drawer landscape: the footer is at most 130px and the list gets at least 60px more than before', d.footer.h <= 130 && d.ul.clientH >= ML.before[lang].ul.clientH + 60, `${c}: footer ${f1(d.footer.h)}px, list ${f1(d.ul.clientH)}px (before ${f1(ML.before[lang].ul.clientH)}px)`)
      rec('drawer landscape: the total and the button are still there (button 48px)', d.cta.h >= 47.5 && d.footer.b <= d.vh + 0.5, `${c}: ${f1(d.cta.h)}px`)
      void b
    }
  }
}
const CASES = {}  // name -> { v -> { ok, bad: [detail] } }
const recorder = (v) => (name, ok, detail) => { const e = ((CASES[name] ||= {})[v] ||= { n: 0, bad: [] }); e.n++; if (!ok) e.bad.push(detail) }
for (const v of ORDER) checksFor(v, recorder(v))
const NAMES = Object.keys(CASES)

head('A1  the bag PAGE and the bag DRAWER on the live markup (Arabic and English, 320-1280px)')
for (const name of NAMES) {
  const e = CASES[name].after
  is(e.bad.length === 0, `${name} (${e.n} cases)`, e.bad.slice(0, 3).join(' | ') + (e.bad.length > 3 ? ` | +${e.bad.length - 3} more` : ''))
}
{
  // the numbers, before -> after (UX section cut -> shipped)
  const g = (V, M, k, f) => f(M[V][k])
  const rows = []
  for (const lang of LANGS) for (const w of [360, 390]) {
    const pb = MP.before[key(lang, w)], pa = MP.after[key(lang, w)], db = MD.before[key(lang, w)], da = MD.after[key(lang, w)]
    rows.push(`${lang} ${w}px  page: button bottom ${f1(pb.s0.cta.b)} -> ${f1(pa.s0.cta.b)} of ${pa.vh}px, bar ${f1(pa.s0.bar.h)}px   drawer: line ${f1(db.l0.h)} -> ${f1(da.l0.h)}px, footer ${f1(db.footer.h)} -> ${f1(da.footer.h)}px, list ${f1(db.ul.clientH)} -> ${f1(da.ul.clientH)}px`)
  }
  void g
  note('before -> after (UX section cut -> shipped), five-line bag on the page, three-line bag in the drawer:')
  rows.forEach((r) => note(r))
}
flush()

// ============================================================================================================ A2 the script on the live markup
head('A2  the accessibility script on the live markup (public/sporta-footer-call.js, second block)')
{
  const run = async (lang, js, drawer) => {
    ref.script = js
    const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg = await ctx.newPage()
    const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
    await pg.goto(`${base}/__fx/${drawer ? 'drawer' : 'cart'}-${lang}?js=1`, { waitUntil: 'load' }); await pg.waitForTimeout(150)
    return { pg, ctx, errs }
  }
  const STATE = (drawer) => {
    const lines = [...document.querySelectorAll(drawer ? '.campaign-cart-drawer .cart-drawer__line' : '.purchase-cart .cart-line')]
    return {
      n: lines.length,
      own: lines.map((l) => { const nm = l.querySelector('h3, p.font-bold'); return { id: nm && nm.id, buttons: [...l.querySelectorAll('button')].map((b) => b.getAttribute('aria-describedby')), labels: [...l.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')), qty: [...l.querySelectorAll('.purchase-quantity > span')].map((s) => s.getAttribute('aria-live') + '/' + s.getAttribute('aria-atomic')) } }),
      total: [...document.querySelectorAll('.purchase-cart__summary .purchase-total > span:last-child, .campaign-cart-drawer > footer > div:first-child > span:last-child')].map((s) => s.getAttribute('aria-live')),
      active: document.activeElement && document.activeElement.tagName + '.' + (document.activeElement.textContent || '').trim().slice(0, 24),
      status: [...document.querySelectorAll('#sporta-bag-status')].map((s) => s.textContent),
      scrollY: scrollY,
    }
  }
  for (const lang of LANGS) for (const drawer of [false, true]) {
    const c = `${drawer ? 'drawer' : 'page'} ${lang}`
    const { pg, ctx, errs } = await run(lang, JS, drawer)
    const s0 = await pg.evaluate(STATE, drawer)
    const ids = s0.own.map((o) => o.id)
    is(s0.n >= 2 && ids.every((i) => /^sporta-bag-n\d+$/.test(i || '')) && new Set(ids).size === ids.length, `${c}: every line's name gets its own id`, JSON.stringify(ids))
    is(s0.own.every((o) => o.buttons.length === 3 && o.buttons.every((b) => b === o.id)), `${c}: all three buttons of a line are described by THAT line's name, never another's`, JSON.stringify(s0.own.map((o) => o.buttons)))
    is(s0.own.every((o) => o.labels.every((l) => l && l.length > 1)) && s0.own.every((o, i) => o.labels.join() === s0.own[0].labels.join()), `${c}: the bundle's own aria-labels are untouched (same words on every line, as built)`, JSON.stringify(s0.own[0].labels))
    is(s0.own.every((o) => o.qty.every((q) => q === 'polite/true')) && s0.total.length >= 1 && s0.total.every((t) => t === 'polite'), `${c}: the quantity and the subtotal are polite live regions`, JSON.stringify([s0.own[0].qty, s0.total]))
    // a bag that the app re-renders (a node replaced, a line added) is described again, and the work is idempotent
    await pg.evaluate((drawer) => {
      const sel = drawer ? '.campaign-cart-drawer .cart-drawer__line' : '.purchase-cart .cart-line'
      const first = document.querySelector(sel); const c2 = first.cloneNode(true); c2.querySelector('h3, p.font-bold').removeAttribute('id'); c2.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-describedby')); first.parentNode.appendChild(c2)
    }, drawer)
    await pg.waitForTimeout(200)
    const s1 = await pg.evaluate(STATE, drawer)
    const ids1 = s1.own.map((o) => o.id)
    is(s1.n === s0.n + 1 && s1.own.slice(0, s0.n).every((o, i) => o.id === ids[i]) && new Set(ids1).size === ids1.length && s1.own.every((o) => o.buttons.every((b) => b === o.id)), `${c}: a line the app adds later is described too, and existing ids do not change (idempotent)`, JSON.stringify(ids1))
    // evaluating the file twice is the same as once
    await pg.evaluate(JS)
    const s2 = await pg.evaluate(STATE, drawer)
    is(JSON.stringify(s2.own.map((o) => o.id)) === JSON.stringify(ids1), `${c}: evaluating the file again changes nothing`, '')
    // a tap on the stepper moves no focus and says nothing
    const stepBtn = pg.locator(drawer ? '.cart-drawer__line .purchase-quantity button' : '.cart-line .purchase-quantity button').first()
    await stepBtn.focus(); await stepBtn.click(); await pg.waitForTimeout(200)
    const sStep = await pg.evaluate(STATE, drawer)
    is(sStep.status.length === 0 && /^BUTTON/.test(sStep.active), `${c}: the stepper's buttons are not removals: focus stays, no message`, JSON.stringify([sStep.active, sStep.status]))
    // removal: stand in for the bundle (it deletes the line when its own handler runs, after the add-on's capturing listener)
    await pg.evaluate((drawer) => {
      window.__sc = drawer ? 0 : 0
      document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); const l = b && b.closest('.cart-line, .cart-drawer__line'); if (l && [...l.querySelectorAll('button')].pop() === b) l.remove() })
      if (!drawer) { scrollTo(0, 120); window.__y = scrollY }
    }, drawer)
    const rmBtn = pg.locator(drawer ? '.cart-drawer__remove' : '.cart-line__controls > button:last-child').nth(1)
    const removedName = await pg.evaluate((drawer) => document.querySelectorAll(drawer ? '.cart-drawer__line' : '.cart-line')[1].querySelector('h3, p.font-bold').textContent.trim(), drawer)
    const y0 = await pg.evaluate(() => scrollY)
    await rmBtn.focus(); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300)
    const sR = await pg.evaluate(STATE, drawer)
    const headingSel = drawer ? 'h2' : 'H1'
    is(sR.n === s1.n - 1 && new RegExp('^' + headingSel, 'i').test(sR.active || ''), `${c}: after a removal focus goes to the bag's heading, not to the document`, sR.active)
    is(near(sR.scrollY, y0, 1), `${c}: the page does not jump (scroll ${f1(y0)} -> ${f1(sR.scrollY)})`, '')
    is(sR.status.length === 1 && sR.status[0] === REMOVED[lang](removedName), `${c}: one hidden polite message says what was removed, in the page's language`, JSON.stringify(sR.status))
    const status = await pg.evaluate(() => { const e = document.getElementById('sporta-bag-status'); const r = e.getBoundingClientRect(); return { role: e.getAttribute('role'), live: e.getAttribute('aria-live'), w: r.width, h: r.height, parent: e.parentElement.tagName } })
    is(status.role === 'status' && status.live === 'polite' && status.w <= 1 && status.h <= 1 && status.parent === 'BODY', `${c}: the message node is a 1px polite status under <body>`, JSON.stringify(status))
    await rmBtn.focus().catch(() => {}); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300)
    const sR2 = await pg.evaluate(STATE, drawer)
    is(sR2.status.length === 1, `${c}: a second removal reuses the one message node`, JSON.stringify(sR2.status))
    is(errs.length === 0, `${c}: no script error`, errs.join(' | '))
    await ctx.close()
  }
  // a removal that did not remove anything leaves focus alone; a missing heading does not throw
  for (const lang of ['en']) {
    const { pg, ctx, errs } = await run(lang, JS, false)
    const btn = pg.locator('.cart-line__controls > button:last-child').first()
    await btn.focus(); await btn.click(); await pg.waitForTimeout(200)
    const s = await pg.evaluate(STATE, false)
    is(/^BUTTON/.test(s.active) && s.status.length === 0 && s.n >= 2, `page ${lang}: a remove tap that removed nothing leaves focus and the page alone`, JSON.stringify([s.active, s.status]))
    await pg.evaluate(() => { document.addEventListener('click', (e) => { const b = e.target.closest('button'); const l = b && b.closest('.cart-line'); if (l && [...l.querySelectorAll('button')].pop() === b) { l.remove(); document.querySelectorAll('.purchase-heading h1, .purchase-empty h1').forEach((h) => h.remove()) } }) })
    await btn.focus(); await btn.click(); await pg.waitForTimeout(300)
    is(errs.length === 0, `page ${lang}: a removal with no heading on the page throws nothing`, errs.join(' | '))
    await ctx.close()
  }
  // the script block: no storage, no network, no events, no values, no markup injection
  const block = jsOf(JS).block
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  is(block.length > 1500 && JS.split(JS_MARK).length === 2, 'the script block exists once, after the footer-call block')
  is(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|dispatchEvent|\.value\s*=|innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|\.remove\(|removeChild|replaceChild|insertBefore|\.click\(\)|\.submit\(/.test(code), 'the script block touches no storage, no network, no event, no field value, injects no markup, removes and moves no node')
  is(/appendChild/.test(code) && code.match(/appendChild/g).length === 1 && /createElement\('div'\)/.test(code), 'the one node it adds is the hidden status div (one appendChild, to <body>)')
  is(/^\s*;\(function/m.test(block) && /window\.__sportaBagA11y/.test(block), 'it starts with a semicolon (the block above ends in a call) and guards against a second evaluation')
  is((code.match(/catch \(err\)/g) || []).length >= 5 && /childList: true, subtree: true/.test(code) && !/attributes: true|characterData/.test(code), 'every entry point is wrapped in try/catch; the observer watches childList only, so its own attribute writes cannot wake it')
  is(jsOf(JS).before === JS_WITHOUT && /sporta-footer-call/.test(JS_WITHOUT) && /\}\)\(\)\s*$/.test(JS_WITHOUT.trimEnd() + '\n'), 'the footer-call block above it is unchanged in shape (ends with its own call)')
}
flush()

// ============================================================================================================ A3 touch and hover
head('A3  touch: nothing stays lifted or tinted after a tap; a mouse still gets the bundle\'s hover')
{
  for (const lang of LANGS) {
    for (const [name, opts, w, h] of [['phone (touch)', { hasTouch: true, isMobile: true }, 390, 844], ['desktop (mouse)', {}, 1280, 800]]) {
      const touch = !!opts.hasTouch
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', ...opts })
      const pg = await ctx.newPage()
      await pg.goto(`${base}/__fx/cart-${lang}`, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready); await pg.evaluate(INSTALL); await pg.evaluate(NORMALISE_PAGE, lang)
      const media = await pg.evaluate(() => matchMedia('(hover: none)').matches)
      const measure = async (v) => {
        await applyVariant(pg, v)
        await pg.mouse.move(1, 1)
        const rest = await pg.evaluate(() => { const l = document.querySelector('.cart-line'); const b = l.querySelector('.purchase-quantity button'); const c = getComputedStyle(l); const cb = getComputedStyle(b); return { transform: c.transform, border: c.borderTopColor, shadow: c.boxShadow, bg: cb.backgroundColor } })
        await pg.hover('.cart-line:first-child .purchase-quantity button:first-child')
        const hov = await pg.evaluate(() => { const l = document.querySelector('.cart-line'); const b = l.querySelector('.purchase-quantity button'); const c = getComputedStyle(l); const cb = getComputedStyle(b); const a = (s) => { const m = s.match(/[\d.]+/g); return m && m.length > 3 ? +m[3] : s === 'transparent' ? 0 : 1 }; return { transform: c.transform, border: c.borderTopColor, shadow: c.boxShadow, bgAlpha: a(cb.backgroundColor), bg: cb.backgroundColor } })
        await pg.mouse.down()
        const act = await pg.evaluate(() => { const b = document.querySelector('.cart-line .purchase-quantity button'); const cb = getComputedStyle(b); const m = cb.backgroundColor.match(/[\d.]+/g); return { bgAlpha: m && m.length > 3 ? +m[3] : cb.backgroundColor === 'transparent' ? 0 : 1, bg: cb.backgroundColor } })
        await pg.mouse.up(); await pg.mouse.move(1, 1)
        return { rest, hov, act }
      }
      const after = await measure('after'), before = await measure('before')
      const c = `${lang} ${name}`
      is(media === touch, `${c}: the browser reports (hover: none) = ${touch}`, String(media))
      if (touch) {
        is(after.hov.transform === 'none' && after.hov.border === after.rest.border && after.hov.shadow === after.rest.shadow, `${c}: a hovered (just tapped) line does not lift, change its border or its shadow`, JSON.stringify(after.hov))
        is(before.hov.transform !== 'none', `${c}: ...and it did lift before (the bundle's translateY(-1px))`, JSON.stringify(before.hov))
        is(after.hov.bgAlpha === 0, `${c}: a hovered stepper button has no tint left behind`, JSON.stringify(after.hov))
        is(before.hov.bgAlpha > 0, `${c}: ...and it kept one before`, JSON.stringify(before.hov))
      } else {
        is(after.hov.transform !== 'none' && after.hov.transform === before.hov.transform, `${c}: with a mouse the bundle's lift is untouched`, JSON.stringify(after.hov))
        is(after.hov.bgAlpha > 0 && after.hov.bg === before.hov.bg, `${c}: with a mouse the stepper's hover tint is untouched`, JSON.stringify(after.hov))
      }
      is(after.act.bgAlpha >= 0.15 && after.act.bgAlpha <= 0.17 && before.act.bgAlpha < 0.15, `${c}: a press (:active) tints the button 16% in the brand colour (before: ${before.act.bgAlpha})`, JSON.stringify(after.act))
      await ctx.close()
    }
  }
  // the drawer
  for (const lang of LANGS) {
    for (const [name, opts, w, h] of [['phone (touch)', { hasTouch: true, isMobile: true }, 390, 844], ['desktop (mouse)', {}, 1280, 800]]) {
      const touch = !!opts.hasTouch
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', ...opts })
      const pg = await ctx.newPage()
      await pg.goto(`${base}/__fx/drawer-${lang}`, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
      const m = async (v) => {
        await applyVariant(pg, v); await pg.mouse.move(1, 1)
        await pg.hover('.cart-drawer__line .purchase-quantity button:first-child')
        const hov = await pg.evaluate(() => { const b = document.querySelector('.cart-drawer__line .purchase-quantity button'); const x = getComputedStyle(b).backgroundColor.match(/[\d.]+/g); return x && x.length > 3 ? +x[3] : getComputedStyle(b).backgroundColor === 'transparent' ? 0 : 1 })
        await pg.mouse.down()
        const act = await pg.evaluate(() => { const x = getComputedStyle(document.querySelector('.cart-drawer__line .purchase-quantity button')).backgroundColor.match(/[\d.]+/g); return x && x.length > 3 ? +x[3] : 0 })
        await pg.mouse.up(); await pg.mouse.move(1, 1)
        return { hov, act }
      }
      const a = await m('after'), b = await m('before'), c = `drawer ${lang} ${name}`
      if (touch) is(a.hov === 0 && b.hov > 0, `${c}: a tapped stepper button keeps no tint (before: ${b.hov})`, JSON.stringify(a))
      else is(a.hov > 0 && a.hov === b.hov, `${c}: with a mouse the hover tint is untouched`, JSON.stringify(a))
      is(a.act >= 0.15 && a.act <= 0.17 && b.act < 0.15, `${c}: a press tints the button 16% in the brand colour`, JSON.stringify(a))
      await ctx.close()
    }
  }
}
flush()

// ============================================================================================================ A4 dark theme, reduced motion
head('A4  the dark theme follows the tokens; reduced motion; no motion of its own')
{
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', reducedMotion: 'reduce' })
    const pg = await ctx.newPage()
    await pg.goto(`${base}/__fx/cart-${lang}`, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready); await pg.evaluate(INSTALL); await pg.evaluate(NORMALISE_PAGE, lang)
    await pg.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
    const d = await pg.evaluate(() => {
      const h = window.__h, s = h.$('.purchase-cart__summary'), l1 = h.$$('.purchase-cart .cart-line')[1], info = l1.querySelector(':scope > div:not(.cart-line__controls)')
      const hint = h.pseudo(info.lastElementChild), note = h.pseudo(s), lab = h.$('.purchase-total > span', s)
      const bg = h.bgOf(s); const rm = l1.querySelector('.cart-line__controls > button:last-child')
      const td = (e) => getComputedStyle(e).transitionDuration + '|' + getComputedStyle(e).animationName
      return { barLum: (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255, hint, note, label: h.contrast(lab), remove: h.contrast(rm), td: [td(s), td(rm), td(s.querySelector('a.btn-primary')), td(h.$('.purchase-quantity button', l1))], pos: getComputedStyle(s).position, bottom: h.R(s).b, vh: innerHeight }
    })
    is(d.barLum < 0.2, `page ${lang}: in the dark theme the bar is dark (it takes --surface, not a colour of its own)`, f1(d.barLum))
    is(d.hint.ratio >= 4.5 && d.note.ratio >= 4.5 && d.label >= 4.5 && d.remove >= 3, `page ${lang}: in the dark theme the hint, the note and the label are 4.5:1 or better, the remove icon 3:1`, JSON.stringify([d.hint.ratio, d.note.ratio, d.label, d.remove]))
    is(d.pos === 'sticky' && near(d.bottom, d.vh, 1), `page ${lang}: reduced motion changes nothing about the bar (still sticky at the bottom edge)`, `${d.pos} ${d.bottom}`)
    is(d.td.every((x) => /^0s\|none$/.test(x) || /^0s\|/.test(x)), `page ${lang}: with reduced motion the bar, the button and the stepper animate nothing`, JSON.stringify(d.td))
    await ctx.close()
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg2 = await ctx2.newPage()
    await pg2.goto(`${base}/__fx/drawer-${lang}`, { waitUntil: 'load' }); await pg2.evaluate(() => document.fonts.ready); await pg2.evaluate(INSTALL); await pg2.evaluate(NORMALISE_DRAWER)
    await pg2.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
    const dd = await pg2.evaluate(() => {
      const h = window.__h, aside = h.$('.campaign-cart-drawer'), f = h.$(':scope > footer', aside), li = h.$$(':scope > ul > li', aside)[1]
      const hint = h.pseudo(h.$(':scope > div > p:nth-child(2)', li)), note = h.pseudo(h.$(':scope > div:first-child', f)), as = h.$(':scope > p', f), back = h.$(':scope > a[href="/shop"]', f)
      return { hint: hint.ratio, note: note.ratio, as: h.contrast(as), back: h.contrast(back) }
    })
    is(dd.hint >= 4.5 && dd.note >= 4.5 && dd.as >= 4.5 && dd.back >= 4.5, `drawer ${lang}: in the dark theme the hint, the note, the payment line and the back link are 4.5:1 or better`, JSON.stringify(dd))
    await ctx2.close()
  }
}
flush()

// ============================================================================================================ C static
head('C  static: where the sections are, what they may contain')
{
  for (const [f, spec] of Object.entries(MY_FILES)) {
    const raw = FILES[f], { before, ux, after } = SECTIONS[f]
    is(raw.split(spec.start).length === 2 && ux.length > 3000, `${f}: one UX section (${ux.length} chars)`, String(raw.split(spec.start).length - 1))
    is(after.startsWith(spec.next) && raw.endsWith(after) && raw.split(spec.next).length === 2, `${f}: the other lane's section ("${spec.next.slice(7)}...") is still ONE section and the last thing in the file`, after.slice(0, 40))
    is(!before.includes('SIZES') || f === 'sporta-bag-touch.css', `${f}: nothing before the UX section names the other lane's section`, '')
    is(!ux.includes('SIZES') && !ux.includes('HEADER AND MENU LAYOUT'), `${f}: the UX section does not contain the other lanes' marker words (their suites cut the file at them)`, '')
    const ids = blocksOf(f, ux).map((b) => b.id)
    const want = ['preamble', ...[1, 2, 3, 4, 5, 6, 7].map((n) => `${spec.prefix}-${n}`)]
    is(JSON.stringify(ids) === JSON.stringify(want), `${f}: the blocks are ${want.join(', ')}`, ids.join(','))
    const code = ux.replace(/\/\*[\s\S]*?\*\//g, '')
    is(!/!important/.test(code), `${f}: no !important`)
    is(!/transition|animation|@keyframes|@import|url\(|expression\(|javascript:/.test(code), `${f}: no transition, animation, url() or import (reduced motion has nothing to switch off)`)
    const rules = [...code.matchAll(/(^|[};])\s*([^{};@]+)\{/g)].map((m) => m[2].trim()).filter(Boolean)
    const scope = f === 'sporta-bag-touch.css' ? /^(:where\(html:not\(\[data-theme="dark"\]\)\) )?(html\[dir="(rtl|ltr)"\] )?\.purchase-cart(__summary)?\b/ : /^(\[dir="rtl"\] )?\.campaign-cart-drawer\b/
    const bad = rules.flatMap((r) => r.split(/,\s*(?![^(]*\))/)).map((s) => s.trim()).filter((s) => !scope.test(s) && !/^(from|to|\d+%)$/.test(s))
    is(bad.length === 0, `${f}: every selector is scoped to ${f === 'sporta-bag-touch.css' ? '.purchase-cart' : '.campaign-cart-drawer'}`, bad.slice(0, 4).join(' | '))
    const ar = (ux.match(/--ux-(max|note): "[^"]*[؀-ۿ][^"]*"/g) || []).length, en = (ux.match(/:lang\(en\)\s*\{[^}]*--ux-max:[^}]*--ux-note:/g) || []).length
    is(ar === 2 && en === 1, `${f}: both languages for both lines of copy (Arabic default, :lang(en) override)`, `ar ${ar} en ${en}`)
    is(/Delivery fee and any discount are shown at checkout/.test(ux) && /Maximum available/.test(ux) && ux.includes(NOTE.ar) && ux.includes(MAX.ar), `${f}: the words are the ones this suite expects`)
  }
  const phys = SECTIONS['sporta-cart-drawer.css'].ux.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[;{\s])(margin|padding|border)-(left|right)\b|(^|[;{\s])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:/g)
  is(!phys, 'sporta-cart-drawer.css: the drawer section uses logical properties only', phys ? phys.join(',') : '')
  const physP = SECTIONS['sporta-bag-touch.css'].ux.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[;{\s])(margin|padding|border)-(left|right)\b|(^|[;{\s])(left|right)\s*:|float\s*:/g)
  is(!physP, 'sporta-bag-touch.css: the page section uses logical properties only, but for the two keyed text-align rules (the one physical thing, with its reason in the comment)', physP ? physP.join(',') : '')
  const ta = SECTIONS['sporta-bag-touch.css'].ux.replace(/\/\*[\s\S]*?\*\//g, '').match(/text-align\s*:\s*(left|right)/g) || []
  is(ta.length === 2 && /html\[dir="rtl"\][^{]*\{\s*text-align: right;/.test(SECTIONS['sporta-bag-touch.css'].ux) && /html\[dir="ltr"\][^{]*\{\s*text-align: left;/.test(SECTIONS['sporta-bag-touch.css'].ux), 'sporta-bag-touch.css: exactly those two physical text-align rules exist, each keyed on the html dir', String(ta.length))
  const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'))
  is(pkg.scripts['test:cart-ux'] === 'node scripts/cart-ux-test.mjs', 'package.json has the test:cart-ux script')
  const colours = SECTIONS['sporta-cart-drawer.css'].ux.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)
  is(!colours, 'sporta-cart-drawer.css: the drawer section hard-codes no colour (tokens only: dark theme follows)', colours ? colours.join(',') : '')
  const colP = SECTIONS['sporta-bag-touch.css'].ux.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []
  is(colP.length === 3 && colP.includes('#be123c'), 'sporta-bag-touch.css: the page section hard-codes three colours at most: rose-700 for hover (light theme only) and the two shadow tints, nothing else', colP.join(','))
  is(!/@media[^{]*prefers-color-scheme/.test(SECTIONS['sporta-bag-touch.css'].ux + SECTIONS['sporta-cart-drawer.css'].ux), 'neither section is keyed on the device\'s colour scheme (the shop\'s own data-theme decides)')
}
flush()

// ============================================================================================================ B real app
const REAL = liveDir() && !process.env.CART_UX_SKIP_REAL
const FAIL_BEFORE_REAL = fail
let realMutantReport = []
if (!REAL) {
  head('B  the real app')
  note(process.env.CART_UX_SKIP_REAL ? 'skipped (CART_UX_SKIP_REAL=1)' : 'skipped: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); layer A above ran in full')
  flush()
}
if (REAL) {
  const FOOT = 'sporta-footer-call.js'
  const VAR = {
    with: {},
    without: { css: Object.fromEntries(Object.keys(MY_FILES).map((f) => [f, without(f, FILES[f], 'all')])), js: { [FOOT]: JS_WITHOUT } },
    cssOnly: { js: { [FOOT]: JS_WITHOUT } },
    jsOnly: { css: Object.fromEntries(Object.keys(MY_FILES).map((f) => [f, without(f, FILES[f], 'all')])) },
    throws: { js: { [FOOT]: JS_WITHOUT + "\n;throw new Error('sporta-bag boom')\n" } },
    blocked: { js: { [FOOT]: '' } },
  }
  const MORE = [bagLine('flash-shorts-green', 'XL', 'Flash Shorts — Green', 'شورت فلاش — أخضر', 3, 3), bagLine('naples-sports-bra-pink', 'S', 'Naples Sports Bra — Pink', 'برا رياضية نابولي — وردي', 5, 1)]
  const orders = []
  const onPost = (q, r, u) => {
    let body = ''; q.on('data', (c) => (body += c))
    q.on('end', () => {
      orders.push({ route: u.searchParams.get('r'), body })
      r.writeHead(200, { 'content-type': 'application/json' })
      const j = JSON.parse(body || '{}')
      if (u.searchParams.get('r') === 'discount') return r.end(JSON.stringify({ subtotal: 33, delivery: 1, total: 34, total_fils: 34000, discount: 0, lines: [], applied: [] }))
      r.end(JSON.stringify({ track_id: j.track_id, amount: 34, order_id: 1 }))
    })
  }
  const SEED = () => {
    let s = 123456789; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    Math.random = rnd
    const g = crypto.getRandomValues.bind(crypto); void g
    crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 256); return a }
    if (crypto.randomUUID) crypto.randomUUID = () => Array.from({ length: 36 }, (_, i) => (i === 8 || i === 13 || i === 18 || i === 23 ? '-' : Math.floor(rnd() * 16).toString(16))).join('')
    const t0 = 1762000000000; let n = 0; Date.now = () => t0 + (n++)
  }
  const servers = {}
  const srv = async (name) => (servers[name] ||= await serveLive({ ...VAR[name], onPost }))
  const open = async (name, { lang = 'ar', w = 390, h = 844, cart = BAG, touch = w < 800, dark = false, reduced = false, seed = false } = {}) => {
    const s = await srv(name)
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await ctx.addInitScript(([c, d]) => { try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('sporta_cart', JSON.stringify(c)); sessionStorage.setItem('__seeded', '1'); if (d) { localStorage.setItem('sporta_theme', 'dark'); localStorage.setItem('sporta_theme_explicit', '1') } } } catch {} }, [cart, dark])
    if (seed) await ctx.addInitScript(SEED)
    const pg = await ctx.newPage()
    const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
    return { ctx, pg, errs, base: s.base }
  }
  const goCart = async (o) => { await o.pg.goto(`${o.base}/cart?lang=${o.lang || 'ar'}`, { waitUntil: 'load' }); await o.pg.waitForSelector('.cart-line', { timeout: 60000 }); await o.pg.evaluate(() => document.fonts.ready); await o.pg.waitForTimeout(500) }
  const openDrawer = async (o, lang) => { await o.pg.goto(`${o.base}/shop?lang=${lang}`, { waitUntil: 'load' }); await o.pg.waitForSelector('.app-header button.navbar-cart', { timeout: 60000 }); await o.pg.waitForTimeout(700); await o.pg.locator('.app-header button.navbar-cart').click(); await o.pg.waitForFunction(() => { const d = document.querySelector('.campaign-cart-drawer'); return d && !d.hasAttribute('inert') }); await o.pg.waitForTimeout(500) }

  // ---- B1 the real bag page ------------------------------------------------------------------------------------------
  head('B1  the real bag page (compiled client, live /api JSON, a bag stored as the app stores it)')
  const REALPAGE = () => {
    const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)]
    const rtl = document.documentElement.dir === 'rtl', vw = innerWidth, vh = innerHeight
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height, w: r.width } }
    const ink = (n) => { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return rtl ? b.right : b.left }
    const lines = $$('.cart-line'), s = $('.purchase-cart__summary'), cta = $('a.btn-primary', s), foot = $('footer.app-footer')
    const info = (l) => l.querySelector(':scope > div:not(.cart-line__controls)')
    const hint = (l) => { const c = getComputedStyle(info(l).lastElementChild, '::after').content; return c === 'none' || c === 'normal' ? '' : c.replace(/^"|"$/g, '') }
    const o = { vw, vh, lines: lines.length, docW: document.documentElement.scrollWidth, sizeGaps: lines.map((l) => Math.abs(ink(l.querySelector('p[dir="auto"]')) - (rtl ? R(info(l)).r : R(info(l)).l))), hints: lines.map((l) => [!!l.querySelector('.purchase-quantity > button:last-of-type').disabled, hint(l)]), pos: getComputedStyle(s).position, bar0: R(s), cta0: R(cta), sumLast: R(lines[lines.length - 1]) }
    const max = document.documentElement.scrollHeight - vh
    scrollTo(0, max); o.barEnd = R(s); o.lastEnd = R(lines[lines.length - 1]); o.footEnd = foot ? R(foot) : null
    scrollTo(0, 0); o.max = max
    return o
  }
  for (const lang of LANGS) for (const [w, h] of [[360, 640], [390, 844], [1280, 800]]) {
    const c = `${lang} ${w}x${h}`
    const run = async (name) => { const o = await open(name, { lang, w, h, cart: [...BAG, ...MORE] }); await goCart({ ...o, lang }); const r = await o.pg.evaluate(REALPAGE); await o.ctx.close(); return r }
    const a = await run('with'), b = await run('without')
    is(a.lines === 5 && a.docW <= a.vw, `real page ${c}: five lines, no sideways overflow`, JSON.stringify([a.lines, a.docW, a.vw]))
    is(a.sizeGaps.every((g) => g <= 1.5), `real page ${c}: every size label starts on its column's start edge`, a.sizeGaps.map(f1).join(','))
    if (lang === 'ar') is(b.sizeGaps.some((g) => g > 20), `real page ${c}: ...and without the add-on at least one sat far away (the bug is real: ${b.sizeGaps.map(f1).join(',')}px)`, '')
    is(a.hints.every(([dis, txt]) => (dis ? txt === MAX[lang] : txt === '')) && a.hints.some(([d]) => d) && a.hints.some(([d]) => !d), `real page ${c}: the hint shows on exactly the lines whose "+" the app disabled (stock): ${a.hints.map(([d]) => (d ? 1 : 0)).join('')}`, JSON.stringify(a.hints))
    if (w < 1024) {
      is(a.pos === 'sticky' && near(a.bar0.b, a.vh, 1) && a.cta0.b <= a.vh && a.cta0.t >= 0, `real page ${c}: the checkout button is on screen at the top of a five-line bag (button bottom ${f1(a.cta0.b)} of ${a.vh}; without: ${f1(b.cta0.b)})`, JSON.stringify([a.pos, a.bar0, a.cta0]))
      is(b.cta0.b > b.vh, `real page ${c}: ...and without the add-on it was below the fold`, f1(b.cta0.b))
      is(a.lastEnd.b <= a.barEnd.t + 0.5 && (!a.footEnd || a.barEnd.b <= a.footEnd.t + 0.5), `real page ${c}: at the end the bar rests under the last line and above the footer`, JSON.stringify([a.lastEnd.b, a.barEnd, a.footEnd && a.footEnd.t]))
    } else {
      is(a.pos === 'sticky', `real page ${c}: desktop summary stays sticky`, a.pos)
    }
  }

  // ---- B2 the real drawer --------------------------------------------------------------------------------------------
  head('B2  the real drawer: compact lines, the closed drawer\'s shadow, the keyboard order')
  const REALDRAWER = () => {
    const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)]
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height } }
    const d = $('.campaign-cart-drawer'), ul = $(':scope > ul', d), f = $(':scope > footer', d), lis = $$(':scope > li', ul)
    return { lines: lis.map((l) => R(l).h), ul: R(ul).h, footer: R(f).h, footerB: R(f).b, vh: innerHeight, open: !d.hasAttribute('inert'), ctaB: R($('a.btn-primary', f)).b, hints: lis.map((l) => { const c = getComputedStyle($(':scope > div > p:nth-child(2)', l), '::after').content; return c === 'none' || c === 'normal' ? '' : c.replace(/^"|"$/g, '') }), noteC: getComputedStyle($(':scope > div:first-child', f), '::after').content }
  }
  for (const lang of LANGS) for (const [w, h] of [[360, 740], [390, 844]]) {
    const c = `${lang} ${w}x${h}`
    const run = async (name) => { const o = await open(name, { lang, w, h }); await openDrawer(o, lang); const r = await o.pg.evaluate(REALDRAWER); await o.ctx.close(); return r }
    const a = await run('with'), b = await run('without')
    const noHint = a.lines.findIndex((_, i) => a.hints[i] === '')
    is(a.open && a.lines.length === 3 && noHint >= 0 && a.lines[noHint] <= b.lines[noHint] - 25, `real drawer ${c}: a line is ${f1(b.lines[noHint] - a.lines[noHint])}px shorter than before (${f1(b.lines[noHint])} -> ${f1(a.lines[noHint])}px)`, JSON.stringify([a.lines, b.lines]))
    is(a.hints.join('|') === ['', MAX[lang], ''].join('|') || a.hints.filter(Boolean).length === 2, `real drawer ${c}: the hint is on the lines the app stopped at the stock limit (${a.hints.map((x) => (x ? 1 : 0)).join('')})`, JSON.stringify(a.hints))
    is(a.footerB <= a.vh + 0.5 && a.ctaB <= a.vh, `real drawer ${c}: the footer and the button are on screen`, JSON.stringify([a.footerB, a.ctaB, a.vh]))
    note(`${c}: three lines took ${f1(b.lines.reduce((p, q) => p + q, 0))} -> ${f1(a.lines.reduce((p, q) => p + q, 0))}px; the list is ${f1(a.ul)}px of ${a.vh}px (footer ${f1(b.footer)} -> ${f1(a.footer)}px)`)
  }
  {
    // the closed drawer's shadow, in PIXELS: the strip at the page edge on the side the drawer is parked on
    const edge = async (name, lang, w, h) => {
      const o = await open(name, { lang, w, h, touch: false }); await goCart({ ...o, lang }); await o.pg.evaluate(() => scrollTo(0, 0))
      const clip = lang === 'ar' ? { x: 0, y: 330, width: 10, height: 240 } : { x: w - 10, y: 330, width: 10, height: 240 }
      const img = png(await o.pg.screenshot({ clip })); let min = 255
      for (let y = 0; y < img.h; y += 4) for (let x = 0; x < img.w; x++) { const p = img.at(x, y); min = Math.min(min, p.r, p.g, p.b) }
      await o.ctx.close(); return min
    }
    for (const lang of LANGS) {
      const a = await edge('with', lang, 1280, 800), b = await edge('without', lang, 1280, 800)
      is(a >= 252 && b < 250, `real page ${lang} 1280: the 10px strip at the ${lang === 'ar' ? 'left' : 'right'} edge is clean white with the add-on (darkest pixel ${a}) and was hazed without it (${b})`, '')
    }
  }
  {
    // keyboard order in the drawer is the same with and without the CSS (the layout moves boxes, not the DOM)
    const order = async (name, lang) => {
      const o = await open(name, { lang, w: 390, h: 844 }); await openDrawer(o, lang)
      const seq = []
      for (let i = 0; i < 14; i++) { await o.pg.keyboard.press('Tab'); seq.push(await o.pg.evaluate(() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 14) || e.tagName) : '-' })) }
      await o.ctx.close(); return seq.join(' > ')
    }
    for (const lang of LANGS) { const a = await order('with', lang), b = await order('without', lang); is(a === b && a.split(' > ').length === 14, `real drawer ${lang}: the keyboard walks the same controls in the same order with and without the add-on`, `${a} !== ${b}`) }
  }

  // ---- B3 the script in the real DOM ---------------------------------------------------------------------------------
  head('B3  the script in the real app: labels, live regions, focus after a removal, both languages')
  for (const lang of LANGS) {
    const o = await open('with', { lang, w: 390, h: 844 }); await goCart({ ...o, lang })
    const s = await o.pg.evaluate(() => [...document.querySelectorAll('.cart-line')].map((l) => { const nm = l.querySelector('h3'); return { id: nm.id, t: nm.textContent.trim(), d: [...l.querySelectorAll('button')].map((b) => b.getAttribute('aria-describedby')), live: l.querySelector('.purchase-quantity > span').getAttribute('aria-live') } }))
    is(s.length === 3 && s.every((x) => /^sporta-bag-n\d+$/.test(x.id) && x.d.length === 3 && x.d.every((d) => d === x.id) && x.live === 'polite') && new Set(s.map((x) => x.id)).size === 3, `real page ${lang}: each line's three buttons are described by that line's name; the quantity is a live region`, JSON.stringify(s.map((x) => [x.id, x.d])))
    // the stepper changes the stored bag exactly as it would without the add-on
    const y = await o.pg.evaluate(() => scrollTo(0, 150) || scrollY)
    const removedName = s[1].t
    await o.pg.locator('.cart-line').nth(1).locator('button').last().focus()
    await o.pg.keyboard.press('Enter'); await o.pg.waitForTimeout(500)
    const r = await o.pg.evaluate(() => ({ active: document.activeElement.tagName, h: document.activeElement.textContent.trim().slice(0, 12), status: document.getElementById('sporta-bag-status')?.textContent, lines: document.querySelectorAll('.cart-line').length, y: scrollY, count: document.querySelector('.purchase-count')?.textContent }))
    is(r.active === 'H1' && r.lines === 2 && near(r.y, y, 2), `real page ${lang}: removing a line with the keyboard puts focus on the bag's heading (${r.h}), two lines left, no scroll jump (${f1(y)} -> ${f1(r.y)})`, JSON.stringify(r))
    is(r.status === REMOVED[lang](removedName), `real page ${lang}: the hidden status message is "${r.status}"`, '')
    // remove the rest: empty state, focus on its heading
    await o.pg.locator('.cart-line').first().locator('button').last().focus(); await o.pg.keyboard.press('Enter'); await o.pg.waitForTimeout(400)
    await o.pg.locator('.cart-line').first().locator('button').last().focus(); await o.pg.keyboard.press('Enter'); await o.pg.waitForTimeout(500)
    const e = await o.pg.evaluate(() => ({ active: document.activeElement.tagName + ':' + document.activeElement.textContent.trim().slice(0, 12), empty: !!document.querySelector('.purchase-empty'), bag: localStorage.getItem('sporta_cart') }))
    is(e.empty && /^H1/.test(e.active) && e.bag === '[]', `real page ${lang}: removing the last line lands focus on the empty state's heading (${e.active}) and the stored bag is []`, JSON.stringify(e))
    await o.ctx.close()
    // the drawer, in place
    const d = await open('with', { lang, w: 390, h: 844 }); await openDrawer(d, lang)
    const nm = await d.pg.evaluate(() => document.querySelectorAll('.cart-drawer__line')[0].querySelector('p.font-bold').textContent.trim())
    await d.pg.locator('.cart-drawer__remove').first().focus(); await d.pg.keyboard.press('Enter'); await d.pg.waitForTimeout(500)
    const dr = await d.pg.evaluate(() => ({ active: document.activeElement.tagName, inDrawer: !!document.querySelector('.campaign-cart-drawer').contains(document.activeElement), status: document.getElementById('sporta-bag-status')?.textContent, lines: document.querySelectorAll('.cart-drawer__line').length }))
    is(dr.active === 'H2' && dr.inDrawer && dr.lines === 2 && dr.status === REMOVED[lang](nm), `real drawer ${lang}: after a removal focus is the drawer's own heading, inside the dialog, with the message "${dr.status}"`, JSON.stringify(dr))
    await d.pg.keyboard.press('Tab'); const nx = await d.pg.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim().slice(0, 12))
    is(!!nx && nx !== '-', `real drawer ${lang}: Tab from there carries on inside the drawer (${nx})`, '')
    await d.ctx.close()
  }
  {
    // switching language in place: the descriptions follow the (new) names, nothing breaks
    const o = await open('with', { lang: 'en', w: 390, h: 844 }); await goCart({ ...o, lang: 'en' })
    await o.pg.locator('.app-header button.navbar-language').click(); await o.pg.waitForTimeout(800)
    const s = await o.pg.evaluate(() => ({ lang: document.documentElement.lang, rows: [...document.querySelectorAll('.cart-line')].map((l) => { const nm = l.querySelector('h3'); return [nm.textContent.trim().slice(0, 14), nm.id, [...l.querySelectorAll('button')].every((b) => b.getAttribute('aria-describedby') === nm.id)] }) }))
    is(s.lang === 'ar' && s.rows.length === 3 && s.rows.every((r) => r[2]) && /[؀-ۿ]/.test(s.rows[0][0]), 'real page: switching the language in place keeps every button described by its own line\'s (now Arabic) name', JSON.stringify(s))
    await o.ctx.close()
  }

  // ---- B4 nothing the shopper submits changes ------------------------------------------------------------------------------
  head('B4  the order POST is BYTE-IDENTICAL with the add-on, without it, with its script throwing and with its script blocked')
  const place = async (name, lang) => {
    orders.length = 0
    const o = await open(name, { lang, w: 390, h: 844, seed: true }); const { pg } = o
    await pg.goto(`${o.base}/cart?lang=${lang}`, { waitUntil: 'load' }); await pg.waitForSelector('.cart-line', { timeout: 60000 }); await pg.waitForTimeout(500)
    // a stepper tap and back, through the page: the bag the order is made from goes through the add-on's page
    const plus = pg.locator('.cart-line').nth(1).locator('.purchase-quantity button').last()
    await plus.click(); await pg.waitForTimeout(150); await pg.locator('.cart-line').nth(1).locator('.purchase-quantity button').first().click(); await pg.waitForTimeout(150)
    await pg.locator('.purchase-cart__summary a.btn-primary').click(); await pg.waitForURL(/\/checkout/, { timeout: 30000 }); await pg.waitForSelector('input[name=name]', { timeout: 30000 })
    await pg.fill('input[name=name]', 'Test Shopper'); await pg.fill('input[name=tel]', '55512345')
    await pg.selectOption('select[name=address-level1]', { index: 1 }); await pg.waitForTimeout(250)
    await pg.fill('input[name=address-level2]', 'Salmiya'); await pg.fill('input[name=address-line2]', '5'); await pg.fill('input[name=address-line1]', 'Salem Street'); await pg.fill('input[name=address-line3]', '12')
    const step = async () => { const b = pg.locator('button[type=submit]:visible:not([disabled])').first(); await b.waitFor({ timeout: 20000 }); await b.click(); await pg.waitForTimeout(700) }
    await step(); await step()
    const final = pg.locator('button[type=submit]:visible:not([disabled])').first(); await final.waitFor({ timeout: 20000 }); await final.click()
    await pg.waitForURL(/payment\/result/, { timeout: 30000 }).catch(() => {})
    const stored = await pg.evaluate(() => localStorage.getItem('sporta_cart'))
    const res = { order: orders.filter((x) => x.route === 'order').map((x) => x.body), quote: orders.filter((x) => x.route === 'discount').map((x) => x.body), stored, errs: o.errs.slice() }
    await o.ctx.close(); return res
  }
  for (const lang of LANGS) {
    const R = {}
    for (const name of ['with', 'without', 'throws', 'blocked']) R[name] = await place(name, lang)
    const ok = R.with.order.length === 1 && JSON.parse(R.with.order[0]).payment_method === 'cod' && JSON.parse(R.with.order[0]).items.length === 3
    is(ok, `order ${lang}: one POST per run, cash on delivery, the three bag lines with their size and quantity`, JSON.stringify(R.with.order).slice(0, 300))
    for (const name of ['without', 'throws', 'blocked']) is(R[name].order.length === 1 && R[name].order[0] === R.with.order[0], `order ${lang}: the order POST with the add-on is byte-identical to the one ${name === 'without' ? 'without it' : name === 'throws' ? 'with its script throwing' : 'with its script blocked'} (${R.with.order[0].length} bytes)`, `${R[name].order[0]} vs ${R.with.order[0]}`)
    for (const name of ['without', 'throws', 'blocked']) is(R[name].quote.length >= 1 && JSON.stringify(R[name].quote) === JSON.stringify(R.with.quote), `order ${lang}: the quote request ("discount": the server prices the bag) is byte-identical too (${name})`, '')
    is(['without', 'throws', 'blocked'].every((n) => R[n].stored === R.with.stored), `order ${lang}: the stored bag is identical after the same taps in every variant`, JSON.stringify(R.with.stored).slice(0, 200))
    is(!/price|amount|total|discount_amount/i.test(Object.keys(JSON.parse(R.with.order[0])).join(',')), `order ${lang}: the body names no price field (the browser never sends one; only expected_total_fils, the figure the shopper was quoted)`, Object.keys(JSON.parse(R.with.order[0])).join(','))
    is(R.throws.errs.some((e) => /sporta-bag boom/.test(e)) && R.throws.order.length === 1, `order ${lang}: a throwing add-on script raises its own error and the shop still takes the order`, JSON.stringify(R.throws.errs))
    is(R.with.errs.length === 0 && R.blocked.errs.length === 0, `order ${lang}: no page error with the add-on or with its script blocked`, JSON.stringify([R.with.errs, R.blocked.errs]))
  }

  // ---- B5 the page works with the script gone; CLS; reduced motion -----------------------------------------------------------
  head('B5  the page works with the script throwing or blocked; no layout shift from this change; reduced motion')
  const CLS = () => new Promise((res) => { let v = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value }).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => res(v), 1800) })
  for (const lang of LANGS) for (const [w, h] of [[390, 844], [1280, 800]]) {
    const cls = {}
    for (const name of ['with', 'without', 'cssOnly', 'throws', 'blocked']) {
      const o = await open(name, { lang, w, h, cart: [...BAG, ...MORE] })
      await o.pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) })
      await o.pg.goto(`${o.base}/cart?lang=${lang}`, { waitUntil: 'load' }); await o.pg.waitForSelector('.cart-line', { timeout: 60000 }); await o.pg.waitForTimeout(2200)
      const st = await o.pg.evaluate(() => ({ cls: window.__cls, lines: document.querySelectorAll('.cart-line').length, pos: getComputedStyle(document.querySelector('.purchase-cart__summary')).position, hints: [...document.querySelectorAll('.cart-line')].filter((l) => getComputedStyle(l.querySelector(':scope > div:not(.cart-line__controls)').lastElementChild, '::after').content.length > 4).length }))
      cls[name] = st; await o.ctx.close(); void CLS
    }
    const c = `${lang} ${w}x${h}`
    is(cls.with.cls <= cls.without.cls + 0.001 && cls.with.cls < 0.05, `real page ${c}: CLS ${f1(cls.with.cls * 1000) / 1000} with the add-on, ${f1(cls.without.cls * 1000) / 1000} without: the change adds no layout shift`, JSON.stringify(Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, v.cls]))))
    is(cls.throws.lines === 5 && cls.blocked.lines === 5 && cls.throws.pos === cls.with.pos && cls.blocked.pos === cls.with.pos && cls.throws.hints === cls.with.hints && cls.blocked.hints === cls.with.hints, `real page ${c}: with the script throwing or blocked the page renders the same, the bar and the hints (CSS) are all still there`, JSON.stringify([cls.throws, cls.blocked]))
    is(cls.cssOnly.cls <= cls.without.cls + 0.001, `real page ${c}: the CSS alone adds no layout shift either (script off)`, JSON.stringify([cls.cssOnly.cls, cls.without.cls]))
  }
  for (const lang of LANGS) {
    const o = await open('with', { lang, w: 390, h: 844, reduced: true, cart: [...BAG, ...MORE] }); await goCart({ ...o, lang })
    const r = await o.pg.evaluate(() => { const s = document.querySelector('.purchase-cart__summary'); const els = [s, s.querySelector('a.btn-primary'), document.querySelector('.cart-line .purchase-quantity button'), document.querySelector('.cart-line__controls > button:last-child')]; return { pos: getComputedStyle(s).position, bottom: s.getBoundingClientRect().bottom, vh: innerHeight, td: els.map((e) => getComputedStyle(e).transitionDuration), an: els.map((e) => getComputedStyle(e).animationName) } })
    is(r.pos === 'sticky' && near(r.bottom, r.vh, 1) && r.td.every((t) => /^0s(, 0s)*$/.test(t) || parseFloat(t) <= 0.16) && r.an.every((a) => a === 'none'), `real page ${lang}: with reduced motion the bar is still sticky and nothing of this lane animates (${r.td.join(' ')})`, JSON.stringify(r))
    await o.ctx.close()
  }
  flush()

  // ---- mutation on the real app (the script) ---------------------------------------------------------------------------------
  if (!process.env.CART_UX_SKIP_MUTANTS) {
    head('M2  mutation, real app: without the script block the script checks must fail')
    const before = fail
    const o = await open('cssOnly', { lang: 'en', w: 390, h: 844 }); await goCart({ ...o, lang: 'en' })
    const miss = await o.pg.evaluate(() => ({ described: document.querySelectorAll('.cart-line button[aria-describedby]').length, live: document.querySelectorAll('.purchase-quantity > span[aria-live]').length }))
    await o.pg.evaluate(() => scrollTo(0, 100))
    await o.pg.locator('.cart-line').nth(1).locator('button').last().focus(); await o.pg.keyboard.press('Enter'); await o.pg.waitForTimeout(400)
    const afterRm = await o.pg.evaluate(() => ({ active: document.activeElement.tagName, status: !!document.getElementById('sporta-bag-status') }))
    is(miss.described === 0 && miss.live === 0 && afterRm.active === 'BODY' && !afterRm.status, 'without the script block: no button is described, no live region, and focus falls to <body> after a removal (so every B3 check is load-bearing)', JSON.stringify([miss, afterRm]))
    await o.ctx.close()
    void before
  }
  for (const s of Object.values(servers)) await s.close()
}

// ============================================================================================================ M mutation (fixtures)
if (!process.env.CART_UX_SKIP_MUTANTS) {
  head('M  mutation: the checks must fail without the UX sections, and without each block')
  const failing = (v) => NAMES.filter((n) => CASES[n][v] && CASES[n][v].bad.length > 0)
  const total = NAMES.length
  const fb = failing('before')
  is(fb.length >= 30, `cutting both UX sections makes ${fb.length} of the ${total} fixture checks fail`, `only ${fb.length}`)
  for (const m of mutants) {
    const f = failing(m)
    is(f.length >= 1, `${m.replace('sporta-', '')}: cutting it fails ${f.length} check${f.length === 1 ? '' : 's'}${f.length ? ' (first: ' + f[0].slice(0, 70) + ')' : ''}`, 'dead weight: remove it or prove it')
  }
  // the script: cutting it must fail the A2 checks (proved live in M2 above, on the fixture here)
  const { pg, ctx } = await (async () => { ref.script = JS_WITHOUT; const c = await browser.newContext({ viewport: { width: 390, height: 700 } }); const p = await c.newPage(); await p.goto(`${base}/__fx/cart-en?js=1`, { waitUntil: 'load' }); await p.waitForTimeout(150); return { pg: p, ctx: c } })()
  const gone = await pg.evaluate(() => document.querySelectorAll('.cart-line button[aria-describedby]').length + document.querySelectorAll('[aria-live]').length)
  is(gone === 0, 'without the script block the fixture shows no aria-describedby and no live region (the A2 checks are load-bearing)', String(gone))
  await ctx.close()
}
flush()
await browser.close(); server.close()
console.log(`\n${pass} passed, ${fail} failed`)
void FAIL_BEFORE_REAL; void realMutantReport; void ADDON_ORDER
process.exit(fail ? 1 : 0)
