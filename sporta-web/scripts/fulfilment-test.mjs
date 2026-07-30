// The order -> warehouse flow, end to end against a real PostgreSQL.
//
//   ./scripts/db-rebuild.sh fresh && npm run test:fulfilment
//
// Two halves, and both matter:
//
//   1. THE QUEUE. Placing an order must produce exactly one message, with the
//      items in it, in the same transaction. A message that goes missing is an
//      order that never ships, and nobody finds out from the customer side
//      until it is late.
//   2. THE EMAIL. The renderer is checked against payloads the database
//      actually produced, not hand-written fixtures — a fixture that drifts
//      from the schema tests nothing.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { renderMessage, addressText, subjectFor } from '../supabase/functions/notify-warehouse/render.mjs'

const run = promisify(execFile)
const DB = process.env.DB ?? 'fresh'
const sql = async (q) =>
  (await run('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', DB, '-tAq', '-c', q])).stdout.trim()

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => {
  fails++
  console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`)
}
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))

const CUSTOMER = JSON.stringify({
  name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli', area: 'Salmiya',
  block: '4', street: '12', building: '5', floor: '3', flat: '7', note: 'Ring the bell twice',
})

const place = (track, items, method = 'knet') =>
  sql(`select public.create_order('${track}', '${items}'::jsonb, '${CUSTOMER}'::jsonb, '${method}')`)

// A clean slate each run, so counts mean what they say.
await sql('delete from public.fulfilment_outbox; delete from public.order_items; delete from public.orders;')

// ---------------------------------------------------------------- the queue
{
  await place(
    'SPFUL001',
    '[{"slug":"cloudsoft-jacket-army-green","qty":2,"size":"L","fit":"oversize"},{"slug":"cagliari-calcio-backpack","qty":1}]',
  )

  const rows = await sql("select count(*) from public.fulfilment_outbox where kind='new'")
  is(rows === '1', 'placing an order queues exactly one message', `${rows} row(s)`)

  // The subtle one. order_items are inserted AFTER the orders row, so a plain
  // row-level AFTER INSERT trigger would snapshot an order with no items — a
  // picking list with nothing to pick. The deferred constraint trigger is what
  // makes this pass.
  const items = await sql(
    "select jsonb_array_length(payload->'items') from public.fulfilment_outbox where kind='new'",
  )
  is(items === '2', 'the snapshot contains the items, not an empty list', `${items} item(s)`)

  const sizes = await sql(
    "select payload->'items'->1->>'size' || '/' || (payload->'items'->1->>'fit') from public.fulfilment_outbox where kind='new'",
  )
  is(sizes === 'L/oversize', 'size and fit travel to the warehouse', sizes)

  // Nothing is marked sent until something actually sends it.
  const unsent = await sql('select count(*) from public.fulfilment_outbox where sent_at is null')
  is(unsent === '1', 'a queued message starts unsent')
}

// ---------------------------------------------------- payment follow-up
{
  await sql("update public.orders set payment_status='paid' where track_id='SPFUL001'")
  const kinds = await sql(`select string_agg(kind, ',' order by created_at) from public.fulfilment_outbox`)
  is(kinds.includes('payment'), 'a settled payment queues a follow-up', kinds)

  // Writing the same status again is not news.
  await sql("update public.orders set payment_status='paid' where track_id='SPFUL001'")
  const n = await sql('select count(*) from public.fulfilment_outbox')
  is(n === '2', 'rewriting the same status does not spam the warehouse', `${n} rows`)

  // 'review' is a real payment status here and is not a settled outcome.
  await sql("update public.orders set payment_status='review' where track_id='SPFUL001'")
  const n2 = await sql('select count(*) from public.fulfilment_outbox')
  is(n2 === '2', "'review' is not an outcome and queues nothing", `${n2} rows`)
}

// ---------------------------------------------------------------- claiming
{
  const claimed = await sql('select count(*) from public.claim_fulfilment(10)')
  is(claimed === '2', 'the sender claims everything unsent', `${claimed}`)
  const again = await sql('select count(*) from public.claim_fulfilment(10)')
  is(again === '2', 'claiming again re-offers unsent rows rather than losing them', `${again}`)
  const attempts = await sql('select max(attempts) from public.fulfilment_outbox')
  is(attempts === '2', 'each claim counts an attempt, so a failing row cannot loop forever', attempts)

  await sql(
    "select public.mark_fulfilment_sent(id) from public.fulfilment_outbox where kind='new'",
  )
  const left = await sql('select count(*) from public.claim_fulfilment(10)')
  is(left === '1', 'a sent message is never claimed again', `${left}`)
}

// ---------------------------------------------------------------- the email
{
  const payload = JSON.parse(
    await sql("select payload::text from public.fulfilment_outbox where kind='new'"),
  )
  const { subject, html, text } = renderMessage('new', payload)

  // Everything the picker and the driver need has to survive into the message.
  for (const [what, needle] of [
    ['the order number', 'SPFUL001'],
    ['the customer name', 'Fatima Al-Sabah'],
    ['the phone number', '96599887766'],
    ['the block', 'Block 4'],
    ['the building', 'Building 5'],
    ['the area', 'Salmiya'],
    ['the delivery note', 'Ring the bell twice'],
    ['the size', 'L'],
    ['the cut', 'Oversize'],
    ['the Arabic product name', 'جاكيت'],
  ]) {
    if (!text.includes(needle) && !html.includes(needle)) bad(`${what} reaches the warehouse`, needle)
  }
  ok('every field the warehouse needs is in the email')

  is(subject.includes('SPFUL001'), 'the subject names the order', subject)
  is(!/undefined|null|NaN|\[object/.test(text), 'no placeholder leaks into the text part')
  is(!/undefined|NaN|\[object/.test(html), 'no placeholder leaks into the HTML part')

  // An order awaiting payment must say so in the subject, because that is all
  // that gets read on a busy morning.
  const holding = subjectFor('new', { ...payload, payment_status: 'pending', collect_cash: false })
  is(/hold/i.test(holding), 'an unpaid order says "hold" in the subject line', holding)
}

// --------------------------------------------------------- cash on delivery
{
  await place('SPFUL002', '[{"slug":"cheetahs-rugby-t-shirt","qty":1,"size":"M"}]', 'cod')
  const payload = JSON.parse(
    await sql(
      "select f.payload::text from public.fulfilment_outbox f join public.orders o on o.id=f.order_id where o.track_id='SPFUL002' and f.kind='new'",
    ),
  )
  is(payload.collect_cash === true, 'a COD order is flagged to collect cash')

  const { subject, text, html } = renderMessage('new', payload)
  is(/COLLECT CASH/.test(subject), 'the subject says COLLECT CASH', subject)
  // The amount has to be next to the instruction. "Collect cash" without a
  // figure is a driver guessing, and a guess is a loss.
  is(/COLLECT KWD 8\.000/.test(text) && html.includes('KWD 8.000'), 'the amount to collect is stated')
}

// ------------------------------------------------------------ escaping
{
  // A customer's delivery note is free text and ends up in an HTML email.
  await sql(
    `update public.orders set customer_note = '<script>alert(1)</script>' where track_id = 'SPFUL002'`,
  )
  const payload = JSON.parse(
    await sql(
      "select public.fulfilment_payload(id)::text from public.orders where track_id='SPFUL002'",
    ),
  )
  const { html } = renderMessage('new', payload)
  is(!html.includes('<script>'), 'a delivery note cannot inject markup into the email')
  is(html.includes('&lt;script&gt;'), 'it is escaped, not silently dropped')
}

// ---------------------------------------------------------------- address
{
  is(
    addressText({ governorate: 'capital', area: 'Sharq', block: '1', street: '2', building: '3' }) ===
      'Block 1, Street 2, Building 3 — Sharq, Capital',
    'a house address reads the way a Kuwaiti address is spoken',
  )
  is(
    !addressText({ area: 'Sharq', block: '1' }).includes('Floor'),
    'an absent floor prints nothing rather than "Floor -"',
  )
}

console.log(fails ? `\n${fails} problem(s) in the fulfilment flow` : '\nevery order reaches the warehouse')
process.exit(fails ? 1 : 0)
