<?php
// A fake KNET (KPG) gateway, for scripts/knet-test.mjs.
//
// It speaks the REAL protocol — AES-128-CBC trandata with the fixed
// PGKEYENCDECIVSPC IV, the same field names, the same CAPTURED/NOT CAPTURED
// results — so the integration is exercised rather than mocked. It exists
// because the real bank cannot be reached from a test: kpaytest.com.kw needs
// live Tranportal credentials and a network this sandbox does not have, and
// "we think the encryption is right" is not something to find out in
// production with a customer's money.
//
// It deliberately behaves like the awkward parts of the real thing:
//   * it VALIDATES the tranportal id and password out of the trandata, so a
//     wrong credential fails here rather than silently passing;
//   * it can answer server-to-server (reading REDIRECT= out of the merchant's
//     reply) as well as by browser redirect, because KPG does both and the
//     merchant has to survive either;
//   * it echoes `amt` back, which is what the callback's amount check reads.
//
//   php -S 127.0.0.1:8097 -t scripts   (see knet-test.mjs)

declare(strict_types=1);
require __DIR__ . '/../dropin/php-knet/knet.php';

$cfg = require __DIR__ . '/../dropin/php-knet/config.php';
$in  = $_POST + $_GET;

header('Content-Type: application/json; charset=utf-8');

$trandata = (string) ($in['trandata'] ?? '');
if ($trandata === '') {
    http_response_code(400);
    exit(json_encode(['bank_error' => 'no trandata']));
}

// Decrypt exactly as the bank would. A wrong resource key dies here.
try {
    $fields = knet_parse_response(knet_decrypt($trandata, $cfg['resource_key']));
} catch (Throwable $e) {
    http_response_code(400);
    exit(json_encode(['bank_error' => 'decrypt failed: ' . $e->getMessage()]));
}

// The bank authenticates the merchant on every request.
if (($fields['id'] ?? '') !== $cfg['tranportal_id']
    || ($fields['password'] ?? '') !== $cfg['tranportal_password']) {
    http_response_code(401);
    exit(json_encode(['bank_error' => 'bad tranportal credentials', 'got_id' => $fields['id'] ?? '']));
}

// The test drives the outcome: ?outcome=captured|notcaptured|canceled, and
// ?amt= to overpay/underpay so the callback's amount check can be proven.
$outcome = strtolower((string) ($in['outcome'] ?? 'captured'));
$result  = ['captured' => 'CAPTURED', 'notcaptured' => 'NOT CAPTURED', 'canceled' => 'CANCELED'][$outcome]
    ?? 'CAPTURED';
$amt = (string) ($in['amt'] ?? ($fields['amt'] ?? ''));

$response = knet_build_trandata([
    'paymentid' => '100202' . random_int(100000, 999999),
    'result'    => $result,
    'auth'      => $result === 'CAPTURED' ? 'B35434' : '',
    'ref'       => '90890' . random_int(10000, 99999),
    'tranid'    => (string) random_int(1000000000, 9999999999),
    'postdate'  => gmdate('md'),
    'trackid'   => (string) ($fields['trackid'] ?? ''),
    'udf1'      => (string) ($fields['udf1'] ?? ''),
    'udf2'      => (string) ($fields['udf2'] ?? ''),
    'udf3'      => (string) ($fields['udf3'] ?? ''),
    'udf4'      => (string) ($fields['udf4'] ?? ''),
    'udf5'      => (string) ($fields['udf5'] ?? ''),
    'amt'       => $amt,
    'authRespCode' => $result === 'CAPTURED' ? '00' : '05',
]);
$encrypted = knet_encrypt($response, $cfg['resource_key']);

// Deliver the result to the merchant the way the bank does: POST trandata to
// responseURL, then read REDIRECT= out of the reply and report where the
// customer would be sent. The test asserts on that landing URL, which is
// exactly what a stranded customer would fail to reach.
$target = (string) ($fields['responseURL'] ?? $cfg['response_url']);
$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['trandata' => $encrypted, 'paymentid' => '1']),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    // The real gateway does not follow redirects: it wants the REDIRECT= token
    // in the body. Not following is the whole point of this test.
    CURLOPT_FOLLOWLOCATION => false,
    // The merchant refuses plain HTTP; the proxy header is how Hostinger tells
    // it the edge terminated TLS, and it is how this rig does too.
    CURLOPT_HTTPHEADER     => ['X-Forwarded-Proto: https'],
]);
$body = (string) curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$loc  = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
curl_close($ch);

$landing = '';
if (preg_match('/REDIRECT=(\S+)/', $body, $m)) {
    $landing = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
} elseif ($loc !== '') {
    $landing = $loc;   // a 302-style merchant; the browser would follow it
}

echo json_encode([
    'bank_result'   => $result,
    'merchant_code' => $code,
    'landing'       => $landing,
    'used_token'    => $landing !== '' && str_contains($body, 'REDIRECT='),
], JSON_UNESCAPED_SLASHES);
