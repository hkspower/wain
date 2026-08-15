<?php
// Does cbk_http() actually refuse a certificate it cannot verify?
//
// This exists because CBK's own reference implementation
// (PGPaymentRequestHosted.php / PGPaymentResultHosted.php) sets
//
//     CURLOPT_SSL_VERIFYHOST => 0,
//     CURLOPT_SSL_VERIFYPEER => 0,
//
// on the Authenticate call — the one request that carries the ClientSecret and
// the ENCRP_KEY. With both off, curl will hand those credentials to anything
// that answers on the address, which is the entire threat that TLS exists to
// stop. It is in the vendor sample, so it is exactly the kind of line that
// gets copied in during a "make it match the bank's example" pass.
//
// So: point cbk_http() at an HTTPS server whose certificate is self-signed and
// assert that it fails. Prints the HTTP status cbk_http returned — 0 means
// curl refused to complete the request, which is the answer we want.
//
//   php scripts/tls-probe.php https://127.0.0.1:8102/
declare(strict_types=1);
require __DIR__ . '/../dropin/php-cbk/cbk.php';

$url = $argv[1] ?? 'https://127.0.0.1:8102/';
$cfg = ['client_id' => 'x', 'client_secret' => 'y'];

[$status] = cbk_http('GET', $url, $cfg, null, false);
echo $status, "\n";
