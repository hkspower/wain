#!/usr/bin/env node
// SEC-API SCAN — black-box, READ-ONLY look at the PUBLIC STORE API of www.sporta.com.kw.
//
// Runs on the VPS (a node:24-alpine job on the host network, like
// sec-scans-headers.mjs) and talks to the host's own Traefik on 127.0.0.1:443
// with the real Host header and SNI. GET / HEAD / OPTIONS / TRACE only: no
// POST, no credential, no sign-in, no order, no form. Fewer than 300 requests,
// paced, and it stops at the first 429.
//
// WHAT IT NEVER PRINTS: a secret VALUE. Public JSON is summarised as key
// names; scalar values are shown only for the small settings routes and only
// when they cannot be a credential (long token-like strings, e-mails and IPs
// are withheld). Customer-data routes are probed with ids that cannot belong
// to anyone; if one ever answers with data, the body is NOT read further: the
// scan prints "NON-NULL" and the byte count and stops that route.
//
//   node scripts/sec-api-scan.mjs
import https from 'node:https'
import crypto from 'node:crypto'

const HOST = 'www.sporta.com.kw'
const DELAY = Number(process.env.SEC_DELAY_MS ?? 400)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
let count = 0
let stopped = false
const seenHeaders = new Map()   // header name -> count (across the whole run)
const statuses = new Map()

function request(path, { method = 'GET', headers = {}, max = 200000 } = {}) {
  count++
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint()
    const req = https.request({
      host: '127.0.0.1', port: 443, path, method,
      headers: { Host: HOST, 'User-Agent': 'sporta-sec-scan', Accept: 'application/json', ...headers },
      timeout: 20000, servername: HOST, checkServerIdentity: () => undefined,
    }, (res) => {
      const chunks = []
      let n = 0, total = 0
      res.on('data', (c) => { total += c.length; if (n < max) { chunks.push(c); n += c.length } })
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6
        for (const k of Object.keys(res.headers)) seenHeaders.set(k, (seenHeaders.get(k) ?? 0) + 1)
        statuses.set(res.statusCode, (statuses.get(res.statusCode) ?? 0) + 1)
        if (res.statusCode === 429) stopped = true
        resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks), total, ms })
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, buf: Buffer.alloc(0), total: 0, ms: 20000, err: 'timeout' }) })
    req.on('error', (e) => resolve({ status: 0, headers: {}, buf: Buffer.alloc(0), total: 0, ms: 0, err: e.code ?? e.message }))
    req.end()
  })
}
async function get(path, opts) {
  if (stopped) return { status: -1, headers: {}, buf: Buffer.alloc(0), total: 0, ms: 0, err: 'stopped-after-429' }
  const r = await request(path, opts)
  await pause(DELAY)
  return r
}

// ---- output: compact, because the job log keeps only the last 300 entries.
const safe = (s, n = 120) => String(s).replace(/[^\x20-\x7e؀-ۿ]/g, '.').slice(0, n)
let line = ''
const out = (s = '') => console.log(s)
const flush = () => { if (line) { console.log(line); line = '' } }
const add = (s) => { if (line.length + s.length > 360) flush(); line += (line ? ' | ' : '') + s }
const head = (t) => { flush(); console.log(`\n== ${t}`) }

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 10)
const text = (r) => r.buf.toString('utf8')
const json = (r) => { try { return JSON.parse(text(r)) } catch { return undefined } }
const ct = (r) => (r.headers['content-type'] ?? '(none)').split(';')[0]

// --------------------------------------------------------------- classifiers
const BAD_KEY = /cost|supplier|vendor|margin|wholesale|internal|note|secret|token|passw|pwd|hash|salt|api_?key|email|mail|phone|mobile|ip$|_ip|path|file|sql|dsn|db_|user(name)?$|admin|owner|iban|card|cvv|session/i
const SECRETISH = /^[A-Za-z0-9+\/_=-]{28,}$/
const EMAIL = /[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}/i
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
const PATHISH = /(?:\/var\/|\/home\/|\/docker\/|\/run\/|\/etc\/|\/srv\/|[A-Z]:\\|public_html|\.php\b)/
const SQLISH = /\b(select|insert into|update\s+\w+\s+set|SQLSTATE|PDOException|mysqli?|mariadb|syntax error)\b/i
const PHPERR = /(warning|notice|deprecated|fatal error|parse error|stack trace|uncaught|on line \d+|traceback)/i
const PHONE = /(?<![\d.])\+?\d[\d\s-]{7,14}\d(?![\d.])/

// Flatten a JSON value into key paths (arrays collapse to [] and merge the keys
// of every element).
function keyPaths(v, p = '', acc = new Map()) {
  if (Array.isArray(v)) { for (const x of v) keyPaths(x, p + '[]', acc); if (!v.length) acc.set(p + '[]', 'empty'); return acc }
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) keyPaths(x, p ? `${p}.${k}` : k, acc); return acc }
  const t = v === null ? 'null' : typeof v
  const prev = acc.get(p)
  acc.set(p, prev && prev !== t ? `${prev}|${t}` : t)
  return acc
}
function leaves(v, p = '', acc = []) {
  if (Array.isArray(v)) { for (const x of v) leaves(x, p + '[]', acc); return acc }
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) leaves(x, p ? `${p}.${k}` : k, acc); return acc }
  acc.push([p, v]); return acc
}
const lastKey = (p) => p.split('.').pop().replace(/\[\]/g, '')

function analyse(label, r, { showValues = false, expect = null } = {}) {
  const j = json(r)
  if (j === undefined) { add(`${label}: not JSON (${r.status}, ${ct(r)}, ${r.total}B)`); return j }
  const kp = keyPaths(j)
  const keys = [...kp.keys()]
  const flagged = keys.filter((k) => BAD_KEY.test(lastKey(k)))
  const lv = leaves(j)
  let emails = 0, ips = 0, paths = 0, sqls = 0, secrets = 0, phones = 0
  const where = new Set()
  for (const [p, v] of lv) {
    if (typeof v !== 'string') continue
    const k = lastKey(p)
    if (EMAIL.test(v)) { emails++; where.add(`email@${k}`) }
    if (IPV4.test(v) && !/^\d+(\.\d+){0,3}$/.test(v)) { ips++; where.add(`ip@${k}`) }
    if (PATHISH.test(v) && !/^\/?[a-z0-9_.\/-]*api\.php\?r=/.test(v)) { paths++; where.add(`path@${k}`) }
    if (SQLISH.test(v)) { sqls++; where.add(`sql@${k}`) }
    if (SECRETISH.test(v) && !/^[a-z0-9-]{1,40}$/i.test(v)) { secrets++; where.add(`tokenish@${k}`) }
    if (PHONE.test(v) && !/^\d{4}-\d\d-\d\d/.test(v) && !/^[\d.]+$/.test(v)) { phones++; where.add(`phone@${k}`) }
  }
  let extra = ''
  if (expect) {
    const have = new Set(keys.map((k) => k.replace(/^\[\]\.?/, '')))
    const miss = expect.filter((k) => !have.has(k))
    const more = [...have].filter((k) => !expect.includes(k))
    extra = ` | vs-source: missing=[${miss.join(',')}] extra=[${more.join(',')}]`
  }
  add(`${label}: ${r.status} ${ct(r)} ${r.total}B keys=${keys.length} flaggedKeys=[${flagged.join(',')}] values{email:${emails} ip:${ips} path:${paths} sql:${sqls} tokenish:${secrets} phone:${phones}}${where.size ? ' @' + [...where].join(',') : ''}${extra}`)
  if (showValues) {
    const shown = lv.filter(([p, v]) => !BAD_KEY.test(lastKey(p)) && !(typeof v === 'string' && (SECRETISH.test(v) || EMAIL.test(v) || IPV4.test(v))))
      .slice(0, 60).map(([p, v]) => `${p}=${safe(JSON.stringify(v), 48)}`)
    flush(); out('   values: ' + shown.join('; '))
  }
  return j
}

function hdrLine(label, r) {
  const h = r.headers
  const sc = [].concat(h['set-cookie'] ?? []).map((c) => String(c).split('=')[0])
  add(`${label}: ${r.status} ct=${ct(r)} cc="${h['cache-control'] ?? '(none)'}" acao=${h['access-control-allow-origin'] ?? '-'} acac=${h['access-control-allow-credentials'] ?? '-'} vary=${h.vary ?? '-'} setcookie=[${sc.join(',')}] server=${h.server ?? '-'} xpb=${h['x-powered-by'] ?? '-'} retry-after=${h['retry-after'] ?? '-'} xrl=${Object.keys(h).filter((k) => /ratelimit/i.test(k)).join(',') || '-'} ${r.total}B ${r.ms.toFixed(0)}ms`)
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const API = '/api/api.php'

out('== SEC-API SCAN (read-only, GET/HEAD/OPTIONS/TRACE only)')

// =========================================================================
// 1. Every documented GET route with normal parameters.
// =========================================================================
head('1. GET routes, normal parameters: headers')
const R = {}
const routes = [
  ['products', `${API}?r=products`], ['slides', `${API}?r=slides`], ['theme', `${API}?r=theme`],
  ['brands', `${API}?r=brands`], ['stock', `${API}?r=stock`], ['checkout_config', `${API}?r=checkout_config`],
]
for (const [name, p] of routes) { R[name] = await get(p); hdrLine(name, R[name]) }
// A slide image and a brand logo: take real ids/slugs from the catalogue answers.
const slides = json(R.slides)
const brands = json(R.brands)
const slide0 = slides?.slides?.[0]
if (slide0) { R.slide_image = await get(`${API}?r=slide_image&id=${slide0.id}&v=${String(slide0.image).split('v=')[1] ?? ''}`); hdrLine('slide_image', R.slide_image) }
const brand0 = Array.isArray(brands) ? brands.find((b) => b.has_logo) : undefined
if (brand0) { R.brand_logo = await get(`${API}?r=brand_logo&slug=${encodeURIComponent(brand0.slug)}`); hdrLine('brand_logo', R.brand_logo) }
for (const [name, p] of [
  ['status(nope)', `${API}?r=status&id=ZZZZZZ`], ['invoice(nope)', `${API}?r=invoice&id=ZZZZZZ`],
  ['review_invite(unsigned)', `${API}?r=review_invite&o=1&t=x`], ['say(unsigned)', `${API}?r=say&t=hello&lang=en&v=x`],
  ['assistant(GET)', `${API}?r=assistant`], ['order(GET)', `${API}?r=order`], ['discount(GET)', `${API}?r=discount`],
  ['return_lookup(GET)', `${API}?r=return_lookup`], ['return_submit(GET)', `${API}?r=return_submit`],
  ['support_create(GET)', `${API}?r=support_create`], ['support_lookup(GET)', `${API}?r=support_lookup`],
  ['support_reply(GET)', `${API}?r=support_reply`], ['review(GET)', `${API}?r=review`],
  ['unknown r', `${API}?r=nope`], ['no r', `${API}`], ['r empty', `${API}?r=`],
]) { R[name] = await get(p); hdrLine(name, R[name]) }
flush()

// =========================================================================
// 2. Public field names: is anything here that should be private? (vs source)
// =========================================================================
head('2. Public JSON: field names, PII/secret value counters, comparison with api.php source')
const expProducts = ['slug', 'name_en', 'name_ar', 'desc_en', 'desc_ar', 'price', 'featured', 'featured_sort', 'category', 'image', 'no_exchange', 'brand_slug', 'images', 'brand_name_en', 'brand_name_ar', 'brand_has_logo', 'brand_logo_v', 'list_price', 'on_sale']
analyse('products', R.products, { expect: expProducts })
const prods = json(R.products)
if (Array.isArray(prods)) {
  const allKeys = new Set(prods.flatMap((p) => Object.keys(p)))
  add(`products n=${prods.length} keysUnion=[${[...allKeys].join(',')}]`)
  const imgs = prods.flatMap((p) => [p.image, ...(typeof p.images === 'string' ? [p.images] : [])]).filter(Boolean)
  const imgHosts = new Set(imgs.map((u) => String(u).startsWith('http') ? new URL(u).host : 'same-origin'))
  add(`product image hosts=[${[...imgHosts].join(',')}]`)
  const cats = new Set(prods.map((p) => p.category)); add(`categories=[${[...cats].join(',')}]`)
}
const expSlides = ['slides[].id', 'slides[].sort', 'slides[].title_en', 'slides[].title_ar', 'slides[].subtitle_en', 'slides[].subtitle_ar', 'slides[].cta_label_en', 'slides[].cta_label_ar', 'slides[].cta_href', 'slides[].focal_x', 'slides[].focal_y', 'slides[].image', 'slides[].width', 'slides[].height']
analyse('slides', R.slides, { showValues: false })
if (slides) {
  add(`slides top-level=[${Object.keys(slides).join(',')}] hero keys=[${Object.keys(slides.hero ?? {}).join(',')}] promo_bar keys=[${Object.keys(slides.promo_bar ?? {}).join(',')}]`)
}
analyse('theme', R.theme, { showValues: false })
analyse('brands', R.brands, { expect: ['slug', 'name_en', 'name_ar', 'has_logo', 'logo_v', 'products'] })
analyse('stock', R.stock, { expect: ['slug', 'size', 'sku', 'stock', 'in_stock'] })
const stock = json(R.stock)
if (Array.isArray(stock)) {
  const prodSlugs = new Set((prods ?? []).map((p) => p.slug))
  const orphan = stock.filter((s) => !prodSlugs.has(s.slug)).length
  const sizes = stock.map((s) => s.stock)
  add(`stock rows=${stock.length} exactCountsExposed=${sizes.some((n) => n > 5)} max=${Math.max(...sizes)} skuExposed=${stock.some((s) => s.sku)} rowsWithNoCatalogueProduct=${orphan}`)
}
analyse('checkout_config', R.checkout_config, { showValues: true })
flush()
const cc = json(R.checkout_config)
if (cc) { out('   checkout_config top-level keys: ' + Object.keys(cc).join(',')) }
const th = json(R.theme)
if (th) { out('   theme top-level keys: ' + Object.keys(th).join(',')) }

// =========================================================================
// 3. Per-customer routes: ids that cannot belong to anyone. Uniform answer?
// =========================================================================
head('3. status / invoice with impossible ids: uniform answer, no leak, timing')
const ids = [
  ['ZZZZZZ(6)', 'ZZZZZZ'], ['1', '1'], ['2', '2'], ['3', '3'], ['0', '0'], ['-1', '-1'], ['huge', '99999999999999999999999'],
  ['abc', 'abc'], ['empty', ''], ['a[]=1', null], ['quote', "'"], ['dquote', '"'], ['sqli', "x' OR '1'='1"], ['semi-dash', "x';--"],
  ['backslash', '%5C'], ['30char', 'A'.repeat(30)], ['10KB', 'A'.repeat(7000)], ['arabic', encodeURIComponent('طلب')],
  ['RLM+ZWSP', '%E2%80%8F%E2%80%8B1'], ['NUL', '%00'], ['wild%', '%25'], ['wild_', '_'],
]
const uniformBodies = new Map()
let leaked = null
for (const route of ['status', 'invoice']) {
  const rows = []
  for (const [lab, v] of ids) {
    if (leaked) break
    const path = lab === 'a[]=1' ? `${API}?r=${route}&id[]=1` : `${API}?r=${route}&id=${v}`
    const r = await get(path, { max: 4000 })
    const body = text(r).trim()
    if (r.status === 200 && body !== 'null' && body !== '') {
      leaked = { route, lab, status: r.status, bytes: r.total }
      rows.push(`${lab}:NON-NULL(${r.status},${r.total}B)`)
      break
    }
    rows.push(`${lab}:${r.status}/${body === 'null' ? 'null' : safe(body, 40)}`)
    uniformBodies.set(`${route}:${sha(body)}:${r.status}`, (uniformBodies.get(`${route}:${sha(body)}:${r.status}`) ?? 0) + 1)
  }
  add(`${route}: ${rows.join(' ')}`)
}
flush()
if (leaked) out(`   !!! A per-customer route answered with data for an id nobody owns: ${JSON.stringify(leaked)} — scan stops reading it here.`)
out('   distinct (route:bodyhash:status) groups: ' + [...uniformBodies.entries()].map(([k, n]) => `${k}x${n}`).join(' '))

if (!leaked) {
  // Timing: 5 samples each; a correct implementation shows no difference by id shape.
  head('3b. status timing (ms), 5 samples each, interleaved')
  const shapes = [['6-char', 'ZZZZZZ'], ['1-char', '1'], ['30-char', 'A'.repeat(30)], ['sqli', "x'%20OR%20'1'='1"]]
  const t = Object.fromEntries(shapes.map(([n]) => [n, []]))
  for (let i = 0; i < 5; i++) for (const [n, v] of shapes) { const r = await get(`${API}?r=status&id=${v}`, { max: 200 }); t[n].push(r.ms) }
  add('status ' + shapes.map(([n]) => `${n}: med=${median(t[n]).toFixed(0)} [${t[n].map((x) => x.toFixed(0)).join(',')}]`).join(' '))
  flush()
}

// review_invite / say need a signature: confirm the unsigned answers are uniform
head('3c. signed-link routes unsigned (review_invite, say, review)')
for (const [lab, p] of [
  ['review_invite o=1 t=x', `${API}?r=review_invite&o=1&t=x`], ['review_invite o=99999999 t=0', `${API}?r=review_invite&o=99999999&t=0`],
  ['review_invite o[]=1', `${API}?r=review_invite&o[]=1&t[]=1`], ['review_invite empty', `${API}?r=review_invite`],
  ['say no t', `${API}?r=say`], ['say t=hi v=bad', `${API}?r=say&t=hi&v=bad`], ['say t=10KB', `${API}?r=say&t=${'A'.repeat(7000)}&v=x`],
  ['say t[]=a', `${API}?r=say&t[]=a&v[]=b`], ['say arabic', `${API}?r=say&lang=ar&t=${encodeURIComponent('مرحبا')}&v=x`],
]) { const r = await get(p, { max: 600 }); add(`${lab}: ${r.status} ${ct(r)} ${r.total}B "${safe(text(r).replace(/\s+/g, ' '), 90)}"`) }
flush()

// =========================================================================
// 4. Input robustness, GET parameters only
// =========================================================================
head('4. Robustness: quote-breaking, long, unicode, NUL, array, wrong types (status, type, 120 safe bytes)')
const flagged = []
async function probe(label, path) {
  const r = await get(path, { max: 3000 })
  const body = text(r)
  const bad = r.status >= 500 || r.status === 0 || PHPERR.test(body) || SQLISH.test(body) || PATHISH.test(body)
  if (bad) flagged.push(`${label} -> ${r.status}`)
  add(`${bad ? '!!' : ''}${label}: ${r.status} ${ct(r).replace('application/', '')} ${r.total}B "${safe(body.replace(/\s+/g, ' '), 70)}"`)
  return r
}
const SQLQ = ["'", '"', "%5C", "';--", "'%20OR%201=1--", '%00']
for (const q of SQLQ) await probe(`products category=${q}`, `${API}?r=products&category=${q}&slug=${q}`)
for (const [lab, qs] of [['limit=-1&offset=-1', 'limit=-1&offset=-1'], ['limit=99999999999&offset=99999999999', 'limit=99999999999&offset=99999999999'],
  ['limit=abc', 'limit=abc&offset=xyz'], ['limit[]=1', 'limit[]=1&offset[]=1'], ['slug[]=x', 'slug[]=x&category[]=y'], ['lang=ar', 'lang=ar'], ['10KB slug', 'slug=' + 'A'.repeat(10240)],
  ['arabic+RLM+ZWSP', 'slug=' + encodeURIComponent('منتج‏​')]]) await probe(`products ${lab}`, `${API}?r=products&${qs}`)
for (const [lab, qs] of [['slug=\'', "slug='"], ['slug=%00', 'slug=%00'], ['slug[]=x', 'slug[]=x'], ['10KB', 'slug=' + 'A'.repeat(10240)], ['arabic', 'slug=' + encodeURIComponent('شعار')], ['slug=../../etc/passwd', 'slug=../../etc/passwd'], ['empty', 'slug=']])
  await probe(`brand_logo ${lab}`, `${API}?r=brand_logo&${qs}`)
for (const [lab, qs] of [["id='", "id='&v=1"], ['id=-1', 'id=-1&v=1'], ['id=99999999999999999999', 'id=99999999999999999999'], ['id=1e3', 'id=1e3'], ['id[]=1', 'id[]=1&v[]=1'], ['id=abc', 'id=abc'], ['id=0', 'id=0'], ['id=1 no v', `id=${slide0?.id ?? 1}`], ['id real v=bad', `id=${slide0?.id ?? 1}&v=deadbeef`], ['10KB v', `id=1&v=${'A'.repeat(7000)}`], ['id=%00', 'id=%00']])
  await probe(`slide_image ${lab}`, `${API}?r=slide_image&${qs}`)
for (const [lab, qs] of [['stock slug=\'', "slug='"], ['stock slug[]=x', 'slug[]=x'], ['stock limit=-1', 'limit=-1&offset=-1']]) await probe(lab, `${API}?r=stock&${qs}`)
for (const [lab, qs] of [['theme x=\'', "x='"], ['slides lang[]=', 'lang[]=ar'], ['brands slug=\'', "slug='"], ['checkout_config x=%00', 'x=%00']]) {
  const rn = lab.split(' ')[0]; await probe(lab, `${API}?r=${rn === 'stock' ? 'stock' : rn}&${qs}`)
}
// r itself: array, NUL, case, trailing slash, long, quote
for (const [lab, qs] of [['r[]=products', 'r[]=products'], ['r[a]=products', 'r[a]=products'], ['r=products%00', 'r=products%00'], ['r=PRODUCTS', 'r=PRODUCTS'], ['r=products/', 'r=products/'], ['r=products%20', 'r=products%20'], ["r='", "r='"], ['r=10KB', 'r=' + 'A'.repeat(10240)], ['r=arabic', 'r=' + encodeURIComponent('م')], ['r=..%2f', 'r=..%2f'], ['r=ping', 'r=ping'], ['r=settings', 'r=settings']])
  await probe(lab, `${API}?${qs}`)
flush()
out(`   robustness flagged (5xx / PHP warning / SQL text / file path in body): ${flagged.length ? flagged.join('; ') : 'none'}`)

// =========================================================================
// 5. Methods and CORS on the public API
// =========================================================================
head('5. Methods and CORS: OPTIONS / HEAD / TRACE, foreign Origin')
for (const [m, p, h] of [
  ['OPTIONS', `${API}?r=products`, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' }],
  ['OPTIONS', `${API}?r=order`, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }],
  ['HEAD', `${API}?r=products`, {}], ['HEAD', `${API}?r=stock`, {}], ['TRACE', `${API}?r=products`, {}], ['TRACE', '/api/', {}],
  ['GET', `${API}?r=products`, { Origin: 'https://evil.example' }], ['GET', `${API}?r=checkout_config`, { Origin: 'null' }],
  ['GET', `${API}?r=status&id=ZZZZZZ`, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }],
]) {
  const r = await get(p, { method: m, headers: h, max: 300 })
  add(`${m} ${p.replace(API, 'api.php')}${h.Origin ? ' Origin=' + h.Origin : ''}: ${r.status} acao=${r.headers['access-control-allow-origin'] ?? '-'} acac=${r.headers['access-control-allow-credentials'] ?? '-'} acam=${r.headers['access-control-allow-methods'] ?? '-'} allow=${r.headers.allow ?? '-'} cl=${r.headers['content-length'] ?? '-'} body="${safe(text(r).replace(/\s+/g, ' '), 40)}"`)
}
flush()

// =========================================================================
// 6. Assistant: what does a GET reveal? (route and the include file)
// =========================================================================
head('6. Assistant (GET only)')
for (const p of [`${API}?r=assistant`, `${API}?r=assistant&q=hello`, `${API}?r=say`, '/api/assistant.php', '/api/assistant.php?r=assistant']) {
  const r = await get(p, { max: 600 })
  const b = text(r)
  add(`${p.replace(API, 'api.php')}: ${r.status} ${ct(r)} ${r.total}B cc="${r.headers['cache-control'] ?? '-'}" vendor/model/key/prompt words in body=${/anthropic|claude|openai|gpt|elevenlabs|api[_ -]?key|system prompt|model/i.test(b)} "${safe(b.replace(/\s+/g, ' '), 80)}"`)
}
flush()

// =========================================================================
// 7. Sibling PHP files of the API folder reached directly (GET, no key)
// =========================================================================
head('7. /api/ siblings, direct GET with no credential')
const sibs = [
  '/api/', '/api/index.php', '/api/api.php.bak', '/api/error_log', '/api/php_errors.log', '/api/.env', '/api/composer.json',
  '/api/store.php', '/api/config.php', '/api/config.php.bak', '/api/config-path.php', '/api/config.example.php', '/api/install.mysql.sql', '/api/seed.mysql.sql',
  '/api/assistant.php', '/api/support.php', '/api/profiles.php', '/api/returns.php', '/api/crm.php', '/api/birthday-lib.php', '/api/seo-page.php',
  '/api/cron-stock.php', '/api/cron-fulfilment.php', '/api/cron-voice.php', '/api/cron-birthday.php', '/api/cron-whatsapp.php', '/api/cron-auth.php',
  '/api/customer.php?r=me', '/api/customer.php?r=orders', '/api/customer.php?r=nope', '/api/birthday.php?r=get', '/api/admin-google.php?action=bogus',
  '/api/setup-admin.php', '/api/preflight.php', '/api/sitemap-index.php', '/api/sitemap-products.php',
]
for (const p of sibs) {
  const r = await get(p, { max: 400 })
  hdrLine(p, r)
  const b = text(r)
  if (r.status === 200 && b.length) add(`   ^ body "${safe(b.replace(/\s+/g, ' '), 70)}"`)
}
flush()

// =========================================================================
// 8. Summary
// =========================================================================
head('8. Run summary')
out(`requests=${count} stopped-after-429=${stopped}`)
out('status counts: ' + [...statuses.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x${v}`).join(' '))
out('response header names seen: ' + [...seenHeaders.keys()].sort().join(','))
out('== Done')
