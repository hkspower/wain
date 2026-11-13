<?php
// Which products the shop LISTS. One rule, used by the product list (api.php r=products) and by the sitemap.
//
// A product is hidden automatically when it has no name, no price, or no photo. Nothing is deleted and the
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

// True when the product is listed. $row needs slug, name_en, name_ar, price, image and images; $photoSlugs is
// store_product_photo_slugs()'s answer for the catalogue. Price is the shop's own column (a sale price never
// rescues a product that has no base price).
function store_product_listable(array $row, array $photoSlugs): bool {
    $hasName = trim((string)($row['name_en'] ?? '')) !== '' || trim((string)($row['name_ar'] ?? '')) !== '';
    $hasPrice = is_numeric($row['price'] ?? null) && (float)$row['price'] > 0;
    $hasPhoto = trim((string)($row['image'] ?? '')) !== ''
        || trim((string)($row['images'] ?? '')) !== ''
        || isset($photoSlugs[(string)($row['slug'] ?? '')]);
    return $hasName && $hasPrice && $hasPhoto;
}
