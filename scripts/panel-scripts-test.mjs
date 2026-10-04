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
// 4. THE OTHER DIRECTION (2026-10-04): the storefront-only scripts carry `data-shop`, panel.php
//    drops them from /backends, and the SIGNED-IN panel must look the same with and without them.
//    A script the panel quietly depended on (theme.js, keyboard-hints.js, home-banner.js's preview
//    export…) cannot be marked by mistake without this going red.
const shopMarked = [...new Set([...RAW.matchAll(/<script\b[^>]*\ssrc="([^"?]+)[^"]*"[^>]*\sdata-shop\b/g), ...RAW.matchAll(/<script\b[^>]*\sdata-shop\b[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1]))]
check(shopMarked.length >= 30, 'index.html marks the storefront-only scripts (an empty list would pass everything below)', `${shopMarked.length} marked`)
check(shopMarked.every((s) => !all.includes(s)), 'no script is marked both data-shop and data-panel')
const leakedToPanel = shopMarked.filter((s) => panel.includes(s))
check(!/data-shop/.test(panel) && leakedToPanel.length === 0, '/backends carries no storefront-only script tag', leakedToPanel.slice(0, 3).join(' '))
for (const keep of ['/assets/api-dedupe.js', '/assets/theme.js', '/assets/keyboard-hints.js', '/assets/home-banner.js', '/config.js']) {
  check(panel.includes(keep), `/backends keeps ${keep}`)
}
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const login = await ctx.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: { email: 'manager@sporta.com.kw', password: 'correct horse' }, failOnStatusCode: false })
  check(login.status() === 200, 'signed in to the panel', String(login.status()))
  const panelSnap = async (full, screen) => {
    const p = await ctx.newPage()
    if (full) {
      await p.route('**/*', async (route) => {
        if (route.request().resourceType() === 'document' && /^\/backends/.test(new URL(route.request().url()).pathname)) {
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: RAW })
        }
        return route.continue()
      })
    }
    const errs = []
    p.on('pageerror', (e) => errs.push(String(e)))
    await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    if (screen) {
      await p.evaluate((s) => { [...document.querySelectorAll('.admin-sidebar button')].find((b) => new RegExp('^\\s*' + s + '\\s*$').test(b.textContent))?.click() }, screen)
      await p.waitForTimeout(2500)
    }
    const out = await p.evaluate(() => ({
      text: document.body.innerText.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim(),
      tags: document.querySelectorAll('body *:not(script):not(style)').length,
      scripts: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script').length,
      bytes: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script').reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0),
    }))
    await p.close()
    return { ...out, errs }
  }
  for (const screen of [null, 'Settings', 'Inventory', 'Orders']) {
    const a = await panelSnap(false, screen), b = await panelSnap(true, screen)
    const name = screen || 'Overview'
    check(a.text === b.text && a.text.length > 50, `/backends ${name}: the same words with and without the storefront scripts`, a.text === b.text ? `${a.text.length} chars` : `slim ${a.text.length} vs full ${b.text.length}`)
    check(Math.abs(a.tags - b.tags) <= 3, `/backends ${name}: the same structure`, `${a.tags} vs ${b.tags} elements`)
    check(a.errs.length === 0, `/backends ${name}: no script errors without them`, a.errs.join(' | ').slice(0, 100))
    if (!screen) check(a.scripts < b.scripts - 20, `/backends: far fewer scripts requested`, `${a.scripts} vs ${b.scripts} (${Math.round(a.bytes / 1024)} vs ${Math.round(b.bytes / 1024)} kB)`)
  }
  await ctx.close()
}
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the shop no longer downloads the panel, the panel no longer downloads the shop, and both look the same')
process.exit(fails ? 1 : 0)
