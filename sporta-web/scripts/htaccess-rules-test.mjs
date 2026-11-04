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
// exists and goes RED ("XPASS") the day it is fixed - the cue to delete the `known` marker.
// The markers are the finding ids of the 2026-11-03 htaccess lane:
//   1 /pay/pay.php: inherited CSP blocks its inline onload and the post to pg.cbk.com
//   2 /index.php/<anything> runs the old front controller        3 microphone=() blocks Sporta AI
//   4 deny-list gaps (config.php~, *.ini, *.sqlite, *.pem, error_log, .map ...)
//   5 `Header always unset X-Powered-By` removes nothing         6 Apache-made pages lack nosniff/XFO
//   7 an unlisted fixed-name add-on is served immutable          8 dot-directories in folders with their own RewriteEngine
//   9 .php runs from /hero and /cats                            10 text/plain without a charset
//  11 (FIXED 2026-11-03, page weight) compressed text never revalidated to 304   12 /backends static shell has no noindex header
//  13 api include files answer 200                              14 storefront HTML sent no-referrer
//  16 minor: two hops for /index.html over http, duplicate Cache-Control on 301s, admin-google.php returns to
//     /backends/ which the rules 404  (its "404 shell uncompressed" part was FIXED 2026-11-03, page weight)
// A proposed fix is a unified diff against sporta-web/ (paths a/public/.htaccess, a/dropin/php-*/.htaccess):
// `--patch F` installs it into the scratch tree, and every defect it repairs prints XPASS.
import { spawnSync, spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import net from 'node:net'
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
  // The four .htaccess files as the repo has them, or as a unified diff (paths relative to
  // sporta-web/: public/.htaccess, dropin/php-store/.htaccess ...) would leave them.
  const HT = {
    'public/.htaccess': '.htaccess',
    'dropin/php-store/.htaccess': 'api/.htaccess',
    'dropin/php-knet/.htaccess': 'knet/.htaccess',
    'dropin/php-cbk/.htaccess': 'pay/.htaccess',
  }
  const src = join(BASE, 'htsrc')
  for (const rel of Object.keys(HT)) {
    mkd(join(src, rel, '..'))
    cpSync(join(web, rel), join(src, rel))
  }
  if (patchFile) {
    const p = spawnSync('patch', ['-p1', '--no-backup-if-mismatch', '-s', '-d', src, '-i', patchFile], { encoding: 'utf8' })
    if (p.status !== 0) throw new Error(`patch did not apply: ${p.stdout}${p.stderr}`)
  }
  for (const [rel, dest] of Object.entries(HT)) {
    writeFileSync(join(www, dest), readFileSync(join(src, rel), 'utf8').replace('__SCRIPT_HASHES__', hashes.join(' ')))
  }
  // api/seo-page.php and the sitemap scripts need a database; the stand-ins print a marker so the
  // rewrite that SENDS a request to them can be told from the one that serves the static shell.
  writeFileSync(join(www, 'api/seo-page.php'), "<?php header('Content-Type: text/html; charset=utf-8'); echo 'SEO-PAGE-STUB';\n")
  writeFileSync(join(www, 'api/sitemap-index.php'), "<?php header('Content-Type: application/xml; charset=utf-8'); echo '<sitemapindex/>';\n")
  writeFileSync(join(www, 'api/sitemap-products.php'), "<?php header('Content-Type: application/xml; charset=utf-8'); echo '<urlset/>';\n")

  // Hashed Vite output, a font, fixed-name images (the cache tiers).
  put(join(www, 'assets/index-CuCZhORW.js'), 'console.log(1)\n'.repeat(200))
  put(join(www, 'assets/About-sNx2ecy0.css'), `${'body{margin:0}\n'.repeat(200)}`)
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
    '.well-known-evil/x', '.well-known.bak', 'api/.git/config', 'knet/.git/config', 'pay/.git/config', 'hero/.git/config', 'cats/.git/HEAD', 'images/products/.git/config', 'fonts/.git/config',
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

// ============================================================================ the matrix
// Reporting. A check with `known` (the id of a reported defect) is EXPECTED to fail: it prints
// XFAIL and the suite stays green. The day the defect is fixed it prints XPASS and the suite goes
// red, which is the cue to delete the marker. Anything else that fails is a FAIL.
let oks = 0, fails = 0, xfails = 0, xpass = 0, nCases = 0
const xpassList = []
const failList = []
function check(pass, what, detail = '', known = '') {
  nCases++
  let tag
  if (known) {
    if (pass) { tag = 'XPASS'; xpass++; xpassList.push(`${known} ${what}`) } else { tag = 'XFAIL'; xfails++ }
  } else if (pass) { tag = 'ok  '; oks++ } else { tag = 'FAIL'; fails++; failList.push(what) }
  if (DUMP || tag === 'FAIL' || tag === 'XPASS' || tag === 'XFAIL') {
    console.log(`${tag} ${what}${detail ? `  -- ${detail}` : ''}${known ? `  [known: ${known}]` : ''}`)
  }
}
const section = (name) => console.log(`\n## ${name}`)
const short = (s, n = 150) => (String(s).length > n ? `${String(s).slice(0, n)}...` : String(s))

// expect: { s: 200 | [403,404], loc: 'exact' | RegExp | null(no Location), body: RegExp, nobody: RegExp,
//           h: { 'header-name': RegExp | string | null (absent) }, once: ['header-name'...] }
function judge(r, e) {
  const bad = []
  const ss = [].concat(e.s ?? [])
  if (ss.length && !ss.includes(r.status)) bad.push(`status ${r.status} (want ${ss.join('|')})`)
  if (e.loc !== undefined) {
    const l = h1(r, 'location')
    if (e.loc === null ? l !== '' : e.loc instanceof RegExp ? !e.loc.test(l) : l !== e.loc) bad.push(`Location ${l || '(none)'} (want ${e.loc})`)
  }
  if (e.body && !e.body.test(r.text)) bad.push(`body lacks ${e.body}`)
  if (e.nobody && e.nobody.test(r.text)) bad.push(`body has ${e.nobody}: ${short(r.text.replace(/\s+/g, ' '), 50)}`)
  for (const [k, want] of Object.entries(e.h ?? {})) {
    const got = hv(r, k)
    if (want === null) { if (got.length) bad.push(`${k} present: ${short(got[0], 60)}`) }
    else if (!got.length) bad.push(`${k} absent`)
    else if (want instanceof RegExp ? !want.test(got.join(', ')) : got.join(', ') !== want) bad.push(`${k}: ${short(got.join(' / '), 90)} (want ${want})`)
  }
  for (const k of e.once ?? []) if (hv(r, k).length !== 1) bad.push(`${k} sent ${hv(r, k).length} times`)
  return bad
}
async function run(label, path, e, o = {}) {
  const r = await req(path, o)
  const bad = judge(r, e)
  check(bad.length === 0, `${o.method ?? 'GET'} ${short(path, 70)}${o.host !== undefined && o.host !== HOST ? ` [Host ${o.host}]` : ''}${o.proto !== undefined && o.proto !== 'https' ? ` [proto ${o.proto}]` : ''} ${label ? `(${label})` : ''}`,
    bad.join('; ') || `${r.status}`, e.known ?? '')
  return r
}

// Follow redirects the way a browser does against Traefik: the next request goes to the Location's
// host and scheme. Returns the chain so hop counts can be asserted.
async function chain(host, proto, path, opts = {}) {
  let cur = { host, proto, path }
  const trail = []
  for (let i = 0; i < 8; i++) {
    const r = await req(cur.path, { host: cur.host, proto: cur.proto, ...(cur.host === null ? { version: '1.0' } : {}), ...opts })
    const loc = h1(r, 'location')
    trail.push(`${cur.proto}://${cur.host}${short(cur.path, 40)} ${r.status}`)
    if (![301, 302, 307, 308].includes(r.status) || !loc) return { r, hops: i, trail, path: cur.path, host: cur.host, proto: cur.proto }
    const u = new URL(loc, `${cur.proto}://${cur.host}`)
    cur = { host: u.host, proto: u.protocol.slice(0, -1), path: u.pathname + u.search }
  }
  return { r: null, hops: 99, trail }
}

// ---------------------------------------------------------------- the data
const read = (rel) => readFileSync(join(web, rel), 'utf8')
// The four .htaccess files as the harness installed them (the repo's, or the repo's with --patch applied).
const readHt = (rel) => readFileSync(join(BASE, 'htsrc', rel), 'utf8')
const appRoutes = [...read('src/App.jsx').matchAll(/<Route path="([^"*]+)"/g)].map((m) => m[1]).filter((p) => p !== '/')
const htRoutesLine = /RewriteRule \^\(([a-z|]+)\)\/\?\$ \/index\.html \[L\]/.exec(read('public/.htaccess'))
const htRoutes = htRoutesLine ? htRoutesLine[1].split('|') : []

// The routes the storefront has today. App.jsx is parsed; a route added there must be routable here.
const SPA_FIXED = ['/shop', '/cart', '/checkout', '/about', '/contact', '/wishlist', '/track', '/returns', '/terms', '/privacy', '/review', '/payment/result']
const SPA_PARAM = ['/product/anything', '/product/%D8%AD%D8%B0%D8%A7%D8%A1', '/invoice/ABC123', '/invoice/a1B2c3']
// In the .htaccess list, with no screen in this repo's App.jsx (the live storefront has them): still routed.
const SPA_BACKLOG = ['/account', '/support', '/exchange']
const SPA_ADMIN = ['/backends', '/backends/orders', '/backends/orders/', '/backends/a/b/c']
const NOT_ROUTES = ['/nope', '/nope/deep/path', '/Shop', '/SHOP', '/Cart', '/shop/x', '/shop.html', '/product/', '/product/a/b', '/invoice/', '/invoice/AB-1',
  '/invoice/' + 'A'.repeat(31), '/payment/result/x', '/payment', '/terms/x', '/backends/', '/backends//', '/Backends', '/BACKENDS/x', '/favicon.ico', '/apple-touch-icon-precomposed.png',
  '/wp-login', '/xmlrpc', '/admin', '/administrator', '/phpmyadmin/', '/shop%00', '/shop%20', '/shop.', '/index', '/home', '/en', '/ar', '/sitemap', '/sitemap.xml.gz',
  '/sitemap-categories.xml', '/robots', '/api/nothing', '/api/nothing.json', '/knet/nothing', '/pay/nothing', '/images/products/missing.jpg', '/assets/missing-AbCdEf12.js', '/hero/missing.webp']

// Files that must be reachable (legit). Every non-hidden file in public/ is added at run time.
const ENTRYPOINTS = ['/api/api.php', '/api/admin.php', '/api/admin-google.php', '/api/customer.php', '/api/birthday.php', '/api/seo-page.php',
  '/knet/pay.php', '/knet/callback.php', '/pay/pay.php', '/pay/callback.php']

// Files that must NEVER be served as their bytes. Every one is staged in the scratch tree with the
// word SECRET inside (PHP ones: SECRET in a comment, so a PHP engine answers empty and only a
// source leak shows the word).
const DENY_ROOT = ['/.env', '/.env.local', '/.git/config', '/.git/HEAD', '/.svn/entries', '/.DS_Store', '/.htpasswd', '/.htaccess', '/.user.ini', '/._logo.png', '/.hidden/inner.txt',
  '/dump.sql', '/backup.bak', '/index.html.bak', '/index.html.old', '/index.html.orig', '/index.html.save', '/index.html.swp', '/.index.html.swp', '/site.log', '/php_errors.log',
  '/debug.log', '/composer.json', '/composer.lock', '/package.json', '/package-lock.json', '/yarn.lock', '/pnpm-lock.yaml', '/vite.config.js', '/vite.config.ts', '/tsconfig.json',
  '/jsconfig.json', '/Dockerfile', '/docker-compose.yml', '/docker-compose.yaml', '/deploy.config.json', '/deploy.sh', '/smoke.mjs', '/build.ts', '/README.md', '/notes.md', '/site.tar',
  '/site.tar.gz', '/site.gz', '/archive.zip', '/config-dist.php', '/knet-config.php', '/sporta-deploy.php', '/sporta-deploy-config.php', '/config.php.bak', '/config.php.save',
  '/token.json', '/feed.json', '/cache.jsonl', '/x.env', '/x.sh', '/__MACOSX/._x']
// Not served today and not on the FilesMatch list: the class E2 of LIVE-SECURITY-SCAN-2026-11-03.md
// and its neighbours. The site ships none of them, so denying the class costs nothing.
const DENY_GAP = ['/access_log', '/error_log', '/config.ini', '/php.ini', '/config.php~', '/index.html~', '/app.toml', '/data.csv', '/report.xlsx', '/db.db', '/db.sqlite', '/db.sqlite3',
  '/server.pem', '/server.key', '/server.crt', '/settings.yml', '/settings.yaml', '/site.tgz', '/site.7z', '/site.rar', '/x.map', '/x.conf', '/x.inc', '/x.lock', '/x.dist', '/x.phps',
  '/api/x.map', '/knet/x.map', '/pay/x.map', '/assets/index-CuCZhORW.js.map']
const DENY_SUB = ['/sub/.env', '/sub/x.log', '/sub/package.json', '/sub/notes.md', '/sub/dump.sql', '/sub/data.json', '/sub/backup.zip', '/api/.env', '/knet/.env', '/pay/.env',
  '/images/products/.env', '/hero/.env', '/api/.git/config', '/knet/.git/config', '/pay/.git/config', '/hero/.git/config', '/cats/.git/HEAD', '/images/products/.git/config',
  '/fonts/.git/config', '/assets/.git/config', '/images/.git/config', '/hero/desktop/.git/config', '/api/.svn/entries', '/hero/.hidden/inner.txt',
  '/api/config.php', '/api/config.php.bak', '/api/config.example.php', '/api/store.php', '/api/x.log', '/api/dump.sql', '/api/notes.md', '/api/package.json', '/api/data.json', '/api/.cbk_token.json',
  '/knet/x.log', '/knet/data.json', '/knet/notes.md', '/knet/dump.sql', '/knet/knet-payments.log', '/knet/config.php', '/knet/config.php.bak', '/knet/package.json', '/knet/backup.zip',
  '/pay/x.log', '/pay/data.json', '/pay/notes.md', '/pay/dump.sql', '/pay/.cbk_token.json', '/pay/cbk-payments.log', '/pay/config.php', '/pay/config.php.bak', '/pay/package.json', '/pay/backup.zip',
  '/api/backup.zip', '/images/products/x.log', '/images/products/dump.sql', '/images/products/data.json', '/hero/x.log', '/hero/data.json',
  '/api/preflight.php', '/api/setup-admin.php', '/api/store.php', '/api/crm.php', '/api/returns.php', '/api/cron-auth.php', '/api/customer-auth.php', '/api/seo-config.php',
  '/api/seo-runtime.php', '/api/config-path.php', '/api/birthday-lib.php', '/knet/knet.php', '/knet/selftest.php', '/knet/setup-config.php', '/knet/config.example.php',
  '/pay/cbk.php', '/pay/config.example.php']
// Include files and cron scripts that answer 200 over HTTP today (K-2 of the live scan, api-4).
const DENY_INCLUDES = ['/api/profiles.php', '/api/support.php', '/api/assistant.php']
// A file named config*.php is never an endpoint. Outside api/ knet/ pay/ no rule names it.
const DENY_CONFIG_ANYWHERE = ['/config.php', '/sub/config.php', '/config.inc.php']

// Polyglots and double extensions in the media mount: each must be denied OR served inert
// (a static type, never executed). `exec` marks the ones a PHP engine WOULD run.
const MEDIA = [
  ['/images/products/x.jpg.php', 'denied'], ['/images/products/x.jpg.php/', 'denied'], ['/images/products/x.jpg.php/foo.jpg', 'denied'],
  ['/images/products/x.phtml', 'denied'], ['/images/products/x.phar', 'denied'], ['/images/products/.hidden.php', 'denied'],
  ['/images/products/x.php.jpg', 'inert'], ['/images/products/x.php.png', 'inert'], ['/images/products/x.pht', 'inert'], ['/images/products/x.php5', 'inert'],
  ['/images/products/x.php7', 'inert'], ['/images/products/x.PHP', 'inert'], ['/images/products/x.Php', 'inert'], ['/images/products/x.php.', 'inert'],
  ['/images/products/x.php%2500.jpg', 'inert'], ['/images/products/x.php;.jpg', 'inert'], ['/images/products/x.inc', 'inert'], ['/images/products/x.shtml', 'inert'],
  ['/images/products/x.jpg.php%00.jpg', 'denied'], ['/images/products/x.jpg%00.php', 'denied'], ['/images/products/x.jpg.php%20', 'denied'], ['/images/products/x.jpg.php.', 'denied'],
  ['/images/products/real.jpg/x.php', 'denied'], ['/images/products/x.php.jpg/x.php', 'denied'],
]
// Owner-placed folders: no .htaccess of their own. A .php there executes today.
const MEDIA_OWNER = ['/hero/x.php', '/cats/x.jpg.php']

// Traversal and encoding tricks aimed at the deny rules. Each must end denied (403/404/400), never 200 with the bytes.
const EVADE = [
  '/api/config.php/', '/api/config.php/x', '/api/config.php/x.jpg', '/api/config.php%20', '/api/config.php.', '/api/config.php%00.jpg', '/api/CONFIG.PHP', '/api/%63onfig.php',
  '/api/config.php%2f', '/api/./config.php', '/api//config.php', '/api/x/../config.php', '/api/config.php?x=1', '/api/config.php%3fx', '/api/config.php%23x',
  '/images/products/../../api/config.php', '/images/products/..%2f..%2fapi/config.php', '/images/products/%2e%2e/%2e%2e/api/config.php', '/images/products/%252e%252e/%252e%252e/api/config.php',
  '/images/products/..%5c..%5capi%5cconfig.php', '/images/products/..;/..;/api/config.php', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd', '/%252e%252e/etc/passwd',
  '/.%2e/etc/passwd', '/....//....//etc/passwd', '/.GIT/config', '/.Git/HEAD', '/%2egit/config', '/%2Egit/config', '/.git%2fconfig', '/.git%252fconfig', '/.git/', '/.git',
  '/.env/', '/.env.', '/.ENV', '/.env%00.jpg', '/.env%20', '/.env;.jpg', '/.well-known/../.env', '/.well-known/./.env', '/.well-known/.hidden', '/.htaccess/', '/.HTACCESS',
  '/%2ehtaccess', '/api/.htaccess', '/knet/.htaccess', '/pay/.htaccess', '/images/products/.htaccess', '/.well-known%2f..%2f.env', '/.well-known/%2e%2e/.env',
]

// ---------------------------------------------------------------- CSP evaluation
function parseCsp(text) {
  const dirs = new Map()
  for (const part of text.split(';')) {
    const t = part.trim().split(/\s+/).filter(Boolean)
    if (t.length && !dirs.has(t[0].toLowerCase())) dirs.set(t[0].toLowerCase(), t.slice(1))
  }
  return dirs
}
// Would a browser run this inline event-handler attribute (onload="...")? Needs 'unsafe-inline'
// (with no hash or nonce present, which would void it) or 'unsafe-hashes' plus the sha256 of the
// attribute value.
function inlineHandlerAllowed(csp, handler) {
  const d = parseCsp(csp)
  const sc = d.get('script-src') ?? d.get('default-src') ?? []
  const hash = `'sha256-${createHash('sha256').update(handler, 'utf8').digest('base64')}'`
  const hasHashOrNonce = sc.some((t) => /^'(sha\d+-|nonce-)/.test(t))
  if (sc.includes("'unsafe-inline'") && !hasHashOrNonce) return true
  return sc.includes("'unsafe-hashes'") && sc.includes(hash)
}
const formActionAllows = (csp, origin) => {
  const fa = parseCsp(csp).get('form-action')
  return !fa || fa.includes('*') || fa.includes(origin)
}

// ---------------------------------------------------------------- the checks
const SEC_ONCE = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cross-origin-opener-policy',
  'cross-origin-resource-policy', 'content-security-policy', 'permissions-policy', 'cache-control', 'content-type']

async function runChecks({ www, hashes, indexHtml }) {
  // ------------------------------------------------------------ 0 the files themselves
  section('0 The .htaccess files as written (source level)')
  const ht = Object.fromEntries(['public/.htaccess', 'dropin/php-store/.htaccess', 'dropin/php-knet/.htaccess', 'dropin/php-cbk/.htaccess'].map((f) => [f, readHt(f)]))
  check((ht['public/.htaccess'].match(/__SCRIPT_HASHES__/g) ?? []).length === 1, 'public/.htaccess holds the CSP placeholder exactly once (csp-hashes.mjs fills it at postbuild)')
  const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/application\/ld\+json/.test(m[1]))
  check(hashes.length === inlineScripts.length, `the harness hashed every inline script of index.html (${hashes.length})`)
  const missingRoutes = appRoutes.filter((p) => !(p.split('/').filter(Boolean).length ? htRoutes.includes(p.split('/')[1]) || ['product', 'invoice', 'payment'].includes(p.split('/')[1]) : true))
  check(missingRoutes.length === 0, 'every route of src/App.jsx is in the .htaccess route list', missingRoutes.join(' ') || `${appRoutes.length} routes`)
  const htOnly = htRoutes.filter((r) => !appRoutes.some((p) => p.split('/')[1] === r))
  check(htOnly.join(',') === 'account,support,exchange', 'routes listed in .htaccess but with no screen in this repo are exactly the documented live-storefront backlog', htOnly.join(','))
  for (const [f, text] of Object.entries(ht)) {
    const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    const rules = code.indexOf('RewriteRule'), engine = code.indexOf('RewriteEngine On')
    check(rules < 0 || (engine >= 0 && engine < rules), `${f}: RewriteEngine On precedes the first RewriteRule`)
    check(!/Header\s+(always\s+)?add\s/i.test(code), `${f}: no 'Header add' (a duplicate-header source)`)
    check(!/Header\s+edit\*/i.test(code), `${f}: no 'Header edit*' (segfaults Apache 2.4.58 on Set-Cookie)`)
  }
  check(!/Header always unset X-Powered-By/.test(ht['public/.htaccess']), "public/.htaccess: no 'Header always unset X-Powered-By' (touches only the error table; PHP's header is in the success table)", '', 'htaccess-5')
  for (const f of ['dropin/php-knet/.htaccess', 'dropin/php-cbk/.htaccess']) {
    check(!/Header always unset X-Powered-By/.test(ht[f]), `${f}: no 'Header always unset X-Powered-By'`, '', 'htaccess-5')
  }
  // Every IfModule wrapper, so a new one is noticed. A wrapper whose module is absent is skipped
  // SILENTLY: that is the point of listing them. php:8.4-apache loads deflate, dir, mime, setenvif,
  // alias, autoindex, negotiation, env, filter by default; rewrite and headers (and expires, brotli)
  // are NOT in the image's default set: the live site is known to have the first two (it redirects and
  // sends HSTS); expires and brotli are unconfirmed.
  const wrappers = {}
  for (const [f, text] of Object.entries(ht)) for (const m of text.matchAll(/^\s*<IfModule\s+(!?[\w.]+)>/gm)) (wrappers[m[1]] ??= []).push(f.split('/')[1] === 'php-store' ? 'api' : f.split('/')[1] === 'php-knet' ? 'knet' : f.split('/')[1] === 'php-cbk' ? 'pay' : 'root')
  const expected = ['!LiteSpeed', 'LiteSpeed', 'mod_brotli.c', 'mod_deflate.c', 'mod_dir.c', 'mod_expires.c', 'mod_headers.c', 'mod_mime.c', 'mod_php.c', 'mod_rewrite.c']
  check(Object.keys(wrappers).sort().join() === expected.sort().join(), 'the set of <IfModule> wrappers is the one audited: ' + Object.keys(wrappers).sort().join(' '))
  console.log(`   IfModule wrappers (module: files): ${Object.entries(wrappers).map(([k, v]) => `${k}: ${[...new Set(v)].join('+')}`).join('; ')}`)
  check(read('dropin/php-store/admin-google.php').indexOf('/backends/?') < 0,
    'admin-google.php returns to /backends (the .htaccess answers /backends/ with a 404 on purpose)', 'it builds /backends/?google=...', 'htaccess-16')

  // ------------------------------------------------------------ 1 routes (production layout)
  section('1 SPA routes: known routes are 200, everything else is a real 404 (api/seo-page.php present, as on the VPS)')
  const okRoute = { s: 200, body: /SEO-PAGE-STUB/, h: { 'cache-control': /^no-cache, stale-while-revalidate=60$/ } }
  await run('home', '/', okRoute)
  await run('home + query', '/?lang=en', okRoute)
  await run('home + query', '/?x=1&y=%D8%B3', okRoute)
  for (const p of [...SPA_FIXED, ...SPA_BACKLOG]) { await run('route', p, okRoute); await run('route, trailing slash', `${p}/`, okRoute) }
  for (const p of SPA_PARAM) await run('parameterised route', p, okRoute)
  await run('param route, trailing slash', '/product/anything/', okRoute)
  await run('param route, trailing slash', '/invoice/ABC123/', okRoute)
  for (const p of SPA_ADMIN) await run('admin', p, okRoute)
  await run('admin + query', '/backends?via=panel', okRoute)
  for (const p of NOT_ROUTES) {
    // .json and .gz are on the deny list, so they answer 403 (never a 200); %00 is refused by Apache itself.
    const st = p.includes('%00') ? [400, 404] : /\.(json|gz)$/.test(p) ? [403, 404] : 404
    await run('unknown -> real 404 with the shell', p, { s: st, nobody: /SEO-PAGE-STUB/, ...(p.includes('%00') || /\.(json|gz)$/.test(p) ? {} : { body: /id="root"/ }) })
  }
  await run('/backends/ is a 404 on purpose (loop guard)', '/backends/', { s: 404, body: /id="root"/ })

  // ------------------------------------------------------------ 2 redirects
  section('2 Redirects: every spelling of the host, scheme and old URLs, with hop counts')
  const W = HOST
  const hopCases = [
    // [label, host, proto, path, hops, final status, final path (RegExp)]
    ['canonical', W, 'https', '/shop', 0, 200, /^\/shop$/],
    ['http', W, 'http', '/shop', 1, 200, /^\/shop$/],
    ['no X-Forwarded-Proto', W, null, '/shop', 1, 200, /^\/shop$/],
    ['bare domain https', 'sporta.com.kw', 'https', '/shop', 1, 200, /^\/shop$/],
    ['bare domain http', 'sporta.com.kw', 'http', '/shop', 1, 200, /^\/shop$/],
    ['UPPERCASE host', 'WWW.SPORTA.COM.KW', 'https', '/shop', 0, 200, /^\/shop$/],
    ['UPPERCASE host over http', 'WWW.SPORTA.COM.KW', 'http', '/shop', 1, 200, /^\/shop$/],
    ['trailing-dot host', 'www.sporta.com.kw.', 'https', '/shop', 1, 200, /^\/shop$/],
    ['host with :443', 'www.sporta.com.kw:443', 'https', '/shop', 0, 200, /^\/shop$/],
    ['server IP', '187.7.78.123', 'http', '/shop', 1, 200, /^\/shop$/],
    ['server IP over https', '187.7.78.123', 'https', '/shop', 1, 200, /^\/shop$/],
    ['foreign host', 'evil.example', 'https', '/shop', 1, 200, /^\/shop$/],
    ['lookalike host', 'www.sporta.com.kw.evil.example', 'https', '/shop', 1, 200, /^\/shop$/],
    ['no Host header', null, 'https', '/shop', 1, 200, /^\/shop$/],
    ['query survives', 'sporta.com.kw', 'http', '/shop?lang=en&q=%D8%A3', 1, 200, /^\/shop\?lang=en&q=%D8%A3$/i],
    ['Arabic path survives', 'sporta.com.kw', 'http', '/product/%D8%AD%D8%B0%D8%A7%D8%A1', 1, 200, /^\/product\/%d8%ad%d8%b0%d8%a7%d8%a1$/i],
    ['home over http', W, 'http', '/', 1, 200, /^\/$/],
    ['home, bare, ?lang=en', 'sporta.com.kw', 'http', '/?lang=en', 1, 200, /^\/\?lang=en$/],
    ['old /women', W, 'http', '/women', 1, 200, /^\/shop\?category=women$/],
    ['old /women, bare, http', 'sporta.com.kw', 'http', '/women', 1, 200, /^\/shop\?category=women$/],
    ['old /men/ + lang', W, 'https', '/men/?lang=en', 1, 200, /^\/shop\?category=men&lang=en$/],
    ['old /accessories', W, 'https', '/accessories', 1, 200, /^\/shop\?category=accessories$/],
    ['old /privacy-policy', 'sporta.com.kw', 'http', '/privacy-policy?lang=en', 1, 200, /^\/privacy\?lang=en$/],
    ['old /terms-and-conditions', W, 'https', '/terms-and-conditions', 1, 200, /^\/terms$/],
    ['old /return-policy', W, 'https', '/return-policy', 1, 200, /^\/returns$/],
    ['old /about-us', W, 'https', '/about-us', 1, 200, /^\/about$/],
    ['old /contact-us', W, 'https', '/contact-us', 1, 200, /^\/contact$/],
    ['old /shipping', W, 'https', '/shipping', 1, 200, /^\/terms$/],
    ['old /delivery-policy + lang', W, 'https', '/delivery-policy?lang=en', 1, 200, /^\/terms\?lang=en$/],
    ['old /refund', W, 'https', '/refund', 1, 200, /^\/returns$/],
    ['old /policy', W, 'https', '/policy', 1, 200, /^\/privacy$/],
    ['old /policies', W, 'https', '/policies', 1, 200, /^\/terms$/],
    ['/index.html', W, 'https', '/index.html', 1, 200, /^\/$/],
    ['/index.html?x=1', W, 'https', '/index.html?x=1', 1, 200, /^\/\?x=1$/],
    ['/INDEX.HTML', W, 'https', '/INDEX.HTML', 1, 200, /^\/$/],
    ['/index.php', W, 'https', '/index.php', 1, 200, /^\/$/],
    ['/index.php?x=1', W, 'https', '/index.php?x=1', 1, 200, /^\/\?x=1$/],
    ['/panel.php', W, 'https', '/panel.php', 1, 200, /^\/backends\?via=panel-20261026$/],
    ['/index.html over http: ONE hop', W, 'http', '/index.html', 1, 200, /^\/$/, 'htaccess-16'],
    ['/index.html on the bare domain: ONE hop', 'sporta.com.kw', 'http', '/index.html', 1, 200, /^\/$/, 'htaccess-16'],
    ['/index.php over http: ONE hop', W, 'http', '/index.php', 1, 200, /^\/$/, 'htaccess-16'],
    ['/knet/pay.php over http', W, 'http', '/knet/pay.php', 1, null, /^\/knet\/pay\.php$/],
    ['/pay/pay.php on the bare domain', 'sporta.com.kw', 'https', '/pay/pay.php', 1, null, /^\/pay\/pay\.php$/],
    ['/api/api.php?r=products on the bare domain', 'sporta.com.kw', 'https', '/api/api.php?r=products', 1, null, /^\/api\/api\.php\?r=products$/],
    ['/backends over http', W, 'http', '/backends', 1, 200, /^\/backends$/],
    ['/backends on the bare domain', 'sporta.com.kw', 'https', '/backends', 1, 200, /^\/backends$/],
    ['sitemap over http', W, 'http', '/sitemap.xml', 1, 200, /^\/sitemap\.xml$/],
    ['robots on the bare domain', 'sporta.com.kw', 'http', '/robots.txt', 1, 200, /^\/robots\.txt$/],
  ]
  for (const [label, host, proto, path, hops, status, finalPath, known] of hopCases) {
    const c = await chain(host, proto, path)
    const ok = c.r && c.hops === hops && (status === null || c.r.status === status) && finalPath.test(c.path) && /^www\.sporta\.com\.kw(:443)?$/i.test(c.host ?? '')
    check(!!ok, `redirect chain ${proto ?? 'no-proto'}://${host ?? '(no Host)'}${short(path, 50)} (${label})`,
      `${c.hops} hop(s) to ${c.proto}://${c.host}${short(c.path, 60)} = ${c.r?.status}; want ${hops} hop(s) to ${finalPath}`, known ?? '')
  }
  // 410 for the old catalogue image cache; 301 status codes are permanent, panel.php is a 302.
  await run('old image cache is Gone', '/image/cache/catalog/x.jpg', { s: 410 })
  await run('old image cache is Gone, other case', '/image/CATALOG/x.jpg', { s: 410 })
  await run('legacy alias is a permanent redirect', '/women', { s: 301 })
  await run('panel.php is a temporary redirect', '/panel.php', { s: 302, loc: 'https://www.sporta.com.kw/backends?via=panel-20261026' })
  // No open redirect, no header injection, whatever the path looks like.
  for (const p of ['//evil.example', '//evil.example/x', '/\\evil.example', '/%2f%2fevil.example', '/%5cevil.example', '/https://evil.example', '/%0d%0aX-Inject:1', '/%0aX-Inject:1', '/x%0d%0aSet-Cookie:a=b', '/@evil.example', '/.evil.example']) {
    const r = await req(p, { host: 'sporta.com.kw', proto: 'http' })
    const l = h1(r, 'location')
    check(!l || new URL(l, 'https://x').host === W, `no open redirect via ${short(p, 40)} (bare domain, http)`, `${r.status} ${short(l || '(none)', 70)}`)
    check(hv(r, 'x-inject').length === 0 && !hv(r, 'set-cookie').some((c) => /a=b/.test(c)), `no header injection via ${short(p, 40)}`)
  }
  const abs = await req('http://evil.example/shop', { host: W })
  check(abs.status === 301 && h1(abs, 'location') === 'https://www.sporta.com.kw/shop', 'absolute-URI request line with a foreign host is canonicalised', `${abs.status} ${h1(abs, 'location')}`)

  // ------------------------------------------------------------ 3 deny rules
  section('3 Deny rules: secrets, dotfiles, backups, sources, include files, config files (none may be served as its bytes)')
  const denied = (r) => (r.status === 403 || r.status === 404 || r.status === 400) && !/SECRET/.test(r.text)
  for (const p of DENY_ROOT) { const r = await req(p); check(denied(r), `GET ${p} is not served`, `${r.status}`) }
  for (const p of DENY_SUB) { const r = await req(p); check(denied(r), `GET ${p} is not served`, `${r.status}`) }
  for (const p of DENY_GAP) { const r = await req(p); check(denied(r), `GET ${p} is not served (extension class not on the deny list)`, `${r.status} ${r.status === 200 ? short(h1(r, 'content-type')) : ''}`, 'htaccess-4') }
  for (const p of DENY_CONFIG_ANYWHERE) { const r = await req(p); check(r.status === 403 || r.status === 404, `GET ${p} is denied by name even if PHP is off`, `${r.status}`, 'htaccess-4') }
  for (const p of DENY_INCLUDES) { const r = await req(p); check(r.status === 403 || r.status === 404, `GET ${p} (an include, not an endpoint) is denied`, `${r.status}`, 'htaccess-13') }
  for (const p of EVADE) { const r = await req(p); check(!(r.status === 200 && /SECRET|PHP-EXECUTED/.test(r.text)), `evasion ${short(p, 70)} does not reach the file`, `${r.status}`) }
  // Things that must keep working next to the denials.
  await run('ACME challenge must stay reachable (SSL renewal)', '/.well-known/acme-challenge/tok123', { s: 200, body: /SECRET/ })
  await run('security.txt lives in .well-known', '/.well-known/security.txt', { s: 200 })
  const wk = await req('/.well-known-evil/x')
  check(wk.status === 403 || wk.status === 404, 'a directory merely STARTING with ".well-known" is not exempt from the dotfile deny', `${wk.status}`, 'htaccess-8')
  for (const p of ['/sub/.git/config', '/sub/.hidden/inner.txt']) {
    const r = await req(p)
    check(r.status === 403 || r.status === 404, `${p}: a dot-DIRECTORY inside a folder that has its own RewriteEngine (the rewrite deny is not inherited)`, `${r.status}`, 'htaccess-8')
  }
  // Directory listings off, everywhere.
  for (const p of ['/emptyish/', '/emptyish', '/assets/', '/images/', '/images/products/', '/images/products/responsive/', '/hero/', '/hero/desktop/', '/cats/', '/fonts/', '/api/', '/api', '/knet/', '/knet', '/pay/', '/pay', '/sub/', '/private-dir/', '/private-dir']) {
    const r = await req(p)
    check((r.status === 403 || r.status === 404) && !/Index of/i.test(r.text), `directory ${p} is not listed`, `${r.status}`)
  }
  // The old site's index.php: never executed, in any spelling.
  await run('old front controller is redirected', '/index.php', { s: 301, loc: 'https://www.sporta.com.kw/' })
  await run('old front controller with PATH_INFO is not executed', '/index.php/foo', { s: [301, 404], nobody: /OLD-SITE/, known: 'htaccess-2' })
  await run('old front controller with PATH_INFO /', '/index.php/', { s: [301, 404], nobody: /OLD-SITE/, known: 'htaccess-2' })
  await run('a nested index.php is left alone on purpose', '/knet/index.php', { s: 200, body: /NESTED-INDEX/ })
  // PHP in the media mounts.
  section('3b Uploaded polyglots and double extensions (each denied, or served inert and never executed)')
  for (const [p, want] of MEDIA) {
    const r = await req(p)
    const executed = /^PHP-EXECUTED-42/.test(r.text)
    const sniffSafe = r.status !== 200 || hv(r, 'x-content-type-options').includes('nosniff')
    const pass = want === 'denied' ? [400, 403, 404].includes(r.status) && !executed : !executed && sniffSafe
    check(pass, `${p} ${want === 'denied' ? 'is denied' : 'is served inert'}`, `${r.status} ${short(h1(r, 'content-type') || 'no type', 30)} executed=${executed}`)
  }
  for (const p of MEDIA_OWNER) {
    const r = await req(p)
    check(!/PHP-EXECUTED-42/.test(r.text), `${p}: a .php in an owner-placed media folder is not executed`, `${r.status} ${short(r.text.replace(/\s+/g, ' '), 30)}`, 'htaccess-9')
  }
  for (const p of ['/images/products/x.svg', '/images/products/x.html', '/images/products/poly.jpg']) {
    const r = await req(p)
    check(hv(r, 'x-content-type-options').includes('nosniff') && hv(r, 'content-security-policy').length === 1, `${p} is served with nosniff and the page CSP (a stored-script file stays inert in script-src)`, `${r.status} ${h1(r, 'content-type')}`)
  }
  // Every legitimate file stays reachable: the deny lists must not eat a shipped file.
  section('3c Nothing legitimate is denied: every file in public/ and every dropin entry point')
  const pub = []
  ;(function walk(d, rel = '') {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      e.isDirectory() ? walk(join(d, e.name), `${rel}/${e.name}`) : pub.push(`${rel}/${e.name}`)
    }
  })(join(web, 'public'))
  for (const f of pub) {
    if (f === '/index.html') continue
    const r = await req(f.split('/').map(encodeURIComponent).join('/'))
    check(r.status === 200, `public${f} is served`, `${r.status}`)
  }
  for (const p of ENTRYPOINTS) { const r = await req(p); check(r.status !== 403 && r.status !== 404, `${p} is reachable (an endpoint)`, `${r.status}`) }

  // ------------------------------------------------------------ 4 headers
  section('4 Headers per area: security set, exactly once, value per area')
  const SEC = {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-permitted-cross-domain-policies': 'none',
    'content-security-policy': /^default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; /,
    'permissions-policy': /camera=\(\)/,
  }
  const areas = [
    ['storefront /', '/', 'strict-origin-when-cross-origin', 'htaccess-14'],
    ['storefront /shop', '/shop', 'strict-origin-when-cross-origin', 'htaccess-14'],
    ['storefront /product/x', '/product/x', 'strict-origin-when-cross-origin', 'htaccess-14'],
    ['admin /backends', '/backends', 'strict-origin-when-cross-origin', 'htaccess-14'],
    ['static robots.txt', '/robots.txt', 'strict-origin-when-cross-origin'],
    ['static hashed js', '/assets/index-CuCZhORW.js', 'strict-origin-when-cross-origin'],
    ['static font', '/fonts/alexandria-var-latin.woff2', 'strict-origin-when-cross-origin'],
    ['static image', '/logo.png', 'strict-origin-when-cross-origin'],
    ['media mount', '/images/products/real.jpg', 'strict-origin-when-cross-origin'],
    ['SPA 404 shell', '/nope', 'strict-origin-when-cross-origin'],
    ['/api json', '/api/zz-ok.php', 'no-referrer'],
    ['/knet', '/knet/zz-ok.php', 'strict-origin-when-cross-origin'],
    ['/pay', '/pay/zz-ok.php', 'strict-origin-when-cross-origin'],
  ]
  for (const [name, p, rp, known] of areas) {
    const r = await req(p)
    const bad = judge(r, { h: SEC, once: [...SEC_ONCE.filter((k) => k !== 'cache-control' && k !== 'content-type')] })
    check(bad.length === 0, `${name}: security headers present, each exactly once`, bad.join('; ') || `${r.status}`)
    const rb = judge(r, { h: { 'referrer-policy': rp }, once: ['referrer-policy'] })
    check(rb.length === 0, `${name}: Referrer-Policy is ${rp}`, rb.join('; ') || h1(r, 'referrer-policy'), known ?? '')
  }
  const home = await req('/')
  const pp = h1(home, 'permissions-policy')
  const open = [...pp.matchAll(/([a-z-]+)=\(([^)]*)\)/g)].filter((m) => m[2].trim()).map((m) => `${m[1]}=(${m[2]})`)
  check(/geolocation=\(self\)/.test(pp), 'Permissions-Policy: geolocation=(self) (checkout asks for the delivery pin)', pp.match(/geolocation=\([^)]*\)/)?.[0])
  check(/microphone=\(self\)/.test(pp), 'Permissions-Policy: microphone=(self): the Sporta AI mic button (SpeechRecognition) needs it', pp.match(/microphone=\([^)]*\)/)?.[0], 'htaccess-3')
  for (const f of ['camera', 'payment', 'usb', 'midi', 'display-capture', 'accelerometer', 'gyroscope', 'magnetometer', 'xr-spatial-tracking', 'encrypted-media', 'autoplay']) {
    check(new RegExp(`${f}=\\(\\)`).test(pp), `Permissions-Policy: ${f}=() stays closed (nothing in src/ uses it)`)
  }
  check(open.join(' ') === 'geolocation=(self)' || open.sort().join(' ') === 'geolocation=(self) microphone=(self)', 'Permissions-Policy opens only what the storefront uses', open.join(' '))
  // CSP, storefront.
  const csp = h1(home, 'content-security-policy')
  const cd = parseCsp(csp)
  const sc = cd.get('script-src') ?? []
  check(!sc.includes("'unsafe-inline'") && !sc.includes("'unsafe-eval'") && !sc.some((t) => /^(https?:|\*|data:)/.test(t)), "CSP script-src: no 'unsafe-inline', no 'unsafe-eval', no host or scheme source", sc.join(' ').slice(0, 80) + '...')
  check(hashes.every((h) => sc.includes(h)) && hashes.length > 0, `CSP script-src carries the sha256 of every inline script of index.html (${hashes.length})`)
  check(!/__SCRIPT_HASHES__/.test(csp), 'CSP has no unreplaced placeholder')
  check(['default-src', 'base-uri', 'object-src', 'frame-ancestors', 'form-action', 'connect-src', 'upgrade-insecure-requests'].every((d) => cd.has(d)), 'CSP names default-src, base-uri, object-src, frame-ancestors, form-action, connect-src, upgrade-insecure-requests')
  check(cd.get('object-src')?.join() === "'none'" && cd.get('frame-ancestors')?.join() === "'self'" && cd.get('base-uri')?.join() === "'self'", "CSP object-src 'none', frame-ancestors 'self', base-uri 'self'")
  check((cd.get('connect-src') ?? []).join() === "'self'", "CSP connect-src is 'self' only (the whole backend is /api)")
  for (const [name, p] of [['/api', '/api/zz-ok.php'], ['/knet', '/knet/zz-ok.php'], ['/pay', '/pay/zz-ok.php'], ['/backends', '/backends'], ['404 shell', '/nope']]) {
    const r = await req(p)
    check(h1(r, 'content-security-policy') === csp, `CSP on ${name} is the same policy as the storefront's`, '')
  }
  // The T-Pay / KNET-via-CBK hand-off page.
  section('4b /pay/pay.php: the page the customer is sent to is an auto-submitting form to the CBK gateway')
  const payPhp = read('dropin/php-cbk/pay.php')
  const handler = /<body[^>]*\sonload="([^"]+)"/.exec(payPhp)?.[1] ?? ''
  const cbkCfg = read('dropin/php-cbk/config.example.php')
  const cbkHosts = [...cbkCfg.matchAll(/'(?:test_base|production_base)'\s*=>\s*'(https:\/\/[^']+)'/g)].map((m) => m[1])
  const payRes = await req('/pay/pay.php')
  const payCsp = h1(payRes, 'content-security-policy')
  check(!!handler && cbkHosts.length === 2, 'found the inline onload handler in pay.php and the two CBK gateway origins in config.example.php', `onload="${handler}" ${cbkHosts.join(' ')}`)
  check(payCsp.length > 0, '/pay/pay.php answers with a Content-Security-Policy', `${payRes.status}`)
  console.log(`   CSP the browser gets on /pay/pay.php: ${payCsp}`)
  check(inlineHandlerAllowed(payCsp, handler), `CSP on /pay/pay.php lets the inline onload="${handler}" run (needs 'unsafe-hashes' + its sha256, or 'unsafe-inline')`, `script-src ${(parseCsp(payCsp).get('script-src') ?? []).join(' ').slice(0, 80)}...`, 'htaccess-1')
  for (const o of cbkHosts) check(formActionAllows(payCsp, o), `CSP form-action on /pay/pay.php allows the CBK gateway ${o}`, `form-action ${(parseCsp(payCsp).get('form-action') ?? ['(none)']).join(' ')}`, 'htaccess-1')
  check(!/onload=|<form/.test(read('dropin/php-knet/pay.php')), '/knet/pay.php hands over by a 302 (no inline handler or form, so the page CSP is not in its way)')

  // ------------------------------------------------------------ 4c error pages and duplicates
  section('4c Error and redirect responses: headers present, none duplicated')
  for (const [name, p, o] of [['403 (denied file)', '/api/store.php', {}], ['403 (dotfile)', '/.env', {}], ['301 (host)', '/shop', { host: 'sporta.com.kw' }], ['301 (http)', '/shop', { proto: 'http' }], ['410', '/image/cache/x.jpg', {}]]) {
    const r = await req(p, o)
    const bad = judge(r, { h: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' } })
    check(bad.length === 0, `${name}: carries nosniff and X-Frame-Options (Apache-made pages only get headers set with 'always')`, bad.join('; ') || `${r.status}`, 'htaccess-6')
    check(hv(r, 'strict-transport-security').length === 1, `${name}: HSTS exactly once`, `${r.status}`)
  }
  for (const [name, p, o, known] of [['/knet 301', '/knet/pay.php', { proto: 'http' }, 'htaccess-16'], ['/pay 301', '/pay/pay.php', { proto: 'http' }, 'htaccess-16'], ['/knet 403', '/knet/config.php', {}], ['/api 403', '/api/config.php', {}]]) {
    const r = await req(p, o)
    check(hv(r, 'cache-control').length <= 1, `${name}: at most one Cache-Control`, hv(r, 'cache-control').join(' / '), known ?? '')
  }
  for (const [name, p] of [['/', '/'], ['/api/zz-ok.php', '/api/zz-ok.php'], ['/pay/zz-ok.php', '/pay/zz-ok.php'], ['/robots.txt', '/robots.txt'], ['/nope', '/nope']]) {
    const r = await req(p)
    const dup = [...new Set(r.headers.map(([k]) => k))].filter((k) => !['set-cookie', 'vary', 'link', 'warning'].includes(k) && hv(r, k).length > 1)
    check(dup.length === 0, `${name}: no response header is sent twice`, dup.join(','))
  }
  const xp = await req('/api/zz-ok.php')
  check(hv(xp, 'x-powered-by').length === 0, 'no X-Powered-By on PHP responses (PHP exposes it; "Header always unset" cannot remove it)', hv(xp, 'x-powered-by').join(), 'htaccess-5')
  for (const p of ['/pay/zz-ok.php', '/knet/zz-ok.php']) {
    const r = await req(p)
    check(hv(r, 'x-powered-by').length === 0, `no X-Powered-By on ${p}`, hv(r, 'x-powered-by').join(), 'htaccess-5')
  }
  for (const [p, h] of [['/knet/zz-ok.php', {}], ['/pay/zz-ok.php', {}], ['/pay/pay.php', {}], ['/knet/pay.php', {}]]) {
    const r = await req(p, h)
    check(/noindex/.test(h1(r, 'x-robots-tag')) && /no-store/.test(h1(r, 'cache-control')), `${p}: payment endpoint is noindex and no-store`, `${h1(r, 'x-robots-tag')} | ${h1(r, 'cache-control')}`)
  }

  // ------------------------------------------------------------ 5 caching
  section('5 Cache-Control tiers, ETag, conditional requests')
  const tiers = [
    ['/assets/index-CuCZhORW.js', /^public, max-age=31536000, immutable$/, 'hashed Vite JS: immutable for a year'],
    ['/assets/About-sNx2ecy0.css', /^public, max-age=31536000, immutable$/, 'hashed Vite CSS: immutable for a year'],
    ['/fonts/alexandria-var-latin.woff2', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'fonts: 30 days + 7 days stale'],
    ['/logo.png', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'fixed-name image: 30 days + 7 days stale'],
    ['/logo-white.webp', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'fixed-name webp: 30 days'],
    ['/favicon.png', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'favicon: 30 days'],
    ['/backends-icon.svg', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'svg: 30 days'],
    ['/images/products/real.jpg', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'product photo: 30 days'],
    ['/images/products/responsive/p-320.webp', /^public, max-age=2592000, stale-while-revalidate=604800$/, 'product variant: 30 days'],
    ['/hero/desktop/probe.webp', /^public, max-age=86400, stale-while-revalidate=2592000$/, 'hero art the owner replaces: a day'],
    ['/cats/mobile/probe.jpg', /^public, max-age=86400, stale-while-revalidate=2592000$/, 'category art the owner replaces: a day'],
    ['/robots.txt', /^public, max-age=3600, stale-while-revalidate=86400$/, 'robots: an hour'],
    ['/llms.txt', /^public, max-age=3600, stale-while-revalidate=86400$/, 'llms.txt: an hour'],
    ['/sitemap.xml', /^public, max-age=3600, stale-while-revalidate=86400$/, 'sitemap index (api script): an hour'],
    ['/sitemap-products.xml', /^public, max-age=3600, stale-while-revalidate=86400$/, 'product sitemap (api script): an hour'],
    ['/sitemap-pages.xml', /^public, max-age=3600, stale-while-revalidate=86400$/, 'pages sitemap (static): an hour'],
    ['/site.webmanifest', /^public, max-age=3600, stale-while-revalidate=86400$/, 'manifest: an hour'],
    ['/backends.webmanifest', /^public, max-age=3600, stale-while-revalidate=86400$/, 'admin manifest: an hour'],
    ['/sw.js', /^no-cache, must-revalidate$/, 'service worker: always revalidate'],
    ['/config.js', /^no-cache, must-revalidate$/, 'config.js: edited in place'],
    ['/boot.js', /^no-cache, must-revalidate$/, 'boot.js: fixed name'],
    ['/backends-offline.html', /^no-cache, stale-while-revalidate=60$/, 'html: revalidate'],
    ['/', /^no-cache, stale-while-revalidate=60$/, 'home'],
    ['/shop', /^no-cache, stale-while-revalidate=60$/, 'a route'],
    ['/nope', /^no-cache, stale-while-revalidate=60$/, 'the 404 shell'],
    ['/api/zz-ok.php', /^no-store$/, '/api answers are per-request state'],
    ['/knet/zz-ok.php', /^no-store, no-cache, must-revalidate, private$/, '/knet'],
    ['/pay/zz-ok.php', /^no-store, no-cache, must-revalidate, private$/, '/pay'],
  ]
  for (const [p, re, why] of tiers) {
    const r = await req(p)
    const cc = hv(r, 'cache-control')
    check(cc.length === 1 && re.test(cc[0]), `${p}: ${why}`, `${r.status} ${cc.join(' / ') || 'NO Cache-Control'}`)
  }
  // A fixed-name add-on must never be immutable. Every shipped fixed-name js/css in public/ is checked,
  // plus a hypothetical new one, which is the case the broad hashed-file regex gets wrong.
  for (const f of pub.filter((x) => /^\/[^/]+\.(js|css)$/.test(x))) {
    const r = await req(f)
    check(!/immutable/.test(h1(r, 'cache-control')) && /no-cache/.test(h1(r, 'cache-control')), `${f}: a fixed-name file revalidates (never immutable)`, h1(r, 'cache-control') || 'NO Cache-Control')
  }
  writeFileSync(join(www, 'sporta-new-feature.css'), 'a{b:c}\n')
  writeFileSync(join(www, 'sporta-new-feature.js'), '//x\n')
  writeFileSync(join(www, 'hero-banner-large.js'), '//x\n')
  for (const f of ['/sporta-new-feature.css', '/sporta-new-feature.js', '/hero-banner-large.js']) {
    const r = await req(f)
    check(!/immutable/.test(h1(r, 'cache-control')), `${f}: a NEW fixed-name add-on that nobody listed is not served immutable for a year`, h1(r, 'cache-control') || 'NO Cache-Control', 'htaccess-7')
  }
  // ETag without inode; conditional requests.
  for (const p of ['/robots.txt', '/logo.png', '/assets/index-CuCZhORW.js', '/config.js']) {
    const r = await req(p)
    check(/^(W\/)?"[0-9a-f]+-[0-9a-f]+"$/.test(h1(r, 'etag')), `${p}: ETag is size-mtime only (no inode)`, h1(r, 'etag'))
    const c = await req(p, { headers: [`If-None-Match: ${h1(r, 'etag')}`] })
    check(c.status === 304 && hv(c, 'cache-control').length === 1, `${p}: If-None-Match with the ETag answers 304 and repeats Cache-Control`, `${c.status} ${h1(c, 'cache-control')}`)
    const m = await req(p, { headers: [`If-Modified-Since: ${h1(r, 'last-modified')}`] })
    check(m.status === 304, `${p}: If-Modified-Since answers 304`, `${m.status}`)
  }
  for (const p of ['/robots.txt', '/llms.txt', '/sw.js', '/config.js', '/boot.js', '/site.webmanifest', '/sitemap-pages.xml']) {
    const gz = await req(p, { headers: ['Accept-Encoding: gzip'] })
    const c = await req(p, { headers: ['Accept-Encoding: gzip', `If-None-Match: ${h1(gz, 'etag')}`] })
    check(c.status === 304, `${p}: revalidating with the ETag of the COMPRESSED copy answers 304, not a full 200`, `${gz.status} ${h1(gz, 'content-encoding')} etag ${h1(gz, 'etag')} -> ${c.status}`)
  }
  // The same, for every fixed-name add-on the live index.html links (CLAUDE.md, "Add-ons the live index.html links") and the
  // three scripts around them: all of them carry `no-cache, must-revalidate`, so a returning visitor asks about each of them
  // on EVERY page load. Before the RequestHeader edit each answered a full 200 (51.5 kB gzip in all for the copies live on 2026-11-02, about 145 kB for the repo's on 2026-11-04); now each is an empty 304,
  // with gzip's ETag and with Brotli's, and a validator that is genuinely stale still gets the new file.
  const ADDONS = ['boot.js', 'config.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js', 'sporta-gov-autopick.js', 'sporta-clock.js', 'sporta-checkout-a11y.js',
    'sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css',
    'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
  let full = 0, empty = 0, allBack = true
  for (const f of ADDONS) {
    const p = '/' + f
    const gz = await req(p, { headers: ['Accept-Encoding: gzip'] })
    const c = await req(p, { headers: ['Accept-Encoding: gzip', `If-None-Match: ${h1(gz, 'etag')}`] })
    const br = await req(p, { headers: ['Accept-Encoding: br'] })
    const cb = await req(p, { headers: ['Accept-Encoding: br', `If-None-Match: ${h1(br, 'etag')}`] })
    const stale = await req(p, { headers: ['Accept-Encoding: gzip', 'If-None-Match: "0-0-gzip"'] })
    full += gz.body.length; empty += c.body.length
    const ok = gz.status === 200 && h1(gz, 'content-encoding') === 'gzip' && c.status === 304 && c.body.length === 0 && /no-cache/.test(h1(c, 'cache-control')) &&
      cb.status === 304 && h1(br, 'content-encoding') === 'br' && stale.status === 200 && stale.body.length === gz.body.length
    if (!ok) allBack = false
    check(ok, `${p}: its own gzip ETag and its own Brotli ETag answer an empty 304 that keeps no-cache; a stale validator still gets the file`,
      `gzip 200 ${gz.body.length} B -> ${c.status} ${c.body.length} B; br ${br.status} -> ${cb.status}; stale ${stale.status}/${stale.body.length} B`)
  }
  console.log(`   ${ADDONS.length} add-on files, one page load of a returning visitor: ${full} B (gzip) re-sent as 200 before, ${empty} B body as 304 now${allBack ? '' : ' (NOT all)'}`)

  // ------------------------------------------------------------ 6 compression and types
  section('6 Compression: text types only, Vary: Accept-Encoding, and Content-Type charsets')
  const textTypes = ['/robots.txt', '/llms.txt', '/big.txt', '/site.webmanifest', '/sitemap-pages.xml', '/backends-icon.svg', '/assets/About-sNx2ecy0.css', '/sw.js', '/config.js', '/backends-offline.html', '/api/zz-ok.php']
  for (const p of textTypes) {
    const g = await req(p, { headers: ['Accept-Encoding: gzip'] })
    check(h1(g, 'content-encoding') === 'gzip' && /Accept-Encoding/i.test(hv(g, 'vary').join()), `${p}: gzip for gzip clients, Vary: Accept-Encoding`, `${g.status} ${h1(g, 'content-encoding') || 'none'} vary=${hv(g, 'vary').join()}`)
    const b = await req(p, { headers: ['Accept-Encoding: br, gzip'] })
    check(['br', 'gzip'].includes(h1(b, 'content-encoding')), `${p}: Brotli (or gzip) when offered`, h1(b, 'content-encoding') || 'none')
    const i = await req(p, { headers: ['Accept-Encoding: identity'] })
    check(h1(i, 'content-encoding') === '', `${p}: identity stays identity`, h1(i, 'content-encoding') || 'none')
  }
  for (const p of ['/logo.png', '/fonts/alexandria-var-latin.woff2', '/hero/desktop/probe.webp', '/images/products/real.jpg', '/favicon.png', '/logo-white.webp']) {
    const r = await req(p, { headers: ['Accept-Encoding: gzip, br'] })
    check(h1(r, 'content-encoding') === '', `${p}: images and fonts are never re-compressed`, h1(r, 'content-encoding') || 'none')
  }
  const shell = await req('/nope', { headers: ['Accept-Encoding: gzip'] })
  check(h1(shell, 'content-encoding') === 'gzip', 'the 404 shell (27 kB of HTML) is compressed like any other HTML', `${shell.status} ${h1(shell, 'content-encoding') || 'NOT compressed'} ${shell.body.length} B`)
  // ...for a Brotli client too, never for a client that offers neither, and it is still a 404 with the shell in it.
  const shellBr = await req('/nope', { headers: ['Accept-Encoding: br, gzip'] })
  check(shellBr.status === 404 && h1(shellBr, 'content-encoding') === 'br' && /Accept-Encoding/i.test(hv(shellBr, 'vary').join()), 'the 404 shell is Brotli for a client that offers br, with Vary: Accept-Encoding', `${shellBr.status} ${h1(shellBr, 'content-encoding') || 'none'} ${shellBr.body.length} B vary=${hv(shellBr, 'vary').join()}`)
  const shellId = await req('/nope', { headers: ['Accept-Encoding: identity'] })
  check(shellId.status === 404 && h1(shellId, 'content-encoding') === '' && shellId.body.length > 10000, 'the 404 shell is sent plain to a client that offers no compression', `${shellId.status} ${h1(shellId, 'content-encoding') || 'none'} ${shellId.body.length} B`)
  const missingPhoto = await req('/images/products/responsive/not-there-320.webp', { headers: ['Accept-Encoding: gzip'] })
  check(missingPhoto.status === 404 && h1(missingPhoto, 'content-encoding') === 'gzip' && missingPhoto.body.length < shellId.body.length / 2, 'a product-photo copy that is not there costs the compressed shell, not the 27 kB one', `${missingPhoto.status} ${h1(missingPhoto, 'content-encoding') || 'none'} ${missingPhoto.body.length} B vs ${shellId.body.length} B plain`)
  for (const [p, re, why] of [['/robots.txt', /^text\/plain; charset=utf-8$/i, 'robots.txt'], ['/llms.txt', /^text\/plain; charset=utf-8$/i, 'llms.txt (holds Arabic text; an unlabelled text/plain is decoded by guesswork in Firefox)'],
    ['/big.txt', /^text\/plain; charset=utf-8$/i, 'any .txt']]) {
    const r = await req(p)
    check(re.test(h1(r, 'content-type')), `${p}: Content-Type names the charset (${why})`, h1(r, 'content-type'), 'htaccess-10')
  }
  for (const [p, re] of [['/sitemap-pages.xml', /^application\/xml/], ['/sitemap.xml', /^application\/xml/], ['/site.webmanifest', /^application\/manifest\+json$/], ['/backends.webmanifest', /^application\/manifest\+json$/],
    ['/backends-icon.svg', /^image\/svg\+xml/], ['/sw.js', /^text\/javascript/], ['/config.js', /^text\/javascript/], ['/assets/About-sNx2ecy0.css', /^text\/css/], ['/fonts/alexandria-var-latin.woff2', /^font\/woff2$/],
    ['/logo-white.webp', /^image\/webp$/], ['/api/zz-ok.php', /^application\/json/], ['/', /^text\/html; charset=utf-8$/i]]) {
    const r = await req(p)
    check(re.test(h1(r, 'content-type')), `${p}: Content-Type ${re}`, h1(r, 'content-type'))
  }

  // ------------------------------------------------------------ 7 cookies, CORS, methods, loops
  section('7 Cookies, CORS, methods, rewrite-loop safety')
  const ck = await req('/api/zz-cookie.php')
  const cks = hv(ck, 'set-cookie')
  check(cks.length === 2 && cks.every((c) => /;\s*secure/i.test(c)) && cks.every((c) => /samesite=/i.test(c)), '/api: every Set-Cookie gets Secure and SameSite, an existing Strict is kept', cks.join(' || '))
  check(cks.some((c) => /^sec=2/.test(c) && /samesite=strict/i.test(c) && (c.match(/secure/gi) ?? []).length === 1), '/api: a cookie that already has Secure does not get a second one')
  const ckp = hv(await req('/pay/zz-cookie.php'), 'set-cookie')
  check(ckp.length === 1 && /secure/i.test(ckp[0]) && /httponly/i.test(ckp[0]) && /samesite=lax/i.test(ckp[0]), '/pay: Secure, HttpOnly and SameSite=Lax are forced', ckp.join(' || '))
  const ckk = hv(await req('/knet/zz-cookie.php'), 'set-cookie')
  check(ckk.length === 1 && /secure/i.test(ckk[0]) && /httponly/i.test(ckk[0]) && /samesite=lax/i.test(ckk[0]), '/knet: Secure, HttpOnly and SameSite=Lax are forced', ckk.join(' || '))
  for (const p of ['/api/zz-ok.php', '/robots.txt', '/', '/fonts/alexandria-var-latin.woff2', '/shop']) {
    const r = await req(p, { headers: ['Origin: https://evil.example'] })
    check(hv(r, 'access-control-allow-origin').length === 0, `${p}: no CORS grant to a foreign Origin`, h1(r, 'access-control-allow-origin'))
  }
  const pre = await req('/api/zz-ok.php', { method: 'OPTIONS', headers: ['Origin: https://evil.example', 'Access-Control-Request-Method: POST'] })
  check(hv(pre, 'access-control-allow-origin').length === 0 && hv(pre, 'access-control-allow-methods').length === 0, 'preflight from a foreign Origin gets no CORS headers', `${pre.status}`)
  for (const m of ['TRACE', 'PUT', 'DELETE', 'PATCH', 'CONNECT']) {
    const r = await req('/robots.txt', { method: m })
    check([400, 403, 405, 501].includes(r.status), `${m} on a static file is refused`, `${r.status}`)
  }
  const tr = await req('/shop', { method: 'TRACE' })
  check([403, 405].includes(tr.status) && !/Host: /.test(tr.text), 'TRACE is refused and echoes no request', `${tr.status}`)
  const opt = await req('/robots.txt', { method: 'OPTIONS' })
  check(opt.status === 200 && /GET/.test(h1(opt, 'allow')) && !/PUT|DELETE|TRACE/.test(h1(opt, 'allow')), 'OPTIONS on a static file lists GET/HEAD/POST/OPTIONS only', h1(opt, 'allow'))
  check((await req('/*', { method: 'OPTIONS' })).status < 500, 'OPTIONS /* does not 500')
  for (const p of ['/', '/shop', '/nope', '/robots.txt', '/backends', '/product/x']) {
    const g = await req(p), h = await req(p, { method: 'HEAD' })
    check(g.status === h.status && h.body.length === 0 && h1(g, 'content-type') === h1(h, 'content-type') && h1(g, 'cache-control') === h1(h, 'cache-control'), `HEAD ${p} mirrors GET (status, type, cache)`, `${g.status}/${h.status}`)
  }
  for (const p of ['/index.html', '/./', '//', '/?x', '/%2e%2e/', '/shop/../shop', '/./shop', '//shop', '/shop//', '/shop/./', '/robots.txt/', '/robots.txt/x', '/backends/..', '/api/../shop', '/images/../shop']) {
    const t0 = Date.now()
    const r = await req(p)
    check(r.status > 0 && r.status < 500 && Date.now() - t0 < 3000, `no loop or 5xx on ${p}`, `${r.status} in ${Date.now() - t0} ms`)
  }
  check((await chain(W, 'https', '/index.html')).hops === 1, '/index.html -> / ends in one hop with no loop')
  check((await chain(W, 'https', '/index.html?x=1')).path === '/?x=1', '/index.html?x=1 keeps its query')
  for (const p of ['/backends', '/backends?x=1']) {
    const c = await chain(W, 'https', p)
    check(c.hops === 0 && c.r.status === 200, `${p} answers directly (no redirect to /backends/ and back)`, `${c.hops} hops`)
  }
  const bsl = await req('/backends/')
  check(bsl.status === 404 && hv(bsl, 'location').length === 0, '/backends/ is a plain 404 (never a redirect: an old cached /backends <-> /backends/ pair is why)', `${bsl.status}`)

  // ------------------------------------------------------------ 8 sitemap and robots (the URLs the owner asked about)
  section('8 /sitemap.xml, /sitemap-products.xml, /robots.txt: routing and types')
  await run('sitemap index is the api script', '/sitemap.xml', { s: 200, body: /sitemapindex/, h: { 'content-type': /^application\/xml/ } })
  await run('product sitemap is the api script', '/sitemap-products.xml', { s: 200, body: /urlset/ })
  await run('static pages sitemap', '/sitemap-pages.xml', { s: 200, body: /<urlset/ })
  await run('robots.txt', '/robots.txt', { s: 200, body: /Disallow: \/backends/ })
  await run('sitemap on the bare domain', '/sitemap.xml', { s: 301, loc: 'https://www.sporta.com.kw/sitemap.xml' }, { host: 'sporta.com.kw' })
  await run('sitemap over http', '/sitemap.xml', { s: 301, loc: 'https://www.sporta.com.kw/sitemap.xml' }, { proto: 'http' })
  await run('sitemap index with a query', '/sitemap.xml?x=1', { s: 200, body: /sitemapindex/ })
  await run('sitemap path is case-sensitive', '/Sitemap.xml', { s: 404 })
  await run('no sitemap.xml.gz (the .gz class is denied)', '/sitemap.xml.gz', { s: [403, 404] })

  // ------------------------------------------------------------ 9 static fallback (no seo-page.php)
  section('9 Static layout: the same routes when api/seo-page.php and the sitemap scripts are absent (DB-down / first upload)')
  for (const f of ['seo-page', 'sitemap-index', 'sitemap-products']) rmSync(join(www, 'api', `${f}.php`), { force: true })
  const shellRoute = { s: 200, body: /id="root"/, nobody: /SEO-PAGE-STUB/, h: { 'cache-control': /^no-cache, stale-while-revalidate=60$/, 'content-type': /^text\/html/ } }
  await run('home', '/', shellRoute)
  for (const p of [...SPA_FIXED, ...SPA_BACKLOG, ...SPA_PARAM, ...SPA_ADMIN]) await run('static shell', p, shellRoute)
  for (const p of ['/shop/', '/cart/', '/product/x/', '/invoice/ABC123/']) await run('static shell, trailing slash', p, shellRoute)
  for (const p of ['/nope', '/Shop', '/shop/x', '/backends/', '/product/']) await run('static shell, real 404', p, { s: 404, body: /id="root"/ })
  const sg = await req('/shop', { headers: ['Accept-Encoding: gzip'] })
  check(h1(sg, 'content-encoding') === 'gzip', 'static /shop is gzip-compressed', h1(sg, 'content-encoding') || 'none')
  await run('static sitemap index', '/sitemap.xml', { s: 200, body: /<(sitemapindex|urlset)/, h: { 'content-type': /xml/ } })
  await run('static product sitemap', '/sitemap-products.xml', { s: 200, body: /<urlset/ })
  for (const p of ['/backends', '/backends/orders']) {
    const r = await req(p)
    check(/noindex/.test(h1(r, 'x-robots-tag')), `${p} (static shell) says noindex in a header, not only in robots.txt`, h1(r, 'x-robots-tag') || 'no X-Robots-Tag', 'htaccess-12')
  }
}

// ---------------------------------------------------------------- main
async function main() {
  if (!APACHE) {
    console.log('apache2/httpd is not installed - skipping (this suite needs a real Apache 2.4 to be meaningful)')
    process.exit(0)
  }
  const ctx = await startAll({ patchFile: PATCH })
  console.log(`${execFileSync(APACHE, ['-v'], { encoding: 'utf8' }).split('\n')[0]}   port ${PORT}/${PHP_PORT}   inline-script hashes: ${ctx.hashes.length}${PATCH ? `   patch: ${PATCH}` : ''}`)
  try {
    await runChecks(ctx)
  } finally {
    if (!KEEP) { stopAll(); rmSync(BASE, { recursive: true, force: true }) }
  }
  console.log(`\n${nCases} checks: ${oks} ok, ${xfails} expected-fail (known defects), ${xpass} unexpected-pass, ${fails} FAIL`)
  if (xpass) console.log(`XPASS means a known defect is fixed: delete its marker in this file.\n  ${xpassList.join('\n  ')}`)
  process.exit(fails || xpass ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => { stopAll(); process.exit(130) })
  main().catch((e) => { console.error(e); stopAll(); process.exit(1) })
}
export { raw, req, hv, h1, startAll, stopAll, httpdConf, buildTree, BASE, PORT, HOST, APACHE, web, PATCH, KEEP, DUMP }
