// npm run test:sog-1112 - proves the SOG-1112 fixes (shadows, overlays and focus; AUDIT-SHADOW-OVERLAY-GLOSS-2026-11-12.md,
// the High and Medium items plus three Low ones) on the REAL compiled client of the captured live storefront (lib/cart-ux-live.mjs:
// the live index.html, bundle and /api JSON with this repo's add-ons) and on the live /backends fixtures with the live dark rules
// (lib/admin-css-full-page.mjs). Every check runs three ways:
//   ON      the repo files
//   OFF     every SOG-1112 section removed (sporta-brand-theme.css gets its old glow back): the "before" numbers, and each check
//           must FAIL there (it measures something the fix changed)
//   MUTANT  one [sog-N] block removed, everything else ON: that block's check must fail (each block is load-bearing)
// The blocks:
//   [sog-1]  sporta-product-fix.css   product page < 768px: no Tab stop hidden under the fixed buy bar (Tab walk, ar + en)
//   [sog-2]  sporta-checkout-a11y.js  checkout: the visually hidden step indicator is not a Tab stop (390 + 1280, ar + en); it
//                                     stays in the accessibility tree; /cart keeps its visible steps focusable
//   [sog-3]  sporta-shadows.css       /cart and drawer steppers: the focus ring is not clipped by the pill (ring pixels)
//   [sog-4]  sporta-shadows.css       drawer backdrop: no blur, still dims, stacking / scroll lock / focus trap / click-to-close
//   [sog-5]  sporta-shadows.css       category tile copy >= 4.5:1 (3:1 large) in every 10% strip (390 / 768 / 1024 / 1280 /
//                                     1440px; with the repo sporta-cat-tiles.css and with it minus its unreviewed GRIDSTYLE)
//   [sog-5b] sporta-shadows.css       English phone tile briefs >= 4.5:1
//   [sog-6]  sporta-brand-theme.css   selected payment method: brand ring + charcoal elevation, no orange glow (light + dark)
//   [sog-7a/b/c] addons-src/sporta-admin-knet.css  /backends dark: cards keep a visible shadow (Payments stays light), modal
//                                     backdrops dim, modal panels have an edge
//   [sog-8]  sporta-shadows.css       >= 1024px: focus brought in from above is not hidden under the sticky header
//   [sog-10] [sog-11] [sog-12]        dark tile / feature depth, dark stepper bevel, blur on opaque surfaces removed
// plus static checks of the files (sections where they belong, the generated admin file current).
//   SOG_TABLE=<file>  writes the before / after numbers (JSON)
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveLive, liveDir, BAG } from './lib/cart-ux-live.mjs'
import { serve as serveAdmin, addons as adminAddons, knetSource, knetServed, KNET } from './lib/admin-css-full-page.mjs'
import { png } from './lib/png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const read = (f) => readFileSync(f, 'utf8')
let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')) } console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}${detail ? '  (' + detail + ')' : ''}`); return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 72 - t.length))}`)
const TABLE = {}
const note = (k, v) => { TABLE[k] = v }

// ---- the files and their states ------------------------------------------------------------------------------------------------
const MARK = '/* ==== SOG-1112', END = '/* ==== end SOG-1112 */'
const F = {
  shadows: 'sporta-shadows.css', product: 'sporta-product-fix.css', theme: 'sporta-brand-theme.css', js: 'sporta-checkout-a11y.js',
}
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, read(join(PUB, f))]))
const OLD_GLOW = '.purchase-payment .payment-method--selected {\n  box-shadow: 0 5px 16px -12px rgba(184, 67, 15, 0.9);\n}'
const cutSection = (t, restore = '') => {
  const a = t.indexOf(MARK), b = t.indexOf(END)
  if (a < 0 || b < a) throw new Error('no SOG-1112 section')
  return t.slice(0, a) + restore + t.slice(b + END.length)
}
// one block: from "/* [sog-N]" (or "/* ==== SOG-1112 [sog-N]") to the next block or the end marker
const cutBlock = (t, tag) => {
  const re = new RegExp(`/\\* (==== SOG-1112 )?\\[${tag}\\]`)
  const m = re.exec(t); if (!m) return null
  const a = m.index
  const rest = t.slice(a + 4)
  const nx = rest.search(/\/\* \[sog-|\/\* ==== end SOG-1112 \*\//)
  const b = a + 4 + nx
  let out = t.slice(0, a) + t.slice(b)
  return out
}
const SHIPPED_CAT_TILES = read(join(PUB, 'sporta-cat-tiles.css'))
const NO_GRIDSTYLE = (() => { const a = SHIPPED_CAT_TILES.indexOf('/* ==== GRIDSTYLE'), b = SHIPPED_CAT_TILES.indexOf('/* ==== SIZES: HOME PAGE'); return a > 0 && b > a ? SHIPPED_CAT_TILES.slice(0, a) + SHIPPED_CAT_TILES.slice(b) : null })()

const OFF = {
  css: {
    [F.shadows]: cutSection(SRC.shadows), [F.product]: cutSection(SRC.product), [F.theme]: cutSection(SRC.theme, OLD_GLOW),
  },
  js: { [F.js]: cutSection(SRC.js) },
}
const BLOCK_FILE = { 'sog-1': 'product', 'sog-2': 'js', 'sog-3': 'shadows', 'sog-4': 'shadows', 'sog-5': 'shadows', 'sog-5b': 'shadows', 'sog-6': 'theme', 'sog-8': 'shadows', 'sog-10': 'shadows', 'sog-11': 'shadows', 'sog-12': 'shadows' }
const mutant = (tag) => {
  const k = BLOCK_FILE[tag]
  if (k === 'theme') return { css: { [F.theme]: cutSection(SRC.theme, OLD_GLOW) }, js: {} }
  if (k === 'product') return { css: { [F.product]: cutSection(SRC.product) }, js: {} }   // the section is the one block
  const t = cutBlock(SRC[k], tag)
  if (!t) throw new Error('no block ' + tag)
  return k === 'js' ? { css: {}, js: { [F.js]: t } } : { css: { [F[k]]: t }, js: {} }
}

// ---- static ----------------------------------------------------------------------------------------------------------------------
head('files')
{
  const s = SRC.shadows
  is(s.indexOf(MARK) > 0 && s.indexOf(MARK) < s.indexOf('/* ==== ICON SET') && s.indexOf(END) < s.indexOf('/* ==== ICON SET'), 'sporta-shadows.css: SOG-1112 is one section before ICON SET')
  for (const t of ['sog-3', 'sog-4', 'sog-5', 'sog-5b', 'sog-8', 'sog-10', 'sog-11', 'sog-12']) is(s.includes(`/* [${t}]`), `sporta-shadows.css carries [${t}]`)
  is(SRC.product.includes('[sog-1]') && SRC.product.trimEnd().endsWith(END), 'sporta-product-fix.css: [sog-1] is the last section')
  is(SRC.theme.includes('[sog-6]') && !SRC.theme.includes('rgba(184, 67, 15, 0.9)'), 'sporta-brand-theme.css: [sog-6] replaced the orange glow (no rgba(184,67,15,.9) left)')
  is(SRC.js.includes('[sog-2]') && SRC.js.trimEnd().endsWith(END), 'sporta-checkout-a11y.js: [sog-2] is the last block')
  is(!read(join(PUB, 'sporta-cat-tiles.css')).includes('sog-'), 'sporta-cat-tiles.css (unreviewed WIP) is not touched')
  const src = knetSource()
  is(src.includes(MARK) && src.indexOf(MARK) < src.indexOf('/* ==== SIZES: /backends compact density'), 'addons-src/sporta-admin-knet.css: SOG-1112 before the SIZES section')
  for (const t of ['sog-7a', 'sog-7b', 'sog-7c']) is(src.includes(`/* [${t}] */`), `admin source carries [${t}]`)
  const sog = src.slice(src.indexOf(MARK), src.indexOf(END))
  const rules = sog.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter(Boolean)
  // every rule is dark-only; the card and panel rules leave the Payments screen out (the backdrop is an overlay, and
  // test:admin-light forbids a near-black background on any selector naming the Payments screen, an exclusion included)
  is(rules.length === 3 && rules.every((r) => r.startsWith(':is(html.dark, html[data-theme="dark"])')) && rules[0].includes(':not(:has(.payment-settings))') && rules[2].includes(':not(:has(.payment-settings))') && !/payment/.test(rules[1]), 'every admin SOG-1112 rule is dark-only; cards and panels leave the Payments screen out', String(rules.length))
  let gen = true
  try { execFileSync(process.execPath, [join(ROOT, 'scripts/build-addon-css.mjs'), '--check'], { stdio: 'pipe' }) } catch { gen = false }
  is(gen, 'public/sporta-admin-knet.css is what addons-src builds (build-addon-css --check)')
  for (const [k, f] of Object.entries(F)) if (k !== 'js') {
    const sec = SRC[k].slice(SRC[k].indexOf(MARK), SRC[k].indexOf(END))
    is(!/#(?:e11d48|be123c|ef4444|dc2626|f43f5e)/i.test(sec) && !/\b(left|right)\s*:/.test(sec.replace(/\/\*[\s\S]*?\*\//g, '')), `${f}: no red, no physical left/right in SOG-1112`)
  }
}

if (!liveDir()) { console.log('\nno live capture (SPORTA_LIVE_CAPTURE): the storefront sections are skipped'); }

// ---- the storefront rig --------------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const state = { css: {}, js: {} }
let live = null
if (liveDir()) live = await serveLive({ css: state.css, js: state.js })
const setState = (s) => {
  for (const k of Object.keys(state.css)) delete state.css[k]
  for (const k of Object.keys(state.js)) delete state.js[k]
  Object.assign(state.css, s.css || {}); Object.assign(state.js, s.js || {})
}
// a context close that cannot hang the run (a page stuck in a long task once kept ctx.close() waiting for minutes)
const safeClose = (ctx) => { const close = ctx.close.bind(ctx); ctx.close = () => Promise.race([close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]) }
const PHONE = { w: 390, h: 844, touch: true }, DESK = { w: 1280, h: 900, touch: false }
async function open(v, lang, path, { theme = 'light', still = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.touch, isMobile: v.touch, deviceScaleFactor: 1, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.addInitScript(({ bag, theme }) => { try { localStorage.setItem('sporta_cart', JSON.stringify(bag)); localStorage.setItem('sporta_theme', theme); localStorage.setItem('sporta_theme_explicit', '1') } catch {} }, { bag: BAG, theme })
  await ctx.route((u) => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), (r) => r.abort())
  safeClose(ctx)
  const pg = await ctx.newPage()
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  await pg.goto(live.base + path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'load' })
  await pg.waitForTimeout(1300)
  await pg.addStyleTag({ content: 'html,body{scroll-behavior:auto!important}' + (still ? '*{transition:none!important;animation:none!important}' : '') })
  return { ctx, pg }
}
const lumN = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const crN = (a, b) => { const x = lumN(a), y = lumN(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 4).map(Number)

// A Tab walk; for every stop, whether its centre is covered by something matching `coverSel` (and the stop is not inside it).
async function tabWalk(pg, n, coverSel, { reverse = false, skipSel = null } = {}) {
  const stops = []
  for (let i = 0; i < n; i++) {
    await pg.keyboard.press(reverse ? 'Shift+Tab' : 'Tab')
    let r = null
    try {
      r = await pg.evaluate(([coverSel, skipSel]) => {
        const a = document.activeElement; if (!a || a === document.body) return null
        const lab = (el) => el.tagName.toLowerCase() + ((el.getAttribute('class') || '').split(/\s+/).filter((k) => k && !/[:/[\]]/.test(k)).slice(0, 2).map((k) => '.' + k).join(''))
        const b = a.getBoundingClientRect()
        const inSteps = !!a.closest('nav.purchase-steps')
        if (skipSel && a.closest(skipSel)) return { el: lab(a), skip: true, inSteps }
        if (b.width < 1 || b.height < 1) return { el: lab(a), zero: true, inSteps }
        const x = b.left + b.width / 2, y = b.top + b.height / 2
        let covered = false, by = null
        if (y < 0 || y > innerHeight) { covered = true; by = 'offscreen' }
        else {
          const h = document.elementFromPoint(x, y)
          if (h && h !== a && !a.contains(h) && !h.contains(a)) { const c = h.closest(coverSel); if (c && !c.contains(a)) { covered = true; by = lab(c) } }
        }
        return { el: lab(a), text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 20), y: Math.round(b.top), covered, by, inSteps, path: location.pathname }
      }, [coverSel, skipSel])
    } catch { break }
    if (r) stops.push(r)
  }
  return stops
}

// ring pixels of the focused control as the page is, and with every ancestor overflow:visible
const countCol = (img, col) => { let n = 0; for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const p = img.at(x, y); if (Math.abs(p.r - col[0]) < 30 && Math.abs(p.g - col[1]) < 30 && Math.abs(p.b - col[2]) < 30) n++ } return n }
async function ringKept(pg, sel) {
  const info = await pg.evaluate(async (sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0 && !x.disabled); if (!e) return null
    e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 100))
    document.querySelectorAll('[data-sog-ring]').forEach((x) => x.removeAttribute('data-sog-ring')); e.dataset.sogRing = '1'
    e.focus({ focusVisible: true })
    const c = getComputedStyle(e), r = e.getBoundingClientRect()
    return { col: c.outlineColor, oo: c.outlineOffset, fv: e.matches(':focus-visible'), r: { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 } }
  }, sel)
  if (!info) return null
  const col = rgb(info.col)
  const a = countCol(png(await pg.screenshot({ clip: info.r })), col)
  await pg.evaluate(() => { const e = document.querySelector('[data-sog-ring]'); for (let p = e.parentElement; p; p = p.parentElement) p.style.setProperty('overflow', 'visible', 'important') })
  const b = countCol(png(await pg.screenshot({ clip: info.r })), col)
  await pg.evaluate(() => { const e = document.querySelector('[data-sog-ring]'); for (let p = e.parentElement; p; p = p.parentElement) p.style.removeProperty('overflow') })
  return { ...info, px: a, unclipped: b, kept: b ? Math.round(100 * a / b) : 0 }
}

// shadow visibility: largest channel difference in a clip around the element with / without its box-shadow
async function shadowDelta(pg, sel, pad = 30) {
  const r = await pg.evaluate(async (sel) => {
    // a box that fits on the screen with room for its shadow, and that has one (the first such)
    const fits = (x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < innerHeight - 100 && getComputedStyle(x).boxShadow !== 'none' }
    const e = [...document.querySelectorAll(sel)].find(fits) || [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null
    e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120))
    document.querySelectorAll('[data-sog-sh]').forEach((x) => x.removeAttribute('data-sog-sh')); e.dataset.sogSh = '1'
    const b = e.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height, vw: document.documentElement.scrollWidth, vh: document.documentElement.scrollHeight, bs: getComputedStyle(e).boxShadow }
  }, sel)
  if (!r) return null
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(r.vw - Math.max(0, r.x - pad), r.w + 2 * pad), height: Math.min(r.vh - Math.max(0, r.y - pad), r.h + 2 * pad) }
  const a = png(await pg.screenshot({ clip, fullPage: true }))
  await pg.evaluate(() => document.querySelector('[data-sog-sh]').style.setProperty('box-shadow', 'none', 'important'))
  const b = png(await pg.screenshot({ clip, fullPage: true }))
  await pg.evaluate(() => document.querySelector('[data-sog-sh]').style.removeProperty('box-shadow'))
  // only the pixels OUTSIDE the box (where a drop shadow falls; an inset or a repaint inside the box is not counted)
  const ix0 = r.x - clip.x, iy0 = r.y - clip.y, ix1 = ix0 + r.w, iy1 = iy0 + r.h
  let max = 0; for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue; const p = a.at(x, y), q = b.at(x, y); max = Math.max(max, Math.abs(p.r - q.r), Math.abs(p.g - q.g), Math.abs(p.b - q.b)) }
  return { delta: max, bs: r.bs }
}

// ---- the checks (each returns { ok, data }) --------------------------------------------------------------------------------------
const C = {}
const PRODUCT = '/product/cloudsoft-jacket-coffee-brown'
const BAR = '.action-bar, .catalog-product-page .product-purchase-row > .btn-primary'
C['sog-1'] = async ({ langs = ['ar', 'en'] } = {}) => {
  const out = {}; let ok = true
  for (const lang of langs) {
    const { ctx, pg } = await open(PHONE, lang, PRODUCT)
    const pad = await pg.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom)
    const stops = await tabWalk(pg, 110, BAR, { skipSel: BAR })
    const hidden = stops.filter((s) => s.covered && s.path.startsWith('/product'))
    out[lang] = { stops: stops.length, hiddenUnderBar: hidden.length, examples: hidden.slice(0, 4).map((s) => `${s.el} y${s.y}`), scrollPaddingBottom: pad }
    ok = ok && stops.length > 40 && hidden.length === 0
    await ctx.close()
  }
  return { ok, data: out }
}
C['sog-2'] = async ({ cfg = [[PHONE, 'ar'], [PHONE, 'en'], [DESK, 'ar'], [DESK, 'en']] } = {}) => {
  const out = {}; let ok = true
  for (const [v, lang] of cfg) {
    const { ctx, pg } = await open(v, lang, '/checkout')
    const tree = await pg.evaluate(() => { const n = document.querySelector('nav.purchase-steps'); const a = n && n.querySelector('a[href]'); const r = n && n.getBoundingClientRect(); return n ? { label: n.getAttribute('aria-label'), clipped: r.width <= 2 || getComputedStyle(n).clipPath === 'inset(50%)', link: !!a, linkTab: a ? a.tabIndex : null, ariaHidden: !!n.closest('[aria-hidden="true"]'), inert: !!n.closest('[inert]') } : null })
    const stops = await tabWalk(pg, 40, 'nav.purchase-steps')
    const onSteps = stops.filter((s) => s.inSteps)
    const zero = stops.filter((s) => s.zero)
    out[`${v.w}${lang}`] = { tree, stops: stops.length, stopsOnHiddenSteps: onSteps.length, zeroBoxStops: zero.length }
    ok = ok && !!tree && tree.clipped && tree.link && !tree.ariaHidden && !tree.inert && onSteps.length === 0 && zero.length === 0 && stops.length > 10
    await ctx.close()
  }
  // /cart shows the indicator: its link stays a Tab stop
  { const { ctx, pg } = await open(PHONE, 'ar', '/cart')
    const c = await pg.evaluate(() => { const n = document.querySelector('nav.purchase-steps'); const a = n && n.querySelector('a[href]'); return n ? { width: Math.round(n.getBoundingClientRect().width), links: n.querySelectorAll('a[href]').length, tab: a ? a.tabIndex : null, marked: n.querySelectorAll('[data-sporta-notab]').length } : null })
    out.cart = c
    ok = ok && (!c || !c.links || (c.width > 2 && c.tab === 0 && c.marked === 0))
    await ctx.close() }
  return { ok, data: out }
}
C['sog-3'] = async ({ langs = ['ar', 'en'], drawer = true } = {}) => {
  const out = {}; let ok = true
  for (const lang of langs) {
    const { ctx, pg } = await open(PHONE, lang, '/cart')
    const r = await ringKept(pg, '.purchase-cart .purchase-quantity button')
    out[`cart390${lang}`] = r && { kept: r.kept, px: r.px, unclipped: r.unclipped, offset: r.oo }
    ok = ok && !!r && r.fv && r.kept >= 90
    await ctx.close()
  }
  if (drawer) for (const v of [PHONE, DESK]) {
    const { ctx, pg } = await open(v, 'ar', '/shop')
    await pg.click('.navbar-cart'); await pg.waitForTimeout(500)
    const r = await ringKept(pg, '.campaign-cart-drawer .purchase-quantity button')
    out[`drawer${v.w}ar`] = r && { kept: r.kept, px: r.px, unclipped: r.unclipped, offset: r.oo }
    ok = ok && !!r && r.kept >= 90
    await ctx.close()
  }
  return { ok, data: out }
}
C['sog-4'] = async ({ cfg = [[DESK, 'ar'], [DESK, 'en'], [PHONE, 'ar']], frames = false } = {}) => {
  const out = {}; let ok = true
  for (const [v, lang] of cfg) {
    const { ctx, pg } = await open(v, lang, '/shop')
    await pg.evaluate(() => scrollTo(0, 600)); await pg.waitForTimeout(150)
    // the page pixel the backdrop covers, before it opens
    const pt = await pg.evaluate(() => { const rtl = document.documentElement.dir === 'rtl'; return { x: rtl ? innerWidth - 20 : 20, y: Math.round(innerHeight / 2) } })
    const before = png(await pg.screenshot({ clip: { x: pt.x - 2, y: pt.y - 2, width: 5, height: 5 } })).at(2, 2)
    await pg.click('.navbar-cart'); await pg.waitForTimeout(600)
    const st = await pg.evaluate(() => {
      const d = document.querySelector('aside.campaign-cart-drawer'), bd = d && d.previousElementSibling
      const c = bd && getComputedStyle(bd), dr = d.getBoundingClientRect(), rtl = document.documentElement.dir === 'rtl'
      const ox = rtl ? dr.right + 20 : dr.left - 20, outside = ox > 0 && ox < innerWidth
      const hitHeader = outside ? document.elementFromPoint(ox, 30) : null
      return { bf: c && c.backdropFilter, wbf: c && c.webkitBackdropFilter, bg: c && c.backgroundColor, z: c && c.zIndex, isBackdrop: !!bd && bd.matches('div.fixed.inset-0.z-40'), outside, ox, headerCoveredByBackdrop: outside ? hitHeader === bd : null, bodyOv: getComputedStyle(document.body).overflow, focusIn: d.contains(document.activeElement), drawerZ: getComputedStyle(d).zIndex }
    })
    const y0 = await pg.evaluate(() => scrollY)
    if (st.outside) { await pg.mouse.move(st.ox, 400); await pg.mouse.wheel(0, 500); await pg.waitForTimeout(250) }
    const y1 = await pg.evaluate(() => scrollY)
    const inside = []
    for (let i = 0; i < 14; i++) { await pg.keyboard.press('Tab'); inside.push(await pg.evaluate(() => document.querySelector('aside.campaign-cart-drawer').contains(document.activeElement))) }
    let after = null, closed = null
    if (st.outside) {
      after = png(await pg.screenshot({ clip: { x: pt.x - 2, y: pt.y - 2, width: 5, height: 5 } })).at(2, 2)
      await pg.mouse.click(st.ox, Math.round(v.h / 2)); await pg.waitForTimeout(500)
      closed = await pg.evaluate(() => { const d = document.querySelector('aside.campaign-cart-drawer'), r = d.getBoundingClientRect(); return !(r.left < innerWidth - 2 && r.right > 2) || /pointer-events-none|translate-x-full/.test(d.className) })
    }
    const a = rgb(st.bg || 'rgb(0,0,0)'), alpha = a.length > 3 ? a[3] : 1
    const dim = after ? +(lumN([after.r, after.g, after.b]) / Math.max(1e-6, lumN([before.r, before.g, before.b]))).toFixed(3) : null
    const rec = { backdropFilter: st.bf, bg: st.bg, alpha, z: st.z, drawerZ: st.drawerZ, headerCoveredByBackdrop: st.headerCoveredByBackdrop, bodyOverflow: st.bodyOv, wheelScrolled: y1 - y0, focusStaysIn: inside.every(Boolean), closedByBackdropClick: closed, luminanceLeft: dim }
    const keep = st.isBackdrop && st.bodyOv === 'hidden' && inside.every(Boolean) && +st.z === 40 && +st.drawerZ === 50 && (!st.outside || (st.headerCoveredByBackdrop && y1 === y0 && closed))
    rec.keepsBehaviour = keep
    out[`${v.w}${lang}`] = rec
    ok = ok && keep && st.bf === 'none' && (st.wbf === undefined || st.wbf === 'none' || st.wbf === '') && alpha >= 0.6 && Math.abs(a[0] - 23) < 2 && Math.abs(a[1] - 26) < 2 && Math.abs(a[2] - 30) < 2 && (dim === null || dim < 0.2)
    await ctx.close()
  }
  if (frames) {
    const { ctx, pg } = await open(DESK, 'ar', '/shop', { still: false })
    const cdp = await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await pg.evaluate(() => { window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (window.__f.length < 400) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    await pg.click('.navbar-cart'); await pg.waitForTimeout(900)
    const f = (await pg.evaluate(() => window.__f.slice(2))).sort((x, y) => x - y)
    out.frames1280x4 = { n: f.length, p50: +f[Math.floor(f.length / 2)].toFixed(1), over33: f.filter((x) => x > 33.4).length }
    await ctx.close()
  }
  return { ok, data: out }
}
// category tiles: WCAG contrast of each text line against the photo + scrim under it, per 10% strip of the tile (p5)
const NO_TEXT = ':is(#zz#zz#zz,*), :is(#zz#zz#zz,*)::before, :is(#zz#zz#zz,*)::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } svg{visibility:hidden!important}'
async function tiles(w, lang) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.route((u) => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), (r) => r.abort())
  safeClose(ctx)
  const pg = await ctx.newPage()
  await pg.goto(live.base + '/' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'load' }); await pg.waitForTimeout(1200)
  await pg.addStyleTag({ content: '*{transition:none!important;animation:none!important}' })
  const T = await pg.evaluate(async () => {
    await document.fonts.ready
    for (const t of document.querySelectorAll('.campaign-category')) { const img = t.querySelector('img'); img.loading = 'eager'; t.scrollIntoView({ block: 'center' }); await new Promise((r) => img.complete ? r() : (img.onload = img.onerror = r, setTimeout(r, 3000))) }
    scrollTo(0, 0)
    // every photo decoded before the screenshot (a tile measured over its dark placeholder reads 8:1 and hides a failure)
    await Promise.all([...document.querySelectorAll('.campaign-category img')].map((i) => i.decode().catch(() => {})))
    // ... and shown: the app fades a photo in (opacity) once its own onLoad has run, which can be after decode()
    for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.campaign-category img')].every((im) => getComputedStyle(im).opacity === '1')) break; await new Promise((r) => setTimeout(r, 50)) }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    if ([...document.querySelectorAll('.campaign-category img')].some((i) => !i.complete || !i.naturalWidth)) throw new Error('a tile photo did not load')
    return [...document.querySelectorAll('.campaign-category')].map((t) => {
      const tr = t.getBoundingClientRect()
      return { tile: t.className.split(' ').find((k) => /^tile-/.test(k)) || t.className.split(' ')[0], r: [tr.left + scrollX, tr.top + scrollY, tr.width, tr.height], texts: [...t.querySelectorAll('.campaign-category__title, .campaign-category__brief')].map((el) => {
        const c = getComputedStyle(el), rects = []
        for (const n of el.childNodes) if (n.nodeType === 3) { const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) rects.push([q.left + scrollX, q.top + scrollY, q.width, q.height]) }
        return { cls: el.className.split(' ')[0].replace('campaign-category__', ''), col: c.color.match(/[\d.]+/g).slice(0, 3).map(Number), large: parseFloat(c.fontSize) >= 24 || (parseFloat(c.fontSize) >= 18.66 && +c.fontWeight >= 700), rects }
      }) }
    })
  })
  await pg.addStyleTag({ content: NO_TEXT }); await pg.waitForTimeout(80)
  const img = png(await pg.screenshot({ fullPage: true }))
  const rows = []
  for (const t of T) for (const tx of t.texts) {
    const buckets = {}
    for (const [x0, y0, ww, hh] of tx.rects) for (let y = Math.floor(y0 + hh * 0.2); y < y0 + hh * 0.8; y += 2) for (let x = Math.floor(x0); x < x0 + ww; x += 2) {
      const p = img.at(x, y); (buckets[Math.floor(10 * (x - t.r[0]) / t.r[2])] ||= []).push(crN(tx.col, [p.r, p.g, p.b]))
    }
    const worst = Object.entries(buckets).filter(([, v]) => v.length >= 6).map(([k, v]) => [+k, v.sort((a, b) => a - b)[Math.floor(v.length * 0.05)]]).sort((a, b) => a[1] - b[1])[0]
    if (worst) rows.push({ tile: t.tile, line: tx.cls, need: tx.large ? 3 : 4.5, worstStrip: `${worst[0] * 10}-${worst[0] * 10 + 10}%`, p5: +worst[1].toFixed(2) })
  }
  await ctx.close()
  return rows
}
C['sog-5'] = async ({ cfg = [[768, 'ar'], [768, 'en'], [1024, 'ar'], [1024, 'en'], [1280, 'ar'], [1280, 'en'], [1440, 'en'], [390, 'ar']], catTiles = ['repo', 'no-gridstyle'] } = {}) => {
  const out = {}; let ok = true
  for (const variant of catTiles) {
    if (variant === 'no-gridstyle') { if (!NO_GRIDSTYLE) continue; state.css['sporta-cat-tiles.css'] = NO_GRIDSTYLE } else delete state.css['sporta-cat-tiles.css']
    for (const [w, lang] of cfg) {
      const rows = await tiles(w, lang)
      const bad = rows.filter((r) => r.p5 < r.need)
      out[`${variant} ${w}${lang}`] = { lines: rows.length, worst: rows.slice().sort((a, b) => a.p5 / a.need - b.p5 / b.need)[0], failing: bad.map((r) => `${r.tile} ${r.line} ${r.worstStrip} ${r.p5}`) }
      ok = ok && rows.length >= 8 && bad.length === 0
    }
  }
  delete state.css['sporta-cat-tiles.css']
  return { ok, data: out }
}
C['sog-5b'] = async () => C['sog-5']({ cfg: [[390, 'en']], catTiles: ['repo', 'no-gridstyle'] })
// selected payment method: the band 3-14px below the card (where a drop shadow falls) compared with the page beside it;
// "orange" = how much redder-than-blue the band is than the page; the 1px ring just outside the border is the brand orange
C['sog-6'] = async ({ cfg = [[DESK, 'light'], [PHONE, 'light'], [DESK, 'dark'], [PHONE, 'dark']] } = {}) => {
  const out = {}; let ok = true
  for (const [v, theme] of cfg) {
    const { ctx, pg } = await open(v, 'ar', '/checkout', { theme })
    const r = await pg.evaluate(async () => {
      const e = document.querySelector('.purchase-payment .payment-method--selected'); if (!e) return null
      e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120))
      const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, bs: getComputedStyle(e).boxShadow }
    })
    if (!r) { out[`${v.w}${theme}`] = 'no selected method'; ok = false; await ctx.close(); continue }
    const clip = { x: Math.floor(r.x), y: Math.floor(r.y + r.h - 4), width: Math.floor(r.w), height: 22 }
    const a = png(await pg.screenshot({ clip }))
    const bandRows = [7, 9, 11, 13, 15, 17].map((d) => d)   // 3..13px under the bottom edge
    const midX = Math.floor(a.w / 2)
    let orange = -99, dark = 0
    // the page colour: the same rows with the card's shadow off
    await pg.evaluate(() => document.querySelector('.purchase-payment .payment-method--selected').style.setProperty('box-shadow', 'none', 'important'))
    const b = png(await pg.screenshot({ clip }))
    await pg.evaluate(() => document.querySelector('.purchase-payment .payment-method--selected').style.removeProperty('box-shadow'))
    for (const y of bandRows) for (let x = midX - 30; x <= midX + 30; x += 3) {
      const p = a.at(x, y), q = b.at(x, y)
      orange = Math.max(orange, (p.r - p.b) - (q.r - q.b))
      dark = Math.max(dark, (q.r + q.g + q.b - p.r - p.g - p.b) / 3)
    }
    const ring = a.at(midX, 4)   // the first row under the border (clip starts 4px above the bottom edge)
    const ringOrange = ring.r - ring.b
    out[`${v.w}${theme}`] = { boxShadow: r.bs.slice(0, 120), glowOrangeExcess: orange, dropDarkening: +dark.toFixed(1), ringPixel: [ring.r, ring.g, ring.b] }
    ok = ok && orange <= 4 && ringOrange >= 80 && !/184, 67, 15/.test(r.bs)
    await ctx.close()
  }
  return { ok, data: out }
}
// >= 1024: a control brought in from ABOVE (Shift+Tab, or focus() of a control above the screen) stops under the header?
C['sog-8'] = async ({ cfg = [['/shop', '.catalog-card-save', DESK, 'ar'], ['/shop', '.catalog-card-save', DESK, 'en'], ['/cart', '.purchase-cart .cart-line__controls > button, .purchase-cart button[aria-label]', DESK, 'ar'], ['/', '.campaign-category, .home-feature-item a, .product-grid-card a', DESK, 'en'], ['/shop', '.catalog-card-save', { w: 1024, h: 768, touch: false }, 'ar']] } = {}) => {
  const out = {}; let ok = true
  for (const [path, sel, v, lang] of cfg) {
    const { ctx, pg } = await open(v, lang, path)
    const r = await pg.evaluate(async (sel) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && e.tabIndex >= 0 && b.top + scrollY > innerHeight + 100 })
      const cover = 'header.app-header, .campaign-brand-bar--sticky'
      const res = []
      for (const e of els.slice(0, 4)) {
        scrollTo(0, 0); const y = e.getBoundingClientRect().top + scrollY
        if (y < innerHeight) continue
        scrollTo(0, y + 400); await new Promise((r) => setTimeout(r, 80))
        e.focus({ focusVisible: true }); await new Promise((r) => setTimeout(r, 120))
        const b = e.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2
        const h = cy >= 0 && cy <= innerHeight ? document.elementFromPoint(cx, cy) : null
        const hidden = cy < 0 || (h && h !== e && !e.contains(h) && !!h.closest(cover))
        res.push({ y: Math.round(b.top), hidden })
        e.blur()
      }
      const bars = [...document.querySelectorAll('header.app-header, .campaign-brand-bar--sticky')].map((x) => Math.round(x.getBoundingClientRect().bottom))
      return { res, pad: getComputedStyle(document.documentElement).scrollPaddingTop, bars }
    }, sel)
    const hidden = r.res.filter((x) => x.hidden).length
    out[`${path} ${v.w}${lang}`] = { tested: r.res.length, hiddenUnderHeader: hidden, ys: r.res.map((x) => x.y), scrollPaddingTop: r.pad, barBottoms: r.bars }
    ok = ok && (r.res.length >= 1 || path === '/cart') && hidden === 0
    // reverse Tab walk from the foot of the page: no stop under the header
    if (path === '/shop' || path === '/cart') {
      await pg.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); const f = document.querySelector('footer a:last-of-type, footer button'); if (f) f.focus() })
      const stops = await tabWalk(pg, 40, 'header.app-header, .campaign-brand-bar--sticky', { reverse: true, skipSel: 'header.app-header, .campaign-brand-bar--sticky' })
      const h2 = stops.filter((s) => s.covered).length
      out[`${path} ${v.w}${lang}`].reverseTabHidden = h2
      ok = ok && h2 === 0
    }
    await ctx.close()
  }
  // phones: no scroll padding at the top (the header slides away there)
  { const { ctx, pg } = await open(PHONE, 'ar', '/shop'); const p = await pg.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop); out.phonePad = p; ok = ok && p === 'auto'; await ctx.close() }
  return { ok, data: out }
}
C['sog-10'] = async () => {
  const out = {}; let ok = true
  for (const [sel, name] of [['.campaign-category', 'tile'], ['.home-feature-item', 'feature card']]) {
    const { ctx, pg } = await open(DESK, 'ar', '/', { theme: 'dark' })
    const r = await shadowDelta(pg, sel)
    out[name] = r && r.delta
    out[name + ' shadow'] = r && r.bs.slice(0, 90)
    ok = ok && !!r && r.delta >= 4 && /rgba\(0, 0, 0, 0\.6\)/.test(r.bs)
    await ctx.close()
  }
  // light keeps its shadows exactly
  { const { ctx, pg } = await open(DESK, 'ar', '/'); const bs = await pg.evaluate(() => getComputedStyle(document.querySelector('.campaign-category')).boxShadow); out.lightTile = bs; ok = ok && /rgba\(23, 26, 30, 0\.35\)/.test(bs); await ctx.close() }
  return { ok, data: out }
}
C['sog-11'] = async () => {
  const out = {}; let ok = true
  for (const theme of ['dark', 'light']) {
    const { ctx, pg } = await open(PHONE, 'ar', '/cart', { theme })
    const r = await pg.evaluate(async () => { const e = document.querySelector('.purchase-cart .purchase-quantity'); e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 100)); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })
    const img = png(await pg.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } }))
    // the top row (where the inset highlight is drawn) against the pill's own fill 4px lower, in the middle (above the digit)
    const mx = Math.floor(img.w / 2), top = img.at(mx, 1), mid = img.at(mx, 5)
    const lift = Math.round((top.r + top.g + top.b - mid.r - mid.g - mid.b) / 3)
    out[theme] = { topRow: [top.r, top.g, top.b], inside: [mid.r, mid.g, mid.b], lift }
    if (theme === 'dark') ok = ok && lift <= 12
    await ctx.close()
  }
  return { ok, data: out }
}
C['sog-12'] = async () => {
  const out = {}; let ok = true
  for (const [path, v] of [['/', DESK], ['/shop', PHONE]]) {
    const { ctx, pg } = await open(v, 'ar', path)
    const r = await pg.evaluate(() => [...document.querySelectorAll('.campaign-brand-bar, .catalog-card-add')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => getComputedStyle(e).backdropFilter))
    const layers = await pg.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const c = getComputedStyle(e); return c.backdropFilter && c.backdropFilter !== 'none' && e.getBoundingClientRect().width > 0 }).length)
    out[`${path} ${v.w}`] = { elements: r.length, blurred: r.filter((x) => x !== 'none').length, blurLayersOnPage: layers }
    ok = ok && r.length > 0 && r.every((x) => x === 'none')
    await ctx.close()
  }
  return { ok, data: out }
}

// ---- run: ON, OFF, mutants -----------------------------------------------------------------------------------------------------
const STORE = ['sog-1', 'sog-2', 'sog-3', 'sog-4', 'sog-5', 'sog-5b', 'sog-6', 'sog-8', 'sog-10', 'sog-11', 'sog-12']
const TITLE = {
  'sog-1': 'product page phone: no Tab stop under the fixed buy bar', 'sog-2': 'checkout: hidden step indicator is not a Tab stop',
  'sog-3': 'stepper focus ring not clipped (cart + drawer)', 'sog-4': 'drawer backdrop: no blur, dims, behaviour kept',
  'sog-5': 'category tile copy >= 4.5:1 (3:1 large) per strip', 'sog-5b': 'English phone tile briefs >= 4.5:1',
  'sog-6': 'selected payment method: ring, no orange glow', 'sog-8': '>= 1024px: focus not hidden under the sticky header',
  'sog-10': 'dark theme: tiles / feature cards keep a visible shadow', 'sog-11': 'dark theme: no bright line on the stepper', 'sog-12': 'no backdrop blur on the brand strip / card "+"',
}
// what a mutant re-runs (a narrower set: the case that failed before)
const MUT_ARGS = {
  'sog-1': { langs: ['ar'] }, 'sog-2': { cfg: [[DESK, 'en']] }, 'sog-3': { langs: ['ar'], drawer: false }, 'sog-4': { cfg: [[DESK, 'ar']] },
  'sog-5': { cfg: [[768, 'ar'], [1024, 'en'], [1280, 'en']], catTiles: ['repo', 'no-gridstyle'] }, 'sog-6': { cfg: [[DESK, 'light']] },
  'sog-8': { cfg: [['/shop', '.catalog-card-save', DESK, 'ar']] },
}
if (live) {
  for (const tag of STORE.filter((t) => !process.env.ONLY || process.env.ONLY.split(",").includes(t))) {
    head(`[${tag}] ${TITLE[tag]}`)
    setState({})
    const on = await C[tag](tag === 'sog-4' ? { frames: true } : {})
    note(`${tag} ON`, on.data)
    console.log('  after :', JSON.stringify(on.data).slice(0, 900))
    is(on.ok, `ON: ${TITLE[tag]}`)
    setState(OFF)
    const off = await C[tag](tag === 'sog-4' ? { frames: true } : {})
    note(`${tag} OFF`, off.data)
    console.log('  before:', JSON.stringify(off.data).slice(0, 900))
    is(!off.ok, `OFF (before): the check fails without SOG-1112`)
    setState(mutant(tag))
    const mu = await C[tag](MUT_ARGS[tag] || {})
    note(`${tag} MUTANT`, mu.data)
    console.log('  mutant:', JSON.stringify(mu.data).slice(0, 400))
    is(!mu.ok, `MUTANT: [${tag}] cut alone -> the check fails`)
    setState({})
  }
}

// ---- /backends ----------------------------------------------------------------------------------------------------------------
head('[sog-7] /backends dark: card depth (Payments light only), modal backdrops, modal panels')
{
  const SRCK = knetSource()
  const states = { ON: SRCK, SERVED: knetServed(), OFF: cutSection(SRCK), 'MUT sog-7a': cutBlock(SRCK, 'sog-7a'), 'MUT sog-7b': cutBlock(SRCK, 'sog-7b'), 'MUT sog-7c': cutBlock(SRCK, 'sog-7c') }
  const ref = { current: null }
  const { server, base } = await serveAdmin(ref)
  const CARDS = ['overview', 'orders', 'catalogue', 'brands', 'settings', 'inventory']
  const MODALS = ['catalogue-form', 'brands-form', 'discounts-form', 'slides-form', 'orders-sheet']
  async function adminPage(name, dark, w = 1280) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })
    safeClose(ctx)
    const pg = await ctx.newPage()
    await pg.goto(`${base}/__fx/${name}?dark=${dark ? 1 : 0}`, { waitUntil: 'load' })
    await pg.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
    await pg.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); return document.fonts.ready }); await pg.waitForTimeout(60)
    return { ctx, pg }
  }
  const CARD_SEL = '.admin-content :is(section.rounded-2xl.border, form.rounded-2xl.bg-white, li.admin-brand-card, section.rounded-xl.border, .admin-product-section, .admin-table-surface, .inventory-table-wrap, div.overflow-x-auto.rounded-2xl.border)'
  async function cards(dark, names = CARDS) {
    const r = {}
    for (const n of names) { const { ctx, pg } = await adminPage(n, dark); const d = await shadowDelta(pg, CARD_SEL, 30); r[n] = d ? d.delta : null; await ctx.close() }
    return r
  }
  async function payments() {
    const r = {}
    for (const dark of [false, true]) {
      const { ctx, pg } = await adminPage('payments', dark)
      r[dark ? 'dark' : 'light'] = await pg.evaluate(() => [...document.querySelectorAll('.payment-settings :is(section.payment-gateway-card, form.payment-gateway-editor)')].map((e) => getComputedStyle(e).boxShadow))
      await ctx.close()
    }
    return r
  }
  async function modals(dark, names = MODALS) {
    const r = {}
    for (const n of names) {
      const { ctx, pg } = await adminPage(n, dark)
      const info = await pg.evaluate(() => {
        const s = [...document.querySelectorAll('.fixed.inset-0')].find((e) => /bg-(black|slate-900)\/40/.test(e.className)); if (!s) return null
        const p = s.firstElementChild, pr = p.getBoundingClientRect()
        return { bg: getComputedStyle(s).backgroundColor, panelShadow: getComputedStyle(p).boxShadow.slice(0, 80), panel: getComputedStyle(p).backgroundColor, pr: [pr.left, pr.top, pr.width, pr.height] }
      })
      if (!info) { r[n] = null; await ctx.close(); continue }
      const pt = { x: 3, y: 3, width: 4, height: 4 }
      const a = png(await pg.screenshot({ clip: pt })).at(1, 1)
      // the panel's edge: 1px outside its box on the start side if the panel does not fill the width, else its top
      const full = info.pr[2] >= 1270
      const ex = full ? Math.round(info.pr[0] + info.pr[2] / 2) : Math.round(info.pr[0] - 1), ey = full ? Math.max(0, Math.round(info.pr[1] - 1)) : Math.round(info.pr[1] + 40)
      const edge = png(await pg.screenshot({ clip: { x: Math.max(0, ex), y: ey, width: 1, height: 1 } })).at(0, 0)
      await pg.evaluate(() => { const s = [...document.querySelectorAll('.fixed.inset-0')].find((e) => /bg-(black|slate-900)\/40/.test(e.className)); s.style.setProperty('background-color', 'transparent', 'important') })
      const b = png(await pg.screenshot({ clip: pt })).at(1, 1)
      const pc = rgb(info.panel)
      r[n] = { scrim: info.bg, pageLeft: +(lumN([a.r, a.g, a.b]) / Math.max(1e-6, lumN([b.r, b.g, b.b]))).toFixed(2), dimmedPage: [a.r, a.g, a.b], panelVsDimmed: +crN(pc, [a.r, a.g, a.b]).toFixed(2), edgeVsDimmed: full ? null : +crN([edge.r, edge.g, edge.b], [a.r, a.g, a.b]).toFixed(2), panelShadow: info.panelShadow, fullWidth: full }
      await ctx.close()
    }
    return r
  }
  const okCards = (c) => Object.values(c).every((d) => d != null && d >= 4)
  const okModals = (m) => Object.values(m).every((x) => x && x.pageLeft <= 0.45 && (x.fullWidth || x.edgeVsDimmed >= 1.5))
  const okEdge = (m) => Object.values(m).every((x) => x && (x.fullWidth || x.edgeVsDimmed >= 1.5))
  const okDim = (m) => Object.values(m).every((x) => x && x.pageLeft <= 0.45)
  const okPay = (p) => p.dark.length > 0 && JSON.stringify(p.dark) === JSON.stringify(p.light)

  ref.current = adminAddons(states.ON)
  const lightOn = { cards: await cards(false), modals: await modals(false) }
  const on = { cards: await cards(true), modals: await modals(true), payments: await payments() }
  note('sog-7 ON dark', on); note('sog-7 ON light', lightOn)
  console.log('  after :', JSON.stringify({ cards: on.cards, modals: Object.fromEntries(Object.entries(on.modals).map(([k, v]) => [k, v && { pageLeft: v.pageLeft, panelVsDimmed: v.panelVsDimmed, edgeVsDimmed: v.edgeVsDimmed }])) }))
  is(okCards(on.cards), 'ON dark: every admin card shadow is visible (delta >= 4)', JSON.stringify(on.cards))
  is(okPay(on.payments), 'ON dark: the Payments cards keep exactly their light shadow (light only)')
  is(okDim(on.modals), 'ON dark: every modal backdrop leaves <= 45% of the page luminance')
  is(okEdge(on.modals), 'ON dark: every modal panel has an edge >= 1.5:1 against the dimmed page')
  ref.current = adminAddons(states.OFF)
  const lightOff = { cards: await cards(false), modals: await modals(false) }
  const off = { cards: await cards(true), modals: await modals(true), payments: await payments() }
  note('sog-7 OFF dark', off)
  console.log('  before:', JSON.stringify({ cards: off.cards, modals: Object.fromEntries(Object.entries(off.modals).map(([k, v]) => [k, v && { pageLeft: v.pageLeft, panelVsDimmed: v.panelVsDimmed, edgeVsDimmed: v.edgeVsDimmed }])) }))
  is(!okCards(off.cards) && !okDim(off.modals) && !okEdge(off.modals), 'OFF (before): cards, backdrops and panel edges all fail')
  is(JSON.stringify(lightOn) === JSON.stringify(lightOff), 'light theme: cards and modals are identical ON and OFF')
  ref.current = adminAddons(states.SERVED)
  const served = { cards: await cards(true, ['overview']), modals: await modals(true, ['catalogue-form']) }
  is(okCards(served.cards) && okModals(served.modals), 'the generated public/sporta-admin-knet.css gives the same result')
  ref.current = adminAddons(states['MUT sog-7a']); is(!okCards(await cards(true, ['overview', 'catalogue'])), 'MUTANT: [sog-7a] cut -> dark cards invisible again')
  ref.current = adminAddons(states['MUT sog-7b']); is(!okDim(await modals(true, ['catalogue-form', 'discounts-form'])), 'MUTANT: [sog-7b] cut -> backdrops too faint again')
  ref.current = adminAddons(states['MUT sog-7c']); is(!okEdge(await modals(true, ['catalogue-form', 'discounts-form'])), 'MUTANT: [sog-7c] cut -> panels have no edge again')
  server.close()
}

await browser.close()
if (live) await live.close()
if (process.env.SOG_TABLE) writeFileSync(process.env.SOG_TABLE, JSON.stringify(TABLE, null, 1))
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1) }
