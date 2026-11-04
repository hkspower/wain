# Live schema diff: is the live database the one the code was written for?

**Status: built and proven on private MariaDB instances; NOT run against the live database** (the Hostinger connector
was signed out when this was written). Read-only by construction. Nothing is applied by anything in this document.

CLAUDE.md asks for this before every backend deploy: *"Before deploying code that touches a new column, diff the live
schema (read-only job) against the migrations."* On 2026-11-02 that step did not exist and the live database lacked
`inventory.mysql.sql`: the stock claim wrote `product_variants.inventory_version`, the column was not there, and every
order answered 500 for 33 days (last order 2026-09-30). `preflight.php` was green on that database, because it checks ten
table names and no column. This is the tool that would have said, in one screen, *"apply inventory.mysql.sql and
admin-recovery-codes.mysql.sql"*.

> Not to be confused with `scripts/db-schema-diff.mjs` (lane S1, `ops/db/SCHEMA-AUDIT.md`): that one compares the schemas
> the repository builds by its different install routes with each other. This one compares the **live database** with the
> repository. They share nothing but the idea; the names differ on purpose so neither overwrote the other.

## Files

| file | what it is | npm |
|---|---|---|
| `scripts/db-schema-live-diff.mjs` | the tool: `--live`, `--snapshot`, `--check-snapshot`, `--expected`, `--lint-migrations`, `--integrity`, `--make-job`, `--print-preflight` | `audit:db-schema-live` |
| `scripts/db-schema-live-diff-test.mjs` | the suite: 550 checks, 138 mutants (each blinds one comparison and must turn the suite red; a no-op control copy must stay green) | `test:db-schema-live-diff` |
| `ops/db/expected-schema.json` | the expectation the job carries: the schema the repository builds, which file creates each object, which PHP file uses each column and whether it asks first | regenerate with `--snapshot` |
| `ops/db/schema-diff.compose.json` | the one-shot job for the Hostinger API (script + expectation embedded as gzip+base64) | regenerate with `--make-job` |

## The procedure (before any backend deploy)

1. **Local, 1 minute:** `node scripts/db-schema-live-diff.mjs --check-snapshot`. Exit 0: the committed expectation is the
   repository. Exit 3: a migration or a file hash changed since it was written. Run `--snapshot`, then `--make-job`, and
   commit `ops/db/expected-schema.json` and `ops/db/schema-diff.compose.json` together. `npm run test:db-schema-live-diff`
   fails in the same situations, so a migration cannot land with a stale expectation unnoticed.
2. **The job** (needs the Hostinger connector; CLAUDE.md, "Probing the live site", has the rules that apply to every
   project: create, read the log, delete). On VM `2058651`, create a project named `sporta-schemadiff` from
   `ops/db/schema-diff.compose.json`. The first create often leaves the project "not found": create again with the same
   name. Read the log. It is a Markdown report and ends with `SCHEMA_DIFF_EXIT=<code>`. Delete the project
   (`vps_docker_delete`).
3. **Paste the report into the deploy plan** (the plan for `vps-deploy.mjs`). `SCHEMA_DIFF_EXIT=0` is the precondition
   for shipping code that touches a new column; `1` means the "What to apply" list has to be applied first, by its own
   owner-approved step with a backup (the 2026-11-02 procedure: backup the touched tables, run the single migration
   file, verify, rerun this job); `2` means the job could not read the database (nothing was concluded).
4. **After the apply, run the job again.** The report is the evidence that the apply did what it should.

What the job mounts is what `db-audit.compose.json` mounts: the store's config and its three database secret files, all
`:ro`, on the `sporta-db_default` network. It uses the store's own database account (all privileges on `sporta`). The least it needs is `SELECT` and `SHOW VIEW` on the
database (proved with such a user): **MariaDB hides foreign keys from an account that has `SELECT` and nothing else**
(measured: 0 of 18 visible; with `SHOW VIEW` or `REFERENCES` all 18). The tool notices (a kind that is expected, present
nowhere and absent from every table) and says so once instead of raising a false "missing foreign key" warning per key;
the foreign-key comparison is then skipped. (Reviewed 2026-11-04: what is hidden from a `SELECT`-only account is
`information_schema.referential_constraints`, the ON DELETE / ON UPDATE rules; `key_column_usage` still lists the columns. The
read joins the two, so the join comes back empty. Reading the keys without their rules would be a refinement, not a fix.) If the Hostinger API refuses the 58 kB project file, say so: the other
read-only jobs carry a 52 kB script and were accepted, and `ops/db/make-audit-jobs.mjs --fetch` shows the alternative
(fetch the script from the public repo at a pushed commit) that would apply here as well.

## Reading the report

The report opens with a verdict, then **What to apply** (the dedicated migrations, in repository order, that supply what
the code needs and is missing), then every migration as *applied / partly applied / not applied*, then the findings.
Every finding says what the CODE needs:

| needs | meaning | severity | exit |
|---|---|---|---|
| `code` | a table, column, unique or primary key, type, nullability, default, character set, CHECK value list or engine that PHP uses **without asking first**. The order, the stock claim or an admin screen fails | error | 1 |
| `guarded` | the same, but every PHP file that uses it asks first (`store_column_exists`, `SHOW COLUMNS`, a `*_table_exists` helper, a 1054/1146 error handler). A feature is off; nothing breaks | warning | 0 (1 with `--strict`) |
| `integrity` | a missing plain index, foreign key or CHECK: slower or less strict, the PHP still runs | warning | 0 |
| `drift` | a default, collation, attribute or unrankable type differs; it works | warning | 0 |
| `extra` | something live that the repository does not define | note | 0 |
| `cosmetic` | a missing object no PHP file in the repository names (a name assembled at run time would not be seen: the SQL itself is the check); a wider column; an equal key under another name | note | 0 |

**Direction matters for types.** A live `varchar(255)` where the repo says `varchar(80)` is a note; `varchar(8)` where
it says `varchar(15)` is an error ("longer values are refused or cut"); a `decimal(10,2)` where `decimal(10,3)` is
expected is an error and says *money column* (amounts are rounded); a signed integer where unsigned is expected is an
error; an UNSIGNED decimal where a signed one is expected is an error (a negative amount is refused); a `date` where a
`timestamp` is expected is an error (the time of day is cut off); a UNIQUE key (or the primary key) on other columns than
the repository's is an error, like a missing one; `latin1` where Arabic is stored is an error, `utf8mb3` a warning (no emoji). A CHECK whose value list lacks a value
the code writes (the `outbox_kind_ck` of a database that never ran `outbox-kinds.mysql.sql`) is an error and names that file.

**Which file explains it.** Each missing object lists every repository file that creates it, dedicated migration first,
then `schema.mysql.sql`, then `install.mysql.sql`. `schema.mysql.sql` repeats most migrations inline ("byte for byte the
same statements"), so a naive "who created this column" answers *schema*; the dedicated migration is the one to run.

**Extras are classified, never judged.** `old-build` (the 38 tables of the pre-repository storefront that the 2026-11-01
production dump carries and no PHP here reads: DATA-SCAN-2026-11-02 section 7 says do not drop), `opencart` (`oc_*`),
`wordpress`, `prestashop`, `framework`, `backup-copy` (`*_legacy_2026102x`, `_bak`, dated copies), `planned` (the privacy
pack's `privacy_runs` / `privacy_erasures`, created by `ops/db/privacy-schema.sql`), `unknown`. Each shows an approximate
row count (an engine estimate, not row data). Triggers, routines, events and views are listed as notes: nothing in this
repository creates one.

## Read-only, and how that is shown rather than promised

* **Two locks.** Every statement goes through `assertReadOnlySql()`, which refuses anything but `SELECT` / `SHOW` (and the
  three setup statements), several statements at once, `SELECT ... INTO OUTFILE`, and locking reads. Then the session is
  `SET SESSION TRANSACTION READ ONLY` and `START TRANSACTION READ ONLY`, and `@@tx_read_only` must read 1 before the first
  schema query or the tool stops (exit 2). The suite bypasses the gate on purpose and shows the **server** refusing the
  write with error 1792.
* **Counters.** Three runs against a private instance moved none of `Com_insert`, `Com_update`, `Com_delete`,
  `Com_alter_table`, `Com_create_table`, `Com_drop_table`, `Com_truncate`, `Com_grant`, `Com_flush`.
* **What is read:** `information_schema` tables, columns, statistics, key usage, referential and CHECK constraints,
  triggers, routines, events, restricted to `DATABASE()`. 14 statements. No data table is ever named in a `FROM`.
* **What is printed:** names, types, defaults as written in the schema, CHECK clauses, engine row estimates for unknown
  tables. No row, no value of any column, no credential. Credentials come from `--config` (the store's config file), or
  `DB_*` environment variables, or `*_FILE` secret files, and a message passes through `scrub()` before it is printed (the
  suite shows a wrong password in neither stdout nor stderr).
* **No dependencies.** The MySQL text-protocol client is the one `db-url-scan.mjs` uses, so the job runs in a bare
  `node:24-alpine`. It speaks `mysql_native_password` only (as the other read-only jobs do).

## What was measured on the repository

(All of this is produced by `npm run test:db-schema-live-diff` and the modes above; nothing here is the live database.)

* The expectation: **29 tables, 300 columns, 84 indexes, 18 foreign keys, 36 CHECK constraints**, built from 30 SQL files
  (the ten install parts including `schema.mysql.sql`, 19 further migrations, and `sporta-live/birthday/birthday.mysql.sql`,
  which the dropin PHP needs), with `install.mysql.sql` kept alongside as a bundle. 12 guards found in the PHP.
* **Perfect database:** one built the other way round (install first, then every other file) has an empty diff and equals
  the expectation object for object.
* **The 2026-11-02 incident reproduced:** drop the four `product_variants` columns and the two tables `inventory.mysql.sql`
  and `admin-recovery-codes.mysql.sql` create: six errors, exit 1, "What to apply" is exactly those two files, each
  reads *not applied*.
* **The real production structure of 2026-11-01** (`docs/live-schema-structure.sql`, columns only) replayed through the
  same code: 47 errors, 4 warnings, 60 notes (the first version of this document said 43 / 4 / 64, before the abandoned-orders table entered the expectation); it names `inventory.mysql.sql`, `admin-recovery-codes.mysql.sql` and ten more
  files; all 38 old-build tables are recognised. That dump is older than the VPS database (it has no `customer_accounts`,
  `crm_*`, `support_*`), so it is a stress test, not a statement about today.
* **Migration integrity** (`--integrity`, on a private instance): every file applies on top of the files before it; a
  second run of every file is error-free and changes no schema object and no row; the dedicated migrations in reverse and
  in four seeded shuffles on top of the install parts reach the same schema; `install.mysql.sql` followed by the rest equals
  the canonical build. The only dependency the header does not declare: `birthday.mysql.sql` needs `customers.mysql.sql`.
* **Lint** (`--lint-migrations`, 33 files): no DROP, TRUNCATE, DELETE/UPDATE without WHERE, RENAME, MODIFY, stored routine or
  schema-qualified name anywhere; two `DROP CONSTRAINT IF EXISTS x` + `ADD CONSTRAINT x` pairs are redefinitions of a CHECK
  (`outbox-kinds`, `reviews`); every CREATE pins engine, charset and collation. The warnings are the overwrites below.

### Findings (each reproduced by the suite or a mode of the tool)

| # | severity | finding | evidence | fix |
|---|---|---|---|---|
| S3-01 | **high** | **Re-importing `install.mysql.sql` (or `seed.mysql.sql`, `brands.mysql.sql`) silently undoes the owner's edits.** `preflight.php` and the file's own header call it "safe to re-run ... repairs what is missing". Measured: after the owner changed a product's price, name, active flag and category, a variant's cost, a brand's name and a product's no-exchange flag, a second import of `install.mysql.sql` put back the seed price, name, active flag, cost, brand name and no-exchange flag (stock and settings survived). `seed.mysql.sql` alone does the same; `brands.mysql.sql` resets brand names; `promo.mysql.sql` is clean | `--integrity`, section `seed`; lint rule `overwrite-on-rerun` at `seed.mysql.sql:11,63,120,121`, `brands.mysql.sql:23` and their copies in `install.mysql.sql` | the install file seeds with no-clobber semantics: `patches/install-no-clobber.patch` (a `keepOwnerEdits()` step in `make-install-sql.mjs`; the part files are unchanged; proven: one import equals the parts by hand, a second import changes no row, every owner edit survives, the lint finds nothing left in the install file). Until it is applied: never re-import `install.mysql.sql` to catch up a live shop (the report says so); run the single migration |
| S3-02 | medium | `preflight.php` checks 10 table names and no column. It would have been green on the 2026-11-02 database. 18 tables the code uses without a check are not on its list (including `inventory_movements` and `admin_recovery_codes`, the two that were missing) | `packagingChecks()` | `patches/preflight-schema-check.patch`: preflight reads `schema-needs.php`, generated by `--print-preflight` (254 tables and columns), and names the file to import. Proven with the real page against four private databases: the incident database turns the new row red and names both files, a perfect one and one missing only guarded columns stay green, and the current page is blind to it |
| S3-03 | low | `install.mysql.sql` alone lacks the `abandoned_followup` table (9 objects) although `abandoned.mysql.sql` says "install.mysql.sql carries the same statements" (the schema file does not repeat them), and lacks the 3 birthday columns (`sporta-live/birthday/birthday.mysql.sql` is not a dropin file). `--integrity` shows static claim and built result agree (12 objects) | `lackedByInstall()` | add `abandoned.mysql.sql` to `make-install-sql.mjs` PARTS (S1's `install-parts.patch` in its lane folder adds the birthday and three other files, not this one) |
| S3-04 | low | two guards ask for a column no migration creates, so their feature is off for good: `customer_accounts.last_login_at` (`profiles.php`) and `products.updated_at` (the sitemap `lastmod`, two files) | `guardsOnMissing()` | S1's `customer-last-login.mysql.sql` / `products-updated-at.mysql.sql` |
| S3-05 | low | `birthday.mysql.sql` and `crm.mysql.sql` each need `customers.mysql.sql` first (`crm` creates an index on `orders.customer_account_id`, a column `customers` adds; `birthday` alters `customer_accounts`) and neither header says so. The install order and any order that puts `customers` first are right; alphabetical import from `schema.mysql.sql` is not | `--integrity` `deps` | one sentence in each header |
| S3-06 | low | `file-audit.mjs` requires 4 of the 29 SQL files to be in the package, and the README in the package describes "the four files" (`1-schema ... 4-promo`) while the install is ten parts | `packagingChecks()` | text |

### What the owner will see

On the database of 2026-11-02 (before the fix) the report starts like this (abridged; produced by the suite on its private
MariaDB 10.11 from a database made by dropping what the two migrations create; on the VPS the server line shows 11.8):

```
# Live schema diff: sporta
**FAIL: 6 problem(s) the code needs**
- live server: 10.11.14-MariaDB-0ubuntu0.24.04.1; default collation utf8mb4_unicode_ci; 27 tables, 277 columns
- expected: 29 tables, 300 columns, from 31 SQL files (snapshot ...)
## What to apply
1. `admin-recovery-codes.mysql.sql`
2. `inventory.mysql.sql`
## Problems the code needs (exit 1) (6)
| column missing `product_variants.inventory_version` | bigint(20) unsigned not null | absent | used by admin.php, store.php without a check | inventory.mysql.sql, schema.mysql.sql, install.mysql.sql |
| table missing `inventory_movements` | table (15 columns) | absent | used by admin.php without a check | inventory.mysql.sql, schema.mysql.sql, install.mysql.sql |
...
```

On a database that carries the repository schema plus the old build's tables (what the VPS is expected to look like: 70
tables, 41 of them the repository does not define) it is 99 lines: `PASS`, "Nothing the code needs is missing", the migration
table, and 41 notes classified by family. The log of a one-shot job is capped at 300 entries; the report stays under that.

## What only the live database can confirm

* The exact **collation** of columns created without one. Every `CREATE TABLE` in the repository pins charset and collation,
  so this does not arise for the repository's tables; an old-build table may carry `utf8mb4_uca1400_ai_ci` (the MariaDB 11.5+
  default) and the tool reports it as an extra, not a problem.
* **MariaDB 11.8 spellings.** The tool normalises `utf8` to `utf8mb3`, integer display widths and the string `'NULL'`
  default. CHECK clauses are compared after lower-casing and removing quotes and spaces; if 11.8 prints one differently
  the report shows a *changed* CHECK as a warning (never an error unless a value the code writes is missing from the list).
  The private server here is 10.11.14.
* **Privileges.** `information_schema` shows a user only what its privileges allow. An account without `SELECT` on a
  table would see it as *missing*; with `SELECT` alone it cannot see foreign keys (above). The store's own account has all
  privileges on `sporta`, and so does the account the job uses unless the least-privilege pack (`ops/db/grants.sql`) is
  applied first; after that, `SELECT` plus `SHOW VIEW` on the database is the minimum (the pack's `sporta_ro` job account has exactly that).
* **Whether the connector accepts a 58 kB compose file.** The 52 kB audit job is the nearest precedent; this one is 6 kB larger. If it is refused, `ops/db/make-audit-jobs.mjs --fetch` shows the alternative (fetch the script from the public repo at a pushed commit).
* **Which of the 41 notes are really there.** The 38 old-build names come from the 2026-11-01 dump; the live database may have gained or lost some, and the three `*_legacy_2026102x` tables are recognised by pattern.
* **Auth plugin.** `mysql_native_password` only; an account switched to `caching_sha2_password` or `ed25519` is refused
  at sign-in (exit 2, stated).

## Limits of the "does the code need it" judgement

It is static and errs towards "needs": a column counts as used by every PHP file that mentions both its table and its
name, and as guarded only in files that contain a guard for it (or call a function that does, or whose column was added
by the same `ALTER` as a guarded one). A file that guards a column anywhere is treated as guarding it everywhere; the
repository's guards all wrap every use (checked for `discount_ids`). Dynamic SQL built from a column list is not followed
(lane S1's `db-columns-audit.mjs` runs `EXPLAIN` on every statement). The result for a missing column the code does not
mention is a note, not an error.

## Independent review (S3-verify, 2026-11-04)

A second pair of eyes re-ran everything on its own MariaDB (own datadir, own port) and tried to make the tool lie. Facts first.

**Confirmed as written:** S3-01 to S3-08 reproduce (S3-08 with one correction: what MariaDB hides from a `SELECT`-only account is
`referential_constraints`, the rules, not `key_column_usage`). A database built in a different order (schema, install, every
other file, birthday) is 29 tables and 300 columns and reads PASS with zero findings; ten random columns of the expectation equal
that database and the 2026-11-01 production structure; a second pass of every file changes no table and no row; the committed job
has the same shape and mounts as `db-audit.compose.json`; a live run sends 14 statements, all `SELECT` / `SHOW` / read-only setup,
and moves no write counter. The two patches work: `preflight-schema-check.patch` reads green on a perfect database, red on the
2026-11-02 one (naming `admin-recovery-codes.mysql.sql` and `inventory.mysql.sql`), green when only guarded columns are missing.

**Defects found in the tooling, all fixed here, each with a check that fails without the fix:**

| # | what the first version did | consequence | now |
|---|---|---|---|
| V-01 | the mutation harness loaded each mutant from a bare temp folder; the tool finds the repository from where it lives, so every mutant saw no PHP and no migrations and turned a dozen checks red | "88 mutants killed, 0 survived" was true of ANY mutant, a byte-identical one included. Run honestly, 6 of the 83 original mutants survived (`changed indexes not reported`, `auto_increment loss`, `SHOW COLUMNS not recognised`, `sibling columns not covered`, `preflight list: guarded tables included`, `lint: tables without ENGINE/COLLATE`) | mutants live in a mirror of the repository layout; a CONTROL copy with only a comment added must stay green; 50 more mutants added; every one is killed by its own check |
| V-02 | a UNIQUE key (or the primary key) on other columns than expected was a warning; a missing one is an error | `products.slug` made UNIQUE(`name_en`) passed; the seed's `ON DUPLICATE KEY` then inserts duplicate slugs | a moved UNIQUE key is an error |
| V-03 | a signed decimal replaced by an UNSIGNED one was "harmless"; `timestamp` to `date` was "cannot be ranked" | negative amounts refused; the time of a 24 h hold, a cooldown or "paid at" cut off | both are errors; `double` to `float` and fewer fractional-second digits too |
| V-04 | a guard written inside a comment (`// store_column_exists(...)`) counted as a guard | a missing column would have been a warning, exit 0 | comments are removed before guards are looked for |
| V-05 | the config parser accepted `trim(` + `@` + single quotes only | a live config reading its secrets as `trim((string)@file_get_contents(...))` or with double quotes made the job exit 2 "no credentials" on the one live run | any wrapper, cast, `@` and quote style; the mounted `/run/secrets/sporta_db_*` files as the last resort; a literal followed by `.` is no longer taken for the whole value |
| V-06 | the migration lint ignored `ALTER TABLE ... ENGINE / CONVERT TO / CHARACTER SET` and any statement shape it did not parse (`GRANT`, `CALL`, `PREPARE`) | a migration could rewrite or re-privilege everything and pass | two new warnings: `rewrites-table`, `unrecognised-statement` (the repository has none of either: still 0 errors, 13 warnings) |
| V-07 | the report said a missing column "no PHP in the repo uses" | a column named only at run time (`'inventory_' . 'version'`) reads as unused | the text says the name is not mentioned and that run-time names are not seen |

**Found in the patches, delivered as `install-no-clobber-v2.patch` (supersedes the lane's):**

* The lane's no-exchange gate was a session variable. A shop that already had its catalogue but whose `products` lacked the
  `no_exchange` column (schema adds it in the same import) kept all 29 women's and outerwear products exchangeable (old install:
  29 flagged, lane's patch: 0), and phpMyAdmin resumes an interrupted import in a new connection where the variable is gone.
  v2 reads the data instead.
* `install.mysql.sql` on an empty database leaves `product_variants.unit_cost_kwd` NULL for all 42 seeded sizes (the schema
  part's backfill runs before the seed part creates a variant); a second import fills it and moves every `updated_at`. v2 repeats
  the NULL-only backfill at the end of the file.
* `abandoned.mysql.sql` is in no install part and its header says the schema file repeats it "byte for byte"; it does not.
  v2 makes it install part 8 (S3-03).

**What this document still cannot say** (only the live database can): the live config's real shape, MariaDB 11.8's spelling of
CHECK clauses and defaults, which old-build tables exist, whether the account sees everything, whether the connector accepts the
61 kB project file. The live-only list above stands.

## Keeping it true

* Adding or changing a migration: `node scripts/db-schema-live-diff.mjs --snapshot && node scripts/db-schema-live-diff.mjs --make-job`,
  commit both files with the migration. The suite fails if either is stale (the job embeds the script, so changing the
  script needs `--make-job` too).
* The `/*M:...*/` comments in the tool are the mutation anchors the suite uses; leave them.
* `--integrity` and `--lint-migrations` are the checks to run on a new migration before it is reviewed; the first needs
  MariaDB, the second does not.
