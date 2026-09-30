<?php
/**
 * Publish the full-size hero: the whole banner at every width.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-full-size.php && php r.php
 *
 * WHAT THIS SHIPS. Four files: sporta-ui.css (the hero box is the artwork's
 * own 2.52:1 at every width — our 1.90 ratio, the 60svh cap and the
 * min-height floor are gone, and max-height: none also clears the bundle's
 * own md:max-h-[80svh]), index.html (the boot shell carries the same one-term
 * formula, or the pre-paint shell and the mounted hero disagree and the page
 * jumps at mount), .htaccess (the boot script's CSP sha256, which MOVED
 * because that script was edited — a stale hash means the live server
 * silently refuses to run it), and sw.js (VERSION bumped, since sporta-ui.css
 * has a fixed name and a returning visitor would otherwise keep the copy they
 * already hold).
 *
 * ORDER MATTERS, and sw.js is LAST for the reason the file itself gives: the
 * bump is what frees a cached sporta-ui.css, so it must not land before the
 * stylesheet it is freeing people onto.
 *
 * .htaccess IS IN THIS LIST FOR A REASON. Publishing index.html without it
 * leaves the server sending the old hash for a script whose bytes changed, and
 * the symptom is not an error — it is a page that flips language, a theme that
 * does not stick and a hero that jumps, with one console line nobody reads.
 *
 * Verified locally by scripts/hero-size-test.mjs at eight viewports: the box
 * ratio equals the artwork's everywhere (100% of the banner visible, against
 * 75-94% before), and the shell matches the mounted hero to the pixel.
 * Mutation-tested in both directions.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin.
 */

$COMMIT = '92875b19addb4908d5c2f5c1da7c502e683e7167';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => 'a6d967a1a3f59c2dea05a238ffdc6a8e41154aadd92c9df1aa15ef33eee1ffcd',
    'index.html'           => '8e14c2f145b76cdbc32c5513fa57276aa8df98e676d9a555badab517ed54ee3c',
    '.htaccess'            => '9b3e5101389262f7bca894d1f612979b5a07d685067ddd958dad1939e9d18d46',
    'sw.js'                => '6e8a6e66dd54ecb874d68884b38bdd035cd685c5b85bae6e4f415cfc1fc0156c',
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
    else { $failed[] = $rel . '/write'; break; }   // stop: the order is the safety
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
    return [$code, (string) $out];
};

[$hc, $home] = $fetch('/');
[$cc, $css]  = $fetch('/assets/sporta-ui.css');

// The two numbers that decide whether this actually took, asked of the server
// rather than assumed from the write: the stylesheet must carry the one-term
// formula, and the page must carry the matching boot value. If either says
// 2.10 or 1.90 the publish landed on top of something older.
$cssOneTerm  = (strpos($css, 'calc(100vw / 2.52)') !== false) ? 'yes' : 'NO';
$cssOldRatio = (strpos($css, '100vw / 2.10') !== false || strpos($css, '1.90 / 1') !== false) ? 'STILL-THERE' : 'gone';
$htmlBoot    = (strpos($home, 'calc(100vw / 2.52 + 104px)') !== false) ? 'yes' : 'NO';

echo 'HEROFULL wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . strlen($home)
   . ' css=' . $cc . '/' . strlen($css)
   . ' cssOneTerm=' . $cssOneTerm
   . ' oldRatio=' . $cssOldRatio
   . ' htmlBoot=' . $htmlBoot
   . "\n";
