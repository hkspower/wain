<?php
/**
 * Centred hero slides — 2026-09-29, "make all hero slide models full centered
 * and better aspect ratio and improve model quality", approved as "publish".
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-centred.php && php c.php
 *
 * Each row is found by the image_hash it carries NOW (the previous desktop
 * picture) and gets a centred desktop picture plus a 4:5 phone picture; its
 * title, captions, button and order are untouched. focal_x goes to 50 because
 * the athlete now IS the centre; the old focal is printed so it can be put
 * back. A row already carrying the new hash is reported, so a re-run is
 * harmless. UNDO: swap the old files back in with publish-hero-clean.php's
 * shape (old pictures are in this repository).
 *
 * $COMMIT pins the ARTWORK. Fetch this script from HEAD.
 */
$COMMIT = 'bd482a2a5028d75505c27cf5b7a0a4101f809852';
$BASE = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/sporta-site/assets/hero/';

// name, old desktop hash, new desktop sha, new mobile sha, mobile w, mobile h
$SWAPS = [
  ['runner',     'c48773054fbac2408127d2626e36bb58dd95445f40be05438ed634d5e04f5d90', 'd04050b4f5dd814108b64069548dbf34a95837454379f365ffa5421356bd44a0', '090526584b1d793a1a0de21770d8ba283c2eb218a27c3125cb69d95da181e4db', 1080, 1080],
  ['activewear', '08c42cf6ddd600c76f15402806ad923a44b7c63f3ec144f58fe63e52495aa838', 'b52d09ca4cf62f99375110cba95fcd02f6aa09280fbb18f34a02ad87fc8a3d06', '96f9d2d1ec1d71235044fe5dd5c48902bedb2179df4ac7eb6f37bb0e38529aa0', 1080, 1350],
  ['training',   '728c64876a1ad0bafbacacbe4f73cbfde4f2fc8b0af60c2e82672c05aedac025', '3886986baa74c69fbd258cde0cbbe0e872c7cd46078ac3fe3fe058092eab7d4e', 'a1c8d1324a9bbff8c9a0c733290d1427f995fe952d31e322197a7a79bc9780a7', 1080, 1350],
  ['features',   'd7d15398ceb8b007048a534e1c6b87861d7a9ac2c325eed6180ac436f56abe64', '9eed56fde7375af37eb1d434cec8f3455eef7cc4cd441479a75dda5fa37ea477', 'a2fc2a3777ad27aa2ff9d381952b7e9981e9642889ee1055aba9eedaf8c20400', 1080, 1350],
  ['crossfit',   '355f09f5eec8db5f9ca195b946c075eeb89f2aee9b3cacdb677a9178bd8b2c9a', '84f81cad4f98b7ac321a545b12a9c691947eb86f9b32123fa54d514dc96768bf', '289746f08d3be6832e9bfef5572b90e446bc4f8fa4c579302548852b8d3d2abb', 1080, 1350],
];

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
function fetch_webp(string $url, string $sha): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_FOLLOWLOCATION => true]);
    $b = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if (!is_string($b) || $code !== 200) { line("  fetch FAILED http=$code " . basename($url)); return null; }
    if (hash('sha256', $b) !== $sha) { line('  HASH-MISMATCH ' . basename($url)); return null; }
    if (substr($b, 0, 4) !== 'RIFF' || substr($b, 8, 4) !== 'WEBP') { line('  NOT-A-WEBP ' . basename($url)); return null; }
    return $b;
}

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { line('HEROCENTRED db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('HEROCENTRED db=ERROR'); return; }

$done = 0; $swapped = 0; $missing = 0;
foreach ($SWAPS as [$name, $old, $sha, $msha, $mw, $mh]) {
    $q = $pdo->prepare('select id from hero_slides where image_hash = ?');
    $q->execute([$sha]);
    if ($id = $q->fetchColumn()) { line("SLIDE $name id=$id already-centred"); $done++; continue; }
    $q->execute([$old]);
    $id = $q->fetchColumn();
    if (!$id) { line("SLIDE $name old-row-NOT-FOUND " . substr($old, 0, 10)); $missing++; continue; }
    $b = fetch_webp($BASE . "$name-centred-desktop.webp", $sha);
    $m = $b === null ? null : fetch_webp($BASE . "$name-centred-mobile.webp", $msha);
    if ($b === null || $m === null) continue;
    $uri = 'data:image/webp;base64,' . base64_encode($b);
    $muri = 'data:image/webp;base64,' . base64_encode($m);
    if (strlen($uri) > 1200000 || strlen($muri) > 1200000) { line("SLIDE $name TOO-LARGE"); continue; }
    $f = $pdo->prepare('select focal_x, focal_y from hero_slides where id = ?'); $f->execute([$id]);
    $of = $f->fetch(PDO::FETCH_ASSOC);
    $pdo->prepare('update hero_slides set image = ?, image_hash = ?, image_w = 3200, image_h = 1270,
                          image_mobile = ?, image_mobile_hash = ?, image_mobile_w = ?, image_mobile_h = ?, focal_x = 50
                    where id = ?')->execute([$uri, $sha, $muri, $msha, $mw, $mh, $id]);
    line("SLIDE $name id=$id swapped oldFocal={$of['focal_x']}/{$of['focal_y']}");
    $swapped++;
}
$c = 0;
$q = $pdo->prepare('select count(*) from hero_slides where image_hash = ? and active = 1');
foreach ($SWAPS as $s) { $q->execute([$s[2]]); $c += (int) $q->fetchColumn(); }
line("HEROCENTRED swapped=$swapped alreadyCentred=$done notFound=$missing activeCentredSlides=$c/5");
