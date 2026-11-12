// npm run test:mobile-1112b - proves the MOBILE-1112B section of public/sporta-shadows.css, the MOBILE-1112B block of
// public/sporta-features.js and the "area list on a touch screen" block of public/sporta-gov-autopick.js: the phone items the
// MOBILE-1112 pass left. Each item is measured OFF (the file without its part) and ON (the repo file).
//   A  FIXTURES (always run): the captured live markup under the live compiled rules (scripts/lib/shape-pages.mjs)
//      [m2-bar]     checkout pay bar on 844x390 with a 47px notch on each side: OFF the controls start 16px from the edge (in the
//                   notch strip), ON they keep the inset; portrait unchanged
//      [m2-text]    checkout labels on 844x390, quick checkout "Change" / "Edit bag", /cart step labels: under 14 -> 14px; no step
//                   label wraps or leaves its quarter, nothing scrolls sideways
//      [m2-drawer]  bag drawer at 844x390, 667x375, 568x320: header, footer and the room the lines get; portrait unchanged
//      [m2-product] product page 320-390: the authentic line, Size guide and the fit note 14px; the badges keep their size
//      [m2-focus]   390x844 checkout: a focused field unpins the header (after a scroll it is off screen), blur pins it again;
//                   a checkbox does not; 768px untouched
//   B  THE CAPTURED LIVE CLIENT (scripts/lib/cart-ux-live.mjs; skipped, and said so, when the capture is not on this machine)
//      [m2-area] + gov-autopick.js   area rows 36 -> 44px; a finger dragging the open list: OFF picks a row and closes the list,
//                   ON scrolls it and picks nothing; a tap, a mouse click and the keyboard still pick
//      [m2-ai] + features.js         Sporta AI panel: OFF the page jumps from 500px to the top when it opens, ON it stays; every
//                   control 44px+; the starters 14px; on 844x390 the panel uses the height and keeps off the notch; a reply
//                   scrolls the panel's list to the end and not the page
//      [m2-invoice] invoice 320-430: OFF the totals sit off screen, ON every cell is inside the screen; 768 untouched
//      [m2-drawer] / [m2-bar] / [m2-focus] on the real pages
//   C  file rules + MUTATION: one section after MOBILE-1112 and before ICON SET; each block removed fails its own checks; the
//      two script blocks removed fail theirs; sporta-features.js holds ONE "Product names" block (item 7: nothing to remove).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PAGES, start, FILE, ROOT } from './lib/shape-pages.mjs'
import { liveDir, serveLive, BAG } from './lib/cart-ux-live.mjs'

let pass = 0, fail = 0
let sink = null
const is = (ok, msg, d = '') => { if (sink) { if (!ok) sink.push(msg); return ok } if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } return ok }
const head = (t) => console.log(`\n=== ${t}`)
const f1 = (n) => (n == null ? 'null' : Math.round(n * 10) / 10)

const MARK = '/* ==== MOBILE-1112B', END = '/* ==== end MOBILE-1112B */'
const FULL = readFileSync(FILE, 'utf8')
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); return i < 0 || j < 0 ? s : s.slice(0, i) + s.slice(j + b.length) }
const OFF = cut(FULL, MARK, END)
const SECTION = FULL.slice(FULL.indexOf(MARK), FULL.indexOf(END) + END.length)
const BLOCKS = ['m2-area', 'm2-bar', 'm2-text', 'm2-drawer', 'm2-product', 'm2-ai', 'm2-invoice', 'm2-focus']
const withoutBlock = (id) => { const i = FULL.indexOf(`/* [${id}] */`); const n = FULL.indexOf('/* [m2-', i + 5); const e = FULL.indexOf(END); const j = n < 0 || n > e ? e : n; return FULL.slice(0, i) + FULL.slice(j) }
const GOV = readFileSync(join(ROOT, 'public/sporta-gov-autopick.js'), 'utf8')
const GOV_MARK = '/* Sporta checkout: the AREA LIST on a touch screen'
const GOV_OFF = GOV.slice(0, GOV.indexOf(GOV_MARK))
const FEAT = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const FEAT_OFF = cut(FEAT, '/* ===== MOBILE-1112B (', '/* ===== MOBILE-1112B - end =================================================== */')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const S = await start(browser)
const pg = (id) => PAGES.find((p) => p.id === id)
const run = async (id, lang, w, css, fn, opts = {}, arg) => { const { p, ctx } = await S.open(pg(id), lang, w, css, opts); try { return await p.evaluate(fn, arg) } finally { await ctx.close() } }

// ---- in-page measurements (fixtures) ------------------------------------------------------------------------------------------
const barM = () => {
  const r = document.documentElement
  if (innerWidth > innerHeight) { r.style.setProperty('--sa-left', '47px'); r.style.setProperty('--sa-right', '47px') }
  const bar = document.querySelector('.purchase-paybar, .action-bar')
  if (!bar || getComputedStyle(bar).display === 'none') return null
  const k = [...bar.querySelectorAll('a, button, p, span')].filter((e) => e.getBoundingClientRect().width > 1).map((e) => e.getBoundingClientRect())
  return { vw: r.clientWidth, minL: Math.min(...k.map((q) => q.left)), maxR: Math.max(...k.map((q) => q.right)), box: JSON.stringify(bar.getBoundingClientRect()), h: bar.getBoundingClientRect().height }
}
const textM = (sels) => {
  const out = {}
  for (const [k, s] of Object.entries(sels)) out[k] = [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().height > 0).map((e) => parseFloat(getComputedStyle(e).fontSize))
  out.docW = document.documentElement.scrollWidth - document.documentElement.clientWidth
  return out
}
const stepsM = () => {
  const li = [...document.querySelectorAll('nav.purchase-steps li')]
  return {
    docW: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navH: document.querySelector('nav.purchase-steps').getBoundingClientRect().height,
    labels: li.map((l) => { const s = l.querySelector('.purchase-steps__body > span:last-child'), a = s.getBoundingClientRect(), b = l.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(s).lineHeight); return { fs: parseFloat(getComputedStyle(s).fontSize), lines: Math.round(a.height / lh), inside: a.left >= b.left - 0.5 && a.right <= b.right + 0.5 } }),
  }
}
const drawerM = () => {
  const d = document.querySelector('.campaign-cart-drawer'), R = (e) => e.getBoundingClientRect()
  const hd = d.querySelector(':scope > header'), ul = d.querySelector(':scope > ul'), ft = d.querySelector(':scope > footer')
  const cta = ft.querySelector('a.btn-primary'), tot = ft.querySelector(':scope > div:first-child')
  return { vh: innerHeight, header: R(hd).height, footer: R(ft).height, ul: ul.clientHeight, ftB: R(ft).bottom, cta: { h: R(cta).height, w: R(cta).width, b: R(cta).bottom, l: R(cta).left, r: R(cta).right }, tot: { l: R(tot).left, r: R(tot).right, w: tot.scrollWidth - tot.clientWidth }, ftOver: ft.scrollWidth - ft.clientWidth, close: R(hd.querySelector('button')).height }
}
const productM = () => {
  const fs = (s) => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : null }
  const sg = [...document.querySelectorAll('#product-size-options button')].find((b) => b.classList.contains('text-accent'))
  const plate = document.querySelector('.campaign-brand-plate'), auth = document.querySelector('.campaign-brand-plate__authentic')
  return {
    auth: fs('.campaign-brand-plate__authentic'), guide: sg ? parseFloat(getComputedStyle(sg).fontSize) : null, guideH: sg ? sg.getBoundingClientRect().height : null,
    fit: fs('.catalog-product-options p.text-xs.text-slate-600'), badges: [...document.querySelectorAll('.catalog-card-badge')].map((b) => parseFloat(getComputedStyle(b).fontSize)),
    authIn: auth.getBoundingClientRect().right <= plate.getBoundingClientRect().right + 0.5 && auth.getBoundingClientRect().left >= plate.getBoundingClientRect().left - 0.5,
    docW: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
}
const focusM = async (sel) => {
  const h = document.querySelector('.app-header'), wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  let f = sel === 'make:checkbox' ? null : document.querySelector(sel)
  if (!f && sel === 'make:checkbox') { f = document.createElement('input'); f.type = 'checkbox'; document.querySelector('main').prepend(f) }
  f.focus({ preventScroll: true }); scrollTo({ top: 900, behavior: 'instant' }); await wait()
  const focused = { pos: getComputedStyle(h).position, b: h.getBoundingClientRect().bottom }
  f.blur(); await wait()
  const blurred = { pos: getComputedStyle(h).position, b: h.getBoundingClientRect().bottom }
  return { focused, blurred }
}

// ---- A: fixture checks (a function of the shadows css, so the mutation run repeats them) ---------------------------------------
async function fixtureChecks(css) {
  // [m2-bar]
  for (const lang of ['ar', 'en']) {
    const off = await run('screen/checkout', lang, 844, OFF, barM, { h: 390 }), on = await run('screen/checkout', lang, 844, css, barM, { h: 390 })
    if (css === FULL) is(off.minL < 47 || off.maxR > off.vw - 47, `[m2-bar] ${lang} 844x390 OFF: the pay bar's controls reach into the 47px notch strip (${f1(off.minL)}..${f1(off.maxR)} of ${off.vw})`)
    is(on.minL >= 47 - 0.5 && on.maxR <= on.vw - 47 + 0.5, `[m2-bar] ${lang} 844x390: the pay bar's controls keep clear of both notch strips (${f1(on.minL)}..${f1(on.maxR)} of ${on.vw})`)
    const p0 = await run('screen/checkout', lang, 390, OFF, barM, { h: 844 }), p1 = await run('screen/checkout', lang, 390, css, barM, { h: 844 })
    is(p0 && p1 && p1.box === p0.box && p1.minL === p0.minL && p1.maxR === p0.maxR, `[m2-bar] ${lang} 390x844 portrait: the bar is the same box`)
  }
  // [m2-text]
  const CK = { label: '.purchase-checkout-layout .purchase-field > label' }
  for (const lang of ['ar', 'en']) {
    const off = await run('screen/checkout', lang, 844, OFF, textM, { h: 390 }, CK), on = await run('screen/checkout', lang, 844, css, textM, { h: 390 }, CK)
    if (css === FULL) is(off.label.some((f) => f < 14), `[m2-text] ${lang} 844x390 OFF: checkout labels at ${f1(Math.min(...off.label))}px`)
    is(on.label.length >= 8 && on.label.every((f) => f >= 14) && on.docW === 0, `[m2-text] ${lang} 844x390: every checkout label is 14px or more`, on.label.join())
    const QK = { links: '.purchase-quick :is(button, a).text-accent.text-xs' }
    const qo = await run('checkout/quick', lang, 390, OFF, textM, {}, QK), qn = await run('checkout/quick', lang, 390, css, textM, {}, QK)
    if (css === FULL) is(qo.links.length >= 2 && qo.links.every((f) => f < 14), `[m2-text] ${lang} quick checkout OFF: "Change" / "Edit bag" at ${qo.links.join('/')}px`)
    is(qn.links.length >= 2 && qn.links.every((f) => f >= 14) && qn.docW === 0, `[m2-text] ${lang} quick checkout: "Change" and "Edit bag" are 14px`, qn.links.join())
    for (const w of [320, 360, 390]) {
      const so = await run('screen/cart', lang, w, OFF, stepsM), sn = await run('screen/cart', lang, w, css, stepsM)
      if (css === FULL) is(so.labels.every((l) => l.fs < 14), `[m2-text] ${lang} /cart ${w} OFF: step labels ${so.labels[0].fs}px`)
      is(sn.labels.length === 4 && sn.labels.every((l) => l.fs >= 14 && l.lines === 1 && l.inside) && sn.docW === 0, `[m2-text] ${lang} /cart ${w}: the four step labels are 14px, one line each, inside their quarter`, JSON.stringify(sn.labels))
      is(sn.navH - so.navH <= 6, `[m2-text] ${lang} /cart ${w}: the steps bar grows ${f1(sn.navH - so.navH)}px at most 6 (${f1(so.navH)} -> ${f1(sn.navH)})`)
    }
    const co = await run('screen/checkout', lang, 390, OFF, stepsM), cn = await run('screen/checkout', lang, 390, css, stepsM)
    is(co.navH === cn.navH, `[m2-text] ${lang} /checkout 390: the one-page checkout keeps its folded steps bar (${f1(co.navH)}px)`)
  }
  // [m2-drawer]
  for (const lang of ['ar', 'en']) for (const [w, h] of [[844, 390], [667, 375], [568, 320]]) {
    const off = await run('screen/drawer', lang, w, OFF, drawerM, { h }), on = await run('screen/drawer', lang, w, css, drawerM, { h })
    is(on.header <= 54 && on.close >= 44, `[m2-drawer] ${lang} ${w}x${h}: header ${f1(off.header)} -> ${f1(on.header)}px, close button ${f1(on.close)}px`)
    is(on.footer <= 80 && on.ftOver <= 0 && on.tot.w <= 0, `[m2-drawer] ${lang} ${w}x${h}: footer ${f1(off.footer)} -> ${f1(on.footer)}px, nothing in it overflows`)
    is(on.ul >= off.ul + 60, `[m2-drawer] ${lang} ${w}x${h}: the bag lines get ${f1(on.ul - off.ul)}px more (${f1(off.ul)} -> ${f1(on.ul)}px)`)
    is(on.cta.h >= 47.5 && on.cta.w >= 120 && on.ftB <= on.vh + 0.5, `[m2-drawer] ${lang} ${w}x${h}: the checkout button is ${f1(on.cta.w)}x${f1(on.cta.h)} and the footer ends on screen`)
  }
  for (const lang of ['ar', 'en']) { const off = await run('screen/drawer', lang, 390, OFF, drawerM, { h: 844 }), on = await run('screen/drawer', lang, 390, css, drawerM, { h: 844 }); is(JSON.stringify(off) === JSON.stringify(on), `[m2-drawer] ${lang} 390x844 portrait: the drawer is unchanged`) }
  // [m2-product]
  for (const id of ['product/full', 'product/one']) for (const lang of ['ar', 'en']) for (const w of [320, 360, 390]) {
    const off = await run(id, lang, w, OFF, productM), on = await run(id, lang, w, css, productM)
    if (css === FULL && id === 'product/full') is(off.auth < 14 && off.guide < 14 && off.fit < 14, `[m2-product] ${lang} ${w} OFF: authentic ${off.auth}, size guide ${off.guide}, fit note ${off.fit}px`)
    is(on.auth >= 14 && on.authIn && (on.guide == null || on.guide >= 14) && (on.fit == null || on.fit >= 14), `[m2-product] ${id} ${lang} ${w}: authentic, size guide and fit note are 14px, the line inside its plate`, JSON.stringify(on))
    is(on.docW === 0 && (on.guideH == null || on.guideH >= 44) && JSON.stringify(on.badges) === JSON.stringify(off.badges), `[m2-product] ${id} ${lang} ${w}: no sideways scroll, Size guide 44px tall, badges unchanged`)
  }
  // [m2-focus] (the checkout already lets its header scroll on a phone: sporta-checkout-a11y.css; these are the other form pages)
  for (const [id, sel] of [['support', 'main textarea'], ['support', 'main input'], ['returns', 'main input'], ['track', 'main input']]) for (const lang of ['ar', 'en']) {
    const off = await run(id, lang, 390, OFF, focusM, { h: 700 }, sel), on = await run(id, lang, 390, css, focusM, { h: 700 }, sel)
    if (css === FULL) is(off.focused.pos === 'sticky' && off.focused.b > 100, `[m2-focus] ${id} ${lang} 390 OFF: with "${sel}" focused the pinned header still covers ${f1(off.focused.b)}px`)
    is(on.focused.b <= 0, `[m2-focus] ${id} ${lang} 390: with "${sel}" focused the header scrolls away (bottom ${f1(on.focused.b)})`)
    is(on.blurred.pos === 'sticky' && on.blurred.b > 100, `[m2-focus] ${id} ${lang} 390: the field blurred, the header is pinned again (${f1(on.blurred.b)})`)
  }
  for (const lang of ['ar', 'en']) {
    const cb = await run('support', lang, 390, css, focusM, { h: 700 }, 'make:checkbox')
    is(cb.focused.pos === 'sticky', `[m2-focus] ${lang} 390: a focused checkbox does not unpin it`)
    const t = await run('support', lang, 768, css, focusM, { h: 700 }, 'main input')
    is(t.focused.pos === 'sticky', `[m2-focus] ${lang} 768: the tablet header stays pinned`)
  }
}

// ---- B: the captured live client -------------------------------------------------------------------------------------------------
const INVOICE = { track_id: 'SPT-TEST-0001', placed_at: '2026-11-12 10:00:00', payment_status: 'paid', paid_at: '2026-11-12 10:02:00', payment_method: 'knet', customer_name: 'Test Customer', subtotal: 33, discount_amount: 3.3, discount_label: 'WELCOME10', delivery_fee: 2, amount: 31.7, address: { governorate: 'hawalli', area: 'Salmiya', block: '12', street: 'Salem Al-Mubarak St', building: '45', floor: '3', flat: '7' }, items: [{ name_en: 'Cloudsoft Jacket — Coffee Brown', name_ar: 'جاكيت كلاودسوفت — بني قهوة', size: 'M', qty: 2, unit_price: 10, line_total: 20 }, { name_en: 'Sgomma T-Shirt — Navy', name_ar: 'تيشيرت سغوما — كحلي', size: 'XL', qty: 1, unit_price: 5, line_total: 5 }, { name_en: 'Cloudsoft Leggings — Army Green', name_ar: 'ليقنز كلاودسوفت — أخضر عسكري', size: 'L', qty: 1, unit_price: 8, line_total: 8 }] }
const REPLY = 'A long answer. '.repeat(60)
const onPost = (q, r, u) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(u.searchParams.get('r') === 'assistant' ? JSON.stringify({ reply: REPLY, data: { kind: 'products', items: [{ slug: 'cloudsoft-jacket-coffee-brown', name: 'Cloudsoft Jacket', price: 10, has_sizes: true }, { slug: 'sgomma-t-shirt-navy', name: 'Sgomma T-Shirt', price: 5, price_kwd: 5, has_sizes: false }] } }) : '{"error":"test"}') }) }
const servers = {}
const live = async (key, css, gov, feat) => (servers[key] ||= await serveLive({ css: { 'sporta-shadows.css': css }, js: { 'sporta-gov-autopick.js': gov, 'sporta-features.js': feat }, onPost, api: { invoice: INVOICE } }))
const openLive = async (srv, path, { w = 390, h = 844, touch = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })
  await ctx.route((u) => !u.href.startsWith(srv.base), (r) => r.abort())
  await ctx.addInitScript((c) => { try { localStorage.setItem('sporta_cart', JSON.stringify(c)) } catch {} }, BAG)
  const p = await ctx.newPage()
  await p.goto(srv.base + path, { waitUntil: 'load' })
  return { p, ctx }
}
const touchDrag = async (p, x, y, dy) => {
  const c = await p.context().newCDPSession(p)
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let k = 1; k <= 10; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * k) / 10 }] }); await p.waitForTimeout(16) }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await p.waitForTimeout(400)
}
const listM = () => { const ul = document.querySelector('.purchase-field [role="listbox"]'); return { v: document.querySelector('#f-area').value, open: !!ul, st: ul ? ul.scrollTop : null, rows: ul ? [...ul.querySelectorAll('[role="option"]')].slice(0, 6).map((e) => e.getBoundingClientRect().height) : [], gov: ul ? parseFloat(getComputedStyle(ul.querySelector('[role="option"] > span + span')).fontSize) : null } }
const openArea = async (p) => { await p.waitForSelector('#f-area', { timeout: 60000 }); await p.waitForTimeout(600); await p.evaluate(() => { const f = document.querySelector('#f-area'); scrollTo({ top: scrollY + f.getBoundingClientRect().top - 200, behavior: 'instant' }) }); await p.waitForTimeout(150); await p.locator('#f-area').focus(); await p.waitForSelector('.purchase-field [role="listbox"]'); await p.waitForTimeout(200) }
const rowAt = (i) => { const e = document.querySelectorAll('.purchase-field [role="listbox"] > [role="option"]')[i]; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: e.firstElementChild.textContent } }
const aiPanel = () => document.querySelector('[role="dialog"][aria-modal="false"]')
const aiM = () => {
  const d = document.querySelector('[role="dialog"][aria-modal="false"]'), R = (e) => e.getBoundingClientRect()
  const ctl = [...d.querySelectorAll('button, input, a')].filter((e) => R(e).width > 1).map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 16), w: R(e).width, h: R(e).height, fs: parseFloat(getComputedStyle(e).fontSize) }))
  const starters = [...d.querySelectorAll(':scope > div.flex-wrap > button')].map((e) => ({ h: R(e).height, fs: parseFloat(getComputedStyle(e).fontSize) }))
  const list = d.querySelector(':scope > div[aria-live]'), msgs = [...list.children].filter((e) => e.getBoundingClientRect().height > 0)
  const last = msgs.length ? msgs[msgs.length - 1].getBoundingClientRect() : null
  return { y: scrollY, vh: innerHeight, vw: innerWidth, d: { l: R(d).left, r: R(d).right, t: R(d).top, b: R(d).bottom, h: R(d).height }, ctl, starters, list: { h: list.clientHeight, st: list.scrollTop, max: list.scrollHeight - list.clientHeight, lastEnd: last ? R(list).bottom - last.bottom : null } }
}
const openAi = async (p, y) => {
  await p.waitForSelector('.assistant-launcher', { timeout: 60000 }); await p.waitForTimeout(700)
  await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await p.waitForTimeout(250)
  await p.evaluate(() => [...document.querySelectorAll('.assistant-launcher')].find((b) => b.getBoundingClientRect().width > 0).click())
  await p.waitForFunction(() => !!document.querySelector('[role="dialog"][aria-modal="false"]')); await p.waitForTimeout(900)
}
const invM = () => {
  const vw = document.documentElement.clientWidth, wrap = document.querySelector('.invoice-table-wrap'), t = document.querySelector('.invoice-table')
  const cells = [...t.querySelectorAll('td')].filter((c) => c.getBoundingClientRect().width > 0 && c.textContent.trim()).map((c) => { const r = c.getBoundingClientRect(); const n = document.createRange(); n.selectNodeContents(c); const k = n.getBoundingClientRect(); return { l: Math.min(r.left, k.left), r: Math.max(r.right, k.right), t: c.textContent.trim().slice(0, 14) } })
  const total = [...t.querySelectorAll('tfoot td')].pop().getBoundingClientRect()
  return { vw, docW: document.documentElement.scrollWidth - vw, wrapOver: wrap.scrollWidth - wrap.clientWidth, cells, total: { l: total.left, r: total.right }, tableW: t.getBoundingClientRect().width, rows: t.querySelectorAll('tbody tr').length }
}

async function liveChecks(css, gov, feat, only = null) {
  const want = (b) => !only || only === b
  const key = `${css.length}:${gov.length}:${feat.length}`
  const on = await live(key, css, gov, feat), off = await live('off', OFF, GOV_OFF, FEAT_OFF)
  const full = css === FULL && gov === GOV && feat === FEAT
  // [m2-area] (+ the gov-autopick block)
  if (want('m2-area') || want('gov')) for (const lang of ['ar', 'en']) {
    const res = {}
    for (const [name, srv] of [['off', off], ['on', on]]) {
      if (name === 'off' && !full) continue
      const { p, ctx } = await openLive(srv, `/checkout?lang=${lang}`)
      try {
        await openArea(p)
        const m0 = await p.evaluate(listM)
        const box = await p.evaluate(() => { const r = document.querySelector('.purchase-field [role="listbox"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 20 } })
        await touchDrag(p, box.x, box.y, -150)
        res[name] = { m0, drag: await p.evaluate(listM) }
        if (name === 'on') {
          if (!(await p.evaluate(() => !!document.querySelector('.purchase-field [role="listbox"]')))) { await p.locator('#f-area').fill(''); await p.locator('#f-area').blur(); await openArea(p) }
          const t = await p.evaluate(rowAt, 5); const c = await p.context().newCDPSession(p)
          await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.x, y: t.y }] }); await p.waitForTimeout(40)
          await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(400)
          res.tap = { want: t.t, got: await p.evaluate(listM) }
        }
      } finally { await ctx.close() }
    }
    if (want('m2-area')) {
      if (full) is(res.off.m0.rows.every((h) => h < 40), `[m2-area] ${lang} OFF: area rows ${res.off.m0.rows[0]}px`)
      is(res.on.m0.rows.length === 6 && res.on.m0.rows.every((h) => h >= 44) && res.on.m0.gov >= 14, `[m2-area] ${lang}: every area row is 44px or more, the governorate beside it 14px`, res.on.m0.rows.join())
    }
    if (want('gov')) {
      if (full) is(res.off.drag.v !== '' && !res.off.drag.open, `[gov] ${lang} OFF: a finger dragging the list picked "${res.off.drag.v}" and closed the list (the defect)`)
      is(res.on.drag.v === '' && res.on.drag.open && res.on.drag.st > 50, `[gov] ${lang}: a finger dragging the list scrolls it ${f1(res.on.drag.st)}px and picks nothing`, JSON.stringify(res.on.drag))
      is(res.tap.got.v === res.tap.want && !res.tap.got.open, `[gov] ${lang}: a tap on a row picks that row ("${res.tap.got.v}") and closes the list`, JSON.stringify(res.tap))
    }
    if (want('gov') && lang === 'en') {
      // mouse and keyboard pick at once, as before
      const { p, ctx } = await openLive(on, `/checkout?lang=${lang}`, { touch: false })
      try {
        await openArea(p); const t = await p.evaluate(rowAt, 3); await p.mouse.click(t.x, t.y); await p.waitForTimeout(250)
        const m = await p.evaluate(listM); is(m.v === t.t && !m.open, `[gov] a mouse click on a row picks it ("${m.v}")`)
        await p.locator('#f-area').fill(''); await p.locator('#f-area').focus(); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
        const k = await p.evaluate(listM); is(k.v !== '' && !k.open, `[gov] the keyboard (ArrowDown, Enter) picks a row ("${k.v}")`)
      } finally { await ctx.close() }
    }
  }
  // [m2-ai] (+ the features.js block)
  if (want('m2-ai') || want('feat')) for (const lang of ['ar', 'en']) for (const [w, h] of [[390, 844], [320, 568], [844, 390]]) {
    const res = {}
    for (const [name, srv] of [['off', off], ['on', on]]) {
      if (name === 'off' && !full) continue
      const { p, ctx } = await openLive(srv, `/shop?lang=${lang}`, { w, h })
      try {
        await p.evaluate(() => { const r = document.documentElement; if (innerWidth > innerHeight) { r.style.setProperty('--sa-left', '47px'); r.style.setProperty('--sa-right', '47px'); r.style.setProperty('--sa-bottom', '21px') } })
        await openAi(p, 500)
        res[name] = await p.evaluate(aiM)
        if (name === 'on' && w === 390) {
          await p.locator('[role="dialog"][aria-modal="false"] input[maxlength="500"]').fill('where is my order')
          await p.locator('[role="dialog"][aria-modal="false"] button[type="submit"]').click(); await p.waitForTimeout(1200)
          res.reply = await p.evaluate(aiM)
        }
      } finally { await ctx.close() }
    }
    const c = `${lang} ${w}x${h}`, o = res.on
    if (want('feat')) {
      if (full && w !== 844) is(res.off.y < 50, `[feat] ${c} OFF: opening the panel carried the page from 500px to ${f1(res.off.y)} (the jump)`)
      is(Math.abs(o.y - 500) < 1, `[feat] ${c}: opening the panel leaves the page where it was (${f1(o.y)})`)
      if (res.reply && want('m2-ai')) is(res.reply.ctl.length >= 8 && res.reply.ctl.every((k) => k.h >= 44 && k.w >= 44), `[m2-ai] ${c}: after a reply with products, every control (listen, product links, Choose size, Add) is 44x44 or more`, res.reply.ctl.filter((k) => k.h < 44 || k.w < 44).map((k) => `${k.t} ${f1(k.w)}x${f1(k.h)}`).join(' | '))
      if (res.reply) is(Math.abs(res.reply.y - 500) < 1 && res.reply.list.max > 100 && res.reply.list.st >= res.reply.list.max - 20 && res.reply.list.lastEnd >= -1, `[feat] ${c}: a long reply scrolls the panel's list to the end of the reply (scrolled ${f1(res.reply.list.st)} of ${f1(res.reply.list.max)}, the reply ends ${f1(res.reply.list.lastEnd)}px inside the list) and the page stays at ${f1(res.reply.y)}`)
    }
    if (want('m2-ai')) {
      if (full) is(res.off.ctl.some((k) => k.h < 44 || k.w < 44), `[m2-ai] ${c} OFF: controls under 44px (${res.off.ctl.filter((k) => k.h < 44 || k.w < 44).map((k) => `${f1(k.w)}x${f1(k.h)}`).join(' ')})`)
      is(o.ctl.length >= 8 && o.ctl.every((k) => k.h >= 44 && k.w >= 44), `[m2-ai] ${c}: every control in the panel is 44x44 or more`, o.ctl.filter((k) => k.h < 44 || k.w < 44).map((k) => `${k.t} ${f1(k.w)}x${f1(k.h)}`).join(' | '))
      is(o.starters.length === 4 && o.starters.every((s) => s.fs >= 14), `[m2-ai] ${c}: the four starters are 14px`, JSON.stringify(o.starters))
      is(o.d.t >= 0 && o.d.b <= o.vh && o.d.l >= 0 && o.d.r <= o.vw, `[m2-ai] ${c}: the panel is inside the screen (${f1(o.d.l)},${f1(o.d.t)} - ${f1(o.d.r)},${f1(o.d.b)})`)
      if (w === 844) {
        is(o.d.l >= 47 - 0.5 && o.d.r <= o.vw - 47 + 0.5, `[m2-ai] ${c}: the panel keeps off both 47px notch strips (${f1(o.d.l)}..${f1(o.d.r)})`)
        is(o.d.b >= o.vh - 21 - 8 - 1 && o.vh - o.d.b <= 30 && (!full || o.list.h >= res.off.list.h + 60), `[m2-ai] ${c}: the panel sits ${f1(o.vh - o.d.b)}px above the bottom (was ${full ? f1(res.off.vh - res.off.d.b) : '?'}) and its messages get ${full ? f1(o.list.h - res.off.list.h) : '?'}px more`)
      }
    }
  }
  // [m2-invoice]
  if (want('m2-invoice')) for (const lang of ['ar', 'en']) for (const w of [320, 360, 390, 430, 768]) {
    const res = {}
    for (const [name, srv] of [['off', off], ['on', on]]) {
      const { p, ctx } = await openLive(srv, `/invoice/SPT-TEST-0001?lang=${lang}`, { w, h: 900 })
      try { await p.waitForSelector('.invoice-table', { timeout: 60000 }); await p.waitForTimeout(400); res[name] = await p.evaluate(invM) } finally { await ctx.close() }
    }
    const o = res.on, c = `${lang} ${w}`
    if (w === 768) { is(JSON.stringify(o) === JSON.stringify(res.off), `[m2-invoice] ${c}: the invoice is untouched from 640px`); continue }
    if (full) is(res.off.total.r > res.off.vw || res.off.total.l < 0 || res.off.wrapOver > 0, `[m2-invoice] ${c} OFF: the table is ${f1(res.off.tableW)}px in a ${res.off.vw}px screen, the total at ${f1(res.off.total.l)}..${f1(res.off.total.r)}`)
    is(o.rows === 3 && o.docW === 0 && o.wrapOver <= 0 && o.cells.every((k) => k.l >= -0.5 && k.r <= o.vw + 0.5), `[m2-invoice] ${c}: every cell, the total included (${f1(o.total.l)}..${f1(o.total.r)}), is inside the screen; nothing scrolls sideways`, JSON.stringify(o.cells.filter((k) => k.l < 0 || k.r > o.vw)))
  }
  // [m2-drawer] / [m2-bar] / [m2-focus] on the real pages
  if (want('m2-drawer')) for (const lang of ['ar', 'en']) {
    const res = {}
    for (const [name, srv] of [['off', off], ['on', on]]) {
      const { p, ctx } = await openLive(srv, `/shop?lang=${lang}`, { w: 844, h: 390 })
      try {
        await p.waitForSelector('.app-header button.navbar-cart', { timeout: 60000 }); await p.waitForTimeout(600)
        await p.locator('.app-header button.navbar-cart').click(); await p.waitForFunction(() => { const d = document.querySelector('.campaign-cart-drawer'); return d && !d.hasAttribute('inert') }); await p.waitForTimeout(500)
        res[name] = await p.evaluate(drawerM)
      } finally { await ctx.close() }
    }
    is(res.on.ul >= res.off.ul + 60 && res.on.cta.h >= 47.5 && res.on.ftB <= res.on.vh + 0.5, `[m2-drawer] real drawer ${lang} 844x390: the lines get ${f1(res.off.ul)} -> ${f1(res.on.ul)}px (header ${f1(res.off.header)} -> ${f1(res.on.header)}, footer ${f1(res.off.footer)} -> ${f1(res.on.footer)})`)
  }
  if (want('m2-bar')) for (const lang of ['ar', 'en']) {
    const { p, ctx } = await openLive(on, `/checkout?lang=${lang}`, { w: 844, h: 390 })
    try { await p.waitForSelector('.purchase-paybar', { timeout: 60000 }); await p.waitForTimeout(500); const m = await p.evaluate(barM); is(m && m.minL >= 46.5 && m.maxR <= m.vw - 46.5, `[m2-bar] real checkout ${lang} 844x390: the pay bar's controls keep clear of the notch strips (${m && f1(m.minL)}..${m && f1(m.maxR)})`) } finally { await ctx.close() }
  }
  if (want('m2-focus')) for (const lang of ['ar', 'en']) {
    const { p, ctx } = await openLive(on, `/support?lang=${lang}`, { h: 700 })
    try {
      await p.waitForSelector('main textarea', { timeout: 60000 }); await p.waitForTimeout(500)
      const m = await p.evaluate(focusM, 'main textarea')
      is(m.focused.b <= 0 && m.blurred.pos === 'sticky' && m.blurred.b > 100, `[m2-focus] real /support ${lang} 390x844: a focused field lets the header scroll away (${f1(m.focused.b)}), blur pins it (${f1(m.blurred.b)})`)
    } finally { await ctx.close() }
  }
}

// ---- C: file rules ---------------------------------------------------------------------------------------------------------------
head('file')
is(FULL.indexOf(MARK) > 0 && FULL.indexOf(MARK, FULL.indexOf(MARK) + 1) < 0 && FULL.indexOf(END) > FULL.indexOf(MARK), 'one MOBILE-1112B section with its end marker')
is(FULL.indexOf(MARK) > FULL.indexOf('/* ==== end MOBILE-1112 */') && FULL.indexOf(END) < FULL.indexOf('/* ==== ICON SET'), 'the section sits after MOBILE-1112 and before ICON SET')
{
  const rules = SECTION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').split('}').map((s) => s.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'))
  const parts = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = '' } else cur += ch } out.push(cur.trim()); return out }
  const sels = rules.flatMap(parts)
  is(sels.length > 20 && sels.every((x) => x.startsWith('.storefront-root') || x.startsWith('.campaign-cart-drawer.cart-drawer')), 'every selector is scoped to .storefront-root (or the bag drawer, which the app mounts outside it)', sels.filter((x) => !x.startsWith('.storefront-root') && !x.startsWith('.campaign-cart-drawer.cart-drawer')).join(' | '))
  is(!/!important|url\(|transition|(^|[^-])color\s*:/.test(SECTION.replace(/\/\*[\s\S]*?\*\//g, '')), 'no !important, no url(), no transition, no colour')
  is(BLOCKS.every((b) => SECTION.includes(`/* [${b}] */`)), 'every block carries its marker')
}
{
  const bi = FEAT.indexOf('/* ===== MOBILE-1112B ('), be = FEAT.indexOf('/* ===== MOBILE-1112B - end'), mi = FEAT.indexOf('/* ===== MOBILE-1112 (')
  is(bi > 0 && be > bi && be < mi && FEAT.slice(FEAT.indexOf('/* ===== MOBILE-1112 - end')).split('\n').length <= 2, 'features.js: the MOBILE-1112B block sits before MOBILE-1112, which stays the last block')
  is(FEAT.split('Product names: the full name as a tooltip').length === 2 && FEAT.split("var SEL = '.storefront-root .catalog-card-name, .storefront-root .catalog-product-title'").length === 2, 'features.js: ONE "Product names" tooltip block (item 7: no duplicate left to remove at this tip)')
  is(GOV.indexOf(GOV_MARK) > 0 && !GOV.slice(GOV.indexOf(GOV_MARK)).includes('$') && GOV_OFF.length < GOV.length, 'gov-autopick.js: the area-list block is the last block, with no dollar sign (the installer runs through compose)')
  is(/font-size:14px;line-height:1\.5;color:var\(--ink/.test(GOV) && /HINT = '[^']*font-size:14px/.test(GOV) && !/font-size:1[23]px/.test(GOV), 'gov-autopick.js: the location status and hint are 14px (were 13 and 12)')
}

head('A  fixtures')
await fixtureChecks(FULL)

head('A  global sweep: no sideways scroll, no tap target loses its 44px')
if (!process.env.NO_MUTATION) {
  const tapsM = () => { const out = []; document.querySelectorAll('a[href], button, summary, select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio])').forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return } out.push({ i, w: r.width, h: r.height }) }); return { taps: out, docW: document.documentElement.scrollWidth - document.documentElement.clientWidth } }
  let n = 0
  for (const p of PAGES) for (const lang of ['ar', 'en']) for (const [w, h] of [[320, 568], [390, 844], [844, 390]]) {
    if (p.kind === 'prd' && w > 390) continue
    const off = await run(p.id, lang, w, OFF, tapsM, { h }), on = await run(p.id, lang, w, FULL, tapsM, { h })
    const lost = off.taps.filter((t) => { const o = on.taps.find((x) => x.i === t.i); return o && ((t.w >= 44 && o.w < 44) || (t.h >= 44 && o.h < 44)) })
    if (is(on.docW <= off.docW && on.docW === 0 && lost.length === 0 && on.taps.length === off.taps.length, `${p.id} ${lang} ${w}x${h}: no sideways scroll, no target lost size`, `docW ${on.docW}, lost ${lost.length}`)) n++
  }
  console.log(`  ${n} page states clean`)
}

const LIVE = liveDir()
if (LIVE) { head('B  the captured live client'); await liveChecks(FULL, GOV, FEAT) }
else console.log('\n=== B  SKIPPED: no captured live client on this machine (set SPORTA_LIVE_CAPTURE); sections A and C ran')

head('MUTATION')
if (process.env.NO_MUTATION) console.log('skipped (NO_MUTATION)')
else {
  const m = []; sink = m
  await fixtureChecks(OFF)
  if (LIVE) await liveChecks(OFF, GOV_OFF, FEAT_OFF)
  sink = null
  is(m.length >= 40, `the section and both script blocks removed fail ${m.length} checks`)
  for (const b of BLOCKS) {
    const mm = []; sink = mm
    const css = withoutBlock(b)
    if (['m2-bar', 'm2-text', 'm2-drawer', 'm2-product', 'm2-focus'].includes(b)) await fixtureChecks(css)
    else if (LIVE) await liveChecks(css, GOV, FEAT, b)
    sink = null
    if (!LIVE && ['m2-area', 'm2-ai', 'm2-invoice'].includes(b)) { console.log(`skip [${b}] mutation (live client only)`); continue }
    is(mm.some((x) => x.startsWith(`[${b}]`)), `[${b}] removed on its own fails ${mm.filter((x) => x.startsWith(`[${b}]`)).length} of its checks`)
  }
  if (LIVE) for (const [b, gov, feat] of [['gov', GOV_OFF, FEAT], ['feat', GOV, FEAT_OFF]]) {
    const mm = []; sink = mm
    await liveChecks(FULL, gov, feat, b)
    sink = null
    is(mm.some((x) => x.startsWith(`[${b}]`)), `[${b}] the ${b === 'gov' ? 'gov-autopick.js area-list' : 'features.js MOBILE-1112B'} block removed fails ${mm.length} of its checks`)
  }
}

for (const s of Object.values(servers)) await s.close()
S.close()
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
