<?php
// TEST-ONLY. Run by scripts/db-pool-test.mjs under the PHP CLI:  php pool-unit.php <path to db-pool.php>
// Unit checks for the parts of db-pool.php that need no database: the retry rules, the error
// classification, the role split, and the CLI gate. One JSON line per check: {"n": name, "ok": bool, "d": detail}.
declare(strict_types=1);

require $argv[1];

function t(string $n, bool $ok, string $d = ''): void
{
    echo json_encode(['n' => $n, 'ok' => $ok, 'd' => $d]), "\n";
}

function pdoErr(int $code, string $msg = 'x'): PDOException
{
    $e = new PDOException($msg);
    $e->errorInfo = ['HY000', $code, $msg];
    return $e;
}

// A pooled connection that follows a script, without a database. It extends PDO only to satisfy the return
// type; its constructor never calls the parent, so no driver is touched.
class FakePooled extends PDO
{
    public array $plan;
    public static array $log = [];
    public function __construct(array $plan) { $this->plan = $plan; }
    public function poolAcquire(int $slots, string $prefix, string $dbname): void
    {
        self::$log[] = 'acquire';
        $step = array_shift($this->plan);
        if ($step instanceof Throwable) throw $step;
    }
    public function poolKill(): void { self::$log[] = 'kill'; }
    public function poolEnd(): void {}
}
class FakePlain extends PDO { public function __construct() {} }

/** @param array<int, FakePooled|Throwable> $makes what each call of $make does */
function run(array $makes): array
{
    FakePooled::$log = [];
    $made = 0; $plain = 0; $got = null; $thrown = null;
    $make = function () use (&$made, $makes) {
        $step = $makes[$made++] ?? null;
        if ($step instanceof Throwable) throw $step;
        return $step;
    };
    $plainFn = function () use (&$plain) { $plain++; return new FakePlain(); };
    try {
        $got = sporta_db_pool_open($make, $plainFn, ['role' => 'store', 'slots' => 3], 'sporta:pool:x:store:', 'db');
    } catch (Throwable $e) {
        $thrown = $e;
    }
    return ['made' => $made, 'plain' => $plain, 'got' => $got, 'thrown' => $thrown, 'log' => implode(',', FakePooled::$log)];
}

// ------------------------------------------------------------- the retry rules
$a = new FakePooled([]);
$r = run([$a]);
t('a healthy pooled connection is handed over after one attempt', $r['made'] === 1 && $r['got'] === $a && $r['plain'] === 0, $r['log']);

$a = new FakePooled([pdoErr(2006, 'MySQL server has gone away')]); $b = new FakePooled([]);
$r = run([$a, $b]);
t('a handle dead when first used (2006) earns exactly one new attempt', $r['made'] === 2 && $r['got'] === $b && $r['plain'] === 0, $r['log']);
t('and the dead one is killed so PHP drops it', $r['log'] === 'acquire,kill,acquire', $r['log']);

$a = new FakePooled([pdoErr(2013, 'Lost connection')]); $b = new FakePooled([pdoErr(2013, 'Lost connection')]);
$r = run([$a, $b]);
t('two dead handles in a row end in an ORDINARY connection, not a loop', $r['made'] === 2 && $r['plain'] === 1 && $r['got'] instanceof FakePlain, $r['log']);

$a = new FakePooled([pdoErr(1927, 'Connection was killed')]); $b = new FakePooled([]);
$r = run([$a, $b]);
t('a connection killed while it idled (1927) is retried once too', $r['made'] === 2 && $r['got'] === $b, $r['log']);

$a = new FakePooled([pdoErr(1193, 'Unknown system variable')]);
$r = run([$a, new FakePooled([])]);
t('a bookkeeping error the pool cannot explain (1193) is NOT retried: the request runs unpooled', $r['made'] === 1 && $r['plain'] === 1, $r['log']);

$a = new FakePooled([new RuntimeException('pool statement returned no row')]);
$r = run([$a, new FakePooled([])]);
t('a non-PDO failure inside the pool also falls back to an ordinary connection', $r['made'] === 1 && $r['plain'] === 1);

$r = run([pdoErr(1045, 'Access denied'), new FakePooled([])]);
t('a wrong password is the caller\'s to report: rethrown, no retry, no fallback', $r['made'] === 1 && $r['plain'] === 0 && $r['thrown'] instanceof PDOException && ($r['thrown']->errorInfo[1] ?? 0) === 1045);

$r = run([pdoErr(2002, 'Connection refused'), new FakePooled([])]);
t('a database that is down (2002) is rethrown at once, never retried', $r['made'] === 1 && $r['thrown'] instanceof PDOException);

$b = new FakePooled([]);
$r = run([pdoErr(2006, 'MySQL server has gone away'), $b]);
t('PHP failing to even open a dead handle (2006 from the constructor) earns one new attempt', $r['made'] === 2 && $r['got'] === $b);

$r = run([pdoErr(2006, 'gone'), pdoErr(2002, 'refused')]);
t('and if the second attempt cannot connect, that error is what the caller sees', $r['made'] === 2 && $r['thrown'] instanceof PDOException && ($r['thrown']->errorInfo[1] ?? 0) === 2002);

$a = new FakePooled([new SportaPoolRecycle('database changed')]); $b = new FakePooled([]);
$r = run([$a, $b]);
t('a handle the pool refuses to reuse (recycled) is replaced once', $r['made'] === 2 && $r['got'] === $b);

$a = new FakePooled([new SportaPoolRecycle('x')]); $b = new FakePooled([new SportaPoolRecycle('x')]);
$r = run([$a, $b]);
t('two recycles in a row end in an ordinary connection', $r['made'] === 2 && $r['plain'] === 1);

// ------------------------------------------------------------- what counts as "the connection is gone"
foreach ([2006, 2013, 2055, 1927, 1053] as $code) t("error $code is a lost connection", sporta_db_lost(pdoErr($code)));
foreach ([1045, 1049, 2002, 1062, 1213, 1205, 1146] as $code) t("error $code is NOT a lost connection (it must never be retried)", !sporta_db_lost(pdoErr($code)));
t('a message-only PDOException saying the server has gone away counts', sporta_db_lost(new PDOException('SQLSTATE[HY000]: General error: 2006 MySQL server has gone away')));
t('a non-PDO exception never counts', !sporta_db_lost(new RuntimeException('MySQL server has gone away')));

// ------------------------------------------------------------- roles
foreach (['admin.php' => 'admin', 'admin-google.php' => 'admin', 'preflight.php' => 'admin', 'cron-stock.php' => 'cron', 'cron-fulfilment.php' => 'cron',
          'api.php' => 'store', 'customer.php' => 'store', 'seo-page.php' => 'store', 'pool-probe.php' => 'store'] as $script => $role) {
    $_SERVER['SCRIPT_FILENAME'] = "/var/www/html/api/$script";
    t("$script belongs to the $role role", sporta_db_role_for_script() === $role, sporta_db_role_for_script());
}

// ------------------------------------------------------------- the CLI never pools
t('the CLI SAPI is what this runs under', PHP_SAPI === 'cli', PHP_SAPI);
t('so db_persistent=true pools nothing under the CLI (cron jobs are processes that live a second)',
    sporta_db_pool_settings('store', ['db_persistent' => true]) === null && sporta_db_pool_settings('cron', ['db_persistent' => 'all']) === null);
$plain = sporta_db_connect('store', 'sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION], ['db_persistent' => true]);
t('sporta_db_connect under the CLI returns a plain PDO, not the pooled subclass', get_class($plain) === 'PDO');
t('an unknown role is never pooled', sporta_db_pool_settings('nobody', ['db_persistent' => true]) === null);
