/**
 * Drives the /backends panel against scripts/mock-admin.py, on a phone.
 *
 *   python3 scripts/mock-admin.py 8899 &
 *   EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npx expo export --platform web
 *   python3 scripts/serve-dist.py &
 *   node scripts/admin-smoke.mjs
 *
 * The panel has no offline fallback by design, so there is no way to exercise
 * it without a server — see the mock's header.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const API = process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:8899'

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
check((await seen(p.getByText('٣٧٫٥٠٠ د.ك')).count()) > 0, 'takings are formatted as KWD fils')
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

// --- one order, and the status machine -----------------------------------
await p.getByRole('link', { name: 'Order SP-2601' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByText('Call before coming up')).count()) > 0, 'the order detail loads')
check((await seen(p.getByRole('button', { name: 'shipped' })).count()) === 0,
  'a status the order cannot move to is not offered')
await shot('order')

await p.getByRole('button', { name: 'packing' }).click()
await p.waitForTimeout(900)
check((await seen(p.getByRole('button', { name: 'shipped' })).count()) > 0,
  'moving the status re-offers the next one')
check((await seen(p.getByRole('button', { name: 'paid' })).count()) === 0,
  'and does not offer a step backwards')

// --- stock ---------------------------------------------------------------
await p.getByRole('link', { name: 'Stock' }).click()
await p.waitForTimeout(900)
const field = seen(p.getByLabel('stock for Core compression tee M')).first()
check((await field.inputValue()) === '9', 'stock loads the current count')
await field.fill('12x')
await p.getByRole('button', { name: 'Save' }).first().click()
await p.waitForTimeout(500)
check((await seen(p.getByText(/is not a whole number/)).count()) > 0, 'a non-numeric stock is refused')
await field.fill('12')
await p.getByRole('button', { name: 'Save' }).first().click()
await p.waitForTimeout(900)
check((await seen(p.getByText('Saved')).count()) > 0, 'a valid stock saves')
await shot('stock')

// --- it persists, and it drops a dead token ------------------------------
await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
check((await seen(p.getByText('Today', { exact: true })).count()) > 0,
  'the session survives a reload')

await p.evaluate(() => localStorage.setItem('sporta.admin.token.v1', 'stale'))
await p.goto(BASE + '/backends/orders', { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
check((await seen(p.getByText('Sign in')).count()) > 0, 'a rejected token signs the panel out')

await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
