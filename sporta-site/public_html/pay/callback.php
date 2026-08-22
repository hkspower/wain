<?php
// CBK return URL. The gateway redirects the customer here with ?encrp=...
// We verify the transaction via the API, record it, then redirect the
// customer to the React result page.

declare(strict_types=1);
require __DIR__ . '/cbk.php';
cbk_require_https(); // reject non-HTTPS callbacks
$cfg = cbk_config();

// GET and POST only — see the note at the top of pay.php. The gateway returns
// the customer here by redirect or by form post; a cookie is not one of the
// ways CBK can speak, and $_REQUEST would let one shadow what CBK actually
// said. `encrp` is verified against the API before anything is believed, so a
// forged one is not fatal on its own — but ErrorCode and PayTrackID below are
// read straight out of this array.
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
        $stamp = $cfg['token_cache_file'] . '.purged';
        $last  = is_file($stamp) ? (int) @file_get_contents($stamp) : 0;
        if (time() - $last > 600) {
            @file_put_contents($stamp, (string) time());
            @unlink($cfg['token_cache_file']);
        } else {
            cbk_log($cfg, 'callback.purge_throttled', ['since' => time() - $last]);
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
// So: throw the cached token away, mint a fresh one, ask exactly once more,
// and if it still will not answer, LEAVE THE ORDER ALONE. Pending is honest.
// Failed is a claim, and this code is not in a position to make it.
if (in_array((string)($res['Status'] ?? ''), ['0', '-1'], true)) {
    cbk_log($cfg, 'callback.stale_token', ['status' => $res['Status'] ?? '']);
    if (!empty($cfg['token_cache_file'])) @unlink($cfg['token_cache_file']);
    try {
        $res = cbk_get_transaction($cfg, $encrp, cbk_get_access_token($cfg)) ?? $res;
    } catch (Throwable $e) {
        // fall through to the check below
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
$trackid    = cbk_resolve_track($cfg, $trackid);
// CBK's own reference, kept for reconciliation against the bank statement.
$gatewayTrack = (string)($res['TrackId'] ?? '');
$paymentId  = (string)($res['PaymentId'] ?? '');
$ref        = (string)($res['ReferenceId'] ?? '');
$paidAmount = (string)($res['Amount'] ?? '');

$haveDb = cbk_db_configured($cfg) && $trackid !== '';

cbk_log($cfg, 'callback.received', [
    'trackid' => $trackid, 'status' => $statusCode, 'amt' => $paidAmount, 'payid' => $paymentId,
]);

// SECURITY — amount verification. Confirm the amount CBK actually charged
// matches the amount recorded for this order. If they differ, the amount was
// tampered with: refuse to mark the order paid.
if ($paid && $haveDb) {
    $expected = cbk_order_expected_amount($cfg, $trackid);
    if ($expected !== null && !amounts_equal($expected, $paidAmount)) {
        $paid = false;
        $statusCode = 'amount_mismatch';
        cbk_log($cfg, 'callback.amount_mismatch', [
            'trackid' => $trackid, 'expected' => $expected, 'paid' => $paidAmount,
        ]);
    }
}

// Persist the result (the manual requires merchants to save it).
if ($haveDb) {
    cbk_update_order($cfg, $trackid, $paid, $res);
}

$status = $paid ? 'success' : ($statusCode === '3' ? 'cancelled' : 'failed');
$q = http_build_query([
    'status'  => $status,
    'trackid' => $trackid,
    'payid'   => $paymentId,
    'ref'     => $ref,
]);
header('Location: ' . $return . '?' . $q, true, 302);
exit;

// Compare two KWD amounts robustly (3-decimal tolerance).
function amounts_equal(string $a, string $b): bool
{
    return abs((float) $a - (float) $b) < 0.001;
}

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

function cbk_update_order(array $cfg, string $trackid, bool $paid, array $res): void
{
    $status = $paid ? 'paid' : ((string)($res['Status'] ?? '') === '1' ? 'review' : 'failed');

    // Mirrors the KNET dropin exactly, including the parts it learned the hard
    // way: never downgrade a paid order, never re-stamp or re-notify on a
    // replay, and queue the warehouse follow-up in the SAME transaction as the
    // status it reports.
    try {
        $pdo = cbk_pdo($cfg);
        $pdo->beginTransaction();
        $cur = $pdo->prepare('select payment_status from orders where track_id = ?');
        $cur->execute([$trackid]);
        $before = $cur->fetchColumn();
        if ($before === false) { $pdo->rollBack(); return; }
        if ($before === 'paid' && $paid) { $pdo->rollBack(); return; }

        $sql = 'update orders set payment_status = ?, cbk_status = ?, cbk_message = ?,
                  cbk_paymentid = ?, cbk_transaction = ?, cbk_authcode = ?,
                  cbk_reference = ?, cbk_receipt = ?, cbk_paytype = ?, paid_at = ?
                where track_id = ?';
        if (!$paid) $sql .= " and payment_status <> 'paid'";
        $pdo->prepare($sql)->execute([
            $status,
            (string)($res['Status'] ?? ''), (string)($res['Message'] ?? ''),
            (string)($res['PaymentId'] ?? ''), (string)($res['TransactionId'] ?? ''),
            (string)($res['AuthCode'] ?? ''), (string)($res['ReferenceId'] ?? ''),
            (string)($res['ReceiptNo'] ?? ''), (string)($res['PayType'] ?? ''),
            $paid ? gmdate('Y-m-d H:i:s') : null,
            $trackid,
        ]);
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
                    // And the books, on the same terms — mirrored from the
                    // KNET dropin, as every rule here is. store_post_to_ledger
                    // swallows its own failures for the reason above: a
                    // bookkeeping problem must never roll back the record that
                    // the bank took the money. A paid order that did not post
                    // is listed on the Accounting screen until it does.
                    if ($paid) store_post_to_ledger($pdo, (int) $orderId);
                }
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    }
}
