// Two web containers behind one address ("Load Balancing", owner 2026-11-19), proven on this machine.
//
// The live shop is ONE container (apache-sporta-1). Putting a second one beside it is a compose change (ops/lb/README.md); what
// decides whether that is SAFE is the code: anything a request leaves in the container instead of the database or a shared mount
// would be missing on the other container. This suite starts two PHP servers that behave like two containers - each with its OWN
// temp directory and its OWN default session path (the container's /tmp), a different process, a different port - and ONE
// MariaDB and ONE set of shared directories (the stand-in for /var/lib/sporta, the host's /docker/sporta/private/voice). Then it
// sends a browser from the first to the second, the way Traefik's round robin does.
//
//   1. a customer who signs in on A is signed in on B; signing out on B signs out A; a sign-in on B holds on A
//   2. the same through a rebuilt container (A is stopped and started again with an EMPTY /tmp)
//   3. a host that sweeps session files every request with a lifetime of ONE second (the live PHP keeps 1440 s and sweeps 1 in 100)
//      cannot end a customer's session early, and the session obeys the account rules (8 hours idle, 7 days in all), not the sweep
//   4. nothing falls through to a container's own default path (those directories stay empty)
//   5. a stale or forged cookie, and a request with no cookie, leave no file behind (the files now live 7 days)
//   6. the admin session and the Google sign-in flow (start on A, callback on B) cross containers
//   7. the sign-in limits are counted in the database: failures split between A and B add up
//   8. a control: a third server whose customer directory is NOT shared does not see A's customer (so the checks above can fail)
//
//   npm run test:multi-replica    (needs the sandbox: npm run sandbox)
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = new URL('..', import.meta.url).pathname
const STORE_DIR = join(ROOT, 'dropin/php-store')
let passes = 0, fails = 0
const is = (c, n, d = '') => { if (c) { passes++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sql = async (s) => (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', s])).stdout.trim()
const php = async (code) => (await run('php', ['-r', code])).stdout
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)

const tmp = mkdtempSync(join(tmpdir(), 'sporta-replicas-'))
const SHARED = { admin: join(tmp, 'shared/admin'), customer: join(tmp, 'shared/customer'), google: join(tmp, 'shared/google') }
for (const d of Object.values(SHARED)) mkdirSync(d, { recursive: true })
const cfgFile = (name, over) => {
  const f = join(tmp, `config-${name}.php`)
  writeFileSync(f, `<?php\nreturn ${over} + ['google_oauth_client_id' => 'test-client.apps.example', 'google_oauth_client_secret' => 'test-secret',
  'order_cooldown_seconds' => 0] + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)
  return f
}
const CFG = cfgFile('shared', `['admin_session_dir' => ${phpStr(SHARED.admin)}, 'customer_session_dir' => ${phpStr(SHARED.customer)}, 'google_session_dir' => ${phpStr(SHARED.google)}]`)
const CTRL_CUSTOMER = join(tmp, 'control-customer'); mkdirSync(CTRL_CUSTOMER, { recursive: true })
const CFG_CTRL = cfgFile('control', `['admin_session_dir' => ${phpStr(SHARED.admin)}, 'customer_session_dir' => ${phpStr(CTRL_CUSTOMER)}, 'google_session_dir' => ${phpStr(SHARED.google)}]`)

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 300; p++) if (await isFree(p)) return p; throw new Error('no free port') }
const servers = []
process.on('exit', () => { for (const s of servers) { try { s.kill() } catch { /* gone */ } } })

// One "container": its own temp directory (TMPDIR) and its own default session path, both EMPTY when it starts, like a fresh container's /tmp.
// `hostile`: sweep session files on every session start with a lifetime of one second, the worst a host can configure.
const startContainer = async (name, config, { hostile = true, from = 8420 } = {}) => {
  const own = join(tmp, `container-${name}-${randomBytes(3).toString('hex')}`)
  const ownTmp = join(own, 'tmp'), ownSessions = join(own, 'sessions-default')
  mkdirSync(ownTmp, { recursive: true }); mkdirSync(ownSessions, { recursive: true })
  const port = await freePort(from)
  const args = [...(hostile ? ['-d', 'session.gc_probability=1', '-d', 'session.gc_divisor=1', '-d', 'session.gc_maxlifetime=1'] : []),
    '-d', `session.save_path=${ownSessions}`, '-S', `127.0.0.1:${port}`, '-t', STORE_DIR]
  const proc = spawn('php', args, { stdio: 'ignore', env: { ...process.env, SPORTA_API_CONFIG_FILE: config, TMPDIR: ownTmp } })
  servers.push(proc)
  const base = `http://127.0.0.1:${port}`
  let up = false
  for (let i = 0; i < 80 && !up; i++) {
    await new Promise((r) => setTimeout(r, 100))
    try { up = (await fetch(`${base}/api.php?r=checkout_config`)).status === 200 } catch { /* starting */ }
  }
  return { name, base, port, proc, ownTmp, ownSessions, up, stop: () => { try { proc.kill() } catch { /* gone */ } } }
}
const ownFiles = (c) => readdirSync(c.ownSessions).filter((f) => f.startsWith('sess_')).length + readdirSync(c.ownTmp).filter((f) => f.startsWith('sess_')).length

// A browser: one cookie jar that can be sent to either container.
const browser = () => ({ jar: new Map() })
const call = async (base, b, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`${base}/${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Customer': '1', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin', ...headers,
               ...(b.jar.size ? { Cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) {
    const pair = c.split(';')[0]; const i = pair.indexOf('=')
    const name = pair.slice(0, i), value = pair.slice(i + 1)
    if (value === '' || value === 'deleted' || /max-age=0(;|$)/i.test(c) || /expires=thu, 01[ -]jan[ -]1970/i.test(c)) b.jar.delete(name); else b.jar.set(name, value)
  }
  return { status: res.status, location: res.headers.get('location') ?? '', body: await res.json().catch(() => null), set }
}
const meOf = async (c, b) => (await call(c.base, b, 'customer.php?r=me')).body?.email ?? null
const customerFiles = () => readdirSync(SHARED.customer).filter((f) => f.startsWith('sess_'))
const customerFile = (b) => { const id = b.jar.get('sporta_customer'); return id ? join(SHARED.customer, `sess_${id}`) : null }
// Rewrites one integer clock in a PHP session file (`name|i:123;`). False, not a throw, when there is no such file or clock: the check after it then fails
// on its own, and the run goes on to clean up.
const setClock = (file, name, value) => {
  try {
    const s = readFileSync(file, 'utf8')
    const t = s.replace(new RegExp(`(^|;|\\})${name}\\|i:\\d+;`), (m, pre) => `${pre}${name}|i:${value};`)
    if (t === s) return false
    writeFileSync(file, t)
    return true
  } catch { return false }
}

head('two containers, one database, one set of shared directories')
await sql('delete from rate_limit')
const A = await startContainer('A', CFG, { from: 8420 })
const B = await startContainer('B', CFG, { from: A.port + 1 })
is(A.up && B.up && A.port !== B.port, `container A :${A.port} and container B :${B.port} are up`, A.up && B.up ? '' : 'did not start')
if (!A.up || !B.up) process.exit(1)
is(A.ownTmp !== B.ownTmp && A.ownSessions !== B.ownSessions, 'each has its own temp directory and its own default session path (a container\'s /tmp)')

const EMAIL = `replica-${Date.now().toString(36)}@sporta.test`
const PASSWORD = randomBytes(12).toString('base64url') + 'Aa1'
const me1 = browser()

head('a customer signs in on A and is the same customer on B')
const reg = await call(A.base, me1, 'customer.php?r=register', { method: 'POST', body: { name: 'Replica Test', email: EMAIL, password: PASSWORD } })
is(reg.status === 201 && me1.jar.has('sporta_customer'), 'registering on A signs the customer in (a session cookie)', `${reg.status} ${[...me1.jar.keys()].join(',')}`)
const f1 = customerFile(me1)
is(!!f1 && existsSync(f1), 'the session file is in customer_session_dir, the shared directory', f1 ? f1.replace(tmp, '<tmp>') : 'none')
is((await meOf(A, me1)) === EMAIL, 'on A: signed in')
is((await meOf(B, me1)) === EMAIL, 'on B, with the same cookie: signed in too (it was NOT before: B had no such file in its own /tmp)')
const out = await call(B.base, me1, 'customer.php?r=logout', { method: 'POST', body: {} })
is(out.status === 200 && (await meOf(A, me1)) === null && (await meOf(B, me1)) === null, 'signing out on B signs out A as well')
const li = await call(B.base, me1, 'customer.php?r=login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
is(li.status === 200 && (await meOf(A, me1)) === EMAIL, 'a sign-in on B holds on A', String(li.status))

head('a rebuilt container: A is stopped and started again with an empty /tmp')
A.stop()
await new Promise((r) => setTimeout(r, 300))
const A2 = await startContainer('A2', CFG, { from: B.port + 1 })
is(A2.up && ownFiles(A2) === 0, 'a new container A2 starts with nothing of its own', A2.up ? `${ownFiles(A2)} session files in its /tmp` : 'did not start')
is((await meOf(A2, me1)) === EMAIL, 'the customer who signed in before the rebuild is still signed in')

head('the sweep cannot end it early, and the account rules still do')
const f2 = customerFile(me1)
try { utimesSync(f2, now() - 2 * 3600, now() - 2 * 3600) } catch { /* no such file: the check below fails */ }
await meOf(A2, me1); await meOf(B, me1)
is((await meOf(A2, me1)) === EMAIL, 'a session file 2 hours old survives a host that sweeps every request with a 1 second lifetime')
setClock(f2, 'customer_seen_at', now() - (8 * 3600 - 120))
is((await meOf(B, me1)) === EMAIL, '7 h 58 min without use: still signed in')
setClock(f2, 'customer_seen_at', now() - (8 * 3600 + 120))
is((await meOf(B, me1)) === null, '8 h 02 min without use: signed out (the 8 hours of customer_session_valid, not the sweep\'s 24 minutes)')
is(!existsSync(f2), 'and the ended session\'s file is deleted')
await call(A2.base, me1, 'customer.php?r=login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
const f3 = customerFile(me1)
setClock(f3, 'customer_started_at', now() - (7 * DAY - 300))
is((await meOf(A2, me1)) === EMAIL, 'signed in 6 d 23 h 55 min ago: still signed in')
setClock(f3, 'customer_started_at', now() - (7 * DAY + 300))
is((await meOf(A2, me1)) === null, 'signed in 7 d 5 min ago, used a moment ago: signed out (7 days in all)')

head('nothing falls through to a container\'s own /tmp')
await call(A2.base, me1, 'customer.php?r=login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
await meOf(B, me1)
is(ownFiles(A2) === 0 && ownFiles(B) === 0, 'after sign-ins, reads and sign-outs on both, the default session paths and temp directories hold no session file', `A2 ${ownFiles(A2)}, B ${ownFiles(B)}`)

head('stale, forged and absent cookies leave no file (the files now live 7 days)')
{
  const before = customerFiles().length
  const none = browser(); const junk = browser(); junk.jar.set('sporta_customer', randomBytes(16).toString('hex'))
  const seen = []
  for (let i = 0; i < 8; i++) { seen.push(await call(A2.base, none, 'customer.php?r=me')); seen.push(await call(B.base, junk, 'customer.php?r=me')) }
  await call(B.base, junk, 'customer.php?r=logout', { method: 'POST', body: {} })
  is(customerFiles().length === before, 'sixteen /me reads (half with a cookie that names no session) and a sign-out create no session file', `${customerFiles().length - before} new file(s)`)
  is(seen.every((x) => x.status === 200 && x.body === null), 'and every one still answers "not signed in"', seen.map((x) => x.status).join(','))
  is(seen.filter((_, i) => i % 2 === 0).every((x) => !x.set.some((c) => /sporta_customer=/.test(c))), 'a request with no cookie is never handed a session cookie')
  is(!junk.jar.has('sporta_customer'), 'and the forged cookie is expired in the browser, not replaced by a live one')
}

head('the admin session and the Google sign-in flow cross containers')
const ADMIN = `replica-admin-${Date.now().toString(36)}@sporta.test`
const APASS = randomBytes(12).toString('base64url')
await sql(`insert into admin_users (email, password_hash) values ('${ADMIN}', '${(await php(`echo password_hash(${phpStr(APASS)}, PASSWORD_DEFAULT);`)).trim()}')`)
const adm = browser()
const aLogin = await call(A2.base, adm, 'admin.php?r=login', { method: 'POST', body: { email: ADMIN, password: APASS } })
is(aLogin.status === 200 && aLogin.body?.email === ADMIN, 'the admin signs in on A', String(aLogin.status))
const adminOnB = await call(B.base, adm, 'admin.php?r=me')
is(adminOnB.body?.email === ADMIN, 'and is signed in on B with the same cookie')
is(readdirSync(SHARED.admin).some((f) => f.startsWith('sess_')) && ownFiles(A2) === 0 && ownFiles(B) === 0, 'the file is in admin_session_dir and no container kept one of its own')
await call(B.base, adm, 'admin.php?r=logout', { method: 'POST' })
is((await call(A2.base, adm, 'admin.php?r=me')).body === null, 'signing out on B signs the admin out on A')
{
  const H = { 'X-Forwarded-Proto': 'https' }
  const g = browser()
  const start = await call(A2.base, g, 'admin-google.php?action=start', { headers: H })
  const state = new URL(start.location, 'https://x.test').searchParams.get('state') ?? ''
  is(start.status === 302 && /accounts\.google\.com/.test(start.location) && state.length === 64 && g.jar.has('__Host-sporta_google'),
     'the Google flow starts on A (a redirect to Google and a flow cookie)', `${start.status} ${start.location.slice(0, 40)}`)
  const flowFile = readdirSync(SHARED.google).filter((f) => f.startsWith('sess_')).filter((f) => readFileSync(join(SHARED.google, f), 'utf8').includes('google_flow'))
  is(flowFile.length === 1 && ownFiles(A2) === 0 && ownFiles(B) === 0, 'its session is in google_session_dir, not in either container', `${flowFile.length} in the shared directory`)
  const cb = await call(B.base, g, `admin-google.php?action=callback&state=${state}&code=not-a-real-code`, { headers: H })
  is(cb.status === 303 && !/google=invalid/.test(cb.location), 'the callback lands on B and FINDS the flow: it carries on (Google is unreachable from here) instead of ?google=invalid', `${cb.status} ${cb.location}`)
  const cb2 = await call(A2.base, g, `admin-google.php?action=callback&state=${state}&code=again`, { headers: H })
  is(/google=invalid/.test(cb2.location), 'a flow is one use on either container: the replay is invalid', cb2.location)
}

head('the sign-in limits are counted in the database, so two containers add up')
{
  // How many wrong attempts are answered before the first refusal (429), with the attempts sent to the given containers in turn. The limit's own
  // size is not what is proved here (the suites that own the limits do that): it is that the SAME number of attempts is allowed whether they all
  // go to one container or alternate between two, i.e. there is one counter and it is not in either container.
  const allowedBefore429 = async (targets, send) => {
    await sql('delete from rate_limit')
    let n = 0
    for (let i = 0; i < 60; i++) { const st = await send(targets[i % targets.length]); if (st === 429) break; n++ }
    await sql('delete from rate_limit')
    return n
  }
  // The limits count in windows aligned to the clock (900 s): a measurement that happens to straddle a boundary sees the counter reset half way, so the pair
  // is measured again (up to three times). A counter that is NOT shared would give about twice the single-container number every time and still fail.
  const pair = async (send) => {
    let alone = 0, split = 0
    for (let k = 0; k < 3; k++) {
      alone = await allowedBefore429([A2], send)
      split = await allowedBefore429([A2, B], send)
      if (split === alone) break
    }
    return { alone, split }
  }
  const wrongAdmin = async (c) => (await call(c.base, browser(), 'admin.php?r=login', { method: 'POST', body: { email: ADMIN, password: 'definitely-wrong-password' } })).status
  const { alone, split } = await pair(wrongAdmin)
  is(alone >= 3 && alone <= 20 && split === alone, 'admin sign-in: the refusal comes after the same number of wrong passwords on one container and on two taking turns', `${alone} alone, ${split} split`)
  await sql('delete from rate_limit')
  for (let i = 0; i < 20; i++) { if ((await wrongAdmin(i % 2 ? B : A2)) === 429) break }
  const rightA = await call(A2.base, browser(), 'admin.php?r=login', { method: 'POST', body: { email: ADMIN, password: APASS } })
  const rightB = await call(B.base, browser(), 'admin.php?r=login', { method: 'POST', body: { email: ADMIN, password: APASS } })
  is(rightA.status === 429 && rightB.status === 429, 'once the limit is reached the RIGHT password is refused on A and on B alike (429)', `${rightA.status} / ${rightB.status}`)
  const wrongCustomer = async (c) => (await call(c.base, browser(), 'customer.php?r=login', { method: 'POST', body: { email: EMAIL, password: 'definitely-wrong-password' } })).status
  const { alone: cAlone, split: cSplit } = await pair(wrongCustomer)
  is(cAlone >= 3 && cAlone <= 30 && cSplit === cAlone, 'customer sign-in: the same, one counter for both containers', `${cAlone} alone, ${cSplit} split`)
}

head('control: a container whose customer directory is NOT shared does not see the customer')
{
  const C = await startContainer('C', CFG_CTRL, { from: B.port + 2 })
  const b = browser()
  await call(A2.base, b, 'customer.php?r=login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
  is(C.up && (await meOf(A2, b)) === EMAIL, 'the customer is signed in on A', C.up ? '' : 'C did not start')
  is((await meOf(C, b)) === null, 'but on C, which keeps customer sessions elsewhere, the same cookie is "not signed in" (the check can fail)')
  C.stop()
}

// Tidy: the throwaway customer and admin.
try { await sql(`delete from customer_accounts where email = '${EMAIL}'`) } catch { /* left for the next clean-up */ }
try { await sql(`delete from admin_users where email = '${ADMIN}'`) } catch {
  await sql(`update admin_users set password_hash = 'x', email = concat('gone-', id, '@sporta.test') where email = '${ADMIN}'`).catch(() => {})
}
await sql('delete from rate_limit').catch(() => {})
try { rmSync(tmp, { recursive: true, force: true }) } catch { /* temp */ }
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
