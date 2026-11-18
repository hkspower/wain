// The CRM's phone numbers (2026-11-18, owner: "fix crm phone numbers"), against the real PHP and a real MariaDB, no mocks:
//
//   npm run test:crm-phones      (needs `bash scripts/sandbox.sh`: MariaDB and php -S :8095)
//
// What was wrong, each with its own section below:
//   - a registered account's number reached the screen as its row held it ("98765432", "+965 9876-5432", Arabic digits),
//     while the admin's WhatsApp button only appears for exactly 965 + 8 digits: those accounts got no button and one
//     number was shown several ways. Every number now goes through one rule (crm_phone_fields): the canonical 965 form for a
//     Kuwaiti mobile, the text as written (ASCII digits) for anything else, and a readable "+965 9876 5432" beside it;
//   - a search typed any way other than the way the number was stored found nothing ("9876 5432", "+965 9876-5432", Arabic
//     digits, 00965...): crm_phone_needle makes the digits of a phone-like query match the digits of the number;
//   - the Orders screen's search had the same blind spot for the stored 965 form.
// Everything the suite creates is named crmphone-test / SPCRMPH* and removed again.
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
const crm = async (q) => (await admin('crm_list&q=' + encodeURIComponent(q))).body?.contacts ?? []

const cleanup = () => sql(
  "delete from crm_notes where contact_key like 'account:%' and contact_key in (select concat('account:', id) from customer_accounts where email like 'crmphone-test-%'); " +
  "delete from orders where track_id like 'SPCRMPH%'; delete from customer_accounts where email like 'crmphone-test-%'; " +
  "delete from crm_contacts where contact_key like 'phone:96550001234'; delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null")
await cleanup()

const signIn = await post('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

// ---- accounts whose number was stored in every way the shop has ever stored one
const ACCOUNTS = [
  ['A1 plain eight digits', '98765432'], ['A2 plus and dashes', '+965 5522-2759'], ['A3 arabic digits', '٦٦٧٧٨٨٩٩'],
  ['A4 canonical', '96599887766'], ['A5 none', null], ['A6 not a number', 'ext 12'], ['A7 00965', '0096569991234'],
]
for (const [i, [label, phone]] of ACCOUNTS.entries()) {
  await sql(`insert into customer_accounts (name, email, password_hash, phone) values (${lit('crmphone-test ' + label)}, ${lit(`crmphone-test-${i + 1}@sporta.test`)}, 'x', ${lit(phone)})`)
}
// ---- a guest who ordered twice, the number typed two ways
await sql(`insert into orders (track_id, customer_name, customer_phone, amount, payment_method, payment_status) values ('SPCRMPH1', 'crmphone-test guest', '+965 5000-1234', 5, 'cod', 'pending'), ('SPCRMPH2', 'crmphone-test guest', '50001234', 7, 'cod', 'pending')`)

const mine = async (q = 'crmphone-test') => (await crm(q)).filter((c) => /crmphone-test/.test(c.name))
const byLabel = (list, l) => list.find((c) => c.name.includes(l))

// ------------------------------------------------------------------------------------------------ the numbers as shown
{
  const all = await mine()
  const expect = [['A1', '96598765432', '+965 9876 5432', true], ['A2', '96555222759', '+965 5522 2759', true], ['A3', '96566778899', '+965 6677 8899', true],
    ['A4', '96599887766', '+965 9988 7766', true], ['A7', '96569991234', '+965 6999 1234', true]]
  for (const [l, phone, shown, valid] of expect) {
    const c = byLabel(all, l)
    is(c && c.source === 'account' && c.phone === phone && c.phone_display === shown && c.phone_valid === valid, `account ${l}: the number is ${phone}, shown "${shown}"`, JSON.stringify(c && [c.phone, c.phone_display, c.phone_valid]))
  }
  const a5 = byLabel(all, 'A5'), a6 = byLabel(all, 'A6')
  is(a5 && a5.phone === '' && a5.phone_display === '' && a5.phone_valid === false, 'an account with no number: empty, not valid (the screen says "no phone recorded")', JSON.stringify(a5 && [a5.phone, a5.phone_valid]))
  is(a6 && a6.phone === 'ext 12' && a6.phone_display === 'ext 12' && a6.phone_valid === false, 'a stored value that is not a Kuwaiti mobile is kept as written and marked not valid (never turned into a wrong number)', JSON.stringify(a6 && [a6.phone, a6.phone_valid]))
  is(all.filter((c) => c.phone_valid).every((c) => /^965[569]\d{7}$/.test(c.phone)), 'every valid number is exactly 965 + 8 digits (what the WhatsApp button needs)')
  const g = all.filter((c) => c.source === 'phone')
  is(g.length === 1 && g[0].key === 'phone:96550001234' && g[0].order_count === 2 && g[0].phone_display === '+965 5000 1234', 'a guest who typed the number two ways is ONE contact with both orders', JSON.stringify(g.map((c) => [c.key, c.order_count, c.phone_display])))
  const a1 = byLabel(all, 'A1')
  const d = await admin('crm_detail&key=' + encodeURIComponent(a1.key))
  is(d.status === 200 && d.body.contact.phone === '96598765432' && d.body.contact.phone_display === '+965 9876 5432' && d.body.contact.phone_valid === true, 'the contact page (crm_detail) carries the same fields', JSON.stringify(d.body && d.body.contact && [d.body.contact.phone, d.body.contact.phone_display]))
}

// ------------------------------------------------------------------------------------------------ search
{
  const hit = async (q, label) => (await mine(q)).some((c) => c.name.includes(label))
  const A1 = [['98765432', 'eight digits'], ['9876 5432', 'spaced'], ['+965 9876-5432', 'plus, spaces and a dash'], ['٩٨٧٦٥٤٣٢', 'Arabic digits'], ['00965 98765432', '00965'], ['96598765432', 'canonical'], ['9876', 'the first four digits'], ['(965) 9876 5432', 'brackets']]
  for (const [q, how] of A1) is(await hit(q, 'A1'), `a search for ${how} ("${q}") finds the account stored as 98765432`)
  is(await hit('+965 5522 2759', 'A2'), 'a search finds the account stored with dashes ("+965 5522-2759") however it is typed')
  is(await hit('٦٦٧٧٨٨٩٩', 'A3'), 'a search in Arabic digits finds the account stored in Arabic digits')
  is(await hit('5000 1234', 'guest') && (await mine('+965 5000-1234')).some((c) => c.source === 'phone'), 'a search finds the guest by either spelling of the number')
  is(!(await hit('9876 5433', 'A1')) && !(await hit('+965 1111 2222', 'A1')), 'a number that is not theirs finds nothing')
  is(await hit('crmphone-test', 'A4') && (await mine('A4 canonical')).length === 1, 'a name still finds by name')
  is((await crm('crmphone-test xyz')).length === 0, 'a query that is neither a number nor a match finds nothing')
  is((await crm('12')).filter((c) => /crmphone-test/.test(c.name) && !c.phone.includes('12') && !c.name.includes('12')).length === 0, 'a query shorter than three digits is not treated as a number')
}

// ------------------------------------------------------------------------------------------------ orders search
{
  const orders = async (term) => ((await admin('orders&search=' + encodeURIComponent(term))).body ?? []).filter((o) => /^SPCRMPH/.test(o.track_id))
  await sql("update orders set customer_phone = '96550001234' where track_id = 'SPCRMPH1'")
  is((await orders('SPCRMPH')).length === 2, 'the Orders search still finds by order number')
  is((await orders('5000 1234')).some((o) => o.track_id === 'SPCRMPH1'), 'Orders: a number typed with a space finds the order stored as 96550001234')
  is((await orders('+965 5000-1234')).some((o) => o.track_id === 'SPCRMPH1'), 'Orders: a number typed with +965 and a dash finds it')
  is((await orders('50001234')).some((o) => o.track_id === 'SPCRMPH1'), 'Orders: eight plain digits still find it')
  is((await orders('5000 9999')).length === 0, 'Orders: another number finds nothing')
}

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
