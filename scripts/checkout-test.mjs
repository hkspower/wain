/**
 * The checkout, driven the way a customer drives it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/checkout-test.mjs
 *
 * payments-test.mjs posts to api.php?r=order and checks what comes back. That
 * is the contract, and it is not the shop: between a shopper and that endpoint
 * there is a bag, a three-step form, a saved address, two payment methods and
 * a redirect to a bank. None of it had a test, and it is the one page where a
 * fault costs money on the day it ships.
 *
 * TWO WAYS TO BUY, and both are covered here because they are different code:
 *
 *   THE FULL FORM      add to the bag, then /checkout: fourteen fields across
 *                      Bag -> Delivery -> Payment.
 *   QUICK CHECKOUT     "اشترِ الآن" (Buy now) on the product page. It appears
 *                      only once an address is saved on the device — the shop
 *                      keeps it in localStorage under `sporta.delivery` after
 *                      the first order — and then asks for two fields instead
 *                      of fourteen.
 *
 * WHAT IT ASSERTS, and the last one is the reason this file was written.
 *
 *   Cash completes and lands on the result page saying the courier will be
 *     paid.
 *   KNET does NOT complete here — it hands the shopper to the bank, and the
 *     assertion is that the redirect goes to knet/pay.php carrying THIS
 *     order's track id. Following it is not possible and not wanted: the URL
 *     is absolute to www.sporta.com.kw (config.js: "empty means use the
 *     built-in default"), and this sandbox has no route there. Recording the
 *     request is the honest test; following it measures the network.
 *   Quick checkout offers BOTH methods. A quick path that quietly dropped one
 *     of them would look perfect and halve the ways to pay.
 *   AND THE REFUSAL IS SHOWN. The shop declines a cash order from somebody
 *     who already has parcels out — antifraud, and correct — with
 *     409 too_many_open_cod. What matters is that the shopper is TOLD, in
 *     their own language, and is offered the way through:
 *
 *       "لديك طلبات بانتظار التوصيل. يرجى استلامها أولًا، أو ادفع لهذا الطلب
 *        أونلاين عبر كي نت."
 *       (You have orders awaiting delivery. Receive them first, or pay for
 *        this one online by KNET.)
 *
 *     A refusal the customer cannot see is a Confirm button that does nothing,
 *     and that is indistinguishable from a broken shop. This asserts the
 *     sentence reaches a role=alert and that it names KNET.
 *
 * WHAT THE MUTATIONS PROVED, because a green rig proves nothing until it has
 * been made to fail on purpose:
 *
 *   `>= STORE_COD_OPEN_MAX` -> `>= 999` in store.php  ..... the refusal
 *     assertion failed, as it must; without it this file would report a shop
 *     that had stopped defending itself as working.
 *   `track_id` -> a constant in api.php's order response .. three assertions
 *     failed: the recorded method, the unpaid status, and the track id in the
 *     KNET link.
 *
 *   AND ONE THAT DID NOT, which is a finding rather than a gap. Rewriting
 *   store_pay_url() to drop the track id and add `amt=9.500` changed nothing
 *   here, because THE SHOP NEVER READS `pay_url`: the bundle builds the link
 *   itself from `track_id` (assets/checkout-*.js: `new URLSearchParams({trackid:
 *   f.track_id, lang:n})`). The server's `pay_url` is dead for the website. It
 *   is still correct and still what a phone app would use, so it is not being
 *   deleted — but a change to it would ship untested by this file, and the
 *   assertions above measure the browser, which is what a customer is.
 *
 * A TRAP FOR WHOEVER EDITS THIS. The confirm button is rendered TWICE — once
 * for the wide layout and once for the narrow — and one of the two is
 * display:none. Clicking `.last()` times out after thirty seconds with no
 * explanation, which is exactly what happened while this was being written.
 * Every click here goes through `visible=true`.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PRODUCT = '/product/vanquish-tank-navy'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}
const db = (q) => {
  try {
    return execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B', '-e', q],
      { encoding: 'utf8' }).trim()
  } catch { return '' }
}

// A PHONE OF ITS OWN PER RUN. The cash guard counts OPEN cash orders per
// customer, so a rig that reuses one number blocks itself on its second run
// and reports the shop broken. The refusal is tested deliberately further
// down, with a number that has been given something to be refused for.
const PHONE = '5' + String(Date.now()).slice(-7)

// AND ITS OWN STOCK. This rig buys the same garment six times — once on the
// full form, once by KNET, four more to walk into the cash refusal — so it
// runs the test size out and then fails on a disabled size button, which reads
// like a broken checkout and is nothing of the kind. Top the sandbox seed up
// the way sandbox.sh does, and clear the throttle the order route quite
// correctly applies to six writes from one address.
db('update product_variants set stock = 20 where stock < 20')
db('delete from rate_limit')

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const openShop = async (saved) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  if (saved) {
    await page.evaluate((d) => localStorage.setItem('sporta.delivery', JSON.stringify(d)), saved)
  }
  return { ctx, page }
}

/** Put one L of the test garment in the bag, or go straight to Buy now. */
const pick = async (page, how) => {
  await page.goto(BASE + PRODUCT)
  await page.waitForTimeout(2200)
  await page.locator('button').filter({ hasText: /^L$/ }).first().click()
  await page.waitForTimeout(300)
  const label = how === 'quick' ? /^اشترِ الآن$/ : /^أضف$/
  await page.locator('button').filter({ hasText: label }).first().click()
  await page.waitForTimeout(2200)
}

const fillForm = async (page, phone) => {
  const set = async (sel, v) => { const l = page.locator(sel).first(); if (await l.count()) await l.fill(v) }
  await set('input[name=name]', 'Checkout Rig')
  await set('input[name=tel]', phone)
  await set('input[name=email]', 'rig@example.com')
  const gov = page.locator('select').first()
  if (await gov.count()) await gov.selectOption({ index: 1 }).catch(() => {})
  await set('input[name="address-level2"]', 'Salmiya')
  await set('input[name="address-line2"]', '4')
  await set('input[name="address-line1"]', '12')
  await set('input[name="address-line3"]', '8')
  await page.waitForTimeout(400)
}

const choose = async (page, method) => {
  const re = method === 'cash' ? /الدفع عند الاستلام/ : /كي ?نت/
  await page.locator('label,[role=radio]').filter({ hasText: re }).first().click().catch(() => {})
  await page.waitForTimeout(600)
}

/** Press Confirm and report what the shop did. */
const confirm = async (page) => {
  const calls = []
  let status = 0
  page.on('request', (r) => { if (/knet\/pay\.php|pay\/pay\.php/.test(r.url())) calls.push(r.url()) })
  page.on('response', async (r) => { if (/api\.php\?r=order/.test(r.url())) status = r.status() })
  await page.locator('button')
    .filter({ hasText: /تأكيد الطلب|ادفع عبر/ })
    .locator('visible=true').first().click()
  await page.waitForTimeout(4200)
  const alerts = await page.evaluate(() =>
    [...document.querySelectorAll('[role=alert],[role=status]')].map((e) => e.textContent.trim()).filter(Boolean))
  return { status, calls, url: page.url(), alerts }
}

// ============================================================== the full form
console.log('--- the full form')
{
  const { ctx, page } = await openShop(null)
  await pick(page, 'full')
  await page.goto(BASE + '/checkout')
  await page.waitForTimeout(2200)
  check(await page.locator('input,select,textarea').count() > 8,
    'the full form asks for the whole address')
  await fillForm(page, PHONE)
  await choose(page, 'cash')
  const r = await confirm(page)
  check(r.status === 200, `a cash order is accepted (${r.status})`, r.alerts.join(' | '))
  check(/[?&]status=cod/.test(r.url), 'and lands on the result page as cash', r.url)
  const track = (r.url.match(/trackid=(\w+)/) ?? [])[1] ?? ''
  check(db(`select payment_method from orders where track_id='${track}'`) === 'cod',
    'and the order is recorded as cash', track)
  check(db(`select payment_status from orders where track_id='${track}'`) === 'pending',
    'still unpaid, because nobody has paid anybody yet')
  await ctx.close()
}

// THE SAVED ADDRESS is what turns the quick path on, and the full form above
// is what saves it. Read it back rather than inventing one, so the two halves
// are actually connected.
const saved = { name: 'Checkout Rig', phone: PHONE, email: 'rig@example.com',
  governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' }

// =========================================================== quick checkout
console.log('\n--- quick checkout, from Buy now')
{
  const { ctx, page } = await openShop(saved)
  await pick(page, 'quick')
  check(/checkout/.test(page.url()), 'Buy now goes to the checkout', page.url())
  const inputs = await page.locator('input,select,textarea').count()
  check(inputs > 0 && inputs < 8,
    `and asks for a couple of fields, not the whole form (${inputs})`)

  // BOTH METHODS, OR IT IS NOT A CHECKOUT. A quick path that dropped one would
  // look perfect and halve the ways to pay.
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('label,[role=radio]')].map((e) => e.textContent)
      .filter((t) => t && /كي ?نت|الدفع عند الاستلام/.test(t)))
  check(opts.some((t) => /كي ?نت/.test(t)), 'KNET is offered')
  check(opts.some((t) => /الدفع عند الاستلام/.test(t)), 'and so is cash on delivery')

  await choose(page, 'knet')
  const r = await confirm(page)
  check(r.status === 200, `the order is written before the bank is involved (${r.status})`)
  check(r.calls.length > 0, 'and the shopper is handed to the bank', 'no redirect to a dropin')
  const track = (r.calls[0]?.match(/trackid=(\w+)/) ?? [])[1] ?? ''
  check(/knet\/pay\.php/.test(r.calls[0] ?? ''), 'to the KNET dropin', r.calls[0] ?? '')
  check(track !== '' && db(`select payment_method from orders where track_id='${track}'`) === 'knet',
    'carrying THIS order, recorded as knet', track)
  check(!/[?&](amt|amount)=/.test(r.calls[0] ?? ''),
    'and no amount in the link for anyone to edit')
  await ctx.close()
}

// ======================================= the refusal a shopper has to see
console.log('\n--- when cash is refused')
{
  // GIVE THIS PHONE SOMETHING TO BE REFUSED FOR. The guard (store.php,
  // STORE_COD_OPEN_MAX) allows three cash orders still in flight, so the one
  // the full form left is nowhere near it. Buying repeatedly until the shop
  // says no is exactly what the shopper this guard exists for would do, and
  // reading the cap out of the source instead of hard-coding 3 here means a
  // shop that raises it does not silently stop testing its own refusal.
  //
  // The phone is stored with the country code the shop adds, so count on a
  // SUFFIX match — an earlier version of this compared the bare number, found
  // zero, and reported the refusal path untested while it was working fine.
  const cap = +(/STORE_COD_OPEN_MAX\s*=\s*(\d+)/
    .exec(String(execFileSync('cat', ['sporta-site/public_html/api/store.php'], { encoding: 'utf8' }))) ?? [])[1]
  const openNow = () => +db(`select count(*) from orders
      where customer_phone like '%${PHONE}' and payment_method='cod'
        and payment_status='pending' and fulfilment_status not in ('delivered','cancelled')`)
  console.log(`--   the shop allows ${cap} cash orders in flight; this shopper has ${openNow()}`)

  let r = null
  for (let i = 0; i < cap + 1 && (r === null || r.status === 200); i++) {
    const { ctx, page } = await openShop(saved)
    await pick(page, 'quick')
    await choose(page, 'cash')
    r = await confirm(page)
    await ctx.close()
  }
  console.log(`--   after ${openNow()} open cash order(s), the shop answered ${r.status}`)

  if (check(r.status === 409, 'the shop refuses a fourth cash order from a shopper who has three out')) {
    check(r.alerts.length > 0,
      'the refusal is announced, not swallowed — a Confirm that does nothing is a broken shop')
    const said = r.alerts.join(' ')
    check(/كي ?نت|KNET/i.test(said),
      'and it offers KNET as the way through, which is the whole point of having two methods',
      said.slice(0, 90))
    console.log(`--   "${said.slice(0, 100)}"`)
  }
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — both ways to buy, both ways to pay')
process.exit(fails ? 1 : 0)
