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
// This mirrors the FEW .htaccess rules without which a local rig tests
// something the live site does not do. It is not a second .htaccess, and it
// must not grow into one: a dev router that quietly accumulates rules is how
// local and live drift apart. Every rule here names the .htaccess rule it
// mirrors, and the two are changed together.
//
//   1. the /cats name bridge
//   2. the FLAT PAGES — /card and /returns/request. Something in this stack
//      answers an unknown path with index.html, so without these the browser
//      rigs open the app's 404 screen while curl, which asks for the file,
//      gets the real page. That difference cost a diagnosis: the page was
//      served correctly and the test could not see it.

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

// The flat pages, which are NOT routes in the built app.
//   .htaccess: RewriteCond %{DOCUMENT_ROOT}/card.html -f
//              RewriteRule ^card/?$ /card.html [L]
//              RewriteCond %{DOCUMENT_ROOT}/returns-request.html -f
//              RewriteRule ^returns/request/?$ /returns-request.html [L]
$flat = [
    '#^/card/?$#'            => '/card.html',
    '#^/returns/request/?$#' => '/returns-request.html',
];
foreach ($flat as $pattern => $target) {
    if (preg_match($pattern, $uri)) {
        $file = $_SERVER['DOCUMENT_ROOT'] . $target;
        // Same -f guard as the RewriteCond: a missing file falls through to
        // whatever the server would otherwise have done, rather than 500ing.
        if (is_file($file)) {
            header('Content-Type: text/html; charset=UTF-8');
            readfile($file);
            exit;
        }
    }
}

// Everything else: exactly what the built-in server would have done.
return false;
