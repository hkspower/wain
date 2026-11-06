// The XBRL financial statements export (dropin/php-store/xbrl.php, admin.php?r=xbrl_export).
//
//   npm run test:xbrl     (needs the sandbox: `npm run sandbox`)
//
// The figures are checked against the same numbers computed directly in SQL, not against the PHP. Also: the XML is
// well formed (PHP's DOM parser), its facts match the JSON, the signed-out and bad-period requests are refused, and
// each export is logged.
import { execFileSync } from 'node:child_process'

const ADMIN = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8095/admin.php'
const EMAIL = 'cs@sporta.com.kw', PASSWORD = 'correct-horse-battery-kw'
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
const paid = Number(sql(`select count(*) from orders where payment_status='paid' and paid_at >= '${FROM}' and paid_at < date_add('${TO}', interval 1 day)`))
const revenue = Number(sql(`select coalesce(sum(subtotal-discount_amount),0) from orders where payment_status='paid' and paid_at >= '${FROM}' and paid_at < date_add('${TO}', interval 1 day)`))
const cost = Number(sql(`select coalesce(sum(oi.qty*pv.unit_cost_kwd),0) from orders o join order_items oi on oi.order_id=o.id join products p on p.id=oi.product_id left join product_variants pv on pv.slug=p.slug and pv.size=oi.size where o.payment_status='paid' and o.paid_at >= '${FROM}' and o.paid_at < date_add('${TO}', interval 1 day) and pv.unit_cost_kwd is not null`))
const missing = Number(sql(`select count(*) from orders o join order_items oi on oi.order_id=o.id join products p on p.id=oi.product_id left join product_variants pv on pv.slug=p.slug and pv.size=oi.size where o.payment_status='paid' and o.paid_at >= '${FROM}' and o.paid_at < date_add('${TO}', interval 1 day) and pv.unit_cost_kwd is null`))
const inv = Number(sql(`select coalesce(sum(stock*unit_cost_kwd),0) from product_variants where unit_cost_kwd is not null`))
is(j.json?.PaidOrders === paid, 'the paid-order count matches SQL', `${j.json?.PaidOrders} vs ${paid}`)
is(Math.abs(j.json?.Revenue - revenue) < 0.0005, 'Revenue matches SQL (subtotal minus discount)', `${j.json?.Revenue} vs ${revenue}`)
is(Math.abs(j.json?.CostOfSales - cost) < 0.0005, 'CostOfSales matches SQL (qty x unit cost, costed lines only)', `${j.json?.CostOfSales} vs ${cost}`)
is(j.json?.CostMissingLines === missing, 'uncosted lines are counted, not guessed', `${j.json?.CostMissingLines} vs ${missing}`)
is(Math.abs(j.json?.Inventories - inv) < 0.0005, 'Inventories matches SQL (stock x cost)', `${j.json?.Inventories} vs ${inv}`)
is(Math.abs(j.json?.GrossProfit - (j.json.Revenue - j.json.CostOfSales)) < 0.0005, 'GrossProfit = Revenue - CostOfSales')
is(Math.abs(j.json?.ProfitLoss - (j.json.GrossProfit + j.json.OtherIncome - j.json.Expenses)) < 0.0005, 'ProfitLoss = GrossProfit + OtherIncome - Expenses')

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
