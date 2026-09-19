<?php
/**
 * Publish the orange header / menu changes: "Shop" gone, "About" -> Terms.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-nav-menu.php && php r.php
 *
 * WHAT THIS SHIPS. Five files, one feature: sporta-ui.css (orange header,
 * white nav text, hides "Shop" and — conditionally — "About"), the new
 * assets/nav-menu.js (inserts a real <a href="/terms"> replacing "About",
 * since a React Router Link's href cannot be repointed by editing it),
 * index.html (the new <script> tag loading it), .htaccess (nav-menu.js
 * added to the no-cache fixed-name list), and sw.js (VERSION bumped, since
 * nav-menu.js is now the 14th fixed-name asset a returning visitor could
 * otherwise stay pinned to).
 *
 * Verified locally by scripts/nav-menu-test.mjs: both languages, the real
 * navigation (not just markup) to confirm the replacement actually opens
 * /terms, and the graceful-degradation path with the script blocked.
 * Mutation-tested three ways.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = 'ce390039d974ee485a0cf695bbfcf3845213e4f0';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/nav-menu.js'   => '2ee0030fb0ef9decfb16511aed06550bcd506a25f8fc4389a955e9be9b3a0a7d',
    'assets/sporta-ui.css' => '4618b9900e204655174fd6fe87fc88e41afc4b389ad190e636c5803b2ed8ae59',
    'index.html'           => 'f221a633279bfb5e3a818f6c5d258cf0fe6aceb8a5b329446ec901d6104e422c',
    '.htaccess'            => '6e30e5023958568dfcbdb293d89db7182a58ec87d7a336e3e2329dcaa3055990',
    'sw.js'                => '148826ae35c042dfd9123f480f09d48f3d83007707c39fee038114ed79139834',
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
[$nc, $nn] = $fetch('/assets/nav-menu.js');

echo 'NAVMENU wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' navjs=' . $nc . '/' . $nn
   . "\n";
