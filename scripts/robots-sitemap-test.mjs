/**
 * robots.txt and the sitemaps, as a crawler actually reads them.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/robots-sitemap-test.mjs        (needs apache2)
 *
 * These two files are the only part of the site written FOR machines, and the
 * whole failure mode is that they are never wrong in a way anybody sees. A
 * sitemap listing a URL that 404s, or a robots group that forgot a Disallow,
 * costs nothing today and shows up weeks later as pages missing from Google or
 * as an admin panel in somebody's index.
 *
 * WHY IT BOOTS APACHE. Both files are served flat, but everything they POINT
 * AT goes through .htaccess — the SPA rewrite, the www/https redirects, and
 * the rule that swaps the static sitemap-products.xml for the PHP that
 * generates it from the real catalogue. Checking the XML without checking what
 * its URLs answer is checking half the artefact, and `php -S` ignores every
 * rule that matters here.
 *
 * WHAT IT CHECKS
 *
 *  1. ROBOTS GROUPS ARE COMPLETE. A crawler obeys exactly ONE group — the one
 *     naming it, or the wildcard if none does — and does NOT also read the
 *     wildcard. So every Disallow has to be repeated in every group, and this
 *     file has seventeen of them. That has been wrong here before: the named
 *     AI bots once carried `Allow: /` and nothing else, which told each of them
 *     by name that /backends was fair game.
 *
 *  2. EVERY PRIVATE PATH IS COVERED, against a list kept here rather than
 *     inferred from the file — inferring it would make the test agree with
 *     whatever robots.txt happens to say, which is not a test.
 *
 *  3. THE SITEMAP LINE RESOLVES, and the index it names lists sitemaps that
 *     resolve, and those list URLs that answer 200 — not 301, which wastes the
 *     crawl and means the sitemap is naming a non-canonical spelling.
 *
 *  4. THE TWO FILES DO NOT CONTRADICT EACH OTHER. A URL that is both listed in
 *     a sitemap and disallowed in robots.txt is a "Blocked by robots.txt"
 *     error in Search Console, and it is the kind of mistake that arrives when
 *     someone adds a Disallow without looking at the sitemap.
 *
 *  5. THE PRODUCT SITEMAP MATCHES THE CATALOGUE. It is generated from MySQL by
 *     api/sitemap-products.php, and a static copy from build time sits beside
 *     it as a fallback. Every slug in it must be an ACTIVE product: a
 *     deactivated one still answers 200 (the SPA renders its own not-found),
 *     so it is a soft 404 that nothing else in this repo would notice.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const DOCROOT = `${ROOT}/sporta-site/public_html`
const SITE = 'https://www.sporta.com.kw'
const PORT = 4402
const CONF = '/tmp/sporta-robots-test.conf'

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }
const note = (what) => console.log(`--   ${what}`)

// ---------------------------------------------------------------- 1. robots
console.log('--- robots.txt')
const robots = readFileSync(`${DOCROOT}/robots.txt`, 'utf8')

// Parse it the way a crawler does: groups are runs of User-agent lines
// followed by their rules, and a blank line or a new User-agent after rules
// starts a new group.
const groups = []
let cur = null
for (const raw of robots.split('\n')) {
  const line = raw.replace(/#.*$/, '').trim()
  if (!line) continue
  const [k, ...rest] = line.split(':')
  const key = k.trim().toLowerCase()
  const val = rest.join(':').trim()
  if (key === 'user-agent') {
    if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur) }
    cur.agents.push(val)
  } else if (key === 'disallow' || key === 'allow') {
    if (cur) cur.rules.push({ key, val })
  }
}
console.log(`     ${groups.length} groups, ${groups.reduce((a, g) => a + g.agents.length, 0)} user-agents named`)

// THE PRIVATE PATHS ARE LISTED HERE, not read out of robots.txt. Reading them
// out and then checking they are present is the same number on both sides of
// the equals sign — it would pass on an empty file.
//
// /admin is on this list because it is a live route: .htaccess 302s
// /admin -> /backends, so it is a second public spelling of the panel and a
// crawler that only knows the first one will happily follow the second.
const PRIVATE = ['/backends', '/admin', '/knet/', '/pay/', '/api/']
const wildcard = groups.find((g) => g.agents.includes('*'))
check(!!wildcard, 'there is a wildcard group for crawlers nothing else names')

for (const path of PRIVATE) {
  const missing = groups
    .filter((g) => !g.rules.some((r) => r.key === 'disallow' && path.startsWith(r.val) && r.val !== '/'))
    .flatMap((g) => g.agents)
  check(missing.length === 0,
    missing.length
      ? `${path} is NOT disallowed for ${missing.length} of ${groups.length} groups: ${missing.join(', ')}`
      : `${path} is disallowed in all ${groups.length} groups`)
}

// Every group must actually allow the storefront, or a named bot is silently
// excluded from the whole site — the opposite mistake, and just as quiet.
const noAllow = groups.filter((g) => !g.rules.some((r) => r.key === 'allow' && r.val === '/'))
  .flatMap((g) => g.agents)
check(noAllow.length === 0,
  noAllow.length ? `${noAllow.length} group(s) never say Allow: / — ${noAllow.join(', ')}`
                 : 'every group is allowed the storefront')

const sitemapLines = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1])
check(sitemapLines.length === 1, `robots.txt names ${sitemapLines.length} sitemap(s): ${sitemapLines.join(', ') || 'NONE'}`)

// ------------------------------------------------------------- boot apache
if (!existsSync('/usr/sbin/apache2')) {
  console.log('\nSKIP  apache2 is not installed — the URLs themselves are unchecked')
  console.log(fails ? `\n${fails} failed` : '\nrobots.txt ok; the sitemaps were not fetched')
  process.exit(fails ? 1 : 0)
}
const MODULES = ['mpm_event', 'authz_core', 'mime', 'dir', 'setenvif', 'env',
                 'expires', 'deflate', 'filter', 'alias', 'headers', 'rewrite', 'proxy', 'proxy_fcgi']
writeFileSync(CONF, `ServerName 127.0.0.1
Listen ${PORT}
${MODULES.filter((m) => existsSync(`/usr/lib/apache2/modules/mod_${m}.so`))
  .map((m) => `LoadModule ${m}_module /usr/lib/apache2/modules/mod_${m}.so`).join('\n')}
TypesConfig /etc/mime.types
User www-data
Group www-data
ErrorLog /tmp/sporta-robots-test.err
PidFile /tmp/sporta-robots-test.pid
<VirtualHost *:${PORT}>
  DocumentRoot ${DOCROOT}
  <Directory ${DOCROOT}>
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
`)
spawnSync('apache2', ['-f', CONF, '-k', 'stop'], { stdio: 'ignore' })
const start = spawnSync('apache2', ['-f', CONF, '-k', 'start'], { encoding: 'utf8' })
if (start.status !== 0) {
  console.log('FAIL apache would not start:\n' + (start.stderr || start.stdout))
  process.exit(1)
}
execFileSync('sh', ['-c', `for i in $(seq 20); do curl -s -o /dev/null http://127.0.0.1:${PORT}/ && exit 0; sleep 0.2; done`],
  { stdio: 'ignore' })
const stop = () => spawnSync('apache2', ['-f', CONF, '-k', 'stop'], { stdio: 'ignore' })

// Host and proto are faked for the same reason htaccess-test.mjs fakes them:
// .htaccess 301s every other hostname and anything not already on https, so
// without these every single request is a redirect and nothing is tested.
const get = (url) => {
  const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url
  const r = spawnSync('curl', [
    '-s', '-o', '/tmp/sporta-robots-body', '-D', '/tmp/sporta-robots-head',
    '-H', 'Host: www.sporta.com.kw', '-H', 'X-Forwarded-Proto: https',
    '-w', '%{http_code}', `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8' })
  const head = existsSync('/tmp/sporta-robots-head') ? readFileSync('/tmp/sporta-robots-head', 'utf8') : ''
  return {
    status: Number(r.stdout) || 0,
    location: (head.match(/^location:\s*(.*)$/im)?.[1] ?? '').trim(),
    type: (head.match(/^content-type:\s*(.*)$/im)?.[1] ?? '').trim(),
    body: existsSync('/tmp/sporta-robots-body') ? readFileSync('/tmp/sporta-robots-body', 'utf8') : '',
  }
}

// ------------------------------------------------------- 2. the sitemap tree
console.log('\n--- the sitemaps, fetched')
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])

const index = get(sitemapLines[0] ?? `${SITE}/sitemap.xml`)
check(index.status === 200 && /xml/.test(index.type),
  `${sitemapLines[0]} answers ${index.status} ${index.type}`)

const children = locs(index.body)
check(children.length > 0, `the index lists ${children.length} sitemap(s)`)

// THIS APACHE HAS NO PHP HANDLER, and sitemap-products.xml is rewritten to
// api/sitemap-products.php. Apache hands back the SOURCE with a 200, which
// contains no <loc> at all — the first run of this rig reported "0 URLs" and
// then "46 active products are in no sitemap", both of which were the rig
// describing itself. htaccess-test.mjs carries the same caveat and answers it
// by asserting nothing about PHP responses; here the PHP output is the whole
// point, so it is fetched from the sandbox's real interpreter instead.
//
// Apache still decides WHICH url is served — the rewrite is checked below on
// the source it returned — and the PHP server provides what that url means.
const PHP = process.env.PHP_BASE ?? 'http://127.0.0.1:4300'
const viaPhp = (path) => {
  const r = spawnSync('curl', ['-s', '-m', '10', `${PHP}${path}`], { encoding: 'utf8' })
  return r.stdout ?? ''
}

const allUrls = []
for (const child of children) {
  const r = get(child)
  let body = r.body
  let how = ''
  if (body.trimStart().startsWith('<?php')) {
    // Confirm the rewrite fired — the source we got back must be the file the
    // rewrite names, not some other php. Then get the real answer.
    check(body.includes('sitemap'), `${child.replace(SITE, '')} is rewritten to PHP by .htaccess`)
    body = viaPhp('/api/sitemap-products.php')
    how = ' (generated, fetched from the PHP sandbox)'
  }
  const urls = locs(body)
  check(r.status === 200 && urls.length > 0,
    `${child.replace(SITE, '')} -> ${r.status}, ${urls.length} URLs${how}`)
  allUrls.push(...urls.map((u) => ({ u, from: child.replace(SITE, '') })))
}

// A lastmod IN THE INDEX must not be older than the sitemap it describes.
//
// It is the one signal a crawler uses to decide whether a child is worth
// re-fetching, so a value permanently behind the child's own says "nothing has
// changed" every time something does. This index used to stamp the product
// sitemap 2026-07-26, from the day it was built; the sitemap is generated from
// MySQL now and stamps itself, and by the time this was written the two were a
// month apart. Omitting it is valid and honest; claiming an old date is not.
const stamp = (xml, loc) => {
  const block = xml.split('<sitemap>').find((b) => b.includes(loc))
  return block?.match(/<lastmod>\s*([^<\s]+)/)?.[1] ?? null
}
for (const child of children) {
  const claimed = stamp(index.body, child)
  if (!claimed) { note(`${child.replace(SITE, '')} carries no lastmod in the index — the crawler decides for itself`); continue }
  const r = get(child)
  const body = r.body.trimStart().startsWith('<?php') ? viaPhp('/api/sitemap-products.php') : r.body
  const newest = [...body.matchAll(/<lastmod>\s*([^<\s]+)/g)].map((m) => Date.parse(m[1]))
    .filter(Number.isFinite).sort((a, b) => b - a)[0]
  if (newest === undefined) continue
  check(Date.parse(claimed) >= newest,
    `${child.replace(SITE, '')} lastmod ${claimed} is not behind its own newest entry (${new Date(newest).toISOString().slice(0, 10)})`)
}

// Every URL must be on the canonical host and scheme, or the sitemap is
// nominating a spelling that redirects.
const offHost = allUrls.filter(({ u }) => !u.startsWith(`${SITE}/`))
check(offHost.length === 0,
  offHost.length ? `${offHost.length} URL(s) are not on ${SITE}: ${offHost.slice(0, 3).map((x) => x.u).join(', ')}`
                 : `all ${allUrls.length} URLs are on ${SITE} over https`)

// -------------------------------------------- 3. sitemap vs robots agreement
const disallowed = (path) =>
  (wildcard?.rules ?? []).some((r) => r.key === 'disallow' && r.val !== '/' && path.startsWith(r.val))
const blocked = allUrls.filter(({ u }) => disallowed(new URL(u).pathname))
check(blocked.length === 0,
  blocked.length
    ? `${blocked.length} URL(s) are in a sitemap AND disallowed in robots.txt:\n       ` +
      blocked.slice(0, 5).map((x) => x.u).join('\n       ')
    : 'nothing is both submitted and blocked')

// ------------------------------------------------ 4. do the URLs answer 200
console.log('\n--- what those URLs answer')
const bad = []
// One per distinct path — the ?lang=en twins are the same route and the SPA
// reads the query in the browser, so fetching both proves nothing twice.
const paths = [...new Set(allUrls.map(({ u }) => new URL(u).pathname))]
for (const p of paths) {
  const r = get(p)
  if (r.status !== 200) bad.push(`${p} -> ${r.status}${r.location ? ' -> ' + r.location : ''}`)
}
check(bad.length === 0,
  bad.length ? `${bad.length} of ${paths.length} sitemap URLs do not answer 200:\n       ` + bad.slice(0, 8).join('\n       ')
             : `all ${paths.length} distinct sitemap paths answer 200`)

// The private paths must be reachable-but-unlisted, not broken — robots.txt is
// a request, not a lock, and a Disallow on a URL that 404s is just noise.
for (const p of ['/backends', '/admin']) {
  const r = get(p)
  check(r.status === 200 || (r.status >= 300 && r.status < 400),
    `${p} exists (${r.status}${r.location ? ' -> ' + r.location : ''}) — so disallowing it is doing something`)
}

// ------------------------------- 5. the product sitemap against the catalogue
console.log('\n--- the product sitemap against the real catalogue')
const active = new Set(
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-B', '-e',
    'select slug from products where active = 1'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean))
const listed = new Set(allUrls
  .map(({ u }) => new URL(u).pathname.match(/^\/product\/(.+)$/)?.[1])
  .filter(Boolean))
const stale = [...listed].filter((s) => !active.has(s))
const unlisted = [...active].filter((s) => !listed.has(s))
check(stale.length === 0,
  stale.length
    ? `${stale.length} slug(s) are in the sitemap but NOT active — each is a soft 404 that answers 200:\n       ` +
      stale.join('\n       ')
    : `every one of the ${listed.size} slugs in the sitemap is an active product`)
check(unlisted.length === 0,
  unlisted.length
    ? `${unlisted.length} active product(s) are in no sitemap and will not be crawled:\n       ` + unlisted.join('\n       ')
    : `every one of the ${active.size} active products is in the sitemap`)

// The static copy is a FALLBACK, served only if api/sitemap-products.php is
// missing. It drifts silently the first time a product is added in /backends,
// so it is worth knowing how far behind it is — not a failure, because the
// rewrite means nobody is served it while the PHP is there.
const staticXml = readFileSync(`${DOCROOT}/sitemap-products.xml`, 'utf8')
const staticSlugs = new Set(locs(staticXml)
  .map((u) => new URL(u).pathname.match(/^\/product\/(.+)$/)?.[1]).filter(Boolean))
const drift = [...staticSlugs].filter((s) => !listed.has(s)).length +
              [...listed].filter((s) => !staticSlugs.has(s)).length
if (drift) note(`the static fallback sitemap-products.xml is ${drift} slug(s) out of step with the database`)
else console.log('ok   the static fallback agrees with the generated one')

stop()
console.log(fails ? `\n${fails} failed` : '\nall ok — robots.txt and the sitemaps agree with each other and with the site')
process.exit(fails ? 1 : 0)
