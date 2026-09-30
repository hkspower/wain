<?php
/**
 * Six product photographs from the owner's Dropbox — 2026-09-29, "do all" on the
 * two products whose FILE NAMES identify them (Denver Nuggets cap, Cagliari
 * Calcio sweatshirt). Adds rows to product_images and changes nothing else.
 *
 *   wget -nv -O d.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-product-photos-dropbox.php && php d.php
 *
 * THIS COPY carries single-use, 15-minute temporary download links (generated
 * from the owner's Dropbox at publish time); each is dead after one fetch and
 * after 900 seconds, so nothing here grants access any more.
 *
 * WHAT WAS NOT VERIFIED: this environment cannot download from Dropbox or view
 * the pictures, so the match is by name only — neither the colour of the
 * sweatshirt nor that each picture is the product it is named for has been
 * looked at. The links below are per-file Dropbox links; revoke them in Dropbox
 * once this has run (this repository is public).
 *
 * Fetched from the SERVER (which has outbound internet), checked for a JPEG
 * signature and a real size, shrunk to 2000px only if over the 1.1 MB cap, and
 * added after any photographs the product already has. A re-run adds nothing:
 * a photograph is skipped when the product already carries the same hash.
 * UNDO: delete those rows from product_images (panel: delete photo).
 */
$ROOT  = getenv('SPORTA_ROOT') ?: '/home/u130124229/domains/sporta.com.kw/public_html';
$LOCAL = getenv('SPORTA_PHOTO_LOCAL') ?: '';   // tests: read <name> from this directory instead

$PHOTOS = [
  ['cagliari-calcio-sweatshirt-navy', 'cagliari-representative.jpg', 'https://uc54d6d075542b4304bd854582b6.dl.dropboxusercontent.com/cd/0/get/DJCIum2AJ5Guz1FLCNuOezcZzpUoBbdRMsw5D_PWv7NHUDZUi79dylvwh83fCzQLw078L2CxU4Tl0cr5haygZ8pPUE-U_WyJly4ZjsL_n0dWroxq-0u-zziBudkdjJYVrUfUZvlW7fvY890yOOw6QkVAelZmnpVAGq_VmZBmatx3rA/file?c_luid=0c128db2', 83703],
  ['denver-nuggets-cap-navy', 'denver-league-pv2.jpg', 'https://uc4225b069265ddf264d51d2c445.dl.dropboxusercontent.com/cd/0/get/DJB-XuuazdIPflGvNOZgDbR-MuyHmYTtXsl9Qvo7WGhGghNGGz63yllF1j5ImI7XfflSyw6sUp4Nso-Q3MFcGUpS7mzjauzWJgKkDUW6JtT4TF-kG7ooN7fmjfrPizQVRPOz_VRZ73d-k-ItxvHS6JhsAGPEEKshvrdaY8vAet9F-A/file?c_luid=0c128db2', 225480],
];

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
function get_bytes(string $url, string $name, string $local): array {
    if ($local !== '') { $b = @file_get_contents("$local/$name"); return [$b === false ? null : $b, $b === false ? 0 : 200]; }
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90, CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (sporta-publisher)']);
    $b = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return [is_string($b) ? $b : null, $code];
}
function shrink_if_needed(string $bytes): string {
    if (strlen('data:image/jpeg;base64,' . base64_encode($bytes)) <= 1000000) return $bytes;
    $im = @imagecreatefromstring($bytes); if (!$im) return $bytes;
    $w = imagesx($im); $h = imagesy($im); $s = 2000 / max($w, $h);
    if ($s < 1) $im = imagescale($im, (int) round($w * $s), (int) round($h * $s), IMG_BICUBIC);
    ob_start(); imagejpeg($im, null, 88); return (string) ob_get_clean();
}

$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { line('DBXPHOTOS db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('DBXPHOTOS db=ERROR'); return; }

$known = $pdo->prepare('select 1 from products where slug = ?');
$has   = $pdo->prepare('select 1 from product_images where slug = ? and image_hash = ?');
$next  = $pdo->prepare('select coalesce(max(sort), -1) + 1 from product_images where slug = ?');
$count = $pdo->prepare('select count(*) from product_images where slug = ?');
$ins   = $pdo->prepare('insert into product_images (slug, sort, image, image_hash, image_w, image_h) values (?, ?, ?, ?, ?, ?)');
$added = 0; $already = 0; $failed = 0;
foreach ($PHOTOS as [$slug, $name, $url, $size]) {
    $known->execute([$slug]);
    if (!$known->fetchColumn()) { line("PHOTO $name product-NOT-FOUND $slug"); $failed++; continue; }
    [$bytes, $code] = get_bytes($url, $name, $LOCAL);
    if ($bytes === null || $code !== 200) { line("PHOTO $name fetch FAILED http=$code"); $failed++; continue; }
    if (strlen($bytes) !== $size) { line("PHOTO $name SIZE-MISMATCH " . strlen($bytes) . " != $size"); $failed++; continue; }
    if (substr($bytes, 0, 3) !== "\xff\xd8\xff") { line("PHOTO $name NOT-A-JPEG (" . strlen($bytes) . ' B)'); $failed++; continue; }
    $info = @getimagesizefromstring($bytes);
    if (!$info || $info[0] < 300 || $info[1] < 300) { line("PHOTO $name TOO-SMALL-OR-UNREADABLE"); $failed++; continue; }
    $bytes = shrink_if_needed($bytes);
    $uri = 'data:image/jpeg;base64,' . base64_encode($bytes);
    if (strlen($uri) > 1100000) { line("PHOTO $name TOO-LARGE"); $failed++; continue; }
    $hash = hash('sha256', $uri);
    $has->execute([$slug, $hash]);
    if ($has->fetchColumn()) { $already++; continue; }
    $count->execute([$slug]);
    if ((int) $count->fetchColumn() >= 12) { line("PHOTO $name product-full"); $failed++; continue; }
    [$w, $h] = getimagesizefromstring($bytes) ?: [null, null];
    $next->execute([$slug]);
    $ins->execute([$slug, (int) $next->fetchColumn(), $uri, $hash, $w, $h]);
    line("PHOTO $name added {$w}x{$h}");
    $added++;
}
$per = [];
foreach (['cagliari-calcio-sweatshirt-navy', 'denver-nuggets-cap-navy'] as $s) { $count->execute([$s]); $per[] = "$s=" . (int) $count->fetchColumn(); }
line('DBXPHOTOS onProducts=' . ($added + $already) . '/' . count($PHOTOS) . " added=$added alreadyThere=$already failed=$failed photos: " . implode(' ', $per));
