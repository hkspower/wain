<?php
/**
 * Publish the longer admin login — 1 file.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-long-login.php && php r.php
 *
 * STORE_ADMIN_IDLE_SECONDS: 12 hours -> 3 days. The session cookie now
 * carries STORE_ADMIN_ABSOLUTE_SECONDS (7 days) as its own lifetime instead
 * of closing with the browser — reversing the 2026-09-10 "session cookie"
 * choice, on direct request. store_session_admin() is still the one
 * authority and still enforces both clocks on every request regardless of
 * what the browser does with the cookie in between; the trade is that a
 * shared machine never explicitly signed out of now stays signed in for up
 * to a week instead of until the browser closes.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: one named path,
 * checked against the sha256 recorded here before it is written, pinned to
 * one commit, idempotent.
 */

$COMMIT = 'fd2cddbdcf5a542b0791ce67f91412f8aaa38eb6';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/store.php' => 'd8f2b725bfca2d4dc469ce5f34e1423cff199aea972ac55a6f5db77d2eb77803',
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

echo 'LONG-LOGIN wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
