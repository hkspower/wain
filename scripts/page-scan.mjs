/**
 * Opens every page of the app in a phone-sized browser and reports what a
 * customer would hit: a console error, a request that fails, a page that
 * scrolls sideways, text too small to read, a control too small to tap.
 *
 *   python3 scripts/serve-dist.py 4173 &
 *   php -S 127.0.0.1:4300 -t sporta-site/public_html &
 *   node scripts/page-scan.mjs
 *
 * The other suites assert what each screen DOES. This asserts what is true of
 * EVERY screen and that nobody writes a test for — which is exactly why a
 * broken one can ship unnoticed on a page no suite happens to open.
 *
 * The sandbox has no route to www.sporta.com.kw, and a dist built for
 * production points there. Rather than rebuild against a local base — which
 * would scan a DIFFERENT bundle from the one that ships — the production API
 * is redirected to the local PHP site at the network layer, so the pages under
 * scan are byte-for-byte the shipped ones with live data behind them.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const LOCAL_API = process.env.SITE_API ?? 'http://127.0.0.1:4300/api'
const LOCAL_SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
const VIEWPORT = { width: 390, height: 844 }

// Every route the export produced, with a real value for the dynamic ones — a
// page opened at the literal "[slug]" renders its not-found state, which is
// worth scanning but is not the page this is checking.
const ROUTES = [
  '/', '/shop', '/cart', '/checkout', '/account',
  '/product/desert-runner-short',
  '/order/SP-2601',
  '/backends', '/backends/orders', '/backends/stock', '/backends/promos',
  '/+not-found',
]

let fails = 0
const notes = []
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const note = (what) => {
  notes.push(what)
  console.log(`--   ${what}`)
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
// Fulfilled rather than continued: Playwright will not redirect https to
// http, and the local PHP server speaks http.
// Everything the shop hosts, not only the API: the category and product
// photographs come off the same origin, and left unproxied they fail as
// "no route to host", which hides whether the path is right.
await ctx.route('https://www.sporta.com.kw/**', async (route) => {
  const req = route.request()
  const to = req.url().replace('https://www.sporta.com.kw/api', LOCAL_API)
                      .replace('https://www.sporta.com.kw', LOCAL_SITE)
  try {
    const res = await fetch(to, {
      method: req.method(),
      headers: req.headers(),
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData(),
    })
    await route.fulfill({
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
      body: Buffer.from(await res.arrayBuffer()),
    })
  } catch (e) {
    await route.abort()
  }
})
const p = await ctx.newPage()

for (const route of ROUTES) {
  const errors = []
  const dead = []
  p.removeAllListeners('console')
  p.removeAllListeners('pageerror')
  p.removeAllListeners('requestfailed')
  p.removeAllListeners('response')
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('requestfailed', (r) => dead.push(`${r.url()} (${r.failure()?.errorText})`))
  p.on('response', (r) => {
    if (r.status() >= 400) return dead.push(`${r.url()} (${r.status()})`)
    // A 200 that is not a picture. PHP's built-in server answers a missing
    // path with the site's index.html rather than a 404, so a wrong image URL
    // comes back "fine" and 36 kB of HTML is handed to an <img>. On the real
    // server it is a 404; either way the photograph is not there.
    if (/\.(jpe?g|png|webp|avif)$/i.test(new URL(r.url()).pathname)) {
      const type = r.headers()['content-type'] ?? ''
      if (!type.startsWith('image/')) dead.push(`${r.url()} (200 but ${type.split(';')[0]})`)
    }
  })

  let status = 0
  try {
    const res = await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 })
    status = res?.status() ?? 0
  } catch (e) {
    check(false, `${route} — did not load (${e.message.split('\n')[0]})`)
    continue
  }
  // Two of these routes are dynamic. The static export prerendered them with
  // no parameters, so the first paint is a placeholder and the real content
  // arrives on the client — measuring at networkidle catches the placeholder
  // and reports a perfectly good page as blank.
  await p.waitForTimeout(1500)

  const label = route.padEnd(30)
  check(status === 200, `${label} serves 200 (${status})`)

  // A page that renders nothing looks perfectly healthy to a status code.
  const body = (await p.locator('body').innerText().catch(() => '')).trim()
  check(body.length > 0, `${label} renders something (${body.length} chars)`)

  check(errors.length === 0,
    `${label} no console errors${errors.length ? ` — ${errors[0].slice(0, 100)}` : ''}`)
  // A favicon the export does not emit is not worth a failure; anything the
  // page itself asked for is.
  const real = dead.filter((d) => !/favicon/.test(d))
  check(real.length === 0, `${label} every request answers${real.length ? ` — ${real[0].slice(0, 100)}` : ''}`)

  // Sideways scroll. On a phone this is the most visible layout bug there is,
  // and it is invisible in a desktop browser.
  const over = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(over <= 1, `${label} does not scroll sideways (${over}px over)`)

  // Arabic is the shipped default, so every page must come up reading
  // right-to-left. Measured on the text itself, not on <html dir> — the app
  // sets direction per element on purpose, having no way to force RTL on
  // native without a reload.
  const rtl = await p.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    const dirs = els.map((el) => getComputedStyle(el).direction)
    return { total: dirs.length, rtl: dirs.filter((d) => d === 'rtl').length }
  })
  // /backends is the owner's panel and is English-only by design, and
  // +not-found is Expo's own screen. Neither is a customer-facing Arabic page.
  if (!route.startsWith('/backends') && route !== '/+not-found')
    check(rtl.total === 0 || rtl.rtl > 0,
      `${label} text reads right-to-left (${rtl.rtl}/${rtl.total})`)

  // Text under 12px is unreadable on a phone; the type scale's smallest role
  // is 13. Below that means a hard-coded size slipped in.
  const tiny = await p.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('*')) {
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
      if (!text) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size && size < 12) out.push(`${size}px "${text.slice(0, 24)}"`)
    }
    return out
  })
  check(tiny.length === 0, `${label} no text under 12px${tiny.length ? ` — ${tiny[0]}` : ''}`)

  // Anything you tap has to be big enough to hit. 44pt is Apple's floor; the
  // app's own TapTarget is 48, and the gap between the two is deliberate —
  // this catches what is genuinely hard to hit, not what is merely tight.
  const small = await p.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll(
      '[role="button"], button, a[href], input, select, [role="link"], [role="tab"]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      // A link inside a sentence is text, not a control, and is not expected
      // to be 44pt tall.
      if (el.tagName === 'A' && el.closest('p')) continue
      // Expo's own not-found screen, which no customer reaches through the
      // app's navigation and which this project does not style.
      if (location.pathname === '/+not-found') continue
      if (r.height < 44)
        out.push(`${Math.round(r.width)}x${Math.round(r.height)} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`)
    }
    return out
  })
  check(small.length === 0,
    `${label} every control is 44pt tall${small.length ? ` — ${small.length}, e.g. ${small[0]}` : ''}`)

  // The <head> of the served HTML. Not a failure — the app sets its titles
  // per screen through the navigator, and the static export writes the head
  // before any of that runs — but a page whose tab is called "127.0.0.1" is
  // worth knowing about, and it is the same fix for all of them.
  const head = await p.evaluate(() => ({
    title: document.title.trim(),
    lang: document.documentElement.lang,
  }))
  if (!head.title) note(`${label} the served HTML has no <title>`)
  if (!head.lang) note(`${label} the served HTML has no lang=`)
  // dir= is NOT checked. This app sets direction per element, because there
  // is no way to force RTL on native without a reload, and a document-level
  // dir fights that: it flips which end of a horizontal list a scroll-to-end
  // lands on, and it put the shop's first filter chip off the left edge of
  // the screen. See app/+html.tsx.
}

await ctx.close()
await b.close()
console.log(
  fails ? `\n${fails} failed, ${notes.length} noted`
        : `\nall ok — ${ROUTES.length} pages${notes.length ? `, ${notes.length} noted` : ''}`)
process.exit(fails ? 1 : 0)
