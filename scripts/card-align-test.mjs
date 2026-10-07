/**
 * test:card-align — colours and sizes on the product card line up with the name, 2026-10-07.
 *
 * Measured faults this holds shut: the card's own ring (the outermost mark of the colour row) stuck out
 * 3.4px left of the name and the size boxes, and size boxes were as wide as their label so S M L XL never
 * formed columns from one card to the next. Expected edges come from the NAME's own box and from the other
 * boxes on the page, never from numbers typed here. Phone and desktop, English and Arabic (the caption is
 * left-to-right in both, so the same edge applies).
 *
 * MUTATE=1 blocks sporta-ui.css's fix by restoring the old margin and widths in the page (must fail).
 */
import { chromium, devices } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [name, opts] of [['phone', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
  for (const lang of ['en', 'ar']) {
    const c = await b.newContext(opts)
    await c.addInitScript((l) => localStorage.setItem('lang', l), lang)
    const p = await c.newPage()
    await p.goto(`${BASE}/shop`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
    if (process.env.MUTATE === '1') await p.addStyleTag({ content: '.cardopt-colours{margin-left:-4px!important}.cardopt-size{min-width:28px!important;padding:0 5px!important}' })
    await p.waitForTimeout(300)
    const m = await p.evaluate(() => {
      const arts = [...document.querySelectorAll('[data-cardopt-grid] > article')]
      const rows = [], widths = []
      for (const a of arts) {
        const h = a.querySelector('h3'); if (!h) continue
        const hl = h.getBoundingClientRect().left
        const sel = a.querySelector('.cardopt-colour')   // the FIRST circle: the row's outermost mark when it is the card's own ringed one
        const sizes = [...a.querySelectorAll('.cardopt-size')]
        // a drawn ring sits 0.6px inside its 24px slot (radius 11.4 of 12)
        if (sel) rows.push({ kind: 'ring', d: +(sel.getBoundingClientRect().left + 0.6 - hl).toFixed(2) })
        if (sizes[0]) rows.push({ kind: 'box', d: +(sizes[0].getBoundingClientRect().left - hl).toFixed(2) })
        sizes.forEach((s) => widths.push(+s.getBoundingClientRect().width.toFixed(2)))
      }
      return { rows, widths: [...new Set(widths)], n: arts.length }
    })
    const tag = `[${name} ${lang}]`
    check(m.rows.some((r) => r.kind === 'ring') && m.rows.some((r) => r.kind === 'box'), `${tag} the page has cards with colours and with sizes to measure`, `${m.rows.length} rows over ${m.n} cards`)
    const ring = m.rows.filter((r) => r.kind === 'ring'), box = m.rows.filter((r) => r.kind === 'box')
    check(ring.every((r) => Math.abs(r.d) <= 0.5), `${tag} the first colour circle's outer edge (its ring) starts flush with the name`, `offsets ${[...new Set(ring.map((r) => r.d))].join(',')}`)
    check(box.every((r) => Math.abs(r.d) <= 0.5), `${tag} the first size box starts flush with the name`, `offsets ${[...new Set(box.map((r) => r.d))].join(',')}`)
    check(m.widths.length === 1, `${tag} every size box is one width, on every card`, `widths ${m.widths.join(',')}`)
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} the page does not scroll sideways`)
    await c.close()
  }
}
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — colours and sizes line up with the name')
process.exit(fails ? 1 : 0)
