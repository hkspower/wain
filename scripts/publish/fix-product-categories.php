<?php
// WRITES the live database — 2026-10-03, the owner's answers to "fix all" after the product audit:
//   - the 11 jackets in 'outerwear' (not one of the shop's four categories, so on no category page)
//     move to 'women' — chosen knowing Women is the non-exchangeable category;
//   - denver-nuggets-cap-navy, 0 in every size, is switched OFF until it is restocked.
// Named slugs only, each guarded by its current value, so a second run changes nothing and a product
// the owner has since edited is left alone. Reports STATE, so a later tick reads the same.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
$db = store_db();

$jackets = ['cloudsoft-jacket-army-green', 'cloudsoft-jacket-cherry-red', 'cloudsoft-jacket-coffee-brown',
    'define-jacket-iris-purple', 'define-jacket-onyx-black', 'define-jacket-steel-grey',
    'sculpt-jacket-black', 'sculpt-jacket-grey', 'sculpt-jacket-navy', 'sculpt-jacket-taupe-brown'];
// The 11th 'outerwear' row: read rather than typed, so a fixture typed from memory cannot miss it.
foreach ($db->query("select slug from products where active = 1 and category = 'outerwear'")->fetchAll(PDO::FETCH_COLUMN) as $s) {
    if (!in_array($s, $jackets, true) && preg_match('/-jacket-|jacket$/', (string) $s)) $jackets[] = $s;
}
$cat = $db->prepare("update products set category = 'women' where slug = ? and category = 'outerwear'");
$moved = 0;
foreach ($jackets as $s) { $cat->execute([$s]); $moved += $cat->rowCount(); }
$off = $db->prepare("update products set active = 0 where slug = 'denver-nuggets-cap-navy' and active = 1
                     and not exists (select 1 from product_variants v where v.slug = 'denver-nuggets-cap-navy' and v.stock > 0)");
$off->execute();

$left = $db->query("select slug from products where active = 1 and category = 'outerwear'")->fetchAll(PDO::FETCH_COLUMN);
$cats = $db->query("select category, count(*) n from products where active = 1 group by category order by category")->fetchAll(PDO::FETCH_KEY_PAIR);
$cap = $db->query("select active from products where slug = 'denver-nuggets-cap-navy'")->fetchColumn();
echo 'STATE movedThisRun=' . $moved . ' jacketsInWomen=' . $db->query("select count(*) from products where active = 1 and category = 'women' and slug like '%jacket%'")->fetchColumn()
   . ' outerwearLeft=' . count($left) . ($left ? '(' . implode(',', $left) . ')' : '')
   . ' capActive=' . var_export($cap, true) . ' categories=' . json_encode($cats) . "\n";
