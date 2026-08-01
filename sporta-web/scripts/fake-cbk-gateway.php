<?php
// A fake CBK T-Pay gateway, for scripts/tpay-test.mjs.
//
// The twin of scripts/fake-knet-bank.php, and it exists for the same reason:
// the real gateway needs live CBK credentials and a network this sandbox does
// not have, and "we think the integration is right" is not something to
// discover in production with a customer's money.
//
// It speaks the three endpoints the dropin actually calls, from the CBK manual:
//
//   POST {base}/ePay/api/cbk/online/pg/merchant/Authenticate
//        -> { Status: "1", AccessToken: "..." }
//   POST {base}/ePay/pg/epay?_v=<token>          the hosted payment page
//   GET  {base}/ePay/api/cbk/online/pg/GetTransactions/{encrp}/{token}
//        -> { Status, TrackId, PaymentId, Amount, ... }
//
// Plain HTTP on purpose: cbk_http() sets CURLOPT_SSL_VERIFYPEER and a TLS
// version, and curl ignores both on an http:// URL — so the transport options
// stay honest in production while the test needs no certificate.
//
// Like the real thing, it AUTHENTICATES: the Basic header must carry the
// configured ClientId:ClientSecret, and Authenticate must also be given the
// right ENCRP_KEY. A wrong credential fails here rather than passing silently.
//
//   php -S 127.0.0.1:8099 -t scripts scripts/fake-cbk-gateway.php

declare(strict_types=1);
$cfg = require __DIR__ . '/../dropin/php-cbk/config.php';

// The "transactions" this gateway knows about, keyed by the encrp handle it
// hands back on the return URL. A file, so the state survives the separate
// requests the flow is made of — exactly as the real gateway's does.
$STORE = sys_get_temp_dir() . '/fake-cbk-txns.json';
$load = fn () => is_file($STORE) ? (json_decode((string) file_get_contents($STORE), true) ?: []) : [];
$save = function (array $t) use ($STORE) { file_put_contents($STORE, json_encode($t)); };

$path = parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '';
$body = json_decode((string) file_get_contents('php://input'), true) ?: [];
$auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? '');

$fail = function (int $code, string $msg) {
    http_response_code($code);
    header('Content-Type: application/json');
    exit(json_encode(['Status' => '0', 'Message' => $msg]));
};

// Every API call carries Basic base64(ClientId:ClientSecret).
if (str_contains($path, '/api/cbk/')) {
    $expect = 'Basic ' . base64_encode($cfg['client_id'] . ':' . $cfg['client_secret']);
    if (!hash_equals($expect, $auth)) $fail(401, 'bad ClientId/ClientSecret');
}

// ------------------------------------------------------------- Authenticate
if (str_ends_with($path, '/merchant/Authenticate')) {
    if (($body['ENCRP_KEY'] ?? '') !== $cfg['encrp_key']) $fail(400, 'bad ENCRP_KEY');
    header('Content-Type: application/json');
    exit(json_encode(['Status' => '1', 'Message' => 'Success', 'AccessToken' => 'FAKETOKEN-' . bin2hex(random_bytes(6))]));
}

// -------------------------------------------------------- the hosted page
// The customer's browser POSTs here from pay.php's auto-submitting form. The
// test drives the outcome with ?outcome= and ?amt=, and the reply carries the
// encrp handle plus the return URL, which is what the test follows.
if (str_contains($path, '/ePay/pg/epay')) {
    $outcome = strtolower((string) ($_GET['outcome'] ?? 'success'));
    $status = ['success' => '1', 'failed' => '2', 'cancelled' => '3'][$outcome] ?? '1';
    $encrp = 'ENC' . bin2hex(random_bytes(8));

    $txns = $load();
    $txns[$encrp] = [
        'Status'        => $status,
        'Message'       => $status === '1' ? 'Success' : 'Declined',
        'TrackId'       => (string) ($_POST['tij_MerchantPaymentTrack'] ?? ''),
        'PaymentId'     => '9' . random_int(100000000, 999999999),
        'TransactionId' => (string) random_int(1000000000, 9999999999),
        'AuthCode'      => $status === '1' ? 'B' . random_int(10000, 99999) : '',
        'ReferenceId'   => (string) random_int(100000000000, 999999999999),
        'ReceiptNo'     => (string) random_int(100000, 999999),
        'PayType'       => (string) ($_POST['tij_MerchPayType'] ?? ''),
        // What the gateway says it charged. ?amt= lets the test under/overpay
        // so the callback's amount check can be proven.
        'Amount'        => (string) ($_GET['amt'] ?? ($_POST['tij_MerchantPaymentAmount'] ?? '')),
        // Echoed back so the test can assert what the merchant actually sent.
        '_sent'         => $_POST,
    ];
    $save($txns);

    header('Content-Type: application/json');
    exit(json_encode([
        'gateway'    => 'fake-cbk',
        'encrp'      => $encrp,
        'return_url' => (string) ($_POST['tij_MerchReturnUrl'] ?? '') . '?encrp=' . $encrp,
        'sent'       => $_POST,
    ], JSON_UNESCAPED_SLASHES));
}

// ------------------------------------------------------- GetTransactions
if (str_contains($path, '/GetTransactions/')) {
    $parts = array_values(array_filter(explode('/', $path)));
    $encrp = rawurldecode((string) ($parts[count($parts) - 2] ?? ''));
    $txns = $load();
    header('Content-Type: application/json');
    if (!isset($txns[$encrp])) exit(json_encode(['Status' => '0', 'Message' => 'unknown transaction']));
    $t = $txns[$encrp];
    unset($t['_sent']);
    exit(json_encode($t));
}

$fail(404, 'no such endpoint: ' . $path);
