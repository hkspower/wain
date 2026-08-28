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
 *
 * EVERY .html IN THE DOCROOT, not just index.html. The CSP is set by
 * `Header set` at the top of .htaccess, so it applies to every page the server
 * hands out — and this only ever read one of them. card.html was added with no
 * inline script precisely so it would need no hash, but "it has none today" is
 * not a property anybody can see from the CSP; the check is what keeps it
 * true, and it is now the same check for every page rather than a rule that
 * happens to hold for the one page anyone looked at.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const DOCROOT = new URL('../sporta-site/public_html/', import.meta.url)
const ht = readFileSync(new URL('.htaccess', DOCROOT), 'utf8')

// PAGES THAT ARE NEVER DEPLOYED need no hash in the live CSP, and adding one
// would be the wrong fix — it permanently widens the policy the real shop runs
// under, for a page that must not be on the real shop.
//
// THE LIST IS EMPTY NOW, and that is the point: go-live.html was the only
// entry, and it has been DELETED rather than merely excluded. So have
// api/setup-admin.php, api/reset-admin.php, api/preflight.php and
// knet/setup-config.php — a set of unauthenticated endpoints that created an
// admin account, reset its password, reported the database and paths back to
// the caller, and wrote the bank's credentials from a request. They were
// needed once, on a URL nobody knew. Being excluded from a package by
// convention is not the same as not existing, and package-check.mjs now
// FAILS if any of them comes back.
//
// The mechanism stays because the situation can recur: a page here that is
// not uploaded needs no hash, and if one is ever deployed anyway its inline
// script simply will not run. Anything added must be listed by name with the
// reason — "anything with 'setup' in it" is how a real page gets skipped by
// accident.
const NOT_DEPLOYED = []

const pages = readdirSync(DOCROOT).filter((f) => f.endsWith('.html'))
const inline = []
for (const page of pages) {
  const body = readFileSync(new URL(page, DOCROOT), 'utf8')
  const found = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const skip = NOT_DEPLOYED.includes(page)
  console.log(`--   ${page}: ${found.length} inline script(s)${skip ? ' — not deployed, so not hashed' : ''}`)
  if (skip) continue
  for (const s of found) inline.push(createHash('sha256').update(s).digest('base64'))
}
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
