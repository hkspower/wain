/**
 * Regenerate live-schema-full.php's schema manifest from a FRESH import, and
 * fail when it drifts.
 *
 *   node scripts/make-schema-manifest.mjs            # rewrite the manifest
 *   node scripts/make-schema-manifest.mjs --check    # fail if it is out of date
 *
 * Add --quiet to drop the per-file findings and print only the verdict.
 *
 * WHY THIS EXISTS. live-schema-full.php answers "is any migration still to run
 * on the live database?" by comparing information_schema with a list of every
 * table.column a fresh install has. That list was TYPED IN on 2026-10-03 (424
 * columns), and within four days customer_passkeys, customer_login_codes,
 * rate_bucket, admin_sessions, admin_passkeys, order_location, suppliers,
 * purchase_orders and site_images had all been added — so the checker could
 * not see a single one of them, and a live database missing every one would
 * have read `missing=0`. That is the hardcoded file manifest's failure
 * (CLAUDE.md, "The second hardcoded manifest") on a third surface: a list a
 * person has to remember to refresh is a list that is already stale.
 *
 * WHAT IT IMPORTS, and in which order:
 *   1. database-sql/IMPORT-THIS-ONE.sql, which must import cleanly (and is
 *      imported twice, because its header promises it is safe to re-run);
 *   2. then EVERY api/*.mysql.sql, each one twice, with --force. They are the
 *      per-feature files the migrate-*.php publishers run on the live server,
 *      and several are not folded into the install at all — so the install
 *      alone is not what a fully-migrated live database looks like.
 * The union is the manifest: every table, every column with its type, every
 * index name.
 *
 * IT NEVER TOUCHES THE SANDBOX DATABASE. Other rigs use `sporta` concurrently.
 * The import runs in a scratch database with a pid in its name, as a
 * throwaway user granted rights on THAT database only — so a stray `use
 * sporta;` added to some .sql file one day is refused by the server, not
 * obeyed. Both are dropped on every exit path.
 *
 * THE MIGRATOR MAP. For each table (and each added column) the manifest also
 * carries the scripts/publish/migrate-*.php that would create it on a live
 * database that predates it, read statically: the api/<x>.mysql.sql a
 * publisher runs (its `'/api/<x>.mysql.sql'` path), plus any CREATE TABLE /
 * ALTER TABLE … ADD COLUMN written inline in the publisher itself. A table
 * nothing creates is written as absent, and the live script says
 * `no-migrator` — which is the honest answer and a finding in its own right.
 *
 * TWO GUARDS, both copied from make-file-manifest.mjs for the reason given
 * there: it refuses to write a suspiciously small manifest (an empty one
 * reports `missing=0`, which reads like a clean run), and it checks its own
 * replacement afterwards (a replacement that matches nothing is a no-op that
 * looks like success).
 */
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const ROOT = new URL('../', import.meta.url).pathname
const PHP = 'scripts/live/live-schema-full.php'
const INSTALL = 'sporta-site/database-sql/IMPORT-THIS-ONE.sql'
const API = 'sporta-site/public_html/api/'
const PUBLISH = 'scripts/publish/'
const check = process.argv.includes('--check')
const quiet = process.argv.includes('--quiet')

// THE NORMALISATION HAS TWO HOMES and they must agree: this function and
// norm() in live-schema-full.php. It only removes differences that are about
// the SERVER, never about the schema: MySQL 8 drops integer display widths
// (`int(10) unsigned` reads `int unsigned`), and MariaDB reports a JSON column
// as `longtext`. Anything else — an enum value list, a varchar length — is a
// real difference and is left for the comparison to report.
const norm = (t) => t.toLowerCase()
  .replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/g, '$1')
  .replace(/\s+zerofill\b/g, '')
  .replace(/^json$/, 'longtext')
  .trim()

// ------------------------------------------------------------ scratch database
const tag = `${process.pid}_${randomBytes(3).toString('hex')}`
const DB = `sporta_schema_gen_${tag}`
const USER = `schema_gen_${tag}`
const PW = randomBytes(18).toString('base64url')

const root = (q) => {
  const r = spawnSync('mariadb', ['-uroot', '-N', '-B', '-e', q], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`mariadb -uroot failed: ${(r.stderr || r.error || '').toString().trim().slice(0, 300)}`)
  return r.stdout
}

let created = false
const cleanup = () => {
  if (!created) return
  created = false
  try { root(`drop database if exists \`${DB}\`; drop user if exists '${USER}'@'localhost'`) } catch (e) {
    console.error(`WARN could not drop the scratch database ${DB}: ${e.message}`)
  }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130) })
// A crash must not exit 1, which is what --check uses for "the manifest drifted":
// a run that never finished has not measured drift in either direction.
process.on('uncaughtException', (e) => { console.error(`ERROR ${e.stack || e}`); cleanup(); process.exit(2) })

const die = (msg) => { console.error(msg); process.exit(2) }

try { root('select 1') } catch (e) {
  die(`cannot reach MariaDB as root, so the manifest cannot be built or checked — ${e.message}\n` +
      'Start the sandbox (bash scripts/sandbox.sh). This refuses rather than passes: a check that cannot run has not run.')
}
root(`create database \`${DB}\` character set utf8mb4 collate utf8mb4_unicode_ci`)
created = true
root(`create user '${USER}'@'localhost' identified by '${PW}'; grant all privileges on \`${DB}\`.* to '${USER}'@'localhost'`)

// Strip SQL comments before any static reading, so prose ("use this file…",
// "create table if not exists does nothing on a second run") is not read as a
// statement. Quoted strings are left alone.
const stripSqlComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)(--|#)[^\n]*/g, '$1')

function importSql(path, { force }) {
  const body = readFileSync(ROOT + path, 'utf8')
  const code = stripSqlComments(body)
  if (/^\s*use\s+\S/im.test(code) || /\b(create|drop|alter)\s+(database|schema)\b/i.test(code) || /\bgrant\b/i.test(code)) {
    return { ok: false, errors: ['REFUSED: the file switches or alters a database, or grants; it is not imported'] }
  }
  const r = spawnSync('mariadb', ['-u', USER, '--default-character-set=utf8mb4', ...(force ? ['--force'] : []), DB], {
    input: body, encoding: 'utf8', env: { ...process.env, MYSQL_PWD: PW }, maxBuffer: 64 << 20,
  })
  const errors = (r.stderr || '').split('\n').filter((l) => /^ERROR\b/.test(l)).map((l) => l.trim())
  if (r.error) errors.push(String(r.error))
  return { ok: r.status === 0 && errors.length === 0, errors }
}

const unesc = (s) => s.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', 0: '\0', '\\': '\\' })[c] ?? c)
const rows = (q) => root(`use \`${DB}\`; ${q}`).split('\n').filter(Boolean).map((l) => l.split('\t').map(unesc))

function snap() {
  const tables = new Map()
  for (const [t, kind] of rows(`select table_name, table_type from information_schema.tables where table_schema = '${DB}'`)) {
    if (kind === 'BASE TABLE') tables.set(t, { cols: new Map(), idx: new Set() })
  }
  for (const [t, c, ty] of rows(`select table_name, column_name, column_type from information_schema.columns where table_schema = '${DB}'`)) {
    tables.get(t)?.cols.set(c, norm(ty))
  }
  for (const [t, i] of rows(`select distinct table_name, index_name from information_schema.statistics where table_schema = '${DB}'`)) {
    tables.get(t)?.idx.add(i)
  }
  return tables
}

function diff(a, b) {
  const d = { tables: [], cols: [], types: [], idx: [], gone: [] }
  for (const [t, v] of b) {
    const old = a.get(t)
    if (!old) { d.tables.push(t); continue }
    for (const [c, ty] of v.cols) {
      if (!old.cols.has(c)) d.cols.push(`${t}.${c}`)
      else if (old.cols.get(c) !== ty) d.types.push(`${t}.${c} ${old.cols.get(c)} -> ${ty}`)
    }
    for (const i of v.idx) if (!old.idx.has(i)) d.idx.push(`${t}.${i}`)
  }
  for (const [t, v] of a) {
    if (!b.has(t)) { d.gone.push(t); continue }
    for (const c of v.cols.keys()) if (!b.get(t).cols.has(c)) d.gone.push(`${t}.${c}`)
    for (const i of v.idx) if (!b.get(t).idx.has(i)) d.gone.push(`${t}.${i} (index)`)
  }
  return d
}
const isEmpty = (d) => Object.values(d).every((x) => x.length === 0)
const fmt = (d) => [
  d.tables.length && `+${d.tables.length} table(s): ${d.tables.join(', ')}`,
  d.cols.length && `+${d.cols.length} column(s): ${d.cols.slice(0, 12).join(', ')}${d.cols.length > 12 ? ', …' : ''}`,
  d.types.length && `${d.types.length} type change(s): ${d.types.slice(0, 6).join('; ')}`,
  d.idx.length && `+${d.idx.length} index(es): ${d.idx.slice(0, 8).join(', ')}`,
  d.gone.length && `REMOVED ${d.gone.length}: ${d.gone.slice(0, 8).join(', ')}`,
].filter(Boolean).join(' | ')

const findings = []
const note = (s) => { findings.push(s); if (!quiet) console.log(`note ${s}`) }
// A PROBLEM is a file that does not import, or does not import twice, and it is
// printed even under --quiet and fails --check. It used to be a note: `--check
// --quiet` (the npm test) then passed with a new api/*.mysql.sql that failed to
// import, and write mode wrote a manifest WITHOUT that file's tables and exited
// 0 — so the checker could not see them on the live side, which is the exact
// silence this generator exists to end. A first-import failure blocks writing.
const problems = []
let partial = false
const problem = (s, { blocksWrite = false } = {}) => {
  problems.push(s); if (blocksWrite) partial = true
  console.error(`PROBLEM ${s}`)
}

// ------------------------------------------------------------------ 1. install
const first = importSql(INSTALL, { force: false })
if (!first.ok) die(`${INSTALL} does not import into an empty database — the manifest would be wrong, so nothing is written:\n  ${first.errors.slice(0, 5).join('\n  ')}`)
const base = snap()
const again = importSql(INSTALL, { force: true })
if (!again.ok) problem(`${INSTALL} FAILS ON RE-IMPORT, though its header says it is safe to re-run: ${again.errors.slice(0, 3).join(' / ')}`)
else if (!isEmpty(diff(base, snap()))) problem(`${INSTALL} CHANGES THE SCHEMA ON A SECOND IMPORT: ${fmt(diff(base, snap()))}`)

// ---------------------------------------------------------- 2. every api file
const installText = readFileSync(ROOT + INSTALL, 'utf8')
const apiFiles = readdirSync(ROOT + API).filter((f) => f.endsWith('.mysql.sql')).sort()
if (apiFiles.length < 10) die(`only ${apiFiles.length} api/*.mysql.sql found — refusing to build a manifest from that`)
const notIncluded = []
const perFile = new Map()
for (const f of apiFiles) {
  const included = installText.includes(`(${f})`)
  if (!included) notIncluded.push(f)
  const before = snap()
  const p1 = importSql(API + f, { force: true })
  const mid = snap()
  const p2 = importSql(API + f, { force: true })
  const after = snap()
  const added = diff(before, mid)
  perFile.set(f, added)
  if (!p1.ok) problem(`api/${f} FAILS when imported over the install: ${p1.errors.slice(0, 2).join(' / ')}${p1.errors.length > 2 ? ` (+${p1.errors.length - 2} more)` : ''}`, { blocksWrite: true })
  if (!p2.ok && !p1.errors[0]?.startsWith('REFUSED')) problem(`api/${f} FAILS ON RE-IMPORT (not safe to re-run): ${p2.errors.slice(0, 2).join(' / ')}${p2.errors.length > 2 ? ` (+${p2.errors.length - 2} more)` : ''}`)
  else if (!isEmpty(diff(mid, after))) problem(`api/${f} CHANGES THE SCHEMA ON A SECOND RUN: ${fmt(diff(mid, after))}`)
  if (!isEmpty(added)) note(`api/${f}${included ? '' : ' (NOT in the install)'} adds what the install lacks: ${fmt(added)}`)
}
const final = snap()
cleanup()

const overall = diff(base, final)
if (overall.types.length) note(`the api files CHANGE ${overall.types.length} column type(s) the install sets — the manifest takes the install's: ${overall.types.slice(0, 6).join('; ')}`)

// A column the install already defines keeps the INSTALL's type. The install is
// the one file that is generated and tested (install-sql-test.mjs); an older
// api file that redefines a column is a finding above, not the authority.
for (const [t, v] of base) for (const [c, ty] of v.cols) final.get(t)?.cols.set(c, ty)

// ------------------------------------------------------------- 3. migrator map
const sqlCreates = (code) => [...code.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?`?(\w+)`?/gi)].map((m) => m[1])
function sqlAddsColumns(code, stopAtQuote) {
  const out = []
  for (const m of code.matchAll(/\balter\s+table\s+`?(\w+)`?\s+/gi)) {
    const rest = code.slice(m.index + m[0].length)
    const end = rest.search(stopAtQuote ? /[;"']/ : /;/)
    const stmt = end < 0 ? rest : rest.slice(0, end)
    // Split the clauses on commas at paren depth 0.
    let depth = 0, cur = ''; const clauses = []
    for (const ch of stmt) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { clauses.push(cur); cur = '' } else cur += ch
    }
    clauses.push(cur)
    for (const cl of clauses) {
      const a = cl.trim().match(/^add\s+(column\s+)?(?:if\s+not\s+exists\s+)?`?(\w+)`?/i)
      if (!a) continue
      if (!a[1] && /^(index|key|unique|constraint|primary|foreign|fulltext|spatial|check|partition|period|system)$/i.test(a[2])) continue
      out.push(`${m[1]}.${a[2]}`)
    }
  }
  return out
}
const stripPhpComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/|#|\*).*$/gm, '')

const creates = {}, adds = {}
const migrators = readdirSync(ROOT + PUBLISH).filter((f) => /^migrate-.*\.php$/.test(f)).sort()
if (migrators.length < 5) die(`only ${migrators.length} migrate-*.php found — refusing to build a migrator map from that`)
const runsFile = {}
for (const m of migrators) {
  const src = readFileSync(ROOT + PUBLISH + m, 'utf8')
  const refs = [...src.matchAll(/['"]\/api\/([\w-]+\.mysql\.sql)['"]/g)].map((x) => x[1])
  runsFile[m] = refs
  const pieces = [{ code: stripPhpComments(src), inline: true }]
  for (const f of refs) {
    try { pieces.push({ code: stripSqlComments(readFileSync(ROOT + API + f, 'utf8')), inline: false }) }
    catch { problem(`${PUBLISH}${m} runs api/${f}, which does not exist in the repository`) }
  }
  for (const { code, inline } of pieces) {
    for (const t of sqlCreates(code)) (creates[t] ??= new Set()).add(m)
    for (const tc of sqlAddsColumns(code, inline)) (adds[tc] ??= new Set()).add(m)
  }
}

// ---------------------------------------------------------- 4. build manifest
const tableNames = [...final.keys()].sort()
const colCount = tableNames.reduce((n, t) => n + final.get(t).cols.size, 0)
const idxCount = tableNames.reduce((n, t) => n + final.get(t).idx.size, 0)
if (tableNames.length < 30 || colCount < 300) {
  die(`the fresh import produced only ${tableNames.length} tables / ${colCount} columns — refusing to write a manifest from that`)
}
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const manifest = { tables: {}, creates: {}, adds: {} }
for (const t of tableNames) {
  const v = final.get(t)
  manifest.tables[t] = {
    cols: Object.fromEntries([...v.cols.entries()].sort(([a], [b]) => byName(a, b))),
    idx: [...v.idx].sort(byName),
  }
  if (creates[t]) manifest.creates[t] = [...creates[t]].sort(byName)
}
for (const tc of Object.keys(adds).sort(byName)) {
  const [t, c] = tc.split('.')
  // Only columns the manifest actually has — an ADD COLUMN for a column a later
  // file dropped or renamed would name a migrator for nothing.
  if (!manifest.tables[t]?.cols[c]) continue
  manifest.adds[tc] = [...adds[tc]].sort(byName)
}

// The findings the orchestrator asked for, computed from the same data.
if (notIncluded.length) {
  const real = notIncluded.filter((f) => !isEmpty(perFile.get(f)))
  note(`${notIncluded.length} api/*.mysql.sql are NOT folded into ${INSTALL}: ${notIncluded.join(', ')}`)
  if (real.length) note(`of those, ${real.length} add schema a fresh install does NOT get: ${real.join(', ')}`)
}
const apiTables = new Map()
for (const f of apiFiles) for (const t of new Set(sqlCreates(stripSqlComments(readFileSync(ROOT + API + f, 'utf8'))))) (apiTables.get(t) ?? apiTables.set(t, []).get(t)).push(f)
const orphan = [...apiTables.keys()].filter((t) => !creates[t] && manifest.tables[t]).sort(byName)
const orphanNotInstalled = orphan.filter((t) => !base.has(t))
if (orphan.length) {
  note(`${orphan.length} table(s) an api/*.mysql.sql creates have NO migrate-*.php — a live database that predates one gets it only by a hand import: ${orphan.map((t) => `${t}(${apiTables.get(t).join('/')})`).join(', ')}`)
  note(orphanNotInstalled.length
    ? `${orphanNotInstalled.length} of them are NOT in the install either, so they reach NO database except by hand: ${orphanNotInstalled.join(', ')}`
    : `all ${orphan.length} are in the install, so a fresh install gets every one`)
}
const noMig = tableNames.filter((t) => !creates[t])
note(`${noMig.length}/${tableNames.length} tables have no migrator at all (they reach a database only through the install): ${noMig.join(', ')}`)

const json = '{"tables":{\n' +
  tableNames.map((t) => `${JSON.stringify(t)}:${JSON.stringify(manifest.tables[t])}`).join(',\n') +
  '\n},\n"creates":' + JSON.stringify(manifest.creates) +
  ',\n"adds":' + JSON.stringify(manifest.adds) + '}'
JSON.parse(json) // a generator that emits invalid JSON reports nothing at all on the live side
const BEGIN = '// >>> SCHEMA MANIFEST — generated by scripts/make-schema-manifest.mjs; do not edit by hand.'
const END = '// <<< SCHEMA MANIFEST'
const block = `${BEGIN}\n// ${tableNames.length} tables, ${colCount} columns, ${idxCount} indexes: ${INSTALL} + ${apiFiles.length} api/*.mysql.sql.\n` +
  `$MANIFEST_JSON = <<<'JSON'\n${json}\nJSON;\n${END}`

const src = readFileSync(ROOT + PHP, 'utf8')
const re = /\/\/ >>> SCHEMA MANIFEST[^\n]*\n[\s\S]*?\n\/\/ <<< SCHEMA MANIFEST/
const next = src.replace(re, () => block)
if (next === src && !src.includes(block)) die(`the manifest block was not replaced in ${PHP} — the markers matched nothing`)

const parseBlock = (text) => {
  const m = text.match(/\$MANIFEST_JSON = <<<'JSON'\n([\s\S]*?)\nJSON;/)
  try { return m ? JSON.parse(m[1]) : null } catch { return null }
}

const summary = `${tableNames.length} tables, ${colCount} columns, ${idxCount} indexes, ${Object.keys(manifest.creates).length} tables with a migrator`
const failProblems = () => {
  if (!problems.length) return false
  console.error(`FAIL ${problems.length} .sql problem(s), listed above as PROBLEM — the manifest is only as complete as the files that import`)
  return true
}
if (!check && partial) die(`refusing to write ${PHP}: an api/*.mysql.sql did not import (PROBLEM above), so the manifest would be missing its tables`)
if (check) {
  if (next === src) {
    if (failProblems()) process.exit(1)
    console.log(`ok   ${PHP}: the schema manifest matches a fresh import (${summary})`); process.exit(0)
  }
  const was = parseBlock(src) ?? { tables: {}, creates: {}, adds: {} }
  const lines = []
  const wt = Object.keys(was.tables), nt = Object.keys(manifest.tables)
  const addT = nt.filter((t) => !was.tables[t]), goneT = wt.filter((t) => !manifest.tables[t])
  if (addT.length) lines.push(`${addT.length} table(s) missing from it: ${addT.join(', ')}`)
  if (goneT.length) lines.push(`${goneT.length} table(s) no install creates any more: ${goneT.join(', ')}`)
  const addC = [], goneC = [], ty = [], ix = []
  for (const t of nt) {
    if (!was.tables[t]) continue
    const a = was.tables[t].cols, b = manifest.tables[t].cols
    for (const c of Object.keys(b)) if (!(c in a)) addC.push(`${t}.${c}`); else if (a[c] !== b[c]) ty.push(`${t}.${c} ${a[c]} -> ${b[c]}`)
    for (const c of Object.keys(a)) if (!(c in b)) goneC.push(`${t}.${c}`)
    const ai = new Set(was.tables[t].idx), bi = new Set(manifest.tables[t].idx)
    for (const i of bi) if (!ai.has(i)) ix.push(`+${t}.${i}`)
    for (const i of ai) if (!bi.has(i)) ix.push(`-${t}.${i}`)
  }
  if (addC.length) lines.push(`${addC.length} column(s) missing from it: ${addC.slice(0, 10).join(', ')}`)
  if (goneC.length) lines.push(`${goneC.length} column(s) no install creates any more: ${goneC.slice(0, 10).join(', ')}`)
  if (ty.length) lines.push(`${ty.length} type(s) changed: ${ty.slice(0, 6).join('; ')}`)
  if (ix.length) lines.push(`${ix.length} index change(s): ${ix.slice(0, 10).join(', ')}`)
  if (JSON.stringify(was.creates) !== JSON.stringify(manifest.creates) || JSON.stringify(was.adds) !== JSON.stringify(manifest.adds)) lines.push('the table/column -> migrate-*.php map changed')
  if (!lines.length) lines.push('the block text differs (formatting or header line)')
  console.error(`FAIL the schema manifest in ${PHP} is out of date — run: node scripts/make-schema-manifest.mjs`)
  for (const l of lines) console.error(`       ${l}`)
  console.error('     A stale manifest cannot see a table added since it was written, so a live')
  console.error('     database missing that table reads as complete.')
  failProblems()
  process.exit(1)
}

writeFileSync(ROOT + PHP, next)
// Check the replacement AFTERWARDS: read the file back, parse the block, and
// require it to be exactly what was meant — and require PHP to accept it.
const back = parseBlock(readFileSync(ROOT + PHP, 'utf8'))
if (!back || JSON.stringify(back) !== JSON.stringify(manifest)) die(`${PHP} was written but its manifest does not read back as written`)
try { execFileSync('php', ['-l', ROOT + PHP], { stdio: 'pipe' }) } catch (e) { die(`${PHP} no longer passes php -l: ${String(e.stderr).trim()}`) }
console.log(`wrote ${summary} into ${PHP}${findings.length ? ` (${findings.length} findings above)` : ''}`)
