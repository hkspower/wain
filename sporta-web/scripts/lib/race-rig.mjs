// A PRIVATE STACK FOR RACE REPRODUCERS: its own MariaDB, its own PHP workers,
// a staged copy of the backend, and the helpers a race needs (many requests
// released together, a held row lock, a trigger that widens a window).
//
// WHY A RIG AT ALL. A race is an interleaving, and the shared sandbox (database
// `sporta`, ports 8095-8100) is one process pool with one set of rows that the
// other suites are using at the same moment. A reproducer that sleeps inside a
// trigger, takes GET_LOCKs, or fires 32 checkouts at once must not do it on a
// database anyone else is reading. So this builds everything it needs in a temp
// directory and removes it on exit. It never touches the sandbox database, its
// ports, dist/ or any config.php in the repository.
//
// WHAT IS STAGED. `tree` is a dropin/ directory (php-store, php-knet, php-cbk).
// The default is the repository's own; a patched COPY of the tree can be handed
// in to prove a patch before it is applied. They are copied to <tmp>/site/api,
// /knet and /pay, exactly the layout the server has, with no config.php: the
// three configs are written outside the web root and found through
// SPORTA_API_CONFIG_FILE / SPORTA_PRIVATE_CONFIG_DIR (config-path.php).
//
// WHAT "TRULY OVERLAP" MEANS. The built-in PHP server is single-process unless
// PHP_CLI_SERVER_WORKERS is set; with it, N children accept connections from
// one socket, so N requests are in PHP at the same time and in MariaDB on N
// connections. 16 workers is the default here. The client side is `fetch` from
// one Node process: all requests of a round are started in the same tick.
import { execFile, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB = join(HERE, '..', '..')
export const DROPIN = join(WEB, 'dropin')

export const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
export const freePort = async (from) => {
  for (let p = from; p < from + 200; p++) if (await isFree(p)) return p
  throw new Error('no free port')
}

const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpExport = (o) => `<?php\nreturn ${(function ex(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return phpStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(ex).join(', ')}]`
  return `[${Object.entries(v).map(([k, x]) => `${phpStr(k)} => ${ex(x)}`).join(', ')}]`
})(o)};\n`

// KNET's trandata crypto, written from the spec (AES-128-CBC, the resource key
// doubles as the IV, upper-case hex). Independent of the PHP under test.
export const KNET_KEY = 'abcdef0123456789'
export const knetEncrypt = (fields) => {
  const plain = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  const c = crypto.createCipheriv('aes-128-cbc', KNET_KEY, KNET_KEY)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase()
}

export async function startRig(opts = {}) {
  const tree = opts.tree ?? DROPIN
  const workers = opts.workers ?? 16
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
  for (const [bin, present] of [['php', have('php')], ['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-install-db', !!installDb]]) {
    if (!present) return { skip: `${bin} is not installed, so no private instance can be built` }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'sporta-race-'))
  const procs = []
  const dirs = []
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } }
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
    if (!process.env.KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
  }
  process.on('exit', stop)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130) })

  // ---------------------------------------------------------------- database
  const DATA = join(tmp, 'db')
  mkdirSync(DATA)
  // A unix socket path is limited to ~107 bytes; a deep scratch directory can
  // exceed it, so the socket alone falls back to a short directory.
  let sockDir = tmp
  if (join(tmp, 'db.sock').length > 100) { sockDir = mkdtempSync('/tmp/rc-'); dirs.push(sockDir) }
  const SOCK = join(sockDir, 'db.sock')
  const init = spawnSync(installDb, ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (init.status !== 0) { stop(); return { skip: 'could not initialise a private MariaDB data directory' } }
  const DB_PORT = await freePort(opts.dbPortFrom ?? 33900)
  procs.push(spawn('mariadbd', ['--no-defaults', `--datadir=${DATA}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--bind-address=127.0.0.1',
    '--skip-name-resolve', `--pid-file=${join(tmp, 'db.pid')}`, '--innodb-flush-log-at-trx-commit=0', '--max-allowed-packet=64M',
    '--max-connections=400', '--innodb-buffer-pool-size=64M', `--innodb-lock-wait-timeout=${opts.lockWait ?? 20}`,
    ...(opts.dbArgs ?? []), ...(asRoot ? ['--user=root'] : [])],
  { stdio: ['ignore', 'ignore', openSync(join(tmp, 'mariadbd.log'), 'a')] }))

  const cli = (db, extra = []) => spawn('mariadb', ['--no-defaults', '-S', SOCK, '-uroot', '--default-character-set=utf8mb4', ...(db ? [db] : []), ...extra])
  const sqlRaw = (text, db = 'race') => new Promise((resolve, reject) => {
    const p = cli(db, ['-N', '-B'])
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
    p.stdin.on('error', () => { /* the client exited first; its exit code says why */ })
    p.stdin.end(text)
  })
  let dbUp = false
  for (let i = 0; i < 300 && !dbUp; i++) {
    try { await sqlRaw('select 1', ''); dbUp = true } catch { await sleep(200) }
  }
  if (!dbUp) { stop(); return { skip: 'the private MariaDB did not start' } }
  await sqlRaw("create database race character set utf8mb4 collate utf8mb4_unicode_ci; create user 'x'@'127.0.0.1' identified by 'xp'; grant all on race.* to 'x'@'127.0.0.1';", '')

  const SQLDIR = join(tree, 'php-store')
  await sqlRaw(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'))
  const SKIP_SQL = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
  for (const f of readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !SKIP_SQL.has(n)).sort()) {
    await sqlRaw(readFileSync(join(SQLDIR, f), 'utf8'))
  }
  // Not in dropin/php-store (they live in sporta-live/birthday): the customer
  // table the store reads wants these columns.
  await sqlRaw('alter table customer_accounts add column if not exists birthday date null default null, ' +
    'add column if not exists birthday_set_at datetime null default null, add column if not exists birthday_sent_year smallint null default null')
  await sqlRaw('update product_variants set stock = 1000')

  // -------------------------------------------------------------- staged tree
  const STAGE = join(tmp, 'site'), PRIV = join(tmp, 'private'), MAIL = join(tmp, 'mail'), SESS = join(tmp, 'sessions')
  for (const d of [STAGE, PRIV, MAIL, SESS]) mkdirSync(d, { recursive: true })
  const copyDropin = (from, to) => cpSync(join(tree, from), join(STAGE, to), { recursive: true, filter: (s) => !/\/config\.php$/.test(s) })
  copyDropin('php-store', 'api'); copyDropin('php-knet', 'knet'); copyDropin('php-cbk', 'pay')

  // A fake mail transport that RECORDS each message and can be slowed down, so
  // a cron that sends mail has something observable to do twice.
  writeFileSync(join(tmp, 'mta.sh'), [
    '#!/bin/sh',
    `d="${MAIL}"`,
    'f="$d/m-$(date +%s%N)-$$"',
    'cat > "$f"',
    '[ -f "$d/.slow" ] && sleep "$(cat "$d/.slow")"',
    'exit 0',
  ].join('\n') + '\n')

  // A fake CBK API. GetTransactions answers with whatever the test wrote into
  // the encrp handle (base64url JSON), so a test can say "this transaction is
  // status 1 for order X" without a stateful gateway.
  writeFileSync(join(tmp, 'fake-cbk.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
header('Content-Type: application/json');
if (str_ends_with($p, '/Authenticate')) { echo json_encode(['Status' => '1', 'AccessToken' => 'tok']); exit; }
if (preg_match('#/GetTransactions/([^/]+)/([^/]+)$#', $p, $m)) {
    $j = json_decode(base64_decode(strtr(rawurldecode($m[1]), '-_', '+/')), true);
    echo json_encode(is_array($j) ? $j : ['Status' => '-1']);
    exit;
}
http_response_code(404); echo '{}';
`)

  const FAKE_PORT = await freePort(opts.sitePortFrom ?? 38400)
  const SITE_PORT = await freePort(FAKE_PORT + 1)
  const SITE = `http://127.0.0.1:${SITE_PORT}`
  const apiConfig = {
    db_host: `127.0.0.1;port=${DB_PORT}`, db_name: 'race', db_user: 'x', db_pass: 'xp', cron_key: 'race-cron-key-0123456789',
    warehouse_email: 'warehouse@sporta.test', mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw',
    admin_mail_from: 'cs@sporta.com.kw', customer_mail_from: 'cs@sporta.com.kw',
    admin_reset_url: 'https://www.sporta.com.kw/backends',
    // The cooldown and the per-client unit cap are other rules' business; the
    // reproducers that are about THEM switch them on again.
    order_cooldown_seconds: 0, order_client_units: 0,
    trusted_proxy_ips: ['127.0.0.1'],
    admin_session_dir: SESS, rate_limit_secret: 'race-rate-secret-0123456789',
    ...(opts.config ?? {}),
  }
  const knetConfig = {
    env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    tranportal_id: 'TESTID001', tranportal_password: 'testpass', resource_key: KNET_KEY,
    response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
    result_page_url: 'https://www.sporta.com.kw/payment/result', language: 'USA', log_file: join(tmp, 'knet.log'), callback_response: 'redirect',
  }
  const payConfig = {
    env: 'test', test_base: `http://127.0.0.1:${FAKE_PORT}/cbk`, production_base: 'https://pg.cbk.com',
    client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
    return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result',
    lang: 'en', log_file: join(tmp, 'cbk.log'), token_cache_file: join(tmp, 'cbk-token.json'),
  }
  writeFileSync(join(tmp, 'api-config.php'), phpExport(apiConfig))
  writeFileSync(join(PRIV, 'knet-config.php'), phpExport(knetConfig))
  writeFileSync(join(PRIV, 'pay-config.php'), phpExport(payConfig))

  const phpEnv = { ...process.env, SPORTA_API_CONFIG_FILE: join(tmp, 'api-config.php'), SPORTA_PRIVATE_CONFIG_DIR: PRIV }
  // opcache off: a file rewritten twice within its 2 s revalidation window is
  // served stale, and a mutation check rewrites PHP files between runs.
  const phpFlags = ['-d', 'opcache.enable=0', '-d', 'opcache.enable_cli=0', '-d', `sendmail_path=sh ${join(tmp, 'mta.sh')}`,
    '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', `error_log=${join(tmp, 'php-error.log')}`]
  procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${FAKE_PORT}`, join(tmp, 'fake-cbk.php')], { stdio: 'ignore', env: phpEnv }))
  procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${SITE_PORT}`, '-t', STAGE],
    { stdio: 'ignore', env: { ...phpEnv, PHP_CLI_SERVER_WORKERS: String(workers) } }))
  let siteUp = false
  for (let i = 0; i < 300 && !siteUp; i++) {
    try { siteUp = (await fetch(`${SITE}/api/api.php?r=checkout_config`)).status === 200 } catch { await sleep(100) }
  }
  if (!siteUp) { stop(); return { skip: 'the private PHP server did not start' } }

  // ----------------------------------------------------------------- helpers
  const sql = (text, db = 'race') => sqlRaw(text, db)
  const one = async (text) => (await sql(text)).split('\n')[0]
  const num = async (text) => Number(await one(text))
  const HTTPS = { 'X-Forwarded-Proto': 'https' }
  let ipSeq = 0
  // A distinct client address per call, through the trusted proxy header.
  const freshIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}` }

  const CUSTOMER = { name: 'Race Tester', phone: '99887766', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' }
  let phoneSeq = 0
  // A fresh, valid Kuwaiti mobile (8 digits starting 5/6/9) per call.
  const freshPhone = () => { phoneSeq++; return `9${String(1000000 + phoneSeq).padStart(7, '0')}` }

  const order = async ({ track, items, method = 'knet', phone, ip, code, lang, customer = {}, extra = {}, signal } = {}) => {
    const res = await fetch(`${SITE}/api/api.php?r=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip ?? freshIp() },
      body: JSON.stringify({
        track_id: track, items, payment_method: method,
        customer: { ...CUSTOMER, phone: phone ?? freshPhone(), ...customer },
        ...(code ? { discount_code: code } : {}), ...(lang ? { lang } : {}), ...extra,
      }),
      signal,
    }).catch((e) => ({ status: 0, text: async () => String(e) }))
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, body, text }
  }

  const knetCallback = async ({ trackid, result = 'CAPTURED', amt, paymentid, udf5 = '', extra = {} }) => {
    const trandata = knetEncrypt({
      paymentid: paymentid ?? String(100000000000 + Math.floor(Math.random() * 899999999999)),
      trackid, result, amt, tranid: 'T' + crypto.randomBytes(5).toString('hex'), ref: 'R' + crypto.randomBytes(4).toString('hex'),
      auth: 'A12345', udf5, ...extra,
    })
    const res = await fetch(`${SITE}/knet/callback.php`, {
      method: 'POST',
      headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': freshIp() },
      body: new URLSearchParams({ trandata }), redirect: 'manual',
    }).catch((e) => ({ status: 0, headers: new Headers(), text: async () => String(e) }))
    return { status: res.status, location: res.headers.get('location') ?? '', text: res.status === 0 ? await res.text() : '' }
  }

  // The T-Pay return: the handle IS the transaction (see fake-cbk.php above).
  const cbkCallback = async (tx) => {
    const encrp = Buffer.from(JSON.stringify(tx)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    const res = await fetch(`${SITE}/pay/callback.php?encrp=${encodeURIComponent(encrp)}`, {
      headers: { ...HTTPS, 'X-Forwarded-For': freshIp() }, redirect: 'manual',
    }).catch((e) => ({ status: 0, headers: new Headers(), text: async () => String(e) }))
    return { status: res.status, location: res.headers.get('location') ?? '' }
  }

  // ---- admin: signed-in sessions ----
  // PHP's file session handler holds an exclusive lock on the session file for
  // the whole request, so requests that share ONE admin cookie never overlap.
  // Two admins, or one admin on two devices, have two cookies and do: a race
  // between admin actions has to be run with one session per contender.
  let cookie = ''
  let adminReady = false
  const adminLogin = async () => {
    if (!adminReady) {
      const hash = spawnSync('php', ['-r', 'echo password_hash("race-admin-pass-1", PASSWORD_DEFAULT);']).stdout.toString()
      await sql(`delete from admin_users where email = 'race@sporta.test'; insert into admin_users (email, password_hash) values ('race@sporta.test', '${hash}')`)
      adminReady = true
    }
    const res = await fetch(`${SITE}/api/admin.php?r=login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'X-Forwarded-For': freshIp() },
      body: JSON.stringify({ email: 'race@sporta.test', password: 'race-admin-pass-1' }),
    })
    const set = res.headers.get('set-cookie')
    return res.status === 200 && set ? set.split(';')[0] : ''
  }
  const adminSignIn = async () => { cookie = await adminLogin(); return !!cookie }
  const adminSessions = async (n) => {
    const out = []
    for (let i = 0; i < n; i++) { const c = await adminLogin(); if (c) out.push(c) }
    return out
  }
  const admin = async (route, { method = 'GET', body, cookie: own } = {}) => {
    const res = await fetch(`${SITE}/api/admin.php?r=${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', Cookie: own ?? cookie, 'X-Forwarded-For': freshIp() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch((e) => ({ status: 0, text: async () => String(e) }))
    const text = await res.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, body: parsed, text }
  }

  // ---- crons, run as the host scheduler runs them ----
  const phpCli = (script, args = [], env = {}) => run('php', [...phpFlags, join(STAGE, 'api', script), ...args],
    { env: { ...phpEnv, ...env }, cwd: join(STAGE, 'api'), maxBuffer: 16 * 1024 * 1024 })
    .then((r) => r.stdout, (e) => `${e.stdout ?? ''}${e.stderr ?? ''}`)

  // ---- holding a lock from a second connection ----
  // Runs `begin; <stmt>; select 'LOCKED'; select sleep(n); commit;` in its own
  // session and resolves once the lock is really held. `done` resolves when it
  // has let go.
  const holdLock = (stmt, seconds) => new Promise((resolve, reject) => {
    // -n flushes after every statement: through a pipe the client otherwise
    // buffers 'LOCKED' until the script ends, i.e. after the lock is gone.
    const p = cli('race', ['-N', '-B', '-n'])
    let out = '', err = ''
    const done = new Promise((r) => p.on('close', r))
    p.stdout.on('data', (d) => { out += d; if (out.includes('LOCKED')) resolve({ done, kill: () => p.kill('SIGKILL') }) })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => { if (!out.includes('LOCKED')) reject(new Error(err.trim() || `holdLock exit ${code}`)) })
    p.stdin.on('error', () => { /* gone */ })
    p.stdin.end(`start transaction; ${stmt}; select 'LOCKED'; select sleep(${seconds}); commit;`)
  })

  // Fire the same async function n times in the same tick and wait for all.
  const burst = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)))

  const mailCount = () => readdirSync(MAIL).filter((f) => f.startsWith('m-')).length
  const mailClear = () => { for (const f of readdirSync(MAIL)) rmSync(join(MAIL, f), { force: true }) }
  const mailSlow = (seconds) => { if (seconds) writeFileSync(join(MAIL, '.slow'), String(seconds)); else rmSync(join(MAIL, '.slow'), { force: true }) }
  const rewriteApiConfig = (over = {}) => writeFileSync(join(tmp, 'api-config.php'), phpExport({ ...apiConfig, ...over }))
  // The two gateway configs, for a caller that wants the staged site to talk to
  // a fake bank / fake gateway of its own (neighbouring suites do).
  const rewriteKnetConfig = (over = {}) => writeFileSync(join(PRIV, 'knet-config.php'), phpExport({ ...knetConfig, ...over }))
  const rewritePayConfig = (over = {}) => writeFileSync(join(PRIV, 'pay-config.php'), phpExport({ ...payConfig, ...over }))
  // Another PHP server on a free port, under the rig's environment, removed with it.
  const spawnPhp = async (docroot, { router, config, from = 38600 } = {}) => {
    const port = await freePort(from)
    const cfgFile = config ? join(tmp, `api-config-${port}.php`) : phpEnv.SPORTA_API_CONFIG_FILE
    if (config) writeFileSync(cfgFile, phpExport({ ...apiConfig, ...config }))
    procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${port}`, '-t', docroot, ...(router ? [router] : [])],
      { stdio: 'ignore', env: { ...phpEnv, SPORTA_API_CONFIG_FILE: cfgFile, PHP_CLI_SERVER_WORKERS: String(workers) } }))
    for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break } catch { await sleep(100) } }
    return port
  }
  const phpErrors = () => { try { return readFileSync(join(tmp, 'php-error.log'), 'utf8') } catch { return '' } }

  return {
    tmp, STAGE, SITE, DB_PORT, SOCK, workers, tree,
    sql, one, num, burst, order, knetCallback, cbkCallback, adminSignIn, adminSessions, admin, phpCli, holdLock,
    freshIp, freshPhone, mailCount, mailClear, mailSlow, rewriteApiConfig, rewriteKnetConfig, rewritePayConfig,
    spawnPhp, phpErrors, stop, PRIV, apiConfigFile: join(tmp, 'api-config.php'), phpEnv,
    CUSTOMER,
  }
}
