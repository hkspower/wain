// BACK 1120 (owner, 2026-11-19: "make product page without topbar and main menu, just add back button"):
//   a product page (/product/<slug>) has no header - no announcement bar, no logo row (clock, AI, language, bag), no menu tabs - and ONE
//   control stands at the top of it: Back. The marker and the control are made by public/boot.js (PRODUCT BACK 1120) before the first
//   paint; public/sporta-product-fix.css (BACK 1120) hides the header and the first-paint shell on that route and styles the control;
//   public/sporta-features.js puts the added-to-bag notice under the Back row.
//
//   npm run test:product-back     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled storefront (the capture) with the add-ons of this repo:
//   LAYOUT       ar + en, 390 / 768 / 1024 / 1280 / 1536 px: no header, topbar, logo row or menu tab is shown; ONE Back link (the first
//                element of <body>), 44px, 12px control shape, its word and its shop link in the page's language, the arrow mirrored
//                in Arabic, the first thing on the page, its start edge exactly the breadcrumb's start edge, the breadcrumb below it;
//                the photo column sticks 1.5rem from the top on a tablet and a desktop; the strip under an installed app's status bar
//                is ink; no sideways scroll, no page error. Dark theme: the heart's colours.
//   OTHER PAGES  /, /shop, /about, /contact, /catalogue keep their header and carry no Back control and no route marker.
//   FIRST PAINT  with the app delayed 0.9 s: the header and the shell (orange bar, logo bar, hero box) are never drawn on the route,
//                not for one frame, and the Back control is on screen before the app is.
//   NAVIGATION   shop -> product: the header goes in the same tick, Back is history.back() and the shop (header back, control hidden,
//                marker gone) returns; product -> related product -> Back is the first product; the browser's Back / Forward keep it in
//                step; a direct visit has nothing to go back to, so Back is the shop (with ?lang=en in English); the label and the link
//                follow <html lang>; a modified click (new tab) is left to the browser.
//   BAG          with the header hidden the bag still opens: Add, then "View bag" in the notice opens the drawer; on a desktop the notice
//                sits under the Back row and never over it (in Arabic both are at the right edge); print drops the control.
//   MUTATION     each rule is cut in turn (every [back-N] block, the history hooks, popstate, the in-site test, the marker clean-up, the
//                language observer, the insertion point, the modifier guard, the notice position) and the matching check must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-product-fix.css', BOOT_F = 'boot.js', FEAT_F = 'sporta-features.js'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8'), BOOT = readFileSync(join(PUB, BOOT_F), 'utf8'), FEAT = readFileSync(join(PUB, FEAT_F), 'utf8')
let pass = 0, fail = 0
// a scenario that hangs must end the run with a failing line, not hold the release gate until its own timeout
setTimeout(() => { console.log('FAIL watchdog: the suite did not finish in 20 minutes'); process.exit(1) }, 20 * 60 * 1000).unref()
// printed as it happens: a scenario that crashes later must not swallow what was already measured
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const note = (t) => console.log('note ' + t)
// a page that has left (a mutant that navigates) can leave a browser call waiting for ever: every scenario has a limit
const limit = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms).unref())
const closeQuietly = (ctx) => Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000).unref())])
// a check that reads a field a broken page does not have is a check that fails, not a crash
const holds = (check, ...a) => { try { return check(...a) === true } catch (e) { return false } }
// a flow that cannot finish (the control it needs to click is not there) hands back what it measured and the reason
const attempt = async (flow, opts, o) => { try { return await flow(opts, o) } catch (e) { return { error: String(e && e.message || e).split('\n')[0] } } }

const SLUG = 'sculpt-jacket-black', BAG_SLUG = 'sgomma-t-shirt-navy'
const INK = 'rgb(23, 26, 30)', SNOW = 'rgb(232, 234, 237)'
const WORD = { en: 'Back', ar: 'رجوع' }
const SHOP = { en: '/shop?lang=en', ar: '/shop' }
const PHOTO = photoPng(800, 800)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive(opts); try { return await fn(srv) } finally { await srv.close() } }

// ---------------------------------------------------------------------------------------------------------------- in-page helpers
// Runs in every page from its very first moment (an init script): samples every animation frame, so a header that shows for ONE frame is seen.
const SAMPLER = () => {
  const S = (window.__s = { productHeader: false, shell: false, backBeforeApp: false, bodyFrame: null, frames: 0, cls: 0 })
  const shown = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' }
  const product = () => /^\/product\/[^/]+\/?$/.test(location.pathname)
  const tick = () => {
    S.frames++
    if (product()) {
      if (shown(document.querySelector('.app-header'))) S.productHeader = true
      for (const q of ['.boot-bar', '.boot-head', '.boot-hero']) if (shown(document.querySelector(q))) S.shell = true
      if (shown(document.querySelector('.sporta-back-bar')) && !document.querySelector('.storefront-root')) S.backBeforeApp = true
      // the first frame that has a <body> at all: the control must already be in it, or the page paints empty and then the control arrives
      if (S.bodyFrame === null && document.body) S.bodyFrame = shown(document.querySelector('.sporta-back-bar'))
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) S.cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* no layout-shift entries */ }
}

const FACTS = () => {
  const q = (s) => document.querySelector(s)
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
  const shown = (e) => { if (!e) return false; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const link = q('a[data-sporta-back]'), bar = q('.sporta-back-bar'), icon = q('.sporta-back__icon'), crumb = q('.catalog-breadcrumb'), header = q('.app-header'), vis = q('.catalog-product-visual')
  const cs = link ? getComputedStyle(link) : null, ics = icon ? getComputedStyle(icon) : null, strip = bar ? getComputedStyle(bar, '::before') : null
  const root = document.documentElement
  return {
    path: location.pathname + location.search,
    marker: root.getAttribute('data-sporta-route'), dir: root.dir, lang: root.lang,
    header: { display: header ? getComputedStyle(header).display : 'absent', shown: shown(header), topbar: shown(q('.app-header .topbar')), main: shown(q('.app-header .navbar-main')), menu: shown(q('.app-header .navbar-secondary')), links: [...document.querySelectorAll('.navbar-link')].filter(shown).length, cart: shown(q('.navbar-cart')), logo: shown(q('.navbar-logo')) },
    back: link && { shown: shown(link), count: document.querySelectorAll('a[data-sporta-back]').length, tag: link.tagName.toLowerCase(), text: (link.textContent || '').trim(), href: link.getAttribute('href'), rect: r(link), color: cs.color, borderColor: cs.borderTopColor, borderW: cs.borderTopWidth, radius: cs.borderTopLeftRadius, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, rem: parseFloat(getComputedStyle(root).fontSize) },
    icon: icon && { transform: ics.transform, mask: ics.webkitMaskImage || ics.maskImage || '', w: icon.getBoundingClientRect().width, h: icon.getBoundingClientRect().height, hidden: icon.getAttribute('aria-hidden') },
    barFirst: !!bar && document.body.firstElementChild === bar, barShown: shown(bar), barHiddenAttr: bar ? bar.hidden : null, barDisplay: bar ? getComputedStyle(bar).display : null,
    strip: strip && { content: strip.content, bg: strip.backgroundColor, display: strip.display },
    crumb: r(crumb), visPos: vis ? getComputedStyle(vis).position : null, visTop: vis ? parseFloat(getComputedStyle(vis).top) : null,
    scrollX: root.scrollWidth - root.clientWidth,
  }
}

// ---------------------------------------------------------------------------------------------------------------- the browser side
const open = async (srv, { path = `/product/${SLUG}`, lang = 'en', w = 390, h = 844, theme = 'light', delayApp = 0, waitFor = '.catalog-product-title' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lang', l); localStorage.setItem('sporta_theme', t); localStorage.setItem('sporta_theme_explicit', '1') } catch (e) { /* no storage */ } }, [lang, theme])
  await ctx.addInitScript(SAMPLER)
  await ctx.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }))
  if (delayApp) await ctx.route('**/assets/index-*.js', async (r) => { await new Promise((s) => setTimeout(s, delayApp)); await r.continue() })
  const p = await ctx.newPage(); const errs = []
  p.setDefaultTimeout(12000)
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(srv.base + path, { waitUntil: 'load' })
  await p.waitForSelector(waitFor, { timeout: 20000 }).catch(() => {})
  await p.waitForTimeout(delayApp ? 600 : 1100)
  return { ctx, p, errs }
}
const run = (opts, o) => withServer(opts, async (srv) => Promise.race([runIn(srv, o), limit(120000, 'a page run')]))
const runIn = async (srv, o) => {
  const t = await open(srv, o)
  const m = await t.p.evaluate(FACTS), s = await t.p.evaluate(() => window.__s)
  // the keyboard first: under print media the control is not drawn, so it cannot take the first Tab
  let tabbed = null
  if (o.tab) { await t.p.keyboard.press('Tab'); tabbed = await t.p.evaluate(() => { const a = document.activeElement; const cs = a ? getComputedStyle(a) : null; return { back: !!a && a.matches('a[data-sporta-back]'), outline: cs ? cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor : '' } }) }
  let printed = null
  if (o.print) { await t.p.emulateMedia({ media: 'print' }); printed = await t.p.evaluate(() => { const b = document.querySelector('.sporta-back-bar'); return b ? getComputedStyle(b).display : 'absent' }) }
  await closeQuietly(t.ctx)
  return { m, s, errs: t.errs, printed, tabbed }
}
const cache = new Map()
const real = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, run({}, o)); return cache.get(k) }

const shownRoute = async (p) => p.evaluate(FACTS)

// ---------------------------------------------------------------------------------------------------------------- the checks
const CHECK = {
  noHeader: (m) => m.marker === 'product' && m.header.display === 'none' && !m.header.shown && !m.header.topbar && !m.header.main && !m.header.menu && m.header.links === 0 && !m.header.cart && !m.header.logo,
  oneBack: (m, lang) => !!m.back && m.back.shown && m.back.count === 1 && m.back.tag === 'a' && m.back.text === WORD[lang] && m.back.href === SHOP[lang] && m.barFirst,
  size44: (m) => !!m.back && m.back.rect.h >= 43.5 && m.back.rect.w >= 43.5,
  firstThing: (m) => !!m.back && !!m.crumb && m.back.rect.t >= 0 && m.back.rect.t <= 20 && m.crumb.t - m.back.rect.b >= 8,
  aligned: (m) => !!m.back && !!m.crumb && (m.dir === 'rtl' ? Math.abs(m.back.rect.r - m.crumb.r) <= 1 : Math.abs(m.back.rect.l - m.crumb.l) <= 1),
  arrow: (m) => !!m.icon && /data:image\/svg\+xml/.test(m.icon.mask) && m.icon.w >= 19 && m.icon.h >= 19 && m.icon.hidden === 'true' && (m.dir === 'rtl' ? m.icon.transform === 'matrix(-1, 0, 0, 1, 0, 0)' : m.icon.transform === 'none'),
  shape: (m) => !!m.back && m.back.borderW === '1px' && Math.abs(parseFloat(m.back.radius) - 0.75 * m.back.rem) <= 0.6,
  lightLook: (m) => !!m.back && m.back.color === INK && m.back.borderColor === 'rgba(23, 26, 30, 0.2)',
  darkLook: (m) => !!m.back && m.back.color === SNOW && m.back.borderColor === 'rgba(255, 255, 255, 0.12)',
  strip: (m) => !!m.strip && m.strip.content === '""' && m.strip.bg === INK && m.strip.display === 'block',
  sticky: (m) => m.visPos === 'sticky' && m.visTop !== null && m.visTop <= 30,
  quiet: (m, errs) => m.scrollX <= 0 && errs.length === 0,
  other: (m) => m.marker === null && m.header.shown && m.header.topbar && m.header.menu && m.header.links >= 5 && !m.barShown,
}

if (process.env.BACK_ONLY_SMOKE) { const r = await real({ w: 390, lang: 'en', tab: true, print: true }); console.log(JSON.stringify(r, null, 1)); await browser.close(); process.exit(0) }

// ============================================================================================================ 1. the product page, real files
head('the real files, on the real compiled product page (light theme)')
const MATRIX = [[390, 'en'], [390, 'ar'], [768, 'en'], [1024, 'ar'], [1280, 'en'], [1280, 'ar'], [1536, 'en']]
for (const [w, lang] of MATRIX) {
  const tag = `${lang} ${w}px`
  const { m, s, errs } = await real({ w, lang })
  is(CHECK.noHeader(m), `${tag}: no header is shown - no announcement bar, no logo row, no menu tab, no bag - and the route is marked`, JSON.stringify([m.marker, m.header]))
  is(CHECK.oneBack(m, lang), `${tag}: ONE link "${WORD[lang]}" to ${SHOP[lang]}, the first element of <body>`, JSON.stringify([m.back && m.back.count, m.back && m.back.text, m.back && m.back.href, m.barFirst]))
  is(CHECK.size44(m), `${tag}: the Back link is at least 44px each way`, m.back ? `${Math.round(m.back.rect.w)} x ${Math.round(m.back.rect.h)}` : 'no link')
  is(CHECK.firstThing(m), `${tag}: it is the first thing on the page (12px down) and the breadcrumb is under it with room`, JSON.stringify([m.back && m.back.rect, m.crumb]))
  is(CHECK.aligned(m), `${tag}: its start edge is exactly the breadcrumb's start edge`, JSON.stringify([m.dir, m.back && m.back.rect, m.crumb]))
  is(CHECK.arrow(m), `${tag}: the arrow is a 20px line-icon mask ${lang === 'ar' ? 'mirrored (pointing right)' : 'pointing left'}`, JSON.stringify(m.icon))
  is(CHECK.shape(m) && CHECK.lightLook(m), `${tag}: a 12px control with a 1px line at 20% ink and ink text, the wishlist heart's twin`, JSON.stringify(m.back))
  is(CHECK.strip(m), `${tag}: the strip under an installed app's status bar is ink (0px high in a browser tab)`, JSON.stringify(m.strip))
  if (w >= 768) is(CHECK.sticky(m), `${tag}: the photo column sticks ${Math.round(m.visTop)}px from the top (the build's 10rem / 7rem cleared a header that is gone)`, JSON.stringify([m.visPos, m.visTop]))
  is(CHECK.quiet(m, errs), `${tag}: no sideways scroll, no page error`, `${m.scrollX}px ${errs.join(' | ')}`)
  if (w === 390) is(m.crumb.t < 100, `${tag}: the page starts higher than before (the breadcrumb at ${Math.round(m.crumb.t)}px, it was at 138px under the 126px header)`, String(m.crumb.t))
}

head('the dark theme')
for (const [w, lang] of [[390, 'en'], [390, 'ar'], [1280, 'en']]) {
  const tag = `${lang} ${w}px dark`
  const { m } = await real({ w, lang, theme: 'dark' })
  is(CHECK.noHeader(m) && CHECK.oneBack(m, lang), `${tag}: no header, one Back link`, JSON.stringify(m.header))
  is(CHECK.darkLook(m) && CHECK.shape(m), `${tag}: the page's light ink and the heart's 12% white line`, JSON.stringify([m.back && m.back.color, m.back && m.back.borderColor]))
}

head('every other page keeps its header and has no Back control')
for (const [path, w, lang] of [['/', 390, 'en'], ['/shop', 390, 'en'], ['/shop', 1280, 'ar'], ['/about', 390, 'ar'], ['/contact', 390, 'en'], ['/catalogue', 390, 'en']]) {
  const { m, errs } = await real({ path, w, lang, waitFor: '.app-header .navbar-main' })
  is(CHECK.other(m) && errs.length === 0, `${path} ${lang} ${w}px: the header, the top bar and the ${m.header.links} menu tabs are shown, no route marker, no Back control`, JSON.stringify([m.marker, m.header, m.barShown, errs]))
}

head('print and the keyboard')
{
  const r = await real({ w: 390, lang: 'en', print: true, tab: true })
  is(r.printed === 'none', 'printing a product page does not print the Back control', String(r.printed))
  is(r.tabbed && r.tabbed.back, 'the first Tab stops on the Back link', JSON.stringify(r.tabbed))
  is(r.tabbed && /solid 2px rgb\(179, 77, 0\)/.test(r.tabbed.outline), 'its focus ring is the 2px dark orange step (#B34D00) of the brand rule for light grounds', r.tabbed && r.tabbed.outline)
  const d = await real({ w: 390, lang: 'en', theme: 'dark', tab: true })
  is(d.tabbed && /solid 2px rgb\(255, 123, 23\)/.test(d.tabbed.outline), 'on the dark theme the focus ring is the logo orange (#FF7B17)', d.tabbed && d.tabbed.outline)
}

// ============================================================================================================ 2. first paint
head('first paint: the app is held back 0.9 s, so what shows before it is what a visitor on a slow phone sees')
for (const lang of ['en', 'ar']) {
  const { m, s, errs } = await real({ w: 390, lang, delayApp: 900 })
  is(s.productHeader === false && s.shell === false, `${lang}: the header and the shell (orange bar, logo bar, hero box) were never drawn on the route, in ${s.frames} frames`, JSON.stringify(s))
  is(s.backBeforeApp === true, `${lang}: the Back control was on screen before the app was`, JSON.stringify(s))
  is(s.bodyFrame === true, `${lang}: and it is in the very first frame that has a <body>, not at DOMContentLoaded (which waits for the app's script)`, JSON.stringify(s))
  is(CHECK.noHeader(m) && CHECK.oneBack(m, lang) && errs.length === 0, `${lang}: and the page that follows has the same single control`, JSON.stringify(errs))
  note(`${lang}: layout shift while loading with the app held back: ${s.cls.toFixed(3)}`)
  is(s.cls < 0.1, `${lang}: the load shifts the layout by less than 0.1 (${s.cls.toFixed(3)})`, String(s.cls))
}

// ============================================================================================================ 3. navigation
// One flow = one browser page. It hands back what it measured even when a step cannot finish (the control it has to click is not there, which
// is exactly what a broken rule looks like): `error` says which step, and a check reads a missing field as "not true".
const flowOnce = (body, opts, o) => withServer(opts, async (srv) => {
  const f = { base: srv.base, errs: [] }
  try { await Promise.race([body(srv, f, o), limit(90000, 'the flow')]) } catch (e) { f.error = String((e && e.message) || e).split('\n')[0] }
  if (f.t) { f.errs = f.t.errs; await closeQuietly(f.t.ctx); delete f.t }
  return f
})
// a flow that could not finish is run once more (a loaded machine is the usual reason); a broken rule fails both times
const flow = (body) => async (opts, o = {}) => { const f = await flowOnce(body, opts, o); return f.error ? flowOnce(body, opts, o) : f }
const navFlow = flow(async (srv, f, { w = 390, lang = 'en' }) => {
  const t = (f.t = await open(srv, { path: '/shop', lang, w, waitFor: 'a[href^="/product/"]' })), p = t.p
  f.shop = await shownRoute(p)
  await p.locator('a[href^="/product/"]').first().click()
  await p.waitForURL(/\/product\//); await p.waitForSelector('.catalog-product-title'); await p.waitForTimeout(500)
  f.product = await shownRoute(p); f.idx = await p.evaluate(() => history.state && history.state.idx)
  const first = new URL(p.url()).pathname
  const rel = p.locator('.catalog-related a[href^="/product/"]').first(), relHref = await rel.getAttribute('href')
  await rel.click(); await p.waitForFunction((h) => location.pathname === h, relHref); await p.waitForTimeout(500)
  f.related = { ok: relHref !== first, m: await shownRoute(p) }
  await p.click('a[data-sporta-back]'); await p.waitForFunction((h) => location.pathname === h, first); await p.waitForTimeout(500)
  f.backToFirst = { path: new URL(p.url()).pathname, first, m: await shownRoute(p) }
  await p.click('a[data-sporta-back]'); await p.waitForURL(/\/shop/); await p.waitForTimeout(700)
  f.backToShop = await shownRoute(p)
  await p.goForward(); await p.waitForTimeout(600); f.forward = await shownRoute(p)
  await p.goBack(); await p.waitForTimeout(600); f.goBack = await shownRoute(p)
  f.flash = await p.evaluate(() => window.__s.productHeader)
})
const NAV = {
  intoProduct: (f) => f.shop.marker === null && f.shop.header.shown && f.product.marker === 'product' && CHECK.noHeader(f.product) && f.product.back.shown && f.product.barFirst === true && f.idx === 1 && f.flash === false,
  related: (f) => f.related.ok && CHECK.noHeader(f.related.m) && f.related.m.back.shown,
  backToFirst: (f) => f.backToFirst.path === f.backToFirst.first && CHECK.noHeader(f.backToFirst.m) && f.backToFirst.m.back.shown,
  backToShop: (f) => /^\/shop/.test(f.backToShop.path) && f.backToShop.marker === null && f.backToShop.header.shown && f.backToShop.header.topbar && f.backToShop.header.menu && !f.backToShop.barShown && f.backToShop.barHiddenAttr === true,
  browser: (f) => CHECK.noHeader(f.forward) && f.forward.back.shown && f.goBack.marker === null && f.goBack.header.shown && !f.goBack.barShown,
}
head('navigation inside the site (the router changes the address by pushState; the browser fires popstate for its own Back / Forward)')
for (const [w, lang] of [[390, 'en'], [1280, 'ar']]) {
  const f = await navFlow({}, { w, lang }), tag = `${lang} ${w}px`
  if (f.error) note(`${tag}: the flow stopped early - ${f.error}`)
  is(holds(NAV.intoProduct, f), `${tag}: a click from the shop to a product hides the header (never drawn on the route, even for a frame) and shows Back`, JSON.stringify([f.shop?.marker, f.product?.marker, f.idx, f.flash]))
  is(holds(NAV.related, f), `${tag}: a related product keeps the page header-less`, JSON.stringify(f.related?.m?.header))
  is(holds(NAV.backToFirst, f), `${tag}: Back from the related product is the product the shopper left (history.back, not the shop)`, JSON.stringify([f.backToFirst?.path, f.backToFirst?.first]))
  is(holds(NAV.backToShop, f), `${tag}: Back from the first product is the shop: the header, the top bar and the menu are back, the route marker is gone, the control is hidden`, JSON.stringify([f.backToShop?.path, f.backToShop?.marker, f.backToShop?.header, f.backToShop?.barHiddenAttr]))
  is(holds(NAV.browser, f), `${tag}: the browser's Forward hides the header again and its Back brings it back`, JSON.stringify([f.forward?.marker, f.goBack?.marker]))
  is(!f.error && f.errs.length === 0, `${tag}: no page error on the way`, f.errs.join(' | ') || f.error)
}
const directFlow = flow(async (srv, f, { lang = 'en' }) => {
  const t = (f.t = await open(srv, { lang })), p = t.p
  f.before = await shownRoute(p)
  await p.click('a[data-sporta-back]')
  await p.waitForURL(/\/shop/); await p.waitForTimeout(700)
  f.after = await shownRoute(p); f.url = p.url()
})
head('a visit with nothing to go back to')
for (const lang of ['en', 'ar']) {
  const f = await directFlow({}, { lang })
  is(holds((x) => x.before.back.shown && x.url === x.base + SHOP[lang] && x.after.header.shown, f), `${lang}: Back goes to ${SHOP[lang]} (the language travels in the address only when it is English) and the shop shows its header`, f.error || f.url)
}

const langFlow = flow(async (srv, f) => {
  const t = (f.t = await open(srv, { lang: 'en' })), p = t.p
  const read = () => p.evaluate(() => ({ text: document.querySelector('.sporta-back__label').textContent, href: document.querySelector('a[data-sporta-back]').getAttribute('href') }))
  f.en = await read()
  await p.evaluate(() => { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl' }); await p.waitForTimeout(300); f.ar = await read()
  await p.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr' }); await p.waitForTimeout(300); f.en2 = await read()
})
const LANG = (f) => f.en.text === 'Back' && f.en.href === '/shop?lang=en' && f.ar.text === 'رجوع' && f.ar.href === '/shop' && f.en2.text === 'Back' && f.en2.href === '/shop?lang=en'
head('the language and a modified click')
{
  const f = await langFlow({})
  is(holds(LANG, f), 'the word and the shop link follow <html lang> in both directions', f.error || JSON.stringify([f.en, f.ar, f.en2]))
}
const modFlow = flow(async (srv, f) => {
  const t = (f.t = await open(srv, { path: '/shop', waitFor: 'a[href^="/product/"]' })), p = t.p
  await p.locator('a[href^="/product/"]').first().click(); await p.waitForURL(/\/product\//); await p.waitForSelector('.catalog-product-title'); await p.waitForTimeout(500)
  // a listener added AFTER the control's own reads defaultPrevented and cancels the navigation, so nothing leaves the page but the plain click's history.back()
  // history.back is replaced by a counter: a page that really went back would leave the scenario (and, cut, it would for every click)
  f.seen = await p.evaluate(() => {
    const a = document.querySelector('a[data-sporta-back]'), seen = []
    let backs = 0
    history.back = () => { backs++ }
    a.addEventListener('click', (e) => { seen.push([e.defaultPrevented, backs]); e.preventDefault() })
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, {}]) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mod }))
    return seen
  })
})
const MOD = (f) => JSON.stringify(f.seen) === '[[false,0],[false,0],[false,0],[false,0],[true,1]]'
{
  const f = await modFlow({})
  is(holds(MOD, f), 'Ctrl, Meta, Shift and Alt clicks are left to the browser (new tab, new window); only a plain click is history.back()', f.error || JSON.stringify(f.seen))
}

// ============================================================================================================ 4. the bag
const bagFlow = flow(async (srv, f, { w, lang }) => {
  const t = (f.t = await open(srv, { path: `/product/${BAG_SLUG}`, lang, w, h: 900, waitFor: '.product-purchase-row' })), p = t.p
  await p.waitForFunction(() => document.querySelectorAll('#product-size-options [role="group"] > button').length > 0).catch(() => {})
  await p.locator('#product-size-options [role="group"] > button:not([disabled]):visible').first().click(); await p.waitForTimeout(250)
  await p.locator('.product-purchase-row .btn-primary').click()
  await p.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 30000 })
  await p.waitForFunction(() => getComputedStyle(document.querySelector('.sporta-u3-toast')).opacity === '1'); await p.waitForTimeout(120)
  f.notice = await p.evaluate(() => {
    const b = document.querySelector('a[data-sporta-back]'), tt = document.querySelector('.sporta-u3-toast'), br = b.getBoundingClientRect(), tr = tt.getBoundingClientRect()
    return { back: { l: br.left, t: br.top, r: br.right, b: br.bottom }, toast: { l: tr.left, t: tr.top, r: tr.right, b: tr.bottom }, vw: innerWidth, vh: innerHeight }
  })
  await p.locator('.sporta-u3-toast button').click(); await p.waitForTimeout(800)
  f.drawer = await p.evaluate(() => { const a = document.querySelector('aside.cart-drawer'), r = a.getBoundingClientRect(); return { on: r.left < innerWidth && r.right > 0 && !a.hasAttribute('inert') } })
  f.m = await shownRoute(p)
})
const BAG = {
  opens: (f) => f.drawer.on && CHECK.noHeader(f.m),
  clear: (f, w) => { const n = f.notice, over = !(n.toast.l >= n.back.r || n.toast.r <= n.back.l || n.toast.t >= n.back.b || n.toast.b <= n.back.t); return n.toast.l >= 0 && n.toast.r <= n.vw && (w < 768 ? n.toast.b <= n.vh : !over && n.toast.t >= n.back.b) },
}
head('the bag with the header hidden: Add, the notice, View bag')
for (const [w, lang] of [[390, 'en'], [1280, 'en'], [1280, 'ar']]) {
  const f = await bagFlow({}, { w, lang }), tag = `${lang} ${w}px`
  if (f.error) note(`${tag}: the flow stopped early - ${f.error}`)
  is(holds(BAG.opens, f), `${tag}: "View bag" in the notice opens the bag drawer although the header's bag button is not shown, and the page stays header-less`, JSON.stringify([f.drawer, f.m?.header]))
  is(holds(BAG.clear, f, w), `${tag}: the notice is on screen${w < 768 ? ' above the buy bar' : ` under the Back row, clear of it${lang === 'ar' ? ' (both are at the right edge)' : ''}`}`, JSON.stringify(f.notice))
  is(!f.error && f.errs.length === 0, `${tag}: no page error`, f.errs.join(' | ') || f.error)
}

// ============================================================================================================ 5. mutants
head('mutants: with one rule cut, the matching check fails')
const cutBlock = (css, n) => {
  const a = css.indexOf(`/* [back-${n}]`)
  const next = [css.indexOf(`/* [back-${n + 1}]`, a), css.indexOf('/* ==== end BACK 1120 */', a)].filter((x) => x > 0)
  return a < 0 ? css : css.slice(0, a) + css.slice(Math.min(...next))
}
const sub = (text, from, to) => (text.includes(from) ? text.replace(from, to) : text)
const CSSM = (n) => ({ css: { [CSS_F]: cutBlock(CSS, n) }, changed: cutBlock(CSS, n) !== CSS })
const CSSS = (from, to) => ({ css: { [CSS_F]: sub(CSS, from, to) }, changed: CSS.includes(from) })
const BOOTM = (from, to) => ({ js: { [BOOT_F]: sub(BOOT, from, to) }, changed: BOOT.includes(from) })
const FEATM = (from, to) => ({ js: { [FEAT_F]: sub(FEAT, from, to) }, changed: FEAT.includes(from) })
const asOpts = (m) => (m.css ? { css: m.css } : { js: m.js })
// [label, how a file is cut, how the page is measured, the check that must pass on the real files and go red with the cut]
const MUT = [
  ['back-1: the header and the shell are hidden', CSSM(1), { w: 390, lang: 'en' }, ({ m }) => CHECK.noHeader(m)],
  ['back-1: the first-paint shell is not hidden (the flash)', CSSS('html[data-sporta-route="product"] .boot-bar,\nhtml[data-sporta-route="product"] .boot-head,\nhtml[data-sporta-route="product"] .boot-hero { display: none !important; }', 'html[data-sporta-route="product"] .app-header { display: none !important; }'), { w: 390, lang: 'en', delayApp: 900 }, ({ s }) => s.shell === false],
  ['back-2: the photo column offset', CSSM(2), { w: 1280, lang: 'en' }, ({ m }) => CHECK.sticky(m)],
  ['back-3: the row (padding, width)', CSSM(3), { w: 1536, lang: 'en' }, ({ m }) => CHECK.aligned(m)],
  ['back-3: the row (Arabic)', CSSM(3), { w: 1280, lang: 'ar' }, ({ m }) => CHECK.aligned(m)],
  ['back-4: the control box', CSSM(4), { w: 390, lang: 'en' }, ({ m }) => CHECK.size44(m) && CHECK.shape(m) && CHECK.lightLook(m)],
  ['back-5: the arrow', CSSM(5), { w: 390, lang: 'en' }, ({ m }) => CHECK.arrow(m)],
  ['back-5: the Arabic mirror', CSSS(':root[dir="rtl"] .sporta-back__icon { transform: scaleX(-1); }', ''), { w: 390, lang: 'ar' }, ({ m }) => CHECK.arrow(m)],
  ['back-6: the dark theme', CSSM(6), { w: 390, lang: 'en', theme: 'dark' }, ({ m }) => CHECK.darkLook(m)],
  ['back-7: the status-bar strip', CSSM(7), { w: 390, lang: 'en' }, ({ m }) => CHECK.strip(m)],
  ['back-8: print', CSSM(8), { w: 390, lang: 'en', print: true }, ({ printed }) => printed === 'none'],
  ['boot.js: the marker is never set', BOOTM("root.setAttribute('data-sporta-route', 'product')", 'void 0'), { w: 390, lang: 'en' }, ({ m }) => CHECK.noHeader(m)],
  ['boot.js: the control is not built before the app (no body observer)', BOOTM('wait.observe(root, { childList: true })', 'void 0'), { w: 390, lang: 'en', delayApp: 900 }, ({ s }) => s.bodyFrame === true],
]
// [label, cut, flow, options of the flow, check]
const FLOWMUT = [
  ['boot.js: no history hooks (a click from the shop leaves the header)', BOOTM("if (typeof original !== 'function') return", 'return'), navFlow, { w: 390, lang: 'en' }, NAV.intoProduct],
  ['boot.js: the control goes last in <body> (built on a visit from the shop, when the body already holds the app)', BOOTM('document.body.insertBefore(bar, document.body.firstChild)', 'document.body.appendChild(bar)'), navFlow, { w: 390, lang: 'en' }, NAV.intoProduct],
  ['boot.js: no popstate (the browser Back leaves the page header-less)', BOOTM("window.addEventListener('popstate', function () { try { sync() } catch (e) {} })", ''), navFlow, { w: 390, lang: 'en' }, (f) => NAV.browser(f) && NAV.backToShop(f)],
  ['boot.js: the marker is never removed', BOOTM("else if (root.hasAttribute('data-sporta-route')) root.removeAttribute('data-sporta-route')", ''), navFlow, { w: 390, lang: 'en' }, NAV.backToShop],
  ['boot.js: Back is always the shop (no in-site test)', BOOTM('function inSite() {', 'function inSite() { return false'), navFlow, { w: 390, lang: 'en' }, NAV.backToFirst],
  ['boot.js: the control is never hidden away from a product', BOOTM('bar.hidden = !on', 'bar.hidden = false'), navFlow, { w: 390, lang: 'en' }, NAV.backToShop],
  ['boot.js: the label ignores <html lang>', BOOTM(".observe(root, { attributes: true, attributeFilter: ['lang'] })", '.observe(document.createElement("i"), { attributes: true })'), langFlow, {}, LANG],
  ['boot.js: the modifier guard is gone', BOOTM('if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return', 'if (e.defaultPrevented) return'), modFlow, {}, MOD],
  ['sporta-features.js: the notice ignores the Back row (it sits 12px from the top, over the control in Arabic)', FEATM('bb ? bb.getBoundingClientRect().bottom : 0', '0'), bagFlow, { w: 1280, lang: 'ar' }, (f) => BAG.clear(f, 1280)],
]
for (const [label, m, o, check] of MUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found in the file`); continue }
  is(holds(check, await real(o)), `mutant "${label}": the check passes on the real files`)
  is(!holds(check, await run(asOpts(m), o)), `mutant "${label}": and goes red with it cut`)
}
for (const [label, m, fl, o, check] of FLOWMUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found in the file`); continue }
  const good = await fl({}, o)
  is(holds(check, good), `mutant "${label}": the check passes on the real files`, good.error || JSON.stringify(good).slice(0, 300))
  is(!holds(check, await fl(asOpts(m), o)), `mutant "${label}": and goes red with it cut`)
}


await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
