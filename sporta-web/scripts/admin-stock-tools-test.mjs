// The stock tools (block "ADMIN STOCK TOOLS", public/sporta-admin-brands.js): a batch stock count and a reorder list, opened from
// the Inventory screen's header (.inventory-heading__actions) of the live, compiled admin.
//
//   npm run test:admin-stock-tools   (no database, no PHP: the admin API is a fake that behaves like admin.php, answered by route
//                                     interception; the REAL add-on file runs in Chromium; the header markup is the live one,
//                                     read from the live Inventory chunk on 2026-11-18)
//
// What is asserted:
//   0. static: markers; no interval, observer, HTML sink or console; every storage call in try/catch; the only write is
//      inventory_adjust of type count;
//   1. the buttons: two, once, in the Inventory header before the live status; none on another screen; nothing is read until a press;
//   2. counting: one row per size in product/size order; the difference badge; Arabic-Indic digits; a bad entry is marked and blocks
//      Review; Enter goes to the next row; search, category and "counted only"; NOTHING is written while counting;
//   3. review: only the sizes that differ, the large ones marked and a tick required, a reason of 3+ characters required, a default
//      reason, Back keeps the counts;
//   4. saving: one inventory_adjust per changed size, type count, that size's expected_version, the reason, one at a time; the draft is
//      cleared; a size changed in another session is reported and not overwritten, and "Reload and review again" re-reads it;
//      a 429 waits and retries; Stop leaves the rest unsaved; a signed-out session stops the run;
//   5. the draft: kept across a close and a reopen, cleared on request; storage that throws does not break counting;
//   6. the reorder list: read only; out of stock and low sizes; the default quantity; target and per-row quantity; totals with the
//      estimated cost; Copy; CSV with a formula-looking name neutralised;
//   7. Arabic: buttons and dialog Arabic and right to left; 8. a failed read says so and retries; 9. a phone-size screen;
//   10. MUTATION: without expected_version, without the flagged tick, or saving unchanged sizes, the matching check fails.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== ADMIN STOCK TOOLS - begin')
const END = ADDON.indexOf('/* ===== ADMIN STOCK TOOLS - end')
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const ROWS = [
  { sku: 'A-S', slug: 'alpha-tee', name_en: 'Alpha Tee', name_ar: 'تي ألفا', category: 'men', size: 'S', stock: 0, unit_cost_kwd: 2.5, low_stock_threshold: 2, inventory_version: 3 },
  { sku: 'A-M', slug: 'alpha-tee', name_en: 'Alpha Tee', name_ar: 'تي ألفا', category: 'men', size: 'M', stock: 5, unit_cost_kwd: 2.5, low_stock_threshold: 2, inventory_version: 1 },
  { sku: 'A-L', slug: 'alpha-tee', name_en: 'Alpha Tee', name_ar: 'تي ألفا', category: 'men', size: 'L', stock: 2, unit_cost_kwd: 2.5, low_stock_threshold: 2, inventory_version: 4 },
  { sku: 'B-M', slug: 'beta-jacket', name_en: 'Beta Jacket', name_ar: 'جاكيت بيتا', category: 'outerwear', size: 'M', stock: 12, unit_cost_kwd: 4.2, low_stock_threshold: 3, inventory_version: 7 },
  { sku: 'B-XL', slug: 'beta-jacket', name_en: 'Beta Jacket', name_ar: 'جاكيت بيتا', category: 'outerwear', size: 'XL', stock: 3, unit_cost_kwd: 4.2, low_stock_threshold: 3, inventory_version: 2 },
  { sku: 'D-S', slug: 'delta-leggings', name_en: 'Delta Leggings', name_ar: 'ليجنز دلتا', category: 'women', size: 'S', stock: 1, unit_cost_kwd: 3, low_stock_threshold: 0, inventory_version: 5 },
  { sku: 'E-M', slug: 'epsilon-formula', name_en: '=HYPERLINK("x")', name_ar: '', category: 'men', size: 'M', stock: 0, unit_cost_kwd: 1, low_stock_threshold: 1, inventory_version: 1 },
  { sku: 'G-1', slug: 'gamma-cap', name_en: 'Gamma Cap', name_ar: 'قبعة جاما', category: 'accessories', size: 'ONE', stock: 8, unit_cost_kwd: null, low_stock_threshold: 0, inventory_version: 0 },
]
const ORDER = ['A-S', 'A-M', 'A-L', 'B-M', 'B-XL', 'D-S', 'E-M', 'G-1']

const SHELL = (lang, other) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font-family:system-ui,sans-serif}
.admin-page-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.inventory-heading__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
</style></head><body>
<div class="admin-content"><section class="admin-page"><header class="admin-page-header">${other
    ? '<h1>Catalogue</h1>'
    : '<h1>Inventory</h1><div class="inventory-heading__actions"><button type="button" class="inventory-refresh">Refresh</button><button type="button" class="inventory-refresh">Export CSV</button><span class="inventory-live-status" role="status">Live inventory</span></div>'}</header><p>screen</p></section></div>
<script src="/sporta-admin-brands.js"></script></body></html>`

// one page: the real add-on, the fake admin API (it behaves like admin.php), every call recorded
async function open(browser, o = {}) {
  const { addon = ADDON, lang = 'en', other = false, viewport = { width: 1280, height: 900 }, throwStorage = false, noClipboard = false } = o
  const ctx = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
  const page = await ctx.newPage()
  const st = { rows: ROWS.map((r) => ({ ...r })), calls: [], posts: [], inflight: 0, maxInflight: 0, conflictOn: new Set(), throttle: null, delay: 0, signedOut: false, fail: false }
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  if (noClipboard) await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); document.execCommand = (cmd) => { window.__execCmd = cmd; window.__copiedText = (document.querySelector('textarea[readonly]') || {}).value; return true } })
  if (throwStorage) await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } }) })
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/backends') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SHELL(lang, other || u.searchParams.get('s') === 'other') })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: addon })
    if (u.pathname !== '/api/admin.php') return route.fulfill({ status: 404, body: '' })
    const r = u.searchParams.get('r'), method = route.request().method()
    st.calls.push({ method, r })
    const json = (status, obj, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(obj) })
    if (r === 'variants' && method === 'GET') return st.fail ? json(500, { error: 'failed' }) : json(200, st.rows)
    if (r !== 'inventory_adjust' || method !== 'POST') return json(404, { error: 'not_found' })
    st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight)
    try {
      if (st.delay) await new Promise((res) => setTimeout(res, st.delay))
      const b = JSON.parse(route.request().postData() || '{}')
      st.posts.push(b)
      if (st.signedOut) return json(401, { error: 'unauthorized' })
      const row = st.rows.find((x) => x.sku === b.sku)
      if (!row) return json(404, { error: 'sku_not_found' })
      if (st.throttle && st.throttle.sku === b.sku && st.throttle.n > 0) { st.throttle.n--; return json(429, { error: 'rate_limited', retry_after: 1 }, { 'Retry-After': '1' }) }
      if (st.conflictOn.has(b.sku)) { st.conflictOn.delete(b.sku); row.stock += 1; row.inventory_version += 1 }
      if (b.type !== 'count' || !Number.isInteger(b.target_stock) || b.target_stock < 0) return json(400, { error: 'invalid_target_stock' })
      if (typeof b.note !== 'string' || b.note.trim().length < 3) return json(400, { error: 'note_required' })
      if (b.expected_version !== row.inventory_version) return json(409, { error: 'stock_changed', stock: row.stock, unit_cost_kwd: row.unit_cost_kwd, low_stock_threshold: row.low_stock_threshold, inventory_version: row.inventory_version })
      row.stock = b.target_stock; row.inventory_version += 1
      return json(200, { variant: { sku: row.sku, slug: row.slug, size: row.size, stock: row.stock, unit_cost_kwd: row.unit_cost_kwd, low_stock_threshold: row.low_stock_threshold, inventory_version: row.inventory_version }, movement: { id: st.posts.length, sku: row.sku, type: 'count' } })
    } finally { st.inflight-- }
  })
  await page.goto('https://admin.test/backends')   // https: the live admin is a secure context, so the clipboard API exists
  await page.waitForTimeout(900)
  return { ctx, page, st, errors }
}

const T = (page, sel) => page.locator(sel).first().innerText().then((s) => s.trim())
async function openCount(page) {
  await page.locator('[data-sporta-stk-count]').click()
  await page.waitForSelector('[data-stk="list"] .stk-row', { timeout: 5000 })
}
async function openReorder(page) {
  await page.locator('[data-sporta-stk-reorder]').click()
  await page.waitForSelector('[data-stk-reorder]', { timeout: 5000 })
}
const type = async (page, sku, v) => { const i = page.locator(`[data-stk-sku="${sku}"] .stk-input`); await i.fill(''); await i.type(v) }
async function typeCounts(page, map) { for (const [sku, v] of Object.entries(map)) await type(page, sku, v) }
const rowsText = (page) => page.$$eval('[data-stk="list"] .stk-row', (rs) => rs.map((r) => r.getAttribute('data-stk-sku')))
const goReview = async (page) => { await page.locator('[data-stk="review"]').click(); await page.waitForSelector('[data-stk="changes"]') }

// the standard counting session: three sizes change, one is large (12 -> 2), one is entered and the same, one was bad then fixed
const COUNTS = { 'A-S': '4', 'A-M': '5', 'A-L': '٣', 'B-M': '2', 'B-XL': '3' }
async function saveSession(page, { tick = true } = {}) {
  await openCount(page)
  await typeCounts(page, COUNTS)
  await goReview(page)
  if (tick) await page.locator('[data-stk="flagtick"]').check().catch(() => {})
  await page.locator('[data-stk="save"]').click()
}
const finalLine = (page) => page.waitForFunction(() => /saved ·/.test((document.querySelector('[data-stk="progress"]') || {}).textContent || ''), null, { timeout: 15000 }).then(() => T(page, '[data-stk="progress"]'))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

try {
  // ------------------------------------------------------------------------------------------- 0 static
  head('0. the block')
  is(BEGIN >= 0 && END > BEGIN, 'the block is in public/sporta-admin-brands.js with its begin and end markers')
  is(!/setInterval/.test(CODE), 'no interval in the block (the admin timer count does not change)')
  is(!/MutationObserver|requestAnimationFrame/.test(CODE), 'no observer and no animation-frame scan')
  is(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(CODE), 'no HTML sink, no eval: every text is set with textContent')
  is(!/console\./.test(CODE), 'no console output in the block')
  const stor = CODE.split('\n').filter((l) => /localStorage|sessionStorage/.test(l))
  is(stor.length > 0 && stor.every((l) => /try\s*\{/.test(l) && /catch/.test(l)), 'every storage call sits in try/catch', stor.join(' | ').slice(0, 120))
  is((CODE.match(/fetch\(/g) || []).length === 2 && /r=variants/.test(CODE) && /r=inventory_adjust/.test(CODE), 'two fetches: a GET of the stock list and the inventory_adjust write')
  is(/type:\s*'count'/.test(CODE) && !/type:\s*'(receive|return|damage)'/.test(CODE) && !/inventory_variant_save|unit_cost_kwd:|low_stock_threshold:/.test(CODE.replace(/r\.low_stock_threshold|r && r\.unit_cost_kwd|r && r\.low_stock_threshold/g, '')), 'the only write is a count: no receipt, damage, cost or low-level write')

  // ------------------------------------------------------------------------------------------- 1 buttons
  head('1. the two buttons')
  let c = await open(browser)
  const bc = c.page.locator('.inventory-heading__actions [data-sporta-stk-count]'), br = c.page.locator('.inventory-heading__actions [data-sporta-stk-reorder]')
  is(await bc.count() === 1 && await br.count() === 1, 'one "Stock count" and one "Reorder list" button in the Inventory header')
  is((await bc.textContent()).trim() === 'Stock count' && (await br.textContent()).trim() === 'Reorder list', 'they read "Stock count" and "Reorder list"')
  is(await c.page.evaluate(() => { const a = document.querySelector('.inventory-heading__actions'), live = a.querySelector('.inventory-live-status'); return live === a.lastElementChild && !!a.querySelector('[data-sporta-stk-reorder]').nextElementSibling }), 'they sit before the live status')
  is(c.st.calls.length === 0, 'nothing is read until a button is pressed')
  await bc.click()
  await c.page.waitForSelector('[data-stk-root="count"] [role="dialog"]')
  await c.page.waitForSelector('[data-stk="list"] .stk-row')
  is(c.st.calls.filter((x) => x.method === 'GET' && x.r === 'variants').length === 1 && c.st.posts.length === 0, 'pressing it reads the stock list once and writes nothing')
  await c.page.keyboard.press('Escape')
  is(await c.page.locator('[data-stk-root]').count() === 0, 'Escape closes the dialog')
  is(await c.page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-stk-count')), 'and the focus goes back to the button')
  is(c.errors.length === 0, 'no page error', c.errors.join(' | '))
  await c.ctx.close()
  c = await open(browser, { other: true })
  is(await c.page.locator('[data-sporta-stk-count],[data-sporta-stk-reorder]').count() === 0, 'no button on another screen (the Catalogue)')
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 2 counting
  head('2. counting')
  c = await open(browser)
  await openCount(c.page)
  is(JSON.stringify(await rowsText(c.page)) === JSON.stringify(ORDER), 'one row per size, by product then size (S, M, L; M, XL)', JSON.stringify(await rowsText(c.page)))
  await typeCounts(c.page, { 'A-S': '4', 'A-M': '5', 'A-L': '٣', 'B-M': '2' })
  const diff = (sku) => T(c.page, `[data-stk-sku="${sku}"] .stk-diff`)
  is(await diff('A-S') === '+4', 'a larger count shows +4', await diff('A-S'))
  is(await diff('A-M') === 'Same', 'the same count shows "Same"', await diff('A-M'))
  is(await diff('A-L') === '+1', 'Arabic-Indic digits are read (٣ counts as 3, so +1)', await diff('A-L'))
  is(await diff('B-M') === '−10 !' || (await diff('B-M')).startsWith('−10'), 'a smaller count shows −10 and is marked', await diff('B-M'))
  is(await c.page.locator('[data-stk-sku="B-M"].stk-row--flag').count() === 1, 'the large change is marked on its row')
  await type(c.page, 'B-XL', 'x')
  is(/Whole number/.test(await diff('B-XL')) && await c.page.locator('[data-stk-sku="B-XL"] .stk-input[aria-invalid="true"]').count() === 1, 'a bad entry is marked, with the rule')
  is(await c.page.locator('[data-stk="review"]').isDisabled() && /need fixing/.test(await T(c.page, '[data-stk="sumerr"]')), 'a bad entry blocks Review and says why')
  await type(c.page, 'B-XL', '3')
  is(!(await c.page.locator('[data-stk="review"]').isDisabled()), 'fixing it re-enables Review')
  is(/^Review 3 changes$/.test(await T(c.page, '[data-stk="review"]')), 'Review counts the sizes that differ (3), not the ones that match', await T(c.page, '[data-stk="review"]'))
  is(/5 counted · 3 differ/.test(await T(c.page, '[data-stk="sum"]')), 'the summary counts what was entered and what differs', await T(c.page, '[data-stk="sum"]'))
  is(c.st.posts.length === 0, 'NOTHING is written while counting (no POST)', String(c.st.posts.length))
  await c.page.locator('[data-stk-sku="A-S"] .stk-input').focus()
  await c.page.keyboard.press('Enter')
  is(await c.page.evaluate(() => document.activeElement.closest('[data-stk-sku]') && document.activeElement.closest('[data-stk-sku]').getAttribute('data-stk-sku')) === 'A-M', 'Enter moves to the next row')
  await c.page.locator('#stk-q').fill('jacket')
  is(JSON.stringify(await rowsText(c.page)) === JSON.stringify(['B-M', 'B-XL']), 'search narrows the list (and keeps what was typed)')
  await c.page.locator('#stk-q').fill('')
  await c.page.locator('#stk-cat').selectOption('women')
  is(JSON.stringify(await rowsText(c.page)) === JSON.stringify(['D-S']), 'the category filter narrows the list')
  await c.page.locator('#stk-cat').selectOption('all')
  await c.page.locator('#stk-show').selectOption('entered')
  is(JSON.stringify(await rowsText(c.page)) === JSON.stringify(['A-S', 'A-M', 'A-L', 'B-M', 'B-XL']), '"Counted only" shows just the entered sizes')
  await c.page.locator('#stk-show').selectOption('todo')
  is(JSON.stringify(await rowsText(c.page)) === JSON.stringify(['D-S', 'E-M', 'G-1']), '"Not counted yet" shows the rest')
  is(c.errors.length === 0, 'no page error', c.errors.join(' | '))
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 3 review
  head('3. review')
  c = await open(browser)
  await openCount(c.page)
  await typeCounts(c.page, COUNTS)
  await goReview(c.page)
  const changed = await c.page.$$eval('[data-stk-change]', (rs) => rs.map((r) => r.getAttribute('data-stk-change')))
  is(JSON.stringify(changed) === JSON.stringify(['A-S', 'A-L', 'B-M']), 'the review lists only the sizes that differ', JSON.stringify(changed))
  is(await c.page.locator('[data-stk-change="B-M"] .stk-tag').count() === 1 && await c.page.locator('[data-stk-change="A-S"] .stk-tag').count() === 0, 'the large change is marked "Check", the small ones are not')
  is(/12 → 2/.test(await T(c.page, '[data-stk-change="B-M"]')), 'each row shows the system number and the counted number', await T(c.page, '[data-stk-change="B-M"]'))
  const note = await c.page.locator('[data-stk="note"]').inputValue()
  is(/^Stock count \d{4}-\d{2}-\d{2}$/.test(note), 'the reason starts as "Stock count <date>"', note)
  is(await c.page.locator('[data-stk="save"]').isDisabled(), 'Save is off until the marked counts are ticked')
  await c.page.locator('[data-stk="flagtick"]').check()
  is(!(await c.page.locator('[data-stk="save"]').isDisabled()), 'ticking them turns Save on')
  await c.page.locator('[data-stk="note"]').fill('ab')
  is(await c.page.locator('[data-stk="save"]').isDisabled(), 'a reason under 3 characters turns Save off')
  await c.page.locator('[data-stk="note"]').fill('Shelf count, back room')
  await c.page.getByRole('button', { name: 'Back to counting' }).click()
  await c.page.waitForSelector('[data-stk="list"] .stk-row')
  is(await c.page.locator('[data-stk-sku="B-M"] .stk-input').inputValue() === '2', 'Back keeps every typed count')
  is(c.st.posts.length === 0, 'still nothing written', String(c.st.posts.length))
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 4 saving
  head('4. saving')
  c = await open(browser)
  await openCount(c.page)
  await typeCounts(c.page, COUNTS)
  await goReview(c.page)
  await c.page.locator('[data-stk="flagtick"]').check()
  await c.page.locator('[data-stk="note"]').fill('Shelf count, back room')
  await c.page.locator('[data-stk="save"]').click()
  const line = await finalLine(c.page)
  is(/3 saved · 0 need attention · 0 not saved/.test(line), 'the run ends with "3 saved · 0 need attention · 0 not saved"', line)
  is(c.st.posts.length === 3 && c.st.posts.map((p) => p.sku).join() === 'A-S,A-L,B-M', 'one write per changed size, in list order, none for the sizes that matched', c.st.posts.map((p) => p.sku).join())
  is(c.st.posts.every((p) => p.type === 'count' && Number.isInteger(p.target_stock) && p.note === 'Shelf count, back room'), 'each is a count with the typed reason')
  is(JSON.stringify(c.st.posts.map((p) => [p.target_stock, p.expected_version])) === JSON.stringify([[4, 3], [3, 4], [2, 7]]), 'each carries that size\'s own inventory_version and the counted number', JSON.stringify(c.st.posts.map((p) => [p.target_stock, p.expected_version])))
  is(c.st.maxInflight === 1, 'one request at a time', String(c.st.maxInflight))
  is(JSON.stringify(c.st.rows.filter((r) => ['A-S', 'A-L', 'B-M'].includes(r.sku)).map((r) => r.stock)) === JSON.stringify([4, 3, 2]), 'the fake server now holds the counted numbers')
  is(await c.page.evaluate(() => window.localStorage.getItem('sporta.stockcount.v1')) !== null && JSON.parse(await c.page.evaluate(() => window.localStorage.getItem('sporta.stockcount.v1'))).counts['A-M'] === '5' && !('A-S' in JSON.parse(await c.page.evaluate(() => window.localStorage.getItem('sporta.stockcount.v1'))).counts), 'saved sizes leave the draft; counts not saved stay in it')
  await c.ctx.close()

  head('4b. a size changed in another session')
  c = await open(browser)
  c.st.conflictOn.add('A-L')
  await saveSession(c.page)
  const l2 = await finalLine(c.page)
  is(/2 saved · 1 need attention · 0 not saved/.test(l2), 'the other two are saved and one needs attention', l2)
  is(/Stock changed in another session \(now 3\)/.test(await T(c.page, '[data-stk-res="A-L"]')), 'the size says it changed elsewhere and what it is now', await T(c.page, '[data-stk-res="A-L"]'))
  is(c.st.rows.find((r) => r.sku === 'A-L').stock === 3, 'it was NOT overwritten (the other session\'s number stands)', String(c.st.rows.find((r) => r.sku === 'A-L').stock))
  await c.page.locator('[data-stk="reload"]').click()
  await c.page.waitForSelector('[data-stk="list"] .stk-row')
  is(await c.page.locator('[data-stk-sku="A-L"] .stk-input').inputValue() === '٣' && /System\s*3/.test(await T(c.page, '[data-stk-sku="A-L"] .stk-sys')), 'Reload and review again keeps the typed count and shows the new system number', await T(c.page, '[data-stk-sku="A-L"] .stk-sys'))
  is(await c.page.locator('[data-stk-sku="A-L"] .stk-diff').innerText().then((s) => s.trim()) === 'Same', 'so that size now matches and needs nothing')
  await c.ctx.close()

  head('4c. too many requests, Stop, and a signed-out session')
  c = await open(browser)
  c.st.throttle = { sku: 'A-L', n: 1 }
  await saveSession(c.page)
  const l3 = await finalLine(c.page)
  is(/3 saved/.test(l3) && c.st.posts.filter((p) => p.sku === 'A-L').length === 2, 'a 429 waits and then retries that size once (2 requests, saved)', l3 + ' / ' + c.st.posts.filter((p) => p.sku === 'A-L').length)
  await c.ctx.close()
  c = await open(browser)
  c.st.delay = 700
  await saveSession(c.page)
  await c.page.waitForSelector('[data-stk="stop"]')
  await c.page.locator('[data-stk="stop"]').click()
  const l4 = await finalLine(c.page)
  is(/1 saved · 0 need attention · 2 not saved/.test(l4) && c.st.posts.length === 1, 'Stop ends the run after the size in flight: the rest are "not saved"', l4 + ' / ' + c.st.posts.length)
  await c.ctx.close()
  c = await open(browser)
  c.st.signedOut = true
  await saveSession(c.page)
  const l5 = await finalLine(c.page)
  is(c.st.posts.length === 1 && /1 need attention|need attention/.test(l5) && /Sign in again/.test(await T(c.page, '[data-stk-res="A-S"]')), 'a signed-out session stops the run after the first refusal and says to sign in', l5 + ' / ' + c.st.posts.length)
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 5 draft
  head('5. the draft kept on this device')
  c = await open(browser)
  await openCount(c.page)
  await typeCounts(c.page, { 'A-S': '4', 'B-M': '2' })
  await c.page.keyboard.press('Escape')
  await c.page.locator('[data-sporta-stk-count]').click()
  await c.page.waitForSelector('[data-stk="list"] .stk-row')
  is(/2 earlier counts restored/.test(await T(c.page, '.stk-notice')) && await c.page.locator('[data-stk-sku="A-S"] .stk-input').inputValue() === '4', 'closing and reopening restores the typed counts, and says so', await T(c.page, '.stk-notice'))
  await c.page.getByRole('button', { name: 'Clear them' }).click()
  await c.page.waitForSelector('[data-stk="list"] .stk-row')
  is(await c.page.locator('[data-stk-sku="A-S"] .stk-input').inputValue() === '' && await c.page.evaluate(() => window.localStorage.getItem('sporta.stockcount.v1')) === null, '"Clear them" empties the boxes and the stored draft')
  await c.ctx.close()
  c = await open(browser, { throwStorage: true })
  await openCount(c.page)
  await typeCounts(c.page, { 'A-S': '4' })
  is(/\+4/.test(await T(c.page, '[data-stk-sku="A-S"] .stk-diff')) && c.errors.length === 0, 'storage that throws does not break counting', c.errors.join(' | '))
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 6 reorder
  head('6. the reorder list')
  c = await open(browser)
  await openReorder(c.page)
  const ids = await c.page.$$eval('[data-stk-reorder]', (rs) => rs.map((r) => r.getAttribute('data-stk-reorder')))
  is(JSON.stringify(ids) === JSON.stringify(['A-S', 'E-M', 'A-L', 'B-XL']), 'out of stock first, then low (stock at or under its level); healthy sizes and a size with no level are left out', JSON.stringify(ids))
  const q = (sku) => c.page.locator(`[data-stk-reorder="${sku}"] .stk-qty`).inputValue()
  is(await q('A-S') === '6' && await q('E-M') === '6' && await q('A-L') === '4' && await q('B-XL') === '3', 'the default is "bring up to 6" (never below the low level + 1): 6, 6, 4, 3', [await q('A-S'), await q('E-M'), await q('A-L'), await q('B-XL')].join())
  is(await T(c.page, '[data-stk="sum"]') === '4 sizes · 19 pieces · estimated cost 43.600 KWD', 'the totals: 4 sizes, 19 pieces, and the cost is quantity times unit cost (6x2.5 + 6x1 + 4x2.5 + 3x4.2 = 43.600)', await T(c.page, '[data-stk="sum"]'))
  await c.page.locator('#stk-target').fill('10')
  is(await q('A-S') === '10' && await q('A-L') === '8', 'a new target recalculates every quantity')
  await c.page.locator('[data-stk-reorder="A-S"] .stk-qty').fill('7')
  is(/^4 sizes · 32 pieces/.test(await T(c.page, '[data-stk="sum"]')), 'a row quantity can be edited and the totals follow (7 + 10 + 8 + 7 = 32)', await T(c.page, '[data-stk="sum"]'))
  await c.page.locator('[data-stk="includelow"]').uncheck()
  is(JSON.stringify(await c.page.$$eval('[data-stk-reorder]', (rs) => rs.map((r) => r.getAttribute('data-stk-reorder')))) === JSON.stringify(['A-S', 'E-M']), 'unticking "include sizes that are only low" leaves the out-of-stock ones')
  await c.page.locator('[data-stk="includelow"]').check()
  await c.page.locator('#stk-target').fill('6')
  await c.page.locator('[data-stk="copy"]').click()
  await c.page.waitForFunction(() => /Copied/.test((document.querySelector('[data-stk="status"]') || {}).textContent || ''))
  const clip = await c.page.evaluate(() => navigator.clipboard.readText())
  is(/^Reorder list — \d{4}-\d{2}-\d{2}\n/.test(clip) && /Alpha Tee — S — A-S — 6\n/.test(clip) && /Total: 19 pieces$/.test(clip), 'Copy puts a plain list on the clipboard (name, size, code, quantity) with a total', JSON.stringify(clip).slice(0, 220))
  const [dl] = await Promise.all([c.page.waitForEvent('download'), c.page.locator('[data-stk="csv"]').click()])
  const csv = readFileSync(await dl.path(), 'utf8')
  is(csv.charCodeAt(0) === 0xfeff && csv.slice(1).startsWith('sku,product,size,stock,low_level,order_qty,unit_cost_kwd,est_cost_kwd\r\n'), 'the CSV has a plain header and a byte-order mark (opens in Excel with the right letters)')
  is(/"E-M","'=HYPERLINK\(""x""\)","M","0","1","6","1.000","6.000"/.test(csv), 'a product name that starts with = is neutralised so a spreadsheet cannot run it', csv.split('\n')[2])
  is(c.st.posts.length === 0 && c.st.calls.filter((x) => x.method !== 'GET').length === 0, 'the reorder list writes nothing')
  await c.ctx.close()
  c = await open(browser, { noClipboard: true })
  await openReorder(c.page)
  await c.page.locator('[data-stk="copy"]').click()
  await c.page.waitForFunction(() => /Copied/.test((document.querySelector('[data-stk="status"]') || {}).textContent || ''))
  is(await c.page.evaluate(() => window.__execCmd) === 'copy' && /Alpha Tee — S — A-S — 6/.test(await c.page.evaluate(() => window.__copiedText || '')), 'with no clipboard API, Copy falls back to the old copy command with the same list')
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 7 Arabic
  head('7. Arabic')
  c = await open(browser, { lang: 'ar' })
  is((await c.page.locator('[data-sporta-stk-count]').textContent()).trim() === 'جرد المخزون' && (await c.page.locator('[data-sporta-stk-reorder]').textContent()).trim() === 'قائمة إعادة الطلب', 'the buttons are Arabic')
  await openCount(c.page)
  is(await c.page.locator('[data-stk-root]').getAttribute('dir') === 'rtl' && /تي ألفا/.test(await T(c.page, '[data-stk-sku="A-S"] .stk-name')), 'the dialog is right to left and shows the Arabic product names')
  await typeCounts(c.page, { 'A-S': '٤' })
  is(/\+4/.test(await T(c.page, '[data-stk-sku="A-S"] .stk-diff')), 'Arabic digits are counted in the Arabic screen too')
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 8 failed read
  head('8. a failed read')
  c = await open(browser)
  c.st.fail = true
  await c.page.locator('[data-sporta-stk-count]').click()
  await c.page.waitForSelector('[data-stk="body"] button')
  is(/Could not read the stock list/.test(await T(c.page, '[data-stk="body"]')), 'a failed read says so')
  c.st.fail = false
  await c.page.getByRole('button', { name: 'Try again' }).click()
  await c.page.waitForSelector('[data-stk="list"] .stk-row')
  is(await c.page.locator('[data-stk="list"] .stk-row').count() === ORDER.length, '"Try again" reads it again')
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 9 phone
  head('9. a phone')
  c = await open(browser, { viewport: { width: 390, height: 844 } })
  await openCount(c.page)
  const m = await c.page.evaluate(() => {
    const d = document.querySelector('.stk-dlg').getBoundingClientRect(), f = document.querySelector('[data-stk="review"]').getBoundingClientRect()
    const i = document.querySelector('.stk-input').getBoundingClientRect()
    return { dw: d.width, dh: d.height, fb: f.bottom, ih: i.height, iw: i.width, sw: document.scrollingElement.scrollWidth, vw: innerWidth, vh: innerHeight }
  })
  is(m.dw >= 389 && m.dh >= 843, 'the dialog fills the phone screen', JSON.stringify(m))
  is(m.fb <= m.vh, 'the Review button stays inside the screen (sticky footer)', JSON.stringify(m))
  is(m.ih >= 44 && m.iw >= 44, 'the count box is at least 44 px (a finger)', JSON.stringify(m))
  is(m.sw <= m.vw, 'no sideways scroll', JSON.stringify(m))
  await c.ctx.close()

  // ------------------------------------------------------------------------------------------- 10 mutations
  head('10. MUTATION: each safeguard, taken out, must fail its check')
  const mutate = (from, to) => { if (ADDON.split(from).length !== 2) throw new Error('mutation anchor not unique: ' + from); return ADDON.replace(from, to) }
  // (a) the write loses the version it was read at
  let mc = await open(browser, { addon: mutate("expected_version: r.version, target_stock: c.n", "target_stock: c.n") })
  await saveSession(mc.page)
  const ml = await finalLine(mc.page)
  is(!/3 saved/.test(ml) && mc.st.posts.every((p) => p.expected_version === undefined), 'without expected_version the fake server refuses the writes (so check 4 would fail)', ml)
  await mc.ctx.close()
  // (b) the marked counts no longer need a tick
  mc = await open(browser, { addon: mutate("go.disabled = clean(S.note).length < 3 || (anyFlag && !S.flagsOk)", "go.disabled = clean(S.note).length < 3") })
  await openCount(mc.page); await typeCounts(mc.page, COUNTS); await goReview(mc.page)
  is(!(await mc.page.locator('[data-stk="save"]').isDisabled()), 'without the tick rule Save is on at once (so check 3 would fail)')
  await mc.ctx.close()
  // (c) sizes that match are sent too
  mc = await open(browser, { addon: mutate("if (p.state === 'ok' && p.n !== r.stock) out.push", "if (p.state === 'ok') out.push") })
  await saveSession(mc.page)
  await finalLine(mc.page)
  is(mc.st.posts.length !== 3, 'if matching sizes were sent, the number of writes would change (so check 4 would fail)', String(mc.st.posts.length))
  await mc.ctx.close()

  console.log(`\n${pass} passed, ${fail} failed`)
} finally {
  await browser.close()
}
process.exit(fail ? 1 : 0)
