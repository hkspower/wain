<?php
// CBK T-Pay / KNET crypto helpers (native PHP, no OpenCart).
//
// KNET-model gateways (CBK T-Pay included) encrypt "trandata" with
// AES-128-CBC, key = Terminal Resource Key, fixed IV "PGKEYENCDECIVSPC",
// PKCS7 padding, hex-encoded. Confirm exact params against your CBK PDF.

const KNET_IV = 'PGKEYENCDECIVSPC'; // 16 bytes, fixed by KNET/CBK

function knet_encrypt(string $plain, string $resourceKey): string
{
    $enc = openssl_encrypt(
        $plain,
        'AES-128-CBC',
        $resourceKey,
        OPENSSL_RAW_DATA, // PKCS7 padding applied by OpenSSL
        KNET_IV
    );
    if ($enc === false) {
        throw new RuntimeException('KNET encrypt failed');
    }
    return strtoupper(bin2hex($enc));
}

function knet_decrypt(string $hex, string $resourceKey): string
{
    $raw = hex2bin($hex);
    if ($raw === false) {
        throw new RuntimeException('KNET response is not valid hex');
    }
    $dec = openssl_decrypt(
        $raw,
        'AES-128-CBC',
        $resourceKey,
        OPENSSL_RAW_DATA,
        KNET_IV
    );
    if ($dec === false) {
        throw new RuntimeException('KNET decrypt failed');
    }
    return $dec;
}

// Build a trandata query string. Order can matter for some terminals.
function knet_build_trandata(array $fields): string
{
    $parts = [];
    foreach ($fields as $k => $v) {
        $parts[] = $k . '=' . urlencode((string) $v);
    }
    return implode('&', $parts);
}

// Parse KNET's response query string into an associative array.
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
