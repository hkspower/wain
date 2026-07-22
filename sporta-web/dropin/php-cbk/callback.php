<?php
// CBK T-Pay response handler. CBK posts the encrypted result here.
// Decrypts, verifies, optionally updates the order, then redirects the
// customer to your React result page.
//
// Register THIS URL with CBK as your responseURL/errorURL.

declare(strict_types=1);
require __DIR__ . '/knet.php';
$cfg = require __DIR__ . '/config.php';

$trandata = (string)($_REQUEST['trandata'] ?? '');
$return   = $cfg['return_url'];

if ($trandata === '') {
    header('Location: ' . $return . '?status=error&reason=missing_data', true, 302);
    exit;
}

try {
    $plain  = knet_decrypt($trandata, $cfg['resource_key']);
    $fields = knet_parse_response($plain);
} catch (Throwable $e) {
    header('Location: ' . $return . '?status=error&reason=decrypt_failed', true, 302);
    exit;
}

$result    = strtoupper((string)($fields['result'] ?? ''));
$paid      = ($result === 'CAPTURED' || $result === 'APPROVED');
$trackid   = (string)($fields['trackid'] ?? '');
$paymentid = (string)($fields['paymentid'] ?? '');
$ref       = (string)($fields['ref'] ?? '');

// Optional: update the order in Supabase (best-effort, never blocks redirect).
if ($paid && $trackid !== '' && $cfg['supabase_url'] !== '' && $cfg['supabase_service_key'] !== '') {
    update_supabase_order($cfg, $trackid, $result, $fields);
}

$status = $paid ? 'success' : 'failed';
$q = http_build_query([
    'status'  => $status,
    'trackid' => $trackid,
    'payid'   => $paymentid,
    'ref'     => $ref,
]);
header('Location: ' . $return . '?' . $q, true, 302);
exit;

function update_supabase_order(array $cfg, string $trackid, string $result, array $fields): void
{
    $url = rtrim($cfg['supabase_url'], '/')
        . '/rest/v1/' . rawurlencode($cfg['orders_table'])
        . '?' . $cfg['orders_match_column'] . '=eq.' . rawurlencode($trackid);

    $payload = json_encode([
        'payment_status' => 'paid',
        'knet_result'    => $result,
        'knet_paymentid' => (string)($fields['paymentid'] ?? ''),
        'knet_tranid'    => (string)($fields['tranid'] ?? ''),
        'knet_ref'       => (string)($fields['ref'] ?? ''),
        'knet_auth'      => (string)($fields['auth'] ?? ''),
        'paid_at'        => gmdate('c'),
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
