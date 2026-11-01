#!/usr/bin/env node
// LIVE SCAN — what www.sporta.com.kw actually answers, checked from the VPS.
//
// scan-server-response.sh asks these questions with curl from the owner's
// Mac. This sandbox cannot reach the site, and the Hostinger API refuses any
// job containing the word curl, so the same questions are asked here in Node,
// from INSIDE the VPS: every request goes to the host's own Traefik on
// 127.0.0.1 with the real Host header and SNI, which is exactly the path a
// visitor's request takes after DNS. Because it runs on the server it can also
// look at the web root on disk — leftovers, permissions, a stray config.php —
// which no outside scan can.
//
// Read-only. It sends GET/HEAD requests and reads files; it writes nothing.
//
//   node scripts/vps-deploy.mjs compose --scan     (the job; read-only mount)
//   SPORTA_SCAN_BASE=http://127.0.0.1:8121 SPORTA_SCAN_ROOT=/tmp/site node scripts/live-scan.mjs
//                                                  (tests: plain HTTP, no TLS checks)
//
// Every check prints ok / WARN / BAD; the last line is
// "SCAN_DONE bad=<n> warn=<n>". An unreachable site is BAD on its own and stops
// the scan — a scanner that cannot connect must never print a page of passes.
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'

const HOST = 'www.sporta.com.kw'
const BARE = 'sporta.com.kw'
const BASE = process.env.SPORTA_SCAN_BASE ?? ''           // tests only
const ROOT = process.env.SPORTA_SCAN_ROOT ?? '/sporta/site'

let bad = 0, warn = 0
const ok = (s) => console.log(`ok   ${s}`)
const w = (s) => { warn++; console.log(`WARN ${s}`) }
const b = (s) => { bad++; console.log(`BAD  ${s}`) }
const head = (s) => console.log(`\n== ${s}`)

// One request to the site as a visitor would make it. `url` is absolute; the
// connection always goes to this machine's own front door.
function request(url, { method = 'GET', headers = {}, max = 300000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const base = BASE ? new URL(BASE) : null
    const secure = !base && u.protocol === 'https:'
    const lib = secure ? https : http
    const started = Date.now()
    const req = lib.request({
      host: base ? base.hostname : '127.0.0.1',
      port: base ? Number(base.port) : secure ? 443 : 80,
      path: u.pathname + u.search, method,
      headers: { Host: u.host, 'User-Agent': 'sporta-live-scan', ...headers },
      timeout: 20000,
      ...(secure ? {
        servername: u.hostname,
        checkServerIdentity: (_h, cert) => tls.checkServerIdentity(u.hostname, cert),
      } : {}),
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c) })
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, ms: Date.now() - started,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message, ms: Date.now() - started }))
    req.end()
  })
}
const site = (p) => `https://${HOST}${p}`
const get = (p, o) => request(site(p), o)

async function hops(url) {
  let n = 0, cur = url, last
  while (n < 6) {
    last = await request(cur)
    if (![301, 302, 307, 308].includes(last.status) || !last.headers.location) break
    cur = new URL(last.headers.location, cur).toString()
    n++
  }
  return { n, final: cur, status: last.status }
}

// ======================================================================= 1
head('1. Reachability')
const home = await get('/', { headers: { 'Accept-Encoding': 'identity' } })
if (home.status === 0) {
  b(`cannot reach ${HOST} at all (${home.body}) — nothing below would mean anything`)
  console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
  process.exit(1)
}
home.status === 200 ? ok(`GET / -> 200 in ${home.ms} ms`) : b(`GET / -> ${home.status}`)

if (!BASE) {
  head('1b. TLS')
  const info = await new Promise((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port: 443, servername: HOST, ALPNProtocols: ['h2', 'http/1.1'] }, () => {
      const c = s.getPeerCertificate()
      resolve({ proto: s.getProtocol(), alpn: s.alpnProtocol, authorized: s.authorized, err: s.authorizationError,
        validTo: c.valid_to, issuer: c.issuer?.O ?? c.issuer?.CN, san: c.subjectaltname })
      s.end()
    })
    s.on('error', (e) => resolve({ error: e.message }))
  })
  if (info.error) b(`TLS handshake failed: ${info.error}`)
  else {
    info.authorized ? ok(`certificate verifies (${info.issuer}; ${info.san})`) : b(`certificate does NOT verify: ${info.err}`)
    const days = Math.floor((new Date(info.validTo) - Date.now()) / 86400000)
    days > 20 ? ok(`expires ${info.validTo} — ${days} days`) : (days > 0 ? w(`expires in ${days} days (${info.validTo})`) : b(`EXPIRED ${info.validTo}`))
    info.proto === 'TLSv1.3' ? ok(`negotiates ${info.proto}`) : w(`negotiates ${info.proto} (1.3 expected)`)
    info.alpn === 'h2' ? ok('HTTP/2 offered (ALPN h2)') : w(`ALPN: ${info.alpn || 'none'} — no HTTP/2`)
  }
  for (const [v, label] of [['TLSv1', 'TLS 1.0'], ['TLSv1.1', 'TLS 1.1']]) {
    const accepted = await new Promise((resolve) => {
      const s = tls.connect({ host: '127.0.0.1', port: 443, servername: HOST, minVersion: v, maxVersion: v,
        ciphers: 'DEFAULT@SECLEVEL=0', rejectUnauthorized: false }, () => { resolve(true); s.end() })
      s.on('error', () => resolve(false))
    })
    accepted ? b(`${label} ACCEPTED — fails PCI scans`) : ok(`${label} refused`)
  }
  const bareCert = await new Promise((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port: 443, servername: BARE }, () => { resolve(s.authorized ? 'ok' : s.authorizationError); s.end() })
    s.on('error', (e) => resolve(e.message))
  })
  bareCert === 'ok' ? ok(`${BARE} has a valid certificate too (its redirect is not a browser warning)`) : b(`${BARE} certificate: ${bareCert}`)
}

// ======================================================================= 2
head('2. Redirects — every spelling reaches the canonical URL in ONE hop')
if (BASE) w('skipped under SPORTA_SCAN_BASE (no Traefik in tests)')
else {
  for (const u of [`http://${BARE}/shop`, `http://${HOST}/shop`, `https://${BARE}/shop`]) {
    const r = await hops(u)
    r.n <= 1 && r.final.startsWith(`https://${HOST}/`) && r.status === 200
      ? ok(`${u} -> ${r.n} hop -> ${r.final} (${r.status})`)
      : b(`${u} -> ${r.n} hops -> ${r.final} (${r.status})`)
  }
  const idx = await get('/index.html')
  ;[301, 302].includes(idx.status) ? ok(`/index.html -> ${idx.status} ${idx.headers.location}`) : w(`/index.html -> ${idx.status} (a second spelling of the homepage)`)
}

// ======================================================================= 3
head('3. Routes')
for (const p of ['/shop', '/checkout', '/cart', '/about', '/track', '/backends', '/product/cloudsoft-jacket-army-green']) {
  const r = await get(p)
  r.status === 200 ? ok(`${p} -> 200 (${r.ms} ms)`) : b(`${p} -> ${r.status}`)
}
for (const p of ['/this-page-does-not-exist-12345', '/shop/nope-9876', '/backends/', '/admin', '/product/no-such-product-zz']) {
  const r = await get(p)
  r.status === 404 ? ok(`${p} -> 404`) : (r.status === 200 ? b(`${p} -> 200 (soft 404)`) : w(`${p} -> ${r.status}`))
}

// ======================================================================= 4
head('4. Security headers on /')
const H = home.headers
const need = {
  'strict-transport-security': (v) => /max-age=\d{7,}/.test(v),
  'content-security-policy': (v) => !/script-src[^;]*'unsafe-inline'/.test(v),
  'x-content-type-options': (v) => v === 'nosniff',
  'x-frame-options': (v) => /sameorigin|deny/i.test(v),
  'referrer-policy': (v) => v.length > 0,
  'permissions-policy': (v) => v.length > 0,
  'cross-origin-opener-policy': (v) => v.length > 0,
}
for (const [name, good] of Object.entries(need)) {
  const v = String(H[name] ?? '')
  if (!v) b(`${name} MISSING`)
  else good(v) ? ok(`${name}: ${v.slice(0, 90)}`) : b(`${name}: ${v.slice(0, 90)} — weak`)
}
if (H['x-powered-by']) b(`X-Powered-By: ${H['x-powered-by']} (version disclosed)`)
else ok('X-Powered-By not sent')
;/\d+\.\d+/.test(String(H.server ?? '')) ? w(`Server: ${H.server} (version disclosed)`) : ok(`Server: ${H.server ?? '(absent)'}`)

// ======================================================================= 5
head('5. Compression and cache tiers')
const gz = await get('/', { headers: { 'Accept-Encoding': 'br, gzip' }, max: 1 })
gz.headers['content-encoding'] ? ok(`HTML content-encoding: ${gz.headers['content-encoding']}`) : b('HTML is NOT compressed')
const cc = (r) => String(r.headers['cache-control'] ?? '')
;/no-cache|no-store|max-age=0/.test(cc(home)) ? ok(`/ ${cc(home)}`) : b(`/ cache-control "${cc(home)}" — HTML must revalidate`)
const entry = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(home.body)?.[1]
if (entry) {
  const r = await get(entry, { max: 1 })
  r.status === 200 && /immutable/.test(cc(r)) ? ok(`${entry} ${cc(r)}`) : b(`${entry} -> ${r.status} "${cc(r)}" (hashed: expect immutable)`)
} else w('no hashed entry script found in /')
for (const [p, re, why] of [
  ['/logo.png', /max-age=2592000/, '30 days, never immutable'],
  ['/sitemap.xml', /max-age=/, 'a max-age'],
  ['/robots.txt', /max-age=/, 'a max-age'],
  ['/config.js', /no-cache|no-store/, 'no-cache — edited in place'],
  ['/sw.js', /no-cache|no-store/, 'no-cache — a stale worker pins the site'],
  ['/boot.js', /no-cache|no-store/, 'no-cache — fixed name'],
  ['/knet/pay.php', /no-store/, 'no-store — payment responses'],
  ['/pay/pay.php', /no-store/, 'no-store — payment responses'],
  ['/api/api.php?r=products', /no-store/, 'no-store — live data'],
]) {
  const r = await get(p, { max: 1 })
  re.test(cc(r)) ? ok(`${p} ${cc(r)}`) : b(`${p} -> ${r.status} "${cc(r) || 'NO Cache-Control'}" (expected ${why})`)
}

// ======================================================================= 6
head('6. Cookies')
const sc = [].concat(H['set-cookie'] ?? [])
if (!sc.length) ok('no cookies on / — nothing to consent to')
for (const c of sc) /;\s*secure/i.test(c) && /samesite=/i.test(c) ? ok(c.slice(0, 90)) : b(`${c.slice(0, 90)} (missing Secure/SameSite)`)
const me = await get('/api/admin.php?r=me', { headers: { 'X-Sporta-Admin': '1' } })
;[401, 403].includes(me.status) ? ok(`/api/admin.php?r=me -> ${me.status} without a session`) : b(`/api/admin.php?r=me -> ${me.status} without a session`)
for (const c of [].concat(me.headers['set-cookie'] ?? [])) {
  /;\s*secure/i.test(c) && /httponly/i.test(c) && /samesite=strict/i.test(c) ? ok(`admin cookie: ${c.split(';').slice(1).join(';').trim()}`)
    : b(`admin cookie not hardened: ${c.slice(0, 120)}`)
}

// ======================================================================= 7
head('7. Paths that must never answer 200')
const SENSITIVE = [
  '/.git/config', '/.env', '/.htaccess', '/package.json', '/config.php', '/.DS_Store', '/index.php',
  '/knet/config.php', '/knet/knet.php', '/knet/selftest.php', '/knet/setup-config.php', '/knet/.htaccess',
  '/pay/config.php', '/pay/cbk.php', '/pay/.cbk_token.json', '/pay/.htaccess',
  '/api/config.php', '/api/store.php', '/api/config-path.php', '/api/config.example.php', '/api/schema.mysql.sql',
  '/api/install.mysql.sql', '/api/seo-config.php', '/api/crm.php', '/api/cron-auth.php', '/api/customer-auth.php',
  '/api/preflight.php', '/api/setup-admin.php', '/api/.htaccess', '/go-live.html',
  '/knet.log', '/knet-payments.log', '/sporta-dist.zip', '/sporta-deploy.php', '/deploy.config.json',
  '/.deploy-manifest.json', '/README-knet.md', '/backups/', '/server-status', '/cats/.DS_Store',
]
for (const p of SENSITIVE) {
  const r = await get(p, { max: 2000 })
  if (r.status === 200) b(`${p} -> 200  ***EXPOSED*** (${r.body.length} bytes)`)
  else if (r.status === 0) w(`${p} -> no answer (NOT a pass)`)
  else if ([301, 302].includes(r.status)) ok(`${p} -> ${r.status} ${r.headers.location ?? ''}`)
  else ok(`${p} -> ${r.status}`)
}
for (const p of ['/cats/', '/fonts/', '/assets/', '/images/', '/api/', '/knet/', '/pay/']) {
  const r = await get(p, { max: 3000 })
  ;/index of/i.test(r.body) ? b(`${p} lists its contents`) : ok(`${p} -> ${r.status}, no listing`)
}

// ======================================================================= 8
head('8. API')
const prod = await get('/api/api.php?r=products')
let n = -1
try { const j = JSON.parse(prod.body); n = (Array.isArray(j) ? j : j.products ?? []).length } catch { /* not JSON */ }
n > 0 ? ok(`products: ${n} in ${prod.ms} ms`) : b(`products -> ${prod.status}, ${n} products`)
;/cost/i.test(prod.body) ? b('the products feed mentions cost') : ok('no wholesale cost in the products feed')
const stock = await get('/api/api.php?r=stock')
stock.status === 200 && !/cost/i.test(stock.body) ? ok('stock answers, without cost') : b(`stock -> ${stock.status}${/cost/i.test(stock.body) ? ' and leaks cost' : ''}`)
for (const r of ['slides', 'brands', 'theme', 'checkout_config']) {
  const x = await get(`/api/api.php?r=${r}`, { max: 20000 })
  x.status === 200 ? ok(`?r=${r} -> 200`) : b(`?r=${r} -> ${x.status}`)
}
const junk = await get('/api/api.php?r=no_such_route_zz')
junk.status >= 400 && junk.status < 500 ? ok(`unknown route -> ${junk.status}`) : b(`unknown route -> ${junk.status}`)
;/SQLSTATE|Fatal error|Stack trace|\/var\/www/i.test(junk.body + prod.body + stock.body) ? b('an API answer contains an error trace or a path') : ok('no error traces or paths in API answers')

// ======================================================================= 9
head('9. SEO')
const canon = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(home.body)?.[1]
canon === `https://${HOST}/` ? ok(`canonical ${canon}`) : b(`canonical on / is ${canon ?? 'MISSING'}`)
const langs = [...home.body.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1])
;['ar', 'en', 'x-default'].every((l) => langs.includes(l)) ? ok(`hreflang ${[...new Set(langs)].join(' ')}`) : b(`hreflang on /: ${langs.join(' ') || 'none'}`)
const en = await get('/?lang=en')
const enCanon = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(en.body)?.[1]
enCanon === `https://${HOST}/?lang=en` ? ok(`?lang=en canonical ${enCanon}`) : w(`?lang=en canonical is ${enCanon ?? 'missing'}`)
const robots = await get('/robots.txt')
;/disallow:\s*\/backends/i.test(robots.body) ? ok('robots.txt disallows /backends') : b('robots.txt does not disallow /backends')
;/sitemap:\s*https:\/\/www\.sporta\.com\.kw\//i.test(robots.body) ? ok('robots.txt names the sitemap') : w('robots.txt has no Sitemap line')
const sm = await get('/sitemap.xml')
sm.status === 200 && /<sitemapindex|<urlset/.test(sm.body) ? ok(`sitemap.xml is XML (${sm.headers['content-type']})`) : b(`sitemap.xml -> ${sm.status}`)
const smp = await get('/sitemap-products.xml')
const urls = (smp.body.match(/<url>/g) ?? []).length
urls >= 20 ? ok(`sitemap-products.xml: ${urls} URLs`) : b(`sitemap-products.xml -> ${smp.status}, ${urls} URLs`)

// ====================================================================== 10
head('10. The web root on disk')
if (!fs.existsSync(path.join(ROOT, 'index.html'))) w(`${ROOT} not mounted — disk checks skipped`)
else {
  const all = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) { all.push([abs, 'd']); walk(abs) } else if (e.isFile()) all.push([abs, 'f'])
    }
  }
  walk(ROOT)
  const rel = (a) => path.relative(ROOT, a)
  const configs = all.filter(([a, t]) => t === 'f' && /(^|\/)(config\.php|\.env|\.cbk_token\.json)$/.test(rel(a)))
  configs.length ? b(`secrets-shaped files in the web root: ${configs.map(([a]) => rel(a)).join(' ')}`) : ok('no config.php, .env or token file in the web root (the VPS keeps them in private/)')
  const LEFTOVERS = ['index.php', 'sporta-deploy.php', 'sporta-deploy-config.php', 'sporta-dist.zip', 'config-dist.php',
    'knet-config.php', 'knet-lib.php', 'knet-pay.php', 'knet-response.php', 'knet.log', 'deploy.config.json',
    'deployhostinger.mjs', 'package.json', 'vite.config.ts', 'README-knet.md', '.deploy-manifest.json',
    'go-live.html', 'api/preflight.php', 'api/setup-admin.php', 'knet/selftest.php', 'knet/setup-config.php']
  const left = LEFTOVERS.filter((p) => fs.existsSync(path.join(ROOT, p)))
  left.length ? w(`leftovers on disk (denied by .htaccess, but should not be there): ${left.join(' ')}`) : ok('no known leftovers or setup tools on disk')
  const odd = all.filter(([a, t]) => t === 'f' && /\.(zip|tar|gz|sql\.bak|bak|old|orig|swp)$/.test(a))
  odd.length ? w(`archives/backups in the web root: ${odd.slice(0, 8).map(([a]) => rel(a)).join(' ')}`) : ok('no archives or backup copies in the web root')
  const ww = all.filter(([a]) => (fs.statSync(a).mode & 0o002) !== 0)
  ww.length ? b(`world-writable: ${ww.slice(0, 8).map(([a]) => rel(a)).join(' ')}`) : ok('nothing world-writable')
  const f644 = all.filter(([a, t]) => t === 'f' && (fs.statSync(a).mode & 0o777) !== 0o644).length
  const d755 = all.filter(([a, t]) => t === 'd' && (fs.statSync(a).mode & 0o777) !== 0o755).length
  f644 || d755 ? w(`${f644} files not 644, ${d755} folders not 755 (readable either way; tidy with a deploy)`) : ok('files 644, folders 755')
  for (const p of ['.htaccess', 'api/.htaccess', 'knet/.htaccess', 'pay/.htaccess']) {
    fs.existsSync(path.join(ROOT, p)) ? ok(`${p} present`) : b(`${p} MISSING`)
  }
  ok(`${all.filter(([, t]) => t === 'f').length} files, ${all.filter(([, t]) => t === 'd').length} folders`)
}

console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
