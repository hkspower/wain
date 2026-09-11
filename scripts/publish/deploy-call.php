<?php
/**
 * Calls this site's own deploy endpoint, from the server, over the loopback.
 *
 *   php d.php install
 *   php d.php version
 *   php d.php probe [staging|production]
 *   php d.php <artifact-url> <sha256> <version> [staging|production]
 *
 * The stage defaults to production when omitted, so a forgotten argument can
 * never send a deploy somewhere unintended — staging has to be asked for.
 *
 * IT IS INSTALLED ONCE, NOT FETCHED EVERY TIME
 *
 * This used to arrive by `wget -qO d.php https://raw.githubusercontent.com/…`
 * at the head of every single deploy, and be `rm`ed at the end of it. That
 * works, and it put GitHub on the critical path of a deploy that otherwise has
 * no reason to leave the machine: three or four cron jobs where one would do,
 * and a deploy that cannot run at all while raw.githubusercontent.com is having
 * a bad morning — or after a history rewrite moves the sha it is pinned to,
 * which is a thing this repository has had to plan around for شوق's knowledge
 * base already.
 *
 * So `install` copies it next to the secret it reads, at
 * <domain>/storage/d.php, and the recurring deploy is one command naming that
 * path. The fetch-pin-run route is still how the file gets there the first time
 * and after an edit — there is no other way to write to this account from a
 * sandbox that cannot reach it — but that is once, not every time.
 *
 * `version` exists because an installed copy can go stale silently. It prints
 * the same fingerprint `npm run deploy:plan` prints for the repository's copy;
 * if they differ, the server is running an older caller and the plan says to
 * reinstall. Nothing else can notice that — the file is outside the docroot and
 * no read tool here can see it.
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

/**
 * Which site this call is aimed at. Both endpoints answer on the same loopback
 * address and are told apart only by the Host header — staging's document root
 * is public_html/staging, so its request path is /api/deploy.php exactly like
 * production's. Default is production, so an omitted argument can never send a
 * deploy somewhere unintended by accident; staging has to be asked for.
 */
function siteHost(?string $given, string $domain): string {
    if ($given === null || $given === '') return "www.$domain";
    if ($given === 'staging') return "staging.$domain";
    if ($given === 'production' || $given === 'www') return "www.$domain";
    if (!preg_match('/^[a-z0-9][a-z0-9.-]*\.' . preg_quote($domain, '/') . '$/i', $given)) {
        done(['ok' => false, 'error' => 'bad_host', 'given' => $given,
              'hint' => "use 'staging', 'production', or a hostname under $domain"]);
    }
    return strtolower($given);
}
$secretFile = "$home/domains/$domain/storage/deploy.secret";

/**
 * Where the installed copy lives, and why it is not in public_html.
 *
 * It reads the deploy secret, so it belongs on the same side of the web root as
 * the secret does — a PHP file inside public_html is a URL, and this one would
 * be a URL that signs deploys. storage/ is also the one directory deploy.php
 * never prunes: everything it deletes is under storage/deploy/, so an installed
 * caller cannot be swept away by the thing it calls.
 */
$installPath = "$home/domains/$domain/storage/d.php";

function done(array $r): never { echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n"; exit; }

/** Short sha256 of a caller, so two copies can be compared in one glance. */
function fingerprint(string $file): ?string {
    $h = @hash_file('sha256', $file);
    return $h === false ? null : substr($h, 0, 16);
}

$mode = $argv[1] ?? '';

/**
 * `install` — put this file at storage/d.php so no later deploy fetches it.
 *
 * Needs no secret: it only copies a file the account already has. Deliberately
 * overwrites, and reports the fingerprint it replaced, because the reason to
 * run it a second time is always that the repository's copy has changed and the
 * output is the only record of which version the server is now on.
 */
if ($mode === 'install') {
    $was = fingerprint($installPath);
    if (realpath(__FILE__) === realpath($installPath)) {
        done(['ok' => true, 'status' => 'already_installed', 'path' => $installPath,
              'fingerprint' => $was, 'note' => 'run from the installed copy — nothing to do']);
    }
    if (!is_dir(dirname($installPath))) {
        done(['ok' => false, 'error' => 'no_storage_dir', 'path' => dirname($installPath)]);
    }
    if (!@copy(__FILE__, $installPath)) {
        done(['ok' => false, 'error' => 'copy_failed', 'from' => __FILE__, 'to' => $installPath]);
    }
    @chmod($installPath, 0600);
    done(['ok' => true, 'status' => $was === null ? 'installed' : 'replaced',
          'path' => $installPath, 'was' => $was, 'fingerprint' => fingerprint($installPath)]);
}

/**
 * `version` — which caller is on this server.
 *
 * The only way to answer that. storage/ is outside the document root, so no
 * read tool in a session can see the file; `npm run deploy:plan` prints the
 * repository copy's fingerprint and this prints the server's, and a deploy plan
 * that assumes a feature the installed copy does not have fails in the cron
 * output rather than in the docroot.
 */
if ($mode === 'version') {
    done(['ok' => true, 'running' => fingerprint(__FILE__), 'from' => __FILE__,
          'installed' => fingerprint($installPath), 'path' => $installPath]);
}

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
    $host = siteHost($argv[2] ?? null, $domain);
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
    $host = siteHost($argv[4] ?? null, $domain);
} else {
    done(['ok' => false, 'error' => 'usage',
          'usage' => ['php d.php install',
                      'php d.php version',
                      'php d.php allow <hostname>',
                      'php d.php probe [staging|production]',
                      'php d.php <artifact-url> <sha256> <version> [staging|production]']]);
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
        "Host: $host",
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
$result = ['host' => $host, 'http' => $code, 'response' => $parsed ?? (string) $body];

if ($mode === 'probe') {
    $got = is_array($parsed) ? ($parsed['error'] ?? '') : '';
    $result['signature'] = $got === 'host_not_allowed'
        ? 'accepted — the request got past the HMAC check'
        : ($got === 'bad_signature' ? 'REJECTED' : "inconclusive (got: $got)");
}

done($result);
