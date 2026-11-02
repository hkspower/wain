<?php
// CBK Hosted KNET & T-Pay — REST-JSON helper library.
// Implements the auth-token, checkout URL, and transaction-verify calls from
// the CBK Integration & Reference Manual v2.93.

declare(strict_types=1);

// The config locator FAILS CLOSED: a private-config server whose settings are
// wrong throws rather than guess. That message and its stack trace name the
// private mount, so they go to the error log, never to the shopper. store.php
// and knet.php do the same; both gateways must, or the one that does not is
// the leak. (The VPS image also sets it in 92-sporta-errors.ini; this keeps
// it true on any host.)
ini_set('display_errors', '0');

$sportaConfigResolver = dirname(__DIR__) . '/api/config-path.php';
if (is_file($sportaConfigResolver)) require_once $sportaConfigResolver;

function cbk_config_path(string $kind, string $legacyPath): string
{
    if (function_exists('sporta_config_path')) return sporta_config_path($kind, $legacyPath);
    $privateDir = getenv('SPORTA_PRIVATE_CONFIG_DIR');
    if ($privateDir !== false && $privateDir !== '') {
        throw new RuntimeException('Private config resolver is missing');
    }
    return $legacyPath;
}

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

// The merchant configuration is deliberately excluded from releases. A new
// hosting folder can therefore contain the payment code before the operator
// has created config.php. `require` would turn that ordinary setup state into
// a PHP fatal error and an opaque HTTP 500. Refuse safely instead, without
// revealing a path or any configuration detail to the shopper.
function cbk_load_config(string $path): array
{
    $path = cbk_config_path('tpay', $path);
    if (!is_file($path) || !is_readable($path)) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Payment service is not configured.');
    }

    $config = require $path;
    if (!is_array($config)) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Payment service is not configured.');
    }

    return $config;
}

function cbk_base(array $cfg): string
{
    return rtrim($cfg['env'] === 'production' ? $cfg['production_base'] : $cfg['test_base'], '/');
}

function cbk_assert_payment_config(array $cfg): void
{
    foreach (['client_id', 'client_secret', 'encrp_key', 'return_url', 'result_page_url'] as $field) {
        $raw = (string) ($cfg[$field] ?? '');
        $value = trim($raw);
        if ($value === '' || str_starts_with($value, 'YOUR_')) {
            throw new RuntimeException($field . ' is not configured');
        }
        if ($raw !== $value) {
            throw new RuntimeException($field . ' has leading or trailing whitespace');
        }
    }
    $env = (string) ($cfg['env'] ?? '');
    if (!in_array($env, ['test', 'production'], true)) {
        throw new RuntimeException('env must be test or production');
    }
    foreach (['test_base', 'production_base', 'return_url', 'result_page_url'] as $field) {
        $url = (string) ($cfg[$field] ?? '');
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $localTest = $env === 'test' && in_array($host, ['127.0.0.1', 'localhost'], true);
        if (!$parts || $host === '' || ($scheme !== 'https' && !$localTest)) {
            throw new RuntimeException($field . ' must be an HTTPS URL');
        }
    }
    if (!in_array((string) ($cfg['lang'] ?? ''), ['en', 'ar'], true)) {
        throw new RuntimeException('lang must be en or ar');
    }
}

// Is there an orders database at all? Without one there is no price authority:
// nothing to charge and nothing to settle. The same question the KNET dropin
// asks, with the same answer, so the two gateways cannot drift.
// Fall back to the store API's database credentials when this payment config
// does not duplicate them. All payment rails settle the same order rows, and a
// single source prevents KNET/T-Pay silently pointing at no database or an old
// one after credentials change. Explicit values still take precedence.
function cbk_with_store_db(array $cfg): array
{
    if (($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '') {
        return $cfg;
    }
    $path = cbk_config_path('api', dirname(__DIR__) . '/api/config.php');
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

function cbk_db_configured(array $cfg): bool
{
    return ($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '';
}

// One connection per request, shared by the amount lookup and the writer.
function cbk_pdo(array $cfg): PDO
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

// Amount AND payment status, so a caller can tell "no such order" from
// "already paid". pay.php needs the difference: without it a shopper who
// returned to a paid order's link was sent to the gateway to pay a second
// time, which is a refund and an apology rather than a bug report.
// ------------------------------------------------- one reference per attempt
//
// The manual (p.10) says the Merchant Track/Order ID "must be always unique for
// each transaction attempts", and CBK's own sample calls uniqid() every time.
// The shop sends orders.track_id, which is unique per ORDER. Repeated starts
// while an order is pending therefore need distinct gateway references. A
// failed order cannot be reused because its stock may be released immediately.
//
// THE FIRST ATTEMPT SENDS THE TRACK ID UNCHANGED, so the common case is exactly
// as it was and a bank statement still carries the order number. Only a retry —
// while the order is still pending carries a suffix.
function cbk_attempt_ref(array $cfg, string $trackid): string
{
    if (!cbk_db_configured($cfg)) {
        throw new RuntimeException('orders database is not configured');
    }
    $pdo = cbk_pdo($cfg);
    // The methods this setup may take: T-Pay always, KNET only when
    // `knet_via_cbk` is on (see cbk_method_ok). A fixed list, never input.
    $methods = ['tpay'];
    if (!empty($cfg['knet_via_cbk'])) $methods[] = 'knet';
    $in = implode(',', array_fill(0, count($methods), '?'));
    $st = $pdo->prepare(
        "update orders set pay_attempt = last_insert_id(pay_attempt + 1)
          where track_id = ? and payment_method in ($in)
            and payment_status = 'pending'
            and stock_released = 0
            and fulfilment_status <> 'cancelled'"
    );
    $st->execute([$trackid, ...$methods]);
    if ($st->rowCount() !== 1) throw new RuntimeException('order is no longer payable through this gateway');
    $n = (int) $pdo->query('select last_insert_id()')->fetchColumn();
    if ($n < 1) throw new RuntimeException('could not allocate a T-Pay attempt reference');
    if ($n <= 1) return $trackid;
    $suffix = 'A' . $n;
    // The manual caps this field at 30. Trim the ORDER part, never the suffix —
    // the suffix is the part that makes it unique, and resolution is by lookup
    // rather than by parsing a fixed width.
    return substr($trackid, 0, max(1, 30 - strlen($suffix))) . $suffix;
}

// A reference that came BACK from the gateway, resolved to the order it belongs
// to. Exact match FIRST — so attempt one, and every order placed before this
// existed, behaves exactly as it always did — and only then is the value
// treated as a retry reference.
//
// Getting this wrong is the worst failure available: cbk_update_order keys on
// track_id, so an unresolved reference settles no row while the gateway has
// taken the money.
function cbk_resolve_track(array $cfg, string $ref, string $orderHint = ''): string
{
    if ($ref === '' || !cbk_db_configured($cfg)) return $ref;
    try {
        $q = cbk_pdo($cfg)->prepare('select 1 from orders where track_id = ?');
        $q->execute([$ref]);
        if ($q->fetchColumn()) return $ref;
        if (preg_match('/^[A-Za-z0-9]{1,30}$/', $orderHint)
            && cbk_attempt_ref_matches_order($ref, $orderHint)) {
            $q->execute([$orderHint]);
            if ($q->fetchColumn()) return $orderHint;
        }
        if (preg_match('/^(.+)A\d+$/', $ref, $m)) {
            $q->execute([$m[1]]);
            if ($q->fetchColumn()) return $m[1];
        }
    } catch (Throwable $e) {
        // A database that is down must not rewrite the reference into
        // something else.
    }
    return $ref;
}

function cbk_attempt_ref_matches_order(string $ref, string $trackid): bool
{
    if (hash_equals($trackid, $ref)) return true;
    if (!preg_match('/A[1-9]\d*$/', $ref, $m)) return false;
    $suffix = $m[0];
    return hash_equals(substr($trackid, 0, max(1, 30 - strlen($suffix))) . $suffix, $ref);
}

// ONE SETUP FOR BOTH. CBK's hosted page takes KNET and T-Pay with the same
// ClientId / ClientSecret / ENCRP_KEY; only tij_MerchPayType differs (manual:
// '1' = KNET only, '2' = T-Pay only, '' = the customer chooses). With
// `knet_via_cbk` on in THIS config, an order paid "by KNET" is taken here with
// PayType 1 instead of through the classic Tranportal endpoint (/knet), so no
// separate Tranportal ID / password / resource key is needed. Off by default.
//
// The pay type follows the ORDER's own payment method, read from the database;
// the browser never names it, so a T-Pay order cannot be paid as KNET or the
// reverse by editing a URL.
function cbk_method_ok(array $cfg, string $method): bool
{
    return $method === 'tpay' || ($method === 'knet' && !empty($cfg['knet_via_cbk']));
}

function cbk_pay_type(string $method): string
{
    return $method === 'knet' ? '1' : '2';
}

function cbk_order_lookup(array $cfg, string $trackid): array
{
    if (!cbk_db_configured($cfg)) {
        return ['state' => 'off', 'amount' => null, 'status' => null, 'method' => null];
    }
    try {
        $q = cbk_pdo($cfg)->prepare(
            'select amount, payment_status, payment_method, stock_released,
                    fulfilment_status from orders where track_id = ?'
        );
        $q->execute([$trackid]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return ['state' => 'error', 'amount' => null, 'status' => null, 'method' => null];
    }
    return $row
        ? ['state' => 'found', 'amount' => (string) $row['amount'], 'status' => (string) $row['payment_status'],
           'method' => (string) $row['payment_method'],
           'stock_released' => (int) $row['stock_released'],
           'fulfilment_status' => (string) $row['fulfilment_status']]
        : ['state' => 'missing', 'amount' => null, 'status' => null, 'method' => null];
}

function cbk_amount_fils(string $amount): ?int
{
    $amount = trim($amount);
    if (!preg_match('/^(0|[1-9]\d{0,6})(?:\.(\d{1,3}))?$/D', $amount, $m)) return null;
    return ((int) $m[1] * 1000) + (int) str_pad((string) ($m[2] ?? ''), 3, '0');
}

function cbk_format_fils(int $fils): string
{
    return intdiv($fils, 1000) . '.' . str_pad((string) ($fils % 1000), 3, '0', STR_PAD_LEFT);
}

// Append-only audit log, the twin of knet_log(). A payment system with no
// trail cannot be reconciled or disputed, and T-Pay had none at all while the
// KNET dropin logged both sides of every payment. Secrets are never written.
function cbk_log(array $cfg, string $event, array $data = []): void
{
    $path = (string) ($cfg['log_file'] ?? '');
    if ($path === '') return;
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

// Read an order's server-authoritative amount by track id.
// Returns the amount string, or null if not found / DB not configured.
function cbk_order_amount(array $cfg, string $trackid): ?string
{
    return cbk_order_lookup($cfg, $trackid)['amount'];
}

// One NVP field, cut to the length and charset the gateway will accept.
//
// mb_substr, not substr: the payment reference may be Arabic, and slicing
// UTF-8 down the middle of a character produces bytes the gateway reads as
// invalid rather than as a shorter description.
function cbk_field($value, int $max, ?string $strip = null): string
{
    $v = trim((string) $value);
    if ($strip !== null) $v = preg_replace($strip, '', $v) ?? '';
    return mb_substr($v, 0, $max);
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
        // BOTH of these, explicitly, and they are the one place this file
        // deliberately contradicts CBK's own reference implementation.
        //
        // PGPaymentRequestHosted.php and PGPaymentResultHosted.php — the
        // sample code the bank ships — set SSL_VERIFYHOST and SSL_VERIFYPEER
        // to 0 on the Authenticate call. That is the request carrying the
        // ClientSecret and the ENCRP_KEY, and with verification off curl will
        // hand them to whatever answers on the address. Being in the vendor's
        // example is what makes it dangerous: it is precisely the line a
        // future "make this match the bank's sample" pass would copy in.
        //
        // VERIFYHOST is curl's secure default anyway; it is written out so
        // that removing it is a visible deletion rather than an omission.
        // Proven by scripts/tls-probe.php against a self-signed server: the
        // request fails, and the suite asserts that it does.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
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
        // CBK's manual gives the key a 6-hour life; refreshing after 100 min
        // stays far inside it. The key is also bound to the gateway and the
        // merchant it was issued for: after a Test -> Production switch (or a
        // new ClientId) a cached key from the other side is never reused.
        $owner = hash('sha256', cbk_base($cfg) . "\0" . (string) $cfg['client_id']);
        if (isset($cached['token'], $cached['ts']) && (time() - $cached['ts']) < 100 * 60
            && hash_equals($owner, (string) ($cached['owner'] ?? ''))) {
            return (string) $cached['token'];
        }
    }

    $url = cbk_base($cfg) . '/ePay/api/cbk/online/pg/merchant/Authenticate';
    [$status, $res] = cbk_http('POST', $url, $cfg, [
        'ClientId'     => $cfg['client_id'],
        'ClientSecret' => $cfg['client_secret'],
        'ENCRP_KEY'    => $cfg['encrp_key'],
    ]);

    // CBK: Status 1 = key returned, 0 = authentication failed. Compared as a
    // string so a JSON number 1 and a string "1" both count (the manual does
    // not say which it sends). HTTP 401 is CBK's "invalid ClientId or
    // ClientSecret, or a call from an IP not registered as Merchant Server IP".
    if ($status !== 200 || !is_array($res) || (string) ($res['Status'] ?? '') !== '1' || empty($res['AccessToken'])) {
        $msg = $status === 401
            ? 'not authorized: check Merchant API ID / Password, and that this server\'s IP is registered with CBK'
            : (is_array($res) ? (string) ($res['Message'] ?? 'unknown') : 'no response');
        throw new RuntimeException('CBK auth failed (' . $status . '): ' . $msg);
    }

    $token = (string) $res['AccessToken'];
    @file_put_contents($file, json_encode(['token' => $token, 'ts' => time(),
        'owner' => hash('sha256', cbk_base($cfg) . "\0" . (string) $cfg['client_id'])]));
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
