<?php
// 2026-10-03, owner: delete ~/public_html, an old July copy of Sporta that no website serves (Hostinger's
// site list: every domain has its own docroot under domains/). Empties it, keeps the empty folder.
// REFUSES if it is a link or resolves to the live docroot. Reports STATE.
declare(strict_types=1);
set_time_limit(300);
$dir = '/home/u130124229/public_html';
$liveRoot = '/home/u130124229/domains/sporta.com.kw/public_html';
if (is_link($dir) || realpath($dir) === realpath($liveRoot) || !is_file("$liveRoot/index.html")) { echo "REFUSED link-or-live\n"; exit; }
function rmtree(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (scandir($p) as $n) if ($n !== '.' && $n !== '..') rmtree("$p/$n");
    @rmdir($p);
}
if (is_dir($dir)) foreach (scandir($dir) as $n) if ($n !== '.' && $n !== '..') rmtree("$dir/$n");
clearstatcache();
$left = is_dir($dir) ? count(array_diff(scandir($dir), ['.', '..'])) : -1;
echo 'HOMEPUB entriesLeft=' . $left . ' liveIndex=' . (is_file("$liveRoot/index.html") ? 'ok' : 'MISSING') . "\n";
