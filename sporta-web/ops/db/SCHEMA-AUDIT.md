# Schema audit: every column the code touches against every column the schema defines

Lane S1, built 2026-11-04. Nothing here touches a real database: every number below comes from a **private MariaDB**
that the tools start, fill from this repository and remove (own datadir, own port from 34100, `mariadbd --no-defaults`).
The private server is MariaDB 10.11.14; the live one is 11.8 (see "What only the live database can confirm").

## Why it exists

The proven failure of this project is **column drift between the PHP and the database**. On 2026-11-02 the live
database lacked `inventory.mysql.sql`: the live stock claim writes `product_variants.inventory_version`, the column did
not exist, and every order answered 500 for 33 days. A Profiles screen answered 503 because a query named
`customer_accounts.last_login_at`, which no migration ever created. A regex over the PHP finds neither; MariaDB does.

## The tools

| file | what it does | npm |
|---|---|---|
| `scripts/db-schema-diff.mjs` | builds the schema every way the repository documents (install.mysql.sql alone; the tooling order; the docs order; every file twice; seeded shuffles), reads `information_schema` (tables, columns, indexes, foreign keys, CHECKs) and diffs them. `--print-queries DB` prints the five read-only SELECTs that make a snapshot; `--against DIR` compares a live export with what the repository builds. | `test:db-schema-diff` |
| `scripts/db-columns-audit.mjs` | extracts **every SQL statement** from the PHP with `token_get_all` (concatenations, heredocs, `sprintf`, `implode` column lists, ternaries, `$sql .= ...`, `$fields = [...]` arrays), enumerates what each dynamic fragment can expand to, and has MariaDB `EXPLAIN` each expansion against the schema; classifies every column (used / write-only / read-only / dead); compares every validation cap with the column that stores the value; probes the real routes on a private stack. | `audit:db-columns`, `test:db-columns` |

```
node scripts/db-columns-audit.mjs --out DIR          everything (about 25 minutes on a loaded 4-CPU box; the route probe is most of it)
node scripts/db-columns-audit.mjs --out DIR --client DIR2   also read field names from a directory of compiled client JavaScript
node scripts/db-columns-audit.mjs --quick            no shuffles, no route probe (about 2 minutes)
node scripts/db-columns-audit.mjs --out DIR --reuse DIR     recompute the findings from a previous run's schema diff and probe
node scripts/db-schema-diff.mjs --out DIR            schema variants only
```

Outputs in `--out DIR`: `findings.json`, `README.md` (the table and each finding), `audit.json` (everything),
`columns.tsv` (every column and what touches it), `statements.tsv` (every statement and its verdict), `caps.json`
(every bound value against its column, and the route probe), `schema-diff.json` and the three schema snapshots.

## How a statement is judged

1. The PHP extractor returns each statement as pieces (literal, variable, call, ternary). The expander resolves a variable
   by the assignments that reach the statement (`=`, `.=`, `[]=`, `['k']=`, array literals), `implode`/`array_map`/
   `array_fill(count($x))` over those arrays, constants, and the literal strings a helper function returns. A ternary
   gives both arms. What cannot be followed (SQL assembled by a function, a list returned from a function) is listed as
   **unverified**, never as wrong.
2. Placeholders become `NULL` (`1` after `LIMIT`, `OFFSET`, `INTERVAL`), and MariaDB runs `EXPLAIN <statement>` on the
   schema built in the tooling order. "Unknown column", "Unknown table", a wrong column count and a syntax error are
   MariaDB's own answers.
3. A refused statement is **guarded** when the code asks first: `store_column_exists($db, T, C)` or `SHOW COLUMNS FROM T
   LIKE 'C'`, in the statement's file or in a helper function that file calls (`birthday_columns_ready()`,
   `profiles_last_login_select()`), naming the failing column or a column the same `ALTER TABLE` adds. A guard that names a
   column no migration creates is itself reported.
4. The statements are also run under the `sql_mode` that `ops/db/sporta-db-hardening.cnf` proposes
   (`STRICT_ALL_TABLES ... ONLY_FULL_GROUP_BY`): a statement that default MariaDB accepts and the hardened mode refuses is
   reported before the mode is applied to the live server.

## Which schema the live database carries, depending on how it was installed

* **`install.mysql.sql` alone** and **schema + parts + every other file in the order `npm run sandbox` and the rigs use**
  (the "tooling" order): 28 tables / 292 columns / 83 indexes / 17 foreign keys / 35 CHECKs against 29 / 297 / 84 / 18 / 36.
  The one difference is `abandoned_followup`: `abandoned.mysql.sql` says install.mysql.sql carries it ("schema.mysql.sql repeats
  it byte for byte"); schema.mysql.sql does not, and the file is not one of the parts. A shop installed from the one file has no
  follow-up table; the rigs apply every other file after install, so they never notice. Everything else is identical, table for
  table, column for column, index for index, key for key.
* **Every file applied a second time**: no error, no schema change, no row change.
* **The README's order followed by an alphabetical import of the rest ("docs" order)** fails once: `crm.mysql.sql` creates an
  index on `orders.customer_account_id`, a column `customers.mysql.sql` adds, and `crm` sorts first. It creates neither CRM table
  there. `install.mysql.sql` and the tooling order are unaffected. (`crm-self-sufficient.patch`.)
* **Shuffled orders**: the only first-pass failure is that same file; a second pass over the failed files repairs it.
* **Migrations that live outside `dropin/php-store`**: `sporta-live/birthday/birthday.mysql.sql` creates three columns that
  `birthday.php`, `birthday-lib.php` and `cron-birthday.php` use. No dropin migration and not `install.mysql.sql` creates them, so a database
  built from the folder has the birthday feature **off** (`503 birthday_not_ready`, cron `STATE ready=0`). The live diff of
  2026-11-02 compared the live database with the dropin migrations only, so it could not have noticed.

## Findings

The findings, with evidence and fix, are generated into `findings.json` / `README.md` by every run. The ones that matter,
as of the run of 2026-11-04 (all measured through the real routes unless stated). Severity follows the lane's rule: high breaks a
route, an order or money or can lose data; medium is a latent break or a wrong type; low is hygiene.

| id | severity | what |
|---|---|---|
| order_items.name_en / name_ar | **high** | `product_save` accepts 160-character names and `products.name_*` are `varchar(160)`; the checkout copies the name into `order_items.name_*` `varchar(120)`. **An order containing such a product answers HTTP 500 under the server's default (strict) `sql_mode`** and, under a lax mode, stores the name cut at 120. Migration `order-item-name-width.mysql.sql`. |
| abandoned_followup | medium | not created by install.mysql.sql (see above). |
| return_requests, return_request_items, admin_password_resets | medium, low confidence | the production dump of 2026-11-01 has these tables in an older layout; every repository migration for them is `CREATE TABLE IF NOT EXISTS`. Probably the three `*_legacy_2026102x` renames in DATA-SCAN-2026-11-02; only a live read can say. |
| customer_accounts.birthday* | medium | see above. Migration `birthday.mysql.sql` and `install-parts.patch`. |
| products.category, discounts.category (40), hero_slides.title_* (120), subtitle_* (200), cta_label_* (40), brands.slug (80) | medium | the PHP accepts 280 characters (`store_opt`) or any length (`brand_save`); the column is narrower. Strict mode: HTTP 500 `failed`, nothing saved, no message. Lax mode: HTTP 200 and a silently shortened value. `admin-input-caps.patch` turns this into a named 400. |
| discounts.min_order, usage_limit, hero_slides.sort, brands.sort | low | an absurd figure answers 500 (strict) or is clamped silently (lax). Same patch. |
| customer_accounts.last_login_at, products.updated_at | low | the code asks whether the column exists; nothing creates it, so the Profiles "last sign-in" is always blank and the sitemaps carry no database `lastmod`. `customer-last-login.mysql.sql` (+ `customer-last-login-write.patch`), `products-updated-at.mysql.sql`. |
| products.desc_en / desc_ar | low | silently cut at 280 characters by `store_opt` while the column holds 64 kB. Owner decision. |
| reviews.comment/lang/published, `*_password_resets.request_ip`, admin_users.last_login_at, crm_contacts.created_by, whatsapp_outbox.last_error/wa_message_id | low | written, never read by any statement. |

What is **right** is as important. Of 334 statements (197 select, 76 update, 43 insert, 13 delete, 4 show, 1 explain), expanded to 377
variants (40 are dynamic), MariaDB refuses none that the code has not guarded: 322 parse, 9 are guarded (the birthday columns, `last_login_at`,
`updated_at`), 2 are assembled by functions the expander cannot follow (`abandoned.php`; its own suite EXPLAINs them) and are listed as unverified,
and 3 more dynamic fragments stay unresolved (two in the connection pool, one cron helper). Under the `sql_mode` that
`ops/db/sporta-db-hardening.cnf` proposes (including `ONLY_FULL_GROUP_BY`) **no statement is newly refused**. No INSERT leaves a NOT NULL column
without a default out; no SQL literal is longer than its column; every checkout, registration, support, brand, product, discount and slide field
that has a validation cap has one that fits its column, with the exceptions in the table (order name 80, area 60, block 12, street 40, building 24,
floor/flat 16, note 280, track id 30, e-mail 254 / 120, support subject 140, message 2000, product name 160, brand name 80, discount label 80, code 24);
the attribution fields are truncated by the PHP to exactly their column (60 / 60 / 80 / 120); the money columns are all `decimal(10,3)` (`cost_aed` is
`decimal(10,2)`, AED); there are no float columns, no mixed character sets or collations, no table without a primary key, no redundant index and no
foreign key without an index. Of the 300 columns (with the sporta-live add-on), 233 are read and written by the code, 43 are assigned by the database only (ids, timestamps),
8 are written and never read, 2 more only as foreign keys, 11 are named but unused (mostly `created_at` / `updated_at`), none is dead and none is
read without a writer.

## Caps read, not measured

Validation done inside a helper function cannot be followed by the static mapping; the route probe measures what it reaches, and
these were read from the code (they all fit): CRM `display_name` 80 / tags 8 x 24 / note 2000 (`crm.php:251-281`), support
`name` 80 / `subject` 140 / `message` 2000 / e-mail 120 (`support.php:46-49`, measured by the probe), return note 1000 and staff note 2000
(`returns.php:134, 317`), admin variant SKU `^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$` (`admin.php:1962`, `varchar(30)`).

## What only the live database can confirm

1. Whether `customer_accounts.birthday`, `birthday_set_at`, `birthday_sent_year` exist (the birthday add-on is live).
2. Whether `return_requests`, `return_request_items` and `admin_password_resets` have the repository layout.
3. The live `sql_mode`. The private server uses MariaDB's default (`STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`),
   which is what the stock 11.8 image ships; the PHP never sets its own. Run `SELECT @@GLOBAL.sql_mode`. Under it, every "HTTP 500" above is a 500; under a lax mode the same
   saves succeed and cut the value.
4. Everything on MariaDB 11.8 itself (plans, `information_schema` text for defaults).

The read-only way: `node scripts/db-schema-diff.mjs --print-queries sporta`, run the five statements on the live server with a
read-only account (a one-shot job; each prints one JSON object per row), save the outputs as `tables.jsonl`, `columns.jsonl`,
`indexes.jsonl`, `fks.jsonl`, `checks.jsonl`, then `node scripts/db-schema-diff.mjs --against DIR`. A line marked
**MISSING ON LIVE** is a repository migration that has not run, which is exactly the 2026-11-02 failure.

## The fixes (delivered as files, none applied)

All are additive and idempotent; none drops or renames anything. Proven on a scratch copy of the tree: patches applied, `php -l`,
the database rebuilt from scratch (install.mysql.sql, tooling order, docs order, twice, shuffled, each file alone) **and** a database built from the
old schema upgraded by the new files, with the two compared (identical); the real routes probed again on the patched tree: a 41-character category is a
`400 too_long_category`, an order with a 160-character product name is a `200` that stores 160 characters, `min_order` above 9,999,999.999 is a
`400 invalid_min_order`. The new migrations repeat `CREATE TABLE IF NOT EXISTS customer_accounts` (and give `order_items` its name columns first) so that
none of them depends on another file having run: the first version of the proof caught two of them failing alone and in shuffled orders.

| file | what |
|---|---|
| `birthday.mysql.sql` | the three birthday columns, from the add-on, into the folder |
| `install-parts.patch` | adds the four new files below to `PARTS` in `scripts/make-install-sql.mjs`, with the regenerated `install.mysql.sql` (the abandoned lane's own table is left to that lane) |
| `order-item-name-width.mysql.sql` | widens `order_items.name_en/name_ar` to 160 |
| `crm-self-sufficient.patch` | `crm.mysql.sql` adds the column its index needs |
| `admin-input-caps.patch` | `product_save`, `brand_save`, `slide_save`, `discount_save`: caps equal to the column widths (`store_checkout_optional`), integer clamps |
| `customer-last-login.mysql.sql`, `customer-last-login-write.patch` | the column, and the sign-in write (guarded, never fails a sign-in) |
| `products-updated-at.mysql.sql` | optional: every product's `lastmod` becomes the migration date once |

## Limits of the method

* The static mapping from a bound value to a cap follows `execute([...])` argument lists, variable assignments and the helpers
  `store_text`, `store_checkout_optional`, `store_utm`, `store_opt`, `store_input_string`, `store_phone`, `mb_substr`, `substr`,
  length comparisons and `in_array(list)` whitelists. Anything else is reported as "no cap found" and is only a finding when a
  route probe shows a mismatch.
* Usage of a column is by name inside a statement. A column used only through a `SELECT *` counts as read; a column named only in
  a PHP string or in client JavaScript is reported as `named_only`, not as dead. The client check is by field name
  (snake_case and camelCase), not by tracing the response of each route.
* Statements assembled by functions (`abandoned.php`, the connection pool) are listed as unverified; `test:abandoned-orders`
  EXPLAINs the first of them itself.
* MariaDB 10.11 is not 11.8.
