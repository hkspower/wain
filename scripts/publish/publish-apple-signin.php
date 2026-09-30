<?php
/**
 * Publish "Sign in with Apple" for /backends — 7 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-apple-signin.php && php r.php
 *
 * Mirrors the Google sign-in feature exactly: an Apple ID token verified
 * server-side against Apple's own published keys, no client secret, never
 * creates an admin account, never skips an enrolled second factor. Adds
 * apple_config/apple_login (above the gate, same shape as google_config/
 * google_login) and apple_save (self-gated, same shape as google_save) to
 * admin.php, and store_apple_verify()/store_apple_login()/store_apple_jwks()
 * to store.php. assets/apple-signin.js is the new overlay — a second sign-in
 * door and the owner's setup card. .htaccess gains appleid.cdn-apple.com and
 * appleid.apple.com in the /backends-only CSP, plus the apple-signin.js
 * entry in the no-cache FilesMatch list (which also closes a pre-existing
 * gap: assistant-icon.js and invoices.js were already missing from it).
 * index.html loads the new script. sw.js VERSION bumped because
 * google-signin.js itself changed too — it had the same "only checks ?r=me
 * once, at page load" bug this feature's build surfaced, fixed here in both
 * files: the panel signs in without a reload, so the setup card never
 * appeared for an admin who signed in with the password form until this fix.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: seven named paths,
 * each checked against the sha256 recorded here before it is written,
 * pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '10411973ddd30c9a1a3ad9cc9aa6a087159d4d9c';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    '.htaccess'               => '5e036ec5b57ae5192951a02331d9216387e266b24e50185ae4fe40f407ac0339',
    'api/admin.php'           => 'b164b4930173113c490872290dd36fc4d74defde3e8358ef72336c26bc19ed40',
    'api/store.php'           => '69ade68727df3fda6d63376721f1f9b6bea9c52a4240b3f809f5537ccd40d539',
    'assets/apple-signin.js'  => '61b4fccc570888c821b0c16137f786e2dce3f09e518928ad768211dcc52b4fcf',
    'assets/google-signin.js' => '707a762dded58b38de5e28e414211192b7a51a9222fd14d7fc3852d21a1715a2',
    'index.html'              => '6291800205a8d65e8dc8f8b26b8c81c0d93e20fbec24a2aa9ccfc993fbbb35e9',
    'sw.js'                   => '1bf31f5da4f7af8232990ff7179a3c2f97fc9cd25046e93153d89c70c3a4da1c',
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

echo 'APPLE-SIGNIN wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
