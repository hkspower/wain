/**
 * The website panel's contact-details card, and the two paragraphs it repairs.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/panel-settings-test.mjs
 *
 * WHY A BROWSER AND NOT A UNIT TEST. This is an overlay onto a prebuilt bundle
 * with no source here. Everything that can go wrong about it is a question
 * about the real panel: does the card appear on Settings and NOWHERE ELSE, does
 * it find the screen after the panel re-renders, does the save reach a server
 * route that exists, and does the value survive the round trip in the spelling
 * the server chose. None of that can be asked of the file.
 *
 * WHAT IT ASSERTS, in the order the faults matter:
 *
 *  1. The card is on Settings, and is GONE on another screen. An overlay that
 *     leaks onto Orders is a redesign of a screen nobody asked about.
 *  2. A real save reaches `settings_save` and lands in MariaDB. Checked against
 *     the DATABASE, not against the form: a card that shows what you typed
 *     because it is showing what you typed proves nothing.
 *  3. THE SERVER'S NORMALISATION IS WHAT THE BOX SHOWS. `+965 2209 1914` typed
 *     into WhatsApp is stored as 96522091914, and an Instagram handle loses its
 *     @. If the card kept displaying the typed text, the owner would believe
 *     something other than what the shop will use.
 *  4. A REFUSAL KEEPS THE TYPING. rules.js carried a comment claiming exactly
 *     this while render() rebuilt every field from state, so the rejected edit
 *     vanished under the message explaining the rejection. Asserted here
 *     against a deliberately bad email.
 *  5. `phone_e164` NEVER TRAVELS BACK. api.php computes it from `phone`;
 *     echoing it into a save would store a derived field as though it were
 *     typed. Checked on the wire, in the POST body itself.
 *  6. Neither repaired paragraph still names a file this server does not have.
 *
 * IT PUTS THE ROW BACK. The `contact` settings row is saved before anything is
 * written and restored in `finally`, and the restore is VERIFIED — the
 * first-admin rig taught this repository that a restore which silently does not
 * happen fails other rigs with messages about something else entirely.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

// ZERO ROWS AND A NULL VALUE ARE NOT THE SAME, and neither is 'NULL' the
// string. A shop that has never opened this screen has no contact row at all,
// which is the commonest state and the one the first run met: the query
// returned '' and the restore built `values ('contact', )`.
const savedRow = sql("select quote(value) from settings where name = 'contact'") || null

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

const card = () => p.locator('[data-sporta-panel="contact"]')
const field = (i) => card().locator('input').nth(i)   // order is FIELDS in the overlay
const IDX = { phone: 0, whatsapp: 1, email: 2, instagram: 3 }

const openTab = async (name) => {
  await p.getByText(name, { exact: true }).first().click()
  await p.waitForTimeout(1800)
}

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)

  // BEFORE SIGNING IN. The sign-in screen is the one place a mis-scoped
  // overlay is unambiguous — there is no navigation to confuse and nothing
  // else on the page — and it is the worst place for this card to appear,
  // since it would offer the shop's contact details to anyone who loads
  // /backends. Asserted first because the checks below navigate, and a card
  // that mounts everywhere breaks THEM rather than failing by name.
  check(await card().count() === 0, 'the card is NOT on the sign-in screen',
    'it would be offering the shop\'s details to anyone who opens /backends')

  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)

  /* ------------------------------------------------ 1. where it appears */
  await openTab('Settings')
  await p.waitForTimeout(1500)
  check(await card().count() === 1, 'the contact card is on the Settings screen')

  await openTab('Orders')
  check(await card().count() === 0, 'and it is gone on another screen',
    'an overlay that leaks onto Orders is a redesign of a screen nobody asked about')

  await openTab('Settings')
  await p.waitForTimeout(1500)
  check(await card().count() === 1, 'and it comes back when Settings is reopened',
    'the panel swaps its content in place, so a one-shot mount would be undone by any navigation')

  /* ------------------------------------- 6. the two repaired paragraphs */
  {
    const txt = await p.locator('body').innerText()
    check(!/run\s+api\/setup-admin\.php\s+again/i.test(txt),
      'the password instruction no longer tells you to run a file that is not there',
      'api/setup-admin.php is on live-file-check.php\'s $MUSTNOT list')
    check(/sign-in screen then offers to create the first account/i.test(txt),
      'and it names the way in that actually exists')
    check(!/Upload new ones into/i.test(txt),
      'the photo instruction no longer sends you to File Manager')
    check(/Upload them on\s+the Catalogue tab|Upload them on the Catalogue tab/i.test(txt),
      'and it names the tab that actually uploads a photo')
  }

  /* --------------------------------------------- 2 + 3 + 5. a real save */
  const stamp = String(Date.now()).slice(-6)
  await field(IDX.phone).fill(`+965 2209 ${stamp.slice(-4)}`)
  await field(IDX.whatsapp).fill('+965 2209 1914')       // spaces and a plus
  await field(IDX.email).fill('rig@sporta.com.kw')
  await field(IDX.instagram).fill('@sporta.rig')          // the @ must be stripped
  posts.length = 0
  await card().getByRole('button').filter({ hasText: /Save contact details/ }).click()
  await p.waitForTimeout(3000)

  const sent = posts.find((x) => x.route === 'settings_save')
  check(!!sent, 'the save reaches admin.php?r=settings_save',
    posts.length ? `saw ${posts.map((x) => x.route).join(', ')}` : 'no POST fired at all')
  check(sent?.body?.name === 'contact', 'and it names the contact settings group',
    `name=${sent?.body?.name}`)
  check(sent && !('phone_e164' in (sent.body?.value ?? {})),
    'phone_e164 is NOT sent back — it is computed by api.php from phone',
    'echoing a derived field stores it as though somebody had typed it')

  const row = sql("select value from settings where name = 'contact'")
  const stored = row ? JSON.parse(row) : {}
  check(stored.phone === `+965 2209 ${stamp.slice(-4)}`,
    'the phone landed in the database as typed, spaces and all',
    `stored=${JSON.stringify(stored.phone)}`)
  check(stored.whatsapp === '96522091914',
    'and the WhatsApp number was normalised by the server',
    `stored=${JSON.stringify(stored.whatsapp)}`)
  check(stored.instagram === 'sporta.rig',
    'and the Instagram @ was stripped',
    `stored=${JSON.stringify(stored.instagram)}`)

  // The BOX must show what was stored, not what was typed.
  check(await field(IDX.whatsapp).inputValue() === '96522091914',
    'the box shows the spelling the SERVER kept, not the one that was typed',
    `showing ${JSON.stringify(await field(IDX.whatsapp).inputValue())}`)

  /* --- THE SHIPPED DEFAULT MUST SAVE. This is the bug that was found here. ---
     settings_save validated the shop's own WhatsApp with store_phone(), the
     CHECKOUT's validator, which requires ^[569]\d{7}$ — a Kuwaiti MOBILE,
     because a customer who mistypes their number is a delivery nobody can
     chase. STORE_SETTING_DEFAULTS ships 96522091914, a landline starting 2. So
     the route refused the one value every shop starts with: an owner who opened
     the contact editor and pressed Save without touching anything was told
     invalid_whatsapp, with no way to work out why.

     THE DEFAULT IS READ OUT OF store.php rather than written here. A number
     copied into this rig is a second home for it, and it would go on passing on
     the day somebody changed the shipped one. */
  {
    const php = readFileSync(
      new URL('../sporta-site/public_html/api/store.php', import.meta.url).pathname, 'utf8')
    const block = php.slice(php.indexOf("'contact'   => ["))
    const shipped = block.slice(0, block.indexOf(']')).match(/'whatsapp'\s*=>\s*'([^']*)'/)?.[1]
    check(!!shipped && /^\d{8,15}$/.test(shipped),
      `the shipped WhatsApp default was found in store.php (${shipped ?? 'NOT FOUND'})`,
      shipped ? '' : 'nothing below this is a measurement')

    await field(IDX.whatsapp).fill(shipped ?? '')
    await card().getByRole('button').filter({ hasText: /Save contact details/ }).click()
    await p.waitForTimeout(2500)
    const n = await card().locator('.spc-note').innerText()
    check(/Saved/.test(n), 'and the shop can save the number it ships with', n.slice(0, 80))
  }

  /* ------------------------------------------- 4. a refusal keeps the typing */
  await field(IDX.email).fill('not-an-email')
  await field(IDX.phone).fill('EDIT THAT MUST SURVIVE')
  await card().getByRole('button').filter({ hasText: /Save contact details/ }).click()
  await p.waitForTimeout(2500)

  const noteText = await card().locator('.spc-note').innerText()
  check(/not one the shop can send to/i.test(noteText),
    'a bad email is refused with a sentence, not a token', noteText.slice(0, 60))
  check(await field(IDX.phone).inputValue() === 'EDIT THAT MUST SURVIVE',
    'AND THE OTHER EDIT SURVIVES THE REFUSAL',
    'a form that rebuilds from state loses the edit under the message explaining why it was refused')
  const afterBad = JSON.parse(sql("select value from settings where name = 'contact'") || '{}')
  check(afterBad.email === 'rig@sporta.com.kw',
    'and nothing was written — the refused save changed no row',
    `stored=${JSON.stringify(afterBad.email)}`)

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' ;; '))
} finally {
  if (savedRow === null) sql("delete from settings where name = 'contact'")
  else sql(`insert into settings (name, value) values ('contact', ${savedRow})
            on duplicate key update value = values(value)`)
  const back = sql("select quote(value) from settings where name = 'contact'") || null
  if (back !== savedRow) {
    fails++
    console.log('FAIL the contact settings row was NOT restored — the shop is left with this rig\'s values')
  }
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the contact card writes, normalises and keeps a refused edit')
process.exit(fails ? 1 : 0)
