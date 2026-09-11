/**
 * The /backends panel, in a browser, against the REAL admin.php.
 *
 *   bash scripts/sandbox.sh
 *   python3 scripts/serve-dist.py &
 *   EXPO_PUBLIC_API_BASE=http://127.0.0.1:4173/api npm run build:web
 *   node scripts/admin-browser-live.mjs
 *
 * There were already three checks on this panel and a gap between them.
 * admin-contract-test.mjs reads the files and proves the route names match.
 * admin-live-test.mjs speaks the protocol to the real PHP with node's fetch.
 * admin-smoke.mjs drives the real screens in a browser — but against the
 * MOCK. So nothing ever put the actual panel in front of the actual server,
 * which is the only combination a manager ever uses.
 *
 * That gap is exactly the shape of the bug this panel already shipped once:
 * every test green against a fixture, every request dead against production.
 * A contract test can only prove that the names agree. It cannot prove that
 * signing in works, that the session cookie survives the next request, that
 * the two status axes produce the right buttons on a real order, or that
 * pressing one writes to MariaDB.
 *
 * WHAT IT DOES TO THE DATABASE. One order is moved along its fulfilment axis
 * and moved straight back, and the check is not the screen — it is the row.
 * The panel saying "packing" proves React re-rendered; only the database
 * saying 'packed' proves the request arrived, and only the server's word
 * being 'packed' rather than the app's 'packing' proves the translation in
 * admin.ts is still there.
 *
 * ONE ORIGIN, as in production: serve-dist.py passes /api through to the PHP
 * site, so the cookie and the X-Sporta-Admin header travel without a CORS
 * preflight — the same topology Apache gives the live shop.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
// The database's own answer, not the panel's. `mariadb -N` so the value comes
// back bare and a header row cannot be mistaken for data.
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
const api = []
p.on('response', (r) => {
  if (r.url().includes('admin.php')) api.push(`${r.request().method()} ${decodeURIComponent(r.url().split('?')[1] ?? '')} -> ${r.status()}`)
})
const called = (re) => api.some((a) => re.test(a))

// --- signed out ------------------------------------------------------------
await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
check(called(/r=me -> 200/), 'the panel asks the real server who is signed in (?r=me)')
check((await p.locator('input').count()) === 2, 'signed out, it offers email and password')

// --- sign in ---------------------------------------------------------------
// The button, not the heading: both say "Sign in", and getByText().first()
// picks the heading, clicks nothing, and reports a broken login.
await p.locator('input').nth(0).fill(EMAIL)
await p.locator('input').nth(1).fill(PASSWORD)
api.length = 0
await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
await p.waitForTimeout(2500)
check(called(/r=login -> 200/), 'the password is checked by admin.php, not by the app')
check(called(/r=stats -> 200/) && called(/r=variants -> 200/),
  'and the dashboard immediately reads stats and variants')

const dash = await p.locator('body').innerText()
check(/Sign out/.test(dash), 'the panel is signed in')
// The figure on screen against the figure in the table. A dashboard that
// renders a plausible number from stale state is the failure this catches.
const paidToday = sql("select count(*) from orders where payment_status='paid' and date(paid_at)=curdate()")
check(dash.includes(paidToday), `orders-today matches the database (${paidToday})`)

// --- the three lists -------------------------------------------------------
for (const [tab, route] of [['Orders', /r=orders/], ['Stock', /r=variants/], ['Promotions', /r=discounts/]]) {
  api.length = 0
  await p.getByText(tab, { exact: true }).first().click()
  await p.waitForTimeout(2000)
  check(called(route) && !called(/-> [45]\d\d/), `${tab} loads from the real server`)
}

// --- an order, and a write that has to land -------------------------------
await p.getByText('Orders', { exact: true }).first().click()
await p.waitForTimeout(1800)
// 'new' is unpaid AND unfulfilled — the only filter guaranteed to hold an
// order with moves left on both axes.
await p.getByText('new', { exact: true }).first().click()
await p.waitForTimeout(1500)
// Rows are role=link, not role=button: expo-router's Link renders a div with
// role=link, and filtering on button finds nothing and reads as "no orders".
const rows = p.getByRole('link').filter({ hasText: /^SP/ })
const count = await rows.count()
check(count > 0, `there is an unpaid, unfulfilled order to move (${count})`)

api.length = 0
await rows.first().click()
await p.waitForTimeout(2500)
check(called(/r=items&order=\d+ -> 200/), 'the order detail joins its items from the server')

const detail = await p.locator('body').innerText()
const ref = detail.match(/SP[A-Z0-9]{6,}/)?.[0]
check(!!ref, `the detail names the order (${ref})`)

const moves = await p.getByRole('button')
  .filter({ hasText: /^(paid|packing|shipped|delivered|cancelled)$/ }).allTextContents()
// Both axes, from one row: cash that is not yet collected can be marked paid,
// an unfulfilled parcel can be packed or cancelled, and 'shipped' is NOT
// offered before 'packed' because the fulfilment axis is ordered.
check(moves.includes('paid') && moves.includes('packing') && moves.includes('cancelled'),
  `the moves offered are the ones both axes allow (${moves.join(', ')})`)
check(!moves.includes('shipped'), "and 'shipped' is not offered before the parcel is packed")

const before = sql(`select fulfilment_status from orders where track_id='${ref}'`)
api.length = 0
await p.getByRole('button').filter({ hasText: /^packing$/ }).first().click()
await p.waitForTimeout(2600)
check(called(/POST r=fulfilment -> 200/), 'pressing it POSTs to r=fulfilment')

const after = sql(`select fulfilment_status from orders where track_id='${ref}'`)
// THE WHOLE POINT OF THIS FILE. The app's word is 'packing'; the server's is
// 'packed'; admin.ts translates between them. If that translation is ever
// dropped the request 400s and this row does not move.
check(after === 'packed', `the DATABASE now says 'packed' — not the app's 'packing' (${before} -> ${after})`)

execFileSync('mariadb', ['-uroot', 'sporta', '-e',
  `update orders set fulfilment_status='${before}' where track_id='${ref}'`])
check(sql(`select fulfilment_status from orders where track_id='${ref}'`) === before,
  `and the order is put back as it was (${before})`)

// --- out -------------------------------------------------------------------
// Back to the shell first. The order detail is pushed ON TOP of it, so the
// dashboard's "Sign out" is still in the DOM and hidden — clicking it from
// here waits forever on an element that will never be visible.
await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1800)
api.length = 0
await p.getByText('Sign out', { exact: true }).first().click()
await p.waitForTimeout(2000)
check((await p.locator('input').count()) === 2, 'signing out returns the panel to the login')

check(errors.length === 0, `no console or page errors${errors.length ? ': ' + errors[0] : ''}`)

console.log(fails ? `\n${fails} failed` : '\nall ok — the real panel, the real admin.php, the real database')
await b.close()
process.exit(fails ? 1 : 0)
