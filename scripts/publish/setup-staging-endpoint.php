<?php
/**
 * Give staging.wainkw.com its own deploy endpoint, and stop production's from
 * ever writing into it.
 *
 *   wget -qO p.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/setup-staging-endpoint.php
 *   php p.php
 *
 * Two changes, both idempotent, because they are halves of one fact: staging's
 * document root is a directory INSIDE production's.
 *
 * 1. `staging` joins production's PROTECTED_PATHS. Nothing in the export is
 *    called that today, so this is not fixing a live fault — it is making sure
 *    an artifact that ever does contain it cannot overwrite the staging tree,
 *    and that the manifest prune cannot reach in.
 *
 * 2. A copy of deploy.php is generated at public_html/staging/api/deploy.php
 *    with three paths rewritten. It is GENERATED rather than hand-written so
 *    the two endpoints cannot drift: everything that has been fixed in
 *    production — the protected-path list, the host file, the directory prune —
 *    is inherited by construction, and re-running this after any future patch
 *    re-inherits it.
 *
 * WHY THOSE THREE PATHS
 *
 * deploy.php locates itself by `dirname(__DIR__, 2)`, which is correct only at
 * <domain>/public_html/api/. Copied to <domain>/public_html/staging/api/ that
 * resolves to public_html, and $WEBROOT becomes public_html/public_html — a
 * path that does not exist, so the copy would publish into nothing and report
 * success. Hence:
 *
 *     $ROOT    = dirname(__DIR__, 3)   <domain>/
 *     $WEBROOT = dirname(__DIR__)      <domain>/public_html/staging
 *     $WORK    = $STORAGE/deploy-staging
 *
 * $STORAGE is deliberately NOT changed. The secret is shared, so one
 * DEPLOY_SECRET in GitHub serves both endpoints — the same person deploying to
 * the same account, so nothing is widened by it. $WORK is separate because the
 * manifest is not shared: staging and production hold different builds, and one
 * manifest describing both would make each deploy's prune delete the other's
 * files. That is the single most destructive way this could be got wrong, and
 * it is why the line is here rather than left to inheritance.
 */

declare(strict_types=1);

$home  = getenv('HOME') ?: __DIR__;
$base  = $argv[1] ?? $home . '/domains/wainkw.com';
$prod  = $base . '/public_html/api/deploy.php';
$stageDir = $base . '/public_html/staging/api';
$stage = $stageDir . '/deploy.php';

$report = [];
function done(array $r): never { echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n"; exit; }

if (!is_readable($prod)) done(['ok' => false, 'error' => 'production_endpoint_not_found', 'path' => $prod]);
$src = (string) file_get_contents($prod);

/* ---------- 1. protect `staging` in production ---------- */
if (str_contains($src, "'staging'")) {
    $report['production'] = 'already_protected';
} else {
    $needle = "'storage', 'cgi-bin', '.well-known', 'config.php',";
    if (!str_contains($src, $needle)) {
        done(['ok' => false, 'error' => 'context_not_found', 'part' => 'PROTECTED_PATHS']);
    }
    $patched = str_replace(
        $needle,
        "'storage', 'cgi-bin', '.well-known', 'config.php',\n"
        . "    // staging.wainkw.com's document root is public_html/staging, so it is\n"
        . "    // inside this one. Nothing in the export is called that, but an\n"
        . "    // artifact that ever were would overwrite the staging site and the\n"
        . "    // prune would then delete it on the deploy after.\n"
        . "    'staging',",
        $src
    );
    if (!copy($prod, $prod . '.bak-staging')) done(['ok' => false, 'error' => 'backup_failed']);
    file_put_contents($prod, $patched);
    exec('php -l ' . escapeshellarg($prod) . ' 2>&1', $l1, $c1);
    if ($c1 !== 0) {
        copy($prod . '.bak-staging', $prod);
        done(['ok' => false, 'error' => 'lint_failed', 'part' => 'production', 'restored' => true, 'lint' => $l1]);
    }
    $src = $patched;
    $report['production'] = 'staging_protected';
}

/* ---------- 2. generate the staging endpoint ---------- */
$rewrites = [
    '$ROOT    = dirname(__DIR__, 2);            // <domain>/'
        => '$ROOT    = dirname(__DIR__, 3);            // <domain>/  — one deeper: this copy lives in public_html/staging/api',
    '$WEBROOT = $ROOT . \'/public_html\';'
        => '$WEBROOT = dirname(__DIR__);               // <domain>/public_html/staging',
    '$WORK    = $STORAGE . \'/deploy\';'
        => '$WORK    = $STORAGE . \'/deploy-staging\';  // NOT shared: one manifest for both would make each prune delete the other\'s files',
];
$out = $src;
foreach ($rewrites as $from => $to) {
    if (!str_contains($out, $from)) {
        done(['ok' => false, 'error' => 'context_not_found', 'part' => 'paths', 'missing' => $from, 'report' => $report]);
    }
    $out = str_replace($from, $to, $out);
}
$out = str_replace(
    ' * deploy.php — signed, verified, manifest-based static deploy endpoint.',
    " * deploy.php — signed, verified, manifest-based static deploy endpoint.\n"
    . " *\n"
    . " * GENERATED for staging.wainkw.com by scripts/publish/setup-staging-endpoint.php.\n"
    . " * Do not edit here: fix public_html/api/deploy.php and re-run that script, or\n"
    . " * the two endpoints drift and staging stops being a rehearsal of production.",
    $out
);

if (!is_dir($stageDir) && !@mkdir($stageDir, 0755, true)) {
    done(['ok' => false, 'error' => 'mkdir_failed', 'path' => $stageDir, 'report' => $report]);
}
$before = is_readable($stage) ? (string) file_get_contents($stage) : '';
if ($before === $out) {
    $report['staging'] = 'already_current';
} else {
    if ($before !== '') copy($stage, $stage . '.bak');
    if (file_put_contents($stage, $out) === false) {
        done(['ok' => false, 'error' => 'write_failed', 'path' => $stage, 'report' => $report]);
    }
    exec('php -l ' . escapeshellarg($stage) . ' 2>&1', $l2, $c2);
    if ($c2 !== 0) {
        if ($before !== '') file_put_contents($stage, $before); else @unlink($stage);
        done(['ok' => false, 'error' => 'lint_failed', 'part' => 'staging', 'restored' => true, 'lint' => $l2, 'report' => $report]);
    }
    $report['staging'] = $before === '' ? 'created' : 'regenerated';
}

done(['ok' => true, 'report' => $report, 'staging_endpoint' => $stage,
      'webroot' => $base . '/public_html/staging', 'work' => $base . '/storage/deploy-staging']);
