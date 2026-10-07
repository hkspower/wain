/**
 * test:hover — the clickable boxes answer a mouse, and only a mouse, 2026-10-07.
 *
 * css/81-hover.css: lift + orange edge on the home tiles, the returns request box, the size boxes (1px),
 * the colour circles (a faint ring), solid buttons (1px + brighten) and outline buttons (orange edge); the
 * standalone /card and /returns/request pages get the button hover in their own styles. Each kind is
 * HOVERED with a real mouse and its computed style read before and after; nothing is compared with a
 * number typed from the stylesheet except the direction (up, orange).
 *
 *   - desktop mouse: each box rises (negative translateY) and/or its edge/ring/filter changes
 *   - a touch phone (no hover capability): the same elements do NOT change, so nothing sticks after a tap
 *   - reduced motion: nothing moves (transform stays none) but the edge/shadow still changes
 *   - sold-out size boxes (disabled) do not react
 *
 * MUTATE=1 removes the stylesheet's rules from the page (must fail).
 */
import { chromium, devices } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

const snap = (el) => el.evaluate((e) => { const s = getComputedStyle(e); return { t: s.transform, shadow: s.boxShadow, border: s.borderTopColor, bgimg: s.backgroundImage, filter: s.filter } })
const ty = (t) => { if (t === 'none') return 0; const m = /matrix\(([^)]+)\)/.exec(t); return m ? parseFloat(m[1].split(',')[5]) : 0 }
const MUT = process.env.MUTATE === '1'

async function page(opts, lang, extra = {}) {
  const c = await b.newContext({ ...opts, ...extra }); await c.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (MUT) await c.route('**/assets/sporta-{ui,desktop,mobile}.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  return { c, p: await c.newPage() }
}
async function go(p, path) { await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1300) }
async function hov(p, sel, nth = 0) {
  const el = p.locator(sel).nth(nth); await el.scrollIntoViewIfNeeded(); await p.mouse.move(0, 0); await p.waitForTimeout(250)
  const before = await snap(el); await el.hover(); await p.waitForTimeout(450); const after = await snap(el); await p.mouse.move(0, 0); await p.waitForTimeout(250)
  return { before, after, rested: await snap(el) }
}
const CASES = [
  ['home tile', '/', '.cat-tile', 'lift'],
  ['size box', '/shop', 'main article .cardopt-size:not(:disabled)', 'lift'],
  ['colour circle', '/shop', 'main article .cardopt-colour:not([aria-current="true"])', 'ring'],
  ['solid button (.btn-primary)', '/', 'main .btn.btn-primary', 'btn'],
  ['cart Shop link', '/cart', 'main a.rounded-full.bg-brand', 'btn'],
  ['returns request box', '/returns', 'a[data-sporta="returns-request"]', 'lift'],
  ['/card button', '/card', '#go', 'filter'],
  ['/returns/request button', '/returns/request', 'form button[type=submit], button.primary, button:not(.ghost)', 'filter'],
]

// 1) desktop mouse
{
  const { c, p } = await page({ viewport: { width: 1280, height: 900 } }, 'en')
  for (const [name, path, sel, kind] of CASES) {
    await go(p, path)
    if (!(await p.locator(sel).count())) { check(false, `${name}: found on ${path}`); continue }
    const r = await hov(p, sel)
    const moved = ty(r.after.t) < ty(r.before.t) - 0.4
    const edge = r.after.border !== r.before.border || r.after.shadow !== r.before.shadow
    const ring = r.after.bgimg !== r.before.bgimg
    const bright = r.after.filter !== r.before.filter
    const ok = kind === 'lift' ? moved && edge : kind === 'ring' ? ring : kind === 'btn' ? (moved || bright) : bright
    check(ok, `[mouse] ${name} answers the hover`, `ty ${ty(r.before.t)}->${ty(r.after.t)} edge:${edge} ring:${ring} filter:${r.after.filter}`)
    check(ty(r.rested.t) === ty(r.before.t) && r.rested.filter === r.before.filter, `[mouse] ${name} settles back when the mouse leaves`)
  }
  // a sold-out size box does not react
  await go(p, '/shop')
  const dis = p.locator('main article .cardopt-size:disabled')
  if (await dis.count()) { const r = await hov(p, 'main article .cardopt-size:disabled'); check(ty(r.after.t) === ty(r.before.t) && r.after.border === r.before.border, '[mouse] a sold-out size box does not react') }
  else console.log('note  no sold-out size box in the sandbox to try')
  await c.close()
}
// 2) touch phone: no hover capability, nothing changes
{
  const { c, p } = await page(devices['Pixel 7'], 'en')
  for (const [name, path, sel, kind] of CASES.slice(0, 6)) {
    await go(p, path)
    if (!(await p.locator(sel).count())) continue
    const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded()
    const before = await snap(el); await el.dispatchEvent('mouseover'); await p.waitForTimeout(300); const after = await snap(el)
    const hoverCap = await p.evaluate(() => matchMedia('(hover: hover)').matches)
    check(!hoverCap && ty(after.t) === ty(before.t) && after.bgimg === before.bgimg, `[touch] ${name} shows no hover on a phone`, `hover capability ${hoverCap}`)
  }
  await c.close()
}
// 3) reduced motion: no movement, the edge still changes
{
  const { c, p } = await page({ viewport: { width: 1280, height: 900 } }, 'en', { reducedMotion: 'reduce' })
  await go(p, '/'); const r = await hov(p, '.cat-tile')
  check(ty(r.after.t) === 0 && r.after.shadow !== r.before.shadow, '[reduced motion] the tile does not move, but its edge still changes', `ty ${ty(r.after.t)}`)
  await go(p, '/shop'); const s = await hov(p, 'main article .cardopt-size:not(:disabled)')
  check(ty(s.after.t) === 0 && s.after.border !== s.before.border, '[reduced motion] the size box does not move, but its edge still changes')
  await c.close()
}
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the clickable boxes answer a mouse, only a mouse')
process.exit(fails ? 1 : 0)
