<?php
/**
 * Publish the panel's one card shape and one direction.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-panel-cards.php && php r.php
 *
 * WHAT THIS SHIPS. Nine files: sporta-ui.css (the .admin-shell block — the
 * panel's LTR direction and the card tokens, read off the bundle's own card),
 * the seven overlays that now reference those tokens instead of three
 * different sets of hardcoded pixels, and sw.js (VERSION bumped, since every
 * one of these is a fixed-name asset a returning visitor would otherwise keep
 * the cached copy of).
 *
 * payment.js ALSO CHANGES PREFIX, spp-* to spk-*, and that is the correctness
 * half rather than the cosmetic one: it shared both the `.spp` prefix and the
 * `spp-css` <style> element id with product-photos.js, and each overlay skips
 * injecting its stylesheet when that id is already present. So whichever
 * mounted first won and the other card rendered in the wrong overlay's rules —
 * visible only if you happened to open Catalogue before Settings.
 *
 * ORDER: sw.js LAST, as always, because the bump is what frees the cached
 * copies of everything above it and must not land before them.
 *
 * NO index.html AND NO .htaccess this time — no inline script changed, so no
 * CSP hash moved, and no new file was added to the no-cache list. Checked
 * rather than assumed; test:csp and test:htaccess are both green on this
 * commit.
 *
 * Verified locally by scripts/panel-cards-test.mjs: the panel is LTR, every
 * overlay card carries the bundle's own padding and radius, none is a white
 * slab, no two overlays share a style id or a class prefix, and the Catalogue's
 * 46 Arabic product names still render right-to-left inside the LTR panel.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin.
 */

$COMMIT = '1ae26f4d1d970d4b4bec0cd81a7e26c8e2e4c38f';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css'      => '2d2b6cfe8c3ab2aea7e2d60b2fd35a32190089231162a69ec2b8898adff16dab',
    'assets/payment.js'         => 'd509b7a044cecc1972c78fa1594d5cc14bfba6f814a688c5789f0940f77b4c71',
    'assets/panel-settings.js'  => '9ba316cb7561e04bcd8d0ba7cddc2674375ae568d6ad6e5b22d312b2a5d4f6b5',
    'assets/legal-editor.js'    => 'c42934c8ece878afaf973d6860f985d0e1297224bfb8023fb4d7f3fe60cf84b4',
    'assets/rules.js'           => 'e7235f59273b8f04cb3d7417de06745b3aff1ec4c26699e3f5d0c77a7cd86d9a',
    'assets/brand-logos.js'     => '857b1af9d9c239ee99607155989c69ad2cfc514a24fa21413ed3653e5b7b9caa',
    'assets/product-photos.js'  => '37054ce6f56d983a7b9f8f95318ecd23e6d5177de4aceeafcbff683be983208a',
    'assets/custom-css.js'      => '99d9ff452d76eb7f24f9f5ae2bdf3c4d42ec03178755ae70e16b6727028cd45a',
    'sw.js'                     => 'e6a6d691d7bbfe55560b15cdd7580ee87e9034b36806f0438f34fc47a276f15c',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

// PRINTED PER FILE, not gathered into one line at the end. Measured on this
// channel: a job whose output is one trailing echo comes back EMPTY often
// enough to be useless, and a publisher that has done the work while reporting
// nothing is the worst of both. A line per file survives a run that is cut off.
echo "PANELCARDS\n";

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
        $failed[] = $rel; echo 'WRITEFAIL ' . $rel . "\n"; break;  // the order is the safety
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

// The two things that say this actually took, asked of the server: the panel
// block must be there, and the old white card must be gone from the overlay
// that is served alongside it.
$hasShell = (strpos($css, '.admin-shell') !== false && strpos($css, '--sp-pc-pad') !== false) ? 'yes' : 'NO';

echo 'DONE wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . strlen($home)
   . ' css=' . $cc . '/' . strlen($css)
   . ' panelBlock=' . $hasShell
   . "\n";
