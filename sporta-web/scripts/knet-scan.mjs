#!/usr/bin/env node
// KNET SCAN — the card-payment path of www.sporta.com.kw, checked from the VPS.
//
//   node scripts/vps-deploy.mjs compose --scan knet
//
// Five questions, each one a way card payments have died or could die:
//   1. the files — knet/ holds what a payment needs and nothing that exposes
//      its config (selftest.php, setup-config.php, a web-root config.php),
//      and every PHP file parses;
//   2. the doors — pay.php refuses bad input, and the library, the config and
//      the tools answer 403/404 to the internet;
//   3. the config — the live knet.php loads the private config the way
//      pay.php does and runs pay.php's own validator over it
//      (scripts/knet-config-check.php; it prints verdicts, never values);
//   4. the bank — the gateway host resolves, accepts TLS from this server and
//      shows a valid certificate (a handshake only: nothing is sent to it);
//   5. the payment log — where K-064 says every request and response is
//      kept: it exists outside the web root, is private, and what it says
//      about the last seven days (counts only).
//
// READ-ONLY, and stricter than the other scans: every request to callback.php
// and every pay.php request that passes input validation writes a line to the
// payment log, so neither is made. pay.php is only asked things it refuses
// before reading the log or the database. The callback is checked on disk.
//
// Test hooks: SPORTA_SCAN_BASE / SPORTA_SCAN_ROOT as for the other scans,
// SPORTA_KNET_PRIVATE (where the private configs are), SPORTA_KNET_LOG (the
// payment log's path on this machine).
import { spawnSync } from 'node:child_process'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

const HOST = 'www.sporta.com.kw'
const BASE = process.env.SPORTA_SCAN_BASE ?? ''
const ROOT = process.env.SPORTA_SCAN_ROOT ?? '/sporta/site'
const PRIVATE = process.env.SPORTA_KNET_PRIVATE ?? '/sporta/private'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const KNET = path.join(ROOT, 'knet')

let bad = 0, warn = 0
const ok = (s) => console.log(`ok   ${s}`)
const w = (s) => { warn++; console.log(`WARN ${s}`) }
const b = (s) => { bad++; console.log(`BAD  ${s}`) }
const head = (s) => console.log(`\n== ${s}`)

function request(p, { method = 'GET', body = null, plain = false } = {}) {
  return new Promise((resolve) => {
    const base = BASE ? new URL(BASE) : null
    const lib = base || plain ? http : https
    const headers = { Host: HOST, 'User-Agent': 'sporta-knet-scan', 'Accept-Encoding': 'identity' }
    // php -S in the tests is plain HTTP; knet_require_https() honours the
    // proxy header, as it does behind Traefik on the VPS.
    if (base) headers['X-Forwarded-Proto'] = 'https'
    if (body !== null) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(body) }
    const req = lib.request({
      host: base ? base.hostname : '127.0.0.1', port: base ? Number(base.port) : plain ? 80 : 443,
      path: p, method, headers, timeout: 15000,
      ...(base || plain ? {} : { servername: HOST, checkServerIdentity: (_h, c) => tls.checkServerIdentity(HOST, c) }),
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: e.message }))
    if (body !== null) req.write(body)
    req.end()
  })
}

const php = (() => {
  for (const bin of ['php', 'php84', 'php83']) {
    if (spawnSync(bin, ['-v'], { stdio: 'ignore' }).status === 0) return bin
  }
  return null
})()

// ==================================================================== 1
head('1. knet/ on disk')
if (!fs.existsSync(KNET)) {
  b(`${KNET} does not exist — there is no card path`)
  console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
  process.exit(1)
}
for (const f of ['pay.php', 'callback.php', 'knet.php', '.htaccess']) {
  fs.existsSync(path.join(KNET, f)) ? ok(`${f} present (${fs.statSync(path.join(KNET, f)).size} B)`) : b(`${f} MISSING`)
}
if (!fs.existsSync(path.join(ROOT, 'api', 'config-path.php'))) b('api/config-path.php missing — knet.php cannot find the private config')
for (const f of ['selftest.php', 'setup-config.php', 'config.php', 'config.example.php', 'README.md']) {
  if (fs.existsSync(path.join(KNET, f))) (f === 'config.example.php' || f === 'README.md' ? w : b)(`knet/${f} is on the server`)
}
if (php) {
  const broken = fs.readdirSync(KNET).filter((f) => f.endsWith('.php'))
    .filter((f) => spawnSync(php, ['-l', path.join(KNET, f)], { encoding: 'utf8' }).status !== 0)
  broken.length ? b(`PHP syntax errors: ${broken.join(', ')}`) : ok('every knet/*.php parses')
} else w('no PHP CLI here — syntax not checked')
const loose = fs.readdirSync(KNET, { withFileTypes: true }).filter((e) => e.isFile())
  .filter((e) => (fs.statSync(path.join(KNET, e.name)).mode & 0o002) !== 0)
loose.length ? b(`world-writable: ${loose.map((e) => e.name).join(', ')}`) : ok('nothing world-writable')

// ==================================================================== 2
head('2. What the internet can ask')
if (BASE) w('deny-rule and header checks skipped under SPORTA_SCAN_BASE (php -S reads no .htaccess)')
{
  const r = await request('/knet/pay.php')
  r.status === 400 ? ok('/knet/pay.php with no track id -> 400 (refused before the log or the database)')
    : r.status === 503 ? b('/knet/pay.php -> 503 — the config is missing or unreadable to the web server')
      : b(`/knet/pay.php with no track id -> ${r.status}`)
  if (!BASE) {
    const cc = String(r.headers['cache-control'] ?? '')
    ;/no-store/.test(cc) ? ok(`pay.php Cache-Control: ${cc}`) : b(`pay.php Cache-Control "${cc}" — a payment handoff must never be cached`)
    r.headers['x-content-type-options'] === 'nosniff' ? ok('pay.php nosniff') : b('pay.php without nosniff')
    ;/max-age=\d+/.test(String(r.headers['strict-transport-security'] ?? '')) ? ok('pay.php HSTS') : b('pay.php without HSTS')
    ;/noindex/.test(String(r.headers['x-robots-tag'] ?? '')) ? ok('pay.php X-Robots-Tag noindex') : w('pay.php has no X-Robots-Tag noindex')
  }
  if (/<br \/>|Fatal error|Warning:|Stack trace|\/var\/www|\/run\//.test(r.text)) b('pay.php leaks a PHP error or a server path')
}
for (const [label, opts] of [
  ['track id with symbols', { p: '/knet/pay.php?trackid=bad%21%27%3C' }],
  ['track id too long', { p: `/knet/pay.php?trackid=${'A'.repeat(31)}` }],
  ['injection in a POST body', { p: '/knet/pay.php', method: 'POST', body: 'trackid=1%26amt%3D0.001' }],
]) {
  const r = await request(opts.p, opts)
  r.status === 400 ? ok(`pay.php, ${label} -> 400`) : b(`pay.php, ${label} -> ${r.status} (want 400)`)
}
// No probe with a WELL-FORMED track id: that one reaches the order lookup and
// writes pay.reject to the payment log. That a browser-sent ?amount= is
// ignored is proven against a real database by scripts/knet-test.mjs.
if (!BASE) {
  for (const p of ['/knet/knet.php', '/knet/config.php', '/knet/config.example.php', '/knet/selftest.php',
    '/knet/setup-config.php', '/knet/.htaccess', '/knet/README.md', '/knet/', '/knet-payments.log', '/knet/knet-payments.log']) {
    const r = await request(p)
    ;[403, 404].includes(r.status) ? ok(`${p} -> ${r.status}`) : b(`${p} -> ${r.status} — must not be served`)
  }
  const plain = await request('/knet/pay.php', { plain: true })
  plain.status === 301 && /^https:\/\/www\.sporta\.com\.kw\/knet\/pay\.php/.test(String(plain.headers.location ?? ''))
    ? ok('http:// /knet/pay.php -> 301 https://www.sporta.com.kw/knet/pay.php')
    : b(`http:// /knet/pay.php -> ${plain.status} ${plain.headers.location ?? ''}`)
}
ok('callback.php not requested: every request to it is written to the payment log (checked on disk instead)')

// ==================================================================== 3
head('3. The config, through the live knet.php')
let gateway = '', logFile = ''
{
  // The private layout: knet-config.php somewhere under private/, and the
  // store's config (the db_* the gateway may borrow) beside it.
  const found = (name, dir = PRIVATE, depth = 3) => {
    if (depth < 0 || !fs.existsSync(dir)) return null
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isFile() && e.name === name) return p
      if (e.isDirectory() && e.name !== 'media') { const r = found(name, p, depth - 1); if (r) return r }
    }
    return null
  }
  const knetCfg = found('knet-config.php')
  const apiCfg = ['api-config.php', 'sporta-api-config.php', 'config.php'].map((n) => found(n)).find(Boolean) ?? null
  if (!knetCfg) b(`knet-config.php not found under ${PRIVATE}`)
  else if (!php) w('no PHP CLI here — config not checked')
  else {
    // AES needs openssl; the job's php84 package does not include it.
    if (spawnSync(php, ['-r', "exit(extension_loaded('openssl')?0:1);"]).status !== 0) {
      for (const pkg of ['php84-openssl', 'php83-openssl']) {
        if (spawnSync('apk', ['add', '--no-cache', pkg], { stdio: 'ignore' }).status === 0) break
      }
    }
    const mode = fs.statSync(knetCfg).mode & 0o777
    ;(mode & 0o007) === 0 ? ok(`knet-config.php is not world-readable (${mode.toString(8)})`)
      : w(`knet-config.php is world-readable (${mode.toString(8)}) — it holds the Tranportal password`)
    const res = spawnSync(php, [path.join(HERE, 'knet-config-check.php')], {
      encoding: 'utf8',
      env: { ...process.env, KNET_LIB: path.join(KNET, 'knet.php'),
        SPORTA_PRIVATE_CONFIG_DIR: path.dirname(knetCfg), ...(apiCfg ? { SPORTA_API_CONFIG_FILE: apiCfg } : {}) },
    })
    for (const line of `${res.stdout}`.split('\n').filter(Boolean)) {
      if (line.startsWith('GATEWAY ')) gateway = line.slice(8).trim()
      else if (line.startsWith('LOGFILE ')) logFile = line.slice(8).trim()
      else if (line.startsWith('BAD')) b(line.slice(5))
      else if (line.startsWith('WARN')) w(line.slice(5))
      else if (line.startsWith('ok')) ok(line.slice(5))
    }
    if (res.status !== 0) b(`the config check itself failed (exit ${res.status}) — ${String(res.stderr).split('\n').find((l) => /error/i.test(l))?.slice(0, 160) ?? ''}`)
  }
}

// ==================================================================== 4
head('4. The bank')
if (!gateway) w('no gateway URL from the config — nothing to test')
else {
  const u = new URL(gateway)
  if (u.protocol !== 'https:' || ['127.0.0.1', 'localhost'].includes(u.hostname)) {
    w(`gateway ${u.host} is a local test bank — TLS not checked`)
  } else {
    try {
      const addrs = await dns.lookup(u.hostname, { all: true })
      ok(`${u.hostname} resolves (${addrs.map((a) => a.address).join(', ')})`)
      const info = await new Promise((resolve) => {
        const s = tls.connect({ host: u.hostname, port: 443, servername: u.hostname, timeout: 10000 }, () => {
          const c = s.getPeerCertificate()
          resolve({ authorized: s.authorized, error: s.authorizationError, proto: s.getProtocol(), cn: c?.subject?.CN, issuer: c?.issuer?.O ?? c?.issuer?.CN, until: c?.valid_to })
          s.end()
        })
        s.on('error', (e) => resolve({ fail: e.message }))
        s.on('timeout', () => { s.destroy(); resolve({ fail: 'timeout' }) })
      })
      if (info.fail) b(`TLS to ${u.hostname}:443 failed: ${info.fail} — the customer's browser goes there, so check from a phone too`)
      else {
        info.authorized ? ok(`TLS to ${u.hostname}: ${info.proto}, certificate valid (${info.cn}, ${info.issuer})`)
          : b(`TLS to ${u.hostname}: certificate NOT trusted (${info.error})`)
        const days = Math.floor((new Date(info.until) - Date.now()) / 86400000)
        days > 21 ? ok(`bank certificate expires ${info.until} — ${days} days`) : w(`bank certificate expires in ${days} days (${info.until}) — the bank's to renew`)
      }
    } catch (e) {
      b(`${u.hostname} does not resolve from this server: ${e.code ?? e.message}`)
    }
  }
}

// ==================================================================== 5
head('5. The payment log')
{
  const name = path.basename(logFile || 'knet-payments.log')
  let file = process.env.SPORTA_KNET_LOG ?? null
  if (!file) {
    const roots = ['/sporta']
    const seek = (dir, depth) => {
      if (depth < 0 || !fs.existsSync(dir)) return null
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isFile() && e.name === name) return p
        if (e.isDirectory() && !['site', 'backups', 'media', 'node_modules'].includes(e.name)) { const r = seek(p, depth - 1); if (r) return r }
      }
      return null
    }
    for (const r of roots) { file = seek(r, 4); if (file) break }
  }
  if (!file || !fs.existsSync(file)) {
    w(`${name} not found outside the web root — either nothing has been logged yet or the log lives in the web container only (${logFile || 'no log_file'})`)
  } else {
    const st = fs.statSync(file)
    if (file.startsWith(ROOT + '/')) b(`${name} is inside the web root`)
    else ok(`${name} found outside the web root (${Math.round(st.size / 1024)} kB, last written ${Math.round((Date.now() - st.mtimeMs) / 3600000)} h ago)`)
    const mode = st.mode & 0o777
    ;(mode & 0o077) === 0 ? ok(`log mode ${mode.toString(8)} — owner only`) : w(`log mode ${mode.toString(8)} — readable by others (it holds track ids, amounts and IPs)`)
    // Counts only. The log holds transaction metadata; none of it is printed.
    const since = Date.now() - 7 * 86400000
    const counts = {}, reasons = {}
    let lines = 0, unparsable = 0, last = {}
    const text = st.size > 64 * 1024 * 1024 ? '' : fs.readFileSync(file, 'utf8')
    if (!text) w('log larger than 64 MB — not read; rotate it')
    for (const line of text.split('\n')) {
      if (!line) continue
      let j
      try { j = JSON.parse(line) } catch { unparsable++; continue }
      const t = Date.parse(j.ts ?? '')
      if (j.event) last[j.event] = Math.max(last[j.event] ?? 0, t || 0)
      if (!(t >= since)) continue
      lines++
      counts[j.event] = (counts[j.event] ?? 0) + 1
      if (j.event === 'pay.reject' && j.reason) reasons[j.reason] = (reasons[j.reason] ?? 0) + 1
    }
    ok(`last 7 days: ${lines} entries${Object.keys(counts).length ? ' — ' + Object.entries(counts).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') : ''}`)
    if (Object.keys(reasons).length) ok(`  refusals: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    if (unparsable) w(`${unparsable} log lines are not JSON`)
    const ago = (e) => (last[e] ? `${Math.round((Date.now() - last[e]) / 86400000)} d ago` : 'never')
    ok(`last payment started ${ago('pay.init')} · last bank response ${ago('callback.received')}`)
    if ((counts['callback.decrypt_failed'] ?? 0) > 0) {
      w(`${counts['callback.decrypt_failed']} bank responses could not be decrypted this week — a key mismatch, or forged requests`)
    }
    if ((counts['pay.error'] ?? 0) > 0) b(`${counts['pay.error']} payments could not be prepared this week (pay.error) — config or key problem`)
    const init = counts['pay.init'] ?? 0, back = counts['callback.received'] ?? 0
    if (init >= 5 && back === 0) w(`${init} payments started this week and no bank response came back — is the callback URL registered with the bank?`)
  }
}

console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
