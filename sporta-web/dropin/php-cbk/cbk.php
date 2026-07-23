<?php
// CBK Hosted KNET & T-Pay — REST-JSON helper library.
// Implements the auth-token, checkout URL, and transaction-verify calls from
// the CBK Integration & Reference Manual v2.93.

declare(strict_types=1);

// Reject any non-HTTPS request outright. Honors Hostinger's proxy header
// (X-Forwarded-Proto) as well as the standard HTTPS server var.
function cbk_require_https(): void
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

function cbk_base(array $cfg): string
{
    return rtrim($cfg['env'] === 'production' ? $cfg['production_base'] : $cfg['test_base'], '/');
}

// Read an order's server-authoritative amount from Supabase by track id.
// Returns the amount string, or null if not found / DB not configured.
function cbk_order_amount(array $cfg, string $trackid): ?string
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

// Basic auth header value: base64("ClientId:ClientSecret").
function cbk_basic_auth(array $cfg): string
{
    return 'Basic ' . base64_encode($cfg['client_id'] . ':' . $cfg['client_secret']);
}

// Low-level HTTPS request (TLS 1.2). Returns [httpStatus, decodedJsonOrRaw].
function cbk_http(string $method, string $url, array $cfg, ?array $json = null, bool $expectJson = true): array
{
    $ch = curl_init($url);
    $headers = ['Authorization: ' . cbk_basic_auth($cfg)];
    $opts = [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSLVERSION     => CURL_SSLVERSION_TLSv1_2,
    ];
    if ($json !== null) {
        $headers[] = 'Content-Type: application/json';
        $opts[CURLOPT_POSTFIELDS] = json_encode($json);
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false) {
        return [0, null];
    }
    return [$status, $expectJson ? json_decode((string) $body, true) : $body];
}

// Get a valid AccessToken, reusing the cached one until it nears its 2h expiry.
function cbk_get_access_token(array $cfg): string
{
    $file = $cfg['token_cache_file'];
    if (is_readable($file)) {
        $cached = json_decode((string) file_get_contents($file), true);
        // Refresh a little early (100 min) to stay well within the 2h window.
        if (isset($cached['token'], $cached['ts']) && (time() - $cached['ts']) < 100 * 60) {
            return (string) $cached['token'];
        }
    }

    $url = cbk_base($cfg) . '/ePay/api/cbk/online/pg/merchant/Authenticate';
    [$status, $res] = cbk_http('POST', $url, $cfg, [
        'ClientId'     => $cfg['client_id'],
        'ClientSecret' => $cfg['client_secret'],
        'ENCRP_KEY'    => $cfg['encrp_key'],
    ]);

    if ($status !== 200 || !is_array($res) || ($res['Status'] ?? '') !== '1' || empty($res['AccessToken'])) {
        $msg = is_array($res) ? ($res['Message'] ?? 'unknown') : 'no response';
        throw new RuntimeException('CBK auth failed (' . $status . '): ' . $msg);
    }

    $token = (string) $res['AccessToken'];
    @file_put_contents($file, json_encode(['token' => $token, 'ts' => time()]));
    @chmod($file, 0600);
    return $token;
}

// Verify/fetch a transaction result using the encrp value from the return URL.
// Returns the decoded JSON (Status: 1=success, 2=failed, 3=expired/cancelled).
function cbk_get_transaction(array $cfg, string $encrp, string $token): ?array
{
    $url = cbk_base($cfg) . '/ePay/api/cbk/online/pg/GetTransactions/'
        . rawurlencode($encrp) . '/' . rawurlencode($token);
    [$status, $res] = cbk_http('GET', $url, $cfg);
    return ($status === 200 && is_array($res)) ? $res : null;
}

// Fallback verification by track id (POST /Verify) if encrp is missing.
function cbk_verify_by_track(array $cfg, string $trackId, string $token): ?array
{
    $url = cbk_base($cfg) . '/ePay/api/cbk/online/pg/Verify';
    [$status, $res] = cbk_http('POST', $url, $cfg, [
        'encrypmerch' => $cfg['encrp_key'],
        'authkey'     => $token,
        'payid'       => $trackId,
    ]);
    return ($status === 200 && is_array($res)) ? $res : null;
}
