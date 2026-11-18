// The XBRL financial statements export (dropin/php-store/xbrl.php, admin.php?r=xbrl_export).
//
//   npm run test:xbrl     (needs the sandbox: `npm run sandbox`)
//
// The figures are checked against the same numbers computed directly in SQL, not against the PHP. Also: the XML is
// well formed (PHP's DOM parser), its facts match the JSON, the signed-out and bad-period requests are refused, and
// each export is logged.
import { execFileSync } from 'node:child_process'

const ADMIN = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8095/admin.php'
const EMAIL = 'qa-admin@sporta.test', PASSWORD = 'correct-horse-battery-kw'
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const sql = (q) => execFileSync('mariadb', ['sporta', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

async function call(route, { method = 'GET', body, cookies = [] } = {}) {
  const headers = { 'X-Sporta-Admin': '1' }
  if (body) headers['Content-Type'] = 'application/json'
  if (cookies.length) headers.Cookie = cookies.join('; ')
  const res = await fetch(`${ADMIN}?r=${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, type: res.headers.get('content-type') ?? '', text, json }
}

sql('delete from rate_limit')
// the session cookie from the login response
const loginRes = await fetch(`${ADMIN}?r=login`, { method: 'POST', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
const cookie = (loginRes.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sporta_admin='))?.split(';')[0]
const cookies = cookie ? [cookie] : []

const FROM = '2026-01-01', TO = '2026-12-31'   // one year: the route refuses longer periods
// The shop's days are Kuwait's (UTC+3): a period is [FROM 00:00, TO + 1 day 00:00) there, which is three hours earlier in the database's UTC.
const lo = (d) => `date_sub('${d}', interval 3 hour)`, hi = (d) => `date_sub(date_add('${d}', interval 1 day), interval 3 hour)`
const inPeriod = (col, f, t) => `${col} >= ${lo(f)} and ${col} < ${hi(t)}`
const PAID_STATES = "('paid','refunded','voided')"   // an order paid in the period stays in it whatever became of it afterwards

head('refusals')
const anon = await call(`xbrl_export&from=${FROM}&to=${TO}`)
is(anon.status === 401 || anon.status === 403, 'without a session the export is refused', String(anon.status))
const backwards = await call(`xbrl_export&from=${TO}&to=${FROM}`, { cookies })
is(backwards.status === 400 && backwards.json?.error === 'invalid_period', 'a period that ends before it starts is refused', `${backwards.status} ${backwards.json?.error}`)
const long = await call('xbrl_export&from=2020-01-01&to=2023-01-01', { cookies })
is(long.status === 400, 'a period longer than a year is refused', String(long.status))
const bad = await call('xbrl_export&from=2020-02-30&to=2020-03-01', { cookies })
is(bad.status === 400, 'an impossible date is refused', String(bad.status))

head('the figures agree with SQL')
const j = await call(`xbrl_export&from=${FROM}&to=${TO}&format=json`, { cookies })
is(j.status === 200 && j.json && typeof j.json.Revenue === 'number', 'the JSON figures come back', `${j.status}`)
const paid = Number(sql(`select count(*) from orders where payment_status in ${PAID_STATES} and ${inPeriod('paid_at', FROM, TO)}`))
const revenue = Number(sql(`select coalesce(sum(subtotal-discount_amount),0) from orders where payment_status in ${PAID_STATES} and ${inPeriod('paid_at', FROM, TO)}`))
const cost = Number(sql(`select coalesce(sum(oi.qty*pv.unit_cost_kwd),0) from orders o join order_items oi on oi.order_id=o.id join products p on p.id=oi.product_id left join product_variants pv on pv.slug=p.slug and pv.size=oi.size where o.payment_status in ${PAID_STATES} and ${inPeriod('o.paid_at', FROM, TO)} and pv.unit_cost_kwd is not null`))
const missing = Number(sql(`select count(*) from orders o join order_items oi on oi.order_id=o.id join products p on p.id=oi.product_id left join product_variants pv on pv.slug=p.slug and pv.size=oi.size where o.payment_status in ${PAID_STATES} and ${inPeriod('o.paid_at', FROM, TO)} and pv.unit_cost_kwd is null`))
const inv = Number(sql(`select coalesce(sum(stock*unit_cost_kwd),0) from product_variants where unit_cost_kwd is not null`))
is(j.json?.PaidOrders === paid, 'the paid-order count matches SQL', `${j.json?.PaidOrders} vs ${paid}`)
is(Math.abs(j.json?.Revenue - revenue) < 0.0005, 'Revenue matches SQL (subtotal minus discount)', `${j.json?.Revenue} vs ${revenue}`)
is(Math.abs(j.json?.CostOfSales - cost) < 0.0005, 'CostOfSales matches SQL (qty x unit cost, costed lines only)', `${j.json?.CostOfSales} vs ${cost}`)
is(j.json?.CostMissingLines === missing, 'uncosted lines are counted, not guessed', `${j.json?.CostMissingLines} vs ${missing}`)
is(Math.abs(j.json?.Inventories - inv) < 0.0005, 'Inventories matches SQL (stock x cost)', `${j.json?.Inventories} vs ${inv}`)
is(Math.abs(j.json?.GrossProfit - (j.json.Revenue - j.json.CostOfSales)) < 0.0005, 'GrossProfit = Revenue - CostOfSales')
is(Math.abs(j.json?.ProfitLoss - (j.json.GrossProfit + j.json.OtherIncome - j.json.Expenses)) < 0.0005, 'ProfitLoss = GrossProfit + OtherIncome - Expenses')

head('the accounting rules, on orders made for it (ACCOUNTING-SCAN-2026-11-18)')
{
  // A variant of the shop whose cost is set for the test and put back after: 2.500 KWD a piece.
  const v = sql(`select p.id, pv.slug, pv.size, coalesce(pv.unit_cost_kwd, 'NULL') from product_variants pv join products p on p.slug = pv.slug limit 1`).split('\t')
  const [pid, slug, size, oldCost] = v
  const clean = () => { sql(`delete from orders where track_id like 'XBRLFIX%'`); if (slug) sql(`update product_variants set unit_cost_kwd = ${oldCost === 'NULL' ? 'NULL' : oldCost} where slug = '${slug}' and size = '${size}'`) }
  clean()
  sql(`update product_variants set unit_cost_kwd = 2.500 where slug = '${slug}' and size = '${size}'`)
  const order = (n, o) => {
    // paid: null = never confirmed (a payment refunded from 'review' has no paid_at); released: 1 = the garments went back on the shelf
    sql(`insert into orders (track_id, customer_name, customer_phone, amount, subtotal, discount_amount, delivery_fee, payment_method, payment_status, paid_at, stock_released)
         values ('XBRLFIX${n}', 'xbrl fixture', '96550000000', ${o.amount}, ${o.sub}, ${o.disc ?? 0}, ${o.fee ?? 0}, 'knet', '${o.status ?? 'paid'}', ${o.paid === null ? 'NULL' : `'${o.paid}'`}, ${o.released ?? 0})`)
    if (o.qty) sql(`insert into order_items (order_id, product_id, qty, unit_price, size) select id, ${pid}, ${o.qty}, 1, '${size}' from orders where track_id = 'XBRLFIX${n}'`)
    for (const [i, r] of (o.refunds ?? []).entries()) {
      sql(`insert into order_refunds (order_id, kind, amount, scope, payment_id, request_key, actor_email, created_at)
           select id, '${r.kind ?? 'refund'}', ${r.amount}, '${r.scope ?? 'order'}', 'PID-XBRLFIX${n}', md5('xbrlfix${n}-${i}'), 'qa-admin@sporta.test', '${r.at}' from orders where track_id = 'XBRLFIX${n}'`)
    }
  }
  try {
    // O1 was paid at 00:30 on 1 March in Kuwait (21:30 UTC on 28 Feb): it is March's. O2 at 00:30 on 1 April in Kuwait (21:30 UTC on 31 Mar): April's.
    order(1, { paid: '2031-02-28 21:30:00', sub: 20, fee: 2, amount: 22, qty: 2 })
    order(2, { paid: '2031-03-31 21:30:00', sub: 100, fee: 5, amount: 105 })
    // O3 was refunded in full in March: sale and refund both in March, the goods went back (cost reversed).
    order(3, { paid: '2031-03-10 10:00:00', sub: 30, disc: 5, fee: 3, amount: 28, qty: 1, status: 'refunded', released: 1, refunds: [{ amount: 28, at: '2031-03-20 10:00:00' }] })
    // O4 was paid in February and partly refunded in March: the refund is March's, the sale is not.
    order(4, { paid: '2031-02-10 10:00:00', sub: 40, amount: 40, refunds: [{ amount: 12, at: '2031-03-05 09:00:00' }] })
    // O5 does not add up: parts 12.000, total 15.000.
    order(5, { paid: '2031-03-15 12:00:00', sub: 10, fee: 2, amount: 15 })
    const mar = (await call('xbrl_export&from=2031-03-01&to=2031-03-31&format=json', { cookies })).json
    const apr = (await call('xbrl_export&from=2031-04-01&to=2031-04-30&format=json', { cookies })).json
    const feb = (await call('xbrl_export&from=2031-02-01&to=2031-02-28&format=json', { cookies })).json
    const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.0005
    is(mar?.PaidOrders === 3, 'A1 March (Kuwait days) holds the three orders paid in it, including the one paid at 00:30 on 1 March (21:30 UTC on 28 Feb) and not the one at 00:30 on 1 April', JSON.stringify(mar?.PaidOrders))
    is(apr?.PaidOrders === 1 && near(apr?.Revenue, 100) && near(apr?.OtherIncome, 5), 'A1 April holds the order paid at 00:30 on 1 April (21:30 UTC on 31 March): revenue 100, delivery 5', JSON.stringify([apr?.PaidOrders, apr?.Revenue, apr?.OtherIncome]))
    is(near(mar?.Revenue, 18), 'A3 March revenue 18.000 = O1 20 + O3 (25 sold, 25 refunded) + O5 10 - the 12 of O4 refunded in March', String(mar?.Revenue))
    is(near(mar?.OtherIncome, 4), 'A3 March delivery 4.000 = O1 2 + O3 (3 collected, 3 refunded) + O5 2', String(mar?.OtherIncome))
    is(near(mar?.RefundsRecorded, 40), 'refunds recorded in March: 28 (O3) + 12 (O4, a February order)', String(mar?.RefundsRecorded))
    is(near(feb?.Revenue, 40) && near(feb?.RefundsRecorded, 0), 'A3 February still reports O4 at 40.000: a refund made in March does not change a period already reported', JSON.stringify([feb?.Revenue, feb?.RefundsRecorded]))
    is(near(mar?.CostOfSales, 5) && near(mar?.CostReversed, 2.5), 'A4 March cost 5.000 = O1 2 x 2.500 + O3 1 x 2.500 sold and 2.500 reversed (O3 ended refunded: its garment went back to stock); O4 partial refund reverses nothing', JSON.stringify([mar?.CostOfSales, mar?.CostReversed]))
    is(near(mar?.AmountReceived, 65) && near(mar?.ReconciliationDifference, 3), 'A7 received 65.000 less refunds 40.000 against revenue + delivery 22.000 leaves 3.000: the order that does not add up (O5) is shown, not hidden', JSON.stringify([mar?.AmountReceived, mar?.ReconciliationDifference]))
    is(near(apr?.ReconciliationDifference, 0) && near(feb?.ReconciliationDifference, 0 - 0), 'A7 a month whose orders all add up reconciles to 0.000', JSON.stringify([apr?.ReconciliationDifference, feb?.ReconciliationDifference]))
    // THE LIVE STATE. The live database has no `order_refunds` (refunds.mysql.sql is not applied there: read-only schema diff of 2026-11-18, exit 1,
    // "table missing order_refunds"), so a release of this file lands on a database without the table. Hide it and build March again: the export
    // must still answer 200 with every figure that does not depend on a refund, the refund figures at zero, and nothing reversed.
    {
      const there = () => sql(`select count(*) from information_schema.tables where table_schema = database() and table_name = 'order_refunds'`) === '1'
      const held = () => sql(`select count(*) from information_schema.tables where table_schema = database() and table_name = 'order_refunds_xbrlhold'`) === '1'
      if (!there() && held()) sql('rename table order_refunds_xbrlhold to order_refunds')   // a run that stopped half way
      sql('rename table order_refunds to order_refunds_xbrlhold')
      try {
        const live = await call('xbrl_export&from=2031-03-01&to=2031-03-31&format=json', { cookies })
        const m = live.json
        is(live.status === 200 && m && typeof m.Revenue === 'number', 'LIVE STATE the export answers 200 when order_refunds does not exist (the live database today)', `${live.status} ${live.text.slice(0, 120)}`)
        is(near(m?.Revenue, 55) && near(m?.OtherIncome, 7) && m?.PaidOrders === 3, 'LIVE STATE March without the refunds table: revenue 55.000 (O1 20 + O3 25 + O5 10), delivery 7.000, three orders', JSON.stringify([m?.Revenue, m?.OtherIncome, m?.PaidOrders]))
        is(near(m?.RefundsRecorded, 0) && near(m?.CostReversed, 0) && near(m?.CostOfSales, 7.5), 'LIVE STATE no refunds recorded, nothing reversed, cost 7.500 (3 pieces x 2.500)', JSON.stringify([m?.RefundsRecorded, m?.CostReversed, m?.CostOfSales]))
        is(near(m?.AmountReceived, 65) && near(m?.ReconciliationDifference, 3), 'LIVE STATE the reconciliation still shows the order that does not add up (3.000)', JSON.stringify([m?.AmountReceived, m?.ReconciliationDifference]))
        const xmlLive = await call('xbrl_export&from=2031-03-01&to=2031-03-31', { cookies })
        is(xmlLive.status === 200 && xmlLive.type.startsWith('application/xml'), 'LIVE STATE the XML export answers too', `${xmlLive.status} ${xmlLive.type}`)
      } finally { if (!there() && held()) sql('rename table order_refunds_xbrlhold to order_refunds') }
      is(there(), 'LIVE STATE the refunds table is back for the checks that follow')
    }
    // THE INDEPENDENT REVIEW (2026-11-18): the cases the first fixtures did not hold. Hand-computed, June and July 2031 (Kuwait days: June is
    // [31 May 21:00, 30 Jun 21:00) UTC). Every order costs 2.500 a piece.
    //  P1 paid 20:59:59 on 30 Jun UTC (23:59:59 Kuwait): the last second of June.        sub 10                       -> June
    //  P2 paid 21:00:00 on 30 Jun UTC (00:00:00 Kuwait, 1 July): the first second of July. sub 20                    -> July
    //  P3 sub 10 + fee 2, refunded in three parts: 4 in June, then 4 + 4 in July (the last closes it, garment back).
    //  P4 sub 30, partly refunded: 5 at 20:59:59 on 30 Jun (June) and 7 at 21:00:00 (July). It stays paid.
    //  P5 voided: sub 10, refunded 10 in June, garment back.   P6 never paid (no paid_at), refunded 12 in July from 'review'.
    //  P7 sub 10 + fee 2 with a DUPLICATE-scope refund of 12 (a second capture returned): the order stays paid, nothing changes.
    //  P8 sub 10 refunded 10 in June but already shipped (stock not released): the sale and the refund net to 0 and the cost STAYS.
    //  P9 sub 10 with a real refund of 3 AND a duplicate-scope refund of 10 in June: only the 3 comes off (the two scopes live in one order).
    order(11, { paid: '2031-06-30 20:59:59', sub: 10, amount: 10 })
    order(12, { paid: '2031-06-30 21:00:00', sub: 20, amount: 20 })
    order(13, { paid: '2031-06-10 10:00:00', sub: 10, fee: 2, amount: 12, qty: 1, status: 'refunded', released: 1, refunds: [{ amount: 4, at: '2031-06-12 10:00:00' }, { amount: 4, at: '2031-07-02 10:00:00' }, { amount: 4, at: '2031-07-03 10:00:00' }] })
    order(14, { paid: '2031-06-15 10:00:00', sub: 30, amount: 30, refunds: [{ amount: 5, at: '2031-06-30 20:59:59' }, { amount: 7, at: '2031-06-30 21:00:00' }] })
    order(15, { paid: '2031-06-20 10:00:00', sub: 10, amount: 10, qty: 1, status: 'voided', released: 1, refunds: [{ kind: 'void', amount: 10, at: '2031-06-22 10:00:00' }] })
    order(16, { paid: null, sub: 10, fee: 2, amount: 12, qty: 1, status: 'refunded', released: 1, refunds: [{ amount: 12, at: '2031-07-10 10:00:00' }] })
    order(17, { paid: '2031-06-25 10:00:00', sub: 10, fee: 2, amount: 12, qty: 1, refunds: [{ amount: 12, scope: 'duplicate', at: '2031-06-26 10:00:00' }] })
    order(18, { paid: '2031-06-27 10:00:00', sub: 10, amount: 10, qty: 1, status: 'refunded', released: 0, refunds: [{ amount: 10, at: '2031-06-28 10:00:00' }] })
    order(19, { paid: '2031-06-05 10:00:00', sub: 10, amount: 10, refunds: [{ amount: 3, at: '2031-06-06 10:00:00' }, { amount: 10, scope: 'duplicate', at: '2031-06-07 10:00:00' }] })
    const jun = (await call('xbrl_export&from=2031-06-01&to=2031-06-30&format=json', { cookies })).json
    const jul = (await call('xbrl_export&from=2031-07-01&to=2031-07-31&format=json', { cookies })).json
    is(jun?.PaidOrders === 7 && jul?.PaidOrders === 1, 'R1 the last second of June (20:59:59 UTC) is June\'s and the first of July (21:00:00 UTC) is July\'s: seven orders paid in June, one in July, the never-paid one in neither', JSON.stringify([jun?.PaidOrders, jul?.PaidOrders]))
    is(near(jun?.Revenue, 58) && near(jun?.OtherIncome, 4), 'R2 June revenue 58.000 = P1 10 + P3 6 (10 less the 4 refunded) + P4 25 (30 less the 5 refunded at 20:59:59) + P5 0 + P7 10 (its duplicate refund takes nothing) + P8 0 + P9 7 (10 less the real 3, not the duplicate 10); delivery 4.000 = P3 2 + P7 2', JSON.stringify([jun?.Revenue, jun?.OtherIncome]))
    is(near(jul?.Revenue, 7) && near(jul?.OtherIncome, -2), 'R3 July revenue 7.000 = P2 20 - 6 (P3\'s second and third refunds take the last 6 of its goods) - 7 (P4\'s refund at 21:00:00); delivery -2.000 (P3\'s fee returned); the never-paid order\'s refund of 12 takes nothing', JSON.stringify([jul?.Revenue, jul?.OtherIncome]))
    is(near(jun?.RefundsRecorded, 32) && near(jul?.RefundsRecorded, 15), 'R4 refunds recorded: June 32 = 4 + 5 + 10 + 10 + 3 (not the duplicates, 12 and 10), July 15 = 4 + 4 + 7 (not the never-paid 12)', JSON.stringify([jun?.RefundsRecorded, jul?.RefundsRecorded]))
    is(near(jun?.CostOfSales, 7.5) && near(jun?.CostReversed, 2.5), 'R5 June cost 7.500 = four sold lines of 2.500 less the 2.500 of the voided order (P5) that went back; the shipped order (P8) keeps its cost; P3 is not closed in June', JSON.stringify([jun?.CostOfSales, jun?.CostReversed]))
    is(near(jul?.CostOfSales, -2.5) && near(jul?.CostReversed, 2.5), 'R6 July cost -2.500: P3\'s closing refund (the third) reverses its 2.500 once, in July', JSON.stringify([jul?.CostOfSales, jul?.CostReversed]))
    is(near(jun?.AmountReceived, 94) && near(jun?.ReconciliationDifference, 0) && near(jul?.AmountReceived, 20) && near(jul?.ReconciliationDifference, 0), 'R7 every month reconciles to 0.000 (June: received 94 less refunds 32 = 62 = revenue 58 + delivery 4; July: 20 less 15 = 5 = 7 - 2)', JSON.stringify([jun?.AmountReceived, jun?.ReconciliationDifference, jul?.AmountReceived, jul?.ReconciliationDifference]))
    is(jun?.RefundsRead === true, 'R8 the export says the refunds table was read', String(jun?.RefundsRead))
    // A database error that is NOT "the table is missing" must fail loudly, not give a report with the refunds silently left out.
    sql('alter table order_refunds change amount amount_held decimal(10,3) not null')
    try {
      const broken = await call('xbrl_export&from=2031-06-01&to=2031-06-30&format=json', { cookies })
      is(broken.status >= 500 && broken.json?.Revenue === undefined, 'R9 a refunds table that cannot be read (a changed column) fails the export instead of leaving the refunds out', `${broken.status} ${broken.text.slice(0, 100)}`)
    } finally { sql('alter table order_refunds change amount_held amount decimal(10,3) not null') }
    // money amounts the settings or the database could hold in a form other than "12.500"
    const fils = execFileSync('php', ['-r', 'require "dropin/php-store/xbrl.php"; echo json_encode(array_map("xbrl_fils", [".5", "+5", "1e3", "12.500", 12.5, -3.25, "-0.5", "abc", null, "", "7"]));'], { encoding: 'utf8' })
    is(fils === '[500,5000,1000000,12500,12500,-3250,-500,0,0,0,7000]', 'R10 xbrl_fils reads .5, +5 and 1e3 as numbers (not 0), and still reads the plain forms exactly', fils)
    // A6: sums are whole fils. 0.1 + 0.2 must print 0.300, and a long run of thirds must not drift.
    order(6, { paid: '2031-03-12 12:00:00', sub: 0.1, amount: 0.1 })
    order(7, { paid: '2031-03-12 12:00:00', sub: 0.2, amount: 0.2 })
    const mar2 = (await call('xbrl_export&from=2031-03-01&to=2031-03-31&format=json', { cookies })).json
    is(Math.round((mar2?.Revenue - mar?.Revenue) * 1000) === 300 && near(mar2?.ReconciliationDifference, 3), 'A6 money is added in whole fils: 0.100 + 0.200 add exactly 0.300 and the reconciliation stays 3.000 (a regression guard: the old float sum rounded to the same figure at these sizes, so no mutant can show it)', JSON.stringify([mar2?.Revenue, mar2?.ReconciliationDifference]))
    // A2: the stock figure says what day it is for
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)
    const past = (await call('xbrl_export&from=2025-01-01&to=2025-12-31&format=json', { cookies })).json
    is(mar?.InventoriesAsOf === today && past?.InventoriesAtPeriodEnd === false && mar?.InventoriesAtPeriodEnd === true, 'A2 Inventories says it is stock as of today (Kuwait) and whether that is the period end', JSON.stringify([mar?.InventoriesAsOf, past?.InventoriesAtPeriodEnd, mar?.InventoriesAtPeriodEnd]))
    is(typeof mar?.ExpensesBasis === 'string' && /not dated/.test(mar.ExpensesBasis), 'A5 the expenses say what they are: current settings, not dated transactions', String(mar?.ExpensesBasis))
    const xml = (await call('xbrl_export&from=2025-01-01&to=2025-12-31', { cookies })).text
    is(new RegExp(`<xbrli:instant>${today}</xbrli:instant>`).test(xml) && !/<xbrli:instant>2025-12-31</.test(xml), 'A2 the XML puts the Inventories instant on the day the stock was counted, not on the period end', (xml.match(/<xbrli:instant>[^<]*/) ?? [])[0])
  } finally { clean() }
}

head('the XML')
const x = await call(`xbrl_export&from=${FROM}&to=${TO}`, { cookies })
is(x.status === 200 && x.type.startsWith('application/xml'), 'the export is an XML file', `${x.status} ${x.type}`)
const wf = execFileSync('php', ['-r', `$d=new DOMDocument(); $ok=@$d->loadXML(file_get_contents('php://stdin')); echo $ok?'ok':'bad';`], { input: x.text, encoding: 'utf8' }).trim()
is(wf === 'ok', 'the XML is well formed')
const revFact = (x.text.match(/<ifrs-full:Revenue [^>]*>([^<]+)</) ?? [])[1]
is(revFact !== undefined && Math.abs(Number(revFact) - j.json.Revenue) < 0.0005, 'the XML Revenue fact equals the JSON figure', String(revFact))
is(x.text.includes('<xbrli:unit id="KWD">') && x.text.includes('iso4217:KWD'), 'the amounts are in KWD')

head('the log')
const logged = Number(sql(`select count(*) from admin_activity_log where action_key='xbrl_export' and created_at > now() - interval 5 minute`))
is(logged >= 1, 'each export is logged in the activity history', String(logged))

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
