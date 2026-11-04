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
    knet_send_customer_onward($cfg, $return . '?status=error&reason=' . (isset($in['Error']) || isset($in['ErrorText']) ? 'bank_error' : 'missing_data'));
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
        : (($result === 'CANCELED' || $result === 'CANCELLED') ? 'cancelled' : 'failed'));
$query = ['status' => $status, 'trackid' => $trackid, 'payid' => $paymentid, 'ref' => $ref];
if ($status === 'review') $query['reason'] = $settlement['reason'];
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

// Return ['state' => 'paid'|'failed'|'review', 'reason' => string]. A new paid
// result is returned only after commit. An already-paid KNET order also returns
// paid, without rewriting it or queueing any success/failure side effect.
//
// RACE K1-7: THE BANK DOES NOT CALL BACK TWICE, so a captured payment that met
// a lock-wait timeout (1205: an admin screen, the sweeper or a long report held
// the order row for more than the database's wait) or lost a deadlock (1213)
// used to be filed as "review" with the order left PENDING and the money taken;
// two hours later the sweeper gave its stock away. The settlement is one
// transaction that rolls back completely, so it is run again, from the top, up
// to KNET_SETTLE_ATTEMPTS times in all, with a short growing pause. Only those
// two errors are retried; everything else still fails closed to review.
// (KNET_SETTLE_ATTEMPTS is defined in knet.php: this file's top-level code ends
// with exit;, and a const declared below that line would never be executed.)
function knet_settle_order(
    array $cfg,
    string $trackid,
    bool $bankPaid,
    string $result,
    string $paidAmount,
    array $fields
): array
{
    for ($attempt = 1; ; $attempt++) {
        $out = knet_settle_order_once($cfg, $trackid, $bankPaid, $result, $paidAmount, $fields, $attempt);
        if (empty($out['retry']) || $attempt >= KNET_SETTLE_ATTEMPTS) {
            unset($out['retry']);
            return $out;
        }
        usleep(random_int(40, 160) * 1000 * $attempt);
    }
}

function knet_settle_order_once(
    array $cfg,
    string $trackid,
    bool $bankPaid,
    string $result,
    string $paidAmount,
    array $fields,
    int $attempt
): array
{
    try {
        $pdo = knet_pdo($cfg);
        // Wait at most 8 s for a row lock (never longer than the database's own
        // setting, 50 s by default): three attempts then take about 25 s at the
        // worst, where one wait used to take 50 s and end in "review".
        $pdo->exec('set session innodb_lock_wait_timeout = least(@@session.innodb_lock_wait_timeout, 8)');
        $pdo->beginTransaction();

        // Lock first so amount/status/method verification and settlement see
        // one state even when the bank retries concurrently.
        $cur = $pdo->prepare(
            'select id, amount, payment_status, payment_method, stock_released, fulfilment_status
               from orders where track_id = ? for update'
        );
        $cur->execute([$trackid]);
        $order = $cur->fetch(PDO::FETCH_ASSOC);
        if (!$order) {
            $pdo->rollBack();
            return ['state' => 'review', 'reason' => 'order_not_found'];
        }
        $before = (string) $order['payment_status'];
        $methodMatches = ((string) $order['payment_method'] === 'knet');

        // Any replay or late failure after a durable payment is a no-op. This
        // prevents both a downgrade and the old duplicate "do not ship" queue.
        if ($before === 'paid' && $methodMatches) {
            $pdo->rollBack();
            return ['state' => 'paid', 'reason' => 'already_paid'];
        }

        $recordResult = $result;
        $reason = $bankPaid ? 'captured' : 'bank_declined';
        if (!$methodMatches) {
            // A valid KNET callback for a T-Pay/COD order may mean money moved
            // through the wrong rail. Hold an unpaid order and preserve the
            // bank references for an operator; never mark it paid or trigger
            // fulfilment. An order already paid elsewhere stays paid.
            if ($before === 'paid') {
                $pdo->rollBack();
                return ['state' => 'review', 'reason' => 'wrong_payment_method'];
            }
            if ($before === 'review') {
                $pdo->rollBack();
                return ['state' => 'review', 'reason' => 'already_under_review'];
            }
            $after = 'review';
            $recordResult = 'WRONG_PAYMENT_METHOD';
            $reason = 'wrong_payment_method';
        } elseif ($bankPaid) {
            $expectedFils = knet_amount_fils((string) $order['amount']);
            $paidFils = knet_amount_fils($paidAmount);
            if (trim((string)($fields['paymentid'] ?? '')) === '') {
                $after = 'review';
                $recordResult = 'MISSING_PAYMENT_ID';
                $reason = 'missing_payment_id';
            } elseif ($expectedFils === null || $expectedFils <= 0) {
                $after = 'review';
                $recordResult = 'INVALID_ORDER_AMOUNT';
                $reason = 'invalid_order_amount';
            } elseif ($paidFils === null || $paidFils <= 0) {
                $after = 'review';
                $recordResult = 'INVALID_CAPTURED_AMOUNT';
                $reason = 'invalid_captured_amount';
            } elseif ($expectedFils !== $paidFils) {
                $after = 'review';
                $recordResult = 'AMOUNT_MISMATCH';
                $reason = 'amount_mismatch';
            } elseif ((string)$order['fulfilment_status'] === 'cancelled') {
                // The shop cancelled this order by hand and the warehouse was
                // told "do not ship". The bank's capture is real money, but a
                // paid mark here would queue "PAYMENT CONFIRMED - ship it" after
                // that do-not-ship. The payment is held for the operator: the
                // order is reinstated (or not) and then settled by hand.
                $after = 'review';
                $recordResult = 'ORDER_CANCELLED';
                $reason = 'order_cancelled';
            } elseif ((int)$order['stock_released'] === 1) {
                // Money may arrive after the reservation expired. Those
                // garments are for sale again, so an operator must reconcile
                // stock/refund before this payment may authorize fulfilment.
                $after = 'review';
                $recordResult = 'STOCK_RESERVATION_RELEASED';
                $reason = 'stock_reservation_released';
            } elseif (knet_discount_given_back($pdo, (int) $order['id'])) {
                // RACE K1-8: the same rule for the DISCOUNT. An order with no
                // sized garments claims no stock, so stock_released stays 0
                // however long it waits, but its code use is handed back the
                // moment it is declined (store_discount_release). A second bank
                // page that captures AFTER that would mark it paid while the
                // use belongs to somebody else: a single-use code spent twice.
                // Held for review instead; settling it by hand re-claims the use
                // (store_order_reclaim) or refuses if the code has since run out.
                $after = 'review';
                $recordResult = 'DISCOUNT_RELEASED';
                $reason = 'discount_released';
            } else {
                $after = 'paid';
            }
        } else {
            // Once an order is under review, a later failure must not release
            // stock, overwrite reconciliation data, or queue a "do not ship"
            // message. Only a verified capture or an operator may resolve it.
            if ($before === 'review') {
                $pdo->rollBack();
                return ['state' => 'review', 'reason' => 'already_under_review'];
            } elseif (!in_array($result, ['NOT CAPTURED', 'CANCELED', 'CANCELLED'], true)) {
                $after = 'review';
                $recordResult = 'UNRECOGNIZED_RESULT';
                $reason = 'unrecognized_bank_result';
            } else {
                $after = 'failed';
            }
        }

        $sql = 'update orders set payment_status = ?, cbk_status = ?, cbk_message = ?,
                  cbk_paymentid = ?, cbk_transaction = ?, cbk_reference = ?,
                  cbk_authcode = ?, cbk_receipt = ?, cbk_paytype = ?, paid_at = ?
                where id = ?';
        $st = $pdo->prepare($sql);
        $st->execute([
            $after,
            $recordResult,
            (string)($fields['result'] ?? ''), (string)($fields['paymentid'] ?? ''),
            (string)($fields['tranid'] ?? ''), (string)($fields['ref'] ?? ''),
            (string)($fields['auth'] ?? ''), (string)($fields['receipt'] ?? ''),
            (string)($fields['paytype'] ?? ''),
            $after === 'paid' ? gmdate('Y-m-d H:i:s') : null,
            (int) $order['id'],
        ]);

        // rowCount() may be zero for an exact replay. Verify the state instead
        // of treating "unchanged" as "not written".
        $verify = $pdo->prepare('select payment_status, cbk_status from orders where id = ?');
        $verify->execute([(int) $order['id']]);
        $stored = $verify->fetch(PDO::FETCH_ASSOC);
        if (!$stored || (string) $stored['payment_status'] !== $after
            || (string) $stored['cbk_status'] !== $recordResult) {
            throw new RuntimeException('KNET settlement did not persist');
        }

        // Queue only a real transition. Replays and review states have no
        // fulfilment side effect.
        if ($before !== $after && ($after === 'paid' || $after === 'failed')) {
            // The ship-it / do-not-ship follow-up, queued in the same
            // transaction as the status it reports.
            $storeLib = dirname(__DIR__) . '/api/store.php';
            if (!is_file($storeLib)) $storeLib = dirname(__DIR__) . '/php-store/store.php';
            if (is_file($storeLib)) {
                require_once $storeLib;
                store_queue_fulfilment($pdo, (int) $order['id'], 'payment');
            }
        }

        if (!$pdo->commit()) {
            throw new RuntimeException('KNET settlement commit failed');
        }
        return ['state' => $after, 'reason' => $reason];
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        knet_log($cfg, 'callback.db_write_failed', [
            'trackid' => $trackid,
            'result' => $result,
            'payid' => (string)($fields['paymentid'] ?? ''),
            'attempt' => $attempt,
            'error' => $e->getMessage(),
        ]);
        return ['state' => 'review', 'reason' => 'database_write_failed', 'retry' => knet_tx_retryable($e)];
    }
}

// Has this order's discount use already been handed back? Read under the order's
// row lock, in the settlement transaction. A database that never had
// discount-release.mysql.sql has no such column and nothing was ever returned
// (error 1054, a statement error that leaves the transaction open).
function knet_discount_given_back(PDO $pdo, int $orderId): bool
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
