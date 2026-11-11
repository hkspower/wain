// The Database center backend (dropin/php-store/dbcenter.php, admin.php routes db_center and db_integrity).
//
//   npm run test:db-center      (private MariaDB + PHP; never touches the shared rig, a config.php or the network)
//
// What is proved:
//   1. static rules: the file is read-only by construction (no write verbs in any SQL string, no file writes, no shell), has no
//      dynamic SQL, never names a credential; the manifest and grants.sql are current; admin.php wires both routes below the
//      administrator gate, GET only, throttled, handing over one config key and not the whole config;
//   2. the overview on a database built from the repo's own migrations: every table with rows, bytes and engine, every migration
//      "applied", nothing missing, sizes that add up, exact counts equal to count(*), health indicators judged;
//   3. drift is seen: a dropped column makes its migration "partial" and names the column, a dropped table makes its migration
//      "missing" and is listed, a table that is not the repo's is listed as "other";
//   4. integrity: every check passes on a clean database, and each is made to fail on purpose (orphan lines, orphan products,
//      negative stock, stock against the ledger, paid order whose stock was put back, stuck claims, orphan and stuck outbox rows,
//      orders with no warehouse message) with the exact count; a check whose table is missing says "skip", not "pass";
//   5. read only: with an account that has SELECT and nothing else the whole thing works (and says "unknown" where the account
//      cannot see), the tables' checksums are unchanged, and the server's Com_insert/update/delete/replace counters do not move;
//   6. nothing leaks: the answers contain no socket path, database name, user, password, host or SQL text, and a driver error is a code;
//   7. backup status: ok / stale / failing / never / garbage / absent, from the one small file, and only what matches its strict
//      line formats is shown (a line with a secret in it is not echoed);
//   8. the routes, over HTTP on php -S: no session -> 401, a session without the header -> 400, POST -> 405, a signed-in admin gets
//      the JSON, and a second signed-in call to db_integrity works;
//   9. MUTATION: with the migration status forced to "applied", with the count of one check wrong, and with a write statement added,
//      the suite fails (it is not green because it asserts nothing).
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { startPrivateMariadb, toolsPresent } from './lib/private-mariadb.mjs'
import { applyAll, installParts, sqlInventory, toolingOrder, freshDb } from './db-schema-diff.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PHPDIR = join(ROOT, 'dropin/php-store')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SRC = readFileSync(join(PHPDIR, 'dbcenter.php'), 'utf8')
const ADMIN = readFileSync(join(PHPDIR, 'admin.php'), 'utf8')

// ------------------------------------------------------------------------------------------ 1 static rules
head('1. static rules')
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ [^\n'"]*$/gm, '')
  const code = stripComments(SRC)
  // every SQL-looking string literal
  // every string that is SQL: lowercase statements in this file, and any capitalised one that is shaped like a write
  const sqls = [...code.matchAll(/(["'])((?:(?:select|show|set)\b|(?:insert into|update \w+ set|delete from|replace into|alter table|drop (?:table|database|user)|create (?:table|user|database|index|trigger|view)|truncate|grant |revoke |kill |lock tables|unlock tables|load data|call |rename table)\b)(?:(?!\1)[\s\S])*?)\1/gi)].map((m) => m[2])
  is(sqls.length >= 25, `found the SQL strings (${sqls.length})`)
  const verbs = sqls.map((s) => s.trim().split(/\s+/)[0].toLowerCase())
  const writes = verbs.filter((v) => !['select', 'show', 'set'].includes(v))
  is(writes.length === 0, 'every statement is a SELECT, a SHOW, or the SET SESSION time limit', writes.join(','))
  const sets = sqls.filter((s) => /^set\b/i.test(s.trim()))
  is(sets.length > 0 && sets.every((s) => /^set session (max_statement_time|max_execution_time) = \d+$/i.test(s.trim())), 'the only SET statements are the session statement time limit', sets.join(' | '))
  is(!/\b(into\s+outfile|into\s+dumpfile|load_file|sleep\s*\(|benchmark\s*\(|for\s+update|lock\s+in\s+share)\b/i.test(sqls.join('\n')), 'no file, sleep, benchmark or locking read in any statement')
  is(!/\$db->(exec|prepare)\([^)]*\$/.test(code.replace(/\$db->exec\('set session[^']*'\)/g, '')), 'no statement is built from a variable (no dynamic SQL)')
  is(!/(file_put_contents|fopen\s*\(|unlink|rename\s*\(|mkdir|chmod|exec\s*\(|shell_exec|passthru|proc_open|popen|system\s*\(|eval\s*\(|curl_|\$_POST|\$_REQUEST|\$_COOKIE|\$_FILES)/.test(code.replace(/\$db->exec\(/g, '')), 'no file write, shell, network or request input in the file')
  is(!/(db_pass|db_user|db_host|db_name|password|secret|token|api_key|\$_SERVER)/i.test(code), 'the file never names a credential, a host or the request')
  is(/file_get_contents\(\$path, false, null, 0, 2048\)/.test(code) && (code.match(/file_get_contents/g) || []).length === 1, 'the only file it reads is the backup status file, at most 2 KiB')
}
{
  const g = spawnSync(process.execPath, [join(ROOT, 'scripts/make-dbcenter-manifest.mjs'), '--check'], { encoding: 'utf8' })
  is(g.status === 0, 'dbcenter-manifest.php is current (node scripts/make-dbcenter-manifest.mjs --check)', g.stderr)
  const k = spawnSync(process.execPath, [join(ROOT, 'ops/db/make-grants.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT })
  is(k.status === 0, 'grants.sql is current (node ops/db/make-grants.mjs --check)', (k.stdout + k.stderr).trim().slice(0, 200))
  const lp = readFileSync(join(ROOT, 'scripts/db-least-privilege-test.mjs'), 'utf8')
  is(/'dbcenter\.php'/.test(lp) && /'dbcenter-manifest\.php'/.test(lp), 'dbcenter.php is classified as a library in the least-privilege suite')
  const man = readFileSync(join(PHPDIR, 'dbcenter-manifest.php'), 'utf8')
  is(/^<\?php\n\/\/ GENERATED/.test(man) && !/(select|insert|update|delete)\s/i.test(man.replace(/\/\/.*$/gm, '')), 'the manifest is names only')
  const at = ADMIN.indexOf("if ($r === 'db_center' || $r === 'db_integrity')")
  const gate = ADMIN.indexOf('$admin = store_require_admin();')
  const blk = at > 0 ? ADMIN.slice(at, ADMIN.indexOf('\n}\n', at) + 3) : ''
  is(gate > 0 && at > gate, 'both routes sit below the administrator gate')
  is(/\$method !== 'GET'\) store_fail\('method_not_allowed', 405\)/.test(blk), 'GET only (405 otherwise)')
  is(/store_throttle\(\$db, 'db_center'/.test(blk), 'throttled')
  is(/store_config\(\)\['db_backup_status_file'\]/.test(blk) && !/dbcenter_overview\(\$db, store_config\(\)\)/.test(blk), 'only the one config key is handed over')
  is(!/'db_center'|'db_integrity'/.test(ADMIN.slice(ADMIN.indexOf('$activityActions'), ADMIN.indexOf('];', ADMIN.indexOf('$activityActions')))), 'not a write action (it is not in the activity log list)')
  is(/catch \(PDOException \$e\) \{\s*store_fail\('db_center_unavailable', 503\)/.test(blk), 'a database error is a fixed 503 token, never the driver message')
}

// ------------------------------------------------------------------------------------------ private database
const tp = toolsPresent()
const phpOk = spawnSync('php', ['-v']).status === 0
if (tp.missing.length || !phpOk) { console.log(`\nSKIP the database part: missing ${[...tp.missing, ...(phpOk ? [] : ['php'])].join(', ')}`); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) }

const work = mkdtempSync(join(tmpdir(), 'db-center-'))
const inst = await startPrivateMariadb({ label: 'dc', portFrom: 33820 })
const DB = 'dcdb_' + randomBytes(3).toString('hex')
const ROPASS = randomBytes(18).toString('base64url')
let httpServer = null

try {
  const inv = sqlInventory(PHPDIR)
  await freshDb(inst, DB)
  const res = applyAll(inst, DB, toolingOrder(inv), PHPDIR)
  const bad = res.filter((r) => !r.ok)
  is(bad.length === 0, `the repo's migrations apply on a fresh database (${res.length} files)`, bad.map((b) => `${b.file}: ${b.message}`).join('; '))
  await inst.sql(`create user 'dc_ro'@'localhost' identified by '${ROPASS}'; grant select on \`${DB}\`.* to 'dc_ro'@'localhost'; flush privileges`)

  // the harness: connects, requires the file under test, prints JSON
  const stage = join(work, 'stage'); mkdirSync(stage)
  copyFileSync(join(PHPDIR, 'dbcenter.php'), join(stage, 'dbcenter.php'))
  copyFileSync(join(PHPDIR, 'dbcenter-manifest.php'), join(stage, 'dbcenter-manifest.php'))
  const harness = join(work, 'harness.php')
  writeFileSync(harness, `<?php
declare(strict_types=1);
$a = json_decode((string)getenv('HARNESS'), true);
require $a['dir'] . '/dbcenter.php';
$db = new PDO('mysql:unix_socket=' . $a['sock'] . ';dbname=' . $a['db'] . ';charset=utf8mb4', $a['user'], (string)getenv('HARNESS_PASS'),
  [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
$out = [];
if ($a['mode'] === 'overview') $out = dbcenter_overview($db, $a['cfg'] ?? [], $a['now'] ?? null);
elseif ($a['mode'] === 'integrity') $out = dbcenter_integrity($db);
elseif ($a['mode'] === 'backup') $out = dbcenter_backup($a['cfg'] ?? [], $a['now'] ?? null);
echo json_encode($out);
`)
  const php = (mode, extra = {}, { dir = stage, user = 'root', pass = '' } = {}) => {
    const r = spawnSync('php', [harness], { encoding: 'utf8', env: { ...process.env, HARNESS: JSON.stringify({ mode, dir, sock: inst.sock, db: DB, user, ...extra }), HARNESS_PASS: pass } })
    if (r.status !== 0) return { error: (r.stderr + r.stdout).slice(0, 400) }
    try { return JSON.parse(r.stdout) } catch { return { error: r.stdout.slice(0, 300) } }
  }
  const sql = (q) => inst.sql(q, DB)
  // a mutant: the file under test with one protection taken out, staged in its own folder
  const mutant = (label, from, to) => {
    const dir = join(work, 'mut-' + label.replace(/\W+/g, '-')); mkdirSync(dir, { recursive: true })
    const src = readFileSync(join(PHPDIR, 'dbcenter.php'), 'utf8')
    if (!src.includes(from)) { is(false, `mutant "${label}" no longer matches the source`); return dir }
    writeFileSync(join(dir, 'dbcenter.php'), src.replace(from, to))
    copyFileSync(join(PHPDIR, 'dbcenter-manifest.php'), join(dir, 'dbcenter-manifest.php'))
    return dir
  }

  // ---------------------------------------------------------------------------------------- 2 the overview
  head('2. the overview, on the repo\'s own schema')
  await sql(`insert into products (slug, name_en, name_ar, price, category, active) values ('p-one','One','واحد',10.5,'tops',1),('p-two','Two','اثنان',20,'tops',1),('p-three','Three','ثلاثة',5,'shoes',0)`)
  await sql(`insert into product_variants (sku, slug, size, stock) values ('P1-M','p-one','M',5),('P1-L','p-one','L',3),('P2-M','p-two','M',0)`)
  await sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name) values ('T1',10.5,'paid','knet','unfulfilled','A'),('T2',20,'pending','cod','unfulfilled','B'),('T3',5,'failed','knet','unfulfilled','C')`)
  await sql(`insert into order_items (order_id, product_id, qty, unit_price, size) select o.id, p.id, 1, p.price, 'M' from orders o join products p on p.slug = 'p-one' where o.track_id in ('T1','T2','T3')`)
  await sql(`insert into fulfilment_outbox (order_id, kind, payload, sent_at) select id, 'new', '{}', now() from orders where track_id = 'T1'`)
  await sql(`insert into fulfilment_outbox (order_id, kind, payload, sent_at) select id, 'new', '{}', now() from orders where track_id = 'T2'`)
  await sql(`insert into fulfilment_outbox (order_id, kind, payload, sent_at) select id, 'new', '{}', now() from orders where track_id = 'T3'`)
  await sql('analyze table orders, order_items, products, product_variants')
  const ov = php('overview')
  is(!ov.error, 'the overview runs on a real MariaDB', ov.error)
  const names = (ov.tables || []).map((t) => t.name)
  for (const t of ['orders', 'order_items', 'products', 'product_variants', 'inventory_movements', 'fulfilment_outbox', 'settings']) is(names.includes(t), `table listed: ${t}`)
  is(ov.totals?.tables === names.length && ov.totals.tables >= 29, `totals.tables = number listed (${ov.totals?.tables})`)
  is((ov.tables || []).every((t) => t.total_bytes === t.data_bytes + t.index_bytes && t.total_bytes > 0 && typeof t.engine === 'string'), 'every table has an engine and sizes that add up')
  is(ov.totals?.bytes === (ov.tables || []).reduce((a, t) => a + t.total_bytes, 0), 'totals.bytes is the sum')
  const sorted = (ov.tables || []).every((t, i, a) => i === 0 || a[i - 1].total_bytes >= t.total_bytes)
  is(sorted, 'tables are listed largest first')
  const real = {}
  for (const t of ['orders', 'order_items', 'products', 'product_variants', 'inventory_movements', 'customer_accounts', 'fulfilment_outbox']) real[t] = Number(await sql(`select count(*) from ${t}`))
  is(JSON.stringify(ov.counts) === JSON.stringify(real) && real.orders === 3 && real.fulfilment_outbox === 3, 'exact counts equal count(*)', JSON.stringify(ov.counts) + ' vs ' + JSON.stringify(real))
  is(ov.counts?.inventory_movements === 0, 'a table with no rows counts 0, not null')
  is((ov.tables || []).find((t) => t.name === 'orders')?.in_repo === true, 'repo tables are marked in_repo')
  is(ov.schema?.manifest === true && ov.schema.migrations_total >= 25, `the manifest lists the migrations (${ov.schema?.migrations_total})`)
  is(ov.schema?.migrations_applied === ov.schema?.migrations_total && ov.schema?.missing_tables.length === 0, 'on a freshly migrated database every migration is applied and no table is missing', JSON.stringify((ov.schema?.migrations || []).filter((m) => m.status !== 'applied').map((m) => m.file + ':' + m.status)))
  is(/MariaDB|^[0-9]/.test(ov.server?.version || ''), 'server version is shown: ' + ov.server?.version)
  const ind = Object.fromEntries((ov.health?.indicators || []).map((i) => [i.key, i]))
  is(ind.connections?.status === 'ok' && ind.threads_running && ind.slow_queries && ind.lock_waits_now?.status === 'ok', 'health indicators are present and judged', Object.keys(ind).join(','))
  is(ind.lock_graph?.status === 'unknown' || ind.lock_graph?.status === 'ok', 'lock graph is judged or unknown, never invented')
  is(ov.backup?.state === 'not_reported' && /unknown, not fine/.test(ov.backup.note), 'no backup status file: "not reported", and it says unknown, not fine')

  // ---------------------------------------------------------------------------------------- 3 drift
  head('3. drift is seen')
  await sql('alter table orders drop index idx_orders_stock_sweep, drop column stock_claimed')
  await sql('drop table whatsapp_outbox')
  await sql('drop table abandoned_followup')
  await sql('create table legacy_junk (id int primary key)')
  const dr = php('overview')
  const mig = Object.fromEntries((dr.schema?.migrations || []).map((m) => [m.file, m]))
  is(mig['stock.mysql.sql']?.status === 'partial' && mig['stock.mysql.sql'].missing_columns.includes('orders.stock_claimed'), 'a dropped column makes its migration "partial" and names it', JSON.stringify(mig['stock.mysql.sql']))
  is(mig['abandoned.mysql.sql']?.status === 'missing' && mig['abandoned.mysql.sql'].missing_tables.includes('abandoned_followup'), 'a dropped table makes its migration "missing"')
  is(mig['whatsapp.mysql.sql']?.status === 'partial' && mig['whatsapp.mysql.sql'].missing_tables.includes('whatsapp_outbox'), 'whatsapp.mysql.sql is "partial" (its orders column is still there) and names the table')
  is(dr.schema?.missing_tables.includes('abandoned_followup') && dr.schema.missing_tables.includes('whatsapp_outbox'), 'missing tables are listed')
  is(dr.schema?.other_table_names.includes('legacy_junk') && (dr.tables || []).find((t) => t.name === 'legacy_junk')?.in_repo === false, 'a table that is not the repo\'s is listed as "other"')
  const brokenNow = (dr.schema?.migrations || []).filter((m) => m.status !== 'applied').map((m) => m.file).sort()
  console.log('     (not applied after the three drops: ' + brokenNow.join(', ') + ')')
  is(['abandoned.mysql.sql', 'stock.mysql.sql', 'whatsapp.mysql.sql'].every((f) => brokenNow.includes(f)) && brokenNow.length <= 5 && dr.schema?.migrations_applied === dr.schema?.migrations_total - brokenNow.length, 'the three broken migrations (and only migrations that share their tables or columns) are not applied', brokenNow.join(','))
  const mApplied = mutant('applied', "$status = $total === 0 ? 'applied' : (!$missT && !$missC ? 'applied' : ($have === 0 ? 'missing' : 'partial'));", "$status = 'applied';")
  const dm = php('overview', {}, { dir: mApplied })
  is(dm.schema?.migrations_applied === dm.schema?.migrations_total, 'MUTANT: with the status forced to "applied" the drift assertions above would fail (the suite is not vacuous)')
  // put it back
  await sql('drop table legacy_junk')
  for (const f of ['stock.mysql.sql', 'whatsapp.mysql.sql', 'abandoned.mysql.sql']) is(applyAll(inst, DB, [f], PHPDIR)[0].ok, `re-applied ${f}`)
  const back = php('overview')
  is(back.schema?.migrations_applied === back.schema?.migrations_total, 'after re-applying them the overview is clean again')

  // ---------------------------------------------------------------------------------------- 4 integrity
  head('4. integrity checks')
  const chk = (r) => Object.fromEntries((r.checks || []).map((c) => [c.key, c]))
  let ig = php('integrity')
  is(!ig.error && ig.checks?.length === 13, 'thirteen checks run', ig.error || String(ig.checks?.length))
  let c = chk(ig)
  const baseActive = c.active_without_variants?.count ?? 0
  is((ig.checks || []).every((x) => x.status === 'pass' || x.status === 'info'), 'clean database: no check fails or warns', JSON.stringify((ig.checks || []).filter((x) => x.status !== 'pass').map((x) => x.key + ':' + x.status + ':' + x.count)))
  // plant each problem
  await sql('set foreign_key_checks = 0; insert into order_items (order_id, product_id, qty, unit_price) values (99999, (select min(id) from products), 1, 1), ((select min(id) from orders), 88888, 1, 1)')
  await sql(`insert into product_variants (sku, slug, size, stock) values ('GHOST-M','no-such-product','M',2)`)
  await sql('alter table product_variants drop constraint variants_stock_ck')
  await sql(`update product_variants set stock = -4 where sku = 'P2-M'`)
  await sql(`insert into products (slug, name_en, name_ar, price, active) values ('p-novariants','NV','بدون',3,1)`)
  await sql(`insert into orders (track_id, amount, payment_status, payment_method, stock_claimed, stock_released, created_at) values ('PAIDREL',9,'paid','knet',1,1,now()),('STUCK',9,'pending','knet',1,0,now() - interval 5 day),('NOMSG',9,'pending','cod',0,0,now())`)
  await sql(`insert into fulfilment_outbox (order_id, kind, payload, created_at) select id, 'new', '{}', now() - interval 3 hour from orders where track_id = 'STUCK'`)
  await sql(`set foreign_key_checks = 0; insert into fulfilment_outbox (order_id, kind, payload) values (77777, 'new', '{}')`)
  await sql(`insert into inventory_movements (sku, type, before_stock, after_stock, delta, before_low_stock_threshold, after_low_stock_threshold, inventory_version, note, actor_email) values ('P1-M','count',4,5,1,2,2,1,'seed','t@t')`)
  await sql(`update product_variants set stock = 9 where sku = 'P1-M'`)                                  // the ledger says 5, the shelf says 9
  await sql('alter table inventory_movements drop foreign key inventory_movement_variant_fk')
  await sql(`insert into inventory_movements (sku, type, before_stock, after_stock, delta, before_low_stock_threshold, after_low_stock_threshold, inventory_version, note, actor_email) values ('NOPE-X','count',0,1,1,2,2,1,'orphan','t@t')`)
  await sql('set foreign_key_checks = 1')
  ig = php('integrity'); c = chk(ig)
  const want = { items_orphan_order: ['fail', 1], items_orphan_product: ['fail', 1], variants_orphan_product: ['warn', 1], variants_negative_stock: ['fail', 1],
    active_without_variants: ['info', baseActive + 1], movements_orphan_sku: ['fail', 1], stock_vs_ledger: ['warn', 1], paid_stock_released: ['fail', 1], stuck_stock_claims: ['warn', 1],
    outbox_orphan: ['fail', 1], outbox_stuck: ['warn', 1] }
  for (const [k, [st, n]] of Object.entries(want)) is(c[k]?.status === st && c[k].count === n, `${k}: ${st}, count ${n}`, JSON.stringify(c[k]))
  is(c.orders_without_items?.status === 'warn' && c.orders_without_items.count === 3, 'orders_without_items sees the planted orders', JSON.stringify(c.orders_without_items))
  is(c.outbox_missing_new?.status === 'warn' && c.outbox_missing_new.count === 2, 'outbox_missing_new sees the order with no warehouse message', JSON.stringify(c.outbox_missing_new))
  is(ig.overall === 'fail', 'the overall verdict is "fail" when a failing check fails')
  is((ig.checks || []).every((x) => !/select|from |where/i.test(x.detail)), 'no SQL text in any detail')
  const mInt = mutant('pass-on-rows', "$row['status'] = $n === 0 ? 'pass'", "$row['status'] = $n > 0 ? 'pass'")
  const mi = chk(php('integrity', {}, { dir: mInt }))
  is(mi.items_orphan_order?.status !== 'fail' && mi.stock_vs_ledger?.status !== 'warn', 'MUTANT: with the verdict inverted the planted problems are no longer reported as failures')
  // a missing table is a skip, not a pass
  await sql('drop table fulfilment_outbox')
  ig = php('integrity'); c = chk(ig)
  is(c.outbox_orphan?.status === 'skip' && c.outbox_orphan.count === null && /fulfilment_outbox/.test(c.outbox_orphan.detail), 'a check whose table is missing says "skip" and names the table, never "pass"')
  is(c.items_orphan_order?.status === 'fail', 'the other checks still run')
  // an unknown column is a skip too
  await sql('alter table orders drop column stock_released')
  ig = php('integrity'); c = chk(ig)
  is(c.paid_stock_released?.status === 'skip' && /orders\.stock_released/.test(c.paid_stock_released.detail), 'a missing column is a skip that names the column')

  // ---------------------------------------------------------------------------------------- 5 read only
  head('5. read only, with the least privilege that works')
  const cs = async () => {
    const tabs = (await sql(`select table_name from information_schema.tables where table_schema = '${DB}' and table_type = 'BASE TABLE' order by 1`)).split('\n')
    return (await sql('checksum table ' + tabs.map((t) => '`' + t + '`').join(', '))).split('\n').map((l) => l.split('\t').slice(0, 2).join('=')).join(';')
  }
  const com = async () => (await inst.sql("show global status where variable_name in ('Com_insert','Com_update','Com_delete','Com_replace','Com_insert_select','Com_update_multi','Com_delete_multi','Com_alter_table','Com_create_table','Com_drop_table','Com_truncate','Com_grant','Com_kill')")).split('\n').filter((l) => !/^Com_(insert|update|delete)\b/.test(l) || true).join(';')
  const before = await cs(), comBefore = await com()
  const ro = php('overview', {}, { user: 'dc_ro', pass: ROPASS })
  const roI = php('integrity', {}, { user: 'dc_ro', pass: ROPASS })
  const after = await cs(), comAfter = await com()
  const mW = mutant('write', "$db->query('select count(*) from orders')", "$db->query('delete from orders where 1 = 0')")
  const comPre = await com(); php('overview', {}, { dir: mW }); const comPost = await com()
  is(!ro.error && !roI.error && ro.tables?.length > 10, 'an account with SELECT and nothing else gets the overview and the checks', ro.error || roI.error)
  is(before === after, 'every table\'s checksum is unchanged by both routes')
  is(comBefore === comAfter, 'no insert, update, delete, replace, alter, create, drop, truncate, grant or kill was counted by the server')
  is(comPre !== comPost, 'MUTANT: a write statement slipped into the file is counted by the server (the Com_* check can see it)')
  const roInd = Object.fromEntries((ro.health?.indicators || []).map((i) => [i.key, i]))
  is(roInd.lock_graph?.status === 'unknown' && roInd.lock_graph.value === null, 'without PROCESS, "who is blocking whom" is "unknown", not zero')
  is(roInd.longest_statement && (roInd.longest_statement.status === 'ok' || roInd.longest_statement.status === 'unknown'), 'the longest statement is judged for what the account can see')

  // ---------------------------------------------------------------------------------------- 6 nothing leaks
  head('6. nothing leaks')
  const blob = JSON.stringify([ro, roI, ov, dr])
  for (const [what, v] of [['socket path', inst.sock], ['database name', DB], ['read-only user', 'dc_ro'], ['password', ROPASS], ['data dir', inst.datadir], ['root', '"root"'], ['host', '127.0.0.1'], ['work dir', work]]) is(!blob.includes(v), `the answers do not contain the ${what}`)
  is(!/(insert into|update |delete from|select [a-z*(])/i.test(blob), 'the answers contain no SQL text')
  is(!/customer_name|"A"|"B"|"C"|"T[123]"|"STUCK"|"NOMSG"|"PAIDREL"|@t\.t/.test(JSON.stringify(ig)), 'the checks carry counts, not rows (no customer, track id or e-mail)')
  const dead = php('overview', {}, { user: 'dc_ro', pass: 'wrong' })
  is(!!dead.error && !/wrong/.test(dead.error.replace(/using password: YES/g, '')), 'a connection that fails fails outside the file under test')

  // ---------------------------------------------------------------------------------------- 7 backup status
  head('7. backup status')
  const NOW = 1_800_000_000
  const sfile = join(work, 'backup-status')
  const bk = (text) => { if (text === null) { try { rmSync(sfile) } catch { /* none */ } } else writeFileSync(sfile, text); return php('backup', { cfg: { db_backup_status_file: sfile }, now: NOW }) }
  const NAME = 'sporta-db-20270115T021701Z.sql.gz.enc'
  let b = bk(`ok ${NOW - 7200} 0 done\n${NOW - 7200} ${NAME}\n`)
  is(b.state === 'ok' && b.age_hours === 2 && b.file === NAME && b.last_success_at === new Date((NOW - 7200) * 1000).toISOString().replace('.000Z', 'Z'), 'fresh backup: ok, age 2 h, file name, UTC time', JSON.stringify(b))
  b = bk(`ok ${NOW - 50 * 3600} 0 done\n${NOW - 50 * 3600} ${NAME}\n`)
  is(b.state === 'stale' && b.age_hours === 50, 'older than 36 hours: stale')
  b = bk(`fail ${NOW - 60} 2 dump_failed\n${NOW - 3 * 3600} ${NAME}\n`)
  is(b.state === 'failing' && b.reason === 'dump_failed' && b.age_hours === 3, 'last run failed: failing, with the reason token and the age of the last good copy')
  b = bk('none 0 0 never_ran\n')
  is(b.state === 'never', 'never ran: never')
  b = bk(`password=hunter2\nsecret ${NOW}\nok ${NOW} 0 done\n../../etc/passwd\n`)
  is(b.state === 'not_reported' || (b.state === 'never' && !JSON.stringify(b).includes('hunter2')), 'garbage lines are ignored', JSON.stringify(b))
  is(!JSON.stringify(b).includes('hunter2') && !JSON.stringify(b).includes('passwd'), 'a line that does not match the strict formats is never echoed')
  b = bk(`ok ${NOW} 0 ../x\n${NOW} ../../key.enc\n`)
  is(b.state === 'not_reported' && b.file === null, 'a file name with a path in it is refused')
  b = bk(null)
  is(b.state === 'not_reported', 'no file: not reported')
  b = php('backup', { cfg: { db_backup_status_file: '/etc/shadow' }, now: NOW })
  is(b.state === 'not_reported', 'a file that is not a status file reads as nothing')
  b = php('backup', { cfg: { db_backup_status_file: work }, now: NOW })
  is(b.state === 'not_reported', 'a directory reads as nothing')

  // ---------------------------------------------------------------------------------------- 8 the routes
  head('8. the routes, over HTTP (php -S)')
  const site = join(work, 'site'); mkdirSync(site)
  cpSync(PHPDIR, join(site, 'api'), { recursive: true })
  rmSync(join(site, 'api/config.php'), { force: true })
  // the schema tables the earlier sections dropped are back for the route test
  for (const f of ['stock.mysql.sql']) applyAll(inst, DB, [f], PHPDIR)
  await sql('create table if not exists fulfilment_outbox like orders').catch(() => {})
  await sql('drop table if exists fulfilment_outbox')
  applyAll(inst, DB, ['schema.mysql.sql'], PHPDIR)
  const cfgFile = join(work, 'api-config.php')
  writeFileSync(cfgFile, `<?php\nreturn ['db_host' => '127.0.0.1;port=${inst.port}', 'db_name' => '${DB}', 'db_user' => 'root', 'db_pass' => '', 'session_secret' => '${randomBytes(16).toString('hex')}', 'admin_session_dir' => '${join(work, 'sess')}'];\n`)
  mkdirSync(join(work, 'sess'))
  const freePort = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
  httpServer = spawn('php', ['-S', `127.0.0.1:${freePort}`, '-t', site], { env: { ...process.env, SPORTA_API_CONFIG_FILE: cfgFile }, stdio: 'ignore' })
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${freePort}/api/admin.php?r=google_available`); break } catch { await sleep(150) } }
  const A = `http://127.0.0.1:${freePort}/api/admin.php`
  const call = async (route, { method = 'GET', headers = {}, cookie = '', body } = {}) => {
    const r = await fetch(`${A}?r=${route}`, { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
    const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* not json */ }
    return { status: r.status, json: j, text: t, set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] }
  }
  const pw = 'correct-horse-battery-kw'
  const hash = spawnSync('php', ['-r', `echo password_hash('${pw}', PASSWORD_BCRYPT);`], { encoding: 'utf8' }).stdout.trim()
  await sql(`insert into admin_users (email, password_hash) values ('dc-admin@sporta.test', '${hash}')`)
  for (const r of ['db_center', 'db_integrity']) {
    const anon = await call(r, { headers: { 'X-Sporta-Admin': '1' } })
    is(anon.status === 401, `${r}: no session -> 401`, String(anon.status) + ' ' + anon.text.slice(0, 120))
  }
  const login = await call('login', { method: 'POST', headers: { 'X-Sporta-Admin': '1' }, body: { email: 'dc-admin@sporta.test', password: pw } })
  const cookie = login.set.map((s) => s.split(';')[0]).join('; ')
  is(login.status === 200 && cookie.includes('='), 'the test admin signs in', String(login.status) + login.text.slice(0, 150))
  const noHdr = await call('db_center', { cookie })
  is(noHdr.status === 400, 'a session without the X-Sporta-Admin header -> 400', String(noHdr.status))
  const post = await call('db_center', { method: 'POST', cookie, headers: { 'X-Sporta-Admin': '1' }, body: {} })
  is(post.status === 405, 'POST -> 405', String(post.status))
  const okc = await call('db_center', { cookie, headers: { 'X-Sporta-Admin': '1' } })
  is(okc.status === 200 && Array.isArray(okc.json?.tables) && okc.json.tables.length > 10 && okc.json.backup && okc.json.schema?.migrations?.length > 20, 'a signed-in admin gets the overview', String(okc.status) + okc.text.slice(0, 120))
  is(!/"db_pass"|"db_user"|session_secret|127\.0\.0\.1/.test(okc.text) && !okc.text.includes(DB) && !okc.text.includes(cfgFile) && !okc.text.includes(work), 'the HTTP answer carries no config value, database name or path')
  is(/no-store/.test((await fetch(`${A}?r=db_center`, { headers: { Cookie: cookie, 'X-Sporta-Admin': '1' } })).headers.get('cache-control') || ''), 'the answer is Cache-Control: no-store')
  const igc = await call('db_integrity', { cookie, headers: { 'X-Sporta-Admin': '1' } })
  is(igc.status === 200 && igc.json?.checks?.length === 13 && ['pass', 'warn', 'fail', 'unknown'].includes(igc.json.overall), 'a signed-in admin gets the integrity checks', String(igc.status) + igc.text.slice(0, 120))
  const logRows = await sql("select count(*) from admin_activity_log where action_key in ('db_center','db_integrity')").catch(() => '0')
  is(logRows === '0', 'reading is not written to the activity log (nothing is written at all)')
  const exact = await call('db_center&x=' + 'a'.repeat(50), { cookie, headers: { 'X-Sporta-Admin': '1' } })
  is(exact.status === 200, 'an unknown extra query parameter is ignored')
} finally {
  try { httpServer?.kill() } catch { /* gone */ }
  inst.stop()
  rmSync(work, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
