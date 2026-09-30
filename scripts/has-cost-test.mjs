/**
 * No :has() selector may have a universal subject.
 *
 *   node scripts/has-cost-test.mjs      (npm run test:has-cost)
 *
 * A selector is matched from its RIGHT end. `.a:has(x) > *:has(> img)` therefore
 * asks EVERY element in the document "do you have an img child?" on every style
 * recalculation — whether or not `.a` exists on the page. On 2026-09-30 one such
 * rule (css/05-product-page.css) cost /shop 24% of its frames over 33 ms on an
 * emulated phone; naming the subject (`button:has(...)`) took it to 3%.
 *
 * Checks the RIGHTMOST compound of every selector that contains :has(): it must
 * name a tag, class, id or attribute — not `*`, and not a bare pseudo-class.
 */
import { readdirSync, readFileSync } from 'node:fs'
const DIR = new URL('../sporta-site/css/', import.meta.url).pathname
let fails = 0, seen = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

function rightmost(sel) {
  // walk from the right, outside () and [], to the last combinator
  let depthP = 0, depthB = 0, cut = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (c === '(') depthP++; else if (c === ')') depthP--
    else if (c === '[') depthB++; else if (c === ']') depthB--
    else if (depthP === 0 && depthB === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1
  }
  return sel.slice(cut).trim()
}
// split a selector list on top-level commas
function split(list) {
  const out = []; let d = 0, s = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(' || list[i] === '[') d++
    else if (list[i] === ')' || list[i] === ']') d--
    else if (list[i] === ',' && d === 0) { out.push(list.slice(s, i)); s = i + 1 }
  }
  out.push(list.slice(s)); return out
}
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.css'))) {
  const src = readFileSync(DIR + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of src.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim()
    if (!head.includes(':has(') || head.startsWith('@')) continue
    for (const sel of split(head)) {
      if (!sel.includes(':has(')) continue
      seen++
      const r = rightmost(sel.trim())
      const bad = /^\*(:|$)/.test(r) || /^:has\(/.test(r) || /^:(is|where|not)\(/.test(r) && !/[.#\[a-z]/i.test(r.replace(/:(is|where|not)\(/, ''))
      if (bad) check(false, `${f}: universal :has() subject — ${sel.trim().slice(0, 110)}`)
    }
  }
}
check(seen > 20, `the rig actually read the :has() selectors (${seen}) — an empty scan would pass everything`)
console.log(fails ? `\n${fails} failed` : '\nall ok — no :has() rule makes the engine ask every element')
process.exit(fails ? 1 : 0)
