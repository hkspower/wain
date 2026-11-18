#!/usr/bin/env node
// LIVE USERS SCAN (owner: "check users", 2026-11-18). READ ONLY, AGGREGATES ONLY.
//
//   node scripts/live-users-scan.mjs --config /run/sporta-api-config.php          (the one-shot VPS job)
//   DB_SOCKET=/run/mysqld/mysqld.sock DB_USER=root DB_NAME=sporta node scripts/live-users-scan.mjs     (the local rig)
//
// Answers, for every kind of user the shop has: how many, which are complete / verified / locked / stale, what looks wrong, and what is left
// over from tests. It sends only SELECT and SHOW through the same gate as db-schema-live-diff.mjs (the session is READ ONLY at the server too: the
// scan refuses to start unless @@tx_read_only reads 1) and it PRINTS NO NAME, E-MAIL, PHONE, ADDRESS, IP, HASH OR TOKEN. What it prints is counts,
// yes/no answers and age buckets. The one account it names is the test customer the owner approved on 2026-11-10 (qa-profile@..., see CLAUDE.md),
// so it can be removed when the owner wants.
//
// Each question is asked on its own: a column or table the live database does not have is reported as "not there" and the scan goes on.
import { MySQL, Gate, credentials, scrub } from './db-schema-live-diff.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : [null, null])).filter(([k]) => k))
const QA_EMAIL = 'qa-profile@sporta.com.kw'   // the approved test customer; the only address this tool ever prints

let cred
try { cred = credentials(args) } catch (e) { console.error(`live-users-scan: ${e.message}`); process.exit(2) }
const secrets = [cred.password, cred.user]
const conn = new MySQL(cred)
try { await conn.connect() } catch (e) { console.error(`live-users-scan: cannot connect: ${scrub(e.message, secrets)}`); process.exit(2) }
const gate = new Gate(conn)
try { await gate.readOnly() } catch (e) { console.error(`live-users-scan: ${scrub(e.message, secrets)}`); process.exit(2) }

const out = []
const say = (s = '') => out.push(s)
const h = (s) => { say(); say(`## ${s}`) }
const row = (k, v) => say(`- ${k}: ${v}`)
const NA = 'not there'

// one question, answered or "not there" (an unknown column or table is an answer, not a failure)
async function ask(sql) {
  try { return (await gate.query(sql)).rows } catch (e) {
    const m = scrub(e.message, secrets)
    if (/SQL error (1054|1146|1064)/.test(m)) return null
    throw e
  }
}
const one = async (sql) => { const r = await ask(sql); return r === null ? null : (r[0]?.[0] ?? null) }
const num = (v) => (v === null || v === undefined ? NA : Number(v))
const cols = {}
async function columnsOf(t) {
  if (cols[t]) return cols[t]
  const r = await ask(`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${t}'`)
  return (cols[t] = new Set((r ?? []).map((x) => x[0])))
}
const has = async (t, c) => (await columnsOf(t)).has(c)
const table = async (t) => (await columnsOf(t)).size > 0
const buckets = (r) => r === null ? NA : r.map(([k, n]) => `${k}: ${n}`).join(' · ') || 'none'

say('# Live users scan')
say(`Read-only (session read-only: yes). Aggregates only: no name, e-mail, phone, address, IP, hash or token is printed.`)

// ------------------------------------------------------------------ every user-like table
h('1. Tables that hold people')
{
  const r = await ask(`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name REGEXP 'user|account|customer|profile|member|crm|support|login|passkey|wishlist|session|recovery|reset|verification|contact|subscriber|newsletter' ORDER BY table_name`)
  for (const [t] of r ?? []) row('`' + t + '`', `${num(await one('SELECT COUNT(*) FROM `' + t + '`'))} rows`)
}

// ------------------------------------------------------------------ admins
h('2. Admin accounts (`admin_users`)')
if (!(await table('admin_users'))) row('admin_users', NA)
else {
  row('accounts', num(await one('SELECT COUNT(*) FROM admin_users')))
  const flag = async (label, where) => row(label, num(await one(`SELECT COUNT(*) FROM admin_users WHERE ${where}`)))
  if (await has('admin_users', 'totp_enabled')) await flag('authenticator (MFA) switched on', 'totp_enabled = 1')
  if (await has('admin_users', 'google_sub')) await flag('Google sign-in linked', "google_sub IS NOT NULL AND google_sub <> ''")
  if (await has('admin_users', 'must_change_password')) await flag('must change the password at next sign-in', 'must_change_password = 1')
  if (await has('admin_users', 'temporary_password_expires_at')) await flag('temporary password issued and never used', 'temporary_password_expires_at IS NOT NULL AND temporary_password_used_at IS NULL')
  if (await has('admin_users', 'failed_attempts')) await flag('with failed attempts counted now', 'failed_attempts > 0')
  if (await has('admin_users', 'locked_until')) await flag('locked right now', 'locked_until IS NOT NULL AND locked_until > NOW()')
  for (const c of ['passcode_hash', 'passcode_set_at', 'passcode_enabled']) if (await has('admin_users', c)) { await flag(`device passcode (${c}) set`, `${c} IS NOT NULL AND ${c} <> '' AND ${c} <> 0`); break }
  row('last sign-in', buckets(await ask(`SELECT CASE WHEN last_login_at IS NULL THEN 'never' WHEN last_login_at > NOW() - INTERVAL 7 DAY THEN 'within 7 days' WHEN last_login_at > NOW() - INTERVAL 30 DAY THEN 'within 30 days' WHEN last_login_at > NOW() - INTERVAL 90 DAY THEN 'within 90 days' ELSE 'older than 90 days' END AS b, COUNT(*) FROM admin_users GROUP BY b ORDER BY b`)))
  row('password hash kind', buckets(await ask(`SELECT CASE WHEN password_hash LIKE '$2y$%' THEN 'bcrypt' WHEN password_hash LIKE '$argon2%' THEN 'argon2' WHEN password_hash = '' THEN 'EMPTY' ELSE 'other' END AS k, COUNT(*) FROM admin_users GROUP BY k`)))
  if (await table('admin_recovery_codes')) row('recovery codes left (unused) · used', `${num(await one('SELECT COUNT(*) FROM admin_recovery_codes WHERE used_at IS NULL'))} · ${num(await one('SELECT COUNT(*) FROM admin_recovery_codes WHERE used_at IS NOT NULL'))}`)
  if (await table('admin_password_resets')) row('password-reset links outstanding (unused, unexpired)', num(await one('SELECT COUNT(*) FROM admin_password_resets WHERE used_at IS NULL AND expires_at > NOW()')))
}

h('3. What the admin log says (`admin_activity_log`)')
if (!(await table('admin_activity_log'))) row('admin_activity_log', NA)
else {
  row('rows · oldest · newest', `${num(await one('SELECT COUNT(*) FROM admin_activity_log'))} · ${await one('SELECT DATE(MIN(created_at)) FROM admin_activity_log') ?? NA} · ${await one('SELECT DATE(MAX(created_at)) FROM admin_activity_log') ?? NA}`)
  row('last 30 days by action', buckets(await ask(`SELECT action_key, COUNT(*) AS n FROM admin_activity_log WHERE created_at > NOW() - INTERVAL 30 DAY GROUP BY action_key ORDER BY n DESC LIMIT 15`)))
  row('failed sign-ins per day, last 14 days', buckets(await ask(`SELECT DATE(created_at) AS d, COUNT(*) FROM admin_activity_log WHERE created_at > NOW() - INTERVAL 14 DAY AND action_key LIKE '%fail%' GROUP BY d ORDER BY d`)))
  row('different people who acted in the last 30 days', num(await one(`SELECT COUNT(DISTINCT actor_email) FROM admin_activity_log WHERE created_at > NOW() - INTERVAL 30 DAY`)))
  row('actors in the log who are NOT an admin account today', num(await one(`SELECT COUNT(DISTINCT l.actor_email) FROM admin_activity_log l LEFT JOIN admin_users a ON a.email = l.actor_email WHERE a.id IS NULL AND l.actor_email <> ''`)))
}

// ------------------------------------------------------------------ customers
h('4. Customer accounts (`customer_accounts`)')
if (!(await table('customer_accounts'))) row('customer_accounts', NA)
else {
  const total = num(await one('SELECT COUNT(*) FROM customer_accounts'))
  row('accounts', total)
  row('created: last 7 days · 30 days · older', `${num(await one('SELECT COUNT(*) FROM customer_accounts WHERE created_at > NOW() - INTERVAL 7 DAY'))} · ${num(await one('SELECT COUNT(*) FROM customer_accounts WHERE created_at > NOW() - INTERVAL 30 DAY'))} · ${num(await one('SELECT COUNT(*) FROM customer_accounts WHERE created_at <= NOW() - INTERVAL 30 DAY'))}`)
  if (await has('customer_accounts', 'email_verified_at')) row('e-mail verified · not verified', `${num(await one('SELECT COUNT(*) FROM customer_accounts WHERE email_verified_at IS NOT NULL'))} · ${num(await one('SELECT COUNT(*) FROM customer_accounts WHERE email_verified_at IS NULL'))}`)
  else row('e-mail verification', 'column not there (migration customers.mysql.sql not applied)')
  if (await has('customer_accounts', 'apple_sub')) row('signed up with Apple', num(await one("SELECT COUNT(*) FROM customer_accounts WHERE apple_sub IS NOT NULL AND apple_sub <> ''")))
  row('phone: none · 965 + 8 digits starting 5/6/9 · other shape', `${num(await one("SELECT COUNT(*) FROM customer_accounts WHERE phone IS NULL OR phone = ''"))} · ${num(await one("SELECT COUNT(*) FROM customer_accounts WHERE phone REGEXP '^965[569][0-9]{7}$'"))} · ${num(await one("SELECT COUNT(*) FROM customer_accounts WHERE phone IS NOT NULL AND phone <> '' AND phone NOT REGEXP '^965[569][0-9]{7}$'"))}`)
  row('phone numbers used by more than one account', num(await one("SELECT COUNT(*) FROM (SELECT phone FROM customer_accounts WHERE phone IS NOT NULL AND phone <> '' GROUP BY phone HAVING COUNT(*) > 1) x")))
  row('e-mail addresses that differ only by upper/lower case', num(await one('SELECT COUNT(*) FROM (SELECT LOWER(email) FROM customer_accounts GROUP BY LOWER(email) HAVING COUNT(*) > 1) x')))
  row('e-mail provider', buckets(await ask(`SELECT CASE WHEN email LIKE '%@gmail.%' THEN 'gmail' WHEN email REGEXP '@(hotmail|outlook|live|msn)\\\\.' THEN 'microsoft' WHEN email LIKE '%@icloud.%' OR email LIKE '%@me.com' THEN 'apple' WHEN email LIKE '%@yahoo.%' THEN 'yahoo' WHEN email LIKE '%@sporta.com.kw' THEN 'sporta.com.kw (staff or test)' ELSE 'other' END AS p, COUNT(*) FROM customer_accounts GROUP BY p ORDER BY p`)))
  row('looks like a test (e-mail has test / example / qa / demo / fake)', num(await one("SELECT COUNT(*) FROM customer_accounts WHERE email REGEXP 'test|example|(^|[^a-z])qa([^a-z]|$)|demo|fake'")))
  row('password hash kind', buckets(await ask(`SELECT CASE WHEN password_hash LIKE '$2y$%' THEN 'bcrypt' WHEN password_hash LIKE '$argon2%' THEN 'argon2' WHEN password_hash = '' THEN 'EMPTY' ELSE 'other' END AS k, COUNT(*) FROM customer_accounts GROUP BY k`)))
  row('name missing or one character', num(await one("SELECT COUNT(*) FROM customer_accounts WHERE name IS NULL OR CHAR_LENGTH(TRIM(name)) < 2")))
  if (await has('orders', 'customer_account_id')) {
    row('accounts with an order · without any order', `${num(await one('SELECT COUNT(DISTINCT customer_account_id) FROM orders WHERE customer_account_id IS NOT NULL'))} · ${num(await one('SELECT COUNT(*) FROM customer_accounts a WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_account_id = a.id)'))}`)
    row('orders pointing at an account that is gone', num(await one('SELECT COUNT(*) FROM orders o LEFT JOIN customer_accounts a ON a.id = o.customer_account_id WHERE o.customer_account_id IS NOT NULL AND a.id IS NULL')))
  }
  if (await table('customer_password_resets')) row('password-reset links: outstanding · requested in the last 30 days', `${num(await one('SELECT COUNT(*) FROM customer_password_resets WHERE used_at IS NULL AND expires_at > NOW()'))} · ${num(await one('SELECT COUNT(*) FROM customer_password_resets WHERE created_at > NOW() - INTERVAL 30 DAY'))}`)
  if (await table('customer_email_verifications')) row('verification links: outstanding · unused and expired', `${num(await one('SELECT COUNT(*) FROM customer_email_verifications WHERE used_at IS NULL AND expires_at > NOW()'))} · ${num(await one('SELECT COUNT(*) FROM customer_email_verifications WHERE used_at IS NULL AND expires_at <= NOW()'))}`)
  const qa = await ask(`SELECT id, DATE(created_at) FROM customer_accounts WHERE email = '${QA_EMAIL}'`)
  row(`the approved test customer (${QA_EMAIL})`, qa && qa.length ? `STILL THERE (id ${qa[0][0]}, created ${qa[0][1]}): remove it from the CRM when the owner says` : 'not there')
}

// ------------------------------------------------------------------ people who ordered without an account
h('5. People in the orders')
if (!(await table('orders'))) row('orders', NA)
else {
  const withAccount = (await has('orders', 'customer_account_id'))
  row('orders', num(await one('SELECT COUNT(*) FROM orders')))
  if (withAccount) row('guest orders · with an account', `${num(await one('SELECT COUNT(*) FROM orders WHERE customer_account_id IS NULL'))} · ${num(await one('SELECT COUNT(*) FROM orders WHERE customer_account_id IS NOT NULL'))}`)
  row('different phone numbers', num(await one("SELECT COUNT(DISTINCT customer_phone) FROM orders WHERE customer_phone IS NOT NULL AND customer_phone <> ''")))
  row('phones with more than one order (returning customers)', num(await one("SELECT COUNT(*) FROM (SELECT customer_phone FROM orders WHERE customer_phone IS NOT NULL AND customer_phone <> '' GROUP BY customer_phone HAVING COUNT(*) > 1) x")))
  row('orders per phone', buckets(await ask(`SELECT CASE WHEN n = 1 THEN '1 order' WHEN n = 2 THEN '2 orders' WHEN n BETWEEN 3 AND 5 THEN '3-5 orders' ELSE '6 or more orders' END AS b, COUNT(*) FROM (SELECT customer_phone, COUNT(*) AS n FROM orders WHERE customer_phone IS NOT NULL AND customer_phone <> '' GROUP BY customer_phone) x GROUP BY b ORDER BY MIN(n)`)))
  row('orders with no phone or no name', num(await one("SELECT COUNT(*) FROM orders WHERE customer_phone IS NULL OR customer_phone = '' OR customer_name IS NULL OR TRIM(customer_name) = ''")))
  row('phones not in the 8-digit Kuwait shape (digits only, starts 5/6/9)', num(await one("SELECT COUNT(*) FROM orders WHERE customer_phone IS NOT NULL AND customer_phone <> '' AND customer_phone NOT REGEXP '^(965)?[569][0-9]{7}$'")))
  row('first order · latest order', `${await one('SELECT DATE(MIN(created_at)) FROM orders') ?? NA} · ${await one('SELECT DATE(MAX(created_at)) FROM orders') ?? NA}`)
}

// ------------------------------------------------------------------ CRM and support
h('6. CRM and support')
if (await table('crm_contacts')) {
  row('CRM contacts by status', buckets(await ask('SELECT status, COUNT(*) FROM crm_contacts GROUP BY status ORDER BY status')))
  row('follow-ups overdue (date passed, status not inactive)', num(await one("SELECT COUNT(*) FROM crm_contacts WHERE follow_up_at IS NOT NULL AND follow_up_at < CURDATE() AND status <> 'inactive'")))
  if (await table('crm_notes')) row('notes', num(await one('SELECT COUNT(*) FROM crm_notes')))
} else row('CRM', NA)
if (await table('support_tickets')) {
  row('support tickets by status', buckets(await ask('SELECT status, COUNT(*) FROM support_tickets GROUP BY status ORDER BY status')))
  row('open or waiting for more than 7 days', num(await one("SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_progress','waiting_customer') AND updated_at < NOW() - INTERVAL 7 DAY")))
  row('different people who wrote in', num(await one('SELECT COUNT(DISTINCT customer_email) FROM support_tickets')))
} else row('support tickets', NA)

// ------------------------------------------------------------------ the old build
h('7. Left over from the old build')
{
  const r = await ask(`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name IN ('customers','accounts','users','oc_customer','oc_user','profiles','members')`)
  if (!r || !r.length) row('old user tables', 'none')
  else for (const [t] of r) row('`' + t + '`', `${num(await one('SELECT COUNT(*) FROM `' + t + '`'))} rows (not used by this code)`)
}

await gate.end()
process.stdout.write(out.join('\n') + '\n')
process.stdout.write(`\nUSERS_SCAN_OK statements=${gate.sent.length}\n`)
