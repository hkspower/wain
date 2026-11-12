<?php
// KNET response handler. KNET posts the encrypted trandata here after payment.
// Decrypts, verifies CAPTURED + amount, updates the order, redirects the
// customer to the React result page.
//
// Register THIS URL with your bank/KNET as responseURL and errorURL.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
$cfg = knet_with_store_db(knet_load_config(__DIR__ . '/config.php'));

// A CEILING ON ONE CLIENT, NOT A THROTTLE ON PAYMENTS. This URL is
// unauthenticated by design and is reached two ways: by the shopper's browser
// and by KNET's own server, whose notification is the ONLY record of a
// captured payment. The T-Pay twin allows thirty returns a minute per client;
// here the ceiling is 120, because KNET's server calls from one address for
// every shop customer and a refused notification is a paid order that stays
// pending (and a reply KNET cannot parse may void the payment). A shop that
// takes about one order a week never meets it; a loop of replayed or forged
// posts does within a second, and past it the request costs a counter write and
// nothing else — no log line, no decryption, no database transaction.
if (($rate = knet_rate_hit($cfg, 'knet_callback', 120, 60)) !== null && !$rate['allowed']) {
    knet_rate_refuse($rate, 'Too many requests. Please wait a minute and reload this page.');
}

// What the log keeps of requests that carry NO usable payment (no trandata, or
// trandata that does not decrypt): the first ten a minute per client. A real
// callback never lands here — a decrypt failure is a key mismatch (support needs
// the first payloads, which these ten are) or a forged post — and the payment
// log sits on the same private mount as the admin sessions, so a script posting
// 4 kB of junk in a loop must not be able to fill it. Over the ten, the request
// is answered exactly as before (the shopper is still sent onward; nothing was
// ever written to an order on these paths) but nothing is logged.
$logJunk = (static function () use ($cfg): bool {
    $r = knet_rate_hit($cfg, 'knet_callback_junk', 10, 60);
    return $r === null || $r['allowed'];
});

$return   = $cfg['result_page_url'];
$in       = $_POST + $_GET;
$trandata = (string)($in['trandata'] ?? '');

if ($trandata === '') {
    // The errorURL leg: KNET sends the browser here with Error / ErrorText /
    // paymentid / trackid and no trandata when it could not even start the
    // payment (bad request, terminal problem, shopper closed the page). K-064
    // §13.1 makes logging the response mandatory, so it is logged in full.
    // It is NOT written to the order: this request is unauthenticated (anyone
    // can open the URL with any trackid), and letting it fail an order would
    // let a stranger cancel someone else's checkout and release its stock.
    $clip = static fn($v): string => substr(preg_replace('/[^\x20-\x7E]/', '', (string) $v), 0, 200);
    if ($logJunk()) knet_log($cfg, 'callback.error_url', [
        'trackid'   => $clip($in['trackid'] ?? ''),
        'payid'     => $clip($in['paymentid'] ?? ($in['paymentId'] ?? '')),
        'error'     => $clip($in['Error'] ?? ($in['error'] ?? '')),
        'errortext' => $clip($in['ErrorText'] ?? ($in['errorText'] ?? '')),
        'result'    => $clip($in['result'] ?? ''),
    ]);
    // What the result page may be told (K-063 check, order-page findings 2
    // and 3): the order's own track id and the bank's Payment ID, each only
    // in the one shape they can have, so the page can quote them; and the
    // language saved on the order. NOT the receipt key: anyone can open this
    // address with any track id (knet_result_extras with no Payment ID).
    //
    // The order goes as 'order', NOT 'trackid' (review 3, finding 2). The live
    // compiled result page reads 'trackid', and for an order number whose
    // status is not paid / failed / cancelled (a KNET order still pending,
    // which is exactly this leg) it shows "Payment received - being confirmed
    // ... Do not pay again". Only the PAYMENT RECEIPT block of
    // sporta-features.js reads 'order' (on status=error only), so this API
    // release is safe whatever order the add-on and the API are deployed in:
    // without the add-on the page says "Something went wrong" + Try again, as
    // it did before this leg carried anything.
    $onward = ['status' => 'error', 'reason' => isset($in['Error']) || isset($in['ErrorText']) ? 'bank_error' : 'missing_data'];
    $errTrack = trim((string)($in['trackid'] ?? ''));
    if (preg_match('/^[A-Za-z0-9]{1,30}$/D', $errTrack)) {
        $onward['order'] = knet_resolve_track($cfg, $errTrack);
        $errPay = trim((string)($in['paymentid'] ?? ($in['paymentId'] ?? '')));
        if (preg_match('/^[A-Za-z0-9]{1,40}$/D', $errPay)) $onward['payid'] = $errPay;
        $onward += knet_result_extras($cfg, $onward['order'], null);
    }
    knet_send_customer_onward($cfg, $return . '?' . http_build_query($onward));
    exit;
}

try {
    $fields = knet_parse_response(knet_decrypt($trandata, (string)($cfg['resource_key'] ?? '')));
} catch (Throwable $e) {
    // Keep what arrived: a decrypt failure is either a key mismatch (support
    // needs the payload to prove it) or a forged request.
    if ($logJunk()) knet_log($cfg, 'callback.decrypt_failed', [
        'raw' => substr($trandata, 0, 4096), 'error' => $e->getMessage(),
    ]);
    knet_send_customer_onward($cfg, $return . '?status=error&reason=decrypt_failed');
    exit;
}

$result    = strtoupper(trim((string)($fields['result'] ?? '')));
// K-064: CAPTURED is the ONLY successful purchase result. 'APPROVED' used to
// be accepted too; the manual has no such purchase result, and treating an
// undocumented word as money received is how a shop ships unpaid orders.
$bankPaid  = ($result === 'CAPTURED');
// What the bank echoes back is the reference we SENT, which on a retry carries
// an attempt suffix. Resolve it to the order's own track id immediately, before
// anything else touches it: every lookup and the settling UPDATE below key on
// `track_id`, and an unresolved reference would match no row at all — the bank
// having captured the money while the order stayed pending.
$gatewayTrack = trim((string)($fields['trackid'] ?? ''));
$trackid   = $gatewayTrack;
$paymentid = (string)($fields['paymentid'] ?? '');
$ref       = (string)($fields['ref'] ?? '');
$paidAmt   = trim((string)($fields['amt'] ?? ($fields['Amt'] ?? '')));

// K-064 §5: the merchant MUST keep both the encrypted and the decrypted
// response, and §9.6 lists the fields (date/time, result, amount, paymentid,
// trackid, tranid, ref, auth). All of it is logged here — the response carries
// no credentials, only the transaction — so postdate, avr and authRespCode,
// which have no column in `orders`, are not lost. Errors are checked first, as
// the manual asks: an Error/ErrorText inside the response is logged by name.
knet_log($cfg, 'callback.received', [
    'trackid' => $gatewayTrack, 'result' => $result, 'amt' => $paidAmt, 'payid' => $paymentid,
    'error'   => (string)($fields['Error'] ?? ($fields['error'] ?? '')),
    'errortext' => (string)($fields['ErrorText'] ?? ($fields['errorText'] ?? '')),
    'fields'  => $fields,
    'raw'     => substr($trandata, 0, 8192),
]);

// ---------------------------------------------------------------------------
// Settlement — FAIL CLOSED.
//
// Success is derived from the result of one locked database transaction. The
// transaction rechecks the resolved row, payment method, stored amount and
// current state before it writes. A missing database, unknown order, amount
// mismatch, or failed commit is REVIEW — never customer-visible success.
// ---------------------------------------------------------------------------
$settlement = ['state' => 'review', 'reason' => 'unverified_callback'];
if (!knet_db_configured($cfg)) {
    $settlement['reason'] = 'orders_database_not_configured';
} elseif (!preg_match('/^[A-Za-z0-9]{1,30}$/', $gatewayTrack)) {
    $settlement['reason'] = 'invalid_track_id';
} else {
    $trackid = knet_resolve_track($cfg, $gatewayTrack, trim((string)($fields['udf5'] ?? '')));
    $settlement = knet_settle_order($cfg, $trackid, $bankPaid, $result, $paidAmt, $fields);
}

if ($settlement['state'] === 'review') {
    knet_log($cfg, 'callback.review', [
        'trackid' => $trackid,
        'reason' => $settlement['reason'],
        'result' => $result,
        'payid' => $paymentid,
    ]);
}

$status = $settlement['state'] === 'paid'
    ? 'success'
    : ($settlement['state'] === 'review'
        ? 'review'
        : ($settlement['state'] === 'refunded'
            ? 'refunded'
            : (($result === 'CANCELED' || $result === 'CANCELLED') ? 'cancelled' : 'failed')));
$query = ['status' => $status, 'trackid' => $trackid, 'payid' => $paymentid, 'ref' => $ref];
if ($status === 'review') $query['reason'] = $settlement['reason'];
// The receipt (K-063 D1/D5): the result page asks the server for the order's
// own record (api.php ?r=status) and shows the bank's fields only to the
// shopper holding the receipt key. The key is added only when the order now
// records THIS trandata's Payment ID (the payment that paid it, or the decline
// that failed it): see knet_result_extras. It is the order's proof, not data:
// nothing shown is read from this address.
$query += knet_result_extras($cfg, $trackid, $paymentid);
$q = http_build_query($query);
knet_send_customer_onward($cfg, $return . '?' . $q);
exit;

// ---------------------------------------------------------------------------
// Getting the customer back to the shop.
//
// The same URL is reached two ways, and each needs a different answer:
//
//   * KNET's server posts the result here (the notification). K-064 §5 and
//     §10.2.1 #4-6 are explicit: the reply is ONE line, `REDIRECT=<url>`, with
//     no HTML and no HTTP redirect, and a reply KNET cannot parse may make it
//     void the payment — the customer is charged, then refunded, and the order
//     is lost. The previous default printed that line AND an HTML page after it.
//   * A browser lands here (the errorURL leg, or a bank that redirects the
//     shopper instead of notifying). A plain-text REDIRECT line would strand
//     them on a white page, so a browser gets a 302.
//
// A browser is recognised by the Fetch Metadata header every current browser
// sends on a top-level navigation (Sec-Fetch-Mode: navigate). KNET's server
// client sends no such header, so it gets the exact reply the manual names.
// 'callback_response' in config.php can force either answer:
// 'redirect' (always 302) or 'plain' (always the REDIRECT= line).
function knet_send_customer_onward(array $cfg, string $url): void
{
    $mode = (string)($cfg['callback_response'] ?? 'auto');
    $isBrowser = strtolower((string)($_SERVER['HTTP_SEC_FETCH_MODE'] ?? '')) === 'navigate'
        || strtolower((string)($_SERVER['HTTP_SEC_FETCH_DEST'] ?? '')) === 'document';
    if ($mode === 'redirect' || ($mode !== 'plain' && $isBrowser)) {
        header('Location: ' . $url, true, 302);
        return;
    }
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'REDIRECT=' . $url;
}

// The settlement itself (knet_settle_order and its helpers) lives in knet.php,
// unchanged, so that the one other caller that may settle a KNET order — the
// stock sweeper's optional inquiry (knet_inquire_order, OFF by default) — runs
// exactly this code, with the same locks, guards and idempotence.
