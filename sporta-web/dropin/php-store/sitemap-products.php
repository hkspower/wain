<?php
// Live active-product sitemap. The shipped XML is a read-only fallback if
// MariaDB is unavailable; it is never used while a healthy database says a
// product has been disabled or removed.
//
// <lastmod> comes from products.updated_at (ON UPDATE CURRENT_TIMESTAMP), so it
// is the date the row last changed, never a deploy date. <image:image> lists the
// product's photos as they exist on disk: products.image / products.images are
// empty on the live catalogue and the photos are files named after the slug —
// /images/products/<slug>.<ext> and <slug>-view-<n>.<ext>. Listing only files
// that exist means the sitemap can never point Google at a missing image.
declare(strict_types=1);
require_once __DIR__ . '/seo-runtime.php';
require_once __DIR__ . '/product-listable.php';

const SPORTA_SITEMAP_ORIGIN = 'https://www.sporta.com.kw';
const SPORTA_SITEMAP_IMAGE_DIR = '/images/products';

/** @return array<string, list<string>> slug => public image paths, main photo first */
function sporta_sitemap_product_images(array $slugs): array {
    $dir = dirname(__DIR__) . SPORTA_SITEMAP_IMAGE_DIR;
    $files = is_dir($dir) ? (scandir($dir) ?: []) : [];
    $want = array_fill_keys($slugs, true);
    $found = [];
    foreach ($files as $file) {
        if (!preg_match('/^([a-z0-9-]+?)(?:-view-(\d+))?\.(jpe?g|png|webp)$/D', $file, $m)) continue;
        if (!isset($want[$m[1]])) continue;
        $found[$m[1]][] = [(int)($m[2] ?: 0), SPORTA_SITEMAP_IMAGE_DIR . '/' . $file];
    }
    $out = [];
    foreach ($found as $slug => $list) {
        usort($list, static fn (array $a, array $b): int => $a[0] <=> $b[0] ?: strcmp($a[1], $b[1]));
        $out[$slug] = array_slice(array_column($list, 1), 0, 10);
    }
    return $out;
}

function sporta_sitemap_lastmod(?string $value): string {
    if (!is_string($value)) return '';
    $date = substr($value, 0, 10);
    return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $date, $p)
        && checkdate((int)$p[2], (int)$p[3], (int)$p[1]) ? $date : '';
}

function sporta_sitemap_product_xml(array $rows, bool $hasUpdatedAt, array $images = []): string {
    $esc = static fn (string $value): string => htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $out = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
        . ' xmlns:xhtml="http://www.w3.org/1999/xhtml"'
        . ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";
    foreach ($rows as $row) {
        $slug = (string)($row['slug'] ?? '');
        if ($slug === '') continue;
        $ar = SPORTA_SITEMAP_ORIGIN . '/product/' . rawurlencode($slug);
        $en = $ar . '?lang=en';
        $lastmod = $hasUpdatedAt ? sporta_sitemap_lastmod($row['updated_at'] ?? null) : '';
        foreach ([$ar, $en] as $loc) {
            $out .= "  <url>\n";
            $out .= '    <loc>' . $esc($loc) . "</loc>\n";
            if ($lastmod !== '') $out .= '    <lastmod>' . $lastmod . "</lastmod>\n";
            $out .= '    <xhtml:link rel="alternate" hreflang="ar" href="' . $esc($ar) . "\"/>\n";
            $out .= '    <xhtml:link rel="alternate" hreflang="en" href="' . $esc($en) . "\"/>\n";
            $out .= '    <xhtml:link rel="alternate" hreflang="x-default" href="' . $esc($ar) . "\"/>\n";
            foreach ($images[$slug] ?? [] as $path) {
                $out .= '    <image:image><image:loc>' . $esc(SPORTA_SITEMAP_ORIGIN . $path) . "</image:loc></image:image>\n";
            }
            $out .= "  </url>\n";
        }
    }
    return $out . "</urlset>\n";
}

function sporta_sitemap_products_serve(): void {
    $db = sporta_seo_db();
    if ($db === null) sporta_seo_static_file('sitemap-products.xml', 'application/xml; charset=utf-8');
    try {
        $hasUpdatedAt = (bool)$db->query("show columns from products like 'updated_at'")->fetch();
        // The same listing rule as the shop (product-listable.php): a product with no name, price or photo is not in the sitemap either.
        $columns = ($hasUpdatedAt ? 'slug, updated_at' : 'slug') . ', name_en, name_ar, price, image, images';
        $rows = $db->query("select {$columns} from products where active = 1 order by slug")->fetchAll();
    } catch (Throwable $e) {
        error_log('Sporta sitemap database unavailable: ' . get_class($e));
        sporta_seo_static_file('sitemap-products.xml', 'application/xml; charset=utf-8');
    }
    $images = sporta_sitemap_product_images(array_map(static fn (array $r): string => (string)$r['slug'], $rows));
    $rows = array_values(array_filter($rows, static fn (array $r): bool => store_product_listable($r, array_fill_keys(array_keys($images), true))));
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=1800');
    echo sporta_sitemap_product_xml($rows, $hasUpdatedAt, $images);
}

if (!defined('SPORTA_SEO_TEST')) sporta_sitemap_products_serve();
