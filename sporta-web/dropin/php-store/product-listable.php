<?php
// Which products the shop LISTS. One rule, used by the product list (api.php r=products) and by the sitemap.
//
// A product is hidden automatically when it has no name or no price - and no photo, when the store config says
// hide_products_without_photo => true (OFF by default, see store_hide_products_without_photo). Nothing is deleted and the
// `active` flag is not changed: the row stays exactly as it is, and the product comes back the moment the
// missing part is supplied. The shop never shows a card with no picture, no name or a price of zero.
//
// THE PHOTO. On the live catalogue products.image and products.images are empty and the photographs are FILES
// named after the slug (/images/products/<slug>.<ext>, <slug>-view-<n>.<ext>); the sitemap has always read them
// that way. An admin upload sets products.image to its path. A product has a photo when either is true.
declare(strict_types=1);

const STORE_PRODUCT_PHOTO_DIR = '/images/products';

// The slugs, out of $slugs, that have a photo file on disk. The folder is the document root's images/products,
// which is where the sitemap and the admin upload both put photos (dirname of the api folder).
// @return array<string, true>
function store_product_photo_slugs(array $slugs): array {
    $dir = dirname(__DIR__) . STORE_PRODUCT_PHOTO_DIR;
    $files = is_dir($dir) ? (scandir($dir) ?: []) : [];
    $want = array_fill_keys(array_map('strval', $slugs), true);
    $found = [];
    foreach ($files as $file) {
        if (!preg_match('/^([a-z0-9-]+?)(?:-view-\d+)?\.(jpe?g|png|webp)$/D', $file, $m)) continue;
        if (isset($want[$m[1]])) $found[$m[1]] = true;
    }
    return $found;
}

// THE PHOTO RULE IS OFF UNLESS THE STORE CONFIG TURNS IT ON (owner decision 2026-11-18, after the independent review of the full release):
// the config key `hide_products_without_photo` must be exactly true. A read-only probe of the live shop that day found 14 of the 46 active
// products with no photo file and empty image columns; with the rule on they would have vanished from the product list, their pages and the
// sitemap the minute this file was copied. The owner chose to keep them listed (with the grey "no photo" plate) until the photographs exist.
// A missing key, a string, 1 or "true" all mean OFF: a typo must never hide the shop. A name and a price are still required either way.
function store_hide_products_without_photo(): bool {
    $c = function_exists('store_config') ? store_config() : [];
    return is_array($c) && ($c['hide_products_without_photo'] ?? false) === true;
}

// True when the product is listed. $row needs slug, name_en, name_ar, price, image and images; $photoSlugs is
// store_product_photo_slugs()'s answer for the catalogue. Price is the shop's own column (a sale price never
// rescues a product that has no base price).
function store_product_listable(array $row, array $photoSlugs): bool {
    $hasName = trim((string)($row['name_en'] ?? '')) !== '' || trim((string)($row['name_ar'] ?? '')) !== '';
    $hasPrice = is_numeric($row['price'] ?? null) && (float)$row['price'] > 0;
    $hasPhoto = !store_hide_products_without_photo()
        || trim((string)($row['image'] ?? '')) !== ''
        || trim((string)($row['images'] ?? '')) !== ''
        || isset($photoSlugs[(string)($row['slug'] ?? '')]);
    return $hasName && $hasPrice && $hasPhoto;
}
