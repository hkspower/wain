// Client-side race conditions (lane K3 of "fix race condition", 2026-11-04). Rig-free: no database, no PHP, none of the
// shared test rig's ports, no dist/, no sandbox. It drives REAL browsers (Chromium, one browser, a few pages) against:
//
//   * the CAPTURED LIVE STOREFRONT (the compiled bundle plus the deployed add-ons, with the live /api JSON answered from
//     the capture; every POST is answered by this script, nothing leaves the machine). The capture is not in the repo:
//     SPORTA_LIVE_CAPTURE=<dir> (default: the session scratchpad's scan-words/live). Without it sections A to E say so
//     and are skipped, like scripts/cart-ux-test.mjs does.
//   * the REPO's own app (src/), built by scripts/checkout-split-harness.mjs into a scratch directory (never dist/).
//
//   npm run test:race-client
//
// A race is only claimed when it is reproduced: every scenario below is an interleaving that Playwright controls (two
// pages in one browser context, a response held with page.route and released in a chosen order, a geolocation answer
// held and released late), and it has two verdicts: the unfixed code FAILS it, the fixed code passes. How the unfixed
// code is run: SPORTA_BOOT_JS / SPORTA_GOV_JS point the live sections at older copies of those add-ons, SPORTA_SRC_DIST
// points the repo sections at an older build. scripts/race-client-mutants.mjs does it one behaviour at a time.
//
//   A  the bag is shared by every tab: a removal made in one tab is not undone by the other, a quantity change and an
//      added line are not lost, a hidden tab refreshes itself where that is safe and never where it is not, and the
//      merge rules themselves (a table of twelve cases against real Storage)
//   B  the checkout after the bank: a restored "Redirecting to payment..." page is reloaded, a restored page that is
//      not stuck is left alone, and the second try is the same order
//   C  double tap: placing the order, applying a code and sending in the AI panel each make ONE request
//   D  the governorate auto-pick must not write an older area over what the customer typed after it
//   E  the optional location control against the real checkout: a late answer after leaving and returning, text typed
//      while it waits, remove, and what the order and the saved details end up carrying
//   F  the repo's own app: the bag follows the other tab at once, and the order tracker shows the LAST lookup
//   G  static: the new blocks keep the project's "no dollar sign" rule and the two halves know about each other
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite, copyTree, serveSite, workDir, rmrf } from './checkout-split-harness.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(WEB, 'public')
const CAPTURE = process.env.SPORTA_LIVE_CAPTURE || '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'
const HAVE_CAPTURE = existsSync(join(CAPTURE, 'index.html')) && existsSync(join(CAPTURE, 'assets'))
const ROUNDS = Math.max(1, Number(process.env.RACE_ROUNDS || 2))
const BOOT = readFileSync(process.env.SPORTA_BOOT_JS || join(PUB, 'boot.js'), 'utf8')
const GOV = readFileSync(process.env.SPORTA_GOV_JS || join(PUB, 'sporta-gov-autopick.js'), 'utf8')

let pass = 0, fail = 0, skipped = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ONLY = process.env.SPORTA_SECTIONS ? process.env.SPORTA_SECTIONS.split(',') : null
const section = async (title, fn, needsCapture = false) => {
  if (ONLY && !ONLY.includes(title.slice(0, 1))) return
  head(title)
  if (needsCapture && !HAVE_CAPTURE) { skipped++; console.log('SKIP no live capture here (set SPORTA_LIVE_CAPTURE); the real-app part of this section did not run'); return }
  try { await fn() } catch (e) { fail++; console.log('FAIL ' + title.slice(0, 1) + ' section aborted — ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')) }
}
// Poll until `fn` returns something truthy (the machine that runs this is shared and slow: generous, never a tight loop).
async function until(fn, ms = 20000, step = 100) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await fn() } catch { v = false }
    if (v) return v
    if (Date.now() - t0 > ms) return false
    await sleep(step)
  }
}
// A response held until the test lets it go.
const holder = () => { const q = []; return { wait: () => new Promise((r) => q.push(r)), release: () => q.splice(0).forEach((r) => r()), pending: () => q.length } }

const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', webmanifest: 'application/manifest+json', txt: 'text/plain', html: 'text/html; charset=utf-8' }
const isFile = (f) => existsSync(f) && statSync(f).isFile()
const ADDON_NAMES = new Set(['boot.js', 'config.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js', 'sporta-gov-autopick.js', 'sporta-clock.js', 'sporta-checkout-a11y.js',
  'sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css'])

// What the order and quote endpoints answer. The compiled checkout compares the order's amount with the total it showed
// and sends the shopper back to "review" when they differ, so the amount here is the quote's: 10 per unit plus 1 delivery.
const rig = { posts: [], hold: {} }
function answer(route, body) {
  let j = {}
  try { j = JSON.parse(body) } catch { /* not JSON */ }
  const sub = (j.items || []).reduce((s, i) => s + 10 * (i.qty || 1), 0)
  if (route === 'order') return [200, { track_id: j.track_id, amount: sub + 1, subtotal: sub, delivery: 1, total: sub + 1 }]
  if (route === 'discount') {
    const save = String(j.code || '').toUpperCase() === 'SAVE10'
    return [200, { subtotal: sub, delivery: 1, total: sub + 1 - (save ? 2 : 0), applied: save ? [{ label: 'SAVE10', amount: 2 }] : [] }]
  }
  if (route === 'assistant') return [200, { reply: 'Hello from the shop.' }]
  return [404, { error: 'not_found' }]
}
function serveCapture() {
  return new Promise((resolve) => {
    const send = (r, status, type, body) => { r.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); r.end(body) }
    const server = createServer((q, r) => {
      const u = new URL(q.url, 'http://x')
      const name = decodeURIComponent(u.pathname).replace(/^\//, '')
      if (q.method === 'POST') {
        let b = ''
        q.on('data', (c) => { b += c })
        q.on('end', async () => {
          const route = u.searchParams.get('r')
          rig.posts.push({ route, body: b, at: Date.now() })
          const h = rig.hold[route]
          if (h) await h(b)
          const [st, js] = answer(route, b)
          send(r, st, MIME.json, JSON.stringify(js))
        })
        return
      }
      if (u.pathname === '/api/api.php') {
        const route = u.searchParams.get('r')
        if (route === 'slide_image') return send(r, 200, 'image/png', readFileSync(join(PUB, 'og-image.png')))
        const f = join(CAPTURE, 'api', `${route}.json`)
        if (/^\w+$/.test(route || '') && isFile(f)) return send(r, 200, MIME.json, readFileSync(f))
        return send(r, 404, MIME.json, '{"error":"not_found"}')
      }
      if (name === 'boot.js') return send(r, 200, MIME.js, BOOT)
      if (name === 'sporta-gov-autopick.js') return send(r, 200, MIME.js, GOV)
      if (ADDON_NAMES.has(name) && isFile(join(PUB, name))) return send(r, 200, MIME[name.split('.').pop()], readFileSync(join(PUB, name)))
      for (const root of [CAPTURE, PUB]) {
        const f = join(root, name)
        if (name && !name.includes('..') && isFile(f)) return send(r, 200, MIME[f.split('.').pop()] || 'application/octet-stream', readFileSync(f))
      }
      if (/\.\w+$/.test(u.pathname)) return send(r, 404, 'text/plain', 'nf')
      send(r, 200, MIME.html, readFileSync(join(CAPTURE, 'index.html')))
    }).listen(0, '127.0.0.1', () => resolve({ base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok) }) }))
  })
}

// A bag line exactly as the compiled app stores it in localStorage "sporta_cart".
const line = (slug, size, en, price, qty) => ({ key: `${slug}__${size}__-`, slug, size, fit: null, name: { en, ar: en }, price, image: '/product-photo-unavailable.svg', qty })
const J = line('cloudsoft-jacket-coffee-brown', 'M', 'Cloudsoft Jacket — Coffee Brown', 10, 2) // stock 2: at the maximum
const S = line('sgomma-t-shirt-navy', 'XL', 'Sgomma T-Shirt — Navy', 5, 1) // stock 10
const G = line('cloudsoft-leggings-army-green', 'L', 'Cloudsoft Leggings — Army Green', 8, 1) // stock 1
const BAG = [J, S, G]
const brief = (list) => list.map((i) => `${i.slug.split('-')[0]}-${i.slug.split('-')[1]}:${i.qty}`).join(',')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctxOpts = { viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }

// A browser context whose first page load seeds the language and the bag (once per context: localStorage is shared by its
// tabs, so a second tab opened later must not put the seed back).
async function liveCtx(base, { lang = 'en', bag = BAG, geo = false, extra = {} } = {}) {
  const ctx = await browser.newContext({ ...ctxOpts, ...(geo ? { permissions: ['geolocation'], geolocation: { latitude: 29.375912, longitude: 47.977446, accuracy: 20 } } : {}), ...extra })
  await ctx.addInitScript(([l, b]) => {
    try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('lang', l); if (b) localStorage.setItem('sporta_cart', JSON.stringify(b)) } } catch (e) { /* blocked */ }
  }, [lang, bag])
  return ctx
}
const stored = (pg) => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('sporta_cart') || '[]') } catch (e) { return null } })
const sameBag = (got, want) => Array.isArray(got) && got.length === want.length && want.every((w) => got.some((g) => g.key === w.key && g.qty === w.qty))
// Pretend this tab is in the background: document.hidden / visibilityState as a hidden tab reports them.
const hideable = (ctxOrPage) => ctxOrPage.addInitScript(() => {
  window.__hiddenTab = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__hiddenTab })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hiddenTab ? 'hidden' : 'visible') })
})
const goHidden = (pg) => pg.evaluate(() => { window.__hiddenTab = true; document.dispatchEvent(new Event('visibilitychange')) })
const openCart = async (ctx, base) => {
  const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
  await pg.goto(base + '/cart'); await pg.waitForSelector('.cart-line'); await pg.waitForTimeout(500)
  return pg
}
const lineBtn = (pg, i, which) => {
  const l = pg.locator('.cart-line').nth(i)
  return which === 'remove' ? l.locator('button').last() : which === 'plus' ? l.locator('.purchase-quantity button').last() : l.locator('.purchase-quantity button').first()
}

let live = null
if (HAVE_CAPTURE && (!ONLY || ONLY.some((s) => 'ABCDE'.includes(s)))) live = await serveCapture()

// ============================================================================================================
await section('A  the bag is shared by every tab', async () => {
  const { base } = live
  for (let round = 1; round <= ROUNDS; round++) {
    // A1: a removal in tab A is not undone by a quantity change in tab B (B still holds the old bag)
    {
      const ctx = await liveCtx(base); const a = await openCart(ctx, base), b = await openCart(ctx, base)
      await lineBtn(a, 0, 'remove').click()
      await until(async () => (await stored(a)).length === 2)
      await lineBtn(b, 1, 'plus').click()
      await sleep(600)
      const got = await stored(a)
      is(sameBag(got, [{ ...S, qty: 2 }, G]), `A1.${round} a line removed in tab A stays removed after tab B (opened before) changes another line`, brief(got || []))
      await ctx.close()
    }
    // A2: a quantity change in tab A is not lost when tab B removes another line
    {
      const ctx = await liveCtx(base); const a = await openCart(ctx, base), b = await openCart(ctx, base)
      await lineBtn(a, 1, 'plus').click()
      await until(async () => (await stored(a)).find((i) => i.key === S.key)?.qty === 2)
      await lineBtn(b, 2, 'remove').click()
      await sleep(600)
      const got = await stored(a)
      is(sameBag(got, [J, { ...S, qty: 2 }]), `A2.${round} a quantity raised in tab A survives tab B removing another line`, brief(got || []))
      await ctx.close()
    }
    // A3: a line ADDED in tab A (from a product page) is not lost when tab B changes its own copy of the bag
    {
      const ctx = await liveCtx(base); const b = await openCart(ctx, base)
      const a = await ctx.newPage(); a.setDefaultTimeout(90000)
      await a.goto(base + '/product/sgomma-t-shirt-navy'); await a.waitForSelector('h1')
      await a.getByRole('button', { name: 'M', exact: true }).first().click()
      await a.getByRole('button', { name: 'Add', exact: true }).first().click()
      const grown = await until(async () => (await stored(a)).length === 4)
      const afterA = await stored(a)
      await lineBtn(b, 2, 'remove').click()
      await sleep(600)
      const got = await stored(a)
      const added = afterA.filter((i) => ![J.key, S.key, G.key].includes(i.key))
      is(grown && added.length === 1 && got.some((i) => i.key === added[0].key) && !got.some((i) => i.key === G.key), `A3.${round} a line added in tab A from a product page is still there after tab B removes another`, brief(got || []))
      await ctx.close()
    }
  }
  // A4: a tab that is in the background when the bag changes elsewhere refreshes itself (the page cannot be told)
  {
    const ctx = await liveCtx(base); await hideable(ctx)
    const a = await openCart(ctx, base), b = await openCart(ctx, base)
    await b.evaluate(() => { window.__marker = 1 })
    await goHidden(b)
    await lineBtn(a, 0, 'remove').click()
    const gone = await until(async () => (await b.evaluate(() => !window.__marker)), 15000)
    const shown = gone ? await until(async () => (await b.locator('.cart-line').count()) === 2, 15000) : false
    is(gone && shown, 'A4 a background tab reloads itself when the bag changes in another tab, and then shows the two lines that are left', `reloaded=${gone} lines=${await b.locator('.cart-line').count().catch(() => '?')}`)
    await ctx.close()
  }
  // A5: but never where a reload would cost the shopper something: a background checkout with a typed name stays put
  {
    const ctx = await liveCtx(base); await hideable(ctx)
    const a = await openCart(ctx, base)
    const b = await ctx.newPage(); b.setDefaultTimeout(90000)
    await b.goto(base + '/checkout'); await b.waitForSelector('input[name=name]')
    await b.fill('input[name=name]', 'Typed Name'); await b.evaluate(() => { window.__marker = 1 })
    await goHidden(b)
    await lineBtn(a, 0, 'remove').click()
    await sleep(2500)
    is(await b.evaluate(() => window.__marker === 1), 'A5 a background checkout is NOT reloaded (the form is the shopper\'s)')
    is((await b.inputValue('input[name=name]')) === 'Typed Name', 'A5b and the name typed there is still in the field')
    await ctx.close()
  }
  // A6: the merge rules, against real Storage on a made-up origin: tab P loads boot.js, tab Q is a bare page (the other tab)
  {
    const ORIGIN = 'https://race.test'
    const ctx = await browser.newContext(ctxOpts)
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url())
      if (u.origin !== ORIGIN) return route.abort()
      if (u.pathname === '/boot.js') return route.fulfill({ contentType: 'text/javascript', body: BOOT })
      return route.fulfill({ contentType: 'text/html', body: u.pathname === '/bare' ? '<!doctype html><title>q</title><body>q' : '<!doctype html><title>p</title><script src="/boot.js"></script><body>p' })
    })
    const P = await ctx.newPage(), Q = await ctx.newPage()
    await P.goto(ORIGIN + '/'); await Q.goto(ORIGIN + '/bare')
    const L = (key, qty, extra = {}) => ({ key, slug: key, size: 'M', fit: null, name: { en: key, ar: key }, price: 5, image: '', qty, ...extra })
    const a = (q = 1) => L('a', q), b = (q = 1) => L('b', q), c = (q = 1) => L('c', q)
    // [name, base, theirs, mine, expected keys:qty in order-insensitive form]
    const CASES = [
      ['a foreign line is kept when this tab changes another', [a()], [a(), b()], [a(2)], [a(2), b()]],
      ['a line the other tab removed stays removed when this tab did not touch it', [a(), b()], [a()], [a(), b(), c()], [a(), c()]],
      ['concurrent quantity changes add up (3 elsewhere, +1 here)', [a(1)], [a(3)], [a(2)], [a(4)]],
      ['both tabs added the same line: quantities add', [], [a(1)], [a(1)], [a(2)]],
      ['this tab raised a line the other tab removed: this tab\'s wish wins', [a(2)], [], [a(3)], [a(3)]],
      ['the other tab emptied the bag; this tab\'s unchanged rewrite does not bring it back', [a(), b()], [], [a(), b()], []],
      ['this tab removed a line the other tab raised: removed', [a(1), b()], [a(5), b()], [b()], [b()]],
      ['a quantity cannot be pushed below 1 by a merge', [a(3)], [a(1)], [a(2)], [a(1)]],
      ['a refreshed price in this tab is kept', [a(1)], [a(2)], [a(1, { price: 7 })], [a(2, { price: 7 })]],
    ]
    for (const [name, base0, theirs, mine, want] of CASES) {
      await Q.evaluate((v) => localStorage.setItem('sporta_cart', JSON.stringify(v)), base0)
      await P.evaluate(() => localStorage.getItem('sporta_cart')) // the app reads the bag once, at start
      await Q.evaluate((v) => localStorage.setItem('sporta_cart', JSON.stringify(v)), theirs)
      await P.evaluate((v) => localStorage.setItem('sporta_cart', JSON.stringify(v)), mine)
      const got = await Q.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart')))
      const norm = (l) => JSON.stringify([...l].sort((x, y) => x.key.localeCompare(y.key)).map((i) => [i.key, i.qty, i.price]))
      is(norm(got) === norm(want), `A6 merge: ${name}`, JSON.stringify(got.map((i) => [i.key, i.qty, i.price])))
      await P.reload() // a fresh page: the wrapper starts from "never read"
    }
    // untouched bag: this tab's own string is stored byte for byte
    await Q.evaluate(() => localStorage.setItem('sporta_cart', JSON.stringify([{ key: 'a', qty: 1 }])))
    await P.evaluate(() => localStorage.getItem('sporta_cart'))
    const own = '[{"key":"a","qty":2,"extra":"é"}]'
    await P.evaluate((v) => localStorage.setItem('sporta_cart', v), own)
    is((await Q.evaluate(() => localStorage.getItem('sporta_cart'))) === own, 'A6 nothing changed elsewhere: this tab\'s own string is stored byte for byte')
    // a write before any read, an unparsable value and the repo app's marker all pass straight through
    await P.reload(); await Q.evaluate(() => localStorage.setItem('sporta_cart', '[{"key":"z","qty":1}]'))
    await P.evaluate(() => localStorage.setItem('sporta_cart', '[{"key":"a","qty":1}]'))
    is((await Q.evaluate(() => localStorage.getItem('sporta_cart'))) === '[{"key":"a","qty":1}]', 'A6 a write before the app ever read the bag is stored as given')
    await P.evaluate(() => localStorage.getItem('sporta_cart')); await Q.evaluate(() => localStorage.setItem('sporta_cart', '[{"key":"y","qty":1}]'))
    await P.evaluate(() => localStorage.setItem('sporta_cart', 'not json'))
    is((await Q.evaluate(() => localStorage.getItem('sporta_cart'))) === 'not json', 'A6 an unparsable value is stored as given (never "repaired")')
    await P.reload(); await P.evaluate(() => localStorage.getItem('sporta_cart')); await Q.evaluate(() => localStorage.setItem('sporta_cart', '[{"key":"y","qty":1}]'))
    await P.evaluate(() => { window.__sportaCartOwn = true; localStorage.setItem('sporta_cart', '[{"key":"a","qty":1}]') })
    is((await Q.evaluate(() => localStorage.getItem('sporta_cart'))) === '[{"key":"a","qty":1}]', 'A6 when the repo app says it syncs the bag itself (window.__sportaCartOwn) the guard stands down')
    await P.reload()
    const other = await P.evaluate(() => { localStorage.setItem('lang', 'en'); sessionStorage.setItem('sporta_cart', 'sess'); return [localStorage.getItem('lang'), sessionStorage.getItem('sporta_cart')] })
    is(other[0] === 'en' && other[1] === 'sess', 'A6 other keys and sessionStorage pass through')
    await ctx.close()
  }
}, true)

// ============================================================================================================
// A KNET order: the checkout config of the capture offers cash only, so this answers it with both methods.
const KNET_CONFIG = JSON.stringify({ delivery_fee: 1, methods: ['knet', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' })
async function fillDelivery(pg) {
  await pg.waitForSelector('input[name=name]')
  await pg.fill('input[name=name]', 'Test Shopper'); await pg.fill('input[name=tel]', '55512345')
  await pg.selectOption('select[name=address-level1]', { index: 1 }); await pg.waitForTimeout(250)
  await pg.fill('input[name=address-level2]', 'Salmiya'); await pg.fill('input[name=address-line2]', '5'); await pg.fill('input[name=address-line1]', 'Salem Street'); await pg.fill('input[name=address-line3]', '12')
}
const nextStep = async (pg) => { const b = pg.locator('button[type=submit]:visible:not([disabled])').first(); await b.waitFor(); await b.click(); await pg.waitForTimeout(700) }
async function toFinal(pg, base, { knet = false } = {}) {
  if (knet) await pg.route('**/api/api.php?r=checkout_config', (r) => r.fulfill({ contentType: 'application/json', body: KNET_CONFIG }))
  await pg.goto(base + '/checkout'); await fillDelivery(pg)
  await nextStep(pg); await nextStep(pg)
  return pg.locator('button[type=submit]:visible:not([disabled])').filter({ hasText: /place order|pay with/i }).first()
}
const orders = () => rig.posts.filter((p) => p.route === 'order')

await section('B  the checkout after the bank', async () => {
  const { base } = live
  for (let round = 1; round <= ROUNDS; round++) {
    rig.posts.length = 0
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    // the bank page never replaces this one (a navigation that does not happen, as when the shopper comes back with Back)
    await pg.route('**/knet/pay.php**', (r) => r.fulfill({ status: 204, body: '' }))
    const fin = await toFinal(pg, base, { knet: true })
    await fin.click()
    const stuck = await until(async () => /Redirecting/i.test(await pg.locator('button[type=submit]:visible').last().textContent()), 20000)
    is(stuck, `B1.${round} after "Pay with KNET" the form is busy ("Redirecting to payment...")`)
    await pg.evaluate(() => { window.__marker = 1 })
    // what the browser does on Back: the page comes back from its back/forward cache exactly as it was left
    await pg.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    const fresh = await until(async () => pg.evaluate(() => !window.__marker), 15000)
    const form = fresh ? await until(async () => (await pg.locator('form[aria-busy="true"]').count()) === 0, 15000) : false
    is(fresh && form, `B2.${round} a restored page that is still stuck is reloaded, and the new page is not busy`, `reloaded=${fresh} busyGone=${form}`)
    if (fresh) {
      // the second try is the SAME order: the attempt id lives in sessionStorage, so the server can answer it with the order it has
      const first = JSON.parse(orders()[0].body).track_id
      await pg.waitForSelector('.purchase-quick__submit, button[type=submit]:visible')
      const quick = pg.locator('.purchase-quick__submit').first()
      if (await quick.count()) {
        await quick.click(); await until(async () => orders().length >= 2, 15000)
        is(orders().length === 2 && JSON.parse(orders()[1].body).track_id === first, `B3.${round} the second try carries the same order id (${first})`, orders().map((o) => JSON.parse(o.body).track_id).join(' / '))
      } else is(false, `B3.${round} the reloaded checkout offers the one-tap payment (saved details)`)
    }
    await ctx.close()
  }
  // B4: a restored page that is NOT stuck is left alone, typed fields and all
  {
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await pg.waitForSelector('input[name=name]')
    await pg.fill('input[name=name]', 'Typed Name'); await pg.evaluate(() => { window.__marker = 1 })
    await pg.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await sleep(1500)
    is(await pg.evaluate(() => window.__marker === 1), 'B4 a restored checkout that is not busy is not reloaded')
    is((await pg.inputValue('input[name=name]')) === 'Typed Name', 'B4b and its typed field keeps the text')
    // and an ordinary pageshow (not from the cache) does nothing
    await pg.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
    await sleep(600)
    is(await pg.evaluate(() => window.__marker === 1), 'B5 a pageshow that is not a restore does nothing')
    await ctx.close()
  }
}, true)

// ============================================================================================================
await section('C  double tap makes one request', async () => {
  const { base } = live
  {
    rig.posts.length = 0
    const h = holder(); rig.hold.order = () => h.wait()
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    const fin = await toFinal(pg, base)
    const bb = await fin.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2
    await pg.mouse.click(x, y); await pg.mouse.dblclick(x, y); await pg.keyboard.press('Enter'); await pg.mouse.click(x, y)
    await sleep(1200)
    is(orders().length === 1, 'C1 four taps and an Enter on "Place order" while the first request is still out: ONE order request', `${orders().length}`)
    is((await pg.locator('form[aria-busy="true"]').count()) === 1, 'C1b and the form says it is busy meanwhile')
    h.release(); rig.hold.order = null
    await ctx.close()
  }
  {
    rig.posts.length = 0
    const h = holder(); rig.hold.discount = (b) => (JSON.parse(b).code ? h.wait() : null)
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await fillDelivery(pg); await nextStep(pg)
    await pg.getByRole('button', { name: /discount code/i }).first().click()
    await pg.locator('input.font-mono').first().fill('save10')
    const apply = pg.getByRole('button', { name: /^apply$/i }).first()
    const bb = await apply.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2
    await pg.mouse.click(x, y); await pg.mouse.dblclick(x, y)
    await sleep(900)
    const coupons = rig.posts.filter((p) => p.route === 'discount' && JSON.parse(p.body).code)
    is(coupons.length === 1, 'C2 three taps on "Apply" while the first answer is out: ONE coupon request', `${coupons.length}`)
    h.release(); rig.hold.discount = null
    await ctx.close()
  }
  {
    rig.posts.length = 0
    const h = holder(); rig.hold.assistant = () => h.wait()
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/'); await pg.waitForSelector('.assistant-launcher')
    await pg.locator('.assistant-launcher').first().click()
    const input = pg.locator('[role=dialog] input').first(); await input.waitFor()
    await input.fill('where is my order')
    const send = pg.locator('[role=dialog] button[type=submit]').first()
    const bb = await send.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2
    await pg.mouse.click(x, y); await pg.mouse.dblclick(x, y); await input.press('Enter')
    await sleep(900)
    is(rig.posts.filter((p) => p.route === 'assistant').length === 1, 'C3 taps and Enter on "Send" in the AI panel while the first answer is out: ONE request', `${rig.posts.filter((p) => p.route === 'assistant').length}`)
    h.release(); rig.hold.assistant = null
    await ctx.close()
  }
}, true)

// ============================================================================================================
await section('D  the governorate auto-pick versus the customer\'s newer typing', async () => {
  const { base } = live
  for (let round = 1; round <= ROUNDS; round++) {
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await pg.waitForSelector('input[name=name]')
    const gov = 'select[name=address-level1]', area = 'input[name=address-level2]'
    await pg.selectOption(gov, 'capital'); await pg.waitForTimeout(200)
    // the add-on's own change event (the next one on the select) is answered, one task later, by the customer typing again
    await pg.evaluate(([g, a]) => {
      const sel = document.querySelector(g), inp = document.querySelector(a)
      sel.addEventListener('change', () => setTimeout(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'Jabriya')
        inp.dispatchEvent(new Event('input', { bubbles: true }))
      }, 0), { once: true })
    }, [gov, area])
    await pg.fill(area, 'Salmiya')
    await pg.locator(area).blur()
    await until(async () => (await pg.inputValue(gov)) === 'hawalli', 10000)
    await sleep(500)
    const v = await pg.inputValue(area)
    is(v === 'Jabriya', `D1.${round} text typed right after the auto-pick is not overwritten by the older area`, `area="${v}" governorate="${await pg.inputValue(gov)}"`)
    await ctx.close()
  }
  {
    // the pick itself still works: Salmiya typed under Capital switches to Hawalli and the area stays
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await pg.waitForSelector('input[name=name]')
    await pg.selectOption('select[name=address-level1]', 'capital'); await pg.waitForTimeout(200)
    await pg.fill('input[name=address-level2]', 'Salmiya'); await pg.locator('input[name=address-level2]').blur()
    await until(async () => (await pg.inputValue('select[name=address-level1]')) === 'hawalli', 10000)
    await sleep(500)
    is((await pg.inputValue('select[name=address-level1]')) === 'hawalli' && (await pg.inputValue('input[name=address-level2]')) === 'Salmiya', 'D2 untouched, the auto-pick still sets Hawalli and puts "Salmiya" back')
    await ctx.close()
  }
}, true)

// ============================================================================================================
const GEO = `(() => {
  const g = navigator.geolocation; if (!g) return
  const orig = g.getCurrentPosition.bind(g)
  window.__geo = { held: [], calls: 0, hold: true }
  g.getCurrentPosition = (ok, err, o) => { window.__geo.calls++; if (window.__geo.hold) { window.__geo.held.push({ ok, err }); return } return orig(ok, err, o) }
  window.__geoRelease = (i, c) => window.__geo.held[i].ok({ coords: c || { latitude: 29.375912, longitude: 47.977446, accuracy: 20 } })
})()`
const PIN = /maps\?q=29\.375912,47\.977446/
const spaTo = (pg, path) => pg.evaluate((p) => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
const openNote = async (pg) => {
  const fold = pg.locator('button.sporta-fold--note'); if (await fold.count()) await fold.first().click()
  await pg.waitForSelector('#f-note', { state: 'visible' }); await pg.waitForSelector('#sporta-loc-btn')
}
const note = (pg) => pg.inputValue('#f-note')

await section('E  the location control against the real checkout', async () => {
  const { base } = live
  {
    // E1: share, leave the checkout while the position is pending, come back: the late answer is for a page that is gone
    const ctx = await liveCtx(base, { geo: true }); await ctx.addInitScript(GEO)
    const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await pg.waitForSelector('input[name=name]'); await openNote(pg)
    await pg.click('#sporta-loc-btn')
    is(await until(async () => (await pg.evaluate(() => window.__geo.calls)) === 1) && await pg.locator('#sporta-loc-btn').isDisabled(), 'E1a the tap asks once and the control is busy (disabled) while it waits')
    await spaTo(pg, '/cart'); await pg.waitForSelector('.cart-line')
    is((await pg.locator('#sporta-loc').count()) === 0, 'E1b the control is gone from the bag page')
    await pg.goBack(); await pg.waitForSelector('input[name=name]'); await openNote(pg)
    await pg.evaluate(() => window.__geoRelease(0)) // the OLD answer arrives now
    await sleep(700)
    is((await note(pg)) === '' && (await pg.locator('#sporta-loc-btn').getAttribute('data-act')) === 'share' && !(await pg.locator('#sporta-loc-btn').isDisabled()), 'E1c the late answer of the abandoned lookup writes nothing: empty note, control idle', `note="${await note(pg)}"`)
    await pg.click('#sporta-loc-btn')
    await until(async () => (await pg.evaluate(() => window.__geo.calls)) === 2)
    await pg.evaluate(() => window.__geoRelease(1))
    await until(async () => PIN.test(await note(pg)))
    is((await note(pg)).match(/maps\?q=/g)?.length === 1, 'E1d sharing again on the returned page writes exactly one line', await note(pg))
    await pg.evaluate(() => window.__geoRelease(0)) // the old one again, even later
    await sleep(500)
    is((await note(pg)).match(/maps\?q=/g)?.length === 1, 'E1e and the old answer arriving a second time changes nothing')
    await ctx.close()
  }
  {
    // E2: text typed while the lookup waits is kept; the order carries the text and the line once; the saved details carry no pin
    rig.posts.length = 0
    const ctx = await liveCtx(base, { geo: true }); await ctx.addInitScript(GEO)
    const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await fillDelivery(pg); await openNote(pg)
    await pg.click('#sporta-loc-btn')
    await until(async () => (await pg.evaluate(() => window.__geo.calls)) === 1)
    await pg.fill('#f-note', 'Gate 3, ring twice')
    await pg.evaluate(() => window.__geoRelease(0))
    await until(async () => PIN.test(await note(pg)))
    is((await note(pg)).startsWith('Gate 3, ring twice ') && PIN.test(await note(pg)), 'E2a words typed while the lookup waited are kept, the line follows them', await note(pg))
    await nextStep(pg); await nextStep(pg)
    const fin = pg.locator('button[type=submit]:visible:not([disabled])').filter({ hasText: /place order|pay with/i }).first()
    await fin.click(); await until(async () => orders().length === 1)
    const sent = orders().length ? JSON.parse(orders()[0].body).customer.note : ''
    is(sent.startsWith('Gate 3, ring twice ') && sent.match(/maps\?q=/g)?.length === 1, 'E2b the order carries the words and ONE location line (what the shopper saw)', sent)
    const keep = await pg.evaluate(() => localStorage.getItem('sporta.delivery'))
    is(keep && JSON.parse(keep).note === 'Gate 3, ring twice' && !/maps/.test(keep), 'E2c the saved delivery details (Remember is on) carry the words and NO pin', String(keep).slice(0, 200))
    await ctx.close()
  }
  {
    // E3: a pin the customer removed is not in the order; the words are
    rig.posts.length = 0
    const ctx = await liveCtx(base, { geo: true }); await ctx.addInitScript(GEO)
    const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await fillDelivery(pg); await openNote(pg)
    await pg.fill('#f-note', 'Back door')
    await pg.click('#sporta-loc-btn'); await until(async () => (await pg.evaluate(() => window.__geo.calls)) === 1); await pg.evaluate(() => window.__geoRelease(0))
    await until(async () => PIN.test(await note(pg)))
    await pg.click('#sporta-loc-btn') // now "Remove"
    await until(async () => !/maps/.test(await note(pg)))
    is((await note(pg)) === 'Back door', 'E3a Remove takes the line out and leaves the words', await note(pg))
    await nextStep(pg); await nextStep(pg)
    const fin = pg.locator('button[type=submit]:visible:not([disabled])').filter({ hasText: /place order|pay with/i }).first()
    await fin.click(); await until(async () => orders().length === 1)
    const sent = orders().length ? JSON.parse(orders()[0].body).customer.note : ''
    is(sent === 'Back door', 'E3b the order carries "Back door" and no pin', sent)
    await ctx.close()
  }
}, true)

// ============================================================================================================
await section('F  the repo\'s own app', async () => {
  const dist = process.env.SPORTA_SRC_DIST || (() => { const dir = workDir('race-client'); return buildSite(copyTree(dir), join(dir, 'dist')) })()
  const site = await serveSite(dist)
  const REPO_BAG = [
    { key: 'jacket__M__-', slug: 'jacket', size: 'M', fit: null, name: { en: 'Jacket', ar: 'جاكيت' }, price: 10, image: '', qty: 2 },
    { key: 'shirt__XL__-', slug: 'shirt', size: 'XL', fit: null, name: { en: 'Shirt', ar: 'قميص' }, price: 5, image: '', qty: 1 },
    { key: 'leggings__L__-', slug: 'leggings', size: 'L', fit: null, name: { en: 'Leggings', ar: 'ليقنز' }, price: 8, image: '', qty: 1 },
  ]
  const ctxFor = async () => {
    const ctx = await browser.newContext(ctxOpts)
    await ctx.addInitScript((b) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('lang', 'en'); localStorage.setItem('sporta_cart', JSON.stringify(b)) } } catch (e) { /* blocked */ } }, REPO_BAG)
    return ctx
  }
  const cart = async (ctx) => { const pg = await ctx.newPage(); pg.setDefaultTimeout(90000); await pg.goto(site.url + '/cart'); await pg.waitForSelector('ul > li button[aria-label="Remove"]'); await pg.waitForTimeout(400); return pg }
  const rows = (pg) => pg.locator('ul > li').filter({ has: pg.locator('button[aria-label="Remove"]') })
  const rmBtn = (pg, i) => rows(pg).nth(i).locator('button[aria-label="Remove"]')
  const plusBtn = (pg, i) => rows(pg).nth(i).locator('button[aria-label="Increase quantity"]')
  const READ = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))
  for (let round = 1; round <= ROUNDS; round++) {
    {
      const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
      await rmBtn(a, 0).click(); await until(async () => (await READ(a)).length === 2)
      await plusBtn(b, 1).click(); await sleep(600)
      const got = await READ(a)
      is(sameBag(got, [{ ...REPO_BAG[1], qty: 2 }, REPO_BAG[2]]), `F1.${round} (repo app) a line removed in tab A stays removed after tab B changes another line`, brief(got))
      is(await rows(b).count() === 2, `F1b.${round} and tab B shows the bag as it is now (it followed tab A)`, `${await rows(b).count()} rows`)
      await ctx.close()
    }
    {
      const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
      await plusBtn(a, 1).click(); await until(async () => (await READ(a)).find((i) => i.key === 'shirt__XL__-')?.qty === 2)
      await rmBtn(b, 2).click(); await sleep(600)
      const got = await READ(a)
      is(sameBag(got, [REPO_BAG[0], { ...REPO_BAG[1], qty: 2 }]), `F2.${round} (repo app) a quantity raised in tab A survives tab B removing another line`, brief(got))
      await ctx.close()
    }
  }
  {
    // F3: the other tab empties the bag (a paid order): this tab does not put it back by changing nothing
    const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
    await b.evaluate(() => localStorage.setItem('sporta_cart', '[]'))
    await until(async () => (await rows(a).count()) === 0, 8000)
    is((await READ(a)).length === 0, 'F3 (repo app) the bag emptied in another tab is empty here too, and is not written back')
    await ctx.close()
  }
  {
    // F4: the order tracker shows the LAST lookup even when an older answer comes in after it
    const ctx = await browser.newContext(ctxOpts); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch (e) { /* blocked */ } })
    const slow = holder()
    await pg.route('**/api/api.php?r=status*', async (route) => {
      const id = new URL(route.request().url()).searchParams.get('id')
      if (id === 'SPAAAA11') await slow.wait()
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ payment_status: id === 'SPAAAA11' ? 'failed' : 'paid', amount: id === 'SPAAAA11' ? 11 : 22 }) })
    })
    await pg.goto(site.url + '/track'); await pg.waitForSelector('form input')
    const input = pg.locator('form input').first(), go = pg.locator('form button').first()
    await input.fill('SPAAAA11'); await go.click()
    await until(async () => slow.pending() === 1, 10000)
    await input.fill('SPBBBB22'); await go.click()
    await until(async () => (await pg.locator('.card').count()) === 1, 10000)
    slow.release(); await sleep(700)
    const card = await pg.locator('.card').first().innerText().catch(() => '')
    is(/SPBBBB22/.test(card) && !/SPAAAA11/.test(card), 'F4 (repo app) the tracker shows the order asked for LAST, not the slower earlier lookup', card.replace(/\s+/g, ' '))
    await ctx.close()
  }
  await site.close()
  if (!process.env.SPORTA_SRC_DIST) rmrf(dirname(dist))
})

// ============================================================================================================
await section('G  static', async () => {
  const boot = readFileSync(join(PUB, 'boot.js'), 'utf8')
  const mine = boot.slice(boot.indexOf('==== RACES:'))
  is(mine.length > 1000 && !mine.includes('$'), 'G1 the new blocks of boot.js have no dollar sign (the installer runs through docker compose, which interpolates them)')
  is(mine.includes('__sportaCartOwn') && readFileSync(join(WEB, 'src/lib/cart.jsx'), 'utf8').includes('window.__sportaCartOwn = true'), 'G2 boot.js stands down when src/lib/cart.jsx says it syncs the bag itself (the two halves use the same marker)')
  is(!/Storage\.prototype\.removeItem|\.clear\s*=/.test(mine), 'G3 only setItem and getItem are wrapped, only for the bag key')
  const gov = readFileSync(join(PUB, 'sporta-gov-autopick.js'), 'utf8')
  is(!gov.includes('$'), 'G4 sporta-gov-autopick.js still has no dollar sign')
})

if (live) await live.close()
await browser.close()
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} section(s) skipped (no live capture)` : ''}`)
process.exit(fail ? 1 : 0)
