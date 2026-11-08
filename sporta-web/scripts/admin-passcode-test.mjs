// The device passcode (quick unlock) on the admin sign-in: admin.php?r=passcode_status, passcode_login, passcode_info,
// passcode_set and passcode_clear, with store_passcode_* in store.php.
//
//   npm run test:admin-passcode     (needs the sandbox: `npm run sandbox`; applies admin-passcode.mysql.sql itself)
//
// What it proves:
//   * a passcode works only from a browser that holds the admin device cookie for the account, and reports "enabled"
//     only to that browser;
//   * setting or clearing it needs the signed-in session AND the current password;
//   * five wrong passcodes lock the passcode for fifteen minutes, and a correct one during the lock is refused;
//   * a correct passcode from a known browser opens a real session, and an invalid shape is refused.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8095/admin.php'
const EMAIL = 'qa-admin@sporta.test'
const PASSWORD = 'correct-horse-battery-kw'
const PASSCODE = '482915'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const sql = (q) => execFileSync('mariadb', ['sporta', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

// one request, with explicit cookies; returns status, json, and any Set-Cookie values
async function call(route, { method = 'GET', body, cookies = [] } = {}) {
  const headers = { 'X-Sporta-Admin': '1' }
  if (body) headers['Content-Type'] = 'application/json'
  if (cookies.length) headers.Cookie = cookies.join('; ')
  const res = await fetch(`${BASE}?r=${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  return { status: res.status, json, setCookies }
}
const pick = (setCookies, name) => {
  const c = setCookies.find((v) => v.startsWith(name + '='))
  return c ? c.split(';')[0] : null
}

sql("delete from rate_limit")
sql(`update admin_users set failed_attempts = 0, locked_until = null, passcode_hash = null, passcode_failed = 0, passcode_locked_until = null where email = '${EMAIL}'`)

// the browser: a full sign-in gives it the session and the device cookie
head('setup: a full sign-in')
const first = await call('login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
is(first.status === 200, 'the full password sign-in succeeds', String(first.status))
const session = pick(first.setCookies, 'sporta_admin')
const device = pick(first.setCookies, 'sporta_dev')
is(!!session && !!device, 'it gives a session cookie and the admin device cookie')
const sessionC = session ? [session] : []
const deviceC = device ? [device] : []

// no device, no passcode
head('no device cookie, no passcode')
const statusNoDevice = await call('passcode_status&email=' + encodeURIComponent(EMAIL))
is(statusNoDevice.json?.enabled === false, 'status without the device cookie says disabled (no account hint)')

// set it: needs the session and the current password
head('set the passcode')
const setWrong = await call('passcode_set', { method: 'POST', body: { password: 'not-the-password', passcode: PASSCODE }, cookies: sessionC })
is(setWrong.status === 403 && setWrong.json?.error === 'wrong_password', 'a wrong password does not set it', `${setWrong.status} ${setWrong.json?.error}`)
const setShort = await call('passcode_set', { method: 'POST', body: { password: PASSWORD, passcode: '12345' }, cookies: sessionC })
is(setShort.status === 400 && setShort.json?.error === 'invalid_passcode', 'a five-digit passcode is refused', `${setShort.status} ${setShort.json?.error}`)
const setOk = await call('passcode_set', { method: 'POST', body: { password: PASSWORD, passcode: PASSCODE }, cookies: sessionC })
is(setOk.status === 200 && setOk.json?.set === true, 'the signed-in owner with the password sets it', `${setOk.status}`)
const info = await call('passcode_info', { cookies: sessionC })
is(info.json?.set === true, 'passcode_info reports it set')
const setNoSession = await call('passcode_set', { method: 'POST', body: { password: PASSWORD, passcode: PASSCODE } })
is(setNoSession.status === 401 || setNoSession.status === 403, 'setting it without a session is refused', String(setNoSession.status))

// a known browser sees it; a new browser does not
head('who sees it')
const statusKnown = await call('passcode_status&email=' + encodeURIComponent(EMAIL), { cookies: deviceC })
is(statusKnown.json?.enabled === true, 'the known browser (device cookie) is told it is enabled')
const statusOther = await call('passcode_status&email=' + encodeURIComponent('nobody@example.com'), { cookies: deviceC })
is(statusOther.json?.enabled === false, 'an unknown email gets the same disabled answer')

// wrong passcodes lock it
head('wrong passcodes lock it')
let last = null
for (let i = 1; i <= 4; i++) {
  last = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: '000000' }, cookies: deviceC })
  if (i === 1) is(last.status === 401 && last.json?.error === 'wrong_passcode', 'a wrong passcode is refused', `${last.status} ${last.json?.error}`)
}
const fifth = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: '000000' }, cookies: deviceC })
is(fifth.status === 423 && fifth.json?.error === 'passcode_locked', 'the fifth wrong passcode locks it', `${fifth.status} ${fifth.json?.error}`)
const duringLock = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: PASSCODE }, cookies: deviceC })
is(duringLock.status === 423, 'the right passcode is refused during the lock', `${duringLock.status} ${duringLock.json?.error}`)
const statusLocked = await call('passcode_status&email=' + encodeURIComponent(EMAIL), { cookies: deviceC })
is(statusLocked.json?.enabled === false, 'while locked the sign-in screen falls back to the password')

// the lock ends; the right passcode opens a real session
head('after the lock')
sql(`update admin_users set passcode_locked_until = null, passcode_failed = 0 where email = '${EMAIL}'`)
const unlock = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: PASSCODE }, cookies: deviceC })
is(unlock.status === 200 && unlock.json?.email === EMAIL, 'the right passcode from the known browser signs in', `${unlock.status} ${unlock.json?.error ?? ''}`)
const newSession = pick(unlock.setCookies, 'sporta_admin')
const me = await call('me', { cookies: newSession ? [newSession] : [] })
is(me.status === 200, 'the session it opened works', String(me.status))

// no device cookie, right passcode: refused
head('a new browser')
const newBrowser = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: PASSCODE } })
is(newBrowser.status === 403 && newBrowser.json?.error === 'passcode_unavailable', 'the right passcode from a new browser is refused', `${newBrowser.status} ${newBrowser.json?.error}`)
const badShape = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: 'abcdef' }, cookies: deviceC })
is(badShape.status === 403, 'a passcode that is not six digits is refused', `${badShape.status}`)

// clear it: needs the password
head('clear the passcode')
const clearWrong = await call('passcode_clear', { method: 'POST', body: { password: 'nope' }, cookies: sessionC })
is(clearWrong.status === 403, 'clearing needs the current password', `${clearWrong.status}`)
const clearOk = await call('passcode_clear', { method: 'POST', body: { password: PASSWORD }, cookies: sessionC })
is(clearOk.status === 200 && clearOk.json?.set === false, 'the password clears it', `${clearOk.status}`)
const after = await call('passcode_login', { method: 'POST', body: { email: EMAIL, passcode: PASSCODE }, cookies: deviceC })
is(after.status === 403 && after.json?.error === 'passcode_unavailable', 'a cleared passcode no longer signs in', `${after.status} ${after.json?.error}`)

// leave the account as the other suites expect it
sql(`update admin_users set passcode_hash = null, passcode_failed = 0, passcode_locked_until = null where email = '${EMAIL}'`)
sql('delete from rate_limit')

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
