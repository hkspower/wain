<?php
// robots.txt, from /backends → SEO (2026-10-02). .htaccess rewrites /robots.txt here.
//
// THE STATIC FILE IS THE SOURCE. public_html/robots.txt is read and the owner's switches applied to it
// (store_robots_render): with nothing set the answer IS the file, byte for byte, and ANY fault — no
// database, no settings row, an exception — serves the file untouched. A broken robots.txt is the one
// way this feature could hide the shop from Google, so every failure falls back to the file that works.
declare(strict_types=1);

$static = (string) @file_get_contents(__DIR__ . '/../robots.txt');
$body = $static;
try {
    require __DIR__ . '/store.php';
    $body = store_robots_render($static, store_crawl(store_db()));
} catch (Throwable $e) {
    $body = $static;
}
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: public, max-age=3600');
header('X-Content-Type-Options: nosniff');
echo $body;
