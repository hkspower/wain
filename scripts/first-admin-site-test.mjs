/**
 * The website's own "no sign-in has been created yet" screen, and the working
 * registration form first-admin.js adds to it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/first-admin-site-test.mjs
 *
 * WHAT WAS WRONG, and is the app's own equivalent problem in the other
 * program — see first-admin-test.mjs, which fixed this for the Expo app.
 * admin.php answers 409 no_admin_account on an empty shop, and the WEBSITE's
 * bundle told the owner to open `/api/setup-admin.php` — a file this
 * repository actively guarantees is absent (live-file-check's mustNotBeHere).
 * The website's panel has no source here, so the fix is an overlay:
 * first-admin.js hides those three dead steps and adds a form that calls the
 * same ?r=register the app already used.
 *
 * WHAT THIS ASSERTS:
 *
 *   1. On an empty shop, the dead instructions are not VISIBLE (hidden, not
 *      deleted — an element existing but display:none is not the same claim
 *      as one never having been there, and only the visible half is what a
 *      person actually reads).
 *   2. The working form is there instead, on the right screen.
 *   3. Filling it in creates the row in MariaDB, hashed, and lands signed in
 *      — reload is enough, since register() grants the session in the same
 *      call admin.php answers.
 *   4. The route then refuses forever: a second admin_users row is not
 *      possible through this form, asserted against the SERVER's own count
 *      rather than the screen, which is what makes it safe to expose at all.
 *
 * It empties and reseeds admin_users, so it must not run next to anything
 * that assumes the seeded manager@sporta.com.kw account exists mid-run.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], {
  encoding: 'utf8',
}).trim()

const savedAdmins = sql('select email, password_hash from admin_users')
sql('delete from admin_users')
check(sql('select count(*) from admin_users') === '0', 'the shop starts with no administrator')

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await browser.newPage({ viewport: { width: 900, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'load' })
  await p.waitForTimeout(1200)

  check((await p.getByText('No sign-in has been created yet').count()) === 1,
    'it says the shop has no administrator')
  check((await p.getByText('setup-admin.php').filter({ visible: true }).count()) === 0,
    'and the dead instructions naming a file that does not exist are not VISIBLE')

  const emailField = p.getByPlaceholder('Email')
  const passField = p.getByPlaceholder('Password (at least 12 characters)')
  const pass2Field = p.getByPlaceholder('Password, again')
  check((await emailField.count()) === 1 && (await passField.count()) === 1 && (await pass2Field.count()) === 1,
    'and the working form is there instead')

  // --- a mismatch and a short password are refused before the server ever sees them
  await emailField.fill('owner@sporta.com.kw')
  await passField.fill('short')
  await pass2Field.fill('short')
  await p.getByRole('button', { name: 'Create the first account' }).click()
  await p.waitForTimeout(400)
  check((await p.getByText('at least twelve characters').count()) > 0,
    'a short password is refused before it reaches the server')
  check(sql('select count(*) from admin_users') === '0', 'and nothing was created')

  await passField.fill('a-brand-new-password-99')
  await pass2Field.fill('a-different-one-entirely')
  await p.getByRole('button', { name: 'Create the first account' }).click()
  await p.waitForTimeout(400)
  check((await p.getByText('do not match').count()) > 0, 'and a mismatch is refused the same way')
  check(sql('select count(*) from admin_users') === '0', 'still nothing created')

  // --- the real thing -------------------------------------------------------
  await passField.fill('a-brand-new-password-99')
  await pass2Field.fill('a-brand-new-password-99')
  await p.getByRole('button', { name: 'Create the first account' }).click()
  await p.waitForTimeout(2500)

  check(sql('select count(*) from admin_users') === '1', 'one administrator now exists')
  const row = sql("select email, password_hash from admin_users where email='owner@sporta.com.kw'")
  check(row.includes('owner@sporta.com.kw'), 'with the email that was typed')
  check(row.includes('$2y$') || row.includes('$2a$'), 'and the password stored HASHED, not as itself')
  check(!row.includes('a-brand-new-password-99'), 'the plain password does not appear in the row')

  check((await p.getByText('Overview', { exact: true }).count()) > 0,
    'and the panel is open, signed in, with no second sign-in')

  // --- refuses forever, asserted against the SERVER -------------------------
  const second = await fetch(`${BASE}/api/admin.php?r=register`, {
    method: 'POST',
    headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'second@sporta.com.kw', password: 'another-password-12' }),
  })
  const secondBody = await second.json().catch(() => null)
  check(second.status === 409 && secondBody?.error === 'already_set_up',
    `a second attempt is refused by admin.php (${second.status} ${secondBody?.error})`)
  check(sql('select count(*) from admin_users') === '1', 'and no second account was made')

  check(errors.length === 0, `no page errors (${errors.length})`, errors[0] ?? '')
} finally {
  await browser.close()
  // Restore whatever admin_users looked like before this run — the seeded
  // manager@sporta.com.kw account other rigs assume exists.
  sql('delete from admin_users')
  for (const line of savedAdmins.split('\n').filter(Boolean)) {
    const [email, hash] = line.split('\t')
    sql(`insert into admin_users (email, password_hash) values ('${email}', '${hash}')`)
  }
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the website\'s own empty-shop screen can be got into, once')
process.exit(fails ? 1 : 0)
