#!/usr/bin/env node
// JSON SCAN — everything www.sporta.com.kw answers in JSON, checked from the VPS.
//
// Same transport as live-scan.mjs (requests go to this machine's own Traefik
// with the real Host header and SNI). It asks of every JSON answer what a
// browser and an attacker would both notice:
//   * is it JSON — parseable, nothing before it (a BOM, a PHP warning, HTML);
//   * is it LABELLED JSON — application/json; charset=utf-8, nosniff, and
//     no-store for live data;
//   * does it say only what it should — no cost, hash, token, secret or
//     personal field in a public answer, no stack trace, no server path;
//   * does an error come back as a JSON error with a 4xx, not a 500 or HTML;
//   * is Arabic intact (real letters, not "????" from a wrong charset);
//   * does ?callback= stay inert (no JSONP wrapping).
// Plus the JSON that is not the API: both web manifests, the JSON-LD blocks
// in the pages, and any .json/.map file in the web root (a source map would
// hand anyone the original code).
//
// READ-ONLY. Nothing here can create an order, an account, a ticket or a
// review: the only POSTs are bodies the server refuses at validation, before
// any write. (Each request does tick the rate limiter, as any visit does.)
//
//   node scripts/vps-deploy.mjs compose --scan json
//   SPORTA_SCAN_BASE=http://127.0.0.1:8121 SPORTA_SCAN_ROOT=/tmp/site node scripts/json-scan.mjs
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'

const HOST = 'www.sporta.com.kw'
const BASE = process.env.SPORTA_SCAN_BASE ?? ''
const ROOT = process.env.SPORTA_SCAN_ROOT ?? '/sporta/site'

let bad = 0, warn = 0
const ok = (s) => console.log(`ok   ${s}`)
const w = (s) => { warn++; console.log(`WARN ${s}`) }
const b = (s) => { bad++; console.log(`BAD  ${s}`) }
const head = (s) => console.log(`\n== ${s}`)

function request(p, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const base = BASE ? new URL(BASE) : null
    const lib = base ? http : https
    const started = Date.now()
    const req = lib.request({
      host: base ? base.hostname : '127.0.0.1', port: base ? Number(base.port) : 443,
      path: p, method,
      headers: { Host: HOST, 'User-Agent': 'sporta-json-scan', 'Accept-Encoding': 'identity',
        ...(body !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers },
      timeout: 20000,
      ...(base ? {} : { servername: HOST, checkServerIdentity: (_h, c) => tls.checkServerIdentity(HOST, c) }),
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), ms: Date.now() - started })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, buf: Buffer.alloc(0), text: e.message, ms: 0 }))
    if (body !== null) req.write(body)
    req.end()
  })
}

// Field names a PUBLIC answer must never carry. Matched on keys, not values,
// so a product called "Token Tee" is not a finding.
const SECRET_KEY = /(^|_)(cost|cost_aed|unit_cost|unit_cost_kwd|wholesale|password|pass|hash|token|secret|api_key|session|ip|phone|email|address|customer_name)(_|$)/i
const walkKeys = (v, at = '$', out = []) => {
  if (Array.isArray(v)) v.slice(0, 50).forEach((x, i) => walkKeys(x, `${at}[${i}]`, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push([`${at}.${k}`, k]); walkKeys(x, `${at}.${k}`, out) }
  return out
}
const TRACE = /SQLSTATE|Fatal error|Stack trace|Warning:|Notice:|Deprecated:|\/var\/www|\/run\/sporta|<br \/>|PDOException/i

// One JSON answer, every property checked. `expect` = the statuses that are
// right for this probe; `pub` = a public answer, so field names are policed.
// `soft` = statuses that are a warning, not a failure (a feature switched off
// answers 503 rather than leaking anything).
async function probe(label, p, { expect = [200], soft = [], pub = true, opts = {}, store = true, nullOk = false } = {}) {
  const r = await request(p, opts)
  const ct = String(r.headers['content-type'] ?? '')
  const issues = []
  const isSoft = soft.includes(r.status)
  if (!expect.includes(r.status) && !isSoft) issues.push(`status ${r.status} (want ${expect.join('/')})`)
  if (!/^application\/json;\s*charset=utf-8$/i.test(ct)) issues.push(`content-type "${ct || 'none'}"`)
  // nosniff and no-store are api/.htaccess's job; php -S in the tests has none.
  if (!BASE && r.headers['x-content-type-options'] !== 'nosniff') issues.push('no nosniff')
  if (!BASE && store && !/no-store/.test(String(r.headers['cache-control'] ?? ''))) issues.push(`cache-control "${r.headers['cache-control'] ?? 'none'}"`)
  if (r.buf[0] === 0xef && r.buf[1] === 0xbb && r.buf[2] === 0xbf) issues.push('starts with a BOM')
  else if (/^\s/.test(r.text)) issues.push('whitespace before the JSON')
  let json, parsed = false
  try { json = JSON.parse(r.text); parsed = true } catch { issues.push(`not JSON: ${r.text.slice(0, 60).replace(/\s+/g, ' ')}`) }
  if (TRACE.test(r.text)) issues.push('error trace or server path in the body')
  if (parsed && r.status >= 400 && !(json && typeof json.error === 'string')) issues.push('error without an {"error": "..."} token')
  // "Not found" for a lookup is a 200 null — nothing to tell apart, by design.
  if (parsed && nullOk && r.status === 200 && json !== null) issues.push('a made-up id returned data')
  if (parsed && pub) {
    const leaks = [...new Set(walkKeys(json).filter(([, k]) => SECRET_KEY.test(k)).map(([, k]) => k))]
    if (leaks.length) issues.push(`private-looking fields: ${leaks.join(', ')}`)
  }
  const size = r.buf.length > 4096 ? `${Math.round(r.buf.length / 1024)} kB` : `${r.buf.length} B`
  if (issues.length) b(`${label} -> ${r.status} · ${issues.join(' · ')}`)
  else if (isSoft) w(`${label} -> ${r.status}${parsed && json?.error ? ` · ${json.error}` : ''} — the feature is switched off or not installed`)
  else ok(`${label} -> ${r.status} · ${size} · ${r.ms} ms${parsed && r.status >= 400 ? ` · ${json.error}` : ''}`)
  return { r, json }
}
const post = (body) => ({ method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

// ================================================================ 1. reads
head('1. Public reads')
if (BASE) w('nosniff / no-store checks skipped under SPORTA_SCAN_BASE (php -S reads no .htaccess)')
const reach = await request('/')
if (reach.status === 0) {
  b(`cannot reach ${HOST} (${reach.text}) — nothing below would mean anything`)
  console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
  process.exit(1)
}
const { json: products } = await probe('?r=products', '/api/api.php?r=products')
const { json: stock } = await probe('?r=stock', '/api/api.php?r=stock')
await probe('?r=slides', '/api/api.php?r=slides')
await probe('?r=brands', '/api/api.php?r=brands')
await probe('?r=theme', '/api/api.php?r=theme')
await probe('?r=checkout_config', '/api/api.php?r=checkout_config')

head('2. Content of the catalogue')
if (Array.isArray(products) && products.length) {
  ok(`${products.length} products`)
  const ar = products.filter((p) => /[؀-ۿ]/.test(String(p.name_ar ?? '')))
  const broken = products.filter((p) => /\?{3,}|Ã|Ø§/.test(`${p.name_ar ?? ''}${p.desc_ar ?? ''}`))
  ar.length === products.length ? ok('every name_ar is real Arabic text') : b(`${products.length - ar.length} products without Arabic name_ar`)
  broken.length ? b(`${broken.length} products with mojibake in Arabic fields (e.g. ${broken[0].slug})`) : ok('no mojibake (????, Ã, Ø§) in Arabic fields')
  const badPrice = products.filter((p) => typeof p.price !== 'number' || !(p.price > 0))
  badPrice.length ? b(`${badPrice.length} products without a positive numeric price (e.g. ${badPrice[0].slug})`) : ok('every price is a positive number')
  const sale = products.filter((p) => p.on_sale)
  const wrong = sale.filter((p) => !(p.list_price > p.price))
  wrong.length ? b(`${wrong.length} "on sale" prices not below list price (e.g. ${wrong[0].slug})`)
    : ok(`${sale.length} on sale, every one below its list price`)
  const slugs = new Set(products.map((p) => p.slug))
  slugs.size === products.length ? ok('slugs are unique') : b('duplicate slugs')
  ;products.some((p) => 'sale_starts_at' in p || 'sale_ends_at' in p) ? b('sale windows reach the browser') : ok('sale windows stay on the server')
  if (Array.isArray(stock)) {
    const orphan = stock.filter((s) => s.slug && !slugs.has(s.slug))
    orphan.length ? w(`${orphan.length} stock rows for products not in the catalogue (e.g. ${orphan[0].slug})`) : ok(`${stock.length} stock rows, all for listed products`)
  }
} else b('the catalogue is empty or not a list')

// ========================================================= 3. refusals
head('3. Refusals come back as JSON errors')
await probe('unknown route', '/api/api.php?r=no_such_route_zz', { expect: [404] })
await probe('no route at all', '/api/api.php', { expect: [400, 404] })
await probe('GET on a POST route (order)', '/api/api.php?r=order', { expect: [404, 405, 400] })
await probe('order, empty body', '/api/api.php?r=order', { expect: [400, 415, 422], opts: post({}) })
await probe('order, not JSON', '/api/api.php?r=order', { expect: [400, 415], opts: post('this is not json') })
await probe('order, oversized', '/api/api.php?r=order', { expect: [400, 413], opts: post({ items: Array.from({ length: 500 }, () => ({ slug: 'x', qty: 1 })) }) })
await probe('status, unknown order', '/api/api.php?r=status&id=SPSCANNOSUCH000', { expect: [200, 404, 400], nullOk: true })
await probe('invoice, unknown order', '/api/api.php?r=invoice&id=SPSCANNOSUCH000', { expect: [200, 404, 400, 403], nullOk: true })
await probe('review_invite, forged', '/api/api.php?r=review_invite&t=forged', { expect: [400, 403, 404] })
await probe('discount, empty basket', '/api/api.php?r=discount', { expect: [400, 404, 422], opts: post({ items: [], code: '' }) })

head('4. Signed-out account and admin endpoints')
await probe('admin ?r=me', '/api/admin.php?r=me', { expect: [200], opts: { headers: { 'X-Sporta-Admin': '1' } } })
await probe('admin ?r=orders, no session', '/api/admin.php?r=orders', { expect: [401, 403], opts: { headers: { 'X-Sporta-Admin': '1' } } })
await probe('admin ?r=orders, no CSRF header', '/api/admin.php?r=orders', { expect: [401, 403] })
await probe('customer ?r=me', '/api/customer.php?r=me', { expect: [200, 401] })
await probe('customer ?r=orders, no session', '/api/customer.php?r=orders', { expect: [401, 403] })
await probe('birthday ?r=get, no session', '/api/birthday.php?r=get', { expect: [401, 403, 400], soft: [503] })

head('5. ?callback= is inert')
{
  const r = await request('/api/api.php?r=theme&callback=alert')
  ;/^\s*[[{]/.test(r.text) && !/^\s*alert\s*\(/.test(r.text) ? ok('no JSONP wrapping') : b(`?callback= changes the body: ${r.text.slice(0, 40)}`)
  const cors = r.headers['access-control-allow-origin']
  cors ? b(`Access-Control-Allow-Origin: ${cors} — the API is same-origin by design`) : ok('no CORS header — same-origin only')
}

// ===================================================== 6. not the API
head('6. Manifests')
for (const m of ['/site.webmanifest', '/backends.webmanifest']) {
  const r = await request(m)
  if (r.status !== 200) { b(`${m} -> ${r.status}`); continue }
  let j
  try { j = JSON.parse(r.text) } catch { b(`${m} is not valid JSON`); continue }
  const ct = String(r.headers['content-type'] ?? '')
  ;/application\/manifest\+json/.test(ct) ? ok(`${m} ${ct}`) : w(`${m} content-type "${ct}"`)
  const missing = ['name', 'start_url', 'display', 'icons'].filter((k) => !j[k])
  missing.length ? b(`${m} lacks ${missing.join(', ')}`) : ok(`${m}: "${j.name}", start ${j.start_url}, ${j.display}, ${j.icons.length} icons`)
  for (const icon of j.icons ?? []) {
    const ir = await request(new URL(icon.src, `https://${HOST}${m}`).pathname)
    ir.status === 200 ? ok(`  icon ${icon.src} ${icon.sizes ?? ''}`) : b(`  icon ${icon.src} -> ${ir.status}`)
  }
}

head('7. JSON-LD in the pages')
for (const p of ['/', '/shop', `/product/${Array.isArray(products) && products[0] ? products[0].slug : 'cloudsoft-jacket-army-green'}`]) {
  const r = await request(p)
  const blocks = [...r.text.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  if (!blocks.length) { w(`${p}: no JSON-LD in the served HTML`); continue }
  let good = 0
  const types = []
  for (const blk of blocks) {
    try {
      const j = JSON.parse(blk)
      const items = Array.isArray(j) ? j : j['@graph'] ?? [j]
      for (const it of items) types.push(it['@type'])
      if ((Array.isArray(j) ? j[0] : j)['@context']) good++
    } catch { b(`${p}: a JSON-LD block does not parse`) }
  }
  good === blocks.length ? ok(`${p}: ${blocks.length} block(s), ${[...new Set(types.flat())].join(', ')}`) : w(`${p}: ${blocks.length - good} block(s) without @context`)
}

head('8. JSON and source maps in the web root')
if (!fs.existsSync(path.join(ROOT, 'index.html'))) w(`${ROOT} not mounted — skipped`)
else {
  const found = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else if (/\.(json|jsonl|map)$/i.test(e.name)) found.push(path.relative(ROOT, abs))
    }
  }
  walk(ROOT)
  if (!found.length) ok('no .json, .jsonl or .map files on disk — the site ships none')
  for (const f of found.slice(0, 20)) {
    const r = await request(`/${f}`)
    r.status === 200 ? b(`/${f} is SERVED (${r.buf.length} B)${/\.map$/.test(f) ? ' — a source map is the original code' : ''}`)
      : w(`/${f} on disk (answers ${r.status}) — should not be in the web root`)
  }
}

console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
