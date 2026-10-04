<?php
/**
 * PRINTABLE SIZE LABELS with a barcode per SKU — 2026-10-04 ("improve inventory" → barcode & labels).
 *
 *   /api/labels.php?slug=<product>            every size of one product
 *   /api/labels.php?skus=SKU1,SKU2            exactly these codes
 *   &copies=2                                 labels per size (1-20)
 *
 * THE BARCODE IS THE SKU, as Code 128 (subset B), drawn as inline SVG — no library, no image file, and
 * every phone camera and every USB scanner reads Code 128. Scanning one in the panel's Inventory
 * screen (assets/inventory-scan.js) finds that size at once. The label carries the product name in
 * both languages, the size, the price and the code in letters under the bars.
 *
 * THE GATE is store_session_admin(), like orders-print.php: this page is opened as a navigation, which
 * cannot carry the X-Sporta-Admin header, and it only READS. The price is public anyway; the wholesale
 * cost is never on a label.
 *
 * Print from the browser (Ctrl/Cmd+P). The page is laid out for A4 with 3 columns of 50×30 mm labels
 * and breaks cleanly; `@page` sets the margins.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';

$who = store_session_admin();
if ($who === null) {
    http_response_code(401);
    header('Content-Type: text/html; charset=utf-8');
    exit('<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:2rem">Sign in to <a href="/backends">the panel</a> first, then open this page again.</p>');
}

// ---- Code 128 B. Each symbol is 11 modules (bar/space widths from this table); START B = 104,
// the checksum is (104 + Σ i·value) mod 103, STOP = 106 with its 2-module terminal bar.
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function code128_svg(string $text, int $h = 48): string {
    $vals = [104];
    foreach (str_split($text) as $ch) { $o = ord($ch); if ($o < 32 || $o > 126) $o = 63; $vals[] = $o - 32; }
    $sum = 104; foreach (array_slice($vals, 1) as $i => $v) $sum += ($i + 1) * $v;
    $vals[] = $sum % 103; $vals[] = 106;
    $x = 10; $rects = ''; // 10-module quiet zone each side
    foreach ($vals as $v) {
        $pat = C128[$v];
        for ($i = 0; $i < strlen($pat); $i++) { $w = (int) $pat[$i]; if ($i % 2 === 0) $rects .= "<rect x=\"$x\" y=\"0\" width=\"$w\" height=\"$h\"/>"; $x += $w; }
    }
    $x += 10;
    return "<svg class=\"bc\" viewBox=\"0 0 $x $h\" preserveAspectRatio=\"none\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"" . htmlspecialchars($text, ENT_QUOTES) . "\"><g fill=\"#000\">$rects</g></svg>";
}

$db = store_db();
$copies = max(1, min(20, (int) ($_GET['copies'] ?? 1)));
$slug = trim((string) ($_GET['slug'] ?? ''));
$skus = array_values(array_filter(array_map('trim', explode(',', (string) ($_GET['skus'] ?? ''))), fn ($s) => $s !== '' && preg_match('/^[A-Za-z0-9_-]{1,30}$/', $s)));
if ($slug !== '') {
    $q = $db->prepare('select v.sku, v.size, p.name_en, p.name_ar, p.price from product_variants v join products p on p.slug = v.slug where v.slug = ? order by field(v.size, "S","M","L","XL","2XL","3XL","4XL","5XL","ONE"), v.sku');
    $q->execute([$slug]);
} elseif ($skus) {
    $in = implode(',', array_fill(0, count($skus), '?'));
    $q = $db->prepare("select v.sku, v.size, p.name_en, p.name_ar, p.price from product_variants v join products p on p.slug = v.slug where v.sku in ($in) order by p.name_en, v.sku");
    $q->execute(array_slice($skus, 0, 200));
} else { $q = null; }
$rows = $q ? $q->fetchAll() : [];
$h = static fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Robots-Tag: noindex');
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sporta labels</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font: 11px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; color: #000; background: #fff; }
  .tools { padding: 10px 12px; display: flex; gap: 10px; align-items: center; border-bottom: 1px solid #ddd; }
  .tools button, .tools a { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #999; background: #fff; cursor: pointer; text-decoration: none; color: #000; }
  .sheet { display: grid; grid-template-columns: repeat(3, 60mm); gap: 4mm 5mm; padding: 6mm; justify-content: start; }
  .lab { width: 60mm; height: 32mm; box-sizing: border-box; border: 1px dashed #bbb; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; break-inside: avoid; page-break-inside: avoid; }
  .nm { font-weight: 700; font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ar { font-size: 10px; direction: rtl; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .sz { font-size: 18px; font-weight: 800; }
  .pr { font-size: 12px; font-weight: 700; }
  .bc { width: 100%; height: 9mm; display: block; }
  .code { font: 9px/1 ui-monospace, monospace; letter-spacing: .06em; text-align: center; }
  .empty { padding: 2rem; font-size: 14px; }
  @media print { .tools { display: none; } .lab { border-color: #eee; } }
</style></head><body>
<div class="tools"><button type="button" onclick="print()">Print</button><a href="/backends">Back to the panel</a><span><?= count($rows) ?> size<?= count($rows) === 1 ? '' : 's' ?> × <?= $copies ?></span></div>
<?php if (!$rows): ?><p class="empty">No sizes to print. Open this page from Inventory → Print labels.</p><?php else: ?>
<div class="sheet">
<?php foreach ($rows as $r): for ($c = 0; $c < $copies; $c++): ?>
  <div class="lab" data-sku="<?= $h($r['sku']) ?>">
    <div><div class="nm"><?= $h($r['name_en']) ?></div><div class="ar"><?= $h($r['name_ar']) ?></div></div>
    <div class="row"><span class="sz"><?= $h($r['size'] === 'ONE' ? 'One size' : $r['size']) ?></span><span class="pr"><?= number_format((float) $r['price'], 3) ?> KWD</span></div>
    <div><?= code128_svg((string) $r['sku']) ?><div class="code"><?= $h($r['sku']) ?></div></div>
  </div>
<?php endfor; endforeach; ?>
</div>
<?php endif; ?>
</body></html>
