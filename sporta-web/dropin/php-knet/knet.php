<?php
// Classic KNET (KPG) direct integration — crypto + helpers (native PHP).
//
// KNET RAW sample encrypts "trandata" with AES-128-CBC, using the 16-byte
// Terminal Resource Key as BOTH the AES key and IV, PKCS7 padding, and an
// uppercase hexadecimal result. Keep this byte-for-byte compatible with the
// bank-provided PHP and JSP samples; a different IV produces valid AES that
// KNET cannot decrypt.
// Gateway: kpaytest.com.kw (test) / kpay.com.kw (production), /kpg/PaymentHTTP.htm
// Result "CAPTURED" (or "APPROVED") = success.

declare(strict_types=1);

// The config locator FAILS CLOSED: a private-config server whose settings are
// wrong throws rather than guess. That message and its stack trace name the
// private mount, so they go to the error log, never to the shopper. store.php
// does the same; both gateways must, or the one that does not is the leak.
ini_set('display_errors', '0');

$sportaConfigResolver = dirname(__DIR__) . '/api/config-path.php';
if (is_file($sportaConfigResolver)) require_once $sportaConfigResolver;

function knet_config_path(string $kind, string $legacyPath): string
{
    if (function_exists('sporta_config_path')) return sporta_config_path($kind, $legacyPath);
    // A standalone KNET drop-in remains supported on shared hosting. On a
    // private-config deployment, absence of the resolver is an install error,
    // never permission to use an old web-root credential file.
    $privateDir = getenv('SPORTA_PRIVATE_CONFIG_DIR');
    if ($privateDir !== false && $privateDir !== '') {
        throw new RuntimeException('Private config resolver is missing');
    }
    return $legacyPath;
}

// Private merchant configuration is excluded from every release. Report an
// unavailable service cleanly when it has not been restored on the server.
function knet_load_config(string $path): array
{
    $path = knet_config_path('knet', $path);
    if (!is_file($path) || !is_readable($path)) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Payment service is not configured.');
    }
    $cfg = require $path;
    if (!is_array($cfg)) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Payment service is not configured.');
    }
    return $cfg;
}

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
    $env = strtolower(trim((string) ($cfg['env'] ?? '')));
    return match ($env) {
        'test'       => (string) ($cfg['test_url'] ?? ''),
        'production' => (string) ($cfg['production_url'] ?? ''),
        default      => throw new RuntimeException('env must be test or production'),
    };
}

// AES-128 needs a 16-byte key. PHP would otherwise pad/truncate silently and
// KNET would reject the trandata with no explanation.
function knet_assert_key(string $resourceKey): void
{
    if (strlen($resourceKey) !== 16) {
        throw new RuntimeException('resource_key must be exactly 16 bytes for AES-128 (got ' . strlen($resourceKey) . ')');
    }
}

// Validate every field used to create a gateway handoff. Keeping this in the
// payment library means a partially saved backend form cannot send a customer
// to KNET with blank credentials or an unsafe return URL.
function knet_assert_payment_config(array $cfg): void
{
    $required = ['tranportal_id', 'tranportal_password', 'response_url', 'error_url'];
    foreach ($required as $field) {
        if (trim((string) ($cfg[$field] ?? '')) === '') {
            throw new RuntimeException($field . ' is not configured');
        }
    }
    knet_assert_key((string) ($cfg['resource_key'] ?? ''));

    $env = (string) ($cfg['env'] ?? '');
    if (!in_array($env, ['test', 'production'], true)) {
        throw new RuntimeException('env must be test or production');
    }
    foreach (['test_url', 'production_url', 'response_url', 'error_url'] as $field) {
        $url = (string) ($cfg[$field] ?? '');
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $localTest = $env === 'test' && in_array($host, ['127.0.0.1', 'localhost'], true);
        if (!$parts || $host === '' || ($scheme !== 'https' && !$localTest)) {
            throw new RuntimeException($field . ' must be an HTTPS URL');
        }
    }

    // The mode label and the selected host must agree. Checking only whether
    // "test" appeared somewhere in a hostname accepted lookalike domains and
    // custom URLs. In production that can send encrypted credentials and real
    // customer payments to the wrong server. Localhost remains available only
    // in test mode for the automated fake-bank suite.
    $selected = knet_gateway_url($cfg);
    $selectedParts = parse_url($selected);
    $selectedHost = strtolower((string) ($selectedParts['host'] ?? ''));
    $selectedPath = (string) ($selectedParts['path'] ?? '');
    $isLocalTest = $env === 'test' && in_array($selectedHost, ['127.0.0.1', 'localhost'], true);
    $expectedHost = $env === 'production' ? 'kpay.com.kw' : 'kpaytest.com.kw';
    if (!$isLocalTest && $selectedHost !== $expectedHost) {
        throw new RuntimeException($env . ' mode must use ' . $expectedHost);
    }
    if (!$isLocalTest && $selectedPath !== '/kpg/PaymentHTTP.htm') {
        throw new RuntimeException('KNET gateway path must be /kpg/PaymentHTTP.htm');
    }
    $language = strtoupper((string) ($cfg['language'] ?? ''));
    if ($language === 'EN') $language = 'USA'; // migrate older Sporta configs safely
    if (!in_array($language, ['AR', 'USA'], true)) {
        throw new RuntimeException('KNET language must be AR or USA');
    }
}

function knet_encrypt(string $plain, string $resourceKey): string
{
    knet_assert_key($resourceKey);
    $enc = openssl_encrypt($plain, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, $resourceKey);
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
    $dec = openssl_decrypt($raw, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, $resourceKey);
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

// Is there an orders database to price and verify against?
//
// Without one there is no price authority at all: pay.php has no amount to
// charge (the storefront sends none, by design) and the callback has no order
// to settle. This asked about a different database once, and that omission killed
// the whole card path when the shop moved to MySQL — every payment refused
// with 400 Invalid amount, every captured payment unrecorded. One question,
// one answer now, and scripts/knet-test.mjs holds it there.
// Use the store's database connection when the payment config does not repeat
// it. The order API, KNET and T-Pay must all read the same orders table; making
// operators copy the same four secrets into three files is both fragile and
// unnecessary. Explicit payment-folder values still win for test fixtures and
// unusual deployments.
function knet_with_store_db(array $cfg): array
{
    if (($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '') {
        return $cfg;
    }
    $path = knet_config_path('api', dirname(__DIR__) . '/api/config.php');
    if (!is_file($path)) return $cfg;
    $store = require $path;
    if (!is_array($store)) return $cfg;
    foreach (['host' => 'mysql_host', 'name' => 'mysql_name', 'user' => 'mysql_user', 'pass' => 'mysql_pass'] as $from => $to) {
        if (($cfg[$to] ?? '') === '' && array_key_exists('db_' . $from, $store)) {
            $cfg[$to] = (string)$store['db_' . $from];
        }
    }
    return $cfg;
}

function knet_db_configured(array $cfg): bool
{
    return ($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '';
}

// One connection per request, reused by the lookup and the writer so a
// callback does not open two.
function knet_pdo(array $cfg): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            "mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4",
            $cfg['mysql_user'],
            $cfg['mysql_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
    }
    return $pdo;
}

// Look an order up by track id.
//
// Returns state plus amount, payment status and payment method, where state is:
//   'off'      DB not configured at all
//   'found'    row returned
//   'missing'  DB answered, but there is no such order
//   'error'    DB unreachable / rejected the request
//
// Callers MUST treat 'missing' and 'error' as failures. The previous version
// collapsed all three into null, so a DB outage — or simply an unknown track
// id — silently fell back to the client-supplied amount, letting anyone pay an
// arbitrary price for any order.
// ------------------------------------------------- one reference per attempt
//
// KNET wants the track id to be unique per TRANSACTION ATTEMPT. The shop's
// track id is unique per ORDER, so repeated starts while the order is pending
// need distinct bank references. A failed order must start a fresh checkout
// because its stock can be released immediately.
//
// THE FIRST ATTEMPT SENDS THE TRACK ID UNCHANGED. That keeps the common case
// exactly as it was — the bank statement still carries the order number — and
// means this can be deployed while payments are in flight. Only a repeated
// start while the order is pending carries a suffix.
function knet_attempt_ref(array $cfg, string $trackid): string
{
    if (!knet_db_configured($cfg)) {
        throw new RuntimeException('orders database is not configured');
    }

    // LAST_INSERT_ID(expr) is connection-local and the increment is atomic.
    // A separate UPDATE followed by SELECT can hand two concurrent requests
    // the same retry number: request A increments to 1, request B increments
    // to 2, then both SELECT 2. KNET requires one reference per attempt, so a
    // duplicate reference can strand an otherwise valid retry at the gateway.
    $pdo = knet_pdo($cfg);
    $st = $pdo->prepare(
        "update orders
            set pay_attempt = last_insert_id(pay_attempt + 1)
          where track_id = ?
            and payment_method = 'knet'
            and payment_status = 'pending'
            and stock_released = 0
            and fulfilment_status <> 'cancelled'"
    );
    $st->execute([$trackid]);
    if ($st->rowCount() !== 1) {
        throw new RuntimeException('order is no longer payable by KNET');
    }
    $n = (int) $pdo->query('select last_insert_id()')->fetchColumn();
    if ($n < 1) {
        throw new RuntimeException('could not allocate a KNET attempt reference');
    }
    if ($n <= 1) return $trackid;
    $suffix = 'A' . $n;
    // KNET's trackid field is limited; trim the ORDER part, never the suffix,
    // since the suffix is what makes it unique. pay.php also sends the full
    // order id in udf5 so callback.php can resolve a trimmed retry safely.
    return substr($trackid, 0, max(1, 30 - strlen($suffix))) . $suffix;
}

// A reference that came BACK from the bank, resolved to the order it belongs to.
//
// The order of the two lookups is the safety property. An exact match is tried
// FIRST, so attempt one — and every order placed before this existed — behaves
// exactly as it always did. Only when that finds nothing is the value treated
// as a retry reference and the suffix stripped.
//
// Getting this wrong is the worst failure the shop has: the callback updates
// `where track_id = ?`, so an unresolved reference means the bank captured the
// money and the order stayed pending, with nothing to say why.
function knet_resolve_track(array $cfg, string $ref, string $orderHint = ''): string
{
    if ($ref === '' || !knet_db_configured($cfg)) return $ref;
    try {
        $q = knet_pdo($cfg)->prepare('select 1 from orders where track_id = ?');
        $q->execute([$ref]);
        if ($q->fetchColumn()) return $ref;

        // pay.php reserves udf5 for the original order reference. It is needed
        // when a 30-character order id is shortened to make room for the retry
        // suffix; stripping the suffix alone only recovers the shortened
        // prefix. Accept the hint only when it deterministically produces the
        // reference KNET echoed, then confirm the hinted order exists.
        if (preg_match('/^[A-Za-z0-9]{1,30}$/', $orderHint)
            && knet_attempt_ref_matches_order($ref, $orderHint)) {
            $q->execute([$orderHint]);
            if ($q->fetchColumn()) return $orderHint;
        }

        // Backward compatibility for in-flight payments created before udf5
        // carried the order id. This resolves untrimmed retry references.
        if (preg_match('/^(.+)A\d+$/', $ref, $m)) {
            $q->execute([$m[1]]);
            if ($q->fetchColumn()) return $m[1];
        }
    } catch (Throwable $e) {
        // A database that is down must not rewrite the reference into
        // something else — hand back what the bank sent and let the caller's
        // own error handling deal with it.
    }
    return $ref;
}

function knet_attempt_ref_matches_order(string $ref, string $trackid): bool
{
    if (hash_equals($trackid, $ref)) return true;
    if (!preg_match('/A[1-9]\d*$/', $ref, $m)) return false;
    $suffix = $m[0];
    $expected = substr($trackid, 0, max(1, 30 - strlen($suffix))) . $suffix;
    return hash_equals($expected, $ref);
}

function knet_order_lookup(array $cfg, string $trackid): array
{
    if (!knet_db_configured($cfg)) {
        return ['state' => 'off', 'amount' => null, 'status' => null, 'method' => null];
    }
    try {
        $q = knet_pdo($cfg)->prepare(
            'select amount, payment_status, payment_method, stock_released,
                    fulfilment_status from orders where track_id = ?'
        );
        $q->execute([$trackid]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        // A database that is DOWN must not read as "no such order": the two
        // have opposite correct responses — retry versus refuse.
        return ['state' => 'error', 'amount' => null, 'status' => null, 'method' => null];
    }
    if (!$row) {
        return ['state' => 'missing', 'amount' => null, 'status' => null, 'method' => null];
    }
    return [
        'state'  => 'found',
        'amount' => (string) $row['amount'],
        'status' => (string) $row['payment_status'],
        'method' => (string) $row['payment_method'],
        'stock_released' => (int) $row['stock_released'],
        'fulfilment_status' => (string) $row['fulfilment_status'],
    ];
}

// Convert a KWD decimal string to fils without using floating-point math.
// KNET amounts have at most three decimal places. Returning null for anything
// else prevents strings such as "1e3" or a partial numeric prefix from being
// accepted by PHP's permissive float conversion.
function knet_amount_fils(string $amount): ?int
{
    $amount = trim($amount);
    if (!preg_match('/^(0|[1-9]\d{0,6})(?:\.(\d{1,3}))?$/D', $amount, $m)) {
        return null;
    }
    $fraction = str_pad((string) ($m[2] ?? ''), 3, '0');
    return ((int) $m[1] * 1000) + (int) $fraction;
}

function knet_format_fils(int $fils): string
{
    return intdiv($fils, 1000) . '.' . str_pad((string) ($fils % 1000), 3, '0', STR_PAD_LEFT);
}
