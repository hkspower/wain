#!/usr/bin/env node
// Sporta — Hostinger API client.
//
//   npm run hostinger -- domains              list the domains on the account
//   npm run hostinger -- dns sporta.com.kw    print the live DNS zone
//   npm run hostinger -- email-auth sporta.com.kw   check SPF / DKIM / DMARC
//   npm run hostinger -- raw GET /api/domains/v1/portfolio
//
// WHAT THIS CAN AND CANNOT DO — read this before expecting a deploy.
//
// The Hostinger API manages VPS instances, domains, DNS zones and billing.
// It has NO file endpoint for shared hosting: there is no way to write into
// public_html through it. So it cannot publish the site, cannot fix a partial
// upload, and does not replace `npm run publish` (FTPS), which remains the only
// bridge. Reaching for this API to deploy is a dead end, and knowing that up
// front is cheaper than discovering it at 2am.
//
// What it IS good for here: DNS. The SPF/DKIM/DMARC records in
// DNS-EMAIL-RECORDS.txt are an outstanding launch blocker, and every order
// email silently lands in spam until they exist. `email-auth` reports what is
// actually published versus what is needed.
//
// THE TOKEN
// Read from HOSTINGER_API_TOKEN in the environment, or from .env.deploy
// (git-ignored). It is NEVER written to disk by this script, never echoed, and
// is redacted from any error output — an API token that manages your DNS and
// domains is worth more than the FTP password beside it. If one is ever pasted
// into a chat, a terminal that logs, or a commit, revoke it in
// hPanel -> Account -> API and issue a new one. Rotation is cheap; a hijacked
// DNS zone is not.
//
// SAFETY
// Everything here is READ-ONLY unless you pass --confirm. DNS is the one system
// where a careless write takes down mail and the website at once, and it does
// so silently — the zone still resolves, just to the wrong place.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BASE = process.env.HOSTINGER_API_BASE || 'https://developers.hostinger.com'

// ----------------------------------------------------------------- the token
// .env.deploy already exists for FTPS and is git-ignored, so it is the natural
// home for this too rather than inventing a second secrets file to leak.
function readToken() {
  if (process.env.HOSTINGER_API_TOKEN) return process.env.HOSTINGER_API_TOKEN.trim()
  const envFile = path.join(ROOT, '.env.deploy')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*HOSTINGER_API_TOKEN\s*=\s*(.*)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '').trim()
    }
  }
  return ''
}

// A token must never reach a log, a screenshot or a paste. Any string that
// looks like it is scrubbed before anything is printed.
const redact = (s, token) => {
  let out = String(s)
  if (token) out = out.split(token).join('<REDACTED-TOKEN>')
  return out.replace(/\b[A-Za-z0-9]{40,}\b/g, '<REDACTED>')
}

const TOKEN = readToken()

function requireToken() {
  if (TOKEN) return
  console.error(`
No Hostinger API token found.

  1. hPanel -> Account -> API -> create a token
  2. Put it in ${path.join(ROOT, '.env.deploy')} (git-ignored) as one line:

       HOSTINGER_API_TOKEN=your-token-here

     or export HOSTINGER_API_TOKEN=... in your shell.

Never paste the token into a chat, an issue or a commit. If you already have,
revoke it in hPanel and issue a new one before using it here.
`)
  process.exit(1)
}

// ------------------------------------------------------------------ requests
async function api(method, endpoint, body) {
  requireToken()
  const url = endpoint.startsWith('http') ? endpoint : BASE + endpoint
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    // A network failure and an auth failure look nothing alike, and saying so
    // saves the guessing that a bare "fetch failed" causes.
    console.error(`\nCould not reach ${BASE} — ${redact(err.message, TOKEN)}`)
    console.error('If this is a sandbox or a locked-down network, the API is simply not reachable from here.')
    process.exit(2)
  }
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* some errors are not JSON */ }

  if (!res.ok) {
    console.error(`\nHTTP ${res.status} ${res.statusText}  ${method} ${endpoint}`)
    if (res.status === 401) console.error('  -> the token is wrong, expired, or revoked. Issue a new one in hPanel -> Account -> API.')
    if (res.status === 403) console.error('  -> the token is valid but lacks scope for this endpoint, or the plan does not include it.')
    if (res.status === 404) console.error('  -> no such endpoint or resource. Endpoint paths differ between API versions; check developers.hostinger.com.')
    if (res.status === 429) console.error('  -> rate limited. Wait before retrying.')
    console.error(redact(text, TOKEN).slice(0, 600))
    process.exit(1)
  }
  return json ?? text
}

// -------------------------------------------------------------------- output
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

// ------------------------------------------------------------- email-auth
// The check that earns this script its place. Mail from orders@sporta.com.kw
// goes to spam without these, and the failure is silent: the shop believes the
// message was sent, the warehouse never sees it, and nothing logs an error.
const EMAIL_CHECKS = [
  { label: 'SPF',   name: '@',      match: (v) => /^v=spf1/i.test(v),
    why: 'says which servers may send mail as @your-domain. Without it, receivers cannot tell your mail from a forgery.' },
  { label: 'DMARC', name: '_dmarc', match: (v) => /^v=DMARC1/i.test(v),
    why: 'tells receivers what to do when SPF/DKIM fail. Without it, they decide for themselves — usually the spam folder.' },
  { label: 'DKIM',  name: null,     match: (v) => /^v=DKIM1/i.test(v),
    why: 'cryptographically signs outgoing mail. The key comes FROM your mail provider (hPanel -> Emails -> DKIM); it cannot be invented.' },
]

// The zone response shape varies by API version, so normalise defensively
// rather than assume one and print "undefined" for a zone that was fine.
function normaliseRecords(zone) {
  const rows = Array.isArray(zone) ? zone
    : Array.isArray(zone?.data) ? zone.data
    : Array.isArray(zone?.records) ? zone.records
    : []
  return rows.map((r) => ({
    name: r.name ?? r.host ?? r.subdomain ?? '',
    type: (r.type ?? r.record_type ?? '').toUpperCase(),
    values: []
      .concat(r.records ?? r.value ?? r.content ?? r.rrdata ?? [])
      .map((x) => (typeof x === 'string' ? x : x?.content ?? x?.value ?? JSON.stringify(x))),
  }))
}

async function emailAuth(domain) {
  const zone = await api('GET', `/api/dns/v1/zones/${encodeURIComponent(domain)}`)
  const records = normaliseRecords(zone)
  const txt = records.filter((r) => r.type === 'TXT')

  if (records.length === 0) {
    console.log('\nThe zone came back with no records this script could read.')
    console.log('Raw response follows so the shape can be checked against the docs:\n')
    out(zone)
    return
  }

  console.log(`\nEMAIL AUTHENTICATION — ${domain}\n${'='.repeat(60)}`)
  let missing = 0
  for (const check of EMAIL_CHECKS) {
    const hits = txt.filter((r) => {
      const nameOk = check.name === null ? true
        : check.name === '@' ? (r.name === '@' || r.name === '' || r.name === domain || r.name === `${domain}.`)
        : r.name.startsWith(check.name)
      return nameOk && r.values.some(check.match)
    })
    if (hits.length === 0) {
      missing++
      console.log(`\n  \x1b[31m✗ ${check.label} — NOT PUBLISHED\x1b[0m`)
      console.log(`    ${check.why}`)
    } else {
      console.log(`\n  \x1b[32m✓ ${check.label}\x1b[0m`)
      for (const h of hits) for (const v of h.values.filter(check.match)) console.log(`    ${h.name}  ${v}`)
      // More than one SPF record is worse than none: RFC 7208 makes the whole
      // check permerror, so mail that WOULD have passed now fails.
      if (check.label === 'SPF' && hits.reduce((n, h) => n + h.values.filter(check.match).length, 0) > 1) {
        console.log('    \x1b[31m! TWO SPF RECORDS — this is a permerror; merge them into ONE line.\x1b[0m')
      }
    }
  }
  console.log(`\n${'='.repeat(60)}`)
  console.log(missing === 0
    ? 'All three published. Order mail is authenticated.'
    : `${missing} of 3 missing — order mail can silently land in spam. See DNS-EMAIL-RECORDS.txt.`)
}

// ---------------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2)
const CONFIRM = rest.includes('--confirm')
const args = rest.filter((a) => a !== '--confirm')

switch (cmd) {
  case 'domains':
    out(await api('GET', '/api/domains/v1/portfolio'))
    break

  case 'dns': {
    if (!args[0]) { console.error('usage: dns <domain>'); process.exit(1) }
    out(await api('GET', `/api/dns/v1/zones/${encodeURIComponent(args[0])}`))
    break
  }

  case 'email-auth':
    await emailAuth(args[0] || 'sporta.com.kw')
    break

  case 'vps':
    out(await api('GET', '/api/vps/v1/virtual-machines'))
    break

  case 'raw': {
    // The escape hatch. Endpoint paths move between API versions and this
    // script cannot be verified against the live API from every machine, so
    // being able to hit an arbitrary path beats editing the file.
    const [method = 'GET', endpoint] = args
    if (!endpoint) { console.error('usage: raw <METHOD> <ENDPOINT> [json-body]'); process.exit(1) }
    const bodyArg = args[2]
    if (method.toUpperCase() !== 'GET' && !CONFIRM) {
      console.error(`\nRefusing a ${method.toUpperCase()} without --confirm.`)
      console.error('A wrong DNS write takes down mail and the website at once, and does it quietly.')
      process.exit(1)
    }
    out(await api(method.toUpperCase(), endpoint, bodyArg ? JSON.parse(bodyArg) : undefined))
    break
  }

  default:
    console.log(`
Sporta — Hostinger API client

  npm run hostinger -- domains                     domains on the account
  npm run hostinger -- dns sporta.com.kw           the live DNS zone
  npm run hostinger -- email-auth sporta.com.kw    SPF / DKIM / DMARC check
  npm run hostinger -- vps                         VPS instances (if any)
  npm run hostinger -- raw GET /api/...            any endpoint

Token: HOSTINGER_API_TOKEN in the environment or in .env.deploy (git-ignored).

This API does NOT deploy the site. It manages VPS, domains and DNS; there is no
file endpoint for shared hosting. Publishing stays \`npm run publish\` (FTPS).

Writes require --confirm.
`)
}
