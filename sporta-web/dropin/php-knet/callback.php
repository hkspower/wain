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
$trandata = (string)($_REQUEST['trandata'] ?? '');

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

$haveDb = $cfg['supabase_url'] !== '' && $cfg['supabase_service_key'] !== '' && $trackid !== '';

// Amount verification: the amount KNET charged must match the order.
if ($paid && $haveDb) {
    $expected = knet_order_amount($cfg, $trackid);
    if ($expected !== null && $paidAmt !== '' && abs((float) $expected - (float) $paidAmt) >= 0.001) {
        $paid = false;
        $result = 'AMOUNT_MISMATCH';
    }
}

if ($haveDb) {
    knet_update_order($cfg, $trackid, $paid, $result, $fields);
}

$status = $paid ? 'success' : ($result === 'CANCELED' || $result === 'CANCELLED' ? 'cancelled' : 'failed');
$q = http_build_query(['status' => $status, 'trackid' => $trackid, 'payid' => $paymentid, 'ref' => $ref]);
header('Location: ' . $return . '?' . $q, true, 302);
exit;

function knet_update_order(array $cfg, string $trackid, bool $paid, string $result, array $fields): void
{
    $url = rtrim($cfg['supabase_url'], '/') . '/rest/v1/'
        . rawurlencode($cfg['orders_table'])
        . '?' . $cfg['orders_match_column'] . '=eq.' . rawurlencode($trackid);

    $payload = json_encode([
        'payment_status' => $paid ? 'paid' : 'failed',
        'knet_result'    => $result,
        'knet_paymentid' => (string)($fields['paymentid'] ?? ''),
        'knet_tranid'    => (string)($fields['tranid'] ?? ''),
        'knet_ref'       => (string)($fields['ref'] ?? ''),
        'knet_auth'      => (string)($fields['auth'] ?? ''),
        'paid_at'        => $paid ? gmdate('c') : null,
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
