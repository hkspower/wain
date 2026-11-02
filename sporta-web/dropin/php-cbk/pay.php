<?php
// Start a CBK payment.
//   GET/POST: trackid=ORDER123 (unique) [& lang=ar|en]
// Fetches an AccessToken, then auto-submits the NVP form to CBK's hosted page.

declare(strict_types=1);
require __DIR__ . '/cbk.php';
cbk_require_https(); // payments must never run over plain HTTP
$cfg = cbk_with_store_db(cbk_load_config(__DIR__ . '/config.php'));

// Ten starts a minute per client, before anything else is read. Every start
// that gets through costs one Authenticate call to CBK under the shop's own
// credentials, and none of this needs more than a track id, so with no limit a
// loop here was a way to hammer the bank's merchant API from this server.
// See also CBK_MAX_ATTEMPTS, the ceiling per ORDER.
if (($rate = cbk_rate_hit($cfg, 'tpay_pay', 10, 60)) !== null && !$rate['allowed']) {
    cbk_log($cfg, 'pay.reject', ['reason' => 'rate_limited']);
    cbk_rate_refuse($rate, 'Too many payment attempts. Please wait a minute and try again.');
}

// Read only GET/POST explicitly. $_REQUEST can include cookies depending on
// the host's request_order setting; a cookie must never choose an order or the
// language sent to a payment gateway.
$in      = $_POST + $_GET;
$trackid = trim((string)($in['trackid'] ?? ''));
$lang    = trim((string)($in['lang'] ?? $cfg['lang'])) === 'ar' ? 'ar' : 'en';

if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $trackid)) {
    http_response_code(400);
    exit('Invalid track id.');
}

// SECURITY — server-side price authority.
//
// The amount is looked up FIRST and the request carries none. This used to
// demand an `amount` parameter, validate it, and only then override it from the
// database — so the browser still had to be trusted to name a figure, and a
// request without one was rejected before the real amount was ever read. The
// storefront now sends only a track id, exactly as /knet does.
//
// The stored amount is computed by a database trigger from product prices
// (api/schema.mysql.sql), so it cannot be influenced from the browser at all.
// FAIL CLOSED. `null` used to mean three different things at once — no
// database, no such order, database unreachable — and the fallback for all
// three was the amount the BROWSER sent. So with a database configured and
// working, /pay/pay.php?trackid=ANYTHING&amount=0.100 still produced a payment
// form for 0.100 KWD against an order that did not exist. The /knet dropin was
// hardened against exactly this and T-Pay never was; scripts/tpay-test.mjs
// caught it on its first run. Now: if there IS a database, its answer is the
// only answer, and anything it cannot confirm is refused.
$lookup = cbk_order_lookup($cfg, $trackid);
if ($lookup['state'] === 'off') {
    cbk_log($cfg, 'pay.reject', ['reason' => 'orders_database_not_configured', 'trackid' => $trackid]);
    http_response_code(503);
    exit('Payment service is not configured.');
}
if ($lookup['state'] === 'error') {
    cbk_log($cfg, 'pay.reject', ['reason' => 'order_lookup_failed', 'trackid' => $trackid]);
    http_response_code(503);
    exit('Could not verify the order right now. Please try again in a moment.');
}
if ($lookup['state'] === 'missing') {
        cbk_log($cfg, 'pay.reject', ['reason' => 'order_not_found', 'trackid' => $trackid]);
        http_response_code(404);
        exit('Unknown order.');
}
if (!cbk_method_ok($cfg, (string) $lookup['method'])) {
    cbk_log($cfg, 'pay.reject', ['reason' => 'wrong_payment_method', 'trackid' => $trackid, 'method' => $lookup['method']]);
    http_response_code(409);
    exit($lookup['method'] === 'knet' ? 'This order is not payable through this gateway.' : 'This order is not payable by T-Pay.');
}
if ($lookup['status'] === 'paid') {
        // Charging a settled order again is a refund and an apology.
        cbk_log($cfg, 'pay.reject', ['reason' => 'already_paid', 'trackid' => $trackid]);
        http_response_code(409);
        exit('This order has already been paid.');
}
if ($lookup['status'] !== 'pending') {
    http_response_code(409);
    exit('This order is not payable right now.');
}
if ((int)$lookup['stock_released'] !== 0 || $lookup['fulfilment_status'] === 'cancelled') {
    cbk_log($cfg, 'pay.reject', ['reason' => 'stock_reservation_released', 'trackid' => $trackid]);
    http_response_code(409);
    exit('This order is no longer reserved. Please start a new checkout.');
}
$fils = cbk_amount_fils((string) $lookup['amount']);
if ($fils === null || $fils <= 0) {
    http_response_code(409);
    exit('Order has no verifiable payable amount.');
}
$amount = cbk_format_fils($fils);

try {
    cbk_assert_payment_config($cfg);
    // The attempt FIRST, then the key: the attempt is where the per-order
    // ceiling is enforced (CBK_MAX_ATTEMPTS), and a refused attempt must cost
    // the bank nothing. The other way round, every refused start still minted
    // a fresh AccessToken.
    $attemptTrack = cbk_attempt_ref($cfg, $trackid);
    // Fresh key for every checkout, per CBK's manual (see cbk_get_access_token).
    $token = cbk_get_access_token($cfg, true);
} catch (CbkTooManyAttempts $e) {
    cbk_log($cfg, 'pay.reject', ['reason' => 'too_many_attempts', 'trackid' => $trackid]);
    http_response_code(429);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Too many payment attempts. Start a new checkout.');
} catch (Throwable $e) {
    cbk_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);
    http_response_code(502);
    exit('Payment init failed: could not authenticate with CBK.');
}

cbk_log($cfg, 'pay.init', [
    'trackid' => $trackid,
    'amount'  => $amount,
    'source'  => 'server',
    'paytype' => cbk_pay_type((string) $lookup['method']),
]);

$checkoutUrl = cbk_base($cfg) . '/ePay/pg/epay?_v=' . rawurlencode($token);

// Fields per the manual. ENCRP_KEY and AccessToken pass through as-is.
$fields = [
    'tij_MerchantEncryptCode'  => $cfg['encrp_key'],
    'tij_MerchAuthKeyApi'      => $token,
    'tij_MerchantPaymentLang'  => $lang,
    'tij_MerchantPaymentAmount'=> $amount,
    // Unique per ATTEMPT, so a repeated start while pending is not refused as
    // a duplicate (TIJ0004). Attempt one is the track id unchanged.
    'tij_MerchantPaymentTrack' => $attemptTrack,
    // CBK's form schema includes these optional fields, but Sporta does not use
    // them. Keep the protocol fields blank instead of accepting arbitrary
    // browser input that has no business meaning.
    'tij_MerchantPaymentRef'   => '',
    'tij_MerchantPaymentCurrency' => 'KWD',
    'tij_MerchantUdf1'         => '',
    'tij_MerchantUdf2'         => '',
    'tij_MerchantUdf3'         => '',
    'tij_MerchantUdf4'         => '',
    // Reserved for the original order id so a shortened 30-character retry
    // can always be resolved when CBK returns it.
    'tij_MerchantUdf5'         => $trackid,
    // From the order's own method (see cbk_pay_type): '2' T-Pay, '1' KNET.
    'tij_MerchPayType'         => cbk_pay_type((string) $lookup['method']),
    'tij_MerchReturnUrl'       => $cfg['return_url'],
];

$h = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting to payment…</title></head>
<body onload="document.forms[0].submit()">
  <p style="font-family:sans-serif;text-align:center;margin-top:3rem">
    Redirecting you to the secure payment page…
  </p>
  <form method="post" action="<?= $h($checkoutUrl) ?>" enctype="application/x-www-form-urlencoded">
    <?php foreach ($fields as $name => $value): ?>
      <input type="hidden" name="<?= $h($name) ?>" value="<?= $h($value) ?>">
    <?php endforeach; ?>
    <noscript><button type="submit">Continue to payment</button></noscript>
  </form>
</body></html>
