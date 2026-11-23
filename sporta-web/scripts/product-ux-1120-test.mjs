// PRODUCT UX 1120 (owner, 2026-11-19: "full improve product page ux ui"): what a scan of the product page found wrong, and the fixes, proven on the
// REAL compiled storefront (the capture of the live build) with the add-ons of this checkout:
//
//   npm run test:product-ux-1120      (rig-free; needs the capture, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
//   TITLE     a hyphenated word keeps its line: "Sgomma T-Shirt - Navy" wrapped as "Sgomma T-" / "Shirt - Navy" (320-1280 px, English). The joiner is
//             written once (a second pass changes nothing), the tooltip and the page description read the name without it, Arabic is untouched,
//             card names and a product reached from the shop get the same treatment.                                   (sporta-features.js NAMES-1119)
//   PLATE     the authenticity plate has no stray hairline when it has no maker of its own; with a maker the divider stays. ([pux-1])
//   ACTIONS   "Ask on WhatsApp" (the message names the product and carries its canonical address, never the address bar's tracking tail; the number
//             is the footer's and follows it) and "Share" / "Copy link" (a live confirmation that moves nothing) after the reassurance panel: 44px,
//             one line where they fit, line icons, Arabic and English, the dark theme, print, keyboard order, put back after React renders the page
//             again, on a sold-out product too.                                          (sporta-features.js PRODUCT ACTIONS 1120, [pux-2..5])
//   CARDS     the grey price of a sold-out related card reads 4.5:1 on the dark card (it was 2.75:1).  (sporta-shadows.css [pc-7])
//   MUTATION  every rule is cut in turn (each [pux-N] block, the word pass, the tooltip / description / message strip, the number source, the message,
//             the address source, the placement, the observer, the update key, the copy and share paths, the dark card rule) and the matching check
//             must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-product-fix.css', SH_F = 'sporta-shadows.css', FEAT_F = 'sporta-features.js'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8'), SH = readFileSync(join(PUB, SH_F), 'utf8'), FEAT = readFileSync(join(PUB, FEAT_F), 'utf8')
let pass = 0, fail = 0
setTimeout(() => { console.log('FAIL watchdog: the suite did not finish in 25 minutes'); process.exit(1) }, 25 * 60 * 1000).unref()
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const note = (t) => console.log('note ' + t)
const limit = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms).unref())
const closeQuietly = (ctx) => Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000).unref())])
const holds = (check, ...a) => { try { return check(...a) === true } catch (e) { return false } }

const SLUG = 'sgomma-t-shirt-navy', BRAND = 'vanquish-tank-navy', SOLD = 'cagliari-calcio-backpack'
const NAME = 'Sgomma T-Shirt — Navy'
const NAME_AR = 'تيشيرت سغوما — كحلي'
const CANON = (l) => 'https://www.sporta.com.kw/product/' + SLUG + (l === 'en' ? '?lang=en' : '')
const TAIL = `/product/${SLUG}?utm_source=ig&fbclid=abc123`      // a visitor from an ad: the address bar carries a tracking tail, the canonical does not
// the words of the row, as the script writes them (a change of wording is a change here on purpose: these are the owner's shop's words)
const T = {
  en: { ask: 'Ask on WhatsApp', askAria: 'Ask on WhatsApp about this product', share: 'Share', copy: 'Copy link', copied: 'Link copied', failed: 'Copy failed', group: 'Ask or share', msg: 'Hello Sporta, I have a question about this product:' },
  ar: { ask: 'اسأل عبر واتساب', askAria: 'اسأل عبر واتساب عن هذا المنتج', share: 'مشاركة', copy: 'نسخ الرابط', copied: 'تم نسخ الرابط', failed: 'تعذّر النسخ', group: 'استفسار أو مشاركة', msg: 'مرحبًا سبورتا، لدي سؤال عن هذا المنتج:' },
}
const PHOTO = photoPng(800, 800)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive(opts); try { return await fn(srv) } finally { await srv.close() } }

// ---------------------------------------------------------------------------------------------------------------- colour maths (node side)
const rgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
const ratio = (fg, bg) => { const a = rgb(fg), b = rgb(bg); if (!a || !b) return 0; const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

// ---------------------------------------------------------------------------------------------------------------- the page side
const SAMPLER = () => {
  const S = (window.__s = { cls: 0 })
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) S.cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* none */ }
}
// the stubs a scenario asks for: a share sheet, a clipboard that works or refuses (Linux Chromium has no navigator.share)
const STUBS = ([share, clip]) => {
  window.__shared = []; window.__copied = []
  if (share) Object.defineProperty(navigator, 'share', { value: (d) => { window.__shared.push(d); return Promise.resolve() }, configurable: true })
  if (clip === 'ok') Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve() } }, configurable: true })
  if (clip === 'fail') { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); document.execCommand = () => false }
}

const FACTS = () => {
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)]
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
  const root = document.documentElement
  const count = (t) => (String(t).match(/\u2060/g) || []).length
  // the visible lines of an element's text: its characters grouped by the top of their client rect (the joiner has no box and is skipped)
  const lines = (el) => {
    const w = document.createTreeWalker(el, 4, null), rows = []
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (let i = 0; i < n.nodeValue.length; i++) {
        const ch = n.nodeValue[i]
        if (ch === '\u2060') continue
        const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1)
        const b = rg.getBoundingClientRect()
        if (!b.width && ch !== ' ') continue
        const y = Math.round(b.top)
        let row = rows.find((x) => Math.abs(x.y - y) < 6); if (!row) { row = { y, t: '' }; rows.push(row) }
        row.t += ch === '\u00a0' ? ' ' : ch
      }
    }
    return rows.sort((a, b) => a.y - b.y).map((x) => x.t.trim()).filter(Boolean)
  }
  const title = q('.catalog-product-title'), plate = q('.campaign-brand-plate'), ul = q('.catalog-product-reassurance'), box = q('.sporta-pact')
  const cap = plate && plate.querySelector('.campaign-brand-plate__authentic, .campaign-brand-plate__detail')
  const wa = q('[data-sporta-pact="ask"]'), sh = q('[data-sporta-pact="share"]'), live = q('.sporta-pact__live')
  const btn = (e) => { if (!e) return null; const cs = getComputedStyle(e), ic = e.querySelector('.sporta-pact__icon'), ics = ic && getComputedStyle(ic); const lab = e.querySelector('.sporta-pact__label'); return { tag: e.tagName.toLowerCase(), rect: r(e), text: lab ? lab.textContent : '', aria: e.getAttribute('aria-label'), href: e.getAttribute('href'), target: e.getAttribute('target'), rel: e.getAttribute('rel'), color: cs.color, bg: cs.backgroundColor, bw: cs.borderTopWidth, bc: cs.borderTopColor, radius: cs.borderTopLeftRadius, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, icon: ic && { cls: ic.className, mask: ics.webkitMaskImage || ics.maskImage || '', w: ic.getBoundingClientRect().width, h: ic.getBoundingClientRect().height, bg: ics.backgroundColor, hidden: ic.getAttribute('aria-hidden') } } }
  const footerWa = qa('footer a[href*="wa.me/"]').map((a) => a.getAttribute('href'))
  const sold = q('.catalog-related .product-grid-card:has(.catalog-card-image a > span.absolute.inset-x-0[class*="bg-ink"]) .catalog-card-info .price-card')
  const soldCard = sold && sold.closest('.product-grid-card')
  const prices = (e) => e && { color: getComputedStyle(e).color, bg: getComputedStyle(soldCard).backgroundColor }
  const metaD = q('meta[name="description"]')
  const canon = q('link[rel="canonical"]')
  return {
    path: location.pathname + location.search, lang: root.lang, dir: root.dir, scrollX: root.scrollWidth - root.clientWidth, cls: (window.__s || {}).cls || 0,
    rem: parseFloat(getComputedStyle(root).fontSize),   // the page's root size scales with the viewport (16.8px at 1280), so sizes are read in rem
    sy: window.scrollY,                                  // a click scrolls the button into view: positions are compared on the document, not the screen
    title: title && { text: title.textContent, joiners: count(title.textContent), attr: title.getAttribute('title'), lines: lines(title), rect: r(title) },
    cards: qa('.catalog-card-name').map((n) => ({ text: n.textContent, joiners: count(n.textContent), lines: lines(n) })),
    meta: metaD ? metaD.getAttribute('content') : null, canon: canon ? canon.getAttribute('href') : null,
    plate: plate && { rect: r(plate), maker: !!plate.querySelector('.campaign-brand-plate__maker:not([data-sporta-ownbrand])'), cap: cap && (() => { const cs = getComputedStyle(cap); return { bt: cs.borderTopWidth, pt: cs.paddingTop, rect: r(cap), text: cap.textContent.trim() } })() },
    footerWa,
    pact: box && {
      count: qa('.sporta-pact').length, afterUl: !!ul && box.previousElementSibling === ul, inSummary: !!box.parentElement && box.parentElement.classList.contains('catalog-product-summary'),
      role: box.getAttribute('role'), aria: box.getAttribute('aria-label'), rect: r(box), display: getComputedStyle(box).display, ulRect: r(ul),
      kids: [...box.children].map((c) => c.getAttribute('data-sporta-pact') || c.className),
      wa: btn(wa), share: btn(sh), live: live ? live.textContent : null, liveRole: live ? live.getAttribute('role') : null,
      relatedFirst: (() => { const a = q('.catalog-related a'); return a ? !!(box.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) : null })(),
    },
    sold: prices(sold),
    shared: window.__shared || [], copied: window.__copied || [],
  }
}

// ---------------------------------------------------------------------------------------------------------------- opening a page
const open = async (srv, { path = `/product/${SLUG}`, lang = 'en', w = 390, h = 844, theme = 'light', stubs = [false, null], waitFor = '.catalog-product-title' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lang', l); localStorage.setItem('sporta_theme', t); localStorage.setItem('sporta_theme_explicit', '1') } catch (e) { /* no storage */ } }, [lang, theme])
  await ctx.addInitScript(SAMPLER)
  await ctx.addInitScript(STUBS, stubs)
  await ctx.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }))
  const p = await ctx.newPage(); const errs = []
  p.setDefaultTimeout(12000)
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(srv.base + path, { waitUntil: 'load' })
  await p.waitForSelector(waitFor, { timeout: 20000 }).catch(() => {})
  await p.waitForTimeout(1300)
  return { ctx, p, errs }
}
// one flow = one page: what it measured is kept even when a step cannot finish; `error` says which
const flowOnce = (body, opts, o) => withServer(opts, async (srv) => {
  const f = { errs: [] }
  try { await Promise.race([body(srv, f, o), limit(90000, 'the flow')]) } catch (e) { f.error = String((e && e.message) || e).split('\n')[0] + (f.step ? ` [step: ${f.step}]` : '') }
  if (f.t) { f.errs = f.t.errs; await closeQuietly(f.t.ctx); delete f.t }
  return f
})
// a flow that could not finish is run once more (a loaded machine is the usual reason); a broken rule fails both times
const flow = (body) => async (opts, o = {}) => { const f = await flowOnce(body, opts, o); return f.error ? flowOnce(body, opts, o) : f }
const snap = flow(async (srv, f, o) => { const t = (f.t = await open(srv, o)); f.m = await t.p.evaluate(FACTS); if (o.print) { await t.p.emulateMedia({ media: 'print' }); f.printed = await t.p.evaluate(() => { const b = document.querySelector('.sporta-pact'); return b ? getComputedStyle(b).display : 'absent' }) } })
const cache = new Map()
const real = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, snap({}, o)); return cache.get(k) }

// ---------------------------------------------------------------------------------------------------------------- the checks
const CHECK = {
  // TITLE
  titleWhole: (m) => m.title.lines.length >= 1 && m.title.lines.every((l) => !/-$/.test(l)) && m.title.lines.join(' ').replace(/\s+/g, ' ') === NAME,
  titleText: (m) => m.title.joiners === 1 && m.title.attr === NAME && m.title.text.replace(/[\u2060]/g, '').replace(/\u00a0/g, ' ') === NAME,
  cardsWhole: (m) => m.cards.length >= 4 && m.cards.every((c) => c.lines.every((l) => !/-$/.test(l))) && m.cards.some((c) => c.joiners > 0),
  metaClean: (m) => typeof m.meta === 'string' && m.meta.length > 10 && !/[\u00a0\u2060]/.test(m.meta),
  // PLATE
  plateBare: (m) => m.plate && !m.plate.maker && m.plate.cap.bt === '0px' && m.plate.cap.pt === '0px' && Math.abs((m.plate.cap.rect.t - m.plate.rect.t) - (m.plate.rect.b - m.plate.cap.rect.b)) <= 3,
  plateMaker: (m) => m.plate && m.plate.maker && m.plate.cap.bt === '1px' && parseFloat(m.plate.cap.pt) >= 8,
  // ACTIONS
  placed: (m) => !!m.pact && m.pact.count === 1 && m.pact.afterUl && m.pact.inSummary && m.pact.role === 'group' && m.pact.display === 'flex' && m.pact.relatedFirst === true,
  controls: (m) => m.pact.kids.join() === 'ask,share,sporta-pact__live' && m.pact.wa.tag === 'a' && m.pact.share.tag === 'button' && [m.pact.wa, m.pact.share].every((b) => b.rect.h >= 43.5 && b.rect.w >= 43.5),
  inside: (m) => [m.pact.wa, m.pact.share].every((b) => b.rect.l >= m.pact.rect.l - 1 && b.rect.r <= m.pact.rect.r + 1) && m.scrollX <= 0,
  oneLine: (m) => Math.abs(m.pact.wa.rect.t - m.pact.share.rect.t) <= 2 && (m.pact.wa.rect.r <= m.pact.share.rect.l + 1 || m.pact.share.rect.r <= m.pact.wa.rect.l + 1),
  stacked: (m) => m.pact.share.rect.t >= m.pact.wa.rect.b - 1 && Math.abs(m.pact.wa.rect.w - m.pact.share.rect.w) <= 2,
  // whichever way a width lays the row out, no label wraps inside its button (one line of text: the button stays 2.75rem high)
  labelsOne: (m) => [m.pact.wa, m.pact.share].every((b) => b.rect.h <= m.rem * 2.75 + 2),
  layout: (m) => (CHECK.oneLine(m) || CHECK.stacked(m)) && CHECK.inside(m) && CHECK.labelsOne(m),
  label: (m, l) => m.pact.wa.text === T[l].ask && m.pact.wa.aria === T[l].askAria && m.pact.aria === T[l].group,
  shareLabel: (m, l, can) => m.pact.share.text === (can ? T[l].share : T[l].copy) && m.pact.share.icon.cls.includes(can ? '--share' : '--link'),
  link: (m, l) => {
    const num = (m.footerWa[0] || '').replace(/^https:\/\/wa\.me\/\+?(\d+).*$/, '$1'), u = new URL(m.pact.wa.href), t = u.searchParams.get('text') || ''
    return /^\d{8,15}$/.test(num) && u.origin === 'https://wa.me' && u.pathname === '/' + num && m.pact.wa.target === '_blank' && m.pact.wa.rel === 'noopener noreferrer' &&
      m.canon === CANON(l) && t === T[l].msg + ' ' + (l === 'en' ? NAME : NAME_AR) + '\n' + CANON(l)
  },
  icons: (m) => [m.pact.wa, m.pact.share].every((b) => b.icon && /url\(/.test(b.icon.mask) && Math.abs(b.icon.w / m.rem - 1.25) <= 0.02 && Math.abs(b.icon.h / m.rem - 1.25) <= 0.02 && b.icon.hidden === 'true' && b.icon.bg !== 'rgba(0, 0, 0, 0)'),
  // The ask button is the twin of the Back control; the Share button is the owner's black variant (SHARE 1122): black ground, white ink.
  look: (m) => [m.pact.wa].every((b) => b.color === 'rgb(23, 26, 30)' && b.bw === '1px' && b.bc === 'rgba(23, 26, 30, 0.2)' && Math.abs(parseFloat(b.radius) - 0.75 * m.rem) <= 1.2) && m.pact.share.bg === 'rgb(0, 0, 0)' && m.pact.share.color === 'rgb(255, 255, 255)' && Math.abs(parseFloat(m.pact.share.radius) - 0.75 * m.rem) <= 1.2,
  darkLook: (m) => [m.pact.wa, m.pact.share].every((b) => b.color === 'rgb(232, 234, 237)' && b.bc === 'rgba(255, 255, 255, 0.12)') && ratio(m.pact.wa.color, 'rgb(23, 26, 30)') >= 4.5,
  printed: (f) => f.printed === 'none',
  quiet: (m, errs) => m.scrollX <= 0 && errs.length === 0,
  noTail: (m) => CHECK.link(m, 'en') && !/utm_source|fbclid/.test(decodeURIComponent(m.pact.wa.href)),
  // CARDS
  soldLight: (m) => !!m.sold && ratio(m.sold.color, m.sold.bg) >= 4.5,
  soldDark: (m) => !!m.sold && ratio(m.sold.color, m.sold.bg) >= 4.5,
}

// ============================================================================================================ 1. the title
head('the title: a hyphenated word keeps its line')
for (const w of [320, 360, 390, 768, 1280]) {
  const f = await real({ w, lang: 'en' }), m = f.m, tag = `en ${w}px`
  if (f.error) note(`${tag}: ${f.error}`)
  is(holds(CHECK.titleWhole, m), `${tag}: "T-Shirt" is never split at its hyphen (lines: ${m && m.title ? JSON.stringify(m.title.lines) : '?'})`, JSON.stringify(m && m.title && m.title.lines))
}
{
  const f = await real({ w: 390, lang: 'en' }), m = f.m
  is(holds(CHECK.titleText, m), 'the name reads as the data has it: one word joiner (U+2060) after the hyphen, a title tooltip without it, the dash glue as before', JSON.stringify(m && m.title && [m.title.joiners, m.title.attr]))
  is(holds(CHECK.cardsWhole, m), 'card names too: no line of any card name ends at a hyphen, and a card name carries the joiner', JSON.stringify(m && m.cards.map((c) => c.lines)))
  is(holds(CHECK.metaClean, m), 'the page description fallback reads the name without the line-glue characters', JSON.stringify(m && m.meta))
  const ar = await real({ w: 390, lang: 'ar' })
  is(holds((x) => x.title.joiners === 0 && x.title.attr === NAME_AR, ar.m), 'Arabic: no joiner, the name and its tooltip as before', JSON.stringify(ar.m && ar.m.title && [ar.m.title.joiners, ar.m.title.attr]))
}
const stableFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)); f.a = await t.p.evaluate(FACTS)
  await t.p.waitForTimeout(900); f.b = await t.p.evaluate(FACTS)
})
{
  const f = await stableFlow({}, { w: 390, lang: 'en' })
  is(holds((x) => x.a.title.joiners === 1 && x.b.title.joiners === 1 && x.a.title.text === x.b.title.text, f), 'a second pass changes nothing: one joiner now and 0.9 s later, the text identical', f.error || JSON.stringify([f.a && f.a.title.joiners, f.b && f.b.title.joiners]))
}
const spaTitle = flow(async (srv, f, o) => {
  f.step = 'open the shop'
  const t = (f.t = await open(srv, { path: '/shop', lang: 'en', w: o.w, waitFor: 'a[href="/product/cheetahs-rugby-t-shirt"]' })), p = t.p
  f.step = 'shop -> Cheetahs'
  await p.locator('a[href="/product/cheetahs-rugby-t-shirt"]').first().click()
  await p.waitForURL(/cheetahs-rugby-t-shirt/); await p.waitForSelector('.catalog-product-title'); await p.waitForTimeout(900)
  f.m = await p.evaluate(FACTS)
})
for (const w of [390, 1280]) {
  const f = await spaTitle({}, { w })
  is(holds((x) => x.m.title.joiners === 1 && x.m.title.lines.every((l) => !/-$/.test(l)) && x.m.title.attr === 'Cheetahs Rugby T-Shirt', f), `en ${w}px: a product opened from the shop (the router, no page load) gets the same name pass`, f.error || JSON.stringify(f.m && f.m.title))
}

// a long code keeps breaking at its hyphens (a word that cannot break is wider than a phone's card); short compounds are kept whole
const codeFlow = flow(async (srv, f, o) => { const t = (f.t = await open(srv, o)); f.m = await t.p.evaluate(FACTS) })
const withNames = (names) => ({ api: { products: (body) => body.map((p) => (names[p.slug] ? { ...p, ...names[p.slug] } : p)) } })
const CODES = {
  long: 'AIRMAX-90-ULTRA-LONGCODE-0001 — Blue',          // one word of 29 characters
  two: 'Quick-Dry Half-Zip — Navy',                       // two short compounds
  edge: 'Moisture-Wicks Tee',                                  // a compound of exactly 14 characters: kept
  over: 'Moisture-Wicking Tee',                                // 16 characters: left to break at its hyphen
}
for (const [kind, w] of [['long', 320], ['long', 390], ['two', 320], ['edge', 390], ['over', 390]]) {
  const f = await codeFlow(withNames({ [SLUG]: { name_en: CODES[kind] } }), { w, lang: 'en' }), m = f.m
  const j = { long: 0, two: 2, edge: 1, over: 0 }[kind]
  is(holds((x) => x.title.joiners === j && x.scrollX <= 0 && x.title.rect.r <= w + 1 && x.title.lines.every((l) => !/-$/.test(l) || kind === 'long' || kind === 'over'), m), `en ${w}px: "${CODES[kind]}" carries ${j} joiner${j === 1 ? '' : 's'}, fits the screen${kind === 'long' || kind === 'over' ? ' and breaks at its hyphens as before' : ' and never ends a line at a hyphen'}`, f.error || JSON.stringify(m && m.title && [m.title.joiners, m.title.lines, m.title.rect, m.scrollX]))
}

// ============================================================================================================ 2. the plate
head('the authenticity plate')
{
  const f = await real({ w: 390, lang: 'en' }), m = f.m
  is(holds(CHECK.plateBare, m), 'no maker of its own: no divider and no padding above the caption, the caption centred in its box', JSON.stringify(m && m.plate && [m.plate.cap.bt, m.plate.cap.pt, m.plate.rect.h]))
  const g = await real({ w: 390, lang: 'en', path: `/product/${BRAND}` })
  is(holds(CHECK.plateMaker, g.m), 'a maker (Vanquish): its logo row and the divider under it stay', JSON.stringify(g.m && g.m.plate && [g.m.plate.maker, g.m.plate.cap.bt, g.m.plate.cap.pt]))
  const a = await real({ w: 1280, lang: 'ar' })
  is(holds(CHECK.plateBare, a.m), 'Arabic at 1280px: the same', JSON.stringify(a.m && a.m.plate && [a.m.plate.cap.bt, a.m.plate.cap.pt]))
}

// ============================================================================================================ 3. the actions
head('the actions: ask on WhatsApp, share')
for (const [w, lang] of [[390, 'en'], [390, 'ar'], [360, 'en'], [360, 'ar'], [768, 'en'], [1280, 'en'], [1280, 'ar']]) {
  const f = await real({ w, lang }), m = f.m, tag = `${lang} ${w}px`
  if (f.error) note(`${tag}: ${f.error}`)
  is(holds(CHECK.placed, m), `${tag}: one row, right after the reassurance panel, inside the summary column, before the related products`, JSON.stringify(m && m.pact && [m.pact.count, m.pact.afterUl, m.pact.inSummary, m.pact.role]))
  is(holds(CHECK.controls, m), `${tag}: an ask link and a share button, both at least 44px each way`, JSON.stringify(m && m.pact && [m.pact.kids, m.pact.wa && m.pact.wa.rect, m.pact.share && m.pact.share.rect]))
  is(holds(CHECK.layout, m), `${tag}: the two sit inside the row, no label wrapped, nothing scrolls sideways`, JSON.stringify(m && m.pact && [m.pact.rect, m.pact.wa.rect, m.pact.share.rect]))
  is(holds(CHECK.oneLine, m), `${tag}: ...on one line, not stacked`, JSON.stringify(m && m.pact && [m.pact.wa.rect, m.pact.share.rect]))
  is(holds(CHECK.label, m, lang), `${tag}: the words are the page's language ("${T[lang].ask}": visible label, accessible name, group name)`, JSON.stringify(m && m.pact && [m.pact.wa.text, m.pact.wa.aria, m.pact.aria]))
  is(holds(CHECK.shareLabel, m, lang, false), `${tag}: no share sheet in this browser, so the button says "${T[lang].copy}" with the link icon`, JSON.stringify(m && m.pact && m.pact.share && [m.pact.share.text, m.pact.share.icon.cls]))
  is(holds(CHECK.link, m, lang), `${tag}: the ask link is wa.me/<the footer's number> with a message that names the product and ends with its canonical address`, JSON.stringify(m && m.pact && [m.pact.wa.href, m.footerWa, m.canon]))
  is(holds(CHECK.icons, m), `${tag}: 1.25rem line icons drawn in the text colour, hidden from readers`, JSON.stringify(m && m.pact && [m.rem, m.pact.wa.icon && m.pact.wa.icon.w, m.pact.share.icon && m.pact.share.icon.w]))
  is(holds(CHECK.look, m), `${tag}: the Back control's twins: ink text, a 1px line at 20% ink, the 12px control corner`, JSON.stringify(m && m.pact && { wa: [m.pact.wa.color, m.pact.wa.bw, m.pact.wa.bc, m.pact.wa.radius], share: m.pact.share && [m.pact.share.bg, m.pact.share.color, m.pact.share.bw, m.pact.share.bc, m.pact.share.radius], rem: m.rem }))
  is(holds(CHECK.quiet, m, f.errs), `${tag}: no page error`, JSON.stringify(f.errs))
}
for (const lang of ['en', 'ar']) {
  const f = await real({ w: 320, lang })
  is(holds(CHECK.layout, f.m) && holds(CHECK.controls, f.m), `${lang} 320px: one line or, too narrow for that, stacked at one width; no label wrapped, nothing clipped or scrolling`, JSON.stringify(f.m && f.m.pact && [f.m.pact.rect, f.m.pact.wa.rect, f.m.pact.share.rect]))
}
{
  const d = await real({ w: 390, lang: 'en', theme: 'dark' })
  is(holds(CHECK.darkLook, d.m), 'the dark theme: light ink, the 12% white line, 4.5:1 on the page', JSON.stringify(d.m && d.m.pact && [d.m.pact.wa.color, d.m.pact.wa.bc]))
  const p = await real({ w: 390, lang: 'en', print: true })
  is(holds(CHECK.printed, p), 'printing a product page does not print the actions', String(p.printed))
  const s = await real({ w: 390, lang: 'en', stubs: [true, 'ok'] })
  is(holds(CHECK.shareLabel, s.m, 'en', true), 'a browser with a share sheet: the button says "Share" with the share icon', JSON.stringify(s.m && s.m.pact && s.m.pact.share && [s.m.pact.share.text, s.m.pact.share.icon.cls]))
  const cls = await real({ w: 390, lang: 'en' })
  is(cls.m && cls.m.cls < 0.001, `the row arrives without a layout shift (${cls.m && cls.m.cls})`, String(cls.m && cls.m.cls))
  for (const lang of ['en', 'ar']) {
    const o = await real({ w: 390, lang, path: `/product/${SOLD}` })
    is(holds((m) => CHECK.placed(m) && CHECK.controls(m) && CHECK.layout(m) && CHECK.label(m, lang), o.m), `${lang}: a sold-out product keeps the row (a question about a restock is the likeliest one)`, o.error || JSON.stringify(o.m && o.m.pact && o.m.pact.kids))
  }
  const t = await real({ w: 390, lang: 'en', path: TAIL })
  is(holds(CHECK.noTail, t.m), 'a visitor from an ad (utm_source / fbclid in the address bar): the message carries the clean canonical address, not the tail', JSON.stringify(t.m && [t.m.path, t.m.canon, t.m.pact && decodeURIComponent(t.m.pact.wa.href).slice(-120)]))
}

// ------------------------------------------------ what a press does
const pressFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p
  f.before = await p.evaluate(FACTS)
  f.step = 'press the share button'
  await p.locator('[data-sporta-pact="share"]').click(); await p.waitForTimeout(350)
  f.after = await p.evaluate(FACTS)
  await p.waitForTimeout(2800)
  f.later = await p.evaluate(FACTS)
})
// the row has not moved or changed size, and neither button has moved inside it or changed width (the words swap, the boxes stay)
const still = (a, b) => {
  const inRow = (m, r) => ({ t: r.t - m.pact.rect.t, l: r.l - m.pact.rect.l, w: r.w, h: r.h })
  const same = (x, y) => ['t', 'l', 'w', 'h'].every((k) => Math.abs(x[k] - y[k]) <= 1)
  return Math.abs((a.pact.rect.t + a.sy) - (b.pact.rect.t + b.sy)) <= 1 && Math.abs(a.pact.rect.h - b.pact.rect.h) <= 1 && Math.abs(a.pact.rect.w - b.pact.rect.w) <= 1 &&
    same(inRow(a, a.pact.wa.rect), inRow(b, b.pact.wa.rect)) && same(inRow(a, a.pact.share.rect), inRow(b, b.pact.share.rect))
}
{
  const f = await pressFlow({}, { w: 390, lang: 'en', stubs: [false, 'ok'], path: TAIL })
  is(holds((x) => x.after.copied.length === 1 && x.after.copied[0] === CANON('en') && x.after.shared.length === 0, f), 'Copy link puts the canonical address (not the address bar, which carries a tracking tail here) on the clipboard, once', f.error || JSON.stringify(f.after && f.after.copied))
  is(holds((x) => x.after.pact.share.text === T.en.copied && x.after.pact.live === T.en.copied && x.after.pact.liveRole === 'status', f), 'and says so: in the button and in a polite live region', f.error || JSON.stringify(f.after && [f.after.pact.share.text, f.after.pact.live]))
  is(holds((x) => x.later.pact.share.text === T.en.copy && x.later.pact.live === '' && x.later.pact.share.icon.cls.includes('--link'), f), 'about 2.6 s later the button and the live region are back to rest', f.error || JSON.stringify(f.later && [f.later.pact.share.text, f.later.pact.live]))
  is(holds((x) => still(x.before, x.after) && still(x.before, x.later), f), 'the confirmation moves nothing: the row keeps its place and size, and each button its place and width inside it (the words swap, the boxes stay)', f.error || JSON.stringify(f.before && f.after && [f.before.sy, f.after.sy, f.before.pact.rect, f.after.pact.rect, f.before.pact.share.rect, f.after.pact.share.rect, f.before.pact.wa.rect, f.after.pact.wa.rect]))
}
{
  const f = await pressFlow({}, { w: 390, lang: 'ar', stubs: [false, 'ok'] })
  is(holds((x) => x.after.pact.share.text === T.ar.copied && x.later.pact.share.text === T.ar.copy && still(x.before, x.after), f), `Arabic: "${T.ar.copied}", then back to "${T.ar.copy}", and nothing moves`, f.error || JSON.stringify(f.after && f.after.pact.share.text))
}
{
  const f = await pressFlow({}, { w: 390, lang: 'en', stubs: [false, 'fail'] })
  is(holds((x) => x.after.pact.share.text === T.en.failed && x.after.pact.live === T.en.failed && still(x.before, x.after), f), 'a clipboard that refuses (and no legacy copy): the button says the copy failed, and nothing moves', f.error || JSON.stringify(f.after && f.after.pact.share.text))
}
{
  // a folded phone's cover screen (344px): the two buttons are on the edge of fitting one line; the confirmation must not tip them over
  const f = await pressFlow({}, { w: 344, lang: 'en', stubs: [false, 'ok'] })
  is(holds((x) => x.after.pact.share.text === T.en.copied && CHECK.layout(x.before) && CHECK.layout(x.after) && still(x.before, x.after) && still(x.before, x.later), f), 'a 344px screen (a folded phone): whether the two sit on one line or stack, the confirmation changes neither', f.error || JSON.stringify(f.before && f.after && [f.before.pact.rect, f.after.pact.rect, f.before.pact.share.rect, f.after.pact.share.rect]))
}
{
  const f = await pressFlow({}, { w: 390, lang: 'en', stubs: [true, 'ok'], path: TAIL })
  is(holds((x) => x.after.shared.length === 1 && x.after.shared[0].url === CANON('en') && x.after.shared[0].title === NAME && x.after.copied.length === 0, f), 'with a share sheet: navigator.share gets the name and the canonical address, nothing is copied', f.error || JSON.stringify(f.after && f.after.shared))
  is(holds((x) => x.after.pact.share.text === T.en.share && x.after.pact.live === '', f), 'and the button stays "Share" (the sheet is the confirmation)', f.error || '')
}

// ------------------------------------------------ the number follows the footer
const footerFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p
  f.one = await p.evaluate(FACTS)
  await p.evaluate(() => { const a = document.querySelector('footer a[href*="wa.me/"]'); a.setAttribute('href', 'https://wa.me/96599998888') }); await p.waitForTimeout(500)
  f.two = await p.evaluate(FACTS)
  await p.evaluate(() => { for (const a of document.querySelectorAll('a[href*="wa.me/"]')) if (!a.closest('.sporta-pact')) a.setAttribute('href', 'https://example.com/x') }); await p.waitForTimeout(500)
  f.none = await p.evaluate(FACTS)
  await p.evaluate(() => { for (const a of document.querySelectorAll('footer a[href="https://example.com/x"]')) a.setAttribute('href', 'https://wa.me/96511112222') }); await p.waitForTimeout(500)
  f.back = await p.evaluate(FACTS)
})
{
  const f = await footerFlow({}, { w: 390, lang: 'en' })
  is(holds((x) => x.one.pact.wa.href.startsWith('https://wa.me/' + x.one.footerWa[0].replace(/^https:\/\/wa\.me\/\+?(\d+).*$/, '$1') + '?text='), f), 'the number is the footer link\'s', f.error || JSON.stringify(f.one && [f.one.pact.wa.href.slice(0, 40), f.one.footerWa]))
  is(holds((x) => x.two.pact.wa.href.startsWith('https://wa.me/96599998888?text='), f), 'the owner changes the number (the site content block rewrites the footer link): the ask link follows at once', f.error || JSON.stringify(f.two && f.two.pact.wa.href.slice(0, 40)))
  is(holds((x) => x.none.pact.kids.join() === 'share,sporta-pact__live' && x.none.pact.share.rect.w >= x.none.pact.rect.w - 2, f), 'no WhatsApp link on the page: no ask action, and Share takes the whole row', f.error || JSON.stringify(f.none && f.none.pact.kids))
  is(holds((x) => x.back.pact.kids.join() === 'ask,share,sporta-pact__live' && x.back.pact.wa.href.startsWith('https://wa.me/96511112222?text='), f), 'a number again: the ask action is back, first, with the new number', f.error || JSON.stringify(f.back && f.back.pact.kids))
}

// ------------------------------------------------ the router, the language switch, the keyboard
const routeFlow = flow(async (srv, f, o) => {
  f.step = 'open the shop'
  const t = (f.t = await open(srv, { path: '/shop', lang: 'en', w: o.w, stubs: [false, 'ok'], waitFor: 'a[href^="/product/"]' })), p = t.p
  f.shop = await p.evaluate(FACTS)
  f.step = 'shop -> product'
  await p.locator('a[href^="/product/"]').first().click()
  await p.waitForURL(/\/product\//); await p.waitForSelector('.sporta-pact'); await p.waitForTimeout(600)
  const firstPath = new URL(p.url()).pathname
  f.first = await p.evaluate(FACTS)
  f.step = 'product -> related product'
  const rel = p.locator('.catalog-related a[href^="/product/"]').first(), href = await rel.getAttribute('href')
  await rel.click(); await p.waitForFunction((h) => location.pathname === h, href); await p.waitForTimeout(900)
  f.second = await p.evaluate(FACTS)
  f.step = 'share on the related product'
  await p.locator('[data-sporta-pact="share"]').click(); await p.waitForTimeout(350)
  f.copied = await p.evaluate(() => window.__copied.slice())
  f.step = 'related -> Back'
  await p.click('a[data-sporta-back]'); await p.waitForFunction((h) => location.pathname === h, firstPath); await p.waitForTimeout(700)
  f.third = await p.evaluate(FACTS)
  f.step = 'product -> Back to the shop'
  await p.click('a[data-sporta-back]'); await p.waitForURL(/\/shop/); await p.waitForTimeout(700)
  f.out = await p.evaluate(FACTS)
  f.step = ''
})
const plain = (s) => String(s || '').replace(/[\u2060]/g, '').replace(/\u00a0/g, ' ')
const SPA = {
  update: (f) => f.first.pact.count === 1 && f.second.pact.count === 1 && f.first.pact.wa.href !== f.second.pact.wa.href && f.second.canon !== f.first.canon &&
    decodeURIComponent(f.second.pact.wa.href).includes(plain(f.second.title.text)) && decodeURIComponent(f.second.pact.wa.href).endsWith('\n' + f.second.canon),
  share: (f) => f.copied.length === 1 && f.copied[0] === f.second.canon,
  back: (f) => f.third.pact.count === 1 && decodeURIComponent(f.third.pact.wa.href).endsWith('\n' + f.first.canon),
  gone: (f) => !f.shop.pact && !f.out.pact && f.out.path.startsWith('/shop'),
}
for (const w of [390, 1280]) {
  const f = await routeFlow({}, { w })
  is(holds(SPA.update, f), `en ${w}px: a related product opened by the router (React reuses the page): the row shows ITS name and ITS address, still one row`, f.error || JSON.stringify([f.first && f.first.canon, f.second && f.second.canon]))
  is(holds(SPA.share, f), `en ${w}px: and Copy link on it copies ITS address`, f.error || JSON.stringify([f.copied, f.second && f.second.canon]))
  is(holds(SPA.back, f), `en ${w}px: Back to the first product: its name and address again`, f.error || '')
  is(holds(SPA.gone, f), `en ${w}px: no row on the shop, before or after`, f.error || JSON.stringify([f.shop && !!f.shop.pact, f.out && !!f.out.pact]))
}
const langFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p
  f.en = await p.evaluate(FACTS)
  f.step = 'switch the language'
  await p.evaluate(() => document.querySelector('.app-header .navbar-language').click()); await p.waitForTimeout(1100)
  f.ar = await p.evaluate(FACTS)
})
{
  const f = await langFlow({}, { w: 390, lang: 'en' })
  is(holds((x) => x.ar.lang === 'ar' && CHECK.label(x.ar, 'ar') && CHECK.link(x.ar, 'ar') && x.ar.pact.count === 1, f), 'switching the language (React renders the page again): the labels and the message turn Arabic, one row', f.error || JSON.stringify(f.ar && [f.ar.lang, f.ar.pact && f.ar.pact.wa.text]))
}
const kbdFlow = flow(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p
  f.stops = []
  for (let i = 0; i < 90; i++) {
    await p.keyboard.press('Tab')
    const s = await p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); return { pact: a.getAttribute('data-sporta-pact'), related: !!a.closest('.catalog-related'), name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor } })
    if (s) f.stops.push(s)
    if (s && s.related) break
  }
})
{
  const f = await kbdFlow({}, { w: 1280, lang: 'en' })
  const ia = (f.stops || []).findIndex((s) => s.pact === 'ask'), ib = (f.stops || []).findIndex((s) => s.pact === 'share'), ir = (f.stops || []).findIndex((s) => s.related)
  is(ia > 0 && ib === ia + 1 && ir > ib, 'keyboard: the ask link, then Share, then (later) the related products, in that order', f.error || JSON.stringify((f.stops || []).slice(-5).map((s) => s.pact || s.name)))
  is(holds((x) => x.stops[ia].outline === 'solid 2px rgb(179, 77, 0)' && x.stops[ib].outline === 'solid 2px rgb(179, 77, 0)', f), 'and each stop shows the 2px deep-orange ring (the brand rule for light grounds)', f.error || JSON.stringify([f.stops[ia] && f.stops[ia].outline, f.stops[ib] && f.stops[ib].outline]))
}

// ============================================================================================================ 4. the related cards in the dark theme
head('a sold-out related card, light and dark')
{
  const l = await real({ w: 390, lang: 'en' }), d = await real({ w: 390, lang: 'en', theme: 'dark' }), da = await real({ w: 1280, lang: 'ar', theme: 'dark' })
  is(holds(CHECK.soldLight, l.m), 'light: the sold-out price is the neutral grey at 4.5:1 or more on the white card', JSON.stringify(l.m && l.m.sold) + ' ' + (l.m && l.m.sold ? ratio(l.m.sold.color, l.m.sold.bg).toFixed(2) : ''))
  is(holds(CHECK.soldDark, d.m), `dark: the same price reads 4.5:1 or more on the dark card (it was 2.75:1; now ${d.m && d.m.sold ? ratio(d.m.sold.color, d.m.sold.bg).toFixed(2) : '?'})`, JSON.stringify(d.m && d.m.sold))
  is(holds(CHECK.soldDark, da.m), 'dark, Arabic, 1280px: the same', JSON.stringify(da.m && da.m.sold))
}

// ============================================================================================================ 5. mutants
head('mutants: with one rule cut, the matching check fails')
const sub = (text, from, to) => (text.includes(from) ? text.replace(from, to) : text)
const cutFrom = (css, a, b) => { const i = css.indexOf(a); if (i < 0) return css; const j = css.indexOf(b, i); return css.slice(0, i) + (j < 0 ? '' : css.slice(j)) }
const cssM = (css, a, b) => ({ css: { [CSS_F]: cutFrom(css, a, b) }, changed: cutFrom(css, a, b) !== css })
// a cut in sporta-features.js is made INSIDE one block (the file holds other blocks with identical lines, e.g. "if (m) return m[1]") and must
// hit exactly one place in it: `changed` is false, and the check below says so, when the text is missing or occurs more than once there
const NAMES_B = ['/* ===== NAMES-1119: a line never starts', '/* ===== NAMES-1119 - end'], ACT_B = ['/* ===== PRODUCT ACTIONS 1120 (', '/* ===== PRODUCT ACTIONS 1120 - end']
const TIP_B = ['/* Product names: the full name as a tooltip', '\n})()'], META_B = ['/* ===== META-1117 - the description', '/* ===== META-1117 - end']
const featIn = ([a, b], from, to) => {
  const i = FEAT.indexOf(a), j = i < 0 ? -1 : FEAT.indexOf(b, i)
  if (i < 0 || j < 0) return { js: { [FEAT_F]: FEAT }, changed: false }
  const block = FEAT.slice(i, j)
  return { js: { [FEAT_F]: FEAT.slice(0, i) + block.replace(from, () => to) + FEAT.slice(j) }, changed: block.split(from).length === 2 }
}
const featM = (from, to) => featIn(ACT_B, from, to)
const shM = (from, to) => ({ css: { [SH_F]: sub(SH, from, to) }, changed: SH.split(from).length === 2 })
const asOpts = (m) => (m.css ? { css: m.css } : { js: m.js })
const codeLong = (opts, o) => codeFlow({ ...opts, ...withNames({ [SLUG]: { name_en: CODES.long } }) }, o)
// [label, the cut, the flow, its options, the check]
const MUT = [
  ['the word pass: no joiner after a hyphen', featIn(NAMES_B, "if (HAS_WORD.test(now)) now = now.replace(HYPH, function (w) { return w.length > WORD_MAX ? w : w.replace(/-/g, '-\\u2060') })", ''), snap, { w: 390, lang: 'en' }, (f) => CHECK.titleWhole(f.m) && CHECK.titleText(f.m)],
  ['the word pass has no length cap', featIn(NAMES_B, 'return w.length > WORD_MAX ? w : w.replace(', 'return w.replace('), codeLong, { w: 320, lang: 'en' }, (f) => f.m.title.joiners === 0 && f.m.scrollX <= 0],
  ['the tooltip keeps the joiner', featIn(TIP_B, "(list[i].textContent || '').replace(/\\u2060/g, '').replace(/\\s+/g, ' ').trim()", "(list[i].textContent || '').replace(/\\s+/g, ' ').trim()"), snap, { w: 390, lang: 'en' }, (f) => CHECK.titleText(f.m)],
  ['the description fallback keeps the glue', featIn(META_B, "(h1.textContent || '').replace(/\\u2060/g, '').replace(/\\u00a0/g, ' ').trim()", "(h1.textContent || '').trim()"), snap, { w: 390, lang: 'en' }, (f) => CHECK.metaClean(f.m)],
  ['[pux-1] the plate keeps its divider', cssM(CSS, '/* [pux-1]', '/* [pux-2]'), snap, { w: 390, lang: 'en' }, (f) => CHECK.plateBare(f.m)],
  ['[pux-2] no row layout', cssM(CSS, '/* [pux-2]', '/* [pux-3]'), snap, { w: 390, lang: 'en' }, (f) => CHECK.controls(f.m) && CHECK.oneLine(f.m) && CHECK.look(f.m)],
  ['[pux-3] no icons', cssM(CSS, '/* [pux-3]', '/* [pux-4]'), snap, { w: 390, lang: 'en' }, (f) => CHECK.icons(f.m)],
  ['[pux-4] the dark theme', cssM(CSS, '/* [pux-4]', '/* [pux-5]'), snap, { w: 390, lang: 'en', theme: 'dark' }, (f) => CHECK.darkLook(f.m)],
  ['[pux-5] print', cssM(CSS, '/* [pux-5]', '/* ==== end PRODUCT UX 1120'), snap, { w: 390, lang: 'en', print: true }, CHECK.printed],
  ['the dark sold-out price rule', shM('html[data-theme="dark"] .storefront-root .product-grid-card:has(.catalog-card-image a > span.absolute.inset-x-0[class*="bg-ink"]) .catalog-card-info .price-card {\n  color: #a8b3c0 !important;\n}\n', ''), snap, { w: 390, lang: 'en', theme: 'dark' }, (f) => CHECK.soldDark(f.m)],
  ['the block is off', featM('if (window.__sportaProductActions || location.pathname', 'if (true || location.pathname'), snap, { w: 390, lang: 'en' }, (f) => CHECK.placed(f.m)],
  ['the row is never placed', featM('if (list.nextSibling !== box) list.parentNode.insertBefore(box, list.nextSibling)', ''), snap, { w: 390, lang: 'en' }, (f) => CHECK.placed(f.m)],
  ['the number is typed, not read', featM('if (m) return m[1]', "if (m) return '96500000000'"), snap, { w: 390, lang: 'en' }, (f) => CHECK.link(f.m, 'en')],
  ['the message leaves the address out', featM("encodeURIComponent(t.msg + ' ' + name + '\\n' + url)", "encodeURIComponent(t.msg + ' ' + name)"), snap, { w: 390, lang: 'en' }, (f) => CHECK.link(f.m, 'en')],
  ['the message keeps the line-glue characters', featM("function clean(t) { return String(t || '').replace(/\\u2060/g, '')", "function clean(t) { return String(t || '')"), snap, { w: 390, lang: 'en' }, (f) => CHECK.link(f.m, 'en')],
  ['the address is the address bar\'s', featM("if (h && /^https:\\/\\/www\\.sporta\\.com\\.kw\\/product\\/[A-Za-z0-9_-]+(?:\\?lang=en)?$/.test(h)) return h", 'return location.href'), snap, { w: 390, lang: 'en', path: TAIL }, (f) => CHECK.noTail(f.m)],
  ['the ask link opens without noopener', featM("wa.setAttribute('rel', 'noopener noreferrer')", ''), snap, { w: 390, lang: 'en' }, (f) => CHECK.link(f.m, 'en')],
  ['the group has no name', featM("box.setAttribute('aria-label', t.group)", ''), snap, { w: 390, lang: 'en' }, (f) => CHECK.label(f.m, 'en')],
  ['the share sheet is never offered', featM("function canShare() { return typeof navigator.share === 'function' }", 'function canShare() { return false }'), snap, { w: 390, lang: 'en', stubs: [true, 'ok'] }, (f) => CHECK.shareLabel(f.m, 'en', true)],
  ['no observer wakes the row', featM('function soon() { if (queued) return; queued = true;', 'function soon() { return; queued = true;'), routeFlow, { w: 390 }, (f) => SPA.update(f)],
  ['the row is never updated for another product', featM('var key = [l, name, url, num, can ? 1 : 0]', "var key = ['k']"), routeFlow, { w: 390 }, (f) => SPA.update(f) && SPA.share(f)],
]
for (const [label, m, fl, o, check] of MUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found exactly once in its block (a cut must never land in another block)`); continue }
  const good = fl === snap ? await real(o) : await fl({}, o)
  is(holds(check, good), `mutant "${label}": the check passes on the real files`, good.error || '')
  is(!holds(check, await fl(asOpts(m), o)), `mutant "${label}": and goes red with it cut`)
}
// the behaviours that need a press: the copy path and the share path
const PMUT = [
  ['the copy handler does nothing', featM('copyText(S.url).then(function (ok) { say(ok ? t.copied : t.failed) })', ''), { w: 390, lang: 'en', stubs: [false, 'ok'] }, (f) => f.after.copied.length === 1 && f.after.pact.share.text === T.en.copied],
  ['the share handler does nothing', featM('var r = navigator.share({ title: S.name, text: window.__sportaShareText || S.name, url: S.url })', 'var r = null'), { w: 390, lang: 'en', stubs: [true, 'ok'] }, (f) => f.after.shared.length === 1],
  ['the confirmation never goes away', featM("flash = setTimeout(function () { flash = 0; live.textContent = ''; labels() }, 2600)", 'flash = 1'), { w: 390, lang: 'en', stubs: [false, 'ok'] }, (f) => f.later.pact.share.text === T.en.copy],
  ['[pux-2b] the confirmation width is not reserved', cssM(CSS, '/* [pux-2b]', '/* [pux-3]'), { w: 390, lang: 'en', stubs: [false, 'ok'] }, (f) => still(f.before, f.after) && still(f.before, f.later)],
  ['the legacy copy is gone', featM("var ok = !!(document.execCommand && document.execCommand('copy'))", 'var ok = true'), { w: 390, lang: 'en', stubs: [false, 'fail'] }, (f) => f.after.pact.share.text === T.en.failed],
]
for (const [label, m, o, check] of PMUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found exactly once in its block (a cut must never land in another block)`); continue }
  const good = await pressFlow({}, o)
  is(holds(check, good), `mutant "${label}": the check passes on the real files`, good.error || '')
  is(!holds(check, await pressFlow(asOpts(m), o)), `mutant "${label}": and goes red with it cut`)
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
