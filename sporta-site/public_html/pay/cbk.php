<?php
// CBK Hosted KNET & T-Pay — REST-JSON helper library.
// Implements the auth-token, checkout URL, and transaction-verify calls from
// the CBK Integration & Reference Manual v2.93.

declare(strict_types=1);

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

function cbk_base(array $cfg): string
{
    return rtrim($cfg['env'] === 'production' ? $cfg['production_base'] : $cfg['test_base'], '/');
}

// Is there an orders database at all? Without one there is no price authority:
// nothing to charge and nothing to settle. The same question the KNET dropin
// asks, with the same answer, so the two gateways cannot drift.
function cbk_db_configured(array $cfg): bool
{
    return ($cfg['mysql_name'] ?? '') !== '' && ($cfg['mysql_user'] ?? '') !== '';
}

// Load pay/config.php, INHERITING the orders database from api/config.php when
// this file does not name one of its own.
//
// The exact mirror of knet_config(), and mirrored on purpose: T-Pay had NO
// coverage while KNET had 39, and the price-authority hole that turned up on
// the first run of test:tpay existed only because a rule applied to one gateway
// had not been applied to the other. The same four mysql_* values were
// duplicated here too, with the same failure — a MySQL password rotated in
// hPanel kills this path from a file nobody thought to open.
//
// Fail-closed is unchanged: with neither file naming a database
// cbk_db_configured() is false exactly as before. See knet_config() for the
// full reasoning; it is not repeated here so the two cannot drift.
function cbk_config(): array
{
    $cfg = require __DIR__ . '/config.php';
    if (!is_array($cfg)) return [];
    if (cbk_db_configured($cfg)) return $cfg;

    $api = __DIR__ . '/../api/config.php';
    if (!is_file($api)) return $cfg;
    $store = @require $api;
    if (!is_array($store)) return $cfg;

    foreach (['host', 'name', 'user', 'pass'] as $k) {
        if (($cfg['mysql_' . $k] ?? '') === '' && ($store['db_' . $k] ?? '') !== '') {
            $cfg['mysql_' . $k] = $store['db_' . $k];
        }
    }
    return $cfg;
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
// The shop sent orders.track_id, which is unique per ORDER — so a shopper
// retrying a declined card sent the same value twice and the gateway is
// entitled to refuse it with TIJ0004, making a failed payment unretryable.
//
// THE FIRST ATTEMPT SENDS THE TRACK ID UNCHANGED, so the common case is exactly
// as it was and a bank statement still carries the order number. Only a retry —
// which could not work at all before — carries a suffix.
function cbk_attempt_ref(array $cfg, string $trackid): string
{
    if (!cbk_db_configured($cfg)) return $trackid;
    try {
        $pdo = cbk_pdo($cfg);
        $pdo->prepare('update orders set pay_attempt = pay_attempt + 1 where track_id = ?')
            ->execute([$trackid]);
        $q = $pdo->prepare('select pay_attempt from orders where track_id = ?');
        $q->execute([$trackid]);
        $n = (int) $q->fetchColumn();
    } catch (Throwable $e) {
        // The counter is a convenience; the sale is not. A customer must never
        // be stopped at the payment page because a column is missing.
        return $trackid;
    }
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
function cbk_resolve_track(array $cfg, string $ref): string
{
    if ($ref === '' || !cbk_db_configured($cfg)) return $ref;
    try {
        $q = cbk_pdo($cfg)->prepare('select 1 from orders where track_id = ?');
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

function cbk_order_lookup(array $cfg, string $trackid): array
{
    try {
        $q = cbk_pdo($cfg)->prepare('select amount, payment_status from orders where track_id = ?');
        $q->execute([$trackid]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return ['amount' => null, 'status' => null];
    }
    return $row
        ? ['amount' => (string) $row['amount'], 'status' => (string) $row['payment_status']]
        : ['amount' => null, 'status' => null];
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
        // Refresh a little early (100 min) to stay well within the 2h window.
        if (isset($cached['token'], $cached['ts']) && (time() - $cached['ts']) < 100 * 60) {
            return (string) $cached['token'];
        }
    }

    $url = cbk_base($cfg) . '/ePay/api/cbk/online/pg/merchant/Authenticate';
    [$status, $res] = cbk_http('POST', $url, $cfg, [
        'ClientId'     => $cfg['client_id'],
        'ClientSecret' => $cfg['client_secret'],
        'ENCRP_KEY'    => $cfg['encrp_key'],
    ]);

    if ($status !== 200 || !is_array($res) || ($res['Status'] ?? '') !== '1' || empty($res['AccessToken'])) {
        $msg = is_array($res) ? ($res['Message'] ?? 'unknown') : 'no response';
        throw new RuntimeException('CBK auth failed (' . $status . '): ' . $msg);
    }

    $token = (string) $res['AccessToken'];
    @file_put_contents($file, json_encode(['token' => $token, 'ts' => time()]));
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
