/**
 * The Settings screen's one save button.
 *
 *   npm run test:save-bar          (needs bash scripts/sandbox.sh)
 *
 * WHAT IT IS REALLY GUARDING. Not "a bar appears" — that is the easy half and
 * it would pass on a bar that saved the whole screen. The property that
 * matters is that pressing it writes ONLY the cards something was typed into.
 * CLAUDE.md records why: the rules card reads through its own route rather
 * than saving an empty body, because "a panel opened and closed would look in
 * any audit like a deliberate change". A bar that pressed all eight saves
 * would rewrite every settings row and activity-log.js would record eight
 * edits that nobody made. So the rig watches the POSTS, and asserts both
 * directions — the touched card's route fires, and the untouched ones do not.
 *
 * IT ASSERTS IT FOUND THINGS BEFORE IT JUDGES THEM. This repository has twice
 * shipped a check that reported success by finding nothing — a route extractor
 * whose character class dropped a name, and a suite that found 0 controls on a
 * dead sandbox. The bar discovers its cards from the page, so a discovery that
 * silently returns an empty list would make every assertion below vacuous:
 * nothing dirty, nothing saved, no stray POSTs, all green. The count is
 * checked first, and it is checked against a floor rather than an exact number
 * so that adding a card to Settings does not fail this rig for no reason.
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

// Restore whatever the shop really had. The rig types into the contact card,
// which writes a real settings row — and a rig that leaves its own fixture
// behind is how db-audit came to report "1 order is paid with no paid_at"
// about another rig's leftovers.
const savedContact = sql("select quote(value) from settings where name = 'contact'") || null

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })

// THE ROUTE NAME IS NOT ENOUGH, and the first version of this rig learned it
// the hard way: SIX of the seven cards POST to the same `settings_save`, and
// which settings ROW they write is a `name` in the body. So a stray-write
// check written against route names watched for routes that never appear —
// both halves of the comparison shared a term, the AND between them meant
// nothing, and the mutation that made the bar press all eight buttons went
// green while the bar itself reported "Saved 8 cards". The row name is the
// only thing that tells these writes apart.
const posts = []
p.on('request', (r) => {
  const m = r.url().match(/admin\.php\?r=([a-z_]+)/)
  if (!m || r.method() !== 'POST') return
  let name = null
  try { name = (JSON.parse(r.postData() ?? 'null') ?? {}).name ?? null } catch { /* not json */ }
  posts.push({ route: m[1], name })
})
const written = () => [...new Set(posts.map((x) => x.name ?? x.route))].sort()
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

const bar = () => p.locator('[data-sporta-savebar]').first()
const barText = async () => (await bar().count()) ? (await bar().innerText()).replace(/\s+/g, ' ').trim() : ''
const barShown = async () => (await bar().count()) > 0 && await bar().isVisible()

const openTab = async (name) => {
  await p.getByText(name, { exact: true }).first().click()
  await p.waitForTimeout(1800)
}

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)

  /* ------------------------------------------- 1. never on the sign-in screen */
  check(!(await barShown()), 'the bar is not on the sign-in screen',
    'a bar offering to save something to a signed-out visitor is absurd and would be the first thing seen')

  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)

  await openTab('Settings')
  await p.waitForTimeout(2500)

  /* ----------------------------------------------- 2. it found the cards */
  const found = await p.evaluate(() => {
    const host = document.querySelector('.admin-content')
    if (!host) return { n: 0, labels: [] }
    const bs = [...host.querySelectorAll('button')].filter((b) => {
      if (b.hasAttribute('data-sporta-savebar')) return false
      if (b.offsetParent === null) return false
      const t = b.textContent.trim().toLowerCase()
      return t.indexOf('save') === 0 && t.indexOf('saved') !== 0
    })
    return { n: bs.length, labels: bs.map((b) => b.textContent.trim()) }
  })
  check(found.n >= 5, `the Settings screen really does carry several save buttons (${found.n})`,
    found.labels.join(' | '))
  if (found.n === 0) throw new Error('nothing to test — every check below would pass vacuously')

  /* ------------------------------ 3. nothing typed yet, so no bar to press */
  check(!(await barShown()), 'with nothing edited the bar stays out of the way',
    'a bar that is always there is a permanent offer to rewrite rows nobody touched')

  /* ---------------------------------------- 4. one edit names one card */
  const phone = p.locator('[data-sporta-panel="contact"] input').nth(0)
  const wasPhone = await phone.inputValue()
  const stamp = String(Date.now()).slice(-4)
  await phone.fill(`+965 2209 ${stamp}`)
  await p.waitForTimeout(400)

  check(await barShown(), 'typing into one card brings the bar up')
  const t1 = await barText()
  check(/contact/i.test(t1), 'and it names the card that was edited', t1)
  check(!/\b[2-9] cards\b/.test(t1), 'and does not claim cards nobody touched', t1)

  /* ------------------------- 5. THE ONE THAT MATTERS: it saves only that card */
  posts.length = 0
  await bar().locator('button').first().click()
  await p.waitForTimeout(3500)

  const wrote = written()
  check(wrote.includes('contact'), 'pressing it saves the card that was edited',
    wrote.join(',') || '(no POST at all)')
  // EVERY OTHER ROW IS A STRAY, stated that way round on purpose. Listing the
  // rows that must not be written would go stale the day a card is added to
  // Settings, and would then report a real regression as a pass — so the
  // invariant is "nothing but contact", which stays true however many cards
  // this screen grows.
  const strays = wrote.filter((n) => n !== 'contact')
  check(strays.length === 0, 'and writes nothing for the cards nobody touched',
    strays.length ? `STRAY WRITES: ${strays.join(',')}` : `rows written: ${wrote.join(',') || 'none'}`)
  check(posts.length === 1, 'exactly one write left the browser',
    `${posts.length} POST(s): ${posts.map((x) => x.name ?? x.route).join(',')}`)

  await p.waitForTimeout(3000)
  check(!(await barShown()), 'and then it goes away again', await barText())

  /* ------------------ 6. a card's own button still clears the bar by itself */
  await phone.fill(`+965 2209 ${stamp}`)
  await p.waitForTimeout(400)
  check(await barShown(), 'editing again brings it back')
  await p.locator('[data-sporta-panel="contact"] button').filter({ hasText: /^Save/ }).first().click()
  await p.waitForTimeout(3000)
  check(!(await barShown()), 'pressing a card\'s OWN save clears the bar too',
    'otherwise it goes on offering to save something already saved')

  /* --------------------------------------- 7. it belongs to Settings alone */
  await phone.fill(`+965 2209 ${stamp}`)
  await p.waitForTimeout(400)
  await openTab('Orders')
  await p.waitForTimeout(1200)
  check(!(await barShown()), 'it is gone on another screen',
    'a fixed bar that outlives its screen is a redesign of a screen nobody asked about')

  /* ---------------------------------------------- 8. nothing threw */
  check(errors.length === 0, 'no page errors', errors.join(' | '))

  // Put the phone number back the way it was, through the shop's own UI.
  await openTab('Settings')
  await p.waitForTimeout(2000)
  if (await p.locator('[data-sporta-panel="contact"] input').count()) {
    await p.locator('[data-sporta-panel="contact"] input').nth(0).fill(wasPhone)
    await p.locator('[data-sporta-panel="contact"] button').filter({ hasText: /^Save/ }).first().click()
    await p.waitForTimeout(2000)
  }
} finally {
  await browser.close()
  // The UI restore above is best-effort; this is the one that cannot miss.
  if (savedContact) sql(`update settings set value = ${savedContact} where name = 'contact'`)
  else sql("delete from settings where name = 'contact'")
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall ok')
process.exit(fails ? 1 : 0)
