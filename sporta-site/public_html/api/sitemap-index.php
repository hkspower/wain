<?php
// The sitemap index, /sitemap.xml, from /backends → SEO (2026-10-02). .htaccess rewrites it here.
//
// It lists the sections the owner has switched on, and sitemap-custom.xml when there are extra links.
// With nothing set it lists exactly what the static sitemap.xml lists. A fault serves the static file.
declare(strict_types=1);

$static = __DIR__ . '/../sitemap.xml';
try {
    require __DIR__ . '/store.php';
    $db = store_db();
    store_throttle($db, 'sitemap', 30, 60);
    $c = store_crawl($db);
    $site = STORE_SEO_SITE;
    $entries = [];
    if ($c['sections']['pages']) {
        $m = @filemtime(__DIR__ . '/../sitemap-pages.xml');
        $entries[] = [$site . '/sitemap-pages.xml', $m ? gmdate('Y-m-d\TH:i:s\Z', $m) : null];
    }
    if ($c['sections']['categories']) $entries[] = [$site . '/sitemap-categories.xml', null];
    if ($c['sections']['products'])   $entries[] = [$site . '/sitemap-products.xml', null];
    if ($c['custom'])                 $entries[] = [$site . '/sitemap-custom.xml', null];
    $out = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
         . '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    foreach ($entries as [$loc, $mod]) {
        $out .= "  <sitemap>\n    <loc>" . htmlspecialchars($loc, ENT_XML1) . "</loc>\n"
              . ($mod ? "    <lastmod>$mod</lastmod>\n" : '') . "  </sitemap>\n";
    }
    $out .= "</sitemapindex>\n";
} catch (Throwable $e) {
    header('Content-Type: application/xml; charset=utf-8');
    readfile($static);
    exit;
}
header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=1800');
echo $out;
