// The KNET card path, end to end, against a real MariaDB and a fake bank that
// speaks the real Tranportal protocol (scripts/fake-knet-bank.php).
//
// What this proves, and why each matters:
//
//   * the AES-128-CBC trandata this code produces is decryptable by an
//     INDEPENDENT implementation (Node's crypto, below) with the fixed
//     PGKEYENCDECIVSPC IV — if the encryption were subtly wrong, the bank
//     would reject every payment and no unit test of our own helpers would
//     ever notice, because they would be wrong in both directions;
//   * the amount charged comes from the DATABASE, never from the browser;
//   * the customer gets home whichever way the gateway hands off (the
//     REDIRECT= token, not just a 302);
//   * a replayed callback does not double-pay, double-stamp or double-email;
//   * everything unverifiable fails CLOSED.
//
//   npm run test:knet
//   (needs MariaDB, php -S :8095 php-store, :8097 scripts, :8098 php-knet)
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const KNET = process.env.KNET_BASE ?? 'http://127.0.0.1:8098'
const BANK = process.env.BANK_BASE ?? 'http://127.0.0.1:8097'
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
const KEY = 'abcdef0123456789'
const IV = 'PGKEYENCDECIVSPC'

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
const parse = (qs) => Object.fromEntries(
  qs.split('&').filter(Boolean).map((p) => {
    const i = p.indexOf('=')
    return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]
  }),
)

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
  is(bank.merchant_code === 200, 'the callback answered 200, not a bare redirect', `${bank.merchant_code}`)
  is(bank.used_token === true,
     'the callback speaks REDIRECT= — a server-to-server gateway can bring the customer home')
  is(bank.landing.includes('status=success') && bank.landing.includes('SPKNET0002'),
     'the customer lands on the success page', bank.landing.split('?')[1] ?? '')

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
head('a declined card can be paid again')
{
  await newOrder('SPKNET0RETRY')

  // First attempt — declined by the bank.
  const one = await get(`${KNET}/pay.php?trackid=SPKNET0RETRY`)
  const sentOne = parse(decrypt(new URL(one.headers.get('location')).searchParams.get('trandata')))
  is(sentOne.trackid === 'SPKNET0RETRY',
     'the FIRST attempt sends the order id unchanged — the common case is untouched',
     sentOne.trackid)
  const declined = await fetch(
    `${BANK}/fake-knet-bank.php?${new URL(one.headers.get('location')).searchParams}&outcome=notcaptured`)
  await declined.json()
  is(await sql("select payment_status from orders where track_id='SPKNET0RETRY'") !== 'paid',
     'and the decline leaves the order unpaid')

  // The shopper taps "try again" — same basket, so the SAME order and track id.
  const two = await get(`${KNET}/pay.php?trackid=SPKNET0RETRY`)
  const sentTwo = parse(decrypt(new URL(two.headers.get('location')).searchParams.get('trandata')))
  is(sentTwo.trackid !== sentOne.trackid,
     'the RETRY sends a different reference, so the bank cannot refuse it as a duplicate',
     `${sentOne.trackid} -> ${sentTwo.trackid}`)
  is(sentTwo.trackid.startsWith('SPKNET0RETRY'),
     'and it still carries the order number, so a bank statement can be reconciled',
     sentTwo.trackid)
  is(sentTwo.trackid.length <= 30, 'within the field the gateway accepts', String(sentTwo.trackid.length))

  // THE PART THAT MUST NOT BREAK: the callback comes back carrying the RETRY
  // reference, and has to settle the original order. cbk_update_order keys on
  // track_id — an unresolved reference would mean the bank took the money and
  // the order stayed pending, with nothing to say why.
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
}

// ------------------------------------------------------------- replay safety
head('a replayed callback changes nothing')
{
  const before = await sql("select paid_at from orders where track_id='SPKNET0002'")
  // The bank retries; the customer refreshes the return page. Same trandata.
  const replay = parse(decrypt(encrypt('result=CAPTURED&trackid=SPKNET0002&amt=21.000&paymentid=REPLAY1&ref=R1')))
  void replay
  const res = await post(`${KNET}/callback.php`, {
    trandata: encrypt('result=CAPTURED&trackid=SPKNET0002&amt=21.000&paymentid=REPLAY1&ref=R1'),
  })
  is(res.status === 200, 'the replay is answered cleanly', `${res.status}`)

  const after = await sql("select paid_at from orders where track_id='SPKNET0002'")
  is(before === after, 'paid_at is NOT re-stamped', `${before} → ${after}`)
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
  is(bank.landing.includes('status=failed'), 'an underpayment is NOT treated as success', bank.landing.split('?')[1] ?? '')
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
  await admin('login', { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' })
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
head('the money leaves a trail')
{
  const log = (await run('cat', ['/tmp/knet-test.log']).catch(() => ({ stdout: '' }))).stdout
  is(log.includes('pay.init') && log.includes('callback.received'),
     'both sides of every payment are logged')
  is(!log.includes('testpass') && !log.includes(KEY),
     'and the log never contains the Tranportal password or the resource key')
}

console.log(fails ? `\n${fails} problem(s) in the KNET path` : '\nKNET: the card path is alive end to end')
process.exit(fails ? 1 : 0)
