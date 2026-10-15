/**
 * test:product-save-keep — a product_save that leaves a field OUT keeps it (2026-10-15).
 *
 * The website panel's Edit product form has no sale or Best-sellers fields, so every Save
 * cleared the sale price, its dates, `featured` and `featured_order`. The server now treats an
 * absent key as "unchanged"; a key that is sent, even empty, still sets or clears it.
 *
 *   A  the API: absent keys kept; sent-empty sale and featured:0 cleared; a kept sale that is
 *      no longer below a lowered list price ends rather than overcharging
 *   B  the real panel form: open Edit product, press Save, the sale and Best-sellers place survive
 *
 * Run `bash scripts/sandbox.sh` first. The product row is put back exactly as it was.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SLUG = 'cloudsoft-jacket-cherry-red'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const row = () => sql(`select concat_ws('|', ifnull(sale_price,'N'), ifnull(sale_ends_at,'N'), featured, featured_sort, ifnull(desc_en,'N'), ifnull(category,'N'), ifnull(brand_slug,'N'), price) from products where slug='${SLUG}'`)
const COLS = 'sale_price, sale_starts_at, sale_ends_at, featured, featured_sort, desc_en, desc_ar, category, brand_slug, image, images, price, active'
const backup = sql(`select json_object(${COLS.split(', ').map((c) => `'${c}', ${c}`).join(', ')}) from products where slug='${SLUG}'`)
const id = sql(`select id from products where slug='${SLUG}'`)
const plant = () => sql(`update products set price=8.000, sale_price=6.400, sale_starts_at=null, sale_ends_at='2026-12-31 23:59:59', featured=1, featured_sort=3, desc_en='Keep me', brand_slug='gymshark' where slug='${SLUG}'`)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
try {
  sql('delete from rate_limit; delete from rate_bucket')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const H = { headers: { 'X-Sporta-Admin': '1' } }
  check((await ctx.request.post(`${BASE}/api/admin.php?r=login`, { ...H, data: { email: 'manager@sporta.com.kw', password: 'correct horse' } })).status() === 200, 'signed in')
  const save = async (extra) => (await ctx.request.post(`${BASE}/api/admin.php?r=product_save`, { ...H, data: {
    id: +id, slug: SLUG, name_en: 'Cloudsoft Jacket — Cherry Red', name_ar: 'جاكيت كلاودسوفت — أحمر كرزي', price: 8, active: 1, ...extra } })).status()

  // A — the API
  plant()
  check((await save({})) === 200, 'A a save with only the form\'s own fields succeeds')
  check(row() === '6.400|2026-12-31 23:59:59|1|3|Keep me|outerwear|gymshark|8.000', 'A sale, end date, Best-sellers place, description and brand are kept', row())
  check((await save({ sale_price: '', featured: 0, featured_sort: 0 })) === 200 && row().startsWith('N|N|0|0|'), 'A sending them empty still clears them', row())
  plant()
  check((await save({ price: 6 })) === 200 && row().startsWith('N|N|1|3|'), 'A lowering the price below a kept sale ends the sale instead of overcharging', row())

  // B — the real panel form
  plant()
  const p = await ctx.newPage()
  let sent = null
  p.on('request', (r) => { if (r.url().includes('product_save')) sent = r.postData() })
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('aside button').filter({ hasText: 'Catalogue' }).first().evaluate((x) => x.click())
  await p.waitForTimeout(1500)
  await p.locator('tr').filter({ hasText: SLUG }).filter({ has: p.locator('button', { hasText: 'Edit' }) }).first()
    .locator('button', { hasText: /^Edit$/ }).evaluate((x) => x.click())
  await p.waitForTimeout(1000)
  await p.locator('button', { hasText: /^Save product$/ }).evaluate((x) => x.click())
  await p.waitForTimeout(1500)
  check(!!sent && !/featured/.test(sent), 'B the panel form posts no Best-sellers keys (the case this guards)', (sent || '').slice(0, 80))
  check(row().startsWith('6.400|2026-12-31 23:59:59|1|3|'), 'B saving from Edit product keeps the sale and the Best-sellers place', row())
} finally {
  await browser.close()
  const o = JSON.parse(backup)
  const v = (x) => (x === null ? 'null' : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
  sql(`update products set ${COLS.split(', ').map((c) => `${c}=${v(o[c])}`).join(', ')} where slug='${SLUG}'`)
  const back = sql(`select json_object(${COLS.split(', ').map((c) => `'${c}', ${c}`).join(', ')}) from products where slug='${SLUG}'`)
  check(back === backup, 'the product row is back exactly as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall product-save checks passed')
  process.exitCode = fails ? 1 : 0
}
