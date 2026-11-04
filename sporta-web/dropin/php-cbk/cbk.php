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
    $hasDb = ($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '';
    // Two more keys come from the store's config, and only from there: which
    // proxies may name the client (trusted_proxy_ips), so the log and the
    // limiter see the shopper rather than Traefik; and rate_limit_secret, so a
    // T-Pay bucket key is the same HMAC the store computes. A value in this
    // config wins, as with the database.
    $wantShared = !array_key_exists('trusted_proxy_ips', $cfg) || !array_key_exists('rate_limit_secret', $cfg);
    if ($hasDb && !$wantShared) return $cfg;
    try {
        $path = cbk_config_path('api', dirname(__DIR__) . '/api/config.php');
    } catch (Throwable $e) {
        // The DATABASE borrow fails closed, exactly as before. The other two
        // keys are not worth refusing a payment over when this config already
        // names its own database.
        if (!$hasDb) throw $e;
        return $cfg;
    }
    if (!is_file($path)) return $cfg;
    $store = require $path;
    if (!is_array($store)) return $cfg;
    if (!$hasDb) {
        foreach (['host' => 'mysql_host', 'name' => 'mysql_name', 'user' => 'mysql_user', 'pass' => 'mysql_pass'] as $from => $to) {
            if (($cfg[$to] ?? '') === '' && array_key_exists('db_' . $from, $store)) {
                $cfg[$to] = (string)$store['db_' . $from];
            }
        }
    }
    foreach (['trusted_proxy_ips', 'rate_limit_secret'] as $key) {
        if (!array_key_exists($key, $cfg) && array_key_exists($key, $store)) $cfg[$key] = $store[$key];
    }
    return $cfg;
}

// The shopper's address, by the one rule the store and KNET use
// (sporta_client_ip in api/config-path.php). Without the resolver — a
// standalone drop-in with no api/ beside it — there is no proxy list to trust,
// so the direct peer is the answer.
function cbk_client_ip(array $cfg): string
{
    if (!function_exists('sporta_client_ip')) return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    return sporta_client_ip(sporta_trusted_proxy_rules($cfg['trusted_proxy_ips'] ?? []));
}

// A per-client limit on the two T-Pay endpoints a stranger can call, in the
// store's own rate_limit table, through the store's own counter
// (sporta_rate_limit_hit) and key (sporta_rate_limit_key) — the same HMAC the
// store derives when the two configs name the same database. Keyed on the
// client's /64 for IPv6 (sporta_rate_identity).
//
// Returns null when there is nothing to count with (no resolver, no
// database): the endpoints keep working, which is what they did before the
// limit existed.
/** @return array{allowed:bool,hits:int,retry_after:int}|null */
function cbk_rate_hit(array $cfg, string $bucket, int $max, int $windowSec): ?array
{
    if (!function_exists('sporta_rate_limit_hit') || !cbk_db_configured($cfg)) return null;
    try {
        $key = sporta_rate_limit_key($bucket, sporta_rate_identity(cbk_client_ip($cfg)),
            (string) ($cfg['rate_limit_secret'] ?? ''),
            [(string) $cfg['mysql_name'], (string) $cfg['mysql_user'], (string) ($cfg['mysql_pass'] ?? '')]);
        return sporta_rate_limit_hit(cbk_pdo($cfg), $key, $max, $windowSec);
    } catch (Throwable $e) {
        // A database that is down (or a store without the rate_limit table)
        // must not stop a shopper coming back from the bank.
        return null;
    }
}

// Refuse with 429 and no gateway call. Plain text: these are pages a shopper's
// browser lands on, not API responses.
function cbk_rate_refuse(array $state, string $message): never
{
    http_response_code(429);
    header('Retry-After: ' . max(1, (int) $state['retry_after']));
    header('Content-Type: text/plain; charset=utf-8');
    exit($message);
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
// HOW MANY TIMES ONE ORDER MAY BE SENT TO THE BANK. Every start of pay.php is
// one Authenticate call to CBK (the manual asks for a fresh key per checkout)
// and one attempt number, and pay.php needs only a pending track id — so
// without a ceiling, a loop over one order's link turned this server into a
// way to hammer CBK's merchant API under the shop's own credentials. Ten is far
// past a shopper retrying a declined card; past it the order is refused BEFORE
// any call to CBK, and the shopper starts a new checkout.
const CBK_MAX_ATTEMPTS = 10;

final class CbkTooManyAttempts extends RuntimeException {}

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
    if ($n > CBK_MAX_ATTEMPTS) throw new CbkTooManyAttempts('too many payment attempts for this order');
    if ($n <= 1) return $trackid;
    $suffix = 'A' . $n;
    // The manual caps this field at 30. Trim the ORDER part, never the suffix —
    // the suffix is the part that makes it unique, and resolution is by lookup
    // rather than by parsing a fixed width.
    return substr($trackid, 0, max(1, 30 - strlen($suffix))) . $suffix;
}

// A reference that came BACK from the gateway, resolved to the order it belongs
// to. The order of the lookups is the safety property (RACE K1-6): (1) the
// MerchUdf5 hint, which the verified API result echoes, when it reproduces the
// echoed reference and its order exists; (2) the exact match (attempt one, whose
// reference IS its udf5, and legacy orders); (3) the suffix stripped from a
// legacy retry. Exact match FIRST would let an order NAMED <victim>A2, which
// anyone can place, be settled by the victim's second attempt.
//
// Getting this wrong is the worst failure available: cbk_update_order keys on
// track_id, so an unresolved reference settles no row while the gateway has
// taken the money.
function cbk_resolve_track(array $cfg, string $ref, string $orderHint = ''): string
{
    if ($ref === '' || !cbk_db_configured($cfg)) return $ref;
    try {
        $q = cbk_pdo($cfg)->prepare('select 1 from orders where track_id = ?');
        // RACE K1-6 (the "A2 hole"): the hint comes first. It is MerchUdf5, the
        // original order reference pay.php sent, echoed back by the merchant API
        // call that verified the transaction (not by the query string), and it
        // is accepted only when it deterministically produces the reference CBK
        // echoed. An exact match first let an order NAMED <victim>A2 (track ids
        // are chosen by the browser) be settled by the victim's second attempt.
        // Attempt one is unchanged: its reference IS its udf5.
        if (preg_match('/^[A-Za-z0-9]{1,30}$/', $orderHint)
            && cbk_attempt_ref_matches_order($ref, $orderHint)) {
            $q->execute([$orderHint]);
            if ($q->fetchColumn()) return $orderHint;
        }
        $q->execute([$ref]);
        if ($q->fetchColumn()) return $ref;
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

// How many times in all a callback's settlement transaction is run when it loses
// a deadlock or waits out the lock timeout (RACE K1-7).
const CBK_SETTLE_ATTEMPTS = 3;

// A transaction that lost a deadlock (1213, SQLSTATE 40001) or waited out the
// lock timeout (1205) rolled back completely and may be run again from its
// first statement (RACE K1-7). Nothing else is retried.
function cbk_tx_retryable(Throwable $e): bool
{
    if (!($e instanceof PDOException)) return false;
    $code = (int) ($e->errorInfo[1] ?? 0);
    return $code === 1213 || $code === 1205 || (string) $e->getCode() === '40001';
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
        // The shopper, not the proxy in front of the server — which made every
        // line of the log name the same address.
        'ip'    => cbk_client_ip($cfg),
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

// The cached access token, or null: no file, a file that is not a whole JSON
// document, a key issued for another gateway or merchant, or one past its life.
//
// CBK's manual gives the key a 6-hour life; refreshing after 100 min stays far
// inside it. The key is also bound to the gateway and the merchant it was
// issued for: after a Test -> Production switch (or a new ClientId) a cached
// key from the other side is never reused.
function cbk_cached_token(array $cfg): ?string
{
    $file = (string) ($cfg['token_cache_file'] ?? '');
    if ($file === '' || !is_readable($file)) return null;
    $cached = json_decode((string) @file_get_contents($file), true);
    $owner = hash('sha256', cbk_base($cfg) . "\0" . (string) $cfg['client_id']);
    if (is_array($cached) && isset($cached['token'], $cached['ts']) && (time() - (int) $cached['ts']) < 100 * 60
        && hash_equals($owner, (string) ($cached['owner'] ?? ''))) {
        return (string) $cached['token'];
    }
    return null;
}

// Get a valid AccessToken, reusing the cached one until it nears its 2h expiry.
// $fresh = true skips the cache: CBK's manual says to "get updated
// {AccessToken} from gateway server before checkout to payment gateway", so
// pay.php asks for a new key on every handoff. The new key is still cached,
// so the callback that follows reuses it (manual: "save the key locally and
// re-use till expiry").
//
// RACE K2-3, two halves.
//
// (1) THE WRITE IS ATOMIC. The cache used to be rewritten in place, which is
// open, truncate, write: a request that read it between the truncate and the
// write saw an empty or half-written file, decided there was no token, and
// authenticated again although a good token had been there a moment before and
// was there a moment after. The file is now written beside itself and renamed
// over the old one, so a reader sees the whole old file or the whole new one.
// It is also created 0600 BEFORE the token goes in, not chmod-ed afterwards.
//
// (2) ONE AUTHENTICATE FOR A BURST. When the cache is empty (a restart, the
// 100-minute refresh, a purge after TIJ0009) every request that arrives
// together found no token and called CBK's Authenticate: measured, sixteen
// returns from the bank at once made fourteen calls to the merchant
// authentication endpoint for one token. The first request now takes a lock
// beside the cache, authenticates, and writes; the others wait on the lock,
// find the token it wrote, and use it. A $fresh request is not made to wait for
// anyone - it exists to get its own new key - and a lock that cannot be had
// within ten seconds (a dead CBK) is given up on rather than queued behind.
function cbk_get_access_token(array $cfg, bool $fresh = false): string
{
    $file = $cfg['token_cache_file'];
    if (!$fresh && ($token = cbk_cached_token($cfg)) !== null) return $token;

    $lock = null;
    if (!$fresh) {
        $lock = @fopen($file . '.lock', 'c');
        if ($lock !== false) {
            $deadline = microtime(true) + 10.0;
            $held = false;
            while (!($held = flock($lock, LOCK_EX | LOCK_NB))) {
                if (microtime(true) >= $deadline) break;
                usleep(40000);
                // The one who held it may have finished while this slept.
                if (($token = cbk_cached_token($cfg)) !== null) { fclose($lock); return $token; }
            }
            if ($held && ($token = cbk_cached_token($cfg)) !== null) { flock($lock, LOCK_UN); fclose($lock); return $token; }
            if (!$held) { fclose($lock); $lock = null; }
        } else {
            $lock = null;
        }
    }

    try {
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
        cbk_write_token_cache($cfg, $token);
        return $token;
    } finally {
        if ($lock !== null) { flock($lock, LOCK_UN); fclose($lock); }
    }
}

// Whole file or nothing: written to a private temp name in the same directory
// (so the rename cannot cross a filesystem), 0600 from the moment it exists,
// then renamed over the cache. A failure to cache is never a failure to pay -
// the token in hand is still good.
function cbk_write_token_cache(array $cfg, string $token): void
{
    $file = (string) ($cfg['token_cache_file'] ?? '');
    if ($file === '') return;
    $json = json_encode(['token' => $token, 'ts' => time(),
        'owner' => hash('sha256', cbk_base($cfg) . "\0" . (string) $cfg['client_id'])]);
    $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
    $h = @fopen($tmp, 'x');
    if ($h === false) return;
    @chmod($tmp, 0600);
    $ok = fwrite($h, $json) === strlen($json);
    $ok = fclose($h) && $ok;
    if (!$ok || !@rename($tmp, $file)) @unlink($tmp);
}

// "At most one token purge per window", decided atomically. Returns null when
// the caller may purge (and records that it did), otherwise the seconds since
// the purge that is still in force.
//
// RACE K2-3: the rule used to be read the marker, compare, write the marker -
// three steps with nothing between them, so a burst of unauthenticated
// ?ErrorCode=TIJ0009 returns could all read "no recent purge" before any wrote
// one, and every one of them deleted the credential cache. The marker is now
// read and rewritten under one exclusive lock on the marker file itself. If the
// marker cannot be opened at all, the answer is "purge" - what the old code did
// when it could not read it.
function cbk_token_purge_claim(array $cfg, int $window = 600): ?int
{
    $stamp = (string) ($cfg['token_cache_file'] ?? '') . '.purged';
    if ($stamp === '.purged') return null;
    $h = @fopen($stamp, 'c+');
    if ($h === false) return null;
    flock($h, LOCK_EX);
    $last = (int) trim((string) stream_get_contents($h));
    $now = time();
    $since = $now - $last;
    $granted = $since > $window;
    if ($granted) {
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, (string) $now);
        fflush($h);
    }
    flock($h, LOCK_UN);
    fclose($h);
    return $granted ? null : $since;
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
