/**
 * The emailed one-time code, as a second factor for the admin panel.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/otp-test.mjs
 *
 * Driven against the REAL admin.php and MariaDB, the way admin-live-test.mjs
 * is, with a manual cookie jar — because a second factor is exactly the thing
 * that looks right in a mock and is wrong in the server.
 *
 * THE CODE IS READ OUT OF THE DATABASE, not out of a mailbox. The sandbox has
 * no MTA, so store_email_otp_send() returns false and no message goes
 * anywhere; what the rig verifies is the HMAC that was written, by computing
 * the same HMAC over each of the million candidates it needs (in practice one:
 * it knows the code it is looking for only by re-deriving it). Since it cannot
 * know the code, it instead sets a KNOWN code's hash directly and then proves
 * the server accepts that code and nothing else. That is the honest way round:
 * it tests store_email_otp_claim() and the login branch, and it does not
 * pretend to test the mail.
 *
 * What it is here to hold:
 *   - the password alone grants nothing once the factor is on
 *   - a wrong code is refused, five wrong codes destroy the code
 *   - a used code cannot be used twice
 *   - an expired code is refused
 *   - the FACTOR is taken from the session, so holding a password for a
 *     TOTP account cannot be redirected to the email path
 *   - a mail failure is reported rather than swallowed
 */
import { execFileSync } from 'node:child_process'

const API = process.env.SITE_API ?? 'http://127.0.0.1:4300/api'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })
const one = (q) => sql(q).trim().split('\n').slice(1)[0] ?? ''

/** api/config.php's cron_key — the key the server's HMAC is built on. */
const CRON_KEY = execFileSync('php', ['-r',
  'require "api/store.php"; $c = store_config(); echo (string)($c["cron_key"] ?? "");'],
  { cwd: 'sporta-site/public_html', encoding: 'utf8' }).trim()

/** The same construction store_email_otp_hash() uses. */
const hashOf = (code) => execFileSync('php', ['-r',
  `echo hash_hmac('sha256', 'admin-otp' . "\\0" . $argv[1], $argv[2]);`, '--', code, CRON_KEY],
  { encoding: 'utf8' }).trim()

// A cookie jar of three lines, as admin-live-test.mjs has: node's fetch keeps
// none, and the whole flow is about what the session remembers between calls.
let jar = ''
const call = async (route, body, { noCookie = false } = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Sporta-Admin': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(jar && !noCookie ? { Cookie: jar } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) {
    const [pair] = c.split(';')
    if (pair.includes('=')) jar = pair
  }
  return { status: res.status, body: await res.json().catch(() => null) }
}

const admin = () => one(`select id from admin_users where email = '${EMAIL}'`)
const reset = () => sql(`update admin_users
  set email_otp_enabled = 0, email_otp_hash = null, email_otp_expires = null,
      email_otp_attempts = 0, failed_attempts = 0, locked_until = null,
      totp_enabled = 0, totp_secret = null
  where email = '${EMAIL}'`)

if (!CRON_KEY) {
  console.log('FAIL api/config.php has no cron_key — the server refuses to issue codes without one')
  process.exit(1)
}
reset()
sql('delete from rate_limit')
const ID = admin()
console.log(`admin #${ID} ${EMAIL}\n`)

// ------------------------------------------- with the factor OFF, nothing changes
{
  jar = ''
  const r = await call('login', { email: EMAIL, password: PASSWORD })
  check(r.status === 200 && !r.body?.need_code,
    'with no second factor, the password alone signs in', JSON.stringify(r.body))
  await call('logout', {})
}

// ------------------------------------------------------------------ enrolling
{
  jar = ''
  await call('login', { email: EMAIL, password: PASSWORD })
  const bad = await call('otp_begin', { password: 'not the password' })
  check(bad.status === 401, `enrolling needs the password (${bad.status})`)

  const begin = await call('otp_begin', { password: PASSWORD })
  check(begin.status === 200, `otp_begin is accepted (${begin.status})`, JSON.stringify(begin.body))
  // THE SANDBOX HAS NO MTA, so this is false — and the route saying so is the
  // point of it. An owner finds out here, before the door is locked, rather
  // than at a sign-in they cannot complete.
  check(begin.body?.sent === false,
    'and reports honestly that the mail did NOT go, because this sandbox has no mail server',
    `sent=${begin.body?.sent}`)
  check(/^m\*+@/.test(String(begin.body?.to)),
    'the address it went to is masked', String(begin.body?.to))

  const stored = one(`select email_otp_hash from admin_users where id = ${ID}`)
  check(stored && stored !== 'NULL', 'a code was issued and its hash stored')
  check(stored.length === 64 && !/^[0-9]{6}$/.test(stored),
    'and what is stored is the HMAC, not the code itself', stored.slice(0, 20))

  // The rig cannot read the code, so it plants one whose hash it knows. This
  // is testing store_email_otp_claim() and the routes around it, which is what
  // it claims to test.
  const KNOWN = '424242'
  sql(`update admin_users set email_otp_hash = '${hashOf(KNOWN)}',
        email_otp_expires = date_add(now(), interval 10 minute), email_otp_attempts = 0
       where id = ${ID}`)

  const wrong = await call('otp_enable', { code: '000000' })
  check(wrong.status === 401, `a wrong code does not enable it (${wrong.status})`)
  sql(`update admin_users set email_otp_attempts = 0 where id = ${ID}`)

  const on = await call('otp_enable', { code: KNOWN })
  check(on.status === 200 && on.body?.email_otp === true,
    `the right code enables it (${on.status})`, JSON.stringify(on.body))
  check(one(`select email_otp_enabled from admin_users where id = ${ID}`) === '1',
    'and the account says so')
  check(one(`select email_otp_hash from admin_users where id = ${ID}`) === 'NULL',
    'the code was consumed by enrolling — it cannot be used again')
  await call('logout', {})
}

// ------------------------------------------------- signing in with the factor on
{
  jar = ''
  sql('delete from rate_limit')
  const r = await call('login', { email: EMAIL, password: PASSWORD })
  check(r.status === 200 && r.body?.need_code === true,
    'the password alone no longer signs in', JSON.stringify(r.body))
  check(r.body?.code_via === 'email',
    'the screen is told WHICH factor to ask for', String(r.body?.code_via))
  check(/^m\*+@/.test(String(r.body?.code_sent_to)),
    'and where the code went, masked', String(r.body?.code_sent_to))
  check(r.body?.code_sent === false,
    'and that the mail failed, rather than being left to guess')

  // Nothing is granted yet.
  const me = await call('me')
  check(me.body === null, 'and no session exists until the code is given', JSON.stringify(me.body))

  const KNOWN = '135790'
  sql(`update admin_users set email_otp_hash = '${hashOf(KNOWN)}',
        email_otp_expires = date_add(now(), interval 10 minute), email_otp_attempts = 0
       where id = ${ID}`)

  const wrong = await call('login_code', { code: '999999' })
  check(wrong.status === 401, `a wrong code is refused (${wrong.status})`)
  check(one(`select email_otp_attempts from admin_users where id = ${ID}`) === '1',
    'and is counted against the code')

  const ok = await call('login_code', { code: KNOWN })
  check(ok.status === 200 && ok.body?.email === EMAIL,
    `the right code signs in (${ok.status})`, JSON.stringify(ok.body))
  const who = await call('me')
  check(who.body?.email === EMAIL, 'and the session is real', JSON.stringify(who.body))
  await call('logout', {})
}

// ------------------------------------------------------------- what it refuses
{
  // A USED CODE IS DEAD. The most important property here: a code read over a
  // shoulder, or left in a mailbox somebody else can reach, is worth nothing
  // once the owner has used it.
  jar = ''
  sql('delete from rate_limit')
  const KNOWN = '246813'
  await call('login', { email: EMAIL, password: PASSWORD })
  sql(`update admin_users set email_otp_hash = '${hashOf(KNOWN)}',
        email_otp_expires = date_add(now(), interval 10 minute), email_otp_attempts = 0
       where id = ${ID}`)
  await call('login_code', { code: KNOWN })
  await call('logout', {})

  jar = ''
  await call('login', { email: EMAIL, password: PASSWORD })
  const replay = await call('login_code', { code: KNOWN })
  check(replay.status === 401, `the same code cannot be used twice (${replay.status})`)
}
{
  // AN EXPIRED CODE IS DEAD.
  jar = ''
  sql('delete from rate_limit')
  const KNOWN = '112233'
  await call('login', { email: EMAIL, password: PASSWORD })
  sql(`update admin_users set email_otp_hash = '${hashOf(KNOWN)}',
        email_otp_expires = date_sub(now(), interval 1 minute), email_otp_attempts = 0
       where id = ${ID}`)
  const r = await call('login_code', { code: KNOWN })
  check(r.status === 401, `a code past its expiry is refused (${r.status})`)
}
{
  // FIVE WRONG GUESSES DESTROY THE CODE, so one code cannot be ground down.
  jar = ''
  sql('delete from rate_limit')
  const KNOWN = '778899'
  await call('login', { email: EMAIL, password: PASSWORD })
  sql(`update admin_users set email_otp_hash = '${hashOf(KNOWN)}',
        email_otp_expires = date_add(now(), interval 10 minute), email_otp_attempts = 0
       where id = ${ID}`)
  for (let i = 0; i < 5; i++) await call('login_code', { code: '000001' })
  check(one(`select email_otp_hash from admin_users where id = ${ID}`) === 'NULL',
    'five wrong guesses throw the code away')
  const after = await call('login_code', { code: KNOWN })
  check(after.status === 401,
    `and even the RIGHT code no longer works — a new one must be sent (${after.status})`)
}
{
  // THE FACTOR COMES FROM THE SESSION. An account on TOTP must not be
  // switchable to the email path by a caller who holds only the password.
  jar = ''
  sql('delete from rate_limit')
  // THE FIVE WRONG CODES ABOVE LOCKED THE ACCOUNT, which is the intended
  // behaviour — a wrong code counts against the same five-strike lock the
  // password uses, so guessing at codes closes the account for a quarter of an
  // hour. The lock has to be cleared here or this block is testing the lock
  // rather than the factor: without it `login` answers 429 and `code_via`
  // comes back undefined, which is what the first run of this file reported.
  sql(`update admin_users set failed_attempts = 0, locked_until = null where id = ${ID}`)
  sql(`update admin_users set totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP' where id = ${ID}`)
  const r = await call('login', { email: EMAIL, password: PASSWORD })
  check(r.body?.code_via === 'totp',
    'with both factors enrolled, the stronger one is demanded', String(r.body?.code_via))
  const KNOWN = '332211'
  sql(`update admin_users set email_otp_hash = '${hashOf(KNOWN)}',
        email_otp_expires = date_add(now(), interval 10 minute) where id = ${ID}`)
  const sneak = await call('login_code', { code: KNOWN })
  check(sneak.status === 401,
    `and an email code cannot be used against a TOTP account (${sneak.status})`)
  sql(`update admin_users set totp_enabled = 0, totp_secret = null where id = ${ID}`)
}

reset()
sql('delete from rate_limit')
console.log(fails ? `\n${fails} failed` : '\nall ok — the emailed code, against the real admin.php')
process.exit(fails ? 1 : 0)
