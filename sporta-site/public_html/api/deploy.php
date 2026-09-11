<?php
/**
 * deploy.php — signed, verified, manifest-based static deploy endpoint.
 *
 * Replaces the unsafe pattern of `wget zip && unzip -o` over a live web root.
 *
 * Guarantees:
 *   - HMAC-SHA256 signed requests only (shared secret lives OUTSIDE public_html)
 *   - Artifact host allow-listed
 *   - SHA-256 checksum verified before anything is written
 *   - Staged in /storage, never unpacked into the live root
 *   - PROTECTED dirs (api, knet, pay, admin, queue...) are never touched
 *   - Manifest-based cleanup removes stale build files only
 *   - Never executes downloaded code; .php in an artifact is refused
 *   - Previous release retained for rollback
 *
 * Layout (per domain):
 *   <domain>/public_html/api/deploy.php   <- this file
 *   <domain>/storage/deploy.secret        <- shared secret, 0600
 *   <domain>/storage/deploy/              <- staging, manifests, log, rollback
 */

declare(strict_types=1);

const PROTECTED_PATHS = [
    'api', 'knet', 'pay', 'admin', 'queue', 'orders',
    'storage', 'cgi-bin', '.well-known',
    '.htaccess', 'config.php',
];

const ALLOWED_HOSTS  = ['raw.githubusercontent.com', 'github.com', 'codeload.github.com'];
const MAX_BYTES      = 200 * 1024 * 1024;
const KEEP_RELEASES  = 3;

$ROOT    = dirname(__DIR__, 2);            // <domain>/
$WEBROOT = $ROOT . '/public_html';
$STORAGE = $ROOT . '/storage';
$WORK    = $STORAGE . '/deploy';
$LOG     = $WORK . '/deploy.log';

function out(int $code, array $body): never {
    http_response_code($code);
    header('Content-Type: application/json');
    header('X-Robots-Tag: noindex');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
    exit;
}

function logline(string $msg): void {
    global $LOG, $WORK;
    if (!is_dir($WORK)) @mkdir($WORK, 0750, true);
    @file_put_contents($LOG, gmdate('c') . ' ' . $msg . "\n", FILE_APPEND | LOCK_EX);
}

function rrmdir(string $dir): void {
    if (!is_dir($dir)) return;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $f) { $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname()); }
    @rmdir($dir);
}

function isProtected(string $rel): bool {
    $first = explode('/', str_replace('\\', '/', $rel))[0];
    return in_array($first, PROTECTED_PATHS, true);
}

/* ---------- 1. method ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

/* ---------- 2. secret ---------- */
$secretFile = $STORAGE . '/deploy.secret';
if (!is_readable($secretFile)) {
    logline('FAIL no_secret');
    out(500, ['ok' => false, 'error' => 'secret_not_configured']);
}
$secret = trim((string) file_get_contents($secretFile));
if ($secret === '') out(500, ['ok' => false, 'error' => 'secret_empty']);

/* ---------- 3. signature ---------- */
$raw = (string) file_get_contents('php://input');
if ($raw === '' || strlen($raw) > 65536) {
    out(400, ['ok' => false, 'error' => 'bad_payload']);
}
$sent = $_SERVER['HTTP_X_DEPLOY_SIGNATURE'] ?? '';
$calc = 'sha256=' . hash_hmac('sha256', $raw, $secret);
if (!hash_equals($calc, $sent)) {
    logline('FAIL bad_signature ip=' . ($_SERVER['REMOTE_ADDR'] ?? '?'));
    out(401, ['ok' => false, 'error' => 'bad_signature']);
}

/* ---------- 4. payload ---------- */
$p = json_decode($raw, true);
if (!is_array($p)) out(400, ['ok' => false, 'error' => 'bad_json']);

$url     = (string) ($p['url']     ?? '');
$sha     = strtolower((string) ($p['sha256'] ?? ''));
$version = (string) ($p['version'] ?? 'unknown');
$ts      = (int)    ($p['ts']      ?? 0);

if (!preg_match('/^[a-f0-9]{64}$/', $sha)) out(400, ['ok' => false, 'error' => 'bad_sha256']);
if ($ts < time() - 600 || $ts > time() + 600) {
    out(400, ['ok' => false, 'error' => 'stale_request']);   // replay protection
}
$host = parse_url($url, PHP_URL_HOST) ?: '';
if (parse_url($url, PHP_URL_SCHEME) !== 'https' || !in_array($host, ALLOWED_HOSTS, true)) {
    out(400, ['ok' => false, 'error' => 'host_not_allowed', 'host' => $host]);
}

if (!is_dir($WORK)) @mkdir($WORK, 0750, true);
$lock = fopen($WORK . '/.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    out(409, ['ok' => false, 'error' => 'deploy_in_progress']);
}

$stamp = gmdate('Ymd-His');
$zip   = "$WORK/artifact-$stamp.zip";
$stage = "$WORK/stage-$stamp";

/* ---------- 5. download ---------- */
$fh = fopen($zip, 'w');
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_FILE           => $fh,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_NOPROGRESS     => false,
    CURLOPT_PROGRESSFUNCTION => fn($r, $dl) => $dl > MAX_BYTES ? 1 : 0,
]);
$ok   = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);
fclose($fh);

if (!$ok || $code !== 200) {
    @unlink($zip);
    logline("FAIL download http=$code $err");
    out(502, ['ok' => false, 'error' => 'download_failed', 'http' => $code]);
}

/* ---------- 6. checksum ---------- */
$actual = hash_file('sha256', $zip);
if (!hash_equals($sha, $actual)) {
    @unlink($zip);
    logline("FAIL checksum expected=$sha actual=$actual");
    out(422, ['ok' => false, 'error' => 'checksum_mismatch', 'expected' => $sha, 'actual' => $actual]);
}

/* ---------- 7. stage ---------- */
$za = new ZipArchive();
if ($za->open($zip) !== true) {
    @unlink($zip);
    out(422, ['ok' => false, 'error' => 'bad_archive']);
}
// refuse traversal, absolute paths, protected paths and executable code
for ($i = 0; $i < $za->numFiles; $i++) {
    $n = $za->getNameIndex($i);
    if (str_contains($n, '..') || str_starts_with($n, '/')) {
        $za->close(); @unlink($zip);
        out(422, ['ok' => false, 'error' => 'unsafe_path', 'entry' => $n]);
    }
    if (preg_match('/\.(php|phar|phtml|cgi|sh)$/i', $n)) {
        $za->close(); @unlink($zip);
        out(422, ['ok' => false, 'error' => 'executable_in_artifact', 'entry' => $n]);
    }
    if (isProtected($n)) {
        $za->close(); @unlink($zip);
        out(422, ['ok' => false, 'error' => 'artifact_touches_protected_path', 'entry' => $n]);
    }
}
@mkdir($stage, 0750, true);
if (!$za->extractTo($stage)) {
    $za->close(); rrmdir($stage); @unlink($zip);
    out(500, ['ok' => false, 'error' => 'extract_failed']);
}
$za->close();

// collapse single wrapper dir (GitHub archives nest one level)
$entries = array_values(array_diff(scandir($stage), ['.', '..']));
if (count($entries) === 1 && is_dir("$stage/{$entries[0]}")) {
    $stage = "$stage/{$entries[0]}";
}

/* ---------- 8. publish ---------- */
$newManifest = [];
$copied = 0;
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($stage, FilesystemIterator::SKIP_DOTS)
);
foreach ($it as $f) {
    if ($f->isDir()) continue;
    $rel = ltrim(str_replace($stage, '', $f->getPathname()), '/');
    if ($rel === '' || isProtected($rel)) continue;
    $dest = "$WEBROOT/$rel";
    $dir  = dirname($dest);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (@copy($f->getPathname(), $dest)) { $newManifest[] = $rel; $copied++; }
}

/* ---------- 9. prune stale files from previous manifest ---------- */
$manifestFile = "$WORK/manifest.json";
$old = is_readable($manifestFile)
    ? (json_decode((string) file_get_contents($manifestFile), true)['files'] ?? [])
    : [];
$removed = 0;
foreach (array_diff($old, $newManifest) as $gone) {
    if (isProtected($gone)) continue;
    if (@unlink("$WEBROOT/$gone")) $removed++;
}

file_put_contents($manifestFile, json_encode([
    'version'    => $version,
    'sha256'     => $sha,
    'deployedAt' => gmdate('c'),
    'files'      => $newManifest,
], JSON_UNESCAPED_SLASHES));

/* ---------- 10. tidy ---------- */
rrmdir("$WORK/stage-$stamp");
$olds = glob("$WORK/artifact-*.zip") ?: [];
sort($olds);
foreach (array_slice($olds, 0, max(0, count($olds) - KEEP_RELEASES)) as $o) @unlink($o);

flock($lock, LOCK_UN); fclose($lock);

logline("OK version=$version files=$copied removed=$removed sha=$sha");
out(200, [
    'ok'       => true,
    'version'  => $version,
    'deployed' => $copied,
    'removed'  => $removed,
    'at'       => gmdate('c'),
]);
