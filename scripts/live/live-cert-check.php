<?php
/**
 * What certificate a visitor is actually handed, and for which names.
 *
 * READ-ONLY. It opens TLS connections and reads one settings row. It writes
 * nothing, changes nothing and touches no file — the same rule live-scan.php
 * states of itself, and it matters here because this file is fetched over a
 * public URL from a public repository.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-cert-check.php && php r.php
 *
 * WHY IT EXISTS. Hostinger's API reports both certificates `active`, lifetime,
 * with the HTTPS redirect on and no last_error — and the owner is seeing a
 * browser warning anyway. Those two are not in conflict: the panel answers
 * "is a certificate installed", and a browser answers "does the certificate
 * presented for THIS NAME cover THIS NAME, chain to a root, and is the page it
 * serves free of insecure sub-resources". Three different questions.
 *
 * THE LIKELIEST ANSWER IS `www`. The shop's canonical host is
 * www.sporta.com.kw — the loopback form every script here uses sends
 * `Host: www.sporta.com.kw`, and .htaccess redirects the apex to it. A
 * certificate issued for `sporta.com.kw` alone covers the apex and NOT the
 * subdomain, so every visitor lands on a name the certificate does not name.
 * The panel would report that as `active` and be telling the truth.
 *
 * IT ASKS OVER THE PUBLIC NAME, NOT THE LOOPBACK, and that is the whole point.
 * `https://127.0.0.1` with a Host header is how everything else here measures
 * the live site, and it CANNOT answer this: it connects by address, so the
 * name never matches and every script passes `--no-check-certificate` to get
 * on with its job. That flag is exactly the thing under test. The server has
 * working outbound internet and resolves its own domain again since
 * 2026-09-09, so asking properly is possible now.
 *
 * SIX SECONDS, NOT TWELVE, and run it as a ONE-SHOT. Six TLS handshakes at a
 * twelve-second timeout is seventy-two seconds in the worst case, which is
 * longer than a `* * * * *` cycle — and the panel captures a job's output when
 * the process EXITS, so an overrunning run reports nothing at all and the next
 * minute's run overwrites the answer it never gave. Measured here: three ticks,
 * three empty outputs. Schedule it at a named minute and delete it once read.
 *
 * ECHO AS IT MEASURES, never at the end: a script that builds one line and
 * prints it last reports NOTHING when the channel cuts the run short, which
 * this project has already watched happen twice.
 */

header('Content-Type: text/plain; charset=utf-8');
@ini_set('default_socket_timeout', '6');

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

/** The certificate a TLS handshake for $host actually presents. */
function cert(string $host): ?array {
    $ctx = stream_context_create(['ssl' => [
        'capture_peer_cert' => true,
        // VERIFICATION OFF ON PURPOSE, and it is not a shortcut: a failed
        // handshake returns nothing to read, and the certificate is the thing
        // being examined. Whether it VERIFIES is reported separately below.
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'SNI_enabled'       => true,
        'peer_name'         => $host,
    ]]);
    $fp = @stream_socket_client(
        'ssl://' . $host . ':443', $errno, $errstr, 6,
        STREAM_CLIENT_CONNECT, $ctx
    );
    if (!$fp) return ['error' => trim($errstr) !== '' ? $errstr : ('errno ' . $errno)];

    $params = stream_context_get_params($fp);
    fclose($fp);
    $res = $params['options']['ssl']['peer_certificate'] ?? null;
    if ($res === null) return ['error' => 'no peer certificate'];

    $info = openssl_x509_parse($res);
    if ($info === false) return ['error' => 'unparseable certificate'];

    $sans = [];
    foreach (explode(',', (string) ($info['extensions']['subjectAltName'] ?? '')) as $part) {
        $part = trim($part);
        if (stripos($part, 'DNS:') === 0) $sans[] = strtolower(substr($part, 4));
    }
    return [
        'cn'     => (string) ($info['subject']['CN'] ?? '?'),
        'issuer' => (string) ($info['issuer']['O'] ?? $info['issuer']['CN'] ?? '?'),
        'from'   => gmdate('Y-m-d', (int) ($info['validFrom_time_t'] ?? 0)),
        'to'     => gmdate('Y-m-d', (int) ($info['validTo_time_t'] ?? 0)),
        'sans'   => $sans,
    ];
}

/** Does a certificate's name list cover $host? Wildcards match one label. */
function covers(array $sans, string $host): bool {
    $host = strtolower($host);
    foreach ($sans as $n) {
        if ($n === $host) return true;
        if (strpos($n, '*.') === 0 && substr_count($host, '.') === substr_count($n, '.')
            && substr($host, strpos($host, '.')) === substr($n, 1)) return true;
    }
    return false;
}

/** A real request, with verification ON — what a browser would decide. */
function verifies(string $host): string {
    $ctx = stream_context_create([
        'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true],
        'http' => ['method' => 'HEAD', 'timeout' => 6, 'ignore_errors' => true,
                   'header' => "User-Agent: sporta-cert-check\r\n"],
    ]);
    $r = @file_get_contents('https://' . $host . '/', false, $ctx);
    if ($r === false) {
        $e = error_get_last();
        return 'REFUSED: ' . trim(preg_replace('/\s+/', ' ', (string) ($e['message'] ?? 'unknown')));
    }
    return 'ok';
}

line('=== the certificate each name presents ===');
foreach (['www.sporta.com.kw', 'sporta.com.kw', 'static.sporta.com.kw'] as $host) {
    $c = cert($host);
    if (isset($c['error'])) { line(sprintf('%-22s ERROR %s', $host, $c['error'])); continue; }
    line(sprintf('%-22s cn=%s issuer=%s valid=%s..%s', $host, $c['cn'], $c['issuer'], $c['from'], $c['to']));
    line(sprintf('%-22s names=%s', '', implode(' ', $c['sans']) ?: '(none)'));
    line(sprintf('%-22s coversThisName=%s', '', covers($c['sans'], $host) ? 'YES' : 'NO  <-- a browser warns here'));
}

line('');
line('=== and what a verifying client decides ===');
foreach (['www.sporta.com.kw', 'sporta.com.kw', 'static.sporta.com.kw'] as $host) {
    line(sprintf('%-22s %s', $host, verifies($host)));
}

line('');
line('=== insecure sub-resources stored in the database ===');
// The other way a padlock breaks with a perfect certificate: one http:// URL
// inside owner-entered content. Every shipped FILE was checked and is clean,
// so the settings rows are what is left — custom CSS, the footer, the rewritten
// site wording, all of which reach the page.
//
// config.php RETURNS AN ARRAY; it defines no constants. The first version of
// this reached for DB_HOST and died `Undefined constant` — measured, not
// guessed at a second time. The keys are the ones config.example.php ships.
$cfg = __DIR__ . '/../../sporta-site/public_html/api/config.php';
if (!is_file($cfg)) $cfg = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfg)) { line('config.php not found — skipped'); exit; }
$c = require $cfg;
if (!is_array($c)) { line('config.php did not return an array — skipped'); exit; }
try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $rows = $db->query('select name, value from settings')->fetchAll(PDO::FETCH_ASSOC);
    $hits = 0;
    foreach ($rows as $row) {
        if (stripos((string) $row['value'], 'http://') === false) continue;
        $hits++;
        line(sprintf('  %-14s contains http:// <-- mixed content on every page it reaches', $row['name']));
    }
    line('settingsRowsWithHttp=' . $hits . ' of ' . count($rows));
} catch (Throwable $e) {
    line('database unreadable: ' . $e->getMessage());
}
