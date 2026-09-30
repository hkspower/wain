/**
 * The panel's scripts must not be sent to shoppers, and dropping them must
 * change nothing a shopper sees.
 *
 *   node scripts/panel-scripts-test.mjs     (npm run test:panel-scripts)
 *
 * index.html marks the 29 scripts that only add cards to /backends with
 * `data-panel`; seo.php (the storefront's entry) strips those tags and /backends
 * (served straight from index.html) keeps them. Three things can go wrong and
 * each is asserted:
 *   1. a panel script still reaches the storefront            -> tags/requests
 *   2. the panel loses one                                    -> /backends count
 *   3. a script that DOES act on the shop gets marked, and the
 *      shop quietly loses a feature nobody notices            -> DOM comparison:
 *      each storefront page is rendered with the stripped HTML AND with the
 *      full index.html substituted in, and what the shopper sees must match.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const RAW = readFileSync(new URL('../sporta-site/public_html/index.html', import.meta.url).pathname, 'utf8')
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

const marked = [...RAW.matchAll(/<script\b[^>]*\sdata-panel\b[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1])
const markedB = [...RAW.matchAll(/<script\b[^>]*\ssrc="([^"?]+)[^"]*"[^>]*\sdata-panel\b/g)].map((m) => m[1])
const all = [...new Set([...marked, ...markedB])]
check(all.length >= 25, 'index.html marks the panel scripts (an empty list would pass everything below)', `${all.length} marked`)

// 1. the storefront gets none
const shopRoutes = ['/', '/?lang=en', '/shop', '/product/sculpt-jacket-navy', '/product/sculpt-jacket-navy?lang=en', '/cart', '/checkout']
for (const r of shopRoutes) {
  const html = await (await fetch(BASE + r)).text()
  const leaked = all.filter((s) => html.includes(s))
  check(!/data-panel/.test(html) && leaked.length === 0 && /<\/html>/.test(html), `${r} carries no panel script tag`, leaked.slice(0, 3).join(' '))
  check((html.match(/<script\b[^>]*\bsrc=/g) || []).length >= 15, `${r} still carries the shop's own scripts`, `${(html.match(/<script\b[^>]*\bsrc=/g) || []).length} left`)
}

// 2. the panel keeps every one
const panel = await (await fetch(BASE + '/backends')).text()
const missing = all.filter((s) => !panel.includes(s))
check(missing.length === 0, '/backends still loads every panel script', missing.slice(0, 3).join(' '))
for (const s of all) {
  const r = await fetch(BASE + s)
  if (r.status !== 200 || !/javascript/.test(r.headers.get('content-type') || '')) { check(false, `${s} is served as JavaScript`, String(r.status)); break }
}

// 3. dropping them changes nothing a shopper sees
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const snap = async (path, w, full) => {
  const c = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: w < 500 })
  const p = await c.newPage()
  if (full) {
    await p.route('**/*', async (route) => {
      const u = new URL(route.request().url())
      if (route.request().resourceType() === 'document' && u.pathname === new URL(BASE + path).pathname) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: RAW })
      }
      return route.continue()
    })
  }
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  const out = await p.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').trim(),
    tags: document.querySelectorAll('body *:not(script)').length,
    imgs: [...document.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter((s) => !/^data:/.test(s || '')).length,
    lang: document.documentElement.lang + document.documentElement.dir,
    scripts: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script').length,
  }))
  await c.close()
  return { ...out, errs }
}
for (const [path, w] of [['/?lang=en', 390], ['/?lang=ar', 390], ['/shop?lang=en', 1280], ['/product/sculpt-jacket-navy?lang=en', 390], ['/product/sculpt-jacket-navy?lang=ar', 1280], ['/cart?lang=en', 390]]) {
  const a = await snap(path, w, false)
  const b = await snap(path, w, true)
  check(a.text === b.text && a.text.length > 50, `${path} @${w}: the same words with and without the panel scripts`, a.text === b.text ? `${a.text.length} chars` : `stripped ${a.text.length} vs full ${b.text.length}`)
  check(Math.abs(a.tags - b.tags) <= 2 && a.lang === b.lang, `${path} @${w}: the same page structure`, `${a.tags} vs ${b.tags} elements`)
  check(a.errs.length === 0, `${path} @${w}: no script errors without them`, a.errs.join(' | ').slice(0, 100))
  check(a.scripts < b.scripts, `${path} @${w}: fewer scripts requested`, `${a.scripts} vs ${b.scripts}`)
}
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the shop no longer downloads the panel, and looks the same')
process.exit(fails ? 1 : 0)
