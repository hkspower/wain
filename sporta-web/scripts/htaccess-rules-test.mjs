#!/usr/bin/env node
// HTACCESS-RULES TEST - the .htaccess rules, EXECUTED by a real Apache 2.4, as a URL matrix.
//
//   node scripts/htaccess-rules-test.mjs                run the matrix (npm run test:htaccess-rules)
//   node scripts/htaccess-rules-test.mjs --patch F      apply unified diff F to the scratch copy of
//                                                       public/.htaccess first (before/after runs)
//   node scripts/htaccess-rules-test.mjs --keep         leave the servers running afterwards
//   node scripts/htaccess-rules-test.mjs --dump         print every case with what came back
//
// Rig-free. It starts and stops its OWN Apache (default port 8391) and its OWN `php -S`
// (default 8392) under a scratch directory, touches no database, no repo file and no port
// another suite uses. It skips with exit 0 and a clear line when apache2/httpd is absent.
//   HTRULES_PORT, HTRULES_PHP_PORT, HTRULES_DIR override the port pair and the scratch dir.
//
// What it adds to the two older audits
//   scripts/storage-audit.mjs   "is anything sensitive reachable?" - ~60 checks, needs dist/,
//                               one Host, no redirect, header or compression coverage.
//   scripts/sec-htaccess-scan.mjs  the same questions asked of the LIVE site, read-only.
// This one needs no dist/ (the tree is assembled from public/ and dropin/ exactly as the VPS
// lays it out), and it asserts, per URL: status, Location, hop count, headers and the body
// that actually came back. A case is one row of CASES below: data, not code.
//
// Layout built (the VPS: Traefik terminates TLS -> apache-sporta, php:8.4-apache):
//   www/                  public/ + index.html + .htaccess (the real file, CSP hashes filled in
//                         the way scripts/csp-hashes.mjs does at postbuild)
//   www/api www/knet www/pay    dropin/php-store, php-knet, php-cbk with their own .htaccess
//   www/images/products   the media mount, with the .htaccess the live server has there (100 B,
//                         not in the repo; reproduced from LIVE-SECURITY-SCAN-2026-11-03.md)
//   www/hero www/cats     the other two media mounts (owner-placed files, no .htaccess)
// PHP: the php:8.x-apache image's docker-php.conf (`<FilesMatch \.php$> SetHandler
// application/x-httpd-php`) with the interpreter moved behind a loopback proxy, because the
// sandbox has no libphp. The real dropin code runs with no database, so the real endpoints
// answer their error paths, which is what the header checks need.
//
// KNOWN DEFECTS are asserted as expected-fail ("XFAIL"): the suite is green while the defect
// exists and goes RED ("XPASS") the day it is fixed - the cue to delete the `known` marker
// (and see scratchpad htaccess-proposed.diff for the patch that fixes them).
import { spawnSync, spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import net from 'node:net'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const web = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const DUMP = argv.includes('--dump')
const patchIdx = argv.indexOf('--patch')
const PATCH = patchIdx >= 0 ? resolve(argv[patchIdx + 1]) : process.env.HTRULES_PATCH || ''
const BASE = process.env.HTRULES_DIR || join(tmpdir(), 'sporta-htaccess-rules')
const PORT = Number(process.env.HTRULES_PORT || 8391)
const PHP_PORT = Number(process.env.HTRULES_PHP_PORT || 8392)
const HOST = 'www.sporta.com.kw'
const MODULES = process.env.HTRULES_MODULES || '/usr/lib/apache2/modules'

const APACHE = spawnSync('sh', ['-c', 'command -v apache2 || command -v httpd'], { encoding: 'utf8' }).stdout.trim().split('\n')[0] || ''

// ------------------------------------------------------------------ raw HTTP client
// The exact request line is sent (so `//x`, `/%2e%2e/`, `/x.php%00.jpg` and a Host of
// `www.sporta.com.kw.` go out verbatim), duplicate headers are kept in order, nothing is
// decoded and no redirect is followed. HTTP/1.0: one request per connection.
function raw(lines, { timeout = 6000, port = PORT } = {}) {
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
      if (cut < 0) return resolveP({ status: 0, headers: [], body: Buffer.alloc(0), text: buf.toString('latin1') })
      const head = buf.subarray(0, cut).toString('latin1').split('\r\n')
      const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head[0])?.[1] ?? 0)
      const headers = head.slice(1).map((l) => {
        const i = l.indexOf(':')
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]
      })
      let body = buf.subarray(cut + 4)
      if (headers.some(([k, v]) => k === 'transfer-encoding' && /chunked/i.test(v))) body = dechunk(body)
      resolveP({ status, headers, body, text: body.toString('utf8') })
    }
    sock.setTimeout(timeout, done)
    sock.on('data', (c) => chunks.push(c))
    sock.on('end', done)
    sock.on('close', done)
    sock.on('error', done)
    sock.on('connect', () => sock.write(`${lines.join('\r\n')}\r\n\r\n`))
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

// A request as Traefik would forward it: Host + X-Forwarded-Proto, plain HTTP on the wire.
// `host: null` sends no Host; `proto: null` sends no X-Forwarded-Proto.
const req = (path, { method = 'GET', host = HOST, proto = 'https', headers = [], version = '1.1' } = {}) =>
  raw([
    `${method} ${path} HTTP/${version}`,
    ...(host !== null ? [`Host: ${host}`] : []),
    ...(proto !== null ? [`X-Forwarded-Proto: ${proto}`] : []),
    ...(version === '1.1' ? ['Connection: close'] : []),
    ...headers,
  ])

// ------------------------------------------------------------------ the tree
const mkd = (p) => mkdirSync(p, { recursive: true })
const put = (p, body) => { mkd(join(p, '..')); writeFileSync(p, body) }
const dir = (p) => p.split('/').slice(0, -1).join('/')

function buildTree(patchFile) {
  rmSync(BASE, { recursive: true, force: true })
  const www = join(BASE, 'www')
  mkd(www)
  cpSync(join(web, 'public'), www, { recursive: true })
  const indexHtml = existsSync(join(web, 'index.html'))
    ? readFileSync(join(web, 'index.html'), 'utf8')
    : '<!doctype html><html><head><title>Sporta</title></head><body><div id="root"></div></body></html>'
  writeFileSync(join(www, 'index.html'), indexHtml)
  // dropin -> api / knet / pay. Never a config.php (git-ignored, server-only): the fixtures below stage fakes.
  for (const [src, dst] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
    cpSync(join(web, 'dropin', src), join(www, dst), { recursive: true, filter: (p) => !/(^|\/)config\.php$/.test(p) })
  }
  // The postbuild step (scripts/csp-hashes.mjs): sha256 of every inline non-JSON-LD script.
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

  // Hashed Vite output, a font, fixed-name images (the cache tiers).
  put(join(www, 'assets/index-CuCZhORW.js'), 'console.log(1)\n')
  put(join(www, 'assets/About-sNx2ecy0.css'), 'body{margin:0}\n')
  put(join(www, 'assets/index-CuCZhORW.js.map'), '{"version":3}\n')
  put(join(www, 'assets/logo-3fa9c2d1.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
  put(join(www, 'assets/data-abcdef12.json'), '{"a":1}\n')
  put(join(www, 'assets/Header.hashed12.mjs'), 'export default 1\n')
  put(join(www, 'fonts/probe.woff2'), Buffer.alloc(64, 7))
  put(join(www, 'hero/desktop/probe.webp'), Buffer.from('RIFF....WEBPVP8 ', 'latin1'))
  put(join(www, 'cats/mobile/probe.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))
  put(join(www, 'archive.zip'), 'PK\x03\x04zip')
  put(join(www, 'big.txt'), 'x'.repeat(4000))
  put(join(www, 'arabic-\u0633.txt'), 'x'.repeat(100))

  // The media mount: separate directory, its own .htaccess (no repo copy: reproduced from the live scan).
  const media = join(www, 'images/products')
  mkd(media)
  writeFileSync(join(media, '.htaccess'), 'Options -Indexes\n<FilesMatch "\\.(php|phtml|phar|cgi|pl|py|sh)$">\n  Require all denied\n</FilesMatch>\n')
  const PHPBODY = '<?php echo "PHP-EXECUTED-" . (6*7); ?>'
  for (const n of ['x.jpg.php', 'x.php.jpg', 'x.phtml', 'x.pht', 'x.php5', 'x.phar', 'x.PHP', 'x.Php', 'x.php.', 'x.php%00.jpg', 'x.php;.jpg', 'x.php.png', 'x.php7', 'x.inc', 'x.shtml']) {
    writeFileSync(join(media, n), PHPBODY)
  }
  writeFileSync(join(media, 'real.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF\0')]))
  writeFileSync(join(media, 'poly.jpg'), '\xff\xd8\xff\xe0<html><script>alert(1)</script></html>', 'latin1')
  writeFileSync(join(media, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>')
  writeFileSync(join(media, 'x.html'), '<html><script>alert(1)</script></html>')
  writeFileSync(join(media, '.hidden.php'), PHPBODY)
  mkd(join(media, 'responsive'))
  writeFileSync(join(media, 'responsive/p-320.webp'), 'RIFF....WEBPVP8 ')
  // Owner-placed pictures one level up carry NO .htaccess of their own.
  writeFileSync(join(www, 'hero/x.php'), PHPBODY)
  writeFileSync(join(www, 'cats/x.jpg.php'), PHPBODY)
  writeFileSync(join(www, 'hero/x.html'), '<html><script>alert(1)</script></html>')

  // Secrets and bait: every one has been seen in a web root, or is the shape of one.
  for (const f of ['.env', '.env.local', '.git/config', '.git/HEAD', '.svn/entries', '.DS_Store', '.htpasswd', '.user.ini', '._logo.png',
    '.hidden/inner.txt', '.well-known/acme-challenge/tok123', '.well-known/security.txt', '.well-known/.hidden', 'sub/.env', 'sub/.git/config',
    'knet/.env', 'pay/.env', 'api/.env', 'images/products/.env', 'hero/.env',
    'api/.git/config', 'knet/.git/config', 'pay/.git/config', 'hero/.git/config', 'cats/.git/HEAD', 'images/products/.git/config', 'fonts/.git/config',
    'assets/.git/config', 'images/.git/config', 'hero/desktop/.git/config', 'api/.svn/entries', 'hero/.hidden/inner.txt', 'sub/.hidden/inner.txt']) {
    put(join(www, f), 'SECRET\n')
  }
  for (const f of ['dump.sql', 'backup.bak', 'index.html.bak', 'index.html.old', 'index.html~', 'index.html.orig', 'index.html.save', 'index.html.swp', '.index.html.swp',
    'site.log', 'error_log', 'php_errors.log', 'access_log', 'debug.log', 'composer.json', 'composer.lock', 'package.json', 'package-lock.json', 'yarn.lock',
    'pnpm-lock.yaml', 'vite.config.js', 'vite.config.ts', 'tsconfig.json', 'jsconfig.json', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'deploy.config.json', 'deploy.sh', 'smoke.mjs', 'build.ts', 'README.md', 'notes.md', 'site.tar', 'site.tar.gz', 'site.gz', 'site.tgz', 'site.7z', 'site.rar',
    'config-dist.php', 'knet-config.php', 'sporta-deploy.php', 'sporta-deploy-config.php', 'config.php', 'config.php.bak', 'config.php~', 'config.php.save',
    'config.inc.php', 'config.ini', 'php.ini', 'settings.yml', 'settings.yaml', 'data.csv', 'report.xlsx', 'server.pem', 'server.key', 'server.crt', 'db.sqlite',
    'db.sqlite3', 'db.db', 'app.toml', 'x.inc', 'x.dist', 'x.lock', 'x.phps', 'x.map', 'x.conf', 'cache.jsonl', 'token.json', 'feed.json', 'phpinfo.php',
    'info.php', 'test.php', 'shell.php', 'adminer.php', 'selftest.php', 'setup-config.php', 'preflight.php', 'go-live.html', 'x.exe', 'x.bin', 'x.env', 'x.sh',
    'sub/x.log', 'sub/package.json', 'sub/notes.md', 'sub/dump.sql', 'sub/config.php', 'sub/data.json', 'sub/backup.zip',
    'api/config.php', 'api/config.php.bak', 'api/config.example.php', 'api/store.php', 'api/x.log', 'api/dump.sql', 'api/notes.md', 'api/package.json',
    'api/data.json', 'api/.cbk_token.json', 'knet/x.log', 'knet/data.json', 'knet/notes.md', 'knet/dump.sql', 'knet/knet-payments.log', 'knet/config.php',
    'knet/config.php.bak', 'pay/x.log', 'pay/data.json', 'pay/notes.md', 'pay/dump.sql', 'pay/.cbk_token.json', 'pay/cbk-payments.log', 'pay/config.php',
    'pay/config.php.bak', 'pay/package.json', 'knet/package.json', 'knet/backup.zip', 'pay/backup.zip', 'api/backup.zip', 'api/x.map', 'pay/x.map', 'knet/x.map',
    'images/products/x.log', 'images/products/dump.sql', 'images/products/data.json', 'hero/x.log', 'hero/data.json']) {
    put(join(www, f), /\.php$/.test(f) ? "<?php /* SECRET */ return ['k' => 'SECRET'];\n" : 'SECRET\n')
  }
  // Directories with no index file.
  put(join(www, 'emptyish/thing.txt'), 'x\n')
  put(join(www, 'sub/.htaccess'), '<IfModule mod_rewrite.c>\n  RewriteEngine On\n  RewriteRule ^nothing$ - [L]\n</IfModule>\n')
  mkd(join(www, 'private-dir'))
  // A leftover index.php beside index.html (the old site).
  writeFileSync(join(www, 'index.php'), '<?php echo "OLD-SITE";')
  writeFileSync(join(www, 'knet/index.php'), '<?php echo "NESTED-INDEX";')
  put(join(www, '__MACOSX/._x'), 'x')
  put(join(www, 'panel.php'), '<?php echo "OLD-PANEL";')
  // A physical /backends directory (the previous deployment left one) is NOT created here:
  // the case is run in a second pass, see CASES_PHYSICAL_BACKENDS.

  // Fixture endpoints, scratch tree only.
  writeFileSync(join(www, 'api/zz-cookie.php'),
    "<?php\nsetcookie('plain', '1');\nsetcookie('sec', '2', ['secure' => true, 'httponly' => true, 'samesite' => 'Strict']);\nheader('Content-Type: text/plain'); echo 'ok';\n")
  writeFileSync(join(www, 'pay/zz-cookie.php'), "<?php\nsetcookie('plain', '1');\nheader('Content-Type: text/plain'); echo 'ok';\n")
  writeFileSync(join(www, 'knet/zz-cookie.php'), "<?php\nsetcookie('plain', '1');\nheader('Content-Type: text/plain'); echo 'ok';\n")
  writeFileSync(join(www, 'api/zz-ok.php'), "<?php\nheader('Content-Type: application/json'); echo '{\"ok\":true}';\n")
  writeFileSync(join(www, 'pay/zz-ok.php'), "<?php\nheader('Content-Type: application/json'); echo '{\"ok\":true}';\n")
  writeFileSync(join(www, 'knet/zz-ok.php'), "<?php\nheader('Content-Type: application/json'); echo '{\"ok\":true}';\n")
  writeFileSync(join(www, 'api/zz-cors.php'), "<?php\nheader('Access-Control-Allow-Origin: *'); header('Content-Type: application/json'); echo '{}';\n")
  // A stand-in for pay.php's body: the exact markup the real file prints (inline onload + a form post).
  writeFileSync(join(www, 'pay/zz-form.php'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body onload="document.forms[0].submit()">'
    + '<form method="post" action="https://pg.cbk.com/ePay/pg/epay?_v=t"><input type="hidden" name="a" value="b"></form></body></html>')
  chmodRecursive(BASE)
  return { www, hashes, indexHtml }
}

function chmodRecursive(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    try { chmodSync(p, e.isDirectory() ? 0o755 : 0o644) } catch { /* best effort */ }
    if (e.isDirectory()) chmodRecursive(p)
  }
  try { chmodSync(d, 0o755) } catch { /* best effort */ }
}

// The Apache config: the php:8.4-apache image's own defaults (docker-php.conf, Debian's
// mime/negotiation/dir/autoindex defaults) with AllowOverride All on the docroot.
function httpdConf(www, extra = '') {
  const mods = ['mpm_event', 'authz_core', 'authz_host', 'mime', 'dir', 'headers', 'rewrite', 'deflate', 'brotli',
    'filter', 'setenvif', 'alias', 'expires', 'autoindex', 'negotiation', 'env', 'log_config', 'proxy', 'proxy_http',
    'allowmethods']
  const builtin = spawnSync(APACHE, ['-l'], { encoding: 'utf8' }).stdout
  const load = mods
    .filter((n) => !new RegExp(`^\\s*mod_${n}\\.c\\s*$`, 'm').test(builtin))
    .map((n) => `LoadModule ${n}_module ${MODULES}/mod_${n}.so`).join('\n')
  const user = process.getuid?.() === 0 ? 'User www-data\nGroup www-data\n' : ''
  return `ServerName localhost
Listen 127.0.0.1:${PORT}
PidFile ${BASE}/httpd.pid
ErrorLog ${BASE}/error.log
LogLevel warn
${user}${load}
TypesConfig /etc/mime.types
AddType application/x-compress .Z
AddType application/x-gzip .gz .tgz
AddType application/x-bzip2 .bz2
AddHandler type-map var
AddType text/html .shtml
LanguagePriority en ca cs da de el eo es et fr he hr it ja ko ltz nl nn no pl pt pt-BR ru sv tr zh-CN zh-TW
ForceLanguagePriority Prefer Fallback
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
# php:8.4-apache's docker-php.conf: exactly \\.php$ (case-sensitive), interpreter behind a loopback proxy here.
ProxyPreserveHost On
<FilesMatch \\.php$>
  SetHandler "proxy:http://127.0.0.1:${PHP_PORT}"
</FilesMatch>
DirectoryIndex disabled
DirectoryIndex index.php index.html
${extra}
`
}

let phpProc = null
const stopApache = () => { try { execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'stop'], { stdio: 'ignore' }) } catch { /* not running */ } }
const stopAll = () => { stopApache(); try { phpProc?.kill('SIGTERM') } catch { /* gone */ } phpProc = null }

async function startAll({ patchFile = '', extra = '' } = {}) {
  const { www, hashes, indexHtml } = buildTree(patchFile)
  const cfg = join(BASE, 'api-config.php')
  writeFileSync(cfg, "<?php\nreturn ['db_host' => '127.0.0.1:1', 'db_name' => 'none', 'db_user' => 'none', 'db_pass' => 'none'];\n")
  phpProc = spawn('php', ['-d', 'display_errors=0', '-d', 'expose_php=1', '-S', `127.0.0.1:${PHP_PORT}`, '-t', '/'], {
    env: { ...process.env, SPORTA_API_CONFIG_FILE: cfg },
    stdio: 'ignore',
  })
  writeFileSync(`${BASE}/httpd.conf`, httpdConf(www, extra))
  const t = spawnSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-t'], { encoding: 'utf8' })
  if (t.status !== 0) throw new Error(`httpd -t failed: ${t.stdout}${t.stderr}`)
  stopApache()
  execFileSync(APACHE, ['-f', `${BASE}/httpd.conf`, '-k', 'start'])
  for (let i = 0; i < 50; i++) {
    const r = await req('/robots.txt')
    if (r.status) break
    await new Promise((r2) => setTimeout(r2, 150))
  }
  return { www, hashes, indexHtml }
}

export { raw, req, hv, h1, startAll, stopAll, httpdConf, buildTree, BASE, PORT, HOST, APACHE, web, PATCH, KEEP, DUMP, zlib }
