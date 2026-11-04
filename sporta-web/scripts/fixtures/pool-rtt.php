<?php
// TEST-ONLY. Run by scripts/db-pool-rtt.mjs:  php pool-rtt.php <path to db-pool.php> <port> <user> <password> <database> <iterations>
// Times one "request's worth" of database work three ways, interleaved so the machine's noise lands on all three:
//   plain   connect, one statement, close (what every request does today)
//   pooled  persistent handle + the pool's start-of-request statement + one statement (what db_persistent does)
//   bare    persistent handle + one statement, NO reset (the unsafe floor, for comparison only)
// Prints one JSON object with the median, 90th percentile and mean of each, in milliseconds.
declare(strict_types=1);
[, $lib, $port, $user, $pass, $db, $n] = $argv;
require $lib;
$dsn = "mysql:host=127.0.0.1;port=$port;dbname=$db;charset=utf8mb4";
$o = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
$prefix = 'sporta:pool:rtt:store:';
$fns = [
    'plain' => function () use ($dsn, $user, $pass, $o) { $c = new PDO($dsn, $user, $pass, $o); $c->query('select 1')->fetchAll(); $c = null; },
    'pooled' => function () use ($dsn, $user, $pass, $o, $prefix, $db) {
        $p = new SportaPooledPDO($dsn, $user, $pass, [PDO::ATTR_PERSISTENT => 'sporta-store'] + $o);
        $p->poolAcquire(20, $prefix, $db); $p->query('select 1')->fetchAll(); $p->poolEnd();
    },
    'bare' => function () use ($dsn, $user, $pass, $o) { $c = new PDO($dsn, $user, $pass, [PDO::ATTR_PERSISTENT => 'bare'] + $o); $c->query('select 1')->fetchAll(); },
];
foreach ($fns as $f) $f(); // warm: the persistent handles exist before the first measured turn
$ts = array_fill_keys(array_keys($fns), []);
for ($i = 0; $i < (int)$n; $i++) {
    $order = array_keys($fns);
    if ($i % 2) $order = array_reverse($order);
    foreach ($order as $k) { $t = hrtime(true); $fns[$k](); $ts[$k][] = (hrtime(true) - $t) / 1e6; }
}
$out = [];
foreach ($ts as $k => $a) { sort($a); $c = count($a); $out[$k] = ['median' => round($a[intdiv($c, 2)], 3), 'p90' => round($a[(int)($c * 0.9)], 3), 'mean' => round(array_sum($a) / $c, 3)]; }
echo json_encode($out), "\n";
