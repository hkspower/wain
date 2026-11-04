// db-columns-audit-test.mjs — proves scripts/db-columns-audit.mjs finds what it exists to find.
//
//   npm run test:db-columns                 everything (about five minutes: three schema builds of the real tree)
//   node scripts/db-columns-audit-test.mjs --fast       the fixture and the mutants only
//   node scripts/db-columns-audit-test.mjs --no-routes  skip the real-route probe
//   node scripts/db-columns-audit-test.mjs --units      part 1 only (no database; a few seconds)
//
// WHAT IT PROVES, in four parts. Every part runs on a PRIVATE MariaDB (own datadir, own port from 34100, removed at
// the end); the shared test rig, its ports, dist/ and every repository file are untouched.
//
//   1. UNITS         the lexer, the placeholder binder, the expander of dynamic SQL, the SQL reader that decides which
//                    table a column belongs to and what a statement does to it.
//   2. FIXTURE       a small tree with every defect the tool must flag injected on purpose: a statement naming a column
//                    that does not exist, a column nothing uses, a column only written, a validation cap longer than its
//                    varchar, an INSERT that leaves out a NOT NULL column, a literal longer than its column, a guard on a
//                    column nothing creates, a migration that fails the second time, a migration that only works after
//                    another one. The same tree also holds statements that are RIGHT; none of them may be flagged.
//   3. REAL TREE     the repository's own schema and PHP: install.mysql.sql == the tooling order, a second run changes
//                    nothing, no statement is refused by MariaDB unless it is one of the documented, guarded ones, no
//                    INSERT leaves a required column out, and the findings the audit documents are still found.
//   4. MUTATION      each detector is blinded in a COPY of the tool (a source edit, not a flag) and the fixture is run
//                    again: the matching defect must disappear. A detector whose blinding changes nothing is not tested.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as A from './db-columns-audit.mjs'
import * as D from './db-schema-diff.mjs'
import { startPrivateMariadb } from './lib/private-mariadb.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const FAST = argv.includes('--fast')
const NO_ROUTES = argv.includes('--no-routes') || FAST

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  - ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// ----------------------------------------------------------------------------------------- 1. units
head('1. units')
{
  const toks = A.lexSql("select a.id, `b c`, 'it''s' /* x */ from t -- tail\n where x = ? and y = :name and z = @v")
  is(toks.filter((t) => t.t === 'param').length === 2, 'both placeholder styles are parameters')
  is(toks.some((t) => t.t === 'id' && t.q && t.v === 'b c'), 'a backtick identifier keeps its text')
  is(toks.some((t) => t.t === 'str' && t.v === "'it''s'"), "a doubled quote stays inside its string")
  is(!toks.some((t) => /x \*\/|tail/.test(t.v)), 'comments are dropped')
  is(A.bindPlaceholders('select id from t where a = ? limit ?, ? offset ?') === 'select id from t where a = NULL limit 1, 1 offset 1', 'placeholders become NULL, but LIMIT / OFFSET get a number', A.bindPlaceholders('select id from t where a = ? limit ?, ? offset ?'))
  is(A.bindPlaceholders("select '?' as q, now() from t where d > now() - interval ? minute") === "select '?' as q, now() from t where d > now() - interval 1 minute", 'a ? inside a string stays; INTERVAL ? gets a number; function spacing is not disturbed')

  const schema = { orders: new Set(['id', 'status', 'amount', 'note']), items: new Set(['id', 'order_id', 'qty', 'name']) }
  const an = (s) => A.analyseSql(s, schema)
  let r = an('select o.id, i.name from orders o join items i on i.order_id = o.id where o.status = ? order by o.amount')
  is(r.selected.has('orders.id') && r.selected.has('items.name') && r.filtered.has('items.order_id') && r.filtered.has('orders.status') && r.filtered.has('orders.amount'), 'select list vs join / where / order by are told apart')
  r = an('update orders set status = ?, amount = amount + 1 where id = ?')
  is(r.written.has('orders.status') && r.written.has('orders.amount') && r.selfref.has('orders.amount') && r.filtered.has('orders.id'), 'UPDATE: the left side is a write, the right side a self-reference, WHERE a filter')
  r = an('insert into items (order_id, qty, name) values (?, ?, ?) on duplicate key update qty = values(qty)')
  is(r.written.has('items.order_id') && r.written.has('items.qty') && r.written.has('items.name') && !r.selected.size, 'INSERT ... ON DUPLICATE KEY UPDATE: columns written, VALUES() reads nothing')
  r = an('select * from orders')
  is(r.stars.has('orders'), 'SELECT * is a read of every column')
  r = an('select count(*) as n from orders where id in (select order_id from items where qty > 1)')
  is(r.filtered.has('items.qty') && r.filtered.has('orders.id') && r.selected.has('items.order_id') && r.stars.size === 0, 'count(*) is not a star; a subselect is read in its own tables')
  const r2 = A.analyseSql('update discounts set value = ?, min_order = ?, type = ? where id = ?', { discounts: new Set(['id', 'value', 'min_order', 'type']) })
  is(r2.written.has('discounts.value') && r2.written.has('discounts.min_order') && r2.written.has('discounts.type'), 'VALUE inside an UPDATE is a column, not the VALUES keyword (this broke the reader once)')

  const ex = { funcvars: {}, fnreturns: {}, consts: { MAXN: 7 }, statements: [], guards: [] }
  ex.funcvars['f.php::go'] = {
    $sets: [{ op: 'array', keys: [], items: [], line: 3 }, { op: '[]=', pieces: [['lit', 'a = ?']], line: 5 }, { op: '[]=', pieces: [['lit', 'b = ?']], line: 6 }],
    $where: [{ op: '=', pieces: [['alt', [['lit', ' where x = 1']], [['lit', '']], '(c ? 1 : 2)']], line: 2 }],
  }
  const stmts = A.expandStatements({ ...ex, statements: [{ id: 1, file: 'f.php', line: 10, end_line: 10, func: 'go', ctx: '', assigned: null, call: 'prepare',
    pieces: [['lit', 'update t set '], ['expr', "implode(', ', $sets)"], ['var', '$where'], ['lit', ' limit '], ['expr', 'MAXN']] }] })
  is(stmts[0].variants.length === 2 && stmts[0].variants.some((v) => v === 'update t set a = ?, b = ? where x = 1 limit 7') && stmts[0].variants.some((v) => v === 'update t set a = ?, b = ? limit 7'),
     'a list built with $sets[] / implode, a ternary and a constant expand to every variant', J(stmts[0].variants))
  is(stmts[0].unresolved.length === 0, 'and nothing is left unresolved')
  const low = A.columnCapacity({ type: 'varchar(40)' })
  is(low.chars === 40 && A.columnCapacity({ type: 'text' }).bytes === 65535 && A.columnCapacity({ type: 'int(11)' }) === null, 'column capacity: varchar in characters, text in bytes')
  is(A.emailOf(120, 1).length === 120 && A.emailOf(254, 2).length === 254 && A.emailOf(120, 3) !== A.emailOf(120, 4), 'the e-mail generator hits exact lengths and is unique')
  // the binary search the route probe uses
  const calls = []
  const best = await (async () => { const f = async (L) => { calls.push(L); return L <= 57 }; return A.largest(2, 4000, f) })()
  is(best === 57 && calls.length < 20, 'largest() finds the threshold in about log2 steps', `${best} in ${calls.length} calls`)
  is((await A.largest(2, 100, async () => false)) === 1, 'largest() reports lo-1 when even the smallest value fails')
}
function J(x) { return JSON.stringify(x) }
if (argv.includes('--units')) { console.log(fails ? `\n${fails} problem(s)` : '\nunits ok'); process.exit(fails ? 1 : 0) }

// ----------------------------------------------------------------------------------------- 2. fixture
const FX = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dbcols-fx-'))
function writeFixture(root) {
  const dir = join(root, 'dropin/php-store')
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(root, 'dropin/php-knet'), { recursive: true }); mkdirSync(join(root, 'dropin/php-cbk'), { recursive: true })
  writeFileSync(join(dir, 'schema.mysql.sql'), `
create table if not exists items (
  id int unsigned auto_increment primary key,
  name varchar(80) not null,
  title varchar(40) null,
  legacy_flag tinyint(1) not null default 0,
  note text null,
  secret_log varchar(50) null,
  created_at timestamp not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
create table if not exists orders_fx (
  id int unsigned auto_increment primary key,
  item_id int unsigned not null,
  qty int not null,
  required_col varchar(10) not null,
  constraint fx_item foreign key (item_id) references items (id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
`)
  writeFileSync(join(dir, 'a-good.mysql.sql'), 'alter table items add column if not exists color varchar(20) null;\n')
  writeFileSync(join(dir, 'b-bad.mysql.sql'), 'alter table items add column weight int null;\n')            // not idempotent: fails the second time
  writeFileSync(join(dir, 'd-needs.mysql.sql'), 'create index if not exists idx_fx_color on items (color);\n') // needs a-good first
  writeFileSync(join(dir, 'api.php'), `<?php
function fx_list(PDO $db) { return $db->query('select id, name, ghost_col from items')->fetchAll(); }
function fx_add(PDO $db, array $b) {
    $title = store_text($b['title'] ?? null, 'title', 1, 100);
    $q = $db->prepare('insert into items (name, title, note) values (?, ?, ?)');
    $q->execute([store_text($b['name'] ?? null, 'name', 1, 80), $title, $b['note'] ?? null]);
}
function fx_order(PDO $db, int $item) { $db->prepare('insert into orders_fx (item_id, qty) values (?, ?)')->execute([$item, 1]); }
function fx_log(PDO $db, string $s) { $db->prepare('update items set secret_log = ? where id = 1')->execute([$s]); }
function fx_guard(PDO $db) { return store_column_exists($db, 'items', 'phantom') ? 1 : 0; }
function fx_ok(PDO $db) { return $db->query('select id, name, color from items where weight is null')->fetchAll(); }
function fx_literal(PDO $db) { $db->exec("update items set title = 'this literal is definitely longer than forty characters' where id = 1"); }
function fx_paint(PDO $db, array $b) { $db->prepare('update items set color = ?, weight = ? where id = ?')->execute([store_text($b['color'] ?? null, 'color', 1, 20), (int)($b['w'] ?? 0), 1]); }
function fx_cap_ok(PDO $db, array $b) { $db->prepare('update items set name = ? where id = ?')->execute([store_text($b['name'] ?? null, 'name', 1, 80), 1]); }
`)
  return root
}

let inst = null
async function fixtureRun(libDir, label) {
  const web = writeFixture(join(FX, label))
  const dir = join(web, 'dropin/php-store')
  const schemaDiff = await libDir.D.runSchemaDiff({ inst, dir, quick: false, shuffles: 8, seed: 3, liveDump: join(FX, 'none.sql') })
  const R = await libDir.A.runAudit({ inst, web, schemaDiff, clientDirs: [], addonFiles: [] })
  const { snapshots, ...sd } = R.schema_diff
  R.schema_diff = sd
  R.findings = libDir.A.buildFindings(R)
  return R
}
const has = (R, f) => R.findings.some(f)

try {
  inst = await startPrivateMariadb({ label: 'dt', portFrom: 34100 })
  head('2. fixture with injected defects')
  const R = await fixtureRun({ A, D }, 'real')
  const kinds = R.findings.map((f) => `${f.kind}:${f.table}.${f.column}`)
  is(has(R, (f) => f.kind === 'code-refers-to-missing-column' && f.column === 'ghost_col' && f.table === 'items' && f.severity === 'high'), 'a statement naming a column that does not exist is a high finding', kinds.find((k) => k.includes('ghost')))
  is(has(R, (f) => f.kind === 'dead-column' && f.table === 'items' && f.column === 'legacy_flag' && /no statement, SQL file, PHP string/.test(f.evidence)), 'a column nothing uses is reported dead')
  is(has(R, (f) => f.kind === 'dead-column' && f.table === 'items' && f.column.includes('secret_log')), 'a column that is only ever written is reported write-only')
  is(has(R, (f) => f.kind === 'type-or-size-mismatch' && f.table === 'items' && f.column === 'title' && /100/.test(f.evidence) && /40/.test(f.evidence)), 'a 100-character validation cap in front of varchar(40) is reported with both numbers')
  is(has(R, (f) => f.kind === 'type-or-size-mismatch' && f.table === 'items' && f.column === 'title' && /literal/.test(f.evidence)), 'a literal longer than its column is reported')
  is(has(R, (f) => f.kind === 'nullability-default' && f.table === 'orders_fx' && /required_col/.test(f.column)), 'an INSERT that leaves out a NOT NULL column without default is reported')
  is(has(R, (f) => f.kind === 'dead-column' && f.table === 'items' && f.column === 'phantom'), 'a guard on a column nothing creates is reported')
  is(has(R, (f) => f.kind === 'drift' && /b-bad\.mysql\.sql/.test(f.evidence) && /second time/.test(f.evidence)), 'a migration that fails the second time is reported')
  is(R.schema_diff.order.shuffles.some((s) => s.failed.some((x) => x.file === 'd-needs.mysql.sql')) && has(R, (f) => f.kind === 'drift' && /d-needs\.mysql\.sql/.test(f.evidence)), 'a migration that only works after another one is found by the shuffled orders', `${R.schema_diff.order.shuffles.filter((s) => s.failed.length).length} of ${R.schema_diff.order.shuffles.length} orders had a failure`)
  // and nothing right is flagged
  is(!has(R, (f) => f.table === 'items' && /(^|,)name(,|$)/.test(f.column) && f.kind !== 'drift'), 'items.name (read, written, capped at its width) is not flagged')
  is(!has(R, (f) => f.column === 'color' || f.column === 'weight'), 'columns added by good and bad migrations and used correctly are not flagged')
  is(R.explain.ok >= 5 && R.explain.failed === 1, 'EXPLAIN verdicts: the right statements pass, only the ghost column is refused', `${R.explain.ok} ok, ${R.explain.guarded} guarded, ${R.explain.failed} refused`)
  is(R.statements.total === 8, 'eight statements extracted from the fixture', String(R.statements.total))

  // ------------------------------------------------------------------------------------- 3. real tree
  if (!FAST) {
    head('3. the real tree')
    const sd = await D.runSchemaDiff({ inst, quick: false, shuffles: 4, seed: 11 })
    // KNOWN: abandoned.mysql.sql says install.mysql.sql carries abandoned_followup; schema.mysql.sql does not repeat it. Anything else is new.
    const KNOWN_INSTALL_GAPS = new Set(['abandoned_followup'])
    const gaps = sd.diffs.install_vs_tooling.filter((d) => !KNOWN_INSTALL_GAPS.has(d.table))
    is(gaps.length === 0, 'install.mysql.sql builds the schema the tooling order builds (apart from the one documented gap, abandoned_followup)', `${sd.counts.install.tables} tables, ${sd.counts.install.columns} columns, ${sd.counts.install.indexes} indexes${gaps.length ? '; NEW: ' + J(gaps.slice(0, 3)) : ''}`)
    is(sd.diffs.twice_vs_once.length === 0 && sd.apply.second_pass.every((r) => r.ok) && sd.rows_changed_by_second_pass.length === 0, 'applying every file a second time changes no table, column, index or row')
    is(sd.diffs.install_twice_vs_once.length === 0 && sd.apply.second_pass_install.every((r) => r.ok), 'install.mysql.sql imported twice changes nothing')
    const docsFailed = sd.apply.docs.filter((r) => !r.ok).map((r) => r.file)
    is(docsFailed.every((f) => f === 'crm.mysql.sql'), 'in the docs order only the known crm.mysql.sql (needs customers.mysql.sql first) fails, nothing new', docsFailed.join(',') || 'none (the crm patch is applied)')
    const aloneFailed = Object.entries(sd.order.standalone).filter(([, v]) => !v.ok).map(([f]) => f)
    is(aloneFailed.every((f) => f === 'crm.mysql.sql'), 'every migration applies on schema.mysql.sql alone, except the known crm.mysql.sql', aloneFailed.join(',') || 'all of them (the crm patch is applied)')
    is(sd.order.shuffles.every((s) => s.failed.every((x) => x.file === 'crm.mysql.sql') && s.diff_vs_tooling.length === 0), 'every shuffled order ends in the same schema; the only first-pass failure is crm.mysql.sql, and a retry repairs it')
    is(sd.apply.live_dump?.[0]?.ok === true && !!sd.diffs.live_vs_tooling, 'the production structure dump of 2026-11-01 loads and is compared', `${sd.diffs.live_vs_tooling?.length} differences`)

    const real = await A.runAudit({ inst, schemaDiff: sd })
    real.findings = A.buildFindings(real)
    const KNOWN_GUARDED = new Set(['birthday', 'birthday_set_at', 'birthday_sent_year', 'last_login_at', 'updated_at'])
    is(real.explain.failed === 0, 'MariaDB refuses no statement the code has not guarded', real.explain.failed_list.map((f) => `${f.file}:${f.line}`).join(' '))
    const guardedCols = new Set(real.explain.guarded_list.flatMap((g) => g.guarded.map((e) => e.guard)))
    is([...guardedCols].every((c) => KNOWN_GUARDED.has(c)), 'every guarded statement is one of the documented ones', [...guardedCols].join(','))
    is(real.statements.total >= 300 && real.statements.variants >= real.statements.total, 'the extractor still sees the whole code base', `${real.statements.total} statements, ${real.statements.variants} expansions`)
    is(real.statements.unresolved.every((u) => /db-pool|sporta_close_unsent|cron-fulfilment|abandoned/.test(u.file + u.func)), 'only the connection pool, a cron helper and abandoned.php (SQL assembled by functions) stay unresolved', real.statements.unresolved.map((u) => `${u.file}:${u.line}`).join(' '))
    is(real.explain.unverified === real.explain.unverified_list.length && real.explain.unverified_list.every((u) => /abandoned/.test(u.file)), 'a statement the expander cannot finish is listed as unverified, not raised as wrong', real.explain.unverified_list.map((u) => `${u.file}:${u.line}`).join(' '))
    is(real.explain_hardened && Array.isArray(real.explain_hardened.new_failures), 'the statements were also run under the hardened sql_mode of ops/db/sporta-db-hardening.cnf', `${real.explain_hardened?.new_failures?.length} refused only by the hardened mode`)
    is(real.insert_gaps.length === 0, 'no INSERT leaves a NOT NULL column without a default out')
    is(real.literal_fits.length === 0, 'no literal assigned in SQL is longer than its column')
    is(real.columns.length >= 290 && real.columns.every((c) => ['used', 'write_only', 'structural_write_only', 'structural_only', 'named_only', 'read_only_db_assigned', 'read_only_external', 'dead'].includes(c.class)), 'every column of the schema is classified', `${real.columns.length} columns`)
    is(!real.columns.some((c) => c.class === 'read_only_external'), 'no column is read that nothing writes and that has no default')
    const must = (t, c, cls) => real.columns.find((x) => x.table === t && x.column === c)?.class === cls
    is(must('reviews', 'comment', 'write_only') && must('admin_password_resets', 'request_ip', 'write_only'), 'the documented write-only columns are still found (reviews.comment, *.request_ip)')
    is(must('discounts', 'value', 'used') && must('hero_slides', 'image', 'used') && must('discounts', 'min_order', 'used'), 'columns written through a dynamic $fields array count as written (discounts.value, hero_slides.image)')
    const cap = (t, c) => real.caps.find((x) => x.table === t && x.column === c)
    // the defects the audit documents: either present, or fixed by the patches (then the cap is a rejecting one)
    const catCap = cap('products', 'category')
    is(catCap && (catCap.verdict === 'exceeds' || catCap.verdict === 'fits'), 'products.category is checked (store_opt 280 in front of varchar(40), or the capped patch)', catCap?.verdict)
    is(real.caps.some((x) => x.table === 'orders' && x.column === 'customer_name' && x.verdict === 'fits'), 'orders.customer_name: store_text(..., 80) fits varchar(80)')
    is(real.caps.some((x) => x.table === 'orders' && x.column === 'payment_method' && x.verdict === 'fits'), 'a whitelisted value (payment_method in STORE_PAY_METHODS) is measured against the longest member')
    const sev = { high: 0, medium: 0, low: 0 }; for (const f of real.findings) sev[f.severity]++
    is(real.findings.length > 0 && real.findings.every((f) => f.id && f.severity && f.kind && f.fix && f.evidence && f.cause), 'every finding carries id, severity, kind, evidence, cause and fix', `${real.findings.length} findings: ${JSON.stringify(sev)}`)
  }

  // ------------------------------------------------------------------------------------- routes
  if (!NO_ROUTES) {
    head('3b. the real routes on a private stack')
    const snap = JSON.parse(JSON.stringify(await D.snapshot(inst, 'none').catch(() => ({}))))
    await D.freshDb(inst, 'caps_snap'); D.applyAll(inst, 'caps_snap', D.toolingOrder(D.sqlInventory(D.SQLDIR)), D.SQLDIR)
    const realSnap = await D.snapshot(inst, 'caps_snap')
    const P = await A.probeRoutes({ snap: realSnap, only: ['order.customer.name', 'product.category'], tree: process.env.DBCOLS_TREE || null, numeric: false, snapshotCase: false })
    if (P.skipped) ok('route probe skipped', P.skipped)
    else {
      const name = P.cases.find((c) => c.id === 'order.customer.name')
      is(name.modes.strict.accepts_up_to === 80 && name.modes.strict.outcome_just_above.cls === 'reject' && name.modes.lax.accepts_up_to === 80, 'POST ?r=order: the longest accepted customer name is 80 characters in both sql_modes (the PHP cap equals the column)', J(name.modes.strict.outcome_just_above))
      const cat = P.cases.find((c) => c.id === 'product.category')
      const above = cat.modes.strict.outcome_just_above
      is(cat.modes.strict.accepts_up_to === 40 && above && (above.cls === 'db_error' || above.cls === 'reject'), 'product_save: a 41-character category is refused under strict mode (HTTP 500 today, a named 400 once the cap patch is applied)', J(above))
      if (above.cls === 'db_error') is(cat.modes.lax.accepts_up_to > 40 && cat.modes.lax.outcome_at_max.stored === 40, 'and under a lax sql_mode the same save returns 200 and silently stores 40 characters', J(cat.modes.lax.outcome_at_max))
      else ok('lax-mode truncation not reachable: the cap patch rejects first')
    }
    await inst.sql('drop database if exists caps_snap')
  }

  // ------------------------------------------------------------------------------------- 4. mutation
  head('4. mutation: blind each detector in a copy of the tool, the fixture must stop reporting its defect')
  const MUT = join(FX, 'mut')
  const copyTool = (name, edits) => {
    const root = join(MUT, name)
    mkdirSync(join(root, 'scripts/lib'), { recursive: true })
    for (const f of ['db-columns-audit.mjs', 'db-schema-diff.mjs']) cpSync(join(HERE, f), join(root, 'scripts', f))
    cpSync(join(HERE, 'lib/private-mariadb.mjs'), join(root, 'scripts/lib/private-mariadb.mjs'))
    for (const [file, from, to] of edits) {
      const p = join(root, 'scripts', file)
      const src = readFileSync(p, 'utf8')
      if (!src.includes(from)) throw new Error(`mutant ${name}: the text to blind is gone from ${file}: ${from.slice(0, 60)}`)
      writeFileSync(p, src.replace(from, to))
    }
    return root
  }
  const MUTANTS = [
    { name: 'explain-blind', edits: [['db-columns-audit.mjs', 'for (const m of (r.stderr || \'\').matchAll(', 'for (const m of \'\'.matchAll(']], gone: (R) => !has(R, (f) => f.column === 'ghost_col'), what: 'MariaDB errors are never read, so the missing column goes unseen' },
    { name: 'dead-blind', edits: [['db-columns-audit.mjs', "if (!w.length && !read && !filtered && !sr.length) cls =", "if (false) cls ="]], gone: (R) => !has(R, (f) => f.column === 'legacy_flag' && /no statement, SQL file, PHP string/.test(f.evidence)), what: 'no column is ever dead' },
    { name: 'write-only-blind', edits: [['db-columns-audit.mjs', "else if (w.length && !read && !filtered) cls =", "else if (false) cls ="]], gone: (R) => !has(R, (f) => f.column.includes('secret_log')), what: 'no column is ever write-only' },
    { name: 'cap-blind', edits: [['db-columns-audit.mjs', "} else if (bound > it.column_chars) { verdict = 'exceeds'", "} else if (false) { verdict = 'exceeds'"]], gone: (R) => !has(R, (f) => f.column === 'title' && /100/.test(f.evidence)), what: 'a cap longer than its varchar passes' },
    { name: 'insert-gap-blind', edits: [['db-columns-audit.mjs', 'if (missing.length) out.push', 'if (false) out.push']], gone: (R) => !has(R, (f) => f.table === 'orders_fx' && f.kind === 'nullability-default'), what: 'a missing NOT NULL column in an INSERT passes' },
    { name: 'literal-blind', edits: [['db-columns-audit.mjs', 'if (c !== null && n > c) out.push', 'if (c !== null && n > c + 100000) out.push']], gone: (R) => !has(R, (f) => f.column === 'title' && /literal/.test(f.evidence)), what: 'a too-long literal passes' },
    { name: 'guard-blind', edits: [['db-columns-audit.mjs', 'if (g.column_exists_in_schema || g.column_exists_with_addons) continue', 'continue']], gone: (R) => !has(R, (f) => f.column === 'phantom'), what: 'a guard on a column nothing creates passes' },
    { name: 'second-pass-blind', edits: [['db-schema-diff.mjs', "res.apply.second_pass = applyAll(inst, 'v_tooling', toolingOrder(inv), dir)", 'res.apply.second_pass = []']], gone: (R) => !has(R, (f) => /b-bad/.test(f.evidence) && /second time/.test(f.evidence)), what: 'a non-idempotent migration passes (the second run is never made)' },
    { name: 'shuffle-blind', edits: [['db-schema-diff.mjs', 'const failed = first.filter((r) => !r.ok)', 'const failed = []']], gone: (R) => !has(R, (f) => /d-needs/.test(f.evidence)), what: 'an ordering dependency passes (shuffled failures are discarded)' },
    { name: 'diff-type-blind', edits: [['db-schema-diff.mjs', "for (const k of ['type', 'null', 'def', 'cs',", "for (const k of ['null', 'def', 'cs',"]], unit: true, what: 'a column type difference between two schemas passes' },
  ]
  // the unit-level mutant uses two hand-made snapshots
  const snapA = { t: { engine: 'InnoDB', collation: 'c', columns: { a: { type: 'int(11)', null: 'NO', def: null, cs: null, coll: null, extra: '', gen: '' } }, order: ['a'], indexes: {}, fks: {}, checks: {} } }
  const snapB = JSON.parse(J(snapA)); snapB.t.columns.a.type = 'bigint(20)'
  is(D.diffSnapshots(snapA, snapB).some((d) => d.issue === 'differs:type'), 'unmutated: a changed column type is a difference')
  for (const m of MUTANTS) {
    let root
    try { root = copyTool(m.name, m.edits) } catch (e) { bad(`mutant ${m.name} could not be built`, e.message); continue }
    const lib = { A: await import(pathToFileURL(join(root, 'scripts/db-columns-audit.mjs')).href), D: await import(pathToFileURL(join(root, 'scripts/db-schema-diff.mjs')).href) }
    if (m.unit) {
      is(!lib.D.diffSnapshots(snapA, snapB).some((d) => d.issue === 'differs:type'), `mutant ${m.name}: ${m.what}`, 'detector blinded -> the difference disappears')
      continue
    }
    const M = await fixtureRun(lib, `mut-${m.name}`)
    is(m.gone(M), `mutant ${m.name}: ${m.what}`, 'detector blinded -> the finding disappears')
  }
  // the unmutated control: every finding the mutants looked for is present
  is(MUTANTS.filter((m) => !m.unit).every((m) => !m.gone(R)), 'control: with every detector intact, none of the mutants\' targets is missing')
} finally {
  try { inst?.stop() } catch { /* gone */ }
  try { rmSync(FX, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log(fails ? `\n${fails} problem(s) in the column audit` : '\ndb-columns-audit: the defects are found, the right statements are not flagged, every detector is mutation-proof')
process.exit(fails ? 1 : 0)
