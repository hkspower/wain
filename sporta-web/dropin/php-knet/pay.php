<?php
// Start a KNET payment.
//   GET/POST: trackid=ORDER123 (unique) [& lang=ar|en]
// Builds the encrypted trandata and posts the customer to KNET's hosted page.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
// ONE SETUP FOR BOTH: if the T-Pay (CBK hosted) config has `knet_via_cbk` on,
// KNET is taken there with PayType 1 — same ClientId/Secret/ENCRP_KEY, no
// Tranportal credentials. The customer is handed to /pay/pay.php with the same
// track id (the storefront only knows this URL); the order stays a KNET order.
// Off, missing or unreadable all mean "carry on with classic KNET below".
$cbkSwitch = (static function (): bool {
    try {
        $p = knet_config_path('tpay', dirname(__DIR__) . '/pay/config.php');
        if (!is_file($p)) return false;
        $c = require $p;
        return is_array($c) && !empty($c['knet_via_cbk']);
    } catch (Throwable $e) {
        return false;
    }
})();
if ($cbkSwitch) {
    $handoffTrack = trim((string) (($_POST + $_GET)['trackid'] ?? ''));
    $handoffLang = strtolower(trim((string) (($_POST + $_GET)['lang'] ?? '')));
    $to = '/pay/pay.php?trackid=' . rawurlencode($handoffTrack)
        . ($handoffLang === 'ar' || $handoffLang === 'en' ? '&lang=' . $handoffLang : '');
    header('Location: ' . $to, true, 302);
    exit;
}
$cfg = knet_with_store_db(knet_load_config(__DIR__ . '/config.php'));

// Ten starts a minute per client, before anything else is read. Every start
// that gets through is one paymentInit redirect to the bank and one line in the
// payment log, and none of it needs more than a track id — so with no limit a
// loop here grew the log (on the private mount that also holds the admin
// sessions) and hammered the bank. The T-Pay twin has the same limit. See also
// KNET_MAX_ATTEMPTS, the ceiling per ORDER. A shopper retrying a declined card
// starts a handful of times in a minute at most.
if (($rate = knet_rate_hit($cfg, 'knet_pay', 10, 60)) !== null && !$rate['allowed']) {
    knet_rate_refuse($rate, 'Too many payment attempts. Please wait a minute and try again.');
}

// Read only GET/POST explicitly — $_REQUEST's contents depend on the
// request_order ini setting and can include cookies on some configurations.
$in      = $_POST + $_GET;
$trackid = trim((string)($in['trackid'] ?? ''));

// The bank page has an Arabic face and the storefront already knows which one
// the shopper is reading — checkout.js sends ?lang=. Ignoring it sent every
// Arabic customer to an English card form on an Arabic-first shop. Only the
// two values KNET accepts are honoured; anything else falls back to config.
$langIn = strtolower(trim((string)($in['lang'] ?? '')));
$configuredLang = strtoupper((string)($cfg['language'] ?? 'USA'));
if ($configuredLang === 'EN') $configuredLang = 'USA'; // legacy config value
$langid = $langIn === 'ar' ? 'AR' : ($langIn === 'en' ? 'USA' : $configuredLang);

// Strict validation (also blocks injection into the trandata string).
if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $trackid)) {
    http_response_code(400);
    exit('Invalid track id.');
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

if ($lookup['state'] === 'off') {
    knet_log($cfg, 'pay.reject', ['reason' => 'orders_database_not_configured', 'trackid' => $trackid]);
    http_response_code(503);
    exit('Payment service is not configured.');
}
if ($lookup['state'] === 'missing') {
    knet_log($cfg, 'pay.reject', ['reason' => 'order_not_found', 'trackid' => $trackid]);
    http_response_code(404);
    exit('Unknown order.');
}
if ($lookup['state'] === 'error') {
    knet_log($cfg, 'pay.reject', ['reason' => 'order_lookup_failed', 'trackid' => $trackid]);
    http_response_code(503);
    exit('Could not verify the order right now. Please try again in a moment.');
}
if ($lookup['state'] === 'found') {
    if ((string) $lookup['method'] !== 'knet') {
        knet_log($cfg, 'pay.reject', [
            'reason' => 'wrong_payment_method', 'trackid' => $trackid,
            'method' => (string) $lookup['method'],
        ]);
        http_response_code(409);
        exit('This order is not payable by KNET.');
    }
    $paymentStatus = (string) $lookup['status'];
    if ($paymentStatus === 'paid') {
        knet_log($cfg, 'pay.reject', ['reason' => 'already_paid', 'trackid' => $trackid]);
        http_response_code(409);
        exit('This order has already been paid.');
    }
    if ($paymentStatus === 'review') {
        knet_log($cfg, 'pay.reject', ['reason' => 'payment_under_review', 'trackid' => $trackid]);
        http_response_code(409);
        exit('This payment is under review.');
    }
    if ($paymentStatus !== 'pending') {
        knet_log($cfg, 'pay.reject', [
            'reason' => 'invalid_payment_status', 'trackid' => $trackid, 'status' => $paymentStatus,
        ]);
        http_response_code(409);
        exit('This order is not payable right now.');
    }
    if ((int)$lookup['stock_released'] !== 0 || $lookup['fulfilment_status'] === 'cancelled') {
        knet_log($cfg, 'pay.reject', ['reason' => 'stock_reservation_released', 'trackid' => $trackid]);
        http_response_code(409);
        exit('This order is no longer reserved. Please start a new checkout.');
    }
    $orderFils = knet_amount_fils((string) $lookup['amount']);
    if ($orderFils === null || $orderFils <= 0) {
        knet_log($cfg, 'pay.reject', [
            'reason' => 'invalid_order_amount', 'trackid' => $trackid,
        ]);
        http_response_code(409);
        exit('Order has no verifiable payable amount.');
    }
    $amount = knet_format_fils($orderFils);
}

try {
    // Validate all local prerequisites before consuming an attempt number.
    knet_assert_payment_config($cfg);
    $attemptTrack = knet_attempt_ref($cfg, $trackid);
} catch (KnetTooManyAttempts $e) {
    knet_log($cfg, 'pay.reject', ['reason' => 'too_many_attempts', 'trackid' => $trackid]);
    http_response_code(429);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Too many payment attempts. Start a new checkout.');
} catch (Throwable $e) {
    knet_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);
    http_response_code(503);
    exit('Payment could not be prepared. Please try again.');
}

$trandata = knet_build_trandata([
    'id'           => $cfg['tranportal_id'],
    'password'     => $cfg['tranportal_password'],
    'action'       => '1',
    'langid'       => $langid,
    'currencycode' => '414',
    'amt'          => $amount,
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
    // A reference unique to this ATTEMPT. Repeated starts while pending must
    // not be refused as duplicates. Attempt one is the track id unchanged.
    'trackid'      => $attemptTrack,
    'udf1'         => '',
    'udf2'         => '',
    'udf3'         => '',
    'udf4'         => '',
    // Reserved by the server so callbacks can resolve a retry for a maximum-
    // length track id after the visible gateway reference is shortened.
    'udf5'         => $trackid,
]);

try {
    $encrypted = knet_encrypt($trandata, $cfg['resource_key']);
} catch (Throwable $e) {
    knet_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);
    http_response_code(500);
    exit('Payment init failed.');
}

// K-064 §13.1a: log the request sent to the gateway. Everything except the
// Tranportal id and its password — the two values that would let someone
// else start payments on this terminal.
knet_log($cfg, 'pay.init', [
    'trackid' => $trackid,
    'attempt' => $attemptTrack,
    'amount'  => $amount,
    'source'  => 'server',
    'request' => [
        'action' => '1', 'langid' => $langid, 'currencycode' => '414', 'amt' => $amount,
        'trackid' => $attemptTrack, 'udf5' => $trackid,
        'responseURL' => $cfg['response_url'], 'errorURL' => $cfg['error_url'],
        'gateway' => knet_gateway_url($cfg),
    ],
]);

$params = http_build_query([
    'param'        => 'paymentInit',
    'trandata'     => $encrypted,
    'tranportalId' => $cfg['tranportal_id'],
    'responseURL'  => $cfg['response_url'],
    'errorURL'     => $cfg['error_url'],
]);

header('Location: ' . knet_gateway_url($cfg) . '?' . $params, true, 302);
exit;
