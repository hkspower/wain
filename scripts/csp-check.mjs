/**
 * Every inline <script> in index.html is named, by hash, in the CSP.
 *
 *   node scripts/csp-check.mjs
 *
 * The CSP in public_html/.htaccess pins inline scripts by sha256. Edit one
 * byte of an inline script without updating the hash and NOTHING fails here —
 * the local PHP server reads no .htaccess — while on the live server the
 * browser refuses to run that script, silently, and the page half-works in a
 * way that depends on which script died. That exact mistake was made in this
 * repo (the font unification edited the boot script) and was caught by hand;
 * this file is so the next one is caught by a machine.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../sporta-site/public_html/index.html', import.meta.url), 'utf8')
const ht = readFileSync(new URL('../sporta-site/public_html/.htaccess', import.meta.url), 'utf8')

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
const inline = scripts.map((body) => createHash('sha256').update(body).digest('base64'))
const declared = [...ht.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1])

let fails = 0
for (const h of inline) {
  const ok = declared.includes(h)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} inline script sha256-${h.slice(0, 12)}… ${ok ? 'is in the CSP' : 'is NOT in the CSP — the live server will refuse to run it'}`)
}
for (const d of declared) {
  if (!inline.includes(d)) {
    // Stale is a warning, not a failure: it runs nothing, it only widens the
    // allowlist by one dead entry. Still worth clearing out.
    console.log(`--   declared sha256-${d.slice(0, 12)}… matches no script (stale, harmless, remove it)`)
  }
}
console.log(fails ? `\n${fails} failed` : `\nall ok — ${inline.length} inline scripts, all declared`)
process.exit(fails ? 1 : 0)
