<?php
/**
 * Publish the assistant typing-indicator fix — 2 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-typing-bubble.php && php r.php
 *
 * The سبورتا AI panel's "waiting for a reply" line was a bare, unstyled
 * <p> with no bubble background and no animation, unlike every real message
 * in the same list. sporta-ui.css now styles it as a bubble (matching the
 * shape every AI reply already uses) and gives it the same animate-pulse
 * breathing effect the panel's own mic button already uses. sw.js VERSION
 * bumped alongside it, since sporta-ui.css is a fixed-name cached asset.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: two named paths,
 * each checked against the sha256 recorded here before it is written,
 * pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = 'e768a57ca8e0d30bfbc8ce34c3a4e638a15adaf7';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => '00c92e3282034168151ee9e60da38dd97d75e232be5e6927814bf2b64071b03e',
    'sw.js'                => 'b85289497d9a2dc1814a96fa782707600b2bb169ed53f373a7db4d5f93616e09',
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

echo 'TYPING-BUBBLE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
