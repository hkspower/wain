// The suggested-prices list (block "ADMIN SUGGESTED PRICES", public/sporta-admin-brands.js): a read-only list of every product
// with its cost, the price the shop charges now, and the suggested price, opened from the Catalogue header.
//
//   npm run test:admin-suggested-prices   (no database, no PHP: the stock list is a fake answered by route interception;
//                                          the REAL add-on file runs in Chromium)
//
// What is asserted:
//   0. static: the block has its markers, no timer, no innerHTML, no console, no observer; one fetch, a GET of the stock list;
//   1. the button: once, in the Catalogue header, gone on another screen; the list starts closed; Escape closes it and gives
//      the focus back to the button;
//   2. the list: one GET and no write; each product once; its cost is the highest of its sizes; the suggestion is the cost plus
//      the mark-up, rounded UP to 0.250 KWD; the difference and its percent; the products furthest below their suggestion first;
//      a product with no cost is "no cost yet" at the end; a cost too high to store says "too high", never a rounded number;
//   3. the mark-up: changes every suggestion; 0, 501, 12.5 and blank are refused with a sentence and keep the last list;
//   4. Arabic: the button and the list are Arabic and right to left, with the same figures;
//   5. a failed stock list says so, and "Try again" reads it again;
//   6. MUTATION: with the rounding taken out of the rule, the beta jacket's suggestion changes (so check 2 would fail).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== ADMIN SUGGESTED PRICES - begin')
const END_MARK = '/* ===== ADMIN SUGGESTED PRICES - end'
const END = ADDON.indexOf(END_MARK)
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
// comments are for people; the negative checks read the code only
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// the stock list: one row per size, as admin.php ?r=variants answers it
const ROWS = [
  { slug: 'alpha-tee', name_en: 'Alpha Tee', name_ar: 'تي ألفا', size: 'M', sku: 'A-M', price: 10, on_sale: false, unit_cost_kwd: 4.2, stock: 3 },
  { slug: 'alpha-tee', name_en: 'Alpha Tee', name_ar: 'تي ألفا', size: 'L', sku: 'A-L', price: 10, on_sale: false, unit_cost_kwd: 4.5, stock: 2 },
  { slug: 'beta-jacket', name_en: 'Beta Jacket', name_ar: 'جاكيت بيتا', size: 'M', sku: 'B-M', price: 12.25, on_sale: false, unit_cost_kwd: 4.201, stock: 1 },
  { slug: 'gamma-cap', name_en: 'Gamma Cap', name_ar: 'قبعة جاما', size: 'ONE', sku: 'G-1', price: 6, on_sale: false, unit_cost_kwd: 2, stock: 4 },
  { slug: 'delta-bag', name_en: 'Delta Bag', name_ar: 'حقيبة دلتا', size: 'ONE', sku: 'D-1', price: 5, on_sale: false, unit_cost_kwd: 4, stock: 4 },
  { slug: 'epsilon-sale', name_en: 'Epsilon Sale', name_ar: 'إبسيلون', size: 'M', sku: 'E-M', price: 9, on_sale: true, unit_cost_kwd: 3, stock: 2 },
  { slug: 'zeta-nocost', name_en: 'Zeta No Cost', name_ar: 'زيتا', size: 'M', sku: 'Z-M', price: 7, on_sale: false, unit_cost_kwd: null, stock: 2 },
  { slug: 'eta-high', name_en: 'Eta High', name_ar: 'إيتا', size: 'M', sku: 'H-M', price: 10, on_sale: false, unit_cost_kwd: 9999999.999, stock: 1 },
]
// the expected list at a 100% mark-up, furthest below first
const EXPECT = [
  ['Delta Bag', '4.000', '5.000', '8.000', '+3.000 (+60%)'],
  ['Alpha Tee', '4.500', '10.000', '9.000', '−1.000 (−10%)'],
  ['Gamma Cap', '2.000', '6.000', '4.000', '−2.000 (−33%)'],
  ['Epsilon Sale', '3.000', '9.000 · on sale', '6.000', '−3.000 (−33%)'],
  ['Beta Jacket', '4.201', '12.250', '8.500', '−3.750 (−31%)'],
  ['Eta High', '9999999.999', '10.000', 'Too high to suggest.', '—'],
  ['Zeta No Cost', 'no cost yet', '7.000', '—', '—'],
]

const SHELL = (lang) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font-family:system-ui,sans-serif}
.admin-page-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
</style></head><body>
<div class="admin-content"><section class="admin-page"><header class="admin-page-header"><h1>Catalogue</h1></header><p>products</p></section></div>
<script src="/sporta-admin-brands.js"></script></body></html>`

// one page: the real add-on, the stock list from `st`, every write recorded
async function open(browser, { addon = ADDON, lang = 'en', rows = ROWS } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const st = { calls: [], fail: false, rows }
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/backends') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SHELL(lang) })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: addon })
    if (u.pathname === '/api/admin.php') {
      const r = u.searchParams.get('r')
      st.calls.push({ method: route.request().method(), r })
      if (route.request().method() !== 'GET') return route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"method_not_allowed"}' })
      if (r === 'variants' && st.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"failed"}' })
      if (r === 'variants') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(st.rows) })
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://admin.test/backends')
  await page.waitForTimeout(900)
  return { ctx, page, st, errors }
}

// the rows of the list as text: [name, cost, now, suggested, difference]
async function listRows(page) {
  return page.$$eval('[data-sugg="body"] tbody tr', (trs) => trs.map((tr) => {
    const tds = [...tr.querySelectorAll('td')]
    return [tds[0].querySelector('.ssg-name').textContent, tds[1].textContent.trim(), tds[2].textContent.trim(), tds[3].textContent.trim(), tds[4].textContent.trim()]
  }))
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

try {
  // ---------------------------------------------------------------------- 0 static
  head('0. the block')
  is(BEGIN >= 0 && END > BEGIN, 'the block is in public/sporta-admin-brands.js with its begin and end markers')
  is(!/setInterval/.test(CODE), 'no interval in the block (the admin timer count does not change)')
  is(!/MutationObserver|requestAnimationFrame/.test(CODE), 'no observer and no animation-frame scan in the block')
  is(!/innerHTML|outerHTML|insertAdjacentHTML/.test(CODE), 'no innerHTML: every text is set with textContent')
  is(!/console\./.test(CODE), 'no console output in the block')
  is((CODE.match(/fetch\(/g) || []).length === 1 && /r=variants/.test(CODE) && !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(CODE), 'the block makes one fetch: a GET of the stock list, and no write')

  // ---------------------------------------------------------------------- 1 the button and the list
  head('1. the button, the list, Escape')
  let c = await open(browser)
  const btn = c.page.locator('.admin-page-header [data-sporta-sugg-open]')
  is(await btn.count() === 1, 'one "Suggested prices" button, in the Catalogue header')
  is((await btn.textContent()).trim() === 'Suggested prices', 'it reads "Suggested prices"', await btn.textContent())
  is(c.st.calls.filter((x) => x.method === 'GET' && x.r === 'variants').length === 0, 'the list is not read until the button is pressed')
  await btn.click()
  await c.page.waitForSelector('[data-sugg-root] [role="dialog"]', { timeout: 5000 })
  await c.page.waitForSelector('[data-sugg="body"] tbody tr', { timeout: 5000 })
  const gets = c.st.calls.filter((x) => x.method === 'GET' && x.r === 'variants').length
  const writes = c.st.calls.filter((x) => x.method !== 'GET').length
  is(gets === 1, 'pressing it reads the stock list once', String(gets))
  is(writes === 0, 'and writes nothing (no POST, no PUT)', String(writes))
  await c.page.keyboard.press('Escape')
  is(await c.page.locator('[data-sugg-root]').count() === 0, 'Escape closes the list')
  is(await c.page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-sugg-open')), 'and the focus goes back to the button')
  await c.ctx.close()

  // ---------------------------------------------------------------------- 2 the numbers and the order
  head('2. the numbers, the order, the no-cost and too-high rows')
  c = await open(browser)
  await c.page.locator('[data-sporta-sugg-open]').click()
  await c.page.waitForSelector('[data-sugg="body"] tbody tr', { timeout: 5000 })
  const got = await listRows(c.page)
  is(got.length === EXPECT.length, `${EXPECT.length} products, each once`, String(got.length))
  EXPECT.forEach((want, i) => {
    const g = got[i] || []
    is(JSON.stringify(g) === JSON.stringify(want), `row ${i + 1}: ${want[0]}`, JSON.stringify(g))
  })
  const count = await c.page.locator('[data-sugg="count"]').textContent()
  is(/5 with a suggestion\./.test(count) && /1 with no cost yet, so no suggestion\./.test(count), 'the count line says 5 with a suggestion and 1 with no cost yet', count)

  // ---------------------------------------------------------------------- 3 the mark-up
  head('3. the mark-up')
  const markup = c.page.locator('[data-sugg="markup"]')
  await markup.fill('50')
  const at50 = await listRows(c.page)
  is(at50.find((r) => r[0] === 'Alpha Tee')[3] === '6.750', 'at 50% the alpha tee (cost 4.500) suggests 6.750')
  is(at50.find((r) => r[0] === 'Beta Jacket')[3] === '6.500', 'at 50% the beta jacket (cost 4.201) suggests 6.500, rounded up to a step')
  for (const bad of ['0', '501', '12.5', '']) {
    const before = JSON.stringify(await listRows(c.page))
    await markup.fill(bad)
    const err = await c.page.locator('[data-sugg="markup-err"]').textContent()
    is(/whole number from 1 to 500/.test(err) && JSON.stringify(await listRows(c.page)) === before, `mark-up "${bad}" is refused with its sentence, and the list stays as it was`, err)
  }
  await markup.fill('100')
  is(JSON.stringify(await listRows(c.page)) === JSON.stringify(got), 'back at 100% the list is the same as before')
  await c.ctx.close()

  // ---------------------------------------------------------------------- 4 Arabic
  head('4. Arabic')
  c = await open(browser, { lang: 'ar' })
  const arBtn = await c.page.locator('[data-sporta-sugg-open]').textContent()
  is(/اقترح|الأسعار المقترحة/.test(arBtn), 'the button reads in Arabic', arBtn)
  await c.page.locator('[data-sporta-sugg-open]').click()
  await c.page.waitForSelector('[data-sugg="body"] tbody tr', { timeout: 5000 })
  is(await c.page.locator('[data-sugg-root]').getAttribute('dir') === 'rtl', 'the list is right to left')
  const ar = await listRows(c.page)
  is(ar.length === EXPECT.length && ar[1][3] === '9.000' && ar[4][3] === '8.500', 'the same figures in Arabic (the alpha tee and the beta jacket)')
  is(ar[0][0] === 'حقيبة دلتا', 'the names are the Arabic ones', ar[0][0])
  await c.ctx.close()

  // ---------------------------------------------------------------------- 5 a failed read
  head('5. a failed stock list')
  c = await open(browser)
  c.st.fail = true
  await c.page.locator('[data-sporta-sugg-open]').click()
  await c.page.waitForSelector('[data-sugg="status"] button', { timeout: 5000 })
  is(/Could not read the stock list\./.test(await c.page.locator('[data-sugg="status"]').textContent()), 'a failed read says so, with a Try again button')
  c.st.fail = false
  await c.page.locator('[data-sugg="status"] button').click()
  await c.page.waitForSelector('[data-sugg="body"] tbody tr', { timeout: 5000 })
  is((await listRows(c.page)).length === EXPECT.length, 'Try again reads it again, and the list appears')
  is(await c.page.evaluate(() => document.querySelector('[data-sugg="status"]').textContent) === '', 'and the failure line is gone')
  await c.ctx.close()

  // ---------------------------------------------------------------------- 1b another screen
  head('1b. the button is only on the Catalogue')
  c = await open(browser)
  await c.page.evaluate(() => { document.querySelector('.admin-page h1').textContent = 'Overview' })
  await c.page.locator('p').click()
  await c.page.waitForTimeout(1400)
  is(await c.page.locator('[data-sporta-sugg-open]').count() === 0, 'on another screen the button is not there')
  await c.ctx.close()

  // ---------------------------------------------------------------------- 6 the mutant
  head('6. MUTATION: the rounding taken out')
  const TARGET = 'Math.ceil(Math.ceil(cost * (100 + pct) / 100) / STEP) * STEP'
  is(ADDON.includes(TARGET), 'the mutation target is in the add-on')
  const mutant = ADDON.replace(TARGET, 'Math.ceil(cost * (100 + pct) / 100)')
  c = await open(browser, { addon: mutant })
  await c.page.locator('[data-sporta-sugg-open]').click()
  await c.page.waitForSelector('[data-sugg="body"] tbody tr', { timeout: 5000 })
  const mut = await listRows(c.page)
  const beta = mut.find((r) => r[0] === 'Beta Jacket')
  is(!(beta && beta[3] === '8.500'), 'MUTATION: without the rounding the beta jacket would suggest 8.402, not 8.500 (the list check above fails)', beta ? beta[3] : 'no row')
  await c.ctx.close()
} finally {
  await browser.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
