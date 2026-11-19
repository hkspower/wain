// TOPBAR ACCOUNT 1120 (owner, 2026-11-19: "remove sporta ai icons from topbar put account profile icons"):
//   the top bar's Sporta AI button is not shown (public/sporta-shadows.css [tacc-1]) and an account icon, a real link to /account made by
//   public/sporta-features.js (TOPBAR ACCOUNT), stands in its place beside the clock.
//
//   npm run test:topbar-account-1120     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled storefront (the capture) with the add-ons of this repo:
//   LAYOUT      /, /shop, /about, /contact, /cart, /account at 390 and 1280 px, Arabic and English: the AI button is in the page but not shown
//               (no box, no visible control named for the assistant); ONE account link inside the tool cluster, shown, /account, named in the
//               page's language, 44px (2.75rem), its 20px person drawn with a 1.5px stroke, to the right of the clock and clear of the logo,
//               level with the bag; the header is exactly as tall as before; no sideways scroll, no page error; aria-current only on /account.
//   CLICK       a plain click opens /account WITHOUT reloading the shop (a marker set in the page survives; the router keeps its history), a
//               Ctrl / Meta / Shift / Alt / middle click is left to the browser, Enter on the focused link does the same as a click, the
//               keyboard ring is the logo orange, hover turns the icon the logo orange.
//   RESILIENCE  the language toggle (React re-renders the header) leaves one link and flips its word; a removed link comes back; a second
//               one is removed; the product page (no header) keeps its Back-only top; the assistant is still there (the hidden button still
//               opens the panel when pressed by script: nothing of the compiled header was removed).
//   MUTATION    each rule is cut in turn ([tacc-1..4], the block, the hand-off to the router, the modifier guard, the one-link rule, the observer,
//               the language word) and the matching check must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { photoPng } from './lib/test-photo.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-shadows.css', FEAT_F = 'sporta-features.js'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8'), FEAT = readFileSync(join(PUB, FEAT_F), 'utf8')
let pass = 0, fail = 0
setTimeout(() => { console.log('FAIL watchdog: the suite did not finish in 20 minutes'); process.exit(1) }, 20 * 60 * 1000).unref()
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const holds = (check, ...a) => { try { return check(...a) === true } catch (e) { return false } }
const limit = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms).unref())
const closeQuietly = (ctx) => Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000).unref())])

const PHOTO = photoPng(800, 800)
// the capture lacks two lazy stylesheets (the account and returns pages): an empty one lets those pages mount (the header is what is measured)
const STAND_IN = { 'assets/Account-DqFbZs-H.css': '', 'assets/Returns-DHmag5QD.css': '' }
const WORD = { en: 'Account', ar: 'حسابي' }
const AI_NAME = { en: 'Open the Sporta assistant', ar: 'افتح مساعد سبورتا' }
const PAGES = ['/', '/shop', '/about', '/contact', '/cart', '/account']
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive({ ...opts, css: { ...STAND_IN, ...(opts.css || {}) } }); try { return await fn(srv) } finally { await srv.close() } }

// ---------------------------------------------------------------------------------------------------------------- in-page measurement
const FACTS = () => {
  const q = (s) => document.querySelector(s)
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 } }
  const shown = (e) => { if (!e) return false; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const tools = q('.app-header .navbar-tools'), links = [...document.querySelectorAll('.app-header a.navbar-account')], link = links[0] || null
  const ai = q('.app-header .navbar-ai'), clock = q('.app-header .navbar-tools .clock'), cart = q('.app-header .navbar-cart'), logo = q('.app-header .navbar-logo'), root = document.documentElement
  const icon = link && link.querySelector('svg'), ics = icon ? getComputedStyle(icon) : null, cs = link ? getComputedStyle(link) : null
  const visibleAssistant = [...document.querySelectorAll('button, a')].filter((e) => shown(e) && /assistant|مساعد/i.test(e.getAttribute('aria-label') || '')).length
  const header = q('.app-header')
  return {
    path: location.pathname, lang: root.lang, dir: root.dir,
    ai: { exists: !!ai, display: ai ? getComputedStyle(ai).display : null, rect: r(ai), visibleAssistant, launchers: [...document.querySelectorAll('.assistant-launcher')].filter(shown).length },
    count: links.length, inTools: links.filter((a) => a.parentNode === tools).length,
    link: link && { shown: shown(link), tag: link.tagName.toLowerCase(), href: link.getAttribute('href'), label: link.getAttribute('aria-label'), current: link.getAttribute('aria-current'), rect: r(link), color: cs.color, minW: cs.minWidth, rem: parseFloat(getComputedStyle(root).fontSize), radius: cs.borderTopLeftRadius, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor },
    icon: icon && { rect: r(icon), hidden: icon.getAttribute('aria-hidden'), stroke: ics.strokeWidth, strokeColor: ics.stroke, fill: ics.fill, cap: ics.strokeLinecap, shapes: [...icon.children].map((c) => c.tagName.toLowerCase()).join(',') },
    clock: r(clock), cart: r(cart), logo: r(logo), tools: r(tools), header: r(header), headerShown: shown(header),
    scrollX: root.scrollWidth - root.clientWidth, headerOverflow: header ? header.scrollWidth - header.clientWidth : 0,
  }
}

const open = async (srv, { path = '/shop', lang = 'en', w = 390, h = 800 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) { /* no storage */ } }, lang)
  await ctx.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }))
  const p = await ctx.newPage(); const errs = []
  p.setDefaultTimeout(12000)
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(srv.base + path, { waitUntil: 'load' })
  await p.waitForSelector('.app-header .navbar-cart', { state: 'attached', timeout: 20000 }).catch(() => {})
  await p.waitForTimeout(1200)
  return { ctx, p, errs }
}
const run = (opts, o) => withServer(opts, async (srv) => Promise.race([(async () => {
  const t = await open(srv, o)
  const m = await t.p.evaluate(FACTS)
  await closeQuietly(t.ctx)
  return { m, errs: t.errs }
})(), limit(120000, 'a page run')]))
const cache = new Map()
const real = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, run({}, o)); return cache.get(k) }
// a flow = one browser page that hands back what it measured even when a step cannot finish
const flowOnce = (body, opts, o) => withServer(opts, async (srv) => {
  const f = { errs: [] }
  try { await Promise.race([body(srv, f, o), limit(90000, 'the flow')]) } catch (e) { f.error = String((e && e.message) || e).split('\n')[0] }
  if (f.t) { f.errs = f.t.errs; await closeQuietly(f.t.ctx); delete f.t }
  return f
})
const flow = (body) => async (opts, o = {}) => { const f = await flowOnce(body, opts, o); return f.error ? flowOnce(body, opts, o) : f }

// ---------------------------------------------------------------------------------------------------------------- the checks
const lum = (c) => { const m = String(c).match(/[\d.]+/g).map(Number), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const CHECK = {
  aiGone: (m) => m.ai.exists && m.ai.display === 'none' && m.ai.rect.w === 0 && m.ai.visibleAssistant === 0 && m.ai.launchers === 0,
  oneLink: (m, lang) => m.count === 1 && m.inTools === 1 && m.link.shown && m.link.tag === 'a' && m.link.href === '/account' && m.link.label === WORD[lang],
  box: (m) => m.link.rect.w >= 43.5 && m.link.rect.h >= 43.5 && Math.abs(m.link.rect.w - 2.75 * m.link.rem) <= 1 && Math.abs(m.link.rect.h - 2.75 * m.link.rem) <= 1,
  icon: (m) => !!m.icon && m.icon.hidden === 'true' && Math.abs(m.icon.rect.w - 20) <= 0.5 && Math.abs(m.icon.rect.h - 20) <= 0.5 && m.icon.stroke === '1.5px' && m.icon.fill === 'none' && m.icon.cap === 'round' && m.icon.shapes === 'circle,path' && Math.abs(m.icon.rect.cx - m.link.rect.cx) <= 0.6 && Math.abs(m.icon.rect.cy - m.link.rect.cy) <= 0.6,
  place: (m) => m.clock.r <= m.link.rect.l + 0.5 && m.link.rect.r <= m.tools.r + 0.5 && Math.abs(m.link.rect.cy - m.cart.cy) <= 1 && m.logo.l - m.link.rect.r >= 8,
  colour: (m) => ratio(m.link.color, 'rgb(23, 26, 30)') >= 4.5,
  // the account page is mounted with an EMPTY stand-in stylesheet (the capture lacks the real one), so its own form may be wider than the phone: there the header is measured alone
  noScroll: (m, errs) => (m.path === '/account' ? m.headerOverflow <= 0 : m.scrollX <= 0 && m.headerOverflow <= 0) && errs.length === 0,
  current: (m) => (m.path === '/account') === (m.link.current === 'page'),
}

// ============================================================================================================ 1. layout, real files
head('the real files on the real compiled storefront')
const HEADER_H = {}
for (const [w, lang] of [[390, 'en'], [390, 'ar'], [1280, 'en'], [1280, 'ar']]) {
  for (const path of PAGES) {
    const { m, errs } = await real({ path, lang, w })
    const tag = `${path} ${lang} ${w}px`
    is(holds(CHECK.aiGone, m), `${tag}: the Sporta AI button is in the page but not shown, and no control named for the assistant is visible`, JSON.stringify(m.ai))
    is(holds(CHECK.oneLink, m, lang) && holds(CHECK.box, m), `${tag}: ONE link "${WORD[lang]}" to /account in the tool cluster, 2.75rem square`, JSON.stringify([m.count, m.inTools, m.link && m.link.label, m.link && m.link.rect]))
    is(holds(CHECK.icon, m), `${tag}: its person is a 20px line icon (circle + path, 1.5px stroke, round caps), centred in the box`, JSON.stringify(m.icon))
    is(holds(CHECK.place, m), `${tag}: it sits right of the clock, inside the cluster, level with the bag and clear of the logo`, JSON.stringify([m.clock, m.link && m.link.rect, m.cart && m.cart.cy, m.logo && m.logo.l]))
    is(holds(CHECK.colour, m) && holds(CHECK.current, m), `${tag}: its colour reads ${m.link ? ratio(m.link.color, 'rgb(23, 26, 30)').toFixed(1) : '?'}:1 on the header and aria-current is ${m.path === '/account' ? 'page' : 'absent'}`, JSON.stringify([m.link && m.link.color, m.link && m.link.current]))
    is(holds(CHECK.noScroll, m, errs), `${tag}: no sideways scroll, no page error`, `${m.scrollX}px ${errs.join(' | ')}`)
    if (path === '/shop') HEADER_H[`${lang}${w}`] = m.header.h
  }
}

head('the header is as tall as it was (the AI button and the new link are the same height) and the other controls did not move')
{
  const base = {}
  for (const [w, lang] of [[390, 'en'], [1280, 'ar']]) {
    const off = await run({ css: { [CSS_F]: CSS.replace(/\/\* ==== TOPBAR ACCOUNT 1120[\s\S]*?\/\* end TOPBAR ACCOUNT 1120 \*\/\n/, '') }, js: { [FEAT_F]: stripBlock(FEAT) } }, { path: '/shop', lang, w })
    const cur = (await real({ path: '/shop', lang, w })).m
    is(off.m.header.h === cur.header.h && Math.abs(off.m.cart.l - cur.cart.l) <= 0.5 && Math.abs(off.m.logo.l - cur.logo.l) <= 0.5 && Math.abs(off.m.clock.l - cur.clock.l) <= 0.5,
      `${lang} ${w}px: header ${cur.header.h}px high as before (${off.m.header.h}px), the clock, the logo and the bag stand where they stood`, JSON.stringify([off.m.header.h, cur.header.h]))
    base[`${lang}${w}`] = off.m
    // the link takes the AI button's old slot at phone width (the AI was a 44px icon there)
    if (w < 500) is(Math.abs(off.m.ai.rect.l - cur.link.rect.l) <= 0.5 && Math.abs(off.m.ai.rect.w - cur.link.rect.w) <= 0.5, `${lang} ${w}px: it stands exactly where the AI icon stood (${Math.round(off.m.ai.rect.l)}px, ${Math.round(off.m.ai.rect.w)}px wide)`, JSON.stringify([off.m.ai.rect, cur.link.rect]))
  }
}
function stripBlock(src) {
  const a = src.indexOf('/* ===== TOPBAR ACCOUNT ('), b = src.indexOf('/* ===== TOPBAR ACCOUNT - end ===== */')
  return a < 0 || b < 0 ? src : src.slice(0, a) + src.slice(b + '/* ===== TOPBAR ACCOUNT - end ===== */'.length)
}

// ============================================================================================================ 2. the product page and the assistant
head('the product page keeps its Back-only top; the assistant is still in the page')
{
  const { m } = await real({ path: '/product/sgomma-t-shirt-navy', lang: 'en', w: 390 })
  is(!m.headerShown && m.link && !m.link.shown && m.count === 1, 'the product page shows no header, so no account icon (and no AI): the link is in the hidden header', JSON.stringify([m.headerShown, m.link && m.link.shown, m.count]))
}
const aiFlow = flow(async (srv, f) => {
  const t = (f.t = await open(srv, { path: '/shop', lang: 'en', w: 390 })), p = t.p
  f.before = await p.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="false"]'))
  await p.evaluate(() => document.querySelector('.app-header .navbar-ai').click())
  await p.waitForSelector('[role="dialog"][aria-modal="false"]', { timeout: 15000 })
  f.after = await p.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="false"]'))
  f.link = await p.evaluate(() => document.querySelectorAll('.app-header a.navbar-account').length)
})
{
  const f = await aiFlow({})
  is(holds((x) => x.before === false && x.after === true && x.link === 1, f), 'the hidden AI button still opens the assistant panel when pressed by script (nothing of the compiled header was removed), and the link stays one', f.error || JSON.stringify([f.before, f.after, f.link]))
}

// ============================================================================================================ 3. clicks
const clickFlow = flow(async (srv, f, { lang = 'en', w = 390 }) => {
  const t = (f.t = await open(srv, { path: '/shop', lang, w })), p = t.p
  await p.evaluate(() => { window.__sentinel = 'still-here'; window.__navs = 0 })
  f.mods = await p.evaluate(() => {
    const a = document.querySelector('a.navbar-account'), seen = []
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a.navbar-account')) { seen.push(e.defaultPrevented); e.preventDefault() } })
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mod }))
    return seen
  })
  await p.reload({ waitUntil: 'load' }); await p.waitForSelector('a.navbar-account'); await p.waitForTimeout(600)
  await p.evaluate(() => { window.__sentinel = 'still-here' })
  await p.click('a.navbar-account')
  await p.waitForURL(/\/account/); await p.waitForTimeout(700)
  f.after = await p.evaluate(() => ({ sentinel: window.__sentinel || null, path: location.pathname, count: document.querySelectorAll('a.navbar-account').length, current: (document.querySelector('a.navbar-account') || {}).ariaCurrent || document.querySelector('a.navbar-account').getAttribute('aria-current'), hasPage: !!document.querySelector('.customer-account, main') }))
  await p.evaluate(() => { window.__sentinel = 'still-here' })
  await p.click('.app-header a.navbar-logo'); await p.waitForURL((u) => u.pathname === '/'); await p.waitForTimeout(500)
  f.home = await p.evaluate(() => ({ sentinel: window.__sentinel || null, current: document.querySelector('a.navbar-account').getAttribute('aria-current') }))
  // the keyboard: a fresh page, Tab (the skip link) and Tab again (this link: the hidden AI button is not focusable), the ring, Enter
  await p.goto(srv.base + '/shop?lang=' + lang, { waitUntil: 'load' }); await p.waitForSelector('a.navbar-account'); await p.waitForTimeout(600)
  await p.evaluate(() => { window.__sentinel = 'still-here' })
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab')
  f.ring = await p.evaluate(() => { const a = document.querySelector('a.navbar-account'); const c = getComputedStyle(a); return { outline: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor, focused: document.activeElement === a } })
  await p.keyboard.press('Enter'); await p.waitForURL(/\/account/); await p.waitForTimeout(500)
  f.enter = await p.evaluate(() => ({ sentinel: window.__sentinel || null, path: location.pathname }))
  // hover: the icon turns the logo orange (a pointer that can hover; the touch emulation of the phone profile has none, so this runs on the desktop view only)
  if (w >= 1024) { await p.goto(srv.base + '/shop?lang=' + lang, { waitUntil: 'load' }); await p.waitForSelector('a.navbar-account'); await p.hover('a.navbar-account'); await p.waitForTimeout(350); f.hover = await p.evaluate(() => getComputedStyle(document.querySelector('a.navbar-account')).color) }
})
const CLICK = {
  mods: (f) => JSON.stringify(f.mods) === '[false,false,false,false,false]',
  spa: (f) => f.after.sentinel === 'still-here' && f.after.path === '/account' && f.after.count === 1 && f.after.current === 'page' && f.home.sentinel === 'still-here' && f.home.current === null,
  keys: (f) => f.ring.focused && /solid 2px rgb\(255, 123, 23\)/.test(f.ring.outline) && f.enter.path === '/account' && f.enter.sentinel === 'still-here',
  hover: (f) => f.hover === 'rgb(255, 123, 23)',
}
head('clicks: the router opens /account without reloading the shop')
for (const [lang, w] of [['en', 390], ['ar', 1280]]) {
  const f = await clickFlow({}, { lang, w })
  const tag = `${lang} ${w}px`
  if (f.error) console.log(`note ${tag}: the flow stopped early - ${f.error}`)
  is(holds(CLICK.mods, f), `${tag}: Ctrl, Meta, Shift, Alt and middle clicks are left to the browser (the handler does not prevent them)`, JSON.stringify(f.mods))
  is(holds(CLICK.spa, f), `${tag}: a click opens /account with the page still the same page (no reload), the link is marked aria-current there and not on the home page`, JSON.stringify([f.after, f.home]))
  is(holds(CLICK.keys, f), `${tag}: the focused link shows the 2px logo-orange ring and Enter opens /account the same way`, JSON.stringify([f.ring, f.enter]))
  if (w >= 1024) is(holds(CLICK.hover, f), `${tag}: hovering turns it the logo orange`, String(f.hover))
  is(f.errs.length === 0, `${tag}: no page error on the way`, f.errs.join(' | '))
}

// ============================================================================================================ 4. resilience
const keepFlow = flow(async (srv, f) => {
  const t = (f.t = await open(srv, { path: '/shop', lang: 'en', w: 390 })), p = t.p
  const read = () => p.evaluate(() => ({ n: document.querySelectorAll('.app-header a.navbar-account').length, label: (document.querySelector('.app-header a.navbar-account') || { getAttribute: () => null }).getAttribute('aria-label') }))
  f.start = await read()
  await p.click('.app-header .navbar-language'); await p.waitForTimeout(900)
  f.arabic = await read()
  await p.click('.app-header .navbar-language'); await p.waitForTimeout(900)
  f.english = await read()
  await p.evaluate(() => document.querySelector('.app-header a.navbar-account').remove()); await p.waitForTimeout(500)
  f.removed = await read()
  await p.evaluate(() => { const a = document.querySelector('.app-header a.navbar-account'); a.parentNode.insertBefore(a.cloneNode(true), a) }); await p.waitForTimeout(500)
  f.cloned = await read()
})
const KEEP = {
  lang: (f) => f.start.n === 1 && f.start.label === 'Account' && f.arabic.n === 1 && f.arabic.label === WORD.ar && f.english.n === 1 && f.english.label === 'Account',
  back: (f) => f.removed.n === 1,
  one: (f) => f.cloned.n === 1,
}
head('React re-rendering the header, a removed link, a second link')
{
  const f = await keepFlow({})
  if (f.error) console.log(`note: the flow stopped early - ${f.error}`)
  is(holds(KEEP.lang, f), 'the language toggle re-renders the header: still one link, and its word flips Account -> حسابي -> Account', f.error || JSON.stringify([f.start, f.arabic, f.english]))
  is(holds(KEEP.back, f), 'a link taken out of the page is put back', f.error || JSON.stringify(f.removed))
  is(holds(KEEP.one, f), 'a second link is removed: always one', f.error || JSON.stringify(f.cloned))
}

// ============================================================================================================ 5. mutants
head('mutants: with one rule cut, the matching check fails')
const cutBlock = (css, n) => {
  const a = css.indexOf(`/* [tacc-${n}]`)
  const next = [css.indexOf(`/* [tacc-${n + 1}]`, a), css.indexOf('/* end TOPBAR ACCOUNT 1120 */', a)].filter((x) => x > 0)
  return a < 0 ? css : css.slice(0, a) + css.slice(Math.min(...next))
}
const sub = (text, from, to) => (text.includes(from) ? text.replace(from, to) : text)
const CSSM = (n) => ({ css: { [CSS_F]: cutBlock(CSS, n) }, changed: cutBlock(CSS, n) !== CSS })
// every JS cut is made INSIDE this block (the file has other blocks with the very same lines, e.g. the receipt block's observers: a cut that hit those would prove nothing)
const A = FEAT.indexOf('/* ===== TOPBAR ACCOUNT ('), Z = FEAT.indexOf('/* ===== TOPBAR ACCOUNT - end ===== */'), BLOCK = FEAT.slice(A, Z)
const FEATM2 = (pairs) => ({ js: { [FEAT_F]: FEAT.slice(0, A) + pairs.reduce((b, [from, to]) => sub(b, from, to), BLOCK) + FEAT.slice(Z) }, changed: A > 0 && Z > A && pairs.every(([from]) => BLOCK.includes(from)) })
const FEATM = (from, to) => FEATM2([[from, to]])
const asOpts = (m) => (m.css ? { css: m.css } : { js: m.js })
// [label, the cut, how the page is measured, the check]
const MUT = [
  ['[tacc-1] the AI button is hidden', CSSM(1), { path: '/shop', lang: 'en', w: 390 }, ({ m }) => CHECK.aiGone(m)],
  ['[tacc-2] the link\'s box', CSSM(2), { path: '/shop', lang: 'en', w: 390 }, ({ m }) => CHECK.box(m) && CHECK.place(m)],
  ['[tacc-3] the icon\'s drawing', CSSM(3), { path: '/shop', lang: 'en', w: 390 }, ({ m }) => CHECK.icon(m)],
  ['[tacc-4] the page it opens is marked', CSSM(4), { path: '/account', lang: 'en', w: 390 }, ({ m }) => m.link.color === 'rgb(255, 123, 23)'],
  ['the block: no account link at all', FEATM("window.__sportaTopbarAccount = 1", "window.__sportaTopbarAccount = 1; return"), { path: '/shop', lang: 'en', w: 390 }, ({ m }) => CHECK.oneLink(m, 'en')],
  ['the language word: always English', FEATM("var text = english() ? TEXT.en : TEXT.ar", "var text = TEXT.en"), { path: '/shop', lang: 'ar', w: 390 }, ({ m }) => CHECK.oneLink(m, 'ar')],
  ['aria-current on /account is never set', FEATM("if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page')", 'void 0'), { path: '/account', lang: 'en', w: 390 }, ({ m }) => CHECK.current(m)],
  ['placed after the clock (the end of the cluster), not beside the AI button', FEATM("if (ai) tools.insertBefore(link, ai.nextSibling)", "if (ai) tools.appendChild(link)"), { path: '/shop', lang: 'en', w: 390 }, ({ m }) => CHECK.place(m) && Math.abs(m.link.rect.l - 64) <= 0.5],
]
const FLOWMUT = [
  ['the hand-off to the router (a plain click reloads the shop)', FEATM("if (tab && tab !== a) { e.preventDefault(); tab.click() }", 'void 0'), clickFlow, { lang: 'en', w: 390 }, CLICK.spa],
  ['the modifier guard', FEATM("if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return", "if (e.defaultPrevented) return"), clickFlow, { lang: 'en', w: 390 }, CLICK.mods],
  ['the one-link rule', FEATM("else all[i].parentNode.removeChild(all[i])", 'else void 0'), keepFlow, {}, KEEP.one],
  // the two observers cover each other (the build re-sets <html lang> on every render, which wakes the language observer, and a re-render of the header
  // wakes the body one), so each alone is not observable: both cut is
  ['both observers (a removed link is not put back, the word does not follow the toggle)', FEATM2([["new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })", 'void 0'], ["new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })", 'void 0']]), keepFlow, {}, (f) => KEEP.back(f) && KEEP.lang(f)],
]
for (const [label, m, o, check] of MUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found`); continue }
  is(holds(check, await real(o)), `mutant "${label}": the check passes on the real files`)
  is(!holds(check, await run(asOpts(m), o)), `mutant "${label}": and goes red with it cut`)
}
for (const [label, m, fl, o, check] of FLOWMUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found`); continue }
  const good = await fl({}, o)
  is(holds(check, good), `mutant "${label}": the check passes on the real files`, good.error || JSON.stringify(good).slice(0, 300))
  is(!holds(check, await fl(asOpts(m), o)), `mutant "${label}": and goes red with it cut`)
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
