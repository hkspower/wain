// The home features band rules (the last section of public/sporta-home-trim.css), proven on the live markup.
//
//   npm run test:home-features      (no sandbox needed: a fixture, the live rules, the add-on CSS)
//
// Each assertion is geometry, at every width from 1280 down to 320 and in both directions (Arabic, RTL,
// is the default language; English is LTR):
//
//   from 720px   three cards in a row, equal width and height, the title and its sub on ONE line each
//                (the live layout broke "الدفع عند الاستلام" onto two lines at 720-800px)
//   720-959px    each card stacked: tile on top, title and sub centred under it
//   960px up     one row: tile on the start side, group centred in the card (the live build pins it to
//                the start edge below 1024px, leaving the other half of the card empty)
//   sizes        tile 2.875rem, title 1rem / 800, sub .875rem; the sub keeps 4.5:1 contrast
//   under 720    untouched from the live build: one card per row, the group at the start, tile 2.625rem
//   always       nothing overflows sideways
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page } from './fixtures/home-features.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-home-trim.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

const measure = () => {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
  const cards = [...document.querySelectorAll('.home-feature-item')].map((c) => {
    const r = (e) => e.getBoundingClientRect()
    const icon = c.querySelector('.home-feature-icon'), box = c.querySelector(':scope > div')
    const title = c.querySelector('.home-feature-title'), sub = c.querySelector('.home-feature-sub')
    const lines = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size }
    const textRect = (e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect() }
    const cs = getComputedStyle(c), ts = getComputedStyle(title), ss = getComputedStyle(sub), is_ = getComputedStyle(icon)
    const tr = textRect(title), sr = textRect(sub)
    const textLeft = Math.min(tr.left, sr.left), textRight = Math.max(tr.right, sr.right)
    return {
      card: r(c), icon: r(icon), title: tr, sub: sr, textLeft, textRight,
      titleLines: lines(title), subLines: lines(sub),
      dir: cs.flexDirection, justify: cs.justifyContent, textAlign: cs.textAlign,
      iconPx: parseFloat(is_.width), titlePx: parseFloat(ts.fontSize), titleW: ts.fontWeight, subPx: parseFloat(ss.fontSize),
      subColor: ss.color, bg: cs.backgroundColor, boxLeft: r(box).left, boxRight: r(box).right,
    }
  })
  return { root, rtl, cards, over: document.documentElement.scrollWidth - innerWidth }
}
const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

for (const lang of ['ar', 'en']) {
  for (const w of [1280, 1100, 1024, 960, 959, 900, 800, 720, 719, 600, 390, 360, 320]) {
    head(`${lang} ${w}px`)
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg = await ctx.newPage()
    await pg.setContent(page(lang, ADDON))
    const m = await pg.evaluate(measure)
    const C = m.cards, c0 = C[0]
    const near = (a, b, t) => Math.abs(a - b) <= t
    is(C.length === 3, 'three cards')
    is(m.over <= 0, 'nothing overflows sideways', `${m.over}px`)
    const lefts = new Set(C.map((c) => Math.round(c.card.left)))
    if (w >= 720) {
      is(lefts.size === 3, 'three cards side by side', `${lefts.size} columns`)
      is(C.every((c) => near(c.card.width, c0.card.width, 1.5) && near(c.card.height, c0.card.height, 1)), 'equal width and height', C.map((c) => Math.round(c.card.width) + 'x' + Math.round(c.card.height)).join(' '))
      is(C.every((c) => c.titleLines === 1 && c.subLines === 1), 'every title and sub is on one line', C.map((c) => c.titleLines + '/' + c.subLines).join(' '))
      is(C.every((c) => near(c.iconPx, 2.875 * m.root, 0.6)), 'tile is 2.875rem', C.map((c) => c.iconPx).join(' '))
      is(C.every((c) => near(c.titlePx, m.root, 0.3) && c.titleW === '800' && near(c.subPx, 0.875 * m.root, 0.3)), 'title 1rem / 800, sub .875rem', `${c0.titlePx}/${c0.titleW}/${c0.subPx}`)
      is(C.every((c) => ratio(c.subColor, c.bg) >= 4.5), 'the sub keeps 4.5:1 contrast', C.map((c) => ratio(c.subColor, c.bg).toFixed(1)).join(' '))
      const mid = (c) => (c.card.left + c.card.right) / 2
      if (w < 960) {
        is(C.every((c) => c.dir === 'column'), 'stacked: tile on top')
        is(C.every((c) => c.icon.bottom <= Math.min(c.title.top, c.sub.top) + 1), 'the tile sits above the title')
        is(C.every((c) => near((c.icon.left + c.icon.right) / 2, mid(c), 1.5)), 'the tile is centred in the card', C.map((c) => ((c.icon.left + c.icon.right) / 2 - mid(c)).toFixed(1)).join(' '))
        is(C.every((c) => near((c.title.left + c.title.right) / 2, mid(c), 2) && near((c.sub.left + c.sub.right) / 2, mid(c), 2)), 'title and sub are centred under it', C.map((c) => ((c.title.left + c.title.right) / 2 - mid(c)).toFixed(1)).join(' '))
      } else {
        is(C.every((c) => c.dir === 'row'), 'one row: tile beside the text')
        const gl = (c) => Math.min(c.icon.left, c.textLeft), gr = (c) => Math.max(c.icon.right, c.textRight)
        is(C.every((c) => near(gl(c) - c.card.left, c.card.right - gr(c), 2)), 'the group is centred in the card', C.map((c) => (gl(c) - c.card.left).toFixed(1) + '|' + (c.card.right - gr(c)).toFixed(1)).join('  '))
        is(C.every((c) => (m.rtl ? c.icon.left >= c.textRight - 1 : c.icon.right <= c.textLeft + 1)), 'the tile is on the start side', m.rtl ? 'rtl' : 'ltr')
        is(C.every((c) => near((c.icon.top + c.icon.bottom) / 2, (Math.min(c.title.top, c.sub.top) + Math.max(c.title.bottom, c.sub.bottom)) / 2, 2.5)), 'the tile is level with the text block')
      }
    } else {
      is(lefts.size === 1, 'one card per row', `${lefts.size} lefts`)
      is(C.every((c) => c.dir === 'row' && c.justify === 'normal'), 'untouched: a row with the group at the start', `${c0.dir}/${c0.justify}`)
      is(C.every((c) => near(c.iconPx, 2.625 * m.root, 0.6)), 'untouched: tile is 2.625rem', C.map((c) => c.iconPx).join(' '))
    }
    await ctx.close()
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
