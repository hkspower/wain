// NAMES-1119: one name style on every surface (owner, 2026-11-19: "make product name style improve").
//   public/sporta-features.js  NAMES-1119   a line never starts with a dash
//   public/sporta-shadows.css  NAMES-1119   the bag page and the drawer name a product like the cards and the product page do
//
//   npm run test:product-names     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled storefront under the add-on files of this repo, Arabic and English:
//   [nm-1] cards (/shop's first 12 real products, three of them renamed), the product title, the bag page's lines and the bag drawer's lines:
//          no rendered line of a name begins with a dash (every character of every name is measured, line by line), at 320-1280 px
//          (/shop shows its first 12 cards before "Show more")
//   [nm-2] the bag page and the drawer capitalise an English name ("cloudsoft jacket - cherry red" reads "Cloudsoft Jacket - Cherry Red",
//          as on the card) and do not touch Arabic
//   [nm-3] the glue is stable: after load the observer does not keep rewriting a name; a language switch (React rewrites every name) is glued again
//   the name text read by a person is unchanged apart from the no-break space; no page error
// MUTATION: the script block not run (orphan dashes come back) and the CSS section cut (the bag names are not capitalised).
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const JS = readFileSync(join(PUB, 'sporta-features.js'), 'utf8')
const CSS = readFileSync(join(PUB, 'sporta-shadows.css'), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// static
head('static')
const A = JS.indexOf('/* ===== NAMES-1119:'), Z = JS.indexOf('/* ===== NAMES-1119 - end')
const BLOCK = JS.slice(A, Z)
is(A > 0 && Z > A && A < JS.indexOf('Product names: the full name as a tooltip'), 'the NAMES-1119 block is in sporta-features.js, before the tooltip block (which stays the last of the name blocks)')
is(!/innerHTML|outerHTML|insertAdjacentHTML|\.src\s*=|fetch\(|XMLHttpRequest|localStorage|sessionStorage|createElement/.test(BLOCK), 'the block writes no markup, no src, makes no request and stores nothing (it only rewrites the text of a name)')
is(/\/backends/.test(BLOCK) && /__sportaNameGlue/.test(BLOCK), 'the block stands down on /backends and runs once per page')
const S0 = CSS.indexOf('/* ==== NAMES-1119'), S1 = CSS.indexOf('/* ==== end NAMES-1119 */')
is(S0 > CSS.indexOf('/* ==== end NAMES-1111 */') && S1 > S0 && S0 < CSS.indexOf('/* ==== GRID-1111'), 'NAMES-1119 is one section of sporta-shadows.css, right after NAMES-1111')
is(!/https?:\/\//.test(CSS.slice(S0, S1)), 'no external URL in the section')

// made-up names that put the colour after a dash in the places a break lands, a lowercase one and a long unbroken code
const MADE = {
  'cloudsoft-jacket-coffee-brown': { name_en: 'cloudsoft jacket – cherry red edition', name_ar: 'جاكيت كلاودسوفت – أحمر كرزي' },
  'sgomma-t-shirt-navy': { name_en: 'AIRMAX-90-ULTRA-LONGCODE-0001 — Blue', name_ar: 'تيشيرت سغوما الطويل جداً للتدريب — كحلي' },
  'cloudsoft-leggings-army-green': { name_en: 'Cloudsoft Leggings — Army Green', name_ar: 'ليقنز كلاودسوفت — أخضر عسكري' },
}
const products = (body) => body.map((p) => (MADE[p.slug] ? { ...p, ...MADE[p.slug] } : p))
const BAG = [
  ['cloudsoft-jacket-coffee-brown', 'M', 'cloudsoft jacket - cherry red', 'جاكيت كلاودسوفت – أحمر كرزي', 10, 2],
  ['sgomma-t-shirt-navy', 'XL', 'Sgomma T-Shirt — Navy Blue', 'تيشيرت سغوما — كحلي', 5, 1],
  ['cloudsoft-leggings-army-green', 'L', 'Cloudsoft Leggings — Army Green', 'ليقنز كلاودسوفت — أخضر عسكري', 8, 1],
].map(([slug, size, en, ar, price, qty]) => ({ key: `${slug}__${size}__-`, slug, size, fit: null, name: { en, ar }, price, image: '/product-photo-unavailable.svg', qty }))

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive({ api: { products }, ...opts }); try { return await fn(srv) } finally { await srv.close() } }
const open = async (srv, { w, lang, path, bag = false }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  if (bag) await ctx.addInitScript((c) => { try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('sporta_cart', JSON.stringify(c)); sessionStorage.setItem('__seeded', '1') } } catch (e) {} }, BAG)
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'load' })
  await p.evaluate(() => document.fonts.ready)
  return { ctx, p, errs }
}

// every name of a page: its text, and the first visible character of each rendered line
const MEASURE = (sel) => {
  const dash = /[—–-]/
  const res = []
  for (const el of document.querySelectorAll(sel)) {
    const lines = []; let lastTop = -1e9; let text = ''
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const t = walker.currentNode, s = t.nodeValue; text += s
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) continue
        const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1)
        const q = r.getClientRects()[0]; if (!q || q.width === 0) continue
        if (q.top > lastTop + 4) { lines.push(s[i]); lastTop = q.top }
      }
    }
    const cs = getComputedStyle(el)
    res.push({ text, lines: lines.length, orphan: lines.some((c) => dash.test(c)), tt: cs.textTransform, hasDash: / [—–-] /.test(text.replace(/ /g, ' ')), glued: / [—–-] /.test(text), raw: / [—–-] /.test(text), over: el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline' })
  }
  return { names: res, over: document.documentElement.scrollWidth - innerWidth }
}
const SEL = {
  card: '.storefront-root .catalog-card-name',
  title: '.storefront-root .catalog-product-title',
  line: '.storefront-root .cart-line h3',
  drawer: '.campaign-cart-drawer .cart-drawer__line .min-w-0 > p:first-child',
}
const read = async (opts, o, sel, after) => withServer(opts, async (srv) => {
  const t = await open(srv, o)
  await t.p.waitForSelector(sel, { timeout: 20000 }).catch(() => {})
  await t.p.waitForTimeout(1200)
  if (after) await after(t.p)
  const m = await t.p.evaluate(MEASURE, sel)
  await t.ctx.close()
  return { ...m, errs: t.errs }
})
const openDrawer = async (p) => {
  await p.locator('.app-header button.navbar-cart').click()
  await p.waitForFunction(() => { const d = document.querySelector('.campaign-cart-drawer'); return d && !d.hasAttribute('inert') })
  await p.waitForTimeout(700)
}

const SURFACES = [
  ['card', '/shop', [320, 390, 768, 1280], false, null],
  ['title', '/product/cloudsoft-leggings-army-green', [320, 390, 768, 1280], false, null],
  ['line', '/cart', [360, 390, 1280], true, null],
  ['drawer', '/shop', [390, 1280], true, openDrawer],
]
head('every name, every line')
let orphansSeen = 0, dashNames = 0
for (const [kind, path, widths, bag, after] of SURFACES) for (const lang of ['ar', 'en']) for (const w of widths) {
  const tag = `${kind} ${lang} ${w}px`
  const m = await read({}, { w, lang, path, bag }, SEL[kind], after)
  const bad = m.names.filter((n) => n.orphan)
  is(m.names.length >= (kind === 'card' ? 12 : kind === 'title' ? 1 : 3), `${tag}: the names are on the page (${m.names.length})`)
  is(bad.length === 0, `${tag}: no line of a name begins with a dash (${m.names.length} names checked)`, bad.slice(0, 3).map((n) => n.text).join(' | '))
  is(m.over <= 0 && m.errs.length === 0, `${tag}: no sideways scroll, no page error`, `${m.over}px ${m.errs.join('|')}`)
  const withDash = m.names.filter((n) => n.hasDash)
  dashNames += withDash.length
  is(withDash.every((n) => n.glued && !n.raw), `${tag}: every name with a spaced dash has it joined to the word before (${withDash.length} such names)`, withDash.filter((n) => !n.glued || n.raw).slice(0, 2).map((n) => n.text).join(' | '))
  if (kind === 'line' || kind === 'drawer') {
    const want = lang === 'en' ? 'capitalize' : 'none'
    is(m.names.every((n) => n.tt === want), `${tag}: the name's text-transform is "${want}", as on the cards`, m.names.map((n) => n.tt).join(','))
  }
}
is(dashNames > 20, 'the pages carried names with a dash (so the checks above were not empty)', String(dashNames))

head('stable, and glued again after React rewrites the names')
await withServer({}, async (srv) => {
  const t = await open(srv, { w: 390, lang: 'en', path: '/shop' })
  await t.p.waitForSelector(SEL.card, { timeout: 20000 }); await t.p.waitForTimeout(1500)
  const writes = await t.p.evaluate(() => new Promise((res) => {
    let n = 0
    const mo = new MutationObserver((recs) => { for (const r of recs) if (r.type === 'characterData' && r.target.parentElement && r.target.parentElement.classList.contains('catalog-card-name')) n++ })
    mo.observe(document.body, { subtree: true, characterData: true })
    setTimeout(() => { mo.disconnect(); res(n) }, 900)
  }))
  is(writes === 0, `after load the glue does not keep rewriting the names (${writes} text writes in 900 ms)`)
  await t.p.locator('.app-header .navbar-language').first().click()
  await t.p.waitForTimeout(1200)
  const m = await t.p.evaluate(MEASURE, SEL.card)
  const lang = await t.p.evaluate(() => document.documentElement.lang)
  const withDash = m.names.filter((n) => n.hasDash)
  is(lang === 'ar' && withDash.length >= 5 && withDash.every((n) => n.glued && !n.raw), `after the language switch React wrote ${m.names.length} new names and each dash is joined again (${lang}, ${withDash.length} with a dash)`)
  is(m.names.every((n) => !n.orphan), 'and no line begins with a dash')
  await t.ctx.close()
})

head('mutants')
{
  is(A > 0 && Z > A, 'the NAMES-1119 script block is in the file')
  const nojs = JS.slice(0, A) + JS.slice(Z)
  let seen = 0
  for (const [kind, path, w, lang] of [['card', '/shop', 390, 'en'], ['card', '/shop', 390, 'ar'], ['card', '/shop', 1280, 'en'], ['title', '/product/cloudsoft-leggings-army-green', 320, 'en'], ['title', '/product/cloudsoft-leggings-army-green', 390, 'en']]) {
    const m = await read({ js: { 'sporta-features.js': nojs } }, { w, lang, path }, SEL[kind])
    seen += m.names.filter((n) => n.orphan).length
  }
  is(seen > 0, `mutant "script block not run": lines that begin with a dash come back (${seen} names)`)
  const nocss = CSS.slice(0, S0) + CSS.slice(S1 + '/* ==== end NAMES-1119 */'.length)
  const m = await read({ css: { 'sporta-shadows.css': nocss } }, { w: 390, lang: 'en', path: '/cart', bag: true }, SEL.line)
  is(m.names.some((n) => n.tt !== 'capitalize'), 'mutant "CSS cut": the bag page no longer capitalises the names', m.names.map((n) => n.tt).join(','))
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
