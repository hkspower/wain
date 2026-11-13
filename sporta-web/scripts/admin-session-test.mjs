// The 30-day admin sign-in (owner, 2026-11-02: "make long time backends
// login" → "30 days"), proven on a store of its own against the real MariaDB.
//
// WHY THE STORE IS STARTED HOSTILE. On the live server the coded "8 hours
// idle" was never what an admin got: PHP kept session files for its default
// 1440 s and swept on 1 request in 100, in a save path every session shares,
// so half an hour idle was a sign-out. This store runs with
//   -d session.gc_probability=1 -d session.gc_divisor=1 -d session.gc_maxlifetime=1
// — a sweep on EVERY session start with a one-second lifetime, the worst a
// host can configure — and the admin session must survive it anyway, because
// store_session_start() gives it its own directory and its own lifetime.
//
// Then, by editing the session file's clocks (nobody waits a week):
//   - the cookie is persistent, ~30 days, HttpOnly, SameSite=Strict;
//   - the session file lives in admin_session_dir, mode 0700, not the default;
//   - 6 days idle: still signed in (it was 8 HOURS); 8 days idle: signed out;
//   - 31 days since sign-in, used today: signed out (absolute);
//   - sign-out ends it; a password change ends it on every browser.
//
//   npm run test:admin-session    (needs the sandbox: npm run sandbox)
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = new URL('..', import.meta.url).pathname
const STORE_DIR = join(ROOT, 'dropin/php-store')
let passes = 0, fails = 0
const is = (c, n, d = '') => { if (c) { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
const sql = async (s) => (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', s])).stdout.trim()
const php = async (code) => (await run('php', ['-r', code])).stdout

const tmp = mkdtempSync(join(tmpdir(), 'sporta-admin-session-'))
const SESS = join(tmp, 'sessions')
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const CFG = join(tmp, 'config.php')
writeFileSync(CFG, `<?php\nreturn ['admin_session_dir' => ${phpStr(SESS)},
  'google_oauth_client_id' => 'test-client.apps.example', 'google_oauth_client_secret' => 'test-secret'] + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 200; p++) if (await isFree(p)) return p; throw new Error('no free port') }
const port = await freePort(8397)
const srv = spawn('php', ['-d', 'session.gc_probability=1', '-d', 'session.gc_divisor=1', '-d', 'session.gc_maxlifetime=1',
  '-S', `127.0.0.1:${port}`, '-t', STORE_DIR], { stdio: 'ignore', env: { ...process.env, SPORTA_API_CONFIG_FILE: CFG } })
process.on('exit', () => { try { srv.kill() } catch { /* gone */ } })
const BASE = `http://127.0.0.1:${port}`
let up = false
for (let i = 0; i < 80 && !up; i++) {
  await new Promise((r) => setTimeout(r, 100))
  try { up = (await fetch(`${BASE}/api.php?r=checkout_config`)).status === 200 } catch { /* starting */ }
}

// A throwaway admin of our own, so no other suite's lock, 2FA or password
// state can reach this one, and this one reaches nobody's.
const EMAIL = `session-test-${Date.now().toString(36)}@sporta.test`
const PASSWORD = randomBytes(12).toString('base64url')
const hash = async (pw) => (await php(`echo password_hash(${phpStr(pw)}, PASSWORD_DEFAULT);`)).trim()
await sql(`insert into admin_users (email, password_hash) values ('${EMAIL}', '${await hash(PASSWORD)}')`)

let cookie = ''
const req = async (r, { method = 'GET', body } = {}) => {
  const res = await fetch(`${BASE}/admin.php?r=${r}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) {
    const pair = c.split(';')[0]
    if (!/^(__Host-)?sporta_admin=/.test(pair)) continue
    cookie = /=(deleted)?$/.test(pair) || /max-age=0(;|$)/i.test(c) ? '' : pair
  }
  return { status: res.status, body: await res.json().catch(() => null), set }
}
const me = async () => (await req('me')).body?.email ?? null
const signIn = () => req('login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
const sessionFile = () => {
  const id = cookie.split('=')[1]
  return id ? join(SESS, `sess_${id}`) : null
}
// Rewrite one integer clock in the PHP session file (serialize_handler php:
// `name|i:123;`), and nothing else.
const setClock = (name, value) => {
  const f = sessionFile()
  const s = readFileSync(f, 'utf8')
  const t = s.replace(new RegExp(`(^|;|\\})${name}\\|i:\\d+;`), (m, pre) => `${pre}${name}|i:${value};`)
  if (t === s) throw new Error(`no ${name} in the session file`)
  writeFileSync(f, t)
}
const now = () => Math.floor(Date.now() / 1000)
const DAY = 86400

head('a store that sweeps sessions on every request, lifetime 1 s')
is(up, `the store is up on :${port}, with an admin of its own`, up ? EMAIL.replace(/@.*/, '@…') : 'did not start')
if (!up) process.exit(1)

head('signing in: a persistent 30-day cookie, a file in its own directory')
const login = await signIn()
is(login.status === 200 && login.body?.email === EMAIL, 'the admin signs in', `${login.status} ${login.body?.error ?? ''}`)
const sc = login.set.find((c) => /^(__Host-)?sporta_admin=/.test(c) && !/=deleted/.test(c)) || ''
const maxAge = Number((sc.match(/max-age=(\d+)/i) || [])[1])
is(maxAge >= 30 * DAY - 120 && maxAge <= 30 * DAY, 'the cookie is persistent for 30 days (it closed with the browser before)', `Max-Age ${maxAge}`)
is(/;\s*httponly/i.test(sc) && /samesite=strict/i.test(sc), 'and still HttpOnly + SameSite=Strict', sc.replace(/=[^;]+/, '=…'))
const f0 = sessionFile()
is(!!f0 && existsSync(f0), 'the session file is in admin_session_dir, not PHP\'s shared default path', f0 ? f0.replace(tmp, '<tmp>') : 'none')
is(existsSync(SESS) && (statSync(SESS).mode & 0o777) === 0o700, 'that directory is 0700', existsSync(SESS) ? (statSync(SESS).mode & 0o777).toString(8) : 'missing')
is((await me()) === EMAIL, 'the session holds across requests')

head('the sweep cannot end it early')
utimesSync(f0, now() - 2 * 3600, now() - 2 * 3600)
await req('me'); await req('me')
is((await me()) === EMAIL, 'a session file 2 hours old survives a sweep whose host lifetime is 1 second')

head('idle: 7 days, not 8 hours')
setClock('seen_at', now() - 6 * DAY)
is((await me()) === EMAIL, '6 days without use: still signed in (it was 8 hours)')
setClock('seen_at', now() - 8 * DAY)
is((await me()) === null, '8 days without use: signed out')
is(!existsSync(f0), 'and the expired session file is deleted, not left behind')

head('absolute: 30 days since sign-in, however often it is used')
await signIn()
setClock('started_at', now() - 31 * DAY)
is((await me()) === null, 'signed in 31 days ago and used today: signed out')
await signIn()
setClock('started_at', now() - 29 * DAY)
is((await me()) === EMAIL, 'signed in 29 days ago: still signed in')

head('what still ends it at once')
const out = await req('logout', { method: 'POST' })
is(out.status === 200 && cookie === '' && (await me()) === null, 'signing out ends it and clears the cookie')
await signIn()
is((await me()) === EMAIL, 'signed in again')
await sql(`update admin_users set password_hash = '${await hash(PASSWORD + '-changed')}' where email = '${EMAIL}'`)
is((await me()) === null, 'a password change ends the session on every browser (the fingerprint)')

head('anonymous requests leave nothing behind (no cookie, no file, 30 days or otherwise)')
// A request with no session cookie is not a session. store_session_start()
// used to create a 0-byte sess_ file for it, and with a 30-day lifetime that
// file is never swept: 240 requests a minute from one address is ~345,000
// inodes a day in the host directory the payment logs and voice cache share.
{
  const files = () => readdirSync(SESS).filter((f) => f.startsWith('sess_')).length
  const bare = async (r, { method = 'GET', cookieHeader } = {}) => {
    const res = await fetch(`${BASE}/admin.php?r=${r}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin',
                 ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      body: method === 'POST' ? '{}' : undefined,
    })
    return { status: res.status, set: res.headers.getSetCookie?.() ?? [], body: await res.json().catch(() => null) }
  }
  cookie = ''
  const before = files()
  const seen = []
  for (let i = 0; i < 10; i++) seen.push(await bare('me'))
  for (const r of ['orders', 'stats', 'no-such-route', '']) seen.push(await bare(r))
  seen.push(await bare('logout', { method: 'POST' }))
  seen.push(await bare('login_code', { method: 'POST' }))
  seen.push(await bare('change_initial_password', { method: 'POST' }))
  is(files() === before, 'fifteen cookieless admin requests (me, data routes, junk, logout, login_code) create no session file',
     `${files() - before} new file(s)`)
  is(seen.every((x) => !x.set.some((c) => /sporta_admin=/.test(c) && !/=deleted|max-age=0(;|$)/i.test(c))),
     'and none of them hands out a 30-day session cookie', seen.flatMap((x) => x.set).join(' | ') || 'no Set-Cookie')
  is(seen[0].status === 200 && seen[0].body === null && seen[10].status === 401 && seen[11].status === 401,
     'while the answers are unchanged: me says null, a data route 401', `${seen[0].status} ${seen[10].status} ${seen[11].status}`)
  is(seen[14].status === 200 && seen[15].status === 401 && seen[15].body?.error === 'code_expired',
     'and an unsigned logout / code step still answer as before', `${seen[14].status} ${seen[15].status} ${seen[15].body?.error}`)

  // A cookie that names no session (stale, forged, a scanner) is the same.
  const junk = `sporta_admin=${randomBytes(16).toString('hex')}`
  const b2 = files()
  const j1 = await bare('me', { cookieHeader: junk })
  await bare('orders', { cookieHeader: junk })
  await bare('logout', { method: 'POST', cookieHeader: junk })
  is(files() === b2 && j1.status === 200 && j1.body === null,
     'a cookie that names no session creates no file either', `${files() - b2} new file(s)`)

  // A wrong password is not a session.
  const b3 = files()
  const wrong = await bare('login', { method: 'POST' })
  const wrong2 = await fetch(`${BASE}/admin.php?r=login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email: EMAIL, password: 'definitely-wrong-password' }) })
  is(files() === b3 && wrong2.status === 401 && wrong.status >= 400,
     'a failed sign-in creates no session file', `${wrong2.status}; ${files() - b3} new file(s)`)

  // And the real thing still works afterwards.
  cookie = ''
  // (the account's password was changed by the section above)
  const again = await req('login', { method: 'POST', body: { email: EMAIL, password: PASSWORD + '-changed' } })
  is(again.status === 200, 'the admin signs in again', String(again.status))
  is((await me()) === EMAIL && files() === before + 1, 'a real sign-in still makes exactly one session',
     `${files() - before} new file(s)`)
  await req('logout', { method: 'POST' })
  is(files() === before, 'and signing out removes its file', `${files() - before} left over`)
}

head('linking Google from /backends: the flow session must survive the admin session directory')
// admin-google.php?action=start&intent=link reads the signed-in admin first
// (which points session.save_path at the admin directory, for the rest of the
// request) and THEN opens its own flow session. That flow session was written
// into the admin directory; the callback request opens it first, with PHP's
// default path, found nothing, and sent the owner to ?google=invalid. Over
// "HTTPS" (the proxy's X-Forwarded-Proto), as the real flow is.
{
  const H = { 'X-Forwarded-Proto': 'https', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin' }
  const jar = new Map()
  const hit = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${BASE}/${path}`, { method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...H,
                 ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]; const i = pair.indexOf('=')
      const name = pair.slice(0, i), value = pair.slice(i + 1)
      if (value === '' || value === 'deleted' || /max-age=0(;|$)/i.test(c)) jar.delete(name); else jar.set(name, value)
    }
    return { status: res.status, location: res.headers.get('location') ?? '', body: await res.json().catch(() => null) }
  }
  const li = await hit('admin.php?r=login', { method: 'POST', body: { email: EMAIL, password: PASSWORD + '-changed' } })
  is(li.status === 200 && jar.has('__Host-sporta_admin'), 'the admin signs in over HTTPS', `${li.status} ${[...jar.keys()].join(',')}`)
  const start = await hit('admin-google.php?action=start&intent=link')
  const state = new URL(start.location, 'https://x.test').searchParams.get('state') ?? ''
  is(start.status === 302 && /accounts\.google\.com/.test(start.location) && state.length === 64 && jar.has('__Host-sporta_google'),
     'start (intent=link) sends the owner to Google with a flow cookie', `${start.status} ${start.location.slice(0, 48)}`)
  const inAdminDir = readdirSync(SESS).filter((f) => f.startsWith('sess_'))
    .filter((f) => readFileSync(join(SESS, f), 'utf8').includes('google_flow'))
  is(inAdminDir.length === 0, 'the flow session is NOT written into the admin session directory', `${inAdminDir.length} file(s) there`)
  const cb = await hit(`admin-google.php?action=callback&state=${state}&code=not-a-real-code`)
  is(cb.status === 303 && !/google=invalid/.test(cb.location),
     'and the callback finds it: the flow carries on to Google (unreachable from here) instead of ?google=invalid', `${cb.status} ${cb.location}`)
  const cb2 = await hit(`admin-google.php?action=callback&state=${state}&code=again`)
  is(/google=invalid/.test(cb2.location), 'a flow is one use: a replay is invalid', cb2.location)
  // The sign-in intent was always consistent and must stay so.
  const jar2 = new Map([...jar].filter(([k]) => k !== '__Host-sporta_google'))
  jar.clear(); for (const [k, v] of jar2) jar.set(k, v)
  const startL = await hit('admin-google.php?action=start')
  const stateL = new URL(startL.location, 'https://x.test').searchParams.get('state') ?? ''
  const cbL = await hit(`admin-google.php?action=callback&state=${stateL}&code=x`)
  is(startL.status === 302 && !/google=invalid/.test(cbL.location), 'the sign-in intent (no link) still round-trips', `${cbL.location}`)
  // Every Google result returns to /backends WITHOUT a slash: the root .htaccess
  // answers /backends/ with a 404, while /backends serves the admin shell.
  is(/^https:\/\/www\.sporta\.com\.kw\/backends\?(tab=settings&)?google=/.test(cbL.location),
     'the Google result lands on /backends (no trailing slash)', `${cbL.location}`)
  // Only openid is requested: the email claim is never read.
  is(/[?&]scope=openid(&|$)/.test(startL.location), 'the Google sign-in asks for openid only', startL.location)
  await hit('admin.php?r=logout', { method: 'POST' })
}

// Tidy: the throwaway admin, and any events it logged.
try { await sql(`delete from admin_users where email = '${EMAIL}'`) } catch {
  await sql(`update admin_users set password_hash = 'x', email = concat('gone-', id, '@sporta.test') where email = '${EMAIL}'`).catch(() => {})
}
console.log(`\n(${readdirSync(SESS).length} session files left in the test directory)`)
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
