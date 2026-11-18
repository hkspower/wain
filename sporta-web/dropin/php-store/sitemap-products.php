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
// A photo an admin uploaded is named <stem>-<10 hex>.<ext> and products.image / products.images point at it: those paths are listed too (main photo
// first), as long as they are plain same-origin picture paths.
//
// WHAT IS LISTED (2026-11-18, "fix sitemap robot"):
//   - only a slug the page router can answer ([A-Za-z0-9][A-Za-z0-9_-]{0,79}, seo-page.php): anything else would be an advertised 404;
//   - /catalogue (the live catalogue page, whose content is these very products) first, dated by the newest product it shows;
//   - no <lastmod> later than today (a future date is read as a broken sitemap);
//   - an ETag, so a crawler's repeat request costs a 304;
//   - NO product to list (none active, or all hidden by product-listable.php) is a 503 + Retry-After, never a 200 with an empty <urlset>: that is not valid
//     and a crawler reads it as "every product was removed".
declare(strict_types=1);
require_once __DIR__ . '/seo-runtime.php';
require_once __DIR__ . '/product-listable.php';

const SPORTA_SITEMAP_ORIGIN = 'https://www.sporta.com.kw';
const SPORTA_SITEMAP_IMAGE_DIR = '/images/products';
// The page router's own rule for a product slug (seo-page.php): a slug it does not accept answers 404, so it is not advertised.
const SPORTA_SITEMAP_SLUG_RE = '/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/D';

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
    return sporta_seo_lastmod_day($value);   // YYYY-MM-DD, never a day that has not happened yet
}

/** The photos products.image / products.images name: same-origin paths to a picture that EXISTS in the web root (a path left behind by a deleted file
 *  would advertise a 404 image), main first. Anything else - an off-site or protocol-relative address, a path with .., another file type - is ignored.
 *  @return list<string> */
function sporta_sitemap_db_images(array $row): array {
    $out = [];
    $root = dirname(__DIR__);
    $raw = array_merge([(string)($row['image'] ?? '')], explode(',', (string)($row['images'] ?? '')));
    foreach ($raw as $one) {
        $one = trim($one);
        if (preg_match('~^/[A-Za-z0-9/_.-]{1,200}\.(?:jpe?g|png|webp)$~Di', $one) && !str_contains($one, '//') && !str_contains($one, '..') && is_file($root . $one)) $out[] = $one;
    }
    return array_values(array_unique($out));
}

/** One <url> pair (Arabic at the bare address, English at ?lang=en) with its alternates, optional lastmod and photos. */
function sporta_sitemap_url_pair(string $ar, string $lastmod, array $images, callable $esc): string {
    $en = $ar . '?lang=en';
    $out = '';
    foreach ([$ar, $en] as $loc) {
        $out .= "  <url>\n";
        $out .= '    <loc>' . $esc($loc) . "</loc>\n";
        if ($lastmod !== '') $out .= '    <lastmod>' . $lastmod . "</lastmod>\n";
        $out .= '    <xhtml:link rel="alternate" hreflang="ar" href="' . $esc($ar) . "\"/>\n";
        $out .= '    <xhtml:link rel="alternate" hreflang="en" href="' . $esc($en) . "\"/>\n";
        $out .= '    <xhtml:link rel="alternate" hreflang="x-default" href="' . $esc($ar) . "\"/>\n";
        foreach ($images as $path) {
            $out .= '    <image:image><image:loc>' . $esc(SPORTA_SITEMAP_ORIGIN . $path) . "</image:loc></image:image>\n";
        }
        $out .= "  </url>\n";
    }
    return $out;
}

function sporta_sitemap_product_xml(array $rows, bool $hasUpdatedAt, array $images = [], bool $withCatalogue = false): string {
    $esc = static fn (string $value): string => htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $out = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
        . ' xmlns:xhtml="http://www.w3.org/1999/xhtml"'
        . ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";
    $body = '';
    $newest = '';
    foreach ($rows as $row) {
        $slug = (string)($row['slug'] ?? '');
        if ($slug === '') continue;
        $lastmod = $hasUpdatedAt ? sporta_sitemap_lastmod($row['updated_at'] ?? null) : '';
        if ($lastmod > $newest) $newest = $lastmod;
        $body .= sporta_sitemap_url_pair(SPORTA_SITEMAP_ORIGIN . '/product/' . rawurlencode($slug), $lastmod, $images[$slug] ?? [], $esc);
    }
    // The catalogue page shows exactly these products, so it changes when they do: it is dated by the newest of them. A sitemap with no product has
    // no catalogue to list either (the caller answers that case with a 503 before it gets here).
    if ($withCatalogue && $body !== '') $body = sporta_sitemap_url_pair(SPORTA_SITEMAP_ORIGIN . '/catalogue', $newest, [], $esc) . $body;
    return $out . $body . "</urlset>\n";
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
    $slugsOf = static fn (array $list): array => array_map(static fn (array $r): string => (string)$r['slug'], $list);
    $files = sporta_sitemap_product_images($slugsOf($rows));
    // No photo file found at all = the folder is missing, unreadable or empty: the photo rule cannot be judged, so it is not applied (the same
    // guard as store_product_photo_slugs(); an empty photo list must not empty the sitemap).
    $photos = $files === [] ? array_fill_keys($slugsOf($rows), true) : array_fill_keys(array_keys($files), true);
    try {
        $skus = store_hide_products_without_sku() ? store_product_sku_slugs($db, $slugsOf($rows)) : null;
    } catch (Throwable $e) {
        error_log('Sporta sitemap SKU check unavailable: ' . get_class($e));
        sporta_seo_static_file('sitemap-products.xml', 'application/xml; charset=utf-8');
    }
    $rows = array_values(array_filter($rows, static fn (array $r): bool => store_product_listable($r, $photos, $skus)
        && preg_match(SPORTA_SITEMAP_SLUG_RE, (string)$r['slug']) === 1));
    // Photos: the ones an admin upload points at (products.image / images), then the files named after the slug; no duplicate, ten at most.
    $images = [];
    foreach ($rows as $r) {
        $slug = (string)$r['slug'];
        $list = array_slice(array_values(array_unique(array_merge(sporta_sitemap_db_images($r), $files[$slug] ?? []))), 0, 10);
        if ($list) $images[$slug] = $list;
    }
    if ($rows === []) {
        // Nothing to list is "come back later", not "everything was removed": a 503 with no body, and not cached.
        http_response_code(503);
        header('Retry-After: 3600');
        header('Cache-Control: no-store');
        return;
    }
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=1800');
    sporta_seo_send_validated(sporta_sitemap_product_xml($rows, $hasUpdatedAt, $images, true));
}

if (!defined('SPORTA_SEO_TEST')) sporta_sitemap_products_serve();
