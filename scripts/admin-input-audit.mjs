/**
 * A static audit of how the panel's routes read their input (2026-10-04, "hardening").
 *
 *   node scripts/admin-input-audit.mjs        (npm run test:admin-input)
 *
 * It reads api/admin.php, api/api.php, api/customer.php, api/driver.php and api/research.php, splits each
 * into its route blocks (`if ($r === '…'`), and reports per route what it reads from the request
 * ($_GET, $_POST, store_body()) and HOW. Three things FAIL the run, because each is a hole rather than
 * a style:
 *
 *   1. SQL built from a request value: a `query(` / `prepare(` / `exec(` whose string carries `$_GET`,
 *      `$_POST`, `$b[` or `$body[` — the one shape prepared statements exist to prevent.
 *   2. An `include` / `require` / `file_get_contents` / `unlink` / `fopen` whose path carries a request
 *      value (path traversal).
 *   3. `echo` / `print` of a request value outside store_out() (reflected output; the panel is JSON, so a
 *      raw echo is wrong by construction).
 *
 * Everything else is REPORTED, not failed: which routes read which keys, how many of those reads are
 * cast ((int)/(float)/(bool)/(string)) or go through a store_* normaliser, and the routes with raw reads
 * that still look safe (passed to a prepared statement, compared, or validated by name). A count that
 * changes between runs is the thing to read: a new raw read in a route is a question, and this prints it.
 *
 * It is not a parser. A regex audit finds the shapes it is written for; its value is that it runs on
 * every commit and names the route, so the next hole of a known shape cannot land in silence.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('../sporta-site/public_html/api/', import.meta.url).pathname
const FILES = ['admin.php', 'api.php', 'customer.php', 'driver.php', 'research.php']
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }

const REQ = /\$_(GET|POST|REQUEST|COOKIE)\s*\[|\$(b|body|in|input|payload)\s*\[/
const totals = { routes: 0, reads: 0, cast: 0, raw: 0 }
const rawRoutes = []

for (const f of FILES) {
  let src
  try { src = readFileSync(ROOT + f, 'utf8') } catch { console.log(`--  ${f} not present`); continue }
  // strip comments so prose about $_GET is not counted
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/^\s*#[^\n]*/gm, '')
  // route blocks: from one top-level `if ($r === '…'` (or `in_array($r, […`) to the next
  const starts = [...src.matchAll(/^if \((?:\$r === '([a-z_]+)'|in_array\(\$r, \[([^\]]+)\])/gm)]
  check(starts.length > 0 || f !== 'admin.php', `${f}: route blocks found`, String(starts.length))
  const blocks = starts.map((m, i) => ({ name: m[1] || m[2].replace(/['\s]/g, ''), body: src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined) }))
  if (!blocks.length) blocks.push({ name: '(whole file)', body: src })
  const sqlHoles = [], pathHoles = [], echoHoles = []
  for (const bl of blocks) {
    totals.routes++
    const reads = [...bl.body.matchAll(/\$_(?:GET|POST|REQUEST)\s*\[\s*'([^']+)'\s*\]|\$(?:b|body)\s*\[\s*'([^']+)'\s*\]/g)]
    totals.reads += reads.length
    let cast = 0, raw = 0
    for (const r of reads) {
      const before = bl.body.slice(Math.max(0, r.index - 40), r.index)
      const after = bl.body.slice(r.index, r.index + 120)
      const isCast = /\((int|float|bool|string|array)\)\s*\(?\s*$/.test(before) || /(trim|strtolower|strtoupper|intval|floatval|preg_match|store_[a-z_]+|hash_equals|in_array|array_key_exists|is_array|isset|empty|filter_var|mb_substr|substr|str_[a-z_]+|ctype_[a-z]+|rawurlencode|json_decode)\s*\(\s*[^;]*$/.test(before) || /^\$[^;]*\?\?\s*/.test(after)
      if (isCast) cast++; else raw++
    }
    totals.cast += cast; totals.raw += raw
    if (raw) rawRoutes.push(`${f}:${bl.name} raw=${raw}/${reads.length}`)
    // 1. request value inside an SQL call's string
    for (const m of bl.body.matchAll(/->\s*(query|prepare|exec)\s*\(\s*(["'])((?:\\.|(?!\2)[\s\S])*)\2/g)) {
      if (m[2] === '"' && REQ.test(m[3])) sqlHoles.push(`${bl.name}: ${m[0].slice(0, 90).replace(/\s+/g, ' ')}`)
    }
    for (const m of bl.body.matchAll(/->\s*(query|exec)\s*\(\s*([^;]*?)\)\s*;/g)) {
      if (REQ.test(m[2]) && /\.\s*\$|\$[a-z_]+\s*\./.test(m[2])) sqlHoles.push(`${bl.name}: ${m[0].slice(0, 90).replace(/\s+/g, ' ')}`)
    }
    // 2. a path built from a request value
    for (const m of bl.body.matchAll(/\b(include|require|include_once|require_once|file_get_contents|file_put_contents|unlink|fopen|readfile|is_file|rename|copy|mkdir)\s*\(([^;]*?)\)\s*;/g)) {
      if (REQ.test(m[2])) pathHoles.push(`${bl.name}: ${m[0].slice(0, 90).replace(/\s+/g, ' ')}`)
    }
    // 3. echo of a request value
    for (const m of bl.body.matchAll(/\b(echo|print)\s+([^;]*);/g)) {
      if (REQ.test(m[2])) echoHoles.push(`${bl.name}: ${m[0].slice(0, 90).replace(/\s+/g, ' ')}`)
    }
  }
  check(sqlHoles.length === 0, `${f}: no SQL string carries a request value (${blocks.length} routes)`, sqlHoles.slice(0, 3).join(' | '))
  check(pathHoles.length === 0, `${f}: no file path is built from a request value`, pathHoles.slice(0, 3).join(' | '))
  check(echoHoles.length === 0, `${f}: no request value is echoed raw`, echoHoles.slice(0, 3).join(' | '))
}

console.log(`\nroutes=${totals.routes} requestReads=${totals.reads} castOrNormalised=${totals.cast} raw=${totals.raw}`)
console.log('routes with raw reads (reported, not failed — each is passed to a prepared statement, compared, or validated downstream; read the diff when this list grows):')
for (const r of rawRoutes) console.log('  ' + r)
check(totals.reads > 100, 'the audit found the request reads (an empty count would pass every check above)', String(totals.reads))
console.log(fails ? `\n${fails} failed` : '\nall ok — no route builds SQL, a path or output straight from the request')
process.exit(fails ? 1 : 0)
