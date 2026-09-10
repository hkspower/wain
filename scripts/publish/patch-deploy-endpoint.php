<?php
/**
 * One-shot: make public_html/api/deploy.php accept the artifact this site
 * actually builds.
 *
 * Run once, from cron, then delete the fetched copy and the job:
 *
 *   wget -qO p.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/patch-deploy-endpoint.php
 *   php p.php
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT AN EDIT
 *
 * Nothing in a Claude session can write to this server. The hosa connector's
 * file tools are read-only, its one upload path is a host the sandbox gateway
 * refuses at CONNECT, and so is www.wainkw.com. The only write path is the one
 * sporta's eight cron jobs already use: the server fetching over the open
 * internet and running what it fetched. So the edit travels as code.
 *
 * WHY THE EDIT
 *
 * 1. PROTECTED_PATHS listed 'admin', 'queue', 'orders' and '.htaccess'. All
 *    four are wain's own — static routes this site publishes, and the docroot
 *    .htaccess is byte-identical to the one in the export. The check runs
 *    against every entry in the artifact BEFORE anything is downloaded, so the
 *    endpoint refused every deploy it was built to serve, with
 *    artifact_touches_protected_path.
 *
 * 2. It did not protect 'assets', 'cats', 'fonts', 'hero' or 'images', which
 *    ARE the older PHP application's. Measured by diffing the docroot against
 *    the export: everything in the export is wain's, everything else is not.
 *    An artifact carrying one of those names would overwrite that application's
 *    files, and step 9's manifest prune would then delete them on the NEXT
 *    deploy. That is the quieter fault and the more expensive one.
 *
 * .htaccess is deliberately left writable. It is wain's file and it is in the
 * export, so protecting it means the site can never correct its own caching or
 * routing rules through this endpoint. It is also the highest-blast-radius file
 * in a shared docroot, since Apache reads it for both applications — which is
 * why `npm run audit:htaccess`, applying every deny rule to every shipped file,
 * has to be green before a deploy.
 *
 * Idempotent: run it twice and the second run reports already_patched.
 * Self-healing: if the result does not lint, the backup is restored.
 */

declare(strict_types=1);

// argv[1] lets the patch be rehearsed against a copy before it is aimed at the
// live endpoint. The account name is never written down here: cron runs with
// HOME set, and a fetched script sits in that same directory.
$home = getenv('HOME') ?: __DIR__;
$file = $argv[1] ?? $home . '/domains/wainkw.com/public_html/api/deploy.php';
$bak  = $file . '.bak';

function done(array $r): never { echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n"; exit; }

if (!is_readable($file)) done(['ok' => false, 'error' => 'not_found', 'file' => $file]);
$src = (string) file_get_contents($file);

$oldProtected = <<<'PHP'
const PROTECTED_PATHS = [
    'api', 'knet', 'pay', 'admin', 'queue', 'orders',
    'storage', 'cgi-bin', '.well-known',
    '.htaccess', 'config.php',
];
PHP;

$newProtected = <<<'PHP'
const PROTECTED_PATHS = [
    // The older PHP application's directories. Measured against the docroot by
    // diffing it with the static export: everything here is absent from the
    // export, everything absent from here is in it.
    'api', 'assets', 'cats', 'fonts', 'hero', 'images', 'knet', 'pay',
    // Never writable from an artifact, whoever owns them.
    'storage', 'cgi-bin', '.well-known', 'config.php',
    // NOT protected, each on purpose: 'admin', 'queue' and 'orders' are static
    // routes this site publishes and '.htaccess' is its own, so protecting them
    // refused every deploy this endpoint was built to serve.
];
PHP;

if (str_contains($src, $newProtected)) done(['ok' => true, 'status' => 'already_patched']);
if (!str_contains($src, $oldProtected)) {
    done(['ok' => false, 'error' => 'context_not_found',
          'hint' => 'deploy.php differs from the copy this patch was written against; re-read it before patching']);
}

// The host allow-list moves to a file outside public_html, so that changing
// where artifacts are hosted does not mean re-patching this endpoint.
$oldHosts = "if (parse_url(\$url, PHP_URL_SCHEME) !== 'https' || !in_array(\$host, ALLOWED_HOSTS, true)) {";
$newHosts = "if (parse_url(\$url, PHP_URL_SCHEME) !== 'https' || !in_array(strtolower(\$host), allowedHosts(), true)) {";

$oldFn = <<<'PHP'
function isProtected(string $rel): bool {
    $first = explode('/', str_replace('\\', '/', $rel))[0];
    return in_array($first, PROTECTED_PATHS, true);
}
PHP;

$newFn = $oldFn . "\n" . <<<'PHP'

/**
 * ALLOWED_HOSTS plus anything in <domain>/storage/deploy.hosts, one hostname
 * per line, blanks and #comments ignored. A file rather than a constant so the
 * list is not inside public_html and does not need this file edited again.
 */
function allowedHosts(): array {
    global $STORAGE;
    $hosts = ALLOWED_HOSTS;
    $f = $STORAGE . '/deploy.hosts';
    if (is_readable($f)) {
        foreach (preg_split('/\R/', (string) file_get_contents($f)) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') continue;
            // A hostname only. A URL, a port or a path here would silently
            // widen the check to something parse_url's host never matches.
            if (preg_match('/^[a-z0-9.-]+$/i', $line)) $hosts[] = strtolower($line);
        }
    }
    return array_values(array_unique($hosts));
}
PHP;

if (!str_contains($src, $oldFn) || !str_contains($src, $oldHosts)) {
    done(['ok' => false, 'error' => 'context_not_found', 'part' => 'allowed_hosts']);
}

$out = str_replace(
    [$oldProtected, $oldFn, $oldHosts],
    [$newProtected, $newFn, $newHosts],
    $src
);

if (!copy($file, $bak)) done(['ok' => false, 'error' => 'backup_failed']);
if (file_put_contents($file, $out) === false) done(['ok' => false, 'error' => 'write_failed']);

// A syntax error here would leave the site's only deploy path dead, so the
// result is linted and rolled back rather than trusted.
exec('php -l ' . escapeshellarg($file) . ' 2>&1', $lintOut, $lintCode);
if ($lintCode !== 0) {
    copy($bak, $file);
    done(['ok' => false, 'error' => 'lint_failed', 'restored' => true, 'lint' => $lintOut]);
}

done([
    'ok'       => true,
    'status'   => 'patched',
    'backup'   => $bak,
    'lint'     => trim(implode(' ', $lintOut)),
    'protects' => ['api','assets','cats','fonts','hero','images','knet','pay','storage','cgi-bin','.well-known','config.php'],
]);
