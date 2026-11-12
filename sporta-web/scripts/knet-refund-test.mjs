// KNET payment records, end to end against the real stack (MariaDB, php -S for
// the store, the KNET dropin and the fake bank): KNET-K063-CHECK.md B1, B2, B3,
// B9 and C2, built in dropin/php-store/payment-records.php and
// dropin/php-knet/knet.php.
//
//   npm run test:knet-refund
//   (the rig of scripts/sandbox.sh: MariaDB `sporta` with refunds.mysql.sql,
//    :8095 php-store, :8097 the fake bank, :8098 php-knet)
//
// What is proved, and what each part guards against:
//   1. The routes are admin-only (session + X-Sporta-Admin), and a refund is
//      refused without the order's own KNET Payment ID, without an amount, for a
//      cash order, for an unpaid order, and for more than was paid.
//   2. A PARTIAL refund keeps the order paid and takes its amount off revenue
//      (stats, the revenue chart); the same submission twice records ONE row.
//   3. The refund that completes the payment closes the order: refunded,
//      cancelled, the warehouse's "do not ship" queued once, the garments back
//      on the shelf, the customer's tracking step; the order cannot be put back
//      on, settled by hand, or made paid again by a replayed bank notification.
//   4. A VOID is whole or nothing, never after a refund; a SHIPPED order is only
//      re-marked (no "do not ship", no stock back); a REVIEW order is closed with
//      the amount KPay gave back.
//   5. B3: a second CAPTURED notification under a DIFFERENT Payment ID is kept as
//      an alert and changes nothing on the order; the same Payment ID replayed
//      is a silent no-op; the duplicate is refunded (or dismissed) from
//      /backends; a capture on a review order that a second capture overwrites
//      is kept too; and with the table missing the shopper is still answered
//      "paid" and the payment log keeps the duplicate.
//   5b. Review fixes: an open second charge is refundable after the order's own
//      refund or void; a review order cannot be closed for more than its amount;
//      an order settled by hand whose bank notification arrives later is not
//      a second charge (the bank's fields are adopted, once).
//   6. C2: the reconciliation CSV: admin-only, a date window, every Merchant
//      Track ID an order was sent under, the bank fields, refunds and second
//      captures, no customer name or phone, formula-safe cells.
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const KNET = process.env.KNET_BASE ?? 'http://127.0.0.1:8098'
const BANK = process.env.BANK_BASE ?? 'http://127.0.0.1:8097'
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
const KEY = 'abcdef0123456789'
const HTTPS = { 'X-Forwarded-Proto': 'https' }
const WEB = fileURLToPath(new URL('..', import.meta.url))

let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()
const head = (t) => {
  execFileSync('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
}
const readLog = () => { try { return readFileSync('/tmp/knet-test.log', 'utf8') } catch { return '' } }
const encrypt = (plain) => {
  const c = crypto.createCipheriv('aes-128-cbc', KEY, KEY)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase()
}
const rk = () => crypto.randomBytes(16).toString('hex')

// ---------------------------------------------------------------- the rig
const ready = await sql("select count(*) from information_schema.tables where table_schema = database() and table_name in ('order_refunds','payment_alerts')")
if (ready !== '2') {
  console.log('FAIL refunds.mysql.sql is not imported into the test database (run scripts/sandbox.sh)')
  process.exit(1)
}
await sql("delete from rate_limit; update product_variants set stock = 1000; " +
  "delete from order_refunds where order_id in (select id from orders where track_id like 'SPRF%'); " +
  "delete from payment_alerts where order_id in (select id from orders where track_id like 'SPRF%'); " +
  "delete from fulfilment_outbox where order_id in (select id from orders where track_id like 'SPRF%'); " +
  "delete from orders where track_id like 'SPRF%'; " +
  "update admin_users set failed_attempts = 0, locked_until = null where email = 'qa-admin@sporta.test'")

const ITEM = { slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'L', fit: 'oversize' }
const newOrder = async (track, method = 'knet') => {
  const res = await fetch(`${API}/api.php?r=order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track, items: [ITEM], payment_method: method,
      customer: { name: 'Mariam Al-Kandari', phone: '99887711', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' },
    }),
  })
  return res.json()
}
const pay = async (track, extra = '') => {
  const p = await fetch(`${KNET}/pay.php?trackid=${track}`, { headers: HTTPS, redirect: 'manual' })
  const loc = p.headers.get('location')
  if (!loc) return { error: p.status }
  return (await fetch(`${BANK}/fake-knet-bank.php?${new URL(loc).searchParams}&outcome=captured${extra}`)).json()
}
const callback = async (plain) => {
  const r = await fetch(`${KNET}/callback.php`, {
    method: 'POST', redirect: 'manual',
    headers: { ...HTTPS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ trandata: encrypt(plain) }),
  })
  return r.text()
}
let cookie = ''
const admin = async (route, body, { headers = {}, raw = false } = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  // ignoreBOM: keep a byte order mark in the text, so the test can see it (res.text() drops it)
  if (raw) return { status: res.status, headers: res.headers, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()) }
  return { status: res.status, body: await res.json().catch(() => null) }
}
const row = async (track, cols) => (await sql(`select ${cols} from orders where track_id='${track}'`)).split('\t')
const stockL = () => sql("select stock from product_variants where slug='cloudsoft-jacket-army-green' and size='L'")
const outbox = (track, kind) => sql(`select count(*) from fulfilment_outbox where kind='${kind}' and order_id=(select id from orders where track_id='${track}')`)
const paidOrder = async (track) => {
  await newOrder(track)
  const b = await pay(track)
  const [status, payid] = await row(track, 'payment_status, cbk_paymentid')
  return { id: Number(await sql(`select id from orders where track_id='${track}'`)), status, payid, landing: b.landing ?? '' }
}
// The XBRL figures for yesterday..today (UTC), as /backends exports them (?format=json).
const xbrl = async () => {
  const [from, to] = (await sql('select date(utc_timestamp() - interval 1 day), date(utc_timestamp())')).split('\t')
  return (await admin(`xbrl_export&from=${from}&to=${to}&format=json`)).body ?? {}
}
const refund = (orderId, kind, paymentId, amount, extra = {}) =>
  admin('knet_refund_record', { order_id: orderId, kind, payment_id: paymentId, amount, request_key: rk(), ...extra })

// ---------------------------------------------------------------- 1. the gate
head('1. admin only, and the refusals')
{
  const anon = await fetch(`${API}/admin.php?r=knet_refund_record`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: '{}' })
  is(anon.status === 401, 'without a session the refund route answers 401', `${anon.status}`)
  const anonCsv = await fetch(`${API}/admin.php?r=knet_reconcile_export&from=2026-11-01&to=2026-11-01`, { headers: { 'X-Sporta-Admin': '1' } })
  is(anonCsv.status === 401, 'and so does the export', `${anonCsv.status}`)
  const login = await admin('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
  is(login.status === 200, 'the admin signs in', `${login.status}`)
  const noHeader = await fetch(`${API}/admin.php?r=payment_alerts`, { headers: { Cookie: cookie } })
  is(noHeader.status === 400, 'a signed-in request without X-Sporta-Admin is refused (CSRF)', `${noHeader.status}`)
  const getOnPost = await admin('knet_refund_record')
  is(getOnPost.status === 405, 'the write route refuses GET', `${getOnPost.status}`)

  const o = await paidOrder('SPRF0GATE')
  is(o.status === 'paid' && /^\d{6,}$/.test(o.payid), 'a KNET order is paid through the fake bank', `${o.status} ${o.payid}`)
  const view = await admin('knet_payment_record&track_id=SPRF0GATE')
  is(view.status === 200 && view.body?.order?.payment_id === o.payid && view.body.order.attempt_refs?.[0] === 'SPRF0GATE'
     && view.body.order.transaction_id && view.body.order.reference && view.body.order.auth_code === 'B35434',
     'the order view returns the bank fields KPay shows (Payment ID, Transaction ID, reference, auth code, Merchant Track IDs)',
     JSON.stringify(view.body?.order ?? view.body).slice(0, 160))
  is(view.body?.actions?.refund === true && view.body.actions.void === true && view.body.actions.partial === true, 'and offers refund, partial refund and void')

  const cases = [
    [{ payment_id: '' }, 'payment_id_required', 'no Payment ID'],
    [{ payment_id: 'x' }, 'payment_id_required', 'a Payment ID too short to be one'],
    [{ payment_id: '999999999999' }, 'payment_id_mismatch', "another payment's ID"],
    [{ amount: '' }, 'amount_required', 'no amount'],
    [{ amount: '1.2345' }, 'amount_required', 'four decimals'],
    [{ amount: '-1' }, 'amount_required', 'a negative amount'],
    [{ amount: 3.5 }, 'amount_required', 'a JSON float (0.1 + 0.2 is not a price)'],
    [{ amount: '21.001' }, 'refund_exceeds_payment', 'more than was paid'],
    [{ kind: 'credit' }, 'invalid_kind', 'an unknown kind'],
    [{ request_key: 'abc' }, 'request_key_required', 'no idempotency key'],
  ]
  for (const [over, want, why] of cases) {
    const r = await admin('knet_refund_record', { order_id: o.id, kind: 'refund', payment_id: o.payid, amount: '1.000', request_key: rk(), ...over })
    is(r.body?.error === want, `refused: ${why}`, `${r.status} ${r.body?.error}`)
  }
  const voidPart = await refund(o.id, 'void', o.payid, '20.000')
  is(voidPart.body?.error === 'void_must_be_full', 'a void of part of the payment is refused', voidPart.body?.error)
  is(await sql(`select count(*) from order_refunds where order_id=${o.id}`) === '0' && (await row('SPRF0GATE', 'payment_status'))[0] === 'paid',
     'and none of the refusals wrote anything')

  await newOrder('SPRF0COD', 'cod')
  const codId = Number(await sql("select id from orders where track_id='SPRF0COD'"))
  const cod = await refund(codId, 'refund', '123456789', '1.000')
  is(cod.body?.error === 'not_a_knet_order', 'a cash order cannot be refunded here', cod.body?.error)
  await newOrder('SPRF0PEND')
  const pendId = Number(await sql("select id from orders where track_id='SPRF0PEND'"))
  const pend = await refund(pendId, 'refund', '123456789', '1.000')
  is(pend.status === 409 && pend.body?.error === 'order_not_paid', 'an unpaid KNET order cannot be refunded', pend.body?.error)
}

// ------------------------------------------------- 2. a partial refund
head('2. a partial refund keeps the order and lowers revenue')
{
  const o = await paidOrder('SPRF0PART')
  const s0 = (await admin('stats')).body
  const x0 = await xbrl()
  const stock0 = await stockL()
  const key = rk()
  const first = await admin('knet_refund_record', { order_id: o.id, kind: 'refund', payment_id: o.payid, amount: '5.000', kpay_reference: 'KP-778', note: 'one jacket\nreturned', request_key: key })
  is(first.status === 200 && first.body?.replayed === false && first.body?.order?.payment_status === 'paid',
     'a 5.000 refund of a 21.000 payment is recorded and the order stays PAID', `${first.status} ${JSON.stringify(first.body?.order ?? first.body).slice(0, 120)}`)
  is(first.body?.order?.refunded_amount === '5.000' && first.body.order.remaining === '16.000', 'refunded 5.000, 16.000 left', `${first.body?.order?.refunded_amount}/${first.body?.order?.remaining}`)
  const again = await admin('knet_refund_record', { order_id: o.id, kind: 'refund', payment_id: o.payid, amount: '5.000', request_key: key })
  is(again.status === 200 && again.body?.replayed === true, 'the SAME submission again is answered as a replay', JSON.stringify(again.body).slice(0, 80))
  is(await sql(`select count(*) from order_refunds where order_id=${o.id}`) === '1' && (await row('SPRF0PART', 'refunded_amount'))[0] === '5.000',
     'and ONE row and 5.000 are recorded, not two')
  is(await sql(`select concat(kind,'|',scope,'|',amount,'|',payment_id,'|',kpay_reference,'|',note,'|',actor_email) from order_refunds where order_id=${o.id}`)
     === `refund|order|5.000|${o.payid}|KP-778|one jacket returned|qa-admin@sporta.test`,
     'the row keeps the kind, amount, Payment ID, KPay reference, the note (control characters gone) and who recorded it')
  const s1 = (await admin('stats')).body
  is(Math.abs(Number(s0.paid_revenue) - Number(s1.paid_revenue) - 5) < 0.0005 && Number(s0.paid_count) === Number(s1.paid_count),
     'stats: paid revenue is 5.000 lower, the paid count unchanged', `${s0.paid_revenue} -> ${s1.paid_revenue}`)
  is(Math.abs(Number(s0.revenue_today) - Number(s1.revenue_today) - 5) < 0.0005, 'and so is today\'s revenue', `${s0.revenue_today} -> ${s1.revenue_today}`)
  const x1 = await xbrl()
  is(Math.abs(x0.Revenue - x1.Revenue - 5) < 0.0005 && x0.OtherIncome === x1.OtherIncome && x0.PaidOrders === x1.PaidOrders,
     'XBRL: the 5.000 comes off revenue (goods), delivery income unchanged, the order still counted', `${x0.Revenue} -> ${x1.Revenue}`)
  const rev = (await admin('revenue&days=1')).body
  const today = Array.isArray(rev) ? rev.reduce((a, x) => a + Number(x.revenue), 0) : NaN
  is(Math.abs(today - Number(s1.revenue_today)) < 0.0005, 'the revenue chart agrees with the dashboard', `${today}`)
  is(await stockL() === stock0 && await outbox('SPRF0PART', 'cancel') === '0' && (await row('SPRF0PART', 'fulfilment_status'))[0] === 'unfulfilled',
     'a partial refund sends the warehouse nothing and puts nothing back on the shelf')
  const ev = await sql("select count(*) from admin_activity_log where action_key='knet_refund_record'")
  is(Number(ev) >= 1, 'the record is an admin activity event', ev)
  const voidNow = await refund(o.id, 'void', o.payid, '21.000')
  is(voidNow.body?.error === 'void_after_refund', 'a void after a refund is refused', voidNow.body?.error)
  const over = await refund(o.id, 'refund', o.payid, '16.001')
  is(over.body?.error === 'refund_exceeds_payment', 'and so is a refund past what is left', over.body?.error)
}

// -------------------------------------------------------------- 2b. races
head('2b. two submissions at once')
{
  const o = await paidOrder('SPRF0RACE')
  const rs = await Promise.all([1, 2, 3].map(() => refund(o.id, 'refund', o.payid, '21.000')))
  const codes = rs.map((r) => `${r.status}:${r.body?.error ?? r.body?.order?.payment_status}`).sort()
  is(rs.filter((r) => r.status === 200).length === 1 && rs.filter((r) => r.body?.error === 'order_already_refunded').length === 2,
     'three full refunds of one payment at once (three keys): ONE is recorded, two are refused', codes.join(' '))
  is((await row('SPRF0RACE', 'refunded_amount'))[0] === '21.000' && await sql(`select count(*) from order_refunds where order_id=${o.id}`) === '1'
     && await outbox('SPRF0RACE', 'cancel') === '1', 'refunded exactly 21.000, one row, one do-not-ship')
  const o2 = await paidOrder('SPRF0RAC2')
  const key = rk()
  const same = await Promise.all([1, 2, 3].map(() => admin('knet_refund_record', { order_id: o2.id, kind: 'refund', payment_id: o2.payid, amount: '2.000', request_key: key })))
  is(same.every((r) => r.status === 200) && same.filter((r) => r.body?.replayed === false).length === 1,
     'the SAME submission three times at once: all answered, one recorded, two replays', same.map((r) => `${r.status}:${r.body?.replayed}`).join(' '))
  is((await row('SPRF0RAC2', 'refunded_amount'))[0] === '2.000', 'refunded 2.000, not 6.000')
  const other = await paidOrder('SPRF0RAC3')
  const reuse = await admin('knet_refund_record', { order_id: other.id, kind: 'refund', payment_id: other.payid, amount: '1.000', request_key: key })
  is(reuse.status === 409 && reuse.body?.error === 'request_key_reused', 'a key already used for another order is refused', `${reuse.status} ${reuse.body?.error}`)
}

// ---------------------------------------- 3. the refund that completes it
head('3. the whole payment back: the order stops')
{
  const track = 'SPRF0PART'
  const id = Number(await sql(`select id from orders where track_id='${track}'`))
  const payid = (await row(track, 'cbk_paymentid'))[0]
  const stock0 = Number(await stockL())
  const x0 = await xbrl()
  const r = await refund(id, 'refund', payid, '16.000')
  const x1 = await xbrl()
  is(x1.PaidOrders === x0.PaidOrders - 1 && Math.abs(x0.Revenue - x1.Revenue - 15) < 0.0005 && Math.abs(x0.OtherIncome - x1.OtherIncome - 1) < 0.0005,
     'XBRL: a refunded order is out of the export (its 15.000 of goods left and its 1.000 delivery)', `${x0.PaidOrders}->${x1.PaidOrders} ${x0.Revenue}->${x1.Revenue}`)
  is(r.status === 200 && r.body?.order?.payment_status === 'refunded' && r.body.order.fulfilment_status === 'cancelled',
     'the refund that completes 21.000 makes the order REFUNDED and CANCELLED', `${r.body?.order?.payment_status}/${r.body?.order?.fulfilment_status}`)
  is(await outbox(track, 'cancel') === '1', 'the warehouse is told "CANCELLED - do not ship" (one cancel row)')
  is(Number(await stockL()) === stock0 + 2 && (await row(track, 'stock_released'))[0] === '1', 'the two jackets are back on the shelf', `${stock0} -> ${await stockL()}`)
  is(await sql(`select count(*) from order_tracking_events where order_id=${id} and status='cancelled'`) === '1', "the customer's tracking shows the cancellation")
  const more = await refund(id, 'refund', payid, '1.000')
  is(more.body?.error === 'order_already_refunded', 'nothing more can be refunded', more.body?.error)
  const back = await admin('fulfilment', { order_id: id, status: 'unfulfilled' })
  is(back.status === 409 && back.body?.error === 'order_refunded', 'the order cannot be put back on (it would ship refunded goods)', `${back.status} ${back.body?.error}`)
  const settle = await admin('card_settled', { order_id: id, bank_reference: payid })
  is(settle.status === 409, 'nor settled by hand', `${settle.status} ${settle.body?.error}`)
  const payments0 = await outbox(track, 'payment')
  const replay = await callback(`result=CAPTURED&trackid=${track}&amt=21.000&paymentid=${payid}&ref=R&tranid=T&udf5=${track}`)
  is((await row(track, 'payment_status'))[0] === 'refunded' && await outbox(track, 'payment') === payments0,
     'a replayed CAPTURED notification for the same payment cannot make it paid again or queue "ship it"', replay.slice(0, 60))
  is(replay.includes('status=refunded'), 'and the shopper is sent to the refunded state', replay.slice(0, 90))
  const s = (await admin('stats')).body
  const o2 = (await admin('orders&payment=unpaid&search=SPRF0PART')).body
  const o3 = (await admin('orders&payment=refunded&search=SPRF0PART')).body
  is(Array.isArray(o2) && o2.length === 0 && Array.isArray(o3) && o3.length === 1,
     'the order leaves the "unpaid" work queue and is found under the refunded filter', `${o2?.length}/${o3?.length}`)
  void s
}

// ------------------------------------------------ 4. void, shipped, review
head('4. a void, a shipped order, a review order')
{
  const v = await paidOrder('SPRF0VOID')
  const stock0 = Number(await stockL())
  const r = await refund(v.id, 'void', v.payid, '21.000')
  is(r.status === 200 && r.body?.order?.payment_status === 'voided' && r.body.order.fulfilment_status === 'cancelled',
     'a whole void makes the order VOIDED and CANCELLED', `${r.body?.order?.payment_status}`)
  is(Number(await stockL()) === stock0 + 2 && await outbox('SPRF0VOID', 'cancel') === '1', 'with its stock back and the do-not-ship queued')

  const sh = await paidOrder('SPRF0SHIP')
  const st = await admin('fulfilment', { order_id: sh.id, status: 'shipped' })
  is(st.status === 200, 'a paid order is shipped', `${st.status}`)
  const stock1 = Number(await stockL())
  const rs = await refund(sh.id, 'refund', sh.payid, '21.000')
  is(rs.status === 200 && rs.body?.order?.payment_status === 'refunded' && rs.body.order.fulfilment_status === 'shipped',
     'refunding a SHIPPED order re-marks the payment only (the goods are with the customer)', `${rs.body?.order?.fulfilment_status}`)
  is(Number(await stockL()) === stock1 && await outbox('SPRF0SHIP', 'cancel') === '0', 'no stock comes back and no do-not-ship is sent')
  const shSettle = await admin('card_settled', { order_id: sh.id, bank_reference: sh.payid })
  is(shSettle.status === 409 && shSettle.body?.error === 'order_refunded', 'a refunded shipped order cannot be settled by hand again', `${shSettle.status} ${shSettle.body?.error}`)

  await newOrder('SPRF0REVW')
  await pay('SPRF0REVW', '&amt=0.100')
  const [rst, rpay, rcbk] = await row('SPRF0REVW', 'payment_status, cbk_paymentid, cbk_status')
  is(rst === 'review' && rcbk === 'AMOUNT_MISMATCH', 'an underpaid capture is held for review', `${rst} ${rcbk}`)
  const rid = Number(await sql("select id from orders where track_id='SPRF0REVW'"))
  const stock2 = Number(await stockL())
  const huge = await refund(rid, 'refund', rpay, '9999.000')
  is(huge.status === 409 && huge.body?.error === 'refund_exceeds_payment' && (await row('SPRF0REVW', 'payment_status'))[0] === 'review',
     'closing a review order for MORE than the order\'s amount (a typo) is refused (review 1, finding 4)', `${huge.status} ${huge.body?.error}`)
  const rr = await refund(rid, 'refund', rpay, '0.100', { note: 'gave the 0.100 back' })
  is(rr.status === 200 && rr.body?.order?.payment_status === 'refunded' && rr.body.order.fulfilment_status === 'cancelled',
     'a review order is closed whole with the amount KPay gave back (0.100, not the order total)', `${rr.status} ${rr.body?.error ?? rr.body?.order?.payment_status}`)
  is(Number(await stockL()) === stock2 + 2, 'and its held garments are released', `${stock2} -> ${await stockL()}`)

  // a review order whose capture carried no Payment ID takes the one typed
  await newOrder('SPRF0NOID')
  await callback('result=CAPTURED&trackid=SPRF0NOID&amt=21.000&paymentid=&ref=R0&tranid=T0&udf5=SPRF0NOID')
  const [nst, ncbk] = await row('SPRF0NOID', 'payment_status, cbk_status')
  is(nst === 'review' && ncbk === 'MISSING_PAYMENT_ID', 'a capture with no Payment ID is held for review', `${nst} ${ncbk}`)
  const nid = Number(await sql("select id from orders where track_id='SPRF0NOID'"))
  const nr = await refund(nid, 'void', '100202555444', '21.000')
  is(nr.status === 200 && nr.body?.order?.payment_status === 'voided' && nr.body.order.payment_id === '100202555444',
     'and is closed with the Payment ID found in KPay, which the order now records', `${nr.body?.order?.payment_id}`)
}

// --------------------------------------------------------- 5. second captures
head('5. B3: a second capture on one order')
{
  const o = await paidOrder('SPRF0DUP')
  const [paidAt0, payid] = await row('SPRF0DUP', 'paid_at, cbk_paymentid')
  const p0 = await outbox('SPRF0DUP', 'payment')
  const same = await callback(`result=CAPTURED&trackid=SPRF0DUP&amt=21.000&paymentid=${payid}&ref=R&tranid=T&udf5=SPRF0DUP`)
  is(same.includes('status=success') && await sql(`select count(*) from payment_alerts where order_id=${o.id}`) === '0',
     'the SAME Payment ID replayed: success, and no alert (a silent no-op)', same.slice(0, 50))
  const logBefore = readLog().length
  const dup = await callback('result=CAPTURED&trackid=SPRF0DUPA2&amt=21.000&paymentid=100202777001&ref=RDUP&tranid=TDUP&auth=A1&udf5=SPRF0DUP')
  is(dup.includes('status=success'), 'a CAPTURED under a DIFFERENT Payment ID: the shopper still sees the paid order', dup.slice(0, 60))
  const al = await sql(`select concat(payment_id,'|',order_payment_id,'|',amount,'|',transaction_id,'|',reference,'|',attempt_ref,'|',source,'|',coalesce(resolution,'OPEN')) from payment_alerts where order_id=${o.id}`)
  is(al === `100202777001|${payid}|21.000|TDUP|RDUP|SPRF0DUPA2|callback|OPEN`,
     'and it is KEPT as an open alert: the extra Payment ID, the one the order records, the amount, the bank references', al)
  const [st, pid, paidAt1] = await row('SPRF0DUP', 'payment_status, cbk_paymentid, paid_at')
  is(st === 'paid' && pid === payid && paidAt1 === paidAt0 && await outbox('SPRF0DUP', 'payment') === p0,
     'the order is untouched: still paid, same Payment ID, same paid time, no second "ship it"', `${st} ${pid}`)
  is(readLog().slice(logBefore).includes('"event":"callback.duplicate_capture"'), 'and the payment log says callback.duplicate_capture')
  await callback('result=CAPTURED&trackid=SPRF0DUPA2&amt=21.000&paymentid=100202777001&ref=RDUP&tranid=TDUP&udf5=SPRF0DUP')
  is(await sql(`select count(*) from payment_alerts where order_id=${o.id}`) === '1', 'the duplicate replayed is still ONE alert')

  const list = (await admin('payment_alerts')).body
  is(list?.ready === true && list.alerts?.some((a) => a.track_id === 'SPRF0DUP' && a.payment_id === '100202777001'),
     '/backends lists it as an open payment alert, with the order number', `${list?.open}`)
  const view = (await admin(`knet_payment_record&order_id=${o.id}`)).body
  is(view?.actions?.open_alerts === 1 && view.alerts?.[0]?.payment_id === '100202777001', 'and the order view shows it')

  const wrongAmt = await refund(o.id, 'refund', '100202777001', '10.000')
  is(wrongAmt.body?.error === 'amount_must_match_capture', 'the second charge is given back whole: part of it is refused', wrongAmt.body?.error)
  const s0 = (await admin('stats')).body
  const back = await refund(o.id, 'refund', '100202777001', '21.000', { kpay_reference: 'KPCR1' })
  is(back.status === 200 && back.body?.order?.payment_status === 'paid' && back.body.order.refunded_amount === '0.000',
     'refunding the DUPLICATE leaves the order paid with nothing refunded against it', `${back.status} ${back.body?.order?.payment_status} ${back.body?.order?.refunded_amount}`)
  is(await sql(`select concat(resolution,'|',resolved_by) from payment_alerts where order_id=${o.id}`) === 'refunded|qa-admin@sporta.test'
     && await sql(`select scope from order_refunds where order_id=${o.id}`) === 'duplicate',
     'the alert is resolved as refunded, and the refund row says it was the second capture')
  const s1 = (await admin('stats')).body
  is(Number(s0.paid_revenue) === Number(s1.paid_revenue), 'and revenue is unchanged (that money was never the order\'s)', `${s0.paid_revenue} -> ${s1.paid_revenue}`)

  await callback('result=CAPTURED&trackid=SPRF0DUPA3&amt=21.000&paymentid=100202777002&ref=RD2&tranid=TD2&udf5=SPRF0DUP')
  const aid = Number(await sql(`select id from payment_alerts where order_id=${o.id} and payment_id='100202777002'`))
  const dis = await admin('payment_alert_dismiss', { alert_id: aid, note: 'same card, KPay shows one charge' })
  is(dis.status === 200 && await sql(`select resolution from payment_alerts where id=${aid}`) === 'dismissed', 'an alert can be dismissed after checking KPay')
  const dis2 = await admin('payment_alert_dismiss', { alert_id: aid })
  is(dis2.status === 409 && dis2.body?.error === 'alert_already_resolved', 'once', `${dis2.status} ${dis2.body?.error}`)

  // a review capture overwritten by a second capture is kept as an alert first
  await newOrder('SPRF0RDUP')
  await pay('SPRF0RDUP', '&amt=0.100')
  const [r1st, r1pay] = await row('SPRF0RDUP', 'payment_status, cbk_paymentid')
  const rdid = Number(await sql("select id from orders where track_id='SPRF0RDUP'"))
  await callback('result=CAPTURED&trackid=SPRF0RDUPA2&amt=21.000&paymentid=100202777003&ref=RR&tranid=TR&udf5=SPRF0RDUP')
  const [r2st, r2pay] = await row('SPRF0RDUP', 'payment_status, cbk_paymentid')
  const ra = await sql(`select concat(payment_id,'|',order_payment_id) from payment_alerts where order_id=${rdid}`)
  is(r1st === 'review' && r2st === 'paid' && r2pay === '100202777003' && ra === `${r1pay}|100202777003`,
     'a capture under review, then a correct one: the order is paid by the second and the FIRST charge is kept as an alert', `${r1st}->${r2st} alert ${ra}`)

  // REVIEW 1, FINDING 2: an open second charge stays refundable after the order's OWN payment was refunded or voided.
  const fo = await paidOrder('SPRF0D2R')
  await callback('result=CAPTURED&trackid=SPRF0D2RA2&amt=21.000&paymentid=100202777011&ref=RX&tranid=TX&udf5=SPRF0D2R')
  const own = await refund(fo.id, 'refund', fo.payid, '21.000')
  is(own.status === 200 && own.body?.order?.payment_status === 'refunded', 'the order\'s own payment is refunded first (an open second charge is still on it)')
  const fv = (await admin(`knet_payment_record&order_id=${fo.id}`)).body
  is(fv?.actions?.refund === true && fv.actions.open_alerts === 1, 'the order view still offers a refund, for the open second charge', JSON.stringify(fv?.actions))
  const ownAgain = await refund(fo.id, 'refund', fo.payid, '1.000')
  is(ownAgain.body?.error === 'order_already_refunded', 'the order\'s own payment still cannot be refunded twice', ownAgain.body?.error)
  const dupBack = await refund(fo.id, 'refund', '100202777011', '21.000')
  is(dupBack.status === 200 && await sql(`select resolution from payment_alerts where order_id=${fo.id}`) === 'refunded'
     && await sql(`select count(*) from order_refunds where order_id=${fo.id} and scope='duplicate'`) === '1'
     && (await row('SPRF0D2R', 'payment_status, refunded_amount')).join('|') === 'refunded|21.000',
     'and the second charge IS recorded as refunded (not only dismissable); the order stays refunded at 21.000', `${dupBack.status} ${dupBack.body?.error ?? ''}`)
  const fw = await paidOrder('SPRF0D2V')
  const vd = await refund(fw.id, 'void', fw.payid, '21.000')
  await callback('result=CAPTURED&trackid=SPRF0D2VA2&amt=21.000&paymentid=100202777012&ref=RY&tranid=TY&udf5=SPRF0D2V')
  const afterVoid = await refund(fw.id, 'refund', '100202777012', '21.000')
  is(vd.status === 200 && afterVoid.status === 200 && await sql(`select resolution from payment_alerts where order_id=${fw.id}`) === 'refunded'
     && (await row('SPRF0D2V', 'payment_status'))[0] === 'voided',
     'a capture that arrives AFTER a void is kept as an alert and can be recorded as refunded', `${afterVoid.status} ${afterVoid.body?.error ?? ''}`)

  // the table missing: the shopper is still answered, the log keeps it
  const o2 = await paidOrder('SPRF0NOTB')
  await sql('rename table payment_alerts to payment_alerts_away')
  try {
    const before = readLog().length
    const t = await callback('result=CAPTURED&trackid=SPRF0NOTBA2&amt=21.000&paymentid=100202777004&ref=RN&tranid=TN&udf5=SPRF0NOTB')
    const tail = readLog().slice(before)
    is(t.includes('status=success') && (await row('SPRF0NOTB', 'payment_status'))[0] === 'paid',
       'with payment_alerts missing (migration not imported) a second capture still answers "paid"', t.slice(0, 50))
    is(tail.includes('"event":"callback.duplicate_capture"') && tail.includes('"alert":"not_saved"') && tail.includes('100202777004'),
       'and the payment log keeps the duplicate, marked not_saved')
    const r = await refund(o2.id, 'refund', o2.payid, '1.000')
    is(r.status === 503 && r.body?.error === 'refunds_migration_missing', 'the refund route says the migration is missing and writes nothing', `${r.status} ${r.body?.error}`)
    const pa = await admin('payment_alerts')
    is(pa.status === 200 && pa.body?.ready === false, 'the alert list answers ready=false (the admin block\'s probe)', JSON.stringify(pa.body))
  } finally {
    await sql('rename table payment_alerts_away to payment_alerts')
  }
}

// --------------------------------------- 5b. settled by hand, then the bank
head('5b. settled by hand, then the bank\'s own notification (review 1, finding 3)')
{
  await newOrder('SPRF0MAN')
  const mid = Number(await sql("select id from orders where track_id='SPRF0MAN'"))
  const ms = await admin('card_settled', { order_id: mid, bank_reference: 'KPAY-SEEN-4411' })
  is(ms.status === 200 && (await row('SPRF0MAN', 'cbk_status, cbk_paymentid')).join('|') === 'MANUAL_BANK_CONFIRMED|KPAY-SEEN-4411',
     'the owner settles a KNET order by hand with the reference they read in KPay')
  const p0 = await outbox('SPRF0MAN', 'payment')
  const before = readLog().length
  const late = await callback('result=CAPTURED&trackid=SPRF0MAN&amt=21.000&paymentid=100202888001&ref=RM1&tranid=TM1&auth=AM1&udf5=SPRF0MAN')
  const [mst, mcbk, mpid, mtid, mmsg] = await row('SPRF0MAN', 'payment_status, cbk_status, cbk_paymentid, cbk_transaction, cbk_message')
  is(late.includes('status=success') && await sql(`select count(*) from payment_alerts where order_id=${mid}`) === '0',
     'the bank\'s late notification of THAT payment is not a second charge: no alert', late.slice(0, 60))
  is(mst === 'paid' && mcbk === 'MANUAL_THEN_CAPTURED' && mpid === '100202888001' && mtid === 'TM1' && /^settled in admin by /.test(mmsg)
     && await outbox('SPRF0MAN', 'payment') === p0,
     'the bank\'s own Payment ID and references replace the typed one; still paid, the "settled in admin" note kept, no second "ship it"',
     `${mst} ${mcbk} ${mpid} ${mtid}`)
  is(readLog().slice(before).includes('"event":"callback.manual_settlement_confirmed"') && readLog().slice(before).includes('KPAY-SEEN-4411'),
     'and the payment log keeps the typed reference (callback.manual_settlement_confirmed)')
  await callback('result=CAPTURED&trackid=SPRF0MANA2&amt=21.000&paymentid=100202888002&ref=RM2&tranid=TM2&udf5=SPRF0MAN')
  is(await sql(`select payment_id from payment_alerts where order_id=${mid}`) === '100202888002',
     'a capture under yet ANOTHER Payment ID after that is a second charge again (alert)')
  await newOrder('SPRF0MAN2')
  const mid2 = Number(await sql("select id from orders where track_id='SPRF0MAN2'"))
  await admin('card_settled', { order_id: mid2, bank_reference: 'KPAY-SEEN-4412' })
  await callback('result=CAPTURED&trackid=SPRF0MAN2&amt=5.000&paymentid=100202888003&ref=RM3&tranid=TM3&udf5=SPRF0MAN2')
  is(await sql(`select payment_id from payment_alerts where order_id=${mid2}`) === '100202888003'
     && (await row('SPRF0MAN2', 'cbk_status, cbk_paymentid')).join('|') === 'MANUAL_BANK_CONFIRMED|KPAY-SEEN-4412',
     'a late capture for ANOTHER amount is not absorbed: it is kept as an alert for the owner, the order untouched')
}

// ----------------------------------------------------- 6. the reconciliation
head('6. C2: the daily reconciliation export')
{
  const day = await sql('select date(utc_timestamp())')
  const bad1 = await admin('knet_reconcile_export')
  is(bad1.status === 400 && bad1.body?.error === 'invalid_dates', 'no dates: refused', `${bad1.status}`)
  const bad2 = await admin('knet_reconcile_export&from=2026-01-01&to=2026-12-31')
  is(bad2.status === 400, 'more than 92 days: refused', `${bad2.status}`)
  const bad3 = await admin('knet_reconcile_export&from=2026-11-12&to=2026-11-11')
  is(bad3.status === 400, 'a window that ends before it starts: refused', `${bad3.status}`)
  // a retried order, so a Merchant Track ID with the A<n> suffix exists
  await newOrder('SPRF0RTRY')
  await fetch(`${KNET}/pay.php?trackid=SPRF0RTRY`, { headers: HTTPS, redirect: 'manual' })
  await pay('SPRF0RTRY')
  const csv = await admin(`knet_reconcile_export&from=${day}&to=${day}&tz=utc`, null, { raw: true })
  is(csv.status === 200 && /^text\/csv/.test(csv.headers.get('content-type') ?? '') && /attachment; filename="knet-reconcile-/.test(csv.headers.get('content-disposition') ?? ''),
     'today\'s export is a CSV download', `${csv.status} ${csv.headers.get('content-type')}`)
  const text = csv.text
  is(text.charCodeAt(0) === 0xfeff, 'with a byte order mark (a spreadsheet reads it as UTF-8)')
  const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n')
  const cols = (l) => l.slice(1, -1).split('","')
  const headRow = cols(lines[0])
  const by = Object.fromEntries(lines.slice(1).map((l) => { const c = cols(l); return [c[0], Object.fromEntries(headRow.map((h, i) => [h, c[i]]))] }))
  is(headRow.includes('Payment ID') && headRow.includes('Transaction ID') && headRow.includes('Merchant Track IDs sent to KNET') && headRow.includes('Paid (Kuwait)'),
     'the columns KPay\'s reports are matched on', headRow.join('|').slice(0, 160))
  const rt = by.SPRF0RTRY
  is(rt && rt['Merchant Track IDs sent to KNET'] === 'SPRF0RTRY SPRF0RTRYA2' && rt['Answered under'] === 'SPRF0RTRYA2' && rt['Payment status'] === 'paid' && /^\d+$/.test(rt['Payment ID']),
     'a retried order lists BOTH references it was sent to KNET under, the one the bank answered under, and its Payment ID', JSON.stringify(rt ?? {}).slice(0, 160))
  const part = by.SPRF0PART
  is(part && part['Payment status'] === 'refunded' && part['Refunded KWD'] === '21.000' && part['Net KWD'] === '0.000'
     && /refund 5\.000 \d+ KPay KP-778/.test(part['Refunds and voids']) && /refund 16\.000/.test(part['Refunds and voids']),
     'a refunded order shows both refunds with their KPay reference, and nets to 0.000', part ? part['Refunds and voids'] : 'missing')
  const dup = by.SPRF0DUP
  is(dup && /100202777001 21\.000 refunded/.test(dup['Second captures']) && /100202777002 21\.000 dismissed/.test(dup['Second captures'])
     && /second capture/.test(dup['Refunds and voids']),
     'the order with two extra charges lists both, and the refund of the duplicate says so', dup ? dup['Second captures'] : 'missing')
  is(!text.includes('Mariam') && !text.includes('99887711') && !text.includes('Salmiya'), 'no customer name, phone or area in the export')
  is(!Object.keys(by).includes('SPRF0COD'), 'cash orders are not in a KNET reconciliation')
  const kw = await admin(`knet_reconcile_export&from=${day}&to=${day}`, null, { raw: true })
  is(kw.status === 200 && /-kuwait\.csv"/.test(kw.headers.get('content-disposition') ?? ''), 'the default window is a Kuwait day', kw.headers.get('content-disposition'))
  const old = await admin('knet_reconcile_export&from=2020-01-01&to=2020-01-02&tz=utc', null, { raw: true })
  is(old.status === 200 && old.text.replace(/^\uFEFF/, '').trim().split('\r\n').length === 1, 'a day with no KNET activity is the header only')
  // the formula guard, on the function itself (no track id can start with =)
  const php = execFileSync('php', ['-r', `require '${WEB}dropin/php-store/payment-records.php'; echo payrec_csv_line(['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', 'ok', "\\tx", 'a"b']);`]).toString()
  is(php === `"'=HYPERLINK(""x"")","'+1","'-2","'@SUM(A1)","ok","'\tx","a""b"`, 'a cell that starts with = + - @ or a tab is made text; quotes are doubled', php)
}

console.log(`\n${passes} ok, ${fails} failed`)
if (fails) { console.log('\nKNET payment records: FAILED'); process.exit(1) }
console.log('\nKNET payment records: refunds, voids, second captures and the reconciliation export hold')
