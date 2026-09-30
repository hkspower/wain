<?php
/**
 * Give every variant row that sits at ZERO a starting stock of 10.
 *
 *   php /home/<user>/set-zero-stock.php
 *
 * ASKED FOR, AND THE NUMBER IS A JUDGEMENT. Nothing in this repository knows
 * what is on a shelf in Kuwait, so 10 is not a measurement — it is the
 * smallest figure that makes a product genuinely orderable and lets the
 * checkout be exercised end to end, while keeping the exposure small if the
 * real shelf turns out to be thinner. The owner corrects any of it in
 * /backends -> Stock, which reads and writes exactly these rows.
 *
 * ONLY ROWS AT ZERO. `where stock = 0` is the whole safety of this file: a
 * count already entered — by the owner, by the panel, by anything — is left
 * exactly as it is. It cannot overwrite real inventory, only fill a gap.
 *
 * SAFE BY CONSTRUCTION. Fetched over plain HTTP from a PUBLIC repository, so
 * the single statement below is checked against an exact pattern before it
 * runs: an UPDATE of product_variants.stock, guarded by `where stock = 0`, and
 * nothing else. No DELETE, no DROP, no unguarded UPDATE, no second table — and
 * the guard would refuse one if the SQL were edited. Running it twice is a
 * no-op, because after the first run there are no zeros left to match.
 */

$STMT = 'update product_variants set stock = 10 where stock = 0';

// The guard: this exact shape or nothing. Pinned to the table, the column and
// the WHERE, so a widened statement cannot slip through.
if (!preg_match('/^update product_variants set stock = \d{1,3} where stock = 0$/', $STMT)) {
    echo "STOCK refused: statement is not the guarded shape\n";
    exit;
}

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "STOCK config unreadable\n"; exit; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15]
    );
} catch (Throwable $e) { echo "STOCK db unreachable\n"; exit; }

$zerosBefore = (int) $pdo->query('select count(*) from product_variants where stock = 0')->fetchColumn();
$sumBefore   = (int) $pdo->query('select coalesce(sum(stock),0) from product_variants')->fetchColumn();

$changed = $pdo->exec($STMT);

$zerosAfter = (int) $pdo->query('select count(*) from product_variants where stock = 0')->fetchColumn();
$sumAfter   = (int) $pdo->query('select coalesce(sum(stock),0) from product_variants')->fetchColumn();
$nostock    = (int) $pdo->query(
    'select count(*) from products p where p.active = 1 and not exists' .
    ' (select 1 from product_variants v where v.slug = p.slug and v.stock > 0)'
)->fetchColumn();

echo 'STOCK filled=' . (int) $changed
   . ' zeros=' . $zerosBefore . '->' . $zerosAfter
   . ' totalUnits=' . $sumBefore . '->' . $sumAfter
   . ' productsWithNoSellableSize=' . $nostock
   . "\n";
