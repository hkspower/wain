// Asserts the SERVER-SIDE storage arrangement: what is reachable over HTTP from
// public_html, and what must never be. Stands up Apache itself with the real
// public/.htaccess, so the rules are executed rather than read.
//
//   node scripts/storage-audit.mjs [dist-dir]
//
// file-audit.mjs answers "is the package correct?" and scan-server-response.sh
// answers "what does the live site return?". This is the third question, and the
// only one that can be answered before a deploy: given this .htaccess and this
// tree, is anything reachable that should not be?
//
// The case it exists for could not be reasoned out. The dotfile deny at the top
// of public/.htaccess is a rewrite rule, and mod_rewrite directives are NOT
// inherited into a subdirectory that enables its own rewrite engine. Measured:
// with a /sub/.htaccess containing nothing but "RewriteEngine On",
// /sub/.token.json was served 200 WITH ITS CONTENTS while /.rootsecret.json in
// the same tree was 403. /knet and /pay were safe only because each repeats the
// rule; any folder added later would not have been. A <FilesMatch> IS inherited,
// which is the fix — and this script is what stops it regressing.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const web = resolve(new URL('..', import.meta.url).pathname)
const DIST = process.argv[2] ?? join(web, 'dist')
const ROOT = '/tmp/storage-audit'
const PORT = 8794
const HOST = 'www.sporta.com.kw'

if (!existsSync(DIST)) {
  console.error(`no such directory: ${DIST} — run npm run release first`)
  process.exit(2)
}
const apache = spawnSync('sh', ['-c', 'command -v apache2 || command -v httpd'], { encoding: 'utf8' })
const APACHE = apache.stdout.trim().split('\n')[0]
if (!APACHE) {
  console.log('apache2 is not installed — skipping (this audit needs a real server to be meaningful)')
  process.exit(0)
}
const MODULES = '/usr/lib/apache2/modules'

let fails = 0
const ok = (pass, what, detail = '') => {
  if (!pass) fails++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`)
}

// ---------------------------------------------------------------- the harness
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(`${ROOT}/www`, { recursive: true })
cpSync(DIST, `${ROOT}/www`, { recursive: true })

// The real .htaccess, minus the one rule that cannot work without TLS. Nothing
// else is altered: a stripped-down copy would make this audit test itself.
const htaccess = readFileSync(join(web, 'public', '.htaccess'), 'utf8').replace(
  `  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !=https
  RewriteCond %{HTTP:X-Forwarded-SSL} !=on
  RewriteCond %{SERVER_PORT} !=443
  RewriteRule ^ https://www.sporta.com.kw%{REQUEST_URI} [R=301,L]\n`,
  '',
)
writeFileSync(`${ROOT}/www/.htaccess`, htaccess)

// Bait. Every one of these is a file that has actually turned up in a web root
// somewhere on this project, or is the shape of one that would.
const BAIT = {
  '.rootsecret.json': 'root dotfile',
  '.DS_Store': 'macOS leftover',
  '.env': 'credentials',
  'feed.json': 'stray json',
  'notes.md': 'documentation',
  'dump.sql': 'database dump',
  'backup.zip': 'site archive',
  'deploy.sh': 'deploy script',
  'smoke.mjs': 'test script',
  'knet.log': 'payment log',
  'sporta-deploy.php': 'a deploy endpoint',
}
for (const name of Object.keys(BAIT)) writeFileSync(`${ROOT}/www/${name}`, 'SECRET\n')

// A subdirectory that turns on its own rewrite engine — the trap.
mkdirSync(`${ROOT}/www/sub`, { recursive: true })
writeFileSync(`${ROOT}/www/sub/.htaccess`, '<IfModule mod_rewrite.c>\n  RewriteEngine On\n  RewriteRule ^nothing$ - [L]\n</IfModule>\n')
for (const name of ['.token.json', '.env', 'x.log', 'package.json'])
  writeFileSync(`${ROOT}/www/sub/${name}`, 'SECRET\n')

// A folder with no index file, to prove directory listing is off.
mkdirSync(`${ROOT}/www/emptyish`, { recursive: true })
writeFileSync(`${ROOT}/www/emptyish/thing.txt`, 'x\n')

// ACME must keep working — SSL renewal depends on it.
mkdirSync(`${ROOT}/www/.well-known/acme-challenge`, { recursive: true })
writeFileSync(`${ROOT}/www/.well-known/acme-challenge/abc123`, 'token\n')

// The CBK token cache, in the place the old default put it.
writeFileSync(`${ROOT}/www/pay/.cbk_token.json`, '{"token":"BEARER"}\n')

// The native backend's config, staged the way the owner is told to create it:
// by hand, on the server, in a folder that ships. It holds the MySQL password,
// so /api is exactly the kind of newly-added directory the comment at the top
// of this file warns about — the one the root rewrite rule does not reach.
if (existsSync(`${ROOT}/www/api`)) {
  writeFileSync(`${ROOT}/www/api/config.php`, "<?php return ['db_pass' => 'SECRET'];\n")
}

writeFileSync(
  `${ROOT}/httpd.conf`,
  `ServerName localhost
Listen ${PORT}
PidFile ${ROOT}/pid
ErrorLog ${ROOT}/error.log
LoadModule mpm_event_module ${MODULES}/mod_mpm_event.so
LoadModule authz_core_module ${MODULES}/mod_authz_core.so
LoadModule mime_module ${MODULES}/mod_mime.so
LoadModule dir_module ${MODULES}/mod_dir.so
LoadModule headers_module ${MODULES}/mod_headers.so
LoadModule rewrite_module ${MODULES}/mod_rewrite.so
LoadModule deflate_module ${MODULES}/mod_deflate.so
LoadModule filter_module ${MODULES}/mod_filter.so
LoadModule setenvif_module ${MODULES}/mod_setenvif.so
LoadModule alias_module ${MODULES}/mod_alias.so
LoadModule expires_module ${MODULES}/mod_expires.so
LoadModule autoindex_module ${MODULES}/mod_autoindex.so
TypesConfig /etc/mime.types
User www-data
Group www-data
DocumentRoot ${ROOT}/www
<Directory ${ROOT}/www>
  AllowOverride All
  Require all granted
</Directory>
`,
)

const stop = () => { try { execFileSync(APACHE, ['-f', `${ROOT}/httpd.conf`, '-k', 'stop'], { stdio: 'ignore' }) } catch {} }
stop()
execFileSync(APACHE, ['-f', `${ROOT}/httpd.conf`, '-k', 'start'])
await new Promise((r) => setTimeout(r, 800))

const head = (path) => {
  const out = execFileSync('curl', [
    '-sI', '-m', '5', '-H', `Host: ${HOST}`, '-H', 'X-Forwarded-Proto: https',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'latin1' })
  return {
    status: Number(/^HTTP\/[\d.]+ (\d+)/.exec(out)?.[1] ?? 0),
    cache: /^cache-control:\s*(.+)$/im.exec(out)?.[1]?.trim() ?? '',
  }
}

try {
  console.log('\n## Nothing sensitive is reachable from the web root')
  for (const [name, what] of Object.entries(BAIT)) {
    const { status } = head(`/${name}`)
    ok(status === 403 || status === 404, `/${name} is not served`, `${what} — ${status}`)
  }

  console.log('\n## …including inside a subdirectory that has its own RewriteEngine')
  console.log('   (mod_rewrite is not inherited there; a <FilesMatch> is)')
  for (const name of ['.token.json', '.env', 'x.log', 'package.json']) {
    const { status } = head(`/sub/${name}`)
    ok(status === 403 || status === 404, `/sub/${name} is not served`, String(status))
  }

  console.log('\n## The payment endpoints')
  ok(head('/pay/.cbk_token.json').status !== 200, 'the CBK bearer token is not served',
    'and its default location is now above the web root entirely')
  for (const p of ['/knet/config.php', '/pay/config.php', '/knet/config.example.php', '/pay/cbk.php']) {
    const { status } = head(p)
    ok(status === 403 || status === 404, `${p} is not served`, String(status))
  }
  for (const p of ['/knet/pay.php', '/pay/pay.php', '/knet/callback.php', '/pay/callback.php']) {
    const { cache } = head(p)
    ok(/no-store/.test(cache), `${p} is no-store`, cache || 'NO Cache-Control')
  }

  // The native backend puts a database password and the whole schema inside a
  // folder that ships. Only two files there are endpoints; everything else is
  // support code that must never be fetchable.
  if (existsSync(`${ROOT}/www/api`)) {
    console.log('\n## The native backend (/api)')
    for (const p of [
      '/api/config.php',          // the MySQL password
      '/api/config.example.php',  // the template, which names every key
      '/api/store.php',           // shared core, not an endpoint
      '/api/schema.mysql.sql',    // the schema
      '/api/seed.mysql.sql',      // the catalogue
      '/api/brands.mysql.sql',    // the brands migration
    ]) {
      const { status } = head(p)
      ok(status === 403 || status === 404, `${p} is not served`, String(status))
    }
    for (const p of ['/api/api.php', '/api/admin.php']) {
      const { cache } = head(p)
      ok(/no-store/.test(cache), `${p} is no-store`, cache || 'NO Cache-Control')
    }
  }

  console.log('\n## What must keep working')
  ok(head('/.well-known/acme-challenge/abc123').status === 200,
    'ACME challenge is reachable (SSL renewal)')
  for (const p of ['/', '/shop', '/robots.txt', '/sitemap.xml', '/site.webmanifest', '/config.js']) {
    ok(head(p).status === 200, `${p} is served`)
  }
  ok(head('/emptyish/').status === 403, 'a folder with no index file does not list its contents')
  const oldSite = head('/index.php')
  ok(oldSite.status === 301, 'index.php 301s to the canonical homepage',
    `${oldSite.status} — the old PHP front controller is never executed`)
  ok(head('/knet/api/index.php').status !== 301,
    '…but /knet/api/index.php still works',
    'the rule is anchored on the full path, not the filename')

  console.log('\n## Cache tier matches the folder it is in')
  const hashed = readdirSync(join(DIST, 'assets')).find((f) => /-[A-Za-z0-9_-]{8,}\.js$/.test(f))
  const tiers = [
    [`/assets/${hashed}`, /immutable/, 'immutable — content-hashed'],
    ['/cats/mobile/art-men.webp', /max-age=2592000/, '30 days — fixed name'],
    ['/cats/desktop/art-men.webp', /max-age=2592000/, '30 days — fixed name'],
    ['/fonts/alexandria-var-latin.woff2', /max-age=2592000/, '30 days — fixed name'],
    ['/', /no-cache/, 'always revalidate'],
    ['/config.js', /no-cache/, 'edited in place on the server'],
    ['/robots.txt', /max-age=3600/, 'an hour'],
    ['/sw.js', /no-cache/, 'a stale service worker outlives deploys'],
  ]
  for (const [p, re, why] of tiers) {
    const { cache } = head(p)
    ok(re.test(cache), `${p}`, `${cache || 'NO Cache-Control'} (${why})`)
  }

  console.log('\n## The package itself')
  const all = []
  ;(function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      statSync(p).isDirectory() ? walk(p) : all.push(p.slice(DIST.length))
    }
  })(DIST)
  const jsons = all.filter((p) => p.endsWith('.json'))
  ok(jsons.length === 0, 'no .json file ships', jsons.join(', ') || 'so denying the class costs nothing')
  for (const bad of ['/knet/config.php', '/pay/config.php', '/pay/.cbk_token.json', '/.env']) {
    ok(!all.includes(bad), `${bad} is not in the package`)
  }
} finally {
  stop()
}

console.log(fails ? `\n${fails} failed` : '\nnothing reachable that should not be')
process.exit(fails ? 1 : 0)
