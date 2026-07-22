<?php
// Start a CBK T-Pay payment.
//   GET/POST: amount=12.500 & trackid=ORDER123
// Redirects the customer's browser to the CBK hosted payment page.

declare(strict_types=1);
require __DIR__ . '/knet.php';
$cfg = require __DIR__ . '/config.php';

$amount  = trim((string)($_REQUEST['amount']  ?? ''));
$trackid = trim((string)($_REQUEST['trackid'] ?? ''));

if ($amount === '' || $trackid === '') {
    http_response_code(400);
    exit('amount and trackid are required');
}

// KNET/CBK request fields.
$trandata = knet_build_trandata([
    'id'           => $cfg['tranportal_id'],
    'password'     => $cfg['tranportal_password'],
    'action'       => $cfg['action'],
    'langid'       => $cfg['language'],
    'currencycode' => $cfg['currency_code'],
    'amt'          => $amount,
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
    'trackid'      => $trackid,
    'udf1'         => (string)($_REQUEST['udf1'] ?? ''),
    'udf2'         => (string)($_REQUEST['udf2'] ?? ''),
    'udf3'         => (string)($_REQUEST['udf3'] ?? ''),
    'udf4'         => (string)($_REQUEST['udf4'] ?? ''),
    'udf5'         => (string)($_REQUEST['udf5'] ?? ''),
]);

try {
    $encrypted = knet_encrypt($trandata, $cfg['resource_key']);
} catch (Throwable $e) {
    http_response_code(500);
    exit('Payment init failed');
}

$params = http_build_query([
    'trandata'     => $encrypted,
    'tranportalId' => $cfg['tranportal_id'],
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
]);

header('Location: ' . $cfg['gateway_url'] . '?' . $params, true, 302);
exit;
