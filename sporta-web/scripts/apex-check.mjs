#!/usr/bin/env node
// APEX CHECK - read-only probe of the bare domain sporta.com.kw (and what it hands over to www).
//
//   Run ON the VPS (node:24-alpine, host network) through the Hostinger connector. The script is
//   fetched at run time from raw.githubusercontent.com at a pushed commit, because a compose
//   file may not contain a dollar sign (CLAUDE.md, probing rules):
//
//     node apex-check.mjs              live probe, about 110 requests, ~15 s
//     node apex-check.mjs --strict     same, exit code 2 when any BAD was found
//     node apex-check.mjs --selftest   offline: starts mock servers on 127.0.0.1 and proves that
//                                      every seeded problem is flagged (exit 1 when one is missed)
//     APEX_TARGETS='{"connect":"127.0.0.1","http":8080,"https":8443,"ca":"/path/ca.pem"}'
//                                      point the probe at a mock instead of the internet (DNS and
//                                      mail checks are skipped unless "offline":false)
//
// What it does NOT do: sign in, POST, write, follow a redirect to a host that is not ours, or send
// more than MAX_REQUESTS requests (GET / HEAD / OPTIONS / TRACE, DNS, DoH GET, TLS handshakes), with
// GAP_MS between them. Like sec-scans-headers.mjs it talks to the host's own Traefik on
// 127.0.0.1:80/443 with the real Host header and SNI (falls back to 187.7.78.123 when 127.0.0.1:443
// refuses). The ONE exception to certificate checking is the bare-IP probe (the certificate cannot
// name an IP), which runs with rejectUnauthorized:false and is labelled "ip-insecure". No cookie
// value is ever printed (names only).
//
// Output is compact on purpose: the VPS log keeps the last 300 entries. Every finding is one line:
//   BAD  <ID> ...   a rule from CLAUDE.md is broken (one hop to https://www, no apex content ...)
//   WARN <ID> ...   worth a decision by the owner
//   ok   <ID> ...   checked and fine
// and the run ends with   APEX_SUMMARY ok=<n> warn=<n> bad=<n>   then   APEX_CHECK_DONE.
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import dns from 'node:dns'

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.log(`APEX_CHECK needs Node 22 or newer (meant for 24); this is ${process.version}`)
  process.exit(1)
}

const APEX = 'sporta.com.kw'
const WWW = 'www.' + APEX
const VPS_IP = '187.7.78.123'
const CANON = 'https://' + WWW
const KNOWN = new Set([APEX, WWW, VPS_IP])
const GAP_MS = 100 // pause between two requests
const MAX_REQUESTS = 290 // hard stop, below the 300 the owner allowed
const MAX_HOPS = 6
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clip = (s, n = 120) => (String(s).length > n ? String(s).slice(0, n) + '..' : String(s))
const isIp = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h || '')
const rank = { ok: 0, warn: 1, bad: 2 }

// ------------------------------------------------------------------------ URL handling
// Own parser, not WHATWG URL: the raw path and query (percent-encoding, hex case) must survive
// byte for byte so that a redirect that re-encodes them can be seen.
function parseUrl(s) {
  const m = /^(https?):\/\/([^/?#]+)([^#]*)$/i.exec(String(s))
  if (!m) return null
  let path = m[3] || '/'
  if (path[0] === '?') path = '/' + path
  const auth = m[2]
  const pm = /^(.*):(\d+)$/.exec(auth)
  const host = (pm ? pm[1] : auth).toLowerCase().replace(/\.$/, '')
  return { scheme: m[1].toLowerCase(), auth, host, port: pm ? Number(pm[2]) : null, path }
}
const urlStr = (u) => `${u.scheme}://${u.auth}${u.path}`
function resolveLoc(cur, loc) {
  if (/^https?:\/\//i.test(loc)) return parseUrl(loc)
  if (loc.startsWith('//')) return parseUrl(cur.scheme + ':' + loc)
  if (loc.startsWith('/')) return parseUrl(`${cur.scheme}://${cur.auth}${loc}`)
  try { return parseUrl(new URL(loc, urlStr(cur)).href) } catch { return null }
}
const splitPQ = (p) => { const i = p.indexOf('?'); return i < 0 ? [p, null] : [p.slice(0, i), p.slice(i + 1)] }
const safeDecode = (s) => { try { return decodeURIComponent(s) } catch { return s } }
const hv = (h, k) => { const v = h?.[k]; return Array.isArray(v) ? v.join(', ') : v }
function parseHsts(v) {
  if (!v) return null
  const m = /max-age\s*=\s*"?(\d+)/i.exec(v)
  return { maxAge: m ? Number(m[1]) : null, sub: /(^|;)\s*includesubdomains\s*(;|$)/i.test(v), preload: /(^|;)\s*preload\s*(;|$)/i.test(v) }
}
function hdrSummary(h) {
  const p = []
  const a = (k, v) => { if (v !== undefined && v !== '') p.push(`${k}=${v}`) }
  const hs = parseHsts(hv(h, 'strict-transport-security'))
  a('hsts', hs ? `${hs.maxAge}${hs.sub ? '+sub' : ''}${hs.preload ? '+pre' : ''}` : undefined)
  a('cc', hv(h, 'cache-control') && clip(hv(h, 'cache-control'), 48))
  a('exp', hv(h, 'expires') && clip(hv(h, 'expires'), 29))
  a('vary', hv(h, 'vary') && clip(hv(h, 'vary'), 40))
  a('srv', hv(h, 'server') && clip(hv(h, 'server'), 24))
  a('via', hv(h, 'via') && clip(hv(h, 'via'), 30))
  a('alt', hv(h, 'alt-svc') && clip(hv(h, 'alt-svc'), 30))
  a('xrt', hv(h, 'x-robots-tag') && clip(hv(h, 'x-robots-tag'), 30))
  a('cl', hv(h, 'content-length'))
  const ck = [].concat(h['set-cookie'] || []).map((c) => String(c).split('=')[0]) // names only
  a('ck', ck.length ? ck.join(',') : undefined)
  return p.length ? '{' + p.join(' ') + '}' : '{}'
}

// ------------------------------------------------------------------------ the probe
function createProbe(cfg) {
  const lines = []
  const counts = { ok: 0, warn: 0, bad: 0 }
  const flags = new Map() // id -> worst level
  const seen = new Set()
  const muted = new Set((process.env.APEX_MUTE || '').split(',').filter(Boolean)) // selftest proof only
  const gap = cfg.gapMs ?? GAP_MS
  let reqs = 0
  let last = 0
  let apexResponses = 0
  let apex2xx = 0
  const L = (s) => { lines.push(s); if (!cfg.quiet) console.log(s) }
  // Report a finding. `key` de-duplicates (same id + key prints once).
  function flag(level, id, msg, key = '') {
    if (muted.has(id)) return
    const k = `${id}|${key}`
    if (seen.has(k)) return
    seen.add(k)
    counts[level]++
    if (!flags.has(id) || rank[level] > rank[flags.get(id)]) flags.set(id, level)
    L(`  ${level === 'bad' ? 'BAD ' : level === 'warn' ? 'WARN' : 'ok  '} ${id} ${clip(msg, 230)}`)
  }
  const good = (id, msg, key = id) => flag('ok', id, msg, key)
  const note = (msg) => L(`  note ${clip(msg, 230)}`)
  async function gate() {
    if (reqs >= MAX_REQUESTS) throw new Error('request budget used up')
    reqs++
    const wait = last + gap - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
  }

  // ---------------------------------------------------------------------- HTTP(S) layer
  const TLS_ERRS = /^(ERR_TLS_CERT_ALTNAME_INVALID|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_SSL|HOSTNAME_MISMATCH)/
  function rawRequest(u, { method = 'GET', hostHeader, sni, insecure = false, maxBody = 0 }) {
    return new Promise((resolve) => {
      const isTls = u.scheme === 'https'
      const opts = {
        host: cfg.connect, port: isTls ? (cfg.httpsPort || 443) : (cfg.httpPort || 80), method, path: u.path, agent: false, timeout: 12000,
        headers: { Host: hostHeader ?? u.auth, 'User-Agent': 'sporta-apex-check/1 (read-only)', Accept: '*/*', 'Accept-Encoding': 'identity', Connection: 'close' },
      }
      if (isTls) {
        const name = sni ?? (isIp(u.host) ? undefined : u.host)
        if (name) opts.servername = name
        opts.rejectUnauthorized = !insecure
        if (cfg.ca) opts.ca = cfg.ca
      }
      const t0 = Date.now()
      let done = false
      const fin = (r) => { if (!done) { done = true; resolve({ ms: Date.now() - t0, ...r }) } }
      const req = (isTls ? https : http).request(opts, (res) => {
        const chunks = []
        let n = 0
        res.on('data', (c) => { if (n < maxBody) { chunks.push(c); n += c.length } })
        res.on('end', () => fin({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', (e) => fin({ status: 0, headers: {}, body: '', error: e.code || e.message }))
      })
      req.on('timeout', () => { req.destroy(); fin({ status: 0, headers: {}, body: '', error: 'timeout' }) })
      req.on('error', (e) => fin({ status: 0, headers: {}, body: '', error: e.code || e.message, tlsError: TLS_ERRS.test(e.code || '') ? e.code : undefined }))
      req.end()
    })
  }
  // One request. A certificate failure on a non-IP name is reported (TLS-VERIFY-FAIL) and then retried
  // without verification so that the rest of the chain can still be read.
  async function hop(u, o = {}) {
    await gate()
    const insecure = o.insecure || isIp(u.host)
    let r = await rawRequest(u, { ...o, insecure })
    r.insecure = insecure
    if (r.tlsError && !insecure) {
      flag('bad', 'TLS-VERIFY-FAIL', `${u.host}: ${r.tlsError} when connecting with SNI ${o.sni ?? u.host}`, u.host)
      await gate()
      r = await rawRequest(u, { ...o, insecure: true })
      r.insecure = true
      r.insecureRetry = true
    }
    return r
  }

  // ---------------------------------------------------------------------- redirect chains
  let chainNo = 0
  const chains = []
  async function follow(startStr, spec = {}) {
    const id = 'R' + String(++chainNo).padStart(2, '0')
    const method = spec.method || 'GET'
    let cur = parseUrl(startStr)
    const rec = { id, start: startStr, spec, hops: [], redirects: 0, loop: false, tooMany: false, foreign: null, err: null, final: cur }
    const visited = new Set()
    for (let i = 0; i <= MAX_HOPS; i++) {
      const key = urlStr(cur) + (i === 0 && spec.hostHeader ? ' Host:' + spec.hostHeader : '')
      if (visited.has(key)) { rec.loop = true; break }
      visited.add(key)
      const o = { method, maxBody: spec.maxBody || 0 }
      if (i === 0) { o.hostHeader = spec.hostHeader; o.sni = spec.sni; o.insecure = spec.insecure }
      const r = await hop(cur, o)
      const effHost = i === 0 && spec.hostHeader ? parseUrl('http://' + spec.hostHeader).host : cur.host
      const loc = hv(r.headers, 'location')
      const h = { req: urlStr(cur), u: cur, effHost, status: r.status, location: loc, headers: r.headers, by: /apache/i.test(hv(r.headers, 'server') || '') ? 'apache' : 'edge?', insecure: r.insecure, insecureRetry: r.insecureRetry, body: r.body, error: r.error }
      rec.hops.push(h)
      rec.final = cur
      if (r.status === 0) { rec.err = r.error || 'no response'; break }
      if (effHost === APEX) { apexResponses++; if (r.status >= 200 && r.status < 300) apex2xx++ }
      const isRedirect = [301, 302, 303, 307, 308].includes(r.status) && loc
      if (!isRedirect) break
      rec.redirects++
      const next = resolveLoc(cur, loc)
      if (!next) { rec.err = 'unparsable Location ' + clip(loc, 60); break }
      rec.final = next
      if (!KNOWN.has(next.host)) { rec.foreign = next; break }
      if (rec.redirects > MAX_HOPS) { rec.tooMany = true; break }
      cur = next
    }
    if (!rec.loop && !rec.foreign && !rec.tooMany && !rec.err) rec.final = rec.hops.length ? parseUrl(rec.hops[rec.hops.length - 1].req) : cur
    chains.push(rec)
    return rec
  }

  const hstsSeen = new Set()
  const permStatus = [] // first-hop permanent redirects, for STATUS-MIX
  function printChain(rec) {
    const lastH = rec.hops[rec.hops.length - 1]
    L(`${rec.id} ${rec.spec.method || 'GET'} ${rec.start}${rec.spec.hostHeader ? ' (Host: ' + rec.spec.hostHeader + ')' : ''}${rec.spec.sni ? ' (SNI ' + rec.spec.sni + ')' : ''}${rec.hops[0]?.insecure && rec.spec.kind === 'ip' ? ' (ip-insecure: tls verify off, IP probe only)' : ''}`)
    rec.hops.forEach((h, i) => L(`  h${i} ${h.status || 'ERR'} ${h.location ?? (h.error ? 'error:' + h.error : '-')} ${hdrSummary(h.headers)}${h.status >= 300 && h.status < 400 ? ' by=' + h.by : ''}`))
    if (rec.loop) L('  loop: a URL was requested twice')
    if (rec.foreign) L(`  stops at foreign host ${rec.foreign.host}`)
    return lastH
  }

  function judge(rec) {
    const spec = rec.spec
    const kind = spec.kind
    let problems = 0
    const P = (level, id, msg, key = rec.id) => { problems++; flag(level, id, `${rec.id} ${msg}`, key) }
    const canon = kind === 'apex' || kind === 'variant' || kind === 'wwwhttp'
    const lastH = rec.hops[rec.hops.length - 1]
    const finalUrl = rec.final ? urlStr(rec.final) : '?'
    const toCanon = rec.final && `${rec.final.scheme}://${rec.final.host}` === CANON

    if (rec.err) P('bad', 'REQ-ERROR', `${rec.start}: ${rec.err}`)
    if (rec.loop) P('bad', 'LOOP', `${rec.start} redirects back to a URL already requested (${rec.redirects} redirects)`)
    if (rec.tooMany) P('bad', 'TOO-MANY-HOPS', `${rec.start} still redirecting after ${MAX_HOPS} hops`)
    if (rec.foreign) P('bad', 'REDIRECT-FOREIGN-HOST', `${rec.start} sends the visitor to ${urlStr(rec.foreign)} (not sporta.com.kw / www / the IP)`)
    // scheme downgrade
    rec.hops.forEach((h, i) => {
      if (!(h.status >= 300 && h.status < 400 && h.location)) return
      const next = resolveLoc(h.u, h.location)
      if (h.u.scheme === 'https' && next && next.scheme === 'http') P('bad', 'HTTP-DOWNGRADE', `h${i} ${h.req} redirects to ${clip(h.location, 80)} (https -> http)`)
    })
    // status class and hop count
    rec.hops.forEach((h, i) => {
      if (![302, 303, 307].includes(h.status)) return
      if (canon || kind === 'ip') P('bad', 'TEMP-REDIRECT', `h${i} ${h.status} on ${h.req}: ${h.status} is temporary (search engines keep the old URL); a canonical host move is 301/308`)
    })
    if (canon && rec.redirects > 1 && !rec.loop) P('bad', 'MULTI-HOP', `${rec.start} takes ${rec.redirects} hops, CLAUDE.md requires one`)
    if (kind === 'ip' && rec.redirects > 1 && !rec.loop) P('warn', 'MULTI-HOP', `${rec.start} takes ${rec.redirects} hops`)
    if (kind === 'www' && rec.redirects > 0 && !rec.loop) P('warn', 'WWW-REDIRECTS', `${rec.start} itself redirects (${rec.redirects}) to ${finalUrl}`)
    // where it ends
    if ((canon || kind === 'acme') && !rec.loop && !rec.foreign && !rec.err && !toCanon) P('bad', 'FINAL-NOT-WWW', `${rec.start} ends at ${finalUrl}, not ${CANON}`)
    if (kind === 'ip' && !rec.loop && !rec.err) {
      const lastStatus = lastH?.status || 0
      if (!toCanon) {
        if (lastStatus >= 200 && lastStatus < 300 && !rec.foreign) P('bad', 'IP-SERVES-CONTENT', `${rec.start} answers ${lastStatus} content on the bare IP instead of redirecting`)
        else P('warn', 'IP-NOT-CANONICAL', `${rec.start} ends at ${finalUrl} (${lastStatus}); the IP does not reach ${CANON} (LIVE-SECURITY-SCAN K-5)`)
      }
    }
    // path / query / percent-encoding survival
    let pathState = 'n/a', queryState = 'n/a', encState = 'n/a'
    const start = parseUrl(rec.start)
    if ((canon || kind === 'ip') && toCanon && !rec.loop && !rec.foreign) {
      const [p0, q0] = splitPQ(start.path)
      const [p1, q1] = splitPQ(rec.final.path)
      pathState = p0 === p1 ? 'same' : safeDecode(p0) === safeDecode(p1) ? 'recoded' : 'CHANGED'
      queryState = q0 === q1 ? 'same' : q0 !== null && q1 === null ? 'DROPPED' : q0 === null ? 'ADDED' : safeDecode(q0) === safeDecode(q1) ? 'recoded' : 'CHANGED'
      encState = pathState === 'recoded' || queryState === 'recoded' ? 'CHANGED' : 'same'
      if (pathState === 'CHANGED') P('bad', 'DROP-PATH', `${start.path} became ${rec.final.path}`)
      if (queryState === 'DROPPED' || queryState === 'CHANGED') P('bad', 'DROP-QUERY', `?${q0} became ${q1 === null ? 'nothing' : '?' + q1}`)
      if (encState === 'CHANGED') P('warn', 'PCT-CHANGED', `percent-encoding differs: ${clip(start.path, 70)} -> ${clip(rec.final.path, 70)}`)
    }
    // the apex must never serve content itself; HSTS and cache of each response
    rec.hops.forEach((h, i) => {
      const isRedirect = h.status >= 300 && h.status < 400
      if (h.effHost === APEX && h.status >= 200 && h.status < 300) {
        const html = /html/i.test(hv(h.headers, 'content-type') || '')
        P(html ? 'bad' : 'warn', html ? 'APEX-200-HTML' : 'APEX-200', `h${i} ${h.req} answers ${h.status} ${hv(h.headers, 'content-type') || ''} from the apex itself`)
      }
      if (h.u.scheme === 'https' && (h.effHost === APEX || h.effHost === WWW) && h.status > 0) hstsCheck(h, isRedirect)
      if ([301, 308].includes(h.status) && KNOWN.has(h.effHost)) cacheCheck(h)
    })
    if (rec.hops[0] && [301, 308].includes(rec.hops[0].status)) permStatus.push({ spelling: `${rec.hops[0].u.scheme}://${spec.hostHeader || rec.hops[0].u.auth}`, path: splitPQ(rec.hops[0].u.path)[0], status: rec.hops[0].status, by: rec.hops[0].by })
    // wrong Host: must not serve the shop
    if (kind === 'wrong') {
      const f = lastH
      if (f && f.status >= 200 && f.status < 300) P('bad', 'HOST-LEAK', `Host ${spec.hostHeader} gets ${f.status} ${hv(f.headers, 'content-type') || ''} (${f.body ? clip(f.body.replace(/\s+/g, ' '), 40) : 'no body read'}): an unknown name is served`)
      else if (rec.redirects && !toCanon && !rec.foreign) P('warn', 'HOST-REDIRECT', `Host ${spec.hostHeader} is sent to ${finalUrl}`)
    }
    // final status
    if (lastH && lastH.status >= 500) P('bad', 'FINAL-5XX', `${rec.start} ends in ${lastH.status}`)
    else if (spec.expect200 && lastH && lastH.status !== 200 && !problems) P('warn', 'FINAL-STATUS', `${rec.start} ends in ${lastH.status}, expected 200`)

    L(`  => hops=${rec.redirects} final=${finalUrl} [${lastH?.status || 'ERR'}] path=${pathState} query=${queryState} enc=${encState}${problems ? '' : '  OK'}`)
    if (!problems) counts.ok++
  }

  function hstsCheck(h, isRedirect) {
    const host = h.effHost
    const k = `${host}|${isRedirect ? 'redirect' : 'page'}`
    if (hstsSeen.has(k)) return
    hstsSeen.add(k)
    const hs = parseHsts(hv(h.headers, 'strict-transport-security'))
    const what = `${host} ${isRedirect ? 'redirect' : h.status}`
    if (!hs) {
      if (host === APEX && isRedirect) flag('warn', 'NO-HSTS-APEX', `https://${host} redirect has no Strict-Transport-Security: a visitor who only ever types the bare domain never learns HSTS (browsers ignore it on http)`, k)
      else flag('warn', 'NO-HSTS', `${what} has no Strict-Transport-Security`, k)
      return
    }
    if (hs.maxAge === null || hs.maxAge < 15552000) flag('warn', 'HSTS-WEAK', `${what}: max-age=${hs.maxAge} is under 180 days (preload needs 31536000)`, k)
    else if (hs.maxAge < 31536000) flag('warn', 'HSTS-WEAK', `${what}: max-age=${hs.maxAge} is under one year (preload needs 31536000)`, k)
    if (!hs.sub) flag('warn', 'HSTS-NO-SUBDOMAINS', `${what}: no includeSubDomains`, k)
    if (!hs.preload) flag('warn', 'HSTS-NO-PRELOAD', `${what}: no preload (optional; only when every subdomain is https and the hstspreload.org rules are met)`, 'preload')
    if (hs.maxAge >= 31536000 && hs.sub) good('HSTS', `${what}: max-age=${hs.maxAge}${hs.sub ? ' includeSubDomains' : ''}${hs.preload ? ' preload' : ''}`, k)
  }
  function cacheCheck(h) {
    const k = `${h.u.scheme}://${h.effHost}`
    const cc = hv(h.headers, 'cache-control') || ''
    const exp = hv(h.headers, 'expires')
    const m = /max-age\s*=\s*(\d+)/i.exec(cc)
    if (!cc && !exp) flag('warn', 'PERM-REDIR-CACHE', `${h.status} from ${k} has no Cache-Control/Expires: browsers cache a permanent redirect for a very long time (Chrome: until cleared), so a later change of canonical host or scheme will not reach returning visitors`, k)
    else if (m && Number(m[1]) >= 31536000) flag('warn', 'PERM-REDIR-CACHE', `${h.status} from ${k} may be cached for ${m[1]}s (a year or more): fine once the setup is final, a trap before that`, k)
    else good('PERM-REDIR-CACHE', `${h.status} from ${k} cache: ${clip(cc || 'Expires ' + exp, 50)}`, k)
  }

  // ---------------------------------------------------------------------- DNS
  const DNS_METHOD = { A: 'resolve4', AAAA: 'resolve6', CNAME: 'resolveCname', NS: 'resolveNs', SOA: 'resolveSoa', MX: 'resolveMx', TXT: 'resolveTxt', CAA: 'resolveCaa' }
  const NODATA = new Set(['ENODATA', 'ENOTFOUND', 'ENOENT'])
  const fmtRec = {
    SOA: (s) => `ns=${s.nsname} serial=${s.serial} refresh=${s.refresh} min=${s.minttl}`,
    MX: (m) => `${m.priority} ${m.exchange}`,
    TXT: (t) => (Array.isArray(t) ? t.join('') : String(t)),
    CAA: (c) => Object.entries(c).filter(([k]) => k !== 'critical').map(([k, v]) => `${k} ${v}`).join(' '),
  }
  let dnsQueries = 0
  async function dnsQ(type, name) {
    dnsQueries++
    try {
      const r = await cfg.resolver[DNS_METHOD[type]](name)
      const arr = Array.isArray(r) ? r : [r]
      return { recs: arr.map((x) => (fmtRec[type] ? fmtRec[type](x) : String(x))), err: null }
    } catch (e) {
      return { recs: [], err: NODATA.has(e.code) ? null : (e.code || e.message) }
    }
  }
  // DoH: Cloudflare returns CAA as RFC 3597 hex (\# 22 0005...); decode it so both views compare.
  function dohNorm(type, data) {
    let d = String(data).trim()
    if (type === 'TXT') return d.replace(/^"|"$/g, '').replace(/"\s+"/g, '')
    if (type === 'CAA') {
      const m = /^\\#\s+\d+\s+([0-9a-fA-F]+)$/.exec(d)
      if (m) { const b = Buffer.from(m[1], 'hex'); const tl = b[1]; return `${b.toString('ascii', 2, 2 + tl)} ${b.toString('ascii', 2 + tl)}` }
      const c = /^\d+\s+(\w+)\s+"?(.*?)"?$/.exec(d)
      return c ? `${c[1]} ${c[2]}` : d
    }
    if (type === 'MX') { const [p, ...r] = d.split(/\s+/); return `${p} ${r.join(' ').replace(/\.$/, '').toLowerCase()}` }
    if (type === 'SOA') { const p = d.split(/\s+/); return `ns=${p[0].replace(/\.$/, '').toLowerCase()} serial=${p[2]} refresh=${p[3]} min=${p[6]}` }
    return d.replace(/\.$/, '').toLowerCase()
  }
  let dohDead = null
  async function doh(type, name) {
    if (dohDead) return null
    await gate()
    const u = new URL(cfg.dohBase)
    u.searchParams.set('name', name)
    u.searchParams.set('type', type)
    return new Promise((resolve) => {
      const lib = u.protocol === 'http:' ? http : https
      const req = lib.get(u, { headers: { accept: 'application/dns-json', 'user-agent': 'sporta-apex-check/1' }, timeout: 8000 }, (res) => {
        const ch = []
        res.on('data', (c) => ch.push(c))
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error('HTTP ' + res.statusCode)
            const j = JSON.parse(Buffer.concat(ch).toString('utf8'))
            const want = { A: 1, AAAA: 28, CNAME: 5, NS: 2, SOA: 6, MX: 15, TXT: 16, CAA: 257 }[type]
            resolve({ status: j.Status, recs: (j.Answer || []).filter((a) => a.type === want).map((a) => dohNorm(type, a.data)), ttl: (j.Answer || []).find((a) => a.type === want)?.TTL })
          } catch (e) { dohDead = e.message; resolve(null) }
        })
      })
      req.on('timeout', () => { req.destroy(); dohDead = 'timeout' })
      req.on('error', (e) => { dohDead = e.code || e.message; resolve(null) })
    })
  }

  async function dnsSection() {
    L('== 1 DNS (resolver view: system resolver via dns.promises; DoH view: ' + clip(cfg.dohBase, 40) + ')')
    const types = ['A', 'AAAA', 'CNAME', 'NS', 'SOA', 'MX', 'TXT', 'CAA']
    const view = {}
    for (const name of [APEX, WWW]) {
      view[name] = {}
      for (const t of types) view[name][t] = await dnsQ(t, name)
      const v = view[name]
      const short = (t) => (v[t].err ? `ERR(${v[t].err})` : v[t].recs.length ? v[t].recs.join(',') : '-')
      L(`DNS ${name === APEX ? '@' : 'www'} A=${short('A')} AAAA=${short('AAAA')} CNAME=${short('CNAME')} NS=${short('NS')} MX=${short('MX')} CAA=${short('CAA')}`)
      L(`DNS ${name === APEX ? '@' : 'www'} SOA=${short('SOA')}`)
      for (const t of v.TXT.recs) L(`DNS ${name === APEX ? '@' : 'www'} TXT ${clip(t, 110)}`)
      if (v.TXT.err) L(`DNS ${name} TXT ERR(${v.TXT.err})`)
    }
    // verdicts
    const a = view[APEX], w = view[WWW]
    const errs = Object.entries({ ...Object.fromEntries(types.map((t) => ['@' + t, a[t]])), ...Object.fromEntries(types.map((t) => ['www' + t, w[t]])) }).filter(([, x]) => x.err)
    if (errs.length) flag('warn', 'DNS-RESOLVER-ERR', `lookups failed: ${errs.map(([k, x]) => k + '=' + x.err).join(' ')}`)
    if (a.A.recs.includes(VPS_IP)) good('DNS-APEX-A', `apex A ${a.A.recs.join(',')} includes ${VPS_IP}`)
    else flag('bad', 'DNS-NOT-VPS', `apex A is ${a.A.recs.join(',') || 'empty'}, expected ${VPS_IP}`, 'apex')
    if (w.A.recs.includes(VPS_IP)) good('DNS-WWW-A', `www resolves to ${w.A.recs.join(',')}${w.CNAME.recs.length ? ' via CNAME ' + w.CNAME.recs[0] : ''}`)
    else flag('bad', 'DNS-NOT-VPS', `www resolves to ${w.A.recs.join(',') || 'nothing'}, expected ${VPS_IP}`, 'www')
    if (a.CNAME.recs.length) flag('bad', 'DNS-APEX-CNAME', `apex has a CNAME (${a.CNAME.recs[0]}); a CNAME at the zone apex cannot coexist with NS/SOA/MX/TXT`)
    for (const [n, x] of [['apex', a], ['www', w]]) {
      if (x.AAAA.recs.length) flag('warn', 'AAAA-PRESENT', `${n} has AAAA ${x.AAAA.recs.join(',')}; the VPS is served over IPv4 ${VPS_IP}, verify 443 answers on v6 or remove it`, n)
      else good('NO-AAAA', `${n} has no AAAA (IPv4 only, as the VPS)`, n)
    }
    if (a.NS.recs.length >= 2) good('DNS-NS', `${a.NS.recs.length} name servers`)
    else flag('warn', 'NS-SINGLE', `only ${a.NS.recs.length} NS record(s) at the apex`)
    if (!a.SOA.recs.length) flag('warn', 'SOA-MISSING', 'no SOA answer for the apex')
    // CAA
    if (!a.CAA.recs.length) flag('warn', 'CAA-NONE', 'no CAA at the apex: any CA may issue (not wrong, only unrestricted)')
    else if (a.CAA.recs.some((c) => /issue(wild)?\s+"?letsencrypt\.org/i.test(c))) good('CAA', `CAA allows Let's Encrypt (${a.CAA.recs.join('; ')})`)
    else if (a.CAA.recs.some((c) => /^issue\s+";?"?$/i.test(c))) flag('bad', 'CAA-NO-LE', 'CAA forbids all issuance')
    else flag('bad', 'CAA-NO-LE', `CAA does not name letsencrypt.org (${a.CAA.recs.join('; ')}): Traefik cannot renew`)
    // DoH cross-check
    if (cfg.dohBase) {
      let diffs = 0, asked = 0
      for (const name of [APEX, WWW]) {
        const row = []
        for (const t of types) {
          const d = await doh(t, name)
          if (!d) break
          asked++
          const mine = view[name][t].recs.map((s) => (t === 'TXT' ? s : String(s).toLowerCase())).sort().join('|')
          const theirs = d.recs.map((s) => (t === 'TXT' ? s : String(s).toLowerCase())).sort().join('|')
          row.push(`${t}=${d.recs.length ? clip(d.recs.join(','), 40) : '-'}${d.ttl !== undefined ? '/' + d.ttl : ''}`)
          if (['A', 'AAAA', 'CNAME', 'NS', 'MX', 'CAA'].includes(t) && mine !== theirs) { diffs++; flag('warn', 'DNS-DOH-DIFF', `${name} ${t}: system resolver [${clip(mine, 60) || '-'}] vs DoH [${clip(theirs, 60) || '-'}] (propagation, or a resolver-specific view)`, name + t) }
        }
        if (row.length) L(`DOH ${name === APEX ? '@' : 'www'} ${row.join(' ')} (value/ttl)`)
      }
      if (dohDead) flag('warn', 'DOH-BLOCKED', `DoH at ${cfg.dohBase} is not reachable from here (${dohDead}); only the system resolver view exists`)
      else if (!diffs) good('DNS-DOH', `${asked} DoH answers agree with the system resolver`)
    }
    return view
  }

  // ---------------------------------------------------------------------- TLS
  function tlsProbe({ host, port, sni }) {
    return new Promise(async (resolve) => {
      try { await gate() } catch (e) { return resolve({ error: e.message }) }
      const o = { host, port, ALPNProtocols: ['h2', 'http/1.1'], rejectUnauthorized: false, timeout: 10000 }
      if (sni) o.servername = sni
      if (cfg.ca) o.ca = cfg.ca
      let done = false
      const fin = (r) => { if (!done) { done = true; resolve(r) } }
      const s = tls.connect(o, () => {
        const cert = s.getPeerCertificate(true)
        const chain = []
        const fps = new Set()
        for (let c = cert; c && c.fingerprint256 && !fps.has(c.fingerprint256); c = c.issuerCertificate) { fps.add(c.fingerprint256); chain.push(c) }
        const r = { protocol: s.getProtocol(), alpn: s.alpnProtocol, cipher: s.getCipher()?.name, authorized: s.authorized, authError: s.authorizationError ? String(s.authorizationError.code || s.authorizationError) : null, cert, chain }
        s.end()
        fin(r)
      })
      s.on('timeout', () => { s.destroy(); fin({ error: 'timeout' }) })
      s.on('error', (e) => fin({ error: e.code || e.message }))
    })
  }
  const sanList = (c) => String(c?.subjectaltname || '').split(/,\s*/).filter((x) => x.startsWith('DNS:')).map((x) => x.slice(4).toLowerCase())
  const sanCovers = (sans, name) => sans.some((s) => s === name || (s.startsWith('*.') && name.split('.').slice(1).join('.') === s.slice(2) && name.split('.').length === s.split('.').length))
  const cnOf = (o) => (o && (o.CN || o.O)) || '?'

  async function tlsSection() {
    L('== 2 TLS (443)')
    const port = cfg.httpsPort || 443
    const targets = [
      { label: 'apex', host: cfg.connect, sni: APEX, name: APEX },
      { label: 'www@ip', host: cfg.vpsConnect || VPS_IP, sni: WWW, name: WWW },
      { label: 'no-sni', host: cfg.connect, sni: null, name: null },
      { label: 'sni-evil.example', host: cfg.connect, sni: 'evil.example', name: null },
    ]
    for (const t of targets) {
      let r = await tlsProbe({ host: t.host, port, sni: t.sni })
      if (r.error && t.host !== cfg.connect && t.name) {
        // the public address may not be reachable from the VPS itself (no hairpin): say so, ask the local Traefik instead
        L(`TLS ${t.label} ${t.host}:${port} ERR ${r.error}; retrying through ${cfg.connect}`)
        r = await tlsProbe({ host: cfg.connect, port, sni: t.sni })
        if (!r.error) note(`${t.label}: ${t.host} is not reachable from the VPS itself (${VPS_IP} hairpin); answered by ${cfg.connect}`)
      }
      if (r.error) {
        L(`TLS ${t.label} connect ${t.host}:${port} ERR ${r.error}`)
        if (t.name) flag('bad', 'TLS-CONNECT', `${t.label}: ${r.error}`, t.label)
        continue
      }
      const c = r.cert
      const sans = sanList(c)
      const left = c.valid_to ? Math.floor((Date.parse(c.valid_to) - Date.now()) / 86400000) : NaN
      L(`TLS ${t.label} ${r.protocol} alpn=${r.alpn || 'none'} ${r.cipher} issuer=${cnOf(c.issuer)}${c.issuer?.O ? '/' + c.issuer.O : ''} subject=${cnOf(c.subject)}`)
      L(`TLS ${t.label} valid ${c.valid_from} .. ${c.valid_to} left=${left}d chain=${r.chain.map((x) => cnOf(x.subject)).join('<-')} authorized=${r.authorized}${r.authError ? '(' + r.authError + ')' : ''}`)
      L(`TLS ${t.label} SAN ${clip(sans.join(' '), 150)}`)
      if (!t.name) {
        const extra = sans.filter((s) => s !== APEX && s !== WWW)
        if (extra.length) flag('warn', 'TLS-DEFAULT-CERT-LEAK', `${t.label} (no matching name) presents a certificate naming other hosts: ${clip(extra.join(' '), 100)}`, t.label)
        else good('TLS-DEFAULT-CERT', `${t.label} presents ${cnOf(c.subject)}: no other hostnames named`, t.label)
        continue
      }
      if (sanCovers(sans, APEX)) good('TLS-APEX-IN-SAN', `${t.label}: ${APEX} is in the SAN`, t.label)
      else flag('bad', 'TLS-APEX-NOT-IN-SAN', `${t.label}: ${APEX} is NOT in the certificate SAN (${clip(sans.join(' '), 80)}): https://${APEX} shows a certificate warning`, t.label)
      if (!sanCovers(sans, WWW)) flag('bad', 'TLS-WWW-NOT-IN-SAN', `${t.label}: ${WWW} is not in the SAN`, t.label)
      if (!(left > 0)) flag('bad', 'TLS-EXPIRING', `${t.label}: certificate expired or unreadable (${c.valid_to})`, t.label)
      else if (left < 7) flag('bad', 'TLS-EXPIRING', `${t.label}: ${left} days left, renewal is failing`, t.label)
      else if (left < 21) flag('warn', 'TLS-EXPIRING', `${t.label}: ${left} days left (Let's Encrypt renews at 30)`, t.label)
      else good('TLS-DAYS', `${t.label}: ${left} days left`, t.label)
      if (r.authorized) good('TLS-CHAIN', `${t.label}: chain verifies to a trusted root (${r.chain.length} certs seen)`, t.label)
      else if (r.authError === 'ERR_TLS_CERT_ALTNAME_INVALID') { /* the SAN flag above already says it */ }
      else flag('bad', 'TLS-CHAIN-INCOMPLETE', `${t.label}: chain does not verify (${r.authError}); a missing intermediate or an untrusted issuer`, t.label)
      if (/^TLSv1(\.0|\.1)?$/.test(r.protocol || '')) flag('bad', 'TLS-OLD-PROTOCOL', `${t.label}: ${r.protocol}`, t.label)
      else good('TLS-PROTOCOL', `${t.label}: ${r.protocol}`, t.label)
      if (r.alpn === 'h2') good('TLS-ALPN-H2', `${t.label}: ALPN h2`, t.label)
      else flag('warn', 'TLS-ALPN-NO-H2', `${t.label}: ALPN negotiated ${r.alpn || 'nothing'}, not h2`, t.label)
    }
  }

  // ---------------------------------------------------------------------- redirect map
  const MAP = [
    // [start, spec]
    ['http://sporta.com.kw/', { kind: 'apex', expect200: true }],
    ['https://sporta.com.kw/', { kind: 'apex', expect200: true }],
    ['http://www.sporta.com.kw/', { kind: 'wwwhttp', expect200: true }],
    ['https://www.sporta.com.kw/', { kind: 'www', expect200: true }],
    ['http://187.7.78.123/', { kind: 'ip' }],
    ['https://187.7.78.123/', { kind: 'ip', insecure: true }],
    ['http://sporta.com.kw/shop?lang=en&x=1', { kind: 'apex', expect200: true }],
    ['https://sporta.com.kw/shop?lang=en&x=1', { kind: 'apex', expect200: true }],
    ['https://sporta.com.kw/sitemap.xml', { kind: 'apex', expect200: true }],
    ['http://sporta.com.kw/sitemap.xml', { kind: 'apex', expect200: true }],
    ['http://www.sporta.com.kw/sitemap.xml', { kind: 'wwwhttp', expect200: true }],
    ['https://www.sporta.com.kw/sitemap.xml', { kind: 'www', expect200: true }],
    ['https://sporta.com.kw/robots.txt', { kind: 'apex', expect200: true }],
    ['http://sporta.com.kw/robots.txt', { kind: 'apex', expect200: true }],
    ['http://sporta.com.kw/.well-known/acme-challenge/test', { kind: 'acme' }],
    ['https://sporta.com.kw/%D8%AA%D8%B3%D9%88%D9%82', { kind: 'apex' }],
    ['http://sporta.com.kw/%D8%AA%D8%B3%D9%88%D9%82?q=%D8%AD%D8%B0%D8%A7%D8%A1&lang=ar', { kind: 'apex' }],
    ['https://sporta.com.kw/%d8%aa%d8%b3%d9%88%d9%82', { kind: 'apex' }],
    ['https://sporta.com.kw/backends', { kind: 'apex', expect200: true }],
    ['https://sporta.com.kw/api/api.php?r=products', { kind: 'apex', expect200: true }],
    // Host header variants (SNI stays the clean name; only the Host header differs)
    ['https://sporta.com.kw/', { kind: 'variant', hostHeader: 'SPORTA.COM.KW', sni: APEX, expect200: true }],
    ['https://sporta.com.kw/', { kind: 'variant', hostHeader: 'sporta.com.kw.', sni: APEX, expect200: true }],
    ['https://sporta.com.kw/', { kind: 'variant', hostHeader: 'sporta.com.kw:443', sni: APEX, expect200: true }],
    ['http://sporta.com.kw/', { kind: 'variant', hostHeader: 'SPORTA.COM.KW', expect200: true }],
    ['http://sporta.com.kw/', { kind: 'variant', hostHeader: 'sporta.com.kw.', expect200: true }],
    ['http://sporta.com.kw/', { kind: 'variant', hostHeader: 'sporta.com.kw:443', expect200: true }],
    // wrong names must not serve the shop
    ['http://sporta.com.kw/', { kind: 'wrong', hostHeader: 'evil.example', maxBody: 300 }],
    ['https://sporta.com.kw/', { kind: 'wrong', hostHeader: 'evil.example', sni: 'evil.example', insecure: true, maxBody: 300 }],
  ]
  async function mapSection() {
    L('== 3 redirect map (manual, max 6 hops; hN status location {headers})')
    for (const [start, spec] of MAP) {
      const rec = await follow(start, { ...spec })
      printChain(rec)
      judge(rec)
    }
    // permanent-redirect status mix (301 vs 308)
    const codes = new Set(permStatus.map((p) => p.status))
    const groups = [...codes].sort().map((c) => `${c}: ${[...new Set(permStatus.filter((p) => p.status === c).map((p) => `${p.spelling}${p.path === '/' ? '' : p.path} by=${p.by}`))].join(' ; ')}`)
    if (codes.size > 1) {
      flag('warn', 'STATUS-MIX', `permanent redirects answer with different codes: ${groups.join(' | ')}. 308 keeps the request method and body (RFC 7538), 301 lets old clients turn POST into GET; both pass SEO signals alike. Two codes means two layers answer (by=apache is the .htaccess RewriteRule, by=edge? is Traefik): pick one`)
    } else if (codes.size === 1) good('STATUS-MIX', `every permanent redirect uses ${[...codes][0]}`)
    // never content on the apex
    if (apexResponses && !apex2xx) good('APEX-NEVER-200', `${apexResponses} responses came from the apex host, none was 2xx`)
    else if (apex2xx) L(`  apex answered 2xx ${apex2xx} time(s) of ${apexResponses}`)
    // known trade-off, stated once
    const first = chains.find((c) => c.start === 'http://sporta.com.kw/')
    if (first && first.redirects === 1 && first.hops[0]?.location?.startsWith('https://www.')) note('hstspreload.org asks that http://apex first redirect to https://apex (which then carries HSTS) before leaving for another host; the one-hop rule goes straight to www. Decide which matters before any preload submission (verify the rule on hstspreload.org).')
  }

  // ---------------------------------------------------------------------- content parity
  function attrsOf(tag) {
    const o = {}
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) o[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4]
    return o
  }
  async function pageGet(path, id) {
    const u = parseUrl(CANON + path)
    const r = await hop(u, { maxBody: 400000 })
    return { r, u }
  }
  async function contentSection() {
    L('== 4 content parity on www (canonical / hreflang / absolute URLs)')
    const exp = {
      '/': { canonical: CANON + '/', alt: { ar: CANON + '/', en: CANON + '/?lang=en', 'x-default': CANON + '/' } },
      '/?lang=en': { canonical: CANON + '/?lang=en' },
    }
    for (const [path, e] of Object.entries(exp)) {
      let g
      try { g = await pageGet(path) } catch (err) { flag('warn', 'CONTENT-FETCH', `${path}: ${err.message}`, path); continue }
      const { r } = g
      if (r.status !== 200) { flag('warn', 'CONTENT-FETCH', `${CANON}${path} answered ${r.status || r.error}, no HTML to inspect`, path); continue }
      const html = r.body
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0]))
      const canon = links.find((l) => /canonical/i.test(l.rel || ''))
      const alts = links.filter((l) => /alternate/i.test(l.rel || '') && l.hreflang)
      L(`HTML ${path} canonical=${canon?.href || '-'} hreflang=${alts.map((a) => a.hreflang + '>' + a.href).join(' ') || '-'} build=${(/<meta[^>]+name=["']sporta-build["'][^>]*>/i.exec(html) ? 'sporta-web' : 'other/none')}`)
      const notWww = [canon?.href, ...alts.map((a) => a.href)].filter((h) => h && !h.startsWith(CANON + '/') && h !== CANON)
      if (!canon) flag('warn', 'CANON-MISSING', `${path}: no <link rel=canonical>`, path)
      else if (notWww.length) flag('bad', 'CANON-NOT-WWW', `${path}: canonical/hreflang points off ${CANON}: ${clip(notWww.join(' '), 120)}`, path)
      else if (canon.href !== e.canonical) flag('warn', 'CANON-DIFF', `${path}: canonical ${canon.href}, expected ${e.canonical}`, path)
      else good('CANON', `${path}: canonical ${canon.href}`, path)
      if (e.alt) {
        const miss = Object.entries(e.alt).filter(([lang, href]) => alts.find((a) => a.hreflang === lang)?.href !== href)
        if (miss.length) flag('warn', 'HREFLANG-DIFF', `${path}: hreflang ${miss.map(([l, h]) => `${l} expected ${h} got ${alts.find((a) => a.hreflang === l)?.href ?? 'none'}`).join('; ')}`, path)
        else good('HREFLANG', `${path}: ar/en/x-default all on www`, path)
      }
      const abs = [...html.matchAll(/https?:\/\/[A-Za-z0-9.-]*sporta\.com\.kw(?=[/"'?#\s<)\\]|$)[^\s"'<>)\\]*/gi)].map((m) => m[0])
      const apexUrls = abs.filter((x) => parseUrl(x)?.host === APEX)
      const httpUrls = abs.filter((x) => /^http:\/\//i.test(x))
      if (apexUrls.length) flag('warn', 'APEX-URL-IN-HTML', `${path}: ${apexUrls.length} absolute URL(s) on the bare domain, each costs a redirect: ${clip(apexUrls.slice(0, 3).join(' '), 110)}`, path)
      if (httpUrls.length) flag('warn', 'HTTP-URL-IN-HTML', `${path}: ${httpUrls.length} absolute http:// URL(s): ${clip(httpUrls.slice(0, 3).join(' '), 110)}`, path)
      if (!apexUrls.length && !httpUrls.length) good('HTML-URLS', `${path}: ${abs.length} absolute sporta URLs, all https://www`, path)
    }
    for (const [path, what] of [['/sitemap.xml', 'sitemap'], ['/robots.txt', 'robots']]) {
      let g
      try { g = await pageGet(path) } catch (err) { flag('warn', 'CONTENT-FETCH', `${path}: ${err.message}`, path); continue }
      if (g.r.status !== 200) { flag('warn', 'CONTENT-FETCH', `${path} answered ${g.r.status || g.r.error}`, path); continue }
      const urls = what === 'sitemap' ? [...g.r.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>|<xhtml:link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => (m[1] || m[2]).trim()) : [...g.r.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
      const off = urls.filter((x) => !x.startsWith(CANON + '/') && x !== CANON)
      if (off.length) flag('warn', 'SITEMAP-NOT-WWW', `${path}: ${off.length}/${urls.length} URL(s) not on ${CANON}: ${clip(off.slice(0, 2).join(' '), 90)}`, path)
      else good('SITEMAP-WWW', `${path}: ${urls.length} URL(s), all on ${CANON}`, path)
    }
  }

  // ---------------------------------------------------------------------- methods
  async function methodsSection() {
    L('== 5 HEAD parity, OPTIONS, TRACE on the apex')
    for (const start of ['https://sporta.com.kw/shop?lang=en&x=1', 'http://sporta.com.kw/shop?lang=en&x=1']) {
      const g = chains.find((c) => c.start === start)
      const u = parseUrl(start)
      const h = await hop(u, { method: 'HEAD' })
      const a = g?.hops[0]
      if (!a) continue
      const diffs = []
      if (a.status !== h.status) diffs.push(`status GET ${a.status} HEAD ${h.status}`)
      if ((a.location || '') !== (hv(h.headers, 'location') || '')) diffs.push(`Location GET ${a.location} HEAD ${hv(h.headers, 'location')}`)
      const soft = ['strict-transport-security', 'cache-control'].filter((k) => (hv(a.headers, k) || '') !== (hv(h.headers, k) || ''))
      L(`PAR HEAD ${start} -> ${h.status} ${hv(h.headers, 'location') || '-'} ${hdrSummary(h.headers)}`)
      if (diffs.length) flag('bad', 'HEAD-GET-DIFF', `${start}: ${diffs.join('; ')}`, start)
      else if (soft.length) flag('warn', 'HEAD-GET-HEADERS', `${start}: ${soft.join(', ')} differ between GET and HEAD`, start)
      else good('HEAD-GET', `${start}: HEAD matches GET (${h.status})`, start)
    }
    let redirectedNonGet = false
    for (const start of ['https://sporta.com.kw/', 'http://sporta.com.kw/']) {
      for (const method of ['OPTIONS', 'TRACE']) {
        const r = await hop(parseUrl(start), { method, maxBody: 300 })
        const allow = hv(r.headers, 'allow')
        L(`M ${method} ${start} -> ${r.status || r.error} ${hv(r.headers, 'location') || '-'} allow=${allow || '-'} ${hdrSummary(r.headers)}`)
        const k = method + start
        if (method === 'TRACE') {
          if (r.status === 200 || /message\/http/i.test(hv(r.headers, 'content-type') || '') || /^TRACE /i.test(r.body || '')) flag('bad', 'TRACE-ENABLED', `${start} answers TRACE with ${r.status} ${hv(r.headers, 'content-type') || ''} (cross-site tracing)`, k)
          else if (r.status >= 500 || r.status === 0) flag('warn', 'TRACE-5XX', `${start} TRACE -> ${r.status || r.error}`, k)
          else good('TRACE', `${start} TRACE refused or redirected (${r.status})`, k)
        } else if (r.status >= 500 || r.status === 0) flag('warn', 'OPTIONS-5XX', `${start} OPTIONS -> ${r.status || r.error}`, k)
        else if ([200, 204].includes(r.status) && /\b(PUT|DELETE|TRACE|PATCH)\b/i.test(allow || '')) flag('warn', 'OPTIONS-ALLOW', `${start} OPTIONS advertises ${allow}`, k)
        else good('OPTIONS', `${start} OPTIONS -> ${r.status}`, k)
        if ([301, 302].includes(r.status)) redirectedNonGet = true
      }
    }
    if (redirectedNonGet) note('OPTIONS/TRACE got a 301/302: a client that follows may re-send as GET; a 308/307 would keep the method. Harmless for a canonical-host redirect, noted because the two codes differ in exactly this.')
  }

  // ---------------------------------------------------------------------- mail posture
  const parseTags = (s) => Object.fromEntries(s.split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] }))
  async function spfWalk(domain, st, depth, top) {
    if (st.q >= 14) { st.partial = true; return }
    st.q++
    const r = await dnsQ('TXT', domain)
    const recs = r.recs.filter((s) => /^v=spf1(\s|$)/i.test(s))
    if (depth === 0) st.records = recs
    if (!recs.length) { st.missing.push(domain); return }
    for (const t of recs[0].trim().split(/\s+/).slice(1)) {
      const m = /^([+\-~?])?([A-Za-z0-9]+)(?:[:=]([^\s]*))?(\/\d.*)?$/.exec(t)
      if (!m) continue
      const name = m[2].toLowerCase()
      if (name === 'include' || name === 'redirect') {
        st.count++
        if (name === 'redirect') st.redirect = true
        if (depth < 6 && m[3]) await spfWalk(m[3], st, depth + 1, top && name === 'redirect')
      } else if (['a', 'mx', 'exists'].includes(name)) st.count++
      else if (name === 'ptr') { st.count++; st.ptr = true }
      else if (name === 'all' && top) st.all = (m[1] || '+') + 'all'
    }
  }
  async function mailSection() {
    L('== 6 mail posture at the apex (DNS)')
    const mx = await dnsQ('MX', APEX)
    L(`MAIL MX ${mx.recs.join(' | ') || (mx.err ? 'ERR(' + mx.err + ')' : '-')}`)
    if (!mx.recs.length) flag('warn', 'MX-NONE', 'the apex has no MX: nobody can write to @sporta.com.kw (cs@ is the contact address on the site and in the DMARC rua)')
    else good('MX', `${mx.recs.length} MX record(s)`)
    for (const rec of mx.recs.slice(0, 3)) {
      const host = rec.split(' ')[1]
      const a = await dnsQ('A', host)
      if (!a.recs.length) flag('bad', 'MX-UNRESOLVABLE', `MX host ${host} has no A record`, host)
    }
    // DMARC first (SPF's ~all is acceptable only with an enforcing DMARC)
    const dm = await dnsQ('TXT', '_dmarc.' + APEX)
    const dmRecs = dm.recs.filter((s) => /^v=DMARC1/i.test(s))
    let dmPolicy = null
    if (!dmRecs.length) { L('MAIL DMARC none'); flag('bad', 'DMARC-MISSING', 'no DMARC record at _dmarc: receivers have no policy for forged @sporta.com.kw mail') }
    else {
      const t = parseTags(dmRecs[0])
      dmPolicy = (t.p || '').toLowerCase()
      L(`MAIL DMARC p=${t.p || '-'} sp=${t.sp || '-'} pct=${t.pct || '100'} rua=${t.rua || '-'} ruf=${t.ruf || '-'} adkim=${t.adkim || '-'} aspf=${t.aspf || '-'}${dmRecs.length > 1 ? ' (' + dmRecs.length + ' records!)' : ''}`)
      if (dmRecs.length > 1) flag('bad', 'DMARC-MULTIPLE', `${dmRecs.length} DMARC records: receivers ignore them all`)
      if (dmPolicy === 'none') flag('warn', 'DMARC-WEAK', 'DMARC p=none only monitors; DNS-EMAIL-RECORDS.txt plans quarantine once reports are clean')
      else if (['quarantine', 'reject'].includes(dmPolicy)) good('DMARC', `p=${dmPolicy}${t.pct && t.pct !== '100' ? ' pct=' + t.pct : ''}`)
      else flag('bad', 'DMARC-INVALID', `p=${t.p || '(missing)'} is not none/quarantine/reject`)
      if (!t.rua) flag('warn', 'DMARC-NO-RUA', 'no rua= address: nobody receives the aggregate reports')
      else {
        for (const m of t.rua.split(',')) {
          const dom = /@([^!>,\s]+)/.exec(m)?.[1]?.toLowerCase()
          if (dom && dom !== APEX && !dom.endsWith('.' + APEX)) {
            const ext = await dnsQ('TXT', `${APEX}._report._dmarc.${dom}`)
            if (!ext.recs.some((s) => /^v=DMARC1/i.test(s))) flag('warn', 'DMARC-RUA-UNAUTHORISED', `rua goes to ${dom} which has no ${APEX}._report._dmarc authorisation record`, dom)
          }
        }
      }
    }
    // SPF
    const st = { count: 0, q: 0, missing: [], all: null, redirect: false, ptr: false, partial: false, records: [] }
    await spfWalk(APEX, st, 0, true)
    if (!st.records.length) { L('MAIL SPF none'); flag('bad', 'SPF-MISSING', 'no SPF record at the apex') }
    else {
      L(`MAIL SPF records=${st.records.length} lookups=${st.count}/10${st.partial ? '+ (walk capped)' : ''} all=${st.all || '-'} ${clip(st.records[0], 110)}`)
      if (st.records.length > 1) flag('bad', 'SPF-MULTIPLE', `${st.records.length} SPF records: SPF returns permerror and fails every message`)
      if (st.count > 10) flag('bad', 'SPF-LOOKUPS', `${st.count} DNS-lookup terms, the limit is 10: permerror`)
      else if (st.count >= 8) flag('warn', 'SPF-LOOKUPS', `${st.count} of 10 DNS lookups used`)
      else if (st.records.length === 1) good('SPF', `one record, ${st.count}/10 lookups`)
      if (st.missing.length) flag('warn', 'SPF-INCLUDE-UNRESOLVED', `no SPF found at: ${clip(st.missing.join(' '), 90)}`)
      if (st.ptr) flag('warn', 'SPF-PTR', 'uses ptr (deprecated, slow)')
      if (st.all === '-all') good('SPF-ALL', '-all (hard fail)')
      else if (st.all === '~all') { if (['quarantine', 'reject'].includes(dmPolicy)) good('SPF-ALL', '~all with an enforcing DMARC') ; else flag('warn', 'SPF-SOFTFAIL', '~all (soft fail) and DMARC does not enforce') }
      else if (!st.all && !st.redirect) flag('bad', 'SPF-NO-ALL', 'no all mechanism: unlisted senders get a neutral result')
      else if (st.all === '+all' || st.all === '?all') flag('bad', 'SPF-OPEN', `${st.all} lets anyone send as the domain`)
    }
    // DKIM
    const sel = ['hostingermail-a', 'hostingermail-b', 'hostingermail-c', 'default']
    const dk = []
    let found = 0
    for (const s of sel) {
      const name = `${s}._domainkey.${APEX}`
      const cn = await dnsQ('CNAME', name)
      const tx = await dnsQ('TXT', name)
      const key = tx.recs.find((x) => /p=/i.test(x))
      if (cn.recs.length || tx.recs.length) {
        found++
        dk.push(`${s}=${cn.recs.length ? 'CNAME ' + clip(cn.recs[0], 40) : 'TXT'}${key ? '' : ' (no key!)'}`)
        if (cn.recs.length && !key) flag('warn', 'DKIM-DANGLING', `${name} is a CNAME to ${cn.recs[0]} which returns no key`, s)
        if (key && /p=\s*(;|$)/i.test(key)) flag('bad', 'DKIM-REVOKED', `${name} has an empty p= (revoked key)`, s)
      } else dk.push(`${s}=none`)
    }
    L(`MAIL DKIM ${dk.join(' | ')}`)
    if (!found) flag('warn', 'DKIM-NONE', 'none of hostingermail-a/b/c or default has a DKIM record: outgoing mail is unsigned, DMARC can only pass through SPF alignment')
    else good('DKIM', `${found} of ${sel.length} selectors published`)
    // MTA-STS / TLS-RPT
    const ms = (await dnsQ('TXT', '_mta-sts.' + APEX)).recs.find((s) => /^v=STSv1/i.test(s))
    const tr = (await dnsQ('TXT', '_smtp._tls.' + APEX)).recs.find((s) => /^v=TLSRPTv1/i.test(s))
    L(`MAIL MTA-STS ${ms || 'none'} | TLS-RPT ${tr || 'none'}`)
    if (!ms) note('no MTA-STS record (optional hardening of inbound mail TLS)')
    else if (!cfg.offline) {
      const pol = await new Promise((resolve) => {
        gate().then(() => {
          const rq = https.get(`https://mta-sts.${APEX}/.well-known/mta-sts.txt`, { timeout: 8000, headers: { 'user-agent': 'sporta-apex-check/1' } }, (res) => {
            const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(ch).toString('utf8').slice(0, 600) }))
          })
          rq.on('timeout', () => { rq.destroy(); resolve({ error: 'timeout' }) })
          rq.on('error', (e) => resolve({ error: e.code || e.message }))
        }).catch((e) => resolve({ error: e.message }))
      })
      const mode = /mode:\s*(\w+)/i.exec(pol.text || '')?.[1]
      L(`MAIL MTA-STS policy ${pol.status || pol.error} mode=${mode || '-'}`)
      if (pol.status !== 200) flag('bad', 'MTA-STS-POLICY', `TXT announces MTA-STS but the policy file answers ${pol.status || pol.error}`)
      else if (mode === 'enforce') good('MTA-STS', 'policy mode enforce')
      else flag('warn', 'MTA-STS-MODE', `policy mode ${mode || 'unreadable'} (testing/none do not protect)`)
    }
    if (!tr) note('no TLS-RPT record (optional; pairs with MTA-STS)')
    else good('TLS-RPT', clip(tr, 80))
  }

  // ---------------------------------------------------------------------- run
  async function run() {
    const t0 = Date.now()
    L(`APEX_CHECK start ${new Date().toISOString()} node=${process.version} connect=${cfg.connect} mode=${cfg.mock ? 'MOCK' : 'live'} gap=${gap}ms cap=${MAX_REQUESTS}`)
    try {
      if (cfg.resolver) await dnsSection()
      else L('== 1 DNS skipped (offline mock run)')
      await tlsSection()
      await mapSection()
      await contentSection()
      await methodsSection()
      if (cfg.resolver) await mailSection()
      else L('== 6 mail skipped (offline mock run)')
    } catch (e) {
      flag('bad', 'PROBE-ABORTED', `${e.message} (requests so far: ${reqs})`)
    }
    L(`requests=${reqs} dns=${dnsQueries} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)
    L(`APEX_SUMMARY ok=${counts.ok} warn=${counts.warn} bad=${counts.bad}`)
    L('APEX_CHECK_DONE')
    return { counts, flags, lines, reqs, ms: Date.now() - t0 }
  }
  return { run }
}

// ------------------------------------------------------------------------ live config
async function liveConfig() {
  const cfg = { connect: '127.0.0.1', vpsConnect: VPS_IP, dohBase: 'https://cloudflare-dns.com/dns-query' }
  if (process.env.APEX_TARGETS) {
    const t = JSON.parse(process.env.APEX_TARGETS)
    const fs = await import('node:fs')
    Object.assign(cfg, { connect: t.connect || '127.0.0.1', vpsConnect: t.vpsConnect || t.connect || '127.0.0.1', httpPort: t.http, httpsPort: t.https, mock: true, offline: t.offline !== false })
    if (t.ca) cfg.ca = fs.readFileSync(t.ca)
    if (!cfg.offline) cfg.resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 })
    else cfg.dohBase = null
    return cfg
  }
  // live: does the host's own Traefik answer on 127.0.0.1:443? else use the public address
  const ok = await new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: 443, timeout: 1500 }, () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
  if (!ok) cfg.connect = VPS_IP
  cfg.resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 })
  return cfg
}

// ------------------------------------------------------------------------ self test
// Mock servers on 127.0.0.1 behave like a good apex and like each seeded fault; the probe is run
// against every one of them and must flag exactly what was seeded (and nothing bad on the good one).
async function selftest() {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const cp = await import('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-selftest-'))
  const mkCert = (name, sans, days) => {
    const key = path.join(tmp, name + '.key'), crt = path.join(tmp, name + '.crt')
    cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', String(days), '-subj', '/CN=' + sans.split(',')[0].slice(4), '-addext', 'subjectAltName=' + sans], { stdio: 'ignore' })
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) }
  }
  const certGood = mkCert('good', `DNS:${APEX},DNS:${WWW}`, 60)
  const certBad = mkCert('bad', `DNS:${WWW}`, 3)

  // ---- fake DNS zone
  const zoneGood = () => ({
    recs: {
      [`${APEX}|A`]: [VPS_IP], [`${WWW}|A`]: [VPS_IP],
      [`${APEX}|NS`]: ['ns1.dns-parking.com', 'ns2.dns-parking.com'], [`${WWW}|NS`]: [],
      [`${APEX}|SOA`]: [{ nsname: 'ns1.dns-parking.com', hostmaster: 'h.x', serial: 2026110301, refresh: 3600, retry: 600, expire: 86400, minttl: 300 }],
      [`${APEX}|MX`]: [{ priority: 5, exchange: 'mx1.hostinger.com' }, { priority: 10, exchange: 'mx2.hostinger.com' }],
      ['mx1.hostinger.com|A']: ['1.2.3.4'], ['mx2.hostinger.com|A']: ['1.2.3.5'],
      [`${APEX}|TXT`]: ['v=spf1 include:_spf.mail.hostinger.com ~all', 'google-site-verification=abc'],
      ['_spf.mail.hostinger.com|TXT']: ['v=spf1 ip4:10.0.0.0/8 include:spf2.hostinger.com -all'], ['spf2.hostinger.com|TXT']: ['v=spf1 ip4:10.1.0.0/16 -all'],
      [`_dmarc.${APEX}|TXT`]: ['v=DMARC1; p=quarantine; rua=mailto:cs@sporta.com.kw'],
      [`${APEX}|CAA`]: [{ critical: 0, issue: 'letsencrypt.org' }],
      [`hostingermail-a._domainkey.${APEX}|CNAME`]: ['hostingermail-a.dkim.mail.hostinger.com'], [`hostingermail-a._domainkey.${APEX}|TXT`]: ['v=DKIM1; k=rsa; p=MIIB'],
      [`hostingermail-b._domainkey.${APEX}|CNAME`]: ['hostingermail-b.dkim.mail.hostinger.com'], [`hostingermail-b._domainkey.${APEX}|TXT`]: ['v=DKIM1; k=rsa; p=MIIB'],
    },
    doh: {},
  })
  const zoneBad = () => {
    const z = zoneGood()
    Object.assign(z.recs, {
      [`${APEX}|A`]: ['203.0.113.9'], [`${APEX}|AAAA`]: ['2001:db8::1'], [`${APEX}|NS`]: ['ns1.dns-parking.com'],
      [`${APEX}|MX`]: [], [`${APEX}|CAA`]: [{ critical: 0, issue: 'digicert.com' }],
      [`${APEX}|TXT`]: ['v=spf1 include:a1.x include:a2.x include:a3.x include:a4.x include:a5.x include:a6.x include:a7.x include:a8.x include:a9.x include:a10.x include:a11.x -all', 'v=spf1 include:other.example -all'],
      [`_dmarc.${APEX}|TXT`]: ['v=DMARC1; p=none'],
    })
    for (const k of Object.keys(z.recs)) if (k.includes('_domainkey')) delete z.recs[k]
    z.doh[`${APEX}|A`] = [VPS_IP]
    return z
  }
  const mkResolver = (zone) => {
    const get = (name, type) => zone.recs[`${name}|${type}`] || []
    const nodata = (m) => Object.assign(new Error(m), { code: 'ENODATA' })
    const wrap = (type, conv = (x) => x) => async (name) => { const r = get(name, type); if (!r.length) throw nodata('ENODATA'); return conv(r) }
    return {
      resolve4: wrap('A'), resolve6: wrap('AAAA'), resolveCname: wrap('CNAME'), resolveNs: wrap('NS'),
      resolveSoa: async (n) => { const r = get(n, 'SOA'); if (!r.length) throw nodata('ENODATA'); return r[0] },
      resolveMx: wrap('MX'), resolveTxt: wrap('TXT', (r) => r.map((s) => [s])), resolveCaa: wrap('CAA'),
    }
  }
  const DOH_NUM = { A: 1, AAAA: 28, CNAME: 5, NS: 2, SOA: 6, MX: 15, TXT: 16, CAA: 257 }
  const startDoh = (zone) => new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x')
      const name = u.searchParams.get('name'), type = u.searchParams.get('type')
      const recs = zone.doh[`${name}|${type}`] || zone.recs[`${name}|${type}`] || []
      const data = recs.map((r) => {
        if (type === 'MX') return `${r.priority} ${r.exchange}.`
        if (type === 'TXT') return `"${r}"`
        if (type === 'CAA') { const tag = Object.keys(r).find((k) => k !== 'critical'); const b = Buffer.concat([Buffer.from([0, tag.length]), Buffer.from(tag), Buffer.from(r[tag])]); return `\\# ${b.length} ${b.toString('hex')}` }
        if (type === 'SOA') return `${r.nsname}. ${r.hostmaster}. ${r.serial} ${r.refresh} ${r.retry} ${r.expire} ${r.minttl}`
        return type === 'NS' || type === 'CNAME' ? r + '.' : r
      })
      res.writeHead(200, { 'content-type': 'application/dns-json' })
      res.end(JSON.stringify({ Status: 0, Answer: data.map((d) => ({ name, type: DOH_NUM[type], TTL: 300, data: d })) }))
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })

  // ---- web mocks
  const html = (canon, alts) => `<!doctype html><html lang="ar"><head><link rel="canonical" href="${canon}">${alts}<meta name="sporta-build" content="sporta-web"></head><body>ok</body></html>`
  const altsGood = `<link rel="alternate" hreflang="ar" href="${CANON}/"><link rel="alternate" hreflang="en" href="${CANON}/?lang=en"><link rel="alternate" hreflang="x-default" href="${CANON}/">`
  const R = (status, headers = {}, body = '') => ({ status, headers, body })
  function base(c) {
    const { scheme, host, path, method } = c
    const hsts = scheme === 'https' ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' } : {}
    const cc = { 'cache-control': 'public, max-age=86400' }
    if (method === 'TRACE') return R(405, { allow: 'GET, HEAD, OPTIONS' }, 'no')
    if (method === 'OPTIONS' && (host === APEX || host === WWW)) return R(host === APEX ? 301 : 204, host === APEX ? { location: CANON + path, ...cc, ...hsts } : { allow: 'GET, HEAD, OPTIONS', ...hsts })
    if (host === APEX || host === VPS_IP) return R(301, { location: CANON + path, ...cc, ...hsts }, 'Moved Permanently')
    if (host === WWW) {
      if (scheme === 'http') return R(301, { location: CANON + path, ...cc }, 'Moved Permanently')
      const [p, q] = splitPQ(path)
      if (p === '/' && q === 'lang=en') return R(200, { 'content-type': 'text/html', ...hsts }, html(CANON + '/?lang=en', altsGood))
      if (p === '/') return R(200, { 'content-type': 'text/html', ...hsts }, html(CANON + '/', altsGood))
      if (p === '/sitemap.xml') return R(200, { 'content-type': 'application/xml', ...hsts }, `<urlset><url><loc>${CANON}/</loc></url><url><loc>${CANON}/shop</loc></url></urlset>`)
      if (p === '/robots.txt') return R(200, { 'content-type': 'text/plain', ...hsts }, `User-agent: *\nSitemap: ${CANON}/sitemap.xml\n`)
      if (p.startsWith('/.well-known/')) return R(404, hsts, 'nf')
      return R(200, { 'content-type': 'text/html', ...hsts }, '<html>page</html>')
    }
    return R(404, {}, '404 page not found')
  }
  const wwwHtml = (c) => c.host === WWW && c.scheme === 'https' && c.method === 'GET' && splitPQ(c.path)[0] === '/' && splitPQ(c.path)[1] !== 'lang=en'
  // name -> { cert?, zone?, dohDead?, web(c)->response|undefined, expect:[ 'ID' | 'ID:level' ] }
  const scenarios = {
    good: { zone: zoneGood, web: () => undefined, expect: [], clean: true },
    loop: { web: (c) => (wwwHtml(c) ? R(301, { location: 'https://sporta.com.kw/', 'cache-control': 'max-age=60' }) : undefined), expect: ['LOOP'] },
    'drop-query-302': { web: (c) => ((c.host === APEX) && c.method === 'GET' ? R(302, { location: CANON + '/', 'cache-control': 'max-age=60' }) : undefined), expect: ['TEMP-REDIRECT', 'DROP-QUERY', 'DROP-PATH'] },
    'apex-200': { web: (c) => (c.host === APEX && c.scheme === 'https' && c.method === 'GET' ? R(200, { 'content-type': 'text/html' }, '<html>shop on the apex</html>') : undefined), expect: ['APEX-200-HTML', 'FINAL-NOT-WWW'] },
    'two-hops': { web: (c) => (c.host === APEX && c.scheme === 'http' && c.method === 'GET' ? R(301, { location: 'https://sporta.com.kw' + c.path, 'cache-control': 'max-age=60' }) : undefined), expect: ['MULTI-HOP'] },
    downgrade: { web: (c) => (c.host === APEX && c.scheme === 'https' && c.method === 'GET' ? R(301, { location: 'http://www.sporta.com.kw' + c.path, 'cache-control': 'max-age=60', 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' }) : undefined), expect: ['HTTP-DOWNGRADE', 'MULTI-HOP'] },
    'mix-301-308': { web: (c) => (c.host === APEX && c.scheme === 'https' && c.method === 'GET' ? R(308, { location: CANON + c.path, 'cache-control': 'public, max-age=86400', 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' }) : undefined), expect: ['STATUS-MIX:warn'] },
    'no-hsts-no-cache': {
      web: (c) => {
        if (c.host === APEX && c.method === 'GET') return R(301, { location: CANON + c.path })
        if (c.host === WWW && c.scheme === 'https' && c.method === 'GET' && splitPQ(c.path)[0] === '/' && !splitPQ(c.path)[1]) return R(200, { 'content-type': 'text/html', 'strict-transport-security': 'max-age=300' }, html(CANON + '/', altsGood))
      },
      expect: ['NO-HSTS-APEX:warn', 'HSTS-WEAK:warn', 'HSTS-NO-SUBDOMAINS:warn', 'PERM-REDIR-CACHE:warn'],
    },
    'ip-content': { web: (c) => (c.host === VPS_IP && c.method === 'GET' ? R(200, { 'content-type': 'text/html' }, '<html>shop on the ip</html>') : undefined), expect: ['IP-SERVES-CONTENT'] },
    'ip-stays-on-ip': { web: (c) => (c.host === VPS_IP && c.method === 'GET' ? (c.scheme === 'http' ? R(301, { location: 'https://187.7.78.123' + c.path, 'cache-control': 'max-age=60' }) : R(404, {}, '404 page not found')) : undefined), expect: ['IP-NOT-CANONICAL:warn'] },
    'bad-cert': { cert: 'bad', web: () => undefined, expect: ['TLS-APEX-NOT-IN-SAN', 'TLS-EXPIRING', 'TLS-VERIFY-FAIL'] },
    'canonical-on-apex': { web: (c) => (wwwHtml(c) ? R(200, { 'content-type': 'text/html', 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' }, html('https://sporta.com.kw/', altsGood.replace(/www\./g, '') + '<a href="http://sporta.com.kw/x">x</a>')) : undefined), expect: ['CANON-NOT-WWW', 'APEX-URL-IN-HTML:warn'] },
    'trace-on-head-differs': { web: (c) => (c.host === APEX && c.method === 'TRACE' ? R(200, { 'content-type': 'message/http' }, 'TRACE / HTTP/1.1') : c.host === APEX && c.rawMethod === 'HEAD' ? R(302, { location: CANON + '/' }) : undefined), expect: ['TRACE-ENABLED', 'HEAD-GET-DIFF'] },
    'host-leak': { web: (c) => (c.host === 'evil.example' ? R(200, { 'content-type': 'text/html' }, '<html>the shop for anyone</html>') : undefined), expect: ['HOST-LEAK'] },
    'location-leak': { web: (c) => (c.host === APEX && c.scheme === 'http' && c.method === 'GET' ? R(301, { location: 'http://127.0.0.1:8080' + c.path }) : undefined), expect: ['REDIRECT-FOREIGN-HOST'] },
    'percent-recoded': { web: (c) => (c.host === APEX && c.method === 'GET' ? R(301, { location: CANON + c.path.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), 'cache-control': 'max-age=60', ...(c.scheme === 'https' ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' } : {}) }) : undefined), expect: ['PCT-CHANGED:warn'] },
    'dns-mail-bad': { zone: zoneBad, web: () => undefined, expect: ['DNS-NOT-VPS', 'DNS-DOH-DIFF:warn', 'AAAA-PRESENT:warn', 'NS-SINGLE:warn', 'CAA-NO-LE', 'MX-NONE:warn', 'SPF-MULTIPLE', 'SPF-LOOKUPS', 'DMARC-WEAK:warn', 'DMARC-NO-RUA:warn', 'DKIM-NONE:warn'] },
    'doh-blocked': { zone: zoneGood, dohDead: true, web: () => undefined, expect: ['DOH-BLOCKED:warn'] },
  }

  function startMock(scn) {
    const certs = scn.cert === 'bad' ? certBad : certGood
    const handler = (scheme) => (req, res) => {
      const hostHeader = String(req.headers.host || '')
      const host = hostHeader.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
      const c = { scheme, host, path: req.url, method: req.method === 'HEAD' ? 'GET' : req.method, rawMethod: req.method }
      const r = scn.web(c) || base(c)
      res.writeHead(r.status, r.headers)
      res.end(req.method === 'HEAD' ? undefined : r.body)
    }
    return new Promise((resolve) => {
      const h = http.createServer(handler('http'))
      const s = https.createServer({ key: certs.key, cert: certs.cert, ALPNProtocols: ['h2', 'http/1.1'] }, handler('https'))
      h.listen(0, '127.0.0.1', () => s.listen(0, '127.0.0.1', () => resolve({ httpPort: h.address().port, httpsPort: s.address().port, ca: certs.cert, close: () => { h.close(); s.close() } })))
    })
  }

  const verbose = process.argv.includes('--verbose')
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)
  let failures = 0
  const out = (s) => console.log(s)
  const check = (cond, msg) => { out(`   ${cond ? 'pass' : 'FAIL'} ${msg}`); if (!cond) failures++ }
  out(`APEX SELFTEST node=${process.version} mocks on 127.0.0.1, ${Object.keys(scenarios).length} scenarios`)
  for (const [name, scn] of Object.entries(scenarios)) {
    if (only && only !== name) continue
    const mock = await startMock(scn)
    const zone = scn.zone ? scn.zone() : null
    const dohSrv = zone && !scn.dohDead ? await startDoh(zone) : null
    const cfg = {
      connect: '127.0.0.1', vpsConnect: '127.0.0.1', httpPort: mock.httpPort, httpsPort: mock.httpsPort, ca: mock.ca, mock: true, offline: true, quiet: !verbose,
      gapMs: name === 'good' ? undefined : 8, // the clean run keeps the real 100 ms pacing
      ...(zone ? { resolver: mkResolver(zone), dohBase: dohSrv ? `http://127.0.0.1:${dohSrv.address().port}/dns-query` : 'http://127.0.0.1:1/dns-query' } : {}),
    }
    const res = await createProbe(cfg).run()
    const got = [...res.flags.entries()].filter(([, l]) => l !== 'ok').map(([id, l]) => `${id}:${l}`)
    out(`SCENARIO ${name}: ok=${res.counts.ok} warn=${res.counts.warn} bad=${res.counts.bad} requests=${res.reqs} ${(res.ms / 1000).toFixed(1)}s`)
    out(`   flagged: ${got.sort().join(' ') || '(nothing)'}`)
    check(res.reqs < 300, `under 300 requests (${res.reqs})`)
    check(res.lines[res.lines.length - 1] === 'APEX_CHECK_DONE' && res.lines.some((l) => /^APEX_SUMMARY ok=\d+ warn=\d+ bad=\d+$/.test(l)), 'prints APEX_SUMMARY and APEX_CHECK_DONE')
    for (const e of scn.expect) {
      const [id, lvl] = e.split(':')
      const l = res.flags.get(id)
      check(l !== undefined && l !== 'ok' && (!lvl || l === lvl), `seeded ${e} is flagged${l ? ' (' + l + ')' : ''}`)
    }
    if (scn.clean) {
      check(res.counts.bad === 0 && res.counts.warn === 0, `clean setup raises no BAD and no WARN (bad=${res.counts.bad} warn=${res.counts.warn})`)
      check(res.counts.ok >= 40, `and records many ok checks (${res.counts.ok})`)
      const minMs = (res.reqs - 1) * GAP_MS * 0.95
      check(res.ms >= minMs, `100 ms pacing held (${res.reqs} requests in ${res.ms} ms, minimum ${Math.round(minMs)})`)
      const maxLine = Math.max(...res.lines.map((l) => l.length))
      check(res.lines.length < 300, `fits the 300-entry VPS log (${res.lines.length} lines, longest ${maxLine} chars)`)
    } else {
      check(res.counts.bad + res.counts.warn > 0, 'at least one finding is counted in APEX_SUMMARY')
    }
    mock.close(); dohSrv?.close()
  }
  // The real entry point with APEX_TARGETS (what a person would type), in a child process.
  if (!only) {
    out('SCENARIO env-targets (real entry point in a child process via APEX_TARGETS)')
    for (const [label, scn, ex] of [['good', scenarios.good, 0], ['--strict on a looping apex', scenarios.loop, 2]]) {
      const mock = await startMock(scn)
      const caFile = path.join(tmp, 'ca.pem')
      fs.writeFileSync(caFile, mock.ca)
      const env = { ...process.env, APEX_TARGETS: JSON.stringify({ connect: '127.0.0.1', http: mock.httpPort, https: mock.httpsPort, ca: caFile }) }
      const args = [new URL(import.meta.url).pathname, ...(ex ? ['--strict'] : [])]
      const child = await new Promise((resolve) => {
        const c = cp.spawn(process.execPath, args, { env }); let o = ''
        c.stdout.on('data', (d) => (o += d)); c.on('close', (code) => resolve({ code, o }))
      })
      mock.close()
      const sum = /APEX_SUMMARY ok=(\d+) warn=(\d+) bad=(\d+)/.exec(child.o)
      check(!!sum && child.o.includes('APEX_CHECK_DONE'), `${label}: summary and APEX_CHECK_DONE printed (${sum ? sum[0] : 'none'})`)
      check(child.code === ex, `${label}: exit code ${child.code}, expected ${ex}`)
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* temp dir only */ }
  out(failures ? `SELFTEST FAILED: ${failures} check(s)` : 'SELFTEST PASSED')
  process.exit(failures ? 1 : 0)
}

// ------------------------------------------------------------------------ main
if (process.argv.includes('--selftest')) {
  await selftest()
} else {
  const cfg = await liveConfig()
  const res = await createProbe(cfg).run()
  process.exitCode = process.argv.includes('--strict') && res.counts.bad ? 2 : 0
}
