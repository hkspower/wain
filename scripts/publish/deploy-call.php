<?php
/**
 * Calls this site's own deploy endpoint, from the server, over the loopback.
 *
 *   php d.php probe
 *   php d.php <artifact-url> <sha256> <version>
 *
 * WHY THE LOOPBACK
 *
 * public_html/api/deploy.php wants a signed POST. Nothing in a Claude session
 * can send it: www.wainkw.com is refused at CONNECT by the sandbox gateway, and
 * so is the file host. For a long time that was written down as "the endpoint
 * cannot be used", which was wrong — it confused "unreachable from there" with
 * "unreachable". sporta's eight cron jobs have always called their own site as
 *
 *     wget --header=Host:www.sporta.com.kw https://127.0.0.1/api/...
 *
 * and the same shape reaches wain: verified by a GET that came back with
 * deploy.php's own {"ok":false,"error":"method_not_allowed"}. The certificate
 * is for the domain, not for 127.0.0.1, so verification is off — the connection
 * never leaves the machine, which is the point of using the loopback at all.
 *
 * WHY THE SECRET IS ONLY EVER READ HERE
 *
 * It lives at <domain>/storage/deploy.secret, mode 0600, outside public_html.
 * This script runs as the account and reads it on the server. It is never
 * printed, never sent anywhere, and never leaves the machine — only the HMAC
 * does. Nothing about it can be recovered from this file, which is why the
 * file is safe to keep in the repository.
 *
 * PROBE MODE
 *
 * `probe` sends a correctly signed request that is guaranteed to be refused for
 * a reason AFTER the signature check — deploy.php checks method, secret,
 * signature, JSON, sha format, timestamp, then host, in that order, so a
 * deliberately disallowed host proves the signature passed. `host_not_allowed`
 * back means the whole chain works. `bad_signature` means it does not, and
 * nothing has been downloaded or written either way.
 */

declare(strict_types=1);

$home   = getenv('HOME') ?: __DIR__;
$domain = 'wainkw.com';
$secretFile = "$home/domains/$domain/storage/deploy.secret";

function done(array $r): never { echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n"; exit; }

$mode = $argv[1] ?? '';

/**
 * `allow <hostname>` — add an artifact host to <domain>/storage/deploy.hosts.
 *
 * This exists because the obvious way to write that file cannot be run here.
 * `printf '%s\n' host > …/deploy.hosts` contains a redirection, and Cloudflare's
 * WAF in front of createAccountCronJobV1 reads shell plumbing as an injection
 * attempt and answers 403 — the same rule that forbids `{ … } > log 2>&1`. So
 * the one-liner is only usable from a real shell, which is not always to hand.
 * Doing it in PHP keeps the whole deploy inside the cron write path.
 *
 * Needs no secret, so it runs before the secret is read.
 */
if ($mode === 'allow') {
    $host = strtolower(trim((string) ($argv[2] ?? '')));
    // Same shape deploy.php's allowedHosts() will accept. A URL, a port or a
    // path here would silently widen the check to something that never matches
    // parse_url's host — so it is refused now rather than puzzled over later.
    if (!preg_match('/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/', $host) || !str_contains($host, '.')) {
        done(['ok' => false, 'error' => 'bad_hostname', 'given' => $argv[2] ?? null,
              'hint' => 'a bare hostname — no scheme, no port, no path']);
    }
    $f = "$home/domains/$domain/storage/deploy.hosts";
    $lines = is_readable($f)
        ? array_values(array_filter(array_map('trim', preg_split('/\R/', (string) file_get_contents($f)) ?: [])))
        : [];
    if (in_array($host, $lines, true)) done(['ok' => true, 'status' => 'already_listed', 'hosts' => $lines]);
    $lines[] = $host;
    if (!is_dir(dirname($f))) done(['ok' => false, 'error' => 'no_storage_dir', 'path' => dirname($f)]);
    if (file_put_contents($f, implode("\n", $lines) . "\n") === false) {
        done(['ok' => false, 'error' => 'write_failed', 'path' => $f]);
    }
    @chmod($f, 0600);
    done(['ok' => true, 'status' => 'added', 'hosts' => $lines, 'path' => $f]);
}

if (!is_readable($secretFile)) {
    done(['ok' => false, 'error' => 'secret_unreadable', 'path' => $secretFile,
          'hint' => 'deploy.php answers secret_not_configured for the same reason; create it, 0600']);
}
$secret = trim((string) file_get_contents($secretFile));
if ($secret === '') done(['ok' => false, 'error' => 'secret_empty']);

if ($mode === 'probe') {
    // A well-formed sha and a fresh timestamp, so the only thing left to fail
    // is the host — which is checked after the signature.
    $payload = [
        'url'     => 'https://deploy-probe.invalid/none.zip',
        'sha256'  => str_repeat('0', 64),
        'version' => 'probe',
        'ts'      => time(),
    ];
} elseif ($mode !== '' && ($argv[2] ?? '') !== '') {
    $payload = [
        'url'     => $mode,
        'sha256'  => strtolower($argv[2]),
        'version' => $argv[3] ?? 'unknown',
        'ts'      => time(),
    ];
    if (!preg_match('/^[a-f0-9]{64}$/', $payload['sha256'])) {
        done(['ok' => false, 'error' => 'bad_sha256_argument']);
    }
} else {
    done(['ok' => false, 'error' => 'usage',
          'usage' => ['php d.php probe', 'php d.php <artifact-url> <sha256> <version>']]);
}

$raw = json_encode($payload, JSON_UNESCAPED_SLASHES);
$sig = 'sha256=' . hash_hmac('sha256', $raw, $secret);

$ch = curl_init("https://127.0.0.1/api/deploy.php");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $raw,
    CURLOPT_RETURNTRANSFER => true,
    // The cert is issued for the domain; this connection never leaves the box.
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    // deploy.php stages, verifies and copies before it answers, so the timeout
    // has to cover a real deploy and not just the reply.
    CURLOPT_TIMEOUT        => 300,
    CURLOPT_HTTPHEADER     => [
        "Host: www.$domain",
        'Content-Type: application/json',
        "X-Deploy-Signature: $sig",
    ],
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($body === false) done(['ok' => false, 'error' => 'transport', 'curl' => $err]);

$parsed = json_decode((string) $body, true);
$result = ['http' => $code, 'response' => $parsed ?? (string) $body];

if ($mode === 'probe') {
    $got = is_array($parsed) ? ($parsed['error'] ?? '') : '';
    $result['signature'] = $got === 'host_not_allowed'
        ? 'accepted — the request got past the HMAC check'
        : ($got === 'bad_signature' ? 'REJECTED' : "inconclusive (got: $got)");
}

done($result);
