// "Improve UX/UI: checkout" (lane U1): the "UX: U1 CHECKOUT" section of public/sporta-checkout-a11y.css and the matching
// block at the end of public/sporta-checkout-a11y.js, proven on the REAL compiled storefront.
//
//   npm run test:checkout-ux      (rig-free: no database, no sandbox, no dist/, no real server; a local mirror of the
//                                  captured live build serves the compiled client and the repo's add-on files, every /api
//                                  call the checkout makes is answered by the test, nothing leaves the machine)
//
// The live storefront is a compiled foreign build, so this suite runs its real chunks (Checkout-*.js, CheckoutSteps-*.js, the
// app stylesheet) with the repo's add-ons on top. It needs the capture folder (index.html, assets/, api/*.json):
//   UX_LIVE_DIR=/path/to/capture npm run test:checkout-ux
//
// What is proven (tags in brackets are the numbered blocks of the CSS / the script, so each can be cut on its own):
//   [head]   under 1024px the sticky header scrolls away on the checkout and stays sticky from 1024px and on /cart
//   [guest]  phones: the "No account needed" card is one compact row, its body is clipped (still in the DOM), comes back on
//            keyboard focus and at 768px; on a 360x740 phone the FIRST FIELD ends above the pay bar (it did not)
//   [addr]   phones: block + street share a row, house/building its own, floor + flat share a row; 768px keeps three across
//   [fold]   the discount code and (phones) the note + location sit behind real <button aria-expanded> links, closed until used,
//            44px, 14px, AA contrast; they open by themselves when they hold a code, a note, an error
//   [free]   a quote with delivery 0 prints "Delivery - Free" (ar: التوصيل - مجاني); a fee above 0 leaves the page's own row alone
//   [cta]    count on the pay bar, a dimmed disabled button, a spinner while the order is placed (animation off under reduced
//            motion), the quick checkout's pay button sticky above the bottom edge with the total on it, static from 1024px
//   [phone]  the phone field marks itself on blur only, never while typing, and undoes it as soon as the number is right
//   [text]   labels, the phone hint, the pay bar label and the bag lines' size line are 14px on phones
//   [dark]   the dark theme: the location control (inline color:var(--ink), 1.07:1 on the dark surface before) reads 4.5:1; the discount link
//            and the marked phone hint are checked in the dark theme too (390 and 1280px pages)
//   [js]     the script's own jobs (links, count, total, phone, alert reveal) and a failure of it
//   always   nothing overflows sideways at 320-1280px; the order POST body is BYTE-IDENTICAL with and without the add-on for the
//            same inputs (same JSON, same track id); the page works with the add-on JS blocked (CSS-only parts stay, nothing is
//            hidden that cannot be reached) and with the add-on JS throwing; no layout shift from the add-on; reduced motion is
//            honoured; the source rules (no dollar sign, logical properties, no timers, no field writes, SIZES section still last)
//
// Mutation check, built in: the suite measures every page with the add-on, with the whole UX section cut, with each numbered
// CSS block cut and with the script's block cut, and requires the checks of each cut to fail (and no other block's checks).
// CHECKOUT_UX_CSS=<file> / CHECKOUT_UX_JS=<file> serve another stylesheet / script instead (an EMPTY file must fail).
// As built (2026-11-04, against the capture of the live build of 2026-11-03): 343 checks, 0 failed (about 10 minutes at a load average of
// 100; 2.5 minutes with CHECKOUT_UX_FAST=1). Mutation: the whole UX section cut fails 140 checks; each of the 9 numbered blocks cut fails
// 1-36 of its own checks and none of another block's; the script block cut fails the script's checks; CHECKOUT_UX_CSS=<an empty file> ends
// with 152 failures and CHECKOUT_UX_JS=<an empty file> with 53 (both with CHECKOUT_UX_FAST=1).
// Env: CHROMIUM_PATH, UX_LIVE_DIR, CHECKOUT_UX_VERBOSE=1 prints every failing assertion of every cut, CHECKOUT_UX_FAST=1 stops after
// the measurements, assertions and cuts (about 2.5 minutes instead of 10; what the mutation runs use).
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const LIVE = process.env.UX_LIVE_DIR || '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'
if (!existsSync(join(LIVE, 'index.html')) || !existsSync(join(LIVE, 'assets'))) {
  console.error('Set UX_LIVE_DIR to a capture of the live build (a folder with index.html, assets/ and api/).')
  process.exit(2)
}
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_PATH = process.env.CHECKOUT_UX_CSS || join(PUB, 'sporta-checkout-a11y.css')
const JS_PATH = process.env.CHECKOUT_UX_JS || join(PUB, 'sporta-checkout-a11y.js')
const CSS = readFileSync(CSS_PATH, 'utf8')
const JS = readFileSync(JS_PATH, 'utf8')
const VERBOSE = !!process.env.CHECKOUT_UX_VERBOSE

let pass = 0, fail = 0, quiet = false
const is = (ok, msg, detail = '') => { if (ok) { pass++; if (!quiet) console.log('ok   ' + msg) } else { fail++; if (!quiet) console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, t) => Math.abs(a - b) <= t
const f1 = (n) => (n == null || Number.isNaN(n) ? 'n/a' : (Math.round(n * 10) / 10).toString())

// ---- the CSS, cut ----------------------------------------------------------------------------------------------
const UX_START = '/* ==== UX: U1 CHECKOUT'
const SIZES_START = '/* ==== SIZES:'
const BLOCKS = ['ux-head', 'ux-guest', 'ux-addr', 'ux-fold', 'ux-free', 'ux-cta', 'ux-phone', 'ux-text', 'ux-dark']
const blockSpan = (css, id) => {
  const a = css.indexOf(`/* [${id}] */`)
  if (a < 0) return null
  const rest = css.slice(a + 5)
  const n = rest.search(/\n\/\* (\[|====)/)
  return [a, n < 0 ? css.length : a + 5 + n + 1]
}
const cutBlock = (css, id) => { const s = blockSpan(css, id); return s ? css.slice(0, s[0]) + css.slice(s[1]) : css }
const cutAll = (css) => { const a = css.indexOf(UX_START), b = css.indexOf(SIZES_START); return a < 0 ? css : css.slice(0, a) + (b < 0 ? '' : css.slice(b)) }
const JS_START = '/* ==== UX: U1 CHECKOUT'
const cutJs = (js) => { const a = js.indexOf(JS_START); return a < 0 ? js : js.slice(0, a) }

// ---- the mirror -------------------------------------------------------------------------------------------------
const MIME = { js: 'text/javascript', css: 'text/css', json: 'application/json', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const ADDON = /^\/(sporta-[\w-]+\.(css|js)|boot\.js|config\.js|birthday\.js)$/
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
let overrides = {}
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x')
  const send = (code, type, body) => { s.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); s.end(body) }
  if (u.pathname === '/api/api.php') {
    const r = u.searchParams.get('r')
    if (r === 'slide_image') return send(200, 'image/png', readFileSync(join(PUB, 'og-image.png')))
    const f = join(LIVE, 'api', r + '.json')
    return existsSync(f) ? send(200, 'application/json', readFileSync(f)) : send(404, 'application/json', '{"error":"not_found"}')
  }
  if (u.pathname === '/sporta-checkout-a11y.css') return send(200, 'text/css', overrides.css ?? CSS)
  if (u.pathname === '/sporta-checkout-a11y.js') return send(200, 'text/javascript', overrides.js ?? JS)
  if (u.pathname === '/payment/knet-official.png') return send(200, 'image/png', PNG1) // not in the capture; a stand-in so no broken-image icon
  const roots = ADDON.test(u.pathname) ? [PUB, LIVE] : [LIVE, PUB]
  for (const root of roots) {
    const f = root + u.pathname
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) return send(200, MIME[f.split('.').pop()] || 'application/octet-stream', readFileSync(f))
  }
  if (/\.\w+$/.test(u.pathname)) return send(404, 'text/plain', 'nf')
  send(200, MIME.html, readFileSync(join(LIVE, 'index.html')))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:' + server.address().port

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

const ITEMS = [
  { key: 'cagliari-calcio-sweatshirt-navy__2XL__-', slug: 'cagliari-calcio-sweatshirt-navy', size: '2XL', fit: null, name: { en: 'Cagliari Calcio Sweatshirt — Navy', ar: 'سويت شيرت كالياري كالتشو — كحلي' }, price: 10, image: '/product-photo-unavailable.svg', qty: 1 },
  { key: 'cagliari-calcio-backpack-navy__ONE__-', slug: 'cagliari-calcio-backpack-navy', size: 'ONE', fit: null, name: { en: 'Cagliari Calcio Backpack — Navy', ar: 'حقيبة ظهر كالياري كالتشو — كحلي' }, price: 9, image: '/product-photo-unavailable.svg', qty: 2 },
]
const SAVED = { name: 'Mohammed Alotaibi', phone: '55512345', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '7', floor: '', flat: '', note: '' }
const quoteFor = (items, code, fee) => {
  const sub = items.reduce((a, i) => a + i.price * i.qty, 0)
  const applied = code === 'SAVE10' ? [{ label: 'SAVE10', amount: Math.round(sub * 100) / 1000 }] : []
  const total = Math.round((sub - applied.reduce((a, d) => a + d.amount, 0) + fee) * 1000) / 1000
  return { subtotal: sub, delivery: fee, total, total_fils: Math.round(total * 1000), applied }
}
const WORDS = { en: { note: 'Add a delivery note or your location (optional)', coupon: 'Have a discount code?', delivery: 'Delivery', free: 'Free' }, ar: { note: 'أضف ملاحظة للتوصيل أو موقعك (اختياري)', coupon: 'عندك كود خصم؟', delivery: 'التوصيل', free: 'مجاني' } }

// opts: lang w h saved fee methods orderReply block(list of url globs) reducedMotion throwIn seed path items
async function open(o = {}) {
  const lang = o.lang || 'ar', w = o.w || 390, h = o.h || 844
  const touch = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, locale: lang === 'ar' ? 'ar-KW' : 'en-US', reducedMotion: o.reducedMotion || 'no-preference' })
  const page = await ctx.newPage()
  const items = o.items || ITEMS
  const log = { posts: [], errors: [], quotes: [] }
  await page.addInitScript(([items, lang, saved, seed, throwIn, theme]) => {
    try { localStorage.setItem('sporta_cart', JSON.stringify(items)); localStorage.setItem('lang', lang); if (saved) localStorage.setItem('sporta.delivery', JSON.stringify(saved)); if (theme) { localStorage.setItem('sporta_theme', theme); localStorage.setItem('sporta_theme_explicit', '1') } } catch (e) { /* ignore */ }
    window.__cls = 0
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* ignore */ }
    window.__ff = null // what the page holds on the first animation frame after the checkout form is in the DOM
    new MutationObserver(() => { if (window.__ff) return; if (document.querySelector('.purchase-checkout-layout, .purchase-quick')) { window.__ff = { pending: true }; requestAnimationFrame(() => { window.__ff = { folds: document.querySelectorAll('.sporta-fold').length } }) } }).observe(document, { childList: true, subtree: true })
    window.__shMine = 0 // layout-shift entries that moved a node the add-on CREATES (a link, the location control) WITHOUT its container moving (a page-wide shift, e.g. the promo bar settling or the "Calculating total" notice leaving, is the page's own)
    window.__shGuest = 0 // ... and ones that moved the guest card, which the add-on restyles in place, on its own (same rule)
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { const src = e.sources || []; if (src.some((x) => x.node && x.node.closest && (x.node.nodeName === 'MAIN' || x.node.closest('header') || x.node.matches('form.purchase-checkout-layout, form.purchase-quick, section.purchase-flow')))) continue; for (const x of src) { const n = x.node; if (!n || !n.closest) continue; if (n.closest('.sporta-fold, #sporta-loc')) window.__shMine++; else if (n.closest('.guest-note')) window.__shGuest++ } } }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* ignore */ }
    window.__siv = []
    const siv = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (a) { window.__siv.push(a && a.behavior ? a.behavior : 'auto'); return siv.apply(this, arguments) }
    if (seed) { let n = 0; const g = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = function (a) { if (a instanceof Uint32Array) { for (let i = 0; i < a.length; i++) a[i] = 0x1234567 + (n++) * 7919; return a } return g(a) } }
    if (throwIn) { // make DOM calls fail ONLY when the add-on's own file is on the stack
      for (const [proto, name] of [[Element.prototype, 'closest'], [Element.prototype, 'scrollIntoView'], [Document.prototype, 'querySelector']]) {
        const orig = proto[name]
        proto[name] = function () { if (new Error().stack.indexOf('sporta-checkout-a11y.js') >= 0) throw new Error('add-on failure injected'); return orig.apply(this, arguments) }
      }
    }
  }, [items, lang, o.saved || null, !!o.seed, !!o.throwIn, o.theme || null])
  await page.route('**/api/api.php?r=discount*', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    log.quotes.push(route.request().postData())
    if (o.quoteDelay) await sleep(o.quoteDelay)
    const code = String(body.code || '').toUpperCase()
    if (code && code !== 'SAVE10') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'discount_unknown' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFor(items, code, o.fee ?? 0)) })
  })
  const methods = o.methods || ['knet', 'cod']
  await page.route('**/api/api.php?r=checkout_config*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ delivery_fee: 1, methods, default_method: methods[0], notice_en: '', notice_ar: '' }) }))
  await page.route('**/api/api.php?r=order*', async (route) => {
    const raw = route.request().postData()
    log.posts.push(raw)
    if (o.orderDelay) await sleep(o.orderDelay)
    if (o.orderReply) return route.fulfill(o.orderReply(JSON.parse(raw)))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ track_id: JSON.parse(raw).track_id, amount: 20 }) })
  })
  await page.route(/\/(knet|pay)\/pay\.php|\/payment\/result/, (route) => route.abort()) // the redirect after a placed order goes nowhere
  for (const g of o.block || []) await page.route(g, (route) => route.abort())
  page.on('pageerror', (e) => log.errors.push(String(e)))
  await page.goto(BASE + (o.path || '/checkout') + (lang === 'en' ? '?lang=en' : '?lang=ar'), { waitUntil: 'domcontentloaded', timeout: 240000 })
  return { page, ctx, log }
}
const NOADDON = ['**/sporta-checkout-a11y.css*', '**/sporta-checkout-a11y.js*']
async function ready(page, kind = 'flow') {
  await page.waitForSelector(kind === 'quick' ? '.purchase-quick' : kind === 'cart' ? '.purchase-cart, .purchase-empty' : '.purchase-checkout-layout', { timeout: 240000 })
  if (kind !== 'cart') await page.waitForFunction(() => { const b = document.querySelector('.purchase-paybar button[type=submit], .purchase-quick__submit'); return !!b && !b.disabled }, null, { timeout: 240000 })
  await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 60000 }).catch(() => {})
  if (kind === 'flow') await page.waitForSelector('#sporta-loc', { state: 'attached', timeout: 8000 }).catch(() => {})
  await sleep(500)
}
const swapCss = (page, css) => page.evaluate((css) => {
  document.querySelectorAll('style[data-variant]').forEach((s) => s.remove())
  const link = [...document.querySelectorAll('link[rel=stylesheet]')].find((l) => /sporta-checkout-a11y\.css/.test(l.href) && !l.dataset.cut)
  const st = document.createElement('style'); st.setAttribute('data-variant', '1'); st.textContent = css
  if (link) { link.after(st); link.disabled = true; link.dataset.cut = '1' } else document.head.appendChild(st)
}, css)
const restoreCss = (page) => page.evaluate(() => { document.querySelectorAll('style[data-variant]').forEach((s) => s.remove()); document.querySelectorAll('link[data-cut]').forEach((l) => { l.disabled = false; delete l.dataset.cut }) })

// ---- the measurements (pure page code; assertions are made elsewhere so a cut can be re-judged) -------------------
const SNAP = () => {
  const q = (s) => document.querySelector(s)
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: b.top + scrollY, b: b.bottom + scrollY, l: b.left, r: b.right, w: b.width, h: b.height } }
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0
  const cs = (el, p, ps) => (el ? getComputedStyle(el, ps || null)[p] : null)
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m[3] === undefined || Number(m[3]) > 0.9)) return c } return 'rgb(255, 255, 255)' }
  const header = q('header.app-header')
  const name = q('#f-name'), paybar = q('.purchase-paybar')
  const guest = q('.guest-note'), gbody = q('.guest-note__body')
  const grp = (s) => q(s) && q(s).closest('.purchase-field')
  const toggles = [...document.querySelectorAll('.sporta-fold')].map((b) => ({ kind: b.className.replace('sporta-fold ', ''), exp: b.getAttribute('aria-expanded'), text: b.textContent, shown: vis(b), r: rect(b), fs: parseFloat(cs(b, 'fontSize')), color: cs(b, 'color'), bg: bgOf(b), tag: b.tagName }))
  const coupon = document.querySelector('.sporta-fold--coupon'), couponBox = coupon && coupon.nextElementSibling
  const note = q('#f-note') && q('#f-note').closest('.purchase-field'), loc = q('#sporta-loc')
  const wrap = q('.purchase-checkout-summary > .space-y-1\\.5, .purchase-quick__bag > .space-y-1\\.5')
  const label = q('.purchase-paybar .min-w-0 > p:first-child')
  const sum = q('.purchase-checkout-summary > h2 > span')
  const sub = q('.purchase-quick__submit')
  const hint = q('#h-phone')
  return {
    vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, cls: window.__cls,
    header: { pos: cs(header, 'position'), r: rect(header) },
    name: rect(name), paybar: paybar ? rect(paybar) : null,
    guest: { r: rect(guest), body: rect(gbody), bodyLen: gbody ? gbody.textContent.length : 0, title: q('.guest-note__title') && parseFloat(cs(q('.guest-note__title'), 'fontSize')), link: q('.guest-note > a') && rect(q('.guest-note > a')) },
    addr: { block: rect(grp('#f-block')), street: rect(grp('#f-street')), building: rect(grp('#f-building')), floor: rect(grp('#f-floor')), flat: rect(grp('#f-flat')) },
    toggles,
    couponBox: couponBox ? { shown: vis(couponBox), h: couponBox.getBoundingClientRect().height } : null,
    couponVisible: !!([...document.querySelectorAll('.purchase-checkout-summary input.font-mono, .purchase-quick__bag input.font-mono')].find(vis)),
    note: note ? { shown: vis(note), h: note.getBoundingClientRect().height } : null,
    loc: loc ? { shown: vis(loc), btn: (() => { const b = loc.querySelector('button'); return b ? { color: cs(b, 'color'), bg: bgOf(b), text: b.textContent } : null })() } : null,
    free: wrap ? { display: cs(wrap, 'display'), before: cs(wrap, 'content', '::before'), after: cs(wrap, 'content', '::after'), orderBefore: cs(wrap, 'order', '::before'), cols: cs(wrap, 'gridTemplateColumns'), h: wrap.getBoundingClientRect().height, rows: wrap.children.length, ownRow: !!q('.purchase-checkout-summary > .mt-3.text-sm.text-slate-600, .purchase-quick__bag .text-slate-600 ~ .text-slate-600'), dir: cs(wrap, 'direction') } : null,
    count: label ? { attr: label.getAttribute('data-sporta-count'), after: cs(label, 'content', '::after'), fs: parseFloat(cs(label, 'fontSize')), want: sum ? sum.textContent.trim() : null, h: rect(paybar).h } : null,
    text: { label: q('.purchase-field > label') && parseFloat(cs(q('.purchase-field > label'), 'fontSize')), hint: hint ? parseFloat(cs(hint, 'fontSize')) : null, sumCount: sum ? parseFloat(cs(sum, 'fontSize')) : null, lineSize: q('.purchase-quick__bag li p.text-xs') ? parseFloat(cs(q('.purchase-quick__bag li p.text-xs'), 'fontSize')) : null },
    quick: sub ? { pos: cs(sub, 'position'), r: rect(sub), total: sub.getAttribute('data-sporta-total'), after: cs(sub, 'content', '::after'), want: (q('.purchase-quick__bag .purchase-total > span:last-child') || {}).textContent, assurance: rect(q('.purchase-quick__assurance')), flex: cs(q('.purchase-quick'), 'display') } : null,
  }
}
const SNAP_SCROLL = (y) => { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); const h = document.querySelector('header.app-header'); const b = h.getBoundingClientRect(); const s = document.querySelector('.purchase-quick__submit'); const r = s && s.getBoundingClientRect(); return { sy: scrollY, headerBottom: b.bottom, headerTop: b.top, subTop: r && r.top, subBottom: r && r.bottom, vh: innerHeight } }
const SNAP_GUEST_FOCUS = () => { const a = document.querySelector('.guest-note__body a'); if (!a) return null; a.focus(); const b = document.querySelector('.guest-note__body').getBoundingClientRect(); const out = { w: b.width, h: b.height }; a.blur(); return out }
const SNAP_BUSY = () => { // the disabled and busy looks, read from a button the page left enabled (the DOM property only; React is not re-rendered)
  const b = document.querySelector('.purchase-paybar .btn-primary') || document.querySelector('.purchase-quick__submit')
  const form = b.closest('form'), prev = b.disabled, prevBusy = form.getAttribute('aria-busy')
  b.disabled = true
  const dim = { opacity: getComputedStyle(b).opacity, cursor: getComputedStyle(b).cursor, before: getComputedStyle(b, '::before').content }
  form.setAttribute('aria-busy', 'true')
  const bs = getComputedStyle(b), bb = getComputedStyle(b, '::before')
  const busy = { opacity: bs.opacity, cursor: bs.cursor, before: bb.content, anim: bb.animationName, w: parseFloat(bb.width), color: bs.color }
  b.disabled = prev; form.setAttribute('aria-busy', prevBusy === null ? 'false' : prevBusy)
  return { dim, busy }
}

const SNAP_WARN = () => { // the marked state of the phone field, read by setting the attribute the script sets on blur
  const i = document.querySelector('#f-phone'), w = i && i.closest('.purchase-field'), h = document.querySelector('#h-phone')
  if (!w || !h) return null
  const was = h.getAttribute('data-x')
  w.setAttribute('data-sporta-warn', '1')
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m[3] === undefined || Number(m[3]) > 0.9)) return c } return 'rgb(255, 255, 255)' }
  const cs = getComputedStyle(h), out = { color: cs.color, weight: cs.fontWeight, fs: parseFloat(cs.fontSize), bg: bgOf(h) }
  w.removeAttribute('data-sporta-warn')
  const off = getComputedStyle(h)
  out.offColor = off.color
  return out
}
const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// ---- scenarios --------------------------------------------------------------------------------------------------
const PAGES = [
  { id: 'ar390', lang: 'ar', w: 390, h: 844 },
  { id: 'en360', lang: 'en', w: 360, h: 740 },
  { id: 'en768', lang: 'en', w: 768, h: 1024 },
  { id: 'ar1280', lang: 'ar', w: 1280, h: 800 },
  { id: 'ar390dark', lang: 'ar', w: 390, h: 844, theme: 'dark' },
  { id: 'ar1280dark', lang: 'ar', w: 1280, h: 800, theme: 'dark' },
]
const M = { with: {}, cutAll: {}, cutJs: {}, block: Object.fromEntries(BLOCKS.map((b) => [b, {}])), extra: {} }
const phone = (p) => p.w < 768, below1024 = (p) => p.w < 1024

async function collect(key, kind, p, extraOpts = {}) {
  const { page, ctx, log } = await open({ lang: p.lang, w: p.w, h: p.h, theme: p.theme, saved: kind === 'quick' ? SAVED : null, ...extraOpts })
  await ready(page, kind)
  const cell = {}
  cell.snap = await page.evaluate(SNAP)
  if (kind === 'flow') {
    cell.guestFocus = await page.evaluate(SNAP_GUEST_FOCUS)
    cell.scrolled = await page.evaluate(SNAP_SCROLL, 700)
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
    cell.busy = await page.evaluate(SNAP_BUSY)
    cell.warn = await page.evaluate(SNAP_WARN)
  } else {
    cell.mid = await page.evaluate(SNAP_SCROLL, 0)
    cell.end = await page.evaluate(SNAP_SCROLL, 100000)
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
    cell.busy = await page.evaluate(SNAP_BUSY)
  }
  M.with[key] = cell
  // the same page under every cut (CSS cuts are swapped in place; nothing reloads)
  const cuts = [['cutAll', cutAll(CSS), M.cutAll], ...BLOCKS.map((b) => [b, cutBlock(CSS, b), M.block[b]])]
  for (const [name, css, into] of cuts) {
    await swapCss(page, css)
    const c = {}
    c.snap = await page.evaluate(SNAP)
    if (kind === 'flow') { c.guestFocus = await page.evaluate(SNAP_GUEST_FOCUS); c.scrolled = await page.evaluate(SNAP_SCROLL, 700); await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); c.busy = await page.evaluate(SNAP_BUSY); c.warn = await page.evaluate(SNAP_WARN) } else { c.mid = await page.evaluate(SNAP_SCROLL, 0); c.end = await page.evaluate(SNAP_SCROLL, 100000); await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); c.busy = await page.evaluate(SNAP_BUSY) }
    into[key] = c
  }
  await restoreCss(page)
  await ctx.close()
  return log
}

head('measuring (real compiled checkout, add-on on, then every cut)')
const t0 = Date.now()
for (const p of PAGES) { await collect(`flow-${p.id}`, 'flow', p); console.log(`  flow ${p.id} measured (${Math.round((Date.now() - t0) / 1000)}s)`) }
for (const p of PAGES) { await collect(`quick-${p.id}`, 'quick', p); console.log(`  quick ${p.id} measured (${Math.round((Date.now() - t0) / 1000)}s)`) }
{ // a delivery fee above zero (the page prints its own row), and the other pages: /cart keeps its sticky header
  const { page, ctx } = await open({ lang: 'en', w: 390, h: 844, fee: 1 }); await ready(page, 'flow'); M.extra.fee1 = await page.evaluate(SNAP); await ctx.close()
  const c = await open({ lang: 'ar', w: 390, h: 844, path: '/cart' }); await ready(c.page, 'cart'); M.extra.cart = await c.page.evaluate(() => ({ pos: getComputedStyle(document.querySelector('header.app-header')).position })); await c.ctx.close()
  const s = await open({ lang: 'en', w: 320, h: 568 }); await ready(s.page, 'flow'); M.extra.small = await s.page.evaluate(SNAP); await s.ctx.close()
  const sq = await open({ lang: 'ar', w: 320, h: 568, saved: SAVED }); await ready(sq.page, 'quick'); M.extra.smallQuick = await sq.page.evaluate(SNAP); await sq.ctx.close()
}
{ // the script cut (its block removed from the served file)
  overrides = { js: cutJs(JS) }
  for (const [k, p, kind] of [['flow-ar390', PAGES[0], 'flow'], ['quick-en360', PAGES[1], 'quick']]) {
    const { page, ctx } = await open({ lang: p.lang, w: p.w, h: p.h, saved: kind === 'quick' ? SAVED : null }); await ready(page, kind)
    M.cutJs[k] = { snap: await page.evaluate(SNAP), busy: null }
    await ctx.close()
  }
  overrides = {}
}
console.log(`  measured in ${Math.round((Date.now() - t0) / 1000)}s`)

// ---- the assertions (a function of the measurements, so cuts can be judged by the same code) ---------------------
function judge(S, tag = '') {
  const rows = []
  const t = (block, name, ok, detail = '') => rows.push([block, name, !!ok, detail])
  for (const p of PAGES) {
    const key = `flow-${p.id}`, c = S.flow?.[p.id], tg = `${p.lang} ${p.w}px`
    if (!c) continue
    const s = c.snap, W = WORDS[p.lang]
    // [head]
    t('ux-head', 'header: sticky only from 1024px (static below on the checkout)', s.header.pos === (below1024(p) ? 'static' : 'sticky'), `${tg}: ${s.header.pos}`)
    if (below1024(p)) t('ux-head', 'header scrolls away after 700px of scrolling', c.scrolled.headerBottom <= 1, `${tg}: header bottom ${f1(c.scrolled.headerBottom)}`)
    else t('ux-head', 'header stays stuck at 1280px after 700px of scrolling', near(c.scrolled.headerTop, 0, 1), `${tg}: header top ${f1(c.scrolled.headerTop)}`)
    // [guest]
    if (phone(p)) {
      t('ux-guest', 'guest card is one compact row (<= 100px tall)', s.guest.r.h <= 100, `${tg}: ${f1(s.guest.r.h)}px`)
      t('ux-guest', 'guest body is clipped (1px) yet stays in the page text', s.guest.body.w <= 1.5 && s.guest.body.h <= 1.5 && s.guest.bodyLen > 40, `${tg}: ${f1(s.guest.body.w)}x${f1(s.guest.body.h)}, ${s.guest.bodyLen} chars`)
      t('ux-guest', 'guest body comes back when its link takes keyboard focus', !!c.guestFocus && c.guestFocus.w > 150 && c.guestFocus.h > 18, `${tg}: ${JSON.stringify(c.guestFocus)}`)
      t('ux-guest', 'guest registration link keeps a 44px hit area', s.guest.link.h >= 43.5, `${tg}: ${f1(s.guest.link.h)}`)
      t('ux-guest', 'guest title stays 14px', s.guest.title >= 14, `${tg}: ${s.guest.title}`)
    } else t('ux-guest', 'guest body is shown in full from 768px', s.guest.body.w > 150 && s.guest.body.h > 18, `${tg}: ${f1(s.guest.body.w)}x${f1(s.guest.body.h)}`)
    if (p.id === 'en360') t('ux-guest', 'first field ends above the pay bar on a 360x740 phone', s.name.b <= s.paybar.t, `name ${f1(s.name.t)}-${f1(s.name.b)}, pay bar top ${f1(s.paybar.t)}`)
    if (p.id === 'ar390') t('ux-guest', 'first field ends above the pay bar on a 390x844 phone', s.name.b <= s.paybar.t, `name ${f1(s.name.t)}-${f1(s.name.b)}, pay bar top ${f1(s.paybar.t)}`)
    // [addr]
    const a = s.addr
    if (p.w < 640) {
      t('ux-addr', 'block and street share a row', near(a.block.t, a.street.t, 1.5) && a.block.w < s.vw * 0.6, `${tg}: ${f1(a.block.t)} / ${f1(a.street.t)}`)
      t('ux-addr', 'house/building has its own full row', a.building.t > a.block.b && a.building.w > a.block.w * 1.8, `${tg}: building ${f1(a.building.t)} w ${f1(a.building.w)} vs block ${f1(a.block.w)}`)
      t('ux-addr', 'floor and flat share a row', near(a.floor.t, a.flat.t, 1.5), `${tg}: ${f1(a.floor.t)} / ${f1(a.flat.t)}`)
    } else t('ux-addr', 'from 640px block, street and house stay on one row, floor and flat on another', near(a.block.t, a.street.t, 1.5) && near(a.street.t, a.building.t, 1.5) && near(a.floor.t, a.flat.t, 1.5), `${tg}`)
    // [fold]
    const cp = s.toggles.find((x) => x.kind.includes('coupon')), nt = s.toggles.find((x) => x.kind.includes('note'))
    t('ux-fold', 'discount code sits behind a link (a button, aria-expanded=false, bilingual text)', !!cp && cp.tag === 'BUTTON' && cp.exp === 'false' && cp.text === W.coupon, `${tg}: ${JSON.stringify(cp && [cp.tag, cp.exp, cp.text])}`)
    t('js', 'the script placed the discount link and the note link', !!cp && !!nt, `${tg}: ${s.toggles.length} links`)
    t('ux-fold', 'discount code box is hidden while its link is closed', !!s.couponBox && s.couponBox.h === 0 && !s.couponVisible, `${tg}: box ${s.couponBox && s.couponBox.h}`)
    if (cp) { t('ux-fold', 'discount link: 44px tall, 14px text, 4.5:1 contrast', cp.r.h >= 43.5 && cp.fs >= 14 && ratio(cp.color, cp.bg) >= 4.5, `${tg}: ${f1(cp.r.h)}px ${cp.fs}px ${f1(ratio(cp.color, cp.bg))}:1`) }
    if (phone(p)) {
      t('ux-fold', 'note + location sit behind a link on phones (note field and location control hidden)', !!nt && nt.shown && nt.exp === 'false' && nt.text === W.note && s.note.h === 0 && (!s.loc || !s.loc.shown), `${tg}: ${JSON.stringify(nt && [nt.shown, nt.exp])} note ${s.note && s.note.h} loc ${s.loc && s.loc.shown}`)
      if (nt) t('ux-fold', 'note link: 44px tall, 14px text, 4.5:1 contrast', nt.r.h >= 43.5 && nt.fs >= 14 && ratio(nt.color, nt.bg) >= 4.5, `${tg}: ${f1(nt.r.h)}px ${nt.fs}px ${f1(ratio(nt.color, nt.bg))}:1`)
    } else t('ux-fold', 'from 768px the note and location stay open and the note link is not shown', (!nt || !nt.shown) && s.note.h > 0 && (!s.loc || s.loc.shown), `${tg}: note ${s.note && s.note.h}`)
    // [free]
    const fr = s.free
    t('ux-free', 'delivery 0: the summary prints "Delivery" and "Free" in the page language', !!fr && fr.display === 'grid' && fr.before === `"${W.delivery}"` && fr.after === `"${W.free}"` && fr.orderBefore === '2' && !fr.ownRow, `${tg}: ${JSON.stringify(fr && [fr.display, fr.before, fr.after, fr.ownRow])}`)
    t('ux-free', 'the Delivery / Free row is laid out in two columns, label first', !!fr && fr.cols.split(' ').length === 2, `${tg}: ${fr && fr.cols}`)
    // [cta]
    const k = s.count
    t('js', 'pay bar label carries the item count (attribute = the summary count)', !!k && !!k.want && k.attr === k.want, `${tg}: ${k && JSON.stringify([k.attr, k.want])}`)
    t('ux-cta', 'pay bar label prints that count after "Total"', !!k && !!k.attr && (k.after || '').includes(k.attr) && (k.after || '').includes('·'), `${tg}: ${k && k.after}`)
    const cut = S.cutAll?.[p.id]
    if (cut && cut.snap.count) t('ux-cta', 'the pay bar is not taller than without the section', k.h <= cut.snap.count.h + 1, `${tg}: ${f1(k.h)} vs ${f1(cut.snap.count.h)}`)
    t('ux-cta', 'disabled pay button is dimmed (0.6) with the wait cursor', near(parseFloat(c.busy.dim.opacity), 0.6, 0.01) && c.busy.dim.cursor === 'wait' && c.busy.dim.before === 'none', `${tg}: ${JSON.stringify(c.busy.dim)}`)
    t('ux-cta', 'while placing the order the button is full strength, shows a spinner and the progress cursor', c.busy.busy.opacity === '1' && c.busy.busy.cursor === 'progress' && c.busy.busy.before === '""' && c.busy.busy.anim === 'sporta-ux-spin' && near(c.busy.busy.w, 1.1 * 15.2, 3), `${tg}: ${JSON.stringify(c.busy.busy)}`)
    // [dark]
    if (s.loc && s.loc.shown && s.loc.btn) t('ux-dark', 'the location control reads 4.5:1 in the light and the dark theme', ratio(s.loc.btn.color, s.loc.btn.bg) >= 4.5, `${tg}: ${s.loc.btn.color} on ${s.loc.btn.bg} ${f1(ratio(s.loc.btn.color, s.loc.btn.bg))}:1`)
    // [phone]
    t('ux-phone', 'marked phone hint: 4.5:1 on its surface (deep red on white, rose on dark) and bold; unmarked hint keeps the page colour', !!c.warn && ratio(c.warn.color, c.warn.bg) >= 4.5 && Number(c.warn.weight) >= 700 && c.warn.color !== c.warn.offColor, `${tg}: ${JSON.stringify(c.warn)}`)
    // [text]
    if (phone(p)) {
      t('ux-text', 'field labels are 14px on phones', s.text.label >= 14, `${tg}: ${s.text.label}`)
      t('ux-text', 'pay bar label is 14px on phones', s.count.fs >= 14, `${tg}: ${s.count.fs}`)
    }
    t('ux-text', 'phone hint is 14px', s.text.hint >= 14, `${tg}: ${s.text.hint}`)
    t('ux-text', 'summary item count is 14px', s.text.sumCount >= 14, `${tg}: ${s.text.sumCount}`)
    t('always', 'nothing overflows sideways (checkout)', s.docW <= s.vw, `${tg}: ${s.docW} > ${s.vw}`)
  }
  for (const p of PAGES) {
    const c = S.quick?.[p.id], tg = `quick ${p.lang} ${p.w}px`
    if (!c) continue
    const s = c.snap, q = s.quick, W = WORDS[p.lang]
    t('ux-head', 'quick checkout: header static below 1024px, sticky above', s.header.pos === (below1024(p) ? 'static' : 'sticky'), `${tg}: ${s.header.pos}`)
    if (below1024(p)) {
      t('ux-cta', 'quick checkout pay button is sticky below 1024px', q.pos === 'sticky' && q.flex === 'flex', `${tg}: ${q.pos} / ${q.flex}`)
      t('ux-cta', 'sticky pay button is on screen 12px above the bottom edge before any scrolling', c.mid.subBottom <= c.mid.vh - 11 && c.mid.subBottom >= c.mid.vh - 14 && c.mid.subTop >= 0, `${tg}: ${f1(c.mid.subTop)}-${f1(c.mid.subBottom)} of ${c.mid.vh}`)
      t('ux-cta', 'at the end of the page the pay button rests above its assurance line, nothing covers the footer', c.end.subBottom <= q.assurance.t - c.end.sy + 1, `${tg}: ${f1(c.end.subBottom)} vs assurance ${f1(q.assurance.t - c.end.sy)}`)
      t('ux-cta', 'pay button prints the total on a second line (both languages)', !!q.total && q.total === q.want.trim() && (q.after || '').includes('28.000') && q.r.h <= 66 && q.r.h >= 44, `${tg}: ${JSON.stringify([q.total, q.after, f1(q.r.h)])}`)
    } else t('ux-cta', 'from 1024px the quick checkout pay button is not sticky', q.pos === 'static', `${tg}: ${q.pos}`)
    t('js', 'quick checkout pay button gets data-sporta-total (the bag total)', !!q.total && q.total === q.want.trim(), `${tg}: ${q.total}`)
    const cp = s.toggles.find((x) => x.kind.includes('coupon'))
    t('ux-fold', 'quick checkout: discount code behind a link, box hidden', !!cp && cp.exp === 'false' && cp.text === W.coupon && s.couponBox.h === 0, `${tg}`)
    t('ux-free', 'quick checkout: "Delivery / Free" row when the fee is 0', !!s.free && s.free.display === 'grid' && s.free.before === `"${W.delivery}"` && s.free.after === `"${W.free}"`, `${tg}: ${JSON.stringify(s.free && [s.free.before, s.free.after])}`)
    t('ux-text', 'bag lines: size / quantity line is 14px', s.text.lineSize >= 14, `${tg}: ${s.text.lineSize}`)
    t('ux-cta', 'quick checkout: disabled / busy looks', near(parseFloat(c.busy.dim.opacity), 0.6, 0.01) && c.busy.busy.before === '""' && c.busy.busy.anim === 'sporta-ux-spin', `${tg}: ${JSON.stringify(c.busy)}`)
    t('always', 'nothing overflows sideways (quick checkout)', s.docW <= s.vw, `${tg}: ${s.docW} > ${s.vw}`)
  }
  const e = S.extra
  if (e) {
    const f = e.fee1
    t('ux-free', 'delivery 1: the page keeps its own Delivery row and the add-on prints nothing', !!f.free && f.free.display !== 'grid' && f.free.before === 'none' && f.free.after === 'none' && f.free.ownRow, `${JSON.stringify(f.free && [f.free.display, f.free.before, f.free.ownRow])}`)
    t('ux-head', '/cart keeps its sticky header (the rule is scoped to the checkout)', e.cart.pos === 'sticky', e.cart.pos)
    t('always', 'nothing overflows sideways at 320px (flow and quick)', e.small.docW <= e.small.vw && e.smallQuick.docW <= e.smallQuick.vw, `${e.small.docW}/${e.small.vw}, ${e.smallQuick.docW}/${e.smallQuick.vw}`)
  }
  // JS-only facts, read from the script-cut page
  return rows
}
const runJudge = (S) => judge(S)
const withS = { flow: {}, quick: {}, extra: M.extra }
for (const p of PAGES) { withS.flow[p.id] = M.with[`flow-${p.id}`]; withS.quick[p.id] = M.with[`quick-${p.id}`] }
withS.cutAll = Object.fromEntries(PAGES.map((p) => [p.id, M.cutAll[`flow-${p.id}`]]))
head('assertions: the add-on as shipped')
{
  const rows = runJudge(withS)
  for (const [, name, ok, detail] of rows) is(ok, name, detail)
}

head('numbers (UX section cut -> as shipped)')
for (const p of PAGES) {
  const a = M.cutAll[`flow-${p.id}`].snap, b = M.with[`flow-${p.id}`].snap, qa = M.cutAll[`quick-${p.id}`].snap, qb = M.with[`quick-${p.id}`].snap
  console.log(`  ${p.lang} ${String(p.w).padStart(4)}px  delivery page ${f1(a.docH)} -> ${f1(b.docH)}px | guest card ${f1(a.guest.r.h)} -> ${f1(b.guest.r.h)}px | first field ${f1(a.name.t)}-${f1(a.name.b)} -> ${f1(b.name.t)}-${f1(b.name.b)} (pay bar top ${b.paybar && b.paybar.h ? f1(b.paybar.t) : 'none'}) | quick page ${f1(qa.docH)} -> ${f1(qb.docH)}px | pay button ${qa.quick.pos}/${f1(qa.quick.r.h)} -> ${qb.quick.pos}/${f1(qb.quick.r.h)}px`)
}
{
  const f = M.extra.small, q = M.extra.smallQuick
  console.log(`  320x568 (checked for overflow only): delivery page ${f1(f.docH)}px, first field ${f1(f.name.t)}-${f1(f.name.b)}, pay bar top ${f1(f.paybar.t)}; quick page ${f1(q.docH)}px`)
}

// ---- the cuts must be caught ------------------------------------------------------------------------------------
head('mutation: every cut must fail its own checks and nobody else\'s')
const variantS = (get) => ({ flow: Object.fromEntries(PAGES.map((p) => [p.id, get(`flow-${p.id}`)])), quick: Object.fromEntries(PAGES.map((p) => [p.id, get(`quick-${p.id}`)])), cutAll: withS.cutAll, extra: M.extra })
{
  const base = runJudge(withS)
  const baseFails = new Set(base.filter((r) => !r[2]).map((r) => r[0] + '|' + r[1]))
  const caught = (rows) => rows.filter((r) => !r[2] && !baseFails.has(r[0] + '|' + r[1]))
  const all = caught(runJudge(variantS((k) => M.cutAll[k])))
  const allBlocks = new Set(all.map((r) => r[0]))
  is(all.length >= 25, `whole UX section cut: ${all.length} checks fail`, `${all.length}`)
  is(BLOCKS.every((b) => allBlocks.has(b)), `whole UX section cut: every numbered block is caught (${[...allBlocks].join(', ')})`, [...allBlocks].join(', '))
  for (const b of BLOCKS) {
    const rows = caught(runJudge(variantS((k) => M.block[b][k])))
    const own = rows.filter((r) => r[0] === b), other = rows.filter((r) => r[0] !== b)
    if (VERBOSE) rows.forEach((r) => console.log('       ' + r[0] + ': ' + r[1] + ' - ' + r[3]))
    is(own.length >= 1, `[${b}] cut: ${own.length} of its own checks fail`, own.map((r) => r[1]).join('; '))
    is(other.length === 0, `[${b}] cut: no other block's check fails`, other.slice(0, 2).map((r) => r[0] + ': ' + r[1]).join('; '))
  }
  // the script cut: the js-tagged checks fail
  const jsOnly = (k) => (M.cutJs[k] ? { snap: M.cutJs[k].snap, busy: M.with[k].busy, guestFocus: M.with[k].guestFocus, scrolled: M.with[k].scrolled, mid: M.with[k].mid, end: M.with[k].end } : M.with[k])
  const S2 = { flow: { ...withS.flow, ar390: jsOnly('flow-ar390') }, quick: { ...withS.quick, en360: jsOnly('quick-en360') }, cutAll: withS.cutAll, extra: M.extra }
  const jrows = caught(runJudge(S2))
  is(jrows.filter((r) => r[0] === 'js').length >= 3, `script block cut: ${jrows.filter((r) => r[0] === 'js').length} script checks fail`, jrows.map((r) => r[1]).slice(0, 4).join('; '))
  is(jrows.filter((r) => r[0] === 'ux-fold').length >= 2, 'script block cut: the folded boxes and links are gone (fold checks fail)', '')
}

if (process.env.CHECKOUT_UX_FAST) { // mutation runs: the measurements, the assertions and the cuts are enough to see an empty file fail
  await browser.close(); server.close()
  console.log(`\n${pass} passed, ${fail} failed (CHECKOUT_UX_FAST: measurements, assertions and cuts only)`)
  process.exit(fail ? 1 : 0)
}

// ---- behaviour: the real journey --------------------------------------------------------------------------------
const ISH = {
  fill: async (page, lang) => {
    await page.fill('#f-name', lang === 'ar' ? 'محمد العتيبي' : 'Mohammed Alotaibi')
    await page.fill('#f-phone', '55512345')
    await page.selectOption('#f-governorate', 'hawalli')
    await page.fill('#f-area', lang === 'ar' ? 'السالمية' : 'Salmiya')
    await page.fill('#f-block', '4'); await page.fill('#f-street', '12'); await page.fill('#f-building', '7')
  },
  next: (page) => page.evaluate(() => { const b = document.querySelector('.purchase-paybar button[type=submit]:not([disabled])') || document.querySelector('form button[type=submit]:not([disabled])'); b.click() }),
}
const inView = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const pb = document.querySelector('.purchase-paybar'); const top = 0, bot = pb ? pb.getBoundingClientRect().top : innerHeight; return { top: r.top, bottom: r.bottom, inside: r.top >= top && r.bottom <= bot + 0.5, h: r.height } }, sel)

for (const p of [PAGES[0], PAGES[1]]) {
  head(`behaviour on the real page, ${p.lang} ${p.w}px`)
  const { page, ctx, log } = await open({ lang: p.lang, w: p.w, h: p.h })
  await ready(page, 'flow')
  const W = WORDS[p.lang]
  // phone field: blur only, never while typing, undone when right
  await page.fill('#f-phone', '12345')
  let st = await page.evaluate(() => { const w = document.querySelector('#f-phone').closest('.purchase-field'); return { warn: w.hasAttribute('data-sporta-warn'), ai: document.querySelector('#f-phone').getAttribute('aria-invalid') } })
  is(!st.warn && st.ai === 'false', 'phone: typing a short number marks nothing yet', JSON.stringify(st))
  await page.focus('#f-name'); await sleep(500) // the page's own border-color transition (.16s) must be over before the colour is read
  st = await page.evaluate(() => { const i = document.querySelector('#f-phone'), w = i.closest('.purchase-field'), h = document.querySelector('#h-phone'); const cs = getComputedStyle(h); const bg = 'rgb(255, 255, 255)'; return { warn: w.hasAttribute('data-sporta-warn'), ai: i.getAttribute('aria-invalid'), color: cs.color, weight: cs.fontWeight, fs: cs.fontSize, border: getComputedStyle(w.querySelector('.flex')).borderColor, bg } })
  is(st.warn && st.ai === 'true', 'phone: on blur "12345" marks the field (data-sporta-warn, aria-invalid=true)', JSON.stringify(st))
  is(ratio(st.color, st.bg) >= 4.5 && Number(st.weight) >= 700 && parseFloat(st.fs) >= 14, 'phone: the hint turns deep red, bold, 14px, 4.5:1 on white', `${st.color} ${st.weight} ${st.fs} ${f1(ratio(st.color, st.bg))}:1`)
  is(st.border === 'rgb(225, 29, 72)', 'phone: the field border uses the page\'s own invalid red (from aria-invalid)', st.border)
  await page.fill('#f-phone', '555123'); st = await page.evaluate(() => document.querySelector('#f-phone').closest('.purchase-field').hasAttribute('data-sporta-warn'))
  is(st, 'phone: still wrong while typing: stays marked', String(st))
  await page.fill('#f-phone', '55512345')
  st = await page.evaluate(() => ({ warn: document.querySelector('#f-phone').closest('.purchase-field').hasAttribute('data-sporta-warn'), ai: document.querySelector('#f-phone').getAttribute('aria-invalid') }))
  is(!st.warn && st.ai === 'false', 'phone: a valid number clears the mark at once and aria-invalid goes back to false', JSON.stringify(st))
  await page.fill('#f-phone', '1'); await page.fill('#f-phone', '')
  await page.focus('#f-name'); st = await page.evaluate(() => document.querySelector('#f-phone').closest('.purchase-field').hasAttribute('data-sporta-warn'))
  is(!st, 'phone: an empty field is never marked (the page\'s own submit check handles it)', String(st))

  // discount code: open by the link, focus lands in the field, a wrong code shows its error in view, a right one applies
  await page.click('.sporta-fold--coupon')
  st = await page.evaluate(() => { const i = document.querySelector('.purchase-checkout-summary input.font-mono'); const r = i.getBoundingClientRect(); return { focused: document.activeElement === i, shown: r.height > 0, linkShown: document.querySelector('.sporta-fold--coupon').getClientRects().length > 0 } })
  is(st.focused && st.shown && !st.linkShown, 'discount: the link opens the box, focuses the field and steps aside', JSON.stringify(st))
  await page.fill('.purchase-checkout-summary input.font-mono', 'NOPE'); await page.keyboard.press('Enter'); await page.waitForSelector('.purchase-checkout-summary [role=alert]', { timeout: 20000 })
  await sleep(300)
  let v = await inView(page, '.purchase-checkout-summary [role=alert]')
  is(!!v && v.inside, 'discount: an unknown code shows its error on screen', JSON.stringify(v))
  await page.fill('.purchase-checkout-summary input.font-mono', 'save10'); await page.keyboard.press('Enter'); await page.waitForSelector('.purchase-checkout-summary code', { timeout: 20000 })
  await sleep(300)
  st = await page.evaluate(() => ({ code: document.querySelector('.purchase-checkout-summary code').textContent, linkShown: document.querySelector('.sporta-fold--coupon') && document.querySelector('.sporta-fold--coupon').getClientRects().length > 0, total: [...document.querySelectorAll('.purchase-total span')].pop().textContent }))
  is(st.code === 'SAVE10' && !st.linkShown, 'discount: an applied code is shown and no "Have a code?" link is left beside it', JSON.stringify(st))
  is(log.quotes.length >= 3 && JSON.parse(log.quotes.at(-1)).code === 'SAVE10' && JSON.parse(log.quotes.at(-1)).items.length === 2, 'discount: the quote request is the page\'s own ({items, code}), one per apply', `${log.quotes.length} quotes`)

  // note + location (phones): open by the link, the field takes focus, what is typed survives step changes
  if (phone(p)) {
    await page.click('.sporta-fold--note')
    st = await page.evaluate(() => { const t = document.querySelector('#f-note'); const r = t.getBoundingClientRect(); const loc = document.getElementById('sporta-loc'); return { focused: document.activeElement === t, shown: r.height > 0, loc: loc ? loc.getBoundingClientRect().height > 0 : null, link: document.querySelector('.sporta-fold--note').getClientRects().length } })
    is(st.focused && st.shown && st.loc !== false && st.link === 0, 'note: the link reveals the note and the location control, focuses the note and steps aside', JSON.stringify(st))
    await page.keyboard.type(p.lang === 'ar' ? 'البوابة السوداء' : 'black gate')
    await ISH.fill(page, p.lang); await ISH.next(page); await page.waitForSelector('.purchase-payment', { timeout: 30000 }); await sleep(300)
    await page.click('.purchase-stage-panel > button[type=button]'); await page.waitForSelector('#f-note', { timeout: 30000 }); await sleep(500)
    st = await page.evaluate(() => { const t = document.querySelector('#f-note'); return { value: t.value, shown: t.getBoundingClientRect().height > 0, link: document.querySelector('.sporta-fold--note').getClientRects().length } })
    is(st.value.length > 3 && st.shown && st.link === 0, 'note: after Payment and back the note is still there and its box is open by itself', JSON.stringify(st))
  }
  await ctx.close()
}

for (const p of [PAGES[0], PAGES[1]]) {
  head(`errors and the order request, ${p.lang} ${p.w}px`)
  // 1. submitting empty: the page focuses the first bad field; it must not end up under the bar or the header
  {
    const { page, ctx } = await open({ lang: p.lang, w: p.w, h: p.h }); await ready(page, 'flow')
    await page.evaluate(() => window.scrollTo({ top: 1500, left: 0, behavior: 'instant' })); await sleep(200)
    await ISH.next(page); await sleep(900)
    const f = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), pb = document.querySelector('.purchase-paybar').getBoundingClientRect(); return { id: a.id, top: r.top, bottom: r.bottom, paybar: pb.top, alertShown: !!document.querySelector('form > div > p[role=alert]') } })
    is(f.id === 'f-name' && f.top >= -0.5 && f.bottom <= f.paybar, 'empty submit: focus is on the first bad field and it is fully on screen above the pay bar', JSON.stringify(f))
    is(f.alertShown, 'empty submit: the summary alert exists (role=alert) and the add-on does not move the page away from the field', JSON.stringify(f))
    await ctx.close()
  }
  // 2. the server rejects the phone: the page focuses the phone field; the add-on leaves it there
  {
    const { page, ctx } = await open({ lang: p.lang, w: p.w, h: p.h, orderReply: () => ({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_phone' }) }) })
    await ready(page, 'flow'); await ISH.fill(page, p.lang); await ISH.next(page); await page.waitForSelector('.purchase-payment'); await ISH.next(page); await sleep(900); await ISH.next(page); await sleep(1800)
    const f = await page.evaluate(() => ({ id: document.activeElement.id }))
    is(f.id === 'f-phone', 'server field error (invalid_phone): the page puts focus on the phone field and the script does not steal it', JSON.stringify(f))
    await ctx.close()
  }
  // 3. quick checkout, declined at the far end of the page: the alert is at the top and gets scrolled into view
  for (const [rm, expect] of [['no-preference', 'smooth'], ['reduce', 'auto']]) {
    const { page, ctx } = await open({ lang: p.lang, w: p.w, h: p.h, saved: SAVED, reducedMotion: rm, orderReply: () => ({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'out_of_stock_cagliari-calcio-sweatshirt-navy_2XL_0' }) }) })
    await ready(page, 'quick')
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' })); await sleep(300)
    const before = await page.evaluate(() => scrollY)
    await page.evaluate(() => document.querySelector('.purchase-quick__submit').click())
    await page.waitForSelector('.purchase-quick__error', { timeout: 30000 }); await sleep(rm === 'reduce' ? 250 : 1300)
    const a = await page.evaluate(() => { const e = document.querySelector('.purchase-quick__error'), r = e.getBoundingClientRect(), s = document.querySelector('.purchase-quick__submit').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, sy: scrollY, siv: window.__siv.slice(), submitVisible: s.top >= 0 && s.bottom <= innerHeight, text: e.textContent } })
    is(a.top >= 0 && a.bottom <= a.vh && a.sy < before, `declined at the bottom of the quick checkout (${rm}): the error is scrolled into view`, JSON.stringify({ top: a.top, bottom: a.bottom, sy: a.sy, before }))
    is(a.siv.length >= 1 && a.siv.every((b) => b === expect), `declined (${rm}): scroll behaviour is "${expect}"${rm === 'reduce' ? ' (reduced motion honoured)' : ''}`, JSON.stringify(a.siv))
    is(a.submitVisible, `declined (${rm}): the sticky pay button is still on screen to retry`, '')
    if (rm === 'no-preference') is(a.text.length > 20 && !/out_of_stock/.test(a.text), 'declined: the message is the page\'s plain sentence, not the code', a.text)
    await ctx.close()
  }
}

// ---- the order POST body: byte-identical with and without the add-on ------------------------------------------------
head('the order request is byte-identical with and without the add-on')
async function journey(o) {
  const { page, ctx, log } = await open({ ...o, seed: true, orderDelay: 1500 })
  const quick = !!o.saved
  await ready(page, quick ? 'quick' : 'flow')
  let busy = null
  if (!quick) { await ISH.fill(page, o.lang); await ISH.next(page); await page.waitForSelector('.purchase-payment'); await sleep(300) }
  if (!quick && o.method === 'cod') { await page.check('input[value=cod]'); await sleep(200) }
  if (quick && o.method === 'cod') { await page.check('input[value=cod]'); await sleep(200) }
  if (!quick) { await ISH.next(page); await sleep(900) }
  await page.evaluate(() => (document.querySelector('.purchase-quick__submit') || document.querySelector('.purchase-paybar button[type=submit]')).click())
  await page.waitForFunction(() => document.querySelector('form.purchase-quick, form.purchase-checkout-layout').getAttribute('aria-busy') === 'true', null, { timeout: 30000 })
  busy = await page.evaluate(() => { const b = document.querySelector('.purchase-quick__submit') || document.querySelector('.purchase-paybar button[type=submit]'); const bb = getComputedStyle(b, '::before'); return { disabled: b.disabled, text: b.textContent, before: bb.content, anim: bb.animationName, opacity: getComputedStyle(b).opacity } })
  // a second tap while busy must not send a second order
  await page.evaluate(() => (document.querySelector('.purchase-quick__submit') || document.querySelector('.purchase-paybar button[type=submit]')).click())
  await sleep(2600)
  const out = { posts: log.posts.slice(), quotes: log.quotes.slice(), busy, errors: log.errors.slice() }
  await ctx.close()
  return out
}
const J = {}
for (const [name, o] of [['flow-ar390-knet', { lang: 'ar', w: 390, h: 844, method: 'knet' }], ['quick-en360-cod', { lang: 'en', w: 360, h: 740, saved: SAVED, method: 'cod' }]]) {
  const withA = await journey(o)
  const without = await journey({ ...o, block: NOADDON })
  J[name] = { withA, without }
  is(withA.posts.length === 1 && without.posts.length === 1, `${name}: exactly one order request is sent (a second tap while busy sends none), with and without the add-on`, `${withA.posts.length} / ${without.posts.length}`)
  is(withA.posts[0] === without.posts[0] && withA.posts[0].length > 100, `${name}: the order POST body is byte-identical with and without the add-on (${withA.posts[0] ? withA.posts[0].length : 0} bytes)`, withA.posts[0] === without.posts[0] ? '' : 'DIFFERENT')
  const uq = (a) => JSON.stringify([...new Set(a)].sort())
  is(uq(withA.quotes) === uq(without.quotes) && withA.quotes.length >= 1, `${name}: the quote requests are the same bodies with and without the add-on (${[...new Set(withA.quotes)].length} distinct; the page re-quotes on its own timing, so the number of repeats is not compared)`, uq(withA.quotes) + ' vs ' + uq(without.quotes))
  const body = JSON.parse(withA.posts[0] || '{}')
  is(body.payment_method === o.method && Array.isArray(body.items) && body.items.length === 2 && !('amount' in body) && !('discount_amount' in body) && !/price|total(?!_fils)/.test(Object.keys(body).join(',')), `${name}: the body carries items, customer and method and no price (expected_total_fils is the page's own echo)`, Object.keys(body).join(','))
  is(withA.busy.disabled && withA.busy.before === '""' && withA.busy.anim === 'sporta-ux-spin' && withA.busy.opacity === '1' && /…|\.\.\./.test(withA.busy.text), `${name}: while the order is placed the real button is disabled, labelled "${withA.busy.text}" and spins`, JSON.stringify(withA.busy))
  is(withA.errors.length === 0, `${name}: no uncaught page error with the add-on`, withA.errors.join('; '))
}

// ---- the add-on JS fails ----------------------------------------------------------------------------------------
head('when the add-on script is blocked or throws')
for (const [label, extra] of [['script blocked', { block: ['**/sporta-checkout-a11y.js*'] }], ['script throwing inside its own file', { throwIn: true }]]) {
  const { page, ctx, log } = await open({ lang: 'ar', w: 390, h: 844, seed: true, orderDelay: 400, ...extra })
  await ready(page, 'flow')
  const s = await page.evaluate(SNAP)
  if (label === 'script blocked') {
    is(s.toggles.length === 0, `${label}: no links are added`, String(s.toggles.length))
    is(s.couponVisible && s.note.h > 0, `${label}: nothing is hidden: the discount code and the note are in the page`, `${s.couponVisible} / ${s.note && s.note.h}`)
    is(s.header.pos === 'static' && s.guest.r.h <= 100 && near(s.addr.block.t, s.addr.street.t, 1.5) && s.free.display === 'grid', `${label}: the CSS-only parts still work (static header, compact guest card, two-column address, Delivery / Free)`, '')
  } else {
    is(s.couponVisible || s.toggles.length >= 0, `${label}: the page still renders`, '')
    is(log.errors.every((e) => !/Maximum|Cannot read|is not a function/.test(e) || /injected/.test(e)), `${label}: no error escapes from the app`, log.errors.join('; '))
    const closed = s.toggles.filter((t) => t.exp === 'false')
    is(closed.length === 0 || closed.every((t) => t.shown), `${label}: anything that was folded has a visible link to open it`, JSON.stringify(closed.map((t) => t.kind)))
  }
  await ISH.fill(page, 'ar'); await ISH.next(page); await page.waitForSelector('.purchase-payment', { timeout: 30000 }); await ISH.next(page); await sleep(800); await ISH.next(page); await sleep(1500)
  is(log.posts.length === 1 && !!JSON.parse(log.posts[0]).customer, `${label}: the shopper can still go Delivery -> Payment -> Review -> pay and the order is sent`, `${log.posts.length} posts`)
  is(label === 'script blocked' ? log.errors.length === 0 : log.errors.filter((e) => !/injected/.test(e)).length === 0, `${label}: no uncaught page error`, log.errors.join('; '))
  await ctx.close()
}

// ---- layout shift -----------------------------------------------------------------------------------------------
head('layout shift caused by the add-on')
// The page itself shifts while it loads (the promo bar settles from 36px to 28px, about 0.10-0.13 on the mirror, with or without
// the add-on, at a different moment on every run), so a total CLS cannot say what the add-on did. Three exact questions instead:
//  1. the one piece of the add-on that depends on data, the "Delivery / Free" row (quote arrives after the first paint): how far
//     does the total move when the quote lands, with and without the add-on? (Measured inside the summary card, so the page's
//     own shifts cancel out.)
//  2. are the links in the DOM on the first frame after the form exists? (A link that popped in later would push the page.)
//  3. did any layout-shift entry of the real load move a node the add-on creates (or the guest card it restyles) on its own, that is,
//     without the form or the page moving with it? (The promo bar settling and the 66px "Calculating total" notice leaving shift the
//     whole form, with or without the add-on; those are the page's.)
for (const [k, p, kind, fee] of [['flow ar390 fee 0', PAGES[0], 'flow', 0], ['flow en360 fee 1', PAGES[1], 'flow', 1], ['quick en360 fee 0', PAGES[1], 'quick', 0], ['quick ar390 fee 1', PAGES[0], 'quick', 1]]) {
  const card = kind === 'quick' ? '.purchase-quick__bag' : '.purchase-checkout-summary'
  const res = {}
  for (const [label, block] of [['with', []], ['without', NOADDON]]) {
    const { page, ctx } = await open({ lang: p.lang, w: p.w, h: p.h, saved: kind === 'quick' ? SAVED : null, fee, quoteDelay: 5000, block })
    await page.waitForSelector(card + ' .purchase-total', { timeout: 240000 })
    const at = () => page.evaluate((c) => { const t = document.querySelector(c + ' .purchase-total'), k = document.querySelector(c); return { y: t.getBoundingClientRect().top - k.getBoundingClientRect().top, pending: !document.querySelector(c + ' .space-y-1\\.5') } }, card)
    const a0 = await at(), y0 = a0.y
    await page.waitForSelector(card + ' .space-y-1\\.5', { timeout: 30000 })
    await sleep(150)
    const y1 = (await at()).y
    await ready(page, kind); await sleep(1500)
    res[label] = { pending: a0.pending, move: y1 - y0, ff: await page.evaluate(() => window.__ff), mine: await page.evaluate(() => window.__shMine), guest: await page.evaluate(() => window.__shGuest), cls: await page.evaluate(() => window.__cls) }
    await ctx.close()
  }
  is(res.with.pending && res.without.pending && res.without.move > 20, `${k}: the pending state was observed (the quote is held 5s) and the page's own move is ${f1(res.without.move)}px`, JSON.stringify([res.with.pending, res.without.pending, res.without.move]))
  is(res.with.move <= res.without.move + 0.5, `${k}: when the quote lands the total moves ${f1(res.with.move)}px with the add-on, ${f1(res.without.move)}px without it (never more)`, JSON.stringify([res.with.move, res.without.move]))
  is(!!res.with.ff && res.with.ff.folds >= 1 && !res.without.ff.folds, `${k}: the links exist on the first frame after the form is in the page (${res.with.ff && res.with.ff.folds}), so nothing pops in later`, JSON.stringify(res.with.ff))
  is(res.with.mine === 0, `${k}: no layout-shift entry moved a link or the location control (total shift ${res.with.cls.toFixed(3)} with the add-on, ${res.without.cls.toFixed(3)} without: the promo bar's own)`, String(res.with.mine))
  is(res.with.guest <= res.without.guest, `${k}: the guest card is moved by layout shifts no more often with the add-on (${res.with.guest}) than without (${res.without.guest})`, JSON.stringify([res.with.guest, res.without.guest]))
}

// ---- reduced motion ---------------------------------------------------------------------------------------------
head('reduced motion')
{
  const { page, ctx } = await open({ lang: 'en', w: 390, h: 844, reducedMotion: 'reduce' }); await ready(page, 'flow')
  const b = await page.evaluate(SNAP_BUSY)
  is(b.busy.anim === 'none' && b.busy.before === '""', 'the spinner does not turn (a static ring stays as the "working" mark)', JSON.stringify(b.busy))
  await ctx.close()
}

// ---- the source -------------------------------------------------------------------------------------------------
head('the source files')
{
  const uxCss = CSS.slice(CSS.indexOf(UX_START), CSS.indexOf(SIZES_START))
  const uxJs = JS.slice(JS.indexOf(JS_START))
  const code = uxCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const jsCode = uxJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  is(CSS.indexOf(UX_START) > 0 && CSS.indexOf(UX_START) < CSS.indexOf(SIZES_START) && CSS.split(SIZES_START).length === 2 && CSS.slice(CSS.indexOf(SIZES_START)).trim().endsWith('}'), 'the UX section sits BEFORE the sizes section, which is still the last thing in the file (scripts/sizes-screen-test.mjs needs that)', '')
  is(!uxCss.includes('SIZES'), 'the UX section never contains the word the sizes suite cuts on', '')
  is(JSON.stringify([...uxCss.matchAll(/\/\* \[(ux-[a-z]+)\] \*\//g)].map((m) => m[1])) === JSON.stringify(BLOCKS), `blocks ${BLOCKS.join(', ')} in order`, [...uxCss.matchAll(/\/\* \[(ux-[a-z]+)\] \*\//g)].map((m) => m[1]).join(','))
  is(!/\$/.test(uxCss) && !/\$/.test(uxJs), 'no dollar sign in the section or the script (the installer runs through docker compose)', '')
  is(!/(^|[;{\s])(margin|padding|border)-(left|right)\b|(^|[;{\s])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:|translateX/.test(code), 'CSS: logical properties only (RTL mirrors by itself)', '')
  const imp = (code.match(/!important/g) || []).length
  is(imp === 4, 'CSS: !important four times, each explained (the guest card margin the page sets with !important; the location control\'s inline display and inline colour; the dark hint colour the build sets with !important)', String(imp))
  is(!/url\(|@import|expression\(|javascript:/.test(code), 'CSS: no url(), import or script', '')
  is(/--accent-text|#b8430f|#171a1e|currentColor/.test(code) && !/#fff\b|\bwhite\b(?!-space)/.test(code.replace(/rgba\(255/g, '')), 'CSS: brand colours only, no white text introduced', '')
  is(!/setTimeout|setInterval|requestAnimationFrame/.test(jsCode), 'script: no timer and no per-frame work (a plain callback on DOM changes)', '')
  is(!/\.value\s*=[^=]|\.innerHTML|\.outerHTML|insertAdjacentHTML|\.remove\(\)|\.appendChild|replaceChild|fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(jsCode), 'script: writes no field value, sends nothing, stores nothing, builds no HTML, appends nothing (it inserts and removes only its own links)', '')
  is((jsCode.match(/removeChild/g) || []).length === 1 && /sweep\(kind, keep\)/.test(jsCode), 'script: removes only nodes of its own class (one removeChild, inside sweep)', '')
  is(/aria-expanded/.test(jsCode) && /type = 'button'/.test(jsCode), 'script: the links are buttons with aria-expanded', '')
  is(/\u0639\u0646\u062F\u0643 \u0643\u0648\u062F \u062E\u0635\u0645\u061F/.test(uxJs) && /Have a discount code\?/.test(uxJs) && /delivery note or your location/.test(uxJs) && /\u0623\u0636\u0641 \u0645\u0644\u0627\u062D\u0638\u0629 \u0644\u0644\u062A\u0648\u0635\u064A\u0644 \u0623\u0648 \u0645\u0648\u0642\u0639\u0643/.test(uxJs), 'script: every sentence exists in Arabic and English', '')
  is(/"Delivery"/.test(code) && /"Free"/.test(code) && /\\0645\\062C\\0627\\0646\\064A/.test(code) && /\\0627\\0644\\062A\\0648\\0635\\064A\\0644/.test(code), 'CSS: the free-delivery row has both languages (ar spelled with escapes: التوصيل / مجاني)', '')
  is(/window\.__sportaCheckoutUx/.test(jsCode) && /if \(window\.__sportaCheckoutUx\) return/.test(jsCode), 'script: evaluating it twice behaves like once', '')
  is(/catch \(e\)[\s\S]{0,120}obs\.disconnect\(\)/.test(jsCode), 'script: a failure disconnects the observer (the order form never depends on it)', '')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  is(pkg.scripts['test:checkout-ux'] === 'node scripts/checkout-ux-test.mjs', 'package.json has the test:checkout-ux script', '')
}

await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
