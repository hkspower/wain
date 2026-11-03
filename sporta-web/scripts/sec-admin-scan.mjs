#!/usr/bin/env node
// SEC-ADMIN SCAN — black-box, READ-ONLY look at the ADMIN of www.sporta.com.kw
// (/backends and api/admin.php), SIGNED OUT, plus a read-only look at the files
// on disk that define it.
//
// Runs on the VPS (a node:24-alpine job on the host network, /docker/sporta
// mounted READ-ONLY at /sporta) and talks to the host's own Traefik on
// 127.0.0.1:443 with the real Host header and SNI, like live-scan.mjs.
//
// WHAT IT NEVER DOES: sign in, send a credential or a cookie, POST, PUT or
// DELETE anything. GET / HEAD / OPTIONS / TRACE only (the one TRACE is a
// refusal check). Fewer than 300 requests, paced, and it stops at the first
// 429. It writes nothing: the mount is read-only and nothing is created in /tmp
// except the downloaded repo files kept in memory.
//
// WHAT IT NEVER PRINTS: a secret VALUE. Cookie values are withheld (flags
// only). The names of files in the admin session directory ARE session ids, so
// only their count, modes and owners are printed. Config files are not opened.
// JavaScript is public, but a long token-like string found in it is still
// printed as <tok:LENGTH>, never as itself.
//
//   SEC_SHA=<pushed commit>  SEC_BASE=1eb487aa...  node scripts/sec-admin-scan.mjs
//
// SEC_SHA  commit the repo copies (admin.php route list) are read from.
// SEC_BASE commit the live PHP was last verified byte-identical to.
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import crypto from 'node:crypto'

const HOST = 'www.sporta.com.kw'
const SITE = process.env.SEC_SITE || '/sporta/site'
const PRIVATE = process.env.SEC_PRIVATE || '/sporta/private'
const SHA = process.env.SEC_SHA || 'HEAD'
const BASE = process.env.SEC_BASE || SHA
const DELAY = Number(process.env.SEC_DELAY_MS ?? 450)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
let count = 0
let stopped = false

const say = (s = '') => console.log(s)
const head = (t) => say(`\n== ${t}`)
const FIND = []
const note = (tag, s) => { FIND.push(`${tag} ${s}`); say(`${tag} ${s}`) }

function request(p, { method = 'GET', headers = {}, max = 300000, host = HOST } = {}) {
  count++
  p = p.replace(/ /g, '%20').replace(/[^\x21-\x7e]/g, (c) => encodeURIComponent(c))
  return new Promise((resolve) => {
    const req = https.request({
      host: '127.0.0.1', port: 443, path: p, method,
      headers: { Host: host, 'User-Agent': 'sporta-sec-admin-scan', Accept: '*/*', 'Accept-Encoding': 'identity', ...headers },
      timeout: 20000, servername: HOST, checkServerIdentity: () => undefined,
    }, (res) => {
      const chunks = []
      let n = 0, total = 0
      res.on('data', (c) => { total += c.length; if (n < max) { chunks.push(c); n += c.length } })
      res.on('end', () => {
        if (res.statusCode === 429) stopped = true
        resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, buf: Buffer.concat(chunks), total })
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, raw: [], buf: Buffer.alloc(0), total: 0, err: 'timeout' }) })
    req.on('error', (e) => resolve({ status: 0, headers: {}, raw: [], buf: Buffer.alloc(0), total: 0, err: e.code ?? e.message }))
    req.end()
  })
}
async function get(p, opts) {
  if (stopped) return { status: -1, headers: {}, raw: [], buf: Buffer.alloc(0), total: 0, err: 'stopped-after-429' }
  const r = await request(p, opts)
  await pause(DELAY)
  return r
}

const text = (r) => r.buf.toString('utf8')
const json = (r) => { try { return JSON.parse(text(r)) } catch { return undefined } }
const TRACE = /SQLSTATE|Fatal error|Stack trace|Warning:|Notice:|Deprecated:|<br \/>|\/var\/www|\/run\/sporta|\/docker\/|PDOException|on line \d+/
const cookieFlags = (c) => (Array.isArray(c) ? c : [c]).filter(Boolean).map((v) => {
  const [nv, ...attrs] = String(v).split(';')
  return `${nv.split('=')[0]}=<withheld>; ${attrs.map((a) => a.trim().replace(/^(expires)=.*/i, 'Expires=<set>')).join('; ')}`
})
// One-line description of a response that never contains a body.
function shape(r) {
  if (r.status <= 0) return `ERR ${r.err ?? ''}`
  const t = text(r)
  const ct = String(r.headers['content-type'] ?? '(none)').split(';')[0]
  let d = `${r.status} ${ct} ${r.total}B`
  if (t.startsWith('<?php')) d += ' PHP-SOURCE-SERVED'
  else if (/<div id="root"/.test(t)) d += ' spa-shell'
  else {
    const j = json(r)
    if (j === null) d += ' json:null'
    else if (j && typeof j === 'object') d += ` json:{${Object.keys(j).slice(0, 6).join(',')}}${typeof j.error === 'string' && j.error.length < 40 ? ` error=${j.error}` : ''}`
  }
  if (TRACE.test(t)) d += ' TRACE-OR-PATH-IN-BODY'
  return d
}
const mask = (s) => s.replace(/[A-Za-z0-9+/_=-]{20,}/g, (m) => `<tok:${m.length}>`)

// ===================================================================== 1
head('1. /backends: page, headers, cookies, variants')
const page = await get('/backends')
{
  const h = page.headers
  say(`GET /backends -> ${shape(page)}`)
  for (const k of ['content-security-policy', 'x-frame-options', 'x-robots-tag', 'cache-control', 'referrer-policy', 'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'x-content-type-options', 'permissions-policy', 'access-control-allow-origin', 'server', 'x-powered-by', 'via', 'vary', 'etag']) {
    if (h[k] !== undefined) say(`   ${k}: ${String(h[k]).slice(0, 700)}`)
  }
  const sc = cookieFlags(h['set-cookie'])
  say(`   set-cookie: ${sc.length ? sc.join(' || ') : '(none)'}`)
  const t = text(page)
  const metaRobots = /<meta[^>]+name=["']robots["'][^>]*>/i.exec(t)?.[0] ?? '(none)'
  say(`   meta robots: ${metaRobots}`)
  const scripts = [...t.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1])
  const inline = scripts.filter((a) => !/\bsrc=/.test(a))
  say(`   <script> tags: ${scripts.length}, inline (no src): ${inline.length}, with integrity: ${scripts.filter((a) => /integrity=/.test(a)).length}`)
  say(`   scripts: ${scripts.map((a) => /src="([^"]+)"/.exec(a)?.[1] ?? '(inline)').join(' ').slice(0, 400)}`)
  say(`   stylesheets/preloads off-site: ${[...t.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).join(' ') || '(none)'}`)
  const secretish = [...t.matchAll(/(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN)/g)]
  say(`   secret-looking strings in the page HTML: ${secretish.length}`)
  if (secretish.length) note('BAD', `/backends HTML carries ${secretish.length} secret-looking string(s)`)
  const csp = String(h['content-security-policy'] ?? '')
  if (!/frame-ancestors/.test(csp) && !/DENY|SAMEORIGIN/i.test(String(h['x-frame-options'] ?? ''))) note('BAD', '/backends can be framed')
  if (!/noindex/i.test(String(h['x-robots-tag'] ?? '') + metaRobots)) note('WARN', '/backends has no noindex (robots.txt only)')
  if (/'unsafe-inline'/.test(csp.replace(/style-src[^;]*;?/, ''))) note('WARN', 'CSP script-src allows unsafe-inline')
}
{
  const hd = await get('/backends', { method: 'HEAD' })
  say(`HEAD /backends -> ${hd.status} len=${hd.headers['content-length'] ?? '-'} (GET was ${page.status} ${page.total}B)`)
  const mk = 'zq9"\'<b>'
  const refl = [
    ['/backends?x=' + encodeURIComponent(mk), 'query'],
    ['/backends/zq9' + encodeURIComponent('"\'<b>'), 'path'],
  ]
  for (const [p, label] of refl) {
    const r = await get(p)
    const t = text(r)
    const echoed = t.includes('zq9"\'<b>') || t.includes('zq9<b>')
    say(`GET ${p.slice(0, 40)} (${label} reflection) -> ${r.status} ${r.total}B reflected-unescaped=${echoed}`)
    if (echoed) note('BAD', `/backends ${label} reflected unescaped`)
  }
  const variants = ['/backends/', '/backends/orders', '/Backends', '/BACKENDS', '/backends%2f', '/backends/..%2f..%2fetc%2fpasswd', '/backends/.git/config', '/backends.php', '/backends/index.php',
    '/admin', '/admin/', '/admin.php', '/wp-admin', '/administrator', '/phpmyadmin', '/dashboard', '/login', '/panel.php', '/cpanel', '/manage']
  const rows = []
  for (const p of variants) {
    const r = await get(p)
    rows.push(`${p} ${r.status}${r.headers.location ? '->' + String(r.headers.location).slice(0, 60) : ''}${r.status === 200 && !/spa-shell/.test(shape(r)) ? '(non-spa)' : ''}`)
  }
  say(rows.join(' | '))
  for (const p of ['/backends.webmanifest', '/backends-offline.html', '/sw.js', '/robots.txt']) {
    const r = await get(p)
    say(`GET ${p} -> ${r.status} ${r.total}B cache-control=${r.headers['cache-control'] ?? '-'}`)
    if (p === '/robots.txt') say(`   robots Disallow /backends: ${/^Disallow:\s*\/backends/im.test(text(r))}, Disallow /api/: ${/^Disallow:\s*\/api\//im.test(text(r))}`)
  }
}

// ===================================================================== 2
head('2. The admin bundle on disk (public static files)')
const ASSETS = path.join(SITE, 'assets')
const indexHtml = fs.existsSync(path.join(SITE, 'index.html')) ? fs.readFileSync(path.join(SITE, 'index.html'), 'utf8') : ''
const refsIn = (t) => [...new Set([
  ...[...t.matchAll(/\/assets\/([\w.-]+\.(?:js|css))/g)].map((m) => m[1]),
  ...[...t.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)].map((m) => m[1]),
  ...[...t.matchAll(/["'`]assets\/([\w.-]+\.(?:js|css))["'`]/g)].map((m) => m[1]),
])]
const seen = new Set()
const queue = [...new Set([...refsIn(indexHtml), ...refsIn(text(page))])]
while (queue.length && seen.size < 600) {
  const f = queue.shift()
  if (seen.has(f)) continue
  seen.add(f)
  const p = path.join(ASSETS, f)
  if (!fs.existsSync(p)) continue
  if (f.endsWith('.js')) for (const r of refsIn(fs.readFileSync(p, 'utf8'))) if (!seen.has(r)) queue.push(r)
}
const jsFiles = [...seen].filter((f) => f.endsWith('.js') && fs.existsSync(path.join(ASSETS, f))).map((f) => [`assets/${f}`, path.join(ASSETS, f)])
for (const f of fs.existsSync(SITE) ? fs.readdirSync(SITE) : []) {
  if (/\.js$/.test(f) && fs.statSync(path.join(SITE, f)).isFile()) jsFiles.push([f, path.join(SITE, f)])
}
const adminChunks = jsFiles.filter(([n]) => /Admin/.test(n)).map(([n]) => n)
say(`JS files scanned: ${jsFiles.length} (admin chunks: ${adminChunks.join(', ') || 'none'})`)
const bundleOf = new Map(jsFiles.map(([n, p]) => [n, fs.readFileSync(p, 'utf8')]))
const PATTERNS = [
  ['sk-key', /sk-[A-Za-z0-9]{20,}/g], ['stripe-live', /[sp]k_live_[A-Za-z0-9]{10,}/g], ['AIza', /AIza[0-9A-Za-z_-]{30,}/g],
  ['AWS-AKIA', /AKIA[0-9A-Z]{16}/g], ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY/g], ['Bearer-literal-token', /Bearer\s+[A-Za-z0-9._~+/-]{20,}/g],
  ['hardcoded-secret-assign', /\b(?:password|passwd|secret|api_?key|token|client_secret|authorization)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{12,}["']/gi],
  ['ipv4', /(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\d.])/g],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g],
  ['dev-host', /(?:localhost|127\.0\.0\.1|staging\.[\w.-]+|[\w-]+\.local\b|[\w.-]+\.internal\b|ngrok[\w.-]*|[\w-]+\.vercel\.app|[\w-]+\.supabase\.co|[\w-]+\.netlify\.app|[\w-]+\.n8n\.cloud|lovable[\w.-]*)/gi],
  ['todo-debug', /\b(?:TODO|FIXME|XXX|HACK)\b|\bdebugger\b/g],
  ['sourceMappingURL', /sourceMappingURL=[^\s'"]+/g],
]
const hits = new Map()
for (const [n, t] of bundleOf) {
  for (const [name, re] of PATTERNS) {
    for (const m of t.matchAll(re)) {
      if (name === 'ipv4') {
        const ctx = t.slice(Math.max(0, m.index - 12), m.index)
        if (/[a-z]\s*=?\s*["'`]?\s*[MLCHVZmlchvz,]\s*$|d=["'][^"']*$/.test(ctx) || /^(?:0\.0\.0\.0|1\.0\.0\.0|0\.0\.0\.\d)$/.test(m[0])) continue
      }
      const a = hits.get(name) ?? { files: new Set(), n: 0, ex: new Map() }
      a.files.add(n); a.n++
      const sample = mask(t.slice(Math.max(0, m.index - 25), m.index + Math.min(m[0].length, 60) + 15).replace(/\s+/g, ' '))
      if (a.ex.size < 6) a.ex.set(name === 'email' || name === 'ipv4' || name === 'dev-host' ? m[0] : sample, n)
      hits.set(name, a)
    }
  }
}
for (const [name] of PATTERNS) {
  const a = hits.get(name)
  if (!a) { say(`  clean: ${name}`); continue }
  say(`  ${name}: ${a.n} hit(s) in ${a.files.size} file(s): ${[...a.ex.keys()].map((k) => mask(k).slice(0, 90)).join(' ~ ')}`)
  if (['sk-key', 'stripe-live', 'AIza', 'AWS-AKIA', 'JWT', 'private-key', 'Bearer-literal-token', 'hardcoded-secret-assign'].includes(name)) note('BAD', `admin/store JS carries ${name} (${a.n})`)
}
{
  const hosts = new Map()
  for (const [n, t] of bundleOf) for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.set(m[1].toLowerCase(), (hosts.get(m[1].toLowerCase()) ?? 0) + 1)
  say(`  off-site hostnames written in the JS: ${[...hosts].map(([h, c]) => `${h}(${c})`).join(' ')}`)
  const ls = new Set()
  for (const [, t] of bundleOf) for (const m of t.matchAll(/(?:local|session)Storage\.(?:setItem|getItem|removeItem)\(\s*["'`]([\w.:-]+)["'`]/g)) ls.add(m[0].split('.')[0].slice(0, 1) + ':' + m[1])
  say(`  browser-storage keys the JS uses (l=local s=session): ${[...ls].sort().join(' ')}`)
  const clientRoutes = new Set()
  for (const [, t] of bundleOf) for (const m of t.matchAll(/["'`](\/backends[\w/.-]*)["'`]/g)) clientRoutes.add(m[1])
  say(`  /backends client paths in the JS: ${[...clientRoutes].sort().join(' ') || '(none)'}`)
  const apiFiles = new Set()
  for (const [, t] of bundleOf) for (const m of t.matchAll(/["'`]\/?(?:api\/)?([a-z][\w-]*\.php)[?"'`]/g)) apiFiles.add(m[1])
  say(`  .php endpoints written in the JS: ${[...apiFiles].sort().join(' ')}`)
  const maps = [...bundleOf.keys()].filter((n) => fs.existsSync(path.join(SITE, n + '.map')))
  say(`  .map files on disk next to the JS: ${maps.length}`)
  if (maps.length) note('MED', `source maps on disk: ${maps.slice(0, 5).join(', ')}`)
}
// The service worker is public source: does it cache the admin API?
{
  const swp = path.join(SITE, 'sw.js')
  if (fs.existsSync(swp)) {
    const sw = fs.readFileSync(swp, 'utf8')
    const lines = sw.split('\n').filter((l) => /api|backends|admin|cache\.put|\/api\//i.test(l)).map((l) => l.trim().slice(0, 150))
    say(`  sw.js ${sw.length}B; lines mentioning api/backends/admin: ${lines.length}`)
    for (const l of lines.slice(0, 14)) say(`     | ${l}`)
  }
}

// ===================================================================== 3
head('3. Routes: live admin.php vs the bundle vs the repo')
const live = fs.existsSync(path.join(SITE, 'api/admin.php')) ? fs.readFileSync(path.join(SITE, 'api/admin.php'), 'utf8') : ''
const routesOf = (src) => {
  const set = new Set()
  for (const m of src.matchAll(/\$r\s*===\s*'([a-z_]+)'/g)) set.add(m[1])
  for (const m of src.matchAll(/in_array\(\$r,\s*\[([^\]]*)\]/g)) for (const q of m[1].matchAll(/'([a-z_]+)'/g)) set.add(q[1])
  const aa = /\$activityActions\s*=\s*\[([^\]]*)\]/.exec(src)
  if (aa) for (const q of aa[1].matchAll(/'([a-z_]+)'/g)) set.add(q[1])
  return set
}
const liveRoutes = routesOf(live)
const wallAt = live.indexOf('store_require_admin()')
const openRoutes = routesOf(live.slice(0, Math.max(0, wallAt)))
say(`live api/admin.php: ${live.length}B, ${liveRoutes.size} routes, ${openRoutes.size} before the sign-in wall (${[...openRoutes].join(', ')})`)
let repoRoutes = new Set()
async function raw(sha, p) {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/hkspower/wain/${sha}/${p}`)
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null
  } catch { return null }
}
{
  const buf = await raw(SHA, 'sporta-web/dropin/php-store/admin.php')
  if (buf) {
    repoRoutes = routesOf(buf.toString('utf8'))
    const onlyLive = [...liveRoutes].filter((r) => !repoRoutes.has(r))
    const onlyRepo = [...repoRoutes].filter((r) => !liveRoutes.has(r))
    say(`repo admin.php @${SHA.slice(0, 8)}: ${repoRoutes.size} routes. live-only: ${onlyLive.join(' ') || '(none)'} | repo-only: ${onlyRepo.join(' ') || '(none)'}`)
  } else say('repo admin.php not fetched')
}
{
  const bundle = [...bundleOf.values()].join('\n')
  const served = new Set()
  for (const f of fs.existsSync(path.join(SITE, 'api')) ? fs.readdirSync(path.join(SITE, 'api')).filter((x) => x.endsWith('.php')) : []) {
    for (const m of fs.readFileSync(path.join(SITE, 'api', f), 'utf8').matchAll(/\$r\s*===\s*'([a-z_]+)'|case '([a-z_]+)'/g)) served.add(m[1] ?? m[2])
    for (const m of routesOf(fs.readFileSync(path.join(SITE, 'api', f), 'utf8'))) served.add(m)
  }
  const called = [...new Set([...bundle.matchAll(/["'`][^"'`\n]{0,160}?[?&]r=([a-z_]{2,40})(?=["'`&#])/g)].map((m) => m[1]))]
  const unknown = called.filter((r) => !served.has(r))
  say(`bundle calls ${called.length} ?r= routes; served by no live PHP: ${unknown.join(' ') || '(none)'}`)
  const adminCalled = called.filter((r) => liveRoutes.has(r)).length
  const notCalled = [...liveRoutes].filter((r) => !called.includes(r) && !bundle.includes(`"${r}"`) && !bundle.includes(`'${r}'`))
  say(`live admin.php routes no live screen names: ${notCalled.join(' ') || '(none)'}`)
}

// ===================================================================== 4
head('4. Signed-out answers of every admin.php route (GET, no X-Sporta-Admin, no cookie)')
{
  const names = [...liveRoutes].sort()
  const tally = new Map()
  const odd = []
  for (const r of names) {
    const res = await get(`/api/admin.php?r=${r}`)
    const j = json(res)
    const sig = `${res.status}${j && typeof j === 'object' && j !== null && typeof j.error === 'string' ? ' ' + j.error : j === null ? ' null' : ''}`
    tally.set(sig, (tally.get(sig) ?? 0) + 1)
    const sc = res.headers['set-cookie']
    const body = text(res)
    const expected = (res.status === 401 && j?.error === 'not_signed_in') || (openRoutes.has(r) && res.status < 500)
    if (!expected || sc || TRACE.test(body) || !/no-store/.test(String(res.headers['cache-control'] ?? ''))) {
      odd.push(`${r}: ${shape(res)}${sc ? ' SET-COOKIE ' + cookieFlags(sc).join('/') : ''} cc=${res.headers['cache-control'] ?? '-'}`)
    }
  }
  say(`${names.length} routes -> ${[...tally].map(([k, v]) => `${v}x[${k}]`).join(' ')}`)
  if (odd.length) { for (const o of odd) say(`  odd: ${o}`) } else say('  every route: 401 not_signed_in (or open route 2xx), no Set-Cookie, no trace, Cache-Control no-store')
  const hdr = ['orders', 'stats', 'payment_config', 'customer', 'product_save', 'variants']
  const rows = []
  for (const r of hdr) {
    const res = await get(`/api/admin.php?r=${r}`, { headers: { 'X-Sporta-Admin': '1' } })
    rows.push(`${r} ${shape(res)}`)
  }
  say(`with header: ${rows.join(' | ')}`)
  const m = await get('/api/admin.php?r=orders', { method: 'HEAD' })
  const o = await get('/api/admin.php?r=orders', { method: 'OPTIONS' })
  say(`HEAD ?r=orders -> ${m.status} len=${m.headers['content-length'] ?? '-'} | OPTIONS ?r=orders -> ${o.status} allow=${o.headers.allow ?? '-'} acao=${o.headers['access-control-allow-origin'] ?? '-'} len=${o.total}`)
}

// ===================================================================== 5
head('5. CORS, TRACE, forwarded-header tricks')
{
  const ev = 'https://evil.example'
  const rows = []
  for (const [m, p, extra] of [
    ['GET', '/api/admin.php?r=me', {}], ['GET', '/api/admin.php?r=orders', {}], ['HEAD', '/api/admin.php?r=orders', {}],
    ['OPTIONS', '/api/admin.php?r=orders', { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-sporta-admin,content-type' }],
    ['OPTIONS', '/api/admin.php?r=login', { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-sporta-admin,content-type' }],
    ['GET', '/backends', {}], ['GET', '/api/admin-google.php?action=nope', {}],
  ]) {
    for (const origin of [ev, 'null']) {
      if (origin === 'null' && !(p.includes('r=me') || m === 'OPTIONS')) continue
      const r = await get(p, { method: m, headers: { Origin: origin, ...extra } })
      const h = r.headers
      const acao = h['access-control-allow-origin'], acac = h['access-control-allow-credentials']
      rows.push(`${m} ${p.split('?')[0].split('/').pop()}${p.includes('r=') ? '?' + p.split('?')[1] : ''} Origin=${origin === ev ? 'evil' : 'null'} -> ${r.status} acao=${acao ?? '-'} acac=${acac ?? '-'} acam=${h['access-control-allow-methods'] ?? '-'}`)
      if (acao && (acao === ev || acao === '*' || acao === 'null')) note('BAD', `CORS: ${m} ${p} reflects/opens Origin ${origin}: ${acao} credentials=${acac ?? '-'}`)
    }
  }
  for (const r of rows) say(`  ${r}`)
  for (const p of ['/api/admin.php?r=me', '/backends']) {
    const r = await get(p, { method: 'TRACE' })
    say(`TRACE ${p} -> ${r.status}${r.status === 200 ? ' TRACE-ENABLED ' + r.total + 'B' : ''}`)
    if (r.status === 200) note('MED', `TRACE answers 200 on ${p}`)
  }
  const trick = [
    ['X-Forwarded-Host', 'evil.example'], ['X-Original-URL', '/api/admin.php?r=me'], ['X-Rewrite-URL', '/api/admin.php?r=me'],
    ['X-HTTP-Method-Override', 'DELETE'], ['X-Forwarded-Proto', 'http'],
  ]
  const rows2 = []
  for (const [k, v] of trick) {
    const r = await get('/api/admin.php?r=orders', { headers: { [k]: v } })
    rows2.push(`${k}=${v.slice(0, 22)} -> ${r.status}${text(r).includes('evil.example') ? ' REFLECTS-evil' : ''}${r.headers.location ? ' loc=' + String(r.headers.location).slice(0, 50) : ''}`)
  }
  say(`  forwarded/override headers on ?r=orders: ${rows2.join(' | ')}`)
  const hh = await get('/backends', { headers: { 'X-Forwarded-Host': 'evil.example' } })
  say(`  /backends with X-Forwarded-Host evil -> ${hh.status}, body mentions evil.example: ${text(hh).includes('evil.example')}`)
  if (text(hh).includes('evil.example')) note('MED', '/backends reflects X-Forwarded-Host into the page')
}

// ===================================================================== 6
head('6. URL variants of /api/admin.php must never reach an unguarded handler')
{
  const V = [
    '/api/Admin.php?r=orders', '/api/ADMIN.PHP?r=orders', '/api/admin.php/?r=orders', '/api/admin.php/x?r=orders', '/api/admin.php/x?r=me',
    '/api/admin.php/..;/admin.php?r=orders', '/api//admin.php?r=orders', '/api/./admin.php?r=orders', '/api/%2e%2e/api/admin.php?r=orders',
    '/api/admin%2ephp?r=orders', '/api/admin.php%00.jpg?r=orders', '/api/admin.php%20?r=orders', '/api/admin.php;.css?r=orders', '/api/admin.php.?r=orders',
    '/api/admin.php?r=../', '/api/admin.php?r=%2e%2e%2f', '/api/admin.php?r=orders%00', '/api/admin.php?r[]=orders', '/api/admin.php?r[a]=orders',
    '/api/admin.php?r=orders&r=me', '/api/admin.php?r=me&r=orders', '/api/admin.php?R=orders', '/api/admin.php?r=ORDERS', '/api/admin.php?r=orders%20',
    '/api/admin.php?r=\'', '/api/admin.php?r=-1%20OR%201=1', '/api/admin.php?r=orders&page=-1', '/api/admin.php?r=activity_log&page=99999999999',
    '/api/admin.php', '/api/admin.php?r=', '/api/admin', '/api/admin/', '/admin.php?r=orders', '/backends/api/admin.php?r=orders',
  ]
  const rows = []
  const bad = []
  for (const p of V) {
    const r = await get(p)
    const j = json(r)
    const guarded = r.status === 401 || r.status === 404 || r.status === 403 || r.status === 400 || r.status === 301 || r.status === 308 || (r.status === 200 && (j === null || /spa-shell/.test(shape(r)))) || r.status === 409
    rows.push(`${p.replace('/api/', '').slice(0, 40)} ${shape(r).replace(/ application\/json| text\/html/, '')}`)
    if (!guarded || r.status >= 500 || TRACE.test(text(r)) || text(r).startsWith('<?php')) bad.push(`${p} ${shape(r)}`)
  }
  for (let i = 0; i < rows.length; i += 4) say(`  ${rows.slice(i, i + 4).join(' | ')}`)
  if (bad.length) for (const b of bad) note('WARN', `variant not cleanly refused: ${b}`)
  else say('  every variant: 401/404/403/400 JSON or the SPA shell, no 5xx, no trace, no source')
}

// ===================================================================== 7
head('7. Sign-in surface, cookies, enumeration, alias, setup tools')
{
  const rows = []
  for (const p of ['/', '/backends', '/api/admin.php?r=me', '/api/admin.php?r=google_available', '/api/admin.php?r=login', '/api/admin.php?r=session', '/api/admin.php?r=forgot_password', '/api/admin.php?r=reset_password', '/api/admin.php?r=login_code', '/api/admin.php?r=change_initial_password']) {
    const r = await get(p, { headers: { 'X-Sporta-Admin': '1' } })
    const sc = cookieFlags(r.headers['set-cookie'])
    rows.push(`${p.replace('/api/admin.php', '')} -> ${shape(r)} cookie=${sc.length ? sc.join('/') : 'none'}`)
    if (sc.length && p.startsWith('/api/admin.php')) note('WARN', `signed-out GET ${p} sets a cookie: ${sc.join('/')}`)
    if (p.endsWith('google_available')) say(`  google_available body: ${text(r).slice(0, 60)}`)
  }
  for (const r of rows) say(`  ${r}`)
  const g = await get('/api/admin-google.php?action=nope')
  say(`  admin-google.php?action=nope -> ${shape(g)} cookie=${cookieFlags(g.headers['set-cookie']).join('/') || 'none'}`)
  const ga = json(await get('/api/admin.php?r=google_available'))
  if (ga && ga.available === false) {
    const s = await get('/api/admin-google.php?action=start')
    say(`  admin-google.php?action=start (Google not configured) -> ${s.status} location=${String(s.headers.location ?? '-').slice(0, 90)} cookie=${cookieFlags(s.headers['set-cookie']).join('/') || 'none'}`)
    const loc = String(s.headers.location ?? '')
    const back = loc.replace(/^https:\/\/www\.sporta\.com\.kw/, '').split('?')[0]
    if (back) {
      const bb = await get(back)
      say(`  where that redirect lands: ${back} -> ${bb.status}`)
      if (bb.status === 404) note('LOW', `admin-google.php redirects to ${back}, which the root .htaccess answers 404 (trailing slash)`)
    }
  } else say(`  google_available=${JSON.stringify(ga)}: action=start not probed (it would create a flow session)`)
  const setup = ['/api/setup-admin.php', '/api/preflight.php', '/go-live.html', '/knet/selftest.php', '/knet/setup-config.php', '/api/config.php', '/api/config.example.php', '/api/store.php', '/api/config-path.php',
    '/api/crm.php', '/api/returns.php', '/api/profiles.php', '/api/support.php', '/api/customer-auth.php', '/api/cron-auth.php', '/api/admin.php.bak', '/api/admin.php~', '/api/admin.php.orig', '/api/admin.php.swp', '/api/.admin.php.swp',
    '/api/install.mysql.sql', '/api/schema.mysql.sql', '/api/admin-totp.mysql.sql', '/api/admin-activity.mysql.sql', '/api/.htaccess', '/.htaccess', '/backups/', '/api/backups/', '/.env', '/.git/HEAD', '/composer.json', '/phpinfo.php', '/info.php', '/sporta-deploy.php']
  const out = []
  for (const p of setup) {
    const r = await get(p)
    const s = shape(r)
    out.push(`${p} ${r.status}${s.includes('PHP-SOURCE') ? ' PHP-SOURCE!' : ''}${r.status === 200 && !s.includes('spa-shell') ? ' ' + s.split(' ').slice(1, 3).join(' ') : ''}`)
    if (r.status === 200 && !s.includes('spa-shell') && !/\/(\.htaccess)$/.test(p)) note('WARN', `GET ${p} -> ${s}`)
    if (r.status === 200 && p.endsWith('.htaccess')) note('MED', `GET ${p} -> 200 ${r.total}B`)
  }
  for (let i = 0; i < out.length; i += 4) say(`  ${out.slice(i, i + 4).join(' | ')}`)
}

// ===================================================================== 8
head('8. On disk: setup tools, session directory, backups, drift (names, modes, hashes)')
{
  const st = (p) => { try { return fs.lstatSync(p) } catch { return null } }
  const mode = (s) => (s ? (s.mode & 0o7777).toString(8).padStart(4, '0') : 'none')
  const present = ['api/setup-admin.php', 'api/preflight.php', 'go-live.html', 'knet/selftest.php', 'knet/setup-config.php', 'sporta-deploy.php', 'panel.php', 'index.php', 'phpinfo.php', 'api/admin.php.bak']
    .filter((f) => st(path.join(SITE, f)))
  say(`setup/legacy files present on disk: ${present.join(' ') || '(none)'}`)
  for (const f of present.filter((x) => /setup-admin|preflight|go-live|selftest|setup-config|sporta-deploy|phpinfo/.test(x))) note('WARN', `setup tool still on disk: ${f} (denied or served? see section 7)`)
  const apiDir = path.join(SITE, 'api')
  const apiFiles = fs.existsSync(apiDir) ? fs.readdirSync(apiDir) : []
  const odd = apiFiles.filter((f) => /\.(bak|orig|old|swp|save|tmp|zip|tar|gz|log|txt|md)$|~$|^\.(?!htaccess$)/.test(f))
  say(`api/ holds ${apiFiles.length} files; backup/odd names: ${odd.join(' ') || '(none)'}`)
  const modes = new Map()
  for (const f of apiFiles) { const s = st(path.join(apiDir, f)); if (s) { const k = `${mode(s)} uid=${s.uid} gid=${s.gid}`; modes.set(k, (modes.get(k) ?? 0) + 1) } }
  say(`api/ file modes: ${[...modes].map(([k, v]) => `${v}x[${k}]`).join(' ')}`)
  const ad = st(path.join(apiDir, 'admin.php')); if (ad) say(`api/admin.php: ${mode(ad)} uid=${ad.uid} gid=${ad.gid} ${ad.size}B (world-writable=${Boolean(ad.mode & 0o002)})`)
  const sd = st(SITE); if (sd) say(`site root: ${mode(sd)} uid=${sd.uid} gid=${sd.gid}; api dir: ${mode(st(apiDir))} uid=${st(apiDir)?.uid}`)
  // Session directory: file NAMES are session ids, so count only.
  for (const dir of [path.join(PRIVATE, 'voice', 'admin-sessions'), path.join(PRIVATE, 'voice')]) {
    const s = st(dir)
    if (!s) { say(`${dir.replace('/sporta', '')}: absent`); continue }
    let n = 0, sess = 0, newest = 0, oldest = Infinity
    try { for (const f of fs.readdirSync(dir)) { n++; if (f.startsWith('sess_')) { sess++; const m = st(path.join(dir, f))?.mtimeMs ?? 0; newest = Math.max(newest, m); oldest = Math.min(oldest, m) } } } catch { /* unreadable */ }
    say(`${dir.replace('/sporta', '')}: mode ${mode(s)} uid=${s.uid} gid=${s.gid}, ${n} entries, ${sess} session files${sess ? `, newest ${((Date.now() - newest) / 3600000).toFixed(1)}h old, oldest ${((Date.now() - oldest) / 86400000).toFixed(1)}d old` : ''}`)
  }
  const sessFiles = (() => { try { return fs.readdirSync('/sporta/private/voice').filter((f) => f.startsWith('sess_')).length } catch { return 0 } })()
  say(`session files sitting in the shared voice dir (the default save path?): ${sessFiles}`)
  // Backups under the web root: served?
  const bk = path.join(SITE, 'backups')
  if (st(bk)) {
    const ents = fs.readdirSync(bk).slice(0, 80)
    say(`site/backups: ${ents.length} entries (mode ${mode(st(bk))}); names with an admin.php/.htaccess inside: ${ents.filter((e) => { const d = path.join(bk, e); return st(d)?.isDirectory() && fs.readdirSync(d).some((x) => /admin\.php|\.htaccess|config/.test(x)) }).slice(0, 8).join(' ') || '(none)'}`)
    const sample = ents.find((e) => st(path.join(bk, e))?.isDirectory() && fs.existsSync(path.join(bk, e, 'admin.php')))
    if (sample) {
      const r = await get(`/backups/${sample}/admin.php`)
      say(`  GET /backups/<dir with admin.php>/admin.php -> ${shape(r)}`)
      if (r.status === 200) note('CRIT', 'a backup copy of admin.php under /backups/ is served')
    }
  } else say('site/backups: absent')
  const rootOdd = (fs.existsSync(SITE) ? fs.readdirSync(SITE) : []).filter((f) => /\.(bak|orig|old|swp|zip|tar|gz|sql|log)$|^\.htaccess\.|~$|^\.env|^\.git/.test(f))
  say(`web-root backup/odd names: ${rootOdd.join(' ') || '(none)'}`)
  for (const f of rootOdd) { const r = await get('/' + f); say(`  GET /${f} -> ${r.status}`); if (r.status === 200) note('MED', `/${f} is served (200)`) }
  // Drift of the live PHP against the verified baseline.
  const files = ['admin.php', 'store.php', 'admin-google.php', 'api.php', 'config-path.php', 'crm.php', 'profiles.php', 'support.php', 'returns.php', 'customer-auth.php', 'cron-auth.php', 'setup-admin.php', 'preflight.php', '.htaccess']
  const rows = []
  for (const f of files) {
    const lp = path.join(apiDir, f)
    if (!st(lp)) { rows.push(`${f}:absent-live`); continue }
    const lh = crypto.createHash('sha256').update(fs.readFileSync(lp)).digest('hex')
    const buf = await raw(BASE, `sporta-web/dropin/php-store/${f}`)
    rows.push(`${f}:${buf ? (crypto.createHash('sha256').update(buf).digest('hex') === lh ? 'same' : 'DIFF') : 'no-repo-copy'}`)
  }
  say(`live api/ vs repo @${BASE.slice(0, 8)}: ${rows.join(' ')}`)
  // What the site root's own .htaccess says about the admin.
  const ht = path.join(SITE, '.htaccess')
  if (st(ht)) {
    const t = fs.readFileSync(ht, 'utf8')
    say(`site/.htaccess ${t.length}B: backends rules=${(t.match(/^\s*RewriteRule \^backends.*$/gm) ?? []).length}, Header always set X-Robots-Tag(backends)=${/backends[^\n]*X-Robots-Tag|X-Robots-Tag[^\n]*backends/i.test(t)}, mentions setup-admin=${/setup-admin/.test(t)}`)
  }
  const apiHt = path.join(apiDir, '.htaccess')
  if (st(apiHt)) {
    const t = fs.readFileSync(apiHt, 'utf8')
    const m = /<FilesMatch "\^\(([^"]*)\)\$">\s*Require all denied/.exec(t)
    say(`api/.htaccess denies by name: ${m ? m[1].replace(/\\\./g, '.').slice(0, 330) : '(no FilesMatch deny found)'}`)
    const names = m ? m[1].replace(/\\\./g, '.').split('|') : []
    for (const fm of t.matchAll(/<Files "([^"]+)">\s*(?:#[^\n]*\n\s*)*Require all denied/g)) names.push(fm[1])
    const notDenied = apiFiles.filter((f) => f.endsWith('.php') && !names.includes(f) && !names.some((n) => n.includes('*') && new RegExp(`^${n}$`).test(f)))
    say(`api/*.php NOT denied by that rule (reachable): ${notDenied.join(' ')}`)
  }
}

// ===================================================================== 9
head('9. n8n / webhook references reachable from the web root')
{
  const needles = /n8n|webhook|hooks\.|zapier|make\.com/i
  const hitsFiles = []
  const scan = (dir, depth = 0) => {
    if (depth > 2 || !fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'backups' || e.name === 'node_modules') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) scan(p, depth + 1)
      else if (/\.(js|html|json|css|txt|xml|webmanifest)$/.test(e.name) && e.isFile() && fs.statSync(p).size < 4e6) {
        const t = fs.readFileSync(p, 'utf8')
        const m = t.match(new RegExp(needles.source, 'gi'))
        if (m) hitsFiles.push(`${p.replace(SITE + '/', '')}(${m.length}:${[...new Set(m.map((x) => x.toLowerCase()))].join('/')})`)
      }
    }
  }
  scan(SITE)
  say(`web-root text files mentioning n8n/webhook: ${hitsFiles.slice(0, 20).join(' ') || '(none)'}`)
  const hostsSeen = new Set()
  for (const [, t] of bundleOf) for (const m of t.matchAll(/https?:\/\/[a-z0-9.-]*n8n[a-z0-9.-]*[^\s"'`]*/gi)) hostsSeen.add(m[0].slice(0, 80))
  say(`n8n URLs written in the JS: ${[...hostsSeen].join(' ') || '(none)'}`)
}

head('SUMMARY')
say(`requests: ${count}${stopped ? ' (STOPPED AT A 429)' : ''}`)
for (const f of FIND) say(f)
say('SEC_ADMIN_DONE')
