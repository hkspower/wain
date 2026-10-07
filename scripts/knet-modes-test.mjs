/**
 * test:knet-modes — Test and Production each have their own CBK credentials (2026-10-07).
 *
 *   - the GATEWAY (pay/cbk.php's cbk_config(), run for real) uses the Test set in Test mode and the
 *     Production set in Production — and Production NEVER borrows a Test value, even when its own
 *     field is empty
 *   - a shop that saved one set before the split keeps working: Test mode borrows that set
 *   - the panel's readiness (admin.php ?r=knet) reports both sets as the gateway would assemble them
 *   - a placeholder is refused in the Test fields as in the Production ones
 *   - the Payments card shows both groups, and its switch REFUSES to go live while the Production
 *     set is incomplete; it asks first when the set is complete
 *
 * Run `bash scripts/sandbox.sh` first. The `knet` settings row is saved and restored.
 * MUTATE=borrow lets Production borrow Test values and must fail.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const gateway = () => JSON.parse(execFileSync('php', ['-r', 'require "pay/cbk.php"; $c = cbk_config(); echo json_encode(["env" => $c["env"], "id" => $c["client_id"], "secret" => $c["client_secret"], "key" => $c["encrp_key"]]);'], { cwd: PUB, encoding: 'utf8' }))

const setsFile = PUB + '/pay/cbk-sets.php'
const setsOrig = readFileSync(setsFile, 'utf8')
if (process.env.MUTATE === 'borrow') writeFileSync(setsFile, setsOrig.replace("$env === 'production' ? $prod : ($test !== '' ? $test : $prod)", "($test !== '' ? $test : $prod)"))

const saved = sql("select value from settings where name = 'knet'")
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  sql('delete from rate_limit; delete from rate_bucket')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const api = async (route, data) => {
    const r = await ctx.request.fetch(`${BASE}/api/admin.php?r=${route}`, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data, failOnStatusCode: false })
    return { status: r.status(), j: await r.json().catch(() => ({})) }
  }
  check((await api('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })).status === 200, 'signed in to the panel')
  const save = (value) => api('settings_save', { name: 'knet', value })

  // --- one set only (the state before the split)
  sql("delete from settings where name = 'knet'")
  await save({ env: 'test', cbk_client_id: 'PRODID01', cbk_client_secret: 'PRODSECRET01', cbk_encrp_key: 'PRODKEY01' })
  let g = gateway()
  check(g.env === 'test' && g.id === 'PRODID01' && g.secret === 'PRODSECRET01', 'one set saved: Test mode borrows it, as before the split', `${g.env} ${g.id}`)

  // --- both sets
  await save({ cbk_test_client_id: 'TESTID01', cbk_test_client_secret: 'TESTSECRET01', cbk_test_encrp_key: 'TESTKEY01' })
  g = gateway()
  check(g.env === 'test' && g.id === 'TESTID01' && g.secret === 'TESTSECRET01' && g.key === 'TESTKEY01', 'Test mode uses the Test set', `${g.id}/${g.secret}/${g.key}`)
  await save({ env: 'production' })
  g = gateway()
  check(g.env === 'production' && g.id === 'PRODID01' && g.secret === 'PRODSECRET01' && g.key === 'PRODKEY01', 'Production uses the Production set', `${g.id}/${g.secret}/${g.key}`)

  // --- Production never borrows a Test value
  await save({ cbk_client_secret: '' })
  g = gateway()
  check(g.secret !== 'TESTSECRET01', 'Production with an empty field does NOT take the Test value', g.secret.slice(0, 14))
  const k1 = (await api('knet')).j
  check(k1.pay && k1.pay.env === 'production' && k1.pay.ready === false && k1.pay.sets.test.ready === true && k1.pay.sets.production.ready === false,
    'the panel reports both sets: Test complete, Production incomplete, Production in use', JSON.stringify(k1.pay && { env: k1.pay.env, sets: k1.pay.sets && { t: k1.pay.sets.test.ready, p: k1.pay.sets.production.ready } }))
  check(k1.cbk_test_client_id_set === true && !('cbk_test_client_id' in k1) && !JSON.stringify(k1).includes('TESTSECRET01'), 'the panel is told a Test value is saved, never the value')
  const ph = await save({ cbk_test_client_secret: 'YOUR_CLIENT_SECRET' })
  check(ph.j.error === 'placeholder_cbk_test_client_secret', 'a placeholder is refused in the Test fields', ph.j.error)
  const bad = await save({ cbk_test_client_id: 'has space' })
  check(bad.j.error === 'invalid_cbk_test_client_id', 'a value with a space is refused in the Test fields', bad.j.error)

  // --- the card
  await save({ env: 'test' })
  const p = await ctx.newPage()
  const dialogs = []
  p.on('dialog', (d) => { dialogs.push(d.type() + ':' + d.message().split('\n')[0]); d.dismiss() })
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.locator('aside').getByText('Payments', { exact: true }).first().click()
  await p.waitForSelector('.spk', { timeout: 8000 })
  await p.waitForTimeout(800)
  const text = await p.locator('.spk').innerText()
  check(/Test credentials — used in Test mode/.test(text) && /Production credentials — used in Production/.test(text), 'the card shows a Test group and a Production group')
  check(await p.locator('.spk input[type=password]').count() >= 8, 'with three fields in each', String(await p.locator('.spk input[type=password]').count()))
  check(/Test set \(pgtest\.cbk\.com\) — IN USE/.test(text) && /Production set/.test(text) && /Incomplete/.test(text), 'readiness for both sets, and which is in use')
  await p.locator('.spk-envswitch').click()
  await p.waitForTimeout(500)
  check(dialogs.some((d) => /^alert:The Production credentials are not complete/.test(d)) && (await api('knet')).j.env === 'test',
    'switching to Production is refused while the Production set is incomplete', dialogs.join(' | '))
  await save({ cbk_client_secret: 'PRODSECRET02' })
  await p.reload({ waitUntil: 'networkidle' }); await p.locator('aside').getByText('Payments', { exact: true }).first().click(); await p.waitForSelector('.spk'); await p.waitForTimeout(800)
  dialogs.length = 0
  await p.locator('.spk-envswitch').click()
  await p.waitForTimeout(500)
  check(dialogs.some((d) => /^confirm:Switch KNET and card payments to PRODUCTION/.test(d)), 'with the Production set complete it asks before going live', dialogs.join(' | '))
  await ctx.close()
} finally {
  writeFileSync(setsFile, setsOrig)
  if (saved) sql(`insert into settings (name, value) values ('knet', '${saved.replace(/'/g, "''")}') on duplicate key update value = values(value)`)
  else sql("delete from settings where name = 'knet'")
  sql('delete from rate_limit; delete from rate_bucket')
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — Test and Production each use their own credentials')
process.exit(fails ? 1 : 0)
