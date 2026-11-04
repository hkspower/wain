// HOW THE PHP TALKS TO THE DATABASE, proved on a PRIVATE MariaDB and PHP (never the shared rig).
//
//   npm run test:db-connect            (KEEP=1 keeps the temp directory)
//
// It builds two copies of dropin/: BEFORE (as it is) and AFTER (ops/db/db-connect.patch applied), and runs the SAME probes
// against both, so every claim is a before/after pair, not an assertion about code that was only read.
//
//   1. The patch applies to the tree and passes php -l; the variant for a tree that already has lane D1's roles patch
//      applies on top of it. (Not the other way round: documented.)
//   2. Settings on every connection: ERRMODE_EXCEPTION, real prepared statements, utf8mb4 (SET NAMES on connect), a 5-second
//      connect timeout, one statement per call, no LOAD DATA LOCAL, a statement time limit by who is asking (15 s storefront,
//      30 s staff, 20 s payment, 120 s batch).
//   3. BEFORE: a stacked "select 1; drop table victim" runs and the table is gone. AFTER: it is a syntax error and the table survives.
//   4. BEFORE: a statement runs as long as it likes. AFTER: MariaDB aborts it (error 1969).
//   5. BEFORE: a database that accepts the connection and never answers holds the worker for the full default socket timeout.
//      AFTER: 5 seconds.
//   6. TLS: required for a remote host, refused (no connection attempted) without a CA; a real TLS link is negotiated and proven
//      with Ssl_cipher; a wrong CA fails closed; an explicit db_tls=off is the only way back to clear text.
//   7. Errors: a public request no longer learns WHICH credential is wrong; the staff scripts still do; an uncaught database
//      error now leaves a one-line summary (class, SQLSTATE, code) in the error log and never a table, a column or a value;
//      the payment-log text for a database exception is the same summary.
//   8. Regression: the public GET routes answer byte-for-byte the same before and after.
//   9. MUTATION CHECKS: drop the multi-statement option, the statement limit, the TLS refusal, or the staff-only cause: each makes
//      this suite fail.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, sleep, startPrivateMariadb, toolsPresent } from './lib/private-mariadb.mjs'
import { applyEdits } from '../ops/db/make-connect-patch.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const OPS = join(WEB, 'ops', 'db')
let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const info = (n, d = '') => console.log(`info ${n}${d ? `  - ${d}` : ''}`)
let tHead = Date.now()
const head = (t) => { const now = Date.now(); console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}  (+${Math.round((now - tHead) / 1000)}s)`); tHead = now }

{
  const { missing } = toolsPresent()
  if (missing.length || spawnSync('sh', ['-c', 'command -v php && command -v git && command -v openssl && command -v patch']).status !== 0) {
    console.log(`SKIP db-connect: ${missing.join(', ') || 'php, git, openssl or patch'} not installed. Nothing was tested.`)
    process.exit(0)
  }
}
const tmp = mkdtempSync(join(tmpdir(), 'sporta-dbconn-'))
const rnd = (n = 18) => randomBytes(n).toString('base64url').replace(/[-_]/g, 'x')
const PW = rnd(24)
const CANARY = `CNRY${randomBytes(4).toString('hex')}`

// ------------------------------------------------------------------ a TLS-capable private server
const tls = join(tmp, 'tls'); mkdirSync(tls)
const mkCert = (name) => spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  '-keyout', join(tls, `${name}.key`), '-out', join(tls, `${name}.crt`)], { stdio: 'ignore' })
mkCert('server'); mkCert('other')
let DB
try { DB = await startPrivateMariadb({ label: 'conn', portFrom: 33800, extraArgs: [`--ssl-cert=${join(tls, 'server.crt')}`, `--ssl-key=${join(tls, 'server.key')}`, '--local-infile=1', '--secure-file-priv='] }) } catch (e) { console.log(`SKIP db-connect: ${e.message}. Nothing was tested.`); process.exit(0) }
info('server', `${DB.version} on port ${DB.port}, TLS certificate generated for this run`)
await DB.sql('create database sporta character set utf8mb4 collate utf8mb4_unicode_ci')
DB.sqlFile(join(WEB, 'dropin', 'php-store', 'install.mysql.sql'), 'sporta')
await DB.sql(`create user 'app_c'@'127.0.0.1' identified by '${PW}'; grant all on sporta.* to 'app_c'@'127.0.0.1'; grant file on *.* to 'app_c'@'127.0.0.1'; flush privileges;`)
await DB.sql(`insert into products (slug,name_en,name_ar,price) values ('p-one','One','١',9.5); insert into product_variants (sku,slug,size,stock) values ('p-one-M','p-one','M',3); create table zz_victim (id int primary key); insert into zz_victim values (1); create table zz_load (line varchar(200));`, 'sporta')

// ------------------------------------------------------------------ the two trees
const mkTree = (name) => { const d = join(tmp, name); mkdirSync(d); cpSync(join(WEB, 'dropin'), join(d, 'dropin'), { recursive: true, filter: (x) => !/\/config\.php$/.test(x) }); return d }
const BEFORE = mkTree('before'), AFTER = mkTree('after')
head('1. The patch applies, lints, and the generated files are current')
{
  const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' })
  const chk = spawnSync('node', [join(OPS, 'make-connect-patch.mjs'), '--check'], { encoding: 'utf8' })
  is(chk.status === 0, '`make-connect-patch.mjs --check`: db-connect.patch and db-connect-after-roles.patch are what the generator produces from the current tree', chk.stdout.trim().split('\n').join(' | ').slice(0, 200))
  git(['init', '-q'], AFTER)
  const a = git(['apply', '--check', join(OPS, 'db-connect.patch')], AFTER)
  is(a.status === 0, 'db-connect.patch applies to a copy of dropin/', a.stderr.trim().slice(0, 200))
  git(['apply', join(OPS, 'db-connect.patch')], AFTER)
  const files = ['php-store/store.php', 'php-store/config-path.php', 'php-store/seo-runtime.php', 'php-store/assistant.php', 'php-knet/knet.php', 'php-knet/pay.php', 'php-knet/callback.php', 'php-cbk/cbk.php', 'php-cbk/pay.php', 'php-cbk/callback.php']
  is(files.every((f) => spawnSync('php', ['-l', join(AFTER, 'dropin', f)]).status === 0), `php -l passes on all ${files.length} changed files`)
  is(readFileSync(join(WEB, 'dropin', 'php-store', 'store.php'), 'utf8') === readFileSync(join(BEFORE, 'dropin', 'php-store', 'store.php'), 'utf8') && !readFileSync(join(WEB, 'dropin', 'php-store', 'config-path.php'), 'utf8').includes('sporta_db_options'), 'the real tree is untouched (patch not applied)')
  // the roles patch (lane D1): roles first, then the "after-roles" variant
  const R = mkTree('roles'); git(['init', '-q'], R)
  const rp = spawnSync('patch', ['-p1', '-s', '-d', R, '-i', join(OPS, 'php-roles.patch')], { encoding: 'utf8' })
  const ar = git(['apply', '--check', join(OPS, 'db-connect-after-roles.patch')], R)
  is(rp.status === 0 && ar.status === 0, 'on a tree that already has php-roles.patch, db-connect-after-roles.patch applies (apply the roles patch FIRST)', (rp.stderr + ar.stderr).trim().slice(0, 160))
}

// ------------------------------------------------------------------ PHP harness
const cfg = (over = {}) => {
  const c = { db_host: `127.0.0.1;port=${DB.port}`, db_name: 'sporta', db_user: 'app_c', db_pass: PW, cron_key: rnd(20), ...over }
  const f = join(tmp, `cfg-${rnd(5)}.php`)
  writeFileSync(f, `<?php return ${phpExport(c)};\n`, { mode: 0o600 }); return f
}
const phpExport = (v) => (typeof v === 'object' && v !== null ? `[${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}=>${phpExport(x)}`).join(',')}]` : typeof v === 'boolean' ? String(v) : JSON.stringify(v))
const runPhp = (tree, code, { config = cfg(), script = '/var/www/html/api/api.php', timeout = 60000 } = {}) => {
  const f = join(tmp, `h-${rnd(6)}.php`)
  writeFileSync(f, `<?php\n$_SERVER['SCRIPT_FILENAME'] = ${JSON.stringify(script)};\nrequire ${JSON.stringify(join(tree, 'dropin/php-store/store.php'))};\n${code}\n`)
  const t0 = Date.now()
  const r = spawnSync('php', [f], { env: { ...process.env, SPORTA_API_CONFIG_FILE: config }, encoding: 'utf8', timeout })
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), ms: Date.now() - t0, signal: r.signal }
}
const lastLine = (s) => s.split('\n').filter(Boolean).pop() || ''

head('2. What every connection now sets')
{
  const probe = `$pdo = store_db(); $o = fetch_one($pdo, 'select @@session.max_statement_time as t, @@character_set_connection as cs, @@collation_connection as cl, @@sql_mode as m');
echo json_encode(['err' => $pdo->getAttribute(PDO::ATTR_ERRMODE) === PDO::ERRMODE_EXCEPTION, 'emu' => (bool)$pdo->getAttribute(PDO::ATTR_EMULATE_PREPARES), 'fetch' => $pdo->getAttribute(PDO::ATTR_DEFAULT_FETCH_MODE), 'row' => $o]);
function fetch_one($p, $q) { return $p->query($q)->fetch(PDO::FETCH_ASSOC); }`
  const a = runPhp(AFTER, probe), b = runPhp(BEFORE, probe)
  const ja = JSON.parse(a.out || '{}'), jb = JSON.parse(b.out || '{}')
  is(ja.err === true && ja.emu === false && ja.fetch === 2 && ja.row?.cs === 'utf8mb4', 'AFTER: exceptions on, real prepared statements, FETCH_ASSOC, character set utf8mb4', a.out.slice(0, 160) + a.err.slice(0, 120))
  is(jb.err === true && jb.emu === false && Number(jb.row?.t) === 0, 'BEFORE: the same, but max_statement_time is 0 (no limit)', `max_statement_time=${jb.row?.t}`)
  is(Number(ja.row?.t) === 15, 'AFTER: the storefront connection allows a statement 15 seconds', `max_statement_time=${ja.row?.t}`)
  const by = {}
  for (const [name, script] of [['staff', '/x/admin.php'], ['payment', '/x/pay.php'], ['cron', '/x/cron-stock.php'], ['setup', '/x/setup-admin.php'], ['seo', '/x/seo-page.php']]) by[name] = Number(JSON.parse(runPhp(AFTER, probe, { script }).out || '{}').row?.t)
  is(by.staff === 30 && by.payment === 20 && by.cron === 120 && by.setup === 120 && by.seo === 15, 'and 30 s for /backends, 20 s for a payment, 120 s for batch jobs, 15 s for everything else', JSON.stringify(by))
  info('sql_mode on this server', ja.row?.m)
  const opt = runPhp(AFTER, `$o = sporta_db_options(store_config()); echo json_encode(['timeout' => $o[PDO::ATTR_TIMEOUT], 'multi' => $o[PDO::MYSQL_ATTR_MULTI_STATEMENTS] ?? 'unset', 'infile' => $o[PDO::MYSQL_ATTR_LOCAL_INFILE] ?? 'unset', 'tls' => array_key_exists(PDO::MYSQL_ATTR_SSL_CA, $o)]);`)
  const oj = JSON.parse(opt.out || '{}')
  is(oj.timeout === 5 && oj.multi === false && oj.infile === false && oj.tls === false, 'connect timeout 5 s, stacked statements off, LOAD DATA LOCAL off, no TLS for a local host', opt.out.slice(0, 160))
  const L = runPhp(AFTER, `echo json_encode([array_map('sporta_db_host_is_local', ['localhost', '127.0.0.1', '127.0.0.1;port=3307', '::1', 'mariadb', 'db', '/run/mysqld/mysqld.sock']), array_map('sporta_db_host_is_local', ['db.example.com', '10.0.0.5', '172.18.0.2', '203.0.113.7', '2001:db8::1'])]);`)
  const Lj = JSON.parse(L.out || '[[],[]]')
  is(Lj[0].length === 7 && Lj[0].every(Boolean) && Lj[1].length === 5 && Lj[1].every((x) => x === false), 'local = localhost, loopback, a socket path, a one-label service name; remote = any dotted name or other address literal (so a LAN or datacenter IP needs TLS)')
}

head('3. Stacked statements, runaway statements, LOAD DATA LOCAL')
{
  // exec() sends the string as-is (the text protocol); query() and prepare() are already single-statement because the store sets
  // EMULATE_PREPARES off (measured: error 1064). exec() is the exposed call, and the code uses it in a few places.
  const viaQuery = `$pdo = store_db(); try { $pdo->query('select 1; select 2'); echo 'RAN'; } catch (Throwable $e) { echo 'REFUSED ' . (int)($e->errorInfo[1] ?? 0); }`
  const stack = `$pdo = store_db(); try { $pdo->exec('select 1; drop table zz_victim'); echo 'RAN'; } catch (Throwable $e) { echo 'REFUSED ' . get_class($e) . ' ' . (int)($e->errorInfo[1] ?? 0); }`
  info('stacked statement via query() on the unpatched tree', runPhp(BEFORE, viaQuery).out)
  await DB.sql('create table if not exists zz_victim (id int primary key)', 'sporta')
  const b = runPhp(BEFORE, stack)
  const goneBefore = (await DB.sql("select count(*) from information_schema.tables where table_schema='sporta' and table_name='zz_victim'")) === '0'
  await DB.sql('create table if not exists zz_victim (id int primary key)', 'sporta')
  const a = runPhp(AFTER, stack)
  const goneAfter = (await DB.sql("select count(*) from information_schema.tables where table_schema='sporta' and table_name='zz_victim'")) === '0'
  is(/^RAN/.test(b.out) && goneBefore, 'BEFORE: "select 1; drop table zz_victim" in one exec() call RUNS and the table is gone (what an injected "; drop" does wherever a string reaches exec())', b.out.slice(0, 80))
  is(/^REFUSED/.test(a.out) && !goneAfter, 'AFTER: the same call is a syntax error and the table survives', a.out.slice(0, 80))
  await DB.sql('create table if not exists zz_victim (id int primary key)', 'sporta')
  // a runaway statement
  const slow = `$pdo = store_db(); $t = microtime(true); try { $pdo->query('select sleep(5)')->fetchAll(); echo 'DONE ' . round(microtime(true) - $t, 1); } catch (Throwable $e) { echo 'ABORTED ' . (int)($e->errorInfo[1] ?? 0) . ' ' . round(microtime(true) - $t, 1); }`
  const sb = runPhp(BEFORE, slow)
  const sa = runPhp(AFTER, slow, { script: '/x/cron-stock.php' }) // 120 s: must NOT abort a 5 s statement
  const sc = runPhp(AFTER, `$pdo = store_db(); sporta_db_after_connect($pdo, 2, store_config()); ${slow.replace('$pdo = store_db(); ', '')}`)
  is(/^DONE 5/.test(sb.out), 'BEFORE: a 5-second statement runs the full 5 seconds (no limit)', sb.out)
  is(/^ABORTED 1969 [12](\.\d)?$/.test(sc.out), 'AFTER, limit set to 2 s: MariaDB aborts it with error 1969 after about 2 seconds', sc.out)
  is(/^DONE 5/.test(sa.out), 'and a batch job (120 s) is not cut short', sa.out)
  // the same limit can live on the ACCOUNT (MariaDB: WITH MAX_STATEMENT_TIME): no PHP involved, and it composes with persistent connections
  await DB.sql(`create user 'app_lim'@'127.0.0.1' identified by '${PW}' with max_statement_time 2; grant all on sporta.* to 'app_lim'@'127.0.0.1'`)
  const lim = runPhp(BEFORE, slow, { config: cfg({ db_user: 'app_lim' }) })
  is(/^ABORTED 1969 [12](\.\d)?$/.test(lim.out), 'and the same limit set on the ACCOUNT (WITH MAX_STATEMENT_TIME 2) aborts a statement on the UNPATCHED tree: no PHP change needed, and nothing a persistent connection could reset', lim.out)
  // LOAD DATA LOCAL
  const infile = join(tmp, 'infile.txt'); writeFileSync(infile, `${CANARY}\n`)
  const load = `$pdo = store_db(); try { $pdo->exec("load data local infile '${infile}' into table zz_load"); echo 'LOADED'; } catch (Throwable $e) { echo 'REFUSED ' . (int)($e->errorInfo[1] ?? 0); }`
  const lb = runPhp(BEFORE, load), la = runPhp(AFTER, load)
  info('LOAD DATA LOCAL on the unpatched tree', `${lb.out.slice(0, 60)} (PHP 8.3 already defaults the client to off: the option makes it explicit, it does not change today's behaviour)`)
  is(/^REFUSED/.test(la.out) && (await DB.sql('select count(*) from zz_load', 'sporta')) === (/^LOADED/.test(lb.out) ? '1' : '0'), 'AFTER: LOAD DATA LOCAL is refused by the client even though this server allows it (explicit, not a PHP default someone may change)', la.out)
}

head('4. A database that accepts the connection and never answers')
{
  let conns = 0
  const hung = net.createServer((s) => { conns++; s.on('error', () => {}) }).listen(0, '127.0.0.1')
  await new Promise((r) => hung.once('listening', r))
  const port = hung.address().port
  const c = cfg({ db_host: `127.0.0.1;port=${port}` })
  const a2 = runPhp(AFTER, 'store_db(); echo "connected";', { config: c, timeout: 50000 })
  const b = runPhp(BEFORE, 'store_db(); echo "connected";', { config: c, timeout: 12000 })
  is(a2.ms < 32000 && /db_unreachable/.test(a2.out), 'AFTER: gives up after the statement limit plus 10 seconds (25 s for the storefront) instead of a minute, and answers db_unreachable', `${a2.ms} ms, ${a2.out.slice(0, 60)}`)
  is(b.signal === 'SIGTERM' || b.ms >= 11000, 'BEFORE: still waiting after 12 seconds (the default socket timeout is 60)', `${b.ms} ms${b.signal ? ' (killed by the harness)' : ''}`)
  const cronRun = runPhp(AFTER, 'store_db(); echo "connected";', { config: c, script: '/x/pay.php', timeout: 50000 })
  is(cronRun.ms < 36000 && cronRun.ms > 25000, 'and the payment scripts (20 s limit) wait 30 s, the batch jobs 130 s: the read timeout always exceeds the statement limit, so a statement MariaDB allows is never cut short by the client', `${cronRun.ms} ms`)
  hung.close()
}

head('5. TLS: required for a remote host, never silently dropped')
{
  const serverCa = join(tls, 'server.crt'), otherCa = join(tls, 'other.crt')
  const probe = `$pdo = store_db(); $r = $pdo->query("show session status like 'Ssl_cipher'")->fetch(PDO::FETCH_NUM); echo 'OK cipher=' . ($r[1] ?: 'none');`
  const t1 = runPhp(AFTER, probe, { config: cfg({ db_host: `127.0.0.1;port=${DB.port}`, db_tls: 'require', db_ssl_ca: serverCa }) })
  is(/^OK cipher=[A-Za-z0-9_-]+/.test(t1.out) && !/cipher=none/.test(t1.out), 'db_tls=require with the right CA: connected, and the session shows a real cipher (TLS was negotiated, not just requested)', t1.out.slice(0, 80) + t1.err.slice(0, 160))
  const t2 = runPhp(AFTER, probe, { config: cfg({ db_host: `127.0.0.1;port=${DB.port}`, db_tls: 'require', db_ssl_ca: otherCa }) })
  is(!/^OK/.test(t2.out) && /db_unreachable/.test(t2.out), 'a CA that did not sign the server certificate: the connection FAILS (certificate verified)', t2.out.slice(0, 80))
  const t3 = runPhp(AFTER, probe, { config: cfg({ db_host: `127.0.0.1;port=${DB.port}`, db_tls: 'require', db_ssl_ca: otherCa, db_ssl_verify: false }) })
  is(/^OK cipher=[A-Za-z0-9_-]+/.test(t3.out), 'db_ssl_verify=false (a self-signed lab server) still encrypts', t3.out.slice(0, 60))
  let seen = 0
  const trap = net.createServer((s) => { seen++; s.destroy() }).listen(0, '127.0.0.1'); await new Promise((r) => trap.once('listening', r))
  const remote = cfg({ db_host: 'db.example.com', db_user: 'x', db_pass: 'y' })
  const r1 = runPhp(AFTER, 'store_db(); echo "connected";', { config: remote })
  is(/db_unreachable/.test(r1.out) && /db_tls_required_but_ca_missing/.test(r1.err), 'a REMOTE host with no CA is refused before any connection is attempted, and the log says why', `${r1.out.slice(0, 50)} | ${r1.err.slice(0, 120)}`)
  const lan = cfg({ db_host: `172.18.0.9;port=${trap.address().port}` })
  const r2 = runPhp(AFTER, 'store_db(); echo "connected";', { config: lan })
  is(/db_unreachable/.test(r2.out) && /db_tls_required_but_ca_missing/.test(r2.err) && seen === 0, 'a LAN address literal counts as remote too', `connections seen by the listener: ${seen}`)
  const r3 = runPhp(AFTER, 'store_db(); echo "connected";', { config: cfg({ db_host: `127.0.0.1;port=${trap.address().port}`, db_tls: 'off' }) })
  await sleep(200)
  is(seen === 1 || /db_unreachable/.test(r3.out), 'db_tls=off is the only way back to clear text for a non-local host (here a local listener answers it)', `listener saw ${seen}`)
  trap.close()
}

head('6. Errors: what a stranger learns, what the log learns')
{
  const wrong = cfg({ db_pass: 'definitely-wrong' })
  const pub = (tree) => runPhp(tree, 'store_db();', { config: wrong })
  const stf = (tree) => runPhp(tree, 'store_db();', { config: wrong, script: '/var/www/html/api/admin.php' })
  const pb = pub(BEFORE), pa = pub(AFTER), sa = stf(AFTER)
  is(/"cause":"db_user or db_pass"/.test(pb.out), 'BEFORE: a public request with a wrong database password is told WHICH value is wrong', pb.out)
  is(pa.out === '{"error":"db_unreachable"}' && !/cause/.test(pa.out), 'AFTER: the same request gets only db_unreachable', pa.out)
  is(/"cause":"db_user or db_pass"/.test(sa.out), 'AFTER: /backends (admin.php) still gets the cause, because that is the person who can fix it', sa.out)
  is(/connection failed: PDOException sqlstate=HY000 code=1045/.test(pa.err) && !pa.err.includes('definitely-wrong') && !pa.err.includes('app_c'), 'AFTER: the log has one line, class + SQLSTATE + code, with no user name, host or password', pa.err.slice(0, 160))
  is(pb.err === '', 'BEFORE: nothing at all was logged', pb.err.slice(0, 80))
  // an uncaught database error
  const miss = `$pdo = store_db(); $pdo->query('select ${CANARY} from no_such_table_${CANARY}');`
  const mb = runPhp(BEFORE, miss), ma = runPhp(AFTER, miss)
  is(/no_table/.test(mb.out) && mb.err === '', 'BEFORE: a missing table answers no_table and leaves NO trace in the log (the exception handler replaces PHP\'s own logging)', mb.err.slice(0, 80))
  is(/no_table/.test(ma.out) && /Sporta uncaught PDOException sqlstate=42S02 code=1146/.test(ma.err) && !ma.err.includes(CANARY) && !/no_such_table/.test(ma.err), 'AFTER: a missing table answers the same, and the log has one summary line with neither the table nor the SQL', ma.err.slice(0, 160))
  // the duplicate value that a PDO message carries
  await DB.sql("insert into orders (track_id, amount, customer_name) values ('DUP" + CANARY + "', 1, 'x')", 'sporta').catch(() => {})
  const dup = `$pdo = store_db(); try { $pdo->exec("insert into orders (track_id, amount) values ('DUP${CANARY}', 1)"); } catch (PDOException $e) { echo json_encode(['msg_has_value' => str_contains($e->getMessage(), '${CANARY}'), 'summary' => sporta_db_error_summary($e), 'text' => sporta_error_text($e), 'plain' => sporta_error_text(new RuntimeException('own message'))]); }`
  const d = runPhp(AFTER, dup)
  const dj = JSON.parse(d.out || '{}')
  is(dj.msg_has_value === true && !dj.summary.includes(CANARY) && !dj.text.includes(CANARY) && /sqlstate=23000 code=1062/.test(dj.summary) && dj.plain === 'own message', 'a duplicate-key PDOException message DOES carry the value; the summary and the payment-log text do not; an application exception keeps its own message', dj.summary)
  // gateways
  const gw = (dir, file, fn, prefix) => runPhp(AFTER, `require ${JSON.stringify(join(AFTER, 'dropin', dir, file))}; $c = ['mysql_host' => '127.0.0.1;port=${DB.port}', 'mysql_name' => 'sporta', 'mysql_user' => 'app_c', 'mysql_pass' => '${PW}']; $p = ${fn}($c); echo json_encode([$p->getAttribute(PDO::ATTR_ERRMODE) === PDO::ERRMODE_EXCEPTION, (int)$p->query('select @@session.max_statement_time')->fetchColumn(), $p->getAttribute(PDO::ATTR_DEFAULT_FETCH_MODE)]);`, { script: `/x/${prefix}.php` })
  const gk = gw('php-knet', 'knet.php', 'knet_pdo', 'pay'), gc = gw('php-cbk', 'cbk.php', 'cbk_pdo', 'pay')
  is(gk.out === '[true,20,4]' && gc.out === '[true,20,4]', 'the KNET and T-Pay connections get exceptions on and the 20-second payment limit, and keep FETCH_BOTH (the gateways rely on it)', `${gk.out} ${gc.out} ${gk.err.slice(0, 80)}`)
}

head('7. The public routes answer exactly the same before and after')
{
  const serve = async (tree, port, config) => { const p = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(tree, 'dropin/php-store')], { env: { ...process.env, SPORTA_API_CONFIG_FILE: config }, stdio: 'ignore', detached: true }); await sleep(600); return p }
  const c = cfg()
  const pb = await freePort(33950), pa = await freePort(pb + 1)
  const sb = await serve(BEFORE, pb, c), sa = await serve(AFTER, pa, c)
  const routes = ['api.php?r=products', 'api.php?r=stock', 'api.php?r=slides', 'api.php?r=checkout_config', 'api.php?r=nosuchroute', 'admin.php?r=me']
  let same = 0
  const detail = []
  for (const r of routes) {
    const [x, y] = await Promise.all([fetch(`http://127.0.0.1:${pb}/${r}`), fetch(`http://127.0.0.1:${pa}/${r}`)]).catch(() => [null, null])
    if (!x || !y) { detail.push(`${r}: no answer`); continue }
    const [bx, by] = [await x.text(), await y.text()]
    if (x.status === y.status && bx === by) same++; else detail.push(`${r}: ${x.status} vs ${y.status}`)
  }
  is(same === routes.length, `${routes.length} routes (products, stock, slides, checkout config, an unknown route, admin me) give identical status and body`, detail.join('; '))
  const prod = await (await fetch(`http://127.0.0.1:${pa}/api.php?r=products`)).text()
  is(prod.includes('p-one'), 'and the products answer really comes from the database (the seeded product is in it)')
  for (const p of [sb, sa]) { try { process.kill(-p.pid, 'SIGKILL') } catch { /* gone */ } }
}

head('8. Mutation checks')
{
  const mutant = (name, edit) => { const d = mkTree(`mut-${name}`); applyEdits(d); edit(d); return d }
  const sub = (d, file, from, to) => { const p = join(d, 'dropin', file); const t = readFileSync(p, 'utf8'); if (!t.includes(from)) throw new Error(`mutation pattern missing: ${from.slice(0, 40)}`); writeFileSync(p, t.replace(from, to)) }
  const stack = `$pdo = store_db(); try { $pdo->exec('select 1; select 2'); echo 'RAN'; } catch (Throwable $e) { echo 'REFUSED'; }`
  const m1 = mutant('multi', (d) => sub(d, 'php-store/config-path.php', '$o[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = false;', '$o[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = true;'))
  is(/^RAN/.test(runPhp(m1, stack).out), 'MUTATION stacked statements left on: the "refused" check above would be red')
  const m2 = mutant('limit', (d) => sub(d, 'php-store/config-path.php', "$pdo->exec('SET SESSION max_statement_time = ' . (int)$n);", '/* limit removed */'))
  const r2 = runPhp(m2, `$pdo = store_db(); sporta_db_after_connect($pdo, 2, store_config()); $t = microtime(true); try { $pdo->query('select sleep(3)')->fetchAll(); echo 'DONE ' . round(microtime(true) - $t, 1); } catch (Throwable $e) { echo 'ABORTED'; }`)
  is(/^DONE 3/.test(r2.out), 'MUTATION statement limit removed: the "aborted after about 2 seconds" check would be red', r2.out)
  const m3 = mutant('tls', (d) => sub(d, 'php-store/config-path.php', "throw new RuntimeException('db_tls_required_but_ca_missing');", 'return [];'))
  const r3 = runPhp(m3, 'try { store_db(); echo "connected"; } catch (Throwable $e) { echo "x"; }', { config: cfg({ db_host: 'db.example.com', db_user: 'x', db_pass: 'y' }) })
  is(!/db_tls_required_but_ca_missing/.test(r3.err), 'MUTATION TLS refusal removed: a remote host is then tried in clear text and the "refused" check above would be red', r3.err.slice(0, 100))
  const m4 = mutant('cause', (d) => sub(d, 'php-store/store.php', "$staffScript ? ['error' => 'db_unreachable', 'cause' => $which] : ['error' => 'db_unreachable']", "['error' => 'db_unreachable', 'cause' => $which]"))
  is(/"cause"/.test(runPhp(m4, 'store_db();', { config: cfg({ db_pass: 'nope' }) }).out), 'MUTATION the cause given to everyone again: the "stranger learns only db_unreachable" check would be red')
}

head('summary')
if (!process.env.KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } } else console.log(`KEEP=1: ${tmp}`)
console.log(`${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
