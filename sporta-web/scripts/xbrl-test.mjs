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
    sql(`insert into orders (track_id, customer_name, customer_phone, amount, subtotal, discount_amount, delivery_fee, payment_method, payment_status, paid_at)
         values ('XBRLFIX${n}', 'xbrl fixture', '96550000000', ${o.amount}, ${o.sub}, ${o.disc ?? 0}, ${o.fee ?? 0}, 'knet', '${o.status ?? 'paid'}', '${o.paid}')`)
    if (o.qty) sql(`insert into order_items (order_id, product_id, qty, unit_price, size) select id, ${pid}, ${o.qty}, 1, '${size}' from orders where track_id = 'XBRLFIX${n}'`)
    for (const [i, r] of (o.refunds ?? []).entries()) {
      sql(`insert into order_refunds (order_id, kind, amount, scope, payment_id, request_key, actor_email, created_at)
           select id, '${r.kind ?? 'refund'}', ${r.amount}, 'order', 'PID-XBRLFIX${n}', md5('xbrlfix${n}-${i}'), 'qa-admin@sporta.test', '${r.at}' from orders where track_id = 'XBRLFIX${n}'`)
    }
  }
  try {
    // O1 was paid at 00:30 on 1 March in Kuwait (21:30 UTC on 28 Feb): it is March's. O2 at 00:30 on 1 April in Kuwait (21:30 UTC on 31 Mar): April's.
    order(1, { paid: '2031-02-28 21:30:00', sub: 20, fee: 2, amount: 22, qty: 2 })
    order(2, { paid: '2031-03-31 21:30:00', sub: 100, fee: 5, amount: 105 })
    // O3 was refunded in full in March: sale and refund both in March, the goods went back (cost reversed).
    order(3, { paid: '2031-03-10 10:00:00', sub: 30, disc: 5, fee: 3, amount: 28, qty: 1, status: 'refunded', refunds: [{ amount: 28, at: '2031-03-20 10:00:00' }] })
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
