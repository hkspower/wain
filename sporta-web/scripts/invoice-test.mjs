// The invoice, in both languages, in a real browser.
//
//   npm run test:invoice        (needs `npx vite preview --port 4173`)
//
// RTL is asserted by MEASURING GEOMETRY, not by looking for a `dir` attribute.
// A page can carry dir="rtl" and still lay its table out left-to-right, and it
// can carry the right attributes and still let the bidi algorithm rearrange an
// order number. So: where is the item column actually painted, and does the
// order number survive as a contiguous string.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const TRACK = 'SPINV0001'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => {
  fails++
  console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`)
}
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))

// ---------------------------------------------- the bidi helpers, in Node
{
  const { ltr, unbidi, hasArabic, dirFor, stamp } = await import('../src/lib/bidi.js')
  is(ltr('SP1A2B3C') !== 'SP1A2B3C', 'ltr() wraps a run in isolates')
  is(unbidi(ltr('SP1A2B3C')) === 'SP1A2B3C', 'the isolates strip cleanly again')
  is(ltr('') === '', 'an empty string stays empty rather than becoming two marks')
  is(hasArabic('جاكيت') && !hasArabic('Jacket'), 'Arabic is detected by script, not by language')
  is(dirFor('فاطمة الصباح') === 'rtl' && dirFor('Fatima Al-Sabah') === 'ltr',
     'a customer name gets the direction of its own script')
  is(/^⁦\d{4}-\d{2}-\d{2} \d{2}:\d{2}⁩$/.test(stamp('2026-07-30T21:13:00Z')),
     'a timestamp is an isolated LTR run', JSON.stringify(stamp('2026-07-30T21:13:00Z')))
  is(stamp(null) === '' && stamp('nonsense') === '', 'a missing or unparseable date renders nothing')
}

// The invoice reads from Supabase, which the built preview has no connection
// to. The RPC response is stubbed at the network layer so the PAGE is what is
// under test — its layout, its direction and its formatting.
const INVOICE = {
  track_id: TRACK,
  placed_at: '2026-07-30T21:13:02Z',
  paid_at: '2026-07-30T21:15:40Z',
  amount: 28.0,
  payment_method: 'knet',
  payment_status: 'paid',
  customer_name: 'فاطمة الصباح',
  address: {
    governorate: 'hawalli', area: 'Salmiya', block: '4',
    street: '12', building: '5', floor: '3', flat: '7',
  },
  items: [
    {
      name_en: 'Cloudsoft Jacket — Army Green', name_ar: 'جاكيت كلاودسوفت — أخضر عسكري',
      qty: 2, size: 'L', fit: 'oversize', unit_price: 10.0, line_total: 20.0,
    },
    {
      name_en: 'Cheetahs Rugby T-Shirt', name_ar: 'تيشيرت تشيتاز رَغبي',
      qty: 1, size: 'M', fit: null, unit_price: 8.0, line_total: 8.0,
    },
  ],
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

async function open(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 } })
  await ctx.addInitScript((l) => localStorage.setItem('lang', l), lang)
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('   [console]', m.text()))
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message))
  // The built site loads /config.js, which sets window.SPORTA_CONFIG — so
  // seeding it from addInitScript is overwritten a moment later. Serving the
  // stub config IS the config is the only version of this that holds.
  await page.route('**/config.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: "window.SPORTA_CONFIG={supabaseUrl:'https://stub.supabase.co',supabaseAnonKey:'stub-key'};",
    }),
  )
  await page.route('**/rest/v1/rpc/get_order_invoice', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(INVOICE),
    }),
  )
  await page.goto(`${BASE}/invoice/${TRACK}`, { waitUntil: 'networkidle' })
  await page.locator('table').waitFor({ timeout: 10000 })
  return { ctx, page }
}

// ------------------------------------------------------------- English
{
  const { ctx, page } = await open('en')
  const body = await page.locator('article').innerText()

  is(body.includes(TRACK), 'the order number is on the invoice')
  is(/Cloudsoft Jacket/.test(body), 'the item names are there')
  // Read the TOTAL CELL, not the page text — /KWD 28.000/ across the whole
  // article also matches the tax note and would pass with an empty total.
  const totalCell = (await page.locator('tfoot td').last().innerText()).trim()
  is(/28\.000/.test(totalCell), 'the total is the amount the server recorded', totalCell)
  is(/KWD\s*10\.000/.test(body), 'unit prices are the price at the time of the order')
  is(/L/.test(body) && /Oversize/i.test(body), 'the size and cut are on the line')

  // Columns run left to right in English.
  const cols = await page.$$eval('thead th', (th) => th.map((e) => e.getBoundingClientRect().x))
  is(cols[0] < cols[cols.length - 1], 'the item column is on the LEFT in English', cols.map(Math.round).join(' < '))

  await ctx.close()
}

// -------------------------------------------------------------- Arabic
{
  const { ctx, page } = await open('ar')

  is((await page.evaluate(() => document.documentElement.dir)) === 'rtl', 'the document is RTL')

  const tableDir = await page.$eval('table', (el) => getComputedStyle(el).direction)
  is(tableDir === 'rtl', 'the invoice table is RTL, not just the page', tableDir)

  // THE MEASUREMENT THAT MATTERS. Not "is there a dir attribute" — where is
  // the column actually painted? In Arabic the item column must be on the
  // right and the money on the left.
  const cols = await page.$$eval('thead th', (th) => th.map((e) => e.getBoundingClientRect().x))
  is(cols[0] > cols[cols.length - 1], 'the item column is on the RIGHT in Arabic', cols.map(Math.round).join(' > '))

  // The total must sit at the END of its own column, not drift under the item
  // names — which is what a hard-coded text-right does in an RTL table.
  const [totalX, moneyColX] = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('tfoot td')]
    const money = cells[cells.length - 1].getBoundingClientRect()
    const bodyMoney = document
      .querySelector('tbody tr:last-child td:last-child')
      .getBoundingClientRect()
    return [Math.round(money.x), Math.round(bodyMoney.x)]
  })
  is(Math.abs(totalX - moneyColX) < 4, 'the total lines up with the money column', `${totalX} vs ${moneyColX}`)

  const body = await page.locator('article').innerText()

  // The order number is a Latin run inside Arabic. Without isolation the
  // adjacent punctuation migrates and it renders reversed or broken up.
  is(body.includes(TRACK), 'the order number survives intact inside Arabic text',
     body.match(/SP\w+/)?.[0] ?? 'not found')

  // The date must not be rearranged into 30-07-2026 or have its colon moved.
  is(/2026-07-30 21:13/.test(body), 'the date is not rearranged by the bidi algorithm',
     body.match(/\d{4}-\d{2}-\d{2}[^\n]*/)?.[0] ?? 'not found')

  // Arabic copy, not English left in place.
  is(/فاتورة/.test(body), 'the invoice is in Arabic')
  is(/الصنف/.test(body) && /الكمية/.test(body), 'the table headings are translated')
  is(!/\b(Invoice|Order number|Unit price)\b/.test(body), 'no English label is left untranslated')

  // The Arabic separator, not a Latin comma. A Latin comma between Arabic
  // words is bidi-neutral and jumps to the wrong end next to a Latin run.
  is(body.includes('،'), 'the Arabic comma is used in Arabic')

  // Arabic must never be letter-spaced — it joins.
  const spacing = await page.$$eval('h1, h2, th', (els) =>
    els.map((e) => getComputedStyle(e).letterSpacing).filter((v) => v !== 'normal' && parseFloat(v) > 0),
  )
  is(spacing.length === 0, 'no Arabic heading is letter-spaced', spacing.join(', ') || 'none')

  // Money keeps Latin digits in both languages so the invoice cannot disagree
  // with the price the shopper saw on the product page.
  is(/28\.000/.test(body), 'the total renders with the same digits as the shop', body.match(/[\d.]+\s*د\.ك/)?.[0] ?? '')

  await ctx.close()
}

// -------------------------------------------------------- print layout
{
  const { ctx, page } = await open('ar')
  await page.emulateMedia({ media: 'print' })
  const hidden = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const gone = (el) => !el || getComputedStyle(el).display === 'none'
    return { header: gone(q('.app-header')), actions: gone(q('.no-print')) }
  })
  is(hidden.header, 'the site header is not printed')
  is(hidden.actions, 'the Print button does not print itself')
  const dir = await page.$eval('table', (el) => getComputedStyle(el).direction)
  is(dir === 'rtl', 'the Arabic invoice stays RTL when printed', dir)
  const repeats = await page.$eval('thead', (el) => getComputedStyle(el).display)
  is(repeats === 'table-header-group', 'the table header repeats across pages', repeats)
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} problem(s) with the invoice` : '\ninvoice: correct in both directions')
process.exit(fails ? 1 : 0)
