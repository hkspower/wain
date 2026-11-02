// The CBK T-Pay path, end to end, against a real MariaDB and a fake gateway
// that speaks the real CBK API (scripts/fake-cbk-gateway.php).
//
// T-Pay had no coverage at all while KNET had 39 checks, and that asymmetry
// was not academic: T-Pay carried the SAME bug KNET did — an amount lookup and
// a writer that both queried a database the shop no longer used — so
// refused every payment and recorded nothing, and no test noticed. This suite
// is what stops the two gateways drifting apart again.
//
// What it proves:
//   * the amount charged comes from the DATABASE, never the browser;
//   * the merchant credentials really are checked (the gateway 401s on a wrong
//     ClientSecret and 400s on a wrong ENCRP_KEY);
//   * a success is recorded with the bank's reference numbers, once;
//   * a replay changes nothing and a late failure cannot un-pay an order;
//   * an underpayment is held for review rather than banked;
//   * a cancel leaves the order unpaid;
//   * a paid answer the shop cannot confirm is held for review, never success.
//
//   npm run test:tpay
//   (needs MariaDB, php -S :8095 php-store, :8099 the gateway, :8100 php-cbk)
import { execFile, spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PAY = process.env.TPAY_BASE ?? 'http://127.0.0.1:8100'
const GW = process.env.CBK_BASE ?? 'http://127.0.0.1:8099'
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()

// ?r=order IS RATE LIMITED (20 per ten minutes per IP), and this suite creates
// orders in a loop from one IP. Left over from a previous run — or from the
// native suite, which shares the bucket — that limit turns into an order whose
// amount is `undefined` and a cascade of failures pointing at the gateway,
// which is not where the problem is. Clear the counter first.
// The live store claims stock inside the order (out_of_stock_<slug>_<size>_<left>),
// and test:native's inventory checks leave sizes at 0 — so restock the test
// shelf too. Test database only.
await run('mariadb', ['sporta', '-e', 'delete from rate_limit; update product_variants set stock = 1000'])

// The endpoints refuse plain HTTP exactly as they will on Hostinger; the proxy
// header is how the edge says TLS was terminated upstream.
const HTTPS = { 'X-Forwarded-Proto': 'https' }
const get = (url) => fetch(url, { headers: HTTPS, redirect: 'manual' })

const newOrder = async (track, qty = 2) => {
  const res = await fetch(`${API}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track,
      items: [{ slug: 'cloudsoft-jacket-army-green', qty, size: 'L', fit: 'oversize' }],
      customer: {
        name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli',
        area: 'Salmiya', block: '4', street: '12', building: '5',
      },
      payment_method: 'tpay',
    }),
  })
  return res.json()
}

// pay.php answers with an auto-submitting HTML form. Pull the hidden fields
// out of it — that is literally what the customer's browser posts onward.
const formFields = (html) => Object.fromEntries(
  [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]),
)
const formAction = (html) => /<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? ''

// Play the customer: post the form to the gateway, then follow the return URL
// to the merchant's callback, the way the browser would.
const payThrough = async (html, query = '') => {
  const action = formAction(html).replace(/&amp;/g, '&')
  const fields = formFields(html)
  const gw = await (await fetch(action + (query ? (action.includes('?') ? '&' : '?') + query : ''), {
    method: 'POST',
    body: new URLSearchParams(fields),
  })).json()
  const back = await get(gw.return_url)
  return { gw, fields, location: back.headers.get('location') ?? '', status: back.status }
}

// The .purged marker too: a Status-0 retry is allowed once per ten minutes,
// and a marker left by a previous run would make the stale-key check below
// read the throttle rather than the retry.
await run('rm', ['-f', '/tmp/.cbk_token_test.json', '/tmp/.cbk_token_test.json.purged', '/tmp/fake-cbk-txns.json'])
await sql('delete from fulfilment_outbox; delete from order_items; delete from orders;')

// ------------------------------------------------- the handoff to the gateway
head('pay.php hands the gateway the right numbers')
{
  const order = await newOrder('SPTPAY0001')
  // 2 x 10.000 of goods + 1.000 delivery. The fee is part of what the BANK is
  // asked for, so this assertion is the one that would catch delivery being
  // quoted to the customer but not charged, or charged twice.
  is(order.amount === 21, 'an order exists, priced by the server (goods + delivery)', `${order.amount} KWD`)

  const html = await (await get(`${PAY}/pay.php?trackid=SPTPAY0001&lang=ar`)).text()
  const f = formFields(html)
  is(formAction(html).includes('/ePay/pg/epay'), 'the shopper is posted to the CBK hosted page')
  // Goods + delivery, matching orders.amount to the fil.
  is(f.tij_MerchantPaymentAmount === '21.000', 'the amount is the ORDER total', f.tij_MerchantPaymentAmount)
  is(f.tij_MerchantPaymentTrack === 'SPTPAY0001', 'the track id is carried')
  is(f.tij_MerchantEncryptCode === 'TESTENCRP', 'the ENCRP_KEY identifies the merchant account')
  is(f.tij_MerchAuthKeyApi?.startsWith('FAKETOKEN-'), 'a real AccessToken was fetched from the gateway')
  is(f.tij_MerchantPaymentCurrency === 'KWD', 'currency is KWD')
  is(f.tij_MerchReturnUrl.includes('callback.php'), 'the return URL points at our callback')
  is(f.tij_MerchantPaymentLang === 'ar', 'the shopper’s language reaches the payment page', f.tij_MerchantPaymentLang)
}

// ------------------------------------------ the browser cannot set the price
head('the browser cannot choose what it pays')
{
  const html = await (await get(`${PAY}/pay.php?trackid=SPTPAY0001&amount=0.100`)).text()
  is(formFields(html).tij_MerchantPaymentAmount === '21.000',
     'an amount in the URL is IGNORED, not charged', formFields(html).tij_MerchantPaymentAmount)

  const unknown = await get(`${PAY}/pay.php?trackid=NOSUCHORDER&amount=0.100`)
  const body = await unknown.text()
  is(unknown.status >= 400 || !body.includes('<form'),
     'an invented track id cannot be priced by the browser', `${unknown.status}`)
}

// -------------------------------------------------------- a paid transaction
head('a successful payment is recorded')
{
  await newOrder('SPTPAY0002')
  const html = await (await get(`${PAY}/pay.php?trackid=SPTPAY0002`)).text()
  const { location } = await payThrough(html, 'outcome=success')

  is(location.includes('status=success') && location.includes('SPTPAY0002'),
     'the customer lands on the success page', location.split('?')[1] ?? '')

  const row = (await sql(
    "select payment_status, paid_at is not null, cbk_status, cbk_paymentid <> '' from orders where track_id='SPTPAY0002'",
  )).split('\t')
  is(row[0] === 'paid', 'the order is PAID in MySQL', row[0])
  is(row[1] === '1', 'paid_at is stamped')
  is(row[2] === '1' && row[3] === '1', 'CBK’s reference numbers are stored for reconciliation')

  const outbox = await sql("select count(*) from fulfilment_outbox where kind='payment' and order_id=(select id from orders where track_id='SPTPAY0002')")
  is(outbox === '1', 'exactly one "payment received" message is queued', outbox)
}

// ------------------------------------------------------------- replay safety
head('a replayed return changes nothing')
{
  const before = await sql("select paid_at from orders where track_id='SPTPAY0002'")
  // Same encrp, fetched again — the customer refreshing the return page.
  const txns = JSON.parse((await run('cat', ['/tmp/fake-cbk-txns.json'])).stdout)
  const encrp = Object.keys(txns).find((k) => txns[k].TrackId === 'SPTPAY0002')
  const again = await get(`${PAY}/callback.php?encrp=${encrp}`)
  is(again.status === 302, 'the replay is answered cleanly', `${again.status}`)

  const after = await sql("select paid_at from orders where track_id='SPTPAY0002'")
  is(before === after, 'paid_at is NOT re-stamped', `${before} → ${after}`)
  const outbox = await sql("select count(*) from fulfilment_outbox where kind='payment' and order_id=(select id from orders where track_id='SPTPAY0002')")
  is(outbox === '1', 'the warehouse is NOT emailed a second time', outbox)
}

// ------------------------------------------------------------- failing paths
head('everything unverifiable fails closed')
{
  // Captured, but for the wrong amount.
  await newOrder('SPTPAY0003')
  const html = await (await get(`${PAY}/pay.php?trackid=SPTPAY0003`)).text()
  const { location } = await payThrough(html, 'outcome=success&amt=0.100')
  is(!location.includes('status=success'), 'an underpayment is NOT treated as success', location.split('?')[1] ?? '')
  const st = await sql("select payment_status from orders where track_id='SPTPAY0003'")
  is(st === 'review', 'and it is held for REVIEW — the money may really have moved', st)

  // A cancelled payment.
  await newOrder('SPTPAY0004')
  const h4 = await (await get(`${PAY}/pay.php?trackid=SPTPAY0004`)).text()
  const r4 = await payThrough(h4, 'outcome=cancelled')
  is(r4.location.includes('status=cancelled'), 'a cancelled payment says so')
  is((await sql("select payment_status from orders where track_id='SPTPAY0004'")) === 'failed',
     'and the order is left unpaid')

  // A return URL with no handle, and one with a made-up handle.
  const bare = await get(`${PAY}/callback.php`)
  is((bare.headers.get('location') ?? '').includes('missing_encrp'), 'a return with no handle is refused')
  const ghost = await get(`${PAY}/callback.php?encrp=ENCdeadbeef`)
  is(!(ghost.headers.get('location') ?? '').includes('status=success'),
     'a made-up transaction handle cannot claim a payment')
}

// ------------------------------------ a paid answer the shop cannot confirm
head('a paid answer the shop cannot confirm is held, not shown as success')
{
  // The bank says paid, but by the time it answers the order no longer matches
  // our track id (renamed here to stand in for a vanished or unreachable row).
  // Showing success would be a claim nothing in the database backs.
  await newOrder('SPTPAY0005')
  const html = await (await get(`${PAY}/pay.php?trackid=SPTPAY0005`)).text()
  await sql("update orders set track_id='SPGONE0005' where track_id='SPTPAY0005'")
  const { location } = await payThrough(html, 'outcome=success')
  is(location.includes('status=review'),
     'a paid answer the shop cannot match is held for REVIEW', location.split('?')[1] ?? '')
  is(!location.includes('status=success'), 'and it is NOT shown as success')
  is((await sql("select payment_status from orders where track_id='SPGONE0005'")) === 'pending',
     'and nothing is marked paid')
}

// -------------------------------------------------------- paying twice over
head('an order cannot be paid twice')
{
  const res = await get(`${PAY}/pay.php?trackid=SPTPAY0002`)
  is(res.status === 409, 'pay.php refuses an order that is already paid', `${res.status}`)
}

// ---------------------------------------- a second attempt; a declined order
head('a second attempt gets its own reference; a declined order is closed')
{
  // CBK's manual (p.10) requires the Merchant Track to be unique for EVERY
  // attempt, and its own sample calls uniqid(). The shop sent orders.track_id,
  // which is unique per ORDER — so a second attempt handed the gateway a
  // reference it had already seen, and it is entitled to refuse it (TIJ0004).
  //
  // The SAME rule KNET follows (test:knet, "a declined order is closed"): a
  // shopper who backs out of the bank page leaves the order PENDING and may
  // try again under a fresh reference; a DECLINED order is closed, and the
  // checkout starts a new one. The two gateways must not disagree about which
  // orders can still be charged.
  await newOrder('SPTPAY0RETRY')

  // First attempt — the shopper reaches the CBK page and backs out, so no
  // callback arrives and the order is still pending.
  const first = await (await get(`${PAY}/pay.php?trackid=SPTPAY0RETRY`)).text()
  is(formFields(first).tij_MerchantPaymentTrack === 'SPTPAY0RETRY',
     'the FIRST attempt sends the order id unchanged — the common case is untouched',
     formFields(first).tij_MerchantPaymentTrack)

  // They tap "pay" again.
  const second = await (await get(`${PAY}/pay.php?trackid=SPTPAY0RETRY`)).text()
  const ref = formFields(second).tij_MerchantPaymentTrack ?? ''
  is(ref !== '' && ref !== 'SPTPAY0RETRY',
     'the second attempt sends a different reference, so the gateway cannot refuse it as a duplicate',
     `SPTPAY0RETRY -> ${ref || '(no form)'}`)
  is(ref.startsWith('SPTPAY0RETRY'),
     'and it still carries the order number, so a bank statement can be reconciled', ref)
  is(ref.length <= 30, 'within the field the manual allows', `${ref.length}`)

  const paid = await payThrough(second, 'outcome=success')
  is(paid.location.includes('status=success'), 'the second attempt is captured',
     paid.location.split('?')[1] ?? '')

  // THE PART THAT MUST NOT BREAK. The gateway echoes back the SECOND
  // reference, and the order is keyed on track_id — an unresolved reference
  // would mean CBK took the money while the order stayed pending.
  const row = (await sql(
    "select payment_status, pay_attempt from orders where track_id='SPTPAY0RETRY'")).split('\t')
  is(row[0] === 'paid',
     'THE ORIGINAL ORDER settles, even though the gateway echoed the second reference', row[0])
  is(row[1] === '2', 'and the attempt counter says it took two', row[1])
  is((await sql("select count(*) from orders where track_id like 'SPTPAY0RETRYA%'")) === '0',
     'no phantom order is created for the second reference')

  // A 30-character order id has no room for the retry suffix, so the second
  // attempt's reference is SHORTENED — and then only MerchUdf5 (the original
  // order id, echoed back by CBK) can find the order. It was read under the
  // wrong key ("Udf5"), so this payment would have been taken and the order
  // left pending.
  const LONG = 'SPTPAYLONG' + 'X'.repeat(18) + '30'
  await newOrder(LONG)
  await get(`${PAY}/pay.php?trackid=${LONG}`)
  const longAgain = await (await get(`${PAY}/pay.php?trackid=${LONG}`)).text()
  const shortRef = formFields(longAgain).tij_MerchantPaymentTrack ?? ''
  is(shortRef.length === 30 && shortRef !== LONG && !shortRef.startsWith(LONG),
     'a 30-character order id is SHORTENED for its second attempt', shortRef)
  const longPaid = await payThrough(longAgain, 'outcome=success')
  is((await sql(`select payment_status from orders where track_id='${LONG}'`)) === 'paid',
     'and THAT is how the shortened reference settles the right order',
     longPaid.location.split('?')[1] ?? '')

  // CBK's OWN Track ID (TrackId — the gateway's reference; PayId is ours) is
  // one of the returned values the manual says the merchant MUST save. It
  // was read and thrown away.
  const gwTrack = await sql(`select cbk_trackid from orders where track_id='${LONG}'`)
  is(/^CBK\d{9}$/.test(gwTrack), "CBK's own Track ID is saved on the order (cbk_trackid)", gwTrack)

  // ...and a database that has not had the column added yet must still
  // SETTLE: the reference is a nice-to-have, the payment is not.
  // ALGORITHM=COPY: an instant drop keeps the column in every row as a hidden
  // field, and repeated runs pile those up until the orders table cannot take
  // a new column at all (error 1118). See native-backend-test.mjs.
  await sql('alter table orders drop column cbk_trackid, algorithm=copy')
  try {
    await newOrder('SPTPAY0NOCOL')
    const nc = await payThrough(await (await get(`${PAY}/pay.php?trackid=SPTPAY0NOCOL`)).text(), 'outcome=success')
    is((await sql("select payment_status from orders where track_id='SPTPAY0NOCOL'")) === 'paid',
       'without the cbk_trackid column (migration not run) the payment still settles',
       nc.location.split('?')[1] ?? '')
  } finally {
    await sql('alter table orders add column if not exists cbk_trackid varchar(40) null after cbk_paytype')
  }

  // A DECLINE closes the order.
  await newOrder('SPTPAY0DECL')
  const d1 = await (await get(`${PAY}/pay.php?trackid=SPTPAY0DECL`)).text()
  const declined = await payThrough(d1, 'outcome=failed')
  is(declined.location.includes('status=failed'), 'a declined card lands on the failure page',
     declined.location.split('?')[1] ?? '')
  is((await sql("select payment_status from orders where track_id='SPTPAY0DECL'")) === 'failed',
     'and the order is FAILED')
  const again = await get(`${PAY}/pay.php?trackid=SPTPAY0DECL`)
  is(again.status === 409, 'a declined order cannot be charged again — the checkout starts a new one',
     `${again.status} ${(await again.text()).slice(0, 60)}`)
}

// --------------------------------------------------------------- the audit log
head('the money leaves a trail')
{
  const log = (await run('cat', ['/tmp/cbk-test.log']).catch(() => ({ stdout: '' }))).stdout
  is(log.includes('pay.init') && log.includes('callback.received'),
     'both sides of every payment are logged')
  is(log.includes('already_paid'), 'and a refused second payment is on the record')
  is(!log.includes('testsecret') && !log.includes('TESTENCRP'),
     'the log never contains the ClientSecret or the ENCRP_KEY')
}

// ------------------------------------------------ the gateway checks us back
head('the merchant credentials are really checked')
{
  const bad1 = await fetch(`${GW}/ePay/api/cbk/online/pg/merchant/Authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('TESTCLIENT:WRONG').toString('base64') },
    body: JSON.stringify({ ENCRP_KEY: 'TESTENCRP' }),
  })
  is(bad1.status === 401, 'a wrong ClientSecret is rejected by the gateway', `${bad1.status}`)

  const bad2 = await fetch(`${GW}/ePay/api/cbk/online/pg/merchant/Authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('TESTCLIENT:testsecret').toString('base64') },
    body: JSON.stringify({ ENCRP_KEY: 'WRONG' }),
  })
  is(bad2.status === 400, 'a wrong ENCRP_KEY is rejected by the gateway', `${bad2.status}`)
}

// ------------------------------------------------------------ the token cache
head('the access token is cached, not re-fetched per payment')
{
  const cached = JSON.parse((await run('cat', ['/tmp/.cbk_token_test.json'])).stdout)
  is(typeof cached.token === 'string' && cached.token.startsWith('FAKETOKEN-'),
     'the AccessToken is cached to disk between requests')
  const mode = (await run('stat', ['-c%a', '/tmp/.cbk_token_test.json'])).stdout.trim()
  is(mode === '600', 'and the cache file is chmod 600 — it is a live bearer token', mode)
}

// ------------------------------------------- the gateway's OTHER return path
//
// CBK's manual (v2.93, "Error", p.13): on any error during the transaction the
// return URL is called with ErrorCode and PayTrackID — not with encrp. That
// branch did not exist here. A rejected request took the missing_encrp exit and
// the order stayed PENDING for ever: no failure recorded, nothing logged, and
// the code that says exactly what the bank objected to discarded at the door.
head('a gateway ERROR return is recorded, not silently dropped')
{
  const track = 'TIJERR' + Date.now().toString(36).toUpperCase()
  await sql(`insert into orders (track_id, amount, subtotal, payment_method, payment_status)
             values ('${track}', 5.000, 5.000, 'tpay', 'pending')`)

  // TIJ0002 is "Invalid Merchant Amount" in the manual's table.
  const r = await get(`${PAY}/callback.php?ErrorCode=TIJ0002&PayTrackID=${track}`)
  is(r.status === 302, 'the customer is still redirected, not shown a blank page', `${r.status}`)
  is((r.headers.get('location') ?? '').includes('TIJ0002'),
     'and the code travels to the result page', r.headers.get('location') ?? '')

  const row = await sql(`select payment_status, cbk_message from orders where track_id = '${track}'`)
  // RECORDED, NOT ACTED ON. The error return carries no signature, so it may
  // not change the order's state — a stranger holding a track id could
  // otherwise fail someone's checkout and have cron-stock release its sizes.
  // What it must do is keep the code and its meaning on the row and in the log.
  is(row.startsWith('pending') && row.includes('TIJ0002') && /invalid merchant amount/i.test(row),
     'the code and its meaning are kept on the order, and the unsigned return changes no status', row)
  is(/TIJ0002/.test(row) && /amount/i.test(row),
     'and it records the code AND what the code means, so the log is readable', row)

  // An error with no track id must still not blow up — the gateway can fail
  // before it has one (a bad return URL, TIJ0027).
  const orphan = await get(`${PAY}/callback.php?ErrorCode=TIJ0027`)
  is(orphan.status === 302, 'an error with no track id still redirects cleanly', `${orphan.status}`)
}

// ------------------------------- the two ids the manual keeps telling apart
head('the settlement uses the MERCHANT’s track id, not the gateway’s')
{
  const track = 'SPTPAYID' + Date.now().toString(36).toUpperCase()
  await sql(`insert into orders (track_id, amount, subtotal, payment_method, payment_status)
             values ('${track}', 7.000, 7.000, 'tpay', 'pending')`)
  const html = await (await get(`${PAY}/pay.php?trackid=${track}`)).text()
  const { gw, location } = await payThrough(html, 'outcome=success')

  // The gateway answers with BOTH: TrackId is its own reference, PayId is the
  // value we sent. Confirm the fake is really handing back two different
  // things, or the check below proves nothing.
  const t = await (await fetch(`${GW}/GetTransactions/${gw.encrp}/x`)).json()
  is(t.TrackId !== t.PayId && t.PayId === track,
     'the gateway returns its OWN TrackId and our PayId, as the manual says', `${t.TrackId} / ${t.PayId}`)

  // The order is looked up by OUR id. Reading TrackId instead finds no row,
  // and a captured payment stays pending for ever while the customer is shown
  // a success page — which is exactly what this used to do.
  is(await sql(`select payment_status from orders where track_id = '${track}'`) === 'paid',
     'and the order is settled anyway', location.split('?')[1] ?? '')
}

// ------------------------------------------- the API declining to answer
head('"invalid access" is not the same as "payment declined"')
{
  const track = 'SPSTALE' + Date.now().toString(36).toUpperCase()
  await sql(`insert into orders (track_id, amount, subtotal, payment_method, payment_status)
             values ('${track}', 9.000, 9.000, 'tpay', 'pending')`)
  const html = await (await get(`${PAY}/pay.php?trackid=${track}`)).text()

  // Arm one Status=0 — "Invalid Access. Re-generate new API key" (p.14). The
  // manual's own remedy is to mint a fresh key and try again, so a successful
  // payment must still settle.
  await fetch(`${GW}/stale-once`)
  const { location } = await payThrough(html, 'outcome=success')

  const status = await sql(`select payment_status from orders where track_id = '${track}'`)
  is(status !== 'failed',
     'a stale token NEVER marks a captured payment as failed', status)
  is(status === 'paid',
     'it re-authenticates and settles, which is what the manual says to do',
     `${status} — ${location.split('?')[1] ?? ''}`)
}

// ----------------------------------------------- the vendor sample's bad line
head('an unverifiable certificate is refused')
{
  // CBK's own reference implementation turns TLS verification OFF —
  //     CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_SSL_VERIFYPEER => 0
  // — on the Authenticate call, which is the request carrying the
  // ClientSecret and the ENCRP_KEY. This asserts we did not copy it, against
  // a real HTTPS server with a certificate nothing can verify.
  const dir = '/tmp/sporta-tls-test'
  await run('mkdir', ['-p', dir])
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', `${dir}/k.pem`,
                        '-out', `${dir}/c.pem`, '-days', '2', '-nodes', '-subj', '/CN=127.0.0.1'])
  const py = `import http.server, ssl
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('${dir}/c.pem', '${dir}/k.pem')
s = http.server.HTTPServer(('127.0.0.1', 8102), http.server.SimpleHTTPRequestHandler)
s.socket = ctx.wrap_socket(s.socket, server_side=True)
s.serve_forever()`
  await writeFile(`${dir}/srv.py`, py)
  const srv = spawn('python3', [`${dir}/srv.py`], { stdio: 'ignore', detached: true })
  try {
    // Wait for it, and prove it is genuinely serving — otherwise "our client
    // failed" would pass against a server that was never listening, which is
    // the same result for the opposite reason.
    let alive = false
    for (let i = 0; i < 50; i++) {
      const r = await run('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}',
                                   'https://127.0.0.1:8102/']).catch(() => null)
      if (r?.stdout === '200') { alive = true; break }
      await new Promise((r) => setTimeout(r, 100))
    }
    is(alive, 'the self-signed server is up and answering curl -k')

    const { stdout } = await run('php', [new URL('tls-probe.php', import.meta.url).pathname,
                                         'https://127.0.0.1:8102/'])
    is(stdout.trim() === '0',
       'and cbk_http REFUSES it — the bank\'s own sample disables this check',
       `http ${stdout.trim()}`)
  } finally {
    try { process.kill(-srv.pid) } catch {}
  }
}

head('the Authenticate key is reused only where it was issued')
{
  const probe = new URL('cbk-token-probe.php', import.meta.url).pathname
  const file = `/tmp/sporta-cbk-token-${process.pid}.json`
  const { createHash } = await import('node:crypto')
  const owner = createHash('sha256').update('http://127.0.0.1:1\0' + 'CID').digest('hex')
  const ts = Math.floor(Date.now() / 1000)
  const tryWith = async (cache, env, cid) => {
    await writeFile(file, JSON.stringify(cache))
    return (await run('php', [probe, file, env, cid])).stdout.trim()
  }
  is(await tryWith({ token: 'CACHED', ts, owner }, 'test', 'CID') === 'CACHED',
     'same gateway + ClientId, inside its life: cached key reused')
  is(await tryWith({ token: 'CACHED', ts, owner }, 'production', 'CID') === 'NEW',
     'after Test -> Production: the test key is NOT reused')
  is(await tryWith({ token: 'CACHED', ts, owner }, 'test', 'OTHER') === 'NEW',
     'after a new ClientId: the old key is NOT reused')
  is(await tryWith({ token: 'CACHED', ts }, 'test', 'CID') === 'NEW',
     'a key cached before this rule (no owner) is NOT reused')
  is(await tryWith({ token: 'CACHED', ts: ts - 101 * 60, owner }, 'test', 'CID') === 'NEW',
     'past 100 minutes (CBK allows 6h): refreshed')
  // CBK's manual: Status 1 = key returned, 0 = failed; HTTP 401 = bad
  // ClientId/Secret or an IP not registered. Neither the JSON type of Status
  // nor the 401 wording is pinned down by the fake gateway, so a stub does it.
  const stub = spawn('php', ['-S', '127.0.0.1:8103', new URL('cbk-auth-stub.php', import.meta.url).pathname],
                     { stdio: 'ignore', detached: true })
  try {
    await new Promise((r) => setTimeout(r, 400))
    await run('rm', ['-f', file])
    const num = (await run('php', [probe, file, 'test', 'CID', 'http://127.0.0.1:8103/num'])).stdout.trim()
    is(num === 'NUMTOKEN', 'Authenticate answering Status as a JSON number 1 is accepted', num)
    await writeFile(file, JSON.stringify({ token: 'CACHED', ts, owner: createHash('sha256').update('http://127.0.0.1:8103/num\0CID').digest('hex') }))
    const fresh = (await run('php', [probe, file, 'test', 'CID', 'http://127.0.0.1:8103/num', 'fresh'])).stdout.trim()
    is(fresh === 'NUMTOKEN', 'checkout asks CBK for a FRESH key even when a valid one is cached (manual)', fresh)
    const { readFile } = await import('node:fs/promises')
    is(JSON.parse(await readFile(file, 'utf8')).token === 'NUMTOKEN', 'and caches it for the callback that follows')
    await run('rm', ['-f', file])
    const deny = (await run('php', [probe, file, 'test', 'CID', 'http://127.0.0.1:8103/deny'])).stdout.trim()
    is(deny.startsWith('ERR ') && deny.includes('(401)') && deny.includes('IP is registered'),
       'HTTP 401 is reported as credentials-or-server-IP, not "unknown"', deny)
  } finally {
    try { process.kill(-stub.pid) } catch {}
  }
  await run('rm', ['-f', file])
}

// ------------------------------------------- what a stranger can make CBK do
//
// callback.php and pay.php are unauthenticated by design — the bank sends the
// shopper to one, the storefront to the other — and each call costs requests
// to CBK's merchant API under the shop's own credentials. A junk callback used
// to cost three (GetTransactions, Authenticate, GetTransactions) and wipe the
// cached key each time; pay.php minted a fresh key on every start, with no
// limit per client and none per order.
//
// The sandbox's :8100 serves dropin/php-cbk with no api/ beside it, so it has
// no shared resolver and no proxy to trust — every request is one client. This
// block serves a copy in the live layout (T/api, T/pay) whose store config
// trusts 127.0.0.1 as its proxy, so X-Forwarded-For names the client exactly
// as Traefik does on the VPS.
head('a stranger cannot make this server hammer CBK')
{
  const fs = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const net = await import('node:net')
  const WEB = new URL('..', import.meta.url).pathname
  const T = fs.mkdtempSync(join(tmpdir(), 'sporta-tpay-rl-'))
  fs.cpSync(join(WEB, 'dropin/php-store'), join(T, 'api'), { recursive: true })
  fs.cpSync(join(WEB, 'dropin/php-cbk'), join(T, 'pay'), { recursive: true })
  const isFree = (p) => new Promise((res) => {
    const s = net.createServer().once('error', () => res(false))
      .once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
  })
  let port = 8211
  while (!(await isFree(port))) port++
  const B = `http://127.0.0.1:${port}`
  const TOKEN = join(T, 'cbk-token.json')
  const LOG = join(T, 'cbk.log')
  fs.writeFileSync(join(T, 'api', 'config.php'),
    `<?php return ['trusted_proxy_ips' => ['127.0.0.1']] + (require '${join(WEB, 'dropin/php-store/config.php')}');\n`)
  await run('php', ['-r', `$c = require '${join(WEB, 'dropin/php-cbk/config.php')}';`
    + ` $c['return_url'] = '${B}/pay/callback.php'; $c['token_cache_file'] = '${TOKEN}'; $c['log_file'] = '${LOG}';`
    + ` file_put_contents('${join(T, 'pay', 'config.php')}', '<?php return ' . var_export($c, true) . ';');`])
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', T], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}/api/api.php?r=checkout_config`); break } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  const from = (ip, path) => fetch(`${B}/${path}`, { headers: { ...HTTPS, 'X-Forwarded-For': ip }, redirect: 'manual' })
  const calls = async () => (await fetch(`${GW}/__calls`)).json()
  const resetCalls = () => fetch(`${GW}/__calls?reset=1`)
  const pending = async (track) => sql(`insert into orders (track_id, amount, subtotal, payment_method, payment_status)
                                        values ('${track}', 9.000, 9.000, 'tpay', 'pending')`)
  const tag = Date.now().toString(36).toUpperCase()
  try {
    await sql('delete from rate_limit')

    // -1, "Error/Invalid encrp": logged and answered. No new key can fix it.
    await resetCalls()
    const junk = []
    for (let i = 1; i <= 20; i++) junk.push(await from(`203.0.113.${i}`, `pay/callback.php?encrp=JUNK${i}`))
    const c1 = await calls()
    is(junk.every((r) => r.status === 302 && (r.headers.get('location') ?? '').includes('reason=unresolved')),
       'twenty junk callbacks are each answered and sent to the result page', [...new Set(junk.map((r) => r.status))].join(','))
    is((c1.GetTransactions ?? 0) === 20 && (c1.Authenticate ?? 0) <= 1,
       'and cost CBK one question each — no re-authentication for a bad encrp',
       `GetTransactions=${c1.GetTransactions ?? 0} Authenticate=${c1.Authenticate ?? 0}`)
    is(fs.existsSync(TOKEN), 'and the cached key survives them', TOKEN)

    // 0, "re-generate new API key": one purge-and-retry per ten minutes.
    await resetCalls()
    const s1 = await from('203.0.113.30', 'pay/callback.php?encrp=STALE1')
    const s2 = await from('203.0.113.31', 'pay/callback.php?encrp=STALE2')
    const c2 = await calls()
    is([s1, s2].every((r) => (r.headers.get('location') ?? '').includes('reason=unresolved'))
       && (c2.Authenticate ?? 0) === 1 && (c2.GetTransactions ?? 0) === 3,
       'two "invalid access" answers in ten minutes: ONE fresh key, and the second is not retried',
       `Authenticate=${c2.Authenticate ?? 0} GetTransactions=${c2.GetTransactions ?? 0}`)

    // Ten starts per ORDER, and the eleventh costs CBK nothing.
    const ONE = `SPRLA${tag}`
    await pending(ONE)
    await resetCalls()
    const starts = []
    for (let i = 1; i <= 11; i++) starts.push(await from(`198.51.100.${i}`, `pay/pay.php?trackid=${ONE}`))
    const c3 = await calls()
    const lastText = await starts[10].text()
    is(starts.slice(0, 10).every((r) => r.status === 200) && starts[10].status === 429
       && /new checkout/i.test(lastText) && (c3.Authenticate ?? 0) === 10,
       'one order can be sent to the bank ten times; the eleventh is refused before any call to CBK',
       `${starts.map((r) => r.status).join(',')} Authenticate=${c3.Authenticate ?? 0}`)

    // Ten starts a minute per CLIENT.
    const [TWO, THREE] = [`SPRLB${tag}`, `SPRLC${tag}`]
    await pending(TWO)
    await pending(THREE)
    const mine = []
    for (let i = 0; i < 10; i++) mine.push((await from('192.0.2.77', `pay/pay.php?trackid=${TWO}`)).status)
    const over = await from('192.0.2.77', `pay/pay.php?trackid=${THREE}`)
    const overText = await over.text()
    const other = await from('192.0.2.78', `pay/pay.php?trackid=${THREE}`)
    is(mine.every((st) => st === 200) && over.status === 429 && /wait a minute/i.test(overText) && other.status === 200,
       'one client gets ten starts a minute, whichever orders they are for; another client is unaffected',
       `${mine.join(',')} then ${over.status}, other ${other.status}`)
    const logLine = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).find((e) => e.event === 'pay.init' && e.trackid === TWO)
    is(logLine?.ip === '192.0.2.77', 'and the payment log records the SHOPPER, not the proxy in front', logLine?.ip ?? '(none)')

    // Thirty returns a minute per client, refused before CBK is asked.
    await sql('delete from rate_limit')
    await resetCalls()
    const back = []
    for (let i = 1; i <= 31; i++) back.push((await from('192.0.2.90', `pay/callback.php?encrp=JUNKR${i}`)).status)
    const c4 = await calls()
    const elsewhere = await from('192.0.2.91', 'pay/callback.php?encrp=JUNKR99')
    is(back.slice(0, 30).every((st) => st === 302) && back[30] === 429 && (c4.GetTransactions ?? 0) === 30
       && elsewhere.status === 302,
       'thirty callbacks a minute from one client; the 31st is 429 with no call to CBK, and another client is answered',
       `${back[30]} GetTransactions=${c4.GetTransactions ?? 0} other=${elsewhere.status}`)
  } finally {
    srv.kill()
    await sql(`delete from orders where track_id like 'SPRL_${tag}'; delete from rate_limit`)
    fs.rmSync(T, { recursive: true, force: true })
  }
}

console.log(fails ? `\n${fails} problem(s) in the T-Pay path` : '\nT-Pay: the online payment path is alive end to end')
process.exit(fails ? 1 : 0)
