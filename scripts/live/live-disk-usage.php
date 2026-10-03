<?php
// READ-ONLY. Where the disk goes on the hosting account: every top-level folder of the home directory,
// every domain, sporta's own docroot folders, and the 25 largest files. Sizes only; reads no contents.
// Writes its answer to ~/disk-usage.txt as well, because a walk this size can outlive one cron tick.
declare(strict_types=1);
set_time_limit(300);
$home = '/home/u130124229';
$lines = [];
function line(string $s): void { global $lines; $lines[] = $s; echo $s, "\n"; @ob_flush(); @flush(); }
function mb(int $b): string { return number_format($b / 1048576, 1) . 'MB'; }
$big = [];
function du(string $dir, int &$files): int {
    global $big; $sum = 0;
    try {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY, RecursiveIteratorIterator::CATCH_GET_CHILD);
        foreach ($it as $f) { if ($f->isLink() || !$f->isFile()) continue; $s = $f->getSize(); $sum += $s; $files++;
            if ($s > 2 * 1048576) $big[$f->getPathname()] = $s; }
    } catch (Throwable $e) {}
    return $sum;
}
$total = 0;
foreach (scandir($home) as $n) {
    if ($n === '.' || $n === '..') continue; $p = "$home/$n";
    if (is_link($p)) continue;
    if (is_file($p)) { $total += filesize($p); if (filesize($p) > 1048576) line('HOMEFILE ' . $n . '=' . mb(filesize($p))); continue; }
    if ($n === 'domains') continue;
    $c = 0; $s = du($p, $c); $total += $s; line('HOME ' . $n . '/ ' . mb($s) . " files=$c");
}
foreach (scandir("$home/domains") as $d) {
    if ($d === '.' || $d === '..' || !is_dir("$home/domains/$d")) continue;
    $c = 0; $s = du("$home/domains/$d", $c); $total += $s; line('DOMAIN ' . $d . ' ' . mb($s) . " files=$c");
}
$sp = "$home/domains/sporta.com.kw";
foreach (scandir($sp) as $n) { if ($n === '.' || $n === '..') continue; $p = "$sp/$n";
    if (is_dir($p) && !is_link($p)) { $c = 0; line('SPORTA ' . $n . '/ ' . mb(du($p, $c)) . " files=$c"); }
    elseif (is_file($p)) line('SPORTA ' . $n . ' ' . mb(filesize($p))); }
foreach (scandir("$sp/public_html") as $n) { if ($n === '.' || $n === '..') continue; $p = "$sp/public_html/$n";
    if (is_dir($p) && !is_link($p)) { $c = 0; line('DOCROOT ' . $n . '/ ' . mb(du($p, $c)) . " files=$c"); } }
arsort($big);
foreach (array_slice($big, 0, 25, true) as $f => $s) line('BIG ' . mb($s) . ' ' . str_replace($home . '/', '~/', $f));
line('TOTAL ' . mb($total));
@file_put_contents("$home/disk-usage.txt", implode("\n", $lines) . "\n");
