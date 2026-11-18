// npm run test:price-style - the PRICE-1112 section of public/sporta-shadows.css (modern prices, owner 2026-11-16), on the
// LIVE product page captured in the gallery harness (scripts/lib/gallery-page.mjs, the live build's own markup and
// rules, with every add-on stylesheet).
//
// What is proven, at 320, 390 and 1280 px, Arabic and English:
//   - off a sale the product price and a card price keep the ink colour (nothing changed for a full-price product);
//   - on a sale (the build marks the old price with an <s>, which the test adds the way the build does) the sale price
//     is the brand's deep orange, the old price is struck through in slate-500, and both pass WCAG AA for text on white;
//   - a sale does not make the page wider than the screen (no sideways scroll at 320px);
//   - MUTANT: with the section cut out of the file, the sale price is not deep orange (the check must fail).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as G from './lib/gallery-page.mjs'
import * as PRD from './lib/sizes-product-page.mjs'

const ROOT = G.ROOT
const SH = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')
// the section: from its banner to the end of its last rule
const SECTION_END = SH.indexOf('}', SH.indexOf('.catalog-product-price > s {'))
const PRICE = SH.slice(SH.indexOf('/* ==== PRICE-1112'), SECTION_END + 1)
const SH_OFF = SH.replace(PRICE, '')

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// WCAG 2.x contrast of an sRGB colour against white
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrastOnWhite = (rgb) => 1.05 / (lum(rgb) + 0.05)
const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const ref = { current: null }
const srv = await G.serve(ref)
const DEV = {
  320: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1280: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
}

async function open(lang, w, css) {
  const ctx = await browser.newContext(DEV[w])
  const p = await ctx.newPage()
  await p.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
  ref.current = { addons: { ...PRD.addonFiles(), 'sporta-shadows.css': css }, extra: G.extraCss() }
  await p.goto(`${srv.base}/__gx/full-${lang}-${w}`)
  await p.waitForTimeout(400)
  return { p, ctx }
}

// the build's sale markup: the old price in an <s> after the amount, as ProductCard.jsx writes it
const SALE = (sel) => (s) => {
  const el = document.querySelector(s)
  if (el && !el.querySelector(':scope > s')) {
    const old = document.createElement('s'); old.textContent = 'KWD 6.000'
    el.appendChild(document.createTextNode(' ')); el.appendChild(old)
  }
  return !!el
}
const read = (sel) => (s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const cs = getComputedStyle(el), st = el.querySelector(':scope > s')
  const ss = st ? getComputedStyle(st) : null
  return { color: cs.color, struck: ss ? ss.textDecorationLine : null, sColor: ss ? ss.color : null, overflow: document.documentElement.scrollWidth - innerWidth }
}

const SELS = ['.catalog-product-price', '.price-card']
for (const w of [320, 390, 1280]) for (const lang of ['en', 'ar']) {
  head(`${w}px ${lang}`)
  const o = await open(lang, w, SH)
  for (const sel of SELS) {
    const off = await o.p.evaluate(read(sel), sel)
    is(off && off.color === 'rgb(23, 26, 30)', `${w} ${lang} ${sel}: off a sale the price keeps the ink colour`, off && off.color)
    const on = await o.p.evaluate(SALE(sel), sel)
    is(on, `${w} ${lang} ${sel}: the test found the price to put a sale on`)
    const sale = await o.p.evaluate(read(sel), sel)
    const rgb = parse(sale.color), srgb = parse(sale.sColor || '')
    is(sale.color === 'rgb(179, 77, 0)', `${w} ${lang} ${sel}: on a sale the price is the brand's deep orange #B34D00`, sale.color)
    is(contrastOnWhite(rgb) >= 4.5, `${w} ${lang} ${sel}: the sale colour passes AA for text (${contrastOnWhite(rgb).toFixed(2)}:1)`)
    is(sale.struck === 'line-through', `${w} ${lang} ${sel}: the old price is struck through`, sale.struck)
    is(srgb.length === 3 && contrastOnWhite(srgb) >= 4.5, `${w} ${lang} ${sel}: the old price passes AA for text (${srgb.length ? contrastOnWhite(srgb).toFixed(2) : '?'}:1, ${sale.sColor})`)
    is(sale.overflow <= 0, `${w} ${lang} ${sel}: a sale does not make the page wider than the screen`, `${sale.overflow}px`)
  }
  await o.ctx.close()

  // MUTANT: the section cut out of the file: the sale price is not the deep orange
  const m = await open(lang, w, SH_OFF)
  await m.p.evaluate(SALE('.catalog-product-price'), '.catalog-product-price')
  const mut = await m.p.evaluate(read('.catalog-product-price'), '.catalog-product-price')
  is(mut && mut.color !== 'rgb(179, 77, 0)', `${w} ${lang}: mutant (the section cut): the sale price is NOT the deep orange, so the check above bites`, mut && mut.color)
  await m.ctx.close()
}

await browser.close(); await srv.server.close()
head('the section')
is(PRICE.includes('.catalog-product-price > s') && PRICE.includes('#B34D00'), 'the section is the one block the test cuts (PRICE-1112)', PRICE.slice(0, 40))
console.log(`\n${pass} passed, ${fail} failed`)
if (fails.length) { console.log('\nFAILED:'); for (const f of fails) console.log('  ' + f) }
process.exit(fail ? 1 : 0)
