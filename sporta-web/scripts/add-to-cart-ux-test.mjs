// Lane U3 of "improve the UX/UI of the checkout, the cart and add to cart" (2026-11-04): THE ADD-TO-BAG BUTTON, proven on the
// real compiled storefront in a real browser.
//
//   npm run test:add-to-cart-ux      (rig-free: no database, no server of the project, no dist/, no port of the test rig)
//
// What is under test (add-on code for the compiled live storefront; src/ is not live and is not touched):
//   public/sporta-product-fix.css   section "UX: ADD TO BAG"   blocks [u3-1] .. [u3-7]
//   public/sporta-features.js       the last block, "Add to bag: labels, the added answer and the way to the bag"
//
// The real compiled client (minified React) with the live /api JSON captured 2026-11-03, a bag stored exactly as the app stores it
// (localStorage "sporta_cart"), every POST fulfilled locally (nothing reaches a real server). The capture is not in the repo:
// SPORTA_LIVE_CAPTURE=<dir> (default: the session scratchpad's scan-words/live); without it the suite says so and exits 0.
//
// What it proves, every line a measurement (ar and en, 320/360/390 phone, 768 and 1280):
//   1  the phone bar holds Add AND Buy now: inside the bar, aligned, not overlapping, in tab order = visual order in both directions,
//      44px or more, the bar as tall as before, no sideways scroll; from 768px Add stays in the row
//   2  the labels: "Choose size" until a size is chosen, the words drawn by CSS with aria-label equal to them (label in name), the
//      bundle's text node untouched, AA contrast
//   3  a tap with no size changes nothing in the bag and makes the size card answer (rose border, one shake, a "!" message at 6.5:1)
//   4  an add: the bag grows by exactly the stored line the app writes, the button says Added (check, 16:1), the header bag
//      pulses, a polite live region says what and how many, a notice offers View bag (44px, opens the drawer, takes no focus)
//   5  a double tap adds once with the add-on and twice without it
//   6  sold out is readable (7:1) and the bar is the price and one button; every unit already in the bag says "In your bag"
//      instead of "Sold out"
//   7  dark theme: the same states at AA
//   8  a card with no sizes adds in place and gets the same answer; a card with sizes only navigates (no false "added")
//   9  the order POST body is BYTE-IDENTICAL with the add-on, without it, with its script throwing and with its script blocked
//  10  no layout shift from the add flow (CLS 0), reduced motion drops the shake, the pulse and the notice's slide, the page still
//      works with the script throwing or blocked
//  12  (independent review) big text on a narrow phone: the bar wraps instead of crushing Buy now, the notice keeps its words whole and sits
//      above the taller bar, an add after a removal is announced, "Added" stays on the product it belongs to
// MUTATION: the suite cuts the whole CSS section and the whole script block and requires the checks to fail; then cuts EACH CSS block
// on its own and requires the probe written for it to fail, so no block is dead weight.
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium-1243/chrome-linux64/chrome), ADD_UX_SKIP_MUTANTS=1, ADD_UX_SKIP_POST=1.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir, line } from './lib/add-to-cart-ux-live.mjs'

const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-product-fix.css', JS_F = 'sporta-features.js'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8'), JS = readFileSync(join(PUB, JS_F), 'utf8')

if (!liveDir()) {
  console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured')
  process.exit(0)
}

const ONLY = process.env.ADD_UX_ONLY ? process.env.ADD_UX_ONLY.split(',') : null   // e.g. ADD_UX_ONLY=8,10 runs only those sections
const want = (n) => !ONLY || ONLY.includes(String(n))
const onlyJs = !!ONLY && ONLY.includes('MJ') && !ONLY.includes('M')   // ADD_UX_ONLY=MJ: only the two script mutants
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const note = (t) => out.push('     ' + t)
const flush = () => { console.log(out.join('\n')); out.length = 0 }
const f1 = (n) => (n == null || Number.isNaN(n) ? 'n/a' : (Math.round(n * 10) / 10).toString())
const LANGS = ['ar', 'en']

// ============================================================================================================ the pieces under test
const SEC_START = '/* ==== UX: ADD TO BAG', SEC_NEXT = '/* ==== SIZES:'
const cssParts = (css) => {
  const a = css.indexOf(SEC_START)
  if (a < 0) return { before: css, ux: '', after: '' }
  const b = css.indexOf(SEC_NEXT, a)
  return { before: css.slice(0, a), ux: css.slice(a, b < 0 ? css.length : b), after: b < 0 ? '' : css.slice(b) }
}
const blocksOf = (ux) => {
  const marks = [...ux.matchAll(/\/\* \[(u3-\d)\]/g)]
  return marks.map((m, i) => ({ id: m[1], start: m.index, end: i + 1 < marks.length ? marks[i + 1].index : ux.length }))
}
const cssWithout = (ids) => {
  const { before, ux, after } = cssParts(CSS)
  if (ids === 'all') return before + after
  let u = ux
  for (const b of blocksOf(ux).filter((x) => ids.includes(x.id)).sort((p, q) => q.start - p.start)) u = u.slice(0, b.start) + u.slice(b.end)
  return before + u + after
}
const JS_START = '/* Add to bag: labels, the "added" answer'
const jsParts = (js) => {
  const a = js.indexOf(JS_START)
  if (a < 0) return { before: js, block: '', after: '' }
  const e = js.indexOf('\n})()\n', a)
  const end = e < 0 ? js.length : e + 6
  return { before: js.slice(0, a), block: js.slice(a, end), after: js.slice(end) }
}
const JSP = jsParts(JS)
const JS_WITHOUT = JSP.before + JSP.after

const BLOCKS = blocksOf(cssParts(CSS).ux).map((b) => b.id)

// ============================================================================================================ servers
const POSTS = []
const onPost = (q, r, u) => {
  let body = ''; q.on('data', (c) => (body += c))
  q.on('end', () => {
    POSTS.push({ route: u.searchParams.get('r'), body })
    r.writeHead(200, { 'content-type': 'application/json' })
    const j = JSON.parse(body || '{}')
    if (u.searchParams.get('r') === 'discount') return r.end(JSON.stringify({ subtotal: 5, delivery: 1, total: 6, total_fils: 6000, discount: 0, lines: [], applied: [] }))
    r.end(JSON.stringify({ track_id: j.track_id, amount: 6, order_id: 1 }))
  })
}
// a product the shop has no size rows for: the card adds in place (the capture has none; every product there has sizes)
// (chosen at run time from the first page of /shop: the second card that can be bought; the answer is read per request)
const noSize = { slug: 'cheetahs-rugby-t-shirt' }
const stockWithout = () => (rows) => (Array.isArray(rows) ? rows.filter((r) => r.slug !== noSize.slug) : rows)
const VAR = {
  with: {},
  without: { css: { [CSS_F]: cssWithout('all') }, js: { [JS_F]: JS_WITHOUT } },
  cssOnly: { js: { [JS_F]: JS_WITHOUT } },
  jsOnly: { css: { [CSS_F]: cssWithout('all') } },
  throws: { js: { [JS_F]: JSP.before + JSP.block.replace(/function start\(\) \{\n\s*ensureLive\(\)/, "function start() {\n      throw new Error('sporta-u3 boom')") + JSP.after } },
  blocked: { js: { [JS_F]: '' } },
  cards: { api: { stock: stockWithout() } },
  cardsWithout: { api: { stock: stockWithout() }, css: { [CSS_F]: cssWithout('all') }, js: { [JS_F]: JS_WITHOUT } },
}
// the script with ONE behaviour cut: the double-tap guard, and the "In your bag" state
const cutJs = (re, to) => { const b = JSP.block.replace(re, to); if (b === JSP.block) throw new Error('mutation did not apply: ' + re); return JSP.before + b + JSP.after }
VAR.noGuard = { js: { [JS_F]: cutJs(/if \(b === lastEl && now - lastAt < 500\) \{[^}]*\}/, '') } }
VAR.noInbag = { js: { [JS_F]: cutJs(/\) state = 'inbag'/, ") state = ''") } }
for (const id of BLOCKS) VAR['cut-' + id] = { css: { [CSS_F]: cssWithout([id]) } }
// review round (section 12): the behaviours added after the first independent review, each cut out on its own
const cutCss = (re, to = '') => { const c = CSS.replace(re, to); if (c === CSS) throw new Error('css mutation did not apply: ' + re); return c }
VAR.noBarWrap = { css: { [CSS_F]: cutCss(/\n    flex-wrap: wrap;\n    row-gap: \.25rem;/) } }
VAR.noToastWrap = { css: { [CSS_F]: cutCss(/\n  flex-wrap: wrap;\n  row-gap: \.25rem;\n  padding: \.375rem/, '\n  padding: .375rem') } }
VAR.noToastSmall = { css: { [CSS_F]: cutCss(/font-size: \.875rem;\n  font-weight: 600;\n  color: #d3d7dd;/, 'font-size: .8125rem;\n  font-weight: 600;\n  color: #d3d7dd;') } }
VAR.noReportedReset = { js: { [JS_F]: cutJs(/if \(n0 < reported\) reported = n0/, '') } }
VAR.noSlugScope = { js: { [JS_F]: cutJs(/ && slug\(\) === addedSlug/, '') } }
VAR.noBarMeasure = { js: { [JS_F]: cutJs(/if \(bh > 0\) toast\.style\.setProperty\('--sporta-u3-bar'/, "if (false) toast.style.setProperty('--sporta-u3-bar'") } }
const servers = {}
const srv = async (name) => (servers[name] ||= await serveLive({ ...VAR[name], onPost }))

let browser
const openCtx = new Set()
const open = async (variant, { lang = 'ar', w = 390, h = 844, dark = false, reduced = false, bag = null, seed = false, touch = w < 800 } = {}) => {
  const s = await srv(variant)
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await ctx.addInitScript(([l, d, b]) => { try { localStorage.setItem('lang', l); if (d) { localStorage.setItem('sporta_theme', 'dark') } if (b && !sessionStorage.getItem('__seeded')) { localStorage.setItem('sporta_cart', JSON.stringify(b)); sessionStorage.setItem('__seeded', '1') } } catch (e) {} }, [lang, dark, bag])
  if (seed) await ctx.addInitScript(() => {
    // deterministic ids for the order body; Date.now is left alone (the add-on reads it, and a counter would shift)
    let s = 123456789; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    Math.random = rnd
    crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 256); return a }
    if (crypto.randomUUID) crypto.randomUUID = () => Array.from({ length: 36 }, (_, i) => (i === 8 || i === 13 || i === 18 || i === 23 ? '-' : Math.floor(rnd() * 16).toString(16))).join('')
  })
  // CLS: every layout-shift entry without recent input, with the time it happened; and a counter on navigator.vibrate
  await ctx.addInitScript(() => {
    window.__vib = 0
    try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { window.__vib++; return true } }) } catch (e) {}
    window.__shifts = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push({ t: performance.now(), v: e.value }) }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {}
  })
  openCtx.add(ctx)
  const pg = await ctx.newPage()
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
  return { ctx, pg, errs, base: s.base, lang, w, h }
}
const pdp = async (o, slug = 'sgomma-t-shirt-navy') => {
  await o.pg.goto(`${o.base}/product/${slug}?lang=${o.lang}`, { waitUntil: 'load' })
  await o.pg.waitForSelector('.product-purchase-row', { timeout: 90000 })
  await o.pg.evaluate(() => document.fonts.ready)
  await o.pg.waitForFunction(() => document.querySelectorAll('#product-size-options [role="group"] > button').length > 0 || !document.getElementById('product-size-options'), null, { timeout: 60000 })
  await o.pg.waitForTimeout(900)
}
const bagOf = (pg) => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('sporta_cart') || '[]') } catch (e) { return null } })
const qtyOf = (bag) => (bag || []).reduce((n, l) => n + (Number(l.qty) || 0), 0)
const chooseSize = async (pg, text = null) => {
  const chips = pg.locator('#product-size-options [role="group"] > button:not([disabled]):visible')
  await (text ? chips.filter({ hasText: new RegExp(`^${text}$`) }).first() : chips.nth(2)).click()
  await pg.waitForTimeout(250)
}

// ============================================================================================================ in-page helpers
const INSTALL = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1) }
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor)); let acc = [255, 255, 255, 1]; for (let i = chain.length - 1; i >= 0; i--) acc = over(chain[i], acc); return acc }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (fg, bg) => { const f = over(fg, bg); const [x, y] = [lum(f), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  // the colour of the text against the ground as the eye gets them: the element's own opacity (the bundle fades a disabled button
  // to .5) blends text and ground into what is behind the element
  const contrast = (el, prop = 'color', pseudo = null) => {
    let op = 1
    for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity)
    const under = el.parentElement ? bgOf(el.parentElement) : [255, 255, 255, 1]
    const own = rgba(getComputedStyle(el).backgroundColor); own[3] *= op
    const ground = over(own, under)
    const fg = rgba(getComputedStyle(el, pseudo)[prop]); fg[3] *= op
    return ratio(fg, ground)
  }
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } }
  const pc = (el, which) => { const c = getComputedStyle(el, which); return c.content === 'none' || c.content === 'normal' ? '' : c.content.replace(/^"|"$/g, '') }
  window.__h = { rgba, bgOf, ratio, contrast, R, pc }
}
const PROBE_BAR = () => {
  const { R, pc, contrast } = window.__h
  const add = document.querySelector('.product-purchase-row .btn-primary'), bar = document.querySelector('.action-bar'), buy = bar && bar.querySelector(':scope > .btn'), price = bar && bar.querySelector(':scope > span')
  const rtl = document.documentElement.dir === 'rtl'
  const o = { vw: innerWidth, docW: document.documentElement.scrollWidth, rtl }
  o.add = R(add); o.bar = R(bar); o.buy = R(buy); o.price = R(price); o.row = R(document.querySelector('.product-purchase-row'))
  o.addPos = getComputedStyle(add).position; o.barDisp = getComputedStyle(bar).display
  o.addText = (add.textContent || '').trim(); o.addLabel = add.getAttribute('aria-label'); o.state = add.getAttribute('data-sporta-state')
  o.after = pc(add, '::after'); o.addFs = parseFloat(getComputedStyle(add).fontSize)
  o.addRatio = contrast(add); o.afterRatio = o.after ? contrast(add, 'color', '::after') : null
  o.addBg = getComputedStyle(add).backgroundColor; o.addDis = add.disabled
  o.buyText = buy ? buy.textContent.trim() : null; o.buyRatio = buy ? contrast(buy) : null; o.buyDis = buy ? buy.disabled : null
  o.buyBg = buy ? getComputedStyle(buy).backgroundColor : null
  o.tabOrder = [...document.querySelectorAll('button')].filter((b) => b === add || b === buy).map((b) => (b === add ? 'add' : 'buy'))
  o.caption = pc(document.querySelector('.product-purchase-row'), '::before')
  return o
}

const INK = 'rgb(23, 26, 30)', WHITE = 'rgb(255, 255, 255)', ORANGE = 'rgb(255, 123, 23)'
const WORDS = {
  ar: { pick: 'اختر المقاس', addShort: 'أُضيف', addLong: 'أُضيف إلى الحقيبة', inbag: 'في حقيبتك', view: 'عرض الحقيبة', add: 'أضف' },
  en: { pick: 'Choose size', addShort: 'Added', addLong: 'Added to bag', inbag: 'In your bag', view: 'View bag', add: 'Add' },
}
const within = (a, b, t = 0.5) => a && b && a.l >= b.l - t && a.r <= b.r + t && a.t >= b.t - t && a.b <= b.b + t
// the bar broke into two lines: the price is on its own line above Buy now
const isWrapped = (m) => !!(m.price && m.buy && m.price.b <= m.buy.t + 1)
const overlap = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5

// ============================================================================================================ the probes (also the mutants' targets)
// each returns { ok, detail } for ONE condition that the named CSS block is responsible for
const PROBES = {
  // [u3-1] the phone bar holds Add inside it, aligned with Buy now, not overlapping, tab order = visual order
  'u3-1': async (variant) => {
    const o = await open(variant, { lang: 'ar', w: 390, h: 844 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close(); return barOk(m, 390)
  },
  // [u3-2] a sold-out product: the label is readable
  'u3-2': async (variant) => {
    const o = await open(variant, { lang: 'ar', w: 390, h: 844 }); await pdp(o, 'cagliari-calcio-backpack'); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    return { ok: m.buyDis && m.buyRatio >= 4.5, detail: `buy ratio ${f1(m.buyRatio)}` }
  },
  // [u3-3] the label drawn for "Choose size" and the check/ground for "Added" (both need the script)
  'u3-3': async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    return { ok: m.state === 'pick' && m.after === WORDS.en.pick && m.addFs === 0 && m.afterRatio >= 4.5, detail: `state ${m.state}, drawn "${m.after}", fs ${m.addFs}` }
  },
  // [u3-4] the header badge ring (always present on a bag with something in it) and the pulse after an add
  'u3-4': async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o); await o.pg.evaluate(INSTALL)
    await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').click()
    await o.pg.waitForSelector('.navbar-cart[data-sporta-bump]', { timeout: 20000 }).catch(() => {})
    const m = await o.pg.evaluate(() => { const c = document.querySelector('.app-header .navbar-cart'); const s = c.querySelector(':scope > span'); return { anim: c.hasAttribute('data-sporta-bump') ? getComputedStyle(c.querySelector(':scope > svg')).animationName : 'no-bump', ring: s ? getComputedStyle(s).boxShadow : '' } })
    await o.ctx.close(); return { ok: m.anim === 'sporta-u3-bump' && /rgb\(23, 26, 30\)/.test(m.ring), detail: JSON.stringify(m) }
  },
  // [u3-5] the size card answers a tap with no size
  'u3-5': async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o)
    await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('#product-size-options > p[role="alert"]', { timeout: 20000 })
    const m = await o.pg.evaluate(() => { const c = document.getElementById('product-size-options'); const cs = getComputedStyle(c); return { border: cs.borderTopColor, anim: cs.animationName } })
    await o.ctx.close(); return { ok: m.border === 'rgb(190, 18, 60)' && m.anim === 'sporta-u3-shake', detail: JSON.stringify(m) }
  },
  // [u3-6] the notice after an add: fixed, visible, a 44px View bag button
  'u3-6': async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o)
    await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 })
    await o.pg.waitForTimeout(400)
    const m = await o.pg.evaluate(() => { const t = document.querySelector('.sporta-u3-toast'), b = t.querySelector('button'), cs = getComputedStyle(t), r = t.getBoundingClientRect(), br = b.getBoundingClientRect(); return { pos: cs.position, op: cs.opacity, bg: cs.backgroundColor, bh: br.height, bw: br.width, within: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight } })
    await o.ctx.close(); return { ok: m.pos === 'fixed' && m.op === '1' && m.bg === INK && m.bh >= 44 && m.within, detail: JSON.stringify(m) }
  },
  // [u3-7] reduced motion: the shake is dropped (the border stays)
  'u3-7': async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844, reduced: true }); await pdp(o)
    await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('#product-size-options > p[role="alert"]', { timeout: 20000 })
    const m = await o.pg.evaluate(() => { const c = document.getElementById('product-size-options'); const cs = getComputedStyle(c); return { border: cs.borderTopColor, anim: cs.animationName } })
    await o.ctx.close(); return { ok: m.border === 'rgb(190, 18, 60)' && m.anim === 'none', detail: JSON.stringify(m) }
  },
}
// the probes run against the variant under test (the mutants swap one block out of the CSS served as 'with')
const runProbe = async (id, variant) => {
  const had = new Set(openCtx)
  try { return await PROBES[id](variant) } catch (e) { return { ok: false, detail: 'threw: ' + String(e.message).split('\n')[0] } } finally {
    for (const c of [...openCtx]) if (!had.has(c)) { openCtx.delete(c); await c.close().catch(() => {}) }
  }
}

// review round: checks written after the first independent review (each returns { ok, detail }; section 12 runs them on 'with',
// the mutation block on a variant with ONE behaviour cut out and requires them to fail there)
const CHECKS = {
  bigText: async (variant, lang, w, fs) => {
    const o = await open(variant, { lang, w, h: 700 }); await pdp(o); await o.pg.evaluate(INSTALL)
    await o.pg.evaluate((f) => { document.documentElement.style.fontSize = f + '%' }, fs); await o.pg.waitForTimeout(350)
    const m = await o.pg.evaluate(PROBE_BAR)
    const clip = await o.pg.evaluate(() => { const a = document.querySelector('.product-purchase-row .btn-primary'), b = document.querySelector('.action-bar > .btn'); return { add: a.scrollWidth > a.clientWidth + 1, buy: b.scrollWidth > b.clientWidth + 1 } })
    await o.ctx.close()
    const bad = []
    const r = barOk(m, w); if (!r.ok) bad.push(r.detail)
    if (clip.add || clip.buy) bad.push(`label clipped (${JSON.stringify(clip)})`)
    return { ok: bad.length === 0, detail: bad.join('; ') + ' ' + JSON.stringify({ add: m.add, price: m.price, buy: m.buy, bar: m.bar }) }
  },
  toastBig: async (variant, lang) => {
    const o = await open(variant, { lang, w: 320, h: 700 }); await pdp(o)
    await o.pg.evaluate(() => { document.documentElement.style.fontSize = '130%' }); await o.pg.waitForTimeout(300)
    await chooseSize(o.pg, 'M'); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 }); await o.pg.waitForTimeout(450)
    const m = await o.pg.evaluate(() => { const t = document.querySelector('.sporta-u3-toast'), r = t.getBoundingClientRect(), bar = document.querySelector('.action-bar').getBoundingClientRect(), head = t.querySelector('.sporta-u3-toast__text > span'), hr = document.createRange(); hr.selectNodeContents(head); const lines = new Set([...hr.getClientRects()].map((x) => Math.round(x.top))).size; const bt = t.querySelector('button').getBoundingClientRect(); return { lines, left: r.left, right: r.right, vw: innerWidth, gap: bar.top - r.bottom, bh: bt.height, bw: bt.width, docW: document.documentElement.scrollWidth, spill: t.scrollWidth > t.clientWidth + 1 || bt.right > r.right + 0.5 || bt.left < r.left - 0.5 } })
    await o.ctx.close()
    const bad = []
    if (m.lines !== 1) bad.push(`"${WORDS[lang].addLong}" breaks over ${m.lines} lines`)
    if (!(m.left >= 0 && m.right <= m.vw && m.docW <= m.vw)) bad.push('outside the screen')
    if (!(Math.abs(m.gap - 12) <= 1.5)) bad.push(`gap to the bar ${f1(m.gap)}px (12 expected)`)
    if (!(m.bh >= 44 && m.bw >= 44)) bad.push('View bag under 44px')
    if (m.spill) bad.push('the button or the text spills out of the notice')
    return { ok: bad.length === 0, detail: bad.join('; ') + ' ' + JSON.stringify(m) }
  },
  toastSmall: async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o)
    await chooseSize(o.pg, 'M'); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 })
    const fs = await o.pg.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sporta-u3-toast small')).fontSize)); await o.ctx.close()
    return { ok: fs >= 14, detail: `${fs}px` }
  },
  afterRemoval: async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o)
    const add = o.pg.locator('.product-purchase-row .btn-primary')
    await chooseSize(o.pg, 'M'); await add.click(); await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 }); await o.pg.waitForTimeout(1900)
    await o.pg.locator('.app-header .navbar-cart').click(); await o.pg.waitForSelector('aside.cart-drawer', { timeout: 20000 }); await o.pg.waitForTimeout(500)
    const rm = o.pg.locator('aside.cart-drawer button[aria-label*="emove" i]').first()
    if (await rm.count()) await rm.click(); await o.pg.waitForTimeout(500)
    const emptied = qtyOf(await bagOf(o.pg)) === 0
    await o.pg.keyboard.press('Escape'); await o.pg.waitForTimeout(500)
    await o.pg.evaluate(() => { const t = document.querySelector('.sporta-u3-toast'); if (t) t.removeAttribute('data-open'); document.querySelector('.sporta-u3-live').textContent = '' })
    await chooseSize(o.pg, 'L'); await add.click(); await o.pg.waitForTimeout(1200)
    const m = await o.pg.evaluate(() => ({ live: document.querySelector('.sporta-u3-live').textContent, open: document.querySelector('.sporta-u3-toast').hasAttribute('data-open'), st: document.querySelector('.product-purchase-row .btn-primary').getAttribute('data-sporta-state') }))
    await o.ctx.close()
    return { ok: emptied && m.live.includes('size L') && m.open && m.st === 'added', detail: JSON.stringify({ emptied, ...m }) }
  },
  otherProduct: async (variant) => {
    const o = await open(variant, { lang: 'en', w: 390, h: 844 }); await pdp(o)
    await chooseSize(o.pg, 'M'); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 }); await o.pg.waitForTimeout(300)
    await o.pg.evaluate(() => { history.pushState(null, '', '/product/flash-shorts-green'); dispatchEvent(new PopStateEvent('popstate')) })
    await o.pg.waitForFunction(() => location.pathname.endsWith('flash-shorts-green') && document.querySelector('.product-purchase-row'), null, { timeout: 30000 })
    await o.pg.waitForTimeout(600)
    const st = await o.pg.evaluate(() => document.querySelector('.product-purchase-row .btn-primary').getAttribute('data-sporta-state')); await o.ctx.close()
    return { ok: st !== 'added', detail: `state on the other product: ${st}` }
  },
}

// the checks on the bar (shared by the main run, [u3-1]'s probe and the "without" contrast)
function barOk(m, vw) {
  const bad = []
  if (!(within(m.add, m.bar))) bad.push('Add not inside the bar')
  if (!(Math.abs(m.add.b - m.buy.b) <= 1 && Math.abs(m.add.t - m.buy.t) <= 1)) bad.push(`Add and Buy now not aligned (${f1(m.add.t)}/${f1(m.buy.t)})`)
  if (!(m.add.h >= 44 && m.add.w >= 44 && m.buy.h >= 44 && m.buy.w >= 44)) bad.push('under 44px')
  if (overlap(m.add, m.buy) || overlap(m.add, m.price) || overlap(m.price, m.buy)) bad.push('overlap')
  // one row: Add, price, Buy now along the line. Two lines (big text or a 320px screen): the price on top, and Add on the start
  // side of Buy now on the line below
  const ordered = isWrapped(m)
    ? (m.price.t < m.buy.t && (m.rtl ? m.add.l >= m.buy.r - 0.5 : m.add.r <= m.buy.l + 0.5))
    : (m.rtl ? (m.add.r > m.price.r && m.price.r > m.buy.r) : (m.add.l < m.price.l && m.price.l < m.buy.l))
  if (!ordered) bad.push('visual order is not Add, price, Buy now')
  if (m.tabOrder.join() !== 'add,buy') bad.push('tab order ' + m.tabOrder)
  if (!(m.add.l >= 0 && m.add.r <= vw && m.buy.l >= 0 && m.buy.r <= vw && m.price.l >= 0 && m.price.r <= vw && m.docW <= vw)) bad.push(`outside the viewport / sideways scroll (doc ${m.docW})`)
  return { ok: bad.length === 0, detail: bad.join('; ') }
}

// ============================================================================================================ run
const t0 = Date.now()
browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
try {
  // -------------------------------------------------------------------------------------------------------- 1 the phone bar
  if (want('1')) {
  head('1  the phone bar: Add and Buy now together (real product page, compiled client)')
  for (const lang of LANGS) for (const w of [320, 360, 390]) {
    const c = `${lang} ${w}`
    const o = await open('with', { lang, w, h: 780 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR)
    // an iPhone's home-indicator inset: Add and Buy now must stay level, and the bar grows by the inset
    const sa = await o.pg.evaluate(() => { document.documentElement.style.setProperty('--sa-bottom', '34px'); const { R } = window.__h; const add = R(document.querySelector('.product-purchase-row .btn-primary')), buy = R(document.querySelector('.action-bar > .btn')), bar = R(document.querySelector('.action-bar')); return { add, buy, bar, vh: innerHeight } })
    await o.ctx.close()
    is(Math.abs(sa.add.b - sa.buy.b) <= 1 && Math.abs(sa.add.t - sa.buy.t) <= 1 && Math.abs(sa.bar.h - (m.bar.h + 34)) <= 1 && sa.bar.b >= sa.vh - 1 && sa.add.b <= sa.vh - 34 + 0.5, `bar ${c}: with a 34px home-indicator inset Add and Buy now stay level (${f1(sa.add.t)}/${f1(sa.buy.t)}), the bar is ${f1(sa.bar.h)}px (${f1(m.bar.h)} + 34) and both clear the inset`, JSON.stringify(sa))
    const r = barOk(m, w)
    is(r.ok, `bar ${c}: Add sits inside the bar at the start edge, aligned with Buy now, apart from the price, tab order = visual order, 44px+, no sideways scroll`, r.detail + ' ' + JSON.stringify({ add: m.add, price: m.price, buy: m.buy }))
    // 73px as it was; the only exception at the default text size is a 320px English screen, where price + Buy now do not fit
    // beside Add: Buy now then takes a second line (review round: the sliver it used to be is not a button) and the bar is 96px
    is((Math.abs(m.bar.h - 73) <= 0.5 || (isWrapped(m) && m.bar.h <= 100 && m.buy.w >= 120)) && m.addPos === 'fixed', `bar ${c}: the bar is ${isWrapped(m) ? `two lines (${f1(m.bar.h)}px, Buy now ${f1(m.buy.w)}px wide: it does not fit beside the price)` : 'still 73px tall (it was)'} and Add is the bundle's own button positioned over it`, `bar ${f1(m.bar.h)}, position ${m.addPos}`)
    is(m.buyBg === 'rgba(0, 0, 0, 0)' && m.buyRatio >= 4.5 && m.addBg === ORANGE, `bar ${c}: Add is the filled orange primary, Buy now the outlined second action (label ${f1(m.buyRatio)}:1)`, `${m.addBg} / ${m.buyBg}`)
    is(m.caption === (lang === 'ar' ? 'الكمية' : 'Quantity'), `bar ${c}: the stepper left in the page is captioned`, m.caption)
  }
  {
    const o = await open('without', { lang: 'ar', w: 390, h: 780 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    is(m.add.t > m.bar.b + 300 && m.addPos === 'static', `without the add-on the one Add button sat ${f1(m.add.t - m.bar.t)}px below the fixed bar (the bug is real); bar ${f1(m.bar.h)}px`, JSON.stringify({ add: m.add, bar: m.bar }))
  }
  for (const lang of LANGS) for (const w of [768, 1280]) {
    const o = await open('with', { lang, w, h: 900 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    is(m.barDisp === 'none' && m.addPos !== 'fixed' && within(m.add, m.row, 1) && m.add.w >= 44 && m.add.h >= 44 && m.docW <= m.vw, `row ${lang} ${w}: the bar is hidden, Add stays in the row (not fixed), ${f1(m.add.w)}x${f1(m.add.h)}, no sideways scroll`, JSON.stringify({ disp: m.barDisp, pos: m.addPos, add: m.add, row: m.row }))
    is(m.caption === '' || m.caption === 'none', `row ${lang} ${w}: no caption pseudo-element on the tablet and desktop row`, m.caption)
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 2 labels, 3 size needed
  if (want('2')) {
  head('2  labels: "Choose size" until a size is chosen, then the bundle\'s own label')
  for (const lang of LANGS) {
    const o = await open('with', { lang, w: 390, h: 780 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const a = await o.pg.evaluate(PROBE_BAR)
    is(a.state === 'pick' && a.after === WORDS[lang].pick && a.addLabel === WORDS[lang].pick && !a.addDis, `label ${lang}: no size chosen, the button reads "${WORDS[lang].pick}", aria-label the same words, still enabled`, JSON.stringify([a.state, a.after, a.addLabel, a.addDis]))
    is(a.addFs === 0 && a.addText === WORDS[lang].add && a.afterRatio >= 4.5, `label ${lang}: the bundle's text node ("${a.addText}") is untouched and hidden (font-size 0), the drawn words are ${f1(a.afterRatio)}:1`, JSON.stringify([a.addFs, a.addText, a.afterRatio]))
    await chooseSize(o.pg)
    const b = await o.pg.evaluate(PROBE_BAR)
    is(b.state === null && b.addLabel === null && b.after === '' && b.addFs >= 13 && b.addText === WORDS[lang].add, `label ${lang}: a size chosen, the button is the bundle's again ("${b.addText}", ${b.addFs}px, no aria-label, nothing drawn)`, JSON.stringify([b.state, b.addLabel, b.after, b.addFs]))
    await o.ctx.close()
  }
  flush()
  }
  if (want('3')) {
  head('3  a tap with no size: nothing is stored, the size card answers')
  for (const lang of LANGS) {
    const o = await open('with', { lang, w: 390, h: 780 }); await pdp(o); await o.pg.evaluate(INSTALL)
    await o.pg.locator('.product-purchase-row .btn-primary').click()
    await o.pg.waitForSelector('#product-size-options > p[role="alert"]', { timeout: 30000 })
    await o.pg.waitForTimeout(250)
    const m = await o.pg.evaluate(() => {
      const { contrast } = window.__h, c = document.getElementById('product-size-options'), cs = getComputedStyle(c), al = c.querySelector(':scope > p[role="alert"]')
      const free = [...c.querySelectorAll('[role="group"] > button:not(:disabled)')].filter((b) => !b.hasAttribute('data-sporta-nosize'))
      return { border: cs.borderTopColor, shadow: cs.boxShadow, anim: cs.animationName, dur: cs.animationDuration, alertRatio: contrast(al), mark: window.__h.pc(al, '::before'), chipBorders: [...new Set(free.map((b) => getComputedStyle(b).borderTopColor))], live: document.querySelector('.sporta-u3-live') && document.querySelector('.sporta-u3-live').textContent }
    })
    const bag = await bagOf(o.pg)
    is(qtyOf(bag) === 0, `no size ${lang}: the bag is still empty after the tap`, JSON.stringify(bag))
    is(m.border === 'rgb(190, 18, 60)' && /rgba\(190, 18, 60/.test(m.shadow) && m.anim === 'sporta-u3-shake' && parseFloat(m.dur) <= 0.35, `no size ${lang}: the card turns rose with a halo and shakes once (${m.dur})`, JSON.stringify(m))
    is(m.alertRatio >= 6 && m.mark === '!' && m.chipBorders.length === 1 && m.chipBorders[0] === 'rgb(190, 18, 60)', `no size ${lang}: the message is ${f1(m.alertRatio)}:1 with a "!" disc, the free sizes are outlined`, JSON.stringify([m.alertRatio, m.mark, m.chipBorders]))
    is(!m.live, `no size ${lang}: nothing is announced as added`, m.live)
    await o.ctx.close()
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 4 the add
  if (want('4')) {
  head('4  an add: stored line, "Added", the pulse, the announcement and the way to the bag')
  // waits INSIDE the page for the answer and measures in the same call: the "added" look lasts 1.6 s and a loaded machine can
  // stretch the gap between a Playwright wait and a Playwright evaluate past that
  const MEASURE_ADDED = async () => {
    const add = document.querySelector('.product-purchase-row .btn-primary')
    for (let i = 0; i < 1500 && add.getAttribute('data-sporta-state') !== 'added'; i++) await new Promise((r) => setTimeout(r, 10))
    // the pulse lasts 0.7 s: read it in the same tick as the "added" state, before the other waits
    const bump0 = document.querySelector('.app-header .navbar-cart').hasAttribute('data-sporta-bump')
    const live = document.querySelector('.sporta-u3-live')
    for (let i = 0; i < 300 && !live.textContent; i++) await new Promise((r) => setTimeout(r, 10))
    // the notice fades in over .18s and the contrast helper blends in opacity: measure it once it has arrived
    for (let i = 0; i < 300 && getComputedStyle(document.querySelector('.sporta-u3-toast')).opacity !== '1'; i++) await new Promise((r) => setTimeout(r, 10))
    const { contrast, pc, R } = window.__h
    const t = document.querySelector('.sporta-u3-toast'), cart = document.querySelector('.app-header .navbar-cart')
    const cs = getComputedStyle(add), bs = t.querySelector('button'), hd = document.querySelector('.app-header'), bar = document.querySelector('.action-bar')
    return {
      state: add.getAttribute('data-sporta-state'), label: add.getAttribute('aria-label'), short: add.getAttribute('data-sporta-short'), drawn: pc(add, '::after'), mark: pc(add, '::before'), markW: getComputedStyle(add, '::before').width,
      bg: cs.backgroundColor, ratio: contrast(add, 'color', '::after'), markColor: getComputedStyle(add, '::before').borderRightColor,
      toastOpen: t.hasAttribute('data-open'), toastText: t.querySelector('.sporta-u3-toast__text').textContent, btn: bs.textContent, btnH: bs.getBoundingClientRect().height, btnRatio: contrast(bs), toastRect: R(t),
      bump: bump0, badge: cart.querySelector(':scope > span') && cart.querySelector(':scope > span').textContent,
      live: live.textContent, liveRole: live.getAttribute('role'), liveAria: live.getAttribute('aria-live'), vw: innerWidth, vh: innerHeight,
      inToast: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.sporta-u3-toast')),
      headBottom: hd ? hd.getBoundingClientRect().bottom : 0, barTop: bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : null,
    }
  }
  for (const lang of LANGS) for (const w of [390, 1280]) {
    const c = `${lang} ${w}`
    const o = await open('with', { lang, w, h: w < 800 ? 780 : 900 }); await pdp(o); await o.pg.evaluate(INSTALL)
    await chooseSize(o.pg)
    await o.pg.locator('.product-purchase-row .btn-primary').click()
    const m = await o.pg.evaluate(MEASURE_ADDED)
    const bag = await bagOf(o.pg)
    const vib = await o.pg.evaluate(() => window.__vib)
    is(vib === 1, `add ${c}: one 10ms haptic pulse where the device supports it (navigator.vibrate called ${vib}x)`, String(vib))
    const l0 = (bag || [])[0]
    is(bag && bag.length === 1 && l0.slug === 'sgomma-t-shirt-navy' && l0.qty === 1 && l0.price === 5 && /^sgomma-t-shirt-navy__[A-Z0-9]+__\w+$/.test(l0.key) && Object.keys(l0).sort().join() === 'fit,image,key,name,price,qty,size,slug', `add ${c}: exactly the line the app stores (${l0 && l0.key}), qty 1`, JSON.stringify(bag))
    is(m.state === 'added' && m.label === WORDS[lang].addLong && m.short === WORDS[lang].addShort && m.drawn === (w < 768 ? WORDS[lang].addShort : WORDS[lang].addLong), `add ${c}: the button says "${m.drawn}" (${w < 768 ? 'short on the narrow bar' : 'long on the row'}), aria-label "${m.label}"`, JSON.stringify([m.state, m.label, m.short, m.drawn]))
    is(m.bg === INK && m.ratio >= 12 && m.mark === '' && parseFloat(m.markW) > 0 && m.markColor === ORANGE, `add ${c}: near-black ground, white label ${f1(m.ratio)}:1, a drawn check in bright orange`, JSON.stringify([m.bg, m.ratio, m.mark, m.markW, m.markColor]))
    is(m.bump && m.badge === '1', `add ${c}: the header bag pulses and its badge reads ${m.badge}`, JSON.stringify([m.bump, m.badge]))
    is(m.toastOpen && m.btn === `${WORDS[lang].view} (${lang === 'ar' ? '١' : '1'})` && m.btnH >= 44 && m.btnRatio >= 6 && m.toastText.includes(WORDS[lang].addLong), `add ${c}: the notice says "${WORDS[lang].addLong}" and offers "${m.btn}" (${f1(m.btnH)}px high, ${f1(m.btnRatio)}:1)`, JSON.stringify([m.toastOpen, m.btn, m.btnH, m.btnRatio, m.toastText]))
    const tr = m.toastRect
    is(tr.l >= 0 && tr.r <= m.vw && tr.b <= m.vh && tr.t >= 0 && (w < 768 ? tr.b <= m.barTop + 0.5 : tr.t >= m.headBottom - 1 && m.vw - tr.r <= 40 && m.vw - tr.r >= 8), `add ${c}: the notice is on screen, ${w < 768 ? 'above the buy bar' : 'under the header at the right edge, where the bag is'}`, JSON.stringify([tr, m.barTop, m.headBottom]))
    const nm = lang === 'ar' ? 'تيشيرت سغوما — كحلي' : 'Sgomma T-Shirt — Navy'
    is(m.live.includes(WORDS[lang].addLong) && m.live.includes(nm) && (lang === 'ar' ? m.live.includes('في حقيبتك قطعة واحدة') : m.live.includes('1 item in your bag')) && m.liveRole === 'status' && m.liveAria === 'polite', `add ${c}: the polite live region says: ${m.live}`, m.live)
    is(!m.inToast, `add ${c}: focus was not moved into the notice`, '')
    // the answer ends: the button is the bundle's again
    await o.pg.waitForFunction(() => !document.querySelector('.product-purchase-row .btn-primary').hasAttribute('data-sporta-state'), null, { timeout: 20000 }).catch(() => {})
    const e = await o.pg.evaluate(() => { const a = document.querySelector('.product-purchase-row .btn-primary'); return { st: a.getAttribute('data-sporta-state'), lab: a.getAttribute('aria-label'), bump: document.querySelector('.navbar-cart').hasAttribute('data-sporta-bump') } })
    is(e.st === null && e.lab === null && !e.bump, `add ${c}: after about 1.6 s the button and the header are back to the bundle's (state ${e.st}, aria-label ${e.lab})`, JSON.stringify(e))
    if (w === 390) {
      // View bag opens the bundle's drawer and closes the notice (the notice stays 4.5 s; this runs inside that window unless the machine is far behind)
      const still = await o.pg.evaluate(() => document.querySelector('.sporta-u3-toast').hasAttribute('data-open'))
      if (still) {
        await o.pg.locator('.sporta-u3-toast button').click()
        await o.pg.waitForTimeout(800)
        const d = await o.pg.evaluate(() => { const a = document.querySelector('aside.cart-drawer'); const r = a.getBoundingClientRect(); return { on: r.left < innerWidth && r.right > 0 && !a.hasAttribute('inert'), toast: document.querySelector('.sporta-u3-toast').hasAttribute('data-open') } })
        is(d.on && !d.toast, `add ${c}: View bag opens the bundle's bag drawer and the notice closes`, JSON.stringify(d))
      } else note(`add ${c}: the notice had already timed out before View bag could be pressed (machine under load); the 1280 run and probe [u3-6] cover the notice`)
    }
    await o.ctx.close()
  }
  {
    // View bag by keyboard and Escape, on the desktop page
    const o = await open('with', { lang: 'en', w: 1280, h: 900 }); await pdp(o)
    await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').click()
    await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 30000 })
    await o.pg.keyboard.press('Escape'); await o.pg.waitForTimeout(400)
    const closed = await o.pg.evaluate(() => !document.querySelector('.sporta-u3-toast').hasAttribute('data-open'))
    is(closed, 'add en 1280: Escape closes the notice', '')
    await o.ctx.close()
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 5 double tap
  if (want('5')) {
  head('5  a double tap adds once')
  for (const v of ['with', 'without']) {
    const o = await open(v, { lang: 'en', w: 390, h: 780 }); await pdp(o)
    await chooseSize(o.pg)
    await o.pg.locator('.product-purchase-row .btn-primary').dblclick()
    await o.pg.waitForTimeout(2200)
    const n = qtyOf(await bagOf(o.pg)); await o.ctx.close()
    if (v === 'with') is(n === 1, `double tap with the add-on: ${n} piece in the bag`, String(n))
    else is(n === 2, `double tap without the add-on: ${n} pieces in the bag (the bug is real)`, String(n))
  }
  {
    const o = await open('with', { lang: 'en', w: 390, h: 780 }); await pdp(o)
    await chooseSize(o.pg)
    const btn = o.pg.locator('.product-purchase-row .btn-primary')
    await btn.click(); await o.pg.waitForTimeout(900); await btn.click(); await o.pg.waitForTimeout(2200)
    const n = qtyOf(await bagOf(o.pg)); await o.ctx.close()
    is(n === 2, `two deliberate taps 0.9 s apart add two pieces (${n}): the guard only covers a double tap`, String(n))
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 6 sold out, in the bag
  if (want('6')) {
  head('6  sold out is readable; "In your bag" replaces a false "Sold out"')
  for (const lang of LANGS) {
    const o = await open('with', { lang, w: 390, h: 780 }); await pdp(o, 'cagliari-calcio-backpack'); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    is(m.buyDis && m.addPos === 'fixed' && m.add.w === 0 && m.buyRatio >= 7 && m.buyBg === 'rgb(228, 222, 211)' && m.state === null, `sold out ${lang}: the bar is the price and ONE disabled button ("${m.buyText}"), ${f1(m.buyRatio)}:1 (was 3.0:1), Add is not drawn`, JSON.stringify([m.buyDis, m.add, m.buyRatio, m.buyBg]))
    is(within(m.buy, m.bar) && m.buy.w > 200 && m.buy.h >= 44, `sold out ${lang}: the one button takes the bar (${f1(m.buy.w)}px)`, JSON.stringify(m.buy))
  }
  {
    const o = await open('without', { lang: 'ar', w: 390, h: 780 }); await pdp(o, 'cagliari-calcio-backpack'); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    is(m.buyRatio < 3.5, `sold out without the add-on: the label was ${f1(m.buyRatio)}:1 (the bug is real)`, f1(m.buyRatio))
  }
  for (const lang of LANGS) for (const w of [390, 1280]) {
    const c = `${lang} ${w}`
    const o = await open('with', { lang, w, h: w < 800 ? 780 : 900 }); await pdp(o, 'cloudsoft-leggings-army-green'); await o.pg.evaluate(INSTALL)
    await chooseSize(o.pg, 'L')
    await o.pg.locator('.product-purchase-row .btn-primary').click()
    // the Add button goes inbag (the app disables it, the bag already holds the piece) -> added (the script's first check, 50 ms later,
    // sees the bag grow) -> inbag again 1.65 s on. Waiting for "inbag" alone could return at the first step, before "added", and read
    // the state a moment later: the flake of the first review run (2 of 3 runs). So: wait for "added", then for the "inbag" after it.
    let waitErr = ''
    const stateIs = (v) => o.pg.waitForFunction((x) => document.querySelector('.product-purchase-row .btn-primary')?.getAttribute('data-sporta-state') === x, v, { timeout: 40000 }).catch((e) => { waitErr += `[${v}: ${String(e.message).split('\n')[0]}]` })
    await stateIs('added'); await stateIs('inbag')
    const m = await o.pg.evaluate(() => { const { contrast, pc } = window.__h; const add = document.querySelector('.product-purchase-row .btn-primary'), buy = document.querySelector('.action-bar > .btn'), inl = document.querySelector('.product-buy-now-inline'); const vis = innerWidth < 768 ? buy : add; return { st: add.getAttribute('data-sporta-state'), dis: add.disabled, addLab: add.getAttribute('aria-label'), buySt: buy.getAttribute('data-sporta-state'), buyLab: buy.getAttribute('aria-label'), buyDrawn: pc(vis, '::after'), buyRatio: contrast(vis, 'color', '::after'), buyBg: getComputedStyle(vis).backgroundColor, inlineDisp: getComputedStyle(inl).display, inlineSt: inl.getAttribute('data-sporta-state'), addDisp: getComputedStyle(add).display, mark: getComputedStyle(vis, '::before').width, rows: [...document.querySelectorAll('#product-size-options [role="group"] > button')].filter((b) => !b.hasAttribute('data-sporta-nosize')).map((b) => b.textContent.trim() + (b.disabled ? ':off' : '')) } })
    const bag = await bagOf(o.pg)
    is(qtyOf(bag) === 1 && m.dis && m.st === 'inbag' && m.addLab === WORDS[lang].inbag && m.buySt === 'inbag' && m.buyLab === WORDS[lang].inbag, `in bag ${c}: the last unit is added (stock 1), the app disables the buttons and they say "${m.addLab}" (not "Sold out")`, JSON.stringify(m) + (waitErr ? ' | wait: ' + waitErr : ''))
    is(m.buyDrawn === (w < 768 ? WORDS[lang].inbag : WORDS[lang].inbag) && m.buyRatio >= 7 && m.buyBg === 'rgb(228, 222, 211)' && parseFloat(m.mark) > 0, `in bag ${c}: ${f1(m.buyRatio)}:1 on the neutral ground with a check`, JSON.stringify([m.buyDrawn, m.buyRatio, m.buyBg, m.mark]))
    if (w < 768) is(m.addDisp === 'none', `in bag ${c}: the disabled Add is not drawn on the phone (one button, not two saying the same)`, m.addDisp)
    else is(m.inlineDisp === 'none' && m.addDisp !== 'none', `in bag ${c}: on the row Add says it and the inline Buy now (disabled) is not drawn`, JSON.stringify([m.inlineDisp, m.addDisp]))
    await o.ctx.close()
  }
  {
    const o = await open('without', { lang: 'en', w: 390, h: 780 }); await pdp(o, 'cloudsoft-leggings-army-green')
    await chooseSize(o.pg, 'L'); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForTimeout(2500)
    const t = await o.pg.evaluate(() => document.querySelector('.action-bar > .btn').textContent.trim()); await o.ctx.close()
    is(t === 'Sold out', `in bag without the add-on: the app says "${t}" for a piece the shopper just added (the bug is real)`, t)
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 7 dark
  if (want('7')) {
  head('7  dark theme')
  for (const lang of LANGS) {
    const o = await open('with', { lang, w: 390, h: 780, dark: true }); await pdp(o); await o.pg.evaluate(INSTALL)
    const dk = await o.pg.evaluate(() => document.documentElement.getAttribute('data-theme'))
    const a = await o.pg.evaluate(PROBE_BAR)
    is(dk === 'dark' && a.buyRatio >= 7 && a.afterRatio >= 4.5 && a.buyBg === 'rgba(0, 0, 0, 0)', `dark ${lang}: Buy now is outlined white (${f1(a.buyRatio)}:1), "${a.after}" ${f1(a.afterRatio)}:1`, JSON.stringify([dk, a.buyRatio, a.afterRatio, a.buyBg]))
    await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').click()
    await o.pg.waitForSelector('.product-purchase-row .btn-primary[data-sporta-state="added"]', { timeout: 30000 })
    const b = await o.pg.evaluate(() => { const { contrast, ratio, rgba, bgOf } = window.__h; const add = document.querySelector('.product-purchase-row .btn-primary'); return { bg: getComputedStyle(add).backgroundColor, ratio: contrast(add, 'color', '::after'), check: ratio(rgba(getComputedStyle(add, '::before').borderRightColor), bgOf(add)) } })
    is(b.bg === WHITE && b.ratio >= 12 && b.check >= 4.5, `dark ${lang}: "Added" inverts to white with the check at ${f1(b.check)}:1 and the label ${f1(b.ratio)}:1`, JSON.stringify(b))
    await o.ctx.close()
  }
  {
    const o = await open('with', { lang: 'en', w: 390, h: 780, dark: true }); await pdp(o, 'cagliari-calcio-backpack'); await o.pg.evaluate(INSTALL)
    const m = await o.pg.evaluate(PROBE_BAR); await o.ctx.close()
    is(m.buyDis && m.buyRatio >= 7, `dark sold out: the label is ${f1(m.buyRatio)}:1`, f1(m.buyRatio))
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 8 cards
  if (want('8')) {
  head('8  cards: a product with no sizes adds in place and answers; a product with sizes only navigates')
  {
    // the first page of /shop, the real stock list: the cards whose button is live (sold-out ones are drawn disabled and hidden)
    const o = await open('with', { lang: 'en', w: 390, h: 780 })
    await o.pg.goto(`${o.base}/shop?lang=en`, { waitUntil: 'load' })
    await o.pg.waitForSelector('.catalog-card-add:not([disabled])', { state: 'attached', timeout: 90000 }); await o.pg.waitForTimeout(1500)
    const live = await o.pg.evaluate(() => [...document.querySelectorAll('.product-grid-card')].filter((a) => { const b = a.querySelector('.catalog-card-add'); return b && !b.disabled }).map((a) => a.querySelector('a[href^="/product/"]').getAttribute('href').split('/').pop()))
    await o.ctx.close()
    if (live.length >= 2) noSize.slug = live[1]
    note('card test products: sized = ' + live[0] + ', no size rows (stock list edited) = ' + noSize.slug)
  }
  for (const lang of LANGS) {
    const o = await open('cards', { lang, w: 390, h: 780 })
    await o.pg.goto(`${o.base}/shop?lang=${lang}`, { waitUntil: 'load' })
    await o.pg.waitForSelector('.catalog-card-add:not([disabled])', { state: 'attached', timeout: 90000 }); await o.pg.waitForTimeout(1500)
    const names = await o.pg.evaluate(() => [...document.querySelectorAll('.product-grid-card')].map((a) => { const l = a.querySelector('a[href^="/product/"]'), b = a.querySelector('.catalog-card-add'); return { slug: l && l.getAttribute('href').split('/').pop(), label: b && b.getAttribute('aria-label') } }))
    const CHOOSE = lang === 'ar' ? 'اختر المقاس' : 'Choose size'
    const plain = names.find((n) => n.slug === noSize.slug), sized = names.find((n) => n.slug !== noSize.slug && n.label && n.label.startsWith(CHOOSE))
    is(plain && plain.label.startsWith(lang === 'ar' ? 'أضف' : 'Add') && sized && !sized.label.startsWith(lang === 'ar' ? 'أضف' : 'Add'), `cards ${lang}: the unsized card's button is "Add" and a sized card's is "${sized && sized.label.split(' — ')[0]}" (a link to the page)`, JSON.stringify([plain, sized]))
    // a sized card: tap navigates, nothing is stored, no notice
    const sizedBtn = o.pg.locator(`.product-grid-card:has(a[href="/product/${sized.slug}"]) .catalog-card-add`)
    await sizedBtn.scrollIntoViewIfNeeded(); await sizedBtn.click()
    await o.pg.waitForURL(new RegExp(`/product/${sized.slug}`), { timeout: 30000 })
    const n0 = qtyOf(await bagOf(o.pg)), toast0 = await o.pg.evaluate(() => !!document.querySelector('.sporta-u3-toast[data-open]'))
    is(n0 === 0 && !toast0, `cards ${lang}: a sized card's button only navigates to the product page; the bag is empty and nothing says "added"`, JSON.stringify([n0, toast0]))
    await o.pg.goto(`${o.base}/shop?lang=${lang}`, { waitUntil: 'load' }); await o.pg.waitForSelector('.catalog-card-add:not([disabled])', { state: 'attached', timeout: 90000 }); await o.pg.waitForTimeout(1500)
    const addBtn = o.pg.locator(`.product-grid-card:has(a[href="/product/${noSize.slug}"]) .catalog-card-add`)
    await addBtn.scrollIntoViewIfNeeded(); await addBtn.click()
    const m = await o.pg.evaluate(async () => { for (let i = 0; i < 3000 && !(document.querySelector('.sporta-u3-toast[data-open]') && document.querySelector('.navbar-cart[data-sporta-bump]')); i++) await new Promise((r) => setTimeout(r, 10)); return ({ text: document.querySelector('.sporta-u3-toast__text').textContent, bump: document.querySelector('.navbar-cart').hasAttribute('data-sporta-bump'), badge: document.querySelector('.navbar-cart > span') && document.querySelector('.navbar-cart > span').textContent, bottom: document.querySelector('.sporta-u3-toast').getBoundingClientRect().bottom, vh: innerHeight }) })
    await o.pg.waitForFunction(() => document.querySelector('.sporta-u3-live').textContent.length > 0, null, { timeout: 10000 }).catch(() => {})
    const live = await o.pg.evaluate(() => document.querySelector('.sporta-u3-live').textContent)
    const bag = await bagOf(o.pg)
    is(qtyOf(bag) === 1 && bag[0].slug === noSize.slug && bag[0].size === null && m.badge === '1' && m.bump && m.text.includes(WORDS[lang].addLong), `cards ${lang}: the quick add stores one piece and gets the same answer (badge ${m.badge}, pulse, notice "${m.text}")`, JSON.stringify([bag, m]))
    is(live.includes(WORDS[lang].addLong) && live.includes(bag[0].name[lang]) && m.bottom <= m.vh - 8, `cards ${lang}: announced "${live}"; the notice sits at the foot of the screen (no buy bar on this page)`, JSON.stringify([live, m.bottom, m.vh]))
    await o.ctx.close()
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 10 CLS, reduced motion, keyboard
  if (want('10')) {
  head('10  no layout shift, reduced motion, keyboard focus')
  for (const v of ['with', 'without']) {
    const o = await open(v, { lang: 'ar', w: 390, h: 780 }); await pdp(o)
    await chooseSize(o.pg)
    await o.pg.evaluate(() => { window.__t0 = performance.now() })
    await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForTimeout(2800)
    // an unanswered tap with no size in the same page too
    const cls = await o.pg.evaluate(() => window.__shifts.filter((s) => s.t >= window.__t0).reduce((n, s) => n + s.v, 0))
    await o.ctx.close()
    if (v === 'with') is(cls === 0, `CLS from the add flow with the add-on: ${cls}`, String(cls))
    else note(`CLS in the same flow without the add-on: ${f1(cls * 1000) / 1000} (informational: late images and fonts of the bundle, not the add)`)
  }
  {
    const o = await open('with', { lang: 'en', w: 390, h: 780 }); await pdp(o)
    await o.pg.evaluate(() => { window.__t0 = performance.now() })
    await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForSelector('#product-size-options > p[role="alert"]', { timeout: 30000 }); await o.pg.waitForTimeout(1200)
    const cls = await o.pg.evaluate(() => window.__shifts.filter((s) => s.t >= window.__t0).reduce((n, s) => n + s.v, 0))
    await o.ctx.close()
    is(cls === 0, `CLS from the "choose a size" answer: ${cls} (the bundle's own message adds a line inside a reserved box)`, String(cls))
  }
  {
    const o = await open('with', { lang: 'en', w: 390, h: 780, reduced: true }); await pdp(o)
    await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').click()
    await o.pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 30000 })
    const m = await o.pg.evaluate(() => { const cart = document.querySelector('.navbar-cart'), t = document.querySelector('.sporta-u3-toast'), cs = getComputedStyle(t); return { bump: cart.hasAttribute('data-sporta-bump') ? getComputedStyle(cart.querySelector(':scope > svg')).animationName : 'gone', dur: cs.transitionDuration, tr: cs.transform, state: document.querySelector('.product-purchase-row .btn-primary').getAttribute('data-sporta-state') } })
    is(m.bump === 'none' || m.bump === 'gone', `reduced motion: no pulse on the header bag (${m.bump})`, m.bump)
    is(await o.pg.evaluate(() => window.__vib) === 0, 'reduced motion: no haptic pulse either', '')
    is(m.dur.split(',').every((d) => parseFloat(d) <= 0.001) && (m.tr === 'none' || m.tr === 'matrix(1, 0, 0, 1, 0, 0)'), `reduced motion: the notice does not slide (transition ${m.dur}, transform ${m.tr}); the words still change (${m.state})`, JSON.stringify(m))
    await o.ctx.close()
  }
  {
    // hover on the desktop row: the brand file's deep orange with white, 5.46:1
    for (const dark of [false, true]) {
      const o = await open('with', { lang: 'en', w: 1280, h: 900, dark }); await pdp(o); await o.pg.evaluate(INSTALL)
      await chooseSize(o.pg)
      await o.pg.locator('.product-purchase-row .btn-primary').hover()
      // the bundle fades the ground over .2s; wait inside the page until it has arrived (a loaded machine stretches the fade)
      const m = await o.pg.evaluate(async () => { const a = document.querySelector('.product-purchase-row .btn-primary'); for (let i = 0; i < 400 && getComputedStyle(a).backgroundColor !== 'rgb(184, 67, 15)'; i++) await new Promise((r) => setTimeout(r, 10)); return { bg: getComputedStyle(a).backgroundColor, ratio: window.__h.contrast(a) } })
      is(m.bg === 'rgb(184, 67, 15)' && m.ratio >= 4.5, `hover ${dark ? 'dark' : 'light'} 1280: Add turns deep orange with white text, ${f1(m.ratio)}:1`, JSON.stringify(m))
      await o.ctx.close()
    }
  }
  {
    // keyboard: Add then Buy now, a focus ring of 3:1 or more against the bar, light and dark
    for (const dark of [false, true]) {
      const o = await open('with', { lang: 'en', w: 390, h: 780, dark }); await pdp(o); await o.pg.evaluate(INSTALL)
      await chooseSize(o.pg)
      await o.pg.keyboard.press('Shift')
      const m = await o.pg.evaluate(async () => {
        const { ratio, rgba, bgOf } = window.__h, bar = document.querySelector('.action-bar')
        const add = document.querySelector('.product-purchase-row .btn-primary'), buy = bar.querySelector(':scope > .btn')
        const ring = (b) => { const c = getComputedStyle(b); return { style: c.outlineStyle, w: parseFloat(c.outlineWidth), off: parseFloat(c.outlineOffset), ratio: ratio(rgba(c.outlineColor), bgOf(bar)) } }
        const out = {}
        add.focus({ focusVisible: true }); await new Promise((r) => setTimeout(r, 50)); out.add = ring(add); out.addFocus = add.matches(':focus-visible')
        buy.focus({ focusVisible: true }); await new Promise((r) => setTimeout(r, 50)); out.buy = ring(buy); out.buyFocus = buy.matches(':focus-visible')
        return out
      })
      is(m.addFocus && m.buyFocus && m.add.style === 'solid' && m.add.w >= 2 && m.add.ratio >= 3 && m.buy.ratio >= 3, `focus ring ${dark ? 'dark' : 'light'}: 2px solid, ${f1(m.add.ratio)}:1 (Add) and ${f1(m.buy.ratio)}:1 (Buy now) against the bar`, JSON.stringify(m))
      await o.ctx.close()
    }
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 11 throws / blocked
  if (want('11')) {
  head('11  the page works with the add-on script throwing or blocked')
  for (const v of ['throws', 'blocked']) {
    const o = await open(v, { lang: 'en', w: 390, h: 780 }); await pdp(o); await o.pg.evaluate(INSTALL)
    const a = await o.pg.evaluate(PROBE_BAR)
    const geo = barOk(a, 390)
    is(geo.ok && a.state === null && a.addText === 'Add', `${v}: the bar (CSS only) still holds Add and Buy now, the label is the bundle's "${a.addText}"`, geo.detail)
    await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForTimeout(2000)
    const n = qtyOf(await bagOf(o.pg))
    const st = await o.pg.evaluate(() => ({ s: document.querySelector('.product-purchase-row .btn-primary').getAttribute('data-sporta-state'), t: !!document.querySelector('.sporta-u3-toast') }))
    is(n === 1 && st.s === null && !st.t, `${v}: Add still adds one piece (${n}) and nothing of the script's answer appears`, JSON.stringify([n, st]))
    if (v === 'throws') is(o.errs.length === 0, 'throws: the script fails inside its start (the variant raises there) and its own try/catch swallows it: no page error, no half-built state', JSON.stringify(o.errs))
    else is(o.errs.length === 0, 'blocked: no page error', JSON.stringify(o.errs))
    await o.ctx.close()
  }
  {
    const o = await open('with', { lang: 'en', w: 390, h: 780 }); await pdp(o)
    is(o.errs.length === 0, 'with the add-on: no page error on the product page', JSON.stringify(o.errs))
    await o.ctx.close()
  }
  flush()
  }

  // -------------------------------------------------------------------------------------------------------- 9 POST identity
  if (!process.env.ADD_UX_SKIP_POST && want('9')) {
    head('9  the order POST is BYTE-IDENTICAL with the add-on, without it, with its script throwing and with its script blocked')
    const place = async (variant, lang) => {
      POSTS.length = 0
      const o = await open(variant, { lang, w: 390, h: 844, seed: true }); const { pg } = o
      await pdp(o)
      await chooseSize(pg, 'M')
      await pg.locator('.product-purchase-row .btn-primary').click()
      await pg.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('sporta_cart') || '[]').length > 0 } catch (e) { return false } }, null, { timeout: 60000 }); await pg.waitForTimeout(600)
      await pg.locator('.action-bar > .btn').click()
      await pg.waitForURL(/\/checkout/, { timeout: 60000 }); await pg.waitForSelector('input[name=name]', { timeout: 60000 })
      await pg.fill('input[name=name]', 'Test Shopper'); await pg.fill('input[name=tel]', '55512345')
      await pg.waitForFunction(() => document.querySelectorAll('select[name=address-level1] option').length > 3); await pg.waitForTimeout(400); await pg.selectOption('select[name=address-level1]', 'hawalli'); await pg.waitForTimeout(300)   // by value: option 1 is whichever governorate has loaded first, and two runs then differ in the body (a flake, not an add-on effect)
      await pg.fill('input[name=address-level2]', 'Salmiya'); await pg.fill('input[name=address-line2]', '5'); await pg.fill('input[name=address-line1]', 'Salem Street'); await pg.fill('input[name=address-line3]', '12')
      const step = async () => { const b = pg.locator('button[type=submit]:visible:not([disabled])').first(); await b.waitFor({ timeout: 30000 }); await b.click(); await pg.waitForTimeout(800) }
      // with the checkout's ONEPAGE block the first press already lands on Review (the method chosen on the delivery screen is carried through the app's own Payment screen)
      await step(); await pg.waitForTimeout(900); if (!(await pg.locator('.purchase-review-block').count())) await step()
      const final = pg.locator('button[type=submit]:visible:not([disabled])').first(); await final.waitFor({ timeout: 30000 }); await final.click()
      for (let i = 0; i < 900 && !POSTS.some((x) => x.route === 'order'); i++) await new Promise((r) => setTimeout(r, 100))
      await pg.waitForURL(/payment\/result/, { timeout: 60000 }).catch(() => {})
      const stored = await pg.evaluate(() => localStorage.getItem('sporta_cart'))
      const res = { url: pg.url(), routes: POSTS.map((x) => x.route).join(), order: POSTS.filter((x) => x.route === 'order').map((x) => x.body), quote: POSTS.filter((x) => x.route === 'discount').map((x) => x.body), stored, errs: o.errs.slice() }
      await o.ctx.close(); return res
    }
    for (const lang of ['ar', 'en']) {
      const R = {}
      for (const v of lang === 'ar' ? ['with', 'without', 'throws', 'blocked'] : ['with', 'without']) R[v] = await place(v, lang)
      const j = R.with.order.length ? JSON.parse(R.with.order[0]) : {}
      is(R.with.order.length === 1 && j.payment_method === 'cod' && j.items.length === 1 && j.items[0].slug === 'sgomma-t-shirt-navy' && j.items[0].size === 'M' && j.items[0].qty === 2, `order ${lang}: one POST, cash on delivery, one line (size M) of two pieces: the Add button's and the Buy now button's`, JSON.stringify(R.with.order).slice(0, 300))
      for (const v of Object.keys(R).filter((x) => x !== 'with')) is(R[v].order.length === 1 && R[v].order[0] === R.with.order[0], `order ${lang}: the order POST with the add-on is byte-identical to the one ${v === 'without' ? 'without it' : v === 'throws' ? 'with its script throwing' : 'with its script blocked'} (${(R.with.order[0] || '').length} bytes)`, `${R[v].order[0]} vs ${R.with.order[0]} | ${v}: url ${R[v].url} routes ${R[v].routes} errs ${JSON.stringify(R[v].errs)}`)
      for (const v of Object.keys(R).filter((x) => x !== 'with')) is(R[v].quote.length >= 1 && JSON.stringify(R[v].quote) === JSON.stringify(R.with.quote), `order ${lang}: the quote request is byte-identical too (${v})`, '')
      is(Object.keys(R).every((v) => R[v].stored === R.with.stored), `order ${lang}: the stored bag is identical after the same taps in every variant`, JSON.stringify(R.with.stored).slice(0, 200))
      is(!(R.with.order[0] || '').includes('"price"') && Object.keys(j.items[0] || {}).every((k) => ['slug', 'qty', 'size', 'fit'].includes(k)), `order ${lang}: the body names no price: slug, size, fit and quantity per line (the server prices the bag)`, Object.keys(j.items[0] || {}).join())
      is(R.with.errs.length === 0 && R.blocked?.errs.length !== 1, `order ${lang}: no page error with the add-on`, JSON.stringify(R.with.errs))
    }
    flush()
  }

  // -------------------------------------------------------------------------------------------------------- 12 review round
  if (want('12')) {
    head('12  review round: big text, an add after a removal, a navigation inside the Added window')
    for (const lang of LANGS) for (const w of [320, 360, 390]) for (const fs of [130, 160]) {
      const r = await CHECKS.bigText('with', lang, w, fs)
      is(r.ok, `big text ${lang} ${w}px at ${fs}%: Add, price and Buy now never overlap, Buy now is a real button (44px+, label not clipped), Add level with it, nothing outside the screen`, r.detail)
    }
    for (const lang of LANGS) {
      const r = await CHECKS.toastBig('with', lang)
      is(r.ok, `big text ${lang} 320px at 130%: the notice keeps its words whole (one line for "${WORDS[lang].addLong}"), stays inside the screen, sits 12px above the taller bar, View bag 44px+`, r.detail)
    }
    {
      const r = await CHECKS.toastSmall('with')
      is(r.ok, 'the notice\'s second line (the product name) is 14px, the phone floor for body text', r.detail)
    }
    {
      const r = await CHECKS.afterRemoval('with')
      is(r.ok, 'an add after the same bag was emptied in the drawer is announced again (live region names the new size, Added look, notice)', r.detail)
    }
    {
      const r = await CHECKS.otherProduct('with')
      is(r.ok, 'going to another product inside the Added window does not leave "Added" on a product that was not added', r.detail)
    }
    flush()
  }

  // -------------------------------------------------------------------------------------------------------- mutation
  if (!process.env.ADD_UX_SKIP_MUTANTS && (want('M') || want('MJ'))) {
    head('M  mutation: the checks fail without the change, and every CSS block is needed')
    if (!onlyJs) {
    // the whole CSS section / the whole script block
    for (const [name, label] of [['without', 'both removed'], ['cssOnly', 'script removed (CSS kept)'], ['jsOnly', 'CSS section removed (script kept)']]) {
      const failing = []
      for (const id of BLOCKS) { const r = await runProbe(id, name); if (!r.ok) failing.push(id) }
      if (name === 'without') is(failing.length === BLOCKS.length, `mutation, ${label}: all ${BLOCKS.length} block probes fail (${failing.join(',')})`, `failing: ${failing}`)
      else if (name === 'cssOnly') is(failing.includes('u3-3') && failing.includes('u3-4') && failing.includes('u3-6'), `mutation, ${label}: the probes that need the script fail (${failing.join(',')})`, `failing: ${failing}`)
      else is(failing.length >= 5 && failing.includes('u3-1') && failing.includes('u3-5'), `mutation, ${label}: the probes that need the CSS fail (${failing.join(',')})`, `failing: ${failing}`)
      flush()
    }
    }
    {
      // the two behaviours of the script that no CSS block covers: each must be needed
      const guard = async (variant) => { const o = await open(variant, { lang: 'en', w: 390, h: 780 }); await pdp(o); await chooseSize(o.pg); await o.pg.locator('.product-purchase-row .btn-primary').dblclick(); await o.pg.waitForTimeout(2200); const n = qtyOf(await bagOf(o.pg)); await o.ctx.close(); return n }
      const inbag = async (variant) => { const o = await open(variant, { lang: 'en', w: 390, h: 780 }); await pdp(o, 'cloudsoft-leggings-army-green'); await chooseSize(o.pg, 'L'); await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForTimeout(3200); const t = await o.pg.evaluate(() => document.querySelector('.action-bar > .btn').getAttribute('data-sporta-state')); await o.ctx.close(); return t }
      const g1 = await guard('with'), g0 = await guard('noGuard')
      is(g1 === 1 && g0 === 2, `mutation: the double-tap guard is needed (with it ${g1} piece, with the guard cut out ${g0})`, '')
      const i1 = await inbag('with'), i0 = await inbag('noInbag')
      is(i1 === 'inbag' && i0 === null, `mutation: the "In your bag" state is needed (with it "${i1}", with the state cut out "${i0}")`, '')
      flush()
    }
    {
      // review round: each behaviour added after the first independent review must be needed
      const pair = async (label, fn, variant, args = []) => {
        const base = await fn('with', ...args), cut = await fn(variant, ...args)
        is(base.ok && !cut.ok, `mutation: ${label} passes with it and FAILS with it cut out`, `with: ${base.detail.slice(0, 160)} | cut: ${cut.detail.slice(0, 260)}`)
        flush()
      }
      await pair('the bar breaking into two lines at big text (en 360px, 130%)', CHECKS.bigText, 'noBarWrap', ['en', 360, 130])
      await pair('the notice dropping its button under the text (en 320px, 130%)', CHECKS.toastBig, 'noToastWrap', ['en'])
      await pair('the notice following the bar\'s real height (en 320px, 130%)', CHECKS.toastBig, 'noBarMeasure', ['en'])
      await pair('the 14px product-name line of the notice', CHECKS.toastSmall, 'noToastSmall')
      await pair('counting the next add from where the bag is now (add, remove, add)', CHECKS.afterRemoval, 'noReportedReset')
      await pair('keeping "Added" to the product it was added on', CHECKS.otherProduct, 'noSlugScope')
    }
    if (!onlyJs) {
    for (const id of BLOCKS) {
      const base = await runProbe(id, 'with')
      const cut = await runProbe(id, 'cut-' + id)
      is(base.ok && !cut.ok, `mutation: block [${id}] passes its probe and the probe FAILS with only that block cut out (${cut.detail})`, `with: ${base.detail}`)
      flush()
    }
    }
  }
} finally {
  await browser.close()
  for (const s of Object.values(servers)) await s.close()
}
flush()
console.log(`\n${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)}s)`)
process.exit(fail ? 1 : 0)
