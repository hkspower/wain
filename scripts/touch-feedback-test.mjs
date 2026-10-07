/**
 * test:touch-feedback — every control answers the moment a finger lands (css/84-touch.css,
 * assets/touch-feedback.js).
 *
 *   - a finger held on a button, a header icon, a menu link and a product card shows a pressed look
 *     BEFORE it lifts (read from the computed style while the touch is down, through CDP touch events)
 *   - the pressed look never uses transform, so nothing moves under the finger
 *   - no grey tap flash, and touch-action: manipulation (no double-tap-zoom wait) on every control
 *   - the page carries a touch listener (what iPhone Safari needs before it applies :active at all)
 *   - with a mouse nothing changes (the press rules are for touch screens only)
 *
 * Run `bash scripts/sandbox.sh` first. MUTATE=1 blocks the stylesheet's rules (empties 84-) and must fail.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function page(touch, path = '/shop') {
  const ctx = await browser.newContext(touch ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lang', 'en') } catch (e) {}
    const add = EventTarget.prototype.addEventListener
    window.__touchListeners = 0
    EventTarget.prototype.addEventListener = function (t) { if (t === 'touchstart' && (this === document || this === window)) window.__touchListeners++; return add.apply(this, arguments) }
  })
  if (process.env.MUTATE === '1') await ctx.route('**/assets/touch-feedback.js', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }))
  const p = await ctx.newPage()
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  if (process.env.MUTATE === '1') await p.addStyleTag({ content: '*{-webkit-tap-highlight-color:rgba(0,0,0,.18)!important;touch-action:auto!important;filter:none!important;opacity:1!important}' })
  await p.waitForTimeout(1200)
  return { ctx, p }
}

async function pressed(p, cdp, sel) {
  const el = p.locator(sel).first()
  if (!(await el.count())) return null
  await el.scrollIntoViewIfNeeded()
  const before = await el.evaluate((e) => { const c = getComputedStyle(e); return { f: c.filter, o: c.opacity, t: c.transform } })
  const b = await el.boundingBox()
  const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] })
  await p.waitForTimeout(30)   // one frame: the look must be there at once, not once the browser decides
  const during = await el.evaluate((e) => { const c = getComputedStyle(e); return { f: c.filter, o: c.opacity, t: c.transform } })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await p.waitForTimeout(80)
  return { before, during }
}

try {
  const { ctx, p } = await page(true)
  const cdp = await ctx.newCDPSession(p)
  check(await p.evaluate(() => window.__touchListeners) >= 1, 'the page listens for touches (what iPhone Safari needs to show :active)')
  for (const [sel, what] of [
    ['header.app-header button[aria-label^="Bag"]', 'the bag button'],
    ['[data-cua-btn]', 'the account button'],
    ['header.app-header a[href^="/men"]', 'a menu link'],
    ['.cardopt-size:not([disabled])', 'a card size box'],
    ['[data-cardopt-grid] a[href^="/product/"]', 'a product card'],
  ]) {
    const r = await pressed(p, cdp, sel)
    if (!r) { check(false, `${what}: found on /shop`); continue }
    const changed = r.during.f !== r.before.f || r.during.o !== r.before.o
    if (/card/.test(what)) check(r.during.o === '1', `${what}: a picture darkens rather than fades`, r.during.o)
    check(changed, `${what}: looks pressed while the finger is down`, `filter ${r.before.f} -> ${r.during.f}, opacity ${r.before.o} -> ${r.during.o}`)
    check(r.during.t === r.before.t, `${what}: nothing moves under the finger (no transform change)`, `${r.before.t} -> ${r.during.t}`)
  }
  // a finger that slides (a scroll) drops the pressed look
  {
    const el = p.locator('.cardopt-size:not([disabled])').nth(1); await el.scrollIntoViewIfNeeded()
    const b = await el.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 40 }] })
    await p.waitForTimeout(60)
    const still = await el.evaluate((e) => e.hasAttribute('data-pressing'))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    check(!still, 'a finger that slides to scroll is not left showing a press')
  }
  const bad = await p.evaluate(() => {
    const out = []
    for (const e of document.querySelectorAll('a, button, [role=button], select')) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue
      const c = getComputedStyle(e)
      if (c.webkitTapHighlightColor !== 'rgba(0, 0, 0, 0)' || !/manipulation|none|pan/.test(c.touchAction)) out.push((e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30) + ' ' + c.webkitTapHighlightColor + ' ' + c.touchAction)
    }
    return out
  })
  check(bad.length === 0, 'no grey tap flash and no double-tap wait on any visible control', bad.slice(0, 4).join(' | '))
  await ctx.close()

  const desk = await page(false)
  const dcdp = await desk.ctx.newCDPSession(desk.p)
  const btn = desk.p.locator('header.app-header button[aria-label^="Bag"]').first()
  const b = await btn.boundingBox()
  await dcdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + 5, y: b.y + 5 })   // hovered first: the hover look is 81-hover's, not this
  await desk.p.waitForTimeout(300)
  const f0 = await btn.evaluate((e) => getComputedStyle(e).filter)
  await dcdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x + 5, y: b.y + 5, button: 'left', clickCount: 1 })
  const f1 = await btn.evaluate((e) => getComputedStyle(e).filter)
  await dcdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x + 5, y: b.y + 5, button: 'left', clickCount: 1 })
  check(f1 !== 'brightness(0.86)' && f0 === 'none', 'with a mouse the touch press look does not apply (its own pressed style is 82-pressed\'s)', `${f0} -> ${f1}`)
  await desk.ctx.close()
} finally {
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — every control answers the moment a finger lands')
process.exit(fails ? 1 : 0)
