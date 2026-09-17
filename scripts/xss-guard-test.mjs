/**
 * A static guard against the ordinary way XSS gets into this shop: a raw
 * markup injection point, or an unescaped value echoed into server-built HTML.
 *
 *   node scripts/xss-guard-test.mjs
 *
 * WHY THIS EXISTS. Asked on 2026-09-17 for an XSS check. The manual audit that
 * day found nothing exploitable — every hand-written overlay builds the DOM
 * with createElement + textContent, every PHP file that emits HTML wraps its
 * dynamic values in a local escape helper, uploaded images are magic-byte
 * verified against three raster formats (SVG cannot reach this server at all),
 * and the CSP has no 'unsafe-hashes', so even a missed injection point could
 * not run script through an inline event handler. But a clean manual audit is
 * a photograph of one moment, and this project has already learned — for the
 * route extractor, the cache manifest, the admin gate — that a finding without
 * a rig behind it is a finding that quietly stops being true. This is that rig.
 *
 * WHAT IT CHECKS, and why each shape is the one that matters:
 *
 *   1. THE HAND-WRITTEN OVERLAYS (derived the same way sw-version-test.mjs
 *      derives the fixed-name asset list — un-hashed .js files in assets/ —
 *      so a new overlay is covered the day it lands, not the day someone
 *      remembers to add it here) may never call insertAdjacentHTML,
 *      document.write, eval, or `new Function`. Zero exceptions: nothing in
 *      this project has ever needed any of them.
 *
 *   2. AND MAY ONLY SET `.innerHTML` TO THE EMPTY STRING, which clears a card
 *      before rebuilding it with real DOM nodes — never to a value built from
 *      a variable, which is the shape a future edit would take if someone
 *      reached for template-string convenience instead of createElement. ONE
 *      named exception exists (google-signin.js's static setup card, a fixed
 *      literal with no interpolation at all) and it is re-verified here rather
 *      than merely trusted: the exception is void the moment that literal
 *      contains a `${` or a bare `+` concatenation, so it cannot quietly grow
 *      a variable into itself.
 *
 *   3. THE THREE PHP FILES THAT BUILD HTML FROM DATA A CUSTOMER OR THE OWNER
 *      TYPED — seo.php (product name/description into meta tags), pay/pay.php
 *      (the bank redirect form, which also carries live credentials),
 *      orders-print.php (customer name/phone/address/note, read by an ADMIN —
 *      the one place a checkout field becomes a stored-XSS-against-an-admin
 *      vector if it is ever missed). Every short-echo `<?= … ?>` in those
 *      files must wrap its expression in that file's own escape helper, be a
 *      numeric cast, or be a literal with no variable in it at all.
 *
 *   4. THE CSP CARRIES NO 'unsafe-hashes'. pay.php's own comment explains why
 *      this matters more than it looks: a sha256 hash can authorise a
 *      <script> element, and can NEVER authorise an inline event handler —
 *      that needs 'unsafe-hashes' specifically. So even a raw markup
 *      injection this rig failed to catch could not fire an `onerror=` or
 *      `onclick=` unless that grant were added. This is the backstop the rest
 *      of the audit leans on, and it is one flag away from not being true.
 *
 * WHAT IT DOES NOT CHECK. The prebuilt storefront and admin bundles
 * (Shop-*.js, AdminApp-*.js, react-vendor-*.js, …) have no source in this
 * repository — they were read once, by hand, for `innerHTML`/`__html`/
 * `dangerouslySetInnerHTML` and found clean (one static CSS string in the
 * app's own +html.tsx, one QR-code SVG in AdminApp built entirely from loop
 * coordinates rather than the enrolment URI). A rig cannot watch a file this
 * repository does not own; that reading is recorded here so it is not lost,
 * not automated.
 *
 * It writes nothing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

/* ===================== 1+2. the hand-written overlays =================== */
// Same derivation as sw-version-test.mjs, so a new overlay is covered the day
// it is added rather than the day someone remembers this file exists.
const HASHED = /^(.+)-([A-Za-z0-9_-]{8,})\.(js|css)$/
function looksHashed(name) {
  const m = HASHED.exec(name)
  if (!m) return false
  const seg = m[2]
  return /[0-9]/.test(seg) || (/[a-z]/.test(seg) && /[A-Z]/.test(seg))
}
const ASSETS = 'sporta-site/public_html/assets'
let overlays = []
try {
  overlays = readdirSync(ASSETS).filter((f) => f.endsWith('.js') && !looksHashed(f)).sort()
} catch (e) {
  console.log(`FAIL could not read ${ASSETS}: ${e.message}`)
  fails++
}
check(overlays.length >= 5, 'the overlay directory was derived, not hardcoded',
  overlays.length ? `${overlays.length} found: ${overlays.join(', ')}` : 'NOTHING FOUND — every check below would pass by measuring nothing')

// The one place a literal, non-interpolated innerHTML assignment is allowed,
// and it is re-verified below rather than merely trusted.
const INNERHTML_LITERAL_OK = new Set(['google-signin.js'])

const forbidden = [
  [/\.insertAdjacentHTML\s*\(/, 'insertAdjacentHTML'],
  [/\bdocument\.write\s*\(/, 'document.write'],
  [/(?<!\/\/.*)\beval\s*\(/, 'eval('],
  [/new\s+Function\s*\(/, 'new Function('],
]

for (const file of overlays) {
  const path = join(ASSETS, file)
  const src = readFileSync(path, 'utf8')
  const lines = src.split('\n')

  for (const [re, name] of forbidden) {
    const hit = lines.findIndex((l) => re.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    check(hit === -1, `${file}: no ${name}`,
      hit === -1 ? '' : `line ${hit + 1}: ${lines[hit].trim().slice(0, 70)}`)
  }

  // Every `.innerHTML = <expr>` assignment. This project writes JS with no
  // semicolons, so a statement ends at a newline UNLESS the next line
  // continues it with a leading `+` (google-signin.js's multi-line literal) —
  // stopping at the first bare `\n` is right for every single-line clear and
  // does not run on into whatever code happens to follow in the file.
  const assigns = []
  {
    const re = /\.innerHTML\s*=\s*([^\n]*)\n/g
    let m
    while ((m = re.exec(src))) {
      let rhs = m[1]
      let idx = re.lastIndex
      while (/^\s*\+/.test(src.slice(idx))) {
        const nl = src.indexOf('\n', idx)
        rhs += '\n' + src.slice(idx, nl)
        idx = nl + 1
      }
      re.lastIndex = idx
      assigns.push(rhs)
    }
  }
  const bad = []
  for (const rhsRaw of assigns) {
    const rhs = rhsRaw.trim()
    const isEmptyClear = /^(['"])\1$/.test(rhs)
    if (isEmptyClear) continue
    const stmt = rhs
    if (INNERHTML_LITERAL_OK.has(file)) {
      // Allowed ONLY if the whole assignment is string literals joined by
      // `+`, with no template-string interpolation and no bare identifier —
      // i.e. nothing that could carry a variable's value into markup.
      const hasInterpolation = /\$\{/.test(stmt)
      const hasBareVariableConcat = /\+\s*[A-Za-z_$][\w$]*(?!['"`])/.test(stmt)
      if (!hasInterpolation && !hasBareVariableConcat) continue
    }
    bad.push(stmt.slice(0, 90).replace(/\n/g, ' '))
  }
  check(bad.length === 0,
    `${file}: every .innerHTML assignment is an empty clear` + (INNERHTML_LITERAL_OK.has(file) ? ' or a fixed literal' : ''),
    bad.join(' | '))
}

/* ===================== 3. PHP files that build HTML from data =========== */
// Strips every call to one of `fns`, at ANY paren depth, by scanning for the
// matching close paren rather than a fixed-depth regex — `$h(strtoupper((string)
// $x))` nests two levels deep, one more than a regex with a single nested
// group can follow, and PHP casts add another pair of parens for free.
function stripCalls(expr, fns) {
  let out = ''
  let i = 0
  while (i < expr.length) {
    const fn = fns.find((f) => expr.startsWith(f + '(', i))
    if (!fn) { out += expr[i]; i++; continue }
    let depth = 0
    let j = i + fn.length
    do {
      if (expr[j] === '(') depth++
      else if (expr[j] === ')') depth--
      j++
    } while (depth > 0 && j < expr.length)
    i = j   // skip the whole call, including its closing paren
  }
  return out
}

// PHP files that echo `<?= … ?>` short tags: orders-print.php, pay/pay.php.
const PHP_ECHO_TARGETS = [
  { file: 'sporta-site/public_html/api/orders-print.php', safe: ['$h', '$addr', '$kwd'] },
  { file: 'sporta-site/public_html/pay/pay.php', safe: ['$h'] },
]
for (const { file, safe } of PHP_ECHO_TARGETS) {
  let src
  try { src = readFileSync(file, 'utf8') } catch (e) {
    check(false, `${file}: readable`, e.message); continue
  }
  const echoes = [...src.matchAll(/<\?=\s*([\s\S]*?)\s*\?>/g)].map((m) => m[1])
  check(echoes.length > 0, `${file}: found <?= ?> echoes to check`, `${echoes.length} found`)

  const unsafe = echoes.filter((expr) => {
    if (!/\$/.test(expr)) return false   // a literal with no variable at all
    let rest = stripCalls(expr, safe)
    // count(...) always returns an integer — nothing it can be handed can
    // make it echo markup — and a numeric cast is safe for the same reason,
    // so the cast AND its operand (`(int) $l['qty']`) both go, not just the
    // cast token: leaving the operand behind would still show up as a bare
    // `$` and be flagged as though it had never been cast at all.
    rest = rest.replace(/\bcount\([^()]*\)/g, '')
      .replace(/\((?:int|float)\)\s*\$[A-Za-z_]\w*(?:\[[^\]]*\])?/g, '')
    // A variable used only as a CONDITION — immediately before `?`, or on
    // either side of a comparison operator — is never itself echoed; only the
    // ternary's branches are, and those branches are still checked because
    // this strip only removes the variable, not the `?`/`:` around it.
    rest = rest.replace(/\$[A-Za-z_]\w*(?:\[[^\]]*\])?(?=\s*(?:\?|===|!==|==|!=))/g, '')
    return /\$/.test(rest)
  })
  check(unsafe.length === 0,
    `${file}: every dynamic echo is wrapped in ${safe.join('/')}(...)`,
    unsafe.map((e) => e.slice(0, 70).replace(/\s+/g, ' ')).join(' | '))
}

// seo.php builds its <head> block by CONCATENATION ($head .= '...' . e($x)),
// not by short-echo tags — a different shape needs a different check. Every
// statement assigning into $head or $hreflang, with every e(...) call
// stripped, must have no `$variable` left in it beyond the small set of
// values this file has already established are never attacker-shaped
// ($robots and $ogType are derived from booleans, never from $title/$desc/
// $canonical/$image; $isEn is the strict `=== 'en'` comparison itself).
{
  const file = 'sporta-site/public_html/seo.php'
  let src
  try { src = readFileSync(file, 'utf8') } catch (e) {
    check(false, `${file}: readable`, e.message); src = ''
  }
  const stmts = [...src.matchAll(/\$(?:head|hreflang)\s*(?:\.)?=\s*[\s\S]*?;/g)].map((m) => m[0])
  check(stmts.length > 0, `${file}: found $head/$hreflang assignments to check`, `${stmts.length} found`)

  const ALLOWED_BARE = new Set(['$head', '$hreflang', '$robots', '$ogType', '$isEn'])
  const unsafe = []
  for (const stmt of stmts) {
    const stripped = stripCalls(stmt, ["e"])
    const vars = [...stripped.matchAll(/\$[A-Za-z_]\w*/g)].map((m) => m[0])
    const stray = vars.filter((v) => !ALLOWED_BARE.has(v))
    if (stray.length) unsafe.push(`${stmt.slice(0, 60).replace(/\s+/g, ' ')} -> unescaped ${[...new Set(stray)].join(',')}`)
  }
  check(unsafe.length === 0,
    `${file}: every value concatenated into $head/$hreflang is wrapped in e(...)`,
    unsafe.join(' | '))
}

/* ===================== 4. the CSP backstop =============================== */
{
  let htaccess
  try { htaccess = readFileSync('sporta-site/public_html/.htaccess', 'utf8') } catch (e) {
    check(false, '.htaccess: readable', e.message)
    htaccess = ''
  }
  check(!htaccess.includes('unsafe-hashes'),
    "the CSP never grants 'unsafe-hashes' — a hash can authorise a <script>, never an inline event handler",
    htaccess.includes('unsafe-hashes') ? 'FOUND — an injected element could now fire onerror=/onclick=' : '')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — no raw markup injection, every dynamic HTML echo escaped, CSP backstop intact')
process.exit(fails ? 1 : 0)
