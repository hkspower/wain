/**
 * The REAL admin.php, driven the way the app drives it.
 *
 *   bash scripts/sandbox.sh          (starts MariaDB + PHP, seeds the admin)
 *   node scripts/admin-live-test.mjs
 *
 * This is the test whose absence let the panel ship speaking a protocol the
 * server had never heard of. The mock exists so the BROWSER flow is fast and
 * deterministic; this file exists so the mock can never again be the only
 * authority anything is measured against. Every request here carries exactly
 * what src/lib/admin.ts sends — the X-Sporta-Admin header, the session
 * cookie, the same route strings and bodies — against the same PHP that runs
 * in production.
 *
 * Node's fetch keeps no cookies, so the jar is three lines of this file —
 * which is also the proof that the cookie is the whole credential.
 */

const API = process.env.SITE_API ?? 'http://127.0.0.1:4300/api'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

let cookie = ''
const call = async (route, body, { noHeader = false, noCookie = false } = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      ...(noHeader ? {} : { 'X-Sporta-Admin': '1' }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(noCookie || !cookie ? {} : { Cookie: cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  // Over plain http the name is sporta_admin (the __Host- prefix is an
  // https-only promise — see store_session_start), and PHP re-issues it on
  // regenerate, so the LAST one wins.
  if (set) {
    const m = set.match(/(?:__Host-)?sporta_admin=([^;]+)/)
    if (m) cookie = `sporta_admin=${m[1]}`
  }
  let data = null
  try {
    data = JSON.parse(await res.text())
  } catch {}
  return { status: res.status, body: data }
}

// --- the gate, before anything is granted ---------------------------------
// The server asks the session FIRST: signed out, a missing header is
// indistinguishable from a missing session, and answering 400 there would
// tell an unauthenticated probe which of the two it got right.
const bare = await call('stats', undefined, { noHeader: true })
check(bare.status === 401, `signed out, even a headerless request is a 401 (${bare.status})`)

const out = await call('me')
check(out.status === 200 && out.body === null, `signed out, ?r=me answers null (${JSON.stringify(out.body)})`)

const locked = await call('stats')
check(locked.status === 401 && locked.body?.error === 'not_signed_in',
  `signed out, an admin route answers 401 not_signed_in (${locked.status})`)

const wrong = await call('login', { email: EMAIL, password: 'nope' })
check(wrong.status === 401, `a wrong password is refused (${wrong.status})`)

// --- sign in ---------------------------------------------------------------
const login = await call('login', { email: EMAIL, password: PASSWORD })
check(login.status === 200 && login.body?.email === EMAIL,
  `login answers the account (${login.body?.email})`)
check(!login.body?.need_code, 'no second factor is enrolled on the seeded account')
check(cookie !== '', 'and set the session cookie')

const me = await call('me')
check(me.body?.email === EMAIL, `?r=me now answers the account (${me.body?.email})`)

// Signed IN, the header check bites: the CSRF backstop is for requests a
// browser was tricked into sending WITH the cookie.
const csrf = await call('stats', undefined, { noHeader: true })
check(csrf.status === 400, `signed in without X-Sporta-Admin is a 400 (${csrf.status})`)

// --- the dashboard's two reads --------------------------------------------
const stats = await call('stats')
for (const k of ['paid_today', 'revenue_today', 'unfulfilled_count']) {
  check(stats.body != null && k in stats.body, `stats carries ${k}`)
}
const variants = await call('variants')
check(Array.isArray(variants.body) && variants.body.length > 0 && 'sku' in variants.body[0],
  `variants answers rows keyed by sku (${variants.body?.length})`)

// --- an order, moved along both axes ---------------------------------------
// Placed through the PUBLIC api, exactly as a customer's would be, so this
// test never depends on leftovers from another rig.
const track = 'SP' + Date.now().toString(36).toUpperCase() + 'ADM'
const inStock = variants.body.find((v) => v.stock > 0)
const placed = await fetch(`${API}/api.php?r=order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_id: track, payment_method: 'cod', lang: 'ar',
    items: [{ slug: inStock.slug, size: inStock.size, qty: 1 }],
    customer: {
      name: 'Live Admin Rig', phone: '5' + String(Date.now()).slice(-7),
      email: 'rig@example.com', governorate: 'hawalli', area: 'Salmiya',
      block: '4', street: '12', building: '8',
    },
  }),
}).then((r) => r.json())
check(!!placed.order_id, `a cash order is placed to move (#${placed.order_id} ${track})`)

const orders = await call('orders&limit=500')
const row = orders.body?.find?.((o) => o.id === placed.order_id)
check(!!row && row.payment_status === 'pending' && row.fulfilment_status === 'unfulfilled',
  `the order appears with both axes (${row?.payment_status}/${row?.fulfilment_status})`)

const items = await call(`items&order=${placed.order_id}`)
check(Array.isArray(items.body) && items.body[0]?.products?.slug === inStock.slug,
  `items answers the joined product shape (${items.body?.[0]?.products?.slug})`)

// The parcel's axis: the server's word is 'packed', which is what the app
// sends after translating its own 'packing'.
const packed = await call('fulfilment', { order_id: placed.order_id, status: 'packed' })
check(packed.status === 200, `fulfilment accepts 'packed' (${packed.status})`)
const badWord = await call('fulfilment', { order_id: placed.order_id, status: 'packing' })
check(badWord.status === 400, `and refuses the app's display word 'packing' raw (${badWord.status}) — the translation is load-bearing`)

// The money axis: cash is recorded by cod_paid, and the public status
// endpoint — the one the customer's order screen polls — agrees.
const paid = await call('cod_paid', { order_id: placed.order_id, paid: true })
check(paid.status === 200, `cod_paid records the cash (${paid.status})`)
const pub = await fetch(`${API}/api.php?r=status&id=${track}`).then((r) => r.json())
check(pub?.payment_status === 'paid', `the customer's own status endpoint agrees (${pub?.payment_status})`)

// Tidy: cancel the rig's order so it never shows as work in the owner's panel.
await call('fulfilment', { order_id: placed.order_id, status: 'cancelled' })

// --- stock, by sku ---------------------------------------------------------
const v = variants.body[0]
const bumped = await call('set_stock', { sku: v.sku, stock: v.stock + 1 })
check(bumped.status === 200 && bumped.body?.stock === v.stock + 1,
  `set_stock moves stock by sku (${v.sku}: ${v.stock} -> ${bumped.body?.stock})`)
await call('set_stock', { sku: v.sku, stock: v.stock }) // restore
const noSku = await call('set_stock', { sku: 'NO-SUCH-SKU', stock: 1 })
check(noSku.status === 400 && noSku.body?.error === 'sku_not_found',
  `an unknown sku is refused (${noSku.body?.error})`)

// --- a discount's whole life ----------------------------------------------
const save = await call('discount_save', {
  kind: 'code', code: 'RIGTEST10', label: 'Contract rig', type: 'percent',
  value: 10, min_order: 0, category: null, starts_at: null, ends_at: null,
  usage_limit: 5, active: true,
})
check(save.status === 200, `discount_save accepts the app's body (${save.status})`)
const list = await call('discounts')
const mine = list.body?.find?.((d) => d.code === 'RIGTEST10')
check(!!mine, 'the discount appears in the list')
const off = await call('discount_active', { id: mine?.id, active: false })
check(off.status === 200, `discount_active pauses it (${off.status})`)
const gone = await call('discount_delete', { id: mine?.id })
check(gone.status === 200, `discount_delete removes it — never redeemed, so removable (${gone.status})`)

// --- returns and exchanges ------------------------------------------------
//
// The order placed above is cash and was just cancelled, so it cannot carry a
// return. This makes its own: a paid, delivered order with one line, asks for
// an exchange through the PUBLIC route the customer uses, then moves it with
// the admin pair. Cleaned up at the end.
const rTrack = 'SPR' + Date.now().toString(36).toUpperCase() + 'LIV'
const rPhone = '55598765'
const seedReturn = async () => {
  const placedR = await fetch(`${API}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: rTrack, payment_method: 'cod', lang: 'en',
      customer: { name: 'Returns Live', phone: rPhone, email: 'rig@example.com',
                  governorate: 'hawalli', area: 'Salmiya',
                  block: '4', street: '12', building: '8' },
      items: [{ slug: inStock.slug, size: inStock.size, qty: 1 }],
    }),
  }).then((r) => r.json())
  return placedR
}
const placedR = await seedReturn()
if (!placedR?.order_id) {
  check(false, `could not place the order a return needs (${JSON.stringify(placedR).slice(0, 120)})`)
} else {
  // Paid and delivered, which is what a return requires — done through the
  // panel's own routes rather than by reaching into the database, so this
  // exercises them too.
  await call('cod_paid', { order_id: placedR.order_id, paid: true })
  await call('fulfilment', { order_id: placedR.order_id, status: 'delivered' })

  const look = await fetch(
    `${API}/api.php?r=return_items&ref=${rTrack}&phone=${rPhone}`).then((r) => r.json())
  check(Array.isArray(look?.items) && look.items.length === 1,
    `?r=return_items lists the order's line (${JSON.stringify(look).slice(0, 90)})`)

  const made = await fetch(`${API}/api.php?r=return_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: rTrack, phone: rPhone, kind: 'return', lang: 'en',
      reason: 'live rig', items: [{ id: look?.items?.[0]?.id, qty: 1 }],
    }),
  }).then((r) => r.json())
  check(!!made?.ref, `?r=return_request records it (${JSON.stringify(made).slice(0, 90)})`)

  const rlist = await call('returns&status=new')
  const mineR = rlist.body?.returns?.find?.((x) => x.ref === made?.ref)
  check(!!mineR, `?r=returns lists it under 'new' (${rlist.status})`)
  // The LINES come with the list — one request per screen, not one per row.
  check((mineR?.items?.length ?? 0) === 1, 'and carries its lines with it')
  check(typeof rlist.body?.counts?.new === 'number', 'with counts over everything, not the page')

  const badMove = await call('return_status', { id: mineR?.id, status: 'nonsense' })
  check(badMove.status === 422 && badMove.body?.error === 'bad_status',
    `a status the CHECK constraint would refuse is refused by name (${badMove.status})`)

  // A REJECTION WITHOUT A REASON IS REFUSED. The customer is told why, and
  // "no reason given" is not something the shop can send.
  const noWhy = await call('return_status', { id: mineR?.id, status: 'rejected' })
  check(noWhy.status === 422 && noWhy.body?.error === 'reason_required',
    `rejecting with no reason is refused (${noWhy.status} ${noWhy.body?.error})`)

  const ok = await call('return_status', { id: mineR?.id, status: 'approved' })
  check(ok.status === 200, `it can be approved (${ok.status})`)
  const back = await call('returns&status=approved')
  const moved = back.body?.returns?.find?.((x) => x.ref === made?.ref)
  check(!!moved && moved.decided_at,
    'the move sticks, and decided_at records when the customer was answered')

  // Cancelling the order cascades the request away with it.
  await call('fulfilment', { order_id: placedR.order_id, status: 'cancelled' })
}

// --- the printable orders sheet -------------------------------------------
//
// api/orders-print.php renders every order in a window as one document: name,
// telephone number and full delivery address, one order per printed sheet. It
// is the only page on this server that puts that much personal detail on a
// screen at once, so what guards it is worth asserting rather than assuming.
//
// IT GATES ON THE SESSION ALONE, not store_require_admin(), because it is
// opened by a real navigation — clicking a link or typing a URL — and a
// navigation cannot carry the X-Sporta-Admin header the JSON routes demand.
// That is a deliberate difference and exactly the kind that turns into an open
// door when someone "tidies up" the gates later.
{
  const url = `${API}/orders-print.php`

  // Signed OUT — a fresh request carrying no cookie at all.
  const out = await fetch(url, { redirect: 'manual' })
  check(out.status === 401,
    `orders-print.php refuses a stranger (${out.status})`)
  const outBody = await out.text().catch(() => '')
  // AND SAYS NOTHING WHILE REFUSING. A 401 that still rendered the sheet below
  // it would pass a status check and leak every address on the page.
  check(!/customer_|Address|<section class="order"/.test(outBody),
    'and prints no order data in the refusal',
    outBody.slice(0, 120))

  // Signed IN — the same cookie jar the rest of this file has been using.
  const inRes = await fetch(url, { headers: { Cookie: cookie }, redirect: 'manual' })
  const inBody = await inRes.text().catch(() => '')
  check(inRes.status === 200, `and answers a signed-in manager (${inRes.status})`)
  check(/Sporta/.test(inBody) && /Print \/ Save as PDF/.test(inBody),
    'with the printable sheet')
  // ONE SHEET PER ORDER. Without the page break the PDF is a scroll of
  // invoices cut across page boundaries, which cannot be handed to anyone.
  check(/page-break-after:\s*always/.test(inBody),
    'that starts each order on its own page')
  // NEVER CACHED, and the assertion is on `private` rather than `no-store`.
  //
  // PHP's session handler emits "no-store, no-cache, must-revalidate" by itself
  // the moment session_start() runs, so a check for no-store passes whether or
  // not this page sets a single header — measured by deleting the line and
  // watching the test stay green. `private` is the part the page adds, so it is
  // the part that proves the line is still there.
  check(/private/.test(inRes.headers.get('cache-control') ?? ''),
    'and is never cached, by its own header rather than by luck',
    inRes.headers.get('cache-control') ?? '(none)')
}

// --- the first-admin route, on a shop that already has one ----------------
//
// The happy path cannot be exercised here without emptying admin_users, which
// is not a thing a test may do to a working database. What CAN be checked is
// the half that matters on every shop after its first minute: that the route
// is inert, and that it says so without leaking anything.
{
  const taken = await call('register', { email: 'intruder@example.com', password: 'a good long passphrase' })
  check(taken.status === 409 && taken.body?.error === 'already_set_up',
    `register refuses once an administrator exists (${taken.status} ${taken.body?.error})`)

  const noHdr = await call('register', { email: 'a@b.com', password: 'a good long passphrase' }, { noHeader: true })
  check(noHdr.status === 400, `register still demands X-Sporta-Admin (${noHdr.status})`)

  // Validation runs BEFORE the count, so these answer on a live shop too — and
  // that ordering is deliberate: a caller should learn their input is wrong
  // whether or not the route would have gone on to refuse them anyway.
  const badMail = await call('register', { email: 'not-an-email', password: 'a good long passphrase' })
  check(badMail.status === 400 && badMail.body?.error === 'bad_email',
    `a malformed address is refused (${badMail.body?.error})`)

  const shortPw = await call('register', { email: 'boss@sporta.com.kw', password: 'elevenchar' })
  check(shortPw.status === 400 && shortPw.body?.error === 'password_too_short',
    `eleven characters is refused, matching the twelve the password change asks (${shortPw.body?.error})`)
}

// --- out ------------------------------------------------------------------
await call('logout', {})
const after = await call('me')
check(after.body === null, 'after logout, ?r=me answers null again')

console.log(fails ? `\n${fails} failed` : '\nall ok — the real admin.php, end to end')
process.exit(fails ? 1 : 0)
