<?php
// Which products the shop LISTS. One rule, used by the product list (api.php r=products), the stock list, the brand tiles, the assistant,
// the product page's SEO head and the sitemap.
//
// A product is hidden automatically when it lacks any of the four things a card needs (owner, 2026-11-18: "make auto hide any products
// without price 0 and sku and name and image"):
//
//   name   a name in English or Arabic                                   always
//   price  a price above zero (a sale price never rescues a missing one) always
//   sku    at least one size row with a SKU (product_variants)           ON, config hide_products_without_sku => false turns it off
//   photo  a photograph (image / images column, or a file by the slug)   ON, config hide_products_without_photo => false turns it off
//
// Nothing is deleted and the `active` flag is not changed: the row stays exactly as it is, and the product comes back the moment the
// missing part is supplied. store_product_hidden_reasons() says which parts are missing; the admin's product list shows them.
//
// THE SWITCHES FAIL TOWARDS HIDING. Both rules are ON unless the store config says exactly `false` for the key: a typo, a string "false", 0 or a
// missing key cannot make an incomplete product appear in the shop by accident. (The photo rule was OFF by default from 2026-11-18 morning, after
// a read-only probe found 14 of the 46 live products with no photo file; the owner then asked for those to be hidden, so it is ON. To keep
// photo-less products listed for a while: 'hide_products_without_photo' => false in api/config.php.)
//
// THE PHOTO. On the live catalogue products.image and products.images are empty and the photographs are FILES
// named after the slug (/images/products/<slug>.<ext>, <slug>-view-<n>.<ext>); the sitemap has always read them
// that way. An admin upload sets products.image to its path. A product has a photo when either is true.
//
// THE SKU. A SKU is a product_variants row (a size with its stock count). The live catalogue gives the accessories one row, size ONE, so every
// product has one; a product with no row at all cannot have its stock counted, and checkout would let it be bought without limit.
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

// The slugs, out of $slugs, that have at least one size row with a SKU.
// @return array<string, true>
function store_product_sku_slugs(PDO $db, array $slugs): array {
    $want = array_fill_keys(array_map('strval', $slugs), true);
    $found = [];
    foreach ($db->query("select distinct slug from product_variants where sku <> ''")->fetchAll() as $r) {
        $slug = (string)($r['slug'] ?? '');
        if (isset($want[$slug])) $found[$slug] = true;
    }
    return $found;
}

// The store config, from wherever this file was loaded: the store API has store_config(); the sitemap and the SEO head load only the config
// resolver. Missing or unreadable means no switches were set, which means every rule is ON.
function store_listing_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $cfg = [];
    try {
        if (function_exists('store_config')) {
            $c = store_config();
        } elseif (function_exists('sporta_config_path')) {
            $path = sporta_config_path('api', __DIR__ . '/config.php');
            $c = is_string($path) && is_file($path) ? require $path : [];
        } else {
            $c = [];
        }
        if (is_array($c)) $cfg = $c;
    } catch (Throwable $e) {
        $cfg = [];
    }
    return $cfg;
}

// A rule is ON unless the config says exactly false for its key (see the note at the top).
function store_listing_rule_on(string $key): bool {
    // The suites swap the config between calls; a function that exists answers fresh, the static cache is only for the resolver path.
    $c = function_exists('store_config') ? store_config() : store_listing_config();
    return !(is_array($c) && array_key_exists($key, $c) && $c[$key] === false);
}

function store_hide_products_without_photo(): bool { return store_listing_rule_on('hide_products_without_photo'); }
function store_hide_products_without_sku(): bool { return store_listing_rule_on('hide_products_without_sku'); }

// What is missing from a product, as a list of 'name', 'price', 'sku', 'photo' (empty = the shop lists it).
// $row needs slug, name_en, name_ar, price, image and images; $photoSlugs is store_product_photo_slugs()'s answer for the catalogue and
// $skuSlugs store_product_sku_slugs()'s. $skuSlugs null means "the SKU rule cannot be checked here" (a caller with no database) and the rule is
// skipped: every caller that has a database passes it.
// @return list<string>
function store_product_hidden_reasons(array $row, array $photoSlugs, ?array $skuSlugs = null): array {
    $why = [];
    if (trim((string)($row['name_en'] ?? '')) === '' && trim((string)($row['name_ar'] ?? '')) === '') $why[] = 'name';
    if (!(is_numeric($row['price'] ?? null) && (float)$row['price'] > 0)) $why[] = 'price';
    if ($skuSlugs !== null && store_hide_products_without_sku() && !isset($skuSlugs[(string)($row['slug'] ?? '')])) $why[] = 'sku';
    if (store_hide_products_without_photo()
        && trim((string)($row['image'] ?? '')) === ''
        && trim((string)($row['images'] ?? '')) === ''
        && !isset($photoSlugs[(string)($row['slug'] ?? '')])) $why[] = 'photo';
    return $why;
}

// True when the product is listed. Price is the shop's own column (a sale price never rescues a product that has no base price).
function store_product_listable(array $row, array $photoSlugs, ?array $skuSlugs = null): bool {
    return store_product_hidden_reasons($row, $photoSlugs, $skuSlugs) === [];
}

// The rows the shop lists, out of $rows (each with slug, name_en, name_ar, price, image, images): the one call every public reader makes.
function store_filter_listable(PDO $db, array $rows): array {
    $slugs = array_column($rows, 'slug');
    $photos = store_product_photo_slugs($slugs);
    $skus = store_hide_products_without_sku() ? store_product_sku_slugs($db, $slugs) : null;
    return array_values(array_filter($rows, static fn (array $r): bool => store_product_listable($r, $photos, $skus)));
}

// Every slug the shop lists right now (active products that pass the rule): what the stock list and the brand tiles are cut to.
// @return array<string, true>
function store_listable_slugs(PDO $db): array {
    $rows = $db->query('select slug, name_en, name_ar, price, image, images from products where active = 1')->fetchAll();
    return array_fill_keys(array_map(static fn (array $r): string => (string)$r['slug'], store_filter_listable($db, $rows)), true);
}
