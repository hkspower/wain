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

// AES-128 needs a 16-byte key. PHP would otherwise pad/truncate silently and
// KNET would reject the trandata with no explanation.
function knet_assert_key(string $resourceKey): void
{
    if (strlen($resourceKey) !== 16) {
        throw new RuntimeException('resource_key must be exactly 16 bytes for AES-128 (got ' . strlen($resourceKey) . ')');
    }
}

function knet_encrypt(string $plain, string $resourceKey): string
{
    knet_assert_key($resourceKey);
    $enc = openssl_encrypt($plain, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, KNET_IV);
    if ($enc === false) {
        throw new RuntimeException('KNET encrypt failed');
    }
    return strtoupper(bin2hex($enc));
}

function knet_decrypt(string $hex, string $resourceKey): string
{
    knet_assert_key($resourceKey);
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

// Append-only audit log. Payments must leave a trail: without one, disputes,
// reconciliation and debugging are impossible. Secrets are never logged.
function knet_log(array $cfg, string $event, array $data = []): void
{
    $path = (string) ($cfg['log_file'] ?? '');
    if ($path === '') {
        return;
    }
    $line = json_encode([
        'ts'    => gmdate('c'),
        'event' => $event,
        'ip'    => $_SERVER['REMOTE_ADDR'] ?? '',
    ] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $new = !file_exists($path);
    if (@file_put_contents($path, $line . "\n", FILE_APPEND | LOCK_EX) !== false && $new) {
        @chmod($path, 0600);
    }
}

function knet_db_configured(array $cfg): bool
{
    return ($cfg['supabase_url'] ?? '') !== '' && ($cfg['supabase_service_key'] ?? '') !== '';
}

// Look an order up by track id.
//
// Returns ['state' => ..., 'amount' => ?string, 'status' => ?string] where state is:
//   'off'      DB not configured at all
//   'found'    row returned
//   'missing'  DB answered, but there is no such order
//   'error'    DB unreachable / rejected the request
//
// Callers MUST treat 'missing' and 'error' as failures. The previous version
// collapsed all three into null, so a DB outage — or simply an unknown track
// id — silently fell back to the client-supplied amount, letting anyone pay an
// arbitrary price for any order.
function knet_order_lookup(array $cfg, string $trackid): array
{
    if (!knet_db_configured($cfg)) {
        return ['state' => 'off', 'amount' => null, 'status' => null];
    }
    $url = rtrim($cfg['supabase_url'], '/') . '/rest/v1/'
        . rawurlencode($cfg['orders_table'])
        . '?select=amount,payment_status&'
        . rawurlencode($cfg['orders_match_column']) . '=eq.' . rawurlencode($trackid);

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
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code < 200 || $code >= 300) {
        return ['state' => 'error', 'amount' => null, 'status' => null];
    }
    $rows = json_decode((string) $body, true);
    if (!is_array($rows) || !isset($rows[0]['amount'])) {
        return ['state' => 'missing', 'amount' => null, 'status' => null];
    }
    return [
        'state'  => 'found',
        'amount' => (string) $rows[0]['amount'],
        'status' => isset($rows[0]['payment_status']) ? (string) $rows[0]['payment_status'] : null,
    ];
}
