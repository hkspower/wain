// CRM CONTACTS FROM OLD ORDERS WITH NO PHONE (owner, 2026-11-25: "use users with their orders for CRM"), against the real PHP and a real MariaDB:
//
//   npm run test:crm-email-contacts      (needs `bash scripts/sandbox.sh`: MariaDB and php -S :8095)
//
// A legacy order (imported from OpenCart) can have no usable phone. The CRM keys a contact by its valid phone, else by its e-mail (lower-cased,
// `email:<address>`), else the order stays in Orders only. Asserted:
//   - orders with no phone and one e-mail (in two spellings: case and spaces) are ONE contact, with both orders counted;
//   - an order with neither a phone nor an e-mail is not a contact;
//   - the rule is per ORDER: an order with a phone is the phone contact, and an order with no phone is its own e-mail contact; the two are never merged;
//   - the contact page (crm_detail) lists the e-mail contact's orders, and reading writes nothing;
//   - an e-mail contact with no orders cannot be saved by hand (crm_key_exists is false).
// Everything the suite creates is named crmemail-test / SPCRMEM* and removed again.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
const lit = (v) => (v === null ? 'null' : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)

let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, {
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) }, method: opts.method ?? 'GET', body: opts.body,
  })
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}
const post = (route, body) => admin(route, { method: 'POST', body: JSON.stringify(body) })

const cleanup = () => sql(
  "delete from crm_contacts where contact_key like 'email:crmemail-test-%'; " +
  "delete from order_items where order_id in (select id from orders where track_id like 'SPCRMEM%'); delete from orders where track_id like 'SPCRMEM%'; " +
  'delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null')
await cleanup()
const signIn = await post('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

let n = 0
const order = async ({ phone = null, email = null, name = 'crmemail-test guest', at }) => {
  n++
  await sql(`insert into orders (track_id, customer_account_id, customer_name, customer_phone, customer_email, amount, payment_method, payment_status, fulfilment_status, created_at)
             values ('SPCRMEM${n}', null, ${lit(name)}, ${lit(phone)}, ${lit(email)}, 4, 'cod', 'pending', 'unfulfilled', ${lit(at)})`)
}
// Two orders of one e-mail, no phone, spelled two ways: one contact.
await order({ email: 'crmemail-test-a@sporta.test', name: 'crmemail-test A', at: '2026-07-10 09:00:00' })
await order({ email: '  CRMEMAIL-test-A@Sporta.test ', name: 'crmemail-test A', at: '2026-07-11 09:00:00' })
// Neither a phone nor an e-mail: not a contact.
await order({ name: 'crmemail-test nobody', at: '2026-07-12 09:00:00' })
// An e-mail that also has a phone: the phone contact, not an e-mail one.
await order({ phone: '96550003333', email: 'crmemail-test-b@sporta.test', name: 'crmemail-test B', at: '2026-07-13 09:00:00' })
await order({ email: 'crmemail-test-b@sporta.test', name: 'crmemail-test B', at: '2026-07-14 09:00:00' })

const keyA = 'email:crmemail-test-a@sporta.test'
const before = (await sql("select count(*) from crm_contacts where contact_key like 'email:crmemail-test-%'"))
const page = await admin('crm_list&q=crmemail-test')
const rows = (page.body?.contacts ?? [])
const a = rows.find((c) => c.key === keyA)
is(!!a && a.order_count === 2, 'two no-phone orders with one e-mail are one contact, both counted', JSON.stringify(a && { key: a.key, n: a.order_count }))
is(!rows.some((c) => /nobody/.test(c.name)), 'an order with neither a phone nor an e-mail is not a contact')
const b = rows.find((c) => c.key === 'email:crmemail-test-b@sporta.test')
is(!!b && b.order_count === 1, 'the no-phone order of that e-mail is its own e-mail contact, not merged into the phone contact', JSON.stringify(b && { key: b.key, n: b.order_count }))
is(rows.some((c) => c.key === 'phone:96550003333' && c.order_count === 1), 'the phone contact counts only its own order')

const detail = await admin('crm_detail&key=' + encodeURIComponent(keyA) + '&orders_page=1&notes_page=1')
const orders = detail.body?.orders ?? detail.body?.contact?.orders ?? []
is(detail.status === 200 && orders.length === 2, 'the contact page lists the two orders of the e-mail contact', `status ${detail.status}, ${orders.length} order(s)`)

const readCount = await sql("select count(*) from crm_contacts where contact_key = 'email:crmemail-test-a@sporta.test'")
is(readCount === '0', 'reading the contact page writes nothing', `${readCount} row(s)`)

const orphan = await post('crm_save', { key: 'email:crmemail-test-nobody@sporta.test', display_name: 'x', status: 'new', tags: [] })
is(orphan.status !== 200 || orphan.body?.error === 'not_found' || orphan.body?.error === 'invalid_contact', 'an e-mail with no orders cannot be saved by hand', `status ${orphan.status}`)

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
