/**
 * Drives the /backends panel against scripts/mock-admin.py, on a phone.
 *
 *   python3 scripts/mock-admin.py 8899 &
 *   EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npx expo export --platform web
 *   node scripts/admin-smoke.mjs
 *
 * ONE ORIGIN. The mock serves the exported app AND answers admin.php, the
 * way Apache serves both in production — which is what lets the browser
 * carry the session cookie and the X-Sporta-Admin header without a CORS
 * preflight nothing real would ever answer. The panel has no offline
 * fallback by design, so there is no way to exercise it without a server —
 * see the mock's header. The mock mirrors admin.php route for route;
 * admin-contract-test.mjs enforces that, and admin-live-test.mjs runs the
 * same protocol against the real PHP.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8899'
const API = BASE

// The fixture is stateful — this test moves an order along and edits a stock
// count — so it is reset first. Without this, a second run starts from the
// first run's leftovers and fails on a transition that already happened.
await fetch(`${API}/admin.php?r=reset`, { method: 'POST' })
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const seen = (loc) => loc.filter({ visible: true })

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const shot = (name) => p.screenshot({ path: `/tmp/backends-${name}.png` })

await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

// --- the panel is closed until you sign in -------------------------------
check((await seen(p.getByText('Sign in')).count()) > 0, 'signed out, the panel shows a login')
check((await seen(p.getByText('Orders', { exact: true })).count()) === 0,
  'the nav is not reachable while signed out')
await shot('login')

// --- a wrong password is refused, and does not say which half was wrong ---
await p.getByLabel('Email').fill('manager@sporta.com.kw')
await p.getByLabel('Password').fill('nope')
await p.getByRole('button', { name: 'Sign in' }).click()
await p.waitForTimeout(700)
check((await seen(p.getByText('Wrong email or password.')).count()) > 0, 'a bad password is refused')

// --- the real one gets in ------------------------------------------------
await p.getByLabel('Password').fill('correct horse')
await p.getByRole('button', { name: 'Sign in' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByText('Today', { exact: true })).count()) > 0, 'signing in opens the dashboard')
check((await seen(p.getByText('٨٫٠٠٠ د.ك')).count()) > 0, 'takings are formatted as KWD fils')
check((await seen(p.getByText('Desert runner short · XL')).count()) > 0, 'the low-stock list is real data')
await shot('today')

// --- orders, filtered ----------------------------------------------------
await p.getByRole('link', { name: 'Orders', exact: true }).click()
await p.waitForTimeout(900)
const all = await seen(p.getByText(/^SP-26\d\d$/)).count()
check(all === 3, `orders list loads (${all})`)
await p.getByRole('button', { name: 'delivered' }).click()
await p.waitForTimeout(700)
check((await seen(p.getByText(/^SP-26\d\d$/)).count()) === 1, 'the status filter narrows the list')
await p.getByRole('button', { name: 'all' }).click()
await p.waitForTimeout(700)
await shot('orders')

// --- one order on each axis ----------------------------------------------
// SP-2601 is a CARD order the bank has not confirmed. A person must not be
// able to mark a card paid, and packing an unpaid card order is not offered
// either — cancel is the only move.
await p.getByRole('link', { name: 'Order SP-2601' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByText('Call before coming up')).count()) > 0, 'the order detail loads')
check((await seen(p.getByRole('button', { name: 'paid' })).count()) === 0,
  'a card order is never offered "paid" by hand — that is the bank\'s to say')
check((await seen(p.getByRole('button', { name: 'shipped' })).count()) === 0,
  'a status the order cannot move to is not offered')
await shot('order')

// SP-2602 is CASH, already packed, money not yet collected: both axes are
// live at once — the parcel can move on, and the cash can be recorded.
await p.goBack()
await p.waitForTimeout(700)
await p.getByRole('link', { name: 'Order SP-2602' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByRole('button', { name: 'paid' })).count()) > 0,
  'a cash order still owed offers "paid"')
await p.getByRole('button', { name: 'shipped' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByRole('button', { name: 'delivered' })).count()) > 0,
  'moving the status re-offers the next one')
check((await seen(p.getByRole('button', { name: 'packing' })).count()) === 0,
  'and does not offer a step backwards')
check((await seen(p.getByRole('button', { name: 'paid' })).count()) > 0,
  'the cash axis survives the parcel moving — the money arrives at the door')
await p.getByRole('button', { name: 'paid', exact: true }).click()
await p.waitForTimeout(900)
check((await seen(p.getByRole('button', { name: 'paid' })).count()) === 0,
  'recording the cash retires the button')

// --- stock ---------------------------------------------------------------
await p.getByRole('link', { name: 'Stock' }).click()
await p.waitForTimeout(900)
const field = seen(p.getByLabel('stock for Core compression tee L')).first()
check((await field.inputValue()) === '9', 'stock loads the current count')
const saveBtn = p.getByRole('button', { name: 'save stock for Core compression tee L' })
await field.fill('12x')
await saveBtn.click()
await p.waitForTimeout(500)
check((await seen(p.getByText(/is not a whole number/)).count()) > 0, 'a non-numeric stock is refused')
await field.fill('12')
await saveBtn.click()
await p.waitForTimeout(900)
check((await seen(p.getByText('Saved')).count()) > 0, 'a valid stock saves')
await shot('stock')

// --- promotions ----------------------------------------------------------
await p.getByRole('link', { name: 'Promotions' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByText('SAVE10')).count()) > 0, 'the promotions list loads')
check((await seen(p.getByText('used up')).count()) > 0,
  'a promotion at its usage limit is marked used up, not live')

// Pausing is the change made in a hurry, usually because a promotion is
// costing money — so it is one tap from the list, not inside an edit form.
await p.getByRole('button', { name: 'Pause' }).first().click()
await p.waitForTimeout(900)
check((await seen(p.getByText('paused')).count()) > 0, 'a live promotion can be paused')

// Deleting one that customers have already redeemed is refused: the rule is
// what a manager looks for when asked why an order was charged that.
await p.getByRole('button', { name: 'delete SAVE10' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByText(/has been used/)).count()) > 0,
  'a redeemed promotion cannot be deleted')

// A new one, through the form.
await p.getByRole('button', { name: 'New promotion' }).click()
await p.waitForTimeout(600)
await p.getByLabel('Code').fill('WINTER26')
await p.getByRole('button', { name: 'Save' }).click()
await p.waitForTimeout(600)
check((await seen(p.getByText(/Give it a label/)).count()) > 0,
  'a promotion with no label is refused before it reaches the server')
await p.getByLabel('Label (shown on the order)').fill('Winter 26')
await p.getByLabel('Percent off (1–90)').fill('120')
await p.getByRole('button', { name: 'Save' }).click()
await p.waitForTimeout(600)
check((await seen(p.getByText(/between 1 and 90/)).count()) > 0,
  'a percentage over 90 is refused')
await p.getByLabel('Percent off (1–90)').fill('20')
await p.getByRole('button', { name: 'Save' }).click()
await p.waitForTimeout(1200)
check((await seen(p.getByText('WINTER26')).count()) > 0, 'the new promotion is saved and listed')
await shot('promos')

// --- it persists, and it drops a dead token ------------------------------
await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
check((await seen(p.getByText('Today', { exact: true })).count()) > 0,
  'the session survives a reload')

// The cookie IS the credential now — there is no stored token to go stale.
// Clearing the jar is what an expired or revoked session looks like, and the
// panel must find that out from ?r=me and show the login, not a dashboard.
await p.context().clearCookies()
await p.goto(BASE + '/backends/orders', { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
check((await seen(p.getByText('Sign in')).count()) > 0, 'a dead session signs the panel out')

await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
