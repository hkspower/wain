<?php
/**
 * Publish the code half of the temporary-password feature — admin.php and
 * store.php only. No assets, no index.html, no JS/CSS.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-must-change-password-code.php && php r.php
 *
 * MUST run AFTER migrate-must-change-password.php has landed — see that
 * file's own header. Both PHP files select/update the must_change_password
 * column on every gated admin request; publishing this first would fatal
 * every /backends request with an unknown-column error.
 *
 * The two overlay files (force-password-notice.js, index.html's script tag)
 * are deliberately NOT included here — asked for by name. The server-side
 * gate (428 on every route but ?r=account/?r=account_update) works without
 * them; the banner is only the explanation, and admin.ts's own 401->
 * Unauthorized special-case for account_update means the app's forced-change
 * screen already works without any asset publish at all.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: each path checked
 * against the sha256 recorded here before it is written, pinned to one
 * commit, fetched one at a time, idempotent.
 */

$COMMIT = 'e89db58f714d2fc20afdc36a03d1aa07a6a8dffd';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php' => '3e9a3118dd0b8ff4cd6492251940eaaaab69804df1dff01f76624cad674a5577',
    'api/store.php' => '39c7c096ef6770c959e4a886c7faa7f2dd5baa2ac4ebe9b5c0869caded51a13f',
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

echo 'MUST-CHANGE-PASSWORD-CODE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
