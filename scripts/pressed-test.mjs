/**
 * test:pressed — a pressed box answers the press, on a mouse AND on a touch phone, 2026-10-07.
 *
 * css/82-pressed.css: the solid buttons, outline buttons, home tiles, returns box, size boxes and colour
 * circles sink and darken while pressed; the product photo darkens. Each is pressed with a real mouse
 * button held down (that sets :active in a desktop AND in a touch-emulating context) and its computed
 * style compared with the style a moment before, measured, never typed from the stylesheet.
 *
 *   - while pressed: transform is smaller/lower or the filter is darker, or the fill changes
 *   - on release it settles back to what it was
 *   - a disabled (sold-out) size box does not react
 *   - reduced motion: no transform, but the fill/filter still changes
 *
 * MUTATE=1 empties the shared stylesheets (must fail).
 */
import { chromium, devices } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const MUT = process.env.MUTATE === '1'
const snap = (el) => el.evaluate((e) => { const s = getComputedStyle(e); return { t: s.transform, filter: s.filter, bg: s.backgroundColor, shadow: s.boxShadow } })
const mat = (t) => { if (t === 'none') return { s: 1, y: 0 }; const m = /matrix\(([^)]+)\)/.exec(t); if (!m) return { s: 1, y: 0 }; const v = m[1].split(',').map(parseFloat); return { s: v[0], y: v[5] } }
const CASES = [
  ['solid button', '/', 'main .btn.btn-primary'],
  ['cart Shop link', '/cart', 'main a.rounded-full.bg-brand'],
  ['home tile', '/', '.cat-tile'],
  ['size box', '/shop', 'main article .cardopt-size:not(:disabled)'],
  ['colour circle', '/shop', 'main article .cardopt-colour'],
  ['product photo', '/shop', 'main article > a[class*="aspect-"]'],
  ['returns request box', '/returns', 'a[data-sporta="returns-request"]'],
  ['/card button', '/card', '#go'],
]
async function press(p, sel) {
  const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await p.mouse.move(0, 0); await p.waitForTimeout(250)
  const before = await snap(el); const box = await el.boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(350)
  const hovered = await snap(el)
  await p.mouse.down(); await p.waitForTimeout(250); const down = await snap(el)
  await p.mouse.move(0, 0); await p.mouse.up(); await p.waitForTimeout(450); const rested = await snap(el)   // released OFF the box, as a drag-away: a link would otherwise navigate on release
  return { before, hovered, down, rested }
}
for (const [label, opts, extra] of [['mouse', { viewport: { width: 1280, height: 900 } }, {}], ['touch phone', devices['Pixel 7'], {}], ['reduced motion', { viewport: { width: 1280, height: 900 } }, { reducedMotion: 'reduce' }]]) {
  const c = await b.newContext({ ...opts, ...extra }); await c.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch (e) {} })
  if (MUT) await c.route('**/assets/sporta-{ui,desktop,mobile}.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  const p = await c.newPage()
  for (const [name, path, sel] of CASES.filter((c) => !process.env.ONLY || c[0].includes(process.env.ONLY))) {
    if (label === 'reduced motion' && !/size box|home tile/.test(name)) continue
    // a click on a link would navigate on mouse-up: block it so the page stays put
    await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
    await p.addStyleTag({ content: '*{scroll-behavior:auto!important}' })
    await p.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a, form, button')) { e.preventDefault(); e.stopImmediatePropagation() } }, true))
    if (!(await p.locator(sel).count())) { check(false, `[${label}] ${name}: found on ${path}`); continue }
    const r = await press(p, sel)
    const h = mat(r.hovered.t), d = mat(r.down.t)
    const sank = d.s < h.s - 0.005 || d.y > h.y + 0.4
    const darker = r.down.filter !== r.hovered.filter || r.down.bg !== r.hovered.bg || r.down.shadow !== r.hovered.shadow
    const ok = label === 'reduced motion' ? (d.s === 1 && d.y === 0 && darker) : (sank || darker)
    check(ok, `[${label}] ${name} answers the press`, `scale ${h.s}->${d.s} y ${h.y}->${d.y} filter ${r.down.filter} darker:${darker}`)
    check(mat(r.rested.t).s === mat(r.before.t).s && mat(r.rested.t).y === mat(r.before.t).y && r.rested.filter === r.before.filter, `[${label}] ${name} settles back after the release`)
  }
  if (label === 'mouse') {
    await p.goto(BASE + '/shop', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
    if (await p.locator('main article .cardopt-size:disabled').count()) { const r = await press(p, 'main article .cardopt-size:disabled'); check(mat(r.down.t).s === mat(r.hovered.t).s, '[mouse] a sold-out size box does not react to a press') }
    else console.log('note  no sold-out size box in the sandbox to try')
  }
  await c.close()
}
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — pressed boxes answer the press, mouse and finger')
process.exit(fails ? 1 : 0)
