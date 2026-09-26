/**
 * An admin sign-in from an address that has never signed this account in
 * before gets the owner an email — asked for as "security alert for any
 * unknown login".
 *
 *   bash scripts/sandbox.sh
 *   node scripts/login-alert-test.mjs
 *
 * WHY THE FIRST SIGN-IN MUST STAY SILENT. admin_known_ips starts empty for
 * every account, so the very first sign-in is "new" by definition — alerting
 * on it would mean every fresh admin account emails itself the moment it is
 * first used, which tells the owner nothing they do not already know (they
 * just typed the password). store_admin_alert_new_ip() treats an account with
 * NO known IPs at all as bootstrapping rather than as a stranger, and this is
 * the one behaviour a naive "is this IP in the table" check would get wrong
 * without it — so it is asserted here rather than assumed from the code.
 *
 * WHY THIS RUNS AGAINST THE REAL PHP RATHER THAN A UNIT OF store.php.
 * store_admin_grant() is the one hook every sign-in path funnels through —
 * password-only, second-factor-verified, Google, Apple — and the point of the
 * feature is that NONE of them can slip past it. A harness that called
 * store_admin_alert_new_ip() directly would only prove the function works, not
 * that every login path actually reaches it.
 *
 * WHAT IS NOT ASSERTED: that the email actually arrives. mail() on shared
 * hosting with no MTA configured returns false and this code does not care —
 * the alert must never be able to block a sign-in, which is asserted instead
 * (the login itself still succeeds). Whether mail delivery works is a
 * question for the live server, the same reasoning email-otp's own tests use.
 */
import { execFileSync } from 'node:child_process'

const BASE = process.env.SITE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

const adminId = sql(`select id from admin_users where email = '${EMAIL}'`)
if (!adminId) {
  check(false, `the sandbox has no ${EMAIL} to sign in as — run scripts/sandbox.sh`)
  process.exit(1)
}

const signIn = () => fetch(`${BASE}/api/admin.php?r=login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})

const alertCount = () =>
  Number(sql(`select count(*) from admin_audit_log where admin_id = ${adminId} and route = 'login_new_ip'`))

const knownIps = () =>
  sql(`select ip from admin_known_ips where admin_id = ${adminId} order by ip`).split('\n').filter(Boolean)

/* ---- 1. a clean slate: no known IPs at all ------------------------------ */

sql(`delete from admin_known_ips where admin_id = ${adminId}`)
sql(`delete from admin_audit_log where admin_id = ${adminId} and route = 'login_new_ip'`)

const before = alertCount()
const res1 = await signIn()
check(res1.status === 200, `the bootstrap sign-in itself succeeds (HTTP ${res1.status})`)
check(knownIps().length === 1, 'the sign-in address is now recorded as known', `got ${JSON.stringify(knownIps())}`)
check(alertCount() === before,
  'and the FIRST sign-in an account ever makes raises no alert — nothing to compare against yet')

/* ---- 2. a genuinely new address, simulated by seeding a different one --- */

sql(`delete from admin_known_ips where admin_id = ${adminId}`)
sql(`insert into admin_known_ips (admin_id, ip) values (${adminId}, '203.0.113.5')`)

const beforeNew = alertCount()
const res2 = await signIn()
check(res2.status === 200, `a sign-in from a new address still succeeds (HTTP ${res2.status}) — never blocked`)
check(alertCount() === beforeNew + 1, 'and it DOES raise exactly one alert, once the account has a baseline')
const ips = knownIps()
check(ips.includes('203.0.113.5') && ips.length === 2,
  'the old address is kept, not replaced — this is a record, not an allow-list of one',
  `got ${JSON.stringify(ips)}`)

/* ---- 3. the same address again: no second alert ------------------------- */

const beforeRepeat = alertCount()
const res3 = await signIn()
check(res3.status === 200, `signing in again from the now-known address succeeds (HTTP ${res3.status})`)
check(alertCount() === beforeRepeat,
  'and raises no SECOND alert — an address is only ever new once')

console.log(fails ? `\n${fails} failed` : '\nall ok — the first sign-in is silent, a genuinely new address is not, and neither is ever blocked')
process.exit(fails ? 1 : 0)
