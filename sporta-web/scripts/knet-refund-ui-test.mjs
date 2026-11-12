// The ADMIN KNET REFUNDS block of public/sporta-admin-brands.js on the CAPTURED live admin (scripts/fixtures/admin-css-full/
// orders-sheet.html: the compiled Orders screen with an order drawer open, its real markup and rules), the admin routes
// mocked (the server side is proved by scripts/knet-refund-test.mjs).
//
//   npm run test:knet-refund-ui   (rig-free: a real Chromium, no PHP)
//
//   1. a server WITHOUT the routes (the live admin.php today answers 404 not_found): one probe, nothing added, nothing more sent;
//   2. with them: the drawer gets a "KNET payment" section with the bank fields, the refunds and the second charges; the Orders
//      screen gets the "KNET checks" panel (open second charges, the reconciliation export); every value is text, never markup;
//   3. the form: nothing is sent without the KPay confirmation tick; the Payment ID and the amount are what was TYPED (nothing
//      is pre-filled from the order); a double click sends ONE request; a lost answer and a second press send the SAME
//      request key (so the server records it once); a refusal is a sentence; Void is offered only when the server allows it;
//   4. Dismiss and the CSV download send what the server expects;
//   5. a cash order's drawer is asked about once and shows nothing; a refunded order with an open second charge keeps the form;
//   6. MUTATIONS: the busy guard removed, a new key on every press, the order's Payment ID pre-filled, the probe ignored, the
//      non-KNET section removed: each must fail.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed } from './lib/admin-css-full-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const ORIGIN = 'https://www.sporta.com.kw'
let pass = 0, fail = 0, quiet = false, quietFails = 0
const is = (ok, msg, detail = '') => {
  if (quiet) { if (!ok) quietFails++; return ok }
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
  return ok
}
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())

const VIEW = (over = {}) => ({
  ready: true,
  order: { id: 1000, track_id: 'SPTEST1000', payment_method: 'knet', payment_status: 'paid', fulfilment_status: 'packed', amount: '21.000', refunded_amount: '0.000',
    remaining: '21.000', paid_at: '2026-10-30 07:20:00', paid_at_kuwait: '2026-10-30 10:20', payment_id: '100202616112345678', transaction_id: '8765432109',
    reference: '901234567890', auth_code: 'B35434', bank_result: 'CAPTURED', record: 'CAPTURED', attempts: 2, gateway_track_id: 'SPTEST1000A2',
    attempt_refs: ['SPTEST1000', 'SPTEST1000A2'], shipped: false, ...(over.order || {}) },
  refunds: over.refunds || [],
  alerts: over.alerts || [{ id: 7, order_id: 1000, kind: 'duplicate_capture', payment_id: '<img src=x onerror=alert(1)>', order_payment_id: '100202616112345678', amount: '21.000', resolution: null, created_at: '2026-10-30 07:25:00' }],
  actions: { refund: true, partial: true, void: true, why: null, open_alerts: 1, ...(over.actions || {}) },
})
const ALERTS = { ready: true, open: 1, alerts: [{ id: 7, order_id: 1000, track_id: 'SPTEST1000', payment_id: '100202777001', amount: '21.000', created_at: '2026-10-30 07:25:00', resolution: null }] }

async function open({ js = SRC, present = true, view = VIEW(), record = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const calls = []
  const errors = []
  await ctx.route(ORIGIN + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.pathname.startsWith('/backends')) return route.fulfill({ status: 200, contentType: 'text/html', body: fixturePage('orders-sheet', FILES) })
    if (u.pathname === '/api/admin.php') {
      const r = u.searchParams.get('r')
      const body = req.postData() ? JSON.parse(req.postData()) : null
      calls.push({ r, search: u.search, body, admin: req.headers()['x-sporta-admin'] })
      if (!present) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      if (r === 'payment_alerts') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS) })
      if (r === 'knet_payment_record') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) })
      if (r === 'knet_refund_record') {
        const a = typeof record === 'function' ? record(body, calls.filter((c) => c.r === 'knet_refund_record').length) : null
        if (a === 'abort') return route.abort()
        if (a && a.status) return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) })
        await new Promise((res) => setTimeout(res, 250))   // a request that takes a moment, so a double click lands while it is out
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, replayed: false, refund_id: 1, ...VIEW({ order: { payment_status: 'refunded', fulfilment_status: 'cancelled', refunded_amount: '21.000', remaining: '0.000' }, actions: { refund: false, void: false, why: 'order_already_refunded' } }) }) })
      }
      if (r === 'payment_alert_dismiss') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS) })
      if (r === 'knet_reconcile_export') return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="x.csv"' }, body: '\uFEFF"Order (track id)"\r\n"SPTEST1000"\r\n' })
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  })
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await pg.goto(ORIGIN + '/backends/orders')
  await pg.addScriptTag({ content: js })
  pg.__ctx = ctx; pg.__calls = calls; pg.__errors = errors
  return pg
}
const sec = (pg) => pg.locator('[data-sporta-knet-refund]')
const panel = (pg) => pg.locator('[data-sporta-knet-orders]')

async function suite(js = SRC) {
  head('1. a server without the routes')
  {
    const pg = await open({ js, present: false })
    await pg.waitForTimeout(1500)
    await pg.mouse.click(5, 5)   // a click, as the owner's would be: another scan
    await pg.waitForTimeout(1500)
    is(await sec(pg).count() === 0 && await panel(pg).count() === 0, 'nothing is added to the drawer or the Orders screen')
    const mine = pg.__calls.filter((c) => /^(payment_alert|knet_)/.test(c.r))   // the other blocks ask their own routes
    is(mine.length === 1 && mine[0].r === 'payment_alerts' && mine[0].admin === '1', 'ONE probe was sent (with X-Sporta-Admin), and nothing after the 404', mine.map((c) => c.r).join(','))
    await pg.__ctx.close()
  }

  head('2. the drawer section and the Orders panel')
  const pg = await open({ js })
  await sec(pg).first().waitFor({ timeout: 6000 }).catch(() => null)
  await panel(pg).first().waitFor({ timeout: 6000 }).catch(() => null)
  const text = await sec(pg).innerText().catch(() => '')
  is(/Payment ID\s*100202616112345678/.test(text) && /Transaction ID\s*8765432109/.test(text) && /Reference\s*901234567890/.test(text)
    && /Auth code\s*B35434/.test(text) && /Answered under\s*SPTEST1000A2/.test(text) && /Sent to KNET as\s*SPTEST1000, SPTEST1000A2/.test(text) && /Paid \(Kuwait time\)\s*2026-10-30 10:20/.test(text),
    'the drawer shows what KPay will show: Payment ID, Transaction ID, reference, auth code, the Track IDs, the paid time in Kuwait time', text.slice(0, 200))
  is(await pg.locator('aside[aria-label="Order SPTEST1000"] [data-sporta-knet-refund="SPTEST1000"]').count() === 1, 'inside the drawer of that order, once')
  is(await sec(pg).locator('img').count() === 0 && text.includes('<img src=x onerror=alert(1)>'), 'a Payment ID holding markup is shown as text, never as an element')
  const ptext = await panel(pg).innerText().catch(() => '')
  is(/1 order has a second KNET charge/.test(ptext) && ptext.includes('SPTEST1000') && ptext.includes('100202777001'), 'the Orders screen lists the open second charge with its order number', ptext.slice(0, 160))
  is(await pg.locator('header.admin-page-header + [data-sporta-knet-orders]').count() === 1, 'the panel sits right under the Orders header')
  is(await sec(pg).locator('input[type=text]').first().inputValue() === '', 'the Payment ID box starts EMPTY (typed from KPay, never filled in)')

  head('3. the form')
  const before = pg.__calls.filter((c) => c.r === 'knet_refund_record').length
  const inputs = sec(pg).locator('.skr-form input[type=text]')
  await inputs.nth(0).fill('100202616112345678')
  await inputs.nth(1).fill('21.000')
  await sec(pg).locator('button.skr-btn--main').click()
  await pg.waitForTimeout(200)
  is(pg.__calls.filter((c) => c.r === 'knet_refund_record').length === before && /Tick the box/.test(await sec(pg).innerText()), 'without the KPay confirmation tick nothing is sent')
  await sec(pg).locator('.skr-check input').check()
  const btn = sec(pg).locator('button.skr-btn--main')
  await btn.click()
  await btn.click({ force: true }).catch(() => null)
  await btn.click({ force: true }).catch(() => null)
  await pg.waitForTimeout(800)
  const posts = pg.__calls.filter((c) => c.r === 'knet_refund_record')
  is(posts.length === 1, 'three quick presses send ONE request', String(posts.length))
  const b = posts[0]?.body || {}
  is(b.order_id === 1000 && b.kind === 'refund' && b.payment_id === '100202616112345678' && b.amount === '21.000' && /^[a-f0-9]{32}$/.test(b.request_key || ''),
    'it sends the order, the kind, the TYPED Payment ID and amount, and a request key', JSON.stringify(b))
  is(/Recorded\. The order is now refunded, cancelled; the warehouse is told not to ship it/.test(await sec(pg).innerText()), 'the answer says what happened to the order')
  is(pg.__errors.length === 0, 'no page error', pg.__errors.join(' | '))

  head('4. dismiss and the export')
  {
    const p2 = await open({ js })
    await sec(p2).first().waitFor({ timeout: 6000 }).catch(() => null)
    await sec(p2).locator('button', { hasText: 'Dismiss' }).click()
    await p2.waitForTimeout(400)
    const d = p2.__calls.find((c) => c.r === 'payment_alert_dismiss')
    is(d && d.body && d.body.alert_id === 7, 'Dismiss sends the alert id', JSON.stringify(d && d.body))
    await panel(p2).first().waitFor({ timeout: 6000 }).catch(() => null)
    // the captured screen has the order drawer open over the list, so the button is pressed the way a keyboard would
    const [dl] = await Promise.all([p2.waitForEvent('download', { timeout: 5000 }).catch(() => null), panel(p2).locator('button', { hasText: 'Download CSV' }).evaluate((b) => b.click())])
    const ex = p2.__calls.find((c) => c.r === 'knet_reconcile_export')
    is(ex && /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&tz=kuwait/.test(ex.search) && ex.admin === '1', 'Download CSV asks for the range in Kuwait days, with X-Sporta-Admin', ex && ex.search)
    is(!!dl && /^knet-reconcile-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), 'and the browser saves the CSV', dl && dl.suggestedFilename())
    await p2.__ctx.close()
  }

  head('5. a lost answer, a refusal, Void not allowed')
  {
    const p3 = await open({ js, record: (body, n) => (n === 1 ? 'abort' : { status: 409, body: { error: 'refund_exceeds_payment' } }) })
    await sec(p3).first().waitFor({ timeout: 6000 }).catch(() => null)
    const ins = sec(p3).locator('.skr-form input[type=text]')
    await ins.nth(0).fill('100202616112345678'); await ins.nth(1).fill('5.000')
    await sec(p3).locator('.skr-check input').check()
    await sec(p3).locator('button.skr-btn--main').click(); await p3.waitForTimeout(500)
    is(/Could not reach the server.*the same submission is sent/.test(await sec(p3).innerText()), 'a lost answer says so, and that pressing again is safe')
    await sec(p3).locator('button.skr-btn--main').click(); await p3.waitForTimeout(500)
    const ps = p3.__calls.filter((c) => c.r === 'knet_refund_record')
    is(ps.length === 2 && ps[0].body.request_key === ps[1].body.request_key, 'the second press sends the SAME request key (the server records it once)', ps.map((c) => c.body.request_key).join(' '))
    is(/more than is left to refund/.test(await sec(p3).innerText()), 'a refusal token is a sentence')
    await p3.__ctx.close()
    const p4 = await open({ js, view: VIEW({ order: { refunded_amount: '5.000', remaining: '16.000' }, actions: { void: false }, alerts: [] }) })
    await sec(p4).first().waitFor({ timeout: 6000 }).catch(() => null)
    is(await sec(p4).locator('input[type=radio][value=void]').isDisabled(), 'Void is not offered once a refund is recorded (the server says void=false)')
    is(/Refunded\s*5\.000 KWD/.test(await sec(p4).innerText()) && /Left\s*16\.000 KWD/.test(await sec(p4).innerText()), 'and the drawer shows what was refunded and what is left')
    await p4.__ctx.close()
  }

  head('6. a cash order; a refunded order with an open second charge')
  {
    // review 3, finding 1: a non-KNET drawer is asked about ONCE, however many clicks follow, and nothing flashes
    const pc = await open({ js, view: VIEW({ order: { payment_method: 'cod', payment_status: 'pending' }, alerts: [], actions: { refund: false, void: false, why: 'not_a_knet_order' } }) })
    await pc.waitForTimeout(1500)
    for (let i = 0; i < 4; i++) { await pc.mouse.click(5, 5 + i); await pc.waitForTimeout(300) }
    await pc.keyboard.press('Enter'); await pc.waitForTimeout(1600)
    const asks = pc.__calls.filter((c) => c.r === 'knet_payment_record').length
    const shown = await pc.evaluate(() => [...document.querySelectorAll('[data-sporta-knet-refund]')].map((n) => [n.hidden, n.textContent.length]))
    is(asks === 1 && shown.length === 1 && shown[0][0] === true && shown[0][1] === 0,
      'a cash order\'s drawer: ONE knet_payment_record after five clicks and a key press, and the section stays hidden and empty (no "Loading" flash)', `asks=${asks} ${JSON.stringify(shown)}`)
    await pc.__ctx.close()
    // review 1, finding 2: the order's own payment refunded, a second charge still open: the form is offered for it
    const pr = await open({ js, view: VIEW({ order: { payment_status: 'refunded', fulfilment_status: 'cancelled', refunded_amount: '21.000', remaining: '0.000' },
      alerts: [{ id: 8, order_id: 1000, kind: 'duplicate_capture', payment_id: '100202777011', order_payment_id: '100202616112345678', amount: '21.000', resolution: null }],
      actions: { refund: true, partial: false, void: true, why: 'order_already_refunded', open_alerts: 1 } }) })
    await sec(pr).first().waitFor({ timeout: 6000 }).catch(() => null)
    const has = await sec(pr).locator('.skr-form').count()
    await sec(pr).locator('button', { hasText: 'Whole amount' }).click().catch(() => null)
    const filled = await sec(pr).locator('.skr-form input[type=text]').nth(1).inputValue().catch(() => '')
    is(has === 1 && filled === '21.000', 'a refunded order with an open second charge still offers the form, and "Whole amount" is the second charge\'s', `${has} "${filled}"`)
    await pr.__ctx.close()
  }
  await pg.__ctx.close()
}

await suite()

head('7. mutations: each must make the suite fail')
const MUT = [
  // both guards (the busy flag and the disabled button): either one alone stops a double press
  ['the double-press guards removed', SRC.replace("      if (busy) return\n      clear(msg)\n", '      clear(msg)\n').replace("      busy = true; submit.disabled = true\n      call('knet_refund_record'", "      busy = true\n      call('knet_refund_record'")],
  ['a new request key on every press', SRC.replace("        order_id: o.id, kind: kindNow(), payment_id: pid.value.trim(), amount: amt.value.trim(),", "        order_id: o.id, kind: kindNow(), payment_id: pid.value.trim(), amount: amt.value.trim(), _k: (reqKey = key()),")],
  ["the order's Payment ID filled in", SRC.replace("pid.type = 'text'; pid.autocomplete = 'off';", "pid.type = 'text'; pid.value = clean(o.payment_id, 60); pid.autocomplete = 'off';")],
  ['the probe ignored (always present)', SRC.replace("      probe = r.status === 404 ? 'absent' : 'present'", "      probe = 'present'")],
  ['a non-KNET section removed (re-fetched on every click)', SRC.replace("if (!o || o.payment_method !== 'knet') { s.hidden = true; s.removeAttribute('aria-label'); s.className = ''; return }", "if (!o || o.payment_method !== 'knet') { s.parentNode && s.parentNode.removeChild(s); return }")],
]
for (const [name, js] of MUT) {
  if (js === SRC) { is(false, `mutant "${name}" applies`); continue }
  quiet = true; quietFails = 0
  try { await suite(js) } catch (e) { quietFails++ }
  quiet = false
  is(quietFails > 0, `MUTANT ${name}: ${quietFails} checks fail`)
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
