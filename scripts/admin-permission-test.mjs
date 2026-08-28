/**
 * Every route in admin.php, asked for by somebody who is not an admin.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/admin-permission-test.mjs
 *
 * admin.php protects itself with ONE LINE:
 *
 *     $admin = store_require_admin();      // "Everything below this is an admin."
 *
 * Everything before it is public on purpose — login, login_code, logout, me —
 * and everything after it is not. That is a good design: there is no per-route
 * permission check to forget, because there is only one check.
 *
 * The failure mode it has instead is POSITIONAL. Add a route above that line,
 * or move the line, and a customer-data endpoint becomes public with no diff
 * that looks like a security change — `if ($r === 'orders')` reads exactly the
 * same wherever it sits in the file. Nothing in the language or the tests
 * notices, and reviewing it means counting line numbers by eye.
 *
 * So this rig does not read the file. It takes the name of every route
 * admin.php implements, asks the running server for each one with no session,
 * and requires a 401. Then it asks again WITH a valid session but WITHOUT the
 * X-Sporta-Admin header and requires a 400 — that header is the CSRF backstop
 * behind SameSite=Strict, and it is enforced by the same one line.
 *
 * WHY IT ASKS FOR ALL OF THEM, including the POST-only ones. A GET to a
 * POST-only route falls through every `if` in the file to whatever the bottom
 * does. If the gate were bypassed, that fall-through is where an unauthorised
 * request would land, and the answer it gets should still be a 401 rather than
 * a 404 that says "no such route" — the difference tells an unauthenticated
 * scanner which routes exist.
 *
 * THE FOUR PUBLIC ONES ARE ASSERTED TOO, in the other direction: they must
 * NOT 401, or signing in would be impossible. That half is what stops someone
 * "fixing" a failure here by moving the gate to the top of the file.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const API = process.env.API ?? 'http://127.0.0.1:4300/api'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

// ---- the routes, read out of the server rather than kept in a list here ----
// A hand-written list is a list that goes stale, and the way it goes stale is
// by missing the route somebody just added — which is the exact route most
// likely to be in the wrong place.
const php = readFileSync(`${ROOT}/sporta-site/public_html/api/admin.php`, 'utf8')
const gateAt = php.indexOf('store_require_admin()')
if (gateAt < 0) {
  console.log('FAIL admin.php no longer calls store_require_admin() at all')
  process.exit(1)
}
const routes = []
for (const m of php.matchAll(/\$r === '([a-z_]+)'/g)) {
  const name = m[1]
  if (routes.some((x) => x.name === name)) continue
  routes.push({ name, public: m.index < gateAt })
}
const publicOnes = routes.filter((r) => r.public).map((r) => r.name)
const guarded = routes.filter((r) => !r.public)
console.log(`--- ${routes.length} routes in admin.php: ${publicOnes.length} before the gate (${publicOnes.join(', ')}), ${guarded.length} behind it`)

// THE PUBLIC LIST IS PINNED. Reading which routes are public out of the file
// and then checking that those routes are public proves nothing — it is the
// same number on both sides of the equals sign. These four are the only ones
// that may ever sit in front of the gate, and adding a fifth has to be a
// deliberate edit here, with a reason.
// login_code_resend is the fifth, and it earns its place the same way
// login_code does: at the point it runs there is NO session, only the pending
// marker store_login() left — so it cannot be behind a gate that requires one.
// What makes it safe is that it can only ever mail the account that marker
// names, at the address already on that account. There is no recipient in the
// body to choose, it refuses more than one message a minute from the row
// itself, and it is throttled per IP on top.
const MAY_BE_PUBLIC = ['login', 'login_code', 'login_code_resend', 'logout', 'me']
const unexpected = publicOnes.filter((r) => !MAY_BE_PUBLIC.includes(r))
check(unexpected.length === 0,
  unexpected.length
    ? `${unexpected.length} route(s) sit ABOVE store_require_admin() and are not on the allowed list: ${unexpected.join(', ')}`
    : `only the ${MAY_BE_PUBLIC.length} sign-in routes sit above the gate`)

const call = async (route, { cookie = '', header = true, method = 'GET' } = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(header ? { 'X-Sporta-Admin': '1' } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: method === 'POST' ? '{}' : undefined,
  })
  const set = res.headers.get('set-cookie')
  const m = set?.match(/(?:__Host-)?sporta_admin=([^;]+)/)
  return { status: res.status, cookie: m ? `sporta_admin=${m[1]}` : null,
           d: await res.json().catch(() => null) }
}

// ---------------------------------------- 1. signed out, every guarded route
console.log('\n--- signed out')
const leaked = []
for (const { name } of guarded) {
  for (const method of ['GET', 'POST']) {
    const r = await call(name, { method })
    // 401 not_signed_in is the only right answer. A 429 means the throttle
    // caught this rig, not that the route is safe, so it is called out rather
    // than counted as a pass.
    if (r.status === 429) { leaked.push(`${method} ${name} -> 429, throttled before it could be judged`); continue }
    if (r.status !== 401) leaked.push(`${method} ${name} -> ${r.status} ${JSON.stringify(r.d)?.slice(0, 80)}`)
  }
}
check(leaked.length === 0,
  leaked.length
    ? `${leaked.length} guarded route(s) answered something other than 401 with no session:\n       ` + leaked.join('\n       ')
    : `all ${guarded.length} guarded routes answer 401 to a stranger, on GET and on POST`)

// The four public ones must still work, or nobody can sign in.
console.log('\n--- and the sign-in routes are still reachable')
for (const name of MAY_BE_PUBLIC) {
  const r = await call(name, { method: name === 'me' ? 'GET' : 'POST' })
  // THE STATUS IS NOT THE TEST, the reason is. Posting an empty body to
  // ?r=login is a failed sign-in and 401 is the right answer to it — the first
  // version of this check read that as "the gate caught it" and reported the
  // login route as unreachable. What must never appear on these four is
  // `not_signed_in`, which is the gate's own refusal and would mean you have
  // to be signed in to sign in.
  const gated = r.d?.error === 'not_signed_in'
  check(!gated, `${name} is not behind the gate (${r.status} ${r.d?.error ?? 'ok'})`)
}

// -------------------------------- 2. signed in, but without the CSRF header
console.log('\n--- signed in, X-Sporta-Admin header missing')
const login = await call('login', { method: 'POST' })
let cookie = ''
{
  const res = await fetch(`${API}/admin.php?r=login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const m = res.headers.get('set-cookie')?.match(/(?:__Host-)?sporta_admin=([^;]+)/)
  if (m) cookie = `sporta_admin=${m[1]}`
  check(res.status === 200 && !!cookie, `signed in as ${EMAIL} (${res.status})`)
}

if (cookie) {
  check((await call('me', { cookie })).d !== null, 'the session works — ?r=me knows who this is')

  const unheadered = []
  for (const { name } of guarded) {
    const r = await call(name, { cookie, header: false })
    if (r.status === 429) { unheadered.push(`${name} -> 429, throttled before it could be judged`); continue }
    // 400, because the header is missing — not 401, which would mean the
    // session was rejected. Either refusal is safe; the distinction is what
    // says the check that fired is the one this test is about.
    if (r.status !== 400) unheadered.push(`${name} -> ${r.status}`)
  }
  check(unheadered.length === 0,
    unheadered.length
      ? `${unheadered.length} route(s) served a session without the header:\n       ` + unheadered.join('\n       ')
      : `all ${guarded.length} guarded routes refuse a real session that omits X-Sporta-Admin`)

  await fetch(`${API}/admin.php?r=logout`, {
    method: 'POST', headers: { 'X-Sporta-Admin': '1', Cookie: cookie },
  })
  check((await call('me', { cookie })).d === null, 'and logout ends it')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — one gate, and nothing is standing in front of it')
process.exit(fails ? 1 : 0)
