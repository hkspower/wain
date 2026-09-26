<?php
/**
 * Publish the KNET secrets panel — 5 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-knet-secrets-panel.php && php r.php
 *
 * Lets the owner edit the KNET Tranportal password and the Terminal Resource
 * Key from /backends, not just the ID — admin.php's ?r=knet route and its
 * settings_save branch, knet.php's renamed knet_apply_saved_credentials(),
 * store.php's settings defaults, and the website panel's payment.js. sw.js
 * VERSION bumped: payment.js is a fixed-name asset the worker caches
 * cache-first.
 *
 * knet/selftest.php is DELIBERATELY NOT IN THIS LIST even though it was
 * edited in the same commit. It was removed from the live server on
 * 2026-09-09 (see CLAUDE.md) and live-file-check.php's $MUSTNOT list still
 * expects it absent — the edit only matters the day someone re-adds it by
 * hand to debug against env=test, and this publisher must not put it back.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: five named paths,
 * each checked against the sha256 recorded here before it is written, pinned
 * to one commit, fetched one at a time, idempotent.
 */

$COMMIT = 'da37afb4aa8f785fad933f756b7403f0b43523fc';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php'      => '543226134d79111a9ba2d2218ba99110f08eac1b35f3692710f6b588a9283149',
    'api/store.php'      => '30d0c898b821b3b07f9db09d696b90652ecba03c7e0f69fc1c3813ab85454938',
    'assets/payment.js'  => '9320d6c9d1c67657320f854ce5937b8f2218cc208f533add456cdd49bb609270',
    'knet/knet.php'      => '419e87c335782aa93b1b7a060f46034084bc6f8e6d3ecdbf82ca79cfd827b1f5',
    'sw.js'              => '724dbe020223e98193d1bb2ccfa852f0b22f0f1b89e802651a37ec3cd828bfce',
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

echo 'KNET-SECRETS-PANEL wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
