/**
 * assets/api-dedupe.js — one request for one answer, and never a stale one.
 *
 *   node scripts/api-dedupe-test.mjs     (npm run test:api-dedupe)
 *
 * The page is asked what it does, in a real browser, through a counting route:
 *  - the storefront's own load asks each public read route once (it asked four
 *    times before — measured, 2026-09-29);
 *  - two callers of one answer BOTH can read the body (a clone each);
 *  - `stock` is never shared, a POST is never shared, a different route is not;
 *  - a failure is not replayed, and the window is short (a real request again
 *    after it closes);
 *  - an init that could change the answer (a signal, a cache mode, another
 *    header) is passed straight through.
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const hits = {}
let failNext = 0
await page.route('**/api/api.php**', async (route) => {
  const u = new URL(route.request().url())
  const key = route.request().method() + ' ' + u.searchParams.get('r')
  hits[key] = (hits[key] || 0) + 1
  if (u.searchParams.get('r') === 'footer' && failNext > 0) { failNext--; return route.fulfill({ status: 500, body: '{"error":"x"}', contentType: 'application/json' }) }
  return route.continue()
})
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))

await page.goto(BASE + '/?lang=en', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
for (const r of ['products', 'slides', 'theme', 'footer', 'contact']) {
  check((hits['GET ' + r] || 0) === 1, `the storefront's load asks ${r} once`, `${hits['GET ' + r] || 0} time(s)`)
}
check(!!(await page.evaluate(() => window.__sportaDedupe)), 'the wrapper is installed')
check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 100))

const count = (k) => hits[k] || 0
Object.keys(hits).forEach((k) => delete hits[k])
await page.waitForTimeout(2300)                       // let the two-second window close
const r1 = await page.evaluate(async () => {
  const [a, b] = await Promise.all([fetch('/api/api.php?r=products'), fetch('/api/api.php?r=products', { headers: { Accept: 'application/json' } })])
  const [x, y] = await Promise.all([a.json(), b.json()])
  return { n: Array.isArray(x) ? x.length : (x.products || x).length, same: JSON.stringify(x) === JSON.stringify(y), s1: a.status, s2: b.status }
})
check(count('GET products') === 1 && r1.same && r1.n > 0 && r1.s1 === 200 && r1.s2 === 200, 'two simultaneous callers cost one request and BOTH can read the body', `${count('GET products')} request, ${r1.n} products`)

await page.evaluate(async () => { await fetch('/api/api.php?r=stock'); await fetch('/api/api.php?r=stock') })
check(count('GET stock') === 2, '`stock` is never shared (availability must be fresh)', `${count('GET stock')}`)
await page.evaluate(async () => { await fetch('/api/api.php?r=products', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }).catch(() => {}) })
check(count('POST products') === 1, 'a POST goes through untouched')
await page.evaluate(async () => { await fetch('/api/api.php?r=products', { cache: 'reload' }); await fetch('/api/api.php?r=products', { headers: { 'X-Other': '1' } }) })
check(count('GET products') === 3, 'an init that could change the answer (cache mode, another header) passes straight through', `${count('GET products')}`)

Object.keys(hits).forEach((k) => delete hits[k]); failNext = 1
await page.waitForTimeout(2300)
const f = await page.evaluate(async () => { const a = await fetch('/api/api.php?r=footer'); const b = await fetch('/api/api.php?r=footer'); return [a.status, b.status] })
check(f[0] === 500 && f[1] === 200 && count('GET footer') === 2, 'a failed answer is not replayed to the next caller', JSON.stringify(f) + ` ${count('GET footer')} requests`)

Object.keys(hits).forEach((k) => delete hits[k])
await page.waitForTimeout(2300)
await page.evaluate(async () => { await fetch('/api/api.php?r=slides'); await new Promise((r) => setTimeout(r, 2300)); await fetch('/api/api.php?r=slides') })
check(count('GET slides') === 2, 'after the two-second window a real request is made again', `${count('GET slides')}`)
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — one request for one answer, never a stale or shared-failure one')
process.exit(fails ? 1 : 0)
