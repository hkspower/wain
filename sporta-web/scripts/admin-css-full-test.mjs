// "Full improve css all", scope /backends (owner request 2026-11-10): section 10 of addons-src/sporta-admin-knet.css, the colour
// tokens of sections 0 to 7 and the "showing, not mounted" scope of section 9 - proven on the markup of the REAL compiled admin
// under the REAL compiled rules, in Chromium.
//
//   node scripts/admin-css-full-test.mjs        (rig-free: committed fixtures, the real add-on files, the real fonts; no server,
//                                                database or dist/. Suggested package.json line: "test:admin-css-full")
//
// Pages (lib/admin-css-full-page.mjs): the 13 screens and 4 editor modals of scripts/fixtures/sizes-admin and the Orders sheet,
// Returns, CRM, Support, Profiles, Theme and SEO of scripts/fixtures/admin-css-full (scripts/make-admin-css-full-fixtures.mjs),
// at 320 / 360 / 390 (touch phones), 768 (touch tablet), 768 and 1280 (mouse), left-to-right and right-to-left, light and dark.
// A dark page carries the live build's own dark rules (scripts/fixtures/admin-dark-rules.css) last, as the live page does.
//
// The blocks and what is asserted for each (the number in brackets is the block that makes the check pass):
//   [full-1]   dark theme, every screen but Payments: no text run under WCAG AA (4.5:1, 3:1 for large text) on any screen, the page
//              and the content area are the build's dark page colour, the fourteen --ak-* tokens are defined on the shell;
//              and they are NOT defined in the light theme nor while Payments shows (so those are computed as before)
//   [full-1b]  dark: rose / red text, text-brand-dark and the Inventory ledger line reach AA
//   [full-2]   dark: the Brands tagger and the per-brand count line (inline-styled by the add-on script) reach AA; the two lists are dark
//   [full-3]   768px with a touch screen: every button in the content area, the sidebar's buttons and every bordered field >= 44px
//   [full-4]   touch: a flex label around a checkbox / radio, a tagger row, the "All" pill, "Edit" / "Remove" >= 44px; the
//              "View on site" link takes a tap 12px above and below its text
//   [full-5]   the order sheet at 320 and 360px: no field past the sheet, no sideways scroll, a 70-character value wraps
//   [full-6]   monospace values in the order sheet are not capitalised
//   [full-7]   light: the "no value" dash, the tagger's second line and "Sign out" reach AA
//   [full-8]   keyboard focus: a 2px ring, >= 3:1 against what is behind it, on checkboxes, class-less fields and selects, light and dark
//   [full-9]   no screen scrolls sideways at any width in either direction (Inventory at 320px and the SEO fieldsets did)
//   [full-10]  editor modals: max-height follows the dynamic viewport and never exceeds the screen
//   [scope-9]  Payments visited, then another screen: the Payments section is still in the page under [hidden] and the other
//              screen is dark, not section 9's white (the leak this pass closed); Payments itself showing is untouched
// MUTATION. Every case is measured with the stylesheet as it is, with each block cut on its own, and as "legacy" (section 10 cut
// and section 9's old scope back): the checks of a block must FAIL without the block, and all of them without the section.
// NOT claimed: the layout of Returns, CRM, Support, Profiles, Theme, SEO and Top bar (their own stylesheets are in no capture;
// those fixtures prove that a selector matches real markup, and the colours the add-on itself forces); the sign-in screen (it is
// outside .admin-shell and no add-on rule reaches it); anything that needs a real address bar (the dvh behaviour of [full-10]).
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium); ADMIN_CSS_FULL_VERBOSE=1 prints every failing case.
import { chromium } from 'playwright'
import postcss from 'postcss'
import { NAMES as SIZES_NAMES } from './lib/sizes-admin-page.mjs'
import { ALL, MARKUP_ONLY, KNET, addons, serve, knetSource, knetServed } from './lib/admin-css-full-page.mjs'
import { generated } from './build-addon-css.mjs'

const SRC = knetSource()
const VERBOSE = process.env.ADMIN_CSS_FULL_VERBOSE === '1'
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ------------------------------------------------------------------------------------------------ the section and its blocks
const S10 = '/* ==========================================================================\n   10. Full pass', SIZES = '/* ==== SIZES:'
const a10 = SRC.indexOf(S10), aSizes = SRC.indexOf(SIZES)
const SECTION = SRC.slice(a10, aSizes)
const marks = [...SECTION.matchAll(/\/\* \[(full-\d+b?)\]/g)]
const BLOCKS = marks.map((m, i) => ({ id: m[1], start: m.index, end: i + 1 < marks.length ? marks[i + 1].index : SECTION.length }))
const NEW_SCOPE = '.admin-content:has(.payment-settings):not(:has([hidden] .payment-settings))', OLD_SCOPE = '.admin-content:has(.payment-settings)'
const cut = (id) => { const b = BLOCKS.find((x) => x.id === id); return SRC.slice(0, a10) + SECTION.slice(0, b.start) + SECTION.slice(b.end) + SRC.slice(aSizes) }
const VARIANT = { after: SRC, legacy: (SRC.slice(0, a10) + SRC.slice(aSizes)).split(NEW_SCOPE).join(OLD_SCOPE), 'scope-9': SRC.split(NEW_SCOPE).join(OLD_SCOPE) }
for (const b of BLOCKS) VARIANT[b.id] = cut(b.id)
const TAGS = [...BLOCKS.map((b) => b.id), 'scope-9']

head('Static: section 10 of addons-src/sporta-admin-knet.css')
is(generated('sporta-admin-knet', SRC) === knetServed(), 'the served public/sporta-admin-knet.css is exactly the build of addons-src (npm run build:addon-css)')
is(a10 > 0 && aSizes > a10 && SRC.indexOf('9. Light only') < a10, 'section 10 exists, after section 9 and before the SIZES section (which must stay last)')
is(BLOCKS.map((b) => b.id).join() === 'full-1,full-1b,full-2,full-3,full-4,full-5,full-6,full-7,full-8,full-9,full-10', 'eleven numbered blocks, [full-1] to [full-10], in order', BLOCKS.map((b) => b.id).join())
{
  const DARK = ':is(html.dark, html[data-theme="dark"]) .admin-shell'
  const root = postcss.parse(SECTION), badSel = [], physical = [], bang = []
  let nRules = 0
  root.walkRules((r) => {
    nRules++
    for (const s of r.selectors) { const t = s.replace(/\s+/g, ' ').trim(); if (!(t.startsWith('.admin-shell') || t.startsWith(DARK))) badSel.push(t.slice(0, 70)) }
    r.walkDecls((d) => {
      if (/^(padding|margin|border)-(left|right)|^(left|right)$|^text-align$/.test(d.prop) && !/^(start|end|center)$/.test(d.value)) physical.push(d.prop)
      if (d.important) bang.push(d)
    })
  })
  is(nRules >= 25, `the section has its rules (${nRules} rules, ${bang.length} !important declarations)`)
  is(!badSel.length, 'every selector starts at .admin-shell, or at the build\'s dark switch and then .admin-shell: nothing can reach the storefront', badSel.slice(0, 3).join(' | '))
  is(!physical.length, 'logical properties only (no left / right): it mirrors in Arabic', physical.join())
  is(!/url\(|@import|@font-face/.test(SECTION), 'no url(), no @import, no @font-face')
  // the tokens: every --ak-* used anywhere in the file is defined by the one [full-1] rule, and nowhere else
  const used = new Set([...SRC.matchAll(/var\((--ak-[\w-]+)/g)].map((m) => m[1])), defined = new Set(), where = new Set()
  postcss.parse(SRC).walkDecls(/^--ak-/, (d) => { defined.add(d.prop); where.add(d.parent.selector.replace(/\s+/g, ' ')) })
  is(used.size === 14 && [...used].every((t) => defined.has(t)) && [...defined].every((t) => used.has(t)), `the ${used.size} --ak-* tokens the file reads are exactly the ones [full-1] defines`, [...used].filter((t) => !defined.has(t)).concat([...defined].filter((t) => !used.has(t))).join())
  is(where.size === 1 && [...where][0].startsWith(DARK) && /:has\(\[hidden\] \.payment-settings\)/.test([...where][0]), 'they are defined in ONE rule: the dark switch, the shell, and not while the Payments screen is showing', [...where].join(' | ').slice(0, 160))
  const noFallback = [...SRC.slice(0, a10).matchAll(/var\(--ak-[\w-]+\s*\)/g)].length
  is(noFallback === 0, 'above section 10 every var(--ak-*) carries its light fallback (so the light theme needs no token)')
  is(!SRC.slice(SRC.indexOf('9. Light only'), a10).split('/*').slice(1).map((c) => c.slice(c.indexOf('*/') + 2)).join('').includes(OLD_SCOPE + ')') && SRC.slice(0, a10).split(NEW_SCOPE).length - 1 >= 15, 'section 9 scopes its content-area rules to Payments SHOWING (not inside [hidden])')
}

// ------------------------------------------------------------------------------------------------ measurements (in the page)
const measure = () => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const cs = (e, p) => getComputedStyle(e, p)
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let p = e; p; p = p.parentElement) { const q = cs(p); if (q.display === 'none' || q.visibility === 'hidden' || +q.opacity === 0) return false } return true }
  const cls = (e) => String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().replace(/\s+/g, ' ')
  const id = (e) => (e.tagName.toLowerCase() + '.' + cls(e).split(' ').slice(0, 4).join('.')).slice(0, 70)
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const parse = (s) => { const m = s.match(/^rgba?\(([^)]+)\)$/); if (m) { const p = m[1].split(/[ ,/]+/).map(parseFloat); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]] } cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const dark = document.documentElement.classList.contains('dark')
  // what is painted behind an element: its ancestors' backgrounds composited, down to the canvas
  const bgOf = (e) => {
    const stack = []
    for (let p = e; p; p = p.parentElement) {
      const c = cs(p); let b = parse(c.backgroundColor)
      if (b[3] === 0 && /gradient/.test(c.backgroundImage)) { const m = c.backgroundImage.match(/rgba?\([^)]+\)/g); if (m) b = parse(m[m.length - 1]) }
      if (b[3] > 0) { stack.push(b); if (b[3] >= 1) break }
    }
    let base = dark ? [18, 18, 18] : [255, 255, 255]
    for (const s of stack.reverse()) base = [0, 1, 2].map((i) => s[i] * s[3] + base[i] * (1 - s[3]))
    return base
  }
  const shell = $('.admin-shell'), content = $('.admin-content')
  const out = { vw: document.documentElement.clientWidth, vh: innerHeight, docW: document.documentElement.scrollWidth }
  const tok = (e) => ['--ak-page', '--ak-soft', '--ak-th', '--ak-surface', '--ak-chip', '--ak-chip-h', '--ak-hair', '--ak-edge', '--ak-edge-h', '--ak-ink', '--ak-ink2', '--ak-meta', '--ak-accent', '--ak-danger'].filter((t) => cs(e).getPropertyValue(t).trim() !== '').length
  out.tokens = tok(shell); out.tokensContent = tok(content)
  out.shellLum = lum(parse(cs(shell).backgroundColor)); out.contentLum = lum(parse(cs(content).backgroundColor)); out.contentBg = cs(content).backgroundColor
  out.contentScheme = cs(content).colorScheme; out.adminBg = cs(content).getPropertyValue('--admin-bg').trim()
  // every visible text run under AA, classified by what it is
  out.low = []; out.nText = 0
  $$('body *').forEach((e) => {
    if (e.closest('svg') || e.closest('[class*="__preview"]') || e.closest('.sr-only') || /(^| )sr-only( |$)/.test(cls(e))) return
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || !vis(e)) return
    if (e.closest(':disabled, [aria-disabled="true"]')) return
    out.nText++
    const c = cs(e), fs = parseFloat(c.fontSize), fg = parse(c.color), bg = bgOf(e)
    const ink = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])), cr = ratio(ink, bg)
    if (cr >= (fs >= 24 || (fs >= 18.66 && +c.fontWeight >= 700) ? 3 : 4.5)) return
    const k = e.closest('[data-sporta-brand-tagger]') ? (e.matches('label[data-hay] > span + span') ? 'taggerMeta' : 'tagger') : e.closest('[data-sporta-brand-stats]') ? 'stats'
      : /(^| )text-(rose|red)-/.test(cls(e)) ? 'rose' : /(^| )text-brand-dark( |$)/.test(cls(e)) ? 'brandDark' : e.matches('.inventory-ledger-mini') ? 'ledger'
      : /(^| )text-slate-300( |$)/.test(cls(e)) ? 'dash' : e.closest('.admin-sidebar') && e.matches('button:not(.admin-nav-item)') ? 'signOut' : 'other'
    out.low.push({ k, s: `${id(e)} ${cr.toFixed(2)}:1 "${e.textContent.trim().slice(0, 16)}"` })
  })
  const kinds = (sel) => $$(sel).filter(vis).length
  out.has = { rose: kinds('[class^="text-rose-"], [class*=" text-rose-"], [class^="text-red-"], [class*=" text-red-"]'), brandDark: kinds('.text-brand-dark'), ledger: kinds('.inventory-ledger-mini'), tagger: kinds('[data-sporta-brand-tagger] p'), stats: kinds('[data-sporta-brand-stats] span'), dash: kinds('.admin-content .text-slate-300:not(svg)'), taggerMeta: kinds('[data-sporta-brand-tagger] label[data-hay] > span + span'), signOut: kinds('.admin-sidebar button:not(.admin-nav-item)') }
  out.taggerLists = $$('[data-sporta-brand-tagger] [data-sporta-tag-products]').filter(vis).map((e) => lum(parse(cs(e).backgroundColor)))
  // tap targets
  const box = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, s: `${id(e)} ${Math.round(r.width)}x${Math.round(r.height)} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 14)}"` } }
  const inPrev = (e) => !!e.closest('[class*="__preview"]')
  out.buttons = $$('button', content).filter((e) => vis(e) && !inPrev(e)).map(box)
  out.closes = $$('button.text-slate-400', content).filter(vis).map(box)
  out.sideButtons = $$('.admin-sidebar button').filter(vis).map(box)
  out.fields = $$('input, select', content).filter((e) => vis(e) && !inPrev(e) && !['checkbox', 'radio', 'hidden', 'file', 'range', 'color'].includes((e.type || '').toLowerCase()) && /(^| )border( |$)|(^| )border-slate-/.test(cls(e))).map(box)
  out.labels = $$('label', content).filter((e) => vis(e) && !inPrev(e) && /(^| )(inline-)?flex( |$)/.test(cls(e)) && e.querySelector(':scope > input[type=checkbox], :scope > input[type=radio]')).map((e) => ({ ...box(e), minH: parseFloat(cs(e).minHeight) || 0 }))
  out.taggerRows = $$('[data-sporta-brand-tagger] label[data-hay]').filter(vis).map(box)
  out.pills = $$('button.rounded-full.min-h-11', content).filter(vis).map(box)
  out.inline = $$('button.text-indigo-600, button.text-red-600', content).filter((e) => vis(e) && !/(^| )(border|rounded-full)( |$)|(^| )bg-/.test(cls(e))).map(box)
  out.links = $$('[data-sporta-brand-stats] a').filter(vis).slice(0, 4).map((a) => {
    a.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = a.getBoundingClientRect(), x = r.left + r.width / 2, hit = (y) => document.elementFromPoint(x, y) === a
    return { above: hit(r.top - 12), below: hit(r.bottom + 12), mid: hit(r.top + r.height / 2), far: hit(r.top - 16) || hit(r.bottom + 16), h: r.height }
  })
  scrollTo(0, 0)
  // the order sheet
  const dlg = $('[role="dialog"][aria-label^="Order"]')
  if (dlg && vis(dlg)) {
    const d = dlg.getBoundingClientRect()
    out.sheet = { over: dlg.scrollWidth - dlg.clientWidth, w: d.width, past: $$('input, select, textarea', dlg).filter(vis).map((e) => Math.round(Math.max(e.getBoundingClientRect().right - d.right, d.left - e.getBoundingClientRect().left))).filter((n) => n > 1), nFields: $$('input, select, textarea', dlg).filter(vis).length }
    out.mono = $$('p.font-mono.capitalize', dlg).filter(vis).map((e) => cs(e).textTransform)
  }
  // editor modals
  out.modals = $$('form.admin-editor-modal').filter(vis).map((m) => { const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, maxH: parseFloat(cs(m).maxHeight) } })
  return out
}
// focus: Tab once (keyboard modality), then focus each candidate and read its ring
const focusProbe = () => {
  const cs = (e) => getComputedStyle(e)
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let p = e; p; p = p.parentElement) { const q = cs(p); if (q.display === 'none' || q.visibility === 'hidden') return false } return true }
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const parse = (s) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const dark = document.documentElement.classList.contains('dark')
  const bgOf = (e) => { const st = []; for (let p = e.parentElement; p; p = p.parentElement) { const b = parse(cs(p).backgroundColor); if (b[3] > 0) { st.push(b); if (b[3] >= 1) break } } let base = dark ? [18, 18, 18] : [255, 255, 255]; for (const s of st.reverse()) base = [0, 1, 2].map((i) => s[i] * s[3] + base[i] * (1 - s[3])); return base }
  const c = document.querySelector('.admin-content')
  const cand = [...c.querySelectorAll('input[type=checkbox], input[type=radio], select:not(.border):not([class*="border-slate-"]), input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not(.border):not([class*="border-slate-"]), textarea:not(.border):not([class*="border-slate-"]), summary')].filter((e) => vis(e) && !e.disabled && !e.closest('[class*="__preview"]') && !e.closest('.sph, .sab'))
  const seen = new Set(), out = []
  for (const e of cand) {
    const kind = e.tagName.toLowerCase() + (e.type && e.tagName === 'INPUT' ? ':' + e.type : '') + (e.closest('[data-sporta-brand-tagger]') ? '@tagger' : '')
    if (seen.has(kind)) continue; seen.add(kind)
    e.focus({ focusVisible: true })
    const s = cs(e), w = parseFloat(s.outlineWidth) || 0, on = s.outlineStyle !== 'none' && w > 0
    const ring = parse(s.outlineColor), bg = bgOf(e), x = lum(ring), y = lum(bg)
    // a bordered-field style ring (section 1: border + glow) also counts
    const glow = s.boxShadow !== 'none'
    out.push({ kind, on, w, cr: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05), glow, matches: e.matches(':focus-visible') })
    e.blur()
  }
  return out
}

// ------------------------------------------------------------------------------------------------ cases
const V = { 320: { w: 320, h: 568, touch: true }, 360: { w: 360, h: 640, touch: true }, 390: { w: 390, h: 844, touch: true }, '768t': { w: 768, h: 1024, touch: true }, '768m': { w: 768, h: 1024, touch: false }, 1280: { w: 1280, h: 800, touch: false } }
const NON_PAY = ALL.filter((n) => n !== 'payments')
const LAYOUT_OK = [...SIZES_NAMES.filter((n) => n !== 'topbar'), 'orders-sheet']       // Top bar's own sheet is a stand-in: its layout is not claimed
const cases = []
const add = (state, view, o = {}) => cases.push({ state, view, rtl: false, dark: false, ...o })
for (const st of NON_PAY) { add(st, '390', { dark: true, checks: ['dark'] }); add(st, '1280', { dark: true, checks: ['dark'] }); add(st, '390', { checks: ['light'] }); add(st, '1280', { checks: ['light'] }) }
for (const st of ['orders', 'brands', 'inventory']) add(st, '390', { dark: true, rtl: true, checks: ['dark'] })
add('payments', '390', { dark: true, checks: ['payShowing'] }); add('payments', '1280', { dark: true, checks: ['payShowing'] })
add('orders', '1280', { dark: true, hiddenPay: true, checks: ['payHidden'] }); add('catalogue', '390', { dark: true, hiddenPay: true, checks: ['payHidden'] })
for (const st of LAYOUT_OK) add(st, '768t', { checks: ['touch768', 'touch'] })
for (const st of ['brands', 'orders', 'catalogue', 'catalogue-form', 'discounts-form', 'slides-form', 'slides', 'brands-form']) for (const v of ['320', '390']) add(st, v, { checks: ['touch'] })
add('brands', '1280', { checks: ['mouseKeeps'] }); add('orders', '768m', { checks: ['mouseKeeps'] })
for (const v of ['320', '360', '390']) for (const rtl of [false, true]) add('orders-sheet', v, { rtl, checks: ['sheet'] })
for (const st of ['brands', 'catalogue-form', 'inventory', 'checkout', 'slides-form']) for (const dark of [false, true]) add(st, '1280', { dark, checks: ['focus'] })
for (const st of [...LAYOUT_OK, 'seo']) for (const v of Object.keys(V)) for (const rtl of [false, true]) add(st, v, { rtl, checks: ['overflow'] })
for (const st of ['catalogue-form', 'brands-form']) for (const v of ['320', '390']) add(st, v, { checks: ['modal'] })   // the Discounts and Slides editors are inline forms, not modals

// the checks: rows of { tag, name, ok, detail }; tag '' = a "keeps" check that passes with or without the new CSS
const AA = (r, m, kinds, tag, name, at) => { const low = m.low.filter((x) => kinds.includes(x.k)); r(tag, name, low.length === 0, `${at}: ${low.length} under AA, e.g. ${low.slice(0, 2).map((x) => x.s).join(' | ')}`) }
const run = (c, m, f) => {
  const rows = [], r = (tag, name, ok, detail = '') => rows.push({ tag, name, ok: !!ok, detail })
  const at = `${c.state} ${c.view}${c.rtl ? ' rtl' : ''}${c.dark ? ' dark' : ''}`
  const min = (list, key = 'h') => list.reduce((a, b) => (b[key] < a[key] ? b : a), { [key]: Infinity, s: '' })
  for (const k of c.checks) {
    if (k === 'dark') {
      r('full-1', 'dark: the shell defines all fourteen --ak-* tokens', m.tokens === 14, `${at}: ${m.tokens}`)
      r('full-1', 'dark: the page and the content area are the dark page colour, not white', m.shellLum < 0.03 && m.contentLum < 0.03, `${at}: content ${m.contentBg}`)
      AA(r, m, ['other', 'dash', 'signOut', 'taggerMeta'], 'full-1', 'dark: no text run under WCAG AA on any screen (everything this file paints)', at)
      AA(r, m, ['rose', 'brandDark', 'ledger'], 'full-1b', 'dark: rose / red text, text-brand-dark and the Inventory ledger line reach AA', at)
      AA(r, m, ['tagger', 'stats'], 'full-2', 'dark: the Brands tagger and the per-brand count line reach AA', at)
      if (m.taggerLists.length) r('full-2', 'dark: the tagger\'s product list is a dark box', m.taggerLists.every((l) => l < 0.03), at)
    }
    if (k === 'light') {
      r('', 'light: no --ak-* token is defined (every colour is its light fallback, as before)', m.tokens === 0 && m.tokensContent === 0, `${at}: ${m.tokens}`)
      r('', 'light: the content area is white', m.contentLum > 0.99, `${at}: ${m.contentBg}`)
      AA(r, m, ['other', 'rose', 'brandDark', 'ledger', 'tagger', 'stats'], '', 'light: nothing else is under AA', at)
      AA(r, m, ['dash', 'taggerMeta', 'signOut'], 'full-7', 'light: the "no value" dash, the tagger\'s second line and "Sign out" reach AA', at)
    }
    if (k === 'payShowing') {
      r('', 'dark, Payments showing: no --ak-* token is defined on the shell or the content area (the screen is computed as before)', m.tokens === 0 && m.tokensContent === 0, `${at}: ${m.tokens}/${m.tokensContent}`)
      r('', 'dark, Payments showing: the content area is white and its colour scheme light (section 9)', m.contentLum > 0.99 && m.contentScheme === 'light', `${at}: ${m.contentBg} ${m.contentScheme}`)
    }
    if (k === 'payHidden') {
      r('scope-9', 'dark, Payments visited then another screen: the content area is dark, not section 9\'s white', m.contentLum < 0.03, `${at}: ${m.contentBg}`)
      r('scope-9', 'dark, Payments visited then another screen: the build\'s dark custom properties and colour scheme are back', m.adminBg !== '#f3f5f7' && m.contentScheme !== 'light', `${at}: --admin-bg ${m.adminBg}, color-scheme ${m.contentScheme}`)
      r('full-1', 'dark, Payments visited then another screen: the tokens are defined', m.tokens === 14, `${at}: ${m.tokens}`)
      AA(r, m, ['other', 'dash', 'signOut', 'taggerMeta', 'rose', 'brandDark', 'ledger', 'tagger', 'stats'], 'scope-9', 'dark, Payments visited then another screen: no text under AA', at)
    }
    if (k === 'touch768') {
      const b = min(m.buttons), cl = min(m.closes, 'w'), sb = min(m.sideButtons), fl = min(m.fields)
      r('full-3', '768px touch: every button in the content area is at least 44px high', b.h >= 43.5, `${at}: ${b.s}`)
      r('full-3', '768px touch: a Close (x) button is at least 44px wide', cl.w >= 43.5, `${at}: ${cl.s}`)
      r('full-3', '768px touch: the sidebar\'s buttons (Sign out) are at least 44px high', sb.h >= 43.5, `${at}: ${sb.s}`)
      r('full-3', '768px touch: every bordered text field and select is at least 44px high', fl.h >= 43.5, `${at}: ${fl.s}`)
    }
    if (k === 'touch') {
      const lb = min(m.labels), tr = min(m.taggerRows), pl = min(m.pills, 'w'), il = min(m.inline, 'w')
      r('full-4', 'touch: a flex label around a checkbox or radio is at least 44px high', lb.h >= 43.5, `${at}: ${lb.s}`)
      r('full-4', 'touch: a row of the Brands tagger is at least 44px high', tr.h >= 43.5, `${at}: ${tr.s}`)
      r('full-4', 'touch: the filter pills ("All") and the Edit / Remove text buttons are at least 44px wide', pl.w >= 43.5 && il.w >= 43.5, `${at}: ${pl.s} ${il.s}`)
      if (m.links.length && !/-form$/.test(c.state)) {   // under an open editor the overlay takes every tap, as it should
        r('full-4', 'touch: "View on site" takes a tap 12px above and below its text', m.links.every((l) => l.above && l.below && l.mid), `${at}: ${JSON.stringify(m.links[0])}`)
        r('', 'touch: "View on site" keeps its own box (the line is not made taller) and takes nothing 16px away', m.links.every((l) => l.h < 30 && !l.far), `${at}: ${JSON.stringify(m.links[0])}`)
      }
    }
    if (k === 'mouseKeeps') {
      if (c.view === '1280') r('', 'mouse screen from 1024px: a checkbox label gets no 44px floor (that is for touch screens and the phone layout)', m.labels.length > 0 && m.labels.every((l) => l.minH < 43.5), `${at}: ${m.labels.map((l) => l.minH).join()}`)
      r('', 'mouse screen: buttons keep the 40px density of the SIZES section', !m.buttons.length || min(m.buttons).h < 43.5, `${at}: ${min(m.buttons).s}`)
    }
    if (k === 'sheet') {
      r('', 'the order sheet is open and has its fields', m.sheet && m.sheet.nFields >= 5, at)
      r('full-5', 'order sheet: no field runs past the sheet and it does not scroll sideways', m.sheet && m.sheet.past.length === 0 && m.sheet.over <= 1, `${at}: ${m.sheet && m.sheet.past.length} fields past (max ${m.sheet && Math.max(0, ...m.sheet.past)}px), scroll ${m.sheet && m.sheet.over}px`)
      r('full-5', 'order sheet: a 70-character unbroken value wraps inside the sheet', m.longOver <= 1, `${at}: ${m.longOver}px`)
      r('full-6', 'order sheet: monospace values (bank id, reference, discount code) are not capitalised', m.mono && m.mono.length >= 3 && m.mono.every((t) => t === 'none'), `${at}: ${m.mono && m.mono.join()}`)
    }
    if (k === 'focus') {
      const bad = f.filter((x) => !(x.on && x.w >= 2 && x.cr >= 3) && !x.glow)
      r('full-8', 'focus: checkboxes, radios and class-less fields show a 2px ring of at least 3:1', f.length > 0 && bad.length === 0, `${at}: ${bad.map((x) => `${x.kind} ${x.on ? x.w + 'px ' + x.cr.toFixed(2) + ':1' : 'no ring'}`).join(' | ')}`)
    }
    if (k === 'overflow') {
      const special = (c.state === 'inventory' && c.view === '320') || c.state === 'seo'
      r(special ? 'full-9' : '', special ? 'no sideways scroll: Inventory at 320px and the SEO editor\'s fieldsets' : 'no screen scrolls sideways at any width, in either direction', m.docW <= m.vw + 1, `${at}: ${m.docW - m.vw}px`)
    }
    if (k === 'modal') {
      const md = m.modals[0]
      r('', 'the editor modal is open', !!md, at)
      r('full-10', 'editor modal: max-height is 92% of the dynamic viewport', md && Math.abs(md.maxH - 0.92 * m.vh) < 1 && m.dvh, `${at}: ${md && md.maxH}px of ${m.vh}px, dvh declared: ${m.dvh}`)
      r('', 'editor modal: it fits the screen, top and bottom', md && md.top >= -0.5 && md.bottom <= m.vh + 0.5, `${at}: ${md && Math.round(md.top)}..${md && Math.round(md.bottom)} of ${m.vh}`)
    }
  }
  return rows
}

// ------------------------------------------------------------------------------------------------ run
const ref = { current: addons(SRC) }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const setCss = (css) => { document.querySelector('style[data-addon="sporta-admin-knet.css"]').textContent = css }
// the Payments section as the live app leaves it after a visit: still in main.admin-content, under [hidden]
let PAY_SECTION = ''
{
  const pg = await browser.newPage(); await pg.goto(`${base}/__fx/payments`)
  PAY_SECTION = await pg.evaluate(() => document.querySelector('.payment-settings').closest('section.admin-page').outerHTML)
  await pg.close()
}
is(/payment-settings/.test(PAY_SECTION) && PAY_SECTION.startsWith('<section class="admin-page'), 'fixture: the Payments screen is section.admin-page > .payment-settings inside main.admin-content, as measured on the live build')

// which variants a check kind needs (its own blocks); 'after' and 'legacy' always run
const NEEDS = { dark: ['full-1', 'full-1b', 'full-2'], light: ['full-7'], payShowing: [], payHidden: ['scope-9', 'full-1'], touch768: ['full-3'], touch: ['full-4'], mouseKeeps: [], sheet: ['full-5', 'full-6'], focus: ['full-8'], overflow: ['full-9'], modal: ['full-10'] }
const results = {}          // variant -> name -> { tag, ok count, fails: [detail] }
const note = (variant, rows) => { const R = (results[variant] ||= {}); for (const x of rows) { const e = (R[x.name] ||= { tag: x.tag, n: 0, fails: [] }); e.n++; if (!x.ok) e.fails.push(x.detail) } }
const byCtx = new Map()
for (const c of cases) { const k = `${c.view}|${c.dark}`; if (!byCtx.has(k)) byCtx.set(k, []); byCtx.get(k).push(c) }
let nPages = 0, nMeasures = 0, nText = 0
for (const [k, list] of byCtx) {
  const v = V[list[0].view], dark = list[0].dark
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, isMobile: v.touch, hasTouch: v.touch, colorScheme: dark ? 'dark' : 'light', locale: 'en-US' })
  const pg = await ctx.newPage()
  for (const c of list) {
    await pg.goto(`${base}/__fx/${c.state}?rtl=${c.rtl ? 1 : 0}&dark=${c.dark ? 1 : 0}`, { waitUntil: 'load' })
    await pg.evaluate(() => document.fonts.ready)
    nPages++
    if (c.hiddenPay) await pg.evaluate((h) => { const t = document.createElement('template'); t.innerHTML = h; const s = t.content.firstElementChild; s.hidden = true; document.querySelector('main.admin-content').appendChild(s) }, PAY_SECTION)
    const variants = ['after', 'legacy', ...new Set(c.checks.flatMap((x) => NEEDS[x]))]
    for (const name of variants) {
      await pg.evaluate(setCss, VARIANT[name])
      const m = await pg.evaluate(measure); nMeasures++
      if (name === 'after') nText += m.nText
      m.dvh = /max-height:\s*min\(92vh,\s*92dvh\)/.test(VARIANT[name])
      let f = []
      if (c.checks.includes('focus')) { await pg.keyboard.press('Tab'); f = await pg.evaluate(focusProbe) }
      if (c.checks.includes('sheet')) m.longOver = await pg.evaluate(() => { const d = document.querySelector('[role="dialog"][aria-label^="Order"]'), p = d.querySelector('p.text-sm.capitalize'), old = p.textContent; p.textContent = 'SPORTA-ULTRA-TRAIL-RUNNING-JACKET-WATERPROOF-XL-BLACK-ORANGE-0123456789'; const o = d.scrollWidth - d.clientWidth; p.textContent = old; return o })
      note(name, run(c, m, f))
    }
  }
  await ctx.close()
}
await browser.close(); server.close()

// ------------------------------------------------------------------------------------------------ report
head(`With the stylesheet as it is (${cases.length} cases, ${nPages} pages, ${nMeasures} measurements, ${nText} text runs checked for contrast)`)
for (const [name, e] of Object.entries(results.after)) {
  is(e.fails.length === 0, `${e.tag ? '[' + e.tag + '] ' : ''}${name} (${e.n} cases)`, `${e.fails.length} failing: ${e.fails[0]}`)
  if (VERBOSE && e.fails.length) for (const d of e.fails) console.log('       ' + d)
}
head('MUTATION: every check of a block fails without the block')
for (const tag of TAGS) {
  const mine = Object.entries(results[tag] || {}).filter(([, e]) => e.tag === tag)
  const failing = mine.filter(([, e]) => e.fails.length > 0)
  is(mine.length > 0 && failing.length === mine.length, `${tag === 'scope-9' ? 'section 9 with its old scope' : 'without [' + tag + ']'}: ${failing.length} of its ${mine.length} checks fail (${mine.reduce((a, [, e]) => a + e.fails.length, 0)} failing cases)`, mine.filter(([, e]) => !e.fails.length).map(([n]) => n).join(' | ').slice(0, 200))
}
{
  const tagged = Object.entries(results.legacy).filter(([, e]) => e.tag), failing = tagged.filter(([, e]) => e.fails.length > 0)
  is(failing.length === tagged.length, `legacy (section 10 cut, section 9's old scope): ${failing.length} of the ${tagged.length} checks that belong to a block fail`, tagged.filter(([, e]) => !e.fails.length).map(([n]) => n).join(' | ').slice(0, 300))
  const keeps = Object.entries(results.legacy).filter(([, e]) => !e.tag), broken = keeps.filter(([, e]) => e.fails.length)
  is(broken.length === 0, `legacy: the ${keeps.length} "keeps" checks pass without the new CSS too (they describe what must not change)`, broken.map(([n, e]) => n + ': ' + e.fails[0]).join(' | ').slice(0, 300))
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
