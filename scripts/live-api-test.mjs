/**
 * Drives the app's API client against the REAL storefront PHP.
 *
 *   cd sporta-site/public_html && php -S 127.0.0.1:4300 -t . &
 *   node scripts/live-api-test.mjs
 *
 * The other suites run against the bundled catalogue or a mock. Neither would
 * ever have caught what this does: the client was pointed at store.php, which
 * is the shared library and not a router, so every request returned 200 with an
 * empty body and the app fell back to its bundled catalogue — silently, and for
 * ever. A fallback that good hides the absence of a backend completely.
 */
const BASE = process.env.SITE_API ?? 'http://127.0.0.1:4300/api'

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

const get = async (path) => {
  const res = await fetch(`${BASE}/${path}`, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

// --- the routes the client actually calls -------------------------------
const products = await get('api.php?r=products')
check(products.status === 200 && Array.isArray(products.body) && products.body.length > 0,
  `api.php?r=products returns a catalogue (${products.body?.length ?? 0} products)`)

const stock = await get('api.php?r=stock')
check(stock.status === 200 && Array.isArray(stock.body), `api.php?r=stock returns rows (${stock.body?.length ?? 0})`)

// --- the shape the adapter depends on -----------------------------------
const p = products.body[0]
for (const field of ['slug', 'name_en', 'name_ar', 'price', 'category', 'on_sale', 'list_price'])
  check(field in p, `a product carries ${field}`)
check(typeof p.price === 'number' && p.price < 1000,
  `price is KWD, not fils (${p.price}) — the adapter multiplies by 1000`)

const s = stock.body[0]
for (const field of ['slug', 'size', 'stock']) check(field in s, `a stock row carries ${field}`)

// --- and the one that proves the old contract was wrong ------------------
const old = await get('store.php?r=catalogue')
check(old.body === null,
  'store.php?r=catalogue answers with nothing — it is the library, not the router')

// --- an order, end to end ------------------------------------------------
const track = 'RIG' + Date.now().toString(36).toUpperCase()
// A FRESH PHONE NUMBER EVERY RUN. The shop refuses a customer who already has
// STORE_COD_OPEN_MAX cash-on-delivery orders in flight — correctly: it is owed
// money and still holding goods. A rig that always books as 55512345 hits that
// ceiling on its third run and then reports the shop's own safeguard as a
// broken checkout. Nothing here should ever be settled by relaxing that rule.
const phone = '5' + String(Date.now()).slice(-7)
const res = await fetch(`${BASE}/api.php?r=order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_id: track,
    payment_method: 'cod',
    items: [{ slug: p.slug, size: stock.body.find((r) => r.slug === p.slug)?.size ?? 'ONE', qty: 1 }],
    customer: {
      name: 'Rig Tester', phone, email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8',
    },
  }),
})
const placed = await res.json().catch(() => null)
check(res.status === 200 && placed?.track_id === track, `an order is accepted (${res.status})`)
check(typeof placed?.amount === 'number', 'the shop prices the basket itself and returns the amount')

// Same track_id again: the shop must update the pending order, not make a
// second one. This is what stops a double tap on Pay being charged twice.
const again = await fetch(`${BASE}/api.php?r=order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_id: track, payment_method: 'cod',
    items: [{ slug: p.slug, size: stock.body.find((r) => r.slug === p.slug)?.size ?? 'ONE', qty: 1 }],
    customer: {
      name: 'Rig Tester', phone, email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8',
    },
  }),
})
const repeat = await again.json().catch(() => null)
check(again.status === 200 && repeat?.order_id === placed?.order_id,
  `retrying the same track_id reuses the order (${placed?.order_id} → ${repeat?.order_id})`)

// --- Apple Wallet --------------------------------------------------------
// Only if the certificate is installed. Without it the endpoint answers 503
// with a hint, which is correct behaviour and not a failure — so it is
// reported and skipped rather than failed.
const probe = await fetch(`${BASE}/wallet.php?r=coupon&code=SUMMER24`)
if (probe.status === 503) {
  console.log('--   wallet: no certificate installed, skipping (503 is the right answer)')
} else {
  const bytes = Buffer.from(await probe.arrayBuffer())
  check(probe.status === 200, `a coupon pass is issued (${probe.status})`)
  check(probe.headers.get('content-type') === 'application/vnd.apple.pkpass',
    `served as application/vnd.apple.pkpass (${probe.headers.get('content-type')})`)
  check(/attachment; filename=/.test(probe.headers.get('content-disposition') ?? ''),
    'sent as an attachment, which is what hands it to Wallet')
  check(/no-store/.test(probe.headers.get('cache-control') ?? ''),
    'not cacheable — a pass is personal')
  // PK\x03\x04: it really is a zip, not an error page with the wrong header.
  check(bytes[0] === 0x50 && bytes[1] === 0x4b, 'the body is a zip archive')

  const missing = await fetch(`${BASE}/wallet.php?r=coupon&code=NOSUCHCODE`)
  check(missing.status === 404, `an offer that does not exist is a 404 (${missing.status})`)

  const noPhone = await fetch(`${BASE}/wallet.php?r=loyalty`)
  check(noPhone.status === 400, `a loyalty pass without a phone is refused (${noPhone.status})`)

  const notMine = await fetch(`${BASE}/wallet.php?r=loyalty&phone=99999999&track=NOPE`)
  check(notMine.status === 403,
    `a first pass for a phone with no matching order is refused (${notMine.status})`)
}

// ------------------------------------------ the loyalty balance, and /card
//
// ?r=balance is OUTSIDE the certificate check above on purpose — the points
// are a fact about the orders table and only the .pkpass needs Apple. So this
// section runs whether or not the shop has its certificate, which is the whole
// reason the route exists: until that certificate arrives, this is the entire
// loyalty programme.
//
// It carries the customer's NAME and what they have spent, so it is gated
// exactly as issuing a pass is: a phone alone is not enough, because in Kuwait
// a phone number is on every receipt anyone has ever been handed.
{
  const paid = await fetch(`${BASE}/api.php?r=products`)   // keep the base honest
  check(paid.status === 200, 'the storefront is up for the balance checks')

  const noPhone = await fetch(`${BASE}/wallet.php?r=balance`)
  check(noPhone.status === 400, `a balance with no phone is refused (${noPhone.status})`)

  const bad = await fetch(`${BASE}/wallet.php?r=balance&phone=123`)
  check(bad.status === 400, `a balance with a nonsense phone is refused (${bad.status})`)

  // THE ONE THAT MATTERS: a real Kuwaiti number, no order reference. This must
  // not answer, or the route is a way to read any customer's name and spend
  // from their phone number alone.
  const noProof = await fetch(`${BASE}/wallet.php?r=balance&phone=96555512345`)
  check(noProof.status === 403,
    `a balance for a phone with no order reference is refused (${noProof.status})`)

  const wrongPair = await fetch(`${BASE}/wallet.php?r=balance&phone=96555512345&track=${track}`)
  check(wrongPair.status === 403,
    `an order reference belonging to someone else is refused (${wrongPair.status})`)

  // And the happy path, using the order this rig placed a moment ago. It is
  // unpaid, so the balance is zero — which is the right answer and proves the
  // sum is over PAID orders rather than over everything.
  const mine = await fetch(`${BASE}/wallet.php?r=balance&phone=${phone}&track=${track}`)
  const bal = await mine.json().catch(() => null)
  check(mine.status === 200, `the customer's own phone and order are accepted (${mine.status})`)
  check(bal && typeof bal.points === 'number' && bal.points === 0,
    `an unpaid order earns no points yet (${bal?.points})`)
  check(bal?.has_card === false, 'reading a balance does not issue a card')
  for (const field of ['name', 'tier', 'paid_orders', 'card_ready']) {
    check(bal !== null && field in bal, `the balance carries ${field}`)
  }
  // card_ready is what /card uses to decide between offering the download and
  // saying the card is not ready. It must be a boolean either way — undefined
  // would make the page offer a button that answers 503.
  check(typeof bal?.card_ready === 'boolean',
    `card_ready is a boolean the page can branch on (${JSON.stringify(bal?.card_ready)})`)
}

console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
