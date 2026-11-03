// Static guard for public/sporta-admin-knet.css: every colour declaration must sit inside a
// colour-scheme media query (`not (prefers-color-scheme: dark)` for the white admin, or the dark layer).
//
//   npm run test:admin-dark
//
// Why: the compiled admin has its own dark theme and follows the OS setting. This file was written for the white
// admin, and a colour declaration outside a scheme query paints light colours over the dark theme (a white page
// under light text, dark ink in dark fields; measured on the live page, 2026-11-03). Layout, size and weight
// rules are free to apply in both modes. The live-page check that goes with this is
// `MODE=colors SCHEME=dark node scripts/admin-payments-scan.mjs` (the compiled admin alone: BLOCK_ADDON=1).
import postcss from 'postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
const root = postcss.parse(css)

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }

const COLOUR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)|border-(top|right|bottom|left)-color|border-(inline|block)(-(start|end))?(-color)?|border-color|outline|outline-color|box-shadow|caret-color|accent-color|fill|stroke|text-decoration-color|--tw-[a-z-]*color|scrollbar-color)$/i
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix\(|var\(--admin-action|\b(white|black|transparent)\b/i
const schemeQuery = (node) => { for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule' && p.name === 'media' && /prefers-color-scheme/.test(p.params)) return p.params; return null }

const loose = [], light = [], dark = []
root.walkDecls((d) => {
  if (!(COLOUR_PROPS.test(d.prop) && LITERAL.test(d.value))) return
  const q = schemeQuery(d)
  const where = `${(d.parent.selector || '').replace(/\s+/g, ' ').slice(0, 70)} { ${d.prop}: ${d.value.slice(0, 40)} }`
  if (!q) loose.push(where)
  else if (/not\s*\(\s*prefers-color-scheme:\s*dark\s*\)/.test(q) || /prefers-color-scheme:\s*light/.test(q)) light.push(where)
  else dark.push(where)
})

is(loose.length === 0, 'no colour declaration outside a colour-scheme media query', loose.slice(0, 5).join(' | ') + (loose.length > 5 ? ` … ${loose.length} in all` : ''))
is(light.length >= 90, 'the white-admin colours are in light-only twins', `${light.length} declarations`)
is(dark.length >= 1, 'a dark layer exists for the elements this file adds', `${dark.length} declarations`)
// The dark layer must not paint a light SURFACE: no background in it may be near-white (relative luminance > 0.75).
const lum = (hex) => { let h = hex.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join(''); const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const lightSurfaces = []
root.walkDecls((d) => {
  if (!/^background/.test(d.prop) || !schemeQuery(d) || /not\s*\(\s*prefers-color-scheme:\s*dark/.test(schemeQuery(d))) return
  for (const m of d.value.matchAll(/#[0-9a-f]{3,6}\b/gi)) if (lum(m[0]) > 0.75) lightSurfaces.push(`${(d.parent.selector || '').replace(/\s+/g, ' ').slice(0, 60)} { ${d.prop}: ${d.value} }`)
})
is(lightSurfaces.length === 0, 'the dark layer paints no white or near-white surface', lightSurfaces.slice(0, 3).join(' | '))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
