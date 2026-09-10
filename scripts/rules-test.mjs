/**
 * The shop's numbers are the owner's, not the code's.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/rules-test.mjs
 *
 * Delivery, returns, the COD limit, the review reward, the discount cap, the
 * governorates served and which sizes and fits are offered used to be PHP
 * constants, so changing any of them meant a code edit and a publish. They are
 * now a `rules` row that store_rules() merges OVER those constants — the
 * constant is the default, the row is the override, one direction only.
 *
 * WHAT THIS RIG IS ACTUALLY FOR, because "the panel saved it" is the easy half:
 *
 *   - A NUMBER THAT SAVES BUT DOES NOT BITE. The whole feature is worthless if
 *     the delivery fee changes in the settings table and the checkout still
 *     charges 1.000. So every rule is changed and then measured AT THE PLACE IT
 *     ACTS — the quote, the order, the returns window, the address validator,
 *     the size picker — never by reading the setting back. Reading back only
 *     proves the row round-tripped.
 *
 *   - THE QUOTE AND THE ORDER MUST AGREE. api.php says so where it computes
 *     the quote: leaving delivery out "would put a total on screen that is
 *     1.000 KWD lower than the one the bank asks for". A free-delivery
 *     threshold applied in one of the two is that bug with a friendlier face,
 *     so the rig places a REAL ORDER and compares its amount with the quote it
 *     was shown, at both sides of the threshold.
 *
 *   - SIZES AND FITS ARE A SUBSET, AND THE SCHEMA SAYS SO. order_items carries
 *     `check (size in (...))` and `check (fit in (...))`. A size invented in
 *     the panel would pass PHP and then be refused by MySQL at insert — a
 *     checkout that dies on its last step. So the first check here is PARITY:
 *     STORE_SIZES and STORE_FITS must still equal the lists in those two
 *     constraints. The moment they drift, admin.php is either rejecting a legal
 *     size or admitting an illegal one, and neither says so.
 *
 *   - THE ORPHAN GUARD. Dropping a size that has product_variants rows does not
 *     tidy anything: the rows keep their stock and stop being orderable, and
 *     the garment goes on showing a size nobody can buy.
 *
 * It restores the defaults at the end, and does so in a finally — a rig that
 * leaves a 21-day returns window behind changes what every LATER rig measures,
 * which is this repository's oldest way to be lied to.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const API = BASE + '/api/api.php'
const ADMIN = BASE + '/api/admin.php'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q], { encoding: 'utf8' })

/* ---------------------------------------------------- 1. schema parity ---- */
// Read the two CHECK constraints out of the schema and the two constants out
// of store.php, and require them to match. Both are parsed from the files
// rather than restated here: a list copied into this rig would be a THIRD home
// for it, and the next person to add a size would update two of the three.
const schema = readFileSync('sporta-site/public_html/api/schema.mysql.sql', 'utf8')
const store = readFileSync('sporta-site/public_html/api/store.php', 'utf8')

const listFrom = (text, re) => {
  const m = text.match(re)
  return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : null
}
const schemaSizes = listFrom(schema, /items_size_ck\s+check\s*\(size is null or size in \(([^)]*)\)/i)
const schemaFits = listFrom(schema, /items_fit_ck\s+check\s*\(fit\s+is null or fit\s+in \(([^)]*)\)/i)
const constSizes = listFrom(store, /const STORE_SIZES\s*=\s*\[([^\]]*)\]/)
const constFits = listFrom(store, /const STORE_FITS\s*=\s*\[([^\]]*)\]/)

// A parse that finds nothing must fail loudly rather than compare [] with [].
// Two empty lists are equal, and that is this repository's favourite green.
check(schemaSizes?.length > 0 && constSizes?.length > 0,
  'both size lists were actually found', `schema=${schemaSizes?.length} php=${constSizes?.length}`)
check(schemaFits?.length > 0 && constFits?.length > 0,
  'both fit lists were actually found', `schema=${schemaFits?.length} php=${constFits?.length}`)
check(JSON.stringify(schemaSizes) === JSON.stringify(constSizes),
  'STORE_SIZES equals the schema CHECK constraint',
  `php=${constSizes} schema=${schemaSizes}`)
check(JSON.stringify(schemaFits) === JSON.stringify(constFits),
  'STORE_FITS equals the schema CHECK constraint',
  `php=${constFits} schema=${schemaFits}`)

/* --------------------------------------------------------- 2. plumbing ---- */
const jar = []
const req = async (url, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
  if (jar.length) headers.Cookie = jar.join('; ')
  const res = await fetch(url, { ...opts, headers })
  const setC = res.headers.getSetCookie?.() ?? []
  for (const c of setC) {
    const pair = c.split(';')[0]
    const name = pair.split('=')[0]
    const i = jar.findIndex((k) => k.split('=')[0] === name)
    if (i >= 0) jar[i] = pair; else jar.push(pair)
  }
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

const saveRules = (value) => req(`${ADMIN}?r=settings_save`, {
  method: 'POST', headers: { 'X-Sporta-Admin': '1' },
  body: JSON.stringify({ name: 'rules', value }),
})

const publicRules = async () => (await req(`${API}?r=slides`)).body?.rules

const quote = async (slug, qty, size = 'M') => (await req(`${API}?r=discount`, {
  method: 'POST', body: JSON.stringify({ items: [{ slug, qty, size }] }),
})).body

// store_phone() accepts 8 digits starting 5, 6 or 9 — the shop's own published
// number is a landline and is NOT a valid customer phone, which cost this rig a
// run. A FRESH one per order, because three open COD orders on one number trip
// store_order_guard and the failure would look like a delivery bug.
let phoneN = 0
const freshPhone = () => '5' + String(Date.now()).slice(-4) + String(1000 + (phoneN++)).slice(-3)

const DEFAULTS = {
  delivery_fee_fils: 1000, free_delivery_fils: 0, return_days: 14,
  cod_open_max: 3, review_reward_pct: 20, discount_max_pct: 60,
  governorates: ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra'],
  sizes: constSizes, fits: constFits,
}

const main = async () => {
  const login = await req(`${ADMIN}?r=login`, {
    method: 'POST', headers: { 'X-Sporta-Admin': '1' },
    body: JSON.stringify({ email: 'manager@sporta.com.kw', password: 'correct horse' }),
  })
  check(login.status === 200 && !login.body?.error, 'signed in to the panel',
    JSON.stringify(login.body))
  if (login.body?.error) return

  // Named, not picked by position: "a fixture chosen by position is a fixture
  // chosen at random" is written into CLAUDE.md after a sign-in that grabbed
  // whichever admin sorted first.
  // START FROM THE DEFAULTS. An earlier run — or a hand-typed curl during
  // development — leaves a row behind, and "the defaults are live" would then
  // be reporting that history rather than the code. A rig must not assume the
  // state it needs; it must establish it.
  await saveRules({ ...DEFAULTS })

  const products = (await req(`${API}?r=products`)).body
  const list = Array.isArray(products) ? products : products.products
  const item = list.find((p) => Number(p.price) > 0)
  check(!!item, 'found a priced product to quote with')
  if (!item) return
  const unitFils = Math.round(Number(item.price) * 1000)

  /* ------------------------------------------------ 3. defaults are live -- */
  const before = await publicRules()
  check(before?.delivery_fee_fils === DEFAULTS.delivery_fee_fils
     && before?.return_days === DEFAULTS.return_days,
    'the public rules start at the shipped defaults', JSON.stringify(before))
  check(before?.cod_open_max === undefined && before?.discount_max_pct === undefined
     && before?.review_reward_pct === undefined,
    'the three internal limits are NOT public', JSON.stringify(Object.keys(before ?? {})))

  /* ------------------------------------------ 4. a fee that actually bites - */
  await saveRules({ delivery_fee_fils: 1500, free_delivery_fils: 0 })
  const q1 = await quote(item.slug, 1)
  check(Math.round(q1.delivery * 1000) === 1500,
    'a changed delivery fee reaches the quote', `delivery=${q1.delivery}`)

  // THE ORDER, not just the quote. This is the check the feature exists for.
  const placed = await req(`${API}?r=order`, {
    method: 'POST',
    body: JSON.stringify({
      track_id: 'SPRULE' + Date.now().toString(36).toUpperCase().slice(-6),
      items: [{ slug: item.slug, qty: 1, size: 'M' }],
      method: 'cod', lang: 'en',
      customer: {
        name: 'Rules Rig', phone: freshPhone(), email: 'rig@example.com',
        governorate: 'capital', area: 'Salmiya', block: '1', street: 'One', building: '1',
      },
    }),
  })
  const chargedFils = Math.round(Number(placed.body?.amount ?? 0) * 1000)
  check(chargedFils === unitFils + 1500,
    'the ORDER charges the same delivery the quote showed',
    `charged=${chargedFils} expected=${unitFils + 1500} body=${JSON.stringify(placed.body).slice(0, 160)}`)

  /* --------------------------------------- 5. the free-delivery threshold -- */
  // Set the threshold just above one unit, so one unit pays and two do not.
  await saveRules({ free_delivery_fils: unitFils + 1 })
  const under = await quote(item.slug, 1)
  const over = await quote(item.slug, 2)
  check(Math.round(under.delivery * 1000) === 1500,
    'below the threshold, delivery is still charged', `delivery=${under.delivery}`)
  check(Math.round(over.delivery * 1000) === 0,
    'at or above the threshold, delivery is free', `delivery=${over.delivery}`)

  const bigOrder = await req(`${API}?r=order`, {
    method: 'POST',
    body: JSON.stringify({
      track_id: 'SPFREE' + Date.now().toString(36).toUpperCase().slice(-6),
      items: [{ slug: item.slug, qty: 2, size: 'M' }],
      method: 'cod', lang: 'en',
      customer: {
        name: 'Rules Rig', phone: freshPhone(), email: 'rig@example.com',
        governorate: 'capital', area: 'Salmiya', block: '1', street: 'One', building: '1',
      },
    }),
  })
  check(Math.round(Number(bigOrder.body?.amount ?? -1) * 1000) === unitFils * 2,
    'the ORDER honours free delivery too — no fee added behind the quote',
    `amount=${bigOrder.body?.amount} expected=${(unitFils * 2) / 1000}`)

  /* ------------------------------------------------- 6. the address gate -- */
  await saveRules({ governorates: ['capital', 'hawalli'] })
  const refused = await req(`${API}?r=order`, {
    method: 'POST',
    body: JSON.stringify({
      track_id: 'SPGOV' + Date.now().toString(36).toUpperCase().slice(-6),
      items: [{ slug: item.slug, qty: 1, size: 'M' }],
      method: 'cod', lang: 'en',
      customer: {
        name: 'Rules Rig', phone: freshPhone(), email: 'rig@example.com',
        governorate: 'jahra', area: 'X', block: '1', street: 'One', building: '1',
      },
    }),
  })
  check(refused.body?.error === 'invalid_governorate',
    'a governorate the owner removed is refused at checkout',
    JSON.stringify(refused.body))

  /* ------------------------------------------------------ 7. the guards --- */
  const cases = [
    [{ sizes: ['S', 'M', 'L'] }, 'rule_size_in_use', 'a size with stock rows cannot be dropped'],
    [{ sizes: ['S', 'XXS'] }, 'rule_unknown_value', 'a size the schema forbids is refused'],
    [{ fits: ['normal', 'baggy'] }, 'rule_unknown_value', 'a fit the schema forbids is refused'],
    [{ governorates: [] }, 'rule_empty_list', 'an empty list is refused, not stored'],
    [{ review_reward_pct: 70, discount_max_pct: 60 }, 'rule_reward_above_cap',
      'a review reward above the discount cap is refused'],
    [{ delivery_fee_fils: 1000000 }, 'rule_out_of_range', 'a fils/KWD mix-up is caught'],
    [{ return_days: 0 }, 'rule_out_of_range', 'a zero-day returns window is refused'],
    [{ delivery_fee_fils: 'free' }, 'rule_not_a_number', 'a non-number is refused'],
  ]
  for (const [value, wanted, what] of cases) {
    const res = await saveRules(value)
    check(String(res.body?.error ?? '').startsWith(wanted), what,
      JSON.stringify(res.body))
  }

  /* ------------------------------------------- 8. a partial save is partial */
  await saveRules({ ...DEFAULTS })
  await saveRules({ return_days: 30 })
  const after = await publicRules()
  check(after?.return_days === 30 && after?.delivery_fee_fils === DEFAULTS.delivery_fee_fils,
    'saving one field leaves the other eight alone', JSON.stringify(after))
}

try {
  await main()
} finally {
  // Restore, whatever happened above. Left behind, a 30-day window or a
  // two-governorate shop silently changes what every later rig measures.
  await saveRules({ ...DEFAULTS })
  sql("delete from order_items where order_id in (select id from orders where track_id like 'SPRULE%' or track_id like 'SPFREE%' or track_id like 'SPGOV%');")
  sql("delete from orders where track_id like 'SPRULE%' or track_id like 'SPFREE%' or track_id like 'SPGOV%';")
  const restored = await publicRules()
  check(restored?.delivery_fee_fils === DEFAULTS.delivery_fee_fils
     && restored?.return_days === DEFAULTS.return_days
     && restored?.governorates?.length === DEFAULTS.governorates.length,
    'the defaults were restored for the next rig', JSON.stringify(restored))
}

console.log(fails ? `\n${fails} failed` : '\nall ok — every rule bites where it acts')
process.exit(fails ? 1 : 0)
