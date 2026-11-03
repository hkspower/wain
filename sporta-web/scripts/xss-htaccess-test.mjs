#!/usr/bin/env node
// XSS-HTACCESS TEST - what the web-server rules do about stored and reflected XSS.
//
//   node scripts/xss-htaccess-test.mjs            (npm run test:xss-htaccess)
//   node scripts/xss-htaccess-test.mjs --keep     leave the Apache tree and servers running
//   node scripts/xss-htaccess-test.mjs --patch F  apply unified diff F to the scratch copy of
//                                                 public/.htaccess first (before/after runs)
//
// Rig-free: it starts and stops its OWN Apache 2.4 (default port 8411) and its OWN `php -S`
// (default 8412) under a scratch directory (default /tmp/sporta-xss-htaccess), touches no
// database, no repo file and no port another suite uses. Skips with exit 0 and a clear line
// when apache2/httpd is absent.
//
// It adds the XSS dimension to scripts/storage-audit.mjs (which asks "is anything sensitive
// reachable?"). Every check names the request and the header it saw.
//
//   1  Content-Security-Policy per area, evaluated the way a browser reads it
//   2  nosniff + Content-Type on user-influenced responses; polyglot uploads in the media
//      mount (x.jpg holding <script>, x.html, x.svg, x.php.jpg, x.PHP ...); MultiViews
//   3  reflected XSS in server-made pages: Apache error bodies, redirects (CRLF, open
//      redirect), env/header echoes, CORS, TRACE
//   4  cookie and framing headers
//   5  the obsolete X-XSS-Protection header
//   6  service worker and manifest types
//   7  the admin page (/backends)
//
// KNOWN DEFECTS are asserted as expected-fail ("XFAIL"): the suite is green while the defect
// exists and goes RED ("XPASS") the day it is fixed, which is the cue to delete the marker.
//
// PHP is the real dropin code behind Apache, with mod_proxy_http standing in for mod_php
// (the php:8.x-apache image's `SetHandler application/x-httpd-php` FilesMatch blocks, copied).
// No database is configured, so the real endpoints answer their error paths, which is what
// the header checks need. Fixture endpoints that must exist (a cookie emitter, a reflector)
// are written into the scratch tree only.
import { spawnSync, spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, chmodSync, openSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const web = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const patchIdx = argv.indexOf('--patch')
const PATCH = patchIdx >= 0 ? resolve(argv[patchIdx + 1]) : process.env.XSSHT_PATCH || ''
const BASE = process.env.XSSHT_DIR || join(tmpdir(), 'sporta-xss-htaccess')
const PORT = Number(process.env.XSSHT_PORT || 8411)
const PHP_PORT = Number(process.env.XSSHT_PHP_PORT || 8412)
const TLS_PORT = Number(process.env.XSSHT_TLS_PORT || 8413)
const HOST = 'www.sporta.com.kw'
const MODULES = process.env.XSSHT_MODULES || '/usr/lib/apache2/modules'

// ------------------------------------------------------------------ small helpers
export function findApache() {
  const r = spawnSync('sh', ['-c', 'command -v apache2 || command -v httpd'], { encoding: 'utf8' })
  return r.stdout.trim().split('\n')[0] || ''
}
const APACHE = findApache()

// A tiny raw HTTP client: the exact request line (so `//x`, `/\x`, `%0d%0a` and
// `GET http://...` can be sent verbatim), duplicate headers kept in order, nothing decoded,
// no redirects followed.
export function raw(port, lines, { timeout = 6000 } = {}) {
  return new Promise((resolveP) => {
    const sock = net.connect(port, '127.0.0.1')
    const chunks = []
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      sock.destroy()
      const buf = Buffer.concat(chunks)
      const cut = buf.indexOf('\r\n\r\n')
      if (cut < 0) return resolveP({ status: 0, headers: [], body: buf, text: buf.toString('latin1') })
      const head = buf.subarray(0, cut).toString('latin1').split('\r\n')
      const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head[0])?.[1] ?? 0)
      const headers = head.slice(1).map((l) => {
        const i = l.indexOf(':')
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]
      })
      const body = buf.subarray(cut + 4)
      resolveP({ status, headers, body, text: body.toString('utf8') })
    }
    sock.setTimeout(timeout, done)
    sock.on('data', (c) => chunks.push(c))
    sock.on('end', done)
    sock.on('close', done)
    sock.on('error', done)
    sock.on('connect', () => sock.write(lines.join('\r\n') + '\r\n\r\n'))
  })
}

export const hv = (res, name) => res.headers.filter(([k]) => k === name.toLowerCase()).map(([, v]) => v)
export const h1 = (res, name) => hv(res, name)[0] ?? ''

// ------------------------------------------------------------------ CSP evaluation
// A hand-written equivalent of the checks Google's CSP Evaluator makes, scoped to what can
// matter for this policy. Returns { dirs, issues[] }; an issue is { sev, msg }.
export function parseCsp(text) {
  const dirs = new Map()
  for (const part of text.split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean)
    if (!toks.length) continue
    const name = toks[0].toLowerCase()
    if (!dirs.has(name)) dirs.set(name, toks.slice(1))
  }
  return dirs
}

const SCHEME_WILD = /^(https?|data|blob|filesystem|wss?):$/i
const VALID_SRC = /^('self'|'none'|'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|'strict-dynamic'|'wasm-unsafe-eval'|'report-sample'|'(sha256|sha384|sha512)-[A-Za-z0-9+/_=-]+'|'nonce-[A-Za-z0-9+/_=-]+'|\*|[a-z][a-z0-9+.-]*:|(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:(\*|\d+))?(\/[^\s;,]*)?|[a-z][a-z0-9+.-]*:\/\/[^\s]+)$/i

export function evalCsp(text) {
  const dirs = parseCsp(text)
  const issues = []
  const add = (sev, msg) => issues.push({ sev, msg })
  const eff = (d) => dirs.get(d) ?? dirs.get('default-src')
  const script = eff('script-src')
  if (!script) add('high', 'no script-src and no default-src: scripts unrestricted')
  else {
    const hasHashOrNonce = script.some((t) => /^'(sha\d+-|nonce-)/.test(t))
    for (const t of script) {
      if (t === "'unsafe-inline'" && !hasHashOrNonce) add('high', "script-src 'unsafe-inline' (inline script and event handlers run)")
      if (t === "'unsafe-eval'") add('medium', "script-src 'unsafe-eval'")
      if (t === '*') add('high', 'script-src wildcard')
      if (SCHEME_WILD.test(t)) add('high', `script-src scheme source ${t}`)
      if (/^https?:\/\//i.test(t) || /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i.test(t)) add('medium', `script-src host ${t}`)
      if (!VALID_SRC.test(t)) add('low', `script-src token is not a valid source expression: ${t}`)
    }
    if (script.includes("'self'")) add('info', "script-src 'self': any same-origin URL that returns JavaScript is a script gadget")
  }
  for (const t of dirs.get('default-src') ?? []) if (t === "'unsafe-inline'" || t === '*') add('high', `default-src ${t}`)
  const obj = eff('object-src')
  if (!obj) add('medium', 'no object-src and no default-src')
  else if (!obj.includes("'none'")) add('medium', `object-src is not 'none': ${obj.join(' ')}`)
  const base = dirs.get('base-uri')
  if (!base) add('medium', 'no base-uri (an injected <base> can retarget relative script URLs)')
  else if (!(base.includes("'self'") || base.includes("'none'"))) add('medium', `base-uri ${base.join(' ')}`)
  if (!dirs.has('frame-ancestors')) add('medium', 'no frame-ancestors')
  if (!dirs.has('form-action')) add('low', 'no form-action (it does not fall back to default-src)')
  if (eff('style-src')?.includes("'unsafe-inline'")) add('low', "style-src 'unsafe-inline'")
  if (!dirs.has('report-uri') && !dirs.has('report-to')) add('info', 'no report-uri/report-to')
  if (!dirs.has('upgrade-insecure-requests')) add('info', 'no upgrade-insecure-requests')
  return { dirs, issues }
}

// ------------------------------------------------------------------ the harness
export function buildTree({ patchFile = '' } = {}) {
  rmSync(BASE, { recursive: true, force: true })
  const www = join(BASE, 'www')
  mkdirSync(www, { recursive: true })

  // public/ ships as the site root (npm run release copies it into dist/ first).
  cpSync(join(web, 'public'), www, { recursive: true })
  // The SOURCE index.html carries the same two inline boot scripts the CSP hashes cover.
  const indexHtml = readFileSync(join(web, 'index.html'), 'utf8')
  writeFileSync(join(www, 'index.html'), indexHtml)

  // The four .htaccess files, at their repo paths, in a mini tree a proposed diff (a/sporta-web/...)
  // can be applied to with `patch -p1` before anything is served.
  const repo = join(BASE, 'repo', 'sporta-web')
  const HT = {
    root: join(repo, 'public', '.htaccess'),
    api: join(repo, 'dropin', 'php-store', '.htaccess'),
    knet: join(repo, 'dropin', 'php-knet', '.htaccess'),
    pay: join(repo, 'dropin', 'php-cbk', '.htaccess'),
  }
  for (const f of Object.values(HT)) {
    mkdirSync(join(f, '..'), { recursive: true })
    cpSync(join(web, f.slice(repo.length + 1)), f)
  }
  if (patchFile) {
    const p = spawnSync('patch', ['-p1', '-s', '--no-backup-if-mismatch', '-d', join(BASE, 'repo'), '-i', patchFile], { encoding: 'utf8' })
    if (p.status !== 0) throw new Error(`patch did not apply: ${p.stdout}${p.stderr}`)
  }

  // dropin -> api / knet / pay, never a config.php (git-ignored, server-only).
  for (const [src, dst] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
    cpSync(join(web, 'dropin', src), join(www, dst), {
      recursive: true,
      filter: (p) => !/(^|\/)config\.php$/.test(p),
    })
  }
  cpSync(HT.api, join(www, 'api', '.htaccess'))
  cpSync(HT.knet, join(www, 'knet', '.htaccess'))
  cpSync(HT.pay, join(www, 'pay', '.htaccess'))

  // The postbuild step, scripts/csp-hashes.mjs: hash every inline, non-JSON-LD script.
  const hashes = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type\s*=\s*"application\/ld\+json"/.test(m[1]))
    .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  writeFileSync(join(www, '.htaccess'), readFileSync(HT.root, 'utf8').replace('__SCRIPT_HASHES__', hashes.join(' ')))

  // The media mount (/images/products): exactly the file admin.php writes first.
  const media = join(www, 'images', 'products')
  mkdirSync(media, { recursive: true })
  writeFileSync(join(media, '.htaccess'),
    'Options -Indexes\n<FilesMatch "\\.(php|phtml|phar|cgi|pl|py|sh)$">\n  Require all denied\n</FilesMatch>\n')
  const PHPBODY = '<?php echo "PHP-EXECUTED-" . (6*7); ?>'
  const polyglots = {
    'real.jpg': Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF\0<script>alert(1)</script>')]),
    'poly.jpg': Buffer.from('\xff\xd8\xff\xe0<html><script>alert(document.domain)</script></html>', 'latin1'),
    'poly.png': Buffer.from('\x89PNG\r\n\x1a\n<html><body onload=alert(1)>', 'latin1'),
    'x.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>',
    'x.html': '<html><script>alert(1)</script><form action="https://evil.example"><input name=p></form></html>',
    'x.htm': '<html><script>alert(1)</script></html>',
    'x.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>',
    'x.xml': '<?xml version="1.0"?><a:html xmlns:a="http://www.w3.org/1999/xhtml"><a:script>alert(1)</a:script></a:html>',
    'x.shtml': '<!--#exec cmd="id" --><script>alert(1)</script>',
    'x.php.jpg': PHPBODY,
    'x.jpg.php': PHPBODY,
    'x.phtml': PHPBODY,
    'x.PHP': PHPBODY,
    'x.Php': PHPBODY,
    'x.php5': PHPBODY,
    'x.pht': PHPBODY,
    'x.js': 'alert(document.domain)',
    'x.txt': '<script>alert(1)</script>',
    'multi.html': '<html><script>alert(1)</script></html>',
    'x.jpg.': 'trailing-dot',
    '.hidden.html': '<script>alert(1)</script>',
    'evil.svgz': '<svg onload=alert(1)>',
  }
  for (const [name, body] of Object.entries(polyglots)) writeFileSync(join(media, name), body)
  // One level up, where /hero and /cats live (owner-placed files, no extra .htaccess).
  mkdirSync(join(www, 'hero'), { recursive: true })
  writeFileSync(join(www, 'hero', 'x.html'), polyglots['x.html'])
  writeFileSync(join(www, 'hero', 'x.svg'), polyglots['x.svg'])

  // Fixture endpoints (scratch tree only, never the repo).
  writeFileSync(join(www, 'api', 'zz-cookie.php'),
    "<?php\nsetcookie('plain', '1');\nsetcookie('sec', '2', ['secure' => true, 'httponly' => true, 'samesite' => 'Strict']);\nsetcookie('none', '3', ['secure' => true, 'samesite' => 'None']);\nheader('Content-Type: text/plain'); echo 'ok';\n")
  writeFileSync(join(www, 'pay', 'zz-cookie.php'),
    "<?php\nsetcookie('plain', '1');\nheader('Content-Type: text/plain'); echo 'ok';\n")
  writeFileSync(join(www, 'api', 'zz-reflect.php'),
    "<?php\n// A script that echoes its input with the WRONG type: shows which layer still holds.\nheader('Content-Type: text/html; charset=utf-8');\necho '<p>' . ($_GET['q'] ?? '') . '</p>';\n")
  chmodRecursive(BASE)
  return { www, hashes }
}

function chmodRecursive(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    try { chmodSync(p, e.isDirectory() ? 0o755 : 0o644) } catch { /* best effort */ }
    if (e.isDirectory()) chmodRecursive(p)
  }
  try { chmodSync(dir, 0o755) } catch { /* best effort */ }
}

export function httpdConf({ www, extra = '', phpHandler = 'filesmatch', tls = false } = {}) {
  const mods = ['mpm_event', 'authz_core', 'authz_host', 'mime', 'dir', 'headers', 'rewrite', 'deflate',
    'brotli', 'filter', 'setenvif', 'alias', 'expires', 'autoindex', 'negotiation', 'env', 'log_config',
    'proxy', 'proxy_http', ...(tls ? ['ssl', 'socache_shmcb'] : [])]
  // Modules compiled into the binary (core, so, http, log_config, unixd...) cannot be loaded.
  const builtin = spawnSync(APACHE, ['-l'], { encoding: 'utf8' }).stdout
  const load = mods
    .filter((n) => !new RegExp(`^\\s*mod_${n}\\.c\\s*$`, 'm').test(builtin))
    .map((n) => `LoadModule ${n}_module ${MODULES}/mod_${n}.so`).join('\n')
  const user = process.getuid?.() === 0 ? 'User www-data\nGroup www-data\n' : ''
  // PHP: the php:8.x-apache image's docker-php.conf, with the interpreter moved behind a
  // loopback proxy (no libphp in the sandbox). "legacy" is the older AddHandler form, used
  // only as a negative control to show what a double extension would do under it.
  const php = phpHandler === 'legacy'
    ? `ProxyPreserveHost On\nRequestHeader set X-Orig-Request "expr=%{THE_REQUEST}"\nAddHandler "proxy:http://127.0.0.1:${PHP_PORT}" .php\n`
    : `ProxyPreserveHost On
RequestHeader set X-Orig-Request "expr=%{THE_REQUEST}"
<FilesMatch ".+\\.ph(?:ar|p|tml)$">
  SetHandler "proxy:http://127.0.0.1:${PHP_PORT}"
</FilesMatch>
<FilesMatch ".+\\.phps$">
  Require all denied
</FilesMatch>
<FilesMatch "^\\.ph(?:ar|p|ps|tml)$">
  Require all denied
</FilesMatch>
`
  return `ServerName localhost
Listen 127.0.0.1:${PORT}
PidFile ${BASE}/httpd.pid
ErrorLog ${BASE}/error.log
LogLevel warn
LogFormat "%r %>s %{User-Agent}i" short
CustomLog ${BASE}/access.log short
${user}${load}
# --- Debian / php-image defaults that affect content handling (mods-available/*.conf) ---
TypesConfig /etc/mime.types
AddType application/x-compress .Z
AddType application/x-gzip .gz .tgz
AddType application/x-bzip2 .bz2
AddHandler type-map var
AddType text/html .shtml
LanguagePriority en ca cs da de el eo es et fr he hr it ja ko ltz nl nn no pl pt pt-BR ru sv tr zh-CN zh-TW
ForceLanguagePriority Prefer Fallback
DirectoryIndex index.html index.cgi index.pl index.php index.xhtml index.htm
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
DocumentRoot ${www}
<Directory ${www}>
  Options Indexes FollowSymLinks
  AllowOverride All
  Require all granted
</Directory>
${php}
${tls ? `# TLS twin of the site on ${TLS_PORT}, only so a real browser sees https://www.sporta.com.kw like production
# (upgrade-insecure-requests would otherwise turn every http subresource into a failed https one).
Listen 127.0.0.1:${TLS_PORT}
SSLSessionCache none
<VirtualHost 127.0.0.1:${TLS_PORT}>
  ServerName www.sporta.com.kw
  SSLEngine on
  SSLCertificateFile ${BASE}/tls.crt
  SSLCertificateKeyFile ${BASE}/tls.key
</VirtualHost>
` : ''}${extra}
`
}

let phpProc = null
const waitUp = async () => {
  for (let i = 0; i < 40; i++) {
    const r = await raw(PORT, ['GET /robots.txt HTTP/1.0', `Host: ${HOST}`, 'X-Forwarded-Proto: https'], { timeout: 1000 })
    if (r.status) return
    await new Promise((r2) => setTimeout(r2, 150))
  }
}
const stopApacheOnly = () => stopApache()
const stopApache = () => {
  try { execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'stop'], { stdio: 'ignore' }) } catch { /* not running */ }
}

let TLS = false
function makeCert() {
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=www.sporta.com.kw',
    '-addext', 'subjectAltName=DNS:www.sporta.com.kw', '-keyout', `${BASE}/tls.key`, '-out', `${BASE}/tls.crt`], { encoding: 'utf8' })
  TLS = r.status === 0 && existsSync(`${MODULES}/mod_ssl.so`) && existsSync(`${MODULES}/mod_socache_shmcb.so`)
  return TLS
}

export async function startAll({ patchFile = '', extra = '', phpHandler = 'filesmatch' } = {}) {
  const { www, hashes } = buildTree({ patchFile })
  // The php image ships no php.ini, so display_errors / html_errors are PHP's builtin defaults.
  const cfg = join(BASE, 'api-config.php')
  writeFileSync(cfg, "<?php\nreturn ['db_host' => '127.0.0.1:1', 'db_name' => 'none', 'db_user' => 'none', 'db_pass' => 'none'];\n")
  // `SetHandler proxy:http://...` makes Apache send the script's FILESYSTEM path as the proxied
  // URL, so php -S serves from / and this router puts the original request line back into
  // $_SERVER (REQUEST_URI is what seo-page.php routes on). Returning false lets php -S run
  // the script itself.
  const router = join(BASE, 'router.php')
  writeFileSync(router, `<?php
$www = ${JSON.stringify(www)};
$orig = $_SERVER['HTTP_X_ORIG_REQUEST'] ?? '';
if (preg_match('#^[A-Z]+ (\\S+) HTTP/#', $orig, $m)) $_SERVER['REQUEST_URI'] = $m[1];
$f = parse_url($_SERVER['REQUEST_URI_FS'] ?? ($_SERVER['SCRIPT_NAME'] ?? ''), PHP_URL_PATH);
if (is_string($f) && str_starts_with($f, $www)) { $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = substr($f, strlen($www)); }
return false;
`)
  phpProc = spawn('php', ['-d', 'display_errors=1', '-d', 'html_errors=1', '-d', 'error_reporting=32767',
    '-S', `127.0.0.1:${PHP_PORT}`, '-t', '/', router], {
    env: { ...process.env, SPORTA_API_CONFIG_FILE: cfg },
    stdio: ['ignore', openSync(join(BASE, 'php.log'), 'a'), openSync(join(BASE, 'php.log'), 'a')],
  })
  const tls = makeCert()
  writeFileSync(`${BASE}/httpd.conf`, httpdConf({ www, extra, phpHandler, tls }))
  const t = spawnSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-t'], { encoding: 'utf8' })
  if (t.status !== 0) throw new Error(`httpd -t failed: ${t.stdout}${t.stderr}`)
  stopApache()
  execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'start'])
  await waitUp()
  return { www, hashes }
}

export function stopAll() {
  stopApache()
  try { phpProc?.kill('SIGTERM') } catch { /* gone */ }
  phpProc = null
}

// Request with the production-like defaults (Host + X-Forwarded-Proto, as Traefik sends).
export const get = (path, { method = 'GET', host = HOST, headers = [], proto = 'https' } = {}) =>
  raw(PORT, [
    `${method} ${path} HTTP/1.0`,
    ...(host ? [`Host: ${host}`] : []),
    ...(proto ? [`X-Forwarded-Proto: ${proto}`] : []),
    ...headers,
  ])

// ---------------------------------------------------------------- reporting
let fails = 0
let xfails = 0
let xpass = 0
let oks = 0
// known: id of a reported defect. A failing check with `known` is EXPECTED to fail.
export function check(pass, what, detail = '', known = '') {
  let tag
  if (known) {
    if (pass) { tag = 'XPASS'; xpass++; fails++ } else { tag = 'XFAIL'; xfails++ }
  } else if (pass) { tag = 'ok  '; oks++ } else { tag = 'FAIL'; fails++ }
  console.log(`${tag} ${what}${detail ? `  -- ${detail}` : ''}${known ? `  [known: ${known}]` : ''}`)
}
const section = (s) => console.log(`\n## ${s}`)
const short = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}...` : s)

// ============================================================ the checks
//
// Known defects (expected-fail until the patch lands; ids are this lane's findings):
//   xsshtaccess-1  /pay/pay.php cannot start its POST under the policy it inherits
//   xsshtaccess-2  /images, /hero, /cats serve active content (html, svg, xhtml, xml, js) unsandboxed
//   xsshtaccess-3  Apache-made pages (403, 301, 405, 410) carry no nosniff / X-Frame-Options
//   xsshtaccess-4  `Header always unset X-Powered-By` removes nothing PHP set (htaccess-4 / E3)
const D1 = 'xsshtaccess-1'
const D2 = 'xsshtaccess-2'
const D3 = 'xsshtaccess-3'
const D4 = 'xsshtaccess-4'
const ACTIVE_TYPE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/xml|text\/xml|text\/javascript|application\/javascript)/i

async function runChecks({ www }) {
  await cspChecks()
  await mimeChecks()
  await reflectedChecks()
  await cookieFrameChecks()
  await legacyHeaderChecks()
  await swManifestChecks()
  await adminChecks()
  await duplicateHeaderChecks()
  await browserChecks(www)
}

// ------------------------------------------------------------ 1. CSP
async function cspChecks() {
  section('1 Content-Security-Policy per area, evaluated like a browser')
  const areas = [
    ['/', 'storefront home (api/seo-page.php)'],
    ['/shop', 'storefront route'],
    ['/index.html', 'static shell (301 to /)'],
    ['/backends', 'admin page'],
    ['/api/api.php?r=ping', 'store API (JSON)'],
    ['/api/admin.php?r=me', 'admin API (JSON)'],
    ['/pay/pay.php', 'T-Pay door'],
    ['/knet/pay.php', 'KNET door'],
    ['/images/products/real.jpg', 'uploaded image'],
    ['/nope-404', 'unknown URL (404 shell)'],
    ['/api/store.php', 'Apache 403 (denied include)'],
    ['/.env', 'Apache 403 (dotfile)'],
    ['/boot.js', 'static script'],
    ['/logo.png', 'static image'],
    ['/robots.txt', 'robots'],
    ['/sitemap-pages.xml', 'static sitemap'],
    ['/site.webmanifest', 'manifest'],
    ['/sw.js', 'service worker'],
  ]
  const seen = new Map()
  for (const [path, label] of areas) {
    const r = await get(path)
    const csp = hv(r, 'content-security-policy')
    seen.set(path, { r, csp })
    console.log(`   ${String(r.status).padStart(3)} ${path.padEnd(26)} ${label}: ${csp.length ? short(csp.join(' || '), 70) : '(no CSP)'}`)
  }
  for (const p of ['/', '/shop', '/backends', '/api/api.php?r=ping', '/api/admin.php?r=me', '/pay/pay.php', '/knet/pay.php', '/nope-404', '/boot.js', '/sw.js', '/images/products/real.jpg']) {
    const { r, csp } = seen.get(p)
    check(csp.length === 1, `exactly one CSP on ${p}`, `${csp.length} header(s), status ${r.status}`)
  }
  for (const p of ['/api/store.php', '/.env']) {
    const { r, csp } = seen.get(p)
    check(csp.length === 1, `CSP on the Apache-made ${r.status} page ${p}`, csp.length ? 'present' : 'absent (stock error page: HSTS only)', D3)
  }

  const storefront = h1(seen.get('/shop').r, 'content-security-policy')
  const { dirs, issues } = evalCsp(storefront)
  const bad = issues.filter((i) => i.sev === 'high' || i.sev === 'medium')
  check(bad.length === 0, 'storefront CSP: no high/medium finding by the evaluator',
    bad.length ? bad.map((i) => `${i.sev}: ${i.msg}`).join(' ; ') : `notes: ${issues.map((i) => i.msg).join(' | ')}`)
  const script = dirs.get('script-src') ?? []
  check(script.length >= 2 && script.every((t) => t === "'self'" || /^'sha256-/.test(t)), "script-src is 'self' plus sha256 hashes only", short(script.join(' '), 110))
  check(!script.some((t) => /unsafe|^\*$|^data:|^blob:|^https?:?$|^filesystem:/.test(t)), 'script-src: no unsafe-inline / unsafe-eval / wildcard / data: / blob: / http(s):')
  check(!/__SCRIPT_HASHES__/.test(storefront), 'built policy has no unfilled __SCRIPT_HASHES__ placeholder', 'the harness fills it as scripts/csp-hashes.mjs does')
  check((dirs.get('object-src') ?? []).join() === "'none'", "object-src 'none' (an SVG data: URI can run script in <object>/<iframe>, not in <img>)")
  check((dirs.get('base-uri') ?? []).join() === "'self'", "base-uri 'self'")
  check((dirs.get('frame-ancestors') ?? []).join() === "'self'", "frame-ancestors 'self' (agrees with X-Frame-Options: SAMEORIGIN)")
  check(!(dirs.get('img-src') ?? []).some((t) => /^(https?:|\*)$/.test(t)), "img-src is 'self' data: only", (dirs.get('img-src') ?? []).join(' '))
  check((dirs.get('connect-src') ?? []).join() === "'self'", "connect-src 'self'")
  check(['frame-src', 'child-src', 'worker-src', 'manifest-src', 'media-src'].every((d) => !dirs.has(d)), "frame/child/worker/manifest/media-src fall back to default-src 'self'")
  check((dirs.get('default-src') ?? []).join() === "'self'", "default-src 'self'")
  check(dirs.has('upgrade-insecure-requests'), 'upgrade-insecure-requests present')
  const fonts = [...(dirs.get('style-src') ?? []), ...(dirs.get('font-src') ?? [])].filter((t) => /^https:/.test(t))
  check(fonts.every((t) => /^https:\/\/(use|p)\.typekit\.net$/.test(t)), 'the only external hosts are Adobe Fonts (style/font)', fonts.join(' '))
  // style-src 'unsafe-inline' and no report-uri are postures, not defects: print them, do not fail.
  console.log(`   note: style-src keeps 'unsafe-inline' (React inline styles). An injected style can restyle the page but has nowhere to send data: connect/img/font are same-origin or typekit.`)
  console.log(`   note: no report-uri / report-to: a blocked injection is invisible to the owner.`)
  for (const [path] of areas) {
    const { csp } = seen.get(path)
    if (csp.length !== 1) continue
    const hi = evalCsp(csp[0]).issues.filter((i) => i.sev === 'high')
    if (hi.length) check(false, `no HIGH CSP finding on ${path}`, hi.map((i) => i.msg).join(' ; '))
  }

  // The two doors. KNET answers with a 302, so the policy never meets a form; T-Pay renders a
  // page whose onload handler submits a form to the CBK gateway.
  const payCsp = h1(seen.get('/pay/pay.php').r, 'content-security-policy')
  const pay = parseCsp(payCsp)
  const fa = (pay.get('form-action') ?? []).join(' ')
  check(/pg(test)?\.cbk\.com/.test(fa), '/pay/pay.php: form-action names the CBK gateway hosts it POSTs to', `form-action: ${fa}`, D1)
  const real = readFileSync(join(web, 'dropin', 'php-cbk', 'pay.php'), 'utf8')
  const handler = /<body onload="([^"]+)"/.exec(real)?.[1] ?? ''
  const sc = [...(pay.get('script-src-attr') ?? []), ...(pay.get('script-src') ?? [])].join(' ')
  const hash = `'sha256-${createHash('sha256').update(handler, 'utf8').digest('base64')}'`
  check(sc.includes("'unsafe-inline'") || sc.includes(hash), `/pay/pay.php: its onload handler (${handler || 'none'}) is allowed by the policy`, `script-src(-attr): ${short(sc, 90)}`, D1)
  check(!/<body[^>]*onload=/.test(real) || true, 'note: pay.php still starts from an inline onload (durable fix: external script)')
  const knet = h1(seen.get('/knet/pay.php').r, 'content-security-policy')
  check(knet.length > 0, '/knet/pay.php carries the policy (it redirects, so form-action is not in play)')
}

// ------------------------------------------------------------ 2. nosniff, types, uploads
async function mimeChecks() {
  section('2 nosniff and Content-Type on user-influenced responses; polyglot uploads')
  const json = ['/api/api.php?r=ping', '/api/api.php?r=%3Cscript%3Ealert(1)%3C/script%3E', '/api/api.php?r[]=x',
    '/api/admin.php?r=me', '/api/customer.php', '/api/cron-stock.php', '/api/api.php/%3Cscript%3E']
  for (const p of json) {
    const r = await get(p)
    check(/^application\/json/.test(h1(r, 'content-type')) && h1(r, 'x-content-type-options') === 'nosniff',
      `JSON endpoint ${p} is application/json + nosniff`, `${r.status} ${h1(r, 'content-type')} ${h1(r, 'x-content-type-options')}`)
  }
  for (const [p, type] of [['/sitemap.xml', /^application\/xml/], ['/sitemap-products.xml', /^application\/xml/], ['/sitemap-pages.xml', /^application\/xml/],
    ['/robots.txt', /^text\/plain/], ['/site.webmanifest', /^application\/manifest\+json/], ['/boot.js', /^text\/javascript|^application\/javascript/]]) {
    const r = await get(p)
    check(type.test(h1(r, 'content-type')) && h1(r, 'x-content-type-options') === 'nosniff', `${p} is ${type.source.replace(/\\/g, '')} + nosniff`, `${r.status} ${h1(r, 'content-type')}`)
  }
  // The store's own PHP gives every endpoint a type, including the empty includes.
  for (const p of ['/pay/pay.php', '/knet/pay.php', '/pay/callback.php', '/knet/callback.php']) {
    const r = await get(p)
    check(!/text\/html/.test(h1(r, 'content-type')) && h1(r, 'x-content-type-options') === 'nosniff', `${p} error answer is not text/html and is nosniff`, `${r.status} ${h1(r, 'content-type')}`)
  }

  // --- the media mount: polyglots dropped where the upload route writes
  console.log('\n   polyglots in /images/products (what Apache does with each name):')
  const names = ['real.jpg', 'poly.jpg', 'poly.png', 'x.svg', 'evil.svgz', 'x.html', 'x.htm', 'x.xhtml', 'x.xml', 'x.shtml', 'x.js', 'x.txt',
    'x.php.jpg', 'x.jpg.php', 'x.phtml', 'x.PHP', 'x.Php', 'x.php5', 'x.pht', 'x.jpg.', '.hidden.html']
  const res = {}
  for (const n of names) {
    const r = await get(`/images/products/${n}`)
    res[n] = r
    console.log(`   ${String(r.status).padStart(3)} ${n.padEnd(13)} ${(h1(r, 'content-type') || '(none)').padEnd(30)} nosniff=${h1(r, 'x-content-type-options') || '-'} sandbox=${/sandbox/.test(h1(r, 'content-security-policy'))}`)
  }
  for (const n of ['real.jpg', 'poly.jpg', 'poly.png']) {
    const r = res[n]
    check(/^image\/(jpeg|png)$/.test(h1(r, 'content-type')) && h1(r, 'x-content-type-options') === 'nosniff', `${n} (an image holding markup) is served as ${h1(r, 'content-type')} with nosniff: it cannot render or run as a page`)
  }
  for (const n of ['x.php.jpg', 'x.jpg.']) {
    check(!/PHP-EXECUTED/.test(res[n].text) && /^image\//.test(h1(res[n], 'content-type')), `${n}: double extension is an image, PHP did not run it`, `${h1(res[n], 'content-type')}`)
  }
  for (const n of ['x.jpg.php', 'x.phtml', 'x.PHP', 'x.Php', 'x.php5', 'x.pht']) {
    check(!/PHP-EXECUTED-42/.test(res[n].text), `${n}: never executed`, `${res[n].status} ${h1(res[n], 'content-type') || '(no type)'}`)
  }
  for (const n of ['x.jpg.php', 'x.phtml']) check(res[n].status === 403, `${n}: refused by the media folder's own .htaccess`, String(res[n].status))
  // Anything that is not an image: is it an active document, with nothing to make it inert?
  for (const n of ['x.html', 'x.htm', 'x.xhtml', 'x.xml', 'x.shtml', 'x.js', 'x.svg', 'evil.svgz']) {
    const r = res[n]
    const active = r.status === 200 && ACTIVE_TYPE.test(h1(r, 'content-type'))
    const inert = !active || /(^|[\s;])sandbox($|[\s;])/.test(h1(r, 'content-security-policy')) || /^attachment/i.test(h1(r, 'content-disposition'))
    check(inert, `${n} dropped in /images/products is inert (refused, sandboxed or a download)`,
      `${r.status} ${h1(r, 'content-type') || '(none)'}; CSP sandbox=${/sandbox/.test(h1(r, 'content-security-policy'))}`, D2)
  }
  // The same on the folders the owner fills by hand.
  for (const p of ['/hero/x.html', '/hero/x.svg']) {
    const r = await get(p)
    const active = r.status === 200 && ACTIVE_TYPE.test(h1(r, 'content-type'))
    check(!active || /sandbox/.test(h1(r, 'content-security-policy')), `${p} is inert`, `${r.status} ${h1(r, 'content-type')}`, D2)
  }
  // Names and paths that could make Apache pick another file or another type.
  for (const [p, label] of [['/images/products/x', 'MultiViews: /x must not resolve to x.html'], ['/images/products/multi', 'MultiViews: /multi must not resolve to multi.html'],
    ['/images/products/x.html%20', 'trailing space'], ['/images/products/x.html.', 'trailing dot'], ['/images/products/x.php%20', 'php + space'],
    ['/images/products/real.jpg/x.html', 'PATH_INFO after an image'], ['/images/products/x.html%00.jpg', 'NUL byte']]) {
    const r = await get(p)
    const body = r.text
    check(!/<script>alert\(1\)<\/script>/.test(body) && !/PHP-EXECUTED/.test(body), `${label}: ${p} serves none of the planted files`, `${r.status} ${h1(r, 'content-type')}`)
  }
  // Directory handling: no listing, and with DirectorySlash Off a bare directory must not index.
  for (const p of ['/images/products', '/images/products/', '/hero', '/api', '/pay', '/knet']) {
    const r = await get(p)
    check(r.status !== 200 || !/Index of/i.test(r.text), `${p}: no directory listing`, String(r.status))
  }
  // Negative control: the same fixtures under the older `AddHandler ... .php` form DO run a double
  // extension. Without this the "never executed" lines above could pass for the wrong reason.
  stopApacheOnly()
  writeFileSync(`${BASE}/httpd.conf`, httpdConf({ www: join(BASE, 'www'), phpHandler: 'legacy', tls: TLS }))
  execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'start'])
  await waitUp()
  const ctl = await get('/images/products/x.php.jpg')
  check(/PHP-EXECUTED-42/.test(ctl.text), 'control: under AddHandler .php a double extension (x.php.jpg) DOES execute, so the checks above can fail',
    'docker-php.conf anchors with .+\\.ph(?:ar|p|tml)$ and a SetHandler in a FilesMatch, which is why the real image does not')
  stopApacheOnly()
  writeFileSync(`${BASE}/httpd.conf`, httpdConf({ www: join(BASE, 'www'), tls: TLS }))
  execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'start'])
  await waitUp()
}

// ------------------------------------------------------------ 3. reflected XSS
async function reflectedChecks() {
  section('3 reflected XSS in server-made pages, redirects and header echoes')
  const bodyOf = (r) => r.text.replace(/<style>[\s\S]*?<\/style>/, '')
  const payloads = ['/%22%3E%3Cscript%3Ealert(1)%3C/script%3E', '/x%0d%0a%0d%0a%3Cscript%3Ealert(1)%3C/script%3E', '/a?q="><script>alert(1)</script>']
  // Wrong host: the canonical-host 301 echoes the path into Location and into its own body.
  for (const p of payloads) {
    const r = await get(p, { host: 'evil.example' })
    const loc = h1(r, 'location')
    check(r.status === 301 && loc.startsWith('https://www.sporta.com.kw/'), `bad Host + ${p.slice(0, 40)}: 301 stays on the canonical host`, loc.slice(0, 90))
    check(!/<script>alert/.test(r.text) && !/[\r\n]/.test(loc), `  ... redirect body escapes the payload, Location has no CR/LF`, `body has raw script: ${/<script>alert/.test(r.text)}`)
    check(r.headers.every(([k]) => !/^(set-cookie|x-injected)/.test(k)), '  ... no header was injected through the path')
  }
  for (const [p, label] of [['//evil.example/x', '// prefix'], ['/\\evil.example', 'backslash'], ['/%5Cevil.example', 'encoded backslash'],
    ['/@evil.example/', '@ in path'], ['/shop?next=https://evil.example&redirect=//evil.example', '?next= style parameters']]) {
    const r = await get(p, { host: 'evil.example' })
    const loc = h1(r, 'location')
    check(!r.status || (r.status >= 300 && r.status < 400 ? /^https:\/\/www\.sporta\.com\.kw[/?]/.test(loc) : true), `open redirect: ${label}: Location authority is always www.sporta.com.kw`, `${r.status} ${loc.slice(0, 80)}`)
  }
  // Plain-HTTP rule and the old-URL rules that copy a query string (NE = raw, not re-escaped).
  const httpR = await get('/shop?x=%22%3E%3Cscript%3E', { proto: null })
  check(httpR.status === 301 && /^https:\/\/www\.sporta\.com\.kw\/shop\?x=/.test(h1(httpR, 'location')) && !/<script>alert/.test(httpR.text), 'http -> https 301 keeps the host fixed and escapes its body', h1(httpR, 'location').slice(0, 80))
  const ship = await get('/shipping?x="><script>alert(1)</script>&y=%0d%0aX-A:b')
  const shipLoc = h1(ship, 'location')
  check(ship.status === 301 && shipLoc.startsWith('https://www.sporta.com.kw/terms?') && !ship.headers.some(([k]) => k === 'x-a'), '/shipping?<query> (NE rule) copies the query raw into Location without splitting the header',
    `${shipLoc.slice(0, 70)}...`)
  check(!/<script>alert/.test(bodyOf(ship)), '  ... and its 301 body escapes it')
  const women = await get('/WoMeN?lang=en&x=%3Cscript%3E')
  check(!/<script>/.test(h1(women, 'location')), '/women?<query> never emits a raw tag in Location', h1(women, 'location').slice(0, 90))
  for (const p of ['/index.php?x=%3Cscript%3E', '/index.html?x=%3Cscript%3E', '/panel.php?x=%3Cscript%3E', '/image/cache/%3Cscript%3Ealert(1)%3C/script%3E']) {
    const r = await get(p)
    check(!/<script>alert/.test(bodyOf(r)) && !/[\r\n]/.test(h1(r, 'location')), `${p}: ${r.status} body and Location are clean`)
  }
  // Error documents: the 404 is the static SPA shell (no echo); the other Apache bodies are fixed text.
  for (const p of ['/%3Cscript%3Ealert(7)%3C/script%3E', '/api/%3Cscript%3Ealert(7)%3C/script%3E', '/images/products/%3Cscript%3Ealert(7)%3C/script%3E', '/__MACOSX/%3Cscript%3Ealert(7)%3C/script%3E']) {
    const r = await get(p)
    check(r.status === 404 && !/alert\(7\)/.test(r.text), `404 for ${p.slice(0, 44)} does not echo the URL`, `${r.status} ${h1(r, 'content-type')}`)
  }
  for (const p of ['/api/store.php/%3Cscript%3Ealert(7)%3C/script%3E', '/.env?x=%3Cscript%3Ealert(7)%3C/script%3E', '/%3Cscript%3Ealert(7)%3C/script%3E/.git/config']) {
    const r = await get(p)
    check(r.status === 403 && !/alert\(7\)/.test(r.text), `403 for ${p.slice(0, 44)} is fixed text`, `${r.status}`)
  }
  const bad = await raw(PORT, ['GET /<script>alert(8)</script>%ZZ HTTP/1.0', `Host: ${HOST}`])
  check(!/alert\(8\)/.test(bad.text), 'a 400 for a malformed escape does not echo the URL', `${bad.status}`)
  const tail = await get('/images/products/real.jpg/x.html')
  check(!/alert/.test(tail.text), 'PATH_INFO after a static file does not reach the file')
  // Request headers must not be reflected: Host, X-Forwarded-Host, Referer, User-Agent, Cookie, Origin.
  const evilHdrs = ['X-Forwarded-Host: evil.example', 'Referer: https://evil.example/<script>alert(9)</script>', 'User-Agent: <script>alert(9)</script>', 'Cookie: a=<script>alert(9)</script>', 'Origin: https://evil.example', 'X-Forwarded-For: <script>alert(9)</script>']
  for (const p of ['/shop', '/backends', '/api/api.php?r=ping', '/pay/pay.php', '/nope', '/api/store.php']) {
    const r = await get(p, { headers: evilHdrs })
    const echoed = r.text.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').includes('evil.example') || /alert\(9\)/.test(r.text) || r.headers.some(([, v]) => /evil\.example|alert\(9\)/.test(v))
    check(!echoed, `request headers are not reflected by ${p}`, `${r.status}`)
  }
  // CORS: no Access-Control-* anywhere, with or without credentials.
  for (const p of ['/', '/api/api.php?r=ping', '/api/admin.php?r=me', '/pay/pay.php', '/images/products/real.jpg', '/sitemap.xml']) {
    for (const method of ['GET', 'OPTIONS']) {
      const r = await get(p, { method, headers: ['Origin: https://evil.example', 'Access-Control-Request-Method: POST', 'Cookie: a=b'] })
      check(!r.headers.some(([k]) => k.startsWith('access-control-')), `${method} ${p} with Origin evil.example: no Access-Control-* header`, `${r.status}`)
    }
  }
  // TRACE would echo cookies (XST). TraceEnable Off is the image default; this proves the site does not rely on a header rule.
  for (const p of ['/', '/api/api.php?r=ping']) {
    const r = await get(p, { method: 'TRACE', headers: ['Cookie: sid=secret-trace-marker'] })
    check(r.status === 405 && !/secret-trace-marker/.test(r.text), `TRACE ${p} is refused and echoes nothing`, `${r.status}`)
  }
  // The repo files themselves: nothing builds a header or a redirect from request data except the documented rewrites.
  const files = ['public/.htaccess', 'dropin/php-store/.htaccess', 'dropin/php-knet/.htaccess', 'dropin/php-cbk/.htaccess']
  for (const f of files) {
    const t = readFileSync(join(web, f), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    check(!/\[[^\]]*\bE=/.test(t) && !/%\{(HTTP_HOST|HTTP:Origin|HTTP:Referer|HTTP_REFERER|HTTP_USER_AGENT|HTTP:X-Forwarded-Host)\}e/i.test(t) && !/Header[^\n]*%\{[^}]*(HTTP|ENV)[^}]*\}[es]/i.test(t),
      `${f}: no [E=] env copy and no request header echoed into a Header`)
    check(!/Access-Control-Allow/i.test(t) && !/SSILegacyExprParser|Options[^\n]*\+?Includes|AddOutputFilter\s+INCLUDES/i.test(t), `${f}: no CORS rule, no SSI`)
    const rewrites = t.split('\n').filter((l) => /^\s*RewriteRule\b.*\bhttps?:\/\//.test(l) && /%\{|\$\d|%\d/.test(l))
    const unsafe = rewrites.filter((l) => !/https:\/\/www\.sporta\.com\.kw(%\{REQUEST_URI\}|\/|\?)/.test(l))
    check(unsafe.length === 0, `${f}: every redirect that copies request data starts with the fixed https://www.sporta.com.kw`, unsafe.join(' | '))
  }
}

// ------------------------------------------------------------ 4. cookies and framing
async function cookieFrameChecks() {
  section('4 cookie and framing headers')
  const a = await get('/api/zz-cookie.php')
  const ac = hv(a, 'set-cookie')
  check(ac.length === 3, 'three cookies reach the browser from /api', String(ac.length))
  check(/^plain=1;.*Secure/i.test(ac[0]) && /SameSite=Lax/i.test(ac[0]), 'a bare cookie from /api gets Secure and SameSite=Lax added', ac[0])
  check(/;\s*secure/i.test(ac[1]) && (ac[1].match(/;\s*secure/gi) ?? []).length === 1 && /HttpOnly/i.test(ac[1]) && /SameSite=Strict/i.test(ac[1]), 'an admin-style cookie (Secure, HttpOnly, Strict) is left alone, no duplicate flag', ac[1])
  check(/SameSite=None/i.test(ac[2]) && !/SameSite=Lax/i.test(ac[2]), 'a deliberate SameSite=None is not downgraded or doubled', ac[2])
  const p = await get('/pay/zz-cookie.php')
  const pc = hv(p, 'set-cookie')[0] ?? ''
  check(/Secure/i.test(pc) && /HttpOnly/i.test(pc) && /SameSite=Lax/i.test(pc), '/pay forces Secure + HttpOnly + SameSite=Lax on a bare cookie', pc)
  // Framing: header and policy agree everywhere a document can be framed.
  for (const path of ['/', '/shop', '/backends', '/api/api.php?r=ping', '/pay/pay.php', '/knet/pay.php', '/nope-404']) {
    const r = await get(path)
    const xfo = hv(r, 'x-frame-options')
    const fa = parseCsp(h1(r, 'content-security-policy')).get('frame-ancestors') ?? []
    check(xfo.length === 1 && /^SAMEORIGIN$/i.test(xfo[0]) && fa.join() === "'self'", `${path}: one X-Frame-Options (${xfo.join('|') || 'none'}) agrees with frame-ancestors (${fa.join(' ') || 'none'})`, `status ${r.status}`)
  }
  for (const path of ['/api/store.php', '/.env', '/index.php', '/images/products']) {
    const r = await get(path)
    check(hv(r, 'x-frame-options').length === 1, `Apache-made ${r.status} ${path} cannot be framed (X-Frame-Options)`, hv(r, 'x-frame-options').join('|') || 'absent', D3)
  }
  const rp = await get('/shop')
  check(h1(rp, 'referrer-policy') === 'strict-origin-when-cross-origin', 'storefront Referrer-Policy strict-origin-when-cross-origin', h1(rp, 'referrer-policy'))
  const ra = await get('/api/api.php?r=ping')
  check(hv(ra, 'referrer-policy').join() === 'no-referrer', '/api answers Referrer-Policy: no-referrer once', hv(ra, 'referrer-policy').join('|'))
  check(h1(rp, 'cross-origin-opener-policy') === 'same-origin' && h1(rp, 'cross-origin-resource-policy') === 'same-origin', 'COOP and CORP same-origin on the storefront')
  console.log('   note: nothing in src/ or public/ uses an <iframe>: X-Frame-Options DENY + frame-ancestors none would cost nothing (owner decision).')
}

// ------------------------------------------------------------ 5. X-XSS-Protection
async function legacyHeaderChecks() {
  section('5 the obsolete X-XSS-Protection header')
  for (const p of ['/', '/shop', '/backends', '/api/api.php?r=ping', '/pay/pay.php', '/knet/pay.php', '/images/products/real.jpg', '/nope-404', '/api/store.php', '/sw.js']) {
    const r = await get(p)
    check(!r.headers.some(([k]) => k === 'x-xss-protection'), `${p}: no X-XSS-Protection header (1; mode=block is harmful in old browsers)`, `${r.status}`)
  }
  const sources = ['public/.htaccess', 'dropin/php-store/.htaccess', 'dropin/php-knet/.htaccess', 'dropin/php-cbk/.htaccess']
  check(sources.every((f) => !/X-XSS-Protection/i.test(readFileSync(join(web, f), 'utf8'))), 'no .htaccess sets X-XSS-Protection')
  const phpHits = []
  for (const dir of ['php-store', 'php-knet', 'php-cbk']) {
    for (const f of readdirSync(join(web, 'dropin', dir)).filter((n) => n.endsWith('.php'))) {
      if (/X-XSS-Protection/i.test(readFileSync(join(web, 'dropin', dir, f), 'utf8'))) phpHits.push(`${dir}/${f}`)
    }
  }
  check(phpHits.length === 0, 'no dropin PHP file sends X-XSS-Protection', phpHits.join(' '))
}

// ------------------------------------------------------------ 6. service worker, manifest
async function swManifestChecks() {
  section('6 service worker and manifests')
  const sw = await get('/sw.js')
  check(/^(text|application)\/javascript/.test(h1(sw, 'content-type')) && h1(sw, 'x-content-type-options') === 'nosniff', '/sw.js is JavaScript + nosniff', h1(sw, 'content-type'))
  check(/no-cache/.test(h1(sw, 'cache-control')) && /must-revalidate/.test(h1(sw, 'cache-control')), '/sw.js always revalidates', h1(sw, 'cache-control'))
  check(!sw.headers.some(([k]) => k === 'service-worker-allowed'), '/sw.js sends no Service-Worker-Allowed (it is at the root, default scope is /; widening is not needed)', 'absent')
  const swSrc = readFileSync(join(web, 'public', 'sw.js'), 'utf8')
  check(!/importScripts\s*\(/.test(swSrc), 'sw.js imports no script from anywhere')
  for (const p of ['/site.webmanifest', '/backends.webmanifest']) {
    const r = await get(p)
    check(h1(r, 'content-type') === 'application/manifest+json' && h1(r, 'x-content-type-options') === 'nosniff', `${p} is application/manifest+json + nosniff`, h1(r, 'content-type'))
    check(hv(r, 'content-security-policy').length === 1, `${p} carries the policy`)
  }
  for (const f of ['site.webmanifest', 'backends.webmanifest']) {
    const m = JSON.parse(readFileSync(join(web, 'public', f), 'utf8'))
    const urls = [m.start_url, m.scope, m.id, ...(m.icons ?? []).map((i) => i.src), ...(m.shortcuts ?? []).map((s) => s.url)].filter(Boolean)
    check(urls.every((u) => !/^(https?:)?\/\//i.test(u) || /^https:\/\/www\.sporta\.com\.kw\//.test(u)) && urls.every((u) => !/^(javascript|data):/i.test(u)), `${f}: every URL is same-origin and none is javascript:/data:`, urls.join(' ').slice(0, 100))
  }
}

// ------------------------------------------------------------ 7. the admin page
async function adminChecks() {
  section('7 /backends (the admin page)')
  for (const p of ['/backends', '/backends/x']) {
    const r = await get(p)
    const csp = hv(r, 'content-security-policy')
    const d = parseCsp(csp[0] ?? '')
    check(r.status === 200 && csp.length === 1 && (d.get('frame-ancestors') ?? []).join() === "'self'" && hv(r, 'x-frame-options').join() === 'SAMEORIGIN', `${p}: 200 with one CSP and a frame ban on other origins`, `${r.status} xfo=${h1(r, 'x-frame-options')}`)
    check(/no-cache/.test(h1(r, 'cache-control')) && !/public/.test(h1(r, 'cache-control')), `${p}: HTML revalidates and is not marked public`, h1(r, 'cache-control'))
    check(/noindex/.test(h1(r, 'x-robots-tag')), `${p}: X-Robots-Tag noindex`, h1(r, 'x-robots-tag') || 'absent (the HTML carries it)')
    check(/^text\/html/.test(h1(r, 'content-type')) && h1(r, 'x-content-type-options') === 'nosniff', `${p}: text/html + nosniff`)
  }
  const slash = await get('/backends/')
  check(slash.status === 404, '/backends/ is a real 404 (no redirect loop, no soft 200)', String(slash.status))
  check(hv(slash, 'content-security-policy').length === 1, '  ... and the 404 shell carries the policy')
  const adminApi = await get('/api/admin.php?r=me')
  check(/^application\/json/.test(h1(adminApi, 'content-type')) && /no-store/.test(h1(adminApi, 'cache-control')), '/api/admin.php answers JSON, no-store', h1(adminApi, 'cache-control'))
  const robots = readFileSync(join(web, 'public', 'robots.txt'), 'utf8')
  check(/Disallow:\s*\/backends/i.test(robots), 'robots.txt disallows /backends')
}

// ------------------------------------------------------------ duplicates
async function duplicateHeaderChecks() {
  section('Header hygiene: no security header is sent twice')
  const watch = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cache-control', 'content-type', 'permissions-policy']
  const paths = ['/', '/shop', '/backends', '/nope-404', '/boot.js', '/sw.js', '/logo.png', '/robots.txt', '/sitemap.xml', '/site.webmanifest',
    '/api/api.php?r=ping', '/api/admin.php?r=me', '/api/sitemap-index.php', '/pay/pay.php', '/pay/callback.php', '/knet/pay.php', '/knet/callback.php',
    '/images/products/real.jpg', '/images/products/x.svg', '/hero/x.svg', '/api/store.php', '/.env', '/index.php', '/shipping', '/images/products/x.php.jpg']
  const dups = []
  for (const p of paths) {
    const r = await get(p)
    for (const k of watch) if (hv(r, k).length > 1) dups.push(`${p} ${k} x${hv(r, k).length}`)
  }
  check(dups.length === 0, `no duplicated security header across ${paths.length} responses`, dups.join('; '))
  // X-Powered-By: `Header always unset` touches only the error table, PHP writes the success table.
  const xp = await get('/api/api.php?r=ping')
  check(!xp.headers.some(([k]) => k === 'x-powered-by'), 'X-Powered-By is removed by the .htaccess (live: expose_php=Off does it instead)', hv(xp, 'x-powered-by').join(), D4)
}

// ------------------------------------------------------------ real browser (optional)
async function findChrome() {
  const cands = [process.env.CHROMIUM_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium'].filter(Boolean)
  return cands.find((c) => existsSync(c)) || ''
}

async function browserChecks(www) {
  section('Real browser (Chrome): what the policies do to the files and to pay.php')
  const exe = await findChrome()
  let chromium
  try { ({ chromium } = await import(join(web, 'node_modules', 'playwright', 'index.mjs'))) } catch { /* not installed */ }
  if (!exe || !chromium || !TLS) { console.log(`   skipped: ${!exe ? 'no Chrome binary' : !chromium ? 'no playwright in node_modules' : 'no openssl / mod_ssl for the https twin'}`); return }
  // pay.php's real markup (the template after the PHP prologue), rendered with stub values, put
  // beside the real file's name so pay/.htaccess's <FilesMatch "^pay\.php$"> applies to it.
  const real = readFileSync(join(web, 'dropin', 'php-cbk', 'pay.php'), 'utf8')
  const tpl = real.slice(real.indexOf('?><!doctype html>'))
  mkdirSync(join(www, 'pay', 'zz'), { recursive: true })
  writeFileSync(join(www, 'pay', 'zz', 'pay.php'),
    `<?php\n$checkoutUrl='https://pgtest.cbk.com/ePay/pg/epay?_v=x'; $fields=['tij_a'=>'b'];\n$h=fn($v)=>htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');\nheader('Content-Type: text/html; charset=utf-8');\n${tpl}`)
  writeFileSync(join(www, 'images', 'products', 'zz-script.html'), '<script src="/images/products/x.js"></script><script>document.title="INLINE-RAN"</script>')
  writeFileSync(join(www, 'images', 'products', 'x.js'), 'document.title="EXTERNAL-JS-RAN"')
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--ignore-certificate-errors', `--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:${TLS_PORT}, MAP pgtest.cbk.com 127.0.0.1:1, MAP pg.cbk.com 127.0.0.1:1, MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`] })
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    const visit = async (path) => {
      const page = await ctx.newPage()
      const out = { requests: [], dialogs: 0, console: [] }
      page.on('request', (rq) => out.requests.push(`${rq.method()} ${rq.url()}`))
      page.on('dialog', async (d) => { out.dialogs++; await d.dismiss() })
      page.on('console', (m) => out.console.push(m.text()))
      try { await page.goto(`https://www.sporta.com.kw${path}`, { waitUntil: 'load', timeout: 8000 }) } catch { /* connection refused to the gateway host is expected */ }
      await page.waitForTimeout(500)
      out.title = await page.title().catch(() => '')
      await page.close()
      return out
    }
    const pay = await visit('/pay/zz/pay.php')
    const posted = pay.requests.some((r) => /^POST https:\/\/pgtest\.cbk\.com\//.test(r))
    check(posted, 'Chrome: pay.php\'s onload handler runs and the form POST leaves for the CBK gateway', posted ? 'POST to pgtest.cbk.com' : `stayed on the page; ${pay.console.filter((c) => /Content Security Policy/.test(c)).map((c) => c.slice(0, 70)).join(' | ') || 'no CSP message'}`, D1)
    const x = await visit('/images/products/zz-script.html')
    check(x.title !== 'INLINE-RAN' && x.title !== 'EXTERNAL-JS-RAN', 'Chrome: a planted HTML page in the media mount runs neither an inline script nor a same-origin script file', `title=${JSON.stringify(x.title)}`, D2)
    for (const p of ['/images/products/x.svg', '/hero/x.svg']) {
      const s = await visit(p)
      check(s.dialogs === 0, `Chrome: ${p} (onload + <script>) shows no dialog`, `blocked by ${s.console.some((c) => /sandbox/.test(c)) ? 'sandbox' : s.console.some((c) => /Content Security Policy/.test(c)) ? 'the page CSP' : '?'}`)
    }
    const poly = await visit('/images/products/poly.jpg')
    check(poly.dialogs === 0 && poly.title === '', 'Chrome: poly.jpg (an image holding <html><script>) renders as an image, nothing runs')
  } finally { await browser.close() }
}

async function main() {
  if (!APACHE) {
    console.log('apache2/httpd is not installed - skipping (this suite needs a real server to be meaningful)')
    process.exit(0)
  }
  const { www, hashes } = await startAll({ patchFile: PATCH })
  console.log(`${execFileSync(APACHE, ['-v'], { encoding: 'utf8' }).split('\n')[0]}   inline-script hashes: ${hashes.length}${PATCH ? `   patch: ${PATCH}` : ''}`)
  try {
    await runChecks({ www })
  } finally {
    if (!KEEP) { stopAll(); rmSync(BASE, { recursive: true, force: true }) }
  }
  console.log(`\n${oks} ok, ${xfails} expected-fail (known defects), ${xpass} unexpected-pass, ${fails - xpass} FAIL`)
  if (xpass) console.log('XPASS means a known defect is fixed: delete its `known` marker in this file.')
  process.exit(fails ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => { stopAll(); process.exit(130) })
  main().catch((e) => { console.error(e); stopAll(); process.exit(1) })
}
