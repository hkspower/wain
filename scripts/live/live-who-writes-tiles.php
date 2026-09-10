<?php
/**
 * WHO puts cats/desktop/outlet.jpg back one minute after it is removed?
 *
 * READ-ONLY. It greps the server's own PHP for code that could write it, and
 * reports what it finds. Nothing is written and no configuration value is
 * printed — matched lines are reported as FILE:LINE only, never as text,
 * because this runs over a public URL and a matched line could carry anything.
 *
 * MEASURED TWICE, identically. Moved 14:23:01 -> back 14:24:01. Moved
 * 14:39:01 -> back 14:40:01. Both times byte-identical to art-outlet.jpg
 * beside it (sha256 8c0675b4f9ed), both times at the cron tick, and both times
 * left alone afterwards — eight minutes untouched on the second. That last
 * part is the shape of a writer that only acts when the file is MISSING, which
 * is why nothing has ever noticed it: on a normal day it does nothing at all.
 *
 * SPORTA-BACKEND.zip, moved in the same run, has NOT come back. So this is not
 * a backup restoring the docroot wholesale; it is something specific to the
 * category art.
 *
 * The eight scheduled jobs do not explain it either — none of them runs every
 * minute and none names cats/ in its command. So the writer is either a PHP
 * file reachable from one of them, or something outside cron entirely.
 */
$root = '/home/u130124229/domains/sporta.com.kw/public_html';

/* Anything that could produce the file: the literal name, the copy/write
   primitives aimed at the tile directory, and the two publishers this project
   ships that know how to make tiles. */
$NEEDLES = ['outlet.jpg', 'art-outlet', '/cats/', 'cats/desktop', 'publish-cats', 'copy('];

$hits = []; $scanned = 0;
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
);
foreach ($it as $f) {
    if (!$f->isFile()) continue;
    if (!preg_match('/\.(php|sh|js|cgi|pl|py)$/i', $f->getFilename())) continue;
    // The built bundle mentions the tile names constantly and writes nothing;
    // including it would bury the answer in 40 matches.
    $rel = substr($f->getPathname(), strlen($root) + 1);
    if (strpos($rel, 'assets/') === 0) continue;
    $scanned++;

    $body = (string) @file_get_contents($f->getPathname());
    if ($body === '') continue;

    // Only report a file that both NAMES the target and can WRITE.
    $names = false;
    foreach ($NEEDLES as $n) if (strpos($body, $n) !== false) { $names = true; break; }
    if (!$names) continue;

    $writes = [];
    foreach (['copy(', 'file_put_contents(', 'rename(', 'imagejpeg(', 'fopen(', 'exec(',
              'shell_exec(', 'system(', 'passthru('] as $w) {
        if (strpos($body, $w) !== false) $writes[] = rtrim($w, '(');
    }
    if (!$writes) continue;

    $hits[] = $rel . '{' . implode('+', $writes) . '}';
}

echo 'TILEWRITERS scanned=' . $scanned
   . ' candidates=' . (count($hits) ? count($hits) . ':' . implode(' ', $hits) : '0')
   . "\n";
