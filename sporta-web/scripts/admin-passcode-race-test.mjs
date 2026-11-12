// The admin device-passcode lock under concurrency (audit M2, 2026-11-12).
//
//   node scripts/admin-passcode-race-test.mjs        (npm run test:admin-passcode-race)
//
// Private MariaDB + `php -S` with 16 workers on free ports; never the shared sandbox, a config.php or the network.
// Before the fix the failure counter was read in one statement and written in another after password_verify, so 40
// parallel wrong guesses were ALL evaluated against a limit of five (audit-otp-race-probe.mjs: 36 x 401 + 4 x 423).
// Now every attempt must win a guarded UPDATE before the passcode is checked. This proves:
//   1. 40 parallel wrong guesses: at most five are evaluated (401 wrong_passcode, or the 423 that sets the lock);
//   2. sequential: 401 x4, then 423 on the fifth, and 423 after it (the old behaviour, kept);
//   3. a correct passcode after the lock is refused until the lock expires, then works;
//   4. the daily cap: twenty evaluations per account per day, then 423 even with the lock expired;
//   5. the alert mail: one "wrong device passcodes" mail per lock and one for the daily cap;
//   6. the race window held open (0.4 s between claim and check): still five at most; and the MUTATION, the claim's
//      guard removed (the old check-then-act) with the same wide window, evaluates more than five, so this suite fails
//      without the fix.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHmac } from 'node:crypto'
import { startPrivateMariadb, toolsPresent, sleep } from './lib/private-mariadb.mjs'
import { applyAll, sqlInventory, toolingOrder, freshDb } from './db-schema-diff.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PHPDIR = join(ROOT, 'dropin/php-store')
const tp = toolsPresent()
if (tp.missing.length) { console.log('SKIP: missing ' + tp.missing.join(', ')); process.exit(0) }

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  - ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))

const work = mkdtempSync(join(tmpdir(), 'passcode-race-'))
const inst = await startPrivateMariadb({ label: 'pcrace', portFrom: 33950 })
const DB = 'pcr_' + randomBytes(3).toString('hex')
const servers = []
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })

try {
  await freshDb(inst, DB)
  const res = applyAll(inst, DB, toolingOrder(sqlInventory(PHPDIR)), PHPDIR)
  const warn = res.filter((r) => !r.ok)
  if (warn.length) console.log('migration warnings: ' + warn.map((b) => b.file).join(', '))
  const sql = (q) => inst.sql(q, DB)

  const maildir = join(work, 'mail'); mkdirSync(maildir)
  const mta = join(work, 'mta.sh')
  writeFileSync(mta, 'f="$1/$(date +%s%N)-$$.eml"; cat > "$f"\n')
  const cfgFile = join(work, 'api-config.php')
  mkdirSync(join(work, 'sess'))
  writeFileSync(cfgFile, `<?php\nreturn ['db_host' => '127.0.0.1;port=${inst.port}', 'db_name' => '${DB}', 'db_user' => 'root', 'db_pass' => '', 'session_secret' => '${randomBytes(16).toString('hex')}', 'admin_session_dir' => '${join(work, 'sess')}', 'mail_from' => 'cs@sporta.com.kw', 'admin_mail_from' => 'cs@sporta.com.kw', 'rate_limit_secret' => 'race-rl-secret'];\n`)

  // A site directory per variant: the real code, and the mutant with the claim's guard removed.
  // `widen` holds every request for 0.4 s between the claim and the passcode check, so a burst is certain to overlap
  // there whatever the machine's load (the race window made wide on purpose, as a race test should).
  const site = (name, mutate, widen = false) => {
    const dir = join(work, name); mkdirSync(dir)
    cpSync(PHPDIR, join(dir, 'api'), { recursive: true })
    rmSync(join(dir, 'api/config.php'), { force: true })
    if (widen) {
      const f = join(dir, 'api/store.php')
      const src = readFileSync(f, 'utf8')
      const anchor = "    if (!store_admin_verify_password($passcode, (string)$u['passcode_hash'])) {\n        if ($attempt"
      if (!src.includes(anchor)) throw new Error('widen anchor not found: the passcode check moved')
      writeFileSync(f, src.replace(anchor, '    usleep(400000);\n' + anchor))
    }
    if (mutate) {
      const f = join(dir, 'api/store.php')
      const src = readFileSync(f, 'utf8')
      // Both halves of the claim's guard go: the open-lock test and the five-slot test. What is left counts the
      // attempt but lets it through, which is the old read-then-write behaviour.
      const at = src.indexOf('$claim = $db->prepare(')
      const guards = ['and (passcode_locked_until is null or passcode_locked_until <= now())',
        "and (passcode_failed < ' . STORE_ADMIN_PASSCODE_MAX_WRONG . '"]
      let tail = src.slice(at)
      for (const g of guards) {
        if (at < 0 || !tail.includes(g)) throw new Error('mutation anchor not found: the claim guard moved')
        tail = tail.replace(g, 'and (1 > 0 ' + (g.endsWith(')') ? ')' : ''))
      }
      writeFileSync(f, src.slice(0, at) + tail)
    }
    return dir
  }
  const start = async (dir) => {
    const port = await freePort()
    const srv = spawn('php', ['-d', `sendmail_path=sh ${mta} ${maildir}`, '-S', `127.0.0.1:${port}`, '-t', dir],
      { env: { ...process.env, SPORTA_API_CONFIG_FILE: cfgFile, PHP_CLI_SERVER_WORKERS: '16' }, stdio: 'ignore' })
    servers.push(srv)
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin.php?r=google_available`); break } catch { await sleep(150) } }
    return port
  }
  const caller = (port) => async (route, { headers = {}, cookie = '', body } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin.php?r=${route}`, { method: body ? 'POST' : 'GET', redirect: 'manual',
      headers: { 'X-Sporta-Admin': '1', ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined })
    const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* not json */ }
    return { status: r.status, json: j, set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] }
  }
  const pick = (set, name) => (set.find((v) => v.startsWith(name + '=')) || '').split(';')[0]
  const mails = () => readdirSync(maildir).filter((f) => f.endsWith('.eml')).map((f) => readFileSync(join(maildir, f), 'utf8'))
  const passcodeAlerts = () => mails().filter((m) => /Wrong device passcodes were entered/.test(m))

  const EMAIL = 'race-admin@sporta.test', PW = 'correct-horse-battery-kw', CODE = '482915'
  const hash = spawnSync('php', ['-r', `echo password_hash('${PW}', PASSWORD_BCRYPT);`], { encoding: 'utf8' }).stdout.trim()
  await sql(`insert into admin_users (email, password_hash) values ('${EMAIL}', '${hash}')`)
  const reset = async () => { await sql('update admin_users set passcode_failed = 0, passcode_locked_until = null'); await sql('delete from rate_limit') }

  const realPort = await start(site('real', false))
  const call = caller(realPort)
  const login = await call('login', { body: { email: EMAIL, password: PW } })
  const sess = pick(login.set, 'sporta_admin'), dev = pick(login.set, 'sporta_dev')
  const set = await call('passcode_set', { cookie: sess, body: { password: PW, passcode: CODE } })
  is(login.status === 200 && !!dev && set.status === 200, 'setup: signed in, device cookie, passcode set', `${login.status} ${!!dev} ${set.status}`)

  const guess = (c, g) => c('passcode_login', { cookie: dev, body: { email: EMAIL, passcode: g } })
  const burst = async (c, n, right = false) => {
    const gs = Array.from({ length: n }, (_, i) => String(100000 + i))
    if (right) gs[n - 1] = CODE
    const out = await Promise.all(gs.map((g) => guess(c, g)))
    const tally = {}
    for (const o of out) { const k = o.status + ':' + (o.json?.error || (o.json?.email ? 'signed_in' : '?')); tally[k] = (tally[k] || 0) + 1 }
    return { out, tally }
  }

  // 1. the burst (all sixteen workers awake first, so it really is parallel)
  await Promise.all(Array.from({ length: 32 }, () => call('google_available')))
  await reset()
  const before = passcodeAlerts().length
  const b1 = await burst(call, 40)
  const wrong = b1.tally['401:wrong_passcode'] || 0
  const locked = b1.tally['423:passcode_locked'] || 0
  const failedNow = await sql(`select passcode_failed, passcode_locked_until > now() from admin_users where email = '${EMAIL}'`)
  is(wrong <= 4 && wrong + locked === 40 && !b1.tally['200:signed_in'],
     '40 parallel wrong passcodes: at most four 401s, every other answer is the lock', JSON.stringify(b1.tally))
  is(/\t1$/.test(failedNow.trim()) || failedNow.trim().endsWith('1'), 'and the passcode is locked afterwards', failedNow.trim())
  await sleep(300)
  is(passcodeAlerts().length - before === 1, 'one "wrong device passcodes" alert mail for that lock', `${passcodeAlerts().length - before}`)

  // How many were EVALUATED: the day bucket counts every claimed attempt (right ones give theirs back).
  const adminId = String(await sql(`select id from admin_users where email = '${EMAIL}'`)).trim()
  const DAYKEY = createHmac('sha256', 'race-rl-secret').update(`admin_passcode_account_day|${adminId}`).digest('hex').slice(0, 32)
  const dayHits = async () => Number(String(await sql(`select coalesce(sum(hits),0) from rate_limit where bucket_key = '${DAYKEY}'`)).trim())
  await reset()
  await burst(call, 40)
  const hits40 = await dayHits()
  is(hits40 <= 5, '40 parallel guesses reach the passcode check at most five times (limit 5)', `${hits40} evaluated`)

  // 2. sequential
  await reset()
  const seq = []
  for (let i = 0; i < 7; i++) seq.push((await guess(call, String(200000 + i))).status)
  is(seq.join(',') === '401,401,401,401,423,423,423', 'sequential: four 401s, the fifth locks, and it stays locked', seq.join(','))

  // 3. right passcode while locked, then after the lock expires
  const whileLocked = await guess(call, CODE)
  await sql(`update admin_users set passcode_locked_until = now() - interval 1 second where email = '${EMAIL}'`)
  const afterExpiry = await guess(call, CODE)
  is(whileLocked.status === 423 && afterExpiry.status === 200 && afterExpiry.json?.email === EMAIL,
     'the right passcode is refused while locked and works once the lock has expired', `${whileLocked.status} ${afterExpiry.status}`)
  const afterOk = await sql(`select passcode_failed, passcode_locked_until is null from admin_users where email = '${EMAIL}'`)
  is(afterOk.trim().replace(/\s+/g, ' ') === '0 1', 'a right passcode clears the counter and the lock', afterOk.trim())
  // A burst that includes the right passcode is still bounded, and a right one in it does no harm.
  await reset()
  const b2 = await burst(call, 40, true)
  // A right passcode that wins a slot is the owner: it clears the counter, so up to five more slots open after it.
  const w2 = b2.tally['401:wrong_passcode'] || 0
  is(b2.tally['200:signed_in'] ? w2 <= 9 : w2 <= 4,
     'a burst with the right passcode last: at most four wrong ones evaluated (nine if the right one landed and cleared the count)', JSON.stringify(b2.tally))

  // 4. daily cap: 20 evaluations a day per account
  await reset()
  const dayStatuses = []
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) dayStatuses.push((await guess(call, String(300000 + i * 10 + j))).status)
    await sql(`update admin_users set passcode_failed = 0, passcode_locked_until = null where email = '${EMAIL}'`)
  }
  const evalDay = dayStatuses.filter((s) => s === 401).length
  const rightCapped = await guess(call, CODE)
  is(evalDay === 20 && dayStatuses.slice(20).every((s) => s === 423) && rightCapped.status === 423,
     'the daily cap: twenty evaluations per account per day, then 423 even for the right passcode', `${evalDay} evaluated, then ${rightCapped.status}`)
  await sleep(300)
  is(mails().filter((m) => /passcode sign-in to this account is paused for 24 hours/.test(m)).length === 1,
     'and one alert mail says the daily cap was reached')
  is(await dayHits() >= 20, 'the cap lives in rate_limit (no new column, no migration)', String(await dayHits()))
  // A right passcode gives its day hit back.
  await reset()
  await guess(call, CODE)
  is(await dayHits() === 0, 'a right passcode gives its day hit back', String(await dayHits()))

  // 6. the window held wide open: the real code still evaluates five at most; the mutant (no claim guard) does not.
  const widePort = await start(site('real-wide', false, true))
  const wcall = caller(widePort)
  await Promise.all(Array.from({ length: 32 }, () => wcall('google_available')))
  await reset()
  const wb = await burst(wcall, 40)
  const wideHits = await dayHits()
  is(wideHits <= 5 && (wb.tally['401:wrong_passcode'] || 0) <= 4,
     'with 0.4 s held between claim and check, 40 parallel guesses are still evaluated at most five times', `${wideHits} evaluated ${JSON.stringify(wb.tally)}`)
  const mutPort = await start(site('mutant', true, true))
  const mcall = caller(mutPort)
  // Wake all sixteen workers first, so the burst meets them all at once.
  await Promise.all(Array.from({ length: 32 }, () => mcall('google_available')))
  await reset()
  const mb = await burst(mcall, 40)
  const mutHits = await dayHits()
  is(mutHits > 5, 'MUTATION: without the claim guard (same wide window) the burst is evaluated more than five times, so this suite catches it',
    `${mutHits} evaluated ${JSON.stringify(mb.tally)}`)
} finally {
  for (const s of servers) { try { s.kill() } catch { /* gone */ } }
  inst.stop()
  rmSync(work, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} problem(s) in the passcode race suite` : '\nall passcode race checks passed')
process.exit(fails ? 1 : 0)
