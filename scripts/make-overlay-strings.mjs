/**
 * The storefront OVERLAYS' own words, harvested for the Site wording editor (2026-10-04, "make all
 * website full dynamic to edit at backend").
 *
 *   node scripts/make-overlay-strings.mjs            write scripts/overlay-strings.json
 *   node scripts/make-overlay-strings.mjs --check    fail if a listed literal is no longer in its file
 *
 * WHY. extract-site-strings.mjs reads the BUNDLE's dictionary, so every word the bundle says has been
 * editable since 2026-09. The ~35 overlay scripts in assets/ carry their own English/Arabic literals
 * (menu labels, the features title, "Best sellers", "Shop now", the account sheet, the tracking
 * card…), and none of those were in the catalogue — fixed copy on a shop the owner was told was
 * dynamic. site-text.js swaps WHOLE TEXT NODES by exact match, which is exactly how these are drawn
 * (textContent = literal), so listing them in the catalogue is all it takes.
 *
 * HOW. A heuristic over each file's source — the three shapes the overlays use:
 *   1.  <cond> ? 'English' : 'Arabic'   and   <cond> ? 'Arabic' : 'English'   (which side is Arabic is
 *       decided by the CHARACTERS, not the condition — U+0600–U+06FF marks the Arabic side)
 *   2.  en: 'English', ar: 'Arabic'  on one line (either order)
 *   3.  two keyed dictionaries  ar: { k: '…' }  /  en: { k: '…' }  — matched by key
 * A literal used in setAttribute('aria-label'…), .placeholder, .title or .alt on the same line is kept
 * but marked FIXED (not a text node, so the swap cannot reach it); so is one with a {placeholder} or a
 * template `${…}`. The output is checked in; --check proves every literal is still in its file, so a
 * rewritten overlay cannot leave the editor offering words the shop no longer says.
 *
 * WHAT IT IS NOT: a parser. A literal built by concatenation, or produced by a function (the returns
 * row "within N days"), is not here and is not editable — the fixed list of extract-site-strings
 * names that limit for the bundle too.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = 'sporta-site/public_html/assets'
const OUT = 'scripts/overlay-strings.json'
const check = process.argv.includes('--check')
const INDEX = readFileSync('sporta-site/public_html/index.html', 'utf8')
// Every storefront overlay: the data-shop ones plus the shared ones that draw storefront text.
const files = [...new Set([...INDEX.matchAll(/<script src="\/assets\/([a-z0-9-]+)\.js(?:\?[^"]*)?"[^>]*\sdata-shop\b/g)].map((m) => m[1]))]
  .concat(['rules-live', 'home-banner'])
  .filter((f) => readdirSync(ASSETS).includes(f + '.js')).sort()

const AR = /[\u0600-\u06FF]/
const STR = String.raw`'((?:[^'\\\n]|\\.)*)'`
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
const un = (s) => s.replace(/\\'/g, "'").replace(/\\u00a0/g, '\u00a0').replace(/\\n/g, '\n')
const fixedWhy = (line, lit) => {
  if (/\{[a-zA-Z_]+\}|\$\{/.test(lit)) return 'carries a value the page fills in'
  if (/\.(placeholder|title|alt)\s*=|setAttribute\('(aria-label|title|alt|placeholder|aria-description)'|aria-label/.test(line)) return 'a label for screen readers or a tooltip, not text on the page'
  if (/querySelector|matches\(|\[aria-label|closest\(/.test(line)) return 'a selector, not text on the page'
  return null
}

const strings = {}
let n = 0
for (const f of files) {
  const src = strip(readFileSync(join(ASSETS, f + '.js'), 'utf8'))
  const lines = src.split('\n')
  const seen = new Set()
  const add = (en, ar, line) => {
    en = un(en.trim()); ar = un(ar.trim())
    if (!en || !ar || !AR.test(ar) || AR.test(en) || en.length > 160 || ar.length > 160) return
    if (/^[\d\s.,:%\u0660-\u0669\u00a0]+$/.test(ar)) return
    const k = en + '|' + ar
    if (seen.has(k)) return
    seen.add(k)
    const why = fixedWhy(line, en) || fixedWhy(line, ar)
    const key = `overlay.${f.replace(/-/g, '_')}.${++n}`   // admin.php's key pattern has no hyphen
    strings[key] = why ? { en, ar, fixed: why, file: f } : { en, ar, file: f }
  }
  for (const line of lines) {
    // shape 1: ternaries
    for (const m of line.matchAll(new RegExp(String.raw`\?\s*${STR}\s*:\s*${STR}`, 'g'))) {
      const a = m[1], b = m[2]
      if (AR.test(a) && !AR.test(b)) add(b, a, line)
      else if (AR.test(b) && !AR.test(a)) add(a, b, line)
    }
    // shape 4: key: ['English', 'Arabic'] pairs (customer-account, order-progress, checkout-fields…)
    for (const m of line.matchAll(new RegExp(String.raw`\[\s*${STR}\s*,\s*${STR}\s*\]`, 'g'))) {
      const a = m[1], b = m[2]
      if (AR.test(b) && !AR.test(a)) add(a, b, line)
      else if (AR.test(a) && !AR.test(b)) add(b, a, line)
    }
    // shape 2: en: 'x', ar: 'y' on one line
    for (const m of line.matchAll(new RegExp(String.raw`\ben:\s*${STR}[^\n]*?\bar:\s*${STR}`, 'g'))) add(m[1], m[2], line)
    for (const m of line.matchAll(new RegExp(String.raw`\bar:\s*${STR}[^\n]*?\ben:\s*${STR}`, 'g'))) add(m[2], m[1], line)
  }
  // shape 3: keyed dictionaries ar: { … } / en: { … }
  const dict = (lang) => {
    const out = {}
    const re = new RegExp(String.raw`\b${lang}:\s*\{`, 'g')
    for (const m of src.matchAll(re)) {
      let i = m.index + m[0].length, depth = 1
      while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++ }
      const body = src.slice(m.index + m[0].length, i - 1)
      for (const kv of body.matchAll(new RegExp(String.raw`(?:^|[,{\n])\s*([A-Za-z_][A-Za-z0-9_]*):\s*${STR}`, 'g'))) if (!(kv[1] in out)) out[kv[1]] = [kv[2], body]
    }
    return out
  }
  const E = dict('en'), A = dict('ar')
  for (const k of Object.keys(E)) if (A[k]) add(E[k][0], A[k][0], E[k][1].split('\n').find((l) => l.includes(E[k][0])) || '')
}

const payload = { _: 'GENERATED by scripts/make-overlay-strings.mjs from the storefront overlays in assets/. Do not hand-edit — run node scripts/make-overlay-strings.mjs. Merged into assets/site-strings.json by extract-site-strings.mjs.', count: Object.keys(strings).length, strings }
const text = JSON.stringify(payload, null, 1) + '\n'
if (Object.keys(strings).length < 60) { console.error(`FAIL only ${Object.keys(strings).length} overlay strings found — the harvest is far smaller than these files hold`); process.exit(1) }
if (check) {
  let have = null
  try { have = JSON.parse(readFileSync(OUT, 'utf8')) } catch {}
  const inFile = (s, lit) => [lit, lit.replace(/'/g, "\\'"), lit.replace(/\u00a0/g, '\\u00a0'), lit.replace(/'/g, "\\'").replace(/\u00a0/g, '\\u00a0')].some((x) => s.includes(x))
  const stale = have ? Object.entries(have.strings).filter(([, v]) => { const s = readFileSync(join(ASSETS, v.file + '.js'), 'utf8'); return !inFile(s, v.en) || !inFile(s, v.ar) }) : []
  if (have && stale.length === 0 && JSON.stringify(have) === JSON.stringify(payload)) { console.log(`ok   overlay-strings.json matches the overlays   ${payload.count} strings`); process.exit(0) }
  console.error(`FAIL overlay-strings.json has drifted (${stale.length} stale). Run: node scripts/make-overlay-strings.mjs`)
  for (const [k, v] of stale.slice(0, 5)) console.error(`     ${k}: ${v.en}`)
  process.exit(1)
}
writeFileSync(OUT, text)
console.log(`wrote ${OUT}   ${payload.count} strings from ${files.length} overlays, ${Object.values(strings).filter((s) => !s.fixed).length} editable`)
