// PRODUCT CARDS 1119 of public/sporta-shadows.css + the sale-tag move of public/sporta-features.js (PRICES-1118), owner 2026-11-19:
// "improve cards style at products grids" (scans: PRODUCTS-GRID-SCAN-2026-11-18.md, CARDS-SCAN-2026-11-18.md).
//
//   npm run test:cards-1119      (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled storefront (the live bundle, captured 2026-11-03) under this repo's add-ons, /shop with sale prices, a sold-out
// sale card and a "Bestseller" badge put in the first twelve cards, Arabic and English, 320 / 390 phone, 768 and 1024 touch, 1280 mouse:
//   [pc-1] a sale card's "-N%" tag is ONE absolutely placed child of the photo frame, at its bottom-start corner, over neither the
//          heart nor the "+", never inside the price row; a sold-out card shows none; the product page keeps its tag beside the price
//   [pc-2] on a phone the current price of every card in a row starts at the same height
//   [pc-3] the Save heart is visible at rest (mouse and touch)
//   [pc-4] a sold-out card's price is the neutral grey; an in-stock price stays ink, a sale price the deep orange
//   [pc-5] the struck price is at least 13px with a 1px line
//   [pc-6] at 320px the "Bestseller" pill holds one line and clips with an ellipsis
//   [pc-7] dark theme: sale price 4.5:1 on the card, struck price 4.5:1, the heart's icon ink on its white button
// plus: no sideways scroll, no page error, equal card heights in a row, the tag follows a re-sort without doubling, and leaves when the
// struck-through price goes. MUTATION: each [pc-N] block is cut in turn, and the script's tag move once, and the matching check must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-shadows.css', JS_F = 'sporta-features.js'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8'), JS = readFileSync(join(PUB, JS_F), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ------------------------------------------------------------------------------------------------------------------ the shop's data
const ORDER = ['cloudsoft-leggings-grey', 'sculpt-jacket-black', 'vanquish-tank-navy', 'sculpt-leggings-navy', 'cloudsoft-jacket-cherry-red', 'flash-shorts-red',
  'cagliari-calcio-backpack', 'tekno-shorts-black', 'sculpt-top-grey', 'cloudsoft-top-navy', 'sculpt-top-black', 'denver-nuggets-cap-navy']
const SALE = { 'sculpt-jacket-black': [8, 10], 'vanquish-tank-navy': [4, 12], 'sculpt-leggings-navy': [49.995, 100.5], 'tekno-shorts-black': [2.4, 3], 'cloudsoft-top-navy': [3.5, 6] }
const SOLD = new Set(['tekno-shorts-black'])           // a sale card that is also sold out (cagliari-calcio-backpack is sold out in the live stock)
const products = (body) => {
  const by = Object.fromEntries(body.map((p) => [p.slug, p]))
  const head = ORDER.filter((s) => by[s]).map((s) => {
    const p = { ...by[s] }
    if (SALE[s]) { p.price = SALE[s][0]; p.list_price = SALE[s][1]; p.on_sale = true } else { p.list_price = p.price; p.on_sale = false }
    return p
  })
  return [...head, ...body.filter((p) => !ORDER.includes(p.slug))]
}
const stock = (body) => body.map((r) => (SOLD.has(r.slug) ? { ...r, stock: 0, in_stock: false } : r))

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive({ api: { products, stock }, ...opts }); try { return await fn(srv) } finally { await srv.close() } }
const open = async (srv, { w, lang, path = '/shop', touch = w < 500, dark = false, h = 900 }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, serviceWorkers: 'block', colorScheme: 'light' })
  if (dark) await ctx.addInitScript(() => { try { localStorage.setItem('sporta_theme', 'dark'); localStorage.setItem('sporta_theme_explicit', '1') } catch (e) { /* none */ } })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(srv.base + path + (path.includes('?') ? '&' : '?') + 'lang=' + lang, { waitUntil: 'load' })
  await p.waitForSelector('.product-grid-card .price-card > s', { timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(900)
  return { ctx, p, errs }
}

// everything one card shows, read in the page
const MEASURE = () => {
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top + scrollY, b: r.bottom + scrollY, w: r.width, h: r.height } }
  const hit = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
  const rtl = document.documentElement.dir === 'rtl'
  const cards = [...document.querySelectorAll('.product-grid-card')].map((c) => {
    const frame = c.querySelector(':scope > .catalog-card-image'), price = c.querySelector('.price-card'), s = price && price.querySelector(':scope > s')
    const tags = [...c.querySelectorAll('[data-sporta-off]')], tag = tags[0] || null
    const heart = c.querySelector('.catalog-card-save'), add = c.querySelector('.catalog-card-add'), badge = c.querySelector('.catalog-card-badge')
    const sold = !!c.querySelector('.catalog-card-image a > span.absolute.inset-x-0[class*="bg-ink"]')
    const fr = frame && rect(frame), tr = tag && tag.getClientRects().length ? rect(tag) : null
    const pc = price && getComputedStyle(price), sc = s && getComputedStyle(s)
    return {
      slug: (c.querySelector('a[href^="/product/"]') || {}).getAttribute ? c.querySelector('a[href^="/product/"]').getAttribute('href').replace('/product/', '') : '',
      top: rect(c).t, h: rect(c).h, sale: !!s, sold,
      tags: tags.length, tagInFrame: !!tag && tag.parentElement === frame, tagInPrice: !!price && !!price.querySelector('[data-sporta-off]'),
      tagText: tag ? tag.textContent : '', tagPos: tag ? getComputedStyle(tag).position : '', tagDisplay: tag ? getComputedStyle(tag).display : '',
      tagDir: tag ? getComputedStyle(tag).direction : '', tagBidi: tag ? getComputedStyle(tag).unicodeBidi : '',
      tagBottomGap: tr && fr ? fr.b - tr.b : null, tagStartGap: tr && fr ? (rtl ? fr.r - tr.r : tr.l - fr.l) : null, tagInside: !!(tr && fr && tr.l >= fr.l - 0.5 && tr.r <= fr.r + 0.5 && tr.t >= fr.t - 0.5 && tr.b <= fr.b + 0.5),
      tagOverlap: tr ? Math.max(heart ? hit(tr, rect(heart)) : 0, add && add.getClientRects().length ? hit(tr, rect(add)) : 0) : 0,
      priceTop: price ? rect(price).t : null, priceColor: pc ? pc.color : '', priceLines: price ? Math.round(rect(price).h / (parseFloat(pc.lineHeight) || 20)) : 0,
      sameLine: !!(s && price && price.firstChild && Math.abs(rect(s).t - rect(price).t) < 6),
      sSize: sc ? parseFloat(sc.fontSize) : 0, sThick: sc ? sc.textDecorationThickness : '', sColor: sc ? sc.color : '',
      heartOpacity: heart ? getComputedStyle(heart).opacity : null, heartColor: heart ? getComputedStyle(heart).color : '',
      badge: badge ? { inFrame: (() => { const f = c.querySelector(':scope > .catalog-card-image').getBoundingClientRect(), b = badge.getBoundingClientRect(); return b.left >= f.left - 0.5 && b.right <= f.right + 0.5 })(), ws: getComputedStyle(badge).whiteSpace, to: getComputedStyle(badge).textOverflow, ovf: getComputedStyle(badge).overflow, h: rect(badge).h } : null,
    }
  })
  const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g); if (m && (m.length === 3 || Number(m[3]) > 0.99)) return m.slice(0, 3).map(Number) } return [255, 255, 255] }
  const first = document.querySelector('.product-grid-card')
  return { cards, over: document.documentElement.scrollWidth - innerWidth, cardBg: first ? bgOf(first) : null, rtl }
}

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const rgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number)
const rows = (cards) => { const m = new Map(); for (const c of cards) { const k = Math.round(c.top / 3); m.set(k, [...(m.get(k) || []), c]) } return [...m.values()] }

// ------------------------------------------------------------------------------------------------------------------ the checks
// each returns true/false for ONE configuration so the mutants can run the same code on a cut file
const CHECK = {
  tag: (m) => { const sc = m.cards.filter((c) => c.sale && !c.sold); return sc.length >= 3 && sc.every((c) => c.tags === 1 && c.tagInFrame && c.tagPos === 'absolute' && c.tagInside && !c.tagInPrice && c.tagOverlap === 0 && c.tagBottomGap >= 4 && c.tagBottomGap <= 14 && c.tagStartGap >= 4 && c.tagStartGap <= 14) },
  tagRtl: (m) => m.cards.filter((c) => c.sale && !c.sold).every((c) => c.tagDir === 'ltr' && /^[−-]\d+[%٪]$/.test(c.tagText)),
  noTagSold: (m) => { const c = m.cards.find((x) => x.sale && x.sold); return !!c && c.tagDisplay === 'none' },
  align: (m) => rows(m.cards).filter((r) => r.length > 1 && r.some((c) => c.sale)).every((r) => Math.max(...r.map((c) => c.priceTop)) - Math.min(...r.map((c) => c.priceTop)) <= 1),
  heart: (m) => m.cards.length >= 8 && m.cards.every((c) => c.heartOpacity === '1'),
  soldGrey: (m) => { const s = m.cards.filter((c) => c.sold); return s.length >= 2 && s.every((c) => c.priceColor === 'rgb(89, 101, 113)') && ratio(rgb('rgb(89, 101, 113)'), [255, 255, 255]) >= 4.5 },
  stockInk: (m) => { const p = m.cards.find((c) => !c.sold && !c.sale), s = m.cards.find((c) => !c.sold && c.sale); return !!p && !!s && p.priceColor === 'rgb(23, 26, 30)' && s.priceColor === 'rgb(179, 77, 0)' },
  struck: (m) => { const s = m.cards.filter((c) => c.sale); return s.length >= 3 && s.every((c) => c.sSize >= 12.99 && c.sThick === '1px') },
  oneLine: (m) => { const c = m.cards.find((x) => x.slug === 'sculpt-jacket-black'); return !!c && c.sameLine },
  badge: (m) => { const b = m.cards.filter((c) => c.badge); return b.length >= 1 && b.every((c) => c.badge.ws === 'nowrap' && c.badge.to === 'ellipsis' && c.badge.inFrame) },
  dark: (m) => { const s = m.cards.find((c) => !c.sold && c.sale); return !!s && ratio(rgb(s.priceColor), m.cardBg) >= 4.5 && ratio(rgb(s.sColor), m.cardBg) >= 4.5 },
  heartInk: (m) => m.cards.every((c) => !c.heartColor || c.heartColor === 'rgb(23, 26, 30)'),
  noScroll: (m) => m.over <= 0,
  heights: (m) => rows(m.cards).every((r) => Math.max(...r.map((c) => c.h)) - Math.min(...r.map((c) => c.h)) <= 1),
}

const CONFIGS = [[390, 'ar'], [390, 'en'], [320, 'ar'], [320, 'en'], [768, 'ar'], [1024, 'en'], [1280, 'en'], [1280, 'ar']]
const run = async (opts, o) => withServer(opts, async (srv) => { const t = await open(srv, o); const m = await t.p.evaluate(MEASURE); await t.ctx.close(); return { m, errs: t.errs } })

// ---- 1. the real files
head('the real files, on the real compiled storefront')
for (const [w, lang] of CONFIGS) {
  const { m, errs } = await run({}, { w, lang })
  const tag = `${lang} ${w}px`
  is(CHECK.tag(m), `${tag}: every sale card has ONE "-N%" tag, a child of its photo frame, absolute, in the bottom-start corner, over neither heart nor "+", not in the price row`)
  is(CHECK.tagRtl(m), `${tag}: the tag reads left to right ("-20%", never "20%-") in both languages`, JSON.stringify(m.cards.filter((c) => c.sale).map((c) => [c.tagText, c.tagDir])))
  is(CHECK.noTagSold(m), `${tag}: a sold-out sale card shows no tag`)
  is(CHECK.heart(m), `${tag}: the Save heart is visible at rest on every card`, JSON.stringify([...new Set(m.cards.map((c) => c.heartOpacity))]))
  is(CHECK.soldGrey(m), `${tag}: a sold-out card's price is the neutral grey (6:1 on white)`, JSON.stringify(m.cards.filter((c) => c.sold).map((c) => c.priceColor)))
  is(CHECK.stockInk(m), `${tag}: an in-stock price stays ink and an in-stock sale price the deep orange`)
  is(CHECK.struck(m), `${tag}: the struck price is 13px or more with a 1px line`, JSON.stringify(m.cards.filter((c) => c.sale).map((c) => [c.sSize, c.sThick])))
  if (w >= 768) is(CHECK.oneLine(m), `${tag}: the current and struck price share one line (the tag is no longer in the row)`)
  if (w < 640) is(CHECK.align(m), `${tag}: in every row with a sale card the prices start at the same height`, JSON.stringify(rows(m.cards).map((r) => r.map((c) => Math.round(c.priceTop)))))
  is(CHECK.noScroll(m) && CHECK.heights(m), `${tag}: no sideways scroll, equal card heights in a row`, `${m.over}px`)
  is(errs.length === 0, `${tag}: no page error`, errs.join(' | '))
}
{ // 320px badge
  for (const lang of ['ar', 'en']) { const { m } = await run({}, { w: 320, lang }); is(CHECK.badge(m), `${lang} 320px: the "Bestseller" pill holds one line and clips with an ellipsis`, JSON.stringify(m.cards.filter((c) => c.badge).map((c) => c.badge))) }
}
{ // dark
  for (const [w, lang] of [[390, 'ar'], [1280, 'en']]) {
    const { m } = await run({}, { w, lang, dark: true })
    is(CHECK.dark(m), `${lang} ${w}px dark: the sale price and the struck price are 4.5:1 on the card`, `card ${JSON.stringify(m.cardBg)} sale ${m.cards.find((c) => c.sale && !c.sold)?.priceColor}`)
    is(CHECK.heartInk(m), `${lang} ${w}px dark: the heart's icon is ink on its white button`)
  }
}
{ // touch tablet: the heart used to be invisible from 1024px; the product page keeps its tag
  const { m } = await run({}, { w: 1180, lang: 'en', touch: true, h: 820 })
  is(CHECK.heart(m), '1180px touch tablet: the heart is visible at rest')
  const t = await withServer({}, async (srv) => {
    const o = await open(srv, { w: 1280, lang: 'en', path: '/product/sculpt-jacket-black' })
    const r = await o.p.evaluate(() => ({ page: !!document.querySelector('.catalog-product-price > [data-sporta-off]'), save: !!document.querySelector('[data-sporta-save]'), related: [...document.querySelectorAll('.catalog-related .product-grid-card')].filter((c) => c.querySelector('.price-card > s')).every((c) => !!c.querySelector(':scope > .catalog-card-image > [data-sporta-off]')) }))
    await o.ctx.close(); return r
  })
  is(t.page && t.save, 'the product page keeps its "% off" tag beside the price and its "You save" line', JSON.stringify(t))
  is(t.related, 'the cards of the related row carry their tag on the photo too')
}
{ // a re-sort and a price that stops being a sale
  await withServer({}, async (srv) => {
    const o = await open(srv, { w: 1280, lang: 'en' })
    const count = () => o.p.evaluate(() => ({ tags: document.querySelectorAll('.catalog-card-image > [data-sporta-off]').length, sales: [...document.querySelectorAll('.product-grid-card')].filter((c) => c.querySelector('.price-card > s')).length, inPrice: document.querySelectorAll('.price-card [data-sporta-off]').length }))
    const before = await count()
    await o.p.selectOption('select.catalog-sort-select', { index: 1 }).catch(() => {}); await o.p.waitForTimeout(700)
    const after = await count()
    is(before.tags === before.sales && after.tags === after.sales && after.inPrice === 0, 'after a re-sort there is one tag per sale card (no doubles, none left behind)', JSON.stringify({ before, after }))
    await o.p.evaluate(() => { const s = document.querySelector('.product-grid-card .price-card > s'); if (s) s.remove() }); await o.p.waitForTimeout(500)
    const gone = await count()
    is(gone.tags === after.tags - 1, 'a card whose struck price goes loses its tag', JSON.stringify({ after, gone }))
    await o.ctx.close()
  })
}

// ---- 2. mutants: cut one block, the check written for it must fail
head('mutants: with one rule cut, the matching check fails')
const block = (css, n) => {
  const a = css.indexOf(`/* [pc-${n}] */`)
  const next = [css.indexOf(`/* [pc-${n + 1}] */`, a), css.indexOf('/* ==== end PRODUCT CARDS 1119 */', a)].filter((x) => x > 0)
  return a < 0 ? css : css.slice(0, a) + css.slice(Math.min(...next))
}
const MUT = [
  ['pc-1 the tag placement', { css: block(CSS, 1) }, { w: 390, lang: 'en' }, CHECK.tag],
  ['pc-1 the sold-out tag rule', { css: CSS.replace(/(\.catalog-card-image > \[data-sporta-off\] \{\n  display: none;\n\})/, '/* cut */') }, { w: 390, lang: 'en' }, CHECK.noTagSold],
  ['pc-2 the phone price alignment', { css: block(CSS, 2) }, { w: 390, lang: 'ar' }, CHECK.align],
  ['pc-3 the heart at rest', { css: block(CSS, 3) }, { w: 1280, lang: 'en' }, CHECK.heart],
  ['pc-4 the sold-out grey', { css: block(CSS, 4) }, { w: 390, lang: 'en' }, CHECK.soldGrey],
  ['pc-5 the struck price', { css: block(CSS, 5) }, { w: 390, lang: 'en' }, CHECK.struck],
  ['pc-6 the Bestseller pill', { css: block(CSS, 6) }, { w: 320, lang: 'en' }, CHECK.badge],
  ['pc-7 the dark prices', { css: block(CSS, 7) }, { w: 390, lang: 'ar', dark: true }, CHECK.dark],
  ['the script puts the tag back in the price row', { js: JS.replace('(frame || el).appendChild(badge)', 'el.appendChild(badge)') }, { w: 390, lang: 'en' }, CHECK.tag],
]
for (const [label, files, o, check] of MUT) {
  const opts = {}
  if (files.css !== undefined) { if (files.css === CSS) { is(false, `mutant "${label}": the cut text was found`); continue } opts.css = { [CSS_F]: files.css } }
  if (files.js !== undefined) { if (files.js === JS) { is(false, `mutant "${label}": the cut text was found`); continue } opts.js = { [JS_F]: files.js } }
  const good = check((await run({}, o)).m), bad = check((await run(opts, o)).m)
  is(good === true, `mutant "${label}": the check passes on the real files`)
  is(bad === false, `mutant "${label}": and goes red with it cut`)
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
