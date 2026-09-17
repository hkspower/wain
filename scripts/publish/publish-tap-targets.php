<?php
/**
 * Publish bigger tap targets on /backends and /checkout — 5 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-tap-targets.php && php r.php
 *
 * admin-mobile.js grows from three named controls to every button and
 * checkbox label under 44px on the whole website panel, pointer:coarse only,
 * plus an unconditional 10px->11px bump on the revenue chart's date-axis
 * labels. checkout-tap-targets.js (new) does the same for five controls on
 * /checkout — "Change", "Edit bag", the quantity steppers and "Remove" —
 * found not to have grown on the ONE path this was asked for ("Buy now"'s
 * quick checkout) until its own route check was fixed to re-run on the
 * SPA's client-side navigation rather than once at whatever page loaded
 * first. .htaccess gains checkout-tap-targets.js in the no-cache FilesMatch
 * list. index.html loads the new script and updates admin-mobile.js's own
 * comment. sw.js VERSION bumped for admin-mobile.js's real change.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: five named paths,
 * each checked against the sha256 recorded here before it is written,
 * pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '58e6d078dda7a843255e172a93e035df684f7a91';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    '.htaccess'                       => 'd1926b0d1e0af56c5a36bf6d74d6bac4ef8ae10db1e6915250fcd37d292de01d',
    'assets/admin-mobile.js'          => '3fb1c97f6221b8b375c7b77a20808d7cee0461b29786fbc13389776b2c158be0',
    'assets/checkout-tap-targets.js'  => 'f84c5b331be1dd1226d906dcc8823d590e97558ac47b4b55c0fe414a65c907b2',
    'index.html'                      => '0b83161d66181449c91cd67c9dd1660be5cfcf0787e8f7d95585e6dfeabb14ce',
    'sw.js'                           => 'b212f3186fb935c93851af92a026a50b5c3339020b456be47bf462ebcadf3062',
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

echo 'TAP-TARGETS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
