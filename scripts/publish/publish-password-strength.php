<?php
/**
 * Publish the weak-password check — 2 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-password-strength.php && php r.php
 *
 * store_password_is_weak() (store.php) refuses a password that clears the
 * existing twelve-character floor but is still trivially guessable — every
 * character the same, a straight ascending/descending digit or letter run,
 * the account's own email address, or a short list of the passwords every
 * breach corpus puts first plus the shop's own name. No external lookup.
 * admin.php calls it from both doors that set a password: register (the
 * first admin) and account_update (a change), in addition to the length
 * check rather than instead of it.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: two named paths,
 * each checked against the sha256 recorded here before it is written,
 * pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = 'f2f9f64496fd58cdcf799bf2468509a7b4c9b896';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php' => 'e79216851d788a971d8a53b60fd81b05661d1c215401a8af8aeb914d5f796373',
    'api/store.php' => '9f88de153f4b2270782a4aac39f435cd997bcb81b35337f0cf3f684ffd050a44',
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

echo 'PW-STRENGTH wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
