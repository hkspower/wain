<?php
// Router for PHP's built-in server, used ONLY by scripts/sandbox.sh.
//
//   php -S 127.0.0.1:4300 -t sporta-site/public_html scripts/dev-router.php
//
// The live server is Apache, and public_html/.htaccess does real work there —
// including the internal rewrite that bridges /cats/mobile/<id>.jpg onto the
// art-<id>.jpg actually on disk. PHP's built-in server reads no .htaccess, so
// without this file the local copy 404s where the live site serves a picture,
// and the scans report a defect that is already fixed.
//
// This mirrors THAT ONE RULE and nothing else. It is not a second .htaccess:
// anything more than the single bridge belongs in the real file, and a dev
// router that quietly grows rules is how local and live drift apart.

declare(strict_types=1);

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// The category-tile name bridge — same pattern, same guard (!-f), same target
// as the RewriteRule in public_html/.htaccess. Change them together.
if (preg_match('#^/cats/(mobile|desktop)/(men|women|accessories|outlet)(-rtl)?\.(jpe?g|webp)$#', $uri, $m)
    && !is_file($_SERVER['DOCUMENT_ROOT'] . $uri)) {
    $bridged = "/cats/{$m[1]}/art-{$m[2]}{$m[3]}.{$m[4]}";
    $file = $_SERVER['DOCUMENT_ROOT'] . $bridged;
    if (is_file($file)) {
        header('Content-Type: ' . ($m[4] === 'webp' ? 'image/webp' : 'image/jpeg'));
        readfile($file);
        exit;
    }
}

// Everything else: exactly what the built-in server would have done.
return false;
