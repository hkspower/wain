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

// Persist the full result (the manual requires merchants to save it).
if ($cfg['supabase_url'] !== '' && $cfg['supabase_service_key'] !== '' && $trackid !== '') {
    cbk_update_supabase($cfg, $trackid, $paid, $res);
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

function cbk_update_supabase(array $cfg, string $trackid, bool $paid, array $res): void
{
    $url = rtrim($cfg['supabase_url'], '/') . '/rest/v1/'
        . rawurlencode($cfg['orders_table'])
        . '?' . $cfg['orders_match_column'] . '=eq.' . rawurlencode($trackid);

    $payload = json_encode([
        'payment_status'  => $paid ? 'paid' : 'failed',
        'cbk_status'      => (string)($res['Status'] ?? ''),
        'cbk_message'     => (string)($res['Message'] ?? ''),
        'cbk_paymentid'   => (string)($res['PaymentId'] ?? ''),
        'cbk_transaction' => (string)($res['TransactionId'] ?? ''),
        'cbk_authcode'    => (string)($res['AuthCode'] ?? ''),
        'cbk_reference'   => (string)($res['ReferenceId'] ?? ''),
        'cbk_receipt'     => (string)($res['ReceiptNo'] ?? ''),
        'cbk_paytype'     => (string)($res['PayType'] ?? ''),
        'amount'          => (string)($res['Amount'] ?? ''),
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
    curl_exec($ch);
    curl_close($ch);
}
