// CRM INTERESTS (2026-11-18, owner: "improve crm about interset"), against the real PHP and a real MariaDB, no mocks:
//
//   npm run test:crm-interests      (needs `bash scripts/sandbox.sh`: MariaDB and php -S :8095)
//
// What a customer is interested in is WORKED OUT from what they ordered (orders -> order_items -> products), with no table, no column and nothing typed in:
// categories, brands, sizes, the prices they pay and the rhythm of their orders, counted in UNITS. Asserted:
//   - the numbers: units by category, brand and size (most first, ties by name), shares, price range and average, first / last order, over the right orders:
//     a shop-cancelled order, a failed card payment and a voided one are NOT interest, a refunded one and an unpaid cash order ARE;
//   - the same customer under two spellings of one phone (a guest) is one contact with both orders counted;
//   - the list rows carry `interest_labels`; the search box finds a customer by an interest in English and in Arabic (a category, a brand's English and Arabic
//     name); the summary carries `top_interests` for the contacts that match the filters (a source filter changes it);
//   - the contact page carries `interests` and `suggested_tags` (valid under the tag rule, not already tagged, never saved by this read);
//   - a contact with no order line has interests null and no labels; reading writes NOTHING (no crm_contacts row appears);
//   - nothing the screen already used changed (name, phone, totals).
// Everything the suite creates is named crmint-test / SPCRMINT* and removed again.
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
const list = async (q, extra = '') => (await admin(`crm_list&q=${encodeURIComponent(q)}${extra}`)).body
const mine = async (q = 'crmint-test', extra = '') => ((await list(q, extra))?.contacts ?? []).filter((c) => /crmint-test/.test(c.name))

const cleanup = () => sql(
  "delete from order_items where order_id in (select id from orders where track_id like 'SPCRMINT%'); delete from orders where track_id like 'SPCRMINT%'; " +
  "delete from crm_notes where contact_key in (select concat('account:', id) from customer_accounts where email like 'crmint-test-%'); " +
  "delete from crm_contacts where contact_key in (select concat('account:', id) from customer_accounts where email like 'crmint-test-%') or contact_key like 'phone:96550001111'; " +
  "delete from customer_accounts where email like 'crmint-test-%'; delete from products where slug like 'crmint-p%'; delete from brands where slug like 'crmint-brand-%'; " +
  'delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null')
await cleanup()
const signIn = await post('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

// ---- brands, products, customers, orders
await sql(`insert into brands (slug, name_en, name_ar, active) values ('crmint-brand-a', 'CrmInt Alpha', 'ألفا كرم', 1), ('crmint-brand-b', 'CrmInt Beta', 'بيتا كرم', 1)`)
const P = {}
for (const [slug, cat, brand, price] of [['crmint-p1', 'women', 'crmint-brand-a', 10], ['crmint-p2', 'women', 'crmint-brand-a', 20], ['crmint-p3', 'outerwear', 'crmint-brand-b', 30], ['crmint-p4', 'men', null, 5]]) {
  await sql(`insert into products (slug, name_en, name_ar, price, category, brand_slug, active) values (${lit(slug)}, ${lit('crmint ' + slug)}, 'منتج', ${price}, ${lit(cat)}, ${lit(brand)}, 1)`)
  P[slug] = Number(await sql(`select id from products where slug = ${lit(slug)}`))
}
await sql("insert into customer_accounts (name, email, password_hash, phone) values ('crmint-test X', 'crmint-test-x@sporta.test', 'x', '96598760001'), ('crmint-test Y', 'crmint-test-y@sporta.test', 'x', '96598760002')")
const X = Number(await sql("select id from customer_accounts where email = 'crmint-test-x@sporta.test'")), Y = Number(await sql("select id from customer_accounts where email = 'crmint-test-y@sporta.test'"))
let n = 0
const order = async ({ account = null, phone = null, name = 'crmint-test guest', pay = 'paid', ful = 'unfulfilled', at, items }) => {
  n++
  await sql(`insert into orders (track_id, customer_account_id, customer_name, customer_phone, amount, payment_method, payment_status, fulfilment_status, created_at)
             values ('SPCRMINT${n}', ${account ?? 'null'}, ${lit(name)}, ${lit(phone)}, 1, ${pay === 'pending' ? "'cod'" : "'knet'"}, ${lit(pay)}, ${lit(ful)}, ${lit(at)})`)
  const id = Number(await sql(`select id from orders where track_id = 'SPCRMINT${n}'`))
  for (const [slug, qty, size, price] of items) await sql(`insert into order_items (order_id, product_id, qty, unit_price, size) values (${id}, ${P[slug]}, ${qty}, ${price}, ${lit(size)})`)
}
// X: counted = o1 (paid), o2 (unpaid cash), o5 (refunded); NOT counted = o3 (cancelled by the shop), o4 (failed card)
await order({ account: X, at: '2026-09-01 10:00:00', items: [['crmint-p1', 2, 'M', 10], ['crmint-p3', 1, 'L', 30]] })
await order({ account: X, pay: 'pending', at: '2026-10-01 10:00:00', items: [['crmint-p2', 1, 'M', 20]] })
await order({ account: X, ful: 'cancelled', at: '2026-10-05 10:00:00', items: [['crmint-p4', 5, 'XL', 5]] })
await order({ account: X, pay: 'failed', at: '2026-10-06 10:00:00', items: [['crmint-p4', 3, 'XL', 5]] })
await order({ account: X, pay: 'refunded', at: '2026-10-31 10:00:00', items: [['crmint-p1', 1, 'S', 10]] })
// the guest: the same phone typed two ways
await order({ phone: '+965 5000-1111', at: '2026-10-10 09:00:00', items: [['crmint-p4', 2, null, 5]] })
await order({ phone: '50001111', at: '2026-10-20 09:00:00', items: [['crmint-p1', 1, 'ONE', 10]] })
// Y: an order with no lines at all
await order({ account: Y, name: 'crmint-test Y', at: '2026-10-12 09:00:00', items: [] })
const crmRowsBefore = Number(await sql("select count(*) from crm_contacts"))

// ------------------------------------------------------------------------------------------------------------ the numbers
let xKey, gKey
{
  const all = await mine()
  const x = all.find((c) => c.name === 'crmint-test X'), g = all.find((c) => c.source === 'phone'), y = all.find((c) => c.name === 'crmint-test Y')
  xKey = x?.key; gKey = g?.key
  is(!!x && !!g && !!y && all.length === 3, 'the three customers are listed (an account with units, a guest, an account with no lines)', all.map((c) => c.name).join(' | '))
  const d = (await admin('crm_detail&key=' + encodeURIComponent(xKey))).body
  const i = d?.contact?.interests
  is(i && i.items === 5, 'X: five units counted (cancelled and failed orders are not interest)', JSON.stringify(i && i.items))
  is(i && JSON.stringify(i.categories.map((c) => [c.key, c.qty, c.share])) === JSON.stringify([['women', 4, 0.8], ['outerwear', 1, 0.2]]), 'X: categories by units with their share (women 4 = 80%, outerwear 1 = 20%)', JSON.stringify(i && i.categories))
  is(i && JSON.stringify(i.brands.map((b) => [b.slug, b.name_en, b.name_ar, b.qty])) === JSON.stringify([['crmint-brand-a', 'CrmInt Alpha', 'ألفا كرم', 4], ['crmint-brand-b', 'CrmInt Beta', 'بيتا كرم', 1]]), 'X: brands by units, with the English and Arabic names the shop shows', JSON.stringify(i && i.brands))
  is(i && JSON.stringify(i.sizes.map((s) => [s.size, s.qty])) === JSON.stringify([['M', 3], ['L', 1], ['S', 1]]), 'X: sizes by units, a tie by name (M 3, then L, then S)', JSON.stringify(i && i.sizes))
  is(i && i.price_min === 10 && i.price_max === 30 && i.price_avg === 16, 'X: the prices they pay: 10 to 30, 16 on average per unit (80 / 5)', JSON.stringify(i && [i.price_min, i.price_max, i.price_avg]))
  is(i && i.first_order_at === '2026-09-01 10:00:00' && i.last_order_at === '2026-10-31 10:00:00', 'X: first and last order (over the orders that count)', JSON.stringify(i && [i.first_order_at, i.last_order_at]))
  is(d.contact.name === 'crmint-test X' && d.contact.order_count === 5 && typeof d.contact.phone_display === 'string' && Array.isArray(d.contact.tags), 'everything the screen already read from the contact is still there (name, order count, phone, tags)')
  const gi = (await admin('crm_detail&key=' + encodeURIComponent(gKey))).body.contact.interests
  is(gi && gi.items === 3 && JSON.stringify(gi.categories.map((c) => [c.key, c.qty])) === JSON.stringify([['men', 2], ['women', 1]]), 'the guest typed the phone two ways: ONE contact, both orders counted (men 2, women 1)', JSON.stringify(gi && gi.categories))
  is(gi && gi.sizes.length === 0 && gi.brands.map((b) => b.slug).join() === 'crmint-brand-a', 'the guest: no size when the line has none or is "one size"; the brand of the one branded piece', JSON.stringify(gi && [gi.sizes, gi.brands.map((b) => b.slug)]))
  const yi = (await admin('crm_detail&key=' + encodeURIComponent(y.key))).body.contact
  is(yi.interests === null && JSON.stringify(yi.interest_labels) === '[]' && JSON.stringify(yi.suggested_tags) === '[]', 'an account whose order has no lines: interests null, no labels, no suggested tags')
}

// ------------------------------------------------------------------------------------------------------------ the list rows and the search
{
  const all = await mine()
  const x = all.find((c) => c.name === 'crmint-test X'), g = all.find((c) => c.source === 'phone'), y = all.find((c) => c.name === 'crmint-test Y')
  is(JSON.stringify(x.interest_labels) === JSON.stringify(['women', 'outerwear', 'CrmInt Alpha', 'CrmInt Beta']), 'X\'s row carries short labels: top two categories, top two brands', JSON.stringify(x.interest_labels))
  is(JSON.stringify(g.interest_labels) === JSON.stringify(['men', 'women', 'CrmInt Alpha']), 'the guest\'s row: men, women and the brand', JSON.stringify(g.interest_labels))
  is(JSON.stringify(y.interest_labels) === '[]', 'an account with no lines: empty labels')
  const find = async (q) => (await mine(q)).map((c) => c.name).sort().join(',')
  is(await find('outerwear') === 'crmint-test X', 'search "outerwear" finds the customer who buys outerwear (and not the others)', await find('outerwear'))
  is(await find('CrmInt Beta') === 'crmint-test X' && await find('crmint-brand-b') === 'crmint-test X', 'search a brand by its name or its slug', await find('CrmInt Beta'))
  is(await find('ألفا') === 'crmint-test X,crmint-test guest', 'search a brand by its ARABIC name (the two customers who bought it)', await find('ألفا'))
  is((await find('نساء')).includes('crmint-test X') && (await find('نساء')).includes('crmint-test guest'), 'search a category by its Arabic name (نساء = women)', await find('نساء'))
  is(await find('رجال') === 'crmint-test guest', 'search "رجال" (men): only the guest', await find('رجال'))
  is(await find('accessories') === '', 'a category nobody bought finds nobody', await find('accessories'))
}

// ------------------------------------------------------------------------------------------------------------ the summary
{
  const s = (await list('crmint-test')).summary.top_interests
  const by = (kind, key) => s.find((t) => t.kind === kind && t.key === key)
  is(Array.isArray(s) && s.length <= 8 && s.every((t) => ['category', 'brand'].includes(t.kind) && typeof t.label_en === 'string' && typeof t.label_ar === 'string' && t.contacts > 0), 'summary.top_interests: at most eight, each a category or a brand with its names and how many contacts', JSON.stringify(s).slice(0, 240))
  is(by('category', 'women')?.contacts === 2 && by('category', 'outerwear')?.contacts === 1 && by('category', 'men')?.contacts === 1 && by('brand', 'crmint-brand-a')?.contacts === 2 && by('brand', 'crmint-brand-b')?.contacts === 1, 'the counts are contacts, over the matching contacts: women 2, outerwear 1, men 1, Alpha 2, Beta 1', JSON.stringify(s.map((t) => [t.kind, t.key, t.contacts])))
  is(s[0].contacts >= s[s.length - 1].contacts && s.slice(0, 2).every((t) => t.contacts === 2), 'most contacts first', JSON.stringify(s.map((t) => t.contacts)))
  is(by('category', 'women')?.label_ar === 'نساء' && by('brand', 'crmint-brand-a')?.label_ar === 'ألفا كرم', 'with the Arabic name for a known category and for a brand')
  const guestsOnly = (await list('crmint-test', '&source=phone')).summary.top_interests
  is(guestsOnly.every((t) => !(t.kind === 'category' && t.key === 'outerwear')) && guestsOnly.find((t) => t.key === 'men')?.contacts === 1, 'a filter changes it: with guests only there is no outerwear', JSON.stringify(guestsOnly.map((t) => [t.key, t.contacts])))
  const none = (await list('zzzz-no-such-customer')).summary
  is(Array.isArray(none.top_interests) && none.top_interests.length === 0, 'no contact matches: an empty list, not an error')
}

// ------------------------------------------------------------------------------------------------------------ suggested tags, and that reading writes nothing
{
  const d = (await admin('crm_detail&key=' + encodeURIComponent(xKey))).body.contact
  is(JSON.stringify(d.suggested_tags) === JSON.stringify(['women', 'outerwear', 'CrmInt Alpha', 'CrmInt Beta']), 'suggested tags: categories then brands, in the tag rule\'s own shape', JSON.stringify(d.suggested_tags))
  is(d.suggested_tags.every((t) => t.length >= 2 && t.length <= 24 && /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(t)), 'every suggestion passes the rule crm_save applies to a tag')
  is(Number(await sql('select count(*) from crm_contacts')) === crmRowsBefore, 'all of that only read: no crm_contacts row was written', `${crmRowsBefore} -> ${await sql('select count(*) from crm_contacts')}`)
  // the owner takes one: the existing save route, the existing tag rule
  const save = await post('crm_save', { key: xKey, display_name: '', status: 'active', tags: ['women'], follow_up_at: '' })
  is(save.status === 200, 'the owner adds "women" through the existing crm_save', `${save.status}`)
  const d2 = (await admin('crm_detail&key=' + encodeURIComponent(xKey))).body.contact
  is(JSON.stringify(d2.suggested_tags) === JSON.stringify(['outerwear', 'CrmInt Alpha', 'CrmInt Beta']) && d2.tags.join() === 'women', 'and it is no longer suggested (the rest are)', JSON.stringify(d2.suggested_tags))
  const save2 = await post('crm_save', { key: xKey, display_name: '', status: 'active', tags: ['WOMEN'], follow_up_at: '' })
  const d3 = (await admin('crm_detail&key=' + encodeURIComponent(xKey))).body.contact
  is(save2.status === 200 && !d3.suggested_tags.map((t) => t.toLowerCase()).includes('women'), 'a tag typed in another case counts as taken')
}

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
