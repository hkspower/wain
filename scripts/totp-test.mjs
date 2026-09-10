/**
 * The authenticator factor, against the REAL admin.php.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/totp-test.mjs
 *
 * WHY THIS EXISTS. otp-test.mjs covers the EMAILED code thoroughly and clears
 * `totp_enabled` and `totp_secret` on the way past — so the stronger of the two
 * factors, the one worth recommending to a shop that takes card payments, had
 * no test at all. Recommending a path nobody has walked is how an owner ends up
 * half-enrolled and locked out, with the only administrator account on a live
 * shop.
 *
 * IT COMPUTES REAL CODES. RFC 6238 with the parameters the server's own
 * otpauth:// URI advertises — SHA1, 6 digits, 30-second period — implemented
 * here rather than read from store.php, so this is a check against the STANDARD
 * and not against the implementation agreeing with itself. If the shop ever
 * generated codes an authenticator app would not, this fails.
 *
 * WHAT IT ASSERTS, in the order the ceremony happens:
 *
 *   1. Enrolling needs the PASSWORD. Without it an unlocked laptop enrols an
 *      attacker's own phone and locks the owner out with the owner's own
 *      password still working — the server's comment says exactly this.
 *   2. totp_begin hands back a secret and an otpauth:// URI an app can read.
 *   3. THE SECRET ALONE DOES NOT TURN IT ON. totp_enabled stays 0 until a code
 *      proves a phone actually holds it — enabling first is how a mistyped scan
 *      becomes a lockout.
 *   4. A wrong code is refused; a right one enrols.
 *   5. Signing in then needs the code: the password alone grants NO session.
 *   6. A code from the previous step is not accepted twice — replay is what a
 *      shoulder-surfed six digits would otherwise buy.
 *   7. Turning it off needs the password AND a working code.
 *
 * It writes to the sandbox's admin row and puts every column back in `finally`.
 */
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

const ID = sql(`select id from admin_users where email = '${EMAIL}'`)
if (!ID) {
  console.error(`no admin account for ${EMAIL} — run bash scripts/sandbox.sh`)
  process.exit(2)
}

// Every column this touches, saved before anything is written.
const saved = sql(
  `select concat_ws('|', coalesce(totp_secret,''), totp_enabled, coalesce(totp_last_step,'')) ` +
  `from admin_users where id = ${ID}`
).split('|')

// ---------------------------------------------------------------- RFC 6238
/** RFC 4648 base32 -> bytes. The alphabet is written out rather than derived:
 *  it is a specification constant, and a clever derivation of it is a place for
 *  a bug to hide in a file whose whole point is independence. */
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch)
    if (i < 0) continue
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Wait until the next 30-second window opens.
 *
 *  THE SERVER GIVES YOU THREE CODES AND SPENDS EACH ONE. It accepts the
 *  previous, current and next step — the standard tolerance for a phone whose
 *  clock has drifted — and `totp_last_step` makes each single-use. So a
 *  ceremony that needs four codes cannot get them out of one window, and the
 *  first version of this rig failed twice for exactly that reason: the code it
 *  enrolled with was the code it then tried to sign in with, and the one it
 *  reached for at the end was two steps out and outside the tolerance.
 *
 *  Waiting is the honest fix. Clearing totp_last_step between steps would have
 *  been faster and would have meant the rig standing down the replay guard it
 *  exists to assert. */
function nextWindow(period = 30) {
  const ms = (period - (Math.floor(Date.now() / 1000) % period)) * 1000 + 1200
  return new Promise((r) => setTimeout(r, ms))
}

/** The six digits an authenticator would show for this secret, at this moment. */
function totp(secretB32, atSeconds = Math.floor(Date.now() / 1000), period = 30, digits = 6) {
  const counter = Math.floor(atSeconds / period)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const mac = createHmac('sha1', b32decode(secretB32)).update(buf).digest()
  const off = mac[mac.length - 1] & 0x0f
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

// ---------------------------------------------------------------- the client
let cookie = ''
async function call(route, body) {
  const res = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sporta-Admin': '1',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}

try {
  // A clean starting point: no secret, not enabled.
  sql(`update admin_users set totp_secret = null, totp_enabled = 0, totp_last_step = null where id = ${ID}`)
  sql("delete from rate_limit")

  const first = await call('login', { email: EMAIL, password: PASSWORD })
  check(first.status === 200 && !first.body?.need_code, 'signed in with no factor enrolled')

  // --- 1. the password is required even from inside a session -------------
  const nope = await call('totp_begin', { password: 'not the password' })
  check(nope.status === 401, `enrolling needs the password (${nope.status})`)

  // --- 2. begin -----------------------------------------------------------
  const begin = await call('totp_begin', { password: PASSWORD })
  check(begin.status === 200 && typeof begin.body?.secret === 'string',
    `totp_begin hands back a secret (${begin.status})`)
  const secret = String(begin.body?.secret ?? '')
  check(/^[A-Z2-7]{32}$/.test(secret), 'the secret is 160 bits of base32',
    `${secret.length} chars`)
  check(/^otpauth:\/\/totp\/Sporta:/.test(String(begin.body?.uri ?? '')) &&
        /algorithm=SHA1&digits=6&period=30/.test(String(begin.body?.uri ?? '')),
    'and an otpauth URI an authenticator can read',
    String(begin.body?.uri ?? '').slice(0, 46) + '…')

  // --- 3. a secret is not an enrolment ------------------------------------
  check(sql(`select totp_enabled from admin_users where id = ${ID}`) === '0',
    'the secret alone does NOT turn it on')

  // --- 4. a wrong code, then a right one ----------------------------------
  const wrong = await call('totp_enable', { code: '000000' })
  check(wrong.status === 401, `a wrong code does not enrol (${wrong.status})`)
  check(sql(`select totp_enabled from admin_users where id = ${ID}`) === '0', 'and it is still off')

  const code = totp(secret)
  const on = await call('totp_enable', { code })
  check(on.status === 200 && on.body?.totp === true, `a code computed here enrols (${on.status})`,
    JSON.stringify(on.body))
  check(sql(`select totp_enabled from admin_users where id = ${ID}`) === '1',
    'the database says it is on')

  // --- 5. the password alone is no longer enough --------------------------
  cookie = ''
  const again = await call('login', { email: EMAIL, password: PASSWORD })
  check(again.status === 200 && again.body?.need_code === true,
    'signing in now asks for a code')
  check(again.body?.code_via === 'totp', 'and says it is the authenticator, not email',
    String(again.body?.code_via))
  const meHalf = await call('me')
  check(meHalf.body === null, 'no session exists until the code is given',
    JSON.stringify(meHalf.body))

  // --- 6. and a code is good exactly once ---------------------------------
  await nextWindow()
  const c1 = totp(secret)
  const done = await call('login_code', { code: c1 })
  check(done.status === 200 && done.body?.email === EMAIL, `the code completes the sign-in (${done.status})`)

  cookie = ''
  await call('login', { email: EMAIL, password: PASSWORD })
  const replay = await call('login_code', { code: c1 })
  check(replay.status === 401, `the same code is refused a second time (${replay.status})`)

  await nextWindow()
  const back = await call('login_code', { code: totp(secret) })
  check(back.status === 200, `a fresh code works (${back.status})`)

  // --- 7. turning it off has the same ceremony ----------------------------
  const offNoPass = await call('totp_disable', { password: 'wrong', code: totp(secret) })
  check(offNoPass.status === 401, `disabling needs the password (${offNoPass.status})`)
  const offNoCode = await call('totp_disable', { password: PASSWORD, code: '000000' })
  check(offNoCode.status === 401, `and a working code (${offNoCode.status})`)
  check(sql(`select totp_enabled from admin_users where id = ${ID}`) === '1', 'so it is still on')

  await nextWindow()
  const off = await call('totp_disable', { password: PASSWORD, code: totp(secret) })
  check(off.status === 200, `both together turn it off (${off.status})`, JSON.stringify(off.body))
  check(sql(`select totp_enabled from admin_users where id = ${ID}`) === '0', 'and the database agrees')
  check(sql(`select coalesce(totp_secret,'') from admin_users where id = ${ID}`) === '',
    'and the secret is gone, not merely disabled')
} finally {
  sql(
    `update admin_users set totp_secret = ${saved[0] ? `'${saved[0]}'` : 'null'}, ` +
    `totp_enabled = ${saved[1] || 0}, ` +
    `totp_last_step = ${saved[2] ? saved[2] : 'null'} where id = ${ID}`
  )
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the authenticator factor, end to end and against RFC 6238')
process.exit(fails ? 1 : 0)
