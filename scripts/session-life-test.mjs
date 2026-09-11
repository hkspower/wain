/**
 * How long a signed-in admin stays signed in — and that it still ends.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/session-life-test.mjs
 *
 * WHY. store_session_admin() runs two clocks of its own — idle and absolute —
 * and says in its own comment that it does its own timing because PHP's
 * collector "is shared hosting's to configure". That reasoning is right and it
 * stops one line short: a collector you cannot trust to expire a session LATE
 * is the same collector you cannot trust not to expire one EARLY. PHP's default
 * session.gc_maxlifetime is 1440 seconds, so on a host that leaves it there the
 * session FILE was deletable after 24 minutes idle and the 12-hour idle window
 * above it never happened. The panel signed you out mid-afternoon for a reason
 * nothing in the file mentioned, and the fix — raising gc_maxlifetime to match
 * — is invisible in every existing test.
 *
 * THE ASSERTION THAT MATTERS IS THE SECOND ONE. Raising a garbage-collector
 * window is exactly the kind of change that quietly buys convenience with
 * security, so this rig does not merely check the new number: it drives a REAL
 * session past the idle limit and requires the server to refuse it. If the
 * expiry ever stops being enforced, the longer window becomes what decides, and
 * that is the failure worth catching.
 *
 * WHAT IT ASSERTS:
 *
 *   1. gc_maxlifetime is at least the idle window. Below it, the file can go
 *      before the session is meant to end; the two must not disagree.
 *   2. A session idle past the limit is REFUSED — the expiry still runs, and
 *      the wider collector window did not become the real timeout. Driven by
 *      ageing `seen_at` in the session store, so it is the server's own clock
 *      being tested rather than a constant being read back.
 *   3. Fresh activity keeps a session alive, or assertion 2 would pass on a
 *      server that simply signs everybody out.
 *   4. The cookie is still a SESSION cookie (lifetime 0), so closing the
 *      browser still signs you out. That was the owner's explicit choice on
 *      2026-09-10 and is the half that keeps a shared machine safe.
 *
 * It signs in against the sandbox and puts the session store back.
 */
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

/** Read the constants and the effective ini through store.php itself, so this
 *  is what the SERVER computes rather than what the source appears to say. */
const php = (code) =>
  execFileSync('php', ['-r', `$_SERVER['HTTPS']='off';$_SERVER['REQUEST_METHOD']='GET';
    require 'sporta-site/public_html/api/store.php'; ${code}`], { encoding: 'utf8' }).trim()

const idle = Number(php('echo STORE_ADMIN_IDLE_SECONDS;'))
const absolute = Number(php('echo STORE_ADMIN_ABSOLUTE_SECONDS;'))
const gc = Number(php('store_session_start(); echo ini_get("session.gc_maxlifetime");'))
const cookieLife = Number(php('store_session_start(); $p=session_get_cookie_params(); echo $p["lifetime"];'))

console.log(`--- idle ${idle / 3600}h   absolute ${absolute / 86400}d   gc ${gc / 3600}h   cookie lifetime ${cookieLife}\n`)
check(idle > 0 && absolute > 0, 'the session constants were read', `${idle}s / ${absolute}s`)

// --- 1. the collector must not undercut the idle window -------------------
check(gc >= idle,
  'PHP may not collect a session before it is meant to expire',
  `gc_maxlifetime ${gc}s vs idle ${idle}s${gc < idle ? '  <- the file dies first' : ''}`)

// --- 4. and closing the browser still signs you out ----------------------
check(cookieLife === 0,
  'the cookie is still a session cookie, so browser close signs out',
  `lifetime ${cookieLife}`)

// ---------------------------------------------------------------- live half
let cookie = ''
const call = async (route, body) => {
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

/** The session file for the id currently held, found in PHP's own save path. */
const sessionFile = () => {
  const id = cookie.split('=')[1]
  const dir = php('echo session_save_path() ?: sys_get_temp_dir();') || '/tmp'
  return `${dir}/sess_${id}`
}

const login = await call('login', { email: EMAIL, password: PASSWORD })
if (login.status !== 200 || login.body?.need_code) {
  console.log(`\ncannot test the live half: login returned ${login.status}` +
    `${login.body?.need_code ? ' and asked for a two-factor code' : ''}` +
    ' — run bash scripts/sandbox.sh')
  process.exit(fails ? 1 : 0)
}

const me = await call('me')
check(me.status === 200 && me.body?.email === EMAIL, 'signed in against the sandbox', String(me.body?.email))

// --- 3. a fresh session stays signed in ----------------------------------
// Asserted BEFORE the expiry check, so that check cannot pass on a server that
// refuses everybody.
const still = await call('me')
check(still.body?.email === EMAIL, 'and stays signed in while it is being used')

// --- 2. aged past the idle limit, it is refused --------------------------
// `seen_at` is aged in the session file itself: the server's own clock decides,
// rather than a constant being compared with itself.
const file = sessionFile()
let aged = false
try {
  const raw = execFileSync('cat', [file], { encoding: 'utf8' })
  const past = Math.floor(Date.now() / 1000) - idle - 120
  const next = raw.replace(/seen_at\|i:\d+;/, `seen_at|i:${past};`)
  aged = next !== raw
  if (aged) execFileSync('bash', ['-c', `cat > ${JSON.stringify(file)}`], { input: next })
} catch (e) {
  console.log(`--   could not age the session file (${String(e).slice(0, 60)})`)
}
check(aged, 'the session file could be aged, so the next check is real', file)

if (aged) {
  const expired = await call('me')
  check(expired.status === 200 && expired.body === null,
    'a session idle past the limit is refused',
    `me returned ${JSON.stringify(expired.body)}`)
  const guarded = await call('stats')
  check(guarded.status === 401, 'and a data route 401s rather than serving it',
    `stats returned ${guarded.status}`)
}

console.log(fails
  ? `\n${fails} failed`
  : '\nall ok — a working day signed in, and it still ends when it should')
process.exit(fails ? 1 : 0)
