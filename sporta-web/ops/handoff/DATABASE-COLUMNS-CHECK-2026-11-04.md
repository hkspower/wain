# Database columns check, 2026-11-04

Owner request: "full chech database colums". Synthesis of three audit lanes and their three independent verifications
(S1 code against schema, S2 column quality, S3 live schema diff and migration integrity), with the sibling lane Q1
(which columns the queries select) read and not repeated. Base: repository HEAD `9127e710` when the patch was built (the lanes worked from
`e80a230f`; HEAD has since moved to `fb7a191e` and the patch applies to it unchanged: `git apply --check` clean, applied to a fresh archive it gives byte-identical files and a current snapshot). Nothing was applied to the repo, nothing committed, the live
database was not reachable (Hostinger connector signed out).

Files (all outside the repo):

| what | path |
|---|---|
| this report | `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/dbcols/DATABASE-COLUMNS-CHECK-2026-11-04.md` |
| ONE additive migration | `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/dbcols/proposed-migration.mysql.sql` (in the patch as `sporta-web/dropin/php-store/zz-column-fixes.mysql.sql`, byte-identical) |
| ONE code patch | `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/dbcols/proposed-code.patch` (21 files, 689 insertions, 77 deletions; `git apply --check` clean against HEAD and against the working tree) |
| proof tooling and logs | `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/dbcols/synth/` (`tools/`, `out/`) |
| lane folders | `.../dbcols/S1-code-vs-schema`, `S1-verify`, `S2-column-quality`, `S2-verify`, `S3-live-diff`, `S3-verify` |

---

## 1. Verdict

**Is the schema healthy?** Yes, on the repository side. 29 tables, 300 columns, 84 indexes, 18 foreign keys, 36 CHECKs, all InnoDB
utf8mb4 with one collation. Every table has a primary key. All 13 KWD money columns are `DECIMAL(10,3)` (`cost_aed` is
`DECIMAL(10,2)`, in AED), there is no float, double or text money. MariaDB itself refused **0** of the 335 SQL statements extracted from the
PHP unless the code guards them first. Applying any migration a second time changes nothing (no schema object, no row).

**What can break an order?** With today's catalogue and the repository schema, nothing was found. Three things break an order or a payment
when an input is a little unusual, all reproduced by me through the real PHP routes on my own MariaDB (strict `sql_mode`, the MariaDB default):

1. **C-01** A product whose name is 121 to 160 characters (the admin form allows 160) makes every order that contains it answer HTTP 500 and create nothing: `order_items.name_en/name_ar` are `varchar(120)`.
2. **C-02** A bank reply field wider than its `orders.cbk_*` column (an 80-character payment id, a 40-character auth code) leaves a **captured** KNET or T-Pay payment `pending` and sends the shopper to `status=review`, because the settlement `UPDATE` throws. (Fake bank: the real bank's maximum widths are unknown.)
3. **C-05** The admin catalogue sync stores a negative price, and the checkout then accepted an order priced with a 10 KWD discount nobody configured.

**Which code names a column that does not exist?** Four columns, **all guarded** (no unguarded reference exists anywhere): `customer_accounts.last_login_at`
(Profiles "last sign-in", the cause of the 2026-11-02 Profiles 503 before it was guarded), `products.updated_at` (sitemap `<lastmod>`, never emitted),
and `customer_accounts.birthday`, `birthday_set_at`, `birthday_sent_year` (they exist only in `sporta-live/birthday`; a database built from
`dropin/php-store` has the birthday feature switched off). The migration creates all four.

**What only the live database can say:** whether it carries every migration (the 2026-11-02 class of failure), the layout of three older-layout tables,
`sql_mode` and time zone, the 38 old-build tables. That is one read-only job that already exists (section 8).

**What I built:** one migration (6 steps, 302 columns after, see section 5), one patch (section 6), and the proof (section 7): the migration passes
73 proof checks and 23 of 23 mutants; the patch passes 21 of 21 PHP mutants plus the audit suites (560 checks live-diff, 79 columns audit, 68 schema diff, 90 privacy).
Either may ship first: each was run alone against the other's absence (section 6.1).

**Order of work:** read-only live diff job, backup, run the migration's pre-check counts (all should be 0), import the migration, run the job again;
the patch goes through the release gate (it touches `admin.php`, `store.php`, `customer.php` and both payment callbacks).

---

## 2. Coverage, and what was right

| measure | count |
|---|---|
| tables / columns / indexes / foreign keys / CHECKs, repository, canonical build | 29 / 300 / 84 / 18 / 36 |
| the same after the migration | 29 / 302 / 85 / 18 / 42 |
| `install.mysql.sql` alone (before) | 28 / 292 / 83 / 17 / 35 (lacks `abandoned_followup` and the 3 birthday columns) |
| production structure dump 2026-11-01 compared | 55 tables, 499 columns: 38 live-only tables, 26 live-only and 29 repo-only columns on shared tables, 6 type or default conflicts (three older-layout tables) |
| SQL statements extracted (token_get_all) | 335 (198 select, 76 update, 43 insert, 13 delete, 4 show, 1 explain), 378 variants, 348 query call sites |
| MariaDB `EXPLAIN` of every statement | 323 ok, 9 guarded by the code, **0 refused**, 2 unverified (assembled by functions); also 0 newly refused under the hardened `sql_mode` (incl. ONLY_FULL_GROUP_BY) |
| query call sites the extractor does not read | 23 of 348 (8 name columns; 4 EXPLAINed by hand once; 3 in `abandoned.php` covered by `test:abandoned-orders`) |
| column use, all 300 | 233 used, 43 DB-assigned only (ids, timestamps), 8 write-only, 2 FK write-only, 11 named-only, 3 structural-only, **0 dead**, **0 read without a writer** |
| validation caps against column widths | 198 bound values mapped to a column: 59 fit, 16 exceed (7 distinct columns), 119 carry no cap (hashes, internal statuses), 4 unclamped integers; then 40 text fields x 2 `sql_mode` and 6 numeric columns driven through the real routes |
| money | 13 of 13 KWD columns DECIMAL(10,3); 12 of 12 real orders had `amount = subtotal - discount + delivery` and line sums exact to the fil |
| keys and collation | 0 tables without a primary key; 0 redundant indexes of 55; 0 foreign keys without an index; 0 "Illegal mix of collations" in 259 statements under 3 other connection collations |
| NULL smoke | bare row per table, 54 read requests, 0 5xx, 0 PHP log lines |
| privacy | 295 of 295 columns classified (36 personal, 10 secret, 4 pseudonym, 10 staff, 235 operational); only the TOTP seed is stored plain (recorded owner decision) |
| migrations | 30 files apply in order; every file applied twice: 0 schema differences, 0 row changes; 6 shuffled orders: the only first-pass failure is `crm.mysql.sql` |
| indexes under load | 259 statements EXPLAINed at 20,000 and 100,000 synthetic orders: 20 flagged, 3 matter (all invisible at the live 120 orders) |
| client visibility | no column is called dead that a screen shows (field names in the compiled live bundle, `public/*.js`, `src/`, `sporta-live/`) |

Count reconciliation: the lanes reported 62 findings (S1 31, S2 23, S3 8). The verifiers confirmed 48, ruled 11 intended design, left 3 unclear, and added
25 items of their own (7 about data and code, 18 about the audit tools, the migrations and the fix files). After merging duplicates:
**26 findings: 0 high, 5 medium, 21 low**, plus 21 tooling and fix-file defects (appendix B) and 11 intended or refuted items (appendix A).
Severity moved in review: S1-F01 high to medium, S3-01 high to medium, S1-F02..F13 medium to low, S2-05 low to **medium**, S3-02 medium to low. Verifier severity is kept below.

---

## 3. Findings, ranked (verifier severity kept)

Fix key: **M** = `zz-column-fixes.mysql.sql` step, **P** = code patch (release gate), **O** = owner decision, **L** = needs the live database.

| id | sev | table.column | evidence (measured) | fix |
|---|---|---|---|---|
| C-01 | medium | `order_items.name_en`, `name_ar` | `products.name_*` varchar(160) and the admin form accepts 160; the checkout copies the name into `order_items` varchar(120) (itemname.mysql.sql). Strict: an order with a 121 or 160 character product name = HTTP 500 "failed", no order; lax: 200, name cut at 120. Reproduced by three people. Nothing triggers it today (longest seed name < 100). Sources S1-F01, S2-01, PHP-SCAN money-5 | **M1** widen to 160, collation kept. After: 200, 160/160 stored |
| C-02 | medium | `orders.cbk_status` 30, `cbk_message` 200, `cbk_paymentid` 60, `cbk_transaction` 60, `cbk_reference` 60, `cbk_receipt` 60, `cbk_authcode` 30, `cbk_paytype` 20 | both callbacks bind the bank's strings unclipped. Real callbacks, fake bank and fake CBK, strict: 80-char payment id / transaction / reference or 40-char auth code (KNET), and PaymentId 80, AuthCode 40, Message 300, PayType 30 (T-Pay) = 8 of 8 cases leave a CAPTURED payment `pending`, redirect `review`; lax stores it cut. The static cap mapper missed it (SQL built with `$sql .=`); found by probing. Sources S1-V1, S2-09 | **P** `$fit()` clip per column in `php-knet/callback.php` and `php-cbk/callback.php`. After: 10 of 10 `paid`. Money path: `test:knet`, `test:tpay` must run at the gate |
| C-03 | medium | `products` (price, name_en, name_ar, category, active, no_exchange), `product_variants.cost_aed`, `brands` (name_en, name_ar) | `install.mysql.sql` embeds `seed.mysql.sql` and `brands.mysql.sql` (`ON DUPLICATE KEY UPDATE`), the file calls itself "safe to re-run" and `preflight.php` tells the owner to import it to repair. Measured by me: after the owner changed a price, name, category, active flag, a variant cost, a brand name and the no-exchange flags, a second import put the seed values back (price 77.777 to 10.000, brand "Owner brand" to "Sporta", 26 no-exchange flags to 29). Stock and settings survive. Source S3-01 (verifier version) | **P** `make-install-sql.mjs` `keepOwnerEdits()` (install file only; part files unchanged) plus a trailing `unit_cost_kwd` backfill; mutation-proven (4 of 4). After: all owner edits survive. Caveat: a product created or un-flagged less than an hour before a re-import is flagged again. Until applied: never re-import `install.mysql.sql` on a live shop |
| C-04 | medium | `products` via admin `?r=sync` | no width or range check. Strict: one over-long category, slug, name or a price of 1e12 rolls the whole batch back as 500. Lax: an 81-char slug is cut to 80 and the upsert **overwrites the product that owns the 80-char slug** (measured: "Victim product @ 9.000" became "Overwritten by sync @ 1.000"). Source S1-V2 | **P** whole batch checked first, named 400 (`too_long_slug`, `too_long_name_en`, `too_long_category`, `invalid_price`...). After: 6 of 6 cases 400, nothing written |
| C-05 | medium | `orders` (amount, subtotal, discount_amount, delivery_fee), `order_items.unit_price`, `return_request_items.unit_price`, `products` (price, sale_price), `discounts` (min_order, value), `product_variants` (cost_aed, unit_cost_kwd) | 11 signed money columns with no CHECK; `discounts.value` only `> 0` (150 percent storable, app ceiling 90). `?r=sync` stored -5.000; an order of one 20.000 item plus two of that product was accepted as subtotal 10.000 / amount 11.000 with a -5.000 x 2 line. Admin-only trigger, so not high. Source S2-05 (raised by the verifier) | **M6** six named CHECKs, each added only if no row violates it; **P** sync answers a named 400 first. After the CHECK alone, sync answers 500 and stores nothing |
| C-06 | low | `customer_accounts.birthday`, `birthday_set_at`, `birthday_sent_year` | only in `sporta-live/birthday/birthday.mysql.sql`, not in `install.mysql.sql` nor any dropin migration. Code guards it (`birthday_columns_ready`, 503 `birthday_not_ready`, cron "ready=0 why=migration_missing"), so the feature is silently OFF on a database built from this folder. The add-on and the 06:07 host cron are live, so live most likely has the columns (**L**). S1-F04, S3-04 | **M4** (self-sufficient: repeats `create table if not exists customer_accounts`) |
| C-07 | low | `product_variants (slug, size)` | only `sku` is unique. The stock claim is `update ... where slug = ? and size = ?` and treats `rowCount() <> 1` as out of stock: a second row for one size (also `m` against `M`, PAD SPACE) makes that size unbuyable (409). No PHP statement inserts a variant; live had no duplicate on 2026-11-02. S2-02 | **M5** `UNIQUE (slug, size)`, added only if no duplicate pair exists |
| C-08 | low | `brands.slug` to `products.brand_slug` | no foreign key by design, so renaming a brand left every product on the old slug: measured 2 orphan products, the brand's shelf gone. S2-03 | **P** the rename carries its products in one transaction; slug taken or a 65-80 character slug (column still 64 before M2) rolls back with a named error. After: 0 orphans |
| C-09 | low | `products.category` 40, `discounts.category` 40, `hero_slides` title_* 120 / subtitle_* 200 / cta_label_* 40, `brands.slug` 80, ints `brands.sort`, `hero_slides.sort/image_w/image_h`, `discounts.usage_limit`, decimal `discounts.min_order` | `store_opt()` cuts every optional field at 280, the checkout note width. Strict: 19 measured admin saves answer HTTP 500 "failed" with no message and save nothing; lax: 200 and a silent cut. Admin typing only. S1-F03, F05..F13, F19, F23..F25, V4 | **P** `store_opt_max()` with named 400s (`too_long_category`...), integer clamps, `invalid_min_order`. Line breaks in slide subtitles are kept (the lane's first version stripped them) |
| C-10 | low | `abandoned_followup` | `install.mysql.sql` alone builds 28 tables, not 29: the table is in neither `schema.mysql.sql` nor the install parts although `abandoned.mysql.sql` says it is. A fresh install would answer 503 `no_table` on Abandoned orders. S1-F02, S2-23, S3-03 | owned by the abandoned lane: its handoff `backend__abandoned-orders-registration.patch` repeats the table in `schema.mysql.sql` and classifies it. **Not duplicated here** (avoids a double registration) |
| C-11 | low | `orders.customer_account_id` (via `crm.mysql.sql`) | `crm.mysql.sql` indexes a column `customers.mysql.sql` adds. Alone, or in the alphabetical order a file manager gives, it fails 1072 and creates neither CRM table; 2 of 6 shuffled orders. S1-F12, S3-06 | **P** one idempotent `ADD COLUMN IF NOT EXISTS` at the top of `crm.mysql.sql` |
| C-12 | low | `products.brand_slug` | varchar(64) against `brands.slug` varchar(80): `product_save` with an existing 65-80 character brand slug = 500 (strict) or a tag cut to 64 that matches no brand (lax). Measured. S1-V3, S2-10 | **M2** widen to 80. `brand_assign`'s 64 guard is left on purpose (right before and after the migration) |
| C-13 | low | `products.updated_at` | sitemap-index.php and sitemap-products.php ask for it and never found it: 0 of 96 product URLs carried `<lastmod>`; with the column 96 of 96. S1-F28, S2-04, S3-05 | **M3**. Every existing product gets the import time once (say so to whoever watches the sitemap) |
| C-14 | low | `customer_accounts.last_login_at` | `profiles.php` guards it; no migration creates it; Profiles "last sign-in" is blank everywhere. S1-F21, S3-05 | **M4** plus **P** guarded write at sign-in (never fails a sign-in), classified personal in the privacy inventory. After: NULL, then set; Profiles shows it |
| C-15 | low | (all) | `preflight.php` checks 10 table names and no column: it was green on the 2026-11-02 database. S3-02 | optional separate patch (S3 `preflight-schema-check.patch`, 21.8 kB); not in the combined patch because its generated list changes with every migration. The live diff job is the designated gate |
| C-16 | low, unclear | `return_requests`, `return_request_items`, `admin_password_resets` and 38 old-build tables | the 2026-11-01 dump has these three in an older layout (`ref/kind/phone`, default `new`, against `reference/eligibility/contact_phone`, default `submitted`); every repo migration for them is `CREATE TABLE IF NOT EXISTS`, so a database that had them keeps the old layout. 3 `*_legacy_2026102x` tables and 26 live-only columns on shared tables (hero_slides.image_mobile*, orders.courier, customer_email...) are consistent with a rename of exactly these. Q1-F12 saw the same. S1-F14, F15, S2-20 | **L** live diff job. Never drop an old table |
| C-17 | low, unclear | all 43 TIMESTAMP and 9 DATETIME columns | no PHP sets `time_zone` or `sql_mode`; `admin.php` uses `date()` in two places, `gmdate` elsewhere; dashboard day buckets are UTC midnight = 03:00 Kuwait. TIMESTAMP holds (24 h COD, stock) give the same answer in three zones; a DATETIME written in UTC and read at +03:00 flips. S2-11 | **L** `select @@global.time_zone, @@system_time_zone, @@global.sql_mode` |
| C-18 | low | `admin_users.totp_secret` | plain base32; every backup holds a working seed. Recorded owner decision 3 (DATA-PROTECTION.md). S2-08 | **O** sealing needs a key outside the DB; widening to varchar(255) is the only schema step it needs |
| C-19 | low | `products.desc_en`, `desc_ar` | a 700-character description is accepted (200) and 280 are stored in both modes; the column holds 64 kB. Already an open owner decision in HANDOFF. S1-F26/F27 | **O** a longer cap, or an error instead of a silent cut |
| C-20 | low | all text columns, `utf8mb4_unicode_ci` | alef forms, ta marbuta/ha, alef maqsura/ya and tatweel do not fold; tashkeel is ignored; admin order search by `customer_name` misses hamza variants. S2-17 | **O** normalise the term in PHP, or test `uca1400_ai_ci` on an 11.8 copy |
| C-21 | low | `orders` money identity, `orders.customer_account_id` | `amount = subtotal - discount + delivery` holds for every checkout order (12 of 12; 120 of 120 live per DATA-SCAN) but the DB does not say so; a CHECK would refuse the partial rows six suites insert directly. No FK on `customer_account_id`. S2-06, S2-07 | **O** S2's optional file (identity CHECK, FK ON DELETE SET NULL, both pre-checked and proven). **Not shipped** |
| C-22 | low | `orders (payment_status, paid_at)`, cron-stock sweep, five unused indexes, missing enum CHECKs | revenue chart reads 100,000 rows at 100k orders (1,178 with `(payment_status, paid_at)`); the 15-minute sweep scans every row at 100k; both invisible at 120 orders. S2-13..S2-16 | growth watch. If orders grow 100x add `idx_orders_paid_at`. Nothing is dropped |
| C-23 | low | `admin_users.google_sub` | the repo migration and the 2026-10-31 hot-fix create the same unique key under two names; a name-based diff reports drift. S2-19 | none; the live diff compares keys by column set |
| C-24 | low | `brands.logo`, `hero_slides.image`, `crm_contacts.tags_json`, `products.images` | base64 data URIs and JSON lists whose caps and shape live only in PHP. S2-21 | none needed |
| C-25 | low | naming and width drift | same name, different width (`email` 254/120, `name` 80/40, `note` 500/280, `status` 24/16/12); `phone` x4, `cbk_*` also hold KNET values, `no_exchange` is inverted; `reviews.published` is named by no statement (moderation not wired). S1-F16, F30, S2-18 | none (renames are forbidden: the compiled admin reads these names) |
| C-26 | low | packaging text | `file-audit` REQUIRED lists 4 of 29 SQL files, `make-package` numbers 4 parts, README-FIRST says "four files"; a SELECT-only account sees no foreign keys or triggers (the tool reports it once). S3-07, S3-08 | text edits; tool already handles the account case |

---

## 4. What to do, grouped

### 4.1 Needs a migration (additive, ready): `proposed-migration.mysql.sql`

Six steps, in this order. Nothing is dropped, renamed or rewritten; the only value written is the new `products.updated_at`. Steps 5 and 6 count the
offending rows first and skip only themselves, with one printed line, if there are any; a step whose table or column is missing is skipped the same way.
No `DELIMITER`, no stored routine; it imports in phpMyAdmin. Widenings keep each column's own character set and collation (a bare `MODIFY` re-collates a
column to its table default: measured, and the first version of the lane's file did it).

| step | change | closes |
|---|---|---|
| 1 | `order_items.name_en/name_ar` varchar(120) to (160) | C-01 |
| 2 | `products.brand_slug` varchar(64) to (80) | C-12 |
| 3 | `products.updated_at timestamp not null default current_timestamp on update current_timestamp` | C-13 |
| 4 | `customer_accounts.birthday`, `birthday_set_at`, `birthday_sent_year`, `last_login_at` (with `create table if not exists customer_accounts`) | C-06, C-14 |
| 5 | `product_variants` UNIQUE `uq_variants_slug_size (slug, size)` | C-07 |
| 6 | six CHECKs: `orders_money_nonneg_ck`, `items_price_nonneg_ck`, `return_item_price_nonneg_ck`, `products_price_nonneg_ck`, `discounts_range_ck` (percent <= 100), `variants_cost_nonneg_ck` | C-05 |

It is a finishing pass: steps 5 and 6 constrain tables other migrations create, so the file is named `zz-` (last alphabetically), is the last install part, and
`db-schema-diff.mjs` keeps any `zz-*.mysql.sql` last when it shuffles orders. Run too early it prints notes and changes nothing else; import it again.

### 4.2 Needs a code patch (release gate): `proposed-code.patch`

| file | change | closes |
|---|---|---|
| `php-store/admin.php`, `store.php` | `store_opt_max()`; caps on product and discount category, six slide text fields; `brand_save` slug <= 80, int clamps; `discount_save` min_order and usage_limit ceilings; `slide_save` width/height clamp; `sync` whole-batch width and price check; brand rename carries products | C-04, C-05, C-08, C-09 |
| `php-knet/callback.php`, `php-cbk/callback.php` | clip each bank field to its column | C-02 |
| `php-store/customer.php` | guarded `last_login_at` write at sign-in | C-14 |
| `php-store/crm.mysql.sql` | idempotent prerequisite column | C-11 |
| `scripts/make-install-sql.mjs`, `install.mysql.sql` (generated) | no-clobber one-file install, last-part migration, trailing cost backfill | C-03 |
| `php-store/zz-column-fixes.mysql.sql` | the migration, as an install part | the above |
| `ops/db/data-protection.mjs`, `DATA-PROTECTION.md` | classify `last_login_at` (personal) and `products.updated_at` | privacy suite stays 90/0 |
| `scripts/db-columns-audit(.mjs/-test.mjs)`, `db-schema-diff.mjs`, `db-schema-live-diff(.mjs/-test.mjs)`, `config-rules-test.mjs` | the tools learn `store_opt_max` and the `zz-` pin; the migration lint understands `PREPARE`; the seed re-run is measured on aged rows; the incident reproduction drops the CHECK that names a dropped column; the three closed birthday gaps and the probed `last_login_at` are removed from the known list; 2 new unit mutants | keeps the suites honest |
| `ops/db/expected-schema.json`, `schema-diff.compose.json` (generated), `SCHEMA-AUDIT.md`, `SCHEMA-DIFF.md` | regenerated expectation and one-shot job (64.4 kB), notes | the live diff expects the new schema |

Generated files (`install.mysql.sql`, `expected-schema.json`, `schema-diff.compose.json`, the privacy block) make up most of the 300 kB. If another patch lands first
(the abandoned-orders registration patch also touches `install.mysql.sql`, `expected-schema.json` and `data-protection.mjs`) do not merge those four: apply the
sources, then run `node scripts/make-install-sql.mjs`, `node ops/db/privacy-inventory.mjs`, `node scripts/db-schema-live-diff.mjs --snapshot`, `--make-job`.

### 4.3 Owner decision

C-18 (TOTP seed sealing), C-19 (description cap), C-20 (Arabic folding in search), C-21 (identity CHECK, FK), C-22 (index when orders grow 100x),
and one choice inside the patch: `brand_assign` and the brand rename keep their 64-character guard so the code is right before and after the migration; raise both
to 80 together once the live diff shows step 2 applied.

### 4.4 Live-only (needs the database)

See section 9 (the list of facts) and section 8 (the procedure). In short: C-06 (do the birthday columns exist), C-16 (the three older-layout tables and the 38 old-build tables),
C-17 (`sql_mode`, time zone), the real maximum product-name length, the pre-check counts of the migration header, `abandoned_followup`, triggers and views.

---

## 5. The migration, proven (`proposed-migration.mysql.sql`)

Private MariaDB 10.11.14 (own datadir, port 34700), synthetic rows only. `tools/prove-migration.mjs`: **73 checks, 0 failed**.

* **Upgrade of an old-schema database with rows** (HEAD `install.mysql.sql` + birthday add-on + synthetic accounts, orders, order lines, a return and a discount): first run exit 0 and prints nothing; the schema delta is exactly
  12 added lines (6 CHECKs, `updated_at`, `last_login_at`, the unique key, and 3 columns replaced by their widened versions); every row of every one of the 28 tables is unchanged in all
  295 columns that existed before (the same check on the 29-table canonical build, with `abandoned_followup`, passed in the earlier run); widened columns keep `utf8mb4_unicode_ci`; runs 2 and 3: exit 0, silent, schema fingerprint and every row identical (including `updated_at`).
* **sql_mode**: hardened (`STRICT_ALL_TABLES, NO_ZERO_DATE, NO_ZERO_IN_DATE, ERROR_FOR_DIVISION_BY_ZERO, NO_ENGINE_SUBSTITUTION, ONLY_FULL_GROUP_BY`) and lax: applies twice, silent, same schema.
* **Dirty data** (a duplicate size, a negative order amount, order line, sale price and variant cost, a percent of 150): exit 0, one note per refused step (6 notes), the clean `return_request_items` CHECK and the column steps still apply, no row changes; after the data is fixed a re-run is silent and the schema equals the clean upgrade.
* **What the constraints do**: a second `(slug, size)` row (also lowercase) is refused; a negative value in each of the 9 constrained money columns is refused; NULL sale price and NULL costs still accepted; a 160-character order-line name is stored, 161 refused; an 80-character brand slug is stored on a product.
* **Databases missing pieces**: `schema.mysql.sql` alone (no promo, customers or returns) and the 2026-11-01 production structure dump both import the file with exit 0 and a note per skipped step; a second run changes nothing.
* **Collation**: with the table default `utf8mb4_general_ci` the widened columns stay `unicode_ci`.
* **Fresh = upgraded**: a database built from the patched `install.mysql.sql` has the same schema fingerprint (columns, indexes, CHECKs, foreign keys, table options) as the old install upgraded by the migration, with exact column definitions asserted (types, nullability, defaults, `ON UPDATE`); the migration over it is a no-op.
* **Mutation**: 23 mutants of the file (widening off, wrong width, bare `MODIFY`, each column step removed, `ON UPDATE` removed, non-idempotent `ADD COLUMN`, each CHECK removed or weakened, unique key without its pre-check, a missing-column step that aborts instead of skipping...) all killed, the unchanged control green. Two mutants first failed to apply (my pattern, not the file); fixed and rerun: both killed.

The file also resolves defects the verifiers found in S2's first version: collation silently reset by a bare `MODIFY` (D1), and a pre-check that named a column of a table it had not checked exists, which stopped the import with ERROR 1054 on the production-shaped dump (D2).

---

## 6. The patch, proven (`proposed-code.patch`)

Applied to a fresh `git archive` of HEAD, the result is byte-identical to the tree the proofs ran on (21 files compared). `php -l` clean on all five PHP files.

* **Route probes** (the repo's `race-rig` private stack: its own MariaDB and PHP, migration applied by the rig), strict and lax: 49 admin and checkout probes, 10 payment callbacks, a brand/sign-in/sitemap/variants probe of 13 steps. Control (HEAD), strict: 27 of the 49 answer HTTP 500 and 30 miss the expected answer; control, lax: no 500 but 23 silently cut or store a wrong value; patched: 0 misses, 0 PHP errors, in both modes.
* **Payment callbacks**: HEAD strict 8 of 10 callbacks (the 8 with an over-wide field) leave the order `pending`; patched 10 of 10 `paid`.
* **Mutation**: 21 mutants of the patch's PHP (each cap, each clamp, each ceiling, the sync check and its negative-price rule, 4 callback clips, the rename carry and its 64 guard, the sign-in write) each make the matching probe fail; the control is green. One mutant first targeted the wrong occurrence of a line that exists twice; the harness now refuses a target that is not unique.
* **No-clobber install**: reproduced on HEAD (price, name, category, active, no-exchange flags, variant cost, brand name all overwritten), kept on the patched install; 4 of 4 generator mutants caught.
* **Suites on the patched tree** (all on private servers): `config-rules` 145 ok, 5 failing = the 4 that already fail at HEAD plus the `abandoned` one (the abandoned lane's), 18 known gaps (was 21: the 3 birthday gaps are closed); `db-privacy` 90/0; `install-sql` ok (302 columns, one import = the parts by hand, second import changes nothing, a paid order survives it); `db-columns` 79/0; `db-schema-diff` 68/0; `db-schema-live-diff` 560/0 with 136 database-free mutants and 5 integrity mutants killed, 0 survivors; migration lint 0 errors and 10 warnings (13 at HEAD: the 9 install-file overwrite warnings are gone with the no-clobber install, and `PREPARE` is now one recognised `dynamic-sql` warning per file instead of 48 `unrecognised-statement` lines; a destructive verb inside a prepared string is an error, with 3 unit tests and 3 mutants).

### 6.1 Independence of the two (each run alone against the other's absence)

| | HEAD | patched PHP on HEAD schema | HEAD PHP on migrated schema | both |
|---|---|---|---|---|
| order with a 121 / 160 character product name | 500 | 500 | **200** | 200 |
| product given a 70-char brand slug | 500 | 500 | **200** | 200 |
| category / slide / discount / brand / sync over the cap | 500 | **400** | 500 | 400 |
| sync price -5 | stored | **400** | 500 (CHECK) | 400 |
| over-wide bank field | pending | **paid** | pending | paid |
| brand rename keeps its products | no (2 orphans) | **yes** | no | yes |
| sitemap `<lastmod>` | 0 of 96 | 0 of 96 | **96 of 96** | 96 of 96 |
| sign-in with `last_login_at` absent | 200 | 200 (guard) | 200 | 200, value set |

No 5xx appears that the other half does not explain, so the order of shipping is free; the migration first is the order that closes C-01 and C-12 soonest.

---

## 7. Everything I ran myself (so you can judge the evidence)

7.1 Environment: MariaDB 10.11.14 on port 34700 (own datadir under `dbcols/synth/db`), the repo's `race-rig` for PHP routes (own DB and PHP servers from ports 34800 and 38800), the audit tools' own private servers. The shared rig (8095-8100, 8188, 4173, database `sporta`, `dist/`) was never used. Every server I started is stopped (none of mine is left running) and my datadir is removed; the scratch trees `synth/head`, `synth/orig2` and `synth/pt2` and the logs in `synth/out/` are kept for re-running.
7.2 Independent re-measurements of lane findings: C-01, C-02, C-03, C-04, C-05, C-07, C-08, C-09, C-12, C-13, C-14 (HEAD against patched, strict and lax), plus the shuffle-order dependency (column-fixes before `returns.mysql.sql` left one CHECK out: found by `test:db-columns`, fixed by the `zz-` name and pin).
7.3 What changed because of what the suites said: the audit tool did not know `store_opt_max` (added, with a unit mutant); `config-rules-test` required the birthday gaps and the `last_login_at` exception to stay open (the suite's own rule: a closed gap must be removed); the incident reproduction drops a column a CHECK names (now drops the CHECK first and asserts the one extra warning); the seed re-run measure now ages the rows; the abandoned table is left to its own lane after the registration patch showed an overlap.
7.4 Not run, and why: see section 10 (Not checked).

---

## 8. Procedure: the schema diff on the live database, when the connector is back

Read-only by construction (a gate that refuses anything but SELECT/SHOW, a READ ONLY session asserted before the first query, 14 statements, no data table named, no row or secret printed).

1. **Local, 1 minute.** `cd sporta-web && node scripts/db-schema-live-diff.mjs --check-snapshot` must exit 0 (3 means a migration changed after the expectation was written: run `--snapshot` then `--make-job`).
2. **Run the job** (Hostinger connector, VM `2058651`): create a compose project named `sporta-schemadiff` from `sporta-web/ops/db/schema-diff.compose.json` (`vps_docker_create`). The first create often leaves the project "not found": create again with the same name. Read the log: it is a Markdown report ending `SCHEMA_DIFF_EXIT=<code>`. Delete the project (`vps_docker_delete`). The job mounts the store's config and database secrets `:ro` on the `sporta-db_default` network and uses the store's own account; the least it needs is `SELECT` and `SHOW VIEW` (an account with `SELECT` alone sees 0 of 18 foreign keys, and the tool says so once). If the Hostinger API refuses the 64.4 kB file (the 52 kB audit job was accepted; the new one is untested), use `ops/db/make-audit-jobs.mjs --fetch` to fetch the script from the public repo at a pushed commit.
3. **Run it twice around the adoption.** First with the CURRENTLY COMMITTED snapshot (before this patch): the honest baseline for the 2026-11-02 class (S3 expects PASS, or warnings only, with about 41 notes: the old-build tables). Then with the patched snapshot: it will exit 1 and its "What to apply" list will name `zz-column-fixes.mysql.sql` (the widened columns and the unique key are errors there by design), and `abandoned.mysql.sql` if the table is absent.
4. **Exit codes:** 0 nothing the code needs is missing; 1 something is (apply the listed files first, each by its own owner-approved step with a backup, the 2026-11-02 procedure); 2 the job could not read the database (nothing concluded); 3 stale snapshot.
5. **Facts the diff cannot give**, one read-only account, no data read:
   * `select @@version, @@global.time_zone, @@system_time_zone, @@global.sql_mode, @@global.innodb_default_row_format, now(), utc_timestamp();`
   * `select max(char_length(name_en)), max(char_length(name_ar)) from products;` (above 120 means C-01 already bites)
   * the pre-check counts at the top of the migration (duplicate `(slug, size)` pairs; negative money in orders, order_items, return_request_items, products, discounts, product_variants): all should be 0
   * `select p.brand_slug, count(*) from products p left join brands b on b.slug = p.brand_slug where p.brand_slug is not null and b.id is null group by 1;` (has a brand rename already orphaned products)
   * `select table_name, engine, table_collation, row_format, table_rows from information_schema.tables where table_schema = database();` (the 69 tables)
   * `show create table` for `orders`, `order_items`, `product_variants`, `products`, `return_request_items`, `discounts`
   * `node scripts/db-schema-diff.mjs --print-queries sporta` then `--against DIR` for triggers, views, routines, events (an account with `SELECT` alone sees no triggers: export with `TRIGGER` and `EVENT`)
6. **Apply the migration** (after the patch is reviewed, or before it; order is free): backup the touched tables (`orders`, `order_items`, `products`, `product_variants`, `customer_accounts`, `discounts`, `return_request_items`; the DATA-SCAN-2026-11-02 section 1 procedure), run the pre-check counts, import `zz-column-fixes.mysql.sql` as the admin account, **run the job again**: the report is the evidence. A skipped step prints one line saying why; fix that data and import again.
7. Never re-import `install.mysql.sql` on the live shop to catch it up (until C-03 ships it overwrites catalogue edits); run the single migration file.

---

## 9. Live-only facts (consolidated)

C-06 birthday columns present or not; C-16 live layout of `return_requests`, `return_request_items`, `admin_password_resets` and which tables are the three `*_legacy_2026102x`; C-17 `sql_mode`
(decides whether every HTTP 500 in C-09 is a 500 or a silent cut) and time zone; maximum product-name length (C-01); the migration's pre-check counts; whether `abandoned_followup` exists;
any trigger, view, routine or event; database default collation (11.8 defaults to `uca1400`; the repo pins `utf8mb4_unicode_ci` per table, so new repo tables are unaffected); the real maximum width of the
bank's reply fields (C-02); the 41 live-only tables' row counts and personal columns (privacy); whether MariaDB 11.8 prints CHECK clauses and defaults in a way the normaliser treats as equal (a difference shows as a warning, an error only when a value the code writes is missing from a list).

---

## 10. Not checked

* The live database, MariaDB 11.8 (all measurements are 10.11.14; 11.8 extends the TIMESTAMP range and changes the default collation and isolation).
* Suites bound to the shared rig: `test:knet`, `test:tpay`, `test:native`, `test:config`, `test:backend-pkg`, `test:guest-orders`, `test:db-backup`, `test:db-least-privilege`. The patch touches both payment callbacks and the checkout's name copy: they must run at the release gate. I proved the callbacks only with the fake bank and fake CBK of the private rig.
* `test:abandoned-orders` was not rerun on the patched tree (the patch no longer touches the abandoned table).
* Statements assembled by functions (`abandoned.php` x3, `db-pool.php` x2, one `cron-fulfilment` helper) are not expanded by the extractor; validation inside helper functions (CRM, support, return notes, admin variant SKU) was read, not measured; `return_submit`, `review`, admin variant, inventory and CRM routes were not driven through the probe.
* Client visibility is by field name, not by tracing each route's response to its screen.
* EXPLAIN plans on empty tables (S1) and a uniform synthetic 20k and 100k order mix (S2): shapes are evidence, milliseconds are not.
* Order of runs: the full 23-mutant migration run and the 21 PHP mutants ran on the tree before the final rebase (the PHP files are byte-identical after it, the migration file too). On the rebased tree (`synth/pt2`, logs in `synth/out/final/`) I reran the migration proof (73/0), the mutant control plus M11, M14 and M16, the 4 no-clobber mutants, the route probes (strict and lax), and every suite listed in section 6.
* The 64.4 kB one-shot job has never been accepted by the Hostinger API.
* Merge risk: the abandoned-orders registration patch and other handoff patches overlap on generated files (section 4.2).

---

## Appendix A. Refuted, intended or accepted as design

| id | what | why it is not a defect |
|---|---|---|
| S1-F17, S1-F22 | `admin_password_resets.request_ip`, `customer_password_resets.request_ip` written, never read | keyed hash kept for abuse limiting; retention rule R-RES deletes old rows |
| S1-F18 | `admin_users.last_login_at` written, never read | audit trail of the administrator |
| S1-F20 | `crm_contacts.created_by` written, never read | audit field (`crm_notes.created_by` is read, a different column) |
| S1-F29 | `reviews.comment`, `lang` written, never read | stored for a screen that does not exist; no `select *` on reviews |
| S1-F31 | `whatsapp_outbox.last_error`, `wa_message_id` | diagnostics for the administrator |
| S2-12 | TIMESTAMP year-2038 on `admin_users.locked_until`, `temporary_password_expires_at` | hold minutes to days; MariaDB 11.8 extends the range; use DATETIME for any far-future column added later |
| S2-22 | AUTO_INCREMENT exhaustion | narrowest key is int unsigned: about 11,700 years of orders at 1,000 a day |
| S2-06 | orders money identity CHECK | intended and proven, deliberately optional (C-21) |
| S1-F15 | 38 live-only tables, 26 live-only columns | informational: live = old build + repository migrations; never drop |
| S2-08 | TOTP seed plain | recorded owner decision (C-18) |

## Appendix B. Defects found in the audit tools, the migrations and the fix files themselves (all fixed or superseded)

| source | defect | state |
|---|---|---|
| S1-V6 | the PHP extractor silently dropped 23 of 348 query call sites (sprintf, heredoc, loop, match, builder shapes); the README said otherwise | fixed in repo commit `cbbf3ad9`: every call site accounted for (uncovered, session-only, passthrough), real-tree pin and a mutant |
| S1-V7 | `--against` did not flag a live-only NOT NULL column without default, a narrower live column, or a live trigger/view/routine/event; an account with `SELECT` alone sees 0 triggers | fixed `cbbf3ad9` |
| S1-V8 | migrations never run under the hardened `sql_mode` | fixed `cbbf3ad9`; all files apply twice under it |
| S1-V5 | the lane's fix set was unsafe to adopt: `test:db-privacy` red (89 ok, 1 FAIL), `store_checkout_optional` stripped line breaks from slide text, `crm.mysql.sql` content change invalidated S3's hashes | superseded by the v2 patches this synthesis composes |
| S3 V-01 | the mutation harness judged every mutant by its surroundings (a byte-identical copy counted as killed); run honestly, 6 of 83 original mutants survived | fixed `e80a230f`: mirrored layout, no-op control, 133 + 5 mutants, 0 survive |
| S3 V-02..V-08 | a moved UNIQUE key passed; unsigned decimal, date for timestamp, fewer fractional digits passed; a guard in a PHP comment counted; the config parser knew 2 of the shapes a live config can take; the lint ignored `ALTER ... ENGINE` and unparsed statements; `install.mysql.sql` left `unit_cost_kwd` NULL on first import; a documentation count was wrong | fixed `e80a230f` |
| S3 patch defects | the lane's no-clobber patch gated the no-exchange defaults on a session variable (lost when phpMyAdmin resumes an import; flagged 0 of 29 products on a catalogue that predates the column) | superseded by `install-no-clobber-v2` (data-based gate), used here |
| S2 D1, D2 | bare `MODIFY` reset a column's collation; a pre-check named columns it had not checked exist (ERROR 1054 on the production-shaped dump) | fixed in the v2 migration, which this file builds on |
| S2 test defects | `config-rules-test`'s "no additive migration adds a column install lacks" cannot fire for a column added to an existing table (shared `Set`); S2's own upgrade suite let 5 mutants survive | noted (config-rules-test is another lane's file); S2's strengthened suite lives in `S2-verify/tools` |
| S2 tool slips | its column-quality rules missed a DOUBLE named payable, a `>= -1000000` CHECK counted as a guard, a `_bin` business key, `*_slug`/sku references without a key | fixed in S2's scratch tool (not in the repo); the real schema gives the identical 41 hits |
| this synthesis | `test:db-columns` flagged the combined file as order-dependent in a shuffled order | fixed: `zz-` name, last install part, pinned last in the shuffle |

## Appendix C. Lane id to merged id

S1-F01 to C-01; F02 to C-10; F03, F05..F11, F13, F19, F23..F25 and V4 to C-09; F04 to C-06; F12 to C-11; F14, F15 to C-16; F16, F30 to C-25; F21 to C-14; F26, F27 to C-19; F28 to C-13; F17, F18, F20, F22, F29, F31 to appendix A; V1 to C-02; V2 to C-04; V3 to C-12; V5..V8 to appendix B.
S2-01 to C-01; 02 to C-07; 03 to C-08; 04 to C-13; 05 to C-05; 06, 07 to C-21; 08 to C-18; 09 to C-02; 10 to C-12; 11 to C-17; 13..16 to C-22; 17 to C-20; 18 to C-25; 19 to C-23; 20 to C-16; 21 to C-24; 23 to C-10; 12, 22 to appendix A.
S3-01 to C-03; 02 to C-15; 03 to C-10; 04 to C-06; 05 to C-13 and C-14; 06 to C-11; 07, 08 to C-26; V-01..V-08 to appendix B.
