// The customer's payment receipt (KNET K-063 D1/D5, the owner's UAT receipt spec, and the order-page findings of
// KNET-K063-CHECK.md), end to end:
//
//   npm run test:payment-receipt
//   (parts 1 and 3 need the rig of scripts/sandbox.sh: MariaDB `sporta` with refunds.mysql.sql, :8095 php-store,
//    :8097 the fake bank, :8098 php-knet; part 2 runs anywhere Chromium does)
//
//   1. SERVER. The KNET redirect carries the order's language and its signed key on the bank's authenticated leg, never on
//      the errorURL leg; GET ?r=status returns the receipt (result, amount, paid time in UTC and Kuwait time, Payment ID,
//      Transaction ID, Track ID, reference, auth code) ONLY with a proof (the key, the checkout phone), never for the order
//      number alone, a wrong or foreign key, or a wrong phone; every value is the order row's; a manual settlement shows no
//      staff e-mail; a retried payment's Track ID is the A<n> reference the bank answered; the FULL invoice carries the same
//      receipt and the limited one does not.
//   2. THE PAGE (public/sporta-features.js, PAYMENT RECEIPT) on a fixture of the compiled result page
//      (scripts/fixtures/payment-result.mjs), with the status answer mocked state by state, Arabic and English, 390 and
//      1280 px: each state's words; "Do not pay again" only for a capture under review; Try again where a payment can be
//      retried; the values are the server's and never the address bar's; the key is sent; a cash order and a page without an
//      order number are left alone; a pending order is checked again by itself and turns into the receipt; React re-rendering
//      the container (a language switch) neither loses the box nor asks again; no sideways scroll; layout shift measured; the
//      button text passes contrast.
//   3. THE PAGE AGAINST THE REAL ROUTE: an order paid through the fake bank, the shopper's landing address opened in the
//      browser, the status call answered by the rig's PHP: the receipt shows the database's values.
//   4. MUTATIONS: the block removed, the block reading the Payment ID from the address, the hiding rule removed, the server
//      giving the receipt without a proof: each must make this suite fail.
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, SHIM_JS, WORDS } from './fixtures/payment-result.mjs'

const run = promisify(execFile)
const WEB = fileURLToPath(new URL('..', import.meta.url))
const KNET = process.env.KNET_BASE ?? 'http://127.0.0.1:8098'
const BANK = process.env.BANK_BASE ?? 'http://127.0.0.1:8097'
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
const ORIGIN = 'https://www.sporta.com.kw'
const HTTPS = { 'X-Forwarded-Proto': 'https' }
const FEATURES = readFileSync(`${WEB}public/sporta-features.js`, 'utf8')
const SHADOWS = readFileSync(`${WEB}public/sporta-shadows.css`, 'utf8')
const BLOCK_AT = FEATURES.indexOf('/* ===== PAYMENT RECEIPT')
const BLOCK_END = FEATURES.indexOf('\n', FEATURES.indexOf('/* ===== PAYMENT RECEIPT - end')) + 1
const BLOCK = FEATURES.slice(BLOCK_AT, BLOCK_END)

let fails = 0, passes = 0
let quiet = false, quietFails = 0
const is = (c, n, d = '') => {
  if (quiet) { if (!c) quietFails++; return c }
  if (c) { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
  return c
}
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`) }
const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()
const encryptK = (plain) => { const c = crypto.createCipheriv('aes-128-cbc', 'abcdef0123456789', 'abcdef0123456789'); return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase() }

// ============================================================================ 1. the server
async function serverPart() {
  head('1. the server: the redirect, the status receipt, the invoice')
  await sql("delete from rate_limit; update product_variants set stock = 1000; " +
    "delete from fulfilment_outbox where order_id in (select id from orders where track_id like 'SPRC%'); delete from orders where track_id like 'SPRC%'")
  const newOrder = async (track, lang = 'ar') => (await fetch(`${API}/api.php?r=order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_id: track, lang, payment_method: 'knet', items: [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'M', fit: 'oversize' }],
      customer: { name: 'Noura Al-Ali', phone: '66554433', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' } }),
  })).json()
  const payVia = async (track, outcome = 'captured', starts = 1) => {
    let loc = ''
    for (let i = 0; i < starts; i++) loc = (await fetch(`${KNET}/pay.php?trackid=${track}`, { headers: HTTPS, redirect: 'manual' })).headers.get('location')
    return (await fetch(`${BANK}/fake-knet-bank.php?${new URL(loc).searchParams}&outcome=${outcome}`)).json()
  }
  const status = async (track, k, headers = {}) => (await fetch(`${API}/api.php?r=status&id=${track}${k == null ? '' : `&k=${encodeURIComponent(k)}`}`, { headers })).json()

  const o = await newOrder('SPRC0001', 'en')
  const bank = await payVia('SPRC0001')
  const land = new URL(bank.landing)
  const k = land.searchParams.get('k')
  is(land.searchParams.get('status') === 'success' && land.searchParams.get('lang') === 'en' && /^\d{9,11}\.[a-f0-9]{32}$/.test(k ?? ''),
    'a paid order lands on the result page in ITS language (en here) with its receipt key', land.search.slice(0, 120))
  const [pid, tid, ref, auth, paidAt, amount] = (await sql("select cbk_paymentid, cbk_transaction, cbk_reference, cbk_authcode, paid_at, amount from orders where track_id='SPRC0001'")).split('\t')
  const bare = await status('SPRC0001')
  is(bare && bare.payment_status === 'paid' && !('receipt' in bare), 'the order number alone: the old answer, no receipt', JSON.stringify(bare).slice(0, 100))
  const full = await status('SPRC0001', k)
  const r = full?.receipt ?? {}
  const kuwait = new Date(Date.parse(paidAt.replace(' ', 'T') + 'Z') + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
  is(r.track_id === 'SPRC0001' && r.result === 'CAPTURED' && r.amount === amount && r.payment_id === pid && r.transaction_id === tid
    && r.reference === ref && r.auth_code === auth && r.paid_at === paidAt && r.paid_at_kuwait === kuwait && r.gateway_track_id === 'SPRC0001',
    'with the key: the receipt, every value the order row\'s (paid time in UTC and Kuwait time)', JSON.stringify(r).slice(0, 220))
  is(o.amount === Number(amount), 'and the amount is what the server priced', `${o.amount} ${amount}`)
  const other = await newOrder('SPRC0002')
  void other
  is(!('receipt' in await status('SPRC0002', k)), "this order's key opens nothing on another order")
  const k2 = k.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))
  is(!('receipt' in await status('SPRC0001', k2)), 'a key with one character changed opens nothing')
  is(!('receipt' in await status('SPRC0001', '1000000000.' + 'a'.repeat(32))), 'an expired key opens nothing')
  is(!!(await status('SPRC0001', null, { 'X-Sporta-Phone': '66554433' }))?.receipt, 'the checkout phone (header) is a proof too, as on the invoice')
  is(!('receipt' in await status('SPRC0001', null, { 'X-Sporta-Phone': '66554434' })), 'a wrong phone is not')
  // REVIEW 2, DEFECT 1: the redirect's key is a RECEIPT key. It opens the bank fields above and NOT the invoice: no name, no
  // street address. The full invoice still takes its own proofs (the invoice key issued with the order, the checkout phone).
  const invK = await (await fetch(`${API}/api.php?r=invoice&id=SPRC0001&k=${encodeURIComponent(k)}`)).json()
  is(invK?.access === 'limited' && invK.receipt === null && !JSON.stringify(invK).includes('Noura') && invK.address?.street === null,
    'the redirect\'s key does NOT open the invoice: the limited one, no name, no street address, no receipt (review 2, defect 1)', JSON.stringify(invK).slice(0, 120))
  const inv = await (await fetch(`${API}/api.php?r=invoice&id=SPRC0001`, { headers: { 'X-Sporta-Phone': '66554433' } })).json()
  const invBare = await (await fetch(`${API}/api.php?r=invoice&id=SPRC0001`)).json()
  is(inv?.access === 'full' && inv.receipt?.payment_id === pid && inv.receipt.transaction_id === tid,
    'the FULL invoice (the checkout phone) carries the same receipt fields', JSON.stringify(inv?.receipt ?? null).slice(0, 100))
  is(invBare?.access === 'limited' && invBare.receipt === null, 'the limited invoice carries none')
  is(!!o.invoice_key && !!(await status('SPRC0001', o.invoice_key))?.receipt, 'the invoice key issued with the new order opens the receipt too')

  await newOrder('SPRC0003')
  const dec = await payVia('SPRC0003', 'notcaptured')
  const dk = new URL(dec.landing).searchParams.get('k')
  const dr = (await status('SPRC0003', dk))?.receipt
  is(new URL(dec.landing).searchParams.get('status') === 'failed' && dr?.result === 'NOT CAPTURED' && /^\d+$/.test(dr?.payment_id ?? '') && dr.paid_at === null,
    'a declined card: the receipt says NOT CAPTURED with the Payment ID the bank gave, and no paid time', JSON.stringify(dr ?? null).slice(0, 140))

  await newOrder('SPRC0004')
  const retry = await payVia('SPRC0004', 'captured', 2)
  const rr = (await status('SPRC0004', new URL(retry.landing).searchParams.get('k')))?.receipt
  is(rr?.gateway_track_id === 'SPRC0004A2' && rr.track_id === 'SPRC0004', "a retried payment's Track ID is the A2 reference the bank answered under", JSON.stringify(rr ?? null).slice(0, 120))

  // a manual settlement: no staff e-mail reaches the shopper
  await newOrder('SPRC0005')
  let cookie = ''
  const admin = async (route, body) => {
    const res = await fetch(`${API}/admin.php?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
    return res.json().catch(() => null)
  }
  await admin('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
  await admin('card_settled', { order_id: Number(await sql("select id from orders where track_id='SPRC0005'")), bank_reference: '100202444555' })
  const man = await status('SPRC0005', null, { 'X-Sporta-Phone': '66554433' })
  is(man?.receipt?.result === 'CAPTURED' && man.receipt.payment_id === '100202444555' && !JSON.stringify(man).includes('@'),
    'a manual settlement: CAPTURED and the typed Payment ID, and no staff e-mail anywhere in the answer', JSON.stringify(man?.receipt ?? null).slice(0, 120))

  // the errorURL leg: ids and language, never the key; the order as order=, which the compiled page does not read
  const er = await fetch(`${KNET}/callback.php?Error=IPAY0100&ErrorText=x&trackid=SPRC0002&paymentid=777`, { headers: HTTPS })
  const eq = new URL((await er.text()).replace(/^REDIRECT=/, '').trim()).searchParams
  is(eq.get('status') === 'error' && eq.get('order') === 'SPRC0002' && !eq.has('trackid') && eq.get('payid') === '777' && eq.get('lang') === 'ar' && !eq.has('k'),
    'the errorURL leg keeps the order number (as order=), the Payment ID and the language, and never hands out the key', eq.toString())

  // REVIEW 2, DEFECT 1, the attack: a stranger who knows only a PENDING order's number opens the bank page for it and
  // presses Cancel. The trandata leg is genuine (the stranger's own bank session), so it is answered; the key it carries
  // opens only what that session already showed (a cancelled payment and its Payment ID), never the buyer.
  await newOrder('SPRC0006')
  const cancel = await payVia('SPRC0006', 'canceled')
  const cq = new URL(cancel.landing).searchParams
  const ck = cq.get('k')
  const cInv = await (await fetch(`${API}/api.php?r=invoice&id=SPRC0006&k=${encodeURIComponent(ck ?? '')}`)).json()
  const cSt = await status('SPRC0006', ck)
  is(cq.get('status') === 'cancelled' && cInv?.access === 'limited' && !JSON.stringify(cInv).includes('Noura') && cInv.address?.street === null
    && (cSt?.receipt == null || (!JSON.stringify(cSt).includes('Noura') && cSt.receipt.payment_status === 'failed')),
    'a CANCELLED bank session started by a stranger for someone else\'s order yields no key that opens the invoice (name, address)',
    `${cq.toString().slice(0, 80)} invoice=${cInv?.access}`)
  // a second capture on a paid order (another Payment ID) gets no key at all
  const dupLand = await (await fetch(`${KNET}/callback.php`, { method: 'POST', redirect: 'manual',
    headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ trandata: encryptK('result=CAPTURED&trackid=SPRC0001A2&amt=' + amount + '&paymentid=100202999555&ref=R&tranid=T&udf5=SPRC0001') }) })).text()
  const dq = new URL(dupLand.replace(/^REDIRECT=/, '').trim()).searchParams
  is(dq.get('status') === 'success' && !dq.has('k'), 'a second capture under ANOTHER Payment ID: the shopper is told paid, and given no key', dq.toString().slice(0, 100))
  return { landing: bank.landing, pid, tid, ref, auth, kuwait, amount }
}

// ============================================================================ 2. the page (mocked)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

const RECEIPT = { track_id: 'SPRC0BOX1', payment_status: 'paid', result: 'CAPTURED', amount: '21.000', paid_at: '2026-11-12 09:05:00', paid_at_kuwait: '2026-11-12 12:05',
  payment_id: '100202616112345678', transaction_id: '8765432109', reference: '901234567890', auth_code: 'B35434', gateway_track_id: 'SPRC0BOX1A2' }
const paid = { payment_status: 'paid', payment_method: 'knet', fulfilment_status: 'unfulfilled', amount: 21, events: [], receipt: RECEIPT }

/** answer: object/null/'abort'/'500', or an array (one per call; the last repeats). Returns the page, the calls and the URL asked. */
// The compiled page makes its OWN status call (no key, credentials 'omit'); the block's carries the key when the address has
// one. With a key in the address the two are told apart: the list of answers is the block's, the compiled call gets the first.
async function open({ query = '?status=success&trackid=SPRC0BOX1&lang=ar&k=1893456000.0123456789abcdef0123456789abcdef&payid=999999999&ref=URLREF',
  answer = paid, lang = 'ar', w = 390, js = FEATURES, real = false, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 } })
  // Layout shift counted from the frame AFTER the compiled page first drew its result container: the shift of that first
  // render (an empty route filled by React, the footer pushed down) is the compiled page's own and happens without the block;
  // everything the block does (its box, the server's answer, a check again) comes later and is counted.
  await ctx.addInitScript(() => {
    window.__ls = []; window.__t0 = Infinity
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push([e.startTime, e.value]) }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {}
    new MutationObserver((r, mo) => {
      if (!document.querySelector('.purchase-result')) return
      mo.disconnect()
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__t0 = performance.now() }))
    }).observe(document, { childList: true, subtree: true })
  })
  const calls = []
  const answers = Array.isArray(answer) ? answer : [answer]
  const errors = []
  await ctx.route(ORIGIN + '/**', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/payment/result') return route.fulfill({ status: 200, contentType: 'text/html', body: fixturePage(lang) })
    if (u.pathname === '/payment-result-fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: SHIM_JS })
    if (u.pathname === '/sporta-features.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: js })
    if (u.pathname === '/sporta-shadows.css') return route.fulfill({ status: 200, contentType: 'text/css', body: SHADOWS })
    if (u.pathname === '/api/api.php' && u.searchParams.get('r') === 'status') {
      const keyed = u.searchParams.has('k') || !new URLSearchParams(query).has('k')
      calls.push({ url: u.search, ours: u.searchParams.has('k') })
      if (real) {
        const res = await fetch(`${API}/api.php${u.search}`)
        return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
      }
      const mine = calls.filter((c) => c.ours).length
      const a = keyed ? answers[Math.min(Math.max(0, mine - 1), answers.length - 1)] : answers[0]
      if (a === 'abort') return route.abort()
      if (a === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"failed"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) })
    }
    if (u.pathname === '/api/api.php') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  })
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await pg.goto(`${ORIGIN}/payment/result${query}`)
  // boot.js sets the theme before the first paint on the live site; here, right after load
  if (dark) await pg.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  pg.__ctx = ctx; pg.__calls = calls; pg.__errors = errors
  return pg
}
const settled = (pg) => pg.waitForFunction(() => { const b = document.querySelector('.sprc'); return !b || (b.dataset.state && b.dataset.state !== 'checking') }, null, { timeout: 8000 }).catch(() => null)
const view = (pg) => pg.evaluate(() => {
  const box = document.querySelector('.sprc')
  const host = document.querySelector('.purchase-result')
  const shown = (n) => n && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden'
  const visibleText = [...document.querySelectorAll('#route *')].filter((n) => n.children.length === 0 && shown(n)).map((n) => n.textContent).join(' | ')
  const rows = box ? [...box.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling ? dt.nextElementSibling.textContent : '']) : []
  const links = box ? [...box.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]) : []
  const buttons = box ? [...box.querySelectorAll('button')].map((b) => b.textContent) : []
  const btn = box ? box.querySelector('.sprc__btn--main') : null
  const bs = btn ? getComputedStyle(btn) : null
  return {
    state: box ? box.dataset.state : null, title: box ? (box.querySelector('h1') || {}).textContent : null,
    visibleText, rows, links, buttons, marked: !!(host && host.hasAttribute('data-sporta-rcpt')),
    reactHidden: host ? [...host.children].filter((c) => !c.classList.contains('sprc')).every((c) => !shown(c)) : null,
    dir: box ? getComputedStyle(box).direction : null,
    valueDirs: box ? [...box.querySelectorAll('.sprc__v')].map((s) => s.getAttribute('dir')) : [],
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    btnColors: bs ? [bs.color, bs.backgroundColor] : null,
    boxH: box ? Math.round(box.getBoundingClientRect().height) : 0, hostH: host ? Math.round(host.getBoundingClientRect().height) : 0,
    cls: window.__ls.filter((x) => x[0] >= window.__t0).reduce((a, x) => a + x[1], 0),
  }
})
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const DNP = { ar: 'لا تدفع مرة أخرى', en: 'Do not pay again' }

async function pagePart(js = FEATURES) {
  head('2. the page: every state, from the server\'s answer')
  // ----- paid, with the receipt
  for (const [lang, w] of [['ar', 390], ['en', 1280], ['ar', 320]]) {
    const pg = await open({ lang, w, js, query: `?status=success&trackid=SPRC0BOX1&lang=${lang}&k=1893456000.0123456789abcdef0123456789abcdef&payid=999999999&ref=URLREF` })
    await settled(pg); await pg.waitForTimeout(150)
    const v = await view(pg)
    const L = lang === 'ar'
    const row = (label) => (v.rows.find((r) => r[0] === label) || [])[1] || ''
    is(v.state === 'success' && v.title === (L ? 'تم الدفع بنجاح' : 'Payment successful'), `${lang} ${w}px paid: "${v.title}"`, v.state)
    is(row(L ? 'رقم الدفع (Payment ID)' : 'Payment ID') === RECEIPT.payment_id && row(L ? 'رقم العملية (Transaction ID)' : 'Transaction ID') === RECEIPT.transaction_id
      && row(L ? 'رقم التتبع (Track ID)' : 'Track ID') === RECEIPT.gateway_track_id && row(L ? 'الرقم المرجعي' : 'Reference number') === RECEIPT.reference
      && row(L ? 'رمز التفويض' : 'Auth code') === RECEIPT.auth_code && row(L ? 'رقم الطلب' : 'Order reference') === 'SPRC0BOX1'
      && row(L ? 'المبلغ المدفوع' : 'Amount paid') === (L ? '21.000 د.ك' : '21.000 KWD') && row(L ? 'النتيجة' : 'Result') === (L ? 'مقبولة' : 'Approved')
      && row(L ? 'تاريخ ووقت الدفع' : 'Payment date & time').startsWith('2026-11-12 12:05') && row(L ? 'تاريخ ووقت الدفع' : 'Payment date & time').includes(L ? 'بتوقيت الكويت' : 'Kuwait time'),
      `${lang} ${w}px: result, amount, Payment ID, Transaction ID, Track ID, reference, auth code, order and Kuwait time, all the server's`, JSON.stringify(v.rows).slice(0, 200))
    is(!v.visibleText.includes('999999999') && !v.visibleText.includes('URLREF'), `${lang} ${w}px: nothing from the address bar is shown (its payid and ref differ from the server's)`)
    const ours = pg.__calls.filter((c) => c.ours)
    is(ours.length === 1 && ours[0].url === '?r=status&id=SPRC0BOX1&k=1893456000.0123456789abcdef0123456789abcdef',
      `${lang} ${w}px: the block asks once, with the order number and the key (the compiled page asks once more, without)`, pg.__calls.map((c) => c.url).join(' '))
    is(v.marked && v.reactHidden, `${lang} ${w}px: the compiled page's own words are hidden while the receipt shows`)
    is(v.dir === (L ? 'rtl' : 'ltr') && v.valueDirs.length >= 7 && v.valueDirs.every((d) => d === 'ltr'), `${lang} ${w}px: the box reads ${L ? 'right to left' : 'left to right'}, every reference left to right`)
    is(v.links.some((l) => l[1] === '/invoice/SPRC0BOX1') && v.links.some((l) => l[1] === '/track?trackid=SPRC0BOX1') && v.links.some((l) => l[1] === '/'),
      `${lang} ${w}px: invoice, track and home links`)
    is(v.overflow <= 0, `${lang} ${w}px: no sideways scroll`, `${v.overflow}px`)
    is(v.cls < 0.05, `${lang} ${w}px: layout shift from the receipt ${v.cls.toFixed(4)} (Google's "good" is < 0.1)`, `${v.cls.toFixed(4)} box ${v.boxH}px host ${v.hostH}px`)
    is(v.btnColors && contrast(v.btnColors[0], v.btnColors[1]) >= 4.5, `${lang} ${w}px: the main button's text passes AA contrast`, v.btnColors && contrast(v.btnColors[0], v.btnColors[1]).toFixed(2))
    is(pg.__errors.length === 0, `${lang} ${w}px: no page error`, pg.__errors.join(' | '))
    if (w === 390) {
      // REVIEW 2, DEFECT 2: the key leaves the address bar once read (kept in this tab only), the rest of the address stays.
      const addr = await pg.evaluate(() => [location.search, sessionStorage.getItem('sporta.rcpt')])
      is(!/[?&]k=/.test(addr[0]) && /trackid=SPRC0BOX1/.test(addr[0]) && /1893456000\.0123456789abcdef/.test(addr[1] ?? ''),
        `${lang} ${w}px: the key is taken out of the address bar (history.replaceState) and kept in this tab's sessionStorage`, addr.join(' :: '))
      await pg.reload()
      await settled(pg); await pg.waitForTimeout(150)
      const again = pg.__calls.filter((c) => c.ours)
      is(again.length === 2 && /&k=1893456000\./.test(again[1].url) && (await view(pg)).state === 'success',
        `${lang} ${w}px: a reload of the page (no key in the address any more) still asks with the kept key`, again.map((c) => c.url).join(' '))
    }
    await pg.__ctx.close()
  }
  // ----- review 3, finding 4: the tallest box (refunded, with its Refunded row) on a 320px phone does not move the footer
  for (const lang of ['ar', 'en']) {
    const refunded = { ...paid, payment_status: 'refunded', receipt: { ...RECEIPT, payment_status: 'refunded', refunded_amount: '21.000' } }
    const pg = await open({ lang, w: 320, js, answer: refunded, query: `?status=success&trackid=SPRC0BOX1&lang=${lang}&k=1893456000.0123456789abcdef0123456789abcdef` })
    await settled(pg); await pg.waitForTimeout(150)
    const v = await view(pg)
    is(v.state === 'refunded' && v.rows.length >= 9 && v.cls < 0.05, `${lang} 320px refunded with its receipt: layout shift ${v.cls.toFixed(4)}`, `${v.cls.toFixed(4)} box ${v.boxH}px host ${v.hostH}px rows ${v.rows.length}`)
    await pg.__ctx.close()
  }

  // ----- the states the live page got wrong, and the rest
  const cases = [
    ['unknown order (null)', null, '?status=success&trackid=SPRC0NONE&lang=ar', 'unknown', 'لم نعثر على هذا الطلب', true],
    ['pending KNET order', { payment_status: 'pending', payment_method: 'knet', fulfilment_status: 'unfulfilled', amount: 21, events: [] }, '?status=review&trackid=SPRC0BOX1', 'pending', 'بانتظار رد البنك', true],
    ['the status call fails (network)', 'abort', '?status=success&trackid=SPRC0BOX1', 'failed_check', 'تعذّر التحقق من الدفع الآن', false],
    ['the status call answers 500', '500', '?status=success&trackid=SPRC0BOX1', 'failed_check', 'تعذّر التحقق من الدفع الآن', false],
    ['the bank declined', { payment_status: 'failed', payment_method: 'knet', amount: 21, events: [], receipt: { ...RECEIPT, payment_status: 'failed', result: 'NOT CAPTURED', paid_at: null, paid_at_kuwait: null } },
      '?status=failed&trackid=SPRC0BOX1', 'unsuccessful', 'لم يتم الدفع', true],
    ['the errorURL leg (pending on the server, reason=bank_error)', { payment_status: 'pending', payment_method: 'knet', amount: 21, events: [] },
      '?status=error&reason=bank_error&order=SPRC0BOX1&payid=777', 'unsuccessful', 'لم يتم الدفع', true],
    ['a capture under review', { payment_status: 'review', payment_method: 'knet', amount: 21, events: [] }, '?status=review&trackid=SPRC0BOX1', 'review', 'تم استلام الدفع — قيد التأكيد', false],
    ['refunded', { payment_status: 'refunded', payment_method: 'knet', amount: 21, events: [] }, '?status=success&trackid=SPRC0BOX1', 'refunded', 'تم رد المبلغ', false],
    ['voided', { payment_status: 'voided', payment_method: 'knet', amount: 21, events: [] }, '?status=success&trackid=SPRC0BOX1', 'voided', 'أُلغيت عملية الدفع', false],
  ]
  for (const [name, answer, query, state, title, retry] of cases) {
    const pg = await open({ answer, query, js })
    await settled(pg); await pg.waitForTimeout(150)
    const v = await view(pg)
    is(v.state === state && v.title === title, `${name}: "${title}"`, `${v.state} "${v.title}"`)
    const dnp = v.visibleText.includes(DNP.ar)
    is(state === 'review' ? dnp : !dnp, state === 'review' ? `${name}: "Do not pay again" stays (the bank captured it)` : `${name}: never "Do not pay again"`, v.visibleText.slice(0, 120))
    is(retry === v.links.some((l) => l[1] === '/cart'), `${name}: ${retry ? 'a Try again link' : 'no Try again link'}`, JSON.stringify(v.links))
    if (state === 'failed_check' || state === 'pending') is(v.buttons.includes('تحقق مرة أخرى'), `${name}: a Check again button`)
    if (name.startsWith('the bank declined')) {
      const why = v.visibleText
      is(why.includes('رفض البنك عملية الدفع') && v.rows.some((r) => r[1] === RECEIPT.payment_id) && !v.rows.some((r) => r[0] === 'تاريخ ووقت الدفع'),
        `${name}: the reason in plain words, the Payment ID the bank gave, no payment time`, JSON.stringify(v.rows).slice(0, 160))
    }
    if (name.startsWith('the errorURL')) is(v.visibleText.includes('تعذّر على البنك إتمام العملية') && !v.visibleText.includes('777'), `${name}: "the bank could not process the payment", and the address bar's Payment ID is not shown`)
    is(v.cls < 0.05, `${name}: layout shift ${v.cls.toFixed(4)}`, `${v.cls.toFixed(4)} box ${v.boxH}px host ${v.hostH}px`)
    is(pg.__errors.length === 0, `${name}: no page error`, pg.__errors.join(' | '))
    await pg.__ctx.close()
  }

  // ----- a check again turns failure into the answer
  {
    const pg = await open({ answer: ['abort', paid], query: '?status=success&trackid=SPRC0BOX1&k=1893456000.0123456789abcdef0123456789abcdef', js })
    await settled(pg)
    await pg.click('.sprc button')
    await pg.waitForFunction(() => document.querySelector('.sprc')?.dataset.state === 'success', null, { timeout: 5000 }).catch(() => null)
    const v = await view(pg)
    is(v.state === 'success' && pg.__calls.filter((c) => c.ours).length === 2, 'Check again after a failed call asks once more and shows the receipt', `${v.state} ${pg.__calls.length}`)
    await pg.__ctx.close()
  }
  // ----- pending, then the bank's answer arrives: checked again by itself
  {
    const pend = { payment_status: 'pending', payment_method: 'knet', amount: 21, events: [] }
    const pg = await open({ answer: [pend, pend, paid], query: '?status=review&trackid=SPRC0BOX1&k=1893456000.0123456789abcdef0123456789abcdef', js })
    await pg.waitForFunction(() => document.querySelector('.sprc')?.dataset.state === 'success', null, { timeout: 12000 }).catch(() => null)
    const v = await view(pg)
    is(v.state === 'success' && pg.__calls.filter((c) => c.ours).length === 3, 'a pending order is checked again by itself and turns into the receipt when the answer lands', `${v.state} after ${pg.__calls.length} calls`)
    is(v.cls < 0.05, `and the page does not jump when it does (${v.cls.toFixed(4)})`, v.cls.toFixed(4))
    await pg.__ctx.close()
  }
  // ----- React throws the container away (a language switch): the box comes back, in the new language, without a second call
  {
    const pg = await open({ js })
    await settled(pg)
    await pg.evaluate(() => window.__render('en'))
    await pg.waitForFunction(() => document.querySelector('.sprc h1')?.textContent === 'Payment successful', null, { timeout: 3000 }).catch(() => null)
    const v = await view(pg)
    is(v.title === 'Payment successful' && v.marked && v.reactHidden && pg.__calls.filter((c) => c.ours).length === 1, 'React re-renders the container in English: the box is back, in English, with no second call', `${v.title} calls=${pg.__calls.length}`)
    await pg.__ctx.close()
  }
  // ----- left alone
  {
    const pg = await open({ answer: { payment_status: 'pending', payment_method: 'cod', amount: 21, events: [] }, query: '?status=success&trackid=SPRC0BOX1', js })
    await pg.waitForFunction(() => /تأكيد الطلب/.test(document.querySelector('#route h1')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => null)
    await pg.waitForTimeout(300)
    const v = await view(pg)
    is(v.state === null && !v.marked && v.visibleText.includes(WORDS.ar.cod[0]), 'a cash order: the compiled "Order confirmed" page is left as it is', v.visibleText.slice(0, 80))
    await pg.__ctx.close()
  }
  // ----- review 3, finding 2: WITHOUT the block (the API released first), KNET's error leg must not say "Do not pay again"
  {
    const pend = { payment_status: 'pending', payment_method: 'knet', amount: 21, events: [] }
    const noBlock = FEATURES.slice(0, BLOCK_AT) + FEATURES.slice(BLOCK_END)
    const pg = await open({ js: noBlock, answer: pend, query: '?status=error&reason=bank_error&order=SPRC0BOX1&payid=777&lang=ar' })
    await pg.waitForTimeout(700)
    const v = await view(pg)
    is(!v.visibleText.includes(DNP.ar) && v.visibleText.includes(WORDS.ar.error[0]),
      'the errorURL leg without the add-on: the compiled page says "Something went wrong", never "Do not pay again" (order=, not trackid=)', v.visibleText.slice(0, 100))
    await pg.__ctx.close()
    const old = await open({ js: noBlock, answer: pend, query: '?status=error&reason=bank_error&trackid=SPRC0BOX1&payid=777&lang=ar' })
    await old.waitForTimeout(700)
    is((await view(old)).visibleText.includes(DNP.ar), '(the hazard it avoids: with trackid= the compiled page does say "Do not pay again" for a pending order)')
    await old.__ctx.close()
  }
  for (const [name, query] of [['no order number', '?status=error&reason=decrypt_failed'], ['a malformed order number', '?status=success&trackid=%3Cb%3Ex'],
    ['order= outside the error leg', '?status=success&order=SPRC0BOX1']]) {
    const pg = await open({ query, js })
    await pg.waitForTimeout(600)
    const v = await view(pg)
    is(v.state === null && !v.marked && pg.__calls.length <= 1, `${name}: the block does nothing and asks nothing`, `${v.state} calls=${pg.__calls.length}`)
    await pg.__ctx.close()
  }
  // ----- dark theme: still readable
  {
    const pg = await open({ js, dark: true })
    await settled(pg)
    const c = await pg.evaluate(() => { const h = document.querySelector('.sprc h1'); return [getComputedStyle(h).color] })
    is(rgb(c[0])[0] > 200, 'in the dark theme the title is light', c[0])
    await pg.__ctx.close()
  }
}

// ============================================================================ 3. the page against the real route
async function realPart(srv) {
  head('3. the page against the real status route')
  const u = new URL(srv.landing)
  const pg = await open({ real: true, lang: 'en', w: 390, query: u.search })
  await settled(pg); await pg.waitForTimeout(150)
  const v = await view(pg)
  const row = (label) => (v.rows.find((r) => r[0] === label) || [])[1] || ''
  is(v.state === 'success' && row('Payment ID') === srv.pid && row('Transaction ID') === srv.tid && row('Reference number') === srv.ref
    && row('Auth code') === srv.auth && row('Amount paid') === `${srv.amount} KWD` && row('Payment date & time').startsWith(srv.kuwait),
    'the shopper\'s landing address, opened: the receipt shows the DATABASE\'s Payment ID, Transaction ID, reference, auth code, amount and time',
    JSON.stringify(v.rows).slice(0, 220))
  await pg.__ctx.close()
}

// ============================================================================ run
let srv = null
const SERVER_ONLY = process.env.RECEIPT_PARTS === 'server'   // scripts/knet-mutants.mjs: part 1 only, no browser
try {
  srv = await serverPart()
} catch (e) {
  is(false, 'the rig answers (scripts/sandbox.sh: MariaDB with refunds.mysql.sql, :8095, :8097, :8098)', String(e).slice(0, 160))
}
if (SERVER_ONLY) {
  await browser.close()
  console.log(`\n${passes} ok, ${fails} failed`)
  process.exit(fails ? 1 : 0)
}
const sourceOk = BLOCK_AT > 0 && !/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b|\beval\s*\(|new Function/.test(BLOCK)
  && !/localStorage/.test(BLOCK) && (BLOCK.match(/sessionStorage\.(get|set)Item/g) || []).length === 2 && /if \(window\.__sportaReceipt\) return/.test(BLOCK)
head('0. the block, read as text')
is(sourceOk, 'the PAYMENT RECEIPT block exists, builds its nodes with textContent only, keeps only the key in this tab\'s sessionStorage (no localStorage), and guards against a second copy')
is(!/get\('(payid|ref|status)'\)/.test(BLOCK.replace("q.get('status') === 'error'", '')), 'it reads no payid, ref or status value from the address (only the error leg\'s reason code, when status=error)')
await pagePart()
if (srv) await realPart(srv)

// ============================================================================ 4. mutations
head('4. mutations: each must make the suite fail')
const mutants = [
  ['the block removed', FEATURES.slice(0, BLOCK_AT) + FEATURES.slice(BLOCK_END)],
  ['the Payment ID read from the address bar', FEATURES.replace("add(t.L.payment_id, clean(r.payment_id))", "add(t.L.payment_id, clean(new URLSearchParams(location.search).get('payid') || r.payment_id))")],
  ['the rule that hides the compiled words removed', FEATURES.replace("'.purchase-result[' + MARK + '] > :not(.' + BOX + '){display:none!important}' +", '')],
  ['"pending" shown as review again', FEATURES.replace("if (s === 'pending') return S.reason ? 'unsuccessful' : 'pending'", "if (s === 'pending') return 'review'")],
  ['the key left in the address bar', FEATURES.replace("    if (q.has('k')) unlist(q)\n", '')],
]
for (const [name, js] of mutants) {
  if (js === FEATURES) { is(false, `mutant "${name}" applies`); continue }
  quiet = true; quietFails = 0
  try { await pagePart(js) } catch (e) { quietFails++ }
  quiet = false
  is(quietFails > 0, `MUTANT ${name}: ${quietFails} checks fail`)
}
if (srv) {
  // the server handing out the receipt without a proof
  const file = `${WEB}dropin/php-store/payment-records.php`
  const orig = readFileSync(file, 'utf8')
  const mut = orig.replace("    if ($track !== '' && store_invoice_key_ok($track, $key)) return true;", "    if ($track !== '') return true;")
  const { writeFileSync } = await import('node:fs')
  if (mut === orig) is(false, 'mutant "receipt without a proof" applies')
  else {
    writeFileSync(file, mut)
    try {
      quiet = true; quietFails = 0
      try { await serverPart() } catch (e) { quietFails++ }
      quiet = false
      is(quietFails > 0, `MUTANT the server gives the receipt to anyone with the order number: ${quietFails} checks fail`)
    } finally { writeFileSync(file, orig) }
  }
}
await browser.close()

console.log(`\n${passes} ok, ${fails} failed`)
if (fails) { console.log('\nPayment receipt: FAILED'); process.exit(1) }
console.log('\nPayment receipt: the result page shows the bank\'s answer, from the server, to the order\'s own shopper')
