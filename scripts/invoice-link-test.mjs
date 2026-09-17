/**
 * The website panel's order-detail drawer: a link to the archived PDF invoice.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/invoice-link-test.mjs
 *
 * api/invoice-pdf.php, api/cron-invoice.php and api/invoice-file.php already
 * built, swept and served the document — grep across both panel bundles found
 * not one reference to invoice-file.php anywhere, so the only way to reach it
 * was typing the URL from memory. assets/invoices.js is the overlay that adds
 * the link; this is what proves it actually reaches a real PDF rather than
 * merely appearing to.
 *
 * WHAT IT ASSERTS, in the order the faults matter:
 *
 *  1. The link is NOT on the sign-in screen or the Orders table itself — only
 *     inside an open order's drawer. An overlay scoped by a bare selector
 *     could leak onto either.
 *  2. Opening a SECOND order's drawer updates the href rather than keeping the
 *     first order's track id — the overlay is marked so it does not insert
 *     twice, and that marking must not also freeze it stale.
 *  3. The href, fetched with the browser's own session (no X-Sporta-Admin
 *     header — this route is deliberately cookie-only, exactly the property
 *     that makes a plain <a> the right shape), answers 200
 *     application/pdf with a real PDF signature. A link that LOOKS right
 *     and 404s is worse than no link: it tells an admin the invoice does not
 *     exist.
 *  4. Signed OUT, the same URL is refused — the link's convenience must not
 *     have come from also loosening the gate.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } })

const link = () => p.locator('.spi-link')

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  check(await link().count() === 0, 'the invoice link is not on the sign-in screen')

  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await p.waitForTimeout(3000)

  await p.getByText('Orders', { exact: true }).first().click()
  await p.waitForTimeout(2000)
  check(await link().count() === 0, 'and not on the Orders table itself, before any row is opened')

  const rows = p.locator('tbody tr')
  const rowCount = await rows.count()
  check(rowCount >= 2, `the sandbox has at least two orders to open (${rowCount})`,
    rowCount < 2 ? 'the rest of this rig needs a second order to prove the href updates' : '')

  await rows.nth(0).click()
  await p.waitForTimeout(1000)
  const dialog1 = p.locator('[role="dialog"][aria-modal="true"]')
  check(await dialog1.count() === 1, 'opening a row opens exactly one drawer')
  const track1 = ((await dialog1.getAttribute('aria-label')) || '').replace(/^Order /, '')
  check(track1.length > 0, 'the drawer names the order it is for', track1)
  check(await link().count() === 1, 'the invoice link is on the open drawer, exactly once')
  const href1 = await link().getAttribute('href')
  check(href1 === `/api/invoice-file.php?id=${track1}`,
    'and it points at this order\'s invoice', href1)

  // --- close, open a DIFFERENT order, and the href must follow it ----------
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
  check(await link().count() === 0, 'closing the drawer removes the link with it')

  if (rowCount >= 2) {
    await rows.nth(1).click()
    await p.waitForTimeout(1000)
    const dialog2 = p.locator('[role="dialog"][aria-modal="true"]')
    const track2 = ((await dialog2.getAttribute('aria-label')) || '').replace(/^Order /, '')
    const href2 = await link().getAttribute('href')
    check(track2 !== track1, 'the second row is a different order', `${track1} / ${track2}`)
    check(href2 === `/api/invoice-file.php?id=${track2}`,
      'and the link followed it rather than keeping the first order\'s id', href2)

    // --- the href actually answers, with this browser's own session --------
    const res = await p.request.get(`${BASE}${href2}`)
    check(res.status() === 200, 'the href answers 200', String(res.status()))
    check((res.headers()['content-type'] || '').includes('application/pdf'),
      'as a PDF', res.headers()['content-type'])
    const bytes = await res.body()
    check(bytes.slice(0, 5).toString('latin1') === '%PDF-',
      'and the bytes are a real PDF, not an error page rendered as 200')
  }
} finally {
  // --- signed out, the same route refuses ------------------------------------
  const track = await (async () => {
    const d = p.locator('[role="dialog"][aria-modal="true"]')
    if (await d.count()) return ((await d.getAttribute('aria-label')) || '').replace(/^Order /, '')
    return null
  })()
  const fresh = await browser.newContext()
  const anon = await fresh.newPage()
  const probe = track
    ? await anon.request.get(`${BASE}/api/invoice-file.php?id=${track}`)
    : null
  if (probe) {
    check(probe.status() === 401,
      'signed out, the same invoice URL is refused rather than served',
      String(probe.status()))
  }
  await fresh.close()
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the panel can now reach the invoice it always had')
process.exit(fails ? 1 : 0)
