<?php
/**
 * What Content-Security-Policy does the live server send for the home page,
 * and does it name the hash of the inline boot script it is serving?
 *
 * READ-ONLY. It fetches over the loopback and prints no configuration value.
 *
 * WHY. index.html's inline script decides the language, pins the theme and
 * caches the hero height BEFORE the first paint. It is allowed by a sha256 in
 * .htaccess, so EDITING THE SCRIPT WITHOUT UPDATING THE HASH makes the live
 * server refuse to run it — silently, with no error the owner would ever see,
 * and with symptoms (a page that flips from English to Arabic, a theme that
 * does not stick) that look like anything but a security header.
 *
 * The live .htaccess is NOT the repository's — a restore rolled it back — so
 * the question has to be asked of the server rather than read here.
 */
$root = '/home/u130124229/domains/sporta.com.kw/public_html';

$ch = curl_init('https://127.0.0.1/');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$res  = (string) curl_exec($ch);
$hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$headers = substr($res, 0, $hlen);
$body    = substr($res, $hlen);

// Every sha256 the policy allows.
preg_match('/content-security-policy:([^\r\n]*)/i', $headers, $m);
$csp = $m[1] ?? '';
preg_match_all("/'sha256-([A-Za-z0-9+\/=]+)'/", $csp, $mm);
$allowed = $mm[1] ?? [];

// Every inline script the page actually carries, hashed the way a browser does.
preg_match_all('/<script(?![^>]*\ssrc=)[^>]*>(.*?)<\/script>/s', $body, $sm);
$missing = 0; $found = 0;
foreach ($sm[1] as $s) {
    $h = base64_encode(hash('sha256', $s, true));
    if (in_array($h, $allowed, true)) $found++; else $missing++;
}

echo 'CSPLIVE home=' . strlen($body)
   . ' policy=' . ($csp === '' ? 'NONE' : 'present')
   . ' hashesAllowed=' . count($allowed)
   . ' inlineScripts=' . count($sm[1])
   . ' allowed=' . $found . ' BLOCKED=' . $missing
   . ' htaccessBytes=' . (is_file($root . '/.htaccess') ? filesize($root . '/.htaccess') : 0)
   . "\n";
