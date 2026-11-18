// LIVE DATA on every /backends screen (owner, 2026-11-18: "use ajax for all backends"): the ADMIN LIVE DATA block of public/sporta-admin-brands.js,
// proved on the REAL compiled admin (the capture of the live client served by scripts/lib/add-to-cart-ux-live.mjs, its admin.php answered by route
// interception) with the real add-on file. Timings are shortened through window.__sportaLiveTiming (30 s becomes 0.7 s).
//
//   npm run test:admin-live-data     (needs the live capture like the other real-app suites; it says so and skips when it is absent)
//
// What the compiled admin does today (measured by this suite's first probes): a screen reads once, the first time it is opened, and stays mounted
// when you leave it, so coming back shows old data; only a Refresh button (Orders, Activity, Inventory ...) or a reload updates it.
//
// Asserted:
//   - A screen WITHOUT a Refresh button (Overview): when the server's data changes, the screen shows the new numbers by itself (an in-place reload that
//     puts the same screen back), once, and then stays quiet; the sign-in, the screen and the page errors are untouched.
//   - A screen WITH a Refresh button (Orders): a new order shows by itself without a reload, the filter you chose stays, no other screen is visited; a
//     screen opened again after the data changed while you were away is brought up to date at once.
//   - NEVER UNDER YOUR HANDS: not while a field has focus, not while a dialog is open, not on an editor screen (Brands): there a "New data" chip with a
//     button appears and the screen is refreshed only when it is pressed (and then it comes back to the same screen with the new data).
//   - Volatile keys ("now") do not count as a change; a read that keeps changing is given up after three times, and the page is never reloaded more than
//     twice in ten minutes by itself.
//   - What is polled: only GETs of the current screen's own reads, with the admin header and the session, at most four per round; never the session,
//     payment, gateway, export, database-centre, assistant or image routes; nothing is written; a paused tab and a hidden tab poll nothing.
//   - The chip: shows Live and the time of the last check, Pause / Resume are remembered across a reload, English and Arabic (right to left), 44 px buttons.
//   - A 401 or a network failure on a poll does not break the page; the chip says offline and recovers.
//   - MUTATIONS: without the focus guard, with every screen treated as a list, without the volatile-key filter, without restoring the screen, without the
//     reload limit, the matching check fails.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIVE } from './fixtures/admin-products.mjs'
import { serveLive, liveDir, PUB } from './lib/add-to-cart-ux-live.mjs'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
if (!liveDir()) { console.log('SKIP no live capture (set SPORTA_LIVE_CAPTURE)'); process.exit(0) }
const SRC = readFileSync(join(PUB, 'sporta-admin-brands.js'), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const TIMING = { every: 700, quiet: 450, tick: 120, writeQuiet: 3500 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ORDER = (id, name, paid = 'paid') => ({ track_id: id, created_at: '2026-11-18 10:00:00', customer_name: name, amount: 12.5, payment_status: paid, payment_method: 'cod', fulfilment_status: 'new' })
async function start({ js, w = 1280, lang = 'en', timing = {}, delayJs = 0 } = {}) {
  const S = {
    calls: [], fault: {}, abort: false, volatile: false, counter: false,
    stats: { paid_revenue: 100, paid_count: 3, revenue_today: 10, paid_today: 1, revenue_7d: 50, paid_7d: 2, unfulfilled_count: 1 },
    orders: [ORDER('SPX00001', 'Ali')], events: [], brands: [],
  }
  const srv = await serveLive({ css: { 'assets/AdminApp-Dw3t3z9Z.css': LIVE }, js: js ? { 'sporta-admin-brands.js': js } : {} })
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 } })
  await ctx.addInitScript(([t, l]) => { window.__sportaLiveTiming = t; try { if (!sessionStorage.getItem('__fresh')) { localStorage.setItem('lang', l); sessionStorage.setItem('__fresh', '1') } } catch (e) { /* ignore */ } }, [{ ...TIMING, ...timing }, lang])
  const page = await ctx.newPage(), errs = []
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)))
  let loads = 0; page.on('load', () => loads++)
  // a late start: the add-on arrives after the app has made its first reads (the real file is a 1.2 MB script that a 1 kB loader adds)
  if (delayJs) await page.route('**/sporta-admin-brands.js*', async (route) => { await sleep(delayJs); route.continue() })
  await page.route('**/api/admin.php*', (route) => {
    const req = route.request(), u = new URL(req.url()), r = u.searchParams.get('r')
    S.calls.push({ m: req.method(), r, url: req.url(), hdr: req.headers()['x-sporta-admin'] || '', at: Date.now() })
    if (S.abort && r !== 'me') return route.abort()
    if (S.fault[r]) return route.fulfill({ status: S.fault[r], contentType: 'application/json', body: '{"error":"x"}' })
    const body = r === 'me' ? { email: 'owner@sporta.test' } : r === 'stats' ? { ...S.stats, ...(S.volatile ? { now: Date.now() } : {}), ...(S.counter ? { paid_count: S.stats.paid_count + (S.n = (S.n || 0) + 1) } : {}) }
      : r === 'orders' ? S.orders : r === 'activity_log' ? { events: S.events, has_more: false } : r === 'brands' ? S.brands
      : r === 'abandoned_orders' ? null : r === 'content' ? {} : r === 'google_status' ? { connected: false } : r === 'mfa_status' ? { enabled: false } : r === 'passcode_info' ? { set: false } : r === 'assistant_settings' ? {} : []
    if (body === null) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unknown_route"}' })
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(srv.base + '/backends'); await page.waitForSelector('.admin-sidebar__nav .admin-nav-item'); await sleep(1500)
  return { S, srv, ctx, page, errs, get loads() { return loads }, close: async () => { await ctx.close(); await srv.close() } }
}
const nav = (page, label) => page.evaluate((x) => { const b = [...document.querySelectorAll('.admin-sidebar__nav .admin-nav-item')].find((q) => q.textContent.trim() === x); if (b) b.click(); return !!b }, label)
const cur = (page) => page.evaluate(() => { const c = document.querySelector('.admin-sidebar__nav [aria-current="page"]'); return c ? c.textContent.trim() : '' })
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
const chip = (page) => page.evaluate(() => { const c = document.querySelector('[data-sal="chip"]'); return c ? { state: c.getAttribute('data-state'), text: c.querySelector('.sal-txt').textContent, apply: !c.querySelector('[data-sal="apply"]').hidden, applyText: c.querySelector('[data-sal="apply"]').textContent, toggle: c.querySelector('[data-sal="toggle"]').textContent, dir: c.getAttribute('dir'), h: [...c.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)) } : null })
// a check that lands in the middle of the in-place reload sees a page that is being replaced: that is "not yet", not a failure
// puts the caret in a box that is on the screen (what a person does before typing); false when there is none
const focusBox = (page) => page.evaluate(() => { const e = [...document.querySelectorAll('.admin-page input, .admin-page textarea')].find((n) => n.getClientRects().length && !/^(hidden|checkbox|radio|button|submit)$/.test(n.type)); if (e) e.focus(); return !!e && document.activeElement === e })
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true } catch (e) { /* navigating */ } await sleep(100) } return false }
const ADMIN_GETS = (S, from) => S.calls.filter((c) => c.at >= from && c.m === 'GET')

// ===================================================================================================== 1. no Refresh button
head('Overview: no Refresh button, the page reloads in place')
{
  const t = await start()
  is(/REVENUE \(PAID\) KWD100\.000 3 orders/i.test(await text(t.page)), 'Overview shows the first numbers')
  const l0 = t.loads
  t.S.stats.paid_count = 9; t.S.stats.paid_revenue = 500
  const ok = await until(async () => /KWD500\.000 9 orders/i.test(await text(t.page)), 8000)
  is(ok, 'the new numbers appear by themselves (a changed server value, no click)')
  is(t.loads === l0 + 1 && (await cur(t.page)) === 'Overview', 'one in-place reload, and the same screen is back', `loads ${t.loads - l0}, screen ${await cur(t.page)}`)
  await sleep(2500)
  is(t.loads === l0 + 1, 'and then it stays quiet (no loop)', `loads ${t.loads - l0}`)
  is(/^\/backends(\?tab=overview)?$/.test(new URL(t.page.url()).pathname + new URL(t.page.url()).search), 'the address still names the screen (the admin reopens it from there)', t.page.url())
  is(t.errs.length === 0, 'no page errors', t.errs.join(' | '))
  await t.close()
}

// ===================================================================================================== 2. a screen with a button
head('Orders: its own Refresh button, no reload')
{
  const t = await start()
  await nav(t.page, 'Orders'); await t.page.waitForSelector('[aria-label="Open order SPX00001"]'); await sleep(900)
  // choose a filter first: it must survive the refresh
  await t.page.evaluate(() => [...document.querySelectorAll('.admin-page button[aria-pressed]')].find((b) => b.textContent.trim() === 'Paid').click()); await sleep(600)
  const l0 = t.loads, from = Date.now()
  t.S.orders = [ORDER('SPX00002', 'Sara'), ...t.S.orders]
  const ok = await until(() => t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00002"]')), 8000)
  is(ok, 'a new order shows by itself')
  is(t.loads === l0 && (await cur(t.page)) === 'Orders', 'with no page reload, still on Orders', `loads ${t.loads - l0}`)
  is(await t.page.evaluate(() => [...document.querySelectorAll('.admin-page button[aria-pressed="true"]')].some((b) => b.textContent.trim() === 'Paid')), 'the Paid filter you chose is still on')
  is(!t.S.calls.some((c) => c.at >= from && /^(brands|topbar_settings|slides|discounts)$/.test(c.r)), 'no other screen was visited to do it')
  // a second order that lands while the first refresh is still settling must not be taken as "seen" (it was, by a first version: measured)
  t.S.orders = [ORDER('SPX00006', 'Mona'), ...t.S.orders]
  is(await until(() => t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00006"]')), 8000), 'an order that arrives right after a refresh is not lost')
  // leave, let the data change, come back: brought up to date at once
  await nav(t.page, 'Overview'); await sleep(500)
  t.S.orders = [ORDER('SPX00003', 'Noor'), ...t.S.orders]
  await sleep(300); await nav(t.page, 'Orders')
  is(await until(() => t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00003"]')), 5000), 'a screen opened again after the data changed while you were away is up to date within seconds')
  is(t.errs.length === 0, 'no page errors', t.errs.join(' | '))
  await t.close()
}

// ===================================================================================================== 3. never under your hands
head('never while you edit')
{
  const t = await start()
  await nav(t.page, 'Orders'); await t.page.waitForSelector('[aria-label="Open order SPX00001"]'); await sleep(900)
  // a field with focus
  is(await focusBox(t.page), 'a box on the Orders screen has the caret')
  t.S.orders = [ORDER('SPX00004', 'Huda'), ...t.S.orders]
  await sleep(TIMING.every * 4)
  is(!(await t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00004"]'))), 'with a field focused the list is NOT refreshed under you')
  const c = await chip(t.page)
  is(c && c.state === 'fresh' && c.apply, 'the chip says there is new data and offers the button', JSON.stringify(c))
  await t.page.evaluate(() => document.activeElement.blur())
  is(await until(() => t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00004"]')), 8000), 'when the field is left alone it refreshes by itself')
  // a dialog
  t.S.orders = [ORDER('SPX00005', 'Layla'), ...t.S.orders]
  await t.page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.id = 'fake-dialog'; d.style.cssText = 'position:fixed;top:10px;left:10px;width:200px;height:100px;background:#fff;z-index:50'; d.textContent = 'dialog'; document.body.appendChild(d) })
  await sleep(TIMING.every * 4)
  is(!(await t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00005"]'))), 'with a dialog open nothing is refreshed')
  await t.page.evaluate(() => document.getElementById('fake-dialog').remove())
  is(await until(() => t.page.evaluate(() => !!document.querySelector('[aria-label="Open order SPX00005"]')), 8000), 'and it catches up when the dialog closes')
  is(t.errs.length === 0, 'no page errors', t.errs.join(' | '))
  await t.close()
}
{
  const t = await start()
  await nav(t.page, 'Brands'); await until(async () => (await cur(t.page)) === 'Brands'); await sleep(1500)
  const l0 = t.loads
  t.S.brands = [{ slug: 'ahed', name_en: 'AHED', name_ar: 'أحد', has_logo: 0, active: true, sort_order: 1, logo_v: 'x' }]
  await sleep(TIMING.every * 4)
  const c = await chip(t.page)
  is(t.loads === l0 && c && c.state === 'fresh' && c.apply && /unsaved/.test(c.applyText), 'an editor screen (Brands) is NOT refreshed under you: a "New data" chip with a warning button appears', JSON.stringify(c))
  await t.page.click('[data-sal="apply"]')
  is(await until(async () => t.loads === l0 + 1 && (await cur(t.page)) === 'Brands', 8000), 'pressing it reloads in place and comes back to the same screen')
  is(await until(async () => /AHED/.test(await text(t.page)), 4000), 'with the new data on it')
  await t.close()
}

// ===================================================================================================== 4. what counts as a change
head('what counts as a change')
{
  const t = await start(); t.S.volatile = true
  await sleep(500); const l0 = t.loads
  await sleep(TIMING.every * 6)
  is(t.loads === l0 && (await chip(t.page)).state === 'live', 'a key that changes every call ("now") is not a change: no reload, the chip stays Live', `loads ${t.loads - l0}`)
  await t.close()
}
{
  const t = await start(); t.S.counter = true
  await sleep(500); const l0 = t.loads
  await sleep(TIMING.every * 10 + 4000)
  is(t.loads - l0 <= 2, 'a value that changes on every read never reloads the page more than twice', `loads ${t.loads - l0}`)
  const before = t.S.calls.filter((c) => c.r === 'stats').length; await sleep(TIMING.every * 4)
  const after = t.S.calls.filter((c) => c.r === 'stats').length
  is(after - before <= 1, 'and it is given up after three times (no longer polled)', `${after - before} more polls`)
  await t.close()
}

// ===================================================================================================== 5. what is polled
head('what is polled')
{
  const t = await start()
  const from = Date.now(); await sleep(TIMING.every * 5)
  const polls = ADMIN_GETS(t.S, from)
  is(polls.length > 0 && polls.every((c) => c.m === 'GET' && c.hdr === '1'), 'only GETs, with the admin header', JSON.stringify(polls.map((c) => c.m + c.hdr).slice(0, 3)))
  is(!t.S.calls.some((c) => c.m !== 'GET'), 'nothing is written (no POST)')
  const perRound = polls.filter((c) => c.at - polls[0].at < 300).length
  is(perRound <= 4, 'at most four reads per round', String(perRound))
  is(!polls.some((c) => /^(me|google_available)$/.test(c.r)), 'never the session routes')
  await nav(t.page, 'Settings'); await sleep(1500)
  const f0 = Date.now(); await sleep(TIMING.every * 4)
  is(!ADMIN_GETS(t.S, f0).some((c) => /^(google_status|mfa_status|passcode_info|assistant_settings)$/.test(c.r)), 'the Settings screen’s session and assistant reads are never repeated')
  await t.close()
}
{
  const t = await start(); await sleep(800)
  await t.page.click('[data-sal="toggle"]'); await sleep(300)
  const f0 = Date.now(); await sleep(TIMING.every * 4)
  is(ADMIN_GETS(t.S, f0).length === 0, 'Pause: nothing is polled')
  is((await chip(t.page)).state === 'paused' && (await chip(t.page)).toggle === 'Resume', 'the chip says Paused and offers Resume')
  await t.page.reload(); await t.page.waitForSelector('[data-sal="chip"]'); await sleep(1500)
  is((await chip(t.page)).state === 'paused', 'Pause is remembered across a reload')
  await t.page.click('[data-sal="toggle"]'); const f1 = Date.now(); await sleep(TIMING.every * 3)
  is(ADMIN_GETS(t.S, f1).length > 0 && (await chip(t.page)).state === 'live', 'Resume polls again')
  // a hidden tab
  await t.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }) }); const f2 = Date.now(); await sleep(TIMING.every * 3)
  is(ADMIN_GETS(t.S, f2).length === 0, 'a hidden tab polls nothing')
  await t.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }); const f3 = Date.now(); await sleep(TIMING.every * 2)
  is(ADMIN_GETS(t.S, f3).length > 0, 'and it checks again as soon as the tab is back')
  await t.close()
}

// ===================================================================================================== 6. failures, the chip
head('failures and the chip')
{
  const t = await start()
  t.S.fault.stats = 401; await sleep(TIMING.every * 4)
  is(t.errs.length === 0 && (await cur(t.page)) === 'Overview', 'a 401 on a poll breaks nothing')
  t.S.fault = {}; t.S.abort = true; await sleep(TIMING.every * 4)
  is((await chip(t.page)).state === 'offline' && /offline/.test((await chip(t.page)).text), 'a network failure: the chip says offline')
  t.S.abort = false; await sleep(TIMING.every * 4)
  is((await chip(t.page)).state === 'live' && /checked \d/.test((await chip(t.page)).text), 'and it is Live again with the time of the check', (await chip(t.page)).text)
  is((await chip(t.page)).h.filter((h) => h > 0).every((h) => h >= 44), 'the chip’s visible buttons are 44 px tall', JSON.stringify((await chip(t.page)).h))
  is(t.errs.length === 0, 'no page errors', t.errs.join(' | '))
  await t.close()
}
{
  const t = await start({ lang: 'ar' })
  const c = await chip(t.page)
  is(c && c.dir === 'rtl' && /مباشر/.test(c.text) && c.toggle === 'إيقاف', 'Arabic: right to left, "مباشر", "إيقاف"', JSON.stringify(c))
  await t.close()
}
{
  const t = await start({ w: 390 })
  const m = await t.page.evaluate(() => { const c = document.querySelector('[data-sal="chip"]').getBoundingClientRect(); return { l: c.left, r: c.right, w: innerWidth, sw: document.documentElement.scrollWidth - document.documentElement.clientWidth } })
  is(m.l >= 0 && m.r <= m.w && m.sw <= 0, 'on a phone the chip fits the screen and adds no sideways scroll', JSON.stringify(m))
  await t.close()
}

// ===================================================================================================== 7. held back, and a late start
const BRAND = [{ slug: 'a', name_en: 'A', name_ar: 'ا', has_logo: 0, active: true, sort_order: 1, logo_v: 'x' }]
const rowShown = (t, id) => t.page.evaluate((x) => !!document.querySelector(`[aria-label="Open order ${x}"]`), id)
const toOrders = async (t) => { await nav(t.page, 'Orders'); await t.page.waitForSelector('[aria-label="Open order SPX00001"]'); await sleep(900) }
const gets = (t, from, re) => ADMIN_GETS(t.S, from).filter((c) => re.test(c.r)).length
// the checks behind the headings below are also the mutation checks (a check that passes on the real file and fails with its rule cut)
const CHECK = {
  // a progress panel (the bulk photo uploader is an inline panel, not a dialog) holds every automatic refresh
  busy: async (t) => {
    await toOrders(t)
    await t.page.evaluate(() => { const d = document.createElement('div'); d.id = 'fake-busy'; d.setAttribute('aria-busy', 'true'); document.body.appendChild(d) })
    t.S.orders = [ORDER('SPX00011', 'Busy'), ...t.S.orders]
    await sleep(TIMING.every * 4)
    const held = !(await rowShown(t, 'SPX00011'))
    await t.page.evaluate(() => document.getElementById('fake-busy').remove())
    return { held, caught: await until(() => rowShown(t, 'SPX00011'), 8000) }
  },
  // an upload or a save (any write) holds every automatic refresh until it has settled and a while has passed
  write: async (t) => {
    await toOrders(t)
    await t.page.evaluate(() => fetch('/api/admin.php?r=save_something', { method: 'POST', credentials: 'include', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.text()))
    t.S.orders = [ORDER('SPX00012', 'Writer'), ...t.S.orders]
    await sleep(1800)
    const held = !(await rowShown(t, 'SPX00012'))
    return { held, caught: await until(() => rowShown(t, 'SPX00012'), 9000) }
  },
  // a tab nobody has touched for a long time stops polling, and a touch brings it back
  idle: async (t) => {
    await sleep(3500)
    const f0 = Date.now(); await sleep(TIMING.every * 4)
    const quiet = gets(t, f0, /./) === 0
    await t.page.evaluate(() => document.dispatchEvent(new Event('keydown')))
    const f1 = Date.now(); await sleep(TIMING.every * 3)
    return { quiet, back: gets(t, f1, /./) > 0 }
  },
  // the first reads happened before the add-on was there (a late start): the screen is still watched, from the browser's own record of them
  late: async (t) => {
    const l0 = t.loads
    t.S.stats.paid_count = 9; t.S.stats.paid_revenue = 500
    const seen = await until(async () => /KWD500\.000 9 orders/i.test(await text(t.page)), 9000)
    // the page's load event waits for the delayed add-on too, so it is counted a little after the numbers are on the screen
    await sleep(3500)
    return { seen, once: t.loads === l0 + 1 }
  },
  // the stock list carries costs and quantities: never copied and never read again in the background
  stock: async (t) => {
    await nav(t.page, 'Inventory'); await until(async () => (await cur(t.page)) === 'Inventory'); await sleep(1500)
    const f0 = Date.now(); await sleep(TIMING.every * 5)
    return { quiet: gets(t, f0, /^(variants|inventory_finance|ahed_cost)$/) === 0 }
  },
}
head('a progress panel or a save in progress holds the refresh')
{
  const t = await start()
  const r = await CHECK.busy(t)
  is(r.held, 'a progress panel (aria-busy) holds the refresh: the new order is not shown')
  is(r.caught, 'and it catches up once the panel is gone')
  is(t.errs.length === 0, 'no page errors', t.errs.join(' | '))
  await t.close()
}
{
  const t = await start()
  const r = await CHECK.write(t)
  is(r.held, 'a save (a POST) in flight and just finished holds the refresh for the quiet period')
  is(r.caught, 'and it catches up afterwards')
  await t.close()
}
head('a forgotten tab stops polling')
{
  const t = await start({ timing: { idle: 2500 } })
  const r = await CHECK.idle(t)
  is(r.quiet, 'after the idle time nothing is polled any more')
  is(r.back, 'and a key press or a click brings the polling back')
  await t.close()
}
head('the add-on arrives after the screen has already read')
{
  const t = await start({ delayJs: 1400 })
  is(/REVENUE \(PAID\) KWD100\.000 3 orders/i.test(await text(t.page)), 'Overview shows the first numbers')
  is(!!(await chip(t.page)), 'the chip is there (the add-on did load, late)')
  const r = await CHECK.late(t)
  is(r.seen, 'a change is still seen: the reads that came before the add-on are taken from the browser’s own record')
  is(r.once, 'with one in-place reload')
  await t.close()
}
head('the stock list is not watched')
{
  const t = await start()
  const r = await CHECK.stock(t)
  is(r.quiet, 'Inventory: the stock list, its finance read and the cost routes are never polled')
  await t.close()
}

// ===================================================================================================== 8. mutations
head('mutations: with one rule cut, the matching check fails')
// each check answers "does the screen behave as it should?": it must say yes on the real file and no on the file with one rule cut
const MUT = [
  ['without the focus guard', SRC.replace("applying || editing() || fieldFocused() || dialogOpen()) return false", "applying || editing() || dialogOpen()) return false"),
    async (t) => { await toOrders(t); if (!(await focusBox(t.page))) return null; t.S.orders = [ORDER('SPX00009', 'Z'), ...t.S.orders]; await sleep(TIMING.every * 4); return !(await rowShown(t, 'SPX00009')) }],
  ['with every screen treated as a list', SRC.replace("var AUTO = /^(overview|orders|abandoned orders|returns?( requests?)?|crm|support( tickets?)?|activity( log)?|catalogue|الطلبات المتروكة)$/i", "var AUTO = /^/"),
    async (t) => { await nav(t.page, 'Brands'); await until(async () => (await cur(t.page)) === 'Brands'); await sleep(1500); const l0 = t.loads; t.S.brands = BRAND; await sleep(TIMING.every * 4); return t.loads === l0 }],
  ['without the volatile-key filter', SRC.replace("if (!VOLATILE.test(k)) o[k] = strip(v[k])", "o[k] = strip(v[k])"),
    async (t) => { t.S.volatile = true; await sleep(500); const l0 = t.loads; await sleep(TIMING.every * 6); return t.loads === l0 }],
  ['counting a waiting change again on every check', SRC.replace("if (prev === s2) return ", "if (false) return "),
    async (t) => { await toOrders(t); if (!(await focusBox(t.page))) return null; t.S.orders = [ORDER('SPX00008', 'Y'), ...t.S.orders]; await sleep(TIMING.every * 7); await t.page.evaluate(() => document.activeElement.blur()); return await until(() => rowShown(t, 'SPX00008'), 4000) }],
  ['counting dates and drop-downs as an edit in progress', SRC.replace("'.admin-page input, .admin-page textarea'), function (e) {", "'.admin-page input, .admin-page textarea, .admin-page select'), function (e) {").replace("if (/^(search|hidden|checkbox|radio|button|submit|reset|date|datetime-local|month|time|week|range|color|file|image)$/.test(e.type) || !shown(e)) return", "if (/^(search|hidden|checkbox|radio|button|submit)$/.test(e.type) || !shown(e)) return"),
    async (t) => { await toOrders(t); t.S.orders = [ORDER('SPX00007', 'X'), ...t.S.orders]; return await until(() => rowShown(t, 'SPX00007'), 6000) }],
  ['without the reload limit', SRC.replace("return a.length < 2 } catch (e) { return false }", "return true } catch (e) { return false }"),
    async (t) => { t.S.counter = true; await sleep(500); const l0 = t.loads; await sleep(TIMING.every * 12 + 5000); return t.loads - l0 <= 2 }],
  ['without the progress-panel hold', SRC.replace("|| document.querySelector('[aria-busy=\"true\"]')) return false", ") return false"),
    async (t) => { const r = await CHECK.busy(t); return r.held && r.caught }],
  ['without the write-in-flight hold', SRC.replace("if (pending > 0 || Date.now() - lastWrite < WRITEQUIET", "if (false"),
    async (t) => { const r = await CHECK.write(t); return r.held && r.caught }],
  ['without the idle stop', SRC.replace("if (!force && Date.now() - lastAct > IDLE) return", ""),
    async (t) => { const r = await CHECK.idle(t); return r.quiet && r.back }, { timing: { idle: 2500 } }],
  ['without the baseline taken from the browser\u2019s record', SRC.replace("if (!seeds.length && seedAt) { seedList(); seedAt = 0 }", ""),
    async (t) => { const r = await CHECK.late(t); return r.seen && r.once }, { delayJs: 1400 }],
  ['with the stock routes polled', SRC.replace("stock|variants|ahed|cost)", "stock)"),
    async (t) => (await CHECK.stock(t)).quiet],
]
for (const [label, text, check, opts = {}] of MUT) {
  if (text === SRC) { is(false, `mutation "${label}": the cut text was found`); continue }
  const run = async (js) => { const t = await start({ js, ...opts }); try { return await check(t) } catch (e) { return 'threw ' + String(e.message).slice(0, 80) } finally { await t.close() } }
  const good = await run(SRC), bad = await run(text)
  is(good === true, `mutation "${label}": the check passes on the real file`, String(good))
  is(bad === false, `mutation "${label}": and goes red with the rule cut`, String(bad))
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
