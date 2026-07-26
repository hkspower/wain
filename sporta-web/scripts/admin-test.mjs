// Drives the admin panel the way its owner does: sign in, look at every tab,
// enrol a device passcode, lock, unlock.
//
// None of this had ever been exercised in a browser, because the PostgREST shim
// had no /auth/v1 — so there was no way to hold a session, and every admin
// screen sits behind one. The shim now issues a real (unsigned) JWT and runs SQL
// as the role in its claims, which is the part that matters: the admin policies
// are granted `to authenticated`, so a shim that ran everything as `anon` would
// show an empty dashboard and call it a pass.
//
// Needs: dist/ on :8188 with SPA routing, scripts/test-postgrest-shim.mjs on
// :8130, PostgreSQL on :5433 from scripts/db-rebuild.sh, and config.js pointing
// at the shim.
import { chromium } from 'playwright'

const EMAIL = 'admin@sporta.com.kw'
const PASSWORD = 'correct-horse'   // the only pair the shim accepts
const PASSCODE = '473182'   // six digits: the form requires exactly six

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'],
})
const results = []
const ok = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const p = await ctx.newPage()
const pageErrors = []
p.on('pageerror', (e) => pageErrors.push(e.message))

await p.goto('http://www.sporta.com.kw/admin', { waitUntil: 'networkidle' })

// ---- the panel must not be indexable, and must not claim to be the shop ----
const meta = await p.evaluate(() => ({
  robots: document.querySelector('meta[name=robots]')?.content ?? '',
  canonical: document.querySelector('link[rel=canonical]')?.href ?? '',
  title: document.title,
}))
ok('admin is noindex', /noindex/.test(meta.robots), meta.robots)
ok('admin asserts no canonical', meta.canonical === '', meta.canonical || '(none)')
ok('admin has its own title', meta.title === 'Sporta Admin', meta.title)

// ---- a wrong password must be refused and say so ----
await p.locator('input[type=email]').fill(EMAIL)
await p.locator('input[type=password]').fill('definitely-wrong')
await p.locator('form button').first().click()
await p.waitForTimeout(1500)
const err = await p.locator('.text-rose-600').first().textContent().catch(() => '')
ok('wrong password is refused with a message', /invalid/i.test(err ?? ''), (err ?? '').trim())
ok('and no dashboard appears', (await p.locator('aside.admin-sidebar').count()) === 0)

// ---- the real password gets in ----
await p.locator('input[type=password]').fill(PASSWORD)
await p.locator('form button').first().click()
await p.waitForSelector('aside.admin-sidebar', { timeout: 15000 })
ok('correct password signs in', true)
ok('signed-in email is shown', (await p.locator('aside p[title]').textContent()) === EMAIL)

// ---- every tab renders real data, with exactly one h1 ----
// Wait for the figure rather than reading straight after the sidebar appears:
// the stats RPC is still in flight at that moment, so the first version of this
// assertion failed on an empty card and blamed the page.
await p.getByText(/KWD\s*24/).first().waitFor({ timeout: 15000 })
const overviewText = await p.locator('main').innerText()
ok('Overview shows the paid revenue read from the database', /KWD\s*24/.test(overviewText),
   (overviewText.match(/REVENUE \(PAID\)[\s\S]{0,40}/) ?? [''])[0].replace(/\s+/g, ' '))

for (const [tab, heading] of [['Orders', 'Orders'], ['Catalogue', 'Catalogue'], ['Settings', 'Settings']]) {
  await p.locator(`button:has-text("${tab}")`).first().click()
  await p.waitForTimeout(1800)
  const h1s = await p.locator('main h1').allTextContents()
  ok(`${tab} renders under exactly one h1`, h1s.length === 1 && h1s[0].includes(heading), h1s.join(' | '))
}

// ---- orders the RLS policy is supposed to expose ----
await p.locator('button:has-text("Orders")').first().click()
await p.waitForTimeout(1800)
const ordersText = await p.locator('main').innerText()
for (const track of ['SPADM0001', 'SPADM0002', 'SPADM0003']) {
  ok(`Orders lists ${track}`, ordersText.includes(track))
}
ok('Orders shows the customer name', /Fatima/.test(ordersText))

// ---- the catalogue comparison, against real numeric prices ----
await p.locator('button:has-text("Catalogue")').first().click()
await p.waitForTimeout(2500)
const catText = await p.locator('main').innerText()
ok('Catalogue reports the seeded prices as in sync', /20 in sync/.test(catText) && !/differ from the site/.test(catText),
   (catText.match(/\d+ in sync[^\n]*/) ?? ['(not found)'])[0])

// ---- device passcode: enrol, then it must actually lock the panel ----
// The flow is three steps — name the device, type six digits, type them again —
// and it starts at "idle". An earlier version of this test filled the one input
// it found (the device-name box), asserted no error text was showing, and
// passed while nothing whatsoever had been enrolled. The database had zero
// passcode rows. So the check is now on the row, not on the absence of a
// complaint.
await p.locator('button:has-text("Settings")').first().click()
await p.waitForTimeout(1500)

await p.locator('input[placeholder*="iPhone"]').fill('Audit device')
await p.locator('button:has-text("Set up quick unlock")').click()
await p.waitForTimeout(600)

const typeCode = async () => {
  for (const d of PASSCODE) await p.locator(`button:text-is("${d}")`).first().click()
  await p.waitForTimeout(400)
}
await typeCode()   // first entry
await typeCode()   // confirmation
await p.waitForTimeout(2500)

const settingsText = await p.locator('main').innerText()
ok('enrolment completes without an error', !/did not match|could not save|error/i.test(settingsText),
   settingsText.replace(/\s+/g, ' ').slice(0, 110))
ok('the device is flagged as enrolled locally',
   (await p.evaluate(() => localStorage.getItem('sporta_passcode_enrolled'))) !== null)

// Reloading must now demand the passcode rather than showing the dashboard.
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
const locked = await p.locator('body').innerText()
ok('the panel is locked after reload', /passcode|unlock/i.test(locked) && (await p.locator('aside.admin-sidebar').count()) === 0,
   locked.replace(/\s+/g, ' ').slice(0, 90))

// And the right code opens it again.
for (const d of PASSCODE) await p.locator(`button:text-is("${d}")`).first().click()
await p.waitForTimeout(2500)
ok('the correct passcode unlocks it', (await p.locator('aside.admin-sidebar').count()) === 1)

ok('no JavaScript errors anywhere in the panel', pageErrors.length === 0, pageErrors.join('; '))

await browser.close()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
