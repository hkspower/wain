// The checkout's numbers, before and after, on the project's throttled phone.
//
//   node scripts/checkout-split-measure.mjs [--runs 5] [--before <dist>] [--after <dist>]
//
// No assertions: timings are the thing a test must not assert (a budget that flakes is one people stop
// reading), so this PRINTS them and scripts/checkout-split-test.mjs asserts the properties that are
// not noise (what is requested, in what order, how many bytes).
//
// "Before" is a build of PRE_SPLIT_REF (the commit before this lane), "after" a build of the working
// tree, unless a built directory is given. Both are served by the same server and driven by the same
// browser under the same profile: 1.6 Mbps down, 150 ms RTT, CPU 4x slower, an EMPTY cache every run.
//
// Three things are reported:
//
//   1. BYTES   every JavaScript file the checkout page needs, raw / gzip / Brotli, and what a
//              first-ever visit to /checkout downloads in total (document, scripts, stylesheet).
//   2. COLD    a visit that lands on /checkout (a reload, the Back button from the bank's page, a
//              link): milliseconds from navigation start until the first form field exists, until it
//              is the page's largest paint, and the moment the checkout chunk was first requested
//              relative to the entry script's arrival.
//   3. WARM    the same bag, arriving from /cart after the shop has loaded, with and without the
//              hover that prefetches the page (lib/prefetchRoute.js): milliseconds from the click.
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRE_SPLIT_REF, WEB, buildSite, exportRef, launch, median, phone, rmrf, seed, serveSite, throttle, workDir,
} from './checkout-split-harness.mjs'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const RUNS = Number(arg('runs', 5))

const tmp = workDir('measure')
let before = arg('before')
let after = arg('after')
try {
  if (!before) {
    console.log(`building the baseline (${PRE_SPLIT_REF}) ...`)
    before = buildSite(exportRef(PRE_SPLIT_REF, join(tmp, 'ref')), join(tmp, 'before'))
  }
  if (!after) {
    console.log('building the working tree ...')
    after = buildSite(WEB, join(tmp, 'after'))
  }

  // ------------------------------------------------------------------ 1. bytes
  const sizes = (dist) => {
    const dir = join(dist, 'assets')
    const out = {}
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js') || x.endsWith('.css'))) {
      const b = readFileSync(join(dir, f))
      out[f.replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, '.$1')] = {
        raw: b.length, gz: gzipSync(b, { level: 9 }).length,
        br: brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length,
      }
    }
    const html = readFileSync(join(dist, 'index.html'))
    out['index.html'] = { raw: html.length, gz: gzipSync(html, { level: 9 }).length, br: brotliCompressSync(html).length }
    return out
  }
  const sb = sizes(before)
  const sa = sizes(after)
  console.log('\n== 1. BYTES (raw / gzip / brotli)\n')
  for (const k of ['index.html', 'Checkout.js', 'CheckoutSteps.js', 'checkout.js', 'index.js', 'react-vendor.js', 'rolldown-runtime.js', 'index.css']) {
    const x = sb[k]
    const y = sa[k]
    if (!x && !y) continue
    const f = (v) => (v ? `${v.raw} / ${v.gz} / ${v.br}` : '-')
    const d = x && y ? `  (${y.br - x.br >= 0 ? '+' : ''}${y.br - x.br} br)` : ''
    console.log(`  ${k.padEnd(20)} before ${f(x).padEnd(24)} after ${f(y)}${d}`)
  }
  const checkoutSet = (s) => ['Checkout.js', 'CheckoutSteps.js', 'checkout.js'].reduce((a, k) => a + (s[k]?.br ?? 0), 0)
  console.log(`  checkout page, the three files it needs: before ${checkoutSet(sb)} B br, after ${checkoutSet(sa)} B br`)

  // ------------------------------------------------------------------ 2 + 3. timings
  const browser = await launch()
  const interactive = `(() => {
    window.__t = {}
    const done = () => { if (window.__t.field == null && document.getElementById('f-name')) window.__t.field = performance.now() }
    new MutationObserver(done).observe(document, { childList: true, subtree: true })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    let mounted
    Object.defineProperty(window, '__SPORTA_MOUNTED', { get: () => mounted, set(v) { mounted = v; if (v && window.__t.mounted == null) window.__t.mounted = performance.now() } })
  })()`

  async function cold(dist) {
    const srv = await serveSite(dist)
    const rows = []
    try {
      for (let i = 0; i < RUNS; i++) {
        const ctx = await phone(browser)
        const page = await ctx.newPage()
        await seed(page)
        await page.addInitScript(interactive)
        await throttle(page)
        const m = srv.mark()
        await page.goto(`${srv.url}/checkout`, { waitUntil: 'commit' })
        await page.waitForFunction(() => window.__t && window.__t.field != null, null, { timeout: 120_000 })
        await page.waitForTimeout(400)
        const t = await page.evaluate(() => {
          const res = performance.getEntriesByType('resource')
          const end = (re) => Math.round(res.find((x) => re.test(x.name))?.responseEnd ?? NaN)
          return { ...window.__t, chunkEnd: end(/\/assets\/Checkout-.*\.js$/), entryEnd: end(/\/assets\/index-.*\.js$/) }
        })
        const mine = srv.requests.slice(m)
        rows.push({
          field: Math.round(t.field), lcp: Math.round(t.lcp ?? 0), mounted: Math.round(t.mounted),
          // How long React, once mounted, had to wait for the checkout chunk. Network time only: it does not
          // move with how busy this machine is, unlike the end-to-end times.
          wait: Math.max(0, t.chunkEnd - t.mounted),
          chunkBeforeMount: t.chunkEnd <= t.mounted,
          wire: mine.filter((r) => r.status === 200 && !r.path.startsWith('/api/')).reduce((a, r) => a + r.bytes, 0),
          requests: mine.length,
        })
        await ctx.close()
      }
    } finally {
      await srv.close()
    }
    return rows
  }

  async function warm(dist, hover) {
    const srv = await serveSite(dist)
    const rows = []
    try {
      for (let i = 0; i < RUNS; i++) {
        const ctx = await phone(browser)
        const page = await ctx.newPage()
        await seed(page)
        await page.goto(`${srv.url}/cart`, { waitUntil: 'load' })
        const link = page.locator('a[href="/checkout"]').first()
        await link.waitFor({ timeout: 30_000 })
        await throttle(page)
        if (hover) { await link.hover(); await page.waitForTimeout(1200) }
        await page.evaluate(() => { window.__t = { c0: performance.now() }; new MutationObserver(() => { if (window.__t.f == null && document.getElementById('f-name')) window.__t.f = performance.now() }).observe(document, { childList: true, subtree: true }) })
        await link.click()
        await page.waitForFunction(() => window.__t.f != null, null, { timeout: 90_000 })
        const t = await page.evaluate(() => window.__t)
        rows.push(Math.round(t.f - t.c0))
        await ctx.close()
      }
    } finally {
      await srv.close()
    }
    return rows
  }

  const fmt = (a) => `median ${Math.round(median(a))} ms  (min ${Math.min(...a)}, max ${Math.max(...a)}, n=${a.length})`
  console.log('\n== 2. COLD: navigation start -> first form field (empty cache, throttled phone)\n')
  const cb = await cold(before)
  const ca = await cold(after)
  for (const [name, rows] of [['before', cb], ['after ', ca]]) {
    console.log(`  ${name}  first form field    ${fmt(rows.map((r) => r.field))}`)
    console.log(`          React mounted        ${fmt(rows.map((r) => r.mounted))}`)
    console.log(`          wait for the chunk   ${fmt(rows.map((r) => r.wait))}  after React mounted (0 = it was already here)`)
    console.log(`          chunk here before React mounted: ${rows.filter((r) => r.chunkBeforeMount).length} of ${rows.length}`)
    console.log(`          LCP                  ${fmt(rows.map((r) => r.lcp))}`)
    console.log(`          on the wire          ${Math.round(median(rows.map((r) => r.wire)))} B (median), ${rows[0].requests} requests`)
  }
  console.log('\n== 3. WARM: click on the bag\'s Checkout link -> first form field (shop already loaded)\n')
  console.log(`  after, click with no hover first   ${fmt(await warm(after, false))}`)
  console.log(`  after, hover 1.2 s, then click     ${fmt(await warm(after, true))}`)
  await browser.close()
} finally {
  rmrf(tmp)
}
