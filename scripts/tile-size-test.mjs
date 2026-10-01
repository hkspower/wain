/** Category tiles show their art whole: 40% taller than before from 768px, and on a PHONE one square tile per
 *  row since 2026-10-01 ("single full row, square shape, full render", the owner's request of that day, which
 *  replaced the phone half of the 40% one). node scripts/tile-size-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
// Before 2026-10-01 the box ratios were 900/570 (phone) and 1216/706 (768px up).
const WAS = { phone: 900 / 570, desktop: 1216 / 706 }
for (const [name, vp, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  for (const lang of ['en', 'ar']) {
    const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
    await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(2500)
    const tiles = await p.evaluate(async () => {
      const out = []
      for (const t of document.querySelectorAll('.cat-tile')) {
        t.scrollIntoView(); await new Promise((r) => setTimeout(r, 250))
        const r = t.getBoundingClientRect(); const i = t.querySelector('img')
        out.push({ k: t.className.match(/tile-\w+/)[0], w: r.width, h: r.height, top: r.top + scrollY, page: document.documentElement.clientWidth, nw: i && i.naturalWidth, nh: i && i.naturalHeight })
      }
      return out
    })
    check(tiles.length === 4, `${name} ${lang}: four tiles`)
    for (const t of tiles) {
      const box = t.w / t.h, art = t.nw / t.nh
      check(Math.abs(box - art) / art < 0.01, `${name} ${lang} ${t.k}: the whole picture shows, nothing cropped`, `box ${box.toFixed(3)} art ${art.toFixed(3)} (${t.nw}x${t.nh})`)
      if (name === 'phone') {
        check(Math.abs(box - 1) < 0.01, `${name} ${lang} ${t.k}: square`, `box ${box.toFixed(3)}`)
        check(t.w >= t.page - 1, `${name} ${lang} ${t.k}: the full row, edge to edge`, `${Math.round(t.w)} of ${t.page}px`)
      } else {
        const grew = WAS[name] / box
        check(grew > 1.38 && grew < 1.42, `${name} ${lang} ${t.k}: 40% taller than the old box`, `x${grew.toFixed(3)}`)
      }
    }
    if (name === 'phone') {
      const rows = new Set(tiles.map((t) => Math.round(t.top)))
      check(rows.size === 4, `${name} ${lang}: one tile per row (four rows)`, `${rows.size} rows`)
    }
    await p.context().close()
  }
}
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
