<?php
/**
 * Publish the bulk photo uploader improvements — "improve images uploader at
 * backends", 2026-09-17: preview thumbnails on queued files, a real drop
 * zone, and managing (delete/reorder) photographs already on a garment.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-photo-uploader.php && php r.php
 *
 * WHAT THIS SHIPS. Two files: assets/product-photos.js (the three additions,
 * on top of the existing upload flow — every class name and message that
 * flow already relied on is unchanged) and sw.js (VERSION bumped, since
 * product-photos.js is a fixed-name asset the worker would otherwise pin for
 * returning admins).
 *
 * Verified locally: product-photos-site-test.mjs (the pre-existing upload
 * flow, unaffected) and product-photos-manage-test.mjs (new — thumbnails,
 * the drop zone, reorder and delete, all against the sandbox's own server
 * state), both green, plus test:sw-version.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = 'a4918a86329937f93602d4e233897186aa5b7fc7';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/product-photos.js' => 'ca12bac3b54c3a23ceb7f77a2b55a4cf1376bf654dfba58c42fb6ff217542275',
    'sw.js'                    => '9e2f0292caf072ef960cd996475b5d2ab5b2af21596c882be8e927c078ad6824',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                            CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200 || $body === '') { $failed[] = $rel . '/http' . $code; break; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; break; }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }
}

/* -------------------------------------------------------- verify, live --- */
$fetch = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, strlen($out)];
};

[$hc, $hn] = $fetch('/');
[$pc, $pn] = $fetch('/assets/product-photos.js');

echo 'PHOTOUPLOADER wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' photojs=' . $pc . '/' . $pn
   . "\n";
