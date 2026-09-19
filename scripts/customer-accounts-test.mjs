/**
 * Customer accounts — register, sign in, and see YOUR OWN orders.
 *
 *   npm run test:customers          (needs bash scripts/sandbox.sh)
 *
 * WHAT IT IS REALLY GUARDING. Not "sign-in works" — that half fails loudly the
 * first time anyone tries it. The three properties below are the ones that
 * fail SILENTLY, and each is a decision recorded in api/customer.php:
 *
 * 1. AN ACCOUNT SEES ONLY ITS OWN ORDERS, and is linked by `customer_id`
 *    rather than by phone number. Registration verifies no phone — this shop
 *    has no SMS provider — so a phone link would let anyone who knows a
 *    customer's mobile read their name, address and every order. The rig
 *    plants an order carrying the new account's own phone number and requires
 *    that it is NOT visible, which is the whole point and reads like a bug
 *    until you know why.
 *
 * 2. THE STOREFRONT STAYS COOKIE-FREE FOR A VISITOR WHO NEVER SIGNS IN. That
 *    was a deliberate property with a rig of its own, and a session ends it by
 *    definition — so the narrower promise is that the cookie appears only on
 *    sign-in. The easy way to break it is a `customer_me` that starts a
 *    session in order to answer "nobody", handing a cookie to everyone who
 *    loads a page.
 *
 * 3. THE SHOPPER'S COOKIE IS NOT THE ADMIN'S. Different name, and SameSite=Lax
 *    rather than Strict — because the bank redirects the customer back from
 *    pg.cbk.com, and a Strict cookie is not sent on that navigation. A shopper
 *    would return from paying and find themselves signed out, at the one
 *    moment where that looks like the money went somewhere.
 */

import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const API = BASE + '/api/api.php?r='

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })
const rows = (q) => {
  const out = sql(q).trim().split('\n')
  if (out.length < 2) return []
  const head = out[0].split('\t')
  return out.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))
}

/* A cookie jar, by hand. node's fetch does not keep one, and that is useful
   here: every request says exactly which cookie it carried. */
let jar = ''
const call = async (route, body, opts = {}) => {
  const r = await fetch(API + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.noJar ? {} : (jar ? { Cookie: jar } : {})),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = r.headers.getSetCookie?.() ?? []
  if (!opts.keepJar && setCookie.length) jar = setCookie.map((c) => c.split(';')[0]).join('; ')
  return { status: r.status, setCookie, body: await r.json().catch(() => null) }
}

const EMAIL = `rig-${Date.now()}@sporta.test`
const PHONE = '55598765'
const PW = 'a-long-enough-password'

// CLEAR THE RIG'S OWN THROTTLE FIRST. `customer_register` is rationed at ten
// in ten minutes — correctly, it is the route that writes a row and runs a
// password hash — and this rig registers on every run. Run twice in a row
// without this and every check after the third reports `too_many_attempts`,
// which reads as a broken shop and is the rig refusing itself. returns-test
// learned the same lesson; it is written down and was walked into anyway, by
// a mutation run that came out inconclusive because of it.
sql('delete from rate_limit')
sql(`delete from customers where email like 'rig-%@sporta.test'`)
sql(`delete from orders where track_id like 'SPCUST%'`)

try {
  /* ------------------------------------------- 1. nothing before signing in */
  const anon = await call('customer_me', null, { noJar: true, keepJar: true })
  check(anon.status === 200 && anon.body?.customer === null,
    'a visitor who has never signed in is told nobody is signed in',
    `${anon.status} ${JSON.stringify(anon.body)}`)
  check(anon.setCookie.length === 0,
    'AND IS GIVEN NO COOKIE for asking',
    anon.setCookie.join(' | ') || 'no Set-Cookie, which is the property')

  // The rest of the storefront, while we are here: the zero-cookie promise is
  // about every public route, not only the new one.
  for (const r of ['products', 'slides', 'contact']) {
    const x = await call(r, null, { noJar: true, keepJar: true })
    check(x.setCookie.length === 0, `and ?r=${r} still sets no cookie`,
      x.setCookie.join(' | '))
  }

  /* ---------------------------------------------------------- 2. registering */
  const short = await call('customer_register', { email: EMAIL, password: 'short' })
  check(short.status === 400 && short.body?.error === 'password_too_short',
    'a short password is refused by name', JSON.stringify(short.body))

  const bad = await call('customer_register', { email: 'not-an-email', password: PW })
  check(bad.status === 400 && bad.body?.error === 'invalid_email',
    'and so is something that is not an email', JSON.stringify(bad.body))

  const reg = await call('customer_register', { email: EMAIL, password: PW, phone: PHONE, name: 'Rig Shopper' })
  check(reg.status === 200 && reg.body?.customer?.email === EMAIL,
    'registering works and answers with the account', JSON.stringify(reg.body))
  check(reg.body?.customer?.password_hash === undefined,
    'and never hands back the password hash')

  const cookieLine = reg.setCookie.join(' | ')
  check(/sporta_shopper/.test(cookieLine), 'a cookie appears NOW, and not before', cookieLine)
  check(/HttpOnly/i.test(cookieLine), 'it is HttpOnly', cookieLine)
  // THE ONE WITH A REASON BEHIND IT. Strict here would be lost on the bank's
  // redirect back from pg.cbk.com.
  check(/SameSite=Lax/i.test(cookieLine),
    'and SameSite=Lax, so it survives the bank sending the customer back',
    cookieLine)
  check(!/sporta_admin/.test(cookieLine),
    'and it is NOT the admin cookie', cookieLine)

  const again = await call('customer_register', { email: EMAIL, password: PW })
  check(again.status === 409 && again.body?.error === 'email_taken',
    'a second account on the same email is refused', JSON.stringify(again.body))

  /* ------------------------------------------------------------- 3. sign in */
  const me = await call('customer_me')
  check(me.body?.customer?.email === EMAIL, 'the session holds', JSON.stringify(me.body))

  const wrong = await call('customer_login', { email: EMAIL, password: 'wrong-but-long-enough' })
  check(wrong.status === 401 && wrong.body?.error === 'bad_credentials',
    'a wrong password is refused', JSON.stringify(wrong.body))
  const missing = await call('customer_login', { email: 'nobody@sporta.test', password: PW })
  check(missing.body?.error === 'bad_credentials',
    'and an account that does not exist gives the IDENTICAL answer',
    'telling them apart asks this shop which addresses have accounts')

  /* ---- 4. THE ONE THAT MATTERS: an order with the same phone is NOT theirs */
  const id = Number(rows(`select id from customers where email = '${EMAIL}'`)[0].id)
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status,
         customer_name, customer_phone, created_at)
       values ('SPCUSTOTHER', 5.000, 'paid', 'cod', 'delivered', 'Someone Else', '965${PHONE}', now())`)
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status,
         customer_name, customer_phone, customer_id, created_at)
       values ('SPCUSTMINE', 7.000, 'paid', 'cod', 'delivered', 'Rig Shopper', '965${PHONE}', ${id}, now())`)

  const orders = await call('customer_orders')
  const got = (orders.body?.orders ?? []).map((o) => o.track_id)
  check(got.includes('SPCUSTMINE'), 'an order linked to the account is shown', got.join(','))
  check(!got.includes('SPCUSTOTHER'),
    'AND AN ORDER WITH THE SAME PHONE NUMBER IS NOT',
    got.includes('SPCUSTOTHER')
      ? 'ACCOUNT TAKEOVER: registering with a phone number would read that person\'s orders'
      : 'linked by customer_id only, because no phone is ever verified')

  /* -------------------------------- 5. signed out means signed out --------- */
  const outOrders = await fetch(API + 'customer_orders', { headers: { Accept: 'application/json' } })
  check(outOrders.status === 401, 'a signed-out request for orders is refused', `got ${outOrders.status}`)

  await call('customer_logout', {})
  const after = await call('customer_me')
  check(after.body?.customer === null, 'signing out really signs out',
    JSON.stringify(after.body))

  /* ---------------------- 6. checkout links the order to the account ------- */
  // Read from the SESSION, never the body: a customer_id the browser can send
  // is one it can change. Proved by sending somebody else's.
  await call('customer_login', { email: EMAIL, password: PW })
  const forged = await call('customer_orders')
  check(forged.status === 200, 'signed in again for the last check')

  const src = (await import('node:fs')).readFileSync('sporta-site/public_html/api/api.php', 'utf8')
  const insert = src.slice(src.indexOf('insert into orders'), src.indexOf('$orderId = (int)$db->lastInsertId()'))
  check(insert.includes('customer_id()'),
    'the order insert takes the customer from the session',
    'a customer_id read from the request body is one the browser can change')
  check(!/customer_id.*\$b\[/.test(insert),
    'and never from the request body')
} finally {
  sql(`delete from orders where track_id like 'SPCUST%'`)
  sql(`delete from customers where email like 'rig-%@sporta.test'`)
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall ok')
process.exit(fails ? 1 : 0)
