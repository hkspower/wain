<?php
/**
 * Zero-byte or unreadable image files under hero/ and cats/ on the live
 * server. READ-ONLY — stats files, reads nothing, writes nothing.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/check-image-corruption.php && php r.php
 *
 * THE DIRECTORIES WERE WRONG AND THIS NEVER CHECKED A SINGLE FILE. It listed
 * `assets/hero/desktop`, `assets/cats/desktop`, etc. — this shop's images
 * live at `hero/desktop` and `cats/desktop`, directly under the docroot, with
 * no `assets/` prefix (assets/ holds the CSS/JS bundle, not artwork). Every
 * `is_dir()` check failed, the loop skipped all four directories, and the
 * script printed `images_ok=all_0` — which reads exactly like a clean run of
 * a real check, on a script that had checked nothing. Fixed to the real
 * paths; $checked being 0 now means something actually is wrong (no files
 * found at all), not that the check quietly measured its own environment.
 *
 * STRAY FILES ARE REPORTED SEPARATELY FROM CORRUPTION, and were not before —
 * `cats/desktop/outlet.jpg` existing is a known, long-running situation
 * (CLAUDE.md's own history: something on this account keeps restoring it
 * after every removal, and it is not corrupted, just not ours to have there).
 * Folding it into `corrupted=N` would read as image damage on a run where
 * nothing is actually broken.
 */

$docroot = '/home/u130124229/domains/sporta.com.kw/public_html';
$corrupted = [];
$checked = 0;

$dirs = [
    'hero/desktop',
    'hero/mobile',
    'cats/desktop',
    'cats/mobile',
];

foreach ($dirs as $dir) {
    if (!is_dir("$docroot/$dir")) continue;

    $files = array_diff(scandir("$docroot/$dir"), ['.', '..']);
    foreach ($files as $file) {
        $path = "$docroot/$dir/$file";
        if (!is_file($path)) continue;

        $checked++;
        $size = filesize($path);

        if ($size === 0) {
            $corrupted[] = "/$dir/$file (zero bytes)";
        } else if (!is_readable($path)) {
            $corrupted[] = "/$dir/$file (not readable)";
        }
    }
}

// Known, long-standing strays — reported, never treated as corruption.
$stray = [
    'cats/desktop/outlet.jpg' => 'duplicate tile image, restored by something on this account that is not us',
];
$strayFound = [];
foreach ($stray as $path => $reason) {
    if (file_exists("$docroot/$path")) $strayFound[] = "/$path ($reason)";
}

echo $checked === 0 ? 'checked=0 (no files found — a directory is missing or renamed again)' : "checked=$checked";
echo ' corrupted=' . count($corrupted);
foreach ($corrupted as $file) echo ' ' . $file;
echo ' stray=' . count($strayFound);
foreach ($strayFound as $file) echo ' ' . $file;
