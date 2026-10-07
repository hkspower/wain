/**
 * "improve inventory", 2026-10-04 — the four improvements the owner chose, measured:
 *
 *   node scripts/inventory-plus-test.mjs        (npm run test:inventory-plus)
 *
 *   A. Low-stock alerts: cron-lowstock.php refuses without the key; with it, it reports STATE and mails
 *      the alert address once a day (the sandbox's mail() fails, so `sent` is false with `mail_failed`,
 *      and that is what is asserted — never a silent "ok"); no address → `no_address`; nothing low →
 *      `nothing_low`. inventory_low_save stores/refuses the address. inventory_meta carries the
 *      attention count, and the Inventory nav button wears it as a badge on another screen.
 *   B. Faster editing: −/+ change the box, ↑ steps, Enter saves through inventory_apply (logged), the
 *      saved batch can be UNDONE (stock back, logged 'undo'), clicking a row of the bundle's list selects
 *      that product in the grid.
 *   C. Purchasing: suppliers CRUD; reorder suggestions computed from planted orders (per-day rate, cover,
 *      suggested quantity = rate × (lead + 14) − stock − on order); a PO created from the suggestion,
 *      received → stock up by the lines, stock_log 'purchase' rows with ref PO-n, receiving twice refused;
 *      cancel moves nothing; refusals by name.
 *   D. Labels & scan: labels.php refuses signed-out, prints one Code 128 SVG per size (checksum verified
 *      by decoding the bars), copies honoured; the Scan sheet opens, a typed code selects the product and
 *      focuses its size, an unknown code says so.
 *
 * Fixture: flash-shorts-green (named, eight sizes). Orders are planted and removed; stock restored.
 * MUTATE=1 (should FAIL): po_receive no longer adds stock — caught by C5.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
const ROOT = new URL('../', import.meta.url).pathname
const ADMIN_PHP = ROOT + 'sporta-site/public_html/api/admin.php'
const SLUG = 'flash-shorts-green'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split('\t'))
const cfg = JSON.parse(execFileSync('php', ['-r', 'echo json_encode(require $argv[1]);', ROOT + 'sporta-site/public_html/api/config.php'], { encoding: 'utf8' }))

const start = Object.fromEntries(rows(`select sku, stock from product_variants where slug = '${SLUG}'`).map(([k, v]) => [k, Number(v)]))
const SKUS = Object.keys(start)
check(SKUS.length === 8, 'the named fixture is there with eight sizes', SKUS.join(','))
const invStart = sql("select quote(value) from settings where name = 'inventory'") || null
const logStart = Number(sql('select coalesce(max(id),0) from stock_log'))
const pid = Number(sql(`select id from products where slug = '${SLUG}'`))
const original = readFileSync(ADMIN_PHP, 'utf8')
if (process.env.MUTATE) writeFileSync(ADMIN_PHP, original.replace("$upd->execute([(int) $l['qty'], $l['cost_aed'], $l['sku']]);", "/* MUTATED */"))
sql('delete from rate_limit; delete from rate_bucket')
sql("delete from purchase_order_items where po_id in (select id from purchase_orders where note like 'rig:%')"); sql("delete from purchase_orders where note like 'rig:%'"); sql("delete from suppliers where name like 'Rig Supplier%'")
sql("delete from order_items where order_id in (select id from orders where track_id like 'SPINVPLUS%')"); sql("delete from orders where track_id like 'SPINVPLUS%'")

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const admin = async (route, body) => {
  const r = body
    ? await ctx.request.post(`${BASE}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
    : await ctx.request.get(`${BASE}/api/admin.php?r=${route}`, { headers: { 'X-Sporta-Admin': '1' }, failOnStatusCode: false })
  return { status: r.status(), j: await r.json().catch(() => null) }
}
const cron = async (q) => { const r = await fetch(`${BASE}/api/cron-lowstock.php${q}`); return { status: r.status, j: await r.json().catch(() => null) } }
const openInventory = async (p) => {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  await p.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((b) => /^\s*Inventory\s*\d*\s*$/.test(b.textContent)).click())
  await p.waitForSelector('[data-sporta-inventory] select', { timeout: 15000 }); await p.waitForTimeout(800)
}

try {
  /* ------------------------------------------------------------- A. alerts */
  check((await admin('login', { email: EMAIL, password: PASSWORD })).status === 200, 'A0 signed in')
  check((await cron('')).status === 403 && (await cron('?key=' + encodeURIComponent(cfg.cron_key + 'x'))).status === 403, 'A1 cron-lowstock refuses without the key and with a wrong key')
  const low = Number(JSON.parse(sql("select value from settings where name = 'inventory'") || '{}').low ?? 5)
  const s0 = SKUS[0], s1 = SKUS[1]
  sql(`update product_variants set stock = 0 where sku = '${s0}'`); sql(`update product_variants set stock = ${Math.max(0, low)} where sku = '${s1}'`)
  let r = await admin('inventory_low_save', { low, alert_email: 'not an email' })
  check(r.status === 400 && r.j?.error === 'invalid_alert_email', 'A2 a bad alert address is refused by name', `${r.status} ${r.j?.error}`)
  r = await admin('inventory_low_save', { low, alert_email: '' })
  check(r.status === 200 && r.j.alert_email === '', 'A3 an empty address clears it')
  let c = await cron('?key=' + encodeURIComponent(cfg.cron_key))
  check(c.status === 200 && c.j?.sent === false && c.j.why === 'no_address' && /items=\d+ soldOut=\d+/.test(c.j.state), 'A4 with no address: nothing sent, state says why', JSON.stringify(c.j))
  r = await admin('inventory_low_save', { low, alert_email: 'owner@example.com' })
  check(r.status === 200 && r.j.alert_email === 'owner@example.com', 'A5 a valid alert address is stored')
  c = await cron('?key=' + encodeURIComponent(cfg.cron_key) + '&force=1')
  check(c.status === 200 && c.j?.items >= 2 && (c.j.sent === true || c.j.why === 'mail_failed'), 'A6 with an address and low sizes it tries to mail (the sandbox has no mailer: mail_failed is the honest answer)', JSON.stringify(c.j))
  if (c.j?.sent) { const c2 = await cron('?key=' + encodeURIComponent(cfg.cron_key)); check(c2.j?.why === 'already_today', 'A6b a second run the same day does not mail again', JSON.stringify(c2.j)) }
  const meta = await admin('inventory_meta')
  const want = Number(sql(`select count(*) from product_variants v join products p on p.slug = v.slug where p.active = 1 and v.stock <= ${low}`))
  check(meta.j?.attention === want && meta.j.alert_email === 'owner@example.com' && typeof meta.j.purchasing_ready === 'boolean', 'A7 inventory_meta carries the attention count and the alert address', `${meta.j?.attention} vs ${want}`)
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000)
  const badge = await p.evaluate(() => { const b = [...document.querySelectorAll('.admin-sidebar button')].find((x) => /Inventory/.test(x.textContent)); const s = b && b.querySelector('.spinv-badge'); return s ? Number(s.textContent) : null })
  check(badge === want && want > 0, 'A8 the Inventory nav button wears the count as a badge on the Overview screen', String(badge))

  /* ------------------------------------------------------------ B. editing */
  sql(`update product_variants set stock = 7 where sku = '${s1}'`)
  await openInventory(p)
  await p.selectOption('[data-sporta-inventory] select[aria-label="Product to edit"]', SLUG); await p.waitForTimeout(300)
  const box = p.locator(`[data-sporta-inventory] input[data-sku="${s1}"]`)
  const v0 = await box.inputValue()
  await p.locator(`[data-sporta-inventory] button[aria-label="One more, size ${await p.evaluate((sku) => document.querySelector('[data-sku="' + sku + '"]').getAttribute('aria-label').replace('Stock, size ', ''), s1)}"]`).click()
  await p.locator(`[data-sporta-inventory] button[aria-label="One more, size ${await p.evaluate((sku) => document.querySelector('[data-sku="' + sku + '"]').getAttribute('aria-label').replace('Stock, size ', ''), s1)}"]`).click()
  check(await box.inputValue() === String(Number(v0) + 2) && await box.evaluate((e) => e.classList.contains('spinv-dirty')), 'B1 + steps the box by one and marks it changed', `${v0} -> ${await box.inputValue()}`)
  await box.focus(); await p.keyboard.press('ArrowUp')
  check(await box.inputValue() === String(Number(v0) + 3), 'B2 ↑ steps by one')
  await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
  await p.waitForSelector('[data-sporta-inventory] select', { timeout: 15000 }); await p.waitForTimeout(800)
  check(Number(sql(`select stock from product_variants where sku = '${s1}'`)) === Number(v0) + 3, 'B3 Enter saved the product through inventory_apply', sql(`select stock from product_variants where sku = '${s1}'`))
  check(rows(`select reason, delta from stock_log where id > ${logStart} and sku = '${s1}' order by id desc limit 1`)[0]?.join() === 'bulk,3', 'B4 the change is in the stock history', sql(`select reason, delta from stock_log where id > ${logStart} and sku = '${s1}' order by id desc limit 1`))
  const undo = p.locator('[data-spinv-undo]')
  check(await undo.count() === 1 && /Undo last change \(1 size\)/.test(await undo.textContent()), 'B5 an Undo button offers to reverse the batch', await undo.textContent().catch(() => ''))
  await undo.click(); await p.waitForTimeout(2500)
  await p.waitForSelector('[data-sporta-inventory] select', { timeout: 15000 }); await p.waitForTimeout(800)
  check(Number(sql(`select stock from product_variants where sku = '${s1}'`)) === Number(v0) && rows(`select reason, delta from stock_log where id > ${logStart} and sku = '${s1}' order by id desc limit 1`)[0]?.join() === 'undo,-3', 'B6 Undo puts the stock back and logs it as undo')
  const clicked = await p.evaluate((slug) => { const tr = [...document.querySelectorAll('.admin-content table.admin-table tbody tr, .admin-content .m-list > .m-row')].find((n) => n.textContent.includes('Flash Shorts')); if (!tr) return 'no-row'; tr.querySelector('td, .m-row__title').click(); return document.querySelector('[data-sporta-inventory] select[aria-label="Product to edit"]').value }, SLUG)
  check(clicked === SLUG, 'B7 clicking a row of the list selects that product in the grid', clicked)

  /* ---------------------------------------------------------- C. purchasing */
  r = await admin('supplier_save', { name: '', lead_days: 10 })
  check(r.status === 400 && r.j?.error === 'supplier_name_required', 'C1 a supplier needs a name')
  r = await admin('supplier_save', { name: 'Rig Supplier', contact: 'rig@example.com', lead_days: 10 })
  const supId = r.j?.id
  check(r.status === 200 && supId > 0, 'C2 a supplier saves', JSON.stringify(r.j))
  // plant 30 units of s1 sold over the last 10 days, stock 4, supplier lead 10 → horizon 24 days, rate 1/day → suggest 24-4 = 20
  const size1 = sql(`select size from product_variants where sku = '${s1}'`)
  sql(`update product_variants set stock = 4 where sku = '${s1}'`)
  for (let i = 0; i < 3; i++) {
    sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, created_at) values ('SPINVPLUS${i}', 30, 'paid', 'knet', 'delivered', 'Rig', '96555500${i}', now() - interval ${i * 3 + 1} day)`)
    const oid = Number(sql(`select id from orders where track_id = 'SPINVPLUS${i}'`))
    sql(`insert into order_items (order_id, product_id, qty, unit_price, size) values (${oid}, ${pid}, 10, 3.000, '${size1}')`)
  }
  await admin('supplier_save', { id: supId, name: 'Rig Supplier', contact: 'rig@example.com', lead_days: 10, skus: [s1] })
  let sg = await admin('reorder_suggestions&days=30')
  let row1 = (sg.j?.rows || []).find((x) => x.sku === s1)
  check(row1 && row1.sold === 30 && row1.per_day === 1 && row1.days_cover === 4 && row1.suggest === 20 && row1.supplier === 'Rig Supplier' && row1.lead_days === 10, 'C3 the suggestion: 30 sold / 30 days = 1 a day, 4 days cover, order 20 for lead 10 + 14', JSON.stringify(row1))
  r = await admin('po_save', { supplier_id: supId, note: 'rig: test order', items: [] })
  check(r.status === 400 && r.j?.error === 'po_empty', 'C4a an empty order is refused')
  r = await admin('po_save', { supplier_id: supId, note: 'rig: test order', items: [{ sku: 'NOPE-XX', qty: 1 }] })
  check(r.status === 400 && r.j?.error === 'unknown_sku:NOPE-XX', 'C4b an unknown code is refused by name')
  r = await admin('po_save', { supplier_id: supId, note: 'rig: test order', expected_on: '2026-10-20', items: [{ sku: s1, qty: 20, cost_aed: 12.5 }, { sku: s0, qty: 5 }] })
  const poId = r.j?.id
  check(r.status === 200 && poId > 0 && r.j.lines === 2, 'C4 a purchase order is created from the suggestion', JSON.stringify(r.j))
  sg = await admin('reorder_suggestions&days=30'); row1 = (sg.j?.rows || []).find((x) => x.sku === s1)
  check(!row1 || row1.on_order === 20, 'C4c the open order counts as cover (the size leaves the list or shows on_order=20)', JSON.stringify(row1))
  const before0 = Number(sql(`select stock from product_variants where sku = '${s0}'`))
  r = await admin('po_receive', { id: poId })
  const after1 = Number(sql(`select stock from product_variants where sku = '${s1}'`)), after0 = Number(sql(`select stock from product_variants where sku = '${s0}'`))
  check(r.status === 200 && r.j?.units === 25 && after1 === 24 && after0 === before0 + 5, 'C5 receiving adds every line to stock (4+20, +5)', `${r.status} ${after1} ${after0}`)
  const lg = rows(`select reason, delta, ref from stock_log where id > ${logStart} and reason = 'purchase' order by id`)
  check(lg.length === 2 && lg.every((l) => l[2] === 'PO-' + poId) && lg.map((l) => l[1]).sort().join() === '20,5', 'C6 two purchase rows in the stock history, ref PO-n', JSON.stringify(lg))
  check(sql(`select cost_aed from product_variants where sku = '${s1}'`) === '12.50', 'C7 the agreed cost is written to the variant')
  r = await admin('po_receive', { id: poId })
  check(r.status === 400 && r.j?.error === 'po_not_open' && Number(sql(`select stock from product_variants where sku = '${s1}'`)) === 24, 'C8 receiving twice is refused and moves nothing')
  r = await admin('po_save', { supplier_id: supId, note: 'rig: cancel me', items: [{ sku: s0, qty: 3 }] }); const po2 = r.j?.id
  r = await admin('po_cancel', { id: po2 })
  check(r.status === 200 && Number(sql(`select stock from product_variants where sku = '${s0}'`)) === before0 + 5 && sql(`select status from purchase_orders where id = ${po2}`) === 'cancelled', 'C9 cancelling moves no stock')
  r = await admin('supplier_delete', { id: supId })
  check(r.status === 200, 'C10 a supplier with no open orders deletes')
  const list = await admin('po_list')
  check(Array.isArray(list.j) && list.j.find((x) => x.id === poId)?.status === 'received' && list.j.find((x) => x.id === poId).items.length === 2, 'C11 po_list shows the received order with its lines')
  // the card
  await openInventory(p)
  await p.waitForSelector('[data-sporta-purchasing] .spur-tab', { timeout: 15000 })
  await p.evaluate(() => [...document.querySelectorAll('[data-sporta-purchasing] .spur-tab')].find((b) => /Purchase orders/.test(b.textContent)).click()); await p.waitForTimeout(400)
  const cardPo = await p.evaluate((id) => !!document.querySelector('[data-po="' + id + '"]'), poId)
  check(cardPo, 'C12 the Purchasing card lists the order')

  /* ----------------------------------------------------- D. labels and scan */
  const anonLab = await fetch(`${BASE}/api/labels.php?slug=${SLUG}`)
  check(anonLab.status === 401, 'D1 labels.php refuses a visitor', String(anonLab.status))
  const lab = await ctx.request.get(`${BASE}/api/labels.php?slug=${SLUG}&copies=2`)
  const html = await lab.text()
  const svgs = [...html.matchAll(/<svg class="bc"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/g)]
  check(lab.status() === 200 && svgs.length === 16 && new Set(svgs.map((m) => m[1])).size === 8, 'D2 the page prints one barcode per size × copies (8 × 2)', String(svgs.length))
  // decode one barcode from its bars: widths back to Code 128 symbols, verify START B, the text and the checksum
  const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112']
  const decode = (svg) => {
    const bars = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
    const mods = []
    for (let i = 0; i < bars.length; i++) { mods.push(bars[i][1]); if (i + 1 < bars.length) mods.push(bars[i + 1][0] - bars[i][0] - bars[i][1]) }
    const syms = []
    for (let i = 0; i + 5 < mods.length; i += 6) syms.push(C128.indexOf(mods.slice(i, i + 6).join('')))
    return syms
  }
  const syms = decode(svgs[0][2]), text = svgs[0][1]
  const expected = [104, ...[...text].map((ch) => ch.charCodeAt(0) - 32)]
  const sum = expected.slice(1).reduce((a, v, i) => a + (i + 1) * v, 104) % 103
  check(JSON.stringify(syms.slice(0, expected.length + 1)) === JSON.stringify([...expected, sum]), 'D3 the bars decode to START B, the SKU and a correct checksum', `${text}: ${syms.slice(0, 4).join(',')}…`)
  check(html.includes('>' + text + '<') && /KWD/.test(html), 'D4 the label carries the code in letters and the price')
  await openInventory(p)
  await p.click('[data-spsc-open]'); await p.waitForSelector('[data-sporta-scan]')
  await p.fill('[data-sporta-scan] input', 'NOPE-XX'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
  check(/No size has the code NOPE-XX/.test(await p.textContent('[data-sporta-scan] .spsc-note')), 'D5 an unknown code is named, the sheet stays')
  await p.fill('[data-sporta-scan] input', s1); await p.keyboard.press('Enter'); await p.waitForTimeout(500)
  const sel = await p.evaluate((sku) => ({ gone: !document.querySelector('[data-sporta-scan]'), slug: document.querySelector('[data-sporta-inventory] select[aria-label="Product to edit"]')?.value, focused: document.activeElement?.getAttribute('data-sku') }), s1)
  check(sel.gone && sel.slug === SLUG && sel.focused === s1, 'D6 a known code closes the sheet, selects the product and focuses that size', JSON.stringify(sel))
  check(errs.length === 0, 'no script errors on the panel', errs.join(' | ').slice(0, 120))
  await p.close()
} finally {
  writeFileSync(ADMIN_PHP, original)
  for (const [sku, n] of Object.entries(start)) sql(`update product_variants set stock = ${n} where sku = '${sku}'`)
  sql(`delete from stock_log where id > ${logStart}`)
  sql(invStart ? `insert into settings (name, value) values ('inventory', ${invStart}) on duplicate key update value = values(value)` : "delete from settings where name = 'inventory'")
  sql("delete from purchase_order_items where po_id in (select id from purchase_orders where note like 'rig:%')"); sql("delete from purchase_orders where note like 'rig:%'"); sql("delete from suppliers where name like 'Rig Supplier%'")
  sql("delete from order_items where order_id in (select id from orders where track_id like 'SPINVPLUS%')"); sql("delete from orders where track_id like 'SPINVPLUS%'")
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — alerts, faster editing, purchasing and labels')
process.exit(fails ? 1 : 0)
