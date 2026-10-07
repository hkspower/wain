<?php
/** READ-ONLY: every product with its sizes and stock. Writes nothing, prints no secret. */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$c = @include $ROOT . '/api/config.php';
if (!is_array($c)) { line('NO-CONFIG'); return; }
$db = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$v = [];
foreach ($db->query('select slug,size,stock,sku from product_variants order by slug,sku') as $r) $v[$r['slug']][] = $r['size'] . '=' . $r['stock'];
$n = 0;
foreach ($db->query('select slug,name_en,active,price,category from products order by slug') as $r) {
    $n++;
    line($r['slug'] . '|' . $r['name_en'] . '|a' . $r['active'] . '|' . $r['price'] . '|' . $r['category'] . '|' . implode(',', $v[$r['slug']] ?? []));
}
line("PRODUCTS $n");
