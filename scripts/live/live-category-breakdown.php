<?php
/**
 * What category values the live catalogue actually uses, and how many
 * active products (with at least one uploaded photo) sit in each.
 *
 * READ-ONLY. One SELECT, nothing written.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-category-breakdown.php && php r.php
 *
 * WHY THIS EXISTS. Before building category landing pages keyed on
 * category = 'men'/'women'/'accessories'/'outlet' (the app's four tiles),
 * this asks whether the live catalogue's `category` column actually holds
 * only those four values — schema.mysql.sql's own comments mention products
 * filed under 'outerwear' as distinct from 'women', so assuming the app's
 * four-tile set is the whole catalogue could ship a page that silently
 * misses real, active products.
 */

header('Content-Type: text/plain; charset=utf-8');
$cfg = __DIR__ . '/../../sporta-site/public_html/api/config.php';
if (!is_file($cfg)) $cfg = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfg)) { echo "config.php not found\n"; exit; }
$c = require $cfg;
if (!is_array($c)) { echo "config.php did not return an array\n"; exit; }

try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $rows = $db->query(
        "select p.category, count(*) as n,
                sum(case when pi.slug is not null then 1 else 0 end) as withPhoto
           from products p
           left join (select distinct slug from product_images) pi on pi.slug = p.slug
          where p.active = 1
          group by p.category
          order by n desc"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        echo sprintf("%-14s n=%-3d withPhoto=%d\n", $row['category'], (int) $row['n'], (int) $row['withPhoto']);
    }
} catch (Throwable $e) {
    echo 'database error: ' . $e->getMessage() . "\n";
}
