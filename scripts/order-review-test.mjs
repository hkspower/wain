/**
 * test:order-review — the review sheet before every order (2026-10-15, assets/order-review.js).
 *   A  pressing Pay with a valid form opens the sheet, and NO order exists yet
 *   B  the sheet shows the items, the name/phone/address, the payment method and the server's total
 *   C  Edit closes it: no order is placed, no error line shows, the form is usable again, typing kept
 *   D  Confirm places exactly one order, with the same details
 *   E  a form with a mistake shows the form's own error and NO sheet; Arabic too; phone layout fits
 * Uses cash on delivery so nothing leaves for a bank. Run `bash scripts/sandbox.sh` first.
 * Orders it makes are removed. MUTATE=off loads the page without the script: A fails.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const SLUG = sql("select v.slug from product_variants v join products p on p.slug = v.slug where v.size = 'M' and v.stock > 2 and p.active = 1 order by v.slug limit 1")
const prod = JSON.parse(sql(`select json_object('name', name_en, 'price', coalesce(sale_price, price)) from products where slug = '${SLUG}'`))
const NAME = 'Review Rig ' + Date.now().toString(36)
const orders = () => +sql(`select count(*) from orders where customer_name = '${NAME}'`)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
async function open(lang, dev = { viewport: { width: 1280, height: 900 } }) {
  const ctx = await browser.newContext(dev)
  if (process.env.MUTATE === 'off') await ctx.route(/order-review\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
  await ctx.addInitScript(([l, s, n, pr]) => {
    localStorage.setItem('lang', l)
    localStorage.setItem('sporta_cart', JSON.stringify([{ key: s + '__M__normal', slug: s, size: 'M', fit: 'normal', qty: 2, name: n, price: pr, image: '' }]))
  }, [lang, SLUG, prod.name, +prod.price])
  const p = await ctx.newPage()
  await p.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  return { ctx, p }
}
async function fill(p, phone) {
  await p.fill('#f-name', NAME); await p.fill('#f-phone', phone); await p.fill('#f-email', 'review@example.com')
  await p.selectOption('#f-governorate', 'hawalli'); await p.fill('#f-area', 'Salmiya'); await p.fill('#f-block', '4')
  await p.fill('#f-street', 'Salem Al Mubarak'); await p.fill('#f-building', '12')
  await p.locator('main form label').filter({ hasText: /Cash on delivery|الدفع عند الاستلام/ }).first().click()
}
const payBtn = (p) => p.locator('main form button[type=submit]:visible').last()

try {
  sql('delete from rate_limit; delete from rate_bucket')
  const { ctx, p } = await open('en')
  await fill(p, '5' + String(Date.now()).slice(-7))
  await payBtn(p).click()
  const sheet = await p.waitForSelector('[data-order-review] [role=dialog]', { timeout: 8000 }).catch(() => null)
  check(await payBtn(p).evaluate((b) => !b.hasAttribute('aria-label') || b.getAttribute('aria-label') === b.textContent.trim()),
    'A with cash chosen, the pay button\'s spoken name is its visible text (not "Pay with KNET")')
  check(!!sheet && orders() === 0, 'A pressing Pay opens the review sheet, and no order exists yet', `sheet=${!!sheet} orders=${orders()}`)
  if (sheet) {
    const txt = await sheet.innerText()
    const quote = await (await fetch(`${BASE}/api/api.php?r=discount`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ items: [{ slug: SLUG, size: 'M', qty: 2 }], code: '' }) })).json()
    check(txt.includes(prod.name) && /Qty 2/.test(txt) && /\+965 \d{4} \d{4}/.test(txt), 'B the sheet lists the item with its quantity', prod.name)
    check(txt.includes(NAME) && /Salmiya/.test(txt) && /Block 4/.test(txt) && /Building 12/.test(txt) && /Hawalli/.test(txt), 'B it shows the name and the full address')
    check(/Cash on delivery/.test(txt) && /Confirm order/.test(txt), 'B it names the payment method, and says Confirm order for cash')
    check(txt.replace(/ /g, ' ').includes(quote.total.toFixed(3)), 'B the total is the server\'s quote', `quote=${quote.total}`)
    // C — Edit
    await p.locator('[data-order-review] .orv-edit').click()
    await p.waitForTimeout(800)
    const after = await p.evaluate(() => ({ open: !!document.querySelector('[data-order-review]'), alert: [...document.querySelectorAll('main form p[role=alert]')].some((a) => a.offsetParent !== null), busy: document.querySelector('main form')?.getAttribute('aria-busy'), name: document.getElementById('f-name')?.value }))
    check(!after.open && orders() === 0, 'C Edit closes the sheet and places nothing', JSON.stringify(after))
    check(!after.alert && after.busy !== 'true' && after.name === NAME, 'C no error line, the form is not stuck busy, and what was typed is kept', JSON.stringify(after))
    // D — confirm
    await payBtn(p).click()
    await p.waitForSelector('[data-order-review] [data-orv-confirm]', { timeout: 8000 })
    await p.locator('[data-order-review] [data-orv-confirm]').click()
    await p.waitForTimeout(2500)
    check(orders() === 1, 'D Confirm places exactly one order', `orders=${orders()}`)
    check(sql(`select concat_ws('|', customer_area, customer_block, customer_street, customer_building, payment_method) from orders where customer_name = '${NAME}'`) === 'Salmiya|4|Salem Al Mubarak|12|cod', 'D with the details shown on the sheet')
  }
  await ctx.close()

  // E — a mistake shows the form's error and no sheet
  {
    const { ctx: c2, p: q } = await open('en')
    await fill(q, '123')
    await payBtn(q).click()
    await q.waitForTimeout(1000)
    const st = await q.evaluate(() => ({ sheet: !!document.querySelector('[data-order-review]'), alert: [...document.querySelectorAll('main form p[role=alert]')].some((a) => a.offsetParent !== null) }))
    check(!st.sheet && st.alert, 'E a wrong phone number shows the form\'s own error, not the sheet', JSON.stringify(st))
    await c2.close()
  }
  // E — Arabic, on a phone
  {
    const { ctx: c3, p: r } = await open('ar', devices['iPhone 13'])
    await fill(r, '6' + String(Date.now()).slice(-7))
    await payBtn(r).click()
    const s3 = await r.waitForSelector('[data-order-review] [role=dialog]', { timeout: 8000 }).catch(() => null)
    const info = s3 ? await r.evaluate(() => { const d = document.querySelector('[data-order-review] [role=dialog]'); const b = d.querySelector('[data-orv-confirm]').getBoundingClientRect(); return { dir: d.getAttribute('dir'), title: d.querySelector('h2').textContent, wide: d.scrollWidth > d.clientWidth + 1, btnBottom: Math.round(b.bottom), vh: innerHeight } }) : null
    check(!!info && info.dir === 'rtl' && /راجع طلبك/.test(info.title), 'E Arabic: the sheet is right-to-left and in Arabic', JSON.stringify(info))
    check(!!info && !info.wide && info.btnBottom <= info.vh, 'E on a phone it fits, and the confirm button is on screen', JSON.stringify(info))
    if (s3) await r.locator('[data-order-review] .orv-edit').click()
    await c3.close()
  }
} finally {
  await browser.close()
  const ids = sql(`select ifnull(group_concat(id), '') from orders where customer_name like 'Review Rig %'`)
  if (ids) {
    for (const t of ['order_items', 'fulfilment_outbox', 'customer_mail_outbox', 'whatsapp_outbox', 'push_outbox', 'order_location']) sql(`delete from ${t} where order_id in (${ids})`)
    try { sql(`delete l from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_ref in (${ids.split(',').map((x) => `'order:${x}'`).join(',')})`); sql(`delete from journal_entries where source_ref in (${ids.split(',').map((x) => `'order:${x}'`).join(',')})`) } catch {}
    sql(`update product_variants set stock = stock + 2 where slug = '${SLUG}' and size = 'M'`)
    sql(`delete from stock_log where slug = '${SLUG}' and reason = 'order' order by id desc limit 1`)
    sql(`delete from orders where id in (${ids})`)
  }
  sql('delete from rate_limit; delete from rate_bucket')
  console.log(fails ? `\n${fails} FAILED` : '\nall order-review checks passed')
  process.exitCode = fails ? 1 : 0
}
