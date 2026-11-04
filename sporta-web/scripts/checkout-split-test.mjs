// The checkout's chunks: what it loads, what it asks for while the shopper uses it, and what happens
// when one cannot be fetched.
//
//   npm run test:checkout-split
//
// THE DECISION THIS SUITE HOLDS
// /checkout was already a lazy route chunk (src/pages/Checkout.jsx, React.lazy in App.jsx): nobody browsing
// the shop downloads it. Measured (scripts/checkout-split-measure.mjs), the page chunk is 26.3 kB raw / 7.1 kB
// Brotli, and everything in it is either always on screen (the form, the summary, the payment choice) or used
// by every shopper (the area list). Splitting pieces OUT of it was built and measured and does not pay: the
// quick-checkout card, the one view only some shoppers see, made a first-time shopper's download 0.4-0.7 kB
// bigger and a returning shopper's 1.6-2.0 kB bigger, because the code that loads, retries and reserves space
// for a part costs more than the part, and it added a way for the checkout to fail that it did not have. A
// request for the checkout chunk in the document (so it travels with the entry script instead of after it)
// saved ~0.3 s to the first field on a throttled phone but made the Arabic page shift (0.01-0.09) in 10 of 67
// loads while its loading skeleton was up. So the page is NOT split further and is NOT preloaded; B, C and D pin
// that down:
// the checkout page is the same files, requested the same way, and every interaction in its form is served
// by code already on the device.
//
// What this change adds is what happens when a lazy page cannot be fetched (the network drops, or the tab
// was opened before a deploy removed the old hashed file): the page used to be EMPTY. vite.config.js now puts
// a few lines in the built index.html that leave a message and a Try again button (section E).
//
//   A  the build: the checkout is its own chunk, the document does not load it, the page is not heavier,
//      and the cost every page pays for the failure message is bounded
//   B  landing on /checkout (en and ar, phone): the same files as before, each fetched once, under the
//      production Content-Security-Policy with no violation, the form works
//   C  nothing checkout reaches other pages: /, /shop and /cart request no checkout page before intent
//   D  the shop's own prefetch on intent (hover and touch on the bag's Checkout link) works and still
//      refuses Save-Data and 2G; the form's interactions (area list, coupon, payment choice, location
//      control, "remember") request no JavaScript at all
//   E  a lazy page that cannot be fetched leaves a message and a Retry button, never an empty page, in
//      English and Arabic; Retry recovers once the file is back; a failed PREFETCH and an import error on a
//      working page show nothing
//   F  the order the checkout sends is the same JSON as the commit before sends (knet, cash, coupon, T-Pay,
//      quick card), and carries no price, total or amount anywhere
//   G  the tab order of the page is the same as before
//   H  layout shift on the checkout (form and quick card, en and ar, 390 and 1280): no worse than before and
//      under the project's budget; and EXACTLY zero with the fonts blocked, which is how the project shows the
//      small remainder is the font swap and nothing in the checkout
//
// Mutation check: scripts/checkout-split-mutants.mjs removes one behaviour at a time from a COPY of the tree
// and requires this suite to fail for each. Environment: SPLIT_ROOT (build this tree instead of the working
// copy), SPLIT_BEFORE_DIST / SPLIT_AFTER_DIST (use built directories), SPLIT_SECTIONS=A,E (only those),
// SPLIT_WORK (where to build), CHROMIUM_PATH.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import {
  CART, PRE_SPLIT_REF, SAVED, WEB, buildSite, exportRef, launch, phone, rmrf, seed, serveSite, throttle, workDir,
} from './checkout-split-harness.mjs'

let pass = 0
let fail = 0
const is = (ok, msg, detail = '') => {
  if (ok) { pass++; console.log(`ok   ${msg}`) } else { fail++; console.log(`FAIL ${msg}${detail ? `  -- ${detail}` : ''}`) }
}
// SPLIT_SECTIONS=A,E runs only those sections (the mutation runner uses it to stay fast).
const SECTIONS = (process.env.SPLIT_SECTIONS || '').split(',').filter(Boolean)
const head = (t) => {
  const on = !SECTIONS.length || SECTIONS.includes(t[0])
  if (on) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)
  return on
}
const br = (buf) => brotliCompressSync(buf).length

const tmp = workDir('split')
let browser
try {
  // ------------------------------------------------------------------ builds
  const root = process.env.SPLIT_ROOT || WEB
  const after = process.env.SPLIT_AFTER_DIST || buildSite(root, join(tmp, 'after'))
  const before = process.env.SPLIT_BEFORE_DIST || buildSite(exportRef(PRE_SPLIT_REF, join(tmp, 'ref')), join(tmp, 'before'))

  const assets = (dist) => readdirSync(join(dist, 'assets'))
  const file = (dist, re) => assets(dist).find((f) => re.test(f))
  const html = (dist) => readFileSync(join(dist, 'index.html'), 'utf8')
  const imports = (dist, f) => {
    const src = readFileSync(join(dist, 'assets', f), 'utf8')
    return [...src.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)].map((m) => m[1])
  }
  const closure = (dist, start) => {
    const seen = new Set()
    const walk = (f) => { if (seen.has(f)) return; seen.add(f); for (const i of imports(dist, f)) walk(i) }
    for (const f of start) walk(f)
    return seen
  }

  // ------------------------------------------------------------------ A. the build
  if (head('A  the build')) {
    const page = file(after, /^Checkout-.*\.js$/)
    const h = html(after)
    const entry = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(h)?.[1]
    is(!!page && !!entry, 'A1 the checkout is its own chunk, separate from the entry script', `${page} / ${entry}`)
    is(!/modulepreload[^>]*Checkout|<script[^>]*src="[^"]*Checkout/.test(h), 'A2 the document does not load the checkout (that would charge every page for it)')
    const closureNow = [...closure(after, [page])]
    is(!closureNow.some((f) => /^(AdminApp)-/.test(f)), 'A3 the checkout does not drag the admin in', closureNow.join(','))

    // The cost every page pays, and the cost of the checkout itself.
    const brOf = (dist, names) => names.reduce((a, f) => a + br(readFileSync(join(dist, 'assets', f))), 0)
    const inEntry = closure(after, [entry, ...[...h.matchAll(/<link rel="modulepreload"[^>]*href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])])
    const nowFiles = closureNow.filter((f) => !inEntry.has(f))
    const thenFiles = [file(before, /^Checkout-.*\.js$/), file(before, /^CheckoutSteps-.*\.js$/), file(before, /^checkout-.*\.js$/)]
    const pageNow = brOf(after, nowFiles)
    const pageThen = brOf(before, thenFiles)
    console.log(`     checkout page files, Brotli: ${pageThen} B before, ${pageNow} B now (${nowFiles.length} files)`)
    is(pageNow <= pageThen + 200, 'A4 the checkout page is not heavier than before', `${pageNow} vs ${pageThen}`)
    const htmlNow = br(readFileSync(join(after, 'index.html')))
    const htmlThen = br(readFileSync(join(before, 'index.html')))
    console.log(`     index.html, Brotli: ${htmlThen} B before, ${htmlNow} B now (+${htmlNow - htmlThen} on every page)`)
    is(htmlNow - htmlThen <= 700, 'A5 the document grows by under 700 B Brotli (the price every page pays for the failure message)', `+${htmlNow - htmlThen}`)
    const script = /<script>\(function\(\)\{function show[\s\S]*?<\/script>/.exec(h)?.[0] ?? ''
    is(script.length > 200 && (h.match(/function show\(\)/g) || []).length === 1, 'A6 the failure message is in the document, once')
    is(!/\beval\(|new Function|document\.write|javascript:/.test(script), 'A7 the inline script uses nothing a strict CSP would forbid')
    is((h.match(/<\/head>/g) || []).length === 1 && h.indexOf(script) > h.indexOf('rel="modulepreload"'), 'A8 it sits after the document\'s own preloads, so it never queues ahead of them')
  }

  browser = await launch()
  const cspErrors = (msgs) => msgs.filter((m) => /Content Security Policy|Refused to/i.test(m))
  const chunkRe = (names) => new RegExp(`/assets/(${names.join('|')})-[^/]*\\.js$`)
  const CHECKOUT_FILES = chunkRe(['Checkout', 'CheckoutSteps', 'checkout'])
  const PAGE_CHUNK = chunkRe(['Checkout'])
  const stem = (p) => p.replace(/^.*\/assets\//, '').replace(/-[A-Za-z0-9_-]{8}\.js$/, '')

  // ------------------------------------------------------------------ B. landing on /checkout
  if (head('B  landing on /checkout')) {
    const seen = {}
    for (const [name, dist] of [['now', after], ['before', before]]) {
      const srv = await serveSite(dist, { csp: name === 'now' })
      for (const lang of ['en', 'ar']) {
        const ctx = await phone(browser)
        const page = await ctx.newPage()
        const consoleErrors = []
        const pageErrors = []
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
        page.on('pageerror', (e) => pageErrors.push(String(e)))
        await seed(page, { lang })
        const m = srv.mark()
        await page.goto(`${srv.url}/checkout`, { waitUntil: 'load' })
        await page.waitForSelector('#f-name', { timeout: 120_000 })
        await page.waitForTimeout(500)
        const mine = srv.requests.slice(m).filter((r) => r.path.endsWith('.js') || /\.js\?/.test(r.path)).map((r) => r.path)
        const urls = mine.filter((u) => CHECKOUT_FILES.test(u))
        is(new Set(mine).size === mine.length && urls.length >= 2, `B1 [${lang}, ${name}] every script is fetched exactly once, the checkout's included`, urls.join(' '))
        is(pageErrors.length === 0, `B2 [${lang}, ${name}] no uncaught error`, pageErrors[0])
        seen[`${name}-${lang}`] = mine.map(stem).sort().join(',')
        if (name === 'now') {
          is(cspErrors(consoleErrors).length === 0, `B3 [${lang}] nothing is refused by the production Content-Security-Policy`, cspErrors(consoleErrors)[0])
          await page.fill('#f-name', 'Test Shopper')
          is((await page.inputValue('#f-name')) === 'Test Shopper', `B4 [${lang}] the form takes input`)
          is((await page.evaluate(() => document.getElementById('sporta-cf'))) === null, `B5 [${lang}] no failure message on a healthy load`)
        }
        await ctx.close()
      }
      await srv.close()
    }
    for (const lang of ['en', 'ar']) {
      is(seen[`now-${lang}`] === seen[`before-${lang}`], `B6 [${lang}] the same scripts are requested as in the commit before (nothing added, nothing split off)`, `${seen[`now-${lang}`]}  vs  ${seen[`before-${lang}`]}`)
    }
  }

  // ------------------------------------------------------------------ C. other pages
  if (head('C  other pages do not pay for it')) {
    const srv = await serveSite(after, { csp: true })
    for (const path of ['/', '/shop', '/cart']) {
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page)
      const m = srv.mark()
      await page.goto(`${srv.url}${path}`, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      const got = srv.requests.slice(m).filter((r) => (path === '/cart' ? PAGE_CHUNK : CHECKOUT_FILES).test(r.path)).map((r) => r.path)
      is(got.length === 0, `C1 ${path} does not request the checkout page${path === '/cart' ? ' before the shopper shows intent' : ''}`, got.join(' '))
      await ctx.close()
    }
    await srv.close()
  }

  // ------------------------------------------------------------------ D. intent, and a form with no hidden hops
  if (head('D  prefetch on intent, and a form served entirely by what is already there')) {
    const srv = await serveSite(after, { csp: true })
    async function cart(extra) {
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page)
      if (extra) await page.addInitScript(extra)
      await page.goto(`${srv.url}/cart`, { waitUntil: 'load' })
      const link = page.locator('a[href="/checkout"]').first()
      await link.waitFor({ timeout: 60_000 })
      return { ctx, page, link }
    }
    const pageRequests = (m) => srv.requests.slice(m).filter((r) => PAGE_CHUNK.test(r.path)).length

    let s = await cart()
    let m = srv.mark()
    await s.link.hover()
    await s.page.waitForTimeout(1500)
    is(pageRequests(m) === 1, 'D1 hovering the Checkout link fetches the checkout page before the click', `${pageRequests(m)} request(s)`)
    await s.link.click()
    await s.page.waitForSelector('#f-name', { timeout: 60_000 })
    is(pageRequests(m) === 1, 'D2 ... and the click then asks for nothing more')
    await s.ctx.close()

    s = await cart()
    m = srv.mark()
    await s.link.dispatchEvent('touchstart')
    await s.page.waitForTimeout(1500)
    is(pageRequests(m) === 1, 'D3 a touch on the link does the same')
    await s.ctx.close()

    for (const [label, conn] of [['Save-Data', '{ saveData: true, effectiveType: "4g" }'], ['a 2G connection', '{ saveData: false, effectiveType: "2g" }']]) {
      s = await cart(`Object.defineProperty(navigator, 'connection', { value: ${conn}, configurable: true })`)
      m = srv.mark()
      await s.link.hover()
      await s.page.waitForTimeout(1200)
      is(pageRequests(m) === 0, `D4 ${label}: hovering fetches nothing`, `${pageRequests(m)} request(s)`)
      await s.link.click()
      await s.page.waitForSelector('#f-name', { timeout: 60_000 })
      is(true, `D5 ${label}: the click still opens the checkout`)
      await s.ctx.close()
    }

    // The form and everything on it, with nothing left to fetch.
    for (const lang of ['en', 'ar']) {
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page, { lang })
      await page.goto(`${srv.url}/checkout`, { waitUntil: 'load' })
      await page.waitForSelector('#f-name', { timeout: 60_000 })
      await page.waitForTimeout(1200)
      const mark = srv.mark()
      await page.fill('#f-name', 'Test Shopper')
      await page.selectOption('#f-governorate', 'hawalli')
      await page.click('#f-area') // opens the area list (97 areas)
      await page.fill('#f-area', lang === 'ar' ? 'السالمية' : 'Sal')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.fill('aside input.font-mono', 'save10')
      await page.locator('aside button', { hasText: lang === 'ar' ? 'تطبيق' : 'Apply' }).click()
      await page.waitForSelector('aside code', { timeout: 30_000 })
      for (const id of ['knet', 'tpay', 'cod']) await page.check(`input[name=paymethod][value=${id}]`)
      await page.locator('#f-note').scrollIntoViewIfNeeded()
      await page.locator('#loc-hint').scrollIntoViewIfNeeded().catch(() => {}) // the location control, hidden where geolocation is blocked
      await page.locator('.tap-row input[type=checkbox]').first().uncheck().catch(() => {})
      await page.waitForTimeout(800)
      const js = srv.requests.slice(mark).filter((r) => /\.js(\?|$)/.test(r.path))
      is(js.length === 0, `D6 [${lang}] area list, coupon, payment choice, location control and "remember" request no JavaScript`, js.map((r) => r.path).join(' '))
      is((await page.inputValue('#f-area')).length > 0, `D7 [${lang}] the area list filled the field`)
      await ctx.close()
    }
    await srv.close()
  }

  // ------------------------------------------------------------------ E. when a lazy page cannot be fetched
  if (head('E  a page that cannot load leaves a way back')) {
    const srv = await serveSite(after, { csp: true })
    for (const lang of ['en', 'ar']) {
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      const pageErrors = []
      const consoleErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e)))
      page.on('console', (mm) => { if (mm.type() === 'error') consoleErrors.push(mm.text()) })
      await seed(page, { lang })
      const block = (route) => route.abort('failed')
      await page.route('**/assets/Checkout-*.js', block)
      await page.goto(`${srv.url}/cart`, { waitUntil: 'load' })
      const link = page.locator('a[href="/checkout"]').first()
      await link.waitFor({ timeout: 60_000 })
      await link.click()
      const shown = await page.waitForSelector('#sporta-cf', { timeout: 20_000 }).then(() => true, () => false)
      is(shown, `E0 [${lang}] when the checkout cannot be fetched a message appears`)
      if (!shown) { await ctx.close(); continue }
      const box = await page.evaluate(() => {
        const d = document.getElementById('sporta-cf')
        const b = d.querySelector('button')
        const r = d.getBoundingClientRect()
        return {
          role: d.getAttribute('role'), dir: d.getAttribute('dir'), text: d.querySelector('p').textContent.trim(),
          label: b.textContent.trim(), focused: document.activeElement === b, rootEmpty: document.getElementById('root').children.length === 0,
          onScreen: r.width > 200 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
          btnH: b.getBoundingClientRect().height, timeOrigin: performance.timeOrigin,
        }
      })
      const ar = lang === 'ar'
      is(box.rootEmpty, `E1 [${lang}] the page really is empty underneath (this is the failure state, not an overlay on a working page)`)
      is(box.role === 'alert' && box.dir === (ar ? 'rtl' : 'ltr'), `E2 [${lang}] it is announced (role=alert) and laid out ${ar ? 'right-to-left' : 'left-to-right'}`, `${box.role} ${box.dir}`)
      is(ar ? /[؀-ۿ]/.test(box.text) && /[؀-ۿ]/.test(box.label) : /could not load/.test(box.text) && box.label === 'Try again', `E3 [${lang}] it says so in the page's language`, `${box.text} / ${box.label}`)
      is(box.focused && box.btnH >= 44, `E4 [${lang}] the Retry button has the keyboard focus and is at least 44 px tall`, `focused ${box.focused}, ${box.btnH}px`)
      is(box.onScreen, `E5 [${lang}] it fits the screen`)
      is(cspErrors(consoleErrors).length === 0, `E6 [${lang}] the production Content-Security-Policy allows it`, cspErrors(consoleErrors)[0])
      await page.unroute('**/assets/Checkout-*.js', block)
      await page.getByRole('button', { name: ar ? 'إعادة المحاولة' : 'Try again' }).click()
      const opened = await page.waitForSelector('#f-name', { timeout: 20_000 }).then(() => true, () => false)
      const back = await page.evaluate(() => ({ gone: !document.getElementById('sporta-cf'), origin: performance.timeOrigin, path: location.pathname }))
      is(opened && back.gone && back.path === '/checkout' && back.origin !== box.timeOrigin, `E7 [${lang}] Retry, with the network back, loads the checkout (a reload: a browser keeps a failed module for the life of the page)`, JSON.stringify(back))
      await ctx.close()
    }

    // The record this change answers: the commit before left an EMPTY page.
    {
      const old = await serveSite(before)
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page)
      await page.route('**/assets/Checkout-*.js', (route) => route.abort('failed'))
      await page.goto(`${old.url}/cart`, { waitUntil: 'load' })
      const link = page.locator('a[href="/checkout"]').first()
      await link.waitFor({ timeout: 60_000 })
      await link.click()
      await page.waitForTimeout(3000)
      const st = await page.evaluate(() => ({ rootChildren: document.getElementById('root').children.length, text: document.body.innerText.trim().length }))
      is(st.rootChildren === 0 && st.text === 0, 'E10 (the commit before) the same failure left a completely empty page: nothing on it, nothing to press', JSON.stringify(st))
      await ctx.close()
      await old.close()
    }

    // An import error while the page is WORKING (something caught elsewhere, a late rejection) must not
    // put a message over a working shop: the message is for an empty page only.
    {
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page)
      await page.goto(`${srv.url}/cart`, { waitUntil: 'load' })
      await page.locator('a[href="/checkout"]').first().waitFor({ timeout: 60_000 })
      await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Failed to fetch dynamically imported module: http://x/assets/Y.js' })))
      await page.waitForTimeout(1200)
      const st = await page.evaluate(() => ({ msg: !!document.getElementById('sporta-cf'), mounted: document.getElementById('root').children.length > 0 }))
      is(!st.msg && st.mounted, 'E9 an import error while the page is working shows no message', JSON.stringify(st))
      await ctx.close()
    }

    // A prefetch that fails is silent: the shopper asked for nothing.
    {
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page)
      await page.route('**/assets/Checkout-*.js', (route) => route.abort('failed'))
      await page.goto(`${srv.url}/cart`, { waitUntil: 'load' })
      const link = page.locator('a[href="/checkout"]').first()
      await link.waitFor({ timeout: 60_000 })
      await link.hover()
      await page.waitForTimeout(2500)
      const st = await page.evaluate(() => ({ msg: !!document.getElementById('sporta-cf'), mounted: document.getElementById('root').children.length > 0 }))
      is(!st.msg && st.mounted, 'E8 a failed PREFETCH (a hover) shows no message and leaves the cart working', JSON.stringify(st))
      await ctx.close()
    }
    await srv.close()
  }

  // ------------------------------------------------------------------ F. the order, byte for byte
  if (head('F  the order the checkout sends')) {
    async function place(dist, { lang = 'en', method = 'knet', coupon = false, saved = null, width = 390 }) {
      const srv = await serveSite(dist)
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
      const page = await ctx.newPage()
      await page.route(/^https:\/\/www\.sporta\.com\.kw\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>bank</title>' }))
      await seed(page, { lang, saved })
      await page.goto(`${srv.url}/checkout`, { waitUntil: 'load' })
      if (!saved) {
        await page.waitForSelector('#f-name', { timeout: 60_000 })
        await page.fill('#f-name', 'Test Shopper')
        await page.fill('#f-phone', '99887766')
        await page.selectOption('#f-governorate', 'hawalli')
        await page.fill('#f-area', 'Salmiya')
        await page.keyboard.press('Escape')
        await page.fill('#f-block', '4')
        await page.fill('#f-street', '12')
        await page.fill('#f-building', '5')
        await page.fill('#f-note', 'ring twice')
        if (coupon) {
          await page.fill('aside input.font-mono', 'save10')
          await page.locator('aside button', { hasText: lang === 'ar' ? 'تطبيق' : 'Apply' }).click()
          await page.waitForSelector('aside code', { timeout: 30_000 })
        }
      } else {
        await page.waitForSelector('form button[type=submit]', { timeout: 60_000 })
      }
      await page.check(`input[name=paymethod][value=${method}]`)
      await page.locator('form button[type=submit]:visible').first().click()
      for (let i = 0; i < 100 && srv.orders.length === 0; i++) await page.waitForTimeout(100)
      const out = { order: srv.orders[0] ?? null, discounts: srv.discounts, to: await page.evaluate(() => location.href).catch(() => '') }
      await ctx.close()
      await srv.close()
      return out
    }
    const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'track_id' ? 'TID' : v)))
    const keys = (o, acc = []) => { for (const [k, v] of Object.entries(o ?? {})) { acc.push(k); if (v && typeof v === 'object') keys(v, acc) } return acc }
    const cases = [
      ['knet card, English', { lang: 'en', method: 'knet' }],
      ['cash, Arabic, with a coupon', { lang: 'ar', method: 'cod', coupon: true }],
      ['T-Pay, desktop width', { lang: 'en', method: 'tpay', width: 1280 }],
      ['the quick card (saved details), cash', { lang: 'en', method: 'cod', saved: SAVED }],
    ]
    for (const [label, opts] of cases) {
      const a = await place(after, opts)
      const b = await place(before, opts)
      is(!!a.order && !!b.order, `F1 ${label}: an order was sent by both builds`)
      is(JSON.stringify(norm(a.order)) === JSON.stringify(norm(b.order)), `F2 ${label}: the order body is identical to the commit before's`, JSON.stringify(norm(a.order)).slice(0, 160))
      is(JSON.stringify(a.discounts) === JSON.stringify(b.discounts), `F3 ${label}: so are the discount checks it made`)
      const priced = keys(a.order).filter((k) => /price|amount|total|subtotal|fee/i.test(k))
      is(priced.length === 0, `F4 ${label}: the order carries no price, amount or total (the server decides every number)`, priced.join(','))
    }
  }

  // ------------------------------------------------------------------ G. tab order
  if (head('G  tab order')) {
    async function tabs(dist, lang) {
      const srv = await serveSite(dist)
      const ctx = await phone(browser)
      const page = await ctx.newPage()
      await seed(page, { lang })
      await page.goto(`${srv.url}/checkout`, { waitUntil: 'load' })
      await page.waitForSelector('#f-name', { timeout: 60_000 })
      await page.waitForTimeout(800)
      const seq = []
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press('Tab')
        seq.push(await page.evaluate(() => {
          const e = document.activeElement
          return e ? `${e.tagName.toLowerCase()}#${e.id}[${e.getAttribute('name') ?? ''}|${e.getAttribute('type') ?? ''}]${(e.getAttribute('href') ?? '')}` : 'none'
        }))
      }
      await ctx.close()
      await srv.close()
      return seq
    }
    for (const lang of ['en', 'ar']) {
      const a = await tabs(after, lang)
      const b = await tabs(before, lang)
      is(a.filter((x) => x.includes('#f-')).length >= 8, `G1 [${lang}] the walk reaches the form's fields`, a.filter((x) => x.includes('#f-')).join(' '))
      is(JSON.stringify(a) === JSON.stringify(b), `G2 [${lang}] the tab order is identical to the commit before's (${a.length} stops)`)
    }
  }

  // ------------------------------------------------------------------ H. layout shift
  if (head('H  layout shift')) {
    const median3 = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
    async function cls(dist, { lang, width, saved, blockFonts }) {
      const srv = await serveSite(dist, { csp: true })
      const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 800 : 844 }, serviceWorkers: 'block' })
      const page = await ctx.newPage()
      if (blockFonts) await page.route('**/fonts/**', (r) => r.abort())
      await seed(page, { lang, saved })
      await page.addInitScript(() => {
        window.__cls = 0
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })
      })
      await page.goto(`${srv.url}/checkout`, { waitUntil: 'load' })
      await page.waitForSelector(saved ? 'form button[type=submit]' : '#f-name', { timeout: 60_000 })
      await page.waitForTimeout(2200)
      const v = await page.evaluate(() => window.__cls)
      await ctx.close()
      await srv.close()
      return v
    }
    for (const [view, saved] of [['the form', null], ['the quick card', SAVED]]) {
      for (const lang of ['en', 'ar']) {
        for (const width of [390, 1280]) {
          const now = median3([await cls(after, { lang, width, saved }), await cls(after, { lang, width, saved }), await cls(after, { lang, width, saved })])
          const then = median3([await cls(before, { lang, width, saved }), await cls(before, { lang, width, saved }), await cls(before, { lang, width, saved })])
          is(now <= 0.02 && now <= then + 0.001, `H1 ${view}, ${lang}, ${width}px: layout shift ${now.toFixed(4)} (the commit before: ${then.toFixed(4)}; the project's budget is 0.02)`, `${now} vs ${then}`)
        }
      }
    }
    for (const lang of ['en', 'ar']) {
      const z = await cls(after, { lang, width: 390, saved: null, blockFonts: true })
      is(z < 0.0001, `H2 the form, ${lang}, 390px, fonts blocked: layout shift ${z.toFixed(4)} -- exactly zero, so what remains with fonts is the font swap`, String(z))
    }
  }
} finally {
  await browser?.close().catch(() => {})
  rmrf(tmp)
}
console.log(`\n${pass} ok, ${fail} failed`)
process.exit(fail ? 1 : 0)
