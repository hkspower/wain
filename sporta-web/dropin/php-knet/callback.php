<?php
// KNET response handler. KNET posts the encrypted trandata here after payment.
// Decrypts, verifies CAPTURED + amount, updates the order, redirects the
// customer to the React result page.
//
// Register THIS URL with your bank/KNET as responseURL and errorURL.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
$cfg = require __DIR__ . '/config.php';

$return   = $cfg['result_page_url'];
$in       = $_POST + $_GET;
$trandata = (string)($in['trandata'] ?? '');

if ($trandata === '') {
    header('Location: ' . $return . '?status=error&reason=missing_data', true, 302);
    exit;
}

try {
    $fields = knet_parse_response(knet_decrypt($trandata, $cfg['resource_key']));
} catch (Throwable $e) {
    header('Location: ' . $return . '?status=error&reason=decrypt_failed', true, 302);
    exit;
}

$result    = strtoupper((string)($fields['result'] ?? ''));
$paid      = ($result === 'CAPTURED' || $result === 'APPROVED');
$trackid   = (string)($fields['trackid'] ?? '');
$paymentid = (string)($fields['paymentid'] ?? '');
$ref       = (string)($fields['ref'] ?? '');
$paidAmt   = (string)($fields['amt'] ?? ($fields['Amt'] ?? ''));

$haveDb = knet_db_configured($cfg) && $trackid !== '';

knet_log($cfg, 'callback.received', [
    'trackid' => $trackid, 'result' => $result, 'amt' => $paidAmt, 'payid' => $paymentid,
]);

// ---------------------------------------------------------------------------
// Amount verification — FAIL CLOSED.
//
// Previously an unverifiable amount (database down, order missing, or KNET not
// echoing 'amt') skipped the comparison entirely and the order was still
// marked PAID. Now anything we cannot positively verify is held for review
// instead of being trusted.
// ---------------------------------------------------------------------------
$review = false;
if ($paid && $haveDb) {
    $lookup = knet_order_lookup($cfg, $trackid);
    if ($lookup['state'] !== 'found' || $paidAmt === '') {
        $paid = false;
        $review = true;
        $result = 'UNVERIFIED_' . strtoupper($lookup['state']);
        knet_log($cfg, 'callback.unverified', ['trackid' => $trackid, 'state' => $lookup['state']]);
    } elseif (abs((float) $lookup['amount'] - (float) $paidAmt) >= 0.001) {
        $paid = false;
        $result = 'AMOUNT_MISMATCH';
        knet_log($cfg, 'callback.amount_mismatch', [
            'trackid' => $trackid, 'expected' => $lookup['amount'], 'paid' => $paidAmt,
        ]);
    }
}

if ($haveDb) {
    $ok = knet_update_order($cfg, $trackid, $paid, $result, $fields, $review);
    if (!$ok) {
        // The bank may well have taken the money; if we cannot record it the
        // order must never be lost silently.
        knet_log($cfg, 'callback.db_write_failed', [
            'trackid' => $trackid, 'result' => $result, 'paid' => $paid, 'payid' => $paymentid,
        ]);
    }
}

$status = $paid
    ? 'success'
    : ($review ? 'review' : (($result === 'CANCELED' || $result === 'CANCELLED') ? 'cancelled' : 'failed'));
$q = http_build_query(['status' => $status, 'trackid' => $trackid, 'payid' => $paymentid, 'ref' => $ref]);
header('Location: ' . $return . '?' . $q, true, 302);
exit;

// Returns true only if the order row was actually updated. The old version
// discarded the curl result entirely, so a failed write left the customer on a
// "success" page with no paid order recorded anywhere.
function knet_update_order(array $cfg, string $trackid, bool $paid, string $result, array $fields, bool $review = false): bool
{
    // NATIVE MODE. When knet/config.php carries a 'store' => 'mysql' block the
    // bank's answer is written to the MySQL orders table on this same host —
    // no Supabase anywhere in the payment path. Everything the Supabase branch
    // learned the hard way is kept: never downgrade paid, exact column names,
    // report failure honestly so the customer is not shown success over an
    // unrecorded payment. The warehouse follow-up rides the same transaction.
    if (($cfg['store'] ?? '') === 'mysql') {
        try {
            $pdo = new PDO(
                "mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4",
                $cfg['mysql_user'], $cfg['mysql_pass'],
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $pdo->beginTransaction();
            $sql = 'update orders set payment_status = ?, cbk_status = ?, cbk_message = ?,
                      cbk_paymentid = ?, cbk_transaction = ?, cbk_reference = ?,
                      cbk_authcode = ?, cbk_receipt = ?, cbk_paytype = ?, paid_at = ?
                    where track_id = ?';
            if (!$paid) $sql .= " and payment_status <> 'paid'";
            $st = $pdo->prepare($sql);
            $st->execute([
                $paid ? 'paid' : ($review ? 'review' : 'failed'),
                $result,
                (string)($fields['result'] ?? ''), (string)($fields['paymentid'] ?? ''),
                (string)($fields['tranid'] ?? ''), (string)($fields['ref'] ?? ''),
                (string)($fields['auth'] ?? ''), (string)($fields['receipt'] ?? ''),
                (string)($fields['paytype'] ?? ''),
                $paid ? gmdate('Y-m-d H:i:s') : null,
                $trackid,
            ]);
            $updated = $st->rowCount() > 0;
            if ($updated && ($paid || !$review)) {
                // The ship-it / do-not-ship follow-up, queued in the same
                // transaction as the status it reports.
                $o = $pdo->prepare('select id from orders where track_id = ?');
                $o->execute([$trackid]);
                if ($orderId = $o->fetchColumn()) {
                    // public_html layout first (knet/ and api/ are
                    // siblings); repo layout second, for the test rig.
                    $storeLib = dirname(__DIR__) . '/api/store.php';
                    if (!is_file($storeLib)) $storeLib = dirname(__DIR__) . '/php-store/store.php';
                    require_once $storeLib;
                    store_queue_fulfilment($pdo, (int)$orderId, 'payment');
                }
            }
            $pdo->commit();
            return $updated;
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
            return false;
        }
    }

    $url = rtrim($cfg['supabase_url'], '/') . '/rest/v1/'
        . rawurlencode($cfg['orders_table'])
        . '?' . rawurlencode($cfg['orders_match_column']) . '=eq.' . rawurlencode($trackid);

    // Never downgrade an already-paid order: a replayed or late failure
    // callback must not flip a captured payment back to failed.
    if (!$paid) {
        $url .= '&payment_status=neq.paid';
    }

    // Column names must match supabase/schema.sql exactly. They are cbk_* —
    // the acquirer is CBK, KNET is the scheme. This block used to write
    // knet_result / knet_paymentid / knet_tranid / knet_ref / knet_auth, none
    // of which exist, so PostgREST rejected the whole PATCH with PGRST204 and
    // NOTHING was written: not payment_status, not paid_at, nothing. The bank
    // captured the money, the customer was redirected to ?status=success, and
    // the order sat at 'pending' forever with no record for the admin to ship
    // from. Verified against a real PostgreSQL loaded with schema.sql:
    // "column knet_result of relation orders does not exist".
    $payload = json_encode([
        'payment_status'  => $paid ? 'paid' : ($review ? 'review' : 'failed'),
        'cbk_status'      => $result,
        'cbk_message'     => (string)($fields['result'] ?? ''),
        'cbk_paymentid'   => (string)($fields['paymentid'] ?? ''),
        'cbk_transaction' => (string)($fields['tranid'] ?? ''),
        'cbk_reference'   => (string)($fields['ref'] ?? ''),
        'cbk_authcode'    => (string)($fields['auth'] ?? ''),
        'cbk_receipt'     => (string)($fields['receipt'] ?? ''),
        'cbk_paytype'     => (string)($fields['paytype'] ?? ''),
        'paid_at'         => $paid ? gmdate('c') : null,
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'apikey: ' . $cfg['supabase_service_key'],
            'Authorization: Bearer ' . $cfg['supabase_service_key'],
            'Prefer: return=minimal',
        ],
    ]);
    // One retry: a transient network blip must not lose a captured payment.
    $ok = false;
    for ($attempt = 1; $attempt <= 2; $attempt++) {
        $res  = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($res !== false && $code >= 200 && $code < 300) {
            $ok = true;
            break;
        }
        if ($attempt === 1) {
            sleep(1);
        }
    }
    curl_close($ch);
    return $ok;
}
