// DATA PROTECTION INVENTORY: every column of the shop's database that holds personal data or a secret,
// and for each: is it needed, how long is it kept, who reads it, how it is stored, and where else it shows.
//
// This file is the source. `node ops/db/privacy-inventory.mjs` renders DATA-PROTECTION.md from it and
// `npm run test:db-privacy` checks it against the REAL schema (install.mysql.sql loaded into a private
// MariaDB): a column that exists and is neither classified here nor listed as `operational` FAILS the
// suite, so a new column cannot reach production without somebody deciding what it is. Nothing in this
// file is a secret; it names columns, never values.
//
// CLASSES
//   personal    identifies, or helps identify, a customer or a visitor
//   staff       identifies a member of the shop's staff
//   secret      a credential: a password hash, a token hash, an authenticator seed, a bearer coupon
//   pseudonym   a keyed hash (HMAC) of a person's address or phone: not reversible without the server's secret
//   operational everything else (prices, stock, states, timestamps, product text)
//
// STORAGE   plain = readable by anyone who can read the table or a backup/dump of it
//           sha256 = SHA-256 of a long random value (cannot be guessed, so unsalted is sound)
//           argon2id/bcrypt = salted slow password hash
//           hmac = HMAC-SHA256 keyed by a server secret
//           seed = a secret the server must read back, stored in clear (see the owner decisions)
//
// RETENTION RULES (policy numbers are DEFAULTS FOR THE OWNER TO CONFIRM, see DATA-PROTECTION.md section 5)
//   R-ORD1  closed order: street/building/floor/flat/block and the note (which carries the map-location line)
//           are blanked 90 days after the order closed; the accounting columns stay.
//   R-ORD2  OFF by default. After N days (owner picks) name and phone are blanked (phone replaced by a keyed
//           pseudonym when a salt is configured). Accounting columns stay.
//   R-SUP   resolved/closed support ticket: identity, subject and every message body blanked after 365 days.
//   R-RET   finished return request: phone, note and event notes blanked after 365 days.
//   R-OUT   a warehouse/WhatsApp message that was SENT: payload and error text blanked after 30 days.
//   R-RES   password-reset rows (token hash, request-IP hash): deleted after 30 days.
//   R-LOG   admin activity log rows (staff email): deleted after 400 days. Needs a deliberate DELETE grant.
//   R-ERASE removed (anonymised or deleted) on a verified customer request, see section 6.
//   KEEP    kept while the account/record exists (stated why).
export const POLICY = {
  orders_days: 90,        // R-ORD1
  identity_days: 0,       // R-ORD2, 0 = off
  support_days: 365,      // R-SUP
  returns_days: 365,      // R-RET
  outbox_days: 30,        // R-OUT
  resets_days: 30,        // R-RES
  activity_days: 400,     // R-LOG, 0 = off
}

// Columns of the LIVE database that the repo schema does not create (sporta-live/birthday/birthday.mysql.sql).
export const LIVE_COLUMNS = { customer_accounts: ['birthday', 'birthday_set_at', 'birthday_sent_year'] }

const warehouse = 'the warehouse picking mail (see section 4)'

export const TABLES = {
  orders: {
    purpose: 'one row per order: what was bought, what was paid, who receives it and where',
    columns: {
      customer_name: { class: 'personal', needed: 'yes, to deliver and to address the customer', retention: 'KEEP (R-ORD2 optional, R-ERASE)', readers: 'admin Orders, Profiles, CRM, invoice print; warehouse mail; customer (own order via track id + phone)', storage: 'plain', exposure: `${warehouse}; invoice print; backups and binary logs` },
      customer_phone: { class: 'personal', needed: 'yes, courier contact and order lookup', retention: 'KEEP (R-ORD2 optional, R-ERASE)', readers: 'admin Orders, Profiles, CRM (as the CRM key), blocked-customer match, WhatsApp queue; warehouse mail; customer lookup', storage: 'plain', exposure: `${warehouse}; WhatsApp outbox; CRM key; backups and binary logs` },
      customer_governorate: { class: 'personal', needed: 'yes, delivery zone and fee', retention: 'KEEP (coarse: a governorate)', readers: 'admin, warehouse', storage: 'plain', exposure: warehouse },
      customer_area: { class: 'personal', needed: 'yes, delivery zone', retention: 'KEEP (coarse: a neighbourhood)', readers: 'admin, warehouse, sales statistics', storage: 'plain', exposure: warehouse },
      customer_block: { class: 'personal', needed: 'yes until delivered', retention: 'R-ORD1 (90 days after close)', readers: 'admin, warehouse', storage: 'plain', exposure: warehouse },
      customer_street: { class: 'personal', needed: 'yes until delivered', retention: 'R-ORD1', readers: 'admin, warehouse', storage: 'plain', exposure: warehouse },
      customer_building: { class: 'personal', needed: 'yes until delivered', retention: 'R-ORD1', readers: 'admin, warehouse', storage: 'plain', exposure: warehouse },
      customer_floor: { class: 'personal', needed: 'yes until delivered', retention: 'R-ORD1', readers: 'admin, warehouse', storage: 'plain', exposure: warehouse },
      customer_flat: { class: 'personal', needed: 'yes until delivered', retention: 'R-ORD1', readers: 'admin, warehouse', storage: 'plain', exposure: warehouse },
      customer_note: { class: 'personal', needed: 'optional delivery note; may hold one map-location line (a precise home position)', retention: 'R-ORD1', readers: 'admin Orders, warehouse', storage: 'plain; free text up to 280 characters', exposure: `${warehouse} (the location link is clickable there); the browser keeps a copy while "remember my details" is on; backups and binary logs` },
      customer_lang: { class: 'personal', needed: 'yes, language of messages', retention: 'KEEP', readers: 'mail/WhatsApp templates', storage: 'plain (ar or en)', exposure: 'low' },
      customer_account_id: { class: 'pseudonym', needed: 'links a logged-in order to its account', retention: 'KEEP; set to NULL when the account is erased', readers: 'account order history, CRM', storage: 'plain id', exposure: 'low' },
      track_id: { class: 'secret', needed: 'yes, the public order handle (with the phone it opens the order status page)', retention: 'KEEP', readers: 'customer, admin, mails', storage: 'plain', exposure: 'mails, URLs, payment logs, Activity-log keys such as warehouse_mail_failed_new_<track>' },
      anonymised_at: { class: 'operational', needed: 'marks a row the retention job already processed (added by privacy-schema.sql)', retention: 'KEEP', readers: 'retention job', storage: 'timestamp', exposure: 'none' },
    },
    operational: ['id', 'amount', 'subtotal', 'discount_amount', 'delivery_fee', 'discount_code', 'discount_label', 'discount_ids', 'discount_released', 'payment_status', 'payment_method', 'fulfilment_status', 'cbk_status', 'pay_attempt', 'cbk_message', 'cbk_paymentid', 'cbk_transaction', 'cbk_authcode', 'cbk_reference', 'cbk_receipt', 'cbk_paytype', 'cbk_trackid', 'utm_source', 'utm_medium', 'utm_campaign', 'referrer_host', 'paid_at', 'fulfilled_at', 'created_at', 'stock_claimed', 'stock_released'],
  },
  order_items: { purpose: 'lines of an order', columns: {}, operational: ['id', 'order_id', 'product_id', 'qty', 'unit_price', 'size', 'fit', 'name_en', 'name_ar'] },
  order_tracking_events: { purpose: 'status history of an order', columns: {}, operational: ['id', 'order_id', 'status', 'created_at'] },
  customer_accounts: {
    purpose: 'shopper sign-in accounts',
    columns: {
      name: { class: 'personal', needed: 'yes, greeting and delivery default', retention: 'KEEP while the account exists; deleted on request (R-ERASE)', readers: 'the customer, admin Profiles/CRM', storage: 'plain', exposure: 'admin screens; backups' },
      email: { class: 'personal', needed: 'yes, sign-in and password reset', retention: 'KEEP while the account exists; deleted on request', readers: 'the customer, admin Profiles/CRM', storage: 'plain', exposure: 'reset mail; backups' },
      phone: { class: 'personal', needed: 'optional, delivery default', retention: 'KEEP while the account exists; deleted on request', readers: 'the customer, admin', storage: 'plain', exposure: 'admin screens; backups' },
      password_hash: { class: 'secret', needed: 'yes', retention: 'KEEP while the account exists', readers: 'sign-in only', storage: 'argon2id (bcrypt fallback), salted', exposure: 'backups and binary logs hold the hash, never the password' },
      birthday: { class: 'personal', needed: 'optional, birthday gift (live-only column, sporta-live/birthday)', retention: 'KEEP while the account exists; deleted with it', readers: 'birthday job', storage: 'plain date', exposure: 'birthday mail; backups' },
    },
    operational: ['id', 'created_at', 'birthday_set_at', 'birthday_sent_year'],
  },
  customer_password_resets: {
    purpose: 'one-use password-reset links for shoppers',
    columns: {
      token_hash: { class: 'secret', needed: 'yes for 30 minutes', retention: 'R-RES', readers: 'reset route', storage: 'sha256 of 256 random bits (sound unsalted)', exposure: 'backups' },
      request_ip: { class: 'pseudonym', needed: 'abuse limiting', retention: 'R-RES', readers: 'none (write-only)', storage: 'hmac (a plain SHA-256 of an IPv4 address is reversed by trying all 2^32)', exposure: 'backups' },
    },
    operational: ['id', 'customer_id', 'expires_at', 'used_at', 'created_at'],
  },
  admin_users: {
    purpose: 'staff accounts for /backends',
    columns: {
      email: { class: 'staff', needed: 'yes, sign-in', retention: 'KEEP while the person is staff', readers: 'admin, Activity log', storage: 'plain', exposure: 'Activity log, reset mail' },
      google_sub: { class: 'staff', needed: 'only if Google sign-in is used', retention: 'KEEP while linked', readers: 'Google sign-in', storage: 'plain (an opaque Google id)', exposure: 'backups' },
      password_hash: { class: 'secret', needed: 'yes', retention: 'KEEP', readers: 'sign-in only', storage: 'argon2id over a SHA-256 prefix (sporta-admin-v1), salted', exposure: 'backups hold the hash only' },
      totp_secret: { class: 'secret', needed: 'yes, the server must read the authenticator seed back to check a code', retention: 'KEEP while MFA is on', readers: 'sign-in, Google callback', storage: 'seed: plain base32 in the row (see owner decision 3: seal it with a key kept outside the database)', exposure: 'every backup and binary log holds a working seed; a pending seed also sits in the PHP session file during setup' },
      last_login_at: { class: 'staff', needed: 'security review', retention: 'KEEP', readers: 'Profiles screen', storage: 'plain', exposure: 'low' },
      failed_attempts: { class: 'operational', needed: 'lock-out counter', retention: 'KEEP', readers: 'sign-in', storage: 'int', exposure: 'none' },
    },
    operational: ['id', 'must_change_password', 'temporary_password_expires_at', 'temporary_password_used_at', 'locked_until', 'totp_enabled', 'totp_last_step', 'created_at'],
  },
  admin_password_resets: {
    purpose: 'one-use password-reset links for staff',
    columns: {
      token_hash: { class: 'secret', needed: 'yes for 30 minutes', retention: 'R-RES', readers: 'reset route', storage: 'sha256 of 256 random bits', exposure: 'backups' },
      request_ip: { class: 'pseudonym', needed: 'abuse limiting', retention: 'R-RES', readers: 'none (write-only)', storage: 'hmac', exposure: 'backups' },
    },
    operational: ['id', 'admin_id', 'expires_at', 'used_at', 'created_at'],
  },
  admin_recovery_codes: {
    purpose: 'one-time MFA recovery codes',
    columns: { code_hash: { class: 'secret', needed: 'yes', retention: 'KEEP until used or regenerated', readers: 'sign-in recovery', storage: 'sha256 of an 80-bit random code (not guessable, unsalted is sound)', exposure: 'backups' } },
    operational: ['admin_id', 'used_at', 'created_at'],
  },
  admin_activity_log: {
    purpose: 'append-only record of what staff and the system did',
    columns: { actor_email: { class: 'staff', needed: 'accountability', retention: 'R-LOG (400 days)', readers: 'admin Activity', storage: 'plain', exposure: 'admin screen; backups' } },
    operational: ['id', 'actor_admin_id', 'action_key', 'created_at'],
    note: 'action_key can embed an order number (warehouse_mail_failed_new_<track>): an order handle, not a name or phone.',
  },
  inventory_movements: {
    purpose: 'append-only stock ledger',
    columns: {
      actor_email: { class: 'staff', needed: 'accountability', retention: 'KEEP (stock ledger)', readers: 'admin Stock', storage: 'plain', exposure: 'admin screen; backups' },
      note: { class: 'staff', needed: 'staff comment on a stock change; should not hold customer details', retention: 'KEEP', readers: 'admin Stock', storage: 'plain free text', exposure: 'admin screen; backups' },
    },
    operational: ['id', 'sku', 'type', 'before_stock', 'after_stock', 'delta', 'before_unit_cost_kwd', 'after_unit_cost_kwd', 'before_low_stock_threshold', 'after_low_stock_threshold', 'inventory_version', 'actor_admin_id', 'created_at'],
  },
  crm_contacts: {
    purpose: 'staff view of a customer: status, tags, follow-up',
    columns: {
      contact_key: { class: 'personal', needed: 'yes, identifies the contact: account:<id> or phone:<965 number>', retention: 'KEEP (owner decision 6)', readers: 'admin CRM', storage: 'plain (a phone number)', exposure: 'admin CRM; backups' },
      display_name: { class: 'personal', needed: 'optional label', retention: 'KEEP (owner decision 6)', readers: 'admin CRM', storage: 'plain', exposure: 'admin CRM; backups' },
      tags_json: { class: 'personal', needed: 'staff labels; free text', retention: 'KEEP (owner decision 6)', readers: 'admin CRM', storage: 'plain', exposure: 'admin CRM; backups' },
    },
    operational: ['status', 'follow_up_at', 'created_by', 'updated_by', 'created_at', 'updated_at'],
  },
  crm_notes: {
    purpose: 'staff notes about a customer',
    columns: { note: { class: 'personal', needed: 'staff memory of a conversation; free text', retention: 'KEEP (owner decision 6); removed with the contact on erasure', readers: 'admin CRM', storage: 'plain free text', exposure: 'admin CRM; backups' } },
    operational: ['id', 'contact_key', 'created_by', 'created_at'],
  },
  support_tickets: {
    purpose: 'customer support conversations',
    columns: {
      customer_name: { class: 'personal', needed: 'yes while open', retention: 'R-SUP', readers: 'admin Support', storage: 'plain', exposure: 'admin screen; backups' },
      customer_email: { class: 'personal', needed: 'yes, replies and lookup', retention: 'R-SUP', readers: 'admin Support; the customer (lookup needs reference + email)', storage: 'plain', exposure: 'admin screen; backups' },
      customer_phone: { class: 'personal', needed: 'optional', retention: 'R-SUP', readers: 'admin Support', storage: 'plain', exposure: 'admin screen; backups' },
      subject: { class: 'personal', needed: 'free text written by the customer', retention: 'R-SUP', readers: 'admin Support', storage: 'plain', exposure: 'admin screen; backups' },
      order_track_id: { class: 'secret', needed: 'links to an order', retention: 'KEEP', readers: 'admin Support', storage: 'plain order handle', exposure: 'low' },
      assigned_to: { class: 'staff', needed: 'who handles it', retention: 'KEEP', readers: 'admin Support', storage: 'plain', exposure: 'low' },
    },
    operational: ['id', 'reference', 'status', 'priority', 'last_customer_at', 'last_staff_at', 'resolved_at', 'created_at', 'updated_at', 'anonymised_at'],
  },
  support_messages: {
    purpose: 'messages in a ticket',
    columns: {
      author_name: { class: 'personal', needed: 'display', retention: 'R-SUP', readers: 'admin Support', storage: 'plain', exposure: 'admin screen; backups' },
      body: { class: 'personal', needed: 'the message; free text, often contains contact details', retention: 'R-SUP', readers: 'admin Support; customer (own visible messages)', storage: 'plain free text', exposure: 'admin screen; backups' },
    },
    operational: ['id', 'ticket_id', 'author_kind', 'visible_to_customer', 'created_at'],
  },
  return_requests: {
    purpose: 'return and exchange cases',
    columns: {
      contact_phone: { class: 'personal', needed: 'yes while open', retention: 'R-RET', readers: 'admin Returns; customer lookup', storage: 'plain', exposure: 'admin screen; backups' },
      customer_note: { class: 'personal', needed: 'free text written by the customer', retention: 'R-RET', readers: 'admin Returns', storage: 'plain free text', exposure: 'admin screen; backups' },
      reviewed_by: { class: 'staff', needed: 'accountability', retention: 'KEEP', readers: 'admin Returns', storage: 'plain', exposure: 'low' },
    },
    operational: ['id', 'reference', 'order_id', 'status', 'eligibility', 'created_at', 'updated_at', 'anonymised_at'],
  },
  return_request_events: {
    purpose: 'append-only history of a return case',
    columns: {
      actor: { class: 'staff', needed: 'accountability (a customer actor is just the word customer)', retention: 'KEEP', readers: 'admin Returns', storage: 'plain', exposure: 'low' },
      note: { class: 'personal', needed: 'staff or customer comment; free text', retention: 'R-RET', readers: 'admin Returns', storage: 'plain free text', exposure: 'admin screen; backups' },
    },
    operational: ['id', 'request_id', 'from_status', 'to_status', 'actor_type', 'created_at'],
  },
  return_request_items: { purpose: 'lines of a return case', columns: {}, operational: ['id', 'request_id', 'order_item_id', 'action', 'reason', 'qty', 'requested_size', 'name_en', 'name_ar', 'original_size', 'original_fit', 'unit_price'] },
  reviews: {
    purpose: 'order reviews (published ones appear on the shop)',
    columns: {
      comment: { class: 'personal', needed: 'the review text, published on purpose; free text', retention: 'KEEP while published; blanked on erasure of the order', readers: 'public (when published), admin', storage: 'plain free text', exposure: 'the public site; backups' },
      reward_code: { class: 'secret', needed: 'a one-use coupon the customer must be able to type', retention: 'KEEP until used or expired', readers: 'checkout', storage: 'plain bearer coupon (a code that is worth money must be readable)', exposure: 'low' },
    },
    operational: ['id', 'order_id', 'rating', 'lang', 'published', 'created_at'],
  },
  blocked_customers: {
    purpose: 'phone numbers refused at checkout (fraud, abuse)',
    columns: {
      phone: { class: 'personal', needed: 'yes, fraud prevention', retention: 'KEEP (legitimate interest; owner decision 6)', readers: 'checkout, admin', storage: 'plain', exposure: 'admin screen; backups' },
      reason: { class: 'personal', needed: 'staff free text', retention: 'KEEP (owner decision 6)', readers: 'admin', storage: 'plain free text', exposure: 'admin screen; backups' },
      blocked_by: { class: 'staff', needed: 'accountability', retention: 'KEEP', readers: 'admin', storage: 'plain', exposure: 'low' },
    },
    operational: ['id', 'scope', 'created_at'],
  },
  fulfilment_outbox: {
    purpose: 'queue of picking/payment/cancel messages for the warehouse mailbox',
    columns: {
      payload: { class: 'personal', needed: 'until the message is sent; it is the whole order (name, phone, address, note, location line)', retention: 'R-OUT (30 days after sent)', readers: 'the mail job; admin never', storage: 'plain JSON', exposure: 'the sent mail itself; backups and binary logs' },
      last_error: { class: 'personal', needed: 'diagnosis; may echo an address from a mail error. Four fixed values (order cancelled, order reinstated, order shipped, sending) are STATE that store.php reads back', retention: 'R-OUT (every value except those four fixed ones)', readers: 'admin Activity (indirect); store.php (the four state values)', storage: 'plain text', exposure: 'low' },
    },
    operational: ['id', 'order_id', 'kind', 'created_at', 'sent_at', 'attempts', 'new_once'],
  },
  whatsapp_outbox: {
    purpose: 'queue of WhatsApp messages',
    columns: {
      to_e164: { class: 'personal', needed: 'until sent', retention: 'R-OUT', readers: 'the WhatsApp job', storage: 'plain', exposure: 'the provider; backups' },
      payload: { class: 'personal', needed: 'template parameters (name, track id)', retention: 'R-OUT', readers: 'the WhatsApp job', storage: 'plain JSON', exposure: 'the provider; backups' },
      last_error: { class: 'personal', needed: 'diagnosis', retention: 'R-OUT', readers: 'none', storage: 'plain text', exposure: 'low' },
    },
    operational: ['id', 'order_id', 'kind', 'template', 'lang', 'created_at', 'sent_at', 'attempts', 'wa_message_id'],
  },
  rate_limit: {
    purpose: 'request counters per client and route',
    columns: { bucket_key: { class: 'pseudonym', needed: 'yes', retention: 'rows older than the window are deleted by the application', readers: 'limiter only', storage: 'hmac (32 hex, keyed by rate_limit_secret)', exposure: 'low; keep rate_limit_secret set' } },
    operational: ['window_start', 'hits'],
  },
  settings: { purpose: 'named site settings as JSON (slider, promo bar, theme, checkout, birthday rules, fonts)', columns: {}, operational: ['name', 'value', 'updated_at'], note: 'holds no secret by design; the audit tool searches it for secret-shaped text (sec.secrets_in_text). Gateway credentials live in the private config files.' },
  products: { purpose: 'catalogue', columns: {}, operational: ['id', 'slug', 'name_en', 'name_ar', 'desc_en', 'desc_ar', 'price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'category', 'brand_slug', 'image', 'images', 'active', 'no_exchange', 'created_at', 'featured', 'featured_sort'] },
  product_variants: { purpose: 'sizes and stock', columns: {}, operational: ['sku', 'slug', 'size', 'stock', 'low_stock_threshold', 'cost_aed', 'unit_cost_kwd', 'inventory_version', 'updated_at'] },
  brands: { purpose: 'brand names and logos', columns: {}, operational: ['id', 'slug', 'name_en', 'name_ar', 'logo', 'active', 'sort', 'created_at', 'updated_at'] },
  hero_slides: { purpose: 'home slides', columns: {}, operational: ['id', 'sort', 'active', 'title_en', 'title_ar', 'subtitle_en', 'subtitle_ar', 'cta_label_en', 'cta_label_ar', 'cta_href', 'image', 'image_hash', 'image_w', 'image_h', 'focal_x', 'focal_y', 'created_at', 'updated_at'] },
  discounts: {
    purpose: 'automatic offers and coupon codes',
    columns: { code: { class: 'secret', needed: 'a coupon code is a bearer value: anyone who has it can use it', retention: 'KEEP until expired', readers: 'checkout, admin', storage: 'plain (must be typed by the customer)', exposure: 'low' } },
    operational: ['id', 'kind', 'label', 'type', 'value', 'min_order', 'category', 'starts_at', 'ends_at', 'usage_limit', 'used_count', 'active', 'created_at', 'updated_at'],
  },
}

// Old-build tables the live database also holds (not in the repo schema; DATA-SCAN-2026-11-02.md section 7).
// They are in every backup. What the audit tool and a human must check before anyone calls the database "clean":
export const LIVE_ONLY = [
  { table: 'customers, accounts', holds: 'shopper accounts of the old build (0 rows when last counted)', action: 'confirm empty; otherwise they follow the same rules as customer_accounts' },
  { table: 'admin_login_log', holds: 'staff sign-in attempts with IP addresses (27 rows)', action: 'not written by the current code; delete rows older than 90 days or drop the table once the old storefront is retired' },
  { table: 'passkeys, trusted devices, admin sessions, login codes', holds: 'device identifiers and sign-in state of the old admin', action: 'confirm what is there with the audit tool; revoke devices; drop with the old build' },
  { table: 'stock_log, journal_*, wallet_*, push_*, purchase_orders, suppliers, variant_supplier, size_charts, rate_bucket', holds: 'old-build stock, accounting, wallet, push subscriptions, suppliers', action: 'push_* may hold device endpoints (personal); wallet_* may hold balances per customer; look before dropping; the backup keeps them' },
  { table: '*_legacy_2026102x (three tables)', holds: 'copies of the same personal data as the real tables', action: 'DATA-SCAN says do not drop until the old storefront source is found; they are in every backup and in every R-ERASE blind spot, so erasure is incomplete while they exist' },
]
