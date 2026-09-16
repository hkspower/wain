<?php
/**
 * Publish the admin-panel recolour: theme.js now paints /backends too.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-admin-theme.php && php r.php
 *
 * WHAT THIS SHIPS. Two files: theme.js (maps AdminApp-*.js's hardcoded
 * indigo Tailwind classes onto whichever brand colour the theme editor has
 * set, via attribute selectors so no colon needs escaping) and sw.js
 * (VERSION bumped, since theme.js is a fixed-name asset a returning visitor
 * could otherwise stay pinned to).
 *
 * RENDERS NO VISIBLE CHANGE ON THE LIVE SHOP TODAY unless a brand colour is
 * already set in the theme editor — the block is a no-op when t.brand is
 * empty, same as every other field in this file. If the owner has never
 * opened the theme editor, the panel stays exactly as shipped (indigo).
 *
 * Verified locally by scripts/admin-theme-test.mjs: with no theme set the
 * panel is unchanged (measured against its own baseline, not a hardcoded
 * literal — Chromium reports this indigo in lab() notation, not rgb()),
 * with a theme set the panel follows it, and clearing the theme reverts it
 * exactly. Mutation-tested two ways.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = '2f6401f3e678831e5238869aff8fda4dabb8f483';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/theme.js' => '2cf8b9f8d7306d6da217827e7b0f88e61a551d65296fad28518d2f2a4d84a205',
    'sw.js'           => 'fcde33ec9697af4e84e22dfdb92b5107803a3185ba72e7703d7c73d5115ee547',
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

// The shop still answers, and the panel still loads.
[$hc, $hn] = $fetch('/');
[$bc, $bn] = $fetch('/backends');

echo 'ADMINTHEME wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' backends=' . $bc . '/' . $bn
   . "\n";
