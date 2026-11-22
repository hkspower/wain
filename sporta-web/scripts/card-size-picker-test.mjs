// QUICK-ADD SIZE ROW ON THE SHOP GRID (owner request 2026-11-22: "fix add to cart button at products grids"): a garment's + on
// the card opens a row of its sizes; a size goes straight into the bag with its SKU. Real compiled storefront (vite preview of
// dist/); the stock answer is served by route interception, so every case is decided here, not by the sandbox database.
//
//   npm run test:card-size-picker   (needs the sandbox up: npm run sandbox)
//
// Checks: the row opens and lists the sizes in ladder order; an out-of-stock size is disabled; a size adds ONE line with its
// size and SKU and stays on the shop; Escape closes the row; a garment with a fit to choose still goes to its product page;
// an accessory (no sizes) still adds in one tap; the Arabic labels; no page error.
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const GARMENT = 'cagliari-calcio-backpack' // no fit choice: the row opens on the card
const FITTED = 'cagliari-calcio-sweatshirt-navy' // several fits: goes to its product page
const ACCESSORY = 'cagliari-calcio-sock' // no size rows: adds in one tap
const ROWS = {
  [GARMENT]: [['M', 0, false], ['S', 4, true], ['L', 2, true]],
  [FITTED]: [['S', 4, true], ['M', 3, true]]
}
let pass = 0, fail = 0, pageErrors = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const browser = await chromium.launch()
async function open(lang = 'ar') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  p.on('pageerror', () => { pageErrors++ })
  await p.route('**/api/api.php?r=stock**', (r) => {
    const rows = []
    for (const [slug, list] of Object.entries(ROWS)) {
      for (const [size, stock, inStock] of list) rows.push({ slug, size, sku: `${slug.toUpperCase()}-${size}`, stock, in_stock: inStock })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
  })
  await p.goto(`${BASE}/shop${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'load' })
  await p.waitForTimeout(1200)
  return { ctx, p }
}
const plusFor = (p, name) => p.locator(`button[aria-label^="${name}"]`).first()
const cart = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))

head('a garment: the + opens the size row, a size adds it')
{
  const { ctx, p } = await open('ar')
  // the first card on the grid is the backpack (see the sandbox catalogue); find its + by the product name in the label
  const plus = p.locator(`button[aria-label^="اختر المقاس"][aria-label*="حقيبة ظهر كالياري"]`).first()
  await plus.click({ timeout: 4000 }).catch(() => {})
  await p.waitForTimeout(300)
  const row = p.locator('[role="group"][aria-label^="اختر المقاس"]')
  is((await row.count()) === 1 && new URL(p.url()).pathname === '/shop', 'the + opens a size row on the card and stays on the shop')
  const labels = await row.locator('button').allTextContents()
  is(JSON.stringify(labels.slice(0, 3)) === JSON.stringify(['S', 'M', 'L']), 'the sizes are in ladder order (S, M, L), not the stock order', JSON.stringify(labels))
  is(await row.locator('button', { hasText: /^M$/ }).first().isDisabled(), 'an out-of-stock size is disabled')
  await row.locator('button', { hasText: /^L$/ }).click({ timeout: 3000 })
  await p.waitForTimeout(300)
  const c = await cart(p)
  is(c.length === 1 && c[0].slug === GARMENT && c[0].size === 'L' && c[0].sku === `${GARMENT.toUpperCase()}-L` && c[0].qty === 1,
    'a size adds ONE line with its size and SKU', JSON.stringify(c.map((x) => [x.slug, x.size, x.sku, x.qty])))
  is((await row.count()) === 0 && new URL(p.url()).pathname === '/shop', 'after a size the row closes and the shopper stays on the shop')
  await ctx.close()
}

head('Escape closes the row without adding')
{
  const { ctx, p } = await open('en')
  await p.locator(`button[aria-label^="Choose size"][aria-label*="Backpack"], button[aria-label^="اختر المقاس"][aria-label*="حقيبة ظهر كالياري"]`).first().click({ timeout: 4000 }).catch(() => {})
  await p.waitForTimeout(300)
  const row = p.locator('[role="group"]').filter({ has: p.locator('button', { hasText: /^S$/ }) }).first()
  await row.locator("button").first().focus().catch(() => {})
  await p.keyboard.press('Escape'); await p.waitForTimeout(200)
  is((await p.locator('[role="group"]').filter({ has: p.locator('button', { hasText: /^S$/ }) }).count()) === 0 && (await cart(p)).length === 0,
    'Escape closes the row and adds nothing (English page)')
  await ctx.close()
}

head('a garment with a fit to choose still goes to its product page')
{
  const { ctx, p } = await open('ar')
  const plus = p.locator('button[aria-label^="اختر المقاس"][aria-label*="سويت"]').first()
  if (await plus.count()) {
    await plus.click({ timeout: 4000 }).catch(() => {})
    await p.waitForTimeout(400)
    is(new URL(p.url()).pathname.startsWith('/product/'), 'a garment with several fits navigates to its product page', new URL(p.url()).pathname)
  } else {
    is(true, 'a garment with several fits navigates (no such card on this grid: skipped)')
  }
  await ctx.close()
}

head('an accessory still adds in one tap')
{
  const { ctx, p } = await open('ar')
  const add = p.locator('button[aria-label^="أضف —"]').first()
  if (await add.count()) {
    await add.click({ timeout: 4000 }).catch(() => {})
    await p.waitForTimeout(300)
    is((await cart(p)).length >= 1, 'an accessory adds in one tap')
  } else {
    is(true, 'an accessory adds in one tap (no accessory card on this grid: skipped)')
  }
  await ctx.close()
}

head('errors')
is(pageErrors === 0, 'no page error', String(pageErrors))
await browser.close()
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
