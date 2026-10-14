<?php
/**
 * restore-production-endpoint.php — put wain's own api/deploy.php back on
 * production, rebuilt from the copy staging was generated from.
 *
 * Why this exists: on 14 October production's public_html/api/deploy.php was
 * replaced by a scope-based endpoint (images / css / code, its own manifests
 * and rollback) that is not in this repository, and the planned deploy was
 * refused with bad_scope. The repository never tracked wain's production file:
 * the patch scripts edit it in place on the server, and
 * setup-staging-endpoint.php builds staging's copy FROM it. So staging's copy
 * is the only copy of the patched endpoint left. This reverses the generator's
 * path rewrites and header insert to get production's file back.
 *
 * It changes nothing it cannot check. It refuses to replace anything but the
 * scope endpoint. The rebuilt file must reproduce staging's copy byte for byte
 * through the generator's own forward transform, must be the recorded
 * production size (10,985 bytes, 28 September), and must lint. The scope
 * endpoint is kept in storage/ first, so it can be put back. One-shot: fetched
 * from a pinned commit, run once, then deleted.
 *
 * Usage: php restore-production-endpoint.php [<domain directory>]
 */

declare(strict_types=1);

$home = getenv('HOME') ?: __DIR__;
$base = $argv[1] ?? $home . '/domains/wainkw.com';
$prod = $base . '/public_html/api/deploy.php';
$stage = $base . '/public_html/staging/api/deploy.php';
$storage = $base . '/storage';
$backup = $storage . '/deploy-scope-endpoint.backup.txt';
$tmp = $storage . '/deploy-restore.tmp';
$expect = (int) (getenv('RESTORE_EXPECT_BYTES') ?: 10985);

// Only the replacement carries this line. Anything else in place is refused.
const SCOPE_MARKER = 'Three independent deploy stages';

// The title line both files share, and the block the generator inserts after it.
const TITLE = ' * deploy.php — signed, verified, manifest-based static deploy endpoint.';
const NOTICE = "\n *\n * GENERATED for staging.wainkw.com by scripts/publish/setup-staging-endpoint.php.\n"
    . " * Do not edit here: fix public_html/api/deploy.php and re-run that script, or\n"
    . " * the two endpoints drift and staging stops being a rehearsal of production.";

// Production text => staging text, exactly as setup-staging-endpoint.php writes them.
const PRODUCTION_TO_STAGING = [
    '$ROOT    = dirname(__DIR__, 2);            // <domain>/'
        => '$ROOT    = dirname(__DIR__, 3);            // <domain>/  — one deeper: this copy lives in public_html/staging/api',
    '$WEBROOT = $ROOT . \'/public_html\';'
        => '$WEBROOT = dirname(__DIR__);               // <domain>/public_html/staging',
    '$WORK    = $STORAGE . \'/deploy\';'
        => '$WORK    = $STORAGE . \'/deploy-staging\';  // NOT shared: one manifest for both would make each prune delete the other\'s files',
];

function done(array $r): never {
    echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    exit(($r['ok'] ?? false) ? 0 : 1);
}

/** The generator's forward transform: production text in, staging text out. */
function forward(string $production): string {
    $out = $production;
    foreach (PRODUCTION_TO_STAGING as $from => $to) {
        if (!str_contains($out, $from)) return '';
        $out = str_replace($from, $to, $out);
    }
    return str_replace(TITLE, TITLE . NOTICE, $out);
}

/** The inverse: staging text in, production text out, or null if a part is missing. */
function reverse(string $staging): ?string {
    if (!str_contains($staging, TITLE . NOTICE)) return null;
    $out = str_replace(TITLE . NOTICE, TITLE, $staging);
    foreach (PRODUCTION_TO_STAGING as $productionPart => $stagingPart) {
        if (!str_contains($out, $stagingPart)) return null;
        $out = str_replace($stagingPart, $productionPart, $out);
    }
    return $out;
}

if (!is_readable($stage)) done(['ok' => false, 'error' => 'staging_copy_not_found', 'path' => $stage]);
if (!is_readable($prod)) done(['ok' => false, 'error' => 'production_file_not_found', 'path' => $prod]);

$current = (string) file_get_contents($prod);
$generated = (string) file_get_contents($stage);

$rebuilt = reverse($generated);
if ($rebuilt === null) done(['ok' => false, 'error' => 'staging_copy_not_recognised', 'why' => 'a rewrite or the header block is missing']);
if (forward($rebuilt) !== $generated) done(['ok' => false, 'error' => 'round_trip_mismatch']);
if (strlen($rebuilt) !== $expect) done(['ok' => false, 'error' => 'size_mismatch', 'bytes' => strlen($rebuilt), 'expected' => $expect]);

if ($current === $rebuilt) {
    done(['ok' => true, 'status' => 'already_restored', 'bytes' => strlen($rebuilt), 'sha256' => hash('sha256', $rebuilt)]);
}
if (!str_contains($current, SCOPE_MARKER)) {
    done(['ok' => false, 'error' => 'refusing_to_overwrite', 'why' => 'the file in place is not the scope endpoint', 'bytes' => strlen($current)]);
}

if (!copy($prod, $backup) || filesize($backup) !== strlen($current)) {
    done(['ok' => false, 'error' => 'backup_failed', 'path' => $backup]);
}

if (file_put_contents($tmp, $rebuilt) !== strlen($rebuilt)) done(['ok' => false, 'error' => 'write_failed', 'path' => $tmp]);
exec('php -l ' . escapeshellarg($tmp) . ' 2>&1', $lint, $code);
if ($code !== 0) {
    @unlink($tmp);
    done(['ok' => false, 'error' => 'lint_failed', 'lint' => $lint]);
}
chmod($tmp, 0644);
// Same filesystem, so the rename replaces the file in one step: no half-written endpoint is ever served.
if (!rename($tmp, $prod)) done(['ok' => false, 'error' => 'rename_failed', 'path' => $prod, 'backup' => $backup]);
if ((string) file_get_contents($prod) !== $rebuilt) done(['ok' => false, 'error' => 'readback_mismatch', 'path' => $prod]);

done([
    'ok' => true,
    'status' => 'restored',
    'bytes' => strlen($rebuilt),
    'sha256' => hash('sha256', $rebuilt),
    'replaced_bytes' => strlen($current),
    'backup' => $backup,
    'backup_bytes' => filesize($backup),
]);
