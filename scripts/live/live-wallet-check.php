<?php
/**
 * Is the Apple Wallet loyalty card actually issuable on the live shop?
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-wallet-check.php && php c.php
 *
 * READ-ONLY. It reads config.php and stats the three certificate files; it
 * writes nothing and prints no secret — never the team id, never a byte of a
 * certificate, only whether each is PRESENT and, for the team id, whether it
 * is the literal placeholder WALLET.md's own example uses.
 *
 * "PRESENT" IS NOT "CONFIGURED", the same trap live-pay-check.php already
 * caught on the CBK credentials. WALLET.md's own setup walkthrough ends with
 * `WALLET_TEAM_ID=ABCDE12345 node scripts/make-wallet-pass.mjs …` as the
 * EXAMPLE command, and 'ABCDE12345' is exactly ten characters — the same
 * length a real team id is. A config.php that was filled in by copying that
 * line verbatim would pass any check that only asks "is it set", and iOS
 * would refuse every pass with a signature Apple never issued.
 *
 * WHY THIS ISN'T A REQUEST TO THE ENDPOINT. wallet.php needs a phone number
 * and a real order reference to issue anything, and this script has neither
 * and must invent none — a probe that mints its own test order to satisfy a
 * check is a probe that writes to a live shop. Reading the three inputs
 * wallet.php itself reads is the read-only way to ask the same question.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('config.php not found — nothing to check'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing to check'); exit; }

// wallet.php's own rule: an EMPTY wallet_cert_dir means unset (the live
// config.php has one), and the default is beside public_html, not above it.
$certDir = trim((string) ($c['wallet_cert_dir'] ?? ''));
if ($certDir === '') $certDir = dirname($cfgPath, 3) . '/wallet-certs';
// THE CERTIFICATE FIRST, since 2026-09-26: the /backends setup card never
// writes wallet_team_id; Apple's certificate carries the team id and
// wallet.php reads it from there. Reading config.php alone would report a
// linked shop as EMPTY.
$teamId = '';
$pemText = @file_get_contents(rtrim($certDir, '/') . '/pass.pem');
if (is_string($pemText) && ($info = openssl_x509_parse($pemText))) {
    $ou = $info['subject']['OU'] ?? '';
    $teamId = is_array($ou) ? (string) reset($ou) : (string) $ou;
    line('certificate  team from cert, valid until ' . gmdate('Y-m-d', (int) ($info['validTo_time_t'] ?? 0)));
}
if ($teamId === '') $teamId = (string) ($c['wallet_team_id'] ?? '');

// THE DOC'S OWN EXAMPLE, verbatim, is the one string that would look like a
// real ten-character team id and mean nothing at all.
$isPlaceholder = $teamId === 'ABCDE12345';

line('teamId ' . ($teamId === ''
    ? 'EMPTY'
    : (strlen($teamId) === 10 && !$isPlaceholder ? 'present (10 chars)'
       : ($isPlaceholder ? 'PLACEHOLDER (still WALLET.md\'s own example)'
          : 'present but ' . strlen($teamId) . ' chars, not 10'))));

line('certDir ' . $certDir . '  exists=' . (is_dir($certDir) ? 'yes' : 'NO'));
foreach (['pass.pem' => 'certificate', 'pass.key' => 'private key', 'wwdr.pem' => "Apple's intermediate"] as $f => $what) {
    $p = rtrim($certDir, '/') . '/' . $f;
    line(sprintf('  %-10s %-22s %s', $f, $what, is_file($p) ? ('present, ' . filesize($p) . ' bytes') : 'MISSING'));
}

$ready = $teamId !== '' && !$isPlaceholder && strlen($teamId) === 10
    && is_file(rtrim($certDir, '/') . '/pass.pem')
    && is_file(rtrim($certDir, '/') . '/pass.key')
    && is_file(rtrim($certDir, '/') . '/wwdr.pem');
line('');
line($ready
    ? 'READY — a pass built here would carry a real signature.'
    : 'NOT READY — wallet.php will answer 503 wallet_not_configured to every request.');

// Whether the two front doors to it are actually there.
$site = 'https://127.0.0.1';
$get = static function (string $path) use ($site): int {
    $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
        'http' => ['header' => "Host: www.sporta.com.kw\r\n", 'timeout' => 8, 'ignore_errors' => true]]);
    @file_get_contents($site . $path, false, $ctx);
    foreach ($http_response_header ?? [] as $h) if (preg_match('~^HTTP/\S+\s+(\d{3})~', $h, $m)) return (int) $m[1];
    return 0;
};
line('');
line('/card page          ' . $get('/card'));
line('/api/wallet.php?r=loyalty (no params, expect 400 or 503) ' . $get('/api/wallet.php?r=loyalty'));
