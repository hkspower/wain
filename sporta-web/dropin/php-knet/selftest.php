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
if (knet_db_configured($cfg)) {
    try {
        $pdo = knet_pdo($cfg);
        $n = (int) $pdo->query('select count(*) from orders')->fetchColumn();
        echo "  orders DB   : connected, orders table readable ($n orders)  OK\n";
    } catch (Throwable $e) {
        echo "  orders DB   : *** CANNOT CONNECT — every card payment will be refused.\n"
           . "                    Check mysql_name/user/pass match api/config.php. ***\n";
    }
} else {
    echo "  orders DB   : *** NONE CONFIGURED ***\n"
       . "                    Card payments CANNOT work: pay.php has no amount to charge\n"
       . "                    and the callback has no order to mark paid. Fill in the\n"
       . "                    mysql_* keys — see config.example.php.\n";
}

// How the customer gets back after paying — see callback.php.
echo "  callback    : " . (($cfg['callback_response'] ?? 'both') === 'redirect'
    ? "HTTP 302 only (browser-redirect gateways)"
    : "REDIRECT= token + HTML  OK  (works with either KPG style)") . "\n";

echo "\n>>> When every line shows OK/set, DELETE this file (knet/selftest.php).\n";
