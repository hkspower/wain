// MEASURES how smooth the /backends menu is: every sidebar button is pressed in turn on the REAL compiled admin (the live capture, the
// real add-on file), and for each press we record how long the menu takes to show the new screen (click to the frame where the new item is
// current), the longest main-thread task, and the frames that took longer than 50 ms, while the page is busy.
//
//   SPORTA_LIVE_CAPTURE=<dir> node scripts/admin-menu-probe.mjs      (a probe, not a gate: prints numbers, never fails)
//
// It writes nothing to the server: the admin reads are answered by route interception with empty data, the way the live-data suite does it.
import { chromium } from 'playwright'
import { serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
import { LIVE } from './fixtures/admin-products.mjs'

if (!liveDir()) { console.log('SKIP no live capture (set SPORTA_LIVE_CAPTURE)'); process.exit(0) }
const W = Number(process.env.PROBE_WIDTH || 1280)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const srv = await serveLive({ css: { 'assets/AdminApp-Dw3t3z9Z.css': LIVE } })
const ctx = await browser.newContext({ viewport: { width: W, height: 800 } })
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('__fresh')) { localStorage.setItem('lang', 'en'); sessionStorage.setItem('__fresh', '1') } } catch (e) { /* storage may be off */ } })
const page = await ctx.newPage()
// NOLIVE=1 leaves the admin add-on file out (a control): the difference is what the add-ons cost the menu
if (process.env.NOLIVE) await page.route('**/sporta-admin-brands*.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
let loads = 0
page.on('load', () => loads++)
await page.route('**/api/admin.php*', (route) => {
  const r = new URL(route.request().url()).searchParams.get('r')
  const body = r === 'me' ? { email: 'owner@sporta.test' } : r === 'stats' ? { paid_revenue: 0, paid_count: 0 } : []
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})
await page.goto(srv.base + '/backends')
await page.waitForSelector('.admin-sidebar__nav .admin-nav-item', { timeout: 60000 })
await sleep(1500)

// the observers live in the page: long tasks, and every frame's length while a press is running
await page.evaluate(() => {
  window.__lt = []; window.__frames = []; window.__pressing = false
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ d: Math.round(e.duration), t: Math.round(e.startTime) }) }).observe({ type: 'longtask', buffered: false }) } catch (e) { /* no longtask support */ }
  let last = performance.now()
  const tick = (now) => { if (window.__pressing) window.__frames.push(Math.round(now - last)); last = now; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})

// the sign-out button leaves the page: it is not a screen, so it is not pressed
const labels = (await page.$$eval('.admin-sidebar__nav .admin-nav-item', (bs) => bs.filter((b) => b.tagName === 'BUTTON').map((b) => b.textContent.trim()).filter(Boolean))).filter((x) => !/sign|log ?out|خروج/i.test(x) && !/^returns$/i.test(x))   // Returns: its screen reloads the page under this fixture (measured), so it is left out of the timing
const rows = []
for (const label of labels) {
  let res
  try { res = await page.evaluate(async (x) => {
    const btn = [...document.querySelectorAll('.admin-sidebar__nav .admin-nav-item')].find((b) => b.textContent.trim() === x)
    if (!btn || btn.getAttribute('aria-current') === 'page') return null
    window.__lt = []; window.__frames = []; window.__pressing = true
    const t0 = performance.now()
    btn.click()
    let shown = null
    while (performance.now() - t0 < 4000) {
      await new Promise((r) => requestAnimationFrame(() => r()))
      if (btn.getAttribute('aria-current') === 'page') { shown = Math.round(performance.now() - t0); break }
    }
    await new Promise((r) => setTimeout(r, 300))
    window.__pressing = false
    const long = window.__lt.map((e) => e.d)
    return { shownMs: shown, longest: long.length ? Math.max(...long) : 0, longTasks: long.length, slowFrames: window.__frames.filter((f) => f > 50).length }
  }, label) } catch (e) {
    // the press started a full page load (the menu leaves the app): that is the slowest kind of press, so it is reported as such
    const t = Date.now(); await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {})
    res = { shownMs: 'full load ' + (Date.now() - t), longest: 0, longTasks: 0, slowFrames: 0 }
    await page.goto(srv.base + '/backends', { waitUntil: 'commit' }).catch(() => {}); await page.waitForSelector('.admin-sidebar__nav .admin-nav-item', { timeout: 60000 }).catch(() => {})
  }
  if (res) rows.push({ item: label, ...res })
  else if (res === null) { /* already the current screen */ }
}
console.log(`page loads during the presses: ${loads}`)
console.log(`screen, shown after press (ms), longest task (ms), long tasks, frames over 50 ms  @ ${W}px`)
for (const r of rows) console.log(`${r.item.padEnd(22)} ${String(r.shownMs ?? 'never').padStart(6)}  ${String(r.longest).padStart(6)}  ${String(r.longTasks).padStart(4)}  ${String(r.slowFrames).padStart(4)}`)
const ok = rows.filter((r) => r.shownMs != null)
const worst = ok.reduce((a, b) => (b.shownMs > a.shownMs ? b : a), ok[0] || { shownMs: 0, item: '-' })
console.log(`\nPRESSES ${rows.length}, shown ${ok.length}; slowest to show: ${worst.item} ${worst.shownMs} ms`)
await ctx.close(); await srv.close(); await browser.close()
