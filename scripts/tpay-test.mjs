/**
 * CBK T-Pay, end to end as far as this side of the bank goes.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/tpay-test.mjs
 *
 * What it can check: that the shop hands the app a payment link, that the link
 * points at the right dropin with the right mode, that the dropin refuses
 * everything it should refuse, and that the app never claims a payment it has
 * not been told about.
 *
 * What it CANNOT check, and nothing here pretends otherwise: whether CBK
 * accepts the merchant credentials. That needs pay/config.php with real values
 * and a route to pg.cbk.com, neither of which exists in a sandbox. The dropin
 * answers those requests with a clear error and this rig reports it as a skip.
 */
import { chromium } from 'playwright'

const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
const API = `${SITE}/api`

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const skip = (what) => console.log(`--   ${what}`)

// A DIFFERENT LINE PER ORDER. This rig places five orders, and pointing them
// all at one size sells it out halfway through — the later ones then fail with
// out_of_stock and read as a broken payment link, which is how a rig ends up
// accusing the code of its own bookkeeping.
const stock = await (await fetch(`${API}/api.php?r=stock`)).json()
const lines = stock.filter((r) => r.stock > 0)
if (lines.length < 5) {
  console.error(`need five sizes in stock to run this; the database has ${lines.length}`)
  process.exit(1)
}
let cursor = 0
const nextLine = () => lines[cursor++ % lines.length]

// A fresh phone per run: the shop caps how many cash orders one customer may
// have open, and a rig that always books as the same person eventually trips
// that and reports the safeguard as a broken checkout.
const phone = () => '5' + String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7)

const place = async (method, track, lang = 'ar', line = nextLine()) => {
  const res = await fetch(`${API}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track,
      payment_method: method,
      lang,
      items: [{ slug: line.slug, size: line.size, qty: 1 }],
      customer: {
        name: 'Rig Tester', phone: phone(), email: 'rig@example.com',
        governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8',
      },
    }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const id = () => 'TP' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100)

// --- the shop hands over a payment link ----------------------------------
const tpayTrack = id()
const tpayLine = nextLine()
const tpay = await place('tpay', tpayTrack, 'ar', tpayLine)
if (tpay.status === 429) {
  // Not a defect, and worth saying out loud rather than reporting as eleven
  // unrelated failures: the shop throttles order posting per IP and this rig
  // places several in a row. `bash scripts/sandbox.sh` clears the counter.
  console.error('the shop is throttling this machine (429). Run: bash scripts/sandbox.sh')
  process.exit(1)
}
check(tpay.status === 200 && tpay.body?.track_id === tpayTrack, `a T-Pay order is accepted (${tpay.status})`)
check(typeof tpay.body?.pay_url === 'string' && tpay.body.pay_url !== '',
  `the order comes back with a payment link (${tpay.body?.pay_url ?? 'none'})`)
check(String(tpay.body?.pay_url).startsWith('/pay/pay.php?'),
  'T-Pay goes to the CBK dropin, not to the KNET one')
check(/[?&]paytype=2\b/.test(String(tpay.body?.pay_url)),
  'and is pinned to T-Pay rather than left on the bank\'s chooser')
check(/[?&]lang=ar\b/.test(String(tpay.body?.pay_url)),
  'the bank page opens in the language the customer was reading')
check(!/amount=/.test(String(tpay.body?.pay_url)),
  'the link carries NO amount — the price is the shop\'s to know, not the link\'s')

const knet = await place('knet', id())
check(String(knet.body?.pay_url).startsWith('/knet/pay.php?'), 'KNET still goes to the KNET dropin')

const cod = await place('cod', id())
check(cod.body?.pay_url === null, 'cash on delivery has no payment link at all')

const en = await place('tpay', id(), 'en')
check(/[?&]lang=en\b/.test(String(en.body?.pay_url)), 'an English checkout opens an English bank page')

// A retry of the same order must be sent to the bank it was created against,
// whatever the retry claims to be — otherwise a re-post as `cod` would answer
// with no link and strand a card order that is still owed money.
const again = await fetch(`${API}/api.php?r=order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_id: tpayTrack, payment_method: 'cod',
    items: [{ slug: tpayLine.slug, size: tpayLine.size, qty: 1 }],
    customer: {
      name: 'Rig Tester', phone: phone(), email: 'rig@example.com',
      governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '8',
    },
  }),
})
const retry = await again.json().catch(() => null)
check(retry?.payment_method === 'tpay' && String(retry?.pay_url).includes('paytype=2'),
  'a retry keeps the order\'s own method and its own bank page')

// --- the dropin's own refusals -------------------------------------------
// THE DROPIN REFUSES PLAIN HTTP, and that refusal comes before everything
// else it does — so a rig that speaks http to it measures nothing but the
// refusal. This sandbox has no TLS, so the requests carry the header a proxy
// would set, which is exactly how the live site reaches it behind Hostinger's
// front end. The refusal itself is asserted first, on a bare request.
const bare = await fetch(`${SITE}/pay/pay.php?trackid=${tpayTrack}`, { redirect: 'manual' })
check(bare.status === 403, `the dropin refuses plain HTTP outright (${bare.status})`)

const dropin = async (qs) => {
  const res = await fetch(`${SITE}/pay/pay.php?${qs}`, {
    redirect: 'manual',
    headers: { 'X-Forwarded-Proto': 'https' },
  })
  return { status: res.status, text: (await res.text()).slice(0, 200) }
}

const unknown = await dropin('trackid=NOSUCHORDER123')
check(unknown.status === 404, `an unknown order is refused (${unknown.status})`)

// The one that matters most: a price named in the URL must not be the price
// charged. The dropin looks the amount up and ignores what it was handed.
const injected = await dropin(`trackid=${tpayTrack}&amount=0.100`)
check(injected.status !== 404,
  `a real order still reaches the dropin (${injected.status})`)
check(!injected.text.includes('0.100'),
  'an amount in the URL is not the amount that reaches the bank')

const bad = await dropin('trackid=../../etc/passwd')
check(bad.status === 400, `a malformed track id is refused (${bad.status})`)

// Whether the bank itself answers depends on credentials this sandbox does
// not have. Reported, not failed.
if (injected.status >= 500 || /token|credential|CBK/i.test(injected.text)) {
  skip(`CBK not reachable from here — the dropin got as far as it can (${injected.status})`)
}

// --- the app does not claim a payment it was not told about --------------
const status = await (await fetch(`${API}/api.php?r=status&id=${tpayTrack}`)).json()
check(status?.payment_status === 'pending',
  `an unpaid order reads as pending, not as paid (${status?.payment_status})`)

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
// The exported app points at the production shop, which this sandbox cannot
// reach. Redirected at the network layer rather than rebuilt, so what is under
// test is the bundle that ships. See scripts/page-scan.mjs.
await ctx.route('https://www.sporta.com.kw/**', async (route) => {
  const req = route.request()
  const to = req.url().replace('https://www.sporta.com.kw', SITE)
  try {
    const res = await fetch(to, {
      method: req.method(),
      headers: req.headers(),
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData(),
    })
    await route.fulfill({
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      body: Buffer.from(await res.arrayBuffer()),
    })
  } catch {
    await route.abort()
  }
})
const p = await ctx.newPage()
await p.goto(
  `${process.env.APP_BASE ?? 'http://127.0.0.1:4173'}/order/${tpayTrack}?pay=tpay`,
  { waitUntil: 'networkidle' },
)
await p.waitForTimeout(13000)
const shown = (await p.locator('body').innerText()).trim()
check(!/تم استلام الدفعة|Payment received/.test(shown),
  'the order screen does not say the payment arrived while it is still pending')
check(/لم يصلنا تأكيد الدفع|No payment confirmation/.test(shown),
  'it says so plainly instead')
check(shown.includes(tpayTrack), 'and the order number is still there to quote')
await b.close()

console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
