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
const res = await fetch(`${BASE}/api.php?r=order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_id: track,
    payment_method: 'cod',
    items: [{ slug: p.slug, size: stock.body.find((r) => r.slug === p.slug)?.size ?? 'ONE', qty: 1 }],
    customer: {
      name: 'Rig Tester', phone: '55512345', email: 'rig@example.com',
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
      name: 'Rig Tester', phone: '55512345', email: 'rig@example.com',
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

console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
