<?php
/**
 * Publish the payment-setup card on the website panel's Settings screen.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-payment-setup.php && php r.php
 *
 * WHAT THIS SHIPS. Four files, one feature: assets/payment.js (the KNET
 * Tranportal ID editor and the CBK gateway's own readiness — pay/config.php's
 * env/ready and which of the three credentials are set, booleans only, never
 * the values), index.html (the new <script> tag loading it), .htaccess
 * (payment.js added to the no-cache fixed-name list, the twentieth), and
 * sw.js (VERSION bumped — both for the new asset and because sporta-ui.css
 * had changed since the last bump, from the category-tile revert).
 *
 * Verified locally by scripts/payment-panel-test.mjs against the sandbox:
 * card scoping (Settings only, never before sign-in), the CBK-value non-leak,
 * a real Tranportal ID save round-tripped through MariaDB, both server
 * refusal messages surfaced by name with the typing preserved, and clearing
 * the box handing control back to knet/config.php. Mutation-tested the leak
 * check by making the card print a real credential value — caught.
 *
 * $COMMIT pins the ARTIFACTS; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = '9ce87bc8c4b9a51e1f30dd613af739efefa87b78';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/payment.js' => 'a190c75f169ebb71d84eef4321966985e6c182d22d731c12a1bd70d7c5ecc40f',
    'index.html'        => '717f53cf034bd2cb5582cc49eae8353ce6c656fb9480e5bd4afa4fc52429b4a0',
    '.htaccess'         => '84a3e44a197792204ab5d78c27f4277f3ac1a0952f25d8edecfeeb67ced2082e',
    'sw.js'             => 'a2f71b30b8ddf219a9774d081cd5cf83def892bf62f58b5ed0f2958433688089',
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
    return [$code, strlen($out)];
};

[$hc, $hn] = $fetch('/');
[$pc, $pn] = $fetch('/assets/payment.js');

echo 'PAYMENTSETUP wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hn
   . ' paymentjs=' . $pc . '/' . $pn
   . "\n";
