<?php
// Start a KNET payment.
//   GET/POST: amount=1.500 & trackid=ORDER123 (unique) [& udf1..5]
// Builds the encrypted trandata and posts the customer to KNET's hosted page.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
$cfg = require __DIR__ . '/config.php';

$amount  = trim((string)($_REQUEST['amount']  ?? ''));
$trackid = trim((string)($_REQUEST['trackid'] ?? ''));

// Strict validation (also blocks injection into the trandata string).
if (!preg_match('/^\d{1,7}(\.\d{1,3})?$/', $amount) || (float) $amount <= 0) {
    http_response_code(400);
    exit('Invalid amount.');
}
if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $trackid)) {
    http_response_code(400);
    exit('Invalid track id.');
}

// Server-side price authority: charge the order's stored amount when the DB is
// configured, never a client-sent amount.
$serverAmount = knet_order_amount($cfg, $trackid);
if ($serverAmount !== null) {
    if ((float) $serverAmount <= 0) {
        http_response_code(400);
        exit('Order has no payable amount.');
    }
    $amount = number_format((float) $serverAmount, 3, '.', '');
}

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
    exit('Payment init failed.');
}

$params = http_build_query([
    'trandata'     => $encrypted,
    'tranportalId' => $cfg['tranportal_id'],
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
]);

header('Location: ' . knet_gateway_url($cfg) . '?' . $params, true, 302);
exit;
