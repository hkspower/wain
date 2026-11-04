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
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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

// ---- what can break THIS code on a live database (live = A, repository = B): see liveRisks() in the tool
{
  const T = D.typeNarrower
  is(T('varchar(64)', 'varchar(80)') && !T('varchar(80)', 'varchar(64)') && !T('varchar(80)', 'varchar(80)'), 'a live varchar narrower than the repository\'s is narrower; wider or equal is not')
  is(T('smallint(6)', 'int(11)') && !T('bigint(20)', 'int(11)') && T('int(11)', 'int(10) unsigned') && T('int(10) unsigned', 'int(11)') && !T('int(11)', 'int(11)'), 'integers: a smaller size, or the other signedness, loses range; a wider one does not')
  is(T('decimal(10,2)', 'decimal(10,3)') && T('decimal(8,3)', 'decimal(10,3)') && !T('decimal(10,3)', 'decimal(10,3)') && !T('decimal(12,3)', 'decimal(10,3)'), 'decimal(p,s): fewer decimals or fewer integer digits is narrower')
  is(!T('text', 'varchar(10)') && !T(null, 'int(11)') && !T('datetime', 'timestamp'), 'a pair of types it cannot rank is not called narrower')
  const live = { t: tbl({ columns: { a: col(), b: col({ type: 'varchar(20)', null: 'YES', def: 'NULL' }), c: col({ null: 'NO', def: null }), d: col({ null: 'YES', def: 'NULL' }), id: col({ extra: 'auto_increment' }), name: col({ type: 'varchar(64)', null: 'YES', def: 'NULL' }), stamp: col({ type: 'timestamp', null: 'NO', def: 'current_timestamp()' }) } }), only_live: tbl() }
  const repo = { t: tbl({ columns: { a: col(), b: col({ type: 'varchar(20)', null: 'YES', def: 'NULL' }), name: col({ type: 'varchar(80)', null: 'YES', def: 'NULL' }), added: col({ type: 'int(11)', null: 'YES', def: 'NULL' }) } }), new_table: tbl() }
  const risks = D.liveRisks(D.diffSnapshots(live, repo, { columnsOnly: true }))
  is(J(risks.notnull.map((x) => x.name)) === '["c"]', 'a live-only NOT NULL column without a default is a risk (the repository\'s INSERTs leave it out); nullable, defaulted and AUTO_INCREMENT live-only columns are not', J(risks.notnull.map((x) => x.name)))
  is(J(risks.narrower.map((x) => x.name)) === '["name"]', 'a live column narrower than the repository\'s is a risk (order_items.name_en: a value the code accepts fails)', J(risks.narrower.map((x) => x.name)))
  is(risks.missing.length === 2 && risks.missing.some((x) => x.scope === 'table' && x.table === 'new_table') && risks.missing.some((x) => x.scope === 'column' && x.name === 'added'), 'a table or column the repository defines and live lacks is a risk (inventory.mysql.sql, 2026-11-02)')
  is(D.privilegeGaps(null) === null && J(D.privilegeGaps([{ priv: 'SELECT' }]).map((g) => g.kind)) === '["triggers","events"]' && D.privilegeGaps([{ priv: 'TRIGGER' }, { priv: 'EVENT' }]).length === 0 && D.privilegeGaps([{ priv: 'ALL PRIVILEGES' }]).length === 0, 'privilegeGaps(): SELECT alone cannot see triggers or events; TRIGGER + EVENT (or ALL) can; no export at all is "unknown" (null)')
  // hidden writers: a trigger, view, routine or event on live that the repository never builds
  const oq = D.objectQueries('exp')
  is(J(Object.keys(oq)) === J(D.OBJECT_KINDS) && Object.values(oq).every((sql) => /^\s*select json_object\(/i.test(sql) && /information_schema\./i.test(sql) && !/\b(insert|update|delete|drop|alter|create|grant|call)\b/i.test(sql)), 'the four object queries are SELECTs over information_schema only')
  const od = join(tmpdir(), `dbdiff-obj-${process.pid}`); mkdirSync(od, { recursive: true }); writeFileSync(join(od, 'triggers.jsonl'), J({ t: 'orders', name: 'trg_price', event: 'INSERT', timing: 'BEFORE', stmt: 'set new.amount = 0' }) + '\n')
  const objs = D.objectsFromDir(od); rmSync(od, { recursive: true, force: true })
  is(objs.triggers.length === 1 && objs.views === null && objs.routines === null && objs.events === null, 'an export without views.jsonl says "not exported" (null), never "none"')
  const hf = D.liveObjectFindings({ ...objs, routines: [{ name: 'p', type: 'PROCEDURE' }] })
  is(hf.length === 2 && hf.some((x) => x.kind === 'triggers' && x.name === 'trg_price' && x.table === 'orders') && hf.some((x) => x.kind === 'routines'), 'a live trigger and a live routine are reported by name and table')
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
  writeFileSync(join(dir, 'f-zero.mysql.sql'), "alter table t add column if not exists zd date not null default '0000-00-00';\n")   // fine under the default mode, refused by NO_ZERO_DATE
  mkdirSync(join(root, 'ops/db'), { recursive: true })
  writeFileSync(join(root, 'ops/db/sporta-db-hardening.cnf'), '[mysqld]\nsql_mode=STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY\n')
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
  hardened: !!r.hardened?.apply.some((x) => x.file === 'f-zero.mysql.sql' && !x.ok && /1067|Invalid default/i.test(x.message)),
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
  is(rep.hardened && r.apply.tooling.find((x) => x.file === 'f-zero.mysql.sql')?.ok === true, 'a migration the default mode accepts but the proposed hardened sql_mode refuses (a zero-date default) is reported, and it IS accepted by the default mode', r.hardened?.apply.map((x) => `${x.file}: ${x.message}`).join('; ').slice(0, 160))
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
  { // the object queries run on a real MariaDB and find a trigger and a view on a scratch database
    await inst.sql('drop database if exists objx; create database objx')
    await inst.sql('create table objx.t (id int primary key, v int); create view objx.vw as select id from objx.t')
    await inst.sql('create trigger objx.trg_x before insert on objx.t for each row set new.v = 1')
    const oq = D.objectQueries('objx'), dir = join(FX, 'export-objects'); mkdirSync(dir, { recursive: true })
    for (const k of Object.keys(oq)) writeFileSync(join(dir, `${k}.jsonl`), (await inst.sql(oq[k], null, ['--raw'])) + '\n')
    const f = D.liveObjectFindings(D.objectsFromDir(dir))
    is(f.length === 2 && f.some((x) => x.kind === 'triggers' && x.name === 'trg_x' && x.table === 't') && f.some((x) => x.kind === 'views' && x.name === 'vw'), 'a trigger and a view on the database are found by the optional SELECTs', J(f.map((x) => `${x.kind}:${x.name}`)))
    await inst.sql('drop database if exists objx')
  }
  { // a SELECT-only account sees ZERO triggers where a trigger exists: the privilege export is what says "not visible", not "none"
    const pw = `p${randomBytes(8).toString('hex')}`
    await inst.sql('drop database if exists privx; create database privx; create table privx.t (id int primary key, v int)')
    await inst.sql('create trigger privx.trg_p before insert on privx.t for each row set new.v = 1')
    await inst.sql(`create user 'sdt_ro'@'localhost' identified by '${pw}'; grant select on privx.* to 'sdt_ro'@'localhost'`)
    const asRo = (sql) => spawnSync('mariadb', ['--no-defaults', '-S', inst.sock, '-usdt_ro', `-p${pw}`, '-N', '-B', '--raw', '-e', sql], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
    const asRoot = async (sql) => (await inst.sql(sql, null, ['--raw'])).split('\n').filter(Boolean)
    const q = D.objectQueries('privx')
    const [seenRo, seenRoot] = [asRo(q.triggers).length, (await asRoot(q.triggers)).length]
    is(seenRo === 0 && seenRoot === 1, 'a SELECT-only account sees 0 triggers where root sees 1 (so "0 on live" alone proves nothing)', `${seenRo} / ${seenRoot}`)
    const gRo = D.privilegeGaps(asRo(D.privilegeQuery('privx')).map((l) => JSON.parse(l))), gRoot = D.privilegeGaps((await asRoot(D.privilegeQuery('privx'))).map((l) => JSON.parse(l)))
    is(gRo.some((g) => g.kind === 'triggers') && gRoot.length === 0, 'the privilege export marks the SELECT-only account as unable to see triggers, and root as able', J(gRo))
    await inst.sql("drop user 'sdt_ro'@'localhost'; drop database if exists privx")
  }
  { // the printed queries: a read-only session first, then SELECTs over information_schema only
    const out = spawnSync(process.execPath, [join(HERE, 'db-schema-diff.mjs'), '--print-queries', 'sporta'], { encoding: 'utf8' }).stdout
    const stmts = out.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    is(stmts[0] === 'set session transaction read only;' && stmts.slice(1).every((l) => /^select json_object\(/i.test(l) && /information_schema\./i.test(l)) && stmts.length === 11, 'the printed queries begin with SET SESSION TRANSACTION READ ONLY and the other ten are SELECTs over information_schema', `${stmts.length} statements`)
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
    { // the baseline --against relies on: the repository's own schema builds NO trigger, view, routine or event
      await D.freshDb(inst, 'chk'); D.applyAll(inst, 'chk', D.toolingOrder(D.sqlInventory(D.SQLDIR)), D.SQLDIR)
      const oq = D.objectQueries('chk'), got = {}
      for (const k of Object.keys(oq)) got[k] = (await inst.sql(oq[k], null, ['--raw'])).split('\n').filter(Boolean).length
      is(Object.values(got).every((n) => n === 0), 'the repository builds no trigger, view, routine or event (so any on a live export is a finding)', J(got))
      await inst.sql('drop database if exists chk')
    }
    { // END TO END: export a database made dangerous on purpose with the printed queries and compare it with `--against`
      const names = D.toolingOrder(D.sqlInventory(D.SQLDIR))
      await D.freshDb(inst, 'liveish'); D.applyAll(inst, 'liveish', names, D.SQLDIR)
      await inst.sql('alter table orders modify customer_name varchar(40) not null; alter table orders add column zz int not null; alter table orders drop column utm_source', 'liveish')
      await inst.sql('create trigger trg_price before insert on orders for each row set new.amount = new.amount', 'liveish')
      const dir = join(FX, 'liveish'); mkdirSync(dir, { recursive: true })
      const q = { ...D.snapshotQueries('liveish'), ...D.objectQueries('liveish'), privileges: D.privilegeQuery('liveish') }
      for (const k of Object.keys(q)) writeFileSync(join(dir, `${k}.jsonl`), (await inst.sql(q[k], null, ['--raw'])) + '\n')
      const r = spawnSync(process.execPath, [join(HERE, 'db-schema-diff.mjs'), '--against', dir], { encoding: 'utf8' })
      is(r.status === 1 && /orders\.utm_source\s+MISSING ON LIVE/.test(r.stdout) && /NOTNULL orders\.zz/.test(r.stdout) && /NARROW\s+orders\.customer_name\s+live varchar\(40\) < repository varchar\(80\)/.test(r.stdout) && /HIDDEN triggers trg_price on orders/.test(r.stdout),
        '--against names a missing column, a live-only NOT NULL column, a narrower column and a live trigger, and exits 1', (r.stdout.split('\n').filter((l) => /^(RISK|HIDDEN|NOTNULL|NARROW)/.test(l)).join(' | ') || r.stderr).slice(0, 300))
      is(!/INCONCLUSIVE/.test(r.stdout), 'an export made by an account that can see triggers and events is not called inconclusive')
      writeFileSync(join(dir, 'privileges.jsonl'), J({ priv: 'SELECT', level: 'schema' }) + '\n')
      const r3 = spawnSync(process.execPath, [join(HERE, 'db-schema-diff.mjs'), '--against', dir], { encoding: 'utf8' })
      is(/OBJ\s+triggers: 1 on live.*INCONCLUSIVE: the exporting account lacks TRIGGER/.test(r3.stdout) && /OBJ\s+events: 0 on live.*INCONCLUSIVE: the exporting account lacks EVENT/.test(r3.stdout), 'an export made by a SELECT-only account says its trigger / event counts are INCONCLUSIVE', (r3.stdout.split('\n').filter((l) => /^OBJ/.test(l)).join(' | ')).slice(0, 260))
      rmSync(join(dir, 'triggers.jsonl')); rmSync(join(dir, 'views.jsonl'))
      const r2 = spawnSync(process.execPath, [join(HERE, 'db-schema-diff.mjs'), '--against', dir], { encoding: 'utf8' })
      is(/OBJ\s+triggers: NOT EXPORTED/.test(r2.stdout) && /OBJ\s+views: NOT EXPORTED/.test(r2.stdout), 'an export without triggers.jsonl / views.jsonl says "NOT EXPORTED, so not compared" instead of reporting none')
      await inst.sql('drop database if exists liveish')
    }
    is(!!real.hardened && real.hardened.apply.length === 0 && real.hardened.diff_vs_tooling.length === 0, 'every repository file applies twice under the sql_mode ops/db/sporta-db-hardening.cnf proposes, and builds the same schema', real.hardened ? `${real.hardened.sql_mode}: ${real.hardened.apply.length} failures` : 'no hardening file found')
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
    ['hardened-blind', 'const hm = hardenedSqlMode(dir)', 'const hm = null', 'hardened', 'a migration only the hardened sql_mode refuses passes'],
    ['standalone-blind', "out[f] = r.ok ? { ok: true } : { ok: false, code: r.code, error: r.message }", 'out[f] = { ok: true }', 'standalone', 'a file that cannot run alone passes'],
  ]
  for (const [name, from, to, key, what] of MUTANTS) {
    let root
    try { root = make(name, 'db-schema-diff.mjs', from, to) } catch (e) { bad(`mutant ${name} could not be built`, e.message); continue }
    const lib = await import(pathToFileURL(join(root, 'scripts/db-schema-diff.mjs')).href)
    const m = reports(await run(lib, `mut-${name}`, inst))
    is(rep[key] && !m[key], `mutant ${name}: ${what}`, 'blinded -> the report disappears')
  }
  { // unit-level mutants of the live-risk and hidden-writer detectors
    const risksOf = (lib) => {
      const live = { t: tbl({ columns: { a: col(), c: col({ null: 'NO', def: null }), name: col({ type: 'varchar(64)', null: 'YES', def: 'NULL' }) } }) }
      const repo = { t: tbl({ columns: { a: col(), name: col({ type: 'varchar(80)', null: 'YES', def: 'NULL' }) } }) }
      return lib.liveRisks(lib.diffSnapshots(live, repo, { columnsOnly: true }))
    }
    const base = risksOf(D)
    const load = async (name, from, to) => import(pathToFileURL(join(make(name, 'db-schema-diff.mjs', from, to), 'scripts/db-schema-diff.mjs')).href)
    const nb = await load('narrower-blind', 'if (a && b) return Number(a[2]) < Number(b[2])', 'if (a && b) return false')
    is(base.narrower.length === 1 && risksOf(nb).narrower.length === 0, 'mutant narrower-blind: a live column narrower than the repository\'s passes', 'blinded -> the risk disappears')
    const nn = await load('notnull-blind', "x.a?.null === 'NO' && (x.a.def === null", "x.a?.null === 'NEVER' && (x.a.def === null")
    is(base.notnull.length === 1 && risksOf(nn).notnull.length === 0, 'mutant notnull-blind: a live-only NOT NULL column without a default passes', 'blinded -> the risk disappears')
    const ob = await load('objects-blind', 'for (const k of OBJECT_KINDS) for (const o of objs?.[k] ?? [])', 'for (const k of []) for (const o of objs?.[k] ?? [])')
    is(D.liveObjectFindings({ triggers: [{ name: 't', t: 'orders' }] }).length === 1 && ob.liveObjectFindings({ triggers: [{ name: 't', t: 'orders' }] }).length === 0, 'mutant objects-blind: a live trigger passes', 'blinded -> the finding disappears')
    const pg = await load('privilege-blind', ".filter(([, need]) => !have.has(need) && !have.has('ALL PRIVILEGES'))", '.filter(() => false)')
    is(D.privilegeGaps([{ priv: 'SELECT' }]).length === 2 && pg.privilegeGaps([{ priv: 'SELECT' }]).length === 0, 'mutant privilege-blind: a SELECT-only export is trusted to prove "no triggers"', 'blinded -> the INCONCLUSIVE warning disappears')
    const pr = make('preamble-blind', 'db-schema-diff.mjs', "set session transaction read only;", '-- no preamble;')
    const printed = spawnSync(process.execPath, [join(pr, 'scripts/db-schema-diff.mjs'), '--print-queries', 'sporta'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    is(printed[0] !== 'set session transaction read only;', 'mutant preamble-blind: the printed queries lose their read-only session line', 'blinded -> the first statement is a plain SELECT')
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
