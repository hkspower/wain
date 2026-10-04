/**
 * The panel's sign-in hardening (2026-10-04, "make full backend login improve and full secure backend"):
 *
 *   node scripts/security-plus-test.mjs        (npm run test:security-plus)
 *
 *   A. Sessions ledger: a sign-in writes a row; security_state lists it with "current"; a SECOND browser's
 *      session can be signed out from the first (its next request is 401, `me` null); "sign out everywhere
 *      else" revokes the rest and keeps this one; logout revokes its own row; a password change signs the
 *      other browsers out.
 *   B. Passkeys, with Chrome's virtual authenticator (CDP WebAuthn): registration through the Security card,
 *      sign-in through the login page's passkey button (no password typed), the sign counter, a passkey
 *      made for another origin refused, removal. Runs against http://localhost (an IP is not a valid RP id).
 *   C. Policies: require_2fa cannot be switched on without a mailer (the sandbox has mail_from, so it can;
 *      an account with no authenticator is then asked for an email code and `me` stays null); an IP
 *      allowlist that leaves out the saving browser's address is refused; with the list set to another
 *      address, every sign-in door answers 403 ip_not_allowed and the signed-in session keeps working.
 *   D. Breached passwords: store_password_pwned() answers for a famous leaked password (skipped with a
 *      note when HIBP is unreachable from here); account_update refuses it by name.
 *   E. Login polish: show/hide toggle, Caps Lock line, the passkey button, a `locked` refusal explained.
 *
 * MUTATE=1 (should FAIL): sec_session_alive() ignores revoked_at — caught by A3.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const LOCAL = BASE.replace('127.0.0.1', 'localhost')
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
const ROOT = new URL('../', import.meta.url).pathname
const SEC_PHP = ROOT + 'sporta-site/public_html/api/security.php'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const original = readFileSync(SEC_PHP, 'utf8')
if (process.env.MUTATE) writeFileSync(SEC_PHP, original.replace("if ($row['revoked_at'] !== null) return false;", "/* MUTATED */"))
const keepSec = sql("select quote(value) from settings where name = 'security'") || null
sql('delete from rate_limit'); sql("delete from settings where name = 'security'")
const adminId = Number(sql(`select id from admin_users where email = '${EMAIL}'`))
sql(`delete from admin_passkeys where admin_id = ${adminId}`)
const hashBefore = sql(`select password_hash from admin_users where email = '${EMAIL}'`)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const mk = async (base) => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: base }); return c }
const api = (ctx, base) => async (route, body) => {
  const r = body !== undefined
    ? await ctx.request.post(`${base}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
    : await ctx.request.get(`${base}/api/admin.php?r=${route}`, { headers: { 'X-Sporta-Admin': '1' }, failOnStatusCode: false })
  return { status: r.status(), j: await r.json().catch(() => null) }
}

try {
  /* ------------------------------------------------------------- A. sessions */
  const A = await mk(BASE), B = await mk(BASE)
  const a = api(A, BASE), b = api(B, BASE)
  check((await a('login', { email: EMAIL, password: PASSWORD })).status === 200 && (await b('login', { email: EMAIL, password: PASSWORD })).status === 200, 'A0 two browsers signed in')
  let st = await a('security_state')
  check(st.status === 200 && st.j.ready === true && st.j.sessions.length >= 2 && st.j.sessions.filter((s) => s.current).length === 1, 'A1 the ledger lists both browsers, this one marked current', JSON.stringify(st.j?.sessions?.map((s) => [s.id, s.current, s.method])))
  const other = st.j.sessions.find((s) => !s.current)
  check(other && other.method === 'password', 'A2 the other row records the sign-in method')
  let r = await a('session_revoke', { id: other.id })
  const bMe = await b('me')
  check(r.status === 200 && bMe.status === 200 && bMe.j === null && (await b('stats')).status === 401, 'A3 signing the other browser out works: its `me` is null and a data route answers 401', `${r.status} ${JSON.stringify(bMe.j)}`)
  check((await a('me')).j?.email === EMAIL, 'A4 this browser is untouched')
  r = await a('session_revoke', { id: st.j.sessions.find((s) => s.current).id })
  check(r.status === 404, 'A5 a browser cannot revoke itself through the per-row route (use logout)', String(r.status))
  const C = await mk(BASE), c = api(C, BASE)
  await c('login', { email: EMAIL, password: PASSWORD }); await b('login', { email: EMAIL, password: PASSWORD })
  r = await a('sessions_revoke_others', {})
  check(r.status === 200 && r.j.revoked >= 2 && (await c('me')).j === null && (await b('me')).j === null && (await a('me')).j?.email === EMAIL, 'A6 "sign out everywhere else" revokes the others and keeps this one', JSON.stringify(r.j))
  await c('login', { email: EMAIL, password: PASSWORD })
  const cRow = (await c('security_state')).j.sessions.find((s) => s.current)
  await c('logout', {})
  check(sql(`select revoked_at is not null from admin_sessions where id = ${cRow.id}`) === '1', 'A7 logout revokes its own row')
  await C.close()

  /* ------------------------------------------------------------- B. passkeys */
  const P = await mk(LOCAL), p = api(P, LOCAL)
  const pg = await P.newPage()
  const cdp = await P.newCDPSession(pg)
  await cdp.send('WebAuthn.enable')
  const auth = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  check((await p('login', { email: EMAIL, password: PASSWORD })).status === 200, 'B0 signed in on localhost')
  await pg.goto(`${LOCAL}/backends`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((x) => /^\s*Security\s*$/.test(x.textContent)).click())
  await pg.waitForSelector('[data-sporta-security-plus] [data-spsec-add]', { timeout: 15000 }); await pg.waitForTimeout(500)
  await pg.click('[data-spsec-add]'); await pg.waitForTimeout(3000)
  const listed = await pg.evaluate(() => [...document.querySelectorAll('[data-passkey]')].map((n) => n.textContent))
  const stored = sql(`select count(*), coalesce(max(alg),0) from admin_passkeys where admin_id = ${adminId}`).split('\t')
  check(listed.length === 1 && stored[0] === '1' && stored[1] === '-7', 'B1 the Security card registers a passkey on this device (ES256, user-verified)', `${listed.join(' | ')} alg=${stored[1]}`)
  const creds = await cdp.send('WebAuthn.getCredentials', { authenticatorId: auth.authenticatorId })
  check(creds.credentials.length === 1 && creds.credentials[0].rpId === 'localhost' && creds.credentials[0].isResidentCredential, 'B2 the authenticator holds one discoverable credential for this RP', JSON.stringify(creds.credentials.map((c0) => [c0.rpId, c0.isResidentCredential])))
  await p('logout', {})
  await pg.goto(`${LOCAL}/backends`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  check(await pg.evaluate(() => !!document.querySelector('[data-splp-passkey]') && !!document.querySelector('[data-splp-eye]')), 'B3 the login page shows the passkey button and the show/hide toggle')
  await pg.click('[data-splp-passkey]'); await pg.waitForTimeout(4000)
  const signedIn = await pg.evaluate(() => !!document.querySelector('.admin-content'))
  const row = sql(`select method from admin_sessions where admin_id = ${adminId} and revoked_at is null order by id desc limit 1`)
  check(signedIn && row === 'passkey', 'B4 a passkey signs in with no password, and the ledger records the method', `${signedIn} ${row}`)
  check(Number(sql(`select sign_count from admin_passkeys where admin_id = ${adminId}`)) >= 1 && sql(`select last_used_at is not null from admin_passkeys where admin_id = ${adminId}`) === '1', 'B5 the sign counter advanced and last_used_at is set')
  const log = sql(`select method, result from admin_login_log where admin_id = ${adminId} order by id desc limit 1`)
  check(log === 'passkey\tok', 'B6 the sign-in log records a passkey sign-in', log)
  // a forged assertion (the right challenge, wrong signature) is refused
  const opt = await p('passkey_options_login', {})
  const credB64 = Buffer.from(creds.credentials[0].credentialId, 'base64').toString('base64url')
  const cdj = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: opt.j.challenge, origin: LOCAL })).toString('base64url')
  const forged = await p('passkey_login', { id: credB64, response: { clientDataJSON: cdj, authenticatorData: Buffer.concat([Buffer.alloc(32, 1), Buffer.from([5]), Buffer.from([0, 0, 0, 9])]).toString('base64url'), signature: Buffer.alloc(70, 2).toString('base64url') } })
  check(forged.status === 401 || forged.status === 400, 'B7 a forged assertion is refused', `${forged.status} ${forged.j?.error}`)
  // remove
  await pg.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((x) => /^\s*Security\s*$/.test(x.textContent)).click())
  await pg.waitForSelector('[data-passkey] button', { timeout: 15000 })
  pg.once('dialog', (d) => d.accept())
  // evaluate-click: the panel's save bar and jump bar overlay the page, which keeps Playwright's own click retrying for ever
  await pg.evaluate(() => document.querySelector('[data-passkey] button').click()); await pg.waitForTimeout(1500)
  check(sql(`select count(*) from admin_passkeys where admin_id = ${adminId}`) === '0', 'B8 Remove deletes the passkey')
  await pg.close(); await P.close()

  /* ------------------------------------------------------------- C. policies */
  r = await a('settings_save', { name: 'security', value: { require_2fa: false, ip_allow: ['10.9.8.7'] } })
  check(r.status === 400 && r.j?.error === 'ip_allow_locks_you_out', 'C1 an allowlist without my address is refused by name', `${r.status} ${r.j?.error}`)
  r = await a('settings_save', { name: 'security', value: { require_2fa: false, ip_allow: ['not an ip'] } })
  check(r.status === 400 && r.j?.error === 'ip_allow_bad_rule_1', 'C2 a bad rule is refused by position')
  r = await a('settings_save', { name: 'security', value: { require_2fa: false, ip_allow: ['127.0.0.0/8', '::1'] } })
  check(r.status === 200 && r.j.ip_allow.length === 2, 'C3 a list including my range saves')
  check((await b('login', { email: EMAIL, password: PASSWORD })).status === 200, 'C4 signing in from an allowed address works')
  sql(`update settings set value = '{"require_2fa":false,"ip_allow":["10.9.8.7"]}' where name = 'security'`)
  const doors = {}
  for (const [route, body] of [['login', { email: EMAIL, password: PASSWORD }], ['passkey_options_login', {}], ['google_login', { credential: 'x' }], ['passcode_unlock', { token: 'x', passcode: '000000' }]]) { const x = await b(route, body); doors[route] = `${x.status}/${x.j?.error}` }
  check(Object.values(doors).every((v) => v === '403/ip_not_allowed'), 'C5 with the list elsewhere, every sign-in door answers 403 ip_not_allowed', JSON.stringify(doors))
  check((await a('me')).j?.email === EMAIL, 'C6 the browser already signed in keeps working')
  check(sql("select result from admin_login_log order by id desc limit 1") === 'ip_not_allowed', 'C7 the refusal is in the sign-in log')
  sql("delete from settings where name = 'security'")
  const mailReady = (await a('security_state')).j.mail_ready
  r = await a('settings_save', { name: 'security', value: { require_2fa: true, ip_allow: [] } })
  if (mailReady) {
    check(r.status === 200 && r.j.require_2fa === true, 'C8 require_2fa switches on (the sandbox has a mail_from)')
    const D = await mk(BASE), d = api(D, BASE)
    const lg = await d('login', { email: EMAIL, password: PASSWORD })
    check(lg.status === 200 && lg.j?.need_code === true && lg.j.code_via === 'email' && (await d('me')).j === null, 'C9 an account with no authenticator is asked for an email code and is NOT signed in', JSON.stringify(lg.j))
    await D.close()
  } else {
    check(r.status === 400 && r.j?.error === 'require_2fa_needs_mail', 'C8 require_2fa is refused without a mailer')
  }
  sql("delete from settings where name = 'security'")

  /* ------------------------------------------------------------- D. breached */
  const pw = execFileSync('php', ['-r', 'require $argv[1]; require $argv[2]; var_export(store_password_pwned("correcthorsebatterystaple"));', ROOT + 'sporta-site/public_html/api/store.php', SEC_PHP], { encoding: 'utf8' }).trim()
  if (pw === 'true') {
    r = await a('account_update', { password: PASSWORD, code: '', new_password: 'correcthorsebatterystaple', new_password2: 'correcthorsebatterystaple' })
    check(r.status === 400 && (r.j?.error === 'password_pwned' || /code/.test(String(r.j?.error))), 'D1 a leaked password is refused by name (or the fresh-code gate fires first)', `${r.status} ${r.j?.error}`)
  } else {
    console.log(`--   D skipped: HIBP answered ${pw} from this network (fail-open by design)`)
  }
  check(sql(`select password_hash from admin_users where email = '${EMAIL}'`) === hashBefore, 'D2 the password did not change')

  /* ------------------------------------------------------------- E. login polish */
  const E = await mk(BASE); const ep = await E.newPage(); const errs = []; ep.on('pageerror', (e) => errs.push(String(e)))
  await ep.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await ep.waitForTimeout(1200)
  const pwBox = ep.locator('input[data-splp-pw]')
  await pwBox.fill('secret'); await ep.click('[data-splp-eye]')
  check(await pwBox.evaluate((e) => e.type) === 'text' && await ep.evaluate(() => document.querySelector('[data-splp-eye]').getAttribute('aria-pressed')) === 'true', 'E1 Show reveals the password and says so')
  await ep.click('[data-splp-eye]'); check(await pwBox.evaluate((e) => e.type) === 'password', 'E2 Hide puts it back')
  // CDP's key events carry only Alt/Ctrl/Meta/Shift, so Caps Lock cannot be pressed for real here: dispatch
  // the key event a browser sends with the lock on (modifierCapsLock), which is what the handler reads.
  await pwBox.focus(); await pwBox.evaluate((e) => e.dispatchEvent(new KeyboardEvent('keyup', { key: 'A', bubbles: true, modifierCapsLock: true })))
  const capsOn = await ep.evaluate(() => { const c = document.querySelector('[data-splp-caps]'); return c && !c.hidden })
  await pwBox.evaluate((e) => e.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })))
  check(await ep.evaluate(() => document.querySelector('[data-splp-caps]').hidden) === true, 'E3b and hidden again once it is off')
  check(capsOn === true, 'E3 Caps Lock is announced while on', String(capsOn))
  check(await ep.evaluate(() => (document.querySelector('input[type=email], input[autocomplete^="username"]')?.getAttribute('autocomplete') || '').includes('webauthn')), 'E4 the email box offers saved passkeys (autocomplete webauthn)')
  sql(`update admin_users set locked_until = now() + interval 10 minute where email = '${EMAIL}'`)
  await ep.fill('input[type=email], input[autocomplete^="username"]', EMAIL); await pwBox.fill(PASSWORD); await ep.keyboard.press('Enter'); await ep.waitForTimeout(1500)
  sql(`update admin_users set locked_until = null, failed_attempts = 0 where email = '${EMAIL}'`)
  check(/locked for 15 minutes|مقفل ١٥ دقيقة/.test(await ep.evaluate(() => document.querySelector('[data-splp-why]')?.textContent || '')), 'E5 a locked account is explained in plain words under the form')
  check(errs.length === 0, 'E6 no script errors on the login page', errs.join(' | ').slice(0, 100))
  await E.close(); await A.close(); await B.close()
} finally {
  writeFileSync(SEC_PHP, original)
  sql(keepSec ? `insert into settings (name, value) values ('security', ${keepSec}) on duplicate key update value = values(value)` : "delete from settings where name = 'security'")
  sql(`delete from admin_passkeys where admin_id = ${adminId}`)
  sql(`update admin_users set locked_until = null, failed_attempts = 0 where email = '${EMAIL}'`)
  sql('delete from rate_limit')
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — revocable sessions, passkeys, policies, breached-password checks and a kinder login page')
process.exit(fails ? 1 : 0)
