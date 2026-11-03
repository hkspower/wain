// READ-ONLY DNS / domain / TLS / mail-authentication check for sporta.com.kw.
//
//   Run ON the VPS (node:24-alpine); the sandbox cannot reach the live site or raw DNS:
//     node dns-check.mjs            (fetched from raw.githubusercontent.com at a pushed commit)
//
// Only DNS queries (UDP/TCP 53, DoH GET), a handful of GET requests to the site's own
// apex/www to count redirect hops, TLS handshakes, one RDAP GET and one WHOIS read. Nothing is
// signed in, submitted or written. About 15 requests reach the live site.
//
// Views of every record: (A) the authoritative servers asked directly with a hand-built DNS
// packet (original TTLs, AA flag, EDNS, TCP), (B) the VPS default resolver (dns.promises),
// (C) 1.1.1.1 / 8.8.8.8 / 9.9.9.9 through dns.Resolver, (D) DoH at cloudflare-dns.com and
// dns.google. Results that depend on the resolver or network location are labelled.
import dgram from 'node:dgram'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import dns from 'node:dns'
import { randomInt } from 'node:crypto'

const APEX = 'sporta.com.kw'
const WWW = 'www.' + APEX
const VPS_IP = '187.7.78.123'
const PUBLIC = ['1.1.1.1', '8.8.8.8', '9.9.9.9']
const T = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, RRSIG: 46, DNSKEY: 48, CAA: 257, AXFR: 252 }
const TN = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]))

const out = []
const P = (s) => { out.push(s); console.log(s) }
const verdicts = []
const V = (level, id, msg) => { verdicts.push([level, id, msg]) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pool(items, n, fn) {
  const res = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k) }
  }))
  return res
}
const clip = (s, n = 160) => (String(s).length > n ? String(s).slice(0, n) + '..(' + String(s).length + ')' : String(s))
const short = (n) => (n === APEX ? '@' : n.endsWith('.' + APEX) ? n.slice(0, -APEX.length - 1) : n)

// ---------------------------------------------------------------- wire-format DNS client
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
function encName(n) {
  const parts = n.replace(/\.$/, '').split('.').filter(Boolean)
  const bufs = []
  for (const p of parts) { const b = Buffer.from(p, 'ascii'); bufs.push(Buffer.from([b.length]), b) }
  bufs.push(Buffer.from([0]))
  return Buffer.concat(bufs)
}
function buildQuery(name, type, { rd = true, edns = true, dobit = false } = {}) {
  const id = randomInt(65536)
  const h = Buffer.alloc(12)
  h.writeUInt16BE(id, 0); h.writeUInt16BE(rd ? 0x0100 : 0, 2); h.writeUInt16BE(1, 4); h.writeUInt16BE(edns ? 1 : 0, 10)
  const q = Buffer.concat([encName(name), u16(type), u16(1)])
  let opt = Buffer.alloc(0)
  if (edns) { opt = Buffer.alloc(11); opt.writeUInt16BE(41, 1); opt.writeUInt16BE(1232, 3); opt.writeUInt32BE(dobit ? 0x8000 : 0, 5) }
  return { id, pkt: Buffer.concat([h, q, opt]) }
}
function readName(buf, off) {
  const labels = []
  let o = off, jumped = false, end = off, guard = 0
  for (;;) {
    if (guard++ > 128) throw new Error('name loop')
    const len = buf[o]
    if (len === 0) { if (!jumped) end = o + 1; break }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[o + 1]
      if (!jumped) end = o + 2
      jumped = true; o = ptr; continue
    }
    labels.push(buf.toString('ascii', o + 1, o + 1 + len)); o += 1 + len
  }
  return [labels.join('.').toLowerCase(), end]
}
function v6(rd) {
  const g = []
  for (let i = 0; i < 16; i += 2) g.push(rd.readUInt16BE(i).toString(16))
  try { return new URL('http://[' + g.join(':') + ']').hostname.replace(/[[\]]/g, '') } catch { return g.join(':') }
}
function parseRR(buf, off) {
  const [name, o] = readName(buf, off)
  const type = buf.readUInt16BE(o), cls = buf.readUInt16BE(o + 2), ttl = buf.readUInt32BE(o + 4), rdlen = buf.readUInt16BE(o + 8)
  const rs = o + 10
  const rd = buf.subarray(rs, rs + rdlen)
  let data
  try {
    switch (type) {
      case 1: data = [...rd].join('.'); break
      case 28: data = v6(rd); break
      case 2: case 5: case 12: data = readName(buf, rs)[0]; break
      case 15: data = rd.readUInt16BE(0) + ' ' + readName(buf, rs + 2)[0]; break
      case 16: { const c = []; let p = 0; while (p < rd.length) { const l = rd[p]; c.push(rd.toString('utf8', p + 1, p + 1 + l)); p += 1 + l } data = c.join(''); break }
      case 6: { const [m, o1] = readName(buf, rs); const [r, o2] = readName(buf, o1); data = [m, r, buf.readUInt32BE(o2), buf.readUInt32BE(o2 + 4), buf.readUInt32BE(o2 + 8), buf.readUInt32BE(o2 + 12), buf.readUInt32BE(o2 + 16)].join(' '); break }
      case 257: { const tl = rd[1]; data = rd[0] + ' ' + rd.toString('ascii', 2, 2 + tl) + ' ' + rd.toString('utf8', 2 + tl); break }
      case 33: data = [rd.readUInt16BE(0), rd.readUInt16BE(2), rd.readUInt16BE(4), readName(buf, rs + 6)[0]].join(' '); break
      case 43: data = rd.readUInt16BE(0) + ' alg' + rd[2] + ' dt' + rd[3]; break
      case 48: data = 'flags' + rd.readUInt16BE(0) + ' alg' + rd[3] + ' len' + rd.length; break
      case 46: data = 'covers ' + (TN[rd.readUInt16BE(0)] || rd.readUInt16BE(0)); break
      case 41: data = 'OPT'; break
      default: data = 'type' + type + ' len' + rdlen
    }
  } catch (e) { data = 'parse-error ' + e.message }
  return { name, type, cls, ttl, data, next: rs + rdlen }
}
function parseMsg(buf) {
  const flags = buf.readUInt16BE(2)
  const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6), ns = buf.readUInt16BE(8), ar = buf.readUInt16BE(10)
  let off = 12
  for (let i = 0; i < qd; i++) { off = readName(buf, off)[1] + 4 }
  const sect = (n) => { const a = []; for (let i = 0; i < n; i++) { const r = parseRR(buf, off); off = r.next; a.push(r) } return a }
  const answers = sect(an), authority = sect(ns), additional = sect(ar)
  return { id: buf.readUInt16BE(0), aa: !!(flags & 0x0400), tc: !!(flags & 0x0200), ra: !!(flags & 0x0080), ad: !!(flags & 0x0020), rcode: flags & 0xf, answers, authority, additional, edns: additional.some((r) => r.type === 41) }
}
function udpQuery(server, pkt, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket(server.includes(':') ? 'udp6' : 'udp4')
    let t
    const done = (fn, v) => { clearTimeout(t); try { s.close() } catch { /* closed */ } fn(v) }
    t = setTimeout(() => done(reject, new Error('timeout')), timeout)
    s.on('message', (m) => done(resolve, m))
    s.on('error', (e) => done(reject, e))
    s.send(pkt, 53, server, (e) => { if (e) done(reject, e) })
  })
}
function tcpQuery(server, pkt, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: server, port: 53 })
    let buf = Buffer.alloc(0)
    const t = setTimeout(() => { s.destroy(); reject(new Error('timeout')) }, timeout)
    s.on('connect', () => { s.write(Buffer.concat([u16(pkt.length), pkt])) })
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) { clearTimeout(t); s.destroy(); resolve(buf.subarray(2, 2 + buf.readUInt16BE(0))) }
    })
    s.on('error', (e) => { clearTimeout(t); reject(e) })
    s.on('close', () => { clearTimeout(t); reject(new Error('closed')) })
  })
}
// One question to one server. UDP (2 tries), TCP when truncated or when forceTcp.
async function ask(server, name, type, opts = {}) {
  const { id, pkt } = buildQuery(name, type, opts)
  const t0 = Date.now()
  let raw, m, via = 'udp'
  try {
    if (!opts.forceTcp) {
      for (let i = 0; i < 2 && !raw; i++) {
        try { raw = await udpQuery(server, pkt) } catch (e) { if (i === 1) return { error: e.message || e.code } }
      }
      m = parseMsg(raw)
    }
    if (opts.forceTcp || m.tc) {
      try { raw = await tcpQuery(server, pkt); m = parseMsg(raw); via = 'tcp' } catch (e) { return { error: 'tcp ' + (e.message || e.code) } }
    }
  } catch (e) { return { error: 'parse ' + e.message } }
  if (m.id !== id) return { error: 'id mismatch' }
  m.via = via; m.ms = Date.now() - t0
  return m
}

// ---------------------------------------------------------------- normalised record sets
const stripDot = (s) => String(s).replace(/\.$/, '').toLowerCase()
function normNode(type, v) {
  switch (type) {
    case 'A': case 'AAAA': return String(v.address ?? v).toLowerCase()
    case 'CNAME': case 'NS': return stripDot(v)
    case 'MX': return v.priority + ' ' + stripDot(v.exchange)
    case 'TXT': return v.join('')
    case 'SOA': return [stripDot(v.nsname), stripDot(v.hostmaster), v.serial, v.refresh, v.retry, v.expire, v.minttl].join(' ')
    case 'SRV': return [v.priority, v.weight, v.port, stripDot(v.name)].join(' ')
    case 'CAA': { const tag = ['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone'].find((k) => v[k] !== undefined) || 'unknown'; return (v.critical ? 128 : 0) + ' ' + tag + ' ' + v[tag] }
    default: return JSON.stringify(v)
  }
}
function normDoh(type, d) {
  switch (type) {
    case 'A': case 'AAAA': case 'CNAME': case 'NS': return stripDot(d)
    case 'MX': { const [p, h] = d.split(' '); return p + ' ' + stripDot(h) }
    case 'TXT': { const m = [...d.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\(.)/g, '$1')); return m.length ? m.join('') : d }
    case 'SOA': { const p = d.split(' '); p[0] = stripDot(p[0]); p[1] = stripDot(p[1]); return p.join(' ') }
    case 'SRV': { const p = d.split(' '); p[3] = stripDot(p[3]); return p.join(' ') }
    case 'CAA': {
      const h = d.match(/^\\# (\d+) ([0-9a-f]+)$/i)
      if (h) { const b = Buffer.from(h[2], 'hex'); const tl = b[1]; return b[0] + ' ' + b.toString('ascii', 2, 2 + tl) + ' ' + b.toString('utf8', 2 + tl) }
      return d.replace(/"/g, '')
    }
    default: return d
  }
}
const nodeFn = { A: 'resolve4', AAAA: 'resolve6', CNAME: 'resolveCname', NS: 'resolveNs', SOA: 'resolveSoa', MX: 'resolveMx', TXT: 'resolveTxt', CAA: 'resolveCaa', SRV: 'resolveSrv' }
async function viaNode(resolver, name, type) {
  try {
    const r = await resolver[nodeFn[type]](name)
    const list = type === 'SOA' ? [r] : r
    return list.map((v) => normNode(type, v)).sort()
  } catch (e) {
    if (['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENOENT'].includes(e.code)) return []
    return ['ERR:' + e.code]
  }
}
async function viaDoh(provider, name, type, extra = {}) {
  const url = provider === 'cf'
    ? `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
    : `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`
  try {
    const r = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return ['ERR:http' + r.status]
    const j = await r.json()
    if (extra.raw) return j
    return (j.Answer || []).filter((a) => a.type === T[type]).map((a) => normDoh(type, a.data)).sort()
  } catch (e) { return ['ERR:' + (e.cause?.code || e.name)] }
}
function authSet(m, type) {
  if (m.error) return ['ERR:' + m.error]
  if (m.rcode !== 0 && m.rcode !== 3) return ['ERR:rcode' + m.rcode]
  return m.answers.filter((a) => a.type === T[type]).map((a) => (type === 'TXT' ? a.data : String(a.data).toLowerCase())).sort()
}

// ---------------------------------------------------------------- names
const LABELS = ['www', 'mail', 'webmail', 'ftp', 'api', 'admin', 'backends', 'cdn', 'shop', 'm', 'smtp', 'imap', 'pop', 'ns1', 'ns2', 'autodiscover', 'autoconfig', 'mta-sts',
  '_dmarc', '_domainkey', 'default._domainkey', 'selector1._domainkey', 'selector2._domainkey', 'hostingermail-a._domainkey', 'hostingermail-b._domainkey', 'hostingermail-c._domainkey',
  'google._domainkey', 'titan1._domainkey', 'dkim._domainkey', 'k1._domainkey', 's1._domainkey', 's2._domainkey', 'mail._domainkey',
  '_mta-sts', '_smtp._tls', '_acme-challenge', '_autodiscover._tcp', '_submission._tcp', '_submissions._tcp', '_imaps._tcp', '_imap._tcp']
const NAMES = [APEX, ...LABELS.map((l) => l + '.' + APEX)]
function typesFor(name) {
  if (name === APEX) return ['A', 'AAAA', 'NS', 'SOA', 'MX', 'TXT', 'CAA']
  if (name === WWW) return ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'CAA']
  if (name.includes('._tcp.')) return ['SRV']
  if (/(^|\.)_/.test(short(name))) return ['TXT', 'CNAME']
  return ['A', 'AAAA', 'CNAME', 'TXT', 'MX']
}
const KEYS = NAMES.flatMap((n) => typesFor(n).map((t) => [n, t]))

// ================================================================ MAIN
P(`== dns-check ${new Date().toISOString()} from the VPS; default resolvers: ${dns.getServers().join(',')}`)
const pubResolvers = Object.fromEntries(PUBLIC.map((ip) => { const r = new dns.promises.Resolver({ timeout: 3000, tries: 2 }); r.setServers([ip]); return [ip, r] }))
const sysResolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 })

// ---- 1. nameservers (child side) and parent delegation
const nsChild = (await viaNode(pubResolvers['1.1.1.1'], APEX, 'NS'))
P(`== 1 NS (1.1.1.1): ${nsChild.join(', ') || 'NONE'}`)
const nsInfo = []
for (const h of nsChild.filter((x) => !x.startsWith('ERR'))) {
  const a = await viaNode(pubResolvers['1.1.1.1'], h, 'A'), a6 = await viaNode(pubResolvers['1.1.1.1'], h, 'AAAA')
  nsInfo.push({ host: h, a, a6 })
  P(`   ${h} A=${a.join('|') || 'none (LAME/dangling)'} AAAA=${a6.join('|') || '-'}`)
  if (!a.length) V('high', 'lame-ns', `NS ${h} has no A record`)
}
// parent delegation: walk down from the .kw servers without recursion
try {
  const kwNs = (await viaNode(pubResolvers['1.1.1.1'], 'kw', 'NS')).filter((x) => !x.startsWith('ERR'))
  P(`== 1b parent: kw NS = ${kwNs.join(', ') || 'none returned'}`)
  let servers = []
  for (const h of kwNs) servers.push(...(await viaNode(pubResolvers['1.1.1.1'], h, 'A')).filter((x) => !x.startsWith('ERR')))
  let deleg = null
  for (let step = 0; step < 4 && servers.length && !deleg; step++) {
    let m = null, used = null
    for (const s of servers.slice(0, 4)) { const r = await ask(s, APEX, T.NS, { rd: false }); if (!r.error) { m = r; used = s; break } }
    if (!m) { P(`   step ${step}: no parent server answered (${servers.slice(0, 4).join(',')})`); break }
    const recs = [...m.answers, ...m.authority].filter((r) => r.type === T.NS)
    const own = recs.filter((r) => r.name === APEX)
    if (own.length) {
      deleg = { from: used, ns: own.map((r) => r.data).sort(), ttl: own[0].ttl, glue: m.additional.filter((r) => r.type === T.A || r.type === T.AAAA).map((r) => r.name + '=' + r.data) }
    } else if (recs.length) {
      const hosts = recs.map((r) => r.data)
      servers = []
      for (const h of hosts) servers.push(...(await viaNode(pubResolvers['1.1.1.1'], h, 'A')).filter((x) => !x.startsWith('ERR')))
      P(`   step ${step}: referral via ${used} to ${recs[0].name} (${hosts.join(',')})`)
    } else { P(`   step ${step}: ${used} rcode=${m.rcode} no NS (answers ${m.answers.length}, auth ${m.authority.length})`); break }
  }
  if (deleg) {
    P(`   delegation at parent (asked ${deleg.from}): ${deleg.ns.join(', ')} ttl=${deleg.ttl}; glue: ${deleg.glue.join(' ') || 'none'}`)
    const a = deleg.ns.join(), b = [...nsChild].sort().join()
    if (a !== b) { P('   !! parent delegation differs from the child NS set'); V('medium', 'deleg-mismatch', `parent ${a} vs child ${b}`) } else P('   parent delegation == child NS set')
  }
} catch (e) { P('   parent walk failed: ' + e.message) }

// ---- 2. authoritative servers, direct
const authServers = []
for (const n of nsInfo) for (const ip of n.a) authServers.push({ host: n.host, ip })
P(`== 2 authoritative servers (${authServers.length} addresses)`)
const authReport = []
await pool(authServers, 4, async (s) => {
  const r = { ...s }
  const soa = await ask(s.ip, APEX, T.SOA, { rd: false })
  if (soa.error) { r.err = soa.error; authReport.push(r); return }
  r.aa = soa.aa; r.ra = soa.ra; r.rcode = soa.rcode; r.edns = soa.edns; r.ms = soa.ms
  r.soa = soa.answers.find((a) => a.type === T.SOA)
  const noedns = await ask(s.ip, APEX, T.SOA, { rd: false, edns: false })
  r.noEdnsOk = !noedns.error && noedns.rcode === 0
  const tcp = await ask(s.ip, APEX, T.SOA, { rd: false, forceTcp: true })
  r.tcp = tcp.error ? 'FAIL ' + tcp.error : 'ok ' + tcp.ms + 'ms'
  const key = await ask(s.ip, APEX, T.DNSKEY, { rd: false, dobit: true })
  r.dnskey = key.error ? 'err' : key.answers.filter((a) => a.type === T.DNSKEY).length
  r.rrsig = key.error ? 'err' : key.answers.filter((a) => a.type === T.RRSIG).length
  const axfr = await ask(s.ip, APEX, T.AXFR, { rd: false, forceTcp: true, edns: false })
  r.axfr = axfr.error ? 'closed/' + axfr.error : 'rcode' + axfr.rcode + ' answers' + axfr.answers.length
  const rec = await ask(s.ip, 'example.com', T.A, { rd: true })
  r.recursion = rec.error ? 'n/a' : (rec.answers.length ? 'ANSWERS (open recursion)' : 'refused/none rcode' + rec.rcode)
  authReport.push(r)
})
authReport.sort((a, b) => a.host.localeCompare(b.host))
for (const r of authReport) {
  if (r.err) { P(`   ${r.host} ${r.ip}: UNREACHABLE (${r.err})`); V('high', 'ns-unreachable', `${r.host} ${r.ip}: ${r.err}`); continue }
  P(`   ${r.host} ${r.ip}: SOA serial ${r.soa ? r.soa.data.split(' ')[2] : 'none'} AA=${r.aa} rcode=${r.rcode} EDNS=${r.edns} noEDNS=${r.noEdnsOk} TCP=${r.tcp} ${r.ms}ms DNSKEY=${r.dnskey} RRSIG=${r.rrsig} AXFR=${r.axfr} recursion=${r.recursion}`)
  if (!r.aa) V('high', 'ns-lame', `${r.host} ${r.ip} answers without AA (lame)`)
  if (String(r.tcp).startsWith('FAIL')) V('medium', 'ns-tcp', `${r.host} no TCP/53: ${r.tcp}`)
  if (!r.edns) V('low', 'ns-edns', `${r.host} no EDNS0`)
  if (/rcode0 answers[1-9]/.test(r.axfr)) V('high', 'axfr-open', `${r.host} allows AXFR`)
}
const okAuth = authReport.filter((r) => !r.err && r.aa)
const serials = [...new Set(okAuth.map((r) => r.soa && r.soa.data.split(' ')[2]))]
P(`   SOA serial agreement: ${serials.length === 1 ? 'all equal ' + serials[0] : 'DIFFER ' + serials.join(' vs ')}`)
if (serials.length > 1) V('high', 'serial-differs', 'authoritative SOA serials differ: ' + serials.join(' vs '))
const soaRow = okAuth[0]?.soa
if (soaRow) { const p = soaRow.data.split(' '); P(`   SOA: mname=${p[0]} rname=${p[1]} serial=${p[2]} refresh=${p[3]} retry=${p[4]} expire=${p[5]} minimum=${p[6]} ttl=${soaRow.ttl}`) }
const dnssecKeys = okAuth.some((r) => r.dnskey > 0)

// cross-server comparison of the records that matter
const CMP = [[APEX, 'A'], [APEX, 'AAAA'], [APEX, 'NS'], [APEX, 'MX'], [APEX, 'TXT'], [APEX, 'CAA'], [WWW, 'A'], [WWW, 'AAAA'], [WWW, 'CNAME'],
  ['_dmarc.' + APEX, 'TXT'], ['hostingermail-a._domainkey.' + APEX, 'CNAME'], ['hostingermail-b._domainkey.' + APEX, 'CNAME'], ['hostingermail-c._domainkey.' + APEX, 'CNAME'], ['default._domainkey.' + APEX, 'TXT'], ['mail.' + APEX, 'A']]
const cmpBad = []
await pool(CMP, 3, async ([n, t]) => {
  const sets = []
  for (const s of okAuth) { const m = await ask(s.ip, n, T[t], { rd: false }); sets.push(authSet(m, t).join(' ; ')) }
  if (new Set(sets).size > 1) cmpBad.push(`${n} ${t}: ` + okAuth.map((s, i) => `${s.host}=[${clip(sets[i], 60)}]`).join(' '))
})
P(`   cross-server record comparison (${CMP.length} rrsets x ${okAuth.length} servers): ${cmpBad.length ? cmpBad.length + ' DIFFER' : 'all identical'}`)
for (const b of cmpBad) { P('   DIFF ' + b); V('high', 'auth-differs', b) }

// ---- 3. zone dump from the first good authoritative server (original TTLs)
const primary = okAuth[0]
const dump = {}
if (primary) {
  P(`== 3 records as served by ${primary.host} (${primary.ip}); TTL in seconds`)
  await pool(KEYS, 10, async ([n, t]) => {
    const m = await ask(primary.ip, n, T[t], { rd: false })
    dump[n + '|' + t] = m
  })
  const emptyNames = []
  for (const n of NAMES) {
    let any = false
    for (const t of typesFor(n)) {
      const m = dump[n + '|' + t]
      if (!m || m.error) { P(`   ${short(n)} ${t}: ${m ? 'ERR ' + m.error : '-'}`); continue }
      const rr = m.answers.filter((a) => a.type === T[t])
      for (const a of rr) { any = true; P(`   ${short(n)} ${t} ${a.ttl} ${clip(a.data, 220)}`) }
      if (m.rcode !== 0 && m.rcode !== 3) P(`   ${short(n)} ${t}: rcode ${m.rcode}`)
    }
    if (!any) emptyNames.push(short(n))
  }
  P(`   (no records at: ${emptyNames.join(' ')})`)
}
const D = (n, t) => (dump[n + '|' + t]?.answers || []).filter((a) => a.type === T[t])
const apexA = D(APEX, 'A'), wwwA = D(WWW, 'A'), wwwCn = D(WWW, 'CNAME'), apexAAAA = D(APEX, 'AAAA'), wwwAAAA = D(WWW, 'AAAA')
const pointsHome = (rr) => rr.length > 0 && rr.every((a) => a.data === VPS_IP)
P(`== 3b where it points: apex A=${apexA.map((a) => a.data).join('|') || 'none'} (ttl ${apexA[0]?.ttl ?? '-'}); www A=${wwwA.map((a) => a.data).join('|') || 'none'} CNAME=${wwwCn.map((a) => a.data).join('|') || 'none'} (ttl ${(wwwA[0] || wwwCn[0])?.ttl ?? '-'}); apex AAAA=${apexAAAA.map((a) => a.data).join('|') || 'none'} www AAAA=${wwwAAAA.map((a) => a.data).join('|') || 'none'}`)
if (primary) {
  if (!pointsHome(apexA)) V('high', 'apex-not-vps', `apex A is ${apexA.map((a) => a.data).join('|') || 'empty'}, expected ${VPS_IP}`)
  if (!wwwA.length && wwwCn.length) P(`   www is a CNAME to ${wwwCn[0].data}`)
  else if (!pointsHome(wwwA)) V('high', 'www-not-vps', `www A is ${wwwA.map((a) => a.data).join('|') || 'empty'}, expected ${VPS_IP}`)
  for (const a of [...apexAAAA, ...wwwAAAA]) V('medium', 'aaaa-present', `${a.name} AAAA ${a.data} (the VPS serves IPv4 ${VPS_IP}); verify it answers 443`)
  for (const a of [...apexA, ...wwwA]) { if (a.ttl > 14400) V('low', 'ttl-long', `${a.name} A ttl ${a.ttl}s is long for a migration`); if (a.ttl < 300) V('low', 'ttl-short', `${a.name} A ttl ${a.ttl}s is short`) }
}

// wildcard test (authoritative, RD=0)
if (primary) {
  const rnd = 'zz-nx-' + randomInt(1e9).toString(36)
  const w = []
  for (const t of ['A', 'TXT', 'MX', 'CNAME']) { const m = await ask(primary.ip, `${rnd}.${APEX}`, T[t], { rd: false }); if (!m.error && m.rcode === 0 && m.answers.some((a) => a.type === T[t] || a.type === T.CNAME)) w.push(t + '=' + m.answers.map((a) => a.data).join('|')) }
  const sub = await ask(primary.ip, `${rnd}.www.${APEX}`, T.A, { rd: false })
  if (!sub.error && sub.answers.length) w.push('www-sub A=' + sub.answers.map((a) => a.data).join('|'))
  P(`== 3c wildcard probe ${rnd}: ${w.length ? 'WILDCARD ' + w.join(' ') : 'none (NXDOMAIN/NODATA for a random label)'}`)
  if (w.length) V('medium', 'wildcard', 'wildcard record answers for random labels: ' + w.join(' '))
}
// dangling CNAMEs
{
  const cnames = Object.entries(dump).flatMap(([k, m]) => (m.answers || []).filter((a) => a.type === T.CNAME).map((a) => [k.split('|')[0], a.data]))
  const seen = new Set(), rows = []
  for (const [n, tg] of cnames) {
    if (seen.has(n + tg)) continue
    seen.add(n + tg)
    const a = await viaNode(sysResolver, tg, 'A'), a6 = await viaNode(sysResolver, tg, 'AAAA')
    const both = a.concat(a6)
    rows.push(`${short(n)}->${tg} resolves ${both.join('|') || 'NOTHING (dangling)'}`)
    if (!both.length) V('medium', 'dangling-cname', `${n} CNAME ${tg} resolves to nothing`)
  }
  P(`== 3d CNAME targets: ${rows.join(' ; ') || 'no CNAMEs'}`)
}

// ---- 4. the other views against the authoritative answer
P('== 4 resolver views vs authoritative (' + KEYS.length + ' name/type keys; "sys" = VPS default resolver)')
const views = { sys: {}, '1.1.1.1': {}, '8.8.8.8': {}, '9.9.9.9': {}, 'doh-cf': {}, 'doh-google': {} }
await pool(KEYS, 12, async ([n, t]) => {
  const k = n + '|' + t
  views.sys[k] = await viaNode(sysResolver, n, t)
  for (const ip of PUBLIC) views[ip][k] = await viaNode(pubResolvers[ip], n, t)
})
await pool(KEYS, 6, async ([n, t]) => {
  const k = n + '|' + t
  views['doh-cf'][k] = await viaDoh('cf', n, t)
  views['doh-google'][k] = await viaDoh('google', n, t)
})
const dohDead = { cf: Object.values(views['doh-cf']).every((v) => v[0]?.startsWith('ERR')), google: Object.values(views['doh-google']).every((v) => v[0]?.startsWith('ERR')) }
if (dohDead.cf) P('   DoH cloudflare-dns.com: blocked/unreachable from the VPS: ' + Object.values(views['doh-cf'])[0][0])
if (dohDead.google) P('   DoH dns.google: blocked/unreachable from the VPS: ' + Object.values(views['doh-google'])[0][0])
let diffs = 0, shown = 0
const errCount = {}
for (const [n, t] of KEYS) {
  const k = n + '|' + t
  const base = primary ? authSet(dump[k] || { error: 'none' }, t).join(' ; ') : null
  const row = {}
  for (const [vn, vv] of Object.entries(views)) { if ((vn === 'doh-cf' && dohDead.cf) || (vn === 'doh-google' && dohDead.google)) continue; row[vn] = (vv[k] || []).join(' ; ') }
  for (const [vn, val] of Object.entries(row)) if (val.startsWith('ERR')) errCount[vn] = (errCount[vn] || 0) + 1
  const vals = Object.entries(row).filter(([, v]) => !v.startsWith('ERR'))
  const all = new Set(vals.map(([, v]) => v).concat(base !== null && !base.startsWith('ERR') ? [base] : []))
  if (all.size > 1) {
    diffs++
    if (shown++ < 30) P(`   DIFF ${short(n)} ${t}: auth=[${clip(base ?? '?', 70)}] ` + vals.map(([vn, v]) => `${vn}=[${clip(v, 70)}]`).join(' '))
  }
}
P(`   keys compared ${KEYS.length}; keys where views disagree: ${diffs}; resolver errors/timeouts by view: ${JSON.stringify(errCount)}`)
if (diffs) V('medium', 'views-differ', `${diffs} name/type keys differ between authoritative and resolver views (stale cache or split DNS)`)

// ---- 5. DNSSEC
P('== 5 DNSSEC')
{
  const ds = await viaDoh('cf', APEX, 'DS', { raw: true })
  const dsAns = (ds.Answer || []).filter((a) => a.type === 43)
  const dsG = await viaDoh('google', APEX, 'DS', { raw: true })
  const dsAnsG = (dsG.Answer || []).filter((a) => a.type === 43)
  const kwDs = await viaDoh('cf', 'kw', 'DS', { raw: true })
  const wwwq = await viaDoh('cf', WWW, 'A', { raw: true })
  P(`   DS for ${APEX} at parent: cloudflare ${Array.isArray(ds) ? ds[0] : dsAns.length + ' records'}; google ${Array.isArray(dsG) ? dsG[0] : dsAnsG.length + ' records'}; DS for kw (TLD signed?): ${Array.isArray(kwDs) ? kwDs[0] : (kwDs.Answer || []).filter((a) => a.type === 43).length + ' records'}`)
  P(`   DNSKEY at authoritative servers: ${dnssecKeys ? 'present' : 'none'}; cloudflare validated (AD) for www A: ${Array.isArray(wwwq) ? wwwq[0] : wwwq.AD}`)
  if (!dsAns.length && !dsAnsG.length && !dnssecKeys) { P('   => zone is NOT DNSSEC-signed (no DS, no DNSKEY)'); V('info', 'dnssec-off', 'zone is unsigned (no DS, no DNSKEY)') }
  else if ((dsAns.length || dsAnsG.length) && !dnssecKeys) V('high', 'dnssec-broken', 'DS at parent but no DNSKEY served: validating resolvers will SERVFAIL')
}

// ---- 6. reverse DNS
P('== 6 PTR of ' + VPS_IP)
{
  const rev = VPS_IP.split('.').reverse().join('.') + '.in-addr.arpa'
  let sys = []; try { sys = await dns.promises.reverse(VPS_IP) } catch (e) { sys = ['ERR:' + e.code] }
  const pub = {}
  for (const ip of PUBLIC) { try { pub[ip] = await pubResolvers[ip].reverse(VPS_IP) } catch (e) { pub[ip] = ['ERR:' + e.code] } }
  P(`   ${rev}: sys=${sys.join('|')} ` + Object.entries(pub).map(([k, v]) => `${k}=${v.join('|')}`).join(' '))
}

// ---- 7. TLS and HTTP hops
P('== 7 TLS certificate (connect to ' + VPS_IP + ':443 with SNI) and redirect hops')
function tlsInfo(host, sni) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: sni, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = s.getPeerCertificate()
      const left = Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400000)
      resolve({ sni, proto: s.getProtocol(), alpn: s.alpnProtocol, authorized: s.authorized, authErr: s.authorizationError || '', san: c.subjectaltname || '', cn: c.subject && c.subject.CN, issuer: c.issuer && (c.issuer.O + ' ' + c.issuer.CN), to: c.valid_to, left, from: c.valid_from })
      s.destroy()
    })
    s.on('timeout', () => { s.destroy(); resolve({ sni, error: 'timeout' }) })
    s.on('error', (e) => resolve({ sni, error: e.code || e.message }))
  })
}
for (const sni of [APEX, WWW]) {
  const c = await tlsInfo(VPS_IP, sni)
  if (c.error) { P(`   SNI ${sni}: ERROR ${c.error}`); V('high', 'tls-fail', `TLS to ${VPS_IP} with SNI ${sni}: ${c.error}`); continue }
  P(`   SNI ${sni}: ${c.proto} alpn=${c.alpn} trusted=${c.authorized}${c.authErr ? '(' + c.authErr + ')' : ''} CN=${c.cn} issuer=[${c.issuer}] SAN=[${c.san.replace(/DNS:/g, '')}] valid ${c.from} -> ${c.to} (${c.left} days left)`)
  const sans = c.san.split(', ').map((x) => x.replace('DNS:', ''))
  if (!sans.includes(sni) && !sans.includes('*.' + APEX)) V('high', 'cert-san', `cert for SNI ${sni} does not cover it: ${sans.join(',')}`)
  if (c.left < 21) V('high', 'cert-expiry', `${sni} cert expires in ${c.left} days`)
  if (!c.authorized) V('high', 'cert-untrusted', `${sni} cert not trusted by this node: ${c.authErr}`)
}
// the IPv6 path, only if an AAAA exists
for (const a of [...apexAAAA, ...wwwAAAA]) {
  const c = await tlsInfo(a.data, a.name)
  P(`   IPv6 ${a.name} AAAA ${a.data}: ` + (c.error ? 'cannot connect from this VPS: ' + c.error + ' (not conclusive if the VPS has no IPv6 egress)' : `TLS ok ${c.proto} CN=${c.cn} issuer=${c.issuer}`))
}
{
  const a = await viaNode(sysResolver, WWW, 'A')
  if (a[0] && a[0] !== VPS_IP) P(`   note: sys resolver gives ${WWW} = ${a.join('|')} (not ${VPS_IP})`)
}
async function chain(start) {
  const rows = []
  let url = start
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
      const loc = r.headers.get('location')
      rows.push({ url, status: r.status, loc, hsts: r.headers.get('strict-transport-security') })
      await r.arrayBuffer().catch(() => {})
      if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).href; await sleep(100) } else break
    } catch (e) { rows.push({ url, error: e.cause?.code || e.message }); break }
  }
  return rows
}
for (const start of ['http://' + APEX + '/', 'https://' + APEX + '/', 'http://' + WWW + '/', 'https://' + WWW + '/', 'http://' + APEX + '/shop?x=1&lang=en', 'https://' + APEX + '/product/abc?y=2']) {
  const rows = await chain(start)
  const hops = rows.filter((r) => r.status >= 300 && r.status < 400).length
  P(`   GET ${start} -> ${rows.map((r) => r.error ? 'ERR ' + r.error : r.status + (r.loc ? ' ' + r.loc : '')).join(' => ')}  [${hops} redirect hop${hops === 1 ? '' : 's'}]`)
  const last = rows[rows.length - 1]
  if (last && last.status === 200) P(`      final ${last.status} hsts=${last.hsts || 'none'}`)
  if (start.includes('//' + APEX) && hops !== 1) V('medium', 'apex-hops', `${start} takes ${hops} redirect hops to the final URL (expected exactly 1)`)
  if (last && last.error) V('high', 'http-fail', `${start}: ${last.error}`)
  if (start.startsWith('https://www') && last.status !== 200) V('high', 'www-not-200', `${start} final status ${last.status}`)
}
// the bare server IP, with its own Host header (CLAUDE.md: the IP spelling must 301 to https://www)
await new Promise((resolve) => {
  const req = http.request({ host: VPS_IP, port: 80, path: '/', method: 'GET', headers: { host: VPS_IP }, timeout: 8000 }, (res) => {
    P(`   GET http://${VPS_IP}/ (Host: ${VPS_IP}) -> ${res.statusCode} ${res.headers.location || ''}`)
    res.resume(); resolve()
  })
  req.on('timeout', () => { req.destroy(); P('   GET by IP: timeout'); resolve() })
  req.on('error', (e) => { P('   GET by IP: ' + (e.code || e.message)); resolve() })
  req.end()
})

// ---- 8. CAA
P('== 8 CAA')
{
  const caa = D(APEX, 'CAA'), caaWww = D(WWW, 'CAA')
  if (!caa.length && !caaWww.length) { P("   no CAA at apex or www => any CA may issue; Let's Encrypt is therefore permitted"); V('low', 'caa-missing', 'no CAA record: any CA can issue for the domain') }
  else {
    const issue = caa.filter((a) => /\bissue /.test(a.data))
    const le = issue.some((a) => /letsencrypt\.org/.test(a.data)) || (!issue.length)
    P(`   CAA: ${caa.map((a) => a.data).join(' | ')}; Let's Encrypt permitted: ${le}`)
    if (!le) V('high', 'caa-blocks-le', 'CAA does not list letsencrypt.org: Traefik renewal will fail')
  }
}

// ---- 9. mail: MX, SPF, DKIM, DMARC, MTA-STS, TLS-RPT
P('== 9 mail authentication')
const txtOf = (n) => D(n, 'TXT').map((a) => a.data)
const mx = D(APEX, 'MX')
P(`   MX: ${mx.map((a) => a.data + ' (ttl ' + a.ttl + ')').join(' ; ') || 'NONE'}`)
for (const m of mx) {
  const h = m.data.split(' ')[1]
  const a = await viaNode(pubResolvers['1.1.1.1'], h, 'A')
  P(`      ${h} A=${a.join('|') || 'NONE (dangling MX)'}`)
  if (!a.length) V('high', 'mx-dangling', `MX ${h} does not resolve`)
}
if (!mx.length) V('high', 'mx-none', 'no MX: inbound mail to cs@sporta.com.kw cannot be delivered')
const hostingerMx = mx.length > 0 && mx.every((m) => /hostinger\.com$/.test(m.data))
P(`   MX all Hostinger: ${hostingerMx}`)
// SPF with lookup counting (RFC 7208 limit 10)
async function spfWalk(domain, depth, stats) {
  const t = (await viaNode(pubResolvers['1.1.1.1'], domain, 'TXT')).filter((x) => /^v=spf1(\s|$)/i.test(x))
  if (!t.length) return `${domain}: no SPF`
  const parts = []
  for (const tok of t[0].split(/\s+/).slice(1)) {
    const m = tok.match(/^([+\-~?])?(include|a|mx|ptr|exists|redirect|ip4|ip6|all)(?:[:=](.*))?$/i)
    if (!m) { parts.push(tok + '?'); continue }
    const mech = m[2].toLowerCase()
    if (['include', 'redirect'].includes(mech)) { stats.lookups++; if (depth < 6) parts.push(`${mech}:${m[3]} {${await spfWalk(m[3], depth + 1, stats)}}`) }
    else if (['a', 'mx', 'ptr', 'exists'].includes(mech)) { stats.lookups++; parts.push(tok) }
    else if (mech === 'ip4') { stats.ip4.push(m[3]); parts.push(tok) }
    else if (mech === 'all') { if (depth === 0) stats.all = (m[1] || '+') + 'all'; parts.push(tok) }
    else parts.push(tok)
  }
  return parts.join(' ')
}
const ipIn = (ip, cidr) => { const [b, l = '32'] = cidr.split('/'); const toN = (x) => x.split('.').reduce((a, p) => a * 256 + Number(p), 0); const sh = 2 ** (32 - Number(l)); return Math.floor(toN(ip) / sh) === Math.floor(toN(b) / sh) }
const spfRecs = txtOf(APEX).filter((x) => /^v=spf1(\s|$)/i.test(x))
P(`   SPF records at apex: ${spfRecs.length}`)
const spfStats = { lookups: 0, ip4: [], all: null }
if (spfRecs.length) {
  const tree = await spfWalk(APEX, 0, spfStats)
  P(`   SPF: ${clip(spfRecs[0], 300)}`)
  P(`   SPF expanded: ${clip(tree, 700)}`)
  P(`   SPF DNS-lookup count ${spfStats.lookups} (limit 10); terminal qualifier ${spfStats.all}; VPS IP ${VPS_IP} authorised by ip4: ${spfStats.ip4.some((c) => ipIn(VPS_IP, c))}`)
  if (spfRecs.length > 1) V('high', 'spf-multiple', 'more than one SPF record: PermError, SPF fails for all mail')
  if (spfStats.lookups > 10) V('high', 'spf-lookups', `SPF needs ${spfStats.lookups} DNS lookups (>10): PermError`)
  if (!/^[~-]all$/.test(spfStats.all || '')) V('medium', 'spf-all', `SPF ends with ${spfStats.all}, not ~all/-all`)
  if (!/include:_spf\.mail\.hostinger\.com/i.test(spfRecs[0])) V('medium', 'spf-hostinger', 'SPF does not include _spf.mail.hostinger.com, the sender the shop uses (smtp.hostinger.com)')
} else V('high', 'spf-missing', 'no SPF record at the apex')
// DKIM
const dk = []
const selectors = ['default', 'selector1', 'selector2', 'hostingermail-a', 'hostingermail-b', 'hostingermail-c', 'google', 'titan1', 'dkim', 'k1', 's1', 's2', 'mail']
for (const s of selectors) {
  const n = `${s}._domainkey.${APEX}`
  const txt = txtOf(n), cn = D(n, 'CNAME')
  if (cn.length) {
    const tgt = cn[0].data
    const tt = await viaNode(pubResolvers['1.1.1.1'], tgt, 'TXT')
    dk.push(`${s}: CNAME ${tgt} -> ${tt.length ? 'TXT ' + clip(tt[0], 60) : 'NO KEY (dangling)'}`)
    if (!tt.length) V('medium', 'dkim-dangling', `${n} CNAME ${tgt} has no TXT key`)
  } else if (txt.length) dk.push(`${s}: TXT ${clip(txt[0], 80)}`)
}
P(`   DKIM selectors found: ${dk.length ? dk.length : 'NONE'}`)
for (const l of dk) P('      ' + l)
const hostingerDkim = dk.some((l) => /^hostingermail-/.test(l))
// DMARC
const dm = txtOf('_dmarc.' + APEX).filter((x) => /^v=DMARC1/i.test(x))
if (dm.length) {
  const tags = Object.fromEntries(dm[0].split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] }))
  P(`   DMARC: ${dm[0]}  (records ${dm.length}; p=${tags.p} sp=${tags.sp || '-'} pct=${tags.pct || '100'} adkim=${tags.adkim || 'r'} aspf=${tags.aspf || 'r'} rua=${tags.rua || 'NONE'} ruf=${tags.ruf || '-'})`)
  if (dm.length > 1) V('high', 'dmarc-multiple', 'more than one DMARC record: ignored by receivers')
  if (!tags.rua) V('low', 'dmarc-rua', 'DMARC has no rua= : no aggregate reports')
  if (tags.p === 'none') V('low', 'dmarc-none', 'DMARC p=none: monitor only')
} else V('high', 'dmarc-missing', 'no DMARC record at _dmarc.sporta.com.kw')
// MTA-STS / TLS-RPT
const sts = txtOf('_mta-sts.' + APEX), rpt = txtOf('_smtp._tls.' + APEX)
P(`   MTA-STS TXT: ${sts.join('|') || 'none'}; TLS-RPT TXT: ${rpt.join('|') || 'none'}`)
if (sts.length) {
  try { const r = await fetch(`https://mta-sts.${APEX}/.well-known/mta-sts.txt`, { signal: AbortSignal.timeout(8000) }); P(`   MTA-STS policy fetch: ${r.status} ${clip((await r.text()).replace(/\s+/g, ' '), 160)}`) } catch (e) { P('   MTA-STS policy fetch failed: ' + (e.cause?.code || e.message)) }
}
P(`   apex TXT (${txtOf(APEX).length}): ` + txtOf(APEX).map((x) => clip(x, 90)).join(' | '))
P(`   outgoing-mail inputs (shop sends via msmtp -> smtp.hostinger.com as cs@sporta.com.kw; From and envelope = cs@sporta.com.kw): MX Hostinger ${hostingerMx}; SPF records ${spfRecs.length}, includes hostinger ${spfRecs[0] ? /include:_spf\.mail\.hostinger\.com/i.test(spfRecs[0]) : false}; DKIM hostingermail selectors ${hostingerDkim}; DMARC ${dm.length ? 'present' : 'missing'}`)

// ---- 10. registrar / expiry
P('== 10 registrar / expiry')
try {
  const r = await fetch('https://rdap.org/domain/' + APEX, { redirect: 'follow', signal: AbortSignal.timeout(10000) })
  const txt = await r.text()
  P(`   rdap.org -> ${r.status} (${r.url})`)
  if (r.ok) {
    try {
      const j = JSON.parse(txt)
      const ev = (j.events || []).map((e) => e.eventAction + '=' + e.eventDate).join(' ')
      const reg = (j.entities || []).filter((e) => (e.roles || []).includes('registrar')).map((e) => (e.vcardArray?.[1] || []).find((x) => x[0] === 'fn')?.[3]).join('|')
      P(`   status=${(j.status || []).join(',')} registrar=${reg || '?'} events: ${ev}; ns=${(j.nameservers || []).map((n) => n.ldhName).join(',')}`)
    } catch { P('   rdap body: ' + clip(txt.replace(/\s+/g, ' '), 200)) }
  } else P('   rdap body: ' + clip(txt.replace(/\s+/g, ' '), 160))
} catch (e) { P('   rdap.org not checked: ' + (e.cause?.code || e.message)) }
for (const host of ['whois.nic.kw', 'whois.kw']) {
  const got = await new Promise((resolve) => {
    let ok = false, buf = ''
    const s = net.connect({ host, port: 43, timeout: 5000 }, () => { ok = true; s.write(APEX + '\r\n') })
    s.on('data', (d) => { buf += d; if (buf.length > 20000) s.destroy() })
    s.on('timeout', () => { s.destroy(); resolve(ok ? buf : null) })
    s.on('error', () => resolve(null))
    s.on('close', () => resolve(ok ? buf : null))
  })
  if (got === null) { P(`   whois ${host}:43 not reachable within 5 s: not checked`); continue }
  const lines = got.split(/\r?\n/).filter((l) => /domain|registrar|creat|expir|updat|status|name ?server|nserver|renew|no match|not found/i.test(l) && !/@|phone|tel|fax/i.test(l)).slice(0, 16)
  P(`   whois ${host}: ${lines.map((l) => l.trim()).join(' / ') || clip(got.replace(/\s+/g, ' '), 200)}`)
  break
}

// ---- verdicts
P('== VERDICTS (level id message)')
for (const [l, id, m] of verdicts) P(`   ${l.toUpperCase()} ${id}: ${clip(m, 260)}`)
P(`== done: ${out.length} lines, ${verdicts.length} verdicts`)
