// The KNET card path, end to end, against a real MariaDB and a fake bank that
// speaks the real Tranportal protocol (scripts/fake-knet-bank.php).
//
// What this proves, and why each matters:
//
//   * the AES-128-CBC trandata this code produces is decryptable by an
//     INDEPENDENT implementation (Node's crypto, below) with the resource key
//     as both the key and the IV, exactly as KNET's plug-in does it
//     (AESAlgorithm.java:22, :44; there is no fixed IV) — if the encryption
//     were subtly wrong, the bank would reject every payment and no unit test
//     of our own helpers would ever notice, because they would be wrong in
//     both directions;
//   * the trandata PLAINTEXT is the plug-in's, byte for byte: values RAW (no
//     URL encoding), every pair followed by '&', no empty pairs, the plug-in's
//     field order — read here and by the fake bank the way the plug-in's own
//     reader reads it (split on '&' and '=', decode nothing), so an encoded
//     value fails (KNET-IPAYPIPE-CHECK.md D1, D5, D7);
//   * the amount charged comes from the DATABASE, never from the browser;
//   * the customer gets home whichever way the gateway hands off (the
//     REDIRECT= token, not just a 302);
//   * a replayed callback does not double-pay, double-stamp or double-email;
//   * everything unverifiable fails CLOSED.
//
//   npm run test:knet
//   (needs MariaDB, php -S :8095 php-store, :8097 scripts, :8098 php-knet)
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const KNET = process.env.KNET_BASE ?? 'http://127.0.0.1:8098'
const BANK = process.env.BANK_BASE ?? 'http://127.0.0.1:8097'
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
const KEY = 'abcdef0123456789'
const IV = KEY // KNET's RAW PHP/JSP samples use the resource key as the IV too

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
// Each section starts with an empty rate-limit table: pay.php is limited to ten
// starts a minute per client and every request here is one client (127.0.0.1),
// so a suite that is quick enough to cross ten starts in one minute would
// otherwise fail on the limiter instead of on the rule it is checking. The
// limiter itself has its own section below, which serves a proxy-aware copy.
const head = (t) => {
  execFileSync('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
}

// The sandbox's payment log only ever grows, and `cat` through execFile fails
// past its 1 MiB buffer — which read as "nothing was logged". Read the file.
const readLog = () => { try { return readFileSync('/tmp/knet-test.log', 'utf8') } catch { return '' } }

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

// An INDEPENDENT implementation of KNET's crypto. Deliberately written from
// the spec rather than by calling the PHP — two implementations that agree is
// evidence; one implementation agreeing with itself is not.
const decrypt = (hex) => {
  const d = crypto.createDecipheriv('aes-128-cbc', KEY, IV)
  return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8')
}
const encrypt = (plain) => {
  const c = crypto.createCipheriv('aes-128-cbc', KEY, IV)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase()
}
// The plug-in's reader (iPayPipe.parsetrandata, :776-779): split on '&', split
// each pair on '=' (Java's split drops trailing empty strings), keep only a pair
// that is exactly two parts, and DECODE NOTHING. It used to decodeURIComponent
// every value, which made an encoded request and a raw one look the same.
const parse = (qs) => Object.fromEntries(
  qs.split('&').filter(Boolean).map((p) => {
    const parts = p.split('=')
    while (parts.length && parts[parts.length - 1] === '') parts.pop()
    return parts
  }).filter((parts) => parts.length === 2),
)
// The sandbox's own KNET config, for the values the bank must receive verbatim.
const KNET_CFG = JSON.parse(execFileSync('php', ['-r',
  `echo json_encode(require '${new URL('../dropin/php-knet/config.php', import.meta.url).pathname}');`]).toString())
// The plaintext the plug-in would encrypt for these values: buildHostRequest's
// order (iPayPipe.java:185-268), then id and password (:145-146), every pair
// followed by '&', an empty value left out.
const pluginPlain = (f) => ['amt', 'action', 'responseURL', 'errorURL', 'trackid', 'udf1', 'udf2', 'udf3', 'udf4', 'udf5',
  'currencycode', 'langid', 'id', 'password'].filter((k) => (f[k] ?? '') !== '').map((k) => `${k}=${f[k]}&`).join('')

// The endpoints refuse plain HTTP, exactly as they will on Hostinger; the
// proxy header is how the edge says TLS was terminated upstream.
const HTTPS = { 'X-Forwarded-Proto': 'https' }
const get = (url) => fetch(url, { headers: HTTPS, redirect: 'manual' })
const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual',
  })

// A real order, made the way the storefront makes one — priced by the server.
const newOrder = async (track) => {
  const res = await fetch(`${API}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track,
      items: [{ slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'L', fit: 'oversize' }],
      customer: {
        name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli',
        area: 'Salmiya', block: '4', street: '12', building: '5',
      },
      payment_method: 'knet',
    }),
  })
  return res.json()
}

await sql('delete from fulfilment_outbox; delete from order_items; delete from orders;')

// ------------------------------------------------------- the handoff to KNET
head('pay.php hands the bank the right numbers')
{
  const order = await newOrder('SPKNET0001')
  // 2 x 10.000 of goods + 1.000 delivery. The fee is part of what the BANK is
  // asked for, so this assertion is the one that would catch delivery being
  // quoted to the customer but not charged, or charged twice.
  is(order.amount === 21, 'an order exists, priced by the server (goods + delivery)', `${order.amount} KWD`)

  const res = await get(`${KNET}/pay.php?trackid=SPKNET0001&lang=ar`)
  const loc = res.headers.get('location') ?? ''
  is(res.status === 302 && loc.startsWith(BANK), 'the shopper is sent to the gateway', `${res.status}`)

  const sent = parse(decrypt(new URL(loc).searchParams.get('trandata')))
  is(true, 'the trandata decrypts with an INDEPENDENT AES implementation')
  // What the BANK is asked for. Goods + delivery, and it must equal orders.amount
  // exactly — this is the number the customer's card is debited.
  is(sent.amt === '21.000', 'the amount is the ORDER total, in fils-exact form', sent.amt)
  is(sent.trackid === 'SPKNET0001', 'the track id is carried')
  is(sent.id === 'TESTID001' && sent.password === 'testpass', 'the Tranportal credentials are inside the ENCRYPTED blob')
  is(sent.langid === 'AR', 'the shopper’s language reaches the bank page', sent.langid)
  is(sent.currencycode === '414' && sent.action === '1', 'currency KWD, action purchase')
  is(sent.responseURL.includes('callback.php'), 'the response URL points at our callback')

  // D1 / D5 / D7: the plaintext is the plug-in's, not a URL-encoded cousin of it.
  const trandata = new URL(loc).searchParams.get('trandata')
  const plain = decrypt(trandata)
  is(plain.includes(`responseURL=${KNET_CFG.response_url}&`) && plain.includes(`errorURL=${KNET_CFG.error_url}&`),
     'the response and error URLs are inside the trandata VERBATIM (raw "://", not %3A%2F%2F)', plain.match(/responseURL=[^&]*/)?.[0])
  is(!plain.includes('%'), 'no value inside the trandata is percent-encoded')
  is(!/(^|&)[A-Za-z0-9]+=(&|$)/.test(plain) && !/udf[1-4]=/.test(plain),
     'no empty pair is sent (no "udf1=" .. "udf4="): the plug-in never sends an empty field')
  is(plain.endsWith('&') && plain.split('&').filter(Boolean).map((p) => p.split('=')[0]).join(',')
     === 'amt,action,responseURL,errorURL,trackid,udf5,currencycode,langid,id,password',
     "the plug-in's field order, every pair followed by '&'", plain.split('&').filter(Boolean).map((p) => p.split('=')[0]).join(','))
  const expected = pluginPlain({ amt: '21.000', action: '1', responseURL: KNET_CFG.response_url, errorURL: KNET_CFG.error_url,
    trackid: 'SPKNET0001', udf5: 'SPKNET0001', currencycode: '414', langid: 'AR', id: 'TESTID001', password: 'testpass' })
  is(plain === expected && trandata === encrypt(expected),
     'BYTE FOR BYTE the trandata the official plug-in would build for the same values (rebuilt independently, same ciphertext)',
     trandata.slice(0, 32))
}

// ------------------------------------------------ the browser cannot set the price
head('the browser cannot choose what it pays')
{
  const res = await get(`${KNET}/pay.php?trackid=SPKNET0001&amount=0.100`)
  const sent = parse(decrypt(new URL(res.headers.get('location')).searchParams.get('trandata')))
  is(sent.amt === '21.000', 'an amount in the URL is IGNORED, not charged', sent.amt)

  const unknown = await get(`${KNET}/pay.php?trackid=NOSUCHORDER&amount=0.100`)
  is(unknown.status === 404, 'an invented track id is refused, not priced by the browser', `${unknown.status}`)

  const badTrack = await get(`${KNET}/pay.php?trackid=../../etc/passwd`)
  is(badTrack.status === 400, 'a malformed track id is rejected', `${badTrack.status}`)
}

// ------------------------------------------------------------ the bank pays
head('a captured payment is recorded')
{
  const order = await newOrder('SPKNET0002')
  const pay = await get(`${KNET}/pay.php?trackid=SPKNET0002`)
  const url = new URL(pay.headers.get('location'))
  const bank = await (await fetch(`${BANK}/fake-knet-bank.php?${url.searchParams}&outcome=captured`)).json()

  is(bank.bank_result === 'CAPTURED', 'the bank captured the payment')
  is(bank.response_url === KNET_CFG.response_url && bank.empty_pairs === 0,
     'a RAW reader (the fake bank parses like the plug-in) finds the exact response URL and no empty pair', bank.response_url)
  is(bank.merchant_code === 200, 'the callback answered 200, not a bare redirect', `${bank.merchant_code}`)
  is(bank.used_token === true,
     'the callback speaks REDIRECT= — a server-to-server gateway can bring the customer home')
  is(bank.strict_reply === true,
     'and the reply is ONLY that line — no HTML, no 302 (K-064 §5: anything else risks auto-void)')
  is(bank.landing.includes('status=success') && bank.landing.includes('SPKNET0002'),
     'the customer lands on the success page', bank.landing.split('?')[1] ?? '')
  // The receipt (K-063 D1/D5): the language the order was placed in, and the
  // order's signed key, so the result page can ask the server for the bank's
  // fields (scripts/payment-receipt-test.mjs proves what that key opens).
  const landQ = new URL(bank.landing).searchParams
  is(landQ.get('lang') === 'ar' && /^\d{9,11}\.[a-f0-9]{32}$/.test(landQ.get('k') ?? ''),
     'and the landing carries the order\'s language and its receipt key', `lang=${landQ.get('lang')} k=${(landQ.get('k') ?? '').slice(0, 14)}`)

  const row = (await sql(
    "select payment_status, paid_at is not null, cbk_status, cbk_paymentid <> '' from orders where track_id='SPKNET0002'",
  )).split('\t')
  is(row[0] === 'paid', 'the order is PAID in MySQL', row[0])
  is(row[1] === '1', 'paid_at is stamped')
  is(row[2] === 'CAPTURED' && row[3] === '1', 'the bank’s reference numbers are stored for reconciliation')

  const outbox = await sql("select count(*) from fulfilment_outbox where kind='payment' and order_id=(select id from orders where track_id='SPKNET0002')")
  is(outbox === '1', 'exactly one "payment received" message is queued for the warehouse', outbox)
  void order
}

// --------------------------------------------------- a declined card retries
//
// KNET wants the track id unique per ATTEMPT. The shop sent orders.track_id,
// which is unique per ORDER — and the checkout deliberately REUSES that id on a
// retry, because it is the idempotency key that stops a double tap buying
// twice. So the second attempt handed the bank an id it had already seen, and
// the bank is entitled to refuse it: a declined card became an unrecoverable
// checkout for a reason that had nothing to do with the card.
head('a second attempt gets its own reference; a declined order is closed')
{
  await newOrder('SPKNET0RETRY')

  // First attempt — the shopper reaches the bank page and backs out without
  // paying, so no callback arrives and the order is still pending.
  const one = await get(`${KNET}/pay.php?trackid=SPKNET0RETRY`)
  const sentOne = parse(decrypt(new URL(one.headers.get('location')).searchParams.get('trandata')))
  is(sentOne.trackid === 'SPKNET0RETRY',
     'the FIRST attempt sends the order id unchanged — the common case is untouched',
     sentOne.trackid)

  // They tap "pay" again — same basket, so the SAME order and track id.
  const two = await get(`${KNET}/pay.php?trackid=SPKNET0RETRY`)
  const sentTwo = parse(decrypt(new URL(two.headers.get('location')).searchParams.get('trandata')))
  is(sentTwo.trackid !== sentOne.trackid,
     'the RETRY sends a different reference, so the bank cannot refuse it as a duplicate',
     `${sentOne.trackid} -> ${sentTwo.trackid}`)
  is(sentTwo.trackid.startsWith('SPKNET0RETRY'),
     'and it still carries the order number, so a bank statement can be reconciled',
     sentTwo.trackid)
  is(sentTwo.trackid.length <= 30, 'within the field the gateway accepts', String(sentTwo.trackid.length))
  is(sentTwo.udf5 === 'SPKNET0RETRY', 'udf5 carries the order id, set by the server', sentTwo.udf5)

  // THE PART THAT MUST NOT BREAK: the callback comes back carrying the RETRY
  // reference, and has to settle the original order.
  const captured = await (await fetch(
    `${BANK}/fake-knet-bank.php?${new URL(two.headers.get('location')).searchParams}&outcome=captured`)).json()
  is(captured.bank_result === 'CAPTURED', 'the retry is captured')
  is(captured.merchant_code === 200, 'and the callback answers 200', `${captured.merchant_code}`)

  const row = (await sql(
    "select payment_status, paid_at is not null, pay_attempt from orders where track_id='SPKNET0RETRY'")).split('\t')
  is(row[0] === 'paid',
     'THE ORIGINAL ORDER settles, even though the bank echoed the retry reference', row[0])
  is(row[1] === '1', 'with paid_at stamped')
  is(Number(row[2]) === 2, 'and the attempt counter says it took two', row[2])

  // A DECLINED order is closed: the decline released its stock and queued a
  // "do not ship" message, so charging it later would sell garments that may
  // already be someone else's. The shopper starts a new checkout instead.
  await newOrder('SPKNET0DECL')
  const d1 = await get(`${KNET}/pay.php?trackid=SPKNET0DECL`)
  await (await fetch(
    `${BANK}/fake-knet-bank.php?${new URL(d1.headers.get('location')).searchParams}&outcome=notcaptured`)).json()
  is(await sql("select payment_status from orders where track_id='SPKNET0DECL'") === 'failed',
     'a decline marks the order failed')
  const d2 = await get(`${KNET}/pay.php?trackid=SPKNET0DECL`)
  is(d2.status === 409 && !d2.headers.get('location'),
     'and it cannot be sent to the bank again', `${d2.status}`)
}

// ------------------------------------------------------------- replay safety
head('a replayed callback changes nothing')
{
  const [before, payid] = (await sql("select paid_at, cbk_paymentid from orders where track_id='SPKNET0002'")).split('\t')
  const alerts = () => sql("select count(*) from payment_alerts where order_id=(select id from orders where track_id='SPKNET0002')")
  // The bank retries; the customer refreshes the return page. Same trandata:
  // the SAME Payment ID.
  const res = await post(`${KNET}/callback.php`, {
    trandata: encrypt(`result=CAPTURED&trackid=SPKNET0002&amt=21.000&paymentid=${payid}&ref=R1`),
  })
  is(res.status === 200, 'the replay is answered cleanly', `${res.status}`)
  is(await alerts() === '0', 'a replay of the SAME payment is a silent no-op: no alert (K-063 B3)')

  // A CAPTURED under a DIFFERENT Payment ID is not a replay: it is a second
  // charge on a paid order (K-063 B3). It used to be answered "already_paid"
  // with nothing written; it is kept as an alert and changes nothing else.
  const dup = await post(`${KNET}/callback.php`, {
    trandata: encrypt('result=CAPTURED&trackid=SPKNET0002&amt=21.000&paymentid=REPLAY1&ref=R1'),
  })
  is(dup.status === 200 && (await dup.text()).includes('status=success'), 'a second capture is answered cleanly, and the shopper sees the paid order')
  is(await alerts() === '1' && await sql("select concat(payment_id,'|',order_payment_id) from payment_alerts where order_id=(select id from orders where track_id='SPKNET0002')") === `REPLAY1|${payid}`,
     'and it is KEPT as a payment alert: the extra Payment ID beside the one the order records')

  const after = await sql("select paid_at from orders where track_id='SPKNET0002'")
  is(before === after, 'paid_at is NOT re-stamped', `${before} → ${after}`)
  is(await sql("select cbk_paymentid from orders where track_id='SPKNET0002'") === payid, 'the order keeps its own Payment ID')
  const outbox = await sql("select count(*) from fulfilment_outbox where kind='payment' and order_id=(select id from orders where track_id='SPKNET0002')")
  is(outbox === '1', 'the warehouse is NOT emailed a second time', outbox)

  // A late failure must never undo a captured payment.
  await post(`${KNET}/callback.php`, {
    trandata: encrypt('result=NOT CAPTURED&trackid=SPKNET0002&amt=21.000&paymentid=LATE&ref=R2'),
  })
  const status = await sql("select payment_status from orders where track_id='SPKNET0002'")
  is(status === 'paid', 'a late failure callback cannot downgrade a paid order', status)
}

// ------------------------------------------------------------- failing paths
head('everything unverifiable fails closed')
{
  const order = await newOrder('SPKNET0003')
  is(order.track_id === 'SPKNET0003', 'a second order exists')

  // The bank says captured, but for the WRONG amount.
  const pay = await get(`${KNET}/pay.php?trackid=SPKNET0003`)
  const url = new URL(pay.headers.get('location'))
  const bank = await (await fetch(`${BANK}/fake-knet-bank.php?${url.searchParams}&outcome=captured&amt=0.100`)).json()
  // Money WAS captured, just the wrong amount, so the order goes to REVIEW (an
  // operator refunds or collects the difference) — never to success, and not
  // to "failed" either, which would release the stock and forget the money.
  is(!bank.landing.includes('status=success') && bank.landing.includes('status=review'),
     'an underpayment is NOT treated as success — it is held for review', bank.landing.split('?')[1] ?? '')
  const st = await sql("select payment_status, cbk_status from orders where track_id='SPKNET0003'")
  is(st.split('\t')[1] === 'AMOUNT_MISMATCH', 'and it is recorded as an amount mismatch', st)

  // A cancelled payment.
  await newOrder('SPKNET0004')
  const p4 = await get(`${KNET}/pay.php?trackid=SPKNET0004`)
  const b4 = await (await fetch(`${BANK}/fake-knet-bank.php?${new URL(p4.headers.get('location')).searchParams}&outcome=canceled`)).json()
  is(b4.landing.includes('status=cancelled'), 'a cancelled payment sends the shopper to the cancelled page')
  is((await sql("select payment_status from orders where track_id='SPKNET0004'")) === 'failed',
     'and the order is left unpaid')

  // Garbage in the trandata: someone poking the endpoint by hand.
  const junk = await post(`${KNET}/callback.php`, { trandata: 'DEADBEEF' })
  const junkBody = await junk.text()
  is(junkBody.includes('reason=decrypt_failed'), 'an undecryptable callback is refused, not trusted')

  // A payment for an order that does not exist cannot invent one.
  await post(`${KNET}/callback.php`, {
    trandata: encrypt('result=CAPTURED&trackid=GHOSTORDER&amt=99.000&paymentid=X&ref=Y'),
  })
  is((await sql("select count(*) from orders where track_id='GHOSTORDER'")) === '0',
     'a callback for an unknown order creates nothing')
}

// -------------------------------------------------------- paying twice over
head('an order cannot be paid twice')
{
  const res = await get(`${KNET}/pay.php?trackid=SPKNET0002`)
  is(res.status === 409, 'pay.php refuses an order that is already paid', `${res.status}`)
}

// ------------------------------------- the payment the callback never brought
head('a captured card whose callback never arrived')
{
  // The shopper paid and closed the tab: money at the bank, order at pending.
  await newOrder('SPKNET0005')
  const admin = async (route, body) => {
    const res = await fetch(`${API.replace('8095', '8095')}/admin.php?r=${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  let cookie = ''
  await admin('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
  const id = await sql("select id from orders where track_id='SPKNET0005'")

  const noRef = await admin('card_settled', { order_id: Number(id), bank_reference: '' })
  is(noRef.body?.error === 'bank_reference_required',
     'it cannot be settled on a hunch — the bank’s payment id is required', noRef.body?.error)

  const cash = await admin('cod_paid', { order_id: Number(id), paid: true })
  is(cash.body?.error === 'not_a_cash_order', 'and the cash control still refuses cards')

  const settled = await admin('card_settled', { order_id: Number(id), bank_reference: '100202998877' })
  is(settled.body?.payment_status === 'paid', 'with the payment id, the operator can settle it', settled.body?.payment_status)
  is(settled.body?.cbk_status === 'MANUAL_BANK_CONFIRMED',
     'and it is recorded as MANUAL, never mistakable for the bank’s own callback')

  const outbox = await sql("select count(*) from fulfilment_outbox where kind='payment' and order_id=" + id)
  is(outbox === '1', 'the warehouse is told to ship it, exactly once', outbox)

  const again = await admin('card_settled', { order_id: Number(id), bank_reference: '100202998877' })
  is(again.body?.error === 'order_already_paid', 'settling twice is refused')
}

// --------------------------------------------------------------- the audit log
head('K-064: results, browsers and the error URL')
{
  // APPROVED is not a KNET purchase result; only CAPTURED means paid.
  await newOrder('SPKNET0APPR')
  const ap = await post(`${KNET}/callback.php`, {
    trandata: encrypt('result=APPROVED&trackid=SPKNET0APPR&amt=21.000&paymentid=AP1&ref=R1&tranid=T1'),
  })
  const apBody = await ap.text()
  is(!apBody.includes('status=success'), "'APPROVED' is not treated as paid", apBody.slice(0, 80))
  is(await sql("select payment_status from orders where track_id='SPKNET0APPR'") !== 'paid',
     'and the order is not marked paid')

  // A browser landing on the callback gets a 302, not a plain-text page.
  await newOrder('SPKNET0BROW')
  const br = await fetch(`${KNET}/callback.php`, {
    method: 'POST', redirect: 'manual',
    headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded',
      'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
    body: new URLSearchParams({ trandata: encrypt('result=NOT CAPTURED&trackid=SPKNET0BROW&amt=21.000&paymentid=B1') }),
  })
  is(br.status === 302 && (br.headers.get('location') ?? '').includes('/payment/result'),
     'a browser is sent on with a 302', `${br.status}`)

  // The error URL: no trandata, Error/ErrorText in the query. Logged, and the
  // order is NOT touched — the request is unauthenticated.
  await newOrder('SPKNET0ERRU')
  const er = await get(`${KNET}/callback.php?Error=IPAY0100048&ErrorText=Cancelled&trackid=SPKNET0ERRU&paymentid=E1`)
  const erBody = await er.text()
  is(erBody.includes('reason=bank_error'), 'the error URL reports a bank error to the shopper', erBody.slice(0, 90))
  // K-063 check, order-page findings 2 and 3: the failure page gets the order's
  // own track id, the bank's Payment ID and the order's language; NEVER the
  // receipt key (anyone can open this address with anyone's track id).
  const erQ = new URL(erBody.replace(/^REDIRECT=/, '').trim()).searchParams
  // Named `order`, not `trackid` (review 3, finding 2): the compiled result page reads `trackid` and calls a pending order
  // "Payment received ... Do not pay again"; only the add-on reads `order`.
  is(erQ.get('order') === 'SPKNET0ERRU' && !erQ.has('trackid') && erQ.get('payid') === 'E1' && erQ.get('lang') === 'ar',
     'and keeps the order number (as order=, never trackid=), the Payment ID and the order\'s language on the redirect', erQ.toString())
  is(!erQ.has('k'), 'but never the receipt key', erQ.toString())
  const erJunk = await get(`${KNET}/callback.php?Error=X&trackid=${encodeURIComponent('<b>x</b>')}&paymentid=${encodeURIComponent('1"onload')}`)
  const erJ = new URL((await erJunk.text()).replace(/^REDIRECT=/, '').trim()).searchParams
  is(!erJ.has('trackid') && !erJ.has('order') && !erJ.has('payid') && !erJ.has('lang'), 'a malformed track id or Payment ID is not passed on', erJ.toString())
  is(await sql("select payment_status from orders where track_id='SPKNET0ERRU'") === 'pending',
     'and an unauthenticated error-URL hit cannot fail someone else\'s order')
  const log = readLog()
  is(log.includes('"event":"callback.error_url"') && log.includes('IPAY0100048'),
     'the bank error code is logged (K-064 §13.1)')
  is(/"event":"callback.received".*"raw":"[0-9A-F]+".*/.test(log) || /"event":"callback.received".*"fields":\{/.test(log),
     'the encrypted and decrypted response are both kept (K-064 §5)')
}

// ------------------------------------ a capture after the shop cancelled it
//
// The shopper is at the bank; the owner cancels the order by hand (the
// warehouse is told "do not ship"; the stock is not yet released, because the
// sweeper has not run). The bank then captures the money. The callback must
// hold that payment for review: a "PAYMENT CONFIRMED — ship it" queued after a
// "CANCELLED — do not ship" would be an instruction the shop has withdrawn.
head('a capture after the shop cancelled the order is held for review, not paid')
{
  let cookie = ''
  const admin = async (route, body) => {
    const res = await fetch(`${API}/admin.php?r=${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  await admin('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
  await newOrder('SPKNET0030')
  const id = Number(await sql("select id from orders where track_id='SPKNET0030'"))
  const pay = await get(`${KNET}/pay.php?trackid=SPKNET0030`)
  const url = new URL(pay.headers.get('location'))
  const cancel = await admin('fulfilment', { order_id: id, status: 'cancelled' })
  is(cancel.status === 200 && cancel.body?.ok === true, 'the owner cancels the order while the customer is at the bank',
     `${cancel.status} ${cancel.body?.error ?? ''}`)
  await (await fetch(`${BANK}/fake-knet-bank.php?${url.searchParams}&outcome=captured`)).json()

  const row = (await sql(
    "select payment_status, cbk_status, stock_released from orders where track_id='SPKNET0030'",
  )).split('\t')
  is(row[0] === 'review' && row[1] === 'ORDER_CANCELLED',
     'the captured payment is held for review, with the reason recorded', row.join(' / '))
  is(row[0] !== 'paid', 'and it is not marked paid')
  const shipIt = await sql(`select count(*) from fulfilment_outbox where kind = 'payment' and order_id = ${id}`)
  is(shipIt === '0', 'and no "payment received — ship it" is queued for it', shipIt)
}

// ------------------------------------- what a stranger can make this server do
//
// pay.php and callback.php are unauthenticated by design — the storefront sends
// the shopper to one, the bank (or the shopper's browser) to the other — and
// both write to the payment log, which lives on the private mount that also
// holds the admin sessions. The T-Pay twin has had a per-client limit and a
// per-order ceiling since its own suite found the hole; KNET had neither, so
// this block holds the pair to the same standard:
//   * pay.php: ten starts a minute per client, ten starts per ORDER, each
//     refused BEFORE a reference is allocated, a log line is written or the
//     bank is sent anything;
//   * callback.php: a ceiling per client high enough that the bank's own
//     notification is never the thing refused, and a log that keeps only the
//     first ten payloads a minute of what cannot be decrypted.
//
// The sandbox's :8098 serves dropin/php-knet with no api/ beside it, so it has
// no shared resolver and no proxy to trust — every request is one client. This
// block serves a copy in the live layout (T/api, T/knet) whose store config
// trusts 127.0.0.1 as its proxy, so X-Forwarded-For names the client exactly
// as Traefik does on the VPS.
head('a stranger cannot flood the payment log or the bank')
{
  const fs = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const net = await import('node:net')
  const { spawn } = await import('node:child_process')
  const WEB = new URL('..', import.meta.url).pathname
  const T = fs.mkdtempSync(join(tmpdir(), 'sporta-knet-rl-'))
  fs.cpSync(join(WEB, 'dropin/php-store'), join(T, 'api'), { recursive: true })
  fs.cpSync(join(WEB, 'dropin/php-knet'), join(T, 'knet'), { recursive: true })
  const isFree = (p) => new Promise((res) => {
    const x = net.createServer().once('error', () => res(false))
      .once('listening', () => x.close(() => res(true))).listen(p, '127.0.0.1')
  })
  let port = 8221
  while (!(await isFree(port))) port++
  const B = `http://127.0.0.1:${port}`
  const LOG = join(T, 'knet.log')
  fs.writeFileSync(join(T, 'api', 'config.php'),
    `<?php return ['trusted_proxy_ips' => ['127.0.0.1']] + (require '${join(WEB, 'dropin/php-store/config.php')}');\n`)
  await run('php', ['-r', `$c = require '${join(WEB, 'dropin/php-knet/config.php')}';`
    + ` $c['log_file'] = '${LOG}'; $c['response_url'] = '${B}/knet/callback.php'; $c['error_url'] = '${B}/knet/callback.php';`
    + ` file_put_contents('${join(T, 'knet', 'config.php')}', '<?php return ' . var_export($c, true) . ';');`])
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', T], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}/api/api.php?r=checkout_config`); break } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  const from = (ip, path, init = {}) => fetch(`${B}/${path}`, {
    redirect: 'manual', ...init, headers: { ...HTTPS, 'X-Forwarded-For': ip, ...(init.headers ?? {}) } })
  const junkPost = (ip, trandata) => from(ip, 'knet/callback.php', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ trandata }) })
  const pending = (track) => sql(`insert into orders (track_id, amount, subtotal, payment_method, payment_status)
                                  values ('${track}', 9.000, 9.000, 'knet', 'pending')`)
  const logEvents = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const count = (ev, extra = () => true) => logEvents().filter((e) => e.event === ev && extra(e)).length
  const tag = Date.now().toString(36).toUpperCase()
  try {
    await sql('delete from rate_limit')

    // Ten starts per ORDER. Eleven different clients, so the per-client limit
    // is not what stops the eleventh.
    const ONE = `SPRLA${tag}`
    await pending(ONE)
    const starts = []
    for (let i = 1; i <= 11; i++) starts.push(await from(`198.51.100.${i}`, `knet/pay.php?trackid=${ONE}`))
    const lastText = await starts[10].text()
    is(starts.slice(0, 10).every((r) => r.status === 302) && starts[10].status === 429 && /new checkout/i.test(lastText),
       'one order can be sent to the bank ten times; the eleventh is refused with 429',
       starts.map((r) => r.status).join(','))
    is(count('pay.init', (e) => e.trackid === ONE) === 10,
       'and only ten paymentInit lines were written — the refused start logs no request', String(count('pay.init', (e) => e.trackid === ONE)))
    is(await sql(`select pay_attempt from orders where track_id = '${ONE}'`) === '10',
       'and the counter stopped at ten — a refused start does not allocate a reference')
    is(count('pay.reject', (e) => e.reason === 'too_many_attempts' && e.trackid === ONE) === 1,
       'and the refusal itself is on the record, once')

    // Ten starts a minute per CLIENT, whichever orders they are for.
    await sql('delete from rate_limit')
    const [TWO, THREE] = [`SPRLB${tag}`, `SPRLC${tag}`]
    await pending(TWO)
    await pending(THREE)
    const mine = []
    for (let i = 0; i < 10; i++) mine.push((await from('192.0.2.77', `knet/pay.php?trackid=${TWO}`)).status)
    const over = await from('192.0.2.77', `knet/pay.php?trackid=${THREE}`)
    const overText = await over.text()
    const other = await from('192.0.2.78', `knet/pay.php?trackid=${THREE}`)
    is(mine.every((st) => st === 302) && over.status === 429 && /wait a minute/i.test(overText)
       && /^\d+$/.test(over.headers.get('retry-after') ?? '') && other.status === 302,
       'one client gets ten starts a minute, whichever orders they are for; another client is unaffected',
       `${mine.join(',')} then ${over.status}, other ${other.status}`)
    is(count('pay.init', (e) => e.trackid === THREE) === 1 && await sql(`select pay_attempt from orders where track_id = '${THREE}'`) === '1',
       'and the refused start consumed no attempt number and wrote no request line')
    const initLine = logEvents().find((e) => e.event === 'pay.init' && e.trackid === TWO)
    is(initLine?.ip === '192.0.2.77', 'and the payment log records the SHOPPER, not the proxy in front', initLine?.ip ?? '(none)')

    // callback.php: junk that cannot be decrypted. Twelve 4 kB posts from one
    // client are each answered as before, but only the first ten are logged.
    await sql('delete from rate_limit')
    const before = count('callback.decrypt_failed')
    const junk = []
    for (let i = 0; i < 12; i++) junk.push(await junkPost('203.0.113.9', 'AB'.repeat(2048)))
    const bodies = await Promise.all(junk.map((r) => r.text()))
    is(junk.every((r) => r.status === 200) && bodies.every((b) => b.includes('reason=decrypt_failed')),
       'twelve junk callbacks from one client are each answered and sent on to the result page',
       [...new Set(junk.map((r) => r.status))].join(','))
    is(count('callback.decrypt_failed') - before === 10,
       'but the log keeps the first ten, not twelve — a loop cannot fill the private mount',
       String(count('callback.decrypt_failed') - before))
    const sizeBefore = fs.statSync(LOG).size
    for (let i = 0; i < 20; i++) await junkPost('203.0.113.9', 'CD'.repeat(2048))
    is(fs.statSync(LOG).size === sizeBefore, 'and past the ten the log does not grow by a byte', `${fs.statSync(LOG).size - sizeBefore} bytes`)
    const errBefore = count('callback.error_url')
    for (let i = 0; i < 15; i++) await from('203.0.113.10', `knet/callback.php?Error=E${i}&ErrorText=x&trackid=NOPE`)
    is(count('callback.error_url') - errBefore === 10, 'the error-URL leg is held to the same ten lines a minute',
       String(count('callback.error_url') - errBefore))

    // The real notification is never what is refused: this client has already
    // used up the junk allowance, and a valid CAPTURED post still settles.
    const PAID = `SPRLP${tag}`
    await pending(PAID)
    const good = await junkPost('203.0.113.9',
      encrypt(`result=CAPTURED&trackid=${PAID}&amt=9.000&paymentid=RL1&ref=R1&tranid=T1&udf5=${PAID}`))
    const goodBody = await good.text()
    is(good.status === 200 && goodBody.includes('status=success')
       && await sql(`select payment_status from orders where track_id = '${PAID}'`) === 'paid',
       'a genuine CAPTURED notification from a client that has spent its junk allowance still settles the order',
       `${good.status} ${goodBody.slice(0, 80)}`)

    // The ceiling on everything, at 120 a minute: past it, no decryption, no
    // log, no transaction. Another client is untouched.
    await sql('delete from rate_limit')
    const calls = []
    for (let i = 1; i <= 121; i++) calls.push((await from('192.0.2.200', 'knet/callback.php?Error=x&trackid=Z')).status)
    const elsewhere = await from('192.0.2.201', 'knet/callback.php?Error=x&trackid=Z')
    is(calls.slice(0, 120).every((st) => st === 200) && calls[120] === 429 && elsewhere.status === 200,
       'a client gets 120 callbacks a minute; the 121st is 429 and another client is answered',
       `${calls[120]} other=${elsewhere.status}`)
  } finally {
    srv.kill()
    await sql(`delete from orders where track_id like 'SPRL_${tag}'; delete from rate_limit`)
    fs.rmSync(T, { recursive: true, force: true })
  }
}

// --------------------------------------------- a private copy this suite owns
//
// The sections below need configs of their own (other passwords, https return
// URLs, the inquiry switched on), so they serve a copy in the live layout:
// T/api (the store), T/knet (the KNET drop-in, with T/knet/config.php written
// here), and T/bank, a copy of the fake bank reading THAT config, behind a
// router that also answers /bank/tranPipe.htm (the inquiry). Same MariaDB.
const { mkdtempSync, cpSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const WEB_DIR = new URL('..', import.meta.url).pathname
const privateRig = async (label) => {
  const net = await import('node:net')
  const { spawn } = await import('node:child_process')
  const T = mkdtempSync(join(tmpdir(), `sporta-knet-${label}-`))
  cpSync(join(WEB_DIR, 'dropin/php-store'), join(T, 'api'), { recursive: true })
  cpSync(join(WEB_DIR, 'dropin/php-knet'), join(T, 'knet'), { recursive: true })
  mkdirSync(join(T, 'bank'))
  copyFileSync(join(WEB_DIR, 'scripts/fake-knet-bank.php'), join(T, 'bank', 'fake-knet-bank.php'))
  writeFileSync(join(T, 'router.php'), `<?php
$p = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($p === '/bank/tranPipe.htm') { require __DIR__ . '/bank/fake-knet-bank.php'; return true; }
return false;
`)
  const isFree = (p) => new Promise((res) => {
    const x = net.createServer().once('error', () => res(false))
      .once('listening', () => x.close(() => res(true))).listen(p, '127.0.0.1')
  })
  let port = 8241
  while (!(await isFree(port))) port++
  const B = `http://127.0.0.1:${port}`
  const KCFG = join(T, 'knet', 'config.php')
  const LOG = join(T, 'knet.log')
  const STATE = join(T, 'bank-state.json')
  // Every run starts from the sandbox's KNET config plus these overrides. Sent
  // as base64 JSON so a CR, a NUL or a quote reaches PHP exactly.
  const writeCfg = (o = {}) => run('php', ['-r', `$c = require '${join(WEB_DIR, 'dropin/php-knet/config.php')}';`
    + ` $o = json_decode(base64_decode('${Buffer.from(JSON.stringify({
      log_file: LOG, test_url: `${B}/bank/fake-knet-bank.php`, response_url: `${B}/knet/callback.php`, error_url: `${B}/knet/callback.php`, ...o,
    })).toString('base64')}'), true);`
    + ` file_put_contents('${KCFG}', '<?php return ' . var_export($o + $c, true) . ';');`])
  await writeCfg()
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', T, join(T, 'router.php')],
    // Several workers: the fake bank calls the callback on this same server while
    // it is still answering the shopper's request, and one worker would deadlock.
    { stdio: 'ignore', env: { ...process.env, FAKE_KNET_CONFIG: KCFG, FAKE_KNET_STATE: STATE, PHP_CLI_SERVER_WORKERS: '4' } })
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}/api/api.php?r=checkout_config`); break } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  const logText = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8') : '')
  return {
    T, B, writeCfg, logText,
    log: () => logText().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    get: (path) => fetch(`${B}/${path}`, { headers: HTTPS, redirect: 'manual' }),
    post: (path, body) => fetch(`${B}/${path}`, {
      method: 'POST', redirect: 'manual', headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }),
    bank: () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { payments: {}, inquiries: [] }),
    bankEdit: (f) => { const s = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}; s.payments ??= {}; s.inquiries ??= []; f(s); writeFileSync(STATE, JSON.stringify(s)) },
    stop: () => { srv.kill(); if (process.env.KEEP_RIG) console.log(`KEEP_RIG: ${T}`); else rmSync(T, { recursive: true, force: true }) },
  }
}
const locOf = (res) => new URL(res.headers.get('location') ?? 'http://x/')
const plainOf = (res) => decrypt(locOf(res).searchParams.get('trandata') ?? '')

// ------------------------------------------- D1 / D6: raw values on the wire
head("the request is the plug-in's: raw values, special characters, refusals (D1, D6, D7)")
{
  const rig = await privateRig('raw')
  try {
    // https return URLs travel verbatim inside the trandata.
    await rig.writeCfg({ response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php', tranportal_password: 'Ab1.-_x' })
    await newOrder('SPKNETRAW1')
    const r1 = await rig.get('knet/pay.php?trackid=SPKNETRAW1')
    const p1 = plainOf(r1)
    is(r1.status === 302 && p1.includes('&responseURL=https://www.sporta.com.kw/knet/callback.php&errorURL=https://www.sporta.com.kw/knet/callback.php&'),
       'responseURL=https://… and errorURL=https://… are inside the trandata exactly as configured', p1.match(/responseURL=[^&]*/)?.[0])
    is(p1.endsWith('&id=TESTID001&password=Ab1.-_x&'), 'a password of letters, digits and . - _ is sent exactly as typed, last, as the plug-in appends it')
    is(locOf(r1).searchParams.get('responseURL') === 'https://www.sporta.com.kw/knet/callback.php',
       'the clear copy in the OUTER query string is an ordinary parameter (http_build_query there, as before)')

    // '@' and '!' are not separators: a raw reader must get them unchanged, and
    // the fake bank (which compares the RAW value) must accept the password.
    for (const [track, pw] of [['SPKNETPWA', 'p@ss!word'], ['SPKNETPWB', 'Ab1.-_x@!']]) {
      await rig.writeCfg({ tranportal_password: pw })
      await sql('delete from rate_limit')
      await newOrder(track)
      const r = await rig.get(`knet/pay.php?trackid=${track}`)
      is(plainOf(r).includes(`&password=${pw}&`), `the password ${pw} is inside the trandata unchanged, not URL-encoded`)
      const bank = await (await fetch(`${rig.B}/bank/fake-knet-bank.php?${locOf(r).searchParams}&outcome=captured`)).json()
      is(bank.merchant_code === 200 && bank.landing.includes('status=success')
         && await sql(`select payment_status from orders where track_id='${track}'`) === 'paid',
         `a raw reader accepts ${pw} as the Tranportal password and the payment settles`, `${bank.bank_error ?? bank.merchant_code}`)
    }

    // A config value the raw format cannot carry: refused before an attempt
    // number is used or anything is sent, the reason logged by FIELD, never value.
    await newOrder('SPKNETREF1')
    const refusals = [
      ['tranportal_password', 'a&b'], ['tranportal_password', 'a=b'], ['tranportal_password', 'a?b'], ['tranportal_password', 'a#b'],
      ['tranportal_password', 'a\rb'], ['tranportal_password', 'a\nb'], ['tranportal_password', 'a\u0000b'], ['tranportal_password', 'a\tb'],
      ['tranportal_password', 'a\u007fb'], ['tranportal_id', 'TEST&ID'], ['tranportal_id', 'TEST=ID'],
      ['response_url', `${rig.B}/knet/callback.php?x=1`], ['error_url', `${rig.B}/knet/callback.php#top`],
    ]
    for (const [field, value] of refusals) {
      await rig.writeCfg({ [field]: value })
      await sql('delete from rate_limit')
      const before = rig.log().length
      const r = await rig.get('knet/pay.php?trackid=SPKNETREF1')
      const lines = rig.log().slice(before)
      const err = lines.find((e) => e.event === 'pay.error')
      is(r.status === 503 && !r.headers.get('location') && (err?.error ?? '').startsWith(field + ' ')
         && !lines.some((e) => e.event === 'pay.init') && !JSON.stringify(lines).includes(JSON.stringify(value).slice(1, -1)),
         `${field} holding ${JSON.stringify(value)} is refused (503, nothing sent, the field named, the value not logged)`, err?.error)
    }
    is(await sql("select pay_attempt from orders where track_id='SPKNETREF1'") === '0', 'and none of those refusals used an attempt number')

    // The builder and the two copies of each rule, unit by unit.
    writeFileSync(join(rig.T, 'unit.php'), `<?php
require __DIR__ . '/knet/knet.php';
require __DIR__ . '/api/store.php';
$in = json_decode((string) file_get_contents('php://stdin'), true);
$out = ['built' => knet_build_trandata(['amt' => '1.000', 'udf1' => '', 'action' => '1', 'udf5' => 'X1', 'password' => 'p@ss!'])];
foreach ($in['bad'] as $v) { try { knet_build_trandata(['udf3' => $v]); $out['bad'][] = 'SENT'; } catch (KnetUnsafeValue $e) { $out['bad'][] = $e->getMessage(); } }
try { knet_build_trandata(['a&b' => '1']); $out['badkey'] = 'SENT'; } catch (KnetUnsafeValue $e) { $out['badkey'] = 'refused'; }
foreach ($in['values'] as $v) $out['raw'][] = [knet_raw_value_problem($v) === null, store_knet_raw_value_ok($v)];
foreach ($in['gateways'] as [$env, $url]) {
  $c = $in['base']; $c['env'] = $env; $c[$env === 'test' ? 'test_url' : 'production_url'] = $url;
  try { knet_assert_payment_config($c); $k = true; } catch (Throwable $e) { $k = false; }
  $out['gw'][] = [$k, store_knet_gateway_url_ok($url, $env)];
}
echo json_encode($out);
`)
    const BAD = ['a&b', 'a=b', 'a?b', 'a#b', 'a\rb', 'a\nb', 'a\u0000b', 'a\tb', 'a\u007fb', 'a\u001bb']
    const GOOD = ['testpass', 'Ab1.-_x', 'p@ss!word', 'Ab1.-_x@!', 'with space', 'https://www.sporta.com.kw/knet/callback.php', 'p+%ss']
    const K = '/kpg/PaymentHTTP.htm'
    const ACCEPT = [['test', `https://kpaytest.com.kw${K}`], ['test', `https://www.kpaytest.com.kw${K}`],
      ['production', `https://kpay.com.kw${K}`], ['production', `https://www.kpay.com.kw${K}`]]
    const NEAR = [
      ['test', `https://kpay.com.kw${K}`], ['test', `https://www.kpay.com.kw${K}`], ['production', `https://kpaytest.com.kw${K}`],
      ['production', `https://www.kpaytest.com.kw${K}`], ['test', `http://kpaytest.com.kw${K}`], ['production', `http://www.kpay.com.kw${K}`],
      ['test', `https://kpaytest.com.kw.evil.com${K}`], ['test', `https://evilkpaytest.com.kw${K}`], ['test', `https://wwwkpaytest.com.kw${K}`],
      ['test', `https://www2.kpaytest.com.kw${K}`], ['test', `https://www.www.kpaytest.com.kw${K}`], ['test', `https://kpaytest.com.kw.${K}`],
      ['test', `https://kpaytest.com${K}`], ['test', `https://kpaytest.com.kw.kw${K}`], ['test', `https://kpaytest-com.kw${K}`],
      ['test', `https://m.kpaytest.com.kw${K}`], ['production', `https://kpay.com.kw.evil.com${K}`], ['production', `https://www.kpay.com.kw.attacker.net${K}`],
      ['production', `https://wwww.kpay.com.kw${K}`], ['production', `https://www.kpay.com.kw.${K}`], ['production', `https://kpay.com.kw@evil.com${K}`],
      ['production', `https://evil.com\\@kpay.com.kw${K}`], ['production', `https://evil.com/kpay.com.kw${K}`], ['production', `https://kpay.com.kw:443${K}`],
      ['production', `https://kpay.com.kw:8443${K}`], ['production', `https://user:pw@kpay.com.kw${K}`], ['production', `https://kpay.com.kw${K}?x=1`],
      ['production', `https://kpay.com.kw${K}#f`], ['production', `https://kpay.com.kw${K}/`], ['production', 'https://kpay.com.kw/KPG/PaymentHTTP.htm'],
      ['production', 'https://kpay.com.kw/kpg/paymenthttp.htm'], ['production', 'https://kpay.com.kw/kpg/../kpg/PaymentHTTP.htm'],
      ['production', 'https://kpay.com.kw//kpg/PaymentHTTP.htm'], ['production', 'https://kpay.com.kw/kpg/tranPipe.htm'],
      ['production', `https://kpаy.com.kw${K}`], ['production', `https://xn--kpy-8cd.com.kw${K}`], ['production', `https://KPAY.COM.KW${K}`],
      ['production', ` https://kpay.com.kw${K}`], ['production', `https://kpay.com.kw${K}\n`], ['production', `https://kpay.com.kw${K}%00`],
      ['production', 'https://kpay.com.kw'], ['production', 'https://kpay.com.kw/kpg'],
    ]
    const base = { env: 'test', test_url: `https://kpaytest.com.kw${K}`, production_url: `https://kpay.com.kw${K}`, tranportal_id: 'TESTID001',
      tranportal_password: 'testpass', resource_key: KEY, response_url: 'https://www.sporta.com.kw/knet/callback.php',
      error_url: 'https://www.sporta.com.kw/knet/callback.php', language: 'USA' }
    const u = await new Promise((resolve, reject) => {
      const p = execFile('php', [join(rig.T, 'unit.php')], (e, out) => (e ? reject(e) : resolve(JSON.parse(out))))
      p.stdin.end(JSON.stringify({ bad: BAD, values: [...GOOD, ...BAD], gateways: [...ACCEPT, ...NEAR], base }))
    })
    is(u.built === 'amt=1.000&action=1&udf5=X1&password=p@ss!&', "knet_build_trandata: raw, every pair followed by '&', the empty udf1 left out", u.built)
    is(u.bad.length === BAD.length && u.bad.every((m) => m.startsWith('udf3 ')) && u.badkey === 'refused',
       `every one of ${BAD.length} unsafe values is refused for ANY field, naming the field; a field name that is not a word too`)
    is(u.raw.slice(0, GOOD.length).every(([k, s]) => k && s) && u.raw.slice(GOOD.length).every(([k, s]) => !k && !s),
       "knet.php and the admin's copy agree on the character rule, value by value", JSON.stringify(u.raw))
    is(u.gw.slice(0, ACCEPT.length).every(([k, s]) => k && s),
       'D3: the bare and the www. host of each environment are accepted by knet.php AND by the admin', JSON.stringify(u.gw.slice(0, ACCEPT.length)))
    const leaks = NEAR.filter((_, i) => u.gw[ACCEPT.length + i].some(Boolean))
    is(leaks.length === 0, `D3: all ${NEAR.length} near-miss addresses (lookalike hosts, ports, userinfo, the other environment, other paths) are refused by both`,
       leaks.map(([e, x]) => `${e} ${x}`).join(' | '))
  } finally { rig.stop() }
}

// --------------------------------------------- D3 / D6: what /backends saves
head('the KNET editor in /backends saves only what the bank can be sent (D3, D6)')
{
  const rig = await privateRig('admin')
  try {
    let cookie = ''
    const admin = async (route, body) => {
      const res = await fetch(`${rig.B}/api/admin.php?r=${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body) })
      const set = res.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      return { status: res.status, body: await res.json().catch(() => null) }
    }
    await sql('update admin_users set failed_attempts = 0, locked_until = null')
    await admin('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
    const K = '/kpg/PaymentHTTP.htm'
    const form = (o = {}) => ({ gateway: 'knet', env: 'test', test_url: `https://kpaytest.com.kw${K}`, production_url: `https://kpay.com.kw${K}`,
      response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php',
      result_page_url: 'https://www.sporta.com.kw/payment/result', ...o })
    const cfgNow = async () => JSON.parse((await run('php', ['-r', `echo json_encode(require '${join(rig.T, 'knet', 'config.php')}');`])).stdout)
    const ok0 = await admin('payment_config', form())
    is(ok0.status === 200, 'the editor saves the bare-host addresses', `${ok0.status} ${ok0.body?.error ?? ''}`)
    const www = await admin('payment_config', form({ test_url: `https://www.kpaytest.com.kw${K}`, production_url: `https://www.kpay.com.kw${K}` }))
    const c1 = await cfgNow()
    is(www.status === 200 && c1.test_url === `https://www.kpaytest.com.kw${K}` && c1.production_url === `https://www.kpay.com.kw${K}`,
       'and the www. addresses, as the bank spells them', `${www.status} ${www.body?.error ?? ''}`)
    for (const [field, value] of [['test_url', `https://kpaytest.com.kw.evil.com${K}`], ['test_url', `https://kpay.com.kw${K}`], ['test_url', `https://kpaytest.com.kw/kpg/other.htm`],
      ['production_url', `https://kpay.com.kw:8443${K}`], ['production_url', `https://kpay.com.kw@evil.com${K}`], ['production_url', `https://wwww.kpay.com.kw${K}`]]) {
      const r = await admin('payment_config', form({ [field]: value }))
      is(r.status === 400 && r.body?.error === `invalid_${field}`, `${field} ${value} is refused`, `${r.status} ${r.body?.error}`)
    }
    for (const [field, value, token] of [
      ['test_tranportal_password', 'pa&ss', 'tranportal_password_has_unsafe_character'], ['test_tranportal_password', 'pa=ss', 'tranportal_password_has_unsafe_character'],
      ['production_tranportal_password', 'pa\nss', 'tranportal_password_has_unsafe_character'], ['test_tranportal_id', 'ID#1', 'tranportal_id_has_unsafe_character'],
      ['response_url', 'https://www.sporta.com.kw/knet/callback.php?x=1', 'invalid_response_url'], ['error_url', 'https://www.sporta.com.kw/knet/callback.php#e', 'invalid_error_url']]) {
      const before = await cfgNow()
      const r = await admin('payment_config', form({ [field]: value }))
      const after = await cfgNow()
      is(r.status === 400 && r.body?.error === token && JSON.stringify(before) === JSON.stringify(after),
         `${field} with ${JSON.stringify(value)} is refused (${token}) and nothing is written`, `${r.status} ${r.body?.error}`)
    }
    const pw = await admin('payment_config', form({ test_tranportal_password: 'p@ss!word' }))
    is(pw.status === 200 && (await cfgNow()).tranportal_password === 'p@ss!word', "a password with '@' and '!' is saved: they are not separators", `${pw.status} ${pw.body?.error ?? ''}`)
  } finally { rig.stop() }
}

// ----------------------------------- D2: the payment whose callback never came
head('a capture whose callback never came: the sweeper asks the bank first (D2, off by default)')
{
  const rig = await privateRig('inq')
  // php cron-stock.php --release, against the private copy (its own api/config.php and knet/config.php).
  const cron = async (flag = '--release') => {
    const t0 = Date.now()
    const r = await run('php', [join(rig.T, 'api', 'cron-stock.php'), flag], { timeout: 60000 })
    const out = JSON.parse(r.stdout)
    out.ms = Date.now() - t0
    out.stderr = r.stderr
    if (process.env.KEEP_RIG && r.stderr) console.log(`cron stderr: ${r.stderr.trim()}`)
    return out
  }
  const orderRow = async (t) => {
    const [status, cbk, payid, released] = (await sql(`select payment_status, cbk_status, cbk_paymentid, stock_released from orders where track_id='${t}'`)).split('\t')
    return { status, cbk, payid, released }
  }
  const shipIt = (t) => sql(`select count(*) from fulfilment_outbox where kind='payment' and order_id=(select id from orders where track_id='${t}')`)
  // An order sent to the bank `starts` times; the LAST start is paid at the bank
  // with deliver=none — the shopper closed the tab — and the order is then aged
  // past the two-hour hold, so the sweeper takes it up.
  const lostCallback = async (track, { starts = 1, outcome = 'captured', amt = '' } = {}) => {
    await sql('delete from rate_limit')
    await newOrder(track)
    let res
    for (let i = 0; i < starts; i++) res = await rig.get(`knet/pay.php?trackid=${track}`)
    const bank = await (await fetch(`${rig.B}/bank/fake-knet-bank.php?${locOf(res).searchParams}&outcome=${outcome}&deliver=none${amt ? `&amt=${amt}` : ''}`)).json()
    await sql(`update orders set created_at = now() - interval 200 minute where track_id='${track}'`)
    return bank
  }
  const asked = (t) => rig.bank().inquiries.filter((q) => q.trackid === t || q.trackid.startsWith(`${t}A`))
  try {
    // OFF unless switched on.
    const off = await lostCallback('SPKNETINQOFF')
    const o1 = await cron()
    is(off.bank_result === 'CAPTURED' && off.delivered === false, 'the bank captured the payment and never called back (the shopper closed the tab)')
    const r1 = await orderRow('SPKNETINQOFF')
    is(o1.knet_inquiry?.enabled === false && o1.knet_inquiry.asked === 0 && rig.bank().inquiries.length === 0,
       'OFF BY DEFAULT: the sweeper asks nobody', JSON.stringify(o1.knet_inquiry))
    is(r1.released === '1' && r1.status === 'pending',
       'and does exactly what it did before: the stock is released, the order stays unpaid (the gap this closes when on)', JSON.stringify(r1))

    // Switched on with no action code: there is no default, so it refuses.
    await rig.writeCfg({ inquiry_enabled: true })
    await lostCallback('SPKNETINQNOACT')
    const o2 = await cron()
    is(o2.knet_inquiry.refused === 'inquiry_action_not_set' && o2.knet_inquiry.asked === 0 && rig.bank().inquiries.length === 0,
       'switched on WITHOUT inquiry_action it refuses and asks nobody: no guessed action code', JSON.stringify(o2.knet_inquiry))
    is(rig.log().some((e) => e.event === 'inquiry.refused' && e.reason === 'inquiry_action_not_set'), 'and the refusal is logged')
    is((await orderRow('SPKNETINQNOACT')).released === '1', 'and the sweeper carries on as before')
    for (const a of ['1', '2', '3', '5', 'eight', '0', '123']) {
      await rig.writeCfg({ inquiry_enabled: true, inquiry_action: a })
      const o = await cron()
      is(o.knet_inquiry.refused === (/^\d+$/.test(a) && a !== '0' && a !== '123' ? 'inquiry_action_moves_money' : 'inquiry_action_invalid'),
         `inquiry_action ${JSON.stringify(a)} is refused (${o.knet_inquiry.refused})`)
    }
    const st = await rig.writeCfg({ inquiry_enabled: 'yes', inquiry_action: '88' }).then(() => cron())
    is(st.knet_inquiry.enabled === false && st.knet_inquiry.asked === 0, "only the boolean true switches it on, not 'yes'")

    // On, with a fixture action code ('88' is this rig's, NOT KNET's: the real
    // one is unknown and must come from KNET). Two starts: the bank only ever
    // saw the second, and captured it.
    await rig.writeCfg({ inquiry_enabled: true, inquiry_action: '88' })
    const paid = await lostCallback('SPKNETINQPAID', { starts: 2 })
    const o3 = await cron()
    const r3 = await orderRow('SPKNETINQPAID')
    is(o3.knet_inquiry.enabled === true && o3.knet_inquiry.settled.includes('SPKNETINQPAID'), 'switched on, the sweeper asks the bank BEFORE releasing', JSON.stringify(o3.knet_inquiry))
    is(r3.status === 'paid' && r3.cbk === 'CAPTURED' && r3.payid === paid.paymentid && r3.released === '0',
       "the order is PAID with the bank's payment id, and its garments are NOT released", JSON.stringify(r3))
    is(await shipIt('SPKNETINQPAID') === '1', 'and the warehouse is told to ship it, exactly once (the callback\'s own settlement)')
    const q3 = asked('SPKNETINQPAID')
    is(q3.map((q) => q.trackid).join(',') === 'SPKNETINQPAID,SPKNETINQPAIDA2', 'it asked about every reference the order was sent under, attempt 1 then attempt 2', q3.map((q) => q.trackid).join(','))
    is(q3.length > 0 && q3.every((q) => q.method === 'POST' && q.param === 'tranInit' && q.content_type.startsWith('application/xml')
       && q.xml_starts === '<request>' && q.credentials_ok && q.action === '88' && q.currencycode === '414' && q.amt === '21.000'),
       "the plug-in's request: an application/xml POST of <request> to tranPipe.htm?param=tranInit, Tranportal id and password, the configured action, the order total")
    is(q3.every((q) => !q.tags.includes('currency') && q.transid === '' && q.udf5 === ''), "the plug-in's <currency>=amount bug is not copied; transid and udf5 only when configured")
    const logT = rig.logText()
    is(logT.includes('"event":"inquiry.request"') && logT.includes('"event":"inquiry.response"') && logT.includes('"event":"inquiry.settled"'),
       'every question and answer is logged')
    is(!logT.includes('<password>testpass') && !logT.includes('testpass') && !logT.includes(KEY), 'and the log never holds the Tranportal password or the resource key')
    const o4 = await cron()
    is((await orderRow('SPKNETINQPAID')).status === 'paid' && await shipIt('SPKNETINQPAID') === '1' && !o4.knet_inquiry.settled.includes('SPKNETINQPAID'),
       'a second run changes nothing (a paid order is no candidate)')
    await rig.post('knet/callback.php', { trandata: encrypt(`result=CAPTURED&trackid=SPKNETINQPAIDA2&amt=21.000&paymentid=${paid.paymentid}&udf5=SPKNETINQPAID`) })
    is((await orderRow('SPKNETINQPAID')).status === 'paid' && await shipIt('SPKNETINQPAID') === '1', "and the bank's late callback, should it come, changes nothing either")
    // The same rule on the callback: a CAPTURED for another order under a Payment ID an order already records.
    await sql('delete from rate_limit')
    await newOrder('SPKNETDUPPID')
    await rig.post('knet/callback.php', { trandata: encrypt(`result=CAPTURED&trackid=SPKNETDUPPID&amt=21.000&paymentid=${paid.paymentid}&udf5=SPKNETDUPPID`) })
    const rdp = await orderRow('SPKNETDUPPID')
    is(rdp.status === 'review' && rdp.cbk === 'PAYMENT_ID_IN_USE' && await shipIt('SPKNETDUPPID') === '0',
       'a callback that would mark a SECOND order paid with a Payment ID another order records is held for review (payment_id_in_use)', JSON.stringify(rdp))

    // Optional fields, when configured.
    await rig.writeCfg({ inquiry_enabled: true, inquiry_action: '88', inquiry_transid: 'trackid', inquiry_udf5: 'TrackID' })
    await lostCallback('SPKNETINQOPT')
    await cron()
    const q5 = asked('SPKNETINQOPT')
    is(q5.length === 1 && q5[0].transid === 'SPKNETINQOPT' && q5[0].udf5 === 'TrackID' && (await orderRow('SPKNETINQOPT')).status === 'paid',
       'inquiry_transid / inquiry_udf5, when KNET asks for them, are sent as configured', JSON.stringify(q5[0] ?? {}))
    await rig.writeCfg({ inquiry_enabled: true, inquiry_action: '88' })

    // Every answer that is not a CAPTURED of this reference changes nothing.
    await lostCallback('SPKNETINQDECL', { outcome: 'notcaptured' })
    await cron()
    const r6 = await orderRow('SPKNETINQDECL')
    is(r6.status === 'pending' && r6.released === '1' && asked('SPKNETINQDECL').length === 1, 'NOT CAPTURED: released exactly as before', JSON.stringify(r6))
    await lostCallback('SPKNETINQECHO')
    rig.bankEdit((s) => { s.payments.SPKNETINQECHO.trackid_echo = 'SPKNETSOMEONE' })
    await cron()
    is((await orderRow('SPKNETINQECHO')).status === 'pending', 'a CAPTURED answer that names ANOTHER reference is not this order\'s money')
    // The bank answers about attempt 1 with a capture of attempt 2, a reference pay.php never sent (the order went to the
    // bank once). It names this order (udf5), but it is not the reference asked about: not taken.
    await lostCallback('SPKNETINQOTHERATT')
    rig.bankEdit((s) => { s.payments.SPKNETINQOTHERATT.trackid_echo = 'SPKNETINQOTHERATTA2' })
    await cron()
    is((await orderRow('SPKNETINQOTHERATT')).status === 'pending',
       'a CAPTURED answer for ANOTHER attempt of the same order (one pay.php never sent) is not taken for the one asked about')
    await lostCallback('SPKNETINQNOECHO')
    rig.bankEdit((s) => { s.payments.SPKNETINQNOECHO.trackid_echo = '' })
    await cron()
    is((await orderRow('SPKNETINQNOECHO')).status === 'pending' && (await orderRow('SPKNETINQNOECHO')).released === '1',
       'a CAPTURED answer that echoes NO reference is not taken as this order\'s either (review 1, finding 1)')

    // ONE PAYMENT, ONE ORDER (review 1, finding 1). Track ids are chosen by the browser: order L's second attempt goes to
    // the bank as <L>A2 (udf5 L), and a second order can be NAMED <L>A2. Asked about its attempt 1 (reference <L>A2), the
    // bank answers CAPTURED with L's payment. The answer resolves (echoed udf5) to L, so the look-alike is not settled.
    for (const [L, udf5Echoed] of [['SPKNETLKA', true], ['SPKNETLKB', false]]) {
      await sql('delete from rate_limit')
      await newOrder(L)
      await rig.get(`knet/pay.php?trackid=${L}`)
      const r2 = await rig.get(`knet/pay.php?trackid=${L}`)
      await (await fetch(`${rig.B}/bank/fake-knet-bank.php?${locOf(r2).searchParams}&outcome=captured`)).json()
      const twin = `${L}A2`
      await sql('delete from rate_limit')
      await newOrder(twin)
      await rig.get(`knet/pay.php?trackid=${twin}`)   // attempt 1: the reference IS the twin's own track id, <L>A2
      await sql(`update orders set created_at = now() - interval 200 minute where track_id='${twin}'`)
      if (!udf5Echoed) rig.bankEdit((s) => { s.payments[twin].udf5 = '' })
      await cron()
      const rl = await orderRow(L), rt = await orderRow(twin)
      const ships = Number(await shipIt(L)) + Number(await shipIt(twin))
      if (udf5Echoed) {
        is(rl.status === 'paid' && /^\d{6,}$/.test(rl.payid) && rt.status === 'pending' && rt.released === '1' && ships === 1,
           'an order NAMED like another order\'s retry reference is not settled with that order\'s payment (the echoed udf5 names the payer)',
           `${JSON.stringify(rl)} ${JSON.stringify(rt)} ships=${ships}`)
        is(rig.log().some((e) => e.event === 'inquiry.not_this_order' && e.trackid === twin && e.resolves_to === L), 'and that is logged as inquiry.not_this_order')
      } else {
        is(rl.status === 'paid' && rt.status === 'review' && rt.cbk === 'PAYMENT_ID_IN_USE' && rt.payid === rl.payid && ships === 1,
           'with no udf5 echoed, the second order holding the SAME Payment ID is held for review (payment_id_in_use), never paid: one payment ships once',
           `${JSON.stringify(rl)} ${JSON.stringify(rt)} ships=${ships}`)
      }
    }
    await sql('delete from rate_limit')
    await newOrder('SPKNETINQNEVER')
    await sql("update orders set created_at = now() - interval 200 minute where track_id='SPKNETINQNEVER'")
    await cron()
    is(asked('SPKNETINQNEVER').length === 0 && (await orderRow('SPKNETINQNEVER')).released === '1', 'an order never sent to the bank (pay_attempt 0) is not asked about')

    // Captured for the WRONG amount: the callback's rule, review, garments kept.
    await lostCallback('SPKNETINQAMT', { amt: '0.100' })
    const o7 = await cron()
    const r7 = await orderRow('SPKNETINQAMT')
    is(r7.status === 'review' && r7.cbk === 'AMOUNT_MISMATCH' && r7.released === '0' && o7.knet_inquiry.review.includes('SPKNETINQAMT'),
       'CAPTURED for another amount is held for REVIEW with its garments kept, exactly as the callback holds it', JSON.stringify(r7))

    // A dry run asks nobody.
    await lostCallback('SPKNETINQDRY')
    const before = rig.bank().inquiries.length
    const od = await cron('--check')
    is(od.knet_inquiry.enabled === true && od.knet_inquiry.asked === 0 && rig.bank().inquiries.length === before
       && (await orderRow('SPKNETINQDRY')).status === 'pending', '--check asks the bank nothing and changes nothing')
    await cron()   // settles SPKNETINQDRY, so it is out of the way

    // The bank is down: one question, then the run stops asking.
    await lostCallback('SPKNETINQDN1')
    await lostCallback('SPKNETINQDN2')
    rig.bankEdit((s) => { s.down = true })
    const o8 = await cron()
    is(o8.knet_inquiry.stopped === 'http_503' && o8.knet_inquiry.asked === 1, 'the bank answering 503 stops the inquiry for the run after ONE question', JSON.stringify(o8.knet_inquiry))
    is((await orderRow('SPKNETINQDN1')).released === '1' && (await orderRow('SPKNETINQDN2')).released === '1',
       'and both orders are released as they were before (no answer is not an answer)')
    rig.bankEdit((s) => { s.down = false; s.slow = 13 })
    await lostCallback('SPKNETINQSLOW')
    const o9 = await cron()
    is(o9.knet_inquiry.stopped === 'curl_28' && o9.ms < 15000 && (await orderRow('SPKNETINQSLOW')).released === '1',
       `a bank that does not answer is given ${10} s, then the sweeper carries on`, `${o9.knet_inquiry.stopped} after ${o9.ms} ms`)
    rig.bankEdit((s) => { s.slow = 0 })

    // The inquiry carries the Tranportal id and password: it must not talk to a
    // server whose certificate it cannot verify. A self-signed HTTPS "bank" that
    // answers CAPTURED to anything is the test: the answer must never be heard.
    const tls = mkdtempSync(join(tmpdir(), 'sporta-knet-tls-'))
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tls, 'k.pem'), '-out', join(tls, 'c.pem'),
      '-days', '1', '-subj', '/CN=127.0.0.1'])
    writeFileSync(join(tls, 'srv.py'), `import http.server, ssl
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        body = b'<result>CAPTURED</result><amt>21.000</amt><payid>TLSFAKE1</payid>'
        self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('${join(tls, 'c.pem')}', '${join(tls, 'k.pem')}')
s = http.server.HTTPServer(('127.0.0.1', 8239), H)
s.socket = ctx.wrap_socket(s.socket, server_side=True)
s.serve_forever()`)
    const { spawn: spawnTls } = await import('node:child_process')
    const tsrv = spawnTls('python3', [join(tls, 'srv.py')], { stdio: 'ignore', detached: true })
    try {
      let alive = ''
      for (let i = 0; i < 50 && !alive.includes('CAPTURED'); i++) {
        alive = (await run('curl', ['-sk', '-X', 'POST', '-d', '<request/>', 'https://127.0.0.1:8239/kpg/tranPipe.htm']).catch(() => ({ stdout: '' }))).stdout
        if (!alive.includes('CAPTURED')) await new Promise((r) => setTimeout(r, 100))
      }
      is(alive.includes('CAPTURED'), 'a self-signed HTTPS server is up and answers CAPTURED to curl -k')
      await rig.writeCfg({ inquiry_enabled: true, inquiry_action: '88', test_url: 'https://127.0.0.1:8239/kpg/PaymentHTTP.htm' })
      await sql('delete from rate_limit')
      await newOrder('SPKNETINQTLS')
      await rig.get('knet/pay.php?trackid=SPKNETINQTLS')
      await sql("update orders set created_at = now() - interval 200 minute where track_id='SPKNETINQTLS'")
      const ot = await cron()
      const rt = await orderRow('SPKNETINQTLS')
      is(/^curl_(60|51|58|35)$/.test(ot.knet_inquiry.stopped ?? '') && rt.status === 'pending' && rt.payid !== 'TLSFAKE1',
         'and the inquiry REFUSES it (certificate and host verified): its CAPTURED is never heard', `${ot.knet_inquiry.stopped} ${JSON.stringify(rt)}`)
    } finally {
      try { process.kill(-tsrv.pid) } catch { /* gone */ }
      rmSync(tls, { recursive: true, force: true })
      await rig.writeCfg({ inquiry_enabled: true, inquiry_action: '88' })
    }
  } finally { rig.stop() }
}

head('the money leaves a trail')
{
  const log = readLog()
  is(log.includes('pay.init') && log.includes('callback.received'),
     'both sides of every payment are logged')
  is(!log.includes('testpass') && !log.includes(KEY),
     'and the log never contains the Tranportal password or the resource key')
}

console.log(fails ? `\n${fails} problem(s) in the KNET path` : '\nKNET: the card path is alive end to end')
process.exit(fails ? 1 : 0)
