// A PRIVATE STACK FOR DATABASE-CONNECTION WORK: its own MariaDB (restartable),
// its own PHP server, a staged copy of the backend. It never touches the shared
// test rig (database `sporta`, ports 8095-8100, 8188, 4173, dist/), any
// config.php in the repository, or the sandbox.
//
// TWO PHP SERVERS, because the question is about PHP processes:
//
//   'apache'      a real Apache 2.4 with mpm_prefork and mod_php, the runtime
//                 the live image has (php:8.4-apache). mod_php is not installed
//                 on most machines, so it is taken from the Ubuntu package WITHOUT
//                 installing it: `apt-get download libapache2-mod-php8.3`, then
//                 `dpkg-deb -x` into a cache directory, and loaded by an absolute
//                 LoadModule from a private httpd.conf. Nothing under /etc is
//                 touched. Apache will not serve as root, so the served tree is
//                 handed to `www-data` (the live container's user too).
//   'cli-server'  `php -S`, one process per worker (PHP_CLI_SERVER_WORKERS). A
//                 persistent connection belongs to a PROCESS, exactly as under
//                 prefork, so with one worker "request B is served by the same
//                 process as request A" is true by construction. It is the
//                 portable fallback and what the leak tests use by default.
//
// WHAT IS STAGED. `tree` is a dropin/ directory (php-store, php-knet, php-cbk).
// The default is the repository's own; a patched COPY of the tree is handed in
// to prove a patch before it is applied. They are copied to <site>/api, /knet
// and /pay with no config.php: the three configs live outside the web root and
// are found through SPORTA_API_CONFIG_FILE / SPORTA_PRIVATE_CONFIG_DIR, as on
// the VPS (config-path.php).
import { execFile, spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB = join(HERE, '..', '..')
export const DROPIN = join(WEB, 'dropin')
export const FIXTURES = join(WEB, 'scripts', 'fixtures')

export const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
// Scans upward from `from`. Other lanes run their own stacks in the 33xxx range
// at the same time, so a port is only ever taken after it was seen free.
export const freePort = async (from, taken = new Set()) => {
  for (let p = from; p < from + 400; p++) if (!taken.has(p) && await isFree(p)) { taken.add(p); return p }
  throw new Error('no free port')
}
const PORTS = new Set()

const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
export const phpExport = (o) => `<?php\nreturn ${(function ex(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return phpStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(ex).join(', ')}]`
  return `[${Object.entries(v).map(([k, x]) => `${phpStr(k)} => ${ex(x)}`).join(', ')}]`
})(o)};\n`

const MODPHP_DIRS = () => [
  process.env.POOL_MODPHP_SO,
  '/usr/lib/apache2/modules/libphp8.3.so', '/usr/lib/apache2/modules/libphp8.4.so', '/usr/lib/apache2/modules/libphp.so',
  join(process.env.POOL_CACHE || join(homedir(), '.cache', 'sporta-pool'), 'modphp', 'usr', 'lib', 'apache2', 'modules', 'libphp8.3.so'),
].filter(Boolean)

// mod_php for the PHP minor that is installed, without installing anything.
export function findModPhp({ fetchIt = true } = {}) {
  for (const p of MODPHP_DIRS()) if (existsSync(p)) return p
  if (!fetchIt || !have('apt-get') || !have('dpkg-deb')) return null
  const phpMm = spawnSync('php', ['-r', 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'], { encoding: 'utf8' }).stdout.trim()
  const cache = process.env.POOL_CACHE || join(homedir(), '.cache', 'sporta-pool')
  const dl = join(cache, 'debs')
  mkdirSync(dl, { recursive: true })
  // `apt-get download` must be run from the target directory and writes a .deb there.
  const r = spawnSync('apt-get', ['download', `libapache2-mod-php${phpMm}`], { cwd: dl, encoding: 'utf8', timeout: 120000 })
  if (r.status !== 0) return null
  const deb = readdirSync(dl).find((n) => n.startsWith(`libapache2-mod-php${phpMm}_`) && n.endsWith('.deb'))
  if (!deb) return null
  const out = join(cache, 'modphp')
  mkdirSync(out, { recursive: true })
  if (spawnSync('dpkg-deb', ['-x', join(dl, deb), out]).status !== 0) return null
  const so = join(out, 'usr', 'lib', 'apache2', 'modules', `libphp${phpMm}.so`)
  return existsSync(so) ? so : null
}

export function toolsPresent() {
  const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
  const missing = [['php', have('php')], ['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-install-db', !!installDb]]
    .filter(([, ok]) => !ok).map(([n]) => n)
  return { installDb, missing }
}

export async function startPoolRig(opts = {}) {
  const tree = opts.tree ?? DROPIN
  const { installDb, missing } = toolsPresent()
  if (missing.length) return { skip: `${missing.join(', ')} not installed, so no private instance can be built` }
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const label = opts.label ?? 'pool'

  // mod_php is looked for whenever Apache exists, so a rig that starts as php -S can switch to prefork later
  const modphp = have('apache2') ? findModPhp({ fetchIt: (opts.server ?? 'cli-server') === 'apache' }) : null
  let server = opts.server ?? 'cli-server'
  if (server === 'apache' && !modphp) {
    if (opts.requireApache) return { skip: 'no Apache with mod_php available (apache2 + libapache2-mod-php), so the prefork stack cannot be built' }
    server = 'cli-server'
  }

  const tmp = mkdtempSync(join(opts.base ?? tmpdir(), `sporta-${label}-`))
  chmodSync(tmp, 0o755)
  const kids = []
  let stopped = false
  let sockDir = tmp   // a second directory when the socket path would be too long (below); removed with the first
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const k of kids.splice(0)) { try { process.kill(-k.pid, 'SIGKILL') } catch { try { k.kill('SIGKILL') } catch { /* gone */ } } }
    if (!process.env.KEEP) {
      try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
      if (sockDir !== tmp) { try { rmSync(sockDir, { recursive: true, force: true }) } catch { /* ignore */ } }
    } else console.log(`KEEP=1: ${tmp}`)
  }
  process.on('exit', stop)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130) })

  // ---------------------------------------------------------------- database
  const DATA = join(tmp, 'db')
  mkdirSync(DATA)
  if (join(tmp, 'db.sock').length > 90) { sockDir = mkdtempSync('/tmp/pl-'); chmodSync(sockDir, 0o755) }
  const SOCK = join(sockDir, 'db.sock')
  // On a machine under heavy load the bootstrap occasionally dies; a second and third attempt cost seconds.
  let init = null
  for (let attempt = 0; attempt < 3; attempt++) {
    rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA)
    init = spawnSync(installDb, ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db',
      ...(asRoot ? ['--user=root'] : [])], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 300000 })
    if (init.status === 0) break
  }
  if (init.status !== 0) { stop(); return { skip: `could not initialise a private MariaDB data directory (${String(init.stderr || init.error || '').trim().split('\n').slice(-1)[0]?.slice(0, 160)})` } }
  const DB_PORT = await freePort(opts.dbPortFrom ?? 33750, PORTS)
  const dbArgs = ['--no-defaults', `--datadir=${DATA}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--bind-address=127.0.0.1',
    '--skip-name-resolve', `--pid-file=${join(tmp, 'db.pid')}`, '--innodb-flush-log-at-trx-commit=0', '--max-allowed-packet=64M',
    `--max-connections=${opts.dbMaxConnections ?? 200}`, '--innodb-buffer-pool-size=64M', '--innodb-lock-wait-timeout=5',
    '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', '--skip-log-warnings',
    ...(opts.dbArgs ?? []), ...(asRoot ? ['--user=root'] : [])]
  let dbChild = null
  const dbLog = join(tmp, 'mariadbd.log')
  const cli = (db, extra = []) => spawn('mariadb', ['--no-defaults', '-S', SOCK, '-uroot', '--default-character-set=utf8mb4', ...(db ? [db] : []), ...extra])
  const sqlRaw = (text, db = 'pool') => new Promise((resolve, reject) => {
    const p = cli(db, ['-N', '-B'])
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => (code === 0 ? resolve(out.replace(/\n$/, '')) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
    p.stdin.on('error', () => { /* the client exited first; its exit code says why */ })
    p.stdin.end(text)
  })
  const dbUp = async (tries = 300) => {
    for (let i = 0; i < tries; i++) { try { await sqlRaw('select 1', ''); return true } catch { await sleep(150) } }
    return false
  }
  const dbStart = async () => {
    dbChild = spawn('mariadbd', dbArgs, { stdio: ['ignore', 'ignore', openSync(dbLog, 'a')], detached: true })
    kids.push(dbChild)
    return dbUp()
  }
  // graceful: SIGTERM, wait for exit. crash: SIGKILL, the way an OOM kill looks to a client.
  const dbStop = async ({ crash = false } = {}) => {
    if (!dbChild) return
    const c = dbChild
    dbChild = null
    try { process.kill(-c.pid, crash ? 'SIGKILL' : 'SIGTERM') } catch { /* gone */ }
    for (let i = 0; i < 200; i++) { try { process.kill(-c.pid, 0) } catch { break } await sleep(100) }
    try { process.kill(-c.pid, 'SIGKILL') } catch { /* gone */ }
    const ix = kids.indexOf(c); if (ix >= 0) kids.splice(ix, 1)
  }
  if (!(await dbStart())) { stop(); return { skip: 'the private MariaDB did not start' } }
  // Three accounts, one per kind of caller, so "a different persistent identity per role" can be shown
  // for different accounts (the per-role least-privilege setup) as well as for one shared account.
  const PW = { app: 'pw-app-' + Math.random().toString(36).slice(2), knet: 'pw-knet-' + Math.random().toString(36).slice(2), pay: 'pw-pay-' + Math.random().toString(36).slice(2) }
  await sqlRaw(`create database pool character set utf8mb4 collate utf8mb4_unicode_ci;
    create user 'pool_app'@'127.0.0.1' identified by '${PW.app}'; grant all on pool.* to 'pool_app'@'127.0.0.1';
    create user 'pool_knet'@'127.0.0.1' identified by '${PW.knet}'; grant all on pool.* to 'pool_knet'@'127.0.0.1';
    create user 'pool_pay'@'127.0.0.1' identified by '${PW.pay}'; grant all on pool.* to 'pool_pay'@'127.0.0.1';`, '')

  const SQLDIR = join(tree, 'php-store')
  await sqlRaw(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'))
  const SKIP_SQL = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
  for (const f of readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !SKIP_SQL.has(n)).sort()) {
    await sqlRaw(readFileSync(join(SQLDIR, f), 'utf8'))
  }
  // The birthday columns live in sporta-live/birthday, not in dropin/php-store.
  await sqlRaw('alter table customer_accounts add column if not exists birthday date null default null, ' +
    'add column if not exists birthday_set_at datetime null default null, add column if not exists birthday_sent_year smallint null default null')
  await sqlRaw('update product_variants set stock = 1000000')

  // -------------------------------------------------------------- staged tree
  const SITE_DIR = join(tmp, 'site'), PRIV = join(tmp, 'private'), WRITABLE = join(tmp, 'writable')
  for (const d of [SITE_DIR, PRIV, WRITABLE]) mkdirSync(d, { recursive: true })
  const copyDropin = (from, to) => cpSync(join(tree, from), join(SITE_DIR, to), { recursive: true, filter: (s) => !/\/config\.php$/.test(s) })
  copyDropin('php-store', 'api'); copyDropin('php-knet', 'knet'); copyDropin('php-cbk', 'pay')
  for (const [name, src] of Object.entries(opts.extraFiles ?? {})) {
    // { 'api/pool-probe.php': '/abs/path' } — test-only endpoints exist in the STAGED copy only.
    const dest = join(SITE_DIR, name)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(src, dest)
  }
  // The SPA shell the SEO pages render around (seo-page.php reads ../index.html), and the router that
  // stands in for the rewrite rules of public/.htaccess under the PHP built-in server.
  cpSync(join(WEB, 'index.html'), join(SITE_DIR, 'index.html'))
  writeFileSync(join(SITE_DIR, 'router.php'), `<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if ($uri !== '/' && is_file(__DIR__ . $uri)) return false;
if (preg_match('#^/(product/[^/]+|shop)/?$#', $uri)) { require __DIR__ . '/api/seo-page.php'; return true; }
return false;
`)
  for (const d of ['sessions', 'mail']) mkdirSync(join(WRITABLE, d), { recursive: true })
  // A fake mail transport, so a route that mails does not need a server.
  writeFileSync(join(tmp, 'mta.sh'), `#!/bin/sh\ncat > "${join(WRITABLE, 'mail')}/m-$(date +%s%N)-$$"\nexit 0\n`)
  chmodSync(join(tmp, 'mta.sh'), 0o755)

  const SITE_PORT = await freePort(opts.sitePortFrom ?? 33780, PORTS)
  const SITE = `http://127.0.0.1:${SITE_PORT}`
  const baseApi = () => ({
    db_host: `127.0.0.1;port=${DB_PORT}`, db_name: 'pool', db_user: 'pool_app', db_pass: PW.app, cron_key: 'pool-cron-key-0123456789',
    warehouse_email: 'warehouse@sporta.test', mail_from: 'qa-cs@sporta.com.kw', mail_reply_to: 'qa-cs@sporta.com.kw',
    admin_mail_from: 'qa-cs@sporta.com.kw', customer_mail_from: 'qa-cs@sporta.com.kw',
    admin_reset_url: 'https://www.sporta.com.kw/backends',
    // A load test is one address; behind Traefik every shopper is a different one. The proxy header
    // names the client, exactly as it does live (trusted_proxy_ips), so the throttle sees many clients.
    trusted_proxy_ips: ['127.0.0.1'], order_cooldown_seconds: 0, order_client_units: 0,
    admin_session_dir: join(WRITABLE, 'sessions'), rate_limit_secret: 'pool-rate-secret-0123456789',
    ...(opts.config ?? {}),
  })
  const baseKnet = () => ({
    env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    tranportal_id: 'TESTID001', tranportal_password: 'testpass', resource_key: 'abcdef0123456789',
    response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
    result_page_url: 'https://www.sporta.com.kw/payment/result', language: 'USA', log_file: join(WRITABLE, 'knet.log'), callback_response: 'redirect',
    mysql_host: `127.0.0.1;port=${DB_PORT}`, mysql_name: 'pool', mysql_user: 'pool_knet', mysql_pass: PW.knet,
    ...(opts.knetConfig ?? {}),
  })
  const basePay = () => ({
    env: 'test', test_base: 'http://127.0.0.1:9/cbk', production_base: 'https://pg.cbk.com',
    client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
    return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result',
    lang: 'en', log_file: join(WRITABLE, 'cbk.log'), token_cache_file: join(WRITABLE, 'cbk-token.json'),
    mysql_host: `127.0.0.1;port=${DB_PORT}`, mysql_name: 'pool', mysql_user: 'pool_pay', mysql_pass: PW.pay,
    ...(opts.payConfig ?? {}),
  })
  let curApi = baseApi(), curKnet = baseKnet(), curPay = basePay()
  const API_CFG = join(tmp, 'api-config.php')
  const writeApi = (over = {}) => { curApi = { ...baseApi(), ...over }; writeFileSync(API_CFG, phpExport(curApi)); chmodSync(API_CFG, 0o644) }
  const writeKnet = (over = {}) => { curKnet = { ...baseKnet(), ...over }; writeFileSync(join(PRIV, 'knet-config.php'), phpExport(curKnet)); chmodSync(join(PRIV, 'knet-config.php'), 0o644) }
  const writePay = (over = {}) => { curPay = { ...basePay(), ...over }; writeFileSync(join(PRIV, 'pay-config.php'), phpExport(curPay)); chmodSync(join(PRIV, 'pay-config.php'), 0o644) }
  writeApi(); writeKnet(); writePay()

  const phpEnv = { ...process.env, SPORTA_API_CONFIG_FILE: API_CFG, SPORTA_PRIVATE_CONFIG_DIR: PRIV }
  const ERRLOG = join(WRITABLE, 'php-error.log')
  const opcache = opts.opcache ? 1 : 0
  const phpIni = [
    'display_errors=0', 'log_errors=1', `error_log=${ERRLOG}`, `sendmail_path=sh ${join(tmp, 'mta.sh')}`,
    `opcache.enable=${opcache}`, 'opcache.enable_cli=0', 'opcache.validate_timestamps=1', 'opcache.revalidate_freq=0', 'date.timezone=UTC',
    'memory_limit=256M', 'max_execution_time=60', 'variables_order=EGPCS',
  ]

  // ------------------------------------------------------------------ server
  let serverChild = null
  let workers = opts.workers ?? 1
  const serverLog = join(tmp, 'server.log')
  let maxWorkers = opts.maxWorkers ?? 150
  let keepAlive = opts.keepAlive !== false
  const confFile = join(tmp, 'httpd.conf')
  const mods = '/usr/lib/apache2/modules'
  if (modphp) {
    mkdirSync(join(tmp, 'apache'), { recursive: true })
    mkdirSync(join(tmp, 'php'), { recursive: true })
    writeFileSync(join(tmp, 'php', 'php.ini'), phpIni.join('\n') + '\n')
  }
  const writeHttpdConf = () => {
    const spare = opts.spare ?? (maxWorkers < 10 ? [1, 1] : [5, 10])
    writeFileSync(confFile, [
      `ServerRoot "${join(tmp, 'apache')}"`, 'ServerName 127.0.0.1', `PidFile "${join(tmp, 'apache.pid')}"`,
      `DefaultRuntimeDir "${join(tmp, 'apache')}"`, `Listen 127.0.0.1:${SITE_PORT}`,
      `ErrorLog "${join(tmp, 'apache-error.log')}"`, 'LogLevel warn',
      'User www-data', 'Group www-data',
      `LoadModule mpm_prefork_module ${mods}/mod_mpm_prefork.so`,
      ...['authz_core', 'dir', 'mime', 'alias', 'env', 'setenvif', 'headers', 'rewrite', 'status', 'authn_core', 'authz_host', 'access_compat']
        .filter((m) => existsSync(`${mods}/mod_${m}.so`)).map((m) => `LoadModule ${m}_module ${mods}/mod_${m}.so`),
      `LoadModule php_module ${modphp}`, `PHPIniDir "${join(tmp, 'php')}"`,
      'TypesConfig /etc/mime.types',
      // the official php:8.4-apache image: mpm_prefork.conf as Debian ships it, mod_php for *.php
      `StartServers ${Math.min(opts.startServers ?? 5, maxWorkers)}`, `MinSpareServers ${spare[0]}`, `MaxSpareServers ${spare[1]}`,
      `MaxRequestWorkers ${maxWorkers}`, `ServerLimit ${Math.max(maxWorkers, 16)}`, `MaxConnectionsPerChild ${opts.maxConnectionsPerChild ?? 0}`,
      `KeepAlive ${keepAlive ? 'On' : 'Off'}`, 'MaxKeepAliveRequests 100', 'KeepAliveTimeout 5',
      'ExtendedStatus On', 'LimitRequestBody 2097152',
      `DocumentRoot "${SITE_DIR}"`, 'DirectoryIndex index.php index.html',
      `<Directory "${SITE_DIR}">`, '  Options -Indexes +FollowSymLinks', '  AllowOverride None', '  Require all granted', '</Directory>',
      '<FilesMatch "\\.php$">', '  SetHandler application/x-httpd-php', '</FilesMatch>',
      'RewriteEngine On', 'RewriteRule ^/?(product/[^/]+|shop)/?$ /api/seo-page.php [END]',
      '<Location "/server-status">', '  SetHandler server-status', '  Require local', '</Location>',
    ].join('\n') + '\n')
  }
  const serverUp = async () => {
    for (let i = 0; i < 300; i++) {
      try { if ((await fetch(`${SITE}/api/api.php?r=checkout_config`, { headers: { 'X-Forwarded-For': '10.9.9.9' } })).status === 200) return true } catch { /* not yet */ }
      await sleep(100)
    }
    return false
  }
  const serverStart = async (over = {}) => {
    if (over.workers) workers = over.workers
    if (over.maxWorkers) maxWorkers = over.maxWorkers
    if (over.keepAlive !== undefined) keepAlive = over.keepAlive
    if (over.kind) {
      if (over.kind === 'apache' && !modphp) return false
      server = over.kind
    }
    if (server === 'apache') {
      // The served tree and the writable dirs belong to www-data (Apache will not serve as root).
      spawnSync('chown', ['-R', 'www-data:www-data', WRITABLE]); spawnSync('chmod', ['-R', 'u+rwX,go+rX', SITE_DIR, PRIV]); spawnSync('chmod', ['-R', 'a+rwX', WRITABLE])
      writeHttpdConf()
      serverChild = spawn('apache2', ['-f', confFile, '-DFOREGROUND'], { stdio: ['ignore', 'ignore', openSync(serverLog, 'a')], env: { ...phpEnv, PHP_INI_SCAN_DIR: '/etc/php/8.3/cli/conf.d' }, detached: true })
    } else {
      const flags = phpIni.flatMap((l) => ['-d', l])
      serverChild = spawn('php', [...flags, '-S', `127.0.0.1:${SITE_PORT}`, '-t', SITE_DIR, join(SITE_DIR, 'router.php')],
        { stdio: ['ignore', 'ignore', openSync(serverLog, 'a')], env: { ...phpEnv, ...(workers > 1 ? { PHP_CLI_SERVER_WORKERS: String(workers) } : {}) }, detached: true })
    }
    kids.push(serverChild)
    const up = await serverUp()
    // `php -S` forks its workers one by one: a burst sent the instant the first one answers would be accepted
    // entirely by it (one process accepts every waiting connection) and look like a single-process server.
    if (up && server === 'cli-server' && workers > 1) {
      for (let i = 0; i < 200 && serverPids().length < workers; i++) await sleep(100)
      await sleep(300)
    }
    return up
  }
  const serverStop = async () => {
    if (!serverChild) return
    const c = serverChild
    serverChild = null
    try { process.kill(-c.pid, 'SIGTERM') } catch { /* gone */ }
    for (let i = 0; i < 100; i++) { try { process.kill(-c.pid, 0) } catch { break } await sleep(100) }
    try { process.kill(-c.pid, 'SIGKILL') } catch { /* gone */ }
    const ix = kids.indexOf(c); if (ix >= 0) kids.splice(ix, 1)
  }
  if (!(await serverStart())) {
    const tail = existsSync(serverLog) ? readFileSync(serverLog, 'utf8').trim().split('\n').slice(-3).join(' | ').slice(0, 300) : 'no log'
    stop(); return { skip: `the private ${server} did not start (${tail})` }
  }

  // ----------------------------------------------------------------- helpers
  const sql = (text, db = 'pool') => sqlRaw(text, db)
  const one = async (text) => (await sql(text)).split('\n')[0]
  const num = async (text) => Number(await one(text))
  // Server-wide counters the benchmarks and the suite compare before/after.
  const counters = async () => {
    const rows = await sql("show global status where Variable_name in ('Connections','Threads_created','Threads_connected','Aborted_connects','Aborted_clients','Max_used_connections','Threads_running','Questions')", '')
    return Object.fromEntries(rows.split('\n').filter(Boolean).map((l) => { const [k, v] = l.split('\t'); return [k, Number(v)] }))
  }
  // Every setting the pooling question depends on, read from the server (the same list the probe prints).
  const vars = async () => {
    const rows = await sql("show global variables where Variable_name in ('version','max_connections','max_user_connections','thread_handling','thread_pool_size','thread_cache_size','wait_timeout','interactive_timeout','connect_timeout','sql_mode','time_zone','max_statement_time','innodb_lock_wait_timeout')", '')
    return Object.fromEntries(rows.split('\n').filter(Boolean).map((l) => { const [k, v] = l.split('\t'); return [k, v] }))
  }
  const processes = async (user) => num(`select count(*) from information_schema.processlist where user = '${user}'`)
  // a function declaration, not a const: serverStart() below reads it while the first server is coming up
  function serverPids() {
    if (!serverChild) return []
    const r = spawnSync('pgrep', ['-P', String(serverChild.pid)], { encoding: 'utf8' })
    return r.stdout.split('\n').filter(Boolean).map(Number)
  }
  // CPU time (clock ticks, 100 Hz) used so far by the PHP side (server master, its live children, plus
  // the time of children already reaped) and by mariadbd. Wall-clock latency on a shared, overloaded
  // machine mostly measures the scheduler; CPU time per request does not move with the load.
  const statTicks = (pid, withChildren) => {
    try {
      const f = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const a = f.slice(f.lastIndexOf(')') + 2).split(' ')   // a[0] is state (field 3)
      const u = Number(a[11]) + Number(a[12])                  // utime + stime (fields 14, 15)
      return withChildren ? u + Number(a[13]) + Number(a[14]) : u // + cutime + cstime (fields 16, 17)
    } catch { return 0 }
  }
  const cpuTicks = () => {
    const master = serverChild?.pid
    let php = 0
    if (master) { php += statTicks(master, true); for (const k of serverPids()) php += statTicks(k, false) }
    return { php, db: dbChild ? statTicks(dbChild.pid, false) : 0 }
  }
  const phpErrors = () => { try { return readFileSync(ERRLOG, 'utf8') } catch { return '' } }
  const phpCli = (script, args = [], env = {}) => run('php', [...phpIni.flatMap((l) => ['-d', l]), join(SITE_DIR, 'api', script), ...args],
    { env: { ...phpEnv, ...env }, cwd: join(SITE_DIR, 'api'), maxBuffer: 16 * 1024 * 1024 })
    .then((r) => r.stdout, (e) => `${e.stdout ?? ''}${e.stderr ?? ''}`)

  return {
    get kind() { return server }, hasApache: !!modphp, tmp, SITE, SITE_DIR, DB_PORT, SOCK, PRIV, WRITABLE, PW, maxWorkers, modphp, tree,
    sql, one, num, counters, vars, processes, serverPids, cpuTicks, phpErrors, phpCli, cli,
    dbStop, dbStart, dbUp,
    dbRestart: async ({ crash = false } = {}) => { await dbStop({ crash }); return dbStart() },
    serverStart, serverStop, serverRestart: async (over) => { await serverStop(); return serverStart(over) },
    // overwrite one file of the STAGED tree (a mutant, a test hook); never the repository
    stageWrite: (rel, text) => { writeFileSync(join(SITE_DIR, rel), text); chmodSync(join(SITE_DIR, rel), 0o644) },
    stageRead: (rel) => readFileSync(join(SITE_DIR, rel), 'utf8'),
    writeApi, writeKnet, writePay, getApi: () => curApi, getKnet: () => curKnet, getPay: () => curPay,
    stop,
  }
}
