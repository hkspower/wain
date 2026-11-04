// THE ONE SOURCE of every statement that retires or erases personal data.
//
//   node ops/db/privacy-render.mjs            writes retention-preview.sql, retention-apply.sql, erase-preview.sql,
//                                             erase-apply.sql, erase-reapply.sql and privacy-php.patch from this file
//   node ops/db/privacy-render.mjs --check    exits 1 if any of them is stale
//
// The SQL files (run by an administrator through the job route) and the PHP library (the same statements
// through PDO, in the patch) are both GENERATED from the rules below, so they cannot drift apart; the suite
// (npm run test:db-privacy) runs both on identical data and compares the result table by table.
//
// A rule is   { id, title, table, preview, apply, limit }
//   {{name}}    a policy value or an identifier: @name in the SQL files, a bound parameter in PHP
//   {{limit}}   a batch size for UPDATE/DELETE ... LIMIT (a large number in the SQL files, 500 in PHP)
//   preview     a SELECT count(*) that matches EXACTLY the rows `apply` would change
//   limit:false the statement is a multi-table UPDATE/DELETE, which MariaDB does not allow LIMIT on
//
// WHAT NEVER CHANGES: the accounting columns of an order (track_id, amount, subtotal, discount_*, delivery_fee,
// payment_*, cbk_*, fulfilment_status, timestamps, utm_*, stock_*), order_items, order_tracking_events. A rule
// only blanks the columns named in its SET list.

export const VARS = {
  orders_days: 90, identity_days: 0, support_days: 365, returns_days: 365, outbox_days: 30, resets_days: 30, activity_days: 400,
  salt: '', phone: '', email: '',
}

// An order is CLOSED when nothing more will happen to it: delivered, cancelled, or a payment that failed before
// anything was packed. Shipped, packed and still-pending orders are never touched.
const CLOSED = `(fulfilment_status in ('delivered','cancelled') or (payment_status = 'failed' and fulfilment_status in ('unfulfilled','cancelled')))`
const NO_OPEN_RETURN = `not exists (select 1 from return_requests rr where rr.order_id = orders.id and rr.status not in ('completed','declined','cancelled'))`
const ADDRESS_NULL = `customer_note = null, customer_block = null, customer_street = null, customer_building = null, customer_floor = null, customer_flat = null`
const SCRUB = `'{"scrubbed":true}'`
// fulfilment_outbox.last_error is NOT only diagnosis text: store.php uses four fixed values of it as STATE ('order cancelled', 'order reinstated',
// 'order shipped' = a row closed without being mailed; 'sending' = in flight) to decide what a later cancel or reinstate must send. Blanking them
// would turn a closed row into one that looks mailed. The rules therefore blank every OTHER value (a mail error can echo an address) and keep
// these four, which are constants and personal to nobody. (Independent review 2026-11-04; the WhatsApp queue has no such use of last_error.)
const OUTBOX_KEEP_ERR = `if(last_error in ('order cancelled','order reinstated','order shipped','sending'), last_error, null)`

// the last 8 digits of a phone number: Kuwait numbers are 8 digits, stored with or without 965 or a plus
const P8 = (col) => `right(regexp_replace(${col}, '[^0-9]', ''), 8)`
const PHONE_MATCH = (col) => `({{p8}} <> '' and ${P8(col)} = {{p8}})`
const EMAIL_MATCH = (col) => `({{em}} <> '' and lower(trim(${col})) = {{em}})`

function r(id, title, table, set, where, opts = {}) {
  const kind = opts.kind || 'update'
  const preview = opts.preview || `select count(*) from ${opts.from || table} where ${where}`
  const apply = kind === 'delete'
    ? `delete from ${table} where ${where}${opts.limit === false ? '' : ' limit {{limit}}'}`
    : `update ${opts.from || table} set ${set} where ${where}${opts.limit === false ? '' : ' limit {{limit}}'}`
  return { id, title, table, preview, apply, limit: opts.limit !== false, needs: opts.needs || [] }
}

// ---------------------------------------------------------------------------------------------- retention
export const RETENTION = [
  r('R-ORD1', 'closed orders older than {orders_days} days: blank the street address and the note (the map-location line lives there)', 'orders',
    `${ADDRESS_NULL}, anonymised_at = now()`,
    `anonymised_at is null and ${CLOSED} and coalesce(fulfilled_at, created_at) < date_sub(now(), interval {{orders_days}} day) and ${NO_OPEN_RETURN}`),
  r('R-ORD2', 'closed orders older than {identity_days} days (0 = off): blank the name, replace the phone by a keyed pseudonym (or blank it without a salt)', 'orders',
    `customer_name = null, customer_phone = if({{salt}} <> '', concat('p', left(sha2(concat({{salt}}, ${P8('customer_phone')}), 256), 12)), null), ${ADDRESS_NULL}, anonymised_at = coalesce(anonymised_at, now())`,
    `{{identity_days}} > 0 and ${CLOSED} and coalesce(fulfilled_at, created_at) < date_sub(now(), interval {{identity_days}} day) and (customer_name is not null or customer_phone regexp '^[+0-9]') and ${NO_OPEN_RETURN}`),
  r('R-SUP-1', 'resolved or closed support tickets older than {support_days} days: blank name, email, phone and subject', 'support_tickets',
    `customer_name = '[removed]', customer_email = concat('removed-', id, '@invalid.example'), customer_phone = null, subject = '[removed]', anonymised_at = now(), updated_at = updated_at`,
    `anonymised_at is null and status in ('resolved','closed') and coalesce(resolved_at, updated_at) < date_sub(now(), interval {{support_days}} day)`),
  r('R-SUP-2', 'messages of those tickets: blank the body and the customer author name', 'support_messages',
    `m.body = '[removed]', m.author_name = null`,
    `t.anonymised_at is not null and (m.body <> '[removed]' or m.author_name is not null)`,
    { from: 'support_messages m join support_tickets t on t.id = m.ticket_id', limit: false,
      preview: `select count(*) from support_messages m join support_tickets t on t.id = m.ticket_id where (t.anonymised_at is not null or (t.status in ('resolved','closed') and coalesce(t.resolved_at, t.updated_at) < date_sub(now(), interval {{support_days}} day))) and (m.body <> '[removed]' or m.author_name is not null)` }),
  r('R-RET-1', 'finished return requests older than {returns_days} days: blank the phone and the customer note', 'return_requests',
    `contact_phone = '', customer_note = null, anonymised_at = now(), updated_at = updated_at`,
    `anonymised_at is null and status in ('completed','declined','cancelled') and updated_at < date_sub(now(), interval {{returns_days}} day)`),
  r('R-RET-2', 'events of those requests: blank the note and the customer actor', 'return_request_events',
    `e.note = null, e.actor = if(e.actor_type = 'customer', null, e.actor)`,
    `r.anonymised_at is not null and (e.note is not null or (e.actor_type = 'customer' and e.actor is not null))`,
    { from: 'return_request_events e join return_requests r on r.id = e.request_id', limit: false,
      preview: `select count(*) from return_request_events e join return_requests r on r.id = e.request_id where (r.anonymised_at is not null or (r.status in ('completed','declined','cancelled') and r.updated_at < date_sub(now(), interval {{returns_days}} day))) and (e.note is not null or (e.actor_type = 'customer' and e.actor is not null))` }),
  r('R-OUT-1', 'warehouse messages SENT more than {outbox_days} days ago: blank the payload (the whole order) and the error text (the four fixed state values of last_error stay)', 'fulfilment_outbox',
    `payload = ${SCRUB}, last_error = ${OUTBOX_KEEP_ERR}`,
    `sent_at is not null and sent_at < date_sub(now(), interval {{outbox_days}} day) and payload <> ${SCRUB}`),
  r('R-OUT-2', 'WhatsApp messages SENT more than {outbox_days} days ago: blank the number, the payload and the error text', 'whatsapp_outbox',
    `to_e164 = '', payload = ${SCRUB}, last_error = null`,
    `sent_at is not null and sent_at < date_sub(now(), interval {{outbox_days}} day) and (payload <> ${SCRUB} or to_e164 <> '')`),
  r('R-RES-1', 'shopper password-reset rows older than {resets_days} days: delete', 'customer_password_resets', null,
    `created_at < date_sub(now(), interval {{resets_days}} day)`, { kind: 'delete' }),
  r('R-RES-2', 'staff password-reset rows older than {resets_days} days: delete', 'admin_password_resets', null,
    `created_at < date_sub(now(), interval {{resets_days}} day)`, { kind: 'delete' }),
  r('R-LOG-1', 'admin activity log rows older than {activity_days} days (0 = off): delete', 'admin_activity_log', null,
    `{{activity_days}} > 0 and created_at < date_sub(now(), interval {{activity_days}} day)`, { kind: 'delete', needs: ['DELETE on admin_activity_log (no runtime account has it)'] }),
]

// ---------------------------------------------------------------------------------------------- erasure
// Identifier: a phone ({{p8}}: its last 8 digits) and/or an email ({{em}}: trimmed, lower case).
// Order matters: rows that are FOUND through the order or the account are handled before that order or account
// is changed.
const ORDER_MATCH = `${PHONE_MATCH('customer_phone')}`
export const ERASE = [
  r('E-OUT-1', 'warehouse messages of the closed orders of this phone: blank payload and error', 'fulfilment_outbox',
    `payload = ${SCRUB}, last_error = ${OUTBOX_KEEP_ERR}`,
    `payload <> ${SCRUB} and order_id in (select o.id from orders o where ${PHONE_MATCH('o.customer_phone')} and ${CLOSED.replace(/(fulfilment_status|payment_status)/g, 'o.$1')})`),
  r('E-OUT-2', 'WhatsApp messages to this number or about its closed orders: blank number, payload and error', 'whatsapp_outbox',
    `to_e164 = '', payload = ${SCRUB}, last_error = null`,
    `(payload <> ${SCRUB} or to_e164 <> '') and ({{p8}} <> '' and ${P8('to_e164')} = {{p8}} or order_id in (select o.id from orders o where ${PHONE_MATCH('o.customer_phone')} and ${CLOSED.replace(/(fulfilment_status|payment_status)/g, 'o.$1')}))`),
  r('E-REV', 'reviews of the closed orders of this phone: blank the comment', 'reviews',
    `comment = null`,
    `comment is not null and order_id in (select o.id from orders o where ${PHONE_MATCH('o.customer_phone')} and ${CLOSED.replace(/(fulfilment_status|payment_status)/g, 'o.$1')})`),
  r('E-CRM-1', 'CRM notes of this phone or account: delete', 'crm_notes', null,
    `(contact_key like 'phone:%' and {{p8}} <> '' and right(contact_key, 8) = {{p8}}) or contact_key in (select concat('account:', a.id) from customer_accounts a where ${PHONE_MATCH('a.phone')} or ${EMAIL_MATCH('a.email')})`,
    { kind: 'delete' }),
  r('E-CRM-2', 'CRM contacts of this phone or account: delete', 'crm_contacts', null,
    `(contact_key like 'phone:%' and {{p8}} <> '' and right(contact_key, 8) = {{p8}}) or contact_key in (select concat('account:', a.id) from customer_accounts a where ${PHONE_MATCH('a.phone')} or ${EMAIL_MATCH('a.email')})`,
    { kind: 'delete' }),
  r('E-ORD', 'CLOSED orders of this phone: blank name, phone, address and note (accounting columns stay)', 'orders',
    `customer_name = null, customer_phone = null, ${ADDRESS_NULL}, anonymised_at = coalesce(anonymised_at, now())`,
    `${ORDER_MATCH} and ${CLOSED} and ${NO_OPEN_RETURN}`),
  r('E-SUP-1', 'support tickets of this email or phone: blank name, email, phone, subject (any status)', 'support_tickets',
    `customer_name = '[removed]', customer_email = concat('removed-', id, '@invalid.example'), customer_phone = null, subject = '[removed]', anonymised_at = coalesce(anonymised_at, now()), updated_at = updated_at`,
    `anonymised_at is null and (${EMAIL_MATCH('customer_email')} or ${PHONE_MATCH('customer_phone')})`),
  r('E-SUP-2', 'messages of anonymised tickets: blank body and customer author name', 'support_messages',
    `m.body = '[removed]', m.author_name = null`,
    `t.anonymised_at is not null and (m.body <> '[removed]' or m.author_name is not null)`,
    { from: 'support_messages m join support_tickets t on t.id = m.ticket_id', limit: false,
      preview: `select count(*) from support_messages m join support_tickets t on t.id = m.ticket_id where (t.anonymised_at is not null or ${EMAIL_MATCH('t.customer_email')} or ${PHONE_MATCH('t.customer_phone')}) and (m.body <> '[removed]' or m.author_name is not null)` }),
  r('E-RET-1', 'FINISHED return requests of this phone: blank phone and note', 'return_requests',
    `contact_phone = '', customer_note = null, anonymised_at = coalesce(anonymised_at, now()), updated_at = updated_at`,
    `anonymised_at is null and status in ('completed','declined','cancelled') and ${PHONE_MATCH('contact_phone')}`),
  r('E-RET-2', 'events of anonymised return requests: blank note and customer actor', 'return_request_events',
    `e.note = null, e.actor = if(e.actor_type = 'customer', null, e.actor)`,
    `r.anonymised_at is not null and (e.note is not null or (e.actor_type = 'customer' and e.actor is not null))`,
    { from: 'return_request_events e join return_requests r on r.id = e.request_id', limit: false,
      preview: `select count(*) from return_request_events e join return_requests r on r.id = e.request_id where (r.anonymised_at is not null or (r.status in ('completed','declined','cancelled') and ${PHONE_MATCH('r.contact_phone')})) and (e.note is not null or (e.actor_type = 'customer' and e.actor is not null))` }),
  r('E-ACC-1', 'reset rows of this account: delete', 'customer_password_resets', null,
    `customer_id in (select a.id from customer_accounts a where ${PHONE_MATCH('a.phone')} or ${EMAIL_MATCH('a.email')})`, { kind: 'delete' }),
  r('E-ACC-2', 'orders of this account (any status): unlink from the account', 'orders',
    `customer_account_id = null`,
    `customer_account_id in (select a.id from customer_accounts a where ${PHONE_MATCH('a.phone')} or ${EMAIL_MATCH('a.email')})`),
  r('E-ACC-3', 'the account itself (name, email, phone, password hash, birthday): delete', 'customer_accounts', null,
    `${PHONE_MATCH('phone')} or ${EMAIL_MATCH('email')}`, { kind: 'delete' }),
]

// What an erasure does NOT touch, and why. Reported by the preview so nobody is surprised.
export const ERASE_REPORT_ONLY = [
  { id: 'X-OPEN', title: 'orders of this phone that are NOT closed (pending, packed, shipped): they must be delivered or cancelled first',
    count: `select count(*) from orders where ${ORDER_MATCH} and not ${CLOSED}` },
  { id: 'X-RETOPEN', title: 'open return requests of this phone', count: `select count(*) from return_requests where status not in ('completed','declined','cancelled') and ${PHONE_MATCH('contact_phone')}` },
  { id: 'X-OPENRET-ORD', title: 'closed orders kept because a return request about them is still open', count: `select count(*) from orders where ${ORDER_MATCH} and ${CLOSED} and not ${NO_OPEN_RETURN}` },
  { id: 'X-BLOCKED', title: 'blocked-customer rows for this phone (kept: fraud prevention; delete by hand if the owner decides)', count: `select count(*) from blocked_customers where ${PHONE_MATCH('phone')}` },
]

// Written after the erasure so a RESTORE from an older backup can erase the person again (see RESTORE.md).
// The ledger holds a salted hash, never the phone or the email. The salt is the same secret the retention job uses.
export const LEDGER = [
  { id: 'L-PHONE', apply: `insert ignore into privacy_erasures (id_kind, id_hash, scope) select 'phone', sha2(concat({{salt}}, {{p8}}), 256), 'erase' from dual where {{p8}} <> '' and {{salt}} <> ''` },
  { id: 'L-EMAIL', apply: `insert ignore into privacy_erasures (id_kind, id_hash, scope) select 'email', sha2(concat({{salt}}, {{em}}), 256), 'erase' from dual where {{em}} <> '' and {{salt}} <> ''` },
]

// Re-apply every ledger row to a database restored from an OLDER backup. Multi-table, so no LIMIT.
const LEDGER_PHONE = (col) => `exists (select 1 from privacy_erasures e where e.id_kind = 'phone' and e.id_hash = sha2(concat({{salt}}, ${P8(col)}), 256))`
const LEDGER_EMAIL = (col) => `exists (select 1 from privacy_erasures e where e.id_kind = 'email' and e.id_hash = sha2(concat({{salt}}, lower(trim(${col}))), 256))`
export const REAPPLY = [
  r('A-OUT', 'warehouse messages of erased phones', 'fulfilment_outbox', `payload = ${SCRUB}, last_error = ${OUTBOX_KEEP_ERR}`,
    `payload <> ${SCRUB} and order_id in (select o.id from orders o where o.customer_phone is not null and ${LEDGER_PHONE('o.customer_phone')} and ${CLOSED.replace(/(fulfilment_status|payment_status)/g, 'o.$1')})`),
  r('A-ORD', 'closed orders of erased phones', 'orders',
    `customer_name = null, customer_phone = null, ${ADDRESS_NULL}, anonymised_at = coalesce(anonymised_at, now())`,
    `customer_phone is not null and ${LEDGER_PHONE('customer_phone')} and ${CLOSED} and ${NO_OPEN_RETURN}`),
  r('A-SUP-1', 'support tickets of erased emails or phones', 'support_tickets',
    `customer_name = '[removed]', customer_email = concat('removed-', id, '@invalid.example'), customer_phone = null, subject = '[removed]', anonymised_at = coalesce(anonymised_at, now()), updated_at = updated_at`,
    `anonymised_at is null and (${LEDGER_EMAIL('customer_email')} or (customer_phone is not null and ${LEDGER_PHONE('customer_phone')}))`),
  r('A-SUP-2', 'messages of anonymised tickets', 'support_messages', `m.body = '[removed]', m.author_name = null`,
    `t.anonymised_at is not null and (m.body <> '[removed]' or m.author_name is not null)`,
    { from: 'support_messages m join support_tickets t on t.id = m.ticket_id', limit: false,
      preview: `select count(*) from support_messages m join support_tickets t on t.id = m.ticket_id where (t.anonymised_at is not null or ${LEDGER_EMAIL('t.customer_email')} or (t.customer_phone is not null and ${LEDGER_PHONE('t.customer_phone')})) and (m.body <> '[removed]' or m.author_name is not null)` }),
  r('A-ACC', 'accounts of erased emails or phones', 'customer_accounts', null,
    `${LEDGER_EMAIL('email')} or (phone is not null and ${LEDGER_PHONE('phone')})`, { kind: 'delete' }),
]
