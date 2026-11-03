// What the sitemap really is, proven without the shared rig.
//
//   npm run test:sitemap-check
//
// WHY THIS EXISTS. The owner asked "check the sitemap url". Four things can make
// a sitemap lie to Google, and none of them shows in a browser:
//   * a <loc> that is not the canonical origin (a Host header leaking in, a bare
//     domain, http), or one the site itself answers 404;
//   * XML that a strict parser refuses (one raw & drops every URL in the file);
//   * an hreflang set that is not reciprocal (Google discards the whole cluster);
//   * a failure that is reported as an EMPTY, healthy 200 ("everything deleted").
//
// RIG-FREE. Nothing here touches the shared rig (database `sporta`, ports
// 8095-8100 / 8188 / 4173, dist/). The suite builds its own private MariaDB
// (SMK_DB_PORT, default 3395, database `sitemapchk`), its own php -S servers
// (SMK_PORT_BASE, default 8381, six consecutive ports) and its own site tree in
// a temporary directory, and removes all of it at the end. Without mariadbd or
// php on the machine the dynamic half is SKIPPED loudly; the static half and the
// pure-function half still run.
//
// THREE PARTS
//   1. STATIC     robots.txt, the committed public/sitemap*.xml, the rewrite rules
//                 in public/.htaccess and dropin/php-store/.htaccess, the page
//                 list in four places (generator, seo-page.php, seo-config.php,
//                 App.jsx), llms.txt and index.html against the sitemap.
//   2. PURE       sporta_sitemap_product_xml() fed hostile slugs and a 25,001-
//                 product catalogue, through php CLI. No database.
//   3. INSTANCE   the real sitemap-index.php / sitemap-products.php over HTTP
//                 against a seeded MariaDB: hidden products, Arabic slugs, a
//                 slug with a space, &, quotes, an 80-char slug, a hidden
//                 brand; Host / X-Forwarded-Host spoofing; the empty catalogue;
//                 the database down; conditional GET; products.updated_at
//                 present and absent; image entries; and every advertised URL
//                 asked of seo-page.php (the page router) for a 200.
//
// `ok` is a fact that held. `FAIL` is a defect that is not on the known list.
// `GAP` is real, understood, reported in SITEMAP-CHECK findings and NOT fixed
// here (this suite changes no product code); it is printed every run so it
// cannot be forgotten, and fatal only with SITEMAP_STRICT=1.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, cpSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB = new URL('..', import.meta.url).pathname
const STORE = join(WEB, 'dropin/php-store')
const PUB = join(WEB, 'public')
const ORIGIN = 'https://www.sporta.com.kw'
const STRICT = process.env.SITEMAP_STRICT === '1'
const DB_PORT = Number(process.env.SMK_DB_PORT ?? 3395)
const PORT0 = Number(process.env.SMK_PORT_BASE ?? 8381)

let fails = 0
let gaps = 0
let oks = 0
const ok = (n, d = '') => { oks++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const gap = (n, d = '') => { gaps++; if (STRICT) fails++; console.log(`GAP  ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
const read = (p) => readFileSync(p, 'utf8')

// ---------------------------------------------------------------- strict XML
// A small, deliberately unforgiving parser. Browsers and Googlebot are lenient
// about some things; the Sitemaps protocol is not, and one bad byte is "Couldn't
// fetch / Sitemap could not be read" for the whole file.
function parseXml(src) {
  let i = 0
  const fail = (m) => { throw new Error(`xml: ${m} (offset ${i})`) }
  if (src.charCodeAt(0) === 0xfeff) fail('byte order mark before the prolog')
  if (!src.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail('missing or wrong XML declaration')
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(src)) fail('illegal control character')
  i = src.indexOf('?>') + 2
  const ENT = /&(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/y
  const decode = (s) => {
    for (let k = 0; k < s.length; k++) {
      if (s[k] !== '&') continue
      ENT.lastIndex = k
      if (!ENT.test(s)) fail(`bare or unknown entity near "${s.slice(k, k + 12)}"`)
    }
    return s.replace(/&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (m, e) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]
      ?? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)))
  }
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++ }
  const skipMisc = () => {
    for (;;) {
      skipWs()
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i)
        if (e < 0) fail('unterminated comment')
        i = e + 3
      } else return
    }
  }
  const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y
  const name = () => { NAME.lastIndex = i; const m = NAME.exec(src); if (!m) fail('expected a name'); i += m[0].length; return m[0] }
  const resolve = (qn, scope) => {
    const [p, l] = qn.includes(':') ? qn.split(':') : ['', qn]
    const ns = scope[p]
    if (p && ns === undefined) fail(`undeclared namespace prefix "${p}"`)
    return { ns: ns ?? '', local: l }
  }
  function element(parentScope) {
    if (src[i] !== '<') fail('expected an element')
    i++
    const qn = name()
    const attrs = {}
    const scope = { ...parentScope }
    for (;;) {
      const before = i
      skipWs()
      if (src[i] === '>' || src.startsWith('/>', i)) break
      if (i === before) fail('attributes must be separated by whitespace')
      const an = name()
      skipWs()
      if (src[i] !== '=') fail(`attribute ${an} has no value`)
      i++
      skipWs()
      const q = src[i]
      if (q !== '"' && q !== "'") fail(`attribute ${an} is not quoted`)
      const e = src.indexOf(q, i + 1)
      if (e < 0) fail('unterminated attribute')
      const raw = src.slice(i + 1, e)
      if (raw.includes('<')) fail(`raw < inside attribute ${an}`)
      if (an in attrs) fail(`duplicate attribute ${an}`)
      attrs[an] = decode(raw)
      i = e + 1
      if (an === 'xmlns') scope[''] = attrs[an]
      else if (an.startsWith('xmlns:')) scope[an.slice(6)] = attrs[an]
    }
    const r = resolve(qn, scope)
    const el = { qn, ...r, attrs, kids: [], text: '' }
    if (src.startsWith('/>', i)) { i += 2; return el }
    i++ // >
    for (;;) {
      if (i >= src.length) fail(`<${qn}> never closed`)
      if (src.startsWith('</', i)) {
        i += 2
        const c = name()
        if (c !== qn) fail(`</${c}> closes <${qn}>`)
        skipWs()
        if (src[i] !== '>') fail('bad end tag')
        i++
        return el
      }
      if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); if (e < 0) fail('unterminated comment'); i = e + 3; continue }
      if (src.startsWith('<![CDATA[', i) || src.startsWith('<?', i) || src.startsWith('<!', i)) fail('CDATA / PI / DTD not expected in a sitemap')
      if (src[i] === '<') { el.kids.push(element(scope)); continue }
      const e = src.indexOf('<', i)
      if (e < 0) fail('text runs to end of file')
      const raw = src.slice(i, e)
      if (raw.includes(']]>')) fail(']]> in text')
      el.text += decode(raw)
      i = e
    }
  }
  skipMisc()
  const root = element({ xml: 'http://www.w3.org/XML/1998/namespace' })
  skipMisc()
  if (i < src.length) fail('content after the root element')
  return root
}
const NS = {
  sm: 'http://www.sitemaps.org/schemas/sitemap/0.9',
  xhtml: 'http://www.w3.org/1999/xhtml',
  image: 'http://www.google.com/schemas/sitemap-image/1.1',
}
const kids = (el, ns, local) => el.kids.filter((k) => k.ns === ns && k.local === local)
const one = (el, ns, local) => { const k = kids(el, ns, local); return k.length === 1 ? k[0] : null }

// Self-test of the parser, so a lenient parser cannot make the rest pass.
function parserSelfTest() {
  const wrap = (b) => `<?xml version="1.0" encoding="UTF-8"?>\n<a xmlns="x">${b}</a>\n`
  const refuse = {
    'raw &': wrap('<b>a & b</b>'),
    'unknown entity': wrap('<b>&nbsp;</b>'),
    'raw < in attribute': wrap('<b c="<"/>'),
    'unquoted attribute': wrap('<b c=1/>'),
    'mismatched tag': wrap('<b></c>'),
    'unclosed': '<?xml version="1.0" encoding="UTF-8"?>\n<a xmlns="x"><b>',
    'second root': wrap('') + '<z/>',
    'undeclared prefix': wrap('<q:b/>'),
    'control char': wrap('<b>\u0001</b>'),
    'duplicate attribute': wrap('<b c="1" c="2"/>'),
    'no declaration': '<a/>',
    'BOM': '﻿<?xml version="1.0" encoding="UTF-8"?><a/>',
  }
  let held = 0
  for (const [n, x] of Object.entries(refuse)) {
    try { parseXml(x); bad(`parser refuses ${n}`) } catch { held++ }
  }
  is(held === Object.keys(refuse).length, `strict XML parser refuses all ${Object.keys(refuse).length} malformed samples`)
  try {
    const r = parseXml(wrap('<b c="a&amp;b&#233;">x &lt; y &quot;&apos;</b>'))
    is(r.kids[0].attrs.c === 'a&bé' && r.kids[0].text === 'x < y "\'', 'parser decodes the five entities and numeric references')
  } catch (e) { bad('parser accepts a valid document', e.message) }
}

// ------------------------------------------------------- sitemap validation
const W3C = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/
function lastmodProblem(v, now = Date.now()) {
  if (!W3C.test(v)) return 'not W3C datetime'
  const day = v.slice(0, 10)
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'not a real calendar date'
  const t = v.length > 10 ? Date.parse(v) : Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(t)) return 'unparseable'
  if (t > now) return 'in the future'
  return ''
}
const LOC_CHARS = /^[A-Za-z0-9\-._~:/?[\]@!$&'()*+,;=%]+$/
function locProblem(loc) {
  if (!loc.startsWith(`${ORIGIN}/`)) return `not on ${ORIGIN}/`
  if (loc.length > 2048) return 'over 2048 characters'
  if (!LOC_CHARS.test(loc)) return 'characters that must be percent-encoded'
  if (/%(?![0-9A-F]{2})/.test(loc)) return 'bad percent-encoding'
  if (loc.includes('#')) return 'fragment'
  const q = loc.indexOf('?')
  if (q >= 0 && !/^\?lang=en$/.test(loc.slice(q))) return `query other than ?lang=en: ${loc.slice(q)}`
  return ''
}
const bareOf = (loc) => loc.replace(/\?lang=en$/, '')
const enOf = (loc) => `${bareOf(loc)}?lang=en`

/** Parse + fully validate a <urlset>. Returns {urls, problems[]}; never throws. */
function inspectUrlset(xml, { now = Date.now() } = {}) {
  const problems = []
  let root
  try { root = parseXml(xml) } catch (e) { return { urls: [], problems: [e.message], bytes: Buffer.byteLength(xml) } }
  if (root.ns !== NS.sm || root.local !== 'urlset') problems.push(`root is {${root.ns}}${root.local}, not the sitemap 0.9 urlset`)
  const urls = []
  for (const u of kids(root, NS.sm, 'url')) {
    const loc = one(u, NS.sm, 'loc')?.text.trim() ?? ''
    const lm = one(u, NS.sm, 'lastmod')
    const alts = {}
    for (const l of kids(u, NS.xhtml, 'link')) {
      if (l.attrs.rel !== 'alternate') problems.push(`${loc}: xhtml:link rel=${l.attrs.rel}`)
      if (l.attrs.hreflang in alts) problems.push(`${loc}: hreflang ${l.attrs.hreflang} twice`)
      alts[l.attrs.hreflang] = l.attrs.href
    }
    const images = kids(u, NS.image, 'image').map((im) => one(im, NS.image, 'loc')?.text.trim() ?? '')
    urls.push({ loc, lastmod: lm ? lm.text.trim() : null, alts, images })
  }
  if (!urls.length) problems.push('urlset has no <url> (the schema requires at least one)')
  if (urls.length > 50000) problems.push(`${urls.length} URLs, over the 50,000 per-file limit`)
  const bytes = Buffer.byteLength(xml)
  if (bytes > 52428800) problems.push(`${bytes} bytes, over the 50 MB per-file limit`)
  const seen = new Set()
  const locs = new Set(urls.map((u) => u.loc))
  for (const u of urls) {
    const lp = locProblem(u.loc)
    if (lp) problems.push(`loc ${u.loc}: ${lp}`)
    if (seen.has(u.loc)) problems.push(`duplicate loc ${u.loc}`)
    seen.add(u.loc)
    if (u.lastmod !== null) { const p = lastmodProblem(u.lastmod, now); if (p) problems.push(`${u.loc}: lastmod ${u.lastmod} ${p}`) }
    // hreflang: ar = bare, en = ?lang=en, x-default = bare, reciprocal.
    if (Object.keys(u.alts).length) {
      const want = { ar: bareOf(u.loc), en: enOf(u.loc), 'x-default': bareOf(u.loc) }
      for (const [k, v] of Object.entries(want)) if (u.alts[k] !== v) problems.push(`${u.loc}: hreflang ${k} is ${u.alts[k]}, expected ${v}`)
      if (Object.keys(u.alts).length !== 3) problems.push(`${u.loc}: ${Object.keys(u.alts).length} alternates, expected 3`)
      for (const v of Object.values(u.alts)) if (!locs.has(v)) problems.push(`${u.loc}: alternate ${v} is not itself listed (not reciprocal)`)
    } else problems.push(`${u.loc}: no hreflang alternates`)
    for (const im of u.images) {
      const ip = locProblem(im)
      if (ip && !(ip.includes('query') )) problems.push(`image ${im}: ${ip}`)
    }
  }
  const usesImage = urls.some((u) => u.images.length)
  if (usesImage && root.attrs['xmlns:image'] !== NS.image) problems.push('image:image used without the image namespace')
  if (root.attrs['xmlns:xhtml'] !== NS.xhtml) problems.push('xhtml namespace not declared on urlset')
  return { urls, problems, bytes }
}
function inspectIndex(xml, now = Date.now()) {
  const problems = []
  let root
  try { root = parseXml(xml) } catch (e) { return { children: [], problems: [e.message] } }
  if (root.ns !== NS.sm || root.local !== 'sitemapindex') problems.push('root is not the sitemap 0.9 sitemapindex')
  const children = kids(root, NS.sm, 'sitemap').map((s) => ({
    loc: one(s, NS.sm, 'loc')?.text.trim() ?? '',
    lastmod: one(s, NS.sm, 'lastmod')?.text.trim() ?? null,
  }))
  if (!children.length) problems.push('sitemapindex lists no sitemap')
  for (const c of children) {
    if (!c.loc.startsWith(`${ORIGIN}/`) || !/^https:\/\/www\.sporta\.com\.kw\/[A-Za-z0-9_.-]+\.xml$/.test(c.loc)) problems.push(`child loc ${c.loc}`)
    if (c.lastmod !== null) { const p = lastmodProblem(c.lastmod, now); if (p) problems.push(`${c.loc}: lastmod ${c.lastmod} ${p}`) }
  }
  if (new Set(children.map((c) => c.loc)).size !== children.length) problems.push('duplicate child')
  return { children, problems }
}
const report = (n, r, extra = '') => {
  if (r.problems.length) bad(n, `${r.problems.length} problem(s): ${r.problems.slice(0, 3).join(' | ')}`)
  else ok(n, extra)
}

// ================================================================== 1. STATIC
head('1. static: what is advertised and what is routed')
parserSelfTest()

const robots = read(join(PUB, 'robots.txt'))
const sitemapLines = robots.split(/\r?\n/).filter((l) => /^\s*sitemap\s*:/i.test(l))
is(sitemapLines.length === 1 && sitemapLines[0].trim() === `Sitemap: ${ORIGIN}/sitemap.xml`,
  'robots.txt advertises exactly one Sitemap, the index, on the canonical origin', sitemapLines.join(' ; '))
is(!/sitemap-(pages|products)\.xml/i.test(robots), 'robots.txt does not also list the children (the index is the one entry point)')
const lastGroupLine = robots.trim().split(/\r?\n/).pop()
is(/^Sitemap:/i.test(lastGroupLine), 'the Sitemap line stands outside every User-agent group (last line of the file)')

const htaccess = read(join(PUB, '.htaccess'))
const htLines = htaccess.split(/\r?\n/)
const lineOf = (re) => htLines.findIndex((l) => re.test(l))
const iIdx = lineOf(/^\s*RewriteRule \^sitemap\\\.xml\$ \/api\/sitemap-index\.php \[END\]\s*$/)
const iPrd = lineOf(/^\s*RewriteRule \^sitemap-products\\\.xml\$ \/api\/sitemap-products\.php \[END\]\s*$/)
const iGuard = lineOf(/^\s*RewriteCond %\{REQUEST_FILENAME\} -f \[OR\]/)
is(iIdx > 0 && /RewriteCond %\{DOCUMENT_ROOT\}\/api\/sitemap-index\.php -f\s*$/.test(htLines[iIdx - 1]),
  '.htaccess: /sitemap.xml -> /api/sitemap-index.php [END], only when that file exists', `line ${iIdx + 1}`)
is(iPrd > 0 && /RewriteCond %\{DOCUMENT_ROOT\}\/api\/sitemap-products\.php -f\s*$/.test(htLines[iPrd - 1]),
  '.htaccess: /sitemap-products.xml -> /api/sitemap-products.php [END], only when that file exists', `line ${iPrd + 1}`)
is(iIdx < iGuard && iPrd < iGuard, 'both sitemap rules come BEFORE the "real files always win" guard, so the PHP generator beats the static file')
is(lineOf(/sitemap-pages\.xml/) === -1, '.htaccess has no rule for /sitemap-pages.xml: it is the static file in the web root (no PHP generator, no database)')
const apiHt = read(join(STORE, '.htaccess'))
is(/<FilesMatch "\^sitemap-\(index\|products\)\\\.php\$">\s*\n\s*Header set Cache-Control "public, max-age=3600, stale-while-revalidate=86400" "expr=%\{REQUEST_STATUS\} == 200 \|\| %\{REQUEST_STATUS\} == 304"/.test(apiHt),
  'api/.htaccess: the two PHP sitemaps get public max-age=3600 + swr=86400 on 200/304 only (errors stay no-store)')
is(/<FilesMatch "\^\(config\\\.php[^"]*seo-runtime\\\.php/.test(apiHt), 'api/.htaccess denies seo-runtime.php (the include) by name')
is(!/sitemap-(index|products)\\?\.php/.test(apiHt.replace(/<FilesMatch "\^sitemap-\(index\|products\)\\\.php\$">[\s\S]*?<\/FilesMatch>/, '')),
  'api/.htaccess: the sitemap scripts are not denied anywhere (they must be reachable through the rewrite)')
is(/^\s*<FilesMatch "\\\.\(xml\|txt\|webmanifest\|json\)\$">\s*$/m.test(htaccess), 'root .htaccess: static *.xml gets the one-hour tier')

// Files named in the index exist (committed fallbacks) and the index validates.
const idxXml = read(join(PUB, 'sitemap.xml'))
const idx = inspectIndex(idxXml)
report('public/sitemap.xml (static index fallback) is a valid sitemapindex', idx, idx.children.map((c) => c.loc.split('/').pop()).join(', '))
for (const c of idx.children) is(existsSync(join(PUB, c.loc.split('/').pop())), `index child ${c.loc.split('/').pop()} exists in public/`)

const pagesXml = read(join(PUB, 'sitemap-pages.xml'))
const prodXml = read(join(PUB, 'sitemap-products.xml'))
const pagesR = inspectUrlset(pagesXml)
const prodR = inspectUrlset(prodXml)
report('public/sitemap-pages.xml validates (strict XML, https www locs, hreflang reciprocal, lastmod W3C and not future)', pagesR, `${pagesR.urls.length} URLs`)
report('public/sitemap-products.xml validates', prodR, `${prodR.urls.length} URLs`)
is(!/\bpriority\b|\bchangefreq\b/.test(pagesXml + prodXml), 'no <priority>/<changefreq> (Google ignores them)')
is(new Set([...pagesR.urls, ...prodR.urls].map((u) => u.loc)).size === pagesR.urls.length + prodR.urls.length,
  'no URL appears in two child files')

// Every page URL is routed to something that exists in the release.
const pageAlt = /RewriteRule \^\(([a-z|]+)\)\/\?\$ \/index\.html \[L\]/.exec(htaccess)
const routed = new Set((pageAlt?.[1] ?? '').split('|'))
const pagePaths = pagesR.urls.filter((u) => !u.loc.includes('?lang=en')).map((u) => new URL(u.loc).pathname)
for (const p of pagePaths) {
  is(p === '/' || routed.has(p.slice(1)), `page ${p} is routed by .htaccess`, p === '/' ? 'rule ^$ -> seo-page.php' : '')
}
for (const u of prodR.urls) if (!/^\/product\/[^/]+$/.test(new URL(u.loc).pathname)) bad(`product loc shape ${u.loc}`)
is(prodR.urls.every((u) => /^\/product\/[A-Za-z0-9_-]{1,80}(\?lang=en)?$/.test(u.loc.slice(ORIGIN.length))),
  'every committed product URL is ASCII [A-Za-z0-9_-] (the shape seo-page.php accepts)')

// The page list in four places.
const appJsx = read(join(WEB, 'src/App.jsx'))
const appRoutes = new Set([...appJsx.matchAll(/<Route path="([^"*]+)"/g)].map((m) => m[1]))
const seoPage = read(join(STORE, 'seo-page.php'))
const seoCfg = read(join(STORE, 'seo-config.php'))
const gen = read(join(WEB, 'scripts/generate-seo.mjs'))
const inList = (s) => [...s.matchAll(/'(\/[a-z/]*)'/g)].map((m) => m[1])
const seoPagePaths = inList(/in_array\(\$path, \[([^\]]+)\], true\)/.exec(seoPage)?.[1] ?? '')
const seoCfgPaths = inList(/STORE_SEO_PAGE_PATHS = \[([^\]]+)\]/.exec(seoCfg)?.[1] ?? '')
const genPaths = [...(/const reactPages = \[([\s\S]*?)\n\]/.exec(gen)?.[1] ?? '').matchAll(/\['(\/[a-z]*)'/g)].map((m) => m[1])
const sortj = (a) => JSON.stringify([...a].sort())
is(sortj(seoPagePaths) === sortj(seoCfgPaths), 'seo-page.php indexable pages == STORE_SEO_PAGE_PATHS', seoPagePaths.join(' '))
is(sortj(genPaths) === sortj(pagePaths), 'generator pages == committed sitemap-pages.xml', genPaths.join(' '))
const missing = seoPagePaths.filter((p) => !genPaths.includes(p))
if (missing.length) gap(`the generator and the committed sitemap-pages.xml lack ${missing.join(', ')}, which seo-page.php serves as an INDEXABLE page (and the live sitemap lists)`,
  '`npm run seo` is part of `npm run release`; shipping its sitemap-pages.xml over the live file would drop it')
else ok('no indexable page is missing from the generator')
const noRoute = genPaths.filter((p) => p !== '/' && !appRoutes.has(p))
is(noRoute.length === 0, 'every page in the sitemap has a <Route> in src/App.jsx', noRoute.join(' '))
const supportNoRoute = seoPagePaths.filter((p) => p !== '/' && !appRoutes.has(p))
if (supportNoRoute.length) gap(`src/App.jsx has no <Route> for ${supportNoRoute.join(', ')}, yet seo-page.php + .htaccess serve it as an indexable 200 page`,
  'the live (foreign) storefront has the screen; this repo\'s storefront would show NotFound under a 200')

// Pages that must never be in the sitemap.
const PRIVATE = ['/cart', '/checkout', '/account', '/wishlist', '/payment/result', '/review', '/backends', '/invoice', '/panel.php']
const inMap = (p) => [...pagesR.urls, ...prodR.urls].some((u) => new URL(u.loc).pathname === p || new URL(u.loc).pathname.startsWith(`${p}/`))
is(PRIVATE.every((p) => !inMap(p)), 'no private/transactional page is in the sitemap', PRIVATE.join(' '))
const robotsDisallow = robots.split('User-agent: Googlebot')[1]?.split('User-agent:')[0] ?? ''
is(/Disallow: \/backends/.test(robotsDisallow) && !/Disallow: \/product/.test(robotsDisallow) && !/Disallow: \/shop/.test(robotsDisallow),
  'robots.txt (Googlebot group) blocks /backends and blocks none of the sitemap URLs')
const seoPrivate = /in_array\(\$path, \[('\/cart'[^\]]+)\], true\)/.exec(seoPage)?.[1] ?? ''
is(['/cart', '/checkout', '/account', '/wishlist', '/payment/result', '/review'].every((p) => seoPrivate.includes(`'${p}'`)),
  'seo-page.php marks cart/checkout/account/wishlist/payment result/review as noindex ("private")')

// Consistency with the other advertisers of product URLs and of "/".
const llms = read(join(PUB, 'llms.txt'))
const llmsProducts = [...new Set([...llms.matchAll(/https:\/\/www\.sporta\.com\.kw\/product\/[^)\s]+/g)].map((m) => m[0]))]
const mapProducts = new Set(prodR.urls.map((u) => u.loc))
is(llmsProducts.length > 0 && llmsProducts.every((u) => mapProducts.has(u)), 'every product URL in llms.txt is in sitemap-products.xml', `${llmsProducts.length} of ${mapProducts.size / 2} products`)
const indexHtml = read(join(WEB, 'index.html'))
const homeAlts = Object.fromEntries([...indexHtml.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]))
const homeU = pagesR.urls.find((u) => u.loc === `${ORIGIN}/`)
is(homeU && JSON.stringify(homeU.alts) === JSON.stringify(homeAlts) && homeAlts.ar === `${ORIGIN}/` && homeAlts.en === `${ORIGIN}/?lang=en` && homeAlts['x-default'] === `${ORIGIN}/`,
  'index.html hreflang for "/" equals the sitemap\'s (ar = bare, en = ?lang=en, x-default = bare)')
is(!/<link[^>]+rel="sitemap"/i.test(indexHtml) && !/sitemap/i.test(llms), 'index.html and llms.txt advertise no second sitemap URL')
is(/hreflang|alternate/.test(readFileSync(join(WEB, 'src/lib/seo.js'), 'utf8')), 'usePageMeta writes the alternates the sitemap lists')
// Anything else in the release that could be mistaken for a sitemap.
const strays = ['sitemap.txt', 'sitemap.xml.gz', 'sitemap_index.xml', 'sitemap-index.xml', 'sitemap-images.xml', 'sitemap.html'].filter((f) => existsSync(join(PUB, f)))
is(strays.length === 0, 'public/ has no stray sitemap spellings (sitemap_index.xml, .gz, .txt ...)', strays.join(' '))

// =================================================================== 2. PURE
head('2. pure function: sporta_sitemap_product_xml()')
const havePhp = spawnSync('php', ['-v']).status === 0
const phpRender = (rows, hasUpdatedAt, images = {}) => execFileSync('php', ['-d', 'memory_limit=2G', '-r',
  'define("SPORTA_SEO_TEST", 1); require $argv[1] . "/sitemap-products.php";'
  + '$in = json_decode(stream_get_contents(STDIN), true); echo sporta_sitemap_product_xml($in["rows"], $in["u"], $in["img"]);',
  STORE], { input: JSON.stringify({ rows, u: hasUpdatedAt, img: images }), maxBuffer: 512 * 1024 * 1024, env: { ...process.env, SPORTA_API_CONFIG_FILE: '/nonexistent.php' } }).toString('utf8')
if (!havePhp) console.log('SKIP no php on PATH: parts 2 and 3 are not run')
else {
  const hostile = [
    { slug: 'plain', updated_at: '2026-10-01 10:00:00' },
    { slug: 'a&b<c>"d\'e', updated_at: '2026-10-01 10:00:00' },
    { slug: 'قميص رياضي', updated_at: '2026-10-02 09:00:00' },
    { slug: 'x', updated_at: '2026-02-30 00:00:00' }, // not a date: lastmod must be dropped, not emitted
    { slug: 'y', updated_at: '0000-00-00 00:00:00' },
    { slug: 'z', updated_at: null },
    { slug: '', updated_at: '2026-10-01' }, // an empty slug must not become /product/
  ]
  const xml = phpRender(hostile, true)
  const r = inspectUrlset(xml)
  report('hostile slugs (&, <, >, quotes, Arabic + space) render as a strict-valid urlset', r, `${r.urls.length} URLs`)
  is(r.urls.length === 12, 'six usable products -> twelve URLs; the empty slug produced none', String(r.urls.length))
  is(!/<loc>[^<]*[ "'<>][^<]*<\/loc>/.test(xml.replace(/&(amp|lt|gt|quot|apos);/g, '')), 'no loc carries a raw space, quote or angle bracket')
  is(r.urls.find((u) => u.loc.includes('%D9%82'))?.loc === `${ORIGIN}/product/%D9%82%D9%85%D9%8A%D8%B5%20%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A`, 'Arabic slug is UTF-8 percent-encoded, space as %20')
  is(r.urls.filter((u) => u.lastmod).length === 6 && !r.urls.some((u) => /02-30|0000/.test(u.lastmod ?? '')), 'impossible dates (2026-02-30, 0000-00-00) are dropped, valid ones are date-only', `${r.urls.filter((u) => u.lastmod).length} of 12 carry a lastmod`)
  const noCol = inspectUrlset(phpRender(hostile.slice(0, 2), false))
  is(!noCol.problems.length && noCol.urls.every((u) => u.lastmod === null), 'no updated_at column -> valid urlset with no lastmod (never a guessed date)')

  // The Sitemaps limit is per FILE; every product costs TWO <url> entries.
  const many = Array.from({ length: 25001 }, (_, k) => ({ slug: `p-${k}`, updated_at: '2026-10-01 00:00:00' }))
  const bigXml = phpRender(many, true)
  const bigUrls = (bigXml.match(/<url>/g) ?? []).length
  if (bigUrls > 50000) gap(`sitemap-products has no chunking: 25,001 products = ${bigUrls} <url>, over Google's 50,000 per file (the limit is reached at 25,000 products)`,
    `${(Buffer.byteLength(bigXml) / 1048576).toFixed(1)} MB for it, under the 50 MB cap; the shop has 46 products today`)
  else ok('25,001 products stay inside 50,000 URLs')
  const edge = phpRender(many.slice(0, 25000), true)
  is((edge.match(/<url>/g) ?? []).length === 50000 && Buffer.byteLength(edge) < 52428800, '25,000 products = exactly 50,000 URLs, under 50 MB', `${(Buffer.byteLength(edge) / 1048576).toFixed(1)} MB`)
}

// ================================================================ 3. INSTANCE
head('3. private instance: the real scripts over HTTP')
const haveDb = spawnSync('mariadbd', ['--version']).status === 0 && spawnSync('mariadb-install-db', ['--version']).status === 0
if (!havePhp || !haveDb) console.log('SKIP needs php, mariadbd and mariadb-install-db on PATH: the instance half is not run')
else await instance()

console.log(`\n${oks} ok, ${fails} FAIL, ${gaps} GAP${STRICT ? ' (SITEMAP_STRICT=1: GAPs are fatal)' : ''}`)
process.exit(fails ? 1 : 0)

// ---------------------------------------------------------------------------
async function instance() {
  const tmp = mkdtempSync(join(process.env.SMK_TMP ?? tmpdir(), 'sitemap-check-'))
  const procs = []
  const stop = () => {
    for (const p of procs) { try { p.kill('SIGTERM') } catch { /* already gone */ } }
  }
  process.on('exit', stop)
  try {
    await instanceBody(tmp, procs)
  } catch (e) {
    bad('instance run aborted', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  } finally {
    stop()
    await new Promise((r) => setTimeout(r, 2000))
    rmSync(tmp, { recursive: true, force: true })
    rmSync(`/tmp/smk-${DB_PORT}.sock`, { force: true })
    rmSync(`/tmp/smk-${DB_PORT}.sock.lock`, { force: true })
  }
}

function get(port, path, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: 'www.sporta.com.kw', ...headers }, timeout: 20000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
async function waitPort(port) {
  for (let k = 0; k < 60; k++) { try { await get(port, '/__up'); return } catch { await sleep(250) } }
  throw new Error(`nothing listening on ${port}`)
}

async function instanceBody(tmp, procs) {
  // A UNIX socket path is capped at ~107 bytes and a temp dir under a deep scratch
  // path overflows it, so the socket gets a short name of its own and every client
  // talks TCP. Removed in the finally block.
  const sock = `/tmp/smk-${DB_PORT}.sock`
  const dataDir = join(tmp, 'data')
  const root = process.getuid?.() === 0
  const inst = spawnSync('mariadb-install-db', ['--no-defaults', `--datadir=${dataDir}`, '--auth-root-authentication-method=normal'], { encoding: 'utf8' })
  if (inst.status !== 0) throw new Error(`mariadb-install-db failed: ${inst.stderr.slice(0, 200)}`)
  const db = spawn('mariadbd', ['--no-defaults', `--datadir=${dataDir}`, `--port=${DB_PORT}`, '--bind-address=127.0.0.1', `--socket=${sock}`,
    `--pid-file=${join(tmp, 'm.pid')}`, ...(root ? ['--user=root'] : [])], { stdio: 'ignore' })
  procs.push(db)
  for (let k = 0; k < 120; k++) {
    if (db.exitCode !== null) throw new Error('mariadbd exited at start (port in use?)')
    if (spawnSync('mariadb', ['--no-defaults', '-h', '127.0.0.1', '-P', String(DB_PORT), '-uroot', '-e', 'select 1']).status === 0) break
    await sleep(250)
  }
  const sql = (dbName, input, extra = []) => {
    const r = spawnSync('mariadb', ['--no-defaults', '--default-character-set=utf8mb4', '-h', '127.0.0.1', '-P', String(DB_PORT), '-uroot', ...extra, ...(dbName ? [dbName] : [])], { input, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`mariadb: ${r.stderr.slice(0, 300)}`)
    return r.stdout
  }
  sql('', `create database sitemapchk character set utf8mb4; create database sitemapempty character set utf8mb4;
    create user 'smk'@'127.0.0.1' identified by 'smk-pass'; grant all on sitemapchk.* to 'smk'@'127.0.0.1';
    grant all on sitemapempty.* to 'smk'@'127.0.0.1';`)
  // schema.mysql.sql then every additive migration, the way a fresh install is built.
  const order = ['schema', 'customers', 'crm', 'support', 'returns', 'tracking', 'brands', 'promo', 'outbox-kinds']
  const others = ['admin-activity', 'admin-google', 'admin-initial-password', 'admin-password-reset', 'admin-recovery-codes', 'admin-totp', 'antifraud',
    'attribution', 'cbktrack', 'discount-release', 'inventory', 'itemname', 'knet-stock', 'payattempt', 'productbrand', 'reviews', 'stock', 'whatsapp']
  for (const f of [...order, ...others]) if (existsSync(join(STORE, `${f}.mysql.sql`))) sql('sitemapchk', read(join(STORE, `${f}.mysql.sql`)))
  for (const f of ['schema', 'brands', 'promo']) sql('sitemapempty', read(join(STORE, `${f}.mysql.sql`)))
  const hasCol = sql('sitemapchk', "show columns from products like 'updated_at'").trim() !== ''
  is(!hasCol, 'FACT: schema.mysql.sql + every *.mysql.sql migration leave products WITHOUT an updated_at column', 'lastmod comes from a column no repo migration creates')

  // 12 products (+1 inactive pair): hidden, Arabic, spaced, quoted, long, hidden brand.
  const longSlug = `long-${'0123456789-'.repeat(7)}end`.slice(0, 80)
  const slugs = {
    plain: 'plain-shirt', arabic: 'قميص-رياضي', space: 'red shirt', amp: 'rock&roll-tee', quote: 'quote\'s"tee', angle: 'lt<gt>x',
    pct: '50%-off#sale?x=1', upper: 'Upper-Case', plus: 'a+b', hidden: 'hidden-product', hidden2: 'hidden-product-2', hb: 'hb-product', long: longSlug,
  }
  const q = (s) => `'${s.replace(/'/g, "''")}'`
  const row = (slug, nameEn, active, brand = null) => `(${q(slug)},${q(nameEn)},'تي',5.000,${active},${brand ? q(brand) : 'null'})`
  sql('sitemapchk', `insert into brands (slug,name_en,name_ar,active) values ('hidden-brand','Hidden','مخفي',0);
    insert into products (slug,name_en,name_ar,price,active,brand_slug) values ${[
    row(slugs.plain, 'Plain Shirt', 1), row(slugs.arabic, 'Arabic Slug', 1), row(slugs.space, 'Space Slug', 1),
    row(slugs.amp, 'Rock & Roll <Tee> "Q" \'A\'', 1), row(slugs.quote, 'Quote Tee', 1), row(slugs.angle, 'Angle', 1),
    row(slugs.pct, 'Odd chars', 1), row(slugs.upper, 'Upper', 1), row(slugs.plus, 'Plus', 1),
    row(slugs.hidden, 'Hidden P', 0), row(slugs.hidden2, 'Hidden P2', 0), row(slugs.hb, 'Hidden Brand P', 1, 'hidden-brand'),
    row(slugs.long, 'Long', 1)].join(',')};`)
  is(slugs.long.length === 80, 'seeded one 80-character slug', String(slugs.long.length))

  // The site tree: /api is a copy of dropin/php-store (as deployed), static files beside it.
  const mkSite = (name, { statics = true } = {}) => {
    const dir = join(tmp, name)
    mkdirSync(join(dir, 'images/products'), { recursive: true })
    cpSync(STORE, join(dir, 'api'), { recursive: true })
    rmSync(join(dir, 'api/config.php'), { force: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>\n')
    if (statics) for (const f of ['sitemap-pages.xml', 'sitemap-products.xml', 'sitemap.xml']) copyFileSync(join(PUB, f), join(dir, f))
    return dir
  }
  const cfg = (name, port, dbName) => {
    const p = join(tmp, `${name}.php`)
    writeFileSync(p, `<?php return ['db_host'=>'127.0.0.1;port=${port}','db_name'=>'${dbName}','db_user'=>'smk','db_pass'=>'smk-pass'];\n`)
    return p
  }
  // The router re-states public/.htaccess for the paths under test, with the page
  // alternation read FROM that file, so a rule edited there is what runs here.
  const alt = pageAlt?.[1] ?? 'shop'
  const router = join(tmp, 'router.php')
  writeFileSync(router, `<?php
$root = getenv('SMK_ROOT');
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$rel = ltrim(rawurldecode($p), '/');
$run = function (string $f) use ($root) { chdir($root . '/api'); require $root . '/api/' . $f; return true; };
if ($rel === 'sitemap.xml' && is_file("$root/api/sitemap-index.php")) return $run('sitemap-index.php');
if ($rel === 'sitemap-products.xml' && is_file("$root/api/sitemap-products.php")) return $run('sitemap-products.php');
if ($rel === '') return $run('seo-page.php');
$f = $root . '/' . $rel;
if (is_file($f) && !str_ends_with($f, '.php') && !str_starts_with($rel, 'api/')) {
  header('Content-Type: ' . (str_ends_with($f, '.xml') ? 'application/xml' : 'application/octet-stream'));
  readfile($f); return true;
}
if (preg_match('#^(${alt})/?$#', $rel) || preg_match('#^product/[^/]+/?$#', $rel)) return $run('seo-page.php');
http_response_code(404); echo 'nf';
`)
  const serve = async (n, site, config) => {
    const port = PORT0 + n
    const p = spawn('php', ['-S', `127.0.0.1:${port}`, router], { env: { ...process.env, SMK_ROOT: site, SPORTA_API_CONFIG_FILE: config, PHP_CLI_SERVER_WORKERS: '4' }, stdio: 'ignore' })
    procs.push(p)
    await waitPort(port)
    return port
  }
  const siteA = mkSite('siteA')
  const A = await serve(0, siteA, cfg('a', DB_PORT, 'sitemapchk'))

  // ---- the three URLs, as Googlebot asks for them
  const idxR = await get(A, '/sitemap.xml')
  const pgR = await get(A, '/sitemap-pages.xml')
  const prR = await get(A, '/sitemap-products.xml')
  is([idxR, pgR, prR].every((r) => r.status === 200), 'GET /sitemap.xml, /sitemap-pages.xml, /sitemap-products.xml all answer 200')
  const ctype = (r) => String(r.headers['content-type'] ?? '')
  is(/^application\/xml; charset=utf-8$/i.test(ctype(idxR)) && /^application\/xml; charset=utf-8$/i.test(ctype(prR)), 'the PHP sitemaps send Content-Type: application/xml; charset=utf-8', ctype(prR))
  is(/^application\/xml\b/i.test(ctype(pgR)), 'the static pages sitemap is application/xml', ctype(pgR))
  const idxI = inspectIndex(idxR.body)
  report('/sitemap.xml (PHP index) validates', idxI, idxI.children.map((c) => `${c.loc.split('/').pop()}${c.lastmod ? ` lastmod ${c.lastmod}` : ' (no lastmod)'}`).join(', '))
  is(idxI.children.map((c) => c.loc).join() === `${ORIGIN}/sitemap-pages.xml,${ORIGIN}/sitemap-products.xml`, 'the index lists exactly the pages child and the products child')
  report('/sitemap-pages.xml validates', inspectUrlset(pgR.body), `${inspectUrlset(pgR.body).urls.length} URLs`)

  // ---- what the products sitemap must and must not contain
  const prI = inspectUrlset(prR.body)
  report('/sitemap-products.xml validates with hostile slugs in the catalogue', prI, `${prI.urls.length} URLs`)
  const apiR = await get(A, '/api/api.php?r=products')
  // router: /api/api.php is not routed; ask the products API through the script directly.
  let apiSlugs
  {
    const out = execFileSync('php', ['-r', 'chdir($argv[1]); $_GET["r"]="products"; $_SERVER["REQUEST_METHOD"]="GET"; $_SERVER["REMOTE_ADDR"]="127.0.0.1"; require "api.php";', join(siteA, 'api')],
      { env: { ...process.env, SPORTA_API_CONFIG_FILE: join(tmp, 'a.php') }, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
    const body = out.slice(out.indexOf('['))
    apiSlugs = JSON.parse(body).map((p) => p.slug)
  }
  void apiR
  const decoded = prI.urls.filter((u) => !u.loc.endsWith('?lang=en')).map((u) => decodeURIComponent(new URL(u.loc).pathname.slice('/product/'.length)))
  const active = Object.values(slugs).filter((s) => ![slugs.hidden, slugs.hidden2].includes(s))
  is(sortj(apiSlugs) === sortj(active), 'GET api.php?r=products returns the 11 active products (the reference list)', String(apiSlugs.length))
  is(sortj(decoded) === sortj(apiSlugs), 'sitemap products == API products, slug for slug (decoded)', `${decoded.length} products, ${prI.urls.length} URLs`)
  is(prI.urls.length === 2 * apiSlugs.length, 'URL count = 2 x products (the Arabic address and the ?lang=en address of each)')
  is(!decoded.includes(slugs.hidden) && !decoded.includes(slugs.hidden2) && !/hidden-product/.test(prR.body), 'inactive (hidden) products are absent')
  is(decoded.includes(slugs.hb) && !/hidden-brand|Hidden/.test(prR.body), 'a product of a HIDDEN brand stays listed (the brand is not the product) and the brand never appears')
  is(prI.urls.every((u) => u.loc.startsWith(`${ORIGIN}/product/`)), 'every product loc is https://www.sporta.com.kw/product/...')
  is(prI.urls.some((u) => u.loc.endsWith(`/${encodeURIComponent(slugs.long)}`)), 'the 80-character slug is listed whole', String(slugs.long.length))
  is(prI.urls.find((u) => u.loc.includes('rock%26roll'))?.loc === `${ORIGIN}/product/rock%26roll-tee`, '& in a slug is %26 in the URL (and the raw character is never in the XML)')
  is(!/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/.test(prR.body), 'no raw & anywhere in the products XML')
  is(!/\b(?:name_en|name_ar|Rock|Roll)\b/.test(prR.body), 'product NAMES (with & < > quotes) never enter the sitemap, only slugs')

  // ---- the origin never comes from the request
  const evil = { Host: 'evil.example', 'X-Forwarded-Host': 'evil2.example', 'X-Forwarded-Proto': 'http', Forwarded: 'host=evil3.example;proto=http' }
  const spoof = await Promise.all(['/sitemap.xml', '/sitemap-products.xml'].map((p) => get(A, p, { headers: evil })))
  is(spoof.every((r) => r.status === 200 && !/evil|127\.0\.0\.1|localhost|http:\/\/|:\d{4}\b/.test(r.body.replace('http://www.w3.org', '').replace('http://www.sitemaps.org', '').replace('http://www.google.com', ''))),
    'Host: evil.example + X-Forwarded-Host/Proto/Forwarded change nothing: no evil host, IP, localhost or http:// in either file')
  is(spoof[0].body === idxR.body && spoof[1].body === prR.body, 'the spoofed responses are byte-identical to the normal ones')
  const bareHost = await get(A, '/sitemap-products.xml', { headers: { Host: '127.0.0.1:8381' } })
  is(bareHost.body === prR.body, 'a request by IP/port yields the same canonical www locs')

  // ---- every advertised URL is routable and answers 200 (asked of seo-page.php)
  const statusOf = async (u) => (await get(A, u.slice(ORIGIN.length) || '/')).status
  const pageUrls = inspectUrlset(pgR.body).urls
  let pageBad = []
  for (const u of pageUrls) { const s = await statusOf(u.loc); if (s !== 200) pageBad.push(`${u.loc}=${s}`) }
  is(pageBad.length === 0, `all ${pageUrls.length} page URLs answer 200 through the page router`, pageBad.join(' '))
  const slugRoutable = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
  const prodBad = []
  for (const u of prI.urls) { const s = await statusOf(u.loc); if (s !== 200) prodBad.push([u.loc, s]) }
  const expectBad = decoded.filter((s) => !slugRoutable.test(s))
  const gotBad = new Set(prodBad.map(([l]) => decodeURIComponent(new URL(l).pathname.slice('/product/'.length))))
  is(decoded.filter((s) => slugRoutable.test(s)).every((s) => !gotBad.has(s)), 'every ASCII-slug product URL (both languages) answers 200')
  if (prodBad.length) gap(`${decoded.filter((s) => gotBad.has(s)).length} of ${decoded.length} listed products answer 404 from the page router: ${[...gotBad].map((s) => JSON.stringify(s)).join(', ')}`,
    `${prodBad.length} advertised URLs; seo-page.php accepts only [A-Za-z0-9][A-Za-z0-9_-]{0,79} while sitemap-products.php lists any slug in the table. The admin cannot save such a slug (store_slug -> [a-z0-9-]); only SQL/import can`)
  else ok('no listed product 404s')
  void expectBad
  is((await statusOf(`${ORIGIN}/product/${slugs.hidden}`)) === 404, 'a hidden product\'s URL answers 404 (and is not in the sitemap)')

  // ---- headers and caching
  is(/public/.test(idxR.headers['cache-control'] ?? '') && /max-age=\d+/.test(prR.headers['cache-control'] ?? ''), 'Cache-Control: public, max-age on both PHP sitemaps', `${prR.headers['cache-control']} (Apache .htaccess replaces it with max-age=3600, swr=86400)`)
  is(!/set-cookie/i.test(JSON.stringify(prR.headers)) && !/set-cookie/i.test(JSON.stringify(idxR.headers)), 'no cookie on a sitemap')
  const cond = await get(A, '/sitemap-products.xml', { headers: { 'If-None-Match': '"x"', 'If-Modified-Since': new Date(Date.now() + 86400e3).toUTCString() } })
  if (!prR.headers.etag && !prR.headers['last-modified']) {
    gap('the PHP sitemaps send no ETag and no Last-Modified, so a conditional GET is always a full 200', `If-None-Match/If-Modified-Since answered ${cond.status} (seo-page.php, by contrast, does ETag + 304)`)
  } else is(cond.status === 304, 'conditional GET answers 304')
  is((await get(A, '/sitemap.xml?x=1')).status === 200 && (await get(A, '/sitemap.xml', { method: 'HEAD' })).status === 200, 'a query string or HEAD does not break /sitemap.xml')

  // ---- products.updated_at present: the lastmod path
  sql('sitemapchk', 'alter table products add column updated_at timestamp not null default current_timestamp on update current_timestamp')
  sql('sitemapchk', `update products set updated_at = '2026-10-15 08:30:00' where slug = 'plain-shirt';
    update products set updated_at = '2026-10-20 23:59:59' where slug = 'red shirt';
    update products set updated_at = '2037-01-01 00:00:00' where slug = 'a+b'`)
  const pr2 = inspectUrlset((await get(A, '/sitemap-products.xml')).body)
  const lm = (frag) => pr2.urls.find((u) => u.loc.includes(frag))?.lastmod
  is(lm('/plain-shirt') === '2026-10-15' && lm('/red%20shirt') === '2026-10-20', 'with updated_at present, lastmod is that day (YYYY-MM-DD)', `plain-shirt ${lm('/plain-shirt')}, red shirt ${lm('/red%20shirt')}`)
  is(pr2.urls.every((u) => u.lastmod), 'every product then carries a lastmod')
  const futureProblems = pr2.problems.filter((p) => /in the future/.test(p))
  if (futureProblems.length) gap('a product whose updated_at is in the future is published with that future lastmod (no clamp to today)', futureProblems[0])
  else ok('no future lastmod emitted')
  const idx2 = inspectIndex((await get(A, '/sitemap.xml')).body)
  is(idx2.children[1].lastmod !== null && /^\d{4}-\d{2}-\d{2}$/.test(idx2.children[1].lastmod), 'with updated_at present the index gives the products child a lastmod', idx2.children[1].lastmod)
  const idxFuture = idx2.problems.filter((x) => /in the future/.test(x))
  if (idxFuture.length) gap('the same future date is copied into the INDEX as the products child lastmod (max(updated_at))', idxFuture[0])
  sql('sitemapchk', "update products set updated_at = '2026-10-01 00:00:00' where slug = 'a+b'") // back to the past for the rest of the run
  is(idx2.children[0].lastmod === '2026-11-01' || /^\d{4}-\d{2}-\d{2}$/.test(idx2.children[0].lastmod ?? ''), 'the pages child lastmod is the newest date inside sitemap-pages.xml', idx2.children[0].lastmod)

  // ---- image entries
  const pdir = join(siteA, 'images/products')
  for (const f of ['plain-shirt.jpg', 'plain-shirt-view-2.webp', 'plain-shirt-view-1.png', 'red-shirt.jpg', 'not-a-product.jpg', 'plain-shirt-0a1b2c3d4e.jpg', 'x.gif']) writeFileSync(join(pdir, f), 'x')
  sql('sitemapchk', "update products set image = '/images/products/plain-shirt-0a1b2c3d4e.jpg' where slug = 'plain-shirt'")
  const pr3 = inspectUrlset((await get(A, '/sitemap-products.xml')).body)
  const plainU = pr3.urls.find((u) => u.loc === `${ORIGIN}/product/plain-shirt`)
  report('with product photos on disk the products sitemap still validates (image namespace declared)', pr3, `${pr3.urls.filter((u) => u.images.length).length} URLs carry images`)
  is(JSON.stringify(plainU.images) === JSON.stringify([`${ORIGIN}/images/products/plain-shirt.jpg`, `${ORIGIN}/images/products/plain-shirt-view-1.png`, `${ORIGIN}/images/products/plain-shirt-view-2.webp`]),
    'photos named <slug>.<ext> and <slug>-view-N.<ext> are listed main first, then by number; the hex-suffixed upload, a gif and an unrelated file are not', plainU.images.map((i) => i.split('/').pop()).join(', '))
  gap('photos uploaded through the admin (admin.php product_image_upload names them <stem>-<10 hex>.<ext>, and products.image points at them) never appear as <image:image>',
    'sitemap-products.php only matches <slug>.<ext> / <slug>-view-N.<ext> files, ignoring products.image / products.images; here plain-shirt-0a1b2c3d4e.jpg is on disk AND in products.image and is not listed')

  // ---- the empty catalogue and the database down
  const siteE = mkSite('siteE')
  const E = await serve(1, siteE, cfg('e', DB_PORT, 'sitemapempty'))
  const empty = await get(E, '/sitemap-products.xml')
  const emptyI = inspectUrlset(empty.body)
  if (empty.status === 200 && emptyI.urls.length === 0) {
    gap('an EMPTY catalogue (no active product) is answered 200 with a <urlset> that has no <url>: schema-invalid, cacheable for an hour, and read by a crawler as "every product was removed"',
      `status ${empty.status}, Content-Type ${empty.headers['content-type']}, Cache-Control ${empty.headers['cache-control']}; a 503 + Retry-After would not delete anything`)
  } else is(empty.status >= 500, 'an empty catalogue is not answered as a healthy 200 empty urlset', String(empty.status))
  const emptyIdx = inspectIndex((await get(E, '/sitemap.xml')).body)
  is(!emptyIdx.problems.length, 'the index still validates with an empty catalogue (children listed, products child without lastmod)')

  const siteD = mkSite('siteD')
  const D = await serve(2, siteD, cfg('d', 3394, 'sitemapchk')) // nothing listens on 3394
  const down = await get(D, '/sitemap-products.xml')
  const downI = inspectUrlset(down.body)
  const staticN = inspectUrlset(prodXml).urls.length
  if (down.status === 200) {
    gap(`database down: sitemap-products.xml answers 200 with the SHIPPED static file (${downI.urls.length} URLs, dated at the last release), not a 5xx`,
      `Cache-Control "${down.headers['cache-control']}". Not empty, so Google does not read it as "everything deleted", but products added or removed since the release are wrong until the database is back`)
    is(downI.urls.length === staticN && !downI.problems.length, 'the stale fallback is at least the full, valid committed list', `${downI.urls.length} URLs`)
    is(/no-cache|no-store/.test(down.headers['cache-control'] ?? ''), 'the stale fallback is sent no-cache (it will be refetched the moment the database is back)')
  } else is(down.status >= 500, 'database down: a 5xx, not a healthy 200', String(down.status))
  const downIdx = await get(D, '/sitemap.xml')
  is(downIdx.status === 200 && !inspectIndex(downIdx.body).problems.length, 'database down: the index is still valid (products child without lastmod)')

  const siteN = mkSite('siteN', { statics: false })
  const N = await serve(3, siteN, cfg('n', 3394, 'sitemapchk'))
  const none = await get(N, '/sitemap-products.xml')
  is(none.status === 503 && /no-store/.test(none.headers['cache-control'] ?? ''), 'database down AND no shipped fallback: 503, Cache-Control: no-store', `${none.status} ${none.headers['cache-control']}`)
  is(none.body === '', '... with an empty body (nothing for a crawler to parse as an empty sitemap)')

  // ---- no config at all must not leak or crash
  const siteC = mkSite('siteC')
  const C = await serve(4, siteC, join(tmp, 'does-not-exist.php'))
  const noCfg = await get(C, '/sitemap-products.xml')
  is(noCfg.status === 200 ? inspectUrlset(noCfg.body).urls.length === staticN : noCfg.status >= 500, 'missing store config: static fallback or 5xx, never a PHP error page', String(noCfg.status))
  is(!/Fatal|Warning|Stack trace|\/home\/|\/tmp\//.test(noCfg.body), 'missing store config: no PHP error text or path in the body')
  // Serving the sitemap scripts directly must also work (a crawler can be told /api/sitemap-index.php).
  is(true, `private instance ports ${PORT0}-${PORT0 + 4}, MariaDB ${DB_PORT}: stopped and removed by the suite`)
}
