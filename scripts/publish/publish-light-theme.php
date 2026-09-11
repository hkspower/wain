<?php
/**
 * Publish the light theme's readability fixes.
 *
 *   php /home/<user>/publish-light-theme.php
 *
 * ONE FILE: assets/sporta-dark.css, which despite its name carries BOTH
 * themes' overrides — the dark block and the `:root:not([data-theme=dark])`
 * light block. The fix is in the light half: the header's active nav link and
 * the two footer headings were #171a1e on #2b3138, which is 1.33:1 and not
 * readable. They are now #eaecee at 11.09:1, the same value the dark theme
 * paints them, because those two surfaces are dark in both themes.
 *
 * NOBODY HAD SEEN IT because the shop opens in dark mode.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * No service-worker bump: sporta-dark.css carries no content hash, so sw.js
 * treats it network-first and .htaccess sends it no-cache, must-revalidate.
 *
 * The check reads the file back OVER HTTP and looks for both new rules in what
 * the server actually serves.
 */

$COMMIT = '02fc979';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = ["assets/sporta-dark.css" => "9e2cbc52735724d2f81bd33415b33bd680155f6099d7e9f9748d2ad2d24eb5b7"];

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
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

$ch = curl_init('https://127.0.0.1/assets/sporta-dark.css');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$served = (string) curl_exec($ch);
curl_close($ch);

echo 'LIGHTTHEME wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' servedBytes=' . strlen($served)
   . ' headerFooter=' . (strpos($served, '#eaecee !important') !== false ? 'ok' : 'MISSING')
   . ' separator=' . (strpos($served, '#7a8188') !== false ? 'ok' : 'MISSING') . "\n";
