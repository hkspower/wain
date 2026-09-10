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
//   3. THE SEO SHIM. Live, `/` and every SPA route are rewritten to seo.php,
//      which injects the per-route <head> and — since 2026-09-10 — the ETag
//      that lets a navigation revalidate for nothing instead of re-sending
//      42 kB. The sandbox served index.html straight from disk, so seo.php
//      had NEVER been exercised by any rig here: not its canonical, not its
//      hreflang, not its Open Graph tags, and not the fail-safe branch. Every
//      one of those measured "fine" locally by never running.

declare(strict_types=1);

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// THE CATEGORY-TILE NAME BRIDGE WAS HERE AND IS GONE, with the matching
// RewriteRule in public_html/.htaccess — see the long note there for why.
// Short version: bridging /cats/<crop>/<id>.jpg onto art-<id>.jpg made the
// tile component's FIRST <picture> succeed, so its second one never rendered —
// and the second is the one carrying the webp sources and the `-rtl` Arabic
// composition. Four cheap 404s buy both back.
//
// Removing it here as well is not tidiness: this router is what the sandbox
// serves, php -S never reads .htaccess, and a measurement taken with only one
// of the two changed measures nothing at all.

// THE SEO SHIM, mirroring .htaccess:
//     RewriteRule ^$ /seo.php [L]
//     RewriteRule ^(shop|cart|checkout|about|contact|wishlist|track|returns|terms|privacy|review)/?$ /seo.php [L]
//     RewriteRule ^product/[^/]+/?$  /seo.php [L]
//     RewriteRule ^payment/result/?$ /seo.php [L]
//
// REAL FILES WIN FIRST, exactly as the RewriteCond %{REQUEST_FILENAME} -f
// above those rules does. Without that guard this router would hand
// /assets/index-*.css to seo.php and the sandbox would serve the HTML shell
// with a stylesheet's Content-Type — which is not a subtle failure, but it is
// a confusing one to diagnose from a blank page.
$seoRoutes = '#^/(shop|cart|checkout|about|contact|wishlist|track|returns|terms|privacy|review)/?$'
           . '|^/product/[^/]+/?$'
           . '|^/payment/result/?$#';
if ($uri === '/' || preg_match($seoRoutes, $uri)) {
    $onDisk = $_SERVER['DOCUMENT_ROOT'] . $uri;
    if ($uri === '/' || !is_file($onDisk)) {
        // seo.php reads index.html itself and echoes the result, so it is
        // included rather than redirected to — the same one internal hop the
        // rewrite makes live.
        $_SERVER['SCRIPT_NAME'] = '/seo.php';
        require $_SERVER['DOCUMENT_ROOT'] . '/seo.php';
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
