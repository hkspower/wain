<?php
/**
 * Publish the policy-pages editor: Privacy, Terms and Returns become
 * owner-editable, from a new card on the website panel's Settings screen.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-legal-pages.php && php r.php
 *
 * WHAT THIS SHIPS. Eight files: three server-side PHP (store.php's new
 * `legal` settings default, api.php's new cacheable ?r=legal read, and
 * admin.php's new settings_save branch for it), two new overlay scripts
 * (legal-pages.js swaps the text into Privacy/Terms/Returns on the
 * storefront; legal-editor.js adds the editor card to the panel's Settings
 * screen), index.html (the two new <script> tags), .htaccess (both added
 * to the no-cache fixed-name list), and sw.js (VERSION bumped, since both
 * are now fixed-name assets a returning visitor could otherwise stay
 * pinned to).
 *
 * RENDERS NO VISIBLE CHANGE ON THE LIVE SHOP TODAY. Every field of the new
 * `legal` setting defaults to empty, and empty means "use the bundle's own
 * text" — the same rule contact and footer already follow. Nothing changes
 * on Privacy, Terms or Returns until an owner actually writes something in
 * the new Settings-screen card.
 *
 * Verified locally by scripts/legal-pages-test.mjs, which saves through the
 * REAL panel UI (signs in, opens Settings, types into the actual textarea,
 * clicks the actual Save button) rather than posting JSON straight at
 * admin.php. Mutation-tested three ways: the paragraph split broken, the
 * "empty means leave alone" guard removed on Returns, and the Returns
 * selector widened to the whole section (which would have overwritten the
 * order-lookup box). All caught.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin. Every hash below was
 * generated from `hash_file('sha256', …)` and round-tripped through a
 * strlen() check before this file was written, after two earlier
 * publishers in this project shipped a hash with its last character
 * dropped in hand transcription.
 */

$COMMIT = 'b203d88fe4570706591186e7a1f1cb59a7535a26';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php' => '4c2eb33862105a52ae5d42387d2d029590315074cf66441b3273aaf97b114bf7',
    'api/api.php' => '54c2f3120308fa010c5b489217f9cf25b7de55f73afafc8ea51d40016615cc57',
    'api/store.php' => '2c9e526ffbd205a280509ceedf2e8444f890a8f612b9bf08fd2ae706135dcc8b',
    'assets/legal-editor.js' => '7f24859164f2b03cb6a3b2be1af8612478a9548a27c897428edd1f31f3586383',
    'assets/legal-pages.js' => '0137d5a0971698f000015a8077c2c20582b2a2681a95d06a110c239ff8884dcf',
    'index.html' => '6a8800d39bd44cae98328dd85d73372cccc3a85cc2dc5d7bae41e099ce9aef6a',
    '.htaccess' => 'd3fe0484443647cd6f8a746364d3f4cbe70ffa61598da0b3067a4433bbedba4c',
    'sw.js' => '7484d4be925d05d2d007014da6d2d35a620e5a89127c381538f84eae27d97799',
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

// The shop still answers, the new public route answers, Privacy still
// loads, and the panel still loads.
[$hc, $hn] = $fetch('/');
[$lc, $ln] = $fetch('/api/api.php?r=legal');
[$pc, $pn] = $fetch('/privacy');
[$bc, $bn] = $fetch('/backends');

echo 'LEGALPAGES wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' legal=' . $lc . '/' . $ln
   . ' privacy=' . $pc . '/' . $pn
   . ' backends=' . $bc . '/' . $bn
   . "\n";
