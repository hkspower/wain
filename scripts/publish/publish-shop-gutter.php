<?php
/**
 * Publish the shop's desktop page gutter.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-shop-gutter.php && php r.php
 *
 * WHAT THIS SHIPS. Two files: sporta-ui.css, which adds one rule giving every
 * `main .max-w-7xl` a 1.5rem inline padding at 768px and up, and sw.js, whose
 * VERSION is bumped because sporta-ui.css has a fixed name and a returning
 * visitor would otherwise keep the copy they already hold.
 *
 * WHY. The bundle gives its wide containers `px-4 md:px-6`, and /shop's
 * carried `px-4` alone — 16.8px against the home page's and the wishlist's
 * 25.2px, so the product grid stepped outwards when a shopper left the home
 * page. Every other max-w-7xl already computes to 1.5rem, so this rule changes
 * nothing for them and closes the gap for /shop alone.
 *
 * PHONE UNTOUCHED. The gutter is 16px on every page at 390 including this one,
 * and it is correct; the rule is inside a 768px media query for that reason.
 *
 * ORDER: sw.js LAST, because the bump is what frees the cached stylesheet and
 * must not land before the stylesheet it frees people onto.
 *
 * NO index.html and NO .htaccess: no inline script changed, so no CSP hash
 * moved, and no new file was added to the no-cache list.
 *
 * Verified locally by test:page-gutter in both languages at both widths, plus
 * borders, site-contrast, buttons, shop, hero-size, tile-art and both-modes.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin.
 */

$COMMIT = '19cabc45cbb5a7c6f028d642ed764e4a17f19e33';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => '789e9d499f5245294c6ed1416d19ae7f4f4a4052964589f8691049b6771528b3',
    'sw.js'                => '374952ead1d5ae68732bda7f9f563c5a28d5cb9d0d6bac28247ba216073e01c4',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

// A LINE PER FILE, not one trailing echo. This channel drops the output of a
// job often enough that three publishers today reported nothing while having
// done the work; a line as each file lands survives a run that is cut short.
echo "SHOPGUTTER\n";

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) {
        $same++; echo 'same ' . $rel . "\n"; @ob_flush(); @flush(); continue;
    }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                            CURLOPT_TIMEOUT => 25]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200 || $body === '') {
        $failed[] = $rel; echo 'FETCHFAIL ' . $rel . '/http' . $code . "\n"; break;
    }
    if (hash('sha256', $body) !== $want) {
        $bad[] = $rel; echo 'HASHMISMATCH ' . $rel . "\n"; break;
    }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) {
        @chmod($target, 0644); $wrote++; echo 'wrote ' . $rel . "\n";
    } else {
        $failed[] = $rel; echo 'WRITEFAIL ' . $rel . "\n"; break;
    }
    @ob_flush(); @flush();
}

/* -------------------------------------------------------- verify, live --- */
$fetch = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 10,
    ]);
    $out  = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $out];
};

[$hc, $home] = $fetch('/');
[$cc, $css]  = $fetch('/assets/sporta-ui.css');

// The rule must be in the stylesheet the server actually serves.
$hasRule = (strpos($css, 'main .max-w-7xl') !== false) ? 'yes' : 'NO';

echo 'DONE wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . strlen($home)
   . ' css=' . $cc . '/' . strlen($css)
   . ' gutterRule=' . $hasRule
   . "\n";
