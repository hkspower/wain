// The LAYOUT section of public/sporta-product-fix.css ([lay-1] tablet two columns, [lay-2] phone first screen,
// [lay-3] related cards with a photo first), proven on the live markup and the live stylesheet rules.
//
//   npm run test:product-layout      (no sandbox needed: a fixture, the live rules, the add-on CSS)
//
// Real Chromium, Arabic (RTL, the default) and English (LTR). Every rule is measured against the same page with
// the add-on switched off, so a pass means the add-on changed it, not that the fixture happened to be fine.
// Fonts differ from live (no Arabic font here), so the assertions are relative geometry, not live pixel values.
//
// ADDON_FILE=<path> runs the same checks against another CSS file (the mutation check passes a blank one and
// must FAIL).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, DESC } from './fixtures/product-desc.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-product-fix.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// The fixture's photographs are 1px placeholders. Two related cards get the live "no photo" plate's address, in
// the positions the live page had them (first and second of four), so [lay-3] has something to move.
const withPlates = (html) => {
  let n = 0
  return html.replace(/(<img[^>]*class=\\?"catalog-card-photo[^>]*src=\\?")[^"\\]*/g, (m, a) => (n++ < 2 ? a + '/product-photo-unavailable.svg' : m))
}

async function measure(lang, width, height, css, chips = 0) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const p = await ctx.newPage()
  await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"/>' }))
  await p.setContent(withPlates(page(lang, DESC[lang], css)), { waitUntil: 'load' })
  // the fixture shows all nine sizes; `chips` keeps the first n, the way a product that carries n sizes renders
  // (the fixture is a one-size product: eight chips the add-on script marked "not carried" and the one-size chip;
  // clearing the marks on the first n and dropping the rest gives the markup of a product with n sizes)
  if (chips) await p.evaluate((n) => { [...document.querySelectorAll('#product-size-options [role="group"] > button')].forEach((e, i) => { if (i < n) { e.removeAttribute('data-sporta-nosize'); e.removeAttribute('data-sporta-one'); e.style.display = ''; e.textContent = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'][i] } else e.remove() }) }, chips)
  const m = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top + scrollY, bottom: b.bottom + scrollY, width: b.width, height: b.height } }
    const cards = [...document.querySelectorAll('.catalog-related .product-grid > *')]
    const plate = (c) => !!c.querySelector('img[src*="product-photo-unavailable"]')
    const visual = cards.map((c, i) => ({ i, plate: plate(c), b: c.getBoundingClientRect() })).sort((a, b) => (Math.abs(a.b.top - b.b.top) > 4 ? a.b.top - b.b.top : (document.dir === 'rtl' ? b.b.left - a.b.left : a.b.left - b.b.left)))
    const taps = [...document.querySelectorAll('.catalog-breadcrumb a')].map((a) => a.getBoundingClientRect().height)
    return {
      vw: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth,
      visual: r(q('.catalog-product-visual')), summary: r(q('.catalog-product-summary')), h1: r(q('.catalog-product-title') || q('h1')),
      price: r(q('.catalog-product-price')), crumb: r(q('.catalog-breadcrumb ol')), related: r(q('.catalog-related')), layout: r(q('.catalog-product-layout')),
      row: r(q('.product-purchase-row')), rowKids: [...(q('.product-purchase-row')?.children ?? [])].map((e) => r(e)),
      order: visual.map((v) => (v.plate ? 'plate' : 'photo')), cards: cards.length, crumbTap: Math.min(...taps),
      ladder: (() => { const bs = [...document.querySelectorAll('#product-size-options [role="group"] > button')].map((e) => e.getBoundingClientRect()); const rows = {}; for (const q of bs) rows[Math.round(q.top)] = (rows[Math.round(q.top)] || 0) + 1; return { rows: Object.values(rows), minW: Math.min(...bs.map((q) => q.width)), n: bs.length } })(),
      stickyVisual: getComputedStyle(q('.catalog-product-visual')).position,
    }
  })
  await ctx.close()
  return m
}

for (const lang of ['ar', 'en']) {
  // ---------------------------------------------------------------- [lay-1] tablet
  head(`[lay-1] tablet, two columns (${lang})`)
  for (const w of [768, 900, 1023]) {
    const off = await measure(lang, w, 900, '')
    const on = await measure(lang, w, 900, ADDON)
    const side = Math.abs(on.visual.top - on.summary.top) < 2 && (on.visual.right <= on.summary.left + 1 || on.summary.right <= on.visual.left + 1)
    is(off.summary.top > off.visual.bottom - 1, `${w}px, add-on off: one column, the summary starts under the photo (the live layout)`, `summary ${Math.round(off.summary.top)} photo bottom ${Math.round(off.visual.bottom)}`)
    is(side, `${w}px: the photo and the summary sit side by side`, `photo ${Math.round(on.visual.left)}..${Math.round(on.visual.right)} summary ${Math.round(on.summary.left)}..${Math.round(on.summary.right)}`)
    is(on.h1.top < 900 && on.price.bottom < 900 && off.h1.top > on.h1.top + 200, `${w}px: the name and the price are on the first screen (they were below the photo)`, `h1 ${Math.round(off.h1.top)} -> ${Math.round(on.h1.top)}, price bottom ${Math.round(off.price.bottom)} -> ${Math.round(on.price.bottom)}`)
    is(on.summary.width > on.visual.width && on.visual.width > 250, `${w}px: the summary is the wider column, and the photo is still a photo (over 250px)`, `photo ${Math.round(on.visual.width)} summary ${Math.round(on.summary.width)}`)
    is(on.overflow <= 0 && on.rowKids.every((k) => k.right <= on.summary.right + 1 && k.left >= on.summary.left - 1 && k.width >= 44), `${w}px: no sideways scroll, and the buy row's three parts fit inside the summary column`, `overflow ${on.overflow}; parts ${on.rowKids.map((k) => Math.round(k.width)).join('/')}`)
    is(on.stickyVisual === 'sticky', `${w}px: the photo sticks while the summary scrolls`, on.stickyVisual)
  }
  // [lay-1b] the size ladder beside the photo
  for (const [w, n, want] of [[768, 8, '4,4'], [820, 8, '4,4'], [899, 8, '4,4'], [900, 8, '8'], [768, 7, '7'], [768, 5, '5'], [768, 3, '3'], [1023, 8, '8']]) {
    const on = await measure(lang, w, 900, ADDON, n)
    is(on.ladder.n === n && on.ladder.rows.join() === want && on.ladder.minW >= 44, `${w}px, ${n} sizes: the ladder is ${want.replace(',', ' + ')}, every chip at least 44px wide`, `rows ${on.ladder.rows.join('+')} min width ${on.ladder.minW.toFixed(1)}`)
  }
  const at1024off = await measure(lang, 1024, 900, ''), at1024on = await measure(lang, 1024, 900, ADDON)
  is(Math.abs(at1024on.visual.width - at1024off.visual.width) < 1 && Math.abs(at1024on.summary.left - at1024off.summary.left) < 1, '1024px: the desktop layout is untouched', `photo ${Math.round(at1024off.visual.width)} -> ${Math.round(at1024on.visual.width)}`)

  // ---------------------------------------------------------------- [lay-2] phone
  head(`[lay-2] phone, the first screen (${lang})`)
  for (const [w, h] of [[390, 844], [360, 740], [320, 640]]) {
    const off = await measure(lang, w, h, '')
    const on = await measure(lang, w, h, ADDON)
    is(off.price.top - on.price.top >= 28, `${w}px: the price sits at least 28px higher`, `${Math.round(off.price.top)} -> ${Math.round(on.price.top)}`)
    is(on.crumb.height <= 46 && on.crumb.height <= off.crumb.height, `${w}px: the breadcrumb is one line`, `${Math.round(off.crumb.height)} -> ${Math.round(on.crumb.height)}`)
    is(on.overflow <= 0, `${w}px: no sideways scroll`, `overflow ${on.overflow}`)
    is(on.crumbTap >= off.crumbTap - 0.5, `${w}px: the breadcrumb links keep their tap height`, `${off.crumbTap} -> ${on.crumbTap}`)
    is(Math.abs(on.visual.width - off.visual.width) < 1, `${w}px: the photo is the same size (only the spacing changed)`, `${Math.round(off.visual.width)} -> ${Math.round(on.visual.width)}`)
    is(on.related.top - on.layout.bottom < off.related.top - off.layout.bottom, `${w}px: less empty space above "Complete the look"`, `${Math.round(off.related.top - off.layout.bottom)} -> ${Math.round(on.related.top - on.layout.bottom)}`)
  }

  // ---------------------------------------------------------------- [lay-3] related cards
  head(`[lay-3] related cards: photos first (${lang})`)
  for (const w of [390, 1280]) {
    const off = await measure(lang, w, 900, '')
    const on = await measure(lang, w, 900, ADDON)
    is(off.order.slice(0, 2).join() === 'plate,plate', `${w}px, add-on off: the row leads with two "no photo" plates (the live order)`, off.order.join(' '))
    const firstPlate = on.order.indexOf('plate'), lastPhoto = on.order.lastIndexOf('photo')
    is(firstPlate > lastPhoto && on.order.length === off.order.length && on.order.filter((x) => x === 'plate').length === 2, `${w}px: every card with a photo comes before the plates, and no card is removed`, on.order.join(' '))
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
