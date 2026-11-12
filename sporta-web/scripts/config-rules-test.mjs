// CONFIG RULES — every rule the code applies to configuration, proven without a
// database, a web server or the shared test rig.
//
//   npm run test:config-rules
//
// WHY A SECOND CONFIG SUITE. test:config proves the two server LAYOUTS end to end
// (it needs the sandbox). This one proves the rules around them, by PHP-CLI
// processes and by reading the source:
//
//   A  the resolver (api/config-path.php): every spelling of the two environment
//      variables, fail-closed, and the trusted_proxy_ips / client-address rule.
//   B  what the store answers when its own config is broken (not an array, a
//      parse error, empty, a directory, unreadable, a BOM, a closure).
//   C  what KNET and T-Pay do when the config they BORROW from (the store's) or
//      their own is broken.
//   D  numeric keys at their edges: negative, zero, huge, float, "abc", NAN,
//      INF, true/false, [], null, "".
//   E  the key inventory: every key the PHP reads has a manifest entry (default
//      or "required" marker, secret flag), is documented, and no secret key sits
//      on a line that prints, logs or returns it.
//   F  the database the code needs: every column PHP writes is created by a repo
//      .sql file, and no additive migration adds a column the one-file install
//      (install.mysql.sql) lacks. (2026-11-02: the live database lacked
//      inventory.mysql.sql; every order 500'd for 33 days.)
//   G  admin-managed settings read back from a hostile or corrupt `settings` row
//      (sqlite in memory, the store's own readers).
//   H  public/config.js and the browser's use of it.
//
// KNOWN GAPS. A rule the code does not yet keep is listed in KNOWN with the
// reason, and the suite asserts the gap STILL REPRODUCES. When someone fixes it
// the suite fails with "gap closed: delete this exception" — the allow-list can
// only shrink. Nothing here edits a repo file, opens a port or connects to a
// database. Needs php-cli (pdo_sqlite for part G; skipped with a note without).
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const ROOT = join(WEB, '..')
const DROPIN = join(WEB, 'dropin')
const PHP = process.env.PHP || 'php'

let fails = 0
let knownGaps = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
// A rule the code does not keep yet. `stillHolds` is true while the gap exists.
const known = (id, stillHolds, what, why) => {
  if (stillHolds) { knownGaps++; console.log(`known ${id}  ${what}  — ${why}`) }
  else bad(`${id} gap closed`, `${what}: delete this exception from KNOWN and make the rule a plain assertion`)
}

const probe = spawnSync(PHP, ['-r', 'echo PHP_VERSION, " ", extension_loaded("pdo_sqlite") ? "sqlite" : "nosqlite";'], { encoding: 'utf8' })
if (probe.status !== 0) { console.error('php-cli is required (set PHP=/path/to/php)'); process.exit(2) }
const [PHP_VERSION, SQLITE] = probe.stdout.trim().split(' ')
console.log(`php ${PHP_VERSION}, pdo_sqlite: ${SQLITE === 'sqlite' ? 'yes' : 'NO (part G skipped)'}`)

const TMP = mkdtempSync(join(tmpdir(), 'sporta-cfgrules-'))
process.on('exit', () => { try { chmodSync(join(TMP, 'cfgs', 'unreadable.php'), 0o644) } catch { /* not created */ } rmSync(TMP, { recursive: true, force: true }) })

// The three folders laid out the way bundle-php ships them: api/ knet/ pay/ side
// by side, with NO config.php in any of them.
const WEBROOT = join(TMP, 'web')
for (const [dir, src] of [['api', 'php-store'], ['knet', 'php-knet'], ['pay', 'php-cbk']]) {
  mkdirSync(join(WEBROOT, dir), { recursive: true })
  for (const f of readdirSync(join(DROPIN, src))) {
    if (f.endsWith('.php') && f !== 'config.php') cpSync(join(DROPIN, src, f), join(WEBROOT, dir, f))
  }
}
const API = join(WEBROOT, 'api')
const CFGS = join(TMP, 'cfgs')
mkdirSync(CFGS)
const cfgFile = (name, body) => { const p = join(CFGS, name); writeFileSync(p, body); return p }

// One PHP process, a clean environment (only what the case sets), stdout+stderr.
const runPhp = (script, args = [], env = {}, extra = []) => {
  const f = join(TMP, `s${Math.random().toString(36).slice(2)}.php`)
  writeFileSync(f, script)
  const r = spawnSync(PHP, [...extra, '-d', `error_log=${join(TMP, 'php-errors.log')}`, f, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 30000,
  })
  return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status }
}
const phpErrors = () => (existsSync(join(TMP, 'php-errors.log')) ? readFileSync(join(TMP, 'php-errors.log'), 'utf8') : '')

// ============================================================ A. the resolver
head('A. the resolver — every spelling of the two variables')
{
  const RES = join(API, 'config-path.php')
  const script = `<?php require ${JSON.stringify(RES)};
foreach (['api'=>'/legacy/api/config.php','knet'=>'/legacy/knet/config.php','tpay'=>'/legacy/pay/config.php'] as $k=>$l) {
  try { $v = sporta_config_path($k,$l); } catch (Throwable $e) { $v = get_class($e).': '.$e->getMessage(); }
  echo $k,'=',$v,"\\n";
}`
  const resolve = (env) => Object.fromEntries(runPhp(script, [], env).out.trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
  const L = { api: '/legacy/api/config.php', knet: '/legacy/knet/config.php', tpay: '/legacy/pay/config.php' }
  const BAD_API = 'RuntimeException: Invalid private API config path'
  const MISSING = 'RuntimeException: Private API config path missing'
  const BAD_DIR = 'RuntimeException: Invalid private config directory'
  const F = 'SPORTA_API_CONFIG_FILE'
  const D = 'SPORTA_PRIVATE_CONFIG_DIR'
  const cases = [
    ['neither variable: shared hosting, every config next to its code', {}, L],
    ['empty file variable counts as unset', { [F]: '' }, L],
    ['empty directory variable counts as unset', { [D]: '' }, L],
    ['the file alone: the store moves, the gateways stay', { [F]: '/srv/api.php' }, { ...L, api: '/srv/api.php' }],
    ['a relative file path is refused', { [F]: 'relative/api.php' }, { ...L, api: BAD_API }],
    ['a Windows path is refused', { [F]: 'C:\\srv\\api.php' }, { ...L, api: BAD_API }],
    ['a trailing newline in the value is refused, not trimmed', { [F]: '/srv/api.php\n' }, { ...L, api: BAD_API }],
    ['a leading space is refused', { [F]: ' /srv/api.php' }, { ...L, api: BAD_API }],
    ['a trailing space is refused', { [F]: '/srv/api.php ' }, { ...L, api: BAD_API }],
    ['"0" as a file is refused (not mistaken for unset)', { [F]: '0' }, { ...L, api: BAD_API }],
    ['dot-dot segments are taken as written (operator-set, never request-supplied)', { [F]: '/srv/../etc/api.php' }, { ...L, api: '/srv/../etc/api.php' }],
    ['the directory alone FAILS CLOSED for the store (never a web-root fallback)', { [D]: '/srv/cfg' }, { api: MISSING, knet: '/srv/cfg/knet-config.php', tpay: '/srv/cfg/pay-config.php' }],
    ['a trailing slash on the directory is normalised', { [D]: '/srv/cfg/' }, { api: MISSING, knet: '/srv/cfg/knet-config.php', tpay: '/srv/cfg/pay-config.php' }],
    ['a double trailing slash too', { [D]: '/srv/cfg//' }, { api: MISSING, knet: '/srv/cfg/knet-config.php', tpay: '/srv/cfg/pay-config.php' }],
    ['the filesystem root as the directory works', { [D]: '/' }, { api: MISSING, knet: '/knet-config.php', tpay: '/pay-config.php' }],
    ['a relative directory is refused', { [D]: 'cfg' }, { api: MISSING, knet: BAD_DIR, tpay: BAD_DIR }],
    ['a Windows directory is refused', { [D]: 'C:\\cfg' }, { api: MISSING, knet: BAD_DIR, tpay: BAD_DIR }],
    ['a trailing newline on the directory is refused', { [D]: '/srv/cfg\n' }, { api: MISSING, knet: BAD_DIR, tpay: BAD_DIR }],
    ['BOTH layouts at once: the VPS layout wins everywhere', { [D]: '/srv/cfg', [F]: '/srv/api.php' }, { api: '/srv/api.php', knet: '/srv/cfg/knet-config.php', tpay: '/srv/cfg/pay-config.php' }],
    ['directory set, file variable EMPTY: still fails closed', { [D]: '/srv/cfg', [F]: '' }, { api: MISSING, knet: '/srv/cfg/knet-config.php', tpay: '/srv/cfg/pay-config.php' }],
    ['directory set, file variable invalid: refused, no fallback', { [D]: '/srv/cfg', [F]: '0' }, { api: BAD_API, knet: '/srv/cfg/knet-config.php', tpay: '/srv/cfg/pay-config.php' }],
    ['file set, directory EMPTY: the store moves, gateways stay next to their code', { [F]: '/srv/api.php', [D]: '' }, { ...L, api: '/srv/api.php' }],
  ]
  for (const [name, env, want] of cases) {
    const got = resolve(env)
    is(['api', 'knet', 'tpay'].every((k) => got[k] === want[k]), name,
      ['api', 'knet', 'tpay'].every((k) => got[k] === want[k]) ? '' : `got ${JSON.stringify(got)}`)
  }
  // The one spelling the three kinds disagree on: "0" as the DIRECTORY. knet and
  // tpay refuse it (it is not empty); the store tests it for truth, so "0" reads
  // as unset and the store quietly uses the web-root config.php.
  const zero = resolve({ [D]: '0' })
  known('config-1', zero.api === L.api && zero.knet === BAD_DIR && zero.tpay === BAD_DIR,
    'SPORTA_PRIVATE_CONFIG_DIR="0" → store uses the web-root config.php while both gateways refuse',
    'config-path.php:41 tests getenv() for truth, :49 tests it against ""; fix = compare with false/"" in both')
  const unknownKind = runPhp(`<?php require ${JSON.stringify(RES)}; try { sporta_config_path('nope','/x'); } catch (Throwable $e) { echo get_class($e); }`).out
  is(unknownKind === 'InvalidArgumentException', 'an unknown kind of config is refused', unknownKind)

  head('A2. who is asking — trusted_proxy_ips parsing and the client address')
  const ipScript = `<?php require ${JSON.stringify(RES)};
$cases = json_decode($argv[1], true); $res = [];
foreach ($cases as $c) { $_SERVER['REMOTE_ADDR'] = $c['remote']; if (isset($c['xff'])) $_SERVER['HTTP_X_FORWARDED_FOR'] = $c['xff']; else unset($_SERVER['HTTP_X_FORWARDED_FOR']);
  $rules = sporta_trusted_proxy_rules($c['rules']); $res[] = [sporta_client_ip($rules), count($rules)]; }
echo json_encode($res);`
  const ipCases = [
    ['no rules: the peer is the client', { remote: '203.0.113.9', rules: [], xff: '1.2.3.4' }, '203.0.113.9', 0],
    ['rules as a comma string with spaces', { remote: '127.0.0.1', rules: '127.0.0.1 , 10.0.0.0/8', xff: '198.51.100.7, 10.0.0.5' }, '198.51.100.7', 2],
    ['rules as an array', { remote: '172.18.0.2', rules: ['172.18.0.0/16'], xff: '198.51.100.7' }, '198.51.100.7', 1],
    ['a prepended spoof never wins: the first untrusted hop from the proxy side is taken', { remote: '127.0.0.1', rules: ['127.0.0.1'], xff: '9.9.9.9, 198.51.100.7' }, '198.51.100.7', 1],
    ['an untrusted peer cannot introduce a chain', { remote: '203.0.113.9', rules: ['127.0.0.1'], xff: '1.1.1.1' }, '203.0.113.9', 1],
    ['an invalid prefix length (/33) matches nothing', { remote: '10.1.2.3', rules: ['10.0.0.0/33'], xff: '8.8.8.8' }, '10.1.2.3', 1],
    ['a non-string rule is dropped', { remote: '127.0.0.1', rules: ['127.0.0.1', 5, null, ['x']], xff: '8.8.4.4' }, '8.8.4.4', 1],
    ['a number is not a rule list', { remote: '127.0.0.1', rules: 5, xff: '8.8.4.4' }, '127.0.0.1', 0],
    ['an oversize header is ignored', { remote: '127.0.0.1', rules: ['127.0.0.1'], xff: `${'1.2.3.4, '.repeat(300)}5.6.7.8` }, '127.0.0.1', 1],
    ['IPv6 peer and chain', { remote: '::1', rules: ['::1'], xff: '2001:db8::5' }, '2001:db8::5', 1],
    ['no REMOTE_ADDR at all: one shared sentinel, the limiter stays on', { remote: '', rules: [] }, 'unknown', 0],
    // The default the example ships (`trusted_proxy_ips => []`) behind Traefik:
    ['EMPTY rules behind a proxy: every shopper is the proxy (measured, not fixed here)', { remote: '172.18.0.2', rules: [], xff: '198.51.100.7' }, '172.18.0.2', 0],
  ]
  const ipOut = JSON.parse(runPhp(ipScript, [JSON.stringify(ipCases.map((c) => c[1]))]).out)
  ipCases.forEach(([name, , want, n], i) => is(ipOut[i][0] === want && ipOut[i][1] === n, name, `${ipOut[i][0]} (${ipOut[i][1]} rules)`))
}

// ================================================ B. a broken store config
head('B. the store, with a broken config')
{
  const good = '<?php return ["db_host"=>"h","db_name"=>"n","db_user"=>"u","db_pass"=>"p"];\n'
  const files = {
    good,
    string: '<?php return "oops";\n',
    null: '<?php return null;\n',
    noreturn: '<?php $x = 1;\n',
    syntax: '<?php return [ "db_host" => ;\n',
    empty: '',
    throws: '<?php throw new RuntimeException("boom /srv/secret/path");\n',
    fatal: '<?php return ["a"] + 5;\n',
    bom: '\ufeff' + good,
    echo: '<?php echo "LEAKED-OUTPUT"; return ["db_host"=>"h"];\n',
    closure: '<?php return ["db_host"=>"h","cb"=>function(){return 1;}];\n',
    upper: '<?php return ["DB_HOST"=>"h","DB_NAME"=>"n","DB_USER"=>"u","DB_PASS"=>"p"];\n',
  }
  for (const [n, body] of Object.entries(files)) cfgFile(`${n}.php`, body)
  mkdirSync(join(CFGS, 'dirasfile.php'))
  symlinkSync(join(CFGS, 'good.php'), join(CFGS, 'link.php'))
  symlinkSync('/nonexistent-sporta', join(CFGS, 'dangling.php'))
  cfgFile('unreadable.php', good)

  const harness = `<?php require ${JSON.stringify(join(API, 'store.php'))};
$c = store_config(); echo 'RETURNED:', implode(',', array_keys($c));`
  const store = (name, extraEnv = {}, wrap = null) => {
    const env = { SPORTA_API_CONFIG_FILE: join(CFGS, name), ...extraEnv }
    if (wrap === 'nocap') {
      const f = join(TMP, 'h-nocap.php'); writeFileSync(f, harness)
      const r = spawnSync('capsh', ['--drop=cap_dac_override,cap_dac_read_search', '--', '-c', `${PHP} ${f}`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
      return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status }
    }
    return runPhp(harness, [], env)
  }
  const CLEAN = '{"error":"failed"}'
  is(store('good.php').out === 'RETURNED:db_host,db_name,db_user,db_pass', 'a good config loads')
  is(store('link.php').out.startsWith('RETURNED:'), 'a symlink to a good config loads')
  for (const n of ['string', 'null', 'noreturn', 'syntax', 'empty', 'throws', 'fatal']) {
    const r = store(`${n}.php`)
    is(r.out === CLEAN, `${n}: a clean JSON error, not a PHP fatal`, r.out.slice(0, 80))
    is(!r.out.includes('/srv/') && !r.out.includes('Parse error') && !r.out.includes(TMP), `${n}: no path or parser text in the body`)
  }
  is(store('dirasfile.php').out.startsWith('{"error":"not_configured"'), 'a directory where the file should be → not_configured')
  is(store('dangling.php').out.startsWith('{"error":"not_configured"'), 'a dangling symlink → not_configured')
  is(store('nonexistent.php').out.startsWith('{"error":"not_configured"'), 'a missing file → not_configured')
  const dirOnly = store('good.php', { SPORTA_API_CONFIG_FILE: '', SPORTA_PRIVATE_CONFIG_DIR: CFGS })
  is(dirOnly.out === CLEAN && !dirOnly.out.includes(CFGS), 'the private directory set without the file → clean error, no path', dirOnly.out.slice(0, 60))
  is(store('upper.php').out.startsWith('RETURNED:DB_HOST'), 'key case is NOT folded: DB_HOST loads as DB_HOST')
  const up = runPhp(`<?php require ${JSON.stringify(join(API, 'store.php'))}; store_db();`, [], { SPORTA_API_CONFIG_FILE: join(CFGS, 'upper.php') })
  is(up.out === '{"error":"db_unreachable","cause":"db_host"}', 'and the store then names the lower-case key it wanted, never a value', up.out)
  const clos = store('closure.php')
  is(clos.out.startsWith('RETURNED:db_host,cb'), 'a closure inside the config loads (nothing json-encodes the config)')

  // The cost of an unbuffered require: bytes written by the config file itself
  // go out before the JSON, so Content-Type / Cache-Control / Set-Cookie can no
  // longer be sent. store_gateway_ready() and the admin payment routes buffer
  // their requires; store_config() does not.
  const bom = store('bom.php'); const echo = store('echo.php')
  known('config-2', bom.out.startsWith('\ufeff') && echo.out.startsWith('LEAKED-OUTPUT'),
    'a BOM or stray output in api-config.php is sent to the browser ahead of every response',
    'store.php:38 `require` is not wrapped in ob_start(); fix = buffer + discard, as store_gateway_ready() does')
  rmSync(join(TMP, 'php-errors.log'), { force: true })
  runPhp(`<?php require ${JSON.stringify(join(API, 'store.php'))}; store_config(); store_out(['ok' => true]);`, [], { SPORTA_API_CONFIG_FILE: join(CFGS, 'echo.php') })
  is(/headers already sent/.test(phpErrors()), 'and the response that follows cannot send its headers (PHP logs "headers already sent")')

  // An unreadable file: as root the permission test passes (root reads mode 000),
  // so drop the two capabilities that allow it. Elsewhere chmod 000 is enough.
  chmodSync(join(CFGS, 'unreadable.php'), 0)
  const root = process.getuid?.() === 0
  const capsh = spawnSync('capsh', ['--print'], { encoding: 'utf8' }).status === 0
  if (!root || capsh) {
    const r = store('unreadable.php', {}, root ? 'nocap' : null)
    is(r.out === CLEAN, 'an unreadable file → a clean JSON error', r.out.slice(0, 80))
  } else ok('an unreadable file (skipped: running as root without capsh)')
  chmodSync(join(CFGS, 'unreadable.php'), 0o644)
}

// ======================================== C. the gateways and the borrowed config
head('C. KNET and T-Pay — their own config and the one they borrow from')
{
  const GWDIR = join(TMP, 'gw'); mkdirSync(GWDIR)
  const write = (n, b) => writeFileSync(join(GWDIR, n), b)
  const storeGood = cfgFile('c-store.php', '<?php return ["db_host"=>"dbh","db_name"=>"dbn","db_user"=>"dbu","db_pass"=>"dbp","trusted_proxy_ips"=>["10.0.0.0/8"],"rate_limit_secret"=>"rls"];\n')
  const storeSyntax = cfgFile('c-store-syntax.php', '<?php return [ "x" => ;\n')
  const storeString = cfgFile('c-store-string.php', '<?php return "x";\n')
  const gwBody = '<?php return ["env"=>"test","mysql_name"=>"","mysql_user"=>""];\n'
  const prog = (kind) => `<?php
require ${JSON.stringify(kind === 'knet' ? join(WEBROOT, 'knet', 'knet.php') : join(WEBROOT, 'pay', 'cbk.php'))};
$cfg = ${kind}_load_config('/nonexistent/legacy.php'); echo 'LOADED;';
$cfg = ${kind}_with_store_db($cfg);
echo json_encode(array_intersect_key($cfg, array_flip(['mysql_host','mysql_name','mysql_user','mysql_pass','trusted_proxy_ips','rate_limit_secret'])));`
  const run = (kind, storeFile) => runPhp(prog(kind), [], { SPORTA_PRIVATE_CONFIG_DIR: GWDIR, SPORTA_API_CONFIG_FILE: storeFile })
  write('knet-config.php', gwBody); write('pay-config.php', gwBody)
  for (const kind of ['knet', 'cbk']) {
    const r = run(kind, storeGood)
    is(r.out.startsWith('LOADED;') && r.out.includes('"mysql_name":"dbn"') && r.out.includes('"mysql_user":"dbu"') && r.out.includes('"mysql_pass":"dbp"') && r.out.includes('"mysql_host":"dbh"'),
      `${kind}: empty mysql_* borrows the store's db_*`, r.out.slice(0, 160))
    is(r.out.includes('"trusted_proxy_ips":["10.0.0.0\\/8"]'), `${kind}: trusted_proxy_ips is borrowed from the store`)
  }
  is(run('cbk', storeGood).out.includes('"rate_limit_secret":"rls"'), 'cbk: rate_limit_secret is borrowed (so a T-Pay bucket is the HMAC the store computes)')
  write('knet-config.php', '<?php return ["env"=>"test","mysql_name"=>"own","mysql_user"=>"ownu","mysql_host"=>"h","mysql_pass"=>"p","trusted_proxy_ips"=>[],"rate_limit_secret"=>""];\n')
  write('pay-config.php', '<?php return ["env"=>"test","mysql_name"=>"own","mysql_user"=>"ownu","mysql_host"=>"h","mysql_pass"=>"p","trusted_proxy_ips"=>[],"rate_limit_secret"=>""];\n')
  is(run('knet', storeGood).out.includes('"mysql_name":"own"') && run('cbk', storeGood).out.includes('"mysql_name":"own"'),
    'explicit values in the gateway config win over the store')
  is(run('knet', storeSyntax).code === 0, 'knet: a store config with a parse error is never required when the gateway already names its database and proxies')
  write('knet-config.php', gwBody); write('pay-config.php', gwBody)
  // The borrowed file itself broken: a non-array falls through; a parse error is
  // not caught, so the request dies with a blank 500 (display_errors is 0 in both
  // gateways, so nothing leaks) — fail closed, but not the clean 503 text.
  for (const kind of ['knet', 'cbk']) {
    const s = run(kind, storeString)
    is(s.out === 'LOADED;{"mysql_name":"","mysql_user":""}' || s.out.startsWith('LOADED;{'), `${kind}: a store config that is not an array is ignored`, s.out.slice(0, 80))
    const p = run(kind, storeSyntax)
    is(p.code !== 0 && p.out === 'LOADED;', `${kind}: a store config with a parse error stops the request (exit ${p.code}) with no body`, JSON.stringify(p.out))
    is(!p.out.includes(TMP) && !p.out.includes('Parse error'), `${kind}: and the body names no path`)
  }
  // The gateway's OWN config.
  write('knet-config.php', '<?php return "x";\n'); write('pay-config.php', '<?php return "x";\n')
  for (const kind of ['knet', 'cbk']) {
    const r = run(kind, storeGood)
    is(r.out === 'Payment service is not configured.', `${kind}: its own config not an array → the plain 503 text`, r.out)
  }
  write('knet-config.php', '<?php return [ "a" => ;\n'); write('pay-config.php', '<?php return [ "a" => ;\n')
  for (const kind of ['knet', 'cbk']) {
    const r = run(kind, storeGood)
    is(r.code !== 0 && r.out === '' && !r.err.includes(TMP), `${kind}: its own config with a parse error → blank 500, nothing on stdout (exit ${r.code})`)
  }
  rmSync(GWDIR, { recursive: true, force: true })

  // T-Pay readiness vs what a payment needs. cbk_assert_payment_config() does
  // not ask for token_cache_file, but cbk_get_access_token() reads it bare.
  const tok = runPhp(`<?php require ${JSON.stringify(join(WEBROOT, 'pay', 'cbk.php'))};
$cfg = ['env'=>'test','test_base'=>'http://127.0.0.1:9','production_base'=>'https://pg.cbk.com','client_id'=>'c','client_secret'=>'s','encrp_key'=>'e',
 'return_url'=>'https://www.sporta.com.kw/pay/callback.php','result_page_url'=>'https://www.sporta.com.kw/payment/result','lang'=>'en'];
try { cbk_assert_payment_config($cfg); echo 'ASSERT-OK;'; } catch (Throwable $e) { echo 'ASSERT-REFUSED;'; }
try { cbk_get_access_token($cfg, false); } catch (Throwable $e) { echo get_class($e); }`)
  is(!tok.out.includes('TypeError'),
    'a pay-config.php without token_cache_file no longer dies with a TypeError on the first payment',
    tok.out.slice(0, 120))
}

// =========================================================== D. numeric keys
head('D. numeric keys at their edges')
{
  const num = (fn, lit) => {
    const key = { cooldown: 'order_cooldown_seconds', cod: 'cod_hold_hours', units: 'order_client_units', hold: 'stock_hold_minutes', late: 'assistant_late_hours', retry: 'warehouse_retry_window_minutes' }[fn]
    const cfg = cfgFile(`num-${fn}.php`, `<?php return ['${key}' => ${lit}];\n`)
    const body = { cooldown: 'store_order_cooldown_seconds()', cod: 'store_cod_hold_hours()', units: 'store_order_client_units()',
      hold: "max(15, (int)(store_config()['stock_hold_minutes'] ?? 120))", late: "max(1, (int)(store_config()['assistant_late_hours'] ?? 48))",
      retry: "max(0, min(60, (int)(store_config()['warehouse_retry_window_minutes'] ?? 10)))" }[fn]
    const r = runPhp(`<?php require ${JSON.stringify(join(API, 'store.php'))};
set_error_handler(function ($n, $s) { echo '[warn]'; return true; });
try { echo ${body}; } catch (Throwable $e) { echo get_class($e); }`, [], { SPORTA_API_CONFIG_FILE: cfg })
    return r.out
  }
  // [literal, cooldown, cod, units]: the three keys that share the "absent or ''
  // → default, 0 → off, clamp" contract the docs describe.
  const rows = [
    ['null', 60, 24, 40], ["''", 60, 24, 40], ['0', 0, 0, 0], ['1', 1, 1, 1], ['-5', 0, 0, 0], ['-0.5', 0, 0, 0],
    ['60.9', 60, 60, 60], ["'60 '", 60, 60, 60], ["'1e3'", 1000, 720, 1000], ['999999999999', 3600, 720, 1000], ['1e30', 3600, 720, 1000],
    ["'0'", 0, 0, 0],
  ]
  for (const [lit, c, h, u] of rows) {
    const got = [num('cooldown', lit), num('cod', lit), num('units', lit)]
    is(got.join() === [c, h, u].join(), `order_cooldown_seconds / cod_hold_hours / order_client_units = ${lit}`, `${got.join(' / ')}  (want ${c} / ${h} / ${u})`)
  }
  // Junk. The contract says "absent or '' → default"; junk collapses to 0 = OFF.
  const junk = ["'abc'", 'NAN', 'INF', 'false', '[]', 'true']
  const junkOff = junk.filter((lit) => [num('cooldown', lit), num('cod', lit), num('units', lit)].slice(0, 3).every((v, i) => (lit === 'true' ? false : v === '0')))
  known('config-4', junkOff.length === 5,
    `junk (${junk.slice(0, 5).join(' ')}) in order_cooldown_seconds / cod_hold_hours / order_client_units reads as 0 = the safeguard is OFF`,
    '(int)"abc" is 0 and 0 is the documented "off"; fix = treat a non-numeric value as the default, as null and "" already are')
  is(num('cooldown', 'true') === '1' && num('cod', 'true') === '1', 'true reads as 1 (not off)')
  // stock_hold_minutes: floor 15, no ceiling; '' is NOT the default here.
  is(num('hold', 'null') === '120' && num('hold', '5') === '15' && num('hold', '0') === '15' && num('hold', '999999999999') === '999999999999',
    'stock_hold_minutes: absent=120, floor 15, no ceiling')
  known('config-5', num('hold', "''") === '15' && num('late', "''") === '1',
    "stock_hold_minutes='' means 15 minutes and assistant_late_hours='' means 1 hour — not the default 120 / 48 that the same spelling means for the sibling keys",
    '`?? default` only covers null; fix = normalise \'\' to the default like cod_hold_hours does')
  is(num('retry', 'null') === '10' && num('retry', '999999999999') === '60' && num('retry', '-5') === '0', 'warehouse_retry_window_minutes: absent=10, clamp 0..60')
}

// ========================================================= E. the key inventory
head('E. the key inventory — every key read, its default, its secret flag, its documentation')
const SRC = {}
for (const [kind, dir] of [['api', 'php-store'], ['knet', 'php-knet'], ['tpay', 'php-cbk']]) {
  for (const f of readdirSync(join(DROPIN, dir))) {
    if (f.endsWith('.php') && f !== 'config.php' && !f.startsWith('config.example')) SRC[`${dir}/${f}`] = { kind, text: readFileSync(join(DROPIN, dir, f), 'utf8') }
  }
}
// kind → key → { def, secret, bare, internal, dyn, note }. `def` documents what the code does when the key is
// ABSENT. `bare` explains why a read with no `??` is safe (or says it is a gap).
const R = '(required)'
const M = {
  api: {
    db_host: { def: R, bare: 'store_db() names the missing key in db_unreachable' }, db_name: { def: R, bare: 'idem' }, db_user: { def: R, bare: 'idem' },
    db_pass: { def: R, secret: true, bare: 'idem' },
    warehouse_email: { def: "'' → cron-fulfilment answers 500 before claiming any row", bare: 'guarded by the ?? \'\' test at cron-fulfilment.php:25' },
    mail_from: { def: "''" }, mail_reply_to: { def: "''" }, admin_mail_from: { def: 'falls back mail_reply_to, mail_from (store.php:213)' },
    customer_mail_from: { def: 'falls back mail_reply_to, mail_from' },
    admin_reset_url: { def: "'https://www.sporta.com.kw/backends'; any other scheme/host replaced by that default (admin.php:246)" },
    google_oauth_client_id: { def: "'' → Google sign-in off", bare: 'wrapped in !empty()' }, google_oauth_client_secret: { def: "'' → off", secret: true, bare: 'wrapped in !empty()' },
    rate_limit_secret: { def: "'' → HMAC key derived from db_name|db_user|db_pass", secret: true },
    trusted_proxy_ips: { def: '[] → the direct peer is the client (UNSAFE behind a proxy: all shoppers share one bucket)' },
    cron_key: { def: "'' → cron-auth refuses, review links off, setup-admin/preflight/cron-voice/cron-whatsapp refuse", secret: true, bare: 'every read is behind a non-empty test' },
    stock_hold_minutes: { def: '120; floor 15; no ceiling' }, cod_hold_hours: { def: '24; 0 = off; 0..720' },
    order_cooldown_seconds: { def: '60; 0 = off; 0..3600' }, order_client_units: { def: '40; 0 = off; 0..1000' },
    admin_session_dir: { def: "'' → /var/lib/sporta/admin-sessions, else beside the web root, else temp" },
    ai_key: { def: "'' → no language model", secret: true }, ai_url: { def: "'' → no language model (no host allow-list)" }, ai_model: { def: "'claude-haiku-5-5'" },
    tts_key: { def: "'' → no voice", secret: true, bare: 'read only after a non-empty test (assistant.php:3767)' },
    tts_voice_id: { def: "'' → no voice", bare: 'read only after the tts_key/tts_voice_id test' },
    tts_model: { def: "'eleven_multilingual_v2'" }, tts_language_code: { def: "'' → detect" }, tts_cache_dir: { def: 'sys_get_temp_dir()/sporta-voice' },
    tts_format: { def: "'mp3_22050_32'" }, tts_stability: { def: '0.45 (float cast, no clamp)' }, tts_similarity: { def: '0.8' }, tts_style: { def: '0.0' },
    tts_speaker_boost: { def: 'true' }, tts_timeout: { def: '10 (int cast, no clamp)' }, tts_log: { def: "'' → beside the cache" }, tts_url: { def: "'https://api.elevenlabs.io' (no host allow-list)" },
    n8n_webhook: { def: "'' → no handoff" }, n8n_secret: { def: "'' → no handoff", secret: true },
    assistant_late_hours: { def: '48; floor 1' }, shop_phone: { def: "'+965 22091914'" }, shop_email: { def: "'cs@sporta.com.kw'" },
    abandoned_after_minutes: { def: '30 (ABANDONED_AFTER_DEFAULT); floor ABANDONED_AFTER_MIN, capped at the hold window (abandoned.php:95)' },
    tts_fail_ttl: { def: '30 s; 0 = off (assistant.php:5280)' }, assistant_enabled: { def: 'true (assistant.php:4469)' },
    assistant_welcome_ar: { def: "'' → the built-in welcome", bare: 'read in a is_string(... ?? null) test, then a !== \'\' test (assistant.php:3944)' },
    assistant_welcome_en: { def: "'' → the built-in welcome", bare: 'read in a is_string(... ?? null) test, then a !== \'\' test (assistant.php:3946)' },
    whatsapp_token: { def: "'' → feature off, nothing queued", secret: true, bare: 'cron-whatsapp.php:48 stops on an empty token first' },
    whatsapp_phone_number_id: { def: "'' → off", bare: 'cron-whatsapp.php stops on an empty id first' },
    whatsapp_template_confirmed: { def: "'' → that kind not sent", dynamic: true }, whatsapp_template_shipped: { def: "''", dynamic: true }, whatsapp_template_review: { def: "''", dynamic: true },
    whatsapp_api_base: { def: "'https://graph.facebook.com/v21.0'" },
    warehouse_retry_window_minutes: { def: '10; 0..60' },
    db_backup_status_file: { def: "'' → /var/lib/sporta/backup-status (Database center backup line; absent file = not reported)", bare: "admin.php hands it to dbcenter_backup(), which treats '' as the default path" },
  },
  knet: {
    env: { def: R, bare: 'asserted: knet_assert_payment_config / knet_gateway_url throw' },
    test_url: { def: R, bare: 'asserted (exactly https://[www.]kpaytest.com.kw/kpg/PaymentHTTP.htm)' }, production_url: { def: R, bare: 'asserted (exactly https://[www.]kpay.com.kw/kpg/PaymentHTTP.htm)' },
    tranportal_id: { def: R, secret: true, bare: 'asserted non-empty' }, tranportal_password: { def: R, secret: true, bare: 'asserted non-empty' },
    resource_key: { def: R, secret: true, bare: 'asserted exactly 16 bytes' },
    response_url: { def: R, bare: 'asserted HTTPS' }, error_url: { def: R, bare: 'asserted HTTPS' },
    result_page_url: { def: R, bare: 'callback.php reads it BEFORE any assertion (see config-6)' },
    language: { def: "'USA' (AR|USA|EN→USA, anything else refused)" }, log_file: { def: "'' → no payment log" },
    callback_response: { def: "'auto'" },
    mysql_host: { def: 'borrowed from the store db_host', bare: 'knet_db_configured() gates every use' }, mysql_name: { def: 'borrowed from db_name', bare: 'knet_db_configured() gates every use' },
    mysql_user: { def: 'borrowed from db_user', bare: 'knet_db_configured() gates every use' }, mysql_pass: { def: 'borrowed from db_pass', secret: true, bare: 'knet_db_configured() gates every use' },
    trusted_proxy_ips: { def: 'borrowed from the store', bare: 'only read after array_key_exists' },
    test_tranportal_id: { def: 'falls back to tranportal_id (admin-managed per environment)', dyn: true, secret: true },
    merchant_id: { def: "''", dyn: true }, terminal_id: { def: "''", dyn: true },
    // KNET-IPAYPIPE-CHECK.md D2: the stock sweeper's inquiry, OFF unless switched on.
    inquiry_enabled: { def: 'false; only the boolean true switches it on' },
    inquiry_action: { def: 'none: unset refuses the inquiry (no guessed code); 1-7 and 9 refused as money-moving',
      bare: 'gated: knet_inquiry_config_problem refuses unset, empty, non-numeric and money-moving values before any use' },
    inquiry_transid: { def: "'' (no <transid>); 'trackid' sends the reference" }, inquiry_udf5: { def: "'' (no <udf5>); letters only" },
  },
  tpay: {
    env: { def: R, bare: 'asserted' }, test_base: { def: R, bare: 'asserted (HTTPS)' }, production_base: { def: R, bare: 'asserted (HTTPS)' },
    client_id: { def: R, secret: true, bare: 'asserted' }, client_secret: { def: R, secret: true, bare: 'asserted' }, encrp_key: { def: R, secret: true, bare: 'asserted' },
    return_url: { def: R, bare: 'asserted' }, result_page_url: { def: R, bare: 'callback.php reads it BEFORE any assertion (see config-6)' },
    lang: { def: R, bare: 'asserted en|ar' }, log_file: { def: "'' → no payment log" },
    token_cache_file: { def: R, bare: 'NOT asserted (see config-3)' },
    knet_via_cbk: { def: 'false; !empty() — the string "false" is true' },
    server_ip_1: { def: "''" }, server_ip_2: { def: "''" },
    mysql_host: { def: 'borrowed', bare: 'cbk_db_configured() gates every use' }, mysql_name: { def: 'borrowed', bare: 'cbk_db_configured() gates every use' },
    mysql_user: { def: 'borrowed', bare: 'cbk_db_configured() gates every use' }, mysql_pass: { def: 'borrowed', secret: true, bare: 'cbk_db_configured() gates every use' },
    trusted_proxy_ips: { def: 'borrowed from the store' }, rate_limit_secret: { def: 'borrowed from the store', secret: true },
  },
}
// Reads the scan finds that are not configuration keys of these files.
const NOT_CONFIG = new Set(['_checkout', 'delivery_fee_fils', 'methods', 'default_method', 'notice_en', 'notice_ar', 'enabled', 'percent', 'days',
  'type', 'size', 'colour', 'name', 'phone', 'status', 'free', 'tags', 'generic', 'cheap', 'source', 'gender', 'email', 'display_name', 'language_', 'max',
  'last_track_id', 'last_area', 'order_count', 'order_total', 'paid_total', 'open_cod_count', 'open_cod_total', 'follow_up_at', 'updated_by', 'updated_at'])
const ANY = new Set(Object.values(M).flatMap((k) => Object.keys(k)))

// Which variables hold a config in which file. `$c` is a config only where listed.
const CFGVARS = '(?:store_config\\(\\)|\\$cfg|\\$config|\\$mailCfg|\\$knet|\\$tpay|\\$shop)'
const reads = [] // { file, line, key, bare }
for (const [file, { text }] of Object.entries(SRC)) {
  const lines = text.split('\n')
  const re = new RegExp(`${CFGVARS}\\[['"]([a-z_0-9]+)['"]\\](\\s*\\?\\?)?`, 'g')
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|#)/.test(l)) return
    for (const m of l.matchAll(re)) {
      // $shop is the local answer array in assistant.php (4764-4766), not the store config: not a configuration read.
      if (m[1] === 'reply' || m[1] === 'data') continue
      const after = l.slice(m.index + m[0].length)
      if (/^\s*=[^=>]/.test(after) || /^\s*\.=/.test(after)) continue // an assignment, not a read
      const before = l.slice(0, m.index)
      const guarded = /(!empty|isset|array_key_exists|\bempty)\(\s*$/.test(before) || /array_key_exists\('[a-z_]+',\s*$/.test(before)
      reads.push({ file, line: i + 1, key: m[1], bare: !m[2] && !guarded })
    }
  })
}
// preflight.php and admin.php name the gateway config `$c` in a few closures.
for (const file of ['php-store/preflight.php', 'php-store/admin.php']) {
  SRC[file].text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/\$c\[['"](mysql_[a-z]+|resource_key|client_id|client_secret|encrp_key|server_ip_[12]|env)['"]\](\s*\?\?)?/g)) reads.push({ file, line: i + 1, key: m[1], bare: !m[2] })
  })
}
{
  const keysRead = new Set(reads.map((r) => r.key))
  const unknown = [...keysRead].filter((k) => !ANY.has(k) && !NOT_CONFIG.has(k) && !/^(db_|)(host|name|user|pass)$/.test(k))
  is(unknown.length === 0, 'every configuration key the PHP reads has a manifest entry (default, secret flag)', unknown.join(', ') || `${keysRead.size} distinct keys read, ${reads.length} reads`)

  const literal = (k) => Object.values(SRC).some(({ text }) => new RegExp(`['"]${k}['"]`).test(text))
  const unread = Object.entries(M).flatMap(([kind, keys]) => Object.entries(keys).filter(([k, v]) => !v.dyn && !literal(k)).map(([k]) => `${kind}.${k}`))
  is(unread.length === 0, 'every manifest key is referenced in the PHP (no dead entry)', unread.join(', '))

  // Reads with no `??`: each key needs a `bare` reason in the manifest.
  const bareKeys = [...new Set(reads.filter((r) => r.bare).map((r) => r.key))]
  const noReason = bareKeys.filter((k) => !NOT_CONFIG.has(k) && !Object.values(M).some((kk) => kk[k]?.bare !== undefined))
  is(noReason.length === 0, 'every read WITHOUT a default has a stated reason (asserted / gated / required)', noReason.join(', ') || `${bareKeys.length} bare-read keys`)

  // Documentation: config.example.php per kind (active or commented-out line) and any *.md.
  const examples = { api: 'php-store', knet: 'php-knet', tpay: 'php-cbk' }
  const exText = Object.fromEntries(Object.entries(examples).map(([k, d]) => [k, readFileSync(join(DROPIN, d, 'config.example.php'), 'utf8')]))
  const mdFiles = [...readdirSync(WEB).filter((f) => f.endsWith('.md')).map((f) => join(WEB, f)),
    ...readdirSync(DROPIN).filter((f) => f.endsWith('.md')).map((f) => join(DROPIN, f)),
    ...['php-knet', 'php-cbk', 'php-store'].flatMap((d) => readdirSync(join(DROPIN, d)).filter((f) => f.endsWith('.md')).map((f) => join(DROPIN, d, f))),
    join(ROOT, 'CLAUDE.md')].filter(existsSync)
  const mdText = mdFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  const inExample = (kind, k) => new RegExp(`^\\s*(//\\s*)?['"]${k}['"]\\s*=>`, 'm').test(exText[kind])
  const inDocs = (k) => new RegExp(`(^|[^a-z_0-9])${k}([^a-z_0-9]|$)`).test(mdText)

  // Example keys must be known keys.
  const exKeys = (kind) => [...exText[kind].matchAll(/^\s*(?:\/\/\s*)?['"]([a-z_0-9]+)['"]\s*=>/gm)].map((m) => m[1])
  const exUnknown = Object.keys(examples).flatMap((kind) => exKeys(kind).filter((k) => !M[kind][k]).map((k) => `${kind}.${k}`))
  is(exUnknown.length === 0, 'every key in a config.example.php is a key the code knows', exUnknown.join(', '))

  // Documented-but-never-read, by the example: covered by "no dead entry" above plus:
  const exDead = Object.keys(examples).flatMap((kind) => exKeys(kind).filter((k) => M[kind][k] && !literal(k)).map((k) => `${kind}.${k}`))
  is(exDead.length === 0, 'no example key is documented but never read', exDead.join(', '))

  // Keys the code reads that neither an example nor any document mentions.
  const UNDOCUMENTED = {
    'api.order_client_units': 'config-7: the 40-pieces-per-client cap has a default and a clamp in store.php:2945 but is in no example and no document',
    'api.tts_url': 'config-7: base URL override for the voice service; used by the test rig, not shipped in the example',
    'tpay.server_ip_1': 'written by the admin (payment_server_ips), never read by a payment; documented in CLAUDE.md only',
    'tpay.server_ip_2': 'idem',
  }
  const undocumented = []
  for (const [kind, keys] of Object.entries(M)) for (const [k, v] of Object.entries(keys)) {
    if (v.dyn || v.dynamic) continue
    if (!inExample(kind, k) && !inDocs(k)) undocumented.push(`${kind}.${k}`)
  }
  const undocUnexpected = undocumented.filter((k) => !UNDOCUMENTED[k])
  is(undocUnexpected.length === 0, 'every key is in an example or a document', undocUnexpected.join(', '))
  for (const [id, why] of Object.entries(UNDOCUMENTED)) {
    known(`doc:${id}`, undocumented.includes(id) || id.startsWith('tpay.server_ip') && !inExample('tpay', id.split('.')[1]), id, why)
  }

  // Secrets: no secret key sits on a line that prints, logs or returns it.
  const SINK = /\b(store_out|store_fail|json_encode|echo|print|error_log|knet_log|cbk_log|var_dump|var_export|printf|exit\()/
  const secretKeys = new Set(Object.values(M).flatMap((kk) => Object.entries(kk).filter(([, v]) => v.secret).map(([k]) => k)))
  const leaks = []
  for (const [file, { text }] of Object.entries(SRC)) {
    if (/selftest\.php$|preflight\.php$/.test(file)) continue // the two install tools print lengths and set/unset, never values (checked below)
    text.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|#)/.test(l)) return
      for (const k of secretKeys) {
        if (new RegExp(`\\[['"]${k}['"]\\]`).test(l) && SINK.test(l) && !/!empty\(|\?\?\s*''\)\s*[!=]==|has_|\$configured|\$isConfigured|strlen\(/.test(l)) leaks.push(`${file}:${i + 1} ${k}`)
      }
    })
  }
  is(leaks.length === 0, 'no secret key is read on a line that prints, logs or returns it', leaks.join('; '))
  for (const f of ['php-knet/selftest.php', 'php-store/preflight.php']) {
    const bareEcho = SRC[f].text.split('\n').filter((l) => /echo/.test(l) && [...secretKeys].some((k) => new RegExp(`\\[['"]${k}['"]\\]`).test(l)) && !/\$set\(|strlen\(|\? 'set'|'set'|'EMPTY'/.test(l))
    is(bareEcho.length === 0, `${f}: prints only set/unset or a length for a secret`, bareEcho[0]?.trim().slice(0, 100))
  }
  // The admin API answers has_* booleans, never the value.
  const admin = SRC['php-store/admin.php'].text
  is(/'has_tranportal_password'/.test(admin) && /'has_resource_key'/.test(admin) && /'has_client_secret'/.test(admin) && /'has_encrp_key'/.test(admin),
    'payment_config answers has_* booleans for every secret')
  is(!/store_out\([^)]*\['(tranportal_password|resource_key|client_secret|encrp_key)'\]/.test(admin), 'and no store_out() carries a secret key')

  // Examples carry placeholders, never a real-looking value.
  for (const kind of ['api', 'knet', 'tpay']) {
    const bad = [...exText[kind].matchAll(/^\s*'([a-z_0-9]+)'\s*=>\s*'([^']*)'/gm)]
      .filter(([, k, v]) => M[kind][k]?.secret && v !== '' && !/^YOUR_/.test(v)).map(([, k]) => k)
    is(bad.length === 0, `${kind}: config.example.php holds only empty or YOUR_ placeholders for secrets`, bad.join(', '))
  }
  // config.php of any kind is git-ignored and absent from the package.
  const ignore = readFileSync(join(WEB, '.gitignore'), 'utf8')
  is(['dropin/php-store/config.php', 'dropin/php-knet/config.php', 'dropin/php-cbk/config.php'].every((p) => ignore.split('\n').includes(p)), 'the three config.php files are git-ignored')

  known('config-6', /\$return\s*=\s*\$cfg\['result_page_url'\];/.test(SRC['php-knet/callback.php'].text) && /\$return\s*=\s*\$cfg\['result_page_url'\];/.test(SRC['php-cbk/callback.php'].text),
    'both bank callbacks read result_page_url with no default and no assertion',
    'a config missing it still records the payment but redirects the paid shopper to "?status=…"; fix = `?? "/payment/result"`')
  is(/knet_via_cbk/.test(SRC['php-store/store.php'].text),
    'knet_via_cbk=ON makes KNET ready at checkout exactly when CBK is (store_gateway_ready reads the T-Pay config)',
    'store_gateway_ready (store.php) reads knet_via_cbk and asks the CBK side; config-8 closed by c6ec4e24')
  known('config-9', /!empty\(\$cfg\['knet_via_cbk'\]\)/.test(SRC['php-cbk/cbk.php'].text),
    "knet_via_cbk is read with !empty(): a hand-edited 'false' / 'off' string switches KNET onto the CBK gateway",
    'the admin writes a real boolean; only a hand edit is at risk; fix = $cfg[..] === true')
}

// =================================================== F. the database the code needs
head('F. the database — every column the PHP writes is created by a repo .sql file')
{
  const SQLDIR = join(DROPIN, 'php-store')
  const statements = (sql) => {
    const out = []; let cur = ''; let i = 0
    while (i < sql.length) {
      const ch = sql[i]; const nx = sql[i + 1]
      if (ch === '-' && nx === '-' && /\s|^$/.test(sql[i + 2] ?? ' ')) { while (i < sql.length && sql[i] !== '\n') i++; continue }
      if (ch === '#') { while (i < sql.length && sql[i] !== '\n') i++; continue }
      if (ch === '/' && nx === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue }
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1
        while (j < sql.length) { if (sql[j] === '\\' && ch !== '`') { j += 2; continue } if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue } break } j++ }
        cur += sql.slice(i, j + 1); i = j + 1; continue
      }
      if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue }
      cur += ch; i++
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  const splitTop = (body) => {
    const parts = []; let depth = 0; let cur = ''
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1
        while (j < body.length) { if (body[j] === '\\' && ch !== '`') { j += 2; continue } if (body[j] === ch) { if (body[j + 1] === ch) { j += 2; continue } break } j++ }
        cur += body.slice(i, j + 1); i = j; continue
      }
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    if (cur.trim()) parts.push(cur.trim())
    return parts
  }
  const NOT_COL = /^(primary|unique|key|index|constraint|foreign|check|fulltext|spatial)\b/i
  const columnsOf = (file) => {
    const cols = new Map()
    const add = (t, c) => { if (!cols.has(t)) cols.set(t, new Set()); cols.get(t).add(c) }
    for (const st of statements(readFileSync(join(SQLDIR, file), 'utf8'))) {
      let m = st.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?`?([a-z_0-9]+)`?\s*\(/i)
      if (m) {
        for (const p of splitTop(st.slice(st.indexOf('(', m[0].length - 1) + 1, st.lastIndexOf(')')))) {
          if (NOT_COL.test(p)) continue
          const c = p.match(/^`?([a-z_0-9]+)`?/i); if (c) add(m[1].toLowerCase(), c[1].toLowerCase())
        }
        continue
      }
      m = st.match(/^alter\s+table\s+(?:if\s+exists\s+)?`?([a-z_0-9]+)`?\s+([\s\S]*)$/i)
      if (m) for (const p of splitTop(m[2])) {
        const a = p.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?`?([a-z_0-9]+)`?\s+\S/i)
        if (a && !/^(constraint|index|key|unique|primary|foreign|check|fulltext)$/i.test(a[1])) add(m[1].toLowerCase(), a[1].toLowerCase())
      }
    }
    return cols
  }
  const merge = (into, from) => { for (const [t, s] of from) { if (!into.has(t)) into.set(t, new Set()); for (const c of s) into.get(t).add(c) } }
  const gen = readFileSync(join(HERE, 'make-install-sql.mjs'), 'utf8')
  const partsSrc = gen.slice(gen.indexOf('const PARTS = ['), gen.indexOf(']\n', gen.indexOf('const PARTS = [')))
  const parts = [...partsSrc.matchAll(/\['([\w-]+\.mysql\.sql)'/g)].map((m) => m[1])
  const install = new Map(); for (const f of parts) merge(install, columnsOf(f))
  const sqlFiles = readdirSync(SQLDIR).filter((f) => f.endsWith('.mysql.sql'))
  const countCols = (m) => [...m.values()].reduce((a, s) => a + s.size, 0)
  is(parts.length >= 10 && install.size >= 28 && countCols(install) >= 292, 'the one-file install parts are read from its generator', `${parts.length} parts → ${install.size} tables, ${countCols(install)} columns`)

  // An additive migration must not add a column the one-file install lacks: an
  // owner who imports install.mysql.sql is then missing it, and the code that
  // writes it fails on the first order.
  const extra = sqlFiles.filter((f) => f !== 'install.mysql.sql' && !parts.includes(f))
  const notInInstall = []
  // A deep copy: merge() adds to the Sets it is given, so a shallow copy would write the extra files' columns into install itself.
  const all = new Map([...install].map(([t, s]) => [t, new Set(s)]))
  for (const f of extra) {
    const cs = columnsOf(f); merge(all, cs)
    for (const [t, s] of cs) for (const c of s) if (!install.get(t)?.has(c)) notInInstall.push(`${f}: ${t}.${c}`)
  }
  is(notInInstall.length === 0, `no additive migration (${extra.length} files) adds a column that install.mysql.sql lacks`, notInInstall.join('; '))
  // install.mysql.sql on disk really is the generated concatenation.
  const installText = readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8')
  const installFromDisk = columnsOf('install.mysql.sql')
  is(countCols(installFromDisk) === countCols(install), 'the install.mysql.sql on disk carries the same columns as its parts', `${countCols(installFromDisk)} vs ${countCols(install)}`)
  is(/COMPLETE database install/.test(installText), 'install.mysql.sql is the generated file')

  // Columns PHP writes (insert/replace into T (cols), update T set a = …).
  const written = new Map()
  const note = (t, c, f) => { const k = `${t}.${c}`; if (!written.has(k)) written.set(k, new Set()); written.get(k).add(f) }
  const tables = new Set()
  for (const [file, { text }] of Object.entries(SRC)) {
    for (const m of text.matchAll(/\b(?:insert(?:\s+ignore)?\s+into|replace\s+into)\s+`?([a-z_]+)`?\s*\(([^)]*)\)/gi)) {
      const t = m[1].toLowerCase(); tables.add(t)
      for (const c of m[2].split(',')) { const n = c.trim().replace(/`/g, '').toLowerCase(); if (/^[a-z_0-9]+$/.test(n)) note(t, n, file) }
    }
    for (const m of text.matchAll(/\bupdate\s+`?([a-z_]+)`?\s+(?:[a-z]\s+)?set\s+([^;"']*?)(?:\bwhere\b|$|")/gis)) {
      const t = m[1].toLowerCase(); if (!all.has(t)) continue; tables.add(t)
      for (const c of m[2].matchAll(/(?:^|,)\s*(?:[a-z]\.)?`?([a-z_0-9]+)`?\s*=/g)) note(t, c[1].toLowerCase(), file)
    }
  }
  const noSql = [...written.keys()].filter((k) => { const [t, c] = k.split('.'); return !all.get(t)?.has(c) })
  const NO_MIGRATION = {
    'customer_accounts.birthday': 'config-10: birthday.php / cron-birthday.php write it; the code detects its absence (birthday_columns_ready) but NO .sql creates it',
    'customer_accounts.birthday_set_at': 'config-10: same',
    'customer_accounts.birthday_sent_year': 'config-10: same',
  }
  const unexpected = noSql.filter((k) => !NO_MIGRATION[k])
  is(unexpected.length === 0, `every column the PHP writes (${written.size}, ${tables.size} tables) is created by a repo .sql file`, unexpected.join(', '))
  for (const [k, why] of Object.entries(NO_MIGRATION)) known(`sql:${k}`, noSql.includes(k), k, why)
  // The columns code probes for and survives without.
  const probed = [...new Set(Object.values(SRC).flatMap(({ text }) => [...text.matchAll(/store_column_exists\(\$db,\s*'([a-z_]+)',\s*'([a-z_]+)'\)/g)].map((m) => `${m[1]}.${m[2]}`)))]
  const probedMissing = probed.filter((k) => { const [t, c] = k.split('.'); return !all.get(t)?.has(c) })
  is(probedMissing.length === 1 && probedMissing[0] === 'customer_accounts.last_login_at', 'columns probed with store_column_exists(): all created by the repo except the documented customer_accounts.last_login_at', probedMissing.join(', '))
  // Every table PHP selects from / joins is created by the repo.
  const fromTables = new Set()
  for (const { text } of Object.values(SRC)) {
    for (const m of text.matchAll(/\b(?:from|join)\s+`?([a-z][a-z_]+)`?(?=[\s,)`;'"]|$)/gi)) fromTables.add(m[1].toLowerCase())
  }
  const known_nontable = new Set(['information_schema', 'dual', 'select', 'where', 'the', 'a', 'an', 'it', 'one', 'this', 'that', 'your', 'our', 'their', 'what', 'which', 'each', 'every', 'any', 'all', 'is', 'in', 'on', 'of', 'for', 'to', 'as', 'at', 'by', 'and', 'or', 'not', 'if', 'then', 'than', 'but', 'so', 'be', 'can', 'will', 'may', 'must', 'now', 'here', 'there', 'when', 'while', 'with', 'without', 'my', 'me', 'you', 'we', 'they', 'them', 'who', 'how', 'why', 'no', 'yes'])
  const functions = new Set(Object.values(SRC).flatMap(({ text }) => [...text.matchAll(/function\s+([a-z_0-9]+)/gi)].map((m) => m[1].toLowerCase())))
  const missingTables = [...fromTables].filter((t) => !all.has(t) && !known_nontable.has(t) && !functions.has(t) && t.length > 3 && /_/.test(t))
  is(missingTables.length === 0, 'every table named after FROM/JOIN with an underscore exists in the repo SQL', missingTables.join(', '))
}

// ====================================== G. admin-managed settings, hostile rows
head('G. settings read back from a hostile or corrupt row')
if (SQLITE !== 'sqlite') {
  console.log('skip  (pdo_sqlite not available in this php-cli)')
} else {
  const cases = [
    // [setting, raw row, probe, check]
    ['hero', 'not json', 'hero', (j) => j.speed_ms === 6500 && j.size === 'tall'],
    ['hero', '"just a string"', 'hero', (j) => j.speed_ms === 6500],
    ['hero', 'null', 'hero', (j) => j.speed_ms === 6500],
    ['promo_bar', '{"enabled":"<b>","text_en":["x"],"text_ar":{"a":1},"href":"javascript:alert(1)","tone":"red;x","alignment":5,"starts_at":"bad","ends_at":[]}', 'promo_bar',
      (j) => j.enabled === false && j.text_en === '' && j.text_ar === '' && j.href === '' && j.tone === 'brand' && j.alignment === 'center' && j.starts_at === null && j.ends_at === null],
    ['promo_bar', '{"enabled":true,"text_en":"hi","text_ar":"hi","href":"//evil.example/x"}', 'promo_bar', (j) => j.href === ''],
    ['promo_bar', '{"enabled":true,"text_en":"hi","text_ar":"hi","href":"https://evil.example/"}', 'promo_bar', (j) => j.href === ''],
    ['promo_bar', '{"enabled":true,"text_en":"hi","text_ar":"hi","href":"/shop?a=<b>"}', 'promo_bar', (j) => j.href === ''],
    ['promo_bar', '{"enabled":true,"text_en":"hi","text_ar":"hi","href":"/shop?a=1&b=2#top"}', 'promo_bar', (j) => j.href === '/shop?a=1&b=2#top'],
    ['promo_bar', `{"enabled":true,"text_en":"${'x'.repeat(400)}","text_ar":"b"}`, 'promo_bar', (j) => j.text_en.length === 160],
    ['checkout', '{"delivery_fee_fils":"abc","knet":"yes","tpay":[],"cod":{"a":1},"default_method":"javascript:1"}', 'checkout', (j) => j.delivery_fee_fils === 0 && j.methods.includes('knet') && !j.methods.includes('tpay') && j.default_method === 'knet'],
    ['checkout', '{"delivery_fee_fils":-5,"knet":false,"tpay":false,"cod":false}', 'checkout', (j) => j.delivery_fee_fils === 0 && j.methods.join() === 'knet'],
    ['checkout', '{"delivery_fee_fils":99999999999999999999,"cod":true}', 'checkout', (j) => j.delivery_fee_fils === 100000],
    ['checkout', `{"knet":true,"notice_en":"${'n'.repeat(500)}"}`, 'checkout', (j) => j.notice_en.length === 240],
  ]
  const script = `<?php require ${JSON.stringify(join(API, 'store.php'))};
$in = json_decode(file_get_contents($argv[1]), true); $out = []; $keep = [];
foreach ($in as $i => $c) {
  // The readers memoise per PDO OBJECT ID (store_setting_row), and ids are reused once an object
  // is freed, so a new connection per case must stay alive for the whole run.
  $d = new PDO('sqlite::memory:'); $keep[] = $d; $d->exec('create table settings (name text primary key, value text)');
  $d->prepare('insert into settings (name, value) values (?, ?)')->execute([$c[0], $c[1]]);
  $out[$i] = match ($c[2]) { 'hero' => store_setting($d, 'hero'), 'promo_bar' => store_topbar_setting($d), 'checkout' => store_checkout_setting($d), 'theme' => store_setting($d, 'theme') };
}
echo json_encode($out);`
  const f = join(TMP, 'g-cases.json'); writeFileSync(f, JSON.stringify(cases.map((c) => [c[0], c[1], c[2]])))
  const r = runPhp(script, [f])
  let out = null
  try { out = JSON.parse(r.out) } catch { /* reported below */ }
  is(out !== null, 'the public readers answer for every hostile row without an exception', r.out.slice(0, 120) || r.err.slice(0, 120))
  if (out) cases.forEach(([n, raw, , check], i) => is(check(out[i]), `${n} <- ${raw.slice(0, 70)}${raw.length > 70 ? '…' : ''}`, JSON.stringify(out[i]).slice(0, 150)))

  // The raw merge: hero and theme are returned as stored, merged over defaults.
  // (promo_bar and checkout are re-validated field by field on every read.)
  const rawMerge = JSON.parse(runPhp(`<?php require ${JSON.stringify(join(API, 'store.php'))};
$d = new PDO('sqlite::memory:'); $d->exec('create table settings (name text primary key, value text)');
$d->prepare('insert into settings values (?, ?)')->execute(['hero', '{"speed_ms":{"a":1},"size":["x"],"extra":"<img src=x onerror=1>"}']);
$d->prepare('insert into settings values (?, ?)')->execute(['theme', '{"brand":"</style><script>alert(1)</script>","dark":"x"}']);
echo json_encode(['hero' => store_setting($d, 'hero'), 'theme' => store_setting($d, 'theme')]);`).out)
  known('config-11', typeof rawMerge.hero.speed_ms === 'object' && rawMerge.theme.brand.includes('<script>'),
    'public hero and theme answers return the stored JSON unvalidated (types, extra keys, a non-hex colour); only the SAVE route whitelists them',
    'store_setting() is array_merge(defaults, row); promo_bar and checkout have normalising readers, these two do not; the live theme consumer is the compiled bundle (not auditable here)')
  // An INF in the row (1e999) is valid for json_decode and fatal for json_encode.
  const inf = runPhp(`<?php require ${JSON.stringify(join(API, 'store.php'))};
$d = new PDO('sqlite::memory:'); $d->exec('create table settings (name text primary key, value text)');
$d->prepare('insert into settings values (?, ?)')->execute(['hero', '{"speed_ms":1e999}']);
$flags = JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
echo json_encode(json_encode(store_setting($d, 'hero'), $flags));`).out
  known('config-12', inf === 'false',
    'a hero row holding 1e999 makes json_encode() fail, and store_out() echoes nothing: the public /api slides answer is HTTP 200 with an EMPTY body',
    'store_out() never checks json_encode() for false (the same happens for any invalid UTF-8 in a row); fix = JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR, and read hero through a validator')
  // The save routes: every branch of settings_save clamps or whitelists.
  const admin = SRC['php-store/admin.php'].text
  const save = admin.slice(admin.indexOf("if ($r === 'settings_save'"), admin.indexOf('// ------------------------------------------------------------- blocked numbers'))
  is(/max\(2000, min\(30000/.test(save), 'settings_save hero: speed_ms is clamped to 2000..30000')
  is(/in_array\(\$v\['size'\] \?\? '', \['short', 'tall', 'full'\], true\)/.test(save), 'settings_save hero: size is an enum')
  is(/store_internal_href\(\$v\['href'\]/.test(save) && /in_array\(\$tone, \['brand', 'ink', 'silver'\], true\)/.test(save) && /store_text\(\$v\['text_en'\][^)]*160\)/.test(save), 'settings_save promo_bar: same-origin href, tone enum, text capped at 160')
  is(/\(float\)\$fee > 100/.test(save) && /mb_substr\(trim\(\(string\)\(\$v\['notice_en'\] \?\? ''\)\), 0, 240\)/.test(save), 'settings_save checkout: fee 0..100 KWD, notices capped at 240')
  is(/preg_match\('\/\^#\[0-9a-f\]\{6\}\$\/', \$v\)/.test(save), 'settings_save theme: colours must be #rrggbb')
  is(/\$n > 100000000/.test(save), 'settings_save inventory_finance: amounts 0..100,000,000')
  is(/store_fail\('unknown_setting'\)/.test(save), 'settings_save: an unknown setting name is refused')
  known('config-13', /'shuffle'\s*=> !empty\(\$v\['shuffle'\]\)/.test(save) && /'dark' => !empty\(\$v\['dark'\]\)/.test(save),
    "settings_save reads hero.shuffle / hero.autoplay / theme.dark with !empty(): the string 'false' switches them ON, and a body that omits autoplay switches it OFF (default is on)",
    'the admin UI always sends complete JSON booleans; only a hand-made request is affected; fix = is_bool() with a fallback, as promo_bar already does')
  known('config-14', /'brand' => \$hex\(\$v\['brand'\] \?\? '', '#c76a42'\)/.test(save) && /'brand' => '#c76a42'/.test(readFileSync(join(DROPIN, 'php-store', 'store.php'), 'utf8')),
    'the theme defaults and the invalid-colour fallback are #c76a42 / #99452b (terracotta), not the brand orange #E0561C / #FF7B17 in CLAUDE.md',
    'store.php STORE_SETTING_DEFAULTS and admin.php settings_save; the owner decides whether the default theme should follow the brand')
}

// ============================================ H. public/config.js and its use
head('H. public/config.js — runtime config the browser reads')
{
  const cfg = readFileSync(join(WEB, 'public', 'config.js'), 'utf8')
  const live = cfg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const keys = [...live.matchAll(/^\s*([A-Za-z]+)\s*:\s*'([^']*)'/gm)]
  is(keys.map((m) => m[1]).sort().join() === 'cbkBaseUrl,payBaseUrl,phpApiUrl', 'config.js sets exactly payBaseUrl, cbkBaseUrl, phpApiUrl', keys.map((m) => m[1]).join())
  is(keys.every((m) => m[2] === ''), 'and all three are empty (the built-in defaults are the production config)')
  is(!/(secret|password|passwd|token|api[_-]?key|resource|encrp|tranportal)/i.test(live), 'no secret-looking word in the live part of config.js')
  is(/window\.SPORTA_CONFIG\s*=\s*\{/.test(live), 'config.js assigns window.SPORTA_CONFIG')
  const rc = readFileSync(join(WEB, 'src', 'lib', 'runtimeConfig.js'), 'utf8')
  is(/typeof v === 'string'/.test(rc) && /\.trim\(\)/.test(rc), 'configValue accepts only non-empty strings and trims them')
  const users = readdirSync(join(WEB, 'src'), { recursive: true }).filter((p) => /\.(js|jsx)$/.test(p)).flatMap((p) => {
    const t = readFileSync(join(WEB, 'src', p), 'utf8')
    return [...t.matchAll(/configValue\('([A-Za-z]+)'/g)].map((m) => `${m[1]}@${p}`)
  })
  is(users.map((u) => u.split('@')[0]).sort().join() === 'cbkBaseUrl,payBaseUrl,phpApiUrl', 'only those three keys are read through configValue()', users.join(' '))
  const checkout = readFileSync(join(WEB, 'src', 'lib', 'checkout.js'), 'utf8')
  const navTargets = [...checkout.matchAll(/window\.location\.href = `([^`]*)`/g)].map((m) => m[1])
  is(navTargets.some((t) => t.startsWith('${PAY_BASE}')), 'the handoff to the bank is a navigation to PAY_BASE', navTargets.join(' | '))
  const handoffQuery = [...checkout.matchAll(/params\.set\('([a-z]+)'|p\.set\('([a-z]+)'|new URLSearchParams\(\{([^}]*)\}\)/g)].map((m) => m[1] || m[2] || m[3]).join(' ')
  is(!/card|pan|cvv|expiry|password/i.test(handoffQuery), 'the query sent to the gateway folder carries no card field (the card is typed on the bank page)', handoffQuery.trim().slice(0, 100))
  known('config-15', !/new URL\(|allow|origin ===|startsWith\('https:\/\/www\.sporta/.test(rc + checkout.slice(0, checkout.indexOf('class CheckoutError'))),
    'payBaseUrl / cbkBaseUrl / phpApiUrl are used as written: no check against the page origin or an allow-list',
    'a wrong value edited into config.js sends the shopper (with the order number and language) to that origin; CSP connect-src stops the API ones; navigation is not covered')
  const ht = readFileSync(join(WEB, 'public', '.htaccess'), 'utf8')
  const csp = (ht.match(/Header set Content-Security-Policy "([^"]*)"/) ?? [])[1] ?? ''
  is(/connect-src 'self'(;|$)/.test(csp), "CSP connect-src is 'self': a foreign phpApiUrl cannot be fetched")
  is(/form-action 'self' https:\/\/kpay\.com\.kw https:\/\/kpaytest\.com\.kw/.test(csp), 'CSP form-action allows only self and the two KNET hosts')
  const scriptSrc = (csp.match(/script-src ([^;]*)/) ?? [])[1] ?? ''
  is(!/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc), 'CSP script-src has no unsafe-inline / unsafe-eval: a javascript: value cannot run', scriptSrc.slice(0, 80))
  is(!/\*/.test(csp.replace(/__SCRIPT_HASHES__/, '')), 'CSP has no wildcard source')
  is(!/Access-Control-Allow-Origin/i.test(ht) && !Object.values(SRC).some(({ text }) => /Access-Control-Allow-Origin/i.test(text)), 'no CORS header anywhere: the API is same-origin only')
  const deployCfg = JSON.parse(readFileSync(join(WEB, 'deploy.config.json'), 'utf8'))
  const keep = JSON.stringify(deployCfg)
  is(/config\.js/.test(keep) && /knet\/config\.php/.test(keep), 'deploy.config.json keeps config.js and knet/config.php out of every upload')
}

// ================================================================= result
console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'}  ${fails} failing check${fails === 1 ? '' : 's'}, ${knownGaps} known gap${knownGaps === 1 ? '' : 's'} still open`)
process.exit(fails === 0 ? 0 : 1)
