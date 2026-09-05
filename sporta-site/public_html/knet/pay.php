<?php
// Start a KNET payment.
//   GET/POST: amount=1.500 & trackid=ORDER123 (unique) [& udf1..5]
// Builds the encrypted trandata and posts the customer to KNET's hosted page.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
$cfg = knet_config();

// Read only GET/POST explicitly — $_REQUEST's contents depend on the
// request_order ini setting and can include cookies on some configurations.
$in      = $_POST + $_GET;
$amount  = trim((string)($in['amount']  ?? ''));
$trackid = trim((string)($in['trackid'] ?? ''));

// The bank page has an Arabic face and the storefront already knows which one
// the shopper is reading — checkout.js sends ?lang=. Ignoring it sent every
// Arabic customer to an English card form on an Arabic-first shop. Only the
// two values KNET accepts are honoured; anything else falls back to config.
//
// The WIRE value comes from config, because which string KNET wants for
// English is an open question with the bank — see config.example.php. The
// storefront keeps sending the human codes it already sends (ar/en); this maps
// them, so answering the bank is a one-line config edit on a server with no
// shell rather than a code change and a redeploy.
$langIn = strtoupper(trim((string)($in['lang'] ?? '')));
$langid = match ($langIn) {
    'AR'    => (string) ($cfg['lang_ar'] ?? 'AR'),
    'EN'    => (string) ($cfg['lang_en'] ?? 'EN'),
    // GUARDED, like the two above it, and it is the one that most needed to be.
    //
    // The two explicit branches already fell back to 'AR' and 'EN'. This one —
    // the DEFAULT, which fires whenever the storefront sends no ?lang= or sends
    // something unrecognised — read the key raw. `language` was added to
    // config.example.php after the dropin shipped, so any shop whose config.php
    // predates it, and the sandbox, have no such key: PHP 8 warns "Undefined
    // array key" and the expression evaluates to '', which is then encrypted
    // into the trandata as an EMPTY language field and handed to the bank.
    //
    // Measured — three of these in the strict log across one run of the suite,
    // from the only endpoint in the whole backend that produced a warning at
    // all. The customer's half of it is a card payment the bank is entitled to
    // refuse, for a reason visible only in a log nobody reads.
    //
    // It falls back through lang_en before 'EN' so a shop that has answered the
    // bank's question about the English code once, in the one place the comment
    // above tells it to, does not have to answer it twice.
    default => (string) ($cfg['language'] ?? $cfg['lang_en'] ?? 'EN'),
};

// Strict validation (also blocks injection into the trandata string).
if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $trackid)) {
    http_response_code(400);
    exit('Invalid track id.');
}

// ---------------------------------------------------------------------------
// THE OFFICIAL PATH: hand this shopper to the CBK hosted page as KNET.
//
// See knet_mode() for which shops come through here and why. In short: this
// shop's KNET is `tij_MerchPayType=1` on the gateway pay/ already talks to,
// and the Tranportal integration below it is for shops that hold Tranportal
// credentials. A shop that holds them is never routed here.
//
// A REDIRECT RATHER THAN RENDERING THE FORM HERE, and that is not tidiness —
// it is the only version that works. pay/pay.php's page carries the ENCRP_KEY
// and a live AccessToken in hidden inputs and auto-submits itself, and the two
// things that make that safe and possible both live in pay/.htaccess: the
// no-store headers that keep a bearer credential off proxy disks, and the CSP
// hash that authorises the one-line submit script. Neither reaches this
// directory. knet/.htaccess sets `script-src 'none'` and `form-action 'none'`
// over everything here, so a copy of that form served from this URL would be a
// page that cannot submit itself and cannot be submitted by hand, holding a
// merchant credential in its body. One page renders it, under the rules
// written for it.
//
// NOTHING IS CHECKED TWICE. The redirect happens before the throttle, before
// the amount lookup and before knet_attempt_ref(), because pay/pay.php does
// every one of those itself — with the same fail-closed price authority, from
// the same orders table. Running them here as well would count each attempt
// twice in orders.pay_attempt, which is the counter that decides whether a
// reference gets a retry suffix: a shopper's FIRST attempt would arrive at the
// bank as `...A2`. The track id validated above is all this page needs to
// establish before handing over.
if (knet_mode($cfg) === 'official') {
    // Only what the shopper's own request carried. `paytype` is fixed at 1
    // here and is NOT read from the query: this endpoint is the KNET door, and
    // a paytype the caller could set would make it a way to reach any face of
    // the gateway through a URL the shop advertises as KNET.
    $hand = ['trackid' => $trackid, 'lang' => $langIn === 'AR' ? 'ar' : 'en', 'paytype' => '1'];
    // Pass-through, so a caller that sends a reference or user fields does not
    // silently lose them at the door. pay/pay.php trims each to the manual's
    // own limits and strips the characters CBK rejects, so nothing needs
    // cleaning here — only forwarding, and only when actually present.
    foreach (['ref', 'udf1', 'udf2', 'udf3', 'udf4', 'udf5'] as $k) {
        if (($in[$k] ?? '') !== '') $hand[$k] = (string) $in[$k];
    }
    knet_log($cfg, 'pay.official', ['trackid' => $trackid]);
    // 303: the shopper arrives by GET from a link, and 303 says "go and GET
    // this instead" in the one way every client agrees on, including for a
    // POST that reached here.
    header('Location: /pay/pay.php?' . http_build_query($hand), true, 303);
    exit;
}

// ---------------------------------------------------------------------------
// THE LEGACY TRANPORTAL PATH — everything below this line is the AES
// `trandata` integration, unchanged, and it runs for shops that hold
// Tranportal credentials.

// The mirror of the guard in pay/pay.php, with the same bucket size and the
// same reasoning — see cbk_over_limit(). This page also increments
// orders.pay_attempt on every hit for an unauthenticated caller.
if (knet_over_limit($cfg, 'knet_pay', 60, 600)) {
    http_response_code(429);
    header('Retry-After: 300');
    exit('Too many payment attempts. Please wait a few minutes and try again.');
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
    // A reference unique to this ATTEMPT, so a retry after a decline is not
    // refused as a duplicate. Attempt one is the track id unchanged.
    'trackid'      => knet_attempt_ref($cfg, $trackid),
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
