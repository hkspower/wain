// npm run test:storefront-polish - proves the four storefront sections of public/sporta-shadows.css that sit before ICON SET
// (NAMES-1111, GRID-1111, TITLES-1111, ICON USE) and the title block at the end of public/sporta-features.js, on the CAPTURED LIVE
// MARKUP under the LIVE rules (scripts/fixtures: sizes-screen, sizes-product, grid, register, account), Arabic and English,
// 320 / 390 / 768 / 1280px:
//   names    card names clamp to two lines (also for a three-line name and a 60-character word: the row stays level, nothing
//            leaves the card), English capitalised, Arabic untracked, the product title wraps whole, `title` carries the full name
//   grid     two columns up to 767px, equal card height and price line per row, gaps one step apart, 44px touch targets,
//            a missing photo shows no broken-image text
//   titles   two h1 sizes (reading pages / action pages), one h2 size, h1 always larger than the h2 under it, no Arabic tracking
//   icons    no <select> keeps the browser's arrow, every FAQ question carries the set's chevron (turns when open, 44px row),
//            and no storefront svg is left in an old drawing (clock excepted)
//   page     no sideways scroll, same page height class on every page
// plus a MUTATION run: each section removed on its own must fail the checks that belong to it.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rig, CSS_FILE, ALL_PAGES, ROOT } from './lib/storefront-polish-page.mjs'

const FULL = readFileSync(CSS_FILE, 'utf8')
const NAMES = ['NAMES-1111', 'GRID-1111', 'TITLES-1111', 'ICON USE']
const cut = (css, name) => {
  const i = css.indexOf(`/* ==== ${name}`), endTag = `/* ==== end ${name}`
  const j = css.indexOf(endTag), k = css.indexOf('\n', j)
  return css.slice(0, i) + css.slice(k + 1)
}
const without = (css, names) => names.reduce(cut, css)
const JS = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const TITLE_JS = JS.slice(JS.indexOf(';(function () {', JS.indexOf('Product names: the full name as a tooltip')))

let pass = 0, fail = 0
const fails = []
let tag = null // which section a failing check belongs to (for the mutation run)
const byTag = {}
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')); if (tag) byTag[tag] = (byTag[tag] || 0) + 1 } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ---- static ----------------------------------------------------------------------------------------------------------
head('the sections')
{
  const iSet = FULL.indexOf('/* ==== ICON SET')
  let last = -1
  for (const n of NAMES) {
    const i = FULL.indexOf(`/* ==== ${n}`), j = FULL.indexOf(`/* ==== end ${n}`)
    is(i > 0 && j > i && FULL.indexOf(`/* ==== ${n}`, i + 1) < 0, `${n}: one section with its end marker`)
    is(i > last && j < iSet, `${n}: sits before ICON SET, in order`)
    last = j
    const body = FULL.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '')
    is(!/admin|backends|\.sf\b|sporta-cat-tiles/.test(body), `${n}: no selector names the admin, the features band or the cat tiles`)
    is(!/https?:\/\//.test(body.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${n}: no external URL`)
    is(/\.storefront-root/.test(body), `${n}: scoped to the storefront`)
  }
  is(TITLE_JS.length > 200 && /setAttribute\('title'/.test(TITLE_JS), 'sporta-features.js carries the title block (last IIFE)')
  is(!/innerHTML|textContent\s*=/.test(TITLE_JS), 'the title block writes the title attribute only (no node is touched)')
  is(without(FULL, NAMES).includes('/* ==== ICON SET') && !without(FULL, NAMES).includes('NAMES-1111'), 'the four sections can be removed on their own (mutation rig)')
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const R = await rig(browser)
const P = (id) => ALL_PAGES.find((x) => x.id === id)

const LONG = {
  en: ['cloudsoft performance training jacket extra long limited edition - army green', 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS-MODEL-CODE-1234567890-ABCDEFGHIJ'],
  ar: ['جاكيت كلاودسوفت للتدريب الاحترافي طويل جدا جدا إصدار محدود جدا — أخضر عسكري', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890-MODEL-CODE-ABCDEFGHIJ-KLMNOP'],
}

// ---- measurements (run in the page) ----------------------------------------------------------------------------------
const gridInfo = (long) => {
  const g = document.querySelector('.product-grid'); if (!g) return null
  const names = [...g.querySelectorAll('.catalog-card-name')]
  if (long) { names[0].textContent = long[0]; names[1].textContent = long[1] }
  const cs = getComputedStyle(g)
  const cards = [...g.children].filter((c) => c.checkVisibility())
  const rect = cards.map((c) => c.getBoundingClientRect())
  const rows = {}
  rect.forEach((r, i) => { (rows[Math.round(r.top)] = rows[Math.round(r.top)] || []).push(i) })
  const rowEq = Object.values(rows).every((ix) => new Set(ix.map((i) => Math.round(rect[i].height))).size === 1)
  const priceEq = Object.values(rows).every((ix) => new Set(ix.map((i) => { const p = cards[i].querySelector('.price-card'); return p ? Math.round(p.getBoundingClientRect().top - rect[i].top) : -1 })).size === 1)
  const nm = names.map((n) => {
    const c = getComputedStyle(n), r = n.getBoundingClientRect(), lh = parseFloat(c.lineHeight)
    return { clamp: c.webkitLineClamp, overflow: c.overflow, h: r.height, lh, band: 2.9 * parseFloat(getComputedStyle(document.documentElement).fontSize), tt: c.textTransform, ls: c.letterSpacing, fs: parseFloat(c.fontSize), title: n.getAttribute('title'), text: n.textContent.trim(), wrapAnywhere: c.overflowWrap }
  })
  const leak = cards.some((c) => c.scrollWidth > c.clientWidth + 1)
  const btn = (sel) => [...g.querySelectorAll(sel)].filter((e) => e.checkVisibility()).map((e) => Math.round(Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)))
  const more = [...document.querySelectorAll('.catalog-page button.btn')].filter((e) => e.checkVisibility()).map((e) => e.getBoundingClientRect().height)
  const sort = [...document.querySelectorAll('.catalog-sort-select')].map((e) => e.getBoundingClientRect().height)
  const pt = document.querySelector('.catalog-product-title'), ptc = pt ? getComputedStyle(pt) : null
  const img = g.querySelector('img.catalog-card-photo'), ic = img ? getComputedStyle(img) : null
  return {
    cols: cs.gridTemplateColumns.split(' ').length, row: parseFloat(cs.rowGap), col: parseFloat(cs.columnGap), rowEq, priceEq, nm, leak,
    save: btn('.catalog-card-save'), add: btn('.catalog-card-add:not([disabled])'), more, sort,
    pt: ptc ? { wrap: ptc.overflowWrap, tt: ptc.textTransform, bal: ptc.textWrap || ptc.textWrapStyle, ls: ptc.letterSpacing } : null, imgInk: ic ? { color: ic.color, fs: ic.fontSize } : null, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
}

// ---- 1. names + grid -------------------------------------------------------------------------------------------------
async function namesAndGrid(css, widths, pages, full) {
  for (const id of pages) for (const lang of ['en', 'ar']) for (const w of widths) {
    const T = `${id} ${lang} ${w}px`
    const { p, ctx } = await R.open(P(id), lang, w, css)
    tag = 'NAMES-1111'
    const base = await p.evaluate(gridInfo, null)
    is(!!base, `${T}: has a product grid`)
    if (!base) { await ctx.close(); continue }
    is(base.nm.every((n) => n.clamp === '2' && n.overflow === 'hidden'), `${T}: every card name is clamped to two lines`, JSON.stringify(base.nm[0]))
    is(base.nm.every((n) => n.wrapAnywhere === 'anywhere'), `${T}: a long word breaks instead of overflowing`)
    if (lang === 'en') is(base.nm.every((n) => n.tt === 'capitalize'), `${T}: English names are capitalised`)
    else is(base.nm.every((n) => n.tt === 'none' && /^(normal|0px)$/.test(n.ls)), `${T}: Arabic names carry no case and no tracking`, base.nm[0].ls)
    if (base.pt) {
      is(base.pt.wrap === 'anywhere' && /balance/.test(base.pt.bal), `${T}: the product page name wraps whole, balanced, and breaks a long word`, JSON.stringify(base.pt))
      is(lang === 'en' ? base.pt.tt === 'capitalize' : base.pt.tt === 'none' && /^(normal|0px)$/.test(base.pt.ls), `${T}: the product page name casing / tracking`, JSON.stringify(base.pt))
    }
    tag = 'GRID-1111'
    is(base.cols === (w < 768 ? 2 : id === 'product/full' && w === 768 ? 4 : base.cols) && (w >= 768 || base.cols === 2), `${T}: ${base.cols} columns (2 on a phone)`)
    is(base.rowEq, `${T}: the cards of a row are the same height`)
    is(base.priceEq, `${T}: the price sits on the same line in every card of a row`)
    const gap = w < 768 ? [24, 12] : w < 1280 ? [28, 16] : [32, 20]
    is(base.row === gap[0] && base.col === gap[1], `${T}: gaps ${gap.join('/')}px (sporta-grid.css, one set for every grid)`, `${base.row}/${base.col}`)
    is(base.save.every((s) => s >= 44) && base.add.every((s) => s >= 44), `${T}: wishlist and add buttons are 44px`, `${base.save} ${base.add}`)
    is(base.more.every((h) => h >= 44) && base.sort.every((h) => h >= 44), `${T}: "show more" and the sort list are 44px tall`, `${base.more} ${base.sort}`)
    is(base.imgInk && base.imgInk.fs === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(base.imgInk.color), `${T}: a missing photo shows no alt text`, JSON.stringify(base.imgInk))
    is(base.scrollX <= 0, `${T}: no sideways scroll`)
    await ctx.close()
    if (!full) continue
    // stress: a three-line name and a 60-character word in the first two cards
    const s = await R.open(P(id), lang, w, css)
    tag = 'NAMES-1111'
    const st = await s.p.evaluate(gridInfo, LONG[lang])
    await s.p.evaluate(TITLE_JS); await s.p.waitForTimeout(260)
    const titles = await s.p.evaluate(() => [...document.querySelectorAll('.catalog-card-name')].map((n) => [n.getAttribute('title'), n.textContent.replace(/\s+/g, ' ').trim()]))
    is(st.nm.slice(0, 2).every((n) => n.h <= n.band + 1), `${T}: a long name stays inside the two-line band (2.9rem)`, st.nm.slice(0, 2).map((n) => `${n.h}/${n.lh}`).join(' '))
    is(!st.leak, `${T}: nothing leaves the card (a 60-character word)`)
    is(st.rowEq && st.priceEq, `${T}: the row stays level and the prices aligned with long names`)
    is(titles.length > 0 && titles.every(([t, x]) => t === x), `${T}: every card name carries its full name as title (${titles.length})`)
    await s.ctx.close()
  }
}

// ---- 2. titles -------------------------------------------------------------------------------------------------------
const heads = () => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) // the page scales its root size with the viewport
  const px = (e) => parseFloat(getComputedStyle(e).fontSize)
  const one = (s) => { const e = [...document.querySelectorAll(s)].find((x) => x.checkVisibility()); return e ? { px: px(e), rem: px(e) / rem, fw: getComputedStyle(e).fontWeight, ls: getComputedStyle(e).letterSpacing, lh: parseFloat(getComputedStyle(e).lineHeight) / px(e), bal: getComputedStyle(e).textWrap || getComputedStyle(e).textWrapStyle } : null }
  const sel = '.storefront-root'
  const all = (s) => [...document.querySelectorAll(s)].filter((x) => x.checkVisibility()).map((e) => ({ px: px(e), rem: px(e) / rem, ls: getComputedStyle(e).letterSpacing, lh: parseFloat(getComputedStyle(e).lineHeight) / px(e), fw: getComputedStyle(e).fontWeight }))
  return {
    h1A: one(`${sel} .editorial-page h1.page-heading, ${sel} .catalog-heading-copy > h1`),
    h1B: one(`${sel} .purchase-heading > h1, ${sel} .purchase-flow > h1, ${sel} .catalog-product-title, ${sel} .customer-account__card > h1`),
    rel: one(`${sel} .catalog-related > h2`),
    h2: all(`${sel} .legal-page__section > h2, ${sel} .account-dashboard__section-head h2, ${sel} .purchase-stage-title`),
  }
}
async function titles(css, widths, pages) {
  const seen = {}
  for (const id of pages) for (const lang of ['en', 'ar']) for (const w of widths) {
    const T = `${id} ${lang} ${w}px`
    const { p, ctx } = await R.open(P(id), lang, w, css)
    const h = await p.evaluate(heads)
    tag = 'TITLES-1111'
    const key = `${lang}|${w}`; seen[key] = seen[key] || { A: [], B: [], C: [] }
    if (h.h1A) { seen[key].A.push([id, h.h1A.px]); is(h.h1A.rem >= 1.74 && h.h1A.rem <= 2.76 && +h.h1A.fw >= 800, `${T}: reading-page title ${h.h1A.px.toFixed(1)}px / ${h.h1A.fw}`) }
    if (h.h1B) { seen[key].B.push([id, h.h1B.px]); is(h.h1B.rem >= 1.49 && h.h1B.rem <= 2.01 && h.h1B.fw === '800', `${T}: action-page title ${h.h1B.px.toFixed(1)}px / ${h.h1B.fw}`) }
    h.h2.forEach((e, i) => { seen[key].C.push([id + '#' + i, e.px]); is(e.rem >= 1.12 && e.rem <= 1.38 && e.fw === '800', `${T}: panel heading #${i} ${e.px.toFixed(1)}px`) })
    const top = h.h1A || h.h1B
    if (top) h.h2.forEach((e, i) => is(top.px > e.px + 1, `${T}: the title (${top.px.toFixed(1)}) is larger than panel heading #${i} (${e.px.toFixed(1)})`))
    if (h.rel) { is(h.rel.rem >= 1.24 && h.rel.rem <= 1.51 && h.h1B && h.h1B.px > h.rel.px + 1, `${T}: "Complete the look" ${h.rel.px.toFixed(1)}px is one step under the product title ${h.h1B && h.h1B.px.toFixed(1)}`) }
    if (lang === 'ar') for (const x of [h.h1A, h.h1B, h.rel, ...h.h2].filter(Boolean)) is(/^(normal|0px)$/.test(x.ls), `${T}: Arabic heading untracked`)
    if (lang === 'ar') for (const x of h.h2) is(x.lh >= 1.25, `${T}: Arabic panel heading on a ${x.lh.toFixed(2)} line`)
    await ctx.close()
  }
  for (const [k, v] of Object.entries(seen)) {
    const eq = (arr) => arr.length < 2 || Math.max(...arr.map((x) => x[1])) - Math.min(...arr.map((x) => x[1])) < 0.6
    is(eq(v.A), `${k}: every reading-page title is one size`, JSON.stringify(v.A))
    is(eq(v.B), `${k}: every action-page title is one size`, JSON.stringify(v.B))
    is(eq(v.C), `${k}: every panel heading is one size`, JSON.stringify(v.C))
    if (v.A.length && v.B.length) is(v.A[0][1] > v.B[0][1], `${k}: reading-page titles are larger than action-page titles`)
  }
}

// ---- 3. icons --------------------------------------------------------------------------------------------------------
const iconInfo = () => {
  const vis = (e) => e.checkVisibility() && e.getBoundingClientRect().width > 0
  const sel = [...document.querySelectorAll('.storefront-root select:not([multiple])')].filter(vis).map((e) => { const c = getComputedStyle(e); return { appearance: c.appearance, bg: c.backgroundImage, pos: c.backgroundPosition, padEnd: parseFloat(c.paddingInlineEnd), id: e.id || e.className.slice(0, 30), h: e.getBoundingClientRect().height } })
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  document.head.insertAdjacentHTML('beforeend', '<style>*,*::before,*::after{transition:none!important}</style>')
  const sum = [...document.querySelectorAll('.storefront-root .editorial-page details > summary')].filter(vis).map((e) => {
    const a = getComputedStyle(e, '::after'), d = e.parentElement, r = e.getBoundingClientRect(), cs = getComputedStyle(e)
    const o = { content: a.content, w: parseFloat(a.width) / rem, mask: decodeURIComponent(a.maskImage || a.webkitMaskImage || ''), bg: a.backgroundColor, fg: a.color, h: r.height, rotClosed: a.rotate, marker: cs.listStyleType, display: cs.display }
    d.open = true; o.rotOpen = getComputedStyle(e, '::after').rotate; d.open = false
    return o
  })
  const olds = [...document.querySelectorAll('.storefront-root svg, .campaign-cart-drawer svg')].filter((e) => vis(e) && !e.closest('.clock, [data-hand]') && !e.querySelector('.clock__face')).map((e) => {
    const c = getComputedStyle(e), m = decodeURIComponent(c.maskImage || c.webkitMaskImage || '')
    const kids = [...e.children].filter((k) => !/^(title|desc|defs)$/i.test(k.tagName))
    return { glyph: (m.match(/data-glyph='([\w-]+)'/) || [])[1] || null, shown: kids.some((k) => getComputedStyle(k).visibility !== 'hidden'), sig: (e.querySelector('path,circle,rect') || {}).outerHTML?.slice(0, 60) || '' }
  })
  return { sel, sum, olds, rtl: getComputedStyle(document.documentElement).direction === 'rtl' }
}
async function icons(css, widths, pages) {
  for (const id of pages) for (const lang of ['en', 'ar']) for (const w of widths) {
    const T = `${id} ${lang} ${w}px`
    const { p, ctx } = await R.open(P(id), lang, w, css)
    const x = await p.evaluate(iconInfo)
    tag = 'ICON USE'
    x.sel.forEach((s, i) => {
      is(s.appearance === 'none', `${T}: select #${i} (${s.id}) has no browser arrow`, s.appearance)
      is(/chevron-down/.test(decodeURIComponent(s.bg)), `${T}: select #${i} draws the set's chevron-down`)
      is(x.rtl ? /^0%|^\S*left|^[\d.]+px/.test(s.pos) && !/^100%|right/.test(s.pos) : true, `${T}: select #${i} arrow on the reading-end side`, s.pos)
      is(s.padEnd >= 36, `${T}: select #${i} leaves room for the arrow (${s.padEnd}px)`)
    })
    x.sum.forEach((s, i) => {
      is(s.content !== 'none' && Math.abs(s.w - 1.25) < 0.01 && /chevron-down/.test(s.mask), `${T}: FAQ question #${i} carries the chevron-down`, `${s.content} ${s.w} ${s.mask.slice(0, 40)}`)
      is(s.bg === s.fg, `${T}: FAQ chevron #${i} is in the page's accent colour (as the old + was)`, `${s.bg} vs ${s.fg}`)
      is(s.rotClosed === 'none' && /180deg/.test(s.rotOpen), `${T}: FAQ chevron #${i} turns when the question is open`, `${s.rotClosed} -> ${s.rotOpen}`)
      is(s.h >= 44 && s.display === 'flex', `${T}: FAQ row #${i} is a 44px target`, `${s.h}`)
    })
    x.olds.forEach((o, i) => is(!!o.glyph && !o.shown, `${T}: svg #${i} is drawn by the icon set`, o.sig))
    await ctx.close()
  }
}

head('names and grid')
await namesAndGrid(FULL, [320, 390, 768, 1280], ['shop', 'essentials', 'product/full'], true)
head('titles')
await titles(FULL, [390, 1280], ALL_PAGES.map((x) => x.id))
head('icons')
await icons(FULL, [390, 1280], ['screen/home', 'screen/about', 'screen/checkout', 'screen/cart', 'screen/drawer', 'product/full', 'shop', 'account-out', 'account-in', 'contact'])
// the select and the FAQ must exist on the pages that hold them (the loops above would pass on an empty page)
{
  tag = null
  for (const [id, what, n] of [['account-out', 'select', 3], ['screen/checkout', 'select', 1], ['screen/about', 'summary', 5], ['shop', 'select', 1]]) {
    const { p, ctx } = await R.open(P(id), 'en', 390, FULL)
    const x = await p.evaluate(iconInfo)
    is((what === 'select' ? x.sel.length : x.sum.length) === n, `${id}: ${n} ${what}s were found and checked`, String(what === 'select' ? x.sel.length : x.sum.length))
    await ctx.close()
  }
}

head('mutation: each section removed on its own must fail its checks')
{
  const keep = { pass, fail, fails: fails.slice(), byTag: { ...byTag } }
  const plan = {
    'NAMES-1111': () => namesAndGrid(without(FULL, ['NAMES-1111']), [390], ['shop', 'product/full'], true),
    'GRID-1111': () => namesAndGrid(without(FULL, ['GRID-1111']), [390, 1280], ['shop'], false),
    'TITLES-1111': () => titles(without(FULL, ['TITLES-1111']), [390, 1280], ['screen/about', 'screen/terms', 'shop', 'screen/cart', 'account-in', 'product/full']),
    'ICON USE': () => icons(without(FULL, ['ICON USE']), [390], ['screen/about', 'account-out', 'shop']),
  }
  const res = {}
  for (const [n, run] of Object.entries(plan)) {
    for (const k of Object.keys(byTag)) delete byTag[k]
    const f0 = fail
    await run()
    res[n] = fail - f0
  }
  // restore the real results and judge the mutations
  pass = keep.pass; fail = keep.fail; fails.length = 0; fails.push(...keep.fails); for (const k of Object.keys(byTag)) delete byTag[k]
  tag = null
  for (const [n, c] of Object.entries(res)) { console.log(`without ${n}: ${c} checks fail`); is(c >= 3, `mutation: the suite fails without the ${n} section`, String(c)) }
}

await browser.close(); R.close()
if (fails.length) { console.log('\nFAILURES (first 60):'); for (const f of fails.slice(0, 60)) console.log('FAIL ' + f) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
