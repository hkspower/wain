/**
 * Every file index.html asks for, present on disk.
 *
 *   node scripts/package-check.mjs                    # the repo's public_html
 *   ROOT=/tmp/zv/public_html node scripts/package-check.mjs   # an extracted zip
 *
 * WHY THIS EXISTS. index.html was uploaded to the live shop without
 * assets/index-TIUCmnwm.css, the stylesheet it names. The result was not a
 * missing style here and there — it was the whole site with no layout at all:
 * navigation as bulleted lists, links in the browser's default purple and
 * underlined, 1000px of content crammed into a 393px phone, and every page
 * running off the right edge. The dark background survived, because
 * sporta-dark.css DID upload and it sets the ground colour, which made the
 * page look styled-but-broken rather than obviously unstyled.
 *
 * Nothing could have caught it. The browser rigs all run against a complete
 * sandbox, where the file is present; the site scan checks for 404s but only
 * against whatever server it is aimed at. The gap was between the two: a
 * package that is internally inconsistent, which is exactly what a partial
 * upload creates.
 *
 * So this reads index.html, collects every local path it references, and
 * checks each one is really there. Run it on the extracted zip before
 * uploading and a half-built package cannot leave.
 *
 * It reads the DOM's own attributes rather than a hand-written list, so a
 * reference added later is covered without anyone remembering to add it here.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.env.ROOT ?? new URL('../sporta-site/public_html', import.meta.url).pathname)

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

// Every href= and src= that points at a path on this site. Data URIs, external
// origins and anchors are somebody else's problem.
const refs = new Set()
for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
  const v = m[1].trim()
  if (!v.startsWith('/')) continue                 // relative, external, data:, #
  if (v.startsWith('//')) continue                 // protocol-relative = external
  refs.add(v.split('?')[0].split('#')[0])
}
check(refs.size > 0, `index.html references ${refs.size} local files`)

// The stylesheet is called out by name because it is the one whose absence
// does not look like an absence.
const sheets = [...refs].filter((r) => r.endsWith('.css'))
check(sheets.length > 0, `and ${sheets.length} of them are stylesheets (${sheets.join(', ')})`)

for (const r of [...refs].sort()) {
  const p = join(ROOT, r.replace(/^\//, ''))
  const there = existsSync(p) && statSync(p).isFile()
  const size = there ? statSync(p).size : 0
  check(there && size > 0,
    `${r}${there ? ` (${size.toLocaleString()} B)` : ' is MISSING — the page will load and render unstyled'}`)
}

// The pairing that has its own failure mode: index.html's inline scripts are
// permitted by SHA-256 hashes that live in .htaccess. One without the other
// and the browser blocks the script — the page loads, then does nothing.
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length
if (inline > 0) {
  check(existsSync(join(ROOT, '.htaccess')),
    `.htaccess travels with index.html — ${inline} inline scripts need its CSP hashes`)
}

console.log(fails ? `\n${fails} failed — do not upload this` : '\nall ok — every file index.html asks for is here')
process.exit(fails ? 1 : 0)
