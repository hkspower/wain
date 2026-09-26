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

/**
 * The same question asked of a ZIP ENTRY, which is not the same string.
 *
 * isProtected() tests the FIRST path segment, and every entry in a GitHub
 * archive is nested under a wrapper directory — `wain-<sha>/api/config.php`.
 * So the first segment is the wrapper, never `api`, and the protected-path
 * check in the staging loop below was inert for exactly the archives this
 * endpoint exists to deploy.
 *
 * It was not exploitable: the publish loop re-checks after collapsing the
 * wrapper, and that is what has actually been refusing protected paths. But a
 * dead layer that reads as a live one is worth more as a live one, and the
 * failure it is meant to produce — a 422 naming the entry, before a single byte
 * is extracted — is much better than silently skipping the file afterwards.
 *
 * Only ONE leading directory is stripped, and only when the archive really has
 * a single wrapper, which is the same condition the collapse below uses.
 */
function isProtectedEntry(string $n, bool $wrapped): bool {
    $n = ltrim(str_replace('\\', '/', $n), '/');
    if ($wrapped) {
        $slash = strpos($n, '/');
        if ($slash === false) return false;      // the wrapper directory itself
        $n = substr($n, $slash + 1);
    }
    return $n !== '' && isProtected($n);
}

/**
 * Anything that can make the server EXECUTE what this endpoint writes.
 *
 * THE HEADER'S PROMISE WAS FALSE, and the `.php` check is not what made it so —
 * it is that the check was the only one. Measured 2026-09-11 against the real
 * guards, every one of these was accepted and written:
 *
 *     assets/.user.ini    assets/.htaccess    assets/x.php5    assets/x.pht
 *
 * `PROTECTED_PATHS` does list `.htaccess`, but `isProtected()` tests the FIRST
 * path segment — so it guards the web root's own and nothing one directory
 * deeper. And each of those four turns "no PHP in the artifact" into nothing:
 *
 *   - `.user.ini` is PHP's own per-directory config under CGI/FastCGI, and
 *     `auto_prepend_file` in it runs an arbitrary file on every request to that
 *     directory. Straight to execution, no .php entry needed.
 *   - `.htaccess` can map any extension to the PHP handler, so a deployed
 *     `.txt` becomes code.
 *   - `.php5`, `.pht`, `.phtm` and friends are commonly mapped to PHP.
 *
 * It is post-authentication — a valid signature is still required — but the
 * whole point of refusing `.php` is to bound what a MISTAKEN or TAMPERED
 * artifact can do, and an artifact that can write `.user.ini` is unbounded.
 *
 * Matched on the BASENAME, so it holds at any depth, and used by BOTH the
 * entry check and the copy loop: those two see different strings — a zip entry
 * and a collapsed relative path — and a guard applied to only one of them is
 * the inert-layer failure this file has already had once.
 */
const DANGEROUS_NAMES = ['.htaccess', '.htpasswd', '.user.ini'];

function isDangerous(string $rel): bool {
    $rel  = ltrim(str_replace('\\', '/', $rel), '/');
    $base = strtolower(basename($rel));
    if ($base === '') return false;
    if (in_array($base, DANGEROUS_NAMES, true)) return true;
    // php, php3..php8, phps, phtml, phtm, pht, phar — plus the other handlers
    // a shared host routinely has enabled.
    return (bool) preg_match('/\.(php[0-9s]?|phtml?|pht|phar|cgi|pl|py|sh)$/', $base);
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
    // THE CAP HAS TO WATCH WHAT HAS ARRIVED, NOT WHAT WAS PROMISED.
    //
    // PHP hands this callback (handle, downloadTotal, downloaded, uploadTotal,
    // uploaded). It used to read only the SECOND argument — the total the
    // server declares in Content-Length — so an artifact host that answers
    // chunked, with no Content-Length, reports 0 and the 200 MB limit never
    // fires while the body streams to disk. codeload.github.com is one of the
    // three allow-listed hosts and it does exactly that for archives.
    //
    // Both are checked now: the declared total still aborts BEFORE the download
    // starts, which is the cheap case worth keeping, and the running count
    // stops a stream that never declared one.
    CURLOPT_PROGRESSFUNCTION => fn($r, $dlTotal, $dlNow) =>
        ($dlTotal > MAX_BYTES || $dlNow > MAX_BYTES) ? 1 : 0,
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
// IS THE ARCHIVE WRAPPED? Decided from the entries themselves, before any of
// them is judged, because the protected-path test below means a different thing
// in each case. A GitHub archive puts everything under one `wain-<sha>/`; a zip
// built by hand may not. "Every entry shares one leading directory" is the same
// condition the collapse after extraction uses, so the two cannot disagree.
$top = null;
$wrapped = $za->numFiles > 0;
for ($i = 0; $i < $za->numFiles; $i++) {
    $n = ltrim(str_replace('\\', '/', $za->getNameIndex($i)), '/');
    $slash = strpos($n, '/');
    $head = $slash === false ? $n : substr($n, 0, $slash);
    if ($top === null) { $top = $head; continue; }
    if ($head !== $top) { $wrapped = false; break; }
}
// A single file at the root shares its own name with nothing — that is not a
// wrapper, and treating it as one would strip the only path there is.
if ($wrapped && $za->numFiles === 1 && !str_contains(
        ltrim(str_replace('\\', '/', $za->getNameIndex(0)), '/'), '/')) {
    $wrapped = false;
}

// refuse traversal, absolute paths, protected paths and executable code
for ($i = 0; $i < $za->numFiles; $i++) {
    $n = $za->getNameIndex($i);
    if (str_contains($n, '..') || str_starts_with($n, '/')) {
        $za->close(); @unlink($zip);
        out(422, ['ok' => false, 'error' => 'unsafe_path', 'entry' => $n]);
    }
    if (isDangerous($n)) {
        $za->close(); @unlink($zip);
        out(422, ['ok' => false, 'error' => 'executable_in_artifact', 'entry' => $n]);
    }
    if (isProtectedEntry($n, $wrapped)) {
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
$failed = [];
$copied = 0;
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($stage, FilesystemIterator::SKIP_DOTS)
);
foreach ($it as $f) {
    if ($f->isDir()) continue;
    // A PREFIX STRIP, not str_replace. str_replace removes the staging path
    // from ANYWHERE in the string, so an artifact containing a directory whose
    // name happened to repeat it would have its path mangled rather than
    // trimmed. substr is what was meant, and it cannot match in the middle.
    $path = $f->getPathname();
    $rel  = str_starts_with($path, $stage) ? ltrim(substr($path, strlen($stage)), '/') : '';
    // An empty $rel now means "outside the staging directory", which is not a
    // file this endpoint may write anywhere. It was already skipped below; it
    // is worth keeping that way round rather than falling back to the full path.
    // isDangerous as well as isProtected, on the COLLAPSED path. The entry
    // loop above sees zip names; this sees what will actually be written, and
    // a guard on only one of the two is a guard on neither.
    if ($rel === '' || isProtected($rel) || isDangerous($rel)) continue;
    $dest = "$WEBROOT/$rel";
    $dir  = dirname($dest);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (@copy($f->getPathname(), $dest)) { $newManifest[] = $rel; $copied++; }
    else $failed[] = $rel;
}

/* ---------- 8b. a PARTIAL deploy must not be reported as a whole one -------
 *
 * `@copy` failing was silent: the file was skipped, `$copied` did not count it,
 * and the response said `ok: true` with a smaller number nobody would question.
 * Disk full or one bad permission is enough.
 *
 * AND THE PRUNE BELOW TURNS THAT INTO DATA LOSS. It deletes everything in the
 * OLD manifest that is not in the NEW one — so a file that failed to copy is
 * missing from the new manifest, and the still-good old copy is deleted for
 * being stale. The shop loses a file precisely because the replacement did not
 * arrive.
 *
 * So a failure stops here: the manifest is NOT rewritten (the old one still
 * describes what is really on disk), nothing is pruned, and the response says
 * what did not land. Some files have already been written — that cannot be
 * undone at this point and pretending otherwise would be the same lie in the
 * other direction — so it reports both numbers and names the failures.
 */
if ($failed) {
    rrmdir("$WORK/stage-$stamp");
    flock($lock, LOCK_UN); fclose($lock);
    logline('FAIL partial version=' . $version . ' wrote=' . $copied
          . ' failed=' . count($failed) . ' first=' . $failed[0]);
    out(500, [
        'ok'       => false,
        'error'    => 'partial_deploy',
        'deployed' => $copied,
        'failed'   => array_slice($failed, 0, 20),
        'note'     => 'nothing was pruned and the manifest was not updated',
    ]);
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
