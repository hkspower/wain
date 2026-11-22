// PRODUCT DELETE (owner request 2026-11-22: "add remove product backends"): admin.php's product_delete, against a private MariaDB and
// PHP built from this tree (scripts/lib/race-rig.mjs). It never touches the shared sandbox database.
//
//   npm run test:product-delete   (skips with exit 0 when mariadbd, mariadb or php is missing; exits 1 when an installed rig did not
//                                  come up, because a rig that did not start has tested nothing)
//
// What is asserted:
//   removed  - a product never ordered, with no stock and no stock history goes, its sizes with it, and the activity log says so
//   refused  - stock on the shelf: 409 product_has_stock; stock history (an inventory movement): 409 product_has_stock_history; an
//              order line: 409 product_in_orders. Each refusal changes NOTHING: the product, its sizes, the stock, the movement, the order
//   answers  - a non-numeric or zero id: 400 invalid_product_id; no such product: 404 product_not_found
//   access   - a request without an admin session is refused; a session without the X-Sporta-Admin header is refused; nothing changes
//   shop     - a removed product leaves the public product list
//   grants   - ops/db/grants.sql is current and lets the admin account DELETE from products and product_variants
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRig } from './lib/race-rig.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const rig = await startRig({ workers: 4 })
if (rig.skip) {
  console.log(`${rig.broken ? 'NOT RUN' : 'SKIP'} product-delete: ${rig.skip}. Nothing was tested.`)
  process.exit(rig.broken ? 1 : 0)
}

const counts = async (slug) => ({
  products: await rig.num(`select count(*) from products where slug = '${slug}'`),
  sizes: await rig.num(`select count(*) from product_variants where slug = '${slug}'`),
})
const product = async (slug, { stock = 0, image = null } = {}) => {
  const img = image ? `'${image}'` : 'null'
  await rig.sql(`insert into products (slug, name_en, name_ar, price, active, image) values ('${slug}', 'Name ${slug}', 'اسم ${slug}', 7.500, 1, ${img});
    insert into product_variants (sku, slug, size, stock) values ('${slug.toUpperCase()}-M', '${slug}', 'M', ${stock}), ('${slug.toUpperCase()}-L', '${slug}', 'L', 0);`)
  return rig.num(`select id from products where slug = '${slug}'`)
}
const del = (body, cookie) => rig.admin('product_delete', { method: 'POST', body, cookie })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

try {
  await rig.adminSignIn()
  const [cookie] = await rig.adminSessions(1)

  head('removed: never ordered, no stock, no stock history')
  const clean = await product('rm-clean')
  const r1 = await del({ id: clean })
  is(r1.status === 200 && r1.body?.deleted === true && r1.body?.sizes_removed === 2,
    'a product never ordered, with no stock, is removed; its two sizes go with it', `${r1.status} ${r1.text?.slice(0, 160)}`)
  is(same(await counts('rm-clean'), { products: 0, sizes: 0 }), 'the product and its sizes are gone from the database', JSON.stringify(await counts('rm-clean')))
  is((await rig.num("select count(*) from admin_activity_log where action_key = 'product_delete'")) >= 1, 'the activity log records product_delete')

  head('refused: stock, stock history and orders change nothing')
  const stock = await product('rm-stock', { stock: 3 })
  const r2 = await del({ id: stock })
  is(r2.status === 409 && r2.body?.error === 'product_has_stock', 'stock on the shelf: 409 product_has_stock', `${r2.status} ${r2.body?.error}`)
  is(same(await counts('rm-stock'), { products: 1, sizes: 2 }), 'the product and both sizes are kept')
  is((await rig.num(`select stock from product_variants where slug = 'rm-stock' and size = 'M'`)) === 3, 'the stock is still 3')

  const hist = await product('rm-history')
  await rig.sql(`insert into inventory_movements (sku, type, before_stock, after_stock, delta, before_low_stock_threshold, after_low_stock_threshold, inventory_version, note, actor_email)
    values ('RM-HISTORY-M', 'count', 0, 0, 0, 2, 2, 1, 'test', 'owner@sporta.test')`)
  const r3 = await del({ id: hist })
  is(r3.status === 409 && r3.body?.error === 'product_has_stock_history', 'stock history: 409 product_has_stock_history', `${r3.status} ${r3.body?.error}`)
  is(same(await counts('rm-history'), { products: 1, sizes: 2 }), 'the product and its sizes are kept')
  is((await rig.num(`select count(*) from inventory_movements where sku = 'RM-HISTORY-M'`)) === 1, 'the movement history is kept')

  const ordered = await product('rm-ordered')
  await rig.sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status) values ('RMORDER0001', 7.500, 'paid', 'cod', 'unfulfilled');
    insert into order_items (order_id, product_id, qty, unit_price, size) values ((select id from orders where track_id = 'RMORDER0001'), ${ordered}, 1, 7.500, 'M')`)
  const r4 = await del({ id: ordered })
  is(r4.status === 409 && r4.body?.error === 'product_in_orders', 'an order line: 409 product_in_orders', `${r4.status} ${r4.body?.error}`)
  is(same(await counts('rm-ordered'), { products: 1, sizes: 2 }), 'the product and its sizes are kept')
  is((await rig.num(`select count(*) from order_items where product_id = ${ordered}`)) === 1, 'the order line is kept')

  head('answers: the id')
  const r5 = await del({ id: 'abc' })
  is(r5.status === 400 && r5.body?.error === 'invalid_product_id', 'a non-numeric id is refused (400 invalid_product_id)', `${r5.status} ${r5.body?.error}`)
  const r6 = await del({ id: 0 })
  is(r6.status === 400 && r6.body?.error === 'invalid_product_id', 'id 0 is refused (400 invalid_product_id)', `${r6.status} ${r6.body?.error}`)
  const r7 = await del({ id: 987654 })
  is(r7.status === 404 && r7.body?.error === 'product_not_found', 'no such product: 404 product_not_found', `${r7.status} ${r7.body?.error}`)

  head('access: without the session or the header nothing changes')
  const bare = await fetch(`${rig.SITE}/api/admin.php?r=product_delete`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'X-Forwarded-For': rig.freshIp() }, body: JSON.stringify({ id: stock }) })
  is(bare.status === 401 || bare.status === 403, 'without an admin session the request is refused', String(bare.status))
  const noHeader = await fetch(`${rig.SITE}/api/admin.php?r=product_delete`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': rig.freshIp() }, body: JSON.stringify({ id: stock }) })
  is(noHeader.status === 400, 'a session without the X-Sporta-Admin header is refused', String(noHeader.status))
  is(same(await counts('rm-stock'), { products: 1, sizes: 2 }), 'and the refused requests changed nothing')

  head('the shop')
  const shop = await product('rm-shop', { image: '/images/products/rm-shop.jpg' })
  const listed = async () => {
    const res = await fetch(`${rig.SITE}/api/api.php?r=products`)
    const j = await res.json().catch(() => null)
    const rows = Array.isArray(j) ? j : (j?.products || [])
    return rows.some((p) => p.slug === 'rm-shop')
  }
  is(await listed(), 'before removal the product is in the public list')
  const r8 = await del({ id: shop })
  is(r8.status === 200, 'and it is removed', `${r8.status}`)
  is(!(await listed()), 'after removal it is no longer in the public list')

  head('grants')
  let grantsOk = true, grantsDetail = ''
  try { execFileSync('node', [join(ROOT, 'ops/db/make-grants.mjs'), '--check'], { stdio: 'pipe' }) } catch (e) { grantsOk = false; grantsDetail = String(e.stderr || e.message).slice(0, 160) }
  is(grantsOk, 'ops/db/grants.sql is what the code asks for (make-grants --check)', grantsDetail)
  const grants = readFileSync(join(ROOT, 'ops/db/grants.sql'), 'utf8')
  is(/GRANT SELECT, INSERT, DELETE ON `@@DB@@`\.`products` TO 'sporta_admin'/.test(grants), 'the admin account may DELETE from products')
  is(/GRANT SELECT, INSERT, DELETE ON `@@DB@@`\.`product_variants` TO 'sporta_admin'/.test(grants), 'the admin account may DELETE from product_variants')
} finally {
  await rig.stop()
}
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
