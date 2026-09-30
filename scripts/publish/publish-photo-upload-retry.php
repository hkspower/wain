<?php
/**
 * Publish the photo-upload retry/timeout fix — 3 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-photo-upload-retry.php && php r.php
 *
 * admin-upload.js's call() gets a 30s timeout (AbortController) and marks a
 * network-level failure distinctly from a server rejection; product-photos.js
 * retries only the network kind, twice, and warns before leaving the page
 * while a batch is in flight. sw.js VERSION bumped, per the standing rule —
 * both are fixed-name assets the worker caches cache-first.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: three named paths,
 * each checked against the sha256 recorded here before it is written, pinned
 * to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '22fbc880681abe1a70ec1314edab8df47950164b';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/admin-upload.js'   => '36122f3011688580a77d6d5815bde7712266e17d7bd0d96a115c78d1858ee264',
    'assets/product-photos.js' => '603964f2077138a300347991efcf01a004df6ec459ef49687bca8e856c3088c1',
    'sw.js'                    => '6b1d60fc00f86696982b77f28353d1bda8967d024d9f616c5a7253bc851f1ad3',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    if (!is_dir($dir)) { $failed[] = $rel; continue; }

    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

echo 'PHOTO-UPLOAD-RETRY wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
