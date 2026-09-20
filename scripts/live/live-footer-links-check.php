<?php
/**
 * Does the LIVE footer's own markup carry the links it should — read-only.
 *
 *   php /home/<user>/live-footer-links-check.php
 *
 * Asked for as "fix all footer links" with no specifics; before changing
 * anything, this asks the live page directly what it actually contains,
 * the same way scripts/live/live-scan.php asks the live server rather than
 * trusting a sandbox reading of it.
 */

$ch = curl_init('https://127.0.0.1/');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$html = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!is_string($html) || $code !== 200) {
    echo "FOOTER fetch=FAILED http=$code\n";
    return;
}

// This is the SERVER-SENT HTML, before the SPA has run — the footer itself
// is painted by client-side JS, so this cannot see the rendered links. What
// it CAN check without a browser: that the shell answers, and that the
// storefront's own JS bundle references are present and 200 individually.
$bundleFiles = [];
if (preg_match_all('/\/assets\/(index-[a-zA-Z0-9_-]+\.(?:js|css))/', $html, $m)) {
    $bundleFiles = array_unique($m[1]);
}
echo "SHELL http=$code bytes=" . strlen($html) . " bundleFiles=" . count($bundleFiles) . "\n";

foreach ($bundleFiles as $f) {
    $ch = curl_init('https://127.0.0.1/assets/' . $f);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false, CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT => 20, CURLOPT_NOBODY => true,
    ]);
    curl_exec($ch);
    $c = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    echo "BUNDLE $f -> $c\n";
}

// The routes the footer's own links point at, checked directly. Fragment
// anchors (#why, #delivery) are client-side scroll targets, not separate
// server routes, so only the page each fragment belongs to is asked.
$routes = ['/about', '/terms', '/privacy', '/contact', '/returns', '/track'];
foreach ($routes as $r) {
    $ch = curl_init('https://127.0.0.1' . $r);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false, CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT => 20, CURLOPT_NOBODY => true,
    ]);
    curl_exec($ch);
    $c = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    echo "ROUTE $r -> $c\n";
}

// The contact route, which is what the social/WhatsApp footer links are
// actually built from — so a wrong live value here explains a "broken" link
// a browser check alone would not: the URL loads fine, it just points
// somewhere the owner did not intend.
$ch = curl_init('https://127.0.0.1/api/api.php?r=contact');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false, CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT => 20,
]);
$contact = curl_exec($ch);
curl_close($ch);
$c = json_decode((string) $contact, true);
echo "CONTACT instagram=" . ($c['instagram'] ?? '(unset)')
   . " tiktok=" . ($c['tiktok'] ?? '(unset)')
   . " whatsapp=" . ($c['whatsapp'] ?? '(unset)') . "\n";
