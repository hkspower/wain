// Light-only guard for the /backends Payments screen (owner decision 2026-11-03: "no dark mode for knet").
//
//   npm run test:admin-light        (rig-free: postcss + a fixture + real Tailwind + Chromium; no database, no server)
//
// What the owner decided, and our reading: the Payments screen (KNET and CBK/T-Pay cards, the editors, the Merchant
// ID / Terminal ID panel, the Merchant Server IP panel, the "take KNET through this CBK setup" card) looks exactly
// like its LIGHT appearance on every device, a device set to dark included. It is not dark and not a half-dark mix.
// The other /backends screens are not part of the decision; the sidebar and the phone bars stay as the build draws them.
//
// Why a test of this kind is needed. The live /backends is a COMPILED build whose source is missing. Its dark theme is
// NOT keyed on the device: it is `html[data-theme=dark]` / `html.dark`, set by /boot.js before the first paint and kept
// by the app's theme provider (the device setting is only one input, and a stored choice outranks it). 183 hand-written
// rules do the painting, 39 of them !important, and they are copied verbatim into scripts/fixtures/admin-dark-rules.css.
// The only way to know the add-on beats them is to put them on the page next to the exact live markup and compare.
//
// Part 1, static (postcss on public/sporta-admin-knet.css):
//   - no `@media (prefers-color-scheme: dark)` layer paints anything, and no light-only twin is left (the colour
//     declarations of the white admin apply unconditionally again);
//   - the "Light only" section exists, and EVERY selector in it names the dark-state html, the admin shell and the
//     screen root or the content area that holds it: nothing in it is global;
//   - no near-black background is declared for the screen anywhere in the file.
// Part 2, dynamic (Chromium, the exact live markup of the screen from scripts/fixtures/admin-payments.mjs, real
// Tailwind, the live build's own light stub, the live build's REAL dark rules, then the add-on):
//   - five html states (light; dark class + data-theme on a dark device; the same on a light device = a stored
//     choice; data-theme only = the first paint, before the provider adds the class; stored light on a dark device):
//     for every element in the content area, its computed color, background, four border colours, box-shadow, outline
//     colour, caret and accent colour, background-image and ::placeholder colour are IDENTICAL to the light state;
//   - states: hover, keyboard focus, disabled, checked, selection on representative buttons, fields, the switch;
//   - every text node and every field value/placeholder has contrast >= 4.5:1 (3:1 for large or bold 18.66px+);
//   - the content area around the screen and the screen root are light while the screen is open;
//   - a control: an admin content area WITHOUT the screen, in the same page, still follows the dark rules (the scope
//     is not global);
//   - a mutation check: with the "Light only" section cut out of the file, the same checks FAIL (listed).
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_HTML, LIVE } from './fixtures/admin-payments.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

// ---------------------------------------------------------------------------------------------------- Part 1: static
const MARK = 'Light only (owner decision 2026-11-03'
const at = CSS.indexOf(MARK)
const cut = at > 0 ? CSS.lastIndexOf('/*', at) : -1 // start of the section's header comment
head('Static: public/sporta-admin-knet.css')
is(at > 0, 'the "Light only (owner decision 2026-11-03 ...)" section exists')
const root = postcss.parse(CSS)
const COLOUR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)|border-(top|right|bottom|left)-color|border-(inline|block)(-(start|end))?(-color)?|border-color|outline|outline-color|box-shadow|caret-color|accent-color|fill|stroke|text-decoration-color|scrollbar-color|color-scheme)$/i
const inSchemeQuery = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'atrule' && p.name === 'media' && /prefers-color-scheme/.test(p.params)) return p.params; return null }
const darkQueries = [], twins = [], bare = []
root.walkDecls((d) => {
  if (!COLOUR_PROPS.test(d.prop)) return
  const q = inSchemeQuery(d)
  if (q) (/not\s*\(\s*prefers-color-scheme:\s*dark/.test(q) || /prefers-color-scheme:\s*light/.test(q) ? twins : darkQueries).push(`${(d.parent.selector || '').slice(0, 60)} { ${d.prop} }`)
  else bare.push(d)
})
is(darkQueries.length === 0, 'no @media (prefers-color-scheme: dark) layer declares a colour (the build is keyed on html[data-theme=dark] / html.dark, not on the device)', darkQueries.slice(0, 3).join(' | '))
is(twins.length === 0, 'no light-only twin (@media not (prefers-color-scheme: dark)) is left: the white-admin colours apply unconditionally', `${twins.length} left`)
is(bare.filter((d) => d.source.start.offset < cut).length >= 90, 'the unwrapped colour declarations of the white admin exist', `${bare.filter((d) => d.source.start.offset < cut).length} declarations before the Light only section`)

const lum = (hex) => { let h = hex.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join(''); const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const nearBlack = (value) => { for (const m of value.matchAll(/#[0-9a-f]{3,8}\b/gi)) if (lum(m[0]) < 0.06) return m[0]; for (const m of value.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/gi)) if ([1, 2, 3].every((i) => Number(m[i]) < 40)) return m[0]; return null }
const dark = []
root.walkDecls((d) => {
  if (!/^background/.test(d.prop)) return
  const sel = d.parent.selector || ''
  const inSection = d.source.start.offset >= cut
  if (!(inSection || /payment|data-sporta-(knet-ids|tpay-ips)/.test(sel))) return
  const b = nearBlack(d.value)
  if (b) dark.push(`${sel.replace(/\s+/g, ' ').slice(0, 70)} { ${d.prop}: ${d.value.slice(0, 30)} }`)
})
is(dark.length === 0, 'no near-black background is declared for the screen (or anywhere in the Light only section)', dark.slice(0, 3).join(' | '))

const section = cut > 0 ? postcss.parse(CSS.slice(cut)) : postcss.root()
const loose = []
let nRules = 0
section.walkRules((r) => {
  if (r.parent && r.parent.type === 'atrule' && /keyframes/.test(r.parent.name)) return
  nRules++
  for (const s of r.selectors) {
    const t = s.replace(/\s+/g, ' ')
    const ok = /\.payment-settings/.test(t) && /\.admin-shell/.test(t) && /(html\.dark|html\[data-theme="?dark"?\])/.test(t)
    if (!ok) loose.push(t.slice(0, 90))
  }
})
is(nRules >= 20, 'the Light only section carries its rules', `${nRules} rules`)
is(loose.length === 0, 'every selector in it names the dark-state html, .admin-shell and the screen root (.payment-settings): nothing global', loose.slice(0, 3).join(' | '))
const scheme = []
section.walkAtRules('media', (a) => { if (/prefers-color-scheme/.test(a.params)) scheme.push(a.params) })
is(scheme.length === 0, 'and it is not gated by a device media query (the build is not)')

// --------------------------------------------------------------------------------------------------- Part 2: dynamic
const i2 = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), i2) // the page links this sheet BEFORE the add-ons
const DARK_ADMIN = DARK.slice(i2)                                                  // and this one (the lazy admin chunk) AFTER them

const SHELL_OPEN = '<div class="admin-shell"><main class="admin-content flex-1"><section class="admin-page">'
if (!BODY_HTML.startsWith(SHELL_OPEN)) throw new Error('fixture markup changed: the admin shell opener is not what this test expects')
// The live nesting, as measured: shell (bg-slate-50, min-h-screen) > sidebar + main.admin-content > two sections, the
// first carrying the admin-wide alert region, the second the screen. Then a CONTROL: another admin content area
// without the screen, in the same page, whose cards must keep following the dark rules.
const SCREEN = `<div id="scr" class="admin-shell min-h-screen bg-slate-50"><aside class="admin-sidebar w-60"><a href="#" class="text-slate-500">Overview</a></aside><main class="admin-content flex-1"><section class="admin-page"><div class="admin-notice admin-notice--error" role="alert">46 of 46 products are not in the database</div></section><section class="admin-page">` + BODY_HTML.slice(SHELL_OPEN.length)
const CONTROL = `<div id="ctl" class="admin-shell"><main class="admin-content"><section class="admin-page"><h1 class="text-2xl font-bold text-slate-900">Orders</h1><div class="rounded-xl border border-slate-200 bg-white p-4"><p class="text-sm text-slate-500">Other screen</p><input class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Search"></div></section></main></div>`
const BODY = SCREEN + CONTROL
const classes = [...new Set([...BODY.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'admin-payments-light-fixture.css') })).css
const NO_MOTION = '*,*::before,*::after{transition:none!important;animation:none!important}' // states are read at once, not after 150 ms
const pageHtml = (addon, htmlAttrs) => `<!doctype html><html lang="en" dir="ltr" ${htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=1280"><style>${TW}</style><style>${LIVE}</style><style>${DARK_INDEX}</style><style>${addon}</style><style>${DARK_ADMIN}</style><style>${NO_MOTION}</style></head><body style="margin:0"><div id="root">${BODY}</div></body></html>`

// html states: what boot.js and the theme provider can produce, and the device setting each can meet
const SCENARIOS = [
  { name: 'light', device: 'light', attrs: '', note: 'no theme attribute (the reference)' },
  { name: 'dark+dark', device: 'dark', attrs: 'class="dark" data-theme="dark"', note: 'dark class and data-theme, dark device' },
  { name: 'dark+light-device', device: 'light', attrs: 'class="dark" data-theme="dark"', note: 'stored dark choice on a light device' },
  { name: 'first-paint', device: 'dark', attrs: 'data-theme="dark"', note: 'data-theme only, before the provider adds the class' },
  { name: 'stored-light', device: 'dark', attrs: 'data-theme="light"', note: 'stored light choice on a dark device' },
]
const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'outlineColor', 'caretColor', 'accentColor', 'textDecorationColor']
const SIG = (e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// Everything measured in one scenario, as plain data
async function collect(addon, sc) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: sc.device })
  const pg = await ctx.newPage()
  await pg.setContent(pageHtml(addon, sc.attrs))
  const out = { sc: sc.name }
  out.elems = await pg.evaluate((props) => {
    const sig = (e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    const rows = []
    for (const e of [document.querySelector('#scr .admin-content'), ...document.querySelectorAll('#scr .admin-content *')]) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none') continue
      const r = { sig: sig(e), p: {} }
      for (const k of props) r.p[k] = cs[k]
      if (e.tagName === 'INPUT') r.p.placeholder = getComputedStyle(e, '::placeholder').color
      rows.push(r)
    }
    return rows
  }, PROPS)
  out.schemeOnControls = await pg.evaluate(() => [...document.querySelectorAll('#scr .payment-settings, #scr .payment-settings input, #scr .payment-settings select')].map((e) => getComputedStyle(e).colorScheme))
  out.areas = await pg.evaluate(() => {
    const c = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : 'none' }
    return { content: c('#scr .admin-content'), screen: c('#scr .payment-settings'), alert: c('#scr .admin-notice'), card: c('#scr .payment-gateway-card'), field: c('#scr input.mt-1') }
  })

  // states on representative controls
  const probes = {
    'Save KNET': 'button:text-is("Save KNET")', 'Save IDs (outlined)': '[data-sporta-knet-ids] button', 'Check again': 'button:text-is("Check again")',
    'tab Test (active)': 'button:text-is("Test")', 'tab Production': 'button:text-is("Production")', 'secret field': 'input[name=a]', 'T-Pay select': 'select',
    'KNET switch': '[role=switch]', 'CBK checkbox': 'label.rounded-2xl input[type=checkbox]',
  }
  const read = (el) => { const cs = getComputedStyle(el); const r = {}; for (const k of ['color', 'backgroundColor', 'borderTopColor', 'boxShadow', 'outlineColor', 'outlineStyle', 'accentColor']) r[k] = cs[k]; return r }
  out.states = {}
  for (const [name, sel] of Object.entries(probes)) {
    const loc = pg.locator('#scr ' + sel).first()
    await loc.scrollIntoViewIfNeeded()
    const el = await loc.elementHandle()
    const st = {}
    st.rest = await el.evaluate(read)
    await pg.mouse.move(0, 0); await loc.hover(); st.hover = await el.evaluate(read)
    await pg.mouse.move(0, 0)
    await pg.keyboard.press('Shift'); await el.evaluate((e) => e.focus()); st.focus = await el.evaluate(read)
    await el.evaluate((e) => e.blur())
    if (!/switch|checkbox/.test(name)) { await el.evaluate((e) => { e.disabled = true }); st.disabled = await el.evaluate(read); await el.evaluate((e) => { e.disabled = false }) }
    if (/checkbox/.test(name)) { await el.evaluate((e) => { e.checked = true }); st.checked = await el.evaluate(read); await el.evaluate((e) => { e.checked = false }) }
    out.states[name] = st
  }
  out.selection = await pg.evaluate(() => { const c = getComputedStyle(document.querySelector('#scr h1'), '::selection'); return { color: c.color, background: c.backgroundColor } })

  // contrast of every text node and every field, against its effective background
  out.contrast = await pg.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
    const g = cv.getContext('2d', { willReadFrequently: true })
    const num = (str) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = str; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
    const mix = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1] }
    const lm = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const bgOf = (e) => { const layers = []; for (let x = e; x; x = x.parentElement) { const c = num(getComputedStyle(x).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break } let col = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) col = mix(layers[i], col); return col }
    const rows = []
    for (const e of document.querySelectorAll('#scr .admin-content *')) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getBoundingClientRect().width) continue
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
      const field = e.tagName === 'INPUT' && e.type !== 'checkbox'
      const targets = []
      if (own) targets.push(['text', own, cs.color])
      if (field) targets.push(['placeholder', e.placeholder, getComputedStyle(e, '::placeholder').color])
      for (const [kind, label, color] of targets) {
        const bg = bgOf(e), fg = mix(num(color), bg)
        const [a, b] = [lm(fg), lm(bg)].sort((x, y) => y - x)
        const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
        rows.push({ id: e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.') + ' ' + kind + ' "' + label.slice(0, 22) + '"', ratio: (a + 0.05) / (b + 0.05), need: px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5 })
      }
    }
    return rows
  })

  // control: a content area without the screen
  out.control = await pg.evaluate(() => {
    const card = document.querySelector('#ctl .bg-white'), p = card.querySelector('p'), h = document.querySelector('#ctl h1')
    return { card: getComputedStyle(card).backgroundColor, cardBorder: getComputedStyle(card).borderTopColor, text: getComputedStyle(p).color, h1: getComputedStyle(h).color }
  })
  await ctx.close()
  return out
}

const lumOf = (rgb) => { const m = rgb.match(/[\d.]+/g); if (!m) return null; const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]) }

// All the failures of one css text, as { check -> [details] }: the real run and the mutation run use the same function
async function failuresOf(addon, verbose) {
  const F = {}
  const add = (k, v) => { (F[k] = F[k] || []).push(v) }
  const base = await collect(addon, SCENARIOS[0])
  const runs = []
  for (const sc of SCENARIOS) {
    const d = sc.name === 'light' ? base : await collect(addon, sc)
    runs.push(d)
    if (sc.name === 'light') continue
    // identical computed paint, element by element
    let nDiff = 0; const ex = []
    if (d.elems.length !== base.elems.length) add('elements', `${sc.name}: ${d.elems.length} vs ${base.elems.length}`)
    d.elems.forEach((r, i) => { const l = base.elems[i]; if (!l) return; for (const k of Object.keys(r.p)) if (r.p[k] !== l.p[k]) { nDiff++; if (ex.length < 4) ex.push(`${r.sig} ${k} ${l.p[k]} -> ${r.p[k]}`) } })
    if (nDiff) add(`paint [${sc.name}]`, `${nDiff} differences, e.g. ${ex.join(' ; ')}`)
    // states
    let sDiff = 0; const sx = []
    for (const [name, st] of Object.entries(d.states)) for (const [state, v] of Object.entries(st)) for (const k of Object.keys(v)) { const l = base.states[name][state][k]; if (v[k] !== l) { sDiff++; if (sx.length < 4) sx.push(`${name}/${state} ${k} ${l} -> ${v[k]}`) } }
    if (sDiff) add(`states [${sc.name}]`, `${sDiff} differences, e.g. ${sx.join(' ; ')}`)
    if (JSON.stringify(d.selection) !== JSON.stringify(base.selection)) add(`selection [${sc.name}]`, `${JSON.stringify(base.selection)} -> ${JSON.stringify(d.selection)}`)
    // the page around the screen
    for (const [k, v] of Object.entries(d.areas)) if (v !== base.areas[k] || (lumOf(v) !== null && lumOf(v) < 0.5)) add(`surface [${sc.name}]`, `${k} ${base.areas[k]} -> ${v}`)
    if (d.schemeOnControls.some((s) => /dark/.test(s))) add(`color-scheme [${sc.name}]`, [...new Set(d.schemeOnControls)].join('/'))
  }
  // contrast, in every scenario
  for (const d of runs) { const low = d.contrast.filter((r) => r.ratio < r.need); if (low.length) add(`contrast [${d.sc}]`, `${low.length} of ${d.contrast.length}: ` + low.slice(0, 4).map((r) => `${r.ratio.toFixed(2)} ${r.id}`).join(' ; ')) }
  // control: the element outside the screen must still be dark in the dark scenarios that are dark
  for (const d of runs) {
    if (!/^(dark\+dark|dark\+light-device|first-paint)$/.test(d.sc)) continue
    if (!(lumOf(d.control.card) < 0.1)) add(`control [${d.sc}]`, `the other screen's card is not dark: ${d.control.card}`)
  }
  if (verbose) { verbose.base = base; verbose.runs = runs }
  return F
}

head('Dynamic: the live markup against the live build\'s real dark rules')
const V = {}
const F = await failuresOf(CSS, V)
const light = V.base
console.log(`     light reference: ${light.elems.length} elements, ${Object.keys(light.states).length} controls x states, ${light.contrast.length} text/field contrast probes`)
console.log(`     scenarios: ${SCENARIOS.map((s) => `${s.name} (${s.note})`).join(' | ')}`)
for (const sc of SCENARIOS.slice(1)) {
  is(!Object.keys(F).some((k) => k.startsWith('paint [' + sc.name + ']')), `[${sc.name}] every element paints exactly as in light (color, background, borders, shadow, outline, caret, accent, ::placeholder)`, F['paint [' + sc.name + ']'] || '')
  is(!Object.keys(F).some((k) => k.startsWith('states [' + sc.name + ']')), `[${sc.name}] hover, keyboard focus, disabled and checked states match light on the representative controls`, F['states [' + sc.name + ']'] || '')
  is(!F['selection [' + sc.name + ']'], `[${sc.name}] text selection colours match light`, F['selection [' + sc.name + ']'] || '')
  is(!F['surface [' + sc.name + ']'], `[${sc.name}] the content area, the screen root, the alert region, the cards and the fields are light`, F['surface [' + sc.name + ']'] || '')
  is(!F['color-scheme [' + sc.name + ']'], `[${sc.name}] the screen and its fields declare a light colour-scheme (native popups, autofill)`, F['color-scheme [' + sc.name + ']'] || '')
}
is(!F.elements, 'the same elements are measured in every scenario', F.elements || '')
const lowLight = light.contrast.filter((r) => r.ratio < r.need)
is(lowLight.length === 0, `every text node and field has contrast >= 4.5:1 (3:1 large) in light: ${light.contrast.length} probes, lowest ${Math.min(...light.contrast.map((r) => r.ratio)).toFixed(2)}`, lowLight.slice(0, 4).map((r) => `${r.ratio.toFixed(2)} ${r.id}`).join(' ; '))
for (const sc of SCENARIOS.slice(1)) is(!F['contrast [' + sc.name + ']'], `[${sc.name}] every text node and field has contrast >= 4.5:1 (3:1 large)`, F['contrast [' + sc.name + ']'] || '')
head('Control: the scope is not global')
for (const d of V.runs.filter((r) => /^(dark\+dark|dark\+light-device|first-paint)$/.test(r.sc))) {
  is(!F['control [' + d.sc + ']'], `[${d.sc}] a card on an admin content area WITHOUT the screen still follows the dark rules`, `card ${d.control.card}, border ${d.control.cardBorder}, text ${d.control.text}`)
  is(d.control.card !== light.control.card && d.control.text !== light.control.text, `[${d.sc}] and its background and text differ from light`, `${light.control.card}/${light.control.text} -> ${d.control.card}/${d.control.text}`)
}

// ---------------------------------------------------------------------------------------------------------- mutation
head('Mutation: the Light only section cut out of the file')
const mutated = cut > 0 ? CSS.slice(0, cut) : CSS
const MF = await failuresOf(mutated)
const kinds = Object.keys(MF)
console.log(`     ${kinds.length} failing checks without the section:`)
for (const k of kinds) console.log(`       - ${k}: ${String(MF[k][0]).slice(0, 170)}`)
is(kinds.some((k) => k.startsWith('paint')) && kinds.some((k) => k.startsWith('states')) && kinds.some((k) => k.startsWith('surface')), 'without the section the paint, state and surface checks fail', `${kinds.length} failing checks`)
is(kinds.filter((k) => k.startsWith('paint')).length >= 3, 'the paint check fails in at least three html states', kinds.filter((k) => k.startsWith('paint')).join(', '))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
