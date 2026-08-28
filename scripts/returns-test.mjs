/**
 * Returns and exchanges, end to end: the two public routes, the admin pair,
 * and the customer's page driven in a real browser.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/returns-test.mjs
 *
 * The rig SEEDS ITS OWN ORDER rather than picking one out of the sandbox. A
 * return needs a paid, delivered, uncancelled order with lines on it, and
 * whether one exists depends on what the other rigs did last — which is how a
 * test starts passing for a reason that has nothing to do with the code. It
 * cleans up after itself, so it can be run twice.
 *
 * What it is actually here to hold:
 *
 *   - the phone is the gate. `track_id` is chosen by the CLIENT at checkout
 *     and may legally be six characters, so a lookup on the reference alone
 *     would hand a stranger a customer's name and shopping.
 *   - a line cannot be returned twice. The arithmetic that stops it lives in
 *     one place and is easy to lose.
 *   - women's clothing cannot be exchanged. It is the shop's own policy, it
 *     is on the page, and this is the point where it costs money.
 *   - the fourteen days run from DELIVERY, not from the order.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const API = BASE + '/api/api.php'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

// --default-character-set=utf8mb4 is NOT optional. Without it the client
// negotiates latin1 and every Arabic reason comes back as '??????', which
// reads as the shop having mangled the customer's text when the row is
// perfectly correct. It cost a diagnosis once.
const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })

const rows = (q) => {
  const out = sql(q).trim().split('\n')
  if (out.length < 2) return []
  const head = out[0].split('\t')
  return out.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))
}

const get = async (path) => {
  const r = await fetch(API + path, { headers: { Accept: 'application/json' } })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const post = async (path, body) => {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

// ------------------------------------------------------------------ fixture
//
// A delivered, paid, cash order for two lines: one men's and one WOMEN'S, so
// the exchange ban has something to fire on. Sizes are real ones from
// STORE_SIZES; the products are whichever two the seeded catalogue has in
// those categories, so this does not pin a slug that may be renamed.
const TRACK = 'SPRTEST' + Math.random().toString(36).slice(2, 8).toUpperCase()
const PHONE_LOCAL = '55512345'
const PHONE_FULL = '965' + PHONE_LOCAL

const pick = (category) => {
  const r = rows(`select id, slug from products where category = '${category}' and active = 1 limit 1`)
  return r[0] ?? null
}

// The rig places a dozen real requests through the real throttle, which is
// bounded per IP over ten minutes — so run twice in a row it would start
// refusing itself and report a bug in the shop. sandbox.sh clears the order
// counters for exactly this reason; this clears the two that are ours.
const clearThrottle = () => sql('delete from rate_limit')

const cleanup = () => {
  // The FK on return_requests cascades from orders, and order_items cascades
  // too — so deleting the order takes the whole fixture with it.
  sql(`delete from orders where track_id like 'SPRTEST%'`)
}

cleanup()
clearThrottle()
const mens = pick('men')
const womens = pick('women')
if (!mens || !womens) {
  console.log('FAIL the seeded catalogue has no men\'s or no women\'s product to test with')
  process.exit(1)
}

sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status,
       customer_name, customer_phone, fulfilled_at, created_at)
     values ('${TRACK}', 18.000, 'paid', 'cod', 'delivered', 'Returns Rig', '${PHONE_FULL}',
             date_sub(now(), interval 2 day), date_sub(now(), interval 9 day))`)
const orderId = rows(`select id from orders where track_id = '${TRACK}'`)[0].id
sql(`insert into order_items (order_id, product_id, qty, unit_price, size)
     values (${orderId}, ${mens.id}, 2, 5.000, 'L'),
            (${orderId}, ${womens.id}, 1, 8.000, 'M')`)
const lines = rows(`select id, product_id from order_items where order_id = ${orderId} order by id`)
const mensLine = Number(lines[0].id)
const womensLine = Number(lines[1].id)

console.log(`fixture: order ${TRACK} (#${orderId}), men's line ${mensLine} x2, women's line ${womensLine} x1\n`)

// ------------------------------------------------------------------- lookup

{
  const r = await get(`?r=return_items&ref=${TRACK}&phone=${PHONE_LOCAL}`)
  check(r.status === 200, 'the order is found by its reference and its own phone', `got ${r.status}`)
  const items = r.body?.items ?? []
  check(items.length === 2, 'both lines come back', `got ${items.length}`)
  check(items[0]?.available === 2 && items[1]?.available === 1,
    'availability starts at the quantity ordered')
  // The women's line must announce the ban rather than leave the page to
  // guess it from a category the API does not send.
  const w = items.find((i) => i.id === womensLine)
  check(w?.no_exchange === true, "the women's line is marked no_exchange")
  check(items.find((i) => i.id === mensLine)?.no_exchange === false,
    "the men's line is not")
  // Fourteen days FROM DELIVERY. The order was placed nine days ago and
  // delivered two days ago, so a window counted from the order would say 5.
  check(r.body?.window?.days_left === 12,
    'the window runs from delivery, not from the order — 12 days left',
    `got ${r.body?.window?.days_left}`)
}

{
  const r = await get(`?r=return_items&ref=${TRACK}&phone=99887766`)
  check(r.status === 404 && r.body?.error === 'return_not_found',
    'the wrong phone is refused', `got ${r.status} ${JSON.stringify(r.body)}`)
}
{
  // A reference that does not exist and a real reference with a wrong phone
  // must be INDISTINGUISHABLE, or the difference is an oracle for testing
  // whether an order number is real.
  const a = await get(`?r=return_items&ref=SPRNOPE0000&phone=${PHONE_LOCAL}`)
  const b = await get(`?r=return_items&ref=${TRACK}&phone=99887766`)
  check(a.status === b.status && a.body?.error === b.body?.error,
    'a missing order and a wrong phone answer identically',
    `${a.status}/${a.body?.error} vs ${b.status}/${b.body?.error}`)
}

// -------------------------------------------------------------- the refusals

{
  const r = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'exchange',
    items: [{ id: womensLine, qty: 1, want_size: 'L' }],
  })
  check(r.status === 422 && r.body?.error === 'return_no_exchange',
    "a women's item cannot be exchanged", `got ${r.status} ${JSON.stringify(r.body)}`)
}
{
  const r = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'return',
    items: [{ id: womensLine, qty: 1 }],
  })
  check(r.status === 200 && r.body?.ref,
    "but it CAN be returned — the ban is on exchange only", JSON.stringify(r.body))
  // Put it back so the rest of the rig starts from a clean line.
  if (r.body?.ref) sql(`delete from return_requests where ref = '${r.body.ref}'`)
}
{
  const r = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'return',
    items: [{ id: mensLine, qty: 3 }],
  })
  check(r.status === 422 && r.body?.error === 'return_qty',
    'more than was bought is refused', `got ${r.status} ${JSON.stringify(r.body)}`)
}
{
  // A line belonging to somebody else's order, passed off as one of ours.
  const other = rows(
    `select oi.id from order_items oi where oi.order_id <> ${orderId} limit 1`)[0]
  if (other) {
    const r = await post('?r=return_request', {
      ref: TRACK, phone: PHONE_LOCAL, kind: 'return',
      items: [{ id: Number(other.id), qty: 1 }],
    })
    check(r.status === 422 && r.body?.error === 'return_line_unknown',
      "another order's line cannot be smuggled in", `got ${r.status} ${JSON.stringify(r.body)}`)
  }
}
{
  const r = await post('?r=return_request', {
    ref: TRACK, phone: '99887766', kind: 'return', items: [{ id: mensLine, qty: 1 }],
  })
  check(r.status === 422 && r.body?.error === 'return_not_found',
    'submitting with the wrong phone is refused too — the gate is on both routes',
    `got ${r.status} ${JSON.stringify(r.body)}`)
}

// ------------------------------------------------------------- the happy path

let madeRef = null
{
  const r = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'exchange', lang: 'ar',
    reason: 'المقاس كبير',
    items: [{ id: mensLine, qty: 1, want_size: 'XL' }],
  })
  check(r.status === 200 && /^SPR[2-9A-HJ-NP-Z]{8}$/.test(r.body?.ref ?? ''),
    'a request is written and answered with a reference', JSON.stringify(r.body))
  madeRef = r.body?.ref

  const row = rows(`select kind, status, phone, reason from return_requests where ref = '${madeRef}'`)[0]
  check(row?.kind === 'exchange' && row?.status === 'new',
    'the row says what was asked for, and that nobody has looked at it yet')
  check(row?.phone === PHONE_FULL,
    'the phone is stored normalised, the way store_phone() returns it', row?.phone)
  const line = rows(
    `select qty, want_size from return_request_items ri
      join return_requests rr on rr.id = ri.request_id where rr.ref = '${madeRef}'`)[0]
  check(line?.qty === '1' && line?.want_size === 'XL',
    'the wanted size is recorded against the line')
}

{
  const r = await get(`?r=return_items&ref=${TRACK}&phone=${PHONE_LOCAL}`)
  const mens_ = r.body.items.find((i) => i.id === mensLine)
  check(mens_.available === 1,
    'the line that was asked about has one left of its two', `got ${mens_.available}`)
  check((r.body.existing ?? []).some((e) => e.ref === madeRef),
    'the open request is shown back to the customer')
}
{
  // The SECOND of the two is still allowed; the third is not.
  const ok = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'return', items: [{ id: mensLine, qty: 1 }],
  })
  check(ok.status === 200, 'the remaining one can still be asked about')
  const no = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'return', items: [{ id: mensLine, qty: 1 }],
  })
  check(no.status === 422 && no.body?.error === 'return_qty',
    'a third is refused — a line cannot be returned twice',
    `got ${no.status} ${JSON.stringify(no.body)}`)

  // A REJECTED request releases its lines. Being refused once must not cost
  // the customer the item for ever.
  sql(`update return_requests set status = 'rejected' where ref = '${ok.body.ref}'`)
  const again = await get(`?r=return_items&ref=${TRACK}&phone=${PHONE_LOCAL}`)
  check(again.body.items.find((i) => i.id === mensLine).available === 1,
    'rejecting a request gives the line back')
  sql(`delete from return_requests where ref = '${ok.body.ref}'`)
}

// ----------------------------------------------------------------- the window

{
  sql(`update orders set fulfilled_at = date_sub(now(), interval 20 day) where id = ${orderId}`)
  const look = await get(`?r=return_items&ref=${TRACK}&phone=${PHONE_LOCAL}`)
  check(look.body?.window?.open === false && look.body?.window?.days_left === 0,
    'past fourteen days the window is closed')
  const r = await post('?r=return_request', {
    ref: TRACK, phone: PHONE_LOCAL, kind: 'return', items: [{ id: mensLine, qty: 1 }],
  })
  check(r.status === 422 && r.body?.error === 'return_window_closed',
    'and a request is refused by the SERVER, not merely hidden by the page',
    `got ${r.status} ${JSON.stringify(r.body)}`)
  sql(`update orders set fulfilled_at = date_sub(now(), interval 2 day) where id = ${orderId}`)
}

// ------------------------------------------------------- unpaid and cancelled

{
  sql(`update orders set payment_status = 'pending' where id = ${orderId}`)
  const r = await get(`?r=return_items&ref=${TRACK}&phone=${PHONE_LOCAL}`)
  check(r.body?.error === 'return_not_paid', 'an unpaid order has nothing to return')
  sql(`update orders set payment_status = 'paid', fulfilment_status = 'cancelled' where id = ${orderId}`)
  const c = await get(`?r=return_items&ref=${TRACK}&phone=${PHONE_LOCAL}`)
  check(c.body?.error === 'return_cancelled', 'nor has a cancelled one')
  sql(`update orders set fulfilment_status = 'delivered' where id = ${orderId}`)
}

// --------------------------------------------------------------- the panel

{
  // admin.php requires a session; the rig checks the GATE rather than
  // reimplementing the login — that is test:admin-live's job. What matters
  // here is that a stranger gets nothing.
  const r = await fetch(BASE + '/api/admin.php?r=returns',
    { headers: { 'X-Sporta-Admin': '1' } })
  check(r.status === 401, 'the returns list refuses a stranger', `got ${r.status}`)
  // WITHOUT the header too. store_require_admin() checks the session first and
  // the header second, so this is 401 rather than 400 — the header is a CSRF
  // backstop for an authenticated caller, and a signed-out stranger is refused
  // for the more basic reason. Both closed is what matters.
  const s = await fetch(BASE + '/api/admin.php?r=returns')
  check(s.status === 401, 'and refuses one who omits X-Sporta-Admin as well', `got ${s.status}`)
}

// ------------------------------------------------------------ the page itself

{
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', (e) => errors.push(String(e)))

  await p.goto(BASE + '/returns/request', { waitUntil: 'networkidle' })
  check(await p.locator('#lookup').isVisible(), 'the page opens on the lookup form')

  await p.fill('#track', TRACK)
  await p.fill('#phone', PHONE_LOCAL)
  await p.click('#find')
  await p.waitForSelector('#pick:not([hidden])', { timeout: 8000 })
  check(true, 'a real order number and phone reach the item picker')

  const lines_ = await p.locator('#lines .line').count()
  check(lines_ === 2, 'both lines of the order are drawn', `got ${lines_}`)

  // Exchange is the default, so the women's line must start greyed and
  // uncheckable — the ban enforced where the customer can see it, not only
  // after they have filled the form in.
  const womensBox = p.locator(`#line-${womensLine}`)
  check(await womensBox.isDisabled(),
    "the women's line cannot be ticked for an exchange")
  // The LABEL, not the radio. The radio is deliberately sized to nothing so
  // the label can carry the whole target — which is what a customer taps.
  await p.click('.kind:has(input[value="return"])')
  await p.waitForTimeout(150)
  check(!(await p.locator(`#line-${womensLine}`).isDisabled()),
    'and becomes available the moment the customer switches to a return')

  // Back to exchange, and send one.
  await p.click('.kind:has(input[value="exchange"])')
  await p.waitForTimeout(150)
  await p.check(`#line-${mensLine}`)
  await p.selectOption(`[data-size="${mensLine}"]`, 'XL')
  await p.fill('#reason', 'المقاس صغير')
  await p.click('#send')
  await p.waitForSelector('#done:not([hidden])', { timeout: 8000 })
  const shown = (await p.locator('#ref').textContent())?.trim() ?? ''
  check(/^SPR[2-9A-HJ-NP-Z]{8}$/.test(shown), 'the reference is shown to the customer', shown)
  const stored = rows(`select kind, reason from return_requests where ref = '${shown}'`)[0]
  check(stored?.kind === 'exchange' && stored?.reason === 'المقاس صغير',
    'and the request the browser made is the one in the database',
    JSON.stringify(stored))

  // A refusal must be readable Arabic, never a JSON token.
  await p.click('#again')
  await p.fill('#track', TRACK)
  await p.fill('#phone', '99887766')
  await p.click('#find')
  await p.waitForSelector('#error:not([hidden])', { timeout: 8000 })
  const msg = (await p.locator('#error').textContent()) ?? ''
  check(/[؀-ۿ]/.test(msg) && !/_/.test(msg),
    'a refusal is shown in Arabic, not as an error token', msg)

  // --- and the link that makes the page reachable at all ------------------
  await p.goto(BASE + '/returns', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  const link = p.locator('#sporta-returns-request-link')
  check(await link.count() === 1, 'the policy page carries a link to the request page')
  check(await link.getAttribute('href') === '/returns/request', 'pointing at the right place')
  // It must NOT survive a navigation to another route — the SPA reuses <main>.
  await p.goto(BASE + '/terms', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  check(await p.locator('#sporta-returns-request-link').count() === 0,
    'and does not leak onto other pages')

  // The 404 from the wrong-phone lookup just above is deliberate — it is the
  // refusal being tested. Everything else must be silent.
  const unexpected = errors.filter((e) => !/404/.test(e))
  check(unexpected.length === 0, 'no unexpected console errors on any of it',
    unexpected.slice(0, 3).join(' | '))
  await b.close()
}

cleanup()
console.log(fails ? `\n${fails} failed` : '\nall ok — returns and exchanges, end to end')
process.exit(fails ? 1 : 0)
