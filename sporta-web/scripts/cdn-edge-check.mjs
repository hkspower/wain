#!/usr/bin/env node
// CDN CHECK, LANE B - THE LIVE EDGE: DNS, TLS, HTTP headers, caching, compression, HTTP/2, Traefik layer.
//
// READ-ONLY. GET / HEAD / OPTIONS only. It never signs in, submits a form, presses an order button or POSTs, and it
// stops itself at EDGE_CAP (default 245) requests+TLS connects to the live site. Run it ON THE VPS (node:24-alpine):
// the only route to the live site that this project's sandbox has is the Hostinger connector. Because it runs on the
// VPS, EVERY TIMING IT PRINTS IS SERVER-SIDE (the VPS talking to its own public address); it says nothing about the
// latency a visitor in Kuwait sees. Byte counts, headers and protocol facts are the same for everyone.
//
//   node scripts/cdn-edge-check.mjs
//
// Local rehearsal against a stand-in server (never the live site):
//   NODE_EXTRA_CA_CERTS=cert.pem EDGE_HOST=localhost EDGE_APEX=localhost EDGE_PORT=9431 EDGE_HTTP_PORT=9432 \
//   EDGE_IP=127.0.0.1 EDGE_SKIP=dns node scripts/cdn-edge-check.mjs
//
// One deliberate exception to certificate verification: the "Traefik layer" section connects to the VPS address with
// an unknown name (and with no name) purely to READ the certificate/404 that Traefik's default router presents.
// That connection sends nothing but a GET for a name that does not exist; it is how the proxy is identified.
//
// Lines starting "FLAG" are automatic findings; everything else is a plain measurement. Output is compact on purpose
// (the connector keeps only the last 300 log entries).
import crypto from 'node:crypto'
import dns from 'node:dns'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { performance } from 'node:perf_hooks'

const env = process.env
const HOST = env.EDGE_HOST || 'www.sporta.com.kw'
const APEX = env.EDGE_APEX || 'sporta.com.kw'
const PORT = Number(env.EDGE_PORT || 443)
const HTTP_PORT = Number(env.EDGE_HTTP_PORT || 80)
const VPS_IP = env.EDGE_IP || '187.7.78.123'
const SKIP = new Set((env.EDGE_SKIP || '').split(',').filter(Boolean))
const CAP = Number(env.EDGE_CAP || 245)
const AUTH = HOST + (PORT === 443 ? '' : ':' + PORT)
const UA = 'sporta-cdn-edge-check/1 (read-only owner-requested check from the VPS)'

// ---------- output + budget ----------
let spent = 0
const flags = []
const P = (s) => console.log(String(s).slice(0, 900))
const H = (s) => console.log('## ' + s)
const flag = (id, msg) => { flags.push(id + ' ' + msg); P('FLAG ' + id + ' ' + msg) }
const spend = (n = 1) => { spent += n; if (spent > CAP) throw new Error('request budget exhausted (' + CAP + ')') }
const left = () => CAP - spent
const kb = (n) => (n == null ? '?' : n >= 10240 ? (n / 1024).toFixed(0) + 'K' : n + 'B')
const ms = (n) => (n == null ? '?' : n.toFixed(1))
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return 'min ' + ms(s[0]) + ' med ' + ms(s[s.length >> 1]) + ' max ' + ms(s[s.length - 1]) }
const short = (s, n = 60) => (s.length > n ? s.slice(0, n - 3) + '...' : s)

// ---------- HTTP plumbing ----------
const norm = (h) => {
  const o = {}
  for (const [k, v] of Object.entries(h)) { if (k[0] !== ':') o[k.toLowerCase()] = Array.isArray(v) ? v.join(' | ') : String(v) }
  return o
}
const MAXBODY = 6e6

function openH2(o = {}) {
  return new Promise((resolve, reject) => {
    spend()
    const host = o.host || HOST
    const opts = o.ip
      ? { createConnection: () => tls.connect({ host: o.ip, port: PORT, servername: host, ALPNProtocols: ['h2'] }) }
      : {}
    const sess = http2.connect('https://' + host + ':' + PORT, opts)
    const timer = setTimeout(() => { sess.destroy(); reject(new Error('h2 connect timeout')) }, 15000)
    sess.on('error', (e) => { clearTimeout(timer); reject(e) })
    sess.on('connect', () => { clearTimeout(timer); resolve(sess) })
  })
}

function h2fetch(sess, method, path, hdrs = {}, o = {}) {
  return new Promise((resolve) => {
    spend()
    const t0 = performance.now()
    const r = { proto: 'h2', method, path, status: 0, h: {}, bytes: 0, body: Buffer.alloc(0), info: [], ttfb: null, total: null }
    const chunks = []
    let done = false
    const fin = (err) => {
      if (done) return
      done = true
      r.total = performance.now() - t0
      r.body = Buffer.concat(chunks)
      if (err) r.error = String(err.message || err)
      resolve(r)
    }
    let req
    try {
      req = sess.request({ ':method': method, ':path': path, ':authority': o.authority || AUTH, 'user-agent': UA, accept: '*/*', ...hdrs })
    } catch (e) { return fin(e) }
    req.setTimeout(20000, () => { r.error = 'timeout'; req.close(http2.constants.NGHTTP2_CANCEL) })
    req.on('headers', (h) => { if (h[':status']) r.info.push(h[':status']) })
    req.on('response', (h) => { r.status = h[':status']; r.h = norm(h); r.ttfb = performance.now() - t0 })
    req.on('data', (c) => {
      r.bytes += c.length
      if (r.bytes <= (o.maxBody || MAXBODY)) chunks.push(c)
      else { r.truncated = true; req.close(http2.constants.NGHTTP2_CANCEL) }
    })
    req.on('error', fin)
    req.on('close', () => fin())
    req.end()
  })
}

function h1fetch(agent, method, path, hdrs = {}, o = {}) {
  return new Promise((resolve) => {
    spend()
    const t0 = performance.now()
    const r = { proto: 'h1', method, path, status: 0, h: {}, bytes: 0, body: Buffer.alloc(0), info: [], ttfb: null, total: null }
    const chunks = []
    let done = false
    const fin = (err) => {
      if (done) return
      done = true
      r.total = performance.now() - t0
      r.body = Buffer.concat(chunks)
      if (err) r.error = String(err.message || err)
      resolve(r)
    }
    const req = https.request({
      host: o.ip || o.host || HOST, port: PORT, servername: o.sni === undefined ? (o.host || HOST) : o.sni || undefined,
      method, path, agent, rejectUnauthorized: o.reject !== false, timeout: 20000,
      headers: { host: o.authority || AUTH, 'user-agent': UA, accept: '*/*', ...hdrs },
    }, (res) => {
      r.status = res.statusCode; r.h = norm(res.headers); r.ttfb = performance.now() - t0; r.httpVersion = res.httpVersion
      res.on('data', (c) => {
        r.bytes += c.length
        if (r.bytes <= (o.maxBody || MAXBODY)) chunks.push(c)
        else { r.truncated = true; res.destroy() }
      })
      res.on('end', () => fin())
      res.on('close', () => fin())
      res.on('error', fin)
    })
    req.on('information', (i) => r.info.push(i.statusCode))
    req.on('timeout', () => { r.error = 'timeout'; req.destroy() })
    req.on('error', fin)
    req.end()
  })
}

function plainfetch(hostHeader, path, o = {}) {
  return new Promise((resolve) => {
    spend()
    const t0 = performance.now()
    const r = { proto: 'h1-plain', status: 0, h: {}, bytes: 0 }
    const req = http.request({ host: o.ip || hostHeader.replace(/:\d+$/, ''), port: HTTP_PORT, path, method: 'GET', agent: false, timeout: 15000, headers: { host: hostHeader, 'user-agent': UA } }, (res) => {
      r.status = res.statusCode; r.h = norm(res.headers); r.ttfb = performance.now() - t0
      res.on('data', (c) => { r.bytes += c.length })
      res.on('end', () => resolve(r))
      res.on('close', () => resolve(r))
    })
    req.on('timeout', () => { r.error = 'timeout'; req.destroy() })
    req.on('error', (e) => { r.error = e.message; resolve(r) })
    req.end()
  })
}

const state = { main: null, agent: new https.Agent({ keepAlive: true, ALPNProtocols: ['http/1.1'] }) }
const get = (path, o = {}) => {
  const hdrs = { 'accept-encoding': o.ae || 'identity', ...(o.headers || {}) }
  const m = o.method || 'GET'
  return state.main ? h2fetch(state.main, m, path, hdrs, o) : h1fetch(state.agent, m, path, hdrs, o)
}

function decode(r) {
  const ce = (r.h['content-encoding'] || '').toLowerCase()
  try {
    if (!ce || ce === 'identity') return r.body
    if (ce === 'br') return zlib.brotliDecompressSync(r.body)
    if (ce === 'gzip') return zlib.gunzipSync(r.body)
    if (ce === 'deflate') return zlib.inflateSync(r.body)
    if (ce === 'zstd') return zlib.zstdDecompressSync(r.body)
  } catch { /* truncated or unknown */ }
  return null
}

// ---------- header helpers ----------
const SIG = /^(x-cache|cf-|x-served-by|x-varnish|x-amz|x-azure|x-fastly|fastly|x-akamai|akamai|x-sucuri|x-litespeed|x-lscache|x-hcdn|x-hostinger|x-proxy|x-edge|x-cdn|cdn-|server-timing|x-request-id|x-traefik|x-forwarded|x-real-ip|x-iinfo|x-sp-|x-hit|x-ec-|x-turbo|x-nginx|x-via|via|age|alt-svc|x-envoy|x-vercel|x-nf-|x-github|x-bunny|bunny|x-gcore|x-cdn77|x-ovh)/
const sigOf = (h) => Object.keys(h).filter((k) => SIG.test(k)).map((k) => k + '=' + short(h[k], 40)).join(' ')
const TEXTISH = /^(text\/|application\/(json|javascript|xml|manifest\+json|xhtml\+xml|ld\+json)|image\/svg)/i
const etagParts = (e) => {
  if (!e) return null
  const raw = e.replace(/^W\//, '').replace(/"/g, '')
  const m = raw.match(/^(.*?)(-(br|gzip|deflate|zstd))?$/)
  return { weak: /^W\//.test(e), suffix: m[3] || '', parts: m[1].split('-').length }
}

// ---------- results kept for the weight / timing / multiplex sections ----------
const seen = new Map()

// One sample, as a browser would ask: Accept-Encoding br. Optional compression matrix, HEAD, conditional GET.
async function probe(label, path, o = {}) {
  if (left() < 6) { P('[' + label + '] ' + path + ' SKIPPED (budget)'); return null }
  const a = await get(path, { ae: 'br' })
  if (a.error && !a.status) { P('[' + label + '] ' + path + ' ERR ' + a.error); return a }
  const h = a.h
  const dec = decode(a)
  a.dec = dec
  seen.set(path, a)
  const ce = h['content-encoding'] || '-'
  const cl = h['content-length'] != null ? h['content-length'] : h['transfer-encoding'] ? 'chunked' : '-'
  P('[' + label + '] ' + path + ' ' + a.status + ' ' + (h['content-type'] || '-') + ' | cl=' + cl + ' wire=' + a.bytes + (a.truncated ? '+' : '') + ' dec=' + (dec ? dec.length : '?') + ' ce=' + ce + ' | cc=' + (h['cache-control'] || '-') + ' | etag=' + (h.etag || '-') + ' lm=' + (h['last-modified'] || '-') + ' exp=' + (h.expires || '-'))
  P('   vary=' + (h.vary || '-') + ' ar=' + (h['accept-ranges'] || '-') + ' alt-svc=' + (h['alt-svc'] || '-') + ' server=' + (h.server || '-') + ' xpb=' + (h['x-powered-by'] || '-') + ' link=' + short(h.link || '-', 70) + ' 1xx=' + (a.info.length ? a.info.join(',') : '-') + ' sig=[' + sigOf(h) + '] ttfb=' + ms(a.ttfb) + 'ms')
  const textual = TEXTISH.test(h['content-type'] || '')
  if (a.status === 200 && textual && ce === '-' && (dec ? dec.length : a.bytes) > 1024) flag('EDGE-UNCOMPRESSED', path + ' (' + h['content-type'] + ') ' + (dec ? dec.length : a.bytes) + ' bytes served with no Content-Encoding to Accept-Encoding: br')
  if (a.status === 200 && !textual && ce !== '-' && /^(image\/(png|jpeg|webp|avif)|font\/woff2)/.test(h['content-type'] || '')) flag('EDGE-DOUBLE-COMPRESSED', path + ' already-compressed type served with Content-Encoding ' + ce)
  if (o.expect && a.status === 200 && !o.expect.test(h['cache-control'] || '')) flag('EDGE-CACHE-POLICY', path + ' Cache-Control "' + (h['cache-control'] || 'none') + '" does not match expected ' + o.expect)
  if (a.status === 200 && !h['cache-control'] && !h.expires) flag('EDGE-NO-CACHE-HEADER', path + ' has no Cache-Control or Expires')
  const ep = etagParts(h.etag)
  if (ep && ep.parts >= 3 && !ep.weak) flag('EDGE-ETAG-INODE', path + ' ETag has ' + ep.parts + ' parts (' + h.etag + ') - looks like inode-size-mtime')
  if (o.matrix && a.status === 200) {
    const g = await get(path, { ae: 'gzip' })
    const i = await get(path, { ae: 'identity' })
    const bits = ['br:' + (h['content-encoding'] || '-') + '/' + a.bytes, 'gzip:' + (g.h['content-encoding'] || '-') + '/' + g.bytes, 'identity:' + (i.h['content-encoding'] || '-') + '/' + i.bytes]
    let loc = ''
    if (o.local && dec) {
      const q = zlib.constants
      const b11 = zlib.brotliCompressSync(dec, { params: { [q.BROTLI_PARAM_QUALITY]: 11, [q.BROTLI_PARAM_SIZE_HINT]: dec.length } }).length
      const g9 = zlib.gzipSync(dec, { level: 9 }).length
      loc = ' | local best: br11=' + b11 + ' gz9=' + g9
      a.local = { b11, g9 }
    }
    P('   matrix ' + bits.join(' ') + ' etag(gz)=' + (g.h.etag || '-') + ' vary(gz)=' + (g.h.vary || '-') + loc)
  }
  if (o.head) {
    const hd = await get(path, { ae: 'br', method: 'HEAD' })
    const same = hd.status === a.status && (hd.h['content-type'] || '') === (h['content-type'] || '') && (hd.h['cache-control'] || '') === (h['cache-control'] || '')
    P('   HEAD ' + hd.status + ' cl=' + (hd.h['content-length'] || '-') + ' ce=' + (hd.h['content-encoding'] || '-') + ' cc=' + (hd.h['cache-control'] || '-') + ' parity=' + (same ? 'same' : 'DIFF'))
  }
  if (o.cond && a.status === 200) {
    const parts = []
    if (h.etag) { const c = await get(path, { ae: 'br', headers: { 'if-none-match': h.etag } }); parts.push('If-None-Match->' + c.status + (c.status === 304 ? ' (cc=' + (c.h['cache-control'] || '-') + ' etag=' + (c.h.etag ? 'yes' : 'no') + ')' : '')); if (c.status !== 304) flag('EDGE-NO-304', path + ' If-None-Match with its own ETag answered ' + c.status + ', not 304') } else parts.push('no ETag')
    if (h['last-modified'] && o.cond === 'both') { const c = await get(path, { ae: 'br', headers: { 'if-modified-since': h['last-modified'] } }); parts.push('If-Modified-Since->' + c.status) }
    P('   conditional ' + parts.join(' ; '))
  }
  return a
}

// ======================================================================
// 1  DNS
// ======================================================================
async function sectionDns() {
  H('1 DNS (resolver ' + dns.getServers().join(',') + ')')
  const q = async (fn) => { try { return await fn() } catch (e) { return 'none(' + e.code + ')' } }
  const fa = (x) => (typeof x === 'string' ? x : x.map((r) => (r.address || r) + (r.ttl != null ? ' ttl=' + r.ttl : '')).join(', '))
  const out = {}
  for (const name of [HOST, APEX]) {
    out[name] = {
      A: await q(() => dns.promises.resolve4(name, { ttl: true })),
      AAAA: await q(() => dns.promises.resolve6(name, { ttl: true })),
      CNAME: await q(() => dns.promises.resolveCname(name)),
      NS: await q(() => dns.promises.resolveNs(name)),
    }
    P(name + ' A=[' + fa(out[name].A) + '] AAAA=[' + fa(out[name].AAAA) + '] CNAME=[' + fa(out[name].CNAME) + '] NS=[' + fa(out[name].NS) + ']')
    P(name + ' lookup(all)=' + JSON.stringify(await q(() => dns.promises.lookup(name, { all: true }))))
  }
  const ips = Array.isArray(out[HOST].A) ? out[HOST].A.map((r) => r.address) : []
  for (const ip of ips) P('PTR ' + ip + ' = ' + JSON.stringify(await q(() => dns.promises.reverse(ip))))
  if (ips.length && ips.every((i) => i === VPS_IP)) P('VERDICT www A record(s) are exactly the VPS ' + VPS_IP + ': no CDN/anycast address in DNS')
  else if (ips.length) flag('EDGE-DNS-NOT-VPS', HOST + ' resolves to ' + ips.join(',') + ' (VPS is ' + VPS_IP + ')')
  const apexIps = Array.isArray(out[APEX].A) ? out[APEX].A.map((r) => r.address) : []
  if (apexIps.some((i) => !ips.includes(i))) flag('EDGE-DNS-APEX-DIFFERS', APEX + ' A=' + apexIps.join(',') + ' differs from ' + HOST + ' A=' + ips.join(','))
  const v6 = Array.isArray(out[HOST].AAAA) ? out[HOST].AAAA.map((r) => r.address) : []
  if (v6.length) flag('EDGE-AAAA-PRESENT', HOST + ' has AAAA ' + v6.join(',') + ' (the VPS address is IPv4 ' + VPS_IP + '; the IPv6 path must be tested)')
  else P('AAAA: none for ' + HOST + ' (visitors use IPv4 only; nothing to break)')
  // authoritative answer (the real TTL) from the zone's own name servers
  const ns = Array.isArray(out[APEX].NS) ? out[APEX].NS : []
  for (const n of ns.slice(0, 2)) {
    try {
      const nip = (await dns.promises.resolve4(n))[0]
      const r = new dns.promises.Resolver()
      r.setServers([nip])
      const A = await q(() => r.resolve4(HOST, { ttl: true }))
      const A0 = await q(() => r.resolve4(APEX, { ttl: true }))
      const AAAA = await q(() => r.resolve6(HOST, { ttl: true }))
      P('authoritative ' + n + ' (' + nip + '): ' + HOST + ' A=[' + fa(A) + '] AAAA=[' + fa(AAAA) + '] ; ' + APEX + ' A=[' + fa(A0) + ']')
    } catch (e) { P('authoritative ' + n + ': ' + e.code) }
  }
  for (const sv of ['1.1.1.1', '8.8.8.8']) {
    const r = new dns.promises.Resolver(); r.setServers([sv])
    P('public resolver ' + sv + ': ' + HOST + ' A=[' + fa(await q(() => r.resolve4(HOST))) + '] AAAA=[' + fa(await q(() => r.resolve6(HOST))) + ']')
  }
  return { v6 }
}

// ======================================================================
// 2  TLS
// ======================================================================
function tlsConnect(o = {}) {
  return new Promise((resolve) => {
    spend()
    const t0 = performance.now()
    const t = {}
    const opts = { host: o.ip || HOST, port: PORT, ALPNProtocols: o.alpn || ['h2', 'http/1.1'], requestOCSP: !!o.ocsp, rejectUnauthorized: o.reject !== false }
    if (o.sni !== null) opts.servername = o.sni || HOST
    if (o.session) opts.session = o.session
    if (o.minVersion) opts.minVersion = o.minVersion
    if (o.maxVersion) opts.maxVersion = o.maxVersion
    let ocsp = null
    let sessionTicket = null
    const s = tls.connect(opts)
    s.setTimeout(15000, () => s.destroy(new Error('timeout')))
    s.once('lookup', () => { t.lookup = performance.now() - t0 })
    s.once('connect', () => { t.tcp = performance.now() - t0 })
    s.once('OCSPResponse', (b) => { ocsp = b })
    s.on('session', (sess) => { sessionTicket = sess })
    s.once('secureConnect', async () => {
      t.tls = performance.now() - t0
      const r = { s, t, ocsp, alpn: s.alpnProtocol, version: s.getProtocol(), cipher: s.getCipher(), authorized: s.authorized, authError: s.authorizationError, reused: s.isSessionReused(), peer: s.getPeerCertificate(true) }
      if (o.waitSession) { await new Promise((r2) => setTimeout(r2, 1200)); r.session = sessionTicket }
      r.ocsp = ocsp
      resolve(r)
    })
    s.on('error', (e) => resolve({ error: e.code || e.message, t }))
  })
}

function describeCert(peer) {
  if (!peer || !peer.raw) return null
  const x = new crypto.X509Certificate(peer.raw)
  const chain = []
  const seenFp = new Set()
  for (let c = peer; c && c.raw && !seenFp.has(c.fingerprint256); c = c.issuerCertificate) {
    seenFp.add(c.fingerprint256)
    chain.push((c.subject && (c.subject.CN || c.subject.O)) + ' <- ' + (c.issuer && (c.issuer.CN || c.issuer.O)) + ' (' + c.raw.length + 'B)')
  }
  const kd = x.publicKey.asymmetricKeyDetails || {}
  return {
    subject: x.subject.replace(/\n/g, ' '), issuer: x.issuer.replace(/\n/g, ' '), san: x.subjectAltName, validFrom: x.validFrom, validTo: x.validTo,
    daysLeft: Math.round((new Date(x.validTo) - Date.now()) / 864e5), key: x.publicKey.asymmetricKeyType + (kd.modulusLength ? '-' + kd.modulusLength : kd.namedCurve ? '-' + kd.namedCurve : ''),
    info: (x.infoAccess || '').replace(/\n/g, ' ; '), chain, chainBytes: chain.join('|').match(/\((\d+)B\)/g).reduce((a, b) => a + Number(b.slice(1, -2)), 0),
  }
}

async function sectionTls() {
  H('2 TLS ' + HOST + ':' + PORT)
  const a = await tlsConnect({ ocsp: true, waitSession: true })
  if (a.error) { flag('EDGE-TLS-FAIL', HOST + ' TLS connect failed: ' + a.error); return }
  const c = describeCert(a.peer)
  P('negotiated alpn=' + a.alpn + ' version=' + a.version + ' cipher=' + a.cipher.name + ' authorized=' + a.authorized + (a.authError ? ' (' + a.authError + ')' : '') + ' connect tcp=' + ms(a.t.tcp) + 'ms tls-done=' + ms(a.t.tls) + 'ms (server-side)')
  P('cert subject=' + c.subject + ' issuer=' + c.issuer + ' key=' + c.key)
  P('cert SAN=' + c.san + ' valid ' + c.validFrom + ' -> ' + c.validTo + ' daysLeft=' + c.daysLeft)
  P('cert AIA/OCSP=' + c.info)
  P('chain sent (' + c.chainBytes + 'B incl. root as known to node): ' + c.chain.join(' | '))
  P('OCSP stapling: ' + (a.ocsp ? 'YES (' + a.ocsp.length + ' bytes stapled)' : 'not stapled'))
  if (a.alpn !== 'h2') flag('EDGE-NO-H2', 'ALPN negotiated ' + a.alpn + ' instead of h2')
  if (c.daysLeft < 21) flag('EDGE-CERT-EXPIRY', 'certificate expires in ' + c.daysLeft + ' days')
  if (!a.ocsp) P('note: no stapled OCSP response seen (Let\'s Encrypt ended OCSP in 2025, so none is expected from it)')
  a.s.end()
  // resumption
  if (a.session) {
    const b = await tlsConnect({ session: a.session })
    P('session resumption: ' + (b.error ? 'error ' + b.error : b.reused ? 'YES (reused)' : 'NO (full handshake again)') + (b.error ? '' : ' version=' + b.version))
    if (!b.error) b.s.end()
  } else P('session resumption: no ticket received in 1.2 s')
  // protocol floor / ceiling
  for (const [lbl, o] of [['TLS1.2-only', { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }], ['TLS1.3-only', { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }], ['TLS1.1-only', { minVersion: 'TLSv1.1', maxVersion: 'TLSv1.1' }]]) {
    const r = await tlsConnect(o)
    P('protocol test ' + lbl + ': ' + (r.error ? 'refused (' + r.error + ')' : 'accepted ' + r.version + ' ' + r.cipher.name))
    if (!r.error) r.s.end()
    if (!r.error && lbl === 'TLS1.1-only') flag('EDGE-TLS11', 'TLS 1.1 accepted')
  }
  const h1 = await tlsConnect({ alpn: ['http/1.1'] })
  P('ALPN offering only http/1.1 -> ' + (h1.error ? h1.error : h1.alpn))
  if (!h1.error) h1.s.end()
}

// ======================================================================
// 2b  Port 80 and redirect chains
// ======================================================================
async function sectionRedirects() {
  H('2b port 80 / redirects (each hop counted)')
  const starts = [
    ['http://' + HOST + '/', () => plainfetch(HOST, '/')],
    ['http://' + APEX + '/', () => plainfetch(APEX, '/')],
    ['http://' + HOST + '/shop?lang=en', () => plainfetch(HOST, '/shop?lang=en')],
    ['http://' + VPS_IP + '/ (bare IP)', () => plainfetch(VPS_IP, '/', { ip: VPS_IP })],
  ]
  for (const [label, first] of starts) {
    let r = await first()
    const trail = [label + ' -> ' + (r.error || r.status + ' ' + (r.h.location || '') + ' server=' + (r.h.server || '-') + ' body=' + r.bytes + 'B')]
    let hops = 1
    while (r && r.h && r.h.location && hops < 4) {
      let u
      try { u = new URL(r.h.location, 'http://' + HOST) } catch { break }
      if (u.hostname !== HOST && u.hostname !== APEX) { trail.push('leaves to ' + u.hostname); break }
      hops++
      r = u.protocol === 'http:' ? await plainfetch(u.hostname, u.pathname + u.search) : await h1fetch(false, 'GET', u.pathname + u.search, { 'accept-encoding': 'identity' }, { host: u.hostname, authority: u.hostname + (PORT === 443 ? '' : ':' + PORT), maxBody: 1000 })
      trail.push('-> ' + u.protocol + '//' + u.hostname + u.pathname + ' ' + (r.error || r.status + ' ' + (r.h.location || '')))
    }
    P('chain: ' + trail.join(' | ') + ' | hops-to-final=' + hops)
    if (hops > 2) flag('EDGE-REDIRECT-CHAIN', label + ' needs ' + hops + ' requests to reach a page (expected 2: one redirect + the page)')
  }
}

// ======================================================================
// 3  HTTP samples (discovered from the live index.html, not assumed)
// ======================================================================
const attr = (s, n) => { const m = s.match(new RegExp('\\b' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? m[1] ?? m[2] ?? m[3] : null }
const toPath = (u, base) => {
  try { const x = new URL(u, 'https://' + HOST + (base || '/')); return x.hostname === HOST ? x.pathname + x.search : null } catch { return null }
}
const hostOf = (u) => { try { return new URL(u, 'https://' + HOST + '/').hostname } catch { return null } }
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)(\?.*)?$/

async function sectionHttp() {
  H('3 HTTP samples (Accept-Encoding: br unless stated; wire = bytes on the wire, dec = decoded)')
  const R = { html: null, scripts: [], css: [], preloadFonts: [], other: [], extHosts: new Map(), jsText: '' }
  const home = await probe('home', '/', { matrix: true, head: true, cond: 'both', local: true, expect: /no-cache|no-store|max-age=0/ })
  if (!home || !home.dec) { flag('EDGE-NO-HOME', 'could not read /'); return R }
  const html = home.dec.toString('utf8')
  R.html = html
  P('   all response header names on /: ' + Object.keys(home.h).sort().join(','))
  P('   html: ' + html.length + ' chars; sporta-build meta=' + (/name="sporta-build"/.test(html) ? 'yes' : 'NO (foreign build)'))
  // collect references
  const refs = { script: [], style: [], preload: [], icon: [], other: [] }
  const noteHost = (u, where) => { const hn = hostOf(u); if (hn && hn !== HOST && /^(https?:)?\/\//.test(u)) { const k = hn; const e = R.extHosts.get(k) || { n: 0, where: new Set() }; e.n++; e.where.add(where); R.extHosts.set(k, e) } }
  for (const m of html.matchAll(/<(script|link|img|source|meta)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(); const a = m[2]
    if (tag === 'script') { const s = attr(a, 'src'); if (s) { refs.script.push(s); noteHost(s, 'script') } }
    else if (tag === 'link') {
      const rel = (attr(a, 'rel') || '').toLowerCase(); const href = attr(a, 'href'); const as = (attr(a, 'as') || '').toLowerCase()
      if (!href) continue
      noteHost(href, 'link-' + rel)
      if (/stylesheet/.test(rel)) refs.style.push(href)
      else if (/preload|modulepreload/.test(rel)) refs.preload.push({ href, as: as || rel, cors: attr(a, 'crossorigin') })
      else if (/preconnect|dns-prefetch/.test(rel)) refs.other.push(rel + ':' + href)
      else if (/icon|manifest/.test(rel)) refs.icon.push(rel + ':' + href)
      else refs.other.push(rel + ':' + href)
    } else if (tag === 'meta') { const c = attr(a, 'content'); if (c && /^https?:\/\//.test(c)) { noteHost(c, 'meta'); refs.other.push('meta:' + c) } }
    else if (tag === 'img' || tag === 'source') { const s = attr(a, 'src') || attr(a, 'srcset'); if (s) { noteHost(s, tag); refs.other.push(tag + ':' + s.slice(0, 60)) } }
  }
  P('   html refs: script=' + JSON.stringify(refs.script) + ' style=' + JSON.stringify(refs.style))
  P('   html refs: preload=' + JSON.stringify(refs.preload.map((p) => p.as + ':' + p.href)) + ' icons=' + JSON.stringify(refs.icon))
  P('   html refs: other=' + JSON.stringify(refs.other).slice(0, 500))
  P('   hosts named in the html tags (not the origin): ' + ([...R.extHosts].map(([k, v]) => k + ' x' + v.n + ' [' + [...v.where].join('/') + ']').join('; ') || 'none'))
  const textHosts = new Map()
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) textHosts.set(m[1].toLowerCase(), (textHosts.get(m[1].toLowerCase()) || 0) + 1)
  P('   every host string anywhere in the html (JSON-LD, meta, inline): ' + ([...textHosts].map(([k, v]) => k + ' x' + v).join('; ') || 'none'))
  // fetch the render-critical files
  R.scripts = [...new Set(refs.script.map((s) => toPath(s)).filter(Boolean))]
  R.css = [...new Set(refs.style.map((s) => toPath(s)).filter(Boolean))]
  for (const p of R.scripts.slice(0, 8)) await probe('script', p, { matrix: true, cond: 'inm', local: /\/assets\//.test(p), expect: HASHED.test(p) ? /immutable/ : null, head: HASHED.test(p) })
  for (const p of R.css.slice(0, 8)) await probe('css', p, { matrix: true, cond: 'inm', local: /\/assets\//.test(p), expect: HASHED.test(p) ? /immutable/ : null })
  // preloaded same-origin files that are neither (fonts, images, modulepreload)
  const pre = refs.preload.map((p) => ({ ...p, path: toPath(p.href) })).filter((p) => p.path && !R.scripts.includes(p.path) && !R.css.includes(p.path))
  for (const p of pre.slice(0, 5)) { const r = await probe('preload-' + p.as, p.path, { cond: 'inm' }); if (/font/.test(p.as)) R.preloadFonts.push(p.path); else R.other.push(p.path) }
  // third-party stylesheets / scripts referenced by the HTML: headers only (HEAD), max 3
  const third = [...refs.style, ...refs.script, ...refs.preload.map((p) => p.href)].filter((u) => /^(https?:)?\/\//.test(u) && hostOf(u) !== HOST)
  for (const u of [...new Set(third)].slice(0, 3)) {
    if (left() < 8) break
    try {
      const url = new URL(u, 'https://x/')
      const s = await openH2({ host: url.hostname }).catch(() => null)
      if (!s) { P('   third-party ' + u + ' : h2 connect failed'); continue }
      const r = await h2fetch(s, 'HEAD', url.pathname + url.search, { 'accept-encoding': 'br' }, { authority: url.hostname })
      P('   third-party HEAD ' + u + ' -> ' + r.status + ' ' + (r.h['content-type'] || '') + ' cc=' + (r.h['cache-control'] || '-') + ' ce=' + (r.h['content-encoding'] || '-') + ' server=' + (r.h.server || '-') + ' sig=[' + sigOf(r.h) + ']')
      s.close()
    } catch (e) { P('   third-party ' + u + ' error ' + e.message) }
  }
  return R
}

// parse the entry CSS / JS for the files they pull in
async function sectionAssets(R) {
  H('3b files the entry CSS / JS pull in (fonts, images, lazy chunks, hosts)')
  const cssText = R.css.map((p) => seen.get(p)).filter((x) => x && x.dec).map((x) => ({ p: x.path, t: x.dec.toString('utf8') }))
  const fontUrls = []
  const cssExt = new Map()
  for (const { p, t } of cssText) {
    for (const m of t.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      const u = m[1]
      if (/^data:/.test(u)) continue
      const hn = hostOf(u)
      if (hn && hn !== HOST) { cssExt.set(hn, (cssExt.get(hn) || 0) + 1); continue }
      const pp = toPath(u, p.replace(/[^/]*$/, ''))
      if (pp && /\.(woff2?|ttf|otf)(\?|$)/.test(pp)) fontUrls.push(pp)
    }
    for (const m of t.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/gi)) cssExt.set(hostOf(m[1]) || 'relative', (cssExt.get(hostOf(m[1]) || 'relative') || 0) + 1)
  }
  P('CSS: ' + cssText.length + ' sheet(s); font files named: ' + JSON.stringify([...new Set(fontUrls)]) + ' ; external hosts in CSS: ' + ([...cssExt].map(([k, v]) => k + ' x' + v).join('; ') || 'none'))
  // JS text
  const jsTexts = R.scripts.map((p) => seen.get(p)).filter((x) => x && x.dec)
  const js = jsTexts.map((x) => x.dec.toString('utf8')).join('\n')
  R.jsText = js
  const uniq = (re, g = 0) => [...new Set([...js.matchAll(re)].map((m) => m[g]))]
  const media = uniq(/\/(?:cats|hero|images|fonts)\/[A-Za-z0-9_./%-]+\.(?:jpe?g|png|webp|avif|svg|woff2?)/gi)
  P('JS: ' + js.length + ' chars in ' + jsTexts.length + ' entry script(s); media paths named: ' + media.length + ' e.g. ' + JSON.stringify(media.slice(0, 14)))
  const hostsJs = new Map()
  for (const m of js.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) { const k = m[1].toLowerCase(); const e = hostsJs.get(k) || { n: 0, ctx: js.slice(Math.max(0, m.index - 25), m.index + 55).replace(/\s+/g, ' ') }; e.n++; hostsJs.set(k, e) }
  P('JS host strings (' + hostsJs.size + '): ' + [...hostsJs].slice(0, 22).map(([k, v]) => k + ' x' + v.n).join('; '))
  for (const [k, v] of [...hostsJs].filter(([k]) => !/(w3\.org|reactjs\.org|react\.dev|github\.com|mozilla\.org|mathiasbynens|npmjs|redux|facebook\.com\/react|developer\.|example\.|schema\.org|ietf\.org|whatwg|wikipedia)/.test(k)).slice(0, 8)) P('   host ' + k + ' ctx: ...' + v.ctx + '...')
  R.media = media
  R.fontUrls = [...new Set(fontUrls)]
  const chunkRe = /(?:assets\/|\.\/|"\/assets\/)([A-Za-z0-9_]+-[A-Za-z0-9_-]{8}\.(?:js|css))/g
  R.chunks = [...new Set([...js.matchAll(chunkRe)].map((m) => '/assets/' + m[1]))].filter((p) => !R.scripts.includes(p) && !R.css.includes(p))
  P('JS lazy chunks named: ' + R.chunks.length + ' e.g. ' + JSON.stringify(R.chunks.slice(0, 8)))
}

async function sectionSamples(R) {
  H('3c sample of each asset class')
  const fontSet = [...new Set([...R.preloadFonts, ...(R.fontUrls || [])])].slice(0, 3)
  for (const p of fontSet) await probe('font', p, { cond: p === fontSet[0] ? 'inm' : false, expect: /max-age=\d{7,}/ })
  const lazy = (R.chunks || []).find((p) => /Shop|Product|Home/i.test(p)) || (R.chunks || [])[0]
  if (lazy) await probe('lazy-chunk', lazy, { matrix: true, cond: 'inm', local: true, expect: /immutable/ })
  // API
  const apiPaths = ['/api/api.php?r=products', '/api?r=products']
  let prod = null
  for (const p of apiPaths) {
    const r = await probe('api', p, { matrix: p === apiPaths[0], head: p === apiPaths[0], expect: /no-store|no-cache|private/ })
    if (r && r.status === 200 && /json/.test(r.h['content-type'] || '') && !prod) { prod = r; prod.apiPath = p }
  }
  const slidesPath = prod ? prod.apiPath.replace('r=products', 'r=slides') : '/api/api.php?r=slides'
  const slides = await probe('api-slides', slidesPath, {})
  let items = []
  try {
    const j = JSON.parse(prod.dec.toString('utf8'))
    const arr = Array.isArray(j) ? j : j.products || j.data || j.items || Object.values(j).find(Array.isArray) || []
    items = arr
    P('   products JSON: ' + arr.length + ' items; first keys=' + (arr[0] ? Object.keys(arr[0]).join(',') : '-'))
  } catch (e) { P('   products JSON parse: ' + (e.message || e)) }
  const imgOf = (p) => {
    const c = []
    if (typeof p.image === 'string') c.push(p.image)
    if (Array.isArray(p.images)) for (const x of p.images) c.push(typeof x === 'string' ? x : x && (x.url || x.src || x.path))
    const out = c.filter((x) => typeof x === 'string' && !/^data:/.test(x))
    return out
  }
  let picked = null
  for (const p of items) { const im = imgOf(p).map((u) => toPath(u)).filter((u) => u && /\/images\//.test(u)); if (im.length) { picked = { slug: p.slug || p.id, im }; break } }
  if (!picked) for (const p of items) { const im = imgOf(p).map((u) => toPath(u)).filter(Boolean); if (im.length) { picked = { slug: p.slug || p.id, im }; break } }
  P('   product picked: ' + (picked ? picked.slug + ' images=' + JSON.stringify(picked.im.slice(0, 3)) : 'none found'))
  if (picked) {
    R.productImg = picked.im[0]
    await probe('product-image', picked.im[0], { cond: 'both', head: true, expect: /max-age=\d{6,}/ })
    const slug = String(picked.slug)
    for (const w of [320, 640]) await probe('responsive-' + w, '/images/products/responsive/' + slug + '-' + w + '.webp', { cond: w === 320 ? 'inm' : false })
    await probe('product-page', '/product/' + encodeURIComponent(slug), { matrix: true, cond: 'inm', expect: /no-cache|no-store|max-age=0/ })
  }
  // slides -> hero image
  try {
    const j = JSON.parse(slides.dec.toString('utf8'))
    const arr = Array.isArray(j) ? j : j.slides || j.data || Object.values(j).find(Array.isArray) || []
    const urls = []
    for (const s of arr) for (const [k, v] of Object.entries(s)) if (typeof v === 'string' && /image|img|photo|src|url/i.test(k) && !/^data:/.test(v) && v.length < 300 && /\.(jpe?g|png|webp|avif)|slide_image/i.test(v)) urls.push(v)
    P('   slides JSON: ' + arr.length + ' slides; image refs=' + JSON.stringify(urls.slice(0, 3)))
    const sp = urls.map((u) => toPath(u, '/api/')).filter(Boolean)[0]
    if (sp) await probe('slide-image', sp, { expect: /max-age=\d{6,}/ })
  } catch (e) { P('   slides JSON parse: ' + (e.message || e)) }
  // static art: hero + category + icons
  const heroes = (R.media || []).filter((p) => /^\/hero\//.test(p)).slice(0, 2)
  const cats = (R.media || []).filter((p) => /^\/cats\//.test(p)).slice(0, 2)
  for (const p of heroes) await probe('hero', p, { cond: p === heroes[0] ? 'inm' : false })
  for (const p of cats) await probe('cat', p, { cond: p === cats[0] ? 'inm' : false })
  if (!heroes.length && !cats.length) P('   (no /hero or /cats paths found in the entry JS text; they may be in lazy chunks)')
  for (const p of ['/favicon.png', '/apple-touch-icon.png', '/logo.png', '/logo-white.webp', '/og-image.png']) await probe('icon', p, { cond: p === '/logo.png' ? 'both' : false, head: p === '/logo.png' })
  // fixed-name add-ons, sw, manifest, config, text files
  await probe('addon-css', '/sporta-home-trim.css', { matrix: true, cond: 'inm', expect: /no-cache/ })
  await probe('boot-js', '/boot.js', { cond: 'inm', expect: /no-cache/ })
  await probe('sw', '/sw.js', { cond: 'inm', expect: /no-cache/ })
  await probe('config', '/config.js', { cond: 'inm', expect: /no-cache/ })
  await probe('manifest', '/site.webmanifest', { matrix: true })
  await probe('sitemap', '/sitemap.xml', { matrix: true, cond: 'inm' })
  await probe('sitemap-products', '/sitemap-products.xml', {})
  await probe('robots', '/robots.txt', { matrix: true })
  await probe('llms', '/llms.txt', {})
  await probe('svg', '/backends-icon.svg', { matrix: true })
  await probe('spa-route', '/shop', { matrix: true, expect: /no-cache|no-store|max-age=0/ })
  await probe('not-found', '/zz-edge-check-not-here', { matrix: false })
  await probe('dir', '/images/products/', {})
  // OPTIONS + Range
  const o1 = await get('/', { method: 'OPTIONS', ae: 'identity' })
  P('OPTIONS / -> ' + o1.status + ' allow=' + (o1.h.allow || '-') + ' acao=' + (o1.h['access-control-allow-origin'] || '-'))
  const o2 = await get(prod ? prod.apiPath : '/api/api.php?r=products', { method: 'OPTIONS', ae: 'identity' })
  P('OPTIONS api -> ' + o2.status + ' allow=' + (o2.h.allow || '-') + ' acao=' + (o2.h['access-control-allow-origin'] || '-') + ' cc=' + (o2.h['cache-control'] || '-'))
  const rp = R.productImg || R.scripts[0]
  if (rp) {
    const rr = await get(rp, { headers: { range: 'bytes=0-99' }, ae: 'identity' })
    P('Range bytes=0-99 on ' + rp + ' -> ' + rr.status + ' content-range=' + (rr.h['content-range'] || '-') + ' got=' + rr.bytes + 'B')
  }
}

// ======================================================================
// 4  Weight of the first-load critical path
// ======================================================================
function sectionWeight(R) {
  H('4 first-load critical path (from the VPS side; Accept-Encoding: br; fonts depend on the language shown)')
  const list = []
  const add = (label, p) => { const a = seen.get(p); if (a && a.status === 200) list.push({ label, p, wire: a.bytes, dec: a.dec ? a.dec.length : null, ce: a.h['content-encoding'] || '-', local: a.local }) }
  add('html', '/')
  for (const p of R.scripts) add('script', p)
  for (const p of R.css) add('css', p)
  for (const p of R.other) add('preload', p)
  for (const p of R.preloadFonts) add('font', p)
  let w = 0, d = 0, b11 = 0, g9 = 0
  for (const x of list) {
    w += x.wire; d += x.dec || x.wire
    P('   ' + x.label + ' ' + x.p + ' wire=' + x.wire + ' dec=' + x.dec + ' ce=' + x.ce + (x.local ? ' (local best br11=' + x.local.b11 + ')' : ''))
    if (x.local) { b11 += x.local.b11; g9 += x.local.g9 } else { b11 += x.wire; g9 += x.wire }
  }
  P('CRITICAL PATH (html + ' + R.scripts.length + ' script + ' + R.css.length + ' css + ' + R.preloadFonts.length + ' preloaded font): ' + list.length + ' files, transfer ' + w + 'B (' + (w / 1024).toFixed(1) + ' KiB), decoded ' + d + 'B (' + (d / 1024).toFixed(1) + ' KiB)')
  P('   if every text file were pre-compressed at brotli 11: ~' + b11 + 'B (' + ((1 - b11 / w) * 100).toFixed(1) + '% less than served); gzip 9 equivalent ~' + g9 + 'B')
  const fonts = (R.fontUrls || []).filter((p) => seen.has(p)).map((p) => p + '=' + seen.get(p).bytes)
  if (fonts.length) P('   fonts sampled from CSS: ' + fonts.join(' ; '))
}

// ======================================================================
// 5  Timing (server-side only)
// ======================================================================
async function sectionTiming(R) {
  H('5 timing FROM THE VPS (server-side, hairpin to its own public IP; NOT visitor latency)')
  const cold = []
  for (let i = 0; i < 5; i++) { const c = await tlsConnect({}); if (c.error) { P('cold connect error ' + c.error); break } cold.push(c.t); c.s.end() }
  if (cold.length) P('cold connects x' + cold.length + ': tcp ' + stat(cold.map((t) => t.tcp)) + ' ; tls-done ' + stat(cold.map((t) => t.tls)) + ' ms (lookup ' + stat(cold.map((t) => t.lookup || 0)) + ')')
  const targets = [['/', 'html'], [R.scripts.find((p) => /\/assets\//.test(p)) || R.scripts[0], 'hashed asset'], [R.productImg, 'product image']].filter((x) => x[0])
  for (const [p, lbl] of targets) {
    if (left() < 8) break
    const tt = [], tot = []
    for (let i = 0; i < 5; i++) { const r = await get(p, { ae: 'br' }); if (r.status === 200) { tt.push(r.ttfb); tot.push(r.total) } }
    P('timing ' + lbl + ' ' + p + ' x' + tt.length + ' warm h2: ttfb ' + stat(tt) + ' ms ; total ' + stat(tot) + ' ms')
  }
}

// ======================================================================
// 6  HTTP/2 multiplexing
// ======================================================================
async function sectionH2(R) {
  H('6 HTTP/2 multiplexing vs HTTP/1.1 (server-side; the VPS RTT to itself is ~0, so this shows overhead, not a visitor-link gain)')
  if (!state.main) { P('no h2 session; skipped'); return }
  const pool = [...seen.entries()].filter(([p, a]) => a.status === 200 && a.bytes > 3000 && a.bytes < 400000 && !/^\/(api|sitemap)/.test(p) && a.method === 'GET').map(([p]) => p)
  const six = []
  for (let i = 0; six.length < 6 && pool.length; i++) six.push(pool[i % pool.length])
  if (six.length < 2) { P('not enough same-origin files to compare'); return }
  P('resources (' + six.length + '): ' + six.join(' '))
  const run = async (name, fn, rounds) => { const t = []; for (let i = 0; i < rounds; i++) { if (left() < six.length + 2) break; const t0 = performance.now(); await fn(); t.push(performance.now() - t0) } if (t.length) P(name + ' x' + t.length + ': ' + stat(t) + ' ms wall'); return t }
  const par2 = await run('h2 parallel (1 session, 6 streams)', () => Promise.all(six.map((p) => get(p, { ae: 'br' }))), 2)
  const seq1 = await run('h1.1 sequential (1 keep-alive socket)', async () => { const ag = new https.Agent({ keepAlive: true, maxSockets: 1, ALPNProtocols: ['http/1.1'] }); for (const p of six) await h1fetch(ag, 'GET', p, { 'accept-encoding': 'br' }); ag.destroy() }, 1)
  const par1 = await run('h1.1 parallel (6 new sockets, includes 6 TLS handshakes)', async () => { const ag = new https.Agent({ keepAlive: true, maxSockets: 6, ALPNProtocols: ['http/1.1'] }); await Promise.all(six.map((p) => h1fetch(ag, 'GET', p, { 'accept-encoding': 'br' }))); ag.destroy() }, 1)
  if (par2.length && seq1.length) P('verdict: h2 parallel ' + (seq1[0] / par2[par2.length - 1]).toFixed(1) + 'x vs h1 sequential on this near-zero-latency path')
  // does the server cap streams?
  P('h2 session remote settings: ' + JSON.stringify(state.main.remoteSettings))
}

// ======================================================================
// 7  The Traefik layer
// ======================================================================
async function sectionTraefik() {
  H('7 Traefik / proxy layer')
  // (a) default certificate: connect to the VPS address with no name and with an unknown name.
  for (const [lbl, sni] of [['no SNI', null], ['unknown SNI edge-check.invalid', 'edge-check.invalid']]) {
    const r = await tlsConnect({ ip: VPS_IP, sni, reject: false })
    if (r.error) { P(lbl + ': ' + r.error); continue }
    const c = describeCert(r.peer)
    P(lbl + ' -> cert subject=' + (c && c.subject) + ' issuer=' + (c && c.issuer) + ' authorized=' + r.authorized + ' alpn=' + r.alpn)
    r.s.end()
  }
  // (b) what answers a request for a host nobody routes (Traefik: "404 page not found")
  const u = await h1fetch(false, 'GET', '/', { 'accept-encoding': 'identity' }, { ip: VPS_IP, sni: 'edge-check.invalid', host: 'edge-check.invalid', authority: 'edge-check.invalid', reject: false, maxBody: 2000 })
  P('GET / Host: edge-check.invalid via ' + VPS_IP + ':443 -> ' + (u.error || u.status + ' ' + (u.h['content-type'] || '') + ' body=' + JSON.stringify(u.body.toString('utf8').slice(0, 60)) + ' server=' + (u.h.server || '-')))
  const u80 = await plainfetch('edge-check.invalid', '/', { ip: VPS_IP })
  P('GET / Host: edge-check.invalid via ' + VPS_IP + ':80 -> ' + (u80.error || u80.status + ' ' + (u80.h['content-type'] || '') + ' loc=' + (u80.h.location || '-') + ' body=' + u80.bytes + 'B server=' + (u80.h.server || '-')))
  // (c) who compresses: Apache (mod_brotli/mod_deflate) or Traefik's compress middleware
  const variants = [['zstd only', 'zstd'], ['Chrome-style', 'gzip, deflate, br, zstd'], ['br;q=0, gzip', 'br;q=0, gzip'], ['br only', 'br'], ['gzip only', 'gzip']]
  const res = {}
  for (const [lbl, ae] of variants) {
    const r = await get('/sporta-home-trim.css', { ae })
    res[lbl] = r
    P('AE "' + ae + '" on /sporta-home-trim.css -> ' + r.status + ' ce=' + (r.h['content-encoding'] || '-') + ' wire=' + r.bytes + ' etag=' + (r.h.etag || '-') + ' vary=' + (r.h.vary || '-') + ' te=' + (r.h['transfer-encoding'] || '-') + ' cl=' + (r.h['content-length'] || '-'))
  }
  const zs = res['zstd only']
  if (zs.h['content-encoding'] === 'zstd') P('INFER zstd is produced by a layer that speaks zstd: Apache 2.4 has no zstd, so Traefik compress is active')
  else P('INFER no zstd offered: compression is not done by Traefik compress (it offers gzip/br/zstd); the encodings seen come from Apache')
  const b = res['br only']
  const et = etagParts(b.h.etag)
  if (b.h['content-encoding'] === 'br' && et && et.suffix === 'br') P('INFER ETag suffix "-br" and Vary: Accept-Encoding = Apache mod_brotli (it rewrites the ETag; Traefik would make it weak W/ instead)')
  else if (b.h['content-encoding'] === 'br' && et && et.weak) P('INFER weak ETag W/ with br = Traefik compress middleware')
  // (d) HTTP version behind the proxy
  const h1 = await get('/sporta-home-trim.css', { ae: 'br' })
  const h1b = await h1fetch(new https.Agent({ keepAlive: false, ALPNProtocols: ['http/1.1'] }), 'GET', '/sporta-home-trim.css', { 'accept-encoding': 'br' })
  P('same file over h1.1: ' + h1b.status + ' httpVersion=' + h1b.httpVersion + ' ce=' + (h1b.h['content-encoding'] || '-') + ' headers-equal-to-h2=' + (JSON.stringify(Object.keys(h1b.h).sort()) === JSON.stringify(Object.keys(h1.h).sort())))
  if (JSON.stringify(Object.keys(h1b.h).sort()) !== JSON.stringify(Object.keys(h1.h).sort())) P('   only in h2: ' + Object.keys(h1.h).filter((k) => !(k in h1b.h)) + ' ; only in h1: ' + Object.keys(h1b.h).filter((k) => !(k in h1.h)))
  P('Alt-Svc / HTTP/3 advertised: ' + (h1.h['alt-svc'] ? h1.h['alt-svc'] : 'no (HTTP/3 not offered)'))
  P('Server header: ' + (h1.h.server || 'none') + ' ; Via: ' + (h1.h.via || 'none') + ' ; X-Powered-By: ' + (h1.h['x-powered-by'] || 'none'))
  if (/\/[0-9]+\.[0-9]+/.test(h1.h.server || '')) flag('EDGE-SERVER-VERSION', 'Server header discloses a version: ' + h1.h.server)
}

// ======================================================================
// IPv6 path
// ======================================================================
async function sectionV6(v6) {
  if (!v6.length) return
  H('2c IPv6 path (AAAA exists)')
  for (const ip of v6.slice(0, 2)) {
    const r = await tlsConnect({ ip, sni: HOST })
    P('TLS to [' + ip + ']: ' + (r.error ? 'ERROR ' + r.error + ' (if ENETUNREACH/EADDRNOTAVAIL the VPS container simply has no IPv6 route - inconclusive for visitors)' : 'ok ' + r.version + ' alpn=' + r.alpn))
    if (!r.error) { r.s.end(); const g = await h1fetch(false, 'GET', '/', { 'accept-encoding': 'identity' }, { ip, maxBody: 2000 }); P('GET / over v6 -> ' + g.status + ' server=' + (g.h.server || '-')) }
  }
}

// ======================================================================
const t0 = performance.now()
const guard = async (name, fn) => { try { return await fn() } catch (e) { P('SECTION ' + name + ' FAILED: ' + (e.message || e)); return null } }
P('cdn-edge-check start ' + new Date().toISOString() + ' node ' + process.version + ' host=' + HOST + ' cap=' + CAP + ' (server-side measurements, not visitor latency)')
let v6 = []
if (!SKIP.has('dns')) { const d = await guard('dns', sectionDns); if (d) v6 = d.v6 }
if (!SKIP.has('tls')) { await guard('tls', sectionTls); await guard('v6', () => sectionV6(v6)) }
if (!SKIP.has('redirects')) await guard('redirects', sectionRedirects)
try { state.main = await openH2(); P('main session: h2 alpn=' + state.main.alpnProtocol) } catch (e) { P('h2 session failed (' + e.message + '); using http/1.1'); flag('EDGE-NO-H2', 'could not open an h2 session: ' + e.message) }
const R = (await guard('http', sectionHttp)) || { scripts: [], css: [], preloadFonts: [] }
await guard('assets', () => sectionAssets(R))
await guard('samples', () => sectionSamples(R))
await guard('weight', () => sectionWeight(R))
if (!SKIP.has('traefik')) await guard('traefik', sectionTraefik)
await guard('timing', () => sectionTiming(R))
await guard('h2', () => sectionH2(R))
H('end')
P('requests+connects to the live site: ' + spent + ' (cap ' + CAP + ') ; flags: ' + flags.length + ' ; ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s')
for (const f of flags) P('FLAG-SUMMARY ' + f)
P('EDGE_CHECK_DONE')
try { state.main && state.main.close() } catch { /* done */ }
process.exit(0)
