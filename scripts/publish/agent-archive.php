<?php
/**
 * شوق and سالم, kept on wain's own server — a private copy of everything
 * ElevenLabs holds for the agent (docs/agent-live/ in this repository).
 *
 *   php a.php install <commit>   fetch every file of docs/agent-live at <commit>
 *                                into <domain>/storage/agent-live/, verified
 *   php a.php verify             re-hash what is on disk against its manifest
 *
 * WHERE, AND WHY THERE. `storage/` is outside the document root, so nothing
 * here is a URL — the prompt, the tests and the knowledge base are not meant
 * for visitors. It is also the one directory deploy.php never prunes, so a site
 * deploy cannot delete the copy. Files 0600, directories 0700: the web PHP runs
 * as the account user (CLAUDE.md, «storage/ was audited»), so nothing that
 * needs them is locked out.
 *
 * HOW. Nothing can be pushed to this account from a session; the server pulls.
 * It fetches MANIFEST.json and then each file it lists from a commit-pinned
 * raw URL, and refuses any file whose sha256 differs from the manifest — the
 * same «verify before writing» rule deploy.php applies to an artifact. Files
 * land under a temporary directory and replace the old copy only once all of
 * them have verified, so a failed fetch leaves the previous copy whole.
 *
 * Run once and delete (fetch-pin-run). It holds no secret.
 */

declare(strict_types=1);

const REPO = 'https://raw.githubusercontent.com/hkspower/wain';
const SUBDIR = 'docs/agent-live';

function out(array $r): void {
    echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
}

function target(): string {
    $home = getenv('HOME') ?: dirname(__DIR__);
    $storage = "$home/domains/wainkw.com/storage";
    if (!is_dir($storage)) {
        out(['ok' => false, 'error' => 'no_storage', 'looked' => $storage]);
        exit(1);
    }
    return "$storage/agent-live";
}

function fetch(string $url): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_USERAGENT => 'wain-agent-archive',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ($body !== false && $code === 200) ? $body : null;
}

/** A manifest path may not climb out of the copy. */
function safePath(string $p): bool {
    return $p !== '' && $p[0] !== '/' && !str_contains($p, '..') && !str_contains($p, "\0")
        && preg_match('#^[A-Za-z0-9._/-]+$#', $p) === 1;
}

function rmTree(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) ?: [] as $n) {
        if ($n === '.' || $n === '..') continue;
        $p = "$dir/$n";
        is_dir($p) && !is_link($p) ? rmTree($p) : @unlink($p);
    }
    @rmdir($dir);
}

function install(string $commit): void {
    if (preg_match('/^[0-9a-f]{40}$/', $commit) !== 1) {
        out(['ok' => false, 'error' => 'commit_must_be_40_hex']);
        exit(1);
    }
    // WAIN_ARCHIVE_REPO is a test seam: the suite serves the tree locally.
    $base = (getenv('WAIN_ARCHIVE_REPO') ?: REPO) . "/$commit/" . SUBDIR;
    $manifestText = fetch("$base/MANIFEST.json");
    $manifest = $manifestText === null ? null : json_decode($manifestText, true);
    if (!is_array($manifest) || !isset($manifest['files']) || !is_array($manifest['files'])) {
        out(['ok' => false, 'error' => 'manifest_unreadable', 'url' => "$base/MANIFEST.json"]);
        exit(1);
    }

    $dest = target();
    $tmp = "$dest.tmp-" . getmypid();
    rmTree($tmp);
    @mkdir($tmp, 0700, true);

    $bad = [];
    $bytes = 0;
    foreach ($manifest['files'] as $f) {
        $path = (string) ($f['path'] ?? '');
        if (!safePath($path)) { $bad[] = ['path' => $path, 'why' => 'unsafe_path']; continue; }
        $body = fetch("$base/$path");
        if ($body === null) { $bad[] = ['path' => $path, 'why' => 'fetch_failed']; continue; }
        if (hash('sha256', $body) !== ($f['sha256'] ?? '') || strlen($body) !== (int) ($f['bytes'] ?? -1)) {
            $bad[] = ['path' => $path, 'why' => 'hash_mismatch', 'got' => strlen($body)];
            continue;
        }
        $to = "$tmp/$path";
        if (!is_dir(dirname($to))) mkdir(dirname($to), 0700, true);
        file_put_contents($to, $body);
        chmod($to, 0600);
        $bytes += strlen($body);
    }

    if ($bad) {
        rmTree($tmp);
        out(['ok' => false, 'error' => 'not_installed', 'failed' => $bad,
             'note' => 'the previous copy, if any, is untouched']);
        exit(1);
    }

    file_put_contents("$tmp/MANIFEST.json", $manifestText);
    chmod("$tmp/MANIFEST.json", 0600);
    file_put_contents("$tmp/SOURCE.txt", "$base\n" . gmdate('c') . "\n");
    chmod("$tmp/SOURCE.txt", 0600);

    $old = "$dest.old-" . getmypid();
    if (is_dir($dest)) rename($dest, $old);
    rename($tmp, $dest);
    chmod($dest, 0700);
    rmTree($old);

    out(['ok' => true, 'dir' => $dest, 'files' => count($manifest['files']), 'bytes' => $bytes,
         'commit' => $commit]);
}

function verify(): void {
    $dest = target();
    $m = json_decode((string) @file_get_contents("$dest/MANIFEST.json"), true);
    if (!is_array($m) || !isset($m['files'])) {
        out(['ok' => false, 'error' => 'not_installed', 'dir' => $dest]);
        exit(1);
    }
    $bad = [];
    foreach ($m['files'] as $f) {
        $p = "$dest/" . $f['path'];
        if (!is_file($p) || hash_file('sha256', $p) !== $f['sha256']) $bad[] = $f['path'];
    }
    out(['ok' => !$bad, 'dir' => $dest, 'files' => count($m['files']), 'bad' => $bad,
         'source' => trim((string) @file_get_contents("$dest/SOURCE.txt")),
         'mode' => substr(sprintf('%o', fileperms($dest)), -4)]);
    exit($bad ? 1 : 0);
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$cmd = $argv[1] ?? '';
if ($cmd === 'install') install($argv[2] ?? '');
elseif ($cmd === 'verify') verify();
else { out(['usage' => 'php a.php install <40-hex commit> | php a.php verify']); exit(1); }
