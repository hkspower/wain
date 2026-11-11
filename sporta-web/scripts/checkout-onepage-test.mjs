// "Make full one page order page": the "ONEPAGE" section of public/sporta-checkout-a11y.css and the matching block at the end of
// public/sporta-checkout-a11y.js, proven two ways.
//
//   npm run test:checkout-onepage
//
//   PART A  fixtures (always runs; no server, no build, no capture folder). scripts/fixtures/checkout-a11y.mjs holds the exact live
//           markup of the returning shopper's checkout and the guest's summary + pay bar. Rendered at 320/390/768/1024/1280 in
//           Arabic and English with the section ON and OFF (the file with the ONEPAGE span cut out): layout of the quick checkout
//           (pay button under the bag from 1024px, mirrored in RTL), the guest's two columns from 768px, no sideways scroll.
//   PART B  the REAL compiled storefront (the captured mirror of the live build, same harness idea as test:checkout-ux:
//           UX_LIVE_DIR=/path/to/capture, a folder with index.html, assets/, api/). Every /api call is answered by the test, no
//           order is ever sent (the order route is aborted AND counted: it must stay at zero), nothing leaves the machine.
//           Without the capture folder PART B is skipped LOUDLY and the run exits 3 (not green), so a skipped part can never be
//           mistaken for a pass.
//           320/390/768/1024/1280 x ar/en x light/dark, guest and returning shopper, section ON and OFF:
//             - everything the order needs is on the delivery screen: every required field, the method radios, the delivery fee
//               and totals, the pay button, in DOCUMENT ORDER (fields, address, payment, bag lines, discount, totals, button)
//             - no step indicator on screen (still announced), no sideways scroll, targets >= 44px, fields >= 16px on phones
//             - the pay bar is fixed to the bottom, never covers a focused field, and the content ends above it
//             - RTL mirrors LTR (form on the start side, summary on the other) from 768px
//             - the page's own pay button is the SAME node with the SAME text and handlers before and after the add-on has run
//             - the merge: choose a method on the delivery screen, press the page's own Continue, land on Review with that method
//               shown, and NOTHING placed (zero order requests, the Review button untouched); "Change payment" shows the app's own
//               Payment screen with that method; with the section OFF the shopper lands on the Payment screen instead
//   MUTATION  section removed (CSS and JS, then each alone) must fail the same checks (listed at the end).
// Env: CHROMIUM_PATH, UX_LIVE_DIR, ONEPAGE_FAST=1 (fewer widths in part B), ONEPAGE_VERBOSE=1.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage } from './fixtures/checkout-a11y.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const CSS = readFileSync(join(PUB, 'sporta-checkout-a11y.css'), 'utf8')
const JS = readFileSync(join(PUB, 'sporta-checkout-a11y.js'), 'utf8')
const CSS_MARK = '/* ==== ONEPAGE:', CSS_END = '/* ==== SIZES:', JS_MARK = '/* ==== ONEPAGE:'
const cutCss = (s) => { const a = s.indexOf(CSS_MARK), b = s.indexOf(CSS_END); return a < 0 ? s : s.slice(0, a) + (b < 0 ? '' : s.slice(b)) }
const cutJs = (s) => { const a = s.indexOf(JS_MARK); return a < 0 ? s : s.slice(0, a) }
const CSS_OFF = cutCss(CSS), JS_OFF = cutJs(JS)
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const VERBOSE = !!process.env.ONEPAGE_VERBOSE
const FAST = !!process.env.ONEPAGE_FAST

let pass = 0, fail = 0
const failures = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; if (VERBOSE) console.log('ok   ' + msg) } else { fail++; failures.push(msg); console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, t) => Math.abs(a - b) <= t
const f1 = (n) => (n == null || Number.isNaN(n) ? 'n/a' : (Math.round(n * 10) / 10).toString())

const WIDTHS = [[320, 640], [390, 844], [768, 1024], [1024, 768], [1280, 800]]
const LANGS = ['ar', 'en']

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

// ======================================================================================================================
// PART A: fixtures
// ======================================================================================================================
head('PART A  fixtures: live markup, section ON vs OFF')
const A = async (lang, w, h, state, css) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  await pg.setContent(fixturePage(lang, css, { state, n: 3 }))
  const r = await pg.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height } }
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0
    const sub = q('.purchase-quick__submit'), bag = q('.purchase-quick__bag'), del = q('.purchase-quick__delivery'), pay = q('.purchase-quick__payment')
    const aside = q('.purchase-checkout-layout > aside'), formCol = q('.purchase-checkout-layout > div'), bar = q('.purchase-paybar')
    const sumBtn = q('.purchase-checkout-summary > .btn-primary')
    return {
      docW: document.documentElement.scrollWidth, vw: innerWidth,
      sub: rect(sub), bag: rect(bag), del: rect(del), pay: rect(pay), assurance: rect(q('.purchase-quick__assurance')),
      aside: rect(aside), formCol: rect(formCol), barShown: shown(bar), sumBtnShown: shown(sumBtn), sumBtn: rect(sumBtn),
      steps: !!q('nav.purchase-steps'),
    }
  })
  await ctx.close()
  return r
}
const judgeA = (r, state, lang, w) => {
  const out = []
  const t = (id, ok, d = '') => out.push([id, !!ok, d])
  t('a-no-sideways', r.docW <= r.vw, `${r.docW} > ${r.vw}`)
  if (state === 'quick' && w >= 1024) {
    t('a-quick-under-bag', near(r.sub.l, r.bag.l, 2) && near(r.sub.w, r.bag.w, 2) && r.sub.t >= r.bag.b - 1 && r.sub.t - r.bag.b <= 40,
      `submit x ${f1(r.sub.l)} w ${f1(r.sub.w)} top ${f1(r.sub.t)}; bag x ${f1(r.bag.l)} w ${f1(r.bag.w)} bottom ${f1(r.bag.b)}`)
    t('a-quick-bag-flush', near(r.bag.b, Math.max(r.del.b, r.pay.b), 2) || r.bag.b >= Math.max(r.del.b, r.pay.b) - 2, `bag bottom ${f1(r.bag.b)} vs cards ${f1(Math.max(r.del.b, r.pay.b))}`)
    t('a-quick-mirrored', lang === 'ar' ? r.bag.l < r.del.l : r.bag.l > r.del.l, `bag x ${f1(r.bag.l)} delivery x ${f1(r.del.l)}`)
  }
  if (state === 'guest' && w >= 1024) {
    t('a-guest-two-columns', r.aside.t < r.formCol.b - 100 && (lang === 'ar' ? r.aside.l < r.formCol.l : r.aside.l > r.formCol.l), `aside top ${f1(r.aside.t)} form bottom ${f1(r.formCol.b)}`)
    t('a-guest-pay-on-summary', r.sumBtnShown && r.sumBtn.h >= 44, `shown ${r.sumBtnShown} h ${f1(r.sumBtn && r.sumBtn.h)}`)
    t('a-guest-bar-gone', !r.barShown, 'the phone pay bar still shows')
  }
  return out
}
const cellsA = []
for (const state of ['quick', 'guest']) for (const [w, h] of WIDTHS) for (const lang of LANGS) cellsA.push([state, lang, w, h])
const offFailsA = new Set()
for (const [state, lang, w, h] of cellsA) {
  const on = judgeA(await A(lang, w, h, state, CSS), state, lang, w)
  for (const [id, ok, d] of on) is(ok, `A ${state} ${lang} ${w}px: ${id} (ON)`, d)
  const off = judgeA(await A(lang, w, h, state, CSS_OFF), state, lang, w)
  for (const [id, ok] of off) if (!ok) offFailsA.add(id)
}
for (const id of ['a-quick-under-bag']) is(offFailsA.has(id), `A mutation: with the section cut, ${id} fails`)

// ======================================================================================================================
// PART B: the real compiled storefront
// ======================================================================================================================
const LIVE = process.env.UX_LIVE_DIR || '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'
let skippedB = false
if (!existsSync(join(LIVE, 'index.html')) || !existsSync(join(LIVE, 'assets'))) {
  skippedB = true
  head('PART B  SKIPPED')
  console.log('Set UX_LIVE_DIR to a capture of the live build (a folder with index.html, assets/ and api/). Part B is NOT run.')
} else {
  head('PART B  the real compiled storefront')
  const MIME = { js: 'text/javascript', css: 'text/css', json: 'application/json', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
  const ADDON = /^\/(sporta-[\w-]+\.(css|js)|boot\.js|config\.js|birthday\.js)$/
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  let serve = { css: CSS, js: JS }
  const server = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x')
    const send = (code, type, body) => { s.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); s.end(body) }
    if (u.pathname === '/api/api.php') {
      const r = u.searchParams.get('r')
      if (r === 'slide_image') return send(200, 'image/png', readFileSync(join(PUB, 'og-image.png')))
      const f = join(LIVE, 'api', r + '.json')
      return existsSync(f) ? send(200, 'application/json', readFileSync(f)) : send(404, 'application/json', '{"error":"not_found"}')
    }
    if (u.pathname === '/sporta-checkout-a11y.css') return send(200, 'text/css', serve.css)
    if (u.pathname === '/sporta-checkout-a11y.js') return send(200, 'text/javascript', serve.js)
    if (u.pathname === '/payment/knet-official.png') return send(200, 'image/png', PNG1)
    if (u.pathname === '/product-photo-unavailable.svg') return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#e2dbce"/></svg>')
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

  const ITEMS = [
    { key: 'a__2XL__-', slug: 'cagliari-calcio-sweatshirt-navy', size: '2XL', fit: null, name: { en: 'Cagliari Calcio Sweatshirt — Navy', ar: 'سويت شيرت كالياري كالتشو — كحلي' }, price: 10, image: '/product-photo-unavailable.svg', qty: 1 },
    { key: 'b__ONE__-', slug: 'cagliari-calcio-backpack-navy', size: 'ONE', fit: null, name: { en: 'Cagliari Calcio Backpack — Navy', ar: 'حقيبة ظهر كالياري كالتشو — كحلي' }, price: 9, image: '/product-photo-unavailable.svg', qty: 2 },
  ]
  const SAVED = { name: 'Mohammed Alotaibi', phone: '55512345', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '7', floor: '', flat: '', note: '' }

  async function open(o) {
    const { lang, w, h } = o, touch = w < 768
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, locale: lang === 'ar' ? 'ar-KW' : 'en-US', deviceScaleFactor: 1 })
    const pg = await ctx.newPage()
    const log = { orders: 0, errors: [] }
    await pg.addInitScript(([items, lang, saved, theme, off]) => {
      try { if (off) localStorage.setItem('sporta_onepage', 'off'); localStorage.setItem('sporta_cart', JSON.stringify(items)); localStorage.setItem('lang', lang); if (saved) localStorage.setItem('sporta.delivery', JSON.stringify(saved)); if (theme) localStorage.setItem('sporta_theme', theme) } catch (e) { /* ignore */ }
    }, [ITEMS, lang, o.saved ? SAVED : null, o.theme || null, !!o.off])
    await pg.route('**/api/api.php?r=discount*', (route) => { const sub = 28, fee = 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subtotal: sub, delivery: fee, total: sub + fee, total_fils: (sub + fee) * 1000, applied: [] }) }) })
    await pg.route('**/api/api.php?r=checkout_config*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ delivery_fee: 1, methods: ['knet', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' }) }))
    await pg.route('**/api/api.php?r=order*', (route) => { log.orders++; return route.abort() }) // NEVER answered: an order placed would be a failed test
    await pg.route(/\/(knet|pay)\/pay\.php|\/payment\/result/, (route) => route.abort())
    pg.on('pageerror', (e) => log.errors.push(String(e)))
    await pg.goto(BASE + '/checkout?lang=' + lang, { waitUntil: 'domcontentloaded', timeout: 240000 })
    return { pg, ctx, log }
  }
  async function ready(pg, kind) {
    await pg.waitForSelector(kind === 'quick' ? '.purchase-quick' : '.purchase-checkout-layout', { timeout: 240000 })
    await pg.waitForFunction(() => { const b = document.querySelector('.purchase-paybar button[type=submit], .purchase-quick__submit'); return !!b && !b.disabled }, null, { timeout: 240000 })
    await pg.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 60000 }).catch(() => {})
    if (kind === 'guest') await pg.waitForSelector('#sporta-loc', { state: 'attached', timeout: 8000 }).catch(() => {})
    await sleep(900)
  }

  const SNAP = (kind) => {
    const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)]
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height, vt: b.top, vb: b.bottom } }
    const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && b.width > 1.5 && b.height > 1.5 }
    const form = q(kind === 'quick' ? 'form.purchase-quick' : 'form.purchase-checkout-layout')
    const scope = q('.purchase-flow')
    const nav = q('nav.purchase-steps')
    const radios = qa(kind === 'quick' ? 'input[name="paymethod"]' : 'input[name="sporta-paymethod"], input[name="paymethod"]')
    const payBtns = qa('.purchase-checkout-summary > button[type=submit], .purchase-paybar button[type=submit], .purchase-quick__submit')
    const visPay = payBtns.find(vis) || null
    if (visPay && !visPay.__sp) visPay.__sp = { text: visPay.textContent, node: true }
    const before = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const nodes = kind === 'quick'
      ? [q('.purchase-quick__delivery'), q('.purchase-quick__bag ul'), q('.purchase-quick__bag input.font-mono, .sporta-fold--coupon'), q('.purchase-quick__bag .purchase-total'), q('.purchase-quick__payment'), q('.purchase-quick__submit')]
      : [q('#f-name'), q('#f-area'), q('.sporta-pay'), q('.purchase-checkout-summary > ul'), q('.sporta-fold--coupon, .purchase-checkout-summary input.font-mono'), q('.purchase-checkout-summary .purchase-total'), visPay]
    let inOrder = nodes.every(Boolean)
    for (let i = 0; i + 1 < nodes.length && inOrder; i++) if (!before(nodes[i], nodes[i + 1])) inOrder = false
    const need = kind === 'quick' ? [] : ['f-name', 'f-phone', 'f-governorate', 'f-area', 'f-block', 'f-street', 'f-building'].map((id) => ({ id, ok: vis(q('#' + id)) }))
    const controls = qa('.purchase-flow form :is(input:not([type=hidden]), select, textarea, button, a[href]), .purchase-flow > .guest-note a')
      .filter((e) => vis(e) && !(e.getAttribute('aria-hidden') === 'true' && e.tabIndex === -1))
    const small = [], tiny = []
    for (const e of controls) {
      const isChk = e.matches('input[type=checkbox], input[type=radio]')
      const b = e.getBoundingClientRect()
      let hit = b.height, tag = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
      if (isChk) { const lab = e.closest('label'); if (lab) hit = lab.getBoundingClientRect().height }
      if (hit < 43.5) small.push(tag + ':' + Math.round(hit))
      if (e.matches('input:not([type=checkbox]):not([type=radio]), select, textarea') && parseFloat(getComputedStyle(e).fontSize) < 15.99) tiny.push(tag + ':' + getComputedStyle(e).fontSize)
    }
    const bar = q('.purchase-paybar'), asideEl = q('.purchase-checkout-layout > aside'), formCol = q('.purchase-checkout-layout > div'), bagEl = q('.purchase-quick__bag')
    const rows = qa('.purchase-checkout-summary > ul > li, .purchase-quick__bag > ul > li')
    const feeRow = qa('.purchase-checkout-summary > div, .purchase-quick__bag > div').map((d) => d.textContent).join(' ')
    const html = document.documentElement
    return {
      vw: innerWidth, vh: innerHeight, docW: html.scrollWidth, dir: getComputedStyle(html).direction, theme: html.getAttribute('data-theme'),
      nav: nav ? { label: nav.getAttribute('aria-label'), r: rect(nav), clip: getComputedStyle(nav).clipPath, pos: getComputedStyle(nav).position } : null,
      radios: radios.map((r) => ({ v: r.value, vis: vis(r), checked: r.checked })),
      pay: visPay ? { r: rect(visPay), text: visPay.textContent, marked: !!visPay.__sp } : null,
      bar: bar ? { r: rect(bar), pos: getComputedStyle(bar).position, vis: vis(bar) } : null,
      inOrder, need, small, tiny,
      total: vis(q('.purchase-total')), feeText: feeRow, hasDigits: /\d+\.\d{3}/.test(feeRow.replace(/[٠-٩]/g, '0')) || /[٠-٩]/.test(feeRow),
      loc: vis(q('#sporta-loc')), locAttached: !!q('#sporta-loc'), noteFold: vis(q('.sporta-fold--note')), remember: !!q('.purchase-flow label input[type=checkbox]'),
      aside: rect(asideEl), formCol: rect(formCol), bag: rect(bagEl), sub: rect(q('.purchase-quick__submit')), subPos: q('.purchase-quick__submit') ? getComputedStyle(q('.purchase-quick__submit')).position : null,
      thumbs: qa('.sporta-thumb').length, qty: qa('[data-sporta-qty]').map((p) => p.getAttribute('data-sporta-qty')), rows: rows.length,
      spacer: rect(q('.purchase-checkout-layout > div[aria-hidden=true]:last-child')),
      scrollPad: parseFloat(getComputedStyle(html).scrollPaddingBottom) || 0,
      fixedBar: bar ? getComputedStyle(bar).position === 'fixed' : false,
    }
  }

  const judgeB = (s, kind, lang, w, theme) => {
    const out = []
    const t = (id, ok, d = '') => out.push([id, !!ok, d])
    const phone = w < 768
    t('b-no-sideways', s.docW <= s.vw, `${s.docW} > ${s.vw}`)
    t('b-rtl-mirrored-dir', s.dir === (lang === 'ar' ? 'rtl' : 'ltr'))
    t('b-steps-hidden', s.nav && s.nav.r.w <= 2 && s.nav.pos === 'absolute' && /inset\(50%\)/.test(s.nav.clip) && /[\d\u0660-\u0669]/.test(s.nav.label || ''), `nav ${s.nav && JSON.stringify([s.nav.r && s.nav.r.w, s.nav.pos, s.nav.clip])} label ${s.nav && s.nav.label}`)
    t('b-pay-present', s.pay && s.pay.r.h >= 44 && s.pay.r.w >= 44, `pay ${s.pay && f1(s.pay.r.h)}`)
    t('b-pay-text-untouched', s.pay && s.pay.marked && s.pay.text.trim().length > 0)
    t('b-method-radios', s.radios.length >= 1 && s.radios.every((r) => r.vis) && (kind === 'quick' || s.radios.some((r) => r.checked)), JSON.stringify(s.radios))
    t('b-totals-and-fee', s.total && s.hasDigits, s.feeText.replace(/\s+/g, ' ').slice(0, 80))
    t('b-targets-44', s.small.length === 0, s.small.join(' '))
    t('b-order-of-regions', s.inOrder)
    t('b-lines-with-photo-or-qty', kind === 'quick' ? s.qty.length === s.rows && s.rows > 0 : s.thumbs === s.rows && s.rows > 0, `thumbs ${s.thumbs} qty ${s.qty} rows ${s.rows}`)
    if (kind === 'guest') {
      t('b-required-fields', s.need.every((n) => n.ok), s.need.filter((n) => !n.ok).map((n) => n.id).join(','))
      t('b-location-control-kept', s.locAttached && (s.loc || (phone && s.noteFold)), `attached ${s.locAttached} visible ${s.loc} fold ${s.noteFold}`)
      t('b-remember-kept', s.remember)
    }
    if (phone) {
      t('b-fields-16px', s.tiny.length === 0, s.tiny.join(' '))
      if (kind === 'guest') {
        t('b-bar-fixed-bottom', s.fixedBar && s.bar.vis && near(s.bar.r.vb, s.vh, 1.5) && s.bar.r.h >= 56, `bar bottom ${f1(s.bar && s.bar.r.vb)} of ${s.vh}, h ${f1(s.bar && s.bar.r.h)}`)
        t('b-bar-spacer-covers-bar', s.spacer && s.bar && s.spacer.h >= s.bar.r.h - 1, `spacer ${f1(s.spacer && s.spacer.h)} bar ${f1(s.bar && s.bar.r.h)}`)
        t('b-scroll-padding-for-bar', s.scrollPad >= (s.bar ? s.bar.r.h : 0), `scroll-padding ${s.scrollPad}`)
      } else {
        t('b-quick-pay-sticky', s.subPos === 'sticky', String(s.subPos))
        t('b-scroll-padding-for-bar', s.scrollPad >= 80, `scroll-padding ${s.scrollPad}`)
      }
    } else if (kind === 'guest' && w >= 1024) {
      t('b-guest-two-columns', s.aside && s.formCol && s.aside.t < s.formCol.b - 100 && (lang === 'ar' ? s.aside.l < s.formCol.l : s.aside.l > s.formCol.l), `aside x ${f1(s.aside && s.aside.l)} form x ${f1(s.formCol && s.formCol.l)}`)
      t('b-desktop-pay-in-summary', s.pay && s.aside && s.pay.r.l >= s.aside.l - 1 && s.pay.r.r <= s.aside.r + 1, 'the visible pay button is not inside the summary')
      t('b-bar-gone', !s.bar || !s.bar.vis)
    } else if (kind === 'guest') {
      t('b-tablet-pay-bar-kept', s.bar && s.bar.vis && s.fixedBar, 'the one-column tablet layout keeps the fixed pay bar')
    } else if (w >= 1024) {
      t('b-quick-under-bag', s.sub && s.bag && near(s.sub.l, s.bag.l, 2) && s.sub.t >= s.bag.b - 1 && s.sub.t - s.bag.b <= 40, `submit ${f1(s.sub && s.sub.l)}/${f1(s.sub && s.sub.t)} bag ${f1(s.bag && s.bag.l)}/${f1(s.bag && s.bag.b)}`)
    }
    return out
  }

  // focus every field on a phone: the fixed bar must never cover the focused one
  async function focusCover(pg, kind) {
    const out = []
    const ids = await pg.evaluate(() => ['f-name', 'f-phone', 'f-governorate', 'f-area', 'f-block', 'f-street', 'f-building', 'f-floor', 'f-flat'].filter((i) => document.getElementById(i)).concat(document.querySelector('input[name="sporta-paymethod"]') ? ['@pay'] : []))
    for (const id of ids) {
      await pg.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await sleep(120)
      await pg.evaluate((id) => { const f = id === '@pay' ? document.querySelector('input[name="sporta-paymethod"]') : document.getElementById(id); f.focus() }, id)
      await sleep(1100)
      const r = await pg.evaluate((id) => {
        const f = id === '@pay' ? document.querySelector('input[name="sporta-paymethod"]') : document.getElementById(id)
        const cover = document.querySelector('.purchase-paybar') || document.querySelector('.purchase-quick__submit')
        const b = f.getBoundingClientRect(), c = cover && cover.getBoundingClientRect()
        const covered = c && ['fixed', 'sticky'].includes(getComputedStyle(cover).position) && b.bottom > c.top + 0.5 && b.top < c.bottom
        return covered ? id + ' bottom ' + Math.round(b.bottom) + ' bar top ' + Math.round(c.top) : null
      }, id)
      if (r) out.push(r)
    }
    return out
  }
  // the content must END above the bar: scroll so the form's last box is at the bottom edge of the screen
  async function endAboveBar(pg) {
    return pg.evaluate(() => {
      const bar = document.querySelector('.purchase-paybar')
      const aside = document.querySelector('.purchase-checkout-layout > aside')
      const sp = document.querySelector('.purchase-checkout-layout > div[aria-hidden=true]:last-child')
      if (!bar || !aside || !sp) return null
      const target = sp.getBoundingClientRect().bottom + scrollY - innerHeight
      window.scrollTo({ top: Math.max(0, target), behavior: 'instant' })
      return { asideBottom: aside.getBoundingClientRect().bottom, barTop: bar.getBoundingClientRect().top }
    })
  }

  async function fillGuest(pg) {
    await pg.fill('#f-name', 'Mohammed Alotaibi')
    await pg.fill('#f-phone', '55512345')
    await pg.selectOption('#f-governorate', 'hawalli')
    await pg.fill('#f-area', 'Salmiya')
    await pg.fill('#f-block', '4'); await pg.fill('#f-street', '12'); await pg.fill('#f-building', '7')
  }
  const stageNow = (pg) => pg.evaluate(() => { const li = document.querySelector('.purchase-steps li[data-state="current"]'); return li ? [...li.parentNode.children].indexOf(li) : -1 })
  const visiblePay = (pg) => pg.evaluateHandle(() => [...document.querySelectorAll('.purchase-checkout-summary > button[type=submit], .purchase-paybar button[type=submit]')].find((b) => b.getBoundingClientRect().height > 0))

  // ---- the matrix: ON ----
  const cellsB = []
  const widths = FAST ? [[390, 844], [1280, 800]] : WIDTHS
  for (const kind of ['guest', 'quick']) for (const [w, h] of widths) for (const lang of LANGS) cellsB.push({ kind, w, h, lang, theme: '' })
  for (const kind of ['guest', 'quick']) for (const [w, h] of [[390, 844], [1280, 800]]) cellsB.push({ kind, w, h, lang: 'ar', theme: 'dark' })
  const t0 = Date.now()
  const measure = async (c, css, js) => {
    serve = { css, js }
    const { pg, ctx, log } = await open({ lang: c.lang, w: c.w, h: c.h, saved: c.kind === 'quick', theme: c.theme })
    await ready(pg, c.kind)
    const s = await pg.evaluate(SNAP, c.kind)
    let cover = [], end = null
    if (c.w < 768) {
      cover = await focusCover(pg, c.kind)
      if (c.kind === 'guest') end = await endAboveBar(pg)
    }
    await ctx.close()
    return { s, cover, end, log }
  }
  const offFailsB = new Set()
  for (const c of cellsB) {
    const tag = `B ${c.kind} ${c.lang} ${c.w}px${c.theme ? ' ' + c.theme : ''}`
    const on = await measure(c, CSS, JS)
    for (const [id, ok, d] of judgeB(on.s, c.kind, c.lang, c.w, c.theme)) is(ok, `${tag}: ${id} (ON)`, d)
    if (c.w < 768) {
      is(on.cover.length === 0, `${tag}: no focused field is left behind the bottom bar (ON)`, on.cover.join('; '))
      if (c.kind === 'guest') is(on.end && on.end.asideBottom <= on.end.barTop + 1, `${tag}: the content ends above the bar (ON)`, JSON.stringify(on.end))
    }
    is(on.log.orders === 0, `${tag}: no order request was made`)
    is(on.log.errors.length === 0, `${tag}: no page error (ON)`, on.log.errors.join(' | '))
    if (!c.theme) {
      const off = await measure(c, CSS_OFF, JS_OFF)
      for (const [id, ok] of judgeB(off.s, c.kind, c.lang, c.w, c.theme)) if (!ok) offFailsB.add(id)
      if (off.cover.length) offFailsB.add('b-focus-not-covered')
      if (c.kind === 'guest' && off.end && off.end.asideBottom > off.end.barTop + 1) offFailsB.add('b-content-above-bar')
    }
    process.stdout.write(`  measured ${tag} (${Math.round((Date.now() - t0) / 1000)}s)\n`)
  }
  for (const id of ['b-steps-hidden', 'b-method-radios', 'b-order-of-regions', 'b-lines-with-photo-or-qty', 'b-scroll-padding-for-bar', 'b-focus-not-covered'].concat(FAST ? [] : ['b-quick-under-bag'])) {
    is(offFailsB.has(id), `B mutation: with the section cut, ${id} fails`)
  }

  // ---- the merge: Delivery + Payment on one screen, Review the only confirmation ----
  head('PART B  merge: choose a method on the delivery screen, Continue, land on Review')
  for (const [w, h, lang] of [[390, 844, 'ar'], [390, 844, 'en'], [320, 640, 'en'], [768, 1024, 'ar'], [1280, 800, 'ar']]) {
    for (const mode of ['on', 'off']) {
      serve = mode === 'on' ? { css: CSS, js: JS } : { css: CSS_OFF, js: JS_OFF }
      const { pg, ctx, log } = await open({ lang: lang, w, h })
      await ready(pg, 'guest')
      const tag = `merge ${lang} ${w}px ${mode.toUpperCase()}`
      await fillGuest(pg)
      const wantCod = mode === 'on'
      const btn0 = await visiblePay(pg)
      await btn0.evaluate((b) => { b.__orig = { text: b.textContent, onclick: b.onclick, ariaLabel: b.getAttribute('aria-label'), cls: b.className } })
      if (wantCod) { await pg.locator('input[name="sporta-paymethod"][value="cod"]').check(); await sleep(400) }
      const btn = await visiblePay(pg)
      const same = await btn.evaluate((b) => !!b.__orig && b.textContent === b.__orig.text && b.onclick === b.__orig.onclick && b.getAttribute('aria-label') === b.__orig.ariaLabel && b.className === b.__orig.cls)
      is(same, `${tag}: the page's own pay button is the same node, same text, class and handler after the add-on ran and a method was chosen`)
      await btn.asElement().click()
      const landed = await pg.waitForFunction(() => { const li = document.querySelector('.purchase-steps li[data-state="current"]'); const i = li ? [...li.parentNode.children].indexOf(li) : -1; return i >= 2 ? i : false }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => -1)
      await sleep(700)
      const st = await stageNow(pg)
      if (mode === 'on') {
        is(st === 3, `${tag}: lands on Review (screen 4 of 4), not Payment`, `stage ${st}`)
        const rev = await pg.evaluate(() => (document.querySelector('.purchase-review-block:last-of-type') || document.body).textContent)
        is(/الدفع عند الاستلام|Cash on delivery/.test(rev), `${tag}: Review shows the method chosen on the delivery screen (cash on delivery)`, rev.replace(/\s+/g, ' ').slice(0, 120))
        const confirm = await pg.evaluate(() => { const b = document.querySelector('.purchase-checkout-summary > button[type=submit], .purchase-paybar button[type=submit]'); return b ? { disabled: b.disabled, text: b.textContent } : null })
        is(confirm && !confirm.disabled, `${tag}: the Review confirm button is untouched (enabled, not pressed)`, JSON.stringify(confirm))
        is(log.orders === 0, `${tag}: zero order requests (nothing was placed)`, String(log.orders))
        // "Change payment" shows the app's own Payment screen and the add-on does NOT hop again
        const edit = pg.locator('button', { hasText: /تعديل الدفع|Edit payment|Change payment/ }).first()
        if (await edit.count()) {
          await edit.click(); await sleep(900)
          const st2 = await stageNow(pg)
          const sel = await pg.evaluate(() => { const r = document.querySelector('input[name="paymethod"]:checked'); return r ? r.value : null })
          is(st2 === 2 && sel === 'cod', `${tag}: "Change payment" shows the app's own Payment screen with cash on delivery, no second hop`, `stage ${st2} method ${sel}`)
        } else is(false, `${tag}: Review has a payment edit button`)
      } else {
        is(st === 2, `${tag}: with the section cut the shopper lands on the Payment screen (the live behaviour)`, `stage ${st}`)
      }
      is(log.orders === 0, `${tag}: no order request`, String(log.orders))
      void landed
      await ctx.close()
    }
  }
  // default method (KNET) flows the same way, and the unchosen Review is reachable with the default untouched
  {
    serve = { css: CSS, js: JS }
    const { pg, ctx, log } = await open({ lang: 'en', w: 390, h: 844 })
    await ready(pg, 'guest')
    await fillGuest(pg)
    const checked = await pg.evaluate(() => (document.querySelector('input[name="sporta-paymethod"]:checked') || {}).value)
    is(checked === 'knet', 'merge default: the page\'s default method (KNET) is preselected on the delivery screen', String(checked))
    await (await visiblePay(pg)).asElement().click()
    await pg.waitForFunction(() => { const li = document.querySelector('.purchase-steps li[data-state="current"]'); return li && [...li.parentNode.children].indexOf(li) === 3 }, null, { timeout: 8000 }).catch(() => {})
    const st = await stageNow(pg)
    is(st === 3, 'merge default: KNET reaches Review in one press', `stage ${st}`)
    is(log.orders === 0, 'merge default: zero order requests')
    await ctx.close()
  }
  // a validation failure must not hop, and must not leave the Payment screen hidden
  {
    serve = { css: CSS, js: JS }
    const { pg, ctx } = await open({ lang: 'en', w: 390, h: 844 })
    await ready(pg, 'guest')
    await (await visiblePay(pg)).asElement().click()
    await sleep(900)
    const st = await stageNow(pg)
    const hidden = await pg.evaluate(() => document.documentElement.hasAttribute('data-sporta-hop'))
    is(st === 1, 'invalid form: Continue stays on the delivery screen (field errors, no hop)', `stage ${st}`)
    // the flag stays only until the shopper fixes the form and continues; the screen itself is never hidden here
    is(await pg.evaluate(() => getComputedStyle(document.querySelector('.purchase-checkout-layout')).visibility) === 'visible', 'invalid form: the form is visible', String(hidden))
    await ctx.close()
  }
  // the owner's switch (localStorage here; SPORTA_CONFIG.onePage = false in config.js does the same): the live three screens, untouched
  {
    serve = { css: CSS, js: JS }
    const { pg, ctx, log } = await open({ lang: 'en', w: 390, h: 844, off: true })
    await ready(pg, 'guest')
    is((await pg.locator('.sporta-pay').count()) === 0, 'switch off: no method choice on the delivery screen')
    await fillGuest(pg)
    await (await visiblePay(pg)).asElement().click()
    await pg.waitForFunction(() => { const li = document.querySelector('.purchase-steps li[data-state="current"]'); return li && [...li.parentNode.children].indexOf(li) === 2 }, null, { timeout: 8000 }).catch(() => {})
    await sleep(900)
    is((await stageNow(pg)) === 2, 'switch off: Continue shows the app\'s own Payment screen and stays there (no hop)')
    is(log.orders === 0, 'switch off: zero order requests')
    await ctx.close()
  }
  // the add-on JS failing must leave the live page working
  {
    serve = { css: CSS, js: 'window.__sportaOnePage = undefined;' + JS.replace('payPanel()\n      hopCheck()', 'throw new Error("injected")\n      hopCheck()') }
    const { pg, ctx, log } = await open({ lang: 'en', w: 390, h: 844 })
    await ready(pg, 'guest')
    await fillGuest(pg)
    await (await visiblePay(pg)).asElement().click()
    await pg.waitForFunction(() => { const li = document.querySelector('.purchase-steps li[data-state="current"]'); return li && [...li.parentNode.children].indexOf(li) === 2 }, null, { timeout: 8000 }).catch(() => {})
    is((await stageNow(pg)) === 2, 'failure: when the script throws, the page behaves as the live build (Payment screen next)')
    is(log.orders === 0, 'failure: zero order requests')
    await ctx.close()
  }
  // CSS-only and JS-only cuts each fail something
  head('PART B  mutation: CSS alone and JS alone')
  {
    const c = { kind: 'guest', w: 390, h: 844, lang: 'ar', theme: '' }
    const cssOnly = await measure(c, CSS_OFF, JS)
    const jsOnly = await measure(c, CSS, JS_OFF)
    const fc = judgeB(cssOnly.s, 'guest', 'ar', 390).filter(([, ok]) => !ok).map(([id]) => id)
    const fj = judgeB(jsOnly.s, 'guest', 'ar', 390).filter(([, ok]) => !ok).map(([id]) => id)
    is(fc.length > 0, `mutation: CSS cut, JS kept: ${fc.length} checks fail (${fc.join(', ')})`)
    is(fj.length > 0, `mutation: JS cut, CSS kept: ${fj.length} checks fail (${fj.join(', ')})`)
  }
  server.close()
}

// ---- source rules ----
head('source rules')
{
  const css = CSS.slice(CSS.indexOf(CSS_MARK), CSS.indexOf(CSS_END))
  const js = JS.slice(JS.indexOf(JS_MARK))
  is(CSS.indexOf(CSS_MARK) > 0 && CSS.indexOf(CSS_MARK) < CSS.indexOf(CSS_END) && CSS.split(CSS_END).length === 2, 'the ONEPAGE css sits before the SIZES section, which stays last')
  is(!css.includes('$') && !js.includes('$'), 'no dollar sign in the section (the installer runs through compose)')
  is(!/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align\s*:\s*(left|right)/.test(css), 'logical properties only in the css')
  is(!/setTimeout|setInterval/.test(js), 'no timers in the script')
  is(!/\.value\s*=[^=]/.test(js.replace(/input\.value = m/, '')), 'the script never writes a field value (its own radio excepted)')
  is(!/fetch\([^)]*method|XMLHttpRequest|sendBeacon|\.submit\(|requestSubmit/.test(js), 'the script makes no request but the page\'s own GET of the checkout config, and never calls submit()')
  is(/stage\(\) !== 2/.test(js) && /Never pressed from Review/.test(js), 'the hop is guarded to the Payment screen only')
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed${skippedB ? ' (PART B SKIPPED: not a full pass)' : ''}`)
if (fail) { console.log('failed: ' + failures.slice(0, 20).join(' | ')); process.exit(1) }
process.exit(skippedB ? 3 : 0)
