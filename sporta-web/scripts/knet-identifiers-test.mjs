// KNET Merchant ID / Terminal ID and the Test <-> Production switch, through
// the real admin API: sign in, save the two identifiers for each environment,
// switch environment, and prove the active pair follows it, the secrets are
// never returned or disturbed, and bad input is refused.
//
//   npm run test:knet-ids    (needs the sandbox: MariaDB and the seeded admin)
//
// The last section drives the add-on that puts the card into the compiled live
// admin (public/sporta-admin-brands.js) in a real browser, against a stand-in
// page shaped like the compiled Payments > KNET editor.
//
// It serves a COPY of dropin/php-store at T/api beside a throwaway
// T/knet/config.php (the layout shared hosting uses), so the suite writes a
// config it owns and never touches dropin/php-knet/config.php.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const HERE = fileURLToPath(new URL('.', import.meta.url))
const WEB = join(HERE, '..')
const PORT = 8135
const BASE = `http://127.0.0.1:${PORT}`

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (s) => console.log(`\n=== ${s} ${'='.repeat(Math.max(3, 60 - s.length))}`)

const T = fs.mkdtempSync(join(tmpdir(), 'sporta-knetids-'))
fs.cpSync(join(WEB, 'dropin', 'php-store'), join(T, 'api'), { recursive: true })
fs.copyFileSync(join(WEB, 'public', 'sporta-admin-brands.js'), join(T, 'sporta-admin-brands.js'))
// A page shaped like the compiled editor: two forms in a grid, the KNET one
// carrying the on/off row, a field grid, an alert slot and the save row.
fs.writeFileSync(join(T, 'editor.html'), `<!doctype html><html><body><main><div class="grid">
<form class="payment-gateway-editor" id="knet"><div>KNET editor</div>
<div class="payment-knet-toggle-row"></div>
<div class="mt-5 grid gap-4 md:grid-cols-2"><label><input type="password" name="test_tranportal_id"></label></div>
<p id="alert"></p><div><button>Save KNET</button></div></form>
<form class="payment-gateway-editor" id="tpay"><div>T-Pay editor</div><div class="mt-5 grid"><label><input name="client_id"></label></div><div><button>Save T-Pay</button></div></form>
</div></main><script>window.__submitted = 0; document.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); window.__submitted++ }))</script>
<script src="/sporta-admin-brands.js"></script></body></html>`)
fs.writeFileSync(join(T, 'router.php'), `<?php
$u = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($u === '/backends') { header('Content-Type: text/html; charset=utf-8'); readfile(__DIR__ . '/editor.html'); return true; }
return false;
`)
fs.mkdirSync(join(T, 'knet'), { recursive: true })
fs.mkdirSync(join(T, 'pay'), { recursive: true })
const TPAY = { id: 'tpay-client-SECRET', secret: 'tpay-secret-SECRET', key: 'ENCRP-SECRET-KEY' }
await run('php', ['-r', `file_put_contents('${join(T, 'pay', 'config.php')}', '<?php return ' . var_export([
  'env' => 'test', 'test_base' => 'https://pgtest.cbk.com', 'production_base' => 'https://pg.cbk.com',
  'client_id' => '${TPAY.id}', 'client_secret' => '${TPAY.secret}', 'encrp_key' => '${TPAY.key}',
  'return_url' => 'https://www.sporta.com.kw/pay/callback.php', 'result_page_url' => 'https://www.sporta.com.kw/payment/result', 'lang' => 'en',
], true) . ';');`])
const tpayPath = join(T, 'pay', 'config.php')
const readTpay = async () => JSON.parse((await run('php', ['-r', `echo json_encode(require '${tpayPath}');`])).stdout)
const SECRETS = { id: 'TP-900-SECRET', pass: 'pw-SECRET-123', key: 'KEY16SECRET12345' }
fs.writeFileSync(join(T, 'knet', 'config.php'), '<?php return ' + JSON.stringify({}) + ';')
await run('php', ['-r', `file_put_contents('${join(T, 'knet', 'config.php')}', '<?php return ' . var_export([
  'env' => 'test',
  'test_url' => 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
  'production_url' => 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
  'merchant_id' => 'YOUR_MERCHANT_ID', 'terminal_id' => 'YOUR_TERMINAL_ID',
  'tranportal_id' => '${SECRETS.id}', 'tranportal_password' => '${SECRETS.pass}', 'resource_key' => '${SECRETS.key}',
  'response_url' => 'https://www.sporta.com.kw/knet/callback.php', 'error_url' => 'https://www.sporta.com.kw/knet/callback.php',
  'result_page_url' => 'https://www.sporta.com.kw/payment/result', 'language' => 'USA',
], true) . ';');`])
const cfgPath = join(T, 'knet', 'config.php')
const readCfg = async () => JSON.parse((await run('php', ['-r', `echo json_encode(require '${cfgPath}');`])).stdout)

await run('mariadb', ['sporta', '-e', "delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null"])
const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', T, join(T, 'router.php')], { stdio: 'ignore' })
for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/admin.php?r=me`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }

let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.csrf === false ? {} : { 'X-Sporta-Admin': '1' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null), text: '' }
}
const ids = (o = {}) => ({ test_merchant_id: '', test_terminal_id: '', production_merchant_id: '', production_terminal_id: '', ...o })

try {
  head('signed out')
  is((await admin('payment_identifiers')).status === 401, 'the identifiers route refuses without a session')

  const login = await admin('login', { method: 'POST', body: { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' } })
  is(login.status === 200, 'the seeded admin signs in', `${login.status}`)

  head('reading')
  const g0 = (await admin('payment_identifiers')).body
  is(g0?.env === 'test' && g0.test?.merchant_id === '' && g0.production?.terminal_id === '', 'placeholders read as empty, environment is test', JSON.stringify(g0))
  is((await admin('payment_identifiers', { method: 'POST', csrf: false, body: ids() })).status === 400, 'saving without the X-Sporta-Admin header is refused')

  head('saving')
  const saved = await admin('payment_identifiers', { method: 'POST', body: ids({
    test_merchant_id: 'TM-1001', test_terminal_id: 'TT-2002', production_merchant_id: 'LM-3003', production_terminal_id: 'LT-4004' }) })
  is(saved.status === 200 && saved.body?.test?.merchant_id === 'TM-1001' && saved.body?.production?.terminal_id === 'LT-4004', 'all four identifiers are saved and returned', JSON.stringify(saved.body))
  let cfg = await readCfg()
  is(cfg.merchant_id === 'TM-1001' && cfg.terminal_id === 'TT-2002', 'the ACTIVE pair (test) is what the config reads as merchant_id / terminal_id')
  is(cfg.tranportal_id === SECRETS.id && cfg.tranportal_password === SECRETS.pass && cfg.resource_key === SECRETS.key, 'the Tranportal credentials and resource key are untouched')
  is(((await fs.promises.stat(cfgPath)).mode & 0o777) === 0o600, 'the config is rewritten owner-only (0600)')
  is(!JSON.stringify(saved.body).includes(SECRETS.pass) && !JSON.stringify(saved.body).includes(SECRETS.key), 'no secret is returned by the identifiers route')

  head('the Test <-> Production switch')
  const sw = await admin('payment_config', { method: 'POST', body: {
    gateway: 'knet', env: 'production',
    test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
    result_page_url: 'https://www.sporta.com.kw/payment/result',
    // The editor's secret form: the live set, entered for production.
    production_tranportal_id: 'LIVE-777', production_tranportal_password: 'live-pass-1', production_resource_key: 'LIVEKEY123456789',
  } })
  is(sw.status === 200 && sw.body?.config?.env === 'production', 'switching the environment to production is accepted', `${sw.status} ${sw.body?.error ?? ''}`)
  cfg = await readCfg()
  is(cfg.env === 'production' && cfg.tranportal_id === 'LIVE-777' && cfg.resource_key === 'LIVEKEY123456789', 'the active Tranportal credentials follow the environment')
  is(cfg.merchant_id === 'LM-3003' && cfg.terminal_id === 'LT-4004', 'and so do the active Merchant ID and Terminal ID', `${cfg.merchant_id} / ${cfg.terminal_id}`)
  is(cfg.test_merchant_id === 'TM-1001' && cfg.test_terminal_id === 'TT-2002', 'the test pair is kept for the way back')
  const g1 = (await admin('payment_identifiers')).body
  is(g1?.env === 'production' && g1.production?.merchant_id === 'LM-3003' && g1.test?.terminal_id === 'TT-2002', 'reading shows both pairs and the active environment', JSON.stringify(g1))
  const back = await admin('payment_config', { method: 'POST', body: {
    gateway: 'knet', env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result' } })
  cfg = await readCfg()
  is(back.status === 200 && cfg.env === 'test' && cfg.merchant_id === 'TM-1001' && cfg.tranportal_id === SECRETS.id, 'switching back restores the test pair and the test credentials')

  head('refusals')
  for (const [label, value] of [['a space inside', 'A B'], ['a quote', "x'y"], ['a script tag', '<b>1</b>'], ['41 characters', 'A'.repeat(41)]]) {
    const r = await admin('payment_identifiers', { method: 'POST', body: ids({ test_merchant_id: value }) })
    is(r.status === 400 && r.body?.error === 'invalid_identifier', `${label} is refused`)
  }
  const missing = await admin('payment_identifiers', { method: 'POST', body: { test_merchant_id: 'ONLY-ONE' } })
  is(missing.status === 400, 'a request that omits an identifier is refused, not read as "clear"')
  is((await readCfg()).test_merchant_id === 'TM-1001', 'and a refused save changes nothing')
  const clear = await admin('payment_identifiers', { method: 'POST', body: ids() })
  is(clear.status === 200 && clear.body?.test?.merchant_id === '' && (await readCfg()).merchant_id === '', 'blank values clear the identifiers')

  head('T-Pay Merchant Server IPs')
  const t0 = (await admin('payment_server_ips')).body
  is(t0?.server_ip_1 === '' && t0?.server_ip_2 === '', 'no IPs on file at first', JSON.stringify(t0))
  is((await admin('payment_server_ips', { method: 'POST', csrf: false, body: { server_ip_1: '', server_ip_2: '' } })).status === 400, 'saving without the X-Sporta-Admin header is refused')
  const t1 = await admin('payment_server_ips', { method: 'POST', body: { server_ip_1: '187.7.78.123', server_ip_2: '2a02:4780:7e:cca0::1' } })
  is(t1.status === 200 && t1.body?.server_ip_1 === '187.7.78.123' && t1.body?.server_ip_2 === '2a02:4780:7e:cca0::1', 'an IPv4 and an IPv6 address are saved and returned', JSON.stringify(t1.body))
  let tc = await readTpay()
  is(tc.client_id === TPAY.id && tc.client_secret === TPAY.secret && tc.encrp_key === TPAY.key, 'the ClientId, ClientSecret and ENCRP_KEY are untouched')
  is(tc.return_url === 'https://www.sporta.com.kw/pay/callback.php' && ((await fs.promises.stat(tpayPath)).mode & 0o777) === 0o600, 'the return URL is kept and the file is owner-only')
  is(!JSON.stringify(t1.body).includes(TPAY.secret) && !JSON.stringify(t1.body).includes(TPAY.key), 'no secret is returned')
  for (const [label, value] of [['a hostname', 'example.com'], ['a range', '10.0.0.0/8'], ['a number out of range', '999.1.1.1'], ['text with a space', '1.2.3.4 5.6.7.8']]) {
    const r = await admin('payment_server_ips', { method: 'POST', body: { server_ip_1: value, server_ip_2: '' } })
    is(r.status === 400 && r.body?.error === 'invalid_server_ip', `${label} is refused`)
  }
  is((await admin('payment_server_ips', { method: 'POST', body: { server_ip_1: '1.2.3.4' } })).status === 400, 'a request that omits an address is refused, not read as "clear"')
  is((await readTpay()).server_ip_1 === '187.7.78.123', 'and refused saves change nothing')
  const t2 = await admin('payment_server_ips', { method: 'POST', body: { server_ip_1: '', server_ip_2: '' } })
  is(t2.status === 200 && (await readTpay()).server_ip_1 === '', 'blank clears the addresses')

  head('KNET through the CBK setup: the switch')
  const v0 = (await admin('payment_knet_via_cbk')).body
  is(v0?.enabled === false && v0?.tpay_ready === true, 'off by default; T-Pay credentials count as ready', JSON.stringify(v0))
  is((await admin('payment_knet_via_cbk', { method: 'POST', csrf: false, body: { enabled: true } })).status === 400, 'switching without the X-Sporta-Admin header is refused')
  is((await admin('payment_knet_via_cbk', { method: 'POST', body: { enabled: 'yes' } })).status === 400, 'only a real boolean is accepted')
  const von = await admin('payment_knet_via_cbk', { method: 'POST', body: { enabled: true } })
  tc = await readTpay()
  is(von.status === 200 && von.body?.enabled === true && tc.knet_via_cbk === true, 'switching ON is saved in the T-Pay config')
  is(tc.client_id === TPAY.id && tc.encrp_key === TPAY.key && tc.client_secret === TPAY.secret, 'and the credentials are untouched')
  const voff = await admin('payment_knet_via_cbk', { method: 'POST', body: { enabled: false } })
  is(voff.status === 200 && (await readTpay()).knet_via_cbk === false, 'switching OFF is saved')
  await run('php', ['-r', `$c = require '${tpayPath}'; $c['client_id'] = 'YOUR_CLIENT_ID'; file_put_contents('${tpayPath}', '<?php return ' . var_export($c, true) . ';');`])
  const noCreds = await admin('payment_knet_via_cbk', { method: 'POST', body: { enabled: true } })
  is(noCreds.status === 409 && noCreds.body?.error === 'tpay_credentials_required' && (await readTpay()).knet_via_cbk === false, 'it cannot be switched ON while the T-Pay credentials are placeholders')
  await run('php', ['-r', `$c = require '${tpayPath}'; $c['client_id'] = '${TPAY.id}'; file_put_contents('${tpayPath}', '<?php return ' . var_export($c, true) . ';');`])

  head('the card in the live admin (real browser)')
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  })
  try {
    const context = await browser.newContext()
    const signed = await context.request.post(`${BASE}/api/admin.php?r=login`, {
      headers: { 'X-Sporta-Admin': '1' }, data: { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' } })
    is(signed.status() === 200, 'the browser session signs in', `${signed.status()}`)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/backends`)
    await page.waitForSelector('#knet [data-sporta-knet-ids]', { timeout: 5000 })
    is(await page.locator('[data-sporta-knet-ids]').count() === 1, 'exactly one card appears')
    is(await page.locator('#tpay [data-sporta-knet-ids]').count() === 0, "and it is not put in T-Pay's editor")
    const order = await page.evaluate(() => {
      const f = document.querySelector('#knet'); const c = f.querySelector('[data-sporta-knet-ids]')
      return [...f.children].indexOf(c) > [...f.children].indexOf(f.querySelector(':scope > .grid')) && [...f.children].indexOf(c) < [...f.children].indexOf(document.querySelector('#alert'))
    })
    is(order, 'it sits after the field grid and before the alert and save row')
    const inputs = page.locator('[data-sporta-knet-ids] input')
    is(await inputs.count() === 4, 'four inputs: Merchant ID and Terminal ID for Test and for Live')
    is(await page.locator('[data-sporta-knet-ids] >> text=Active').first().isVisible(), 'the active environment is marked')

    await inputs.nth(0).fill('BM-11'); await inputs.nth(1).fill('BT-22'); await inputs.nth(2).fill('LM-33'); await inputs.nth(3).fill('LT-44')
    await inputs.nth(3).press('Enter')
    await page.waitForSelector('[data-sporta-knet-ids] >> text=Saved.', { timeout: 5000 })
    is(await page.evaluate(() => window.__submitted) === 0, 'Enter inside the card saves the card and does NOT submit the editor form')
    cfg = await readCfg()
    is(cfg.test_merchant_id === 'BM-11' && cfg.production_terminal_id === 'LT-44' && cfg.merchant_id === 'BM-11', 'what was typed is in the config, active pair set')
    await page.reload()
    await page.waitForSelector('[data-sporta-knet-ids] input')
    await page.waitForFunction(() => document.querySelectorAll('[data-sporta-knet-ids] input')[2].value === 'LM-33')
    is(true, 'after a reload the saved identifiers are shown again')

    await inputs.nth(0).fill('bad value!')
    await page.click('[data-sporta-knet-ids] button')
    await page.waitForSelector('[data-sporta-knet-ids] >> text=letters, digits', { timeout: 5000 })
    is(true, 'a bad value shows the reason in plain words')
    is((await readCfg()).test_merchant_id === 'BM-11', 'and nothing was saved')
    // T-Pay's editor gets its own card with the two address boxes.
    await page.waitForSelector('#tpay [data-sporta-tpay-ips]', { timeout: 5000 })
    is(await page.locator('#knet [data-sporta-tpay-ips]').count() === 0, "the IP card is not put in KNET's editor")
    const ip = page.locator('[data-sporta-tpay-ips] input[type=text]')
    is(await ip.count() === 2, 'two boxes: Merchant Server IP 1 and 2')
    const viaBox = page.locator('[data-sporta-tpay-ips] input[type=checkbox]')
    await page.waitForFunction(() => !document.querySelector('[data-sporta-tpay-ips] input[type=checkbox]').disabled)
    is(await viaBox.isChecked() === false, 'the KNET-through-CBK box starts unchecked')
    await viaBox.check()
    await page.waitForSelector('[data-sporta-tpay-ips] >> text=On: KNET orders now pay through CBK', { timeout: 5000 })
    is((await readTpay()).knet_via_cbk === true && await page.evaluate(() => window.__submitted) === 0, 'ticking it saves the switch on the server without submitting the editor form')
    await viaBox.uncheck()
    await page.waitForSelector('[data-sporta-tpay-ips] >> text=Off: KNET uses its own Tranportal setup', { timeout: 5000 })
    is((await readTpay()).knet_via_cbk === false, 'unticking switches it off again')
    await ip.nth(0).fill('187.7.78.123'); await ip.nth(1).press('Enter')
    await page.waitForSelector('[data-sporta-tpay-ips] >> text=Saved.', { timeout: 5000 })
    is((await readTpay()).server_ip_1 === '187.7.78.123' && await page.evaluate(() => window.__submitted) === 0, 'saved from the page, and Enter did not submit the editor form')
    await ip.nth(1).fill('not an ip'); await page.click('[data-sporta-tpay-ips] button')
    await page.waitForSelector('[data-sporta-tpay-ips] >> text=not a valid IP', { timeout: 5000 })
    is(true, 'a bad address shows the reason in plain words')
    is(errors.length === 0, 'no script errors on the page', errors.join(' | '))
  } finally { await browser.close() }
} finally {
  server.kill()
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null']).catch(() => {})
  fs.rmSync(T, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} FAILED` : '\nALL OK')
process.exit(fails ? 1 : 0)
