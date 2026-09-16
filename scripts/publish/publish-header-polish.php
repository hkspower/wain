<?php
/**
 * Publish four header polish items from a design review: nav hover/active
 * feedback, a seam between the promo strip and the nav row, a bigger logo,
 * and a shadow separating the sticky header from the content below it.
 * Also shortens the nav's "Terms & Conditions" to "Terms" (full phrase in
 * a title tooltip).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-header-polish.php && php r.php
 *
 * WHAT THIS SHIPS. Three files: sporta-ui.css (the hover tint, the promo
 * seam, the bigger logo, the header shadow), nav-menu.js (the shortened
 * label + title tooltip), and sw.js (VERSION bumped, since both are
 * fixed-name assets a returning visitor could otherwise stay pinned to).
 *
 * NONE OF THIS IS A CONTRAST OR ACCESSIBILITY FIX — the AA numbers from
 * the header's original commit are untouched (re-checked by
 * test:site-contrast). These are the visual polish items approved after
 * reviewing screenshots of the shipped header in English, Arabic and at
 * 390px.
 *
 * Verified locally by scripts/header-polish-test.mjs and the updated
 * scripts/nav-menu-test.mjs. Mutation-tested one mutation per fix (the
 * hover rule removed, the seam border removed, the logo's breakpoint
 * reverted, the shadow removed, the label source swapped), each caught.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin. Every hash below was
 * generated from hash_file('sha256', …) and round-tripped through a
 * strlen() check before this file was written.
 */

$COMMIT = '35605c783de049d8db1845941327ed1e5f9bb5bf';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/nav-menu.js'   => 'fb7d1f67ba06a91e67f56ecee47714c2d85634cffa3f31fcbc3db9b7d5220ff3',
    'assets/sporta-ui.css' => '05fca4dc9e3b67a9451c3b0c6d360ca957a8f1ed7980acd7f7a35f2d16704059',
    'sw.js'                => 'd58a5b1600b2bcbae3c582420fd5df313b9113738d4eb451ffe402e4eaa7ebc4',
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

echo 'HEADERPOLISH wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' css=' . $cc . '/' . $cn
   . "\n";
