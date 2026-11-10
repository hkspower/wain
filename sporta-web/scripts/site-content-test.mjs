// "Site content" and "Returns & exchange" in a real browser, against the sandbox (real MariaDB, real PHP, this repo's storefront).
//
//   bash scripts/sandbox.sh          (from sporta-web/: MariaDB + PHP on :8095 / :8096)
//   node scripts/site-content-test.mjs        ("test:site-content": "node scripts/site-content-test.mjs" in package.json)
//
// WHAT IS UNDER TEST
//   public/sporta-features.js      its "SITE CONTENT" block: the owner's wording applied to text nodes, the contact details
//                                  applied to links, and the returns page's intro / points / number of days;
//   public/sporta-admin-brands.js  its "ADMIN SITE CONTENT" block: the /backends screen that edits all of it;
//   dropin/php-store               api.php?r=content, admin.php?r=content / content_save / returns_policy_save (the contract
//                                  itself is in native-backend-test.mjs; here the real server stores and answers).
//
// THE PAGES
//   - The storefront is this repo's build served by the sandbox on :8096. Its index.html does not link sporta-features.js (the
//     LIVE index.html does), so the document is passed through with that one <script defer> added, and /sporta-features.js is
//     answered from public/ (or, for the mutation runs, from a copy with the block cut out).
//   - /returns and /exchange: the live build's page is not this repo's Returns.jsx, so those two addresses are answered with
//     scripts/fixtures/returns-policy.mjs (the live class names and texts; two variants, because the live TAGS are not known).
//   - /backends: the markup of the real compiled admin (scripts/fixtures/sizes-admin/orders.html) with the abandoned-orders
//     suite's stand-in for React, and the real add-on file, signed in on the sandbox's admin API.
//
// WHAT IS ASSERTED (sections; run some with ONLY=1,4)
//   1 rules      an override changes the text in English and in Arabic, only in its own language and on its own page; '*' is
//                everywhere; HTML in a rule is shown as characters; the page's own nodes are the same nodes
//   2 routes     it survives a route change (SPA) and a re-render, is NOT applied on /checkout (direct load and SPA arrival:
//                what a shared header carried is put back), and nothing is requested on a blocked page
//   3 guards     a price is never changed (whole, bare number, currency mark, split over elements), nor text in a textarea,
//                an input, a select, a script, a style or a contenteditable, even when the ANSWER itself is hostile
//   4 cache      one request per page load whatever happens; the kept copy is applied when the API is down; removing a rule
//                restores the original (on the next load, and at once when the fresh answer arrives); no write loop
//   5 contact    tel / mailto / wa.me / social profile links and the numbers written in them follow the saved values; a
//                hostile value never reaches an href
//   6 returns    custom points replace the fixed ones in ar and en (both markup variants), survive a re-render and a language
//                switch, the heading and the two links stay, clearing restores the original; the intro; the number of days
//                alone (with the Arabic counted noun); nothing of it off /returns and /exchange
//   7 admin      the entry appears, Load texts lists the page's ORIGINAL words (no prices), a typed replacement is saved and
//                shows on the storefront, Remove takes it away, contact and the returns card are saved through their routes
//   8 mutants    the same key checks FAIL with the block disabled (the storefront block cut out; the admin block cut out)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixturePage, addonFiles } from './lib/sizes-admin-page.mjs'
import { SHIM_JS as ADMIN_SHIM_JS, SHIM_CSS as ADMIN_SHIM_CSS } from './lib/abandoned-ui-shim.mjs'
import { page as returnsPage, SHIM_JS as returnsShim, POINTS, HEAD } from './fixtures/returns-policy.mjs'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SITE_BASE ?? 'http://127.0.0.1:8096'
const FEATURES = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const BRANDS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const RETURNS_CSS = readFileSync(join(ROOT, 'public/sporta-returns-touch.css'), 'utf8')
const cut = (src, name) => {
  const a = src.indexOf(`/* ===== ${name} - begin`), b = src.indexOf(`/* ===== ${name} - end`)
  if (a < 0 || b < a) { console.log(`FAIL the ${name} block markers are missing`); process.exit(1) }
  return src.slice(0, a) + src.slice(src.indexOf('\n', b))
}
const FEATURES_WITHOUT = cut(FEATURES, 'SITE CONTENT')
const BRANDS_WITHOUT = cut(BRANDS, 'ADMIN SITE CONTENT')

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const on = (n) => !ONLY || ONLY.includes(String(n))
let pass = 0, fail = 0, quiet = false
const is = (ok, msg, detail = '') => {
  if (quiet) return !!ok
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
  return !!ok
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ the rig
const sql = (q) => run('mariadb', ['sporta', '-e', q])
const reset = () => sql("delete from settings where name in ('site_content','returns_policy'); delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null")
try { const r = await fetch(`${BASE}/api/api.php?r=content`); if (!r.ok) throw new Error(`HTTP ${r.status}`) } catch (e) {
  console.log(`FAIL the sandbox is not answering on ${BASE} (${e.message}). Start it: bash scripts/sandbox.sh`); process.exit(1)
}
await reset()
let cookie = ''
const admin = async (route, body) => {
  const res = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}
const LOGIN = { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' }
{
  const r = await admin('login', LOGIN)
  if (r.status !== 200) { console.log(`FAIL the test admin could not sign in (${r.status} ${r.body?.error})`); process.exit(1) }
}
/** Replace the whole stored document (the version is read first, as the editor does). */
const setContent = async (overrides = [], contact = {}) => {
  const cur = await admin('content')
  const r = await admin('content_save', { v: cur.body?.v ?? 0, overrides, contact })
  if (r.status !== 200) throw new Error(`content_save ${r.status} ${r.body?.error}`)
  await sql('delete from rate_limit')
  return r.body
}
const RET0 = { window_days: 14, allow_return: true, allow_exchange: true, intro_en: '', intro_ar: '', points_en: [], points_ar: [] }
const setReturns = async (patch = {}) => {
  const r = await admin('returns_policy_save', { ...RET0, ...patch })
  if (r.status !== 200) throw new Error(`returns_policy_save ${r.status} ${r.body?.error}`)
  await sql('delete from rate_limit')
  return r.body
}

let browser
const paths = [process.env.CHROMIUM_PATH, undefined, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome']
for (const executablePath of paths) {
  if (executablePath === undefined && paths.indexOf(undefined) !== paths.lastIndexOf(undefined)) continue
  try { browser = await chromium.launch(executablePath ? { executablePath } : {}); break } catch { /* next */ }
}
if (!browser) { console.log('FAIL no Chromium could be started (set CHROMIUM_PATH)'); process.exit(1) }

/** A fresh browser profile. mode: { features, brands, variant, answer } - what the fixture hands out for this context. */
async function open(mode = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const st = { content: 0, errors: [], mode: { features: FEATURES, brands: BRANDS, variant: 'list', answer: null, down: false, ...mode } }
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== BASE) return route.abort()
    const p = u.pathname
    if (p === '/sporta-features.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: st.mode.features })
    if (p === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: st.mode.brands })
    if (p === '/sporta-returns-touch.css') return route.fulfill({ status: 200, contentType: 'text/css', body: RETURNS_CSS })
    if (p === '/returns-fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: returnsShim(st.mode.variant) })
    if (p === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: ADMIN_SHIM_JS })
    if (p === '/api/api.php' && u.searchParams.get('r') === 'content') {
      st.content++
      if (st.mode.down) return route.abort()
      if (st.mode.answer) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(st.mode.answer) })
      return route.continue()
    }
    if (req.resourceType() === 'document' && req.isNavigationRequest() && !p.startsWith('/api/')) {
      if (p === '/returns' || p === '/exchange') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: returnsPage() })
      if (p === '/backends') {
        const html = fixturePage('orders', addonFiles())
          .replace('</head>', `<style>${ADMIN_SHIM_CSS}</style></head>`)
          .replace('</body>', '<script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body>')
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      }
      // the storefront: this repo's page, plus the one script tag the LIVE index.html has and this one lacks
      const res = await route.fetch()
      let html = await res.text()
      if (!html.includes('/sporta-features.js')) html = html.replace('</head>', '<script src="/sporta-features.js" defer></script></head>')
      return route.fulfill({ response: res, body: html })
    }
    return route.continue()
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => st.errors.push(String(e)))
  return { ctx, page, st }
}
const go = async (page, url) => { await page.goto(BASE + url, { waitUntil: 'load' }); await page.waitForSelector('h1', { timeout: 20000 }) }
const h1 = (page) => page.evaluate(() => { const h = document.querySelector('main h1') || document.querySelector('h1'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : '' })
const navText = (page, href) => page.evaluate((href) => {
  const a = [...document.querySelectorAll('header a[href="' + href + '"]')].find((x) => x.textContent.trim())
  return a ? a.textContent.replace(/\s+/g, ' ').trim() : ''
}, href)
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(80) } return v }
/** SPA navigation the way react-router hears it (no page load). */
const spa = (page, path) => page.evaluate((path) => { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }, path)

// the build's own words, read with the block switched off (what the admin's Load texts sees)
const ORIG = {}
{
  const { ctx, page } = await open()
  for (const lang of ['en', 'ar']) {
    await go(page, `/about?lang=${lang}&sporta_content=off`)
    ORIG[lang] = { h1: await h1(page), shop: await navText(page, '/shop'), about: await navText(page, '/about') }
  }
  await go(page, '/checkout?lang=en&sporta_content=off'); ORIG.checkout = await h1(page)
  await go(page, '/shop?lang=en&sporta_content=off'); ORIG.shopH1 = await h1(page)
  await page.waitForFunction(() => /KWD\s*[0-9]/.test(document.body.textContent), null, { timeout: 20000 })
  ORIG.price = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, 4); let n
    while ((n = w.nextNode())) { const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (/^KWD [0-9.]+$/.test(s)) return s }
    return ''
  })
  await ctx.close()
}
const NEW = { h1en: 'About EDITED <b onclick="window.__xss=1">bold</b> & more', h1ar: 'نبذة معدّلة عن سبورتا', shop: 'Browse', aboutNav: 'Our story', shopAr: 'تصفّح' }
const RULES = () => [
  { page: '/about', lang: 'en', match: ORIG.en.h1, text: NEW.h1en },
  { page: '/about', lang: 'ar', match: ORIG.ar.h1, text: NEW.h1ar },
  { page: '*', lang: 'en', match: ORIG.en.shop, text: NEW.shop },
  { page: '*', lang: 'ar', match: ORIG.ar.shop, text: NEW.shopAr },
  { page: '/shop', lang: 'en', match: ORIG.en.about, text: NEW.aboutNav },     // a header word, on ONE page only
  { page: '*', lang: 'en', match: ORIG.checkout, text: 'HIJACKED CHECKOUT' },  // must never show: /checkout is off limits
]

// ------------------------------------------------------------------ sections
async function rules(tag = '') {
  await setContent(RULES())
  const { ctx, page, st } = await open(tag ? { features: FEATURES_WITHOUT } : {})
  await go(page, '/about?lang=en')
  const changed = await until(async () => (await h1(page)) === NEW.h1en)
  const key = is(changed, `${tag}an override changes the text in English`, await h1(page))
  if (tag) { await ctx.close(); return key }
  is(await page.evaluate(() => !document.querySelector('main h1 b') && !window.__xss && document.querySelector('main h1').childNodes.length === 1),
     'HTML in a rule is shown as characters: no element is created and nothing runs')
  is(await navText(page, '/shop') === NEW.shop, "a '*' rule applies on this page too", await navText(page, '/shop'))
  is(await navText(page, '/about') === ORIG.en.about, 'a rule for /shop is not applied on /about', await navText(page, '/about'))
  await go(page, '/about?lang=ar')
  is(await until(async () => (await h1(page)) === NEW.h1ar), 'an override changes the text in Arabic', await h1(page))
  is(await navText(page, '/shop') === NEW.shopAr, 'the Arabic page gets the Arabic rule, not the English one', await navText(page, '/shop'))
  await go(page, '/contact?lang=en')
  is(await until(async () => (await navText(page, '/shop')) === NEW.shop) && (await h1(page)) !== NEW.h1en, "another page gets the '*' rule and not the /about rule")
  is(st.errors.length === 0, 'no page error', st.errors.join(' | '))
  await ctx.close()
  return key
}

async function routes() {
  await setContent(RULES())
  const { ctx, page, st } = await open()
  await go(page, '/about?lang=en')
  await until(async () => (await h1(page)) === NEW.h1en)
  await page.evaluate(() => { window.__h = document.querySelector('header a[href="/shop"]'); window.__keep = [...document.querySelectorAll('header a')] })
  await page.click('header a[href="/shop"]')
  await page.waitForFunction(() => location.pathname === '/shop')
  await until(async () => (await h1(page)) === ORIG.shopH1)
  is(await navText(page, '/shop') === NEW.shop, "after a route change (SPA, no load) the '*' rule is still applied", await navText(page, '/shop'))
  is(await until(async () => (await navText(page, '/about')) === NEW.aboutNav), 'and the header word that has a rule for /shop only is changed on arrival', await navText(page, '/about'))
  await page.click('header a[href="/about"]')
  await page.waitForFunction(() => location.pathname === '/about')
  is(await until(async () => (await h1(page)) === NEW.h1en), 'back on /about the page rule is applied again without a load', await h1(page))
  is(await until(async () => (await navText(page, '/about')) === ORIG.en.about), 'and the /shop-only word is back to the original', await navText(page, '/about'))
  is(st.content === 1, 'ONE content request for the whole visit, route changes included', `${st.content}`)
  // a re-render that rewrites the node (React writing the original again)
  await page.evaluate((t) => { document.querySelector('main h1').firstChild.nodeValue = t }, ORIG.en.h1)
  is(await until(async () => (await h1(page)) === NEW.h1en), 'a re-render that writes the original again is answered')
  // arriving on /checkout without a load: the shared header must show the build's words
  await spa(page, '/checkout')
  await page.waitForFunction(() => location.pathname === '/checkout')
  is(await until(async () => (await navText(page, '/shop')) === ORIG.en.shop), 'arriving on /checkout (SPA) puts the shared header back to the original', await navText(page, '/shop'))
  is(await until(async () => (await h1(page)) === ORIG.checkout), "and a '*' rule that matches a /checkout text is not applied there", await h1(page))
  await spa(page, '/about')
  is(await until(async () => (await navText(page, '/shop')) === NEW.shop && (await h1(page)) === NEW.h1en), 'leaving /checkout applies the rules again')
  await ctx.close()

  const b = await open()
  await go(b.page, '/checkout?lang=en')
  await sleep(700)
  is(await h1(b.page) === ORIG.checkout && await navText(b.page, '/shop') === ORIG.en.shop, '/checkout loaded directly shows the original words', `${await h1(b.page)} / ${await navText(b.page, '/shop')}`)
  is(b.st.content === 0 && await b.page.evaluate(() => window.__sportaContent && window.__sportaContent.applied === 0 && localStorage.getItem('sporta_content_v1') === null),
     'and on /checkout nothing is requested, written or stored', `${b.st.content} request(s)`)
  await go(b.page, '/cart?lang=en'); await sleep(400)
  is(b.st.content === 0 && await navText(b.page, '/shop') === ORIG.en.shop, '/cart: the same')
  is(b.st.errors.length === 0 && st.errors.length === 0, 'no page error', b.st.errors.concat(st.errors).join(' | '))
  await b.ctx.close()
}

async function guards() {
  // an answer no server of ours would give: rules aimed at prices and fields
  const answer = { v: 9, contact: {}, overrides: [
    { page: '*', lang: 'en', match: ORIG.price, text: 'KWD 0.001' },
    { page: '*', lang: 'en', match: 'KWD', text: 'USD' },
    { page: '*', lang: 'en', match: '4.000', text: '0.001' },
    { page: '*', lang: 'en', match: 'Now', text: 'CHANGED' },
    { page: '*', lang: 'en', match: 'Typed by the shopper', text: 'CHANGED' },
    { page: '*', lang: 'en', match: ORIG.shopH1, text: 'Guard run' },
    { page: '/checkout', lang: 'en', match: ORIG.checkout, text: 'x' },
    { page: '*', lang: 'en', match: 'Free text', text: 'Costs 5 KD' },
  ] }
  const { ctx, page, st } = await open({ answer })
  await go(page, '/shop?lang=en')
  await page.waitForFunction(() => /KWD\s*[0-9]/.test(document.body.textContent), null, { timeout: 20000 })
  is(await until(async () => (await h1(page)) === 'Guard run'), 'the hostile answer is in force (its harmless rule is applied)', await h1(page))
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'guard'
    d.innerHTML = '<p id="g-split"><span>Now</span> <span>4.000</span> <span>KWD</span></p><p id="g-plain"><span>Now</span></p>' +
      '<textarea id="g-ta">Typed by the shopper</textarea><div id="g-ce" contenteditable="true">Typed by the shopper</div>' +
      '<select id="g-sel"><option>Typed by the shopper</option></select><p id="g-ok">Typed by the shopper</p><p id="g-free">Free text</p>' +
      '<style id="g-style">/* */</style>'
    document.body.appendChild(d)
    document.getElementById('g-style').textContent = 'Typed by the shopper'
    const s = document.createElement('script'); s.type = 'text/plain'; s.id = 'g-script'; s.textContent = 'Typed by the shopper'; d.appendChild(s)
  })
  await until(() => page.evaluate(() => document.getElementById('g-ok').textContent === 'CHANGED'))
  const g = await page.evaluate((price) => {
    const t = (id) => document.getElementById(id).textContent
    const w = document.createTreeWalker(document.querySelector('#root') || document.body, 4); let n, prices = 0, bad = 0
    while ((n = w.nextNode())) { const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s === price) prices++; if (/0\.001|USD/.test(s)) bad++ }
    return { split: t('g-split'), plain: t('g-plain'), ta: document.getElementById('g-ta').value + '|' + t('g-ta'), ce: t('g-ce'), sel: t('g-sel'), ok: t('g-ok'), free: t('g-free'), style: t('g-style'), script: t('g-script'), prices, bad }
  }, ORIG.price)
  is(g.prices > 0 && g.bad === 0, `a price is never changed, even by a rule that names it exactly (${ORIG.price} still shown ${g.prices}x)`, JSON.stringify(g))
  is(g.split === 'Now 4.000 KWD', 'the pieces of a price split over three elements are left alone (the word, the number, the currency)', g.split)
  is(g.plain === 'CHANGED' && g.ok === 'CHANGED', 'the same word away from a price IS changed (the guard is the price, not the word)', `${g.plain} / ${g.ok}`)
  is(g.ta === 'Typed by the shopper|Typed by the shopper' && g.ce === 'Typed by the shopper' && g.sel === 'Typed by the shopper' && g.style === 'Typed by the shopper' && g.script === 'Typed by the shopper',
     'text inside a textarea, a contenteditable, a select, a style and a script is never touched', JSON.stringify(g))
  is(g.free === 'Free text', 'a rule whose replacement WRITES a price is dropped', g.free)
  is(st.errors.length === 0, 'no page error', st.errors.join(' | '))
  await ctx.close()
}

async function cache() {
  await setContent(RULES())
  const { ctx, page, st } = await open()
  await go(page, '/about?lang=en')
  await until(async () => (await h1(page)) === NEW.h1en)
  is(await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sporta_content_v1')).overrides.length } catch (e) { return -1 } }) === RULES().length,
     'the answer is kept in localStorage')
  const a0 = await page.evaluate(() => window.__sportaContent.applied)
  await sleep(1200)
  is(await page.evaluate(() => window.__sportaContent.applied) === a0 && st.content === 1, 'an idle page writes nothing more and asks nothing more (no loop)', `${a0} writes, ${st.content} request(s)`)
  // the API is down: the kept copy is what the visitor sees
  st.mode.down = true; st.content = 0
  await go(page, '/about?lang=en')
  is(await until(async () => (await h1(page)) === NEW.h1en), 'with the API down the kept copy is applied')
  await sleep(600)
  is(st.content === 1, 'and the failed request is not repeated', `${st.content}`)
  // removed on the server: the cached copy is applied first, then the fresh (empty) answer puts the original back, no reload
  st.mode.down = false; st.content = 0
  await setContent([])
  await go(page, '/about?lang=en')
  is(await until(async () => (await h1(page)) === ORIG.en.h1 && (await navText(page, '/shop')) === ORIG.en.shop), 'removing the rules restores the original words when the fresh answer arrives', await h1(page))
  is(await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sporta_content_v1')).overrides.length } catch (e) { return -1 } }) === 0, 'and the kept copy is replaced')
  await go(page, '/about?lang=en'); await sleep(500)
  is(await h1(page) === ORIG.en.h1, 'the next load shows the original from the start', await h1(page))
  // a server that does not know the route yet
  st.mode.answer = null
  await ctx.close()
  const b = await open()
  await b.ctx.route('**/api/api.php?r=content', (route) => { b.st.content++; return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }) })
  await go(b.page, '/about?lang=en'); await sleep(400)
  await go(b.page, '/shop?lang=en'); await sleep(400)
  is(b.st.content === 1 && await h1(b.page) === ORIG.shopH1, 'a server without the route (404) is asked once and then left alone for the visit', `${b.st.content} request(s)`)
  await b.ctx.close()
}

async function contact() {
  await setContent([], { phone: '+96550001234', whatsapp: '96550001234', email: 'hello@sporta.com.kw', instagram: 'sporta.new', tiktok: '@sporta.new' })
  const { ctx, page, st } = await open()
  await go(page, '/contact?lang=en')
  await until(() => page.evaluate(() => !!document.querySelector('a[href^="https://wa.me/96550001234"]')))
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'c'
    d.innerHTML = '<a id="c-tel" href="tel:+96522091914">Call us 22091914</a><a id="c-share" href="https://wa.me/?text=hello">Share</a>' +
      '<a id="c-intent" href="https://x.com/intent/tweet?text=hi">Tweet</a><a id="c-wa" href="https://wa.me/96522091914?text=Order%20123">+965 2209 1914</a>' +
      '<a id="c-mail" href="mailto:cs@sporta.com.kw?subject=Hi">cs@sporta.com.kw</a><address id="c-addr">Old address</address>'
    document.body.appendChild(d)
  })
  await until(() => page.evaluate(() => document.getElementById('c-tel').getAttribute('href') === 'tel:+96550001234'))
  const c = await page.evaluate(() => {
    const a = (id) => { const e = document.getElementById(id); return e.getAttribute('href') + ' [' + e.textContent + ']' }
    const all = [...document.querySelectorAll('#root a[href]')].map((x) => x.getAttribute('href'))
    return { tel: a('c-tel'), share: a('c-share'), intent: a('c-intent'), wa: a('c-wa'), mail: a('c-mail'), addr: document.getElementById('c-addr').textContent,
      oldWa: all.filter((h) => h.includes('96522091914')).length, newWa: all.filter((h) => h.startsWith('https://wa.me/96550001234')).length,
      mailNew: all.filter((h) => h === 'mailto:hello@sporta.com.kw').length, ig: all.filter((h) => h === 'https://www.instagram.com/sporta.new').length,
      tt: all.filter((h) => h === 'https://www.tiktok.com/@sporta.new').length, text: document.querySelector('#root main').textContent }
  })
  is(c.oldWa === 0 && c.newWa >= 2, 'every WhatsApp link of the page points at the saved number', JSON.stringify({ old: c.oldWa, now: c.newWa }))
  is(c.text.includes('+965 5000 1234') && !c.text.includes('2209 1914'), 'and the number written in the link is the new one, in the same form')
  is(c.mailNew >= 1 && c.text.includes('hello@sporta.com.kw') && !c.text.includes('cs@sporta.com.kw'), 'the mailto link and the address written in it follow the saved email')
  is(c.ig >= 1 && c.tt >= 1, 'the Instagram and TikTok profile links follow the saved handles')
  is(c.tel === 'tel:+96550001234 [Call us 50001234]', 'a tel: link, and the local number inside its label', c.tel)
  is(c.wa === 'https://wa.me/96550001234?text=Order%20123 [+965 5000 1234]', 'a wa.me link keeps its ?text=', c.wa)
  is(c.mail === 'mailto:hello@sporta.com.kw?subject=Hi [hello@sporta.com.kw]', 'a mailto link keeps its ?subject=', c.mail)
  is(c.share === 'https://wa.me/?text=hello [Share]' && c.intent === 'https://x.com/intent/tweet?text=hi [Tweet]', 'a share link and an intent link are not profile links and are left alone', `${c.share} ${c.intent}`)
  is(c.addr === 'Old address', 'no address saved: an <address> is left alone', c.addr)
  await ctx.close()
  // values no server of ours would send must never reach an href
  const answer = { v: 3, overrides: [], contact: { phone: 'javascript:alert(1)', whatsapp: '965/../evil', email: 'a@b.c?bcc=x@y.z', instagram: 'https://evil.example/x', x: 'javascript:alert(1)', address_en: 'Block 1, Kuwait City' } }
  const h = await open({ answer })
  await go(h.page, '/contact?lang=en')
  await h.page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<a id="c-tel" href="tel:+96522091914">x</a><address id="c-addr">Old address</address>'; document.body.appendChild(d) })
  await until(() => h.page.evaluate(() => document.getElementById('c-addr').textContent !== 'Old address'))
  const hrefs = await h.page.evaluate(() => [...document.querySelectorAll('a[href]')].map((x) => x.getAttribute('href')))
  is(!hrefs.some((x) => /javascript:|evil|bcc=/.test(x)) && hrefs.includes('tel:+96522091914') && hrefs.some((x) => x === 'https://wa.me/96522091914'),
     'hostile contact values in the answer never reach a link (every href is the original)')
  is(await h.page.evaluate(() => document.getElementById('c-addr').textContent) === 'Block 1, Kuwait City', 'an <address> with one plain text gets the saved address')
  is(st.errors.length === 0 && h.st.errors.length === 0, 'no page error', st.errors.concat(h.st.errors).join(' | '))
  await h.ctx.close()
}

const rp = (page) => page.evaluate(() => {
  const box = document.querySelector('.returns-system__policy')
  const shown = (e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0
  const ours = [...document.querySelectorAll('[data-sporta-rp]')]
  const orig = [...box.querySelectorAll('li,p')].filter((e) => !e.closest('[data-sporta-rp]') && !e.closest('.returns-system__policy-links'))
  return {
    ours: ours.length, items: ours.length ? [...ours[0].children].map((e) => e.textContent) : [], kids: ours.length ? ours[0].querySelectorAll('*').length : 0,
    tag: ours.length ? ours[0].tagName + '>' + (ours[0].firstElementChild || {}).tagName : '',
    origCount: orig.length, origShown: orig.filter(shown).length, origText: orig.map((e) => e.textContent),
    heading: shown(box.querySelector('h2')), links: [...box.querySelectorAll('.returns-system__policy-links a')].filter(shown).map((a) => a.getAttribute('href')),
    marked: document.querySelectorAll('[data-sporta-rp-hidden]').length, intro: document.querySelector('.returns-system__intro p').textContent,
    h1: document.querySelector('.returns-system__intro h1').textContent, inside: ours.length ? box.contains(ours[0]) : null,
  }
})
const PTS = { en: ['Tell us within 30 days.', 'Keep the <b>tags</b> on & the box.', 'We collect it for free.'], ar: ['أخبرنا خلال ٣٠ يومًا.', 'احتفظ بالبطاقات.', 'نستلمه مجانًا.', 'نرد المبلغ.', 'نقطة خامسة.', 'نقطة سادسة.'] }

async function returns(tag = '') {
  let key = true
  for (const variant of tag ? ['list'] : ['list', 'paras']) {
    const nOrig = variant === 'list' ? 5 : 4
    await setContent([]); await setReturns()
    const { ctx, page, st } = await open({ variant, ...(tag ? { features: FEATURES_WITHOUT } : {}) })
    if (!tag) {
      await go(page, '/returns?lang=en'); await sleep(500)
      const base = await rp(page)
      is(base.ours === 0 && base.marked === 0 && base.origShown === nOrig && base.intro === HEAD.en.intro, `[${variant}] nothing saved: the page is exactly its own (${nOrig} points, nothing added, nothing marked)`, JSON.stringify(base).slice(0, 200))
    }
    await setReturns({ points_en: PTS.en, points_ar: PTS.ar, intro_en: 'Easy returns, your way.', intro_ar: 'إرجاع سهل.' })
    await go(page, '/returns?lang=en')
    const ok = await until(async () => { const r = await rp(page); return r.ours === 1 && r.items.length === 3 })
    const en = await rp(page)
    key = is(ok && JSON.stringify(en.items) === JSON.stringify(PTS.en) && en.origShown === 0, `${tag}[${variant}] en: the saved points are shown in place of the fixed ones`, JSON.stringify(en).slice(0, 260)) && key
    if (tag) { await ctx.close(); continue }
    is(en.origCount === nOrig && en.origText[0] === POINTS.en[0], `[${variant}] en: the page's own point elements are still there, untouched, only hidden`)
    is(en.kids === 3 && en.inside === true && en.tag === (variant === 'list' ? 'UL>LI' : 'DIV>P'), `[${variant}] en: our list is one node inside the section, built like the originals; HTML in a point is text`, `${en.tag} ${en.kids}`)
    is(en.heading && en.links.length === 2 && en.links[0] === '/terms#returns' && en.links[1] === 'https://wa.me/96522091914', `[${variant}] en: the heading and the two links stay`, JSON.stringify(en.links))
    is(en.intro === 'Easy returns, your way.' && en.h1 === HEAD.en.h1, `[${variant}] en: the intro paragraph says the saved intro, the title is the page's`, en.intro)
    // React re-renders the section (new nodes)
    await page.evaluate(() => window.__render('en'))
    const again = await until(async () => { const r = await rp(page); return r.ours === 1 && r.origShown === 0 && r.intro === 'Easy returns, your way.' ? r : null })
    is(!!again && JSON.stringify(again.items) === JSON.stringify(PTS.en), `[${variant}] en: after a re-render there is still exactly one list of ours and the originals are hidden again`, JSON.stringify(await rp(page)).slice(-260))
    // language switch without a load
    await page.evaluate(() => window.__render('ar'))
    const ar = await until(async () => { const r = await rp(page); return r.ours === 1 && r.items.length === 6 ? r : null })
    is(!!ar && JSON.stringify(ar.items) === JSON.stringify(PTS.ar) && ar.origShown === 0 && ar.intro === 'إرجاع سهل.', `[${variant}] ar: the Arabic points and intro replace the Arabic originals (6 points for ${nOrig} elements)`, JSON.stringify(await rp(page)).slice(0, 260))
    await go(page, '/exchange?lang=ar')
    is(!!(await until(async () => { const r = await rp(page); return r.ours === 1 && r.items.length === 6 })), `[${variant}] /exchange is the same page and gets the same points`)
    is(st.content === 3, `[${variant}] one content request per page load (three loads so far)`, `${st.content}`)
    // cleared: the cached copy first, then the fresh answer restores the page, no reload
    await setReturns()
    await go(page, '/returns?lang=ar')
    const back = await until(async () => { const r = await rp(page); return r.ours === 0 && r.marked === 0 && r.origShown === nOrig && r.intro === HEAD.ar.intro ? r : null })
    is(!!back && back.origText[0] === POINTS.ar[0], `[${variant}] clearing the points and the intro restores the page's own`, JSON.stringify(await rp(page)).slice(0, 260))
    is(await page.evaluate(() => ![...document.querySelectorAll('.returns-system__policy *')].some((e) => e.style.display === 'none')), `[${variant}] and no inline display is left behind`)
    // the number of days alone
    const first = async () => (await rp(page)).origText[0]
    for (const [days, en1, ar1] of [[30, 'within 30 days of delivery', 'خلال ٣٠ يومًا من التسليم'], [7, 'within 7 days of delivery', 'خلال ٧ أيام من التسليم'],
      [2, 'within 2 days of delivery', 'خلال يومين من التسليم'], [1, 'within 1 day of delivery', 'خلال يوم واحد من التسليم'], [11, 'within 11 days of delivery', 'خلال ١١ يومًا من التسليم']]) {
      await setReturns({ window_days: days })
      await go(page, '/returns?lang=en')
      const e = await until(async () => { const t = await first(); return t.includes(en1) ? t : null })
      await page.evaluate(() => window.__render('ar'))
      const a = await until(async () => { const t = await first(); return t.includes(ar1) ? t : null })
      is(!!e && !!a && e.endsWith(POINTS.en[0].slice(POINTS.en[0].indexOf(' of delivery'))) && a.endsWith(POINTS.ar[0].slice(POINTS.ar[0].indexOf(' من التسليم'))) && (await rp(page)).ours === 0,
         `[${variant}] ${days} days, no custom points: only the number changes in the first point (en "${en1}", ar "${ar1}")`, `${await first()}`)
    }
    await setReturns({ window_days: 30 })
    await go(page, '/about?lang=en'); await sleep(500)
    is(await page.evaluate(() => !document.querySelector('[data-sporta-rp],[data-sporta-rp-hidden]')) && await h1(page) === ORIG.en.h1, `[${variant}] off /returns and /exchange nothing of it is applied`)
    is(st.errors.length === 0, `[${variant}] no page error`, st.errors.join(' | '))
    await ctx.close()
  }
  await setReturns()
  return key
}

async function adminScreen(tag = '') {
  await setContent([]); await setReturns()
  const { ctx, page, st } = await open(tag ? { brands: BRANDS_WITHOUT } : {})
  const signed = await ctx.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, data: LOGIN })
  if (!tag) is(signed.status() === 200, 'the browser signs in on the sandbox admin API', `${signed.status()}`)
  await page.goto(BASE + '/backends', { waitUntil: 'load' })
  const entry = await until(() => page.evaluate(() => !!document.querySelector('[data-sporta-sc-nav]')), tag ? 2500 : 8000)
  const key = is(entry, `${tag}the Site content entry is added to the admin`)
  if (tag) { await ctx.close(); return key }
  is(await page.evaluate(() => document.querySelectorAll('nav.admin-sidebar__nav [data-sporta-sc-nav]').length === 1 && document.querySelector('[data-sporta-content]').hidden === true),
     'one nav button, and the panel is closed until it is pressed')
  await page.click('nav.admin-sidebar__nav [data-sporta-sc-nav]')
  is(await until(() => page.evaluate(() => !document.querySelector('[data-sporta-content]').hidden && new URLSearchParams(location.search).get('tab') === 'content'
     && [...document.querySelectorAll('main.admin-content > section.admin-page')].filter((s) => getComputedStyle(s).display !== 'none').length === 1)),
     'pressing it shows the panel alone (?tab=content), the compiled sections hidden by CSS')
  await page.selectOption('select[name="ssc_page"]', '/about')
  await page.selectOption('select[name="ssc_lang"]', 'en')
  await page.click('text=Load texts')
  const loaded = await until(() => page.evaluate(() => document.querySelectorAll('.ssc-row').length > 5), 30000)
  const rows = await page.evaluate(() => [...document.querySelectorAll('.ssc-row .ssc-orig')].map((e) => e.textContent))
  is(loaded && rows.includes(ORIG.en.h1) && rows.includes(ORIG.en.shop), 'Load texts lists the words of /about in English, the title and the menu among them', `${rows.length} rows`)
  is(!rows.some((t) => /[0-9]\s*KWD|KWD\s*[0-9]/.test(t)) && new Set(rows).size === rows.length, 'no price is offered for editing, and each text is listed once')
  is(await page.evaluate(() => !document.querySelector('iframe[data-sporta-sc-frame]')), 'the hidden iframe is removed once it has been read')
  await page.evaluate((t) => {
    const row = [...document.querySelectorAll('.ssc-row')].find((r) => r.querySelector('.ssc-orig').textContent === t)
    const ta = row.querySelector('textarea'); ta.value = 'Typed in the admin <i>x</i>'; ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, ORIG.en.h1)
  await page.fill('input[name="ssc_phone"]', '+965 5000 1234')
  await page.fill('input[name="ssc_instagram"]', '@sporta.admin')
  await page.fill('input[name="ssc_window_days"]', '21')
  await page.click('[data-sporta-sc-points="en"] >> text=Add a point')
  await page.fill('[data-sporta-sc-points="en"] textarea', 'A point from the admin')
  await page.uncheck('input[name="ssc_allow_exchange"]')
  await page.click('button[type="submit"]:has-text("Save site content")')
  is(await until(() => page.evaluate(() => /Saved\./.test(document.querySelector('.ssc-status').textContent)), 10000), 'Save reports success', await page.evaluate(() => document.querySelector('.ssc-status').textContent))
  const stored = (await (await fetch(`${BASE}/api/api.php?r=content`)).json())
  is(stored.overrides.length === 1 && stored.overrides[0].page === '/about' && stored.overrides[0].lang === 'en' && stored.overrides[0].match === ORIG.en.h1 && stored.overrides[0].text === 'Typed in the admin <i>x</i>',
     'the rule is on the server, for that page and language', JSON.stringify(stored.overrides))
  is(stored.contact.phone === '+96550001234' && stored.contact.instagram === 'https://www.instagram.com/sporta.admin', 'the contact values are on the server, normalised', JSON.stringify(stored.contact))
  is(stored.returns.window_days === 21 && stored.returns.allow_exchange === false && stored.returns.allow_return === true && stored.returns.points_en[0] === 'A point from the admin',
     'the returns card is saved through its own route (window, switch, point)', JSON.stringify(stored.returns))
  is(await page.evaluate(() => document.querySelector('input[name="ssc_phone"]').value) === '+96550001234' && await page.evaluate(() => /Everything is saved/.test(document.querySelector('.ssc-dirty').textContent)),
     'the form shows what the server stored and says everything is saved')
  const shop = await open()
  await go(shop.page, '/about?lang=en')
  is(await until(async () => (await h1(shop.page)) === 'Typed in the admin <i>x</i>'), 'and the storefront shows the words typed in the admin', await h1(shop.page))
  await shop.ctx.close()
  // refusal is reported, nothing is lost
  await page.fill('input[name="ssc_email"]', 'not-an-address')
  await page.click('button[type="submit"]:has-text("Save site content")')
  is(await until(() => page.evaluate(() => document.querySelector('.ssc-status').getAttribute('data-bad') === '1' && /email/i.test(document.querySelector('.ssc-status').textContent))), 'a value the server refuses is reported in words')
  await page.fill('input[name="ssc_email"]', '')
  // remove the rule
  await page.click('.ssc-rule >> text=Remove')
  await page.click('button[type="submit"]:has-text("Save site content")')
  await until(() => page.evaluate(() => /Saved\./.test(document.querySelector('.ssc-status').textContent)), 10000)
  is((await (await fetch(`${BASE}/api/api.php?r=content`)).json()).overrides.length === 0, 'Remove, then Save, takes the rule off the server')
  // leaving by React's own nav closes the panel
  await page.click('nav.admin-sidebar__nav .admin-nav-item:not([data-sporta-sc-nav]):not([data-sporta-ab-nav])')
  is(await until(() => page.evaluate(() => document.querySelector('[data-sporta-content]').hidden && !document.body.hasAttribute('data-sporta-sc'))), "a click on one of the admin's own tabs closes the panel")
  is(st.errors.length === 0, 'no page error in the admin', st.errors.join(' | '))
  await ctx.close()
  await setContent([]); await setReturns()
  return key
}

// ----------------------------------------------------------------------- run
try {
  if (on(1)) { head('1 rules'); await rules() }
  if (on(2)) { head('2 routes and blocked pages'); await routes() }
  if (on(3)) { head('3 guards'); await guards() }
  if (on(4)) { head('4 cache, removal, loops'); await cache() }
  if (on(5)) { head('5 contact'); await contact() }
  if (on(6)) { head('6 returns & exchange'); await returns() }
  if (on(7)) { head('7 admin screen'); await adminScreen() }
  if (on(8)) {
    head('8 mutation: the key checks fail with the block disabled')
    quiet = true
    const m1 = await rules('mutant: '), m2 = await returns('mutant: '), m3 = await adminScreen('mutant: ')
    quiet = false
    is(m1 === false, 'storefront block cut out of sporta-features.js: "an override changes the text" FAILS (mutant caught)')
    is(m2 === false, 'storefront block cut out: "the saved points are shown in place of the fixed ones" FAILS (mutant caught)')
    is(m3 === false, 'admin block cut out of sporta-admin-brands.js: "the Site content entry is added" FAILS (mutant caught)')
  }
} catch (e) {
  fail++; console.log('FAIL the suite stopped: ' + (e && e.stack ? e.stack : e))
} finally {
  await browser.close()
  await reset().catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
