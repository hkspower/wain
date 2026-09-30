<?php
/**
 * Publish the header/promo-strip charcoal recolour — "make top menu and
 * topbar light black color", 2026-09-17.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-header-charcoal.php && php r.php
 *
 * WHAT THIS SHIPS. Two files: sporta-ui.css (header.app-header and
 * header.app-header > p both repainted #2b2b2b, replacing --brand-dark
 * orange and bg-ink-steel respectively; the seam hairline between them
 * changed from ember to a faint white so it still separates two elements
 * that are merely close in tone now, not identical) and sw.js (VERSION
 * bumped to v23-header-charcoal1, since sporta-ui.css is a fixed-name
 * asset the worker would otherwise pin for returning visitors).
 *
 * Verified locally: site-contrast.mjs (all pairs meet AA, dark theme),
 * header-polish-test.mjs and menu-essentials-removed-test.mjs (both still
 * green — hover tint, promo seam, logo size, header shadow, menu-hidden and
 * essentials-removed all unaffected by the colour change), and
 * test:sw-version (the bump is committed and covers both files).
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = 'e79b0d1570c4d55ef5339513abba84f69b9f9f2d';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => '48e53daa21950504c9fb53ae382fc856a5661826044c51bb81c69466da1d38ba',
    'sw.js'                => '7ae41818ea3b34dcc4f501ecae5e6d1303f103625d92e9eda65e6c2dd1abdb6b',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                            CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200 || $body === '') { $failed[] = $rel . '/http' . $code; break; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; break; }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }
}

/* -------------------------------------------------------- verify, live --- */
$fetch = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, strlen($out)];
};

[$hc, $hn] = $fetch('/');
[$cc, $cn] = $fetch('/assets/sporta-ui.css');

echo 'HEADERCHARCOAL wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' css=' . $cc . '/' . $cn
   . "\n";
