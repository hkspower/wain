<?php
/**
 * Create ONE test product for trying KNET / CBK end to end — 2026-10-07, "add test value and product at setup".
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/create-payment-test-product.php && php r.php
 *
 * 'payment-test', 0.100 KWD, one size (ONE) with stock 1, category accessories (so the women-only exchange rule never applies).
 * Created INACTIVE: the order route only accepts active products (store.php `and active = 1`), and active means public — it
 * would appear in the shop and the sitemap. To run a test: /backends -> Catalogue -> Payment test -> Active ON, buy it
 * (stock 1, so it can be bought once), then switch it OFF again (or delete it). IDEMPOTENT; reports STATE; never touches
 * an existing row, so it will not undo the owner switching it on.
 */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$c = @include $ROOT . '/api/config.php';
if (!is_array($c)) { line('NO-CONFIG'); return; }
$db = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$slug = 'payment-test';
$has = $db->prepare('select active from products where slug = ?'); $has->execute([$slug]);
if ($has->fetchColumn() === false) {
    $db->prepare("insert into products (slug,name_en,name_ar,price,category,active) values (?, 'Payment test', 'اختبار الدفع', 0.100, 'accessories', 0)")->execute([$slug]);
    line('CREATED product');
}
$v = $db->prepare('select stock from product_variants where slug = ? and size = ?'); $v->execute([$slug, 'ONE']);
if ($v->fetchColumn() === false) {
    $db->prepare('insert into product_variants (sku,slug,size,stock) values (?,?,?,1)')->execute([strtoupper(substr($slug, 0, 26) . '-ONE'), $slug, 'ONE']);
    line('CREATED size ONE stock 1');
}
$p = $db->query("select price, active, (select stock from product_variants where slug='payment-test' and size='ONE') as stock from products where slug='payment-test'")->fetch(PDO::FETCH_ASSOC);
line('STATE payment-test price=' . $p['price'] . ' active=' . $p['active'] . ' stockONE=' . $p['stock']);
