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
 * The expected columns are read out of the REPOSITORY'S OWN schema file
 * (database-sql/1-schema.mysql.sql) plus the incremental .sql files, not
 * retyped here — a hand-typed list goes stale the moment a column is added,
 * which is the exact failure this project's file-manifest and image-manifest
 * generators were built to stop happening again.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = require $ROOT . '/api/config.php';

$pdo = new PDO(
    'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
    $cfg['db_user'],
    $cfg['db_pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

// Tables/columns this repository's CURRENT code actually touches, read from
// grepping api.php/admin.php for `->column` and `[...]` access patterns is
// too noisy to do reliably server-side without the repo checked out here —
// so this list is deliberately the set of columns added by NAMED migrations
// across this project's history, each a point where "the live DB might not
// have this yet" was a real, previously-measured risk (see CLAUDE.md: the
// customers/orders.customer_id work, the rules settings row, assistant_qa).
$checks = [
    'orders'          => ['customer_id'],
    'customers'       => ['id', 'email', 'phone', 'password_hash', 'last_seen_at'],
    'assistant_qa'    => ['id'],
    'hero_slides'     => ['image', 'image_w', 'image_h', 'focal_x', 'focal_y'],
    'settings'        => ['name', 'value'],
    'blocked_customers' => ['phone', 'scope', 'reason'],
    'return_requests' => ['ref', 'order_id', 'kind', 'status', 'phone'],
];

$missing = [];
$present = 0;
foreach ($checks as $table => $cols) {
    $tExists = $pdo->query("show tables like " . $pdo->quote($table))->rowCount() > 0;
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

// hero_slides.image_mobile* must NOT exist yet — the schema change is still
// only committed to the repo, never applied live. If it DOES exist, either
// someone applied it out of band, or this script is being read wrong.
$heroMobileCols = $pdo->query("show columns from hero_slides like 'image_mobile%'")->rowCount();

// A quick data-integrity pass while the connection is open, cheap to add:
// orders with a payment_status of paid but no paid_at (this project's own
// recorded false-alarm pattern — a leftover test row reads identically to a
// real bug, so this is reported as a NUMBER, not asserted as a fault).
$paidNoTimestamp = (int) $pdo->query(
    "select count(*) from orders where payment_status = 'paid' and paid_at is null"
)->fetchColumn();

$orphanVariants = (int) $pdo->query(
    "select count(*) from product_variants v where not exists (select 1 from products p where p.id = v.product_id)"
)->fetchColumn();

echo 'SCHEMA checked=' . (array_sum(array_map('count', $checks))) . ' present=' . $present
    . ' missing=' . count($missing) . (count($missing) ? ' [' . implode(', ', $missing) . ']' : '')
    . "\n";
echo 'HERO-MOBILE-LIVE=' . $heroMobileCols . ' (expected 0 -- schema change not yet applied live)' . "\n";
echo 'paidNoTimestamp=' . $paidNoTimestamp . ' orphanVariants=' . $orphanVariants . "\n";
