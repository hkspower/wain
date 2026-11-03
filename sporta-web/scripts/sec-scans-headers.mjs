#!/usr/bin/env node
// SEC-SCANS HEADERS — read-only response-header map of www.sporta.com.kw, per area.
//
// live-scan.mjs checks the security headers on "/" and prints each one cut to
// 100 characters. This prints them IN FULL for every area the .htaccess files
// treat differently (storefront, hashed assets, images, the store API, the
// admin API, the admin page, the card doors, an Apache-made 403 and 404), so a
// reviewer can judge the actual policy text, not the first 100 bytes of it.
//
// Runs on the VPS (a node:24-alpine job on the host network) and talks to the
// host's own Traefik on 127.0.0.1:443 with the real Host header and SNI, like
// live-scan.mjs. GET / HEAD / OPTIONS / TRACE only. No cookie value is ever
// printed (only the attribute flags), no credential is sent, no body is posted.
// About 40 requests with a short pause between them.
//
//   node scripts/sec-scans-headers.mjs
import https from 'node:https'
import http from 'node:http'

const HOST = 'www.sporta.com.kw'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

function request(path, { method = 'GET', headers = {}, plain = false, host = HOST, max = 4000 } = {}) {
  return new Promise((resolve) => {
    const lib = plain ? http : https
    const req = lib.request({
      host: '127.0.0.1', port: plain ? 80 : 443, path, method,
      headers: { Host: host, 'User-Agent': 'sporta-sec-scan', ...headers },
      timeout: 15000,
      ...(plain ? {} : { servername: host, checkServerIdentity: () => undefined }),
    }, (res) => {
      const chunks = []
      let n = 0
      res.on('data', (c) => { if (n < max) { chunks.push(c); n += c.length } })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, raw: [], text: 'timeout' }) })
    req.on('error', (e) => resolve({ status: 0, headers: {}, raw: [], text: `error ${e.code ?? e.message}` }))
    req.end()
  })
}

const SHOW = [
  'content-security-policy', 'content-security-policy-report-only', 'strict-transport-security',
  'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy',
  'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cross-origin-embedder-policy',
  'x-robots-tag', 'cache-control', 'content-type', 'access-control-allow-origin',
  'access-control-allow-credentials', 'access-control-allow-methods', 'allow', 'server',
  'x-powered-by', 'via', 'x-xss-protection', 'location', 'vary',
]
// Cookie: attribute flags only. The value (a session id) is never printed.
const cookieFlags = (c) => (Array.isArray(c) ? c : [c]).filter(Boolean).map((v) => {
  const [nameval, ...attrs] = String(v).split(';')
  return `${nameval.split('=')[0]}=<value withheld>; ${attrs.map((a) => a.trim()).join('; ')}`
})

function dump(label, r) {
  console.log(`\n-- ${label} -> ${r.status}`)
  for (const h of SHOW) if (r.headers[h] !== undefined) console.log(`   ${h}: ${r.headers[h]}`)
  for (const c of cookieFlags(r.headers['set-cookie'])) console.log(`   set-cookie: ${c}`)
}

const AREAS = [
  ['storefront /', '/'],
  ['storefront /shop', '/shop'],
  ['unknown route (SPA 404)', '/this-page-does-not-exist-12345'],
  ['hashed asset', '/assets/index-BtzlNXGI.js'],
  ['logo', '/logo.png'],
  ['config.js', '/config.js'],
  ['sw.js', '/sw.js'],
  ['sitemap.xml', '/sitemap.xml'],
  ['robots.txt', '/robots.txt'],
  ['store API products', '/api/api.php?r=products'],
  ['store API theme', '/api/api.php?r=theme'],
  ['store API unknown route', '/api/api.php?r=nope'],
  ['admin API me (signed out)', '/api/admin.php?r=me'],
  ['admin API orders (signed out)', '/api/admin.php?r=orders'],
  ['customer API me', '/api/customer.php?r=me'],
  ['admin page /backends', '/backends'],
  ['card door /knet/pay.php', '/knet/pay.php'],
  ['card door /pay/pay.php', '/pay/pay.php'],
  ['Apache 403 (denied include)', '/api/store.php'],
  ['Apache 403 (denied config)', '/knet/config.php'],
  ['Apache 404 (no such file in api/)', '/api/nope-9876.php'],
  ['Apache 404 (no such file in knet/)', '/knet/nope-9876.php'],
  ['uploaded images dir', '/images/products/'],
]

console.log('== SEC-SCANS HEADERS (read-only, full header text)')
for (const [label, p] of AREAS) {
  const r = await request(p)
  dump(label, r)
  await pause(150)
}

// Bodies of the Apache-made error pages: do they sign the server with a version?
console.log('\n== Error page bodies (first 300 chars)')
for (const p of ['/api/store.php', '/api/nope-9876.php', '/knet/config.php']) {
  const r = await request(p, { max: 600 })
  console.log(`-- ${p} -> ${r.status}: ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`)
  await pause(150)
}

// CORS: does any API answer a foreign Origin with an allow header?
console.log('\n== CORS (Origin: https://evil.example)')
for (const p of ['/api/api.php?r=products', '/api/admin.php?r=me', '/api/customer.php?r=me']) {
  for (const method of ['GET', 'OPTIONS']) {
    const r = await request(p, {
      method,
      headers: { Origin: 'https://evil.example', ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-sporta-admin' } : {}) },
    })
    console.log(`-- ${method} ${p} -> ${r.status} ACAO=${r.headers['access-control-allow-origin'] ?? '(none)'} ACAC=${r.headers['access-control-allow-credentials'] ?? '(none)'} ACAM=${r.headers['access-control-allow-methods'] ?? '(none)'} allow=${r.headers.allow ?? '(none)'}`)
    await pause(150)
  }
}

// Methods: TRACE must be refused; OPTIONS on the root; HEAD parity.
console.log('\n== Methods')
for (const [m, p] of [['TRACE', '/'], ['TRACE', '/api/api.php?r=products'], ['OPTIONS', '/'], ['HEAD', '/'], ['HEAD', '/api/api.php?r=products']]) {
  const r = await request(p, { method: m })
  console.log(`-- ${m} ${p} -> ${r.status} allow=${r.headers.allow ?? '(none)'} body=${r.text.replace(/\s+/g, ' ').slice(0, 80)}`)
  await pause(150)
}

// Host header handling: unknown Host and the bare server name must not serve the shop.
console.log('\n== Host header')
for (const host of ['evil.example', '187.7.78.123', 'sporta.com.kw']) {
  const r = await request('/', { host, headers: {} })
  console.log(`-- Host ${host} -> ${r.status} location=${r.headers.location ?? '(none)'} server=${r.headers.server ?? '(none)'}`)
  await pause(150)
}
// Same over plain HTTP.
for (const host of ['www.sporta.com.kw', 'sporta.com.kw', '187.7.78.123']) {
  const r = await request('/backends', { host, plain: true })
  console.log(`-- http Host ${host} /backends -> ${r.status} location=${r.headers.location ?? '(none)'}`)
  await pause(150)
}

console.log('\n== Done')
