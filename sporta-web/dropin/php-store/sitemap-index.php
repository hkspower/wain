<?php
// Public sitemap index. Each child carries a <lastmod> taken from CONTENT, not
// from the deploy: the products child from max(products.updated_at), the pages
// child from the newest <lastmod> written inside sitemap-pages.xml. A child
// whose date cannot be established is listed without one rather than guessed.
declare(strict_types=1);
require_once __DIR__ . '/seo-runtime.php';

function sporta_sitemap_index_dates(): array {
    $dates = ['sitemap-pages.xml' => '', 'sitemap-products.xml' => ''];
    $pages = sporta_seo_public_path('sitemap-pages.xml');
    if ($pages !== null && preg_match_all('#<lastmod>(\d{4}-\d{2}-\d{2})#', (string)file_get_contents($pages), $m)) {
        $dates['sitemap-pages.xml'] = max($m[1]);
    }
    $db = sporta_seo_db();
    if ($db !== null) {
        try {
            if ($db->query("show columns from products like 'updated_at'")->fetch()) {
                $max = $db->query('select max(updated_at) from products where active = 1')->fetchColumn();
                if (is_string($max) && preg_match('/^\d{4}-\d{2}-\d{2}/', $max)) $dates['sitemap-products.xml'] = substr($max, 0, 10);
            }
        } catch (Throwable $e) {
            error_log('Sporta sitemap index database unavailable: ' . get_class($e));
        }
    }
    return $dates;
}

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=1800');
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach (sporta_sitemap_index_dates() as $child => $lastmod) {
    echo "  <sitemap><loc>https://www.sporta.com.kw/{$child}</loc>"
        . ($lastmod !== '' ? "<lastmod>{$lastmod}</lastmod>" : '') . "</sitemap>\n";
}
echo "</sitemapindex>\n";
