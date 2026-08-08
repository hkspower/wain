// The backend-panel bundle, served by a REAL Apache.
//
// The bundle's whole promise is "drop this in and /backends opens". That is an
// Apache question — mod_rewrite, and whether a hidden file survived the copy —
// so it is answered by Apache rather than by reading the folder and hoping.
//
// The second half is the one that matters. The READ-ME tells the owner that a
// 404 means .htaccess did not upload. That instruction is only worth printing
// if it is TRUE, so the test deletes .htaccess and checks that /backends does
// in fact 404 — proving the advice points at the real cause rather than at a
// plausible-sounding one.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'

const BUNDLE = process.argv[2] ?? '/home/user/wain/SPORTA-BACKEND-UPLOAD'
const ROOT = '/tmp/backend-pkg-test'
const PORT = 8123

let fails = 0
const is = (c, n, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${d ? `  — ${d}` : ''}`) }

const APACHE = spawnSync('sh', ['-c', 'command -v apache2 || command -v httpd'], { encoding: 'utf8' })
  .stdout.trim().split('\n')[0]
if (!APACHE) {
  console.log('apache2 is not installed — skipping (this check needs a real server to mean anything)')
  process.exit(0)
}
const MODULES = '/usr/lib/apache2/modules'

rmSync(ROOT, { recursive: true, force: true })
mkdirSync(`${ROOT}/www`, { recursive: true })
cpSync(BUNDLE, `${ROOT}/www`, { recursive: true })

// AllowOverride All, exactly as shared hosting runs it — otherwise the
// .htaccess under test would be ignored and everything would pass for the
// wrong reason.
writeFileSync(`${ROOT}/httpd.conf`, `
ServerName localhost
Listen ${PORT}
PidFile ${ROOT}/httpd.pid
ErrorLog ${ROOT}/error.log
LoadModule mpm_event_module ${MODULES}/mod_mpm_event.so
LoadModule authz_core_module ${MODULES}/mod_authz_core.so
LoadModule dir_module ${MODULES}/mod_dir.so
LoadModule mime_module ${MODULES}/mod_mime.so
LoadModule rewrite_module ${MODULES}/mod_rewrite.so
LoadModule headers_module ${MODULES}/mod_headers.so
LoadModule alias_module ${MODULES}/mod_alias.so
LoadModule expires_module ${MODULES}/mod_expires.so
LoadModule deflate_module ${MODULES}/mod_deflate.so
LoadModule filter_module ${MODULES}/mod_filter.so
LoadModule setenvif_module ${MODULES}/mod_setenvif.so
TypesConfig /etc/mime.types
DocumentRoot ${ROOT}/www
<Directory ${ROOT}/www>
  AllowOverride All
  Require all granted
</Directory>
`)

const httpd = spawn(APACHE, ['-f', `${ROOT}/httpd.conf`, '-DFOREGROUND'], { stdio: 'ignore' })
// The Host and X-Forwarded-Proto headers are not decoration. The production
// .htaccess 301s anything that is not https://www.sporta.com.kw to it in one
// hop, so a plain request to 127.0.0.1 is answered with that redirect and every
// assertion below would be about the redirect rather than about the bundle.
// This is what Hostinger's edge sends after terminating TLS.
const get = async (path) => {
  // curl, not fetch: fetch treats Host as a forbidden header and drops it, so
  // the request arrives as 127.0.0.1 and the canonical redirect answers it.
  const r = spawnSync('curl', [
    '-sS', '-m', '10', '-o', '-', '-w', '\\n%{http_code}',
    '-H', 'Host: www.sporta.com.kw', '-H', 'X-Forwarded-Proto: https',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw new Error('curl failed')
  const out = r.stdout ?? ''
  const cut = out.lastIndexOf('\n')
  return { status: Number(out.slice(cut + 1)), body: out.slice(0, cut) }
}

// Wait for it to actually answer.
let up = false
for (let i = 0; i < 60; i++) {
  try { await get('/index.html'); up = true; break } catch { await new Promise((r) => setTimeout(r, 100)) }
}
is(up, 'Apache is serving the bundle')

try {
  // ------------------------------------------------------- the bundle as shipped
  const admin = await get('/backends')
  is(admin.status === 200, '/backends serves the app', `${admin.status}`)
  is(/<div id="root"|<script/.test(admin.body), 'and what it serves is the app shell, not a directory listing')

  // The panel's own chunk must be fetchable, or the shell loads and stops.
  const chunk = admin.body.match(/\/assets\/index-[A-Za-z0-9._-]+\.js/)?.[0]
  is(!!chunk, 'index.html references its entry chunk', chunk ?? 'none found')
  if (chunk) is((await get(chunk)).status === 200, 'and that chunk is present in the bundle')

  // Every asset the shell asks for. A missing one is a white screen, which is
  // far harder to diagnose than a 404.
  const wanted = [...admin.body.matchAll(/\/assets\/[A-Za-z0-9._-]+/g)].map((m) => m[0])
  const missing = []
  for (const w of new Set(wanted)) if ((await get(w)).status !== 200) missing.push(w)
  is(missing.length === 0, 'every asset index.html asks for is really there', missing.join(', ') || 'all present')

  // The API the panel talks to.
  is((await get('/api/api.php')).status !== 404, 'the API the panel calls is in the bundle')

  // And the credentials that must NEVER be in it.
  //
  // 403 counts, and is in fact the better answer: api/.htaccess denies
  // config.php BY NAME, so the file is refused whether or not it exists. That
  // is the guard that protects the live server's own copy. Absence from the
  // bundle is asserted separately, on disk, because a 403 alone cannot tell
  // "not there" from "there but hidden".
  for (const secret of ['/api/config.php', '/knet/config.php', '/pay/config.php']) {
    const st = (await get(secret)).status
    is(st === 404 || st === 403, `${secret} is not served`, `${st}`)
  }
  for (const secret of ['api/config.php', 'knet/config.php', 'pay/config.php', '.env']) {
    is(!existsSync(`${ROOT}/www/${secret}`), `${secret} is not in the bundle at all`)
  }

  // ------------------------------------------ the READ-ME's central claim
  // Remove the hidden file and the panel must break, exactly as documented.
  rmSync(`${ROOT}/www/.htaccess`)
  const without = await get('/backends')
  is(without.status === 404,
     'WITHOUT .htaccess /backends 404s — so the READ-ME points at the real cause',
     `${without.status}`)
  // …while a real file on disk still serves, which is why the failure looks
  // like "the panel was never uploaded" rather than like a broken server.
  is((await get('/index.html')).status === 200,
     'though index.html itself still serves — which is why it looks like a missing upload')
} finally {
  httpd.kill()
  if (existsSync(`${ROOT}/httpd.pid`)) spawnSync('sh', ['-c', `kill $(cat ${ROOT}/httpd.pid) 2>/dev/null`])
}

console.log(fails ? `\n${fails} problem(s) in the backend bundle` : '\nthe backend bundle opens /backends when dropped in')
process.exit(fails ? 1 : 0)
