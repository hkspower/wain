// "Remove any unneeded fields" (owner, 2026-11-12) on /backends: the PAYMENTS TRIM section of block 4 in
// public/sporta-admin-brands.js, on the captured live Payments markup (scripts/fixtures/admin-payments.mjs) and, for the
// product editor, the captured compiled "Add a product" form (scripts/fixtures/sizes-admin/catalogue-form.html).
//
//   npm run test:admin-trim       (no sandbox: Chromium, the real add-on file, a mocked admin API)
//
// What a field has to be to be hidden: it can hold only ONE value the server accepts (knet.php knet_assert_payment_config,
// admin.php payment_config, cbk.php), and the value it holds IS that value. Asserted:
//   1. KNET editor: Test / Production gateway URL, Response URL, Error URL and Customer result page are hidden when valid;
//      the Tranportal ID / password / resource key, the mode note and every add-on card stay; a read-only summary after the
//      field grid lists the five values.
//   2. CBK connection card: Test / Production API base, Return URL and Customer result page URL are hidden when valid; Client
//      ID, Client Secret and ENCRP_KEY stay; its own summary lists the four.
//   3. SAVING IS UNCHANGED: no hidden input is emptied or altered; the compiled editor's save (emulated: it reads every field)
//      sends the five KNET values exactly; the CBK save sends the four hidden values exactly as loaded.
//   4. A WRONG value is never hidden: www.kpay.com.kw (the admin allowlist refuses it), a callback on another path, an empty
//      field, a CBK return URL that is not /pay/callback.php: each stays a field and the summary names it with the expected
//      value. A field being typed into, or one that was wrong, does not vanish when it becomes right.
//   5. "Show fields" puts every hidden field back; "Hide fields" folds them again.
//   6. Idle: once settled the block changes nothing (zero mutation records over a second).
//   7. The product editor: every field of the compiled form is read by product_save (checked against the PHP source here)
//      and nothing in it is hidden.
//   8. Mutation check: the same assertions fail with the trim call removed, and with the value check made permissive.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_HTML } from './fixtures/admin-payments.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const ADMIN_PHP = readFileSync(join(ROOT, 'dropin/php-store/admin.php'), 'utf8')
const KNET_PHP = readFileSync(join(ROOT, 'dropin/php-knet/knet.php'), 'utf8')
const CATALOGUE_FORM = readFileSync(join(ROOT, 'scripts/fixtures/sizes-admin/catalogue-form.html'), 'utf8')
const ORIGIN = 'https://admin.test'

const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// The fixture as captured, except the production gateway URL, which the capture has as www.kpay.com.kw (made-up data that the
// live admin.php would refuse: its allowlist is kpay.com.kw only). VALID_BODY is the screen with every address right.
const VALID_BODY = BODY_HTML.replace('https://www.kpay.com.kw/kpg/PaymentHTTP.htm', 'https://kpay.com.kw/kpg/PaymentHTTP.htm')
const BAD_BODY = BODY_HTML
  .replace('value="https://www.sporta.com.kw/knet/callback.php"', 'value="https://www.sporta.com.kw/knet/result.php"')   // Response URL: wrong path

const KNET_FIXED = ['Test gateway URL', 'Production gateway URL', 'Response URL', 'Error URL', 'Customer result page']
const CBK_FIXED = ['Test API base URL', 'Production API base URL', 'Return URL (on sporta.com.kw)', 'Customer result page URL']
const CBK_OK = { test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com', return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result' }

const shape = (tpay = {}) => ({
  knet: { installed: true, env: 'test', credentials: {} },
  tpay: { installed: true, env: 'test', ...CBK_OK, has_client_id: true, has_client_secret: true, has_encrp_key: true, ...tpay },
})

// The compiled KNET editor's save, emulated: like the real one it sends what every field of its grid holds (the real one reads
// React state; a hidden field's state is the same as its value, which is the point being proved).
const EMULATE_SAVE = `
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('button')
  if (!b || !/^Save KNET$/.test(b.textContent.trim())) return
  var form = b.closest('form'), out = { gateway: 'knet' }
  form.querySelectorAll(':scope > .grid label').forEach(function (l) { var s = l.querySelector('span'), i = l.querySelector('input'); if (s && i) out[s.firstChild.textContent.trim()] = i.value })
  fetch('/api/admin.php?r=payment_config', { method: 'POST', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(out) })
})`

const pageOf = (body) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Backends</title></head>
<body><div id="root">${body}</div><script>${EMULATE_SAVE}</script><script src="${ORIGIN}/addon.js"></script></body></html>`

async function open(browser, { body = VALID_BODY, tpay = {}, addon = ADDON } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const saves = []
  await page.route(`${ORIGIN}/backends`, (r) => r.fulfill({ contentType: 'text/html', body: pageOf(body) }))
  await page.route(`${ORIGIN}/addon.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: addon }))
  await page.route(`${ORIGIN}/api/admin.php**`, async (r) => {
    const route = new URL(r.request().url()).searchParams.get('r'), method = r.request().method()
    const json = (status, b) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (route === 'payment_config' && method === 'GET') return json(200, shape(tpay))
    if (route === 'payment_config') { const b = JSON.parse(r.request().postData() || '{}'); saves.push(b); return json(200, { gateway: b.gateway, config: shape(tpay)[b.gateway === 'knet' ? 'knet' : 'tpay'] }) }
    if (route === 'payment_identifiers') return json(200, { env: 'test', test: { merchant_id: '', terminal_id: '' }, production: { merchant_id: '', terminal_id: '' } })
    if (route === 'payment_server_ips') return json(200, { server_ip_1: '', server_ip_2: '' })
    if (route === 'payment_knet_via_cbk') return json(200, { enabled: false })
    return json(404, { error: 'not_found' })
  })
  await page.goto(`${ORIGIN}/backends`)
  await page.waitForSelector('[data-sporta-cbk]', { timeout: 10000 }).catch(() => null)
  await page.waitForTimeout(250)
  return { page, saves }
}

// Field state by caption: shown (laid out), value. KNET captions are read outside every add-on card; CBK ones inside its card.
const fields = (page) => page.evaluate(() => {
  const knet = document.querySelector('form.payment-gateway-editor .payment-knet-toggle-row').closest('form')
  const read = (labels) => Object.fromEntries(labels.map((l) => { const s = l.querySelector('span'), i = l.querySelector('input'); return [s.firstChild.textContent.trim(), { shown: !!(l.offsetWidth || l.offsetHeight), value: i.value }] }))
  const own = [...knet.querySelectorAll('label')].filter((l) => !l.closest('[data-sporta-knet-ids],[data-sporta-tpay-ips],[data-sporta-cbk],[data-sporta-fixed]') && l.querySelector('span') && l.querySelector('input'))
  const cbk = [...knet.querySelectorAll('[data-sporta-cbk] label')]
  const sum = (g) => { const b = knet.querySelector(`[data-sporta-fixed="${g}"]`); return b ? { text: b.textContent, shown: !!(b.offsetWidth || b.offsetHeight), afterGrid: g === 'knet' ? b.previousElementSibling === knet.querySelector(':scope > .grid') : b.previousElementSibling === b.parentNode.querySelector(':scope > .grid') } : null }
  return { knet: read(own), cbk: read(cbk), sumKnet: sum('knet'), sumCbk: sum('cbk'), cards: ['data-sporta-knet-ids', 'data-sporta-cbk', 'data-sporta-tpay-ips'].map((a) => { const n = knet.querySelector(`[${a}]`); return !!n && !!(n.offsetWidth || n.offsetHeight) }) }
})

async function suite(addon, label, quiet) {
  let pass = 0, fail = 0
  const is = (ok, msg, detail = '') => { if (ok) pass++; else fail++; if (!quiet) console.log((ok ? 'ok   ' : 'FAIL ') + msg + (!ok && detail ? '  — ' + detail : '')) }
  const h = (t) => { if (!quiet) head(t) }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  try {
    // ------------------------------------------------------------ 1-3: every address right
    {
      const { page, saves } = await open(browser, { addon })
      h(`${label}: KNET editor, every address right`)
      const f = await fields(page)
      for (const c of KNET_FIXED) is(f.knet[c] && !f.knet[c].shown, `"${c}" is hidden`, JSON.stringify(f.knet[c]))
      for (const c of ['Test Tranportal ID', 'Test Tranportal password', 'Test Terminal Resource Key']) is(f.knet[c] && f.knet[c].shown, `"${c}" stays a field`)
      is(await page.evaluate(() => { const p = document.querySelector('form .grid > p.md\\:col-span-2'); return !!p && !!p.offsetHeight }), 'the Test / Production mode note stays')
      is(f.cards.every(Boolean), 'the Merchant ID, CBK connection and Merchant Server IP cards all stay', JSON.stringify(f.cards))
      is(f.sumKnet && f.sumKnet.shown && f.sumKnet.afterGrid, 'a read-only KNET summary sits right after the field grid', JSON.stringify(f.sumKnet))
      is(f.sumKnet && ['https://kpaytest.com.kw/kpg/PaymentHTTP.htm', 'https://kpay.com.kw/kpg/PaymentHTTP.htm', 'https://www.sporta.com.kw/knet/callback.php', 'https://www.sporta.com.kw/payment-result'].every((v) => f.sumKnet.text.includes(v)) && !/is shown as a field/.test(f.sumKnet.text), 'it lists the five values, and no warning', f.sumKnet && f.sumKnet.text.slice(0, 200))
      is(f.knet['Test gateway URL'].value === 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm' && f.knet['Production gateway URL'].value === 'https://kpay.com.kw/kpg/PaymentHTTP.htm' && f.knet['Response URL'].value === 'https://www.sporta.com.kw/knet/callback.php' && f.knet['Customer result page'].value === 'https://www.sporta.com.kw/payment-result', 'no hidden KNET input was emptied or changed')

      h(`${label}: CBK connection, every address right`)
      for (const c of CBK_FIXED) is(f.cbk[c] && !f.cbk[c].shown, `"${c}" is hidden`, JSON.stringify(f.cbk[c]))
      for (const c of ['Client ID (ClientId)', 'Client Secret (ClientSecret)', 'Encrypted Account Key (ENCRP_KEY)']) is(f.cbk[c] && f.cbk[c].shown, `"${c}" stays a field`)
      is(f.sumCbk && f.sumCbk.shown && f.sumCbk.afterGrid && Object.values(CBK_OK).every((v) => f.sumCbk.text.includes(v)), 'the CBK card has its own summary after its grid, with the four values', JSON.stringify(f.sumCbk).slice(0, 200))

      h(`${label}: saving is unchanged`)
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save KNET').click())
      await page.waitForTimeout(200)
      const k = saves.find((s) => s.gateway === 'knet') || {}
      is(k['Test gateway URL'] === 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm' && k['Production gateway URL'] === 'https://kpay.com.kw/kpg/PaymentHTTP.htm' && k['Response URL'] === 'https://www.sporta.com.kw/knet/callback.php' && k['Error URL'] === 'https://www.sporta.com.kw/knet/callback.php' && k['Customer result page'] === 'https://www.sporta.com.kw/payment-result', 'the KNET save sends every hidden value exactly', JSON.stringify(k).slice(0, 240))
      await page.evaluate(() => [...document.querySelectorAll('[data-sporta-cbk] button')].find((b) => /Save CBK/.test(b.textContent)).click())
      await page.waitForTimeout(400)
      const c = saves.find((s) => s.gateway === 'tpay') || {}
      is(Object.entries(CBK_OK).every(([key, v]) => c[key] === v) && c.env === 'test', 'the CBK save sends the four hidden values exactly as loaded', JSON.stringify(c).slice(0, 240))
      const after = await fields(page)
      is(CBK_FIXED.every((x) => after.cbk[x] && !after.cbk[x].shown), 'after the CBK save the four stay hidden')

      h(`${label}: idle and the Show fields toggle`)
      const records = await page.evaluate(() => new Promise((res) => { let n = 0; const o = new MutationObserver((m) => { n += m.length }); o.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); setTimeout(() => { o.disconnect(); res(n) }, 1000) }))
      is(records === 0, 'settled: the block changes nothing (zero mutation records in a second)', `records=${records}`)
      await page.evaluate(() => [...document.querySelectorAll('[data-sporta-fixed="knet"] button')][0].click())
      await page.waitForTimeout(150)
      const shown = await fields(page)
      is(KNET_FIXED.every((x) => shown.knet[x].shown) && CBK_FIXED.every((x) => !shown.cbk[x].shown), '"Show fields" puts the five KNET fields back (the CBK group keeps its own toggle)')
      is(await page.evaluate(() => document.querySelector('[data-sporta-fixed="knet"] button').textContent === 'Hide fields'), 'the button then says Hide fields')
      await page.evaluate(() => document.querySelector('[data-sporta-fixed="knet"] button').click())
      await page.waitForTimeout(150)
      const folded = await fields(page)
      is(KNET_FIXED.every((x) => !folded.knet[x].shown), '"Hide fields" folds them again')
      await page.close()
    }

    // ------------------------------------------------------------ 4: wrong values stay fields
    {
      const { page } = await open(browser, { body: BAD_BODY, tpay: { return_url: 'https://www.sporta.com.kw/pay/return', production_base: '' }, addon })
      h(`${label}: a wrong value is never hidden`)
      const f = await fields(page)
      is(f.knet['Production gateway URL'].shown, 'www.kpay.com.kw (refused by the admin allowlist) stays a field')
      is(f.knet['Response URL'].shown, 'a Response URL on another path stays a field')
      is(!f.knet['Error URL'].shown && !f.knet['Test gateway URL'].shown, 'the right ones next to them are still hidden')
      is(f.sumKnet && /Production gateway URL is shown as a field above: it is not https:\/\/kpay\.com\.kw\/kpg\/PaymentHTTP\.htm/.test(f.sumKnet.text) && /Response URL is shown as a field above/.test(f.sumKnet.text), 'the summary names each one with the expected value', f.sumKnet && f.sumKnet.text.slice(0, 300))
      is(f.cbk['Return URL (on sporta.com.kw)'].shown && f.cbk['Production API base URL'].shown, 'a CBK return URL that is not /pay/callback.php, and an empty production base, stay fields')
      is(f.sumCbk && /Production API base URL is shown as a field above: it is empty and should be https:\/\/pg\.cbk\.com/.test(f.sumCbk.text), 'an empty one is reported as empty', f.sumCbk && f.sumCbk.text.slice(0, 300))
      // type the right value into the wrong one: it stays where the cursor is
      await page.evaluate(() => { const l = [...document.querySelectorAll('[data-sporta-cbk] label')].find((x) => /^Return URL/.test(x.textContent)); const i = l.querySelector('input'); i.focus(); i.value = 'https://www.sporta.com.kw/pay/callback.php'; i.dispatchEvent(new Event('input', { bubbles: true })) })
      await page.waitForTimeout(150)
      await page.evaluate(() => document.activeElement.blur())
      await page.waitForTimeout(150)
      is((await fields(page)).cbk['Return URL (on sporta.com.kw)'].shown, 'a field that was wrong does not vanish when it is corrected')
      await page.close()
    }

    // ------------------------------------------------------------ 7: the product editor
    {
      h(`${label}: product editor`)
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const body = CATALOGUE_FORM.replace(/^[\s\S]*?<div id="root">/, '').replace(/<!--[\s\S]*?-->/g, '')
      await page.route(`${ORIGIN}/backends`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root">${body}<script src="${ORIGIN}/addon.js"></script></body></html>` }))
      await page.route(`${ORIGIN}/addon.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: addon }))
      await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }))
      await page.goto(`${ORIGIN}/backends`)
      await page.waitForTimeout(400)
      const r = await page.evaluate(() => {
        const f = document.querySelector('form.admin-editor-modal')
        const cap = [...f.querySelectorAll('label')].map((l) => ({ t: (l.querySelector('span') || l).textContent.trim().split('\n')[0], shown: !!(l.offsetWidth || l.offsetHeight) }))
        return { n: cap.length, hidden: cap.filter((c) => !c.shown).map((c) => c.t), marked: f.querySelectorAll('[data-sporta-fixed-hidden]').length }
      })
      is(r.n >= 14 && r.hidden.length === 0 && r.marked === 0, `nothing in the product editor is hidden (${r.n} fields)`, JSON.stringify(r))
      await page.close()
    }
  } catch (e) {
    is(false, 'the suite ran to the end', String(e).split('\n')[0].slice(0, 160))   // a mutant that breaks a step is caught, not a crash
  } finally { await browser.close() }
  return { pass, fail }
}

// ------------------------------------------------------------ static: what the server reads
let spass = 0, sfail = 0
const sis = (ok, msg) => { if (ok) spass++; else sfail++; console.log((ok ? 'ok   ' : 'FAIL ') + msg) }
head('static: the server is the authority for every hidden value')
sis(/\$next\['test_url'\] = \$url\(\$body\['test_url'\] \?\? '', \['kpaytest\.com\.kw'\]/.test(ADMIN_PHP) && /\$next\['production_url'\] = \$url\(\$body\['production_url'\] \?\? '', \['kpay\.com\.kw'\]/.test(ADMIN_PHP), 'admin.php pins the KNET gateway hosts to kpaytest.com.kw / kpay.com.kw')
sis(/selectedPath !== '\/kpg\/PaymentHTTP\.htm'/.test(KNET_PHP), 'knet.php refuses any gateway path but /kpg/PaymentHTTP.htm')
sis(/\['pgtest\.cbk\.com'\], 'test_base'/.test(ADMIN_PHP) && /\['pg\.cbk\.com'\], 'production_base'/.test(ADMIN_PHP), 'admin.php pins the CBK API hosts')
sis(/'response_url' =>\s*\$cfg\['response_url'\]|responseURL'\s*=> \$cfg\['response_url'\]/.test(readFileSync(join(ROOT, 'dropin/php-knet/pay.php'), 'utf8')), 'pay.php sends response_url / error_url to the bank (they exist, they are just fixed)')
head('static: the product editor fields are all read by product_save')
{
  const save = ADMIN_PHP.slice(ADMIN_PHP.indexOf("if ($r === 'product_save'"), ADMIN_PHP.indexOf("if ($r === 'product_active'"))
  const keys = ['slug', 'name_en', 'name_ar', 'price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'featured', 'featured_sort', 'category', 'brand_slug', 'desc_en', 'desc_ar', 'image', 'images', 'active']
  const missing = keys.filter((k) => !save.includes(`$b['${k}']`) && !save.includes(`'${k}'`) && !save.includes(`$b[$key]`))
  sis(missing.length === 0, `product_save reads every field the compiled form has (${keys.length}): nothing there is ignored`)
}

const real = await suite(ADDON, 'real file', false)

head('mutation checks (each must FAIL)')
const noCall = ADDON.replace(/\n    trimFixed\(\)\n/, '\n')
const permissive = ADDON.replace(/function fixedOk\(value, rule\) \{\n/, 'function fixedOk(value, rule) {\n    return true\n')
let mut = 0
for (const [name, src] of [['the trim call removed', noCall], ['the value check permissive', permissive]]) {
  if (src === ADDON) { console.log('FAIL mutation did not apply: ' + name); mut++; continue }
  const r = await suite(src, name, true)
  const caught = r.fail > 0
  console.log((caught ? 'ok   ' : 'FAIL ') + `mutant "${name}" is caught (${r.fail} assertion(s) fail)`)
  if (!caught) mut++
}

const P = spass + real.pass + (2 - mut), F = sfail + real.fail + mut
console.log(`\n${P} passed, ${F} failed`)
process.exit(F ? 1 : 0)
