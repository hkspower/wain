// A full sweep of the built site — every route, both languages, both themes,
// in a real browser against the real production layout (dist + /api on one
// origin, served by scripts/router-native.php).
//
// This is the check that catches what per-feature suites cannot: a page that
// throws only in Arabic, an image that 404s only on the shop grid, a route in
// App.jsx that nobody added to .htaccess and so 404s in production, a canonical
// tag pointing at the wrong spelling of the domain.
//
//   npm run scan
//   (needs MariaDB up and `php -S 127.0.0.1:8096 scripts/router-native.php`)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
const ORIGIN = 'https://www.sporta.com.kw'

let fails = 0
let warns = 0
const ok = (n, d = '') => console.log(`ok    ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL  ${n}${d ? `  — ${d}` : ''}`) }
const warn = (n, d = '') => { warns++; console.log(`warn  ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

// A real order to hang the invoice and tracking routes on, so those pages are
// scanned with content rather than with an empty state.
const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()
const track = await sql('select track_id from orders order by id desc limit 1')

const ROUTES = [
  ['/', 'home'],
  ['/shop', 'shop'],
  ['/product/cloudsoft-jacket-army-green', 'product'],
  ['/product/definitely-not-a-real-slug', 'product (unknown slug)'],
  ['/cart', 'cart'],
  ['/checkout', 'checkout'],
  ['/wishlist', 'wishlist'],
  ['/track', 'track'],
  ['/about', 'about'],
  ['/contact', 'contact'],
  ['/returns', 'returns'],
  ['/terms', 'terms'],
  ['/privacy', 'privacy'],
  ['/payment/result?status=success&trackid=' + track, 'payment result'],
  ...(track ? [[`/invoice/${track}`, 'invoice']] : []),
  ['/no-such-page-at-all', '404'],
]

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

// ---------------------------------------------------------------- the crawl
// Every route is loaded twice — English and Arabic — because half of this
// site's surface only exists in one direction, and an RTL-only crash would be
// invisible to an English-only sweep.
const seenLinks = new Set()
const KNOWN = /^\/(shop|cart|checkout|about|contact|wishlist|track|returns|terms|privacy|backends|product\/[^/]+|payment\/result|invoice\/[A-Za-z0-9]{1,30})?$/

for (const lang of ['en', 'ar']) {
  head(`routes — ${lang === 'ar' ? 'Arabic (RTL)' : 'English (LTR)'}`)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await ctx.addInitScript(`localStorage.setItem('lang', ${JSON.stringify(lang)})`)

  for (const [path, name] of ROUTES) {
    const page = await ctx.newPage()
    const errors = []
    const dead = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('response', (r) => {
      // The unknown-slug and 404 routes are meant to fail their data lookups.
      if (r.status() >= 400 && !/\/api\/api\.php/.test(r.url())) dead.push(`${r.status()} ${r.url()}`)
    })

    let loaded = true
    try {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 })
    } catch { loaded = false }
    await page.waitForTimeout(400)

    if (!loaded) { bad(`${name} loads`, path); await page.close(); continue }

    const info = await page.evaluate(() => {
      const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content ?? ''
      const link = (r) => document.querySelector(`link[rel="${r}"]`)?.href ?? ''
      const imgs = [...document.images]
      return {
        title: document.title,
        desc: meta('description'),
        robots: meta('robots'),
        canonical: link('canonical'),
        hreflang: [...document.querySelectorAll('link[rel="alternate"]')].map((l) => l.hreflang),
        htmlLang: document.documentElement.lang,
        htmlDir: document.documentElement.dir,
        h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).filter(Boolean),
        brokenImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src),
        // alt="" is CORRECT for a decorative image — it tells a screen reader to
        // skip it. What is wrong is no alt attribute at all.
        imgNoAlt: imgs.filter((i) => !i.hasAttribute('alt') && i.getAttribute('aria-hidden') !== 'true')
          .map((i) => (i.currentSrc || i.src).split('/').pop()),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
        links: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')),
        bodyText: document.body.innerText.trim().length,
      }
    })

    info.links.forEach((l) => seenLinks.add(l.split('?')[0].split('#')[0]))

    const problems = []
    if (errors.length) problems.push(`js: ${errors[0].slice(0, 90)}`)
    if (dead.length) problems.push(`http: ${dead[0]}`)
    if (info.brokenImgs.length) problems.push(`img 404: ${info.brokenImgs[0].split('/').pop()}`)
    if (info.h1s.length !== 1) problems.push(`${info.h1s.length} h1`)
    if (!info.title) problems.push('no <title>')
    if (info.bodyText < 40) problems.push('page is blank')
    if (info.overflow) problems.push('scrolls sideways on mobile')
    if (info.htmlLang !== lang) problems.push(`lang=${info.htmlLang}`)
    if (info.htmlDir !== (lang === 'ar' ? 'rtl' : 'ltr')) problems.push(`dir=${info.htmlDir}`)
    for (const j of info.jsonld) { try { JSON.parse(j) } catch { problems.push('JSON-LD does not parse') } }
    if (info.canonical && !info.canonical.startsWith(ORIGIN)) problems.push(`canonical ${info.canonical}`)

    is(problems.length === 0, `${name} (${path})`, problems.join('; ') || `“${info.title.slice(0, 46)}”`)
    if (info.imgNoAlt.length) warn(`${name}: image(s) with no alt attribute`, info.imgNoAlt.join(', '))
    await page.close()
  }
  await ctx.close()
}

// ------------------------------------------------------------ internal links
head('internal links')
const strays = [...seenLinks].filter((l) => !KNOWN.test(l))
is(strays.length === 0, 'every internal link points at a route the server knows',
   strays.length ? strays.join(', ') : `${seenLinks.size} distinct links`)

// ------------------------------------------------------ routes vs .htaccess
head('routes vs .htaccess')
const app = readFileSync('src/App.jsx', 'utf8')
const htaccess = readFileSync('public/.htaccess', 'utf8')
const appRoutes = [...app.matchAll(/path="\/([a-z-]+)"/g)].map((m) => m[1]).filter((r) => r !== '*')
const missing = appRoutes.filter((r) => !htaccess.includes(r))
is(missing.length === 0, 'every static route in App.jsx has an .htaccess rule',
   missing.length ? `${missing.join(', ')} would 404 on refresh` : `${appRoutes.length} routes`)

// ------------------------------------------------------------------- sitemap
head('sitemap + canonical origin')
const sitemapUrls = [...readFileSync('public/sitemap-pages.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
is(sitemapUrls.every((u) => u.startsWith(ORIGIN)), 'every sitemap URL uses the canonical origin', `${sitemapUrls.length} URLs`)
const ctx2 = await browser.newContext()
const p2 = await ctx2.newPage()
const sitemapDead = []
for (const u of sitemapUrls) {
  const path = u.replace(ORIGIN, '') || '/'
  const r = await p2.goto(BASE + path, { waitUntil: 'domcontentloaded' }).catch(() => null)
  if (!r || r.status() >= 400) sitemapDead.push(path)
}
is(sitemapDead.length === 0, 'every sitemap URL resolves', sitemapDead.join(', '))
await ctx2.close()

// --------------------------------------------------------------- dist hygiene
head('what actually ships')
const grep = async (pattern) =>
  (await run('grep', ['-rl', pattern, 'dist']).catch(() => ({ stdout: '' }))).stdout.trim().split('\n').filter(Boolean)
const wrongOrigin = (await grep('https://sporta.com.kw')).filter((f) => !/\.htaccess$/.test(f))
is(wrongOrigin.length === 0, 'no bare-domain spelling ships in the build', wrongOrigin.join(', '))
// A real service key is a JWT whose PAYLOAD says service_role. The string
// itself appears legitimately in setup-config.php and selftest.php, which
// exist precisely to WARN you if you pasted the service key into config.js.
const jwtFiles = await grep('eyJ[A-Za-z0-9_-]\\{10,\\}\\.eyJ')
const leaked = []
for (const f of jwtFiles) {
  for (const [, payload] of readFileSync(f, 'utf8').matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)/g)) {
    try {
      if (JSON.parse(Buffer.from(payload, 'base64url').toString()).role === 'service_role') leaked.push(f)
    } catch { /* not a JWT after all */ }
  }
}
is(leaked.length === 0, 'no service-role key anywhere in dist', leaked.join(', '))

await browser.close()
console.log(
  fails
    ? `\n${fails} problem(s), ${warns} warning(s) across the site`
    : `\nthe whole site scans clean${warns ? ` (${warns} warning(s))` : ''}`,
)
process.exit(fails ? 1 : 0)
