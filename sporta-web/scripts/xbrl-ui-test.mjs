// The financial statements section in Settings (src/admin/Settings.jsx, FinancialStatements): show the figures for a
// period, and save the XBRL file. Runs in a browser against the sandbox router (dist + api).
//
//   npm run test:xbrl-ui     (needs the sandbox: `npm run sandbox`)
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
page.setDefaultTimeout(15000)
await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await page.locator('#admin-email').fill('qa-admin@sporta.test')
await page.locator('#admin-password').fill('correct-horse-battery-kw')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByRole('button', { name: 'Settings' }).first().click()
await page.locator('#fs-from').waitFor()
await page.locator('#fs-from').fill('2026-01-01')
await page.locator('#fs-to').fill('2026-12-31')
await page.getByRole('button', { name: 'Show figures' }).click()
await page.getByText('Revenue (KWD)').waitFor()
is(await page.getByText('Profit (KWD)', { exact: true }).isVisible(), 'the figures appear for the period')

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Download XBRL file' }).click(),
])
is(download.suggestedFilename() === 'sporta-financials-2026-01-01-2026-12-31.xbrl', 'the XBRL file is saved under its period name', download.suggestedFilename())
await page.getByText('XBRL file saved.').waitFor()
is(true, 'the screen confirms the save')

await page.locator('#fs-from').fill('2027-06-01')
await page.locator('#fs-to').fill('2026-01-01')
await page.getByRole('button', { name: 'Show figures' }).click()
await page.getByText('Choose a period').waitFor()
is(true, 'a period that ends before it starts is explained, not shown')

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
