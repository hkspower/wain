<?php
// CBK return URL. The gateway redirects the customer here with ?encrp=...
// We verify the transaction via the API, record it, then redirect the
// customer to the React result page.

declare(strict_types=1);
require __DIR__ . '/cbk.php';
cbk_require_https(); // reject non-HTTPS callbacks
$cfg = cbk_with_store_db(cbk_load_config(__DIR__ . '/config.php'));

// Thirty returns a minute per client, before anything else. This URL is
// unauthenticated by design (the bank sends the shopper here), and every call
// costs a GetTransactions request to CBK — so without a limit it was a way to
// make this server hammer the bank's API. A shopper behind a carrier's shared
// address would need thirty card payments finishing in the same minute to
// meet it.
if (($rate = cbk_rate_hit($cfg, 'tpay_callback', 30, 60)) !== null && !$rate['allowed']) {
    cbk_log($cfg, 'callback.reject', ['reason' => 'rate_limited']);
    cbk_rate_refuse($rate, 'Too many requests. Please wait a minute and reload this page.');
}

$return = $cfg['result_page_url'];
$in     = $_POST + $_GET;
$encrp  = (string)($in['encrp'] ?? '');

// THE GATEWAY'S OTHER RETURN PATH, and it is in the manual: "On any error
// during the transaction, the result page will be returned with" ErrorCode and
// PayTrackID — NOT with encrp. (CBK Hosted KNET & T-Pay Integration & Reference
// Manual v2.93, "Error", p.13.)
//
// This branch did not exist. A rejected request arrived with no encrp, took the
// missing_encrp exit, and the order was left PENDING for ever: no failure
// recorded, nothing logged, and the one thing that says exactly what was wrong
// — a code from the table on p.15 — thrown away at the door. TIJ0002 is a
// malformed amount, TIJ0009 an expired auth key, TIJ0020 a failure inside KNET
// itself; each is a different fix and none of them could be seen.
$errorCode  = strtoupper(trim((string)($in['ErrorCode'] ?? $in['errorcode'] ?? '')));
$errorTrack = trim((string)($in['PayTrackID'] ?? $in['paytrackid'] ?? ''));

if ($errorCode !== '') {
    // Every code in the manual's table, so the log says what the bank meant
    // rather than a five-character token nobody can look up in a hurry.
    $CBK_ERRORS = [
        'TIJ0001' => 'Invalid merchant language',
        'TIJ0002' => 'Invalid merchant amount',
        'TIJ0003' => 'Invalid merchant amount (KWD)',
        'TIJ0004' => 'Invalid merchant track id',
        'TIJ0005' => 'Invalid merchant UDF1',
        'TIJ0006' => 'Invalid merchant currency',
        'TIJ0007' => 'Invalid merchant payment reference',
        'TIJ0008' => 'Invalid merchant pay type',
        'TIJ0009' => 'Invalid merchant API authenticate key',
        'TIJ0015' => 'Invalid merchant UDF2',
        'TIJ0016' => 'Error in QR',
        'TIJ0020' => 'Error in KNET',
        'TIJ0022' => 'Invalid merchant UDF3',
        'TIJ0023' => 'Invalid merchant UDF4',
        'TIJ0024' => 'Invalid merchant UDF5',
        'TIJ0027' => 'Invalid merchant return URL',
    ];
    $meaning = $CBK_ERRORS[$errorCode] ?? 'Unknown gateway error';
    cbk_log($cfg, 'callback.gateway_error',
            ['code' => $errorCode, 'meaning' => $meaning, 'trackid' => $errorTrack]);

    // TIJ0009 is the one worth acting on rather than only recording: the token
    // is stale, and the next payment should mint a fresh one instead of
    // reusing the cached copy for the rest of its two hours.
    // ...but at most once every ten minutes, because this request is
    // unauthenticated and the file is a CACHE OF A CREDENTIAL.
    //
    // Measured: `GET /pay/callback.php?ErrorCode=TIJ0009` — no track id, no
    // encrp, nothing to know — deleted the cached access token. In a loop it
    // means every real payment mints a fresh token from CBK instead of reusing
    // one for its two hours, which is latency on the checkout path and a
    // request rate against the merchant auth endpoint that nobody chose.
    //
    // Ten minutes is the whole fix: a genuinely stale token is purged on the
    // first TIJ0009 and the next payment mints a good one, while a flood
    // collapses to one purge per window. The marker sits beside the cache and
    // is not a secret — it holds a timestamp and nothing else.
    if ($errorCode === 'TIJ0009' && !empty($cfg['token_cache_file'])) {
        // RACE K2-3: the once-per-window decision is made atomically
        // (cbk_token_purge_claim), not read-then-write.
        $since = cbk_token_purge_claim($cfg);
        if ($since === null) {
            @unlink($cfg['token_cache_file']);
        } else {
            cbk_log($cfg, 'callback.purge_throttled', ['since' => $since]);
        }
    }

    // THIS BRANCH IS UNAUTHENTICATED, AND IT MUST NOT WRITE payment_status.
    //
    // Everything above comes from the query string. Unlike the encrp path
    // below — where the transaction is read back from CBK over the merchant
    // API before a single column moves — there is nothing here to verify:
    // CBK's error return carries no signature, no encrp and no shared secret.
    // It is a claim by whoever sent the request.
    //
    // Measured, against a real order on a real database:
    //     GET /pay/callback.php?ErrorCode=TIJ0020&PayTrackID=<track>
    // flipped a pending order to `failed`. One request, no bank, no session.
    // Track ids are 64 bits of CSPRNG so they cannot be enumerated, but they
    // are not secrets either — they sit in the customer's own URL, on the
    // result page, in the warehouse email. Anyone who has seen one could
    // sabotage that order, and `failed` is a state the shop ACTS on: cron-
    // stock.php releases the claimed stock, so a shopper part-way through
    // paying loses the size they had reserved and the real payment lands on
    // an order whose stock is gone.
    //
    // So it records, and records everything — the code, the meaning, the
    // track id, in the log and on the row — and it changes no status. This is
    // the rule the same file states forty lines below and is worth repeating
    // here because this branch was the exception to it:
    //
    //     Pending is honest. Failed is a claim, and this code is not in a
    //     position to make it.
    //
    // Nothing diagnostic is lost. The point of the branch was that a code
    // from the manual's table was "thrown away at the door"; it still is not.
    if ($errorTrack !== '') {
        cbk_note_gateway_error($cfg, cbk_resolve_track($cfg, $errorTrack),
                               $errorCode . ' ' . $meaning);
    }
    header('Location: ' . $return . '?status=failed&reason=' . rawurlencode($errorCode), true, 302);
    exit;
}

if ($encrp === '') {
    cbk_log($cfg, 'callback.no_encrp', ['query' => array_keys($in)]);
    header('Location: ' . $return . '?status=error&reason=missing_encrp', true, 302);
    exit;
}

try {
    $token = cbk_get_access_token($cfg);
    $res   = cbk_get_transaction($cfg, $encrp, $token);
} catch (Throwable $e) {
    header('Location: ' . $return . '?status=error&reason=verify_failed', true, 302);
    exit;
}

if (!is_array($res)) {
    header('Location: ' . $return . '?status=error&reason=no_result', true, 302);
    exit;
}

// STATUS 0 AND -1 ARE NOT A DECLINED PAYMENT. They are the API refusing to
// answer the question: 0 is "Invalid Access. Re-generate new API key", -1 is
// "Error/Invalid {encrp}/{payid}" (manual, p.14), and the manual spells out
// the remedy — "If Status=0, re-generate new API key and try again."
//
// Everything that is not 1 or 3 used to fall through to 'failed', which wrote
// payment_status='failed' onto an order whose real state is UNKNOWN. The
// token is valid for two hours and cached for 100 minutes, so a token that
// expires early or is revoked mid-session turns real, captured payments into
// failed orders — and 'failed' is a state a shop acts on. Refunds get issued
// for money that was taken and kept.
//
// So the order is LEFT ALONE: pending is honest, failed is a claim, and this
// code is not in a position to make it.
//
// ONLY STATUS 0 IS RETRIED. -1 means the ENCRP value is wrong, and a new key
// cannot fix a wrong value. This URL is unauthenticated, so `?encrp=<junk>` in
// a loop used to cost three calls to CBK each (GetTransactions, Authenticate,
// GetTransactions), wiped the cached credential every time, and had this server
// hammering the bank's merchant API on a stranger's behalf. So -1 is logged and
// answered at once.
//
// A 0 means the key is no longer valid (CBK p.13-14: "re-generate new API key
// and try again"). Every 0 gets ONE fresh key and ONE retry, so a customer who
// returns while another request is inside the purge window is not left pending
// with a captured payment. The ten-minute window (cbk_token_purge_claim) limits
// only the DELETION of the cached key, which is the part that must not loop. A
// fresh key is minted only after CBK itself answered 0, so a stranger's junk
// encrp (answered -1) cannot drive this path. Each retry costs one Authenticate
// call; the per-client rate limit at the top of this file bounds them.
$apiStatus = (string)($res['Status'] ?? '');
if (in_array($apiStatus, ['0', '-1'], true)) {
    if ($apiStatus === '0') {
        cbk_log($cfg, 'callback.stale_token', ['status' => $apiStatus]);
        // RACE K2-3: claimed atomically, like the TIJ0009 purge above.
        //
        // K-063 / CBK p.13-14: "If Status=0, re-generate new API key and try again."
        // The 10-minute window only limits PURGES (deleting the cached key). Inside
        // it, this request still gets a FRESH key (one Authenticate, cached) and one
        // retry. Before this, a customer returning inside another request's window
        // was left pending with a captured payment and no retry. The loop the window
        // was built against (-1 answers, which cost no re-authentication) stays
        // closed, and a fresh key comes only after CBK itself answered 0.
        $since = !empty($cfg['token_cache_file']) ? cbk_token_purge_claim($cfg) : 0;
        $purged = !empty($cfg['token_cache_file']) && $since === null;
        if ($purged) {
            @unlink($cfg['token_cache_file']);
        } else {
            cbk_log($cfg, 'callback.purge_throttled', ['since' => (int) $since]);
        }
        try {
            $res = cbk_get_transaction($cfg, $encrp, cbk_get_access_token($cfg, !$purged)) ?? $res;
        } catch (Throwable $e) {
            // fall through to the check below
        }
    }
    if (in_array((string)($res['Status'] ?? ''), ['0', '-1'], true)) {
        cbk_log($cfg, 'callback.unresolved', ['status' => $res['Status'] ?? '', 'encrp' => substr($encrp, 0, 8)]);
        header('Location: ' . $return . '?status=error&reason=unresolved', true, 302);
        exit;
    }
}

// Payment Result Status Code: 1=Success, 2=Failed, 3=Expired/Cancelled, 0/-1=Invalid
$statusCode = (string)($res['Status'] ?? '');
$paid       = $statusCode === '1';
// PayId FIRST, and the order of these two is the whole settlement.
//
// The manual's Payment Details table (v2.93, p.12) lists them as two
// different things:
//     TrackId   Payment Gateway Track ID
//     PayId     Merchant Track ID
// TrackId is CBK's own reference for the transaction. PayId is the value we
// sent as tij_MerchantPaymentTrack — our orders.track_id, and the only one of
// the two that exists in this database. Its own example makes it plain:
// tij_MerchantPaymentTrack went out as "123" and came back as PayId "123"
// while TrackId was "123123123".
//
// Read the other way round — which is how this was written — every settlement
// looks up a gateway id that matches no row, cbk_update_order() finds nothing
// and returns, and a paid order stays PENDING for ever. The money moves, the
// customer sees the success page, the shop never ships. It survived because
// the fake gateway echoed the merchant's track back as TrackId, so the test
// suite held the same misreading as the code and the two agreed.
//
// The fallback stays, for a gateway that omits PayId; but it is the fallback.
$trackid    = (string)($res['PayId'] ?? '');
if ($trackid === '') $trackid = (string)($res['TrackId'] ?? '');
// What came back is the reference we SENT, which on a retry carries an attempt
// suffix. Resolve it to the order's own track id before anything keys on it:
// cbk_update_order() matches `where track_id = ?`, so an unresolved reference
// settles no row while the gateway has taken the money.
// CBK's result names the echo of tij_MerchantUdf5 "MerchUdf5" (manual,
// Payment Details Entity Reference). It was read as "Udf5", a key CBK never
// sends, so a retry whose track id had been shortened to fit 30 characters
// could not be traced back to its order. The old spellings stay as fallbacks.
$udf5       = $res['MerchUdf5'] ?? $res['Udf5'] ?? $res['udf5'] ?? '';
$trackid    = cbk_resolve_track($cfg, $trackid, trim(is_scalar($udf5) ? (string) $udf5 : ''));
// CBK's own reference, kept for reconciliation against the bank statement.
$gatewayTrack = (string)($res['TrackId'] ?? '');
$paymentId  = (string)($res['PaymentId'] ?? '');
$ref        = (string)($res['ReferenceId'] ?? '');
$paidAmount = (string)($res['Amount'] ?? '');

cbk_log($cfg, 'callback.received', [
    'trackid' => $trackid, 'status' => $statusCode, 'amt' => $paidAmount, 'payid' => $paymentId,
]);

// SECURITY — amount verification. Confirm the amount CBK actually charged
// matches the amount recorded for this order. If they differ, the amount was
// tampered with: refuse to mark the order paid.
if ($paid && cbk_db_configured($cfg) && $trackid !== '') {
    $expected = cbk_order_expected_amount($cfg, $trackid);
    $expectedFils = $expected === null ? null : cbk_amount_fils($expected);
    $paidFils = cbk_amount_fils($paidAmount);
    if ($expectedFils === null || $expectedFils <= 0 || $paidFils === null || $paidFils <= 0
        || $expectedFils !== $paidFils) {
        $paid = false;
        $statusCode = 'amount_mismatch';
        cbk_log($cfg, 'callback.amount_mismatch', [
            'trackid' => $trackid, 'expected' => $expected, 'paid' => $paidAmount,
        ]);
    }
}

// Persist the result (the manual requires merchants to save it).
$settlement = (!cbk_db_configured($cfg) || $trackid === '')
    ? ['state' => 'review', 'reason' => 'orders_database_not_configured']
    : cbk_update_order($cfg, $trackid, $paid, $res);
$status = $settlement['state'] === 'paid'
    ? 'success'
    : ($settlement['state'] === 'review' ? 'review' : ($statusCode === '3' ? 'cancelled' : 'failed'));
$q = http_build_query([
    'status'  => $status,
    'trackid' => $trackid,
    'payid'   => $paymentId,
    'ref'     => $ref,
] + ($status === 'review' ? ['reason' => $settlement['reason']] : []));
header('Location: ' . $return . '?' . $q, true, 302);
exit;

// The amount this order is expected to cost, read from the orders table.
// Returns null when the order is not found or the database is unreachable, so
// a blip does not wrongly reject a real payment.
function cbk_order_expected_amount(array $cfg, string $trackid): ?string
{
    return cbk_order_amount($cfg, $trackid);
}

// Records what the gateway said about an order WITHOUT claiming an outcome.
//
// Its whole value is what it does not touch: not payment_status, not paid_at,
// and nothing that queues a warehouse message. An unauthenticated caller can
// therefore reach it and the worst it can do is write a note on a row it
// already knew the track id of.
//
// The note is only written over a PENDING order, so a replayed or malicious
// request cannot scribble over the record of a payment that has already
// settled — the message on a paid order is the bank's, and it stays that way.
function cbk_note_gateway_error(array $cfg, string $trackid, string $message): void
{
    if ($trackid === '') return;
    try {
        $pdo = cbk_pdo($cfg);
        $pdo->prepare(
            "update orders set cbk_message = ?
              where track_id = ? and payment_status = 'pending'"
        )->execute([$message, $trackid]);
    } catch (Throwable $e) {
        // The log above already has it; a note is not worth a 500 to a
        // customer who is being redirected to the failure page regardless.
        cbk_log($cfg, 'callback.note_failed', ['error' => $e->getMessage()]);
    }
}

// RACE K1-7: THE BANK DOES NOT CALL BACK TWICE. A verified payment that met a
// lock-wait timeout (1205) or lost a deadlock (1213) used to be filed as
// "review" with the order left PENDING and the money taken. The settlement is
// one transaction that rolls back completely, so it is run again, from the top,
// up to CBK_SETTLE_ATTEMPTS times in all, with a short growing pause. Only those
// two errors are retried; everything else still fails closed to review.
// (CBK_SETTLE_ATTEMPTS is defined in cbk.php: this file's top-level code ends
// with exit;, and a const declared below that line would never be executed.)
function cbk_update_order(array $cfg, string $trackid, bool $paid, array $res): array
{
    for ($attempt = 1; ; $attempt++) {
        $out = cbk_update_order_once($cfg, $trackid, $paid, $res, $attempt);
        if (empty($out['retry']) || $attempt >= CBK_SETTLE_ATTEMPTS) {
            unset($out['retry']);
            return $out;
        }
        usleep(random_int(40, 160) * 1000 * $attempt);
    }
}

// Has this order's discount use already been handed back? Read under the order's
// row lock, in the settlement transaction. A database that never had
// discount-release.mysql.sql has no such column and nothing was ever returned
// (error 1054, a statement error that leaves the transaction open).
function cbk_discount_given_back(PDO $pdo, int $orderId): bool
{
    try {
        $q = $pdo->prepare('select discount_released from orders where id = ?');
        $q->execute([$orderId]);
        return (int) $q->fetchColumn() === 1;
    } catch (PDOException $e) {
        if ((int) ($e->errorInfo[1] ?? 0) === 1054) return false;
        throw $e;
    }
}

// One payment_alerts row for a captured Payment ID the order does not record (CBK). Returns 'saved',
// 'already_known' (the unique key: this Payment ID was kept before) or 'not_saved'. A savepoint keeps the
// settlement transaction usable when the row is refused; a retryable lock error is rethrown so the whole
// settlement is run again. The order row is not written.
function cbk_alert_duplicate_capture(array $cfg, PDO $pdo, int $orderId, string $extraPayId, ?string $orderPayId, array $res, string $trackid): string
{
    $clip = static fn ($v, int $n): ?string => ($v = substr(trim((string) $v), 0, $n)) === '' ? null : $v;
    $fils = cbk_amount_fils((string)($res['Amount'] ?? ''));
    $pdo->exec('savepoint cbk_dup_alert');
    try {
        $st = $pdo->prepare(
            "insert into payment_alerts
                (order_id, kind, gateway, payment_id, order_payment_id, amount,
                 transaction_id, reference, attempt_ref, source)
             values (?, 'duplicate_capture', 'cbk', ?, ?, ?, ?, ?, ?, 'callback')"
        );
        $st->execute([
            $orderId, substr($extraPayId, 0, 60), $orderPayId === null ? null : substr($orderPayId, 0, 60),
            $fils === null || $fils <= 0 ? null : intdiv($fils, 1000) . '.' . str_pad((string)($fils % 1000), 3, '0', STR_PAD_LEFT),
            $clip($res['TransactionId'] ?? '', 60), null, $clip($trackid, 40),
        ]);
        $pdo->exec('release savepoint cbk_dup_alert');
        return 'saved';
    } catch (PDOException $e) {
        if (cbk_tx_retryable($e)) throw $e;
        $pdo->exec('rollback to savepoint cbk_dup_alert');
        if ((int) ($e->errorInfo[1] ?? 0) === 1062) return 'already_known';
        cbk_log($cfg, 'callback.duplicate_capture_not_saved', ['trackid' => $trackid, 'payid' => $extraPayId]);
        return 'not_saved';
    }
}

function cbk_update_order_once(array $cfg, string $trackid, bool $paid, array $res, int $attempt): array
{
    $status = $paid ? 'paid' : ((string)($res['Status'] ?? '') === '1' ? 'review' : 'failed');

    // Mirrors the KNET dropin exactly, including the parts it learned the hard
    // way: never downgrade a paid order, never re-stamp or re-notify on a
    // replay, and queue the warehouse follow-up in the SAME transaction as the
    // status it reports.
    try {
        $pdo = cbk_pdo($cfg);
        // Wait at most 8 s for a row lock (never longer than the database's own
        // setting, 50 s by default): three attempts then take about 25 s at the
        // worst, where one wait used to take 50 s and end in "review".
        // BEST EFFORT (added in review): a refused SET must never turn a captured
        // payment into "review". Without it the settlement simply waits as long as
        // the database's own setting says, which is what it did before this cap.
        try {
            $pdo->exec('set session innodb_lock_wait_timeout = least(@@session.innodb_lock_wait_timeout, 8)');
        } catch (Throwable $e) {
            // keep the server's wait
        }
        $pdo->beginTransaction();
        $cur = $pdo->prepare('select id, payment_status, payment_method, stock_released, fulfilment_status, cbk_paymentid from orders where track_id = ? for update');
        $cur->execute([$trackid]);
        $order = $cur->fetch(PDO::FETCH_ASSOC);
        if (!$order) { $pdo->rollBack(); return ['state' => 'review', 'reason' => 'order_not_found']; }
        $before = (string) $order['payment_status'];
        if ($before === 'paid' && cbk_method_ok($cfg, (string) $order['payment_method'])) {
            // A SECOND CAPTURE (review finding, high; the KNET twin, knet_keep_duplicate_capture): a CAPTURED result
            // under a Payment ID the order does not record is a second charge on a paid order. It used to be
            // answered already_paid with nothing written, so the owner never heard of it. Now it is kept as a
            // payment_alerts row and logged, and the order is left as it was. A replay of the recorded Payment ID
            // stays a silent no-op, as before.
            $incomingPayId = trim((string)($res['PaymentId'] ?? ''));
            $recordedPayId = trim((string)($order['cbk_paymentid'] ?? ''));
            if ($paid && $incomingPayId !== '' && !hash_equals($recordedPayId, $incomingPayId)) {
                $kept = cbk_alert_duplicate_capture($cfg, $pdo, (int)$order['id'], $incomingPayId,
                    $recordedPayId === '' ? null : $recordedPayId, $res, $trackid);
                $pdo->commit();
                cbk_log($cfg, 'callback.duplicate_capture', [
                    'trackid' => $trackid, 'payid' => $incomingPayId, 'order_payid' => $recordedPayId,
                    'amt' => (string)($res['Amount'] ?? ''), 'alert' => $kept,
                ]);
                return ['state' => 'paid', 'reason' => 'already_paid'];
            }
            $pdo->rollBack();
            return ['state' => 'paid', 'reason' => 'already_paid'];
        }
        // A payment the owner refunded or voided and recorded in /backends
        // (payment-records.php) is final, as in the KNET twin: no notification,
        // replayed or late, may make it paid again and queue "ship it". Held for
        // a person; the bank's answer stays in the payment log.
        if ($before === 'refunded' || $before === 'voided') {
            $pdo->rollBack();
            return ['state' => 'review', 'reason' => 'order_refunded'];
        }
        if (!cbk_method_ok($cfg, (string) $order['payment_method'])) {
            $paid = false;
            $status = 'review';
        }
        // A capture on an order the shop CANCELLED by hand is held for review,
        // exactly like one whose stock was released: the warehouse was told "do
        // not ship", and a paid mark would queue "ship it" after it. The money is
        // real and stays recorded; the operator reinstates or settles it.
        $cancelledCapture = $paid && (string)$order['fulfilment_status'] === 'cancelled';
        $releasedCapture = $paid && !$cancelledCapture && (int)$order['stock_released'] === 1;
        // RACE K1-8: and the DISCOUNT use, for an order that claimed no stock
        // (so stock_released never turns 1) but was declined and had its code use
        // handed back: a capture after that is held, not marked paid, or the
        // single-use code is spent twice. See the KNET twin.
        $discountCapture = $paid && !$cancelledCapture && !$releasedCapture
            && cbk_discount_given_back($pdo, (int) $order['id']);
        if ($cancelledCapture || $releasedCapture || $discountCapture) {
            $paid = false;
            $status = 'review';
        }
        // A late decline cannot clear an operator hold (including a capture
        // after reservation expiry or after cancellation) or overwrite its
        // reconciliation evidence.
        if ($before === 'review' && !$paid && !$releasedCapture && !$cancelledCapture && !$discountCapture) {
            $pdo->rollBack();
            return ['state' => 'review', 'reason' => 'already_under_review'];
        }

        $sql = 'update orders set payment_status = ?, cbk_status = ?, cbk_message = ?,
                  cbk_paymentid = ?, cbk_transaction = ?, cbk_authcode = ?,
                  cbk_reference = ?, cbk_receipt = ?, cbk_paytype = ?, paid_at = ?
                where track_id = ?';
        if (!$paid) $sql .= " and payment_status <> 'paid'";
        $pdo->prepare($sql)->execute([
            $status,
            (string)($res['Status'] ?? ''),
            $cancelledCapture ? 'ORDER_CANCELLED'
                : ($releasedCapture ? 'STOCK_RESERVATION_RELEASED'
                : ($discountCapture ? 'DISCOUNT_RELEASED' : (string)($res['Message'] ?? ''))),
            (string)($res['PaymentId'] ?? ''), (string)($res['TransactionId'] ?? ''),
            (string)($res['AuthCode'] ?? ''), (string)($res['ReferenceId'] ?? ''),
            (string)($res['ReceiptNo'] ?? ''), (string)($res['PayType'] ?? ''),
            $paid ? gmdate('Y-m-d H:i:s') : null,
            $trackid,
        ]);
        // CBK's own Track ID, in its own statement on purpose: on a database
        // that has not run cbktrack.mysql.sql yet the column is missing, and
        // that must cost the reference, never the settlement above. A
        // savepoint keeps a failed statement from poisoning the transaction.
        $gwTrack = substr(trim((string)($res['TrackId'] ?? '')), 0, 40);
        if ($gwTrack !== '') {
            $pdo->exec('savepoint cbk_trackid');
            try {
                $pdo->prepare('update orders set cbk_trackid = ? where track_id = ?')->execute([$gwTrack, $trackid]);
            } catch (PDOException $e) {
                $pdo->exec('rollback to savepoint cbk_trackid');
                cbk_log($cfg, 'callback.trackid_not_saved', ['trackid' => $trackid, 'error' => $e->getCode()]);
            }
        }
        if ($before !== $status && $status !== 'review') {
            $o = $pdo->prepare('select id from orders where track_id = ?');
            $o->execute([$trackid]);
            if ($orderId = $o->fetchColumn()) {
                // The warehouse follow-up rides this transaction so it
                // cannot go missing — but a MISSING store.php is a
                // deployment error, not a data one, and it must never roll
                // back the record that money was taken. Measured: with the
                // file absent, require_once threw inside the try and the
                // catch rolled the whole payment back to 'pending'.
                $lib = dirname(__DIR__) . '/api/store.php';
                if (!is_file($lib)) $lib = dirname(__DIR__) . '/php-store/store.php';
                if (is_file($lib)) {
                    require_once $lib;
                    store_queue_fulfilment($pdo, (int) $orderId, 'payment');
                }
            }
        }
        if (!$pdo->commit()) throw new RuntimeException('T-Pay settlement commit failed');
        return [
            'state' => $status,
            'reason' => $status === 'review'
                ? (!cbk_method_ok($cfg, (string) $order['payment_method']) ? 'wrong_payment_method'
                    : ($cancelledCapture ? 'order_cancelled'
                    : ($releasedCapture ? 'stock_reservation_released'
                    : ($discountCapture ? 'discount_released' : 'amount_mismatch'))))
                : ($status === 'paid' ? 'captured' : 'bank_declined'),
        ];
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        cbk_log($cfg, 'callback.db_write_failed', ['trackid' => $trackid, 'attempt' => $attempt, 'error' => $e->getMessage()]);
        return ['state' => 'review', 'reason' => 'database_write_failed', 'retry' => cbk_tx_retryable($e)];
    }
}
