/**
 * The customer directory ("CRM") on the website's /backends Orders screen.
 *
 *   npm run test:crm          (needs bash scripts/sandbox.sh)
 *
 * WHAT IT IS REALLY GUARDING. Not "the list renders" — the two properties
 * that would fail silently:
 *
 * 1. A CUSTOMER IS A PHONE NUMBER, grouped across every order. Two orders on
 *    the same phone must appear as ONE row with two orders counted and only
 *    the PAID one contributing to the total — a grouping bug here either
 *    doubles a customer or quietly drops one of their orders from the sum.
 *
 * 2. BLOCKING IS VISIBLE FOR A PHONE THAT HAS NEVER ORDERED. That was the gap
 *    found while building this: block_customer accepts any phone, and a
 *    directory built only from `orders` would make a proactive block —
 *    exactly the case worth reviewing — vanish from every screen. The rig
 *    blocks a phone with ZERO orders and requires it to still be listed.
 *
 * And the ordinary two: the detail route is scoped to the phone asked about
 * (another customer's order must not leak in), and every crm_* route is
 * behind the same admin gate as everything else in this file.
 */

import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const API = BASE + '/api/admin.php?r='
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

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

let jar = ''
const call = async (route, body) => {
  const r = await fetch(API + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      'X-Sporta-Admin': '1',
      ...(jar ? { Cookie: jar } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = r.headers.getSetCookie?.() ?? []
  if (setCookie.length) jar = setCookie.map((c) => c.split(';')[0]).join('; ')
  return { status: r.status, body: await r.json().catch(() => null) }
}

const PHONE_A = '55511100'   // two orders, one paid one pending
const PHONE_B = '55522200'   // never ordered, will be blocked
const FULL_A = '965' + PHONE_A
const FULL_B = '965' + PHONE_B

sql('delete from rate_limit')
sql(`delete from orders where track_id like 'SPCRM%'`)
sql(`delete from blocked_customers where phone in ('${FULL_A}', '${FULL_B}')`)
sql(`delete from reviews where order_id in (select id from orders where track_id like 'SPCRM%')`)
sql(`delete from return_requests where order_id in (select id from orders where track_id like 'SPCRM%')`)

try {
  /* -------------------------------------------------------------- fixture */
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status,
         customer_name, customer_phone, customer_email, created_at)
       values ('SPCRM0001PAID', 12.500, 'paid', 'cod', 'delivered', 'Rig One', '${FULL_A}', 'rig-one@sporta.test', date_sub(now(), interval 10 day)),
              ('SPCRM0002PEND', 8.000, 'pending', 'cod', 'unfulfilled', 'Rig One', '${FULL_A}', 'rig-one@sporta.test', now())`)

  /* ---------------------------------------------------- 1. unauthenticated */
  const anonList = await fetch(API + 'crm_customers')
  check(anonList.status === 401, 'crm_customers refuses a signed-out request', `got ${anonList.status}`)
  const anonOne = await fetch(API + 'crm_customer&phone=' + FULL_A)
  check(anonOne.status === 401, 'and so does crm_customer', `got ${anonOne.status}`)

  /* ------------------------------------------------------------- sign in */
  const login = await call('login', { email: EMAIL, password: PASSWORD })
  check(login.status === 200, 'signed in for the rest of the checks', JSON.stringify(login.body))

  /* --------------- 2. THE ONE THAT MATTERS: grouping is correct ---------- */
  const list = await call('crm_customers&q=' + encodeURIComponent(PHONE_A))
  const rowA = (list.body || []).find((c) => c.phone === FULL_A)
  check(!!rowA, 'the two-order phone appears as ONE row', JSON.stringify(list.body?.slice(0, 3)))
  check(rowA?.order_count === 2, 'with both orders counted', `order_count=${rowA?.order_count}`)
  check(Math.abs((rowA?.paid_total ?? -1) - 12.5) < 0.001,
    'and only the PAID order in the total — the pending one is not money the shop has',
    `paid_total=${rowA?.paid_total}`)
  check(rowA?.name === 'Rig One' && rowA?.email === 'rig-one@sporta.test',
    'name and email come from an actual order')
  check(rowA?.blocked === false && rowA?.has_account === false,
    'and it is correctly neither blocked nor an account holder')

  /* --------------------------- 3. detail is scoped to this phone alone --- */
  const detailA = await call('crm_customer&phone=' + FULL_A)
  check(detailA.status === 200 && detailA.body?.orders?.length === 2,
    'the detail route returns both of this phone\'s orders', JSON.stringify(detailA.body?.orders))
  const otherTracks = (detailA.body?.orders ?? []).map((o) => o.track_id)
  check(!otherTracks.includes('SPCRM0003OTHR'),
    'and nothing belonging to a DIFFERENT phone leaks in — checked before that order exists')

  // Now actually create the other phone's order and prove it still does not leak.
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status,
         customer_name, customer_phone, created_at)
       values ('SPCRM0003OTHR', 5.000, 'paid', 'cod', 'delivered', 'Someone Else', '96555599999', now())`)
  const detailA2 = await call('crm_customer&phone=' + FULL_A)
  const tracks2 = (detailA2.body?.orders ?? []).map((o) => o.track_id)
  check(!tracks2.includes('SPCRM0003OTHR'),
    'and still does not, once that other order exists', tracks2.join(','))

  /* ---- 4. THE GAP THIS WAS BUILT TO CLOSE: a never-ordered blocked phone - */
  const beforeBlock = await call('crm_customers&q=' + encodeURIComponent(PHONE_B))
  check((beforeBlock.body || []).length === 0,
    'before any block, the never-ordered phone is rightly absent')

  const blockRes = await call('block_customer', { phone: FULL_B, scope: 'all', reason: 'rig: suspected fraud' })
  check(blockRes.status === 200, 'blocking a phone with no orders succeeds', JSON.stringify(blockRes.body))

  const afterBlock = await call('crm_customers&q=' + encodeURIComponent(PHONE_B))
  const rowB = (afterBlock.body || []).find((c) => c.phone === FULL_B)
  check(!!rowB, 'and NOW it is listed, with zero orders', JSON.stringify(afterBlock.body))
  check(rowB?.order_count === 0 && rowB?.blocked === true && rowB?.blocked_scope === 'all',
    'shown as blocked (all orders), not as an order-bearing customer',
    JSON.stringify(rowB))

  const detailB = await call('crm_customer&phone=' + FULL_B)
  check(detailB.status === 200 && detailB.body?.blocked?.reason === 'rig: suspected fraud',
    'the detail route explains why', JSON.stringify(detailB.body?.blocked))

  const unblockRes = await call('unblock_customer', { phone: FULL_B })
  check(unblockRes.status === 200, 'unblocking succeeds')
  const afterUnblock = await call('crm_customers&q=' + encodeURIComponent(PHONE_B))
  check((afterUnblock.body || []).length === 0,
    'and the never-ordered phone disappears again — it was only ever visible because of the block')

  /* -------------------------------------------------- 5. the panel itself */
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  })
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  const panelCard = () => p.locator('[data-sporta-crm]')

  try {
    await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    await p.locator('input').nth(0).fill(EMAIL)
    await p.locator('input').nth(1).fill(PASSWORD)
    await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
    await p.waitForTimeout(3000)

    await p.getByText('Orders', { exact: true }).first().click()
    await p.waitForTimeout(2000)
    check(await panelCard().count() === 1, 'the card is on the Orders screen')

    await p.getByText('Catalogue', { exact: true }).first().click()
    await p.waitForTimeout(1500)
    check(await panelCard().count() === 0, 'and gone on another screen')

    await p.getByText('Orders', { exact: true }).first().click()
    await p.waitForTimeout(2000)

    await panelCard().locator('.crm-input').fill(PHONE_A)
    await p.waitForTimeout(600)
    const rowText = await panelCard().locator('.crm-cust').first().innerText()
    check(rowText.includes('Rig One'), 'searching finds the fixture customer', rowText.slice(0, 80))

    await panelCard().locator('.crm-cust').first().click()
    await p.waitForTimeout(800)
    const detailText = await panelCard().innerText()
    check(detailText.includes('SPCRM0001PAID') && detailText.includes('SPCRM0002PEND'),
      'opening the row shows both orders')

    check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
  }
} finally {
  sql(`delete from orders where track_id like 'SPCRM%'`)
  sql(`delete from blocked_customers where phone in ('${FULL_A}', '${FULL_B}')`)
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall ok')
process.exit(fails ? 1 : 0)
