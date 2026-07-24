<?php
// knet/selftest.php — deployment readiness check.
// Visit https://www.sporta.com.kw/knet/selftest.php after uploading.
// DELETE this file once everything shows OK (it exposes config status).

declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');

echo "Sporta KNET — deployment self-test\n==================================\n\n";

echo "PHP version : " . PHP_VERSION . (version_compare(PHP_VERSION, '7.4', '>=') ? "  OK" : "  (need 7.4+)") . "\n";
echo "openssl ext : " . (extension_loaded('openssl') ? 'yes  OK' : 'NO — REQUIRED') . "\n";
echo "curl ext    : " . (extension_loaded('curl') ? 'yes  OK' : 'NO — REQUIRED') . "\n";

require __DIR__ . '/knet.php';

// AES round-trip
try {
    $k = '1234567890123456';
    $enc = knet_encrypt('test=1&amt=1.500', $k);
    $dec = knet_decrypt($enc, $k);
    echo "AES trandata: " . ($dec === 'test=1&amt=1.500' ? 'round-trip OK' : 'FAIL') . "\n";
} catch (Throwable $e) {
    echo "AES trandata: ERROR " . $e->getMessage() . "\n";
}

echo "HTTPS       : " . ((!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') ? 'yes  OK' : 'NO — enable SSL') . "\n\n";

// config.php
$cfgPath = __DIR__ . '/config.php';
if (!is_file($cfgPath)) {
    echo "config.php  : MISSING — copy config.example.php to config.php and fill it.\n";
    exit;
}
$cfg = require $cfgPath;
$set = fn ($v, $ph) => ($v && $v !== $ph) ? 'set  OK' : 'NOT set — fill it';

echo "config.php  : present\n";
echo "  env         : " . ($cfg['env'] ?? '?') . ($cfg['env'] === 'production' ? '  (LIVE)' : '  (test)') . "\n";
echo "  gateway     : " . knet_gateway_url($cfg) . "\n";
echo "  tranportal_id      : " . $set($cfg['tranportal_id'] ?? '', 'YOUR_TRANPORTAL_ID') . "\n";
echo "  tranportal_password: " . $set($cfg['tranportal_password'] ?? '', 'YOUR_TRANPORTAL_PASSWORD') . "\n";
echo "  resource_key       : " . $set($cfg['resource_key'] ?? '', 'YOUR_TERMINAL_RESOURCE_KEY') . "\n";
echo "  response_url: " . ($cfg['response_url'] ?? '') . "\n";

// Optional Supabase ping
if (($cfg['supabase_url'] ?? '') !== '' && ($cfg['supabase_service_key'] ?? '') !== '') {
    $ch = curl_init(rtrim($cfg['supabase_url'], '/') . '/rest/v1/');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => ['apikey: ' . $cfg['supabase_service_key']],
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    echo "  supabase    : " . ($code >= 200 && $code < 500 ? "reachable (HTTP $code)  OK" : "NOT reachable (HTTP $code)") . "\n";
} else {
    echo "  supabase    : not configured (optional — orders won't auto-update)\n";
}

echo "\n>>> When every line shows OK/set, DELETE this file (knet/selftest.php).\n";
