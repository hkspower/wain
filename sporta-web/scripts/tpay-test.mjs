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
//   * a cancel leaves the order unpaid.
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
await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])

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

await run('rm', ['-f', '/tmp/.cbk_token_test.json', '/tmp/fake-cbk-txns.json'])
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

// -------------------------------------------------------- paying twice over
head('an order cannot be paid twice')
{
  const res = await get(`${PAY}/pay.php?trackid=SPTPAY0002`)
  is(res.status === 409, 'pay.php refuses an order that is already paid', `${res.status}`)
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
  is(row.startsWith('failed'), 'the order is marked FAILED rather than left pending for ever', row)
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

console.log(fails ? `\n${fails} problem(s) in the T-Pay path` : '\nT-Pay: the online payment path is alive end to end')
process.exit(fails ? 1 : 0)
