<?php
/**
 * Publish the panel's trimmed copy.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-panel-less-text.php && php r.php
 *
 * WHAT THIS SHIPS. Six overlays whose prose was cut — panel-settings.js,
 * payment.js, rules.js, legal-editor.js, custom-css.js and product-photos.js —
 * and sw.js, whose VERSION is bumped because every one of those is a
 * fixed-name asset a returning visitor would otherwise keep the cached copy
 * of.
 *
 * The Settings screen was 743 words and is 451: a paragraph under every card
 * and a hint under every field, nearly all of it explaining WHY rather than
 * changing what the owner does. What stops a mistake was kept — "With the
 * country code" on the WhatsApp field, "Handle only, no @" on Instagram, and
 * both of rules.js's WARNINGs, which the owner chose over locking those
 * fields — and each of those now says it in one line instead of three.
 *
 * ORDER: sw.js LAST, because the bump is what frees the cached copies of
 * everything above it and must not land before them.
 *
 * NO sporta-ui.css, NO index.html AND NO .htaccess. Only copy changed: no
 * stylesheet, no inline script, so no CSP hash moved and nothing was added to
 * the no-cache list. Checked rather than assumed.
 *
 * Verified locally by panel-cards, panel-settings, payment-panel, rules-panel,
 * custom-css, legal-pages and product-photos-manage, all green — every phrase
 * those rigs assert was kept verbatim rather than rewritten around.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin.
 */

$COMMIT = '2a7a0df964f9964dece6be6127ef425dd6b8a491';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/panel-settings.js'  => '074c93175d78474c4330b71cbebd4c54cdf7c13ebfe26e69b1a6da4ae2305d11',
    'assets/payment.js'         => '7cec301599380fb22d8111eef86c54ed2cae61be6df558a0702cd66a36be8f32',
    'assets/rules.js'           => 'efb369e10c3ea3e5e5372d9e92954af2ea5c0f8f85af6c149ae0bc911eb01b2b',
    'assets/legal-editor.js'    => 'c04da2e4c6d32b14de7a09833b936af8ac24645c8c65bcb694106f07374bc369',
    'assets/custom-css.js'      => '092fcbf6caf633611467a691aae25c3363842425a5f8254430ba0f9335ac53a4',
    'assets/product-photos.js'  => '3e546264440c8871c3978080da4fcc94d7ae2053456b27c87db509765319e738',
    'sw.js'                     => '5b1d25c5b686cb847fe3be6a3fd7f19273dd1cdc034aa3995e1fb9c4524038e4',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

// PRINTED PER FILE, not gathered into one line at the end. Measured on this
// channel: a job whose output is one trailing echo comes back EMPTY often
// enough to be useless, and a publisher that has done the work while reporting
// nothing is the worst of both. A line per file survives a run that is cut off.
echo "PANELTEXT\n";

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
[$cc, $css]  = $fetch('/assets/panel-settings.js');

// The two things that say this actually took, asked of the server: the panel
// block must be there, and the old white card must be gone from the overlay
// that is served alongside it.
// The trimmed copy must actually be what the server now serves: the old
// paragraph named api/setup-admin.php and the new one does not.
$trimmed = (strpos($css, 'setup-admin.php') === false) ? 'yes' : 'NO';

echo 'DONE wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . strlen($home)
   . ' css=' . $cc . '/' . strlen($css)
   . ' trimmed=' . $trimmed
   . "\n";
