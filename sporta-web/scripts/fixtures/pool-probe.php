<?php
// TEST-ONLY. scripts/db-pool-test.mjs copies this file into the STAGED copy of the backend as
// api/pool-probe.php, knet/pool-probe.php and pay/pool-probe.php. It is never part of the package.
//
// It opens its connection exactly the way each production entry point does (store_db(), knet_pdo(),
// cbk_pdo(), sporta_seo_db()), so what it shows is what a real request would get. Actions, by ?act=:
//   info                    one JSON object describing the SESSION the request was handed
//   dirty&what=a,b,...      leave state behind on purpose, then end the request (some mid-transaction, with exit)
//   sleep&ms=N              hold the connection for N milliseconds
//   txn_hold&tag=T          begin, insert a marker row, wait for a flag file, insert again, commit (a restart goes in between)
//   lock_exit               take a GET_LOCK and exit without releasing it (what a fatal error does)
// &raw=1 sends the dirtying statements around the guard (through PDO::exec itself), to show what the
// reset does when the statement guard does not see them.
declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store');
$dir = basename(__DIR__);
$act = (string)($_GET['act'] ?? 'info');
$via = (string)($_GET['via'] ?? '');

try {
    if ($dir === 'api') {
        require __DIR__ . '/store.php';
        if ($via === 'seo') {
            require_once __DIR__ . '/seo-runtime.php';
            $db = sporta_seo_db();
            if ($db === null) { echo json_encode(['error' => 'seo_db_null']); exit; }
        } else {
            $db = store_db();
        }
    } elseif ($dir === 'knet') {
        require __DIR__ . '/knet.php';
        $cfg = knet_with_store_db(knet_load_config(__DIR__ . '/config.php'));
        $db = knet_pdo($cfg);
    } else {
        require __DIR__ . '/cbk.php';
        $cfg = cbk_with_store_db(cbk_load_config(__DIR__ . '/config.php'));
        $db = cbk_pdo($cfg);
    }
} catch (Throwable $e) {
    echo json_encode(['error' => 'connect', 'class' => get_class($e), 'code' => $e instanceof PDOException ? ($e->errorInfo[1] ?? null) : null]);
    exit;
}

// Statements sent around the statement guard: PDO::exec itself, not the pooled subclass's override.
$raw = isset($_GET['raw']);
$run = static function (PDO $db, string $sql) use ($raw): void {
    if ($raw) (new ReflectionMethod('PDO', 'exec'))->invoke($db, $sql);
    else $db->exec($sql);
};

function probe_info(PDO $db): array
{
    $r = $db->query("select connection_id() as cid, user() as usr, database() as db, @@sql_mode as sql_mode, @@time_zone as tz,
                            @@character_set_client as cs, @@collation_connection as coll, @@max_statement_time as mst,
                            @@autocommit as ac, @@in_transaction as tx, @@innodb_lock_wait_timeout as lwt,
                            @leak as leak, (is_used_lock('leak-lock') = connection_id()) as lock_held,
                            (select count(*) from information_schema.session_variables where variable_name = 'SQL_SELECT_LIMIT' and variable_value <> '18446744073709551615') as limit_changed")->fetch(PDO::FETCH_ASSOC);
    // the isolation level was renamed (tx_isolation -> transaction_isolation) between MariaDB releases
    foreach (['transaction_isolation', 'tx_isolation'] as $v) {
        try { $r['iso'] = $db->query("select @@{$v}")->fetchColumn(); break; } catch (Throwable $e) { $r['iso'] = null; }
    }
    try { $db->query('select 1 from leak_tmp')->fetchAll(); $r['temp'] = 1; } catch (Throwable $e) { $r['temp'] = 0; }
    $r['marker_rows'] = (int)$db->query('select count(*) from pool_marker')->fetchColumn();
    $r['pid'] = getmypid();
    $r['class'] = get_class($db);
    $r['pdo_in_txn'] = $db->inTransaction();
    $r['pool'] = method_exists($db, 'poolInfo') ? $db->poolInfo() : null;
    return $r;
}

if ($act === 'settings' && $dir === 'api') {
    // the config parser, asked directly: ?role=knet&cfg={"db_persistent":true,"db_persistent_slots":{"knet":9}}
    $c = json_decode((string)($_GET['cfg'] ?? '{}'), true);
    echo json_encode(['settings' => sporta_db_pool_settings((string)($_GET['role'] ?? 'store'), is_array($c) ? $c : []), 'sapi' => PHP_SAPI,
                      'role_for_script' => sporta_db_role_for_script()]);
    exit;
}

if ($act === 'naked' && $dir === 'api') {
    // A persistent PDO WITHOUT the pool: what PHP itself carries from one request to the next. phase=a leaves state, phase=b reads it.
    $c = store_config();
    $n = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_PERSISTENT => 'naked']);
    if (($_GET['phase'] ?? 'a') === 'a') {
        $n->exec('start transaction');
        $n->exec("insert into pool_marker (tag) values ('naked')");
        $n->exec('set @naked = 1');
        $n->query("select get_lock('naked-lock', 0)")->fetchAll();
        $n->exec("set session sql_mode = 'ANSI'");
        $n->exec('create temporary table naked_tmp (a int)');
        echo json_encode(['cid' => (int)$n->query('select connection_id()')->fetchColumn()]);
    } else {
        $r = $n->query("select connection_id() as cid, @@in_transaction as tx, @naked as uservar, (is_used_lock('naked-lock') = connection_id()) as lock_held, @@sql_mode as sql_mode")->fetch(PDO::FETCH_ASSOC);
        try { $n->query('select 1 from naked_tmp')->fetchAll(); $r['temp'] = 1; } catch (Throwable $e) { $r['temp'] = 0; }
        echo json_encode($r);
        $n->exec('rollback'); // tidy: the connection is dropped by the suite afterwards
    }
    exit;
}

if ($act === 'info') {
    echo json_encode(probe_info($db));
    exit;
}

if ($act === 'sleep') {
    $ms = max(0, (int)($_GET['ms'] ?? 100));
    $db->query('select sleep(' . ($ms / 1000) . ')')->fetchAll();
    echo json_encode(['pid' => getmypid(), 'class' => get_class($db), 'pool' => method_exists($db, 'poolInfo') ? $db->poolInfo() : null]);
    exit;
}

if ($act === 'lock_exit') {
    $db->query("select get_lock('probe-lock', 0)")->fetchAll();
    echo json_encode(['pid' => getmypid(), 'locked' => true]);
    exit; // no release_lock: the pool must not hand this lock to the next request
}

if ($act === 'txn_hold') {
    $tag = preg_replace('/[^a-z0-9_]/i', '', (string)($_GET['tag'] ?? 'x'));
    $flagDir = (string)($_GET['dir'] ?? sys_get_temp_dir());
    $attempts = 0;
    try {
        $db->beginTransaction();
        $db->exec("insert into pool_marker (tag) values ('{$tag}-1')"); $attempts++;
        file_put_contents($flagDir . "/{$tag}.started", (string)getmypid());
        $deadline = microtime(true) + 40;
        while (!is_file($flagDir . "/{$tag}.go") && microtime(true) < $deadline) usleep(50000);
        $db->exec("insert into pool_marker (tag) values ('{$tag}-2')"); $attempts++;   // the statement that meets the restart
        $db->commit();
        echo json_encode(['ok' => true, 'attempts' => $attempts]);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'attempts' => $attempts, 'class' => get_class($e), 'code' => $e instanceof PDOException ? ($e->errorInfo[1] ?? null) : null]);
    }
    exit;
}

if ($act === 'dirty') {
    $what = array_filter(explode(',', (string)($_GET['what'] ?? '')));
    $done = [];
    foreach ($what as $w) {
        switch ($w) {
            case 'lock':       $db->query("select get_lock('leak-lock', 0)")->fetchAll(); break;
            case 'txn':        if (!$db->inTransaction()) $db->beginTransaction(); $db->exec("insert into pool_marker (tag) values ('leak-txn')"); break;
            case 'rawtxn':     $run($db, 'start transaction'); $db->exec("insert into pool_marker (tag) values ('leak-rawtxn')"); break;
            case 'sqlmode':    $run($db, "set session sql_mode='ANSI'"); break;
            case 'uservar':    $run($db, 'set @leak = 42'); break;
            case 'uservar_sel': $db->query('select @leak := 43')->fetchAll(); break;
            case 'temp':       $run($db, 'create temporary table leak_tmp (a int)'); break;
            case 'tz':         $run($db, "set time_zone = '+09:00'"); break;
            case 'names':      $run($db, 'set names latin1'); break;
            case 'usedb':      $run($db, 'use information_schema'); break;
            case 'prepare':    $run($db, "prepare leak_stmt from 'select 1'"); break;
            case 'isolation':  $run($db, 'set session transaction isolation level serializable'); break;
            case 'limit':      $run($db, 'set session sql_select_limit = 3'); break;
            case 'lockwait':   $run($db, 'set session innodb_lock_wait_timeout = 1'); break;
            case 'autocommit': $run($db, 'set autocommit = 0'); break;
            case 'mst':        $run($db, 'set session max_statement_time = 0.01'); break;
            case 'abort':
                // a statement the server aborts: the transaction it ran in stays open
                if (!$db->inTransaction()) $db->beginTransaction();
                $db->exec("insert into pool_marker (id, tag) values (1, 'abort-a')");
                try { $db->exec("insert into pool_marker (id, tag) values (1, 'abort-b')"); } catch (PDOException $e) { $done[] = 'abort:' . ($e->errorInfo[1] ?? ''); }
                break;
            case 'timeout':
                $run($db, 'set session max_statement_time = 0.05');
                try { $db->query('select sleep(1)')->fetchAll(); } catch (PDOException $e) { $done[] = 'timeout:' . ($e->errorInfo[1] ?? ''); }
                break;
            case 'pending':
                $st = $db->prepare('select * from products union all select * from products', [PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => false]);
                $st->execute(); $st->fetch(); // one row read, the rest left on the wire
                $GLOBALS['probe_keep'] = $st;
                break;
            default: $done[] = 'unknown:' . $w;
        }
        $done[] = $w;
    }
    if (isset($_GET['abandon']) && method_exists($db, 'poolInfo')) {
        // Pretend the end-of-request cleanup never happened (a fatal in a destructor, a process stopped half way):
        // the NEXT request must still find a clean session, by the reset at the start of its own turn.
        $p = new ReflectionProperty($db, 'poolEnded');
        $p->setValue($db, true);
    }
    echo json_encode(['done' => $done, 'pid' => getmypid(), 'class' => get_class($db),
                      'conn' => method_exists($db, 'poolInfo') ? $db->poolInfo()['conn_id'] : (int)$db->query('select connection_id()')->fetchColumn(),
                      'dispose' => method_exists($db, 'poolInfo') ? $db->poolInfo()['dispose'] : null]);
    exit; // the request ends here: transaction open, locks held, whatever was left
}

echo json_encode(['error' => 'unknown_act']);
