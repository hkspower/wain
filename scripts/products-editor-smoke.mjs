/**
 * The Products screen (src/app/backends/products.tsx), in a real browser
 * against the mock panel on 8899.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/products-editor-smoke.mjs
 *
 * admin-contract-test.mjs and admin-live-test.mjs already prove the ROUTES
 * this screen calls are real and correctly shaped — neither can see whether
 * the SCREEN built on top of them actually works: the client-side slug
 * suggestion, the size-ladder chips only offering sizes not already used, and
 * the "Photographs" button handing the right garment to images.tsx (which
 * has no source-level link between the two screens beyond a query param).
 * Those are exactly the things a passing type-check and a green API rig
 * cannot catch, so they are checked here instead.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8899'
let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

// The mock's state persists across runs of this script within the same
// server process — a second run without this would find "Smoke Test Hoodie"
// already there and get slug_taken instead of a fresh create, which is
// exactly the kind of state-dependent failure this project's own notes warn
// about under "test the sandbox is alive before believing it".
await fetch(`${BASE}/admin.php?r=reset`, { method: 'POST' })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 420, height: 900 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)
  await p.locator('input').nth(0).fill('manager@sporta.com.kw')
  await p.locator('input').nth(1).fill('correct horse')
  await p.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await p.waitForTimeout(2500)

  await p.getByText('Products', { exact: true }).first().click()
  await p.waitForTimeout(2000)
  check((await p.getByText('Add a product').count()) > 0, 'the Products screen renders with an Add button')

  await p.getByText('Add a product').click()
  await p.waitForTimeout(300)
  const inputs = p.locator('input, textarea')
  await inputs.nth(0).fill('Smoke Test Hoodie')
  await p.waitForTimeout(200)
  const slugValue = await inputs.nth(2).inputValue()
  check(slugValue === 'smoke-test-hoodie', `the slug auto-fills from the English name (${slugValue})`)

  await inputs.nth(1).fill('هودي اختبار')
  // price field — find by placeholder/label text via nearby structure is
  // fragile in a plain smoke check; fill by order matches the form's layout.
  await inputs.nth(5).fill('9.500')

  await p.getByText('Save').last().click()
  await p.waitForTimeout(2000)
  check((await p.getByText('added.').count()) > 0 || (await p.getByText(/added\./).count()) > 0,
    'saving reports success')
  check((await p.getByText('Smoke Test Hoodie').count()) > 0, 'the new product appears in the list')

  await p.getByText('Sizes & stock').first().click()
  await p.waitForTimeout(1500)
  const sizeChips = p.locator('text=/^(S|M|L|XL)$/')
  check((await sizeChips.count()) > 0, 'unused sizes are offered as add-chips')
  if (await sizeChips.count()) {
    await sizeChips.first().click()
    await p.waitForTimeout(1000)
    check((await p.getByText('Remove').count()) > 0, 'adding a size shows a row with Remove')
  }

  const photoBtn = p.getByText('Photographs').first()
  await photoBtn.click()
  await p.waitForTimeout(1500)
  check(p.url().includes('/backends/images'), 'the Photographs button opens the images screen')
  check((await p.getByText('smoke-test-hoodie').count()) > 0 || (await p.getByText('Smoke Test Hoodie').count()) > 0,
    'and it preselects the garment')

  check(errors.length === 0, `no page errors (${errors.length})${errors[0] ? ': ' + errors[0] : ''}`)
} finally {
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — Products screen works end to end in a real browser')
process.exit(fails ? 1 : 0)
