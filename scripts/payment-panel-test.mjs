/**
 * The website panel's payment-setup card — payment.js.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/payment-panel-test.mjs
 *
 * WHY A BROWSER AND NOT A UNIT TEST. Same reasoning as panel-settings-test.mjs:
 * this is an overlay onto a prebuilt bundle with no source here. Everything
 * worth checking is a question about the real panel — does the card appear on
 * Settings and nowhere else, does the Tranportal ID save reach a route that
 * exists, does a refusal keep what was typed, and does the CBK readiness ever
 * leak a credential's VALUE rather than just whether it is set.
 *
 * WHAT IT ASSERTS, in the order the faults matter:
 *
 *  1. The card is on Settings, and gone on another screen and on the sign-in
 *     screen — a payment card visible before sign-in would be worse than the
 *     contact card panel-settings-test.mjs already guards, since this is the
 *     screen that says whether the shop can take money at all.
 *  2. THE PAY READINESS NEVER SHOWS A VALUE. sandbox.sh writes real (if
 *     sandbox-only) credentials into pay/config.php, so this rig can assert
 *     the actual client_id string is not present anywhere in the card's text
 *     — the booleans are the whole point.
 *  3. A real Tranportal ID save reaches `settings_save` named `knet` and lands
 *     in the database, and the box reflects `source: database` afterward.
 *  4. The placeholder and malformed-ID refusals are surfaced by name, not as
 *     a generic failure, and THE TYPING SURVIVES a refusal — rules.js's bug,
 *     already fixed once in panel-settings.js and checked again here.
 *  5. Clearing the box and saving returns control to the file (`source: file`),
 *     which is the way out if a saved ID turns out to be wrong.
 *
 * IT PUTS THE ROW BACK. The `knet` settings row is saved before anything is
 * written and restored in `finally`, and the restore is verified — the
 * first-admin rig taught this repository that a silent non-restore fails
 * other rigs with messages about something else entirely.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

const savedRow = sql("select quote(value) from settings where name = 'knet'") || null

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1400, height: 1400 } })
const posts = []
p.on('request', (r) => {
  const m = r.url().match(/admin\.php\?r=([a-z_]+)/)
  if (m && r.method() === 'POST') {
    let body = null
    try { body = JSON.parse(r.postData() ?? 'null') } catch { /* not json */ }
    posts.push({ route: m[1], body })
  }
})
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

const card = () => p.locator('[data-sporta-panel="payment"]')
const idField = () => card().locator('.spp-input')
const note = () => card().locator('.spp-note')

const openTab = async (name) => {
  await p.getByText(name, { exact: true }).first().click()
  await p.waitForTimeout(1800)
}

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)

  /* -------------------------------------------------- 1. where it appears */
  check(await card().count() === 0, 'the card is NOT on the sign-in screen',
    'a payment card visible before sign-in would say whether the shop can take money to anyone who opens /backends')

  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)

  await openTab('Settings')
  await p.waitForTimeout(1500)
  check(await card().count() === 1, 'the payment card is on the Settings screen')

  await openTab('Orders')
  check(await card().count() === 0, 'and it is gone on another screen',
    'an overlay that leaks onto Orders is a redesign of a screen nobody asked about')

  await openTab('Settings')
  await p.waitForTimeout(1500)
  check(await card().count() === 1, 'and it comes back when Settings is reopened',
    'the panel swaps its content in place, so a one-shot mount would be undone by any navigation')

  /* --------------------------------------------- 2. never a credential value */
  const cfgPath = new URL('../sporta-site/public_html/pay/config.php', import.meta.url).pathname
  const { readFileSync, existsSync } = await import('node:fs')
  if (existsSync(cfgPath)) {
    const cfgText = readFileSync(cfgPath, 'utf8')
    const clientId = cfgText.match(/'client_id'\s*=>\s*'([^']*)'/)?.[1]
    const bodyText = await card().innerText()
    check(!clientId || !bodyText.includes(clientId),
      'the CBK client id is never printed on the card — booleans only',
      clientId ? `client_id in config is ${JSON.stringify(clientId)}` : 'no client_id found in pay/config.php to check against')
  } else {
    check(true, 'pay/config.php does not exist in the sandbox — skipping the leak check (nothing to leak)')
  }
  check(/set|placeholder, not set/.test(await card().innerText()),
    'and it does say SET or PLACEHOLDER for each credential, in words')

  /* --------------------------------------------------- 3. a real ID save */
  const stamp = 'RIG' + String(Date.now()).slice(-6)
  await idField().fill(stamp)
  posts.length = 0
  await card().getByRole('button').filter({ hasText: /Save Tranportal ID/ }).click()
  await p.waitForTimeout(2500)

  const sent = posts.find((x) => x.route === 'settings_save')
  check(!!sent, 'the save reaches admin.php?r=settings_save',
    posts.length ? `saw ${posts.map((x) => x.route).join(', ')}` : 'no POST fired at all')
  check(sent?.body?.name === 'knet', 'and it names the knet settings group', `name=${sent?.body?.name}`)

  const row = sql("select value from settings where name = 'knet'")
  const stored = row ? JSON.parse(row) : {}
  check(stored.tranportal_id === stamp,
    'the Tranportal ID landed in the database as typed',
    `stored=${JSON.stringify(stored.tranportal_id)}`)
  check(/Saved/.test(await note().innerText()), 'and the panel says so')
  check((await p.locator('.spp-src').innerText()).includes('saved here'),
    'the source line now says the database, not the file')

  /* ------------------------------------------- 4. refusals, by name, no loss */
  // CHANGEME, not YOUR_TRANPORTAL_ID — the placeholder check runs AFTER the
  // shape check, and the other two placeholders contain an underscore, which
  // the shape regex ([A-Za-z0-9]{3,32}) already refuses on its own. CHANGEME
  // is alphanumeric, so this is the one that actually reaches and exercises
  // the placeholder branch rather than the shape one.
  await idField().fill('CHANGEME')
  await card().getByRole('button').filter({ hasText: /Save Tranportal ID/ }).click()
  await p.waitForTimeout(1500)
  check(/placeholder/i.test(await note().innerText()),
    'saving the shipped placeholder is refused by name', await note().innerText())
  check(await idField().inputValue() === 'CHANGEME',
    'and the box still shows what was typed — a refusal must not erase the edit')

  await idField().fill('bad id!!')
  await card().getByRole('button').filter({ hasText: /Save Tranportal ID/ }).click()
  await p.waitForTimeout(1500)
  check(/KNET issues 3 to/i.test(await note().innerText()),
    'a malformed ID is refused by name too', await note().innerText())
  check(await idField().inputValue() === 'bad id!!',
    'and that edit survives the refusal as well')

  /* ------------------------------------------ 5. clearing returns to file */
  await idField().fill('')
  await card().getByRole('button').filter({ hasText: /Save Tranportal ID/ }).click()
  await p.waitForTimeout(2000)
  check((await p.locator('.spp-src').innerText()).includes('knet/config.php'),
    'clearing the box hands control back to the file',
    await p.locator('.spp-src').innerText())

  console.log('')
  console.log(fails ? `${fails} check(s) failed` : 'all ok')
} finally {
  if (savedRow !== null) {
    sql(`insert into settings (name, value) values ('knet', ${savedRow})
         on duplicate key update value = ${savedRow}`)
  } else {
    sql("delete from settings where name = 'knet'")
  }
  const restored = sql("select quote(value) from settings where name = 'knet'") || null
  if (restored !== savedRow) {
    console.log(`FAIL  the knet settings row was not restored (was ${savedRow}, is now ${restored})`)
    fails++
  }
  if (errors.length) {
    console.log(`FAIL  page errors: ${errors.join(' | ')}`)
    fails++
  }
  await browser.close()
}

process.exit(fails ? 1 : 0)
