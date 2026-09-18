<?php
/**
 * Publish the full-screen hero — 4 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-full-screen.php && php r.php
 *
 * The hero now fills the whole screen (100svh) at every width, cropping the
 * banner's sides rather than showing it whole — a straight reversal of the
 * 2026-09-17 "never crop" choice, approved with that trade named. index.html
 * changed because its boot script paints the pre-mount shell to the same
 * height, and .htaccess changed because that boot script is one of the five
 * inline scripts the CSP pins by hash. sw.js VERSION bumped: sporta-ui.css is
 * a fixed-name asset the worker caches cache-first.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: four named paths,
 * each checked against the sha256 recorded here before it is written, pinned
 * to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '362c966efd95c9a1daebca60a40bc7abc450a05b';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    '.htaccess'              => 'd0649877458099164525bdcb950296a95717b7f4a2645d7411f80af60b553eea',
    'assets/sporta-ui.css'   => '19d85979c7f7faac8db029194a7b7850d4e2cf1d82a6c1d0a2e364ec0404ce9a',
    'index.html'             => 'e2f9d08a65e16b0f343830b818ff87bfd482fc87ad82124bd807d8b3a5aa8f57',
    'sw.js'                  => '8935507180c638df81ac634d9276013a553cefdfb4defb63e9b89f0a0147ad59',
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

echo 'HERO-FULL-SCREEN wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
