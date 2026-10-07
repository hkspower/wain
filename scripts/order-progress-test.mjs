/**
 * Order progress on /track and in the account sheet. node scripts/order-progress-test.mjs (sandbox on :4300)
 * Plants orders in each state, reads what a customer sees, and removes them.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
const CASES = [
  // id, method, payment, fulfilment, expected state, expected words
  ['SPOPRIG01', 'knet', 'pending', 'unfulfilled', 'placed', /Waiting for payment/],
  ['SPOPRIG02', 'cod', 'pending', 'unfulfilled', 'confirmed', /Pay the driver on delivery/],
  ['SPOPRIG03', 'knet', 'paid', 'unfulfilled', 'confirmed', /Paid/],
  ['SPOPRIG04', 'knet', 'paid', 'packed', 'packed', /Packed/],
  ['SPOPRIG05', 'cod', 'pending', 'shipped', 'shipped', /On the way/],
  ['SPOPRIG06', 'knet', 'paid', 'delivered', 'delivered', /Delivered/],
  ['SPOPRIG07', 'knet', 'paid', 'cancelled', 'cancelled', /cancelled/],
  ['SPOPRIG08', 'knet', 'failed', 'unfulfilled', 'failed', /did not go through/],
]
const EMAIL = 'op-rig@example.com'
const clean = () => { sql(`delete from orders where track_id like 'SPOPRIG%'`); sql(`delete from customers where email='${EMAIL}'`); sql('delete from rate_limit; delete from rate_bucket') }
clean()
for (const [id, m, pay, ful] of CASES)
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, created_at, paid_at, fulfilled_at) values ('${id}', 12.5, '${pay}', '${m}', '${ful}', 'Op Rig', '55512345', now() - interval 2 day, ${pay === 'paid' ? 'now() - interval 2 day' : 'null'}, ${ful === 'delivered' ? 'now()' : 'null'})`)
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  // the status route says where the parcel is and nothing about whose it is
  const st = await (await fetch(`${BASE}/api/api.php?r=status&id=SPOPRIG05`)).json()
  check(st.fulfilment_status === 'shipped' && 'created_at' in st, 'the status route now says where the order is', JSON.stringify(st))
  check(!Object.keys(st).some((k) => /customer|phone|email|address|area|block|street|governorate/.test(k)), 'and carries no personal data (an order number is not a secret)', Object.keys(st).join(','))

  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await p.goto(`${BASE}/track?lang=en`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  for (const [id, , , , want, words] of CASES) {
    await p.locator('main form input').first().fill(id); await p.locator('main form button').first().click()
    await p.waitForTimeout(1300)
    const r = await p.evaluate(() => { const b = document.querySelector('[data-order-progress]'); return b ? { s: b.getAttribute('data-op-state'), txt: b.innerText, cur: (b.querySelector('[aria-current=step] b') || {}).textContent || '', done: b.querySelectorAll('.op-done').length } : null })
    check(r && r.s === want && words.test(r.txt), `${id}: shows "${want}"`, r ? `${r.s} | current=${r.cur} done=${r.done}` : 'no progress box')
  }
  check(await p.locator('[data-order-progress]').count() === 1, 'searching again replaces the box, it does not stack them')
  await p.locator('main form input').first().fill('NOSUCHORDER1'); await p.locator('main form button').first().click(); await p.waitForTimeout(1200)
  check(await p.locator('[data-order-progress]').count() === 0, 'an order that does not exist shows no progress')
  // Arabic
  const a = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await a.goto(`${BASE}/track?lang=ar`, { waitUntil: 'networkidle' }); await a.waitForTimeout(1200)
  await a.locator('main form input').first().fill('SPOPRIG05'); await a.locator('main form button').first().click(); await a.waitForTimeout(1300)
  check((await a.locator('[data-order-progress]').innerText()).includes('في الطريق'), 'Arabic: the steps are in Arabic')
  // the account sheet: an order linked to the customer carries the compact bar
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const c = await ctx.newPage()
  await c.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' }); await c.waitForTimeout(1500)
  await c.locator('[data-cua-btn]').click(); await c.locator('.cua-tab').nth(1).click()
  await c.locator('#cua-email').fill(EMAIL); await c.locator('#cua-pw').fill('correct horse battery'); await c.locator('.cua-go').click(); await c.waitForTimeout(1200)
  const cid = sql(`select id from customers where email='${EMAIL}'`)
  sql(`update orders set customer_id=${cid} where track_id='SPOPRIG05'`)
  await c.keyboard.press('Escape'); await c.locator('[data-cua-btn]').click(); await c.waitForTimeout(1300)
  const bar = await c.evaluate(() => { const b = document.querySelector('.cua-order [data-order-progress]'); return b ? b.getAttribute('data-op-state') + '|' + b.querySelectorAll('.op-step').length : null })
  check(bar === 'shipped|5', 'the account sheet shows the five-step bar on the order', String(bar))
  await ctx.close()
} finally { clean(); await b.close() }
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
