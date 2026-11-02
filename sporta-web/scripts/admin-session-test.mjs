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
writeFileSync(CFG, `<?php\nreturn ['admin_session_dir' => ${phpStr(SESS)}] + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)

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

// Tidy: the throwaway admin, and any events it logged.
try { await sql(`delete from admin_users where email = '${EMAIL}'`) } catch {
  await sql(`update admin_users set password_hash = 'x', email = concat('gone-', id, '@sporta.test') where email = '${EMAIL}'`).catch(() => {})
}
console.log(`\n(${readdirSync(SESS).length} session files left in the test directory)`)
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
