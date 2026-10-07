/**
 * test:alignment — the alignments the 2026-10-07 scan measured, held (phone and desktop, both
 * languages):
 *
 *   - a page title's icon is centred on the title's LETTERS (/returns): it hung 7px below them,
 *     centred on the box that includes the orange bar's room. Read from the rendered ink.
 *   - the header's logo and icons share one centre line, and so do the five menu links
 *   - the four category tiles put their text block at the same place
 *   - the product page centres its price and its size, fit and colour buttons (owner, 2026-10-07)
 *
 * Run `bash scripts/sandbox.sh` first. MUTATE=1 removes the icon fix and MUTATE=2 the product-page centring; each must fail.
 */
import { chromium, devices } from 'playwright'
import { PNG } from 'pngjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

/** Vertical centre of the dark ink in a column range of a screenshot, in CSS px. */
function inkCentre(png, x0, x1, scale) {
  let top = -1, bot = -1
  for (let y = 0; y < png.height; y++) for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x++) {
    const i = (y * png.width + x) * 4
    if (png.data[i] * 0.3 + png.data[i + 1] * 0.59 + png.data[i + 2] * 0.11 < 90) { if (top < 0) top = y; bot = y; break }
  }
  return top < 0 ? null : (top + bot) / 2 / scale
}

try {
  for (const [dev, opts] of [['phone', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext(opts)
    await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
    const p = await ctx.newPage()
    const tag = `[${dev} ${lang}]`
    const scale = opts.deviceScaleFactor || 1

    // --- the title icon on /returns
    await p.goto(BASE + '/returns', { waitUntil: 'networkidle' })
    if (process.env.MUTATE === '1') await p.addStyleTag({ content: 'main div.flex.items-center > svg{margin-bottom:0!important}' })
    await p.waitForTimeout(700)
    const row = p.locator('main div.flex.items-center:has(> h1):has(> svg)').first()
    if (await row.count()) {
      const png = PNG.sync.read(await row.screenshot())
      const rb = await row.boundingBox(), sb = await row.locator('> svg').boundingBox()
      const sx0 = Math.round((sb.x - rb.x) * scale), sx1 = Math.round((sb.x - rb.x + sb.width) * scale)
      const icon = inkCentre(png, sx0, sx1, scale)
      const text = lang === 'ar' ? inkCentre(png, 0, sx0 - 4, scale) : inkCentre(png, sx1 + 8, png.width, scale)
      check(icon !== null && text !== null && Math.abs(icon - text) <= 2, `${tag} /returns: the icon is centred on the title's letters`, `icon ${icon?.toFixed(1)} text ${text?.toFixed(1)}`)
    } else check(false, `${tag} /returns: the title row with its icon is there`)

    // --- header and menu bar
    await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
    const h = await p.evaluate(() => {
      const H = document.querySelector('header.app-header')
      const cy = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2 }
      const top = [H.querySelector('a[href="/"] img'), ...H.querySelectorAll('[data-cua-btn], button[aria-label^="Bag"], button[aria-label^="الحقيبة"], button[aria-label*="language"], button[aria-label*="اللغة"]')].filter((e) => e && e.getBoundingClientRect().width)
      const menu = [...H.querySelectorAll('a[href^="/men"], a[href^="/women"], a[href^="/accessories"], a[href^="/outlet"]')].filter((e) => e.getBoundingClientRect().width && e.getBoundingClientRect().top > 40)
      const spread = (a) => a.length ? Math.max(...a.map(cy)) - Math.min(...a.map(cy)) : -1
      return { top: spread(top), nTop: top.length, menu: spread(menu), nMenu: menu.length }
    })
    check(h.nTop >= 3 && h.top <= 1.5, `${tag} header: the logo and the icons share one centre line`, `${h.nTop} items, spread ${h.top.toFixed(1)}px`)
    check(h.nMenu >= 4 && h.menu <= 1, `${tag} menu bar: the links share one centre line`, `${h.nMenu} links, spread ${h.menu.toFixed(1)}px`)

    // --- category tiles
    const t = await p.evaluate(() => [...document.querySelectorAll('.cat-tile')].map((tile) => {
      const tr = tile.getBoundingClientRect(), b = tile.querySelector('.cat-tile__title').parentElement.getBoundingClientRect()
      return [(b.left + b.width / 2 - tr.left) / tr.width, (b.top + b.height / 2 - tr.top) / tr.height]
    }))
    const dx = Math.max(...t.map((v) => v[0])) - Math.min(...t.map((v) => v[0])), dy = Math.max(...t.map((v) => v[1])) - Math.min(...t.map((v) => v[1]))
    check(t.length === 4 && dx < 0.01 && dy < 0.02, `${tag} category tiles: the text sits in the same place on all four`, `spread ${(dx * 100).toFixed(1)}% across, ${(dy * 100).toFixed(1)}% down`)
    // --- product page: price, sizes, fit and colours on their box's centre line
    await p.goto(BASE + '/product/cloudsoft-jacket-army-green', { waitUntil: 'networkidle' })
    if (process.env.MUTATE === '2') await p.addStyleTag({ content: 'main .rounded-2xl ul,main .rounded-2xl div{justify-content:flex-start!important}' })
    await p.waitForTimeout(900)
    const pc = await p.evaluate(() => {
      const mid = (r) => r.left + r.width / 2
      const out = {}
      const h1 = document.querySelector('main h1.product-title')
      const col = h1.parentElement.parentElement.getBoundingClientRect()
      const price = h1.parentElement.parentElement.querySelector(':scope > p .text-accent')
      out.price = price ? Math.abs(mid(price.getBoundingClientRect()) - mid(col)) : -1
      const rowOff = (row) => {
        if (!row) return -1
        const box = row.closest('.rounded-2xl').getBoundingClientRect()
        // every LINE of a wrapping row is centred on its own: measure each line's span
        const lines = {}
        for (const k of row.children) { const r = k.getBoundingClientRect(); if (!r.width) continue; const y = Math.round(r.top); (lines[y] = lines[y] || []).push(r) }
        return Math.max(...Object.values(lines).map((rs) => Math.abs((Math.min(...rs.map((r) => r.left)) + Math.max(...rs.map((r) => r.right))) / 2 - mid(box))))
      }
      const rows = [...document.querySelectorAll('main .space-y-3 .rounded-2xl div')].filter((d) => d.querySelector(':scope > button[aria-pressed]'))
      out.sizes = rowOff(rows[0]); out.fit = rows[1] && rows[1].getBoundingClientRect().width ? rowOff(rows[1]) : 0
      out.colour = rowOff(document.querySelector('main .rounded-2xl ul:has(> li > a[href^="/product/"])'))
      return out
    })
    for (const k of ['price', 'sizes', 'fit', 'colour']) check(pc[k] >= 0 && pc[k] <= 2, `${tag} product page: the ${k === 'fit' ? 'fit buttons are' : k === 'price' ? 'price is' : k === 'colour' ? 'colours are' : k + ' are'} centred`, `${pc[k].toFixed(1)}px off`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — titles, header, menu and tiles line up')
process.exit(fails ? 1 : 0)
