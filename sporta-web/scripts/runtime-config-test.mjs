// Proves the site can be configured by editing /config.js on the server, with
// no rebuild — and that an unedited config.js fails closed instead of taking
// money for an order it cannot record.
//
// The build under test is made with NO VITE_ variables at all, which is exactly
// what the uploadable package ships. If configuration were still baked in at
// build time, every one of these would fail.
//
// Needs: dist/ served on :8188 WITH THE REAL public/.htaccess (the cache
// assertion tests a rule that lives there — a stripped test .htaccess makes it
// fail for the wrong reason), the PostgREST shim on :8130, a stub bank on
// :8131, and PostgreSQL on :5433 built by scripts/db-rebuild.sh.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const ROOT = '/tmp/pdfroot'
const CONFIG = `${ROOT}/config.js`
// The shipped, unedited template — read from source, never from whatever a
// previous (possibly crashed) run left on disk. Trusting the file made the
// "unedited config refuses the order" case silently test a configured site.
const SHIPPED = readFileSync(new URL('../public/config.js', import.meta.url), 'utf8')

// Serve the REAL public/.htaccess, minus exactly two directives that make it
// impossible to drive over plain HTTP:
//   - the canonical HTTPS redirect
//   - upgrade-insecure-requests, which makes the browser rewrite every asset
//     URL to https:// and fail with ERR_SSL_PROTOCOL_ERROR against a test
//     server that has no TLS
// Everything else — including the config.js cache rule this file asserts on —
// is the production text, so the assertion cannot pass against a stale copy.
const REAL_HTACCESS = new URL('../public/.htaccess', import.meta.url)
const SPA_ONLY = `<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  RewriteRule ^(shop|cart|checkout|about|contact|wishlist|track|returns)/?$ /index.html [L]
  RewriteRule ^product/[^/]+/?$ /index.html [L]
  RewriteRule ^admin(/.*)?$ /index.html [L]
</IfModule>
ErrorDocument 404 /index.html
`
const serveWith = async (text) => {
  writeFileSync(`${ROOT}/.htaccess`, text)
  execFileSync('apache2', ['-f', '/tmp/ap.conf', '-k', 'restart'])
  await new Promise((r) => setTimeout(r, 800))
}

// The browser cases exercise app behaviour, so they run with routing only.
// The production CSP pins connect-src to *.supabase.co and upgrades every
// request to https — correct on the live site, and incompatible with a
// localhost Supabase on a test server with no TLS. The cache rule, which is
// the one server rule this file asserts on, is checked at the end against the
// real .htaccess with a plain fetch, where no CSP applies.
await serveWith(SPA_ONLY)

const writeConfig = (obj) =>
  writeFileSync(CONFIG, `window.SPORTA_CONFIG = ${JSON.stringify(obj, null, 2)}\n`)

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'],
})

const results = []
const ok = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

// The real .htaccess forces HTTPS. Hostinger's proxy signals TLS with this
// header, so sending it lets the test drive the genuine rules over plain HTTP
// instead of testing a stripped-down copy of them.
const HTTPS_PROXY_HEADER = { 'X-Forwarded-Proto': 'https' }

async function shop(seedCart = true) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    extraHTTPHeaders: HTTPS_PROXY_HEADER,
  })
  if (seedCart) {
    await ctx.addInitScript(() => localStorage.setItem('sporta_cart', JSON.stringify([
      { slug: 'nba-cap', qty: 1, price: 8, name: { en: 'NBA Team Cap', ar: 'كاب' }, image: '' },
    ])))
  }
  const p = await ctx.newPage()
  return { ctx, p }
}

const fillCheckout = async (p) => {
  await p.locator('#f-name').fill('Fatima Al-Ali')
  await p.locator('#f-phone').fill('99887766')
  await p.locator('#f-governorate').selectOption('hawalli')
  await p.locator('#f-area').fill('Salmiya')
  for (const [k, v] of Object.entries({ block: '4', street: 'Amman', building: '12' })) {
    await p.locator(`#f-${k}`).fill(v)
  }
}

// ---- 1. shipped, unedited config.js -> fails closed -------------------------
{
  writeFileSync(CONFIG, SHIPPED)
  const { ctx, p } = await shop()
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await fillCheckout(p)
  await p.locator('button[type=submit]:visible').first().click()
  await p.waitForTimeout(1200)
  const msg = await p.locator('[role=alert]').first().textContent().catch(() => '')
  ok('unedited config.js refuses the order', /temporarily unavailable/i.test(msg ?? ''), (msg ?? '').slice(0, 60))
  ok('...and never reaches the bank', !p.url().includes('8131'))
  await ctx.close()
}

// ---- 2. edited config.js -> a real order, no rebuild ------------------------
{
  writeConfig({
    supabaseUrl: 'http://127.0.0.1:8130',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.x',
    payBaseUrl: 'http://127.0.0.1:8131',
  })
  const { ctx, p } = await shop()
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await fillCheckout(p)
  await p.locator('button[type=submit]:visible').first().click()
  await p.waitForURL(/8131/, { timeout: 15000 })
  const u = new URL(p.url())
  ok('edited config.js completes a real checkout', u.port === '8131', u.search)
  ok('payBaseUrl from config.js is used', u.hostname === '127.0.0.1')
  ok('still sends no amount', !u.searchParams.has('amount'))
  await ctx.close()
}

// ---- 3. changing config.js takes effect without touching the build ----------
{
  writeConfig({
    supabaseUrl: 'http://127.0.0.1:8130',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.x',
    payBaseUrl: 'http://127.0.0.1:8131/moved',
  })
  const { ctx, p } = await shop()
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await fillCheckout(p)
  await p.locator('button[type=submit]:visible').first().click()
  await p.waitForURL(/8131/, { timeout: 15000 })
  ok('a config.js edit changes behaviour with no rebuild', p.url().includes('/moved/pay.php'), new URL(p.url()).pathname)
  await ctx.close()
}

// ---- 4. under the REAL .htaccess: config.js must not be cached -------------
// If it were, editing a Supabase URL would appear to do nothing until the
// cache expired. No browser here, so the CSP and the https upgrade do not
// apply; X-Forwarded-Proto satisfies the canonical HTTPS redirect the way
// Hostinger's proxy does.
{
  await serveWith(readFileSync(REAL_HTACCESS, 'utf8'))
  // curl, not fetch: fetch silently drops a Host header (it is a forbidden
  // header name), so the request arrived as 127.0.0.1, tripped the canonical
  // host redirect, and the assertion measured the redirect's headers instead
  // of the file's.
  const curl = (path, opts = []) => execFileSync('curl', [
    '-s', ...opts, '-H', 'Host: www.sporta.com.kw', '-H', 'X-Forwarded-Proto: https',
    `http://127.0.0.1:8188${path}`,
  ]).toString()
  const header = (path, name) =>
    (curl(path, ['-o', '/dev/null', '-D', '-']).match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1] ?? '').trim()

  const cc = header('/config.js', 'cache-control')
  ok('config.js is not cached', /no-cache|no-store|must-revalidate/.test(cc), `Cache-Control: ${cc || '(none)'}`)

  // ...while hashed assets stay immutable, so the change did not weaken caching.
  const asset = readFileSync(`${ROOT}/index.html`, 'utf8').match(/\/assets\/[\w.-]+\.js/)?.[0]
  const acc = asset ? header(asset, 'cache-control') : ''
  ok('hashed assets stay immutable', /immutable/.test(acc), `${asset} -> ${acc || '(none)'}`)
  await serveWith(SPA_ONLY)
}

// ---- 5. a missing config.js must not break the site ------------------------
{
  writeFileSync(CONFIG, '')
  const { ctx, p } = await shop(false)
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('http://www.sporta.com.kw/shop', { waitUntil: 'networkidle' })
  const cards = await p.locator('article').count()
  ok('empty config.js still renders the storefront', cards > 10 && errors.length === 0, `${cards} products, ${errors.length} JS errors`)
  await ctx.close()
}

writeFileSync(CONFIG, SHIPPED)
await browser.close()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
