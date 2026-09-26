<?php
/**
 * Does the LIVE database actually have every column the CURRENT code expects?
 *
 *   wget -qO s.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-schema-completeness.php && php s.php
 *
 * READ-ONLY. information_schema reads and SELECTs only; nothing here writes.
 * Prints no secret — it reads api/config.php for the connection only.
 *
 * WHY THIS EXISTS, SEPARATE FROM live-scan.php. That script counts rows and
 * checks pages; it does not ask whether the SCHEMA itself is complete. A
 * column the code reads or writes that is missing on the live database is a
 * different failure from a wrong count — it is a query that 500s the moment
 * it runs, and nothing short of asking information_schema directly would
 * catch it before a real request does.
 *
 * EVERYTHING IS WRAPPED IN try/catch AND ECHOES THE MESSAGE. The first
 * version of this script had no catch at all: an uncaught PDOException on
 * shared hosting with display_errors off is a FATAL ERROR WITH NO OUTPUT —
 * indistinguishable from an overrunning job, and it cost two wasted cron
 * cycles finding that out. Never again: echo something, always, even on the
 * failure path.
 */

header('Content-Type: text/plain');
echo "start\n";

try {
    $ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
    $cfg = @include $ROOT . '/api/config.php';
    if (!is_array($cfg)) {
        echo "FAIL config.php did not return an array\n";
        exit;
    }
    echo 'config-keys=' . implode(',', array_keys($cfg)) . "\n";

    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
    );
    echo "connected\n";

    $checks = [
        'orders'            => ['customer_id'],
        'customers'         => ['id', 'email', 'phone', 'password_hash', 'last_seen_at'],
        'assistant_qa'      => ['id'],
        'hero_slides'       => ['image', 'image_w', 'image_h', 'focal_x', 'focal_y'],
        'settings'          => ['name', 'value'],
        'blocked_customers' => ['phone', 'scope', 'reason'],
        'return_requests'   => ['ref', 'order_id', 'kind', 'status', 'phone'],
    ];

    $missing = [];
    $present = 0;
    foreach ($checks as $table => $cols) {
        $tExists = $pdo->query('show tables like ' . $pdo->quote($table))->rowCount() > 0;
        if (!$tExists) {
            $missing[] = "$table (table itself)";
            continue;
        }
        $have = array_column($pdo->query("show columns from `$table`")->fetchAll(PDO::FETCH_ASSOC), 'Field');
        foreach ($cols as $c) {
            if (in_array($c, $have, true)) {
                $present++;
            } else {
                $missing[] = "$table.$c";
            }
        }
    }

    $heroMobileCols = $pdo->query("show columns from hero_slides like 'image_mobile%'")->rowCount();

    $paidNoTimestamp = (int) $pdo->query(
        "select count(*) from orders where payment_status = 'paid' and paid_at is null"
    )->fetchColumn();

    // product_variants links to products by SLUG, not a product_id column —
    // there is no such column. Checked against 1-schema.mysql.sql after this
    // assumption threw an exception the first time; never repeat a guessed
    // column name without checking the schema that actually defines it.
    $orphanVariants = (int) $pdo->query(
        'select count(*) from product_variants v where not exists (select 1 from products p where p.slug = v.slug)'
    )->fetchColumn();

    echo 'SCHEMA checked=' . array_sum(array_map('count', $checks)) . ' present=' . $present
        . ' missing=' . count($missing) . (count($missing) ? ' [' . implode(', ', $missing) . ']' : '')
        . "\n";
    echo 'HERO-MOBILE-LIVE=' . $heroMobileCols . ' (expected 0 -- schema change not yet applied live)' . "\n";
    echo 'paidNoTimestamp=' . $paidNoTimestamp . ' orphanVariants=' . $orphanVariants . "\n";
} catch (Throwable $e) {
    echo 'EXCEPTION ' . get_class($e) . ': ' . $e->getMessage() . "\n";
}
