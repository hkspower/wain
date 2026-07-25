// Checks that every table, column and function the code touches actually
// exists in a database built from supabase/*.sql alone.
//
// This is the check that would have caught the payment bug: callback.php wrote
// knet_* columns that were never in the schema, PostgREST rejected the whole
// PATCH, and every captured payment went unrecorded. Nothing in the build or
// the type system connects PHP string literals and PostgREST select lists to
// the SQL that defines them — so it has to be asserted.
//
// Needs PostgreSQL on :5433 with a database built by scripts/db-rebuild.sh.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const run = promisify(execFile)
const DB = process.argv[2] ?? 'fresh'
const ROOT = new URL('..', import.meta.url).pathname
const sql = async (q) =>
  (await run('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', DB, '-tAq', '-c', q])).stdout.trim()

// ---- what the database actually has ----------------------------------------
const columns = new Map() // table -> Set(columns)
for (const line of (await sql(
  `select table_name||':'||column_name from information_schema.columns where table_schema='public'`)).split('\n')) {
  const [t, c] = line.split(':')
  if (!t) continue
  if (!columns.has(t)) columns.set(t, new Set())
  columns.get(t).add(c)
}
const functions = new Set(
  (await sql(`select routine_name from information_schema.routines where routine_schema='public'`)).split('\n').filter(Boolean))

// ---- what the code asks for ------------------------------------------------
const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'supabase'].includes(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|jsx|ts|tsx|php|mjs)$/.test(p) && !p.includes('/scripts/')) files.push(p)
  }
})(ROOT)

const refs = []
const add = (file, kind, table, name) => refs.push({ file: relative(ROOT, file), kind, table, name })

for (const file of files) {
  const src = readFileSync(file, 'utf8')

  // supabase-js: .from('t') ... .select('a, b, c(...)')  /  .rpc('fn')
  for (const m of src.matchAll(/\.from\(['"]([a-z_]+)['"]\)([\s\S]{0,600}?)(?=\n\s*\n|$)/g)) {
    const table = m[1]
    if (!columns.has(table)) { add(file, 'table', table, table); continue }
    for (const sel of m[2].matchAll(/\.select\(\s*([\s\S]*?)\)\s*(?:\.|$)/g)) {
      // strip quotes/concatenation, drop embedded-resource blocks like products ( … )
      const list = sel[1].replace(/['"+\n]/g, ' ').replace(/\([^)]*\)/g, '')
      for (const col of list.split(',').map((s) => s.trim()).filter(Boolean)) {
        // `products ( slug, name_en )` is an embedded resource — a table name,
        // not a column of this table.
        if (/^[a-z_]+$/.test(col) && !columns.has(col)) add(file, 'column', table, col)
      }
    }
    // .eq('col', …) / .ilike('col', …) / .order('col')
    for (const f of m[2].matchAll(/\.(?:eq|neq|ilike|gt|lt|gte|lte|order)\(\s*['"]([a-z_]+)['"]/g)) {
      add(file, 'column', table, f[1])
    }
  }
  for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_]+)['"]/g)) add(file, 'function', '', m[1])

  // PHP: PostgREST URLs and PATCH payload keys
  if (file.endsWith('.php')) {
    for (const m of src.matchAll(/select=([a-z_,]+)/g)) {
      for (const col of m[1].split(',')) add(file, 'column', 'orders/products', col)
    }
    // Only the request body counts as a column list. knet_log() also calls
    // json_encode, and its keys (ts, event, ip) are log fields — matching every
    // json_encode reported six phantom columns and made the report untrustworthy.
    for (const m of src.matchAll(/\$payload\s*=\s*json_encode\(\[([\s\S]*?)\n\s*\]\);/g)) {
      for (const k of m[1].matchAll(/'([a-z_]+)'\s*=>/g)) add(file, 'column', 'orders', k[1])
    }
    for (const m of src.matchAll(/'rpc\/([a-z_]+)'/g)) add(file, 'function', '', m[1])
  }
}

// ---- verify ----------------------------------------------------------------
const problems = []
const anyTableHas = (col) => [...columns.values()].some((s) => s.has(col))

for (const r of refs) {
  if (r.kind === 'function') {
    if (!functions.has(r.name)) problems.push(r)
  } else if (r.kind === 'table') {
    problems.push(r)
  } else if (r.table.includes('/')) {
    // PHP: table not pinned down by the regex — accept if any table has it
    if (!anyTableHas(r.name)) problems.push(r)
  } else if (!columns.get(r.table)?.has(r.name)) {
    problems.push(r)
  }
}

const uniq = [...new Map(problems.map((p) => [p.file + p.kind + p.table + p.name, p])).values()]
const checked = new Set(refs.map((r) => r.kind + r.table + r.name)).size

console.log(`checked ${checked} distinct database references across ${files.length} source files`)
console.log(`schema has ${columns.size} tables, ${functions.size} functions\n`)

if (!uniq.length) {
  console.log('OK — every table, column and function the code uses exists in the schema')
  process.exit(0)
}
console.log(`${uniq.length} MISSING:\n`)
for (const p of uniq) {
  console.log(`  ${p.kind.padEnd(8)} ${(p.table ? p.table + '.' : '') + p.name}`.padEnd(52) + p.file)
}
process.exit(1)
