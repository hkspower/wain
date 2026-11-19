// ORDER PAGES 1120 (owner, 2026-11-19: "full improve checkout and order page"): the cash order's confirmation, the tracking page, the
// invoice page's controls and the checkout's order summary, proven on the REAL compiled storefront (the capture of the live build) with
// this repo's add-ons.
//
//   npm run test:order-pages-1120     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
//   CONFIRMATION  /payment/result?trackid=<order>, status "cod": the compiled page is left exactly as it is (its five children, all shown)
//                 and ONE card (section.sprc-cash) is its last child: the order number (16px+, left to right) with a 44px Copy button
//                 (Clipboard API, the hidden-textarea fallback, a polite "Copied" that goes away), the order summary read from the
//                 public limited invoice (lines with size and quantity, subtotal, discount, delivery, the total due, where it goes),
//                 "What happens next" (three sentences and the change note), a help link to the footer's WhatsApp with the order
//                 number in the message (/contact without a footer link). Arabic + English at 390 / 768 / 1280, light and dark,
//                 no sideways scroll, no page error, the layout shift of the card's arrival under 0.1, no dead white under the
//                 card (the container carries data-sporta-cash and RECEIPT-1112's reservation is lifted). A failed, malformed,
//                 foreign or line-less invoice draws the card without the summary; the invoice is asked WITHOUT cookies and once per
//                 order; a language switch redraws it without a second call; a node React (or anyone) adds after it does not leave it
//                 above the end; a KNET order keeps its receipt, its reservation and gets no card; no order number: nothing.
//   TRACKING      /track?trackid=<order>: the step labels wrap (no ellipsis), labels, dates and figures are 12px+, steps still to come
//                 read 4.5:1 (rings 3:1), in Arabic each connector runs between the two steps it joins (not toward the next one)
//                 and nothing sticks out of the card (no sideways scroll at 390px), the two links are 44px, the help line is the
//                 card's last child with the order number in the WhatsApp message and comes back after a new search.
//   INVOICE       /invoice/<order>: Home and Print / Save as PDF are 44px, no sideways scroll.
//   CHECKOUT      /checkout (guest layout): the CASH badge is 12px+; "Edit bag" (/cart, 44px) follows the bag list and the discount link is
//                 still the box's previous sibling; the reassurance list is the summary's LAST child, its two sentences (delivery and
//                 returns, nothing about how to pay, also with card payment on beside cash), one copy after the quote changes (a discount
//                 code applied), in the page's language after a switch; from 1024px the bag list keeps the pay button inside an
//                 800px-tall screen with six long lines.
//   MUTATION      each numbered CSS block ([op-*] of sporta-shadows.css, [oc-*] of sporta-checkout-a11y.css) is cut in turn and each
//                 piece of script is broken in turn; the matching check must fail (the real files pass first).
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir, line } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const F = { shadows: 'sporta-shadows.css', checkoutCss: 'sporta-checkout-a11y.css', features: 'sporta-features.js', checkoutJs: 'sporta-checkout-a11y.js' }
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, readFileSync(join(PUB, f), 'utf8')]))

let pass = 0, fail = 0
// a scenario that hangs must end the run with a failing line, not hold the release gate until its own timeout
setTimeout(() => { console.log('FAIL watchdog: the suite did not finish in 12 minutes (it takes about 4.5)'); process.exit(1) }, 12 * 60 * 1000).unref()
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const note = (t) => console.log('note ' + t)
const holds = (check, ...a) => { try { return check(...a) === true } catch (e) { return false } }
const limit = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms).unref())
const closeQuietly = (ctx) => Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000).unref())])

// ---------------------------------------------------------------------------------------------------------------- fixtures
const TRACK = 'SPT2611190042'
const WA = 'https://wa.me/96522091914'
const STATUS_COD = { payment_status: 'pending', payment_method: 'cod', fulfilment_status: 'packed', amount: 13.5, events: [{ status: 'unfulfilled', occurred_at: '2026-11-19 09:12:00' }, { status: 'packed', occurred_at: '2026-11-19 14:40:00' }] }
const STATUS_KNET = { payment_status: 'paid', payment_method: 'knet', fulfilment_status: 'unfulfilled', amount: 21, events: [], receipt: { track_id: TRACK, payment_status: 'paid', result: 'CAPTURED', amount: '21.000', paid_at: '2026-11-12 09:05:00', paid_at_kuwait: '2026-11-12 12:05', payment_id: '100202616112345678', transaction_id: '8765432109', reference: '901234567890', auth_code: 'B35434', gateway_track_id: TRACK + 'A2' } }
const INVOICE = {
  access: 'limited', track_id: TRACK, placed_at: '2026-11-19 09:12:00', paid_at: null, amount: 13.5, subtotal: 12.5, discount_amount: 0, delivery_fee: 1,
  discount_label: null, discount_code: null, payment_method: 'cod', payment_status: 'pending', customer_name: 'S.',
  address: { governorate: 'Hawalli', area: 'Salmiya', block: null, street: null, building: null, floor: null, flat: null },
  items: [
    { name_en: 'Sgomma T-Shirt - Navy', name_ar: 'تيشيرت سغوما - كحلي', qty: 2, size: 'M', fit: null, unit_price: 5, line_total: 10 },
    { name_en: 'Tekno Shorts - Black', name_ar: 'شورت تكنو - أسود', qty: 1, size: 'L', fit: null, unit_price: 2.5, line_total: 2.5 },
  ], receipt: null,
}
const COD_WORDS = { en: 'Order confirmed', ar: 'تم تأكيد الطلب' }
const CASH_T = {
  en: { k: 'Order number', copy: 'Copy', copied: 'Copied', summary: 'Order summary', totals: ['Subtotal', 'Delivery', 'Total due on delivery'], to: 'Delivering to Salmiya, Hawalli', next: 'What happens next',
    steps: ['We will send delivery updates on WhatsApp.', 'The driver calls you before arriving.', 'Pay the driver in cash when your order arrives.'],
    note: 'Have the exact amount ready if you can — drivers do not always carry change.', help: 'Message us on WhatsApp', waText: 'Hello Sporta, I need help with my order', cur: 'KWD' },
  ar: { k: 'رقم الطلب', copy: 'نسخ', copied: 'تم النسخ', summary: 'ملخص الطلب', totals: ['المجموع الفرعي', 'التوصيل', 'الإجمالي المستحق عند الاستلام'], to: 'التوصيل إلى Salmiya, Hawalli', next: 'ماذا يحدث بعد ذلك',
    steps: ['ستصلك تحديثات التوصيل عبر واتساب.', 'يتصل بك المندوب قبل الوصول.', 'ادفع للمندوب نقدًا عند وصول طلبك.'],
    note: 'يفضّل تجهيز المبلغ بالضبط، فالمندوب قد لا يحمل فكة.', help: 'راسلنا على واتساب', waText: 'مرحبًا سبورتا، أحتاج مساعدة بخصوص طلبي', cur: 'د.ك' },
}
const HELP_T = { en: { help: 'Message us on WhatsApp', waText: 'Hello Sporta, I need help with my order' }, ar: { help: 'راسلنا على واتساب', waText: 'مرحبًا سبورتا، أحتاج مساعدة بخصوص طلبي' } }
const CART = [line('sgomma-t-shirt-navy', 'M', 'Sgomma T-Shirt - Navy', 'تيشيرت سغوما - كحلي', 5, 2), line('tekno-shorts-black', 'L', 'Tekno Shorts - Black', 'شورت تكنو - أسود', 3, 1)]
const LONG_CART = ['Cloudsoft Leggings Army Green', 'Cagliari Calcio Sweatshirt Navy Edition', 'Vanquish Stringer Vest White', 'Denver Nuggets Cap Navy', 'Sculpt Jacket Taupe Brown Long Name', 'Gymshark Phone Strap Limited']
  .map((n, i) => line(['cloudsoft-leggings-army-green', 'cagliari-calcio-sweatshirt-navy', 'vanquish-stringer-vest-white', 'denver-nuggets-cap-navy', 'sculpt-jacket-taupe-brown', 'gymshark-phone-strap'][i], 'M', n, n, 5 + i, 1))
const PHOTO = photoPng(400, 400)

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive(opts); try { return await fn(srv) } finally { await srv.close() } }

// ---------------------------------------------------------------------------------------------------------------- in the page
const SAMPLER = () => {
  // layout shift counted from the frame AFTER the compiled page first drew its result container: that first render is the compiled
  // page's own; what the card does comes later and is counted
  window.__ls = []; window.__t0 = Infinity
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push([e.startTime, e.value]) }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* no layout-shift entries */ }
  new MutationObserver((r, mo) => {
    if (!document.querySelector('.purchase-result')) return
    mo.disconnect()
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__t0 = performance.now() }))
  }).observe(document, { childList: true, subtree: true })
}
const CLIP_STUB = (mode) => {
  window.__copied = null; window.__legacy = null
  if (mode === 'api') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve() } } })
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } })
  document.execCommand = (cmd) => { const a = document.activeElement; window.__legacy = cmd === 'copy' && a && a.tagName === 'TEXTAREA' ? a.value.slice(a.selectionStart, a.selectionEnd) : null; return true }
}
const RESULT_FACTS = () => {
  const host = document.querySelector('.purchase-result'), card = document.querySelector('.sprc-cash'), box = document.querySelector('.sprc')
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const tx = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : null)
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width, h: r.height } }
  const hs = host ? getComputedStyle(host) : null
  const kids = host ? [...host.children].filter((n) => n !== card && n !== box) : []
  const q = (s) => (card ? card.querySelector(s) : null)
  const qa = (s) => (card ? [...card.querySelectorAll(s)] : [])
  const a = q('.sprc-cash__link'), copy = q('.sprc-cash__copy'), num = q('.sprc-cash__v'), cs = (e, p) => (e ? getComputedStyle(e, p || null) : null)
  const panel = q('.sprc-cash__panel'), step = q('.sprc-cash__steps > li'), live = q('.sprc-cash__live')
  return {
    hasHost: !!host, hasBox: !!box, hasCard: !!card, cardLast: !!card && host.lastElementChild === card, cardCount: document.querySelectorAll('.sprc-cash').length,
    marked: !!host && host.hasAttribute('data-sporta-cash'), rcptMarked: !!host && host.hasAttribute('data-sporta-rcpt'), minHeight: hs && hs.minHeight,
    kidsShown: kids.map(vis), kids: kids.length, h1: tx(host && host.querySelector('h1')),
    state: card && card.getAttribute('data-state'), label: card && card.getAttribute('aria-label'), display: cs(card) && cs(card).display, textAlign: cs(card) && cs(card).textAlign, cardW: R(card) && R(card).w,
    num: tx(num), numDir: num && num.getAttribute('dir'), numFs: num && parseFloat(cs(num).fontSize),
    copy: copy && { text: tx(copy), aria: copy.getAttribute('aria-label'), type: copy.getAttribute('type'), r: R(copy) },
    k: tx(q('.sprc-cash__k')), liveRole: live && live.getAttribute('role'), liveText: tx(live),
    panels: qa('.sprc-cash__panel > h2').map(tx), panelRadius: panel && cs(panel).borderRadius, panelBg: panel && cs(panel).backgroundColor,
    lines: qa('.sprc-cash__lines > li').map((li) => ({ name: tx(li.querySelector('.sprc-cash__name')), amt: tx(li.querySelector('.sprc-cash__amt')) })),
    totals: qa('.sprc-cash__row').map((r) => [tx(r.querySelector('dt')), tx(r.querySelector('dd'))]),
    to: tx(q('.sprc-cash__to')), steps: qa('.sprc-cash__steps > li').map(tx), note: tx(q('.sprc-cash__note')),
    // the figure is a CSS counter (reset on the list, +1 on each sentence): the computed content reads "counter(opc)"
    disc: step && { content: cs(step, '::before').content, bg: cs(step, '::before').backgroundColor, w: parseFloat(cs(step, '::before').width), reset: cs(q('.sprc-cash__steps')).counterReset, inc: cs(step).counterIncrement },
    // a link that wraps (an inline box) is as tall as ALL its lines in getBoundingClientRect: the finger meets one line box, so the smallest counts
    help: a && { text: tx(a), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), r: { ...R(a), h: Math.min(...[...a.getClientRects()].map((x) => x.height)) } },
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    gap: card && host ? Math.round(R(host).b - R(card).b - parseFloat(hs.paddingBottom)) : null,
    cls: (window.__ls || []).filter((e) => e[0] >= window.__t0).reduce((s, e) => s + e[1], 0),
    dir: document.documentElement.dir,
  }
}
const TRACK_FACTS = () => {
  const card = document.querySelector('.track-result'), ol = card && card.querySelector('.track-progress')
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  // computed colours come back as rgb(), lab() or oklch() (the build's palette is lab): the browser's own canvas turns any of them into sRGB
  const px = (c) => { const k = document.createElement('canvas'); k.width = k.height = 1; const g = k.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1, 1); g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]] }
  const lum = (c) => { const [r, g, b] = px(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const lis = ol ? [...ol.children].filter((n) => n.tagName === 'LI') : []
  const steps = lis.map((li) => {
    const kids = [...li.children], cs = (e) => getComputedStyle(e)
    const conn = kids.find((k) => k.getAttribute('aria-hidden') === 'true'), circle = kids.find((k) => k.classList.contains('rounded-full'))
    const label = kids.find((k) => k.classList.contains('truncate')), date = kids.find((k) => /text-\[0\.6rem\]/.test(k.className))
    return {
      li: R(li), conn: conn ? R(conn) : null, connOrange: conn ? /bg-brand/.test(conn.className) : null, reached: circle ? /bg-brand/.test(circle.className) : null,
      label: label && { text: label.textContent.trim(), over: label.scrollWidth - label.clientWidth, ellipsis: cs(label).textOverflow, ws: cs(label).whiteSpace, fs: parseFloat(cs(label).fontSize), color: cs(label).color },
      date: date && { fs: parseFloat(cs(date).fontSize), color: cs(date).color },
      circle: circle && { fs: parseFloat(cs(circle).fontSize), border: cs(circle).borderTopColor, color: cs(circle).color, bg: cs(circle).backgroundColor },
    }
  })
  const H = (e) => Math.min(...[...e.getClientRects()].map((x) => x.height))   // the smallest line box of a link that may wrap
  const links = card ? [...card.querySelectorAll(':scope > a')].map((a) => ({ href: a.getAttribute('href'), h: H(a) })) : []
  const help = card && card.querySelector(':scope > .sprc-help'), ha = help && help.querySelector('a')
  return {
    hasCard: !!card, steps, links, WHITE: 'rgb(255, 255, 255)', ratioOf: null,
    contrast: steps.map((s) => ({ label: s.label ? ratio(s.label.color, 'rgb(255, 255, 255)') : null, date: s.date ? ratio(s.date.color, 'rgb(255, 255, 255)') : null, ring: s.circle ? ratio(s.circle.border, 'rgb(255, 255, 255)') : null })),
    cardR: R(card), olR: R(ol), scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir,
    help: help && { last: card.lastElementChild === help, text: help.textContent.replace(/\s+/g, ' ').trim(), href: ha && ha.getAttribute('href'), target: ha && ha.getAttribute('target'), rel: ha && ha.getAttribute('rel'), h: ha && H(ha), bt: getComputedStyle(help).borderTopWidth, count: document.querySelectorAll('.sprc-help').length },
  }
}
const INVOICE_FACTS = () => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { h: r.height, w: r.width } }
  const home = document.querySelector('.invoice > .no-print > a'), print = document.querySelector('.invoice > .no-print > .btn')
  return { home: R(home), print: R(print), scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth }
}
const CHECKOUT_FACTS = () => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top + scrollY, b: r.bottom + scrollY, w: r.width, h: r.height } }
  // computed colours come back as rgb(), lab() or oklch() (the build's palette is lab): the browser's own canvas turns any of them into sRGB
  const px = (c) => { const k = document.createElement('canvas'); k.width = k.height = 1; const g = k.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1, 1); g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]] }
  const lum = (c) => { const [r, g, b] = px(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const panel = document.querySelector('.purchase-checkout-summary'), cs = (e, p) => (e ? getComputedStyle(e, p || null) : null)
  const bags = panel ? [...panel.querySelectorAll(':scope > .sporta-editbag')] : [], bag = bags[0]
  const trusts = panel ? [...panel.querySelectorAll(':scope > .sporta-trust')] : [], trust = trusts[0], tul = trust && trust.querySelector('ul')
  const list = panel ? [...panel.children].find((n) => n.tagName === 'UL') : null
  const fold = panel ? panel.querySelector('.sporta-fold--coupon') : null, box = fold ? fold.nextElementSibling : null
  const cta = panel ? panel.querySelector('.btn-primary') : null, badge = document.querySelector('.payment-method__badge')
  const li = tul && tul.querySelector('li'), liBefore = li && cs(li, '::before')
  const bg = panel ? cs(panel).backgroundColor : 'rgb(255, 255, 255)'
  return {
    hasPanel: !!panel, bags: bags.length, trusts: trusts.length, allBags: document.querySelectorAll('.sporta-editbag').length, allTrusts: document.querySelectorAll('.sporta-trust').length,
    bag: bag && { text: bag.textContent.trim(), href: bag.getAttribute('href'), r: R(bag), deco: cs(bag).textDecorationLine, fs: parseFloat(cs(bag).fontSize), afterList: bag.previousElementSibling === list },
    foldPrev: !!fold && !!box && box.previousElementSibling === fold, foldCount: panel ? panel.querySelectorAll('.sporta-fold--coupon').length : 0,
    trustLast: !!trust && panel.lastElementChild === trust, tul: tul && { label: tul.getAttribute('aria-label'), items: [...tul.children].map((n) => n.textContent.trim()), fs: parseFloat(cs(tul).fontSize), color: cs(tul).color, ratio: ratio(cs(tul).color, bg), tab: tul.getAttribute('tabindex'), ov: cs(tul).overflowY },
    li: li && { pad: cs(li).paddingTop + ' ' + cs(li).paddingBottom, dot: liBefore.backgroundColor, content: liBefore.content },
    listMax: list ? cs(list).maxHeight : null, listTab: list ? list.getAttribute('tabindex') : null,
    cta: cta && R(cta), ctaV: cta && { t: cta.getBoundingClientRect().top, b: cta.getBoundingClientRect().bottom }, scrolled: scrollY, vh: innerHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize), scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    badge: badge && parseFloat(cs(badge).fontSize), lang: document.documentElement.lang,
  }
}

// ---------------------------------------------------------------------------------------------------------------- the browser side
const SHOTS = { calls: null }
const open = async (srv, { path, lang = 'en', w = 390, h = 900, theme = 'light', cart = null, clip = null, cookie = false, waitFor = null, checkoutQuote = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.addInitScript(([l, t, c]) => { try { localStorage.setItem('lang', l); localStorage.setItem('sporta_theme', t); localStorage.setItem('sporta_theme_explicit', '1'); if (c) localStorage.setItem('sporta_cart', JSON.stringify(c)) } catch (e) { /* no storage */ } }, [lang, theme, cart])
  await ctx.addInitScript(SAMPLER)
  if (clip) await ctx.addInitScript(CLIP_STUB, clip)
  if (cookie) await ctx.addCookies([{ name: 'sporta_probe', value: '1', url: srv.base }])
  await ctx.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }))
  await ctx.route('**/api/api.php?r=discount*', (r) => {
    const body = JSON.parse(r.request().postData() || '{}'), code = String(body.code || '').toUpperCase(), items = cart || CART
    const sub = items.reduce((a, i) => a + i.price * i.qty, 0)
    if (code && code !== 'SAVE10') return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'discount_unknown' }) })
    const off = code ? Math.round(sub * 100) / 1000 : 0, total = Math.round((sub - off + 1) * 1000) / 1000
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subtotal: sub, delivery: 1, total, total_fils: Math.round(total * 1000), applied: code ? [{ label: 'SAVE10', amount: off }] : [] }) })
  })
  const p = await ctx.newPage(), errs = [], reqs = []
  p.setDefaultTimeout(12000)
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('request', (r) => { const u = r.url(); if (/api\.php\?r=(invoice|status)/.test(u)) reqs.push({ url: u, cookie: r.headers().cookie || '' }) })
  await p.goto(srv.base + path, { waitUntil: 'load' })
  if (waitFor) await p.waitForSelector(waitFor, { timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(900)
  return { ctx, p, errs, reqs }
}
// one flow = one browser page; it hands back what it measured even when a step cannot finish ("error" says which)
const flowOnce = (body, opts, o) => withServer(opts, async (srv) => {
  const f = { errs: [], reqs: [] }
  try { await Promise.race([body(srv, f, o), limit(90000, 'the flow')]) } catch (e) { f.error = String((e && e.message) || e).split('\n')[0] }
  if (f.t) { f.errs = f.t.errs; f.reqs = f.t.reqs; await closeQuietly(f.t.ctx); delete f.t }
  return f
})
const flow = (body) => async (opts, o = {}) => { const f = await flowOnce(body, opts, o); return f.error ? flowOnce(body, opts, o) : f }
const cache = new Map()
const real = (key, fn) => { if (!cache.has(key)) cache.set(key, fn({}, JSON.parse(key.slice(key.indexOf('|') + 1)))); return cache.get(key) }
const memo = (name, fl) => (o) => real(name + '|' + JSON.stringify(o), fl)

// ----- the result page
const resultFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, { path: o.path || `/payment/result?trackid=${TRACK}`, lang: o.lang, w: o.w, theme: o.theme, clip: o.clip, cookie: o.cookie }))
  const p = t.p
  await p.waitForSelector(o.expect || '.sprc-cash', { timeout: o.expect === 'none' ? 1 : 10000 }).catch(() => {})
  await p.waitForTimeout(o.settle ?? 900)
  f.facts = await p.evaluate(RESULT_FACTS)
  if (o.after) await o.after(p, f)
})
const resultApi = (o) => ({ status: o.status === 'knet' ? STATUS_KNET : STATUS_COD, invoice: o.invoice === 'fail' ? () => undefined : o.invoice === 'bad' ? { items: 'x' } : o.invoice === 'foreign' ? { ...INVOICE, track_id: 'SPT0000000001' } : o.invoice === 'empty' ? { ...INVOICE, items: [] } : o.invoice === 'discount' ? { ...INVOICE, discount_amount: 2, discount_label: 'SAVE10', delivery_fee: 0, amount: 10.5 } : INVOICE })
const runResult = (o, srvOpts = {}) => flowOnce(resultFlow.__body, { api: resultApi(o), ...srvOpts }, o)
resultFlow.__body = async (srv, f, o) => {
  const t = (f.t = await open(srv, { path: o.path || `/payment/result?trackid=${TRACK}`, lang: o.lang, w: o.w, theme: o.theme, clip: o.clip, cookie: o.cookie }))
  const p = t.p
  await p.waitForSelector(o.expect || '.sprc-cash', { timeout: o.expect === 'none' ? 1 : 10000 }).catch(() => {})
  await p.waitForTimeout(o.settle ?? 900)
  f.facts = await p.evaluate(RESULT_FACTS)
  if (o.after) await o.after(p, f)
}
const resultMut = async (o, srvOpts) => { const f = await runResult(o, srvOpts); return f.error ? runResult(o, srvOpts) : f }
// the same page opened twice is measured once; a run with its own steps (`after`: a function the key cannot hold) is never shared
const result = (o, srvOpts) => {
  if (o.after) return resultMut(o, srvOpts)
  const k = 'result|' + JSON.stringify([o, Object.keys(srvOpts || {})])
  if (!cache.has(k)) cache.set(k, resultMut(o, srvOpts))
  return cache.get(k)
}

const COD = {
  card: (f) => f.hasCard && f.cardLast && f.state === 'ready' && f.cardCount === 1 && !!f.label,
  untouched: (f, l) => f.kids === 5 && f.kidsShown.every(Boolean) && f.h1 === COD_WORDS[l] && !f.hasBox && !f.rcptMarked,
  number: (f) => f.num === TRACK && f.numDir === 'ltr' && f.numFs >= 16,
  copy: (f, l) => !!f.copy && f.copy.type === 'button' && f.copy.r.h >= 43.5 && f.copy.r.w >= 43.5 && f.copy.text === CASH_T[l].copy && !!f.copy.aria && f.liveRole === 'status' && f.k === CASH_T[l].k,
  summary: (f, l) => {
    const t = CASH_T[l], name = (n, sz, q) => (l === 'ar' ? n.ar : n.en) + ` (${sz}) × ${q}`
    const has = (s, v) => s && s.includes(v) && s.includes(t.cur)
    return f.panels[0] === t.summary && f.lines.length === 2
      && f.lines[0].name === name({ en: 'Sgomma T-Shirt - Navy', ar: 'تيشيرت سغوما - كحلي' }, 'M', 2) && has(f.lines[0].amt, '10.000')
      && f.lines[1].name === name({ en: 'Tekno Shorts - Black', ar: 'شورت تكنو - أسود' }, 'L', 1) && has(f.lines[1].amt, '2.500')
      && f.totals.length === 3 && f.totals.every((r, i) => r[0] === t.totals[i]) && has(f.totals[0][1], '12.500') && has(f.totals[1][1], '1.000') && has(f.totals[2][1], '13.500') && f.to === t.to
  },
  next: (f, l) => f.panels[1] === CASH_T[l].next && JSON.stringify(f.steps) === JSON.stringify(CASH_T[l].steps) && f.note === CASH_T[l].note,
  help: (f, l) => !!f.help && f.help.href === `${WA}?text=${encodeURIComponent(CASH_T[l].waText + ' ' + TRACK)}` && f.help.target === '_blank' && f.help.rel === 'noopener' && f.help.text === CASH_T[l].help && f.help.r.h >= 43.5,
  steps: (f) => !!f.disc && f.steps.length === 3 && f.disc.content === 'counter(opc)' && f.disc.reset === 'opc 0' && f.disc.inc === 'opc 1' && f.disc.bg === 'rgb(255, 123, 23)' && f.disc.w >= 23,
  layout: (f) => f.display === 'grid' && f.textAlign === 'start' && f.panelRadius === '12px',
  lifted: (f) => f.marked && f.minHeight === '0px',
  quiet: (f, errs) => f.scrollX <= 0 && errs.length === 0,
}

head('the confirmation of a cash order: the compiled page and ONE card under it (real compiled storefront)')
const VIEWS = [['en', 390], ['ar', 390], ['en', 768], ['ar', 1280], ['en', 1280]]
for (const [lang, w] of VIEWS) {
  const tag = `${lang} ${w}px`, f = await result({ lang, w })
  const x = f.facts
  if (f.error) note(`${tag}: the flow stopped - ${f.error}`)
  is(holds(COD.card, x), `${tag}: ONE card (section.sprc-cash, labelled) is the LAST child of the compiled container`, JSON.stringify([x.hasCard, x.cardLast, x.state, x.cardCount]))
  is(holds(COD.untouched, x, lang), `${tag}: the compiled page is as it was: its five children all shown, "${COD_WORDS[lang]}", no receipt box, no receipt mark`, JSON.stringify([x.kids, x.kidsShown, x.h1, x.hasBox, x.rcptMarked]))
  is(holds(COD.number, x), `${tag}: the order number is ${TRACK}, left to right, ${x.numFs}px`, JSON.stringify([x.num, x.numDir, x.numFs]))
  is(holds(COD.copy, x, lang), `${tag}: the Copy button is a 44px button named "${CASH_T[lang].copy}" with an accessible name and a polite live region`, JSON.stringify(x.copy))
  is(holds(COD.summary, x, lang), `${tag}: the summary: two lines with size and quantity, subtotal 12.500, delivery 1.000, total due 13.500, "${CASH_T[lang].to}"`, JSON.stringify([x.panels, x.lines, x.totals, x.to]))
  is(holds(COD.next, x, lang), `${tag}: "What happens next": the three sentences and the change note, in ${lang === 'ar' ? 'Arabic' : 'English'}`, JSON.stringify([x.panels, x.steps, x.note]))
  is(holds(COD.help, x, lang), `${tag}: the help link is the footer's WhatsApp with the order number in the message, 44px`, JSON.stringify(x.help))
  is(holds(COD.steps, x), `${tag}: each sentence has an orange disc with its figure`, JSON.stringify(x.disc))
  is(holds(COD.layout, x), `${tag}: the card is a start-aligned grid of 12px boxes`, JSON.stringify([x.display, x.textAlign, x.panelRadius]))
  is(holds(COD.lifted, x), `${tag}: the container is marked data-sporta-cash and RECEIPT-1112's reservation is lifted (min-height ${x.minHeight})`, JSON.stringify([x.marked, x.minHeight]))
  is(holds(COD.quiet, x, f.errs), `${tag}: no sideways scroll, no page error`, `${x.scrollX}px ${f.errs.join(' | ')}`)
  is(x.cls < 0.1, `${tag}: the card's arrival shifts the layout by less than 0.1 (${x.cls.toFixed(3)})`, String(x.cls))
  is(x.gap !== null && x.gap <= 8, `${tag}: no empty white under the card (${x.gap}px between its end and the container's padding; the receipt's reservation left ~430px)`, String(x.gap))
}
{
  const f = await result({ lang: 'en', w: 390, theme: 'dark' }), x = f.facts
  is(holds(COD.card, x) && x.panelBg === 'rgb(30, 31, 35)', 'en 390px dark: the card is there and its panels are the dark surface (#1E1F23)', JSON.stringify([x.hasCard, x.panelBg]))
}
head('the card without its summary, and what it refuses')
for (const [name, inv] of [['the invoice call fails (404)', 'fail'], ['the invoice answer is malformed', 'bad'], ['the invoice answer is another order\'s', 'foreign'], ['the order has no line rows (an order from before they were kept)', 'empty']]) {
  const f = await result({ lang: 'en', w: 390, invoice: inv }), x = f.facts
  is(holds(COD.card, { ...x, state: 'ready' }) && x.state === 'plain' && x.panels.length === 1 && x.panels[0] === CASH_T.en.next && x.lines.length === 0 && holds(COD.help, x, 'en') && holds(COD.lifted, x), `${name}: the card still comes, without the summary: number, what happens next, help (data-state ${x.state})`, JSON.stringify([x.state, x.panels, x.lines.length]))
}
{
  const f = await result({ lang: 'en', w: 390, invoice: 'discount' }), x = f.facts
  is(x.totals.length === 4 && /^Discount \(SAVE10\)$/.test(x.totals[1][0]) && /^−/.test(x.totals[1][1]) && x.totals[2][1] === 'Free' && /10\.500/.test(x.totals[3][1]), 'a discount shows as "Discount (SAVE10) − KWD 2.000", a free delivery as "Free", the total as the order row has it', JSON.stringify(x.totals))
}
{
  const f = await result({ lang: 'en', w: 390, status: 'knet', path: `/payment/result?status=success&trackid=${TRACK}&k=1893456000.0123456789abcdef0123456789abcdef`, expect: '.sprc' }), x = f.facts
  is(x.hasBox && !x.hasCard && !x.marked && x.rcptMarked && x.minHeight !== '0px', 'a KNET order keeps its receipt box, its reservation and its mark: no cash card, no cash mark', JSON.stringify([x.hasBox, x.hasCard, x.marked, x.rcptMarked, x.minHeight]))
}
{
  const f = await result({ lang: 'en', w: 390, path: '/payment/result', expect: 'none', settle: 700 }), x = f.facts
  is(x.hasHost && !x.hasCard && !x.hasBox && f.errs.length === 0, 'no order number in the address: the page is left alone (no card, no box)', JSON.stringify([x.hasHost, x.hasCard, x.hasBox, f.errs]))
}
{
  const f = await result({ lang: 'en', w: 390, cookie: true }), invoiceCalls = f.reqs.filter((r) => /r=invoice/.test(r.url))
  is(invoiceCalls.length === 1 && invoiceCalls[0].cookie === '', 'the public invoice is asked ONCE and WITHOUT cookies (the limited invoice, like the invoice page)', JSON.stringify(invoiceCalls.map((r) => [r.url.slice(-30), r.cookie])))
}

head('the Copy button, the language switch, a node added after the card, no footer link')
{
  const f = await result({ lang: 'en', w: 390, clip: 'api', after: async (p, f) => {
    await p.locator('.sprc-cash__copy').click()
    await p.waitForFunction(() => document.querySelector('.sprc-cash__copy').textContent === 'Copied', null, { timeout: 4000 }).catch(() => {})
    f.afterClick = await p.evaluate(() => ({ copied: window.__copied, text: document.querySelector('.sprc-cash__copy').textContent, live: document.querySelector('.sprc-cash__live').textContent }))
    await p.waitForTimeout(2800)
    f.afterWait = await p.evaluate(() => ({ text: document.querySelector('.sprc-cash__copy').textContent, live: document.querySelector('.sprc-cash__live').textContent }))
  } })
  const a = f.afterClick, b = f.afterWait
  is(!!a && a.copied === TRACK && a.text === 'Copied' && a.live === 'Copied', 'Copy: the Clipboard API gets the clean order number, the button and the live region say "Copied"', JSON.stringify(a))
  is(!!b && b.text === 'Copy' && b.live === '', '... and both go back to "Copy" and silence after a moment', JSON.stringify(b))
}
{
  const f = await result({ lang: 'en', w: 390, clip: 'legacy', after: async (p, f) => {
    await p.locator('.sprc-cash__copy').click(); await p.waitForTimeout(500)
    f.afterClick = await p.evaluate(() => ({ legacy: window.__legacy, text: document.querySelector('.sprc-cash__copy').textContent, left: document.querySelectorAll('textarea').length }))
  } })
  is(!!f.afterClick && f.afterClick.legacy === TRACK && f.afterClick.text === 'Copied' && f.afterClick.left === 0, 'Copy without the Clipboard API: the hidden-textarea fallback selects and copies the order number and leaves nothing behind', JSON.stringify(f.afterClick))
}
{
  const f = await result({ lang: 'en', w: 1280, after: async (p, f) => {
    await p.locator('.app-header .navbar-language').first().click()
    await p.waitForFunction(() => document.documentElement.lang === 'ar' && document.querySelector('.sprc-cash__k') && document.querySelector('.sprc-cash__k').textContent === 'رقم الطلب', null, { timeout: 6000 }).catch(() => {})
    await p.waitForTimeout(500)
    f.switched = await p.evaluate(RESULT_FACTS)
  } })
  const x = f.switched, invoiceCalls = f.reqs.filter((r) => /r=invoice/.test(r.url)).length
  is(!!x && holds(COD.card, x) && holds(COD.summary, x, 'ar') && holds(COD.next, x, 'ar') && holds(COD.help, x, 'ar') && invoiceCalls === 1, 'a language switch (React re-renders the page): the card comes back in Arabic, whole, with no second invoice call', JSON.stringify([x && x.k, invoiceCalls, x && x.cardCount]))
}
{
  const f = await result({ lang: 'en', w: 390, after: async (p, f) => {
    await p.evaluate(() => { const h = document.querySelector('.purchase-result'); const d = document.createElement('div'); d.id = 'late'; d.textContent = 'late'; h.appendChild(d) })
    await p.waitForTimeout(500)
    f.late = await p.evaluate(() => { const h = document.querySelector('.purchase-result'); return { last: h.lastElementChild.className, cards: document.querySelectorAll('.sprc-cash').length, lateExists: !!document.getElementById('late') } })
  } })
  is(!!f.late && f.late.last === 'sprc-cash' && f.late.cards === 1 && f.late.lateExists, 'a node added to the container after the card does not leave the card above the end: it is the last child again, still one card', JSON.stringify(f.late))
}
{
  const f = await result({ lang: 'en', w: 390, after: async (p, f) => {
    await p.evaluate(() => { for (const a of document.querySelectorAll('footer a[href^="https://wa.me/"]')) a.setAttribute('href', 'https://example.com/x'); const d = document.createElement('i'); document.body.appendChild(d); d.remove() })
    await p.waitForTimeout(600)
    f.nofooter = await p.evaluate(RESULT_FACTS)
  } })
  const x = f.nofooter
  is(!!x && !!x.help && x.help.href === '/contact' && x.help.text === 'Contact us' && x.help.target === null, 'without a WhatsApp link in the footer the help link goes to /contact (nothing is typed in the script)', JSON.stringify(x && x.help))
}

// ----- the track page
const trackFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, { path: `/track?trackid=${TRACK}`, lang: o.lang, w: o.w, theme: o.theme, waitFor: '.track-result' }))
  const p = t.p
  await p.waitForSelector('.sprc-help', { timeout: 6000 }).catch(() => {})
  f.facts = await p.evaluate(TRACK_FACTS)
  if (o.search) {
    await p.fill('.tracking-panel input', 'SPT2611190099'); await p.click('.tracking-panel button')
    await p.waitForFunction(() => { const a = document.querySelector('.sprc-help a'); return a && /0099/.test(decodeURIComponent(a.getAttribute('href'))) }, null, { timeout: 8000 }).catch(() => {})
    f.again = await p.evaluate(TRACK_FACTS)
  }
})
const track = (o) => { const k = 'track|' + JSON.stringify(o); if (!cache.has(k)) cache.set(k, (async () => { const a = { api: { status: STATUS_COD, invoice: INVOICE } }; const f = await flowOnce(trackFlow.__body, a, o); return f.error ? flowOnce(trackFlow.__body, a, o) : f })()); return cache.get(k) }
trackFlow.__body = async (srv, f, o) => {
  const t = (f.t = await open(srv, { path: `/track?trackid=${TRACK}`, lang: o.lang, w: o.w, theme: o.theme, waitFor: '.track-result' }))
  const p = t.p
  await p.waitForSelector('.sprc-help', { timeout: 6000 }).catch(() => {})
  f.facts = await p.evaluate(TRACK_FACTS)
  if (o.search) {
    await p.fill('.tracking-panel input', 'SPT2611190099'); await p.click('.tracking-panel button')
    await p.waitForFunction(() => { const a = document.querySelector('.sprc-help a'); return a && /0099/.test(decodeURIComponent(a.getAttribute('href'))) }, null, { timeout: 8000 }).catch(() => {})
    f.again = await p.evaluate(TRACK_FACTS)
  }
}
const trackMut = async (o, srvOpts) => { const a = { api: { status: STATUS_COD, invoice: INVOICE }, ...srvOpts }; const f = await flowOnce(trackFlow.__body, a, o); return f.error ? flowOnce(trackFlow.__body, a, o) : f }
const TR = {
  labels: (x) => x.steps.length === 4 && x.steps.every((s) => s.label && s.label.over <= 1 && s.label.ellipsis === 'clip' && s.label.ws === 'normal'),
  sizes: (x) => x.steps.every((s) => s.label.fs >= 11.99 && s.circle.fs >= 11.99) && x.steps.filter((s) => s.date).length === 2 && x.steps.filter((s) => s.date).every((s) => s.date.fs >= 11.99),
  contrast: (x) => x.contrast.every((c) => (c.label === null || c.label >= 4.5) && (c.date === null || c.date >= 4.5)) && x.steps.every((s, i) => s.reached || x.contrast[i].ring >= 3),
  // the connector of step N spans from the centre of step N-1 to the centre of step N (the build makes it as wide as the step, so on the
  // step's own side it ends a gap short, 4px, under the circle): each end within 6px of its centre, inside the card, orange only
  // when both steps it joins are reached
  connectors: (x) => {
    const c = (s) => (s.l + s.r) / 2
    return x.steps.length === 4 && x.steps.slice(1).every((s, i) => {
      const prev = x.steps[i], a = c(prev.li), b = c(s.li), left = Math.min(a, b), right = Math.max(a, b)
      const reachedBoth = prev.reached && s.reached
      return s.conn && Math.abs(s.conn.l - left) <= 6 && Math.abs(s.conn.r - right) <= 6 && s.connOrange === !!s.reached && (!s.connOrange || reachedBoth) && s.conn.l >= x.cardR.l && s.conn.r <= x.cardR.r
    })
  },
  quiet: (x, errs) => x.scrollX <= 0 && errs.length === 0,
  links: (x) => x.links.length === 2 && x.links.every((l) => l.h >= 43.5),
  help: (x, l) => !!x.help && x.help.last && x.help.count === 1 && x.help.href === `${WA}?text=${encodeURIComponent(HELP_T[l].waText + ' ' + TRACK)}` && x.help.target === '_blank' && x.help.rel === 'noopener' && x.help.text === `${l === 'ar' ? 'عندك سؤال عن هذا الطلب؟' : 'Questions about this order?'} ${HELP_T[l].help}` && x.help.h >= 43.5,
  helpLine: (x) => !!x.help && x.help.bt === '1px',
}
head('the tracking page: legible steps, connectors the right way round, links, help (real compiled storefront)')
for (const [lang, w] of [['en', 390], ['ar', 390], ['en', 1280], ['ar', 1280], ['ar', 320], ['en', 768]]) {
  const tag = `${lang} ${w}px`, f = await track({ lang, w }), x = f.facts
  if (f.error) note(`${tag}: the flow stopped - ${f.error}`)
  is(holds(TR.labels, x), `${tag}: the four step labels wrap (no ellipsis, nothing cut: ${x && x.steps.map((s) => s.label && s.label.over).join('/')}px over)`, JSON.stringify(x && x.steps.map((s) => s.label)))
  is(holds(TR.sizes, x), `${tag}: labels, figures and dates are 12px or more`, JSON.stringify(x && x.steps.map((s) => [s.label && s.label.fs, s.circle && s.circle.fs, s.date && s.date.fs])))
  is(holds(TR.contrast, x), `${tag}: steps still to come read 4.5:1 (rings 3:1): ${x && x.contrast.map((c) => (c.label || c.date || 0).toFixed(1)).join(' / ')}`, JSON.stringify(x && x.contrast))
  is(holds(TR.connectors, x), `${tag}: each connector joins the two steps it belongs to and is orange only between reached steps${x && x.dir === 'rtl' ? ' (right to left)' : ''}`, JSON.stringify(x && x.steps.map((s) => s.conn && [Math.round(s.conn.l), Math.round(s.conn.r), s.connOrange])))
  is(holds(TR.quiet, x, f.errs), `${tag}: no sideways scroll (${x && x.scrollX}px), no page error`, `${x && x.scrollX}px ${f.errs.join(' | ')}`)
  is(holds(TR.links, x), `${tag}: "View invoice" and "Request return or exchange" are 44px`, JSON.stringify(x && x.links))
  is(holds(TR.help, x, lang), `${tag}: the help line is the card's last child, a WhatsApp link with the order number in the message, 44px`, JSON.stringify(x && x.help))
  is(holds(TR.helpLine, x), `${tag}: the help line is set off by a rule`, JSON.stringify(x && x.help && x.help.bt))
}
{
  const f = await track({ lang: 'en', w: 390, search: true }), x = f.again
  is(!!x && x.help && x.help.count === 1 && x.help.last && /0099$/.test(decodeURIComponent(x.help.href)), 'a new search (React replaces the card): the help line comes back, once, with the NEW order number in its message', JSON.stringify(x && x.help))
}
{
  const f = await track({ lang: 'ar', w: 390, theme: 'dark' }), x = f.facts
  is(holds(TR.labels, x) && holds(TR.connectors, x) && x.help && x.help.last, 'ar 390px dark: labels, connectors and the help line are the same on the dark theme', JSON.stringify(x && x.help))
}

// ----- the invoice page
head('the invoice page: its two controls are 44px (real compiled storefront)')
const invoicePage = async (o, srvOpts = {}) => flowOnce(async (srv, f) => {
  const t = (f.t = await open(srv, { path: `/invoice/${TRACK}`, lang: o.lang, w: o.w, waitFor: '.invoice > .no-print' }))
  f.facts = await t.p.evaluate(INVOICE_FACTS)
}, { api: { invoice: INVOICE }, ...srvOpts }, o)
const INV = { ok: (x) => !!x.home && !!x.print && x.home.h >= 43.5 && x.print.h >= 43.5 && x.scrollX <= 0 }
for (const [lang, w] of [['en', 390], ['ar', 390], ['en', 1280], ['ar', 1280]]) {
  const f = await invoicePage({ lang, w }), x = f.facts
  is(holds(INV.ok, x), `${lang} ${w}px: Home is ${x && Math.round(x.home.h)}px and Print / Save as PDF ${x && Math.round(x.print.h)}px tall, no sideways scroll`, JSON.stringify(x))
}

// ----- the checkout
head('the checkout summary: Edit bag, the reassurance list, the CASH badge (real compiled storefront)')
const checkoutPage = (o, srvOpts = {}) => flowOnce(async (srv, f, o) => {
  const t = (f.t = await open(srv, { path: '/checkout', lang: o.lang, w: o.w, h: o.h || 900, theme: o.theme, cart: o.cart || CART, waitFor: o.waitFor || '.sporta-trust' }))
  const p = t.p
  f.facts = await p.evaluate(CHECKOUT_FACTS)
  if (o.after) await o.after(p, f)
}, srvOpts, o)
const checkoutCached = (o) => { const k = 'checkout|' + JSON.stringify(o); if (!cache.has(k)) cache.set(k, (async () => { const f = await checkoutPage(o); return f.error ? checkoutPage(o) : f })()); return cache.get(k) }
const CK = {
  bag: (x, l) => x.hasPanel && x.bags === 1 && x.allBags === 1 && !!x.bag && x.bag.text === (l === 'ar' ? 'تعديل الحقيبة' : 'Edit bag') && x.bag.href === '/cart' && x.bag.r.h >= 43.5 && x.bag.afterList && x.bag.deco === 'underline' && x.bag.fs >= 13.9,
  fold: (x) => x.foldPrev && x.foldCount === 1,
  trust: (x, l) => x.trusts === 1 && x.allTrusts === 1 && x.trustLast && !!x.tul && JSON.stringify(x.tul.items) === JSON.stringify(l === 'ar' ? ['يصلك خلال ٢٤ ساعة برسوم ١ د.ك', 'طلب إرجاع خلال ١٤ يومًا'] : ['Arrives within 24 hours for a 1 KWD fee', '14-day return requests']) && x.tul.label === (l === 'ar' ? 'معلومات مفيدة' : 'Good to know')
    && !/Delivery|التوصيل/.test(x.tul.items.join(' ') + ' ' + x.tul.label),
  trustLook: (x) => !!x.tul && x.tul.fs >= 12.9 && x.tul.ratio >= 4.5 && x.tul.tab === null && !!x.li && x.li.pad === '0px 0px' && x.li.dot === 'rgb(255, 123, 23)' && x.li.content === '""',
  badge: (x) => x.badge === null || x.badge >= 11.99,
  quiet: (x, errs) => x.scrollX <= 0 && errs.length === 0,
  // [oc-4]: from 1024px the bag list is at most 100vh - 38rem (never under 7rem); the page's root font size follows the viewport, so
  // the expected figure is worked out from the measured rem
  budget: (x) => !!x && x.listMax !== null && Math.abs(parseFloat(x.listMax) - Math.max(7 * x.rem, x.vh - 38 * x.rem)) < 1,
}
for (const [lang, w] of [['en', 390], ['ar', 390], ['en', 1280], ['ar', 1280]]) {
  const tag = `${lang} ${w}px`, f = await checkoutCached({ lang, w }), x = f.facts
  if (f.error) note(`${tag}: the flow stopped - ${f.error}`)
  is(holds(CK.bag, x, lang), `${tag}: ONE "${lang === 'ar' ? 'تعديل الحقيبة' : 'Edit bag'}" link to /cart, 44px, underlined, right after the bag list`, JSON.stringify(x && x.bag))
  is(holds(CK.fold, x), `${tag}: the discount link is still the previous sibling of the box it folds (one link, U1's contract)`, JSON.stringify(x && [x.foldPrev, x.foldCount]))
  is(holds(CK.trust, x, lang), `${tag}: the reassurance list is the summary's LAST child, two sentences, one copy`, JSON.stringify(x && [x.trusts, x.allTrusts, x.trustLast, x.tul]))
  is(holds(CK.trustLook, x), `${tag}: the list reads 13px at ${x && x.tul && x.tul.ratio.toFixed(1)}:1, is no scroll stop, its rows carry no padding and an orange dot`, JSON.stringify(x && [x.tul, x.li]))
  is(holds(CK.badge, x), `${tag}: the CASH badge is 12px or more (${x && x.badge})`, String(x && x.badge))
  is(holds(CK.quiet, x, f.errs), `${tag}: no sideways scroll, no page error`, `${x && x.scrollX}px ${f.errs.join(' | ')}`)
}
{
  const f = await checkoutCached({ lang: 'en', w: 390, theme: 'dark' }), x = f.facts
  is(holds(CK.bag, x, 'en') && holds(CK.trust, x, 'en') && x.tul.ratio >= 4.5, `en 390px dark: both nodes are there and the list reads ${x && x.tul && x.tul.ratio.toFixed(1)}:1 on the dark surface`, JSON.stringify(x && x.tul))
}
{
  const f = await checkoutPage({ lang: 'en', w: 1280, after: async (p, f) => {
    await p.locator('.sporta-fold--coupon').click()
    await p.locator('.purchase-checkout-summary input.font-mono').fill('save10')
    await p.locator('.purchase-checkout-summary input.font-mono + button').click()
    await p.waitForFunction(() => /SAVE10/i.test(document.querySelector('.purchase-checkout-summary').textContent) && /11\.700/.test(document.querySelector('.purchase-total').textContent), null, { timeout: 8000 }).catch(() => {})
    await p.waitForTimeout(500)
    f.afterQuote = await p.evaluate(CHECKOUT_FACTS)
    await p.locator('.app-header .navbar-language').first().click()
    await p.waitForFunction(() => document.documentElement.lang === 'ar', null, { timeout: 6000 }).catch(() => {})
    await p.waitForTimeout(600)
    f.afterLang = await p.evaluate(CHECKOUT_FACTS)
  } })
  const q = f.afterQuote, a = f.afterLang
  is(!!q && holds(CK.bag, q, 'en') && holds(CK.trust, q, 'en') && q.foldCount <= 1, 'a discount code applied (React re-renders the summary with a new total): still ONE Edit bag and ONE reassurance list, the list still last', JSON.stringify(q && [q.bags, q.trusts, q.allBags, q.allTrusts, q.trustLast]))
  is(!!a && holds(CK.bag, a, 'ar') && holds(CK.trust, a, 'ar'), 'a language switch: both nodes are in Arabic, still one each', JSON.stringify(a && [a.bag && a.bag.text, a.tul && a.tul.items[0]]))
}
// the list says only what holds for EVERY payment method: with card payment switched on beside cash (the shop's answer lists both, the
// add-on's own method choice draws two radios) it still reads delivery and returns, and never promises "Pay the driver ..."
{
  const f = await checkoutPage({ lang: 'en', w: 390 }, { api: { checkout_config: { delivery_fee: 1, methods: ['knet', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' } } }), x = f.facts
  is(!!x && holds(CK.bag, x, 'en') && holds(CK.trust, x, 'en') && !/driver|cash/i.test((x.tul && x.tul.items.join(' ')) || ''), 'card payment on beside cash (KNET chosen): the reassurance list is the same two sentences, nothing about paying the driver', JSON.stringify(x && x.tul && x.tul.items))
}
{
  const f = await checkoutPage({ lang: 'en', w: 1280, h: 800, cart: LONG_CART, after: async (p, f) => {
    await p.evaluate(() => window.scrollTo(0, 420)); await p.waitForTimeout(500)
    f.stuck = await p.evaluate(CHECKOUT_FACTS)
  } })
  const x = f.stuck
  is(!!x && !!x.ctaV && x.scrolled > 0 && x.ctaV.b <= x.vh && x.ctaV.t >= 0 && CK.budget(x), `from 1024px the bag list keeps "Continue to payment" on an 800px-tall screen with six long lines (the list is ${x && x.listMax} at most; scrolled ${x && Math.round(x.scrolled)}px the button ends ${x && x.ctaV && Math.round(x.ctaV.b)}px down a ${x && x.vh}px screen)`, JSON.stringify(x && [x.ctaV, x.scrolled, x.vh, x.rem, x.listMax]))
}

// ---------------------------------------------------------------------------------------------------------------- mutants
head('mutants: with one rule cut or one piece of script broken, the matching check fails')
const cutBlock = (css, id) => {
  const a = css.indexOf(`/* [${id}]`)
  if (a < 0) return null
  const ends = [css.indexOf('\n/* [', a + 4), css.indexOf('\n/* ==== end ORDER PAGES 1120', a)].filter((x) => x > 0)
  return css.slice(0, a) + css.slice(Math.min(...ends) + 1)
}
const cutCss = (file, id) => { const cut = cutBlock(SRC[file], id); return cut === null ? { missing: id } : { css: { [F[file]]: cut } } }
const swapJs = (file, from, to) => (SRC[file].includes(from) ? { js: { [F[file]]: SRC[file].replace(from, to) } } : { missing: from.slice(0, 50) })
const COD_BASE = { lang: 'en', w: 390 }
const MUTS = [
  // [label, how a file is cut, the page it is measured on, the check]
  ['op-cash-1 (the reservation is lifted)', cutCss('shadows', 'op-cash-1'), 'cod', COD_BASE, (f) => COD.lifted(f.facts)],
  ['op-cash-2 (the card layout)', cutCss('shadows', 'op-cash-2'), 'cod', COD_BASE, (f) => COD.layout(f.facts)],
  ['op-cash-3 (the number row and Copy)', cutCss('shadows', 'op-cash-3'), 'cod', COD_BASE, (f) => COD.copy(f.facts, 'en') && COD.number(f.facts)],
  ['op-cash-4 (the panels)', cutCss('shadows', 'op-cash-4'), 'cod', COD_BASE, (f) => COD.layout(f.facts)],
  ['op-cash-5 (the orange discs)', cutCss('shadows', 'op-cash-5'), 'cod', COD_BASE, (f) => COD.steps(f.facts)],
  ['op-cash-6 (the 44px help link)', cutCss('shadows', 'op-cash-6'), 'cod', COD_BASE, (f) => COD.help(f.facts, 'en')],
  ['op-cash-7 (the dark theme)', cutCss('shadows', 'op-cash-7'), 'cod', { lang: 'en', w: 390, theme: 'dark' }, (f) => f.facts.panelBg === 'rgb(30, 31, 35)'],
  ['op-links-1 (the 44px links of the confirmation)', cutCss('shadows', 'op-links-1'), 'codlinks', COD_BASE, (f) => f.link >= 43.5],
  ['op-track-1 (wrapping labels, 12px)', cutCss('shadows', 'op-track-1'), 'track', { lang: 'en', w: 390 }, (f) => TR.labels(f.facts) && TR.sizes(f.facts)],
  ['op-track-2 (readable future steps)', cutCss('shadows', 'op-track-2'), 'track', { lang: 'en', w: 390 }, (f) => TR.contrast(f.facts)],
  ['op-track-3 (right-to-left connectors)', cutCss('shadows', 'op-track-3'), 'track', { lang: 'ar', w: 390 }, (f) => TR.connectors(f.facts) && TR.quiet(f.facts, f.errs)],
  ['op-track-4 (the help line)', cutCss('shadows', 'op-track-4'), 'track', { lang: 'en', w: 390 }, (f) => TR.helpLine(f.facts) && TR.help(f.facts, 'en')],
  ['op-links-1 (the 44px links of /track)', cutCss('shadows', 'op-links-1'), 'track', { lang: 'en', w: 390 }, (f) => TR.links(f.facts)],
  ['op-inv-1 (the invoice controls)', cutCss('shadows', 'op-inv-1'), 'invoice', { lang: 'en', w: 1280 }, (f) => INV.ok(f.facts)],
  ['oc-1 (the CASH badge)', cutCss('checkoutCss', 'oc-1'), 'checkout', { lang: 'en', w: 390 }, (f) => CK.badge(f.facts)],
  ['oc-2 (the Edit bag link)', cutCss('checkoutCss', 'oc-2'), 'checkout', { lang: 'en', w: 390 }, (f) => CK.bag(f.facts, 'en')],
  ['oc-3 (the reassurance list)', cutCss('checkoutCss', 'oc-3'), 'checkout', { lang: 'en', w: 390 }, (f) => CK.trustLook(f.facts)],
  ['oc-4 (the list budget)', cutCss('checkoutCss', 'oc-4'), 'ckstuck', { lang: 'en', w: 1280, h: 800, cart: LONG_CART }, (f) => CK.budget(f.facts)],
  ['script: no card for a cash order', swapJs('features', 'cashCheck(host)   // a cash order:', 'void 0   // a cash order:'), 'cod', COD_BASE, (f) => COD.card(f.facts)],
  ['script: the container is never marked', swapJs('features', "if (!host.hasAttribute(CMARK)) host.setAttribute(CMARK, '')", 'void 0'), 'cod', COD_BASE, (f) => COD.lifted(f.facts)],
  ['script: the invoice is asked with cookies', swapJs('features', "credentials: 'omit', cache: 'no-store'", "credentials: 'same-origin', cache: 'no-store'"), 'codcookie', COD_BASE, (f) => f.reqs.filter((r) => /r=invoice/.test(r.url)).every((r) => r.cookie === '')],
  ['script: another order\'s invoice is accepted', swapJs('features', "String(d.track_id || '').toUpperCase() !== C.track.toUpperCase() ||", ''), 'codforeign', COD_BASE, (f) => f.facts.state === 'plain' && f.facts.lines.length === 0],
  ['script: the card is not kept last', swapJs('features', 'else if (host.lastElementChild !== mine) host.appendChild(mine)', ''), 'codlate', COD_BASE, (f) => f.late && f.late.last === 'sprc-cash'],
  ['script: the order number is not copied', swapJs('features', 'copyText(C.track, function (ok) {', 'copyText("x", function (ok) {'), 'codcopy', COD_BASE, (f) => f.afterClick && f.afterClick.copied === TRACK],
  ['script: a KNET order is taken for a cash one', swapJs('features', "if (d.payment_method === 'cod') return 'cod'", "if (d.payment_method === 'cod' || d.payment_method === 'knet') return 'cod'"), 'knet', { lang: 'en', w: 390 }, (f) => f.facts.hasBox && !f.facts.hasCard && !f.facts.marked],
  ['script: the track help is never placed', swapJs('features', "var card = /^\\/track\\/?$/.test(location.pathname) ?", "var card = /^\\/never\\/?$/.test(location.pathname) ?"), 'track', { lang: 'en', w: 390 }, (f) => TR.help(f.facts, 'en')],
  ['script: no Edit bag link', swapJs('checkoutJs', '      bag(panel, w)\n', ''), 'checkout', { lang: 'en', w: 390 }, (f) => CK.bag(f.facts, 'en')],
  ['script: no reassurance list', swapJs('checkoutJs', '      trust(panel, w)\n', ''), 'checkout', { lang: 'en', w: 390 }, (f) => CK.trust(f.facts, 'en')],
  ['script: the list is not kept last', swapJs('checkoutJs', '} else if (panel.lastElementChild !== box) panel.appendChild(box)', '}'), 'checkoutlate', { lang: 'en', w: 1280 }, (f) => f.facts.trustLast],
]
const mutPage = async (kind, o, srvOpts) => {
  if (kind === 'cod') return resultMut(o, srvOpts)
  if (kind === 'codlinks') { const a = { api: resultApi({}), ...srvOpts }; return flowOnce(async (srv, f) => { const t = (f.t = await open(srv, { path: `/payment/result?trackid=${TRACK}`, lang: o.lang, w: o.w })); await t.p.waitForSelector('.sprc-cash', { timeout: 8000 }).catch(() => {}); f.link = await t.p.evaluate(() => document.querySelector('.purchase-result > a[href^="/invoice/"]').getBoundingClientRect().height) }, a, o) }
  if (kind === 'codcookie') return resultMut({ ...o, cookie: true }, srvOpts)
  if (kind === 'codforeign') return resultMut({ ...o, invoice: 'foreign' }, srvOpts)
  if (kind === 'knet') return resultMut({ ...o, status: 'knet', path: `/payment/result?status=success&trackid=${TRACK}&k=1893456000.0123456789abcdef0123456789abcdef`, expect: '.sprc' }, srvOpts)
  if (kind === 'codlate') return resultMut({ ...o, after: async (p, f) => { await p.evaluate(() => { const h = document.querySelector('.purchase-result'); const d = document.createElement('div'); h.appendChild(d) }); await p.waitForTimeout(500); f.late = await p.evaluate(() => ({ last: document.querySelector('.purchase-result').lastElementChild.className })) } }, srvOpts)
  if (kind === 'codcopy') return resultMut({ ...o, clip: 'api', after: async (p, f) => { await p.locator('.sprc-cash__copy').click(); await p.waitForTimeout(400); f.afterClick = await p.evaluate(() => ({ copied: window.__copied })) } }, srvOpts)
  if (kind === 'track') return trackMut(o, srvOpts)
  if (kind === 'invoice') return invoicePage(o, srvOpts)
  if (kind === 'checkout') return checkoutPage(o, srvOpts)
  if (kind === 'ckstuck') return checkoutPage({ ...o, after: async (p, f) => { await p.evaluate(() => window.scrollTo(0, 420)); await p.waitForTimeout(400); f.facts = await p.evaluate(CHECKOUT_FACTS) } }, srvOpts)
  if (kind === 'checkoutlate') return checkoutPage({ ...o, after: async (p, f) => { await p.evaluate(() => { const s = document.querySelector('.purchase-checkout-summary'); const d = document.createElement('div'); d.id = 'late'; s.appendChild(d) }); await p.waitForTimeout(500); f.facts = await p.evaluate(CHECKOUT_FACTS) } }, srvOpts)
  throw new Error('unknown mutant page ' + kind)
}
const goodRun = (kind, o) => {
  if (kind === 'ckstuck') return checkoutPage({ ...o, after: async (p, f) => { await p.evaluate(() => window.scrollTo(0, 420)); await p.waitForTimeout(400); f.facts = await p.evaluate(CHECKOUT_FACTS) } })
  return mutPage(kind, o, {})
}
const goodCache = new Map()
for (const [label, cut, kind, o, check] of MUTS) {
  if (cut.missing) { is(false, `mutant "${label}": the text to cut was found in the file`, cut.missing); continue }
  const gk = kind + JSON.stringify(o)
  if (!goodCache.has(gk)) goodCache.set(gk, (async () => { const f = await goodRun(kind, o); return f.error ? goodRun(kind, o) : f })())
  const good = await goodCache.get(gk)
  is(holds(check, good), `mutant "${label}": the check passes on the real files`, good.error || '')
  const srvOpts = cut.css ? { css: cut.css } : { js: cut.js }
  const bad = await mutPage(kind, o, srvOpts)
  is(!holds(check, bad), `mutant "${label}": and goes red with it cut`, bad.error ? 'the page itself failed: ' + bad.error : '')
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
