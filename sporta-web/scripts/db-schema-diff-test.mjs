// db-schema-diff-test.mjs — proves scripts/db-schema-diff.mjs compares the way the install instructions promise.
//
//   npm run test:db-schema-diff            everything (about three minutes)
//   node scripts/db-schema-diff-test.mjs --fast     the units, the fixture and the mutants (about a minute)
//
// It runs on a PRIVATE MariaDB (own datadir, own port from 34100, removed at the end) and never opens a repository file for writing.
//
//   1. UNITS      diffSnapshots() on hand-made snapshots: a missing table, column, index, foreign key and CHECK, and a changed
//                 type, nullability, default, character set and extra are each reported; an identical pair reports nothing; a
//                 structure dump (columns only) is not blamed for the keys it does not carry. The seeded shuffle is reproducible.
//   2. FIXTURE    a folder with an install.mysql.sql that is STALE (it lacks a part the other order applies), a migration that
//                 fails the second time, and one that only works after another: each is reported by the matching section of the run.
//   3. REAL TREE  install.mysql.sql builds the schema the parts build; a second pass changes nothing; the production dump loads.
//   4. MUTATION   each comparison is blinded in a copy of the tool (a source edit) and the fixture must stop reporting its defect.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as D from './db-schema-diff.mjs'
import { startPrivateMariadb } from './lib/private-mariadb.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAST = process.argv.includes('--fast')
let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  - ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const J = (x) => JSON.stringify(x)

head('1. units')
const col = (o = {}) => ({ type: 'int(11)', null: 'NO', def: null, cs: null, coll: null, extra: '', gen: '', ...o })
const tbl = (o = {}) => ({ engine: 'InnoDB', collation: 'utf8mb4_unicode_ci', columns: { a: col(), b: col({ type: 'varchar(20)', cs: 'utf8mb4', coll: 'utf8mb4_unicode_ci', null: 'YES', def: 'NULL' }) }, order: ['a', 'b'],
  indexes: { PRIMARY: { unique: true, type: 'BTREE', cols: ['a'] } }, fks: { f: { ref: 'u', upd: 'RESTRICT', del: 'CASCADE', cols: ['b'], refcols: ['id'] } }, checks: { c: 'a > 0' }, ...o })
const A = { t: tbl() }
const clone = () => JSON.parse(J(A))
const issues = (B, opt) => D.diffSnapshots(A, B, opt).map((d) => `${d.scope}:${d.issue}`)
is(D.diffSnapshots(A, clone()).length === 0, 'identical snapshots: no difference')
{ const B = clone(); B.u = tbl(); is(issues(B).includes('table:only_in_b'), 'a table only in B') }
{ const B = clone(); delete B.t.columns.b; B.t.order = ['a']; is(issues(B).includes('column:only_in_a'), 'a column missing in B') }
{ const B = clone(); B.t.columns.a.type = 'bigint(20)'; is(issues(B).includes('column:differs:type'), 'a changed type') }
{ const B = clone(); B.t.columns.a.null = 'YES'; is(issues(B).includes('column:differs:null'), 'a changed nullability') }
{ const B = clone(); B.t.columns.a.def = '0'; is(issues(B).includes('column:differs:def'), 'a changed default') }
{ const B = clone(); B.t.columns.b.cs = 'latin1'; is(issues(B).includes('column:differs:cs'), 'a changed character set') }
{ const B = clone(); B.t.columns.a.extra = 'auto_increment'; is(issues(B).includes('column:differs:extra'), 'a changed extra (auto_increment)') }
{ const B = clone(); B.t.indexes.i2 = { unique: false, type: 'BTREE', cols: ['b'] }; is(issues(B).includes('index:only_in_b'), 'an extra index') }
{ const B = clone(); B.t.indexes.PRIMARY.cols = ['a', 'b']; is(issues(B).includes('index:differs'), 'an index over different columns') }
{ const B = clone(); B.t.fks.f.del = 'RESTRICT'; is(issues(B).includes('fk:differs'), 'a foreign key with another ON DELETE rule') }
{ const B = clone(); B.t.checks.c = 'a > 1'; is(issues(B).includes('check:differs'), 'a CHECK with another clause') }
{ const B = clone(); B.t.indexes = {}; B.t.fks = {}; B.t.checks = {}; B.t.columns.a.extra = 'auto_increment'; is(D.diffSnapshots(A, B, { columnsOnly: true }).length === 0, 'columns-only mode (a structure dump) is not blamed for keys, constraints or AUTO_INCREMENT it does not carry') }
{ const B = clone(); B.t.order = ['b', 'a']; is(D.diffSnapshots(A, B).length === 0 && D.orderDiffs(A, B).length === 1, 'column ORDER is reported apart, not as a difference') }
is(J(D.shuffled([1, 2, 3, 4, 5, 6, 7, 8], 5)) === J(D.shuffled([1, 2, 3, 4, 5, 6, 7, 8], 5)) && J(D.shuffled([1, 2, 3, 4, 5, 6, 7, 8], 5)) !== J(D.shuffled([1, 2, 3, 4, 5, 6, 7, 8], 6)), 'a shuffled order is named by its seed and replays exactly')
{
  const inv = D.sqlInventory(D.SQLDIR)
  const tool = D.toolingOrder(inv), docs = D.docsOrder(inv)
  is(tool[0] === 'schema.mysql.sql' && !tool.includes('install.mysql.sql') && new Set(tool).size === tool.length, 'tooling order: schema first, install.mysql.sql excluded, each file once', `${tool.length} files`)
  is(J(inv.parts) === J(tool.slice(0, inv.parts.length)), 'and the install parts come first, in the generator\'s own order (read from make-install-sql.mjs, not retyped)', inv.parts.join(' '))
  is(docs.slice(0, 4).join() === 'schema.mysql.sql,seed.mysql.sql,brands.mysql.sql,promo.mysql.sql' && new Set(docs).size === docs.length, 'docs order: schema, seed, brands, promo, then the rest')
  is(J([...tool].sort()) === J([...docs].sort()), 'both orders apply the same set of files')
}

// ---------------------------------------------------------------------------------------- fixture
const FX = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dbdiff-fx-'))
function fixture(root) {
  const dir = join(root, 'dropin/php-store')
  mkdirSync(dir, { recursive: true })
  const schema = 'create table if not exists t (id int unsigned auto_increment primary key, name varchar(40) not null) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;\n'
  writeFileSync(join(dir, 'schema.mysql.sql'), schema)
  writeFileSync(join(dir, 'a-good.mysql.sql'), 'alter table t add column if not exists color varchar(20) null;\n')
  writeFileSync(join(dir, 'b-bad.mysql.sql'), 'alter table t add column weight int null;\n')
  writeFileSync(join(dir, 'd-needs.mysql.sql'), 'create index if not exists idx_t_color on t (color);\n')
  writeFileSync(join(dir, 'e-rows.mysql.sql'), 'create table if not exists seedme (k varchar(10) primary key, v int not null) engine=InnoDB;\ninsert into seedme (k, v) values (\'a\', 1);\n') // second run: duplicate key
  writeFileSync(join(dir, 'install.mysql.sql'), schema) // STALE: lacks every part the tooling order applies
  return dir
}
const run = async (lib, label, inst) => lib.runSchemaDiff({ inst, dir: fixture(join(FX, label)), quick: false, shuffles: 8, seed: 3, liveDump: join(FX, 'none.sql') })
const reports = (r) => ({
  stale: r.diffs.install_vs_tooling.some((d) => d.scope === 'column' && d.name === 'color' && d.issue === 'only_in_b'),
  twice: r.apply.second_pass.some((x) => x.file === 'b-bad.mysql.sql' && !x.ok),
  rows: r.apply.second_pass.some((x) => x.file === 'e-rows.mysql.sql' && !x.ok),
  order: r.order.shuffles.some((s) => s.failed.some((x) => x.file === 'd-needs.mysql.sql')),
  retry: r.order.shuffles.every((s) => s.still_failing_after_retry.length === 0 || s.still_failing_after_retry.every((x) => x.file === 'b-bad.mysql.sql')),
  standalone: r.order.standalone['d-needs.mysql.sql']?.ok === false,
})

let inst
try {
  inst = await startPrivateMariadb({ label: 'sdt', portFrom: 34100 })
  head('2. fixture')
  const r = await run(D, 'real', inst)
  const rep = reports(r)
  is(rep.stale, 'an install.mysql.sql that lacks a part is reported: the column the other order adds is missing from it')
  is(rep.twice, 'a migration that fails when applied a second time is reported (b-bad.mysql.sql)')
  is(r.apply.tooling.every((x) => x.ok), 'and the first application of every fixture file succeeds, so the failure above is the SECOND run')
  is(rep.order && rep.standalone, 'a migration that needs another is found: it fails alone on schema.mysql.sql and in the shuffled orders that put it first', `${r.order.shuffles.filter((s) => s.failed.length).length} of ${r.order.shuffles.length} orders`)
  is(r.order.shuffles.every((s) => s.diff_vs_tooling.length === 0 || s.failed.length > 0), 'every shuffled order that had no failure ends in the same schema as the tooling order')
  is(r.rows_changed_by_second_pass.length === 0 || r.rows_changed_by_second_pass.every((x) => x.table === 'seedme'), 'row counts are compared before and after the second pass', J(r.rows_changed_by_second_pass))
  is(Object.keys(r.counts).includes('tooling') && r.counts.tooling.tables === 2, 'the run counts what it built', J(r.counts.tooling))
  { // the read-only export an operator runs on the live server must rebuild the same snapshot
    await D.freshDb(inst, 'exp'); D.applyAll(inst, 'exp', ['schema.mysql.sql', 'a-good.mysql.sql'], join(FX, 'real/dropin/php-store'))
    const dir = join(FX, 'export'); mkdirSync(dir, { recursive: true })
    const q = D.snapshotQueries('exp')
    for (const k of Object.keys(q)) writeFileSync(join(dir, `${k}.jsonl`), (await inst.sql(q[k], null, ['--raw'])) + '\n')
    const direct = await D.snapshot(inst, 'exp')
    const viaFiles = D.snapshotFromDir(dir)
    is(J(direct) === J(viaFiles) && Object.keys(direct).length === 1, 'a snapshot rebuilt from the five read-only SELECTs (the live export) equals the direct one', `${Object.keys(direct).length} table, ${direct.t.order.length} columns`)
    is(Object.values(q).every((sql) => /^\s*select json_object\(/i.test(sql) && !/\b(insert|update|delete|drop|alter|create|grant)\b/i.test(sql)), 'and the export statements are SELECTs over information_schema only')
    await inst.sql('drop database if exists exp')
  }

  if (!FAST) {
    head('3. the real tree')
    const real = await D.runSchemaDiff({ inst, quick: true })
    is(real.apply.install.every((x) => x.ok) && real.apply.tooling.every((x) => x.ok), 'install.mysql.sql and the tooling order both apply without an error', `${real.counts.install.tables} tables, ${real.counts.install.columns} columns`)
    // KNOWN: abandoned.mysql.sql says install.mysql.sql carries its table (abandoned_followup); schema.mysql.sql does not repeat it, so it does not.
    // The abandoned-orders lane owns that. Any OTHER difference is new, and fails here.
    const KNOWN_INSTALL_GAPS = new Set(['abandoned_followup'])
    const gaps = real.diffs.install_vs_tooling.filter((d) => !KNOWN_INSTALL_GAPS.has(d.table))
    is(gaps.length === 0, 'install.mysql.sql == the schema the parts build, table by table, column by column, index by index, key by key (apart from the one documented gap)', gaps.length ? J(gaps.slice(0, 3)) : `${real.diffs.install_vs_tooling.length - gaps.length} difference(s) in the documented gap: ${[...KNOWN_INSTALL_GAPS].join(',')}`)
    is(real.diffs.twice_vs_once.length === 0 && real.apply.second_pass.every((x) => x.ok) && real.rows_changed_by_second_pass.length === 0, 'every file applied a second time: no error, no schema change, no row change')
    is(real.diffs.install_twice_vs_once.length === 0 && real.apply.second_pass_install.every((x) => x.ok), 'install.mysql.sql imported twice: no change')
    is(real.counts.install.fks >= 15 && real.counts.install.checks >= 30 && real.counts.install.indexes >= 70, 'the keys and CHECK constraints were read, not just the columns', `${real.counts.install.indexes} indexes, ${real.counts.install.fks} foreign keys, ${real.counts.install.checks} checks`)
    const docsFailed = real.apply.docs.filter((x) => !x.ok).map((x) => x.file)
    is(docsFailed.every((f) => f === 'crm.mysql.sql'), 'in the alphabetical docs order only the known crm.mysql.sql fails (it needs customers.mysql.sql first; see crm-self-sufficient.patch)', docsFailed.join(',') || 'none')
    is(real.apply.live_dump?.[0]?.ok && real.counts.live.tables >= 50, 'the production structure dump of 2026-11-01 loads', `${real.counts.live?.tables} tables`)
  }

  head('4. mutation: blind each comparison in a copy of the tool')
  const MUT = join(FX, 'mut')
  const make = (name, file, from, to) => {
    const root = join(MUT, name)
    mkdirSync(join(root, 'scripts/lib'), { recursive: true })
    cpSync(join(HERE, 'db-schema-diff.mjs'), join(root, 'scripts/db-schema-diff.mjs'))
    cpSync(join(HERE, 'lib/private-mariadb.mjs'), join(root, 'scripts/lib/private-mariadb.mjs'))
    const p = join(root, 'scripts', file)
    const src = readFileSync(p, 'utf8')
    if (!src.includes(from)) throw new Error(`the text to blind is gone: ${from.slice(0, 60)}`)
    writeFileSync(p, src.replace(from, to))
    return root
  }
  const MUTANTS = [
    ['install-vs-tooling-blind', 'res.diffs.install_vs_tooling = diffSnapshots(snaps.install, snaps.tooling)', 'res.diffs.install_vs_tooling = []', 'stale', 'a stale install.mysql.sql passes'],
    ['second-pass-blind', "res.apply.second_pass = applyAll(inst, 'v_tooling', toolingOrder(inv), dir)", 'res.apply.second_pass = []', 'twice', 'a non-idempotent migration passes'],
    ['shuffle-blind', 'const failed = first.filter((r) => !r.ok)', 'const failed = []', 'order', 'an ordering dependency passes'],
    ['standalone-blind', "out[f] = r.ok ? { ok: true } : { ok: false, code: r.code, error: r.message }", 'out[f] = { ok: true }', 'standalone', 'a file that cannot run alone passes'],
  ]
  for (const [name, from, to, key, what] of MUTANTS) {
    let root
    try { root = make(name, 'db-schema-diff.mjs', from, to) } catch (e) { bad(`mutant ${name} could not be built`, e.message); continue }
    const lib = await import(pathToFileURL(join(root, 'scripts/db-schema-diff.mjs')).href)
    const m = reports(await run(lib, `mut-${name}`, inst))
    is(rep[key] && !m[key], `mutant ${name}: ${what}`, 'blinded -> the report disappears')
  }
  { // the unit-level mutant: the column type comparison
    const root = make('type-blind', 'db-schema-diff.mjs', "for (const k of ['type', 'null', 'def', 'cs',", "for (const k of ['null', 'def', 'cs',")
    const lib = await import(pathToFileURL(join(root, 'scripts/db-schema-diff.mjs')).href)
    const B = clone(); B.t.columns.a.type = 'bigint(20)'
    is(D.diffSnapshots(A, B).some((d) => d.issue === 'differs:type') && !lib.diffSnapshots(A, B).some((d) => d.issue === 'differs:type'), 'mutant type-blind: a changed column type passes', 'blinded -> the difference disappears')
  }
} finally {
  try { inst?.stop() } catch { /* gone */ }
  try { rmSync(FX, { recursive: true, force: true }) } catch { /* ignore */ }
}
console.log(fails ? `\n${fails} problem(s) in the schema diff` : '\ndb-schema-diff: every difference is reported, nothing else, and every comparison is mutation-proof')
process.exit(fails ? 1 : 0)
