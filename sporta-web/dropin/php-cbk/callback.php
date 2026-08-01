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

if ($encrp === '') {
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
