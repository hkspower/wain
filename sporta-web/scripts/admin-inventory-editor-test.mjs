// The inventory editor (block "ADMIN INVENTORY EDITOR", public/sporta-admin-brands.js): an "Edit sizes" button in the Inventory
// screen's header opens one editable table of every size (stock, low-stock level, unit cost), saved row by row against each row's
// inventory_version.
//
//   npm run test:admin-inventory-editor   (no database, no PHP: the admin API is a fake that behaves like admin.php, answered by
//                                          route interception; the REAL add-on file runs in Chromium; the header markup mirrors the
//                                          live Inventory screen's .inventory-heading__actions)
//
// What is asserted:
//   0. static: markers once; no innerHTML, console, eval, storage or interval; the only writes are inventory_adjust and
//      inventory_variant_save;
//   1. the button: one, in the Inventory header before the live status; none on another screen; nothing read until it is pressed;
//   2. the table: one GET of the stock list; typing writes nothing; a changed row says so; a bad entry is marked and blocks Save;
//   3. saving: the stock write first (target_stock, expected_version), then the cost and low-level write with the NEW version;
//      Arabic-Indic digits accepted; a row with no cost change makes no cost write; rows end "Saved" and their boxes are clean;
//   4. a size changed in another session (409): its current values are shown, what was typed is dropped, the other rows still save;
//   5. a 429 waits Retry-After and retries; 6. "Stop after this one" leaves the rest "Not saved (stopped)";
//   7. a 401 ends the run with the session message; 8. Refresh after another session's change drops the typed values ("stale");
//   9. filters: Changed only, search, category; 10. Escape asks before it throws away changes;
//   11. MUTATION: each of four cut-outs turns a check red (the test can fail).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== ADMIN INVENTORY EDITOR - begin')
const END = ADDON.indexOf('/* ===== ADMIN INVENTORY EDITOR - end')
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
const checks = []
function is(ok, msg, detail = '') {
  checks.push(ok)
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- the fake admin API (behaves like admin.php)
const SEED = [
  { sku: 'SKU-A-S', slug: 'tee-a', name_en: 'Tee A', name_ar: 'تي شيرت أ', category: 'men', size: 'S', stock: 5, v: 3, low: 2, cost: 3.5 },
  { sku: 'SKU-A-M', slug: 'tee-a', name_en: 'Tee A', name_ar: 'تي شيرت أ', category: 'men', size: 'M', stock: 0, v: 1, low: 2, cost: null },
  { sku: 'SKU-B-L', slug: 'hoodie-b', name_en: 'Hoodie B', name_ar: 'هودي ب', category: 'women', size: 'L', stock: 10, v: 7, low: 3, cost: 6 }
]
function shape(r) {
  return { sku: r.sku, slug: r.slug, name_en: r.name_en, name_ar: r.name_ar, category: r.category, size: r.size, stock: r.stock,
    unit_cost_kwd: r.cost, low_stock_threshold: r.low, inventory_version: r.v }
}
function makeServer(opts = {}) {
  const st = {}
  SEED.forEach((r) => { st[r.sku] = { ...r } })
  const calls = []
  let throttled = false, conflicted = false
  const json = (route, status, obj, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(obj) })
  async function handle(route) {
    const req = route.request()
    const r = new URL(req.url()).searchParams.get('r')
    if (r === 'variants' && req.method() === 'GET') return json(route, 200, Object.values(st).map(shape))
    if (req.method() !== 'POST') return json(route, 405, { error: 'method_not_allowed' })
    const body = JSON.parse(req.postData() || '{}')
    calls.push({ r, body, ctype: req.headers()['content-type'] || '' })
    if (r !== 'inventory_adjust' && r !== 'inventory_variant_save') return json(route, 404, { error: 'not_found' })
    if (opts.delayMs) await sleep(opts.delayMs)
    if (opts.throttleOnce && !throttled) { throttled = true; return json(route, 429, { error: 'too_many_requests' }, { 'Retry-After': '1' }) }
    if (opts.unauthorizedSku && body.sku === opts.unauthorizedSku) return json(route, 401, { error: 'unauthorized' })
    const row = st[body.sku]
    if (!row) return json(route, 404, { error: 'sku_not_found' })
    if (opts.conflictSku === body.sku && !conflicted) {
      conflicted = true; row.stock = 9; row.v += 1
      return json(route, 409, { error: 'stock_changed', stock: row.stock, unit_cost_kwd: row.cost, low_stock_threshold: row.low, inventory_version: row.v })
    }
    if (body.expected_version !== row.v) {
      return json(route, 409, { error: 'stock_changed', stock: row.stock, unit_cost_kwd: row.cost, low_stock_threshold: row.low, inventory_version: row.v })
    }
    if (r === 'inventory_adjust') {
      if (body.type !== 'count' || !Number.isInteger(body.target_stock)) return json(route, 400, { error: 'invalid_adjustment_type' })
      row.stock = body.target_stock
    } else {
      if ('unit_cost_kwd' in body) row.cost = Number(body.unit_cost_kwd)
      if ('low_stock_threshold' in body) row.low = body.low_stock_threshold
    }
    row.v += 1
    return json(route, 200, { variant: shape(row), movement: {} })
  }
  return { st, calls, handle, bump(sku, stock) { st[sku].stock = stock; st[sku].v += 1 } }
}

// ---------------------------------------------------------------- the page: the live Inventory header, the block, the fake API
const BACKENDS_HTML = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"></head><body>
  <main class="admin-content"><div class="inventory-heading"><h1>Inventory</h1>
    <div class="inventory-heading__actions"><button class="inventory-refresh" type="button">Refresh</button>
    <button class="inventory-refresh" type="button">Export CSV</button><span class="inventory-live-status">Live</span></div></div>
  </main></body></html>`

async function openEditor(browser, block, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  const page = await ctx.newPage()
  const server = makeServer(opts)
  await page.route('https://admin.test/api/admin.php**', (route) => server.handle(route))
  await page.route('https://admin.test/backends**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: BACKENDS_HTML }))
  await page.goto('https://admin.test/backends')
  await page.addScriptTag({ content: block })
  await page.waitForSelector('[data-sporta-inv-edit]', { timeout: 5000 })
  return { ctx, page, server, close: () => ctx.close() }
}
async function openDialog(page) {
  await page.click('[data-sporta-inv-edit]')
  await page.waitForSelector('[data-sie="overlay"] tr[data-sie-sku]', { timeout: 5000 })
}
const cell = (page, sku, i) => page.locator(`tr[data-sie-sku="${sku}"] input`).nth(i) // 0 stock, 1 low level, 2 unit cost
const statusOf = (page, sku) => page.locator(`tr[data-sie-sku="${sku}"] .sie-st`).textContent()
const saveBtn = (page) => page.locator('[data-sie="overlay"] .sie-foot .sie-p')
async function saveAndWait(page) {
  await saveBtn(page).click()
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-sie="overlay"] .sie-msg')
    return m && m.textContent.indexOf('Not saved:') >= 0
  }, null, { timeout: 15000 })
}
const seq = (calls) => calls.map((c) => `${c.r}:${c.body.sku}`).join(' ')

// ---------------------------------------------------------------- scenarios (each returns nothing; checks are recorded)
async function scenarioStatic() {
  head('0. static')
  is(ADDON.split('/* ===== ADMIN INVENTORY EDITOR - begin').length === 2, 'the block begins once')
  is(ADDON.split('/* ===== ADMIN INVENTORY EDITOR - end').length === 2, 'the block ends once')
  is(BLOCK.length > 4000, 'the block was found and sliced', String(BLOCK.length))
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'console.', 'eval(', 'document.write', 'localStorage', 'sessionStorage', 'setInterval']) {
    is(CODE.indexOf(bad) < 0, `no ${bad}`)
  }
  const posts = [...CODE.matchAll(/post\('([a-z_]+)'/g)].map((m) => m[1])
  is(posts.length === 2 && posts.includes('inventory_adjust') && posts.includes('inventory_variant_save'), 'the only writes are inventory_adjust and inventory_variant_save', posts.join(','))
  is(CODE.indexOf('?r=variants') >= 0 && (CODE.match(/\?r=variants/g) || []).length === 1, 'one read of the stock list')
}

async function scenarioButton(browser) {
  head('1. the button')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const server = makeServer()
  await page.route('https://admin.test/api/admin.php**', (route) => server.handle(route))
  await page.route('https://admin.test/backends**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: BACKENDS_HTML }))
  await page.route('https://admin.test/shop**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main><p>shop</p></main>' }))
  await page.goto('https://admin.test/backends')
  await page.addScriptTag({ content: BLOCK })
  await page.waitForSelector('[data-sporta-inv-edit]', { timeout: 5000 })
  is(await page.locator('[data-sporta-inv-edit]').count() === 1, 'one Edit sizes button')
  const order = await page.evaluate(() => {
    const b = document.querySelector('[data-sporta-inv-edit]'), live = document.querySelector('.inventory-live-status')
    return b.parentNode.className + ' ' + (b.nextElementSibling === live ? 'before-live' : 'other')
  })
  is(order.indexOf('inventory-heading__actions') === 0 && order.indexOf('before-live') >= 0, 'it sits in the Inventory header before the live status', order)
  is(server.calls.length === 0, 'nothing is read until the button is pressed')
  await ctx.close()

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p2 = await ctx2.newPage()
  await p2.route('https://admin.test/shop**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main><p>shop</p></main>' }))
  await p2.goto('https://admin.test/shop')
  await p2.addScriptTag({ content: BLOCK })
  await p2.waitForTimeout(900)
  is(await p2.locator('[data-sporta-inv-edit]').count() === 0, 'no button outside /backends')
  await ctx2.close()
}

async function scenarioTable(browser) {
  head('2. the table, typing, validation')
  const ed = await openEditor(browser, BLOCK)
  const { page, server } = ed
  await openDialog(page)
  is(server.calls.length === 0 && (await page.locator('tr[data-sie-sku]').count()) === 3, 'opening reads the list once and shows every size (3 rows)')
  is((await cell(page, 'SKU-A-S', 0).inputValue()) === '5' && (await cell(page, 'SKU-A-S', 2).inputValue()) === '3.500', 'boxes show the current stock and unit cost')
  await cell(page, 'SKU-A-S', 0).fill('8')
  is((await statusOf(page, 'SKU-A-S')).trim() === 'Changed', 'a changed box marks its row "Changed"')
  is(server.calls.length === 0, 'typing writes nothing')
  await cell(page, 'SKU-B-L', 0).fill('abc')
  is((await statusOf(page, 'SKU-B-L')).indexOf('Stock:') >= 0, 'a bad box is marked with its reason', await statusOf(page, 'SKU-B-L'))
  is(await saveBtn(page).isDisabled(), 'a bad box disables Save')
  const sum = await page.locator('[data-sie="overlay"] .sie-sum').textContent()
  is(sum.indexOf('1 changed') >= 0 && sum.indexOf('1 need fixing') >= 0, 'the footer counts the changes and the problems', sum)
  await cell(page, 'SKU-B-L', 0).fill('10')
  is(!(await saveBtn(page).isDisabled()), 'fixing the box enables Save again')
  await ed.close()
}

async function scenarioSave(browser, block = BLOCK) {
  head('3. saving: order, versions, Arabic digits, no spurious cost write')
  const ed = await openEditor(browser, block)
  const { page, server } = ed
  await openDialog(page)
  await cell(page, 'SKU-A-S', 0).fill('8')
  await cell(page, 'SKU-A-S', 1).fill('4')
  await cell(page, 'SKU-A-S', 2).fill('3.750')
  await cell(page, 'SKU-B-L', 0).fill('١٢')
  await saveAndWait(page)
  // rows are written in product order: hoodie-b (SKU-B-L) before tee-a (SKU-A-S, then SKU-A-M)
  const s = seq(server.calls)
  is(s === 'inventory_adjust:SKU-B-L inventory_adjust:SKU-A-S inventory_variant_save:SKU-A-S', 'writes: each row in product order; stock first, then cost/low only where they changed', s)
  const b = server.calls[0], a = server.calls[1], v = server.calls[2]
  is(b && b.body.type === 'count' && b.body.target_stock === 12 && b.body.expected_version === 7, 'Arabic-Indic digits are read: the stock write carries 12 and version 7', JSON.stringify(b && b.body))
  is(a && a.body.type === 'count' && a.body.target_stock === 8 && a.body.expected_version === 3, 'the stock write carries target_stock 8 and version 3', JSON.stringify(a && a.body))
  is(v && v.body.expected_version === 4, 'the cost write carries the NEW version (4), not the old one', JSON.stringify(v && v.body))
  is(v && v.body.unit_cost_kwd === '3.750' && v.body.low_stock_threshold === 4, 'the cost write carries the typed cost and low level', JSON.stringify(v && v.body))
  is(server.st['SKU-A-S'].stock === 8 && server.st['SKU-A-S'].cost === 3.75 && server.st['SKU-A-S'].low === 4, 'the server now holds the saved values')
  is((await statusOf(page, 'SKU-A-S')).trim() === 'Saved' && (await statusOf(page, 'SKU-B-L')).trim() === 'Saved', 'both rows end "Saved"')
  is((await page.locator('[data-sie="overlay"] .sie-sum').textContent()).indexOf('0 changed') >= 0, 'nothing is left changed')
  is(await saveBtn(page).isDisabled(), 'Save is off when nothing differs')
  await ed.close()
}

async function scenarioConflict(browser, block = BLOCK) {
  head('4. a size changed in another session (409)')
  const ed = await openEditor(browser, block, { conflictSku: 'SKU-A-S' })
  const { page, server } = ed
  await openDialog(page)
  await cell(page, 'SKU-A-S', 0).fill('8')
  await cell(page, 'SKU-A-S', 2).fill('4.000')
  await cell(page, 'SKU-B-L', 2).fill('6.500')
  await saveAndWait(page)
  const st = (await statusOf(page, 'SKU-A-S')).trim()
  is(st.indexOf('Changed in another session') >= 0, 'the conflicting row says it changed in another session', st)
  is((await cell(page, 'SKU-A-S', 0).inputValue()) === '9', 'the row now shows the other session\'s stock (9)')
  is(!server.calls.some((c) => c.r === 'inventory_variant_save' && c.body.sku === 'SKU-A-S'), 'the row\'s cost is not written after its conflict')
  is(server.st['SKU-A-S'].stock === 9 && server.st['SKU-A-S'].cost === 3.5, 'nothing of this save overwrote the other session on that row')
  is((await statusOf(page, 'SKU-B-L')).trim() === 'Saved' && server.st['SKU-B-L'].cost === 6.5, 'the other rows still save')
  await ed.close()
}

async function scenarioThrottle(browser, block = BLOCK) {
  head('5. 429 waits and retries')
  const ed = await openEditor(browser, block, { throttleOnce: true })
  const { page, server } = ed
  await openDialog(page)
  await cell(page, 'SKU-B-L', 0).fill('12')
  await saveAndWait(page)
  is(server.calls.filter((c) => c.r === 'inventory_adjust').length === 2, 'the throttled write is sent again once')
  is(server.st['SKU-B-L'].stock === 12 && (await statusOf(page, 'SKU-B-L')).trim() === 'Saved', 'and then it is saved')
  await ed.close()
}

async function scenarioStop(browser, block = BLOCK) {
  head('6. stop after this one')
  const ed = await openEditor(browser, block, { delayMs: 700 })
  const { page, server } = ed
  await openDialog(page)
  await cell(page, 'SKU-A-S', 0).fill('6')
  await cell(page, 'SKU-B-L', 0).fill('7')
  await cell(page, 'SKU-A-M', 0).fill('2')
  await saveBtn(page).click()
  await page.getByRole('button', { name: 'Stop after this one' }).click({ timeout: 3000 }).catch(() => {})
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-sie="overlay"] .sie-msg')
    return m && m.textContent.indexOf('Not saved:') >= 0
  }, null, { timeout: 15000 })
  is(seq(server.calls) === 'inventory_adjust:SKU-B-L', 'only the row in flight is written; the rest are not sent', seq(server.calls))
  is((await statusOf(page, 'SKU-A-S')).indexOf('stopped') >= 0 && (await statusOf(page, 'SKU-A-M')).indexOf('stopped') >= 0, 'the rest read "Not saved (stopped)"')
  is(server.st['SKU-A-S'].stock === 5 && server.st['SKU-A-M'].stock === 0, 'and their stock is unchanged on the server')
  await ed.close()
}

async function scenarioSignedOut(browser) {
  head('7. signed out mid-run')
  const ed = await openEditor(browser, BLOCK, { unauthorizedSku: 'SKU-A-S' })
  const { page, server } = ed
  await openDialog(page)
  await cell(page, 'SKU-A-S', 0).fill('8')
  await cell(page, 'SKU-B-L', 0).fill('7')
  await saveAndWait(page)
  // hoodie-b (SKU-B-L) is written first and saved; tee-a (SKU-A-S) answers 401, and the run stops there
  is((await statusOf(page, 'SKU-A-S')).indexOf('session ended') >= 0, 'the session message shows on the row', await statusOf(page, 'SKU-A-S'))
  is(seq(server.calls) === 'inventory_adjust:SKU-B-L inventory_adjust:SKU-A-S', 'the run stops at the 401: no further row is sent', seq(server.calls))
  is(server.st['SKU-B-L'].stock === 7 && server.st['SKU-A-S'].stock === 5, 'the row before the 401 is saved; the one that got 401 is not')
  await ed.close()
}

async function scenarioStale(browser) {
  head('8. Refresh after another session changed a typed row')
  const ed = await openEditor(browser, BLOCK)
  const { page, server } = ed
  await openDialog(page)
  await cell(page, 'SKU-A-S', 0).fill('8')
  server.bump('SKU-A-S', 9)
  await page.locator('[data-sie="overlay"] .sie-tools button', { hasText: 'Refresh' }).click()
  await page.waitForFunction(() => {
    const c = document.querySelector('tr[data-sie-sku="SKU-A-S"] input')
    return c && c.value === '9'
  }, null, { timeout: 5000 })
  is((await statusOf(page, 'SKU-A-S')).indexOf('Changed elsewhere since you typed') >= 0, 'the row says it changed elsewhere since the person typed', await statusOf(page, 'SKU-A-S'))
  is((await cell(page, 'SKU-A-S', 0).inputValue()) === '9', 'the typed 8 is dropped and the current 9 is shown')
  is(await saveBtn(page).isDisabled(), 'nothing is left to save')
  await ed.close()
}

async function scenarioFilters(browser) {
  head('9. filters')
  const ed = await openEditor(browser, BLOCK)
  const { page } = ed
  await openDialog(page)
  await cell(page, 'SKU-B-L', 0).fill('11')
  await page.locator('[data-sie="overlay"] .sie-tools label input').check()
  is((await page.locator('tr[data-sie-sku]').count()) === 1 && (await page.locator('tr[data-sie-sku="SKU-B-L"]').count()) === 1, '"Changed only" shows the one changed row')
  await page.locator('[data-sie="overlay"] .sie-tools label input').uncheck()
  await page.locator('[data-sie="overlay"] .sie-tools input[type=search]').fill('hoodie')
  is((await page.locator('tr[data-sie-sku]').count()) === 1, 'search by name finds the hoodie size')
  await page.locator('[data-sie="overlay"] .sie-tools input[type=search]').fill('')
  await page.locator('[data-sie="overlay"] .sie-tools select').selectOption('men')
  is((await page.locator('tr[data-sie-sku]').count()) === 2, 'the category "men" shows its two sizes')
  await ed.close()
}

async function scenarioClose(browser) {
  head('10. closing with changes asks first')
  const ed = await openEditor(browser, BLOCK)
  const { page } = ed
  await openDialog(page)
  await cell(page, 'SKU-A-S', 0).fill('8')
  let asked = false
  page.once('dialog', (d) => { asked = true; d.dismiss() })
  await page.keyboard.press('Escape')
  await sleep(300)
  is(asked && (await page.locator('[data-sie="overlay"]').count()) === 1, 'Escape asks, and "Cancel" keeps the editor open')
  page.once('dialog', (d) => d.accept())
  await page.keyboard.press('Escape')
  await sleep(300)
  is((await page.locator('[data-sie="overlay"]').count()) === 0, 'accepting closes it')
  await ed.close()
}

// ---------------------------------------------------------------- run
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
await scenarioStatic()
await scenarioButton(browser)
await scenarioTable(browser)
await scenarioSave(browser)
await scenarioConflict(browser)
await scenarioThrottle(browser)
await scenarioStop(browser)
await scenarioSignedOut(browser)
await scenarioStale(browser)
await scenarioFilters(browser)
await scenarioClose(browser)

// ---------------------------------------------------------------- mutation: each cut-out must turn a check red
head('11. mutation (each cut-out must fail)')
const MUTANTS = [
  { name: 'cost write without expected_version', from: "{ sku: r.sku, expected_version: r.version, note: note() }", to: '{ sku: r.sku, note: note() }' },
  { name: 'no conflict handling (409 read as a plain error)', from: 'if (x.status === 409) { applyConflict(r, x.j);', to: 'if (x.status === 409 && false) { applyConflict(r, x.j);' },
  { name: 'cost write uses the OLD version', from: "if (x.ok && x.j && x.j.variant) { applyVariant(r, x.j.variant); return null }", to: "if (x.ok && x.j && x.j.variant) { return null }" },
  { name: 'Stop ignored', from: 'if (S.stop || i >= list.length) return finish()', to: 'if (i >= list.length) return finish()' }
]
for (const m of MUTANTS) {
  const mutated = BLOCK.replace(m.from, m.to)
  if (mutated === BLOCK) { is(false, `mutant applied: ${m.name}`, 'the source text was not found'); continue }
  let reds = 0
  const probes = [
    () => scenarioSave(browser, mutated), () => scenarioConflict(browser, mutated), () => scenarioStop(browser, mutated)
  ]
  // the probes' own checks are counted here, then the run's totals are put back to what they were before the probes
  const passBefore = pass, failBefore = fail
  const quiet = console.log
  console.log = () => {}
  for (const p of probes) { try { await p() } catch (e) { reds++ } }
  console.log = quiet
  const newFails = fail - failBefore
  pass = passBefore; fail = failBefore
  is(reds > 0 || newFails > 0, `mutation red: ${m.name}`, `${newFails} failing check(s), ${reds} thrown`)
}

await browser.close()
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
