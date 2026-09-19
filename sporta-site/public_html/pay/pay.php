<?php
// Start a CBK payment.
//   GET/POST: amount=1.500 & trackid=ORDER123 (unique) [& ref, udf1..5, lang, paytype]
// Fetches an AccessToken, then auto-submits the NVP form to CBK's hosted page.

declare(strict_types=1);
require __DIR__ . '/cbk.php';
cbk_require_https(); // payments must never run over plain HTTP
$cfg = cbk_config();

// READ GET AND POST EXPLICITLY, NEVER $_REQUEST — the same rule /knet has
// carried since it was written, and T-Pay was the half that never got it.
//
// $_REQUEST's contents follow the `request_order` ini setting, and when that
// setting is ABSENT — which is the ordinary case on shared hosting, this is not
// a hypothetical — PHP falls back to `variables_order`, whose stock value
// EGPCS includes COOKIES. Measured in this container: with request_order unset
// and variables_order=EGPCS, `curl -H 'Cookie: trackid=EVIL; amount=0.100'`
// produced $_REQUEST['trackid'] === 'EVIL'.
//
// Cookies come LAST in that order, so they do not merely add a value, they
// SHADOW the query string. A stale or injected `trackid` cookie would silently
// point a checkout at a different order than the one in the link the shopper
// followed — they pay, and something else is marked paid. `$_POST + $_GET`
// cannot be reached from a cookie at all.
$in      = $_POST + $_GET;
$amount  = trim((string)($in['amount']  ?? ''));
$trackid = trim((string)($in['trackid'] ?? ''));
$lang    = trim((string)($in['lang'] ?? $cfg['lang'])) === 'ar' ? 'ar' : 'en';
$payType = (string)($in['paytype'] ?? $cfg['pay_type']); // '', '1'=KNET, '2'=QR
$payType = in_array($payType, ['', '1', '2'], true) ? $payType : '';

if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $trackid)) {
    http_response_code(400);
    exit('Invalid track id.');
}

// BEFORE anything that writes. The next thing this page does is look the order
// up and then increment orders.pay_attempt, and both are work done for an
// unauthenticated caller. Sixty starts in ten minutes is far above any real
// shopper — a declined card retried five or six times is the honest worst
// case — and well below a script.
//
// Per IP, which is the right key here even behind Kuwait's carrier NAT: this
// is the page a shopper reaches by clicking Pay, not one the bank calls, so
// the ceiling only has to clear a busy street's worth of simultaneous
// checkouts. It fails open if the counter cannot be read at all.
if (cbk_over_limit($cfg, 'cbk_pay', 60, 600)) {
    http_response_code(429);
    header('Retry-After: 300');
    exit('Too many payment attempts. Please wait a few minutes and try again.');
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
$serverAmount = $lookup['amount'];
if (cbk_db_configured($cfg)) {
    if ($serverAmount === null) {
        cbk_log($cfg, 'pay.reject', ['reason' => 'order_not_found', 'trackid' => $trackid, 'asked' => $amount]);
        http_response_code(404);
        exit('Unknown order.');
    }
    if ($lookup['status'] === 'paid') {
        // Charging a settled order again is a refund and an apology.
        cbk_log($cfg, 'pay.reject', ['reason' => 'already_paid', 'trackid' => $trackid]);
        http_response_code(409);
        exit('This order has already been paid.');
    }
    if ((float) $serverAmount <= 0) {
        http_response_code(400);
        exit('Order has no payable amount.');
    }
    $amount = number_format((float) $serverAmount, 3, '.', '');
} elseif ($amount === '') {
    // No orders database at all: the browser's figure is the only one there
    // is, so it must at least be present. Running a live shop this way means
    // the browser sets the price — see config.example.php.
    http_response_code(400);
    exit('Unknown order.');
}

// Whatever the source, the figure must satisfy CBK's format: numeric, at most
// 10 digits including 3 decimals. Also blocks NVP/parameter injection.
if (!preg_match('/^\d{1,7}(\.\d{1,3})?$/', $amount) || (float) $amount <= 0) {
    http_response_code(400);
    exit('Invalid amount.');
}

try {
    $token = cbk_get_access_token($cfg);
} catch (Throwable $e) {
    cbk_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);
    http_response_code(502);
    exit('Payment init failed: could not authenticate with CBK.');
}

cbk_log($cfg, 'pay.init', [
    'trackid' => $trackid,
    'amount'  => $amount,
    'source'  => cbk_db_configured($cfg) ? 'server' : 'client-no-db',
]);

$checkoutUrl = cbk_base($cfg) . '/ePay/pg/epay?_v=' . rawurlencode($token);

// Fields per the manual. ENCRP_KEY and AccessToken pass through as-is.
$fields = [
    'tij_MerchantEncryptCode'  => $cfg['encrp_key'],
    'tij_MerchAuthKeyApi'      => $token,
    'tij_MerchantPaymentLang'  => $lang,
    'tij_MerchantPaymentAmount'=> $amount,
    // Unique per ATTEMPT, so a retry after a decline is not refused as a
    // duplicate (TIJ0004). Attempt one is the track id unchanged.
    'tij_MerchantPaymentTrack' => cbk_attempt_ref($cfg, $trackid),
    // Trimmed to the manual's own limits (Request Parameters, pp.8-9), because
    // the gateway does not truncate — it REJECTS, and the rejection arrives as
    // a bare TIJ code on the return URL long after the customer has left the
    // shop. Ref is 30, Udf1 20, Udf2 10, Udf3-5 100. Cutting them here costs a
    // few characters of a description nobody reads; not cutting them costs the
    // sale. The charset restrictions in the same table are enforced too: Udf2
    // becomes the merchant's bank-statement reference and CBK accepts only
    // letters, digits, hyphen and space in it.
    'tij_MerchantPaymentRef'   => cbk_field($in['ref']  ?? '', 30),
    'tij_MerchantPaymentCurrency' => 'KWD',
    'tij_MerchantUdf1'         => cbk_field($in['udf1'] ?? '', 20, '/[^A-Za-z0-9]/'),
    'tij_MerchantUdf2'         => cbk_field($in['udf2'] ?? '', 10, '/[^A-Za-z0-9\- ]/'),
    'tij_MerchantUdf3'         => cbk_field($in['udf3'] ?? '', 100, '/[^A-Za-z0-9\- ]/'),
    'tij_MerchantUdf4'         => cbk_field($in['udf4'] ?? '', 100, '/[^A-Za-z0-9\- ]/'),
    'tij_MerchantUdf5'         => cbk_field($in['udf5'] ?? '', 100, '/[^A-Za-z0-9\- ]/'),
    'tij_MerchPayType'         => $payType,
    'tij_MerchReturnUrl'       => $cfg['return_url'],
];

$h = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');

// THIS PAGE CARRIES MERCHANT CREDENTIALS IN ITS BODY, and it says so itself
// rather than trusting .htaccess to say it.
//
// tij_MerchantEncryptCode is the ENCRP_KEY and tij_MerchAuthKeyApi is a live
// AccessToken; both are hidden inputs a few lines below, because a hosted
// dropin has no other way to hand them to the gateway. pay/.htaccess already
// sends no-store — but a shop that is moved behind nginx, or a deploy that
// misses one file, loses every rule in it at once, and the rule that stops a
// bearer credential being written to a shared proxy's disk is not one to hold
// in a single place. Belt and braces, on the one page where the braces are a
// bank credential.
//
// no-referrer, not the site-wide strict-origin-when-cross-origin: the form
// POSTs to CBK, and even an origin-only Referer is a fact about where this
// shopper is that the gateway does not need in order to take the money.
header('Cache-Control: no-store, no-cache, must-revalidate, private');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
?><!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting to payment…</title></head>
<body>
  <p style="font-family:sans-serif;text-align:center;margin-top:3rem">
    Redirecting you to the secure payment page…
  </p>
  <form method="post" action="<?= $h($checkoutUrl) ?>" enctype="application/x-www-form-urlencoded">
    <?php foreach ($fields as $name => $value): ?>
      <input type="hidden" name="<?= $h($name) ?>" value="<?= $h($value) ?>">
    <?php endforeach; ?>
    <button type="submit">Continue to payment</button>
  </form>
  <!-- A SCRIPT ELEMENT, NOT `onload=`, and the difference is the whole page.
       CSP hashes can authorise a script element. They can NEVER authorise an
       inline EVENT HANDLER — that needs 'unsafe-hashes', which this policy
       deliberately does not grant — and because the storefront's policy
       carries hashes at all, its 'unsafe-inline' is inert. Measured in
       Chromium under the live policy: "Refused to execute inline event
       handler", the submit never ran, and the shopper sat on this page
       for ever with an order they could not pay for.
       The hash of this script is pinned in pay/.htaccess and checked byte for
       byte by scripts/csp-check.mjs. -->
  <script>document.forms[0].submit()</script>
</body></html>
