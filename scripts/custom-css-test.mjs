/**
 * The Extra CSS box: does it reach the shop, and can it lock you out?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/custom-css-test.mjs
 *
 * THE SECOND QUESTION IS THE IMPORTANT ONE. Every other theme field has a shape
 * the server checks; this one is arbitrary CSS and can hide anything — so the
 * safety is structural, not validating: assets/theme.js does not apply it on
 * /backends. The rig proves that by saving a rule that hides EVERYTHING and
 * then checking the panel is still usable, which is the only way to know the
 * way back exists.
 *
 * WHAT IT ASSERTS:
 *
 *   1. The box appears on Settings and on no other screen.
 *   2. What it saves reaches the STOREFRONT — a real element's computed style
 *      changes, not merely a <style> tag appearing.
 *   3. The same CSS does NOT apply on /backends, with `display:none` on
 *      everything: the panel still renders and the box is still on screen.
 *   4. Saving does not blank the rest of the theme. settings_save replaces the
 *      row, so a partial object would silently wipe the brand colour and the
 *      fonts — the most damaging thing this feature could do, and invisible on
 *      the screen that did it.
 *   5. Clearing it restores the shop exactly.
 *   6. The server refuses `</`, which is the one sequence that could end the
 *      <style> element.
 *
 * It writes to the sandbox database and puts the theme row back as it found it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

const themeRow = () => sql("select value from settings where name='theme'")
const before = themeRow()

// A brand colour to save ALONGSIDE the css, so assertion 4 has something to
// lose. Chosen, not read back from the code that would also be wrong.
const BRAND = '#0a7d5a'
const MARK = 'letter-spacing: 4.25px'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

const signIn = async () => {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await p.waitForTimeout(2500)
}

const openSettings = async () => {
  await p.getByText('Settings', { exact: true }).first().click()
  await p.waitForTimeout(2500)
}

/** Type into the box and press Save, then wait for the round trip. */
const saveCss = async (css) => {
  const box = p.locator('.scc-box')
  await box.fill(css)
  await p.locator('.scc-go').click()
  await p.waitForTimeout(3500)
  return (await p.locator('.scc-note').innerText().catch(() => '')).trim()
}

try {
  // Seed a brand colour through the app's own route so assertion 4 is real.
  sql("insert into settings (name, value) values ('theme', '"
    + JSON.stringify({ brand: BRAND }).replace(/'/g, "''")
    + "') on duplicate key update value = values(value)")

  await signIn()

  // --- 1. the right screen ------------------------------------------------
  check((await p.locator('.scc').count()) === 0, 'the box is absent on Overview')
  await p.getByText('Brands', { exact: true }).first().click()
  await p.waitForTimeout(1800)
  check((await p.locator('.scc').count()) === 0, 'and absent on Brands')

  await openSettings()
  check((await p.locator('.scc').count()) === 1, 'and present exactly once on Settings')

  /** How much of the panel is actually painted. Used as the BASELINE for the
   *  lock-out assertion below: a fixed threshold cannot tell "unharmed" from
   *  "half hidden", and `* { display:none !important }` measured 92 visible
   *  elements against 204 — enough to pass any number picked in advance. */
  const visible = () => p.evaluate(() =>
    [...document.querySelectorAll('body *')].filter((e) => e.offsetParent !== null).length)

  // --- 2. it reaches the storefront ---------------------------------------
  const note = await saveCss(`.app-header { ${MARK}; }`)
  check(/Saved/.test(note), 'saving reports success', note.slice(0, 70))

  const shop = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await shop.waitForTimeout(2500)
  const spacing = await shop.evaluate(() => {
    const h = document.querySelector('.app-header')
    return h ? getComputedStyle(h).letterSpacing : '(no header)'
  })
  check(spacing === '4.25px', 'and the storefront actually applies it', `letter-spacing=${spacing}`)

  // --- 4. the rest of the theme survived ----------------------------------
  const savedBrand = JSON.parse(themeRow() || '{}').brand
  check(savedBrand === BRAND, 'the brand colour was not blanked by the save', `brand=${savedBrand || '(gone)'}`)

  // --- 3. the panel is immune ---------------------------------------------
  //
  // MEASURED BEFORE ANYTHING IS CLICKED. The first version of this called
  // openSettings() first, and when the exclusion was removed as a mutation the
  // click timed out on an invisible tab — the rig died with a stack trace
  // instead of failing, and a grep for FAIL found nothing. A rig that crashes
  // where it should fail hides its own result, and this is the assertion the
  // whole feature's safety rests on.
  // THE BASELINE IS TAKEN ON THE SCREEN THE RELOAD LANDS ON, and that is the
  // whole correction here. It used to be measured on SETTINGS — 273 painted
  // elements — and then compared against a post-reload measurement, but a
  // reload of /backends returns to OVERVIEW, which is a smaller screen. The rig
  // reported `204 of 273` and read as "the hostile CSS hid a quarter of the
  // panel"; the truth was that it had measured two different pages. The
  // comment two paragraphs down still said "MEASURED BEFORE ANYTHING IS
  // CLICKED", which had stopped being true of the code beneath it — and the
  // author's own note above records 204 as the HEALTHY number against a
  // poisoned 92, which is Overview both times.
  //
  // So: reload first, measure there, then poison and reload again. Like for
  // like, with no assumption about which screen a reload chooses.
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)
  const baseline = await visible()
  // A baseline of nothing would make any comparison below pass. Assert it
  // found a panel before trusting the ratio it feeds.
  check(baseline > 50, 'the panel was actually painted before poisoning it', `${baseline} elements`)

  await openSettings()
  await saveCss('* { display: none !important; }')
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)

  // VISIBLE elements, not innerText. innerText came back at 1033 characters
  // with the mutation applied and everything display:none — the text is in the
  // DOM whether or not anything is painted, so that assertion passed while the
  // panel was invisible. offsetParent is null for a display:none element and
  // for every child of one, which is the question actually being asked.
  const alive = await visible()
  check(alive >= baseline * 0.9,
    'with `* { display:none }` saved, the panel is as visible as before',
    `${alive} of ${baseline} elements painted`)

  const reachable = await p.getByText('Settings', { exact: true }).first()
    .click({ timeout: 8000 }).then(() => true, () => false)
  check(reachable, 'and Settings can still be opened')
  await p.waitForTimeout(2500)
  check((await p.locator('.scc-box').count()) === 1, 'and the box that clears it is still there')

  // …while the shop obeys it, which is what makes the previous two assertions
  // about the EXCLUSION rather than about the CSS never having applied.
  await shop.reload({ waitUntil: 'networkidle' })
  await shop.waitForTimeout(2500)
  const hidden = await shop.evaluate(() => {
    const h = document.querySelector('.app-header')
    return h ? getComputedStyle(h).display : '(no header)'
  })
  check(hidden === 'none', 'and the shop does obey it', `header display=${hidden}`)

  // --- 5. clearing is the way back ----------------------------------------
  await p.locator('.scc-chip', { hasText: 'Clear' }).click()
  await p.waitForTimeout(3500)
  await shop.reload({ waitUntil: 'networkidle' })
  await shop.waitForTimeout(2500)
  const restored = await shop.evaluate(() => {
    const h = document.querySelector('.app-header')
    return h ? getComputedStyle(h).display : '(no header)'
  })
  check(restored !== 'none' && restored !== '(no header)', 'clearing restores the shop', `header display=${restored}`)
  check(JSON.parse(themeRow() || '{}').brand === BRAND, 'and the brand colour is still there')

  // --- 6. the one sequence that must be refused ---------------------------
  //
  // TWICE, on purpose. The box complains before the round trip, which is the
  // nicer failure — but a check that only proves the box complains proves
  // nothing about the server, and the box is the half that could be bypassed
  // by anyone posting to the route directly. So the first assertion is the
  // BROWSER's and the second goes straight at admin.php.
  const refused = await saveCss('a { color: red } </style><script>alert(1)</script>')
  check(/<\//.test(refused) || /refuse/i.test(refused),
    'the box refuses `</` before sending it', refused.slice(0, 80))

  const direct = await p.evaluate(async () => {
    const r = await fetch('/api/admin.php?r=settings_save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: JSON.stringify({ name: 'theme', value: { css: 'a{} </style><b>' } }),
    })
    const d = await r.json().catch(() => null)
    return { status: r.status, error: (d && d.error) || '' }
  })
  check(direct.error === 'invalid_theme_css_has_markup' || /css_has_markup/.test(direct.error),
    'and admin.php refuses it when the box is bypassed',
    `${direct.status} ${direct.error || '(no error — it was ACCEPTED)'}`)
  check(!JSON.parse(themeRow() || '{}').css, 'so nothing was stored from either attempt')

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
  await shop.close()
} finally {
  if (before) {
    sql("update settings set value = '" + before.replace(/'/g, "''") + "' where name='theme'")
  } else {
    sql("delete from settings where name='theme'")
  }
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — it reaches the shop, and it cannot lock you out of the panel')
process.exit(fails ? 1 : 0)
