/**
 * The admin contract, held together mechanically.
 *
 *   node scripts/admin-contract-test.mjs        (no server, no browser)
 *
 * Three files claim to speak the same protocol: admin.php (the authority),
 * src/lib/admin.ts (the app), and scripts/mock-admin.py (the fixture the
 * browser rig drives). For months the second and third agreed with each other
 * and not with the first — Bearer tokens, hyphenated route names, five routes
 * that did not exist — and every test passed while every production request
 * would have failed. This file is why that cannot recur quietly: every route
 * the client or the fixture names must exist in admin.php, spelled
 * identically, and the client must carry the auth the server demands.
 */
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const php = read('sporta-site/public_html/api/admin.php')
const ts = read('src/lib/admin.ts')
const mock = read('scripts/mock-admin.py')

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

// --- every route admin.php implements -------------------------------------
const phpRoutes = new Set([...php.matchAll(/\$r === '([a-z_]+)'/g)].map((m) => m[1]))
check(phpRoutes.size > 40, `admin.php implements ${phpRoutes.size} routes`)

// --- the app names only real routes ---------------------------------------
// Both spellings a call site can take: call('name', …) and a template with
// query params, call(`name&x=…`).
// [a-z_-]: the extractor must SEE a hyphenated name to fail it. An
// extractor that only matches well-formed names silently drops the
// malformed ones — which is a rebuild of the very bug this file guards
// against, one layer up.
const tsRoutes = new Set(
  [...ts.matchAll(/call[^(]*\(\s*[`']([a-z_-]+)[&`']/g)].map((m) => m[1]),
)
check(tsRoutes.size >= 12, `admin.ts calls ${tsRoutes.size} routes (${[...tsRoutes].join(', ')})`)
for (const r of tsRoutes) {
  check(phpRoutes.has(r), `admin.ts route '${r}' exists in admin.php`)
}

// --- the fixture serves only real routes (reset excepted, by name) ---------
const mockRoutes = new Set([...mock.matchAll(/\br == '([a-z_-]+)'/g)].map((m) => m[1]))
for (const r of mockRoutes) {
  if (r === 'reset') continue // fixture-only, documented in its header
  check(phpRoutes.has(r), `mock route '${r}' exists in admin.php`)
}
// And everything the app calls, the fixture can answer — otherwise the
// browser rig cannot exercise the app's own requests.
for (const r of tsRoutes) {
  check(mockRoutes.has(r), `mock implements '${r}', which the app calls`)
}

// --- the auth the server demands, the client carries -----------------------
check(/store_require_admin_header/.test(php) && /X_SPORTA_ADMIN/.test(read('sporta-site/public_html/api/store.php')),
  'admin.php requires the X-Sporta-Admin header')
check(/['"]X-Sporta-Admin['"]:\s*'1'/.test(ts), 'admin.ts sends X-Sporta-Admin: 1')
check(/credentials:\s*'include'/.test(ts), "admin.ts sends the session cookie (credentials: 'include')")
// The header NAME as a code string, not the word in prose — this file's own
// history lesson in admin.ts's comment block must not fail the check that
// exists because of it.
check(!/['"]Authorization['"]/.test(ts), 'admin.ts sets no Authorization header — the server has no idea what one is')

// --- the words that were wrong once, asserted by name ----------------------
// The fulfilment axis says 'packed'; the app's display word is 'packing'.
// Sending the display word was exactly the kind of bug this file exists for.
check(/'packing'\s*\?\s*'packed'/.test(ts), "admin.ts translates its 'packing' to the server's 'packed'")
const setStatusSrc = ts.match(/setStatus:[^]{0,900}/)?.[0] ?? ''
check(setStatusSrc.includes("'cod_paid'") &&
    setStatusSrc.indexOf("'cod_paid'") < setStatusSrc.indexOf("'fulfilment'"),
  'setStatus routes the paid move to cod_paid before anything touches fulfilment')

console.log(fails ? `\n${fails} failed` : '\nall ok — three files, one contract')
process.exit(fails ? 1 : 0)
