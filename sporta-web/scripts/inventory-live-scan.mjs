#!/usr/bin/env node
// INVENTORY LIVE SCAN - the shop's inventory tables, read-only, aggregates only.
//
//   node scripts/inventory-live-scan.mjs --config /run/sporta-api-config.php        (the one-shot VPS job)
//   node scripts/inventory-live-scan.mjs --db-name sporta --db-user x --db-pass y --db-host 127.0.0.1   (a private test database)
//
// WHAT IT READS: product_variants and inventory_movements (and, to join them, products and order_items). WHAT IT PRINTS: counts, sums, size and cost
// summaries, and the SKU / slug of a row only where a row IS the finding (a SKU names a size of a product, it is not personal). No customer, address,
// phone or e-mail is selected; admin actors are counted, never named.
//
// READ-ONLY BY CONSTRUCTION: the session is READ ONLY at the server and every statement passes the same gate as db-schema-live-diff.mjs (SELECT / SHOW only;
// a SELECT ... FOR UPDATE or INTO OUTFILE is refused before it reaches the socket). Exit 0 = scanned, 2 = could not.
import { MySQL, Gate, credentials, scrub } from './db-schema-live-diff.mjs'
import { pathToFileURL } from 'node:url'

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined }
const L = []
const out = (s = '') => { L.push(s); console.log(s) }
const head = (t) => out(`\n== ${t}`)

export const QUERIES = [
  ['SIZE OF THE TABLES', `select table_name, engine, table_rows, round(data_length/1024) as data_kb, round(index_length/1024) as index_kb, auto_increment from information_schema.tables where table_schema = database() and table_name in ('product_variants','inventory_movements') order by table_name`],
  ['VARIANTS', `select count(*) as variants, count(distinct slug) as products_with_sizes, coalesce(sum(stock),0) as units_in_stock, sum(stock = 0) as sold_out_sizes, sum(stock between 1 and low_stock_threshold) as low_sizes, sum(stock < 0) as negative, sum(stock > 999999) as over_cap from product_variants`],
  ['SIZES IN USE', `select size, count(*) as variants, coalesce(sum(stock),0) as units from product_variants group by size order by variants desc, size`],
  ['SIZE LABELS THAT LOOK WRONG (leading or trailing blank, lower case, or longer than the column was meant for)', `select sku, concat('[', size, ']') as size_label from product_variants where size <> trim(size) or size <> upper(size) or char_length(size) > 4 order by sku limit 30`],
  ['DUPLICATE (product, size) PAIRS: two SKUs for the same size of one product', `select slug, size, count(*) as skus, group_concat(sku order by sku separator ',') as sku_list from product_variants group by slug, size having count(*) > 1 order by slug, size limit 30`],
  ['VARIANTS WHOSE PRODUCT IS GONE (no products row has that slug)', `select v.sku, v.slug, v.size, v.stock from product_variants v where not exists (select 1 from products p where p.slug = v.slug) order by v.slug, v.size limit 40`],
  ['PRODUCTS WITH NO SIZE ROWS (active ones cannot be bought)', `select p.slug, p.active from products p where not exists (select 1 from product_variants v where v.slug = p.slug) order by p.active desc, p.slug limit 60`],
  ['STOCK SHAPE PER PRODUCT: a product whose every size holds exactly the same number (a placeholder count?)', `select v.slug, count(*) as sizes, min(v.stock) as stock_each from product_variants v group by v.slug having count(*) >= 3 and min(v.stock) = max(v.stock) and min(v.stock) > 0 order by sizes desc, v.slug limit 60`],
  ['COST: rows with no KWD cost, a zero cost, or a cost above the selling price', `select sum(unit_cost_kwd is null) as no_cost, sum(unit_cost_kwd = 0) as zero_cost, sum(unit_cost_kwd is not null and unit_cost_kwd > coalesce((select p.price from products p where p.slug = v.slug), 0)) as cost_above_price, sum(cost_aed is not null and unit_cost_kwd is not null and abs(unit_cost_kwd - round(cost_aed / 11.95, 3)) > 0.002) as kwd_differs_from_aed_conversion from product_variants v`],
  ['LOW-STOCK THRESHOLDS', `select low_stock_threshold, count(*) as variants from product_variants group by low_stock_threshold order by low_stock_threshold`],
  ['MOVEMENTS', `select count(*) as movements, min(created_at) as first_at, max(created_at) as last_at, count(distinct sku) as skus_touched, count(distinct actor_admin_id) as distinct_admin_ids, sum(actor_admin_id is null) as no_admin_id, sum(note = '') as empty_note from inventory_movements`],
  ['MOVEMENTS BY TYPE', `select type, count(*) as movements, coalesce(sum(delta),0) as net_delta, min(created_at) as first_at, max(created_at) as last_at from inventory_movements group by type order by movements desc`],
  ['MOVEMENTS PER MONTH (the ledger of what the admin did)', `select date_format(created_at, '%Y-%m') as month, count(*) as movements, sum(delta > 0) as additions, sum(delta < 0) as removals from inventory_movements group by month order by month desc limit 14`],
  ['LEDGER vs STOCK: a size whose current stock is not the last movement\'s "after" (it moved since, by an order or a release, which the ledger does not record)', `select count(*) as sizes_with_movements, sum(v.stock <> m.after_stock) as stock_differs_from_last_after, sum(v.stock = m.after_stock) as stock_equals_last_after from product_variants v join inventory_movements m on m.id = (select max(x.id) from inventory_movements x where x.sku = v.sku)`],
  ['LEDGER CHAIN: a movement whose "before" is not the previous movement\'s "after" for that SKU (stock moved in between)', `select count(*) as links, sum(b.before_stock <> a.after_stock) as broken from inventory_movements a join inventory_movements b on b.sku = a.sku and b.id = (select min(c.id) from inventory_movements c where c.sku = a.sku and c.id > a.id)`],
  ['INVENTORY VERSION: variants whose counter differs from the number of ledger rows', `select count(*) as variants, sum(v.inventory_version = 0) as version_zero, sum(v.inventory_version <> (select count(*) from inventory_movements m where m.sku = v.sku)) as version_differs_from_ledger_rows from product_variants v`],
  ['ORDER LINES vs SIZES: an order line (product, size) with no size row today', `select count(*) as order_lines, sum(v.sku is null) as lines_with_no_size_row from order_items i join products p on p.id = i.product_id left join product_variants v on v.slug = p.slug and v.size = i.size`],
  ['ORDER LINES: units sold per month (the stock the ledger does not show)', `select date_format(o.created_at, '%Y-%m') as month, count(*) as order_lines, sum(i.qty) as units from order_items i join orders o on o.id = i.order_id where o.payment_status not in ('failed','voided') and o.fulfilment_status <> 'cancelled' group by month order by month desc limit 14`],
]

export async function scan({ gate }) {
  const results = []
  for (const [title, sql] of QUERIES) {
    head(title)
    let r
    try { r = await gate.query(sql) } catch (e) { out('  (could not run: ' + String(e.message).slice(0, 160) + ')'); results.push({ title, error: e.message }); continue }
    if (!r.rows.length) { out('  (no rows)'); results.push({ title, rows: [] }); continue }
    out('  ' + r.columns.join(' | '))
    for (const row of r.rows) out('  ' + row.map((c) => (c === null ? 'NULL' : c)).join(' | '))
    results.push({ title, columns: r.columns, rows: r.rows })
  }
  return results
}

async function main() {
  const args = { config: arg('config') }
  let cred
  try { cred = credentials(args) } catch (e) { console.error('inventory-live-scan: ' + e.message); return 2 }
  if (arg('db-name')) { cred.database = arg('db-name'); cred.user = arg('db-user') ?? cred.user; cred.password = arg('db-pass') ?? cred.password; cred.host = arg('db-host') ?? cred.host; if (arg('db-port')) cred.port = Number(arg('db-port')) }
  const secrets = [cred.password, cred.user]
  const conn = new MySQL(cred)
  try { await conn.connect() } catch (e) { console.error('inventory-live-scan: cannot connect: ' + scrub(e.message, secrets)); return 2 }
  const gate = new Gate(conn)
  try { await gate.readOnly() } catch (e) { console.error('inventory-live-scan: ' + scrub(e.message, secrets)); await gate.end(); return 2 }
  out(`INVENTORY LIVE SCAN (read-only, ${QUERIES.length} SELECTs, database ${cred.database})`)
  await scan({ gate })
  await gate.end()
  out('\nINVENTORY_SCAN_DONE')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c), (e) => { console.error('inventory-live-scan: ' + e.message); process.exit(2) })
