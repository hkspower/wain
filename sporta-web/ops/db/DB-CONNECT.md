# How the PHP talks to the database: review and patch (`ops/db`, lane D3)

**Status: reviewed by reading every `new PDO(` and every error path, and measured before/after on a private MariaDB and PHP.
The patch is NOT applied** (`store.php` and the gateways belong to the release gate). Files: `db-connect.patch`,
`db-connect-after-roles.patch`, regenerated from the current tree by `node ops/db/make-connect-patch.mjs` (it refuses, naming the
pattern, when a file has moved). Proof: `npm run test:db-connect` (42 checks, before/after pairs, 4 of them mutation checks).

## 1. What was found (each row was measured on the unpatched tree first)

| # | Finding | Evidence (unpatched) | Fixed by |
|---|---|---|---|
| 1 | **A hung database holds an Apache worker for a minute.** `store_db()` sets no connect timeout; `ATTR_TIMEOUT` (where it exists: SEO, assistant) covers only the TCP connect. A server that accepts and never speaks is bounded only by PHP's 60 s socket timeout. | a listener that accepts and stays silent: the unpatched `store_db()` was still waiting after 12 s (and 59 s in a direct test with `ATTR_TIMEOUT = 3`) | `ATTR_TIMEOUT 5` plus `mysqlnd.net_read_timeout = statement limit + 10 s` |
| 2 | **No statement time limit.** One slow or crafted query (a missing index, a cross join) runs until the client gives up. | `select sleep(5)` runs 5.1 s with `max_statement_time = 0` | `SET SESSION max_statement_time`: 15 s storefront, 20 s payment scripts, 30 s `/backends`, 120 s batch jobs (MySQL: `max_execution_time`) |
| 3 | **`exec()` accepts stacked statements.** `query()` and `prepare()` are already single-statement because the store sets `EMULATE_PREPARES = false` (measured: error 1064). `exec()` is not: it sends the string as it is. | `exec('select 1; drop table zz_victim')`: ran, the table was gone. The code has `exec()` in five places in `php-store`; two build SQL from variables (`cron-fulfilment.php`, `cron-whatsapp.php`: `where id in ($ids)`, ids read from the database as integers). Not exploitable today; one future concatenation away from it. | `PDO::MYSQL_ATTR_MULTI_STATEMENTS = false` (after: error 1064, the table survives) |
| 4 | **A stranger is told which credential is wrong.** On a failed connection every public route answered `{"error":"db_unreachable","cause":"db_user or db_pass"}`. The cause exists so the owner can fix `config.php`, not to help someone attack it. | measured on `api.php`-context | the cause is sent only to `admin.php`, `admin-google.php`, `preflight.php`; the public answer is `db_unreachable` |
| 5 | **An uncaught database error leaves no trace.** `set_exception_handler` returns a bare JSON token and logs nothing (a handler replaces PHP's own logging). A 500 on the checkout was undiagnosable. | a missing table answered `no_table` with an empty error log | one line: class, SQLSTATE, driver code (`PDOException sqlstate=42S02 code=1146`): never the message, table, column, SQL or value |
| 6 | **Payment logs hold database messages.** `knet_log(... 'error' => $e->getMessage())` and the T-Pay equivalents write the exception message when a write fails; for a PDO exception that is SQL text and, for a duplicate key, the duplicate value. The files are `0600` above the web root, so this is exposure to whoever reads the log, not to the web. | a duplicate `track_id` exception message contains the value; the summary does not | `sporta_error_text($e)`: application exceptions keep their own message, database ones become the summary |
| 7 | **TLS is not used and nothing forces it for a remote host.** Right on a private Docker network (lane D1 decided so); wrong the day `db_host` is an address or a name with a dot. | the DSN carries no SSL option anywhere | `db_tls = auto` (default): a **local** host (localhost, loopback, a socket, a one-label service name such as `mariadb`) stays clear text; a **remote** host (any dotted name or address literal, so also a LAN or datacenter IP) with no `db_ssl_ca` is **refused** before any connection is attempted; `db_tls = require` forces TLS and verifies the certificate; `db_tls = off` is the only way back and is a deliberate act. After connecting the code proves TLS with `Ssl_cipher`, so an ignored option cannot become a silent clear-text link. Gateways: `mysql_tls`, `mysql_ssl_ca`. |
| 8 | **`LOAD DATA LOCAL`** is not enabled by any code. | PHP 8.3's client already refuses it (error 2068) | made explicit (`MYSQL_ATTR_LOCAL_INFILE = false`), so a later PHP default cannot change it |
| 9 | **Character set.** The DSN says `charset=utf8mb4`: measured `character_set_connection = utf8mb4`. The connection **collation** is the server's default for the charset (`utf8mb4_general_ci` on 10.11, `utf8mb4_uca1400_ai_ci` on 11.8); the tables are `utf8mb4_unicode_ci`. | `column = @variable` fails with error 1267 when the two differ (found while building the privacy SQL; parameters are unaffected) | no PHP change; the privacy files cast their variables. Any hand-written SQL a person runs through the client has the same trap |
| 10 | **`sql_mode`.** The app sets none; the server default on 10.11 is `STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`. | measured | not changed here: `ONLY_FULL_GROUP_BY` is lane D2's owner decision 5 |
| 11 | **Result sizes of public endpoints.** 52 `SELECT`s without `LIMIT` are reachable from the public and staff entry files. | listed by `scripts/lib/php-sql-map.php` over `api.php store.php customer.php returns.php support.php seo-page.php sitemap-products.php birthday.php assistant.php` | **no change needed:** none takes a client-controlled `LIMIT` or `OFFSET`; the ones that return many rows return the *catalogue* (`products`, `stock`, `slides`, `sitemap`, auto discounts: sized by what the owner enters) and every row-per-person lookup is by a unique key. `sql_select_limit` was rejected on purpose: it truncates silently, and a catalogue or a stock feed cut at N rows is a worse failure than a big answer. The statement limit (finding 2) bounds the time. Revisit when the catalogue passes a few thousand products (the Q1 lane's measurements). |

Not changed: `preflight.php` and `php-knet/setup-config.php` (diagnostic pages, locked or deleted after set-up, which must report connection errors); `ERRMODE_EXCEPTION`
and `EMULATE_PREPARES = false` were already set everywhere that matters. Every `catch` that returns `$e->getMessage()` to a client was checked (`api.php` returns and support, `admin.php` returns, CRM): each catches `InvalidArgumentException` and answers one of a fixed set of tokens
(`order_not_found`, `contact_exists`, ...). A `PDOException` is a `RuntimeException`, not an `InvalidArgumentException`, so it never reaches them: it goes to the global handler, which answers `failed` or `no_table`.
The two `str_contains($e->getMessage(), 'Duplicate')` checks (`admin.php`) rethrow everything else.

## 2. What the patch changes

* `config-path.php` (the file all three PHP trees already share): `sporta_db_options()`, `sporta_db_after_connect()`, `sporta_db_statement_seconds()`, `sporta_db_tls_options()`,
  `sporta_db_host_is_local()`, `sporta_db_error_summary()`, `sporta_error_text()`. One implementation.
* `store.php`: `store_db()` uses them; the catch logs the summary; `cause` is staff-only; the exception handler logs the summary.
* `seo-runtime.php`, `assistant.php` (`assistant_db_or_null`): the same options (they already had a 3-second connect timeout and keep it).
* `php-knet/knet.php`, `php-cbk/cbk.php`: the same options **when the resolver is present** (`function_exists`), and the old options otherwise (the standalone drop-in stays supported). They keep
  `FETCH_BOTH` (measured: the gateways rely on it; the store uses `FETCH_ASSOC`).
* `php-knet/{pay,callback}.php`, `php-cbk/{pay,callback}.php`: the payment-log `error` field uses `sporta_error_text()`.

New config keys (all optional, every one has a safe default in code, per CLAUDE.md): `db_tls`, `db_ssl_ca`, `db_ssl_verify`, and `mysql_tls`, `mysql_ssl_ca`, `mysql_ssl_verify` for the gateways.

## 3. Applying it

* **Order with lane D1's `php-roles.patch`:** both edit `store_db()`. Apply `php-roles.patch` first and then `db-connect-after-roles.patch`; with the roles patch absent use `db-connect.patch`.
  (The other order fails with "1 out of 1 hunk FAILED": tested.) Regenerate with `npm run db:connect-patch` if either file has moved.
* Needs no database change and no config change; with no new key the behaviour differs from today only by the items above.
* After applying: `npm run test:native`, `test:knet`, `test:tpay`, `test:knet-via-cbk` (the gate's suites; this lane could not run them: they use the shared rig), then a normal read-only crawl on the live site.
* **Statement limits are a behaviour change on the order path:** a `SELECT ... FOR UPDATE` that waits on a lock is aborted at 15 s with error 1969 instead of waiting up to `innodb_lock_wait_timeout` (50 s). That is the intent; watch the Activity log and the error log
  for `Sporta uncaught PDOException sqlstate=70100 code=1969` in the first week and raise the storefront number in `sporta_db_statement_seconds()` if a real order ever hits it.

## 3b. How this fits the other database patches (read before applying any of them)

* **Lane D1 `php-roles.patch`**: apply it first, then `db-connect-after-roles.patch` (tested). The roles patch decides *which account*; this one decides *how it connects*.
* **Lane P1 `db-pooling.patch` (persistent connections, off by default)**: it rewrites the same five `new PDO(` sites into calls of `sporta_db_connect($role, $dsn, $user, $pass, $options, $cfg)`. **The two patches conflict textually**
  (`git apply --check` fails on `store.php`, `seo-runtime.php`, `assistant.php`, `knet.php`, `cbk.php` in either order, shown while writing this) and they must not be applied together as they stand. The seam is already there: P1's function receives
  `$options`; the composition is to build them with `sporta_db_options($cfg, $prefix, $siteOptions)` **inside** `sporta_db_connect()` (prefix `mysql_` for the roles `knet` and `tpay`, `db_` for the others) and to call
  `sporta_db_after_connect()` on the non-pooled path only. Do **not** call it on a pooled handle: its `SET SESSION` is exactly the kind of statement P1's guard treats as dirty and discards the connection for. For a pooled connection
  the limit should come from the account instead (next bullet). This composition is a small patch on top of whichever is applied first; it was not built here because the release gate decides the order, and the exact-match guards in
  `make-connect-patch.mjs` will refuse (naming the file) rather than guess when the tree already carries P1's edit.
* **A statement limit on the account needs no PHP at all** (MariaDB only): `ALTER USER 'sporta_web'@'<host>' WITH MAX_STATEMENT_TIME 15;` (and `120` for the cron account, `30` for admin, `20` for the gateways).
  Tested: on the unpatched tree a `select sleep(5)` is aborted with error 1969 at 2 s by an account created `WITH MAX_STATEMENT_TIME 2`. It survives persistent connections and cannot be skipped by a code path that forgets to call a helper. Lane D1's `grants.sql`
  is the natural place; this lane did not edit it. It does not exist on MySQL (the old shared hosting): there the `SET SESSION max_execution_time` fallback in `sporta_db_after_connect()` applies.

## 4. Owner decisions

1. Apply the patch with the next backend release, and decide the order against lane D1's roles patch and lane P1's pooling patch (section 3b: the pooling patch conflicts and needs a merge).
2. TLS between the shop and the database: the patch makes it **required for a remote host and unchanged for the container network**. Turning it on for the container network too needs a server certificate and a CA file
   mounted into both containers, plus `db_tls = require`; lane D2's `require_secure_transport` stays OFF until then (it would refuse every PHP connection that does not use TLS).
3. The statement limits (15/20/30/120 s).

## 5. Proven here, and what only the live server can say

Proven by `npm run test:db-connect`: every row of section 1 as a before/after pair, `php -l` on the ten changed files, the patch applying in both orders (and the wrong order failing), gateway connections keeping `FETCH_BOTH`,
identical answers from six public routes before and after, and four mutations (stacked statements left on, no statement limit, no TLS refusal, the cause given to everyone).

Only the live server can confirm: MariaDB 11.8 (the build machine runs 10.11: `max_statement_time` exists in both), PHP 8.4 (the build machine runs 8.3: `PDO::MYSQL_ATTR_*` constants are guarded with `defined()`; they are deprecated in 8.5),
the real latency cost of the one extra `SET SESSION` per connection (one round trip on a local socket), and that no live code path depends on a statement running longer than its limit (the first week of the Activity log).
