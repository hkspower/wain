#!/usr/bin/env node
// PORT SCAN — what the VPS listens on, and what of that the internet can reach.
//
// Runs on the VPS (`node scripts/vps-deploy.mjs compose --scan ports`), in a
// container on the HOST's network namespace, so /proc/net/{tcp,tcp6,udp,udp6}
// are the host's own socket tables — every listener, including Docker's
// published ports and anything bound outside Docker.
//
// Two layers decide whether a port is reachable, and this reads both:
//   1. the BIND — 127.0.0.1/::1 is this machine only; a Docker bridge address
//      (172.16/12 …) is container-to-container; 0.0.0.0, :: or the public IP
//      is every interface, i.e. the internet unless something drops it;
//   2. the EDGE — the Hostinger firewall group attached to the VM, which drops
//      everything it does not accept. The container cannot ask the Hostinger
//      API, so the rules are passed in (SPORTA_PORTS_EDGE, `--edge` on the
//      compose step); the default is what the API returned on 2026-11-01.
// A port bound to every interface that the edge drops is a WARN, not a BAD:
// unreachable today, but one firewall rule — or a firewall swap, which this
// VM has had (the "Emergency Websites Disabled" group) — from public.
//
// Each TCP listener is then asked who it is: the first bytes it volunteers
// (SSH and MySQL speak first), else its answer to a bare HTTP HEAD. Nothing
// is logged into, nothing is written. Plus sshd's effective settings when a
// copy of its config is given (SPORTA_PORTS_SSHD) — not on the VPS, where
// the Hostinger API refuses a job that mounts it.
//
// READ-ONLY. Test hooks: SPORTA_PORTS_PROC (a directory holding tcp/tcp6/udp/
// udp6 in /proc/net format), SPORTA_PORTS_SSHD (a directory standing in for
// /etc/ssh), SPORTA_PORTS_PUBLIC (the VM's public addresses).
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'

const PROC = process.env.SPORTA_PORTS_PROC ?? '/proc/net'
const SSHD = process.env.SPORTA_PORTS_SSHD ?? '/host/ssh'
const PUBLIC = (process.env.SPORTA_PORTS_PUBLIC ?? '187.7.78.123,2a02:4780:7e:cca0::1').split(',').map((s) => s.trim().toLowerCase())
// proto/port@source — source "any" or an address/CIDR.
const EDGE = (process.env.SPORTA_PORTS_EDGE ?? 'tcp/80@any,tcp/443@any,tcp/22@178.61.10.104')
  .split(',').map((s) => s.trim()).filter(Boolean).map((r) => {
    const m = /^(tcp|udp)\/(\d+)(?::(\d+))?@(.+)$/i.exec(r)
    if (!m) throw new Error(`bad SPORTA_PORTS_EDGE rule "${r}"`)
    return { proto: m[1].toLowerCase(), from: Number(m[2]), to: Number(m[3] ?? m[2]), source: m[4] }
  })

let bad = 0, warn = 0
const ok = (s) => console.log(`ok   ${s}`)
const w = (s) => { warn++; console.log(`WARN ${s}`) }
const b = (s) => { bad++; console.log(`BAD  ${s}`) }
const head = (s) => console.log(`\n== ${s}`)

// What a port is usually for, so a finding says more than a number.
const KNOWN = {
  22: 'ssh', 25: 'smtp', 53: 'dns', 80: 'http', 443: 'https', 2375: 'Docker API (no TLS)', 2376: 'Docker API',
  3000: 'app', 3306: 'MySQL/MariaDB', 5432: 'PostgreSQL', 6379: 'Redis', 8080: 'http-alt / Traefik API',
  8443: 'https-alt', 9000: 'Portainer', 9090: 'Prometheus', 9200: 'Elasticsearch', 9443: 'Portainer',
  11211: 'memcached', 11434: 'Ollama', 11435: 'Ollama', 27017: 'MongoDB',
}
// Listening on every interface is never acceptable for these, firewall or not:
// each is a database or a control plane that trusts whoever connects.
const NEVER_PUBLIC = new Set([2375, 2376, 3306, 5432, 6379, 9200, 11211, 11434, 11435, 27017])

// ---------------------------------------------------------- socket tables
function v4(hex) { return [3, 2, 1, 0].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join('.') }
function v6(hex) {
  // Four 32-bit words, each in host (little-endian) byte order.
  let groups = ''
  for (let word = 0; word < 4; word++) {
    const wHex = hex.slice(word * 8, word * 8 + 8)
    const bytes = [3, 2, 1, 0].map((i) => wHex.slice(i * 2, i * 2 + 2)).join('')
    groups += bytes
  }
  const full = groups.match(/.{4}/g).join(':')
  const h = new URL(`http://[${full}]/`).hostname.slice(1, -1)   // the URL parser canonicalises IPv6
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h)
  if (mapped) {
    const n = (parseInt(mapped[1], 16) << 16 | parseInt(mapped[2], 16)) >>> 0
    return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')
  }
  return h
}
function table(file, proto, family) {
  const p = path.join(PROC, file)
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((f) => f.length > 9)
    .map((f) => {
      const [la, lp] = f[1].split(':')
      const [, rp] = f[2].split(':')
      return { proto, family, addr: family === 4 ? v4(la) : v6(la), port: parseInt(lp, 16), remotePort: parseInt(rp, 16), state: f[3], uid: Number(f[7]) }
    })
}
const tcp = [...table('tcp', 'tcp', 4), ...table('tcp6', 'tcp', 6)].filter((s) => s.state === '0A')            // LISTEN
const udp = [...table('udp', 'udp', 4), ...table('udp6', 'udp', 6)].filter((s) => s.state === '07' && s.remotePort === 0) // unconnected = bound

function scope(addr) {
  if (addr === '0.0.0.0' || addr === '::') return 'any'
  if (PUBLIC.includes(addr.toLowerCase())) return 'public'
  if (/^127\./.test(addr) || addr === '::1') return 'loopback'
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr) || /^f[cd]/i.test(addr)) return 'private'
  if (/^fe80/i.test(addr)) return 'link-local'
  return 'other'
}
const exposed = (s) => s === 'any' || s === 'public' || s === 'other'

// --------------------------------------------------------------- the edge
function inCidr(ip, cidr) {
  if (cidr === 'any') return true
  const [base, bits = '32'] = cidr.split('/')
  if (!net.isIPv4(ip) || !net.isIPv4(base)) return ip === base
  const n = (a) => a.split('.').reduce((x, o) => (x << 8 | Number(o)) >>> 0, 0)
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (n(ip) & mask) === (n(base) & mask)
}
const edgeFor = (proto, port) => EDGE.filter((r) => r.proto === proto && port >= r.from && port <= r.to)

// ---------------------------------------------------------- who is it
function ask(host, port) {
  return new Promise((resolve) => {
    let data = Buffer.alloc(0), sent = false, done = false
    const s = net.connect({ host, port, timeout: 2500 })
    const finish = (why) => {
      if (done) return
      done = true
      s.destroy()
      resolve({ data, why })
    }
    s.on('connect', () => setTimeout(() => {
      if (data.length || done) return
      sent = true
      s.write('HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n')
      setTimeout(() => finish('timeout'), 1200)
    }, 700))
    s.on('data', (c) => {
      data = Buffer.concat([data, c])
      if (!sent || data.length > 2048 || /\r\n\r\n/.test(data.toString('latin1'))) setTimeout(() => finish('data'), sent ? 0 : 150)
    })
    s.on('timeout', () => finish('timeout'))
    s.on('error', (e) => finish(e.code ?? 'error'))
    s.on('close', () => finish('closed'))
  })
}
function tlsName(host, port) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port, servername: 'www.sporta.com.kw', rejectUnauthorized: false, timeout: 2500, ALPNProtocols: ['h2', 'http/1.1'] }, () => {
      const c = s.getPeerCertificate()
      resolve(`TLS ${s.getProtocol()}${s.alpnProtocol ? ` ${s.alpnProtocol}` : ''}, cert ${c?.subject?.CN ?? '?'}`)
      s.destroy()
    })
    s.on('error', () => resolve(null))
    s.on('timeout', () => { s.destroy(); resolve(null) })
  })
}
async function identify(addr, port) {
  const host = addr === '0.0.0.0' ? '127.0.0.1' : addr === '::' ? '::1' : addr
  const r = await ask(host, port)
  const t = r.data.toString('latin1')
  if (/^SSH-/.test(t)) return { kind: 'ssh', text: t.split(/\r?\n/)[0].trim() }
  if (r.data.length > 5 && r.data[4] === 0x0a) {
    const ver = r.data.subarray(5, r.data.indexOf(0, 5)).toString('latin1')
    if (/^\d+\.\d+/.test(ver)) return { kind: 'mysql', text: `MySQL protocol, server ${ver}` }
  }
  const http = /^HTTP\/[\d.]+ (\d{3})/.exec(t)
  if (http) {
    const server = /\r\nserver:\s*([^\r\n]+)/i.exec(t)?.[1]
    return { kind: 'http', text: `HTTP ${http[1]}${server ? `, Server: ${server}` : ''}` }
  }
  if (r.data[0] === 0x15 && r.data[1] === 0x03) {
    const name = await tlsName(host, port)
    return { kind: 'tls', text: name ?? 'TLS (handshake refused)' }
  }
  if (r.why === 'ECONNREFUSED') return { kind: 'gone', text: 'refused (closed since the table was read)' }
  if (!r.data.length) {
    const name = await tlsName(host, port)
    if (name) return { kind: 'tls', text: name }
    return { kind: 'silent', text: 'accepts, says nothing' }
  }
  return { kind: 'other', text: `${r.data.length} B: ${JSON.stringify(t.slice(0, 40))}` }
}

// ================================================================== run
head('1. Edge firewall (Hostinger, attached to the VM)')
for (const r of EDGE) {
  const port = r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`
  if (r.source === 'any') {
    ;[80, 443].includes(r.from) && r.from === r.to ? ok(`${r.proto} ${port} from anywhere (${KNOWN[r.from]})`)
      : b(`${r.proto} ${port} is open to the whole internet${KNOWN[r.from] ? ` (${KNOWN[r.from]})` : ''}`)
  } else ok(`${r.proto} ${port} from ${r.source} only${KNOWN[r.from] ? ` (${KNOWN[r.from]})` : ''}`)
}
ok('everything else is dropped (the group drops what it does not accept)')

head('2. TCP listeners on the host')
if (!tcp.length) b(`no TCP listeners read from ${PROC} — is this the host's network namespace?`)
const byPort = new Map()
for (const s of tcp) {
  const k = s.port
  if (!byPort.has(k)) byPort.set(k, [])
  if (!byPort.get(k).some((x) => x.addr === s.addr)) byPort.get(k).push(s)
}
const listening = new Set()
for (const port of [...byPort.keys()].sort((a, c) => a - c)) {
  const socks = byPort.get(port)
  const binds = socks.map((s) => (s.family === 6 ? `[${s.addr}]` : s.addr)).join(' ')
  const scopes = new Set(socks.map((s) => scope(s.addr)))
  const isExposed = [...scopes].some(exposed)
  const id = await identify(socks[0].addr, port)
  const label = `tcp ${String(port).padEnd(5)} ${binds} · ${id.text}`
  if (isExposed) listening.add(port)
  if (!isExposed) {
    ok(`${label} · ${[...scopes].join('/')} only`)
    continue
  }
  const rules = edgeFor('tcp', port)
  const v6any = socks.some((s) => s.family === 6 && scope(s.addr) !== 'loopback')
  if (NEVER_PUBLIC.has(port)) {
    rules.length ? b(`${label} · ${KNOWN[port]} on every interface AND the firewall lets it in`)
      : w(`${label} · ${KNOWN[port]} on every interface — only the edge firewall keeps it private; bind it to 127.0.0.1`)
  } else if (!rules.length) {
    w(`${label} · every interface, dropped at the edge${v6any ? ' (also bound on IPv6)' : ''} — reachable the day that firewall changes`)
  } else {
    ok(`${label} · reachable from ${rules.map((r) => r.source).join(', ')}`)
  }
}
for (const r of EDGE.filter((x) => x.proto === 'tcp')) {
  for (let p = r.from; p <= Math.min(r.to, r.from + 50); p++) {
    if (!listening.has(p)) w(`the firewall opens tcp ${p} but nothing listens there on a public address`)
  }
}
if (byPort.has(2375) || byPort.has(2376)) {
  const s = byPort.get(2375) ?? byPort.get(2376)
  ;[...new Set(s.map((x) => scope(x.addr)))].some(exposed) ? b('the Docker API listens on the network — that is root on the host for whoever reaches it')
    : w('the Docker API listens on loopback — any local process can drive Docker')
} else ok('no Docker API on TCP (2375/2376)')

head('3. UDP')
const udpExposed = udp.filter((s) => exposed(scope(s.addr)))
const udpPorts = [...new Set(udp.map((s) => s.port))].sort((a, c) => a - c)
ok(`${udpPorts.length} UDP port(s) bound: ${udpPorts.slice(0, 20).join(', ') || 'none'}`)
for (const port of [...new Set(udpExposed.map((s) => s.port))].sort((a, c) => a - c)) {
  const rules = edgeFor('udp', port)
  const what = port === 443 ? 'HTTP/3 (QUIC)' : KNOWN[port] ?? (port === 68 ? 'DHCP client' : port === 123 ? 'NTP' : port === 323 ? 'chrony' : '')
  rules.length ? ok(`udp ${port} ${what} · open at the edge to ${rules.map((r) => r.source).join(', ')}`)
    : port === 443 ? w('udp 443 (HTTP/3) is bound but the edge drops UDP — browsers try QUIC, time out, fall back to TCP; open udp/443 or stop advertising h3')
      : ok(`udp ${port}${what ? ` ${what}` : ''} · every interface, dropped at the edge`)
}

head('4. sshd (the one non-web port the edge opens)')
{
  const main = path.join(SSHD, 'sshd_config')
  // On the VPS this is not mounted: the Hostinger API refuses a job that
  // mounts the sshd config (403). The banner in section 2 is what there is.
  if (!fs.existsSync(main)) w('sshd settings not read (the Hostinger API refuses a job that mounts them) — check PasswordAuthentication by hand')
  else {
    // sshd keeps the FIRST value it reads for a keyword, and Ubuntu's file
    // includes sshd_config.d/*.conf on its first line — so a drop-in from
    // cloud-init outranks anything written further down the main file.
    const seen = {}, files = []
    const read = (file) => {
      files.push(path.relative(SSHD, file) || file)
      for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.replace(/#.*/, '').trim()
        if (!line) continue
        const [k, ...rest] = line.split(/\s+/)
        const key = k.toLowerCase(), val = rest.join(' ')
        if (key === 'match') return false   // the rest of a file is conditional
        if (key === 'include') {
          for (const pat of rest) {
            const local = pat.replace(/^\/etc\/ssh\/?/, `${SSHD}/`)
            const dir = path.dirname(local), glob = new RegExp(`^${path.basename(local).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`)
            if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((n) => glob.test(n)).sort()) read(path.join(dir, f))
          }
          continue
        }
        if (!(key in seen)) seen[key] = val.toLowerCase()
      }
      return true
    }
    read(main)
    ok(`read ${files.join(', ')}`)
    // OpenSSH 9.x defaults for what is not set.
    const v = (k, d) => seen[k] ?? d
    const pw = v('passwordauthentication', 'yes')
    const root = v('permitrootlogin', 'prohibit-password')
    const kbd = v('kbdinteractiveauthentication', v('challengeresponseauthentication', 'yes'))
    const port = v('port', '22')
    port === '22' ? ok('sshd on port 22') : w(`sshd on port ${port} — the edge opens 22`)
    pw === 'no' ? ok('PasswordAuthentication no — keys only')
      : w(`PasswordAuthentication ${pw}${'passwordauthentication' in seen ? '' : ' (the default)'} — passwords are accepted; only the one-IP firewall rule stops guessing`)
    kbd === 'no' ? ok('KbdInteractiveAuthentication no') : w(`KbdInteractiveAuthentication ${kbd} — a second password prompt path`)
    root === 'yes' ? w('PermitRootLogin yes — root can log in with a password')
      : ok(`PermitRootLogin ${root}`)
    const tries = v('maxauthtries', '6')
    Number(tries) <= 6 ? ok(`MaxAuthTries ${tries}`) : w(`MaxAuthTries ${tries}`)
  }
}

console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
