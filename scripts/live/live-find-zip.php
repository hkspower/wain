<?php
/**
 * Where is SPORTA-BACKEND.zip, and is it reachable?
 *
 * READ-ONLY. It walks the docroot and reports paths, sizes and what the server
 * says about each. Nothing is written and no configuration value is printed.
 *
 * WHY. live-file-check.php's untracked walk named it, remove-strays.php looked
 * for it at the docroot root and found nothing there — `already-gone`. Those
 * two disagree, and "already gone" is exactly the answer a wrong path gives, so
 * it must not be read as "somebody removed it". This asks the disk directly.
 *
 * It also asks for any OTHER archive, because one that was overlooked once can
 * have been overlooked twice: a zip of the source in a web root is only as
 * private as the .htaccess above it, and this server's .htaccess has been
 * rolled back by a restore before.
 */
$root = '/home/u130124229/domains/sporta.com.kw/public_html';

$ask = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOBODY         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Cache-Control: no-cache'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return (string) $code;
};

$hits = []; $walked = 0;
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::SELF_FIRST
);
foreach ($it as $f) {
    if (!$f->isFile()) continue;
    $walked++;
    $rel = substr($f->getPathname(), strlen($root) + 1);
    // Any archive, not just the one named — see the header.
    if (preg_match('/\.(zip|tar|tar\.gz|tgz|gz|rar|7z|bak|sql)$/i', $rel)) {
        $hits[] = $rel . '(' . $f->getSize() . ',http=' . $ask('/' . $rel) . ')';
    }
}

echo 'ARCHIVES walked=' . $walked
   . ' found=' . (count($hits) ? count($hits) . ':' . implode(' ', $hits) : '0')
   . "\n";
