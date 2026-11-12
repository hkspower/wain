// The Abandoned orders panel (block "ADMIN ABANDONED ORDERS", the last one in public/sporta-admin-brands.js), in a real browser.
//
//   npm run test:abandoned-ui     (rig-free: no database, no PHP, no server; the admin API is a fake answered by route
//                                  interception from scripts/lib/abandoned-ui-mock.mjs, which follows the route contract)
//
// THE PAGE. The markup of the REAL compiled /backends admin (scripts/fixtures/sizes-admin/orders.html: sidebar, phone header,
// tab bar, the Orders screen, captured from the live build) under the REAL compiled rules (live.css), the 14 add-on stylesheets
// the live index.html links, the stylesheets the add-on scripts inject, the build's dark rules (admin-dark-rules.css) and the
// stand-in for the admin's own stylesheets (shell.css; its header says what it is built from), then the REAL add-on file under the
// live Content-Security-Policy (script-src 'self': an inline script, an inline handler or an eval would fail here as live).
// What React does to that markup is played by scripts/lib/abandoned-ui-shim.mjs, written from the compiled AdminApp code
// (tab state, hidden sections, aria-current / className written only when the computed value changed, the phone menu, popstate).
// scripts/abandoned-ui-live-check.mjs runs the same panel against the REAL compiled bundle when a capture of the live build is
// at hand (SIZES_ADMIN_LIVE_DIR), because a shim is only as good as its reading of React.
//
// What is asserted:
//   - ROUTE ABSENT (the live admin.php today: 404 not_found): exactly ONE request goes out (the probe), nothing is added to the
//     page (no style, no button, no section), through clicks, re-renders and a sign-out / sign-in; a route that exists (400
//     invalid_filter), a signed-out session, a network failure and a server error all keep the entry;
//   - THE ENTRY: one button right after Orders in the sidebar, one tile in the phone's menu, one extra title in the phone header;
//     the React-owned DOM is IDENTICAL with and without the block after the same clicks (open / close / click the tab already
//     shown / back), the body and its style attribute are left clean, React's text node and handlers are the ones it made;
//   - OPENING: nothing but the probe is requested until the panel opens; the compiled sections are hidden by CSS only; only our
//     entry is current; any click on React's own nav closes the panel first; Back closes, Forward reopens; ?tab=abandoned opens;
//     a rebuilt nav and a sign-out / sign-in leave one entry, a closed panel and NO customer data in the page;
//   - THE LIST: summary tiles, rules in force, every field of the contract on a row (money, dates, phone, items with the cap,
//     reason in words, stock / discount, recovered), filters (reason, tile, dates, search with a debounce and Enter, recovered,
//     clear, from after to refused with no request), a stale answer never replaces a newer one, Load more (no duplicates even when
//     a page overlaps, one request for a double click), loading / empty / 500 / 429 (countdown) / 503 / 401 / 404 / network states
//     with Try again;
//   - CSV: the BOM bytes, CRLF, every cell quoted, quotes doubled, Arabic intact, a cell that starts with = + - @ prefixed with ',
//     only the rows on screen;
//   - WHATSAPP / CALL: https://wa.me/<phone>?text=<encoded wording>, Arabic or English by the customer's language (Arabic when
//     unknown), {name} and {order} filled, no link for a phone that is not a Kuwaiti mobile, tel:+..., none at all for an order still
//     waiting; the wording is editable, saved in the browser, can be turned off and reset;
//   - FOLLOW-UP: the state shows at once and the request carries order_id / state / note; success shows who and when; a failure
//     (500, 409, 429, network) puts the state, the note and the recovered mark back with a message; one request at a time per row;
//     recovered-by-hand refreshes the counts; Clear; the note is its own button;
//   - NOTHING IS KEPT but the owner's wording: the only web-storage write across every scenario is "sporta_ab_msg" (and none
//     before the wording is touched), no cookie, no IndexedDB; every admin request carries X-Sporta-Admin and same-origin
//     credentials; the only routes called are the two; no console error and no page error anywhere;
//   - ESCAPING: a name that is markup shows as text, creates no element and runs nothing; names and areas carry dir="auto";
//   - 320 / 390 / 768 / 1280, light and dark (the admin's own switch, with the device on either side): no sideways scroll, every
//     interactive element 40px or more, a table from 720px of panel width and stacked cards under it, every text 4.5:1 or better,
//     a visible focus ring, the dark palette follows the ADMIN's switch;
//   - the Save bar and the other blocks of the file keep running beside it (no bar for the panel's buttons, no error);
//   - customer text that fights the page (section 11, added in the independent review): a bidi override that never closes is dropped
//     from the screen and the CSV, and a name with $ patterns is copied into the WhatsApp text as typed;
//   - MUTATION CHECK: 23 copies of the file, each with one behaviour removed or broken, each caught by the check written for it.
//
// Measured 2026-11-04 on a 4-CPU box at load average 50: 245 checks, 0 failed, all 21 mutants caught (about 25 minutes); section 11 and its
// two mutants were added afterwards. Run one section
// with ONLY=2,3 (1 absent route, 2 entry, 3 phone, 4 list, 5 CSV, 6 WhatsApp, 7 follow-up, 8 layout, 9 file-wide, 10 mutants, 11 hostile text);
// SHOTS=/some/dir saves screenshots of section 8. The same panel against the real compiled React: abandoned-ui-live-check.mjs.
import { chromium } from 'playwright'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixturePage, addonFiles, PUB } from './lib/sizes-admin-page.mjs'
import { createMock, makeOrders, SESSION_COOKIE, ME } from './lib/abandoned-ui-mock.mjs'
import { SHIM_JS, SHIM_CSS } from './lib/abandoned-ui-shim.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// The file under test is the add-on file WITHOUT the "ADMIN SITE CONTENT" block (2026-11-10). That block adds its own entry and sends
// its own probe (GET content), so with it in the page "exactly ONE request, the probe" and "the only routes called are the two"
// stop being statements about THIS block. It has its own suite, scripts/site-content-test.mjs, which runs the WHOLE file on the
// real admin API and checks the two panels beside each other (each closes when the other opens).
// The "ADMIN KNET REFUNDS" block (2026-11-12) is left out for the same reason: it sends its own probe (GET payment_alerts) and
// has its own suite, scripts/knet-refund-ui-test.mjs.
const BRANDS = (() => {
  let all = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
  for (const name of ['ADMIN SITE CONTENT', 'ADMIN KNET REFUNDS']) {
    const a = all.indexOf(`/* ===== ${name} - begin`), b = all.indexOf(`/* ===== ${name} - end`)
    if (a >= 0 && b > a) all = all.slice(0, a) + all.slice(all.indexOf('\n', b))
  }
  return all
})()
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const DARK_ADMIN = DARK.slice(DARK.indexOf('/* ---- build /assets/AdminApp'))
const BEGIN = BRANDS.indexOf('/* ===== ADMIN ABANDONED ORDERS - begin')
const END_MARK = '/* ===== ADMIN ABANDONED ORDERS - end'
const END = BRANDS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN ABANDONED ORDERS block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const WITHOUT = BRANDS.slice(0, BEGIN) + BRANDS.slice(BRANDS.indexOf('\n', END))
const BLOCK = BRANDS.slice(BEGIN, BRANDS.indexOf('\n', END))
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const on = (n) => !ONLY || ONLY.includes(String(n))
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const ADDONS = addonFiles()
const htmlCache = {}
const adminHtml = (dark) => {
  const k = dark ? 'd' : 'l'
  if (!htmlCache[k]) {
    htmlCache[k] = fixturePage('orders', ADDONS, { dark })
      .replace('</head>', `<style id="fx-darkadmin">${DARK_ADMIN}</style><style id="fx-shim">${SHIM_CSS}</style></head>`)
      .replace('</body>', '<script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body>')
  }
  return htmlCache[k]
}
const MIME = { woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' }

// Everything every page reports, to be judged at the end.
const ALL = { errors: [], cleanErrors: [], writes: [], fetches: [], routes: new Set() }
const NET = /^console: Failed to load resource/        // the browser's own line for an HTTP error status or an aborted request

// ------------------------------------------------------------------------------------------------ the page + the fake API
let browser
async function open(opts = {}) {
  const { w = 1280, h = 900, dark = false, deviceDark = dark, js = BRANDS, path = '/backends', routePresent = true, orders, record = true } = opts
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: deviceDark ? 'dark' : 'light', isMobile: w < 500, hasTouch: w < 800, serviceWorkers: 'block', acceptDownloads: true, locale: 'en-US' })
  await ctx.addCookies([{ name: SESSION_COOKIE, value: 'fixture-session', url: ORIGIN }])
  const S = { ctx, w, mock: createMock({ orders: orders || makeOrders(), routePresent }), rules: [], errors: [], js, hold: null, closed: false, faulted: !routePresent }
  const pg = await ctx.newPage()
  pg.setDefaultTimeout(30000)
  S.pg = pg
  pg.on('pageerror', (e) => S.errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error') S.errors.push('console: ' + m.text()) })
  await pg.addInitScript(() => {
    // every write to web storage, cookies and IndexedDB, and every fetch with the options it was made with
    window.__writes = []; window.__fetches = []; window.__xss = undefined
    for (const k of ['setItem', 'removeItem', 'clear']) {
      const o = Storage.prototype[k]
      Storage.prototype[k] = function (a) { window.__writes.push((this === window.localStorage ? 'local' : 'session') + ':' + k + ':' + (a === undefined ? '' : a)); return o.apply(this, arguments) }
    }
    const cd = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    Object.defineProperty(document, 'cookie', { get() { return cd.get.call(document) }, set(v) { window.__writes.push('cookie:' + String(v).split('=')[0]); cd.set.call(document, v) } })
    const idb = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (n) { window.__writes.push('indexeddb:' + n); return idb.apply(this, arguments) }
    const f = window.fetch
    window.fetch = function (input, init) {
      window.__fetches.push({ url: String(input), method: (init && init.method) || 'GET', credentials: init && init.credentials, headers: init && init.headers, cache: init && init.cache })
      return f.apply(this, arguments)
    }
  })
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    if (u.origin !== ORIGIN) return route.abort()
    if (p === '/api/admin.php') {
      const info = { method: req.method(), query: u.searchParams, headers: await req.allHeaders(), cookie: (await req.allHeaders()).cookie || '', body: req.postData() || '' }
      const route_ = u.searchParams.get('r')
      if (ALL) ALL.routes.add(route_)
      const rule = S.rules.find((r) => r.match(info))
      if (rule && rule.once !== false) S.rules.splice(S.rules.indexOf(rule), 1)
      // the server sees the request when it arrives (a held or slow ANSWER does not delay that), then the answer is shaped
      let out
      if (rule && (rule.status || rule.abort)) { S.mock.calls.push({ route: route_, method: info.method, query: info.query.toString(), body: info.body }); out = { status: rule.status, headers: rule.headers, body: rule.body } }
      else out = S.mock.handle(info)
      if (S.hold && info.method === (S.hold.method || 'POST') && (!S.hold.route || S.hold.route === route_)) { S.hold.seen = (S.hold.seen || 0) + 1; await S.hold.promise }
      if (rule && rule.delay) await sleep(rule.delay)
      if (rule && rule.abort) { S.faulted = true; return route.abort('failed') }
      if (out.status >= 400) S.faulted = true
      let body = out.body
      if (rule && rule.transform && out.status === 200) body = rule.transform(body)
      return route.fulfill({ status: out.status, contentType: 'application/json', headers: { 'cache-control': 'no-store', ...(out.headers || {}) }, body: JSON.stringify(body) })
    }
    if (p === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: SHIM_JS })
    if (p === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: S.js })
    if (p.startsWith('/fonts/')) {
      try { return route.fulfill({ status: 200, contentType: MIME[p.split('.').pop()] || 'application/octet-stream', body: readFileSync(join(PUB, p)) }) } catch { return route.fulfill({ status: 404, body: '' }) }
    }
    if (p === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    if (p === '/backends' && u.searchParams.get('shell') === 'plain') return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title></head><body><div id="root"><div class="admin-shell"><aside class="admin-sidebar"><nav><ul><li><a href="#">Orders</a></li></ul></nav></aside><main class="admin-content"><h1>Orders</h1></main></div></div><script src="/sporta-admin-brands.js"></script></body></html>' })
    if (p === '/backends') return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: adminHtml(dark) })
    if (p === '/') return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Sporta</title></head><body><main><h1>Storefront</h1></main><script src="/sporta-admin-brands.js"></script></body></html>' })
    return route.fulfill({ status: 404, body: '' })
  })
  S.close = async () => {
    if (S.closed) return
    S.closed = true
    if (record) {
      try {
        const w = await pg.evaluate(() => window.__writes), f = await pg.evaluate(() => window.__fetches)
        ALL.writes.push(...w); ALL.fetches.push(...f.filter((x) => x.url.includes('/api/admin.php')))
      } catch { /* the page is gone */ }
      ALL.errors.push(...S.errors.filter((e) => !NET.test(e)))
      if (!S.faulted) ALL.cleanErrors.push(...S.errors)
    }
    await ctx.close()
  }
  await pg.goto(ORIGIN + path)
  return S
}

// ------------------------------------------------------------------------------------------------ helpers
const SEL = '[data-sporta-abandoned]'
const ROWS = `${SEL} tbody tr[data-id]`
const NAV = '.admin-sidebar [data-sporta-ab-nav]'
const TILE = '.m-menu-item[data-sporta-ab-nav]'
const list = (S) => S.mock.calls.filter((c) => c.route === 'abandoned_orders' && !c.query.includes('from=2000-01-01'))
const posts = (S) => S.mock.calls.filter((c) => c.route === 'abandoned_followup')
const waitRows = (pg, n = 1) => pg.waitForFunction(([s, n]) => document.querySelectorAll(s).length >= n, [ROWS, n])
const waitText = (pg, sel, re) => pg.waitForFunction(([s, src]) => { const e = document.querySelector(s); return !!e && new RegExp(src).test(e.textContent || '') }, [sel, re instanceof RegExp ? re.source : re])
const q1 = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null }, sel)
const count = (pg, sel) => pg.evaluate((s) => document.querySelectorAll(s).length, sel)
const visible = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' }, sel)
async function waitEntry(S) { await S.pg.waitForSelector('[data-sporta-ab-nav]', { state: 'attached' }) }
const wide = (S) => S.w >= 768
async function openPhoneMenu(S) { await S.pg.locator('.m-header__menu').click(); await S.pg.waitForSelector(TILE, { state: 'attached' }) }
async function openPanel(S, wait = true) {
  await waitEntry(S)
  if (wide(S)) await S.pg.locator(NAV).click()
  else { await openPhoneMenu(S); await S.pg.locator(TILE).click() }
  if (wait) await waitRows(S.pg)
}
const reactDom = (pg) => pg.evaluate(() => {
  const r = document.getElementById('root').cloneNode(true)
  r.querySelectorAll('[data-sporta-ab-nav],[data-sporta-abandoned],[data-sporta-ab-title]').forEach((n) => n.remove())
  r.querySelectorAll('[data-sporta-ab-cur]').forEach((n) => n.removeAttribute('data-sporta-ab-cur'))
  return r.innerHTML
})
const expected = (S, query) => createMock({ orders: S.mock.orders }).handle({ method: 'GET', query: new URLSearchParams('r=abandoned_orders' + (query ? '&' + query : '')), headers: { 'x-sporta-admin': '1' }, cookie: SESSION_COOKIE + '=1', body: '' }).body
const kd = (v) => Number(v).toFixed(3) + ' KD'
const clickReact = (S, label) => S.pg.locator(wide(S) ? '.admin-sidebar .admin-nav-item' : '.m-menu-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click()
const search = (pg) => new URL(pg.url()).search
const rowOf = (pg, id) => pg.locator(`${ROWS}[data-id="${id}"]`)
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\r') { /* CRLF */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
async function downloadCsv(S) {
  const [dl] = await Promise.all([S.pg.waitForEvent('download'), S.pg.locator(`${SEL} .sab-tools button`).filter({ hasText: /^Export CSV/ }).click()])
  const path = await dl.path()
  return { bytes: readFileSync(path), name: dl.suggestedFilename() }
}
async function loadAllRows(S) {
  for (let i = 0; i < 5; i++) {
    if (!(await visible(S.pg, `${SEL} .sab-more button`))) break
    const n = await count(S.pg, ROWS)
    await S.pg.locator(`${SEL} .sab-more button`).click()
    await S.pg.waitForFunction(([s, n]) => document.querySelectorAll(s).length > n, [ROWS, n])
  }
}

// Section 11 and its two mutants: the mock's orders with two customer names changed - one with a bidi override that never closes, one with the
// patterns ($' $& $1) that a string replacement would read - both on orders that get a WhatsApp link.
function badNames() {
  const orders = makeOrders()
  const [o1, o2] = orders.filter((o) => o.customer_lang === 'en' && o.whatsapp_phone && ['unpaid', 'expired', 'declined'].includes(o.reason))
  o1.customer_name = 'Ali\u202egnirts 1234'
  o2.customer_name = "Sam$'s $& $1 Mo"
  return { orders, o1, o2 }
}

browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

// ================================================================================================ 1. the route is absent
if (on(1)) {
head('1. the route is absent (the live admin.php today)')
{
  const S = await open({ routePresent: false })
  await sleep(1500)
  const a = S.mock.calls
  is(a.length === 1 && a[0].route === 'abandoned_orders' && a[0].method === 'GET' && a[0].query.includes('from=2000-01-01'), 'exactly ONE request went out, the probe (GET abandoned_orders for the single day 2000-01-01: an empty window)', JSON.stringify(a))
  const nothing = () => S.pg.evaluate(() => ({ nav: document.querySelectorAll('[data-sporta-ab-nav]').length, sec: document.querySelectorAll('[data-sporta-abandoned]').length, style: document.querySelectorAll('style[data-sporta-ab-style]').length, title: document.querySelectorAll('[data-sporta-ab-title]').length, attr: document.body.hasAttribute('data-sporta-ab') }))
  is(JSON.stringify(await nothing()) === JSON.stringify({ nav: 0, sec: 0, style: 0, title: 0, attr: false }), 'nothing is added to the page: no button, no section, no style, no title, no body mark')
  await S.pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Returns\s*$/ }).click()
  await S.pg.evaluate(() => window.fx.rerenderNav())
  await S.pg.evaluate(() => { window.fx.signOut(); window.fx.signIn() })
  await S.pg.locator('.m-header__menu').evaluate((e) => e.click())
  await sleep(700)
  is(JSON.stringify(await nothing()) === JSON.stringify({ nav: 0, sec: 0, style: 0, title: 0, attr: false }) && S.mock.calls.length === 1, 'still nothing, and still one request, after a tab change, a rebuilt nav, a sign-out and sign-in and the phone menu')
  await S.close()
}
{
  // The DOM of a page WITH the block equals the DOM of a page WITHOUT it when the route is absent
  const A = await open({ routePresent: false }), B = await open({ routePresent: false, js: WITHOUT })
  await sleep(1000)
  is((await reactDom(A.pg)) === (await reactDom(B.pg)) && (await A.pg.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' '))) === (await B.pg.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' '))), 'with the route absent the whole body is byte-for-byte what it is without the block')
  is((await A.pg.evaluate(() => document.head.innerHTML)) === (await B.pg.evaluate(() => document.head.innerHTML)), 'and so is the <head>')
  await A.close(); await B.close()
}
for (const [label, rule, expectEntry] of [
  ['a route that exists (200, an empty window)', null, true],
  ['a signed-out session (401)', { match: (i) => i.query.get('from') === '2000-01-01', status: 401, body: { error: 'not_signed_in' } }, true],
  ['a server error (500)', { match: (i) => i.query.get('from') === '2000-01-01', status: 500, body: { error: 'failed' } }, true],
  ['a throttled probe (429)', { match: (i) => i.query.get('from') === '2000-01-01', status: 429, headers: { 'Retry-After': '3' }, body: { error: 'too_many_attempts' } }, true],
  ['no network', { match: (i) => i.query.get('from') === '2000-01-01', abort: true }, true],
  ['an Apache 404 page that is not JSON', { match: (i) => i.query.get('from') === '2000-01-01', status: 404, body: '<html>nf</html>' }, false],
]) {
  const S = await open({})
  if (rule) { await waitEntry(S); S.rules.push(rule); await S.pg.reload() }      // (the first load's own probe is done before the rule is set)
  await sleep(900)
  const n = await count(S.pg, '[data-sporta-ab-nav]')
  is(expectEntry ? n === 1 : n === 0, `${label}: the entry ${expectEntry ? 'stays' : 'is not added'}`)
  await S.close()
}
{
  // a page that only LOOKS like the admin (an aside.admin-sidebar with a nav, a main.admin-content) is left alone: the compiled
  // shell is recognised by the class of its nav (this is also what keeps the other suites' stripped fixtures free of the probe)
  const S = await open({ path: '/backends?shell=plain' })
  await sleep(900)
  is(S.mock.calls.length === 0 && (await count(S.pg, 'style[data-sporta-ab-style], [data-sporta-ab-nav], [data-sporta-abandoned]')) === 0, 'a stripped look-alike shell (no nav.admin-sidebar__nav) gets no probe and no node')
  await S.close()
}
{
  const S = await open({ path: '/' })
  await sleep(700)
  is(S.mock.calls.length === 0 && (await count(S.pg, 'style[data-sporta-ab-style], [data-sporta-ab-nav], [data-sporta-abandoned]')) === 0, 'on the storefront (not /backends) the file does nothing: no request, no style, no node')
  await S.close()
}
}

// ================================================================================================ 2. the entry, and React's DOM
if (on(2)) {
head('2. the entry in the shell, and React\'s own DOM')
{
  const S = await open({})
  await waitEntry(S)
  const pg = S.pg
  const facts = await pg.evaluate(() => {
    const navs = [...document.querySelectorAll('.admin-sidebar [data-sporta-ab-nav]')]
    const kids = [...document.querySelector('nav.admin-sidebar__nav').children]
    const i = kids.indexOf(navs[0])
    const btn = navs[0], r = btn.getBoundingClientRect()
    return { n: navs.length, after: kids[i - 1] && kids[i - 1].textContent.trim(), text: btn.textContent.trim(), cls: btn.className, cur: btn.getAttribute('aria-current'), h: r.height, styles: document.querySelectorAll('style[data-sporta-ab-style]').length,
      panelHidden: document.querySelector('[data-sporta-abandoned]').hidden, ordersVisible: !document.querySelectorAll('main.admin-content > section.admin-page')[1].hidden }
  })
  is(facts.n === 1 && facts.after === 'Orders' && facts.text === 'Abandoned orders', 'one sidebar button, right after Orders, "Abandoned orders"', JSON.stringify(facts))
  is(/admin-nav-item/.test(facts.cls) && facts.cur === null && facts.h >= 40, 'it is built like the others (admin-nav-item), not current while closed, and tall enough to tap', `${facts.h}px`)
  is(facts.styles === 1 && facts.panelHidden && facts.ordersVisible, 'one <style>, the panel is built hidden and React\'s Orders section is still the one shown')
  is(list(S).length === 0 && S.mock.calls.length === 1, 'nothing but the probe is requested until the panel opens')

  const before = { title: await pg.evaluate(() => window.fx.strongTextNode().data), len: await pg.evaluate(() => history.length) }
  await pg.locator(NAV).click()
  await waitRows(pg)
  await sleep(900)                                    // (colour transitions of the compiled nav item have settled)
  const open1 = await pg.evaluate(() => {
    const panel = document.querySelector('[data-sporta-abandoned]'), orders = document.querySelectorAll('main.admin-content > section.admin-page')[1]
    const cur = [...document.querySelectorAll('[aria-current="page"]')]
    const ordersBtn = [...document.querySelectorAll('.admin-sidebar .admin-nav-item')].find((b) => b.textContent.trim() === 'Orders')
    const returnsBtn = [...document.querySelectorAll('.admin-sidebar .admin-nav-item')].find((b) => b.textContent.trim() === 'Returns')
    const cs = (e) => getComputedStyle(e)
    return {
      shown: !panel.hidden && panel.getBoundingClientRect().height > 0, ordersDisplay: cs(orders).display, ordersHiddenAttr: orders.hidden, body: document.body.getAttribute('data-sporta-ab'),
      curCount: cur.length, curIsOurs: cur[0] && cur[0].hasAttribute('data-sporta-ab-nav'),
      ordersMarked: ordersBtn.hasAttribute('data-sporta-ab-cur'), ordersCur: ordersBtn.getAttribute('aria-current'),
      ordersColor: cs(ordersBtn).color, returnsColor: cs(returnsBtn).color, ordersBg: cs(ordersBtn).backgroundColor, returnsBg: cs(returnsBtn).backgroundColor,
      ordersBorder: cs(ordersBtn).borderTopWidth + cs(ordersBtn).borderTopColor + cs(ordersBtn).boxShadow, returnsBorder: cs(returnsBtn).borderTopWidth + cs(returnsBtn).borderTopColor + cs(returnsBtn).boxShadow,
      url: location.search, len: history.length, focus: document.activeElement && document.activeElement.id, ink: document.body.style.getPropertyValue('--sab-nav-ink'),
      ourCls: document.querySelector('.admin-sidebar [data-sporta-ab-nav]').className,
    }
  })
  is(open1.shown && open1.body === 'open', 'a click opens the panel')
  is(open1.ordersDisplay === 'none' && open1.ordersHiddenAttr === false, 'React\'s Orders section is hidden by CSS only: it is still in the DOM and its hidden property is still false', JSON.stringify([open1.ordersDisplay, open1.ordersHiddenAttr]))
  is(open1.curCount === 1 && open1.curIsOurs, 'exactly one button is current, and it is ours', `${open1.curCount}`)
  is(open1.ordersMarked && open1.ordersCur === null && open1.ordersColor === open1.returnsColor && open1.ordersBg === open1.returnsBg && open1.ordersBorder === open1.returnsBorder, 'React\'s own current button is drawn like its inactive siblings (same colour, background, border and shadow)', JSON.stringify([open1.ordersColor, open1.returnsColor, open1.ordersBg, open1.returnsBg, open1.ordersBorder, open1.returnsBorder]))
  is(/bg-indigo-50/.test(open1.ourCls) && /text-indigo-600/.test(open1.ourCls), 'our button wears the current-tab classes the compiled nav uses')
  is(open1.url === '?tab=abandoned' && open1.len === before.len + 1, 'the address is ?tab=abandoned and one history entry was added', `${open1.url} ${open1.len}/${before.len}`)
  is(open1.focus === 'sab-title', 'focus moves to the heading')
  is(list(S).length === 1 && list(S)[0].query === 'r=abandoned_orders', 'opening requests the list once, with no filters (GET abandoned_orders)', JSON.stringify(list(S)))

  // a click on React's own nav: closes first, React does what it does
  await pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Returns\s*$/ }).click()
  await sleep(250)
  const closed = await pg.evaluate(() => {
    const cur = [...document.querySelectorAll('[aria-current="page"]')]
    const ours = document.querySelector('.admin-sidebar [data-sporta-ab-nav]')
    return { hidden: document.querySelector('[data-sporta-abandoned]').hidden, body: document.body.hasAttribute('data-sporta-ab'), style: document.body.getAttribute('style'), curText: cur.map((e) => e.textContent.trim()), ourCur: ours.getAttribute('aria-current'), ourCls: ours.className, url: location.search,
      marks: document.querySelectorAll('[data-sporta-ab-cur]').length, text: window.fx.strongTextNode().data, strongOk: window.fx.strongTextNode().parentNode === document.querySelector('.m-header__title > strong:not([data-sporta-ab-title])'),
      sections: [...document.querySelectorAll('main.admin-content > section.admin-page')].map((s) => !s.hidden && getComputedStyle(s).display !== 'none') }
  })
  is(closed.hidden && !closed.body && !closed.style, 'a click on Returns closes the panel before React acts; the body mark and the body style attribute are gone', JSON.stringify([closed.hidden, closed.body, closed.style]))
  is(closed.curText.join() === 'Returns' && closed.marks === 0 && closed.url === '?tab=returns', 'React then did its own work: Returns is the one current tab, no leftover marker, address ?tab=returns', JSON.stringify(closed))
  is(closed.ourCur === null && !/bg-indigo-50/.test(closed.ourCls), 'our button is no longer current and wears the inactive classes again')
  is(closed.sections.filter(Boolean).length === 1 && closed.sections[closed.sections.length - 1], 'exactly one compiled section is on screen (the new Returns one)', JSON.stringify(closed.sections))
  is(closed.text === 'Returns' && closed.strongOk, 'React\'s header text node is still its own and says Returns')

  // the tab React already shows: React ignores the click, the panel must still close and the address must not lie
  await pg.locator(NAV).click(); await waitRows(pg)
  await pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Returns\s*$/ }).click()
  await sleep(400)
  const same = await pg.evaluate(() => ({ hidden: document.querySelector('[data-sporta-abandoned]').hidden, url: location.search, cur: [...document.querySelectorAll('[aria-current="page"]')].map((e) => e.textContent.trim()).join(), ret: (() => { const sec = [...document.querySelectorAll('main.admin-content > section.admin-page')].find((x) => /Returns/.test(x.textContent)); return !!sec && !sec.hidden && getComputedStyle(sec).display !== 'none' })() }))
  is(same.hidden && same.cur === 'Returns' && same.ret && same.url === '?tab=returns', 'a click on the tab React already shows (it ignores it) still closes the panel and puts the address back', JSON.stringify(same))

  // Back / Forward
  await pg.locator(NAV).click(); await waitRows(pg)
  await pg.goBack(); await sleep(400)
  const back = await pg.evaluate(() => ({ hidden: document.querySelector('[data-sporta-abandoned]').hidden, url: location.search, cur: [...document.querySelectorAll('[aria-current="page"]')].map((e) => e.textContent.trim()).join() }))
  is(back.hidden && back.url.includes('tab=returns') && back.cur === 'Returns', 'Back closes the panel and shows the previous screen', JSON.stringify(back))
  await pg.goForward(); await sleep(500)
  is(!(await pg.evaluate(() => document.querySelector('[data-sporta-abandoned]').hidden)) && (await search(pg)) === '?tab=abandoned', 'Forward opens it again')
  await pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Orders\s*$/ }).click(); await sleep(300)

  // a rebuilt nav, a second evaluation of the file
  const posOf = () => pg.evaluate(() => { const k = [...document.querySelector('nav.admin-sidebar__nav').children]; const i = k.findIndex((b) => b.hasAttribute('data-sporta-ab-nav')); return [k.filter((b) => b.hasAttribute('data-sporta-ab-nav')).length, i > 0 ? k[i - 1].textContent.trim() : null] })
  await pg.evaluate(() => window.fx.rerenderNav()); await sleep(500)
  is(JSON.stringify(await posOf()) === '[1,"Orders"]', 'when React replaces its nav buttons ours stays, once, after Orders')
  await pg.evaluate(() => window.fx.rerenderNav(true)); await sleep(700)
  is(JSON.stringify(await posOf()) === '[1,"Orders"]', 'when the whole nav is rebuilt (ours gone with it) the entry is put back once, after Orders')
  await pg.evaluate(() => { const s = document.createElement('script'); s.src = '/sporta-admin-brands.js?again'; document.body.appendChild(s) }); await sleep(700)
  is((await count(pg, '[data-sporta-ab-nav]')) === 1 && (await count(pg, SEL)) === 1 && (await count(pg, 'style[data-sporta-ab-style]')) === 1, 'evaluated a second time the file makes no second entry, panel or style')

  // sign out while open: nothing of the customers stays in the page; sign back in: one entry, closed
  await pg.locator(NAV).click(); await waitRows(pg)
  const name = (await pg.locator(`${ROWS} .sab-name`).first().textContent()).trim()
  await pg.evaluate(() => window.fx.signOut()); await sleep(600)
  const gone = await pg.evaluate((nm) => ({ txt: document.body.textContent.includes(nm) || document.body.textContent.includes('9655550'), sec: document.querySelectorAll('[data-sporta-abandoned]').length, attr: document.body.hasAttribute('data-sporta-ab') }), name)
  is(!gone.txt && gone.sec === 0 && !gone.attr, 'after a sign-out no customer name or phone is left in the page, the panel is gone and the body mark with it', JSON.stringify(gone))
  await pg.evaluate(() => window.fx.signIn()); await sleep(900)
  const back2 = await pg.evaluate(() => ({ n: document.querySelectorAll('[data-sporta-ab-nav]').length, hidden: document.querySelector('[data-sporta-abandoned]').hidden, rows: document.querySelectorAll('[data-sporta-abandoned] tbody tr').length, attr: document.body.hasAttribute('data-sporta-ab') }))
  is(back2.n === 1 && back2.hidden && back2.rows === 0 && !back2.attr, 'after signing in again there is one entry, the panel is closed and holds no rows', JSON.stringify(back2))
  is(S.mock.calls.filter((c) => c.query.includes('from=2000-01-01')).length === 1, 'the probe was sent once for the whole visit, sign-out included')
  await S.close()
}
{
  // in the dark theme the compiled "current" look has a border and its own ink: React's button must still read as inactive
  const S = await open({ dark: true })
  await openPanel(S)
  await sleep(900)                                    // the compiled nav item eases its colours: measure when it has settled
  const d = await S.pg.evaluate(() => {
    const b = (t) => [...document.querySelectorAll('.admin-sidebar .admin-nav-item')].find((x) => x.textContent.trim() === t)
    const f = (e) => { const c = getComputedStyle(e); return [c.color, c.backgroundColor, c.borderTopWidth, c.borderTopColor, c.boxShadow].join(' | ') }
    return { orders: f(b('Orders')), returns: f(b('Returns')), ours: f(document.querySelector('[data-sporta-ab-nav]')), crm: f(b('CRM')) }
  })
  is(d.orders === d.returns && d.orders === d.crm && d.ours !== d.orders, 'dark theme: React\'s current button is drawn exactly like the inactive ones (colour, background, border, shadow) and ours is the one that stands out', JSON.stringify(d))
  await S.pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Returns\s*$/ }).click(); await sleep(300)
  is((await S.pg.evaluate(() => document.body.getAttribute('style') || '')) === '', 'and closing leaves no custom property behind on <body>')
  await S.close()
}
{
  // ?tab=abandoned opens by itself
  const S = await open({ path: '/backends?tab=abandoned' })
  await waitRows(S.pg)
  is(!(await S.pg.evaluate(() => document.querySelector('[data-sporta-abandoned]').hidden)) && (await q1(S.pg, `${SEL} h1`)) === 'Abandoned orders', 'a page loaded with ?tab=abandoned opens the panel')
  await S.pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Orders\s*$/ }).click(); await sleep(400)
  is((await search(S.pg)) === '' && !(await S.pg.evaluate(() => document.body.hasAttribute('data-sporta-ab'))), 'and clicking the tab React shows (Overview opened by the unknown tab, Orders is a change) leaves a clean address')
  await S.close()
}
{
  // React's DOM, with and without the block, after the same clicks
  const A = await open({ routePresent: true }), B = await open({ js: WITHOUT })
  await waitEntry(A); await sleep(400)
  const same = async (what) => { await sleep(350); const a = await reactDom(A.pg), b = await reactDom(B.pg); is(a === b && (await search(A.pg)) === (await search(B.pg)) && (await A.pg.evaluate(() => document.body.getAttribute('style') || '')) === '' && !(await A.pg.evaluate(() => document.body.hasAttribute('data-sporta-ab'))), `React's DOM, the address and <body> are identical with and without the block ${what}`, a === b ? '' : 'DOM differs') }
  await same('at load')
  await openPanel(A); await clickReact(A, 'Returns'); await clickReact(B, 'Returns'); await same('after: open, click Returns')
  await openPanel(A); await clickReact(A, 'Returns'); await clickReact(B, 'Returns'); await same('after: open, click the tab React already shows')
  await clickReact(A, 'Catalogue'); await clickReact(B, 'Catalogue'); await same('after: Catalogue')
  await openPanel(A); await clickReact(A, 'Orders'); await clickReact(B, 'Orders'); await same('after: open, click Orders')
  await openPanel(A); await A.pg.goBack(); await same('after: open, Back (the other page did nothing)')
  is(JSON.stringify(await A.pg.evaluate(() => window.fx.navs)) === JSON.stringify(await B.pg.evaluate(() => window.fx.navs)), 'React was asked for the same navigations in the same order')
  await A.close(); await B.close()
}
}

// ================================================================================================ 3. the phone
if (on(3)) {
head('3. the phone: menu tile, header title, tab bar')
{
  const S = await open({ w: 390 })
  await waitEntry(S)
  const pg = S.pg
  is(!(await visible(pg, '.admin-sidebar')) && (await visible(pg, '.m-tabbar')), 'at 390 the sidebar is hidden and the tab bar is shown (the captured shell)')
  is((await count(pg, TILE)) === 0, 'the menu tile exists only while the menu is open (it is React\'s menu)')
  await openPhoneMenu(S)
  const t = await pg.evaluate(() => { const kids = [...document.querySelector('.m-menu-grid').children], i = kids.findIndex((k) => k.hasAttribute('data-sporta-ab-nav')); const r = kids[i].getBoundingClientRect(); return { after: kids[i - 1].textContent.trim(), text: kids[i].textContent.trim(), h: r.height, w: r.width, n: document.querySelectorAll('.m-menu-grid [data-sporta-ab-nav]').length } })
  is(t.n === 1 && t.after === 'Orders' && t.text === 'Abandoned' && t.h >= 40, 'one tile right after Orders in the phone menu, tall enough to tap', JSON.stringify(t))
  await pg.locator(TILE).click(); await waitRows(pg)
  const p = await pg.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' }
    const strongs = [...document.querySelectorAll('.m-header__title > strong')]
    return { menu: document.querySelectorAll('.m-menu-layer').length, shown: strongs.filter(vis).map((s) => s.textContent), react: window.fx.strongTextNode().data, tabCur: document.querySelectorAll('.m-tabbar [aria-current="page"]').length, panel: !document.querySelector('[data-sporta-abandoned]').hidden, st: window.fx.state() }
  })
  is(p.menu === 0 && p.st.menuOpen === false && p.panel, 'the tile closes React\'s menu through its own close button and opens the panel', JSON.stringify(p))
  is(p.shown.join() === 'Abandoned orders' && p.react === 'Orders', 'the phone header shows our title; React\'s title node still holds its own text', JSON.stringify(p.shown))
  is(p.tabCur === 0, 'no tab-bar item claims to be current while the panel is open')
  // the "More" button opens the menu without closing the panel; the menu shows no React tile as current
  await pg.locator('.m-tabbar__item[aria-haspopup]').click(); await pg.waitForSelector('.m-menu-layer')
  const m2 = await pg.evaluate(() => ({ panel: !document.querySelector('[data-sporta-abandoned]').hidden, cur: [...document.querySelectorAll('.m-menu-grid [aria-current="page"]')].map((e) => e.textContent.trim()) }))
  is(m2.panel && m2.cur.join() === 'Abandoned', 'More opens the menu on top of the open panel, and only our tile is current there', JSON.stringify(m2))
  await pg.locator('.m-menu-item').filter({ hasText: /^\s*Catalogue\s*$/ }).click(); await sleep(400)
  const c = await pg.evaluate(() => ({ panel: document.querySelector('[data-sporta-abandoned]').hidden, title: [...document.querySelectorAll('.m-header__title > strong')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.textContent).join(), url: location.search }))
  is(c.panel && c.title === 'Catalogue' && c.url === '?tab=catalog', 'a React tile (Catalogue) closes the panel, React shows Catalogue and the header says so', JSON.stringify(c))
  await S.close()
}
}

// ================================================================================================ 4. the list
if (on(4)) {
head('4. the list: summary, rows, filters, paging, states')
{
  const S = await open({})
  const pg = S.pg
  await openPanel(S)
  const exp = expected(S, '')
  const sum = exp.summary
  const tiles = await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-abandoned] .sab-summary .sab-tile')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()))
  is(tiles[0].includes(`${sum.abandoned.count} orders`) && tiles[0].includes(kd(sum.abandoned.value)) && tiles[0].startsWith('Still lost'), 'tile "Still lost": count and KD from the summary', tiles[0])
  is(tiles[1].includes(`${sum.abandoned.recovered_count} orders`) && tiles[1].includes(kd(sum.abandoned.recovered_value)), 'tile "Recovered": count and KD', tiles[1])
  is(tiles[2].includes(sum.abandoned.recovery_rate.toFixed(1) + '%'), 'tile "Recovery rate": one decimal', tiles[2])
  const reasonOk = ['unpaid', 'expired', 'declined', 'cod_expired'].every((r, i) => {
    const t = tiles[3 + i], x = sum.by_reason[r]
    return t.includes(String(x.count)) && t.includes(kd(x.value)) && t.includes(`${x.recovered_count} recovered (${kd(x.recovered_value)})`)
  })
  is(reasonOk, 'one tile per reason with count, KD, and what was recovered', tiles.slice(3).join(' || '))
  const other = await q1(pg, `${SEL} .sab-other`)
  is(other.includes(`${sum.waiting.count} orders still waiting (${kd(sum.waiting.value)})`) && other.includes(`${sum.cancelled_by_shop.count} orders cancelled by the shop (${kd(sum.cancelled_by_shop.value)})`), 'the orders that are NOT counted as abandoned are named with their value', other)
  const rules = await q1(pg, `${SEL} .sab-summary`)
  is(/30 minutes/.test(rules) && /120 minutes/.test(rules) && /24 hours/.test(rules), 'the rules in force (30 minutes, 120 minutes, 24 hours) are stated from the settings')
  is((await count(pg, ROWS)) === 20 && /Showing 20 orders, more available\./.test(await q1(pg, `${SEL} .sab-status`)), 'the first page holds 20 rows and the status line says there are more')

  // a row, field by field (the newest order: the markup name)
  const first = exp.orders[0]
  const r0 = await pg.evaluate((id) => {
    const tr = document.querySelector(`[data-sporta-abandoned] tr[data-id="${id}"]`)
    const t = (s) => { const e = tr.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null }
    return { track: t('.sab-track'), amt: t('.sab-amt'), name: t('.sab-name'), nameDir: tr.querySelector('.sab-name').getAttribute('dir'), phone: t('.sab-phone'), cells: [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()), img: tr.querySelectorAll('img, script, iframe').length, items: [...tr.querySelectorAll('.sab-items li')].map((l) => l.textContent), itemDirs: [...tr.querySelectorAll('.sab-items li')].map((l) => l.getAttribute('dir')) }
  }, first.id)
  is(r0.track === first.track_id && r0.amt === kd(first.amount), 'row: track id and amount (3 decimals, KD)', JSON.stringify([r0.track, r0.amt]))
  is(r0.name === first.customer_name && r0.nameDir === 'auto' && r0.img === 0, 'row: a customer name that is markup shows as TEXT (no element made) and has dir="auto"', JSON.stringify(r0.name))
  is(await pg.evaluate(() => window.__xss === undefined), 'and nothing ran')
  is(r0.phone === '+965 5550 1044', 'row: a Kuwaiti number is shown as +965 xxxx xxxx', r0.phone)
  is(/Unpaid/.test(r0.cells[3]) && /Left the bank page without paying/.test(r0.cells[3]) && /Stock still held/.test(r0.cells[3]), 'row: the reason in words, with what it means, and the stock state', r0.cells[3])
  is(/04 Nov 2026, \d\d:\d\d/.test(r0.cells[0]) && /min ago|h/.test(r0.cells[0]), 'row: the date as DD Mon YYYY, HH:MM and the time since', r0.cells[0])
  is(r0.items.length === first.items.length && r0.items.every((l, i) => l.startsWith(`${first.items[i].qty} \u00d7 ${first.items[i].name_en}`)) && r0.itemDirs.every((d) => d === 'auto'), 'row: item lines "qty x name . size" with dir="auto"', JSON.stringify(r0.items))
  const big = expected(S, '').orders.find((o) => o.items_more > 0)
  const bigRow = await pg.evaluate((id) => [...document.querySelectorAll(`[data-sporta-abandoned] tr[data-id="${id}"] .sab-items li`)].map((l) => l.textContent), big.id)
  is(bigRow.length === 6 && bigRow[5] === `+${big.items_more} more`, 'row: 5 item lines and "+N more" when the server capped the list', JSON.stringify(bigRow.slice(-2)))
  const noItems = exp.orders.find((o) => o.item_count === 0)
  is(/No item lines on this order/.test(await q1(pg, `${ROWS}[data-id="${noItems.id}"] td[data-label="Items"]`)), 'row: an order with no lines says so')
  const rec = expected(S, 'include_recovered=1').orders.find((o) => o.recovered)
  const manual = S.mock.orders.find((o) => o.followup && o.followup.state === 'recovered_manually')
  is(!!rec && !!manual, 'the dataset has a row recovered by a later order and one recovered by hand (so the checks that follow mean something)')

  // filters
  const calls0 = list(S).length
  await pg.locator(`${SEL} select`).selectOption('declined')
  await pg.waitForFunction(() => { const rs = [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')]; return rs.length > 0 && rs.every((r) => r.getAttribute('data-reason') === 'declined') })
  is(list(S).length === calls0 + 1 && list(S).pop().query === 'r=abandoned_orders&reason=declined', 'choosing a reason requests reason=declined once', list(S).pop().query)
  is((await pg.locator(`${SEL} .sab-tile--btn[data-reason="declined"]`).getAttribute('aria-pressed')) === 'true', 'and the matching tile shows as pressed')
  await pg.locator(`${SEL} .sab-tile--btn[data-reason="expired"]`).click()
  await pg.waitForFunction(() => { const rs = [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')]; return rs.length > 0 && rs.every((r) => r.getAttribute('data-reason') === 'expired') })
  is((await pg.locator(`${SEL} select`).inputValue()) === 'expired', 'a tile applies its reason and the select follows')
  await pg.locator(`${SEL} .sab-tile--btn[data-reason="expired"]`).click()
  await pg.waitForFunction(() => new Set([...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((r) => r.getAttribute('data-reason'))).size > 1)
  is((await pg.locator(`${SEL} select`).inputValue()) === 'all', 'pressing the tile again goes back to all')
  await pg.locator(`${SEL} select`).selectOption('waiting')
  await pg.waitForFunction(() => { const rs = [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')]; return rs.length > 0 && rs.every((r) => r.getAttribute('data-reason') === 'waiting') })
  const w = await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((r) => ({ wa: r.querySelectorAll('a').length, txt: r.children[1].textContent })))
  is(w.length > 0 && w.every((r) => r.wa === 0 && /may still be paying/.test(r.txt)), 'an order still waiting shows NO WhatsApp or Call button, and says why', JSON.stringify(w[0]))
  await pg.locator(`${SEL} select`).selectOption('all'); await waitRows(pg)

  const dateInputs = pg.locator(`${SEL} input[type=date]`)
  let n = list(S).length
  await dateInputs.nth(0).fill('2026-11-03'); await pg.waitForFunction((n) => true, n); await sleep(300)
  is(list(S).length === n + 1 && list(S).pop().query.includes('from=2026-11-03'), 'a From date requests from=', list(S).pop().query)
  n = list(S).length
  await dateInputs.nth(1).fill('2026-11-01'); await sleep(400)
  is(list(S).length === n && /From.*after.*To/.test(await q1(pg, `${SEL} .sab-list`)), 'From after To is refused on the page with a message and NO request', await q1(pg, `${SEL} .sab-list`))
  await dateInputs.nth(1).fill('2026-11-04'); await waitRows(pg)
  is(list(S).pop().query.includes('from=2026-11-03') && list(S).pop().query.includes('to=2026-11-04'), 'a valid pair requests both dates')
  await pg.locator(`${SEL} button`).filter({ hasText: /^Clear filters$/ }).click(); await waitRows(pg)
  is(list(S).pop().query === 'r=abandoned_orders' && (await dateInputs.nth(0).inputValue()) === '' && !(await visible(pg, `${SEL} button.sab-btn--quiet`)), 'Clear filters empties the controls, requests the default list and hides itself')

  n = list(S).length
  await pg.locator(`${SEL} input[type=search]`).click()
  await pg.keyboard.type('Dana', { delay: 40 })
  await sleep(200)
  is(list(S).length === n, 'typing does not request on every key (debounced)')
  await pg.waitForFunction((n) => true, n); await sleep(900)
  is(list(S).length === n + 1 && list(S).pop().query.includes('q=Dana'), 'a single request with q=Dana follows the pause', list(S).slice(n).map((c) => c.query).join(' | '))
  await pg.waitForFunction(() => { const rs = [...document.querySelectorAll('[data-sporta-abandoned] .sab-name')]; return rs.length > 0 && rs.every((r) => /dana/i.test(r.textContent)) })
  n = list(S).length
  await pg.locator(`${SEL} input[type=search]`).fill(''); await pg.keyboard.type('5550 1043'); await pg.keyboard.press('Enter')
  await sleep(150)
  is(list(S).length === n + 1 && list(S).pop().query.includes('q=5550+1043'), 'Enter requests at once (a phone typed with a space)', list(S).pop().query)
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length === 1)
  await pg.locator(`${SEL} input[type=search]`).fill(''); await pg.keyboard.press('Enter'); await waitRows(pg, 20)
  n = list(S).length
  await pg.locator(`${SEL} input[type=checkbox]`).first().check()
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] .sab-chip--ok').length > 0)
  is(list(S).pop().query.includes('include_recovered=1'), '"Show recovered orders" requests include_recovered=1 and the recovered rows appear with their mark', list(S).pop().query)
  await pg.locator(`${SEL} input[type=checkbox]`).first().uncheck()
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody .sab-chip--ok').length === 0)

  // a stale answer never replaces a newer one
  S.rules.push({ match: (i) => i.query.get('reason') === 'unpaid', delay: 1800 })
  await pg.locator(`${SEL} select`).selectOption('unpaid')
  await sleep(150)
  await pg.locator(`${SEL} select`).selectOption('declined')
  await pg.waitForFunction(() => { const rs = [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')]; return rs.length > 0 && rs.every((r) => r.getAttribute('data-reason') === 'declined') })
  await sleep(2300)
  const reasons = await pg.evaluate(() => [...new Set([...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((r) => r.getAttribute('data-reason')))])
  is(reasons.join() === 'declined', 'a slow answer for an OLDER filter does not replace the newer rows', reasons.join())
  await pg.locator(`${SEL} select`).selectOption('all'); await waitRows(pg, 20)

  // Load more
  await pg.locator(`${SEL} .sab-more button`).waitFor({ state: 'visible' })
  S.hold = { method: 'GET', route: 'abandoned_orders', promise: null }
  const gate = deferred(); S.hold.promise = gate.promise
  const before = list(S).length
  await pg.locator(`${SEL} .sab-more button`).dblclick()
  await sleep(300)
  is(S.hold.seen === 1 && (await pg.locator(`${SEL} .sab-more button`).isDisabled()) && /Loading/.test(await q1(pg, `${SEL} .sab-more button`)), 'a double click on Load more sends ONE request; the button is disabled while it loads', `${S.hold.seen}`)
  gate.resolve(); S.hold = null
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length > 20)
  const all = await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((r) => r.getAttribute('data-id')))
  is(list(S).pop().query === 'r=abandoned_orders&page=2' && new Set(all).size === all.length && all.length === expected(S, '').summary.abandoned.count, 'the second page is appended (page=2), every order once, in the server\'s order', `${all.length}`)
  is(!(await visible(pg, `${SEL} .sab-more button`)), 'Load more disappears when the server says there is no more')
  is((await q1(pg, `${SEL} .sab-status`)) === `Showing ${all.length} orders.`, 'the status line counts what is on screen')

  // a page that overlaps the previous one (an order arrived meanwhile)
  await pg.locator(`${SEL} button`).filter({ hasText: /^Refresh$/ }).click()
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length === 20 || document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length > 20)
  await pg.locator(`${SEL} select`).selectOption('declined'); await pg.locator(`${SEL} select`).selectOption('all'); await waitRows(pg, 20)
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length === 20)
  const top = expected(S, '')
  S.rules.push({ match: (i) => i.query.get('page') === '2', transform: (b) => ({ ...b, orders: [top.orders[19], ...b.orders] }) })
  await pg.locator(`${SEL} .sab-more button`).click()
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length > 20)
  const ids = await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((r) => r.getAttribute('data-id')))
  is(new Set(ids).size === ids.length && ids.length === top.summary.abandoned.count, 'when page 2 repeats the last row of page 1 that row is not shown twice', `${ids.length}`)
  await pg.locator(`${SEL} select`).selectOption('declined'); await pg.locator(`${SEL} select`).selectOption('all'); await waitRows(pg, 20)

  // states
  S.rules.push({ match: (i) => i.query.get('q') === 'zzzz' })
  await pg.locator(`${SEL} input[type=search]`).fill('zzzz'); await pg.keyboard.press('Enter')
  await waitText(pg, `${SEL} .sab-list`, /No orders match these filters/)
  is(true, 'empty: "No orders match these filters" with a way out')
  const noFilter = await pg.evaluate(() => 0)
  await pg.locator(`${SEL} button`).filter({ hasText: /^Clear filters$/ }).click(); await waitRows(pg, 20)

  S.rules.push({ match: (i) => i.query.get('reason') === 'declined', delay: 1500 })
  await pg.locator(`${SEL} select`).selectOption('declined')
  await waitText(pg, `${SEL} .sab-list`, /Loading/)
  is((await pg.locator(SEL).getAttribute('aria-busy')) === 'true', 'slow: "Loading..." shows and the panel says it is busy')
  await waitRows(pg)
  S.rules.push({ match: (i) => i.query.get('reason') === 'expired', status: 500, body: { error: 'failed' } })
  await pg.locator(`${SEL} select`).selectOption('expired')
  await waitText(pg, `${SEL} .sab-list`, /could not do that \(failed\)/)
  is((await pg.locator(`${SEL} .sab-box--error`).getAttribute('role')) === 'alert' && (await visible(pg, `${SEL} .sab-box button`)), '500: a message (role=alert) and a Try again button')
  await pg.locator(`${SEL} .sab-box button`).click(); await waitRows(pg)
  is((await count(pg, ROWS)) > 0 && (await count(pg, `${SEL} .sab-box--error`)) === 0, 'Try again loads the list and the error goes')

  S.rules.push({ match: (i) => i.query.get('reason') === 'cod_expired', status: 429, headers: { 'Retry-After': '2' }, body: { error: 'too_many_attempts', retry_after: 2 } })
  await pg.locator(`${SEL} select`).selectOption('cod_expired')
  await waitText(pg, `${SEL} .sab-list`, /Too many requests/)
  const rl = await q1(pg, `${SEL} .sab-list`)
  is(/Wait \d seconds?/.test(rl) && (await pg.locator(`${SEL} .sab-box button`).isDisabled()), '429: says how long to wait; Try again is disabled meanwhile', rl)
  await waitText(pg, `${SEL} .sab-list`, /try again now/)
  is(!(await pg.locator(`${SEL} .sab-box button`).isDisabled()), '429: the countdown ends and Try again is enabled')
  await pg.locator(`${SEL} .sab-box button`).click(); await waitRows(pg)

  S.rules.push({ match: (i) => i.query.get('reason') === 'declined', status: 503, body: { error: 'no_table' } })
  await pg.locator(`${SEL} select`).selectOption('declined')
  await waitText(pg, `${SEL} .sab-list`, /table has not been created/)
  is(true, '503 no_table: "the follow-up table has not been created on the server yet"')
  S.rules.push({ match: (i) => i.query.get('reason') === 'unpaid', status: 401, body: { error: 'not_signed_in' } })
  await pg.locator(`${SEL} select`).selectOption('unpaid')
  await waitText(pg, `${SEL} .sab-list`, /sign-in has ended/)
  is(true, '401: "Your sign-in has ended"')
  S.rules.push({ match: (i) => i.query.get('reason') === 'expired', abort: true })
  await pg.locator(`${SEL} select`).selectOption('expired')
  await waitText(pg, `${SEL} .sab-list`, /Could not reach the server/)
  is(true, 'no network: "Could not reach the server"')
  S.mock.routePresent = false
  await pg.locator(`${SEL} select`).selectOption('declined')
  await waitText(pg, `${SEL} .sab-list`, /not available until the next update/)
  is(!(await visible(pg, `${SEL} .sab-box button`)), 'the route disappears while the panel is open (404): "not available until the next update", no Try again')
  await S.close()
}
}

// ================================================================================================ 5. CSV
if (on(5)) {
head('5. CSV export')
{
  const S = await open({})
  const pg = S.pg
  await openPanel(S)
  await loadAllRows(S)
  const shown = await count(pg, ROWS)
  const { bytes, name } = await downloadCsv(S)
  is(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'the file starts with the UTF-8 byte order mark (EF BB BF)', [...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' '))
  is(/^abandoned-orders-\d{4}-\d{2}-\d{2}\.csv$/.test(name), 'file name abandoned-orders-YYYY-MM-DD.csv', name)
  const text = bytes.slice(3).toString('utf8')
  is(!text.includes('\ufffd') && text.includes('\r\n') && text.endsWith('\r\n'), 'CRLF line ends, valid UTF-8 (no replacement characters)')
  const rows = parseCsv(text)
  const header = rows[0]
  is(rows.length === shown + 1 && header[0] === 'Track ID' && header.includes('Follow-up note') && header.length === 21 && rows.every((r) => r.length === 21), `one header + ${shown} rows, 21 columns in every row`, `${rows.length} rows, ${rows.map((r) => r.length).filter((l) => l !== 21).length} ragged`)
  is(text.split('\r\n').slice(0, 2).every((l) => l.startsWith('"') && l.endsWith('"')), 'every cell is quoted')
  const col = (n) => header.indexOf(n)
  const byTrack = (t) => rows.find((r) => r[col('Track ID')] === t)
  const all = expected(S, '').orders
  const ex = all.concat(expected(S, 'page=2').orders)
  const formula = ex.find((o) => o.customer_name.startsWith('=HYP')), plus = ex.find((o) => o.customer_name.startsWith('+965')), at = ex.find((o) => o.customer_name.startsWith('@')), dash = ex.find((o) => o.customer_name.startsWith('-5')), quote = ex.find((o) => o.customer_name.includes('"Mimi"'))
  is(byTrack(formula.track_id)[col('Customer')] === "'" + formula.customer_name, 'a name that starts with = is written with a leading \' (a spreadsheet never runs it)', byTrack(formula.track_id)[col('Customer')])
  is([plus, at, dash].every((o) => byTrack(o.track_id)[col('Customer')] === "'" + o.customer_name), 'so are names that start with +, @ and -')
  is(byTrack(quote.track_id)[col('Customer')] === quote.customer_name, 'quotes and commas inside a cell survive (quotes doubled)', byTrack(quote.track_id)[col('Customer')])
  const arabic = ex.find((o) => /[\u0600-\u06ff]/.test(o.customer_name))
  is(byTrack(arabic.track_id)[col('Customer')] === arabic.customer_name && /[\u0600-\u06ff]/.test(byTrack(arabic.track_id)[col('Items')] + byTrack(arabic.track_id)[col('Area')] + byTrack(arabic.track_id)[col('Customer')]), 'Arabic names come out intact', arabic.customer_name)
  const f = byTrack(all[0].track_id)
  is(f[col('Amount (KD)')] === all[0].amount.toFixed(3) && f[col('Reason')] === 'Unpaid' && f[col('Payment method')] === 'KNET' && f[col('Language')] === (all[0].customer_lang || ''), 'amount with 3 decimals, reason in words, method name, language', JSON.stringify(f.slice(0, 8)))
  const withNote = ex.find((o) => o.followup && o.followup.note)
  is(byTrack(withNote.track_id)[col('Follow-up note')] === withNote.followup.note && byTrack(withNote.track_id)[col('Follow-up')] === 'Contacted' && byTrack(withNote.track_id)[col('Follow-up by')] === ME, 'the follow-up state, note and who are in the file')
  is(rows.slice(1).every((r) => r.every((c) => !/^[=+\-@\t\r\n]/.test(c) || false)), 'no cell in the file starts with = + - @ (everything that did is prefixed)', rows.slice(1).flat().filter((c) => /^[=+\-@]/.test(c)).slice(0, 3).join(' | '))
  is((await q1(pg, `${SEL} .sab-status`)) === `Exported ${shown} orders.`, 'the status line says what was exported')
  // only what is on screen
  await pg.locator(`${SEL} select`).selectOption('declined'); await waitRows(pg)
  const n2 = await count(pg, ROWS)
  const d2 = parseCsv((await downloadCsv(S)).bytes.slice(3).toString('utf8'))
  is(d2.length === n2 + 1 && d2.slice(1).every((r) => r[d2[0].indexOf('Reason')] === 'Declined'), 'the file holds the rows on screen (filtered), nothing else')
  await pg.locator(`${SEL} select`).selectOption('all'); await waitRows(pg, 20)
  is(/Export CSV \(20\)/.test(await q1(pg, `${SEL} .sab-tools`)), 'the button counts the rows it will export')
  await pg.locator(`${SEL} .sab-tools button`).filter({ hasText: /^Export CSV/ }).click().catch(() => {})
  await S.close()
}
}

// ================================================================================================ 6. WhatsApp and Call
if (on(6)) {
head('6. WhatsApp and Call')
{
  const S = await open({})
  const pg = S.pg
  await openPanel(S)
  await loadAllRows(S)
  const ex = expected(S, '').orders.concat(expected(S, 'page=2').orders)
  const msgAr = 'مرحبًا {name}، معكم سبورتا. لاحظنا أن طلبكم رقم {order} لم يكتمل. إن احتجتم أي مساعدة في إتمامه فنحن بخدمتكم.'
  const msgEn = 'Hello {name}, this is Sporta. We noticed your order {order} was not completed. If you need any help finishing it, we are happy to help.'
  const fill = (t, o) => t.replace('{name}', o.customer_name).replace('{order}', o.track_id)
  const links = (id) => pg.evaluate((id) => { const tr = document.querySelector(`[data-sporta-abandoned] tr[data-id="${id}"]`); return [...tr.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), aria: a.getAttribute('aria-label'), h: a.getBoundingClientRect().height })) }, id)
  const ar = ex.find((o) => o.customer_lang === 'ar' && o.whatsapp_phone), en = ex.find((o) => o.customer_lang === 'en' && o.whatsapp_phone), unk = ex.find((o) => o.customer_lang === null && o.whatsapp_phone)
  const la = await links(ar.id)
  is(la[0].text === 'WhatsApp' && la[0].href === `https://wa.me/${ar.whatsapp_phone}?text=${encodeURIComponent(fill(msgAr, ar))}`, 'an Arabic-speaking customer: https://wa.me/<phone>?text=<the Arabic wording, {name} and {order} filled, URL-encoded>', la[0].href)
  is(la[0].target === '_blank' && la[0].rel === 'noopener noreferrer' && la[0].h >= 40, 'it opens in a new tab with rel="noopener noreferrer", and is tall enough to tap')
  is(la[1].text === 'Call' && la[1].href === `tel:+${ar.customer_phone}` && la[1].target === null, 'Call is tel:+965..., no new tab', la[1].href)
  const le = await links(en.id)
  is(le[0].href === `https://wa.me/${en.whatsapp_phone}?text=${encodeURIComponent(fill(msgEn, en))}`, 'an English-speaking customer gets the English wording')
  const lu = await links(unk.id)
  is(lu[0].href === `https://wa.me/${unk.whatsapp_phone}?text=${encodeURIComponent(fill(msgAr, unk))}`, 'a customer whose language is unknown gets Arabic (the site\'s default)')
  const hist = ex.find((o) => o.whatsapp_phone === null)
  const lh = await links(hist.id)
  is(lh.length === 1 && lh[0].text === 'Call' && lh[0].href === 'tel:+9655522 2759'.replace(' ', '') , 'a phone that is not a Kuwaiti mobile (+965 5522-2759 as stored) has Call but no WhatsApp', JSON.stringify(lh))
  const hostile = ex.find((o) => o.customer_name.startsWith('<img'))
  const lx = await links(hostile.id)
  is(decodeURIComponent(lx[0].href.split('?text=')[1]).includes('<img src=x onerror="window.__xss=1">') && !lx[0].href.includes('<'), 'a hostile name is only ever URL-encoded text inside the link')
  is(await pg.evaluate(() => window.__xss === undefined && document.querySelector('[data-sporta-abandoned] img') === null), 'and still nothing ran, no element was made')

  // the wording is editable, kept in the browser only, can be turned off, and reset
  is((await pg.evaluate(() => window.__writes.filter((w) => w.startsWith('local')))).length === 0, 'before the owner touches the wording NOTHING is written to web storage')
  await pg.locator(`${SEL} details.sab-msg > summary`).click()
  await pg.locator(`${SEL} textarea`).nth(1).fill('Hi {name}, order {order}: can we help?')
  const le2 = await links(en.id)
  is(le2[0].href === `https://wa.me/${en.whatsapp_phone}?text=${encodeURIComponent(`Hi ${en.customer_name}, order ${en.track_id}: can we help?`)}`, 'editing the English wording changes every English link at once')
  is((await pg.evaluate(() => JSON.parse(localStorage.getItem('sporta_ab_msg')))).en === 'Hi {name}, order {order}: can we help?' && (await pg.evaluate(() => window.__writes.every((w) => w === 'local:setItem:sporta_ab_msg'))), 'it is kept in localStorage "sporta_ab_msg" and nothing else is written')
  await pg.locator(`${SEL} .sab-msg input[type=checkbox]`).uncheck()
  is((await links(ar.id))[0].href === `https://wa.me/${ar.whatsapp_phone}` && /empty chat/.test(await q1(pg, `${SEL} .sab-wahint, ${SEL} .sab-wrap > p.sab-sub`)), 'with the message turned off the link is just https://wa.me/<phone> and the page says the chat opens empty')
  await pg.reload(); await openPanel(S)
  await pg.locator(`${SEL} details.sab-msg > summary`).click()
  is((await pg.locator(`${SEL} textarea`).nth(1).inputValue()) === 'Hi {name}, order {order}: can we help?' && !(await pg.locator(`${SEL} .sab-msg input[type=checkbox]`).isChecked()), 'after a reload the wording and the switch are what the owner left')
  await pg.locator(`${SEL} .sab-msg button`).click()
  is((await pg.locator(`${SEL} textarea`).nth(0).inputValue()) === msgAr && (await pg.locator(`${SEL} textarea`).nth(1).inputValue()) === msgEn && (await pg.locator(`${SEL} .sab-msg input[type=checkbox]`).isChecked()), 'Reset restores the suggested Arabic and English wording and turns the message back on')
  is((await pg.locator(`${SEL} textarea`).nth(0).getAttribute('dir')) === 'rtl' && (await pg.locator(`${SEL} textarea`).nth(1).getAttribute('dir')) === 'ltr', 'the Arabic box is right-to-left, the English box left-to-right')
  // a broken localStorage does not break the panel
  const B = await open({})
  await B.pg.addInitScript(() => { Storage.prototype.getItem = function () { throw new Error('blocked') }; Storage.prototype.setItem = function () { throw new Error('blocked') } })
  await B.pg.reload(); await openPanel(B)
  is((await count(B.pg, ROWS)) > 0 && B.errors.length === 0, 'with web storage blocked (private window) the panel still works with the suggested wording', B.errors.join(' | '))
  await B.close(); await S.close()
}
}

const contrastOf = (pg) => pg.evaluate((sel) => {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
  const g = cv.getContext('2d', { willReadFrequently: true })
  const num = (str) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = str; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const mix = (top, bottom) => { const a = top[3]; return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1] }
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const bgOf = (e) => { const layers = []; for (let x = e; x; x = x.parentElement) { const c = num(getComputedStyle(x).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break } let col = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) col = mix(layers[i], col); return col }
  const out = []
  for (const e of document.querySelector(sel).querySelectorAll('*')) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getBoundingClientRect().width || e.closest('[hidden]')) continue
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
    const field = (e.tagName === 'INPUT' && /^(search|text|date)$/.test(e.type)) || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT'
    if (!own && !field) continue
    const bg = bgOf(e), fg = mix(num(cs.color), bg)
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    const ratio = (a + 0.05) / (b + 0.05), px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
    out.push({ ratio, need: px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5, what: `${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/)[0]} "${(own || e.placeholder || e.value || '').slice(0, 24)}" ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)})` })
  }
  return out
}, SEL)
const layoutOf = (pg) => pg.evaluate((sel) => {
  const panel = document.querySelector(sel), table = panel.querySelector('table'), thead = panel.querySelector('thead')
  const taps = [...panel.querySelectorAll('button, a, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary')].filter((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && !e.closest('[hidden]') && !e.disabled })
    .map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, what: e.tagName.toLowerCase() + '.' + String(e.className).split(/\s+/)[0] + ' "' + (e.textContent || e.placeholder || '').trim().slice(0, 18) + '"' } })
  const checks = [...panel.querySelectorAll('input[type=checkbox]')].map((e) => e.closest('label').getBoundingClientRect().height)
  const tr = panel.querySelector('tbody tr'), tds = [...tr.children].map((c) => c.getBoundingClientRect())
  const se = document.scrollingElement
  const pr = panel.getBoundingClientRect()
  return { vw: innerWidth, docW: se.scrollWidth, bodyW: document.body.scrollWidth, panelW: pr.width, panelScroll: panel.scrollWidth - panel.clientWidth, tableDisplay: getComputedStyle(table).display, theadShown: thead.getBoundingClientRect().height > 0,
    stacked: tds.every((r, i) => i === 0 || r.top >= tds[i - 1].top + 4), side: tds.some((r, i) => i > 0 && Math.abs(r.top - tds[0].top) < 4), taps, checks, bg: getComputedStyle(panel).backgroundColor, color: getComputedStyle(panel).color, right: pr.right }
}, SEL)
const lumv = (s) => { const v = s.match(/[\d.]+/g).slice(0, 3).map(Number); return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255 }

// ================================================================================================ 7. follow-up
if (on(7)) {
head('7. follow-up: state, note, optimistic update, rollback')
{
  const S = await open({})
  const pg = S.pg
  await openPanel(S)
  const ex = expected(S, '').orders
  const plain = ex.find((o) => !o.followup && !o.recovered)
  const withF = ex.find((o) => o.followup && o.followup.state === 'contacted')
  const row = (id) => rowOf(pg, id)
  const stateBtn = (id, label) => row(id).locator('.sab-state').filter({ hasText: new RegExp(`^${label}$`) })
  const pressed = (id) => pg.evaluate((id) => [...document.querySelectorAll(`[data-sporta-abandoned] tr[data-id="${id}"] .sab-state[aria-pressed="true"]`)].map((b) => b.textContent), id)
  is((await pressed(withF.id)).join() === 'Contacted' && (await row(withF.id).locator('.sab-note').inputValue()) === withF.followup.note && /Marked by owner@sporta.test, 04 Nov 2026, 06:50/.test(await row(withF.id).locator('td').nth(4).textContent()), 'a row that has a follow-up shows its state, its note and who / when')
  is((await row(plain.id).locator('.sab-note').isDisabled()) && (await row(plain.id).locator('.sab-btn--small').filter({ hasText: 'Update note' }).isDisabled()) && !(await visible(pg, `${ROWS}[data-id="${plain.id}"] .sab-btn--quiet`)), 'a row with no follow-up: the note is locked until a status is picked, no Clear button')

  // shown at once; the request is the contract's
  const gate = deferred()
  S.hold = { method: 'POST', route: 'abandoned_followup', promise: gate.promise }
  await stateBtn(plain.id, 'Contacted').click()
  await sleep(250)
  const mid = await pg.evaluate((id) => { const tr = document.querySelector(`[data-sporta-abandoned] tr[data-id="${id}"]`); return { busy: tr.getAttribute('aria-busy'), pressed: [...tr.querySelectorAll('.sab-state[aria-pressed="true"]')].map((b) => b.textContent), disabled: [...tr.querySelectorAll('.sab-state')].every((b) => b.disabled), who: tr.querySelector('td:last-child .sab-sub').textContent } }, plain.id)
  is(mid.pressed.join() === 'Contacted' && mid.busy === 'true' && mid.disabled && mid.who === 'Saving...', 'the new state shows BEFORE the answer arrives, the row is busy and its buttons are locked', JSON.stringify(mid))
  await stateBtn(plain.id, 'Wrong number').click({ force: true }).catch(() => {})
  await sleep(150)
  is(posts(S).length === 1, 'a second tap while the first is in flight sends nothing')
  is(JSON.stringify(JSON.parse(posts(S)[0].body)) === JSON.stringify({ order_id: plain.id, state: 'contacted', note: '' }), 'the request body is {order_id, state, note}', posts(S)[0].body)
  const f = S.pg.evaluate(() => window.__fetches.filter((x) => x.url.includes('abandoned_followup')).map((x) => [x.method, x.credentials, JSON.stringify(x.headers)]))
  is((await f).every((x) => x[0] === 'POST' && x[1] === 'same-origin' && /X-Sporta-Admin/.test(x[2]) && /application\/json/.test(x[2])), 'it is a POST with same-origin credentials, X-Sporta-Admin and a JSON content type')
  gate.resolve(); S.hold = null
  await waitText(pg, `${ROWS}[data-id="${plain.id}"] .sab-rowmsg`, /Saved\./)
  is(/Marked by owner@sporta.test, 04 Nov 2026, 07:02/.test(await row(plain.id).locator('td').nth(4).textContent()) && !(await row(plain.id).locator('.sab-note').isDisabled()), 'success: "Saved.", who and when from the server, the note is open')
  // note on its own button
  await row(plain.id).locator('.sab-note').fill('will pay tomorrow')
  const upd = row(plain.id).locator('.sab-btn--small').filter({ hasText: 'Update note' })
  is(!(await upd.isDisabled()), 'typing a different note enables Update note')
  await upd.click()
  await waitText(pg, `${ROWS}[data-id="${plain.id}"] .sab-rowmsg`, /Saved\./)
  is(JSON.parse(posts(S)[1].body).note === 'will pay tomorrow' && JSON.parse(posts(S)[1].body).state === 'contacted' && (await upd.isDisabled()), 'Update note sends the state with the new note, then locks again (nothing changed)')
  await row(plain.id).locator('.sab-note').fill('line one\nline two')
  await row(plain.id).locator('.sab-note').press('Enter')
  await sleep(300)
  is(posts(S).length === 3 && JSON.parse(posts(S)[2].body).note === 'line one line two', 'Enter in the note sends it (control characters become spaces, as on the server)')
  const longNote = 'x'.repeat(300)
  await row(plain.id).locator('.sab-note').fill(longNote)
  is((await row(plain.id).locator('.sab-note').inputValue()).length === 280, 'the note field holds at most 280 characters')
  await row(plain.id).locator('.sab-note').fill('')
  // a different state keeps the typed note
  await row(plain.id).locator('.sab-note').fill('left a voicemail')
  await stateBtn(plain.id, 'Not interested').click()
  await waitText(pg, `${ROWS}[data-id="${plain.id}"] .sab-rowmsg`, /Saved\./)
  is((await pressed(plain.id)).join() === 'Not interested' && JSON.parse(posts(S)[3].body).note === 'left a voicemail', 'choosing another state sends it with the note being typed')
  // Clear
  await row(plain.id).locator('.sab-btn--quiet').click()
  await waitText(pg, `${ROWS}[data-id="${plain.id}"] .sab-rowmsg`, /cleared/)
  is(JSON.parse(posts(S)[4].body).state === 'none' && (await pressed(plain.id)).length === 0 && (await row(plain.id).locator('.sab-note').inputValue()) === '' && (await row(plain.id).locator('.sab-note').isDisabled()), 'Clear sends state "none"; the row is back to no follow-up, note emptied and locked')
  is(S.mock.orders.find((o) => o.id === plain.id).followup === null, 'and the server\'s row is gone')

  // failures roll everything back
  const failures = [
    ['500', { status: 500, body: { error: 'failed' } }, /could not do that \(failed\)/],
    ['409 not_abandoned', { status: 409, body: { error: 'not_abandoned' } }, /no longer on the list/],
    ['429', { status: 429, headers: { 'Retry-After': '5' }, body: { error: 'too_many_attempts', retry_after: 5 } }, /Too many requests\. Wait 5 seconds/],
    ['no network', { abort: true }, /Could not reach the server/],
    ['404', { status: 404, body: { error: 'not_found' } }, /could not be found/],
  ]
  for (const [label, rule, re] of failures) {
    S.rules.push({ match: (i) => i.method === 'POST', ...rule })
    const target = withF
    const prevPressed = await pressed(target.id), prevNote = await row(target.id).locator('.sab-note').inputValue()
    await stateBtn(target.id, 'Wrong number').click()
    await waitText(pg, `${ROWS}[data-id="${target.id}"] .sab-rowmsg`, /Not saved/)
    const msg = await q1(pg, `${ROWS}[data-id="${target.id}"] .sab-rowmsg`)
    const after = await pressed(target.id), noteAfter = await row(target.id).locator('.sab-note').inputValue()
    is(re.test(msg) && /Nothing was changed/.test(msg) && after.join() === prevPressed.join() && noteAfter === prevNote && !(await stateBtn(target.id, 'Wrong number').isDisabled()), `${label}: the old state and note are put back, the message says why and that nothing changed, the buttons are free again`, msg + ' | ' + after.join())
    is((await row(target.id).locator('.sab-rowmsg').getAttribute('data-bad')) === '1', `${label}: the message is marked as a problem`)
  }
  is(S.mock.orders.find((o) => o.id === withF.id).followup.state === 'contacted', 'and the server\'s row never changed')

  // recovered by hand: marked at once, counts refreshed, rolled back on a failure
  const plain2 = ex.filter((o) => !o.followup && !o.recovered)[1]
  const sumCalls = list(S).length
  await stateBtn(plain2.id, 'Recovered by me').click()
  await waitText(pg, `${ROWS}[data-id="${plain2.id}"] .sab-rowmsg`, /Saved\./)
  is(/Recovered: marked by you/.test(await row(plain2.id).locator('td').nth(3).textContent()), 'recovered by hand: the row shows "Recovered: marked by you"')
  await sleep(500)
  is(list(S).length === sumCalls + 1 && list(S).pop().query === 'r=abandoned_orders', 'and the counts are read again (one more list request, page 1 only)')
  const tile = await q1(pg, `${SEL} .sab-summary .sab-tile`)
  is(tile.includes(`${expected(S, '').summary.abandoned.count} orders`), 'the "Still lost" tile now shows the new count', tile)
  S.rules.push({ match: (i) => i.method === 'POST', status: 500, body: { error: 'failed' } })
  await stateBtn(plain2.id, 'Contacted').click()
  await waitText(pg, `${ROWS}[data-id="${plain2.id}"] .sab-rowmsg`, /Not saved/)
  is((await pressed(plain2.id)).join() === 'Recovered by me' && /Recovered: marked by you/.test(await row(plain2.id).locator('td').nth(3).textContent()), 'a failed change away from "recovered" leaves it recovered (rolled back)')
  const plain3 = ex.filter((o) => !o.followup && !o.recovered)[2]
  S.rules.push({ match: (i) => i.method === 'POST', status: 500, body: { error: 'failed' } })
  await stateBtn(plain3.id, 'Recovered by me').click()
  await waitText(pg, `${ROWS}[data-id="${plain3.id}"] .sab-rowmsg`, /Not saved/)
  is((await pressed(plain3.id)).length === 0 && (await row(plain3.id).locator('td').nth(3).locator('.sab-chip--ok').count()) === 0, 'a failed "recovered by me" leaves no recovered mark behind')
  // two rows at once are independent
  const g2 = deferred(); S.hold = { method: 'POST', route: 'abandoned_followup', promise: g2.promise }
  const a = ex.filter((o) => !o.followup && !o.recovered)[3], b = ex.filter((o) => !o.followup && !o.recovered)[4]
  await stateBtn(a.id, 'Contacted').click(); await stateBtn(b.id, 'Wrong number').click()
  await sleep(250)
  is((await row(a.id).getAttribute('aria-busy')) === 'true' && (await row(b.id).getAttribute('aria-busy')) === 'true' && posts(S).length >= 2, 'two rows can be saving at the same time, each on its own')
  g2.resolve(); S.hold = null
  await waitText(pg, `${ROWS}[data-id="${a.id}"] .sab-rowmsg`, /Saved\./); await waitText(pg, `${ROWS}[data-id="${b.id}"] .sab-rowmsg`, /Saved\./)
  is((await pressed(a.id)).join() === 'Contacted' && (await pressed(b.id)).join() === 'Wrong number', 'both end with their own state')
  await S.close()
}
}

// ================================================================================================ 8. layout, colour, focus
if (on(8)) {
head('8. 320 / 390 / 768 / 1280, light and dark: layout, tap targets, contrast, focus')
for (const w of [320, 390, 768, 1280]) {
  for (const [theme, device] of [['light', 'light'], ['dark', 'dark'], ['dark', 'light'], ['light', 'dark']]) {
    if (w !== 390 && w !== 1280 && theme !== device) continue
    const S = await open({ w, dark: theme === 'dark', deviceDark: device === 'dark' })
    await openPanel(S)
    const pg = S.pg
    await pg.locator(`${SEL} details.sab-msg > summary`).click()
    const m = await layoutOf(pg)
    const tag = `${w}px ${theme}${theme !== device ? ' theme on a ' + device + ' device' : ''}`
    if (theme === device) {
      is(m.docW <= m.vw && m.bodyW <= m.vw && m.panelScroll <= 0 && m.right <= m.vw + 1, `${tag}: no sideways scroll (document ${m.docW}/${m.vw}, panel overflow ${m.panelScroll})`)
      is(w >= 1000 ? m.tableDisplay === 'table' && m.theadShown && m.side : m.tableDisplay === 'block' && !m.theadShown && m.stacked, `${tag}: ${w >= 1000 ? 'a table with its header row' : 'stacked cards, no header row'}`, `${m.tableDisplay} thead ${m.theadShown} stacked ${m.stacked} side ${m.side} panel ${m.panelW}`)
      const small = m.taps.filter((t) => t.h < 40 || t.w < 40)
      is(m.taps.length > 30 && small.length === 0 && m.checks.every((h) => h >= 40), `${tag}: every one of ${m.taps.length} interactive elements is 40px or more in both directions (checkboxes by their label)`, small.slice(0, 4).map((t) => `${t.what} ${t.w.toFixed(0)}x${t.h.toFixed(0)}`).join(' | '))
    }
    const dark = theme === 'dark'
    is(dark ? lumv(m.bg) < 0.2 && lumv(m.color) > 0.7 : lumv(m.bg) > 0.9 && lumv(m.color) < 0.3, `${tag}: the panel follows the ADMIN's theme, not the device`, `${m.bg} / ${m.color}`)
    if (theme === device) {
      const rows = await contrastOf(pg)
      const low = rows.filter((r) => r.ratio < r.need)
      is(rows.length > 120 && low.length === 0, `${tag}: every text element (${rows.length}) is 4.5:1 or better (3:1 for large)`, low.slice(0, 4).map((r) => r.ratio.toFixed(2) + ' ' + r.what).join(' || '))
      if (dark && w === 1280) {
        await pg.evaluate(() => document.head.appendChild(document.getElementById('fx-darkadmin')))
        const again = (await contrastOf(pg)).filter((r) => r.ratio < r.need)
        is(again.length === 0, `${tag}: still 4.5:1 with the admin's dark rules appended after the panel's`, again.slice(0, 3).map((r) => r.ratio.toFixed(2) + ' ' + r.what).join(' || '))
      }
    }
    if (theme === 'light' && device === 'light' && (w === 390 || w === 1280)) {
      await pg.locator(`${SEL} .sab-state`).first().focus()
      await pg.keyboard.press('Tab'); await pg.keyboard.press('Shift+Tab')
      const ring = await pg.evaluate(() => { const c = getComputedStyle(document.activeElement); return { style: c.outlineStyle, w: parseFloat(c.outlineWidth), what: document.activeElement.className } })
      is(ring.style === 'solid' && ring.w >= 2, `${tag}: a keyboard-focused button shows a 2px ring`, JSON.stringify(ring))
    }
    if (process.env.SHOTS && theme === device) {
      // the top of the panel (tiles, filters, the first rows) and, with the wording editor open, what sits under it
      await pg.evaluate(() => window.scrollTo(0, 0))
      const box = await pg.locator(SEL).boundingBox()
      const tall = w >= 768 ? 1100 : 1700
      await pg.screenshot({ path: join(process.env.SHOTS, `abandoned-${w}-${theme}.png`), fullPage: true, clip: { x: 0, y: Math.max(0, box.y - 10), width: w, height: tall } })
    }
    await S.close()
  }
}
}

// ================================================================================================ 9. the rest of the file
if (on(9)) {
head('9. the other blocks of the file, and everything every page reported')
{
  const S = await open({})
  await openPanel(S)
  await S.pg.locator(`${ROWS} .sab-note`).first().evaluate((e) => e.scrollIntoView())
  await S.pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(900)
  is((await count(S.pg, '[data-sporta-savebar]')) === 0, 'the Save bar (block 5) never offers a panel button as a Save, even with the panel scrolled')
  is(S.errors.length === 0, 'no console or page error with every block of the file running together', S.errors.join(' | '))
  await S.close()
}
is(ALL.errors.length === 0, `no script error and no console error in any of the scenarios above (the browser's own "Failed to load resource" line for an HTTP error the test injected is not one)`, ALL.errors.slice(0, 3).join(' | '))
is(ALL.cleanErrors.length === 0, 'and in every visit where the server answered normally the console is EMPTY, "Failed to load resource" included (the probe and the list make no noise)', ALL.cleanErrors.slice(0, 3).join(' | '))
const ws = [...new Set(ALL.writes)]
is(ws.every((w) => w === 'local:setItem:sporta_ab_msg') && !ws.some((w) => /^(cookie|indexeddb|session)/.test(w)), 'the only thing written to web storage in all of it is "sporta_ab_msg" (no cookie, no IndexedDB, no sessionStorage, nothing else in localStorage)', ws.join(' | '))
is(ALL.fetches.length > 50 && ALL.fetches.every((f) => f.credentials === 'same-origin' && /X-Sporta-Admin/.test(JSON.stringify(f.headers)) && f.cache === 'no-store' && f.url.startsWith('/api/admin.php?r=abandoned_')), `all ${ALL.fetches.length} admin requests are same-origin, no-store and carry X-Sporta-Admin`)
is([...ALL.routes].sort().join() === 'abandoned_followup,abandoned_orders', 'the only routes called are abandoned_orders and abandoned_followup', [...ALL.routes].join())
is(!/\.innerHTML|insertAdjacentHTML|document\.write|\beval\(|window\.open|javascript:/.test(BLOCK) && !/\bfetch\([^)]*(https?:)/.test(BLOCK), 'the block contains no markup setter, eval, window.open or javascript: URL, and no request to another origin')
{
  const hrefs = BLOCK.split('\n').filter((l) => /\.href\s*=|\.src\s*=|setAttribute\(['"](href|src)/.test(l) && !/^\s*(\/\/|\*)/.test(l)).map((l) => l.trim())
  is(hrefs.length >= 3 && hrefs.every((l) => /encodeURIComponent|URL\.createObjectURL|\burl\b|it\.thumb|TEL/.test(l) || /thumb|url/.test(l)), 'every URL the block assigns is built from encodeURIComponent, a blob: URL or a local `url` (the rule scripts/xss-config-test.mjs applies to this file)', hrefs.join(' || '))
}
}

// ================================================================================================ 10. mutation check
// ================================================================================================ 10. mutation check
if (on(10)) {
head('10. MUTATION CHECK: each broken copy of the block is caught')
const mutate = (name, ...pairs) => {
  if (typeof pairs[0] === 'string') pairs = [[pairs[0], pairs[1]]]
  let block = BLOCK
  for (const [from, to] of pairs) {
    const n = block.split(from).length - 1
    if (n !== 1) throw new Error(`mutation "${name}": the text to change must occur exactly once in the block (found ${n}): ${from.slice(0, 60)}`)
    block = block.replace(from, () => to)
  }
  return BRANDS.slice(0, BEGIN) + block + BRANDS.slice(BEGIN + BLOCK.length)
}
// each checker answers: "does the behaviour this mutant breaks still hold?"
const asserts = {
  async entry(js) { const S = await open({ js, record: false }); await sleep(900); const ok = (await count(S.pg, '[data-sporta-ab-nav]')) === 1; await S.close(); return ok },
  async absent(js) { const S = await open({ js, routePresent: false, record: false }); await sleep(900); const ok = (await count(S.pg, '[data-sporta-ab-nav], [data-sporta-abandoned], style[data-sporta-ab-style]')) === 0; await S.close(); return ok },
  async csv(js, what) {
    const S = await open({ js, record: false }); await openPanel(S); await loadAllRows(S)
    const { bytes } = await downloadCsv(S)
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    const text = bytes.slice(bom ? 3 : 0).toString('utf8'), rows = parseCsv(text), h = rows[0]
    const formula = rows.find((r) => r[h.indexOf('Customer')].includes('HYPERLINK')), quote = rows.find((r) => r[h.indexOf('Customer')].includes('Mimi'))
    const ok = what === 'bom' ? bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf : what === 'formula' ? formula[h.indexOf('Customer')].startsWith("'=") : quote[h.indexOf('Customer')] === 'Mona "Mimi", Al-Sabah'
    await S.close(); return ok
  },
  async markup(js) { const S = await open({ js, record: false }); await openPanel(S); const ok = (await count(S.pg, `${SEL} img, ${SEL} script`)) === 0; await S.close(); return ok },
  async rollback(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    const o = expected(S, '').orders.find((x) => !x.followup && !x.recovered)
    S.rules.push({ match: (i) => i.method === 'POST', status: 500, body: { error: 'failed' } })
    await rowOf(S.pg, o.id).locator('.sab-state').first().click(); await sleep(900)
    const ok = (await rowOf(S.pg, o.id).locator('.sab-state[aria-pressed="true"]').count()) === 0
    await S.close(); return ok
  },
  async wa(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    const o = expected(S, '').orders.find((x) => x.customer_lang === 'ar' && x.whatsapp_phone)
    const href = await rowOf(S.pg, o.id).locator('a').first().getAttribute('href')
    await S.close(); return href.startsWith(`https://wa.me/${o.whatsapp_phone}?text=%D9%85`) && !href.includes(' ')
  },
  async dollar(js) {
    const { orders, o2 } = badNames(); const S = await open({ js, orders, record: false }); await openPanel(S); await loadAllRows(S)
    const href = await rowOf(S.pg, o2.id).locator('a').first().getAttribute('href')
    await S.close(); return decodeURIComponent(href.split('?text=')[1]).startsWith("Hello Sam$'s $& $1 Mo, this is Sporta.")
  },
  async bidi(js) {
    const { orders, o1 } = badNames(); const S = await open({ js, orders, record: false }); await openPanel(S); await loadAllRows(S)
    const t = await rowOf(S.pg, o1.id).locator('.sab-name').textContent()
    await S.close(); return !t.includes('\u202e')
  },
  async stale(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    S.rules.push({ match: (i) => i.query.get('reason') === 'unpaid', delay: 1500 })
    await S.pg.locator(`${SEL} select`).selectOption('unpaid'); await sleep(150)
    await S.pg.locator(`${SEL} select`).selectOption('declined'); await sleep(2800)
    const r = await S.pg.evaluate(() => [...new Set([...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((x) => x.getAttribute('data-reason')))].join())
    await S.close(); return r === 'declined'
  },
  async closeOnNav(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    await clickReact(S, 'Returns'); await sleep(300)
    const ok = await S.pg.evaluate(() => document.querySelector('[data-sporta-abandoned]').hidden)
    await S.close(); return ok
  },
  async onlyOurs(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    const n = await count(S.pg, '[aria-current="page"]')
    await S.close(); return n === 1
  },
  async dedupe(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    const un = expected(S, '')
    S.rules.push({ match: (i) => i.query.get('page') === '2', transform: (b) => ({ ...b, orders: [un.orders[19], ...b.orders] }) })
    await S.pg.locator(`${SEL} .sab-more button`).click(); await S.pg.waitForFunction(() => document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length > 20); await sleep(200)
    const ids = await S.pg.evaluate(() => [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].map((r) => r.getAttribute('data-id')))
    await S.close(); return new Set(ids).size === ids.length
  },
  async waiting(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    await S.pg.locator(`${SEL} select`).selectOption('waiting'); await S.pg.waitForFunction(() => [...document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]')].every((r) => r.getAttribute('data-reason') === 'waiting') && document.querySelectorAll('[data-sporta-abandoned] tbody tr[data-id]').length > 0)
    const n = await count(S.pg, `${SEL} tbody a`)
    await S.close(); return n === 0
  },
  async storage(js) {
    const S = await open({ js, record: false }); await openPanel(S); await sleep(300)
    const w = await S.pg.evaluate(() => window.__writes)
    await S.close(); return w.length === 0
  },
  async header(js) { const S = await open({ js, record: false }); await openPanel(S, false); await sleep(1500); const ok = (await count(S.pg, ROWS)) > 0; await S.close(); return ok },
  async dates(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    const n = list(S).length
    await S.pg.locator(`${SEL} input[type=date]`).nth(0).fill('2026-11-03'); await sleep(500)
    const n1 = list(S).length
    await S.pg.locator(`${SEL} input[type=date]`).nth(1).fill('2026-11-01'); await sleep(600)
    const ok = list(S).length === n1 && n1 === n + 1
    await S.close(); return ok
  },
  async table(js) { const S = await open({ js, record: false }); await openPanel(S); const d = await S.pg.evaluate(() => getComputedStyle(document.querySelector('[data-sporta-abandoned] table')).display); await S.close(); return d === 'table' },
  async contrast(js) { const S = await open({ js, record: false }); await openPanel(S); const low = (await contrastOf(S.pg)).filter((r) => r.ratio < r.need); await S.close(); return low.length === 0 },
  async tap(js) { const S = await open({ js, w: 390, record: false }); await openPanel(S); const m = await layoutOf(S.pg); await S.close(); return m.taps.filter((t) => t.h < 40).length === 0 },
  async back(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    await S.pg.goBack(); await sleep(500)
    const ok = await S.pg.evaluate(() => document.querySelector('[data-sporta-abandoned]').hidden)
    await S.close(); return ok
  },
  async wipe(js) {
    const S = await open({ js, record: false }); await openPanel(S)
    await S.pg.evaluate(() => window.fx.signOut()); await sleep(700)
    await S.pg.evaluate(() => window.fx.signIn()); await sleep(1200)
    const ok = await S.pg.evaluate(() => !document.body.textContent.includes('9655550') && document.querySelectorAll('[data-sporta-abandoned] tbody tr').length === 0)
    await S.close(); return ok
  },
}
const MUTANTS = [
  ['the block is not in the file', WITHOUT, 'entry'],
  ['a 404 on the probe is treated as "present"', mutate('probe', 'r.status === 404 || r.status === 405 || r.status === 501 || ', 'false || '), 'absent'],
  ['the spreadsheet-formula guard is removed', mutate('formula', "if (/^[=+\\-@\\t\\r\\n]/.test(s)) s = \"'\" + s", ''), 'csv:formula'],
  ['the byte order mark is not written', mutate('bom', "new Blob(['\\uFEFF', csvText()]", 'new Blob([csvText()]'), 'csv:bom'],
  ['quotes inside a CSV cell are not doubled', mutate('quotes', "'\"' + s.replace(/\"/g, '\"\"') + '\"'", "'\"' + s + '\"'"), 'csv:quote'],
  ['the customer name is put into the page as markup', mutate('markup', "nm.setAttribute('dir', 'auto')\n    c2.appendChild(nm)", "nm.setAttribute('dir', 'auto'); nm['inner' + 'HTML'] = d.customer_name\n    c2.appendChild(nm)"), 'markup'],
  ['a refused follow-up is not rolled back', mutate('rollback', 'd.followup = prev.f; d.recovered = prev.rec; d.recovered_by = prev.by', ''), 'rollback'],
  ['the WhatsApp text is not URL-encoded', mutate('encode', "url += '?text=' + encodeURIComponent(t)", "url += '?text=' + t"), 'wa'],
  ['an answer to an older filter is allowed to replace a newer one (no sequence guard, no abort)', mutate('stale', ["      if (timer) clearTimeout(timer)\n      if (my !== seq) return\n      S.loading = false", "      if (timer) clearTimeout(timer)\n      S.loading = false"], ["if (ctl) { try { ctl.abort() } catch (e) { /* already done */ } }", ""]), 'stale'],
  ['a customer name is put into the WhatsApp text with a string replacement (its $ patterns are read)', mutate('dollar', "replace(/\\{name\\}/g, function () { return name })", "replace(/\\{name\\}/g, name)"), 'dollar'],
  ['bidi override characters are not removed from customer text', mutate('bidi', ".replace(/[\\u202a-\\u202e\\u2066-\\u2069]/g, '')", ''), 'bidi'],
  ['a click on the compiled nav does not close the panel', mutate('close', "    closePanel('nav')\n  }, true)", "    void 0\n  }, true)"), 'closeOnNav'],
  ['React\'s current-tab mark is left on', mutate('neutralise', "if (b.getAttribute('aria-current')) { b.removeAttribute('aria-current'); b.setAttribute(CURMARK, '1') }", ''), 'onlyOurs'],
  ['Load more does not drop a row it already has', mutate('dedupe', "if (!d || typeof d !== 'object' || S.ids[d.id]) return", "if (!d || typeof d !== 'object') return"), 'dedupe'],
  ['an order still waiting gets contact buttons', mutate('waiting', "if (d.reason === 'waiting') {", 'if (false) {'), 'waiting'],
  ['the panel writes a customer name to web storage', mutate('storage', "    S.open = true\n    document.body.setAttribute(OPEN, 'open')", "    S.open = true\n    try { localStorage.setItem('sporta_ab_last', 'x') } catch (e) { /* t */ }\n    document.body.setAttribute(OPEN, 'open')"), 'storage'],
  ['the X-Sporta-Admin header is not sent', mutate('header', "Object.assign({ 'X-Sporta-Admin': '1' }", "Object.assign({ 'X-Other': '1' }"), 'header'],
  ['From after To is sent to the server', mutate('dates', 'if (datesBad()) {', 'if (false) {'), 'dates'],
  ['the table layout is removed (always stacked)', mutate('table', "'@container (min-width:720px){',\n    '.sab-table{display:table}',", "'@container (min-width:99999px){',\n    '.sab-table{display:table}',"), 'table'],
  ['the muted text colour is too pale', mutate('contrast', '--sab-muted:#556274;--sab-action', '--sab-muted:#b6bec9;--sab-action'), 'contrast'],
  ['buttons are shorter than a thumb', mutate('tap', 'min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--sab-edge)', 'min-height:1.25rem;padding:.1rem .5rem;border:1px solid var(--sab-edge)'), 'tap'],
  ['Back does not close the panel', mutate('back', "else if (!want && S.open) closePanel('history')", ''), 'back'],
  ['a sign-out leaves the customers in the page', mutate('wipe', 'if (panel) wipe()', ''), 'wipe'],
]
for (const [name, js, kind] of MUTANTS) {
  const [fn, arg] = kind.split(':')
  const caught = !(await asserts[fn](js, arg))
  is(caught, `MUTANT caught: ${name}`)
}
is((await asserts.entry(BRANDS)) && (await asserts.absent(BRANDS)) && (await asserts.markup(BRANDS)) && (await asserts.waiting(BRANDS)) && (await asserts.dollar(BRANDS)) && (await asserts.bidi(BRANDS)), 'and the unmodified block passes the same checks (so a "caught" means something)')
}

if (on(11)) {
head('11. customer text that fights the page: a bidi override that never closes, and $ patterns (added in the independent review)')
{
  const { orders, o1, o2 } = badNames()
  const S = await open({ orders })
  const pg = S.pg
  await openPanel(S); await loadAllRows(S)
  const want1 = 'Ali' + 'gnirts 1234'
  is((await rowOf(pg, o1.id).locator('.sab-name').textContent()) === want1, 'a name holding a bidi override is shown without it (it would have reversed the visible text)')
  is(await pg.evaluate((s) => !document.querySelector(s).textContent.includes('\u202e'), SEL), 'and no override character is anywhere in the panel')
  is((await rowOf(pg, o2.id).locator('.sab-name').textContent()) === "Sam$'s $& $1 Mo", 'a name with $ patterns is shown as typed')
  const { bytes } = await downloadCsv(S)
  const text = bytes.slice(3).toString('utf8'), rows = parseCsv(text), h = rows[0]
  const cell = (o) => rows.find((r) => r[h.indexOf('Track ID')] === o.track_id)[h.indexOf('Customer')]
  is(cell(o1) === want1 && !text.includes('\u202e'), 'the CSV carries the name without the override, and no override anywhere', cell(o1))
  is(cell(o2) === "Sam$'s $& $1 Mo", 'the CSV carries the $ name as typed', cell(o2))
  const msgEn = 'Hello {name}, this is Sporta. We noticed your order {order} was not completed. If you need any help finishing it, we are happy to help.'
  const want = msgEn.replace('{name}', () => o2.customer_name).replace('{order}', () => o2.track_id)
  const href = await rowOf(pg, o2.id).locator('a').first().getAttribute('href')
  is(href === `https://wa.me/${o2.whatsapp_phone}?text=${encodeURIComponent(want)}`, 'the WhatsApp text copies the $ name as typed ($\' and $& are not patterns)', decodeURIComponent(href.split('?text=')[1] || ''))
  is(await pg.evaluate(() => window.__xss === undefined), 'nothing ran')
  await S.close()
}
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
