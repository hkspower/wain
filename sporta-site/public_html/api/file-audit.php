<?php
/**
 * What is actually on this server, and what should not be.
 *
 *   https://www.sporta.com.kw/api/file-audit.php?key=<cron_key>
 *
 * WHY THIS EXISTS. Everything else in scripts/ inspects the copy of the site in
 * a developer's checkout. Nothing could look at the SERVER — this host has no
 * shell, SSH is off permanently, and hPanel's File Manager shows a folder at a
 * time with no hashes and no idea what is supposed to be there. So "is anything
 * damaged, and is anything on my server that should not be" was a question with
 * no way to ask it.
 *
 * It answers four things, and each is a different kind of wrong:
 *
 *   MISSING     a file the shop needs is not here. A half-finished upload.
 *   CHANGED     a file is here but is not the one that was shipped. Edited by
 *               hand, truncated mid-upload, or replaced by something else.
 *   UNEXPECTED  a file is here that the shipped site does not contain. Usually
 *               harmless leftovers; occasionally a backup with credentials in
 *               it, or something somebody else put there.
 *   DANGEROUS   an unexpected file of a kind that must never be on a web
 *               server: a database dump, an archive, a backup of a config, an
 *               editor's crash file, an installer. These are listed separately
 *               and first, because they are the ones to act on today.
 *
 * GATED BY cron_key, like every other endpoint here that is not for customers.
 * A file listing is a map of the server, and a map is worth having only to the
 * person who owns it.
 *
 * IT WRITES NOTHING AND DELETES NOTHING. It reads names and hashes and prints
 * them. Deleting is a decision for a person looking at the list, and hPanel's
 * File Manager is where they do it.
 *
 * THE MANIFEST. scripts/site-manifest.txt lists every shipped file with its
 * sha256. Upload it beside this script as api/site-manifest.txt. Without it
 * this still reports UNEXPECTED and DANGEROUS files — the useful half — and
 * says plainly that it cannot check for damage.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals((string) $cfg['cron_key'], (string) ($_GET['key'] ?? ''))) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("forbidden\n");
}

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$root = dirname(__DIR__);            // public_html
$manifestFile = __DIR__ . '/site-manifest.txt';

// Files that live on a working server and are NOT in the shipped package, by
// design. Listing them as unexpected every run would train the reader to skim.
//
//   config.php      the live credentials; never in a package, always on a server
//   *.log           the payment logs, if they were ever pointed inside the root
//   .well-known     Let's Encrypt and Apple's app-association files
//   cgi-bin, .git   hosting furniture
$EXPECTED_EXTRA = [
    '#(^|/)config\.php$#',
    '#(^|/)\.well-known(/|$)#',
    '#(^|/)cgi-bin(/|$)#',
    '#(^|/)\.(git|htpasswd)(/|$)#',
    '#(^|/)site-manifest\.txt$#',
    '#(^|/)file-audit\.php$#',
];

// The ones worth waking up for. A web root is not a filing cabinet.
$DANGEROUS = [
    '#\.(sql|sqlite|db|dump)$#i'      => 'a database dump — readable by anyone who guesses the name',
    '#\.(zip|tar|gz|tgz|rar|7z)$#i'   => 'an archive — usually a backup of the whole site',
    '#\.(bak|old|orig|save|swp|swo|tmp|copy)$#i' => 'a backup or an editor crash file',
    '#~$#'                            => 'an editor backup file',
    '#\.(env|pem|key|p12|pfx)$#i'     => 'a credential file',
    '#(^|/)(setup|install|reset|preflight|adminer|phpinfo|test|info)[^/]*\.php$#i'
                                      => 'an installer, a probe, or a diagnostic page',
    '#(^|/)\.(DS_Store|_darcs)#'      => 'operating-system clutter',
];

/** Every file under public_html, as paths relative to it. */
function walk(string $dir, string $base, array &$out): void {
    $dh = @opendir($dir);
    if ($dh === false) return;
    while (($e = readdir($dh)) !== false) {
        if ($e === '.' || $e === '..') continue;
        $full = $dir . '/' . $e;
        $rel = ltrim(substr($full, strlen($base)), '/');
        if (is_dir($full)) { walk($full, $base, $out); continue; }
        $out[$rel] = is_readable($full) ? (string) @filesize($full) : '?';
    }
    closedir($dh);
}

$onDisk = [];
walk($root, $root, $onDisk);
ksort($onDisk);

$manifest = [];
if (is_readable($manifestFile)) {
    foreach (file($manifestFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        // "<sha256>  <path>", the format shasum and sha256sum both write.
        if (preg_match('/^([0-9a-f]{64})\s+(.+)$/', trim($line), $m)) $manifest[$m[2]] = $m[1];
    }
}

$expected = static function (string $rel) use ($EXPECTED_EXTRA): bool {
    foreach ($EXPECTED_EXTRA as $re) if (preg_match($re, $rel)) return true;
    return false;
};

$missing = []; $changed = []; $unexpected = []; $dangerous = [];

foreach ($manifest as $rel => $want) {
    if (!isset($onDisk[$rel])) { $missing[] = $rel; continue; }
    $got = @hash_file('sha256', $root . '/' . $rel);
    if ($got === false) { $changed[] = "$rel (unreadable)"; continue; }
    if (!hash_equals($want, $got)) $changed[] = $rel;
}

foreach ($onDisk as $rel => $size) {
    if (isset($manifest[$rel]) || $expected($rel)) continue;
    $why = null;
    foreach ($DANGEROUS as $re => $reason) if (preg_match($re, $rel)) { $why = $reason; break; }
    if ($why !== null) $dangerous[] = [$rel, $size, $why];
    else $unexpected[] = [$rel, $size];
}

$kb = static fn ($b) => is_numeric($b) ? round(((int) $b) / 1024) . ' kB' : $b;

echo "SPORTA — what is on this server\n";
echo str_repeat('=', 60) . "\n";
echo 'checked  ' . gmdate('Y-m-d H:i') . " UTC\n";
echo 'root     ' . $root . "\n";
echo 'files    ' . count($onDisk) . " on disk\n";
echo 'manifest ' . (count($manifest) ?: 'NOT UPLOADED') . "\n\n";

if (!$manifest) {
    echo "NO MANIFEST, so damage cannot be checked.\n";
    echo "Upload scripts/site-manifest.txt as api/site-manifest.txt and reload\n";
    echo "this page. Everything below is still true — it just cannot tell you\n";
    echo "whether the files that SHOULD be here are the right ones.\n\n";
}

if ($dangerous) {
    echo "DANGEROUS — deal with these first (" . count($dangerous) . ")\n";
    echo str_repeat('-', 60) . "\n";
    foreach ($dangerous as [$rel, $size, $why]) printf("  %-46s %8s  %s\n", $rel, $kb($size), $why);
    echo "\n  These are reachable by anyone who guesses the name unless .htaccess\n";
    echo "  denies them. Download anything you want to keep, then delete them\n";
    echo "  from the server — hPanel -> Files -> File Manager.\n\n";
} else {
    echo "DANGEROUS       none — no dumps, archives, backups or installers\n\n";
}

if ($missing) {
    echo 'MISSING — the shop needs these and they are not here (' . count($missing) . ")\n";
    echo str_repeat('-', 60) . "\n";
    foreach ($missing as $rel) echo "  $rel\n";
    echo "\n  Usually an upload that did not finish. Re-upload from the package.\n\n";
} elseif ($manifest) {
    echo "MISSING         none — every shipped file is here\n\n";
}

if ($changed) {
    echo 'CHANGED — here, but not the file that was shipped (' . count($changed) . ")\n";
    echo str_repeat('-', 60) . "\n";
    foreach ($changed as $rel) echo "  $rel\n";
    echo "\n  Either edited on the server, or the upload was cut short. If you did\n";
    echo "  not edit it deliberately, re-upload it.\n\n";
} elseif ($manifest) {
    echo "CHANGED         none — every shipped file matches, byte for byte\n\n";
}

if ($unexpected) {
    echo 'UNEXPECTED — here, and not part of the shipped site (' . count($unexpected) . ")\n";
    echo str_repeat('-', 60) . "\n";
    foreach ($unexpected as [$rel, $size]) printf("  %-46s %8s\n", $rel, $kb($size));
    echo "\n  Most of these are harmless — photographs you uploaded, a logo, a file\n";
    echo "  hPanel left behind. Read the list rather than clearing it: this is\n";
    echo "  also where something nobody put there on purpose would show up.\n\n";
} else {
    echo "UNEXPECTED      none\n\n";
}

// ------------------------------------------------------------- the index page
//
// Asked separately because it is the one file whose absence or corruption
// takes the whole shop down, and because "the site looks broken" almost always
// means this file, its asset links, or its service worker.
echo "THE INDEX PAGE\n";
echo str_repeat('-', 60) . "\n";
$index = $root . '/index.html';
if (!is_file($index)) {
    echo "  index.html IS NOT HERE. The shop has no home page.\n";
} else {
    $html = (string) @file_get_contents($index);
    printf("  %-34s %s\n", 'size', $kb(strlen($html)));
    printf("  %-34s %s\n", 'ends with </html>', str_ends_with(rtrim($html), '</html>') ? 'yes' : 'NO — the file is CUT SHORT');
    printf("  %-34s %s\n", 'has a <title>', preg_match('#<title>[^<]+</title>#i', $html) ? 'yes' : 'NO');

    // Every local asset it names must exist. A hashed filename that is not
    // here is the commonest shape of "the site half-loads after a deploy".
    // ~ as the delimiter, not #. With # the pattern ends at the # inside the
    // character class below and preg_match_all fails — which store.php's error
    // handler turned into {"error":"failed"} halfway down this page.
    preg_match_all('~(?:src|href)="(/[^"?\#]+)~', $html, $m);
    $refs = array_values(array_unique($m[1] ?? []));
    $gone = [];
    foreach ($refs as $u) if (!is_file($root . '/' . ltrim($u, '/'))) $gone[] = $u;
    printf("  %-34s %d\n", 'local files it asks for', count($refs));
    if ($gone) {
        echo "  MISSING, so the page will half-load:\n";
        foreach ($gone as $u) echo "      $u\n";
    } else {
        echo "  every one of them is on this server\n";
    }
}
echo "\ndone. This page changed nothing.\n";
