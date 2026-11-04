# Database connection pooling for the PHP backend (`ops/db/POOLING.md`)

**Status: built and proven on a private MariaDB and a private Apache (mpm_prefork + mod_php). NOT applied, NOT
enabled, NOT deployed.** The change to the existing files is `ops/db/db-pooling.patch`; a new file,
`dropin/php-store/db-pool.php`, is loaded by nothing until that patch is applied (the same status as
`php-roles.patch`). It goes live only through the release gate and `scripts/vps-deploy.mjs`, and even then it does
nothing until the owner adds `db_persistent` to the store config.

## 1. Recommendation

**Leave persistent connections OFF.** What it buys on this stack is small and uncertain, what it costs is a reset
protocol that has to stay correct forever, and the part of the request that is slow is not the connection.

- CPU per request (PHP plus MariaDB): **unchanged**, median +0.7% over 24 route x concurrency cells (pooled cheaper
  in 11 of 24). Connections per request fall from 1 to about 0.04.
- Wall clock, on a machine whose CPUs were oversubscribed (load average 50 to 115 on 4 CPUs): pooled was faster in
  18 of 24 cells (median throughput +10%) and had a lower median latency in 21 of 24 (median -14%). That is a real
  direction (sign test, p < 0.001 for latency), but it is not saved work, it is fewer scheduling hops on a starved
  machine; p95 is mixed (-8%, -2%, +18%, -6% by concurrency). On a quiet VPS it is expected to be smaller.
- A pooled request still spends two round trips (PHP's own ping and the pool's one reset statement) where a new
  connection spends about 2.5, so even an infinitely distant database cannot make pooling save more than about half a
  round trip plus the server's connection CPU (section 3.3).
- The safe form is a lot of machinery for that (section 4). A bare `PDO::ATTR_PERSISTENT` would not be safe at all
  (section 4.3).

**What to do instead** (server side, section 6): measure the live server with `scripts/db-pool-probe.mjs`; consider
`thread_handling=pool-of-threads` only if the probe shows connection pressure (`Max_used_connections` near
`max_connections`, `Connection_errors_max_connections` above 0); do not add ProxySQL.

**If the owner wants it anyway,** section 8 has the exact steps to turn it on and off.

## 2. How a connection is opened today

Every request opens its own connection with `new PDO(...)` and the process ends it: `ERRMODE_EXCEPTION`,
`utf8mb4` in the DSN, real prepared statements (`ATTR_EMULATE_PREPARES => false`); the store also sets
`FETCH_ASSOC`, the gateways do not. Nothing sets `sql_mode`, the time zone, an init command or a statement timeout
(the server's globals decide). The live image is `php:8.4-apache`: mod_php under `mpm_prefork`, one PHP process per
Apache child, `MaxRequestWorkers` 150 by default. A persistent connection belongs to one such child.

Sites that open a connection (HEAD at the time of writing): `store.php` `store_db()` (the main one: api, admin, customer, crm,
the assistant's three calls, birthday, every `cron-*`), `seo-runtime.php` `sporta_seo_db()` (product pages and
sitemaps, 3 s connect timeout), `php-knet/knet.php` `knet_pdo()`, `php-cbk/cbk.php` `cbk_pdo()`, `assistant.php`
`assistant_db_or_null()` (the voice warmer, 3 s timeout), and the one-off `preflight.php`, `setup-admin.php`,
`knet/setup-config.php`. Which config keys they read: the store `db_host/db_name/db_user/db_pass`, the gateways
`mysql_*` or, when absent, the same four borrowed from the store config (`config-path.php`).

What would LEAK between requests on a persistent connection (the reason this needed care): the application uses
`beginTransaction`/`commit` in 13 files and `SELECT ... FOR UPDATE`, `GET_LOCK`/`RELEASE_LOCK` (COD lock and order
cooldown lock in `store.php`, `cron-fulfilment.php`, `cron-whatsapp.php`), `LAST_INSERT_ID`, and, in both gateway
callbacks, `set session innodb_lock_wait_timeout`. It never uses temporary tables, user variables, `LOCK TABLES`,
`USE`, server-side `PREPARE` or any other `SET` (the suite asserts all of that by reading the source). `store.php`
writes down the assumption pooling would break: "The connection is nonpersistent, so a fatal/exit also releases the
lock".

What is unknown and must be read on the live box: MariaDB's `max_connections` and `thread_handling` on the 11.8
container, Apache's actual `MaxRequestWorkers`, whether the image has opcache, and the round-trip time between the
`apache-sporta` and database containers. `scripts/db-pool-probe.mjs` reads the first, second and fourth from inside
the web container; run it there.

## 3. Measurements

### 3.1 How, and how far to trust it

`scripts/db-pool-bench.mjs` starts a private MariaDB 10.11.14 and a private Apache 2.4.58 with `mpm_prefork` and
the Ubuntu `mod_php` 8.3.6 (taken from the `.deb` into a cache directory, nothing installed), copies the patched
backend into it, and drives it with `scripts/lib/pool-load.mjs`: `c` workers in a closed loop over keep-alive
connections, every request from a different client address through the trusted-proxy header (the API throttles per
address), 6 s per cell after a warm-up at the same concurrency, Apache restarted before every cell so no cell inherits
another's children or handles, two repetitions per cell with the `off`/`on` order alternating. Routes: `products`,
`stock`, the server-rendered product page (`/product/<slug>`), `checkout_config`, `slides` (which carries the promo
bar; there is no separate promo route), and order submit (`POST ?r=order`, KNET, 20 statements and a transaction).

**The machine was not quiet.** It has 4 CPUs and the load average was between 50 and 115 for the whole run (other
workflows were running). Absolute numbers (6 to 42 requests a second, p50 from 60 ms to 6 s) are the scheduler's, not
the stack's. Only the paired off/on comparison inside the same minutes means anything, and CPU time per request (read
from `/proc` for the Apache tree and `mariadbd`) is the one figure that does not move with the load.

### 3.2 Connect-per-request against persistent connections, Apache prefork + mod_php, opcache off

Paired medians over the 24 route x concurrency cells (`on` against `off`, two repetitions each; negative latency and
CPU is better, positive throughput is better):

| concurrency | req/s | p50 latency | p95 latency | CPU per request | cells with lower p50 |
|---:|---:|---:|---:|---:|---:|
| 1 | +13.1% | -9.2% | -8.4% | +1.7% | 6 of 6 |
| 10 | +11.3% | -13.5% | -1.5% | -0.4% | 4 of 6 |
| 50 | -0.4% | -12.8% | +17.8% | +0.7% | 5 of 6 |
| 100 | +14.5% | -22.8% | -5.7% | +0.5% | 6 of 6 |
| **all 24 cells** | **+9.9%** (18 of 24 faster) | **-14.3%** (21 of 24 lower) | | **+0.7%** (11 of 24 cheaper) | |

Per cell (`db_persistent_slots` was 128 here so the cap never interfered; 150 children could all hold a slot):

| route | c | req/s off -> on | p50 ms off -> on | CPU ms/request (PHP + DB) off -> on | connections/request on | idle pooled left open |
|---|---:|---|---|---|---:|---:|
| products | 1 | 11.6 -> 12.4 | 74 -> 71 | 9.09 -> 8.63 (-5%) | 0.013 | 3 |
| products | 10 | 18.6 -> 18.9 | 539 -> 550 | 9.29 -> 8.76 (-6%) | 0.026 | 12 |
| products | 50 | 25.9 -> 26.7 | 1733 -> 1493 | 8.67 -> 8.74 (+1%) | 0.047 | 50 |
| products | 100 | 29.9 -> 35.2 | 2659 -> 2290 | 7.95 -> 8.14 (+3%) | 0.076 | 100 |
| stock | 1 | 12.2 -> 13.6 | 64 -> 63 | 8.52 -> 8.48 (-0%) | 0.013 | 3 |
| stock | 10 | 17.1 -> 22.5 | 580 -> 384 | 9.24 -> 8.91 (-4%) | 0.029 | 12 |
| stock | 50 | 31.0 -> 29.8 | 1264 -> 1021 | 7.69 -> 8.26 (+7%) | 0.054 | 50 |
| stock | 100 | 27.6 -> 24.5 | 3105 -> 2379 | 8.22 -> 7.78 (-5%) | 0.099 | 96 |
| product | 1 | 10.9 -> 11.9 | 83 -> 70 | 8.50 -> 9.59 (+13%) | 0.014 | 3 |
| product | 10 | 19.4 -> 22.9 | 479 -> 375 | 8.14 -> 7.62 (-6%) | 0.029 | 12 |
| product | 50 | 24.4 -> 28.5 | 1792 -> 1286 | 8.25 -> 6.97 (-16%) | 0.134 | 63 |
| product | 100 | 29.3 -> 22.1 | 2994 -> 2950 | 7.37 -> 7.77 (+5%) | 0.134 | 96 |
| checkout_config | 1 | 8.2 -> 9.3 | 104 -> 101 | 10.63 -> 12.32 (+16%) | 0.018 | 3 |
| checkout_config | 10 | 16.2 -> 19.5 | 598 -> 491 | 10.30 -> 11.17 (+8%) | 0.026 | 12 |
| checkout_config | 50 | 22.5 -> 23.5 | 1836 -> 1759 | 9.44 -> 10.51 (+11%) | 0.046 | 52 |
| checkout_config | 100 | 23.9 -> 28.8 | 3264 -> 2406 | 9.09 -> 9.27 (+2%) | 0.078 | 100 |
| slides | 1 | 10.6 -> 12.6 | 88 -> 64 | 9.02 -> 9.37 (+4%) | 0.013 | 3 |
| slides | 10 | 21.1 -> 15.9 | 451 -> 581 | 8.29 -> 8.98 (+8%) | 0.013 | 11 |
| slides | 50 | 34.2 -> 32.7 | 1075 -> 948 | 7.84 -> 7.88 (+1%) | 0.082 | 56 |
| slides | 100 | 28.6 -> 42.5 | 2654 -> 1809 | 7.92 -> 7.43 (-6%) | 0.088 | 100 |
| order | 1 | 6.6 -> 9.6 | 147 -> 81 | 15.97 -> 14.46 (-9%) | 0.017 | 3 |
| order | 10 | 12.2 -> 12.8 | 800 -> 727 | 15.84 -> 16.27 (+3%) | 0.036 | 12 |
| order | 50 | 15.2 -> 13.1 | 2648 -> 3138 | 15.68 -> 15.56 (-1%) | 0.230 | 62 |
| order | 100 | 16.8 -> 18.6 | 6159 -> 4789 | 15.95 -> 15.81 (-1%) | 0.130 | 100 |

Reading it:

- **CPU per request does not move** (median +0.7%, ranging from -16% to +16% by cell, which is the noise floor of a
  shared machine). The pool's extra statement (4.0 to 4.1 statements per request, 20.0 to 20.4 for an order) costs about
  what the connection setup it avoids costs.
- **Connections per request fall from 1.0 to between 0.01 and 0.23** (`order` at c=50 is the high one). `Aborted_connects`
  was 0 in every cell, and no cell had a failed request in either mode.
- **Latency and throughput are better in most cells** (p50 lower in 21 of 24, requests per second higher in 18 of
  24), by a tenth to a seventh at the median, in a way that CPU time does not explain. The most likely cause is
  scheduling: with every CPU contended, each new connection needs the server to create or wake a thread and run the
  handshake, and each of those is a chance to wait for a CPU. That is a property of this overloaded machine; it is not
  evidence about the VPS. p95 is mixed (+18% at c=50), so there is no tail benefit to claim.
- **After a run the pool leaves one idle connection per child that served a request** (3, 12, 50, 100 at c=1, 10, 50,
  100): this is the cost the slot cap exists to bound; with the default of 20 slots 80% of the children
  at c=100 would run on a discarded connection and see none of the gain.

### 3.3 Round trips: why a safe pool cannot save much

Opening a connection costs the TCP handshake (1 round trip), then the server's greeting and the client's
authentication reply (1.5), and the first statement is the 1 after it: about 3.5. A pooled request spends PHP's
`COM_PING` (1, which pdo_mysql sends when it is handed a persistent handle), the
pool's one reset statement (1), and the query (1): 3. The reset cannot be dropped, because it is the whole safety
argument. So the best a safe pool can do is save half a round trip plus the server's connection CPU, at any distance.

`scripts/db-pool-rtt.mjs` puts a delaying forwarder in front of the database to count them (it terminates TCP locally,
so add one round trip to the plain column; Node timer jitter on a loaded machine is a millisecond or more, so read the
signs and sizes, not the decimals):

| one-way delay | round trip | plain (connect each request) | pooled (ping + reset + query) | bare persistent (unsafe) | pooled saves | = round trips |
|---:|---:|---:|---:|---:|---:|---:|
| 0 ms | 0 ms | 1.168 ms | 0.933 ms | 0.383 ms | 0.23 ms (20%) | n/a |
| 0.5 ms | 1 ms | 12.466 ms | 16.98 ms | 9.291 ms | -4.51 ms (-36%) | -4.5 |
| 1 ms | 2 ms | 12.076 ms | 12.899 ms | 8.371 ms | -0.82 ms (-7%) | -0.4 |
| 2 ms | 4 ms | 21.725 ms | 26.833 ms | 15.849 ms | -5.11 ms (-24%) | -1.3 |
| 4 ms | 8 ms | 40.606 ms | 42.679 ms | 31.271 ms | -2.07 ms (-5%) | -0.3 |

A bare persistent handle (no reset, not safe, not shipped) saves about a quarter. The pool does not beat
connect-per-request at 1 to 8 ms of round trip in this model (once the one TCP round trip the model leaves out is added
to the plain column the two are about even at 4 to 8 ms), and saves 0.2 ms (20% of a 1.2 ms operation) at zero distance. With the database on the same host
(Docker bridge: well under 1 ms) the gain is the server's connection CPU, which section 3.2 shows is lost in the noise.

### 3.4 With opcache on

Not measured: that run was stopped to give the final suite the machine. `node scripts/db-pool-bench.mjs --opcache` produces it (the live image may or may not have opcache; with it, PHP's CPU per request falls and the connection becomes a larger share of what is left).

## 4. What was built, and why it is shaped this way

### 4.1 One place that opens a connection

`dropin/php-store/db-pool.php` defines `sporta_db_connect($role, $dsn, $user, $pass, $options, $cfg)`. Five sites
open a PDO today; the patch routes all five through it:

| Site | File | Role | Notes |
|---|---|---|---|
| storefront, admin, customer, crm, assistant, cron doors | `store.php` `store_db()` | `store` / `admin` / `cron` by entry script (the split of `php-roles.patch`) | hot path |
| server-rendered pages, sitemaps | `seo-runtime.php` `sporta_seo_db()` | `store` | rides the store handle |
| KNET start and callback | `php-knet/knet.php` `knet_pdo()` | `knet` | reads `db_persistent` from the store's config |
| T-Pay start and callback | `php-cbk/cbk.php` `cbk_pdo()` | `cbk` | same |
| voice warmer (cron) | `assistant.php` `assistant_db_or_null()` | `cron` | CLI: never pooled |

`preflight.php`, `setup-admin.php` and `knet/setup-config.php` are one-off diagnostics and stay as they are.
With `db_persistent` absent or false the helper is `new PDO($dsn, $user, $pass, $options)` with the caller's
options untouched (the suite asserts the object is a plain `PDO` and that responses are byte-identical).

### 4.2 The reset protocol

A pooled connection is a `SportaPooledPDO` (a PDO subclass) with a persistent identity per role
(`PDO::ATTR_PERSISTENT => 'sporta-<role>'`: two roles never share a handle even on one account).

1. **Start of a request, one statement, one round trip.** `CONNECTION_ID(), DATABASE(), @sporta_pool_gen,
   @@in_transaction`, whether `sql_mode / time_zone / max_statement_time / autocommit` still equal the server's
   GLOBAL values, `RELEASE_ALL_LOCKS()`, and a non-blocking `GET_LOCK` of the connection's own slot. A new
   connection answers `@sporta_pool_gen IS NULL` and takes the first free slot instead.
2. **Repaired:** an open transaction (`ROLLBACK`), every `GET_LOCK` (`RELEASE_ALL_LOCKS`), the four settings
   (`SET SESSION ... = @@GLOBAL...`), the slot.
3. **Not repaired, discarded:** the statement guard sees every statement the application sends (`exec`, `query`,
   `prepare`). Reads, writes, `SHOW`, `EXPLAIN`, `COMMIT`, `ROLLBACK`, `START TRANSACTION` are allowed; any other
   statement (`SET`, `USE`, `CREATE`, `PREPARE`, `LOCK TABLES`, `HANDLER`, `FLUSH`, `CALL`, a leading comment ...)
   and any `@var :=` or `INTO @var` marks the connection, and it is `KILL`ed when the request ends. The next
   request gets a new connection (PHP pings the dead handle and reconnects).
4. **End of a request,** not the start of the next: destructor plus a shutdown function queued behind every other
   one (the COD lock release in `store.php` runs first). Open transaction: rollback. Any `GET_LOCK` seen:
   release all, take the slot back. A transaction left open by `exit()` must not hold row locks until another
   request happens to reach that child.
5. **The cap.** A connection keeps being pooled only while it holds a slot: one of N `GET_LOCK`s named
   `sporta:pool:<hash>:<role>:<i>`. The server counts them, so the cap is exact across every PHP process, race
   free, and a dying child frees its slot. A request that finds every slot taken works exactly as today (its
   connection is discarded at the end).
6. **Retry.** `sporta_db_pool_open()` makes at most two attempts, and only for a handle that was dead or
   discarded BEFORE the caller received it (2006, 2013, 2055, 1927, 1053). It never retries a connect failure
   (wrong password, database down: `store_db()` reports those), and a pool bookkeeping error it cannot explain
   turns pooling off for that request (logged) rather than failing it. After the connection is handed over
   there is no retry machinery: a PDO object cannot be re-pointed at another connection, so no statement can be
   replayed inside a transaction.

What the pool deliberately does NOT see: a user variable assigned around the statement guard (nothing in the
application does it; the suite prints it as `info`), and statements issued by a stored routine (none exist).

### 4.3 What a bare PDO persistent connection leaks here (measured, PHP 8.3.6, MariaDB 10.11)

| Left behind by request A | Request B on the same process, bare `ATTR_PERSISTENT` | With the pool |
|---|---|---|
| open transaction (even raw `START TRANSACTION`) | rolled back by PHP when the object is destroyed | rolled back (second line) |
| `GET_LOCK` | **still held** | released |
| `SET sql_mode` / `time_zone` / `NAMES` / isolation / `sql_select_limit` / `innodb_lock_wait_timeout` / `max_statement_time` / `autocommit` | **kept** | connection discarded (or, for the four settings the reset covers, repaired) |
| user variable | **kept** | connection discarded |
| temporary table | **kept** | connection discarded |
| `USE other_db`, server-side `PREPARE` | **kept** | connection discarded |

This is not hypothetical. Both gateway callbacks already contain
`set session innodb_lock_wait_timeout = least(@@session.innodb_lock_wait_timeout, 8)` on the money path; on a bare
persistent connection that 8-second cap would silently ride into every later request on that Apache child.


## 5. The arithmetic (why it is off, and what the cap guarantees)

Today a request holds one connection while it runs and none after. The number of open connections is the number of
requests in flight, at most the number of Apache children (`MaxRequestWorkers`, 150 in the stock `php:8.4-apache`
`mpm_prefork.conf`, which the live image is believed to use; unverified, the probe cannot see Apache).

| Limit | Value | Source |
|---|---|---|
| Apache children | 150 | official image default (unverified on the live box) |
| MariaDB `max_connections` | **unknown on the live 11.8 container** (151 default) / 200 in the unapplied `sporta-db-hardening.cnf` | `db-pool-probe.mjs` prints the live value |
| MariaDB `thread_handling` | **unknown on live** (`one-thread-per-connection` is the default) | probe |
| Per-account caps | web 100, shop 80, admin 20, cron 10, KNET 15, T-Pay 15 (`ops/db/grants.sql`); global default 60 in the unapplied cnf | `ops/db` |

A naive `PDO::ATTR_PERSISTENT` keeps one idle handle per child per identity forever: up to 150 children x 3 roles =
**450 handles** against a limit of 151 to 200, and 150 against KNET's cap of 15. The first busy hour would lock
the admin and the gateways out of their own database. That is why the shipped form is a slot pool:

- idle pooled connections <= sum of the slots = store 20 + admin 4 + cron 2 + KNET 4 + T-Pay 4 = **34**, however
  many children exist;
- open connections <= (connections in use by running requests, i.e. what happens today) + (idle pooled, <= 34);
- every role's pooled share is at most 27% of its account cap (KNET 4 of 15, store 20 of 80/100);
- `db_persistent_slots` is clamped to 1..128.

One thing the arithmetic shows that has nothing to do with pooling: `MaxRequestWorkers` 150 is larger than every
account cap in `grants.sql` (100, 80, 20, 15, 15). A burst of more than 100 simultaneous storefront requests is refused
by the database (error 1203 or 1040) and `store_db()` reports it as `db_unreachable`, with or without pooling. If
that matters, lower `MaxRequestWorkers` to about the web account's cap so the surplus queues in Apache instead of
failing at the database. That is an owner decision, not part of this lane.


## 6. Server-side pooling instead (what MariaDB offers, and what it does not)

MariaDB's own pool is `thread_handling=pool-of-threads`: connections are multiplexed over `thread_pool_size` groups
of worker threads instead of one OS thread per connection. It does not remove the cost of opening a connection (the
TCP handshake and the authentication still happen); it removes the thread creation and the thread-per-connection
scheduling, and it keeps a connection storm from turning into hundreds of runnable threads. It is a server setting,
needs no PHP change, and is the only pooling that cannot leak session state because it does not share sessions.

Settings, for `sporta-db-hardening.cnf` or the container's `--thread-handling` flags (Linux builds of MariaDB have it
built in; the 10.11 here does, the live 11.8 is expected to):

| Setting | Suggested | Why |
|---|---|---|
| `thread_handling` | `pool-of-threads` | only if the probe shows pressure (below) |
| `thread_pool_size` | number of vCPUs of the VPS (the default is the CPU count) | bounds runnable threads |
| `thread_pool_stall_limit` | leave at 500 ms | lets a long statement not starve short ones |
| `extra_port` + `extra_max_connections` | e.g. 3307 and 3, bound to the Docker network only | a back door for the admin account when the pool is saturated |
| `max_connections` | at least 2 x Apache children, e.g. 300 (cheap under a pool) | headroom for cron and jobs |
| `wait_timeout` | 600 (already in the cnf) | idle handles, pooled or not, do not live for 8 hours |
| `max_user_connections` / `MAX_USER_CONNECTIONS` | see the account table in section 5 | per-account caps stay |

Measured here (same off-mode benchmark, `thread_handling=one-thread-per-connection` against `pool-of-threads` with
`thread_pool_size=2` on a 4-CPU machine, two repetitions, adjacent in time):

| route | c | req/s default -> pool-of-threads | p50 ms | p95 ms | CPU ms/request |
|---|---:|---|---|---|---|
| checkout_config | 10 | 35.1 -> 16.6 | 225 -> 571 | 712 -> 1045 | 11.46 -> 12.39 |
| checkout_config | 50 | 61.7 -> 21.4 | 726 -> 2187 | 1686 -> 4881 | 10.58 -> 11.21 |
| checkout_config | 100 | 45.0 -> 19.8 | 1937 -> 3379 | 4446 -> 9373 | 9.49 -> 10.51 |
| products | 10 | 24.5 -> 34.0 | 381 -> 288 | 808 -> 685 | 12.41 -> 9.38 |
| products | 50 | 37.0 -> 33.2 | 1303 -> 1356 | 2639 -> 3137 | 10.07 -> 10.11 |
| products | 100 | 53.8 -> 45.4 | 1739 -> 1910 | 3690 -> 4211 | 9.09 -> 9.31 |

Reading it: **nothing here supports switching.** With two thread groups on four loaded CPUs `pool-of-threads` was
slower in 5 of 6 cells (it queues requests behind a small number of executing threads, which is its job under a
storm and a cost when there is no storm). The two runs were made one after the other on a machine whose load changed
between them (the default run's throughput is up to three times that of the 24-cell matrix above), so this is weak
evidence in both directions; what it does show is that the setting is not a free win and needs the probe's evidence
of connection pressure before anyone turns it on.

**When to apply it:** only if `db-pool-probe.mjs` on the live box shows `Max_used_connections` close to
`max_connections`, a non-zero `Connection_errors_max_connections`, or hundreds of `Threads_created`. With the shop's
traffic none of those is expected, and the default thread cache (`thread_cache_size` 151 to 256) already makes
`one-thread-per-connection` cheap, which is what the benchmark's `threads created` column shows (0 to 21 per cell).

**ProxySQL: no.** Reasons, in order of weight:

1. It would multiplex backend connections, and ProxySQL turns multiplexing OFF for a session that uses `GET_LOCK`, a
   user variable, a temporary table, an open transaction or most `SET` statements. The checkout (COD lock, cooldown
   lock, transactions) and both payment callbacks (`SET SESSION innodb_lock_wait_timeout`) do exactly that, so the
   paths that matter would be pinned to one backend connection per client anyway; what is left to pool is the
   read-only traffic, whose gain is the small figure measured above.
2. It is one more always-on service on the money path of a single-VPS shop, with its own credentials, monitoring and
   failure mode.
3. It terminates the client connection, so the database sees the proxy's address: the per-host account grants in
   `ops/db/grants.sql` (`@'172.18.0.%'`) and the `server_audit` CONNECT log would no longer say which container
   connected.
4. Its main benefit, absorbing connection storms from many PHP workers, is what the slot pool and a sensible
   `MaxRequestWorkers` already bound.

Apache side, independent of pooling: `MaxRequestWorkers` 150 is above every account cap (section 5). Lowering it to the
web account's cap (80 to 100) makes surplus requests wait in Apache instead of failing with `db_unreachable`.

## 7. Outbound HTTP (the gateway and AI calls)

Every outbound call in the backend opens its own cURL handle and drops it (`cbk_http()` in `cbk.php`, three
helpers in `assistant.php`, `admin-google.php`, `cron-whatsapp.php`). Reuse is possible only INSIDE one request:
under mod_php (and under PHP-FPM) a cURL handle, its TCP connection and its TLS session die with the request, and PHP
has no persistent cURL handle, so nothing can be pooled across requests. Putting a keep-alive forwarder in front of
the bank is a different project and is not recommended for a few dozen calls a day.

Inside a request, the only host called more than once is CBK: a T-Pay callback can make a token call and a
`GetTransaction` call, and a rare retry a second `GetTransaction` (`php-cbk/callback.php`, lines 136 and 182); `pay.php`
makes one call. Measured against a local TLS 1.2 server (RSA-2048, loopback, shared machine): a call on a new handle
costs a median 11.9 ms (handshake), a call on an already-connected handle 0.34 ms; a request with three calls
51.6 ms on three handles against 18.1 ms on one handle reused. On the real path to CBK the handshake is three round
trips (TCP, then two for TLS 1.2), so a second call on a reused handle would save about three round trips of the
distance to the bank: tens to a couple of hundred milliseconds, but only for the minority of callbacks that make two
calls. The AI path (one LLM or TTS call per message, to a different host each) has nothing to reuse. Not worth a change
on the money path now; if callbacks ever routinely make two calls, one shared handle with `curl_reset()` between
calls inside `cbk_http()` is the whole change.


## 8. Turning it on, and off

Only after the probe on the live box shows a saving worth having (section 3) and the owner agrees. Nothing here is
done by default.

**On**

1. The backend release must contain `db-pool.php` and the patch (`ops/db/db-pooling.patch`, or
   `db-pooling-after-roles.patch` when `php-roles.patch` has been applied first). Deploy with
   `scripts/vps-deploy.mjs --only api,knet,pay,.htaccess` after the release gate. Behaviour is unchanged at this point.
2. On the live database: `wait_timeout` of 600 or less (idle pooled handles die by themselves), `max_connections` at
   least 200, and the web account's `MAX_USER_CONNECTIONS` at least twice the slots you will use.
3. Edit the store config the way every other key in it is changed (it is root-owned `0440`, mounted at
   `/run/sporta-api-config.php`, so a one-shot job, not an editor): add
   `'db_persistent' => ['store'], 'db_persistent_slots' => ['store' => 8],`. Start with the store role only and a
   slot count near the number of requests normally in flight. KNET and T-Pay follow the store config unless their own
   config says otherwise; leave them out of the list while money paths are being watched.
4. Verify, in the web container: `node scripts/db-pool-probe.mjs --config /run/sporta-api-config.php` (connections
   now: at most 8 idle for the account); `Connections` per second should fall to a small fraction of requests per
   second; the PHP error log must contain no `this request runs unpooled`.
5. Watch for a day: `Threads_connected`, `Max_used_connections`, `Aborted_clients` (it rises by one for every
   connection the pool discards, see 4.2), p95 latency.

**Off**

1. Remove the key or set `'db_persistent' => false`. The next request opens a plain connection; nothing else changes.
2. Handles already open sit idle until `wait_timeout` closes them; to drop them at once run
   `docker exec apache-sporta-1 apache2ctl graceful` (children are replaced, their handles close).
3. To remove the code, `compose --rollback` the deploy that shipped the patch (`DEPLOY-AUTOMATION.md`).


## 9. Not done, and why

- **Nothing was enabled, applied or deployed.** `db-pool.php` is a new file that no entry point loads until the
  patch is applied; the patch is `ops/db/db-pooling.patch`, not applied (the same status as `php-roles.patch`).
- **The live runtime was not measured.** No access to the VPS from this session. `db-pool-probe.mjs` is the tool
  that reads `max_connections`, `thread_handling`, account caps and the real round trip, from inside the web container.
- **PHP 8.4 was not tested** (the live image); this ran on PHP 8.3.6 with the matching Ubuntu mod_php, MariaDB 10.11.14.
  The pool relies on no PHP internals except that a killed persistent handle is replaced on the next request (tested).
  `@@in_transaction` and `information_schema`-free statements are used so MariaDB 11.8 behaves the same, but 11.8
  itself was not available here.
- **`preflight.php`, `setup-admin.php`, `knet/setup-config.php`** are untouched (one-off diagnostics).
- **A user variable assigned around the statement guard is not detected** (nothing in the application assigns one).
- **Caching of `store_config()` / opcache** were not part of this lane.

## 10. Files, and how to run them

| File | What it is |
|---|---|
| `dropin/php-store/db-pool.php` | the helper (new, inert until the patch routes the sites through it) |
| `ops/db/db-pooling.patch` | the change to `store.php`, `seo-runtime.php`, `assistant.php`, `knet.php`, `cbk.php` and `api/.htaccess`; `patch -p1` from `sporta-web/` |
| `ops/db/db-pooling-after-roles.patch` | the same, for a tree where `php-roles.patch` has been applied first (one hunk of `store.php` differs) |
| `scripts/db-pool-test.mjs` (`npm run test:db-pool`) | the proof: leak tests, restart resilience, connection counts, the cap, real checkouts, Apache prefork, 14 mutants. Needs `php`, `mariadbd`, `mariadb`; Apache + mod_php is optional (without it the prefork section is skipped and says so) |
| `scripts/db-pool-bench.mjs` | the benchmark of section 3 (`--modes off,on`, `--c`, `--routes`, `--opcache`, `--db-args`) |
| `scripts/db-pool-probe.mjs` | READ-ONLY: server settings, account caps, connections now, and what opening a connection costs from where it runs; `--config /run/sporta-api-config.php` in the web container |
| `scripts/db-pool-rtt.mjs` | the round-trip model of section 3.3 |
| `scripts/lib/pool-rig.mjs`, `pool-load.mjs` | the private stack and the load generator |
| `scripts/fixtures/pool-probe.php`, `pool-unit.php`, `pool-rtt.php` | test-only; the probe endpoint is copied into the STAGED tree only |

The suite builds its own temporary directories, MariaDB (a port scanned upward from 33750) and web server, and removes
them on exit. It never uses the shared test rig, the database `sporta`, ports 8095-8100, 8188 or 4173, or `dist/`.
It tests a patched COPY of `dropin/` until the patch is applied, and says so; it also proves the patch applies to a
pristine copy of HEAD.
