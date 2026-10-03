<?php
// READ-ONLY: what the product cards could show — each active product's colour setting (product_attrs)
// and its sizes with in/out of stock, as counts and keys only (no stock numbers). 2026-10-03.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html';
require (is_dir($live) ? $live : __DIR__ . '/../../sporta-site/public_html') . '/api/store.php';
$db = store_db();
$attrs = [];
try { foreach ($db->query('select slug, colour from product_attrs') as $r) $attrs[$r['slug']] = $r['colour']; } catch (Throwable $e) { echo "ATTRS table=missing\n"; }
$sizes = [];
foreach ($db->query('select slug, size, stock > 0 s from product_variants order by slug') as $r) $sizes[$r['slug']][] = $r['size'] . ($r['s'] ? '' : '-');
echo 'COLOUR_KEYS ' . json_encode(defined('STORE_COLOURS') ? array_keys(STORE_COLOURS) : 'no STORE_COLOURS const') . "\n";
foreach ($db->query('select slug, name_en, category from products where active = 1 order by slug') as $p) {
    echo $p['slug'] . ' | ' . $p['category'] . ' | colour=' . ($attrs[$p['slug']] ?? 'NONE') . ' | sizes=' . implode(',', $sizes[$p['slug']] ?? []) . "\n";
}
