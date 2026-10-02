<?php
// The owner's extra sitemap links, /sitemap-custom.xml (2026-10-02), from /backends → SEO. Each is a
// page on this shop (store_seo_custom_url refused anything else when it was saved), listed in both
// languages like every other sitemap here. No links = an empty, valid urlset.
declare(strict_types=1);
require __DIR__ . '/store.php';

$db = store_db();
store_throttle($db, 'sitemap', 30, 60);
$links = [];
try { $links = store_crawl($db)['custom']; } catch (Throwable $e) { $links = []; }

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=1800');
$esc = fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";
foreach ($links as $path) {
    $url = STORE_SEO_SITE . $path;
    $en = $url . (str_contains($path, '?') ? '&' : '?') . 'lang=en';
    foreach ([$url, $en] as $loc) {
        echo "  <url>\n    <loc>" . $esc($loc) . "</loc>\n";
        echo '    <xhtml:link rel="alternate" hreflang="ar" href="' . $esc($url) . "\"/>\n";
        echo '    <xhtml:link rel="alternate" hreflang="en" href="' . $esc($en) . "\"/>\n";
        echo '    <xhtml:link rel="alternate" hreflang="x-default" href="' . $esc($url) . "\"/>\n";
        echo "  </url>\n";
    }
}
echo "</urlset>\n";
