<?php
// One config path for the store, both gateways, and the backend editor.
// On the VPS the directory is mounted outside Apache's document root. Older
// shared-hosting installs continue to use their existing protected config.php.
//
// Ships as /api/config-path.php. The gateways (knet/knet.php, pay/cbk.php)
// include it from ../api/, so all three read the same rule and cannot disagree
// about where a secret lives.
//
// The VPS layout (apache-sporta container):
//   SPORTA_API_CONFIG_FILE     the store's config, a read-only bind mount of
//                              /docker/sporta/private/api-config.php
//   SPORTA_PRIVATE_CONFIG_DIR  holds knet-config.php and pay-config.php, a
//                              read-only bind mount of /docker/sporta/private/config
// Neither variable set means shared hosting: each config.php sits next to the
// code that reads it, denied by name in that folder's .htaccess.
//
// It also holds the two other rules all three must agree on, for the same
// reason: WHO is asking (sporta_client_ip, sporta_rate_identity) and how that
// becomes a counter (sporta_rate_limit_key, sporta_rate_limit_hit). The store
// used to have the only copy, so the payment logs recorded the proxy's address
// and T-Pay had no limiter at all; a second copy in the gateways would be the
// next pair of rules that drift apart.
declare(strict_types=1);

function sporta_config_path(string $kind, string $legacyPath): string {
    $names = [
        'knet' => 'knet-config.php',
        'tpay' => 'pay-config.php',
    ];
    if ($kind === 'api') {
        $file = getenv('SPORTA_API_CONFIG_FILE');
        if ($file !== false && $file !== '') {
            if ($file !== trim($file) || !str_starts_with($file, '/') || str_contains($file, "\0")) {
                throw new RuntimeException('Invalid private API config path');
            }
            return $file;
        }
        // A VPS with private merchant configs must never fall back to a web-root
        // API config. Its API file is a separate, read-only bind mount.
        if (getenv('SPORTA_PRIVATE_CONFIG_DIR')) {
            throw new RuntimeException('Private API config path missing');
        }
        return $legacyPath;
    }
    if (!isset($names[$kind])) throw new InvalidArgumentException('Unknown config kind');

    $dir = getenv('SPORTA_PRIVATE_CONFIG_DIR');
    if ($dir === false || $dir === '') return $legacyPath;
    // A configured private directory must fail closed. Falling back to a
    // public_html config on a mount typo would silently use stale credentials.
    if ($dir !== trim($dir) || !str_starts_with($dir, '/') || str_contains($dir, "\0")) {
        throw new RuntimeException('Invalid private config directory');
    }
    return rtrim($dir, '/') . '/' . $names[$kind];
}

// ------------------------------------------------------------ who is asking
//
// One implementation for the store, KNET and T-Pay. store.php's store_*
// helpers delegate here; the gateways call these directly with the
// trusted_proxy_ips they borrow from the store's config.

function sporta_normalize_ip(mixed $value): string {
    if (!is_string($value)) return '';
    $value = trim($value);
    if (filter_var($value, FILTER_VALIDATE_IP) === false) return '';
    $packed = @inet_pton($value);
    return $packed === false ? '' : (string)inet_ntop($packed);
}

function sporta_ip_matches_rule(string $ip, mixed $rule): bool {
    if (!is_string($rule) || $rule === '') return false;
    $rule = trim($rule);
    if (!str_contains($rule, '/')) return hash_equals(sporta_normalize_ip($rule), $ip);
    [$network, $rawBits] = array_pad(explode('/', $rule, 2), 2, '');
    $network = sporta_normalize_ip($network);
    if ($network === '' || !preg_match('/^(?:0|[1-9][0-9]{0,2})$/D', $rawBits)) return false;
    $packedIp = @inet_pton($ip);
    $packedNetwork = @inet_pton($network);
    if ($packedIp === false || $packedNetwork === false || strlen($packedIp) !== strlen($packedNetwork)) return false;
    $bits = (int)$rawBits;
    $maxBits = strlen($packedIp) * 8;
    if ($bits < 0 || $bits > $maxBits) return false;
    $whole = intdiv($bits, 8);
    $partial = $bits % 8;
    if ($whole > 0 && substr($packedIp, 0, $whole) !== substr($packedNetwork, 0, $whole)) return false;
    if ($partial === 0) return true;
    $mask = (0xff << (8 - $partial)) & 0xff;
    return (ord($packedIp[$whole]) & $mask) === (ord($packedNetwork[$whole]) & $mask);
}

// The config value as written: a list, or one comma-separated string.
function sporta_trusted_proxy_rules(mixed $raw): array {
    if (is_string($raw)) $raw = preg_split('/\s*,\s*/', trim($raw), -1, PREG_SPLIT_NO_EMPTY);
    return is_array($raw) ? array_values(array_filter($raw, 'is_string')) : [];
}

function sporta_ip_is_trusted_proxy(string $ip, array $rules): bool {
    if ($ip === '') return false;
    foreach ($rules as $rule) {
        if (sporta_ip_matches_rule($ip, $rule)) return true;
    }
    return false;
}

// Never trust X-Forwarded-For merely because it exists: a browser can send
// that header too. Only a REMOTE_ADDR explicitly listed in the server-only
// config may introduce a forwarded chain. Walk from the trusted ingress back
// towards the client and take the first untrusted hop; prepended spoof values
// therefore never win. With no usable address we deliberately return one
// shared sentinel instead of disabling the limiter.
function sporta_client_ip(array $trustedRules): string {
    $remote = sporta_normalize_ip($_SERVER['REMOTE_ADDR'] ?? '');
    if ($remote === '') return 'unknown';
    if (!sporta_ip_is_trusted_proxy($remote, $trustedRules)) return $remote;

    $raw = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if (!is_string($raw) || $raw === '' || strlen($raw) > 2048) return $remote;
    $chain = [];
    foreach (explode(',', $raw) as $part) {
        $ip = sporta_normalize_ip($part);
        if ($ip !== '') $chain[] = $ip;
    }
    $chain[] = $remote;
    for ($i = count($chain) - 1; $i >= 0; $i--) {
        if (!sporta_ip_is_trusted_proxy($chain[$i], $trustedRules)) return $chain[$i];
    }
    return $remote;
}

// The address a PER-CLIENT counter is keyed on — not always the address.
//
// An IPv6 client does not have one address, it has a /64: SLAAC and privacy
// extensions hand every device a fresh interface id whenever it likes, and
// 3GPP mobile networks give each phone a /64 of its own. Keyed on the full
// /128, every one of those 2^64 addresses was a fresh bucket, so a single
// phone could step around every per-client limit in the shop. Keyed on the
// /64 it is one client again — and never two phones, because carriers do
// not share a /64 between subscribers.
//
// IPv4 is returned unchanged, so carrier-grade NAT keying is exactly what it
// was. An IPv4-MAPPED address (::ffff:203.0.113.5) is unwrapped to the IPv4
// it carries first: otherwise every mapped client would mask to ONE ::/64
// bucket and the whole IPv4 internet behind a dual-stack proxy would share it.
//
// Counters only. Logs and request_ip rows record what sporta_client_ip()
// returns, the address itself.
function sporta_rate_identity(string $ip): string {
    $packed = @inet_pton($ip);
    if ($packed === false || strlen($packed) !== 16) return $ip;
    if (substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        return (string)inet_ntop(substr($packed, 12));
    }
    return inet_ntop(substr($packed, 0, 8) . str_repeat("\0", 8)) . '/64';
}

// ------------------------------------------------------- counting attempts
//
// The bucket key: an HMAC, so the table holds no address and no email in a
// form anyone can read back. Keyed with rate_limit_secret when one is set,
// and otherwise with a key derived from the database credentials — which are
// already server-only, so existing installations needed no config change. The
// gateways pass the same four values under their own names (mysql_*), and as
// long as they name the same database as the store they derive the SAME key,
// so a bucket means one thing whichever file counted it.
function sporta_rate_limit_key(string $bucket, string $identity, string $secret, array $dbParts): string {
    if ($secret === '') {
        $secret = hash('sha256', implode('|', array_map('strval', $dbParts)));
    }
    return substr(hash_hmac('sha256', $bucket . '|' . ($identity === '' ? 'unknown' : $identity), $secret), 0, 32);
}

/** @return array{allowed:bool,hits:int,retry_after:int,key:string,window_start:int} */
function sporta_rate_limit_hit(PDO $db, string $key, int $max, int $windowSec): array {
    $max = max(1, $max);
    $windowSec = max(1, $windowSec);
    $now = time();
    $windowStart = $now - ($now % $windowSec);

    $db->prepare(
        'insert into rate_limit (bucket_key, window_start, hits) values (?, ?, 1)
         on duplicate key update hits = hits + 1'
    )->execute([$key, $windowStart]);

    $q = $db->prepare('select hits from rate_limit where bucket_key = ? and window_start = ?');
    $q->execute([$key, $windowStart]);
    $hits = (int)$q->fetchColumn();

    // Opportunistic sweep, ~1 request in 50, so the table cannot grow without
    // bound on a shop that never runs a cron for it.
    //
    // SCOPED TO THIS BUCKET, and that is the whole point. It used to be
    // `where window_start < ?` with no bucket at all, while the cutoff was
    // computed from the CALLING bucket's window — so a short-window counter
    // swept away long-window ones that were still live. Measured: the 60-second
    // admin bucket deletes anything older than four minutes, which is exactly
    // what a 900-second login_fail window looks like fifteen minutes in. Half a
    // sixty-attempt password spray vanished from the table mid-run, and the
    // throttle that should have stopped it never fired.
    //
    // A rate limiter that quietly forgets is worse than none: it reports
    // success while the counter it is defending resets under it, and nothing
    // logs the difference.
    if (random_int(1, 50) === 1) {
        $db->prepare('delete from rate_limit where bucket_key = ? and window_start < ?')
           ->execute([$key, $windowStart - ($windowSec * 4)]);
        // And a global sweep for buckets nobody visits any more — scoped
        // sweeping alone would leave those forever. Two days is longer than
        // the longest window any caller uses (a day), so this can never reach
        // a live counter no matter which bucket triggers it.
        $db->prepare('delete from rate_limit where window_start < ?')
           ->execute([$now - 2 * 86400]);
    }

    return [
        'allowed' => $hits <= $max,
        'hits' => $hits,
        'retry_after' => max(1, ($windowStart + $windowSec) - $now),
        'key' => $key,
        'window_start' => $windowStart,
    ];
}
