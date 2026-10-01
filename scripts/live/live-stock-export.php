<?php
/**
 * The live shop's stock list, printed so a spreadsheet can be made from it.
 *
 *   php /home/<user>/live-stock-export.php
 *
 * READ-ONLY: one SELECT. It prints sku, product name, size and stock — and NOT the
 * wholesale cost (cost_aed), the one commercially sensitive column in the schema. It is
 * fetched from a public repository by a cron job, so it must never write.
 *
 * One JSON object per line, because a product name can contain a comma and a CSV line
 * would then be ambiguous.
 */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "NOCONFIG\n"; exit(1); }
try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
    );
    $rows = $pdo->query(
        'select v.sku, coalesce(p.name_en, v.slug) as name, v.size, v.stock
           from product_variants v left join products p on p.slug = v.slug
          order by v.slug, v.sku'
    )->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) { echo 'DBERR ' . get_class($e) . "\n"; exit(1); }
foreach ($rows as $r) {
    echo json_encode([$r['sku'], $r['name'], $r['size'], (int) $r['stock']], JSON_UNESCAPED_UNICODE), "\n";
}
echo 'ROWS ' . count($rows) . "\n";
