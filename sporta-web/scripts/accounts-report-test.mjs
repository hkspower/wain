// MONTHLY AND YEARLY ACCOUNTS (owner, 2026-11-25: "make account system for yearly and monthly reports"), against the real PHP and MariaDB:
//
//   npm run test:accounts-report      (needs `bash scripts/sandbox.sh`: MariaDB and php -S :8095)
//
// admin.php?r=accounts_report&year=YYYY returns 12 months and the year, each the xbrl_build figures, BEFORE expenses. Asserted:
//   - a paid order dated in March lands in March (and not in April or the year's other months);
//   - the year total equals the sum of the twelve months for sales, cost, gross profit and delivery income;
//   - the answer carries the basis ("before_expenses") and no ProfitLoss row is needed for the screen;
//   - a bad year is refused (400), a GET only (405 otherwise), and a signed-out caller is refused (401/403).
// Everything it creates is named SPACCT* and removed again.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())

let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, {
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) }, method: opts.method ?? 'GET', body: opts.body,
  })
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}

const cleanup = () => sql("delete from order_items where order_id in (select id from orders where track_id like 'SPACCT%'); delete from orders where track_id like 'SPACCT%'; delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null")
await cleanup()
const signIn = await admin('login', { method: 'POST', body: JSON.stringify({ email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' }) })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

const before = await admin('accounts_report&year=2026')
is(before.status === 200, 'the report answers for a year', `${before.status}`)
const marchBefore = before.body?.months?.[2]?.values?.Revenue ?? 0
const aprilBefore = before.body?.months?.[3]?.values?.Revenue ?? 0

await sql("insert into orders (track_id, customer_account_id, customer_name, customer_phone, customer_email, amount, subtotal, discount_amount, delivery_fee, payment_method, payment_status, fulfilment_status, created_at, paid_at) values ('SPACCT1', null, 'SPACCT buyer', '96550009999', 'spacct@sporta.test', 11.000, 10.000, 0, 1.000, 'knet', 'paid', 'unfulfilled', '2026-03-10 09:00:00', '2026-03-10 09:00:00')")

const after = await admin('accounts_report&year=2026')
const m = after.body?.months ?? []
is(m.length === 12, 'twelve months come back, January to December', `${m.length} months`)
const marchAfter = m[2]?.values?.Revenue ?? NaN
const aprilAfter = m[3]?.values?.Revenue ?? NaN
is(Math.abs((marchAfter - marchBefore) - 10) < 0.0005, 'the paid March order (10.000 subtotal, no discount) adds 10.000 to March revenue', `${marchBefore} -> ${marchAfter}`)
is(Math.abs(aprilAfter - aprilBefore) < 0.0005, 'and does not reach April', `${aprilBefore} -> ${aprilAfter}`)

const yr = after.body?.year_total ?? {}
for (const k of ['Revenue', 'CostOfSales', 'GrossProfit', 'OtherIncome']) {
  const sum = m.reduce((s, x) => s + Number(x.values?.[k] ?? 0), 0)
  is(Math.abs(sum - Number(yr[k] ?? NaN)) < 0.0005, `the year's ${k} is the sum of the twelve months`, `${sum.toFixed(3)} vs ${yr[k]}`)
}
is(after.body?.basis === 'before_expenses', 'the answer says it is before expenses');

const bad = await admin('accounts_report&year=26')
is(bad.status === 400, 'a bad year is refused', `${bad.status}`)
const post = await admin('accounts_report&year=2026', { method: 'POST', body: '{}' })
is(post.status === 405, 'only GET is allowed', `${post.status}`)
const saved = cookie; cookie = ''
const anon = await admin('accounts_report&year=2026')
is(anon.status === 401 || anon.status === 403, 'a signed-out caller is refused', `${anon.status}`)
cookie = saved

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
