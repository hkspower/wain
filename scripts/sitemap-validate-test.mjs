/**
 * test:sitemap-validate — what Google gets from the sitemaps (2026-10-15, "fix all sitemap issue").
 * Follows sitemap.xml to every child sitemap and asks EVERY listed address, without JavaScript:
 *   it answers 200 (no redirect), is not noindex, its canonical is itself, its hreflang links are
 *   the ones the sitemap gives, its lastmod is a real past date, no address is listed twice, every
 *   image:loc answers 200 — and every indexable page of the shop IS listed (a page Google can only
 *   find by following links is a page the sitemap failed). Run `bash scripts/sandbox.sh` first.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SITE = 'https://www.sporta.com.kw'
const local = (u) => u.replace(SITE, BASE)
const get = async (u) => { const r = await fetch(local(u), { redirect: 'manual' }); return { s: r.status, t: await r.text(), ct: r.headers.get('content-type'), loc: r.headers.get('location') } }
const issues = []; const note = (x) => issues.push(x)
const idx = await get(SITE + '/sitemap.xml')
const children = [...idx.t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
console.log('index', idx.s, children)
const all = []
for (const c of children) {
  const r = await get(c)
  const locs = [...r.t.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({ loc: (m[1].match(/<loc>([^<]+)</) || [])[1], lastmod: (m[1].match(/<lastmod>([^<]+)</) || [])[1], alts: [...m[1].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((a) => [a[1], a[2]]), imgs: [...m[1].matchAll(/<image:loc>([^<]+)</g)].map((a) => a[1]) }))
  console.log(c, r.s, r.ct, 'urls=' + locs.length, 'bytes=' + r.t.length)
  if (r.s !== 200) note(`${c} answers ${r.s}`)
  if (!/^<\?xml/.test(r.t.trim())) note(`${c} is not XML`)
  for (const l of locs) { l.file = c.split('/').pop(); all.push(l) }
}
const seen = new Map()
for (const l of all) { if (seen.has(l.loc)) note(`duplicate loc ${l.loc} in ${l.file} and ${seen.get(l.loc)}`); seen.set(l.loc, l.file) }
const now = Date.now()
let checked = 0
for (const l of all) {
  if (l.lastmod && (isNaN(Date.parse(l.lastmod)) || Date.parse(l.lastmod) > now + 86400000)) note(`bad lastmod ${l.lastmod} ${l.loc}`)
  if (!l.lastmod) note(`no lastmod ${l.loc} (${l.file})`)
  const r = await get(l.loc); checked++
  if (r.s !== 200) { note(`${r.s} ${l.loc}${r.loc ? ' -> ' + r.loc : ''}`); continue }
  const canon = (r.t.match(/<link rel="canonical" href="([^"]+)"/) || [])[1]
  const robots = (r.t.match(/<meta name="robots" content="([^"]+)"/) || [])[1] || ''
  if (/noindex/.test(robots)) note(`noindex page in sitemap ${l.loc}`)
  if (canon && canon !== l.loc) note(`canonical differs ${l.loc} -> ${canon}`)
  if (!canon) note(`no canonical ${l.loc}`)
  const pageAlts = [...r.t.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((a) => a[1] + '=' + a[2]).sort().join(' ')
  const smAlts = l.alts.map((a) => a[0] + '=' + a[1]).sort().join(' ')
  if (smAlts && pageAlts !== smAlts) note(`hreflang differ ${l.loc}: page[${pageAlts}] sitemap[${smAlts}]`)
  for (const i of l.imgs) { const ir = await fetch(local(i)); if (ir.status !== 200) note(`image ${ir.status} ${i}`) }
}
// pages that exist but are not listed
for (const p of ['/', '/shop', '/men', '/women', '/accessories', '/outlet', '/about', '/contact', '/terms', '/privacy', '/returns', '/track']) {
  for (const q of ['', '?lang=en']) if (!seen.has(SITE + p + q)) { const r = await get(SITE + p + q); const rob = (r.t.match(/<meta name="robots" content="([^"]+)"/) || [])[1] || ''; if (r.s === 200 && !/noindex/.test(rob)) note(`indexable page missing from sitemap: ${p + q}`) }
}
console.log('checked', checked, 'urls')
for (const i of issues) console.log('FAIL ' + i)
if (checked < 50) { console.log('FAIL only ' + checked + ' addresses were checked — the sitemaps listed too few'); issues.push('few') }
console.log(issues.length ? `\n${issues.length} FAILED` : `\nall sitemap checks passed (${checked} addresses)`)
process.exitCode = issues.length ? 1 : 0
