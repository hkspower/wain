<?php
// Start a KNET payment.
//   GET/POST: amount=1.500 & trackid=ORDER123 (unique) [& udf1..5]
// Builds the encrypted trandata and posts the customer to KNET's hosted page.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
$cfg = require __DIR__ . '/config.php';

// Read only GET/POST explicitly — $_REQUEST's contents depend on the
// request_order ini setting and can include cookies on some configurations.
$in      = $_POST + $_GET;
$amount  = trim((string)($in['amount']  ?? ''));
$trackid = trim((string)($in['trackid'] ?? ''));

// The bank page has an Arabic face and the storefront already knows which one
// the shopper is reading — checkout.js sends ?lang=. Ignoring it sent every
// Arabic customer to an English card form on an Arabic-first shop. Only the
// two values KNET accepts are honoured; anything else falls back to config.
$langIn = strtoupper(trim((string)($in['lang'] ?? '')));
$langid = in_array($langIn, ['AR', 'EN'], true) ? $langIn : (string) $cfg['language'];

// Strict validation (also blocks injection into the trandata string).
if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $trackid)) {
    http_response_code(400);
    exit('Invalid track id.');
}
// `amount` is OPTIONAL. The correct flow — api/?r=order and the Flutter app —
// links to pay.php?trackid=... with no amount at all, because the price comes
// from the order. Requiring it here rejected exactly the flow that is safe.
// It is still validated when present, and it is only ever USED when there is
// no orders database to price the order from.
if ($amount !== '' && (!preg_match('/^\d{1,7}(\.\d{1,3})?$/', $amount) || (float) $amount <= 0)) {
    http_response_code(400);
    exit('Invalid amount.');
}

// ---------------------------------------------------------------------------
// Server-side price authority — FAIL CLOSED.
//
// When the orders database is configured, the amount charged is ALWAYS the
// stored order total. If the order cannot be found or the database cannot be
// reached, the payment is refused rather than falling back to the amount the
// browser sent: that fallback let anyone pay any price by inventing a track id
// (/pay.php?amount=0.100&trackid=ANYTHING).
// ---------------------------------------------------------------------------
$lookup = knet_order_lookup($cfg, $trackid);

if ($lookup['state'] === 'missing') {
    knet_log($cfg, 'pay.reject', ['reason' => 'order_not_found', 'trackid' => $trackid, 'asked' => $amount]);
    http_response_code(404);
    exit('Unknown order.');
}
if ($lookup['state'] === 'error') {
    knet_log($cfg, 'pay.reject', ['reason' => 'order_lookup_failed', 'trackid' => $trackid]);
    http_response_code(503);
    exit('Could not verify the order right now. Please try again in a moment.');
}
if ($lookup['state'] === 'found') {
    if ((string) $lookup['status'] === 'paid') {
        knet_log($cfg, 'pay.reject', ['reason' => 'already_paid', 'trackid' => $trackid]);
        http_response_code(409);
        exit('This order has already been paid.');
    }
    if ((float) $lookup['amount'] <= 0) {
        knet_log($cfg, 'pay.reject', ['reason' => 'zero_amount', 'trackid' => $trackid]);
        http_response_code(400);
        exit('Order has no payable amount.');
    }
    $amount = number_format((float) $lookup['amount'], 3, '.', '');
}
if ($lookup['state'] === 'off') {
    // No orders database: the browser's amount is the only figure available,
    // so it must at least be present and well formed. See config.example.php —
    // running a live storefront in this mode means the browser sets the price.
    if ($amount === '') {
        http_response_code(400);
        exit('Invalid amount.');
    }
}

$trandata = knet_build_trandata([
    'id'           => $cfg['tranportal_id'],
    'password'     => $cfg['tranportal_password'],
    'action'       => $cfg['action'],
    'langid'       => $langid,
    'currencycode' => $cfg['currency_code'],
    'amt'          => $amount,
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
    'trackid'      => $trackid,
    'udf1'         => (string)($in['udf1'] ?? ''),
    'udf2'         => (string)($in['udf2'] ?? ''),
    'udf3'         => (string)($in['udf3'] ?? ''),
    'udf4'         => (string)($in['udf4'] ?? ''),
    'udf5'         => (string)($in['udf5'] ?? ''),
]);

try {
    $encrypted = knet_encrypt($trandata, $cfg['resource_key']);
} catch (Throwable $e) {
    knet_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);
    http_response_code(500);
    exit('Payment init failed.');
}

knet_log($cfg, 'pay.init', [
    'trackid' => $trackid,
    'amount'  => $amount,
    'source'  => $lookup['state'] === 'found' ? 'server' : 'client-no-db',
]);

$params = http_build_query([
    'trandata'     => $encrypted,
    'tranportalId' => $cfg['tranportal_id'],
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
]);

header('Location: ' . knet_gateway_url($cfg) . '?' . $params, true, 302);
exit;
