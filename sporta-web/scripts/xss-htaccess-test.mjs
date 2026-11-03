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
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, chmodSync, openSync } from 'node:fs'
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

  // dropin -> api / knet / pay, never a config.php (git-ignored, server-only).
  for (const [src, dst] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
    cpSync(join(web, 'dropin', src), join(www, dst), {
      recursive: true,
      filter: (p) => !/(^|\/)config\.php$/.test(p),
    })
  }

  // The postbuild step, scripts/csp-hashes.mjs: hash every inline, non-JSON-LD script.
  const hashes = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type\s*=\s*"application\/ld\+json"/.test(m[1]))
    .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  let ht = readFileSync(join(web, 'public', '.htaccess'), 'utf8')
  if (patchFile) {
    const tmp = join(BASE, 'htaccess.patched')
    writeFileSync(tmp, ht)
    const p = spawnSync('patch', ['--no-backup-if-mismatch', '-s', tmp, patchFile], { encoding: 'utf8' })
    if (p.status !== 0) throw new Error(`patch did not apply: ${p.stdout}${p.stderr}`)
    ht = readFileSync(tmp, 'utf8')
    rmSync(tmp, { force: true })
  }
  writeFileSync(join(www, '.htaccess'), ht.replace('__SCRIPT_HASHES__', hashes.join(' ')))

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

export function httpdConf({ www, extra = '', phpHandler = 'filesmatch' } = {}) {
  const mods = ['mpm_event', 'authz_core', 'authz_host', 'mime', 'dir', 'headers', 'rewrite', 'deflate',
    'brotli', 'filter', 'setenvif', 'alias', 'expires', 'autoindex', 'negotiation', 'env', 'log_config',
    'proxy', 'proxy_http']
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
${extra}
`
}

let phpProc = null
const stopApache = () => {
  try { execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'stop'], { stdio: 'ignore' }) } catch { /* not running */ }
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
  writeFileSync(`${BASE}/httpd.conf`, httpdConf({ www, extra, phpHandler }))
  const t = spawnSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-t'], { encoding: 'utf8' })
  if (t.status !== 0) throw new Error(`httpd -t failed: ${t.stdout}${t.stderr}`)
  stopApache()
  execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'start'])
  for (let i = 0; i < 40; i++) {
    const r = await raw(PORT, ['GET /robots.txt HTTP/1.0', `Host: ${HOST}`, 'X-Forwarded-Proto: https'], { timeout: 1000 })
    if (r.status) break
    await new Promise((r2) => setTimeout(r2, 150))
  }
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
async function runChecks() {
  await cspChecks()
  await mimeChecks()
  await reflectedChecks()
  await cookieFrameChecks()
  await legacyHeaderChecks()
  await swManifestChecks()
  await adminChecks()
}

async function cspChecks() { section('1 Content-Security-Policy per area') }
async function mimeChecks() { section('2 nosniff and Content-Type') }
async function reflectedChecks() { section('3 reflected XSS') }
async function cookieFrameChecks() { section('4 cookies and framing') }
async function legacyHeaderChecks() { section('5 X-XSS-Protection') }
async function swManifestChecks() { section('6 service worker and manifest') }
async function adminChecks() { section('7 admin') }

async function main() {
  if (!APACHE) {
    console.log('apache2/httpd is not installed - skipping (this suite needs a real server to be meaningful)')
    process.exit(0)
  }
  const { hashes } = await startAll({ patchFile: PATCH })
  console.log(`${execFileSync(APACHE, ['-v'], { encoding: 'utf8' }).split('\n')[0]}   inline-script hashes: ${hashes.length}${PATCH ? `   patch: ${PATCH}` : ''}`)
  try {
    await runChecks()
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

export { runChecks, check as _check, section as _section, short as _short, web as _web, PORT as _PORT }
void 0
