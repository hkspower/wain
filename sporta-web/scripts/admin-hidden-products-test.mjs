// "Hidden from the shop" on the Catalogue screen of /backends (block ADMIN HIDDEN PRODUCTS in public/sporta-admin-brands.js), in a real browser with the
// real add-on file and real Tailwind. The shop hides a product by itself when it lacks a name, a price, a SKU or a photo (dropin/php-store/product-listable.php);
// admin.php?r=products_all carries `hidden_reasons` and `listed`, and this block turns that into a button and a list so the owner sees WHICH products are hidden
// and WHY (owner, 2026-11-18: "make auto hide any products without price 0 and sku and name and image").
//
//   npm run test:admin-hidden-products     (rig-free: the admin API is answered by route interception)
//
// Asserted:
//   - the button "Hidden from the shop (N)" is in the Catalogue header when an ACTIVE product is hidden, with the right N; none on other screens, none when
//     nothing is hidden, none when the server does not send hidden_reasons (the API release has not shipped), none for an inactive product;
//   - the dialog (role=dialog, aria-modal, labelled; Escape closes and returns focus; Tab stays inside) lists each hidden product with its slug and what it
//     lacks, counts each missing part, and "Read again" reads again; a failing read says so and recovers; a product that gets what it lacked disappears;
//   - only ONE read of products_all while the screen is on show (not one per click), nothing is written, no other route is called, no other host;
//   - Arabic is right to left with Arabic names and words; no sideways scroll at 390 px; every control 44 px or more; one style element; no page errors;
//   - MUTATIONS: without the active filter, without the empty-reasons filter, without the older-server guard, or without the per-reason count, the check fails.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIVE, SCREEN, PRODUCTS, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'
import { ROOT, PUB } from './lib/catalogue-fx.mjs'

const BRANDS_JS = readFileSync(join(PUB, 'sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(PUB, 'sporta-admin-knet.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const SETTINGS = '<section class="admin-page"><div class="admin-page-layout"><header class="admin-page-header"><h1 class="text-2xl font-bold text-slate-900">Settings</h1></header><div class="p-4">Settings body</div></div></section>'
const SCREENS = { settings: SETTINGS, catalogue: SCREEN }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'hidden-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
// The compiled Catalogue screen reads products_all itself when it opens; the fixture does the same from a file (the CSP allows only own scripts).
const pageHtml = ({ ar, screen, own }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script>${own ? '<script src="/screen-read.js"></script>' : ''}</body></html>`
const SCREEN_READ = "fetch('/api/admin.php?r=products_all',{credentials:'include',headers:{'X-Sporta-Admin':'1'}}).then(function(r){return r.text()}).catch(function(){})"

// What products_all answers, with the two keys the new API adds. Active: 5 products; one of them hidden for two reasons, one for one; one inactive and hidden.
const row = (p, hidden) => ({ ...p, hidden_reasons: hidden, listed: Number(p.active) === 1 && hidden.length === 0 })
const rowsWith = () => [
  row(PRODUCTS[0], []),                        // vanquish-tee-white: listed
  row(PRODUCTS[1], []),                        // air-max-90: listed
  row(PRODUCTS[2], ['photo', 'sku']),          // air-max: hidden, two reasons
  row(PRODUCTS[3], ['photo']),                 // long-desc-hoodie: hidden, one reason
  row(PRODUCTS[4], ['photo', 'price']),        // hidden-cap: INACTIVE (active 0) and lacks things: not offered here
  row(PRODUCTS[5], []),                        // run-shorts: listed
]

function makeShop(o = {}) {
  const st = { calls: [], posts: [], offHost: [], rows: rowsWith(), fault: 0, ...o }
  async function handle(route) {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== ORIGIN) { st.offHost.push(req.url()); return route.abort() }
    if (req.method() !== 'GET') st.posts.push(req.method() + ' ' + u.pathname)
    const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => route.fulfill({ status, body, headers: { 'content-type': type, ...headers } })
    if (u.pathname === '/api/admin.php') {
      st.calls.push(u.searchParams.get('r'))
      if (u.searchParams.get('r') === 'products_all') return st.fault ? send(500, '{"error":"x"}', 'application/json') : send(200, JSON.stringify(st.rows), 'application/json')
      return send(404, '{"error":"unknown_route"}', 'application/json')
    }
    if (u.pathname === '/fixture.js') return send(200, FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}`, 'text/javascript')
    if (u.pathname === '/sporta-admin-brands.js') return send(200, st.js || BRANDS_JS, 'text/javascript')
    if (u.pathname === '/screen-read.js') return send(200, SCREEN_READ, 'text/javascript')
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    const screen = u.searchParams.get('screen') || 'catalogue'
    return send(200, pageHtml({ ar: u.searchParams.get('ar') === '1', screen, own: screen === 'catalogue' && !st.noScreenRead }), 'text/html; charset=utf-8', { 'content-security-policy': CSP })
  }
  return { st, handle }
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function open(o = {}, { w = 1280, h = 900, ar = false, screen = 'catalogue' } = {}) {
  const shop = makeShop(o)
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  const pg = await ctx.newPage(), errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.route('**/*', shop.handle)
  await pg.goto(`${ORIGIN}/backends?screen=${screen}${ar ? '&ar=1' : ''}`); await pg.waitForTimeout(1500)
  return { ctx, pg, errors, shop }
}
const R = '[data-shp-root]', B = '[data-sporta-hp-open]', BAR = '[data-shp-bar]'
const barText = async (pg) => (await pg.locator(BAR).count()) ? (await pg.textContent(BAR)).replace(/\s+/g, ' ').trim() : ''

head('the button')
{
  const { pg, errors, shop } = await open()
  is(await pg.locator(B).count() === 1 && /^2 active products are hidden from the shop because something is missing\. ?See which$/.test(await barText(pg)), 'one band under the Catalogue header: "2 active products are hidden ..." with a "See which" button (the inactive product is not counted)', await barText(pg))
  const place = await pg.evaluate(() => { const h = document.querySelector('.admin-page-header'); return { inHeader: !!h.querySelector('[data-sporta-hp-open]'), next: h.nextElementSibling && h.nextElementSibling.hasAttribute('data-shp-bar'), kids: h.children.length } })
  is(!place.inHeader && place.next, 'the band sits right under the header and adds nothing to it (the header already holds five buttons)', JSON.stringify(place))
  // THE BLOCK LISTENS: it makes no read of its own for the button. (Other blocks of the add-on file read products_all on this screen too, so the count
  // is not 1: what is asserted is that clicking about adds none, and that a read the SCREEN makes later moves the count with nothing added by the block.)
  const n0 = shop.st.calls.filter((c) => c === 'products_all').length
  for (let i = 0; i < 4; i++) await pg.click('h1', { force: true })
  await pg.waitForTimeout(1500)
  is(n0 >= 1 && shop.st.calls.filter((c) => c === 'products_all').length === n0, 'clicking about the screen adds no products_all read', JSON.stringify(shop.st.calls))
  is(shop.st.calls.every((c) => c === 'products_all'), 'no other admin route is called on the Catalogue screen', JSON.stringify(shop.st.calls))
  shop.st.rows = shop.st.rows.map((r) => r.slug === 'air-max' ? { ...r, hidden_reasons: [], listed: true } : r)
  await pg.evaluate(() => fetch('/api/admin.php?r=products_all', { credentials: 'include', headers: { 'X-Sporta-Admin': '1' } }).then((r) => r.text()))
  await pg.waitForFunction(() => /^1 active/.test(document.querySelector('[data-shp-bar]').textContent.trim()), null, { timeout: 4000 }).catch(() => {})
  is(/^1 active/.test(await barText(pg)) && shop.st.calls.filter((c) => c === 'products_all').length === n0 + 1, 'when the screen reads again after a change the count follows, and the only new request is the screen\u2019s', (await barText(pg)) + ' ' + shop.st.calls.length)
  shop.st.rows = rowsWith()
  await pg.evaluate(() => fetch('/api/admin.php?r=products_all', { credentials: 'include', headers: { 'X-Sporta-Admin': '1' } }).then((r) => r.text()))
  await pg.waitForFunction(() => /^2 active/.test(document.querySelector('[data-shp-bar]').textContent.trim()), null, { timeout: 4000 }).catch(() => {})
  await pg.goto(`${ORIGIN}/backends?screen=settings`); await pg.waitForTimeout(900)
  is(await pg.locator(B).count() === 0, 'none on the Settings screen')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await open({ rows: rowsWith().map((r) => ({ ...r, hidden_reasons: [], listed: true })) })
  is(await pg.locator(B).count() === 0, 'nothing hidden: no button')
}
{
  const { pg } = await open({ rows: rowsWith().map(({ hidden_reasons, listed, ...r }) => r) })
  is(await pg.locator(B).count() === 0, 'a server that does not send hidden_reasons yet (older API): no button')
}
{
  const { pg } = await open({ fault: 1 })
  is(await pg.locator(B).count() === 0, 'a failing read: no button, no error on the page')
}
{
  // LISTENING FAILED (the screen's read happened before this file had loaded): ONE read of its own, about 4.5 seconds in. Proven with the listener switched off.
  const js = BRANDS_JS.replace("if (rawFetch) window.fetch = function (input) {", "if (false) window.fetch = function (input) {")
  is(js !== BRANDS_JS, 'the listener can be switched off for this check')
  const { pg, shop } = await open({ js, noScreenRead: true })
  const before = shop.st.calls.filter((c) => c === 'products_all').length
  is(await pg.locator(B).count() === 0, 'with nothing to listen to the button is not there yet')
  await pg.waitForFunction(() => !!document.querySelector('[data-sporta-hp-open]'), null, { timeout: 9000 }).catch(() => {})
  is(await pg.locator(B).count() === 1 && shop.st.calls.filter((c) => c === 'products_all').length === before + 1, 'then ONE read of its own, and the button appears', JSON.stringify(shop.st.calls) + ' before ' + before)
}
{
  const { pg } = await open({}, { ar: true })
  is(/المخفية عن المتجر.*: 2/.test(await barText(pg)) && /اعرض أيها/.test(await barText(pg)) && await pg.getAttribute(BAR, 'dir') === 'rtl', 'the Arabic admin gets the Arabic band, right to left')
}

head('the list')
{
  const { pg, errors, shop } = await open()
  await pg.click(B); await pg.waitForSelector(R); await pg.waitForSelector('[data-shp="list"]')
  const dlg = pg.locator(`${R} [role="dialog"]`)
  is(await dlg.getAttribute('aria-modal') === 'true' && await dlg.getAttribute('aria-labelledby') === 'shp-title' && await pg.locator('#shp-title').count() === 1, 'a modal dialog, labelled by its title')
  const items = await pg.$$eval('[data-shp="list"] li', (ls) => ls.map((l) => ({ name: l.querySelector('.shp-name').childNodes[0].textContent, slug: l.querySelector('.shp-slug').textContent, tags: [...l.querySelectorAll('.shp-tag')].map((t) => t.textContent) })))
  is(JSON.stringify(items) === JSON.stringify([{ name: 'Air Max', slug: 'air-max', tags: ['No photo', 'No size row (no SKU)'] }, { name: 'Team Hoodie', slug: 'long-desc-hoodie', tags: ['No photo'] }]),
    'each hidden product with its name, slug and what it lacks (and not the listed ones, nor the inactive one)', JSON.stringify(items))
  const counts = await pg.$$eval('[data-shp="counts"] li', (ls) => ls.map((l) => l.textContent))
  is(JSON.stringify(counts) === JSON.stringify(['No photo: 2', 'No size row (no SKU): 1']), 'a count for each missing part (parts nobody lacks are not listed)', JSON.stringify(counts))
  is(/2 hidden/.test(await pg.textContent(`${R} .shp-sum`)), 'the summary says 2 hidden')
  is(await pg.locator('#shp-style').count() === 1 && (await pg.locator('style[id^="shp"]').count()) === 1, 'one style element')
  // read again picks up a product that got its photo and sizes
  shop.st.rows = shop.st.rows.map((r) => r.slug === 'air-max' ? { ...r, hidden_reasons: [], listed: true } : r)
  await pg.click('[data-shp="refresh"]'); await pg.waitForFunction(() => document.querySelectorAll('[data-shp="list"] li').length === 1)
  is(await pg.locator('[data-shp="list"] li').count() === 1 && /1 hidden/.test(await pg.textContent(`${R} .shp-sum`)), '"Read again": the product that got what it lacked is gone from the list')
  is(shop.st.calls.filter((c) => c === 'products_all').length >= 2, 'and the route was read again')
  // a failing read says so, then recovers
  shop.st.fault = 1; await pg.click('[data-shp="refresh"]'); await pg.waitForSelector(`${R} .shp-btn`)
  is(/could not be read/.test(await pg.textContent(R)), 'a failing read is said')
  shop.st.fault = 0; await pg.click(`${R} .shp-btn`); await pg.waitForSelector('[data-shp="list"]')
  is(await pg.locator('[data-shp="list"] li').count() === 1, 'and "Read again" recovers')
  // keyboard
  await pg.focus(`${R} .shp-x`); await pg.keyboard.press('Shift+Tab')
  is(await pg.evaluate(() => !!document.activeElement.closest('[data-shp-root]')), 'Shift+Tab from the first control stays inside the dialog')
  const sizes = await pg.$$eval(`${R} button`, (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)))
  is(sizes.length >= 2 && sizes.every((h) => h >= 44), 'every control is 44 px or taller', JSON.stringify(sizes))
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100)
  is(await pg.locator(R).count() === 0 && await pg.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-hp-open')), 'Escape closes it and returns the focus to the button')
  is(shop.st.posts.length === 0 && shop.st.offHost.length === 0, 'READ ONLY: nothing but GET requests, none to another host', JSON.stringify([shop.st.posts, shop.st.offHost]))
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await open({}, { ar: true })
  // (the fixture's fixed sidebar stays on the LEFT in Arabic, unlike the real admin's, and covers the band's end: the click is sent to the button itself)
  await pg.dispatchEvent(B, 'click'); await pg.waitForSelector('[data-shp="list"]')
  const t = await pg.textContent(R)
  is(await pg.getAttribute(R, 'dir') === 'rtl' && /بلا صورة/.test(t) && /بلا مقاسات/.test(t) && /اير ماكس/.test(t), 'Arabic: right to left, Arabic words, the Arabic product name')
}
{
  const { pg } = await open({}, { w: 390, h: 800 })
  await pg.click(B); await pg.waitForSelector('[data-shp="list"]')
  const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth - document.documentElement.clientWidth, dlg: document.querySelector('.shp-dlg').getBoundingClientRect().right <= innerWidth }))
  is(m.sw <= 0 && m.dlg, 'at 390 px: no sideways scroll and the dialog fits', JSON.stringify(m))
}

head('mutations: with one rule cut, the check goes red')
{
  const cases = [
    ['without the active filter', "return rows.filter(function (r) { return r && Number(r.active) === 1 && Array.isArray(r.hidden_reasons) && r.hidden_reasons.length > 0 })", "return rows.filter(function (r) { return r && Array.isArray(r.hidden_reasons) && r.hidden_reasons.length > 0 })", /^3 active/],
    ['without the empty-reasons filter', "Array.isArray(r.hidden_reasons) && r.hidden_reasons.length > 0 })", "Array.isArray(r.hidden_reasons) })", /^5 active/],
  ]
  for (const [label, from, to, want] of cases) {
    const js = BRANDS_JS.replace(from, to)
    if (js === BRANDS_JS) { is(false, `mutation "${label}": the cut text was found`); continue }
    const { pg } = await open({ js })
    const text = await barText(pg)
    is(want.test(text), `mutation "${label}": the count changes (${text.slice(0, 12) || 'no band'}), so the check above goes red`)
  }
  {
    const js = BRANDS_JS.replace("if (!Array.isArray(rows)) return []", "if (!Array.isArray(rows)) return []; rows = rows.map(function (r) { return r && !Array.isArray(r.hidden_reasons) ? Object.assign({}, r, { hidden_reasons: ['photo'] }) : r })")
    if (js === BRANDS_JS) is(false, 'mutation "without the older-server guard": the cut text was found')
    else {
      const { pg } = await open({ js, rows: rowsWith().map(({ hidden_reasons, listed, ...r }) => r) })
      is(await pg.locator(B).count() === 1, 'mutation "treating a missing hidden_reasons as hidden": the button appears on an older server, so the check above goes red')
    }
  }
  {
    const js = BRANDS_JS.replace("if (counts[k] != null) counts[k]++", "")
    if (js === BRANDS_JS) is(false, 'mutation "without the per-reason count": the cut text was found')
    else {
      const { pg } = await open({ js }); await pg.click(B); await pg.waitForSelector('[data-shp="list"]')
      is(await pg.locator('[data-shp="counts"] li').count() === 0, 'mutation "without the per-reason count": no counts, so the check above goes red')
    }
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
