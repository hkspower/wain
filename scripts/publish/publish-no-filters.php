<?php
/**
 * Publish the filter removal — the shop narrows nothing.
 *
 *   php /home/<user>/publish-no-filters.php
 *
 * ONE FILE: assets/sporta-ui.css, which now carries a rule hiding the shop's
 * three narrowing controls — the category pills, the size row and the fit row.
 *
 * WHY CSS IS THE WHOLE FIX and not a cosmetic half of one: the storefront is a
 * prebuilt bundle with no source in this repository, and each filter's state
 * starts OFF in it (`useState('all')` for the category, `null` for size and
 * fit). Nothing but those controls ever sets it, so removing the controls means
 * the filter can never turn on. SORT is untouched — it narrows nothing — and so
 * is the header's `?q=` search.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * No service-worker bump: sporta-ui.css carries no content hash, so sw.js
 * treats it network-first and .htaccess sends it no-cache, must-revalidate.
 *
 * The check reads the file back OVER HTTP and looks for BOTH selectors in what
 * the server actually serves — one of them alone would leave half the filters
 * on the page.
 */

$COMMIT = '0dfc26e';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = ['assets/sporta-ui.css' => 'ccf85f0de7e5b9db6740cc17e31fc129018a03aa0e8d00adf17434854b40514d'];

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

$ch = curl_init('https://127.0.0.1/assets/sporta-ui.css');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$served = (string) curl_exec($ch);
curl_close($ch);

echo 'NOFILTERS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' servedBytes=' . strlen($served)
   . ' categoryRule=' . (strpos($served, 'button[aria-pressed]') !== false ? 'ok' : 'MISSING')
   . ' sizeFitRule=' . (strpos($served, '.mb-8:has(.filter-scroller)') !== false ? 'ok' : 'MISSING')
   . "\n";
