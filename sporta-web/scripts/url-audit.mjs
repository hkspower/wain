// Who uses which URL.
//
// CLAUDE.md carries a standing rule: the canonical origin is exactly
// https://www.sporta.com.kw, and no second spelling of it may ever be
// introduced. A bare domain, a plain-http variant or the raw IP in a canonical
// tag, a sitemap or a JSON-LD block splits the site in Google's eyes and
// quietly loses ranking. Nothing in the build enforces that, so it is asserted
// here.
//
// It also answers the plainer question: which third-party hosts does this site
// talk to, and does the Content-Security-Policy match that list — both ways.
// An allowlisted host nobody calls is a hole left open for no reason.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const web = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const root = join(web, '..')

const CANONICAL = 'https://www.sporta.com.kw'
const SELF = /sporta\.com\.kw/i

// Directories that are inputs or outputs, kept apart: a localhost URL in a test
// script is fine, the same URL in shipped output is a serious defect.
const SHIPPED = [join(web, 'dist'), join(root, 'sporta-html5')]
const SOURCE = [join(web, 'src'), join(web, 'public'), join(web, 'dropin'),
                join(web, 'index.html'), join(web, 'deploy.config.json')]
const DOCS = [join(root, 'GO-LIVE.md'), join(root, 'KNET.md'), join(root, 'CLAUDE.md'),
              join(root, 'SECURITY.md'), join(root, 'DNS-EMAIL-RECORDS.txt')]

const SKIP_DIR = new Set(['node_modules', '.git', 'coverage'])
const TEXT = /\.(js|jsx|ts|tsx|mjs|cjs|php|html|css|json|xml|txt|md|sql|webmanifest|sh)$/i

function walk(p, out = []) {
  if (!existsSync(p)) return out
  if (statSync(p).isFile()) { if (TEXT.test(p)) out.push(p); return out }
  for (const e of readdirSync(p)) {
    if (SKIP_DIR.has(e)) continue
    walk(join(p, e), out)
  }
  return out
}

// Deliberately also matches protocol-relative and bare-host forms, because a
// wrong spelling rarely arrives with a tidy https:// in front of it.
const URL_RE = /\b(?:https?:)?\/\/[a-z0-9._~%-]+(?:\:[0-9]+)?[a-z0-9._~%!$&'()*+,;=:@/?#-]*/gi
const BARE_SELF_RE = /\b(?<!\/\/)(?<!\.)sporta\.com\.kw\b/gi

const byHost = new Map()      // host -> Set(file)
const selfSpellings = new Map() // exact spelling -> Set(file)

function record(file, url) {
  // A template literal is not a second spelling of the origin. The URL pattern
  // cannot match "{", so `https://www.sporta.com.kw${path}` arrives here as
  // `https://www.sporta.com.kw$` — the canonical origin with a stray "$" glued
  // on, reported as a defect in every file that composes a URL that way.
  //
  // The trailing "$" is therefore trimmed, NOT treated as a reason to skip the
  // URL. Skipping was the first attempt and it was worse than the bug: it also
  // silenced `http://www.sporta.com.kw${path}`, a genuinely wrong scheme, which
  // a fault-injection check then proved was going unreported.
  // Trailing quotes, commas and brackets get swept up by the pattern and turn
  // a perfectly canonical URL into a phantom second spelling.
  url = url.replace(/['"`,;)\]}>]+$/, '').replace(/\$+$/, '')
  let host
  try { host = new URL(url.startsWith('//') ? 'https:' + url : url).host } catch { return }
  if (!byHost.has(host)) byHost.set(host, new Set())
  byHost.get(host).add(file)

  if (SELF.test(host)) {
    const spelling = url.match(/^(?:https?:)?\/\/[^/]+/)[0]
    if (!selfSpellings.has(spelling)) selfSpellings.set(spelling, new Set())
    selfSpellings.get(spelling).add(file)
  }
}

const group = (paths) => paths.flatMap((p) => walk(p))
const groups = { shipped: group(SHIPPED), source: group(SOURCE), docs: group(DOCS) }

for (const [, files] of Object.entries(groups)) {
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.match(URL_RE) ?? []) record(relative(root, f), m)
  }
}

const problems = []

// ---- 1. one spelling of our own origin, everywhere it is EMITTED -----------
// Redirect rules and docs legitimately mention the wrong spellings — that is
// their whole job. Shipped page content must not.
const REDIRECT_FILES = /\.htaccess|GO-LIVE|KNET\.md|CLAUDE\.md|SECURITY|mac-check|scripts\//
for (const [spelling, files] of selfSpellings) {
  if (spelling === CANONICAL) continue
  const offenders = [...files].filter((f) => !REDIRECT_FILES.test(f))
  if (offenders.length) {
    problems.push({ sev: 'HIGH', what: `non-canonical self-URL "${spelling}"`, where: offenders.join(', ') })
  }
}

// ---- 2. nothing local may reach shipped output -----------------------------
const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local)(:|$)/i
// Third-party libraries ship their own defaults and error-message URLs, which
// are inert — a localhost fallback inside a vendored library is not an address
// this site ever calls. Only OUR files matter here.
const isVendorBundle = (f) => /\/(assets|vendor)\/(react-vendor|rolldown)-/.test(f)
for (const [host, files] of byHost) {
  const shipped = [...files].filter(
    (f) => (f.startsWith('sporta-web/dist') || f.startsWith('sporta-html5')) && !isVendorBundle(f))
  if (LOCAL.test(host) && shipped.length) {
    problems.push({ sev: 'HIGH', what: `local address ${host} baked into our shipped output`, where: shipped.join(', ') })
  }
}

// ---- 3. the raw server IP must never appear in shipped output --------------
for (const [host, files] of byHost) {
  if (/^\d+\.\d+\.\d+\.\d+/.test(host)) {
    const shipped = [...files].filter((f) => f.startsWith('sporta-web/dist') || f.startsWith('sporta-html5'))
    if (shipped.length) problems.push({ sev: 'HIGH', what: `raw IP ${host} in shipped output`, where: shipped.join(', ') })
  }
}

// ---- 4. CSP vs the subresources actually declared --------------------------
//
// Only subresources are governed by CSP. A regex cannot tell a fetch from an
// <a href> navigation or from a URL inside a library's error message, so this
// looks only where the distinction is unambiguous: <link>/<script> tags in the
// shipped HTML, and url() in the shipped CSS. The backend is /api on this same
// origin, so connect-src is 'self' and there is no runtime host to guess at.
const htaccess = readFileSync(join(web, 'public', '.htaccess'), 'utf8')
const csp = htaccess.match(/Content-Security-Policy\s+"([^"]+)"/)?.[1] ?? ''
const cspHosts = new Set((csp.match(/https:\/\/[^\s;']+/g) ?? []).map((u) => u.replace('https://', '')))

const subresourceHosts = new Set()
for (const f of groups.shipped) {
  const text = readFileSync(f, 'utf8')
  if (/\.html?$/.test(f)) {
    for (const m of text.matchAll(/<(?:link|script|img|iframe)\b[^>]*?(?:href|src)=["'](https?:\/\/[^"']+)/gi)) {
      try { subresourceHosts.add(new URL(m[1]).host) } catch { /* ignore */ }
    }
  }
  if (/\.css$/.test(f)) {
    for (const m of text.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi)) {
      try { subresourceHosts.add(new URL(m[1]).host) } catch { /* ignore */ }
    }
  }
}
for (const h of subresourceHosts) {
  if (SELF.test(h)) continue
  const covered = [...cspHosts].some((c) => c === h || (c.startsWith('*.') && h.endsWith(c.slice(1))))
  if (!covered) problems.push({ sev: 'HIGH', what: `${h} is loaded as a subresource but the CSP forbids it`, where: 'public/.htaccess' })
}

// Everything that is not us, not local, not an IP, and not an XML namespace.
const NAMESPACE = /^(schema\.org|www\.w3\.org|www\.sitemaps\.org|www\.google\.com|creativecommons\.org|ogp\.me)$/
const THIRD_PARTY = [...byHost.keys()].filter(
  (h) => !SELF.test(h) && !LOCAL.test(h) && !/^\d+\.\d+\.\d+\.\d+/.test(h) && !NAMESPACE.test(h))

// ------------------------------------------------------------------ report
console.log('='.repeat(74))
console.log('DOMAIN / URL AUDIT — who uses which host')
console.log('='.repeat(74))

console.log('\nOUR OWN ORIGIN — spellings found')
for (const [spelling, files] of [...selfSpellings].sort()) {
  const tag = spelling === CANONICAL ? 'CANONICAL' : 'other'
  console.log(`  ${tag.padEnd(10)} ${spelling.padEnd(30)} ${files.size} file(s)`)
  if (spelling !== CANONICAL) for (const f of [...files].sort()) console.log(`             ${f}`)
}

console.log('\nHOSTS THE BROWSER ACTUALLY FETCHES FROM  (subresources)')
for (const h of [...subresourceHosts].filter((h) => !SELF.test(h)).sort()) {
  const covered = [...cspHosts].some((c) => c === h || (c.startsWith('*.') && h.endsWith(c.slice(1))))
  console.log(`  ${h.padEnd(34)} ${covered ? 'allowed by CSP' : '*** BLOCKED BY CSP ***'}`)
}

console.log('\nHOSTS ONLY LINKED TO  (navigations — CSP does not apply)')
const LINKED = ['wa.me', 'www.instagram.com', 'www.tiktok.com', 'kpay.com.kw', 'kpaytest.com.kw']
for (const h of THIRD_PARTY.filter((h) => LINKED.includes(h)).sort()) {
  console.log(`  ${h.padEnd(34)} ${h.includes('kpay') ? 'payment form target (in CSP form-action)' : 'social / WhatsApp link'}`)
}

console.log('\nMENTIONED ONLY  (documentation, library error strings — never fetched)')
for (const h of THIRD_PARTY.filter((h) => !LINKED.includes(h) && !subresourceHosts.has(h)).sort()) {
  console.log(`  ${h}`)
}

console.log('\nLOCAL / IP REFERENCES  (must not reach our shipped output)')
for (const [host, files] of byHost) {
  if (!LOCAL.test(host) && !/^\d+\.\d+\.\d+\.\d+/.test(host)) continue
  const shipped = [...files].filter((f) => f.startsWith('sporta-web/dist') || f.startsWith('sporta-html5'))
  const ours = shipped.filter((f) => !isVendorBundle(f))
  const state = ours.length ? '*** IN OUR SHIPPED OUTPUT ***'
    : shipped.length ? 'inside a vendor bundle only (inert library default)'
    : 'source/docs only'
  console.log(`  ${host.padEnd(34)} ${state}`)
}

console.log('\n' + '-'.repeat(74))
if (!problems.length) {
  console.log('No problems. One spelling of the origin; nothing local or IP-based shipped.')
} else {
  for (const p of problems.sort((a, b) => a.sev.localeCompare(b.sev))) {
    console.log(`  [${p.sev}] ${p.what}\n         ${p.where}`)
  }
}
console.log(`\n${problems.filter((p) => p.sev === 'HIGH').length} high, ` +
            `${problems.filter((p) => p.sev === 'MED').length} medium, ` +
            `${problems.filter((p) => p.sev === 'LOW').length} low`)
