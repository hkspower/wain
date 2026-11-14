<?php
// Classic KNET (KPG) direct integration — crypto + helpers (native PHP).
//
// Built to behave like KNET's official iPayPipe 1.0 plug-in (com.fss.plugin,
// decompiled read-only; see sporta-web/KNET-IPAYPIPE-CHECK.md) wherever the
// bytes on the wire depend on it:
//
//   * trandata is AES-128-CBC with the 16-byte Terminal Resource Key as BOTH
//     the AES key and the IV (AESAlgorithm.java:22 and :44 build the
//     IvParameterSpec from the key itself), PKCS5/7 padding, uppercase hex.
//     There is NO fixed IV: "PGKEYENCDECIVSPC", which older notes here named,
//     appears nowhere in the plug-in, and with it every byte of the first
//     block decrypts to garbage at the bank.
//   * the plaintext is key=value pairs, each followed by '&', with the values
//     RAW: no URL encoding (iPayPipe.java:181-275 buildHostRequest, and
//     :145-146 for id and password), and empty values are never sent. The
//     bank's reader splits on '&' and '=' and decodes nothing (:776-779), so
//     a value that holds one of those characters cannot be carried at all and
//     is refused here rather than corrupted (knet_build_trandata).
//
// Gateway: kpaytest.com.kw or www.kpaytest.com.kw (test), kpay.com.kw or
// www.kpay.com.kw (production), path /kpg/PaymentHTTP.htm and nothing else.
// The ONLY successful purchase result is "CAPTURED" (callback.php); the
// plug-in itself judges nothing, and no other word means paid here.

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

// The two gateway addresses each environment may use: the bare host and its
// www. twin, on the one path KPG serves the hosted page from. The plug-in takes
// its host from the bank's own <webaddress> (iPayPipe.java:147, 150) and the
// bank's manual spells it with www.; Sporta's earlier pin accepted only the
// bare form, which would have answered 503 to every shopper had the terminal's
// address been the www. one. EXACT strings, compared byte for byte: no other
// host, port, user, query, fragment or path is a gateway (a lookalike domain or
// a "kpay.com.kw@evil" URL would carry the encrypted credentials elsewhere).
// admin.php (store_knet_gateway_url_ok in store.php) holds the same list.
const KNET_GATEWAY_URLS = [
    'test'       => ['https://kpaytest.com.kw/kpg/PaymentHTTP.htm', 'https://www.kpaytest.com.kw/kpg/PaymentHTTP.htm'],
    'production' => ['https://kpay.com.kw/kpg/PaymentHTTP.htm', 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm'],
];

// A value that cannot travel RAW inside the request trandata, or null when it
// can. The plaintext is key=value&key=value&... with no decoding at the bank
// (iPayPipe.parsetrandata, :776-779), so '&' and '=' would split the value;
// '?' and '#' would end a return URL early wherever it is read as a URL; CR,
// LF, NUL and the other control characters have no business in a credential
// or an address and are how header and log injection begin. Refusing is the
// only safe answer: an encoded value is a different value to a raw reader
// (p@ss became p%40ss on the wire before this), and a silently shortened one
// is a wrong password or an unreachable callback.
function knet_raw_value_problem(string $value): ?string
{
    if (strpbrk($value, '&=?#') !== false) return 'contains one of & = ? #';
    if (preg_match('/[\x00-\x1F\x7F]/', $value) === 1) return 'contains a control character';
    return null;
}

final class KnetUnsafeValue extends RuntimeException {}

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
    // The four values pay.php copies into the trandata from this file. The
    // message names the field, never the value: it is logged.
    foreach (['tranportal_id', 'tranportal_password', 'response_url', 'error_url'] as $field) {
        $problem = knet_raw_value_problem((string) $cfg[$field]);
        if ($problem !== null) {
            throw new KnetUnsafeValue($field . ' ' . $problem . ', which the KNET request cannot carry');
        }
    }

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
    $isLocalTest = $env === 'test' && in_array($selectedHost, ['127.0.0.1', 'localhost'], true);
    if (!$isLocalTest && !in_array($selected, KNET_GATEWAY_URLS[$env], true)) {
        throw new RuntimeException($env . ' mode must use ' . implode(' or ', KNET_GATEWAY_URLS[$env]));
    }
    // langid: AR for the Arabic page, USA for the English one. These are the
    // values Sporta has always sent; the plug-in passes langid through raw and
    // names no constant (iPayPipe.java:263-265), so the reference cannot confirm
    // them. TO BE CONFIRMED on the first Arabic TEST payment (KNET.md): the
    // bank's page must come up in Arabic for ?lang=ar.
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

// The request plaintext, in the plug-in's exact form (iPayPipe.java:181-275
// buildHostRequest, then :145-146): every NON-EMPTY field as key=value
// followed by '&', values RAW, in the order given. pay.php passes the fields
// in the plug-in's order, so for the same values this is byte for byte what
// the plug-in encrypts (knet-test.mjs rebuilds it independently and compares
// the ciphertext).
//
// NO URL ENCODING, on purpose. The bank's reader splits on '&' and '=' and
// decodes nothing (:776-779). This used to urlencode every value, so
// responseURL reached the bank as https%3A%2F%2Fwww.sporta.com.kw%2F... and a
// password with '@' or '!' as a different password. A value that a raw reader
// cannot carry is REFUSED (KnetUnsafeValue, naming the field, never the
// value) — the request is never sent half-right. http_build_query is still
// right for the OUTER query string (pay.php), which is a normal URL.
//
// Empty values are skipped, as the plug-in skips them ("if (x.length() > 0)"
// for every field): it never sends "udf1=".
function knet_build_trandata(array $fields): string
{
    $out = '';
    foreach ($fields as $k => $v) {
        $k = (string) $k;
        $v = (string) $v;
        if (!preg_match('/^[A-Za-z][A-Za-z0-9]{0,31}$/D', $k)) {
            throw new KnetUnsafeValue('a trandata field name is not a plain word');
        }
        if ($v === '') continue;
        $problem = knet_raw_value_problem($v);
        if ($problem !== null) {
            throw new KnetUnsafeValue($k . ' ' . $problem . ', which the KNET request cannot carry');
        }
        $out .= $k . '=' . $v . '&';
    }
    return $out;
}

// The RESPONSE trandata the bank sends back. Unlike the request this keeps
// urldecode: the bank writes the response, the plug-in reads it raw, and the
// two agree on every value KNET returns (NOT+CAPTURED would become
// NOT CAPTURED, which is not CAPTURED either way). KNET-IPAYPIPE-CHECK.md
// section 3, "Response decoding", proves it harmless; it is left alone so the
// fix to the request does not also move the settlement rules.
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
        // The shopper, not the proxy in front of the server — which made every
        // line of the log name the same address.
        'ip'    => knet_client_ip($cfg),
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
    $hasDb = ($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '';
    // Two more keys come from the store's config, and only from there: which
    // proxies may name the client (trusted_proxy_ips), so the payment log and
    // the limiter see the shopper and not Traefik; and rate_limit_secret, so a
    // KNET bucket key is the same HMAC the store computes. A value in this
    // config wins, as with the database.
    $wantProxies = !array_key_exists('trusted_proxy_ips', $cfg) || !array_key_exists('rate_limit_secret', $cfg);
    if ($hasDb && !$wantProxies) return $cfg;
    try {
        $path = knet_config_path('api', dirname(__DIR__) . '/api/config.php');
    } catch (Throwable $e) {
        // The DATABASE borrow fails closed, exactly as before; a proxy list for
        // the log is not worth refusing a payment over.
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
    if ($wantProxies) {
        foreach (['trusted_proxy_ips', 'rate_limit_secret'] as $key) {
            if (!array_key_exists($key, $cfg) && array_key_exists($key, $store)) $cfg[$key] = $store[$key];
        }
    }
    return $cfg;
}

// The shopper's address, by the one rule the store and T-Pay use
// (sporta_client_ip in api/config-path.php). A standalone drop-in with no
// resolver has no proxy list to trust, so the direct peer is the answer.
function knet_client_ip(array $cfg): string
{
    if (!function_exists('sporta_client_ip')) return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    return sporta_client_ip(sporta_trusted_proxy_rules($cfg['trusted_proxy_ips'] ?? []));
}

// A per-client limit on the two KNET endpoints a stranger can call, in the
// store's own rate_limit table, through the store's own counter
// (sporta_rate_limit_hit) and key (sporta_rate_limit_key) — the same HMAC the
// store derives when the two configs name the same database. Keyed on the
// client's /64 for IPv6 (sporta_rate_identity). It mirrors cbk_rate_hit in the
// T-Pay dropin: the two gateways are one pair and must be guarded alike.
//
// Returns null when there is nothing to count with (no resolver, no
// database, or the table is unreachable): the endpoints keep working, which is
// what they did before the limit existed. A database that is down must never
// stop a shopper — or the bank — coming back to record a payment.
/** @return array{allowed:bool,hits:int,retry_after:int}|null */
function knet_rate_hit(array $cfg, string $bucket, int $max, int $windowSec): ?array
{
    if (!function_exists('sporta_rate_limit_hit') || !knet_db_configured($cfg)) return null;
    try {
        $key = sporta_rate_limit_key($bucket, sporta_rate_identity(knet_client_ip($cfg)),
            (string) ($cfg['rate_limit_secret'] ?? ''),
            [(string) $cfg['mysql_name'], (string) $cfg['mysql_user'], (string) ($cfg['mysql_pass'] ?? '')]);
        return sporta_rate_limit_hit(knet_pdo($cfg), $key, $max, $windowSec);
    } catch (Throwable $e) {
        return null;
    }
}

// Refuse with 429 and no gateway call, no database work and no log line.
// Plain text: these are pages a shopper's browser lands on, not API responses.
function knet_rate_refuse(array $state, string $message): never
{
    http_response_code(429);
    header('Retry-After: ' . max(1, (int) $state['retry_after']));
    header('Content-Type: text/plain; charset=utf-8');
    exit($message);
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
// HOW MANY TIMES ONE ORDER MAY BE SENT TO THE BANK. Every start of pay.php is
// one attempt number and one paymentInit redirect, and pay.php needs only a
// pending track id — so without a ceiling, a loop over one order's link made
// the bank receive paymentInit after paymentInit for the same order and wrote a
// log line each time. Ten is far past a shopper retrying a declined card; past
// it the order is refused BEFORE a reference is allocated or anything is sent
// (the same ceiling as CBK_MAX_ATTEMPTS in the T-Pay dropin), and the shopper
// starts a new checkout.
const KNET_MAX_ATTEMPTS = 10;

final class KnetTooManyAttempts extends RuntimeException {}

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
            and fulfilment_status <> 'cancelled'
            and pay_attempt < " . KNET_MAX_ATTEMPTS
    );
    $st->execute([$trackid]);
    if ($st->rowCount() !== 1) {
        // The ceiling is part of the UPDATE, so a refused start does not bump
        // the counter either. Tell "ten starts already" apart from "not
        // payable any more": same conditions, minus the ceiling.
        $chk = $pdo->prepare(
            "select count(*) from orders
              where track_id = ? and payment_method = 'knet' and payment_status = 'pending'
                and stock_released = 0 and fulfilment_status <> 'cancelled'
                and pay_attempt >= " . KNET_MAX_ATTEMPTS
        );
        $chk->execute([$trackid]);
        if ((int) $chk->fetchColumn() === 1) throw new KnetTooManyAttempts('too many payment attempts for this order');
        throw new RuntimeException('order is no longer payable by KNET');
    }
    $n = (int) $pdo->query('select last_insert_id()')->fetchColumn();
    if ($n < 1) {
        throw new RuntimeException('could not allocate a KNET attempt reference');
    }
    return knet_attempt_ref_for($trackid, $n);
}

// The reference attempt number $n of an order carries — a pure function of the
// two, so the stock sweeper's inquiry (knet_inquire_order) can name every
// reference an order was ever sent to the bank under without allocating one.
function knet_attempt_ref_for(string $trackid, int $n): string
{
    if ($n <= 1) return $trackid;
    $suffix = 'A' . $n;
    // KNET's trackid field is limited; trim the ORDER part, never the suffix,
    // since the suffix is what makes it unique. pay.php also sends the full
    // order id in udf5 so callback.php can resolve a trimmed retry safely.
    return substr($trackid, 0, max(1, 30 - strlen($suffix))) . $suffix;
}

// A reference that came BACK from the bank, resolved to the order it belongs to.
//
// The order of the lookups is the safety property, and it is NOT "exact match
// first" any more (RACE K1-6): track ids are chosen by the browser, so an order
// NAMED <victim>A2 can exist, and trying the exact match first settled it with
// the victim's second attempt. The order is: (1) the bank-signed udf5 hint, when
// it reproduces the echoed reference and its order exists; (2) the exact match
// (legacy orders, and attempt one, whose reference IS its udf5 - the same
// answer as (1)); (3) the suffix stripped from a legacy retry that carried no
// udf5. Do not move (2) back above (1): test:race-money (a2-resolver) fails.
//
// Getting this wrong is the worst failure the shop has: the callback updates
// `where track_id = ?`, so an unresolved reference means the bank captured the
// money and the order stayed pending, with nothing to say why.
function knet_resolve_track(array $cfg, string $ref, string $orderHint = ''): string
{
    if ($ref === '' || !knet_db_configured($cfg)) return $ref;
    try {
        $q = knet_pdo($cfg)->prepare('select 1 from orders where track_id = ?');

        // RACE K1-6 (the "A2 hole"): THE BANK-SIGNED HINT IS TRIED FIRST.
        // pay.php reserves udf5 for the original order reference, and udf5
        // comes back inside the decrypted trandata, i.e. it is the one thing
        // here the bank vouches for. It is needed when a 30-character order id
        // is shortened to make room for the retry suffix; it is accepted only
        // when it deterministically produces the reference KNET echoed
        // (knet_attempt_ref_matches_order), and when the hinted order exists.
        //
        // The exact match used to come first, and that is a collision: track
        // ids are chosen by the browser, so an order named <victim>A2 can be
        // placed by anyone for the same total, and the victim's SECOND attempt
        // (reference <victim>A2, udf5 <victim>) then matched the look-alike
        // exactly and paid for IT. With the hint first the victim's order is
        // the one settled. Attempt one is unchanged: its reference IS its udf5.
        if (preg_match('/^[A-Za-z0-9]{1,30}$/', $orderHint)
            && knet_attempt_ref_matches_order($ref, $orderHint)) {
            $q->execute([$orderHint]);
            if ($q->fetchColumn()) return $orderHint;
        }

        $q->execute([$ref]);
        if ($q->fetchColumn()) return $ref;

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

// How many times in all a callback's settlement transaction is run when it loses
// a deadlock or waits out the lock timeout (RACE K1-7).
const KNET_SETTLE_ATTEMPTS = 3;

// A transaction that lost a deadlock (1213, SQLSTATE 40001) or waited out the
// lock timeout (1205) rolled back completely and may be run again from its
// first statement (RACE K1-7). Nothing else is retried.
function knet_tx_retryable(Throwable $e): bool
{
    if (!($e instanceof PDOException)) return false;
    $code = (int) ($e->errorInfo[1] ?? 0);
    // 1020 ("Record has changed since last read") is what MariaDB 11.8 (the VPS) answers, with
    // innodb_snapshot_isolation on by default, to a write against a row committed after the
    // transaction's read view. The settlement locks the order row FIRST, so it should not meet it;
    // it is retried like a deadlock if it ever does (RACE K1-12).
    return $code === 1213 || $code === 1205 || $code === 1020 || (string) $e->getCode() === '40001';
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

// ======================================================================= settlement
// Moved here from callback.php without a change to its logic (KNET-IPAYPIPE-CHECK.md D2):
// callback.php calls it for the bank's notification, and cron-stock.php calls it through
// knet_inquire_order when a server-to-server inquiry finds a capture whose callback never
// arrived. One function, so the two can never disagree about what "paid" means.

// Return ['state' => 'paid'|'failed'|'review', 'reason' => string]. A new paid
// result is returned only after commit. An already-paid KNET order also returns
// paid, without rewriting it or queueing any success/failure side effect.
//
// RACE K1-7: THE BANK DOES NOT CALL BACK TWICE, so a captured payment that met
// a lock-wait timeout (1205: an admin screen, the sweeper or a long report held
// the order row for more than the database's wait) or lost a deadlock (1213)
// used to be filed as "review" with the order left PENDING and the money taken;
// two hours later the sweeper gave its stock away. The settlement is one
// transaction that rolls back completely, so it is run again, from the top, up
// to KNET_SETTLE_ATTEMPTS times in all, with a short growing pause. Only those
// two errors are retried; everything else still fails closed to review.
// (KNET_SETTLE_ATTEMPTS is defined above, with the other constants.)
// $source names the reader for the payment_alerts row a second capture writes
// ('callback' or 'inquiry'); it changes nothing else.
function knet_settle_order(
    array $cfg,
    string $trackid,
    bool $bankPaid,
    string $result,
    string $paidAmount,
    array $fields,
    string $source = 'callback'
): array
{
    for ($attempt = 1; ; $attempt++) {
        $out = knet_settle_order_once($cfg, $trackid, $bankPaid, $result, $paidAmount, $fields, $attempt, $source);
        if (empty($out['retry']) || $attempt >= KNET_SETTLE_ATTEMPTS) {
            unset($out['retry']);
            return $out;
        }
        usleep(random_int(40, 160) * 1000 * $attempt);
    }
}

function knet_settle_order_once(
    array $cfg,
    string $trackid,
    bool $bankPaid,
    string $result,
    string $paidAmount,
    array $fields,
    int $attempt,
    string $source = 'callback'
): array
{
    try {
        $pdo = knet_pdo($cfg);
        // Wait at most 8 s for a row lock (never longer than the database's own
        // setting, 50 s by default): three attempts then take about 25 s at the
        // worst, where one wait used to take 50 s and end in "review".
        // BEST EFFORT (added in review): a refused SET must never turn a captured
        // payment into "review". Without it the settlement simply waits as long as
        // the database's own setting says, which is what it did before this cap.
        try {
            $pdo->exec('set session innodb_lock_wait_timeout = least(@@session.innodb_lock_wait_timeout, 8)');
        } catch (Throwable $e) {
            // keep the server's wait
        }
        $pdo->beginTransaction();

        // Lock first so amount/status/method verification and settlement see
        // one state even when the bank retries concurrently.
        // cbk_paymentid and cbk_message (the bank's raw result word) are read
        // under the same lock for the second-capture check below (K-063 B3).
        $cur = $pdo->prepare(
            'select id, amount, payment_status, payment_method, stock_released, fulfilment_status,
                    cbk_paymentid, cbk_message, cbk_transaction, cbk_reference, cbk_status, pay_attempt
               from orders where track_id = ? for update'
        );
        $cur->execute([$trackid]);
        $order = $cur->fetch(PDO::FETCH_ASSOC);
        if (!$order) {
            $pdo->rollBack();
            return ['state' => 'review', 'reason' => 'order_not_found'];
        }
        $before = (string) $order['payment_status'];
        $methodMatches = ((string) $order['payment_method'] === 'knet');

        // Any replay or late failure after a durable payment is a no-op. This
        // prevents both a downgrade and the old duplicate "do not ship" queue.
        //
        // EXCEPT A SECOND CAPTURE (K-063 B3 / C1). The same notification
        // replayed carries the same Payment ID and stays a silent no-op. A
        // CAPTURED result under a DIFFERENT Payment ID is a second charge on an
        // order that is already paid (a retried bank page, a second tab): the
        // money is real and the customer is owed it back. It used to be
        // answered "already_paid" with nothing written; it is now kept as a
        // payment_alerts row (one per extra Payment ID, so a replay of IT is a
        // no-op too) and logged as callback.duplicate_capture, and the order is
        // left exactly as it was. The owner refunds that payment in KPay and
        // records it in /backends (payment-records.php).
        $incomingPayId = trim((string)($fields['paymentid'] ?? ''));
        $recordedPayId = trim((string)($order['cbk_paymentid'] ?? ''));
        $secondCapture = $bankPaid && $methodMatches && $incomingPayId !== ''
            && !hash_equals($recordedPayId, $incomingPayId);
        if ($before === 'paid' && $methodMatches) {
            if ($secondCapture && (string) ($order['cbk_status'] ?? '') === 'MANUAL_BANK_CONFIRMED') {
                // SETTLED BY HAND, THEN THE BANK'S OWN ANSWER (review 1, finding
                // 3). /backends "settle card payment" (admin.php card_settled)
                // stores whatever the owner typed as the bank reference in
                // cbk_paymentid, so the bank's real Payment ID arriving later
                // does not match it. That is the SAME payment, not a second
                // charge: it used to be filed as a duplicate_capture alert,
                // which told the owner to refund the order's only payment.
                $adopted = knet_adopt_after_manual($pdo, $cfg, $order, $trackid, $paidAmount, $fields, $source);
                if ($adopted !== null) return $adopted;
            }
            if ($secondCapture) {
                return knet_keep_duplicate_capture($pdo, $cfg, $order, $trackid, $incomingPayId, $recordedPayId,
                    $paidAmount, $fields, $source, ['state' => 'paid', 'reason' => 'duplicate_capture']);
            }
            $pdo->rollBack();
            return ['state' => 'paid', 'reason' => 'already_paid'];
        }
        // A payment the owner REFUNDED or VOIDED in KPay and recorded in
        // /backends is final. No notification, replayed or late, may make the
        // order paid again: that would put the money back in revenue and queue
        // "PAYMENT CONFIRMED - ship it" for an order the customer was paid back
        // for. A capture under a Payment ID the order does not record is a new
        // charge and is kept as an alert, as above.
        if (($before === 'refunded' || $before === 'voided') && $methodMatches) {
            if ($secondCapture) {
                return knet_keep_duplicate_capture($pdo, $cfg, $order, $trackid, $incomingPayId, $recordedPayId,
                    $paidAmount, $fields, $source, ['state' => 'review', 'reason' => 'duplicate_capture']);
            }
            $pdo->rollBack();
            return ['state' => 'refunded', 'reason' => 'already_refunded'];
        }
        // A capture parked for review (wrong amount, stock released, ...) that
        // is followed by ANOTHER capture under a different Payment ID: the
        // settlement below writes the new Payment ID over the old one, so the
        // first charge would survive only in the payment log. It is kept as an
        // alert first, then the settlement runs exactly as before.
        if ($before === 'review' && $secondCapture && $recordedPayId !== ''
            && strtoupper(trim((string)($order['cbk_message'] ?? ''))) === 'CAPTURED') {
            knet_alert_duplicate_capture($pdo, $cfg, (int) $order['id'], $recordedPayId, $incomingPayId, null,
                ['tranid' => (string) ($order['cbk_transaction'] ?? ''), 'ref' => (string) ($order['cbk_reference'] ?? '')],
                $trackid, $source);
        }

        // A NON-CAPTURE answer for an attempt the order has already moved past
        // (the echoed reference <track>A<n> names attempt n; no suffix is attempt
        // one). It would fail an order whose newer attempt is still open, and the
        // shopper could then not finish paying it. A capture is money and is always
        // recorded below, as before. Nothing is written here.
        $echoedRef = trim((string)($fields['trackid'] ?? ''));
        $echoAttempt = ($echoedRef !== '' && $echoedRef !== $trackid && preg_match('/A(\d+)$/D', $echoedRef, $echoM))
            ? (int) $echoM[1] : 1;
        if (!$bankPaid && $echoAttempt < (int) ($order['pay_attempt'] ?? 0)) {
            $pdo->rollBack();
            knet_log($cfg, 'callback.superseded_attempt', [
                'trackid' => $trackid, 'attempt' => $echoAttempt, 'current' => (int) $order['pay_attempt'],
                'result' => $result,
            ]);
            return ['state' => 'superseded', 'reason' => 'superseded_attempt'];
        }

        $recordResult = $result;
        $reason = $bankPaid ? 'captured' : 'bank_declined';
        if (!$methodMatches) {
            // A valid KNET callback for a T-Pay/COD order may mean money moved
            // through the wrong rail. Hold an unpaid order and preserve the
            // bank references for an operator; never mark it paid or trigger
            // fulfilment. An order already paid elsewhere stays paid.
            if ($before === 'paid') {
                $pdo->rollBack();
                return ['state' => 'review', 'reason' => 'wrong_payment_method'];
            }
            if ($before === 'review') {
                $pdo->rollBack();
                return ['state' => 'review', 'reason' => 'already_under_review'];
            }
            $after = 'review';
            $recordResult = 'WRONG_PAYMENT_METHOD';
            $reason = 'wrong_payment_method';
        } elseif ($bankPaid) {
            $expectedFils = knet_amount_fils((string) $order['amount']);
            $paidFils = knet_amount_fils($paidAmount);
            if (trim((string)($fields['paymentid'] ?? '')) === '') {
                $after = 'review';
                $recordResult = 'MISSING_PAYMENT_ID';
                $reason = 'missing_payment_id';
            } elseif ($expectedFils === null || $expectedFils <= 0) {
                $after = 'review';
                $recordResult = 'INVALID_ORDER_AMOUNT';
                $reason = 'invalid_order_amount';
            } elseif ($paidFils === null || $paidFils <= 0) {
                $after = 'review';
                $recordResult = 'INVALID_CAPTURED_AMOUNT';
                $reason = 'invalid_captured_amount';
            } elseif ($expectedFils !== $paidFils) {
                $after = 'review';
                $recordResult = 'AMOUNT_MISMATCH';
                $reason = 'amount_mismatch';
            } elseif (knet_payment_id_elsewhere($pdo, (int) $order['id'], $incomingPayId)) {
                // ONE PAYMENT, ONE ORDER (review 1, finding 1). Another KNET
                // order already records this Payment ID: the bank charged once,
                // and a second "paid" mark would ship two orders for it. Held
                // for review; the owner decides which order the money is for.
                $after = 'review';
                $recordResult = 'PAYMENT_ID_IN_USE';
                $reason = 'payment_id_in_use';
            } elseif ((string)$order['fulfilment_status'] === 'cancelled') {
                // The shop cancelled this order by hand and the warehouse was
                // told "do not ship". The bank's capture is real money, but a
                // paid mark here would queue "PAYMENT CONFIRMED - ship it" after
                // that do-not-ship. The payment is held for the operator: the
                // order is reinstated (or not) and then settled by hand.
                $after = 'review';
                $recordResult = 'ORDER_CANCELLED';
                $reason = 'order_cancelled';
            } elseif ((int)$order['stock_released'] === 1) {
                // Money may arrive after the reservation expired. Those
                // garments are for sale again, so an operator must reconcile
                // stock/refund before this payment may authorize fulfilment.
                $after = 'review';
                $recordResult = 'STOCK_RESERVATION_RELEASED';
                $reason = 'stock_reservation_released';
            } elseif (knet_discount_given_back($pdo, (int) $order['id'])) {
                // RACE K1-8: the same rule for the DISCOUNT. An order with no
                // sized garments claims no stock, so stock_released stays 0
                // however long it waits, but its code use is handed back the
                // moment it is declined (store_discount_release). A second bank
                // page that captures AFTER that would mark it paid while the
                // use belongs to somebody else: a single-use code spent twice.
                // Held for review instead; settling it by hand re-claims the use
                // (store_order_reclaim) or refuses if the code has since run out.
                $after = 'review';
                $recordResult = 'DISCOUNT_RELEASED';
                $reason = 'discount_released';
            } else {
                $after = 'paid';
            }
        } else {
            // Once an order is under review, a later failure must not release
            // stock, overwrite reconciliation data, or queue a "do not ship"
            // message. Only a verified capture or an operator may resolve it.
            if ($before === 'review') {
                $pdo->rollBack();
                return ['state' => 'review', 'reason' => 'already_under_review'];
            } elseif (!in_array($result, ['NOT CAPTURED', 'CANCELED', 'CANCELLED'], true)) {
                $after = 'review';
                $recordResult = 'UNRECOGNIZED_RESULT';
                $reason = 'unrecognized_bank_result';
            } else {
                $after = 'failed';
            }
        }

        $sql = 'update orders set payment_status = ?, cbk_status = ?, cbk_message = ?,
                  cbk_paymentid = ?, cbk_transaction = ?, cbk_reference = ?,
                  cbk_authcode = ?, cbk_receipt = ?, cbk_paytype = ?, paid_at = ?
                where id = ?';
        $st = $pdo->prepare($sql);
        $st->execute([
            $after,
            $recordResult,
            (string)($fields['result'] ?? ''), (string)($fields['paymentid'] ?? ''),
            (string)($fields['tranid'] ?? ''), (string)($fields['ref'] ?? ''),
            (string)($fields['auth'] ?? ''), (string)($fields['receipt'] ?? ''),
            (string)($fields['paytype'] ?? ''),
            $after === 'paid' ? gmdate('Y-m-d H:i:s') : null,
            (int) $order['id'],
        ]);

        // The Merchant Track ID this answer came back under (the order's track
        // id, or <track>A<n> for a retry): what KPay lists the payment under and
        // what the customer's receipt calls the Track ID (K-063 C4, D1). Its own
        // statement in a savepoint, as CBK's Track ID is (php-cbk/callback.php):
        // on a database without refunds.mysql.sql the column is missing, and
        // that must cost the reference, never the settlement above.
        $echoed = trim((string)($fields['trackid'] ?? ''));
        if (preg_match('/^[A-Za-z0-9]{1,30}$/D', $echoed)) {
            $pdo->exec('savepoint knet_attempt_ref');
            try {
                $pdo->prepare('update orders set gateway_attempt_ref = ? where id = ?')->execute([$echoed, (int) $order['id']]);
                $pdo->exec('release savepoint knet_attempt_ref');
            } catch (PDOException $e) {
                if (knet_tx_retryable($e)) throw $e;
                $pdo->exec('rollback to savepoint knet_attempt_ref');
            }
        }

        // rowCount() may be zero for an exact replay. Verify the state instead
        // of treating "unchanged" as "not written".
        $verify = $pdo->prepare('select payment_status, cbk_status from orders where id = ?');
        $verify->execute([(int) $order['id']]);
        $stored = $verify->fetch(PDO::FETCH_ASSOC);
        if (!$stored || (string) $stored['payment_status'] !== $after
            || (string) $stored['cbk_status'] !== $recordResult) {
            throw new RuntimeException('KNET settlement did not persist');
        }

        // Queue only a real transition. Replays and review states have no
        // fulfilment side effect.
        if ($before !== $after && ($after === 'paid' || $after === 'failed')) {
            // The ship-it / do-not-ship follow-up, queued in the same
            // transaction as the status it reports.
            $storeLib = dirname(__DIR__) . '/api/store.php';
            if (!is_file($storeLib)) $storeLib = dirname(__DIR__) . '/php-store/store.php';
            if (is_file($storeLib)) {
                require_once $storeLib;
                store_queue_fulfilment($pdo, (int) $order['id'], 'payment');
            }
        }

        if (!$pdo->commit()) {
            throw new RuntimeException('KNET settlement commit failed');
        }
        return ['state' => $after, 'reason' => $reason];
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        knet_log($cfg, 'callback.db_write_failed', [
            'trackid' => $trackid,
            'result' => $result,
            'payid' => (string)($fields['paymentid'] ?? ''),
            'attempt' => $attempt,
            'error' => $e->getMessage(),
        ]);
        return ['state' => 'review', 'reason' => 'database_write_failed', 'retry' => knet_tx_retryable($e)];
    }
}

// Does another KNET order already record $payId as its payment? Read in the
// settlement transaction (a plain read: the column has no index and the order
// table is small; a locking read would lock every row it scans). orders has no
// unique key on cbk_paymentid (a manual settlement stores free text there), so
// this is the check. Two settlements of the same Payment ID for two different
// orders in the same instant can both pass it; the bank answers one payment
// once per channel, so that needs the callback and the inquiry to race on two
// orders within the same second, and the daily KPay check (KNET.md 3h) still
// shows one Payment ID on two orders.
function knet_payment_id_elsewhere(PDO $pdo, int $orderId, string $payId): bool
{
    if ($payId === '') return false;
    $q = $pdo->prepare("select 1 from orders where cbk_paymentid = ? and id <> ? and payment_method = 'knet' limit 1");
    $q->execute([$payId, $orderId]);
    return (bool) $q->fetchColumn();
}

// Has this order's discount use already been handed back? Read under the order's
// row lock, in the settlement transaction. A database that never had
// discount-release.mysql.sql has no such column and nothing was ever returned
// (error 1054, a statement error that leaves the transaction open).
function knet_discount_given_back(PDO $pdo, int $orderId): bool
{
    try {
        $q = $pdo->prepare('select discount_released from orders where id = ?');
        $q->execute([$orderId]);
        return (int) $q->fetchColumn() === 1;
    } catch (PDOException $e) {
        if ((int) ($e->errorInfo[1] ?? 0) === 1054) return false;
        throw $e;
    }
}

// The bank's answer for an order the owner already settled by hand: the bank's
// fields (Payment ID, Transaction ID, reference, auth code, ...) replace the
// typed reference, so the receipt, the export and any LATER capture are compared
// with the bank's own Payment ID. The order's status, paid time and the "settled
// in admin by <email>" note are kept; cbk_status becomes MANUAL_THEN_CAPTURED,
// so this happens once: a capture under yet another Payment ID after it is a
// second charge again. Taken only when the amount is the order's and no other
// order holds that Payment ID; otherwise null, and the caller keeps it as an
// alert for the owner (an unexplained capture is better seen than absorbed).
// The owner's typed reference is kept in the payment log.
// Called with the row lock held and the transaction open; it closes it when it
// answers. A retryable error propagates to knet_settle_order_once's catch.
function knet_adopt_after_manual(
    PDO $pdo, array $cfg, array $order, string $trackid, string $paidAmount, array $fields, string $source
): ?array {
    $payId = trim((string) ($fields['paymentid'] ?? ''));
    $expected = knet_amount_fils((string) $order['amount']);
    $paid = knet_amount_fils($paidAmount);
    if ($payId === '' || $expected === null || $paid === null || $expected !== $paid
        || knet_payment_id_elsewhere($pdo, (int) $order['id'], $payId)) {
        return null;
    }
    $pdo->prepare("update orders set cbk_status = 'MANUAL_THEN_CAPTURED', cbk_paymentid = ?, cbk_transaction = ?,
                          cbk_reference = ?, cbk_authcode = ?, cbk_receipt = ?, cbk_paytype = ?
                    where id = ? and payment_status = 'paid' and cbk_status = 'MANUAL_BANK_CONFIRMED'")
        ->execute([
            $payId, (string) ($fields['tranid'] ?? ''), (string) ($fields['ref'] ?? ''),
            (string) ($fields['auth'] ?? ''), (string) ($fields['receipt'] ?? ''), (string) ($fields['paytype'] ?? ''),
            (int) $order['id'],
        ]);
    $echoed = trim((string) ($fields['trackid'] ?? ''));
    if (preg_match('/^[A-Za-z0-9]{1,30}$/D', $echoed)) {
        $pdo->exec('savepoint knet_attempt_ref');
        try {
            $pdo->prepare('update orders set gateway_attempt_ref = ? where id = ?')->execute([$echoed, (int) $order['id']]);
            $pdo->exec('release savepoint knet_attempt_ref');
        } catch (PDOException $e) {
            if (knet_tx_retryable($e)) throw $e;
            $pdo->exec('rollback to savepoint knet_attempt_ref');
        }
    }
    if (!$pdo->commit()) throw new RuntimeException('KNET settlement commit failed');
    knet_log($cfg, 'callback.manual_settlement_confirmed', [
        'trackid' => $trackid, 'source' => $source, 'payid' => $payId,
        'typed_reference' => (string) ($order['cbk_paymentid'] ?? ''), 'amt' => $paidAmount,
        'tranid' => (string) ($fields['tranid'] ?? ''), 'ref' => (string) ($fields['ref'] ?? ''),
    ]);
    return ['state' => 'paid', 'reason' => 'manual_settlement_confirmed'];
}

// ============================================================ second captures (B3)
//
// Keep a second capture as a payment_alerts row, commit, log it, and answer
// $answer. The order row is not written. Called with the order's row lock held
// and the settlement transaction open; it always closes the transaction.
function knet_keep_duplicate_capture(
    PDO $pdo, array $cfg, array $order, string $trackid, string $extraPayId, string $recordedPayId,
    string $paidAmount, array $fields, string $source, array $answer
): array {
    // A retryable error propagates to knet_settle_order_once's catch (and is
    // run again); any other refusal of the row is 'not_saved' and is logged.
    $kept = knet_alert_duplicate_capture($pdo, $cfg, (int) $order['id'], $extraPayId,
        $recordedPayId === '' ? null : $recordedPayId, $paidAmount, $fields, $trackid, $source);
    try {
        if ($pdo->inTransaction() && !$pdo->commit()) throw new RuntimeException('commit failed');
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $kept = 'not_saved';
    }
    // The order is already settled: whatever happened to the alert row, the
    // answer stays the order's own, so the shopper is never told a paid order
    // is under review because a bookkeeping row could not be written.
    knet_log($cfg, 'callback.duplicate_capture', [
        'trackid' => $trackid, 'source' => $source, 'payid' => $extraPayId, 'order_payid' => $recordedPayId,
        'amt' => $paidAmount, 'ref' => (string)($fields['ref'] ?? ''), 'tranid' => (string)($fields['tranid'] ?? ''),
        'attempt_ref' => (string)($fields['trackid'] ?? ''), 'alert' => $kept,
    ]);
    return $answer;
}

// One payment_alerts row for a captured Payment ID the order does not record.
// Returns 'saved', 'already_known' (the unique key: this Payment ID was seen
// before), or 'not_saved' (refunds.mysql.sql not imported yet: 1146, or any
// other statement error). The insert runs inside a savepoint, so a refused
// statement leaves the settlement transaction usable. A deadlock or lock-wait
// timeout (knet_tx_retryable) has already rolled the WHOLE transaction back,
// row lock included, so it is thrown: the settlement must not go on without its
// lock, and knet_settle_order runs it again from the top.
function knet_alert_duplicate_capture(
    PDO $pdo, array $cfg, int $orderId, string $extraPayId, ?string $orderPayId,
    ?string $amount, array $fields, string $trackid, string $source
): string {
    $clip = static fn ($v, int $n): ?string => ($v = substr(trim((string) $v), 0, $n)) === '' ? null : $v;
    $fils = $amount === null ? null : knet_amount_fils($amount);
    $pdo->exec('savepoint knet_dup_alert');
    try {
        $st = $pdo->prepare(
            // A plain INSERT. Not INSERT IGNORE, which would also turn a CHECK or
            // foreign-key refusal into a warning; not ON DUPLICATE KEY UPDATE,
            // which needs an UPDATE grant the KNET account has no other use for.
            // The unique key (this Payment ID already kept for this order) is
            // answered 1062 below: the same second capture notified again.
            "insert into payment_alerts
                (order_id, kind, gateway, payment_id, order_payment_id, amount,
                 transaction_id, reference, attempt_ref, source)
             values (?, 'duplicate_capture', 'knet', ?, ?, ?, ?, ?, ?, ?)"
        );
        $st->execute([
            $orderId, substr($extraPayId, 0, 60), $orderPayId === null ? null : substr($orderPayId, 0, 60),
            $fils === null || $fils <= 0 ? null : knet_format_fils($fils),
            $clip($fields['tranid'] ?? '', 60), $clip($fields['ref'] ?? '', 60),
            $clip($fields['trackid'] ?? $trackid, 40), $source === 'inquiry' ? 'inquiry' : 'callback',
        ]);
        $pdo->exec('release savepoint knet_dup_alert');
        return 'saved';
    } catch (PDOException $e) {
        if (knet_tx_retryable($e)) throw $e;
        $pdo->exec('rollback to savepoint knet_dup_alert');
        if ((int) ($e->errorInfo[1] ?? 0) === 1062) return 'already_known';
        knet_log($cfg, 'callback.duplicate_capture_not_saved', [
            'trackid' => $trackid, 'payid' => $extraPayId, 'error' => (string) ($e->errorInfo[1] ?? $e->getCode()),
        ]);
        return 'not_saved';
    }
}

// ========================================================= inquiry (OFF by default)
//
// KNET-IPAYPIPE-CHECK.md D2. A shopper who pays and closes the tab before the
// bank's page sends them back leaves a CAPTURED payment and a PENDING order, and
// two hours later the stock sweeper gave the order's garments away with nobody
// told: the money was taken, the order unrecorded. Nothing asked the bank.
//
// This is that question, modelled on the plug-in's only server-to-server call
// (iPayPipe.performTransaction, iPayPipe.java:277-314; buildXMLRequest :347-573;
// parseResult :575-742; iPayTransactionPipe.java:13-17, 46-48): a plain XML
// <request> POSTed as application/xml to <webaddress>/tranPipe.htm?param=tranInit,
// carrying the Tranportal id and password in the XML (not in trandata), and a
// flat XML answer read tag by tag. cron-stock.php calls knet_inquire_order BEFORE
// it releases a pending KNET order, for every reference the order was sent to the
// bank under (attempt 1..pay_attempt). A CAPTURED answer goes through
// knet_settle_order, the callback's own function: paid when the amount matches,
// held for review otherwise, a no-op if the order is already settled. Every other
// answer, and no answer, leaves the sweeper doing exactly what it did before.
//
// OFF unless the KNET config says 'inquiry_enabled' => true, and even then it
// refuses to run until 'inquiry_action' names the action code KNET gives for an
// inquiry. There is no default: the plug-in has no inquiry constant (setAction,
// iPayPipe.java:1130), and a guessed number could be a refund. The questions for
// KNET (the action code, which field names the transaction, the response fields,
// whether 187.7.78.123 must be whitelisted) are in KNET.md.

const KNET_INQUIRY_TIMEOUT = 10;          // seconds for one inquiry, connect included
const KNET_INQUIRY_CONNECT_TIMEOUT = 5;
const KNET_INQUIRY_MAX_BODY = 65536;      // the answer is a few hundred bytes
// Action numbers that MOVE money in the Tranportal numbering this plug-in family
// uses (1 purchase, 2 credit, 3 void purchase, 4 authorization, 5 capture,
// 6 void credit, 7 void capture, 9 void authorization). An inquiry that is one
// of these by a typing slip would refund, void or charge every pending order the
// sweeper looks at, so they are refused whatever the config says. This guards
// against a slip; it is not a guess at the inquiry code, which stays unset until
// KNET names it.
const KNET_INQUIRY_FORBIDDEN_ACTIONS = ['1', '2', '3', '4', '5', '6', '7', '9'];

// A config read for a job that has no shopper to answer: null when there is no
// readable KNET config, never an exit() (knet_load_config answers a browser).
function knet_load_config_quiet(string $legacyPath): ?array
{
    $path = knet_config_path('knet', $legacyPath);
    if (!is_file($path) || !is_readable($path)) return null;
    $cfg = require $path;
    return is_array($cfg) ? $cfg : null;
}

// Why the inquiry may not run with this config, or null when it may. Checked
// once per sweeper run and again before every request.
function knet_inquiry_config_problem(array $cfg): ?string
{
    if (($cfg['inquiry_enabled'] ?? false) !== true) return 'inquiry_disabled';
    $action = $cfg['inquiry_action'] ?? null;
    if ($action === null || $action === '') return 'inquiry_action_not_set';
    if (!is_string($action) && !is_int($action)) return 'inquiry_action_invalid';
    $action = (string) $action;
    if (!preg_match('/^[1-9][0-9]?$/D', $action)) return 'inquiry_action_invalid';
    if (in_array($action, KNET_INQUIRY_FORBIDDEN_ACTIONS, true)) return 'inquiry_action_moves_money';
    $transid = $cfg['inquiry_transid'] ?? '';
    if (!in_array($transid, ['', 'trackid'], true)) return 'inquiry_transid_invalid';
    $udf5 = $cfg['inquiry_udf5'] ?? '';
    if (!is_string($udf5) || !preg_match('/^[A-Za-z]{0,20}$/D', $udf5)) return 'inquiry_udf5_invalid';
    if (!function_exists('curl_init')) return 'curl_missing';
    return null;
}

// <webaddress>/tranPipe.htm?param=tranInit, where <webaddress> is the gateway
// URL without its last segment (the plug-in appends "/PaymentHTTP.htm" to the
// same base for the hosted page, iPayPipe.java:150). The gateway URL has already
// passed knet_assert_payment_config, so for a real bank this is exactly
// https://[www.]kpay[test].com.kw/kpg/tranPipe.htm?param=tranInit.
function knet_tranpipe_url(array $cfg): string
{
    $p = parse_url(knet_gateway_url($cfg));
    $path = preg_replace('#/[^/]*$#', '/tranPipe.htm', (string) ($p['path'] ?? '/'));
    return $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . (int) $p['port'] : '') . $path . '?param=tranInit';
}

// The plug-in's response reader (iPayPipe.parseResponse, :1056-1100): flat
// <tag>value</tag> pairs read one after another, no nesting, no entity decoding.
// null for anything that is not that shape (an "!ERROR!" text line, HTML).
/** @return array<string,string>|null */
function knet_parse_flat_xml(string $body): ?array
{
    $body = trim($body);
    if ($body === '' || $body[0] !== '<') return null;
    // A wrapper element (<response>...</response>) is read the way the plug-in
    // reads it: as ONE pair whose value is everything inside. There is then no
    // top-level <result>, so it is never a capture — fail safe, not a guess.
    $out = [];
    while ($body !== '') {
        if (!preg_match('#^<([A-Za-z][A-Za-z0-9_]{0,40})>(.*?)</\1>\s*#s', $body, $m)) {
            return $out === [] ? null : $out;
        }
        $out[$m[1]] = $m[2];
        $body = (string) substr($body, strlen($m[0]));
    }
    return $out;
}

// One inquiry: what does the bank say about reference $ref?
// Returns ['state' => ..., 'reason' => ..., 'result' => ..., 'fields' => ...]:
//   captured     the bank answered CAPTURED for exactly this reference
//   other        the bank answered, and it is not a capture of this reference
//   unreachable  no usable answer (transport error, time-out, HTTP 5xx)
//   refused      not asked: the config cannot be used (no order can be asked)
//   skipped      not asked: this order's reference or amount cannot be sent
// Nothing secret is logged: the request line names the reference, the action
// and the amount; the response is logged with the id and password removed.
function knet_inquire(array $cfg, string $orderTrack, string $ref, string $amount): array
{
    $problem = knet_inquiry_config_problem($cfg);
    if ($problem !== null) return ['state' => 'refused', 'reason' => $problem];
    try {
        knet_assert_payment_config($cfg);
    } catch (Throwable $e) {
        return ['state' => 'refused', 'reason' => 'payment_config: ' . $e->getMessage()];
    }
    // This ORDER cannot be asked about (the next one may be): skipped.
    if (!preg_match('/^[A-Za-z0-9]{1,30}$/D', $ref)) return ['state' => 'skipped', 'reason' => 'invalid_reference'];
    $fils = knet_amount_fils($amount);
    if ($fils === null || $fils <= 0) return ['state' => 'skipped', 'reason' => 'invalid_order_amount'];
    $amt = knet_format_fils($fils);

    // The plug-in writes these into the XML unescaped. The trandata rules hold,
    // and '<' / '>' would end the element early.
    $secret = [
        'id' => (string) $cfg['tranportal_id'], 'password' => (string) $cfg['tranportal_password'],
        'errorURL' => (string) $cfg['error_url'], 'responseURL' => (string) $cfg['response_url'],
    ];
    foreach ($secret as $k => $v) {
        if (knet_raw_value_problem($v) !== null || strpbrk($v, '<>') !== false) {
            return ['state' => 'refused', 'reason' => 'unsafe_value_' . $k];
        }
    }
    $action = (string) $cfg['inquiry_action'];
    $udf5 = (string) ($cfg['inquiry_udf5'] ?? '');

    // buildXMLRequest's order. Its <currency> element is NOT copied: the plug-in
    // fills it with the AMOUNT (iPayPipe.java:358-360, a bug); <currencycode>
    // carries the currency.
    $xml = '<request>'
        . (($cfg['inquiry_transid'] ?? '') === 'trackid' ? '<transid>' . $ref . '</transid>' : '')
        . '<amt>' . $amt . '</amt>'
        . '<action>' . $action . '</action>'
        . '<trackid>' . $ref . '</trackid>'
        . ($udf5 !== '' ? '<udf5>' . $udf5 . '</udf5>' : '')
        . '<currencycode>414</currencycode>'
        . '<id>' . $secret['id'] . '</id>'
        . '<password>' . $secret['password'] . '</password>'
        . '<errorURL>' . $secret['errorURL'] . '</errorURL>'
        . '<responseURL>' . $secret['responseURL'] . '</responseURL>'
        . '</request>';

    $url = knet_tranpipe_url($cfg);
    $https = str_starts_with($url, 'https://');
    knet_log($cfg, 'inquiry.request', [
        'trackid' => $orderTrack, 'ref' => $ref, 'action' => $action, 'amt' => $amt,
        'transid' => ($cfg['inquiry_transid'] ?? '') === 'trackid' ? $ref : '', 'udf5' => $udf5,
        'gateway' => $url,
    ]);

    $ch = curl_init($url);
    $opts = [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $xml,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/xml'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => KNET_INQUIRY_CONNECT_TIMEOUT,
        CURLOPT_TIMEOUT        => KNET_INQUIRY_TIMEOUT,
        // The answer comes from the host named above or not at all.
        CURLOPT_FOLLOWLOCATION => false,
        // The request carries the Tranportal id and password. Certificate and
        // host checks are ON, written out so that removing them is a visible
        // deletion (cbk_http, php-cbk/cbk.php, explains why this is worth it).
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_MAXFILESIZE    => KNET_INQUIRY_MAX_BODY,
    ];
    if (defined('CURLOPT_PROTOCOLS_STR')) $opts[CURLOPT_PROTOCOLS_STR] = $https ? 'https' : 'http';
    else $opts[CURLOPT_PROTOCOLS] = $https ? CURLPROTO_HTTPS : CURLPROTO_HTTP;
    if ($https) $opts[CURLOPT_SSLVERSION] = CURL_SSLVERSION_TLSv1_2;   // the plug-in pins TLSv1.2 (iPayTransactionPipe.java:37)
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $errno !== 0 || $http >= 500 || $http === 0) {
        knet_log($cfg, 'inquiry.unreachable', ['trackid' => $orderTrack, 'ref' => $ref, 'http' => $http, 'curl' => $errno]);
        return ['state' => 'unreachable', 'reason' => $errno !== 0 ? 'curl_' . $errno : 'http_' . $http];
    }
    $body = substr((string) $body, 0, KNET_INQUIRY_MAX_BODY);
    // Whatever the bank echoes, the log never holds the credentials.
    $logged = preg_replace('#<(id|password)>.*?</\1>#s', '<$1>[removed]</$1>', $body) ?? '';
    if ($secret['password'] !== '') $logged = str_replace($secret['password'], '[removed]', $logged);

    $map = knet_parse_flat_xml($body);
    $fields = [];
    foreach (['result', 'amt', 'trackid', 'tranid', 'ref', 'auth', 'postdate', 'udf5', 'avr',
              'authRespCode', 'error_code_tag', 'error_service_tag', 'error_text'] as $k) {
        if (isset($map[$k])) $fields[$k] = trim($map[$k]);
    }
    // payid, then paymentid if present: the plug-in's own precedence (:587, :719).
    $fields['paymentid'] = trim((string) ($map['paymentid'] ?? ($map['payid'] ?? '')));
    if ($secret['password'] !== '') {
        foreach ($fields as $k => $v) $fields[$k] = str_replace($secret['password'], '[removed]', $v);
    }
    $result = strtoupper((string) ($fields['result'] ?? ''));
    knet_log($cfg, 'inquiry.response', [
        'trackid' => $orderTrack, 'ref' => $ref, 'http' => $http, 'result' => $result,
        'fields' => $fields, 'raw' => substr($logged, 0, 4096),
    ]);

    if ($http !== 200) return ['state' => 'other', 'reason' => 'http_' . $http, 'result' => $result];
    if ($map === null) return ['state' => 'other', 'reason' => 'unparseable_response', 'result' => ''];
    if ($result !== 'CAPTURED') return ['state' => 'other', 'reason' => 'not_captured', 'result' => $result, 'fields' => $fields];
    // A capture of SOME OTHER reference is not this order's money. An answer
    // that echoes NO reference cannot be tied to this one either (review: a
    // CAPTURED with no trackid used to be accepted as this reference's), so it
    // is 'other' too: the order is then handled as if the bank had said nothing.
    $echoed = (string) ($fields['trackid'] ?? '');
    if ($echoed === '') {
        return ['state' => 'other', 'reason' => 'trackid_missing', 'result' => $result];
    }
    if (!hash_equals($ref, $echoed)) {
        return ['state' => 'other', 'reason' => 'trackid_mismatch', 'result' => $result];
    }
    $fields['result'] = 'CAPTURED';
    return ['state' => 'captured', 'reason' => 'captured', 'result' => $result, 'fields' => $fields];
}

// Ask about every reference order $trackid was sent to the bank under (attempt 1
// to $attempts, knet_attempt_ref_for) and settle it on the first CAPTURED, with
// the callback's own knet_settle_order. Returns ['state' => ..., ...]:
//   paid | review | failed   knet_settle_order's answer to a CAPTURED inquiry
//   not_captured             every reference was answered, none CAPTURED
//   unreachable              the bank did not answer (the caller stops asking)
//   refused                  the config cannot be used (the caller stops asking)
//   skipped                  this order cannot be asked about (released as before)
function knet_inquire_order(array $cfg, string $trackid, int $attempts, string $amount): array
{
    if (!knet_db_configured($cfg)) return ['state' => 'refused', 'reason' => 'orders_database_not_configured', 'checked' => 0];
    $attempts = min(max(0, $attempts), KNET_MAX_ATTEMPTS);
    $checked = 0;
    for ($n = 1; $n <= $attempts; $n++) {
        $ref = knet_attempt_ref_for($trackid, $n);
        $r = knet_inquire($cfg, $trackid, $ref, $amount);
        $checked++;
        if ($r['state'] === 'refused' || $r['state'] === 'unreachable' || $r['state'] === 'skipped') {
            return ['state' => $r['state'], 'reason' => $r['reason'], 'checked' => $checked];
        }
        if ($r['state'] !== 'captured') continue;
        $fields = $r['fields'];
        // WHOSE PAYMENT IS IT? Resolved exactly as the callback resolves one
        // (knet_resolve_track: the bank-signed udf5 first, RACE K1-6). Track ids
        // are chosen by the browser, so the reference asked about here (order
        // X's attempt 1, i.e. X itself) can be the SAME string as another
        // order's retry reference (order Y = "<X minus A2>", attempt 2): the
        // bank then answers CAPTURED for Y's payment, and settling X with it
        // would mark two orders paid for one payment (review 1, finding 1).
        // Only an answer that resolves back to THIS order settles it.
        $owner = knet_resolve_track($cfg, (string) $fields['trackid'], trim((string) ($fields['udf5'] ?? '')));
        if (!hash_equals($trackid, $owner)) {
            knet_log($cfg, 'inquiry.not_this_order', [
                'trackid' => $trackid, 'ref' => $ref, 'resolves_to' => $owner,
                'payid' => (string) ($fields['paymentid'] ?? ''),
            ]);
            continue;
        }
        $settled = knet_settle_order($cfg, $trackid, true, 'CAPTURED', (string) ($fields['amt'] ?? ''), $fields, 'inquiry');
        knet_log($cfg, 'inquiry.settled', [
            'trackid' => $trackid, 'ref' => $ref, 'state' => $settled['state'], 'reason' => $settled['reason'],
            'payid' => (string) ($fields['paymentid'] ?? ''), 'amt' => (string) ($fields['amt'] ?? ''),
        ]);
        return ['state' => $settled['state'], 'reason' => $settled['reason'], 'ref' => $ref, 'checked' => $checked];
    }
    return ['state' => 'not_captured', 'reason' => $checked === 0 ? 'never_sent_to_bank' : 'no_capture', 'checked' => $checked];
}

// ============================================================ the result page (K-063 D1/D5)
//
// What the redirect to the shop's result page carries besides the outcome, for
// an order that exists: 'lang', the language saved on the order at checkout
// (the shopper comes back from KNET in the language they bought in, not the
// one their browser happens to prefer), and, when $paidWith names the Payment
// ID of the decrypted trandata, 'k': the order's RECEIPT key (payrec_receipt_key in
// php-store/payment-records.php; 7 days, keyed on the store's cron_key). The
// result page sends k back to api.php ?r=status, which then returns the bank's
// fields (Payment ID, Transaction ID, reference, auth code, paid time) from the
// order row: the receipt KNET's certification asks for.
//
// THE KEY ONLY SHOWS ITS HOLDER WHAT THEY ALREADY HOLD (review 2, defect 1).
// The trandata leg is authenticated by the resource key, but anyone can START
// it for any pending order (pay.php needs only the track id) and cancel at the
// bank: the old invoice key on this redirect opened that stranger's full
// invoice (name, street address). Now:
//   * the key is the narrow RECEIPT key, never the invoice key: it opens the
//     bank fields of ?r=status (result, amount, Payment ID, Transaction ID,
//     reference, auth code, paid time) and nothing else; ?r=invoice refuses it;
//   * it is added only when the order row now RECORDS exactly this trandata's
//     Payment ID (the callback just wrote it: the payment that paid it, or the
//     decline / cancel that failed it), so those fields are the holder's own
//     bank session's. A second capture, a late answer on a paid order, a
//     review that kept another payment's fields: no key.
// The errorURL leg (a plain address anyone can open) passes null.
//
// Nothing here may stop a shopper going home: every failure is "add nothing".
function knet_result_extras(array $cfg, string $trackid, ?string $paidWith = null): array
{
    if (!preg_match('/^[A-Za-z0-9]{1,30}$/D', $trackid) || !knet_db_configured($cfg)) return [];
    try {
        $q = knet_pdo($cfg)->prepare('select customer_lang, payment_method, cbk_paymentid from orders where track_id = ?');
        $q->execute([$trackid]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return [];
    }
    if (!$row) return [];
    $out = ['lang' => ($row['customer_lang'] ?? '') === 'en' ? 'en' : 'ar'];
    $paidWith = trim((string) $paidWith);
    if ($paidWith !== '' && (string) $row['payment_method'] === 'knet'
        && hash_equals(trim((string) ($row['cbk_paymentid'] ?? '')), $paidWith)) {
        $key = knet_receipt_key($trackid);
        if ($key !== null) $out['k'] = $key;
    }
    return $out;
}

// The store's RECEIPT key for $trackid, or null. The store library is the one
// implementation (payrec_receipt_key, payment-records.php); it is loaded only
// when the store's config file exists, because store_config() answers a missing
// one with a JSON error and exit, which here would replace the one-line
// REDIRECT= reply KNET reads (and an unreadable reply may make KNET void the
// payment).
function knet_receipt_key(string $trackid): ?string
{
    try {
        $lib = dirname(__DIR__) . '/api/store.php';
        if (!is_file($lib)) $lib = dirname(__DIR__) . '/php-store/store.php';
        if (!is_file($lib)) return null;
        $rec = dirname($lib) . '/payment-records.php';
        if (!is_file($rec)) return null;
        require_once $lib;
        if (!function_exists('sporta_config_path')) return null;
        $path = sporta_config_path('api', dirname($lib) . '/config.php');
        if (!is_file($path) || !is_readable($path)) return null;
        require_once $rec;
        if (!function_exists('payrec_receipt_key')) return null;
        $key = payrec_receipt_key($trackid);
        return is_string($key) && $key !== '' ? $key : null;
    } catch (Throwable $e) {
        return null;
    }
}
