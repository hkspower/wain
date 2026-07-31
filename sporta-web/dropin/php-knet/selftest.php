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

// This page reveals which credentials are set and which gateway is in use.
// Once the store is live it must not be reachable at all.
if (($cfg['env'] ?? '') === 'production') {
    echo "config.php  : env is PRODUCTION — self-test disabled.\n";
    echo ">>> DELETE knet/selftest.php from the server now.\n";
    exit;
}
$set = fn ($v, $ph) => ($v && $v !== $ph) ? 'set  OK' : 'NOT set — fill it';

echo "config.php  : present\n";
echo "  env         : " . ($cfg['env'] ?? '?') . ($cfg['env'] === 'production' ? '  (LIVE)' : '  (test)') . "\n";
echo "  gateway     : " . knet_gateway_url($cfg) . "\n";
echo "  tranportal_id      : " . $set($cfg['tranportal_id'] ?? '', 'YOUR_TRANPORTAL_ID') . "\n";
echo "  tranportal_password: " . $set($cfg['tranportal_password'] ?? '', 'YOUR_TRANPORTAL_PASSWORD') . "\n";
echo "  resource_key       : " . $set($cfg['resource_key'] ?? '', 'YOUR_TERMINAL_RESOURCE_KEY') . "\n";
echo "  response_url: " . ($cfg['response_url'] ?? '') . "\n";

// ---------------------------------------------------------------------------
// The two mistakes that fail silently and cost money.
//
// setup-config.php catches both, but it is CLI-only — and a Hostinger account
// whose shell is /sbin/nologin cannot run it, so config.php has to be written
// by hand in File Manager, with no validation at all. These checks close that
// gap. They only READ an existing config; writing credentials still never
// happens over HTTP.
// ---------------------------------------------------------------------------
$key = (string) ($cfg['resource_key'] ?? '');
if ($key !== '' && $key !== 'YOUR_TERMINAL_RESOURCE_KEY') {
    $len = strlen($key);
    echo "  resource_key length: $len bytes  " . ($len === 16
        ? 'OK'
        : "*** WRONG — AES-128 needs exactly 16. KNET will reject every\n"
        . "                       transaction with no useful error. A trailing space or\n"
        . "                       newline from a copy/paste is the usual cause. ***") . "\n";
}

// Supabase anon key pasted where the service key belongs: row-level security
// then blocks order creation and checkout fails for every customer.
$sbKey = (string) ($cfg['supabase_service_key'] ?? '');
if ($sbKey !== '') {
    $role = null;
    if (str_starts_with($sbKey, 'eyJ')) {                  // classic JWT key
        $parts = explode('.', $sbKey);
        if (count($parts) === 3) {
            $pad  = strtr($parts[1], '-_', '+/');
            $json = json_decode((string) base64_decode($pad . str_repeat('=', (4 - strlen($pad) % 4) % 4)), true);
            $role = $json['role'] ?? null;
        }
    } elseif (str_starts_with($sbKey, 'sb_secret_')) {      // new-style secret key
        $role = 'service_role';
    } elseif (str_starts_with($sbKey, 'sb_publishable_')) {
        $role = 'anon';
    }
    echo "  supabase key role  : " . ($role ?? 'unknown') . '  ' . ($role === 'service_role'
        ? 'OK'
        : ($role === 'anon'
            ? "*** WRONG — this is the ANON (public) key. Row-level security will\n"
            . "                       block order creation and checkout will fail for every\n"
            . "                       customer. Copy the service_role key instead. ***"
            : 'could not confirm — make sure it is the service_role key')) . "\n";
}

// ---------------------------------------------------------------------------
// THE ORDERS DATABASE — the check that would have caught a dead card path.
//
// Without a database the server has no authority over the price: pay.php has
// no amount to charge (the storefront sends none, deliberately) and the
// callback has no order to mark paid. On the native backend this was invisible
// until a customer met a blunt 400, because config.php simply had no MySQL
// block and nothing said so.
// ---------------------------------------------------------------------------
echo "\n";
if (($cfg['store'] ?? '') === 'mysql') {
    echo "  orders DB   : MySQL (native backend)\n";
    try {
        $pdo = knet_pdo($cfg);
        $n = (int) $pdo->query('select count(*) from orders')->fetchColumn();
        echo "  mysql       : connected, orders table readable ($n orders)  OK\n";
    } catch (Throwable $e) {
        echo "  mysql       : *** CANNOT CONNECT — every card payment will be refused.\n"
           . "                    Check mysql_name/user/pass match api/config.php. ***\n";
    }
} elseif (($cfg['supabase_url'] ?? '') === '') {
    echo "  orders DB   : *** NONE CONFIGURED ***\n"
       . "                    Card payments CANNOT work: pay.php has no amount to charge\n"
       . "                    and the callback has no order to mark paid. Fill in either\n"
       . "                    the 'store' => 'mysql' block (native backend) or the\n"
       . "                    supabase_* keys — see config.example.php.\n";
}

// How the customer gets back after paying — see callback.php.
echo "  callback    : " . (($cfg['callback_response'] ?? 'both') === 'redirect'
    ? "HTTP 302 only (browser-redirect gateways)"
    : "REDIRECT= token + HTML  OK  (works with either KPG style)") . "\n";

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
    // Only worth saying when Supabase is the intended backend; the native one
    // reports its own database above.
    if (($cfg['store'] ?? '') !== 'mysql') {
        echo "  supabase    : not configured\n";
    }
}

echo "\n>>> When every line shows OK/set, DELETE this file (knet/selftest.php).\n";
