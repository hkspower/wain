// XSS THROUGH CONFIGURATION: every configuration-like value that can end up in
// a page, an email, XML, JSON or a script, fed hostile text on a PRIVATE
// instance, and the output parsed by a real HTML/XML parser.
//
// WHAT "CONFIGURATION" MEANS HERE. Four sources, because the owner can write a
// value into the shop from four places and the server trusts each differently:
//   1. config files (api/config.php, knet-config.php, pay-config.php, env);
//   2. the settings table the ADMIN edits (hero, promo bar, checkout notice,
//      theme, SEO overrides) plus the rows the admin edits (products, brands,
//      discounts, hero slides, customers' orders);
//   3. public/config.js (window.SPORTA_CONFIG);
//   4. whatever the owner pastes into a /backends form.
// Sources 2 and 4 are tried twice: through the real admin routes (does the
// SERVER REJECT hostile input, or STORE it and rely on output escaping?) and by
// writing the row directly with SQL (a hostile admin, phpMyAdmin, a leaked
// database login: the defence is then ONLY output escaping and read-side
// re-validation). Both outcomes are acceptable; the weak one is the finding.
//
// WHAT HOLDS IS ASSERTED; WHAT IS WEAK IS PRINTED AS `weak` and does not fail
// the run (it fails with --strict), so the suite documents a known gap without
// turning every other suite's release red, and flips to `ok` the day it is
// fixed. A `weak` line is never a pass: it names the field and the payload.
//
// SELF-CONTAINED: it builds its own MariaDB (port from 3392), its own PHP
// servers (from 8421) and a staged copy of dropin/ in a temp directory, and
// removes all of it. It never touches the shared sandbox (database `sporta`,
// ports 8095-8100/8188), dist/, or any config.php in the repo. If MariaDB or
// PHP is missing it says so and exits 0. Chromium (Playwright) is used to parse
// pages and to LOAD them while listening for dialogs and requests to
// evil.example; without it the parser/dialog checks are skipped, loudly.
//
//   npm run test:xss-config            (add --strict to fail on `weak`)
//   KEEP=1 npm run test:xss-config     (keep the temp directory for inspection)
import { execFile, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const DROPIN = join(WEB, 'dropin')
const STRICT = process.argv.includes('--strict')

let fails = 0, weaks = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
// A known weakness: prints `weak` while it exists, `ok` once it is fixed.
const weak = (c, n, d) => {
  if (c) return ok(n, d)
  weaks++
  console.log(`weak ${n}${d ? `  — ${d}` : ''}`)
}
const info = (n, d = '') => console.log(`info ${n}${d ? `  — ${d}` : ''}`)
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

// ------------------------------------------------------------------ prerequisites
const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
for (const [bin, ok2] of [['php', have('php')], ['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-install-db', !!installDb]]) {
  if (!ok2) {
    console.log(`SKIP xss-config: ${bin} is not installed, so no private instance can be built. Nothing was tested.`)
    process.exit(0)
  }
}

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 60; p++) if (await isFree(p)) return p; throw new Error('no free port') }

const tmp = mkdtempSync(join(tmpdir(), 'sporta-xss-config-'))
const procs = []
const procsCleanup = []
const cleanup = () => {
  for (const p of procs) { try { p.kill() } catch { /* gone */ } }
  for (const d of procsCleanup) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
  if (!process.env.KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

// ------------------------------------------------------------------ the database
const DATA = join(tmp, 'db')
mkdirSync(DATA)
// A unix socket path is limited to ~107 bytes; a deep TMPDIR can exceed it, so
// the socket (and only the socket) falls back to a short directory of its own.
let sockDir = tmp
if (join(tmp, 'db.sock').length > 100) { sockDir = mkdtempSync('/tmp/sx-'); procsCleanup.push(sockDir) }
const SOCK = join(sockDir, 'db.sock')
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
{
  const r = spawnSync(installDb, ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (r.status !== 0) { console.log('SKIP xss-config: could not initialise a private MariaDB data directory.'); process.exit(0) }
}
const DB_PORT = await freePort(3392)
procs.push(spawn('mariadbd', ['--no-defaults', `--datadir=${DATA}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--bind-address=127.0.0.1',
  '--skip-name-resolve', `--pid-file=${join(tmp, 'db.pid')}`, '--innodb-flush-log-at-trx-commit=0', '--max-allowed-packet=64M',
  ...(asRoot ? ['--user=root'] : [])], { stdio: ['ignore', 'ignore', openSync(join(tmp, 'mariadbd.log'), 'a')] }))
const mysqlRaw = (sql, db = 'xss') => new Promise((resolve, reject) => {
  const p = spawn('mariadb', ['--no-defaults', '-S', SOCK, '-uroot', '--default-character-set=utf8mb4', ...(db ? [db] : []), '-N', '-B'])
  let out = '', err = ''
  p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
  p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
  p.stdin.on('error', () => { /* the client exited first; its exit code says why */ })
  p.stdin.end(sql)
})
let dbUp = false
for (let i = 0; i < 100 && !dbUp; i++) {
  try { await mysqlRaw('select 1', ''); dbUp = true } catch { await new Promise((r) => setTimeout(r, 200)) }
}
if (!dbUp) {
  console.log(`SKIP xss-config: the private MariaDB did not start (${existsSync(join(tmp, 'mariadbd.log')) ? readFileSync(join(tmp, 'mariadbd.log'), 'utf8').trim().split('\n').slice(-2).join(' | ').slice(0, 200) : 'no log'}).`)
  process.exit(0)
}
await mysqlRaw("create database xss character set utf8mb4 collate utf8mb4_unicode_ci; create user 'x'@'127.0.0.1' identified by 'xp'; grant all on xss.* to 'x'@'127.0.0.1';", '')
const SQLDIR = join(DROPIN, 'php-store')
await mysqlRaw(readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8'))
const SKIP_SQL = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
for (const f of readdirSync(SQLDIR).filter((n) => n.endsWith('.mysql.sql') && !SKIP_SQL.has(n)).sort()) {
  await mysqlRaw(readFileSync(join(SQLDIR, f), 'utf8'))
}
// The birthday columns are not in dropin/php-store/*.mysql.sql (they live in
// sporta-live/birthday/birthday.mysql.sql), so the suite adds them itself.
await mysqlRaw('alter table customer_accounts add column if not exists birthday date null default null, ' +
  'add column if not exists birthday_set_at datetime null default null, add column if not exists birthday_sent_year smallint null default null')
// Direct row writes model a hostile database editor: no strict mode, so a
// payload longer than its column is cut rather than refused.
const sql = (text, db) => mysqlRaw(`set session sql_mode='';\n${text}`, db)
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\0/g, '\\0')}'`
const hex = (s) => `convert(0x${Buffer.from(String(s), 'utf8').toString('hex') || '00'} using utf8mb4)`
const h = (s) => (s === '' ? "''" : hex(s))
await sql('update product_variants set stock = 1000')

// ------------------------------------------------------------------ the staged tree
const STAGE = join(tmp, 'site'), PRIV = join(tmp, 'private'), MAIL = join(tmp, 'mail')
for (const d of [STAGE, PRIV, MAIL, join(tmp, 'sessions')]) mkdirSync(d, { recursive: true })
const copyDropin = (from, to) => cpSync(join(DROPIN, from), join(STAGE, to), { recursive: true, filter: (s) => !/\/config\.php$/.test(s) })
copyDropin('php-store', 'api'); copyDropin('php-knet', 'knet'); copyDropin('php-cbk', 'pay')
cpSync(join(WEB, 'index.html'), join(STAGE, 'index.html'))
// Stands in for .htaccess: real files are served as they are, the two sitemaps
// and every other path go to the same scripts the rewrite rules name.
writeFileSync(join(STAGE, 'router.php'), `<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if ($uri !== '/' && is_file(__DIR__ . $uri)) return false;
$map = ['/sitemap.xml' => '/api/sitemap-index.php', '/sitemap-products.xml' => '/api/sitemap-products.php'];
require __DIR__ . ($map[$uri] ?? '/api/seo-page.php');
`)
writeFileSync(join(tmp, 'mta.sh'), readFileSync(join(HERE, 'fake-mta.sh')))
writeFileSync(join(tmp, 'fake-cbk.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
header('Content-Type: application/json');
if (str_ends_with($p, '/Authenticate')) {
    $t = is_file(__DIR__ . '/token.txt') ? file_get_contents(__DIR__ . '/token.txt') : 'tok';
    echo json_encode(['Status' => '1', 'AccessToken' => $t]);
    exit;
}
http_response_code(404); echo '{}';
`)
writeFileSync(join(tmp, 'token.txt'), 'tok')

const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpExport = (o) => `<?php\nreturn ${(function ex(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return phpStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `[${Object.entries(v).map(([k, x]) => `${phpStr(k)} => ${ex(x)}`).join(', ')}]`
})(o)};\n`
const CRON_KEY = 'xss-cron-key-0123456789'
const FAKE_PORT = await freePort(8421)
const SITE_PORT = await freePort(FAKE_PORT + 1)
const SITE = `http://127.0.0.1:${SITE_PORT}`
const apiConfig = {
  db_host: `127.0.0.1;port=${DB_PORT}`, db_name: 'xss', db_user: 'x', db_pass: 'xp', cron_key: CRON_KEY,
  warehouse_email: 'warehouse@sporta.test', mail_from: 'cs@sporta.com.kw', mail_reply_to: 'cs@sporta.com.kw',
  admin_mail_from: 'cs@sporta.com.kw', customer_mail_from: 'cs@sporta.com.kw',
  admin_reset_url: 'https://www.sporta.com.kw/backends', order_cooldown_seconds: 0,
  admin_session_dir: join(tmp, 'sessions'), rate_limit_secret: 'xss-rate-secret-0123456789',
}
const knetConfig = {
  env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
  tranportal_id: 'TESTID001', tranportal_password: 'testpass', resource_key: 'abcdef0123456789',
  response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
  result_page_url: 'https://www.sporta.com.kw/payment/result', language: 'USA', log_file: join(tmp, 'knet.log'), callback_response: 'auto',
}
const payConfig = {
  env: 'test', test_base: `http://127.0.0.1:${FAKE_PORT}/cbk`, production_base: 'https://pg.cbk.com',
  client_id: 'TESTCLIENT', client_secret: 'testsecret', encrp_key: 'TESTENCRP',
  return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result',
  lang: 'en', log_file: join(tmp, 'cbk.log'), token_cache_file: join(tmp, 'cbk-token.json'),
}
const writeApiConfig = (over = {}) => writeFileSync(join(tmp, 'api-config.php'), phpExport({ ...apiConfig, ...over }))
const writeKnet = (over = {}) => writeFileSync(join(PRIV, 'knet-config.php'), phpExport({ ...knetConfig, ...over }))
const writePay = (over = {}) => { writeFileSync(join(PRIV, 'pay-config.php'), phpExport({ ...payConfig, ...over })); try { rmSync(payConfig.token_cache_file) } catch { /* none */ } }
writeApiConfig(); writeKnet(); writePay()

const phpEnv = { ...process.env, SPORTA_API_CONFIG_FILE: join(tmp, 'api-config.php'), SPORTA_PRIVATE_CONFIG_DIR: PRIV }
// opcache is ON in the built-in server (its SAPI is "cli-server", which
// opcache.enable governs, not opcache.enable_cli) and revalidates a file's
// timestamp at most every 2 s: a config rewritten twice within two seconds is
// served stale, and this suite rewrites the three configs dozens of times in a
// row. Measured: the same hostile test_base was refused in one run and
// "accepted" in the next. Off, every request reads the file it is given.
const phpFlags = ['-d', 'opcache.enable=0', '-d', 'opcache.enable_cli=0', '-d', `sendmail_path=sh ${join(tmp, 'mta.sh')} ${MAIL}`, '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', `error_log=${join(tmp, 'php-error.log')}`]
procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${FAKE_PORT}`, join(tmp, 'fake-cbk.php')], { stdio: 'ignore', env: phpEnv }))
procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${SITE_PORT}`, '-t', STAGE, join(STAGE, 'router.php')], { stdio: 'ignore', env: { ...phpEnv, PHP_CLI_SERVER_WORKERS: '4' } }))
let siteUp = false
for (let i = 0; i < 100 && !siteUp; i++) {
  try { siteUp = (await fetch(`${SITE}/api/api.php?r=checkout_config`)).status === 200 } catch { await new Promise((r) => setTimeout(r, 100)) }
}
head('the private instance')
is(siteUp, `own MariaDB :${DB_PORT}, own PHP :${SITE_PORT} (+ fake gateway :${FAKE_PORT}), staged copy of dropin/ in a temp dir`)
if (!siteUp) process.exit(1)
const phpCli = (script, args = [], env = {}) => run('php', [...phpFlags, join(STAGE, 'api', script), ...args],
  { env: { ...phpEnv, ...env }, cwd: join(STAGE, 'api'), maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout, (e) => `${e.stdout ?? ''}${e.stderr ?? ''}`)

// ------------------------------------------------------------------ the browser
let chromium = null, browser = null
try {
  ({ chromium } = await import('playwright'))
  const exe = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  // Chromium puts a unix socket under TMPDIR; a deep one (>107 bytes) kills it.
  if (tmpdir().length > 40) process.env.TMPDIR = '/tmp'
  browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: asRoot ? ['--no-sandbox'] : [] })
} catch (e) {
  browser = null
  console.log(`NOTE no Chromium (${String(e.message).split('\n')[0]}): parser and dialog checks are SKIPPED, string checks still run.`)
}
process.on('exit', () => { try { browser?.close() } catch { /* gone */ } })
const page = browser ? await (await browser.newContext({ locale: 'en-US', javaScriptEnabled: true })).newPage() : null

// The analyser runs INSIDE the browser on an inert DOMParser document.
const analyseFn = (htmlText) => {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html')
  const count = {}
  for (const el of doc.querySelectorAll('*')) count[el.tagName.toLowerCase()] = (count[el.tagName.toLowerCase()] || 0) + 1
  const handlers = [], badUrls = []
  for (const el of doc.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) handlers.push(`${el.tagName.toLowerCase()}[${a.name}]=${a.value}`)
      if (/^(href|src|action|formaction|data|poster|srcset|xlink:href)$/i.test(a.name) && /^\s*(javascript|vbscript|data):/i.test(a.value) && !/^\s*data:image\//i.test(a.value)) {
        badUrls.push(`${el.tagName.toLowerCase()}[${a.name}]=${a.value.slice(0, 60)}`)
      }
    }
  }
  const scripts = [...doc.querySelectorAll('script')].map((s) => ({ type: s.type || 'js', id: s.id, text: s.textContent, src: s.getAttribute('src'), ssr: s.hasAttribute('data-sporta-ssr-product') }))
  const metas = {}
  for (const m of doc.querySelectorAll('meta')) { const k = m.getAttribute('name') || m.getAttribute('property'); if (k) metas[k] = m.getAttribute('content') }
  return {
    count, handlers, badUrls, scripts, metas, title: doc.querySelector('title')?.textContent ?? null,
    canonical: doc.querySelector('link[rel=canonical]')?.getAttribute('href') ?? null,
    alternates: [...doc.querySelectorAll('link[rel=alternate]')].map((l) => l.getAttribute('href')),
    lang: doc.documentElement.getAttribute('lang'), dir: doc.documentElement.getAttribute('dir'),
    bodyText: doc.body?.textContent ?? '', forms: [...doc.querySelectorAll('form')].map((f) => ({
      action: f.getAttribute('action'), inputs: [...f.querySelectorAll('input')].map((i) => [i.name, i.value]) })),
    anchors: [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
  }
}
const analyse = async (htmlText) => (page ? page.evaluate(analyseFn, htmlText) : null)
const parseXml = async (xml) => page?.evaluate((x) => {
  const d = new DOMParser().parseFromString(x, 'application/xml')
  return { error: d.querySelector('parsererror')?.textContent ?? null, urls: d.getElementsByTagName('url').length,
    locs: [...d.getElementsByTagName('loc')].map((l) => l.textContent) }
}, xml)

// What EXECUTING a page does: load it, listen for dialogs, console and every
// request that leaves for evil.example. Each call gets a FRESH browser context:
// the shared `page` is used for parsing only. (A page left on an image or error
// document by a navigation check makes setContent throw "execution context was
// destroyed", and a swallowed throw reads as "0 dialogs": a false pass. Section
// 9's canary caught exactly that.) A setContent error is a failure, never a pass.
async function execute(htmlText, label) {
  if (!browser) return null
  const seen = { dialogs: [], evil: [], errors: [] }
  const ctx = await browser.newContext({ locale: 'en-US' })
  const p = await ctx.newPage()
  p.on('dialog', async (d) => { seen.dialogs.push(d.message()); await d.dismiss().catch(() => {}) })
  p.on('request', (r) => { if (/evil\.example/.test(r.url())) seen.evil.push(r.url()) })
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
  await p.setContent(htmlText, { waitUntil: 'load' }).catch((e) => { seen.errors.push(String(e.message).split('\n')[0]) })
  await p.waitForTimeout(150)
  await ctx.close().catch(() => {})
  if (seen.errors.length) bad(`execute(${label}): the page could not be loaded for execution`, seen.errors[0])
  return { ...seen, label }
}

// ------------------------------------------------------------------ hostile text
// Every payload is a string a person could paste into a form. EVIL is the
// off-site fetch a successful injection would trigger.
const EVIL = 'https://evil.example/p.png'
const P = {
  tag: '"><script>alert(1)</script>',
  endscript: '</script><script>alert(1)</script>',
  img: '<img src=x onerror=alert(1)>',
  offsite: `<img src="${EVIL}"><link rel=stylesheet href="https://evil.example/s.css">`,
  js: 'javascript:alert(1)',
  data: 'data:text/html,<script>alert(1)</script>',
  attr: ' onfocus=alert(1) autofocus x="',
  apos: "' onmouseover='alert(1)",
  tpl: '{{7*7}}',
  lsep: 'a\u2028b\u2029c',
  rlo: '\u202eevil\u202c',
  svg: '<svg onload=alert(1)>',
  comment: '<!-- <script>alert(1)</script>',
  style: '</style><script>alert(1)</script>',
  title: '</title><script>alert(1)</script>',
  cdata: ']]><script>alert(1)</script>',
  amp: '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#60;b&#62;',
}
const COMBO = (n) => [P.tag, P.endscript, P.img, P.offsite, P.attr, P.apos, P.svg, P.comment, P.style, P.title, P.cdata].join(' ').slice(0, n)
const NUL = 'a\u0000b', CRLF = 'a\r\nBcc: victim@evil.example', BIG = '<'.repeat(100 * 1024)
const strip = (s) => s.replace(/[\x00-\x1F\x7F]/g, '').trim() // eslint-disable-line no-control-regex

// ------------------------------------------------------------------ http helpers
const get = async (path, headers = {}) => {
  const res = await fetch(SITE + path, { headers, redirect: 'manual' })
  return { status: res.status, headers: res.headers, text: await res.text() }
}
let cookie = ''
// The API throttles every route per client (that is itself a defence), so the
// table is emptied every few calls; section 2 does not test the throttle.
let calls = 0
const tick = async () => { if (++calls % 12 === 0) await sql('delete from rate_limit') }
const adm = async (route, { method = 'POST', body } = {}) => {
  await tick()
  const res = await fetch(`${SITE}/api/admin.php?r=${route}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0]
    if (/^(__Host-)?sporta_admin=/.test(pair)) cookie = /=(deleted)?$/.test(pair) ? '' : pair
  }
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, ct: res.headers.get('content-type') ?? '' }
}
const api = async (route, qs = '', opts = {}) => {
  await tick()
  const res = await fetch(`${SITE}/api/api.php?r=${route}${qs}`, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...(opts.headers ?? {}) } })
  const text = await res.text()
  let json = null, parsed = true
  try { json = JSON.parse(text) } catch { parsed = false }
  return { status: res.status, json, parsed, text, ct: res.headers.get('content-type') ?? '', headers: res.headers }
}
const clearLimits = () => sql('delete from rate_limit')

// ------------------------------------------------------------------ admin
const ADMIN = 'xss-admin@sporta.test', ADMIN_PW = 'xss-Correct-Horse-9'
const adminHash = (await run('php', ['-r', `echo password_hash(${phpStr(ADMIN_PW)}, PASSWORD_DEFAULT);`])).stdout
await sql(`insert into admin_users (email, password_hash) values (${q(ADMIN)}, ${q(adminHash)})`)
const login = await adm('login', { body: { email: ADMIN, password: ADMIN_PW } })
is(login.status === 200 && login.json?.email === ADMIN, 'the private admin signs in through the real route', `${login.status} ${login.json?.error ?? ''}`)

// ========================================================================== 1
head('1. same-origin only: hero buttons and the promo bar (store_internal_href)')
// Candidates a person could type into "Button goes to". The property under
// test is not "which are refused" but "nothing ACCEPTED can leave the origin",
// judged by the WHATWG URL parser (Chromium, Node and react-router agree on it).
const ORIGIN = 'https://www.sporta.com.kw'
const HREFS = [
  '//evil.example', '/\\evil.example', '/%2f/evil.example', '\\\\evil.example', '\\/evil.example', 'javascript:alert(1)',
  'JaVaScRiPt:alert(1)', 'jav\tascript:alert(1)', 'java\nscript:alert(1)', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example',
  ' //evil.example', '\t//evil.example', '//evil.example ', '\u00a0//evil.example', '\u200b//evil.example', '\ufeff//evil.example',
  '\uff4a\uff41\uff56\uff41\uff53\uff43\uff52\uff49\uff50\uff54:alert(1)', '\u217c\u217c//evil.example', '\uff0f\uff0fevil.example', '/\uff0fevil.example', '\uff0f\uff0fevil.example',
  'http://evil.example', 'https://evil.example', 'https:evil.example', 'http:/evil.example', 'data:text/html,<script>alert(1)</script>',
  'vbscript:x', 'blob:https://evil.example/x', 'file:///etc/passwd', 'mailto:a@evil.example', 'tel:123', '?x=//evil.example', '#//evil.example',
  '/.//evil.example', '/..//evil.example', '/./\\evil.example', '/%5Cevil.example', '/%09/evil.example', '/%0a/evil.example', '/%2F%2Fevil.example',
  '/shop?x=//evil.example', '/shop#//evil.example', '/shop\n', '/shop\n//evil.example', '/shop\r\nSet-Cookie: a=b', '/shop"><script>alert(1)</script>',
  '/shop<script>', "/shop'onmouseover='x", '/shop%00', '/sh op', '/', '/shop', '/product/x-y?lang=en', '/shop?brand=a%20b', '//', '///evil.example',
  '/@evil.example', '/shop@evil.example', ':evil', 'evil.example', 'www.sporta.com.kw', '/\u2028/evil.example', '/\u202e/evil.example',
]
const sameOrigin = (href) => { try { return new URL(href.trim(), ORIGIN).origin === ORIGIN && !/^\s*(javascript|data|vbscript):/i.test(href) } catch { return false } }
let acceptedBad = [], accepted = 0, refused = 0
for (const href of HREFS) {
  const r = await adm('settings_save', { body: { name: 'promo_bar', value: { enabled: false, text_en: 'x', text_ar: 'x', href, tone: 'brand', alignment: 'center', show_dot: true } } })
  if (r.status === 200 && r.json) {
    accepted++
    const stored = r.json.href ?? ''
    if (stored !== '' && !sameOrigin(stored)) acceptedBad.push(stored)
    if (/[\x00-\x1F\u2028\u2029\u202e]/.test(stored)) acceptedBad.push(`control char kept: ${JSON.stringify(stored)}`) // eslint-disable-line no-control-regex
  } else refused++
}
is(acceptedBad.length === 0, 'promo_bar.href: nothing accepted resolves off-origin under the WHATWG parser', `${HREFS.length} candidates, ${accepted} accepted, ${refused} refused${acceptedBad.length ? `; LEAKED ${JSON.stringify(acceptedBad)}` : ''}`)
let slideBad = [], slideAccepted = 0
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('x'.repeat(40))]).toString('base64')
for (const href of HREFS) {
  const r = await adm('slide_save', { body: { id: 0, title_en: 't', title_ar: 't', subtitle_en: '', subtitle_ar: '', cta_label_en: 'go', cta_label_ar: 'go', cta_href: href, active: false, image: PNG } })
  if (r.status === 200) {
    slideAccepted++
    const row = (await adm('slides', { method: 'GET' })).json?.slides?.find((s) => s.id === r.json.id)
    if (row?.cta_href && !sameOrigin(row.cta_href)) slideBad.push(row.cta_href)
  }
}
is(slideBad.length === 0, 'slide_save.cta_href: the same gate, same result', `${slideAccepted} accepted, leaked ${JSON.stringify(slideBad)}`)
const prodBad = []
for (const href of ['//evil.example/x.png', 'javascript:alert(1)', '/\\evil.example/x.png', '/images/products/a.png', 'https://evil.example/x.png']) {
  const r = await adm('product_save', { body: { id: 0, slug: `href-probe-${Math.random().toString(36).slice(2, 8)}`, name_en: 'Probe', name_ar: 'Probe', price: '1.000', image: href, images: `${href},/images/products/b.png`, active: false } })
  if (r.status === 200 && r.json?.image && !sameOrigin(r.json.image)) prodBad.push(r.json.image)
  if (r.status === 200 && r.json?.images && r.json.images.split(',').some((u) => !sameOrigin(u))) prodBad.push(r.json.images)
}
is(prodBad.length === 0, 'product_save.image / images: only same-origin paths survive', JSON.stringify(prodBad))
// Of what is accepted, does the character list leave anything a router could mistake for a host?
{
  const shapes = HREFS.filter(sameOrigin).filter((x) => /^\/[^/\\]/.test(x.trim()) || x.trim() === '/')
  info('accepted href shapes all begin with a single slash', `${shapes.length} of the ${HREFS.length} candidates are valid paths`)
}

// ========================================================================== 2
head('2. what the admin routes do with hostile text: reject, normalise, or store')
const matrix = []
const probe = async (label, route, build, readBack) => {
  for (const [pname, payload] of Object.entries({ ...P, nul: NUL, crlf: CRLF })) {
    const r = await adm(route, { body: build(payload) })
    let outcome = 'refused'
    let got = null
    if (r.status === 200 && r.json) {
      got = readBack ? await readBack(r.json, payload) : null
      outcome = got === null ? 'accepted' : got === payload ? 'stored verbatim' : 'normalised'
    }
    matrix.push({ label, pname, outcome, got, status: r.status, error: r.json?.error })
  }
  const by = matrix.filter((m) => m.label === label)
  const tally = ['refused', 'normalised', 'stored verbatim', 'accepted'].map((k) => `${by.filter((m) => m.outcome === k).length} ${k}`).join(', ')
  info(label, tally)
  return by
}
const BASE_PROMO = { enabled: false, text_en: 'x', text_ar: 'x', href: '/shop', tone: 'brand', alignment: 'center', show_dot: true }
await probe('promo_bar.text_en', 'settings_save', (v) => ({ name: 'promo_bar', value: { ...BASE_PROMO, text_en: v } }), (j) => j.text_en)
await probe('checkout.notice_en', 'settings_save', (v) => ({ name: 'checkout', value: { delivery_fee: 1, knet: true, tpay: true, cod: true, default_method: 'knet', notice_en: v, notice_ar: v } }), (j) => j.notice_en)
await probe('theme.brand (a colour)', 'settings_save', (v) => ({ name: 'theme', value: { brand: v, accent: v, canvas: v, radius: v, dark: false } }), (j) => j.brand)
await probe('seo page title_en', 'seo_save', (v) => ({ scope: 'page', path: '/shop', title_en: v, title_ar: '', description_en: v, description_ar: '', image: '' }), (j) => j.title_en)
await probe('seo page image', 'seo_save', (v) => ({ scope: 'page', path: '/shop', title_en: '', title_ar: '', description_en: '', description_ar: '', image: v }), (j) => j.image)
const slideRead = async (j) => (await adm('slides', { method: 'GET' })).json?.slides?.find((s) => s.id === j.id)
await probe('slide title_en', 'slide_save', (v) => ({ id: 0, title_en: v, title_ar: 'x', subtitle_en: v, subtitle_ar: '', cta_label_en: v, cta_label_ar: '', cta_href: '/shop', active: false, image: PNG }), async (j) => (await slideRead(j))?.title_en)
await probe('product name_en', 'product_save', (v) => ({ id: 0, slug: `probe-${Math.random().toString(36).slice(2, 9)}`, name_en: v, name_ar: v, price: '1.000', desc_en: v, desc_ar: v, category: v, active: false }), (j) => j.name_en)
await probe('product desc_en', 'product_save', (v) => ({ id: 0, slug: `probe-${Math.random().toString(36).slice(2, 9)}`, name_en: 'Probe', name_ar: 'Probe', price: '1.000', desc_en: v, active: false }), (j) => j.desc_en)
await probe('product slug', 'product_save', (v) => ({ id: 0, slug: v, name_en: 'Probe', name_ar: 'Probe', price: '1.000', active: false }), (j) => j.slug)
await probe('brand name_en', 'brand_save', (v) => ({ id: 0, name_en: v, name_ar: v, slug: `b-${Math.random().toString(36).slice(2, 8)}` }), (j) => j.name_en)
await probe('brand slug', 'brand_save', (v) => ({ id: 0, name_en: 'Probe brand', name_ar: 'x', slug: v }), (j) => j.slug)
await probe('discount label', 'discount_save', (v) => ({ id: 0, kind: 'code', code: `PRB${Math.random().toString(36).slice(2, 7)}`, label: v, type: 'percent', value: 5, active: false }), (j) => j.label)
await probe('discount code', 'discount_save', (v) => ({ id: 0, kind: 'code', code: v, label: 'probe', type: 'percent', value: 5, active: false }), (j) => j.code)
const mx = (label) => matrix.filter((m) => m.label === label)
const stored = (label) => mx(label).filter((m) => m.outcome === 'stored verbatim').map((m) => m.pname)
// Free-text copy is stored as typed and escaped on output; a colour, a path, a
// slug and a code are values the server owns and must be normalised or refused.
is(stored('theme.brand (a colour)').length === 0, 'theme colours: nothing but #rrggbb is stored', `normalised ${mx('theme.brand (a colour)').filter((m) => m.outcome === 'normalised').length}`)
is(stored('seo page image').length === 0, 'seo share image: a same-origin raster path or nothing', stored('seo page image').join(','))
is(stored('product slug').length === 0 && stored('brand slug').length === 0, 'product and brand slugs are rebuilt to [a-z0-9-]', `${mx('product slug').filter((m) => m.outcome === 'normalised').length}+${mx('brand slug').filter((m) => m.outcome === 'normalised').length} normalised`)
is(stored('discount code').length === 0, 'discount codes are rebuilt to A-Z0-9', '')
{
  const ctl = (l) => mx(l).filter((m) => /[\x00-\x1F]/.test(m.got ?? '')).map((m) => m.pname) // eslint-disable-line no-control-regex
  const STRIPPED = ['promo_bar.text_en', 'seo page title_en', 'product name_en', 'brand name_en', 'discount label']
  const KEPT = ['checkout.notice_en', 'slide title_en', 'product desc_en']
  is(STRIPPED.every((l) => ctl(l).length === 0),
    'control characters (NUL, CR, LF) never reach a stored promo text, SEO title, product name, brand name or discount label (store_text / store_topbar_setting / the SEO cleaner strip them)',
    STRIPPED.filter((l) => ctl(l).length).map((l) => `${l} kept ${JSON.stringify(ctl(l))}`).join('; '))
  weak(KEPT.every((l) => ctl(l).length === 0),
    'the checkout notice, slide titles and product descriptions strip control characters too (their cleaners are mb_substr(trim()) / store_opt, not store_text)',
    `kept: ${KEPT.map((l) => `${l} ${JSON.stringify(ctl(l))}`).join(', ')}; JSON (\\u0000, \\r\\n), mail (base64 subject, escaped HTML) and React (text child) all neutralise them, so cosmetic`)
}
{
  const verbatim = (l) => `${stored(l).length}/${Object.keys(P).length + 2} verbatim`
  info('free text stored as typed (defence = output escaping + read-side checks)',
    `promo ${verbatim('promo_bar.text_en')}, notice ${verbatim('checkout.notice_en')}, seo title ${verbatim('seo page title_en')}, slide ${verbatim('slide title_en')}, product ${verbatim('product name_en')}, brand ${verbatim('brand name_en')}, discount label ${verbatim('discount label')}`)
  weak(stored('promo_bar.text_en').length === 0 && stored('seo page title_en').length === 0,
    'markup is not refused or stripped at SAVE time on any free-text field (admin copy is stored with its < > " as typed)',
    `${stored('promo_bar.text_en').length} payloads kept in the promo bar, ${stored('seo page title_en').length} in SEO titles; safe only because every output path escapes`)
}
// Size: a 100 KB paste.
{
  const big = await adm('settings_save', { body: { name: 'promo_bar', value: { ...BASE_PROMO, text_en: BIG } } })
  const bigSeo = await adm('seo_save', { body: { scope: 'page', path: '/shop', title_en: BIG, title_ar: '', description_en: '', description_ar: '', image: '' } })
  const bigDesc = await adm('product_save', { body: { id: 0, slug: 'big-probe', name_en: 'Big', name_ar: 'Big', price: '1.000', desc_en: BIG, active: false } })
  is(big.status !== 200 && bigSeo.status !== 200, 'a 100 KB string is refused by the promo bar and SEO routes', `${big.json?.error} / ${bigSeo.json?.error}`)
  is(bigDesc.status !== 200 || (bigDesc.json?.desc_en ?? '').length <= 280, 'and cut to 280 characters (or refused) in a product description', `${bigDesc.status} ${(bigDesc.json?.desc_en ?? '').length}`)
}
// Images in data: URIs: only png/jpeg/webp with the right magic bytes.
{
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>').toString('base64')
  const html = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40)).toString('base64')
  const polyglot = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('<svg onload=alert(1)>'.padEnd(40))]).toString('base64')
  const tries = {
    'svg labelled svg+xml': `data:image/svg+xml;base64,${svg}`, 'svg labelled png': `data:image/png;base64,${svg}`,
    'html labelled jpeg': `data:image/jpeg;base64,${html}`, 'html labelled webp': `data:image/webp;base64,${html}`,
    'text/html data URI': `data:text/html;base64,${html}`, 'png label, no base64': 'data:image/png,<svg onload=alert(1)>',
  }
  const out = {}
  for (const [k, v] of Object.entries(tries)) {
    out[k] = (await adm('brand_save', { body: { id: 0, name_en: 'Logo probe', name_ar: 'x', slug: `logo-${Math.random().toString(36).slice(2, 8)}`, logo: v } })).status
  }
  is(Object.values(out).every((s) => s !== 200), 'brand logo: SVG, HTML and non-image bytes are all refused (magic number, not label)', JSON.stringify(out))
  const poly = await adm('brand_save', { body: { id: 0, name_en: 'Polyglot', name_ar: 'x', slug: 'polyglot', logo: polyglot } })
  info('a PNG header followed by <svg onload> is accepted (magic number only)', `${poly.status}; it is served as image/png + nosniff, see section 7`)
}

// ========================================================================== 3
head('3. product upload name and path (the one image route)')
{
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'), Buffer.alloc(40)])
  const asPng = `data:image/png;base64,${png.toString('base64')}`
  const names = ['../../x"><script>alert(1)</script>.png', 'a\u0000b.php.png', '<svg onload=alert(1)>', 'x.php', '..%2f..%2fx', '\uff41\uff42\uff43.png']
  const paths = []
  for (const name of names) {
    const r = await adm('product_image_upload', { body: { data: asPng, name } })
    if (r.status === 200) paths.push(r.json.path)
  }
  is(paths.every((p) => /^\/images\/products\/[a-z0-9-]+-[0-9a-f]{10}\.(png|jpg|webp)$/.test(p)), 'the stored file name is rebuilt from [a-z0-9-] + 10 random hex + a fixed extension', paths.join(' '))
  const svgUp = await adm('product_image_upload', { body: { data: `data:image/svg+xml;base64,${Buffer.from('<svg onload=alert(1)/>').toString('base64')}`, name: 'x.svg' } })
  const htmlUp = await adm('product_image_upload', { body: { data: `data:image/png;base64,${Buffer.from('<script>alert(1)</script>'.padEnd(60)).toString('base64')}`, name: 'x.png' } })
  is(svgUp.status !== 200 && htmlUp.status !== 200, 'an SVG, and HTML labelled PNG, are refused by the upload route', `${svgUp.json?.error} / ${htmlUp.json?.error}`)
  const guard = existsSync(join(STAGE, 'images/products/.htaccess')) ? readFileSync(join(STAGE, 'images/products/.htaccess'), 'utf8') : ''
  is(/FilesMatch[^>]*php/.test(guard) && /Require all denied/.test(guard), 'the folder it writes carries a .htaccess that denies PHP')
}

// ========================================================================== 4
head('4. a poisoned database: every value written straight into the rows')
// What this models: a hostile or compromised admin, phpMyAdmin, a leaked
// database login. The admin routes' validation is bypassed on purpose.
const slugs = (await sql('select slug from products where active = 1 order by id limit 3')).split('\n')
const SLUG = slugs[0], SLUG2 = slugs[1]
const pid = Number(await sql(`select id from products where slug = ${q(SLUG)}`))
const pid2 = Number(await sql(`select id from products where slug = ${q(SLUG2)}`))
// Clean baselines first: what each page looks like before it is poisoned.
await sql(`delete from settings where name in ('seo_pages') or name like 'seo_p\\_%'`)
await sql('delete from hero_slides; delete from brands')
await sql(`delete from settings where name in ('promo_bar','checkout','theme','hero')`)
const PAGES = ['/', '/shop', '/about', '/contact', '/support', '/track', '/returns', '/terms', '/privacy', `/product/${SLUG}`, `/product/${SLUG2}`,
  '/cart', '/account', '/checkout', '/backends', '/payment/result', '/nope']
const withLang = (p) => [p, p + (p.includes('?') ? '&' : '?') + 'lang=en']
const URLS = PAGES.flatMap(withLang)
const baseline = {}
for (const u of URLS) {
  const r = await get(u)
  baseline[u] = { status: r.status, len: r.text.length, a: await analyse(r.text) }
}
is(URLS.every((u) => [200, 404].includes(baseline[u].status)), `${URLS.length} server-rendered URLs answer on the clean database`, URLS.map((u) => baseline[u].status).filter((s) => s !== 200).length + ' are 404 (the unknown path)')

// The invariant for a rendered page: the poisoned page has the same executable
// scripts, the same element inventory (an injected <img>/<svg>/<style>/<iframe>
// changes a count), no on* attributes beyond the clean page's, no javascript:
// or data: URLs, and the only non-executable scripts are JSON the renderer owns.
const EXEC = (s) => /^(js|module|text\/javascript|application\/javascript)$/i.test(s.type)
function samePage(a, b) {
  const problems = []
  const exec = (x) => x.scripts.filter(EXEC).map((s) => s.src ?? s.text).sort().join('\u0001')
  if (exec(a) !== exec(b)) problems.push('executable scripts differ')
  for (const tag of new Set([...Object.keys(a.count), ...Object.keys(b.count)])) {
    if (['meta', 'link', 'title', 'script'].includes(tag)) continue
    if ((a.count[tag] ?? 0) !== (b.count[tag] ?? 0)) problems.push(`<${tag}> ${a.count[tag] ?? 0}→${b.count[tag] ?? 0}`)
  }
  const extra = b.handlers.filter((x) => !a.handlers.includes(x))
  if (extra.length) problems.push(`new handlers ${extra.join('|').slice(0, 80)}`)
  if (b.badUrls.length) problems.push(`js/data urls ${b.badUrls.join('|')}`)
  if ((b.count.title ?? 0) > 1) problems.push('more than one <title>')
  return problems
}

// 4a. one payload at a time through the SEO fields (the main HTML sink).
let seoProblems = [], seoRoundTrip = 0, seoRoundTripBad = []
const SEO_PAYLOADS = { ...P, combo: COMBO(115), lsep_rlo: P.lsep + P.rlo }
for (const [name, payload] of Object.entries(SEO_PAYLOADS)) {
  const rec = { title_en: payload, title_ar: payload, description_en: payload, description_ar: payload, image: '' }
  await sql(`insert into settings (name, value) values ('seo_pages', ${q(JSON.stringify({ pages: { '/': rec, '/shop': rec, '/about': rec } }))}),
    ('seo_p_${pid}', ${q(JSON.stringify(rec))}) on duplicate key update value = values(value)`)
  for (const u of ['/', '/?lang=en', '/shop', '/shop?lang=en', `/product/${SLUG}`, `/product/${SLUG}?lang=en`]) {
    const r = await get(u)
    const a = await analyse(r.text)
    if (!a) continue
    for (const p of samePage(baseline[u].a, a)) seoProblems.push(`${name} ${u}: ${p}`)
    const want = strip(payload).slice(0, 120)
    if (want) {
      seoRoundTrip++
      if (a.title !== want) seoRoundTripBad.push(`${name} ${u}`)
    }
  }
}
if (browser) {
  is(seoProblems.length === 0, `SEO overrides: ${Object.keys(SEO_PAYLOADS).length} payloads x 6 pages parsed, no new script/element/handler/URL`, seoProblems.slice(0, 3).join('; '))
  is(seoRoundTripBad.length === 0, '<title> round-trips each payload as TEXT (escaped, not stripped, not interpreted)', `${seoRoundTrip} compared${seoRoundTripBad.length ? `; differ: ${seoRoundTripBad.slice(0, 3)}` : ''}`)
} else info('SEO parser checks skipped (no Chromium)')

// 4b. everything at once: names, descriptions, images, slides, brands, notice,
// theme, hero settings, topbar. Nothing may reach the page unescaped.
const rec = { title_en: COMBO(115), title_ar: COMBO(115), description_en: COMBO(300), description_ar: COMBO(300), image: '/x.png"><script>alert(1)</script>' }
await sql(`update settings set value = ${q(JSON.stringify({ pages: Object.fromEntries(['/', '/shop', '/about', '/contact', '/support', '/track', '/returns', '/terms', '/privacy'].map((k) => [k, rec])) }))} where name = 'seo_pages'`)
await sql(`insert into settings (name, value) values ('seo_p_${pid}', ${q(JSON.stringify(rec))}), ('seo_p_${pid2}', ${q(JSON.stringify(rec))}) on duplicate key update value = values(value)`)
await sql(`update products set name_en = ${h(COMBO(150))}, name_ar = ${h(COMBO(150) + '\u202e')}, desc_en = ${h(COMBO(300) + '\u2028' + BIG.slice(0, 20000))}, desc_ar = ${h(COMBO(300))},
  image = ${h(P.js)}, images = ${h(`${P.data},${P.tag}`)}, category = ${h(P.tag)}, brand_slug = ${h(P.tag)} where id = ${pid}`)
await sql(`update products set name_en = ${h(P.title)}, name_ar = ${h(P.endscript)}, desc_en = ${h(P.comment)}, desc_ar = ${h(P.style)}, image = ${h('data:text/html,<script>alert(1)</script>')} where id = ${pid2}`)
await sql(`update product_variants set size = ${h(P.tag)} where slug = ${q(SLUG2)} limit 1`)
const imgData = (svgBody) => 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(svgBody.padEnd(40))]).toString('base64')
await sql(`insert into hero_slides (sort, active, title_en, title_ar, subtitle_en, subtitle_ar, cta_label_en, cta_label_ar, cta_href, image, image_hash, image_w, image_h)
  values (1, 1, ${h(P.tag)}, ${h(P.endscript)}, ${h(P.img)}, ${h(P.attr)}, ${h(P.svg)}, ${h(P.comment)}, ${h(P.js)}, ${q(imgData('<svg onload=alert(1)>'))}, ${q('a'.repeat(64))}, 10, 10),
  (2, 1, 'second', 'second', '', '', 'go', 'go', ${h('//evil.example')}, ${q(imgData('<script>alert(1)</script>'))}, ${q('b'.repeat(64))}, 10, 10)`)
await sql(`insert into brands (slug, name_en, name_ar, logo, active, sort) values
  (${h('a"><script>')}, ${h(P.tag)}, ${h(P.img)}, ${q('data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64'))}, 1, 1),
  ('poly', ${h(P.svg)}, ${h(P.offsite)}, ${q(imgData('<svg onload=alert(1)>'))}, 1, 2)`)
const setting = (name, v) => sql(`insert into settings (name, value) values (${q(name)}, ${q(JSON.stringify(v))}) on duplicate key update value = values(value)`)
await setting('promo_bar', { enabled: true, text_en: P.tag, text_ar: P.img, href: P.js, starts_at: null, ends_at: null, tone: P.tag, show_dot: true, alignment: P.attr })
await setting('checkout', { delivery_fee_fils: 1000, knet: true, tpay: true, cod: true, default_method: P.tag, notice_en: COMBO(500), notice_ar: P.title })
await setting('theme', { brand: 'red;}</style><script>alert(1)</script>', accent: 'url(//evil.example/x)', canvas: P.tag, radius: '16px;}body{display:none', dark: P.tag, fonts: { body_en: P.tag, display_en: 'custom:../../etc/passwd', body_ar: 'plex', display_ar: 'alexandria' } })
await setting('hero', { speed_ms: P.tag, shuffle: P.img, size: P.attr, autoplay: [P.tag] })
await sql(`insert into discounts (kind, code, label, type, value, active, category) values ('auto', null, ${h(P.tag)}, 'percent', 5, 1, ${h(P.img)}), ('code', 'XSSPROBE', ${h(P.endscript)}, 'percent', 5, 1, ${h(P.svg)})`)
let pageProblems = []
const after = {}
for (const u of URLS) {
  const r = await get(u)
  after[u] = { status: r.status, len: r.text.length, text: r.text }
  const a = await analyse(r.text)
  if (a) for (const p of samePage(baseline[u].a, a)) pageProblems.push(`${u}: ${p}`)
}
if (browser) is(pageProblems.length === 0, `all ${URLS.length} server-rendered URLs hold with every column poisoned at once`, pageProblems.slice(0, 4).join('; '))
const growth = Math.max(...URLS.map((u) => after[u].len - baseline[u].len))
const longestRun = Math.max(...URLS.map((u) => Math.max(0, ...((after[u].text.match(/(?:\\u003C|<){40,}/gi) ?? []).map((x) => x.length)))))
// The bound is the SEO caps themselves (120/320 characters x 2 languages x 11
// records), inflated by the \u003C escape at 6x: tens of KB, never the 100 KB paste.
is(growth < 70000 && longestRun === 0, 'a 20 KB description or a 100 KB paste in a row cannot inflate a page: output is capped at the SEO field limits', `largest growth ${growth} bytes (escaping of the capped overrides), longest run of '<' in any page ${longestRun}`)

// Executed, not just parsed: load the poisoned product and home pages in Chromium.
if (browser) {
  const execs = []
  for (const u of ['/', '/?lang=en', '/shop', `/product/${SLUG}`, `/product/${SLUG2}?lang=en`]) execs.push(await execute(after[u].text, u))
  is(execs.every((e) => e.dialogs.length === 0 && e.evil.length === 0), 'loaded and executed in Chromium: no dialog, no request to evil.example', `${execs.length} pages; dialogs ${execs.reduce((n, e) => n + e.dialogs.length, 0)}, evil requests ${execs.reduce((n, e) => n + e.evil.length, 0)}`)
}

// JSON-LD and the embedded seo data: parse, do not break out of the script.
{
  const a = await analyse(after[`/product/${SLUG}`].text)
  if (a) {
    const ld = a.scripts.find((s) => s.type === 'application/ld+json' && s.ssr)
    const allLd = a.scripts.filter((s) => s.type === 'application/ld+json')
    const seo = a.scripts.find((s) => s.id === 'sporta-seo-data')
    let ldObj = null, seoObj = null
    try { ldObj = JSON.parse(ld.text) } catch { /* reported below */ }
    try { seoObj = JSON.parse(seo.text) } catch { /* reported below */ }
    is(!!ldObj && ldObj['@type'] === 'Product', 'Product JSON-LD with a hostile name and description still parses as JSON', ldObj ? `name ${JSON.stringify(ldObj.name ?? null).slice(0, 50)}` : 'unparseable')
    is(!!seoObj, 'the embedded sporta-seo-data block parses as JSON', seoObj ? Object.keys(seoObj).join(',') : 'unparseable')
    is(allLd.every((x) => { try { JSON.parse(x.text); return true } catch { return false } }), `every JSON-LD block on the poisoned product page parses (${allLd.length})`)
    is(!/<\/script/i.test(ld.text) && !/<!--/.test(ld.text) && !/<\/script/i.test(seo.text) && !/<!--/.test(seo.text), 'neither block contains a literal </script or <!-- (JSON_HEX_TAG)')
    is(!/[\u2028\u2029]/.test(seo.text) && !/[\u2028\u2029]/.test(ld.text), 'and neither contains a raw U+2028/2029 (a line terminator that breaks older JS parsers)')
    is(ldObj?.image === undefined || ldObj.image.startsWith(`${ORIGIN}/`), 'a product image of javascript: or data: never becomes the structured-data image', String(ldObj?.image ?? 'omitted'))
    is(!a.metas['og:image'] || a.metas['og:image'].startsWith(`${ORIGIN}/`), 'og:image is the site origin even when the SEO image field is hostile', a.metas['og:image'])
  }
}
// Route reflection: the path is the one request-controlled string rendered.
{
  const reflect = ['/backends/"><script>alert(1)</script>', '/backends/%22%3E%3Cscript%3Ealert(1)%3C/script%3E', '/product/%22%3E%3Cscript%3E', "/product/a'onmouseover='x", '/x"><img src=x onerror=alert(1)>', '/shop/<svg/onload=alert(1)>']
  const bad = []
  for (const u of reflect) {
    const r = await get(u)
    const a = await analyse(r.text)
    if (a && (a.handlers.some((x) => !baseline['/'].a.handlers.includes(x)) || a.count.img !== baseline['/'].a.count.img || a.count.svg !== baseline['/'].a.count.svg)) bad.push(u)
    if (!a && /<script>alert\(1\)/.test(r.text)) bad.push(u)
  }
  is(bad.length === 0, 'a hostile REQUEST PATH (the only request string the shell renders) never becomes markup', `${reflect.length} paths; 404/noindex pages escape og:url`)
  const track = await get('/track?trackid=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&lang=%22%3E%3Cscript%3E')
  const ta = await analyse(track.text)
  if (ta) is(ta.lang === 'ar' && ta.dir === 'rtl' && ta.handlers.every((x) => baseline['/'].a.handlers.includes(x)), '?lang= and ?trackid= are never echoed: lang is one of two constants, trackid only switches noindex', `${ta.lang}/${ta.dir}`)
}

// 4c. JSON routes.
const inert = (name, r) => {
  const problems = []
  if (!/^application\/json/.test(r.ct)) problems.push(`Content-Type ${r.ct || 'none'}`)
  if (/[<>&']/.test(r.text)) problems.push('raw < > & or \' in the body')
  if (/[\u2028\u2029]/.test(r.text)) problems.push('raw U+2028/2029')
  if (!r.parsed) problems.push('not JSON')
  return problems.length ? `${name}: ${problems.join(', ')}` : null
}
await clearLimits()
const ROUTES = ['products', 'slides', 'theme', 'checkout_config', 'brands', 'stock', 'status&id=x']
const jsonBad = []
const jsonBodies = {}
for (const r of ROUTES) {
  const res = await api(r.split('&')[0], r.includes('&') ? '&' + r.split('&').slice(1).join('&') : '')
  jsonBodies[r] = res
  const p = inert(r, res)
  if (p) jsonBad.push(p)
}
is(jsonBad.length === 0, `public JSON routes (${ROUTES.length}): Content-Type JSON, no raw < > & ' and no raw U+2028/2029 with hostile rows`, jsonBad.join('; '))
is(jsonBodies.products.json?.some?.((p) => p.name_en?.includes('<script>') || true) && /\\u003Cscript/i.test(jsonBodies.products.text), 'the hostile product name is there, as \\u003Cscript (hex-escaped, not stripped)')
{
  const sl = jsonBodies.slides.json
  const rows = sl?.slides ?? []
  const hrefs = rows.map((s) => s.cta_href)
  info('r=slides returns cta_href as stored', JSON.stringify(hrefs))
  weak(hrefs.every((x) => x == null || sameOrigin(x)),
    'r=slides re-validates cta_href on READ (the promo bar does: store_topbar_setting)',
    `a hand-edited row serves ${JSON.stringify(hrefs.filter((x) => x && !sameOrigin(x)))} straight to HeroSlider's <Link to=…>; only the save route stands between a poisoned row and the home page`)
  const bar = sl?.promo_bar
  is(bar && (bar.href === '' || sameOrigin(bar.href)) && ['brand', 'ink', 'silver'].includes(bar.tone) && ['center', 'start'].includes(bar.alignment),
    'r=slides promo bar: href, tone and alignment ARE re-validated on read (javascript: becomes empty, enum values fall back)', JSON.stringify({ href: bar?.href, tone: bar?.tone, alignment: bar?.alignment }))
  const hero = sl?.hero
  weak(hero && typeof hero.speed_ms === 'number' && ['short', 'tall', 'full'].includes(hero.size) && typeof hero.shuffle === 'boolean' && typeof hero.autoplay === 'boolean',
    'r=slides hero settings are re-typed on read (speed_ms number, size enum, booleans)', `served as ${JSON.stringify(hero).slice(0, 110)}`)
  const th = jsonBodies.theme.json
  weak(th && /^#[0-9a-f]{6}$/i.test(th.brand) && /^#[0-9a-f]{6}$/i.test(th.accent) && /^#[0-9a-f]{6}$/i.test(th.canvas) && ['10', '16', '24'].includes(String(th.radius)),
    'r=theme re-validates colours and radius on read (save does: ^#[0-9a-f]{6}$)', `served brand=${JSON.stringify(th?.brand)?.slice(0, 40)} accent=${JSON.stringify(th?.accent)} radius=${JSON.stringify(th?.radius)}; the live bundle turns these into CSS variables`)
  is(th && Object.values(th.fonts ?? {}).every((f) => ['plex', 'alexandria'].includes(f) || /^custom:[a-f0-9]{20}$/.test(f)) && Object.keys(th.font_assets ?? {}).length === 0,
    'theme fonts fall back to the built-in pair when the row names anything else (path traversal in custom:…)', JSON.stringify(th?.fonts))
  const prod = (jsonBodies.products.json ?? []).find((x) => x.slug === SLUG)
  weak(prod && (prod.image == null || sameOrigin(prod.image)) && String(prod.images ?? '').split(',').filter(Boolean).every(sameOrigin),
    'r=products re-validates image and images on read (product_save does: store_internal_href)',
    `a hand-edited row serves image=${JSON.stringify(prod?.image)} images=${JSON.stringify(String(prod?.images ?? '').slice(0, 60))}; the shop renders them as <img src> (inert), so low`)
  const co = jsonBodies.checkout_config.json
  is(co && co.notice_en.length <= 240 && co.notice_ar.length <= 240 && ['knet', 'tpay', 'cod'].includes(co.default_method), 'checkout_config clamps notice length to 240 and default_method to a known method', `${co?.notice_en?.length}/${co?.default_method}`)
}
// The two image routes: bytes only, a fixed image/* type, nosniff.
{
  const slideId = Number(await sql('select id from hero_slides order by sort limit 1'))
  const logo = await fetch(`${SITE}/api/api.php?r=brand_logo&slug=poly`)
  const slide = await fetch(`${SITE}/api/api.php?r=slide_image&id=${slideId}`)
  const svgBrand = await fetch(`${SITE}/api/api.php?r=brand_logo&slug=${encodeURIComponent('a"><script>')}`)
  is(/^image\/png$/.test(logo.headers.get('content-type')) && logo.headers.get('x-content-type-options') === 'nosniff', 'brand_logo with <svg onload> after a PNG header: Content-Type image/png + nosniff', logo.headers.get('content-type'))
  is(/^image\/png$/.test(slide.headers.get('content-type')) && slide.headers.get('x-content-type-options') === 'nosniff', 'slide_image likewise', slide.headers.get('content-type'))
  is(svgBrand.status === 404, 'a row holding data:image/svg+xml is NOT served (the route only decodes png/jpeg/webp)', String(svgBrand.status))
  if (browser) {
    const seen = { dialogs: [], failed: [] }
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    p.on('dialog', async (d) => { seen.dialogs.push(d.message()); await d.dismiss().catch(() => {}) })
    for (const u of [`/api/api.php?r=brand_logo&slug=poly`, `/api/api.php?r=slide_image&id=${slideId}`]) {
      const res = await p.goto(SITE + u).catch(() => null)
      if (!res || res.status() !== 200) seen.failed.push(`${u.slice(0, 40)} ${res?.status() ?? 'error'}`)
    }
    await ctx.close().catch(() => {})
    is(seen.dialogs.length === 0 && seen.failed.length === 0, 'navigating straight to the polyglot logo and slide executes nothing (both answered 200)', `${seen.dialogs.length} dialogs${seen.failed.length ? `; ${seen.failed.join(', ')}` : ''}`)
  }
}

// 4d. sitemap XML.
{
  await sql(`update products set slug = ${h('xss"</loc><loc>https://evil.example/&<x>]]>')} where id = ${pid2}`)
  const sm = await get('/sitemap-products.xml')
  const idx = await get('/sitemap.xml')
  const total = Number(await sql('select count(*) from products where active = 1'))
  info('sitemap-products.xml', `${sm.status} ${sm.headers.get('content-type')} ${sm.text.length} bytes`)
  is(/^application\/xml/.test(sm.headers.get('content-type') ?? '') && /^application\/xml/.test(idx.headers.get('content-type') ?? ''), 'both sitemaps are served as application/xml')
  const x = await parseXml(sm.text)
  if (x) {
    is(x.error === null, 'sitemap-products.xml with a hostile slug is well-formed XML', (x.error ?? '').slice(0, 80))
    is(x.urls === total * 2 && x.locs.every((l) => l.startsWith(`${ORIGIN}/product/`)), 'one <url> per product per language and every <loc> still on the site origin: the slug cannot add elements', `${x.urls} urls for ${total} products; ${x.locs.filter((l) => !l.startsWith(ORIGIN)).length} off-origin`)
    const ix = await parseXml(idx.text)
    is(ix.error === null, 'sitemap.xml (the index) is well-formed', '')
  }
  await sql(`update products set slug = ${q(SLUG2)} where id = ${pid2}`)
}

// ========================================================================== 5
head('5. customer text into the invoice and the warehouse e-mail')
const item = JSON.parse(await sql(`select json_object('slug', slug, 'size', size) from product_variants where stock > 0 and slug = ${q(SLUG)} limit 1`) || '{}')
const itemOk = item.slug ? item : JSON.parse(await sql('select json_object(\'slug\', slug, \'size\', size) from product_variants limit 1'))
await clearLimits()
const HOSTILE_CUSTOMER = {
  name: '"><script>alert(1)</script>', phone: '99887766', governorate: 'hawalli', area: '<img src=x onerror=alert(1)>',
  block: '<b>x</b>"\'&', street: '</script><svg/onload=1>', building: ' onfocus=alert(1) ', floor: '\u202eX\u202c', flat: 'a\u2028b',
  note: `${P.offsite} ${P.comment} ${P.style} ${P.cdata}\u2028${P.rlo}`.slice(0, 280),
}
const ordersMade = []
for (const [k, method] of [['A', 'cod'], ['B', 'knet'], ['C', 'tpay']]) {
  const track = `XSS${k}${Date.now().toString(36).toUpperCase()}`.slice(0, 20)
  const r = await api('order', '', { method: 'POST', body: JSON.stringify({ track_id: track, items: [{ ...itemOk, qty: 1, fit: 'normal' }], customer: HOSTILE_CUSTOMER, payment_method: method }) })
  ordersMade.push({ track, method, status: r.status, error: r.json?.error })
  await sql(`update orders set payment_status = 'pending' where track_id = ${q(track)}`)
}
is(ordersMade.every((o) => o.status === 200 || o.status === 201), 'orders with HTML, bidi and U+2028 in every address field are accepted (checkout strips only control characters)', JSON.stringify(ordersMade.map((o) => `${o.method}:${o.status}${o.error ?? ''}`)))
const T = ordersMade[0].track
{
  const inv = await api('invoice', `&id=${T}`)
  const p = inert('invoice', inv)
  is(!p, 'r=invoice: JSON, hex-escaped, hostile name and address round-trip as data', p ?? `name ${JSON.stringify(inv.json?.customer_name).slice(0, 40)}`)
  const st = await api('status', `&id=${T}`)
  is(!inert('status', st), 'r=status likewise')
}
{
  const cust = { 'X-Sporta-Customer': '1', 'Sec-Fetch-Site': 'same-origin' }
  const email = 'hostile@sporta.test'
  const refusedTags = []
  for (const [field, body] of [['name', { name: P.tag, subject: 'Order question', message: 'Where is my order, please?', email }], ['subject', { name: 'Hostile Customer', subject: P.endscript + ' ' + P.img, message: 'Where is my order, please?', email }], ['message', { name: 'Hostile Customer', subject: 'Order question', message: COMBO(1500), email }]]) {
    const r = await api('support_create', '', { method: 'POST', headers: cust, body: JSON.stringify(body) })
    if (r.status === 400 && r.json?.error === 'invalid_ticket') refusedTags.push(field)
  }
  is(refusedTags.length === 3, 'support_create REFUSES < and > in name, subject and message (support_text: validation, not escaping)', `refused in ${refusedTags.join(',') || 'none'}`)
  const t = await api('support_create', '', { method: 'POST', headers: cust, body: JSON.stringify({ name: P.apos.slice(0, 40), subject: `${P.attr} ${P.js} ${P.tpl}`, message: `${P.lsep} ${P.rlo} ${P.apos} ${P.amp} ${P.js} ${P.tpl}`, email }) })
  const ref = t.json?.ticket?.reference ?? t.json?.ticket?.ref
  const look = ref ? await api('support_lookup', '', { method: 'POST', headers: cust, body: JSON.stringify({ reference: ref, email }) }) : null
  is(t.status === 201 && !inert('support_create', t) && look && !inert('support_lookup', look) && JSON.stringify(look?.json ?? {}).includes('onfocus=alert(1)'), 'a ticket with quotes, on*=, javascript:, {{7*7}}, bidi and U+2028 (no < >) is stored and comes back as inert JSON', `${t.status} ${ref ?? t.json?.error ?? ''}`)
  const ai = await api('assistant', '', { method: 'POST', body: JSON.stringify({ message: `${P.img} how much is the jacket? ${P.tag}`, lang: 'en' }) })
  is(!inert('assistant', ai), 'the assistant answers a hostile question and a hostile catalogue with inert JSON (its answer is data to the client)', `${ai.status} ${(ai.json?.answer ?? ai.json?.text ?? '').toString().slice(0, 50)}`)
}
// Run the real outbox job and read the mail it wrote.
const mails = () => readdirSync(MAIL).filter((f) => f.endsWith('.eml')).sort().map((f) => readFileSync(join(MAIL, f), 'utf8'))
const parseMail = (raw) => {
  const [headBlock, ...rest] = raw.split(/\r?\n\r?\n/)
  const body = rest.join('\n\n')
  const headers = []
  for (const line of headBlock.split(/\r?\n/)) {
    if (/^\s/.test(line) && headers.length) headers[headers.length - 1][1] += ' ' + line.trim()
    else { const i = line.indexOf(':'); if (i > 0) headers.push([line.slice(0, i), line.slice(i + 1).trim()]) }
  }
  const boundary = (headBlock.match(/boundary="?([A-Za-z0-9]+)"?/) ?? [])[1]
  const parts = boundary ? body.split(`--${boundary}`).slice(1, -1).map((p) => p.replace(/^\r?\n/, '')) : []
  const part = (type) => (parts.find((p) => new RegExp(`^Content-Type: ${type}`, 'i').test(p)) ?? '').split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n$/, '')
  const subj = headers.find(([k]) => /^subject$/i.test(k))?.[1] ?? ''
  const enc = subj.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/)
  return { headers, text: part('text/plain'), html: part('text/html'), subject: enc ? Buffer.from(enc[1], 'base64').toString('utf8') : subj, rawSubject: subj }
}
{
  const before = mails().length
  const out = await phpCli('cron-fulfilment.php', ['--run'])
  await new Promise((r) => setTimeout(r, 300))
  const fresh = mails().slice(before).map(parseMail)
  info('cron-fulfilment --run', out.replace(/\s+/g, ' ').slice(0, 120))
  is(fresh.length >= 1, `the outbox job wrote ${fresh.length} warehouse e-mail(s) for the hostile orders`)
  const allowed = new Set(['from', 'reply-to', 'mime-version', 'content-type', 'to', 'subject', 'date', 'message-id', 'x-mailer', 'return-path'])
  const headerBad = fresh.flatMap((m) => m.headers.filter(([k]) => !allowed.has(k.toLowerCase())).map(([k]) => k))
  is(headerBad.length === 0, 'mail headers: only From, Reply-To, MIME-Version, Content-Type, To, Subject (no injected Bcc/Cc)', headerBad.join(','))
  is(fresh.every((m) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(m.rawSubject)), 'every subject is one RFC 2047 base64 word (customer text cannot add a header line)')
  if (browser && fresh.length) {
    const bad = []
    for (const m of fresh) {
      const a = await analyse(m.html)
      if (!a) continue
      if (a.scripts.length || a.handlers.length || a.badUrls.length || a.count.img || a.count.svg || a.count.link || a.count.style || a.count.iframe) bad.push(`${m.subject.slice(0, 40)}: ${JSON.stringify({ s: a.scripts.length, h: a.handlers, i: a.count.img, l: a.count.link })}`)
    }
    is(bad.length === 0, 'warehouse HTML part: parsed, it holds no script, handler, img, svg, link or style (only the shop\'s own tables)', bad.join('; ').slice(0, 160))
    const ex = await execute(fresh.map((m) => m.html).join('<hr>'), 'mail')
    is(ex.dialogs.length === 0 && ex.evil.length === 0, 'and loaded in Chromium it opens no dialog and requests nothing from evil.example', `${ex.dialogs.length} dialogs, ${ex.evil.length} requests`)
    const pick = fresh.find((m) => /COLLECT CASH|AWAITING|PAID/.test(m.subject)) ?? fresh[0]
    const a = await analyse(pick.html)
    is(a.bodyText.includes(HOSTILE_CUSTOMER.name) && a.bodyText.includes('<img src=x onerror=alert(1)>'), 'the customer\'s text IS in the mail, as visible text (escaped, not dropped)')
  } else if (!browser) info('mail HTML parse skipped (no Chromium)')
  const plain = fresh.map((m) => m.text).join('\n')
  info('the text/plain part carries the raw customer text', `${plain.includes('<script>') ? 'contains <script> as text' : 'no markup'}; U+202E ${plain.includes('\u202e') ? 'kept' : 'absent'} (PHP-SCAN injection-10, known)`)
}

// ========================================================================== 6
head('6. e-mails built from config and accounts: reset link, birthday gift')
{
  // 6a. admin reset link: the origin is config (admin_reset_url), host-checked.
  const sendReset = async (resetUrl) => {
    writeApiConfig({ admin_reset_url: resetUrl }); await clearLimits()
    const before = mails().length
    await fetch(`${SITE}/api/admin.php?r=forgot_password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ email: ADMIN }) })
    for (let i = 0; i < 30 && mails().length === before; i++) await new Promise((r) => setTimeout(r, 100))
    const m = mails().slice(before)[0]
    return m ? parseMail(m) : null
  }
  const linkOf = (m) => (m.text.match(/(https?:\/\/\S+)/) ?? [])[1] ?? ''
  const okMail = await sendReset('https://www.sporta.com.kw/backends')
  is(!!okMail && linkOf(okMail).startsWith(`${ORIGIN}/backends#reset=`), 'admin reset mail links to the configured sporta.com.kw origin with the token in the fragment', okMail ? linkOf(okMail).replace(/reset=.*/, 'reset=…') : 'no mail')
  const variants = {
    'other host': 'https://evil.example/backends', 'userinfo': 'https://www.sporta.com.kw@evil.example/backends', 'subdomain lookalike': 'https://www.sporta.com.kw.evil.example/backends',
    'javascript:': 'javascript:alert(1)', 'http': 'http://www.sporta.com.kw/backends', 'quote in path': 'https://www.sporta.com.kw/backends"><script>alert(1)</script>',
    'backslash userinfo': 'https://evil.example\\@www.sporta.com.kw/backends', 'backslash host': 'https://www.sporta.com.kw\\.evil.example/backends',
  }
  const reached = {}
  for (const [name, url] of Object.entries(variants)) {
    const m = await sendReset(url)
    if (!m) { reached[name] = 'no mail'; continue }
    const link = linkOf(m)
    let origin = 'unparseable'
    try { origin = new URL(link.replace(/[<>"']+.*$/, '')).origin } catch { /* keep */ }
    reached[name] = origin
    if (browser && name === 'quote in path') {
      const a = await analyse(m.html)
      is(a.scripts.length === 0 && a.handlers.length === 0 && a.count.script === undefined, 'a quote and <script> in admin_reset_url are escaped in the HTML part of the reset mail', `anchors ${a.anchors.length}`)
    }
  }
  writeApiConfig()
  const offsite = Object.entries(reached).filter(([, o]) => o !== ORIGIN && o !== 'no mail')
  info('admin_reset_url variants: where the link in the mail resolves under the WHATWG parser', JSON.stringify(reached))
  weak(offsite.length === 0, 'admin_reset_url host check (parse_url) cannot be fooled by a backslash', offsite.length ? `config value ${JSON.stringify(variants[offsite[0][0]])} → link goes to ${offsite[0][1]} in a browser (same parse_url class as PHP-SCAN injection-1; source is the private config file only, no admin route writes it)` : '')
  is(['other host', 'userinfo', 'subdomain lookalike', 'javascript:', 'http'].every((n) => reached[n] === 'no mail' || reached[n] === ORIGIN), 'every ordinary lookalike (other host, userinfo, subdomain, javascript:, http) falls back to the fixed origin', JSON.stringify(Object.fromEntries(['other host', 'userinfo', 'subdomain lookalike', 'javascript:', 'http'].map((n) => [n, reached[n]]))))

  // 6b. config values that go into mail HEADERS.
  const headerCases = { warehouse_email: 'warehouse@sporta.test\r\nBcc: victim@evil.example', mail_from: 'cs@sporta.com.kw\r\nBcc: victim@evil.example', mail_reply_to: 'cs@sporta.com.kw\r\nBcc: victim@evil.example' }
  const leaked = []
  for (const [key, val] of Object.entries(headerCases)) {
    writeApiConfig({ [key]: val })
    await sql("update fulfilment_outbox set status = 'pending', attempts = 0, sent_at = null, last_error = null where 1=1 limit 1000").catch(() => {})
    const before = mails().length
    await phpCli('cron-fulfilment.php', ['--run'])
    for (const m of mails().slice(before)) if (/^bcc:/im.test(m.split(/\r?\n\r?\n/)[0])) leaked.push(key)
  }
  writeApiConfig()
  is(leaked.length === 0, 'CRLF in warehouse_email, mail_from or mail_reply_to never produces a Bcc header', `${Object.keys(headerCases).length} configs run; leaked via ${leaked.join(',') || 'none'}`)

  // 6c. the birthday gift mail: the customer's name is the only free text.
  await sql('delete from customer_accounts')
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(5, 10)
  await sql(`insert into customer_accounts (name, email, password_hash, birthday, birthday_set_at) values
    (${h('"><script>alert(1)</script><img src=x onerror=alert(1)>')}, 'bday@sporta.test', 'x', ${q('1990-' + today)}, '2026-01-01 00:00:00')`)
  const before = mails().length
  const out = await phpCli('cron-birthday.php', ['--send'])
  await new Promise((r) => setTimeout(r, 300))
  const bm = mails().slice(before).map(parseMail)[0]
  info('cron-birthday --send', out.replace(/\s+/g, ' ').slice(0, 100))
  if (bm && browser) {
    const a = await analyse(bm.html)
    is(a.scripts.length === 0 && a.handlers.length === 0 && !a.count.img && a.bodyText.includes('<script>alert(1)</script>'), 'birthday mail: a hostile account name is escaped text, not markup', `scripts ${a.scripts.length}, img ${a.count.img ?? 0}`)
  } else is(!!bm, 'birthday mail was produced', bm ? '' : 'none (cron said: ' + out.slice(0, 80) + ')')
}

// ========================================================================== 7
head('7. the payment pages: KNET redirect, T-Pay auto-post form, callbacks')
{
  const h2 = { 'X-Forwarded-Proto': 'https' }
  const knetTrack = ordersMade.find((o) => o.method === 'knet').track
  const tpayTrack = ordersMade.find((o) => o.method === 'tpay').track
  await sql(`update orders set payment_status = 'pending', stock_released = 0, fulfilment_status = 'unfulfilled' where track_id in (${q(knetTrack)}, ${q(tpayTrack)})`)
  // KNET: a 302 to the bank, nothing rendered.
  const kp = await get(`/knet/pay.php?trackid=${knetTrack}&lang=ar`, h2)
  const loc = kp.headers.get('location') ?? ''
  is(kp.status === 302 && /^https:\/\/kpaytest\.com\.kw\/kpg\/PaymentHTTP\.htm\?/.test(loc), 'knet/pay.php answers a 302 to the configured bank host and renders no HTML', `${kp.status} ${loc.slice(0, 60)}`)
  for (const bad of ['"><script>alert(1)</script>', 'A%0d%0aSet-Cookie:x=1', 'A B', '../x', 'A'.repeat(31)]) {
    const r = await get(`/knet/pay.php?trackid=${encodeURIComponent(bad)}`, h2)
    if (r.status !== 400 || /<|alert/.test(r.text)) bad && fails++ && console.log(`FAIL knet/pay.php reflected or accepted ${JSON.stringify(bad)}`)
  }
  ok('knet/pay.php: hostile track ids get a fixed 400 string (nothing reflected)')
  // KNET callbacks: the unauthenticated errorURL leg and a garbage trandata.
  for (const mode of ['plain', 'redirect']) {
    writeKnet({ callback_response: mode })
    const e = await fetch(`${SITE}/knet/callback.php?Error=${encodeURIComponent(P.tag)}&ErrorText=${encodeURIComponent(P.img)}&trackid=${encodeURIComponent(P.tag)}&paymentid=${encodeURIComponent(P.endscript)}`, { headers: h2, redirect: 'manual' })
    const body = await e.text()
    const where = e.headers.get('location') ?? body
    is(!/[<>"' ]/.test(where.replace(/^REDIRECT=/, '')) && /status=error/.test(where), `knet/callback.php (${mode}): Error, ErrorText, trackid and paymentid are logged, never reflected`, where.slice(0, 70))
    const d = await fetch(`${SITE}/knet/callback.php`, { method: 'POST', headers: { ...h2, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `trandata=${encodeURIComponent(P.tag)}`, redirect: 'manual' })
    const dw = d.headers.get('location') ?? await d.text()
    is(/reason=decrypt_failed/.test(dw) && !/[<>"]/.test(dw), `knet/callback.php (${mode}): garbage trandata → fixed reason, no reflection`, dw.slice(0, 70))
    if (mode === 'plain') is(/^text\/plain/.test(e.headers.get('content-type') ?? ''), 'the plain REDIRECT= reply is text/plain, not HTML')
  }
  writeKnet()
  const cbLog = existsSync(knetConfig.log_file) ? readFileSync(knetConfig.log_file, 'utf8') : ''
  is(!/\n[^\n{]/.test(cbLog.trim()) || cbLog.split('\n').filter(Boolean).every((l) => { try { JSON.parse(l); return true } catch { return false } }), 'the KNET log is one JSON object per line: a CRLF in a bank field cannot forge a log line', `${cbLog.split('\n').filter(Boolean).length} lines`)

  // T-Pay: an auto-posting form whose action, fields and token all come from the gateway or config.
  const pay = async (label, token, baseSuffix) => {
    writeFileSync(join(tmp, 'token.txt'), token)
    writePay(baseSuffix === undefined ? {} : { test_base: `http://127.0.0.1:${FAKE_PORT}/${baseSuffix}` })
    await clearLimits()
    const r = await get(`/pay/pay.php?trackid=${tpayTrack}&lang=en`, h2)
    return { label, r, a: r.status === 200 ? await analyse(r.text) : null }
  }
  const plain = await pay('plain', 'tok-123')
  is(plain.r.status === 200 && plain.a?.forms.length === 1, 'pay/pay.php renders the hosted-page hand-off form', `${plain.r.status}`)
  if (browser && plain.a) {
    const f = plain.a.forms[0]
    is(/^http:\/\/127\.0\.0\.1:\d+\/cbk\/ePay\/pg\/epay\?_v=tok-123$/.test(f.action) && f.inputs.some(([n, v]) => n === 'tij_MerchAuthKeyApi' && v === 'tok-123'), 'its action is the configured base + the token, URL-encoded', f.action)
  }
  const hostileToken = `${P.tag}${P.attr}${P.apos}</form><script>alert(1)</script>`
  const ht = await pay('hostile token from the gateway', hostileToken)
  if (browser && ht.a) {
    const f = ht.a.forms[0]
    is(ht.a.scripts.filter(EXEC).length === 0 && ht.a.handlers.filter((x) => !/body\[onload\]/.test(x)).length === 0 && ht.a.forms.length === 1, 'a hostile AccessToken from the gateway stays inside its attribute (one form, no script, no extra handler)', `forms ${ht.a.forms.length}, handlers ${ht.a.handlers.length}`)
    is(f?.inputs.find(([n]) => n === 'tij_MerchAuthKeyApi')?.[1] === hostileToken && /_v=[A-Za-z0-9%._~-]+$/.test(f.action), 'the token round-trips byte for byte in the field and is percent-encoded in the action', f?.action.slice(-40))
    const ex = await execute(ht.r.text.replace(/<body onload="[^"]*"/, '<body'), 'tpay form')
    is(ex.dialogs.length === 0 && ex.evil.length === 0, 'loaded in Chromium (auto-submit disabled): no dialog, no request to evil.example', `${ex.dialogs.length}/${ex.evil.length}`)
  }
  const hb = await pay('hostile base path', 'tok', `p"><script>alert(1)</script>`)
  info('a base URL path with "><script> (pay-config test_base)', `${hb.r.status} ${hb.r.status === 200 ? 'rendered' : hb.r.text.slice(0, 50)}`)
  if (browser && hb.a) is(hb.a.scripts.filter(EXEC).length === 0 && hb.a.forms.length === 1 && !/[<>]/.test(hb.a.forms[0].action.replace(/%3C|%3E/gi, '')) || hb.a.forms[0].action.includes('&quot;') === false, 'and the form action keeps it as an attribute value (escaped)', hb.a.forms[0].action.slice(0, 80))
  // A base that is not https and not a local host is refused before any form exists.
  const bad = {}
  for (const [name, base] of Object.entries({ javascript: 'javascript:alert(1)//', data: 'data:text/html,<script>alert(1)</script>', 'other http host': 'http://evil.example' })) {
    writePay({ test_base: base }); await clearLimits()
    const r = await get(`/pay/pay.php?trackid=${tpayTrack}`, h2)
    bad[name] = r.status
    if (r.status === 200 && /<form/i.test(r.text)) fails++, console.log(`FAIL pay.php rendered a form for test_base ${name}`)
  }
  ok('pay-config test_base of javascript:, data: or an http host is refused: no form is rendered', JSON.stringify(bad))
  writePay()
  // The result page URL (config) goes into Location headers: CRLF cannot split it.
  writeKnet({ result_page_url: 'https://www.sporta.com.kw/payment/result\r\nSet-Cookie: x=1' })
  const split = await fetch(`${SITE}/knet/callback.php?Error=1`, { headers: h2, redirect: 'manual' })
  writeKnet()
  is(![...split.headers.keys()].includes('set-cookie'), 'CRLF in a configured result_page_url cannot add a Set-Cookie header (PHP refuses multi-line header values)', `${split.status}`)
  // Preflight prints config values: poisoned values must be escaped.
  writeKnet({ env: '"><script>alert(1)</script>' })
  const pf = await fetch(`${SITE}/api/preflight.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `key=${CRON_KEY}` })
  const pft = await pf.text()
  writeKnet()
  if (browser) {
    const a = await analyse(pft)
    is(pf.status === 200 && a.scripts.length === 0 && a.handlers.length === 0, 'api/preflight.php prints a poisoned gateway env as text', `${pf.status}, ${a.scripts.length} scripts`)
  } else is(!/<script>alert/.test(pft), 'api/preflight.php prints a poisoned gateway env escaped')
  const sa = await fetch(`${SITE}/api/setup-admin.php`)
  const sat = await sa.text()
  is(!/<script>alert/.test(sat), 'api/setup-admin.php (while an admin exists) prints a fixed refusal', `${sa.status}`)
}

// ========================================================================== 8
head('8. the client side, as far as the repo can show it')
{
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'fonts', 'hero', 'cats'].includes(e.name)) walk(p, out) } else if (/\.(jsx?|mjs|html)$/.test(e.name)) out.push(p)
    }
    return out
  }
  const files = [...walk(join(WEB, 'src')), ...walk(join(WEB, 'public')), join(WEB, 'index.html')]
  const rel = (f) => f.slice(WEB.length + 1)
  const scan = (re) => files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => [rel(f), i + 1, l]).filter(([, , l]) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)))
  const sinks = {
    dangerouslySetInnerHTML: scan(/dangerouslySetInnerHTML/), 'document.write': scan(/document\.write\(/), 'eval/new Function': scan(/\beval\(|new Function\(/),
    insertAdjacentHTML: scan(/insertAdjacentHTML|createContextualFragment|outerHTML\s*=/), 'srcdoc': scan(/srcdoc\s*=/),
    'javascript: literal': scan(/['"`]javascript:/i), 'window.open': scan(/window\.open\(/),
  }
  const innerHtml = scan(/\.innerHTML\s*=/).filter(([f]) => f !== 'public/go-live.html')
  is(Object.entries(sinks).every(([, v]) => v.length === 0), 'the repo storefront, admin and add-on JS use none of dangerouslySetInnerHTML, document.write, eval, insertAdjacentHTML, srcdoc, window.open or a javascript: literal', Object.entries(sinks).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v[0]}`).join(' ') || `${files.length} files`)
  is(innerHtml.length === 2 && innerHtml.every(([f]) => ['public/sporta-features.js', 'index.html'].includes(f)), 'innerHTML is assigned in exactly two places (the brand banner, the load-failure notice) and go-live.html', innerHtml.map(([f, l]) => `${f}:${l}`).join(' '))
  const feat = readFileSync(join(WEB, 'public/sporta-features.js'), 'utf8')
  const bannerInputs = [...feat.slice(feat.indexOf('function build()')).split('sec.innerHTML')[1].split('return sec')[0].matchAll(/\+\s*([A-Za-z_.()\[\]0-9]+)\s*\+/g)].map((m) => m[1])
  is(/esc\(t\.title\)/.test(feat) && /esc\(t\.sub\)/.test(feat) && /esc\(it\[1\]\)/.test(feat) && /esc\(it\[2\]\)/.test(feat) && /esc\(t\.shop\)/.test(feat) && /esc\(t\.wa\)/.test(feat), 'sporta-features.js: every interpolated string in the banner passes esc(), and its sources are constants in the file, not settings', `inputs ${bannerInputs.filter((x) => !/^(ID|esc|svg)/.test(x)).slice(0, 8).join(' ')}`)
  const boot = readFileSync(join(WEB, 'index.html'), 'utf8')
  is(/failed\.replace\(\/\[<&\]\/g, ''\)/.test(boot), 'index.html load-failure notice strips < and & from the one URL it prints (and prints it inside <code>)')
  const adminJs = readFileSync(join(WEB, 'public/sporta-admin-brands.js'), 'utf8')
  is(!/\.innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(adminJs) && (adminJs.match(/\.textContent\s*=/g) ?? []).length >= 30, 'sporta-admin-brands.js builds every node with createElement + textContent (values from the API never become markup)', `${(adminJs.match(/\.textContent\s*=/g) ?? []).length} textContent writes`)
  const hrefs = adminJs.split('\n').filter((l) => /\.href\s*=|\.src\s*=|setAttribute\(['"](href|src)/.test(l) && !/^\s*\/\//.test(l)).map((l) => l.trim())
  info('add-on URL assignments (admin-brands.js)', hrefs.map((l) => l.slice(0, 70)).join(' | '))
  is(hrefs.every((l) => /encodeURIComponent|URL\.createObjectURL|\burl\b|it\.thumb|TEL|^\w+\.href = '\//.test(l) || /thumb|url/.test(l)), 'and every URL it sets is a constant path, an encodeURIComponent value, a blob: URL or a locally made thumbnail')
  const cfgSrc = readFileSync(join(WEB, 'src/lib/runtimeConfig.js'), 'utf8')
  const checkout = readFileSync(join(WEB, 'src/lib/checkout.js'), 'utf8')
  weak(/https?:|startsWith\('\/|new URL/.test(cfgSrc),
    'runtimeConfig.configValue() checks the scheme of payBaseUrl / cbkBaseUrl before checkout.js assigns window.location.href to it',
    'any non-empty string from public/config.js is used as-is, so `javascript:` there would run at checkout; the file is executable JavaScript already, so a writer of config.js gains nothing (info), but a scheme check is one line')
  is(/window\.location\.href = `\$\{(CBK_BASE|PAY_BASE)\}/.test(checkout), 'checkout.js navigation targets are the configured pay bases (+ a URLSearchParams query), no setting from the settings table')
  // What the client does with a hostile cta_href: ask react-router + React 18 for the markup.
  try {
    const React = (await import('react')).default
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { MemoryRouter, Link } = await import('react-router-dom')
    const mk = (to) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Link, { to }, 'go')))
    const out = Object.fromEntries(['javascript:alert(1)', '//evil.example', 'data:text/html,x', '/shop'].map((to) => [to, (mk(to).match(/href="([^"]*)"/) ?? [])[1]]))
    const ver = (n) => JSON.parse(readFileSync(join(WEB, 'node_modules', n, 'package.json'), 'utf8')).version
    info(`<Link to=…> as HeroSlider/PromoBar render it (react-router-dom ${ver('react-router-dom')}, react-dom ${ver('react-dom')}; server renderer)`, JSON.stringify(out))
    is(!/^javascript:alert/i.test(out['javascript:alert(1)'] ?? ''), 'React itself blocks a javascript: Link target in the rendered href (it swaps in a throwing stub)', String(out['javascript:alert(1)']).slice(0, 60))
    weak(!/^\/\//.test(out['//evil.example'] ?? '') && !/^data:/i.test(out['data:text/html,x'] ?? ''),
      'the client neutralises a protocol-relative or data: Link target itself (defence in depth for a poisoned slide row)',
      `react-router passes href="${out['//evil.example']}" and href="${out['data:text/html,x']}" through verbatim, so a poisoned cta_href of //evil.example is an off-site button unless the server stops it`)
  } catch (e) { info('react-router rendering check skipped', String(e.message).split('\n')[0]) }
  // The live storefront is a compiled build whose source is not in the repo.
  // When a copy of its /assets directory is at hand (LIVE_ASSETS=<dir>, e.g. a
  // read-only capture made through the Hostinger connector), its chunks are
  // read for DOM sinks and for the client-side gates that compensate the
  // "weak" read-side checks above. Without it this is a live check.
  const LIVE = process.env.LIVE_ASSETS
  if (LIVE && existsSync(LIVE)) {
    const chunks = readdirSync(LIVE).filter((n) => n.endsWith('.js'))
    const texts = Object.fromEntries(chunks.map((n) => [n, readFileSync(join(LIVE, n), 'utf8')]))
    const app = Object.entries(texts).filter(([n]) => !/^react-vendor-/.test(n))
    const hits = (re) => app.filter(([, t]) => re.test(t)).map(([n]) => n)
    const sinkHits = {
      dangerouslySetInnerHTML: hits(/dangerouslySetInnerHTML|__html/), innerHTML: hits(/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/),
      'document.write': hits(/document\.write\(/), eval: hits(/\beval\(|new Function\(/), srcdoc: hits(/srcdoc/), 'window.open': hits(/window\.open\(/), 'javascript:': hits(/["'`]javascript:/),
    }
    is(Object.values(sinkHits).every((v) => v.length === 0), `live bundle (${chunks.length} chunks, react-vendor excluded): no dangerouslySetInnerHTML/__html, innerHTML, document.write, eval, srcdoc, window.open or javascript: literal`,
      Object.entries(sinkHits).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(',')}`).join('; ') || `${app.length} app chunks`)
    const main = app.find(([n]) => /^index-/.test(n))?.[1] ?? ''
    // The gates, as the minifier left them (literal source text, not re-derived).
    const hrefGate = main.includes('/^\\/(?![/\\\\])[A-Za-z0-9/_\\-?=&%.#]{0,180}$/')
    is(hrefGate, 'live bundle gates cta_href and the promo bar href on the client with a single-slash same-origin path regex (compensates the r=slides read-side weak)', hrefGate ? '' : 'gate not found: re-read the bundle')
    is(main.includes('/^#[0-9a-f]{6}$/i.test(') && main.includes('[`10`,`16`,`24`].includes(String('), 'live bundle re-validates theme colours (#rrggbb) and radius (10|16|24) before style.setProperty (compensates the r=theme read-side weak)')
    is(main.includes('/^\\/fonts\\/custom\\/([a-f0-9]{20})\\.(woff2|woff|ttf|otf)$/'), 'live bundle only loads a custom font from /fonts/custom/<20 hex>.(woff2|woff|ttf|otf)')
    is(/Math\.max\(2e3,Number\(\w+\.speed_ms\)\|\|/.test(main), 'live bundle coerces hero.speed_ms with Number() and a 2 s floor (a string becomes the default)')
    const all = Object.values(texts).join('\n')
    info('live bundle notice and topbar text', /children:\w+\[e===`ar`\?`notice_ar`:`notice_en`\]/.test(all) && /text_ar:e\?\.text_en/.test(all) ? 'both rendered as React text children' : 'render shape not matched (read it)')
  } else info('live compiled bundle', 'not in the repo: set LIVE_ASSETS=<captured /assets dir> to read its chunks for sinks and client gates; otherwise a live check (see live_checks_pending)')
}

// ========================================================================== 9
head('9. the detectors can fail: two deliberate regressions on a copy')
// A suite that has never seen a failure proves nothing. A second staged copy of
// the tree serves the SAME poisoned database with one escape removed.
{
  const STAGE2 = join(tmp, 'site2')
  cpSync(STAGE, STAGE2, { recursive: true })
  const port2 = await freePort(SITE_PORT + 1)
  procs.push(spawn('php', [...phpFlags, '-S', `127.0.0.1:${port2}`, '-t', STAGE2, join(STAGE2, 'router.php')], { stdio: 'ignore', env: phpEnv }))
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port2}/api/api.php?r=checkout_config`)).status === 200) break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  const seoFile = join(STAGE2, 'api/seo-page.php')
  const orig = readFileSync(seoFile, 'utf8')
  const mutate = async (label, from, to) => {
    if (!orig.includes(from)) { bad(`mutation "${label}" no longer applies: seo-page.php changed, update this suite`); return }
    writeFileSync(seoFile, orig.replace(from, to))
    const r = await fetch(`http://127.0.0.1:${port2}/`).then((x) => x.text())
    const a = await analyse(r)
    const problems = a ? samePage(baseline['/'].a, a) : ['(no browser)']
    const ex = a ? await execute(r, label) : null
    writeFileSync(seoFile, orig)
    return { problems, ex }
  }
  if (browser) {
    const m1 = await mutate('escape removed', 'return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, \'UTF-8\');', 'return $value;')
    is(m1 && m1.problems.length > 0, 'without sporta_seo_escape() the parser check reports the injected script/element', m1?.problems.slice(0, 2).join('; '))
    is(m1?.ex && m1.ex.dialogs.length > 0, 'and loading that page in Chromium DOES raise a dialog (the execution detector works)', `${m1?.ex?.dialogs.length} dialogs`)
    const m2 = await mutate('JSON_HEX_TAG removed', '| JSON_HEX_TAG | JSON_HEX_AMP', '| JSON_HEX_AMP')
    is(m2 && m2.problems.length > 0, 'without JSON_HEX_TAG a </script> in a stored override breaks out of the embedded JSON block and is caught', m2?.problems.slice(0, 2).join('; '))
  } else info('mutation checks skipped (no Chromium)')
}

// ------------------------------------------------------------------ summary
head('summary')
const ws = matrix.filter((m) => m.outcome === 'stored verbatim').length
info('admin save routes tried with hostile text', `${matrix.length} field/payload pairs: ${matrix.filter((m) => m.outcome === 'refused').length} refused, ${matrix.filter((m) => m.outcome === 'normalised').length} normalised, ${ws} stored as typed`)
console.log(`\n${passes} ok, ${weaks} weak, ${fails} failed${STRICT && weaks ? ' (--strict: weak counts as failed)' : ''}`)
process.exit(fails || (STRICT && weaks) ? 1 : 0)
