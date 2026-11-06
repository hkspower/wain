// The admin as an installable phone app (src/admin/AdminApp.jsx, useAdminAppHead): while /backends is open the page
// uses the admin manifest, the admin home-screen title and noindex; leaving it puts the storefront values back.
//
//   npm run test:admin-app      (needs the sandbox: `npm run sandbox`)
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.setDefaultTimeout(15000)
const head = () => page.evaluate(() => ({
  manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
  title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  robots: document.querySelector('meta[name="robots"]')?.content,
}))

await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await page.locator('#admin-email').waitFor()
const open = await head()
is(open.manifest === '/backends.webmanifest', 'the open admin uses its own manifest', open.manifest)
is(open.title === 'Sporta Admin', 'and its home-screen title', open.title)
is(open.robots === 'noindex, nofollow, noarchive', 'and noindex', open.robots)
const mf = await page.evaluate(async () => (await fetch('/backends.webmanifest')).json())
is(mf.display === 'standalone' && mf.start_url && Array.isArray(mf.icons) && mf.icons.length > 0, 'the manifest is installable (standalone, start URL, icons)')

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const shop = await head()
is(shop.manifest === '/site.webmanifest' || shop.manifest === null, 'leaving the admin puts the storefront manifest back', String(shop.manifest))
is(shop.title !== 'Sporta Admin', 'and the storefront title', String(shop.title))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
