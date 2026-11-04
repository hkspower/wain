#!/usr/bin/env node
// scripts/db-schema-live-diff.mjs, against private MariaDB instances and with every comparison blinded in turn.
//
//   npm run test:db-schema-live-diff            (about 6 minutes on a loaded 4-CPU box; most of it is building the schema four times)
//
// WHAT IS PROVEN
//   A  the read-only gate: every statement that is not a SELECT / SHOW is refused before it is sent, the session is asserted
//      READ ONLY, and the server itself refuses a write inside it (error 1792): two locks, both exercised.
//   B  the comparison, one dimension at a time, on the committed expectation with a hand-edited "live" schema: missing table,
//      column, unique key, plain index, foreign key, CHECK; wider and narrower types; nullable; default; character set;
//      collation; engine; extra tables (OpenCart, dated copies, old-build, unknown); the guard pattern (a missing column the
//      code asks about is a warning, an unguarded one an error); which migration file explains each finding.
//   C  real MariaDB: a perfect database (diff empty, object for object equal to the committed expectation), the 2026-11-02
//      incident (inventory.mysql.sql and admin-recovery-codes.mysql.sql missing: names both, exit 1), extras, a widened column,
//      a missing index, a column in another collation, a SELECT-only account over TCP, a wrong password, the real production
//      structure of 2026-11-01 replayed through the same code, and a proof that nothing was written (the server's own counters).
//   D  the committed expectation is in step with the repository, and goes stale loudly (exit 3) when a migration changes.
//   E  migration integrity on the real repository: every file applies, a second run changes nothing, the dedicated migrations
//      in other orders reach the same schema, install.mysql.sql against schema + migrations, the seed re-run (owner edits
//      survive or do not), the lint, and the lists that name migrations (install parts, package, file audit, preflight).
//   F  the job spec: no curl, wget, require('fs') or dollar sign; the script and the expectation inside it are the files on disk;
//      and negative controls: the integrity harness must catch a non-idempotent file, an order-dependent one and a short install.
//   H  MUTATION: a copy of the tool with ONE comparison blinded must make this suite fail; 90-odd such copies are run.
//
// Never touches the shared test rig: own MariaDB (own datadir, own port from 34300, own socket), removed at the end.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import * as T from './db-schema-live-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, 'db-schema-live-diff.mjs')
const QUICK = process.argv.includes('--quick')           // skip the slow real-repository sections (E) for a fast loop
let fails = 0, total = 0
const ok = (n, d = '') => { total++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) }
const bad = (n, d = '') => { total++; fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
const clone = (o) => structuredClone(o)

if (!existsSync(T.SNAPSHOT_FILE)) { console.log(`FAIL the committed expectation ${T.SNAPSHOT_FILE} is missing: run  node scripts/db-schema-live-diff.mjs --snapshot`); process.exit(1) }
const SNAP = JSON.parse(readFileSync(T.SNAPSHOT_FILE, 'utf8'))

// ------------------------------------------------------------------ fixtures: a "live" schema made from the expectation
const liveOf = (snap = SNAP) => ({ server: '11.8.2-MariaDB', dbCharset: 'utf8mb4', dbCollation: 'utf8mb4_uca1400_ai_ci', tables: Object.fromEntries(Object.entries(clone(snap.tables)).map(([t, v]) => [t, { ...v, rows: null }])), views: [], triggers: [], routines: [], events: [] })
const edit = (fn) => { const l = liveOf(); fn(l); return l }
const ids = (r, sev) => r.items.filter((i) => !sev || i.severity === sev).map((i) => i.id)
const find = (r, id) => r.items.find((i) => i.id === id)
const BIGGEST = (a) => a.sort().join(' | ')

// A scenario is [name, mutate(live), assert(result, ctx) -> [[label, bool, detail?]...]].
function scenarios(M) {
  const S = []
  const sc = (name, fn, check) => S.push({ name, fn, check })
  sc('perfect', () => {}, (r) => [['no findings at all', r.items.length === 0, r.items.map((i) => i.id).join(',')], ['exit 0', M.exitCodeFor(r) === 0], ['every migration reads "applied" or "noop"', r.migrations.every((m) => ['applied', 'noop'].includes(m.status))]])
  sc('the 2026-11-02 incident', (l) => {
    for (const c of ['low_stock_threshold', 'unit_cost_kwd', 'inventory_version', 'updated_at']) delete l.tables.product_variants.columns[c]
    delete l.tables.inventory_movements; delete l.tables.admin_recovery_codes
  }, (r) => {
    const a = M.migrationsToApply(SNAP, r.items)
    return [
      ['six problems the code needs', r.summary.errors === 6, ids(r, 'error').join(',')],
      ['the missing stock column is named', find(r, 'column_missing:product_variants.inventory_version')?.severity === 'error'],
      ['inventory.mysql.sql explains it, before schema/install', find(r, 'column_missing:product_variants.inventory_version')?.explained_by[0] === 'inventory.mysql.sql'],
      ['and so does the recovery-codes table', find(r, 'table_missing:admin_recovery_codes')?.explained_by[0] === 'admin-recovery-codes.mysql.sql'],
      ['apply list is exactly those two files', JSON.stringify(a.files) === JSON.stringify(['admin-recovery-codes.mysql.sql', 'inventory.mysql.sql']), a.files.join(',')],
      ['inventory.mysql.sql reads "not applied"', r.migrations.find((m) => m.file === 'inventory.mysql.sql')?.status === 'not applied'],
      ['stock.mysql.sql still reads "applied"', r.migrations.find((m) => m.file === 'stock.mysql.sql')?.status === 'applied'],
      ['exit 1', M.exitCodeFor(r) === 1],
    ]
  })
  sc('extra tables (OpenCart, dated copy, old build, unknown, planned)', (l) => {
    const stub = () => ({ engine: 'InnoDB', collation: 'utf8mb4_general_ci', rows: 120, columns: { id: { pos: 1, type: 'int(11)', null: false, def: null, cs: null, coll: null, extra: 'auto_increment', gen: null } }, order: ['id'], indexes: {}, fks: {}, checks: {} })
    for (const n of ['oc_product', 'oc_customer', 'orders_legacy_20261020', 'mystery_things', 'customers', 'privacy_runs']) l.tables[n] = stub()
  }, (r) => {
    const fam = Object.fromEntries(r.items.filter((i) => i.kind === 'table_extra').map((i) => [i.table, i.family]))
    return [
      ['OpenCart leftover classified', fam.oc_product === 'opencart' && fam.oc_customer === 'opencart', JSON.stringify(fam)],
      ['dated copy classified', fam.orders_legacy_20261020 === 'backup-copy'],
      ['old-build table classified (and not to be dropped)', fam.customers === 'old-build' && /do not drop|no PHP/i.test(find(r, 'table_extra:customers')?.reason ?? '')],
      ['unknown table classified unknown', fam.mystery_things === 'unknown'],
      ['privacy pack classified planned', fam.privacy_runs === 'planned'],
      ['all of them are notes, none an error', r.items.every((i) => i.severity === 'info') && r.summary.info === 6],
      ['exit 0', M.exitCodeFor(r) === 0],
      ['row estimate shown for an extra table', /about 120 rows/.test(find(r, 'table_extra:oc_product')?.live ?? '')],
    ]
  })
  sc('a wider column is harmless, a narrower one is not', (l) => {
    l.tables.orders.columns.customer_name.type = 'varchar(255)'         // wider
    l.tables.orders.columns.customer_phone.type = 'varchar(8)'          // narrower
    l.tables.orders.columns.amount.type = 'decimal(10,2)'               // money: a decimal place short
    l.tables.reviews.columns.rating.type = 'tinyint(4)'                 // signed where unsigned is expected
  }, (r) => [
    ['widened varchar is a note', find(r, 'column_type:orders.customer_name')?.severity === 'info'],
    ['narrowed varchar is an error', find(r, 'column_type:orders.customer_phone')?.severity === 'error' && /holds 8/.test(find(r, 'column_type:orders.customer_phone')?.reason ?? '')],
    ['a decimal place lost is an error and says money', find(r, 'column_type:orders.amount')?.severity === 'error' && /money/.test(find(r, 'column_type:orders.amount')?.reason ?? '')],
    ['signed where unsigned is expected: error', find(r, 'column_type:reviews.rating')?.severity === 'error'],
    ['four findings: one note, three errors', r.summary.errors === 3 && r.summary.info === 1, `${r.summary.errors} errors ${r.summary.info} notes`],
    ['exit 1', M.exitCodeFor(r) === 1],
  ])
  sc('a missing plain index warns, a missing unique key fails', (l) => {
    delete l.tables.orders.indexes.idx_orders_payment
    delete l.tables.products.indexes.slug
  }, (r) => [
    ['plain index: warning', find(r, 'index_missing:orders.idx_orders_payment')?.severity === 'warning'],
    ['unique key: error', find(r, 'index_missing:products.slug')?.severity === 'error'],
    ['both name the file that creates them', find(r, 'index_missing:orders.idx_orders_payment')?.explained_by.includes('promo.mysql.sql')],
    ['exit 1 because of the unique key', M.exitCodeFor(r) === 1],
  ])
  sc('an index renamed but equal is only a note', (l) => {
    l.tables.orders.indexes.my_payment_idx = l.tables.orders.indexes.idx_orders_payment; delete l.tables.orders.indexes.idx_orders_payment
  }, (r) => [['renamed: info, no extra-index finding', r.items.length === 1 && r.items[0].kind === 'index_renamed' && r.items[0].severity === 'info', ids(r).join(',')], ['exit 0', M.exitCodeFor(r) === 0]])
  sc('a column in another collation / character set', (l) => {
    l.tables.products.columns.name_en.coll = 'utf8mb4_general_ci'
    l.tables.products.columns.name_ar.cs = 'latin1'; l.tables.products.columns.name_ar.coll = 'latin1_swedish_ci'
    l.tables.brands.columns.name_en.cs = 'utf8mb3'; l.tables.brands.columns.name_en.coll = 'utf8mb3_general_ci'
  }, (r) => [
    ['collation only: warning', find(r, 'column_collation:products.name_en')?.severity === 'warning'],
    ['latin1 where Arabic is stored: error', find(r, 'column_charset:products.name_ar')?.severity === 'error' && /Arabic/.test(find(r, 'column_charset:products.name_ar')?.reason ?? '')],
    ['utf8mb3: warning (no emoji)', find(r, 'column_charset:brands.name_en')?.severity === 'warning'],
    ['exit 1', M.exitCodeFor(r) === 1],
  ])
  sc('the guard pattern: guarded columns warn, unguarded ones fail', (l) => {
    delete l.tables.orders.columns.discount_ids; delete l.tables.orders.columns.discount_released   // asked about with store_column_exists / a 1054 handler
    delete l.tables.customer_accounts.columns.birthday_sent_year                                       // SHOW COLUMNS in the birthday code
  }, (r) => [
    ['discount_ids missing: warning, "ask first"', find(r, 'column_missing:orders.discount_ids')?.severity === 'warning' && find(r, 'column_missing:orders.discount_ids')?.needs === 'guarded'],
    ['discount_released missing: warning (store, cron, abandoned, and both gateway callbacks guard it)', find(r, 'column_missing:orders.discount_released')?.severity === 'warning'],
    ['birthday column missing: warning', find(r, 'column_missing:customer_accounts.birthday_sent_year')?.needs === 'guarded'],
    ['exit 0 with only guarded gaps', M.exitCodeFor(r) === 0],
    ['--strict fails on them', M.exitCodeFor(r, { strict: true }) === 1],
    ['the discount-release migration still explains it', find(r, 'column_missing:orders.discount_ids')?.explained_by.includes('discount-release.mysql.sql')],
  ])
  sc('an unguarded column fails', (l) => { delete l.tables.orders.columns.stock_claimed }, (r) => [
    ['stock_claimed: error, code needs', find(r, 'column_missing:orders.stock_claimed')?.severity === 'error' && find(r, 'column_missing:orders.stock_claimed')?.needs === 'code'],
    ['names stock.mysql.sql', find(r, 'column_missing:orders.stock_claimed')?.explained_by[0] === 'stock.mysql.sql'],
    ['stock.mysql.sql: partly applied', r.migrations.find((m) => m.file === 'stock.mysql.sql')?.status === 'partly applied'],
  ])
  sc('a table missing that the code asks about (guarded) and one it does not', (l) => { delete l.tables.order_tracking_events; delete l.tables.reviews }, (r) => [
    ['order_tracking_events: asked with table_exists / try-catch: warning', find(r, 'table_missing:order_tracking_events')?.severity === 'warning', find(r, 'table_missing:order_tracking_events')?.reason],
    ['reviews: used without a check: error', find(r, 'table_missing:reviews')?.severity === 'error'],
  ])
  sc('foreign key, CHECK, engine', (l) => {
    delete l.tables.order_tracking_events.fks.fk_tracking_order
    delete l.tables.order_tracking_events.checks.tracking_status_ck
    l.tables.fulfilment_outbox.checks.outbox_kind_ck.clause = "`kind` in ('new','payment')"
    l.tables.rate_limit.engine = 'MyISAM'
  }, (r) => [
    ['missing foreign key: warning', find(r, 'fk_missing:order_tracking_events.fk_tracking_order')?.severity === 'warning'],
    ['missing CHECK: warning', find(r, 'check_missing:order_tracking_events.tracking_status_ck')?.severity === 'warning'],
    ['a CHECK that refuses values the code writes: error, names outbox-kinds.mysql.sql', find(r, 'check_changed:fulfilment_outbox.outbox_kind_ck')?.severity === 'error' && find(r, 'check_changed:fulfilment_outbox.outbox_kind_ck')?.explained_by[0] === 'outbox-kinds.mysql.sql' && /'cancel'/.test(find(r, 'check_changed:fulfilment_outbox.outbox_kind_ck')?.reason ?? '')],
    ['MyISAM where InnoDB is needed: error', find(r, 'engine:rate_limit')?.severity === 'error'],
    ['outbox-kinds.mysql.sql: not applied properly (not "applied")', r.migrations.find((m) => m.file === 'outbox-kinds.mysql.sql')?.status !== 'applied'],
  ])
  sc('nullable and default', (l) => {
    l.tables.orders.columns.customer_name.null = false                    // the code stores NULL here
    l.tables.orders.columns.payment_status.def = null                     // NOT NULL, no default now: omitted value fails
    l.tables.orders.columns.payment_method.def = "'cod'"                  // a different default
    l.tables.brands.columns.logo.null = false
  }, (r) => [
    ['NOT NULL where the code stores NULL: error', find(r, 'column_nullable:orders.customer_name')?.severity === 'error'],
    ['default lost on a NOT NULL column: error', find(r, 'column_default:orders.payment_status')?.severity === 'error' && /1364/.test(find(r, 'column_default:orders.payment_status')?.reason ?? '')],
    ['default changed: warning', find(r, 'column_default:orders.payment_method')?.severity === 'warning'],
    ['a NOT NULL logo column where the code stores NULL logos: error', find(r, 'column_nullable:brands.logo')?.severity === 'error'],
  ])
  sc('extras the repository knows (hot-fix, privacy pack) and one it does not', (l) => {
    l.tables.admin_users.indexes.uq_admin_users_google_sub = { unique: true, type: 'BTREE', cols: ['google_sub'] }     // 2026-10-31 hot-fix: same key, another name
    l.tables.orders.columns.anonymised_at = { pos: 99, type: 'datetime', null: true, def: null, cs: null, coll: null, extra: '', gen: null }
    l.tables.orders.indexes.uq_phone = { unique: true, type: 'BTREE', cols: ['customer_phone'] }
  }, (r) => [
    ['an equal key under another name is not reported at all', !ids(r).some((i) => i.includes('uq_admin_users_google_sub'))],
    ['a column the privacy pack adds is explained', /ops\/db\/privacy-schema\.sql/.test(find(r, 'column_extra_live:orders.anonymised_at')?.reason ?? '') && find(r, 'column_extra_live:orders.anonymised_at')?.severity === 'info'],
    ['an unknown UNIQUE key is a warning (it can refuse valid orders)', find(r, 'index_extra:orders.uq_phone')?.severity === 'warning'],
  ])
  sc('triggers, routines, events, views', (l) => { l.triggers = ['t_orders (BEFORE INSERT on orders)']; l.routines = ['r1 (PROCEDURE)']; l.events = ['e1 (ENABLED)']; l.views = ['v_orders'] }, (r) => [
    ['four notes', r.items.filter((i) => i.kind === 'object_extra').length === 4],
    ['they are notes, exit 0', r.summary.errors === 0 && M.exitCodeFor(r) === 0],
  ])
  sc('MariaDB 11 reports the same things differently (no display widths)', (l) => {
    for (const T_ of Object.values(l.tables)) for (const c of Object.values(T_.columns)) c.type = c.type.replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1')
  }, (r) => [['int(10) unsigned and int unsigned are the same column', r.items.length === 0, ids(r).slice(0, 4).join(',')]])
  return S
}

// The battery: everything that needs no database, run against whichever module it is given (the real tool, or a mutant).
async function battery(M) {
  const out = []
  const t = (label, cond, detail) => out.push([label, !!cond, detail])
  const threw = (fn) => { try { fn(); return false } catch { return true } }
  const threwAsync = async (fn) => { try { await fn(); return false } catch { return true } }

  // ---- A. the read-only gate
  for (const s of ['select 1', 'SELECT * FROM information_schema.tables', 'show columns from orders', '  select 1;', 'SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION READ ONLY', 'ROLLBACK', 'SET SESSION max_statement_time = 60', '/* c */ select 1', 'select 1 -- trailing']) t(`gate accepts: ${s.slice(0, 40)}`, !threw(() => M.assertReadOnlySql(s)))
  for (const s of ['insert into orders values (1)', 'update orders set amount = 0', 'delete from orders', 'drop table orders', 'alter table orders add x int', 'create table x (a int)', 'truncate orders', 'grant all on *.* to x', 'call p()', 'set global read_only = 0', 'set session transaction read write', 'start transaction', 'start transaction read write', 'commit', 'replace into x values (1)', 'load data infile \'/x\' into table y',
    'select 1; drop table orders', 'select 1 into outfile \'/tmp/x\'', 'select * from orders for update', 'select * from orders lock in share mode', '/* select */ delete from orders', 'with x as (select 1) delete from y', 'do sleep(1)', 'flush tables', 'lock tables orders write', 'rename table a to b', 'optimize table orders', 'analyze table orders', 'kill 1']) t(`gate refuses: ${s.slice(0, 44)}`, threw(() => M.assertReadOnlySql(s)))
  {
    const mk = (v) => ({ sent: [], async query(sql) { this.sent.push(sql); return { columns: ['x'], rows: [[v]] } }, end() {} })
    const ro = new M.Gate(mk('1'))
    t('gate.readOnly() passes when the server says tx_read_only = 1', !(await threwAsync(() => ro.readOnly())))
    t('and it sent the read-only setup first', ro.conn.sent[0] === 'SET SESSION TRANSACTION READ ONLY' && ro.conn.sent[1] === 'START TRANSACTION READ ONLY')
    const rw = new M.Gate(mk('0'))
    t('gate.readOnly() REFUSES when the session is not read-only', await threwAsync(() => rw.readOnly()))
    t('gate.query() refuses a write before it reaches the connection', await threwAsync(() => rw.query('delete from orders')) && !rw.conn.sent.includes('delete from orders'))
  }
  t('scrub removes a password from an error message', !M.scrub('Access denied for secretPW123 at x', ['secretPW123']).includes('secretPW123'))
  t('scrub keeps the rest of the message', M.scrub('Access denied for secretPW123 at x', ['secretPW123']).includes('Access denied'))

  // ---- type relations
  const rel = (a, b) => M.typeRelation(a, b).rel
  for (const [a, b, want] of [['varchar(80)', 'varchar(80)', 'same'], ['varchar(80)', 'varchar(255)', 'wider'], ['varchar(80)', 'varchar(40)', 'narrower'], ['int(10) unsigned', 'int(11) unsigned', 'same'], ['int(10) unsigned', 'bigint(20) unsigned', 'wider'],
    ['bigint(20) unsigned', 'int(10) unsigned', 'narrower'], ['int(10) unsigned', 'int(11)', 'narrower'], ['tinyint(3) unsigned', 'smallint(6)', 'wider'], ['decimal(10,3)', 'decimal(10,2)', 'narrower'], ['decimal(10,3)', 'decimal(12,3)', 'wider'], ['decimal(10,3)', 'decimal(8,3)', 'narrower'],
    ['decimal(10,3)', 'double', 'family'], ['decimal(10,3)', 'varchar(20)', 'family'], ['text', 'mediumtext', 'wider'], ['mediumtext', 'text', 'narrower'], ['varchar(500)', 'text', 'wider'], ['text', 'varchar(255)', 'narrower'], ['longtext', 'longtext', 'same'],
    ["enum('a','b')", "enum('a','b','c')", 'wider'], ["enum('a','b','c')", "enum('a','b')", 'narrower'], ["enum('a','b')", 'varchar(10)', 'wider'], ['timestamp', 'datetime', 'other'], ['datetime', 'datetime', 'same']])
    t(`type ${a} -> ${b} is ${want}`, rel(a, b) === want, rel(a, b))

  // ---- statements and the lint
  const sp = M.splitStatements("-- a; b\ninsert into t values ('x;y', \"p;q\"); /* c; d */ update t set a = 1 where b = 'it''s;'; ")
  t('splitStatements ignores ; in strings and comments', sp.length === 2, sp.map((s) => s.text).join(' || '))
  const pk = (sql) => M.staticKeys(M.splitStatements(sql).map(M.parseStatement)).keys
  t('static keys: add column + implicit unique + index + constraints', ['column:t.a', 'index:t.a', 'column:t.b', 'index:t.ix', 'fk:t.fk_x', 'check:t.ck_y', 'index:t.uq_z'].every((k) => pk("alter table t add column if not exists a int unique, add column if not exists b int, add index if not exists ix (b), add constraint fk_x foreign key (b) references u(id), add constraint ck_y check (b > 0), add unique key if not exists uq_z (a);").has(k)), [...pk("alter table t add column if not exists a int unique, add column if not exists b int, add index if not exists ix (b), add constraint fk_x foreign key (b) references u(id), add constraint ck_y check (b > 0), add unique key if not exists uq_z (a);")].join(','))
  t('static keys: create index', pk('create unique index if not exists ix2 on t (a);').has('index:t.ix2'))
  t('static keys: a column called "key" or "index" is not a key', pk('alter table t add column if not exists `key` int;').has('column:t.key'))
  t('static keys: drop then add the same constraint', pk('alter table t drop constraint if exists ck; alter table t add constraint ck check (a in (1,2));').has('check:t.ck'))
  {
    const sql = "alter table t add column if not exists a int, add column if not exists b int after a;"
    const g = M.staticKeys(M.splitStatements(sql).map(M.parseStatement)).groups
    t('static keys: columns added by the same ALTER form a group', g.length === 1 && g[0].columns.join() === 'a,b')
  }
  const lint = (sql) => M.lintFile('x.mysql.sql', sql)
  const rules = (sql) => lint(sql).map((f) => f.rule).sort().join(',')
  const OK = 'create table if not exists a (id int primary key) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;\nalter table a add column if not exists b int null;\ncreate index if not exists ix on a (b);\ninsert into a (id) values (1) on duplicate key update id = id;\n'
  t('lint: a clean additive file has no findings', rules(OK) === '', rules(OK))
  t('lint: DROP TABLE', rules('drop table a;') === 'destructive-drop')
  t('lint: DROP DATABASE', rules('drop database x;') === 'destructive-drop')
  t('lint: ALTER ... DROP COLUMN', rules('alter table a drop column b;') === 'destructive-drop')
  t('lint: ALTER ... DROP INDEX', rules('alter table a drop index ix;') === 'destructive-drop')
  t('lint: DROP CONSTRAINT with the same one added back is a redefinition (warning, not error)', lint("alter table a drop constraint if exists ck;\nalter table a add constraint ck check (b in (1,2));").every((f) => f.rule === 'redefine-constraint' && f.severity === 'warning') && lint("alter table a drop constraint if exists ck;\nalter table a add constraint ck check (b in (1,2));").length === 1)
  t('lint: DROP CONSTRAINT without a replacement is destructive', rules('alter table a drop constraint if exists ck;') === 'destructive-drop')
  t('lint: TRUNCATE', rules('truncate table a;') === 'truncate')
  t('lint: DELETE without WHERE', rules('delete from a;') === 'delete-no-where')
  t('lint: DELETE with WHERE is only an overwrite warning', rules('delete from a where id = 1;') === 'overwrite-on-rerun')
  t('lint: UPDATE without WHERE', rules('update a set b = 1;') === 'update-no-where')
  t('lint: a backfill restricted to unset rows is fine', rules('update a set b = 1 where b is null;') === '' && rules('update a set subtotal = amount where subtotal = 0 and amount > 0;') === '')
  t('lint: UPDATE with a WHERE that does not restrict to unset rows warns', rules("update a set b = 1 where c = 'women';") === 'overwrite-on-rerun')
  t('lint: RENAME TABLE', rules('rename table a to b;') === 'rename')
  t('lint: ALTER ... RENAME COLUMN', lint('alter table a rename column b to c;').some((f) => f.rule === 'rename'))
  t('lint: MODIFY COLUMN warns', rules('alter table a modify column b bigint;') === 'modify-column')
  t('lint: CREATE TABLE without IF NOT EXISTS', lint('create table a (id int primary key) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;').map((f) => f.rule).join() === 'not-idempotent')
  t('lint: ADD COLUMN without IF NOT EXISTS', rules('alter table a add column b int;') === 'not-idempotent')
  t('lint: CREATE INDEX without IF NOT EXISTS', rules('create index ix on a (b);') === 'not-idempotent')
  t('lint: ADD INDEX without IF NOT EXISTS', rules('alter table a add index ix (b);') === 'not-idempotent')
  t('lint: ADD CONSTRAINT without IF NOT EXISTS', rules('alter table a add constraint fk foreign key (b) references c(id);') === 'not-idempotent')
  t('lint: plain INSERT duplicates on a second run', rules('insert into a (id) values (1);') === 'not-idempotent')
  t('lint: INSERT IGNORE is fine', rules('insert ignore into a (id) values (1);') === '')
  t('lint: ON DUPLICATE KEY UPDATE that overwrites is a warning', rules('insert into a (id, b) values (1, 2) on duplicate key update b = values(b);') === 'overwrite-on-rerun')
  t('lint: ON DUPLICATE KEY UPDATE x = x is fine', rules('insert into a (id, b) values (1, 2) on duplicate key update id = id;') === '' && rules('insert into a (id, b) values (1, 2) on duplicate key update name = name;') === '')
  t('lint: REPLACE INTO', rules('replace into a (id) values (1);') === 'overwrite-on-rerun')
  t('lint: USE', rules('use sporta;') === 'not-portable')
  t('lint: CREATE DATABASE', rules('create database x;') === 'not-portable')
  t('lint: a trigger', rules('create trigger tr before insert on a for each row set new.b = 1;') === 'not-portable')
  t('lint: a table without ENGINE / CHARSET / COLLATE', rules('create table if not exists a (id int primary key);') === 'server-default-collation')
  t('lint: a float money column', lint('create table if not exists a (id int primary key, price float) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;').some((f) => f.rule === 'float-money'))
  t('lint: SET foreign_key_checks', rules('set foreign_key_checks = 0;') === 'session-setting')
  t('lint: findings carry file and line', lint('\n\ndrop table a;')[0]?.line === 3 && lint('drop table a;')[0]?.file === 'x.mysql.sql')

  // ---- reading information_schema: the normalisations
  {
    const rows = {
      version: [['11.8.2-MariaDB', 'utf8mb4', 'utf8mb4_uca1400_ai_ci']],
      tables: [['t', 'BASE TABLE', 'InnoDB', 'utf8_general_ci', '5'], ['v', 'VIEW', null, null, null]],
      columns: [['t', 'id', '1', 'int(11)', 'NO', null, null, null, 'auto_increment', ''], ['t', 'n', '2', 'varchar(5)', 'YES', 'NULL', 'utf8', 'utf8_general_ci', '', ''], ['t', 'd', '3', 'int(11)', 'NO', '0', null, null, '', '']],
      indexes: [['t', 'PRIMARY', '0', '1', 'id', null, 'BTREE'], ['t', 'ix', '1', '2', 'n', '3', 'BTREE'], ['t', 'ix', '1', '1', 'd', null, 'BTREE']],
      fks: [['t', 'fk', '1', 'd', 'u', 'id', 'RESTRICT', 'CASCADE']], checks: [['t', 'ck', 'Table', '`d` > 0']], triggers: [['tr', 't', 'BEFORE', 'INSERT']], routines: [], events: [],
    }
    const q = async (sql) => ({ rows: rows[Object.keys(M.SCHEMA_QUERIES).find((k) => M.SCHEMA_QUERIES[k] === sql)] })
    const live = await M.readSchema(q)
    t('readSchema: a view is not a table', !live.tables.v && live.views[0] === 'v')
    t('readSchema: the string "NULL" default means no default', live.tables.t.columns.n.def === null && live.tables.t.columns.d.def === '0')
    t('readSchema: utf8 is utf8mb3 (MariaDB 10.6+ spelling)', live.tables.t.columns.n.cs === 'utf8mb3' && live.tables.t.columns.n.coll === 'utf8mb3_general_ci' && live.tables.t.collation === 'utf8mb3_general_ci')
    t('readSchema: index columns come back in key order with their prefix length', live.tables.t.indexes.ix.cols.join() === 'd,n(3)' && live.tables.t.indexes.PRIMARY.unique === true && live.tables.t.indexes.ix.unique === false)
    t('readSchema: foreign keys, CHECKs, triggers and the row estimate', live.tables.t.fks.fk.ref === 'u' && live.tables.t.fks.fk.del === 'CASCADE' && live.tables.t.checks.ck.clause === '`d` > 0' && live.triggers.length === 1 && live.tables.t.rows === 5)
    t('readSchema: auto_increment is kept in extra', live.tables.t.columns.id.extra === 'auto_increment')
  }
  // ---- extras
  for (const [n, f] of [['oc_order', 'opencart'], ['wp_options', 'wordpress'], ['ps_cart', 'prestashop'], ['failed_jobs', 'framework'], ['orders_bak_2026', 'backup-copy'], ['products_legacy_20261020', 'backup-copy'], ['zzz_unknown', 'unknown'], ['customers', 'old-build'], ['privacy_runs', 'planned']])
    t(`extra table ${n} is ${f}`, M.classifyExtraTable(n, SNAP).family === f, M.classifyExtraTable(n, SNAP).family)

  // ---- the diff, scenario by scenario
  for (const sc of scenarios(M)) {
    const live = edit(sc.fn)
    const r = M.diffSchemas(SNAP, live, {})
    for (const [label, cond, detail] of sc.check(r)) t(`[${sc.name}] ${label}`, cond, detail)
  }
  // ---- stable order: the same live schema listed in another order gives byte-identical output
  {
    const a = edit((l) => { for (const n of ['oc_x', 'zz_y', 'mm_z']) l.tables[n] = { engine: 'InnoDB', collation: 'utf8mb4_general_ci', rows: 1, columns: {}, order: [], indexes: {}, fks: {}, checks: {} }; delete l.tables.orders.columns.stock_claimed; delete l.tables.brands.columns.sort })
    const b = (() => { const c = clone(a); c.tables = Object.fromEntries(Object.entries(c.tables).reverse()); return c })()
    const ra = M.diffSchemas(SNAP, a, {}), rb = M.diffSchemas(SNAP, b, {})
    t('the findings are listed in a stable order whatever the order the server answered in', JSON.stringify(ra.items) === JSON.stringify(rb.items))
    t('errors sort before warnings before notes', ra.items.map((i) => i.severity).join() === [...ra.items.map((i) => i.severity)].sort((x, y) => ({ error: 0, warning: 1, info: 2 })[x] - ({ error: 0, warning: 1, info: 2 })[y]).join())
    const md = M.renderMarkdown(SNAP, a, ra, { database: 'sporta', snapshotId: 'abc' })
    t('the Markdown report names the database, the verdict and the file to run', /sporta/.test(md) && /FAIL/.test(md) && /stock\.mysql\.sql/.test(md))
    t('the Markdown report warns against re-importing install.mysql.sql', /Do NOT re-import `install\.mysql\.sql`/.test(md))
    const js = JSON.parse(M.renderJson(SNAP, a, ra, { database: 'sporta', snapshotId: 'abc' }))
    t('the JSON report parses and agrees', js.verdict === 'fail' && js.findings.length === ra.items.length && js.apply.files.includes('stock.mysql.sql'))
  }
  // ---- exit code policy
  {
    const warnOnly = M.diffSchemas(SNAP, edit((l) => { delete l.tables.orders.indexes.idx_orders_payment }), {})
    t('exit: warnings alone pass', M.exitCodeFor(warnOnly) === 0)
    t('exit: --strict fails on a warning', M.exitCodeFor(warnOnly, { strict: true }) === 1)
    t('exit: an error fails', M.exitCodeFor(M.diffSchemas(SNAP, edit((l) => { delete l.tables.orders }), {})) === 1)
  }
  // ---- migration attribution from the expectation itself
  t('every dedicated migration in the expectation provides at least one object', Object.entries(SNAP.provides).filter(([f]) => !['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql'].includes(f)).every(([, k]) => k.length > 0))
  t('providersOf ranks a dedicated migration before schema and install', JSON.stringify(M.providersOf(SNAP, 'column:product_variants.inventory_version')) === JSON.stringify(['inventory.mysql.sql', 'schema.mysql.sql', 'install.mysql.sql']), M.providersOf(SNAP, 'column:product_variants.inventory_version').join())
  t('every table in the expectation has a provider', Object.keys(SNAP.tables).every((tb) => M.providersOf(SNAP, `table:${tb}`).length > 0))
  t('the guard section knows store_column_exists, SHOW COLUMNS, table_exists and the 1054 handlers', ['store_column_exists', 'SHOW COLUMNS', 'table_exists', '1054 handler'].every((h) => SNAP.guards.some((g) => g.how === h)))
  // ---- snapshot comparison is sensitive
  {
    const a = clone(SNAP); const b = clone(SNAP)
    t('compareSnapshots: equal snapshots are the same', M.compareSnapshots(a, b).schemaSame)
    b.tables.orders.columns.extra_new = clone(b.tables.orders.columns.amount)
    t('compareSnapshots: a new column is a difference', !M.compareSnapshots(a, b).schemaSame)
    const c = clone(SNAP); c.files['inventory.mysql.sql'] = 'f'.repeat(16)
    t('compareSnapshots: a changed file hash is a difference and is named', (() => { const r = M.compareSnapshots(a, c); return !r.schemaSame && r.why.some((w) => /inventory\.mysql\.sql changed/.test(w)) })())
    const d = clone(SNAP); d.code.columns['orders.stock_claimed'] = [['x.php'], []]
    t('compareSnapshots: a PHP-usage change is advisory, not a schema difference', (() => { const r = M.compareSnapshots(a, d); return r.schemaSame && !r.codeSame })())
  }
  // ---- compareSchemas / schemaKeys
  {
    const A = liveOf(), B = liveOf()
    t('compareSchemas: equal', M.compareSchemas(A, B).same)
    B.tables.orders.columns.amount.type = 'decimal(10,2)'; delete B.tables.brands.indexes.slug
    const c = M.compareSchemas(A, B)
    t('compareSchemas: a changed column is "differ"', c.differ.includes('column:orders.amount'))
    t('compareSchemas: a removed index is "onlyA"', c.onlyA.includes('index:brands.slug'))
    const d = M.compareSchemas(B, A)
    t('compareSchemas: the other way it is "onlyB"', d.onlyB.includes('index:brands.slug'))
    t('compareSchemas: int display width is not a difference', (() => { const x = liveOf(), y = liveOf(); y.tables.orders.columns.id.type = 'int(11) unsigned'; return M.compareSchemas(x, y).same })())
  }
  // ---- PHP scan on a fixture
  {
    const dir = mkdtempSync(join(tmpdir(), 'sdiff-php-'))
    const w = (n, s) => { writeFileSync(join(dir, n), s); return join(dir, n) }
    const tbl = { orders: { columns: { id: {}, discount_ids: {}, shiny: {}, plain: {}, sibling_a: {}, sibling_b: {}, via_fn: {} } }, ghost: { columns: { id: {}, g: {} } } }
    const files = [
      w('a.php', "<?php if (store_column_exists($db, 'orders', 'discount_ids')) { $db->query('select discount_ids from orders'); }"),
      w('b.php', "<?php $db->query('select shiny from orders');"),
      w('c.php', "<?php function ready($db) { return (bool)$db->query(\"show columns from orders like 'sibling_a'\")->fetch(); }\n"),
      w('d.php', "<?php if (!ready($db)) exit; $db->query('select sibling_a, sibling_b from orders');"),
      w('e.php', "<?php try { $q = $db->prepare('select plain from orders where id = ?'); $q->execute([1]); } catch (PDOException $e) { if ((int)($e->errorInfo[1] ?? 0) === 1054) return false; throw $e; }"),
      w('f.php', "<?php if (!ghost_table_exists($db, 'ghost')) return; $db->query('select g from ghost');"),
    ]
    const groups = [{ table: 'orders', columns: ['sibling_a', 'sibling_b'] }]
    const r = M.scanCode(tbl, groups, files)
    const g = (k) => r.code.columns[k]
    t('scan: a column used and asked about is guarded in that file', g('orders.discount_ids')?.[1].includes('a.php'))
    t('scan: a column used without a question has no guard', g('orders.shiny')?.[0].includes('b.php') && !g('orders.shiny')?.[1].includes('b.php'))
    t('scan: a guard function covers the files that call it', g('orders.sibling_a')?.[1].includes('d.php'))
    t('scan: and the columns added by the same ALTER', g('orders.sibling_b')?.[1].includes('d.php'))
    t('scan: a 1054 handler counts as a guard', g('orders.plain')?.[1].includes('e.php'))
    t('scan: a *_table_exists guard covers the table', r.code.tables.ghost?.[1].includes('f.php'))
    t('scan: a column no file mentions has no entry', g('orders.via_fn') === undefined)
    const nd = M.codeNeed({ code: r.code }, 'column', 'orders', 'shiny')
    t('codeNeed: unguarded -> code', nd.needs === 'code' && nd.unguarded.includes('b.php'))
    t('codeNeed: all guarded -> guarded', M.codeNeed({ code: r.code }, 'column', 'orders', 'discount_ids').needs === 'guarded')
    t('codeNeed: unreferenced -> cosmetic', M.codeNeed({ code: r.code }, 'column', 'orders', 'via_fn').needs === 'cosmetic')
    rmSync(dir, { recursive: true, force: true })
  }
  // ---- the job spec
  {
    const spec = M.jobSpec('console.log(1)\n', '{"a":1}\n')
    const txt = JSON.stringify(spec)
    for (const re of M.FORBIDDEN_IN_JOB) t(`job spec has no ${re}`, !re.test(txt))
    const svc = Object.values(spec.services)[0]
    t('job spec carries the script and the expectation as data', gunzipSync(Buffer.from(svc.environment.SRC, 'base64')).toString() === 'console.log(1)\n' && gunzipSync(Buffer.from(svc.environment.EXPECTED, 'base64')).toString() === '{"a":1}\n')
    t('job spec is read-only: every mount is :ro', svc.volumes.every((v) => v.endsWith(':ro')))
    t('job spec runs --live with --expected-file and never a write verb', /--live/.test(svc.command[0]) && /--expected-file/.test(svc.command[0]) && !/--snapshot|--make-job|--integrity/.test(svc.command[0]))
  }
  return out
}

// ============================================================================ run
const real = await battery(T)
head('A-B  the gate, the comparison, the lint, the scan, the job spec (no database)')
for (const [label, cond, detail] of real) is(cond, label, cond ? '' : detail)
console.log(`\n${real.length} checks without a database`)

// ------------------------------------------------------------------ a private MariaDB
let inst = null
const cleanups = []
process.on('exit', () => { for (const f of cleanups.splice(0)) { try { f() } catch { /* gone */ } } })
const ROOT = mkdtempSync(join(tmpdir(), 'sdiff-test-'))
cleanups.push(() => rmSync(ROOT, { recursive: true, force: true }))
const cli = (args, env = {}) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 })
let integrityProbe = null
try { inst = await T.startInstance('sdt', { portFrom: 34300, root: join(ROOT, 'main') }) } catch (e) { if (e.skip) console.log(`SKIP database sections: ${e.message}`); else throw e }
if (inst) {
  cleanups.push(() => inst.stop())
  head('C  real MariaDB, read through the same wire client the job uses')
  const order = T.canonicalOrder()
  const text = (f) => readFileSync(T.sourcePath(f), 'utf8')
  const rest = [...order.dropin, ...order.external].filter((f) => !order.parts.includes(f) && f !== 'schema.mysql.sql')
  // the route `npm run sandbox` and the rigs use: install.mysql.sql, then every other file. The expectation was built the other way round (schema, parts, rest).
  const base = await T.freshDb(inst, 'base')
  for (const f of [order.install, ...rest]) { const r = T.runSql(inst, base, text(f)); if (!r.ok) bad(`building the perfect database: ${f}`, r.message) }
  const perfect = await T.readPrivate(inst, base)
  ok('server', perfect.server)
  const r0 = T.diffSchemas(SNAP, perfect, {})
  is(r0.items.length === 0, 'a database built install-first (not the way the expectation was built) has an EMPTY diff', r0.items.map((i) => i.id).join(','))
  is(T.compareSchemas({ tables: SNAP.tables }, perfect).same, 'object for object, the live reading equals the committed expectation', JSON.stringify(T.compareSchemas({ tables: SNAP.tables }, perfect)).slice(0, 300))
  is(r0.migrations.filter((m) => m.kind === 'migration').every((m) => m.status === 'applied'), 'every dedicated migration reads "applied"')
  const dump = join(ROOT, 'base.sql')
  { const d = spawnSync('mariadb-dump', ['--no-defaults', '-S', inst.sock, '-uroot', '--no-data', '--skip-comments', 'base'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); writeFileSync(dump, d.stdout) }
  const derive = async (name, alters) => { const db = await T.freshDb(inst, name); const a = T.runSql(inst, db, readFileSync(dump, 'utf8')); if (!a.ok) bad(`copy of the base for ${name}`, a.message); if (alters) { const b = T.runSql(inst, db, alters); if (!b.ok) bad(`alters for ${name}`, b.message) } return db }
  const run = (db, extra = []) => cli(['--live', '--expected-file', T.SNAPSHOT_FILE, ...extra], { DB_SOCKET: inst.sock, DB_USER: 'root', DB_NAME: db })
  const readOf = (db) => T.readPrivate(inst, db)

  head('C1  the 2026-11-02 incident')
  const incident = await derive('incident', 'alter table product_variants drop column low_stock_threshold, drop column unit_cost_kwd, drop column inventory_version, drop column updated_at; drop table inventory_movements; drop table admin_recovery_codes;')
  {
    const live = await readOf(incident)
    const r = T.diffSchemas(SNAP, live, {})
    is(r.summary.errors === 6 && r.summary.warnings === 0, 'six problems, nothing else', ids(r, 'error').join(', '))
    const out = run(incident)
    is(out.status === 1, 'the CLI exits 1', `status ${out.status}`)
    is(/inventory\.mysql\.sql/.test(out.stdout) && /admin-recovery-codes\.mysql\.sql/.test(out.stdout), 'and its report names inventory.mysql.sql and admin-recovery-codes.mysql.sql')
    is(/FAIL: 6 problem/.test(out.stdout) && /inventory_version/.test(out.stdout), 'and the missing column')
    is(/Do NOT re-import `install\.mysql\.sql`/.test(out.stdout), 'and it says not to re-import install.mysql.sql')
    const js = run(incident, ['--json'])
    let parsed = null; try { parsed = JSON.parse(js.stdout) } catch { /* reported below */ }
    is(parsed?.verdict === 'fail' && parsed.apply.files.join() === 'admin-recovery-codes.mysql.sql,inventory.mysql.sql', '--json parses and names the same two files', js.stdout.slice(0, 120))
    is(run(incident, ['--no-fail']).status === 0, '--no-fail exits 0 on the same database')
    const lines = out.stdout.split('\n')
    is(lines.indexOf(lines.find((l) => /^## What to apply/.test(l))) < lines.indexOf(lines.find((l) => /^## Migrations/.test(l))), 'the action comes before the detail')
  }

  head('C2  the perfect database through the CLI, and the two locks')
  {
    const out = run(base)
    is(out.status === 0 && /^\*\*PASS\*\*$/m.test(out.stdout), 'perfect: exit 0 and PASS', `status ${out.status}`)
    is(!/inventory_version|FAIL/.test(out.stdout), 'and nothing is reported')
    // the server's own counters: no write of any kind came from the tool
    const cnt = async () => Object.fromEntries((await inst.sql("show global status where variable_name in ('Com_insert','Com_update','Com_delete','Com_alter_table','Com_create_table','Com_drop_table','Com_create_index','Com_truncate','Com_replace','Com_grant','Com_create_db','Com_drop_db','Com_rename_table','Com_lock_tables','Com_flush')")).split('\n').map((l) => l.split('\t')))
    const before = await cnt()
    run(base); run(incident); run(base, ['--json'])
    const after = await cnt()
    const moved = Object.keys(before).filter((k) => before[k] !== after[k])
    is(moved.length === 0, 'three runs moved none of the server\'s write counters (insert, update, delete, alter, create, drop, truncate, grant, flush...)', moved.join(','))
    // lock 1: the gate
    const gc = new T.MySQL({ socket: inst.sock, user: 'root', password: '', database: base })
    await gc.connect()
    const gate = new T.Gate(gc)
    await gate.readOnly()
    let refused = null; try { await gate.query('delete from brands') } catch (e) { refused = e }
    is(refused instanceof T.ReadOnlyViolation, 'lock 1: the gate refuses DELETE before it is sent')
    // lock 2: the server (bypass the gate on purpose)
    let serverSays = null; try { await gc.query("insert into rate_limit (bucket_key, window_start, hits) values ('x', 1, 1)") } catch (e) { serverSays = e.message }
    is(/1792|READ ONLY/i.test(serverSays ?? ''), 'lock 2: with the gate bypassed, the SERVER refuses the write in a read-only transaction', serverSays)
    is((await inst.sql('select count(*) from rate_limit', base)) === '0', 'and no row was written')
    const g2 = new T.Gate(new T.MySQL({ socket: inst.sock, user: 'root', password: '', database: base }))
    await g2.conn.connect(); await g2.readOnly(); await T.readSchema((q) => g2.query(q)); await g2.end()
    const sent = g2.sent
    is(sent.length >= 10 && sent.every((x) => /^(select|show|set session|start transaction read only|rollback)/i.test(x)), `every statement sent was a SELECT / SHOW / read-only setup (${sent.length} sent)`)
    is(sent.every((x) => [...x.matchAll(/\b(?:from|join)\s+([\w.`]+)/gi)].every((m) => /^information_schema\./i.test(m[1]))), 'and every FROM / JOIN in them is information_schema: no data table is ever read')
    await gate.end()
  }

  head('C3  a SELECT-only account over TCP, and a wrong password')
  {
    const pw = 'Pw' + Math.random().toString(36).slice(2) + 'Zq9'
    await inst.sql(`drop user if exists 'ro'@'127.0.0.1'; create user 'ro'@'127.0.0.1' identified by '${pw}'; grant select on \`base\`.* to 'ro'@'127.0.0.1'; flush privileges`)
    const env = { DB_HOST: '127.0.0.1', DB_PORT: String(inst.port), DB_USER: 'ro', DB_PASSWORD: pw, DB_NAME: 'base' }
    const out = cli(['--live', '--expected-file', T.SNAPSHOT_FILE], env)
    is(out.status === 0 && /PASS/.test(out.stdout), 'a user with only SELECT on the database gets the same empty diff', `status ${out.status} ${out.stderr.slice(0, 150)}`)
    is(!out.stdout.includes(pw) && !out.stderr.includes(pw), 'and the password is not in the output')
    const wrong = cli(['--live', '--expected-file', T.SNAPSHOT_FILE], { ...env, DB_PASSWORD: 'definitely-wrong-' + pw })
    is(wrong.status === 2, 'a wrong password: exit 2 (the tool could not do its job), not 0', `status ${wrong.status}`)
    is(!wrong.stdout.includes(pw) && !wrong.stderr.includes(pw) && !wrong.stderr.includes('definitely-wrong'), 'and neither password appears in what it printed', wrong.stderr.slice(0, 160))
    is(cli(['--live', '--expected-file', T.SNAPSHOT_FILE], { ...env, DB_PORT: '1' }).status === 2, 'no server on the port: exit 2')
    is(cli(['--live', '--expected-file', join(ROOT, 'nope.json')], env).status === 2, 'no expectation file: exit 2')
    const bogus = join(ROOT, 'bogus.json'); writeFileSync(bogus, '{"format":"other"}')
    is(cli(['--live', '--expected-file', bogus], env).status === 2, 'a file in another format: exit 2')
    const cfg = join(ROOT, 'cfg.php')
    writeFileSync(cfg, `<?php\nreturn ['db_host' => '127.0.0.1;port=${inst.port}', 'db_name' => 'base', 'db_user' => 'ro', 'db_pass' => '${pw}'];\n`)
    const viaCfg = cli(['--live', '--config', cfg, '--expected-file', T.SNAPSHOT_FILE], {})
    is(viaCfg.status === 0, 'the same through --config <store config.php> (the way the VPS job runs)', `status ${viaCfg.status} ${viaCfg.stderr.slice(0, 120)}`)
    // the account really is read-only at the server: the tool needs nothing more than SELECT
    const rwTry = spawnSync('mariadb', ['--no-defaults', '-h127.0.0.1', `-P${inst.port}`, '-uro', `-p${pw}`, 'base', '-e', 'delete from brands'], { encoding: 'utf8' })
    is(rwTry.status !== 0, 'control: the account cannot write, so a pass above proves nothing needed more than SELECT')
  }

  head('C4  extras, a widened column, a missing index, another collation (real information_schema)')
  {
    const db = await derive('mixed', `
      create table oc_product (product_id int primary key, model varchar(64)) engine=MyISAM;
      create table oc_customer (customer_id int primary key) engine=MyISAM;
      create table orders_legacy_20261020 (id int primary key);
      create table mystery_things (id int primary key);
      alter table orders modify customer_name varchar(255) null collate utf8mb4_unicode_ci;
      alter table orders drop index idx_orders_payment;
      alter table products modify name_en varchar(160) character set utf8mb4 collate utf8mb4_general_ci not null;
      alter table order_tracking_events drop foreign key fk_tracking_order;`)
    const r = T.diffSchemas(SNAP, await readOf(db), {})
    const fam = Object.fromEntries(r.items.filter((i) => i.kind === 'table_extra').map((i) => [i.table, i.family]))
    is(fam.oc_product === 'opencart' && fam.oc_customer === 'opencart' && fam.orders_legacy_20261020 === 'backup-copy' && fam.mystery_things === 'unknown', 'extras classified from real information_schema', JSON.stringify(fam))
    is(find(r, 'column_type:orders.customer_name')?.severity === 'info', 'widened column: a note')
    is(find(r, 'index_missing:orders.idx_orders_payment')?.severity === 'warning', 'missing plain index: a warning')
    is(find(r, 'column_collation:products.name_en')?.severity === 'warning', 'column in another collation: a warning')
    is(find(r, 'fk_missing:order_tracking_events.fk_tracking_order')?.severity === 'warning', 'missing foreign key: a warning')
    is(r.summary.errors === 0 && T.exitCodeFor(r) === 0, 'and the whole thing still exits 0')
    const out = run(db)
    is(out.status === 0 && /oc_product/.test(out.stdout) && /opencart/.test(out.stdout), 'CLI: exit 0, extras listed by family')
    is(run(db, ['--strict']).status === 1, 'CLI: --strict turns the warnings into a failure')
    const sev = derive('sev', "alter table products drop index slug; alter table orders modify customer_phone varchar(8) null; alter table orders modify amount decimal(10,2) not null default 0.00; alter table reviews engine=MyISAM; alter table rate_limit engine=MyISAM; alter table brands convert to character set latin1;")
    const r2 = T.diffSchemas(SNAP, await readOf(await sev), {})
    is(find(r2, 'index_missing:products.slug')?.severity === 'error', 'real MariaDB: a dropped unique key is an error')
    is(find(r2, 'column_type:orders.customer_phone')?.severity === 'error' && find(r2, 'column_type:orders.amount')?.severity === 'error', 'real MariaDB: a narrowed varchar and a decimal place lost are errors')
    is(find(r2, 'engine:rate_limit')?.severity === 'error', 'real MariaDB: MyISAM where InnoDB is needed is an error')
    is(ids(r2).some((i) => i.startsWith('column_charset:brands.')) && r2.items.filter((i) => i.kind === 'column_charset' && i.table === 'brands').every((i) => i.severity === 'error'), 'real MariaDB: latin1 where Arabic is stored is an error')
  }

  head('C5  the real production structure of 2026-11-01, replayed')
  {
    const db = await T.freshDb(inst, 'prod1101')
    const dumpPath = join(T.WEB, 'docs/live-schema-structure.sql')
    if (existsSync(dumpPath)) {
      const a = T.runSql(inst, db, readFileSync(dumpPath, 'utf8'), { force: true })
      const live = await readOf(db)
      const r = T.diffSchemas(SNAP, live, { skip: ['indexes', 'fks', 'checks', 'engine', 'extra'] })     // the committed dump carries columns only
      is(Object.keys(live.tables).length >= 50, 'the production dump loads', `${Object.keys(live.tables).length} tables`)
      const apply = T.migrationsToApply(SNAP, r.items)
      is(apply.files.includes('inventory.mysql.sql') && apply.files.includes('admin-recovery-codes.mysql.sql'), 'it names inventory.mysql.sql and admin-recovery-codes.mysql.sql (both absent from that dump)', apply.files.join(', '))
      is(T.exitCodeFor(r) === 1, 'and it fails')
      const old = r.items.filter((i) => i.kind === 'table_extra' && i.family === 'old-build').length
      is(old >= 30, 'the old-build tables of that era are recognised and left alone', `${old}`)
      is(r.items.filter((i) => i.kind === 'table_extra' && i.family === 'unknown').length === 0, 'no table of that dump is "unknown"')
      is(r.items.some((i) => i.kind === 'column_missing' && i.needs === 'guarded'), 'and guarded gaps are warnings there too')
      ok('replay summary', `${r.summary.errors} errors, ${r.summary.warnings} warnings, ${r.summary.info} notes; apply ${apply.files.length} files`)
      void a
    } else bad('docs/live-schema-structure.sql is missing')
  }

  head('D  the committed expectation is the repository, and goes stale loudly')
  {
    const fresh = join(ROOT, 'fresh.json')
    const b = cli(['--snapshot', '--out', fresh])
    is(b.status === 0 && existsSync(fresh), '--snapshot builds and writes it', b.stderr.slice(0, 200))
    if (existsSync(fresh)) {
      const f = JSON.parse(readFileSync(fresh, 'utf8'))
      const c = T.compareSnapshots(SNAP, f)
      is(c.schemaSame, 'the committed ops/db/expected-schema.json equals what the repository builds NOW (schema, provides, families, file hashes)', c.why.join('; ') + ' - run: node scripts/db-schema-live-diff.mjs --snapshot')
      if (!c.codeSame) ok('note: the committed PHP-usage section lags the code (advisory)')
      else ok('and its PHP-usage section is current too')
      is(/\n$/.test(readFileSync(fresh, 'utf8')) && JSON.parse(readFileSync(fresh, 'utf8')).format === T.FORMAT, 'the snapshot file is JSON in the documented format and ends in a newline')
      // staleness: a committed copy that disagrees must exit 3 under --check-snapshot
      const stale = JSON.parse(readFileSync(T.SNAPSHOT_FILE, 'utf8'))
      stale.files['inventory.mysql.sql'] = '0'.repeat(16); delete stale.tables.orders.columns.stock_claimed
      const sp = join(ROOT, 'stale.json'); writeFileSync(sp, JSON.stringify(stale))
      const chk = cli(['--check-snapshot', '--out', sp])
      is(chk.status === 3 && /STALE/.test(chk.stderr) && /--snapshot/.test(chk.stderr), '--check-snapshot exits 3 on a stale copy and says how to refresh it', `status ${chk.status} ${chk.stderr.slice(0, 160)}`)
      const good = cli(['--check-snapshot'])
      is(good.status === 0, '--check-snapshot exits 0 on the committed copy', `status ${good.status} ${good.stderr.slice(0, 160)}`)
    }
  }

  head('E  migration integrity, on the real repository')
  if (QUICK) console.log('skipped (--quick)')
  else {
    const rep = await T.integrity({ inst })
    is(rep.applies.every((a) => a.ok), 'every migration applies on top of the files before it', rep.applies.filter((a) => !a.ok).map((a) => `${a.file}: ${a.message}`).join('; '))
    is(rep.repeat.errors.length === 0, 'a second run of every file is error-free', rep.repeat.errors.map((e) => `${e.file}: ${e.message}`).join('; '))
    is(rep.repeat.schemaSame, 'and changes no table, column, index, key or CHECK', JSON.stringify(rep.repeat.diff).slice(0, 200))
    is(rep.repeat.rowsChanged.length === 0, 'and changes no row of any table', rep.repeat.rowsChanged.join(','))
    const claimed = new Set(Object.values(T.lackedByInstall(SNAP)).flat()), actual = new Set(rep.install.aloneVsCanonical.onlyA)
    is(claimed.size === actual.size && [...claimed].every((k) => actual.has(k)), 'install.mysql.sql alone lacks EXACTLY the objects the expectation says only a dedicated migration creates (static claim == dynamic build)', `claimed ${claimed.size}, built ${actual.size}: ${[...actual].filter((k) => !claimed.has(k)).slice(0, 4).join(',')}`)
    is(rep.install.aloneVsCanonical.onlyB.length === 0 && rep.install.aloneVsCanonical.differ.length === 0, 'install.mysql.sql creates nothing the canonical build does not, and nothing differently', JSON.stringify(rep.install.aloneVsCanonical).slice(0, 200))
    is(rep.install.withRestVsCanonical.same, 'install.mysql.sql followed by the remaining migrations equals the canonical build', JSON.stringify(rep.install.withRestVsCanonical).slice(0, 200))
    is(rep.order.length >= 5, 'the dedicated migrations were also applied in other orders', rep.order.map((o) => o.label).join(','))
    for (const o of rep.order) is(o.errors.length === 0 && o.same, `order ${o.label}: no error and the same schema`, o.errors.map((e) => `${e.file}: ${e.message}`).join('; ') + JSON.stringify(o.diff).slice(0, 160))
    ok('dependencies between migrations (smallest set each needs on top of schema.mysql.sql)', rep.deps.filter((d) => d.needs.length).map((d) => `${d.file} <- ${d.needs.join('+')}${d.declaredInHeader.length === d.needs.length ? '' : ' (undeclared)'}`).join('; ') || 'none')
    // the seed: the static rule and the measured behaviour must agree file by file
    const lintOverwrites = (f) => T.lintFile(f, readFileSync(T.sourcePath(f), 'utf8')).some((x) => x.rule === 'overwrite-on-rerun' && /\b(products|product_variants|brands|settings)\b/.test(x.detail))
    for (const r of rep.seed.results) {
      is((r.overwritten.length > 0) === lintOverwrites(r.file), `${r.file}: the lint's "overwrite-on-rerun" agrees with the measured re-run`, `overwritten: ${r.overwritten.join(', ') || 'nothing'}; preserved: ${r.preserved.join(', ')}`)
      is(r.rowsAfter === rep.seed.rowsBefore, `${r.file}: a re-run duplicates no seed row (${rep.seed.rowsBefore})`, `${rep.seed.rowsBefore} -> ${r.rowsAfter}`)
      is(r.preserved.includes('variant stock'), `${r.file}: the owner's stock count survives a re-run`)
    }
    const lint = T.lintAll()
    is(!lint.some((f) => f.severity === 'error'), `the lint finds no destructive or non-idempotent statement in ${T.readSqlSources().length} files`, lint.filter((f) => f.severity === 'error').map((f) => `${f.file}:${f.line} ${f.rule}`).join('; '))
    ok('lint warnings recorded', `${lint.filter((f) => f.severity === 'warning').length}: ${[...new Set(lint.filter((f) => f.severity === 'warning').map((f) => `${f.file}:${f.rule}`))].length} distinct`)
    const pk = T.packagingChecks(SNAP)
    is(pk.listed_but_absent.length === 0, 'every install part named in the generator exists on disk', pk.listed_but_absent.join(','))
    is(pk.install_on_disk_is_the_generator_output === true, 'install.mysql.sql on disk is byte for byte what the generator writes')
    ok('migrations on disk that are not install parts', `${pk.not_in_install_parts.length}: ${pk.not_in_install_parts.join(', ')}`)
    ok('tables the code needs that preflight.php never checks', `${pk.tables_the_code_needs_unchecked_by_preflight.length}: ${pk.tables_the_code_needs_unchecked_by_preflight.join(', ')}`)
    ok('guards that name an object no migration creates', pk.guards_naming_missing_objects.map((g) => `${g.file}:${g.table}.${g.column ?? ''}`).join(', ') || 'none')
  }

  head('F2  negative controls for the integrity harness (a non-idempotent, an order-dependent file and a short install)')
  {
    const syn = (extra = {}) => {
      const files = {
        'schema.mysql.sql': 'create table if not exists t1 (id int primary key, a varchar(10)) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;\n',
        'm-ok.mysql.sql': 'alter table t1 add column if not exists b int null;\n',
        'm-notidem.mysql.sql': 'alter table t1 add column c int null;\n',
        'm-dep-a.mysql.sql': 'alter table t1 add column if not exists d int null;\n',
        'm-dep-b.mysql.sql': 'create index if not exists ix_d on t1 (d);\n',
        'install.mysql.sql': 'create table if not exists t1 (id int primary key, a varchar(10)) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;\n',
        ...extra,
      }
      return { order: { dropin: ['schema.mysql.sql', 'm-dep-a.mysql.sql', 'm-dep-b.mysql.sql', 'm-notidem.mysql.sql', 'm-ok.mysql.sql'], external: [], install: 'install.mysql.sql', parts: ['schema.mysql.sql'] }, text: (f) => files[f] }
    }
    const probe = async (M) => {
      const rep = await M.integrity({ inst, source: syn(), seeds: [3], seedChecks: false })
      return [
        ['non-idempotent ADD COLUMN: the second run reports it', rep.repeat.errors.some((e) => e.file === 'm-notidem.mysql.sql')],
        ['the repeat does not blame idempotent files', !rep.repeat.errors.some((e) => e.file === 'm-ok.mysql.sql')],
        ['order-dependent migrations: the reversed order reports an error', rep.order.find((o) => o.label === 'reverse')?.errors.some((e) => e.file === 'm-dep-b.mysql.sql')],
        ['and the schema that order reaches is reported as different from the canonical one', rep.order.find((o) => o.label === 'reverse')?.same === false],
        ['a migration that depends on another says which', rep.deps.find((d) => d.file === 'm-dep-b.mysql.sql')?.needs.includes('m-dep-a.mysql.sql')],
        ['and notes that the header never mentions it', rep.deps.find((d) => d.file === 'm-dep-b.mysql.sql')?.declaredInHeader.length === 0],
        ['an install.mysql.sql shorter than schema + migrations is reported', rep.install.aloneVsCanonical.onlyA.includes('column:t1.b') && rep.install.aloneVsCanonical.onlyA.includes('column:t1.d')],
        ['and the install followed by the rest is complete', rep.install.withRestVsCanonical.same === true || rep.install.withRestVsCanonical.onlyA.length === 0],
        ['applies: every file applies the first time, in order', rep.applies.every((a) => a.ok)],
      ]
    }
    for (const [label, cond] of await probe(T)) is(cond, `harness: ${label}`)
    integrityProbe = probe
  }
}

// ============================================================================ the committed job
head('F  the committed one-shot job (ops/db/schema-diff.compose.json)')
{
  if (!existsSync(T.JOB_FILE)) bad('the job file is missing', 'run: node scripts/db-schema-live-diff.mjs --make-job')
  else {
    const raw = readFileSync(T.JOB_FILE, 'utf8')
    const spec = JSON.parse(raw)
    const svc = Object.values(spec.services)[0]
    for (const re of T.FORBIDDEN_IN_JOB) is(!re.test(raw), `the committed job file contains no ${re}`)
    is(gunzipSync(Buffer.from(svc.environment.SRC, 'base64')).toString('utf8') === readFileSync(TOOL, 'utf8'), 'the script inside the job is the script on disk, byte for byte (regenerate with --make-job after any change)')
    is(gunzipSync(Buffer.from(svc.environment.EXPECTED, 'base64')).toString('utf8') === readFileSync(T.SNAPSHOT_FILE, 'utf8'), 'the expectation inside the job is ops/db/expected-schema.json, byte for byte')
    is(svc.image === 'node:24-alpine' && svc.restart === 'no' && svc.volumes.every((v) => v.endsWith(':ro')), 'node:24-alpine, no restart, every mount read-only')
    is(svc.networks.join() === 'sporta-db_default' && spec.networks['sporta-db_default'].external === true, 'on the database network, like the other read-only database jobs')
    is(svc.command[0].includes('--live') && svc.command[0].includes('--exit-line'), 'it runs --live and prints SCHEMA_DIFF_EXIT=<code> itself (no shell variable needed)')
    ok('size', `${Math.round(raw.length / 1024)} kB`)
  }
}

// ============================================================================ mutation
head('H  mutation: one comparison blinded at a time, the suite must go red')
const SRC = readFileSync(TOOL, 'utf8')
const mdir = mkdtempSync(join(tmpdir(), 'sdiff-mut-'))
cleanups.push(() => rmSync(mdir, { recursive: true, force: true }))
try { symlinkSync(join(HERE, 'lib'), join(mdir, 'lib')) } catch { /* exists */ }
const baseline = new Set(real.filter((r) => !r[1]).map((r) => r[0]))
let n = 0
async function load(from, to) {
  const count = SRC.split(from).length - 1
  if (count !== 1) return { err: `snippet occurs ${count} times` }
  const f = join(mdir, `m${++n}.mjs`)
  writeFileSync(f, SRC.replace(from, () => to))
  return { mod: await import(pathToFileURL(f).href) }
}
const MUTANTS = [
  // the gate
  ['gate: any statement may be sent', '/*M:gate-verb*/', 'return s;'],
  ['gate: several statements allowed', "if (s.includes(';')) throw new ReadOnlyViolation('refused: more than one statement')", 'if (false) throw 0'],
  ['gate: SELECT ... INTO OUTFILE allowed', 'if (/\\binto\\s+(outfile|dumpfile)\\b/i.test(s) ||', 'if (false && /\\binto\\s+(outfile|dumpfile)\\b/i.test(s) ||'],
  ['gate: locking reads allowed', '|| /\\bfor\\s+update\\b/i.test(s) ||', '|| false ||'],
  ['read-only assertion removed', "if (String(r.rows[0]?.[0]) !== '1') throw", 'if (false) throw'],
  ['passwords not scrubbed', 'for (const s of secrets) if (s && s.length >= 3) m = m.split(s).join', 'for (const s of secrets) if (false) m = m.split(s).join'],
  // the comparison
  ['missing tables not reported', '/*M:table-missing*/', 'continue;'],
  ['extra tables not reported', '/*M:table-extra*/', 'continue;'],
  ['missing columns not reported', '/*M:col-missing*/', 'continue;'],
  ['column types not compared', "if (!skip.has('types')) {", 'if (false) {'],
  ['a narrower type is not an error', "if (r.rel === 'narrower' || r.rel === 'family') {", "if (r.rel === 'family') {"],
  ['a wider type is an error', "needs: 'cosmetic', expected: ec.type, live: lcol.type, reason: 'live holds at least", "needs: 'code', expected: ec.type, live: lcol.type, reason: 'live holds at least"],
  ['wider types not noted', '/*M:col-wider*/', 'continue;'],
  ['nullability not compared', "if (!skip.has('nullable') && ec.null !== lcol.null) {", 'if (false) {'],
  ['defaults not compared', "if (!skip.has('defaults') && ec.def !== lcol.def &&", 'if (false && ec.def !== lcol.def &&'],
  ['character sets not compared', "if (!skip.has('charset') && (ec.cs || lcol.cs)) {", 'if (false) {'],
  ['collations not compared', '/*M:col-coll*/', 'continue;'],
  ['latin1 is not worse than utf8mb4', 'const bad = lcol.cs && NON_UNICODE.test(lcol.cs)', 'const bad = false'],
  ['auto_increment loss not an error', 'const lostAuto = ec.extra.includes', 'const lostAuto = false && ec.extra.includes'],
  ['live-only columns not noted', '/*M:col-extra*/', 'continue;'],
  ['missing indexes not reported', '/*M:idx-missing*/', 'continue;'],
  ['a missing unique key is only a warning', 'const crit = ix.unique', 'const crit = false'],
  ['changed indexes not reported', '/*M:idx-changed*/', 'continue;'],
  ['live-only indexes not noted', '/*M:idx-extra*/', 'continue;'],
  ['a renamed equal index is reported as missing', 'if (alias) { add({ kind: \'index_renamed\'', 'if (false) { add({ kind: \'index_renamed\''],
  ['missing foreign keys not reported', '/*M:fk-missing*/', 'continue;'],
  ['missing CHECKs not reported', '/*M:check-missing*/', 'continue;'],
  ['changed CHECKs not reported', '} else if (normClause(lk.clause) !== normClause(ck.clause)) {', '} else if (false) {'],
  ['a CHECK refusing needed values is not an error', "needs: lacks.length ? 'code' : 'integrity'", "needs: 'integrity'"],
  ['engines not compared', "if (!skip.has('engine') && e.engine && l.engine && e.engine.toLowerCase() !== l.engine.toLowerCase()) {", 'if (false) {'],
  ['triggers / routines not reported', 'for (const [list, what] of [[live.triggers, \'trigger\'], [live.routines, \'routine\'], [live.events, \'event\'], [live.views, \'view\']]) {', 'for (const [list, what] of []) {'],
  // the guard pattern
  ['every missing column counts as guarded', "return unguarded.length ? { needs: 'code', refs: rec[0], unguarded }", "return false ? { needs: 'code', refs: rec[0], unguarded }"],
  ['no column counts as guarded', 'const unguarded = rec[0].filter((f) => !rec[1].includes(f))', 'const unguarded = rec[0]'],
  // attribution, status, output
  ['no migration explains anything', 'for (const [f, keys] of Object.entries(expected.provides ?? {})) if (keys.includes(key)) out.push(f)', 'for (const [f, keys] of Object.entries(expected.provides ?? {})) if (false) out.push(f)'],
  ['schema/install ranked before the dedicated migration', "const rank = (f) => (f === 'install.mysql.sql' ? 3 : f === 'schema.mysql.sql' ? 2 : f === 'seed.mysql.sql' ? 2 : 0)", "const rank = (f) => (f === 'install.mysql.sql' ? 0 : f === 'schema.mysql.sql' ? 0 : f === 'seed.mysql.sql' ? 0 : 3)"],
  ['every migration reads "applied"', "present.length === keys.length ? 'applied' : present.length === 0 ?", "true ? 'applied' : present.length === 0 ?"],
  ['the exit code ignores errors', 'if (result.summary.errors > 0) return 1', 'if (false) return 1'],
  ['--strict ignored', 'if (strict && result.summary.warnings > 0) return 1', 'if (false) return 1'],
  ['findings not sorted', 'items.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.table.localeCompare(b.table) || ko(a.kind) - ko(b.kind) || String(a.name).localeCompare(String(b.name)))', 'items.sort(() => 0)'],
  ['the report forgets the install warning', 'Do NOT re-import `install.mysql.sql` on a shop that has taken orders', 'Re-import `install.mysql.sql` on a shop that has taken orders'],
  ['normalised "NULL" default compared raw', "export function normDefault(d) { return d == null || d === 'NULL' ? null : String(d) }", 'export function normDefault(d) { return d == null ? null : String(d) }'],
  ['int display width compared', ".replace(/\\b(tinyint|smallint|mediumint|int|bigint)\\(\\d+\\)/g, '$1')", ''],
  // statements and lint
  ['splitter breaks on ; in strings', "if (ch === \"'\" || ch === '\"' || ch === '`') {", "if (ch === '`') {"],
  ['lint: DROP not flagged', "if (s.op === 'drop') add('destructive-drop', 'error', s)", 'if (false) add(0)'],
  ['lint: ALTER DROP not flagged', "else add('destructive-drop', 'error', s, c.text)", 'else void 0'],
  ['lint: TRUNCATE not flagged', "if (s.op === 'truncate') add('truncate', 'error', s)", 'if (false) add(0)'],
  ['lint: DELETE without WHERE not flagged', "if (s.op === 'delete') add(s.hasWhere ? 'overwrite-on-rerun' : 'delete-no-where', s.hasWhere ? 'warning' : 'error', s)", 'if (false) add(0)'],
  ['lint: UPDATE without WHERE not flagged', "if (s.op === 'update' && !s.hasWhere) add('update-no-where', 'error', s)", 'if (false) add(0)'],
  ['lint: RENAME not flagged', "if (s.op === 'rename_table') add('rename', 'error', s)", 'if (false) add(0)'],
  ['lint: CREATE TABLE without IF NOT EXISTS not flagged', "if (!s.ifNotExists) add('not-idempotent', 'error', s, `CREATE TABLE", "if (false) add('not-idempotent', 'error', s, `CREATE TABLE"],
  ['lint: ADD COLUMN without IF NOT EXISTS not flagged', "if (c.type === 'add_column' && !c.ifNotExists) add(", "if (false) add("],
  ['lint: plain INSERT not flagged', "if (!s.ignore && !s.onDuplicate) add(", 'if (false) add('],
  ['lint: overwriting upserts not flagged', "if (s.onDuplicate && over.length) add(", 'if (false) add('],
  ['lint: a constraint redefinition is destructive', "const redefined = /constraint|check/.test(c.what) && c.name && added.has(`${s.table}.${c.name}`)", 'const redefined = false'],
  ['lint: USE / CREATE DATABASE not flagged', "if (s.op === 'create_routine' || s.op === 'delimiter' || s.op === 'use' ||", "if (false && s.op === 'use' ||"],
  ['lint: tables without ENGINE/COLLATE not flagged', "if (!/\\bengine\\s*=\\s*\\w+/i.test(s.raw) ||", 'if (false && !/\\bengine\\s*=\\s*\\w+/i.test(s.raw) ||'],
  ['lint: backfill restricted to unset rows flagged', "(\\bis\\s+null|=\\s*0\\b|\\bnot\\s+exists\\b", "(\\bis\\s+nullx|=\\s*0x\\b|\\bnot\\s+exists\\b"],
  // static keys
  ['static keys: implicit unique index missed', 'if (c.unique) keys.add(`index:${s.table}.${c.column}`)', ''],
  ['static keys: CREATE INDEX missed', "if (s.op === 'create_index') keys.add(`index:${s.table}.${s.name}`)", ''],
  ['static keys: ADD CONSTRAINT missed', "const kind = c.ctype === 'foreign key' ? 'fk' : c.ctype === 'check' ? 'check' : 'index'", "const kind = 'zzz'"],
  ['static keys: ALTER groups lost', 'if (cols.length) groups.push({ table: s.table, columns: cols })', ''],
  // the PHP scan
  ['scan: store_column_exists not recognised', "g.push({ table: m[1], column: m[2], how: 'store_column_exists' })", 'void 0'],
  ['scan: SHOW COLUMNS not recognised', "g.push({ table: m[1], column: m[2], how: 'SHOW COLUMNS' })", 'void 0'],
  ['scan: table_exists not recognised', "g.push({ table: m[1], column: null, how: 'table_exists' })", 'void 0'],
  ['scan: 1054 handler not recognised', "g.push({ table: t, column: c, how: '1054 handler' })", 'void 0'],
  ['scan: guard functions not inherited', 'if (f.text.includes(`${name}(`) && !f.fns.some((fn) => fn.name === name && false)) {', 'if (false) {'],
  ['scan: sibling columns not covered', "if (g.column) for (const k of sibling.get(`${g.table}.${g.column}`) ?? [`${g.table}.${g.column}`]) f.guardSet.add(k)", "if (g.column) f.guardSet.add(`${g.table}.${g.column}`)"],
  // snapshots and schemas
  ['snapshots always equal', 'const schemaSame = a === b', 'const schemaSame = true'],
  ['changed files not named', 'if (committed.files[f] !== fresh.files[f]) why.push', 'if (false) why.push'],
  ['PHP drift counted as schema drift', 'const { server, code, guards, ...rest } = s; void server; void code; void guards; return rest', 'const { server, ...rest } = s; void server; return rest'],
  ['compareSchemas ignores changed attributes', 'if (!kb.has(k)) onlyA.push(k); else if (kb.get(k) !== v) differ.push(k)', 'if (!kb.has(k)) onlyA.push(k)'],
  ['compareSchemas ignores added objects', 'for (const k of kb.keys()) if (!ka.has(k)) onlyB.push(k)', ''],
  // the job
  ['job command grows a dollar sign', "--markdown --exit-line'],", "--markdown; echo \\u0024?'],"],
  ['job mounts are writable', "'/docker/sporta/private/db_pass:/run/secrets/sporta_db_pass:ro',", "'/docker/sporta/private/db_pass:/run/secrets/sporta_db_pass:rw',"],
  ['job carries a stale expectation', 'EXPECTED: encode(snapshotText) }', "EXPECTED: encode('{}') }"],
]
const killedBy = {}
let survived = 0, notApplied = 0
for (const [name, from, to] of MUTANTS) {
  const { mod, err } = await load(from, to)
  if (err) { bad(`mutant "${name}" did not apply`, err); notApplied++; continue }
  let res
  try { res = await battery(mod) } catch (e) { res = [[`threw: ${e.message.slice(0, 60)}`, false]] }
  const failed = res.filter((r) => !r[1])
  const fresh = failed.filter((r) => !baseline.has(r[0]))
  if (fresh.length) { ok(`mutant killed: ${name}`, `${fresh.length} new check(s) red, e.g. "${fresh[0][0].slice(0, 70)}"`); killedBy[name] = fresh.length } else { bad(`mutant SURVIVED: ${name}`); survived++ }
}
if (inst && integrityProbe) {
  const IM = [
    ['integrity: second-run errors not recorded', 'if (!r.ok) again.push({ file: f, message: r.message })', 'if (false) again.push({ file: f, message: r.message })'],
    ['integrity: other orders not compared', 'const c = compareSchemas(schemaA, await readPrivate(inst, B))', 'const c = { same: true, onlyA: [], onlyB: [], differ: [] }'],
    ['integrity: other-order errors not recorded', 'for (const f of ord) { const r = runSql(inst, B, text(f)); if (!r.ok) errs.push({ file: f, message: r.message }) }', 'for (const f of ord) { runSql(inst, B, text(f)) }'],
    ['integrity: install compared with itself', 'aloneVsCanonical: compareSchemas(schemaA, schemaI)', 'aloneVsCanonical: compareSchemas(schemaA, schemaA)'],
    ['integrity: dependencies not discovered', 'if (!r.ok) {\n        const pool', 'if (false) {\n        const pool'],
  ]
  for (const [name, from, to] of IM) {
    const { mod, err } = await load(from, to)
    if (err) { bad(`mutant "${name}" did not apply`, err); notApplied++; continue }
    let res
    try { res = await integrityProbe(mod) } catch (e) { res = [[`threw: ${e.message.slice(0, 60)}`, false]] }
    const failed = res.filter((r) => !r[1])
    if (failed.length) ok(`mutant killed: ${name}`, `"${failed[0][0].slice(0, 70)}"`); else { bad(`mutant SURVIVED: ${name}`); survived++ }
  }
}
console.log(`\n${Object.keys(killedBy).length} mutants killed by the database-free battery, ${survived} survived, ${notApplied} did not apply`)

console.log(`\n${total} checks, ${fails} problem(s)`)
process.exit(fails ? 1 : 0)
