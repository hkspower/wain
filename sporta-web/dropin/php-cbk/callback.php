<?php
// CBK return URL. The gateway redirects the customer here with ?encrp=...
// We verify the transaction via the API, record it, then redirect the
// customer to the React result page.

declare(strict_types=1);
require __DIR__ . '/cbk.php';
cbk_require_https(); // reject non-HTTPS callbacks
$cfg = require __DIR__ . '/config.php';

$return = $cfg['result_page_url'];
$encrp  = (string)($_REQUEST['encrp'] ?? '');

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
$errorCode  = strtoupper(trim((string)($_REQUEST['ErrorCode'] ?? $_REQUEST['errorcode'] ?? '')));
$errorTrack = trim((string)($_REQUEST['PayTrackID'] ?? $_REQUEST['paytrackid'] ?? ''));

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
    if ($errorCode === 'TIJ0009' && !empty($cfg['token_cache_file'])) {
        @unlink($cfg['token_cache_file']);
    }

    if ($errorTrack !== '') {
        cbk_update_order($cfg, $errorTrack, false, [
            'Status'  => '2',
            'Message' => $errorCode . ' ' . $meaning,
            'PayType' => 'CBK',
        ]);
    }
    header('Location: ' . $return . '?status=failed&reason=' . rawurlencode($errorCode), true, 302);
    exit;
}

if ($encrp === '') {
    cbk_log($cfg, 'callback.no_encrp', ['query' => array_keys($_REQUEST)]);
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

// Payment Result Status Code: 1=Success, 2=Failed, 3=Expired/Cancelled, 0/-1=Invalid
$statusCode = (string)($res['Status'] ?? '');
$paid       = $statusCode === '1';
$trackid    = (string)($res['TrackId'] ?? ($res['PayId'] ?? ''));
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
                }
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    }
}
