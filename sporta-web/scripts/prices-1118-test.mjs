// PRICES-1118 (owner, 2026-11-18: "make total prices and original prices and make sale price by percent"): what the storefront shows
// of a sale, in a real browser. The add-on script is public/sporta-features.js (block PRICES-1118) and the rules are in
// public/sporta-shadows.css (SALE PRICE 1118).
//
//   npm run test:prices-1118   (rig-free: the bag page and the bag drawer are the LIVE compiled markup (scripts/fixtures/sizes-screen),
//                               under the live compiled rules and the 14 add-on stylesheets in the live order; a product card and a
//                               product page are made with the exact markup the live bundle renders for a sale price; the public
//                               products list is answered by route interception)
//
// Asserted:
//   cards and product page - a "-20%" badge beside the struck-through original (the percent worked out from the two amounts ON SCREEN),
//                            none without a struck-through price, removed when the sale goes, never doubled; the product page also says
//                            "You save KWD 2.000 (20%)"; Arabic keeps its digits and wording; the badge is the logo orange with near-black
//                            text (contrast >= 4.5), the saving line the dark orange step, no red anywhere on an added node;
//   the bag (page and drawer) - a line with two or more pieces gets its line total, a line of one does not, the total follows the quantity;
//                            (the line total sits in the quantity row of the PAGE, the original inline in the unit-price line, so no line is added and nothing moves)
//                            a line whose product is on sale NOW and was added at that price gets "Was KWD 12.500 · -20%"; a line whose stored
//                            price is not today's price gets nothing (no saving the shop cannot prove); the bag page's summary gets the
//                            Original total and You save rows above the Subtotal, the app's own Subtotal and unit prices are untouched;
//                            ONE products request, and none at all when no bag line is on screen; a failed request leaves the line totals;
//   no sideways scroll at 320 px, no page errors. MUTATIONS at the end.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, addonFiles, serveFx } from './lib/cart-ux-page.mjs'

const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const FEATURES = readFileSync(join(PUB, 'sporta-features.js'), 'utf8')
const SHADOWS = readFileSync(join(PUB, 'sporta-shadows.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => String(s || '').replace(/[\s ‏]+/g, ' ').trim()

const ref = { current: addonFiles(), script: FEATURES }
const { server, base } = await serveFx(ref)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

const NAMES = { en: ['Vanquish T-Shirt — Navy Blue', 'Cloudsoft Leggings — Grey'], ar: ['تيشيرت فانكويش — كحلي', 'ليقنز كلاودسوفت — رمادي'] }
const LIST = (o = {}) => [
  { slug: 'vanquish-t-shirt-navy-blue', name_en: NAMES.en[0], name_ar: NAMES.ar[0], price: o.price1 ?? 10, list_price: o.list1 ?? 12.5, on_sale: o.sale1 ?? true },
  { slug: 'cloudsoft-leggings-grey', name_en: NAMES.en[1], name_ar: NAMES.ar[1], price: 4.5, list_price: 4.5, on_sale: false },
]
async function open(page, lang, { w = 1280, list = LIST(), fail: failApi = false, dark = false, js = FEATURES, css = null } = {}) {
  ref.script = js
  if (css) ref.current = { ...addonFiles(), 'sporta-shadows.css': css }; else ref.current = addonFiles()
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: 'block' })
  const pg = await ctx.newPage()
  const errors = [], calls = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|404/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.route('**/api/api.php?r=products', (route) => { calls.push(1); return failApi ? route.fulfill({ status: 500, body: '{}' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) }) })
  await pg.goto(`${base}/__fx/${page}-${lang}?js=1`)
  if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await pg.waitForTimeout(500)
  return { ctx, pg, errors, calls }
}
const text = async (pg, sel) => norm(await pg.locator(sel).first().textContent().catch(() => ''))
const count = (pg, sel) => pg.locator(sel).count()

// the exact markup of the live bundle (ProductCard: price-card; ProductDetail: catalog-product-price), at 8.000 from 10.000
const CARD = (lang) => lang === 'ar'
  ? '<span class="price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums">٨٫٠٠٠ د.ك.‏<s class="text-xs font-semibold text-slate-400">١٠٫٠٠٠ د.ك.‏</s><span class="sr-only">١٠٫٠٠٠ د.ك.‏ → ٨٫٠٠٠ د.ك.‏</span></span>'
  : '<span class="price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums">KWD&nbsp;8.000<s class="text-xs font-semibold text-slate-400">KWD&nbsp;10.000</s><span class="sr-only">KWD&nbsp;10.000 → KWD&nbsp;8.000</span></span>'
const PAGEPRICE = (lang) => lang === 'ar'
  ? '<p class="catalog-product-price text-accent mt-6 flex items-baseline gap-3 font-display text-[1.75rem] font-bold tabular-nums">٨٫٠٠٠ د.ك.‏<s class="text-lg font-semibold text-slate-400">١٠٫٠٠٠ د.ك.‏</s></p>'
  : '<p class="catalog-product-price text-accent mt-6 flex items-baseline gap-3 font-display text-[1.75rem] font-bold tabular-nums">KWD&nbsp;8.000<s class="text-lg font-semibold text-slate-400">KWD&nbsp;10.000</s></p>'
const inject = (pg, html) => pg.evaluate((h) => { const m = document.querySelector('main') || document.body; const d = document.createElement('div'); d.id = 'fx-inject'; d.innerHTML = h; m.prepend(d) }, html)

// =============================================================================================== 1. cards and the product page
head('cards and the product page')
for (const lang of ['en', 'ar']) {
  const { pg, errors, ctx } = await open('home', lang)
  await inject(pg, `<div class="storefront-root">${CARD(lang)}</div><div class="storefront-root">${PAGEPRICE(lang)}</div>`)
  await pg.waitForTimeout(300)
  const badge = await text(pg, '.price-card > [data-sporta-off]')
  is(lang === 'en' ? badge === '−20%' : /^−٢٠٪$/.test(badge), `${lang}: the card badge reads ${lang === 'en' ? '-20%' : '−٢٠٪ (Arabic digits)'}`, badge)
  const pb = await text(pg, '.catalog-product-price > [data-sporta-off]')
  is(lang === 'en' ? pb === '20% off' : /^خصم ٢٠٪$/.test(pb), `${lang}: the product page badge reads "${lang === 'en' ? '20% off' : 'خصم ٢٠٪'}"`, pb)
  const sv = await text(pg, '[data-sporta-save]')
  is(lang === 'en' ? /^You save KWD 2\.000 \(20%\)$/.test(sv) : /^توفّر ٢٫٠٠٠ د\.ك\.‏? \(٢٠٪\)$/.test(sv.replace(/‏/g, '')), `${lang}: "You save 2.000 (20%)" in the page's own digits and currency`, sv)
  is(await count(pg, '[data-sporta-off]') === 2 && await count(pg, '[data-sporta-save]') === 1, `${lang}: one badge per price, one saving line`)
  await pg.evaluate(() => document.body.appendChild(document.createElement('i')))   // an unrelated mutation must not double anything
  await pg.waitForTimeout(150)
  is(await count(pg, '[data-sporta-off]') === 2, `${lang}: an unrelated change does not double the badges`)
  const st = await pg.evaluate(() => { const b = document.querySelector('.price-card > [data-sporta-off]'), s = document.querySelector('[data-sporta-save]'); const cs = getComputedStyle(b), ss = getComputedStyle(s); return { bg: cs.backgroundColor, fg: cs.color, save: ss.color } })
  is(st.bg === 'rgb(255, 123, 23)' && st.fg === 'rgb(23, 26, 30)', `${lang}: the badge is the logo orange (#FF7B17) with near-black text`, JSON.stringify(st))
  is(st.save === 'rgb(179, 77, 0)', `${lang}: the saving line is the dark orange step (#B34D00)`, st.save)
  const red = await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-off],[data-sporta-save]')].some((e) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(e).color + ' ' + getComputedStyle(e).backgroundColor); return m && +m[1] > 180 && +m[2] < 80 && +m[3] < 100 }))
  is(!red, `${lang}: no red on an added node`)
  // the sale ends: the struck-through price goes, so do the badge and the saving
  await pg.evaluate(() => document.querySelectorAll('.price-card > s, .catalog-product-price > s').forEach((s) => s.remove()))
  await pg.waitForTimeout(250)
  is(await count(pg, '[data-sporta-off]') === 0 && await count(pg, '[data-sporta-save]') === 0, `${lang}: when the struck-through price goes, the badge and the saving go too`)
  is(errors.length === 0, `${lang}: no page errors`, errors.join(' | '))
  await ctx.close()
}
{
  const { pg, ctx } = await open('home', 'en', { dark: true })
  await inject(pg, `<div class="storefront-root">${PAGEPRICE('en')}</div>`)
  await pg.waitForTimeout(250)
  is(await pg.evaluate(() => getComputedStyle(document.querySelector('[data-sporta-save]')).color) === 'rgb(255, 123, 23)', 'dark theme: the saving line is the logo orange')
  await ctx.close()
}

// =============================================================================================== 2. the bag page
head('the bag page')
for (const lang of ['en', 'ar']) {
  const { pg, errors, calls, ctx } = await open('cart', lang)
  const lines = pg.locator('.cart-line')
  const l1 = lines.nth(0), l2 = lines.nth(1)
  const was1 = norm(await l1.locator('[data-sporta-was]').textContent().catch(() => ''))
  is(lang === 'en' ? /^· Was KWD 12\.500 \(−20%\)$/.test(was1) : /^· كان 12\.500 د\.ك\.? \(−20٪\)$/.test(was1.replace(/\u200f/g, '')), `${lang}: line 1 (on sale now, added at today's price) shows its original and the percent, inline in the unit-price line`, was1)
  is(await l1.locator('p [data-sporta-was]').count() === 1, `${lang}: the original sits INSIDE the unit-price line (no new line, nothing moves)`)
  is(await l1.locator('[data-sporta-line]').count() === 0, `${lang}: line 1 has one piece: no line total`)
  const lt2 = norm(await l2.locator('[data-sporta-line]').textContent().catch(() => ''))
  is(lang === 'en' ? lt2 === 'KWD 9.000' : /^9\.000 د\.ك\.?$/.test(lt2.replace(/\u200f/g, '')), `${lang}: line 2 (two pieces at 4.500) shows its line total 9.000`, lt2)
  is(await l2.locator('.cart-line__controls > [data-sporta-line]').count() === 1 && /Line total|إجمالي السطر/.test((await l2.locator('[data-sporta-line]').getAttribute('aria-label')) || ''), `${lang}: the total sits in the quantity row (no new line) and is named "Line total" for a screen reader`)
  is(await l2.locator('[data-sporta-was]').count() === 0, `${lang}: line 2 is not on sale: no original`)
  const rows = await pg.locator('.purchase-cart__summary [data-sporta-sumrows] > p').allTextContents()
  const r = rows.map(norm)
  is(r.length === 2 && (lang === 'en' ? /^Original total ?KWD 21\.500$/.test(r[0]) && /^You save ?−KWD 2\.500$/.test(r[1]) : /21\.500/.test(r[0]) && /2\.500/.test(r[1])), `${lang}: the summary shows Original total 21.500 and You save 2.500`, r.join(' / '))
  is(await pg.evaluate(() => { const rows = document.querySelector('[data-sporta-sumrows]'), t = document.querySelector('.purchase-cart__summary .purchase-total'); return rows.nextElementSibling === t }), `${lang}: the rows sit directly above the Subtotal row`)
  is(/19\.000|١٩٫٠٠٠/.test(await text(pg, '.purchase-total')) && await count(pg, '.purchase-total [data-sporta-off]') === 0, `${lang}: the app's own Subtotal (19.000) is untouched`)
  is(await text(pg, '.cart-line:first-child p.text-slate-500') !== '' && /10\.000|١٠٫٠٠٠/.test(await text(pg, '.cart-line:first-child p.text-slate-500')), `${lang}: the unit price the app draws is untouched`)
  is(calls.length === 1, `${lang}: ONE products request`, String(calls.length))
  // the quantity moves the line total
  await pg.evaluate(() => { document.querySelectorAll('.cart-line')[1].querySelector('.purchase-quantity > span').textContent = '3' })
  await pg.waitForTimeout(250)
  const lt3 = norm(await l2.locator('[data-sporta-line]').textContent().catch(() => ''))
  is(/13\.500|١٣٫٥٠٠/.test(lt3), `${lang}: quantity 3 -> line total 13.500`, lt3)
  await pg.evaluate(() => { document.querySelectorAll('.cart-line')[1].querySelector('.purchase-quantity > span').textContent = '1' })
  await pg.waitForTimeout(250)
  is(await l2.locator('[data-sporta-line]').count() === 0, `${lang}: back to one piece: the line total goes`)
  is(errors.length === 0, `${lang}: no page errors`, errors.join(' | '))
  await ctx.close()
}
{
  const { pg, ctx } = await open('cart', 'en', { list: LIST({ price1: 9, list1: 12.5 }) })
  is(await count(pg, '[data-sporta-was]') === 0 && await count(pg, '[data-sporta-sumrows]') === 0, 'a line added at 10.000 while the product costs 9.000 today gets no original and no summary rows (no saving the shop cannot prove)')
  is(await count(pg, '[data-sporta-line]') === 1, '... the line total of the two-piece line still shows')
  await ctx.close()
}
{
  const { pg, ctx } = await open('cart', 'en', { list: LIST({ sale1: false, list1: 10, price1: 10 }) })
  is(await count(pg, '[data-sporta-was]') === 0 && await count(pg, '[data-sporta-sumrows]') === 0, 'a product that is not on sale: no original, no rows')
  await ctx.close()
}
{
  const { pg, calls, ctx } = await open('cart', 'en', { fail: true })
  is(await count(pg, '[data-sporta-was]') === 0 && await count(pg, '[data-sporta-line]') === 1 && calls.length === 1, 'the products list failing leaves the line totals and asks once, not in a loop', String(calls.length))
  await ctx.close()
}
{
  const { pg, calls, ctx } = await open('about', 'en')
  is(calls.length === 0, 'a page with no bag line makes no products request')
  await ctx.close()
}
{
  const { pg, ctx } = await open('cart', 'en', { w: 320 })
  const w = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  is(w.doc <= w.win + 1, 'no sideways scroll at 320 px', JSON.stringify(w))
  await ctx.close()
}

// =============================================================================================== 3. the bag drawer
head('the bag drawer')
{
  const { pg, errors, ctx } = await open('drawer', 'en')
  const lines = pg.locator('.cart-drawer__line')
  is(/^· Was KWD 12\.500 \(−20%\)$/.test(norm(await lines.nth(0).locator('[data-sporta-was]').textContent().catch(() => ''))), 'drawer line 1: the original and the percent, inline')
  is(await count(pg, '[data-sporta-line]') === 0, 'the drawer is too narrow for a third item in the quantity row: no line total there (the app\'s subtotal stays)')
  is(await count(pg, '[data-sporta-sumrows]') === 0, 'the drawer has no summary rows (its own total is the app\'s)')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await ctx.close()
}

// =============================================================================================== 4. mutations
head('mutations (each must turn the suite red)')
async function mutant(name, edit, probe, { css = null } = {}) {
  const js = edit(FEATURES)
  if (!css && js === FEATURES) { is(false, `${name}: the edit did not apply`); return }
  is(await probe(js, css), `${name}: caught`)
}
await mutant('the percent is worked out from the wrong base', (s) => s.replace('(list - now) / list * 100', '(list - now) / now * 100'), async (js) => {
  const { pg, ctx } = await open('home', 'en', { js }); await inject(pg, `<div class="storefront-root">${CARD('en')}</div>`); await pg.waitForTimeout(250)
  const t = await text(pg, '[data-sporta-off]'); await ctx.close(); return t !== '−20%'
})
await mutant('no stale-price proof (a changed price still shows a saving)', (s) => s.replace(' && Math.abs(rec.price - u) < 0.0005', ''), async (js) => {
  const { pg, ctx } = await open('cart', 'en', { js, list: LIST({ price1: 9, list1: 12.5 }) })
  const n = await count(pg, '[data-sporta-was]'); await ctx.close(); return n > 0
})
await mutant('line total shown for one piece too', (s) => s.replace('if (controls && q >= 2) {', 'if (controls && q >= 1) {'), async (js) => {
  const { pg, ctx } = await open('cart', 'en', { js }); const n = await count(pg, '[data-sporta-line]'); await ctx.close(); return n === 2
})
await mutant('a request on every pass (no once-only guard)', (s) => s.replace("if (listState !== 'idle') return", ''), async (js) => {
  const { pg, calls, ctx } = await open('cart', 'en', { js }); await pg.evaluate(() => document.body.appendChild(document.createElement('i'))); await pg.waitForTimeout(300); await ctx.close(); return calls.length > 1
})
await mutant('no summary rows', (s) => s.replace("rows2 = document.createElement('div'); rows2.setAttribute('data-sporta-sumrows', '')", "return"), async (js) => {
  const { pg, ctx } = await open('cart', 'en', { js }); const n = await count(pg, '[data-sporta-sumrows]'); await ctx.close(); return n === 0
})
await mutant('the add-on stylesheet block missing', (s) => s, async (js) => {
  const cut = SHADOWS.replace(/\/\* ==== SALE PRICE 1118[\s\S]*?\/\* ==== end SALE PRICE 1118 \*\//, '')
  const { pg, ctx } = await open('home', 'en', { css: cut }); await inject(pg, `<div class="storefront-root">${CARD('en')}</div>`); await pg.waitForTimeout(250)
  const bg = await pg.evaluate(() => getComputedStyle(document.querySelector('[data-sporta-off]')).backgroundColor); await ctx.close(); return bg !== 'rgb(255, 123, 23)'
}, { css: true })

await browser.close(); server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
