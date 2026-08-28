/**
 * All three ways to pay, and the checkout that feeds them.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/payments-test.mjs
 *
 * tpay-test.mjs covers CBK T-Pay in depth. This is the other axis: the same
 * questions asked of KNET, T-Pay and cash side by side, plus the two things
 * that decide whether the shop can be robbed —
 *
 *   THE CALLBACKS. They are the only code that marks an order paid, and they
 *   are reachable by anyone. Both files have been hardened, and both carry a
 *   long comment about the day they were not: pay/callback.php's error branch
 *   flipped a real order to `failed` on one unauthenticated GET, and
 *   knet/callback.php used to mark an order PAID when it could not verify the
 *   amount. Neither fix has a test. A comment is not a guard.
 *
 *   THE PRICE. The browser sends a basket of slugs and sizes, never money.
 *   Every rig here places orders through the same happy path, so nothing has
 *   ever checked what happens when a client sends a price of its own.
 *
 * WHAT IT CANNOT CHECK, and does not pretend to: whether the bank accepts the
 * merchant credentials. That needs the real pay/config.php and a route to
 * pg.cbk.com. Those cases are reported as skips.
 */
import { execFileSync } from 'node:child_process'

const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
const API = `${SITE}/api`

// THE ORDER ROUTE IS THROTTLED AT 60 PER TEN MINUTES PER IP, and this rig
// places a dozen real orders. Run it three times in a row and it starts
// refusing itself with 429 — which reads as the checkout being broken and is
// the rig meeting its own defence. sandbox.sh clears these counters for the
// same reason; this clears them again so the run is not a hostage to the last.
try {
  execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', 'delete from rate_limit'],
    { stdio: 'ignore' })
} catch { /* not the sandbox database — carry on and let a 429 speak for itself */ }

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ' — ' + extra : ''}`)
}
const skip = (what) => console.log(`--   ${what}`)

const post = async (path, body) => {
  const r = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
// X-Forwarded-Proto, because the dropins and the callbacks all call
// knet_require_https() / its T-Pay twin and refuse plain HTTP outright. The
// sandbox has no TLS, so without this header nothing past line 10 of either
// callback ever runs — and this rig's first version asserted five things about
// forged callbacks that were all passing on a 403 before the logic they claimed
// to test. Two mutations to the amount guard changed nothing, which is how it
// was found. The header is what Hostinger's proxy sets in production, so this
// is the real path rather than a way round the check.
const get = async (url, https = true) => {
  const r = await fetch(url, {
    redirect: 'manual',
    headers: https ? { 'X-Forwarded-Proto': 'https' } : {},
  })
  return { status: r.status, text: await r.text().catch(() => '') }
}
const statusOf = async (track) =>
  (await (await fetch(`${API}/api.php?r=status&id=${encodeURIComponent(track)}`)).json().catch(() => null))

// A DIFFERENT SIZE PER ORDER. This rig places a dozen orders; pointing them all
// at one size sells it out halfway through, and the later ones then fail with
// out_of_stock and read as a broken payment link. That is a rig accusing the
// code of its own bookkeeping.
const stock = await (await fetch(`${API}/api.php?r=stock`)).json()
const lines = stock.filter((r) => r.stock > 0)
if (lines.length < 12) {
  console.error(`need twelve sizes in stock; the database has ${lines.length}`)
  process.exit(1)
}
let cursor = 0
const nextLine = () => lines[cursor++ % lines.length]

const newTrack = (tag) =>
  'PAY' + tag + Math.random().toString(36).slice(2, 9).toUpperCase()

const order = async (method, extra = {}, lang = 'ar') => {
  const track = newTrack(method.toUpperCase().slice(0, 2))
  const l = nextLine()
  const res = await post('api.php?r=order', {
    track_id: track,
    payment_method: method,
    lang,
    items: [{ slug: l.slug, size: l.size, qty: 1 }],
    customer: {
      name: 'Payments Rig', phone: '5' + String(Date.now()).slice(-7),
      email: 'rig@example.com', governorate: 'hawalli', area: 'Salmiya',
      block: '4', street: '12', building: '8',
    },
    ...extra,
  })
  return { track, ...res }
}

// ============================================================ the three methods
console.log('--- what each method hands back')

const made = {}
for (const [method, prefix, note] of [
  ['knet', '/knet/pay.php?', 'KNET goes to the KNET dropin'],
  ['tpay', '/pay/pay.php?', "T-Pay goes to CBK's, pinned to paytype=2"],
  ['cod', null, 'cash on delivery has no payment link at all'],
]) {
  const o = await order(method)
  made[method] = o
  check(o.status === 200 && o.body?.track_id === o.track,
    `a ${method} order is accepted (${o.status})`, JSON.stringify(o.body).slice(0, 110))
  if (prefix === null) {
    check(o.body?.pay_url === null, note, `got ${JSON.stringify(o.body?.pay_url)}`)
  } else {
    check(String(o.body?.pay_url).startsWith(prefix), note, String(o.body?.pay_url))
    // THE AMOUNT IS NEVER IN THE LINK. Both dropins look it up themselves, so
    // a link that leaks or is edited still cannot change what is charged.
    check(!/amount=|amt=/.test(String(o.body?.pay_url)),
      `and the ${method} link carries no amount for anyone to edit`,
      String(o.body?.pay_url))
  }
}
check(/[?&]paytype=2\b/.test(String(made.tpay.body?.pay_url)),
  'T-Pay is pinned to paytype=2 — the customer already chose, one screen ago')

// Every one of them starts PENDING. Nothing is paid because an order exists.
for (const m of ['knet', 'tpay', 'cod']) {
  const s = await statusOf(made[m].track)
  check(s?.payment_status === 'pending',
    `a fresh ${m} order is pending, not paid`, JSON.stringify(s))
}

// ================================================================ the dropins
console.log('\n--- what the dropins refuse')

// FIRST, THE HTTPS RULE ITSELF. A payment page reached over http:// is one
// whose amount and track id crossed the network in the clear, and every one of
// these four files refuses it before looking at anything else. Asserted here
// because the rest of this rig deliberately bypasses it with a header, and a
// bypass nobody re-checks is how the rule quietly disappears.
for (const path of ['/knet/pay.php', '/pay/pay.php', '/knet/callback.php', '/pay/callback.php']) {
  const r = await get(`${SITE}${path}?trackid=X`, false)
  check(r.status === 403, `${path} refuses plain HTTP (${r.status})`)
}

// Now over "https", where the dropins actually run.
for (const [name, path] of [['KNET', '/knet/pay.php'], ['T-Pay', '/pay/pay.php']]) {
  for (const [what, qs] of [
    ['an unknown order', '?trackid=PAYNOSUCHORDER1'],
    ['a malformed track id', '?trackid=../../etc/passwd'],
    ['no track id at all', ''],
  ]) {
    const r = await get(`${SITE}${path}${qs}`)
    check(r.status >= 400 && r.status < 500,
      `${name}: ${what} is refused (${r.status})`)
    check(!/pg\.cbk\.com|knet\.com\.kw/i.test(r.text),
      `${name}: ${what} is not handed on to the bank`)
  }
}

// ============================================================== the callbacks
//
// The only code in the shop that marks an order paid, reachable by anybody.
console.log('\n--- what a forged callback cannot do')

{
  // pay/callback.php's ERROR BRANCH. The comment in that file records the
  // measurement: one unauthenticated GET flipped a pending order to `failed`,
  // and `failed` is a state the shop acts on — cron-stock.php releases the
  // claimed stock, so a shopper part-way through paying loses their size.
  const t = made.tpay.track
  const r = await get(`${SITE}/pay/callback.php?ErrorCode=TIJ0020&PayTrackID=${t}`)
  const after = await statusOf(t)
  check(after?.payment_status === 'pending',
    `an unauthenticated error callback cannot mark an order failed (still ${after?.payment_status})`,
    `HTTP ${r.status}`)
}
{
  // The same file's SUCCESS path without an `encrp` blob: there is nothing to
  // read back from CBK, so there is nothing to verify, so nothing may move.
  const t = made.tpay.track
  await get(`${SITE}/pay/callback.php?PayTrackID=${t}&Result=CAPTURED&Amt=8.000`)
  const after = await statusOf(t)
  check(after?.payment_status !== 'paid',
    `a success claimed in the query string alone cannot mark an order paid (${after?.payment_status})`)
}
{
  // KNET'S CALLBACK, ENCRYPTED THE WAY THE BANK SENDS IT.
  //
  // The response arrives as `trandata`: an AES-128-CBC blob keyed on the
  // merchant's resource key. Without one, every forged callback bounces off
  // `missing_data` before a single line of the amount logic runs — which is
  // how this rig's first version came to assert three things about that logic
  // while proving nothing at all. Two mutations to the guard changed no
  // result. sandbox.sh now writes a sixteen-byte sandbox key so the real path
  // can be reached, and knet.php's own encrypt function builds the blob.
  const enc = (fields) => execFileSync('php', ['-r', `
    require "knet/knet.php";
    $c = knet_config();
    echo knet_encrypt(${JSON.stringify(fields)}, $c["resource_key"]);
  `], { cwd: 'sporta-site/public_html', encoding: 'utf8' }).trim()

  const t = made.knet.track
  const amount = Number((await statusOf(t))?.amount ?? 0)
  check(amount > 0, `the KNET order has an amount to verify against (${amount})`)

  // 1. CAPTURED, with the RIGHT amount, is the honest case — and it is the
  //    control for everything below. If this does not settle, the failures
  //    that follow prove nothing.
  const good = `paymentid=P1&result=CAPTURED&trackid=${t}&amt=${amount.toFixed(3)}&ref=R1`
  await get(`${SITE}/knet/callback.php?trandata=${encodeURIComponent(enc(good))}`)
  const settled = await statusOf(t)
  check(settled?.payment_status === 'paid',
    `a properly encrypted CAPTURED for the right amount DOES settle the order (${settled?.payment_status})`)

  // 2. THE WRONG AMOUNT. A fresh order, captured for a tenth of a dinar.
  const cheap = await order('knet')
  const owed = Number((await statusOf(cheap.track))?.amount ?? 0)
  const short = `paymentid=P2&result=CAPTURED&trackid=${cheap.track}&amt=0.100&ref=R2`
  await get(`${SITE}/knet/callback.php?trandata=${encodeURIComponent(enc(short))}`)
  const under = await statusOf(cheap.track)
  check(under?.payment_status === 'failed',
    `CAPTURED for 0.100 against an order of ${owed} is FAILED, not paid (${under?.payment_status})`)

  // 3. NO AMOUNT AT ALL. The guard fails closed: what cannot be verified is
  //    held for review rather than trusted. It used to be marked paid.
  const blind = await order('knet')
  const noAmt = `paymentid=P3&result=CAPTURED&trackid=${blind.track}&ref=R3`
  await get(`${SITE}/knet/callback.php?trandata=${encodeURIComponent(enc(noAmt))}`)
  const held = await statusOf(blind.track)
  // REVIEW, NOT FAILED, and the difference is operational rather than
  // cosmetic: cron-stock.php releases the claimed stock on `failed`, so a
  // capture the shop could not verify would hand the customer's size back to
  // the shelf while their money may well have left their account. `review` is
  // a human looking at it. Asserting merely "not paid" here let a mutation
  // that deleted the whole fail-closed branch pass, because the amount
  // comparison below happened to catch the same case and call it failed.
  check(held?.payment_status === 'review',
    `CAPTURED with no amount at all is held for REVIEW (${held?.payment_status})`)

  // 4. A BLOB SIGNED WITH THE WRONG KEY cannot be read, so nothing moves.
  const forged = await order('knet')
  const wrongKey = execFileSync('php', ['-r', `
    require "knet/knet.php";
    echo knet_encrypt("paymentid=P4&result=CAPTURED&trackid=${forged.track}&amt=999.000&ref=R4", "NOTTHEREALKEY123");
  `], { cwd: 'sporta-site/public_html', encoding: 'utf8' }).trim()
  await get(`${SITE}/knet/callback.php?trandata=${encodeURIComponent(wrongKey)}`)
  const nope = await statusOf(forged.track)
  check(nope?.payment_status !== 'paid',
    `a trandata encrypted with the wrong key cannot settle anything (${nope?.payment_status})`)
}
{
  // And a callback for an order that does not exist must not create one.
  const ghost = 'PAYGHOST' + Math.random().toString(36).slice(2, 8).toUpperCase()
  await get(`${SITE}/knet/callback.php?trackid=${ghost}&result=CAPTURED&amt=1.000`)
  const s = await statusOf(ghost)
  check(!s || s.error || !s.payment_status,
    'a callback for an order that does not exist does not conjure one',
    JSON.stringify(s))
}

// =============================================================== the checkout
console.log('\n--- what the checkout refuses')

const refusals = [
  ['an unknown payment method', { payment_method: 'card' }],
  ['a governorate that is not Kuwaiti', { customer_governorate: 'atlantis' }],
]
{
  const bad = await order('card')
  check(bad.status >= 400 && /payment/i.test(String(bad.body?.error)),
    `an unknown payment method is refused (${bad.status} ${bad.body?.error})`)
}
{
  const l = nextLine()
  const r = await post('api.php?r=order', {
    track_id: newTrack('GV'), payment_method: 'knet', lang: 'ar',
    items: [{ slug: l.slug, size: l.size, qty: 1 }],
    customer: { name: 'Payments Rig', phone: '55512345', email: 'rig@example.com',
      governorate: 'atlantis', area: 'Salmiya', block: '4', street: '12', building: '8' },
  })
  check(r.status >= 400, `a governorate that is not Kuwaiti is refused (${r.status} ${r.body?.error})`)
}
{
  const l = nextLine()
  const r = await post('api.php?r=order', {
    track_id: newTrack('PH'), payment_method: 'knet', lang: 'ar',
    items: [{ slug: l.slug, size: l.size, qty: 1 }],
    customer: { name: 'Payments Rig', phone: '12345', email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' },
  })
  check(r.status >= 400, `a phone that is not a Kuwaiti mobile is refused (${r.status} ${r.body?.error})`)
}
{
  const r = await post('api.php?r=order', {
    track_id: newTrack('EM'), payment_method: 'knet', lang: 'ar', items: [],
    customer: { name: 'Payments Rig', phone: '55512345', email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' },
  })
  check(r.status >= 400, `an empty basket is refused (${r.status} ${r.body?.error})`)
}
{
  const r = await post('api.php?r=order', {
    track_id: newTrack('SL'), payment_method: 'knet', lang: 'ar',
    items: [{ slug: 'no-such-product-at-all', size: 'L', qty: 1 }],
    customer: { name: 'Payments Rig', phone: '55512345', email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' },
  })
  check(r.status >= 400, `a product that does not exist is refused (${r.status} ${r.body?.error})`)
}

// ====================================================== the price is the shop's
console.log('\n--- the browser never sets the price')

{
  // Every other rig places orders through the happy path, so nothing has
  // checked this: send a price, and a discount, and see what the shop charges.
  const l = nextLine()
  const track = newTrack('PR')
  const r = await post('api.php?r=order', {
    track_id: track, payment_method: 'knet', lang: 'ar',
    items: [{ slug: l.slug, size: l.size, qty: 1, price: 0.001, unit_price: 0.001 }],
    amount: 0.001, total: 0.001, subtotal: 0.001, delivery_fee: 0,
    customer: { name: 'Payments Rig', phone: '55512345', email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' },
  })
  check(r.status === 200, `the order is accepted (${r.status})`, JSON.stringify(r.body).slice(0, 90))
  const charged = Number(r.body?.amount ?? 0)
  check(charged > 0.5,
    `and is priced by the SHOP, not by the browser — ${charged} KWD, not the 0.001 sent`,
    `charged ${charged}`)
}

// ================================================================ idempotency
console.log('\n--- the same order twice')

{
  const l = nextLine()
  const track = newTrack('ID')
  const body = {
    track_id: track, payment_method: 'knet', lang: 'ar',
    items: [{ slug: l.slug, size: l.size, qty: 1 }],
    customer: { name: 'Payments Rig', phone: '55512345', email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8' },
  }
  const first = await post('api.php?r=order', body)
  const again = await post('api.php?r=order', body)
  check(first.status === 200 && again.status === 200,
    `a repeated submit is accepted rather than erroring (${first.status}, ${again.status})`)
  check(first.body?.order_id === again.body?.order_id,
    'and updates the SAME order — this is what stops a double tap being charged twice',
    `${first.body?.order_id} vs ${again.body?.order_id}`)
}

skip('whether CBK accepts the merchant credentials — needs the real pay/config.php and a route to pg.cbk.com')
skip('a real KNET payment — the sandbox config holds SANDBOX_NOT_A_REAL_* by design')

console.log(fails ? `\n${fails} failed` : '\nall ok — three methods, both callbacks, and the checkout')
process.exit(fails ? 1 : 0)
