<?php
/**
 * Publish two batches together: the header polish review (nav hover/active,
 * the promo/header seam, a bigger logo, a header shadow, "Terms &
 * Conditions" shortened to "Terms") AND the follow-up request to remove the
 * main menu and the home page's "Shop the essentials" section.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-header-and-menu.php && php r.php
 *
 * COMBINED RATHER THAN TWO SEPARATE PUBLISHERS. Neither of the two earlier,
 * per-batch publishers (publish-header-polish.php, and the one that would
 * have followed for the menu removal) had a chance to run before the menu
 * request landed — sporta-ui.css and sw.js were touched by BOTH batches in
 * sequence, so publishing them separately in order would work, but shipping
 * once from the current HEAD is simpler and cannot leave the two batches
 * ordered wrongly relative to each other.
 *
 * WHAT THIS SHIPS. Six files: nav-menu.js (shortened "Terms" label + title
 * tooltip), sporta-ui.css (all the header polish rules, PLUS the later
 * "hide the whole main menu" rule), essentials.js (new — removes "Shop the
 * essentials" from the home page), index.html (the new <script> tag),
 * .htaccess (essentials.js added to the no-cache fixed-name list), and
 * sw.js (VERSION bumped once, covering every fixed-name asset either batch
 * touched).
 *
 * NAVIGATION IS NOT LOST when the menu goes: checked, not assumed, that the
 * footer already carries its own copy of every link the header's menu had.
 *
 * Verified locally by scripts/header-polish-test.mjs and
 * scripts/menu-essentials-removed-test.mjs, both mutation-tested. Also
 * fixed, in the same span of work, a real pre-existing bug the essentials
 * file's first name (hide-essentials.js) surfaced in
 * scripts/sw-version-test.mjs itself: its "is this a Vite hash" heuristic
 * was length-only and had been silently excluding panel-settings.js from
 * the watched list since that file was created. That fix touches only
 * scripts/, not anything shipped here.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin. Every hash below was
 * generated from hash_file('sha256', …) and round-tripped through a
 * strlen() check before this file was written.
 */

$COMMIT = '661d9711b9f5528ee284a5cb76087dcbd000bb6c';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/nav-menu.js'   => 'fb7d1f67ba06a91e67f56ecee47714c2d85634cffa3f31fcbc3db9b7d5220ff3',
    'assets/sporta-ui.css' => 'a12efb22c6060a36bfa2191af2ec638283b1534964080cd5b5b3dfe8aa897363',
    'assets/essentials.js' => '50c0cefbeef79643137826e44561a839bf49d25b7e1a33b6750b2eed97ed4dee',
    'index.html'           => 'dd12341d41986afc74746b4a0a7fc9c0f099ccbc3ed196267cae746bc0531202',
    '.htaccess'            => '10eb08f0e6dccdc1905f0354bfc92a84a5e756f13b8c8ce7652b825b8ed87ec8',
    'sw.js'                => '200d061dcd721dfcd33d1d92c3f9d1e7397fb5d8b878cf808ece39dc95b360ef',
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
[$ec, $en] = $fetch('/assets/essentials.js');

echo 'HEADERMENU wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' css=' . $cc . '/' . $cn
   . ' essjs=' . $ec . '/' . $en
   . "\n";
