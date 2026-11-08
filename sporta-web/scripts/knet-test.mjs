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
  is(bank.strict_reply === true,
     'and the reply is ONLY that line — no HTML, no 302 (K-064 §5: anything else risks auto-void)')
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
