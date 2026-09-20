/**
 * A dynamic SQL column name built from a request body key is a mass-
 * assignment hole the moment it is not checked against a fixed allow-list —
 * a customer or admin could otherwise name ANY column and write it.
 *
 *   node scripts/mass-assignment-scan.mjs
 *
 * WHAT THIS LOOKS FOR. `admin.php`'s `customer` route is the one place in
 * this codebase that builds an UPDATE's column list from request data at
 * all — `foreach (($b['fields'] ?? []) as $k => $v) { ...; $sets[] =
 * "\`$k\` = ?"; }` — and it is safe only because of the three lines above it:
 * `if (!in_array($k, $allowed, true)) continue;`. Every other `$sets[]`
 * assignment in the API pushes a LITERAL, hardcoded column name (see
 * `rules_save` and `account_update`), which this scan does not need to
 * check at all — there is no request-controlled value in a literal string.
 *
 * So this is narrow on purpose: it finds every place a SQL fragment string
 * embeds a bare PHP variable as what looks like a column name (backtick or
 * quoted, immediately followed by `= ?`), and requires an `in_array(...,
 * true)` (or `array_key_exists` against a named allow-list) check on that
 * same variable within the preceding 15 lines. A hardcoded literal never
 * matches the pattern at all — this only ever fires on the dangerous shape.
 *
 * MUTATION-TESTED by removing the guard in a scratch copy: caught, naming
 * the file, line and variable.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const files = execFileSync('git', ['ls-files', 'sporta-site/public_html/api/*.php'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)

check(files.length > 0, 'found API PHP files to scan', `${files.length} found`)

// Matches `$k` = ?, "$k" = ?, or '$k' = ? — a bare variable, no concatenation,
// used as the left side of a SQL assignment. A literal column name never has
// a `$` in it, so this pattern only ever matches a REQUEST-SHAPED column.
const DYNAMIC_COL = /[`"']\$([A-Za-z_][A-Za-z0-9_]*)[`"']\s*=\s*\?/g

let sitesFound = 0
for (const rel of files) {
  const src = readFileSync(rel, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    let m
    DYNAMIC_COL.lastIndex = 0
    while ((m = DYNAMIC_COL.exec(line))) {
      sitesFound++
      const varName = m[1]
      const before = lines.slice(Math.max(0, i - 15), i + 1).join('\n')
      // Either a direct in_array(...$var..., true) allow-list check, or the
      // variable itself only ever came from iterating a fixed allow-listed
      // array (foreach ($allowed as $varName) has no request data in it at
      // all, so that shape needs no guard here).
      const guarded =
        new RegExp(`in_array\\s*\\(\\s*\\$${varName}\\s*,\\s*\\$\\w+\\s*,\\s*true\\s*\\)`).test(before) ||
        new RegExp(`array_key_exists\\s*\\(\\s*\\$${varName}\\s*,\\s*\\$\\w+\\s*\\)`).test(before)
      check(guarded,
        `${rel}:${i + 1}: dynamic column "\$${varName}" is checked against an allow-list before use`,
        guarded ? '' : `no in_array($${varName}, ..., true) found in the 15 lines above`)
    }
  })
}

check(sitesFound > 0, 'found at least one dynamic-column site to check',
  sitesFound ? `${sitesFound} found` : 'NOTHING FOUND — every check above would pass by measuring nothing')

console.log(fails ? `\n${fails} failed` : `\nall ok — every request-shaped SQL column name is checked against a fixed allow-list first`)
process.exit(fails ? 1 : 0)
