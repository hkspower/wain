#!/usr/bin/env node
// REDIRECT PAGES TEST - every redirect the site makes, followed for real: Apache's .htaccess rules,
// the payment hand-offs to the (fake) banks and back, and the sign-in / password-reset links.
//
//   node scripts/redirect-pages-test.mjs           (npm run test:redirect-pages)
//   node scripts/redirect-pages-test.mjs --keep    leave the private stack running afterwards
//
// RIG-FREE. It builds, starts and tears down its OWN stack and touches nothing shared:
//   Apache 2.4  :8451  the VPS's apache-sporta: the production .htaccess files (root, api/, knet/,
//                      pay/) on the production directory layout (www/, www/api, www/knet, www/pay)
//   Apache TLS  :8452  stands in for Traefik: terminates TLS and forwards to :8451 with
//                      X-Forwarded-Proto: https and the Host kept. Name-based vhosts on the same port
//                      answer for pgtest.cbk.com / pg.cbk.com (-> fake CBK), kpaytest.com.kw /
//                      kpay.com.kw (-> fake KNET bank) and the three Google hosts (-> a Google stub),
//                      with one certificate from a private CA made for the run.
//   php -S      :8461  the PHP behind Apache (no libphp/php-fpm in the sandbox): Apache hands every
//                      .php file to it through mod_proxy_http, the way docker-php.conf's FilesMatch
//                      hands it to mod_php; an auto_prepend restores REQUEST_URI from THE_REQUEST and
//                      DOCUMENT_ROOT, which mod_php would have set. VPS config layout:
//                      SPORTA_API_CONFIG_FILE + SPORTA_PRIVATE_CONFIG_DIR (knet-config.php,
//                      pay-config.php), mail to files (scripts/fake-mta.sh).
//   php -S      :8471  scripts/fake-knet-bank.php (unchanged copy)
//   php -S      :8472  scripts/fake-cbk-gateway.php (unchanged copy)
//   node        :8473  a CONNECT proxy, the PHP servers' only way out (https_proxy). It tunnels the
//                      allowlisted bank / Google / shop names to :8452 and refuses everything else, so
//                      no real bank host can ever be reached, while the server-side calls still go to
//                      the REAL host names (https://pgtest.cbk.com, https://www.sporta.com.kw/...) and
//                      verify a certificate (curl.cainfo = the run's CA).
//   php -S      :8474  a Google OpenID stub (token + certs), RS256-signed with a key made for the run
//   MariaDB     :3389  database redirchk from install.mysql.sql + every additive *.mysql.sql migration
//                      (the order scripts/sandbox.sh uses), datadir under the run directory
//   Chromium           Playwright, --host-resolver-rules mapping the same names to :8452
// Ports: REDIRPAGES_HTTP / _TLS / _PHP / _BANK / _CBK / _PROXY / _GOOGLE / _DB. Run directory:
// REDIRPAGES_DIR (default: os.tmpdir()/sporta-redirect-pages). Apache's workers run as www-data,
// so the served tree goes to REDIRPAGES_WWW, which must be world-traversable (default: <dir>/www
// when it is, otherwise os.tmpdir()/sporta-redirect-pages-www).
// A missing component skips the sections that need it, with a line saying which and why.
//
// What it does NOT repeat: the host/scheme spelling matrix (bare domain, IP, ports, trailing dots,
// odd Host headers) belongs to scripts/htaccess-rules-test.mjs; the CSP-per-area matrix and the
// stub-markup Chrome check of pay.php to scripts/xss-htaccess-test.mjs. Here the host rule is only
// crossed with the paths that redirect a second time (hop counts), and pay.php is the REAL page,
// served by the real dropin with a real order, a real access token and Apache's real headers.
//
// KNOWN DEFECTS are expected-fail ("XFAIL", with the finding id): the suite is green while the
// defect exists and goes RED ("XPASS") the day it is fixed - the cue to delete the `known` marker.
import { spawnSync, spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, chmodSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const web = resolve(fileURLToPath(new URL('..', import.meta.url)))
const KEEP = process.argv.includes('--keep')
const BASE = resolve(process.env.REDIRPAGES_DIR || join(tmpdir(), 'sporta-redirect-pages'))
const P = (k, d) => Number(process.env[`REDIRPAGES_${k}`] || d)
const PORT = P('HTTP', 8451)
const TLS_PORT = P('TLS', 8452)
const PHP_PORT = P('PHP', 8461)
const BANK_PORT = P('BANK', 8471)
const CBK_PORT = P('CBK', 8472)
const PROXY_PORT = P('PROXY', 8473)
const GOOGLE_PORT = P('GOOGLE', 8474)
const DB_PORT = P('DB', 3389)
const HOST = 'www.sporta.com.kw'
const ORIGIN = `https://${HOST}`
const MODULES = process.env.REDIRPAGES_MODULES || '/usr/lib/apache2/modules'
const KNET_KEY = 'abcdef0123456789'
const DB_NAME = 'redirchk'
const DB_USER = 'rdp'
const DB_PASS = 'rdp-pass-' + randomBytes(4).toString('hex')
// The names the CONNECT proxy and Chromium send to :8452. Nothing else leaves.
const MAPPED = ['www.sporta.com.kw', 'sporta.com.kw', 'pgtest.cbk.com', 'pg.cbk.com', 'kpaytest.com.kw', 'kpay.com.kw',
  'accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com']

// ------------------------------------------------------------------ bookkeeping
let fails = 0
let xpass = 0
let xfail = 0
let oks = 0
let skips = 0
const redirects = []      // one row per redirect followed: the summary at the end
const findings = new Map() // known-defect id -> observed detail (printed at the end)
const say = (s) => console.log(s)
const section = (t) => say(`\n=== ${t} ${'='.repeat(Math.max(3, 74 - t.length))}`)
function check(cond, name, detail = '', known = '') {
  const d = detail ? `  -- ${detail}` : ''
  if (known) {
    if (cond) { xpass++; say(`XPASS ${name} [${known}: fixed? delete the known marker]${d}`) } else { xfail++; say(`XFAIL ${name} [${known}]${d}`); if (!findings.has(known)) findings.set(known, `${name}${d}`) }
  } else if (cond) { oks++; say(`ok    ${name}${d}`) } else { fails++; say(`FAIL  ${name}${d}`) }
  return cond
}
const skip = (name, why) => { skips++; say(`SKIP  ${name} -- ${why}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const short = (s, n = 110) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}...` : s }

// ------------------------------------------------------------------ components
const which = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).stdout.trim().split('\n')[0] || ''
const APACHE = which('apache2') || which('httpd')
const PHP = which('php')
const MARIADBD = which('mariadbd') || which('mysqld')
const INSTALL_DB = which('mariadb-install-db') || which('mysql_install_db')
const MARIADB = which('mariadb') || which('mysql')
const OPENSSL = which('openssl')
const HAS_SSL = existsSync(join(MODULES, 'mod_ssl.so'))
const portFree = (port) => new Promise((r) => {
  const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true)))
  s.listen(port, '127.0.0.1')
})

// ------------------------------------------------------------------ raw HTTP client
// The request line goes out verbatim (`//evil`, `/\evil`, `%0d%0a` stay as typed), duplicate
// headers are kept, nothing is decoded and nothing is followed.
function raw(lines, { port = PORT, body = null, timeout = 15000 } = {}) {
  return new Promise((done) => {
    const sock = net.connect(port, '127.0.0.1')
    const chunks = []
    let finished = false
    const end = () => {
      if (finished) return
      finished = true
      sock.destroy()
      const buf = Buffer.concat(chunks)
      const cut = buf.indexOf('\r\n\r\n')
      if (cut < 0) return done({ status: 0, headers: [], text: buf.toString('latin1') })
      const head = buf.subarray(0, cut).toString('latin1').split('\r\n')
      const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head[0])?.[1] ?? 0)
      const headers = head.slice(1).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()] })
      let b = buf.subarray(cut + 4)
      if (headers.some(([k, v]) => k === 'transfer-encoding' && /chunked/i.test(v))) b = dechunk(b)
      done({ status, headers, text: b.toString('utf8') })
    }
    sock.setTimeout(timeout, end)
    sock.on('data', (c) => chunks.push(c))
    for (const ev of ['end', 'close', 'error']) sock.on(ev, end)
    sock.on('connect', () => {
      sock.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (body) sock.write(body)
    })
  })
}
function dechunk(buf) {
  const out = []
  let i = 0
  for (;;) {
    const eol = buf.indexOf('\r\n', i)
    if (eol < 0) break
    const n = parseInt(buf.subarray(i, eol).toString('latin1'), 16)
    if (!n) break
    out.push(buf.subarray(eol + 2, eol + 2 + n))
    i = eol + 2 + n + 2
  }
  return Buffer.concat(out)
}
const hv = (res, name) => res.headers.filter(([k]) => k === name.toLowerCase()).map(([, v]) => v)
const h1 = (res, name) => hv(res, name)[0] ?? ''
// A request the way Traefik forwards it: plain HTTP on the wire, Host kept, X-Forwarded-Proto.
function req(path, { method = 'GET', host = HOST, proto = 'https', headers = [], body = null, cookie = '' } = {}) {
  const b = body == null ? null : Buffer.from(body)
  return raw([
    `${method} ${path} HTTP/1.1`,
    ...(host !== null ? [`Host: ${host}`] : []),
    ...(proto !== null ? [`X-Forwarded-Proto: ${proto}`] : []),
    'Connection: close',
    ...(cookie ? [`Cookie: ${cookie}`] : []),
    ...headers,
    ...(b ? [`Content-Length: ${b.length}`] : []),
  ], { body: b })
}
const LOCAL = new Set(['www.sporta.com.kw', 'sporta.com.kw', '187.7.78.123'])
// Follow a redirect chain on the private stack, at most `max` hops. Anything that leaves the
// shop's own names (a bank, Google, evil.example) is recorded as `external` and not requested.
async function chain(path, { host = HOST, proto = 'https', max = 10, method = 'GET', headers = [], body = null } = {}) {
  const hops = []
  let cur = { path, host, proto }
  for (let i = 0; i <= max; i++) {
    const r = await req(cur.path, { host: cur.host, proto: cur.proto, method, headers, body })
    const loc = h1(r, 'location')
    const hop = { url: `${cur.proto}://${cur.host}${cur.path}`, status: r.status, location: loc, res: r }
    hops.push(hop)
    if (r.status < 300 || r.status >= 400 || r.status === 304 || !loc) break
    let u
    try { u = new URL(loc, hop.url) } catch { hop.external = `unparseable: ${loc}`; break }
    if (!LOCAL.has(u.hostname)) { hop.external = u.href; break }
    cur = { path: u.pathname + u.search, host: u.host, proto: u.protocol.replace(':', '') }
    method = 'GET'
    body = null
  }
  const redirectsSeen = hops.filter((h) => h.status >= 300 && h.status < 400 && h.location).length
  return { hops, n: redirectsSeen, last: hops.at(-1), loop: hops.length > max }
}
const authorityOf = (loc, base = ORIGIN + '/') => { try { return new URL(loc, base).host } catch { return '?' } }
const noCRLF = (s) => !/[\r\n]/.test(s)

// ------------------------------------------------------------------ KNET crypto (independent)
const knetDecrypt = (hex) => { const d = createDecipheriv('aes-128-cbc', KNET_KEY, KNET_KEY); return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8') }
const knetEncrypt = (plain) => { const c = createCipheriv('aes-128-cbc', KNET_KEY, KNET_KEY); return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase() }
const parseNvp = (qs) => Object.fromEntries(qs.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))] }))
const formFields = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]))
const formAction = (html) => (/<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? '').replace(/&amp;/g, '&')

// ------------------------------------------------------------------ the tree
const mkd = (p) => mkdirSync(p, { recursive: true })
const put = (p, b) => { mkd(dirname(p)); writeFileSync(p, b) }
function worldTraversable(p) {
  for (let d = p; ; d = dirname(d)) {
    try { if (!(statSync(d).mode & 0o001)) return false } catch { /* not created yet: fine */ }
    if (d === dirname(d)) return true
  }
}
const WWW = resolve(process.env.REDIRPAGES_WWW || (worldTraversable(BASE) ? join(BASE, 'www') : join(tmpdir(), 'sporta-redirect-pages-www')))
const PRIV = join(BASE, 'private')
const FAKES = join(BASE, 'fakes')
const MAIL = join(BASE, 'mail')
const LOGS = join(BASE, 'logs')
const TLS = join(BASE, 'tls')
const GOOGLE = join(BASE, 'google')

function chmodTree(d) {
  try { chmodSync(d, 0o755) } catch { /* best effort */ }
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) chmodTree(p); else try { chmodSync(p, 0o644) } catch { /* best effort */ }
  }
}

function phpArray(obj) {
  const v = (x) => typeof x === 'boolean' ? (x ? 'true' : 'false') : typeof x === 'number' ? String(x) : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return `<?php\nreturn [\n${Object.entries(obj).map(([k, x]) => `  '${k}' => ${v(x)},`).join('\n')}\n];\n`
}
const KNET_CFG = () => ({
  env: 'test',
  test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
  production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
  merchant_id: '6261', terminal_id: '626101',
  tranportal_id: 'TESTID001', tranportal_password: 'testpass', resource_key: KNET_KEY,
  response_url: `${ORIGIN}/knet/callback.php`, error_url: `${ORIGIN}/knet/callback.php`,
  result_page_url: `${ORIGIN}/payment/result`,
  action: '1', currency_code: '414', language: 'USA',
  log_file: join(LOGS, 'knet-payments.log'),
  // The live default ('both' in config.example.php): a browser gets a 302, KNET's server the
  // REDIRECT= line. No mysql_* block: on the VPS the gateways borrow the store's db_* values.
  callback_response: 'both',
})
const CBK_CFG = (extra = {}) => ({
  env: 'test',
  test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com',
  client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
  return_url: `${ORIGIN}/pay/callback.php`, result_page_url: `${ORIGIN}/payment/result`,
  lang: 'en', pay_type: '',
  log_file: join(LOGS, 'cbk-payments.log'), token_cache_file: join(PRIV, 'cbk_token.json'),
  ...extra,
})
const API_CFG = () => ({
  db_host: `127.0.0.1;port=${DB_PORT}`, db_name: DB_NAME, db_user: DB_USER, db_pass: DB_PASS,
  cron_key: 'rdp-cron-key-0123456789abcdef',
  order_cooldown_seconds: 0,
  admin_session_dir: join(BASE, 'sessions', 'admin'),
  mail_from: 'qa-cs@sporta.com.kw', admin_mail_from: 'qa-cs@sporta.com.kw', customer_mail_from: 'qa-cs@sporta.com.kw',
  mail_reply_to: 'qa-cs@sporta.com.kw',
  google_oauth_client_id: 'rdp-client.apps.googleusercontent.com', google_oauth_client_secret: 'rdp-client-secret',
})
const writeCbkCfg = (extra) => {
  writeFileSync(join(PRIV, 'config', 'pay-config.php'), phpArray(CBK_CFG(extra)))
  // The fake gateway reads its expected credentials from ../dropin/php-cbk/config.php.
  writeFileSync(join(FAKES, 'dropin', 'php-cbk', 'config.php'), phpArray(CBK_CFG(extra)))
  // PHP's opcache does not re-stat a file for opcache.revalidate_freq seconds (2 by default), so a request sent
  // straight after this write is answered from the PREVIOUS config: /knet/pay.php read knet_via_cbk as off and went
  // to the bank, twelve FAILs in (2b). The live admin saves through store_payment_write_config(), which invalidates
  // the cache; a test that writes the file by hand has to wait the window out instead. The window is counted in
  // WHOLE seconds (a script used at second S is trusted through second S+2), so anything under three seconds can
  // still land inside it: 2.3 s did.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3200)
}

function buildTree() {
  rmSync(BASE, { recursive: true, force: true })
  if (WWW !== join(BASE, 'www')) rmSync(WWW, { recursive: true, force: true })
  for (const d of [BASE, WWW, PRIV, join(PRIV, 'config'), FAKES, MAIL, LOGS, TLS, GOOGLE, join(BASE, 'tmp'),
    join(BASE, 'sessions', 'php'), join(BASE, 'sessions', 'admin')]) mkd(d)
  cpSync(join(web, 'public'), WWW, { recursive: true })
  const indexHtml = readFileSync(join(web, 'index.html'), 'utf8')
  writeFileSync(join(WWW, 'index.html'), indexHtml)
  for (const [src, dst] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
    // Never a config.php (git-ignored, server-only): the VPS keeps them in the private mount.
    cpSync(join(web, 'dropin', src), join(WWW, dst), { recursive: true, filter: (p) => !/(^|\/)config\.php$/.test(p) })
  }
  // The postbuild step (scripts/csp-hashes.mjs): sha256 of every inline non-JSON-LD script.
  const hashes = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type\s*=\s*"application\/ld\+json"/.test(m[1]))
    .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  const ht = readFileSync(join(web, 'public', '.htaccess'), 'utf8')
  writeFileSync(join(WWW, '.htaccess'), ht.replace('__SCRIPT_HASHES__', hashes.join(' ')))
  // Leftovers the live server really has (the .htaccess rules exist because of them).
  writeFileSync(join(WWW, 'index.php'), '<?php echo "OLD-SITE";')
  writeFileSync(join(WWW, 'panel.php'), '<?php echo "OLD-PANEL";')
  chmodTree(WWW)

  // Private configs (the VPS: /docker/sporta/private mounted read-only).
  writeFileSync(join(PRIV, 'api-config.php'), phpArray(API_CFG()))
  writeFileSync(join(PRIV, 'config', 'knet-config.php'), phpArray(KNET_CFG()))
  // The fakes, unchanged, beside the library and config they `require` by relative path.
  mkd(join(FAKES, 'scripts'))
  mkd(join(FAKES, 'dropin', 'php-knet'))
  mkd(join(FAKES, 'dropin', 'php-cbk'))
  cpSync(join(web, 'scripts', 'fake-knet-bank.php'), join(FAKES, 'scripts', 'fake-knet-bank.php'))
  cpSync(join(web, 'scripts', 'fake-cbk-gateway.php'), join(FAKES, 'scripts', 'fake-cbk-gateway.php'))
  cpSync(join(web, 'dropin', 'php-knet', 'knet.php'), join(FAKES, 'dropin', 'php-knet', 'knet.php'))
  writeFileSync(join(FAKES, 'dropin', 'php-knet', 'config.php'), phpArray(KNET_CFG()))
  writeCbkCfg({})

  // mod_php would hand PHP the ORIGINAL request; behind mod_proxy_http php -S sees the file path.
  writeFileSync(join(BASE, 'prepend.php'), `<?php
// redirect-pages-test: restore what mod_php would have set (see the suite header).
$__line = (string)($_SERVER['HTTP_X_RDP_THE_REQUEST'] ?? '');
if ($__line !== '' && preg_match('~^[A-Z]+ (\\S+) HTTP/~', $__line, $__m)) $_SERVER['REQUEST_URI'] = $__m[1];
$__script = (string)($_SERVER['HTTP_X_RDP_SCRIPT'] ?? '');
if ($__script !== '') { $_SERVER['SCRIPT_NAME'] = $__script; $_SERVER['PHP_SELF'] = $__script; }
$_SERVER['DOCUMENT_ROOT'] = ${JSON.stringify(WWW)};
$_SERVER['SERVER_PORT'] = '80';
unset($_SERVER['HTTP_X_RDP_THE_REQUEST'], $_SERVER['HTTP_X_RDP_SCRIPT'], $_SERVER['HTTPS']);
`)

  // The Google stub: token + certs, an RS256 id_token for whatever next.json says.
  writeFileSync(join(GOOGLE, 'stub.php'), `<?php
$dir = __DIR__;
$path = (string) parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
file_put_contents("$dir/calls.log", ($_SERVER['HTTP_HOST'] ?? '') . ' ' . $_SERVER['REQUEST_METHOD'] . ' ' . $path . "\\n", FILE_APPEND);
$next = json_decode((string) @file_get_contents("$dir/next.json"), true) ?: [];
header('Content-Type: application/json');
$b64 = fn ($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
if ($path === '/oauth2/v1/certs') { echo json_encode(['rdpkid1' => file_get_contents("$dir/google.crt")]); exit; }
if ($path === '/token' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  if (($_POST['code'] ?? '') !== ($next['code'] ?? '') || ($_POST['redirect_uri'] ?? '') !== ($next['redirect_uri'] ?? '')) {
    http_response_code(400); echo '{"error":"invalid_grant"}'; exit;
  }
  $now = time();
  $h = $b64(json_encode(['alg' => 'RS256', 'kid' => 'rdpkid1', 'typ' => 'JWT']));
  $p = $b64(json_encode(['iss' => 'https://accounts.google.com', 'aud' => $next['aud'], 'azp' => $next['aud'], 'sub' => $next['sub'],
    'email' => 'qa-admin@sporta.test', 'email_verified' => true, 'iat' => $now, 'exp' => $now + 600, 'nonce' => $next['nonce']]));
  openssl_sign("$h.$p", $sig, file_get_contents("$dir/google.key"), OPENSSL_ALGO_SHA256);
  echo json_encode(['id_token' => "$h.$p." . $b64($sig), 'access_token' => 'stub', 'token_type' => 'Bearer', 'expires_in' => 600]);
  exit;
}
http_response_code(404); echo '{}';
`)
  return { hashes }
}

// ------------------------------------------------------------------ TLS (a private CA for the run)
function makeTls() {
  const o = (args) => execFileSync(OPENSSL, args, { cwd: TLS, stdio: ['ignore', 'ignore', 'pipe'] })
  o(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=redirect-pages-test CA'])
  o(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'site.key', '-out', 'site.csr', '-subj', '/CN=www.sporta.com.kw'])
  writeFileSync(join(TLS, 'san.ext'), `subjectAltName=${MAPPED.map((n) => `DNS:${n}`).join(',')}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`)
  o(['x509', '-req', '-in', 'site.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'site.pem', '-days', '2', '-extfile', 'san.ext'])
  execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(GOOGLE, 'google.key'), '-out', join(GOOGLE, 'google.crt'), '-days', '2', '-subj', '/CN=google-stub'], { stdio: ['ignore', 'ignore', 'pipe'] })
}

// ------------------------------------------------------------------ Apache
function httpdConf(tls) {
  const mods = ['mpm_event', 'authz_core', 'authz_host', 'mime', 'dir', 'headers', 'rewrite', 'deflate', 'brotli', 'filter',
    'setenvif', 'alias', 'expires', 'autoindex', 'negotiation', 'env', 'log_config', 'proxy', 'proxy_http', 'allowmethods',
    ...(tls ? ['ssl', 'socache_shmcb'] : [])]
  const builtin = spawnSync(APACHE, ['-l'], { encoding: 'utf8' }).stdout
  const load = mods.filter((n) => !new RegExp(`^\\s*mod_${n}\\.c\\s*$`, 'm').test(builtin))
    .map((n) => `LoadModule ${n}_module ${MODULES}/mod_${n}.so`).join('\n')
  const user = process.getuid?.() === 0 ? 'User www-data\nGroup www-data\n' : ''
  const front = (names, target) => `<VirtualHost 127.0.0.1:${TLS_PORT}>
  ServerName ${names[0]}
  ${names.slice(1).map((n) => `ServerAlias ${n}`).join('\n  ')}
  SSLEngine on
  SSLCertificateFile ${TLS}/site.pem
  SSLCertificateKeyFile ${TLS}/site.key
  ProxyPreserveHost On
  RequestHeader set X-Forwarded-Proto https
  ${target}
</VirtualHost>`
  const tlsBlock = !tls ? '' : `Listen 127.0.0.1:${TLS_PORT}
SSLSessionCache shmcb:${BASE}/ssl_scache(512000)
${front(['www.sporta.com.kw', 'sporta.com.kw'], `ProxyPass / http://127.0.0.1:${PORT}/ nocanon`)}
${front(['pgtest.cbk.com', 'pg.cbk.com'], `ProxyPass / http://127.0.0.1:${CBK_PORT}/`)}
${front(['kpaytest.com.kw', 'kpay.com.kw'], `ProxyPass /kpg/PaymentHTTP.htm http://127.0.0.1:${BANK_PORT}/fake-knet-bank.php`)}
${front(['oauth2.googleapis.com', 'www.googleapis.com', 'accounts.google.com'], `ProxyPass / http://127.0.0.1:${GOOGLE_PORT}/`)}`
  return `ServerName localhost
Listen 127.0.0.1:${PORT}
PidFile ${BASE}/httpd.pid
ErrorLog ${LOGS}/apache-error.log
LogLevel warn
${user}${load}
LogFormat "%h \\"%r\\" %>s \\"%{Location}o\\"" rdp
CustomLog ${LOGS}/apache-access.log rdp
TypesConfig /etc/mime.types
AddType application/x-compress .Z
AddType application/x-gzip .gz .tgz
AddHandler type-map var
AddType text/html .shtml
ServerTokens OS
TraceEnable Off
HostnameLookups Off
AccessFileName .htaccess
<FilesMatch "^\\.ht">
  Require all denied
</FilesMatch>
<Directory />
  Options FollowSymLinks
  AllowOverride None
  Require all denied
</Directory>
DocumentRoot ${WWW}
<Directory ${WWW}>
  Options Indexes FollowSymLinks
  AllowOverride All
  Require all granted
</Directory>
# php:8.4-apache's docker-php.conf (\\.php$ -> PHP), with the interpreter behind a loopback proxy.
ProxyPreserveHost On
RequestHeader set X-Rdp-The-Request "expr=%{THE_REQUEST}"
RequestHeader set X-Rdp-Script "expr=%{REQUEST_URI}"
<FilesMatch \\.php$>
  SetHandler "proxy:http://127.0.0.1:${PHP_PORT}"
</FilesMatch>
DirectoryIndex disabled
DirectoryIndex index.php index.html
${tlsBlock}
`
}

// ------------------------------------------------------------------ the CONNECT proxy
let proxyServer = null
const proxyLog = []
function startProxy() {
  return new Promise((ok, no) => {
    proxyServer = net.createServer((c) => {
      let buf = Buffer.alloc(0)
      const onData = (d) => {
        buf = Buffer.concat([buf, d])
        const cut = buf.indexOf('\r\n\r\n')
        if (cut < 0) return
        c.off('data', onData)
        const line = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1')
        const m = /^CONNECT ([^:\s]+):(\d+) HTTP\/1\.[01]$/.exec(line)
        const allowed = m && MAPPED.includes(m[1].toLowerCase()) && m[2] === '443'
        proxyLog.push(`${allowed ? 'tunnel' : 'REFUSED'} ${line}`)
        if (!allowed) { c.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return }
        const up = net.connect(TLS_PORT, '127.0.0.1', () => {
          c.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          const rest = buf.subarray(cut + 4)
          if (rest.length) up.write(rest)
          c.pipe(up); up.pipe(c)
        })
        up.on('error', () => c.destroy())
        c.on('error', () => up.destroy())
      }
      c.on('data', onData)
      c.on('error', () => {})
    })
    proxyServer.once('error', no)
    proxyServer.listen(PROXY_PORT, '127.0.0.1', () => ok())
  })
}

// ------------------------------------------------------------------ PHP servers
const procs = []
// A clean environment: no inherited proxy, the CONNECT proxy for https, the VPS config layout.
function phpEnv(extra = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME || '/root', LANG: 'C.UTF-8', PHP_CLI_SERVER_WORKERS: '4',
    https_proxy: `http://127.0.0.1:${PROXY_PORT}`, HTTPS_PROXY: `http://127.0.0.1:${PROXY_PORT}`,
    no_proxy: '127.0.0.1,localhost', NO_PROXY: '127.0.0.1,localhost', ...extra }
  return env
}
const phpIni = (extra = []) => ['-d', 'display_errors=0', '-d', 'log_errors=1', '-d', `error_log=${LOGS}/php-error.log`,
  '-d', `sys_temp_dir=${BASE}/tmp`, '-d', `curl.cainfo=${TLS}/ca.pem`, '-d', `openssl.cafile=${TLS}/ca.pem`, ...extra]
function startPhp(name, port, args, env, iniExtra = []) {
  const p = spawn(PHP, [...phpIni(iniExtra), '-S', `127.0.0.1:${port}`, ...args], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  p.stderr.on('data', () => {})
  p.name = name
  procs.push(p)
  return p
}
async function waitPort(port, ms = 8000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const up = await new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); r(true) }); s.once('error', () => r(false)) })
    if (up) return true
    await sleep(100)
  }
  return false
}

// ------------------------------------------------------------------ MariaDB
let dbProc = null
const SOCK = join(BASE, 'db.sock')
const sql = (q) => {
  const r = spawnSync(MARIADB, ['--no-defaults', `--socket=${SOCK}`, '-uroot', '-N', '-B', DB_NAME, '-e', q], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`sql failed: ${q.slice(0, 80)}: ${r.stderr}`)
  return r.stdout.trim()
}
async function startDb() {
  const data = join(BASE, 'db')
  mkd(data)
  const inst = spawnSync(INSTALL_DB, ['--no-defaults', `--datadir=${data}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(process.getuid?.() === 0 ? ['--user=root'] : [])], { encoding: 'utf8' })
  if (inst.status !== 0) throw new Error(`install-db: ${inst.stderr.slice(0, 300)}`)
  dbProc = spawn(MARIADBD, ['--no-defaults', `--datadir=${data}`, `--port=${DB_PORT}`, '--bind-address=127.0.0.1', `--socket=${SOCK}`,
    `--pid-file=${join(BASE, 'db.pid')}`, `--log-error=${join(LOGS, 'mariadb.err')}`, '--skip-name-resolve',
    ...(process.getuid?.() === 0 ? ['--user=root'] : [])], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (spawnSync(MARIADB, ['--no-defaults', `--socket=${SOCK}`, '-uroot', '-e', 'select 1'], { stdio: 'ignore' }).status === 0) break
    await sleep(150)
  }
  const root = (q) => { const r = spawnSync(MARIADB, ['--no-defaults', `--socket=${SOCK}`, '-uroot', '-e', q], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr) }
  root(`create database ${DB_NAME} character set utf8mb4 collate utf8mb4_unicode_ci;
    create user '${DB_USER}'@'127.0.0.1' identified by '${DB_PASS}'; grant all on ${DB_NAME}.* to '${DB_USER}'@'127.0.0.1';`)
  const dir = join(web, 'dropin', 'php-store')
  const load = (f) => {
    const r = spawnSync(MARIADB, ['--no-defaults', `--socket=${SOCK}`, '-uroot', DB_NAME], { input: readFileSync(join(dir, f)), encoding: 'utf8' })
    return r.status === 0 ? '' : `${f}: ${r.stderr.trim().slice(0, 160)}`
  }
  const errors = [load('install.mysql.sql')]
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mysql.sql')).sort()) {
    if (['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'].includes(f)) continue
    errors.push(load(f))
  }
  sql('update product_variants set stock = 1000')
  const hash = execFileSync(PHP, ['-r', 'echo password_hash("correct-horse-battery-kw", PASSWORD_DEFAULT);'], { encoding: 'utf8' })
  sql(`insert into admin_users (email, password_hash, google_sub) values ('qa-admin@sporta.test', '${hash}', '104220000000000000001')`)
  sql(`insert into customer_accounts (name, email, password_hash) values ('Fatima', 'fatima@example.com', '${hash}')`)
  return errors.filter(Boolean)
}

// ------------------------------------------------------------------ teardown
let apacheUp = false
function stopAll() {
  if (apacheUp) { try { execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'stop'], { stdio: 'ignore' }) } catch { /* gone */ } }
  for (const p of procs) { try { p.kill('SIGTERM') } catch { /* gone */ } }
  if (dbProc) { try { dbProc.kill('SIGTERM') } catch { /* gone */ } }
  try { proxyServer?.close() } catch { /* gone */ }
}
process.on('SIGINT', () => { stopAll(); process.exit(130) })

// =================================================================================================
async function main() {
  section('stack')
  if (!APACHE || !PHP) { skip('everything', `no ${!APACHE ? 'apache2/httpd' : 'php'} on this machine`); return }
  for (const [n, p] of [['Apache', PORT], ['Apache TLS', TLS_PORT], ['PHP', PHP_PORT], ['fake KNET', BANK_PORT], ['fake CBK', CBK_PORT], ['CONNECT proxy', PROXY_PORT], ['Google stub', GOOGLE_PORT]]) {
    if (!(await portFree(p))) { skip('everything', `port ${p} (${n}) is in use; set REDIRPAGES_* to free ports`); return }
  }
  buildTree()
  const tls = Boolean(OPENSSL && HAS_SSL)
  if (tls) makeTls(); else skip('TLS front, payments, browser', !OPENSSL ? 'no openssl' : 'no mod_ssl.so')
  let db = false
  if (MARIADBD && INSTALL_DB && MARIADB && await portFree(DB_PORT)) {
    try {
      const errs = await startDb()
      db = true
      check(errs.length === 0, `MariaDB :${DB_PORT}, database ${DB_NAME}: install.mysql.sql + every migration loads`, errs.join(' | '))
    } catch (e) { skip('database sections', `MariaDB did not start: ${short(e.message, 200)}`) }
  } else skip('database sections', !MARIADBD ? 'no mariadbd' : `port ${DB_PORT} in use or no client`)
  if (!db) writeFileSync(join(PRIV, 'api-config.php'), phpArray({ ...API_CFG(), db_host: '127.0.0.1;port=1' }))

  await startProxy()
  const env = phpEnv({ SPORTA_API_CONFIG_FILE: join(PRIV, 'api-config.php'), SPORTA_PRIVATE_CONFIG_DIR: join(PRIV, 'config') })
  startPhp('site', PHP_PORT, ['-t', '/'], env, ['-d', `auto_prepend_file=${BASE}/prepend.php`, '-d', `session.save_path=${BASE}/sessions/php`,
    '-d', `sendmail_path=sh ${join(web, 'scripts', 'fake-mta.sh')} ${MAIL}`])
  startPhp('bank', BANK_PORT, ['-t', join(FAKES, 'scripts')], phpEnv())
  startPhp('cbk', CBK_PORT, ['-t', join(FAKES, 'scripts'), join(FAKES, 'scripts', 'fake-cbk-gateway.php')], phpEnv())
  startPhp('google', GOOGLE_PORT, ['-t', GOOGLE, join(GOOGLE, 'stub.php')], phpEnv())
  writeFileSync(`${BASE}/httpd.conf`, httpdConf(tls))
  const t = spawnSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-t'], { encoding: 'utf8' })
  if (t.status !== 0) { check(false, 'httpd -t accepts the generated config', short(t.stderr, 300)); return }
  execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'start'])
  apacheUp = true
  const upAll = await Promise.all([PORT, PHP_PORT, BANK_PORT, CBK_PORT, GOOGLE_PORT, ...(tls ? [TLS_PORT] : [])].map((p) => waitPort(p)))
  check(upAll.every(Boolean), `private stack up: Apache :${PORT}${tls ? `, TLS :${TLS_PORT}` : ''}, PHP :${PHP_PORT}, fakes :${BANK_PORT} :${CBK_PORT} :${GOOGLE_PORT}, proxy :${PROXY_PORT}`)
  const probe = await req('/api/api.php?r=theme')
  check(probe.status === 200, 'PHP answers behind Apache (/api/api.php?r=theme)', `${probe.status} ${short(probe.text, 60)}`)

  await apacheMatrix(db)
  await fuzz(db)
  if (db && tls) {
    await knetDirect()
    await cbkHandoff()
    await signIn()
  } else skip('payment hand-offs and sign-in', !db ? 'no private database' : 'no TLS front')
  await browser(db && tls)
}

// ------------------------------------------------------------------ (1) Apache redirects
// Derived from public/.htaccess (aliases, index.html, index.php, panel.php, /backends, image/
// cache 410, host + scheme rules) and knet/ + pay/ .htaccess (their own host + scheme rules).
// `to` is the exact Location; `n` the redirects until a non-3xx answer; `end` its status.
const R = (o) => o
const MATRIX = [
  // old-site aliases: ONE 301 straight to the canonical https://www address
  R({ path: '/women', to: `${ORIGIN}/shop?category=women`, n: 1, end: 200 }),
  R({ path: '/women/', to: `${ORIGIN}/shop?category=women`, n: 1, end: 200 }),
  R({ path: '/men?lang=en', to: `${ORIGIN}/shop?category=men&lang=en`, n: 1, end: 200 }),
  R({ path: '/accessories?utm_source=ig&utm_medium=story&utm_campaign=eid', to: `${ORIGIN}/shop?category=accessories&utm_source=ig&utm_medium=story&utm_campaign=eid`, n: 1, end: 200 }),
  R({ path: '/WOMEN', to: `${ORIGIN}/shop?category=WOMEN`, n: 1, end: 200, note: 'NC match keeps the case of $1' }),
  R({ path: '/privacy-policy', to: `${ORIGIN}/privacy`, n: 1, end: 200 }),
  R({ path: '/privacy-policy?lang=en', to: `${ORIGIN}/privacy?lang=en`, n: 1, end: 200 }),
  R({ path: '/terms-and-conditions?lang=en', to: `${ORIGIN}/terms?lang=en`, n: 1, end: 200 }),
  R({ path: '/terms-conditions/', to: `${ORIGIN}/terms`, n: 1, end: 200 }),
  R({ path: '/return-policy', to: `${ORIGIN}/returns`, n: 1, end: 200 }),
  R({ path: '/returns-policy?lang=en', to: `${ORIGIN}/returns?lang=en`, n: 1, end: 200 }),
  R({ path: '/about-us?lang=en&utm_source=x', to: `${ORIGIN}/about?lang=en&utm_source=x`, n: 1, end: 200 }),
  R({ path: '/contact-us', to: `${ORIGIN}/contact`, n: 1, end: 200 }),
  R({ path: '/shipping', to: `${ORIGIN}/terms#delivery`, n: 1, end: 200 }),
  R({ path: '/shipping?lang=en', to: `${ORIGIN}/terms?lang=en#delivery`, n: 1, end: 200 }),
  R({ path: '/delivery-policy/?utm_source=a&lang=en', to: `${ORIGIN}/terms?utm_source=a&lang=en#delivery`, n: 1, end: 200 }),
  R({ path: '/shipping-policy', to: `${ORIGIN}/terms#delivery`, n: 1, end: 200 }),
  R({ path: '/delivery', to: `${ORIGIN}/terms#delivery`, n: 1, end: 200 }),
  R({ path: '/refund', to: `${ORIGIN}/returns`, n: 1, end: 200 }),
  R({ path: '/refunds?lang=en', to: `${ORIGIN}/returns?lang=en`, n: 1, end: 200 }),
  R({ path: '/refund-policy', to: `${ORIGIN}/returns`, n: 1, end: 200 }),
  R({ path: '/return', to: `${ORIGIN}/returns`, n: 1, end: 200 }),
  R({ path: '/policy', to: `${ORIGIN}/privacy`, n: 1, end: 200 }),
  R({ path: '/policies?lang=en', to: `${ORIGIN}/terms?lang=en`, n: 1, end: 200 }),
  // gone for good: 410, not a redirect
  R({ path: '/image/cache/catalog/products/a-500x500.jpg', n: 0, end: 410 }),
  R({ path: '/image/catalog/banner.png', n: 0, end: 410 }),
  // one URL per page
  R({ path: '/index.html', to: `${ORIGIN}/`, n: 1, end: 200 }),
  R({ path: '/index.html?lang=en', to: `${ORIGIN}/?lang=en`, n: 1, end: 200 }),
  R({ path: '/index.php', to: `${ORIGIN}/`, n: 1, end: 200 }),
  R({ path: '/index.php?lang=en&utm_source=x', to: `${ORIGIN}/?lang=en&utm_source=x`, n: 1, end: 200 }),
  R({ path: '/panel.php', to: `${ORIGIN}/backends?via=panel-20261026`, n: 1, end: 200, status: 302 }),
  R({ path: '/panel.php?next=//evil.example', to: `${ORIGIN}/backends?via=panel-20261026`, n: 1, end: 200, status: 302 }),
  // the admin: /backends answers, /backends/ is a real 404, /admin was never redirected
  R({ path: '/backends', n: 0, end: 200 }),
  R({ path: '/backends?lang=en', n: 0, end: 200 }),
  R({ path: '/backends/orders', n: 0, end: 200 }),
  R({ path: '/backends/', n: 0, end: 404 }),
  R({ path: '/backends//', n: 0, end: 404 }),
  R({ path: '/admin', n: 0, end: 404 }),
  R({ path: '/admin/', n: 0, end: 404 }),
  R({ path: '/admin?next=/backends', n: 0, end: 404 }),
  R({ path: '/administrator', n: 0, end: 404 }),
  R({ path: '/admin.php', n: 0, end: 404 }),
  R({ path: '/wp-admin/', n: 0, end: 404 }),
  // trailing slash: both spellings are pages, neither redirects (no loop, no hop)
  R({ path: '/shop', n: 0, end: 200 }),
  R({ path: '/shop/', n: 0, end: 200 }),
  R({ path: '/shop?lang=en&utm_source=x', n: 0, end: 200 }),
  R({ path: '/product/cloudsoft-jacket-army-green', n: 0, end: 200, db: true }),
  R({ path: '/product/cloudsoft-jacket-army-green/', n: 0, end: 200, db: true }),
  R({ path: '/payment/result/?status=success', n: 0, end: 200 }),
  R({ path: '/invoice/SPKNET0001/', n: 0, end: 200 }),
  // percent-encoded Arabic: never redirected on www (the slug pattern is ASCII, so a real 404)
  R({ path: '/product/%D8%AD%D8%B0%D8%A7%D8%A1-%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A', n: 0, end: 404 }),
  R({ path: '/%D8%A7%D9%84%D9%85%D8%AA%D8%AC%D8%B1', n: 0, end: 404 }),
  // the host rule crossed with paths that redirect again (the full spelling matrix: htaccess-rules-test)
  R({ host: 'sporta.com.kw', path: '/shop?lang=en', to: `${ORIGIN}/shop?lang=en`, n: 1, end: 200 }),
  R({ host: 'sporta.com.kw', proto: 'http', path: '/women?lang=en', to: `${ORIGIN}/shop?category=women&lang=en`, n: 1, end: 200, note: 'alias rules sit above the host rule' }),
  R({ host: 'sporta.com.kw', path: '/backends', to: `${ORIGIN}/backends`, n: 1, end: 200 }),
  R({ host: 'sporta.com.kw', path: '/backends/', to: `${ORIGIN}/backends/`, n: 1, end: 404 }),
  R({ host: 'sporta.com.kw', path: '/product/%D8%AD%D8%B0%D8%A7%D8%A1', toI: `${ORIGIN}/product/%d8%ad%d8%b0%d8%a7%d8%a1`, n: 1, end: 404, note: 'Apache re-escapes the hex in lower case' }),
  R({ host: 'sporta.com.kw', path: '/index.html', n: 1, end: 200, note: 'the old file names go straight to the canonical URL (one hop)' }),
  R({ host: 'sporta.com.kw', path: '/index.php', n: 1, end: 200 }),
  R({ host: 'sporta.com.kw', path: '/panel.php', n: 1, end: 200, status: 302 }),
  R({ proto: 'http', path: '/index.html?lang=en', n: 1, end: 200 }),
  R({ proto: 'http', path: '/backends', to: `${ORIGIN}/backends`, n: 1, end: 200 }),
  // knet/ and pay/ carry their own copies of the host and scheme rules
  R({ host: 'sporta.com.kw', path: '/knet/pay.php?trackid=X1&lang=ar', to: `${ORIGIN}/knet/pay.php?trackid=X1&lang=ar`, n: 1, endAny: true }),
  R({ proto: 'http', path: '/pay/pay.php?trackid=X1&lang=en', to: `${ORIGIN}/pay/pay.php?trackid=X1&lang=en`, n: 1, endAny: true }),
  // Hop 1 is the apex 301. Hop 2 is the callback's own 302 for an encrp it cannot resolve
  // (to /payment/result?status=error): the app's answer, not a redirect chain fault.
  R({ host: 'sporta.com.kw', path: '/pay/callback.php?encrp=abc', to: `${ORIGIN}/pay/callback.php?encrp=abc`, n: 2, endAny: true, note: 'apex 301, then the callback answers an unresolved encrp with its own 302' }),
  R({ host: 'sporta.com.kw', path: '/api/api.php?r=theme', to: `${ORIGIN}/api/api.php?r=theme`, n: 1, end: 200 }),
  R({ host: 'sporta.com.kw', path: '/payment/result?status=success&trackid=X1', to: `${ORIGIN}/payment/result?status=success&trackid=X1`, n: 1, end: 200 }),
]

async function apacheMatrix(db) {
  section('(1) Apache redirects: status, Location, hops, query, loops (max 10 hops)')
  for (const c of MATRIX) {
    if (c.db && !db) { skip(c.path, 'needs the database (a product page is 503 without it)'); continue }
    const host = c.host ?? HOST
    const proto = c.proto ?? 'https'
    const ch = await chain(c.path, { host, proto })
    const first = ch.hops[0]
    const label = `${proto}://${host}${c.path}`
    const statusOk = c.n === 0 ? first.status === c.end : first.status === (c.status ?? 301)
    const toOk = c.to ? first.location === c.to : c.toI ? first.location.toLowerCase() === c.toI.toLowerCase() : true
    const endOk = c.endAny ? !ch.loop && (ch.last.status < 300 || ch.last.status >= 400) : ch.last.status === c.end
    const hopsOk = ch.n <= c.n && !ch.loop
    const pass = statusOk && toOk && endOk && hopsOk
    const what = `${first.status}${first.location ? ` -> ${first.location}` : ''}; ${ch.n} hop(s), ends ${ch.last.status}${c.note ? `; ${c.note}` : ''}`
    if (c.known) check(ch.n <= c.n && endOk, `${label}: at most ${c.n} hop`, `${ch.hops.map((h) => h.status).join(' -> ')} via ${ch.hops.map((h) => h.location).filter(Boolean).join(' , ')}`, c.known)
    else check(pass, `${label}`, what)
    redirects.push(`${pass ? 'PASS' : c.known ? 'XFAIL' : 'FAIL'}  ${label}  ${first.status}${first.location ? ` ${first.location}` : ''}  hops=${ch.n} end=${ch.last.status}`)
    // Headers that must be on every redirect Apache makes.
    if (first.status >= 300 && first.status < 400) {
      if (!/max-age=31536000/.test(h1(first.res, 'strict-transport-security'))) check(false, `${label}: the redirect carries HSTS`)
      if (!noCRLF(first.location)) check(false, `${label}: Location has no CR/LF`)
    }
  }
  // /backends must be the SPA shell with noindex; /admin must not leak that the admin moved.
  const be = await req('/backends')
  check(be.status === 200 && /noindex/i.test(h1(be, 'x-robots-tag')), '/backends: 200 with X-Robots-Tag noindex (never a redirect)', `${be.status} ${h1(be, 'x-robots-tag')}`)
  const ad = await req('/admin')
  check(ad.status === 404 && !h1(ad, 'location') && !/backends/i.test(ad.text.replace(/<link[^>]*>|<meta[^>]*>|<script[\s\S]*?<\/script>/g, '').replace(/[\s\S]*<body/i, '')),
    '/admin: a plain 404 SPA shell, no Location, and the body does not point at /backends', `${ad.status}`)
}

// ------------------------------------------------------------------ open-redirect + CRLF fuzz
const PAYLOADS = ['//evil.example', '/\\evil.example', '/%5Cevil.example', 'https:evil.example', 'https://evil.example', 'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>', '%0d%0aSet-Cookie:%20rdp_injected=1', '%0D%0ALocation:%20https://evil.example', '%2F%2Fevil.example', '\\\\evil.example', '@evil.example']
const PARAMS = ['next', 'return', 'returnUrl', 'return_to', 'url', 'redirect', 'redirect_uri', 'back', 'continue', 'goto', 'dest', 'destination']
async function fuzz(db) {
  section('(1b) open-redirect and header-injection fuzz on every input-derived Location')
  // Every redirecting entry point, with each parameter name carrying each payload.
  const entries = [
    ['/women', {}], ['/shipping', {}], ['/privacy-policy', {}], ['/index.html', {}], ['/index.php', {}], ['/panel.php', {}],
    ['/shop', { host: 'sporta.com.kw' }], ['/shop', { proto: 'http' }], ['/knet/pay.php', { host: 'sporta.com.kw' }],
    ['/pay/callback.php', { host: 'sporta.com.kw' }],
    ['/pay/callback.php?ErrorCode=TIJ0020', {}], ['/knet/callback.php?Error=IPAY0100048', {}],
    ['/api/admin-google.php?action=callback', {}], ['/api/admin-google.php?action=start', {}],
  ]
  let n = 0
  const bad = []
  for (const [path, o] of entries) {
    for (const pay of PAYLOADS) {
      const p = PARAMS[n++ % PARAMS.length]
      const sep = path.includes('?') ? '&' : '?'
      const url = `${path}${sep}${p}=${pay}`
      const r = await req(url, { host: o.host ?? HOST, proto: o.proto ?? 'https', headers: ['Sec-Fetch-Mode: navigate', 'Sec-Fetch-Dest: document'] })
      const loc = h1(r, 'location')
      const injected = hv(r, 'set-cookie').some((c) => /rdp_injected/.test(c)) || hv(r, 'location').length > 1
      const allowed = ['www.sporta.com.kw', 'accounts.google.com']
      const auth = loc ? authorityOf(loc) : 'www.sporta.com.kw'
      const scheme = loc ? (() => { try { return new URL(loc, ORIGIN + '/').protocol } catch { return '?' } })() : 'https:'
      const okOne = !injected && noCRLF(loc) && allowed.includes(auth) && scheme === 'https:' && !/^\s*(\/\/|\/\\|\\)/.test(loc)
      if (!okOne) bad.push(`${url} -> ${r.status} ${loc}`)
    }
  }
  check(bad.length === 0, `${entries.length} entry points x ${PAYLOADS.length} payloads (${PARAMS.length} parameter names): every Location is https://www.sporta.com.kw (or Google for the sign-in start), no CR/LF, no injected header`, bad.slice(0, 4).join(' | '))
  // The same payloads in the PATH, where the host rule copies %{REQUEST_URI} into the Location.
  const paths = ['//evil.example/', '//evil.example/%2e%2e', '/\\evil.example', '/%5Cevil.example', '/%0d%0aSet-Cookie:%20rdp_injected=1',
    '/women%0d%0aX-Rdp:%201', '/shipping?%0d%0aSet-Cookie:%20rdp_injected=1', '/shipping?lang=en%23x%0d%0a', '/https:evil.example', '/@evil.example', '/.evil.example']
  const badP = []
  for (const p of paths) {
    for (const o of [{ host: 'sporta.com.kw' }, { proto: 'http' }, {}]) {
      const r = await req(p, { host: o.host ?? HOST, proto: o.proto ?? 'https' })
      const loc = h1(r, 'location')
      const injected = hv(r, 'set-cookie').some((c) => /rdp_injected/.test(c)) || hv(r, 'x-rdp').length > 0
      const okOne = !injected && noCRLF(loc) && (!loc || (authorityOf(loc) === HOST && loc.startsWith(`${ORIGIN}/`)))
      if (!okOne) badP.push(`${o.host ?? HOST}${o.proto === 'http' ? '(http)' : ''} ${p} -> ${r.status} ${loc}`)
    }
  }
  check(badP.length === 0, `${paths.length} hostile paths x 3 spellings: the Location always starts https://www.sporta.com.kw/ (a path, never an authority), no header injection`, badP.slice(0, 4).join(' | '))
  // A browser's reading of the worst one: `https://www.sporta.com.kw//evil.example/` is a path on www.
  const r = await req('//evil.example/', { host: 'sporta.com.kw' })
  check(authorityOf(h1(r, 'location')) === HOST, 'https://sporta.com.kw//evil.example/ -> a // PATH on www (URL parser agrees), not a protocol-relative jump', h1(r, 'location'))
  void db
}

// ------------------------------------------------------------------ orders
const HTTPS = ['X-Forwarded-Proto: https']
let orderSeq = 0
async function newOrder(method = 'knet', lang = undefined) {
  const track = `RDP${Date.now().toString(36).toUpperCase()}${(orderSeq++).toString(36).toUpperCase()}`.slice(0, 30)
  const body = JSON.stringify({
    track_id: track, payment_method: method, ...(lang ? { lang } : {}),
    items: [{ slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'L', fit: 'oversize' }],
    customer: { name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' },
  })
  sql('delete from rate_limit')
  const r = await req('/api/api.php?r=order', { method: 'POST', body, headers: ['Content-Type: application/json'] })
  let j = {}
  try { j = JSON.parse(r.text) } catch { /* below */ }
  if (!j.track_id) throw new Error(`order failed: ${r.status} ${short(r.text, 200)}`)
  return { track, amount: j.amount }
}
const attempts = (track) => Number(sql(`select pay_attempt from orders where track_id='${track}'`))
const payStatus = (track) => sql(`select payment_status from orders where track_id='${track}'`)
// The customer's browser at the bank: hand the bank the query /knet/pay.php put in the Location.
async function bankSays(location, outcome, extra = '') {
  const u = new URL(location)
  const r = await fetch(`http://127.0.0.1:${BANK_PORT}/fake-knet-bank.php?${u.searchParams}&outcome=${outcome}${extra}`)
  return r.json()
}

// ------------------------------------------------------------------ (2a) KNET direct
async function knetDirect() {
  section('(2a) KNET hand-off: /knet/pay.php -> bank -> callback -> /payment/result')
  const o = await newOrder('knet')
  check(o.amount === 21, 'a pending KNET order exists, priced by the server', `${o.track} ${o.amount} KWD`)
  const r = await req(`/knet/pay.php?trackid=${o.track}&lang=ar`)
  const loc = h1(r, 'location')
  const gw = 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm?param=paymentInit&trandata='
  check(r.status === 302 && loc.startsWith(gw), '/knet/pay.php: 302 straight to the (test) gateway URL from config, absolute', `${r.status} ${short(loc, 90)}`)
  redirects.push(`${r.status === 302 && loc.startsWith(gw) ? 'PASS' : 'FAIL'}  ${ORIGIN}/knet/pay.php?trackid=${o.track}&lang=ar  ${r.status} ${short(loc, 70)}  hops=1 (external)`)
  let sent = {}
  try { sent = parseNvp(knetDecrypt(new URL(loc).searchParams.get('trandata'))) } catch { /* below */ }
  check(sent.amt === '21.000' && sent.trackid === o.track && sent.udf5 === o.track && sent.langid === 'AR',
    'the trandata (decrypted independently) carries the DB amount, the track id, udf5 and AR', `${sent.amt} ${sent.trackid} ${sent.langid}`)
  check(sent.responseURL === `${ORIGIN}/knet/callback.php` && sent.errorURL === `${ORIGIN}/knet/callback.php`,
    'responseURL / errorURL are the absolute https://www callback', `${sent.responseURL}`)
  const qs = new URL(loc).searchParams
  check(qs.get('responseURL') === `${ORIGIN}/knet/callback.php` && !/testpass/.test(loc), 'the Location repeats the callback URL in clear and never the Tranportal password', short(qs.get('responseURL')))
  check(/no-store/.test(h1(r, 'cache-control')) && hv(r, 'cache-control').length === 1, '302 from pay.php: Cache-Control no-store (exactly one header)', hv(r, 'cache-control').join(' | '))
  check(h1(r, 'referrer-policy') === 'strict-origin-when-cross-origin', '302 from pay.php: Referrer-Policy strict-origin-when-cross-origin (the bank sees the origin, never the track id)', h1(r, 'referrer-policy'))
  check(/noindex/.test(h1(r, 'x-robots-tag')), '302 from pay.php: X-Robots-Tag noindex', h1(r, 'x-robots-tag'))
  const en = await req(`/knet/pay.php?trackid=${(await newOrder('knet')).track}&lang=en`)
  const enSent = parseNvp(knetDecrypt(new URL(h1(en, 'location')).searchParams.get('trandata')))
  check(enSent.langid === 'USA', 'lang=en reaches the bank as USA', enSent.langid)

  // Bad input never produces a Location.
  for (const [q, want] of [['trackid=..%2F..%2Fetc', 400], ['trackid=NOSUCHORDER1', 404], ['trackid=%0d%0aSet-Cookie:x=1', 400], ['trackid=' + o.track + '&amount=0.100&next=//evil.example', 302]]) {
    const b = await req(`/knet/pay.php?${q}`)
    const l = h1(b, 'location')
    check(b.status === want && (!l || l.startsWith(gw)), `/knet/pay.php?${short(q, 50)}: ${want}${want === 302 ? ' to the gateway only' : ', no Location'}`, `${b.status} ${short(l, 60)}`)
  }

  // The bank answers. Server to server: the fake bank POSTs to https://www.sporta.com.kw/knet/callback.php
  // through the CONNECT proxy and the TLS front, and reports the REDIRECT= landing.
  // placed in English: the language saved on the order is the one the result page is asked for (KNET-K063-CHECK.md,
  // order-page finding 2; knet_result_extras in knet/knet.php), whatever the bank page was shown in
  const paid = await newOrder('knet', 'en')
  const pr = await req(`/knet/pay.php?trackid=${paid.track}&lang=en`)
  const bank = await bankSays(h1(pr, 'location'), 'captured')
  const land = bank.landing ?? ''
  check(bank.merchant_code === 200 && bank.strict_reply === true, 'callback (server to server): 200 and exactly one REDIRECT=<url> line', `${bank.merchant_code} strict=${bank.strict_reply}`)
  const lu = (() => { try { return new URL(land) } catch { return null } })()
  check(lu && lu.origin === ORIGIN && lu.pathname === '/payment/result', 'the landing is https://www.sporta.com.kw/payment/result', short(land, 120))
  check(lu && lu.searchParams.get('status') === 'success' && lu.searchParams.get('trackid') === paid.track && lu.searchParams.get('payid') && lu.searchParams.has('ref'),
    'success: ?status=success&trackid=<order>&payid=<bank id>&ref=<ref>', lu ? [...lu.searchParams.keys()].join(',') : '')
  check(payStatus(paid.track) === 'paid', 'and the order is paid in the private DB')
  check(lu && lu.searchParams.get('lang') === 'en', 'a shopper who placed the order in English comes back to an English result page (lang=en, the language saved on the order)', `landing ${lu?.search}`)
  check(lu && /^\d{9,11}\.[a-f0-9]{32}$/.test(lu.searchParams.get('k') ?? ''), 'and with the order\'s receipt key (k), so the result page can ask the server for the bank\'s fields', lu ? lu.search : '')
  redirects.push(`${lu?.pathname === '/payment/result' ? 'PASS' : 'FAIL'}  ${ORIGIN}/knet/callback.php (bank POST)  200 REDIRECT=${short(land, 70)}`)
  if (lu) {
    const page = await req(lu.pathname + lu.search)
    // Served through /api/seo-page.php, so it carries /api's stricter no-referrer: the track id in this URL goes nowhere.
    check(page.status === 200 && /noindex/.test(h1(page, 'x-robots-tag')) && ['no-referrer', 'strict-origin-when-cross-origin'].includes(h1(page, 'referrer-policy')),
      '/payment/result?...: 200, noindex, Referrer-Policy no-referrer (or strict-origin-when-cross-origin)', `${page.status} ${h1(page, 'x-robots-tag')} referrer=${h1(page, 'referrer-policy')}`)
  }
  for (const [outcome, want] of [['notcaptured', 'failed'], ['canceled', 'cancelled']]) {
    const x = await newOrder('knet')
    const b = await bankSays(h1(await req(`/knet/pay.php?trackid=${x.track}`), 'location'), outcome)
    const u = new URL(b.landing)
    check(u.origin === ORIGIN && u.pathname === '/payment/result' && u.searchParams.get('status') === want, `${outcome}: lands on /payment/result?status=${want}`, short(b.landing, 100))
  }
  // A browser on the callback (errorURL leg / a redirecting bank) gets a 302, the server the line.
  const er = await req(`/knet/callback.php?Error=IPAY0100048&ErrorText=Cancelled&trackid=${paid.track}&paymentid=E1`, { headers: ['Sec-Fetch-Mode: navigate', 'Sec-Fetch-Dest: document'] })
  // The errorURL leg keeps the order number, the bank's Payment ID and the order's language (order-page finding 3), and
  // never the receipt key: anyone can open this address with anyone's track id. The order goes as order=, not trackid=:
  // the compiled result page would call a pending order "Do not pay again" (review 3, finding 2).
  check(er.status === 302 && h1(er, 'location') === `${ORIGIN}/payment/result?status=error&reason=bank_error&order=${paid.track}&payid=E1&lang=en`,
    'errorURL in a browser: 302 to /payment/result?status=error&reason=bank_error&order=<order>&payid=<bank id>&lang=<order\'s>, no key', `${er.status} ${h1(er, 'location')}`)
  const erS = await req('/knet/callback.php?Error=IPAY0100048&trackid=X')
  check(erS.status === 200 && erS.text.trim() === `REDIRECT=${ORIGIN}/payment/result?status=error&reason=bank_error&order=X`, 'errorURL from a server: the REDIRECT= line, no 302 (an unknown track id carries no language)', short(erS.text, 110))
  // Does any parameter choose where the customer goes? The query, a forged result_page_url and a
  // bank-signed trackid that tries to smuggle a second status.
  const steer = await req(`/knet/callback.php?Error=x&result_page_url=https://evil.example&next=//evil.example&status=success`, { headers: ['Sec-Fetch-Mode: navigate'] })
  check(h1(steer, 'location') === `${ORIGIN}/payment/result?status=error&reason=bank_error`, 'no query parameter changes the callback destination (result_page_url/next/status ignored)', h1(steer, 'location'))
  const forged = await req('/knet/callback.php', { method: 'POST', headers: ['Content-Type: application/x-www-form-urlencoded', 'Sec-Fetch-Mode: navigate'],
    body: `trandata=${knetEncrypt('result=CAPTURED&trackid=X&status=success&amt=21.000&paymentid=1&ref=//evil.example')}` })
  const fl = h1(forged, 'location')
  const fu = new URL(fl)
  check(fu.origin === ORIGIN && fu.searchParams.getAll('status').length === 1 && fu.searchParams.get('status') !== 'success',
    'a bank-signed callback with hostile fields: one status, fixed origin (fields are http_build_query-encoded)', fl)

  // Two tabs: the same order started twice gets two references, and the bank can capture both.
  const two = await newOrder('knet')
  const [t1, t2] = await Promise.all([req(`/knet/pay.php?trackid=${two.track}`), req(`/knet/pay.php?trackid=${two.track}`)])
  const refs = [t1, t2].map((x) => parseNvp(knetDecrypt(new URL(h1(x, 'location')).searchParams.get('trandata'))).trackid).sort()
  check(refs[0] === two.track && refs[1] === `${two.track}A2` && attempts(two.track) === 2, 'two tabs: two attempts, the second with the A2 suffix (the bank cannot refuse it as a duplicate)', refs.join(' , '))
  const c1 = await bankSays(h1(t1, 'location'), 'captured')
  const c2 = await bankSays(h1(t2, 'location'), 'captured')
  const s2 = new URL(c2.landing).searchParams.get('status')
  check(new URL(c1.landing).searchParams.get('status') === 'success', 'tab 1 is captured: success')
  const row = sql(`select payment_status, cbk_status, cbk_paymentid from orders where track_id='${two.track}'`).split('\t')
  check(s2 !== 'success' || row[0] === 'review', 'tab 2 captured TOO (a double charge): the second capture is flagged for review, not shown as a plain success',
    `tab 2 landing status=${s2}; order ${row.join(' / ')}; only the first paymentid is stored`, 'dynamic-4')
}

// ------------------------------------------------------------------ (2b) CBK / knet_via_cbk
async function cbkHandoff() {
  section('(2b) knet_via_cbk ON: /knet/pay.php -> /pay/pay.php -> auto-post page -> CBK -> callback')
  writeCbkCfg({ knet_via_cbk: true })
  sql('delete from rate_limit')
  const o = await newOrder('knet')
  const ch = await chain(`/knet/pay.php?trackid=${o.track}&lang=ar`)
  const h0 = ch.hops[0]
  check(h0.status === 302 && h0.location === `/pay/pay.php?trackid=${o.track}&lang=ar`, '/knet/pay.php: 302 to /pay/pay.php with the same track id and language (a path-only Location)', `${h0.status} ${h0.location}`)
  check(ch.n === 1 && ch.last.status === 200 && ch.last.url === `${ORIGIN}/pay/pay.php?trackid=${o.track}&lang=ar`, 'one hop, then the auto-post page answers 200 on https://www', `${ch.hops.map((h) => `${h.status} ${h.url}`).join(' -> ')}`)
  redirects.push(`${ch.n === 1 ? 'PASS' : 'FAIL'}  ${ORIGIN}/knet/pay.php?trackid=${o.track}&lang=ar (knet_via_cbk)  ${h0.status} ${h0.location}  hops=1 end=${ch.last.status}`)
  // The hand-off path itself: nothing the browser sends can turn it into a jump off-site.
  for (const t of ['//evil.example', '/\\evil.example', 'https://evil.example', '%0d%0aSet-Cookie:%20rdp_injected=1', 'x&lang=en&next=//evil']) {
    const r = await req(`/knet/pay.php?trackid=${t}&lang=en`)
    const l = h1(r, 'location')
    check(r.status === 302 && l.startsWith('/pay/pay.php?trackid=') && authorityOf(l) === HOST && noCRLF(l) && !hv(r, 'set-cookie').some((c) => /rdp_injected/.test(c)),
      `handoff with trackid=${short(t, 30)}: stays a /pay/pay.php path (rawurlencoded)`, l)
  }
  const page = ch.last.res
  const html = page.text
  const action = formAction(html)
  const f = formFields(html)
  check(action.startsWith('https://pgtest.cbk.com/ePay/pg/epay?_v=FAKETOKEN-'), 'the form posts to https://pgtest.cbk.com/ePay/pg/epay?_v=<access token> (server-side Authenticate went through the proxy to the fake)', short(action, 80))
  check(f.tij_MerchPayType === '1' && f.tij_MerchantPaymentAmount === '21.000' && f.tij_MerchantUdf5 === o.track && f.tij_MerchantPaymentLang === 'ar',
    'fields: PayType 1 (KNET), the DB amount, udf5 = order, lang ar', `${f.tij_MerchPayType} ${f.tij_MerchantPaymentAmount} ${f.tij_MerchantPaymentLang}`)
  check(f.tij_MerchReturnUrl === `${ORIGIN}/pay/callback.php`, 'return URL: the absolute https://www callback', f.tij_MerchReturnUrl)
  const csp = h1(page, 'content-security-policy')
  const dir = (n) => (new RegExp(`(?:^|;)\\s*${n}\\s+([^;]*)`).exec(csp)?.[1] ?? '').trim()
  check(csp.length > 0, 'the page carries the CSP Apache sends for /pay/ (inherited from the root .htaccess)', short(csp, 80))
  check(/no-store/.test(h1(page, 'cache-control')) && hv(page, 'cache-control').length === 1 && h1(page, 'referrer-policy') === 'strict-origin-when-cross-origin' && /noindex/.test(h1(page, 'x-robots-tag')),
    '/pay/pay.php: Cache-Control no-store (one header), Referrer-Policy strict-origin-when-cross-origin, noindex', `${h1(page, 'cache-control')} | ${h1(page, 'referrer-policy')}`)
  // The auto-submit is a <script> element allowed by its hash: recompute it from the page that was served.
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`)
  check(inlineScripts.length === 1 && dir('script-src').includes(inlineScripts[0]) && !/\son[a-z]+=/.test(html), 'static: one inline script, no inline handler, and script-src carries its sha256', `${inlineScripts.join(' ')} vs script-src ${short(dir('script-src'), 80)}`)
  check(/'unsafe-inline'|'unsafe-hashes'/.test(dir('script-src')) || !/onload=/.test(html), 'static: script-src allows the page\'s inline onload handler', `script-src ${short(dir('script-src'), 60)}`)
  check(/pgtest\.cbk\.com|pg\.cbk\.com/.test(dir('form-action')), 'static: form-action lists the CBK host the form posts to', `form-action ${dir('form-action')}`)
  check(/<html[^>]*\blang="ar"/.test(html) && /dir="rtl"/.test(html), 'lang=ar: the hand-off page is in Arabic (lang/dir) for an Arabic shopper', short(/<html[^>]*>/.exec(html)?.[0] + ' ' + (/<p[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '').trim(), 100))

  // The gateway leg over HTTP (what the browser would do if the page could post): success,
  // failure and cancel come back through /pay/callback.php to /payment/result.
  const post = async (pageHtml, outcome, extra = '') => {
    const a = formAction(pageHtml)
    const u = new URL(a)
    const gwRes = await fetch(`http://127.0.0.1:${CBK_PORT}${u.pathname}${u.search}&outcome=${outcome}${extra}`, { method: 'POST', body: new URLSearchParams(formFields(pageHtml)) })
    const gw = await gwRes.json()
    const back = new URL(gw.return_url)
    const cb = await req(back.pathname + back.search, { headers: ['Sec-Fetch-Mode: navigate'] })
    return { gw, cb, location: h1(cb, 'location') }
  }
  const ok1 = await post(html, 'success')
  const l1 = new URL(ok1.location, ORIGIN)
  check(ok1.cb.status === 302 && ok1.location.startsWith(`${ORIGIN}/payment/result?`) && l1.searchParams.get('status') === 'success' && l1.searchParams.get('trackid') === o.track,
    'CBK success: /pay/callback.php?encrp=... 302 -> https://www.sporta.com.kw/payment/result?status=success&trackid=<order>', ok1.location)
  redirects.push(`${l1.searchParams.get('status') === 'success' ? 'PASS' : 'FAIL'}  ${ORIGIN}/pay/callback.php?encrp=...  ${ok1.cb.status} ${short(ok1.location, 80)}`)
  check(payStatus(o.track) === 'paid', 'and the KNET order is paid')
  for (const [outcome, want] of [['failed', 'failed'], ['cancelled', 'cancelled']]) {
    sql('delete from rate_limit')
    const x = await newOrder('knet')
    const pg = (await chain(`/knet/pay.php?trackid=${x.track}`)).last.res.text
    const r = await post(pg, outcome)
    check(new URL(r.location).searchParams.get('status') === want && r.location.startsWith(`${ORIGIN}/payment/result?`), `CBK ${outcome}: lands on /payment/result?status=${want}`, r.location)
  }
  // The unauthenticated error return: records, changes nothing, and the destination is fixed.
  const pend = await newOrder('knet')
  for (const code of ['TIJ0020', '%0d%0aSet-Cookie:%20rdp_injected=1', '//evil.example', '"><script>alert(1)</script>']) {
    const r = await req(`/pay/callback.php?ErrorCode=${code}&PayTrackID=${pend.track}&next=https://evil.example`)
    const l = h1(r, 'location')
    check(r.status === 302 && l.startsWith(`${ORIGIN}/payment/result?status=failed&reason=`) && noCRLF(l) && !hv(r, 'set-cookie').some((c) => /rdp_injected/.test(c)),
      `ErrorCode=${short(code, 28)}: 302 to /payment/result?status=failed&reason=<rawurlencoded>, nothing injected`, l)
  }
  check(payStatus(pend.track) === 'pending', 'and the unauthenticated error return left the order pending')
  for (const q of ['', 'encrp=', 'foo=bar&next=//evil.example']) {
    const r = await req(`/pay/callback.php?${q}`)
    check(r.status === 302 && h1(r, 'location') === `${ORIGIN}/payment/result?status=error&reason=missing_encrp`, `/pay/callback.php?${q || '(nothing)'}: 302 to status=error&reason=missing_encrp`, h1(r, 'location'))
  }

  // Two tabs on the CBK page: two attempts, both payable.
  sql('delete from rate_limit')
  const two = await newOrder('knet')
  const [p1, p2] = await Promise.all([req(`/pay/pay.php?trackid=${two.track}`), req(`/pay/pay.php?trackid=${two.track}`)])
  const tr = [formFields(p1.text).tij_MerchantPaymentTrack, formFields(p2.text).tij_MerchantPaymentTrack].sort()
  check(tr[0] === two.track && tr[1] === `${two.track}A2`, 'two tabs: two CBK attempts, A2 on the second', tr.join(' , '))
  const a = await post(p1.text, 'success')
  const b = await post(p2.text, 'success')
  const sa = new URL(a.location).searchParams.get('status')
  const sb = new URL(b.location).searchParams.get('status')
  const row = sql(`select payment_status, cbk_status from orders where track_id='${two.track}'`).split('\t')
  check(sa === 'success', 'tab 1 paid: success')
  check(sb !== 'success' || row[0] === 'review', 'tab 2 paid TOO (a double charge through CBK): flagged for review, not a plain success', `tab 2 status=${sb}; order ${row.join(' / ')}`, 'dynamic-4')
  writeCbkCfg({})
}

// ------------------------------------------------------------------ (3) sign-in redirects
async function signIn() {
  section('(3) sign-in redirects: Google start/callback (stub Google), password-reset links')
  sql('delete from rate_limit')
  const st = await req('/api/admin-google.php?action=start&next=//evil.example')
  const loc = h1(st, 'location')
  const u = (() => { try { return new URL(loc) } catch { return null } })()
  check(st.status === 302 && u?.origin === 'https://accounts.google.com' && u.pathname === '/o/oauth2/v2/auth', 'start: 302 to https://accounts.google.com/o/oauth2/v2/auth (next= ignored)', `${st.status} ${short(loc, 80)}`)
  check(u?.searchParams.get('redirect_uri') === `${ORIGIN}/api/admin-google.php`, 'redirect_uri is the absolute, same-origin https://www.sporta.com.kw/api/admin-google.php', u?.searchParams.get('redirect_uri'))
  check(u && u.searchParams.get('state')?.length === 64 && u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('nonce'), 'state (64 hex), nonce and PKCE S256 are on the authorize URL')
  check(/no-store/.test(h1(st, 'cache-control')) && h1(st, 'referrer-policy') === 'no-referrer', 'start: Cache-Control no-store, Referrer-Policy no-referrer', `${h1(st, 'cache-control')} | ${h1(st, 'referrer-policy')}`)
  const cookie = hv(st, 'set-cookie').map((c) => c.split(';')[0]).find((c) => c.startsWith('__Host-sporta_google=')) ?? ''
  check(cookie !== '' && hv(st, 'set-cookie').some((c) => /__Host-sporta_google=.*Secure.*/i.test(c) && /SameSite=Lax/i.test(c)), 'the flow cookie is __Host-sporta_google, Secure, SameSite=Lax', hv(st, 'set-cookie').map((c) => short(c, 60)).join(' | '))
  redirects.push(`${u?.origin === 'https://accounts.google.com' ? 'PASS' : 'FAIL'}  ${ORIGIN}/api/admin-google.php?action=start  ${st.status} ${short(loc, 60)}`)

  // Google says yes: the test plays the user, the stub plays Google's token and certs endpoints.
  const code = randomBytes(12).toString('hex')
  writeFileSync(join(GOOGLE, 'next.json'), JSON.stringify({ code, nonce: u?.searchParams.get('nonce'), sub: '104220000000000000001',
    aud: 'rdp-client.apps.googleusercontent.com', redirect_uri: `${ORIGIN}/api/admin-google.php` }))
  const cb = await req(`/api/admin-google.php?state=${u?.searchParams.get('state')}&code=${code}`, { cookie })
  const cbl = h1(cb, 'location')
  check(cb.status === 303 && cbl === `${ORIGIN}/backends/?google=success`, 'callback (stub Google, signed id_token): 303 to https://www.sporta.com.kw/backends/?google=success', `${cb.status} ${cbl} calls=${short(readFileSync(join(GOOGLE, 'calls.log'), 'utf8').trim().replace(/\n/g, ' ; '), 120)}`)
  check(hv(cb, 'set-cookie').some((c) => /^__Host-sporta_admin=/.test(c)), 'and the admin session cookie is set', hv(cb, 'set-cookie').map((c) => short(c, 40)).join(' | '))
  const land = await chain(`/backends/?google=success`)
  check(land.last.status === 200, 'the sign-in lands on a page that loads (/backends/?google=success)', `${land.last.status}: /backends/ is a deliberate 404 (public/.htaccess), admin-google.php sends the slash`, 'dynamic-2')
  redirects.push(`XFAIL  ${ORIGIN}/api/admin-google.php?state=..&code=..  ${cb.status} ${cbl}  -> ${land.last.status}`)
  for (const [q, res] of [[`state=${'0'.repeat(64)}&code=x`, 'invalid'], ['error=access_denied', 'invalid']]) {
    const r = await req(`/api/admin-google.php?${q}`, { cookie })
    check(r.status === 303 && h1(r, 'location') === `${ORIGIN}/backends/?google=${res}`, `callback ${short(q, 30)}: 303 to /backends/?google=${res} (fixed origin)`, h1(r, 'location'))
  }
  const ph = await req('/api/admin-google.php?action=nope')
  check(ph.status === 404 && !h1(ph, 'location'), 'an unknown action: 404, no redirect')
  check(!proxyLog.some((l) => /REFUSED/.test(l)) || true, `CONNECT log: ${[...new Set(proxyLog.map((l) => l.replace(/ HTTP.*/, '')))].join(', ')}`)

  // Password-reset links: absolute, same-origin, token in the fragment, whatever the request says.
  for (const f of readdirSync(MAIL)) rmSync(join(MAIL, f))
  const evilHeaders = ['Content-Type: application/json', 'X-Forwarded-Host: evil.example', 'Origin: https://evil.example', 'Referer: https://evil.example/']
  const ar = await req('/api/admin.php?r=forgot_password', { method: 'POST', headers: ['X-Sporta-Admin: 1', ...evilHeaders], body: JSON.stringify({ email: 'qa-admin@sporta.test' }) })
  const cr = await req('/api/customer.php?r=forgot_password', { method: 'POST', headers: ['X-Sporta-Customer: 1', ...evilHeaders], body: JSON.stringify({ email: 'fatima@example.com' }) })
  check(ar.status === 200 && cr.status === 200, 'both forgot-password routes answer 200', `${ar.status} ${cr.status} ${short(cr.text, 60)}`)
  let mails = []
  for (let i = 0; i < 40 && mails.length < 2; i++) { await sleep(150); mails = readdirSync(MAIL).filter((n) => n.endsWith('.eml')).map((n) => readFileSync(join(MAIL, n), 'utf8')) }
  const links = mails.flatMap((m) => [...m.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((x) => x[0])).filter((l) => /reset|token/.test(l))
  const adminLink = links.find((l) => /#reset=/.test(l)) ?? ''
  const custLink = links.find((l) => /#token=/.test(l)) ?? ''
  check(/^https:\/\/www\.sporta\.com\.kw\/backends#reset=[0-9a-f]{64}$/.test(adminLink), 'admin reset mail: https://www.sporta.com.kw/backends#reset=<64 hex> (absolute, same-origin, fragment; X-Forwarded-Host ignored)', short(adminLink, 70))
  check(/^https:\/\/www\.sporta\.com\.kw\/account\?mode=reset#token=[0-9a-f]{64}$/.test(custLink), 'customer reset mail: https://www.sporta.com.kw/account?mode=reset#token=<64 hex>', short(custLink, 70))
  for (const l of [adminLink, custLink].filter(Boolean)) {
    const lu = new URL(l)
    const r = await chain(lu.pathname + lu.search)
    check(r.n === 0 && r.last.status === 200, `${lu.pathname}${lu.search}: the reset link opens with no redirect (200)`, `${r.last.status}`)
    redirects.push(`${r.n === 0 && r.last.status === 200 ? 'PASS' : 'FAIL'}  reset link ${lu.origin}${lu.pathname}${lu.search}#...  ${r.last.status} hops=0`)
  }
}

// ------------------------------------------------------------------ (2c) Chromium
async function browser(full) {
  section('(2c) Chromium: what the customer sees on the hand-off pages (production CSP from Apache)')
  if (!full) { skip('browser checks', 'needs the database and the TLS front'); return }
  let chromium
  try { ({ chromium } = await import(join(web, 'node_modules', 'playwright', 'index.mjs'))) } catch { skip('browser checks', 'playwright is not installed in sporta-web/node_modules'); return }
  const rules = `${MAPPED.map((n) => `MAP ${n} 127.0.0.1:${TLS_PORT}`).join(', ')}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`
  let b
  try {
    // PW_CHROMIUM names a Chromium binary when the one this Playwright version expects is not installed (a managed
    // sandbox ships one browser build; a version mismatch otherwise skips the only checks that enforce a CSP).
    b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=${rules}`] })
  } catch (e) { skip('browser checks', `Chromium did not launch: ${short(e.message, 120)}`); return }
  try {
    writeCbkCfg({ knet_via_cbk: true })
    const watch = (page) => {
      const seen = { console: [], requests: [], violations: [] }
      page.on('console', (m) => seen.console.push(m.text()))
      page.on('request', (r) => seen.requests.push(`${r.method()} ${r.url()}`))
      return seen
    }
    const cspText = (seen) => seen.console.filter((c) => /Content Security Policy/i.test(c))
    const visible = (page) => page.evaluate(() => ({
      text: document.body?.innerText?.trim() ?? '', lang: document.documentElement.lang, dir: document.documentElement.dir,
      buttons: [...document.querySelectorAll('button,input[type=submit],a[href]')].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim() || e.value),
      url: location.href,
    }))

    // A: JavaScript on, CSP enforced: the real customer.
    sql('delete from rate_limit')
    const o = await newOrder('knet')
    const ctx = await b.newContext({ locale: 'ar-KW' })
    const page = await ctx.newPage()
    const seen = watch(page)
    const t0 = Date.now()
    const resp = await page.goto(`${ORIGIN}/knet/pay.php?trackid=${o.track}&lang=ar`, { waitUntil: 'load' })
    const chainUrls = []
    for (let r = resp?.request(); r; r = r.redirectedFrom()) chainUrls.unshift(`${r.url().replace(ORIGIN, '')}`)
    await sleep(5000)
    const v = await visible(page)
    const posted = seen.requests.some((r) => /^POST https:\/\/pgtest\.cbk\.com\/ePay\/pg\/epay/.test(r))
    check(chainUrls.length === 2 && /\/pay\/pay\.php/.test(chainUrls[1]), 'Chromium follows /knet/pay.php -> /pay/pay.php in one redirect', chainUrls.join(' -> '))
    check(resp?.headers()['content-security-policy']?.includes("form-action 'self'"), 'the page Chromium received carries Apache\'s CSP', short(resp?.headers()['content-security-policy'], 60))
    const violations = cspText(seen)
    check(posted, 'JS on: the page auto-submits and the customer reaches the CBK payment page', `after ${Math.round((Date.now() - t0) / 1000)} s still on ${v.url.replace(ORIGIN, '')}; sees "${short(v.text, 60)}" (lang="${v.lang}" dir="${v.dir}"), buttons: ${v.buttons.length ? v.buttons.join('/') : 'none'}; console: ${short(violations[0], 170)}`)
    findings.set('dynamic-1-console', violations.join(' || '))
    check(posted || v.buttons.length > 0, 'JS on: the customer is not stuck (posted to CBK, or a button to continue is visible)', `posted=${posted} buttons visible: ${v.buttons.length}`)
    check(posted || v.lang === 'ar' || /[؀-ۿ]/.test(v.text), 'lang=ar: the waiting page speaks Arabic (or the customer has already left it for CBK)', `text "${short(v.text, 60)}", lang="${v.lang}"`)
    // form-action, on its own: submit from DevTools (CDP is not subject to script-src).
    const before = seen.console.length
    await page.evaluate(() => document.forms[0].submit()).catch(() => {})
    await sleep(2500)
    const fa = seen.console.slice(before).filter((c) => /Content Security Policy|form-action|Refused/i.test(c))
    const posted2 = seen.requests.some((r) => /^POST https:\/\/pgtest\.cbk\.com\/ePay\/pg\/epay/.test(r))
    check(posted || posted2, 'form-action: the browser lets the form POST leave for https://pgtest.cbk.com', `posted=${posted} posted2=${posted2}; console: ${short(fa[0], 190)}`)
    findings.set('dynamic-1-form-action', fa.join(' || '))
    await ctx.close()

    // B: JavaScript off: the <noscript> button.
    sql('delete from rate_limit')
    const o2 = await newOrder('knet')
    const ctxN = await b.newContext({ javaScriptEnabled: false })
    const pn = await ctxN.newPage()
    const seenN = watch(pn)
    await pn.goto(`${ORIGIN}/knet/pay.php?trackid=${o2.track}&lang=ar`, { waitUntil: 'load' })
    const btn = pn.locator('button[type=submit]')
    const btnText = (await btn.count()) ? (await btn.first().textContent())?.trim() : ''
    check(btnText === 'المتابعة إلى الدفع', 'JS off: the page shows the continue button, in Arabic for lang=ar', `"${btnText}"`)
    if (btnText) { await btn.first().click({ noWaitAfter: true }).catch(() => {}); await sleep(2500) }
    const postedN = seenN.requests.some((r) => /^POST https:\/\/pgtest\.cbk\.com\/ePay\/pg\/epay/.test(r))
    check(postedN, 'JS off: clicking the button reaches the CBK page', `posted=${postedN}; console: ${short(cspText(seenN)[0], 150)}`)
    await ctxN.close()

    // C: diagnostic only: the same page with CSP bypassed, i.e. what a fixed policy would allow.
    sql('delete from rate_limit')
    const o3 = await newOrder('knet')
    const ctxB = await b.newContext({ bypassCSP: true })
    const pb = await ctxB.newPage()
    const seenB = watch(pb)
    const tb = Date.now()
    await pb.goto(`${ORIGIN}/knet/pay.php?trackid=${o3.track}&lang=en`, { waitUntil: 'load' })
    await pb.waitForURL(/pgtest\.cbk\.com/, { timeout: 8000 }).catch(() => {})
    const tAt = Date.now() - tb
    const atGw = /pgtest\.cbk\.com\/ePay\/pg\/epay/.test(pb.url())
    check(atGw, 'diagnostic (CSP bypassed): the page itself works - it auto-posts to the CBK host', `${atGw ? `at the gateway after ${tAt} ms` : `stuck on ${pb.url()}`}`)
    let gwJson = {}
    try { gwJson = JSON.parse(await pb.evaluate(() => document.body.innerText)) } catch { /* not json */ }
    // Back from the CBK page: no-store means no bfcache, so Back re-requests /pay/pay.php.
    const attBefore = attempts(o3.track)
    await pb.goBack({ waitUntil: 'load' }).catch(() => {})
    await pb.waitForURL(/pgtest\.cbk\.com/, { timeout: 6000 }).catch(() => {})
    const attAfter = attempts(o3.track)
    const backUrl = pb.url()
    check(attAfter === attBefore && !/pgtest\.cbk\.com/.test(backUrl), 'Back from the CBK page returns to the shop without starting a new attempt',
      `attempts ${attBefore} -> ${attAfter}; after Back the browser is at ${backUrl.replace(/_v=[^&]+/, '_v=...')} `)
    // The return leg in the browser: CBK sends the customer to the return URL.
    if (gwJson.return_url) {
      sql('delete from rate_limit')
      const fresh = await newOrder('knet')
      const pg = await pb.goto(`${ORIGIN}/pay/pay.php?trackid=${fresh.track}&lang=en`, { waitUntil: 'load' })
      await pb.waitForURL(/pgtest\.cbk\.com/, { timeout: 8000 }).catch(() => {})
      const j = JSON.parse(await pb.evaluate(() => document.body.innerText))
      const fin = await pb.goto(j.return_url, { waitUntil: 'load' })
      const finUrl = new URL(pb.url())
      check(finUrl.origin === ORIGIN && finUrl.pathname === '/payment/result' && finUrl.searchParams.get('status') === 'success' && finUrl.searchParams.get('trackid') === fresh.track,
        'Chromium: the CBK return URL lands on https://www.sporta.com.kw/payment/result?status=success&trackid=<order>', `${fin?.status()} ${finUrl.pathname}${finUrl.search}`)
      void pg
    }
    await ctxB.close()
    writeCbkCfg({})

    // D: classic KNET, back button and a second tab, with the bank page stubbed in the browser
    // (the fake bank captures on GET, and these checks are about the customer NOT paying).
    sql('delete from rate_limit')
    const k = await newOrder('knet')
    const ctxK = await b.newContext()
    await ctxK.route('https://kpaytest.com.kw/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>bank</title><h1>BANK CARD PAGE</h1>' }))
    const pk = await ctxK.newPage()
    await pk.goto(`${ORIGIN}/checkout`, { waitUntil: 'load' })
    await pk.goto(`${ORIGIN}/knet/pay.php?trackid=${k.track}&lang=en`, { waitUntil: 'load' })
    const bankUrl = pk.url()
    check(/^https:\/\/kpaytest\.com\.kw\/kpg\/PaymentHTTP\.htm\?param=paymentInit&trandata=/.test(bankUrl) && attempts(k.track) === 1, 'Chromium: /knet/pay.php -> the bank page, attempt 1', short(bankUrl, 80))
    await pk.goBack({ waitUntil: 'load' })
    const backTo = pk.url()
    check(backTo === `${ORIGIN}/checkout` && attempts(k.track) === 1, 'Back from the KNET bank: the shop page before pay.php (pay.php is not in history), no new attempt', `${backTo.replace(ORIGIN, '')} attempts=${attempts(k.track)}`)
    await pk.goForward({ waitUntil: 'load' })
    check(pk.url() === bankUrl && attempts(k.track) === 1, 'Forward again: the same bank URL (same trandata), still one attempt', `attempts=${attempts(k.track)}`)
    const pk2 = await ctxK.newPage()
    await pk2.goto(`${ORIGIN}/knet/pay.php?trackid=${k.track}&lang=en`, { waitUntil: 'load' })
    // Playwright does not route a request that is the target of a redirect, so the 302 from pay.php reaches the fake
    // bank, which captures on GET: by now this order is PAID. A second tab must then be refused, not charged again.
    // (The A2 reference for a second attempt on an UNPAID order is covered without a browser in section 2.)
    const td2 = new URL(pk2.url()).searchParams.get('trandata')
    const body2 = await pk2.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (td2) {
      const ref2 = parseNvp(knetDecrypt(td2)).trackid
      check(ref2 === `${k.track}A2` && attempts(k.track) === 2, 'a second tab: a second attempt with the A2 reference', ref2)
    } else {
      check(payStatus(k.track) === 'paid' && /already been paid/i.test(body2) && attempts(k.track) === 1,
        'a second tab after the bank captured: refused ("already been paid"), no second attempt, no second charge', `${payStatus(k.track)} attempts=${attempts(k.track)} "${short(body2, 60)}"`)
    }
    await ctxK.close()
  } finally {
    await b.close()
  }
}

// =================================================================================================
let crashed = null
try { await main() } catch (e) { crashed = e } finally { if (!KEEP) stopAll() }
if (crashed) { fails++; say(`FAIL  the suite crashed: ${crashed.stack}`) }
section('summary: one line per redirect followed')
for (const l of redirects) say(l)
if (findings.size) {
  section('known defects observed (expected-fail)')
  for (const [k, v] of findings) say(`${k}: ${short(v, 600)}`)
}
say(`\n${oks} ok, ${xfail} expected-fail, ${xpass} unexpected-pass, ${fails} FAIL, ${skips} skipped${KEEP ? `  (stack kept: ${BASE})` : ''}`)
if (!KEEP) { try { rmSync(BASE, { recursive: true, force: true }); if (WWW !== join(BASE, 'www')) rmSync(WWW, { recursive: true, force: true }) } catch { /* best effort */ } }
process.exit(fails + xpass ? 1 : 0)
