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
// code is run: SPORTA_GUARDS_JS (public/birthday.js) / SPORTA_GOV_JS point the live sections at older copies of those add-ons, SPORTA_SRC_DIST
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
//   F  the repo's own app: the bag follows the other tab at once, and the order tracker shows the LAST lookup; (F6, added by the
//      review) the wishlist keeps both tabs' hearts even when one tab missed the other's `storage` event
//   G  static: the new blocks keep the project's "no dollar sign" rule and the two halves know about each other
//   H  the repo checkout: the code box, the bag changing under a code, the way back from the bank (needs the Checkout.jsx patch)
//   J  (added by the review) the "Added to bag" answer of public/sporta-features.js after the bag has shrunk (needs the K3-R patch)
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite, copyTree, serveSite, workDir, rmrf } from './checkout-split-harness.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(WEB, 'public')
const CAPTURE = process.env.SPORTA_LIVE_CAPTURE || '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'
const HAVE_CAPTURE = existsSync(join(CAPTURE, 'index.html')) && existsSync(join(CAPTURE, 'assets'))
const ROUNDS = Math.max(1, Number(process.env.RACE_ROUNDS || 2))
// the race guards for the compiled storefront live in public/birthday.js (see the comment at the head of its RACES block)
const GUARDS = readFileSync(process.env.SPORTA_GUARDS_JS || join(PUB, 'birthday.js'), 'utf8')
const GOV = readFileSync(process.env.SPORTA_GOV_JS || join(PUB, 'sporta-gov-autopick.js'), 'utf8')
// public/sporta-features.js belongs to another lane; the J fix for it was delivered as a patch (the lane that owns the file made the
// same fix itself, 'if (n0 < reported) reported = n0'), so the J section runs only when the file carries either form of it (SPORTA_FEATURES_JS points the suite at another copy; SPORTA_FEATURES_PATCHED=1 forces it).
const FEATURES = readFileSync(process.env.SPORTA_FEATURES_JS || join(PUB, 'sporta-features.js'), 'utf8')
const FEATURES_PATCHED = process.env.SPORTA_FEATURES_PATCHED === '1' || FEATURES.includes('RACE K3-R') || /if \((?:reported > n0|n0 < reported)\) reported = n0/.test(FEATURES)

let pass = 0, fail = 0, skipped = 0, noCapture = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ONLY = process.env.SPORTA_SECTIONS ? process.env.SPORTA_SECTIONS.split(',') : null
const section = async (title, fn, needsCapture = false) => {
  if (ONLY && !ONLY.includes(title.slice(0, 1))) return
  head(title)
  if (needsCapture && !HAVE_CAPTURE) { skipped++; noCapture++; console.log('SKIP no live capture here (set SPORTA_LIVE_CAPTURE); the real-app part of this section did not run'); return }
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
      if (name === 'birthday.js') return send(r, 200, MIME.js, GUARDS)
      if (name === 'sporta-gov-autopick.js') return send(r, 200, MIME.js, GOV)
      if (name === 'sporta-features.js') return send(r, 200, MIME.js, FEATURES)
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
// Chromium keeps a per-process copy of localStorage and hears of another tab's write a moment later (the same message that
// raises the `storage` event). A tab acting inside that moment reads the old bag; no page code can close it, and on this
// loaded machine the moment can be long. So before tab B acts, wait until its own process HAS the other tab's write: B is
// still stale as far as the page goes (it has not been told, and the compiled app never listens), only the read is fresh.
const caughtUp = async (a, b) => { const want = await a.evaluate(() => localStorage.getItem('sporta_cart')); return until(async () => (await b.evaluate(() => localStorage.getItem('sporta_cart'))) === want, 20000, 25) }
const spaTo = (pg, path) => pg.evaluate((p) => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
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
if (HAVE_CAPTURE && (!ONLY || ONLY.some((s) => 'ABCDEJ'.includes(s)))) live = await serveCapture()

// ============================================================================================================
await section('A  the bag is shared by every tab', async () => {
  const { base } = live
  for (let round = 1; round <= ROUNDS; round++) {
    // A1: a removal in tab A is not undone by a quantity change in tab B (B still holds the old bag)
    {
      const ctx = await liveCtx(base); const a = await openCart(ctx, base), b = await openCart(ctx, base)
      await lineBtn(a, 0, 'remove').click()
      await until(async () => (await stored(a)).length === 2); await caughtUp(a, b)
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
      await until(async () => (await stored(a)).find((i) => i.key === S.key)?.qty === 2); await caughtUp(a, b)
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
      const afterA = await stored(a); await caughtUp(a, b)
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
  // A6: the merge rules, against real Storage on a made-up origin: tab P loads the guards, tab Q is a bare page (the other tab)
  {
    const ORIGIN = 'https://race.test'
    const ctx = await browser.newContext(ctxOpts)
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url())
      if (u.origin !== ORIGIN) return route.abort()
      if (u.pathname === '/birthday.js') return route.fulfill({ contentType: 'text/javascript', body: GUARDS })
      return route.fulfill({ contentType: 'text/html', body: u.pathname === '/bare' ? '<!doctype html><title>q</title><body>q' : '<!doctype html><title>p</title><script src="/birthday.js"></script><body>p' })
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
    // The guard starts with the page: it takes the bag that is stored THEN as the bag the app has. So each case is: the other
    // tab stores the base, this tab (re)starts, the other tab stores `theirs`, this tab stores `mine`.
    const setIn = (pg, v) => pg.evaluate((x) => localStorage.setItem('sporta_cart', x === null ? 'not json' : JSON.stringify(x)), v)
    // Tab Q learns of tab P's write a moment after it is made (the browser's own message between its processes; see caughtUp), so
    // what Q reads is polled until it is what is expected or the moment is clearly over.
    const text = () => Q.evaluate(() => localStorage.getItem('sporta_cart'))
    // ...and the same the other way: before tab P restarts or acts, wait until P's process has what Q stored.
    const pRead = () => P.evaluate(() => localStorage.getItem('sporta_cart'))
    const setQ = async (v) => { await setIn(Q, v); const t = await text(); await until(async () => (await pRead()) === t, 8000, 25) }
    const settle = async (ok) => { await until(async () => ok(await text()), 8000, 25); return text() }
    const norm = (l) => JSON.stringify([...l].sort((x, y) => x.key.localeCompare(y.key)).map((i) => [i.key, i.qty, i.price]))
    for (const [name, base0, theirs, mine, want] of CASES) {
      await setQ(base0); await P.reload()
      await setQ(theirs); await setIn(P, mine)
      const got = JSON.parse(await settle((t) => { try { return norm(JSON.parse(t)) === norm(want) } catch (e) { return false } }))
      is(norm(got) === norm(want), `A6 merge: ${name}`, JSON.stringify(got.map((i) => [i.key, i.qty, i.price])))
    }
    // untouched bag: this tab's own string is stored byte for byte
    await setQ([{ key: 'a', qty: 1 }]); await P.reload()
    const own = '[{"key":"a","qty":2,"extra":"é"}]'
    await P.evaluate((v) => localStorage.setItem('sporta_cart', v), own)
    is((await settle((t) => t === own)) === own, 'A6 nothing changed elsewhere: this tab\'s own string is stored byte for byte')
    // an empty bag at start is a bag: what the other tab added meanwhile is kept
    await Q.evaluate(() => localStorage.removeItem('sporta_cart')); await until(async () => (await pRead()) === null, 8000, 25); await P.reload()
    await setQ([L('z', 1)]); await setIn(P, [L('a', 1)])
    is(JSON.stringify(JSON.parse(await settle((t) => t && t.includes('"z"') && t.includes('"a"'))).map((i) => i.key).sort()) === '["a","z"]', 'A6 a bag that was empty at start still keeps what the other tab added meanwhile')
    // an unparsable value is never "repaired"
    await setQ([L('y', 1)]); await P.reload()
    await P.evaluate(() => localStorage.setItem('sporta_cart', 'not json'))
    is((await settle((t) => t === 'not json')) === 'not json', 'A6 an unparsable value is stored as given (never "repaired")')
    // the repo app's marker
    await setQ([L('x', 1)]); await P.reload(); await setQ([L('y', 1)])
    await P.evaluate(() => { window.__sportaCartOwn = true; localStorage.setItem('sporta_cart', '[{"key":"a","qty":1}]') })
    is((await settle((t) => t === '[{"key":"a","qty":1}]')) === '[{"key":"a","qty":1}]', 'A6 when the repo app says it syncs the bag itself (window.__sportaCartOwn) the guard stands down')
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
// "Continue": click the primary button and wait until the form has moved on (its label changes) before the next step; a click that
// lands while the form is redrawing is repeated once.
const nextStep = async (pg) => {
  const primary = () => pg.locator('button[type=submit]:visible:not([disabled])').first()
  const label = async () => ((await primary().textContent().catch(() => '')) || '').trim()
  const before = await label()
  for (let i = 0; i < 3; i++) {
    const b = primary(); await b.waitFor(); await b.click()
    if (await until(async () => (await label()) !== before, 8000, 100)) break
  }
  await pg.waitForTimeout(200)
}
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
  // B6: a page chunk that cannot be fetched mid-navigation (a deploy replaced it) leaves a screen with a way out, and the way works
  {
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/about'); await pg.waitForSelector('h1')
    let blocked = true
    await pg.route('**/assets/Cart-*.js', (r) => (blocked ? r.abort() : r.continue()))
    await spaTo(pg, '/cart')
    const reload = pg.getByRole('button', { name: /reload page/i })
    const shown = await until(async () => (await reload.count()) === 1, 20000)
    is(shown, 'B6a a page chunk that fails to load shows a "Reload page" screen, not a blank page')
    blocked = false
    if (shown) { await reload.first().click(); is(await until(async () => (await pg.locator('.cart-line').count()) > 0, 30000), 'B6b and pressing it, once the file is back, brings the page up') }
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
    // the Enter key in the code box is a second way to ask (a held key repeats it): the button is disabled while a request is
    // out, the key was not, so every repeat was another request (each wrong code counts against the server's failed-code throttle)
    rig.posts.length = 0
    const h = holder(); rig.hold.discount = (b) => (JSON.parse(b).code ? h.wait() : null)
    const ctx = await liveCtx(base); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await fillDelivery(pg); await nextStep(pg)
    await pg.getByRole('button', { name: /discount code/i }).first().click()
    const code = pg.locator('input.font-mono').first()
    await code.fill('save10')
    await code.press('Enter'); await code.press('Enter'); await code.press('Enter')
    await sleep(900)
    const coupons = rig.posts.filter((p) => p.route === 'discount' && JSON.parse(p.body).code)
    is(coupons.length === 1, 'C2b three Enter presses in the code box while the first answer is out: ONE coupon request', `${coupons.length}`)
    h.release(); rig.hold.discount = null
    await sleep(500)
    is((await pg.locator('.purchase-checkout-summary code.font-mono, code.font-mono').count()) >= 1, 'C2c and the code shows as applied once the answer arrives')
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
const openNote = async (pg) => {
  const fold = pg.locator('button.sporta-fold--note[aria-expanded="false"]'); if (await fold.count()) await fold.first().click()
  await pg.waitForSelector('#f-note', { state: 'visible' }); await pg.waitForSelector('#sporta-loc-btn')
}
const note = (pg) => pg.inputValue('#f-note')
// Tap "Share my location" and wait for the lookup to start. The control is re-inserted by the add-on a moment after the page
// redraws, and a tap that lands in that moment (this machine is slow enough to hit it) goes to a node that is leaving: tap again.
const tapShare = async (pg, calls) => {
  for (let i = 0; i < 4; i++) {
    await pg.click('#sporta-loc-btn')
    if (await until(async () => (await pg.evaluate(() => window.__geo.calls)) === calls, 4000)) return true
  }
  return false
}

await section('E  the location control against the real checkout', async () => {
  const { base } = live
  {
    // E1: share, leave the checkout while the position is pending, come back: the late answer is for a page that is gone
    const ctx = await liveCtx(base, { geo: true }); await ctx.addInitScript(GEO)
    const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await pg.waitForSelector('input[name=name]'); await openNote(pg)
    is((await tapShare(pg, 1)) && await pg.locator('#sporta-loc-btn').isDisabled(), 'E1a the tap asks once and the control is busy (disabled) while it waits')
    await spaTo(pg, '/cart'); await pg.waitForSelector('.cart-line')
    is((await pg.locator('#sporta-loc').count()) === 0, 'E1b the control is gone from the bag page')
    await pg.goBack(); await pg.waitForSelector('input[name=name]'); await openNote(pg)
    await pg.evaluate(() => window.__geoRelease(0)) // the OLD answer arrives now
    await sleep(700)
    is((await note(pg)) === '' && (await pg.locator('#sporta-loc-btn').getAttribute('data-act')) === 'share' && !(await pg.locator('#sporta-loc-btn').isDisabled()), 'E1c the late answer of the abandoned lookup writes nothing: empty note, control idle', `note="${await note(pg)}"`)
    await tapShare(pg, 2)
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
    await tapShare(pg, 1)
    await pg.fill('#f-note', 'Gate 3, ring twice')
    await pg.evaluate(() => window.__geoRelease(0))
    await until(async () => PIN.test(await note(pg)))
    is((await note(pg)).startsWith('Gate 3, ring twice ') && PIN.test(await note(pg)), 'E2a words typed while the lookup waited are kept, the line follows them', await note(pg))
    await nextStep(pg); await nextStep(pg)
    const fin = pg.locator('button[type=submit]:visible:not([disabled])').filter({ hasText: /place order|pay with/i }).first()
    await fin.click(); await until(async () => orders().length === 1)
    const sent = orders().length ? JSON.parse(orders()[0].body).customer.note : ''
    is(sent.startsWith('Gate 3, ring twice ') && sent.match(/maps\?q=/g)?.length === 1, 'E2b the order carries the words and ONE location line (what the shopper saw)', sent)
    await pg.waitForURL(/payment\/result/, { timeout: 60000 }).catch(() => {}) // a cash order leaves the page; read the details after it has
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
    await tapShare(pg, 1); await pg.evaluate(() => window.__geoRelease(0))
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
  {
    // E5: the language is switched while the lookup waits: the answer is written and worded in the language of the page NOW
    const ctx = await liveCtx(base, { lang: 'ar', geo: true }); await ctx.addInitScript(GEO)
    const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.goto(base + '/checkout'); await pg.waitForSelector('input[name=name]'); await openNote(pg)
    await tapShare(pg, 1)
    await pg.locator('.navbar-language').first().click()
    await until(async () => (await pg.evaluate(() => document.documentElement.lang)) === 'en')
    await pg.evaluate(() => window.__geoRelease(0))
    await until(async () => PIN.test(await note(pg)))
    await sleep(400)
    const st = await pg.locator('#sporta-loc-status').innerText()
    is(/^Location: /.test(await note(pg)) && /Location added/.test(st) && (await pg.locator('#sporta-loc-btn').innerText()) === 'Remove', 'E5 switched to English while waiting: the line starts "Location:", the status and the button are English', `${await note(pg)} | ${st}`)
    await ctx.close()
  }
  {
    // E4: the add-on arrives LATE (one slow request for this one file) after the checkout has already been drawn from the
    // stored details, which still hold a pin written before the strip-on-write fix existed. The page keeps the pin in memory.
    rig.posts.length = 0
    const saved = { name: 'Test Shopper', phone: '55512345', governorate: 'hawalli', area: 'Salmiya', block: '5', street: 'Salem Street', building: '12', floor: '', flat: '', note: 'Gate 3 Location: https://www.google.com/maps?q=29.375912,47.977446' }
    const ctx = await liveCtx(base)
    await ctx.addInitScript((d) => { try { if (!localStorage.getItem('__seeded2')) { localStorage.setItem('__seeded2', '1'); localStorage.setItem('sporta.delivery', JSON.stringify(d)) } } catch (e) { /* blocked */ } }, saved)
    const gate = holder()
    await ctx.route('**/sporta-gov-autopick.js*', async (route) => { await gate.wait(); await route.continue() })
    const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    const nav = pg.goto(base + '/checkout').catch(() => {})
    await pg.waitForSelector('.purchase-quick__delivery', { timeout: 90000 })
    const early = await pg.locator('.purchase-quick__delivery').innerText()
    is(/maps/.test(early), 'E4a (set-up) the checkout was drawn from the stored details before the add-on ran, so it shows the old pin', early)
    gate.release(); await nav
    await until(async () => (await pg.evaluate(() => !!window.__sportaLocJs)), 30000)
    await sleep(2500)
    await pg.waitForSelector('.purchase-quick__delivery', { timeout: 60000 })
    const late = await pg.locator('.purchase-quick__delivery').innerText().catch(() => '')
    is(!/maps/.test(late), 'E4b once the late add-on has run, the page no longer holds the old pin (it reloads from the cleaned details)', late)
    await pg.locator('.purchase-quick__submit').first().click(); await until(async () => orders().length === 1, 20000)
    const sent = orders().length ? JSON.parse(orders()[0].body).customer.note : ''
    is(sent === 'Gate 3', 'E4c the order carries "Gate 3" and not the old pin', sent)
    await ctx.close()
  }
}, true)

// ============================================================================================================
// J (second look, lane K3 review): public/sporta-features.js remembers the highest bag total it has announced ("reported") so two
// overlapping taps announce one piece once. That mark never came down: after the shopper removed pieces, the next add reached a
// lower total that had never been announced and stayed silent (no "Added", no notice) for the rest of the page's life.
await section('J  the "Added to bag" answer after the bag has shrunk', async () => {
  if (!FEATURES_PATCHED) { skipped++; console.log('SKIP public/sporta-features.js does not lower its announcement mark yet (the fix is one line in watch(): if (n0 < reported) reported = n0); the section did not run'); return }
  const { base } = live
  const ctx = await liveCtx(base, { bag: [] }); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
  const toast = () => pg.evaluate(() => { const t = document.querySelector('.sporta-u3-toast'); return !!(t && t.hasAttribute('data-open')) })
  const calm = () => pg.evaluate(() => { const t = document.querySelector('.sporta-u3-toast'); if (t) t.removeAttribute('data-open') })
  await pg.goto(base + '/product/sgomma-t-shirt-navy'); await pg.waitForSelector('h1')
  const add = async () => { const m = pg.getByRole('button', { name: 'M', exact: true }).first(); if ((await m.getAttribute('aria-pressed')) !== 'true') await m.click(); await pg.locator('.product-purchase-row .btn-primary').first().click() }
  await add()
  is(await until(toast, 8000), 'J1 the first add is announced (a notice with "View bag")')
  await calm(); await sleep(1800)
  await spaTo(pg, '/cart'); await pg.waitForSelector('.cart-line')
  await pg.locator('.cart-line').first().locator('button').last().click()
  await until(async () => (await stored(pg)).length === 0, 8000)
  await pg.goBack(); await pg.waitForSelector('h1'); await sleep(500); await calm()
  await add()
  is(await until(toast, 8000), 'J2 add, remove it from the bag, add again: the second add is announced too (the old mark kept it silent)')
  await calm(); await sleep(1800)
  await add()
  is(await until(toast, 8000), 'J3 and a further add (a higher total) is announced as before')
  await ctx.close()
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
  const cart = async (ctx) => { const pg = await ctx.newPage(); pg.setDefaultTimeout(90000); await pg.goto(site.url + '/cart'); await pg.waitForSelector('main ul > li button[aria-label="Remove"]'); await pg.waitForTimeout(400); return pg }
  const rows = (pg) => pg.locator('main ul > li').filter({ has: pg.locator('button[aria-label="Remove"]') })
  // a row is found by its product name: once a tab follows the other, the row numbers are no longer what they were
  const rowOf = (pg, name) => rows(pg).filter({ hasText: name }).first()
  const rmBtn = (pg, name) => rowOf(pg, name).locator('button[aria-label="Remove"]')
  const plusBtn = (pg, name) => rowOf(pg, name).locator('button[aria-label="Increase quantity"]')
  const READ = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))
  for (let round = 1; round <= ROUNDS; round++) {
    {
      const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
      await rmBtn(a, 'Jacket').click(); await until(async () => (await READ(a)).length === 2); await caughtUp(a, b)
      await plusBtn(b, 'Shirt').click(); await sleep(600)
      const got = await READ(a)
      is(sameBag(got, [{ ...REPO_BAG[1], qty: 2 }, REPO_BAG[2]]), `F1.${round} (repo app) a line removed in tab A stays removed after tab B changes another line`, brief(got))
      is(await rows(b).count() === 2, `F1b.${round} and tab B shows the bag as it is now (it followed tab A)`, `${await rows(b).count()} rows`)
      await ctx.close()
    }
    {
      // F1c: tab B is not touched at all and still shows what tab A did
      const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
      await rmBtn(a, 'Jacket').click()
      const followed = await until(async () => (await rows(b).count()) === 2 && (await rows(b).filter({ hasText: 'Jacket' }).count()) === 0, 10000)
      is(followed, `F1c.${round} (repo app) a tab nobody touched drops the line removed in the other tab`, `${await rows(b).count()} rows`)
      await ctx.close()
    }
    {
      const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
      await plusBtn(a, 'Shirt').click(); await until(async () => (await READ(a)).find((i) => i.key === 'shirt__XL__-')?.qty === 2); await caughtUp(a, b)
      await rmBtn(b, 'Leggings').click(); await sleep(600)
      const got = await READ(a)
      is(sameBag(got, [REPO_BAG[0], { ...REPO_BAG[1], qty: 2 }]), `F2.${round} (repo app) a quantity raised in tab A survives tab B removing another line`, brief(got))
      await ctx.close()
    }
  }
  {
    // F3: the other tab empties the bag (a paid order): this tab does not put it back by changing nothing
    const ctx = await ctxFor(); const a = await cart(ctx), b = await cart(ctx)
    await b.evaluate(() => localStorage.setItem('sporta_cart', '[]'))
    const followed = await until(async () => (await rows(a).count()) === 0, 8000)
    is(followed && (await READ(a)).length === 0, 'F3 (repo app) the bag emptied in another tab is empty here too, and is not written back')
    await ctx.close()
  }
  {
    // F5: a tab that was frozen (a background tab, the back/forward cache) never hears the `storage` event; coming back reads the bag
    const ctx = await ctxFor(); const a = await cart(ctx)
    await a.evaluate(() => localStorage.setItem('sporta_cart', JSON.stringify([{ key: 'shirt__XL__-', slug: 'shirt', size: 'XL', fit: null, name: { en: 'Shirt', ar: 'قميص' }, price: 5, image: '', qty: 3 }])))
    await sleep(500) // a write made in THIS tab raises no event here, which is the missed event
    const stale = (await rows(a).count()) === 3
    await a.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    const back = await until(async () => (await rows(a).count()) === 1, 8000)
    is(stale && back, 'F5 (repo app) a page restored from the back/forward cache reads the bag again', `stale=${stale} refreshed=${back}`)
    await a.evaluate(() => localStorage.setItem('sporta_cart', '[]'))
    await a.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
    is(await until(async () => (await rows(a).count()) === 0, 8000), 'F5b (repo app) and so does a tab that becomes visible again')
    await ctx.close()
  }
  {
    // F6 (second look, lane K3 review): the wishlist is the same hole as the bag was. Its `storage` listener only hears a tab that
    // is awake; a frozen tab (background, back/forward cache) misses the event, and the list used to be written back from that
    // tab's own React state, so its next heart erased the other tab's. A write made in THIS tab raises no event here, which is
    // the missed event (the same device F5 uses). The two slugs are learned from the app itself: tap a heart, read what it stored.
    const ctx = await browser.newContext(ctxOpts)
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('lang', 'en') } } catch (e) { /* blocked */ } })
    const W = () => [...document.querySelectorAll('button[aria-label*="wishlist" i]')]
    const READW = (pg) => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('sporta_wishlist') || '[]') } catch (e) { return null } })
    const hearts = (pg) => pg.locator('button[aria-label*="wishlist" i]')
    const shop = async () => { const pg = await ctx.newPage(); pg.setDefaultTimeout(90000); await pg.goto(site.url + '/shop'); await hearts(pg).first().waitFor(); await pg.waitForTimeout(500); return pg }
    const a = await shop()
    const slugOf = async (i) => { await hearts(a).nth(i).click(); const l = await until(async () => { const v = await READW(a); return v && v.length === 1 ? v : false }, 8000); await hearts(a).nth(i).click(); await until(async () => (await READW(a)).length === 0, 8000); return l && l[0] }
    const s0 = await slugOf(0), s1 = await slugOf(1)
    const known = !!s0 && !!s1 && s0 !== s1
    is(known, 'F6a (set-up) two different products can be hearted and un-hearted in tab A', JSON.stringify([s0, s1]))
    if (known) {
      for (let round = 1; round <= ROUNDS; round++) {
        await a.reload(); await hearts(a).first().waitFor(); await a.waitForTimeout(500)
        // tab B hearts product 1; tab A is frozen and never hears of it (the write is made from A itself)
        await a.evaluate((v) => localStorage.setItem('sporta_wishlist', v), JSON.stringify([s1]))
        await hearts(a).nth(0).click()
        const got = await until(async () => { const v = await READW(a); return v && v.length >= 1 ? v : false }, 8000)
        await sleep(300)
        const now = await READW(a)
        is(Array.isArray(now) && now.length === 2 && now.includes(s0) && now.includes(s1), `F6b.${round} (repo app) a heart in a tab that missed the other tab's heart keeps both`, JSON.stringify(now))
        await a.evaluate(() => localStorage.setItem('sporta_wishlist', '[]'))
      }
      // F6c / F6d: a frozen tab that becomes visible / is restored from the cache reads the list again (the heart shows it)
      for (const [id, what, trigger] of [
        ['F6c', 'a tab that becomes visible again', () => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) }],
        ['F6d', 'a page restored from the back/forward cache', () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))],
      ]) {
        await a.evaluate(() => localStorage.setItem('sporta_wishlist', '[]'))
        await a.reload(); await hearts(a).first().waitFor(); await a.waitForTimeout(500)
        await a.evaluate((v) => localStorage.setItem('sporta_wishlist', v), JSON.stringify([s1]))
        await sleep(300)
        const stale = (await hearts(a).nth(1).getAttribute('aria-pressed')) === 'false'
        await a.evaluate(trigger)
        const shown = await until(async () => (await hearts(a).nth(1).getAttribute('aria-pressed')) === 'true', 8000)
        is(stale && shown, `${id} (repo app) ${what} shows the hearts saved meanwhile`, `stale=${stale} refreshed=${shown}`)
      }
      // F6e: an awake tab still follows at once (the storage event path is untouched)
      const b = await shop()
      await hearts(a).nth(0).click()
      is(await until(async () => (await hearts(b).nth(0).getAttribute('aria-pressed')) === 'true', 8000), 'F6e (repo app) a heart in tab A shows in tab B without a reload')
    }
    await ctx.close()
  }
  {
    // F7 (second look, lane K3 review): the checkout attempt id outlived a DECLINED payment. A declined card closes the order, a
    // repeated track id for a closed order is answered order_not_pending, and the repo's attempt id was only let go on a paid or cash
    // result, so the shopper who came back and tried the same bag again was refused in that tab. (The compiled live build ends the
    // attempt on failed and cancelled; this is the repo storefront catching up.) A cancelled payment leaves the order pending: its id stays.
    const probe = async (status, paymentStatus, attemptId, trackid) => {
      const ctx = await browser.newContext(ctxOpts); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
      await pg.addInitScript((id) => { try { localStorage.setItem('lang', 'en'); if (!sessionStorage.getItem('__a')) { sessionStorage.setItem('__a', '1'); sessionStorage.setItem('sporta.checkout.attempt', JSON.stringify({ fp: 'x1', id })) } } catch (e) { /* blocked */ } }, attemptId)
      await pg.route('**/api/api.php?r=status*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ payment_status: paymentStatus, amount: 11 }) }))
      await pg.goto(site.url + `/payment/result?status=${status}&trackid=${trackid}`)
      await pg.waitForSelector('h1'); await until(async () => (await pg.locator('h1').innerText()) !== '…', 15000); await sleep(400)
      const left = await pg.evaluate(() => sessionStorage.getItem('sporta.checkout.attempt'))
      await ctx.close()
      return left
    }
    is((await probe('failed', 'failed', 'SPDECLINED1', 'SPDECLINED1')) === null, 'F7a (repo app) a declined payment ends the checkout attempt, so the next try is a new order')
    is((await probe('failed', 'failed', 'SPNEWERBAG2', 'SPDECLINED1')) !== null, 'F7b but only its own attempt: a tab that has since started another attempt keeps that id')
    is((await probe('cancelled', 'pending', 'SPCANCELLED3', 'SPCANCELLED3')) !== null, 'F7c and a cancelled payment (the order is still pending) keeps its id, so the retry is the same order')
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
// H needs src/pages/Checkout.jsx to carry the three fixes below. That file belongs to another lane, so they are delivered
// as a patch (scratchpad races/K3/checkout-races.patch); until it is applied this section says so instead of failing.
// SPORTA_CHECKOUT_PATCHED=1 forces it (used to show the unpatched build failing, and the patched one passing).
const CHECKOUT_PATCHED = process.env.SPORTA_CHECKOUT_PATCHED === '1' || readFileSync(join(WEB, 'src/pages/Checkout.jsx'), 'utf8').includes('RACE K3-')
await section('H  the repo checkout: the code box, the bag changing under a code, the way back from the bank', async () => {
  if (!CHECKOUT_PATCHED) { skipped++; console.log('SKIP src/pages/Checkout.jsx does not carry the K3 fixes yet (races/K3/checkout-races.patch); the section did not run'); return }
  const dist = process.env.SPORTA_SRC_DIST || (() => { const dir = workDir('race-client-h'); return buildSite(copyTree(dir), join(dir, 'dist')) })()
  const site = await serveSite(dist)
  const LINES = [
    { key: 'jacket__M__-', slug: 'jacket', size: 'M', fit: null, name: { en: 'Jacket', ar: 'جاكيت' }, price: 10, image: '', qty: 2 },
    { key: 'shirt__XL__-', slug: 'shirt', size: 'XL', fit: null, name: { en: 'Shirt', ar: 'قميص' }, price: 5, image: '', qty: 1 },
  ]
  const ctxFor = async () => {
    const ctx = await browser.newContext(ctxOpts)
    await ctx.addInitScript((b) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('lang', 'en'); localStorage.setItem('sporta_cart', JSON.stringify(b)); localStorage.setItem('sporta.delivery.remember', '0') } } catch (e) { /* blocked */ } }, LINES)
    return ctx
  }
  const fill = async (pg) => {
    await pg.waitForSelector('#f-name')
    await pg.fill('#f-name', 'Test Shopper'); await pg.fill('#f-phone', '55512345')
    await pg.selectOption('#f-governorate', 'hawalli'); await pg.fill('#f-area', 'Salmiya')
    await pg.fill('#f-block', '5'); await pg.fill('#f-street', 'Salem Street'); await pg.fill('#f-building', '12')
  }
  {
    // H1: the Enter key in the code box
    let asked = 0
    const slow = holder()
    const ctx = await ctxFor(); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.route('**/api/api.php?r=discount', async (route) => { const b = JSON.parse(route.request().postData() || '{}'); if (b.code) { asked++; await slow.wait() } await route.fallback() })
    await pg.goto(site.url + '/checkout'); await pg.waitForSelector('input.font-mono')
    await pg.locator('input.font-mono').fill('save10')
    await pg.locator('input.font-mono').press('Enter'); await pg.locator('input.font-mono').press('Enter'); await pg.locator('input.font-mono').press('Enter')
    await sleep(800)
    is(asked === 1, 'H1 (repo checkout) three Enter presses in the code box while the first answer is out: ONE coupon request', `${asked}`)
    slow.release(); await ctx.close()
  }
  {
    // H2: the bag changes (another tab) while the code's answer is out: the answer is for a bag that is gone
    const slow = holder()
    const ctx = await ctxFor(); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.route('**/api/api.php?r=discount', async (route) => { const b = JSON.parse(route.request().postData() || '{}'); if (b.code) await slow.wait(); await route.fallback() })
    await pg.goto(site.url + '/checkout'); await pg.waitForSelector('input.font-mono')
    const other = await ctx.newPage(); await other.goto(site.url + '/cart'); await other.waitForSelector('main ul > li')
    await pg.locator('input.font-mono').fill('save10'); await pg.locator('input.font-mono').press('Enter')
    await until(async () => slow.pending() === 1, 10000)
    await other.locator('main ul > li').filter({ hasText: 'Shirt' }).first().locator('button[aria-label="Remove"]').click()
    await until(async () => (await pg.evaluate(() => (JSON.parse(localStorage.getItem('sporta_cart') || '[]')).length)) === 1, 10000)
    await until(async () => !/Shirt/.test(await pg.locator('.card, aside, form').first().innerText()), 10000)
    slow.release(); await sleep(900)
    const shown = await pg.locator('code.font-mono').count()
    is(shown === 0, 'H2 (repo checkout) a code answered for the OLD bag is not shown as applied to the new one', `applied badges: ${shown}`)
    await ctx.close()
  }
  {
    // H3: the way back from the bank (the page restored from the back/forward cache while busy)
    const ctx = await ctxFor(); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000)
    await pg.route('**/knet/pay.php**', (r) => r.fulfill({ status: 204, body: '' }))
    await pg.goto(site.url + '/checkout'); await fill(pg)
    await pg.locator('button[type=submit]:visible').last().click()
    await until(async () => (await pg.locator('form[aria-busy="true"]').count()) === 1, 15000)
    await pg.evaluate(() => { window.__marker = 1 })
    await pg.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await sleep(120)
    is(await pg.evaluate(() => window.__marker === 1) && (await pg.locator('form[aria-busy="true"]').count()) === 0, 'H3 (repo checkout) coming back from the bank clears the busy form in place (no reload, the typed details stay)')
    is((await pg.inputValue('#f-name')) === 'Test Shopper', 'H3b and the details are still in the form')
    await ctx.close()
  }
  await site.close()
  if (!process.env.SPORTA_SRC_DIST) rmrf(dirname(dist))
})

// ============================================================================================================
await section('M  the bag guard against a model (two tabs, random actions, one canonical bag)', async () => {
  const r = spawnSync(process.execPath, [join(WEB, 'scripts/race-client-model.mjs')], {
    env: { ...process.env, GUARD_JS: process.env.SPORTA_GUARDS_JS || join(PUB, 'birthday.js'), RUNS: process.env.RACE_MODEL_RUNS || '400' }, encoding: 'utf8', timeout: 240000,
  })
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n')
  is(r.status === 0, 'M1 400 random sequences of adds, + presses, removals and reloads in two tabs: what is stored always equals the one canonical bag', out.join(' | ').slice(0, 400))
})

// ============================================================================================================
await section('G  static', async () => {
  const bday = readFileSync(join(PUB, 'birthday.js'), 'utf8')
  const mine = bday.slice(bday.indexOf('==== RACES:'))
  is(mine.length > 1000 && !mine.includes('$'), 'G1 the race guards in birthday.js have no dollar sign (the installer runs through docker compose, which interpolates them)')
  is(mine.includes('__sportaCartOwn') && readFileSync(join(WEB, 'src/lib/cart.jsx'), 'utf8').includes('window.__sportaCartOwn = true'), 'G2 the bag guard stands down when src/lib/cart.jsx says it syncs the bag itself (the two halves use the same marker)')
  is(!/Storage\.prototype\.removeItem|\.clear\s*=/.test(mine), 'G3 only setItem and getItem are wrapped, only for the bag key')
  is(readFileSync(join(PUB, 'boot.js'), 'utf8').length < 7000, 'G3b boot.js (a blocking script) did not grow: the guards are in the deferred add-on')
  const gov = readFileSync(join(PUB, 'sporta-gov-autopick.js'), 'utf8')
  is(!gov.includes('$'), 'G4 sporta-gov-autopick.js still has no dollar sign')
  const sw = readFileSync(join(PUB, 'sw.js'), 'utf8'), mainJsx = readFileSync(join(WEB, 'src/main.jsx'), 'utf8')
  is(/skipWaiting/.test(sw) && /clients\.claim/.test(sw) && !/controllerchange/.test(sw + mainJsx) && !/location\.reload|navigate\(/.test(sw), 'G5 a service worker takeover (skipWaiting + claim) never reloads or navigates an open page, so it cannot reset a checkout that is being filled in')
})

if (live) await live.close()
await browser.close()
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} section(s) skipped${noCapture ? ` (${noCapture} for lack of the live capture)` : ''}` : ''}`)
process.exit(fail ? 1 : 0)
