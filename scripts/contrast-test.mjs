/**
 * Measures every text-on-surface pair the palette paints, against WCAG 2.1 AA.
 *
 *   node scripts/contrast-test.mjs
 *
 * No browser and no server: it reads the colours out of constants/theme.ts and
 * does the arithmetic. It exists because two pairs were below AA and nothing in
 * the codebase could have said so — reading a hex value does not tell you
 * whether it is legible, and one of the two had been wrong since long before
 * the page changed colour.
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/constants/theme.ts', import.meta.url), 'utf8')
const palette = {}
for (const mode of ['light', 'dark']) {
  const block = src.match(new RegExp(`${mode}: \\{([\\s\\S]*?)\\n  \\}`))?.[1] ?? ''
  palette[mode] = Object.fromEntries(
    [...block.matchAll(/(\w+): '(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2]]),
  )
}

const ch = (v) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => ch(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [surface, foreground] — surfaces are what the app actually paints text on.
const PAIRS = [
  ['background', 'text'],
  ['background', 'textSecondary'],
  ['background', 'tintText'],
  ['backgroundElement', 'text'],
  ['backgroundElement', 'textSecondary'],
  ['backgroundElement', 'tintText'],
  ['backgroundElement', 'sand'],
  ['backgroundElement', 'success'],
  ['backgroundElement', 'danger'],
  ['backgroundSelected', 'tintText'],
  ['tintSoft', 'tintText'],
  ['sandSoft', 'sand'],
]

let fails = 0
for (const mode of ['light', 'dark']) {
  const c = palette[mode]
  for (const [bg, fg] of PAIRS) {
    const r = ratio(c[bg], c[fg])
    const ok = r >= 4.5
    if (!ok) fails++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} ${fg} on ${bg}`.padEnd(46) + `${r.toFixed(2)}:1`)
  }
  // Filled surfaces carry white or ink; both are checked as themselves.
  const onTint = ratio(c.tint, mode === 'light' ? '#ffffff' : '#14161a')
  const okTint = onTint >= 4.5
  if (!okTint) fails++
  console.log(`${okTint ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} button label on tint`.padEnd(46) + `${onTint.toFixed(2)}:1`)
}

// A card has to be distinguishable from the page it sits on. Not a WCAG
// number — non-text contrast asks 3:1 only for controls — but the whole point
// of a grey page is that white cards separate from it, so it is measured.
for (const mode of ['light', 'dark']) {
  const sep = ratio(palette[mode].background, palette[mode].backgroundElement)
  const ok = sep >= 1.05
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} card separates from page`.padEnd(46) + `${sep.toFixed(2)}:1`)
}

console.log(fails ? `\n${fails} below AA` : '\nall pairs meet AA')
process.exit(fails ? 1 : 0)
