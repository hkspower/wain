<?php
/**
 * Neutral hero slides — 2026-10-01, "remove shadow and tint and make colour
 * accuracy strong for hero slide and make higher quality", approved "yes do".
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-neutral.php && php c.php
 *
 * The old banners carried their dark vignette and orange grade IN THE PIXELS
 * (nothing in CSS paints over the photo any more), so the fix is new art:
 * generated at 3840x1524, bright neutral studio light, no vignette, no grade,
 * stored as 3200x1270 desktop + 1080x1350 phone. Each row is found by the hash
 * of the CENTRED picture it carries now; title, captions, button, order and
 * active stay as they are. focal_x goes to where the athlete stands. A row
 * already carrying the new hash is reported, so a re-run is harmless.
 * UNDO: publish-hero-centred.php's files are still in this repository; swap
 * them back with the same shape.
 *
 * $COMMIT pins the ARTWORK. Fetch this script from HEAD.
 */
$COMMIT = '__COMMIT__';
$BASE = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/sporta-site/assets/hero/';

// name, current (centred) desktop hash, new desktop sha, new mobile sha, focal_x
$SWAPS = [
  ['runner',     'd04050b4f5dd814108b64069548dbf34a95837454379f365ffa5421356bd44a0', 'fae0112c1ea5ebe2565eebabbe06f9c0318757a8fa736e37eaaf28c63ba23a9f', 'a2646785e4200a5257a20f6fd77296caf2d9a20c686316c1aa2128525d5cf91e', 63],
  ['activewear', 'b52d09ca4cf62f99375110cba95fcd02f6aa09280fbb18f34a02ad87fc8a3d06', 'aad2f59f893eb2d3fab2ee04f160b97fdbbb925e742fb430b2b7545cd9094e3b', '12ef8609248788a82f4c2c78dee042150916a3e16d734320f808b41563ebc5b5', 68],
  ['training',   '3886986baa74c69fbd258cde0cbbe0e872c7cd46078ac3fe3fe058092eab7d4e', '1c113245a75cd13f5cb0100e3d675b22840b491e6c932d8fc97a39cd2a6f0581', '3b9360d29164a5b08a471b2563fa48dde0931311779ae700a1a2267a112d6e5d', 62],
  ['features',   '9eed56fde7375af37eb1d434cec8f3455eef7cc4cd441479a75dda5fa37ea477', '79adcfd9075dea0c19ebd3d44ce94dec427555502192e8b8ed3065b1e7609018', '660594879f0cb28aa6b34d67cfe2e507246ae84152296dae4dd92f5679c36b5e', 28],
  ['crossfit',   '84f81cad4f98b7ac321a545b12a9c691947eb86f9b32123fa54d514dc96768bf', '3cfbd88622884ba9cc1db7b15048ce391868be0481ecb4992c8c900ac1ed8f46', '2a90a19f419c73c4cd1fbbe95676c76daf31c11695a7a450c3b17786204f416a', 50],
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
if (!is_array($cfg)) { line('HERONEUTRAL db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('HERONEUTRAL db=ERROR'); return; }

$done = 0; $swapped = 0; $missing = 0;
foreach ($SWAPS as [$name, $old, $sha, $msha, $fx]) {
    $mw = 1080; $mh = 1350;
    $q = $pdo->prepare('select id from hero_slides where image_hash = ?');
    $q->execute([$sha]);
    if ($id = $q->fetchColumn()) { line("SLIDE $name id=$id already-neutral"); $done++; continue; }
    $q->execute([$old]);
    $id = $q->fetchColumn();
    if (!$id) { line("SLIDE $name old-row-NOT-FOUND " . substr($old, 0, 10)); $missing++; continue; }
    $b = fetch_webp($BASE . "$name-neutral-desktop.webp", $sha);
    $m = $b === null ? null : fetch_webp($BASE . "$name-neutral-mobile.webp", $msha);
    if ($b === null || $m === null) continue;
    $uri = 'data:image/webp;base64,' . base64_encode($b);
    $muri = 'data:image/webp;base64,' . base64_encode($m);
    if (strlen($uri) > 1200000 || strlen($muri) > 1200000) { line("SLIDE $name TOO-LARGE"); continue; }
    $f = $pdo->prepare('select focal_x, focal_y from hero_slides where id = ?'); $f->execute([$id]);
    $of = $f->fetch(PDO::FETCH_ASSOC);
    $pdo->prepare('update hero_slides set image = ?, image_hash = ?, image_w = 3200, image_h = 1270,
                          image_mobile = ?, image_mobile_hash = ?, image_mobile_w = ?, image_mobile_h = ?, focal_x = ?
                    where id = ?')->execute([$uri, $sha, $muri, $msha, $mw, $mh, $fx, $id]);
    line("SLIDE $name id=$id swapped oldFocal={$of['focal_x']}/{$of['focal_y']}");
    $swapped++;
}
$c = 0;
$q = $pdo->prepare('select count(*) from hero_slides where image_hash = ? and active = 1');
foreach ($SWAPS as $s) { $q->execute([$s[2]]); $c += (int) $q->fetchColumn(); }
line("HERONEUTRAL swapped=$swapped alreadyNeutral=$done notFound=$missing activeNeutralSlides=$c/5");
