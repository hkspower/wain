<?php
// 2026-10-03, owner chose all four: delete the old OpenCart leftovers in the sporta.com.kw domain root
// (three backup zips and .trash), the old .htaccess backup and the two removed-* attics, and trim
// ~/error_log to its last 1,000 lines. EXACT PATHS ONLY; never public_html, never storage/ (it holds the
// deploy secret). Symlinks are unlinked, never followed. Reports STATE, the same on every run.
declare(strict_types=1);
set_time_limit(300);
$h = '/home/u130124229';
$d = "$h/domains/sporta.com.kw";
function rmtree(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (scandir($p) as $n) if ($n !== '.' && $n !== '..') rmtree("$p/$n");
    @rmdir($p);
}
$targets = ["$d/storage.zip", "$d/storage1.zip", "$d/storage01.zip", "$d/.htaccess.bak-20260910-115002",
            "$d/.trash", "$h/removed-2026-09-10", "$h/removed-2026-10-03"];
foreach ($targets as $t) rmtree($t);
$log = "$h/error_log";
if (is_file($log) && filesize($log) > 200000) {
    $lines = @file($log) ?: [];
    @file_put_contents($log, implode('', array_slice($lines, -1000)));
}
clearstatcache();
$out = [];
foreach ($targets as $t) $out[] = basename($t) . '=' . (file_exists($t) || is_link($t) ? 'STILL-THERE' : 'gone');
echo 'CLEANUP ' . implode(' ', $out) . ' error_log=' . (is_file($log) ? round(filesize($log) / 1024) . 'KB' : 'none')
   . ' shopIndex=' . (is_file("$d/public_html/index.html") ? 'ok' : 'MISSING') . ' storage=' . (is_dir("$d/storage") ? 'ok' : 'MISSING') . "\n";
