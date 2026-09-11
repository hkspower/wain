/**
 * The first administrator: can a shop with none be got into?
 *
 *   bash scripts/sandbox.sh
 *   python3 scripts/serve-dist.py 4173 &
 *   EXPO_PUBLIC_API_BASE=http://127.0.0.1:4173/api npm run build:web
 *   node scripts/first-admin-test.mjs
 *
 * WHAT WAS WRONG. admin.php answers 409 no_admin_account when admin_users is
 * empty, so the sign-in screen could say what was missing — and then said
 * "see api/setup-admin.php", a file this repository actively guarantees is
 * ABSENT (live-file-check lists it under mustNotBeHere). The one screen that
 * knew what was wrong sent the owner to a 404, and the `register` route that
 * fixes it was not exposed to the app at all.
 *
 * WHAT THIS ASSERTS, in the order a person meets it:
 *
 *   1. On a shop with NO administrator, the sign-in screen says so and offers
 *      to make one — and does NOT name a file that does not exist.
 *   2. Filling it in creates the account IN MARIADB and lands on the panel,
 *      signed in, with no second sign-in.
 *   3. The password is STORED HASHED. A rig that only checked the row exists
 *      would pass on a shop storing passwords in plain text.
 *   4. The route then refuses forever: a second attempt says already_set_up,
 *      and the account count stays at one. This is the property that makes it
 *      safe to expose an account-creating endpoint on a public panel at all,
 *      so it is asserted against the SERVER, not against the screen.
 *   5. Signing out and back in with those credentials works — the account is
 *      a real one, not a session that happens to exist.
 *
 * IT EMPTIES admin_users AND PUTS IT BACK. The sandbox's seeded manager is
 * saved first and restored in `finally`, whatever happens.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'

const EMAIL = 'first-admin-rig@sporta.com.kw'
const PASSWORD = 'correct horse battery staple'   // 28 chars, over the server's 12

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

// Everything in the table, as SQL that puts it back. Saved before anything is
// deleted — a rig that empties an auth table and cannot restore it has broken
// the sandbox for every rig after it.
const saved = sql(
  "select concat('(', quote(email), ',', quote(password_hash), ')') from admin_users"
).split('\n').filter(Boolean)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1100, height: 950 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

try {
  sql('delete from admin_users')
  check(sql('select count(*) from admin_users') === '0', 'the shop starts with no administrator')

  // --- 1. the screen says what is wrong, and offers the way out -----------
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(2500)

  let screen = await p.locator('body').innerText()
  check(/no administrator yet/i.test(screen), 'it says the shop has no administrator',
    (screen.match(/[^\n]*administrator[^\n]*/) ?? [''])[0].slice(0, 70))
  check(!/setup-admin\.php/.test(screen), 'and does NOT name a file that does not exist')
  check(/Create the first account/.test(screen), 'and the button now offers to make one')

  // --- 2 + 3. it creates a real, hashed account --------------------------
  await p.getByRole('button').filter({ hasText: /Create the first account/ }).last().click()
  await p.waitForTimeout(3500)

  check(sql('select count(*) from admin_users') === '1', 'one administrator now exists')
  const hash = sql(`select password_hash from admin_users where email = '${EMAIL}'`)
  check(hash.startsWith('$2y$') || hash.startsWith('$argon2'),
    'and the password is stored hashed, not as itself',
    hash.slice(0, 7) + '…')
  check(!hash.includes(PASSWORD), 'the password does not appear in the row')

  screen = await p.locator('body').innerText()
  check(/Sign out/.test(screen), 'and the panel is open, without a second sign-in')

  // --- 4. it can never fire again — asked of the SERVER ------------------
  const second = await p.evaluate(async () => {
    const r = await fetch('/api/admin.php?r=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: JSON.stringify({ email: 'second@sporta.com.kw', password: 'another very long one' }),
    })
    const d = await r.json().catch(() => null)
    return { status: r.status, error: (d && d.error) || '' }
  })
  check(second.status === 409 && /already_set_up/.test(second.error),
    'a second attempt is refused by admin.php', `${second.status} ${second.error || '(accepted!)'}`)
  check(sql('select count(*) from admin_users') === '1', 'and no second account was made')

  // --- 5. the credentials really work ------------------------------------
  await p.getByText('Sign out', { exact: true }).first().click()
  await p.waitForTimeout(2500)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3000)
  check(/Sign out/.test(await p.locator('body').innerText()),
    'and the new account can sign in again')

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
} finally {
  sql('delete from admin_users')
  if (saved.length) {
    sql('insert into admin_users (email, password_hash) values ' + saved.join(','))
  }
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — a shop with no administrator can be got into, once')
process.exit(fails ? 1 : 0)
