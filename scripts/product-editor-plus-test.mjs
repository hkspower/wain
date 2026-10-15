/**
 * test:product-editor-plus — the Edit product window (2026-10-15, assets/product-editor-plus.js).
 *
 *   A  descriptions and the sale are shown, filled from the product, and saved by the form's own
 *      Save (one request); the last sale day ends at 23:59:59; a sale at or above the price is
 *      refused in the window and never reaches the server
 *   B  "On sale" reads "Shown in the shop" in the window and "Shown"/"Hidden" in the table
 *   C  Category is a fixed list and a choice reaches the save; the server stores it lower-case
 *   D  the photo-path boxes are hidden behind one button that shows them
 *   E  on a phone, Save product is on screen without scrolling the window
 *
 * Run `bash scripts/sandbox.sh` first. The product row is put back exactly as it was.
 * MUTATE=nomerge disables the save merge: A fails.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SLUG = 'cloudsoft-jacket-cherry-red'
const ROOT = new URL('..', import.meta.url).pathname
const FILE = ROOT + 'sporta-site/public_html/assets/product-editor-plus.js'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const COLS = 'sale_price, sale_starts_at, sale_ends_at, featured, featured_sort, desc_en, desc_ar, category, brand_slug, image, images, price, active'
const snap = () => sql(`select json_object(${COLS.split(', ').map((c) => `'${c}', ${c}`).join(', ')}) from products where slug='${SLUG}'`)
const backup = snap()
const orig = readFileSync(FILE, 'utf8')
if (process.env.MUTATE === 'nomerge') writeFileSync(FILE, orig.replace("url.indexOf('r=product_save') < 0", 'true'))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
async function openEditor(dev) {
  const ctx = await browser.newContext(dev)
  await ctx.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: 'manager@sporta.com.kw', password: 'correct horse' } })
  const p = await ctx.newPage()
  const saves = []
  p.on('request', (r) => { if (r.url().includes('product_save')) saves.push(r.postData()) })
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('aside button, nav button').filter({ hasText: 'Catalogue' }).first().evaluate((x) => x.click())
  await p.waitForTimeout(1500)
  await p.locator('tr').filter({ hasText: SLUG }).filter({ has: p.locator('button', { hasText: 'Edit' }) }).first()
    .locator('button', { hasText: /^Edit$/ }).evaluate((x) => x.click())
  await p.waitForSelector('[data-spep] [data-spep-f="desc_en"]:not([disabled])', { timeout: 10000 })
  return { ctx, p, saves }
}
const save = (p) => p.locator('[data-spep] button', { hasText: /^Save product$/ }).evaluate((x) => x.click())

try {
  sql('delete from rate_limit; delete from rate_bucket')
  sql(`update products set price=8.000, sale_price=6.400, sale_starts_at='2026-11-01 00:00:00', sale_ends_at='2026-12-31 23:59:59', desc_en='Old words', desc_ar='كلام قديم', category='outerwear', active=1 where slug='${SLUG}'`)
  const { ctx, p, saves } = await openEditor({ viewport: { width: 1280, height: 900 } })
  const shown = await p.evaluate(() => {
    const v = (f) => document.querySelector(`[data-spep-f="${f}"]`).value
    return [v('desc_en'), v('desc_ar'), v('sale_price'), v('sale_starts_at'), v('sale_ends_at')].join('|')
  })
  check(shown === 'Old words|كلام قديم|6.400|2026-11-01|2026-12-31', 'A the description and sale are filled from the product', shown)

  // A — a sale at or above the price never leaves the window
  await p.fill('[data-spep-f="sale_price"]', '9')
  await save(p)
  await p.waitForTimeout(800)
  const note = (await p.locator('[data-spep-note]').count()) ? await p.locator('[data-spep-note]').textContent() : '(window closed)'
  check(saves.length === 0 && /below the price/.test(note), 'A a sale above the price is refused in the window, with no request', `${saves.length} sent, "${note}"`)

  // A — a good save, through the form's own button
  await p.fill('[data-spep-f="desc_en"]', 'New words')
  await p.fill('[data-spep-f="desc_ar"]', 'كلام جديد')
  await p.fill('[data-spep-f="sale_price"]', '5.5')
  await p.fill('[data-spep-f="sale_starts_at"]', '2026-11-05')
  await p.fill('[data-spep-f="sale_ends_at"]', '2026-11-30')
  // C — category from the list
  check(await p.locator('[data-spep-cat]').isVisible() && !(await p.locator('[data-spep] label:has(> span:text-is("Category")) input').isVisible()),
    'C Category is a list and the free-text box is hidden')
  await p.selectOption('[data-spep-cat]', 'women')
  await save(p)
  await p.waitForTimeout(1500)
  const row = sql(`select concat_ws('|', desc_en, desc_ar, sale_price, sale_starts_at, sale_ends_at, category) from products where slug='${SLUG}'`)
  check(saves.length === 1, 'A one request per Save', String(saves.length))
  check(row === 'New words|كلام جديد|5.500|2026-11-05 00:00:00|2026-11-30 23:59:59|women',
    'A + C description, sale (last day to 23:59:59) and category are saved', row)
  await ctx.close()

  // C — the server stores one spelling
  {
    const c2 = await browser.newContext()
    await c2.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: 'manager@sporta.com.kw', password: 'correct horse' } })
    const id = sql(`select id from products where slug='${SLUG}'`)
    await c2.request.post(`${BASE}/api/admin.php?r=product_save`, { headers: { 'X-Sporta-Admin': '1' }, data: { id: +id, slug: SLUG, name_en: 'Cloudsoft Jacket — Cherry Red', name_ar: 'جاكيت كلاودسوفت — أحمر كرزي', price: 8, category: ' Women ' } })
    check(sql(`select category from products where slug='${SLUG}'`) === 'women', 'C " Women " is stored as "women", so the no-exchange rule still applies')
    await c2.close()
  }

  // B, D, E on a phone
  {
    const { ctx: c3, p: q } = await openEditor({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const lab = await q.evaluate(() => [...document.querySelectorAll('[data-spep] label')].some((l) => l.querySelector('input[type=checkbox]') && /Shown in the shop/.test(l.textContent)))
    check(lab, 'B the tick reads "Shown in the shop" in the window')
    const adv = q.locator('[data-spep-adv]')
    const hid = await q.evaluate(() => [...document.querySelectorAll('[data-spep] label')].filter((l) => /^(Image URL|More photos)/.test(l.textContent.trim())).every((l) => l.offsetParent === null))
    await adv.evaluate((b) => b.click())
    const vis = await q.evaluate(() => [...document.querySelectorAll('[data-spep] label')].filter((l) => /^(Image URL|More photos)/.test(l.textContent.trim())).every((l) => l.offsetParent !== null))
    check(hid && vis, 'D the photo-path boxes are hidden until "Photo paths (advanced)" is pressed', `${hid}/${vis}`)
    const box = await q.locator('[data-spep] button', { hasText: /^Save product$/ }).boundingBox()
    check(box && box.y + box.height <= 844 && box.y > 0, 'E on a phone Save product is on screen without scrolling the window', JSON.stringify(box))
    const wide = await q.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    check(!wide, 'E nothing scrolls sideways on a phone')
    await q.locator('[data-spep] button[aria-label="Close"]').evaluate((b) => b.click())
    await q.waitForTimeout(500)
    const cells = await q.evaluate(() => { const th = [...document.querySelectorAll('.admin-content th')].map((t) => t.textContent.trim()); const tb = [...document.querySelectorAll('.admin-content table')].find((x) => /In the shop|On sale/.test(x.querySelector('thead')?.textContent || '')); const t = tb ? tb.querySelector('tbody').textContent : ''; return { th: th.includes('In the shop'), shown: /Shown/.test(t), onsale: /On sale|Off sale/.test(t) } })
    check(cells.th && cells.shown && !cells.onsale, 'B the catalogue table says "In the shop" / "Shown", not "On sale"', JSON.stringify(cells))
    await c3.close()
  }
} finally {
  await browser.close()
  if (process.env.MUTATE) writeFileSync(FILE, orig)
  const o = JSON.parse(backup)
  const v = (x) => (x === null ? 'null' : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
  sql(`update products set ${COLS.split(', ').map((c) => `${c}=${v(o[c])}`).join(', ')} where slug='${SLUG}'`)
  check(snap() === backup, 'the product row is back exactly as it was')
  check(readFileSync(FILE, 'utf8') === orig, 'product-editor-plus.js is back exactly as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall product-editor checks passed')
  process.exitCode = fails ? 1 : 0
}
