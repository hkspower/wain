#!/usr/bin/env node
// URL INVENTORY — every host the repository names, each one KNOWN for a
// written reason or the run fails. Rig-free: no server, no database, no
// network, no writes. It reads the working tree (tracked and untracked files)
// and prints hosts with counts, where they appear, and whether that place
// ships to browsers, runs on the server, or is a document or a test.
//
//   npm run test:url-inventory
//   node scripts/url-inventory-test.mjs --verbose          every occurrence of every UNKNOWN host
//   node scripts/url-inventory-test.mjs --host evil.example  every occurrence of one host
//   URL_INVENTORY_EXTRA=/path/file node scripts/url-inventory-test.mjs   (self-check: scan one more file)
//
// WHY. A new host in this repo is a new place the shop talks to, sends a
// shopper to, or loads code from — a script tag, a fetch, a redirect target,
// a form action, an image hotlink. None of those should arrive by accident,
// and a grep nobody runs is not a control. This test IS the control: a host
// that is not in ALLOW below, with a reason, fails the run.
//
// WHAT COUNTS AS A URL. https?://, ftp(s)://, sftp://, ssh://, ws(s)://,
// git://, file://, smtp(s)://; protocol-relative //host; www.host; a bare
// host with a real-looking TLD (restricted list, not followed by "(" so a
// JavaScript `re.test(` is not a host); and the pseudo-schemes javascript:,
// data:, mailto:, tel: (counted, no host). Hosts under the reserved TLDs
// .test .example .invalid .localhost .local are fixtures by definition
// (RFC 2606 / 6761) and are KNOWN as such.
//
// WHERE. Each occurrence is tagged by what the file is:
//   browser  sporta-web/index.html, sporta-web/public/, sporta-web/src/ — ships to shoppers
//   server   sporta-web/dropin/ — runs in PHP on the VPS
//   html5    sporta-html5/ — the no-build fallback, NOT the live site
//   app      sporta-app/ — the Flutter app, not shipped
//   tooling  sporta-web/scripts/, *.sh, *.py, vps/deploy helpers — the owner's machine or a VPS job
//   docs     *.md, *.txt, .env.deploy.example, deploy.config.json, vercel.json, .mcp.json, .gitignore
//   brand    brand/ — masters, never shipped
//   fixture  sporta-web/scripts/fixtures/, sporta-live/ — captured live markup and rules
// A host whose allow-list entry says it belongs in docs or tooling only, but
// which appears in a browser or server file, FAILS the run too: a crawler of
// a doc link is harmless, the same link rendered on the storefront is not.
//
// ALLOW-LIST WITH REASONS. An entry is { where: [...tags it may appear in],
// why }. Add a line when the owner decides something; never to go green.

import { readFileSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const WEB = resolve(new URL('..', import.meta.url).pathname)
const ROOT = resolve(WEB, '..')
const argv = process.argv.slice(2)
const VERBOSE = argv.includes('--verbose')
const ONLY_HOST = (() => { const i = argv.indexOf('--host'); return i >= 0 ? argv[i + 1]?.toLowerCase() : undefined })()

const ANY = ['browser', 'server', 'html5', 'app', 'tooling', 'docs', 'brand', 'fixture']
const NOT_RUNTIME = ['html5', 'app', 'tooling', 'docs', 'brand', 'fixture']
const ALLOW = {
  // --- the shop
  'www.sporta.com.kw': { where: ANY, why: 'the shop, canonical origin (CLAUDE.md "Going live")' },
  'sporta.com.kw': { where: ANY, why: 'the shop, bare spelling: only ever as a redirect SOURCE, a DNS name or a mail domain; url-audit.mjs refuses it in shipped canonical/sitemap/JSON-LD output' },
  'ftp.sporta.com.kw': { where: ['docs', 'tooling'], why: 'the FTP host name that has NO DNS record: named only to say so (CLAUDE.md "Never guess the FTP host")' },
  '187.7.78.123': { where: ['docs', 'tooling', 'fixture'], why: 'the Hostinger VPS that serves the site (CLAUDE.md item 4); the server-IP redirect source in apex/htaccess checks' },
  '46.202.158.211': { where: ['docs', 'tooling'], why: 'the OLD shared-hosting account; publish refuses while DNS does not point there' },
  'srv1814.hstgr.io': { where: ['docs', 'tooling'], why: 'the old shared account\'s FTPS host (ftp-doctor.mjs, deploy.config.json)' },
  'srv1814-files.hstgr.io': { where: ['tooling'], why: 'alternate spelling ftp-doctor.mjs tries for the old shared account' },
  'srv2058651.hstgr.cloud': { where: ['docs', 'tooling'], why: 'the VPS host name (VM 2058651); a non-www host the redirect checks send' },
  // --- test loopback
  'localhost': { where: ANY, why: 'local test servers and MariaDB; a connection-string value in config examples' },
  '127.0.0.1': { where: ANY, why: 'local test servers; trusted_proxy_ips example; the PHP built-in server' },
  '127.0.0.2': { where: ['tooling'], why: 'a second loopback address a test uses as "another client"' },
  // --- payments: ONE bank, two products (CLAUDE.md "Payments")
  'kpay.com.kw': { where: ANY, why: 'KNET production Tranportal (form-action in the CSP; knet config)' },
  'www.kpay.com.kw': { where: ['docs', 'tooling', 'server', 'fixture'], why: 'KNET bank host as the bank spells it in its manual and the allow-list of hosts' },
  'kpaytest.com.kw': { where: ANY, why: 'KNET test Tranportal' },
  'www.kpaytest.com.kw': { where: ['docs', 'tooling', 'server', 'fixture'], why: 'KNET test host in its www. spelling: knet.php / store.php accept exactly the bare and www. host per environment (KNET-IPAYPIPE-CHECK.md D3)' },
  'pg.cbk.com': { where: ANY, why: 'CBK hosted gateway, production (T-Pay / KNET-via-CBK)' },
  'pgtest.cbk.com': { where: ANY, why: 'CBK hosted gateway, test' },
  // --- the shop's channels
  'wa.me': { where: ANY, why: 'WhatsApp click-to-chat links in the footer and messages (WHATSAPP.md)' },
  'www.instagram.com': { where: ANY, why: 'the shop\'s Instagram, footer link (index.html, llms.txt)' },
  'instagram.com': { where: ANY, why: 'referrer host name in attribution.mysql.sql comments and tests' },
  'www.tiktok.com': { where: ANY, why: 'the shop\'s TikTok, footer link' },
  // the contact details the owner edits in /backends "Site content" (2026-11-10): the only hosts a saved social link may be on
  // (store_content_social in store.php rebuilds the link on them), and the link shapes the storefront script recognises
  'tiktok.com': { where: ANY, why: 'accepted spelling of the TikTok host for a saved profile link (site content contact details)' },
  'snapchat.com': { where: ANY, why: 'accepted spelling of the Snapchat host for a saved profile link (site content contact details)' },
  'www.snapchat.com': { where: ANY, why: 'the shop\'s Snapchat profile link, as the site content contact details store it' },
  'x.com': { where: ANY, why: 'the shop\'s X profile link, as the site content contact details store it' },
  'www.x.com': { where: ANY, why: 'accepted spelling of the X host for a saved profile link (site content contact details)' },
  'twitter.com': { where: ANY, why: 'old spelling of the X host, accepted for a saved profile link and recognised on the page' },
  'www.twitter.com': { where: ANY, why: 'old spelling of the X host, accepted for a saved profile link' },
  'api.whatsapp.com': { where: ANY, why: 'the other WhatsApp link shape (send?phone=) the storefront script repoints to the saved number' },
  'web.whatsapp.com': { where: ANY, why: 'WhatsApp Web link shape (send?phone=) the storefront script repoints to the saved number' },
  'graph.facebook.com': { where: ANY, why: 'WhatsApp Cloud API endpoint (cron-whatsapp.php, WHATSAPP.md)' },
  // --- Google
  'www.google.com': { where: ANY, why: 'Google Maps link the checkout "Share my location" control writes into the order note; Google Business / review links' },
  'google.com': { where: ANY, why: 'bare Google name in docs and the Google review invitation copy' },
  'maps.google.com': { where: ANY, why: 'older spelling of a Google Maps link' },
  'search.google.com': { where: ['docs'], why: 'Search Console link in GO-LIVE.md' },
  'accounts.google.com': { where: ANY, why: 'Google OAuth authorize endpoint for the optional admin Google sign-in (admin-google.php)' },
  'oauth2.googleapis.com': { where: ANY, why: 'Google OAuth token endpoint (admin-google.php)' },
  'www.googleapis.com': { where: ANY, why: 'Google OAuth certificate endpoint (admin-google.php)' },
  'rdp-client.apps.googleusercontent.com': { where: ['tooling'], why: 'an example OAuth client id in redirect-pages-test.mjs' },
  'admin.google.com': { where: ['docs'], why: 'Google Workspace admin link in DNS-EMAIL-RECORDS.txt' },
  'dns.google': { where: ['tooling'], why: 'DNS-over-HTTPS resolver used by dns-check.mjs and apex-check.mjs' },
  'dohdead.google': { where: ['tooling'], why: 'a deliberately dead DoH host name in dns-check.mjs error handling' },
  'fonts.googleapis.com': { where: ['html5', 'docs', 'tooling', 'browser'], why: 'Google Fonts in the sporta-html5 fallback ONLY; the live site self-hosts its fonts and names the host in a block comment in src/styles/fonts.css (not in the CSP, so it is never fetched)' },
  'fonts.gstatic.com': { where: ['html5', 'docs', 'tooling'], why: 'Google Fonts in the sporta-html5 fallback ONLY' },
  // --- fonts
  'use.typekit.net': { where: ANY, why: 'Adobe Fonts kit CSS and font files (font-src / style-src in public/.htaccess)' },
  'p.typekit.net': { where: ANY, why: 'the empty CSS import Adobe includes in each published kit (style-src)' },
  'typekit.net': { where: ['docs', 'tooling'], why: 'the Typekit name in scan reports' },
  // --- AI and voice (CLAUDE.md "ElevenLabs MCP", SPORTA-AI-VOICE.md)
  'api.anthropic.com': { where: ANY, why: 'the assistant\'s optional rewording model (config.example.php ai_base)' },
  'api.elevenlabs.io': { where: ANY, why: 'text-to-speech for Sporta AI (assistant.php, fake-voice.php stands in for it in tests)' },
  'elevenlabs.io': { where: ['docs', 'server', 'tooling'], why: 'the ElevenLabs name in docs and config comments' },
  // --- n8n (N8N-SECURITY.md)
  'sportake.app.n8n.cloud': { where: ['docs', 'tooling', 'brand'], why: 'the owner\'s n8n cloud instance (N8N-SECURITY.md); handoff webhook target is a config value, not a literal' },
  'app.n8n.cloud': { where: ['docs', 'brand'], why: 'the n8n cloud domain, named in PHOTO-BANNERS.md' },
  // --- code, packages, images
  'github.com': { where: ['docs', 'tooling'], why: 'this repository (hkspower/wain) and GitHub docs' },
  'raw.githubusercontent.com': { where: ['docs', 'tooling'], why: 'VPS jobs fetch probe scripts from the pushed branch (CLAUDE.md "Probing the live site")' },
  'codeload.github.com': { where: ['docs', 'tooling'], why: 'the deploy job downloads the commit tarball (vps-deploy.mjs)' },
  'api.github.com': { where: ['tooling'], why: 'sec-config-scan.mjs lists the tree of the pushed commit' },
  'docs.github.com': { where: ['docs'], why: 'the .gitignore template header' },
  'registry.npmjs.org': { where: ['docs', 'tooling'], why: 'the only package registry in package-lock.json (plugins-inventory checks it)' },
  'nodejs.org': { where: ['docs', 'tooling'], why: 'Node download link in the Mac setup script' },
  'mcr.microsoft.com': { where: ['docs', 'tooling', 'brand'], why: 'the Playwright image VPS probe jobs run in (CLAUDE.md)' },
  'developers.hostinger.com': { where: ['docs', 'tooling'], why: 'the Hostinger API base (hostinger-api.mjs)' },
  'claude.ai': { where: ['docs', 'tooling', 'fixture', 'browser'], why: 'artifact links in two add-on CSS header comments and the session link in CLAUDE.md; REPO-SCAN webcode-15 says strip the comments' },
  'claude.com': { where: ['docs', 'tooling'], why: 'Claude Code install link in the Mac setup script' },
  'react.dev': { where: ['tooling'], why: 'named in plugins-inventory.mjs as a documentation host, not loaded' },
  'reactrouter.com': { where: ['tooling'], why: 'named in plugins-inventory.mjs as a documentation host, not loaded' },
  'openapi.vercel.sh': { where: ['docs'], why: 'the $schema of vercel.json (deployments disabled); REPO-SCAN hygiene-16 asks the owner to confirm and uninstall' },
  // --- standards namespaces
  'schema.org': { where: ANY, why: 'JSON-LD vocabulary' },
  'www.w3.org': { where: ANY, why: 'SVG / XML namespaces' },
  'www.sitemaps.org': { where: ANY, why: 'sitemap XML namespace' },
  'hstspreload.org': { where: ['docs', 'tooling'], why: 'HSTS preload list, named by apex-check.mjs' },
  'letsencrypt.org': { where: ['tooling'], why: 'certificate issuer name in apex/dns checks' },
  'digicert.com': { where: ['tooling'], why: 'certificate issuer name in apex-check.mjs' },
  // --- DNS and mail (DNS-EMAIL-RECORDS.txt, dns-check.mjs, apex-check.mjs)
  'cloudflare-dns.com': { where: ['tooling'], why: 'second DoH resolver in dns-check.mjs' },
  'rdap.org': { where: ['tooling'], why: 'RDAP lookup in dns-check.mjs' },
  'whois.nic.kw': { where: ['tooling'], why: '.kw registry whois, named in dns-check.mjs' },
  'whois.kw': { where: ['tooling'], why: '.kw whois alias, named in dns-check.mjs' },
  'ns1.dns-parking.com': { where: ['tooling'], why: 'Hostinger name server (apex-check.mjs expects it)' },
  'ns2.dns-parking.com': { where: ['tooling'], why: 'Hostinger name server' },
  'smtp.hostinger.com': { where: ['docs', 'tooling'], why: 'Hostinger mail relay' },
  'mx1.hostinger.com': { where: ['docs', 'tooling'], why: 'Hostinger MX' },
  'mx2.hostinger.com': { where: ['docs', 'tooling'], why: 'Hostinger MX' },
  'spf2.hostinger.com': { where: ['docs', 'tooling'], why: 'Hostinger SPF include' },
  'hostingermail-a.dkim.mail.hostinger.com': { where: ['docs', 'tooling'], why: 'Hostinger DKIM CNAME target' },
  'hostingermail-b.dkim.mail.hostinger.com': { where: ['docs', 'tooling'], why: 'Hostinger DKIM CNAME target' },
  'zoho.com': { where: ['docs'], why: 'example of a third-party mail provider in DNS-EMAIL-RECORDS.txt' },
  'www.mail-tester.com': { where: ['docs'], why: 'deliverability check link in DNS-EMAIL-RECORDS.txt' },
  'www.bing.com': { where: ['docs'], why: 'Bing Webmaster link in GO-LIVE.md' },
  // --- other sites on the same servers (NOT this shop)
  'wainkw.com': { where: ['docs', 'tooling'], why: 'another site on the old shared account / VPS, named in scan reports and host-header probes only' },
  'almuhallab-code.com': { where: ['docs', 'tooling'], why: 'another site on the old shared account / VPS, named in scan reports only' },
  // --- fixtures that are not reserved-TLD
  '1.1.1.1': { where: ['docs', 'tooling'], why: 'Cloudflare public resolver (dns-check.mjs, cdn-edge-check.mjs)' },
  '8.8.8.8': { where: ['docs', 'tooling'], why: 'Google public resolver (dns-check.mjs, cdn-edge-check.mjs)' },
  '9.9.9.9': { where: ['docs', 'tooling'], why: 'Quad9 public resolver (dns-check.mjs)' },
  '1.2.3.4': { where: ['docs', 'tooling'], why: 'example address in usage text and comments (vps-deploy.mjs --edge, apex-check.mjs)' },
  '1.2.3.5': { where: ['tooling'], why: 'example address in apex-check.mjs' },
  '178.61.10.104': { where: ['docs', 'tooling'], why: 'the one address the VPS edge firewall allows SSH from (port-scan.mjs default --edge; LIVE-SECURITY-SCAN section 7). It is the owner\'s address and the repo is public: the owner may prefer it moved to an env value' },
  'evil.com': { where: ['server', 'tooling'], why: 'the example in store_internal_href()\'s comment and its test (//evil.com)' },
  'example.com': { where: ['docs', 'tooling'], why: 'RFC 2606 example domain' },
  'cdn.example.com': { where: ['tooling'], why: 'RFC 2606 example domain' },
  'staging.example.com': { where: ['tooling'], why: 'RFC 2606 example domain' },
}
// Reserved TLDs: any host under these is a fixture by definition.
const RESERVED = /\.(test|example|invalid|localhost|local)$/i
// IP ranges that are fixtures by definition: RFC 5737 documentation blocks,
// RFC 1918 private space, RFC 2544 benchmarking, link-local, CGNAT, unspecified.
const RESERVED_IP = /^(0\.0\.0\.0|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|198\.1[89]\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/
// A line that is only a comment: a host there is named, not used. It still
// has to be KNOWN, but it cannot make a documentation host "misplaced".
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|<!--|--|;)/

// ---------------------------------------------------------------------------
const TEXT = /\.(js|jsx|mjs|cjs|ts|tsx|php|html|htm|css|json|xml|txt|md|sql|webmanifest|sh|py|dart|svg|htaccess|example|yaml|yml|ini|awk|glsl|nvmrc|node-version|gitignore|env|cfg|conf|csv)$/i
const SKIP = /(^|\/)(node_modules|dist|\.git|coverage|\.expo|web-build)\/|package-lock\.json|\.min\.(js|css)$|\.pyc$|\.zip$|\.woff2?$|\.(png|jpe?g|webp|gif|ico)$/i

const SCHEME_RE = /\b(https?|ftps?|sftp|ssh|wss?|git|file|smtps?|ldaps?):\/\/([^\s"'`<>()\[\]{}\\,;|]*)/gi
const PROTO_REL_RE = /(?<![:\w\/])\/\/((?:[a-z0-9-]+\.)+[a-z]{2,}|[0-9]{1,3}(?:\.[0-9]{1,3}){3})(?![\w-])/gi
const PSEUDO_RE = /\b(javascript|vbscript|mailto|tel|data):/gi
const WWW_RE = /(?<![\w@\/.-])(www\.(?:[a-z0-9-]+\.)+[a-z]{2,})(?![\w-])/gi
const TLDS = 'com|net|org|io|kw|dev|app|cloud|me|co|uk|info|biz|xyz|tv|us|sa|ae|google|ly|gl'
// Not followed by "(", "=" or ".": `re.test(`, `out.info = x` and `a.co.foo`
// are code, not hosts.
const BARE_RE = new RegExp(`(?<![\\w@\\/.$\\-{])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))(?![\\w-])(?!\\s*(?:\\(|=[^=]|\\.|\\?|}|:(?!\\/\\/)))`, 'gi')
const IP_RE = /(?<![\w.])((?:[0-9]{1,3}\.){3}[0-9]{1,3})(?![\w.])/g

function placeOf(rel) {
  if (/^sporta-web\/scripts\/fixtures\//.test(rel) || /^sporta-live\//.test(rel)) return 'fixture'
  if (/^sporta-web\/(index\.html|public\/|src\/)/.test(rel)) return 'browser'
  if (/^sporta-web\/dropin\//.test(rel)) return 'server'
  if (/^sporta-html5\//.test(rel)) return 'html5'
  if (/^sporta-app\//.test(rel)) return 'app'
  if (/^brand\//.test(rel)) return 'brand'
  if (/\.(md|txt)$/i.test(rel) || /(^|\/)(\.env\.deploy\.example|deploy\.config\.json|vercel\.json|\.mcp\.json|\.gitignore|DNS-EMAIL-RECORDS\.txt)$/.test(rel)) return 'docs'
  return 'tooling'
}

function files() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean)
  const extra = process.env.URL_INVENTORY_EXTRA
  if (extra && existsSync(extra)) out.push(resolve(extra))
  return out
}

// host -> { count, places: Set, files: Map(file -> n), samples: [{file,line,text}] }
const hosts = new Map()
const pseudo = new Map()   // scheme -> count
let filesRead = 0, lines = 0
function hit(host, rel, ln, text) {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (ONLY_HOST && h !== ONLY_HOST) return
  const e = hosts.get(h) ?? { count: 0, places: new Set(), files: new Map(), samples: [] }
  e.count++; e.files.set(rel, (e.files.get(rel) ?? 0) + 1)
  if (COMMENT_LINE.test(text)) e.places.add('comment'); else e.places.add(placeOf(rel))
  if (e.samples.length < 40) e.samples.push({ file: rel, line: ln, text: text.trim().slice(0, 100) })
  hosts.set(h, e)
}

for (const f of files()) {
  const abs = f.startsWith('/') ? f : join(ROOT, f)
  const rel = f.startsWith('/') ? f : f
  if (SKIP.test(rel) || !TEXT.test(rel)) continue
  if (/(^|\/)scripts\/url-inventory-test\.mjs$/.test(rel)) continue   // names every host by design
  let txt
  try { if (statSync(abs).size > 4 * 1024 * 1024) continue; txt = readFileSync(abs, 'utf8') } catch { continue }
  filesRead++
  txt.split('\n').forEach((raw, i) => {
    lines++
    // Percent-encoded URLs inside data: URIs (SVG in the html5 catalogue) are
    // decoded first, so http%3A%2F%2Fwww.w3.org is the host it is.
    const ln = raw.replace(/%3A/gi, ':').replace(/%2F/gi, '/')
    for (const m of ln.matchAll(SCHEME_RE)) {
      const rest = m[2]
      const host = rest.split(/[\/?#&]/)[0].replace(/^.*@/, '').replace(/:\d*$/, '')
      // A template literal boundary, a placeholder or a half-typed name is not a host.
      if (!host || /[$%{}]/.test(host) || !(/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(host) || host === 'localhost')) continue
      hit(host, rel, i + 1, ln)
    }
    for (const m of ln.matchAll(PROTO_REL_RE)) hit(m[1], rel, i + 1, ln)
    for (const m of ln.matchAll(PSEUDO_RE)) { const k = m[1].toLowerCase(); pseudo.set(k, (pseudo.get(k) ?? 0) + 1) }
    for (const m of ln.matchAll(WWW_RE)) hit(m[1], rel, i + 1, ln)
    for (const m of ln.matchAll(BARE_RE)) {
      const h = m[1].toLowerCase()
      if (/^www\./.test(h)) continue
      // Not hosts: file names, version numbers, identifier chains in code
      // ("header.ai", "FAKE.me", "c.local") whose first label is one or two
      // characters, and reserved-TLD fixtures (handled below as KNOWN).
      const first = h.split('.')[0]
      if (/^(\d+\.)+\d+$/.test(h)) continue
      if (first.length <= 2 && !RESERVED.test(h)) continue
      hit(h, rel, i + 1, ln)
    }
    // An IP literal in a test or fixture file is a fake client address by
    // definition; elsewhere it is a host and must be KNOWN.
    const testFile = /(-test\.mjs|-test\.cjs|\.test\.mjs)$|scripts\/fixtures\//.test(rel)
    for (const m of ln.matchAll(IP_RE)) { if (!/^127\./.test(m[1]) && !testFile && m[1].split('.').every((o) => Number(o) <= 255)) hit(m[1], rel, i + 1, ln) }
  })
}

// ---------------------------------------------------------------------------
let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }

const sorted = [...hosts.entries()].sort((a, b) => b[1].count - a[1].count)
const unknown = [], misplaced = [], known = [], fixtures = []
for (const [h, e] of sorted) {
  if (RESERVED.test(h) || RESERVED_IP.test(h)) { fixtures.push([h, e]); continue }
  const a = ALLOW[h]
  if (!a) { unknown.push([h, e]); continue }
  known.push([h, e])
  const outside = [...e.places].filter((p) => p !== 'comment' && !a.where.includes(p))
  if (outside.length) misplaced.push([h, e, outside])
}

console.log(`url-inventory: ${filesRead} text files, ${lines} lines, ${hosts.size} distinct hosts (${fixtures.length} reserved-TLD fixtures), pseudo-schemes: ${[...pseudo].map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}\n`)
console.log('host                                      count  places                      why')
for (const [h, e] of known) console.log(`${h.padEnd(41)} ${String(e.count).padStart(5)}  ${[...e.places].join(',').padEnd(27)} ${ALLOW[h].why.slice(0, 90)}`)
console.log(`\n${fixtures.length} reserved fixture hosts (.test/.example/.invalid/.local and RFC 5737/1918/2544 addresses): ${fixtures.map(([h]) => h).slice(0, 30).join(' ')}${fixtures.length > 30 ? ' …' : ''}\n`)

if (unknown.length === 0) ok('every host is KNOWN for a written reason')
for (const [h, e] of unknown) {
  bad(`UNKNOWN host ${h}`, `${e.count}× in ${[...e.places].join(',')}: ${[...e.files.keys()].slice(0, 4).join(', ')}${e.files.size > 4 ? ` +${e.files.size - 4} more` : ''}`)
  if (VERBOSE || ONLY_HOST) for (const s of e.samples) console.log(`       ${s.file}:${s.line}  ${s.text}`)
}
if (misplaced.length === 0) ok('no documentation/tooling host appears in a browser or server file')
for (const [h, e, outside] of misplaced) {
  bad(`${h} appears in ${outside.join(',')} but is allowed only in ${ALLOW[h].where.join(',')}`,
    e.samples.filter((s) => outside.includes(placeOf(s.file)) && !COMMENT_LINE.test(s.text)).map((s) => `${s.file}:${s.line}`).slice(0, 6).join(', '))
  if (VERBOSE || ONLY_HOST) for (const s of e.samples.filter((s) => outside.includes(placeOf(s.file)) && !COMMENT_LINE.test(s.text))) console.log(`       ${s.file}:${s.line}  ${s.text}`)
}
// Allow-list hygiene: an entry nothing uses is a reason that no longer holds.
const unused = Object.keys(ALLOW).filter((h) => !hosts.has(h))
if (unused.length) console.log(`note unused allow-list entries (fine, but say why they stay): ${unused.join(' ')}`)
if (ONLY_HOST) { const e = hosts.get(ONLY_HOST); console.log(e ? `\n${ONLY_HOST}: ${e.count}× in ${[...e.files.keys()].join(', ')}` : `\n${ONLY_HOST}: not found`) }

console.log(`\n${fails ? `${fails} FAIL` : 'all ok'} — ${known.length} known hosts, ${unknown.length} unknown, ${misplaced.length} misplaced`)
process.exit(fails ? 1 : 0)
