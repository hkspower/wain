/**
 * The Shop rules card, driven in a real browser on the WEBSITE's /backends.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/rules-panel-test.mjs
 *
 * rules-test.mjs proves the SERVER honours the rules. This proves the owner can
 * actually reach them, which is a different question and the one this project
 * keeps getting wrong: the KNET editor, the footer editor, the theme editor and
 * the brand-logo uploader all began app-only, and "it is in /backends" was true
 * of a panel the owner does not open in a browser. A settings row nobody can
 * edit is a constant with extra steps.
 *
 * WHY A BROWSER AND NOT A FETCH. The card is an overlay: it finds the Settings
 * heading in a prebuilt bundle's rendered DOM and inserts itself after it. That
 * whole mechanism — the heading text, the observer, the panel swapping content
 * in place — exists only at runtime. A test that POSTs to admin.php would pass
 * on a shop where the card never appears at all, which is exactly the failure
 * being guarded against.
 *
 * WHAT IT HOLDS:
 *
 *   - the card appears on Settings AND NOWHERE ELSE. An overlay that forgets to
 *     remove itself leaves Shop rules sitting on the Orders screen.
 *   - it is drawn from the SERVER's `allowed`, so the chip count matches what
 *     admin.php offers rather than a list written in the JavaScript.
 *   - an edit made in the card reaches the PUBLIC API — the thing a customer's
 *     checkout reads. Reading the panel back would only prove the form kept its
 *     own value.
 *   - a refusal is shown as a SENTENCE. admin.php answers rule_size_in_use:XL(7);
 *     printing that token would make a careful error look like a crash.
 *   - a refusal does NOT discard what was typed. Reloading the form on failure
 *     is how an owner loses an edit and has to retype it under the message
 *     explaining why.
 *
 * It restores the defaults in a finally, like its sibling.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4300'
const API = BASE + '/api/api.php'
const ADMIN = BASE + '/api/admin.php'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

const publicRules = async () =>
  (await (await fetch(`${API}?r=slides`)).json()).rules

const DEFAULTS = {
  delivery_fee_fils: 1000, free_delivery_fils: 0, return_days: 14,
  cod_open_max: 3, review_reward_pct: 20, discount_max_pct: 60,
  governorates: ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra'],
  sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'],
  fits: ['normal', 'slim', 'loose', 'oversize', 'boxy', 'tank'],
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
const errors = []
// A refused save is a deliberate 400, and Chromium logs every 4xx as a console
// error. Counting those would make the rig fail for doing exactly what it came
// to do — so the network-status lines are excluded and real script errors are
// not. The distinction matters: "Failed to load resource" is the browser
// narrating an HTTP status this rig ASKED for; anything else is the card broken.
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (/Failed to load resource/i.test(m.text())) return
  errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

const gotoScreen = async (name) => {
  await page.getByText(name, { exact: true }).first().click()
  await page.waitForTimeout(900)
}

try {
  await page.goto(BASE + '/backends', { waitUntil: 'networkidle' })

  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw')
    await page.fill('input[type=password]', 'correct horse')
    await page.locator('form button, button').first().click()
    await page.waitForTimeout(1600)
  }
  check(!(await page.locator('input[type=password]').count()), 'signed in to the website panel')

  /* ------------------------------------------------- 1. it is on Settings -- */
  await gotoScreen('Settings')
  await page.waitForSelector('.srl', { timeout: 8000 })
  check(await page.locator('.srl').count() === 1, 'the Shop rules card is on Settings')

  const inputs = await page.locator('.srl input[data-rule]').count()
  const chips = await page.locator('.srl input[data-list]').count()
  check(inputs === 6, 'six numbers are editable', `found ${inputs}`)

  // From the server, not from a list in the JavaScript.
  const allowed = await (await fetch(`${ADMIN}?r=rules`, {
    headers: { 'X-Sporta-Admin': '1', Cookie: (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`).join('; ') },
  })).json()
  const wantChips = allowed.allowed.sizes.length + allowed.allowed.fits.length
    + allowed.allowed.governorates.length
  check(chips === wantChips,
    'every chip comes from the server’s own allowed lists', `card=${chips} server=${wantChips}`)

  /* ------------------------------------------ 2. and NOWHERE else --------- */
  await gotoScreen('Orders')
  check(await page.locator('.srl').count() === 0,
    'and it removes itself when the panel moves to another screen')
  await gotoScreen('Settings')
  await page.waitForSelector('.srl', { timeout: 8000 })

  /* ------------------------------------------ 3. an edit reaches the shop -- */
  await page.fill('.srl input[data-rule="delivery_fee_fils"]', '2.250')
  await page.fill('.srl input[data-rule="return_days"]', '21')
  await page.locator('.srl-save').click()
  await page.waitForFunction(
    () => (document.querySelector('.srl-note')?.textContent ?? '').includes('Saved'),
    null, { timeout: 8000 },
  ).catch(() => {})

  const after = await publicRules()
  check(after?.delivery_fee_fils === 2250,
    'a fee typed in KWD reaches the public API in fils', `got ${after?.delivery_fee_fils}`)
  check(after?.return_days === 21,
    'and so does the returns window', `got ${after?.return_days}`)

  /* ------------------------------------------ 4. a refusal reads as English */
  // Untick a size that has stock rows. The server refuses; the card must
  // explain rather than print rule_size_in_use:XL(42).
  await page.locator('.srl input[data-list="sizes"][data-value="XL"]').uncheck()
  await page.locator('.srl-save').click()
  await page.waitForTimeout(1200)

  const note = (await page.locator('.srl-note').first().textContent()) ?? ''
  check(note.length > 0 && !note.includes('rule_size_in_use'),
    'a refusal is shown as a sentence, not as an error token', JSON.stringify(note))
  check(/stock rows/i.test(note),
    'and it says WHY, naming the stock that blocks it', JSON.stringify(note))

  // The edit survives the refusal — the box is still unticked, so the owner can
  // correct it rather than retype it.
  const stillOff = await page.locator('.srl input[data-list="sizes"][data-value="XL"]').isChecked()
  check(stillOff === false, 'the refused edit is still in the form, not discarded')

  // And nothing was written: the shop still offers XL.
  const unchanged = await publicRules()
  check(unchanged?.sizes?.includes('XL'),
    'and the shop is unchanged — a refused save writes nothing')

  check(errors.length === 0, 'the card logged no console errors', errors.slice(0, 3).join(' | '))
} finally {
  await fetch(`${ADMIN}?r=settings_save`, {
    method: 'POST',
    headers: {
      'X-Sporta-Admin': '1', 'Content-Type': 'application/json',
      Cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; '),
    },
    body: JSON.stringify({ name: 'rules', value: DEFAULTS }),
  }).catch(() => {})
  const restored = await publicRules().catch(() => null)
  check(restored?.delivery_fee_fils === DEFAULTS.delivery_fee_fils && restored?.return_days === 14,
    'the defaults were restored for the next rig', JSON.stringify(restored))
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the owner can reach every rule, and a refusal explains itself')
process.exit(fails ? 1 : 0)
