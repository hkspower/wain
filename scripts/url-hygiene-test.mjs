/**
 * test:url-hygiene — one address per page, and the panel never asks to be indexed (2026-10-15).
 *   A  a product address typed in another case names the stored lower-case address in its
 *      canonical, its hreflang pair and og:url (the case-insensitive match had made it a second,
 *      self-canonical copy of every product page)
 *   B  /backends carries no canonical, no hreflang and a noindex robots meta, agreeing with its header
 * Run `bash scripts/sandbox.sh` first. Reads only.
 */
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const slug = execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B', '-e', 'select slug from products where active = 1 order by id limit 1'], { encoding: 'utf8' }).trim()
const html = async (p) => (await fetch(BASE + p)).text()

for (const [lang, q] of [['ar', ''], ['en', '?lang=en']]) {
  const h = await html(`/product/${slug.toUpperCase()}${q}`)
  const want = `https://www.sporta.com.kw/product/${slug}${q}`
  const canon = (h.match(/<link rel="canonical" href="([^"]+)"/) || [])[1]
  const og = (h.match(/<meta property="og:url" content="([^"]+)"/) || [])[1]
  const alt = [...h.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)].map((m) => m[1])
  check(canon === want, `A ${lang}: an upper-case product address names the lower-case one as canonical`, canon)
  check(og === want, `A ${lang}: og:url is the lower-case address`, og)
  check(alt.length === 3 && alt.every((u) => u.includes(`/product/${slug}`)), `A ${lang}: the hreflang links name the lower-case address`, alt.join(' '))
}
const b = await html('/backends')
check(!/rel="canonical"/.test(b), 'B /backends has no canonical')
check(!/hreflang=/.test(b), 'B /backends has no hreflang links')
check(/<meta name="robots" content="noindex, nofollow"/.test(b) && !/index, follow/.test(b), 'B /backends says noindex in its HTML too')
const home = await html('/')
check(/rel="canonical" href="https:\/\/www\.sporta\.com\.kw\/"/.test(home) && /index, follow/.test(home), 'B the home page still carries its own canonical and index tag')
console.log(fails ? `\n${fails} FAILED` : '\nall url-hygiene checks passed')
process.exitCode = fails ? 1 : 0
