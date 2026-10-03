<?php
// READ-ONLY: every active product's name and description in both languages, one JSON line each,
// so new descriptions can be drafted against what is really there (2026-10-03). No customer data.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
$db = store_db();
$colour = [];
try { foreach ($db->query('select * from product_attrs') as $r) $colour[$r['slug']] = $r; } catch (Throwable $e) {}
foreach ($db->query('select slug, category, price, name_en, name_ar, desc_en, desc_ar from products where active = 1 order by slug') as $r) {
    $c = $colour[$r['slug']] ?? null;
    if ($c) $r['attrs'] = array_diff_key($c, ['slug' => 1, 'id' => 1, 'created_at' => 1, 'updated_at' => 1]);
    echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
