#!/usr/bin/env node
// SITEMAP CHECK - what www.sporta.com.kw actually serves as its sitemap, checked
// from the VPS (so any result that depends on DNS or routing is "as seen from
// 187.7.78.123's resolver / network").
//
// READ-ONLY. GET / HEAD / OPTIONS only, no sign-in, no form, no POST. Hard
// budget of 290 requests to the live site (a counter throws past it), with a
// 100 ms gap between requests. DNS queries and fetches of the committed repo
// files from raw.githubusercontent.com are not counted against the budget.
//
//   node sitemap-check.mjs <commit sha>     (the sha only selects which repo
//                                            sitemap files to compare against)
//
// What it does, in the order of the owner's lane brief:
//   1. every sitemap-ish URL: status, headers, size, compression, XML strictness
//   2. every <url>: loc / lastmod / hreflang reciprocity / image entries
//   3. HEAD on every loc, GET + head-tag checks on a 30-page sample
//   4. coverage against /api/api.php?r=products and the router's known routes
//   5. byte comparison with the repo's committed public/sitemap*.xml
//   6. robots.txt Sitemap line, bare/IP/http spellings, robots rules vs the URLs
//
// Output is compact on purpose (the Hostinger log keeps the last 300 entries):
//   M  measurement   H  header line   P  sampled page   I  issue   OK  held
import https from 'node:https'
import http from 'node:http'
import zlib from 'node:zlib'
import dns from 'node:dns/promises'
import { createHash } from 'node:crypto'

const SHA = process.argv[2] || 'claude/sporta-integration-tveo8b'
const HOST = 'www.sporta.com.kw'
const ORIGIN = `https://${HOST}`
const BUDGET = 290
let used = 0
let mode = null // 'dns' = connect by public DNS, 'local' = 127.0.0.1 with SNI/Host
const t0 = Date.now()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const out = (tag, s) => console.log(`${tag} ${s}`)
const M = (s) => out('M ', s)
const OK = (s) => out('OK', s)
const issues = new Map()
function issue(code, detail) {
  if (!issues.has(code)) issues.set(code, [])
  issues.get(code).push(detail)
}

// ---------- HTTP ----------
function once(url, { method, headers, raw, insecure, local }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const secure = u.protocol === 'https:'
    const lib = secure ? https : http
    const opts = {
      host: local ? '127.0.0.1' : u.hostname,
      port: u.port || (secure ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { Host: u.host, 'User-Agent': 'sporta-sitemap-check/1 (read-only audit)', Accept: '*/*', ...headers },
      timeout: 25000,
    }
    if (secure) {
      opts.servername = /^[\d.]+$/.test(u.hostname) ? undefined : u.hostname
      if (insecure) opts.rejectUnauthorized = false
    }
    const started = Date.now()
    const req = lib.request(opts, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > 8e6) { req.destroy(new Error('body over 8 MB')); return }
        chunks.push(c)
      })
      res.on('end', () => {
        let body = Buffer.concat(chunks)
        const rawLen = body.length
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        if (!raw && body.length && enc) {
          try {
            if (enc === 'gzip') body = zlib.gunzipSync(body)
            else if (enc === 'br') body = zlib.brotliDecompressSync(body)
            else if (enc === 'deflate') body = zlib.inflateSync(body)
          } catch (e) { reject(new Error(`decode ${enc}: ${e.message}`)); return }
        }
        resolve({ status: res.statusCode, headers: res.headers, body, rawLen, ms: Date.now() - started })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

async function req(url, o = {}) {
  if (used >= BUDGET) throw new Error('request budget exhausted')
  used++
  await sleep(100)
  const opt = { method: 'GET', headers: {}, raw: false, insecure: false, ...o }
  if (mode === 'local') return { url, ...(await once(url, { ...opt, local: true })) }
  try {
    const r = await once(url, { ...opt, local: false })
    mode ||= 'dns'
    return { url, ...r }
  } catch (e) {
    if (mode === 'dns') throw e
    if (!/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|timeout|ECONNRESET/.test(String(e.code || e.message))) throw e
    M(`connect by public DNS failed (${e.code || e.message}); falling back to 127.0.0.1 with Host/SNI`)
    mode = 'local'
    return { url, ...(await once(url, { ...opt, local: true })) }
  }
}
const safe = async (url, o) => {
  try { return await req(url, o) } catch (e) { return { url, status: 0, error: String(e.message || e), headers: {}, body: Buffer.alloc(0), rawLen: 0 } }
}
const hv = (r, k) => (r.headers && r.headers[k]) || ''
const txt = (r) => r.body.toString('utf8')

// ---------- strict XML ----------
function parseXml(src) {
  const errors = []
  const err = (m, i) => { if (errors.length < 15) errors.push(`${m} @${i}`) }
  const n = src.length
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0
  const bad = /[\x00-\x08\x0B\x0C\x0E-\x1F]/.exec(src)
  if (bad) err('control character', bad.index)
  const doc = { name: '#doc', local: '#doc', children: [], ns: { xml: 'http://www.w3.org/XML/1998/namespace' } }
  const stack = [doc]
  let roots = 0
  const entBad = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/
  const startRe = /<([^\s\/>]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y
  const endRe = /<\/([^\s>]+)\s*>/y
  const nameRe = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/
  const lookup = (el, prefix) => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].ns && prefix in stack[k].ns) return stack[k].ns[prefix]
    return undefined
  }
  if (!src.startsWith('<?xml', i)) err('no XML declaration at start', i)
  while (i < n) {
    if (src[i] !== '<') {
      let j = src.indexOf('<', i); if (j < 0) j = n
      const t = src.slice(i, j)
      const m = entBad.exec(t); if (m) err('unescaped & or bad entity', i + m.index)
      if (stack.length === 1 && t.trim()) err('text outside root', i)
      if (t.includes(']]>')) err(']]> in text', i)
      stack[stack.length - 1].children.push({ text: t })
      i = j; continue
    }
    if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i); if (j < 0) { err('unterminated <?', i); break }
      if (/^<\?xml[\s?]/.test(src.slice(i, i + 7)) && i > (src.charCodeAt(0) === 0xfeff ? 1 : 0)) err('xml declaration not first', i)
      i = j + 2; continue
    }
    if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i); if (j < 0) { err('unterminated comment', i); break }
      if (src.slice(i + 4, j).includes('--')) err('-- inside comment', i)
      i = j + 3; continue
    }
    if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i); if (j < 0) { err('unterminated CDATA', i); break }
      stack[stack.length - 1].children.push({ text: src.slice(i + 9, j) })
      i = j + 3; continue
    }
    if (src.startsWith('<!', i)) { err('DOCTYPE or declaration', i); const j = src.indexOf('>', i); if (j < 0) break; i = j + 1; continue }
    if (src.startsWith('</', i)) {
      endRe.lastIndex = i
      const m = endRe.exec(src)
      if (!m) { err('malformed end tag', i); break }
      const top = stack[stack.length - 1]
      if (stack.length === 1 || top.name !== m[1]) { err(`mismatched </${m[1]}> (open: ${top.name})`, i); break }
      stack.pop(); i += m[0].length; continue
    }
    startRe.lastIndex = i
    const m = startRe.exec(src)
    if (!m) { err('malformed start tag', i); break }
    const [whole, name, attrSrc, selfClose] = m
    if (!nameRe.test(name)) err(`bad element name ${name}`, i)
    const el = { name, attrs: {}, children: [], ns: {} }
    const seen = new Set()
    for (const a of attrSrc.matchAll(/([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const v = a[2] ?? a[3] ?? ''
      if (seen.has(a[1])) err(`duplicate attribute ${a[1]}`, i)
      seen.add(a[1])
      if (entBad.test(v)) err(`bad entity in attribute ${a[1]}`, i)
      el.attrs[a[1]] = v
      if (a[1] === 'xmlns') el.ns[''] = v
      else if (a[1].startsWith('xmlns:')) el.ns[a[1].slice(6)] = v
    }
    stack.push(el) // so lookup sees this element's own declarations
    const [p, l] = name.includes(':') ? name.split(':') : ['', name]
    el.prefix = p; el.local = l
    const uri = lookup(el, p)
    if (uri === undefined && p) err(`undeclared namespace prefix ${p}`, i)
    el.uri = uri || ''
    for (const an of Object.keys(el.attrs)) {
      if (an.includes(':') && !an.startsWith('xmlns:') && lookup(el, an.split(':')[0]) === undefined) err(`undeclared prefix on attribute ${an}`, i)
    }
    stack.pop()
    const parent = stack[stack.length - 1]
    if (parent === doc) { roots++; if (roots > 1) err('more than one root element', i) }
    parent.children.push(el)
    if (!selfClose) stack.push(el)
    i += whole.length
  }
  if (stack.length > 1) err(`unclosed <${stack[stack.length - 1].name}>`, n)
  if (roots === 0) err('no root element', 0)
  const root = doc.children.find((c) => c.name)
  return { root, errors }
}
const kids = (el, local) => el.children.filter((c) => c.name && c.local === local)
const textOf = (el) => el.children.map((c) => c.text ?? '').join('').trim()
const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[k])

const NS_SITEMAP = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const NS_XHTML = 'http://www.w3.org/1999/xhtml'
const NS_IMAGE = 'http://www.google.com/schemas/sitemap-image/1.1'

function readSitemap(label, body) {
  const src = body.toString('utf8')
  const { root, errors } = parseXml(src)
  const res = { label, bytes: body.length, errors, type: root ? root.local : null, rootUri: root ? root.uri : '', entries: [], nsDecl: root ? Object.entries(root.ns) : [] }
  if (!root) return res
  if (root.uri !== NS_SITEMAP) issue('sitemap-ns', `${label}: root namespace ${root.uri || '(none)'}`)
  const tag = res.type === 'sitemapindex' ? 'sitemap' : 'url'
  for (const u of kids(root, tag)) {
    const e = { loc: '', lastmod: '', changefreq: '', priority: '', alts: [], images: [], other: [] }
    for (const c of u.children.filter((x) => x.name)) {
      const v = unescapeXml(textOf(c))
      if (c.local === 'loc' && c.uri === NS_SITEMAP) e.loc = v
      else if (c.local === 'lastmod') e.lastmod = v
      else if (c.local === 'changefreq') e.changefreq = v
      else if (c.local === 'priority') e.priority = v
      else if (c.local === 'link' && c.uri === NS_XHTML) e.alts.push({ rel: c.attrs.rel, hl: c.attrs.hreflang, href: unescapeXml(c.attrs.href || '') })
      else if (c.local === 'image' && c.uri === NS_IMAGE) e.images.push(unescapeXml(textOf(kids(c, 'loc')[0] || { children: [] })))
      else e.other.push(c.name)
    }
    res.entries.push(e)
  }
  return res
}

// ---------- robots.txt ----------
function parseRobots(t) {
  const groups = []; const sitemaps = []; let cur = null
  for (const line of t.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(line.replace(/#.*/, ''))
    if (!m) continue
    const k = m[1].toLowerCase(); const v = m[2]
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { uas: [], rules: [] }; groups.push(cur) } cur.uas.push(v.toLowerCase()) }
    else if (k === 'allow' || k === 'disallow') { if (cur) cur.rules.push({ allow: k === 'allow', pat: v }) }
    else if (k === 'sitemap') sitemaps.push(v)
  }
  return { groups, sitemaps }
}
function robotsAllowed(groups, ua, p) {
  const g = groups.find((x) => x.uas.includes(ua.toLowerCase())) || groups.find((x) => x.uas.includes('*'))
  if (!g) return true
  let best = null
  for (const r of g.rules) {
    if (!r.pat) continue
    const re = new RegExp('^' + r.pat.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$$$$'))
    if (re.test(p)) {
      const len = r.pat.length
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow }
    }
  }
  return best ? best.allow : true
}

// ---------- HTML head analysis ----------
function attrsOf(tag) {
  const o = {}
  for (const a of tag.matchAll(/([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[a[1].toLowerCase()] = (a[2] ?? a[3] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  return o
}
function analyseHtml(html) {
  const r = {}
  r.title = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim()
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0]))
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0]))
  r.desc = (metas.find((m) => (m.name || '').toLowerCase() === 'description') || {}).content || ''
  r.robotsMeta = metas.filter((m) => (m.name || '').toLowerCase() === 'robots').map((m) => m.content).join('|')
  r.ogLocale = (metas.find((m) => m.property === 'og:locale') || {}).content || ''
  r.ogUrl = (metas.find((m) => m.property === 'og:url') || {}).content || ''
  r.canonicals = links.filter((l) => (l.rel || '').toLowerCase() === 'canonical').map((l) => l.href)
  r.hreflang = {}
  for (const l of links) if ((l.rel || '').toLowerCase() === 'alternate' && l.hreflang) r.hreflang[l.hreflang] = l.href
  const h = /<html\b[^>]*>/i.exec(html)
  const ha = h ? attrsOf(h[0]) : {}
  r.lang = ha.lang || ''; r.dir = ha.dir || ''
  r.ld = []
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); r.ld.push(Array.isArray(j) ? j.map((x) => x['@type']).join('+') : (j['@graph'] ? j['@graph'].map((x) => x['@type']).join('+') : j['@type'])) } catch { r.ld.push('PARSE-ERROR') }
  }
  const bodyOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<head[\s\S]*?<\/head>/i, '')
  r.bodyText = bodyOnly.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
  r.h1 = (bodyOnly.match(/<h1\b/gi) || []).length
  r.anchors = (bodyOnly.match(/<a\b[^>]*href=/gi) || []).length
  r.bytes = html.length
  return r
}

const W3C = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/
const pageType = (loc) => { const p = new URL(loc).pathname; return p === '/' ? 'home' : p.startsWith('/product/') ? 'product' : p.slice(1) }
const bareOf = (loc) => { const u = new URL(loc); u.searchParams.delete('lang'); return u.toString() }
const isEn = (loc) => new URL(loc).searchParams.get('lang') === 'en'
const short = (s, n = 160) => (s.length > n ? s.slice(0, n) + '...' : s)

async function main() {
  // ---- DNS as this VPS sees it (informational; the DNS lane owns the full check)
  for (const h of [HOST, 'sporta.com.kw']) {
    const a = await dns.resolve4(h).catch((e) => [`err:${e.code}`])
    const a6 = await dns.resolve6(h).catch((e) => [`err:${e.code}`])
    M(`dns(from VPS) ${h} A=${a.join(',')} AAAA=${a6.join(',')}`)
  }

  // ======== 1. every sitemap-ish URL ========
  const probes = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap-pages.xml', '/sitemap-products.xml',
    '/sitemap-categories.xml', '/sitemap-brands.xml', '/sitemap-images.xml', '/image-sitemap.xml', '/sitemap.xml.gz', '/sitemap.txt']
  const found = {}
  for (const p of probes) {
    const r = await safe(ORIGIN + p, { raw: true })
    found[p] = r
    const ct = hv(r, 'content-type')
    const soft = r.status === 200 && /text\/html/.test(ct)
    H(p, r, soft)
    if (r.status === 200 && !soft && !/sitemap(-pages|-products)?\.xml$/.test(p)) issue('sitemap-extra', `${p} answers 200 ${ct}`)
  }
  function H(p, r, soft) {
    out('H ', `${p} -> ${r.status || r.error} ct="${hv(r, 'content-type')}" len=${hv(r, 'content-length') || '-'} body=${r.body.length} enc=${hv(r, 'content-encoding') || '-'} cc="${hv(r, 'cache-control')}" xrt="${hv(r, 'x-robots-tag') || '-'}" lm=${hv(r, 'last-modified') || '-'} etag=${hv(r, 'etag') ? 'y' : '-'}${soft ? ' SOFT-404(html)' : ''}`)
  }
  // Compression and HEAD parity on the index and the products map.
  const gz = await safe(`${ORIGIN}/sitemap-products.xml`, { headers: { 'Accept-Encoding': 'gzip' }, raw: true })
  const idn = await safe(`${ORIGIN}/sitemap-products.xml`, { headers: { 'Accept-Encoding': 'identity' }, raw: true })
  M(`products map gzip-offered: enc=${hv(gz, 'content-encoding') || 'none'} wire=${gz.rawLen} vs identity wire=${idn.rawLen} vary="${hv(gz, 'vary')}"`)
  const hd = await safe(`${ORIGIN}/sitemap.xml`, { method: 'HEAD' })
  M(`HEAD /sitemap.xml -> ${hd.status} ct="${hv(hd, 'content-type')}" len=${hv(hd, 'content-length') || '-'}`)
  const gb = await safe(`${ORIGIN}/sitemap.xml`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept-Language': 'en-US' } })
  M(`sitemap.xml with Googlebot UA/en-US -> ${gb.status}, sha=${sha256(gb.body).slice(0, 12)} (plain UA sha=${sha256((await safe(`${ORIGIN}/sitemap.xml`)).body).slice(0, 12)})`)

  // robots.txt and llms.txt references
  const robotsR = await safe(`${ORIGIN}/robots.txt`)
  const robotsTxt = txt(robotsR)
  const robots = parseRobots(robotsTxt)
  out('H ', `/robots.txt -> ${robotsR.status} ct="${hv(robotsR, 'content-type')}" body=${robotsR.body.length} cc="${hv(robotsR, 'cache-control')}" xrt="${hv(robotsR, 'x-robots-tag') || '-'}" bom=${robotsTxt.charCodeAt(0) === 0xfeff}`)
  M(`robots.txt Sitemap lines: ${JSON.stringify(robots.sitemaps)}; groups=${robots.groups.length}`)
  if (!robots.sitemaps.length) issue('robots-no-sitemap', 'robots.txt has no Sitemap: line')
  for (const s of robots.sitemaps) if (!/^https:\/\/www\.sporta\.com\.kw\//.test(s)) issue('robots-sitemap-not-canonical', s)
  const llmsR = await safe(`${ORIGIN}/llms.txt`)
  const llms = txt(llmsR)
  const llmsSitemaps = [...llms.matchAll(/https?:\/\/[^\s)>\]"']*sitemap[^\s)>\]"']*/gi)].map((m) => m[0])
  const llmsUrls = [...new Set([...llms.matchAll(/https:\/\/www\.sporta\.com\.kw[^\s)>\]"'`,]*/g)].map((m) => m[0].replace(/[.;]+$/, '')))]
  out('H ', `/llms.txt -> ${llmsR.status} ct="${hv(llmsR, 'content-type')}" body=${llmsR.body.length} sitemapRefs=${JSON.stringify(llmsSitemaps)} urls=${llmsUrls.length}`)

  // ---- parse the index and every child (declared + robots + llms)
  const indexR = found['/sitemap.xml']
  if (indexR.status !== 200) { issue('sitemap-missing', `/sitemap.xml -> ${indexR.status}`); return }
  const idx = readSitemap('/sitemap.xml', indexR.body)
  M(`/sitemap.xml type=${idx.type} children=${idx.entries.length} bytes=${idx.bytes} xmlErrors=${idx.errors.length} ns=${JSON.stringify(idx.nsDecl)}`)
  if (idx.errors.length) issue('sitemap-xml-invalid', `/sitemap.xml: ${idx.errors.join('; ')}`)
  const childPaths = new Set()
  for (const e of idx.entries) {
    let u; try { u = new URL(e.loc) } catch { issue('index-bad-loc', e.loc); continue }
    if (u.origin !== ORIGIN) issue('index-loc-origin', e.loc)
    childPaths.add(u.pathname)
    if (e.lastmod && !W3C.test(e.lastmod)) issue('index-lastmod-format', `${e.loc} ${e.lastmod}`)
    if (!e.lastmod) issue('index-lastmod-missing', e.loc)
    M(`index child ${u.pathname} lastmod=${e.lastmod || '-'}`)
  }
  const sitemapRefs = new Set([...robots.sitemaps, ...llmsSitemaps].map((s) => { try { return new URL(s).pathname } catch { return s } }))
  for (const p of sitemapRefs) if (p !== '/sitemap.xml' && !childPaths.has(p)) issue('sitemap-referenced-not-in-index', p)

  const all = [] // {loc, lastmod, alts, images, src}
  const perSitemap = {}
  for (const p of childPaths) {
    const r = found[p] || (await safe(ORIGIN + p, { raw: true }))
    found[p] = r
    if (r.status !== 200) { issue('child-not-200', `${p} -> ${r.status}`); continue }
    if (!/^(application|text)\/xml\b/.test(hv(r, 'content-type'))) issue('child-content-type', `${p} ${hv(r, 'content-type')}`)
    if (!/charset=utf-8/i.test(hv(r, 'content-type'))) issue('child-charset', `${p} ct=${hv(r, 'content-type')} (XML declaration says UTF-8)`)
    const body = hv(r, 'content-encoding') ? zlib.gunzipSync(r.body) : r.body
    const s = readSitemap(p, body)
    perSitemap[p] = s
    M(`${p} type=${s.type} urls=${s.entries.length} bytes=${s.bytes} (limit 50000 urls / 52428800 B) xmlErrors=${s.errors.length} ns=${JSON.stringify(s.nsDecl.map(([k, v]) => k + '=' + v.split('/').slice(2, 4).join('/')))}`)
    if (s.errors.length) issue('sitemap-xml-invalid', `${p}: ${s.errors.join('; ')}`)
    if (s.entries.length > 50000 || s.bytes > 52428800) issue('sitemap-over-limit', p)
    if (s.type !== 'urlset') issue('child-not-urlset', `${p} is ${s.type}`)
    const first = src1(body)
    out('H ', `${p} first <url>: ${first}`)
    for (const e of s.entries) all.push({ ...e, src: p })
  }
  function src1(body) { const t = body.toString('utf8'); const i = t.indexOf('<url>'); return short(t.slice(i, t.indexOf('</url>', i) + 6).replace(/\s+/g, ' '), 520) }

  // ======== 2. every <url> ========
  const now = Date.now()
  const byLoc = new Map()
  const seenLoc = new Set()
  const lastmods = {}
  let nChange = 0, nPrio = 0, nImg = 0, nImgUrls = 0
  const imgLocs = []
  for (const e of all) {
    const tag = `${e.src}:${e.loc}`
    if (seenLoc.has(e.loc)) issue('url-duplicate', e.loc)
    seenLoc.add(e.loc)
    byLoc.set(e.loc, e)
    let u
    try { u = new URL(e.loc) } catch { issue('url-unparseable', e.loc); continue }
    if (u.protocol !== 'https:') issue('url-not-https', e.loc)
    if (u.host !== HOST) issue('url-wrong-host', e.loc)
    if (u.hash || e.loc.includes('#')) issue('url-fragment', e.loc)
    const q = [...u.searchParams.keys()]
    if (q.length && !(q.length === 1 && q[0] === 'lang' && u.searchParams.get('lang') === 'en')) issue('url-query-junk', e.loc)
    if (u.pathname !== '/' && u.pathname.endsWith('/')) issue('url-trailing-slash', e.loc)
    if (!/^[\x21-\x7E]+$/.test(e.loc)) issue('url-not-ascii-or-has-space', e.loc)
    if (/%[0-9a-f]{2}/.test(e.loc.replace(/%[0-9A-F]{2}/g, ''))) issue('url-lowercase-percent-escape', e.loc)
    try { decodeURIComponent(u.pathname) } catch { issue('url-bad-percent-encoding', e.loc) }
    if (u.pathname !== u.pathname.toLowerCase() && !/%/.test(u.pathname)) issue('url-uppercase-path', e.loc)
    if (e.loc !== e.loc.trim() || /\s/.test(e.loc)) issue('url-whitespace', JSON.stringify(e.loc))
    // lastmod
    if (!e.lastmod) issue('lastmod-missing', tag)
    else if (!W3C.test(e.lastmod) || Number.isNaN(Date.parse(e.lastmod))) issue('lastmod-invalid', `${tag} ${e.lastmod}`)
    else {
      if (Date.parse(e.lastmod) > now + 3600e3) issue('lastmod-future', `${tag} ${e.lastmod}`)
      ;(lastmods[e.src] ||= []).push(e.lastmod)
    }
    if (e.changefreq) nChange++
    if (e.priority) nPrio++
    if (e.other.length) issue('url-unknown-children', `${tag} ${e.other.join(',')}`)
    if (e.images.length) { nImg++; nImgUrls += e.images.length; imgLocs.push(...e.images) }
    for (const im of e.images) {
      try { const iu = new URL(im); if (iu.host !== HOST || iu.protocol !== 'https:') issue('image-loc-origin', im); if (!/^[\x21-\x7E]+$/.test(im)) issue('image-loc-encoding', im) } catch { issue('image-loc-bad', im) }
    }
  }
  M(`total <url>=${all.length} unique=${seenLoc.size} withImages=${nImg} imageLocs=${nImgUrls} changefreq=${nChange} priority=${nPrio}`)
  for (const [src, v] of Object.entries(lastmods)) {
    const d = [...new Set(v)].sort()
    M(`${src} lastmod distinct=${d.length} oldest=${d[0]} newest=${d[d.length - 1]} (index says ${(idx.entries.find((e) => e.loc.endsWith(src)) || {}).lastmod || '-'})`)
    const newestAge = (now - Date.parse(d[d.length - 1])) / 3600e3
    if (d.length === 1 && v.length > 4) issue('lastmod-all-identical', `${src}: all ${v.length} entries carry ${d[0]}`)
    if (d.length === 1 && newestAge < 6) issue('lastmod-equals-now', `${src}: ${d[0]} is ${newestAge.toFixed(1)} h old`)
    const ix = idx.entries.find((e) => e.loc.endsWith(src))
    if (ix && ix.lastmod && d.length && ix.lastmod.slice(0, 10) !== d[d.length - 1].slice(0, 10)) issue('index-lastmod-mismatch', `${src}: index ${ix.lastmod} vs newest child ${d[d.length - 1]}`)
  }
  // hreflang
  let altBad = 0
  for (const e of all) {
    let u; try { u = new URL(e.loc) } catch { continue }
    const bare = bareOf(e.loc); const en = bare + (bare.includes('?') ? '&' : '?') + 'lang=en'
    const hl = Object.fromEntries(e.alts.map((a) => [a.hl, a.href]))
    const keys = Object.keys(hl).sort().join(',')
    if (e.alts.some((a) => a.rel !== 'alternate')) issue('hreflang-rel', e.loc)
    if (keys !== 'ar,en,x-default' || e.alts.length !== 3) { issue('hreflang-set', `${e.loc} has [${e.alts.map((a) => a.hl).join(',')}]`); altBad++; continue }
    if (hl.ar !== bare) issue('hreflang-ar-not-bare', `${e.loc}: ar=${hl.ar}`)
    if (hl.en !== en) issue('hreflang-en-not-?lang=en', `${e.loc}: en=${hl.en}`)
    if (hl['x-default'] !== bare) issue('hreflang-xdefault-not-bare', `${e.loc}: x-default=${hl['x-default']}`)
    if (!e.alts.some((a) => a.href === e.loc)) issue('hreflang-no-self', e.loc)
    for (const a of e.alts) {
      const peer = byLoc.get(a.href)
      if (!peer) { issue('hreflang-target-not-a-url-entry', `${e.loc} -> ${a.href}`); continue }
      if (!peer.alts.some((b) => b.href === e.loc)) issue('hreflang-not-reciprocal', `${a.href} does not list ${e.loc}`)
    }
  }
  M(`hreflang entries with wrong set=${altBad}`)
  // robots vs sitemap URLs
  let blocked = 0
  for (const e of all) { const u = new URL(e.loc); if (!robotsAllowed(robots.groups, 'Googlebot', u.pathname + u.search)) { blocked++; issue('sitemap-url-blocked-by-robots', e.loc) } }
  for (const p of ['/sitemap.xml', ...childPaths]) if (!robotsAllowed(robots.groups, 'Googlebot', p)) issue('sitemap-file-blocked-by-robots', p)
  M(`sitemap URLs disallowed for Googlebot by robots.txt: ${blocked}`)
  // page types
  const types = {}
  for (const e of all) { const t = pageType(e.loc); types[t] = (types[t] || 0) + 1 }
  M(`page types: ${JSON.stringify(types)}`)
  const mustNot = /^\/(checkout|cart|backends|account|search|payment|track|invoice|review|wishlist|exchange|knet|pay|api|support)(\/|$)/
  for (const e of all) { const p = new URL(e.loc).pathname; if (mustNot.test(p)) issue('utility-page-in-sitemap', `${p} (${pageType(e.loc)})`) }

  // ======== 3. HEAD on every loc ========
  const locs = all.map((e) => e.loc)
  const hs = { ok: 0, other: {} }
  const seenCT = {}
  for (const loc of locs) {
    let r = await safe(loc, { method: 'HEAD' })
    if ([403, 405, 501].includes(r.status) || r.status === 0) r = await safe(loc)
    const ct = hv(r, 'content-type'); const xrt = hv(r, 'x-robots-tag')
    seenCT[ct] = (seenCT[ct] || 0) + 1
    if (r.status === 200) hs.ok++
    else { hs.other[r.status] = (hs.other[r.status] || 0) + 1; issue('url-not-200', `${loc} -> ${r.status || r.error} ${hv(r, 'location')}`) }
    if (r.status === 200 && !/text\/html/.test(ct)) issue('url-content-type', `${loc} ${ct}`)
    if (/noindex|none/i.test(xrt)) issue('url-noindex-header', `${loc} xrt=${xrt}`)
  }
  M(`HEAD sweep: ${locs.length} urls, 200=${hs.ok}, other=${JSON.stringify(hs.other)}, content-types=${JSON.stringify(seenCT)}`)
  // sample of images
  const imgSample = [...new Set(imgLocs)].filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 14)) === 0).slice(0, 14)
  let imgOk = 0
  for (const im of imgSample) {
    const r = await safe(im, { method: 'HEAD' })
    if (r.status === 200 && /^image\//.test(hv(r, 'content-type'))) imgOk++
    else issue('image-url-not-ok', `${im} -> ${r.status} ${hv(r, 'content-type')}`)
  }
  M(`image:loc sampled ${imgSample.length} of ${new Set(imgLocs).size} distinct: ok=${imgOk}`)

  // sample of 30 pages: every page type in both languages + products
  const pageLocs = all.filter((e) => pageType(e.loc) !== 'product').map((e) => e.loc)
  const prodLocs = all.filter((e) => pageType(e.loc) === 'product').map((e) => e.loc)
  const prodAr = prodLocs.filter((l) => !isEn(l)); const prodEn = prodLocs.filter(isEn)
  const pick = (a, n) => a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.floor((i * a.length) / n)])
  const sample = [...new Set([...pageLocs, ...pick(prodAr, 7), ...pick(prodEn, 5)])].slice(0, 30)
  let rawTitle = 0, rawCanon = 0, rawHl = 0, rawLd = 0, rawBody = 0
  for (const loc of sample) {
    const r = await safe(loc, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })
    const html = txt(r)
    const a = analyseHtml(html)
    const en = isEn(loc)
    const e = byLoc.get(loc)
    const probs = []
    if (r.status !== 200) probs.push(`status${r.status}`)
    if (!a.title) probs.push('no-title')
    if (!a.desc) probs.push('no-desc')
    if (a.canonicals.length !== 1) probs.push(`canonicals=${a.canonicals.length}`)
    else if (a.canonicals[0] !== loc) probs.push(`canon!=loc(${short(a.canonicals[0], 90)})`)
    if (/noindex/i.test(a.robotsMeta)) probs.push('meta-noindex')
    if (/noindex/i.test(hv(r, 'x-robots-tag'))) probs.push('xrt-noindex')
    if (a.lang !== (en ? 'en' : 'ar')) probs.push(`lang=${a.lang}`)
    if (a.dir !== (en ? 'ltr' : 'rtl')) probs.push(`dir=${a.dir}`)
    if (e) {
      const want = Object.fromEntries(e.alts.map((x) => [x.hl, x.href]))
      const got = a.hreflang
      if (JSON.stringify(Object.entries(want).sort()) !== JSON.stringify(Object.entries(got).sort())) probs.push(`hreflang-differs(page:${Object.keys(got).join('/') || 'none'})`)
    }
    if (a.ld.includes('PARSE-ERROR')) probs.push('jsonld-parse-error')
    if (a.title) rawTitle++
    if (a.canonicals.length) rawCanon++
    if (Object.keys(a.hreflang).length) rawHl++
    if (a.ld.length) rawLd++
    if (a.bodyText > 40) rawBody++
    for (const p of probs) issue('page-' + p.replace(/\(.*$/, '').replace(/=\d+$/, ''), loc + (p.includes('(') ? ' ' + p : ''))
    out('P ', `${loc.replace(ORIGIN, '')} ${r.status} t=${a.title.length} d=${a.desc.length} c=${a.canonicals.length} hl=${Object.keys(a.hreflang).length} ${a.lang}/${a.dir} og=${a.ogLocale} rb="${a.robotsMeta}" ld=[${a.ld.join(',')}] body=${a.bodyText}c h1=${a.h1} a=${a.anchors} ${probs.length ? 'PROBS:' + probs.join(',') : 'ok'}`)
    if (loc === `${ORIGIN}/` || loc.endsWith('/shop?lang=en') || (pageType(loc) === 'product' && !en && rawBody < 99 && sample.indexOf(loc) === sample.findIndex((s) => pageType(s) === 'product'))) {
      out('P ', `   title="${short(a.title, 90)}" desc="${short(a.desc, 90)}" canon=${a.canonicals[0]}`)
    }
  }
  M(`sample ${sample.length} pages: raw HTML has title=${rawTitle} canonical=${rawCanon} hreflang=${rawHl} json-ld=${rawLd} visible-body-text(>40c)=${rawBody}`)

  // ======== 4. coverage vs API and router ========
  const apiR = await safe(`${ORIGIN}/api/api.php?r=products`)
  let products = []
  try { const j = JSON.parse(txt(apiR)); products = Array.isArray(j) ? j : (j.products || j.data || j.items || []) } catch { issue('api-products-unparseable', `status ${apiR.status}`) }
  M(`api products: status=${apiR.status} ct="${hv(apiR, 'content-type')}" count=${products.length} keys=${products[0] ? Object.keys(products[0]).join(',') : '-'}`)
  if (products[0]) {
    const p0 = products[0]
    M(`product[0]=${short(JSON.stringify(p0), 420)}`)
    for (const k of Object.keys(p0)) {
      if (/stock|avail|qty|quantity|active|status|sizes|featured|sale/i.test(k)) {
        const vals = {}; for (const p of products) { const v = typeof p[k] === 'object' ? (Array.isArray(p[k]) ? `arr${p[k].length}` : 'obj') : String(p[k]); vals[v] = (vals[v] || 0) + 1 }
        M(`api field ${k}: ${short(JSON.stringify(vals), 200)}`)
      }
    }
    for (const k of ['category', 'brand', 'gender', 'collection']) {
      if (k in p0) { const vals = {}; for (const p of products) vals[p[k]] = (vals[p[k]] || 0) + 1; M(`api ${k}: ${short(JSON.stringify(vals), 300)}`) }
    }
  }
  const apiSlugs = new Set(products.map((p) => p.slug).filter(Boolean))
  const smSlugs = new Set(prodLocs.map((l) => decodeURIComponent(new URL(l).pathname.slice('/product/'.length))))
  const missing = [...apiSlugs].filter((s) => !smSlugs.has(s))
  const extra = [...smSlugs].filter((s) => !apiSlugs.has(s))
  M(`products: api=${apiSlugs.size} sitemap-slugs=${smSlugs.size}; missing from sitemap=${missing.length}; in sitemap but not in api=${extra.length}`)
  if (missing.length) issue('product-missing-from-sitemap', short(missing.join(','), 400))
  if (extra.length) issue('sitemap-product-not-in-api', short(extra.join(','), 400))
  for (const s of smSlugs) if (/[^a-z0-9-]/.test(s)) issue('slug-non-ascii', s)
  // Which pages the router serves that the sitemap leaves out, and what they say about themselves.
  const sitemapPaths = new Set(all.map((e) => new URL(e.loc).pathname))
  const routerPages = ['/', '/shop', '/about', '/contact', '/support', '/returns', '/exchange', '/terms', '/privacy', '/track', '/account', '/wishlist', '/cart', '/checkout', '/review', '/brands', '/payment/result', '/backends']
  M(`router pages not in sitemap: ${routerPages.filter((p) => !sitemapPaths.has(p)).join(' ')}`)
  const probeList = ['/cart', '/checkout', '/account', '/wishlist', '/review', '/exchange', '/support', '/brands', '/payment/result', '/backends', '/search?q=test', '/shop?category=men', '/women', '/invoice/ABC123', '/zz-no-such-page-9f3']
  for (const p of probeList) {
    const r = await safe(ORIGIN + p, { method: 'HEAD' })
    out('H ', `probe ${p} -> ${r.status || r.error} xrt="${hv(r, 'x-robots-tag') || '-'}" loc=${hv(r, 'location') || '-'} inSitemap=${sitemapPaths.has(p.split('?')[0])}`)
  }
  for (const p of ['/cart', '/checkout', '/account', '/wishlist', '/brands', '/search?q=test', '/shop?category=men', '/track']) {
    const r = await safe(ORIGIN + p)
    const a = analyseHtml(txt(r))
    out('P ', `probe-html ${p} ${r.status} robotsMeta="${a.robotsMeta}" canon=${a.canonicals[0] || '-'} xrt="${hv(r, 'x-robots-tag') || '-'}" title="${short(a.title, 60)}"`)
  }
  // llms.txt URLs that the sitemap lacks (informational)
  const llmsNot = llmsUrls.filter((u) => !byLoc.has(u) && !byLoc.has(u.replace(/\/$/, '')) && !/sitemap|robots|llms/.test(u))
  M(`llms.txt URLs=${llmsUrls.length}, not in sitemap=${llmsNot.length}: ${short(llmsNot.join(' '), 300)}`)

  // ======== 6. spellings that must funnel into the one sitemap ========
  for (const u of ['http://www.sporta.com.kw/sitemap.xml', 'https://sporta.com.kw/sitemap.xml', 'http://sporta.com.kw/robots.txt', 'http://187.7.78.123/sitemap.xml']) {
    const r = await safe(u, { method: 'HEAD' })
    out('H ', `spelling ${u} -> ${r.status || r.error} loc=${hv(r, 'location') || '-'}`)
    if (!(r.status === 301 && /^https:\/\/www\.sporta\.com\.kw\//.test(hv(r, 'location')))) issue('spelling-not-301-to-canonical', `${u} -> ${r.status || r.error} ${hv(r, 'location')}`)
  }

  // ======== 5. compare with the repo's committed files (raw.githubusercontent, not the site) ========
  for (const f of ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-products.xml']) {
    try {
      const rr = await fetch(`https://raw.githubusercontent.com/hkspower/wain/${SHA}/sporta-web/public/${f}`)
      const rb = Buffer.from(await rr.arrayBuffer())
      const live = found['/' + f]
      const lb = live ? (hv(live, 'content-encoding') ? zlib.gunzipSync(live.body) : live.body) : Buffer.alloc(0)
      const rs = readSitemap('repo/' + f, rb)
      const ls = readSitemap('live/' + f, lb)
      const rl = new Set(rs.entries.map((e) => e.loc)); const ll = new Set(ls.entries.map((e) => e.loc))
      const liveOnly = [...ll].filter((x) => !rl.has(x)); const repoOnly = [...rl].filter((x) => !ll.has(x))
      const rImg = rs.entries.reduce((n, e) => n + e.images.length, 0); const lImg = ls.entries.reduce((n, e) => n + e.images.length, 0)
      const rHl = rs.entries.filter((e) => e.alts.length).length; const lHl = ls.entries.filter((e) => e.alts.length).length
      M(`repo-vs-live ${f}: repo ${rr.status} ${rb.length}B sha=${sha256(rb).slice(0, 10)} urls=${rs.entries.length} img=${rImg} hl=${rHl} | live ${lb.length}B sha=${sha256(lb).slice(0, 10)} urls=${ls.entries.length} img=${lImg} hl=${lHl} | identical=${sha256(rb) === sha256(lb)} liveOnly=${liveOnly.length}${liveOnly.length && liveOnly.length < 6 ? ' [' + liveOnly.map((x) => x.replace(ORIGIN, '')).join(' ') + ']' : ''} repoOnly=${repoOnly.length}${repoOnly.length && repoOnly.length < 6 ? ' [' + repoOnly.map((x) => x.replace(ORIGIN, '')).join(' ') + ']' : ''}`)
    } catch (e) { M(`repo-vs-live ${f}: could not fetch repo copy (${e.message})`) }
  }

  // ---- summary
  console.log('---- ISSUES (code count :: up to 3 examples)')
  for (const [code, list] of issues) console.log(`I  ${code} x${list.length} :: ${list.slice(0, 3).map((x) => short(String(x), 170)).join(' || ')}`)
  console.log(`SITEMAP_CHECK_DONE requests=${used}/${BUDGET} issueCodes=${issues.size} mode=${mode} seconds=${Math.round((Date.now() - t0) / 1000)}`)
}

main().catch((e) => {
  console.log('FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e))
  console.log(`SITEMAP_CHECK_DONE requests=${used}/${BUDGET} FATAL`)
  process.exitCode = 1
})
