#!/usr/bin/env node
// PRICE LIVE SCAN - the shop's product prices, read-only, aggregates first and the slug of a row only where the row IS the finding.
//
//   node scripts/price-live-scan.mjs --config /run/sporta-api-config.php          (the one-shot VPS job)
//   node scripts/price-live-scan.mjs --db-name sporta --db-user x --db-pass y --db-host 127.0.0.1   (a private test database)
//
// WHAT IT READS: products (price, sale_price, sale_starts_at, active, slug, category) and product_variants (size, stock, unit_cost_kwd), joined on
// slug. WHAT IT PRINTS: counts, a price spread, and the rows that look wrong (a price of zero, a sale that is not below the price, a sale that starts
// in the future, a size sold below its cost). No customer, address, phone or e-mail is selected.
//
// READ-ONLY BY CONSTRUCTION: the same gate as inventory-live-scan.mjs (SELECT / SHOW only, a READ ONLY session). Exit 0 = scanned, 2 = could not.
import { MySQL, Gate, credentials, scrub } from './db-schema-live-diff.mjs'
import { pathToFileURL } from 'node:url'

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined }
const L = []
const out = (s = '') => { L.push(s); console.log(s) }
const head = (t) => out(`\n== ${t}`)

export const QUERIES = [
  ['PRODUCTS', `select count(*) as products, sum(active = 1) as active, sum(active = 1 and price <= 0) as active_price_zero, sum(active = 1 and sale_price is not null) as active_on_sale_price, sum(active = 1 and sale_price is not null and sale_price >= price) as sale_not_below_price, sum(active = 1 and sale_price is not null and sale_price <= 0) as sale_zero, sum(active = 1 and sale_starts_at > utc_timestamp()) as sale_scheduled_later, sum(active = 1 and price > 0 and price < 1) as active_price_under_1kwd, sum(active = 1 and price > 100) as active_price_over_100kwd from products`],
  ['PRICE SPREAD OF ACTIVE PRODUCTS (KWD)', `select count(*) as products, min(price) as min_price, round(avg(price), 3) as avg_price, max(price) as max_price, min(case when sale_price > 0 then sale_price end) as min_sale, max(sale_price) as max_sale from products where active = 1 and price > 0`],
  ['PRICE BANDS OF ACTIVE PRODUCTS', `select case when price < 5 then '0-4.999' when price < 10 then '5-9.999' when price < 20 then '10-19.999' when price < 40 then '20-39.999' when price < 100 then '40-99.999' else '100+' end as band, count(*) as products from products where active = 1 group by band order by min(price)`],
  ['ACTIVE PRODUCTS WITH A PRICE OF ZERO OR LESS (slug, price)', `select slug, price from products where active = 1 and price <= 0 order by slug limit 50`],
  ['ACTIVE PRODUCTS WHOSE SALE IS NOT BELOW THE PRICE (slug, price, sale)', `select slug, price, sale_price, sale_starts_at from products where active = 1 and sale_price is not null and sale_price >= price order by slug limit 50`],
  ['ACTIVE PRODUCTS WITH A SALE STARTING LATER (slug, price, sale, starts)', `select slug, price, sale_price, sale_starts_at from products where active = 1 and sale_starts_at > utc_timestamp() order by sale_starts_at limit 50`],
  ['ACTIVE PRODUCTS PRICED UNDER 1 KWD (slug, price)', `select slug, price from products where active = 1 and price > 0 and price < 1 order by price limit 50`],
  ['SIZES SOLD BELOW THEIR COST (slug, size, cost, price)', `select v.slug, v.size, v.unit_cost_kwd, p.price from product_variants v join products p on p.slug = v.slug where p.active = 1 and v.unit_cost_kwd is not null and v.unit_cost_kwd > p.price order by v.slug, v.size limit 50`],
  ['SIZES WITH NO COST (count, of the sizes of active products)', `select count(*) as sizes, sum(v.unit_cost_kwd is null) as without_cost from product_variants v join products p on p.slug = v.slug where p.active = 1`],
  ['MARGIN OF SIZES THAT HAVE A COST (count, median-ish average)', `select count(*) as sizes, round(avg(p.price / nullif(v.unit_cost_kwd, 0)), 2) as avg_price_over_cost from product_variants v join products p on p.slug = v.slug where p.active = 1 and v.unit_cost_kwd > 0 and p.price > 0`],
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
  try { cred = credentials(args) } catch (e) { console.error('price-live-scan: ' + e.message); return 2 }
  if (arg('db-name')) { cred.database = arg('db-name'); cred.user = arg('db-user') ?? cred.user; cred.password = arg('db-pass') ?? cred.password; cred.host = arg('db-host') ?? cred.host; if (arg('db-port')) cred.port = Number(arg('db-port')) }
  const secrets = [cred.password, cred.user]
  const conn = new MySQL(cred)
  try { await conn.connect() } catch (e) { console.error('price-live-scan: cannot connect: ' + scrub(e.message, secrets)); return 2 }
  const gate = new Gate(conn)
  try { await gate.readOnly() } catch (e) { console.error('price-live-scan: ' + scrub(e.message, secrets)); await gate.end(); return 2 }
  out(`PRICE LIVE SCAN (read-only, ${QUERIES.length} SELECTs, database ${cred.database})`)
  await scan({ gate })
  await gate.end()
  out('\nPRICE_SCAN_DONE')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c), (e) => { console.error('price-live-scan: ' + e.message); process.exit(2) })
