/**
 * test:load-storefront — concurrent shoppers on the storefront (2026-10-15).
 *
 * N browser sessions run at once. Each one browses the home page, the shop, a product, picks a size,
 * presses Buy now and reads the checkout. It NEVER submits an order: nothing is written to the
 * database except the browser's own cart, which lives in localStorage.
 *
 * It reports, per step: how many ran, the median and 95th-percentile time, and what went wrong.
 * A throttled response (429) is counted as THROTTLE, not as a failure: the shop rations each IP on
 * purpose, and a load test from one machine will hit that. Real failures are 5xx responses, page errors
 * and requests that never finish.
 *
 *   CONCURRENCY=8 ROUNDS=3 node scripts/load-storefront-test.mjs
 *
 * Run `bash scripts/sandbox.sh` first. SANDBOX ONLY: BASE must be the sandbox (127.0.0.1), and the script
 * refuses any other host so that it cannot load the live shop.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)
const ROUNDS = Number(process.env.ROUNDS ?? 3)
const P95_LIMIT_MS = Number(process.env.P95_LIMIT_MS ?? 6000)

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`refusing to load ${BASE}: this test runs against the sandbox only`)
  process.exit(2)
}

const steps = {}
const errors = { http5xx: [], pageError: [], throttled: 0, hung: 0 }
const note = (step, ms) => { (steps[step] ??= []).push(ms) }
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]) }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function shopper(id) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.pageError.push(`#${id} ${e.message.slice(0, 120)}`))
  p.on('response', (r) => {
    const s = r.status()
    if (s === 429) errors.throttled++
    else if (s >= 500) errors.http5xx.push(`#${id} ${s} ${r.url().replace(BASE, '').slice(0, 80)}`)
  })
  const timed = async (step, fn) => {
    const t0 = Date.now()
    try { await fn(); note(step, Date.now() - t0) } catch (e) { errors.hung++; errors.pageError.push(`#${id} ${step}: ${e.message.split('\n')[0].slice(0, 100)}`) }
  }
  await timed('home', () => p.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle', timeout: 30000 }))
  await timed('shop', () => p.goto(`${BASE}/shop?lang=en`, { waitUntil: 'networkidle', timeout: 30000 }))
  await timed('product', () => p.goto(`${BASE}/product/vanquish-tank-navy?lang=en`, { waitUntil: 'networkidle', timeout: 30000 }))
  await timed('add-size', async () => {
    await p.locator('button').filter({ hasText: /^L$/ }).first().click({ timeout: 15000 })
  })
  await timed('checkout', async () => {
    await p.locator('button').filter({ hasText: /^Buy now$/ }).first().click({ timeout: 15000 })
    await p.waitForURL(/\/checkout/, { timeout: 15000 })
    await p.waitForSelector('#f-name', { timeout: 15000 })
  })
  await ctx.close()
}

const t0 = Date.now()
for (let round = 1; round <= ROUNDS; round++) {
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => shopper(`${round}.${i + 1}`)))
}
const total = Date.now() - t0
await b.close()

console.log(`load: ${CONCURRENCY} concurrent shoppers x ${ROUNDS} rounds = ${CONCURRENCY * ROUNDS} sessions in ${Math.round(total / 1000)}s`)
let slow = false
for (const [step, xs] of Object.entries(steps)) {
  const p95 = pct(xs, 0.95)
  if (p95 > P95_LIMIT_MS) slow = true
  console.log(`  ${step.padEnd(9)} n=${String(xs.length).padEnd(3)} median=${pct(xs, 0.5)}ms p95=${p95}ms`)
}
console.log(`  throttled (429, expected under load): ${errors.throttled}`)
console.log(`  http 5xx: ${errors.http5xx.length}`)
for (const e of errors.http5xx.slice(0, 8)) console.log(`    ${e}`)
console.log(`  page errors: ${errors.pageError.length}`)
for (const e of errors.pageError.slice(0, 8)) console.log(`    ${e}`)
console.log(`  steps that never finished: ${errors.hung}`)

const fails = []
if (errors.http5xx.length) fails.push('5xx responses')
if (errors.pageError.length) fails.push('page errors')
if (errors.hung) fails.push('unfinished steps')
if (slow) fails.push(`p95 above ${P95_LIMIT_MS}ms`)
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : `\nall ok — no server errors, page errors or stalls; every step p95 under ${P95_LIMIT_MS}ms`)
process.exitCode = fails.length ? 1 : 0
