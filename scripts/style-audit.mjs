/**
 * Every StyleSheet in the app, checked mechanically.
 *
 *   node scripts/style-audit.mjs        (no server, no browser)
 *
 * Three things, in the order they cost:
 *
 *  1. A style key defined and never used. Harmless on its own; the reason to
 *     fail on it is that it is nearly always the RESIDUE of a component that
 *     moved — three of the four found on the first run were leftovers of the
 *     shared Button, still carrying the hard-coded white that Button was
 *     written to delete.
 *
 *  2. A hard-coded white in a rule. The colour pass introduced theme.onTint
 *     precisely because white on the DARK theme's ember (#ff7b17) is 2.6:1 —
 *     below AA, on the button a manager taps to move an order. White is still
 *     right on ink, on #363d45, and on EMBER_ON_ART (the fixed light ember the
 *     art tiles paint), so those places are listed by name below. Anything not
 *     on that list has to justify itself here before it ships.
 *
 *  3. Identical rule bodies in more than one file. Advisory only — printed,
 *     never failed. Two screens agreeing on a 44pt tap target is not a bug,
 *     and consolidating on that evidence alone would be a redesign.
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// file:key sites where a literal white is CORRECT — each is painted on a
// surface that is the same dark colour in both themes.
const WHITE_OK = new Set([
  'components/status-chip.tsx:text',            // on TONE[status], all dark
  'components/price.tsx:saveText',              // on #363d45, the charcoal chip
  'components/admin-shell.tsx:brand',           // on the panel's ink bar
  'app/(tabs)/account.tsx:walletText',          // on #000000, the wallet card
  'app/(tabs)/index.tsx:categoryBadgeText',     // on EMBER_ON_ART, fixed in both themes
  'app/(tabs)/index.tsx:arrowGlyph',            // on EMBER_ON_ART
  'app/(tabs)/index.tsx:categoryName',          // on the darkened category photograph
])

const files = execSync("git ls-files 'src/**/*.tsx' 'src/**/*.ts'", { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)

let fails = 0
const fail = (what) => { fails++; console.log(`FAIL ${what}`) }

const allRules = new Map() // normalised rule body -> [file:key]

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const short = f.replace('src/', '')

  for (const m of src.matchAll(/(?:const|export const)\s+(\w+)\s*=\s*StyleSheet\.create\(\{/g)) {
    const varName = m[1]
    let i = src.indexOf('{', m.index + m[0].length - 1)
    let depth = 0, end = i
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++
      else if (src[end] === '}') { depth--; if (depth === 0) break }
    }
    // `StyleSheet.create({ mono: … }).mono` — the sheet is consumed on the
    // spot and never named again. Its keys cannot be "unused"; an audit that
    // says otherwise is reporting its own parser.
    const consumedInline = /^\s*\}\s*\)\s*\./.test(src.slice(end))

    const body = src.slice(i + 1, end)
    const keys = []
    let d = 0, keyStart = 0
    for (let j = 0; j < body.length; j++) {
      const c = body[j]
      if (c === '{' || c === '[' || c === '(') d++
      else if (c === '}' || c === ']' || c === ')') d--
      else if (c === ':' && d === 0) {
        const k = body.slice(keyStart, j).trim().replace(/^['"]|['"]$/g, '')
        if (/^[A-Za-z_]\w*$/.test(k)) {
          let vd = 0, v = j + 1
          for (; v < body.length; v++) {
            const cc = body[v]
            if (cc === '{' || cc === '[' || cc === '(') vd++
            else if (cc === '}' || cc === ']' || cc === ')') vd--
            else if (cc === ',' && vd === 0) break
          }
          keys.push([k, body.slice(j + 1, v).trim()])
          keyStart = v + 1
          j = v
        }
      } else if (c === ',' && d === 0) keyStart = j + 1
    }

    const exported = new RegExp(`export const\\s+${varName}\\b`).test(src)
    for (const [k, val] of keys) {
      if (!consumedInline) {
        const used = new RegExp(`\\b${varName}\\.${k}\\b`).test(src)
        const elsewhere = exported && files.some((g) =>
          g !== f && new RegExp(`\\b${varName}\\.${k}\\b`).test(readFileSync(g, 'utf8')))
        if (!used && !elsewhere) fail(`${short} ${varName}.${k} is defined and never used`)
      }

      if (/#fff(fff)?\b/i.test(val) && !WHITE_OK.has(`${short}:${k}`))
        fail(`${short} ${varName}.${k} hard-codes white — use theme.onTint, or list it in WHITE_OK with the surface it sits on`)

      const norm = val.replace(/\s+/g, ' ').replace(/,\s*$/, '')
      if (norm.length > 40) {
        if (!allRules.has(norm)) allRules.set(norm, [])
        allRules.get(norm).push(`${short}:${k}`)
      }
    }
  }
}

console.log('\n--- identical rule bodies in more than one place (advisory) ---')
let dupes = 0
for (const [norm, where] of allRules) {
  if (where.length > 1) { dupes++; console.log(`  ${where.join('  ==  ')}\n     ${norm.slice(0, 90)}`) }
}
console.log(`${dupes} duplicated rule bodies`)

console.log(fails ? `\n${fails} failed` : '\nall ok — no dead style keys, no unexplained white')
process.exit(fails ? 1 : 0)
