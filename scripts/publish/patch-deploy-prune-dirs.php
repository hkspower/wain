<?php
/**
 * Make public_html/api/deploy.php remove the directories its prune empties.
 *
 *   wget -qO p.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/patch-deploy-prune-dirs.php
 *   php p.php
 *
 * WHY
 *
 * Step 9 unlinks every file the new build stopped shipping and never rmdirs
 * what it emptied. Measured on the first two deploys through the endpoint: the
 * previous build's `_next/static/<40-hex>/` lost both its files and survived as
 * an empty directory, which then had to be removed by hand.
 *
 * One per deploy, and each is only an inode — nothing can be requested from an
 * empty directory, so this is tidiness rather than a fault. It is worth fixing
 * because of where it accumulates: a shared docroot that already holds another
 * application's eight directories, where a growing list of 40-character hex
 * names is exactly the litter somebody later has to identify before they dare
 * delete any of it. That has already happened here once.
 *
 * HOW, AND WHY IT IS SAFE
 *
 * Only directories the prune itself emptied are considered, walking up from
 * each removed file. `rmdir()` refuses a non-empty directory, so the failure
 * mode is "nothing happens" rather than "the wrong thing is deleted" — and the
 * walk stops at the first refusal, at the web root, and at any PROTECTED_PATHS
 * entry, so it can never climb out of the export or into the PHP app.
 *
 * Idempotent: run it twice and the second run reports already_patched.
 * Self-healing: if the result does not lint, the backup is restored.
 */

declare(strict_types=1);

$home = getenv('HOME') ?: __DIR__;
$file = $argv[1] ?? $home . '/domains/wainkw.com/public_html/api/deploy.php';
$bak  = $file . '.bak-prunedirs';

function done(array $r): never { echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n"; exit; }

if (!is_readable($file)) done(['ok' => false, 'error' => 'not_found', 'file' => $file]);
$src = (string) file_get_contents($file);

$oldPrune = <<<'PHP'
$removed = 0;
foreach (array_diff($old, $newManifest) as $gone) {
    if (isProtected($gone)) continue;
    if (@unlink("$WEBROOT/$gone")) $removed++;
}
PHP;

$newPrune = <<<'PHP'
$removed = 0;
$emptied = 0;
foreach (array_diff($old, $newManifest) as $gone) {
    if (isProtected($gone)) continue;
    if (@unlink("$WEBROOT/$gone")) $removed++;
}

// unlink() leaves the directory behind, so before this the previous build's
// _next/static/<sha>/ survived every deploy as an empty shell and had to be
// removed by hand. Only directories this prune emptied are considered: the
// walk starts at a removed file and climbs, and rmdir() refuses anything that
// still has contents, so the failure mode is "nothing happens". It stops at
// the first refusal, at the web root, and at any protected path, so it cannot
// climb out of the export or into the other application's directories.
foreach (array_diff($old, $newManifest) as $gone) {
    if (isProtected($gone)) continue;
    $dir = dirname("$WEBROOT/$gone");
    while (str_starts_with($dir, $WEBROOT . '/')) {
        $rel = trim(substr($dir, strlen($WEBROOT)), '/');
        if ($rel === '' || isProtected($rel)) break;
        if (!@rmdir($dir)) break;
        $emptied++;
        $dir = dirname($dir);
    }
}
PHP;

if (str_contains($src, '$emptied')) done(['ok' => true, 'status' => 'already_patched']);
if (!str_contains($src, $oldPrune)) {
    done(['ok' => false, 'error' => 'context_not_found',
          'hint' => "step 9 does not match the copy this patch was written against; re-read deploy.php"]);
}

$oldLog = 'logline("OK version=$version files=$copied removed=$removed sha=$sha");';
$newLog = 'logline("OK version=$version files=$copied removed=$removed dirs=$emptied sha=$sha");';

$oldOut = <<<'PHP'
    'removed'  => $removed,
    'at'       => gmdate('c'),
PHP;
$newOut = <<<'PHP'
    'removed'  => $removed,
    'emptied'  => $emptied,
    'at'       => gmdate('c'),
PHP;

foreach ([[$oldLog, 'logline'], [$oldOut, 'response']] as [$needle, $what]) {
    if (!str_contains($src, $needle)) done(['ok' => false, 'error' => 'context_not_found', 'part' => $what]);
}

$out = str_replace([$oldPrune, $oldLog, $oldOut], [$newPrune, $newLog, $newOut], $src);

if (!copy($file, $bak)) done(['ok' => false, 'error' => 'backup_failed']);
if (file_put_contents($file, $out) === false) done(['ok' => false, 'error' => 'write_failed']);

// A syntax error here kills the only deploy path the site has.
exec('php -l ' . escapeshellarg($file) . ' 2>&1', $lintOut, $lintCode);
if ($lintCode !== 0) {
    copy($bak, $file);
    done(['ok' => false, 'error' => 'lint_failed', 'restored' => true, 'lint' => $lintOut]);
}

done(['ok' => true, 'status' => 'patched', 'backup' => $bak, 'lint' => trim(implode(' ', $lintOut))]);
