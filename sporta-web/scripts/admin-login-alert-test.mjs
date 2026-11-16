// The sign-in alerts (owner, 2026-11-16: "make any unknown login attempt alert
// at log and email cs@"), proven on a store of its own against the real MariaDB.
//
// Every failed sign-in is written to admin_activity_log. At most one mail goes
// out per five minutes, to admin_alert_email, and that mail says how many
// sign-in events the window holds. A correct password from a browser that has
// never signed in here is written and mailed too; a browser that has signed in
// before (it holds the device cookie) is not. The answer the attacker gets does
// not change, and an unknown address and a known one get the same answer.
//
// The mailer is a stand-in: php's mail() runs a shell script that keeps each
// message in a directory, so the test reads what would have been sent.
//
//   npm run test:admin-login-alert    (needs the sandbox: npm run sandbox)
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const count = async (s) => Number(await sql(s)) || 0

const tmp = mkdtempSync(join(tmpdir(), 'sporta-login-alert-'))
const SESS = join(tmp, 'sessions')
const MAILDIR = join(tmp, 'mail')
const MTA = join(tmp, 'mta.sh')
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const ALERT_TO = 'alerts-test@sporta.com.kw'

// The stand-in sendmail: php's mail() pipes the whole message to it.
writeFileSync(MTA, '#!/bin/sh\nd="$1"; mkdir -p "$d"\ncat > "$d/msg-$(date +%s%N)-$$.eml"\n')
const CFG = join(tmp, 'config.php')
// The sender is the verified mailbox a reset uses (admin_mail_from); the sandbox
// config has none, and an alert without one is refused on purpose.
writeFileSync(CFG, `<?php\nreturn ['admin_session_dir' => ${phpStr(SESS)}, 'admin_alert_email' => ${phpStr(ALERT_TO)},
  'admin_mail_from' => 'alerts-sender@sporta.com.kw']`
  + ` + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 200; p++) if (await isFree(p)) return p; throw new Error('no free port') }
const port = await freePort(8417)
const srv = spawn('php', ['-d', `sendmail_path=sh ${MTA} ${MAILDIR}`, '-S', `127.0.0.1:${port}`, '-t', STORE_DIR],
  { stdio: 'ignore', env: { ...process.env, SPORTA_API_CONFIG_FILE: CFG } })
process.on('exit', () => { try { srv.kill() } catch { /* gone */ } })
const BASE = `http://127.0.0.1:${port}`
let up = false
for (let i = 0; i < 80 && !up; i++) {
  await new Promise((r) => setTimeout(r, 100))
  try { up = (await fetch(`${BASE}/api.php?r=checkout_config`)).status === 200 } catch { /* starting */ }
}

const mails = () => (existsSync(MAILDIR) ? readdirSync(MAILDIR).map((f) => readFileSync(join(MAILDIR, f), 'utf8')) : [])
const rnd = () => randomBytes(6).toString('base64url').toLowerCase()
const PASSWORD = randomBytes(12).toString('base64url')
const hash = async (pw) => (await run('php', ['-r', `echo password_hash(${phpStr(pw)}, PASSWORD_DEFAULT);`])).stdout.trim()

// A browser is a cookie jar of one: the device cookie it was given at its
// first sign-in, when it is sent back, is what makes it a known browser.
const login = async (email, password, cookieHeader = '') => {
  const res = await fetch(`${BASE}/admin.php?r=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin',
               ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    body: JSON.stringify({ email, password }),
  })
  const set = res.headers.getSetCookie?.() ?? []
  const dev = set.map((c) => c.split(';')[0]).find((p) => /^(__Host-)?sporta_dev=/.test(p) && !/=$/.test(p)) || ''
  return { status: res.status, body: await res.json().catch(() => null), dev }
}

const ADMIN = `alert-${rnd()}@sporta.test`
const UNKNOWN = `nobody-${rnd()}@sporta.test`
await sql(`insert into admin_users (email, password_hash) values ('${ADMIN}', '${await hash(PASSWORD)}')`)
const ADMIN_ID = Number(await sql(`select id from admin_users where email = '${ADMIN}'`))

head('the store is up, with an admin of its own')
is(up, `the store is up on :${port}`, up ? '' : 'did not start')
if (!up) process.exit(1)

head('an unknown address and a wrong password get the same answer')
await sql('delete from rate_limit')
const before0 = mails().length
const unknown = await login(UNKNOWN, 'wrong-password-1')
const known = await login(ADMIN, 'wrong-password-2')
is(unknown.status === 401 && unknown.body?.error === 'bad_credentials', 'an address with no account: 401 bad_credentials', `${unknown.status} ${unknown.body?.error ?? ''}`)
is(known.status === unknown.status && known.body?.error === unknown.body?.error, 'a real account with a wrong password: the same status and the same error',
   `${known.status} ${known.body?.error ?? ''}`)

head('every failure is in the Activity log, with the address it named')
is(await count(`select count(*) from admin_activity_log where action_key = 'signin_password' and actor_admin_id is null and actor_email = '${UNKNOWN}'`) === 1,
   'the unknown address is logged once, with no account attached')
is(await count(`select count(*) from admin_activity_log where action_key = 'signin_password' and actor_admin_id = ${ADMIN_ID} and actor_email = '${ADMIN}'`) === 1,
   'the real account is logged once, against its own id')

head('the mail: one per window, to the configured address, no secrets in it')
const afterFirst = mails()
is(afterFirst.length === before0 + 1, 'the first failure mails the owner once', `${afterFirst.length - before0} mail(s)`)
const first = afterFirst[afterFirst.length - 1] ?? ''
is(first.includes(`To: ${ALERT_TO}`), `it goes to the configured address (${ALERT_TO})`)
is(first.includes(`Address typed: ${UNKNOWN}`), 'it names the address that was typed')
// The window may hold rows from earlier runs and other suites, so the count is
// checked for being a real number of events that exist, not for a fixed one.
const firstCount = Number((first.match(/Sign-in events in the last 5 minutes: (\d+)/) || [])[1])
const liveWindow = await count(`select count(*) from admin_activity_log where action_key in ('signin_password','signin_code','signin_passcode','signin_new_browser') and created_at >= now() - interval 300 second`)
is(firstCount >= 1 && firstCount <= liveWindow, 'and says how many events the window holds (a number the log really has)', `mail ${firstCount}, log ${liveWindow}`)
is(!first.includes('wrong-password-1') && !first.includes('wrong-password-2'), 'and never carries a password')
is(!/From IP address: unknown/.test(first) && /From IP address: \S+/.test(first), 'the IP address is in the mail once')
is(mails().length === before0 + 1, 'the second failure, inside the same window, adds no mail (it is in the log)')

head('the next window: one more mail, with the running count')
await sql('delete from rate_limit')   // the five minutes have passed
await login(UNKNOWN, 'wrong-password-3')
const second = mails()
is(second.length === before0 + 2, 'the first failure after the window mails again', `${second.length - before0} mail(s) in total`)
const latest = second[second.length - 1] ?? ''
const n = Number((latest.match(/Sign-in events in the last 5 minutes: (\d+)/) || [])[1])
is(n >= 3, 'and counts the sign-in events in the window (at least the three made here)', `count ${n}`)

head('a correct password from a browser that has never signed in is mailed')
await sql('delete from rate_limit')
const beforeNew = mails().length
const fresh = await login(ADMIN, PASSWORD)
is(fresh.status === 200 && fresh.body?.email === ADMIN, 'the correct password still signs in (the answer is unchanged)', `${fresh.status}`)
is(!!fresh.dev, 'and the browser is given its device cookie, so the next sign-in counts as a known one')
is(await count(`select count(*) from admin_activity_log where action_key = 'signin_new_browser' and actor_admin_id = ${ADMIN_ID}`) === 1,
   'the sign-in is logged as a new browser')
is(mails().length === beforeNew + 1, 'and mailed', `${mails().length - beforeNew} mail(s)`)
const newMail = mails().at(-1) ?? ''
is(newMail.includes(`Address typed: ${ADMIN}`) && newMail.includes('has never signed in'), 'the mail says so and names the account')

head('a browser that has signed in before is not mailed')
await sql('delete from rate_limit')
const beforeKnown = mails().length
const again = await login(ADMIN, PASSWORD, fresh.dev)
is(again.status === 200 && again.body?.email === ADMIN, 'the same browser signs in again', `${again.status}`)
is(await count(`select count(*) from admin_activity_log where action_key = 'signin_new_browser' and actor_admin_id = ${ADMIN_ID}`) === 1,
   'and it is not logged as a new browser a second time')
is(mails().length === beforeKnown, 'and no mail goes out for it')

head('a junk address is recorded for what it is')
await sql('delete from rate_limit')
const junk = await login('not an address', 'x')
is(junk.status === 401 && junk.body?.error === 'bad_credentials', 'the answer is the same 401', `${junk.status}`)
is(await count(`select count(*) from admin_activity_log where action_key = 'signin_password' and actor_email = 'not an email address' and actor_admin_id is null`) >= 1,
   'it is logged as "not an email address", not as what was typed')

// Tidy: the throwaway admin. The mail directory and the server go with the process.
try { await sql(`delete from admin_users where email = '${ADMIN}'`) } catch {
  await sql(`update admin_users set password_hash = 'x', email = concat('gone-', id, '@sporta.test') where email = '${ADMIN}'`).catch(() => {})
}
console.log(`\n${passes} passed, ${fails} failed`)
try { srv.kill() } catch { /* gone */ }
process.exit(fails ? 1 : 0)
