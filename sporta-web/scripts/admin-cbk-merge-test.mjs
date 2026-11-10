// The one-setup Payments screen (public/sporta-admin-brands.js, block 4 and the retargeted block 3): the CBK
// connection lives in the KNET editor, the T-Pay editor and its gateway card are hidden, and the CBK save goes
// through admin.php?r=payment_config with gateway "tpay".
//
//   npm run test:admin-cbk-merge     (no sandbox: the captured live Payments markup from scripts/fixtures/admin-payments.mjs,
//                                     the real add-on script, and a mocked admin API)
//
// Asserted: the T-Pay editor and card are hidden; the CBK card sits in the KNET editor after the identifiers card; the
// Merchant Server IP card follows it; every field is prefilled from the saved shape, secrets blank with their state
// shown; a save sends gateway "tpay" with the KNET environment and every field (a blank secret is sent blank, the server
// keeps the saved value); Enter saves; a refused save shows the message for its error code; a save that is accepted
// shows "Saved.".
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_HTML } from './fixtures/admin-payments.mjs'
const CHECKOUT_HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/sizes-admin/checkout.html'), 'utf8')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const ORIGIN = 'https://admin.test'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const pageOf = (body) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Backends</title></head>
<body><div id="root">${body}</div><script src="${ORIGIN}/addon.js"></script></body></html>`

// The saved shape the admin API answers with (no secret values, only their state).
const shape = (over = {}) => ({
  knet: { installed: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
          response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
          result_page_url: 'https://www.sporta.com.kw/payment/result', has_tranportal_id: true, has_tranportal_password: true, has_resource_key: true, credentials: {} },
  tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com/cbkgateway', production_base: 'https://pg.cbk.com/cbkgateway',
          return_url: 'https://www.sporta.com.kw/pay/return', result_page_url: 'https://www.sporta.com.kw/payment/result',
          has_client_id: true, has_client_secret: true, has_encrp_key: false, ...over },
})

async function run(scenario, body = BODY_HTML) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const saves = []
  let current = shape()
  await page.route(`${ORIGIN}/backends`, (r) => r.fulfill({ contentType: 'text/html', body: pageOf(body) }))
  await page.route(`${ORIGIN}/addon.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: ADDON }))
  await page.route(`${ORIGIN}/api/admin.php**`, async (r) => {
    const url = new URL(r.request().url())
    const route = url.searchParams.get('r')
    const method = r.request().method()
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (route === 'payment_config' && method === 'GET') {
      if (scenario.readFails) return json(500, { error: 'server_error' })
      return json(200, scenario.envNow ? { ...current, knet: { ...current.knet, env: scenario.envNow }, tpay: { ...current.tpay, ...(scenario.tpayNow || {}) } } : current)
    }
    if (route === 'payment_config' && method === 'POST') {
      const body = JSON.parse(r.request().postData() || '{}')
      saves.push(body)
      if (scenario.refuse) return json(409, { error: scenario.refuse })
      current = shape({ test_base: body.test_base, production_base: body.production_base, return_url: body.return_url,
        result_page_url: body.result_page_url, has_client_id: !!(body.client_id || current.tpay.has_client_id),
        has_client_secret: !!(body.client_secret || current.tpay.has_client_secret), has_encrp_key: !!(body.encrp_key || current.tpay.has_encrp_key) })
      return json(200, { gateway: 'tpay', config: current.tpay })
    }
    if (route === 'payment_identifiers') return json(200, { env: 'test', test: { merchant_id: '6261', terminal_id: '626101' }, production: { merchant_id: '', terminal_id: '' } })
    if (route === 'payment_server_ips') return json(200, { server_ip_1: '', server_ip_2: '' })
    if (route === 'payment_knet_via_cbk') return json(200, { enabled: false, tpay_ready: true })
    return json(404, { error: 'not_found' })
  })
  await page.goto(`${ORIGIN}/backends`)
  await page.waitForSelector('[data-sporta-cbk]', { timeout: 15000 }).catch(() => null)
  await page.waitForTimeout(300)
  return { browser, page, saves }
}

// ---------------------------------------------------------------- the placement and the hidden T-Pay editor
{
  const { browser, page } = await run({})
  head('placement')
  const tpayHidden = await page.evaluate(() => {
    const f = [...document.querySelectorAll('form.payment-gateway-editor')].find((x) => !x.querySelector('.payment-knet-toggle-row'))
    return !!f && f.getAttribute('data-sporta-tpay-retired') === '1' && getComputedStyle(f).display === 'none'
  })
  is(tpayHidden, 'the T-Pay editor is hidden')
  const cardHidden = await page.evaluate(() => {
    const c = [...document.querySelectorAll('section.payment-gateway-card')].find((x) => /^\s*T-Pay/.test((x.querySelector('.payment-gateway-card__head') || x).textContent || ''))
    return !!c && getComputedStyle(c).display === 'none'   // found AND hidden: a card the match misses must fail, not pass
  })
  is(cardHidden, 'the T-Pay gateway card is hidden')
  const order = await page.evaluate(() => {
    const knet = document.querySelector('form.payment-gateway-editor .payment-knet-toggle-row').closest('form')
    const kids = [...knet.querySelectorAll(':scope > *, :scope > * > *')]
    const ids = knet.querySelector('[data-sporta-knet-ids]'), cbk = knet.querySelector('[data-sporta-cbk]'), ip = knet.querySelector('[data-sporta-tpay-ips]')
    return { inKnet: !!cbk && knet.contains(cbk), idsBeforeCbk: !!ids && !!cbk && (ids.compareDocumentPosition(cbk) & 4) > 0,
             cbkBeforeIp: !!cbk && !!ip && (cbk.compareDocumentPosition(ip) & 4) > 0, ipInKnet: !!ip && knet.contains(ip) }
  })
  is(order.inKnet, 'the CBK connection card is inside the KNET editor')
  is(order.idsBeforeCbk, 'it comes after the Merchant ID / Terminal ID card')
  is(order.cbkBeforeIp, 'the Merchant Server IP card comes after it, in the KNET editor', JSON.stringify(order))
  is(order.ipInKnet, 'the Merchant Server IP card is inside the KNET editor')
  await browser.close()
}

// ---------------------------------------------------------------- prefill and the save body
{
  const { browser, page, saves } = await run({})
  head('fields and save')
  const vals = await page.evaluate(() => {
    const card = document.querySelector('[data-sporta-cbk]')
    const get = (label) => { const l = [...card.querySelectorAll('label')].find((x) => x.textContent.includes(label)); return l && l.querySelector('input') }
    const secretState = (label) => { const l = [...card.querySelectorAll('label')].find((x) => x.textContent.includes(label)); return l && (l.querySelector('.payment-secret-field__state') || {}).textContent }
    return {
      test_base: get('Test API base')?.value, production_base: get('Production API base')?.value,
      return_url: get('Return URL')?.value, client_secret: get('Client Secret')?.value, encrp: get('Encrypted Account Key')?.value,
      secretStateClient: secretState('Client Secret'), secretStateEncrp: secretState('Encrypted Account Key'),
      secretPlaceholder: get('Client Secret')?.placeholder,
    }
  })
  is(vals.test_base === 'https://pgtest.cbk.com/cbkgateway', 'the test API base is prefilled from the saved shape', vals.test_base)
  is(vals.production_base === 'https://pg.cbk.com/cbkgateway', 'the production API base is prefilled')
  is(vals.return_url === 'https://www.sporta.com.kw/pay/return', 'the return URL is prefilled')
  is(vals.client_secret === '', 'a saved secret is never shown back (the field is blank)')
  is(vals.secretStateClient === 'Saved' && vals.secretStateEncrp === 'Not set', 'secrets show Saved / Not set', `${vals.secretStateClient} / ${vals.secretStateEncrp}`)
  is(/keep the saved value/i.test(vals.secretPlaceholder || ''), 'a blank secret says it keeps the saved value')

  // a save: change one URL and the ENCRP key, leave the Client Secret blank
  await page.evaluate(() => {
    const card = document.querySelector('[data-sporta-cbk]')
    const set = (label, v) => { const l = [...card.querySelectorAll('label')].find((x) => x.textContent.includes(label)); l.querySelector('input').value = v }
    set('Encrypted Account Key', 'ENCRP-TEST-0001')
    set('result page URL', 'https://www.sporta.com.kw/payment/result2')
  })
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-sporta-cbk] button')].find((x) => /Save CBK/.test(x.textContent)); b.click() })
  await page.waitForTimeout(400)
  const body = saves[0] || {}
  is(body.gateway === 'tpay' && body.env === 'test', 'the save goes to gateway tpay in the KNET environment', JSON.stringify({ gateway: body.gateway, env: body.env }))
  is(body.encrp_key === 'ENCRP-TEST-0001' && body.client_secret === '', 'the changed key is sent and a blank secret is sent blank (the server keeps it)')
  is(body.result_page_url === 'https://www.sporta.com.kw/payment/result2' && body.return_url === 'https://www.sporta.com.kw/pay/return', 'every URL field is sent')
  const status = await page.evaluate(() => [...document.querySelectorAll('[data-sporta-cbk] p')].map((p) => p.textContent).find((t) => /Saved\.|Saving/.test(t)) || '')
  is(status === 'Saved.', 'an accepted save says Saved.', status)
  const encrpState = await page.evaluate(() => { const card = document.querySelector('[data-sporta-cbk]'); const l = [...card.querySelectorAll('label')].find((x) => x.textContent.includes('Encrypted Account Key')); return l.querySelector('.payment-secret-field__state').textContent })
  is(encrpState === 'Saved', 'after the save, the key shows Saved')
  await browser.close()
}

// ---------------------------------------------------------------- Enter saves; a refused save shows its message
{
  const { browser, page, saves } = await run({})
  head('enter and refusals')
  await page.evaluate(() => { const i = document.querySelector('[data-sporta-cbk] input[type=text]'); i.focus() })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  is(saves.length === 1, 'Enter in a field saves the CBK connection', `saves=${saves.length}`)
  await browser.close()
}
// ---------------------------------------------------------------- the environment changed after the card was built
// (review finding 1: the server sets the environment for BOTH gateways from the save, so a stale value would move
// the shop back to Test, or file production credentials under Test)
{
  const scenario = {}
  const { browser, page, saves } = await run(scenario)
  head('environment changed since the card was opened')
  scenario.envNow = 'production'; scenario.tpayNow = { return_url: 'https://www.sporta.com.kw/pay/return-prod' }
  await page.evaluate(() => {
    const card = document.querySelector('[data-sporta-cbk]')
    const l = [...card.querySelectorAll('label')].find((x) => x.textContent.includes('Encrypted Account Key')); l.querySelector('input').value = 'PROD-KEY-TYPED-FOR-TEST'
    ;[...card.querySelectorAll('button')].find((x) => /Save CBK/.test(x.textContent)).click()
  })
  await page.waitForTimeout(500)
  is(saves.length === 0, 'nothing is posted when the environment is no longer the one the card showed', `saves=${saves.length} ${JSON.stringify(saves[0] || {}).slice(0, 80)}`)
  const st = await page.evaluate(() => { const card = document.querySelector('[data-sporta-cbk]'); const l = [...card.querySelectorAll('label')].find((x) => x.textContent.includes('Encrypted Account Key')); return { msg: [...card.querySelectorAll('p')].map((p) => p.textContent).find((t) => /environment changed/i.test(t)) || '', key: l.querySelector('input').value, ret: [...card.querySelectorAll('input')].map((i) => i.value).includes('https://www.sporta.com.kw/pay/return-prod'), dis: [...card.querySelectorAll('button')].find((x) => /Save CBK/.test(x.textContent)).disabled } })
  is(/changed to Production/.test(st.msg) && /Nothing was saved/.test(st.msg), 'the card says the environment changed and nothing was saved', st.msg)
  is(st.key === '' && st.ret, 'the fields are reloaded with the current environment\'s values (the typed secret is cleared)', JSON.stringify(st))
  is(!st.dis, 'the save button is usable again')
  await page.evaluate(() => { const card = document.querySelector('[data-sporta-cbk]'); [...card.querySelectorAll('button')].find((x) => /Save CBK/.test(x.textContent)).click() })
  await page.waitForTimeout(500)
  is(saves.length === 1 && saves[0].env === 'production', 'the next save goes to the current environment', JSON.stringify({ n: saves.length, env: (saves[0] || {}).env }))
  await browser.close()
}
{
  const scenario = {}
  const { browser, page, saves } = await run(scenario)
  scenario.readFails = true
  await page.evaluate(() => { const card = document.querySelector('[data-sporta-cbk]'); [...card.querySelectorAll('button')].find((x) => /Save CBK/.test(x.textContent)).click() })
  await page.waitForTimeout(500)
  const msg = await page.evaluate(() => [...document.querySelectorAll('[data-sporta-cbk] p')].map((p) => p.textContent).find((t) => /Could not confirm/i.test(t)) || '')
  is(saves.length === 0 && /Nothing was saved/.test(msg), 'when the environment cannot be confirmed, nothing is posted and the card says so', `saves=${saves.length} ${msg}`)
  await browser.close()
}
{
  const { browser, page } = await run({ refuse: 'invalid_return_url' })
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-sporta-cbk] button')].find((x) => /Save CBK/.test(x.textContent)); b.click() })
  await page.waitForTimeout(400)
  const msg = await page.evaluate(() => [...document.querySelectorAll('[data-sporta-cbk] p')].map((p) => p.textContent).find((t) => /return URL/i.test(t)) || '')
  is(/return URL must be an https address on sporta\.com\.kw/.test(msg), 'a refused return URL shows its message', msg)
  await browser.close()
}

// ---------------------------------------------------------------- the Checkout screen: no T-Pay parts
{
  const { browser, page } = await run({}, CHECKOUT_HTML)
  head('checkout screen')
  const r = await page.evaluate(() => {
    const row = [...document.querySelectorAll('label.checkout-method-editor')].find((l) => (l.querySelector('strong') || {}).textContent === 'CBK T-Pay')
    const knet = [...document.querySelectorAll('label.checkout-method-editor')].find((l) => (l.querySelector('strong') || {}).textContent === 'KNET')
    const cod = [...document.querySelectorAll('label.checkout-method-editor')].find((l) => /Cash|cash/.test((l.querySelector('strong') || {}).textContent || ''))
    const opt = document.querySelector('select option[value="tpay"]')
    const chip = [...document.querySelectorAll('div.rounded-xl')].find((d) => !d.children.length && d.textContent.trim() === 'CBK T-Pay')
    return {
      rowHidden: !!row && getComputedStyle(row).display === 'none',
      optHidden: !!opt && opt.disabled && opt.hidden,
      chipHidden: !!chip && getComputedStyle(chip).display === 'none',
      knetVisible: !!knet && getComputedStyle(knet).display !== 'none',
      codVisible: !!cod ? getComputedStyle(cod).display !== 'none' : null,
      hadRow: !!row, hadOpt: !!opt, hadChip: !!chip,
    }
  })
  is(r.hadRow && r.rowHidden, 'the T-Pay on/off row on Checkout is hidden', JSON.stringify(r))
  is(r.hadOpt && r.optHidden, 'the T-Pay option in "Selected by default" is hidden and disabled', JSON.stringify(r))
  is(r.hadChip && r.chipHidden, 'the T-Pay chip in the order summary is hidden', JSON.stringify(r))
  is(r.knetVisible, 'the KNET row on Checkout stays visible')
  is(r.codVisible !== false, 'the cash row on Checkout stays visible')
  await browser.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
