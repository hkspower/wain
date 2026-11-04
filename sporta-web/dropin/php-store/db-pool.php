<?php
// One way to open a database connection, with OPT-IN persistent connections.
//
// Ships as /api/db-pool.php. The store (store.php), the SEO pages (seo-runtime.php), KNET (knet.php)
// and T-Pay (cbk.php) all open their PDO through sporta_db_connect() below, so there is exactly one
// place that decides how a connection is made, and one place to read when a connection misbehaves.
//
// THE DEFAULT IS TODAY'S BEHAVIOUR, EXACTLY. With `db_persistent` absent or false, sporta_db_connect()
// is `new PDO($dsn, $user, $pass, $options)` and nothing else: the same object class, the same options,
// one connection per request, closed when the request ends. Nothing in this file runs.
//
// WHY IT EXISTS, AND WHY IT IS OFF. Every request opens a TCP connection, authenticates, and tears it
// down. A pooled connection skips that. The price is the hard part: a connection that outlives the
// request carries the request's STATE with it, and the code was written for connections that do not.
// Measured on this stack (ops/db/POOLING.md): PDO persistent connections hand the next request an open
// transaction, held GET_LOCKs, a changed sql_mode, time zone and character set, user variables and
// temporary tables, untouched. store.php even says so ("The connection is nonpersistent, so a fatal/exit
// also releases the lock"). So pooling here is a RESET PROTOCOL first and a cache second:
//
//   1. A pooled connection is only ever reused if it can be PROVEN to be in the state a new one has.
//   2. What can be repaired cheaply is repaired: an open transaction is rolled back, every GET_LOCK is
//      released, sql_mode / time_zone / max_statement_time / autocommit are put back to the server's
//      GLOBAL values (what a new connection would get).
//   3. What cannot be repaired (a SET, USE, CREATE TEMPORARY TABLE, user variable, PREPARE, LOCK TABLES,
//      HANDLER, FLUSH, CALL ... anything not on the allow-list in SportaPooledPDO::poolSee) is not
//      repaired at all: the connection is KILLed and the next request gets a new one. The pool never
//      guesses.
//   4. The request that used the connection cleans up when it ENDS (destructor, plus a shutdown function
//      queued to run after every other one), not when the next request starts: an exit() in the middle
//      of a transaction must not hold row locks until another request happens to land on this child.
//
// A HARD CAP. Apache prefork (the live php:8.4-apache image: MaxRequestWorkers 150) keeps one persistent
// handle per child per identity, so "children x roles" connections could sit idle against a server limit
// of ~151-200 (and the per-account MAX_USER_CONNECTIONS in ops/db/grants.sql: 15 for KNET and T-Pay).
// A handle therefore only stays pooled if it holds a SLOT: one of N named GET_LOCKs per role
// (`sporta:pool:<hash>:<role>:<i>`, non-blocking). A lock belongs to its connection, so the count is
// exact across every PHP process, race-free, and self-healing (a child that dies frees its slot). A
// request that finds every slot taken still works: it simply behaves like today, one connection that is
// closed (KILLed) when the request ends. Defaults: store 20, admin 4, cron 2, knet 4, cbk 4 = 34 idle
// connections at most, however many children exist.
//
// WHAT IT NEVER DOES: retry a statement. The only retry is in sporta_db_pool_open(): one new attempt when a
// pooled handle turns out dead BEFORE the caller has been given the connection (the database restarted, or
// wait_timeout closed it while it idled). After the connection is handed over there is no retry machinery
// at all; a PDO object cannot be re-pointed at another connection, so a statement can never be replayed
// inside a transaction behind the application's back. A connection that dies mid-request fails loudly,
// exactly as it does today.
//
// CONFIG (all keys optional; /run/sporta-api-config.php is root-owned, so every key has a safe default):
//   db_persistent        false (default) | true (store, admin, knet, cbk; never cron) | 'all' | ['store','knet']
//   db_persistent_slots  integer for every role, or ['store' => 20, 'knet' => 4, ...]; 1..128
// KNET and T-Pay read the same two keys from the store's config when their own config does not name them.
// Never persistent under the CLI SAPI (cron jobs run `php cron-*.php`: a process that lives a second).
declare(strict_types=1);

const SPORTA_DB_POOL_ROLES = ['store', 'admin', 'cron', 'knet', 'cbk'];
const SPORTA_DB_POOL_DEFAULT_SLOTS = ['store' => 20, 'admin' => 4, 'cron' => 2, 'knet' => 4, 'cbk' => 4];
const SPORTA_DB_POOL_MAX_SLOTS = 128;
// 2006 gone away, 2013 lost during query, 2055 lost at handshake, 1927 connection was killed, 1053 shutdown
const SPORTA_DB_LOST_CODES = [2006, 2013, 2055, 1927, 1053];

// Which account family this request belongs to, by entry script (the same split as ops/db/php-roles.patch).
function sporta_db_role_for_script(): string
{
    $script = basename((string)($_SERVER['SCRIPT_FILENAME'] ?? ''));
    if (in_array($script, ['admin.php', 'admin-google.php', 'preflight.php'], true)) return 'admin';
    if (str_starts_with($script, 'cron-')) return 'cron';
    return 'store';
}

function sporta_db_lost(Throwable $e): bool
{
    if (!$e instanceof PDOException) return false;
    if (in_array((int)($e->errorInfo[1] ?? 0), SPORTA_DB_LOST_CODES, true)) return true;
    $m = $e->getMessage();
    return str_contains($m, 'server has gone away') || str_contains($m, 'Lost connection') || str_contains($m, 'Connection was killed');
}

// The store's own config, for the two pool keys, when a gateway's config does not carry them.
function sporta_db_pool_store_cfg(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = [];
        try {
            if (function_exists('sporta_config_path')) {
                $path = sporta_config_path('api', __DIR__ . '/config.php');
                if (is_file($path) && is_readable($path)) {
                    $c = require $path;
                    if (is_array($c)) $cfg = array_intersect_key($c, ['db_persistent' => 1, 'db_persistent_slots' => 1]);
                }
            }
        } catch (Throwable $e) {
            $cfg = []; // an unreadable store config means "not pooled", never an error
        }
    }
    return $cfg;
}

/** @return array{role:string,slots:int}|null null = not pooled */
function sporta_db_pool_settings(string $role, array $cfg): ?array
{
    if (!in_array($role, SPORTA_DB_POOL_ROLES, true)) return null;
    if (in_array(PHP_SAPI, ['cli', 'phpdbg'], true)) return null;
    $own = static fn(string $k) => array_key_exists($k, $cfg) ? $cfg[$k] : (sporta_db_pool_store_cfg()[$k] ?? null);
    $flag = $own('db_persistent');
    $on = match (true) {
        $flag === true => $role !== 'cron',
        $flag === 'all' => true,
        is_array($flag) => in_array($role, $flag, true),
        default => false,
    };
    if (!$on) return null;
    $want = $own('db_persistent_slots');
    $n = is_array($want) ? ($want[$role] ?? null) : $want;
    if (!is_int($n)) $n = SPORTA_DB_POOL_DEFAULT_SLOTS[$role];
    return ['role' => $role, 'slots' => max(1, min(SPORTA_DB_POOL_MAX_SLOTS, $n))];
}

/**
 * The only way the backend opens a database connection.
 *
 * @param string $role    'store' | 'admin' | 'cron' | 'knet' | 'cbk'. It is part of the persistent identity, so
 *                        two roles never share a handle even when they share an account.
 * @param array  $options the caller's PDO options, passed through UNCHANGED (the gateways deliberately do not
 *                        set a default fetch mode and the store does; that stays each caller's business).
 * @param array  $cfg     the caller's config, searched for db_persistent / db_persistent_slots.
 */
function sporta_db_connect(string $role, string $dsn, ?string $user, ?string $pass, array $options, array $cfg = []): PDO
{
    $pool = sporta_db_pool_settings($role, $cfg);
    if ($pool === null) return new PDO($dsn, $user, $pass, $options);
    $dbname = '';
    if (preg_match('/(?:^|;)dbname=([^;]*)/', $dsn, $m) === 1) $dbname = $m[1];
    return sporta_db_pool_open(
        static fn(): SportaPooledPDO => new SportaPooledPDO($dsn, $user, $pass, [PDO::ATTR_PERSISTENT => 'sporta-' . $role] + $options),
        static fn(): PDO => new PDO($dsn, $user, $pass, $options),
        $pool,
        'sporta:pool:' . substr(sha1($dsn . "\0" . (string)$user), 0, 10) . ':' . $role . ':',
        $dbname,
    );
}

/**
 * Open a pooled connection and prove it clean, or fall back to an ordinary one.
 *
 * `$make` builds the pooled object, `$plain` an ordinary connection. At most TWO attempts, and only for a
 * handle that was dead or dirty BEFORE the caller saw it. Anything else the pool cannot explain turns the pool
 * off for this request (logged), so pooling can make a request no worse than connect-per-request.
 */
function sporta_db_pool_open(callable $make, callable $plain, array $pool, string $prefix, string $dbname): PDO
{
    for ($try = 0; $try < 2; $try++) {
        try {
            $pdo = $make();
        } catch (PDOException $e) {
            // A failure to CONNECT (wrong password, database down, unknown database) is the caller's to report:
            // store_db() turns it into db_unreachable and names the likely config key. Only a handle that
            // died while idle earns the one new attempt.
            if ($try === 0 && sporta_db_lost($e)) continue;
            throw $e;
        }
        try {
            $pdo->poolAcquire($pool['slots'], $prefix, $dbname);
        } catch (SportaPoolRecycle $e) {
            continue; // dirty in a way the pool does not repair; poolAcquire has killed it. A new connection next.
        } catch (Throwable $e) {
            $pdo->poolKill();
            if ($try === 0 && sporta_db_lost($e)) continue; // dead before the caller had it: ONE more attempt
            // The pool could not do its bookkeeping on this server (an unknown system variable, no GET_LOCK ...).
            // Serve the request without it rather than fail the request.
            error_log('Sporta DB pool: ' . get_class($e) . ' ' . (string)($e instanceof PDOException ? ($e->errorInfo[1] ?? '') : '') . ', this request runs unpooled');
            return $plain();
        }
        // Queue the end-of-request cleanup to run AFTER every shutdown function the request registers later
        // (the COD / cooldown lock release in store.php): a function registered from inside a shutdown function
        // goes to the back of the queue. The destructor is the second line.
        register_shutdown_function(static function () use ($pdo): void {
            register_shutdown_function(static function () use ($pdo): void { $pdo->poolEnd(); });
        });
        return $pdo;
    }
    // Two attempts used and the second was dead or dirty as well: an ordinary connection, never a loop.
    return $plain();
}

/** Thrown inside poolAcquire when a pooled handle is dirty in a way the pool will not repair. */
final class SportaPoolRecycle extends RuntimeException {}

/**
 * A PDO that knows it may outlive its request. Constructed ONLY for pooled roles; a non-pooled connection
 * is a plain PDO and none of this exists.
 */
final class SportaPooledPDO extends PDO
{
    private int $poolConnId = 0;
    private int $poolSlot = 0;
    private int $poolSlots = 0;
    private string $poolPrefix = '';
    private bool $poolDispose = false;   // something happened that only a new connection undoes
    private bool $poolLocks = false;     // a GET_LOCK was issued: release at the end of the request
    private bool $poolTxn = false;       // a raw START TRANSACTION / BEGIN was issued (PDO's own flag does not see it)
    private bool $poolEnded = false;
    private bool $poolReused = false;

    /** @return array{conn_id:int,slot:int,slots:int,prefix:string,reused:bool,dispose:bool} */
    public function poolInfo(): array
    {
        return ['conn_id' => $this->poolConnId, 'slot' => $this->poolSlot, 'slots' => $this->poolSlots,
                'prefix' => $this->poolPrefix, 'reused' => $this->poolReused, 'dispose' => $this->poolDispose];
    }

    // ---------------------------------------------------------------- the statement guard
    // Every statement the application sends passes through here (exec, query, prepare), so the pool knows
    // what the request did to the SESSION without asking the server. The allow-list is deliberately short:
    // reads, writes, SHOW/EXPLAIN, COMMIT/ROLLBACK/START TRANSACTION. Anything else (SET, USE, CREATE, PREPARE,
    // LOCK TABLES, HANDLER, FLUSH, CALL, comments ...) marks the connection for disposal, and so does any
    // statement that assigns a user variable.
    private function poolSee(string $sql): void
    {
        $w = strtolower(substr(ltrim($sql), 0, 9));
        if (str_starts_with($w, 'select') || str_starts_with($w, 'insert') || str_starts_with($w, 'update')
            || str_starts_with($w, 'delete') || str_starts_with($w, 'replace') || str_starts_with($w, 'with ')) {
            if (str_contains($sql, '@') && preg_match('/@[A-Za-z_$][\w$.]*\s*:=|\binto\s+(?:@|outfile|dumpfile)/i', $sql) === 1) $this->poolDispose = true;
            if (stripos($sql, 'get_lock') !== false) $this->poolLocks = true;
            return;
        }
        if (str_starts_with($w, 'start tra') || str_starts_with($w, 'begin')) { $this->poolTxn = true; return; }
        if (str_starts_with($w, 'commit') || str_starts_with($w, 'rollback') || str_starts_with($w, 'show')
            || str_starts_with($w, 'explain') || str_starts_with($w, 'describe') || str_starts_with($w, 'desc ')) return;
        $this->poolDispose = true;
    }

    public function exec(string $statement): int|false
    {
        $this->poolSee($statement);
        return parent::exec($statement);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $this->poolSee($query);
        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->poolSee($query);
        return parent::prepare($query, $options);
    }

    // ---------------------------------------------------------------- the start of the request
    // ONE short statement, one round trip, on every pooled connection, new or reused. It answers: who am I
    // (CONNECTION_ID), where am I (DATABASE), have I been set up before (@sporta_pool_gen is NULL on a new
    // connection), am I inside a transaction, do my four settings still equal the server's, and, in the same
    // breath, it takes my slot back: RELEASE_ALL_LOCKS() first (the IF makes the order a data dependency, not a
    // matter of luck), then a non-blocking GET_LOCK of this connection's own slot. It is text-protocol SQL with no
    // input from anywhere. It is deliberately SHORT: the server parses it again on every request, and a first
    // version that carried the whole slot list cost as much CPU as opening a connection.
    private function poolAcquireSql(): string
    {
        $p = $this->poolPrefix;
        return 'SELECT CONNECTION_ID() AS cid, DATABASE() AS db, @sporta_pool_gen AS gen, @@in_transaction AS tx, '
            . '(@@sql_mode = @@GLOBAL.sql_mode AND @@time_zone = @@GLOBAL.time_zone '
            . 'AND @@max_statement_time = @@GLOBAL.max_statement_time AND @@autocommit = @@GLOBAL.autocommit) AS vars_ok, '
            . 'IF(@sporta_pool_gen IS NULL, 0, '
            . 'IF(IF(RELEASE_ALL_LOCKS() >= 0, COALESCE(@sporta_pool_slot, 0), 0) > 0, '
            . "IF(GET_LOCK(CONCAT('{$p}', @sporta_pool_slot), 0) = 1, @sporta_pool_slot, 0), 0)) AS slot";
    }

    // Take the first free slot: GET_LOCK of `<prefix>1`, `<prefix>2` ... in order, non-blocking, in one statement
    // (CASE evaluates lazily, so it stops at the first lock it gets). A lock belongs to its connection, so the
    // number of connections holding one is exact across every PHP process on every child, and a child that dies
    // frees its slot. Run for a NEW connection, and for a reused one that lost its slot between the release and
    // the re-take. The answer is stored in the SESSION (`@sporta_pool_slot`), so the next request that is handed
    // this handle knows what it holds; setting `@sporta_pool_gen` is what marks the connection as set up.
    private function poolTakeSlot(): int
    {
        $chain = 'CASE';
        for ($i = 1; $i <= $this->poolSlots; $i++) $chain .= " WHEN GET_LOCK('{$this->poolPrefix}{$i}',0)=1 THEN {$i}";
        $chain .= ' ELSE 0 END';
        return (int)$this->poolRow("SELECT @sporta_pool_slot := ({$chain}) AS slot, @sporta_pool_gen := 1 AS gen")['slot'];
    }

    // One round trip in the TEXT protocol: the statements of this class carry no input, so there is nothing
    // to bind, and a prepared statement would cost an extra round trip (prepare, execute). The caller's
    // emulate-prepares setting is put back whatever happens.
    private function poolRow(string $sql): array
    {
        $emulate = $this->getAttribute(PDO::ATTR_EMULATE_PREPARES);
        $this->setAttribute(PDO::ATTR_EMULATE_PREPARES, true);
        try {
            $st = parent::query($sql);
            $row = $st === false ? false : $st->fetch(PDO::FETCH_ASSOC);
            if (!is_array($row)) throw new RuntimeException('pool statement returned no row');
            return $row;
        } finally {
            $this->setAttribute(PDO::ATTR_EMULATE_PREPARES, $emulate);
        }
    }

    public function poolAcquire(int $slots, string $prefix, string $dbname): void
    {
        $this->poolSlots = $slots;
        $this->poolPrefix = $prefix;
        $r = $this->poolRow($this->poolAcquireSql());
        $this->poolConnId = (int)$r['cid'];
        if ($r['gen'] === null) {
            // A new connection: clean by definition. Take a slot (or learn that none is free).
            $this->poolSlot = $this->poolTakeSlot();
            if ($this->poolSlot === 0) $this->poolDispose = true; // every slot taken: behave like today
            return;
        }
        $this->poolReused = true;
        if ((string)$r['db'] !== $dbname) { $this->poolKill(); throw new SportaPoolRecycle('database changed'); }
        if ((int)$r['tx'] === 1) parent::exec('ROLLBACK');
        if ((int)$r['vars_ok'] !== 1) {
            parent::exec('SET SESSION sql_mode = @@GLOBAL.sql_mode, time_zone = @@GLOBAL.time_zone, '
                . 'max_statement_time = @@GLOBAL.max_statement_time, autocommit = @@GLOBAL.autocommit');
        }
        $this->poolSlot = (int)$r['slot'];
        if ($this->poolSlot === 0) {
            // Our slot was taken in the instant between the release and the re-take (or never held): any free one.
            $this->poolSlot = $this->poolTakeSlot();
            if ($this->poolSlot === 0) $this->poolDispose = true;
        }
    }

    // ---------------------------------------------------------------- the end of the request
    public function poolEnd(): void
    {
        if ($this->poolEnded) return;
        $this->poolEnded = true;
        try {
            if ($this->poolDispose) { $this->poolKill(); return; }
            // The pooled connection must not outlive the request's transaction or locks: row locks held by an
            // exit() inside a transaction would otherwise sit until another request reached this child.
            if ($this->inTransaction() || $this->poolTxn) parent::exec('ROLLBACK');
            if ($this->poolLocks) {
                $this->poolRow('SELECT RELEASE_ALL_LOCKS() AS r');
                // the slot is a lock too: take it back (it was ours a moment ago)
                if ($this->poolSlot > 0) $this->poolRow("SELECT GET_LOCK(CONCAT('{$this->poolPrefix}', {$this->poolSlot}), 0) AS g");
            }
        } catch (Throwable $e) {
            $this->poolKill(); // cleanup failed: the connection is in an unknown state, so it must not be reused
        }
    }

    // The only way to make PHP drop a persistent handle: have the server close it. PHP pings the handle the
    // next time it is asked for it, finds it dead, and connects afresh. KILL of one's own connection needs no
    // privilege; the server answers it with error 1927 on this very connection, which is expected.
    public function poolKill(): void
    {
        $this->poolEnded = true; // nothing more to clean on a connection that is going away
        if ($this->poolConnId <= 0) return;
        $id = $this->poolConnId;
        $this->poolConnId = 0;
        try { parent::exec('KILL ' . $id); } catch (Throwable $e) { /* 1927 Connection was killed */ }
    }

    public function __destruct()
    {
        $this->poolEnd();
    }
}
