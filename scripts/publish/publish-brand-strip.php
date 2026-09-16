<?php
/**
 * Publish the brand-logo strip under the home page's hero carousel.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-brand-strip.php && php r.php
 *
 * WHAT THIS SHIPS. Four files, one feature: the new assets/brand-strip.js
 * (reads ?r=brands, inserts a logo row directly after the hero — nothing new
 * asked of the server, has_logo/logo_v are the same fields brand-badge.js
 * already reads off ?r=products), index.html (the new <script> tag loading
 * it), .htaccess (brand-strip.js added to the no-cache fixed-name list), and
 * sw.js (VERSION bumped, since brand-strip.js is now the 15th fixed-name
 * asset a returning visitor could otherwise stay pinned to).
 *
 * RENDERS NOTHING ON THE LIVE SHOP TODAY. The live catalogue has 0 of 8
 * brands with a logo, and the script inserts no section at all when no
 * active brand has one — a heading over an empty row would be worse than no
 * section. This is expected and is not a failed publish.
 *
 * Verified locally by scripts/brand-strip-test.mjs: the zero-logo case
 * first (matching the live shop), then one brand seeded with a logo and one
 * without, checking the strip sits directly after the hero and shows only
 * the one, and the graceful-degradation path with the script blocked.
 * Mutation-tested three ways.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = '6e2afe7b006a785e88076727683c52e613f763d1';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/brand-strip.js' => '6423d2046b973f6c91089cefb75bf409394616dfd5ca4730035c256aecc440ac',
    'index.html'            => '2fb4f74170b1c36475bb9663e7133012890f6427954aa185e6e4a3cfac51651b',
    '.htaccess'             => 'b761b34ce684466951896d7a87cd899f629f8f6de45747f3670fc4cbe7010227',
    'sw.js'                 => '6242019647b896896ed0f75452ab6c90c95bf23baf4712749ee6cb1cb67a3b48',
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

// The shop still answers, and the new asset is actually reachable.
[$hc, $hn] = $fetch('/');
[$sc, $sn] = $fetch('/assets/brand-strip.js');

echo 'BRANDSTRIP wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' stripjs=' . $sc . '/' . $sn
   . "\n";
