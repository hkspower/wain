/**
 * The live storefront, scanned from outside.
 *
 *   node scripts/site-scan.mjs                        # www.sporta.com.kw
 *   BASE=http://127.0.0.1:4300 node scripts/site-scan.mjs   # the local copy
 *
 * THIS SANDBOX CANNOT REACH THE LIVE SITE. The environment's egress policy
 * refuses CONNECT to www.sporta.com.kw:443 — a 403 from the gateway, nothing
 * to do with the shop — so what runs here is the restored go-live package on
 * 127.0.0.1:4300. Run the same file from a machine with a route to the domain
 * and it reports on the real thing; the checks do not change.
 *
 * What it looks at, in the order a problem costs money:
 *
 *   1. Does the shop answer, over TLS, on the address people type?
 *   2. Is anything served that should never be public — config, .git, a
 *      directory listing, a stack trace?
 *   3. Do the pages a customer walks through actually render, in Arabic, on
 *      a phone, without console errors or dead assets?
 *   4. Is the API answering with a catalogue, and are the two bank dropins
 *      reachable and refusing what they should refuse?
 *   5. The things a search engine and a phone read: title, lang, canonical,
 *      robots, sitemap, favicons, security headers.
 */
import { chromium } from 'playwright'

const BASE = (process.env.BASE ?? 'https://www.sporta.com.kw').replace(/\/$/, '')
const PHONE = { width: 390, height: 844 }

let fails = 0
let warns = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const warn = (ok, what) => {
  if (!ok) warns++
  console.log(`${ok ? 'ok  ' : 'warn'} ${what}`)
}
const note = (what) => console.log(`--   ${what}`)

const get = async (path, opts = {}) => {
  try {
    const res = await fetch(BASE + path, { redirect: 'manual', ...opts })
    const body = await res.text().catch(() => '')
    return { status: res.status, headers: res.headers, body, ok: true }
  } catch (e) {
    return { status: 0, headers: new Headers(), body: '', ok: false, error: String(e.message ?? e) }
  }
}

console.log(`\n=== ${BASE} ============================================\n`)

// --- 1. it answers ------------------------------------------------------
const home = await get('/')
if (!home.ok) {
  console.error(`cannot reach ${BASE}: ${home.error}`)
  console.error('If this is the sandbox, that is the egress policy, not the shop.')
  process.exit(2)
}
check(home.status === 200, `the shop answers (${home.status})`)

// --- 2. nothing private is public ---------------------------------------
//
// Each of these is a file that exists on the server and must never be
// readable over HTTP. A 200 with PHP source in it is the whole shop: database
// credentials, the cron key, the bank's merchant secrets.
const SECRETS = [
  ['/api/config.php', /db_pass|db_user|cron_key/i],
  ['/pay/config.php', /client_secret|encrp_key/i],
  ['/knet/config.php', /tranportal|resource_key/i],
  ['/.git/config', /\[core\]|url =/i],
  // ^KEY=VALUE at the start of a line, not merely an "=" somewhere: PHP's
  // built-in server answers an unknown path with the site's index.html, and
  // any HTML contains an equals sign. The first version of this check called
  // a missing .env a leak for exactly that reason.
  ['/.env', /^[A-Z][A-Z0-9_]*=/m],
]
for (const [path, tell] of SECRETS) {
  const r = await get(path)
  const html = (r.headers.get('content-type') ?? '').includes('text/html')
  const leaked = r.status === 200 && !html && tell.test(r.body)
  // A 200 with an empty body is what a `return [...]` config file looks like
  // when PHP has executed it rather than served it. That is safe, and saying
  // so is more use than a bare status.
  const how = r.status === 200 ? (r.body.trim() === '' ? '200, empty' : `200, ${r.body.length}b`) : String(r.status)
  check(!leaked, `${path} gives nothing away (${how}${leaked ? ' AND LEAKING' : ''})`)
}

// A directory that lists its contents hands over the whole shape of the site.
for (const dir of ['/api/', '/pay/', '/knet/', '/assets/', '/cats/']) {
  const r = await get(dir)
  const listing = r.status === 200 && /Index of|<title>Directory/i.test(r.body)
  check(!listing, `${dir} does not list its files (${r.status})`)
}

// A PHP error on a public page names paths, and sometimes queries.
const traces = /Fatal error|Warning:|Notice:|Deprecated:|Stack trace|on line \d+/
check(!traces.test(home.body), 'the home page carries no PHP error output')

// --- 3. the headers -----------------------------------------------------
//
// APACHE SETS THESE, NOT PHP. public_html/.htaccess carries HSTS, nosniff,
// X-Frame-Options, Referrer-Policy and the rest — and PHP's built-in server
// reads no .htaccess at all, so running this against the local copy reports
// every one of them missing. On the live site they are Apache's to send;
// a warning here is only meaningful when BASE is the real domain.
const local = !/^https:\/\//.test(BASE)
if (local) note('headers: .htaccess is not read by the local PHP server — these are advisory here')
const h = home.headers
warn(!h.get('x-powered-by'), `X-Powered-By is not advertised (${h.get('x-powered-by') ?? 'absent'})`)
warn(!!h.get('x-frame-options') || !!h.get('content-security-policy'),
  `framing is refused (${h.get('x-frame-options') ?? 'no X-Frame-Options'})`)
warn(h.get('x-content-type-options') === 'nosniff',
  `X-Content-Type-Options: nosniff (${h.get('x-content-type-options') ?? 'absent'})`)
warn(!!h.get('referrer-policy'), `Referrer-Policy is set (${h.get('referrer-policy') ?? 'absent'})`)
if (BASE.startsWith('https://')) {
  warn(!!h.get('strict-transport-security'),
    `HSTS is set (${h.get('strict-transport-security') ?? 'absent'})`)
} else {
  note('HSTS not checked — this run is over plain HTTP')
}
warn(!!(h.get('content-security-policy') || h.get('content-security-policy-report-only')),
  `a Content-Security-Policy is set (${h.get('content-security-policy') ? 'yes' : 'absent'})`)

// --- 4. what a crawler reads --------------------------------------------
for (const [path, tell, what] of [
  ['/robots.txt', /sitemap/i, 'robots.txt points at a sitemap'],
  ['/sitemap.xml', /<loc>/i, 'sitemap.xml lists pages'],
  ['/favicon.ico', null, 'favicon.ico answers'],
  ['/og-image.png', null, 'the link-preview image answers'],
]) {
  const r = await get(path)
  check(r.status === 200 && (!tell || tell.test(r.body)), `${what} (${r.status})`)
}

// --- 5. the API and the two banks ---------------------------------------
const products = await get('/api/api.php?r=products')
let list = null
try { list = JSON.parse(products.body) } catch {}
check(products.status === 200 && Array.isArray(list) && list.length > 0,
  `the catalogue answers with products (${products.status}, ${Array.isArray(list) ? list.length : '?'})`)
const stock = await get('/api/api.php?r=stock')
check(stock.status === 200, `the stock endpoint answers (${stock.status})`)

// The dropins must refuse an order they cannot confirm. 404 is the right
// answer; a payment form for an unknown order would mean the browser can name
// its own price.
for (const [path, name] of [['/pay/pay.php', 'T-Pay'], ['/knet/pay.php', 'KNET']]) {
  const r = await get(`${path}?trackid=SCANNOSUCHORDER&amount=0.100`)
  const formed = /form|AccessToken|redirect/i.test(r.body) && r.status === 200
  check(!formed, `${name} refuses an unknown order (${r.status})`)
  if (r.status === 503) note(`${name}: the dropin says it is not configured on this server`)
  if (r.status === 403) note(`${name}: refused as not-HTTPS — expected when scanning over http://`)
}

// The library must not be a router. This one is measured because it was
// wrong: the app called store.php for a year and got 200 and an empty body.
const lib = await get('/api/store.php?r=catalogue')
check(lib.body.trim() === '' || lib.status >= 400,
  `store.php is a library, not an endpoint (${lib.status}, ${lib.body.length} bytes)`)

// --- 6. the pages, in a phone ------------------------------------------
const PAGES = ['/', '/shop', '/about', '/contact', '/track', '/returns', '/privacy', '/terms']
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: PHONE, deviceScaleFactor: 2 })
const p = await ctx.newPage()

for (const route of PAGES) {
  const errors = []
  const dead = []
  p.removeAllListeners('console'); p.removeAllListeners('pageerror'); p.removeAllListeners('response')
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('response', (r) => r.status() >= 400 && dead.push(`${r.url().replace(BASE, '')} (${r.status()})`))

  let status = 0
  try {
    status = (await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 }))?.status() ?? 0
  } catch (e) {
    check(false, `${route.padEnd(10)} did not load (${e.message.split('\n')[0]})`)
    continue
  }
  await p.waitForTimeout(1200)

  const label = route.padEnd(10)
  check(status === 200, `${label} serves 200 (${status})`)

  const seen = await p.evaluate(() => ({
    text: document.body.innerText.trim().length,
    title: document.title.trim(),
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    imgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
  }))

  check(seen.text > 100, `${label} renders (${seen.text} chars)`)
  check(seen.over <= 1, `${label} does not scroll sideways (${seen.over}px)`)
  check(errors.length === 0, `${label} no console errors${errors.length ? ` — ${errors[0].slice(0, 80)}` : ''}`)
  check(dead.length === 0, `${label} nothing 404s${dead.length ? ` — ${dead.slice(0, 2).join(', ')}` : ''}`)
  check(seen.imgs.length === 0, `${label} every image loads${seen.imgs.length ? ` — ${seen.imgs[0].replace(BASE, '')}` : ''}`)
  warn(seen.title.length > 0, `${label} has a title (${seen.title.slice(0, 40) || 'empty'})`)
  warn(seen.lang === 'ar' && seen.dir === 'rtl', `${label} is Arabic right-to-left (lang=${seen.lang} dir=${seen.dir})`)
  warn(seen.canonical !== '', `${label} names a canonical URL (${seen.canonical || 'absent'})`)
}

await b.close()

console.log(
  `\n${fails ? `${fails} failed` : 'nothing failed'}${warns ? `, ${warns} worth looking at` : ''}`,
)
process.exit(fails ? 1 : 0)
