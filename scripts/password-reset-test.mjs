/**
 * Password reset by an emailed code, at /backends.
 *
 *   bash scripts/sandbox.sh && node scripts/password-reset-test.mjs
 *
 * The sandbox has no MTA, so the code cannot be read from a mailbox; the rig
 * asks for one through the real route, then swaps the stored HASH for the hash
 * of a code it knows (only the hash is ever stored). It uses a throwaway admin
 * account and leaves the sandbox's own accounts untouched.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'reset-rig@local.test', OLD = 'old password 12345!', NEW = 'brand new passphrase 77'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
const hash = (v) => execFileSync('php', ['-r', `echo password_hash($argv[1], PASSWORD_DEFAULT);`, v], { encoding: 'utf8' })
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const call = async (route, body, hdr = true) => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(hdr ? { 'X-Sporta-Admin': '1' } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const clean = () => { sql(`delete from admin_password_resets where admin_id in (select id from admin_users where email='${EMAIL}')`); sql("delete from rate_limit; delete from rate_bucket") }
const setCode = (c) => sql(`update admin_password_resets set code_hash='${hash(c)}' where admin_id=(select id from admin_users where email='${EMAIL}')`)
const rowOf = () => sql(`select attempts from admin_password_resets where admin_id=(select id from admin_users where email='${EMAIL}')`)

sql(`delete from admin_users where email='${EMAIL}'`)
sql(`insert into admin_users (email, password_hash, must_change_password) values ('${EMAIL}', '${hash(OLD)}', 1)`)
try {
  clean()
  const a = await call('password_reset_request', { email: EMAIL })
  const b = await call('password_reset_request', { email: 'nobody@nowhere.test' })
  check(a.status === 200 && b.status === 200 && JSON.stringify(a.j) === JSON.stringify(b.j), 'the answer is identical for a real and an unknown address', JSON.stringify(a.j))
  check(rowOf() !== '' && sql("select count(*) from admin_password_resets") === '1', 'only the real account got a code row')
  check(sql(`select length(code_hash) from admin_password_resets limit 1`) >= '50', 'only a hash of the code is stored')
  check((await call('password_reset_request', { email: EMAIL }, false)).status === 400, 'the CSRF header is required')

  setCode('12345678')
  check((await call('password_reset_confirm', { email: EMAIL, code: '00000000', password: NEW, password2: NEW })).status === 401, 'a wrong code is refused')
  check(rowOf() === '1', 'and counts as a try')
  check((await call('password_reset_confirm', { email: EMAIL, code: '12345678', password: 'short', password2: 'short' })).j?.error === 'password_too_short', 'right code, short password: refused by name')
  check((await call('password_reset_confirm', { email: EMAIL, code: '12345678', password: NEW, password2: 'different pass 999' })).j?.error === 'password_mismatch', 'mismatch refused')
  check((await call('password_reset_confirm', { email: EMAIL, code: '12345678', password: 'reset-rig12345', password2: 'reset-rig12345' })).j?.error === 'password_too_common', 'a password containing the email name is refused')
  check(rowOf() === '1', 'a refused password does not burn the code')
  check((await call('password_reset_confirm', { email: 'nobody@nowhere.test', code: '12345678', password: NEW, password2: NEW })).status === 401, 'the code does not work for another address')

  // burn: five wrong tries
  for (let i = 0; i < 4; i++) await call('password_reset_confirm', { email: EMAIL, code: '00000001', password: NEW, password2: NEW })
  check((await call('password_reset_confirm', { email: EMAIL, code: '12345678', password: NEW, password2: NEW })).status === 401, 'five wrong tries burn the code: even the right one is refused')
  clean()

  // expiry
  await call('password_reset_request', { email: EMAIL }); setCode('12345678')
  sql(`update admin_password_resets set expires_at = now() - interval 1 minute`)
  check((await call('password_reset_confirm', { email: EMAIL, code: '12345678', password: NEW, password2: NEW })).status === 401, 'an expired code is refused')
  clean()

  // success
  await call('password_reset_request', { email: EMAIL }); setCode('12345678')
  sql(`update admin_users set failed_attempts = 9, locked_until = now() + interval 1 hour where email='${EMAIL}'`)
  const ok = await call('password_reset_confirm', { email: EMAIL, code: '12 34 5678', password: NEW, password2: NEW })
  check(ok.status === 200, 'the right code and a good password reset it', JSON.stringify(ok.j))
  check(sql(`select count(*) from admin_password_resets`) === '0', 'the code is spent')
  check((await call('login', { email: EMAIL, password: OLD })).status === 401, 'the old password no longer works')
  const li = await call('login', { email: EMAIL, password: NEW })
  check(li.status === 200, 'the new one does', JSON.stringify(li.j))
  check(sql(`select must_change_password, failed_attempts, locked_until is null from admin_users where email='${EMAIL}'`) === '0\t0\t1', 'the forced-change flag and the lockout are cleared')
  check((await call('password_reset_confirm', { email: EMAIL, code: '12345678', password: NEW, password2: NEW })).status === 401, 'the code cannot be used twice')

  // the browser flow
  clean()
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const pg = await (await br.newContext()).newPage()
  await pg.goto(`${BASE}/backends`); await pg.waitForSelector('[data-sporta-reset]', { timeout: 15000 })
  await pg.locator('[data-sporta-reset] button').first().click()
  await pg.locator('[data-sporta-reset] input[type=email]').fill(EMAIL)
  await pg.locator('[data-sporta-reset] button').nth(1).click()
  await pg.waitForSelector('[data-sporta-reset] input[inputmode=numeric]', { state: 'visible', timeout: 8000 })
  setCode('87654321')
  const pw = pg.locator('[data-sporta-reset] input[type=password]')
  await pg.locator('[data-sporta-reset] input[inputmode=numeric]').fill('87654321')
  await pw.nth(0).fill('another long passphrase 42'); await pw.nth(1).fill('another long passphrase 42')
  await pg.locator('[data-sporta-reset] button').nth(2).click()
  await pg.waitForTimeout(1500)
  check(/Password changed|تم تغيير كلمة المرور/.test(await pg.locator('[data-sporta-reset]').innerText()), 'the panel walks the owner through it and says so')
  check((await call('login', { email: EMAIL, password: 'another long passphrase 42' })).status === 200, 'and the password from the browser form works')
  // signed in, on a screen with password fields of its own: the reset UI must not appear
  const p2 = await (await br.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await p2.goto(`${BASE}/backends`); await p2.waitForSelector('input[type=password]')
  await p2.locator('input[type=email], input[type=text]').first().fill(EMAIL)
  await p2.locator('input[type=password]').first().fill('another long passphrase 42'); await p2.keyboard.press('Enter')
  await p2.waitForSelector('.admin-content'); await p2.waitForTimeout(1500)
  await p2.locator('.admin-sidebar button', { hasText: /^\s*Security\s*$/ }).first().click(); await p2.waitForTimeout(2000)
  check(await p2.locator('input[type=password]').count() > 0 && await p2.locator('[data-sporta-reset]').count() === 0,
    'signed in, the forgot-password form is not drawn on screens that have password fields of their own')
  await br.close()
} finally {
  clean(); sql(`delete from admin_users where email='${EMAIL}'`)
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
