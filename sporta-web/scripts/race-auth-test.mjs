// RACE CONDITIONS, LANE K2 — sessions, authentication, admin edits, counters and files.
//
// Every block below races REAL requests against a REAL MariaDB and a REAL
// multi-process PHP (php -S with PHP_CLI_SERVER_WORKERS, so requests truly
// overlap) and counts what the interleaving did. Nothing is mocked: a race
// that a mock cannot lose is not a race test.
//
// Each block is one race id:
//   K2-1   admin "forgot password": two overlapping requests kill each other's link
//   K2-2   the payment config files (knet-config.php / pay-config.php): two admin
//          saves read the same file and the later write erases the other's keys
//   K2-3   the CBK access-token cache: torn read, token stampede, purge marker
//   K2-4   the phone-code step: the five-failure lock is check-then-act
//   K2-5   brand_delete against a product being given that brand
//   K2-6   single-use secrets redeemed from many clients at once (checks of
//          what is already atomic: reset links, recovery code, TOTP step,
//          temporary password)
//   K2-7   counters: the login / coupon / customer windows under a parallel burst
//   K2-8   duplicate creation: registration, slugs, codes, tickets, reviews
//   K2-9   payment log appends from concurrent processes
//   K2-10  sessions: sign-in racing sign-out, a sign-out racing a save in flight
//   K2-11  hero reorder / catalogue sync: row locks taken in the order the client sent them
//   K2-12  the password-hash upgrade: two correct sign-ins, one told "wrong password"
//   K2-14  discount_delete counts the orders that used a code, then deletes it (review find)
//   K2-15  customer reset links: reset_password locked reset-row-then-account, forgot_password
//          (K2-1) account-then-reset-row - a lock-order inversion the K2-1 fix introduced (review find)
//
// A block that depends on a fix in a file the release gate owns (store.php,
// admin.php, ...) is shipped as a patch file; the block looks for the marker
// comment `RACE K2-<n>` in the staged source. Without the marker it prints
// `pend` (the patch has not been applied yet) instead of failing, and with
// --strict it fails. WITH the marker it is a hard assertion. That keeps the
// check-in green before the patch lands and makes it a real regression test
// after.
//
// MUTATION CHECKS (done by hand, results recorded here so the next person can repeat them): put the
// broken form back, keep the `RACE K2-n` comment, run `--only=K2-n`, the check must FAIL.
//   K2-1 admin   `id < ?` back to `id <> ?`                      -> both links dead, 6/6 rounds
//   K2-1 cust.   drop the `select ... for update` on the account -> 500s from the deadlock
//   K2-2         drop the get_lock in store_config_file_exclusive -> 10/10 rounds lose a save
//   K2-3         drop the single-flight lock in cbk.php           -> Authenticate called 2-12 times
//   K2-3 write   write the token cache in place again             -> 15 torn reads by readers
//   K2-4         drop `for update` on the phone-code gate         -> 15-20 codes evaluated
//   K2-5         drop the brand lock                              -> dangling brand tag 5/5
//   K2-11        client-order locks / unsorted sync               -> reorder and sync 5xx
//   K2-12        answer a missed hash upgrade 401 again           -> 11 of 16 correct sign-ins refused
//   K2-14        drop `for update` on discount_delete's first read -> 6 of 6 codes deleted while an order used them
//   K2-15        drop the account pre-lock in reset_password       -> the reset row is held while it waits for the account
// Hard to kill on demand: the purge marker's lock (K2-3, "once per ten minutes"). The window is
// microseconds; the broken form double-purged in 1 of 5 rounds once, in 0 of 24 rounds in three later
// runs, and in 1 of 8 (3 purges in one burst of 24) in the independent review's run on a loaded machine.
//
// INDEPENDENT REVIEW (second pair of eyes, own rig): on the unfixed tree `--strict` fails the 9 gate-file
// checks (K2-1 admin + customer, K2-2, K2-4, K2-5, K2-11, K2-12, K2-14, K2-15) and, with the pre-fix php-cbk, K2-3's
// stampede (16,10,11,12,4,12,10,5,7,4,7 Authenticate calls) and torn reads (59); every fix held at about
// twice the rounds above and all twelve mutants were killed.
//
// SELF-CONTAINED, like xss-config-test: its own MariaDB, its own PHP servers,
// a staged copy of dropin/ in a temp directory, all removed at the end. It
// never touches the shared sandbox (database `sporta`, ports 8095-8100/8188),
// dist/, or any config.php in the repo.
//
//   npm run test:race-auth
//   RACE_DROPIN=/path/to/tree/dropin npm run test:race-auth    (a patched copy)
//   node scripts/race-auth-test.mjs --only=K2-1,K2-4 --rounds=20 --strict
//   RACE_KEEP=1 ...                                            (leave the rig up; prints how to attach)
//   RACE_ATTACH=/path/rig.json ...                             (use a rig left up by RACE_KEEP)
import { execFile, spawn, spawnSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const DROPIN = process.env.RACE_DROPIN || join(WEB, 'dropin')
const STRICT = process.argv.includes('--strict')
const argVal = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? d
const ONLY = new Set(String(argVal('only', '')).split(',').filter(Boolean))
const ROUNDS = Number(argVal('rounds', process.env.RACE_ROUNDS ?? 12))
const want = (id) => ONLY.size === 0 || ONLY.has(id)

let fails = 0, pends = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const info = (n, d = '') => console.log(`info ${n}${d ? `  — ${d}` : ''}`)
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
// A check that needs a patch the release gate has not applied yet.
const fixCheck = (present, c, n, d) => {
  if (present) return is(c, n, d)
  if (c) return ok(n, `${d ?? ''} (already holds without the patch)`.trim())
  if (STRICT) return bad(n, `${d ?? ''} (patch not applied)`.trim())
  pends++
  console.log(`pend ${n}  — ${d ?? ''} (the patch for this race is not applied to this tree)`)
}

// ------------------------------------------------------------------ prerequisites
const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
for (const [bin, ok2] of [['php', have('php')], ['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-install-db', !!installDb]]) {
  if (!ok2) { console.log(`SKIP race-auth: ${bin} is not installed, so no private instance can be built. Nothing was tested.`); process.exit(0) }
}
const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 200; p++) if (await isFree(p)) return p; throw new Error('no free port') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const procs = []
const doomed = []
let tmp = ''
const attach = process.env.RACE_ATTACH ? JSON.parse(readFileSync(process.env.RACE_ATTACH, 'utf8')) : null
const keep = !!process.env.RACE_KEEP
const cleanup = () => {
  if (attach || keep) return
  for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } }
  for (const d of doomed) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

// ------------------------------------------------------------------ the rig
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpExport = (o) => `<?php\nreturn ${(function ex(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return phpStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `[${Object.entries(v).map(([k, x]) => `${phpStr(k)} => ${ex(x)}`).join(', ')}]`
})(o)};\n`

let R = null // the rig description
async function buildRig() {
  const base = process.env.RACE_WORKDIR || tmpdir()
  mkdirSync(base, { recursive: true })
  tmp = mkdtempSync(join(base, 'sporta-race-auth-'))
  doomed.push(tmp)
  const DATA = join(tmp, 'db')
  mkdirSync(DATA)
  let sockDir = tmp
  if (join(tmp, 'db.sock').length > 100) { sockDir = mkdtempSync('/tmp/ra-'); doomed.push(sockDir) }
  const SOCK = join(sockDir, 'db.sock')
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const inst = spawnSync(installDb, ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (inst.status !== 0) { console.log('SKIP race-auth: could not initialise a private MariaDB data directory.'); process.exit(0) }
  const DB_PORT = await freePort(34100 + Math.floor(Math.random() * 40) * 3)
  procs.push(spawn('mariadbd', ['--no-defaults', `--datadir=${DATA}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--bind-address=127.0.0.1',
    '--skip-name-resolve', `--pid-file=${join(tmp, 'db.pid')}`, '--innodb-flush-log-at-trx-commit=0', '--max-allowed-packet=64M',
    '--max-connections=400', '--innodb-lock-wait-timeout=20',
    ...(asRoot ? ['--user=root'] : [])], { stdio: ['ignore', 'ignore', openSync(join(tmp, 'mariadbd.log'), 'a')] }))
  const r0 = { tmp, SOCK, DB_PORT }
  const mysqlRaw = mkMysql(SOCK)
  let up = false
  for (let i = 0; i < 300 && !up; i++) { try { await mysqlRaw('select 1', ''); up = true } catch { await sleep(200) } }
  if (!up) { console.log('SKIP race-auth: the private MariaDB did not start.'); process.exit(0) }
  await mysqlRaw("create database race character set utf8mb4 collate utf8mb4_unicode_ci; create user 'x'@'127.0.0.1' identified by 'xp'; grant all on race.* to 'x'@'127.0.0.1';", '')
  const SQLDIR = join(DROPIN, 'php-store')
  await mysqlRaw(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'), 'race')
  const SKIP_SQL = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
  for (const f of readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !SKIP_SQL.has(n)).sort()) {
    await mysqlRaw(readFileSync(join(SQLDIR, f), 'utf8'), 'race')
  }
  await mysqlRaw('alter table customer_accounts add column if not exists birthday date null default null, ' +
    'add column if not exists birthday_set_at datetime null default null, add column if not exists birthday_sent_year smallint null default null', 'race')
  await mysqlRaw('update product_variants set stock = 100000', 'race')

  // the staged tree
  const STAGE = join(tmp, 'site'), PRIV = join(tmp, 'private'), MAIL = join(tmp, 'mail'), MAIL_SLOW = join(tmp, 'mail-slow')
  for (const d of [STAGE, PRIV, MAIL, MAIL_SLOW, join(tmp, 'sessions'), join(tmp, 'logs')]) mkdirSync(d, { recursive: true })
  const copyDropin = (from, to) => cpSync(join(DROPIN, from), join(STAGE, to), { recursive: true, filter: (s) => !/\/config\.php$/.test(s) })
  copyDropin('php-store', 'api'); copyDropin('php-knet', 'knet'); copyDropin('php-cbk', 'pay')
  writeFileSync(join(STAGE, 'router.php'), `<?php\n$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';\nif ($uri !== '/' && is_file(__DIR__ . $uri)) return false;\nhttp_response_code(404);\n`)
  writeFileSync(join(tmp, 'mta.sh'), readFileSync(join(HERE, 'fake-mta.sh')))

  // a fake CBK: Authenticate counts its calls and can be slowed; the rest is a stub
  writeFileSync(join(tmp, 'fake-cbk.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
header('Content-Type: application/json');
$dir = ${phpStr(tmp)};
if (str_ends_with($p, '/Authenticate')) {
    $fp = fopen($dir . '/auth-calls.log', 'a'); flock($fp, LOCK_EX);
    fwrite($fp, getmypid() . ' ' . microtime(true) . "\\n"); flock($fp, LOCK_UN); fclose($fp);
    $delay = is_file($dir . '/auth-delay.txt') ? (float) file_get_contents($dir . '/auth-delay.txt') : 0.0;
    if ($delay > 0) usleep((int) ($delay * 1000000));
    $size = is_file($dir . '/auth-size.txt') ? (int) file_get_contents($dir . '/auth-size.txt') : 0;
    echo json_encode(['Status' => '1', 'AccessToken' => 'tok-' . bin2hex(random_bytes(8)) . ($size > 0 ? str_repeat('A', $size) : '')]);
    exit;
}
http_response_code(404); echo '{}';
`)
  const CRON_KEY = 'race-cron-key-0123456789'
  const RL_SECRET = 'race-rate-secret-0123456789'
  const apiConfig = {
    db_host: `127.0.0.1;port=${DB_PORT}`, db_name: 'race', db_user: 'x', db_pass: 'xp', cron_key: CRON_KEY,
    warehouse_email: 'warehouse@sporta.test', mail_from: 'qa-cs@sporta.com.kw', mail_reply_to: 'qa-cs@sporta.com.kw',
    admin_mail_from: 'qa-cs@sporta.com.kw', customer_mail_from: 'qa-cs@sporta.com.kw',
    admin_reset_url: 'https://www.sporta.com.kw/backends', order_cooldown_seconds: 0,
    admin_session_dir: join(tmp, 'sessions'), rate_limit_secret: RL_SECRET, trusted_proxy_ips: ['127.0.0.1'],
  }
  const knetConfig = {
    env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    tranportal_id: 'TESTID001', tranportal_password: 'testpass', resource_key: 'abcdef0123456789',
    response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
    result_page_url: 'https://www.sporta.com.kw/payment/result', language: 'USA', log_file: join(tmp, 'logs/knet.log'), callback_response: 'auto',
  }
  const FAKE_PORT = await freePort(34300 + Math.floor(Math.random() * 20) * 4)
  const payConfig = {
    env: 'test', test_base: `http://127.0.0.1:${FAKE_PORT}/cbk`, production_base: 'https://pg.cbk.com',
    client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
    return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result',
    lang: 'en', log_file: join(tmp, 'logs/cbk.log'), token_cache_file: join(tmp, 'cbk-token.json'),
  }
  writeFileSync(join(tmp, 'api-config.php'), phpExport(apiConfig))
  writeFileSync(join(PRIV, 'knet-config.php'), phpExport(knetConfig))
  writeFileSync(join(PRIV, 'pay-config.php'), phpExport(payConfig))
  const phpEnv = { ...process.env, SPORTA_API_CONFIG_FILE: join(tmp, 'api-config.php'), SPORTA_PRIVATE_CONFIG_DIR: PRIV }
  const phpFlags = ['-d', 'opcache.enable=0', '-d', 'opcache.enable_cli=0', '-d', 'display_errors=0', '-d', 'log_errors=1',
    '-d', `error_log=${join(tmp, 'php-error.log')}`]
  procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${FAKE_PORT}`, join(tmp, 'fake-cbk.php')], { stdio: 'ignore', env: phpEnv }))
  const startSite = async (port, mailDir, env = {}) => {
    procs.push(spawn('php', [...phpFlags, '-d', `sendmail_path=sh ${join(tmp, 'mta.sh')} ${mailDir}`, '-S', `127.0.0.1:${port}`, '-t', STAGE, join(STAGE, 'router.php')],
      { stdio: 'ignore', env: { ...phpEnv, PHP_CLI_SERVER_WORKERS: '16', ...env } }))
    for (let i = 0; i < 200; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/api.php?r=checkout_config`)).status === 200) return true } catch { /* starting */ }
      await sleep(150)
    }
    return false
  }
  const SITE_PORT = await freePort(FAKE_PORT + 1)
  const SLOW_PORT = await freePort(SITE_PORT + 1)
  const up1 = await startSite(SITE_PORT, MAIL)
  const up2 = await startSite(SLOW_PORT, MAIL_SLOW, { MTA_DELAY: '0.8' })
  if (!up1 || !up2) { console.log('FAIL race-auth: the private PHP servers did not start'); process.exit(1) }
  return { ...r0, STAGE, PRIV, MAIL, MAIL_SLOW, FAKE_PORT, SITE_PORT, SLOW_PORT, CRON_KEY, RL_SECRET, phpEnv, phpFlags, apiConfig, payConfig, knetConfig }
}

function mkMysql(sock) {
  return (sqlText, db = 'race') => new Promise((resolve, reject) => {
    const p = spawn('mariadb', ['--no-defaults', '-S', sock, '-uroot', '--default-character-set=utf8mb4', ...(db ? [db] : []), '-N', '-B'])
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
    p.stdin.on('error', () => { /* the client exited first */ })
    p.stdin.end(sqlText)
  })
}

head('the private instance')
if (attach) {
  R = attach
  tmp = R.tmp
} else {
  R = await buildRig()
  if (keep) {
    const f = join(R.tmp, 'rig.json')
    writeFileSync(f, JSON.stringify(R))
    console.log(`RIG KEPT: RACE_ATTACH=${f}`)
  }
}
const sql = mkMysql(R.SOCK)
const SITE = `http://127.0.0.1:${R.SITE_PORT}`
const SLOW = `http://127.0.0.1:${R.SLOW_PORT}`
const STAGE_API = join(R.STAGE, 'api')
is(true, `own MariaDB :${R.DB_PORT}, own PHP :${R.SITE_PORT} (+ slow-mail twin :${R.SLOW_PORT}, fake CBK :${R.FAKE_PORT}), tree ${DROPIN === join(WEB, 'dropin') ? 'dropin/ of the repo' : DROPIN}`)

// Is the fix for race `id` present in the staged source? (the patch hunks carry `RACE K2-n`)
const staged = (f) => readFileSync(join(STAGE_API, f), 'utf8')
const hasMarker = (id, ...files) => files.some((f) => { try { return staged(f).includes(`RACE ${id}`) } catch { return false } })
const stagedPay = (f) => readFileSync(join(R.STAGE, 'pay', f), 'utf8')

// ------------------------------------------------------------------ http helpers
const rlKey = (bucket, id) => createHmac('sha256', R.RL_SECRET).update(`${bucket}|${id}`).digest('hex').slice(0, 32)
let ipSeq = 10
const freshIp = () => `198.51.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`
const at = async (ip, path, { method = 'GET', body, jar, headers = {}, base = SITE, admin = true, customer = false, raw } = {}) => {
  const res = await fetch(`${base}/api/${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(admin ? { 'X-Sporta-Admin': '1' } : {}),
      ...(customer ? { 'X-Sporta-Customer': '1' } : {}),
      'Sec-Fetch-Site': 'same-origin',
      ...(jar && jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  if (jar) {
    for (const c of set) {
      const pair = c.split(';')[0]
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim()
      if (value === '' || value === 'deleted' || /max-age=0(;|$)/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name)
      else jar.set(name, value)
    }
  }
  const text = await res.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, body: parsed, text, set }
}
// N requests released in the same tick. `mk(i)` returns a promise.
const burst = (n, mk) => Promise.all(Array.from({ length: n }, (_, i) => mk(i)))
const tally = (rs, key = (r) => `${r.status}${r.body?.error ? ':' + r.body.error : ''}`) => {
  const t = {}
  for (const r of rs) { const k = key(r); t[k] = (t[k] ?? 0) + 1 }
  return t
}
const fmt = (t) => Object.entries(t).sort().map(([k, v]) => `${k}×${v}`).join(' ')
const mails = (dir = R.MAIL) => readdirSync(dir).filter((f) => f.endsWith('.eml')).sort().map((f) => readFileSync(join(dir, f), 'utf8'))
const clearMail = (dir = R.MAIL) => { for (const f of readdirSync(dir)) { try { rmSync(join(dir, f)) } catch { /* gone */ } } }

// RFC 6238, the same six digits a phone shows
const base32 = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
const totp = (secret, t = Date.now() / 1000) => {
  const step = Buffer.alloc(8)
  step.writeBigUInt64BE(BigInt(Math.floor(t / 30)))
  const h = createHmac('sha1', base32(secret)).update(step).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
const wrongCode = (secret) => {
  const now = Date.now() / 1000
  const valid = new Set([-60, -30, 0, 30, 60].map((d) => totp(secret, now + d)))
  for (let i = 0; ; i++) {
    const c = String((123457 + i * 7919) % 1e6).padStart(6, '0')
    if (!valid.has(c)) return c
  }
}
const hashOf = async (pw) => (await run('php', ['-r',
  `require ${phpStr(join(STAGE_API, 'store.php'))}; echo store_admin_hash_password(${phpStr(pw)});`], { env: R.phpEnv })).stdout

// accounts of the suite's own
const OWNER = 'race-owner@example.test', OWNER_PW = 'race-owner-password-0001'
const MFA = 'race-mfa@example.test', MFA_PW = 'race-mfa-password-0001', SECRET = 'JBSWY3DPEHPK3PXP'
const hashes = { owner: await hashOf(OWNER_PW), mfa: await hashOf(MFA_PW) }
await sql('delete from admin_users')
await sql(`insert into admin_users (email, password_hash) values ('${OWNER}', '${hashes.owner}'), ('${MFA}', '${hashes.mfa}')`)
await sql(`update admin_users set totp_enabled = 1, totp_secret = '${SECRET}', totp_last_step = null where email = '${MFA}'`)
const adminId = async (email) => Number(await sql(`select id from admin_users where email = '${email}'`))
const login = (ip, email, password, jar, extra) => at(ip, 'admin.php?r=login', { method: 'POST', body: { email, password }, jar, ...extra })

// ------------------------------------------------------------------ BLOCKS
const BLOCKS = {}
const adminJar = async (email = OWNER, pw = OWNER_PW) => {
  const jar = new Map()
  const r = await login(freshIp(), email, pw, jar)
  if (r.status !== 200) throw new Error(`admin sign-in failed: ${r.status} ${r.text.slice(0, 80)}`)
  return jar
}
// Pending phone-code sessions for the MFA admin: one per jar (a session id serialises its own requests,
// so a burst needs as many sessions as requests). The password step is rate-limited per account, so they
// are made in small batches with the window emptied in between.
const pendingSessions = async (n) => {
  const jars = []
  while (jars.length < n) {
    await sql('delete from rate_limit')
    const batch = Array.from({ length: Math.min(4, n - jars.length) }, () => new Map())
    const rs = await burst(batch.length, (i) => login(freshIp(), MFA, MFA_PW, batch[i]))
    for (let i = 0; i < batch.length; i++) {
      if (rs[i].status !== 202) throw new Error(`pending session failed: ${rs[i].status} ${rs[i].text.slice(0, 80)}`)
      jars.push(batch[i])
    }
  }
  await sql('delete from rate_limit')
  return jars
}
const resetMfaAccount = () => sql(`update admin_users set failed_attempts = 0, locked_until = null, totp_last_step = null where email = '${MFA}'; delete from rate_limit; delete from admin_recovery_codes`)

// ---------------------------------------------------------------- K2-1
BLOCKS['K2-1'] = async () => {
  head('K2-1  forgot password: overlapping requests retire each other\'s link')
  // ADMIN. Two requests for the same address land together. Each inserts its own
  // token, sends its mail and — once the mail went — marks every OTHER unused
  // token used (`id <> mine`), so each retires the other's link and both mails
  // carry a dead one. The slow twin (MTA_DELAY 0.8 s) keeps both mails in flight
  // at once, so the interleaving is the same every round.
  const rounds = Math.max(3, Math.min(ROUNDS, 6))
  let bothDead = 0, oneLive = 0, other = 0
  for (let i = 0; i < rounds; i++) {
    await sql('delete from rate_limit; delete from admin_password_resets')
    clearMail(R.MAIL_SLOW)
    const rs = await burst(2, () => at(freshIp(), 'admin.php?r=forgot_password', { method: 'POST', body: { email: OWNER }, base: SLOW }))
    for (let t = 0; t < 150 && mails(R.MAIL_SLOW).length < 2; t++) await sleep(100)
    await sleep(1000)
    const live = Number(await sql('select count(*) from admin_password_resets where used_at is null and expires_at > now()'))
    const sent = mails(R.MAIL_SLOW).length
    if (rs.some((r) => r.status !== 200) || sent !== 2) other++
    else if (live === 0) bothDead++
    else if (live === 1) oneLive++
    else other++
  }
  info('K2-1 admin', `${rounds} rounds of two simultaneous requests: both links dead ${bothDead}, exactly one live ${oneLive}, other ${other}`)
  fixCheck(hasMarker('K2-1', 'admin.php'), bothDead === 0 && other === 0 && oneLive === rounds,
    'K2-1 the admin is never left with two reset mails and no live link', `both dead ${bothDead}/${rounds}`)

  // CUSTOMER. The same request answered by `update used_at ...; insert ...` in one
  // transaction: two of them take the same gap lock on the account's (customer_id,
  // used_at) index range and then each waits for the other's insert — a deadlock,
  // and the loser answers 500 and sends no mail. A BEFORE INSERT trigger that sleeps
  // makes both updates land before either insert on this private database.
  const email = 'race-cust-reset@example.test'
  await sql(`delete from customer_accounts where email = '${email}'`)
  const reg = await at(freshIp(), 'customer.php?r=register', { method: 'POST', admin: false, customer: true,
    body: { name: 'Race Reset', email, password: 'correct-horse-battery-staple-1' } })
  is(reg.status === 201, 'K2-1 the customer account for the reset races exists', `${reg.status}`)
  await sql('drop trigger if exists race_slow_reset; create trigger race_slow_reset before insert on customer_password_resets for each row do sleep(0.3)')
  const crounds = Math.max(3, Math.min(ROUNDS, 4))
  let fiveHundreds = 0, okAll = 0
  try {
    for (let i = 0; i < crounds; i++) {
      await sql('delete from rate_limit; delete from customer_password_resets')
      const rs = await burst(3, () => at(freshIp(), 'customer.php?r=forgot_password', { method: 'POST', admin: false, customer: true, body: { email } }))
      const t = tally(rs, (r) => r.status)
      fiveHundreds += t[500] ?? 0
      if ((t[200] ?? 0) === 3) okAll++
    }
  } finally {
    await sql('drop trigger if exists race_slow_reset')
  }
  info('K2-1 customer', `${crounds} rounds of three simultaneous requests: ${fiveHundreds} answered 500, ${okAll}/${crounds} rounds all answered 200`)
  fixCheck(hasMarker('K2-1', 'customer.php'), fiveHundreds === 0 && okAll === crounds,
    'K2-1 simultaneous customer reset requests all answer 200 (no deadlock)', `${fiveHundreds} 500s`)
}

// ---------------------------------------------------------------- K2-2
BLOCKS['K2-2'] = async () => {
  head('K2-2  gateway config files: two saves read the same file, the later one erases the earlier')
  // payment_config (tpay), payment_server_ips and payment_knet_via_cbk each read
  // pay-config.php, change a key and rewrite the WHOLE file (tmp + rename). Two
  // admins saving at once both start from the same bytes, so the last rename wins
  // and the other save vanishes — silently, including a switched-on knet_via_cbk or
  // a replaced secret. (One admin's own clicks cannot race: a session id serialises
  // its requests.) The file is padded with 3 MB of inert data so parse + var_export +
  // write take long enough for a barrier-released burst to overlap reliably.
  const payFile = join(R.PRIV, 'pay-config.php')
  const baseCfg = () => ({
    env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com',
    client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
    return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result',
    lang: 'en', log_file: join(R.tmp, 'logs/cbk.log'), token_cache_file: join(R.tmp, 'cbk-token.json'),
    server_ip_1: '', server_ip_2: '', knet_via_cbk: false, padding: 'x'.repeat(3_000_000),
  })
  const jars = await Promise.all([adminJar(), adminJar(), adminJar()])
  const rounds = Math.max(4, Math.min(ROUNDS, 10))
  let lost = 0, inconsistent = 0, errors = 0
  for (let i = 0; i < rounds; i++) {
    writeFileSync(payFile, phpExport(baseCfg()))
    const mark = `https://www.sporta.com.kw/payment/result?r=${i}`
    const rs = await burst(3, (k) => [
      () => at(freshIp(), 'admin.php?r=payment_config', { method: 'POST', jar: jars[0], body: {
        gateway: 'tpay', env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com',
        return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: mark } }),
      () => at(freshIp(), 'admin.php?r=payment_server_ips', { method: 'POST', jar: jars[1], body: { server_ip_1: `10.1.0.${i + 1}`, server_ip_2: '' } }),
      () => at(freshIp(), 'admin.php?r=payment_knet_via_cbk', { method: 'POST', jar: jars[2], body: { enabled: true } }),
    ][k]())
    if (rs.some((r) => r.status !== 200)) { errors++; continue }
    const text = readFileSync(payFile, 'utf8')
    const got = {
      result: text.includes(`'result_page_url' => '${mark}'`),
      ip: text.includes(`'server_ip_1' => '10.1.0.${i + 1}'`),
      via: /'knet_via_cbk' => true/.test(text),
    }
    const kept = Object.values(got).filter(Boolean).length
    if (kept < 3) lost++
    if (!text.includes("'client_secret' => 'testsecret'")) inconsistent++
  }
  info('K2-2', `${rounds} rounds of three simultaneous saves of pay-config.php from three admins: ${lost} rounds lost at least one save, ${errors} errors, ${inconsistent} damaged files`)
  fixCheck(hasMarker('K2-2', 'admin.php'), lost === 0 && errors === 0 && inconsistent === 0,
    'K2-2 simultaneous saves of one gateway config file all survive', `lost ${lost}/${rounds}`)
  writeFileSync(payFile, phpExport(R.payConfig))
}

// ---------------------------------------------------------------- K2-3
BLOCKS['K2-3'] = async () => {
  head('K2-3  the CBK access-token cache: stampede, torn read, purge marker')
  const cacheFile = join(R.tmp, 'cbk-token.json')
  const authLog = join(R.tmp, 'auth-calls.log')
  const authCalls = () => (existsSync(authLog) ? readFileSync(authLog, 'utf8').split('\n').filter(Boolean).length : 0)
  const resetAuth = () => { try { rmSync(authLog) } catch { /* none */ } }
  // The real pay config, as the callback loads it.
  writeFileSync(join(R.PRIV, 'pay-config.php'), phpExport(R.payConfig))
  const cb = (query, ip = freshIp()) => fetch(`${SITE}/pay/callback.php?${query}`, {
    redirect: 'manual', headers: { 'X-Forwarded-For': ip, 'X-Forwarded-Proto': 'https' } }).then(async (r) => ({ status: r.status, loc: r.headers.get('location') ?? '' }))

  // (i) STAMPEDE: the cache is empty (a restart, the 100-minute refresh, a purge) and sixteen
  // returns from the bank arrive together. Each finds no token and asks CBK to Authenticate:
  // sixteen calls to the merchant authentication endpoint for one token.
  writeFileSync(join(R.tmp, 'auth-delay.txt'), '0.5')
  const rounds = Math.max(3, Math.min(ROUNDS, 5))
  const counts = []
  for (let i = 0; i < rounds; i++) {
    try { rmSync(cacheFile) } catch { /* none */ }
    resetAuth()
    const rs = await burst(16, () => cb('encrp=ABCDEF0123456789'))
    counts.push(authCalls())
    if (rs.some((r) => r.status !== 302)) info('K2-3', `a callback answered ${tally(rs, (r) => r.status)[0]}`)
  }
  writeFileSync(join(R.tmp, 'auth-delay.txt'), '0')
  info('K2-3 stampede', `16 simultaneous returns with an empty cache: Authenticate called ${counts.join(', ')} times (rounds)`)
  fixCheck(hasMarkerPay('K2-3', 'cbk.php'), counts.every((c) => c === 1), 'K2-3 one Authenticate call serves a burst that finds the cache empty', `calls ${counts.join('/')}`)

  // (ii) TORN READ: the cache is rewritten in place (open, truncate, write). A reader that
  // lands between the truncate and the write sees an empty or half file, decides there is no
  // token and Authenticates again — though a good token was there a moment before and after.
  writeFileSync(join(R.tmp, 'auth-size.txt'), '300000')
  const harness = join(R.tmp, 'cache-harness.php')
  writeFileSync(harness, `<?php
require ${phpStr(join(R.STAGE, 'pay', 'cbk.php'))};
$cfg = require ${phpStr(join(R.PRIV, 'pay-config.php'))};
$mode = $argv[1]; $n = (int) $argv[2];
for ($i = 0; $i < $n; $i++) {
    cbk_get_access_token($cfg, $mode === 'write');
}
echo "done\\n";
`)
  // seed the cache, then count calls made by readers alone
  resetAuth()
  try { rmSync(cacheFile) } catch { /* none */ }
  await run('php', [...R.phpFlags, harness, 'write', '1'], { env: R.phpEnv })
  const seeded = authCalls()
  const WRITES = 30
  const writer = run('php', [...R.phpFlags, harness, 'write', String(WRITES)], { env: R.phpEnv })
  const readers = Array.from({ length: 6 }, () => run('php', [...R.phpFlags, harness, 'read', '400'], { env: R.phpEnv }))
  await Promise.all([writer, ...readers])
  const total = authCalls()
  const byReaders = total - seeded - WRITES
  writeFileSync(join(R.tmp, 'auth-size.txt'), '0')
  info('K2-3 torn read', `${WRITES} cache rewrites against 6 readers x 400 reads: ${byReaders} extra Authenticate calls made by readers that saw a torn file`)
  fixCheck(hasMarkerPay('K2-3', 'cbk.php'), byReaders === 0, 'K2-3 a reader never sees a half-written token cache', `reader-triggered calls ${byReaders}`)

  // (iii) PURGE MARKER: "at most one purge per ten minutes" is read-then-write on a file, so a
  // burst of TIJ0009 returns all read "no recent purge" before any writes the marker.
  const log = join(R.tmp, 'logs/cbk.log')
  const logLines = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { event: 'TORN', raw: l } } }) : [])
  const purges = []
  for (let i = 0; i < Math.max(rounds, 8); i++) {
    try { rmSync(`${cacheFile}.purged`) } catch { /* none */ }
    try { rmSync(log) } catch { /* none */ }
    await burst(24, () => cb('ErrorCode=TIJ0009&PayTrackID=ZZRACE0001'))
    const ev = logLines()
    const errs = ev.filter((e) => e.event === 'callback.gateway_error').length
    const thr = ev.filter((e) => e.event === 'callback.purge_throttled').length
    purges.push(errs - thr)
  }
  info('K2-3 purge marker', `24 simultaneous TIJ0009 returns: token purged ${purges.join(', ')} times (rounds), the rule says once`)
  fixCheck(hasMarkerPay('K2-3', 'callback.php'), purges.every((p) => p === 1), 'K2-3 a burst of TIJ0009 returns purges the token cache once', `purges ${purges.join('/')}`)
}
function hasMarkerPay(id, ...files) { return files.some((f) => { try { return stagedPay(f).includes(`RACE ${id}`) } catch { return false } }) }

// ---------------------------------------------------------------- K2-4
BLOCKS['K2-4'] = async () => {
  head('K2-4  phone code: the five-failure lock is checked, then set')
  // store_login_code() reads "is the account locked?" and only afterwards writes the failure that
  // sets the lock at the fifth. Wrong codes that arrive together all read "not locked", all get
  // evaluated, and each counts as a failure: the lock is five, the burst evaluates as many as there
  // are requests (up to the daily ceiling of 20 six-digit codes).
  const N = 24
  const rounds = Math.max(2, Math.min(ROUNDS, 2))
  const evaluated = []
  const wrong = wrongCode(SECRET)
  // A BEFORE UPDATE trigger that sleeps whenever the failure counter moves keeps the first failure's
  // write in flight while the rest of the burst reads "not locked" - the window, made as wide as it can
  // be on this private database.
  await sql(`drop trigger if exists race_slow_fail;
delimiter //
create trigger race_slow_fail before update on admin_users for each row begin
  if new.failed_attempts <> old.failed_attempts then do sleep(0.25); end if;
end//
delimiter ;`)
  try {
  for (let i = 0; i < rounds; i++) {
    await resetMfaAccount()
    const jars = await pendingSessions(N)
    await sql('delete from rate_limit')
    const rs = await burst(N, (k) => at(freshIp(), 'admin.php?r=login_code', { method: 'POST', jar: jars[k], body: { code: wrong } }))
    const failed = Number(await sql(`select failed_attempts from admin_users where email = '${MFA}'`))
    const locked = Number(await sql(`select coalesce(locked_until > now(), 0) from admin_users where email = '${MFA}'`))
    evaluated.push(failed)
    if (!locked) info('K2-4', `round ${i}: the account did not lock (${fmt(tally(rs))})`)
  }
  } finally {
    await sql('drop trigger if exists race_slow_fail')
  }
  info('K2-4', `${N} simultaneous wrong codes against one account: codes evaluated before/while the lock took hold: ${evaluated.join(', ')} (the lock is five)`)
  fixCheck(hasMarker('K2-4', 'store.php'), evaluated.every((e) => e <= 5), 'K2-4 no more than five wrong phone codes are evaluated per lock, however many arrive at once',
    `evaluated ${evaluated.join('/')}`)
  await resetMfaAccount()
}

// ---------------------------------------------------------------- K2-5
BLOCKS['K2-5'] = async () => {
  head('K2-5  brand_delete / brand_assign / product_save: "does the brand exist" is checked, then used')
  // brand_delete counts the products that carry the brand and then deletes it; product_save and
  // brand_assign check that the brand exists and then write the tag. An assignment that lands between
  // the delete's count and the delete leaves a product pointing at a brand that no longer exists.
  // A BEFORE DELETE trigger that sleeps keeps the delete in flight while the assignment runs.
  const [jarA, jarB] = await Promise.all([adminJar(), adminJar()])
  const slug = 'race-brand-k25'
  const rounds = Math.max(3, Math.min(ROUNDS, 5))
  const prod = (await sql('select slug from products order by id limit 1')).trim()
  let dangling = 0
  await sql('drop trigger if exists race_slow_brand_delete; create trigger race_slow_brand_delete before delete on brands for each row do sleep(0.6)')
  try {
    for (let i = 0; i < rounds; i++) {
      await sql(`delete from brands where slug = '${slug}'; update products set brand_slug = null where slug = '${prod}'`)
      await sql(`insert into brands (slug, name_en, name_ar, active, sort) values ('${slug}', 'Race K25', 'سباق', 1, 0)`)
      const id = Number(await sql(`select id from brands where slug = '${slug}'`))
      const del = at(freshIp(), 'admin.php?r=brand_delete', { method: 'POST', jar: jarA, body: { id } })
      await sleep(250)
      const asg = at(freshIp(), 'admin.php?r=brand_assign', { method: 'POST', jar: jarB, body: { brand_slug: slug, products: [prod] } })
      await Promise.all([del, asg])
      const left = Number(await sql(`select count(*) from products p where p.slug = '${prod}' and p.brand_slug = '${slug}' and not exists (select 1 from brands b where b.slug = p.brand_slug)`))
      if (left > 0) dangling++
    }
  } finally {
    await sql('drop trigger if exists race_slow_brand_delete')
    await sql(`delete from brands where slug = '${slug}'; update products set brand_slug = null where slug = '${prod}'`)
  }
  info('K2-5', `${rounds} rounds of brand_delete racing brand_assign: ${dangling} left a product tagged with a brand that is gone`)
  fixCheck(hasMarker('K2-5', 'admin.php'), dangling === 0, 'K2-5 a product is never left pointing at a deleted brand', `dangling ${dangling}/${rounds}`)
}

// ---------------------------------------------------------------- K2-6
BLOCKS['K2-6'] = async () => {
  head('K2-6  single-use secrets redeemed from many clients at once (exactly one may win)')
  const N = 12
  const one = (rs, okStatus = 200) => rs.filter((r) => r.status === okStatus).length
  // (a) admin recovery code, 16 pending sessions
  {
    await resetMfaAccount()
    const id = await adminId(MFA)
    const plain = 'ABCDEF0123ABCDEF0123'
    await sql(`insert into admin_recovery_codes (admin_id, code_hash) values (${id}, '${createHash('sha256').update(plain).digest('hex')}')`)
    const jars = await pendingSessions(N)
    const rs = await burst(N, (k) => at(freshIp(), 'admin.php?r=login_code', { method: 'POST', jar: jars[k], body: { code: plain } }))
    is(one(rs) === 1, 'K2-6 a recovery code signs exactly one of 12 simultaneous sessions in', fmt(tally(rs)))
    await resetMfaAccount()
  }
  // (b) the same TOTP step
  {
    await resetMfaAccount()
    const jars = await pendingSessions(N)
    const code = totp(SECRET)
    const rs = await burst(N, (k) => at(freshIp(), 'admin.php?r=login_code', { method: 'POST', jar: jars[k], body: { code } }))
    is(one(rs) === 1, 'K2-6 one phone code (one 30 s step) signs exactly one of 12 simultaneous sessions in', fmt(tally(rs)))
    await resetMfaAccount()
  }
  // (c) the temporary password: five (the account window) simultaneous sign-ins
  {
    await sql(`update admin_users set must_change_password = 1, temporary_password_expires_at = now() + interval 10 minute, temporary_password_used_at = null where email = '${OWNER}'; delete from rate_limit`)
    const rs = await burst(5, () => login(freshIp(), OWNER, OWNER_PW, new Map()))
    is(rs.filter((r) => r.status === 202).length === 1, 'K2-6 a temporary password starts exactly one change-password session', fmt(tally(rs)))
    await sql(`update admin_users set must_change_password = 0, temporary_password_expires_at = null, temporary_password_used_at = null where email = '${OWNER}'; delete from rate_limit`)
  }
  // (d) the admin reset link
  {
    await sql('delete from rate_limit; delete from admin_password_resets'); clearMail()
    await at(freshIp(), 'admin.php?r=forgot_password', { method: 'POST', body: { email: OWNER } })
    let token = null
    for (let t = 0; t < 80 && !token; t++) { token = mails().map((m) => m.match(/reset=([a-f0-9]{64})/)?.[1]).find(Boolean); if (!token) await sleep(100) }
    is(!!token, 'K2-6 the admin reset mail arrived')
    const rs = await burst(N, (k) => at(freshIp(), 'admin.php?r=reset_password', { method: 'POST', body: { token, password: `race-new-password-${k}-abcdef` } }))
    is(one(rs) === 1, 'K2-6 an admin reset link sets exactly one new password', fmt(tally(rs)))
    await sql(`update admin_users set password_hash = '${hashes.owner}', failed_attempts = 0, locked_until = null where email = '${OWNER}'; delete from rate_limit`)
  }
  // (e) the customer reset link
  {
    const email = 'race-cust-single@example.test'
    await sql(`delete from customer_accounts where email = '${email}'; delete from rate_limit`); clearMail()
    await at(freshIp(), 'customer.php?r=register', { method: 'POST', admin: false, customer: true, body: { name: 'Single Use', email, password: 'correct-horse-battery-staple-2' } })
    await at(freshIp(), 'customer.php?r=forgot_password', { method: 'POST', admin: false, customer: true, body: { email } })
    let token = null
    for (let t = 0; t < 80 && !token; t++) { token = mails().map((m) => m.match(/token=([a-f0-9]{64})/)?.[1]).find(Boolean); if (!token) await sleep(100) }
    is(!!token, 'K2-6 the customer reset mail arrived')
    const rs = await burst(N, (k) => at(freshIp(), 'customer.php?r=reset_password', { method: 'POST', admin: false, customer: true, body: { token, password: `race-new-customer-pass-${k}` } }))
    is(one(rs) === 1, 'K2-6 a customer reset link sets exactly one new password', fmt(tally(rs)))
  }
}

// ---------------------------------------------------------------- K2-7
// The windows are FIXED: a counter is keyed on (bucket, window start). A burst that straddles a window
// boundary is counted in two windows and may legitimately evaluate twice the limit (measured once: 8
// wrong passwords answered against a limit of 4, in a burst that crossed a quarter-hour). That is the
// design of a fixed window, not the race this suite hunts, so a burst is started just after a boundary.
const afterBoundary = async (windowSec, margin = 40) => {
  const into = (Date.now() / 1000) % windowSec
  if (into > windowSec - margin) await sleep((windowSec - into + 1) * 1000)
}

BLOCKS['K2-7'] = async () => {
  head('K2-7  counters: the windows hold under a parallel burst')
  // (a) five wrong passwords per account per 15 minutes, 40 clients at once
  {
    const rounds = Math.max(2, Math.min(ROUNDS, 2))
    const seen = []
    for (let i = 0; i < rounds; i++) {
      await sql('delete from rate_limit')
      await afterBoundary(900)
      const rs = await burst(40, () => login(freshIp(), OWNER, 'definitely-not-the-password-1', new Map()))
      seen.push(rs.filter((r) => r.status === 401).length)
    }
    is(seen.every((c) => c <= 4), 'K2-7 40 simultaneous wrong passwords: at most 4 are answered "wrong" (the 5th is the lock), the rest 429',
      `answered wrong: ${seen.join(', ')}`)
  }
  // (b) a typed coupon: thirty wrong guesses per client per ten minutes, 60 at once
  {
    await sql('delete from rate_limit')
    await afterBoundary(600)
    const slug = (await sql('select slug from products where active = 1 order by id limit 1')).trim()
    const ip = freshIp()
    const rs = await burst(60, (k) => at(ip, 'api.php?r=discount', { method: 'POST', admin: false,
      body: { code: `NOPE${k}XYZ`, items: [{ slug, qty: 1 }] } }))
    const evaluated = rs.filter((r) => r.status !== 429).length
    is(evaluated <= 30, 'K2-7 60 simultaneous wrong coupon codes from one client: at most 30 are evaluated', `evaluated ${evaluated}, ${fmt(tally(rs))}`)
  }
  // (c) customer sign-in: ten wrong passwords per address per 15 minutes
  {
    const email = 'race-cust-login@example.test'
    await sql(`delete from customer_accounts where email = '${email}'; delete from rate_limit`)
    await at(freshIp(), 'customer.php?r=register', { method: 'POST', admin: false, customer: true, body: { name: 'Login Burst', email, password: 'correct-horse-battery-staple-3' } })
    await sql('delete from rate_limit')
    await afterBoundary(900)
    const rs = await burst(30, () => at(freshIp(), 'customer.php?r=login', { method: 'POST', admin: false, customer: true, body: { email, password: 'wrong-wrong-wrong-wrong' } }))
    const evaluated = rs.filter((r) => r.status === 401).length
    is(evaluated <= 10, 'K2-7 30 simultaneous wrong customer passwords: at most 10 are evaluated', `evaluated ${evaluated}, ${fmt(tally(rs))}`)
  }
}

// ---------------------------------------------------------------- K2-8
BLOCKS['K2-8'] = async () => {
  head('K2-8  duplicate creation: one winner, the rest a clean refusal, never a 500')
  {
    const email = 'race-dup-register@example.test'
    await sql(`delete from customer_accounts where email = '${email}'; delete from rate_limit`)
    const rs = await burst(10, () => at(freshIp(), 'customer.php?r=register', { method: 'POST', admin: false, customer: true,
      body: { name: 'Dup Register', email, password: 'correct-horse-battery-staple-4' } }))
    const t = tally(rs)
    is((t['201'] ?? 0) === 1 && (t['409:account_not_created'] ?? t['409'] ?? 0) === 9 && !rs.some((r) => r.status >= 500),
      'K2-8 10 simultaneous registrations of one address: one account, nine 409', fmt(t))
  }
  {
    const jars = await Promise.all(Array.from({ length: 4 }, () => adminJar()))
    const slug = 'race-dup-slug-k28'
    await sql(`delete from products where slug = '${slug}'; delete from brands where slug = '${slug}'; delete from discounts where code = 'RACEDUP28'`)
    const prodBody = { id: 0, slug, name_en: 'Race dup', name_ar: 'مكرر', price: '5.000', active: true }
    const rp = await burst(8, (k) => at(freshIp(), 'admin.php?r=product_save', { method: 'POST', jar: jars[k % 4], body: prodBody }))
    const tp = tally(rp)
    is((tp['200'] ?? 0) === 1 && !rp.some((r) => r.status >= 500), 'K2-8 8 simultaneous product creations with one slug: one product, the rest slug_taken', fmt(tp))
    const rb = await burst(8, (k) => at(freshIp(), 'admin.php?r=brand_save', { method: 'POST', jar: jars[k % 4], body: { id: 0, name_en: 'Race Dup', name_ar: 'مكرر', slug } }))
    const tb = tally(rb)
    is((tb['200'] ?? 0) === 1 && !rb.some((r) => r.status >= 500), 'K2-8 8 simultaneous brand creations with one slug: one brand, the rest slug_taken', fmt(tb))
    const rd = await burst(8, (k) => at(freshIp(), 'admin.php?r=discount_save', { method: 'POST', jar: jars[k % 4], body: { id: 0, kind: 'code', code: 'RACEDUP28', type: 'percent', value: 10, label: 'Race dup', active: true } }))
    const td = tally(rd)
    is((td['200'] ?? 0) === 1 && !rd.some((r) => r.status >= 500), 'K2-8 8 simultaneous discount creations with one code: one code, the rest code_taken', fmt(td))
    await sql(`delete from products where slug = '${slug}'; delete from brands where slug = '${slug}'; delete from discounts where code = 'RACEDUP28'`)
  }
  {
    // support tickets: the reference is random, so no sequence can collide
    const rs = await burst(16, (k) => at(freshIp(), 'api.php?r=support_create', { method: 'POST', admin: false, customer: true,
      body: { name: 'Race Ticket', email: 'race-ticket@example.test', subject: `Ticket ${k}`, message: 'simultaneous ticket creation' } }))
    const refs = new Set(rs.map((r) => r.body?.ticket?.reference).filter(Boolean))
    is(rs.every((r) => r.status === 201) && refs.size === 16, 'K2-8 16 simultaneous support tickets: 16 distinct references, no 500', fmt(tally(rs)))
    await sql("delete from support_messages; delete from support_tickets")
  }
  {
    // one review per order: sixteen taps on the same signed link, one reward code
    const track = 'SPRACE0K28A'
    await sql(`delete from reviews; delete from discounts where label = 'Review thank-you'; delete from rate_limit`)
    const slug = (await sql('select slug from products where active = 1 order by id limit 1')).trim()
    const placed = await at(freshIp(), 'api.php?r=order', { method: 'POST', admin: false, body: {
      track_id: track, items: [{ slug, qty: 1 }], payment_method: 'cod',
      customer: { name: 'Race Review', phone: '99887766', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' } } })
    const sig = (await run('php', ['-r', `require ${phpStr(join(STAGE_API, 'store.php'))}; echo store_review_sig(${phpStr(track)});`], { env: R.phpEnv })).stdout
    if (placed.status !== 200 && placed.status !== 201) {
      bad('K2-8 the order for the review race could not be placed', `${placed.status} ${placed.text.slice(0, 100)}`)
    } else {
      const rs = await burst(12, (k) => at(freshIp(), 'api.php?r=review', { method: 'POST', admin: false,
        body: { track_id: track, token: sig, rating: 1 + (k % 5), comment: `tap ${k}` } }))
      const fresh = rs.filter((r) => r.body?.ok && r.body.already === false)
      const codes = new Set(rs.map((r) => r.body?.code).filter(Boolean))
      const minted = Number(await sql("select count(*) from discounts where label = 'Review thank-you'"))
      is(fresh.length === 1 && codes.size === 1 && minted === 1 && !rs.some((r) => r.status >= 500),
        'K2-8 12 simultaneous submissions of one review link: one review, one reward code, the rest handed the same code', `fresh ${fresh.length}, codes ${codes.size}, minted ${minted}, ${fmt(tally(rs))}`)
    }
  }
}

// ---------------------------------------------------------------- K2-9
BLOCKS['K2-9'] = async () => {
  head('K2-9  payment logs appended by concurrent processes')
  const log = join(R.tmp, 'logs/race-append.log')
  try { rmSync(log) } catch { /* none */ }
  const pad = 'p'.repeat(24000)
  const h = join(R.tmp, 'append-harness.php')
  writeFileSync(h, `<?php
require ${phpStr(join(R.STAGE, 'pay', 'cbk.php'))};
$cfg = ['log_file' => ${phpStr(log)}];
$id = $argv[1];
for ($i = 0; $i < 120; $i++) cbk_log($cfg, 'race.append', ['writer' => $id, 'i' => $i, 'pad' => ${phpStr(pad)}]);
`)
  await Promise.all(Array.from({ length: 12 }, (_, k) => run('php', [...R.phpFlags, h, String(k)], { env: R.phpEnv })))
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean)
  let torn = 0
  for (const l of lines) { try { const j = JSON.parse(l); if (j.pad.length !== pad.length) torn++ } catch { torn++ } }
  is(lines.length === 12 * 120 && torn === 0, 'K2-9 12 processes x 120 appended 24 KB log lines: none lost, none interleaved', `${lines.length} lines, ${torn} torn`)
}

// ---------------------------------------------------------------- K2-11
BLOCKS['K2-11'] = async () => {
  head('K2-11  hero reorder and catalogue sync: row locks taken in the order the client sent them')
  // slide_reorder updates the slides in the order the admin dragged them and sync upserts the products in
  // the order the file lists them. Two requests that list the same rows in opposite orders take the same row
  // locks in opposite orders - a deadlock; the database kills one and that admin gets a 500. A BEFORE UPDATE
  // trigger that sleeps keeps each request holding its first lock while the other takes its own.
  const [jarA, jarB] = await Promise.all([adminJar(), adminJar()])
  await sql('delete from hero_slides')
  await sql("insert into hero_slides (sort, title_en) values (0, 'race one'), (1, 'race two')")
  const ids = (await sql('select id from hero_slides order by id')).split('\n').map(Number)
  const prods = (await sql('select slug from products order by id limit 2')).split('\n')
  await sql('drop trigger if exists race_slow_slides; create trigger race_slow_slides before update on hero_slides for each row do sleep(0.3)')
  await sql('drop trigger if exists race_slow_products; create trigger race_slow_products before update on products for each row do sleep(0.3)')
  const rounds = Math.max(2, Math.min(ROUNDS, 4))
  let slideErr = 0, syncErr = 0
  try {
    for (let i = 0; i < rounds; i++) {
      const rs = await burst(2, (k) => at(freshIp(), 'admin.php?r=slide_reorder', { method: 'POST', jar: k ? jarB : jarA, body: { ids: k ? [...ids].reverse() : ids } }))
      slideErr += rs.filter((r) => r.status >= 500).length
      const row = (slug) => ({ slug, name_en: `Race ${slug}`, name_ar: 'سباق', price: '5.000', active: true })
      const ss = await burst(2, (k) => at(freshIp(), 'admin.php?r=sync', { method: 'POST', jar: k ? jarB : jarA,
        body: { rows: (k ? [...prods].reverse() : prods).map(row) } }))
      syncErr += ss.filter((r) => r.status >= 500).length
    }
  } finally {
    await sql('drop trigger if exists race_slow_slides; drop trigger if exists race_slow_products; delete from hero_slides')
  }
  info('K2-11', `${rounds} rounds: ${slideErr} reorders and ${syncErr} syncs answered 5xx (deadlock victims)`)
  fixCheck(hasMarker('K2-11', 'admin.php'), slideErr === 0 && syncErr === 0, 'K2-11 two admins reordering slides, or syncing the catalogue, at once both succeed', `slides ${slideErr}, sync ${syncErr}`)
}

// ---------------------------------------------------------------- K2-12
BLOCKS['K2-12'] = async () => {
  head('K2-12  the password-hash upgrade: two correct sign-ins, one of them told "wrong password"')
  // A hash made before the current parameters (or before the versioned prefix) is rewritten at the next
  // successful sign-in with `update ... where password_hash = <the old hash>`, and a miss is answered 401
  // ("a reset may have raced"). Two sign-ins of the SAME correct password that overlap both verify against
  // the old hash, the first rewrites it, the second finds the old hash gone - and the owner, who typed
  // the right password, is told it is wrong.
  const legacy = (await run('php', ['-r', `echo password_hash(${phpStr(OWNER_PW)}, PASSWORD_DEFAULT);`])).stdout
  const rounds = Math.max(3, Math.min(ROUNDS, 4))
  let rejected = 0, signedIn = 0
  for (let i = 0; i < rounds; i++) {
    await sql(`update admin_users set password_hash = '${legacy.replace(/'/g, "''")}', failed_attempts = 0, locked_until = null where email = '${OWNER}'; delete from rate_limit`)
    const rs = await burst(4, () => login(freshIp(), OWNER, OWNER_PW, new Map()))
    rejected += rs.filter((r) => r.status === 401).length
    signedIn += rs.filter((r) => r.status === 200).length
  }
  await sql(`update admin_users set password_hash = '${hashes.owner}', failed_attempts = 0, locked_until = null where email = '${OWNER}'; delete from rate_limit`)
  info('K2-12', `${rounds} rounds of four simultaneous correct sign-ins on an old-format hash: ${signedIn} signed in, ${rejected} told "wrong password"`)
  fixCheck(hasMarker('K2-12', 'store.php'), rejected === 0 && signedIn === rounds * 4,
    'K2-12 simultaneous correct sign-ins all succeed while the hash is being upgraded', `rejected ${rejected}`)
}

// ---------------------------------------------------------------- K2-10
BLOCKS['K2-10'] = async () => {
  head('K2-10  sessions: sign-out racing requests on the same session id')
  const rounds = Math.max(3, Math.min(ROUNDS, 6))
  let stale = 0, errs = 0
  for (let i = 0; i < rounds; i++) {
    await sql('delete from rate_limit')
    const jar = await adminJar()
    const old = new Map(jar)
    const rs = await burst(12, (k) => (k === 6
      ? at(freshIp(), 'admin.php?r=logout', { method: 'POST', jar })
      : at(freshIp(), 'admin.php?r=me', { jar: new Map(old) })))
    if (rs.some((r) => r.status >= 500)) errs++
    const after = await at(freshIp(), 'admin.php?r=me', { jar: new Map(old) })
    if (after.body && after.body.email) stale++
  }
  is(errs === 0 && stale === 0, 'K2-10 after a sign-out that raced 11 other requests, the old cookie never works again and nothing answers 5xx', `stale ${stale}/${rounds}, 5xx rounds ${errs}`)
  // a sign-in racing a sign-out of the previous session: the new session survives, the old one is gone
  {
    await sql('delete from rate_limit')
    const jar = await adminJar()
    const old = new Map(jar)
    const fresh = new Map(jar)
    const [lo, li] = await Promise.all([
      at(freshIp(), 'admin.php?r=logout', { method: 'POST', jar: old }),
      login(freshIp(), OWNER, OWNER_PW, fresh),
    ])
    const me = await at(freshIp(), 'admin.php?r=me', { jar: fresh })
    ok('K2-10 a sign-in racing the sign-out of the session it replaces', `logout ${lo.status}, login ${li.status}, afterwards ${me.body?.email ? 'signed in' : 'signed out'}`)
    is(lo.status < 500 && li.status < 500, 'K2-10 neither the sign-in nor the sign-out of a raced pair answers 5xx')
  }
  // a sign-out racing a SAVE that is still in flight: the save finishes (the session lock makes the sign-out
  // wait for it), the sign-out then ends the session, and a save sent afterwards with the same cookie is refused
  {
    await sql('delete from rate_limit')
    const jar = await adminJar()
    const prod = (await sql("select concat(id, '|', slug, '|', price) from products order by id limit 1")).split('|')
    const body = { id: Number(prod[0]), slug: prod[1], name_en: 'Race save in flight', name_ar: 'حفظ', price: prod[2], active: true }
    await sql('drop trigger if exists race_slow_save; create trigger race_slow_save before update on products for each row do sleep(1)')
    try {
      const save = at(freshIp(), 'admin.php?r=product_save', { method: 'POST', jar: new Map(jar), body })
      // The sign-out is sent once the save is really in flight (asleep in the trigger, holding the session). A fixed
      // 150 ms wait let a loaded machine start the sign-out FIRST: it won the session lock, the save was then
      // refused 401, and the check failed although nothing was wrong (seen in the independent review's runs).
      for (let t = 0; t < 200; t++) {
        if (Number(await sql("select count(*) from information_schema.processlist where state = 'User sleep'")) > 0) break
        await sleep(50)
      }
      const out = at(freshIp(), 'admin.php?r=logout', { method: 'POST', jar: new Map(jar) })
      const [sv, lo] = await Promise.all([save, out])
      const late = await at(freshIp(), 'admin.php?r=product_save', { method: 'POST', jar: new Map(jar), body: { ...body, name_en: 'Race save after logout' } })
      const name = await sql(`select name_en from products where id = ${Number(prod[0])}`)
      is(sv.status === 200 && lo.status === 200 && late.status === 401 && name === 'Race save in flight',
        'K2-10 a sign-out racing a save in flight: the save completes whole, the sign-out ends the session, a later save is refused',
        `save ${sv.status}, logout ${lo.status}, later save ${late.status}, stored "${name}"`)
    } finally {
      await sql('drop trigger if exists race_slow_save')
    }
  }
}

// ---------------------------------------------------------------- K2-14  (found in the independent review)
BLOCKS['K2-14'] = async () => {
  head('K2-14  discount_delete: "no order used this code" is counted, then the code is deleted')
  // discount_delete counts the orders that carry the code (409 discount_in_use when there are any) and
  // only then deletes the row. A checkout that claimed the code in between - its guarded UPDATE holds
  // the discount row's lock until the order commits, so the DELETE waits for it, then runs anyway - leaves
  // an order recording a code that no longer exists, and the "in use" rule was never consulted. Orders keep
  // their own copy of the code, label and amount, so no money is wrong; the guard the route promises is.
  // A BEFORE UPDATE trigger on orders that sleeps when the code is written keeps the order open (and the
  // discount row claimed) while the delete runs.
  const jar = await adminJar()
  const slug = (await sql('select slug from products where active = 1 order by id limit 1')).trim()
  const rounds = Math.max(3, Math.min(ROUNDS, 6))
  await sql('drop trigger if exists race_slow_order_code')
  await sql('create trigger race_slow_order_code before update on orders for each row ' +
    'set @race_sleep = if(new.discount_code is not null and old.discount_code is null, sleep(2.5), 0)')
  let deletedAndUsed = 0, guarded = 0, orderLost = 0
  try {
    for (let i = 0; i < rounds; i++) {
      // a code of its own every round and every run: an order left by an earlier run would answer 409 on its own
      const stamp = Date.now().toString(36).toUpperCase()
      const code = `RD${stamp}${i}`
      const track = `SPRACE14${i}A${stamp}`   // a phone of its own too: four open cash orders on one number are refused
      await sql(`delete from discounts where code = '${code}'; delete from rate_limit`)
      const made = await at(freshIp(), 'admin.php?r=discount_save', { method: 'POST', jar, body: { id: 0, kind: 'code', code, type: 'percent', value: 10, label: 'Race delete', active: true } })
      if (made.status !== 200) { bad('K2-14 the discount for the delete race could not be made', `${made.status} ${made.text.slice(0, 100)}`); return }
      const id = made.body.id
      const order = at(freshIp(), 'api.php?r=order', { method: 'POST', admin: false, body: {
        track_id: track, items: [{ slug, qty: 1 }], payment_method: 'cod', discount_code: code,
        customer: { name: 'Race Delete', phone: `9${String(Date.now() % 100000).padStart(5, '0')}${String(i).padStart(2, '0')}`, governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' } } })
      // wait until the order has claimed the code: its transaction is open and asleep in the trigger (the claim
      // itself is uncommitted, so it cannot be read back from the discounts table - the sleep can be seen)
      let claimed = false
      for (let t = 0; t < 200 && !claimed; t++) {
        claimed = Number(await sql("select count(*) from information_schema.processlist where state = 'User sleep'")) > 0
        if (!claimed) await sleep(40)
      }
      const del = at(freshIp(), 'admin.php?r=discount_delete', { method: 'POST', jar, body: { id } })
      const [o, d] = await Promise.all([order, del])
      const gone = Number(await sql(`select count(*) from discounts where id = ${id}`)) === 0
      const used = Number(await sql(`select count(*) from orders where track_id = '${track}' and discount_code = '${code}'`)) === 1
      if (!claimed) info('K2-14', `round ${i}: the order never claimed the code (${o.status})`)
      if (gone && used) deletedAndUsed++
      if (d.status === 409 && !gone) guarded++
      if (claimed && o.status !== 200) orderLost++
      await sql(`delete from discounts where code = '${code}'`)
    }
  } finally {
    await sql('drop trigger if exists race_slow_order_code')
  }
  info('K2-14', `${rounds} rounds of a delete racing the order that claimed the code: deleted although an order used it ${deletedAndUsed}, delete refused discount_in_use ${guarded}, orders that failed ${orderLost}`)
  fixCheck(hasMarker('K2-14', 'admin.php'), deletedAndUsed === 0 && orderLost === 0,
    'K2-14 a discount code is never deleted while an order that used it is still being written', `deleted-and-used ${deletedAndUsed}/${rounds}`)
}

// ---------------------------------------------------------------- K2-15  (found in the independent review)
BLOCKS['K2-15'] = async () => {
  head('K2-15  customer reset links: one lock order everywhere (account first, then its reset rows)')
  // K2-1 made customer forgot_password take the ACCOUNT row first and then touch the account's reset rows.
  // reset_password locked the other way round (the reset row, then the account row, in one join), so a forgot
  // request and a reset-link redemption for one customer could each hold one and wait for the other. The
  // window is microseconds wide, so it cannot be hit with two ordinary requests; the order itself can be seen:
  // hold the ACCOUNT row from outside, send a real reset_password, and ask - with NOWAIT - whether the
  // request, which is now stuck waiting for the account, already holds the reset row. Holding it is the
  // inverted order. Not holding it means it asked for the account first, like forgot_password does.
  const email = 'race-cust-lockorder@example.test'
  await sql(`delete from customer_accounts where email = '${email}'; delete from rate_limit`)
  const reg = await at(freshIp(), 'customer.php?r=register', { method: 'POST', admin: false, customer: true,
    body: { name: 'Lock Order', email, password: 'correct-horse-battery-staple-5' } })
  is(reg.status === 201, 'K2-15 the customer account for the lock-order check exists', `${reg.status}`)
  const cid = Number(await sql(`select id from customer_accounts where email = '${email}'`))
  const token = createHash('sha256').update('race-lock-order-token').digest('hex')   // 64 hex characters
  await sql(`delete from customer_password_resets where customer_id = ${cid}; insert into customer_password_resets (customer_id, token_hash, expires_at, request_ip) values (${cid}, '${createHash('sha256').update(token).digest('hex')}', date_add(now(), interval 30 minute), 'race')`)
  const rid = Number(await sql(`select id from customer_password_resets where customer_id = ${cid} and used_at is null`))
  // hold the account row from outside, for as long as it takes: the holder sleeps and is woken (KILL QUERY) when the
  // check is done, so a slow machine cannot let it run out before the request has reached its lock wait
  const holder = sql(`start transaction; select id from customer_accounts where id = ${cid} for update; select sleep(60); commit;`).then(() => 'done', () => 'woken')   // woken: KILL QUERY ends the script, the transaction rolls back and frees the row
  const holderId = async () => (await sql("select id from information_schema.processlist where info like 'select sleep(60)%' limit 1")).trim()
  for (let t = 0; t < 100 && !(await holderId()); t++) await sleep(100)
  const reset = at(freshIp(), 'customer.php?r=reset_password', { method: 'POST', admin: false, customer: true,
    body: { token, password: 'race-new-lockorder-pass-1' } })
  // wait until the request is stuck in a lock wait
  let waiting = false
  for (let t = 0; t < 120 && !waiting; t++) {
    waiting = Number(await sql("select count(*) from information_schema.innodb_trx where trx_state = 'LOCK WAIT'")) > 0
    if (!waiting) await sleep(100)
  }
  let holdsResetRow = null
  if (waiting) {
    try { await sql(`start transaction; select id from customer_password_resets where id = ${rid} for update nowait; rollback;`); holdsResetRow = false }
    catch (e) { holdsResetRow = /lock|1205|3572|nowait/i.test(String(e?.message ?? e)) }
  }
  const hid = await holderId()
  if (hid) await sql(`kill query ${Number(hid)}`)
  await holder
  const rr = await reset
  info('K2-15', `reset_password stuck behind the account row: ${waiting ? 'yes' : 'never saw it wait'}; it already held the reset row while waiting: ${holdsResetRow}; answered ${rr.status}`)
  is(waiting && rr.status === 200, 'K2-15 the reset still completes once the account row is free', `waited ${waiting}, status ${rr.status}`)
  fixCheck(hasMarker('K2-15', 'customer.php'), waiting && holdsResetRow === false,
    'K2-15 reset_password asks for the account row before the reset row (the order forgot_password uses)', `held reset row while waiting: ${holdsResetRow}`)
}

// ------------------------------------------------------------------ run
const T0 = Date.now()
for (const id of Object.keys(BLOCKS)) {
  if (!want(id)) continue
  const t = Date.now()
  try { await BLOCKS[id]() } catch (e) { bad(`${id} threw`, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')) }
  info(`${id} took`, `${Math.round((Date.now() - t) / 1000)} s`)
}
info('all blocks took', `${Math.round((Date.now() - T0) / 1000)} s`)

head('result')
console.log(`${passes} ok, ${pends} pend (patch not applied), ${fails} FAIL`)
process.exit(fails ? 1 : 0)
