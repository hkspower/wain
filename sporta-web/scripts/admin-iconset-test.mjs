// npm run test:admin-iconset - proves the ADMINICONS and ADMINALIGN sections of addons-src/sporta-admin-knet.css (the Sporta icon set
// on /backends, and the radius parity with the storefront) on the CAPTURED LIVE ADMIN: the real compiled markup under the real
// compiled rules (scripts/lib/admin-css-full-page.mjs: 13 screens, 4 editor modals, 7 more screens = 24 pages), every page at 390, 768,
// 1024 and 1280px, in English and in Arabic (RTL), each measured with the sections ON and OFF (the source with them cut out).
//
// Checks:
//   static      the section is what scripts/build-admin-iconset.mjs builds from brand/iconset and the map (no drift); one section,
//               before SIZES (which stays last); every selector under .admin-shell; the only url() are inline data:image/svg+xml;
//               public/sporta-admin-knet.css is the build of the source; the storefront sheet is not touched by the admin glyphs
//   inventory   every icon of the admin (every <svg> in .admin-shell) is painted with a Sporta glyph from the map: original shapes
//               hidden, glyph drawn through a mask, none left in the old drawing; each nav item and tab is the glyph the map names
//   box         the box of every icon is the old box, same position within 0.5px; the page is no taller, no wider
//   colour      the glyph is painted in currentColor: the active nav item in the accent, the others in slate, and on hover
//   sideways    no page scrolls sideways at any width, either direction
//   direction   only the returns U-turn turns in RTL; no glyph is mirrored in English
//   light       the Payments screen paints the same light surface under the dark switch with the sections ON as OFF
//   ink         the glyph really paints (a nav icon's pixels differ from the old drawing and from an empty box)
//   radius      ADMINALIGN: every field and every rounded-lg button of the content area is 12px (the storefront's), nested tiles keep 12
//   mutation    the sections removed must fail (icons: inventory and glyph checks; align: the radius check)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { serve, addons, knetSource, knetServed, ALL } from './lib/admin-css-full-page.mjs'
import { ROOT } from './lib/sizes-admin-page.mjs'
import { generated } from './build-addon-css.mjs'
import { section as iconSection, splice as iconSplice, START, END, SRC } from './build-admin-iconset.mjs'
import { glyphs } from './build-iconset.mjs'
import { BASE, REFINE, GLYPHS, EXPECT_NAV, EXPECT_TAB } from './lib/admin-iconset-rules.mjs'

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const NAME = 'sporta-admin-knet'
const SRCTXT = knetSource()
const cutBetween = (css, a, b) => { const i = css.indexOf(a), j = css.indexOf(b); return i < 0 || j < i ? css : css.slice(0, i) + css.slice(j + b.length).replace(/^\n+/, '') }
const NO_ICONS = cutBetween(SRCTXT, START, END)
const ALIGN_START = '/* ==== ADMINALIGN:'
const NO_ALIGN = SRCTXT.slice(0, SRCTXT.indexOf(ALIGN_START)) + SRCTXT.slice(SRCTXT.indexOf('/* ==== SIZES:'))
const built = (src) => generated(NAME, src)

// ---- static ------------------------------------------------------------------------------------------------------------
head('the sections and their sources')
{
  const sec = SRCTXT.slice(SRCTXT.indexOf(START), SRCTXT.indexOf(END) + END.length)
  is(SRCTXT.indexOf(START) > 0 && SRCTXT.indexOf(START, SRCTXT.indexOf(START) + 1) < 0, 'one ADMINICONS section')
  is(SRCTXT === iconSplice(SRCTXT, iconSection()), 'ADMINICONS is exactly what scripts/build-admin-iconset.mjs builds from brand/iconset and the map (no hand edits, no drift)')
  const sizes = SRCTXT.indexOf('/* ==== SIZES:')
  is(SRCTXT.indexOf(START) < SRCTXT.indexOf(ALIGN_START) && SRCTXT.indexOf(ALIGN_START) < sizes, 'ADMINICONS, then ADMINALIGN, both before SIZES')
  is(SRCTXT.indexOf('/* ==== SIZES:', sizes + 1) < 0 && SRCTXT.indexOf('/* ====', sizes + 5) < 0, 'SIZES is the last section of the file')
  const code = sec.replace(/\/\*[\s\S]*?\*\//g, '')
  const sels = code.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean)
  const bad = sels.filter((s) => !/^(\.admin-shell\b|:is\(\s*\.admin-shell\b)/.test(s) && !/^\[dir="rtl"\] \.admin-shell/.test(s))
  is(!bad.length, 'every selector of the section starts at .admin-shell: the storefront cannot be reached', bad.slice(0, 2).join(' | ').slice(0, 120))
  const urls = [...code.matchAll(/url\("?([^")]{0,30})/g)].map((m) => m[1])
  is(urls.length > 0 && urls.every((u) => u.startsWith('data:image/svg+xml')), 'the only url() are inline data:image/svg+xml glyphs', urls.filter((u) => !u.startsWith('data:image/svg+xml')).join())
  is(!/https?:\/\/(?!www\.w3\.org)/.test(code), 'no external address')
  is(!/!important/.test(code), 'no !important (the refinements win by specificity and order)')
  const G = glyphs()
  for (const n of GLYPHS) is(!!G[n], `glyph "${n}" has a source in brand/iconset`)
  for (const n of GLYPHS) is(sec.includes(`--sai-${n}:`) && sec.includes(`data-glyph='${n}'`) || sec.includes(`data-glyph=%27${n}%27`) || sec.includes(`data-glyph='${n}'`), `glyph "${n}" is in the section`)
  is(built(SRCTXT) === knetServed(), 'public/sporta-admin-knet.css is exactly the build of addons-src (npm run build:addon-css)')
  const shadows = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')
  is(!/--sai-|ADMINICONS/.test(shadows), 'the storefront sheet carries no admin glyph: its ICON SET stays what build-iconset.mjs produces')
  try { execSync('node scripts/build-iconset.mjs --check', { cwd: ROOT, stdio: 'pipe' }); is(true, 'storefront ICON SET and preview are current') } catch { is(false, 'storefront ICON SET and preview are current') }
}

// ---- pages --------------------------------------------------------------------------------------------------------------
const ref = { current: null }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const FILES = { on: addons(built(SRCTXT)), off: addons(built(NO_ICONS)), noalign: addons(built(NO_ALIGN)) }
const WIDTHS = [390, 768, 1024, 1280]

// in-page: everything measured, as plain data
const measure = () => {
  const r1 = (x) => Math.round(x * 10) / 10
  const flip = (el) => { let s = 1; for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.scale && cs.scale !== 'none' && parseFloat(cs.scale) < 0) s *= -1; if (cs.transform && cs.transform !== 'none' && new DOMMatrix(cs.transform).a < 0) s *= -1 } return s < 0 }
  const icons = []
  document.querySelectorAll('.admin-shell svg').forEach((el, i) => {
    if (el.parentElement.closest('svg')) return
    const rc = el.getBoundingClientRect(), cs = getComputedStyle(el)
    const mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : (cs.webkitMaskImage || '')
    const g = (decodeURIComponent(mask).match(/data-glyph='([\w-]+)'/) || [])[1] || ''
    const kids = [...el.children]
    const ctl = el.closest('.admin-sidebar__nav > button, .m-tabbar__item')
    icons.push({
      i, box: [r1(rc.left), r1(rc.top), r1(rc.width), r1(rc.height)], glyph: g, bg: cs.backgroundColor, color: cs.color,
      hidden: kids.length > 0 && kids.every((k) => getComputedStyle(k).visibility === 'hidden'), flipped: flip(el),
      nav: ctl && ctl.matches('.admin-sidebar__nav > button') ? ctl.textContent.trim() : '', tab: ctl && ctl.matches('.m-tabbar__item') ? ctl.textContent.trim() : '',
      active: !!(ctl && ctl.getAttribute('aria-current')), where: el.closest('button,label') ? (el.closest('button,label').getAttribute('aria-label') || el.closest('button,label').textContent.trim().slice(0, 24)) : '',
      shapes: kids.map((k) => k.tagName).join(','),
    })
  })
  // the admin's root font size is fluid (16.3px at 768, 16.8px at 1280), so its radii are read in rem: .75rem is the storefront's 12px
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const rem = (v) => Math.round(parseFloat(v) / rootPx * 1000) / 1000
  const radii = []
  document.querySelectorAll('.admin-shell .admin-content :is(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), select, textarea, button.rounded-lg)').forEach((e) => {
    const rc = e.getBoundingClientRect(); if (!rc.width || !rc.height) return
    if (!e.matches('.rounded-lg')) return
    radii.push(rem(getComputedStyle(e).borderTopLeftRadius))
  })
  const cards = []
  document.querySelectorAll('.admin-shell .admin-content :is(div, section, article).bg-white.border.rounded-xl').forEach((e) => {
    const rc = e.getBoundingClientRect(); if (!rc.width) return
    cards.push({ nested: !!e.parentElement.closest('.bg-white.border, [id*=preview], [class*=preview]'), r: rem(getComputedStyle(e).borderTopLeftRadius) })
  })
  const de = document.documentElement
  const ps = document.querySelector('.payment-settings'), pcs = ps ? getComputedStyle(ps) : null
  return { icons, radii, cards, h: de.scrollHeight, sw: de.scrollWidth, iw: window.innerWidth, pay: pcs ? [pcs.backgroundColor, pcs.color, getComputedStyle(document.body).backgroundColor] : null }
}

async function load(files, name, w, rtl, dark = false) {
  ref.current = files
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: w < 800 })
  const p = await ctx.newPage()
  await p.goto(`${base}/__fx/${name}?${rtl ? 'rtl=1&' : ''}${dark ? 'dark=1' : ''}`)
  await p.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  await p.evaluate(() => document.fonts.ready)
  return { p, ctx }
}
const readPage = async (files, name, w, rtl, dark = false) => { const { p, ctx } = await load(files, name, w, rtl, dark); const m = await p.evaluate(measure); await ctx.close(); return m }
const lum = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255 : -1 }
const near = (a, b, t = 0.5) => a.every((x, i) => Math.abs(x - b[i]) <= t)
const KNOWN = new Set(GLYPHS)

// the per-page checks of one stylesheet (`files`) against the baseline (`base`, sections OFF); returns the count of failed checks
async function checkAll(files, label, pages, widths, { full }) {
  const before = fail
  const seen = { icons: 0, pages: 0 }
  for (const name of pages) for (const w of widths) for (const rtl of [false, true]) {
    const id = `${name} ${w}px ${rtl ? 'ar' : 'en'}`
    const A = await readPage(files, name, w, rtl), B = await readPage(FILES.off, name, w, rtl)
    seen.pages++
    // inventory
    const unmapped = A.icons.filter((x) => !KNOWN.has(x.glyph) || !x.hidden)
    is(unmapped.length === 0, `${label} ${id}: every icon is a Sporta glyph from the map (${A.icons.length} icons)`, unmapped.slice(0, 2).map((x) => `${x.where || x.nav || x.tab}[${x.shapes}] glyph=${x.glyph} hidden=${x.hidden}`).join(' | '))
    seen.icons += A.icons.length
    if (!full) continue
    is(A.icons.length === B.icons.length, `${id}: same number of icons ON and OFF`)
    const boxBad = A.icons.filter((x, k) => !B.icons[k] || !near(x.box, B.icons[k].box))
    is(boxBad.length === 0, `${id}: every icon keeps its box and position (0.5px)`, boxBad.slice(0, 2).map((x) => x.box.join(',') + ' vs ' + (B.icons[x.i] || {}).box).join(' | '))
    is(A.h <= B.h + 0.5 && A.h >= B.h - 0.5, `${id}: the page is the same height (${A.h} / ${B.h})`)
    is(A.sw <= A.iw && A.sw <= B.sw, `${id}: no sideways scroll (${A.sw} in ${A.iw})`)
    const colBad = A.icons.filter((x) => x.bg !== x.color)
    is(colBad.length === 0, `${id}: every glyph is painted in currentColor`, colBad.slice(0, 2).map((x) => x.bg + ' / ' + x.color).join(' | '))
    const nav = A.icons.filter((x) => x.nav), tabs = A.icons.filter((x) => x.tab)
    for (const x of nav) if (x.nav in EXPECT_NAV) is(x.glyph === EXPECT_NAV[x.nav], `${id}: nav "${x.nav}" is "${EXPECT_NAV[x.nav]}"`, x.glyph)
    for (const x of tabs) if (x.tab in EXPECT_TAB) is(x.glyph === EXPECT_TAB[x.tab], `${id}: tab "${x.tab}" is "${EXPECT_TAB[x.tab]}"`, x.glyph)
    for (const x of A.icons.filter((y) => y.where === 'Close')) is(x.glyph === 'close', `${id}: Close is "close"`, x.glyph)
    for (const x of A.icons.filter((y) => y.where === 'Choose logo')) is(x.glyph === 'image', `${id}: "Choose logo" is "image"`, x.glyph)
    const act = nav.filter((x) => x.active)
    for (const x of act) { const m = /rgb\((\d+), (\d+), (\d+)/.exec(x.color); is(m && +m[1] > +m[3] + 40, `${id}: the active nav item's glyph is in the accent, not slate`, x.color) }
    const flipped = A.icons.filter((x) => x.flipped).map((x) => x.glyph), flippedOff = B.icons.filter((x) => x.flipped).length
    is(flippedOff === 0, `${id}: nothing is mirrored by the old drawing`)
    if (rtl) is(flipped.every((g) => g === 'returns') && flipped.length === A.icons.filter((x) => x.glyph === 'returns').length, `${id}: in Arabic exactly the returns U-turn turns`, flipped.join())
    else is(flipped.length === 0, `${id}: in English nothing turns`, flipped.join())
    // radius
    const r = A.radii.filter((x) => Math.abs(x - 0.75) > 0.005)
    is(r.length === 0, `${id}: every field and rounded-lg button is .75rem = 12px (${A.radii.length} measured)`, [...new Set(r)].join())
    const c = A.cards.filter((x) => !x.nested && Math.abs(x.r - 0.875) > 0.005)
    is(c.length === 0, `${id}: top-level cards are .875rem = 14px`, [...new Set(c.map((x) => x.r))].join())
    const nA = A.cards.filter((x) => x.nested).map((x) => x.r), nB = B.cards.filter((x) => x.nested).map((x) => x.r)
    is(nA.join() === nB.join(), `${id}: nested tiles keep the radius they had (${nA.length})`, [...new Set(nA)].join() + ' vs ' + [...new Set(nB)].join())
  }
  return fail - before
}

head('every admin screen, 4 widths, English and Arabic, sections ON against OFF')
await checkAll(FILES.on, 'ON', ALL, WIDTHS, { full: true })

head('hover, active, dark and light-only')
{
  for (const rtl of [false, true]) {
    const { p, ctx } = await load(FILES.on, 'overview', 1280, rtl)
    const items = await p.$$('.admin-sidebar__nav > button')
    const probe = async (el) => el.evaluate((e) => { const s = e.querySelector('svg'), cs = getComputedStyle(s); return [cs.backgroundColor, cs.color, getComputedStyle(e).backgroundColor] })
    const [bg0, c0] = await probe(items[1])
    await items[1].hover(); await p.waitForTimeout(30)
    const [bg1, c1, b1] = await probe(items[1])
    is(bg1 === c1, `${rtl ? 'ar' : 'en'}: on hover the glyph still follows currentColor (${c1})`, bg1 + ' / ' + c1)
    is(bg0 === c0, `${rtl ? 'ar' : 'en'}: at rest the glyph follows currentColor (${c0})`)
    is(!!b1, 'hovered nav item has a background')
    // the active item against the others
    const [abg, ac] = await probe(items[0])
    is(abg === ac && ac !== c0, `${rtl ? 'ar' : 'en'}: the active item's glyph colour (${ac}) differs from a resting item's (${c0})`)
    // ink: the painted pixels differ from the old drawing, and from an empty box
    const clip = await items[1].evaluate((e) => { const r = e.querySelector('svg').getBoundingClientRect(); return { x: r.left - 2, y: r.top - 2, width: r.width + 4, height: r.height + 4 } })
    const on = await p.screenshot({ clip })
    await ctx.close()
    const q = await load(FILES.off, 'overview', 1280, rtl)
    const items2 = await q.p.$$('.admin-sidebar__nav > button')
    const off = await q.p.screenshot({ clip: await items2[1].evaluate((e) => { const r = e.querySelector('svg').getBoundingClientRect(); return { x: r.left - 2, y: r.top - 2, width: r.width + 4, height: r.height + 4 } }) })
    await q.p.evaluate(() => document.querySelectorAll('.admin-nav-item svg > *').forEach((k) => { k.style.visibility = 'hidden' }))
    const empty = await q.p.screenshot({ clip: await items2[1].evaluate((e) => { const r = e.querySelector('svg').getBoundingClientRect(); return { x: r.left - 2, y: r.top - 2, width: r.width + 4, height: r.height + 4 } }) })
    await q.ctx.close()
    is(!on.equals(off), `${rtl ? 'ar' : 'en'}: the new glyph's pixels differ from the old drawing's`)
    is(!on.equals(empty), `${rtl ? 'ar' : 'en'}: the new glyph really paints (not an empty box)`)
  }
  for (const w of [1280, 390]) for (const dark of [false, true]) for (const rtl of [false, true]) {
    const A = await readPage(FILES.on, 'payments', w, rtl, dark), B = await readPage(FILES.off, 'payments', w, rtl, dark)
    is(A.pay && B.pay && A.pay.join() === B.pay.join(), `payments ${w}px ${dark ? 'dark switch' : 'light'} ${rtl ? 'ar' : 'en'}: the surface and text colours are the same ON and OFF`, A.pay && A.pay.join(' | '))
    is(A.pay && lum(A.pay[0]) > 0.85 || (A.pay && lum(A.pay[2]) > 0.85), `payments ${w}px ${dark ? 'dark switch' : 'light'} ${rtl ? 'ar' : 'en'}: the screen stays light`, A.pay && A.pay.join(' | '))
    is(A.icons.every((x) => KNOWN.has(x.glyph)), `payments ${w}px ${dark ? 'dark' : 'light'} ${rtl ? 'ar' : 'en'}: its icons are the Sporta glyphs too`)
  }
}

head('mutation: the sections removed must fail')
{
  const SUB = ['overview', 'orders-sheet', 'catalogue-form', 'inventory']
  const a = fail, ap = pass
  const f1 = await checkAll(FILES.off, 'NO-ICONS', SUB, [1280], { full: false })
  const f2 = fail
  const f3 = await checkAll(FILES.noalign, 'NO-ALIGN', ['catalogue-form', 'discounts-form'], [1280], { full: true })
  // the mutants are meant to fail: take their failures back out of the totals
  const mutIcons = f1, mutAlign = fail - f2
  fail = a; pass = ap; fails.length = Math.min(fails.length, a)
  is(mutIcons >= 8, `the stylesheet without ADMINICONS fails the inventory (${mutIcons} checks)`)
  is(mutAlign >= 2, `the stylesheet without ADMINALIGN fails the radius checks (${mutAlign} checks)`)
}

await browser.close(); server.close()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('\n' + fails.slice(0, 25).map((f) => 'FAIL ' + f).join('\n')); process.exit(1) }
