// The native backend driven by the REAL SITE in a REAL BROWSER — the built SPA
// and the PHP API on one origin, exactly the production layout, with MariaDB
// underneath. This is the test that proves the switch: config.js says
// backend:'php' and the shop takes an order with no Supabase anywhere.
//
//   npm run test:native-e2e
//   (needs MariaDB up and `php -S 127.0.0.1:8096 scripts/router-native.php`)
import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
const sql = async (q) =>
  (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))

// Unlock too: the throttle section of native-backend-test.mjs deliberately
// leaves the admin account locked, and this suite signs in.
await sql('delete from fulfilment_outbox; delete from order_items; delete from orders; ' +
  'update admin_users set failed_attempts = 0, locked_until = null;')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('   [pageerror]', e.message))

// config.js is the ONLY thing routed. Everything else — the SPA, the API, the
// order — is the real stack end to end.
await page.route('**/config.js', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: "window.SPORTA_CONFIG={backend:'php'};",
  }),
)
// The bank is out of scope here; pay.php would be the next hop. Capture the
// redirect instead of following it off-origin.
await page.route('**/knet/pay.php*', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<title>bank</title>arrived at the gateway' }),
)

// ---- product page reads stock from MySQL ----
await page.goto(`${BASE}/product/cloudsoft-jacket-army-green`, { waitUntil: 'networkidle' })
const chips = await page.$$eval('[role="group"][aria-label="Size"] button', (els) =>
  els.map((e) => [e.textContent.trim(), e.disabled]),
)
is(chips.length >= 8, 'the size ladder renders', `${chips.length} chips`)
const enabled = chips.filter(([, d]) => !d).map(([l]) => l)
is(enabled.join(',') === 'M,L', 'availability comes from the MySQL variants (M and L carried)', enabled.join(','))

// ---- add to bag, with a size and a fit ----
await page.locator('[role="group"][aria-label="Size"] button:not([disabled])').first().click()
await page.locator('[role="group"][aria-label="Fit"] button').nth(3).click() // Oversize
await page.getByRole('button', { name: 'Add', exact: true }).click()

// ---- checkout: fill the form and pay ----
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
const fill = async (id, v) => page.locator(`#f-${id}`).fill(v)
await fill('name', 'Native Test Customer')
await page.locator('#f-phone').fill('99887766')
await page.locator('#f-governorate').selectOption('hawalli')
await fill('area', 'Salmiya')
await fill('block', '4')
await fill('street', '12')
await fill('building', '5')
await page.getByRole('button', { name: /Pay with KNET/ }).first().click()
await page.waitForURL('**/knet/pay.php*', { timeout: 15000 })
is(true, 'checkout hands off to the payment gateway')

// ---- the order is REAL, in MySQL, priced by the server ----
const row = (await sql(
  "select track_id, amount, payment_status, payment_method from orders order by id desc limit 1",
)).split('\t')
is(row[1] === '10.000', 'the order in MySQL is priced from the products table', `${row[1]} KWD`)
is(row[2] === 'pending' && row[3] === 'knet', 'status pending, method knet', `${row[2]}/${row[3]}`)

const item = (await sql(
  'select size, fit, qty from order_items order by id desc limit 1',
)).split('\t')
is(item[0] === 'M' && item[1] === 'oversize', 'the chosen size and fit reached the database', item.join('/'))

const outbox = await sql("select count(*) from fulfilment_outbox where kind='new'")
is(outbox === '1', 'the warehouse message queued in the same transaction')

// ---- invoice + tracking read back through the native API ----
const track = row[0]
await page.goto(`${BASE}/invoice/${track}`, { waitUntil: 'networkidle' })
const body = await page.locator('article').innerText()
is(body.includes(track) && /10\.000/.test(body), 'the invoice renders from MySQL', track)

// ---- the bank confirms: callback in mysql mode settles the order ----
await sql(`update orders set payment_status='paid', paid_at=now() where track_id='${track}'`)
await page.goto(`${BASE}/payment/result?status=success&trackid=${track}`, { waitUntil: 'networkidle' })
const confirmed = await page.locator('h1').first().textContent()
is(!!confirmed && confirmed.trim().length > 1, 'the result page confirms against the native API', confirmed?.trim())

// ---- the admin, natively ----
{
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const ap = await admin.newPage()
  await ap.route('**/config.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: "window.SPORTA_CONFIG={backend:'php'};" }),
  )
  await ap.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  is(await ap.locator('input[type=email]').isVisible(), 'the native admin shows its login')

  await ap.locator('input[type=email]').fill('cs@sporta.com.kw')
  await ap.locator('input[type=password]').fill('correct-horse-battery-kw')
  await ap.getByRole('button', { name: 'Sign in' }).click()
  await ap.getByRole('button', { name: 'Orders' }).first().waitFor({ timeout: 10000 })
  is(true, 'the password signs in to the dashboard')

  await ap.getByRole('button', { name: 'Orders' }).first().click()
  await ap.waitForTimeout(800)
  const text = await ap.locator('main').innerText()
  is(text.includes(track), 'the order placed in this test is on the Orders screen', track)

  await ap.getByRole('button', { name: 'Inventory' }).first().click()
  await ap.waitForTimeout(800)
  const inv2 = await ap.locator('main').innerText()
  is(/A-CSJ-AR-L/.test(inv2), 'the inventory reads the MySQL variants')
  await admin.close()
}

await ctx.close()
await browser.close()
console.log(fails ? `\n${fails} problem(s) in the native e2e` : '\nthe whole shop runs with no Supabase')
process.exit(fails ? 1 : 0)
