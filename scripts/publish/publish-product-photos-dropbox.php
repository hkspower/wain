<?php
/**
 * Six product photographs from the owner's Dropbox — 2026-09-29, "do all" on the
 * two products whose FILE NAMES identify them (Denver Nuggets cap, Cagliari
 * Calcio sweatshirt). Adds rows to product_images and changes nothing else.
 *
 *   wget -nv -O d.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-product-photos-dropbox.php && php d.php
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
  ['cagliari-calcio-sweatshirt-navy', 'cagliari-team-representation.jpg', 'https://www.dropbox.com/scl/fi/hzeb8nmp39ngk46yq1eno/team-representation-sweatshirt-cagliari-calcio-2022-2023.jpg?rlkey=guc22ew2d5moqin3r9sd61mdm&dl=1'],
  ['cagliari-calcio-sweatshirt-navy', 'cagliari-winter-team.jpg',           'https://www.dropbox.com/scl/fi/buayus0kgwko45lhh4y5k/winter-team-representation-sweatshirt-cagliari-calcio-202223.jpg?rlkey=xzlqngavlezjk29xzlqiqoj5d&dl=1'],
  ['cagliari-calcio-sweatshirt-navy', 'cagliari-representative.jpg',        'https://www.dropbox.com/scl/fi/jn7y62fr74l2ibqjbz8cy/representative-team-sweatshirt-for-summer-cagliari-calcio-2022-2023.jpg?rlkey=khrtkmw0chywjmbf0qua2lgqw&dl=1'],
  ['denver-nuggets-cap-navy',        'denver-capdenver.jpg',                'https://www.dropbox.com/scl/fi/thbhnhm5i7i3u0w8urvfa/capdenver.jpg?rlkey=2qk1xksxbcrotoemkthvnscc6&dl=1'],
  ['denver-nuggets-cap-navy',        'denver-capnew.jpg',                   'https://www.dropbox.com/scl/fi/fds30b9g9i5hq6cx81ifj/denvercapnew.jpg?rlkey=b9jhbqi2b46ru7d26593hly5a&dl=1'],
  ['denver-nuggets-cap-navy',        'denver-league-pv2.jpg',               'https://www.dropbox.com/scl/fi/u4k810j3lt0htak3a30my/mens-new-era-navy-denver-nuggets-the-league-9forty-adjustable-hat_ss5_p-5020232-pv-2-u-1czkbwukwxgjjvvefgka-v-cpqfv8f8yvy8ekngldd8.jpg?rlkey=0w5573oukn552w9hs9qwhr3x3&dl=1'],
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
foreach ($PHOTOS as [$slug, $name, $url]) {
    $known->execute([$slug]);
    if (!$known->fetchColumn()) { line("PHOTO $name product-NOT-FOUND $slug"); $failed++; continue; }
    [$bytes, $code] = get_bytes($url, $name, $LOCAL);
    if ($bytes === null || $code !== 200) { line("PHOTO $name fetch FAILED http=$code"); $failed++; continue; }
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
