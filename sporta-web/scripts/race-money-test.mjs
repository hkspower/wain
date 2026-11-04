// RACE CONDITIONS ON THE MONEY PATH: orders, stock, discount codes, card
// callbacks, the sweepers and the warehouse mail. Every section fires REAL
// overlapping requests at a PRIVATE copy of the backend (scripts/lib/race-rig.mjs:
// own MariaDB, own PHP workers) and asserts the invariant a race would break.
//
//   npm run test:race-money                     the repository's backend
//   node scripts/race-money-test.mjs --tree DIR a patched COPY of dropin/
//   node scripts/race-money-test.mjs --only stock-order,double-submit
//   ROUNDS=3 node scripts/race-money-test.mjs   scale every section's rounds
//
// HOW A RACE IS MADE REPEATABLE. Two requests that need the same two rows in
// opposite orders collide in a window of microseconds, and on an idle machine
// that is a few in a thousand. A reproducer that fails "sometimes" is one
// nobody believes, so each section WIDENS the window on this private database
// only: a BEFORE UPDATE trigger that sleeps while the row it was called for is
// still locked (`race_widen_*`), a second connection that holds a row lock
// (`holdLock`), or a barrier of N requests started in the same tick. The
// widened run proves the interleaving is reachable; the plain run (no trigger)
// reports how often it happens at natural speed. Both are printed as
// `rate <what>  failed/total`.
//
// EACH SECTION IS ONE OF THREE KINDS, and the title says which:
//   REAL      the code is wrong; this section FAILS on the unfixed tree.
//   HANDLED   a guard already makes it safe (the guard is named); the section
//             passes on both trees and exists so nobody removes the guard.
//   BOUNDED   the interleaving exists but its worst outcome is harmless or
//             bounded; the bound is asserted.
//
// WHAT EACH REAL SECTION NEEDS. Races K1-1..K1-5 are fixed in store.php and
// api.php, which the release gate owns, so the fix travels as a patch
// (races-K1-store-api.patch, applied by the orchestrator once the gate is
// done): until it is applied, `stock-order`, `lock-wait-retry`, `phone-cooldown`,
// `discount-deadlock`, `stock-cross` and the last half of `last-unit` FAIL on the repository's tree, which is
// exactly what they are for. Races K1-6..K1-8 are fixed in php-knet and
// php-cbk and already hold. `admin-stock` documents K1-9 (the unversioned
// legacy save), which needs a client change and is reported, not asserted.
//
//   K1-1  deadlock between carts naming sizes in opposite order; no retry
//   K1-2  deadlock between automatic discount rules ranked differently
//   K1-3  reinstate/card_settled takes variant then discount, checkout the reverse
//   K1-4  release visits rows in product-id order, checkout in (slug, size) order
//   K1-5  per-phone cooldown is check-then-insert for card orders
//   K1-6  the "A2 hole": the exact-match lookup beat the bank-signed udf5
//   K1-7  a capture that meets a lock wait is filed as review, order left pending
//   K1-8  a late capture on a stock-less order whose code use was already returned
//   K1-9  legacy set_stock overwrites claimed pieces (no expected_version sent)
//   K1-11 a refused cart is told "1 left" about an empty shelf (stale snapshot read)
//
// SELF-CONTAINED: it removes everything it starts. If MariaDB or PHP is
// missing it says so and exits 0. It never touches the shared sandbox.
// Measured on a shared 4-CPU machine at load average 60+: about five minutes;
// on an idle one about a third of that.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DROPIN, sleep, startRig } from './lib/race-rig.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
void HERE
const args = process.argv.slice(2)
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const TREE = resolve(argVal('--tree', DROPIN))
const ONLY = (argVal('--only', '') || '').split(',').filter(Boolean)
const SCALE = Number(process.env.ROUNDS || 1)
const rounds = (n) => Math.max(1, Math.round(n * SCALE))

let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const rate = (what, failed, total) => console.log(`rate ${what}  ${failed}/${total} failed`)
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const rig = await startRig({ tree: TREE, workers: 16 })
if (rig.skip) {
  console.log(`SKIP race-money: ${rig.skip}. Nothing was tested.`)
  process.exit(0)
}
console.log(`private rig: MariaDB :${rig.DB_PORT}, PHP :${new URL(rig.SITE).port} x${rig.workers} workers, backend ${TREE}`)

const JACKET = 'cloudsoft-jacket-army-green'
const LEG = 'cloudsoft-leggings-army-green'
const line = (slug, size = 'M', qty = 1) => ({ slug, size, qty })
const FK = 'set foreign_key_checks=0;'
const reset = (extra = '') => rig.sql(`${FK} delete from fulfilment_outbox; delete from whatsapp_outbox; delete from order_items; delete from orders;
  delete from rate_limit; delete from discounts; update product_variants set stock = 1000, inventory_version = 0; ${extra}`)
const widen = (table, ms = 250, name = table) =>
  rig.sql(`drop trigger if exists race_widen_${name}; create trigger race_widen_${name} before update on ${table} for each row do sleep(${ms / 1000})`)
const unwiden = (...names) => rig.sql(names.map((n) => `drop trigger if exists race_widen_${n};`).join(' '))
const deadlocks = async () => Number((await rig.one("show global status like 'Innodb_deadlocks'")).split('\t')[1])
const stockOf = (slug, size = 'M') => rig.num(`select stock from product_variants where slug = '${slug}' and size = '${size}'`)
const verOf = (slug, size = 'M') => rig.num(`select inventory_version from product_variants where slug = '${slug}' and size = '${size}'`)
const tally = (results) => {
  const t = {}
  for (const r of results) { const k = r.status === 200 ? 'ok' : `${r.status}:${r.body?.error ?? '?'}`; t[k] = (t[k] || 0) + 1 }
  return t
}
let seq = 0
const track = (p = 'RC') => `${p}${Date.now().toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`.slice(0, 30).padEnd(8, 'Z')

// A pending order the way the storefront makes one.
const makeOrder = async ({ method = 'knet', items = [line(JACKET, 'L', 1)], code, phone, ip } = {}) => {
  const t = track()
  const r = await rig.order({ track: t, items, method, code, phone, ip })
  if (r.status !== 200) throw new Error(`could not place the order: ${r.status} ${r.text.slice(0, 200)}`)
  return { track: t, id: r.body.order_id, amount: r.body.amount, fmt: Number(r.body.amount).toFixed(3) }
}
const statusOf = (location) => new URL(location, 'https://x.test').searchParams.get('status')
const orderRow = async (t) => {
  const f = (await rig.sql(`select payment_status, fulfilment_status, stock_claimed, stock_released, ifnull(discount_released,0), ifnull(cbk_status,''), id
    from orders where track_id = '${t}'`)).split('\t')
  return { pay: f[0], ful: f[1], claimed: f[2] === '1', released: f[3] === '1', discRel: f[4] === '1', cbk: f[5], id: Number(f[6]) }
}
const payRows = (id) => rig.num(`select count(*) from fulfilment_outbox where order_id = ${id} and kind = 'payment'`)
const ageOrder = (t, hours) => rig.sql(`update orders set created_at = now() - interval ${hours} hour where track_id = '${t}'`)

const sections = []
const section = (id, title, fn) => sections.push({ id, title, fn })

// =====================================================================================
section('stock-order', 'REAL  stock claim takes variant rows in CART order: [A,B] vs [B,A] deadlock (1213) and the order 500s', async () => {
  const A = line(JACKET, 'M'), B = line(LEG, 'M')
  const run = async (label, n, per) => {
    await reset()
    const d0 = await deadlocks()
    let ok_ = 0, f500 = 0, other = {}
    for (let r = 0; r < n; r++) {
      const res = await rig.burst(per, (i) => rig.order({ track: track(`D${r}x${i}`), items: i % 2 ? [A, B] : [B, A] }))
      for (const x of res) {
        if (x.status === 200) ok_++
        else if (x.status === 500) f500++
        else other[`${x.status}:${x.body?.error}`] = (other[`${x.status}:${x.body?.error}`] || 0) + 1
      }
    }
    const dl = (await deadlocks()) - d0
    const orders = await rig.num('select count(*) from orders')
    const sa = await stockOf(JACKET), sb = await stockOf(LEG)
    rate(`${label}`, f500, ok_ + f500)
    console.log(`     deadlocks seen by InnoDB: ${dl}   other refusals: ${JSON.stringify(other)}`)
    is(f500 === 0, `${label}: no order is lost to a deadlock`, `${f500} of ${ok_ + f500} answered 500`)
    is(dl === 0, `${label}: InnoDB saw no deadlock at all (one lock order, so nothing is left for the retry to rescue)`, `${dl} deadlocks`)
    is(orders === ok_, `${label}: one order row per accepted order, none from a rolled-back one`, `${orders} rows, ${ok_} accepted`)
    is(sa === 1000 - ok_ && sb === 1000 - ok_, `${label}: stock matches the accepted orders exactly (no leaked claim from a victim)`, `${sa}/${sb} vs ${1000 - ok_}`)
    is((await verOf(JACKET)) === ok_ && (await verOf(LEG)) === ok_, `${label}: inventory_version moved once per accepted order`, `${await verOf(JACKET)}/${await verOf(LEG)}`)
  }
  await widen('product_variants', 200)
  await run('widened (200 ms inside each locked update)', rounds(3), 8)
  await unwiden('product_variants')
  await run('natural speed', rounds(10), 16)
})

// =====================================================================================
section('lock-wait-retry', 'REAL  an order that meets a lock-wait timeout (1205) answers 500 instead of trying again', async () => {
  await reset()
  await rig.sql('set global innodb_lock_wait_timeout = 3')
  // Another connection holds the variant row for 4.5 s: longer than one wait
  // (3 s), shorter than two. A bounded retry gets through; no retry gives up.
  const hold = await rig.holdLock(`update product_variants set stock = stock where slug = '${JACKET}' and size = 'L'`, 4.5)
  const t0 = Date.now()
  const r = await rig.order({ track: track('LW'), items: [line(JACKET, 'L')] })
  const took = Date.now() - t0
  await hold.done
  await rig.sql('set global innodb_lock_wait_timeout = 20')
  rate('order met a held row lock', r.status === 200 ? 0 : 1, 1)
  is(r.status === 200, 'the order is accepted after the lock clears', `${r.status} ${r.body?.error ?? ''} after ${took} ms`)
  is(took < 15000, 'and the retry is bounded', `${took} ms`)
  is((await rig.num('select count(*) from orders')) === (r.status === 200 ? 1 : 0), 'exactly the accepted order exists (a failed attempt left nothing behind)')
  is((await stockOf(JACKET, 'L')) === (r.status === 200 ? 999 : 1000), 'the stock moved once or not at all, never twice')
})

// =====================================================================================
section('last-unit', 'HANDLED + REAL(K1-11)  two different carts racing for the last unit of one size (guarded UPDATE stock >= qty); the loser is told the truth about what is left', async () => {
  const A = line(JACKET, 'M'), B = line(LEG, 'M')
  let bad_ = 0, total = 0, deadlock500 = 0, wrongRefusal = 0
  for (let r = 0; r < rounds(6); r++) {
    await reset(`update product_variants set stock = 1 where slug = '${JACKET}' and size = 'M'`)
    // A third of the carts are [A] alone, a third [B, A], a third [A, B]:
    // whoever wins, the others must be refused and leave nothing behind.
    const res = await rig.burst(15, (i) => rig.order({ track: track(`L${r}x${i}`), items: i % 3 === 0 ? [A] : i % 3 === 1 ? [B, A] : [A, B] }))
    const wins = res.filter((x) => x.status === 200).length
    deadlock500 += res.filter((x) => x.status === 500).length
    // A cart of ONE line cannot deadlock, so its loser must be told so by the
    // claim itself (409 out_of_stock_<slug>_M_0), not by the database's CHECK.
    wrongRefusal += res.filter((x, i) => i % 3 === 0 && x.status !== 200
      && !(x.status === 409 && x.body?.error === `out_of_stock_${JACKET}_M_0`)).length
    const stockA = await stockOf(JACKET), stockB = await stockOf(LEG)
    const orders = await rig.num('select count(*) from orders')
    total++
    // A deadlock victim answers 500; that is the stock-order section's finding,
    // counted there. HERE the question is oversell and leak: at most one
    // winner, no negative stock, and the other size holds exactly what the
    // accepted orders took.
    const soldB = await rig.num(`select ifnull(sum(oi.qty),0) from order_items oi join products p on p.id = oi.product_id where p.slug = '${LEG}'`)
    if (!(stockA >= 0 && wins <= 1 && orders === wins && stockA === 1 - wins && stockB === 1000 - soldB)) bad_++
  }
  rate('last unit: oversell or leak', bad_, total)
  is(bad_ === 0, 'never more than one winner, never negative stock, no leaked claim on the other size', `${bad_} bad of ${total} rounds (${deadlock500} deadlock 500s, counted in stock-order)`)
  is(wrongRefusal === 0, 'every loser with a one-line cart is refused by the guarded UPDATE with out_of_stock_<slug>_M_0', `${wrongRefusal} refused any other way`)
})

// =====================================================================================
section('double-submit', 'HANDLED  the same order posted twice 5 ms apart: one order, the second gets it back (cooldown lock + unique track_id)', async () => {
  for (const cooldown of [60, 0]) {
    await reset()
    rig.rewriteApiConfig({ order_cooldown_seconds: cooldown })
    let dup = 0, bothOk = 0, errs = 0
    const N = rounds(25)
    for (let r = 0; r < N; r++) {
      const t = track(`S${cooldown}${r}`)
      const phone = rig.freshPhone(), ip = rig.freshIp()
      const body = { track: t, items: [line(JACKET, 'M')], phone, ip, method: 'knet' }
      const [a, b] = await Promise.all([rig.order(body), sleep(5).then(() => rig.order(body))])
      if (a.status === 200 && b.status === 200 && a.body.order_id === b.body.order_id) bothOk++
      else errs++
      if ((await rig.num(`select count(*) from orders where track_id = '${t}'`)) !== 1) dup++
    }
    rate(`double submit, cooldown ${cooldown}s: duplicate order`, dup, N)
    rate(`double submit, cooldown ${cooldown}s: second request not answered with the first order`, errs, N)
    is(dup === 0, `cooldown ${cooldown}s: never two orders for one attempt`)
    is(errs === 0, `cooldown ${cooldown}s: both taps are answered with the same order`, `${bothOk}/${N}`)
    is((await stockOf(JACKET)) === 1000 - N, `cooldown ${cooldown}s: the stock was claimed once per attempt`, `${await stockOf(JACKET)}`)
  }
  // A DIFFERENT attempt from the same client in the same instant is the
  // cooldown's job: one accepted, the rest 429 previous_order_pending.
  await reset()
  rig.rewriteApiConfig({ order_cooldown_seconds: 60 })
  let wrong = 0
  const N2 = rounds(10)
  for (let r = 0; r < N2; r++) {
    const ip = rig.freshIp()
    const res = await rig.burst(4, (i) => rig.order({ track: track(`T${r}x${i}`), items: [line(JACKET, 'M')], ip, phone: rig.freshPhone() }))
    const t = tally(res)
    if (!((t.ok ?? 0) === 1 && (t['429:previous_order_pending'] ?? 0) === 3)) wrong++
  }
  rate('one client, four different attempts at once: not exactly one accepted', wrong, N2)
  is(wrong === 0, 'one client, four different attempts at once: exactly one is accepted, three are told to wait')
  rig.rewriteApiConfig({})
})

// =====================================================================================
section('phone-cooldown', 'REAL  the per-phone cooldown is check-then-insert for card orders from different clients', async () => {
  await reset()
  rig.rewriteApiConfig({ order_cooldown_seconds: 60 })
  let wrong = 0, accepted = 0
  const N = rounds(15)
  for (let r = 0; r < N; r++) {
    const phone = rig.freshPhone()
    // Six devices, six addresses, one phone number, one card order each.
    const res = await rig.burst(6, (i) => rig.order({ track: track(`P${r}x${i}`), items: [line(JACKET, 'M')], phone, method: 'knet' }))
    const ok_ = res.filter((x) => x.status === 200).length
    accepted += ok_
    if (ok_ !== 1) wrong++
  }
  rate('one phone, six addresses at once: more than one order accepted', wrong, N)
  is(wrong === 0, 'one phone number gets exactly one order per cooldown, whichever address it comes from', `${accepted} accepted over ${N} rounds (want ${N})`)
  rig.rewriteApiConfig({})
})

// =====================================================================================
section('cod-cap', 'HANDLED  the cap of three open cash orders per phone holds under eight at once (advisory lock per phone)', async () => {
  await reset()
  rig.rewriteApiConfig({ order_cooldown_seconds: 0 })
  let wrong = 0
  const N = rounds(8)
  for (let r = 0; r < N; r++) {
    const phone = rig.freshPhone()
    const res = await rig.burst(8, (i) => rig.order({ track: track(`C${r}x${i}`), items: [line(JACKET, 'M')], phone, method: 'cod' }))
    const t = tally(res)
    if (!((t.ok ?? 0) === 3 && (t['409:too_many_open_cod'] ?? 0) === 5)) wrong++
  }
  rate('cash orders: cap broken', wrong, N)
  is(wrong === 0, 'exactly three cash orders are accepted, five refused with too_many_open_cod')
})

// =====================================================================================
section('discount-claim', 'HANDLED  a limited code under 32 concurrent checkouts (guarded UPDATE used_count < usage_limit, inside the order transaction)', async () => {
  const code = async (limit, extra = '') => rig.sql(`insert into discounts (kind, code, label, type, value, usage_limit, active) values ('code', 'RACE${limit}', 'Race ${limit}', 'percent', 10, ${limit}, 1); ${extra}`)
  for (const limit of [1, 5]) {
    let wrong = 0
    const N = rounds(3)
    for (let r = 0; r < N; r++) {
      await reset()
      await code(limit)
      const res = await rig.burst(32, (i) => rig.order({ track: track(`Q${limit}${r}x${i}`), items: [line(JACKET, 'M')], code: `RACE${limit}` }))
      const won = res.filter((x) => x.status === 200).length
      // The loser is told discount_used_up either by the read (400) or by the guarded claim (409).
      const refused = res.filter((x) => x.body?.error === 'discount_used_up').length
      const used = await rig.num(`select used_count from discounts where code = 'RACE${limit}'`)
      const withCode = await rig.num(`select count(*) from orders where discount_code = 'RACE${limit}'`)
      if (!(won === limit && used === limit && withCode === limit && refused === 32 - limit)) wrong++
    }
    rate(`code with ${limit} use(s), 32 at once: wrong number of redemptions`, wrong, N)
    is(wrong === 0, `a code with ${limit} use(s) is redeemed exactly ${limit} time(s); the rest get discount_used_up and no order`)
  }
  // The 60% cap is arithmetic, but a stack of rules is claimed concurrently:
  // no accepted order may exceed it.
  await reset()
  await rig.sql(`insert into discounts (kind, code, label, type, value, active) values ('code', 'BIG90', 'Big 90', 'percent', 90, 1);
                 insert into discounts (kind, label, type, value, active) values ('auto', 'Auto 50', 'percent', 50, 1)`)
  const res = await rig.burst(12, (i) => rig.order({ track: track(`K${i}`), items: [line(JACKET, 'M', 2)], code: 'BIG90' }))
  const over = await rig.num('select count(*) from orders where discount_amount > subtotal * 0.6 + 0.0005')
  is((tally(res).ok ?? 0) === 12 && over === 0, 'stacked rules (90% code + 50% automatic) never take more than 60% of any order, under 12 at once')

  // A claim that is followed by a failure inside the same transaction is
  // rolled back with it: the use comes back, so the one valid order still wins.
  await reset(`update product_variants set stock = 0 where slug = '${LEG}' and size = 'M'`)
  await code(1)
  const mixed = await rig.burst(17, (i) => rig.order({
    track: track(`M${i}`), code: 'RACE1',
    items: i === 0 ? [line(JACKET, 'M')] : [line(JACKET, 'M'), line(LEG, 'M')],
  }))
  const won = mixed[0].status === 200
  const used = await rig.num("select used_count from discounts where code = 'RACE1'")
  is(won && used === 1, 'sixteen orders that fail AFTER claiming the code (out of stock) hand the use back; the valid order still gets it', `valid order ${mixed[0].status}, used_count ${used}`)
})

// =====================================================================================
section('discount-deadlock', 'REAL  two automatic rules claimed in "best first" order: carts that rank them differently deadlock', async () => {
  await reset()
  // Rule X = 10% of the order; rule Y = a fixed 1.5 KWD. On a 10 KWD cart Y
  // is worth more (Y first); on a 20 KWD cart X is (X first). Each order
  // claims BOTH rows, in the order it ranked them.
  await rig.sql(`insert into discounts (kind, label, type, value, active) values ('auto', 'X ten percent', 'percent', 10, 1);
                 insert into discounts (kind, label, type, value, active) values ('auto', 'Y fixed', 'fixed', 1.5, 1)`)
  await widen('discounts', 200)
  const d0 = await deadlocks()
  let f500 = 0, okc = 0
  const N = rounds(3)
  for (let r = 0; r < N; r++) {
    const res = await rig.burst(8, (i) => rig.order({ track: track(`R${r}x${i}`), items: i % 2 ? [line(JACKET, 'M', 1)] : [line(JACKET, 'M', 2)] }))
    f500 += res.filter((x) => x.status === 500).length
    okc += res.filter((x) => x.status === 200).length
  }
  await unwiden('discounts')
  const dl = (await deadlocks()) - d0
  rate('two automatic rules, carts ranking them in opposite order', f500, f500 + okc)
  console.log(`     deadlocks seen by InnoDB: ${dl}`)
  is(f500 === 0, 'no order is lost to a deadlock between the two discount rows', `${f500} of ${f500 + okc}`)
  is(dl === 0, 'and InnoDB saw no deadlock at all (rows are claimed in id order)', `${dl} deadlocks`)
  const used = (await rig.sql('select used_count from discounts order by id')).split('\n').map(Number)
  is(used[0] === okc && used[1] === okc, 'both rules were used exactly once per accepted order', `${used} vs ${okc}`)
})

// =====================================================================================
section('stock-cross', 'REAL  stock release and reinstate take rows in a different order from checkout (variants/discounts crossed)', async () => {
  // (1) RELEASE: store_stock_release() gives the pieces back with ONE joined
  // UPDATE whose derived table is grouped by product_id, so it visits the rows
  // in PRODUCT-ID order; checkout claims in (slug, size) order. Two products are
  // made here whose id order is the OPPOSITE of their slug order, so that a
  // release of an order holding both and a checkout for both must cross.
  await reset()
  await rig.sql(`insert into products (slug, name_en, name_ar, price, category, active) values ('zz-race-first', 'ZZ race first', 'ZZ', 10, 'jackets', 1);
                 insert into products (slug, name_en, name_ar, price, category, active) values ('aa-race-second', 'AA race second', 'AA', 10, 'jackets', 1);
                 insert into product_variants (sku, slug, size, stock) values ('RACE-ZZ-M', 'zz-race-first', 'M', 1000), ('RACE-AA-M', 'aa-race-second', 'M', 1000)`)
  const ZZ = 'zz-race-first', AA = 'aa-race-second'
  const stuck = []
  for (let i = 0; i < 6; i++) {
    const o = await makeOrder({ items: [line(ZZ, 'M'), line(AA, 'M')] })
    await rig.sql(`update orders set payment_status = 'failed' where id = ${o.id}`)
    stuck.push(o)
  }
  await widen('product_variants', 200)
  const d0 = await deadlocks()
  // Sweep (release) while checkouts for the same two sizes run in the other order.
  const sweep = rig.phpCli('cron-stock.php', ['--release'])
  const checkouts = rig.burst(6, (i) => rig.order({ track: track(`X${i}`), items: [line(AA, 'M'), line(ZZ, 'M')] }))
  const [out, res] = await Promise.all([sweep, checkouts])
  await unwiden('product_variants')
  const dl = (await deadlocks()) - d0
  let sweepJson = {}
  try { sweepJson = JSON.parse(out.trim().split('\n').pop()) } catch { /* not json */ }
  const failedRel = (sweepJson.failed ?? []).length
  const f500 = res.filter((x) => x.status === 500).length
  rate('release vs checkout: a release failed or an order 500d', failedRel + f500, stuck.length + res.length)
  console.log(`     deadlocks seen by InnoDB: ${dl}; sweeper failed: ${failedRel}; orders 500: ${f500}`)
  is(failedRel === 0 && f500 === 0 && dl === 0, 'neither the release nor a checkout is a deadlock victim, and none occurs', `sweeper failed ${failedRel}, orders 500 ${f500}, deadlocks ${dl}`)

  // (2) RECLAIM: put a cancelled order that held a limited code back, while
  // checkouts use the same code and the same size. Reclaim takes the variant
  // first and the discount second; checkout the other way round.
  await reset()
  await rig.sql(`insert into discounts (kind, code, label, type, value, usage_limit, active) values ('code', 'XROSS', 'Cross', 'percent', 10, 0, 1)`)
  const held = []
  for (let i = 0; i < 4; i++) held.push(await makeOrder({ items: [line(JACKET, 'M')], code: 'XROSS' }))
  const okSign = await rig.adminSignIn()
  is(okSign, 'admin signed in on the private instance')
  for (const o of held) { // cancel + sweep so stock_released = 1 and discount_released = 1
    const c = await rig.admin('fulfilment', { method: 'POST', body: { order_id: o.id, status: 'cancelled' } })
    if (c.status !== 200) bad('could not cancel the order', c.text.slice(0, 120))
  }
  await rig.phpCli('cron-stock.php', ['--release'])
  await widen('product_variants', 200); await widen('discounts', 200)
  const d1 = await deadlocks()
  const reinstates = held.map((o) => rig.admin('fulfilment', { method: 'POST', body: { order_id: o.id, status: 'unfulfilled' } }))
  const fresh = rig.burst(4, (i) => rig.order({ track: track(`Y${i}`), items: [line(JACKET, 'M')], code: 'XROSS' }))
  const [rs, fs] = await Promise.all([Promise.all(reinstates), fresh])
  await unwiden('product_variants', 'discounts')
  const dl2 = (await deadlocks()) - d1
  const adminFail = rs.filter((x) => x.status >= 500).length
  const orderFail = fs.filter((x) => x.status === 500).length
  rate('reinstate vs checkout: a reinstate or an order 500d', adminFail + orderFail, rs.length + fs.length)
  console.log(`     deadlocks seen by InnoDB: ${dl2}; reinstate 5xx: ${adminFail}; orders 500: ${orderFail}`)
  is(adminFail === 0 && orderFail === 0 && dl2 === 0, 'neither the reinstate nor a checkout is a deadlock victim, and none occurs', `reinstate 5xx ${adminFail}, orders 500 ${orderFail}, deadlocks ${dl2}`)
})

// =====================================================================================
section('knet-callback', 'HANDLED  the KNET result arriving many times at once (browser return + server notification + replays)', async () => {
  await reset()
  let wrong = 0
  const N = rounds(8)
  for (let r = 0; r < N; r++) {
    const o = await makeOrder()
    const res = await rig.burst(12, () => rig.knetCallback({ trackid: o.track, result: 'CAPTURED', amt: o.fmt, paymentid: '555000111222' }))
    const row = await orderRow(o.track)
    const rows = await payRows(o.id)
    const stamped = await rig.num(`select count(*) from orders where id = ${o.id} and paid_at is not null`)
    const landed = res.every((x) => statusOf(x.location) === 'success')
    if (!(row.pay === 'paid' && rows === 1 && stamped === 1 && landed)) wrong++
  }
  rate('12 identical callbacks: not exactly one paid + one follow-up', wrong, N)
  is(wrong === 0, 'paid once, one "payment" message to the warehouse, every caller sent to the success page')
})

// =====================================================================================
section('capture-vs-decline', 'HANDLED  CAPTURED racing NOT CAPTURED for one order (second bank session): money wins and the last word to the warehouse is "ship"', async () => {
  let wrong = 0
  const N = rounds(10)
  for (let r = 0; r < N; r++) {
    await reset()
    const o = await makeOrder()
    const calls = []
    for (let i = 0; i < 4; i++) {
      calls.push(rig.knetCallback({ trackid: o.track, result: 'NOT CAPTURED', amt: o.fmt, paymentid: `77${r}${i}` }))
      calls.push(rig.knetCallback({ trackid: o.track, result: 'CAPTURED', amt: o.fmt, paymentid: '888000111222' }))
    }
    await Promise.all(calls)
    const row = await orderRow(o.track)
    const last = await rig.one(`select json_value(payload, '$.payment_status') from fulfilment_outbox where order_id = ${o.id} and kind = 'payment' order by id desc limit 1`)
    // The stock is still claimed (the sweeper has not run), so a capture after
    // a decline is a legitimate paid order.
    if (!(row.pay === 'paid' && row.claimed && !row.released && last === 'paid')) wrong++
  }
  rate('capture vs decline: not (paid + ship last)', wrong, N)
  is(wrong === 0, 'the order ends paid, its stock stays claimed, and the final warehouse message says paid')
})

// =====================================================================================
section('callback-vs-sweeper', 'HANDLED  a capture racing the sweeper that releases an expired card order: never paid with its stock given away', async () => {
  let paid = 0, review = 0, wrong = 0
  const N = rounds(15)
  await reset()
  await widen('orders', 250)
  // The callback is started at a spread of offsets after the sweeper, so both
  // "capture first" and "release first" are reached.
  const offsets = [0, 150, 300, 450, 600]
  for (let r = 0; r < N; r++) {
    const o = await makeOrder({ items: [line(JACKET, 'L', 2)] })
    await ageOrder(o.track, 3)
    const sweep = rig.phpCli('cron-stock.php', ['--release'])
    const cb = sleep(offsets[r % offsets.length]).then(() => rig.knetCallback({ trackid: o.track, result: 'CAPTURED', amt: o.fmt, paymentid: '999000111222' }))
    await Promise.all([sweep, cb])
    const row = await orderRow(o.track)
    const stock = await stockOf(JACKET, 'L')
    if (row.pay === 'paid') paid++
    if (row.pay === 'review') review++
    // paid -> the garments are still claimed; review -> released and the money is recorded for a person.
    // Every earlier round's order is dead or paid too, so look at THIS order's pieces only.
    const mine = await rig.num(`select ifnull(sum(qty),0) from order_items where order_id = ${row.id}`)
    const heldByOthers = await rig.num(`select ifnull(sum(oi.qty),0) from orders o join order_items oi on oi.order_id = o.id where o.id <> ${row.id} and o.payment_status = 'paid'`)
    const expectHeld = (row.pay === 'paid' ? mine : 0) + heldByOthers
    const consistent = (row.pay === 'paid' && !row.released && row.ful !== 'cancelled' && stock === 1000 - expectHeld)
      || (row.pay === 'review' && row.released && stock === 1000 - expectHeld && /STOCK_RESERVATION_RELEASED|ORDER_CANCELLED/.test(row.cbk))
    if (!consistent) wrong++
  }
  await unwiden('orders')
  rate('callback vs sweeper: inconsistent outcome', wrong, N)
  console.log(`     outcomes: paid ${paid}, review ${review}`)
  is(wrong === 0, 'always one of: paid with the garments held, or held for review with the garments back and the bank record kept')
  is(paid > 0 && review > 0, 'the offsets reach BOTH orders of events (capture first, release first)', `paid ${paid}, review ${review}`)
})

// =====================================================================================
section('callback-vs-admin', 'HANDLED  a capture racing an admin cancel / card_settled / mark-shipped on the same order: never paid AND cancelled, never shipped unpaid', async () => {
  const signed = await rig.adminSignIn()
  is(signed, 'admin signed in')
  let wrong = 0
  const N = rounds(18)
  const outcomes = {}
  await reset()
  await widen('orders', 200)
  const offsets = [0, 120, 240, 360]
  for (let r = 0; r < N; r++) {
    const o = await makeOrder({ items: [line(JACKET, 'L', 1)] })
    const action = r % 3
    const callbackFirst = Math.floor(r / 3) % 2 === 1
    const delay = offsets[Math.floor(r / 6) % offsets.length]
    const doAdmin = () => (action === 0
      ? rig.admin('fulfilment', { method: 'POST', body: { order_id: o.id, status: 'cancelled' } })
      : action === 1
        ? rig.admin('fulfilment', { method: 'POST', body: { order_id: o.id, status: 'shipped' } })
        : rig.admin('card_settled', { method: 'POST', body: { order_id: o.id, bank_reference: '123456789012' } }))
    const doCb = () => rig.knetCallback({ trackid: o.track, result: 'CAPTURED', amt: o.fmt, paymentid: '444000111222' })
    await Promise.all(callbackFirst ? [doCb(), sleep(delay).then(doAdmin)] : [doAdmin(), sleep(delay).then(doCb)])
    await rig.phpCli('cron-stock.php', ['--release'])
    const row = await orderRow(o.track)
    const key = `${['cancel', 'ship', 'settle'][action]}->${row.pay}/${row.ful}`
    outcomes[key] = (outcomes[key] || 0) + 1
    const bothPaidAndCancelled = row.pay === 'paid' && row.ful === 'cancelled'
    const shippedUnpaid = row.ful === 'shipped' && row.pay !== 'paid'
    // This order's garment is held (stock reflects it) unless the order was cancelled/released.
    const heldByOthers = await rig.num(`select ifnull(sum(oi.qty),0) from orders o join order_items oi on oi.order_id = o.id where o.id <> ${row.id} and o.fulfilment_status <> 'cancelled' and o.stock_released = 0`)
    const expectedStock = 1000 - heldByOthers - (row.ful === 'cancelled' || row.released ? 0 : 1)
    const stockOk = (await stockOf(JACKET, 'L')) === expectedStock
    if (bothPaidAndCancelled || shippedUnpaid || !stockOk) wrong++
  }
  await unwiden('orders')
  rate('callback vs admin: contradictory end state', wrong, N)
  console.log(`     outcomes: ${JSON.stringify(outcomes)}`)
  is(wrong === 0, 'never paid-and-cancelled, never shipped-unpaid, and the stock matches the final state')
  is(Object.keys(outcomes).some((k) => k.startsWith('cancel->') && /cancelled/.test(k)) && Object.keys(outcomes).some((k) => k.startsWith('cancel->paid')),
    'the offsets reach both orders of events for the cancel (cancel won / capture won)', Object.keys(outcomes).filter((k) => k.startsWith('cancel')).join(' | '))
})

// =====================================================================================
section('late-discount', 'REAL  a second bank session captures after the first declined and the sweeper returned the code use: paid, but the use stays returned', async () => {
  await reset()
  await rig.sql(`insert into discounts (kind, code, label, type, value, usage_limit, active) values ('code', 'LATE1', 'Late', 'percent', 10, 1, 1)`)
  // An order with no sized garments (no stock claim) that holds the code.
  const acc = (await rig.sql("select p.slug from products p where not exists (select 1 from product_variants v where v.slug = p.slug) and p.active = 1 limit 1")).split('\n')[0]
  if (!acc) { bad('no stock-less product in the seed to build the scenario'); return }
  const o = await makeOrder({ items: [{ slug: acc, qty: 1 }], code: 'LATE1' })
  const before = await rig.num("select used_count from discounts where code = 'LATE1'")
  // Session one declines, the sweeper runs, session two captures.
  await rig.knetCallback({ trackid: o.track, result: 'NOT CAPTURED', amt: o.fmt, paymentid: '1' })
  await rig.phpCli('cron-stock.php', ['--release'])
  const mid = await rig.num("select used_count from discounts where code = 'LATE1'")
  const cap = await rig.knetCallback({ trackid: o.track, result: 'CAPTURED', amt: o.fmt, paymentid: '999000111333' })
  const row = await orderRow(o.track)
  const used = await rig.num("select used_count from discounts where code = 'LATE1'")
  // Can somebody else spend the single-use code now?
  const other = await rig.order({ track: track('LT'), items: [{ slug: acc, qty: 1 }], code: 'LATE1' })
  console.log(`     used_count: placed ${before} -> after sweep ${mid} -> after late capture ${used}; order ${row.pay}; second redeemer ${other.status}`)
  const spentTwice = row.pay === 'paid' && other.status === 200
  rate('single-use code spent twice by a late capture', spentTwice ? 1 : 0, 1)
  is(!spentTwice, 'a paid order never coexists with a code use that was given back to somebody else', `capture ${statusOf(cap.location)}, order ${row.pay}, second redeemer ${other.status}`)

  // The T-Pay twin: the first attempt is declined (status 2), the sweeper
  // returns the use, the second attempt is captured (status 1).
  await rig.sql(`insert into discounts (kind, code, label, type, value, usage_limit, active) values ('code', 'LATE2', 'Late 2', 'percent', 10, 1, 1)`)
  const o2 = await makeOrder({ method: 'tpay', items: [{ slug: acc, qty: 1 }], code: 'LATE2' })
  const tx2 = (status, n) => ({ Status: status, PayId: o2.track, TrackId: `GWL${n}`, PaymentId: `66000${n}`, Amount: o2.fmt, ReferenceId: `RL${n}` })
  await rig.cbkCallback(tx2('2', 1))
  await rig.phpCli('cron-stock.php', ['--release'])
  const used2 = await rig.num("select used_count from discounts where code = 'LATE2'")
  await rig.cbkCallback(tx2('1', 2))
  const row2 = await orderRow(o2.track)
  const other2 = await rig.order({ track: track('LU'), items: [{ slug: acc, qty: 1 }], code: 'LATE2' })
  const spentTwice2 = row2.pay === 'paid' && used2 === 0 && other2.status === 200
  rate('single-use code spent twice by a late T-Pay capture', spentTwice2 ? 1 : 0, 1)
  is(!spentTwice2, 'same on the T-Pay return', `order ${row2.pay}, use returned ${used2 === 0}, second redeemer ${other2.status}`)
})

// =====================================================================================
section('callback-lockwait', 'REAL  a bank callback that meets a lock-wait timeout files a captured payment as "review" and leaves the order pending', async () => {
  await reset()
  const o = await makeOrder()
  await rig.sql('set global innodb_lock_wait_timeout = 3')
  const hold = await rig.holdLock(`select id from orders where track_id = '${o.track}' for update`, 4.5)
  const t0 = Date.now()
  const cb = await rig.knetCallback({ trackid: o.track, result: 'CAPTURED', amt: o.fmt, paymentid: '321000111222' })
  const took = Date.now() - t0
  await hold.done
  await rig.sql('set global innodb_lock_wait_timeout = 20')
  const row = await orderRow(o.track)
  rate('capture met a held order row', row.pay === 'paid' ? 0 : 1, 1)
  is(row.pay === 'paid', 'the capture is recorded once the lock clears (bounded retry)', `${statusOf(cb.location)} / ${row.pay} after ${took} ms`)
  is(took < 20000, 'and the retry is bounded', `${took} ms`)
  // T-Pay twin
  const o2 = await makeOrder({ method: 'tpay' })
  await rig.sql('set global innodb_lock_wait_timeout = 3')
  const hold2 = await rig.holdLock(`select id from orders where track_id = '${o2.track}' for update`, 4.5)
  const cb2 = await rig.cbkCallback({ Status: '1', PayId: o2.track, TrackId: 'GW1', PaymentId: '777000111222', Amount: o2.fmt, ReferenceId: 'R1' })
  await hold2.done
  await rig.sql('set global innodb_lock_wait_timeout = 20')
  const row2 = await orderRow(o2.track)
  rate('T-Pay capture met a held order row', row2.pay === 'paid' ? 0 : 1, 1)
  is(row2.pay === 'paid', 'the T-Pay capture is recorded once the lock clears', `${statusOf(cb2.location)} / ${row2.pay}`)
})

// =====================================================================================
section('tpay-callback', 'HANDLED  the T-Pay return many times at once, and a capture racing a decline', async () => {
  await reset()
  let wrong = 0
  const N = rounds(6)
  for (let r = 0; r < N; r++) {
    const o = await makeOrder({ method: 'tpay' })
    const tx = (status) => ({ Status: status, PayId: o.track, TrackId: 'GW' + r, PaymentId: '600' + r, Amount: o.fmt, ReferenceId: 'R' + r })
    const calls = []
    for (let i = 0; i < 4; i++) { calls.push(rig.cbkCallback(tx('1'))); calls.push(rig.cbkCallback(tx('2'))) }
    await Promise.all(calls)
    const row = await orderRow(o.track)
    const last = await rig.one(`select json_value(payload, '$.payment_status') from fulfilment_outbox where order_id = ${o.id} and kind = 'payment' order by id desc limit 1`)
    const rows = await payRows(o.id)
    if (!(row.pay === 'paid' && last === 'paid' && rows >= 1 && rows <= 2)) wrong++
  }
  rate('T-Pay capture vs decline: not (paid + ship last)', wrong, N)
  is(wrong === 0, 'ends paid, the last warehouse message says paid, at most one "do not ship" before it')
})

// =====================================================================================
section('crons', 'HANDLED  the mail drain and the stock sweeper started several times at once (advisory lock; row lock + released flags)', async () => {
  // --- cron-fulfilment: 10 queued messages, a slow relay, 4 runs at once ---
  await reset()
  for (let i = 0; i < 10; i++) await makeOrder({ method: 'cod', items: [line(JACKET, 'M')], ip: rig.freshIp() })
  rig.mailClear(); rig.mailSlow(0.3)
  const outs = await Promise.all([0, 1, 2, 3].map(() => rig.phpCli('cron-fulfilment.php', ['--run'])))
  rig.mailSlow(0)
  const parsed = outs.map((o) => { try { return JSON.parse(o.trim().split('\n').pop()) } catch { return {} } })
  const sent = parsed.reduce((a, p) => a + (p.sent ?? 0), 0)
  const busy = parsed.filter((p) => p.busy).length
  const queued = await rig.num("select count(*) from fulfilment_outbox where kind = 'new'")
  const mails = rig.mailCount()
  console.log(`     4 drains: sent ${parsed.map((p) => p.sent ?? 0)} busy ${busy}; queued ${queued}; mails recorded ${mails}`)
  is(mails === sent && mails <= queued, 'no message is mailed twice by overlapping drains', `${mails} mails for ${queued} queued`)
  is(busy >= 1, 'a drain that finds another running says so and does nothing', `${busy} of 4 were busy`)
  const multi = await rig.num('select count(*) from (select order_id from fulfilment_outbox where kind = \'new\' and sent_at is not null group by order_id having count(*) > 1) x')
  is(multi === 0, 'one picking list per order')

  // --- cron-stock: 20 cancelled/failed orders, 4 sweepers at once ---
  await reset()
  const dead = []
  for (let i = 0; i < 12; i++) dead.push(await makeOrder({ method: 'knet', items: [line(JACKET, 'M', 2)] }))
  for (let i = 0; i < 8; i++) dead.push(await makeOrder({ method: 'cod', items: [line(LEG, 'M', 1)] }))
  await rig.sql("update orders set payment_status = 'failed' where payment_method = 'knet'")
  await rig.sql("update orders set created_at = now() - interval 30 hour where payment_method = 'cod'")
  const sweeps = await Promise.all([0, 1, 2, 3].map(() => rig.phpCli('cron-stock.php', ['--release'])))
  void sweeps
  const sa = await stockOf(JACKET), sb = await stockOf(LEG)
  const cancels = await rig.num("select count(*) from fulfilment_outbox where kind = 'cancel'")
  const released = await rig.num('select count(*) from orders where stock_released = 1')
  is(sa === 1000 && sb === 1000, 'garments are put back exactly once however many sweepers run', `${sa}/${sb}`)
  is(released === 20 && cancels === 8, 'every order released once; one "do not ship" per cancelled cash order', `released ${released}, cancels ${cancels}`)
})

// =====================================================================================
section('cod-paid', 'HANDLED  "cash collected" double click, and collected racing cancel (order row lock + status checks)', async () => {
  const signed = await rig.adminSignIn()
  is(signed, 'admin signed in')
  await reset()
  let wrong = 0
  const N = rounds(8)
  // 150 ms inside the UPDATE of the order row: the first click holds the row
  // long enough for the others to have read "pending" if nothing stopped them.
  await widen('orders', 150)
  // (a) one admin, one browser, six clicks: PHP serialises requests that share a session.
  for (let r = 0; r < Math.max(2, N >> 2); r++) {
    const o = await makeOrder({ method: 'cod', items: [line(JACKET, 'M')] })
    const res = await rig.burst(6, () => rig.admin('cod_paid', { method: 'POST', body: { order_id: o.id, paid: true } }))
    if (!(res.filter((x) => x.status === 200).length === 1 && (await payRows(o.id)) === 1)) wrong++
  }
  is(wrong === 0, 'six clicks from one browser settle the order once (and the session lock keeps them in line)')
  // (b) six sessions (two admins, or one on a phone and a laptop): only the row lock is left.
  const jar = await rig.adminSessions(6)
  is(jar.length === 6, 'six independent admin sessions', `${jar.length}`)
  wrong = 0
  for (let r = 0; r < N; r++) {
    const o = await makeOrder({ method: 'cod', items: [line(JACKET, 'M')] })
    const res = await Promise.all(jar.map((c) => rig.admin('cod_paid', { method: 'POST', body: { order_id: o.id, paid: true }, cookie: c })))
    const okc = res.filter((x) => x.status === 200).length
    if (!(okc === 1 && (await payRows(o.id)) === 1)) wrong++
  }
  rate('cash collected from six sessions: not exactly one settle', wrong, N)
  is(wrong === 0, 'six sessions clicking at once settle the order once and queue one "payment" message')
  wrong = 0
  const outcomes = {}
  for (let r = 0; r < N; r++) {
    const o = await makeOrder({ method: 'cod', items: [line(JACKET, 'M')] })
    const collect = () => rig.admin('cod_paid', { method: 'POST', body: { order_id: o.id, paid: true }, cookie: jar[0] })
    const cancel = () => rig.admin('fulfilment', { method: 'POST', body: { order_id: o.id, status: 'cancelled' }, cookie: jar[1] })
    // Who goes first alternates, and the second is started 60 ms in: inside
    // the first one's widened UPDATE.
    await Promise.all(r % 2 ? [collect(), sleep(60).then(cancel)] : [cancel(), sleep(60).then(collect)])
    const row = await orderRow(o.track)
    outcomes[`${row.pay}/${row.ful}`] = (outcomes[`${row.pay}/${row.ful}`] || 0) + 1
    if (row.pay === 'paid' && row.ful === 'cancelled') wrong++
  }
  await unwiden('orders')
  rate('collected vs cancel: paid AND cancelled', wrong, N)
  console.log(`     outcomes: ${JSON.stringify(outcomes)}`)
  is(wrong === 0, 'a cash order is never both collected and cancelled')
  is(Object.keys(outcomes).length >= 2, 'the offsets reach both orders of events', Object.keys(outcomes).join(' | '))
})

// =====================================================================================
section('cod-sweep', 'HANDLED  the 24 h cash-order sweep racing "cash collected" and "packed" on the same order (one row lock, state re-read under it)', async () => {
  const signed = await rig.adminSignIn()
  is(signed, 'admin signed in')
  await reset()
  await widen('orders', 200)
  let wrong = 0
  const outcomes = {}
  const N = rounds(16)
  // A CLI sweeper takes ~150 ms to start, an admin request ~20 ms: when the sweeper goes first the admin
  // must wait a few hundred ms to land inside its widened UPDATE.
  const offsets = [0, 250, 450, 700]
  for (let r = 0; r < N; r++) {
    const o = await makeOrder({ method: 'cod', items: [line(JACKET, 'L', 1)] })
    await rig.sql(`update orders set created_at = now() - interval 30 hour where id = ${o.id}`)
    const admin = () => (r % 2 === 0
      ? rig.admin('cod_paid', { method: 'POST', body: { order_id: o.id, paid: true } })
      : rig.admin('fulfilment', { method: 'POST', body: { order_id: o.id, status: 'packed' } }))
    const sweep = () => rig.phpCli('cron-stock.php', ['--release'])
    const d = offsets[Math.floor(r / 2) % offsets.length]
    await Promise.all(Math.floor(r / 8) % 2 === 0 ? [sweep(), sleep(d).then(admin)] : [admin(), sleep(d).then(sweep)])
    const row = await orderRow(o.track)
    const stock = await stockOf(JACKET, 'L')
    const held = await rig.num(`select ifnull(sum(oi.qty),0) from orders o2 join order_items oi on oi.order_id = o2.id where o2.id <> ${row.id} and o2.fulfilment_status <> 'cancelled' and o2.stock_released = 0`)
    const key = `${r % 2 === 0 ? 'collected' : 'packed'}->${row.pay}/${row.ful}${row.released ? '/released' : ''}`
    outcomes[key] = (outcomes[key] || 0) + 1
    // Either the order stands (held, not released) or it was cancelled and its garment is back; never both, never paid+cancelled.
    const standing = row.ful !== 'cancelled'
    const consistent = !(row.pay === 'paid' && row.ful === 'cancelled')
      && (standing ? (!row.released && stock === 1000 - held - 1) : (row.released && stock === 1000 - held))
    if (!consistent) wrong++
  }
  await unwiden('orders')
  rate('cash sweep vs admin: inconsistent end state', wrong, N)
  console.log(`     outcomes: ${JSON.stringify(outcomes)}`)
  is(wrong === 0, 'the order ends standing with its garment held, or cancelled with it back; never paid-and-cancelled')
  is(Object.keys(outcomes).length >= 3, 'the offsets reach both orders of events', Object.keys(outcomes).join(' | '))
})

// =====================================================================================
section('returns-claim', 'HANDLED  sixteen return requests for the same two pieces at once (the parent order row is locked around the remaining-quantity read)', async () => {
  await reset()
  let wrong = 0
  const N = rounds(4)
  // 150 ms before the request row is inserted: every contender has read the
  // remaining quantity by then, unless the order row stops them.
  await rig.sql('drop trigger if exists race_widen_returns; create trigger race_widen_returns before insert on return_requests for each row do sleep(0.15)')
  for (let r = 0; r < N; r++) {
    const phone = rig.freshPhone()
    const o = await makeOrder({ items: [line(JACKET, 'L', 2)], phone })
    await rig.sql(`update orders set fulfilment_status = 'delivered', payment_status = 'paid', fulfilled_at = now() where id = ${o.id}`)
    const itemId = await rig.num(`select id from order_items where order_id = ${o.id} limit 1`)
    const res = await rig.burst(16, () => fetch(`${rig.SITE}/api/api.php?r=return_submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Customer': '1', 'X-Forwarded-For': rig.freshIp() },
      body: JSON.stringify({ track_id: o.track, phone, items: [{ order_item_id: itemId, qty: 2, action: 'return', reason: 'size' }], note: '' }),
    }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) })))
    const created = res.filter((x) => x.status === 201).length
    const reserved = await rig.num(`select ifnull(sum(ri.qty), 0) from return_request_items ri join return_requests rr on rr.id = ri.request_id where rr.order_id = ${o.id}`)
    if (!(created === 1 && reserved === 2)) wrong++
  }
  await rig.sql('drop trigger if exists race_widen_returns')
  rate('returns: more than the purchased quantity reserved', wrong, N)
  is(wrong === 0, 'exactly one request is created; the other fifteen are refused (quantity_exceeded) and reserve nothing')
})

// =====================================================================================
section('admin-stock', 'HANDLED / REAL(client)  stock edits against checkout claims: versioned edits conflict, the legacy unversioned save overwrites', async () => {
  await reset()
  const signed = await rig.adminSignIn()
  is(signed, 'admin signed in')
  const sku = await rig.one(`select sku from product_variants where slug = '${JACKET}' and size = 'M'`)
  const v0 = await verOf(JACKET)
  // 32 checkouts and an admin count with the version it loaded: the count is
  // either applied (before any order) or refused as a conflict, never a silent
  // overwrite of claimed pieces.
  const [adj, ...orders] = await Promise.all([
    rig.admin('inventory_adjust', { method: 'POST', body: { sku, type: 'count', target_stock: 500, expected_version: v0, note: 'race count' } }),
    ...Array.from({ length: 16 }, (_, i) => rig.order({ track: track(`A${i}`), items: [line(JACKET, 'M')] })),
  ])
  const okOrders = orders.filter((x) => x.status === 200).length
  const stock = await stockOf(JACKET)
  const consistent = adj.status === 409 ? stock === 1000 - okOrders
    : adj.status === 200 ? stock <= 500 && stock >= 500 - okOrders
      : false
  is(consistent, 'a versioned count is applied or refused as a conflict, never a silent overwrite of claimed pieces',
    `adjust ${adj.status} ${adj.body?.error ?? ''}, orders ${okOrders}, stock ${stock}`)
  // The legacy route has no version in the live admin client: this is the lost update.
  await reset()
  const loaded = await stockOf(JACKET)        // the admin screen shows 1000
  await rig.order({ track: track('LU'), items: [line(JACKET, 'M', 2)] })   // a customer claims 2
  const legacy = await rig.admin('set_stock', { method: 'POST', body: { sku, stock: loaded } }) // the admin saves what it showed
  const after = await stockOf(JACKET)
  console.log(`     screen showed ${loaded}; a customer claimed 2; the unversioned save wrote ${loaded}; stock is now ${after} (${legacy.status})`)
  const versioned = await rig.admin('set_stock', { method: 'POST', body: { sku, stock: loaded, expected_version: 0 } })
  is(versioned.status === 409, 'the same save WITH expected_version is refused as a conflict', `${versioned.status} ${versioned.body?.error ?? ''}`)
  rate('legacy unversioned save overwrote a claim (client sends no expected_version)', after === loaded ? 1 : 0, 1)
})

// =====================================================================================
section('pay-attempt', 'HANDLED  sixteen starts of the bank page for one order get distinct attempt references and stop at the ceiling', async () => {
  await reset()
  const o = await makeOrder()
  const res = await rig.burst(16, () => fetch(`${rig.SITE}/knet/pay.php?trackid=${o.track}`, { headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': rig.freshIp() }, redirect: 'manual' }))
  const codes = res.map((x) => x.status)
  const attempts = await rig.num(`select pay_attempt from orders where track_id = '${o.track}'`)
  const redirects = codes.filter((c) => c === 302).length
  is(redirects === 10 && attempts === 10, 'exactly ten starts reach the bank, the rest are refused, the counter stops at ten', `302 x${redirects}, refused x${codes.length - redirects}, pay_attempt ${attempts}`)
})

// =====================================================================================
section('a2-resolver', 'REAL  an order literally named <id>A2 is settled by the retry of order <id> (exact match tried before the bank-signed hint)', async () => {
  await reset()
  const victim = await makeOrder({ items: [line(JACKET, 'M')] })
  const squat = { track: `${victim.track}A2` }
  const r = await rig.order({ track: squat.track, items: [line(JACKET, 'M')] })
  is(r.status === 200, 'an order with the retry-shaped id is placeable', `${r.status}`)
  // Same total: the amount check cannot tell them apart.
  is(Number(r.body?.amount) === Number(victim.amount), 'and it has the same total as the victim', `${r.body?.amount} vs ${victim.amount}`)
  // The victim starts a second attempt; the bank returns the attempt reference
  // XA2 with udf5 = X, exactly as pay.php sends it.
  const cb = await rig.knetCallback({ trackid: squat.track, udf5: victim.track, result: 'CAPTURED', amt: victim.fmt, paymentid: '121000111222' })
  const v = await orderRow(victim.track), s = await orderRow(squat.track)
  console.log(`     callback ${statusOf(cb.location)}; victim ${v.pay}; squatter ${s.pay}`)
  rate('retry settled somebody else\'s order', s.pay === 'paid' ? 1 : 0, 1)
  is(v.pay === 'paid' && s.pay === 'pending', 'the order the bank-signed udf5 names is the one settled; the look-alike stays pending')
  // The T-Pay twin.
  const v2 = await makeOrder({ method: 'tpay' })
  const sq2 = `${v2.track}A2`
  await rig.order({ track: sq2, items: [line(JACKET, 'L')], method: 'tpay' })
  await rig.cbkCallback({ Status: '1', PayId: sq2, MerchUdf5: v2.track, TrackId: 'GWX', PaymentId: '131000111222', Amount: v2.fmt, ReferenceId: 'R9' })
  const v3 = await orderRow(v2.track), s3 = await orderRow(sq2)
  is(v3.pay === 'paid' && s3.pay === 'pending', 'same on the T-Pay return (MerchUdf5)', `${v3.pay} / ${s3.pay}`)
  // Attempt one and a retry whose reference is just the id still resolve.
  const plain = await makeOrder()
  const cp = await rig.knetCallback({ trackid: plain.track, udf5: plain.track, result: 'CAPTURED', amt: plain.fmt, paymentid: '141000111222' })
  is((await orderRow(plain.track)).pay === 'paid', 'attempt one (reference = id) still settles its own order', statusOf(cp.location))
  const legacy = await makeOrder()
  const cl = await rig.knetCallback({ trackid: `${legacy.track}A3`, udf5: '', result: 'CAPTURED', amt: legacy.fmt, paymentid: '151000111222' })
  is((await orderRow(legacy.track)).pay === 'paid', 'a retry reference with no udf5 (sent before udf5 existed) still strips to its order', statusOf(cl.location))
  // A 30-character id is trimmed to make room for the suffix; only udf5 can find it again.
  const long = `LONG${Date.now().toString(36).toUpperCase()}${'X'.repeat(30)}`.slice(0, 30)
  const lr = await rig.order({ track: long, items: [line(JACKET, 'M')] })
  const trimmed = `${long.slice(0, 28)}A2`
  const lc = await rig.knetCallback({ trackid: trimmed, udf5: long, result: 'CAPTURED', amt: Number(lr.body?.amount).toFixed(3), paymentid: '161000111222' })
  is(lr.status === 200 && (await orderRow(long)).pay === 'paid', 'a 30-character id, trimmed to fit its attempt suffix, is found again by udf5', statusOf(lc.location))
  const longT = `LNGT${Date.now().toString(36).toUpperCase()}${'Y'.repeat(30)}`.slice(0, 30)
  const lt = await rig.order({ track: longT, items: [line(JACKET, 'M')], method: 'tpay' })
  await rig.cbkCallback({ Status: '1', PayId: `${longT.slice(0, 28)}A2`, MerchUdf5: longT, TrackId: 'GWLONG', PaymentId: '171000111222', Amount: Number(lt.body?.amount).toFixed(3), ReferenceId: 'RLONG' })
  is(lt.status === 200 && (await orderRow(longT)).pay === 'paid', 'same on the T-Pay return')
})

// =====================================================================================
const chosen = sections.filter((s) => ONLY.length === 0 || ONLY.includes(s.id))
const t0 = Date.now()
for (const s of chosen) {
  head(`${s.id} - ${s.title}`)
  const t1 = Date.now()
  try {
    await s.fn()
  } catch (e) {
    bad(`${s.id} threw`, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  }
  console.log(`     (${((Date.now() - t1) / 1000).toFixed(1)} s)`)
}
const errs = rig.phpErrors().split('\n').filter((l) => /Fatal|Parse error|Uncaught/.test(l))
if (errs.length) console.log(`\nnote: PHP fatal lines in the private error log: ${errs.length}\n  ${errs.slice(0, 3).join('\n  ')}`)
console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`} — ${passes} passed, ${fails} failed in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
rig.stop()
process.exit(fails === 0 ? 0 : 1)
