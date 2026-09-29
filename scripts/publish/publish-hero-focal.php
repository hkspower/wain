<?php
/**
 * Hero focal point for phones — 2026-09-29, "scan the hero on mobile, then
 * improve". A phone's hero box is shorter than the 4:5 phone picture (55svh, so
 * about 365px tall on an iPhone with its browser bars), and `object-fit: cover`
 * centred on focal_y 50 took equal bites off the top and bottom — cutting the
 * heads off "Strength your way" and "Ready to train". The models' heads are in
 * the top tenth of every picture, so the focal point goes near the top: the
 * legs give way instead of the face. Desktop is unaffected (its box is the
 * banner's own shape, so there is nothing to crop vertically).
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-focal.php && php c.php
 *
 * Rows are found by the hash of the centred picture they carry now; only
 * focal_y changes. Reports STATE, so every run reads the same.
 * UNDO: focal_y = 50 for the same rows.
 */
$ROWS = [  // centred desktop sha256 => focal_y
    'd04050b4f5dd814108b64069548dbf34a95837454379f365ffa5421356bd44a0' => 15,  // Built to move
    'b52d09ca4cf62f99375110cba95fcd02f6aa09280fbb18f34a02ad87fc8a3d06' => 15,  // Strength your way
    '3886986baa74c69fbd258cde0cbbe0e872c7cd46078ac3fe3fe058092eab7d4e' => 15,  // Ready to train
    '9eed56fde7375af37eb1d434cec8f3455eef7cc4cd441479a75dda5fa37ea477' => 15,  // Features
    '84f81cad4f98b7ac321a545b12a9c691947eb86f9b32123fa54d514dc96768bf' => 25,  // CrossFit
];
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$cfg = @include '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_array($cfg)) { line('HEROFOCAL db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('HEROFOCAL db=ERROR'); return; }
$upd = $pdo->prepare('update hero_slides set focal_y = ? where image_hash = ?');
$sel = $pdo->prepare('select id, focal_x, focal_y from hero_slides where image_hash = ?');
$ok = 0;
foreach ($ROWS as $hash => $fy) {
    $upd->execute([$fy, $hash]);
    $sel->execute([$hash]);
    $r = $sel->fetch(PDO::FETCH_ASSOC);
    if ($r && (int)$r['focal_y'] === $fy) { $ok++; line("SLIDE id={$r['id']} focal={$r['focal_x']}/{$r['focal_y']}"); }
    else line('SLIDE ' . substr($hash, 0, 10) . ' NOT-FOUND');
}
line("HEROFOCAL rows=$ok/" . count($ROWS));
