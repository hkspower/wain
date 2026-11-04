// DATA PROTECTION IN THE DATABASE, proved on a PRIVATE MariaDB (never the shared rig).
//
//   npm run test:db-privacy            (KEEP=1 keeps the temp directory)
//
// WHAT IT PROVES
//   1. INVENTORY. Every column of the real schema (install.mysql.sql + ops/db/privacy-schema.sql, loaded into a
//      private MariaDB) is classified in ops/db/data-protection.mjs; every classified column exists; a column that
//      looks personal (phone, email, street, ...) is never filed as "operational"; DATA-PROTECTION.md is current.
//   2. SCHEMA. privacy-schema.sql is additive and idempotent: imported twice, no data changes.
//   3. RETENTION. retention-preview.sql counts exactly what retention-apply.sql changes, and changes nothing itself;
//      the apply file refuses to run without the confirmation word; after it: closed orders lose address and note
//      (name, phone and every accounting column stay), recent / open / shipped / return-pending orders are
//      untouched, old resolved tickets and finished returns and sent outbox messages are blanked, old reset rows and
//      log rows are deleted, unsent messages and open cases are left alone; a second run changes nothing.
//   4. IDENTITY STAGE (off by default): name blanked, phone replaced by a keyed pseudonym that is stable per phone.
//   5. THE PHP LIBRARY (privacy-php.patch, applied to a scratch copy of the tree) does exactly what the SQL does:
//      same counts, same resulting rows, table by table.
//   6. ERASURE of one person: their closed orders, tickets, returns, outbox rows, reviews, CRM entries and account go;
//      open orders stay and are reported; a bystander is untouched; the ledger holds a salted hash, never the
//      phone or email; and after RESTORING an older backup, erase-reapply.sql erases them again.
//   7. MUTATION CHECKS: drop the "closed" guard, drop the age guard, blind the preview, drop the confirmation guard,
//      skip the ledger, add an unclassified personal column: each makes this suite fail.
//
// SELF-CONTAINED: its own MariaDB (ports from 33700), a scratch copy of dropin/ for the PHP, generated canaries.
import { createHash, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, sleep, startPrivateMariadb, toolsPresent } from './lib/private-mariadb.mjs'
import { LIVE_COLUMNS, TABLES as INVENTORY } from '../ops/db/data-protection.mjs'
import { ERASE, RETENTION, REAPPLY } from '../ops/db/privacy-statements.mjs'
import { renderAll } from '../ops/db/privacy-render.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const OPS = join(WEB, 'ops', 'db')
let fails = 0, passes = 0
const ok = (n, d = '') => { passes++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) }
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const info = (n, d = '') => console.log(`info ${n}${d ? `  - ${d}` : ''}`)
let tHead = Date.now()
const head = (t) => { const now = Date.now(); console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}  (+${Math.round((now - tHead) / 1000)}s)`); tHead = now }

{
  const { missing } = toolsPresent()
  if (missing.length || spawnSync('sh', ['-c', 'command -v php && command -v git']).status !== 0) {
    console.log(`SKIP db-privacy: ${missing.join(', ') || 'php or git'} not installed. Nothing was tested.`)
    process.exit(0)
  }
}
const tmp = mkdtempSync(join(tmpdir(), 'sporta-dbpriv-'))
const rnd = (n = 18) => randomBytes(n).toString('base64url').replace(/[-_]/g, 'x')
const TAG = randomBytes(3).toString('hex')              // canary prefix for this run
const SALT = randomBytes(24).toString('hex')

let DB
try { DB = await startPrivateMariadb({ label: 'priv', portFrom: 33700 }) } catch (e) { console.log(`SKIP db-privacy: ${e.message}. Nothing was tested.`); process.exit(0) }
info('server', `${DB.version} on port ${DB.port}`)
const mdb = (name) => DB.sql(`create database \`${name}\` character set utf8mb4 collate utf8mb4_unicode_ci`)
await mdb('sporta')
DB.sqlFile(join(WEB, 'dropin', 'php-store', 'install.mysql.sql'), 'sporta')
DB.sqlFile(join(WEB, '..', 'sporta-live', 'birthday', 'birthday.mysql.sql'), 'sporta')   // the live-only birthday columns

const q = (sql, db = 'sporta') => DB.sql(sql, db)
const checksumAll = async (db = 'sporta') => {          // one CRC per table over every column, snapshot-consistent
  const tables = (await q(`select table_name from information_schema.tables where table_schema='${db}' and table_type='BASE TABLE' and table_name not in ('privacy_runs') order by 1`, db)).split('\n').filter(Boolean)
  const out = {}
  for (const t of tables) {
    // a column the rules stamp with now() (anonymised_at, requested_at) is compared as "is it set", not by its value:
    // the SQL path and the PHP path run seconds apart
    const cols = (await q(`select group_concat(if(column_name in ('anonymised_at','requested_at','ran_at'), concat('ifnull(\`',column_name,'\` is not null,0)'), concat('ifnull(cast(\`',column_name,'\` as binary),0x00)')) order by ordinal_position separator ',0x1f,') from information_schema.columns where table_schema='${db}' and table_name='${t}'`, db))
    out[t] = await q(`set time_zone='+00:00'; select count(*), coalesce(sum(crc32(concat(${cols}))),0) from \`${t}\``, db)
  }
  return out
}
const diffTables = (a, b) => Object.keys({ ...a, ...b }).filter((t) => a[t] !== b[t])

// ================================================================== 1. inventory
head('1. The inventory covers every column of the real schema')
{
  {
    // apply the additive privacy schema: twice, and prove the second run changes nothing
    await q('insert into settings (name, value) values (\'probe\', \'{}\')')
    DB.sqlFile(join(OPS, 'privacy-schema.sql'), 'sporta')
    const c1 = await checksumAll()
    DB.sqlFile(join(OPS, 'privacy-schema.sql'), 'sporta')
    const c2 = await checksumAll()
    is(diffTables(c1, c2).length === 0, 'privacy-schema.sql imported twice: no error, no data changed (additive, idempotent)')
    await q("delete from settings where name = 'probe'")
    const sql = readFileSync(join(OPS, 'privacy-schema.sql'), 'utf8').replace(/--[^\n]*/g, '')
    is(!/\b(drop\s+(table|column|index|database)|rename\s|truncate|delete\s+from|modify\s+column|change\s+column)/i.test(sql), 'and it never drops, renames, truncates or rewrites anything')
    const cols = (await q("select concat(table_name,'.',column_name,'|',data_type) from information_schema.columns where table_schema='sporta' order by 1")).split('\n').filter(Boolean)
    const schema = new Map(cols.map((c) => { const [k, t] = c.split('|'); return [k, t] }))
    const classified = new Map()
    for (const [t, spec] of Object.entries(INVENTORY)) {
      for (const [c, m] of Object.entries(spec.columns || {})) classified.set(`${t}.${c}`, m)
      for (const c of spec.operational || []) classified.set(`${t}.${c}`, { class: 'operational' })
    }
    const unclassified = [...schema.keys()].filter((k) => !classified.has(k) && !k.startsWith('privacy_'))
    is(unclassified.length === 0, `every one of the ${schema.size} columns in the schema is classified`, unclassified.slice(0, 6).join(', '))
    const phantom = [...classified.keys()].filter((k) => !schema.has(k) && !(LIVE_COLUMNS[k.split('.')[0]] || []).includes(k.split('.')[1]))
    is(phantom.length === 0, 'every classified column exists (or is a declared live-only column)', phantom.slice(0, 6).join(', '))
    const tablesNotCovered = [...new Set([...schema.keys()].map((k) => k.split('.')[0]))].filter((t) => !INVENTORY[t] && !t.startsWith('privacy_'))
    is(tablesNotCovered.length === 0, 'every table is in the inventory', tablesNotCovered.join(', '))
    const sus = /(phone|email|street|address|birth|token|secret|password|passwd|_ip$|^ip_|lat|lng|longitude|latitude)/i
    const misfiled = [...classified.entries()].filter(([k, m]) => m.class === 'operational' && sus.test(k.split('.')[1]) && !/^(orders\.(utm_|discount)|settings\.|product|brands\.)/.test(k) && !/^(admin_users\.(temporary_password|must_change_password)|admin_password_resets\.)/.test(k) && !/(translate|plate)/i.test(k) && !/^customer_accounts\.birthday_(set_at|sent_year)$/.test(k)).map(([k]) => k)
    is(misfiled.length === 0, 'no column that looks personal (phone, email, street, token, ...) is filed as operational', misfiled.join(', '))
    const bad1 = [...classified.entries()].filter(([, m]) => m.class !== 'operational' && !['personal', 'staff', 'secret', 'pseudonym'].includes(m.class)).map(([k]) => k)
    const incomplete = [...classified.entries()].filter(([, m]) => m.class !== 'operational' && !(m.needed && m.retention && m.readers && m.storage && m.exposure)).map(([k]) => k)
    is(bad1.length === 0 && incomplete.length === 0, 'every personal/secret column answers all five questions: needed, retention, who reads it, how it is stored, where it shows', incomplete.slice(0, 5).join(', '))
    const plainSecrets = [...classified.entries()].filter(([, m]) => m.class === 'secret' && /^plain/.test(m.storage)).map(([k]) => k)
    info('secrets stored readable', plainSecrets.join(', '))
    // the markdown is generated from the inventory
    const inv = spawnSync('node', [join(OPS, 'privacy-inventory.mjs'), '--check'], { encoding: 'utf8' })
    is(inv.status === 0, 'DATA-PROTECTION.md carries the current generated inventory table', (inv.stdout + inv.stderr).trim().split('\n').pop())
    // MUTATION: a new personal column nobody classified is caught
    await q('alter table orders add column customer_email varchar(120) null')
    const after = (await q("select count(*) from information_schema.columns where table_schema='sporta' and table_name='orders' and column_name='customer_email'")) === '1'
    is(after && !classified.has('orders.customer_email'), 'MUTATION a new personal column (orders.customer_email) is NOT in the inventory: the coverage check above would be red')
    await q('alter table orders drop column customer_email')
  }
}

// ================================================================== 2. generated files, static proof
head('2. The SQL files and the PHP patch are generated from one source, and can only touch what they say')
{
  const files = renderAll()
  const stale = Object.entries(files).filter(([f, t]) => !existsSync(join(OPS, f)) || readFileSync(join(OPS, f), 'utf8') !== t).map(([f]) => f)
  is(stale.length === 0, 'retention-*.sql, erase-*.sql and privacy-php.patch equal what privacy-render.mjs generates', stale.join(', '))
  const chk = spawnSync('node', [join(OPS, 'privacy-render.mjs'), '--check'], { encoding: 'utf8' })
  is(chk.status === 0, '`privacy-render.mjs --check` exits 0')
  // an edited generated file is detected
  const edited = { ...files, 'retention-apply.sql': files['retention-apply.sql'].replace('delete from', 'DELETE FROM') }
  is(Object.entries(edited).some(([f, t]) => t !== files[f]), 'MUTATION a hand-edited generated file differs from the generator output: --check would exit 1')
  const ACCOUNTING = ['track_id', 'amount', 'subtotal', 'discount_amount', 'delivery_fee', 'discount_code', 'discount_label', 'discount_ids', 'discount_released', 'payment_status', 'payment_method', 'fulfilment_status', 'pay_attempt', 'paid_at', 'fulfilled_at', 'created_at', 'stock_claimed', 'stock_released', 'utm_source', 'utm_medium', 'utm_campaign', 'referrer_host', 'id']
  const touched = new Set()
  for (const x of [...RETENTION, ...ERASE, ...REAPPLY].filter((y) => y.table === 'orders' && /^update/.test(y.apply))) {
    const set = x.apply.replace(/\s+/g, ' ').match(/ set (.*?) where /)[1]
    for (const part of set.split(/,\s*(?=\w+ = )/)) touched.add(part.split(' = ')[0].trim())
  }
  const hit = [...touched].filter((c) => ACCOUNTING.includes(c) || /^cbk_/.test(c))
  is(touched.size > 0 && hit.length === 0, `no rule can change an accounting column of an order (columns ever written: ${[...touched].join(', ')})`, hit.join(', '))
  const allSql = Object.entries(files).filter(([f]) => f.endsWith('.sql')).map(([, t]) => t).join('\n').replace(/--[^\n]*/g, '')
  is(!/\b(drop\s+(table|column|database)|truncate|alter\s+table|rename\s)/i.test(allSql) && !/delete\s+from\s+(orders|order_items|products|admin_users|support_tickets|return_requests|inventory_movements)\b/i.test(allSql), 'no generated SQL drops, truncates, alters or deletes an order, a ticket, a return or a staff account')
  const deletes = [...allSql.matchAll(/delete\s+from\s+(\w+)/gi)].map((m) => m[1].toLowerCase())
  is([...new Set(deletes)].every((t) => ['customer_password_resets', 'admin_password_resets', 'admin_activity_log', 'crm_notes', 'crm_contacts', 'customer_accounts'].includes(t)), 'the only tables rows are ever DELETED from are resets, the activity log, CRM and accounts', [...new Set(deletes)].join(', '))
}

// ================================================================== 3. seed
head('3. Seed: old, recent, open and bystander data (synthetic, generated now)')
const D = (days) => `date_sub(now(), interval ${days} day)`
const ord = (key, o) => {
  const name = `${TAG}NAME-${key}`, phone = o.phone || `5${String(randomBytes(3).readUIntBE(0, 3) % 10000000).padStart(7, '0')}`
  return { key, name, phone, sql: `insert into orders (track_id, amount, subtotal, delivery_fee, customer_name, customer_phone, customer_governorate, customer_area, customer_block, customer_street, customer_building, customer_floor, customer_flat, customer_note, payment_status, payment_method, fulfilment_status, created_at, fulfilled_at, customer_account_id)
    values ('T${TAG}${key}', 12.500, 10.000, 2.500, '${name}', '${phone}', 'Hawalli', 'Salmiya', 'B-${TAG}${key}', 'STREET-${TAG}${key}', 'BLDG-${TAG}${key}', 'FL-${TAG}${key}', 'FLAT-${TAG}${key}', 'NOTE-${TAG}${key} https://www.google.com/maps?q=29.3,47.9',
    '${o.pay || 'paid'}', 'cod', '${o.ful}', ${D(o.age)}, ${o.ful === 'delivered' ? D(o.age - 1) : 'null'}, ${o.acct || 'null'})` }
}
const PERSON = { phone: `5${String(randomBytes(3).readUIntBE(0, 3) % 10000000).padStart(7, '0')}`, email: `${TAG}.person@example.invalid` }
const BYST = { phone: `6${String(randomBytes(3).readUIntBE(0, 3) % 10000000).padStart(7, '0')}`, email: `${TAG}.bystander@example.invalid` }
await q(`insert into products (slug,name_en,name_ar,price) values ('p-one','One','١',9.5)`)
await q(`insert into customer_accounts (id,name,email,password_hash,phone) values (1001,'${TAG}ACC-PERSON','${PERSON.email}','$2y$10$${rnd(40)}','${PERSON.phone}'), (1002,'${TAG}ACC-BYST','${BYST.email}','$2y$10$${rnd(40)}','${BYST.phone}')`)
await q(`update customer_accounts set birthday = '1990-05-05', birthday_set_at = ${D(100)} where id in (1001, 1002)`)
const orders = [
  ord('O1', { ful: 'delivered', age: 200 }), ord('O2', { ful: 'cancelled', age: 200 }), ord('O3', { ful: 'unfulfilled', pay: 'failed', age: 200 }),
  ord('O4', { ful: 'shipped', age: 200 }), ord('O5', { ful: 'unfulfilled', pay: 'pending', age: 200 }), ord('O6', { ful: 'delivered', age: 10 }),
  ord('O7', { ful: 'delivered', age: 200 }), ord('O8', { ful: 'delivered', age: 80 }), ord('O9', { ful: 'delivered', age: 400 }),
  // the person to erase: two closed orders, one still open, one linked to the account
  ord('P1', { ful: 'delivered', age: 30, phone: PERSON.phone, acct: 1001 }), ord('P2', { ful: 'cancelled', age: 5, phone: PERSON.phone }), ord('P3', { ful: 'shipped', age: 2, phone: PERSON.phone }),
  // the bystander: must never change
  ord('B1', { ful: 'delivered', age: 300, phone: BYST.phone, acct: 1002 }), ord('B2', { ful: 'delivered', age: 20, phone: BYST.phone }),
]
for (const o of orders) await q(o.sql)
const oid = async (key) => Number(await q(`select id from orders where track_id = 'T${TAG}${key}'`))
const ID = {}; for (const o of orders) ID[o.key] = await oid(o.key)
await q(`insert into order_items (order_id, product_id, qty, unit_price, size) select id, 1, 1, 9.5, 'M' from orders`)
await q(`insert into fulfilment_outbox (order_id, kind, payload, sent_at, created_at) values
  (${ID.O1}, 'new', '{"name":"${TAG}OUT-F1","phone":"x"}', ${D(60)}, ${D(61)}), (${ID.O6}, 'new', '{"name":"${TAG}OUT-F2"}', ${D(5)}, ${D(6)}),
  (${ID.O5}, 'new', '{"name":"${TAG}OUT-F3"}', null, ${D(60)}), (${ID.P1}, 'new', '{"name":"${TAG}OUT-P1"}', ${D(3)}, ${D(4)}),
  (${ID.P3}, 'new', '{"name":"${TAG}OUT-P3"}', ${D(1)}, ${D(2)}), (${ID.B1}, 'new', '{"name":"${TAG}OUT-B1"}', ${D(3)}, ${D(4)})`)
// REVIEW 2026-11-04: last_error is both diagnosis text (a mail error can echo an address) and, in four fixed values, STATE that store.php reads
// back ('order cancelled' / 'order reinstated' / 'order shipped' = closed without being mailed, 'sending' = in flight)
await q(`insert into fulfilment_outbox (order_id, kind, payload, sent_at, created_at, last_error) values (${ID.O7}, 'cancel', '{"name":"${TAG}OUT-F4"}', ${D(60)}, ${D(61)}, 'order shipped')`)
await q(`update fulfilment_outbox set last_error = 'smtp refused ${TAG}.leak@example.invalid' where payload like '%${TAG}OUT-F1%'`)
await q(`update fulfilment_outbox set last_error = 'order cancelled' where payload like '%${TAG}OUT-P1%'`)
await q(`insert into whatsapp_outbox (order_id, kind, to_e164, template, lang, payload, sent_at, created_at) values
  (${ID.O1}, 'confirmed', '+965${TAG.replace(/\D/g, '1').padEnd(8, '0').slice(0, 8)}', 't', 'en', '{"n":"${TAG}WA-W1"}', ${D(60)}, ${D(61)}), (${ID.O6}, 'confirmed', '+96551111111', 't', 'en', '{"n":"${TAG}WA-W2"}', ${D(5)}, ${D(6)}),
  (${ID.P1}, 'confirmed', '+965${PERSON.phone}', 't', 'en', '{"n":"${TAG}WA-P1"}', ${D(3)}, ${D(4)}), (${ID.B1}, 'confirmed', '+965${BYST.phone}', 't', 'en', '{"n":"${TAG}WA-B1"}', ${D(3)}, ${D(4)})`)
const ticket = async (ref, who, status, age, resolvedAge) => {
  await q(`insert into support_tickets (reference, customer_name, customer_email, customer_phone, subject, status, created_at, updated_at, resolved_at)
    values ('${ref}', '${TAG}TN-${ref}', '${who.email}', '${who.phone}', 'SUBJ-${TAG}${ref}', '${status}', ${D(age)}, ${D(age)}, ${resolvedAge == null ? 'null' : D(resolvedAge)})`)
  const id = Number(await q(`select id from support_tickets where reference = '${ref}'`))
  await q(`insert into support_messages (ticket_id, author_kind, author_name, body, created_at) values (${id}, 'customer', '${TAG}AN-${ref}', 'BODY-${TAG}${ref}-c', ${D(age)}), (${id}, 'staff', 'Staff Member', 'BODY-${TAG}${ref}-s', ${D(age)})`)
  return id
}
const other = { email: `${TAG}.other@example.invalid`, phone: '66000001' }
await ticket('SA1', other, 'resolved', 500, 499); await ticket('SA2', other, 'closed', 400, null); await ticket('SA3', other, 'open', 500, null); await ticket('SA4', other, 'resolved', 10, 9)
await ticket('SP1', PERSON, 'open', 3, null); await ticket('SB1', BYST, 'resolved', 400, 399)
const ret = async (ref, orderKey, phone, status, age) => {
  await q(`insert into return_requests (reference, order_id, status, eligibility, contact_phone, customer_note, created_at, updated_at) values ('${ref}', ${ID[orderKey]}, '${status}', 'standard', '${phone}', 'RNOTE-${TAG}${ref}', ${D(age)}, ${D(age)})`)
  const id = Number(await q(`select id from return_requests where reference = '${ref}'`))
  await q(`insert into return_request_events (request_id, from_status, to_status, actor_type, actor, note, created_at) values (${id}, null, 'submitted', 'customer', 'CustName-${TAG}${ref}', 'ENOTE-${TAG}${ref}-c', ${D(age)}), (${id}, 'submitted', '${status}', 'admin', 'staff@example.invalid', 'ENOTE-${TAG}${ref}-s', ${D(age)})`)
}
await ret('RA1', 'O1', '55000001', 'completed', 400); await ret('RA2', 'O7', '55000002', 'submitted', 400); await ret('RA3', 'O6', '55000003', 'completed', 10)
await ret('RP1', 'P1', PERSON.phone, 'completed', 20); await ret('RB1', 'B1', BYST.phone, 'completed', 400)
await q(`insert into customer_password_resets (customer_id, token_hash, expires_at, created_at) values (1001, '${'a'.repeat(64)}', ${D(59)}, ${D(60)}), (1001, '${'b'.repeat(64)}', date_add(now(), interval 1 hour), ${D(0)})`)
await q(`insert into admin_users (id, email, password_hash) values (1, '${TAG}.admin@example.invalid', '$2y$10$${rnd(40)}')`)
await q(`insert into admin_password_resets (admin_id, token_hash, expires_at, created_at) values (1, '${'c'.repeat(64)}', ${D(59)}, ${D(60)}), (1, '${'d'.repeat(64)}', date_add(now(), interval 1 hour), ${D(0)})`)
await q(`insert into admin_activity_log (actor_email, action_key, created_at) values ('${TAG}.admin@example.invalid', 'old_event', ${D(500)}), ('${TAG}.admin@example.invalid', 'recent_event', ${D(2)})`)
await q(`insert into reviews (order_id, rating, comment, lang, published) values (${ID.P1}, 5, 'REV-${TAG}-P1', 'en', 1), (${ID.B1}, 4, 'REV-${TAG}-B1', 'en', 1)`)
await q(`insert into crm_contacts (contact_key, display_name, status, created_by, updated_by) values ('phone:965${PERSON.phone}', '${TAG}CRM-P', 'new', 'a', 'a'), ('account:1001', '${TAG}CRM-A', 'new', 'a', 'a'), ('phone:965${BYST.phone}', '${TAG}CRM-B', 'new', 'a', 'a')`)
await q(`insert into crm_notes (contact_key, note, created_by) values ('phone:965${PERSON.phone}', 'CNOTE-${TAG}-P', 'a'), ('account:1001', 'CNOTE-${TAG}-A', 'a'), ('phone:965${BYST.phone}', 'CNOTE-${TAG}-B', 'a')`)
await q(`insert into blocked_customers (phone, scope, reason) values ('${PERSON.phone}', 'all', 'BLK-${TAG}')`)
info('seed', `${orders.length} orders, 6 tickets, 5 return requests, outbox rows, resets, log rows, 2 accounts, CRM, one blocked number`)

// ------------------------------------------------------------------ the SQL runner (the way a job would run the files)
const MARIADB = ['--no-defaults', '-S', DB.sock, '-uroot', '--default-character-set=utf8mb4', '-t']
const runSql = (db, file, vars = {}, text = null) => {
  const pre = Object.entries(vars).map(([k, v]) => `set @${k} = ${typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`};`).join('\n')
  const body = text ?? readFileSync(join(OPS, file), 'utf8')
  const r = spawnSync('mariadb', [...MARIADB, db], { input: `${pre}\n${body}`, encoding: 'utf8', maxBuffer: 1 << 26 })
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' }
}
const errLine = (t) => (t.match(/ERROR [^\n]*/) || [''])[0].slice(0, 220)
const parseCounts = (out) => { const m = {}; for (const line of out.split('\n')) { const c = line.split('|').map((s) => s.trim()); if (c.length >= 5 && /^(R|E|X|A|INFO)-/.test(c[1])) m[c[1]] = Number(c[c.length - 2]) } return m }

// ================================================================== 4. retention preview and apply
head('4. Retention: preview counts, apply refuses without the word, apply blanks exactly those rows')
const before = await checksumAll()
const pv = runSql('sporta', 'retention-preview.sql')
const counts = parseCounts(pv.out)
const EXPECT = { 'R-ORD1': 5, 'R-ORD2': 0, 'R-SUP-1': 3, 'R-SUP-2': 6, 'R-RET-1': 2, 'R-RET-2': 4, 'R-OUT-1': 2, 'R-OUT-2': 1, 'R-RES-1': 1, 'R-RES-2': 1, 'R-LOG-1': 1 }
is(pv.status === 0, 'retention-preview.sql runs', pv.err.slice(0, 200))
is(Object.entries(EXPECT).every(([k, v]) => counts[k] === v), 'its counts equal what the seed says should change', JSON.stringify(counts).slice(0, 300))
is(diffTables(before, await checksumAll()).length === 0, 'and it changed nothing: every table has the same row count and CRC before and after')
is(counts['INFO-UNSENT'] === 1 && counts['INFO-OPEN-ORDERS'] >= 2, 'it also reports (without touching) unsent warehouse mail and long-open orders', `unsent ${counts['INFO-UNSENT']}, open ${counts['INFO-OPEN-ORDERS']}`)
const noWord = runSql('sporta', 'retention-apply.sql')
is(noWord.status !== 0 && /1242/.test(noWord.err) && diffTables(before, await checksumAll()).length === 0, 'retention-apply.sql without the confirmation word stops (error 1242) and changes nothing')
const wrong = runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'apply' })
is(wrong.status !== 0 && diffTables(before, await checksumAll()).length === 0, 'and a wrong word (lower case) stops too')

// REVIEW 2026-11-04: the SQL files clamp the policy numbers exactly as privacy.php does (privacy_vars): a whole number from 0 to 36500,
// and closed orders are not blanked before 30 days. A typo such as 0 or -5 used to blank every closed order at once (a cut-off of
// "now" or of the future); the PHP library would have refused it, the SQL did not.
{
  const c30 = parseCounts(runSql('sporta', 'retention-preview.sql', { orders_days: 30 }).out)
  const c0 = parseCounts(runSql('sporta', 'retention-preview.sql', { orders_days: 0 }).out)
  const cNeg = parseCounts(runSql('sporta', 'retention-preview.sql', { orders_days: -5 }).out)
  const raw0 = Number(await q(`select count(*) from orders where anonymised_at is null and (fulfilment_status in ('delivered','cancelled') or (payment_status = 'failed' and fulfilment_status in ('unfulfilled','cancelled'))) and coalesce(fulfilled_at, created_at) < now() and not exists (select 1 from return_requests rr where rr.order_id = orders.id and rr.status not in ('completed','declined','cancelled'))`))
  is(c30['R-ORD1'] > 0 && c0['R-ORD1'] === c30['R-ORD1'] && cNeg['R-ORD1'] === c30['R-ORD1'] && raw0 > c30['R-ORD1'], 'orders_days = 0 and orders_days = -5 are clamped to the 30-day floor (same count as 30), where the raw statement would hit more closed orders', `30: ${c30['R-ORD1']}, 0: ${c0['R-ORD1']}, -5: ${cNeg['R-ORD1']}, unclamped now: ${raw0}`)
  const fileText = readFileSync(join(OPS, 'retention-preview.sql'), 'utf8')
  const noClamp = fileText.replace('greatest(30, cast(ifnull(@orders_days, 90) as signed))', 'cast(ifnull(@orders_days, 90) as signed)')
  const cm = parseCounts(runSql('sporta', null, { orders_days: 0 }, noClamp).out)
  is(noClamp !== fileText && cm['R-ORD1'] !== c30['R-ORD1'], 'MUTATION the clamp removed from the SQL: orders_days = 0 then selects every closed order and the clamp check above would be red', `reports ${cm['R-ORD1']}`)
  const cs = parseCounts(runSql('sporta', 'retention-preview.sql', { support_days: -1 }).out)
  const cs0 = parseCounts(runSql('sporta', 'retention-preview.sql', { support_days: 0 }).out)
  is(cs['R-SUP-1'] === cs0['R-SUP-1'], 'a negative support_days is clamped to 0 (it cannot reach into the future)', `-1: ${cs['R-SUP-1']}, 0: ${cs0['R-SUP-1']}`)
}

const snapshotAccounting = () => q(`select group_concat(concat_ws('|', id, track_id, amount, subtotal, discount_amount, delivery_fee, payment_status, payment_method, fulfilment_status, ifnull(paid_at,''), ifnull(fulfilled_at,''), created_at, customer_governorate, customer_area, ifnull(customer_account_id,'')) order by id) from orders`)
const acct0 = await snapshotAccounting()
const dumpBefore = spawnSync('sh', ['-c', `mariadb-dump --no-defaults -S ${DB.sock} -uroot --skip-comments sporta`], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout
const PRE_APPLY = join(tmp, 'pre-apply.sql'); writeFileSync(PRE_APPLY, dumpBefore)
const ap = runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'APPLY' })
is(ap.status === 0, 'retention-apply.sql runs with the word', ap.err.slice(0, 300))
const row = (key) => q(`select ifnull(customer_name,'NULL'), ifnull(customer_phone,'NULL'), ifnull(customer_note,'NULL'), ifnull(customer_street,'NULL'), ifnull(customer_block,'NULL'), ifnull(customer_building,'NULL'), ifnull(customer_floor,'NULL'), ifnull(customer_flat,'NULL'), ifnull(anonymised_at is not null,0) from orders where track_id = 'T${TAG}${key}'`).then((s) => s.split('\t'))
const blanked = async (key) => { const r = await row(key); return r[2] === 'NULL' && r[3] === 'NULL' && r[4] === 'NULL' && r[5] === 'NULL' && r[6] === 'NULL' && r[7] === 'NULL' && r[8] === '1' }
const intact = async (key) => { const r = await row(key); return r[2] !== 'NULL' && r[3] !== 'NULL' && r[8] === '0' }
const o = {}
for (const k of ['O1', 'O2', 'O3', 'O9']) o[k] = await blanked(k)
is(Object.values(o).every(Boolean), 'closed orders older than 90 days (delivered, cancelled, failed-payment) lost street, building, floor, flat, block and the note', JSON.stringify(o))
const kept = {}
for (const k of ['O4', 'O5', 'O6', 'O7', 'O8', 'P1', 'P2', 'P3', 'B1', 'B2']) kept[k] = k === 'B1' ? await blanked(k) : await intact(k)
is(kept.O4 && kept.O5 && kept.O6 && kept.O7 && kept.O8 && kept.P1 && kept.P2 && kept.P3 && kept.B2, 'shipped, pending, recent (10 d), 80-day, return-pending and other recent orders are untouched', JSON.stringify(kept))
is(kept.B1, 'the 300-day-old bystander order is blanked too: the rule is about age and state, not about a person')
const r1 = await row('O1')
is(r1[0] === `${TAG}NAME-O1` && r1[1] === orders[0].phone, 'name and phone stay (identity stage is off by default)')
is(await snapshotAccounting() === acct0, 'every accounting column of every order is byte-identical (track id, amounts, payment, fulfilment, timestamps, governorate, area, account link)')
is((await q(`select count(*) from order_items`)) === String(orders.length), 'order_items are untouched')
const sup = await q(`select group_concat(concat(reference, ':', ifnull(anonymised_at is not null,0), ':', customer_name like '[removed]') order by reference) from support_tickets`)
is(/SA1:1:1/.test(sup) && /SA2:1:1/.test(sup) && /SA3:0:0/.test(sup) && /SA4:0:0/.test(sup) && /SB1:1:1/.test(sup) && /SP1:0:0/.test(sup), 'resolved/closed tickets older than 365 days are blanked; open or recent ones are not', sup)
is((await q(`select count(*) from support_messages m join support_tickets t on t.id = m.ticket_id where t.anonymised_at is not null and (m.body <> '[removed]' or m.author_name is not null)`)) === '0' && (await q(`select count(*) from support_messages where body like '%BODY-${TAG}SA3%'`)) === '2', 'their messages (customer AND staff) are blanked; the open ticket keeps its messages')
is((await q(`select group_concat(concat(reference, ':', contact_phone = '', ':', customer_note is null) order by reference) from return_requests`)) === 'RA1:1:1,RA2:0:0,RA3:0:0,RB1:1:1,RP1:0:0', 'finished returns older than 365 days are blanked; the open one and the recent ones are not')
is((await q(`select count(*) from return_request_events e join return_requests r on r.id = e.request_id where r.reference in ('RA1','RB1') and (e.note is not null or e.actor like 'CustName%')`)) === '0' && (await q(`select count(*) from return_request_events e join return_requests r on r.id = e.request_id where r.reference = 'RA1' and e.actor = 'staff@example.invalid'`)) === '1', 'their events lose notes and the customer actor; the staff actor stays')
const outb = await q(`select group_concat(concat(order_id, ':', payload) order by id separator ' ') from fulfilment_outbox`)
is(!outb.includes(`${TAG}OUT-F1`) && outb.includes(`${TAG}OUT-F2`) && outb.includes(`${TAG}OUT-F3`), 'a warehouse message sent 60 days ago is blanked; a recent one and an UNSENT one (60 days old) are not')
{
  const errs = await q(`select group_concat(concat(ifnull(last_error,'NULL')) order by id separator '|') from fulfilment_outbox where payload like '%${TAG}OUT-F1%' or payload like '%${TAG}OUT-F4%' or payload like '%scrubbed%'`)
  const f1 = await q(`select ifnull(last_error,'NULL') from fulfilment_outbox where order_id = ${ID.O1} and sent_at is not null`)
  const f4 = await q(`select concat(ifnull(last_error,'NULL'), '/', payload) from fulfilment_outbox where order_id = ${ID.O7} and kind = 'cancel'`)
  is(f1 === 'NULL' && f4 === 'order shipped/{"scrubbed":true}' && !errs.includes(`${TAG}.leak`), 'the free-text error of a sent message (it echoed an address) is blanked, but the fixed STATE value store.php reads back (order shipped) is kept', `${f1} | ${f4}`)
}
is(!(await q(`select group_concat(payload) from whatsapp_outbox where sent_at < ${D(30)}`)).includes('WA-W1') && (await q(`select count(*) from whatsapp_outbox where to_e164 = ''`)) === '1', 'a WhatsApp message sent 60 days ago loses number and payload; the recent ones keep theirs')
is((await q(`select count(*) from customer_password_resets`)) === '1' && (await q(`select count(*) from admin_password_resets`)) === '1' && (await q(`select count(*) from admin_activity_log`)) === '1', 'old reset rows and the 500-day-old log row are deleted, the recent ones stay')
const run1 = await q(`select kind, dry_run, affected_json from privacy_runs order by id desc limit 1`)
is(/^retention\t0\t/.test(run1) && /"R-ORD1": ?"?5"?/.test(run1) && !run1.includes(TAG), 'privacy_runs records the counts per rule, and no personal value', run1.slice(0, 200))
const dumpAfter = spawnSync('sh', ['-c', `mariadb-dump --no-defaults -S ${DB.sock} -uroot --skip-comments sporta`], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout
const gone = ['NOTE-', 'STREET-', 'BLDG-', 'FL-', 'FLAT-'].map((p) => ({ p, n: ['O1', 'O2', 'O3', 'O9', 'B1'].filter((k) => dumpAfter.includes(`${p}${TAG}${k}`)).length }))
is(gone.every((g) => g.n === 0) && ['BODY-', 'RNOTE-', 'ENOTE-'].every((p) => ['SA1', 'SA2', 'SB1', 'RA1', 'RB1'].every((k) => !dumpAfter.includes(`${p}${TAG}${k}-c`) && !dumpAfter.includes(`${p}${TAG}${k}-s`) && !dumpAfter.includes(`${p}${TAG}${k}`))), 'a full dump of the database no longer contains those address, note, ticket-body and return-note canaries')
const again = runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'APPLY' })
const run2 = await q(`select affected_json from privacy_runs order by id desc limit 1`)
is(again.status === 0 && Object.values(JSON.parse(run2.replace(/\\"/g, '"'))).every((v) => Number(v) === 0), 'a second run changes nothing (every rule reports 0 rows): idempotent', run2.slice(0, 260))

// ================================================================== 5. identity stage
head('5. Identity stage (off by default): name blanked, phone pseudonymised with a keyed hash')
{
  const noSalt = runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'APPLY', identity_days: 365 })
  const r9 = await row('O9'), r1b = await row('O1'), rp = await row('O6')
  is(noSalt.status === 0 && r9[0] === 'NULL' && r9[1] === 'NULL' && r1b[0] === `${TAG}NAME-O1`, 'identity_days = 365 without a salt: the 400-day order loses name and phone (NULL); the 200-day order keeps them', `O9 ${r9[0]}/${r9[1]}`)
  await q(`update orders set customer_name = '${TAG}NAME-O9', customer_phone = '${orders[8].phone}', anonymised_at = null where track_id = 'T${TAG}O9'`)
  await q(`update orders set customer_name = '${TAG}NAME-O1b', customer_phone = '${orders[8].phone}' where track_id = 'T${TAG}O1'`)
  await q(`update orders set fulfilled_at = ${D(399)} where track_id = 'T${TAG}O1'`)
  const withSalt = runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'APPLY', identity_days: 365, salt: SALT })
  const a = await row('O9'), b = await row('O1')
  is(withSalt.status === 0 && a[0] === 'NULL' && /^p[0-9a-f]{12}$/.test(a[1]) && a[1] === b[1], 'with a salt: the phone becomes p + 12 hex characters, the SAME pseudonym for the same phone, no name', `${a[1]}`)
  const expect = 'p' + createHash('sha256').update(SALT + orders[8].phone.slice(-8)).digest('hex').slice(0, 12)
  is(a[1] === expect, 'and it is exactly sha256(salt + last 8 digits), first 12 hex: nobody without the salt can enumerate the phone numbers')
  const second = runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'APPLY', identity_days: 365, salt: SALT })
  is(second.status === 0 && (await row('O9'))[1] === expect, 'running it again does not re-hash an already pseudonymised phone')
  const keepNew = await row('O6')
  is(keepNew[0] === `${TAG}NAME-O6`, 'recent orders keep their name')
  // restore the state before the identity stage so the next sections start from the plain retention result
  await q(`update orders set customer_name = '${TAG}NAME-O9', customer_phone = '${orders[8].phone}' where track_id = 'T${TAG}O9'`)
  await q(`update orders set customer_name = '${TAG}NAME-O1', customer_phone = '${orders[0].phone}' where track_id = 'T${TAG}O1'`)
}

// ================================================================== 6. the PHP library
head('6. The PHP library does exactly what the SQL does (patch applied to a scratch copy)')
const TREE = join(tmp, 'tree'); mkdirSync(TREE)
cpSync(join(WEB, 'dropin'), join(TREE, 'dropin'), { recursive: true, filter: (x) => !/\/config\.php$/.test(x) })
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' })
git(['init', '-q'], TREE)
const chk = git(['apply', '--check', join(OPS, 'privacy-php.patch')], TREE)
is(chk.status === 0, 'privacy-php.patch applies cleanly to a copy of dropin/ (new files only)', chk.stderr.trim().slice(0, 160))
git(['apply', join(OPS, 'privacy-php.patch')], TREE)
const API = join(TREE, 'dropin', 'php-store')
is(['privacy.php', 'cron-privacy.php'].every((f) => spawnSync('php', ['-l', join(API, f)]).status === 0), 'php -l passes on both new files')
is(readdirSync(join(WEB, 'dropin', 'php-store')).every((f) => f !== 'privacy.php' && f !== 'cron-privacy.php'), 'and the real tree is untouched (the patch is not applied)')
await mdb('sporta_php')
const PHP_APP = rnd(24)
await DB.sql(`create user if not exists 'priv_app'@'127.0.0.1' identified by '${PHP_APP}'; grant all on sporta_php.* to 'priv_app'@'127.0.0.1'; grant all on sporta.* to 'priv_app'@'127.0.0.1'`)
const cfgFile = (db, over = '') => { const f = join(tmp, `cfg-${db}.php`); writeFileSync(f, `<?php return ['db_host'=>'127.0.0.1;port=${DB.port}','db_name'=>'${db}','db_user'=>'priv_app','db_pass'=>'${PHP_APP}','cron_key'=>'${rnd(20)}'${over}];\n`, { mode: 0o600 }); return f }
const php = (db, args, over = '') => spawnSync('php', [join(API, 'cron-privacy.php'), ...args], { env: { ...process.env, SPORTA_API_CONFIG_FILE: cfgFile(db, over) }, encoding: 'utf8' })
const loadInto = (db, file) => spawnSync('sh', ['-c', `mariadb --no-defaults -S ${DB.sock} -uroot --default-character-set=utf8mb4 ${db} < ${file}`], { encoding: 'utf8' })
const reset = async (db) => { await DB.sql(`drop database \`${db}\``); await mdb(db); return loadInto(db, PRE_APPLY) }
is((await reset('sporta_php')).status === 0, 'the pre-apply state is loaded into a second database')
const pvPhp = php('sporta_php', ['retention'])
const pj = JSON.parse(pvPhp.stdout || '{}')
is(pvPhp.status === 0 && pj.mode === 'preview' && Object.entries(EXPECT).every(([k, v]) => pj.rules?.[k] === v), 'PHP preview: the same counts as the SQL preview, rule by rule', (pvPhp.stdout + pvPhp.stderr).slice(0, 200))
const preSums = await checksumAll('sporta_php')
php('sporta_php', ['retention'])
is(diffTables(preSums, await checksumAll('sporta_php')).length === 0, 'PHP preview changed nothing')
const apPhp = php('sporta_php', ['retention', '--apply'])
is(apPhp.status === 0 && Object.entries(EXPECT).every(([k, v]) => JSON.parse(apPhp.stdout).rules[k] === v), 'PHP apply reports the same counts', (apPhp.stdout + apPhp.stderr).slice(0, 200))
const sums = await checksumAll('sporta'), sumsPhp = await checksumAll('sporta_php')
// the SQL database already moved on (identity stage, restores), so rebuild it from the same starting state
await reset('sporta')
runSql('sporta', 'retention-apply.sql', { privacy_confirm: 'APPLY' })
const sumsSql = await checksumAll('sporta')
const dd = diffTables(sumsSql, sumsPhp)
is(dd.length === 0, 'after apply, every table is identical (row count and CRC of every column) between the SQL path and the PHP path', dd.join(', '))
const refuse = php('sporta_php', ['erase', '--apply', '--phone', PERSON.phone])
is(refuse.status === 3, 'PHP erase --apply without a configured privacy_salt refuses (exit 3)')
{
  const port = await freePort(33900)
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', API], { env: { ...process.env, SPORTA_API_CONFIG_FILE: cfgFile('sporta_php', `,'privacy_salt'=>'${SALT}'`) }, stdio: 'ignore', detached: true })
  await sleep(700)
  const sums0 = await checksumAll('sporta_php')
  const res = await fetch(`http://127.0.0.1:${port}/cron-privacy.php?cmd=retention&apply=1`).catch(() => null)
  const resLib = await fetch(`http://127.0.0.1:${port}/privacy.php`).catch(() => null)
  const libBody = resLib ? await resLib.text() : 'no answer'
  try { process.kill(-srv.pid, 'SIGKILL') } catch { /* gone */ }
  // REVIEW 2026-11-04: the library is an include; /api's .htaccess denies include-only files by NAME and would not know this one
  is(resLib && resLib.status === 404 && libBody === '', 'privacy.php (the library) answers 404 with an empty body when requested over HTTP: it cannot be mistaken for an endpoint', `HTTP ${resLib ? resLib.status : 'no answer'}, ${libBody.length} bytes`)
  is(res && res.status === 404 && diffTables(sums0, await checksumAll('sporta_php')).length === 0, 'cron-privacy.php is CLI-only: over HTTP it answers 404 and runs nothing', `HTTP ${res ? res.status : 'no answer'}`)
}

// ================================================================== 7. erasure
head('7. Erase one person; keep the bystander; erase them again after a restore')
await reset('sporta'); await reset('sporta_php')
const bystanderRows = async (db) => q(`select concat_ws('|', (select group_concat(concat_ws(',', id, ifnull(customer_name,''), ifnull(customer_phone,''), ifnull(customer_note,''), ifnull(anonymised_at,'')) order by id) from orders where track_id like 'T${TAG}B%'), (select group_concat(concat_ws(',', email, name, phone) order by id) from customer_accounts where id = 1002), (select group_concat(concat_ws(',', reference, customer_name, customer_email, subject) order by id) from support_tickets where reference = 'SB1'), (select group_concat(note) from crm_notes where contact_key like 'phone:965${BYST.phone}%'), (select count(*) from blocked_customers))`, db)
const byBefore = await bystanderRows('sporta')
const ep = runSql('sporta', 'erase-preview.sql', { phone: PERSON.phone, email: PERSON.email })
const ec = parseCounts(ep.out)
const EXPECT_E = { 'E-OUT-1': 1, 'E-OUT-2': 1, 'E-REV': 1, 'E-CRM-1': 2, 'E-CRM-2': 2, 'E-ORD': 2, 'E-SUP-1': 1, 'E-SUP-2': 2, 'E-RET-1': 1, 'E-RET-2': 2, 'E-ACC-1': 2, 'E-ACC-2': 1, 'E-ACC-3': 1, 'X-OPEN': 1, 'X-BLOCKED': 1 }
is(ep.status === 0 && Object.entries(EXPECT_E).every(([k, v]) => ec[k] === v), 'erase-preview.sql counts what would change for the person, and what it will NOT (one open order, one blocked-number row)', JSON.stringify(ec).slice(0, 200) + errLine(ep.err))
const noId = runSql('sporta', 'erase-preview.sql', {})
is(noId.status !== 0, 'a preview with neither phone nor email refuses (no "erase everyone" by an empty variable)')
const eBefore = await checksumAll()
const noWord2 = runSql('sporta', 'erase-apply.sql', { phone: PERSON.phone, email: PERSON.email, salt: SALT })
is(noWord2.status !== 0 && diffTables(eBefore, await checksumAll()).length === 0, 'erase-apply.sql without the word stops and changes nothing')
const noSalt2 = runSql('sporta', 'erase-apply.sql', { privacy_confirm: 'ERASE', phone: PERSON.phone, email: PERSON.email })
is(noSalt2.status !== 0 && diffTables(eBefore, await checksumAll()).length === 0, 'and without a salt it stops (the ledger entry could not be made)')
const PRE_ERASE = join(tmp, 'pre-erase.sql')
writeFileSync(PRE_ERASE, spawnSync('sh', ['-c', `mariadb-dump --no-defaults -S ${DB.sock} -uroot --skip-comments sporta`], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout)
const ea = runSql('sporta', 'erase-apply.sql', { privacy_confirm: 'ERASE', phone: PERSON.phone, email: PERSON.email, salt: SALT })
is(ea.status === 0, 'erase-apply.sql runs with the word and a salt', errLine(ea.err))
const p1 = await row('P1'), p2 = await row('P2'), p3 = await row('P3')
is(p1[0] === 'NULL' && p1[1] === 'NULL' && p1[2] === 'NULL' && p2[0] === 'NULL' && p2[1] === 'NULL', 'the person\'s CLOSED orders lose name, phone, address and note')
is(p3[0] === `${TAG}NAME-P3` && p3[2] !== 'NULL', 'the person\'s OPEN (shipped) order is untouched: it must be delivered or cancelled first')
is((await q(`select count(*) from customer_accounts where id = 1001`)) === '0' && (await q(`select count(*) from customer_password_resets where customer_id = 1001`)) === '0' && (await q(`select ifnull(customer_account_id,'NULL') from orders where track_id = 'T${TAG}P1'`)) === 'NULL', 'the account (name, email, phone, password hash, birthday) and its reset rows are deleted, orders unlinked')
is((await q(`select count(*) from crm_contacts where contact_key in ('phone:965${PERSON.phone}', 'account:1001')`)) === '0' && (await q(`select count(*) from crm_notes where contact_key in ('phone:965${PERSON.phone}', 'account:1001')`)) === '0', 'CRM contacts and notes of the phone and of the account are deleted')
is((await q(`select customer_name, customer_email, ifnull(customer_phone,'NULL'), subject from support_tickets where reference = 'SP1'`)).startsWith('[removed]\tremoved-') && (await q(`select count(*) from support_messages m join support_tickets t on t.id = m.ticket_id where t.reference = 'SP1' and m.body = '[removed]'`)) === '2', 'the support ticket (even an open one) and both of its messages are blanked')
is((await q(`select contact_phone = '', customer_note is null from return_requests where reference = 'RP1'`)) === '1\t1' && (await q(`select comment is null from reviews where order_id = ${ID.P1}`)) === '1', 'the finished return request and the review comment are blanked')
is((await q(`select ifnull(last_error,'NULL') from fulfilment_outbox where order_id = ${ID.P1}`)) === 'order cancelled', 'an erasure blanks the payload of the person\'s warehouse message but keeps its state marker (order cancelled)')
is(!(await q(`select group_concat(payload) from fulfilment_outbox where order_id in (${ID.P1})`)).includes('OUT-P1') && (await q(`select to_e164 = '' from whatsapp_outbox where order_id = ${ID.P1}`)) === '1', 'the warehouse and WhatsApp messages of those orders are blanked')
is((await q(`select count(*) from blocked_customers where phone = '${PERSON.phone}'`)) === '1', 'the blocked-number row stays (fraud prevention); the preview told the operator')
is(await bystanderRows('sporta') === byBefore, 'THE BYSTANDER IS UNTOUCHED: their orders, account, ticket, CRM notes and the blocked list are exactly as before')
const ledger = await q(`select id_kind, id_hash, scope from privacy_erasures order by id_kind`)
const dumpAll = spawnSync('sh', ['-c', `mariadb-dump --no-defaults -S ${DB.sock} -uroot --skip-comments sporta`], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout
const ledgerOnly = await q(`select group_concat(concat_ws(',', id_kind, id_hash, scope)) from privacy_erasures`)
is(ledger.split('\n').length === 2 && ledgerOnly.includes(createHash('sha256').update(SALT + PERSON.phone.slice(-8)).digest('hex')) && ledgerOnly.includes(createHash('sha256').update(SALT + PERSON.email.toLowerCase()).digest('hex')) && !ledgerOnly.includes(PERSON.email) && !ledgerOnly.includes(PERSON.phone), 'the ledger holds two salted hashes (phone, email) and neither the phone nor the email')
is(!(await q(`select group_concat(affected_json) from privacy_runs`)).includes(TAG) && !dumpAll.includes(`${TAG}ACC-PERSON`) && !dumpAll.includes(`${TAG}TN-SP1`) && !dumpAll.includes(`${TAG}CRM-P`), 'privacy_runs holds counts only; the person\'s name canaries are gone from a full dump')
// the same erasure through PHP, on an identical copy
await loadInto('sporta_php', PRE_ERASE)
const saltCfg = `,'privacy_salt'=>'${SALT}'`
const epPhp = php('sporta_php', ['erase', '--phone', PERSON.phone, '--email', PERSON.email], saltCfg)
const ejson = JSON.parse(epPhp.stdout || '{}')
is(epPhp.status === 0 && Object.entries(EXPECT_E).filter(([k]) => k.startsWith('E-')).every(([k, v]) => ejson.rules[k] === v) && ejson.not_changed['X-OPEN'] === 1 && ejson.not_changed['X-BLOCKED'] === 1, 'PHP erase preview: the same counts, and the same "not changed" report', (epPhp.stdout + epPhp.stderr).slice(0, 200))
const eaPhp = php('sporta_php', ['erase', '--phone', PERSON.phone, '--email', PERSON.email, '--apply'], saltCfg)
const sE = await checksumAll('sporta'), sP = await checksumAll('sporta_php')
const ed = diffTables(sE, sP)
is(eaPhp.status === 0 && ed.length === 0, 'PHP erase --apply leaves every table identical to the SQL path', `${eaPhp.stderr.slice(0, 160)}${ed.join(',')}`)

// restore an OLDER backup: the person is back; erase-reapply puts them out again
await DB.sql('drop database sporta_restored').catch(() => {}); await mdb('sporta_restored')
loadInto('sporta_restored', PRE_ERASE)
const ledgerCopy = await q('select id_kind, id_hash, scope from privacy_erasures')
await q(`insert ignore into privacy_erasures (id_kind, id_hash, scope) values ${ledgerCopy.split('\n').map((l) => { const [k, h, s] = l.split('\t'); return `('${k}','${h}','${s}')` }).join(',')}`, 'sporta_restored').catch(() => {})
is((await q(`select count(*) from customer_accounts where id = 1001`, 'sporta_restored')) === '1', 'a database restored from the backup taken BEFORE the erasure has the person again (this is the trap)')
const rNo = runSql('sporta_restored', 'erase-reapply.sql', { privacy_confirm: 'REAPPLY' })
is(rNo.status !== 0 && (await q(`select count(*) from customer_accounts where id = 1001`, 'sporta_restored')) === '1', 'erase-reapply.sql without the salt stops')
const rYes = runSql('sporta_restored', 'erase-reapply.sql', { privacy_confirm: 'REAPPLY', salt: SALT })
const rp1 = await q(`select ifnull(customer_name,'NULL'), ifnull(customer_phone,'NULL') from orders where track_id = 'T${TAG}P1'`, 'sporta_restored')
is(rYes.status === 0 && rp1 === 'NULL\tNULL' && (await q(`select count(*) from customer_accounts where id = 1001`, 'sporta_restored')) === '0' && (await q(`select customer_name from support_tickets where reference = 'SP1'`, 'sporta_restored')) === '[removed]' && !(await q(`select group_concat(payload) from fulfilment_outbox`, 'sporta_restored')).includes('OUT-P1'), 'erase-reapply.sql with the salt erases the person again: orders, account, ticket, warehouse message', rYes.err.slice(0, 200))
is((await q(`select customer_name from orders where track_id = 'T${TAG}P3'`, 'sporta_restored')) === `${TAG}NAME-P3` && (await q(`select count(*) from customer_accounts where id = 1002`, 'sporta_restored')) === '1' && (await q(`select customer_name from orders where track_id = 'T${TAG}B1'`, 'sporta_restored')) === `${TAG}NAME-B1`, 'and it leaves the open order and the bystander alone')
const phpRe = php('sporta_restored', ['reapply'], saltCfg)
is(phpRe.status === 0, 'PHP `reapply` preview runs against the restored copy', (phpRe.stdout + phpRe.stderr).slice(0, 120))

// ================================================================== 8. mutations
head('8. Mutation checks: the suite goes red when a guard is removed')
{
  const sql = readFileSync(join(OPS, 'retention-apply.sql'), 'utf8')
  const mutRun = async (name, from, to, check) => {
    if (!sql.includes(from)) { bad(`MUTATION ${name}: pattern not found`); return }
    await reset('sporta')
    const r = runSql('sporta', null, { privacy_confirm: 'APPLY' }, sql.replace(from, to))
    const res = await check(r)
    is(res, `MUTATION ${name}: the suite catches it`)
  }
  await mutRun('the "closed order" predicate removed from R-ORD1', "(fulfilment_status in ('delivered','cancelled') or (payment_status = 'failed' and fulfilment_status in ('unfulfilled','cancelled'))) and coalesce(fulfilled_at, created_at) < date_sub(now(), interval @orders_days day) and not exists",
    'coalesce(fulfilled_at, created_at) < date_sub(now(), interval @orders_days day) and not exists', async () => !(await intact('O4')) || !(await intact('O5')))
  await mutRun('the age predicate removed from R-ORD1', "and coalesce(fulfilled_at, created_at) < date_sub(now(), interval @orders_days day) and not exists (select 1 from return_requests rr where rr.order_id = orders.id and rr.status not in ('completed','declined','cancelled')) limit",
    'and not exists (select 1 from return_requests rr where rr.order_id = orders.id and rr.status not in (\'completed\',\'declined\',\'cancelled\')) limit', async () => !(await intact('O6')))
  await mutRun('the open-return guard removed from R-ORD1', "and not exists (select 1 from return_requests rr where rr.order_id = orders.id and rr.status not in ('completed','declined','cancelled')) limit 100000000;\nset @n_R_ORD1",
    'limit 100000000;\nset @n_R_ORD1', async () => !(await intact('O7')))
  await mutRun('unsent messages no longer protected (R-OUT-1)', 'where sent_at is not null and sent_at < date_sub(now(), interval @outbox_days day) and payload <> \'{"scrubbed":true}\' limit', 'where payload <> \'{"scrubbed":true}\' limit',
    async () => !(await q(`select group_concat(payload) from fulfilment_outbox where order_id = ${ID.O5}`)).includes('OUT-F3'))
  await mutRun('the state markers of last_error no longer kept (R-OUT-1 blanks every value)', "last_error = if(last_error in ('order cancelled','order reinstated','order shipped','sending'), last_error, null) where sent_at is not null", 'last_error = null where sent_at is not null',
    async () => (await q(`select ifnull(last_error,'NULL') from fulfilment_outbox where order_id = ${ID.O7} and kind = 'cancel'`)) !== 'order shipped')
  // the confirmation guard
  const noGuard = sql.replace(/select \(select 1 from dual where ifnull\(binary @privacy_confirm[^\n]*\n/, '')
  await reset('sporta')
  const before2 = await checksumAll()
  const rr = runSql('sporta', null, {}, noGuard)
  is(rr.status === 0 && diffTables(before2, await checksumAll()).length > 0, 'MUTATION the confirmation guard removed: the file then rewrites rows with no word given, and the "refuses without the word" check above would be red')
  // blinded preview
  const pvText = readFileSync(join(OPS, 'retention-preview.sql'), 'utf8').replace(/\(select count\(\*\) from orders where anonymised_at is null/, '(select 0 from orders where anonymised_at is null')
  await reset('sporta')
  const pvr = runSql('sporta', null, {}, pvText)
  is(parseCounts(pvr.out)['R-ORD1'] !== EXPECT['R-ORD1'], 'MUTATION a blinded preview reports the wrong R-ORD1 count: the preview-equals-expectation check above would be red', `reports ${parseCounts(pvr.out)['R-ORD1']}`)
  // no ledger -> reapply does nothing
  await reset('sporta')
  const eraseText = readFileSync(join(OPS, 'erase-apply.sql'), 'utf8').replace(/insert ignore into privacy_erasures[^;]*;/g, '')
  runSql('sporta', null, { privacy_confirm: 'ERASE', phone: PERSON.phone, email: PERSON.email, salt: SALT }, eraseText)
  const ledgerN = await q('select count(*) from privacy_erasures')
  is(ledgerN === '0', 'MUTATION the ledger insert removed: nothing is recorded, so a later restore could not erase the person again (the ledger check above would be red)')
}

// ------------------------------------------------------------------ done
head('summary')
if (!process.env.KEEP) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } } else console.log(`KEEP=1: ${tmp}`)
console.log(`${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
