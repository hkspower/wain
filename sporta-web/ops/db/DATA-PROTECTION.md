# Data protection in the database (`ops/db`, lane D3)

**Status: built and proven on a private MariaDB 10.11 and private PHP. NOT applied to the live database or
server. Nothing here runs by itself.** A live change goes through the project's one-shot job route (a compose
project on the VPS through the Hostinger connector, or `scripts/vps-deploy.mjs` for files), needs the owner's
confirmation at apply time, and never uses SSH, a PHP endpoint or CI. This directory is not part of the web
package (`make-package.mjs` and `bundle-php.mjs` copy only `dist/` and `dropin/`; the suites assert it).

Proof: `npm run test:db-privacy` (this document's inventory, the SQL, the PHP library, erasure and restore, with
mutation checks). Backups and restore are in `BACKUP.md` and `RESTORE.md` (`npm run test:db-backup`).

## 1. What personal data the shop holds, in one paragraph

Customers: name, phone, delivery address (governorate, area, block, street, building, floor, flat), a free-text
note that may also carry **one map-location line (a precise home position)**, and for shoppers with an account an
email, a password hash and an optional date of birth. Support and returns add free text written by the customer.
Staff: email, a password hash, an authenticator seed, sign-in times, and the Activity log. Everything above is
copied into every backup, and into the binary log if the owner keeps it (`sporta-db-hardening.cnf` keeps 14 days).
The warehouse picking mail carries the whole order to a mailbox the database does not control.

## 2. The inventory: every column, five questions each

`data-protection.mjs` is the source. The suite loads the real schema into a private MariaDB and fails if a column
exists that is not classified here, if a classified column does not exist, or if a column that looks personal
(phone, email, street, token, ...) is filed as "operational". So a new column cannot reach production
unclassified. The table below is generated (`node ops/db/privacy-inventory.mjs`).

The five questions: **needed?** (why we hold it), **retention** (how long, by which rule), **who reads it**,
**stored as** (plain / hash / HMAC / seed), **where else it shows** (logs, mails, exports, admin screens, backups).

<!-- GENERATED:INVENTORY:BEGIN (node ops/db/privacy-inventory.mjs) -->

28 tables in the repo schema. Columns: 36 personal, 10 staff, 10 secret, 4 pseudonym, 238 operational (no personal data). Default retention policy: orders_days = 90, identity_days = 0, support_days = 365, returns_days = 365, outbox_days = 30, resets_days = 30, activity_days = 400.

#### `orders`: one row per order: what was bought, what was paid, who receives it and where

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `customer_name` | personal | yes, to deliver and to address the customer | KEEP (R-ORD2 optional, R-ERASE) | admin Orders, Profiles, CRM, invoice print; warehouse mail; customer (own order via track id + phone) | plain | the warehouse picking mail (see section 4); invoice print; backups and binary logs |
| `customer_phone` | personal | yes, courier contact and order lookup | KEEP (R-ORD2 optional, R-ERASE) | admin Orders, Profiles, CRM (as the CRM key), blocked-customer match, WhatsApp queue; warehouse mail; customer lookup | plain | the warehouse picking mail (see section 4); WhatsApp outbox; CRM key; backups and binary logs |
| `customer_governorate` | personal | yes, delivery zone and fee | KEEP (coarse: a governorate) | admin, warehouse | plain | the warehouse picking mail (see section 4) |
| `customer_area` | personal | yes, delivery zone | KEEP (coarse: a neighbourhood) | admin, warehouse, sales statistics | plain | the warehouse picking mail (see section 4) |
| `customer_block` | personal | yes until delivered | R-ORD1 (90 days after close) | admin, warehouse | plain | the warehouse picking mail (see section 4) |
| `customer_street` | personal | yes until delivered | R-ORD1 | admin, warehouse | plain | the warehouse picking mail (see section 4) |
| `customer_building` | personal | yes until delivered | R-ORD1 | admin, warehouse | plain | the warehouse picking mail (see section 4) |
| `customer_floor` | personal | yes until delivered | R-ORD1 | admin, warehouse | plain | the warehouse picking mail (see section 4) |
| `customer_flat` | personal | yes until delivered | R-ORD1 | admin, warehouse | plain | the warehouse picking mail (see section 4) |
| `customer_note` | personal | optional delivery note; may hold one map-location line (a precise home position) | R-ORD1 | admin Orders, warehouse | plain; free text up to 280 characters | the warehouse picking mail (see section 4) (the location link is clickable there); the browser keeps a copy while "remember my details" is on; backups and binary logs |
| `customer_lang` | personal | yes, language of messages | KEEP | mail/WhatsApp templates | plain (ar or en) | low |
| `customer_account_id` | pseudonym | links a logged-in order to its account | KEEP; set to NULL when the account is erased | account order history, CRM | plain id | low |
| `track_id` | secret | yes, the public order handle (with the phone it opens the order status page) | KEEP | customer, admin, mails | plain | mails, URLs, payment logs, Activity-log keys such as warehouse_mail_failed_new_<track> |
| `anonymised_at` | operational | marks a row the retention job already processed (added by privacy-schema.sql) | KEEP | retention job | timestamp | none |

#### `customer_accounts`: shopper sign-in accounts

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `name` | personal | yes, greeting and delivery default | KEEP while the account exists; deleted on request (R-ERASE) | the customer, admin Profiles/CRM | plain | admin screens; backups |
| `email` | personal | yes, sign-in and password reset | KEEP while the account exists; deleted on request | the customer, admin Profiles/CRM | plain | reset mail; backups |
| `phone` | personal | optional, delivery default | KEEP while the account exists; deleted on request | the customer, admin | plain | admin screens; backups |
| `password_hash` | secret | yes | KEEP while the account exists | sign-in only | argon2id (bcrypt fallback), salted | backups and binary logs hold the hash, never the password |
| `birthday` | personal | optional, birthday gift (live-only column, sporta-live/birthday) | KEEP while the account exists; deleted with it | birthday job | plain date | birthday mail; backups |

#### `customer_password_resets`: one-use password-reset links for shoppers

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `token_hash` | secret | yes for 30 minutes | R-RES | reset route | sha256 of 256 random bits (sound unsalted) | backups |
| `request_ip` | pseudonym | abuse limiting | R-RES | none (write-only) | hmac (a plain SHA-256 of an IPv4 address is reversed by trying all 2^32) | backups |

#### `admin_users`: staff accounts for /backends

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `email` | staff | yes, sign-in | KEEP while the person is staff | admin, Activity log | plain | Activity log, reset mail |
| `google_sub` | staff | only if Google sign-in is used | KEEP while linked | Google sign-in | plain (an opaque Google id) | backups |
| `password_hash` | secret | yes | KEEP | sign-in only | argon2id over a SHA-256 prefix (sporta-admin-v1), salted | backups hold the hash only |
| `totp_secret` | secret | yes, the server must read the authenticator seed back to check a code | KEEP while MFA is on | sign-in, Google callback | seed: plain base32 in the row (see owner decision 3: seal it with a key kept outside the database) | every backup and binary log holds a working seed; a pending seed also sits in the PHP session file during setup |
| `last_login_at` | staff | security review | KEEP | Profiles screen | plain | low |
| `failed_attempts` | operational | lock-out counter | KEEP | sign-in | int | none |

#### `admin_password_resets`: one-use password-reset links for staff

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `token_hash` | secret | yes for 30 minutes | R-RES | reset route | sha256 of 256 random bits | backups |
| `request_ip` | pseudonym | abuse limiting | R-RES | none (write-only) | hmac | backups |

#### `admin_recovery_codes`: one-time MFA recovery codes

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `code_hash` | secret | yes | KEEP until used or regenerated | sign-in recovery | sha256 of an 80-bit random code (not guessable, unsalted is sound) | backups |

#### `admin_activity_log`: append-only record of what staff and the system did

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `actor_email` | staff | accountability | R-LOG (400 days) | admin Activity | plain | admin screen; backups |

action_key can embed an order number (warehouse_mail_failed_new_<track>): an order handle, not a name or phone.

#### `inventory_movements`: append-only stock ledger

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `actor_email` | staff | accountability | KEEP (stock ledger) | admin Stock | plain | admin screen; backups |
| `note` | staff | staff comment on a stock change; should not hold customer details | KEEP | admin Stock | plain free text | admin screen; backups |

#### `crm_contacts`: staff view of a customer: status, tags, follow-up

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `contact_key` | personal | yes, identifies the contact: account:<id> or phone:<965 number> | KEEP (owner decision 6) | admin CRM | plain (a phone number) | admin CRM; backups |
| `display_name` | personal | optional label | KEEP (owner decision 6) | admin CRM | plain | admin CRM; backups |
| `tags_json` | personal | staff labels; free text | KEEP (owner decision 6) | admin CRM | plain | admin CRM; backups |

#### `crm_notes`: staff notes about a customer

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `note` | personal | staff memory of a conversation; free text | KEEP (owner decision 6); removed with the contact on erasure | admin CRM | plain free text | admin CRM; backups |

#### `support_tickets`: customer support conversations

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `customer_name` | personal | yes while open | R-SUP | admin Support | plain | admin screen; backups |
| `customer_email` | personal | yes, replies and lookup | R-SUP | admin Support; the customer (lookup needs reference + email) | plain | admin screen; backups |
| `customer_phone` | personal | optional | R-SUP | admin Support | plain | admin screen; backups |
| `subject` | personal | free text written by the customer | R-SUP | admin Support | plain | admin screen; backups |
| `order_track_id` | secret | links to an order | KEEP | admin Support | plain order handle | low |
| `assigned_to` | staff | who handles it | KEEP | admin Support | plain | low |

#### `support_messages`: messages in a ticket

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `author_name` | personal | display | R-SUP | admin Support | plain | admin screen; backups |
| `body` | personal | the message; free text, often contains contact details | R-SUP | admin Support; customer (own visible messages) | plain free text | admin screen; backups |

#### `return_requests`: return and exchange cases

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `contact_phone` | personal | yes while open | R-RET | admin Returns; customer lookup | plain | admin screen; backups |
| `customer_note` | personal | free text written by the customer | R-RET | admin Returns | plain free text | admin screen; backups |
| `reviewed_by` | staff | accountability | KEEP | admin Returns | plain | low |

#### `return_request_events`: append-only history of a return case

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `actor` | staff | accountability (a customer actor is just the word customer) | KEEP | admin Returns | plain | low |
| `note` | personal | staff or customer comment; free text | R-RET | admin Returns | plain free text | admin screen; backups |

#### `reviews`: order reviews (published ones appear on the shop)

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `comment` | personal | the review text, published on purpose; free text | KEEP while published; blanked on erasure of the order | public (when published), admin | plain free text | the public site; backups |
| `reward_code` | secret | a one-use coupon the customer must be able to type | KEEP until used or expired | checkout | plain bearer coupon (a code that is worth money must be readable) | low |

#### `blocked_customers`: phone numbers refused at checkout (fraud, abuse)

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `phone` | personal | yes, fraud prevention | KEEP (legitimate interest; owner decision 6) | checkout, admin | plain | admin screen; backups |
| `reason` | personal | staff free text | KEEP (owner decision 6) | admin | plain free text | admin screen; backups |
| `blocked_by` | staff | accountability | KEEP | admin | plain | low |

#### `fulfilment_outbox`: queue of picking/payment/cancel messages for the warehouse mailbox

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `payload` | personal | until the message is sent; it is the whole order (name, phone, address, note, location line) | R-OUT (30 days after sent) | the mail job; admin never | plain JSON | the sent mail itself; backups and binary logs |
| `last_error` | personal | diagnosis; may echo an address from a mail error | R-OUT | admin Activity (indirect) | plain text | low |

#### `whatsapp_outbox`: queue of WhatsApp messages

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `to_e164` | personal | until sent | R-OUT | the WhatsApp job | plain | the provider; backups |
| `payload` | personal | template parameters (name, track id) | R-OUT | the WhatsApp job | plain JSON | the provider; backups |
| `last_error` | personal | diagnosis | R-OUT | none | plain text | low |

#### `rate_limit`: request counters per client and route

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `bucket_key` | pseudonym | yes | rows older than the window are deleted by the application | limiter only | hmac (32 hex, keyed by rate_limit_secret) | low; keep rate_limit_secret set |

#### `discounts`: automatic offers and coupon codes

| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |
|---|---|---|---|---|---|---|
| `code` | secret | a coupon code is a bearer value: anyone who has it can use it | KEEP until expired | checkout, admin | plain (must be typed by the customer) | low |

Tables with no personal or secret column: `order_items`, `order_tracking_events`, `return_request_items`, `settings`, `products`, `product_variants`, `brands`, `hero_slides`.

#### Tables the live database holds that the repo schema does not create

| Table | What it holds | What to do |
|---|---|---|
| customers, accounts | shopper accounts of the old build (0 rows when last counted) | confirm empty; otherwise they follow the same rules as customer_accounts |
| admin_login_log | staff sign-in attempts with IP addresses (27 rows) | not written by the current code; delete rows older than 90 days or drop the table once the old storefront is retired |
| passkeys, trusted devices, admin sessions, login codes | device identifiers and sign-in state of the old admin | confirm what is there with the audit tool; revoke devices; drop with the old build |
| stock_log, journal_*, wallet_*, push_*, purchase_orders, suppliers, variant_supplier, size_charts, rate_bucket | old-build stock, accounting, wallet, push subscriptions, suppliers | push_* may hold device endpoints (personal); wallet_* may hold balances per customer; look before dropping; the backup keeps them |
| *_legacy_2026102x (three tables) | copies of the same personal data as the real tables | DATA-SCAN says do not drop until the old storefront source is found; they are in every backup and in every R-ERASE blind spot, so erasure is incomplete while they exist |

<!-- GENERATED:INVENTORY:END -->

## 3. Where personal data leaves the database (measured by reading the code, not by guessing)

| Channel | What goes out | Finding |
|---|---|---|
| **Application logs** | The PHP writes 7 `error_log` lines (store.php, admin.php, customer.php, cron-birthday.php). Every one is a constant sentence or an exception *class name*. The global exception handler (store.php `set_exception_handler`) returns `{"error":"failed"}` or `{"error":"no_table"}` and logs nothing. | No personal data in application logs. (The handler also logs *nothing at all*; see `DB-CONNECT.md`: a one-line, message-free log entry is proposed so a 500 leaves a trace.) |
| **Payment logs** (`knet-payments.log`, `cbk-payments.log`, 0600, above the web root) | Track ids, amounts, bank ids; `error` fields carry the *message* of a PDO exception on a failed write (`callback.db_write_failed`, `pay.error`). | A PDO message can contain SQL text and, for a duplicate key, the duplicate *value*. Log the exception class and SQLSTATE code instead (patch in `DB-CONNECT.md`). |
| **Warehouse picking mail** (`cron-fulfilment.php`) | Name, phone, full address, the note and therefore the location link, once per order, on INSERT (before payment, the owner's choice). | The largest copy of the data outside the database: it sits in the warehouse mailbox and in the logistics company's systems forever. Not fixable in the database. Owner decision 7: how long the mailbox keeps them, who can read it. |
| **WhatsApp queue** | Number, template parameters (name, track id). | Same: the provider keeps it. |
| **Exports** | There is no CSV export. The invoice print (browser) shows one order to a signed-in admin. | None to fix. |
| **Admin screens** | Orders, Profiles, CRM, Support, Returns show names, phones, addresses, notes. | By design, behind sign-in. Admin accounts are the real boundary: MFA and recovery codes exist. |
| **Browser storage** | "Remember my details" (ON by default) keeps the address **and the note, including the location line**, in `localStorage` (`sporta.delivery`) on the shopper's device. | CLAUDE.md records this as known and open. A shared device keeps a stale precise location. |
| **Activity-log keys** | `warehouse_mail_failed_new_<track>` embeds an order handle. | A handle, not a name. Fine. |
| **PHP session files** | A pending authenticator seed during setup is in the admin's session file (`/var/lib/sporta/admin-sessions`). | Short-lived; the directory is root/www-data only. |
| **Backups and binary logs** | Everything, plaintext in the binary log, encrypted in the nightly dump (`BACKUP.md`). | The binary log is the exposure: 14 days of every changed row in plain files inside the database volume. Either turn on `encrypt_binlog` with a key file, or accept it knowingly (owner decision 4). |

## 4. Tokens, codes and secrets: what is stored raw

Question asked: is any token or recovery code stored raw? Answer, from the code and the column shapes:

* **Password-reset tokens (shopper and staff):** `sha256` of 256 random bits (`bin2hex(random_bytes(32))`). A copy of
  the table yields nothing usable. Fine unsalted: a 256-bit random value cannot be guessed.
* **Recovery codes (staff MFA):** `sha256` of an 80-bit random code. Fine: 2^80 guesses.
* **Request IPs on reset rows:** HMAC-SHA256 keyed by `rate_limit_secret` (a plain hash of an IPv4 address is reversed in
  seconds). Keep `rate_limit_secret` set.
* **Passwords:** argon2id (bcrypt fallback), salted, with a versioned wrapper for the admin.
* **Authenticator seed (`admin_users.totp_secret`): STORED IN CLEAR.** This is the one raw secret. It cannot be hashed
  (the server must read it back to compute the six-digit code), so the fix is *encryption with a key held outside
  the database*. Anyone holding a database copy, a backup or a binary log can generate valid codes for that admin
  (they still need the password). See owner decision 3. The sealing design: `enc:v1:` + base64(nonce 12 bytes +
  AES-256-GCM ciphertext + tag), key `totp_seal_key` in the private config file, legacy plaintext values read as-is
  and re-sealed at the next successful sign-in; the column must be widened (`varchar(64)` to `varchar(255)`, an additive
  change) because the sealed form is about 87 characters. It touches `store.php` (6 places), `admin.php` (2) and
  `admin-google.php` (1), all files the release gate edits, so it is **specified here, not patched**: ship it in the
  gate's next release. The audit tool `sec.recoverable_secrets` turns green when every value starts with `enc:`.
* **Bearer values that must stay readable:** `discounts.code` and `reviews.reward_code` (a coupon someone types),
  `orders.track_id` (the order handle). They are worth money or open an order page; they are not hashed because the
  customer must be able to read and type them. Mitigations already in the code: server-computed discounts, one-use
  claims, rate limits.
* **Gateway credentials** are not in the database at all (private config files, 0600).

## 5. Retention: the rules, the defaults, and what the privacy page promises

The privacy page (Privacy.jsx section 3) says only: *"We keep order records as long as we need them for accounting and
for the returns period."* It sets no number, and **section 1 does not mention the optional map-location line** that
now sits in the order note. Both need the owner's words. The defaults below are **proposals for the owner to
confirm**, chosen from that sentence: the returns period is 14 days (`/returns`), so an address is useless after
the order has been delivered and a return window plus a dispute margin has passed.

| Rule | What changes | Default | Why this number |
|---|---|---|---|
| R-ORD1 | Closed orders (delivered, cancelled, failed payment never packed): street, building, floor, flat, block, **note (and the location line)** set to NULL | 90 days after the order closed | 14-day returns + 76 days of margin for disputes and courier claims; the location line is the most sensitive field and is never needed after delivery |
| R-ORD2 | Same orders: name set to NULL, phone replaced by `p` + 12 hex of `sha256(salt + last 8 digits)`, or NULL without a salt | **OFF** (0) | Kuwait commercial records are commonly kept for several years; only the owner/accountant can say whether the customer's name is part of them. Stable pseudonym keeps "repeat buyer" statistics |
| R-SUP | Resolved/closed support tickets: name, email, phone, subject and **every message body** blanked | 365 days after resolved | A year covers a seasonal complaint cycle; message bodies are free text and often hold phones and addresses |
| R-RET | Finished return requests: phone and note, and the notes of its events, blanked | 365 days after last update | Same |
| R-OUT | Warehouse and WhatsApp messages already **sent**: payload (the whole order) and error text blanked | 30 days after sent | After it is sent the queue row is a second copy of the order. Unsent rows are never touched (they still need to go; a stuck row is reported) |
| R-RES | Password-reset rows deleted | 30 days | Expire after 30 minutes anyway |
| R-LOG | Activity-log rows deleted | 400 days (0 = off) | Security evidence for a year plus a quarter. Needs a deliberate DELETE grant: no runtime account has one, on purpose |

**What never changes:** `track_id`, amounts, discounts, delivery fee, payment status and method, gateway references,
fulfilment status, all timestamps, governorate and area (coarse), `order_items`, tracking events. The suite proves
this two ways: a static check that no rule's SET list names an accounting column, and a byte-for-byte comparison of
those columns before and after a real run.

**Safeguards in the rules:** an order with an *open* return request is never blanked; shipped, packed and pending orders
are never blanked; every UPDATE is batched (500 rows in PHP) so a big table never holds a long lock; the apply files
refuse to run without a confirmation word; the preview counts exactly what the apply would change (tested) and
writes nothing (tested by comparing a CRC of every table before and after).

## 6. "Delete my data": the erase path

The privacy page already promises it: *"ask us to delete it where we are not required to keep it"*. The path:

1. **Verify the person** (outside the database: they message from the phone or email on the order; the owner decides how).
2. **Preview:** `erase-preview.sql` with `@phone` and/or `@email` (or `php cron-privacy.php erase --phone P --email E`). It
   prints how many rows each rule would change, **and what it will not touch** (open orders, open returns, blocked-number rows).
3. **Make open orders closed first** (deliver or cancel them), or accept that they stay until they are.
4. **Apply:** `erase-apply.sql` with `@privacy_confirm = 'ERASE'` and `@salt` (or `... --apply`). One transaction. It blanks
   the closed orders' name, phone, address and note; blanks tickets (any status) and their messages; blanks finished
   return requests; blanks the review comments, warehouse and WhatsApp copies of those orders; deletes CRM contacts and
   notes for the phone and the account; **deletes the customer account** (name, email, phone, password hash, date of
   birth) and its reset rows, and unlinks its orders.
5. **The ledger:** the same transaction records a *salted hash* of the phone (last 8 digits) and of the email in
   `privacy_erasures`. Neither value is stored.
6. **After any restore from a backup older than an erasure**, run `erase-reapply.sql` with the same salt. Without it a
   restore silently brings erased people back. `RESTORE.md` makes this step 5 of every restore.

**What it deliberately does not do:** it does not delete accounting columns (the order itself stays, anonymous); it
does not touch `blocked_customers` (fraud prevention: the preview reports it; delete by hand if the owner decides);
it cannot reach the **warehouse mailbox, the logistics company, the WhatsApp provider or old backups**: it says so
in the owner's reply to the person; old nightly backups age out in at most 6 months and the weekly/monthly ones carry
the person until then, which is why the ledger exists.

## 7. Applying it (nothing is applied; this is the order)

Preconditions: **the release gate has finished** (the PHP patch adds files beside the gate's), and the live schema
diff has been run (a job).

1. `privacy-schema.sql`, once, by the migration account in a one-shot job (three nullable columns, two small tables;
   idempotent). Before the PHP patch goes live, because the library names these columns.
2. Decide the numbers (section 5) and the salt: a long random secret kept in the private config as `privacy_salt`
   (and in the owner's password manager: erasure and re-erasure need the *same* salt).
3. `retention-preview.sql` through the job route. Read it. Then `retention-apply.sql` with `@privacy_confirm = 'APPLY'`.
   Runs as an account with UPDATE on the listed columns and DELETE on the reset tables: use the migration job, or the
   `sporta_retention` account sketched in `HARDENING-NOTES` below.
4. For a recurring run, apply `privacy-php.patch` with the next backend release (`git apply ops/db/privacy-php.patch`), then:
   * move `privacy-schema.sql` to `dropin/php-store/privacy.mysql.sql` and regenerate `install.mysql.sql`
     (`scripts/make-install-sql.mjs`), so "the live database carries every repo migration" stays true;
   * `npm run db:grants` (lane D1): the two new files are CLI entry scripts that need the *cron* role plus UPDATE/DELETE on
     the listed columns; D1's suite fails on a new `*.php` until it is assigned;
   * add to `api/.htaccess` `FilesMatch`: `privacy.php` (the library) and `cron-privacy.php` (CLI-only; it answers 404 over HTTP,
     tested, but deny it anyway);
   * add the host cron line `23 3 * * 0 root docker exec -u www-data apache-sporta-1 php /var/www/html/api/cron-privacy.php retention --apply >> /var/log/sporta-cron.log 2>&1`
     to `/etc/cron.d/sporta-db-backup` (separate file; see `BACKUP.md`). Weekly is enough.
5. Add the sentence about the location line to the privacy page, and a retention sentence with the numbers the owner chose.

**HARDENING-NOTES (account for the recurring job).** The retention job needs: `UPDATE` on `orders(customer_note, customer_block,
customer_street, customer_building, customer_floor, customer_flat, customer_name, customer_phone, customer_account_id,
anonymised_at)`, `support_tickets`, `support_messages(body, author_name)`, `return_requests`, `return_request_events(note, actor)`,
`fulfilment_outbox(payload, last_error)`, `whatsapp_outbox(to_e164, payload, last_error)`, `reviews(comment)`; `DELETE` on
`customer_password_resets`, `admin_password_resets`, `admin_activity_log`, `crm_notes`, `crm_contacts`, `customer_accounts`;
`INSERT` on `privacy_runs`, `privacy_erasures`. None of the 8 accounts of lane D1 has all of that, and none should: it is a ninth
account (`sporta_retention`), unlocked only for the run. `make-grants.mjs` derives it once `cron-privacy.php` is in the tree.

## 8. Owner decisions

1. **The numbers** in section 5 (90 / 365 / 365 / 30 / 30 / 400, identity stage off). Written on the privacy page.
2. **Identity stage (R-ORD2):** is the customer's name or phone part of the accounting records you must keep, and for how long?
3. **Authenticator seed:** seal it with a key outside the database (section 4), or accept it and record `--accept sec.recoverable_secrets`.
4. **Binary log:** keep 14 days of plaintext row history for point-in-time recovery (`RESTORE.md`), or turn on `encrypt_binlog`, or switch the
   binary log off and accept a 24-hour recovery point.
5. **The privacy page:** add the map-location line to section 1, and the retention numbers to section 3.
6. **CRM notes, blocked numbers, activity log:** no automatic rule is defined for `crm_*` and `blocked_customers`; they are free text a person
   wrote. Decide an age after which a contact with no order is removed.
7. **The warehouse mailbox:** how long the logistics company keeps picking mails, and who can read the mailbox.
8. **Old-build tables and the three `*_legacy_*` copies** hold the same personal data and are in every backup and outside every rule here.
   Erasure is incomplete while they exist. Retire them when the old storefront's source is found.
9. **Who may run an erasure** and how the request is verified.

## 9. Proven here, and what only the live server can say

Proven on a private MariaDB 10.11 and PHP 8.3 by `npm run test:db-privacy`: the inventory covers the schema; the SQL files and the
PHP library are generated from one source and produce identical tables; previews write nothing and equal the apply counts; the guards
(confirmation word, closed-only, age, open return, unsent mail) hold and each goes red when removed; the second run changes nothing;
erasure removes the person and not the bystander; restore + re-apply erases them again; the ledger holds no phone or email.

Only the live server can confirm: that the live schema already has the three marker columns' tables (it does not: apply
`privacy-schema.sql`), MariaDB 11.8 behaviour of `REGEXP_REPLACE` and `UPDATE ... JOIN` (both are documented there and were exercised
on 10.11), what the old-build tables hold, how many rows each rule would change on the real data (run the preview), and the grants.
