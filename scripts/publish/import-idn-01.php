<?php
/**
 * IDN-01 stock import — 2026-10-07. The owner supplied IDNfinaloffical.xlsx (inbound delivery note, 8 Dec 2025,
 * 55 pcs) "as real inventory data" and chose: SET each matched size to the file's quantity (never add, because
 * most of the file was already typed into the shop), and CREATE the missing items as INACTIVE products.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/import-idn-01.php && php r.php          (dry run, writes nothing)
 *   ... && php r.php apply                                                                                                                  (writes)
 *
 * IDEMPOTENT: a size already at the file's quantity is left alone and logs nothing, so a per-minute job reads
 * the same state on every run. Sizes not in the file are never touched. Created products are active=0, price 0,
 * no description, name_ar = name_en (the file has no Arabic) — the owner completes them in /backends.
 * SKU for new rows is the panel's own formula (upper(substr(slug,0,26)-SIZE)) so a later /backends save hits the SAME row.
 */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$apply = in_array('apply', $argv ?? [], true);
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$c = @include $ROOT . '/api/config.php';
if (!is_array($c)) { line('NO-CONFIG'); return; }
$db = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// slug => [size => qty]   (barcodes in the file: A-CSL=Cloudsoft leggings, A-CST=Cloudsoft top, A-CSJ=Cloudsoft jacket,
// A-SL / A-SJ / A-ST = Sculpt leggings / jacket / top, A-DFZJ = Define jacket; the file's descriptions say "bra"/"top"
// where the shop's names are Top/Jacket, so the BARCODE decides.)
$SET = [
 'cloudsoft-leggings-onyx-black' => ['M'=>2,'L'=>2], 'cloudsoft-top-onyx-black' => ['M'=>2,'L'=>1],
 'sculpt-leggings-black' => ['L'=>1], 'sculpt-jacket-black' => ['L'=>1], 'sculpt-top-black' => ['L'=>1],
 'sculpt-leggings-navy' => ['M'=>1], 'sculpt-jacket-navy' => ['M'=>1], 'sculpt-top-navy' => ['M'=>1],
 'cloudsoft-top-navy' => ['L'=>1], 'cloudsoft-leggings-navy' => ['L'=>1],
 'sculpt-leggings-grey' => ['M'=>1,'L'=>1], 'sculpt-jacket-grey' => ['M'=>1,'L'=>1], 'sculpt-top-grey' => ['M'=>1,'L'=>1],
 'cloudsoft-top-grey' => ['L'=>1], 'cloudsoft-leggings-grey' => ['L'=>1],
 'sculpt-leggings-taupe-brown' => ['M'=>1,'L'=>1], 'sculpt-jacket-taupe-brown' => ['M'=>1,'L'=>1], 'sculpt-top-taupe-brown' => ['M'=>1,'L'=>1],
 'cloudsoft-jacket-cherry-red' => ['L'=>1], 'cloudsoft-leggings-cherry-red' => ['L'=>1],
 'cloudsoft-jacket-army-green' => ['M'=>1,'L'=>1], 'cloudsoft-leggings-army-green' => ['M'=>1,'L'=>1],
 'cloudsoft-jacket-coffee-brown' => ['M'=>2,'L'=>1], 'cloudsoft-leggings-coffee-brown' => ['M'=>2,'L'=>1],
 'define-jacket-iris-purple' => ['M'=>1,'L'=>1], 'define-jacket-steel-grey' => ['L'=>1,'XL'=>1], 'define-jacket-onyx-black' => ['M'=>1,'L'=>1],
 'cheetahs-rugby-t-shirt' => ['XL'=>1,'2XL'=>2],
];
$NEW = [
 'vanquish-tsp-chalk-red-multi-print-oversized-t-shirt' => ['name'=>'Vanquish TSP Chalk Red Multi Print Oversized T-Shirt','cat'=>'men','sizes'=>['3XL'=>1]],
 'vanquish-triumph-navy-longline-tank' => ['name'=>'Vanquish Triumph Navy Longline Tank','cat'=>'men','sizes'=>['L'=>4]],
];
$total = 0; foreach ($SET as $s) $total += array_sum($s); foreach ($NEW as $n) $total += array_sum($n['sizes']);
line("PLAN lines-total-pcs=$total (file says 55) mode=" . ($apply ? 'APPLY' : 'DRYRUN'));

$have = $db->prepare('select sku, stock from product_variants where slug = ? and size = ?');
$prod = $db->prepare('select 1 from products where slug = ?');
$log  = $db->prepare("insert into stock_log (sku,slug,size,delta,stock_after,reason,actor,ref) values (?,?,?,?,?,'idn-import','import','IDN-01')");
$changed = 0; $same = 0; $bad = 0;
function sku(string $slug, string $size): string { return strtoupper(substr($slug, 0, 26) . '-' . $size); }
$setStock = function (string $slug, string $size, int $qty) use ($db, $have, $log, $apply, &$changed, &$same) {
    $have->execute([$slug, $size]); $r = $have->fetch(PDO::FETCH_ASSOC);
    if ($r) {
        $cur = (int)$r['stock'];
        if ($cur === $qty) { $same++; return; }
        line("  SET $slug $size $cur -> $qty");
        if ($apply) { $db->prepare('update product_variants set stock = ? where sku = ?')->execute([$qty, $r['sku']]); try { $log->execute([$r['sku'], $slug, $size, $qty - $cur, $qty]); } catch (Throwable $e) {} }
    } else {
        $k = sku($slug, $size);
        line("  NEW-SIZE $slug $size = $qty ($k)");
        if ($apply) { $db->prepare('insert into product_variants (sku,slug,size,stock) values (?,?,?,?)')->execute([$k, $slug, $size, $qty]); try { $log->execute([$k, $slug, $size, $qty, $qty]); } catch (Throwable $e) {} }
    }
    $changed++;
};
foreach ($SET as $slug => $sizes) {
    $prod->execute([$slug]);
    if (!$prod->fetchColumn()) { line("  MISSING-PRODUCT $slug"); $bad++; continue; }
    foreach ($sizes as $size => $qty) $setStock($slug, $size, $qty);
}
foreach ($NEW as $slug => $n) {
    $prod->execute([$slug]);
    if (!$prod->fetchColumn()) {
        line("  NEW-PRODUCT $slug (inactive, price 0)");
        if ($apply) $db->prepare("insert into products (slug,name_en,name_ar,price,category,active) values (?,?,?,0,?,0)")->execute([$slug, $n['name'], $n['name'], $n['cat']]);
        $changed++;
    }
    foreach ($n['sizes'] as $size => $qty) $setStock($slug, $size, $qty);
}
// STATE: every line now equals the file.
$ok = 0; $off = 0;
$all = $SET; foreach ($NEW as $s => $n) $all[$s] = $n['sizes'];
foreach ($all as $slug => $sizes) foreach ($sizes as $size => $qty) { $have->execute([$slug, $size]); $r = $have->fetch(PDO::FETCH_ASSOC); ($r && (int)$r['stock'] === $qty) ? $ok++ : $off++; }
line("STATE linesMatchingFile=$ok linesDiffering=$off missingProducts=$bad changedThisRun=$changed alreadyRight=$same");
