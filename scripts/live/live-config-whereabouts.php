<?php
/**
 * READ-ONLY. Where are the gateway config files? Lists FILE NAMES, SIZES AND DATES ONLY — never a byte of
 * content — for pay/ and knet/, and every file under the domain folder and the home directory whose name
 * starts with "config" and contains ".php" (backups like config.php.bak-* included). 2026-10-15: both
 * pay/config.php and knet/config.php answered "Payment is not configured on this server."
 *
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
$home = '/home/u130124229';
$root = $home . '/domains/sporta.com.kw/public_html';
$fmt = fn($p) => basename($p) . ':' . filesize($p) . ':' . gmdate('Y-m-d', filemtime($p));
foreach (['pay', 'knet'] as $d) {
    $names = array_map($fmt, array_filter(glob($root . '/' . $d . '/*') ?: [], 'is_file'));
    echo strtoupper($d), ' ', implode(' ', $names), "\n";
}
$hits = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($home, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
$it->setMaxDepth(7);
foreach ($it as $f) {
    if (count($hits) >= 40) break;
    $p = $f->getPathname();
    if (strpos($p, '/node_modules/') !== false || strpos($p, '/vendor/') !== false || strpos($p, '/.cagefs') !== false) continue;
    if ($f->isFile() && preg_match('/^config.*\.php/i', $f->getFilename())
        && (strpos($p, '/pay') !== false || strpos($p, '/knet') !== false || strpos($p, 'removed-') !== false || strpos($p, 'backup') !== false)) {
        $hits[] = substr($p, strlen($home) + 1) . ':' . $f->getSize() . ':' . gmdate('Y-m-d', $f->getMTime());
    }
}
echo 'FOUND ', count($hits), ' ', implode(' ', $hits), "\n";
