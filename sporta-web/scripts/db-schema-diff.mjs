#!/usr/bin/env node
// DB SCHEMA DIFF — what the database will look like, depending on HOW it was installed.
//
//   node scripts/db-schema-diff.mjs                      build every variant on a private MariaDB, print the diff
//   node scripts/db-schema-diff.mjs --out DIR            also write schema-diff.json (+ the snapshots) into DIR
//   node scripts/db-schema-diff.mjs --shuffles 8 --seed 7   how many shuffled migration orders (default 6)
//   node scripts/db-schema-diff.mjs --quick              skip the per-file standalone and shuffle phases
//   node scripts/db-schema-diff.mjs --live-dump FILE     compare to a structure dump (default docs/live-schema-structure.sql)
//   node scripts/db-schema-diff.mjs --print-queries DB   print `set session transaction read only` and the SELECTs that make a snapshot: five for the schema
//                                                        plus four optional ones (triggers, views, routines, events: hidden writers)
//   node scripts/db-schema-diff.mjs --against DIR        compare the schema the repository builds with a live export (DIR/{tables,columns,indexes,fks,checks}.jsonl,
//                                                        and optionally DIR/{triggers,views,routines,events,privileges}.jsonl). Besides the differences it names the ones
//                                                        that can break this code on live: a repository table/column live lacks, a live-only NOT NULL column
//                                                        without a default, a live column narrower than the repository's, any live trigger/view/routine/event.
//                                                        Exit 1 when there is any of them.
//
// WHY IT EXISTS. CLAUDE.md records the proven failure mode of this project: column drift between
// code and database. On 2026-11-02 the live DB lacked inventory.mysql.sql, every order 500'd for 33
// days, and a Profiles screen answered 503 for a long time because a query named a column
// (customer_accounts.last_login_at) that no migration created. Which schema a shop actually carries
// depends on HOW it was installed (one import of install.mysql.sql, or schema + migrations in the
// order a document or a script happened to use), so this builds the schema every way the repository
// documents and compares them, table by table, column by column, index by index.
//
// VARIANTS (all on a PRIVATE MariaDB with its own datadir; the shared test rig is never touched):
//   install   install.mysql.sql alone                                              (i)
//   tooling   schema.mysql.sql, then the install parts in make-install-sql.mjs order, then every other
//             additive file alphabetically. This is what `npm run sandbox` and the race/pool rigs
//             end up with (install.mysql.sql + the remaining files alphabetically).   (ii)
//   docs      schema, seed, brands, promo (the README/NATIVE-BACKEND.md order), then every other
//             file alphabetically.                                                    (ii, second order)
//   twice     tooling, then every file applied a SECOND time (idempotence)           (iii)
//   shuffle-N tooling's file set in a random order (seeded, reproducible)             (iii)
//   live-dump docs/live-schema-structure.sql (the production dump of 2026-11-01, columns only: the
//             dump carries no keys, no AUTO_INCREMENT and no engine on some tables)
//
// WHAT IS COMPARED, from information_schema: tables (engine, collation), columns (type, nullability,
// default, character set, collation, extra, generation expression), indexes (columns in order, prefix
// length, uniqueness, type), foreign keys (columns, referenced table, ON UPDATE/DELETE rule) and CHECK
// constraints. Column ORDER is reported apart from the rest: it matters only to a positional INSERT
// or SELECT *, and it differs legitimately between install orders.
//
// Nothing here writes to a real database. The module is importable (db-columns-audit.mjs and both
// test suites use it); with no arguments it is a CLI.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startPrivateMariadb } from './lib/private-mariadb.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB = join(HERE, '..')
export const SQLDIR = join(WEB, 'dropin/php-store')
export const LIVE_DUMP = join(WEB, 'docs/live-schema-structure.sql')

// ------------------------------------------------------------------ the files

// The install parts, READ from the generator (a second copy of the list is the drift this exists to find).
export function installParts(dir = SQLDIR, generator = join(dir, '..', '..', 'scripts', 'make-install-sql.mjs')) {
  // A tree without its own generator (a test fixture) has no install parts: its files are applied schema first, the rest alphabetically.
  if (!existsSync(generator)) return []
  const gen = readFileSync(generator, 'utf8')
  const start = gen.indexOf('const PARTS = [')
  const src = gen.slice(start, gen.indexOf(']\n', start))
  return [...src.matchAll(/\['([\w-]+\.mysql\.sql)'/g)].map((m) => m[1])
}

// Every *.mysql.sql in the folder, minus the three that are not additive migrations.
export function sqlInventory(dir = SQLDIR, parts = installParts(dir)) {
  const all = readdirSync(dir).filter((f) => f.endsWith('.mysql.sql')).sort()
  const migrations = all.filter((f) => !['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql'].includes(f))
  return { all, migrations, parts }
}

// The order the tooling ends up with: schema, the install parts after it, then the rest alphabetically.
export function toolingOrder(inv) {
  const first = inv.parts.filter((f) => f !== 'schema.mysql.sql')
  const rest = inv.all.filter((f) => !['install.mysql.sql', 'schema.mysql.sql'].includes(f) && !first.includes(f))
  return ['schema.mysql.sql', ...first, ...rest]
}

// The order the README / NATIVE-BACKEND.md describe: schema, seed, brands, promo, then the rest alphabetically.
export function docsOrder(inv) {
  const head = ['schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'].filter((f) => inv.all.includes(f))
  const rest = inv.all.filter((f) => !['install.mysql.sql', ...head].includes(f))
  return [...head, ...rest]
}

// Deterministic PRNG so a shuffled order can be named by its seed and replayed.
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function shuffled(list, seed) {
  const rnd = mulberry32(seed)
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ------------------------------------------------------------------ applying

// Run one file through the mariadb client; the first error stops it (as a phpMyAdmin import would).
export function applyFile(inst, db, path, { sqlMode = null } = {}) {
  const r = spawnSync('mariadb', ['--no-defaults', '-S', inst.sock, '-uroot', '--default-character-set=utf8mb4', ...(sqlMode ? [`--init-command=set sql_mode='${sqlMode}'`] : []), db],
    { input: readFileSync(path), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status === 0) return { ok: true }
  const m = /ERROR (\d+) \((\w+)\)(?: at line (\d+))?: (.*)/.exec(r.stderr || '')
  return { ok: false, code: m ? Number(m[1]) : null, state: m ? m[2] : null, line: m && m[3] ? Number(m[3]) : null, message: (m ? m[4] : (r.stderr || '').trim()).slice(0, 300) }
}
export function applyAll(inst, db, files, dir = SQLDIR, opt = {}) {
  return files.map((f) => ({ file: f, ...applyFile(inst, db, join(dir, f), opt) }))
}

// The sql_mode ops/db/sporta-db-hardening.cnf proposes for the live server (null when the tree has none). The migrations were
// only ever run under the DEFAULT mode: a zero-date default, an out-of-range literal or a GROUP BY the stricter mode refuses
// would fail an install or a re-run the day the hardened mode is applied, and the statements of the PHP are checked separately.
export function hardenedSqlMode(dir = SQLDIR) {
  const f = join(dir, '..', '..', 'ops', 'db', 'sporta-db-hardening.cnf')
  return existsSync(f) ? /^sql_mode\s*=\s*(\S+)/m.exec(readFileSync(f, 'utf8'))?.[1] ?? null : null
}
export async function freshDb(inst, name) {
  await inst.sql(`drop database if exists \`${name}\`; create database \`${name}\` character set utf8mb4 collate utf8mb4_unicode_ci`)
  return name
}

// ------------------------------------------------------------------ snapshot

const J = (inst, db, q) => inst.sql(q, db, ['--raw']).then((t) => (t ? t.split('\n').map((l) => JSON.parse(l)) : []))

// The five SELECTs a snapshot is made of, one JSON object per row. They are READ-ONLY and read nothing but
// information_schema, so they can be run on any server with a read-only account (see ops/db/SCHEMA-AUDIT.md) and the
// output compared with `--against DIR`.
export function snapshotQueries(db) {
  const S = `'${String(db).replace(/'/g, "''")}'`
  return {
    tables: `select json_object('t', table_name, 'engine', engine, 'collation', table_collation, 'rowfmt', row_format)
      from information_schema.tables where table_schema = ${S} and table_type = 'BASE TABLE' order by table_name`,
    columns: `select json_object('t', table_name, 'c', column_name, 'pos', ordinal_position, 'type', column_type, 'null', is_nullable,
      'def', column_default, 'cs', character_set_name, 'coll', collation_name, 'extra', extra, 'gen', generation_expression, 'comment', column_comment)
      from information_schema.columns where table_schema = ${S} order by table_name, ordinal_position`,
    indexes: `select json_object('t', table_name, 'i', index_name, 'nu', non_unique, 'seq', seq_in_index, 'c', column_name,
      'sub', sub_part, 'type', index_type) from information_schema.statistics where table_schema = ${S} order by table_name, index_name, seq_in_index`,
    fks: `select json_object('t', k.table_name, 'name', k.constraint_name, 'seq', k.ordinal_position, 'c', k.column_name,
      'rt', k.referenced_table_name, 'rc', k.referenced_column_name, 'upd', r.update_rule, 'del', r.delete_rule)
      from information_schema.key_column_usage k join information_schema.referential_constraints r
        on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name and r.table_name = k.table_name
      where k.table_schema = ${S} and k.referenced_table_name is not null order by k.table_name, k.constraint_name, k.ordinal_position`,
    checks: `select json_object('t', table_name, 'name', constraint_name, 'clause', check_clause)
      from information_schema.check_constraints where constraint_schema = ${S} order by table_name, constraint_name`,
  }
}

// The four objects that can WRITE a column without any PHP statement saying so, and that a column list cannot show: a trigger
// (the old build priced orders with triggers, GO-LIVE.md), a view, a stored routine, an event. The repository builds none of them
// (make-install-sql.mjs refuses routines and triggers), so on a live export ANY of them is a finding. Same rule as the five
// queries above: SELECTs over information_schema, one JSON object per row. They are optional in a live export (a directory
// without triggers.jsonl is reported as "not compared", never as "none").
export function objectQueries(db) {
  const S = `'${String(db).replace(/'/g, "''")}'`
  return {
    triggers: `select json_object('t', event_object_table, 'name', trigger_name, 'event', event_manipulation, 'timing', action_timing,
      'stmt', action_statement) from information_schema.triggers where trigger_schema = ${S} order by trigger_name`,
    views: `select json_object('name', table_name, 'def', view_definition) from information_schema.views where table_schema = ${S} order by table_name`,
    routines: `select json_object('name', routine_name, 'type', routine_type) from information_schema.routines where routine_schema = ${S} order by routine_name`,
    events: `select json_object('name', event_name, 'status', status) from information_schema.events where event_schema = ${S} order by event_name`,
  }
}
export const OBJECT_KINDS = ['triggers', 'views', 'routines', 'events']

// WHAT THE ACCOUNT THAT RUNS THE EXPORT CAN SEE. information_schema lists a trigger only to an account holding TRIGGER on the
// schema, an event only with EVENT: with SELECT alone `triggers` answers ZERO ROWS for a database that has one (measured on
// MariaDB 10.11: a SELECT-only account sees 0 triggers and 1 view where root sees 1 and 1). So "0 on live" proves nothing unless the
// exporting account had the privilege; this query exports the privileges it has, and `privilegeGaps()` says which kinds are
// inconclusive. TRIGGER and EVENT only let it SEE those objects; they write nothing.
export function privilegeQuery(db) {
  const S = `'${String(db).replace(/'/g, "''")}'`
  const me = "concat('''', replace(substring_index(current_user(), '@', 1), '''', ''''''), '''@''', substring_index(current_user(), '@', -1), '''')"
  return `select json_object('priv', privilege_type, 'level', 'global') from information_schema.user_privileges where grantee = ${me}
    union all select json_object('priv', privilege_type, 'level', 'schema') from information_schema.schema_privileges where table_schema = ${S} and grantee = ${me}`
}
export const OBJECT_PRIVILEGE = { triggers: 'TRIGGER', events: 'EVENT' }
// the kinds whose "none" cannot be trusted: [{kind, needs}] ([] = every one can be trusted; null = privileges.jsonl was not exported)
export function privilegeGaps(privs) {
  if (!Array.isArray(privs)) return null
  const have = new Set(privs.map((x) => String(x.priv).toUpperCase()))
  return Object.entries(OBJECT_PRIVILEGE).filter(([, need]) => !have.has(need) && !have.has('ALL PRIVILEGES')).map(([kind, needs]) => ({ kind, needs }))
}

// objects from the optional .jsonl files of a live export: { triggers: [..] | null, ... } (null = not exported)
export function objectsFromDir(dir) {
  const out = {}
  for (const k of OBJECT_KINDS) {
    const f = join(dir, `${k}.jsonl`)
    out[k] = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null
  }
  const pf = join(dir, 'privileges.jsonl')
  out.privileges = existsSync(pf) ? readFileSync(pf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null
  return out
}

// What the live export has that the repository does not build (a trigger, a view, a routine, an event), by name.
export function liveObjectFindings(objs) {
  const out = []
  for (const k of OBJECT_KINDS) for (const o of objs?.[k] ?? []) out.push({ kind: k, name: o.name, table: o.t ?? null, detail: o.stmt ?? o.def ?? o.type ?? o.status ?? '' })
  return out
}

// rows -> the snapshot object (pure: used for a live export as well as for a private build)
export function buildSnapshot({ tables, columns: cols, indexes: idx, fks, checks }) {
  const snap = {}
  for (const t of tables) snap[t.t] = { engine: t.engine, collation: t.collation, columns: {}, order: [], indexes: {}, fks: {}, checks: {} }
  for (const c of cols) {
    const T = snap[c.t]
    if (!T) continue
    T.columns[c.c] = { type: c.type, null: c.null, def: c.def, cs: c.cs, coll: c.coll, extra: c.extra || '', gen: c.gen || '' }
    T.order.push(c.c)
  }
  for (const i of idx) {
    const T = snap[i.t]
    if (!T) continue
    const x = (T.indexes[i.i] ??= { unique: i.nu === 0, type: i.type, cols: [] })
    x.cols.push(i.sub ? `${i.c}(${i.sub})` : i.c)
  }
  for (const f of fks) {
    if (!snap[f.t]) continue
    const x = (snap[f.t].fks[f.name] ??= { ref: f.rt, upd: f.upd, del: f.del, cols: [], refcols: [] })
    x.cols.push(f.c); x.refcols.push(f.rc)
  }
  for (const c of checks) if (snap[c.t]) snap[c.t].checks[c.name] = c.clause
  return snap
}

// Everything the schema comparison needs, as plain sorted objects. `db` is the schema name.
export async function snapshot(inst, db) {
  const q = snapshotQueries(db)
  const rows = {}
  for (const k of Object.keys(q)) rows[k] = await J(inst, null, q[k])
  return buildSnapshot(rows)
}

// a snapshot from five .jsonl files (the output of snapshotQueries run elsewhere, one JSON object per line)
export function snapshotFromDir(dir) {
  const rows = {}
  for (const k of ['tables', 'columns', 'indexes', 'fks', 'checks']) {
    const f = join(dir, `${k}.jsonl`)
    rows[k] = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  }
  return buildSnapshot(rows)
}

// exact row counts per table (idempotence of data statements)
export async function rowCounts(inst, db) {
  const names = (await inst.sql(`select table_name from information_schema.tables where table_schema = '${db}' and table_type = 'BASE TABLE' order by 1`)).split('\n').filter(Boolean)
  if (!names.length) return {}
  const q = names.map((n) => `select '${n}', count(*) from \`${db}\`.\`${n}\``).join(' union all ')
  const out = {}
  for (const l of (await inst.sql(q)).split('\n')) { const [n, c] = l.split('\t'); out[n] = Number(c) }
  return out
}

// ------------------------------------------------------------------ comparison

// Each difference: {scope, table, name, issue, a, b}. `columns-only` ignores indexes, FKs, checks, engine and
// AUTO_INCREMENT (for a structure dump that does not carry them).
export function diffSnapshots(A, B, { columnsOnly = false, ignoreCollation = false } = {}) {
  const out = []
  const names = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()
  for (const t of names) {
    const a = A[t], b = B[t]
    if (!a) { out.push({ scope: 'table', table: t, name: t, issue: 'only_in_b' }); continue }
    if (!b) { out.push({ scope: 'table', table: t, name: t, issue: 'only_in_a' }); continue }
    if (!columnsOnly && a.engine !== b.engine) out.push({ scope: 'table', table: t, name: 'engine', issue: 'differs', a: a.engine, b: b.engine })
    if (!ignoreCollation && !columnsOnly && a.collation !== b.collation) out.push({ scope: 'table', table: t, name: 'collation', issue: 'differs', a: a.collation, b: b.collation })
    for (const c of [...new Set([...Object.keys(a.columns), ...Object.keys(b.columns)])].sort()) {
      const x = a.columns[c], y = b.columns[c]
      if (!x) { out.push({ scope: 'column', table: t, name: c, issue: 'only_in_b', b: y }); continue }
      if (!y) { out.push({ scope: 'column', table: t, name: c, issue: 'only_in_a', a: x }); continue }
      for (const k of ['type', 'null', 'def', 'cs', ...(ignoreCollation ? [] : ['coll']), 'extra', 'gen']) {
        if (columnsOnly && k === 'extra') continue
        if ((x[k] ?? null) !== (y[k] ?? null)) out.push({ scope: 'column', table: t, name: c, issue: `differs:${k}`, a: x[k], b: y[k] })
      }
    }
    if (columnsOnly) continue
    for (const i of [...new Set([...Object.keys(a.indexes), ...Object.keys(b.indexes)])].sort()) {
      const x = a.indexes[i], y = b.indexes[i]
      if (!x) { out.push({ scope: 'index', table: t, name: i, issue: 'only_in_b', b: y }); continue }
      if (!y) { out.push({ scope: 'index', table: t, name: i, issue: 'only_in_a', a: x }); continue }
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ scope: 'index', table: t, name: i, issue: 'differs', a: x, b: y })
    }
    for (const f of [...new Set([...Object.keys(a.fks), ...Object.keys(b.fks)])].sort()) {
      const x = a.fks[f], y = b.fks[f]
      if (!x) { out.push({ scope: 'fk', table: t, name: f, issue: 'only_in_b', b: y }); continue }
      if (!y) { out.push({ scope: 'fk', table: t, name: f, issue: 'only_in_a', a: x }); continue }
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ scope: 'fk', table: t, name: f, issue: 'differs', a: x, b: y })
    }
    for (const f of [...new Set([...Object.keys(a.checks), ...Object.keys(b.checks)])].sort()) {
      const x = a.checks[f], y = b.checks[f]
      if (x === undefined) { out.push({ scope: 'check', table: t, name: f, issue: 'only_in_b', b: y }); continue }
      if (y === undefined) { out.push({ scope: 'check', table: t, name: f, issue: 'only_in_a', a: x }); continue }
      if (x !== y) out.push({ scope: 'check', table: t, name: f, issue: 'differs', a: x, b: y })
    }
  }
  return out
}

// The differences between a LIVE export (a) and what the repository builds (b) that can break the repository's own code on the
// live database, as against the ones that are only untidy:
//   missing   a column or table the repository defines and live lacks  (2026-11-02: inventory_version, every order 500'd)
//   notnull   a live-only NOT NULL column without a default            (an INSERT that omits it fails with 1364)
//   narrower  a live column narrower than the repository's             (a value the code accepts fails with 1406, as order_items.name_en)
export const INT_RANK = { tinyint: 1, smallint: 2, mediumint: 3, int: 4, integer: 4, bigint: 5 }
export function typeNarrower(live, repo) {
  const a = /^(varchar|char)\((\d+)\)/i.exec(live ?? ''), b = /^(varchar|char)\((\d+)\)/i.exec(repo ?? '')
  if (a && b) return Number(a[2]) < Number(b[2])
  const x = /^(tinyint|smallint|mediumint|int|integer|bigint)\b(?:\(\d+\))?(\s+unsigned)?/i.exec(live ?? ''), y = /^(tinyint|smallint|mediumint|int|integer|bigint)\b(?:\(\d+\))?(\s+unsigned)?/i.exec(repo ?? '')
  if (x && y) {
    const rx = INT_RANK[x[1].toLowerCase()], ry = INT_RANK[y[1].toLowerCase()]
    if (rx !== ry) return rx < ry
    return !!x[2] !== !!y[2]   // same size, other signedness: each loses part of the other's range (signed lacks the top half, unsigned the negatives)
  }
  const dx = /^decimal\((\d+),(\d+)\)/i.exec(live ?? ''), dy = /^decimal\((\d+),(\d+)\)/i.exec(repo ?? '')
  if (dx && dy) return Number(dx[1]) - Number(dx[2]) < Number(dy[1]) - Number(dy[2]) || Number(dx[2]) < Number(dy[2])
  return false
}
export function liveRisks(diffs) {
  const missing = diffs.filter((x) => x.issue === 'only_in_b' && (x.scope === 'table' || x.scope === 'column'))
  const notnull = diffs.filter((x) => x.scope === 'column' && x.issue === 'only_in_a' && x.a?.null === 'NO' && (x.a.def === null || x.a.def === undefined)
    && !/auto_increment/i.test(x.a.extra ?? '') && !(x.a.gen))
  const narrower = diffs.filter((x) => x.scope === 'column' && x.issue === 'differs:type' && typeNarrower(x.a, x.b))
  return { missing, notnull, narrower }
}

// Column order differences between two snapshots, for the tables both have (informational).
export function orderDiffs(A, B) {
  const out = []
  for (const t of Object.keys(A)) {
    if (!B[t]) continue
    const shared = A[t].order.filter((c) => B[t].order.includes(c))
    const other = B[t].order.filter((c) => A[t].order.includes(c))
    if (shared.join() !== other.join()) out.push({ table: t, a: shared, b: other })
  }
  return out
}

export const countBy = (diffs, f) => diffs.reduce((m, d) => { const k = f(d); m[k] = (m[k] ?? 0) + 1; return m }, {})

// ------------------------------------------------------------------ the whole run

// A migration standalone: schema.mysql.sql, then only this file. Tells which files depend on another.
async function standalone(inst, inv, log, dir = SQLDIR) {
  const out = {}
  for (const f of inv.migrations) {
    const db = await freshDb(inst, 'sa')
    const base = applyFile(inst, db, join(dir, 'schema.mysql.sql'))
    if (!base.ok) { out[f] = { ok: false, error: `schema.mysql.sql failed first: ${base.message}` }; continue }
    const r = applyFile(inst, db, join(dir, f))
    out[f] = r.ok ? { ok: true } : { ok: false, code: r.code, error: r.message }
    log?.(`standalone ${f}: ${r.ok ? 'ok' : r.message}`)
  }
  await inst.sql('drop database if exists sa')
  return out
}

export async function runSchemaDiff({ inst: given, outDir = null, shuffles = 6, seed = 11, quick = false, liveDump = LIVE_DUMP, dir = SQLDIR, log = () => {}, root = null } = {}) {
  const inv = sqlInventory(dir)
  const own = !given
  const inst = given ?? await startPrivateMariadb({ label: 'sd', portFrom: 34100, root })
  const res = { server: inst.version, files: { all: inv.all.length, migrations: inv.migrations.length, parts: inv.parts }, variants: {}, apply: {}, diffs: {}, order: {} }
  try {
    // (i) install.mysql.sql alone
    const hasInstall = inv.all.includes('install.mysql.sql')
    await freshDb(inst, 'v_install')
    res.apply.install = hasInstall ? applyAll(inst, 'v_install', ['install.mysql.sql'], dir) : []
    // (ii) tooling order, and the docs order
    await freshDb(inst, 'v_tooling')
    res.apply.tooling = applyAll(inst, 'v_tooling', toolingOrder(inv), dir)
    await freshDb(inst, 'v_docs')
    res.apply.docs = applyAll(inst, 'v_docs', docsOrder(inv), dir)
    const snaps = {}
    for (const v of ['install', 'tooling', 'docs']) snaps[v] = await snapshot(inst, `v_${v}`)
    if (!hasInstall) snaps.install = snaps.tooling   // a tree without install.mysql.sql has nothing to compare
    res.counts = {}
    for (const v of Object.keys(snaps)) {
      res.counts[v] = { tables: Object.keys(snaps[v]).length, columns: Object.values(snaps[v]).reduce((n, t) => n + t.order.length, 0),
        indexes: Object.values(snaps[v]).reduce((n, t) => n + Object.keys(t.indexes).length, 0),
        fks: Object.values(snaps[v]).reduce((n, t) => n + Object.keys(t.fks).length, 0),
        checks: Object.values(snaps[v]).reduce((n, t) => n + Object.keys(t.checks).length, 0) }
    }
    res.diffs.install_vs_tooling = diffSnapshots(snaps.install, snaps.tooling)
    res.diffs.docs_vs_tooling = diffSnapshots(snaps.docs, snaps.tooling)
    res.order.install_vs_tooling = orderDiffs(snaps.install, snaps.tooling)
    res.order.docs_vs_tooling = orderDiffs(snaps.docs, snaps.tooling)

    // (iii-a) every file a second time, in the same order
    const before = await rowCounts(inst, 'v_tooling')
    res.apply.second_pass = applyAll(inst, 'v_tooling', toolingOrder(inv), dir)
    res.apply.second_pass_install = hasInstall ? applyAll(inst, 'v_install', ['install.mysql.sql'], dir) : []
    const after = await snapshot(inst, 'v_tooling')
    res.diffs.twice_vs_once = diffSnapshots(snaps.tooling, after)
    const afterRows = await rowCounts(inst, 'v_tooling')
    res.rows_changed_by_second_pass = Object.keys(afterRows).filter((t) => afterRows[t] !== before[t]).map((t) => ({ table: t, before: before[t], after: afterRows[t] }))
    res.diffs.install_twice_vs_once = diffSnapshots(snaps.install, await snapshot(inst, 'v_install'))
    snaps.twice = after

    // the live structure dump, columns only
    try {
      await freshDb(inst, 'v_live')
      const r = applyFile(inst, 'v_live', liveDump)
      res.apply.live_dump = [{ file: liveDump, ...r }]
      if (r.ok) {
        snaps.live = await snapshot(inst, 'v_live')
        res.diffs.live_vs_tooling = diffSnapshots(snaps.live, snaps.tooling, { columnsOnly: true, ignoreCollation: true })
        res.counts.live = { tables: Object.keys(snaps.live).length, columns: Object.values(snaps.live).reduce((n, t) => n + t.order.length, 0) }
      }
    } catch (e) { res.apply.live_dump = [{ file: liveDump, ok: false, message: String(e.message).slice(0, 200) }] }

    // the same files under the sql_mode the hardening proposes, applied twice: a failure here is a file that would break the day the mode is switched on
    const hm = hardenedSqlMode(dir)
    if (hm) {
      await freshDb(inst, 'v_hard')
      const first = applyAll(inst, 'v_hard', toolingOrder(inv), dir, { sqlMode: hm })
      const again = applyAll(inst, 'v_hard', toolingOrder(inv), dir, { sqlMode: hm })
      res.hardened = { sql_mode: hm, apply: [...first, ...again.filter((r) => !r.ok).map((r) => ({ ...r, pass: 2 }))].filter((r) => !r.ok),
        diff_vs_tooling: diffSnapshots(snaps.tooling, await snapshot(inst, 'v_hard')) }
    }

    if (!quick) {
      res.order.standalone = await standalone(inst, inv, log, dir)
      // (iii-b) shuffled orders: schema first (a table cannot be altered before it exists), the rest in random order
      res.order.shuffles = []
      const movable = toolingOrder(inv).filter((f) => f !== 'schema.mysql.sql')
      for (let n = 0; n < shuffles; n++) {
        const s = seed + n
        const order = ['schema.mysql.sql', ...shuffled(movable, s)]
        await freshDb(inst, 'v_shuf')
        const first = applyAll(inst, 'v_shuf', order, dir)
        const failed = first.filter((r) => !r.ok)
        // a second pass over only the files that failed: does "run it again" repair an unlucky order?
        const retry = applyAll(inst, 'v_shuf', failed.map((r) => r.file), dir)
        const snap = await snapshot(inst, 'v_shuf')
        const d = diffSnapshots(snaps.tooling, snap)
        res.order.shuffles.push({ seed: s, order, failed: failed.map((r) => ({ file: r.file, code: r.code, error: r.message })),
          still_failing_after_retry: retry.filter((r) => !r.ok).map((r) => ({ file: r.file, error: r.message })),
          diff_vs_tooling: d, column_order_differs: orderDiffs(snaps.tooling, snap).length })
        log?.(`shuffle seed ${s}: ${failed.length} failed first pass, ${d.length} differences after retry`)
      }
    }
    res.snapshots = snaps
  } finally {
    for (const d of ['v_install', 'v_tooling', 'v_docs', 'v_live', 'v_shuf', 'v_hard', 'sa']) { try { await inst.sql(`drop database if exists ${d}`) } catch { /* ignore */ } }
    if (own) inst.stop()
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    const { snapshots, ...rest } = res
    writeFileSync(join(outDir, 'schema-diff.json'), JSON.stringify(rest, null, 2))
    writeFileSync(join(outDir, 'schema-snapshot-tooling.json'), JSON.stringify(snapshots.tooling, null, 1))
    writeFileSync(join(outDir, 'schema-snapshot-install.json'), JSON.stringify(snapshots.install, null, 1))
    if (snapshots.live) writeFileSync(join(outDir, 'schema-snapshot-live-dump.json'), JSON.stringify(snapshots.live, null, 1))
  }
  return res
}

// ------------------------------------------------------------------ the CLI

export function summarise(res) {
  const L = []
  const failed = (k) => (res.apply[k] ?? []).filter((r) => !r.ok)
  L.push(`server ${res.server}; ${res.files.all} sql files (${res.files.migrations} additive migrations)`)
  for (const [v, c] of Object.entries(res.counts)) L.push(`  ${v.padEnd(8)} ${c.tables} tables, ${c.columns} columns${c.indexes != null ? `, ${c.indexes} indexes, ${c.fks} foreign keys, ${c.checks} checks` : ''}`)
  for (const k of ['install', 'tooling', 'docs', 'second_pass', 'second_pass_install']) {
    const f = failed(k)
    L.push(`apply ${k}: ${f.length ? `${f.length} FAILED: ${f.map((r) => `${r.file} (${r.message})`).join('; ')}` : 'all ok'}`)
  }
  for (const [k, d] of Object.entries(res.diffs)) L.push(`diff ${k}: ${d.length} difference(s) ${JSON.stringify(countBy(d, (x) => `${x.scope}:${x.issue}`))}`)
  L.push(`rows changed by a second pass: ${res.rows_changed_by_second_pass.length ? JSON.stringify(res.rows_changed_by_second_pass) : 'none'}`)
  if (res.hardened) L.push(`hardened sql_mode (${res.hardened.sql_mode}): ${res.hardened.apply.length ? `${res.hardened.apply.length} FAILED: ${res.hardened.apply.map((r) => `${r.file} (${r.message})`).join('; ')}` : 'every file applies twice'}; ${res.hardened.diff_vs_tooling.length} schema difference(s) vs the default-mode build`)
  if (res.order.standalone) {
    const bad = Object.entries(res.order.standalone).filter(([, v]) => !v.ok)
    L.push(`standalone on schema.mysql.sql only: ${bad.length ? bad.map(([f, v]) => `${f} (${v.error})`).join('; ') : 'every migration applies alone'}`)
  }
  for (const s of res.order.shuffles ?? []) L.push(`shuffle ${s.seed}: ${s.failed.length} failed first pass${s.failed.length ? ` [${s.failed.map((x) => x.file).join(', ')}]` : ''}; after retry ${s.still_failing_after_retry.length} still failing, ${s.diff_vs_tooling.length} differences vs tooling`)
  return L.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
  if (argv.includes('--print-queries')) {
    const db = arg('--print-queries', 'sporta')
    // Every statement below reads information_schema and nothing else. The first line makes the session refuse a write even if the
    // account that runs them were allowed one (run them under a read-only account anyway).
    console.log('-- run once at the start of the session, before the SELECTs\nset session transaction read only;\n')
    for (const [k, v] of Object.entries({ ...snapshotQueries(db), ...objectQueries(db), privileges: privilegeQuery(db) })) {
      const note = OBJECT_KINDS.includes(k) ? ' (optional: a live trigger, view, routine or event is a hidden writer)' : k === 'privileges' ? ' (optional: lets --against tell whether "0 triggers" means none or "not visible to this account"; run the SELECTs as an account with TRIGGER, EVENT and SELECT on the schema)' : ''
      console.log(`-- ${k}.jsonl${note}\n${v.replace(/\s+/g, ' ').trim()};\n`)
    }
    process.exit(0)
  }
  if (argv.includes('--against')) {
    const live = snapshotFromDir(resolve(arg('--against')))
    const inst = await startPrivateMariadb({ label: 'sa', portFrom: 34100 })
    try {
      const inv = sqlInventory(SQLDIR)
      await freshDb(inst, 'v_tooling')
      applyAll(inst, 'v_tooling', toolingOrder(inv), SQLDIR)
      const repo = await snapshot(inst, 'v_tooling')
      const d = diffSnapshots(live, repo, { ignoreCollation: argv.includes('--ignore-collation') })
      const mine = d.filter((x) => x.issue === 'only_in_b' || x.issue.startsWith('differs'))
      const risks = liveRisks(d)
      const objs = objectsFromDir(resolve(arg('--against')))
      const hidden = liveObjectFindings(objs)
      console.log(`live has ${Object.keys(live).length} tables, the repository builds ${Object.keys(repo).length}; ${d.length} difference(s)`)
      console.log(`RISK  ${risks.missing.length} the repository defines and live lacks, ${risks.notnull.length} live-only NOT NULL columns without a default (an INSERT from this code fails), ${risks.narrower.length} live columns narrower than the repository's`)
      const gaps = privilegeGaps(objs.privileges)
      for (const k of OBJECT_KINDS) {
        const gap = gaps?.find((g) => g.kind === k)
        const seen = objs[k] === null ? 'NOT EXPORTED, so not compared (export ' + k + '.jsonl)' : objs[k].length + ' on live (the repository builds none)'
        console.log(`OBJ   ${k}: ${seen}${objs[k] !== null && gap ? `  INCONCLUSIVE: the exporting account lacks ${gap.needs}, so ${objs[k].length} here does not prove there is none` : ''}${objs[k] !== null && gaps === null && OBJECT_PRIVILEGE[k] ? '  (privileges.jsonl not exported: cannot tell whether the account could see them)' : ''}`)
      }
      for (const o of hidden) console.log(`HIDDEN ${o.kind} ${o.name}${o.table ? ' on ' + o.table : ''}: a live ${o.kind.replace(/s$/, '')} can write columns no PHP statement shows`)
      for (const x of risks.notnull) console.log(`NOTNULL ${x.table}.${x.name}  live ${x.a.type} NOT NULL, no default: the repository's INSERTs leave it out`)
      for (const x of risks.narrower) console.log(`NARROW  ${x.table}.${x.name}  live ${x.a} < repository ${x.b}`)
      for (const x of d) console.log(`${x.scope.padEnd(6)} ${x.table}${x.scope === 'table' ? '' : '.' + x.name}  ${x.issue === 'only_in_a' ? 'only on live' : x.issue === 'only_in_b' ? 'MISSING ON LIVE (a repository migration has not run)' : x.issue}${x.a !== undefined && x.b !== undefined ? '  live=' + JSON.stringify(x.a) + ' repo=' + JSON.stringify(x.b) : ''}`.slice(0, 300))
      const out = arg('--out', null)
      if (out) { mkdirSync(resolve(out), { recursive: true }); writeFileSync(join(resolve(out), 'live-vs-repo.json'), JSON.stringify(d, null, 1)) }
      process.exit(mine.length || risks.notnull.length || risks.narrower.length || hidden.length ? 1 : 0)
    } finally { inst.stop() }
  }
  const outDir = arg('--out', null)
  const res = await runSchemaDiff({
    outDir: outDir && resolve(outDir), shuffles: Number(arg('--shuffles', 6)), seed: Number(arg('--seed', 11)),
    quick: argv.includes('--quick'), liveDump: arg('--live-dump', LIVE_DUMP), log: (m) => console.error(m),
  })
  console.log(summarise(res))
  process.exit(0)
}
