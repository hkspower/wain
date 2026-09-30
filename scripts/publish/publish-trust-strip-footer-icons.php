<?php
/**
 * Publish the home-page trust strip and footer payment icons — 3 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-trust-strip-footer-icons.php && php r.php
 *
 * Two new overlay scripts (trust-strip.js, footer-payment-icons.js) plus
 * index.html to load them. Both are NEW files — no sw.js VERSION bump, per
 * the standing rule that a new file strands no returning visitor.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: three named paths,
 * each checked against the sha256 recorded here before it is written, pinned
 * to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '0cbf2b8bf731a9b5018d5e9c39c8d9485350b77c';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/trust-strip.js'          => '763f76fc8a9cdd9be4c2f69fc473c27dd4281432de860b45d58b3d84b858d06d',
    'assets/footer-payment-icons.js' => '48f119e04cbad2ef4afcdd6aaf38d02579d65ea52f632e19cef7e95604d4855a',
    'index.html'                     => 'e0230f89d567aef6995c5dd29342e997aabe460924221f434a1760abfae4d1e9',
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

echo 'TRUST-STRIP-FOOTER-ICONS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
