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
//   under 720    one card per row (FEATURES BAND 1119, 2026-11-19): the group centred in the card (the live build pinned it to the start edge and
//                left 43-72% of every card empty), the three tiles in ONE column, tile 2.625rem as the live build has it, the card no taller than before
//   rows         wherever the card is a row (under 720 and from 960px) the title and the sub share the start edge of their block. CENTER-1118 of
//                sporta-shadows.css centres both lines, which floated the title 13-25px in from the sub; the rule is loaded from the real file here
//   always       nothing overflows sideways
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page } from './fixtures/home-features.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-home-trim.css'), 'utf8')
// the REAL CENTER-1118 rule that centres the title and the sub (public/sporta-shadows.css [center-1]), and the wrappers it is scoped to
const SHADOWS = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')
const CENTER = SHADOWS.slice(SHADOWS.indexOf('/* [center-1] */'), SHADOWS.indexOf('/* [center-2]'))
if (!/home-feature-title/.test(CENTER) || CENTER.length < 200) { console.log('FAIL could not read the CENTER-1118 [center-1] rule from sporta-shadows.css'); process.exit(1) }
const html = (lang, css) => page(lang, css).replace('<body>', '<body><div class="storefront-root"><main>').replace('</body>', '</main></div></body>')

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
      dir: cs.flexDirection, justify: cs.justifyContent, textAlign: cs.textAlign, titleAlign: ts.textAlign, subAlign: ss.textAlign,
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
    await pg.setContent(html(lang, CENTER + '\n' + ADDON))
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
      is(C.every((c) => c.dir === 'row' && c.justify === 'center'), 'a row with the group centred in the card', `${c0.dir}/${c0.justify}`)
      is(C.every((c) => near(c.iconPx, 2.625 * m.root, 0.6)), 'tile is 2.625rem, as the live build has it', C.map((c) => c.iconPx).join(' '))
      const gl = (c) => Math.min(c.icon.left, c.boxLeft), gr = (c) => Math.max(c.icon.right, c.boxRight)
      is(C.every((c) => near(gl(c) - c.card.left, c.card.right - gr(c), 1.5)), 'the group (tile + text block) is centred: equal room on both sides', C.map((c) => (gl(c) - c.card.left).toFixed(1) + '|' + (c.card.right - gr(c)).toFixed(1)).join('  '))
      is(C.every((c) => near(c.icon.left, c0.icon.left, 1.5)), 'the three tiles stand in one column', C.map((c) => c.icon.left.toFixed(1)).join(' '))
      is(C.every((c) => c.card.height <= 5.25 * m.root), 'no card is taller than one row (no growth, no layout shift)', C.map((c) => Math.round(c.card.height)).join(' '))
      is(C.every((c) => c.titleLines === 1 && c.subLines === 1), 'every title and sub is on one line', C.map((c) => c.titleLines + '/' + c.subLines).join(' '))
    }
    // a row layout (under 720 and from 960): the two lines share the start edge of their block
    if (w < 720 || w >= 960) {
      const edge = (c) => (m.rtl ? c.title.right - c.sub.right : c.title.left - c.sub.left)
      is(C.every((c) => c.titleAlign === 'start' && c.subAlign === 'start'), 'row: title and sub are start-aligned (CENTER-1118 does not centre them here)', `${c0.titleAlign}/${c0.subAlign}`)
      is(C.every((c) => near(edge(c), 0, 1.5)), 'row: the title and the sub share the start edge', C.map((c) => edge(c).toFixed(1)).join(' '))
    } else {
      is(C.every((c) => c.titleAlign === 'center' && c.subAlign === 'center'), 'stacked: title and sub stay centred (CENTER-1118)', `${c0.titleAlign}/${c0.subAlign}`)
    }
    await ctx.close()
  }
}

// ---------------------------------------------------------------- mutations: each FEATURES BAND 1119 rule has to matter
head('mutations: with a rule cut, the matching check fails')
{
  const cut = (anchor) => { if (!ADDON.includes(anchor)) throw new Error('mutation anchor missing: ' + anchor); return ADDON.replace(anchor, '') }
  const run = async (lang, css) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const pg = await ctx.newPage(); await pg.setContent(html(lang, CENTER + '\n' + css)); const m = await pg.evaluate(measure); await ctx.close(); return m
  }
  for (const lang of ['ar', 'en']) {
    const m1 = await run(lang, cut('.campaign-home .home-feature-item { justify-content: center; }'))
    is(m1.cards.some((c) => c.justify !== 'center'), `MUTANT [fb-1] cut (${lang}): the group is back at the start edge (so the centred-group check can fail)`)
    const m2 = await run(lang, cut(':root .campaign-home .home-feature-item :is(.home-feature-title, .home-feature-sub) { text-align: start; }'))
    const edge = (c) => (m2.rtl ? c.title.right - c.sub.right : c.title.left - c.sub.left)
    is(m2.cards.some((c) => Math.abs(edge(c)) > 1.5), `MUTANT [fb-2] cut (${lang}): the title floats off the sub's start edge again (so the shared-edge check can fail)`, m2.cards.map((c) => edge(c).toFixed(1)).join(' '))
    const m3 = await run(lang, cut('.campaign-home .home-feature-item > div { min-width: 9.25rem; }'))
    is(m3.cards.some((c) => Math.abs(c.icon.left - m3.cards[0].icon.left) > 1.5), `MUTANT [fb-3] cut (${lang}): the tiles zig-zag again (so the one-column check can fail)`, m3.cards.map((c) => c.icon.left.toFixed(1)).join(' '))
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
