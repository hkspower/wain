<?php
/**
 * Publish bigger touch targets for the website panel, on a phone.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-admin-mobile.php && php r.php
 *
 * WHAT THIS SHIPS. Four files: the new assets/admin-mobile.js (grows three
 * under-44px panel controls — rules.js's chips, custom-css.js's Save/Undo/
 * Clear — to a proper touch target under `@media (pointer: coarse)`, with
 * `!important` because those two cards' own <style> tags land in <head>
 * AFTER this one and would otherwise win by document order), index.html
 * (the new <script> tag), .htaccess (added to the no-cache fixed-name
 * list), and sw.js (VERSION bumped, since it is now a fixed-name asset a
 * returning visitor could otherwise stay pinned to).
 *
 * A MOUSE SEES NO CHANGE AT ALL. The rule only matches under `pointer:
 * coarse`, so nothing on a desktop admin session moves — verified locally
 * in both directions by scripts/admin-mobile-test.mjs.
 *
 * Mutation-tested three ways: !important removed (reproduces the measured
 * bug — the panel's own cards mount after this style tag and win by
 * document order), the pointer:coarse gate removed (would have changed the
 * desktop panel too), and the Save-button selector pointed at the wrong
 * class. All caught.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin. Every hash below was
 * generated from hash_file('sha256', …) and round-tripped through a
 * strlen() check before this file was written.
 */

$COMMIT = '7d872021c73500f4e78a0f66ecc0e22fef965938';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/admin-mobile.js' => 'd464a8af25dbf11da2d78ffe657daea06e908b891de0a073b9eaa02b7489948f',
    'index.html'             => 'b83312d3a8de0cd4be7055af4f783d67ce6c1b57d2664bb4e0219f2532cbc03e',
    '.htaccess'              => '60b36353aa9559c730a4afdb5ca7d7f4875c7b6b7d7d8431d6e7d02d5357c13f',
    'sw.js'                  => '3615809e2232d8f23398cd706cf7e9c44c5beae5dbf0324160a20eb889cff26b',
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
[$ac, $an] = $fetch('/assets/admin-mobile.js');
[$bc, $bn] = $fetch('/backends');

echo 'ADMINMOBILE wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' mobilejs=' . $ac . '/' . $an
   . ' backends=' . $bc . '/' . $bn
   . "\n";
