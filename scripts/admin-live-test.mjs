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

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const API = process.env.SITE_API ?? 'http://127.0.0.1:4300/api'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

// Same construction sandbox.sh seeds the admin with — password_hash() run by
// PHP itself, so the hash this rig writes is one store_login() will actually
// verify, rather than a second implementation of "how a password becomes a
// hash" that could drift from the real one.
const hashPassword = async (plain) =>
  execFileSync('php', ['-r', `echo password_hash(${JSON.stringify(plain)}, PASSWORD_DEFAULT);`], {
    encoding: 'utf8',
  }).trim()

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

// --- a product's whole life, and its size ladder ---------------------------
// The Products screen (src/app/backends/products.tsx) is the first thing on
// the app side to call product_save, product_active, variant_save and
// variant_delete — none of them had ever been driven from here, only from
// the website's own prebuilt panel. A slug unlikely to collide with the seed
// catalogue, cleaned up in every branch this rig can exit through.
const PSLUG = 'rig-test-garment-' + Date.now()
const created = await call('product_save', {
  slug: PSLUG, name_en: 'Rig test garment', name_ar: 'قطعة اختبار',
  price: 12.5, active: true,
})
check(created.status === 200 && created.body?.slug === PSLUG,
  `product_save creates a product (${created.body?.slug})`)
const pid = created.body?.id

const renamed = await call('product_save', {
  id: pid, slug: PSLUG, name_en: 'Rig test garment (edited)', name_ar: 'قطعة اختبار',
  price: 15, sale_price: 12, active: true,
})
check(renamed.status === 200 && renamed.body?.name_en === 'Rig test garment (edited)'
  && Number(renamed.body?.sale_price) === 12,
  `product_save edits the same row by id (${renamed.body?.name_en}, sale ${renamed.body?.sale_price})`)

const hidden = await call('product_active', { id: pid, active: false })
// The raw DB value, not a JSON boolean — the same shape brand_active answers
// with, checked with Number() rather than === false for the same reason.
check(hidden.status === 200 && Number(hidden.body?.active) === 0,
  `product_active hides it (${hidden.body?.active})`)
await call('product_active', { id: pid, active: true })

const badSize = await call('variant_save', { slug: PSLUG, size: 'NOTASIZE', stock: 1 })
check(badSize.status === 400 && badSize.body?.error === 'invalid_size',
  `variant_save refuses a size outside the shop's own list (${badSize.body?.error})`)

const madeVariant = await call('variant_save', { slug: PSLUG, size: 'M', stock: 3, cost_aed: 7.5 })
check(madeVariant.status === 200 && madeVariant.body?.stock === 3,
  `variant_save creates a size (${madeVariant.body?.sku}: stock ${madeVariant.body?.stock})`)
const sku = madeVariant.body?.sku

const editedVariant = await call('variant_save', { slug: PSLUG, size: 'M', stock: 0 })
check(editedVariant.status === 200 && editedVariant.body?.sku === sku && editedVariant.body?.stock === 0,
  `re-saving the same size EDITS it rather than making a second row (stock -> ${editedVariant.body?.stock})`)

// Refused with stock on it, accepted once it is empty — proved in that
// order, since the second call alone cannot show the guard exists.
const withStock = await call('variant_save', { slug: PSLUG, size: 'M', stock: 4 })
const blockedDelete = await call('variant_delete', { sku })
check(blockedDelete.status === 400 && blockedDelete.body?.error === 'variant_has_stock',
  `variant_delete refuses a size that still holds stock (${blockedDelete.body?.error})`)
await call('variant_save', { slug: PSLUG, size: 'M', stock: 0 })
const cleanDelete = await call('variant_delete', { sku })
check(cleanDelete.status === 200 && cleanDelete.body?.deleted === sku,
  `and removes it once stock is at zero (${cleanDelete.body?.deleted})`)
void withStock

const productsAll = await call('products_all')
const stillThere = (Array.isArray(productsAll.body) ? productsAll.body : productsAll.body?.products ?? [])
  .find((p) => p.slug === PSLUG)
check(!!stillThere, 'products_all lists the rig product the editor would show')

// Tidy: the rig's own product is not the shop's, and it is not an order —
// nothing references it, so this is a real delete, not the active=0 the app
// itself uses for everything a customer could have bought.
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e',
  `delete from products where slug='${PSLUG}'`])

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

// --- the footer editor -----------------------------------------------------
//
// The point of testing this against the real server is that a saved string
// reaches the PUBLIC route the storefront reads. The panel writes through
// admin.php and assets/footer.js reads api.php -- two different files, and a
// settings row that only one of them agrees on is a form that lies.
{
  // ARABIC IS HALF THE SHOP, so the round-trip is tested in Arabic. A browser
  // check written earlier appeared to show the Arabic swap failing; the swap
  // was fine and the TEST was writing its row through the mariadb CLI without a
  // charset, so the page rendered mojibake. Asserting the real path -- panel
  // POST, PDO, json_encode, public GET -- is the only version of this check
  // that says anything about the shop.
  const AR = 'نصّ تجريبي للتذييل — سبورتا'
  const save = await call('settings_save', {
    name: 'footer',
    value: { tagline_ar: AR, tagline_en: 'Test strapline', rights_en: 'All rights reserved.' },
  })
  check(save.status === 200, `the footer saves (${save.status})`)

  const pub = await fetch(`${API.replace(/\/api$/, '')}/api/api.php?r=footer`, {
    headers: { Accept: 'application/json' },
  })
  const body = await pub.json()
  check(pub.status === 200, `?r=footer is public and answers (${pub.status})`)
  check(body?.tagline_en === 'Test strapline',
    `and carries what the panel wrote (${body?.tagline_en ?? 'nothing'})`)
  check(body?.tagline_ar === AR,
    'and Arabic survives the round trip byte for byte')

  // A field not sent is stored empty rather than left at its old value: the
  // panel always sends all ten, so "absent" can only mean cleared.
  check(body?.club_title_ar === '', 'a field the panel did not send is empty, not stale')

  // The cap is the server's, not the panel's.
  const long = await call('settings_save', {
    name: 'footer', value: { club_title_en: 'x'.repeat(200) },
  })
  check(long.status === 200, 'an over-long field saves rather than failing the whole edit')
  const after = await (await fetch(`${API.replace(/\/api$/, '')}/api/api.php?r=footer`,
    { headers: { Accept: 'application/json' } })).json()
  check((after?.club_title_en ?? '').length === 80,
    `and is cut to the server's cap (${(after?.club_title_en ?? '').length} chars)`)

  // Put it back, so the sandbox is not left with test prose in its footer.
  await call('settings_save', { name: 'footer', value: {} })
  const clean = await (await fetch(`${API.replace(/\/api$/, '')}/api/api.php?r=footer`,
    { headers: { Accept: 'application/json' } })).json()
  check((clean?.tagline_en ?? '') === '', 'and clearing it restores the built-in text')
}

// --- the KNET Tranportal ID -----------------------------------------------
//
// THE POINT OF TESTING THIS AGAINST THE REAL SERVER is that a saved ID reaches
// the payment path. A route that stores a number nobody reads is a form that
// lies to the owner, and the contract test cannot tell the difference — it
// proves the three files agree on the NAME, not that the value does anything.
{
  const start = await call('knet')
  check(start.status === 200 && typeof start.body?.tranportal_id === 'string',
    `?r=knet reports the saved ID and its source (${start.body?.source})`)

  // THE CBK GATEWAY'S OWN STATUS, a different file from the Tranportal ID
  // above. The sandbox's pay/config.php ships SANDBOX_NOT_A_REAL_* for all
  // three credentials — real placeholders, not a fixture built to look
  // configured — so a correct implementation must read `ready: false` here,
  // and one that only checks "is the key present" (every one of them is)
  // would wrongly read `ready: true`.
  const pay = start.body?.pay
  check(pay !== null && pay !== undefined, 'and reports the payment gateway\'s own status')
  check(pay?.ready === false, 'the sandbox\'s placeholder credentials are NOT reported as ready')
  check(pay?.client_id_set === false && pay?.client_secret_set === false && pay?.encrp_key_set === false,
    'and each placeholder is named individually, not just a flat "not ready"')
  check(pay?.env === 'test', `and the environment is reported (${pay?.env})`)

  // MUTATION, THE OTHER DIRECTION: a checker that always answers false would
  // pass every assertion above. Swap in real-looking credentials, ask again,
  // restore the file in a finally so a failed assertion cannot leave the
  // sandbox's payment config mutated for the next run.
  const payConfigPath = 'sporta-site/public_html/pay/config.php'
  const payConfigSrc = readFileSync(payConfigPath, 'utf8')
  try {
    const mutated = payConfigSrc
      .replace(/'client_id'\s*=>\s*'[^']*'/, "'client_id' => 'REAL_LOOKING_CLIENT_ID'")
      .replace(/'client_secret'\s*=>\s*'[^']*'/, "'client_secret' => 'REAL_LOOKING_SECRET'")
      .replace(/'encrp_key'\s*=>\s*'[^']*'/, "'encrp_key' => 'REAL_LOOKING_KEY'")
    if (mutated === payConfigSrc) throw new Error('mutation matched nothing — the regex is stale')
    writeFileSync(payConfigPath, mutated)
    const afterMutation = await call('knet')
    check(afterMutation.body?.pay?.ready === true,
      'and flips to ready once all three credentials look real')
  } finally {
    writeFileSync(payConfigPath, payConfigSrc)
  }
  const restored = await call('knet')
  check(restored.body?.pay?.ready === false, 'restoring the sandbox file restores ready: false')

  const bad = await call('settings_save', { name: 'knet', value: { tranportal_id: 'has space' } })
  check(bad.status >= 400 && bad.body?.error === 'invalid_tranportal_id',
    `a malformed ID is refused (${bad.body?.error})`)

  const ph = await call('settings_save', { name: 'knet', value: { tranportal_id: 'CHANGEME' } })
  check(ph.status >= 400 && ph.body?.error === 'placeholder_tranportal_id',
    `the shipped placeholder is refused (${ph.body?.error})`)

  const good = await call('settings_save', { name: 'knet', value: { tranportal_id: '626101' } })
  check(good.status === 200, 'a real-looking ID saves (200)')

  const read = await call('knet')
  check(read.body?.tranportal_id === '626101' && read.body?.source === 'database',
    "and reads back from the database, which is where the gateway now looks")

  // THE HALF THAT MATTERS: knet_config() must return the SAVED id, not the
  // file's. Asked of the gateway's own loader rather than of the admin route
  // that wrote it — those are different files and only one of them takes money.
  const seen = execFileSync('php', ['-r',
    "require 'sporta-site/public_html/knet/knet.php'; $c = knet_config(); echo $c['tranportal_id'] ?? '';"
  ], { encoding: 'utf8', cwd: process.env.REPO ?? '.' }).trim()
  check(seen === '626101', `knet_config() hands the saved ID to the gateway (${seen || 'nothing'})`)

  // AND THE OTHER RETURN PATHS, STATICALLY, because the check above can only
  // exercise the one this sandbox happens to take. Mutation-tested: unwrapping
  // the LAST return in knet_config() turns that check red, and unwrapping the
  // FIRST one — the path a shop takes when knet/config.php names its own
  // database, which is the commonest real configuration — left it green. A
  // check that covers one branch of three is not covering the feature.
  //
  // So this reads the function and insists every exit from it goes through the
  // override. Cheap, and it fails on the branch no rig here can reach.
  const src = readFileSync('sporta-site/public_html/knet/knet.php', 'utf8')
  const fn = src.slice(src.indexOf('function knet_config('),
                       src.indexOf('function knet_apply_saved_credentials('))
  const bare = (fn.match(/return \$cfg;/g) ?? []).length
  check(bare === 0 && /knet_apply_saved_credentials\(\$cfg\)/.test(fn),
    `every return in knet_config() applies the saved credentials (${bare} bare returns left)`)

  const cleared = await call('settings_save', { name: 'knet', value: { tranportal_id: '' } })
  check(cleared.status === 200, 'clearing it is allowed — the way back to the file')
  const back = await call('knet')
  check(back.body?.source === 'file', 'and the gateway falls back to knet/config.php')

  // --- the password and the resource key, editable since 2026-09-18 --------
  //
  // THREE THINGS TO PROVE, mirroring the ID's own three above: a bad value is
  // refused, a good one is never read back (only a boolean), and knet_config()
  // — the gateway's own loader, not the admin route — actually sees it. The
  // third is the one that matters; the first two are what stop a bad save
  // reaching the second.
  const badKeyLen = await call('settings_save', { name: 'knet', value: { resource_key: 'tooshort' } })
  check(badKeyLen.status >= 400 && badKeyLen.body?.error === 'resource_key_wrong_length',
    `a resource key of the wrong length is refused (${badKeyLen.body?.error})`)

  const phKey = await call('settings_save', { name: 'knet', value: { resource_key: 'YOUR_TERMINAL_RESOURCE_KEY' } })
  check(phKey.status >= 400 && phKey.body?.error === 'placeholder_resource_key',
    `the file's own placeholder key is refused (${phKey.body?.error})`)

  const phPw = await call('settings_save', { name: 'knet', value: { tranportal_password: 'YOUR_TRANPORTAL_PASSWORD' } })
  check(phPw.status >= 400 && phPw.body?.error === 'placeholder_tranportal_password',
    `the file's own placeholder password is refused (${phPw.body?.error})`)

  const savedSecrets = await call('settings_save', { name: 'knet', value: {
    tranportal_password: 'REAL_LOOKING_PASSWORD', resource_key: 'REAL_LOOKING_16B',
  } })
  check(savedSecrets.status === 200, 'a real-looking password and key save together (200)')

  const readSecrets = await call('knet')
  check(readSecrets.body?.tranportal_password_set === true && readSecrets.body?.resource_key_set === true,
    'and the route reports both as SET')
  check(readSecrets.body?.tranportal_password === undefined && readSecrets.body?.resource_key === undefined,
    'NEVER THE VALUES THEMSELVES — the route answers with booleans only')

  // ONE FIELD AT A TIME MUST NOT DISTURB THE OTHER. Saving the ID alone, with
  // neither secret in the request body, is the ordinary shape of every save
  // the panel makes when only the ID box changed — and store_setting_save
  // OVERWRITES THE WHOLE ROW, so a save built from `$v` alone rather than
  // merged over the current row would silently wipe both secrets the moment
  // anyone touched the ID.
  const idOnly = await call('settings_save', { name: 'knet', value: { tranportal_id: '626101' } })
  check(idOnly.status === 200, 'the ID alone can be resaved (200)')
  const stillSet = await call('knet')
  check(stillSet.body?.tranportal_password_set === true && stillSet.body?.resource_key_set === true,
    'and both secrets survive an ID-only save, unmentioned in that request')

  // THE HALF THAT MATTERS, same argument as the ID above: the gateway's own
  // loader, not the admin route, must see the saved values.
  const seenSecrets = execFileSync('php', ['-r',
    "require 'sporta-site/public_html/knet/knet.php'; $c = knet_config(); " +
    "echo ($c['tranportal_password'] ?? '') . '|' . ($c['resource_key'] ?? '');"
  ], { encoding: 'utf8', cwd: process.env.REPO ?? '.' }).trim()
  check(seenSecrets === 'REAL_LOOKING_PASSWORD|REAL_LOOKING_16B',
    `knet_config() hands both saved secrets to the gateway (${seenSecrets})`)

  const clearedPw = await call('settings_save', { name: 'knet', value: { tranportal_password: '' } })
  check(clearedPw.status === 200, 'the password clears on its own (200)')
  const afterClearPw = await call('knet')
  check(afterClearPw.body?.tranportal_password_set === false && afterClearPw.body?.resource_key_set === true,
    'clearing the password leaves the resource key untouched')

  const clearedKey = await call('settings_save', { name: 'knet', value: { resource_key: '' } })
  check(clearedKey.status === 200, 'and the resource key clears the same way (200)')
  const afterClearKey = await call('knet')
  check(afterClearKey.body?.resource_key_set === false, 'both secrets are back on the file')

  const cleared2 = await call('settings_save', { name: 'knet', value: { tranportal_id: '' } })
  check(cleared2.status === 200, 'and the ID is cleared too, for the sandbox left behind')
}

// --- must_change_password: the flag reset-admin-password.php sets ---------
//
// Set directly in the database rather than through a route, because nothing
// in admin.php sets it — reset-admin-password.php does, over cron, on the
// live server, which this rig cannot reach. The database write is the
// closest honest stand-in for what that script does.
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e',
  `update admin_users set must_change_password = 1 where email='${EMAIL}'`])

const flagged = await call('me')
check(flagged.body?.must_change_password === true,
  `me() reports must_change_password once the row is flagged (${flagged.body?.must_change_password})`)

const gated = await call('stats')
check(gated.status === 428 && gated.body?.error === 'must_change_password',
  `an ordinary admin route 428s while the flag is set (${gated.status} ${gated.body?.error})`)

// The two routes that must stay reachable — account (read) and account_update
// (the fix) — same in_array() admin.php gates on.
const accountRead = await call('account')
check(accountRead.status === 200 && accountRead.body?.email === EMAIL,
  `?r=account is let through despite the flag (${accountRead.status})`)

const wrongCurrent = await call('account_update', {
  password: 'not-the-real-one', new_password: 'a-brand-new-password-12', new_password2: 'a-brand-new-password-12', code: '',
})
check(wrongCurrent.status === 401 && wrongCurrent.body?.error === 'bad_password',
  `account_update still checks the CURRENT password even while flagged (${wrongCurrent.body?.error})`)

const tooShort = await call('account_update', {
  password: PASSWORD, new_password: 'short', new_password2: 'short', code: '',
})
check(tooShort.body?.error === 'password_too_short',
  `and enforces the same twelve-character floor as everywhere else (${tooShort.body?.error})`)

const NEW_PASSWORD = 'a-brand-new-password-12'
const changed = await call('account_update', {
  password: PASSWORD, new_password: NEW_PASSWORD, new_password2: NEW_PASSWORD, code: '',
})
check(changed.status === 200 && changed.body?.signed_out === true,
  `a real new password is accepted and ends the session (${changed.status})`)

const afterChange = await call('me')
check(afterChange.body === null, 'and the session really is gone — ?r=me answers null')

const reLogin = await call('login', { email: EMAIL, password: NEW_PASSWORD })
check(reLogin.status === 200 && reLogin.body?.email === EMAIL,
  `signing back in with the NEW password works (${reLogin.status})`)

const cleared = await call('me')
check(cleared.body?.must_change_password === false,
  `must_change_password cleared itself on the password change (${cleared.body?.must_change_password})`)

const ungated = await call('stats')
check(ungated.status === 200, `and an ordinary route works again, unforced (${ungated.status})`)

// Left as the new password would strand every OTHER test run against this
// same sandbox database — put it back so the file is idempotent.
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e',
  `update admin_users set password_hash='${await hashPassword(PASSWORD)}' where email='${EMAIL}'`])

// --- the audit log: one hook, not fifty ------------------------------------
//
// store_admin_audit_log() is never called directly by any route — the
// coverage here is of the register_shutdown_function() hook admin.php
// registers once, right after the gate, which is the whole point: this
// proves an ORDINARY save route this file has never named gets logged
// without admin.php having been told to log it, and that a FAILED one and
// an UNKNOWN route both correctly log nothing.
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', 'delete from admin_audit_log'])

const variantsList = await call("variants")
const sampleSku = variantsList.body?.[0]?.sku
check(!!sampleSku, `a real sku exists to exercise the hook with (${sampleSku})`)

const badSave = await call('set_stock', { sku: 'NOT-A-REAL-SKU', stock: 5 })
check(badSave.status !== 200, `a failing save is refused (${badSave.status})`)

const goodSave = await call('set_stock', { sku: sampleSku, stock: 13 })
check(goodSave.status === 200, `and a real one succeeds (${goodSave.status})`)

const unknown = await call('this_route_does_not_exist', { x: 1 })
check(unknown.status === 404, `an unknown route 404s rather than matching nothing silently (${unknown.status})`)

const secretSave = await call('settings_save', {
  name: 'knet', value: { tranportal_password: 'SUPER-SECRET-BANK-PASSWORD' },
})
check(secretSave.status === 200, `a save carrying a secret field succeeds (${secretSave.status})`)

const log = await call('audit_log')
const routes = (log.body?.rows ?? []).map((r) => r.route)
check(routes.includes('set_stock'), `the successful save is logged (${routes.join(',')})`)
check(!routes.includes('this_route_does_not_exist'),
  'the unknown route is NOT logged — nothing ran, so nothing to log')
const badRow = (log.body?.rows ?? []).find((r) => r.route === 'set_stock' && r.summary?.sku === 'NOT-A-REAL-SKU')
check(!badRow, 'the FAILED save is not logged either — only 2xx responses are')

const stockRow = (log.body?.rows ?? []).find((r) => r.route === 'set_stock' && r.summary?.sku === sampleSku)
check(stockRow?.summary?.stock === 13, `and its summary carries the real values (stock=${stockRow?.summary?.stock})`)
check(stockRow?.admin_email === EMAIL, `attributed to the account that made it (${stockRow?.admin_email})`)

const secretRow = (log.body?.rows ?? []).find((r) => r.route === 'settings_save')
check(secretRow?.summary?.value?.tranportal_password === '[redacted]',
  `a secret field is redacted, never the value (${JSON.stringify(secretRow?.summary)})`)

// A second signal that must_change_password's own gate covers audit_log too
// — asserted here rather than assumed, since the flag test above ran before
// this route existed in this file.
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e',
  `update admin_users set must_change_password = 1 where email='${EMAIL}'`])
const gatedAudit = await call('audit_log')
check(gatedAudit.status === 428, `audit_log itself is gated like any other route while flagged (${gatedAudit.status})`)
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e',
  `update admin_users set must_change_password = 0 where email='${EMAIL}'`])

// Tidy: leaves the table as this run found it, and the stock claim as the
// earlier tests left it.
execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', 'delete from admin_audit_log'])

// --- out ------------------------------------------------------------------
await call('logout', {})
const after = await call('me')
check(after.body === null, 'after logout, ?r=me answers null again')

console.log(fails ? `\n${fails} failed` : '\nall ok — the real admin.php, end to end')
process.exit(fails ? 1 : 0)
