#!/usr/bin/env node
// ROBOTS CHECK (lane C of the DNS / sitemap / robots review) - READ-ONLY.
//
// What it does, in order:
//   1. fetches the LIVE https://www.sporta.com.kw/robots.txt and compares it byte for byte with the repo copy
//      (fetched from raw.githubusercontent.com at ROBOTS_REPO_SHA, or the branch name when unset);
//   2. parses it with a robots.txt matcher implemented here to RFC 9309 / Google's documented behaviour
//      (self-tested at start-up, "SELFTEST n/n") and prints a URL x crawler matrix;
//   3. fetches headers (HEAD, GET for HTML) for the same URLs: status, X-Robots-Tag, <meta name=robots>;
//   4. checks the Sitemap: lines, sitemap URLs against the rules, llms.txt URLs against the rules;
//   5. reads index.html, the JS/CSS it loads and the API names the bundle calls, and tests every one of them
//      for Googlebot (the shop is client-rendered, so a blocked script or JSON endpoint is an empty page);
//   6. host variants: bare, http, and an arbitrary Host header sent to the VPS address on port 80.
//
// It only issues GET / HEAD requests, never signs in, never submits anything, never POSTs. Hard cap ROBOTS_CAP
// (default 280) requests to the live site; HEAD sweeps wait 100 ms between requests.
//
// RUN IT ON THE VPS (node:24-alpine): the only route to the live site from this project's sandbox is the Hostinger
// connector. Because it runs there, resolver / network-location dependent results (the redirects, the arbitrary
// Host probe that talks to 187.7.78.123:80 directly) are measured FROM the VPS itself.
//
//   node scripts/robots-check.mjs
//   (offline, matcher only)   node scripts/robots-check.mjs --selftest
//
// Output is compact on purpose (the connector keeps only the last 300 log lines). Lines starting FLAG are findings.
import crypto from 'node:crypto'
import http from 'node:http'

const env = process.env
const HOST = env.ROBOTS_HOST || 'www.sporta.com.kw'
const APEX = env.ROBOTS_APEX || 'sporta.com.kw'
const ORIGIN = 'https://' + HOST
const VPS_IP = env.ROBOTS_IP || '187.7.78.123'
const CAP = Number(env.ROBOTS_CAP || 280)
const SHA = env.ROBOTS_REPO_SHA || 'claude/sporta-integration-tveo8b'
const UA = 'sporta-robots-check/1 (read-only owner-requested check from the VPS)'

const P = (s) => console.log(String(s).slice(0, 700))
const H = (s) => console.log('## ' + s)
const flags = []
const flag = (id, msg) => { flags.push(id); P('FLAG ' + id + ' ' + msg) }
let spent = 0
const spend = () => { if (++spent > CAP) throw new Error('request budget exhausted (' + CAP + ')') }
const sleep = (n) => new Promise((r) => setTimeout(r, n))

// =====================================================================================================
// ROBOTS.TXT MATCHER (RFC 9309 + Google's documentation)
// =====================================================================================================
// Parsing: split on CRLF / LF / CR; strip a UTF-8 BOM; strip "#..." comments; "field: value" split at the first
// colon; field names are case-insensitive; values keep their case (paths are case-sensitive). Consecutive
// user-agent lines open one group; any rule line after them belongs to that group; a user-agent line after a
// rule line opens a NEW group. Unknown fields (sitemap, host, crawl-delay, ...) are collected and never end a group.
// Google merges every group whose user-agent is the same name into one set of rules.
export function parseRobots(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const groups = []
  const sitemaps = []
  const unknown = []
  let cur = null
  let lastWasUA = false
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const field = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (field === 'user-agent') {
      if (!cur || !lastWasUA) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur) }
      cur.agents.push(value.toLowerCase())
      lastWasUA = true
    } else if (field === 'allow' || field === 'disallow') {
      lastWasUA = false
      if (cur) cur.rules.push({ type: field, path: value })
    } else if (field === 'crawl-delay') {
      lastWasUA = false
      if (cur) cur.crawlDelay = value
    } else if (field === 'sitemap') {
      sitemaps.push(value)
    } else {
      unknown.push(field + ': ' + value)
    }
  }
  return { groups, sitemaps, unknown }
}

// Percent-encoding normalisation (RFC 9309 2.2.2): non-ASCII octets are percent-encoded as UTF-8, existing
// escapes get upper-case hex, reserved characters are NOT decoded ("%2F" stays "%2F", "/" stays "/").
export function normPath(p) {
  let out = ''
  for (let k = 0; k < p.length; k++) {
    const ch = p[k]
    if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(p.slice(k + 1, k + 3))) { out += '%' + p.slice(k + 1, k + 3).toUpperCase(); k += 2; continue }
    const cp = p.codePointAt(k)
    if (cp > 127) { out += [...Buffer.from(String.fromCodePoint(cp))].map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''); if (cp > 0xffff) k++; continue }
    out += ch
  }
  return out
}

function ruleRegex(pattern) {
  let p = normPath(pattern)
  let anchored = false
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1) }
  const re = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp('^' + re + (anchored ? '$' : ''))
}

// The crawler's own product token(s), most specific first. A named group beats the wildcard group, the wildcard
// is used only when no named group matched. `fallbacks` are the tokens a vendor documents as "also obeys".
export function selectRules(parsed, tokens, { useWildcard = true } = {}) {
  for (const tok of tokens) {
    const gs = parsed.groups.filter((g) => g.agents.includes(tok.toLowerCase()))
    if (gs.length) return { matched: tok, rules: gs.flatMap((g) => g.rules), crawlDelay: gs.map((g) => g.crawlDelay).find((x) => x != null) ?? null }
  }
  if (useWildcard) {
    const gs = parsed.groups.filter((g) => g.agents.includes('*'))
    if (gs.length) return { matched: '*', rules: gs.flatMap((g) => g.rules), crawlDelay: gs.map((g) => g.crawlDelay).find((x) => x != null) ?? null }
  }
  return { matched: null, rules: [], crawlDelay: null }
}

// Longest matching pattern wins (length of the pattern string, as Google counts it); on equal length Allow wins
// (the less restrictive rule); an empty Disallow allows everything and an empty Allow is ignored; no match = allowed.
export function decide(sel, pathAndQuery) {
  const target = normPath(pathAndQuery)
  let best = null
  for (const r of sel.rules) {
    if (r.path === '') continue
    if (!ruleRegex(r.path).test(target)) continue
    const len = r.path.length
    if (!best || len > best.len || (len === best.len && r.type === 'allow' && best.type !== 'allow')) best = { type: r.type, path: r.path, len }
  }
  if (!best) return { allowed: true, by: null }
  return { allowed: best.type === 'allow', by: best.type + ' ' + best.path }
}

// ---- matcher self-test (Google's documented examples + the traps this file could hit) ----
function selftest() {
  let ok = 0
  let n = 0
  const eq = (name, got, want) => { n++; if (got === want) ok++; else console.log('SELFTEST FAIL ' + name + ': got ' + got + ' want ' + want) }
  const mk = (txt, toks = ['bot'], opt) => (p) => decide(selectRules(parseRobots(txt), toks, opt), p).allowed
  let a = mk('User-agent: *\nDisallow: /\nAllow: /pub')
  eq('allow longer', a('/pub/x'), true); eq('disallow rest', a('/priv'), false)
  a = mk('User-agent: *\nAllow: /p\nDisallow: /p')
  eq('tie -> allow', a('/p'), true)
  a = mk('User-agent: *\nDisallow: /*.gif$')
  eq('$ anchor hit', a('/a/b.gif'), false); eq('$ anchor miss (query)', a('/a/b.gif?x=1'), true)
  a = mk('User-agent: *\nDisallow: /private*/x')
  eq('star middle', a('/private123/x'), false); eq('star middle miss', a('/priv/x'), true)
  a = mk('User-agent: *\nDisallow: /Foo')
  eq('case sensitive path', a('/foo'), true); eq('case sensitive hit', a('/Foo'), false)
  a = mk('User-agent: *\nDisallow:')
  eq('empty disallow', a('/anything'), true)
  a = mk('User-agent: *\nDisallow: /a\n\nUser-agent: bot\nAllow: /')
  eq('named group beats *', a('/a'), true)
  a = mk('User-agent: a\nUser-agent: bot\nDisallow: /x')
  eq('stacked user-agents share rules', a('/x'), false)
  a = mk('User-agent: bot\nDisallow: /x\n\nUser-agent: bot\nDisallow: /y')
  eq('same-name groups merged 1', a('/x'), false); eq('same-name groups merged 2', a('/y'), false)
  a = mk('User-agent: bot\r\nDisallow: /x # comment\r\nFoo: bar\r\nDisallow: /y')
  eq('crlf+comment+unknown does not end group', a('/y'), false); eq('comment stripped', a('/x'), false)
  a = mk('﻿User-agent: bot\nDisallow: /x')
  eq('BOM tolerated', a('/x'), false)
  a = mk('User-agent: *\nDisallow: /é')
  eq('non-ASCII normalised', a('/%C3%A9'), false)
  a = mk('User-agent: *\nDisallow: /%c3%a9')
  eq('hex case normalised', a('/%C3%A9'), false)
  a = mk('User-agent: *\nDisallow: /a%2Fb')
  eq('reserved %2F not decoded', a('/a/b'), true)
  a = mk('User-agent: *\nDisallow: /fish')
  eq('prefix match', a('/fish.html'), false); eq('prefix miss', a('/Fish'), true)
  a = mk('User-agent: *\nDisallow: /api/\nAllow: /api/api.php')
  eq('allow carve-out', a('/api/api.php?r=products'), true); eq('rest of api blocked', a('/api/admin.php'), false)
  a = mk('User-agent: *\nDisallow: /x', ['adsbot-google'], { useWildcard: false })
  eq('AdsBot ignores wildcard', a('/x'), true)
  a = mk('User-agent: googlebot\nDisallow: /g\nUser-agent: *\nDisallow: /w', ['googlebot-image', 'googlebot'])
  eq('image falls back to googlebot', a('/g'), false); eq('...not to *', a('/w'), true)
  console.log('SELFTEST ' + ok + '/' + n)
  return ok === n
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
if (!selftest()) { P('matcher self-test failed; refusing to report matrix results'); process.exit(1) }

// =====================================================================================================
// HTTP plumbing (fetch for the public host; node:http for the raw-IP Host probes)
// =====================================================================================================
async function req(url, { method = 'GET', headers = {}, max = 3e6 } = {}) {
  spend()
  const r = { url, method, status: 0, h: {}, body: Buffer.alloc(0), error: null }
  try {
    const res = await fetch(url, { method, redirect: 'manual', headers: { 'user-agent': UA, accept: '*/*', ...headers }, signal: AbortSignal.timeout(20000) })
    r.status = res.status
    for (const [k, v] of res.headers) r.h[k.toLowerCase()] = v
    if (method !== 'HEAD') {
      const ab = await res.arrayBuffer()
      r.body = Buffer.from(ab).subarray(0, max)
      r.bytes = ab.byteLength
    }
  } catch (e) { r.error = String(e.cause?.code || e.message || e) }
  return r
}

function rawHttp(hostHeader, path) {
  spend()
  return new Promise((resolve) => {
    const rq = http.request({ host: VPS_IP, port: 80, method: 'GET', path, headers: { host: hostHeader, 'user-agent': UA }, timeout: 15000 }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '' }))
    })
    rq.on('timeout', () => { rq.destroy(); resolve({ status: 0, location: 'timeout' }) })
    rq.on('error', (e) => resolve({ status: 0, location: String(e.code || e.message) }))
    rq.end()
  })
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const hdr = (r, k) => r.h[k] || ''

// =====================================================================================================
// 1. THE FILE ITSELF
// =====================================================================================================
H('1. robots.txt file')
const live = await req(ORIGIN + '/robots.txt')
const body = live.body
const liveText = body.toString('utf8')
P(`live: status ${live.status} bytes ${body.length} sha256 ${sha(body).slice(0, 16)} content-type "${hdr(live, 'content-type')}" cache-control "${hdr(live, 'cache-control')}" etag ${hdr(live, 'etag')} last-modified "${hdr(live, 'last-modified')}" content-encoding "${hdr(live, 'content-encoding')}" x-robots-tag "${hdr(live, 'x-robots-tag')}" location "${hdr(live, 'location')}"`)
P(`live bytes: BOM ${body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf} CRLF ${/\r\n/.test(liveText)} bareCR ${/\r(?!\n)/.test(liveText)} endsWithNewline ${liveText.endsWith('\n')} nonASCIIbytes ${[...body].filter((b) => b > 127).length} lines ${liveText.split(/\n/).length} validUTF8 ${!liveText.includes('�')}`)
if (live.status !== 200) flag('R-FILE', 'robots.txt is not 200 (' + live.status + ')')
if (!/^text\/plain/i.test(hdr(live, 'content-type'))) flag('R-CT', 'robots.txt content-type is not text/plain: ' + hdr(live, 'content-type'))
if (!/charset=utf-8/i.test(hdr(live, 'content-type'))) P('NOTE content-type has no charset=utf-8 (RFC 9309 says UTF-8 is assumed; file is ASCII so harmless)')
if (hdr(live, 'x-robots-tag')) P('NOTE X-Robots-Tag on robots.txt: ' + hdr(live, 'x-robots-tag'))

const repoRes = await req('https://raw.githubusercontent.com/hkspower/wain/' + SHA + '/sporta-web/public/robots.txt')
if (repoRes.status === 200) {
  const same = Buffer.compare(repoRes.body, body) === 0
  P(`repo (${SHA.slice(0, 12)}): ${repoRes.body.length} bytes sha256 ${sha(repoRes.body).slice(0, 16)}  IDENTICAL_TO_LIVE=${same}`)
  if (!same) {
    const a = repoRes.body.toString('utf8').split('\n')
    const b = liveText.split('\n')
    P(`repo lines ${a.length} live lines ${b.length}`)
    let shown = 0
    const sa = new Set(a)
    const sb = new Set(b)
    for (const l of a) if (!sb.has(l) && shown++ < 12) P('  only in repo: ' + l)
    for (const l of b) if (!sa.has(l) && shown++ < 24) P('  only in live: ' + l)
    flag('R-DRIFT', 'live robots.txt differs from the repo copy')
  }
} else P('repo copy not fetched: status ' + repoRes.status + ' ' + (repoRes.error || ''))

// redirects of the file from other spellings
for (const u of ['https://' + APEX + '/robots.txt', 'http://' + HOST + '/robots.txt', 'http://' + APEX + '/robots.txt']) {
  const r = await req(u, { method: 'HEAD' })
  P(`variant ${u} -> ${r.status || r.error} ${hdr(r, 'location')}`)
  const want = r.status === 301 && hdr(r, 'location') === ORIGIN + '/robots.txt'
  if (!want) flag('R-HOP', u + ' does not 301 in one hop to ' + ORIGIN + '/robots.txt (' + (r.status || r.error) + ' ' + hdr(r, 'location') + ')')
}
// arbitrary Host header, straight to the VPS address on port 80 (fetch cannot set Host)
for (const hh of ['example.invalid', APEX, HOST]) {
  const r = await rawHttp(hh, '/robots.txt')
  P(`raw http ${VPS_IP}:80 Host "${hh}" /robots.txt -> ${r.status} ${r.location}`)
  if (!(r.status === 301 && r.location === ORIGIN + '/robots.txt')) flag('R-HOSTVAR', 'Host "' + hh + '" on http://' + VPS_IP + ' answers ' + r.status + ' ' + r.location + ', expected 301 to ' + ORIGIN + '/robots.txt')
}

// =====================================================================================================
// 2. PARSE
// =====================================================================================================
H('2. parsed structure')
const parsed = parseRobots(liveText)
const sig = (g) => g.rules.map((r) => r.type + ':' + r.path).join('|')
const sigs = new Map()
for (const g of parsed.groups) { const s = sig(g); sigs.set(s, [...(sigs.get(s) || []), ...g.agents]) }
P(`groups ${parsed.groups.length}; distinct rule sets ${sigs.size}; sitemaps ${JSON.stringify(parsed.sitemaps)}; unknown directives ${JSON.stringify(parsed.unknown)}; crawl-delay in file ${parsed.groups.some((g) => g.crawlDelay != null)}`)
for (const [s, ag] of sigs) P(`rule set [${s.replace(/\|/g, ' ; ')}] used by ${ag.length} agent(s): ${ag.join(', ')}`)
const named = new Set(parsed.groups.flatMap((g) => g.agents))

// =====================================================================================================
// crawler table: tokens in order of specificity + whether the wildcard group applies
// =====================================================================================================
const CRAWLERS = [
  ['Googlebot', ['googlebot']],
  ['Googlebot-Image', ['googlebot-image', 'googlebot']],
  ['Bingbot', ['bingbot']],
  ['AdsBot-Google', ['adsbot-google'], false], // Google: AdsBot ignores the * group, must be named
  ['Applebot', ['applebot', 'googlebot']], // Apple: obeys Applebot, else Googlebot, else *
  ['GPTBot', ['gptbot']],
  ['ChatGPT-User', ['chatgpt-user']],
  ['OAI-SearchBot', ['oai-searchbot']],
  ['ClaudeBot', ['claudebot']],
  ['anthropic-ai', ['anthropic-ai']],
  ['PerplexityBot', ['perplexitybot']],
  ['CCBot', ['ccbot']],
  ['Google-Extended', ['google-extended']],
  ['Bytespider', ['bytespider']],
  ['Amazonbot', ['amazonbot']],
  ['FacebookExternalHit', ['facebookexternalhit']],
]
const sel = {}
for (const [name, toks, wild] of CRAWLERS) sel[name] = selectRules(parsed, toks, { useWildcard: wild !== false })
const bn = (b) => (b ? 'ALLOW' : 'BLOCK')

H('2b. which group each crawler obeys')
for (const [name] of CRAWLERS) P(`${name.padEnd(20)} -> group "${sel[name].matched}" rules ${sel[name].rules.length}${named.has(name.toLowerCase()) ? '' : '  (not named in file)'}`)

// =====================================================================================================
// URL matrix. Product slugs / assets come from the live site.
// =====================================================================================================
const htmlOf = (r) => r.body.toString('utf8')
const home = await req(ORIGIN + '/')
const homeHtml = htmlOf(home)
let slugs = []
let prodImages = []
const prodRes = await req(ORIGIN + '/api/api.php?r=products')
try {
  const j = JSON.parse(prodRes.body.toString('utf8'))
  const arr = Array.isArray(j) ? j : j.products || j.data || j.items || []
  slugs = arr.map((p) => p.slug).filter(Boolean)
  prodImages = arr.flatMap((p) => [p.image, ...(Array.isArray(p.images) ? p.images : [])]).filter((s) => typeof s === 'string' && s.startsWith('/'))
  P(`products endpoint: status ${prodRes.status} content-type "${hdr(prodRes, 'content-type')}" cache-control "${hdr(prodRes, 'cache-control')}" x-robots-tag "${hdr(prodRes, 'x-robots-tag')}" products ${arr.length}`)
} catch (e) { P('products JSON not parsed: ' + e.message + ' status ' + prodRes.status) }
const prodPaths = slugs.slice(0, 2).map((s) => '/product/' + encodeURIComponent(s))
const imgPath = prodImages.find((s) => /\.webp$/i.test(s)) || prodImages[0] || '/images/products/x.webp'

// assets the home page loads
const hrefs = [...homeHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1])
const local = (u) => { try { const x = new URL(u, ORIGIN + '/'); return x.host === HOST ? x.pathname + x.search : null } catch { return null } }
const jsAssets = [...new Set(hrefs.filter((u) => /\.m?js(\?|$)/.test(u)).map(local).filter(Boolean))]
const cssAssets = [...new Set(hrefs.filter((u) => /\.css(\?|$)/.test(u)).map(local).filter(Boolean))]
const hashedJs = jsAssets.filter((u) => /^\/assets\//.test(u))
const hashedCss = cssAssets.filter((u) => /^\/assets\//.test(u))
const fontLinks = [...new Set(hrefs.filter((u) => /\.(woff2?|ttf|otf)(\?|$)/.test(u)).map(local).filter(Boolean))]
P(`home: status ${home.status} bytes ${home.bytes} js ${jsAssets.length} css ${cssAssets.length} font preloads ${fontLinks.length} meta robots "${(homeHtml.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [''])[0]}"`)

const MATRIX = [
  ['home', '/'], ['home en', '/?lang=en'], ['shop', '/shop'], ['shop en', '/shop?lang=en'],
  ['product 1', prodPaths[0] || '/product/none'], ['product 2', prodPaths[1] || '/product/none'],
  ['category (no URL; client state)', '/shop?cat=women'],
  ['about', '/about'], ['returns', '/returns'], ['privacy', '/privacy'], ['contact', '/contact'], ['terms', '/terms'], ['exchange', '/exchange'], ['support', '/support'],
  ['asset js', hashedJs[0] || '/assets/index.js'], ['asset css', hashedCss[0] || '/assets/index.css'],
  ['product image webp', imgPath], ['cats jpg', '/cats/women.jpg'], ['hero', '/hero/hero-1.jpg'], ['fonts dir', '/fonts/'], ['font file', fontLinks[0] || '/fonts/x.woff2'],
  ['sw.js', '/sw.js'], ['manifest', '/site.webmanifest'], ['manifest alt', '/manifest.webmanifest'], ['sitemap', '/sitemap.xml'], ['llms.txt', '/llms.txt'],
  ['api products', '/api/api.php?r=products'], ['api slides', '/api/api.php?r=slides'], ['api admin', '/api/admin.php'], ['api seo-page', '/api/seo-page.php'],
  ['backends', '/backends'], ['backends/x', '/backends/orders'], ['backends-icon.svg', '/backends-icon.svg'], ['backends.webmanifest', '/backends.webmanifest'],
  ['knet', '/knet/pay.php'], ['knet no slash', '/knet'], ['pay', '/pay/pay.php'], ['pay no slash', '/pay'],
  ['checkout', '/checkout'], ['cart', '/cart'], ['account', '/account'], ['payment/result', '/payment/result'], ['payment-result', '/payment-result'], ['track', '/track'], ['invoice', '/invoice/ABC123'],
  ['search', '/search?q=x'], ['shop?q=', '/shop?q=x'], ['utm', '/?utm_source=x'], ['sort', '/shop?sort=price'], ['page 2', '/shop?page=2'],
]
const bots = CRAWLERS.map((c) => c[0])
H('3. matrix: path -> ' + bots.map((b) => b.slice(0, 8)).join(' / '))
P('legend: A=allow B=block, in crawler order: ' + bots.join(','))
const verdict = {}
for (const [label, p] of MATRIX) {
  const row = bots.map((b) => decide(sel[b], p))
  verdict[p] = Object.fromEntries(bots.map((b, i) => [b, row[i]]))
  const str = row.map((d) => (d.allowed ? 'A' : 'B')).join('')
  const uniform = new Set(row.map((d) => d.allowed)).size === 1
  P(`${str} ${label.padEnd(26)} ${p.slice(0, 60)}${uniform ? '' : '   <-- differs by crawler'} ${row[0].by ? '[' + row[0].by + ']' : ''}`)
}
const gb = (p) => decide(sel.Googlebot, p).allowed
const mustAllow = [['asset js', hashedJs[0]], ['asset css', hashedCss[0]], ['product image', imgPath], ['cats jpg', '/cats/women.jpg'], ['font file', fontLinks[0]], ['sw.js', '/sw.js'], ['manifest', '/site.webmanifest'], ['sitemap', '/sitemap.xml'], ['api products', '/api/api.php?r=products'], ['product page', prodPaths[0]], ['home', '/'], ['shop', '/shop']]
for (const [l, p] of mustAllow) if (p && !gb(p)) flag('R-BLOCKED-NEEDED', l + ' (' + p + ') is blocked for Googlebot')
for (const p of ['/backends', '/backends/orders', '/api/admin.php', '/knet/pay.php', '/pay/pay.php']) for (const b of ['Googlebot', 'Bingbot', 'GPTBot', 'ClaudeBot']) if (decide(sel[b], p).allowed) flag('R-OPEN', p + ' is crawlable by ' + b)
// AdsBot
const ads = bots.filter((b) => b === 'AdsBot-Google')
P(`AdsBot-Google: named in file ${named.has('adsbot-google')}; group used "${sel['AdsBot-Google'].matched}" -> it ignores the * group (Google docs), so /backends /checkout /cart etc are ${decide(sel['AdsBot-Google'], '/backends').allowed ? 'CRAWLABLE by AdsBot' : 'blocked'}`)

// =====================================================================================================
// 4. HEADERS for the matrix URLs + noindex discovery (HEAD for non-HTML, GET for HTML pages)
// =====================================================================================================
H('4. response headers per URL (status | x-robots-tag | meta robots | content-type | cache)')
const htmlPaths = new Set(['/', '/?lang=en', '/shop', '/shop?lang=en', prodPaths[0], prodPaths[1], '/about', '/returns', '/privacy', '/contact', '/terms', '/checkout', '/cart', '/account', '/payment/result', '/track', '/support', '/exchange', '/backends', '/search?q=x', '/shop?q=x', '/invoice/ABC123', '/backends/orders'].filter(Boolean))
const seen = new Map()
const metaRobots = (html) => (html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["']/i) || [])[1] || ''
const canonical = (html) => (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i) || [])[1] || ''
for (const [label, p] of MATRIX) {
  if (seen.has(p)) continue
  if (p === '/knet' || p === '/pay') { /* still probe: tells whether the unslashed path serves */ }
  const isHtml = htmlPaths.has(p)
  const r = await req(ORIGIN + p, { method: isHtml ? 'GET' : 'HEAD', max: 400000 })
  await sleep(100)
  const html = isHtml ? htmlOf(r) : ''
  const info = { status: r.status || r.error, xrt: hdr(r, 'x-robots-tag'), meta: isHtml ? metaRobots(html) : '', ct: hdr(r, 'content-type').split(';')[0], cc: hdr(r, 'cache-control').slice(0, 40), canon: isHtml ? canonical(html) : '', loc: hdr(r, 'location') }
  seen.set(p, info)
  P(`${String(info.status).padEnd(3)} xrt="${info.xrt}" meta="${info.meta}" ${info.ct} cc="${info.cc}" ${info.loc ? '-> ' + info.loc + ' ' : ''}${label}: ${p.slice(0, 50)}`)
}

// =====================================================================================================
// 5. CONSISTENCY: blocked AND noindex; noindex and not blocked; dead / redundant rules
// =====================================================================================================
H('5. consistency')
const noindexOf = (i) => /noindex/i.test(i.xrt) || /noindex/i.test(i.meta)
for (const [p, info] of seen) {
  const blockedG = !gb(p.startsWith('/?') ? '/' : p) && !decide(sel.Googlebot, p).allowed
  const ni = noindexOf(info)
  if (blockedG && ni) P(`CONFLICT blocked+noindex: ${p}  (Googlebot can never read the noindex: ${info.xrt || info.meta})`)
  else if (!blockedG && ni) P(`ok noindex, crawlable: ${p}  (${info.xrt || info.meta})`)
  else if (blockedG) P(`blocked, no noindex signal: ${p}  (status ${info.status})`)
}
// which rules ever decide anything on the test set, and is any Allow dead
const used = new Map()
const probes = [...MATRIX.map((m) => m[1]), ...hashedJs, ...hashedCss, ...fontLinks, imgPath]
const g0 = sel.Googlebot
for (const p of probes) {
  const d = decide(g0, p)
  used.set(d.by || '(no rule: default allow)', (used.get(d.by || '(no rule: default allow)') || 0) + 1)
}
for (const r of g0.rules) {
  const k = r.type + ' ' + r.path
  P(`rule "${k}" decides ${used.get(k) || 0} of ${probes.length} probe URLs`)
}
// does Allow: / ever matter? only if some Disallow is shorter than 1 char -> never
P('Allow: / is redundant: default is allow, and every Disallow is longer than "/" so it can never win or tie')
// Disallow prefix that also catches siblings
for (const r of g0.rules.filter((x) => x.type === 'disallow')) {
  const hits = probes.filter((p) => ruleRegex(r.path).test(normPath(p)) && !decide(g0, p).allowed)
  P(`Disallow ${r.path} blocks: ${[...new Set(hits)].slice(0, 8).join(' ')}`)
}

// =====================================================================================================
// 6. SITEMAP lines + sitemap URLs vs rules + llms.txt URLs vs rules
// =====================================================================================================
H('6. Sitemap lines and cross-checks')
const smUrls = []
for (const s of parsed.sitemaps) {
  const abs = /^https:\/\/www\.sporta\.com\.kw\//.test(s)
  const r = await req(s)
  const txt = r.body.toString('utf8')
  const locs = [...txt.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  P(`Sitemap: ${s} absolute-https-www=${abs} status ${r.status} ct "${hdr(r, 'content-type')}" bytes ${r.bytes} locs ${locs.length} xrt "${hdr(r, 'x-robots-tag')}"`)
  if (r.status !== 200 || !abs) flag('R-SITEMAP', 'Sitemap line ' + s + ' is not an absolute https://www URL returning 200')
  if (/<sitemapindex/.test(txt)) {
    for (const c of locs) {
      const cr = await req(c)
      const cl = [...cr.body.toString('utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
      P(`  child ${c} status ${cr.status} ct "${hdr(cr, 'content-type')}" urls ${cl.length}`)
      if (cr.status !== 200) flag('R-SITEMAP-CHILD', c + ' returns ' + cr.status)
      smUrls.push(...cl)
    }
  } else smUrls.push(...locs)
}
const blockedInMap = smUrls.filter((u) => { try { const x = new URL(u); return !decide(sel.Googlebot, x.pathname + x.search).allowed } catch { return false } })
P(`sitemap URLs ${smUrls.length}; blocked for Googlebot by robots.txt: ${blockedInMap.length} ${blockedInMap.slice(0, 5).join(' ')}`)
if (blockedInMap.length) flag('R-SITEMAP-BLOCKED', 'sitemap lists ' + blockedInMap.length + ' URL(s) robots.txt blocks')
P('sitemap hosts: ' + [...new Set(smUrls.map((u) => { try { return new URL(u).protocol + '//' + new URL(u).host } catch { return u } }))].join(' '))

const llms = await req(ORIGIN + '/llms.txt')
const llmsUrls = [...new Set([...llms.body.toString('utf8').matchAll(/https?:\/\/www\.sporta\.com\.kw[^\s)>\]"']*/g)].map((m) => m[0]))]
const llmsBlocked = llmsUrls.filter((u) => { const x = new URL(u); return !decide(sel.GPTBot, x.pathname + x.search).allowed })
P(`llms.txt: status ${llms.status} ct "${hdr(llms, 'content-type')}" urls ${llmsUrls.length}; blocked for GPTBot: ${llmsBlocked.length} ${llmsBlocked.join(' ')}`)
// does any public page link to the blocked admin / gateway paths?
const linksToAdmin = /href=["'][^"']*\/backends/i.test(homeHtml)
P(`home HTML links to /backends: ${linksToAdmin}; sitemap lists /backends: ${smUrls.some((u) => /\/backends/.test(u))}; llms.txt mentions /backends: ${/\/backends/.test(llms.body.toString('utf8'))}`)

// =====================================================================================================
// 7. RENDERING NEEDS for Googlebot (client-rendered shop)
// =====================================================================================================
H('7. rendering dependencies vs Googlebot')
const need = new Set([...jsAssets, ...cssAssets, ...fontLinks])
const bundleTexts = []
for (const u of hashedJs.slice(0, 2)) { const r = await req(ORIGIN + u, { max: 4e6 }); bundleTexts.push(r.body.toString('utf8')); P(`bundle ${u} status ${r.status} bytes ${r.bytes} cc "${hdr(r, 'cache-control')}" xrt "${hdr(r, 'x-robots-tag')}"`) }
for (const u of hashedCss.slice(0, 2)) { const r = await req(ORIGIN + u, { max: 2e6 }); bundleTexts.push(r.body.toString('utf8')); P(`css ${u} status ${r.status} bytes ${r.bytes} xrt "${hdr(r, 'x-robots-tag')}"`) }
const all = bundleTexts.join('\n')
const apiRefs = new Set([...all.matchAll(/["'`](\/api\/[A-Za-z0-9_.\-/?=&%]*)/g)].map((m) => m[1]))
const rNames = new Set([...all.matchAll(/api\.php\?r=([a-z_]+)/g)].map((m) => m[1]))
const chunkRefs = new Set([...all.matchAll(/["'`]((?:\/)?assets\/[A-Za-z0-9_.\-]+\.(?:js|css|woff2?|webp|png|jpe?g|svg))/g)].map((m) => '/' + m[1].replace(/^\//, '')))
const cssUrls = new Set([...all.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => local(m[1])).filter((x) => x && !x.startsWith('/data:')))
P(`bundle refs: /api/ strings ${apiRefs.size} (${[...apiRefs].slice(0, 8).join(' ')}); r= names ${[...rNames].join(',')}; asset chunks ${chunkRefs.size}; css url() ${cssUrls.size}`)
for (const n of rNames) need.add('/api/api.php?r=' + n)
for (const a of apiRefs) need.add(a)
for (const c of chunkRefs) need.add(c)
for (const c of cssUrls) need.add(c)
for (const n of ['slides', 'settings', 'brands', 'discount']) need.add('/api/api.php?r=' + n)
const needBlocked = [...need].filter((p) => !decide(sel.Googlebot, p).allowed)
P(`render-critical URLs checked ${need.size}; blocked for Googlebot ${needBlocked.length}: ${needBlocked.slice(0, 12).join(' ')}`)
if (needBlocked.length) flag('R-RENDER-BLOCKED', needBlocked.length + ' resource(s) the page loads are blocked for Googlebot: ' + needBlocked.slice(0, 6).join(' '))
// live probe of the data endpoints the page calls (GET only)
for (const n of [...rNames].filter((x) => ['products', 'slides', 'settings', 'brands', 'brand_logo', 'slide_image', 'discount', 'stock', 'order'].includes(x) && !['order', 'discount', 'stock', 'brand_logo', 'slide_image'].includes(x))) {
  const r = await req(ORIGIN + '/api/api.php?r=' + n)
  P(`api r=${n}: ${r.status} ct "${hdr(r, 'content-type').split(';')[0]}" cc "${hdr(r, 'cache-control')}" xrt "${hdr(r, 'x-robots-tag')}" bytes ${r.bytes}`)
  await sleep(100)
}
// the remaining server headers asked for in the brief
H('8. X-Robots-Tag summary')
for (const p of ['/backends', '/api/api.php?r=products', '/api/admin.php', '/knet/pay.php', '/pay/pay.php', hashedJs[0], hashedCss[0], imgPath, '/sw.js', '/site.webmanifest', '/sitemap.xml', '/robots.txt', '/llms.txt']) {
  const i = seen.get(p)
  if (i) P(`${p.slice(0, 48).padEnd(48)} status ${i.status} X-Robots-Tag "${i.xrt}"`)
  else if (p === '/robots.txt') P(`${p.padEnd(48)} status ${live.status} X-Robots-Tag "${hdr(live, 'x-robots-tag')}"`)
}
H('done')
P(`requests used ${spent}/${CAP}; flags ${flags.length}: ${flags.join(' ')}`)
