/**
 * Inventory tools: search and filter, low-stock warnings, save-all-sizes, stock
 * history, spreadsheet export and import.
 *
 *   node scripts/inventory-tools-test.mjs      (npm run test:inventory)
 *
 * Fixture: flash-shorts-green, NAMED (eight sizes, one sku each; tekno-shorts-black in the sandbox carries two ladders) (a fixture chosen by position is chosen at
 * random). Every count it changes is put back, and every log row it caused is
 * deleted. What is asserted, and why:
 *  - the gate; validation of the low-stock line;
 *  - a DRY run writes nothing and says what would change; an apply writes the
 *    counts, logs each one with who/why/delta/after, and logs nothing for a
 *    count that did not change;
 *  - every refusal is ALL OR NOTHING: one bad row and NOTHING moves;
 *  - the two order paths log too (a real COD order, then its release), under the
 *    ACTUAL sku, since shops import supplier codes;
 *  - in the real panel: the card, the chips, search, filters, tint, save-all, CSV
 *    export and a previewed import that is disabled while it has a problem.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ADMIN = BASE + '/api/admin.php'
const SLUG = 'flash-shorts-green'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N'], { input: q, encoding: 'utf8' }).trim()
const stockOf = () => Object.fromEntries(sql(`select sku, stock from product_variants where slug='${SLUG}'`).split('\n').map((l) => l.split('\t')).map(([k, v]) => [k, Number(v)]))

const start = stockOf()
const SKUS = Object.keys(start).sort()
check(SKUS.length === 8, 'the named fixture is there with eight sizes', SKUS.join(','))
const [S1, S2] = [SKUS.find((s) => s.endsWith('-M')), SKUS.find((s) => s.endsWith('-L'))]
const lowStart = sql("select value from settings where name='inventory'")
const logStart = Number(sql('select coalesce(max(id),0) from stock_log'))
const restore = () => {
  for (const [sku, n] of Object.entries(start)) sql(`update product_variants set stock=${n} where sku='${sku}'`)
  sql(`delete from stock_log where id > ${logStart}`)
  sql(lowStart ? `update settings set value='${lowStart.replace(/'/g, "''")}' where name='inventory'` : "delete from settings where name='inventory'")
}

let cookie = ''
const admin = (route, body) => fetch(`${ADMIN}?r=${route}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  for (const [route, body] of [['inventory_meta'], ['inventory_log'], ['inventory_low_save', {}], ['inventory_apply', {}]]) {
    const r = await fetch(`${ADMIN}?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: body ? '{}' : undefined })
    check(r.status === 401, `${route} answers 401 to a stranger`, `got ${r.status}`)
  }
  await page.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw')
    await page.fill('input[type=password]', 'correct horse')
    await page.locator('form button, button').first().click()
    await page.waitForTimeout(1600)
  }
  cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')

  /* ------------------------------------------------------ the line -------- */
  const m0 = await admin('inventory_meta')
  check(m0.status === 200 && m0.j.low === 5 && Array.isArray(m0.j.hidden) && m0.j.log_ready === true, 'the meta route answers: low-stock line 5, hidden list, history ready', JSON.stringify(m0.j).slice(0, 90))
  for (const bad of [-1, 1000, 'x', null]) check((await admin('inventory_low_save', { low: bad })).status === 400, `a low-stock line of ${JSON.stringify(bad)} is refused`)
  check((await admin('inventory_low_save', { low: 12 })).j?.low === 12 && (await admin('inventory_meta')).j.low === 12, 'a valid line is saved and read back')

  /* ---------------------------------------- dry run, apply, log ------------ */
  const dry = await admin('inventory_apply', { dry: true, changes: [{ sku: S1, stock: '7' }, { sku: S2, stock: String(start[S2]) }] })
  check(dry.status === 200 && dry.j.changed === 1 && dry.j.rows.find((r) => r.sku === S1).before === start[S1] && dry.j.rows.find((r) => r.sku === S2).status === 'same', 'a dry run says one changes and one already matches', JSON.stringify(dry.j.rows.map((r) => r.status)))
  check(stockOf()[S1] === start[S1], 'and wrote nothing')
  const ap = await admin('inventory_apply', { reason: 'bulk', changes: [{ sku: S1, stock: '7' }, { sku: S2, stock: 9 }] })
  check(ap.status === 200 && ap.j.changed === 2 && stockOf()[S1] === 7 && stockOf()[S2] === 9, 'an apply writes both counts', JSON.stringify(ap.j.changed))
  const lg = sql(`select sku, delta, stock_after, reason, actor from stock_log where id > ${logStart} order by id`).split('\n').map((l) => l.split('\t'))
  check(lg.length === 2 && lg.find((r) => r[0] === S1)[1] === String(7 - start[S1]) && lg.find((r) => r[0] === S1)[2] === '7' && lg.every((r) => r[3] === 'bulk' && r[4] === 'manager@sporta.com.kw'), 'each change is logged with delta, the count after, the reason and WHO', JSON.stringify(lg[0]))
  await admin('inventory_apply', { changes: [{ sku: S1, stock: 7 }] })
  check(Number(sql(`select count(*) from stock_log where id > ${logStart}`)) === 2, 'a count that did not change writes no log row')
  const lr = await admin('inventory_log&slug=' + SLUG)
  check(lr.status === 200 && lr.j.ready && lr.j.rows.length === 2 && lr.j.rows[0].id > lr.j.rows[1].id && !!lr.j.rows[0].name_en, 'the history route lists them newest first, with the product name', JSON.stringify(lr.j).slice(0, 200))

  // A size that already has a row (under an IMPORTED supplier sku) is edited, not doubled.
  const vs = await admin('variant_save', { slug: SLUG, size: S1.split('-').pop(), stock: 8 })
  check(vs.status === 200 && vs.j.sku === S1 && Object.keys(stockOf()).length === 8 && stockOf()[S1] === 8, 'variant_save on an existing size edits the row it has (same sku, still eight rows), not a second one', `${vs.j?.sku}`)
  await admin('inventory_apply', { changes: [{ sku: S1, stock: 7 }] })

  /* -------------------------------- refusals are all-or-nothing ------------ */
  const snap = () => JSON.stringify(stockOf()) + sql(`select count(*) from stock_log where id > ${logStart}`)
  const refuse = async (what, changes, token) => {
    const s = snap(); const r = await admin('inventory_apply', { changes })
    check(r.status === 400 && r.j?.rows?.some((x) => x.status === token), `${what} refuses the whole batch (${token})`, `${r.status}`)
    check(snap() === s, '  and NOTHING moved — not even the valid row in the same batch')
  }
  await refuse('one unknown item code', [{ sku: S1, stock: 1 }, { sku: 'NO-SUCH', stock: 1 }], 'unknown_sku')
  await refuse('a negative count', [{ sku: S1, stock: 1 }, { sku: S2, stock: '-3' }], 'invalid_stock')
  await refuse('"12abc"', [{ sku: S1, stock: '12abc' }], 'invalid_stock')
  await refuse('a repeated item code', [{ sku: S1, stock: 1 }, { sku: S1, stock: 2 }], 'duplicate_sku')
  const many = await admin('inventory_apply', { changes: Array.from({ length: 601 }, () => ({ sku: S1, stock: 1 })) })
  check(many.status === 400 && /too_many_rows/.test(JSON.stringify(many.j)), '601 rows is refused as too many')
  check((await admin('inventory_apply', { changes: [] })).status === 400, 'an empty list is refused')

  /* ------------------------------------- the two order paths log ----------- */
  const track = 'INVT' + Math.random().toString(36).slice(2, 9).toUpperCase()
  const size = S1.split('-').pop()
  const before = stockOf()[S1]
  const ord = await fetch(`${BASE}/api/api.php?r=order`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ track_id: track, payment_method: 'cod', lang: 'en', items: [{ slug: SLUG, size, qty: 2 }], customer: { name: 'Inventory Rig', phone: '5' + String(Date.now()).slice(-7), email: 'rig@example.com', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' } }) })
  check(ord.status === 200, 'a real cash-on-delivery order is accepted', String(ord.status))
  const oid = Number(sql(`select id from orders where track_id='${track}'`))
  check(stockOf()[S1] === before - 2, 'it took two from the shelf')
  const ol = sql(`select sku, delta, stock_after, reason from stock_log where reason='order' and id > ${logStart}`).split('\n').map((l) => l.split('\t'))
  check(ol.length === 1 && ol[0][0] === S1 && ol[0][1] === '-2' && ol[0][2] === String(before - 2), 'and logged it under the ACTUAL sku, -2, with the count left', JSON.stringify(ol[0]))
  const rel = execFileSync('php', ['-r', `require '${process.cwd()}/sporta-site/public_html/api/store.php'; $db = store_db(); echo store_stock_release($db, ${oid}) ? 'released' : 'no';`], { encoding: 'utf8' })
  check(/released/.test(rel) && stockOf()[S1] === before, 'releasing that order puts both back', rel.slice(-40))
  const rl = sql(`select delta, reason, ref from stock_log where reason='release' and id > ${logStart}`).split('\t')
  check(rl[0] === '2' && rl[1] === 'release' && rl[2] === 'order:' + oid, 'and logs the release against the order', rl.join(' '))
  sql(`delete from order_items where order_id=${oid}`); sql(`delete from orders where id=${oid}`)

  /* -------------------------------------------------------- the panel ------ */
  await page.getByText('Inventory', { exact: true }).first().click()
  await page.waitForSelector('[data-sporta-inventory] .spinv-chip', { timeout: 10000 })
  const chips = await page.locator('[data-sporta-inventory] .spinv-chip').allInnerTexts()
  check(chips.length === 4 && /sold out/.test(chips[0]) && /low/.test(chips[1]), 'the card is on the Inventory screen with its four counts', chips.join(' | '))
  const rowsAll = await page.locator('table.admin-table tbody tr').count()
  await page.fill('[data-sporta-inventory] input[type=search]', 'flash shorts green')
  await page.waitForTimeout(400)
  const shown = await page.locator('table.admin-table tbody tr:not(.spinv-hide)').count()
  check(shown === 8 && rowsAll > shown, 'searching narrows the list to that product (all eight sizes, even if the group was collapsed)', `${shown} of ${rowsAll}`)
  await page.fill('[data-sporta-inventory] input[type=search]', '')
  await page.locator('[data-sporta-inventory] select[aria-label=Filter]').selectOption('low')
  await page.waitForTimeout(400)
  const lowShown = await page.locator('table.admin-table tbody tr:not(.spinv-hide)').count()
  const lowTinted = await page.locator('table.admin-table tbody tr.spinv-low').count()
  check(lowShown === lowTinted, 'the Low filter shows exactly the tinted rows', `${lowShown}/${lowTinted}`)
  await page.locator('[data-sporta-inventory] select[aria-label=Filter]').selectOption('all')
  sql(`update product_variants set stock=0 where sku='${S2}'`)
  await page.reload({ waitUntil: 'networkidle' }); await page.getByText('Inventory', { exact: true }).first().click()
  await page.waitForSelector('[data-sporta-inventory] .spinv-chip')
  await page.waitForTimeout(600)
  check((await page.locator('table.admin-table tbody tr.spinv-out').count()) >= 1, 'a size at zero is tinted as sold out')

  await page.locator('[data-sporta-inventory] select[aria-label="Product to edit"]').selectOption(SLUG)
  await page.locator(`[data-sporta-inventory] input[data-sku="${S1}"]`).fill('11')
  await page.getByRole('button', { name: 'Save all sizes' }).click()
  await page.waitForFunction(() => /Saved 1 change/.test(document.querySelector('[data-sporta-inventory]')?.textContent || ''), null, { timeout: 8000 })
  check(stockOf()[S1] === 11, 'Save all sizes writes the edited count')
  await page.waitForSelector('[data-sporta-inventory] .spinv-chip', { timeout: 12000 })
  check((await page.locator('h1:has-text("Inventory")').count()) === 1, 'and the panel reloads onto the Inventory screen')
  const row = page.locator('table.admin-table tbody tr', { hasText: S1 }).locator('input[inputmode=numeric]')
  await page.waitForFunction((sku) => { const t = [...document.querySelectorAll('table.admin-table tbody tr')].find((r) => r.textContent.includes(sku)); return t && t.querySelector('input[inputmode=numeric]').value === '11' }, S1, { timeout: 10000 }).catch(() => {})
  const shownVal = await row.inputValue()
  check(shownVal === '11', 'where the bundle\'s own list shows the new number, not the old one', shownVal)

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
  const csv = readFileSync(await dl.path(), 'utf8')
  check(/^﻿?sku,product,size,stock\r?\n/.test(csv) && csv.includes(S1) && !/cost/i.test(csv.split('\n')[0]), 'Export CSV downloads sku,product,size,stock and leaves the wholesale cost out', csv.split('\n')[0])
  const goodCsv = `sku,product,size,stock\r\n${S1},x,M,21\r\n${S2},x,L,0\r\n`
  const badCsv = `sku,stock\r\n${S1},5\r\nNO-SUCH,3\r\n`
  const upload = async (text) => page.locator('[data-sporta-inventory] input[type=file]').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from(text) })
  await upload(badCsv)
  await page.waitForSelector('[data-sporta-inventory] .spinv-box')
  check(await page.getByRole('button', { name: /^Apply/ }).isDisabled(), 'a spreadsheet with a bad row is previewed and its Apply button is disabled')
  check(/no such item code/.test(await page.locator('[data-sporta-inventory] .spinv-box').innerText()), 'and the problem is named')
  check(stockOf()[S1] === 11, 'nothing was written by the preview')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await upload(goodCsv)
  await page.waitForSelector('[data-sporta-inventory] .spinv-box')
  const ab = page.getByRole('button', { name: /^Apply 1 change/ })
  check(await ab.isEnabled(), 'a clean spreadsheet shows one change (S2 already at 0) and Apply is enabled')
  await ab.click()
  await page.waitForFunction(() => /Saved 1 change/.test(document.querySelector('[data-sporta-inventory]')?.textContent || ''), null, { timeout: 8000 })
  check(stockOf()[S1] === 21 && sql(`select count(*) from stock_log where reason='import' and sku='${S1}' and id > ${logStart}`) === '1', 'Apply writes it and logs it as an import')
  await page.waitForSelector('[data-sporta-inventory] .spinv-chip', { timeout: 12000 })
  await page.getByRole('button', { name: 'Recent changes' }).click()
  await page.waitForSelector('[data-sporta-inventory] .spinv-box:has-text("Recent changes") .spinv-li')
  const histText = await page.locator('[data-sporta-inventory] .spinv-box:has-text("Recent changes") .spinv-list').innerText()
  check(/import/.test(histText) && /manager@sporta\.com\.kw/.test(histText), 'Recent changes lists it with the reason and who')
  await page.getByText('Orders', { exact: true }).first().click()
  await page.waitForSelector('.admin-content h1:has-text("Orders")'); await page.waitForTimeout(600)
  check((await page.locator('[data-sporta-inventory]').count()) === 0, 'the card removes itself on another screen')
  check(errors.length === 0, 'no script errors in the panel', errors.join(' | ').slice(0, 120))
} catch (e) {
  fails++; console.log('FAIL ' + (e?.stack ?? e))
} finally {
  restore()
  await browser.close()
}
check(JSON.stringify(stockOf()) === JSON.stringify(start), 'every count is exactly as it was found')
console.log(fails ? `\n${fails} failed` : '\nall ok — inventory is searchable, warned, logged and importable')
process.exit(fails ? 1 : 0)
