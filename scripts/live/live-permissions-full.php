<?php
/**
 * A WIDER permissions audit — READ-ONLY, changes nothing, prints no file content.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-permissions-full.php && php r.php
 *
 * live-permissions-check.php asks about a NAMED list and sweeps the docroot for world-write.
 * That cannot see the general cases, so this walks the WHOLE domain folder (public_html AND
 * everything beside it: storage, invoices, logs, wallet-certs, backups) and the account's home
 * directory one level down, and reports by CATEGORY with a count and up to five example paths:
 *
 *   world-writable      mode & 0002 — anyone on the machine can change it
 *   group-writable      mode & 0020 — on shared hosting the group is not only us
 *   secret-readable     a file that looks like a credential/data store (config*, *.secret, *.pem,
 *                       *.key, *.sql, *.log, .env*, *.bak, *.zip, wallet-certs, invoices) with
 *                       world-read — the filesystem is the only thing defending it
 *   exposed-secret      the same kinds of file INSIDE public_html, where a URL may reach them
 *   exec-bit-data       the execute bit on a non-script file (images, css, json, html...)
 *   php-in-data-dir     a .php/.phtml/.php5/.pht file under images/ cats/ hero/ fonts/ invoices/
 *                       — upload folders must never hold something the web server will run
 *   dotfiles            .env, .git, .svn, .DS_Store, .user.ini, .htpasswd in or under the docroot
 *   too-open-dir        a directory with 0777 (or world-write + no sticky)
 *   scratch-scripts     stray one-off scripts left in the docroot (r.php, c.php, p.php, d.php,
 *                       test.php, info.php, phpinfo.php, adminer*.php, shell*.php)
 *
 * The expected modes on Hostinger shared hosting are 0644 for files and 0755 for directories;
 * secrets 0600. It prints a MODE HISTOGRAM first so the baseline is visible, and `walked` so a
 * run that saw nothing cannot read as a clean one.
 */

$HOME = getenv('PERM_HOME') ?: '/home/u130124229';   // PERM_HOME is for the local test only
$ROOT = $HOME . '/domains/sporta.com.kw';
$DOC  = $ROOT . '/public_html';

$cat = [];
$add = static function (string $k, string $path) use (&$cat): void {
    $cat[$k][] = $path;
};
$hist = ['file' => [], 'dir' => []];
$walked = 0;
$unreadable = [];

$SECRET_RE = '/(^|\/)(config[^\/]*\.php|\.env[^\/]*|[^\/]*\.(secret|pem|key|p12|pfx|cer|crt|sql|log|bak|old|orig|zip|gz|tar|rar|7z|swp|sqlite|db))$|\/wallet-certs\/|\/invoices\//i';
$SCRIPT_EXT = '/\.(php|phtml|php5|pht|sh|py|pl|cgi)$/i';
$DATA_DIRS  = '/(^|\/)(images|cats|hero|fonts|invoices|uploads)\//i';
$SCRATCH_RE = '/(^|\/)(r|c|p|d|t|x|test|info|phpinfo|adminer[^\/]*|shell[^\/]*|backdoor[^\/]*|wso[^\/]*|c99[^\/]*|up|upload|cmd)\.php$/i';

$walk = static function (string $base, int $maxDepth) use (&$walked, &$unreadable, &$hist, $add, $DOC, $SECRET_RE, $SCRIPT_EXT, $DATA_DIRS, $SCRATCH_RE): void {
    $stack = [[$base, 0]];
    while ($stack) {
        [$dir, $depth] = array_pop($stack);
        $items = @scandir($dir);
        if ($items === false) { $unreadable[] = $dir; continue; }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $full = $dir . '/' . $item;
            if (is_link($full)) continue;
            $perm = @fileperms($full);
            if ($perm === false) continue;
            $walked++;
            $isDir = is_dir($full);
            $mode = $perm & 07777;
            $o = sprintf('%04o', $mode);
            $hist[$isDir ? 'dir' : 'file'][$o] = ($hist[$isDir ? 'dir' : 'file'][$o] ?? 0) + 1;
            $inDoc = strpos($full, $DOC . '/') === 0 || $full === $DOC;
            $rel = $inDoc ? 'public_html' . substr($full, strlen($DOC)) : substr($full, strlen($GLOBALS['ROOT']));
            if ($mode & 0002) $add('world-writable', "$rel=$o");
            if ($mode & 0020) $add('group-writable', "$rel=$o");
            if ($isDir && ($mode & 0777) === 0777) $add('too-open-dir', "$rel=$o");
            if (!$isDir) {
                $secretLike = preg_match($SECRET_RE, $full) === 1;
                if ($secretLike && ($mode & 0004)) $add($inDoc ? 'exposed-secret' : 'secret-readable', "$rel=$o");
                if (($mode & 0111) && !preg_match($SCRIPT_EXT, $item)) $add('exec-bit-data', "$rel=$o");
                if ($inDoc && preg_match($SCRIPT_EXT, $item) && preg_match($DATA_DIRS, $full)) $add('php-in-data-dir', "$rel=$o");
                if ($inDoc && preg_match($SCRATCH_RE, $full)) $add('scratch-scripts', "$rel=$o");
                if (preg_match('/^\.(env.*|git.*|svn|DS_Store|user\.ini|htpasswd)$/i', $item)) $add('dotfiles', "$rel=$o");
            } else {
                if (preg_match('/^\.(git|svn)$/', $item)) $add('dotfiles', "$rel/=$o");
            }
            if ($isDir && $depth < $maxDepth) $stack[] = [$full, $depth + 1];
        }
    }
};

// The domain folder, deep (public_html is the biggest part of it) ...
$walk($ROOT, 8);
// ... and the account home, shallow, EXCLUDING the domain tree already done and other sites'
// folders (they are not this shop's to judge, and they hold a different project's files).
foreach ((@scandir($HOME) ?: []) as $item) {
    if ($item === '.' || $item === '..' || $item === 'domains') continue;
    $full = $HOME . '/' . $item;
    if (is_link($full)) continue;
    $perm = @fileperms($full);
    if ($perm === false) continue;
    $walked++;
    $mode = $perm & 07777; $o = sprintf('%04o', $mode); $isDir = is_dir($full);
    $rel = '~/' . $item;
    $hist[$isDir ? 'dir' : 'file'][$o] = ($hist[$isDir ? 'dir' : 'file'][$o] ?? 0) + 1;
    if ($mode & 0002) $add('world-writable', "$rel=$o");
    if ($mode & 0020) $add('group-writable', "$rel=$o");
    if (!$isDir && preg_match($GLOBALS['SECRET_RE'] ?? $SECRET_RE, $full) && ($mode & 0004)) $add('secret-readable', "$rel=$o");
    if (preg_match('/^\.(env.*|git.*|ssh|aws|npmrc|bash_history|mysql_history|netrc)$/i', $item) && ($mode & 0044)) $add('home-dotfile-readable', "$rel=$o");
}

ksort($hist['file']); ksort($hist['dir']);
$h = static function (array $a): string { $o = []; foreach ($a as $m => $n) $o[] = "$m:$n"; return implode(' ', $o); };
echo 'WALKED ' . $walked . ' unreadable=' . count($unreadable) . "\n";
echo 'MODES files ' . $h($hist['file']) . "\n";
echo 'MODES dirs  ' . $h($hist['dir']) . "\n";
$order = ['world-writable', 'too-open-dir', 'exposed-secret', 'secret-readable', 'php-in-data-dir', 'scratch-scripts', 'dotfiles', 'home-dotfile-readable', 'group-writable', 'exec-bit-data'];
$bad = 0;
foreach ($order as $k) {
    $n = count($cat[$k] ?? []);
    echo sprintf('%-22s %d', $k, $n);
    if ($n) { echo '  e.g. ' . implode(' ; ', array_slice($cat[$k], 0, 5)); if (in_array($k, ['world-writable', 'too-open-dir', 'exposed-secret', 'secret-readable', 'php-in-data-dir'], true)) $bad += $n; }
    echo "\n";
}
if ($unreadable) echo 'UNREADABLE ' . implode(' ; ', array_slice($unreadable, 0, 5)) . "\n";
echo 'VERDICT serious=' . $bad . "\n";
