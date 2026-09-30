<?php
/**
 * Hide incomplete products — 2026-09-29, "make any un complete product details
 * make un active". The owner chose ALL FOUR tests: no photograph, no
 * description (either language empty), no size/stock rows, no price (<= 0).
 *
 *   wget -nv -O i.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/deactivate-incomplete-products.php && php i.php          (DRY RUN: reports, writes nothing)
 *   ... && php i.php apply                                                                                                                                (writes)
 *
 * Only sets products.active = 0, and only on rows that are active now. Nothing
 * is deleted; UNDO is `update products set active = 1 where slug in (...)` —
 * the slugs are printed — or the panel's Active switch. If more than 30
 * products would be hidden, `apply` refuses: that is a shop emptying itself,
 * not tidying. The report is STATE (how many active / how many still
 * incomplete), so the run read a minute late says the same thing.
 */
$ROOT = getenv('SPORTA_ROOT') ?: '/home/u130124229/domains/sporta.com.kw/public_html';
$apply = in_array('apply', $argv ?? [], true);
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { line('INCOMPLETE db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('INCOMPLETE db=ERROR'); return; }

$sql = "select p.slug, p.active,
    (select count(*) from product_images i where i.slug = p.slug) as photos,
    (trim(coalesce(p.desc_en,'')) = '') as no_en,
    (trim(coalesce(p.desc_ar,'')) = '') as no_ar,
    (select count(*) from product_variants v where v.slug = p.slug) as sizes,
    (coalesce(p.price,0) <= 0) as no_price
  from products p order by p.slug";
$rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
$why = []; $bad = [];
foreach ($rows as $r) {
    $w = [];
    if ((int)$r['photos'] === 0) $w[] = 'photo';
    if ((int)$r['no_en'] || (int)$r['no_ar']) $w[] = 'description' . ((int)$r['no_en'] ? '-en' : '') . ((int)$r['no_ar'] ? '-ar' : '');
    if ((int)$r['sizes'] === 0) $w[] = 'sizes';
    if ((int)$r['no_price']) $w[] = 'price';
    if ($w) { $bad[$r['slug']] = ['active' => (int)$r['active'], 'why' => $w]; foreach ($w as $x) $why[$x] = ($why[$x] ?? 0) + 1; }
}
$activeNow = 0; foreach ($rows as $r) $activeNow += (int)$r['active'];
$toHide = array_keys(array_filter($bad, fn($b) => $b['active'] === 1));
line('INCOMPLETE products=' . count($rows) . ' activeNow=' . $activeNow . ' incompleteActive=' . count($toHide) . ' reasons=' . json_encode($why));
foreach ($bad as $slug => $b) line(($b['active'] ? '  ACTIVE   ' : '  inactive ') . $slug . '  ' . implode(',', $b['why']));
if (!$apply) { line('DRYRUN nothing written'); return; }
if (count($toHide) > 30) { line('REFUSED would hide ' . count($toHide) . ' (> 30)'); return; }
if (!$toHide) { line('APPLY nothing to hide'); return; }
$upd = $pdo->prepare('update products set active = 0 where slug = ? and active = 1');
$n = 0; foreach ($toHide as $s) { $upd->execute([$s]); $n += $upd->rowCount(); }
$left = (int)$pdo->query("select count(*) from products where active = 1")->fetchColumn();
line("APPLIED hidden=$n activeNow=$left");
