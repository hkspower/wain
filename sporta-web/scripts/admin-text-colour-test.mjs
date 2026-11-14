// Admin text colour, measured on every /backends screen: the 13 sizes-admin fixtures and the 7 admin-css-full fixtures (20
// screens), each in light and dark and in English and Arabic (80 pages). Read-only, no sign-in, no network: it serves the
// fixtures of scripts/lib/admin-css-full-page.mjs with the add-ons of addons-src/ (the same files the other admin suites use).
//
// For every visible text node and every field placeholder it takes the computed colour, mixes it over the real background
// behind it (the first opaque layer up the tree; a gradient counts as its first colour stop, so the dark sidebar is read as
// dark, not as white), and checks WCAG AA for the element's own size and weight: 4.5:1, or 3:1 at 24px and above, or 18.66px
// and above in bold (700). Failing probes are listed by screen, mode and element.
//
// It also inventories the text colours the screens use: each distinct colour with its count, and which of them are coloured
// (not slate, black or white). Printed for review, not asserted: the owner decides which colours a screen keeps.
//
//   node scripts/admin-text-colour-test.mjs            (exit 1 on any contrast failure)
//   TEXT_REPORT=1 node scripts/admin-text-colour-test.mjs    (also prints the full colour table)
import { chromium } from 'playwright'
import { ALL, addons, serve, knetSource } from './lib/admin-css-full-page.mjs'

let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }

const ref = { current: addons(knetSource()) }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const MODES = [{ rtl: 0, dark: 0, name: 'light en' }, { rtl: 0, dark: 1, name: 'dark en' }, { rtl: 1, dark: 0, name: 'light ar' }, { rtl: 1, dark: 1, name: 'dark ar' }]

const fails = []
const palette = new Map()   // "#rrggbb" -> { n, where }
const coloured = []         // { screen, mode, id, hex, ratio }
let probes = 0

for (const name of ALL) {
  for (const m of MODES) {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await pg.goto(`${base}/__fx/${name}?rtl=${m.rtl}&dark=${m.dark}`, { waitUntil: 'load' })
    const rows = await pg.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
      const g = cv.getContext('2d', { willReadFrequently: true })
      const num = (str) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = str; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
      const mix = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1] }
      const lm = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
      const layerOf = (cs) => {
        const c = num(cs.backgroundColor)
        if (c[3] === 0 && /gradient/.test(cs.backgroundImage)) { const s = cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i); if (s) return num(s[0]) }
        return c
      }
      const bgOf = (e) => {
        const layers = []
        for (let x = e; x; x = x.parentElement) { const l = layerOf(getComputedStyle(x)); if (l[3] > 0) layers.push(l); if (l[3] >= 1) break }
        let col = [255, 255, 255, 1]
        for (let i = layers.length - 1; i >= 0; i--) col = mix(layers[i], col)
        return col
      }
      const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
      const out = []
      for (const e of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(e)
        // visually hidden text (sr-only: a 1px clipped box) is not on screen, so WCAG contrast does not apply to it
        const box = e.getBoundingClientRect()
        if (cs.display === 'none' || cs.visibility === 'hidden' || box.width <= 1 || box.height <= 1) continue
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
        const field = e.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden', 'file', 'range', 'color', 'submit', 'button'].includes(e.type)
        const targets = []
        if (own) targets.push(['text', own, cs.color])
        if (field && e.placeholder) targets.push(['placeholder', e.placeholder, getComputedStyle(e, '::placeholder').color])
        for (const [kind, label, color] of targets) {
          const bg = bgOf(e), fg = mix(num(color), bg)
          const [a, b] = [lm(fg), lm(bg)].sort((x, y) => y - x)
          const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
          const cls = String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
          out.push({ id: e.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' ' + kind + ' "' + label.slice(0, 24) + '"', hex: hex(fg), bg: hex(bg), ratio: (a + 0.05) / (b + 0.05), need: px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5 })
        }
      }
      return out
    })
    await pg.close()
    const mode = `${name} ${m.name}`
    for (const r of rows) {
      probes++
      const key = r.hex
      const slot = palette.get(key) || { n: 0, where: new Set() }
      slot.n++; if (slot.where.size < 3) slot.where.add(r.id.split(' ')[0])
      palette.set(key, slot)
      const sat = Math.max(...[1, 3, 5].map((i) => parseInt(r.hex.slice(i, i + 2), 16))) - Math.min(...[1, 3, 5].map((i) => parseInt(r.hex.slice(i, i + 2), 16)))
      if (sat > 25) coloured.push({ screen: name, mode: m.name, id: r.id, hex: r.hex, ratio: r.ratio })
      if (r.ratio < r.need) fails.push({ screen: name, mode: m.name, id: r.id, ratio: r.ratio, need: r.need, fg: r.hex, bg: r.bg })
    }
  }
}

await browser.close(); server.close()

const lowest = fails.length ? Math.min(...fails.map((f) => f.ratio)) : null
is(fails.length === 0, `every text node and field has contrast >= 4.5:1 (3:1 large) on ${ALL.length} screens, light and dark, en and ar: ${probes} probes`,
  fails.length ? `${fails.length} below, lowest ${lowest.toFixed(2)}: ` + fails.slice(0, 6).map((f) => `[${f.screen} ${f.mode}] ${f.ratio.toFixed(2)} ${f.id} ${f.fg} on ${f.bg}`).join(' ; ') : '')

// inventory: how many colours, which are coloured
const sorted = [...palette.entries()].sort((a, b) => b[1].n - a[1].n)
console.log(`\n     text colours: ${palette.size} distinct over ${probes} probes; coloured (not slate, black or white): ${coloured.length} probes`)
const byColour = new Map()
for (const c of coloured) { const k = c.hex; const s = byColour.get(k) || { n: 0, screens: new Set(), sample: c.id }; s.n++; s.screens.add(c.screen); byColour.set(k, s) }
for (const [hex, s] of [...byColour.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) console.log(`     coloured ${hex}: ${s.n} probes on ${s.screens.size} screens, e.g. ${s.sample}`)
if (process.env.TEXT_REPORT) for (const [hex, s] of sorted) console.log(`     ${hex} ${s.n}  ${[...s.where].join(', ')}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
