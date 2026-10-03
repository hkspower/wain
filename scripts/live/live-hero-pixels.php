<?php
// READ-ONLY: the REAL pixels of every hero picture on the live shop (2026-10-03, "fix all blurry
// issues"). image_w/image_h in the table are what the uploader CLAIMED; this decodes the stored
// bytes and reports what is actually there, plus the boot shell's /hero/*.webp files. No secrets.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html';
$root = is_dir($live) ? $live : __DIR__ . '/../../sporta-site/public_html';
require $root . '/api/store.php';
$db = store_db();
$dim = function (?string $uri): string {
    if (!$uri) return 'none';
    if (!preg_match('#^data:(image/[a-z+]+);base64,#', $uri, $m)) return 'not-data-uri';
    $bytes = base64_decode(substr($uri, strlen($m[0])), true);
    $s = $bytes === false ? false : @getimagesizefromstring($bytes);
    return $s ? "{$s[0]}x{$s[1]}/{$m[1]}/" . strlen($bytes) . 'B' : 'undecodable';
};
try { $hs = store_setting($db, 'hero'); echo 'SETTINGS ' . json_encode(array_intersect_key($hs, array_flip(['size', 'autoplay', 'interval']))) . "\n"; } catch (Throwable $e) { echo "SETTINGS ?\n"; }
foreach ($db->query('select id, sort, active, title_en, image_w, image_h, image_mobile_w, image_mobile_h, focal_x, focal_y, image, image_mobile from hero_slides order by active desc, sort') as $r) {
    echo "SLIDE id={$r['id']} active={$r['active']} sort={$r['sort']} kind=" . ($r['title_en'] !== null ? 'photo' : 'drawn')
       . " claimed={$r['image_w']}x{$r['image_h']} real=" . $dim($r['image'])
       . " mClaimed={$r['image_mobile_w']}x{$r['image_mobile_h']} mReal=" . $dim($r['image_mobile'])
       . " focal={$r['focal_x']}/{$r['focal_y']}\n";
    @flush();
}
foreach (glob($root . '/hero/*/*.webp') ?: [] as $f) {
    $s = @getimagesize($f);
    echo 'BOOT ' . substr($f, strlen($root) + 1) . ' ' . ($s ? "{$s[0]}x{$s[1]}" : '?') . ' ' . filesize($f) . "B\n";
}
