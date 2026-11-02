<?php
// KNET CONFIG CHECK — run by scripts/knet-scan.mjs, never served.
//
// Loads the LIVE knet.php (KNET_LIB) and the private config exactly the way
// pay.php does — the same resolver (knet_config_path), the same database
// fallback (knet_with_store_db), the same validator (knet_assert_payment_config)
// — and says whether a card payment could start. It is knet/selftest.php for a
// server whose selftest is (rightly) deleted.
//
// IT PRINTS NO VALUE. Not the Tranportal id, not the password, not the key,
// not a database name. Every line is a verdict: whether a field is set, its
// length or shape, whether a URL points where it must. The validator's own
// messages name fields, never their contents. Lines start with ok / WARN /
// BAD so the Node side can count them; two lines carry facts for it to act on:
//   GATEWAY <url>   the bank host to test TLS against (a public URL)
//   LOGFILE <path>  where the payment log lives inside the web container
declare(strict_types=1);

$out = static function (string $level, string $msg): void {
    echo str_pad($level, 5) . $msg . "\n";
};

$lib = (string) getenv('KNET_LIB');
if ($lib === '' || !is_file($lib)) {
    $out('BAD', 'knet.php not found at the live path — the card path cannot load');
    exit(0);
}
require $lib;

try {
    $path = knet_config_path('knet', dirname($lib) . '/config.php');
} catch (Throwable $e) {
    $out('BAD', 'config location: ' . $e->getMessage());
    exit(0);
}
if (!is_file($path)) {
    $out('BAD', 'knet config missing — pay.php answers 503 "Payment service is not configured"');
    exit(0);
}
$raw = require $path;
if (!is_array($raw)) {
    $out('BAD', 'knet config does not return an array — pay.php answers 503');
    exit(0);
}
$out('ok', 'knet config found (' . basename($path) . ', ' . count($raw) . ' keys)');
$cfg = knet_with_store_db($raw);

// ---- mode and gateway
$env = (string) ($cfg['env'] ?? '');
if ($env === 'production') $out('ok', 'env production — real payments');
elseif ($env === 'test') $out('WARN', 'env test — checkout sends customers to the KNET TEST gateway; no real money moves');
else $out('BAD', 'env is neither test nor production');
try {
    $gw = knet_gateway_url($cfg);
    echo 'GATEWAY ' . $gw . "\n";
} catch (Throwable $e) {
    $out('BAD', 'gateway: ' . $e->getMessage());
}

// ---- the validator pay.php runs before every handoff
try {
    knet_assert_payment_config($cfg);
    $out('ok', 'passes knet_assert_payment_config — the same checks pay.php runs before each payment');
} catch (Throwable $e) {
    $out('BAD', 'pay.php would refuse every payment: ' . $e->getMessage());
}

// ---- credentials: set, not placeholders, plausible shape (values never shown)
$placeholders = [
    'tranportal_id'       => 'YOUR_TRANPORTAL_ID',
    'tranportal_password' => 'YOUR_TRANPORTAL_PASSWORD',
    'resource_key'        => 'YOUR_TERMINAL_RESOURCE_KEY',
];
foreach ($placeholders as $field => $ph) {
    $v = (string) ($cfg[$field] ?? '');
    if ($v === '') $out('BAD', "$field is empty");
    elseif ($v === $ph) $out('BAD', "$field is still the example placeholder");
    elseif ($v !== trim($v)) $out('BAD', "$field has leading/trailing whitespace — a copy-paste artefact KNET rejects");
    else $out('ok', "$field set");
}
$id = (string) ($cfg['tranportal_id'] ?? '');
if ($id !== '' && !preg_match('/^\d{4,20}$/', $id)) {
    $out('WARN', 'tranportal_id is not all digits — KNET issues numeric Tranportal ids');
}
$key = (string) ($cfg['resource_key'] ?? '');
if ($key !== '' && strlen($key) === 16 && !preg_match('/^[\x21-\x7E]{16}$/', $key)) {
    $out('WARN', 'resource_key has 16 bytes but some are not printable ASCII');
}

// ---- where the bank sends the customer back
$want = 'https://www.sporta.com.kw/knet/callback.php';
foreach (['response_url', 'error_url'] as $field) {
    $u = (string) ($cfg[$field] ?? '');
    if ($u === $want) $out('ok', "$field is $want");
    elseif ($env === 'production') $out('BAD', "$field is not $want — KNET would return customers (and payment results) elsewhere");
    else $out('WARN', "$field is not $want (acceptable only on a test setup)");
}
$result = (string) ($cfg['result_page_url'] ?? '');
if ($result === '') $out('WARN', 'result_page_url not set — the callback falls back to its default');
elseif (str_starts_with($result, 'https://www.sporta.com.kw/')) $out('ok', 'result_page_url is on the canonical origin');
else $out('WARN', 'result_page_url is not on https://www.sporta.com.kw/');
$cb = (string) ($cfg['callback_response'] ?? 'both');
$out('ok', 'callback_response ' . $cb . ($cb === 'both' ? ' (works with either KPG return style)' : ''));

// ---- the payment log (K-064 §5: keep every request and response)
$log = (string) ($cfg['log_file'] ?? '');
if ($log === '') {
    $out('BAD', 'log_file not set — requests and responses are not kept, which K-064 §5 requires');
} else {
    echo 'LOGFILE ' . $log . "\n";
    if (str_starts_with($log, '/var/www/html/') || str_starts_with($log, dirname($lib, 2) . '/')) {
        $out('BAD', 'log_file is inside the web root');
    } else {
        $out('ok', 'log_file is outside the web root');
    }
}

// ---- the orders database: without it there is no price authority
if (knet_db_configured($cfg)) {
    $own = ($raw['mysql_name'] ?? '') !== '' && ($raw['mysql_user'] ?? '') !== '';
    $out('ok', 'orders database configured (' . ($own ? 'own mysql_* block' : "borrowed from the store's db_*") . ')');
} else {
    $out('BAD', 'no orders database — pay.php refuses every card payment (503) and the callback cannot settle one');
}

// ---- the key actually encrypts, with the live library
if (!extension_loaded('openssl')) {
    $out('WARN', 'openssl extension unavailable to this checker — AES round trip not run');
} elseif (strlen($key) === 16) {
    try {
        $probe = 'scan=1&amt=0.000&trackid=SCAN';
        $enc = knet_encrypt($probe, $key);
        $ok = knet_decrypt($enc, $key) === $probe && preg_match('/^[0-9A-F]+$/', $enc) === 1;
        $out($ok ? 'ok' : 'BAD', $ok ? 'AES-128 trandata round trip with the live key (uppercase hex, as KNET expects)'
            : 'AES trandata round trip FAILED with the live key');
    } catch (Throwable $e) {
        $out('BAD', 'AES trandata: ' . $e->getMessage());
    }
}

// ---- tools that must not be on a live server
foreach (['selftest.php', 'setup-config.php', 'config.php'] as $f) {
    if (is_file(dirname($lib) . '/' . $f)) $out('BAD', "knet/$f is in the web root");
}
