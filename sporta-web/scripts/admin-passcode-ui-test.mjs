// The device passcode in the admin screens (src/admin/AdminApp.jsx and Settings.jsx), in a real browser against the
// sandbox router (dist + api): set it in Settings, sign out, come back, and unlock with the passcode.
//
//   npm run test:admin-passcode-ui      (needs the sandbox: `npm run sandbox`)
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
const EMAIL = 'cs@sporta.com.kw'
const PASSWORD = 'correct-horse-battery-kw'
const PASSCODE = '482915'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(15000)

async function signInWithPassword() {
  await page.locator('#admin-email').fill(EMAIL)
  await page.locator('#admin-password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Settings' }).first().waitFor()
}

head('sign in, then set the passcode in Settings')
await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await page.locator('#admin-email').waitFor()
await signInWithPassword()
await page.getByRole('button', { name: 'Settings' }).first().click()
await page.locator('#passcode-password').waitFor()
is(await page.locator('#passcode-heading').isVisible(), 'Settings shows the passcode section')
await page.locator('#passcode-password').fill(PASSWORD)
await page.locator('#passcode-new').fill(PASSCODE)
await page.getByRole('button', { name: 'Set passcode' }).click()
await page.getByText('Passcode saved.').waitFor()
is(true, 'the passcode is saved after the password is confirmed')

head('sign out, come back, unlock with the passcode')
await page.evaluate(() => fetch('/api/admin.php?r=logout', { method: 'POST', headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' }))
await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await page.locator('#admin-passcode').waitFor()
is(await page.locator('#admin-passcode').isVisible(), 'a known browser is asked for the passcode, not the password')
is(await page.locator('#admin-password').count() === 0, 'and the password box is not shown until asked for')

await page.locator('#admin-passcode').fill('000000')
await page.getByRole('button', { name: 'Unlock' }).click()
await page.getByText('That passcode is not right.').waitFor()
is(true, 'a wrong passcode says so')

await page.locator('#admin-passcode').fill(PASSCODE)
await page.getByRole('button', { name: 'Unlock' }).click()
await page.getByRole('button', { name: 'Settings' }).first().waitFor()
is(true, 'the right passcode opens the dashboard')

head('the password is still there')
await page.evaluate(() => fetch('/api/admin.php?r=logout', { method: 'POST', headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' }))
await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await page.locator('#admin-passcode').waitFor()
await page.getByRole('button', { name: 'Use my password instead' }).click()
await page.locator('#admin-password').waitFor()
is(await page.locator('#admin-password').isVisible(), 'Use my password instead shows the password sign-in')
await signInWithPassword()
is(true, 'the password still signs in')

// clean up: the other suites expect no passcode
await page.getByRole('button', { name: 'Settings' }).first().click()
await page.locator('#passcode-password').waitFor()
await page.locator('#passcode-password').fill(PASSWORD)
await page.getByRole('button', { name: 'Remove passcode' }).click()
await page.getByText('Passcode removed.').waitFor()

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
