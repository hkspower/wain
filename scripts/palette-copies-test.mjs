/**
 * The standalone pages' copies of the shop's colour ramp must BE the shop's ramp.
 *
 *   node scripts/palette-copies-test.mjs
 *
 * category.php, returns-request.html and card.html are rendered without the
 * storefront's stylesheets (each says why: a crawler, a page that must work on
 * its own, nine colours not worth a 91 KB download), so each carries a COPY of
 * sporta-dark.css's dark ramp in its own :root. Copies drift, and these did —
 * twice for card.html, past a comment in it that said "if the ramp in
 * sporta-dark.css moves again, move these with it". Measured 2026-10-01: the
 * shop's page was #1e2023 while the category pages were #0d0e10 and the returns
 * form and loyalty card #141619, so walking from the shop into any of them
 * visibly changed the background.
 *
 * WHAT IT ASSERTS, per page:
 *   - every ramp name the page declares equals the value in sporta-dark.css's
 *     :root[data-theme='dark'] block (the LAST declaration there, as the
 *     cascade would read it);
 *   - `color-scheme: dark`, or a dark page gets LIGHT scrollbars and controls;
 *   - it loads /assets/theme.js, or the owner's brand and page colours from
 *     /backends never reach it (measured: 13 of 13 oranges stayed orange on a
 *     category page with the brand set to blue).
 *
 * It refuses to pass on an empty parse: a ramp of nothing equals every copy.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const NAMES = ['--sp-black', '--sp-tile', '--sp-panel', '--sp-raise', '--sp-line', '--sp-silver', '--sp-text']
const PAGES = ['returns-request.html', 'card.html']
/* category.php stopped carrying a copy on 2026-10-01: it wears the shop's own header, cards
   and footer now, so it LINKS the shop's stylesheets instead — the one thing better than a
   copy that matches is no copy at all. Checked below for exactly that. */
const LINKED = ['category.php']

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}

/** name -> value, the LAST declaration in the block (that is what the cascade reads). */
const decls = (block) => {
  const out = {}
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase()
  return out
}
/** the body of the first `selector {` … matching `}` */
const blockAfter = (text, selector) => {
  const i = text.indexOf(selector)
  if (i < 0) return null
  const open = text.indexOf('{', i)
  let depth = 0
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++
    else if (text[j] === '}' && --depth === 0) return text.slice(open + 1, j)
  }
  return null
}

const dark = readFileSync(ROOT + 'sporta-site/public_html/assets/sporta-dark.css', 'utf8')
const darkBlock = blockAfter(dark, ":root[data-theme='dark'] {")
check(darkBlock != null, "sporta-dark.css has a :root[data-theme='dark'] block")
const ramp = decls(darkBlock ?? '')
const found = NAMES.filter((n) => ramp[n])
check(found.length === NAMES.length, `the dark ramp parsed: ${found.length}/${NAMES.length} names`, `missing ${NAMES.filter((n) => !ramp[n]).join(' ')}`)

for (const page of PAGES) {
  const text = readFileSync(ROOT + 'sporta-site/public_html/' + page, 'utf8')
  const style = (text.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
  const root = blockAfter(style, ':root {')
  check(root != null, `${page}: has a :root palette`)
  const copy = decls(root ?? '')
  const shared = NAMES.filter((n) => copy[n])
  check(shared.length >= 5, `${page}: declares the ramp (${shared.length} names)`)
  const off = shared.filter((n) => copy[n] !== ramp[n])
  check(off.length === 0, `${page}: every ramp value matches sporta-dark.css`,
    off.map((n) => `${n} ${copy[n]} != ${ramp[n]}`).join('; '))
  check(/color-scheme\s*:\s*dark/.test(root ?? ''), `${page}: color-scheme is dark`)
  check(/<script src="\/assets\/theme\.js"/.test(text), `${page}: loads theme.js, so the owner's colours reach it`)
}

for (const page of LINKED) {
  const text = readFileSync(ROOT + 'sporta-site/public_html/' + page, 'utf8')
  check(/<link rel="stylesheet" href="\/assets\/sporta-dark\.css">/.test(text), `${page}: links the shop's palette (sporta-dark.css) rather than copying it`)
  check(/<link rel="stylesheet" href="\/assets\/sporta-ui\.css">/.test(text), `${page}: links the shop's overlay rules (sporta-ui.css)`)
  const style = (text.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
  const stale = NAMES.filter((n) => new RegExp(n + '\\s*:').test(style))
  check(stale.length === 0, `${page}: carries no copy of the ramp to drift`, stale.join(' '))
  check(/color-scheme\s*:\s*dark/.test(style), `${page}: color-scheme is dark`)
  check(/<script src="\/assets\/theme\.js"/.test(text), `${page}: loads theme.js, so the owner's colours reach it`)
}

console.log(fails ? `\n${fails} failed` : '\nall ok — every standalone page wears the shop\'s ramp')
process.exit(fails ? 1 : 0)
