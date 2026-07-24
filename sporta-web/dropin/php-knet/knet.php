<?php
// Classic KNET (KPG) direct integration — crypto + helpers (native PHP).
//
// KNET encrypts "trandata" with AES-128-CBC, key = Terminal Resource Key,
// fixed IV "PGKEYENCDECIVSPC", PKCS7 padding, hex-encoded (uppercase).
// Gateway: kpaytest.com.kw (test) / kpay.com.kw (production), /kpg/PaymentHTTP.htm
// Result "CAPTURED" (or "APPROVED") = success.

declare(strict_types=1);

const KNET_IV = 'PGKEYENCDECIVSPC'; // 16 bytes, fixed by KNET

// Reject non-HTTPS (honours Hostinger's X-Forwarded-Proto proxy header).
function knet_require_https(): void
{
    $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
    if (!$https) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Secure connection (HTTPS) required.');
    }
}

function knet_gateway_url(array $cfg): string
{
    return $cfg['env'] === 'production' ? $cfg['production_url'] : $cfg['test_url'];
}

function knet_encrypt(string $plain, string $resourceKey): string
{
    $enc = openssl_encrypt($plain, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, KNET_IV);
    if ($enc === false) {
        throw new RuntimeException('KNET encrypt failed');
    }
    return strtoupper(bin2hex($enc));
}

function knet_decrypt(string $hex, string $resourceKey): string
{
    $raw = @hex2bin($hex);
    if ($raw === false) {
        throw new RuntimeException('KNET response is not valid hex');
    }
    $dec = openssl_decrypt($raw, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, KNET_IV);
    if ($dec === false) {
        throw new RuntimeException('KNET decrypt failed');
    }
    return $dec;
}

function knet_build_trandata(array $fields): string
{
    $parts = [];
    foreach ($fields as $k => $v) {
        $parts[] = $k . '=' . urlencode((string) $v);
    }
    return implode('&', $parts);
}

function knet_parse_response(string $qs): array
{
    $out = [];
    foreach (explode('&', $qs) as $pair) {
        if ($pair === '') {
            continue;
        }
        $kv = explode('=', $pair, 2);
        $out[$kv[0]] = isset($kv[1]) ? urldecode($kv[1]) : '';
    }
    return $out;
}

// Read an order's server-authoritative amount from Supabase by track id.
// Returns the amount string, or null if not found / DB not configured.
function knet_order_amount(array $cfg, string $trackid): ?string
{
    if (($cfg['supabase_url'] ?? '') === '' || ($cfg['supabase_service_key'] ?? '') === '') {
        return null;
    }
    $url = rtrim($cfg['supabase_url'], '/') . '/rest/v1/'
        . rawurlencode($cfg['orders_table'])
        . '?select=amount&' . $cfg['orders_match_column'] . '=eq.' . rawurlencode($trackid);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . $cfg['supabase_service_key'],
            'Authorization: Bearer ' . $cfg['supabase_service_key'],
        ],
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    if ($body === false) {
        return null;
    }
    $rows = json_decode((string) $body, true);
    return isset($rows[0]['amount']) ? (string) $rows[0]['amount'] : null;
}
