<?php
// Classic KNET (KPG) direct integration — crypto + helpers (native PHP).
//
// KNET encrypts "trandata" with AES-128-CBC, key = Terminal Resource Key,
// fixed IV "PGKEYENCDECIVSPC", PKCS7 padding, hex-encoded (uppercase).
// Gateway: kpaytest.com.kw (test) / kpay.com.kw (production), /kpg/PaymentHTTP.htm
// Result "CAPTURED" (or "APPROVED") = success.

declare(strict_types=1);

const KNET_IV = 'PGKEYENCDECIVSPC'; // 16 bytes, fixed by KNET

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

// Stop, say so, and say NOTHING else — the exact mirror of cbk_fail_closed().
//
// THIS DID NOT EXIST, and its absence is the fault it fixes. pay/cbk.php has
// had it since the day a missing config.php answered 500 with "Failed opening
// required '/home/.../pay/config.php'" in the body — the server's absolute
// path on a public page. The KNET dropin, the older of the two, was never
// given the same treatment: knet_config() returned an empty array and let
// execution walk on into whatever happened next.
//
// What happened next, measured: seven "Undefined array key" warnings and then
//
//   Fatal error: knet_gateway_url(): Return value must be of type string,
//   null returned
//
// which is a blank 500 for a shopper standing at the payment step, with the
// reason in a log file on a host that has no shell.
function knet_fail_closed(string $message): never
{
    error_log('knet: ' . $message . ' (expected ' . __DIR__ . '/config.php)');
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    exit($message);
}

// Load knet/config.php, INHERITING the orders database from api/config.php
// when this file does not name one of its own.
//
// WHY THIS EXISTS, and why it is a fix rather than a convenience.
//
// The four mysql_* values here have to name the SAME database as the four db_*
// values in api/config.php. That is one database, typed twice, in two files,
// under two spellings — and it is the single documented way to have a shop that
// looks perfect and refuses every card: without a reachable orders database
// pay.php has no price authority, so it fails closed with 400 Invalid amount.
//
// Everything built around that so far GUARDS the duplication instead of
// removing it: preflight.php checks the block by name, checks it connects, and
// checks host+name equal api/config.php's; CHECKOUT-SECRETS.md maps it;
// knet-test.mjs proves the code path. All of it still leaves an owner in File
// Manager copying four values by hand, and leaves a MySQL password rotation
// — one field, changed in hPanel — silently killing the card path from a file
// nobody thought to open.
//
// So the block becomes OPTIONAL. api/config.php is the one place the database
// is named; this file names credentials and URLs, which are genuinely its own.
// An explicit mysql_* here still wins, because a shop that deliberately points
// the gateway at a replica must be able to say so.
//
// FAIL-CLOSED IS UNCHANGED. If neither file names a database,
// knet_db_configured() is false exactly as before and pay.php refuses rather
// than trusting the browser's amount. Inheritance can only ever turn a dead
// card path into a working one; it can never invent price authority.
//
// The api path is not configurable on purpose: it is a sibling directory in a
// layout this project fixes (SERVER-LAYOUT.md), and a settable path would be a
// way to point the gateway's database lookup at a file of someone else's
// choosing.
function knet_config(): array
{
    // A MISSING config.php IS A CONFIGURATION FAULT, NOT A CRASH. `require` on
    // a file that is not there is fatal, and this file is deliberately never
    // committed and never in a package — so a deploy that copies the repo and
    // forgets that one step lands exactly here, on the payment page.
    $file = __DIR__ . '/config.php';
    if (!is_file($file)) {
        knet_fail_closed('Payment is not configured on this server.');
    }
    $cfg = require $file;
    if (!is_array($cfg)) {
        knet_fail_closed('Payment configuration is unreadable.');
    }
    if (knet_db_configured($cfg)) return $cfg;

    $api = __DIR__ . '/../api/config.php';
    if (!is_file($api)) return $cfg;
    $store = @require $api;
    if (!is_array($store)) return $cfg;

    // Only the four, and only where this file is silent. Nothing else crosses:
    // api/config.php holds the admin session settings and the cron key, and
    // none of that is the gateway's business.
    foreach (['host', 'name', 'user', 'pass'] as $k) {
        if (($cfg['mysql_' . $k] ?? '') === '' && ($store['db_' . $k] ?? '') !== '') {
            $cfg['mysql_' . $k] = $store['db_' . $k];
        }
    }
    return $cfg;
}

// ---------------------------------------------------------------------------
// WHICH KNET THIS SHOP ACTUALLY HAS.
//
// There are two ways to take a KNET payment and this shop is nominated for the
// second one. The whole of the rest of this file implements the first.
//
//   LEGACY TRANPORTAL (this file). The shop holds a Tranportal ID, a Tranportal
//     password and a 16-byte Terminal Resource Key, builds an AES-128-CBC
//     `trandata` blob and posts the shopper to kpay.com.kw/kpg. It is a real
//     integration and plenty of Kuwaiti shops run on it.
//
//   THE OFFICIAL CBK HOSTED PAGE (pay/cbk.php). The shop holds a client_id, a
//     client_secret and an encrp_key from CBK's activation email, fetches an
//     AccessToken and posts the shopper to pg.cbk.com. `tij_MerchPayType` picks
//     the face of that page: '1' is KNET, '2' is T-Pay QR, '' lets the customer
//     choose. Both halves are the SAME gateway, the same merchant account and
//     the same manual — pay/cbk.php's own first line calls itself "CBK Hosted
//     KNET & T-Pay", and pay/config.example.php spells the values out:
//     "'1' = KNET only, '2' = T-Pay QR only".
//
// SO KNET WAS NEVER MISSING. It has been sitting behind pay/, one parameter
// away, while this directory waited on credentials nobody was ever going to
// issue — and the evidence that they were never issued is written in
// config.example.php in this directory, three times over: which of the two
// numbers on the nomination letter is the Tranportal ID is "an inference";
// whether KNET wants 'EN' or 'USA' for English is "not settled"; which of the
// two callback styles the bank uses is "the bank's choice". Three open
// questions to a bank, and every one of them evaporates on the official path,
// because the official path was activated, documented and is already taking
// T-Pay money through the same credentials.
//
// THE DEFAULT CAN ONLY EVER TURN A DEAD PATH INTO A LIVE ONE — the same
// direction knet_config()'s database inheritance takes, and for the same
// reason. Legacy is preferred WHENEVER IT COULD ACTUALLY WORK, so a shop that
// really does hold Tranportal credentials is untouched by this and keeps the
// integration it has been running. Only a shop whose legacy block is empty,
// still holding the example's placeholders, or carrying a key that AES-128
// cannot use — which is to say, a shop where KNET could not have worked at all
// — is routed to the gateway that its credentials do open.
//
// Set 'mode' => 'legacy' or 'official' in config.php to stop deciding and pin
// it, which is what to do the day the bank answers.
const KNET_PLACEHOLDERS = [
    'YOUR_TRANPORTAL_ID', 'YOUR_TRANPORTAL_PASSWORD', 'YOUR_TERMINAL_RESOURCE_KEY',
];

// "Configured" means COULD TAKE A PAYMENT, not "the key exists in the array".
//
// The 16-byte test is part of the question rather than a detail: AES-128 needs
// exactly 16, knet_assert_key() throws on anything else, and a resource key of
// the wrong length is a legacy path that answers every single shopper with
// "Payment init failed". Treating that as "configured" would pin a shop to a
// dropin that cannot complete one transaction — which is the precise failure
// this whole function exists to route around.
function knet_legacy_configured(array $cfg): bool
{
    foreach (['tranportal_id', 'tranportal_password', 'resource_key'] as $k) {
        $v = (string) ($cfg[$k] ?? '');
        if ($v === '' || in_array($v, KNET_PLACEHOLDERS, true)) return false;
    }
    return strlen((string) $cfg['resource_key']) === 16;
}

// 'legacy' or 'official'. An explicit config value wins; otherwise see above.
function knet_mode(array $cfg): string
{
    $pinned = strtolower(trim((string) ($cfg['mode'] ?? '')));
    if ($pinned === 'legacy' || $pinned === 'official') return $pinned;
    return knet_legacy_configured($cfg) ? 'legacy' : 'official';
}

function knet_gateway_url(array $cfg): string
{
    // NAMED, AND CHECKED. This read the key straight out of the array under a
    // `: string` return type, so a config missing production_url or test_url —
    // one typo, or a config.php written before those keys were named — returned
    // null and PHP raised an uncatchable TypeError. A blank 500, at the payment
    // step, for a missing line in a file.
    //
    // 'test' is the only value that selects the test gateway. Anything else,
    // including nothing at all, is treated as live — the same fail-safe
    // direction knet/selftest.php already takes, and for the same reason: the
    // shipped default is 'test', so the dangerous case is not a typo but a
    // config nobody finished.
    $key = (string) ($cfg['env'] ?? '') === 'test' ? 'test_url' : 'production_url';
    $url = (string) ($cfg[$key] ?? '');
    if ($url === '') {
        knet_fail_closed('Payment is not configured on this server.');
    }
    return $url;
}

// AES-128 needs a 16-byte key. PHP would otherwise pad/truncate silently and
// KNET would reject the trandata with no explanation.
function knet_assert_key(string $resourceKey): void
{
    if (strlen($resourceKey) !== 16) {
        throw new RuntimeException('resource_key must be exactly 16 bytes for AES-128 (got ' . strlen($resourceKey) . ')');
    }
}

function knet_encrypt(string $plain, string $resourceKey): string
{
    knet_assert_key($resourceKey);
    $enc = openssl_encrypt($plain, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, KNET_IV);
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
    $dec = openssl_decrypt($raw, 'AES-128-CBC', $resourceKey, OPENSSL_RAW_DATA, KNET_IV);
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

// ---------------------------------------------------------------------------
// Abuse control for the two public payment endpoints. THE EXACT MIRROR of
// cbk_over_limit() — see that function for the full reasoning, which is not
// repeated here so the two cannot drift; scripts/payments-test.mjs asserts the
// bodies are identical.
//
// The KNET side's own version of the problem: knet/pay.php increments
// orders.pay_attempt on every hit, and knet/callback.php decrypts on every
// hit. The callback's throttle is applied ONLY to requests that fail to
// decrypt, because a trandata that decrypts under the resource key is proof
// the bank sent it, and throttling the bank is how a captured payment goes
// unrecorded.
//
// Fails open, always: a missing table or a database blink returns false and
// the payment proceeds exactly as it does today.
function knet_over_limit(array $cfg, string $bucket, int $max, int $windowSec): bool
{
    if (!knet_db_configured($cfg)) return false;
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if ($ip === '') return false;
    try {
        $pdo = knet_pdo($cfg);
        $key = substr(hash('sha256', $bucket . '|' . $ip), 0, 32);
        $now = time();
        $windowStart = $now - ($now % $windowSec);
        $pdo->prepare(
            'insert into rate_limit (bucket_key, window_start, hits) values (?, ?, 1)
             on duplicate key update hits = hits + 1'
        )->execute([$key, $windowStart]);
        $q = $pdo->prepare('select hits from rate_limit where bucket_key = ? and window_start = ?');
        $q->execute([$key, $windowStart]);
        $over = (int) $q->fetchColumn() > $max;
        if ($over) knet_log($cfg, 'throttled', ['bucket' => $bucket]);
        // Opportunistic sweep, scoped to this bucket so a short window cannot
        // delete a long one's live rows — the trap store_throttle() documents.
        if (random_int(1, 50) === 1) {
            $pdo->prepare('delete from rate_limit where bucket_key = ? and window_start < ?')
                ->execute([$key, $windowStart - (4 * $windowSec)]);
        }
        return $over;
    } catch (Throwable $e) {
        return false;
    }
}

// Look an order up by track id.
//
// Returns ['state' => ..., 'amount' => ?string, 'status' => ?string] where state is:
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
// track id is unique per ORDER, so a shopper retrying a declined card sent the
// same id twice and the gateway was entitled to refuse it — which made a
// failed payment unretryable for a reason that had nothing to do with the card.
//
// THE FIRST ATTEMPT SENDS THE TRACK ID UNCHANGED. That keeps the common case
// exactly as it was — the bank statement still carries the order number — and
// means this can be deployed while payments are in flight. Only a retry, which
// could not work at all before, carries a suffix.
function knet_attempt_ref(array $cfg, string $trackid): string
{
    // No orders database: nothing to count, and nothing to reconcile against.
    if (!knet_db_configured($cfg)) return $trackid;
    try {
        $pdo = knet_pdo($cfg);
        $pdo->prepare('update orders set pay_attempt = pay_attempt + 1 where track_id = ?')
            ->execute([$trackid]);
        $q = $pdo->prepare('select pay_attempt from orders where track_id = ?');
        $q->execute([$trackid]);
        $n = (int) $q->fetchColumn();
    } catch (Throwable $e) {
        // THE COUNTER IS A CONVENIENCE; THE SALE IS NOT. If it cannot be
        // incremented, send what we always sent and let the bank decide. A
        // customer must never be stopped at the payment page because a column
        // is missing.
        return $trackid;
    }
    if ($n <= 1) return $trackid;
    $suffix = 'A' . $n;
    // KNET's trackid field is limited; trim the ORDER part, never the suffix,
    // since the suffix is what makes it unique. Resolution is by lookup rather
    // than by parsing a fixed width, so a trimmed prefix is still resolvable.
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
function knet_resolve_track(array $cfg, string $ref): string
{
    if ($ref === '' || !knet_db_configured($cfg)) return $ref;
    try {
        $q = knet_pdo($cfg)->prepare('select 1 from orders where track_id = ?');
        $q->execute([$ref]);
        if ($q->fetchColumn()) return $ref;
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

function knet_order_lookup(array $cfg, string $trackid): array
{
    if (!knet_db_configured($cfg)) {
        return ['state' => 'off', 'amount' => null, 'status' => null];
    }
    try {
        $q = knet_pdo($cfg)->prepare('select amount, payment_status from orders where track_id = ?');
        $q->execute([$trackid]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        // A database that is DOWN must not read as "no such order": the two
        // have opposite correct responses — retry versus refuse.
        return ['state' => 'error', 'amount' => null, 'status' => null];
    }
    if (!$row) {
        return ['state' => 'missing', 'amount' => null, 'status' => null];
    }
    return [
        'state'  => 'found',
        'amount' => (string) $row['amount'],
        'status' => (string) $row['payment_status'],
    ];
}
