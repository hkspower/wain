// Find the hostname that actually accepts the upload, and prove it end to end.
//
//   node scripts/ftp-doctor.mjs                  # test every candidate
//   node scripts/ftp-doctor.mjs srv1814.hstgr.io # test one you were given
//   node scripts/ftp-doctor.mjs --write          # save the winner to .env.deploy
//
// This exists because guessing the host wasted a round trip already:
// .env.deploy.example shipped FTP_HOST=ftp.sporta.com.kw, which has no DNS
// record at all, and the failure it produces — ENOTFOUND — reads like the
// bridge is broken rather than like one line being wrong.
//
// Each candidate is taken through five stages, and the stage that fails tells
// you what to change:
//
//   DNS    the name does not exist            -> wrong hostname
//   TCP    resolves but nothing on port 21    -> wrong host, or FTP disabled
//   TLS    connects but will not start TLS    -> the server wants implicit FTPS
//   LOGIN  TLS fine, credentials refused      -> wrong user or password
//   DIR    logged in, remoteDir missing       -> wrong remoteDir
//
// The password is read from .env.deploy and never printed, not even masked —
// terminal output gets pasted into chat windows.
import { Client } from 'basic-ftp'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { lookup } from 'node:dns/promises'
import { Socket } from 'node:net'
import { config as loadEnv } from 'dotenv'

const web = resolve(new URL('..', import.meta.url).pathname)
const ENV_PATH = join(web, '.env.deploy')
loadEnv({ path: ENV_PATH })

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
const given = argv.filter((a) => !a.startsWith('--'))

const cfg = JSON.parse(readFileSync(join(web, 'deploy.config.json'), 'utf8'))
const REMOTE = (cfg.ftp?.remoteDir ?? '/public_html').replace(/\/$/, '')
const PORT = Number(process.env.FTP_PORT || cfg.ftp?.port || 21)
const USER = process.env.FTP_USER || cfg.ftp?.user || ''
const PASS = process.env.FTP_PASSWORD || ''

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`
const log = (s = '') => console.log(s)

// Candidates, most likely first. srv1814.hstgr.io is here because hPanel's File
// Manager runs on srv1814-files.hstgr.io — the same server, and the "-files"
// host is the web UI rather than the FTP endpoint.
const DOMAIN = 'sporta.com.kw'
const CANDIDATES = given.length ? given : [
  'srv1814.hstgr.io',
  `ftp.${DOMAIN}`,
  DOMAIN,
  `www.${DOMAIN}`,
  '46.202.158.211',
]

const tcpOpen = (host, port, ms = 6000) =>
  new Promise((res) => {
    const s = new Socket()
    const done = (ok) => { s.destroy(); res(ok) }
    s.setTimeout(ms)
    s.once('connect', () => done(true))
    s.once('timeout', () => done(false))
    s.once('error', () => done(false))
    s.connect(port, host)
  })

async function probe(host) {
  const r = { host, dns: '', tcp: '', tls: '', login: '', dir: '', note: '' }

  try {
    const { address } = await lookup(host)
    r.dns = address
  } catch {
    r.note = 'no DNS record — this hostname does not exist'
    return r
  }

  if (!(await tcpOpen(host, PORT))) {
    r.tcp = 'closed'
    r.note = `nothing answering on port ${PORT}`
    return r
  }
  r.tcp = 'open'

  const client = new Client(12_000)
  client.ftp.verbose = false
  try {
    // Without a password, stop after TLS: that still separates "wrong host"
    // from "wrong credentials", which is the question being asked.
    await client.access({
      host, port: PORT, user: USER || 'anonymous', password: PASS || 'anonymous@',
      secure: true,
      secureOptions: { servername: host, rejectUnauthorized: process.env.FTP_INSECURE !== '1' },
    })
    r.tls = 'ok'
    r.login = PASS ? 'ok' : 'not tested (no FTP_PASSWORD set)'

    if (PASS) {
      try {
        const list = await client.list(REMOTE)
        const names = list.map((i) => i.name)
        r.dir = `${names.length} entries`
        const looksRight = names.includes('index.html') || names.includes('config.js')
        r.note = looksRight
          ? `${REMOTE} looks like the site root`
          : `${REMOTE} exists but has no index.html or config.js — check remoteDir`
      } catch {
        r.dir = 'missing'
        r.note = `logged in, but ${REMOTE} does not exist — check remoteDir in deploy.config.json`
      }
    }
  } catch (e) {
    const m = String(e.message)
    if (/530|password|login|credential/i.test(m)) {
      r.tls = 'ok'
      r.login = 'refused'
      r.note = PASS ? 'wrong FTP_USER or FTP_PASSWORD' : 'reachable — set FTP_USER/FTP_PASSWORD to go further'
    } else if (/AUTH|TLS|SSL|certificate/i.test(m)) {
      r.tls = 'refused'
      r.note = `TLS failed: ${m.slice(0, 70)}`
    } else {
      r.note = m.slice(0, 80)
    }
  } finally {
    client.close()
  }
  return r
}

log(c(36, '▸ FTP connection doctor'))
log(`  port ${PORT}, user ${USER || c(33, '(FTP_USER not set)')}, ` +
    `password ${PASS ? 'set' : c(33, 'not set')}, remoteDir ${REMOTE}`)
log()

const results = []
for (const h of CANDIDATES) {
  process.stdout.write(`  testing ${h.padEnd(24)} `)
  const r = await probe(h)
  results.push(r)
  const verdict = r.login === 'ok' ? c(32, 'WORKS')
    : r.tls === 'ok' ? c(33, 'reachable')
    : r.tcp === 'open' ? c(33, 'port open')
    : r.dns ? c(31, 'no FTP')
    : c(31, 'no DNS')
  log(verdict)
}

log()
log(c(36, '▸ Detail'))
for (const r of results) {
  log(`  ${c(1, r.host)}`)
  log(`    DNS    ${r.dns || c(31, 'does not resolve')}`)
  if (r.dns) log(`    TCP    ${r.tcp}`)
  if (r.tcp === 'open') log(`    TLS    ${r.tls || 'failed'}`)
  if (r.tls === 'ok') log(`    LOGIN  ${r.login}`)
  if (r.dir) log(`    DIR    ${r.dir}`)
  if (r.note) log(`    ${c(90, r.note)}`)
}

const winner = results.find((r) => r.login === 'ok')
const reachable = results.filter((r) => r.tls === 'ok')

log()
if (winner) {
  log(c(32, `✔ Use FTP_HOST=${winner.host}`))
  if (WRITE) {
    // Rewrite only the FTP_HOST line; the password stays exactly where it is.
    const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
    const next = /^FTP_HOST=.*$/m.test(existing)
      ? existing.replace(/^FTP_HOST=.*$/m, `FTP_HOST=${winner.host}`)
      : `${existing.replace(/\n*$/, '\n')}FTP_HOST=${winner.host}\n`
    writeFileSync(ENV_PATH, next)
    log(c(32, `  written to .env.deploy`))
  } else {
    log(c(90, '  Re-run with --write to save it to .env.deploy.'))
  }
  log(c(90, '\n  Then: npm run publish:dry   and   npm run publish'))
} else if (reachable.length) {
  log(c(33, `Reachable over FTPS: ${reachable.map((r) => r.host).join(', ')}`))
  log(c(33, 'but the login was not confirmed. Set FTP_USER and FTP_PASSWORD in'))
  log(c(33, '.env.deploy from hPanel → Files → FTP Accounts, then run this again.'))
} else {
  log(c(31, 'None of these accepted an FTPS connection.'))
  const allClosed = results.every((r) => !r.dns || r.tcp === 'closed')
  if (allClosed && results.some((r) => r.dns)) {
    // Every candidate resolving but refusing on port 21 points at the network
    // this is being run from, not at the server. Corporate and some ISP
    // networks block outbound FTP, and so does the sandbox this was written in.
    log(c(33, '\nEvery host that resolved also refused port ' + PORT + '. That pattern usually'))
    log(c(33, 'means outbound FTP is blocked on the network you are running from —'))
    log(c(33, 'some office and ISP networks do this — rather than the server being wrong.'))
    log(c(33, 'Try a different network (a phone hotspot is the quickest test).'))
  }
  log(c(33, '\nOtherwise, open hPanel → Files → FTP Accounts, read the hostname it shows, then:'))
  log(c(33, '  node scripts/ftp-doctor.mjs THAT-HOSTNAME'))
  log(c(90, '\nIf hPanel shows a port other than 21, set FTP_PORT in .env.deploy too.'))
}

process.exit(winner ? 0 : 1)
