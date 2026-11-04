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
| `scripts/db-schema-diff.mjs` | builds the schema every way the repository documents (install.mysql.sql alone; the tooling order; the docs order; every file twice; seeded shuffles), reads `information_schema` (tables, columns, indexes, foreign keys, CHECKs) and diffs them. `--print-queries DB` prints `set session transaction read only` and the SELECTs that make a snapshot (five for the schema, four optional ones for triggers, views, routines and events); `--against DIR` compares a live export with what the repository builds and names what can break THIS code on live: a repository table or column live lacks, a live-only NOT NULL column without a default, a live column narrower than the repository's, any live trigger, view, routine or event (exit 1). | `test:db-schema-diff` |
| `scripts/db-columns-audit.mjs` | extracts **every SQL statement** from the PHP with `token_get_all` (concatenations, heredocs, `sprintf`, `implode` column lists, ternaries, `$sql .= ...`, `$fields = [...]` arrays), enumerates what each dynamic fragment can expand to, and has MariaDB `EXPLAIN` each expansion against the schema; accounts for **every** `->prepare()/query()/exec()` call site (one the extractor did not read is listed, never dropped); classifies every column (used / write-only / read-only / dead); compares every validation cap with the column that stores the value; probes the real routes on a private stack. | `audit:db-columns`, `test:db-columns` |

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
4. **Coverage.** The extractor also lists every query call site and whether it read a statement for it. A call without one is SQL the
   audit did not read: a string that ends right after the verb (`"select {$cols} from ..."`), SQL built by `sprintf()`, a heredoc, a
   `match`, a loop, a function or a file. Those are in `audit.json` under `statements.uncovered`, marked `session_only` (ROLLBACK, SET
   SESSION, KILL, SELECT DATABASE(): no column named) or `passthrough` (the connection pool's wrappers hand on a caller's SQL) when
   they name nothing of their own. Before this was added such SQL was silently invisible, and a wrong column in it would have passed.
5. The statements are also run under the `sql_mode` that `ops/db/sporta-db-hardening.cnf` proposes
   (`STRICT_ALL_TABLES ... ONLY_FULL_GROUP_BY`): a statement that default MariaDB accepts and the hardened mode refuses is
   reported before the mode is applied to the live server.

## Which schema the live database carries, depending on how it was installed

* **`install.mysql.sql` alone** and **schema + parts + every other file in the order `npm run sandbox` and the rigs use**
  (the "tooling" order): 28 tables / 292 columns / 83 indexes / 17 foreign keys / 35 CHECKs against 29 / 297 / 84 / 18 / 36.
  The one difference is `abandoned_followup`: `abandoned.mysql.sql` says install.mysql.sql carries it ("schema.mysql.sql repeats
  it byte for byte"); schema.mysql.sql does not, and the file is not one of the parts. A shop installed from the one file has no
  follow-up table, and `abandoned.php` joins it unconditionally (`left join abandoned_followup f`); the rigs apply every other file after
  install, so they never notice. Everything else is identical, table for
  table, column for column, index for index, key for key.
* **Every file applied a second time**: no error, no schema change, no row change.
* **The README's order followed by an alphabetical import of the rest ("docs" order)** fails once: `crm.mysql.sql` creates an
  index on `orders.customer_account_id`, a column `customers.mysql.sql` adds, and `crm` sorts first. It creates neither CRM table
  there. `install.mysql.sql` and the tooling order are unaffected. (`crm-self-sufficient.patch`.)
* **Shuffled orders**: the only first-pass failure is that same file; a second pass over the failed files repairs it.
* **Migrations that live outside `dropin/php-store`**: `sporta-live/birthday/birthday.mysql.sql` creates three columns that
  `birthday.php`, `birthday-lib.php` and `cron-birthday.php` use. No dropin migration and not `install.mysql.sql` creates them, so a database
  built from the folder has the birthday feature **off** (`503 birthday_not_ready`, cron `STATE ready=0 why=migration_missing`; measured before and
  after the migration on a private stack). DATA-SCAN-2026-11-02 reports that nothing "the repo's migrations define" is missing live, without saying whether
  `sporta-live/` was in that scope, so whether the live database has the three columns is unconfirmed.

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
and 3 more dynamic fragments stay unresolved (two in the connection pool, one cron helper). Of the 348 `prepare` / `query` / `exec` call sites 325 have an extracted statement; the other 23 are listed (`statements.uncovered`): 10 name no column (ROLLBACK, SET SESSION, KILL, SELECT DATABASE()), 5 are the pool's pass-through wrappers, and 8 do name columns (cron-fulfilment x2, `store_stock_release`, `cbk_attempt_ref`, the sitemap, abandoned x3): the first four were EXPLAINed by hand against the schema in the second look and parse. Under the `sql_mode` that
`ops/db/sporta-db-hardening.cnf` proposes (including `ONLY_FULL_GROUP_BY`) **no statement is newly refused**. No INSERT leaves a NOT NULL column
without a default out; no SQL literal is longer than its column; every checkout, registration, support, brand, product, discount and slide field
that has a validation cap has one that fits its column, with the exceptions in the table (order name 80, area 60, block 12, street 40, building 24,
floor/flat 16, note 280, track id 30, e-mail 254 / 120, support subject 140, message 2000, product name 160, brand name 80, discount label 80, code 24);
the attribution fields are truncated by the PHP to exactly their column (60 / 60 / 80 / 120); the money columns are all `decimal(10,3)` (`cost_aed` is
`decimal(10,2)`, AED); there are no float columns, no mixed character sets or collations, no table without a primary key, no redundant index and no
foreign key without an index. Of the 300 columns (with the sporta-live add-on), 233 are read and written by the code, 43 are assigned by the database only (ids, timestamps),
8 are written and never read, 2 more only as foreign keys, 11 are named but unused (mostly `created_at` / `updated_at`), none is dead and none is
read without a writer.

## Second look (verification of 2026-11-04)

A second pass, by someone who assumed every finding was wrong until his own run said otherwise, on a **different private MariaDB 10.11.14** (own datadir,
own port, own socket, removed afterwards) with its **own** build scripts, **own** route probe and **own** `information_schema` queries, not the tools above.
Results: every measured claim reproduced; two of the proposed fixes were wrong in ways the lane's suites could not see; seven things were missed.

### Verdict per finding

| id | verdict | severity (lane -> verified) | note |
|---|---|---|---|
| S1-F01 order_items.name_en/ar | confirmed | high -> **medium** | reproduced: 120 chars 200, 121 and 160 chars 500 `failed` (strict), 200 cut at 120 (lax). The repo's own Products form allows 160 (`maxLength={160}`), so it is reachable; no seed name is over 90, so nothing triggers it today. Fix proven. |
| S1-F02 abandoned_followup | confirmed | medium -> low | install.mysql.sql alone: 28 tables / 292 columns; every other order 29 / 297. Only affects a one-file install (the live database is not built that way); `abandoned.php` joins the table unguarded (it guards `order_tracking_events`, not this). |
| S1-F03 brands.slug | confirmed | medium -> low | 81+ chars 500 (strict) / `slug_taken` or cut (lax). The repo's form has `maxLength={80}` and an auto slug is cut from an 80-char name, so only a crafted request reaches it. |
| S1-F04 birthday columns | confirmed | medium -> low | absent from install.mysql.sql and every dropin migration; present in `sporta-live/`. The code guards them (503 / `ready=0`). The live add-on and cron are live, so the live database most likely has them (needs live). |
| S1-F05 discounts.category | confirmed | medium -> low | strict 500, lax cut at 40. |
| S1-F06..F11 hero_slides title/subtitle/cta | confirmed | medium -> low | the slide form has no `maxLength`, so an admin can reach it; the answer is a generic `failed`, nothing is lost but the typing. |
| S1-F12 crm.mysql.sql order | confirmed | medium -> low | alone on schema.mysql.sql: 0 CRM tables; with the patch: 2. No documented path hits it (install.mysql.sql is the instruction); a retry repairs it. |
| S1-F13 products.category | confirmed | medium -> low | the repo's form has `maxLength={40}`. |
| S1-F14 return/reset tables | unclear | low | the 2026-11-01 dump has the old layout; only a live read can say. |
| S1-F15 live-only tables/columns | confirmed (informational) | low | 38 live-only tables, 26 live-only columns, all nullable or defaulted; the repository-only tables are **12** (the lane's text says 11; its own json has 12, `abandoned_followup` included). |
| S1-F16 same name, other width | confirmed (informational) | low | recomputed: email 254/120, kind 12/10/6, lang 5/2, name 80/40, name_en/ar 160/80, note 500/280, reason 200/20, status 24/16/12, type 20/8. |
| S1-F17, F22 request_ip | intended-design | low -> none | a keyed hash, written for abuse limiting; the retention rule R-RES deletes old rows. |
| S1-F18, F20, F31 write-only audit columns | intended-design | low -> none | recorded for the administrator, no screen reads them; grep over all three dropins confirms no reader and no `select *` on those tables. |
| S1-F19, F23, F24, F25 absurd integers | confirmed | low | strict 500, lax clamp. |
| S1-F21 customer_accounts.last_login_at | confirmed | low | **but the lane's fix set breaks `test:db-privacy`** (see V5). |
| S1-F26, F27 description cut at 280 | confirmed, owner decision | low | already an open owner decision in `ops/handoff/HANDOFF.md`. |
| S1-F28 products.updated_at | confirmed | low | optional; **also breaks `test:db-privacy`** until classified. |
| S1-F29 reviews.comment/lang | intended-design | low -> none | the review text is stored for a screen that does not exist. |
| S1-F30 reviews.published | confirmed | low | named by no statement. |

### Found by the second look (not in the lane's report)

| id | severity | what |
|---|---|---|
| V1 orders.cbk_* | **medium** | both payment callbacks write the bank's / CBK's strings into `cbk_paymentid` / `cbk_transaction` / `cbk_reference` / `cbk_receipt` (60), `cbk_authcode` (30), `cbk_paytype` (20), `cbk_message` (200), `cbk_status` (30) **without cutting them**. Measured through the real callbacks: a 40-character auth code, or an 80-character payment id, leaves a CAPTURED payment as `pending` and sends the shopper to `status=review` (strict); lax mode stores it cut. Real bank values are short, so this is latent, but it is the money path. Fix: `gateway-field-clips.patch` (measured: paid in both modes, KNET and T-Pay). |
| V2 products (admin `sync`) | **medium** | `?r=sync` upserts the catalogue with no width check: strict, one over-long category/slug/name rolls the whole batch back as `failed` (measured); lax, an 81-character slug is cut to 80 and **overwrites the product that owns that 80-character slug** (measured: name and price replaced). Fix in `admin-input-caps-v2.patch`: the whole batch is checked first and refused by name. |
| V3 products.brand_slug | low | `varchar(64)` against `brands.slug varchar(80)`: a product given a 65-80 character brand slug answers 500 (strict) or points at no brand (lax). `product-brand-slug-width.mysql.sql`. |
| V4 hero_slides.image_w/h | low | `(int)($b['width'])` unclamped into `int(11)`: 3000000000 answers 500 (strict). Clamped in v2. |
| V5 the lane's fix set | **medium** | (a) `test:db-privacy` fails with the migrations applied: `customer_accounts.last_login_at` and `products.updated_at` are in no classification (`privacy-inventory-columns.patch` fixes it; 90 checks pass with it, 89 + 1 failure without); (b) `store_checkout_optional()` strips control characters, so a slide title or subtitle with a line break lost it and the words glued ("Line one" + "Line two" -> "Line oneLine two"): `admin-input-caps-v2.patch` uses `store_opt_max()`, which keeps `store_opt()`'s behaviour for every value that fits; (c) `crm.mysql.sql` changes content, so `ops/db/expected-schema.json` (lane S3) must be regenerated when it is adopted. |
| V6 the extractor | medium (tool) | 23 of 348 query call sites produced no statement and were not listed (13 name columns: cron-fulfilment x2, `store_stock_release`, `cbk_attempt_ref`, the sitemap, abandoned x3, and the pool's pass-throughs). Each was EXPLAINed by hand against the schema and is valid today; now they are listed. Reproduced with a fixture that names a missing column inside `sprintf`, a heredoc, a loop and a builder function: it slipped through. |
| V8 the proposed hardened `sql_mode` | low (tool) | `ops/db/sporta-db-hardening.cnf` was checked against the PHP statements only. The migrations were never run under it: now every file is applied twice under `STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,...,ONLY_FULL_GROUP_BY`; all of them apply (current tree and the patched one), the schema is identical, and a zero-date default is caught by a fixture (`f-zero.mysql.sql`) and by a mutant. |
| V7 `--against` | medium (tool) | it did not flag a live-only NOT NULL column without a default (every INSERT then fails), a live column narrower than the repository's, or a live trigger / view / routine / event (a writer no PHP statement shows). Now it does and exits 1. One trap found while adding it and closed: **an account with SELECT alone sees zero triggers** in `information_schema` even when one exists (measured: root sees 1, a SELECT-only account 0), so the recommended "read-only account" would have reported "no triggers" for a database that has one. The export now includes the privileges of the account that ran it (`privileges.jsonl`), and `--against` prints `INCONCLUSIVE` for any kind that account could not see. Run the export as an account holding SELECT, TRIGGER and EVENT on the schema (they only let it see the objects). |

What could not be tested and still needs the live server is listed above under "What only the live database can confirm"; add the **default collation of the
database** (`SELECT default_collation_name FROM information_schema.schemata`): every repository table names `utf8mb4_unicode_ci` itself (verified under
four other database defaults, including `utf8mb4_uca1400_ai_ci`), so it cannot change a column here, only a table created by hand.

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
5. Whether the live database has any trigger, view, routine or event (a writer no PHP statement shows), and its default collation
   (`SELECT default_collation_name FROM information_schema.schemata WHERE schema_name = 'sporta'`; the repository's tables name `utf8mb4_unicode_ci`
   themselves, so only a table made by hand can differ).

The read-only way: `node scripts/db-schema-diff.mjs --print-queries sporta` prints `set session transaction read only;` and ten SELECTs. Run them on the
live server as a dedicated account holding SELECT, TRIGGER and EVENT on the schema (a one-shot job; each prints one JSON object per row; the last four and
`privileges` are optional, but without TRIGGER the trigger answer is empty whatever the database holds), save the outputs as `tables.jsonl`, `columns.jsonl`,
`indexes.jsonl`, `fks.jsonl`, `checks.jsonl`, `triggers.jsonl`, `views.jsonl`, `routines.jsonl`, `events.jsonl`, `privileges.jsonl`, then
`node scripts/db-schema-diff.mjs --against DIR`. A line marked **MISSING ON LIVE** is a repository migration that has not run, which is exactly the
2026-11-02 failure; `NOTNULL` is a live-only column the repository's INSERTs leave out; `NARROW` is a live column narrower than the repository's;
`HIDDEN` is a live trigger / view / routine / event; `INCONCLUSIVE` means the exporting account could not see that kind. Exit code 1 for any of them.

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

### The fix set as verified (replaces the lane's list where they differ)

Delivered as files in the verifier's folder (`dbcols/S1-verify/deliver/`), none applied; the lane's own `admin-input-caps.patch` and `install-parts.patch` are
superseded by the `-v2` files below, the rest of the lane's files are kept unchanged. Applied together to a pristine copy of this tree: every patch applies,
`php -l` is clean on every PHP file, the database is rebuilt from scratch (install.mysql.sql alone, the tooling order, the docs order, the rig's order) and
**upgraded from the old schema with rows in it** (order lines, accounts, products: row checksums identical before and after, a second run changes nothing, the
upgraded database equals the fresh one, 0 differences), ten shuffled orders have no first-pass failure, every file also applies twice under the hardened
`sql_mode`, and the real routes are probed again in strict and lax mode.

| file | what | replaces |
|---|---|---|
| `admin-input-caps-v2.patch` | `store_opt_max()` (keeps `store_opt()`'s trim / empty-is-null / control characters; refuses what does not fit with a named 400) for product and discount category and the six slide texts; brand slug and sort; slide `sort`, `width`, `height`; discount `usage_limit` / `min_order`; **the catalogue `sync` batch is width-checked before anything is written**. Touches `store.php` and `admin.php`: they must ship together (`store_opt_max` lives in `store.php`) | `admin-input-caps.patch` |
| `gateway-field-clips.patch` | KNET and T-Pay callbacks cut every bank / gateway string to the width of its `orders.cbk_*` column; `$recordResult` is cut before the read-back that compares it | new |
| `product-brand-slug-width.mysql.sql` | `products.brand_slug` varchar(64) -> (80) | new |
| `install-parts-v2.patch` | the five new migrations in `PARTS` plus the regenerated install.mysql.sql (`test:install-sql` passes on a private server for both the current tree and the patched one) | `install-parts.patch` |
| `privacy-inventory-columns.patch` | classifies `customer_accounts.last_login_at` and `products.updated_at` and regenerates the inventory block of DATA-PROTECTION.md (`test:db-privacy`: 90 checks, 0 failures; without it 1 failure) | new |
| `birthday`, `customer-last-login`, `order-item-name-width`, `products-updated-at` `.mysql.sql`, `crm-self-sufficient.patch`, `customer-last-login-write.patch` | unchanged from the lane | kept |

Two things to do when these are adopted: regenerate `ops/db/expected-schema.json` (lane S3 hashes every migration file; `crm.mysql.sql` changes and five files are
new), and decide the sitemap `lastmod` question for `products-updated-at.mysql.sql` (every product's date becomes the migration date once).

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
* The export queries show an account only what it may see: a SELECT-only account sees no triggers (see V7). `--against` says INCONCLUSIVE when the
  export carries no TRIGGER / EVENT privilege, but it cannot know whether the account was truly read-only: run the export under a dedicated account and
  keep the output with the report.
* `test:install-sql`, `test:knet` and `test:tpay` talk to the shared test rig (and `test:install-sql` rewrites `install.mysql.sql`): the verifier ran
  `test:install-sql` against a private server (`MYSQL_UNIX_PORT=<socket>`) in a scratch copy of the tree and did not run the other two.
* What the snapshot does NOT carry, measured by building two tables that differ only in that and diffing them: column and table and index COMMENTs,
  `ROW_FORMAT`, the AUTO_INCREMENT counter, an IGNORED index, an index's direction (DESC). None of them can make a query name a column that is not there,
  so none is reported. A view or a trigger is not in the per-table snapshot either; the repository builds none (a test says so) and `--against` exports
  and reports them apart.
