# Database accounts and privileges (`ops/db`)

**Status: built and proven on a private MariaDB 10.11 and private PHP. NOT applied to the live
database. Nothing here runs by itself.** A live change goes through the existing one-shot job route
(a compose job on the VPS through the Hostinger connector, or `scripts/vps-deploy.mjs` for files),
needs the owner's confirmation at apply time, and never uses SSH, a PHP endpoint or CI.
This directory is **not** part of the web package: `make-package.mjs` and `bundle-php.mjs` copy only
`dist/` and the `dropin/php-*` folders, so nothing under `ops/` ships (the suite asserts it).

**Independently reviewed** (see section 13 for what the review found and changed): the privilege list was
re-derived by asking the server itself (`PREPARE` checks privileges when a statement is prepared) for 254
distinct statements as each account, and the tools were attacked with planted faults.

Other lanes keep their own files here (`sporta-db-hardening.cnf`, `AUDIT-FIXES.md`: the server
settings and the audit tool). This README covers **accounts, privileges and passwords**.

## 1. What problem this solves

The shop's PHP connects to MariaDB as one account (`sporta_app@%` per `VPS-SCAN-2026-10-31.md`,
and `root@%` also exists). What that account can do is not recorded in the repo; the first step is
`audit-accounts.sql` (read-only). Whatever it turns out to hold, the **application never needs**
`DROP`, `ALTER`, `CREATE`, `INDEX`, `GRANT OPTION`, `FILE`, `PROCESS`, `RELOAD`, `SUPER`,
`LOCK TABLES`, `CREATE TEMPORARY TABLES`, `TRIGGER`, `EVENT`, `EXECUTE`, `CREATE VIEW`, `CREATE
ROUTINE`, and never `DELETE` on an order or an audit table. Every prepared statement in the code
is injection-safe today, but one logic bug in any of ~100 routes would run with whatever the
account can do. After this change it runs with what the route needs.

How the list was found, so it can be re-checked: `scripts/lib/php-sql-map.php` reads every string
in `dropin/php-store`, `php-knet` and `php-cbk` with PHP's own tokenizer;
`scripts/lib/sql-privileges.mjs` follows the calls from each entry script to the SQL it can reach
and turns it into table and column privileges. **There is no DDL, no `LOCK TABLES`, no temporary
table, no `FILE` access, no `GRANT`, `FLUSH`, `KILL` or `SET GLOBAL` anywhere in the application
PHP** (the suite asserts it). `get_lock`, `last_insert_id`, `information_schema.columns`, `SHOW
COLUMNS` and `SELECT ... FOR UPDATE` need nothing beyond `SELECT` on MariaDB (measured).

## 2. The accounts

All are created **locked** (`ACCOUNT LOCK`), bound to a docker-network host pattern (never `%`),
capped by `MAX_USER_CONNECTIONS`, with a 40-character generated password. The server is sent only the
password's **hash** (section 8), so no log of the server can hold a password.
`ops/db/grants.sql` is generated (`npm run db:grants`) and the suite fails if it drifts from the code.

| Account | Used by | Host | Cap | May | May **not** |
|---|---|---|---|---|---|
| `sporta_web` **(tier 1)** | api, admin, customer, crm, assistant, SEO pages, sitemaps, birthday and all `cron-*` | app | 100 | SELECT/INSERT/UPDATE on the 28 repo tables as the code needs (UPDATE by column on 16, table-wide on 4 whose SET list is built at run time: `orders`, `discounts`, `hero_slides`, `customer_accounts`), DELETE on 8 (never `orders` or a log table) | DDL, GRANT, FILE, PROCESS, RELOAD, LOCK TABLES, TRIGGER, anything on the ~40 old-build tables, DELETE on `orders` or any log table, UPDATE of any log table |
| `sporta_knet` | `knet/pay.php`, `knet/callback.php` | app | 15 | SELECT `orders`, `order_items`, `products`; INSERT `fulfilment_outbox`; the shared rate limiter (`rate_limit`, added to KNET by the release gate's working tree); UPDATE **only** the bank-result columns of `orders` (`payment_status`, `paid_at`, `pay_attempt`, `cbk_*`) | change an amount, a phone, an address, a fulfilment status; touch stock, settings, customers, admin tables |
| `sporta_tpay` | `pay/pay.php`, `pay/callback.php` | app | 15 | the same set as KNET (5 tables) | same as KNET |
| `sporta_ro` | backups (`mariadb-dump --single-transaction`), data scans, reports | job | 3 | SELECT + SHOW VIEW on the whole database (so a backup includes the old-build tables) | write anything; LOCK TABLES; read anything outside this database |
| `sporta_migrate` | the `*.mysql.sql` migrations, `setup-admin.php` | job | 3 | CREATE, ALTER, INDEX; SELECT on the repo tables; INSERT/UPDATE only where a migration writes (including INSERT into `admin_users`, which `setup-admin.php` needs) | DROP (so also no RENAME), DELETE, any DML on old-build tables. **It CAN still destroy data: `ALTER TABLE t DROP COLUMN c` and `ALTER TABLE t DISCARD TABLESPACE` need only ALTER (measured, and pinned by the suite), on every table of the database including the old-build ones. Keep it LOCKED except while a migration runs** (`render-grants.mjs --unlock migrate`, then `--lock migrate`) |
| `sporta_shop` **(tier 2)** | storefront, checkout, order status, customer accounts, returns, support, assistant, SEO | app | 80 | what `api.php`, `customer.php`, `birthday.php`, `seo-page.php`, sitemaps reach: 20 tables; UPDATE of `orders` only for the order-creation columns | read `admin_users`/recovery codes/CRM/stock ledger; change a price, setting, brand, slide; mark an order paid; write the activity log |
| `sporta_admin` **(tier 2)** | `/backends` API, Google sign-in callback, preflight | app | 20 | the admin routes' tables (26) | DELETE on `orders` or logs; INSERT into `admin_users` (only `setup-admin.php` does that) |
| `sporta_cron` **(tier 2)** | `cron-stock`, `-fulfilment`, `-whatsapp`, `-birthday`, `-voice` | app | 10 | 11 tables | admin tables, products, brands, prices |

**Append-only by construction.** No code path updates or deletes `admin_activity_log`,
`inventory_movements`, `order_tracking_events`, `crm_notes`, `support_messages` or
`return_request_events`, so no account is given UPDATE or DELETE on them. Nobody deletes an order.
A stolen web credential can no longer erase its own tracks or the sales ledger.

**Why the gateways are separate.** They run in the same PHP process tree and read the same
config file, so a separate account does not stop someone who can read PHP files. It stops the other
direction: a bug in a gateway page can only touch the bank-result columns of an order (it cannot
rewrite the amount it just verified), and a flood on the storefront cannot starve the payment
callbacks (caps sum to 136 in tier 1 and 146 in tier 2, under MariaDB's default
`max_connections` of 151; check the live value).

**Tier 1 needs no code change** (the config values change, nothing else). **Tier 2** splits the one
runtime account into three and needs `php-roles.patch` (section 6). Do tier 1 first.

## 3. The privileges, one by one

| Privilege | Decision | Why |
|---|---|---|
| SELECT / INSERT / UPDATE / DELETE | granted per table (UPDATE per column where the SET list is static) | derived from the code |
| `INSERT ... ON DUPLICATE KEY UPDATE` | needs UPDATE on **every column in the INSERT list**, not only the updated ones | measured: with `UPDATE(hits)` alone `rate_limit` failed with error 1143 and every public route 500'd. The derivation accounts for it |
| DROP, TRUNCATE | removed everywhere | no code drops or truncates; `sporta_migrate` has none either |
| ALTER, CREATE, INDEX | `sporta_migrate` only | the suite revokes each in turn and shows a migration fails (so each is needed there) and none is needed anywhere else |
| REFERENCES, TRIGGER, EVENT, EXECUTE, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE | removed (`SHOW VIEW` kept on `sporta_ro`) | the schema has no view, trigger, routine or event |
| LOCK TABLES | removed | nothing uses it (`mariadb-dump` default needs it and fails with 1044; use `--single-transaction`, which works with SELECT + SHOW VIEW, measured) |
| CREATE TEMPORARY TABLES | removed | no temporary tables |
| FILE | removed | no `LOAD_FILE`, `INTO OUTFILE`, `LOAD DATA` in the code; with FILE a SQL injection reads server files |
| PROCESS, RELOAD, SUPER, SHUTDOWN, CREATE USER, REPLICATION * | removed | nothing the shop does |
| GRANT OPTION | removed | an account must not be able to hand its power on |
| `FOR UPDATE` | no extra privilege | measured: SELECT alone is enough on MariaDB |
| `GET_LOCK` / `RELEASE_LOCK` | no privilege exists | used by cron-fulfilment, cron-whatsapp, store (COD lock) |

## 4. Files

| File | What it is |
|---|---|
| `grants.sql` | the accounts and the exact grants. **Generated. Placeholders only; never feed it to the client unrendered** (the first statement stops it with error 1242). |
| `make-grants.mjs` | derives `grants.sql` from the code (`npm run db:grants`; `--check` for CI-less checking) |
| `accounts.mjs` | the account model as data (names, host class, caps) |
| `render-grants.mjs` | fills in database name and host patterns, generates the passwords (CSPRNG, 0600 files, never printed) and sends the server **only their hash**. `--activate a,b` unlocks accounts at creation; `--only a,b` renders just those accounts' blocks; `--additive` leaves out the "empty the account, then grant" step (the way to re-apply a LIVE account); `--rotate a,b` prints `ALTER USER` with fresh passwords; `--lock a,b` / `--unlock a,b` print `ACCOUNT LOCK` / `UNLOCK` and nothing else. Refuses every host pattern that is not an address, a whole-octet `N.N.%`, a netmask of at least /8, or a plain name (so not `%`, `1%`, `1.%.%.%`, `0.0.0.0/0.0.0.0`), weak passwords, and printing to a terminal. Needs only `accounts.mjs` and `grants.sql` beside it. |
| `verify-accounts.mjs` | signs in as each account and probes what it may and may not do **without changing a row** (zero-row statements). Run it before any config switch. |
| `audit-accounts.sql` | read-only: version, settings, every account (empty password, also beside a second method; anonymous; every spelling of "any host"; weak password; locked), roles granted to accounts and what they carry, proxy grants, global/database/table/column grants, tables, who is connected |
| `hygiene.sql` | idempotent: drops anonymous accounts and `test`, `local_infile=0`, installs the password-policy plugins |
| `drop-root-remote.sql` | **owner-gated**: removes `root@%` |
| `retire-old-account.sql` | **last step**: locks the old `sporta_app@%` (one-statement undo) |
| `php-roles.patch` | tier 2: `store_db()` picks the account by entry script, with safe defaults; `preflight.php`; the four new keys documented in `config.example.php`. A patch, **not applied**. |
| `php-roles-tests.patch` | the matching manifest entries in `scripts/config-rules-test.mjs`. **Apply it with the other one**: without it `test:config-rules` fails on `db_admin_user` (proved by the suite). |

## 5. Applying it: the order that cannot lock the shop out

Nothing below changes what the live site connects with until step 5. Steps 1 to 4 only add accounts.
The old account is never touched before step 8, and step 8 is reversible.

0. **Read, don't change.** Run `audit-accounts.sql` as the admin account in a one-shot job (the shape is in
   "The job", below). Keep the output. Note: the old account's real grants, `root@%`, the `plugin` column
   (`mysql_native_password` expected), the plugin list (are `simple_password_check`, `password_reuse_check`
   `NOT INSTALLED` = present in the image?), `max_connections`, and the *connections* table (does anything
   but `apache-sporta` connect? a phpMyAdmin, a scan, a backup job, n8n?). Anything found there that is not the
   shop needs its own plan before step 8.
1. **Schema diff first** (CLAUDE.md rule, `DATA-SCAN-2026-11-02.md`): every repo migration must already be on the
   live database. `grants.sql` names tables and columns; a missing one makes the `GRANT` fail loudly and the
   accounts stay locked and under-granted, which is harmless but stops the run.
2. **Pick the host patterns.** `docker network inspect` for the network `apache-sporta` and the database share
   (VPS-SCAN says `sporta-db_default`) gives its subnet. Use a pattern that matches that subnet and nothing else:
   `172.18.0.%` style (MariaDB's `%` wildcard) or the `<network>/<netmask>` form, for both `--app-host` and
   `--job-host` (the job container joins the same network). `%`, an empty host and any pattern that starts with a
   wildcard are refused by the renderer.
3. **Create the accounts (locked).** The job runs `render-grants.mjs ... --generate | mariadb ...` as the admin
   account. Passwords are generated inside the job and written `0600` into a new directory that is **not** mounted
   in the web container. Nothing is printed, and the server is sent only the hashes (check that the server's
   general log and slow-query log are off anyway: `audit-accounts.sql` section 1). Re-running is safe **while
   nobody uses the accounts**: each account is emptied and granted again, and the whole file takes seconds
   (2.4 s measured on a private instance; every in-use account got "access denied" for 0.3 to 1 s of it). Once an
   account is live use `--additive` or `--only`, see "Re-applying while the shop is live" below.
4. **Verify, still without touching the site.** Unlock the accounts you will use
   (`--activate web,knet,tpay,ro`; the same command again; **not `migrate`**: unlock that one only for the minutes a
   migration runs, `--unlock migrate`, and `--lock migrate` straight after) and run
   `verify-accounts.mjs --host <db> --secrets <dir> --accounts web,knet,tpay,ro`. Every account must say `ok`. It signs in as each one and
   proves the allowed statements work and the forbidden ones are refused, without changing a row.
   **Do not continue on any FAIL.** (To prove the *migration* account against the live database, unlock it, run the
   migrations once as `sporta_migrate` in the same job: idempotent, `install.mysql.sql` is safe to re-run, and
   lock it again.)
5. **Switch the config, one file at a time, smallest blast radius first** (section 7 has the keys):
   a. `sporta_ro`: point the next scan/backup job at it. No site effect.
   b. `knet-config.php` `mysql_user`/`mysql_pass` -> `sporta_knet`. Take effect on the next KNET request. Check
      `/knet/pay.php?trackid=<a pending test order>` still answers 302 (read-only: it writes `pay_attempt`, so use
      a test order; or rely on step 4).
   c. `pay-config.php` -> `sporta_tpay`.
   d. `db_user`/`db_pass` (the two secret files behind `api-config.php`) -> `sporta_web`. This is the one that
      moves the storefront and the admin. Do it in a quiet minute.
   Each switch is one value pair in one file; **the old account still works**, so a wrong value is rolled back by
   writing the old value back (keep the old values in the job output of step 0, never in chat).
6. **Watch.** The site checks that cost nothing: `./scan-server-response.sh`, then a normal read-only crawl
   (`/`, `/shop`, `/product/…`, `/api/api.php?r=products|stock|checkout_config`). Then one real cash order and one
   `/backends` sign-in plus a product save by the owner. Then `audit-accounts.sql`'s connections table: the traffic
   is now `sporta_web`, `sporta_knet`, `sporta_tpay`.
7. **Wait** (a quiet week, one real KNET payment). Re-run `verify-accounts.mjs`.
8. **Only then** `retire-old-account.sql`: it *locks* `sporta_app@%`. Undo: `ALTER USER 'sporta_app'@'%' ACCOUNT
   UNLOCK;`. After another quiet week `DROP USER`. `drop-root-remote.sql` is separate and only after you can reach
   root through `docker exec` and the connections table showed no job connecting as root.
9. Run `hygiene.sql` any time after step 0 (it does not touch the new accounts or the old one).

### Re-applying while the shop is live

`grants.sql` converges: every account block empties the account and grants the exact set again. For an account
the shop is using, that is a moment with **no privilege at all**; measured on a private MariaDB with probes
asking every few milliseconds: **web 0.3 s, knet about 1 s** (the whole file, 2.4 s, because the REVOKEs came
first; the blocks now sit together, so each account's window is only its own grants, a few hundred ms for
`sporta_web`, tens of ms for a gateway). A bank callback that lands in the window answers 500 and the customer
has paid for an order the shop still shows unpaid. On a disk that syncs every commit the numbers are larger. So:

* **Routine re-apply (the file changed, an account was added):** `render-grants.mjs ... --additive` (no REVOKE:
  nothing is ever removed, nothing is ever missing). Measured: sessions of web, knet and tpay kept reading
  `orders` through a whole-file additive re-apply with zero errors.
* **Remove a privilege that should not be there** (`verify-accounts.mjs` or `audit-accounts.sql` found one, or
  `grants.sql` got narrower): `--only <account>` (a full block for just that account), at a quiet time, never
  while a payment is in flight; for `knet`/`tpay` pick the early hours, or create the account under a new name,
  switch the config file, and lock the old one.
* A `GRANT` that fails halfway (a column the live schema lacks) would leave an *emptied* account half-granted;
  that is one more reason the routine path is `--additive`, and why step 1 (the schema diff) comes first.

### Rollback, at any step

* Steps 1 to 4: `DROP USER 'sporta_web'@'<host>';` (and the others). Nothing used them.
* Step 5: put the previous `db_user`/`db_pass` (or `mysql_*`) back. The old account is untouched until step 8.
* Step 8: `ALTER USER ... ACCOUNT UNLOCK`.
* `render-grants.mjs --rotate` can be re-run at any time. `grants.sql` converges on the file, but re-apply a LIVE account only with `--additive` or `--only` (see above).

### The job

One compose project on the database's docker network, run once and deleted (the project's rule; see CLAUDE.md
"Probing the live site from a session"). Shape, not a script to paste: an image with Node 24 and the `mariadb`
client (for example `node:24-alpine` plus `apk add mariadb-client`); the three files
(`accounts.mjs`, `render-grants.mjs`, `grants.sql`) fetched at a pinned commit (the repo is public, they hold no
secret) or copied in; the admin client config as a read-only `0600` file mounted from the host (never a literal
in the compose file, never a `$`); a read-write mount of a new root-only directory for the password files;
and the command `node render-grants.mjs --db sporta --app-host … --job-host … --secrets /secrets --generate |
mariadb --defaults-extra-file=/admin.cnf -h mariadb`. (Never add `--force` to the client: it is there to continue
past errors, and a half-applied file is worse than a stopped one. Measured: the unrendered file fails every
`CREATE USER` even with `--force`, because `@@APP_HOST@@` is not a valid host, so nothing is created.) Redirecting
to a file instead of a pipe: `umask 077` first; the file holds hashes, not passwords, but treat it as secret. How root authenticates inside the live database container
(password in its environment, or the unix socket) is **not recorded in the repo**: step 0 must find out, and if
the connector refuses a construct, adjust the job, not the files.

## 6. Tier 2: three runtime accounts (needs the patch)

`php-roles.patch` (`store.php`, `preflight.php` and the documentation of the four keys in `config.example.php`) makes `store_db()` choose by the entry script
(`$_SERVER['SCRIPT_FILENAME']`): `admin.php`, `admin-google.php`, `preflight.php` use `db_admin_user`/`db_admin_pass`; every
`cron-*.php` uses `db_cron_user`/`db_cron_pass`; everything else (the storefront) uses `db_user`/`db_pass`.

* **Safe defaults:** a role whose pair is absent, empty or half-set falls back to `db_user`/`db_pass` (half-set
  logs a line). Deployed *before* any config change the code behaves exactly as today (proved by the suite: the
  patched code against the old config connects only as the single account).
* **Fail-closed on a new file:** an unlisted entry script gets the *storefront* (least) account. The suite fails
  when a new `*.php` appears in `dropin/php-store` that is neither a listed entry script nor a library, so it
  must be assigned a role before it ships.
* `assistant_db_or_null()` (the cron-voice warmer) and `sporta_seo_db()` keep using `db_user`: in tier 2 that is the
  storefront account, which has the SELECT they need (proved).
* Apply with `patch -p1 -d sporta-web < ops/db/php-roles.patch && patch -p1 -d sporta-web < ops/db/php-roles-tests.patch`
  (or `git apply`) in the release that carries the other backend changes; **it is not applied** and `store.php` is
  being edited by the release gate, so rebase it if it no longer applies (the suite prints `weak` when it does not).
  The second patch is the manifest entry for the four new keys in `scripts/config-rules-test.mjs`. The first version
  of this patch had no such entry and no `config.example.php` lines: applied on its own it made `test:config-rules`
  fail on `db_admin_user` (reproduced on a copy of the tree; the suite now runs the suite with and without the
  second patch and compares).
* Config for tier 2: `db_user`/`db_pass` = `sporta_shop`; add `db_admin_user`/`db_admin_pass` and
  `db_cron_user`/`db_cron_pass`. `sporta_web` is then retired like the old account.

## 7. The config side

| File (live) | Keys | Today | Becomes |
|---|---|---|---|
| `/run/sporta-api-config.php` (root:33, 0440) | `db_host`, `db_name`, `db_user`, `db_pass` | `db_name/db_user/db_pass` are read from `/run/secrets/*` (0600 33:33) | tier 1: new **values** in the same two secret files; `db_host`/`db_name` unchanged. Tier 2 adds the two role pairs |
| `/run/sporta-config/knet-config.php` | `mysql_host`, `mysql_name`, `mysql_user`, `mysql_pass` | literal copy of the store's values (config-6) | `sporta_knet` and its password, literal, in this file |
| `/run/sporta-config/pay-config.php` | same four | none, borrows `db_*` from the store config | **add all four** explicitly (`hasDb` needs name and user non-empty; borrowing stops once they are set) with `sporta_tpay` |

* No code change is needed for tier 1: the gateways already prefer their own `mysql_*` ("explicit values win",
  `knet_with_store_db`, `cbk_with_store_db`) and the store reads `db_user`/`db_pass`.
* This also ends the "400 Invalid amount" rotation trap for good in one direction: each file now owns its own
  password, and `ops/db/render-grants.mjs --rotate knet` prints the matching `ALTER USER`. Rotate the file and the
  account in the same job.
* **Keep `rate_limit_secret` set** (live scan: it is). If it were empty, the limiter key derives from the DB
  credentials, and the store, KNET and T-Pay would then count in different buckets because they use different
  accounts.
* **Write the secret files in place** (`cat new > file`), not by replace-and-rename: a file bind-mounted into a
  container keeps pointing at the old inode after a rename until the container restarts. Check from inside the
  container that PHP reads the new value before relying on it.
* New keys in code need safe defaults: the only new keys (`db_admin_*`, `db_cron_*`) are tier 2 and default to
  `db_user`/`db_pass`.

## 8. Account hygiene: the password story

| Question | Answer | Proof |
|---|---|---|
| Which authentication plugin? | **`mysql_native_password`** for every application account. PHP's PDO (mysqlnd) **cannot** sign in to an `ed25519` account (`[2054] ... unknown to the client [client_ed25519]`); the repo's own Node client (`db-url-scan.mjs`) speaks native only too. `unix_socket` does not apply (the database is in another container). `caching_sha2_password` is not offered by MariaDB. | measured; the suite goes red if PDO ever learns ed25519, as a prompt to revisit |
| Is native password weak? | Its stored hash is SHA-1 based, so a copy of `mysql.global_priv` could be attacked offline; the defence is the password itself: **40 random characters (about 240 bits)**, not a human's. The hash is only reachable by an account with SELECT on `mysql` (none of ours). | `render-grants.mjs` |
| Does the server ever see a password? | **No.** `CREATE USER ... IDENTIFIED BY 'plaintext'` is written verbatim into the server's general log and slow-query log (measured, both). `render-grants.mjs` sends `IDENTIFIED VIA mysql_native_password USING '*HASH'` (what `SHOW CREATE USER` prints), so no log, `processlist` or statement history holds a password; the suite turns the general log on, applies and rotates, and searches it. The password policy plugins only look at plaintext, so length and character classes are enforced in the renderer instead. | suite (plus a mutation: the same log does hold a plaintext statement) |
| Where does a password live? | The `0600` file in the secrets directory (host only) and the config value the app reads (`db_pass`, `mysql_pass`). A `.prev` file is left by `--rotate`: delete it once the new value is confirmed live. | |
| Empty passwords? | None can exist: the renderer refuses anything under 32 characters or missing a class; `audit-accounts.sql` flags `empty_password` (also when the account has a second method such as `unix_socket` beside the empty one) and `weak_password` (the stored hash is the hash of the user name or of `root`, `password`, `admin`, ...; compared inside the server, nothing printed); with `simple_password_check` the server refuses plaintext empties too (1819). | suite (detector mutations included) |
| `root` over the network? | `root@%` should go (`drop-root-remote.sql`), leaving `root@localhost` (reach it with `docker exec`). Not done automatically: a job that connects as root over the network would break. | suite |
| Password policy plugins in 11.8 | `simple_password_check` (min length, digits, mixed case, symbol; set to 24) and `password_reuse_check` (365 days) are in the image's plugin directory on the build machine's 10.11; confirm on 11.8 with `audit-accounts.sql` (`NOT INSTALLED` = present). `INSTALL SONAME` persists; the variables do not: put them in the config file (`sporta-db-hardening.cnf` lane). If the `.so` is missing, do not force it. History starts when the plugin is installed. | suite (ALTER USER refuses with 1396, CREATE USER with 1819; reuse refused after two rotations) |
| Locked unused accounts | every account is created `ACCOUNT LOCK` and unlocked by name only. Tier-2 accounts stay locked until used. Error 4151 on a try. | suite |
| Lock after N bad passwords (`max_password_errors`) | **declined**: it is server-wide and counts any client, so a stranger on the docker network could lock the shop out; the port is not published and the accounts are 240-bit. | reasoned |
| Connection caps | per account, see section 2 | suite (error 1226 on the cap + 1) |
| TLS between app and database | **not recommended now**: the traffic never leaves the private docker network, and PDO needs a CA path configured to verify. Revisit if the database ever moves off the host. | owner decision |
| Rotating a password | `render-grants.mjs --rotate knet` (new password file, previous kept as `.prev`, `ALTER USER`), then write the new value into the config and verify. | suite |

## 9. What is proven, and what only the live server can say

**Proven on a private MariaDB 10.11.14 + PHP 8.3** by `npm run test:db-least-privilege` (rig-free): the
derivation, the effective grants of all 8 accounts read back from `information_schema`, 30 to 40 forbidden
actions refused per account, the real flows (storefront, cash/KNET/T-Pay checkout with a fake bank and a fake
CBK, a full admin session, host cron, SEO, preflight) on `sporta_web`/`sporta_knet`/`sporta_tpay` with **zero
access-denied in the server's audit log and the PHP error log**, the tier-2 split with the patch applied to a staged copy,
`mariadb-dump` and `db-url-scan` on `sporta_ro`, every migration on `sporta_migrate`, and mutation checks
(over-granting, under-granting, the code gaining a write, a blinded extractor, a blinded audit, an unrendered file).

**Only the live server can confirm:**
1. MariaDB **11.8** behaviour. Every variable and statement used exists there, but this run was 10.11. Run step 4 on 11.8.
2. The old account's real grants, whether `root@%` is used by anything, the docker subnet, how root authenticates
   inside the container, `max_connections`, and the plugin `.so` files.
3. That the live schema carries every column `grants.sql` names (it fails loudly if not).
4. That the connector accepts the job's compose file.
5. Real KNET/T-Pay callbacks from the banks (the suite signs its own with the resource key / a fake gateway).
6. `INSTALL SONAME` twice (hygiene.sql is run twice by the suite on 10.11; confirm on 11.8), the exact shape of
   `mysql.global_priv.Priv` (`plugin`, `authentication_string`, `account_locked`, `access` for a role) that
   `audit-accounts.sql` reads, `PASSWORD`-style hashing in `SHA1(UNHEX(SHA1(x)))`, and that `ALTER TABLE ... DISCARD
   TABLESPACE` still needs only ALTER (the README keeps `sporta_migrate` locked either way).
7. Apache's `MaxRequestWorkers`: if the storefront can have more than 100 concurrent PHP requests, raise
   `sporta_web`'s cap (and re-check the sum).
8. Anything else on the VPS that connects to the database with the old account or root (backups, scans, n8n).
   After the switch `db-url-scan.mjs --config /run/sporta-api-config.php` runs as `sporta_web` and no longer sees
   the old-build tables: give scans `sporta_ro` (`DB_USER`/`DB_PASSWORD_FILE`).

## 10. Findings for the people who own the PHP (nothing was edited)

* `store_font_library()` runs `insert ignore into settings` the first time the public `theme` route is asked, so the
  storefront account needs `INSERT` on `settings` only for that. Seed the `font_library` row in a migration and the
  grant can go.
* `store_tracking_event()` and friends tolerate a *missing table* (error 1146) so new code can run ahead of its
  migration. They do not tolerate a *missing grant* (1142). From now on a PHP change that touches a new table or
  column also needs `npm run db:grants` and a re-apply; the suite fails until `grants.sql` matches.
* The gateway callbacks `require_once` `api/store.php` at run time to queue the warehouse message, a path the
  tokenizer cannot see; `make-grants.mjs` names it (`GATEWAY_FILES`) so the gateway accounts get the INSERT on
  `fulfilment_outbox` and the SELECTs that message is built from. Move that function into a small file of its own
  and the gateway accounts could lose `products`/`order_items`.
* **`sporta_ro` reads everything**, including `admin_users` (password hashes, TOTP secrets), customers and their
  addresses, phones and the location line in order notes: it has to, a backup that misses a table is no backup. It is
  a host/job credential for the dump and the scans; it is not a "report" account. If scans or reports will run
  often, ask for a second, narrower account (catalogue tables only) rather than handing them this one.
* **`sporta_migrate` can INSERT into `admin_users`** (that is what `setup-admin.php` does) and ALTER anything: a
  stolen copy can create an admin sign-in or damage tables. Hence LOCKED by default and unlocked per job.
* Only `setup-admin.php` ever inserts into `admin_users`. It is denied by `.htaccess`; if it is ever run, run it as
  `sporta_migrate`.

## 11. Owner decisions

1. Tier 1 now (config only), tier 2 with the next backend release (needs the patch)?
2. OK to lock `sporta_app@%` after a quiet week, and drop it later?
3. OK to drop `root@%` once the connections table shows nothing uses it?
4. Where the `sporta_ro` and `sporta_migrate` password files live: host-only, root-owned, never in the web container.
5. Install the password-policy plugins (needs the `.so` in the 11.8 image and the variables in the config file)?
6. Connection caps as listed, or different numbers?
7. `sporta_migrate` kept locked and unlocked per job (recommended), or always on?
8. A second, narrower read-only account for scans and reports (not built; say if you want it)?

## 12. Running the proof

```
cd sporta-web
npm run test:db-least-privilege     # rig-free; its own MariaDB (port from 33440) and PHP; KEEP=1 keeps the temp dir
npm run db:grants                   # regenerate ops/db/grants.sql after a PHP change
node ops/db/make-grants.mjs --check # exit 1 when grants.sql is stale
```

## 13. Independent review (what it changed)

Everything above was attacked by a second pair of eyes with its own MariaDB, PHP and tools. Found and fixed in this
directory (each has a test and a mutation in the suite):

| Finding | Fix |
|---|---|
| Re-applying `grants.sql` to live accounts gave them "access denied" for 0.3 to 1 s (the old text said "a few milliseconds"); a failed `GRANT` would leave an emptied account | one block per account; `--additive` and `--only`; honest numbers; routine re-apply is additive |
| `CREATE USER ... IDENTIFIED BY 'plaintext'` lands in the general log and slow log | the renderer sends the hash only |
| `sporta_migrate` "cannot delete the shop" was false: ALTER alone drops columns and discards tablespaces | claims corrected, account locked by default, `--lock`/`--unlock` |
| `render-grants.mjs` accepted `0.0.0.0/0.0.0.0`, `1%`, `1.%.%.%` | host patterns restricted to four shapes |
| `audit-accounts.sql` said nothing about: `0.0.0.0/0.0.0.0`, `%%`, `_%`; an empty password beside `unix_socket`; a role holding ALL granted to an account; a password equal to the user name or `root`; a database named `%`; and showed roles as accounts | new flags and sections, blinded one by one in the suite |
| `verify-accounts.mjs` probed GRANT with a GRANT: against an account that wrongly has GRANT OPTION **and** CREATE USER, on a server without `NO_AUTO_CREATE_USER`, it would create a passwordless account | probes with a REVOKE from an absent account instead (low severity: the account it meets is already a disaster) |
| `php-roles.patch` alone made `test:config-rules` fail (new keys had no manifest entry or example line) | patch completed, second patch added, compared in the suite |

Re-derived independently: 254 distinct statements `PREPARE`d as each account on the server (no privilege refusal);
a regex over the flattened source found the same write verbs and tables; no dynamic dispatch the extractor cannot
follow. Left as documented limits, not fixed: table-wide UPDATE on `orders` (admin.php builds the SET list at run
time), `sporta_shop` may INSERT discounts (review rewards) and UPDATE `orders.amount` of any order (order creation
sets it after the insert).
