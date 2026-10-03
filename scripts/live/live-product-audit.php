<?php
// READ-ONLY audit of every live product's details — 2026-10-03 ("check all product details").
// Writes nothing and prints no customer data: slugs, counts and the names of missing fields only.
// Run: wget -qO p.php <raw url @ full sha> && php p.php   (nothing after it; see CLAUDE.md)
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';   // the sandbox, for a dry run
$db = store_db();
$has = function (string $t) use ($db): bool {
    try { $db->query("select 1 from `$t` limit 1"); return true; } catch (Throwable $e) { return false; }
};
$rows = $db->query('select * from products order by active desc, slug')->fetchAll(PDO::FETCH_ASSOC);
$cols = $rows ? array_keys($rows[0]) : [];
echo 'PRODUCTS total=' . count($rows) . ' active=' . count(array_filter($rows, fn ($r) => (int) $r['active'] === 1))
   . ' cols=' . implode(',', $cols) . "\n"; flush();

$photos = $vars = $stock = $attrs = $seo = [];
if ($has('product_images')) foreach ($db->query('select slug, count(*) n from product_images group by slug') as $r) $photos[$r['slug']] = (int) $r['n'];
if ($has('product_variants')) foreach ($db->query('select slug, count(*) n, sum(stock) s, sum(stock > 0) instock from product_variants group by slug') as $r) { $vars[$r['slug']] = (int) $r['n']; $stock[$r['slug']] = [(int) $r['s'], (int) $r['instock']]; }
if ($has('product_attrs')) foreach ($db->query('select * from product_attrs') as $r) $attrs[$r['slug'] ?? ''] = 1;
$cats = []; $brands = [];
try { foreach ($db->query('select slug from brands') as $r) $brands[$r['slug']] = 1; } catch (Throwable $e) {}

$count = []; $bad = [];
$flag = function (string $slug, string $what) use (&$count, &$bad) { $count[$what] = ($count[$what] ?? 0) + 1; $bad[$slug][] = $what; };
$names = [];
foreach ($rows as $r) {
    if ((int) $r['active'] !== 1) continue;
    $s = (string) $r['slug'];
    $cats[(string) $r['category']] = ($cats[(string) $r['category']] ?? 0) + 1;
    foreach (['name_en', 'name_ar', 'desc_en', 'desc_ar'] as $f) if (trim((string) ($r[$f] ?? '')) === '') $flag($s, "no_$f");
    if (isset($r['name_ar']) && preg_match('/\?{2,}/', (string) $r['name_ar'])) $flag($s, 'name_ar_question_marks');
    if (isset($r['desc_ar']) && preg_match('/\?{3,}/', (string) $r['desc_ar'])) $flag($s, 'desc_ar_question_marks');
    if (isset($r['name_ar']) && $r['name_ar'] !== '' && !preg_match('/\p{Arabic}/u', (string) $r['name_ar'])) $flag($s, 'name_ar_not_arabic');
    if (isset($r['desc_en'], $r['desc_ar']) && $r['desc_en'] !== null && trim((string) $r['desc_en']) !== '' && trim((string) $r['desc_en']) === trim((string) $r['desc_ar'])) $flag($s, 'desc_same_both_langs');
    if (isset($r['desc_en']) && trim((string) $r['desc_en']) !== '' && mb_strlen(trim((string) $r['desc_en'])) < 40) $flag($s, 'desc_en_short');
    $p = (float) $r['price'];
    if ($p <= 0) $flag($s, 'price_zero');
    if ($p > 500) $flag($s, 'price_over_500');
    foreach (['sale_price', 'compare_at', 'old_price'] as $sp) if (isset($r[$sp]) && $r[$sp] !== null && (float) $r[$sp] > 0 && (float) $r[$sp] >= $p && $sp === 'sale_price') $flag($s, 'sale_not_below_price');
    if (trim((string) $r['category']) === '') $flag($s, 'no_category');
    if (array_key_exists('brand_slug', $r)) {
        if (trim((string) $r['brand_slug']) === '') $flag($s, 'no_brand');
        elseif ($brands && !isset($brands[$r['brand_slug']])) $flag($s, 'brand_unknown');
    }
    if (empty($photos[$s])) $flag($s, 'no_photo');
    if (empty($vars[$s])) $flag($s, 'no_sizes');
    elseif ($stock[$s][1] === 0) $flag($s, 'all_sizes_out_of_stock');
    if ($attrs && !isset($attrs[$s])) $flag($s, 'no_colour');
    $k = mb_strtolower(trim((string) $r['name_en']));
    if (isset($names[$k])) $flag($s, 'duplicate_name_en'); $names[$k] = 1;
}
ksort($count); ksort($cats);
echo 'CATEGORIES ' . implode(' ', array_map(fn ($k, $v) => ($k === '' ? '(none)' : $k) . "=$v", array_keys($cats), $cats)) . "\n";
echo 'ISSUES ' . ($count ? implode(' ', array_map(fn ($k, $v) => "$k=$v", array_keys($count), $count)) : 'none') . "\n"; flush();
foreach ($bad as $slug => $w) echo "  $slug: " . implode(',', $w) . "\n";
echo 'CLEAN ' . (count(array_filter($rows, fn ($r) => (int) $r['active'] === 1)) - count($bad)) . " active products with no issue\n";
