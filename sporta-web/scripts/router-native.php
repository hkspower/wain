<?php
// Test router: ONE origin serving the built SPA and the native API, matching
// the public_html layout. Start:  php -S 127.0.0.1:8096 scripts/router-native.php
//
// Static files are served BY HAND with an explicit MIME map rather than by
// returning false: php -S resolves `false` against its docroot (the CWD it was
// launched from), not against this file, so /assets/*.js came back as the SPA
// shell — text/html — and the browser refused every module script.
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = dirname(__DIR__);

if (preg_match('#^/api/(api|admin|cron-fulfilment|setup-admin)\.php$#', $uri, $m)) {
    require $root . '/dropin/php-store/' . $m[1] . '.php';
    exit;
}

$file = realpath($root . '/dist' . $uri);
if ($uri !== '/' && $file !== false && str_starts_with($file, $root . '/dist') && is_file($file)) {
    // jpg/jpeg WERE MISSING, and every product and category photograph on the
    // site is a .jpg — so the rig served the shop's photography as
    // application/octet-stream. Browsers sniff images and render them anyway,
    // which is exactly why it went unnoticed: nothing looked wrong, and any
    // check that asked what TYPE an image was got the wrong answer. A rig that
    // does not serve what Apache serves is a rig that hides content-type bugs.
    $mime = [
        'js' => 'text/javascript', 'css' => 'text/css', 'html' => 'text/html',
        'json' => 'application/json', 'png' => 'image/png', 'svg' => 'image/svg+xml',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif',
        'avif' => 'image/avif', 'ico' => 'image/x-icon',
        'webp' => 'image/webp', 'woff2' => 'font/woff2', 'txt' => 'text/plain',
        'xml' => 'application/xml', 'webmanifest' => 'application/manifest+json',
    ][strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream';
    header('Content-Type: ' . $mime);
    readfile($file);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
require $root . '/dist/index.html';
