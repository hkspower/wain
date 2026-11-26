<?php
// CATALOGUE V2 - the live data behind /catalogue and the PDF (owner, 2026-11-19: "full improve catalogue, full dynamic"). Design contract:
// sporta-web/CATALOGUE-V2.md. An include, never an endpoint: api.php (?r=catalogue), admin.php (catalogue_settings, catalogue_settings_save) and
// seo-page.php (the JSON-LD in the head of /catalogue) call into it, and the api .htaccess denies a direct request for this file by name.
//
// WHAT IT DECIDES, FOR EVERY READER. One builder, so the page, the PDF and the crawler's head cannot disagree about what is in the catalogue:
//   - which products: exactly the shop's own listing (store_filter_listable(): a name, a price above zero, a SKU row, a photo - AUTO-HIDE), minus
//     the slugs the owner hid, minus the categories the owner hid, minus (when the owner switched it off) the sold-out ones;
//   - in what order: pinned (the owner's order), featured, the owner's category order, then the name;
//   - with which photo: the first file that EXISTS on disk (server-verified, so the client never probes names), the 640 px copy only when it exists;
//   - the revision: the first 12 hex of the sha256 of the canonical JSON of everything a visitor can see (the payload without `generated_at`).
//     It changes if and only if something visible changes: a price, a size's stock STATE, a photo, a name, the order, a setting.
// NEVER IN THE PAYLOAD: a quantity, a SKU, a cost, a customer field, the owner's hidden / pinned lists (the admin route carries those).
//
// THE SETTINGS are ONE `settings` row, `catalogue` (no table, no column, no migration), whitelisted field by field like text_style:
//   title_ar/en (80) intro_ar/en (400) note_ar/en (200)   plain text, tags stripped, control characters removed
//   show_prices show_sold_out show_sizes show_brand cover  yes/no, default yes   (show_prices is a rendering hint for the page and the PDF; the
//                                                          prices stay in the payload because the filters and the sort need them, and the shop shows them anyway)
//   per_page                                               6, 9 or 12 (default 9)
//   categories_order / hidden_categories                   category slugs
//   hidden_slugs / pinned_slugs                            product slugs that exist, at most 200 each
// A saved row that does not match reads as the DEFAULT of that field (never as "off": a typo cannot hide the catalogue); a save that does not
// match is refused with a token and nothing is written. The defaults reproduce the page as it is today.
declare(strict_types=1);

const STORE_CATALOGUE_ORIGIN = 'https://www.sporta.com.kw';
const STORE_CATALOGUE_PER_PAGE = [6, 9, 12];
const STORE_CATALOGUE_MAX_LIST = 200;
const STORE_CATALOGUE_STRING_LIMITS = ['title_ar' => 80, 'title_en' => 80, 'intro_ar' => 400, 'intro_en' => 400, 'note_ar' => 200, 'note_en' => 200];
const STORE_CATALOGUE_SWITCHES = ['show_prices', 'show_sold_out', 'show_sizes', 'show_brand', 'cover'];
// Today's page: men, women, hoodies and jackets, accessories, then any other category by name.
const STORE_CATALOGUE_DEFAULT_ORDER = ['men', 'women', 'outerwear', 'accessories'];
const STORE_CATALOGUE_CATEGORY_NAMES = [
    'men' => ['رجال', 'Men'], 'women' => ['نساء', 'Women'], 'kids' => ['أطفال', 'Kids'],
    'outerwear' => ['هوديز وجواكيت', 'Hoodies & Jackets'], 'accessories' => ['إكسسوارات', 'Accessories'],
    'footwear' => ['أحذية', 'Footwear'], 'shoes' => ['أحذية', 'Shoes'],
];
const STORE_CATALOGUE_PHOTO_DIR = '/images/products';
const STORE_CATALOGUE_JSONLD_MAX = 100;

function store_catalogue_defaults(): array {
    return ['title_ar' => '', 'title_en' => '', 'intro_ar' => '', 'intro_en' => '', 'note_ar' => '', 'note_en' => '',
        'show_prices' => true, 'show_sold_out' => true, 'show_sizes' => true, 'show_brand' => true, 'cover' => true, 'per_page' => 9,
        'categories_order' => [], 'hidden_categories' => [], 'hidden_slugs' => [], 'pinned_slugs' => []];
}

// A category as a slug: lower case, letters digits - _ only (the column is free text; the URL and the filter chips need a stable key).
function store_catalogue_category_slug(mixed $category): string {
    $s = strtolower(trim((string)$category));
    $s = trim((string)preg_replace('/[^a-z0-9_-]+/', '-', $s), '-');
    return $s === '' ? 'other' : substr($s, 0, 40);
}

function store_catalogue_text(string $v): string {
    // plain text: markup stripped, control characters (a newline included) become nothing, runs of spaces collapse
    // Only REAL markup goes (a comment, a tag that starts with a letter or a slash): strip_tags() also threw away everything after any "<" that is
    // followed by a non-space ("Sale <3 now" became "Sale "), and a save succeeded with the shortened sentence (review C4, 2026-11-19). Three passes
    // so a tag built around another one ("<scr<b>ipt>") cannot survive; the text is escaped wherever it is written, this keeps it plain.
    for ($i = 0; $i < 3; $i++) {
        $w = (string)preg_replace(['~<!--.*?-->~s', '~</?[a-z][^>]*>~i'], '', $v);
        if ($w === $v) break;
        $v = $w;
    }
    $v = (string)preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v);
    return trim((string)preg_replace('/ {2,}/', ' ', $v));
}

/** A list of slugs. Non-strict (a stored row): anything that is not a valid, known slug is dropped. Strict (a save): a bad entry is refused.
 *  @param array<string, true>|null $known the slugs that exist (null = format check only) */
function store_catalogue_slug_list(mixed $raw, string $key, string $pattern, ?array $known, string $unknownToken, bool $strict): array {
    if (!is_array($raw) || !array_is_list($raw)) {
        if ($strict) store_fail("invalid_{$key}");
        return [];
    }
    if ($strict && count($raw) > STORE_CATALOGUE_MAX_LIST * 2) store_fail("invalid_{$key}");
    $out = [];
    foreach ($raw as $one) {
        if (!is_string($one) || !preg_match($pattern, $one)) {
            if ($strict) store_fail("invalid_{$key}");
            continue;
        }
        if ($known !== null && !isset($known[$one])) {
            if ($strict) store_fail($unknownToken);
            continue;
        }
        $out[$one] = true;
    }
    $out = array_keys($out);
    if (count($out) > STORE_CATALOGUE_MAX_LIST) {
        if ($strict) store_fail("invalid_{$key}");
        $out = array_slice($out, 0, STORE_CATALOGUE_MAX_LIST);
    }
    return $out;
}

/** The settings, whitelisted. $raw is the stored row (strict = false) or the merged request (strict = true: the first problem is refused with a token).
 *  $knownProducts / $knownCategories: the slugs that exist (null = format check only).
 *  @return array<string, mixed> */
function store_catalogue_clean(array $raw, bool $strict = false, ?array $knownProducts = null, ?array $knownCategories = null): array {
    $d = store_catalogue_defaults();
    $out = $d;
    foreach (STORE_CATALOGUE_STRING_LIMITS as $key => $limit) {
        if (!array_key_exists($key, $raw)) continue;
        $v = $raw[$key];
        if (!is_string($v) || strlen($v) > $limit * 8) {
            if ($strict) store_fail("invalid_{$key}");
            continue;
        }
        $clean = store_catalogue_text($v);
        if (mb_strlen($clean) > $limit) {
            if ($strict) store_fail("invalid_{$key}");
            $clean = mb_substr($clean, 0, $limit);
        }
        $out[$key] = $clean;
    }
    foreach (STORE_CATALOGUE_SWITCHES as $key) {
        if (!array_key_exists($key, $raw)) continue;
        $v = $raw[$key];
        if (is_bool($v)) { $out[$key] = $v; continue; }
        if ($v === 0 || $v === 1) { $out[$key] = (bool)$v; continue; }
        if ($strict) store_fail("invalid_{$key}");
    }
    if (array_key_exists('per_page', $raw)) {
        $v = $raw['per_page'];
        if (is_string($v) && preg_match('/^[0-9]{1,2}$/D', $v)) $v = (int)$v;
        if (is_int($v) && in_array($v, STORE_CATALOGUE_PER_PAGE, true)) $out['per_page'] = $v;
        elseif ($strict) store_fail('invalid_per_page');
    }
    $catRe = '/^[a-z0-9][a-z0-9_-]{0,39}$/D';
    $slugRe = '/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/D';
    foreach (['categories_order', 'hidden_categories'] as $key) {
        if (array_key_exists($key, $raw)) $out[$key] = store_catalogue_slug_list($raw[$key], $key, $catRe, $knownCategories, 'unknown_category', $strict);
    }
    foreach (['hidden_slugs', 'pinned_slugs'] as $key) {
        if (array_key_exists($key, $raw)) $out[$key] = store_catalogue_slug_list($raw[$key], $key, $slugRe, $knownProducts, 'unknown_product', $strict);
    }
    return $out;
}

/** The settings as stored, cleaned for the reader (public builder, admin read). */
function store_catalogue_settings(PDO $db, ?array $knownProducts = null, ?array $knownCategories = null): array {
    return store_catalogue_clean(store_setting_row($db, 'catalogue'), false, $knownProducts, $knownCategories);
}

/** @return array{0: array<string, true>, 1: array<string, true>} every product slug that exists (any state), every category slug in use */
function store_catalogue_known(PDO $db): array {
    $products = [];
    $cats = [];
    foreach ($db->query('select slug, category from products')->fetchAll() as $r) {
        $products[(string)$r['slug']] = true;
        $cats[store_catalogue_category_slug($r['category'] ?? '')] = true;
    }
    return [$products, $cats];
}

function store_catalogue_category_names(string $slug): array {
    if (isset(STORE_CATALOGUE_CATEGORY_NAMES[$slug])) return ['ar' => STORE_CATALOGUE_CATEGORY_NAMES[$slug][0], 'en' => STORE_CATALOGUE_CATEGORY_NAMES[$slug][1]];
    $en = ucfirst(str_replace(['-', '_'], ' ', $slug));
    return ['ar' => $en, 'en' => $en];   // never empty: an unknown category reads the same in both languages
}

/** Photos of products, as files on disk: slug => [main, view 1, view 2 ...] (at most 10), public paths.
 *  @param array<string, true> $want
 *  @return array<string, list<string>> */
function store_catalogue_photo_files(array $want): array {
    $dir = dirname(__DIR__) . STORE_CATALOGUE_PHOTO_DIR;
    $files = is_dir($dir) ? scandir($dir) : false;
    $rank = ['jpg' => 0, 'jpeg' => 1, 'png' => 2, 'webp' => 3];
    $found = [];
    foreach (is_array($files) ? $files : [] as $file) {
        if (!preg_match('/^([a-z0-9-]+?)(?:-view-(\d+))?\.(jpe?g|png|webp)$/D', $file, $m)) continue;
        if (!isset($want[$m[1]])) continue;
        $found[$m[1]][] = [(int)($m[2] ?: 0), $rank[$m[3]], $file];
    }
    $out = [];
    foreach ($found as $slug => $list) {
        usort($list, static fn (array $a, array $b): int => $a[0] <=> $b[0] ?: $a[1] <=> $b[1] ?: strcmp($a[2], $b[2]));
        $out[$slug] = array_slice(array_map(static fn (array $x): string => STORE_CATALOGUE_PHOTO_DIR . '/' . $x[2], $list), 0, 10);
    }
    return $out;
}

/** The photos products.image / products.images name: same-origin picture paths of the media folder that EXIST (a path left behind by a deleted file
 *  must not be advertised), main first.
 *  @return list<string> */
function store_catalogue_db_photos(array $row): array {
    $out = [];
    $root = dirname(__DIR__);
    foreach (array_merge([(string)($row['image'] ?? '')], explode(',', (string)($row['images'] ?? ''))) as $one) {
        $one = trim($one);
        if (preg_match('~^/images/products/[A-Za-z0-9_.-]{1,160}\.(?:jpe?g|png|webp)$~Di', $one) && !str_contains($one, '..') && is_file($root . $one)) $out[] = $one;
    }
    return array_values(array_unique($out));
}

/** The 640 px WebP copy of a photo, only when the file exists: /images/products/responsive/<stem>-640.webp. */
function store_catalogue_small_copy(string $path): ?string {
    if (!preg_match('~^(/images/products)/([A-Za-z0-9_.-]+)\.(?:jpe?g|png|webp)$~Di', $path, $m)) return null;
    $rel = $m[1] . '/responsive/' . $m[2] . '-640.webp';
    return is_file(dirname(__DIR__) . $rel) ? $rel : null;
}

function store_catalogue_size_rank(string $size): int {
    $i = array_search($size, STORE_SIZES, true);
    return $i === false ? 100 : (int)$i;
}

/** Everything the builders share, read once: the shop's own listing, the sizes' stock STATE, the brands, the photos and the settings.
 *  @return array{rows: list<array>, settings: array, sizes: array, brands: array, photos: array, known: array} */
function store_catalogue_load(PDO $db): array {
    require_once __DIR__ . '/product-listable.php';
    [$knownProducts, $knownCategories] = store_catalogue_known($db);
    $settings = store_catalogue_settings($db, $knownProducts, $knownCategories);
    $rows = $db->query(
        'select p.slug, p.name_en, p.name_ar, p.price, p.sale_price, p.sale_starts_at, p.sale_ends_at, p.featured, p.featured_sort, p.category,
                p.image, p.images, p.brand_slug,
                b.slug as b_slug, b.name_en as b_name_en, b.name_ar as b_name_ar,
                case when b.logo is null or b.logo = \'\' then 0 else 1 end as b_has_logo,
                substr(sha2(coalesce(b.logo, \'\'), 256), 1, 12) as b_logo_v
           from products p
           left join brands b on b.slug = p.brand_slug and b.active = 1
          where p.active = 1'
    )->fetchAll();
    $rows = store_filter_listable($db, $rows);   // AUTO-HIDE: the same call every other reader makes
    $sizes = [];
    foreach ($db->query('select slug, size, (stock > 0) as in_stock from product_variants')->fetchAll() as $v) {
        $size = store_size_canonical((string)$v['size']);
        $slug = (string)$v['slug'];
        // two rows that fold to one size count as in stock if either is
        $sizes[$slug][$size] = ($sizes[$slug][$size] ?? false) || (bool)$v['in_stock'];
    }
    return ['rows' => $rows, 'settings' => $settings, 'sizes' => $sizes,
        'photos' => store_catalogue_photo_files(array_fill_keys(array_column($rows, 'slug'), true)), 'known' => [$knownProducts, $knownCategories]];
}

/** The catalogue's categories in the owner's order (hidden ones left out): the owner's list first, then the default order, then the rest by name.
 *  @param list<string> $present category slugs that have a product */
function store_catalogue_category_order(array $present, array $settings): array {
    $present = array_values(array_unique($present));
    $hidden = array_fill_keys($settings['hidden_categories'], true);
    $order = [];
    foreach (array_merge($settings['categories_order'], STORE_CATALOGUE_DEFAULT_ORDER) as $slug) {
        if (in_array($slug, $present, true) && !isset($order[$slug])) $order[$slug] = true;
    }
    $rest = array_values(array_filter($present, static fn (string $s): bool => !isset($order[$s])));
    sort($rest, SORT_STRING);
    foreach ($rest as $slug) $order[$slug] = true;
    return array_values(array_filter(array_keys($order), static fn (string $s): bool => !isset($hidden[$s])));
}

/** One product as the page sees it (and its sort keys, removed before output). */
function store_catalogue_product(array $row, array $load): array {
    $slug = (string)$row['slug'];
    $eff = store_effective_price($row);
    $price = round($eff['fils'] / 1000, 3);
    $list = round($eff['list_fils'] / 1000, 3);
    $sizes = [];
    foreach ($load['sizes'][$slug] ?? [] as $size => $in) $sizes[] = ['size' => (string)$size, 'in_stock' => (bool)$in];
    usort($sizes, static fn (array $a, array $b): int => store_catalogue_size_rank($a['size']) <=> store_catalogue_size_rank($b['size']) ?: strcmp($a['size'], $b['size']));
    // no size rows = the shop does not know the stock: not "sold out"
    $inStock = $sizes === [] ? true : in_array(true, array_column($sizes, 'in_stock'), true);
    $photos = array_slice(array_values(array_unique(array_merge(store_catalogue_db_photos($row), $load['photos'][$slug] ?? []))), 0, 10);
    $main = $photos[0] ?? null;
    return [
        'slug' => $slug,
        'name_ar' => trim((string)($row['name_ar'] ?? '')), 'name_en' => trim((string)($row['name_en'] ?? '')),
        'category' => store_catalogue_category_slug($row['category'] ?? ''),
        'brand' => $row['b_slug'] !== null && $row['b_slug'] !== '' ? (string)$row['b_slug'] : null,
        'price' => $price, 'list_price' => $list,
        'pct_off' => $eff['on_sale'] && $list > 0 ? (int)round(($list - $price) / $list * 100) : 0,
        'on_sale' => (bool)$eff['on_sale'],
        'featured' => (bool)$row['featured'], 'pinned' => false,
        'in_stock' => $inStock, 'sizes' => $sizes,
        'image' => $main, 'image_small' => $main === null ? null : store_catalogue_small_copy($main), 'images' => $photos,
    ];
}

function store_catalogue_sort_name(array $p): string { return mb_strtolower($p['name_en'] !== '' ? $p['name_en'] : $p['name_ar']); }

/** The public payload (see CATALOGUE-V2.md): revision, generated_at, count, settings, categories, brands, products.
 *  @return array<string, mixed> */
function store_catalogue_build(PDO $db, ?array $load = null): array {
    $load ??= store_catalogue_load($db);
    $s = $load['settings'];
    $hiddenSlug = array_fill_keys($s['hidden_slugs'], true);
    $hiddenCat = array_fill_keys($s['hidden_categories'], true);
    $pinnedPos = array_flip($s['pinned_slugs']);
    $items = [];
    $featuredSort = [];
    foreach ($load['rows'] as $row) {
        $slug = (string)$row['slug'];
        if (isset($hiddenSlug[$slug])) continue;
        $p = store_catalogue_product($row, $load);
        if (isset($hiddenCat[$p['category']])) continue;
        if (!$s['show_sold_out'] && !$p['in_stock']) continue;
        $p['pinned'] = isset($pinnedPos[$slug]);
        $featuredSort[$slug] = (int)($row['featured_sort'] ?? 0);
        $items[] = $p;
    }
    $order = store_catalogue_category_order(array_column($items, 'category'), $s);
    $catPos = array_flip($order);
    usort($items, static function (array $a, array $b) use ($pinnedPos, $catPos, $featuredSort): int {
        return [$a['pinned'] ? 0 : 1, $pinnedPos[$a['slug']] ?? 0, $a['featured'] ? 0 : 1, $a['featured'] ? $featuredSort[$a['slug']] : 0, $catPos[$a['category']] ?? 999, store_catalogue_sort_name($a), $a['slug']]
            <=> [$b['pinned'] ? 0 : 1, $pinnedPos[$b['slug']] ?? 0, $b['featured'] ? 0 : 1, $b['featured'] ? $featuredSort[$b['slug']] : 0, $catPos[$b['category']] ?? 999, store_catalogue_sort_name($b), $b['slug']];
    });
    $counts = [];
    $brandCounts = [];
    foreach ($items as $p) {
        $counts[$p['category']] = ($counts[$p['category']] ?? 0) + 1;
        if ($p['brand'] !== null) $brandCounts[$p['brand']] = ($brandCounts[$p['brand']] ?? 0) + 1;
    }
    $categories = [];
    foreach ($order as $slug) {
        $n = store_catalogue_category_names($slug);
        $categories[] = ['slug' => $slug, 'name_ar' => $n['ar'], 'name_en' => $n['en'], 'count' => $counts[$slug] ?? 0];
    }
    $brands = [];
    $seen = [];
    foreach ($load['rows'] as $row) {
        $b = (string)($row['b_slug'] ?? '');
        if ($b === '' || isset($seen[$b]) || !isset($brandCounts[$b])) continue;
        $seen[$b] = true;
        $brands[] = ['slug' => $b, 'name_ar' => (string)$row['b_name_ar'], 'name_en' => (string)$row['b_name_en'],
            'logo' => (int)$row['b_has_logo'] === 1 ? '/api/api.php?r=brand_logo&slug=' . rawurlencode($b) . '&v=' . $row['b_logo_v'] : null,
            'count' => $brandCounts[$b]];
    }
    usort($brands, static fn (array $a, array $b): int => strcmp(mb_strtolower($a['name_en']), mb_strtolower($b['name_en'])) ?: strcmp($a['slug'], $b['slug']));
    $public = [];
    foreach (array_merge(['title_ar', 'title_en', 'intro_ar', 'intro_en', 'note_ar', 'note_en'], STORE_CATALOGUE_SWITCHES, ['per_page']) as $k) $public[$k] = $s[$k];
    $body = ['count' => count($items), 'settings' => $public, 'categories' => $categories, 'brands' => $brands, 'products' => $items];
    return ['revision' => store_catalogue_revision($body), 'generated_at' => gmdate('Y-m-d\TH:i:s\Z')] + $body;
}

/** First 12 hex of the sha256 of the canonical JSON of the payload (everything but generated_at and the revision itself). */
function store_catalogue_revision(array $body): string {
    unset($body['revision'], $body['generated_at']);
    $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    return substr(hash('sha256', (string)$json), 0, 12);
}

/** Does an If-None-Match header name this ETag? mod_deflate appends -gzip / -br and a proxy may add W/: both are stripped, the way seo-page.php does. */
function store_catalogue_etag_matches(string $header, string $etag): bool {
    foreach (explode(',', $header) as $tag) {
        $tag = (string)preg_replace('~^W/~', '', trim($tag));
        $tag = (string)preg_replace('~-(gzip|br)"$~', '"', $tag);
        if ($tag === $etag || $tag === '*') return true;
    }
    return false;
}

/** The public route: 200 with the payload and an ETag, or 304 with none. Never returns. */
function store_catalogue_serve(PDO $db): void {
    $payload = store_catalogue_build($db);
    $etag = '"' . $payload['revision'] . '"';
    header('ETag: ' . $etag);
    header('Cache-Control: no-cache');
    if (store_catalogue_etag_matches((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''), $etag)) {
        http_response_code(304);
        exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        exit;
    }
    store_out($payload);
}

/** The owner's read: the settings, every product with its hidden / pinned state and the reason AUTO-HIDE hides any, the categories, the share
 *  links and the status. No quantity, SKU, cost or customer field. */
function store_catalogue_admin(PDO $db): array {
    require_once __DIR__ . '/product-listable.php';
    $load = store_catalogue_load($db);
    $public = store_catalogue_build($db, $load);
    $s = $load['settings'];
    $all = $db->query('select slug, name_en, name_ar, price, image, images, category, brand_slug, active from products order by name_en, slug')->fetchAll();
    $slugs = array_column($all, 'slug');
    $photos = store_product_photo_slugs($slugs);
    $skus = store_product_sku_slugs($db, $slugs);
    $hiddenSlug = array_fill_keys($s['hidden_slugs'], true);
    $hiddenCat = array_fill_keys($s['hidden_categories'], true);
    $pinned = array_fill_keys($s['pinned_slugs'], true);
    $inCatalogue = array_column($public['products'], null, 'slug');
    $products = [];
    $catCounts = [];
    foreach ($all as $row) {
        $slug = (string)$row['slug'];
        $reasons = store_product_hidden_reasons($row, $photos, $skus);
        $cat = store_catalogue_category_slug($row['category'] ?? '');
        $listed = (int)$row['active'] === 1 && $reasons === [];
        if ($listed) $catCounts[$cat] = ($catCounts[$cat] ?? 0) + 1;
        $file = store_catalogue_db_photos($row)[0] ?? ($load['photos'][$slug][0] ?? null);
        $products[] = ['slug' => $slug, 'name_ar' => (string)$row['name_ar'], 'name_en' => (string)$row['name_en'], 'category' => $cat,
            'brand' => $row['brand_slug'] === null || $row['brand_slug'] === '' ? null : (string)$row['brand_slug'],
            'price' => round(store_fils($row['price'] ?? 0) / 1000, 3), 'image' => $file,
            'active' => (int)$row['active'] === 1, 'listed' => $listed, 'hidden_reasons' => $reasons,
            'hidden_from_catalogue' => isset($hiddenSlug[$slug]), 'category_hidden' => isset($hiddenCat[$cat]),
            'pinned' => isset($pinned[$slug]), 'in_catalogue' => isset($inCatalogue[$slug])];
    }
    $categories = [];
    foreach (store_catalogue_category_order(array_keys($catCounts), ['hidden_categories' => []] + $s) as $slug) {
        $n = store_catalogue_category_names($slug);
        $categories[] = ['slug' => $slug, 'name_ar' => $n['ar'], 'name_en' => $n['en'], 'count' => $catCounts[$slug], 'hidden' => isset($hiddenCat[$slug])];
    }
    $o = STORE_CATALOGUE_ORIGIN . '/catalogue';
    $links = static fn (string $q): array => [
        'page' => ['ar' => $o . ($q === '' ? '' : '?' . $q), 'en' => $o . '?' . ($q === '' ? '' : $q . '&') . 'lang=en'],
        'pdf' => ['ar' => $o . '?' . ($q === '' ? '' : $q . '&') . 'pdf=ar', 'en' => $o . '?' . ($q === '' ? '' : $q . '&') . 'pdf=en'],
    ];
    $share = $links('') + ['categories' => [], 'brands' => []];
    foreach ($public['categories'] as $c) $share['categories'][] = ['slug' => $c['slug']] + $links('cat=' . rawurlencode($c['slug']));
    foreach ($public['brands'] as $b) $share['brands'][] = ['slug' => $b['slug']] + $links('brand=' . rawurlencode($b['slug']));
    $in = $public['products'];
    return [
        'settings' => $s,
        'defaults' => store_catalogue_defaults(),
        'limits' => ['title' => 80, 'intro' => 400, 'note' => 200, 'per_page' => STORE_CATALOGUE_PER_PAGE, 'list' => STORE_CATALOGUE_MAX_LIST],
        'categories' => $categories,
        'products' => $products,
        'share' => $share,
        'status' => [
            'revision' => $public['revision'], 'generated_at' => $public['generated_at'],
            'listed' => count($load['rows']), 'in_catalogue' => count($in),
            'on_sale' => count(array_filter($in, static fn (array $p): bool => $p['on_sale'])),
            'sold_out' => count(array_filter($in, static fn (array $p): bool => !$p['in_stock'])),
            'hidden_by_owner' => count(array_filter($products, static fn (array $p): bool => $p['hidden_from_catalogue'] || $p['category_hidden'])),
            'hidden_by_rules' => count(array_filter($products, static fn (array $p): bool => $p['active'] && $p['hidden_reasons'] !== [])),
            'pinned' => count(array_filter($in, static fn (array $p): bool => $p['pinned'])),
        ],
    ];
}

/** Save from the admin: the request's keys over the stored settings (a key the request leaves out keeps its stored value), validated whole; nothing is
 *  written unless every field passes. Yes/no fields go through store_admin_switch(). Returns the new admin read.
 *  @param array<string, mixed> $in the request, either the settings themselves or {"settings": {...}} */
function store_catalogue_save(PDO $db, array $in): array {
    $in = is_array($in['settings'] ?? null) ? $in['settings'] : $in;
    [$knownProducts, $knownCategories] = store_catalogue_known($db);
    $current = store_catalogue_settings($db, $knownProducts, $knownCategories);
    $merged = $current;
    foreach (array_keys($current) as $key) {
        if (!array_key_exists($key, $in)) continue;
        $merged[$key] = $in[$key];
    }
    foreach (STORE_CATALOGUE_SWITCHES as $key) $merged[$key] = store_admin_switch($merged, $key, $current[$key]);
    $clean = store_catalogue_clean($merged, true, $knownProducts, $knownCategories);
    store_setting_save($db, 'catalogue', $clean);
    return store_catalogue_admin($db);
}

// ---------------------------------------------------------------- crawlers

/** The JSON-LD of /catalogue (CollectionPage + ItemList), or null when the shop has nothing to list (an empty list is not published).
 *  Same products and order as the route, at most STORE_CATALOGUE_JSONLD_MAX, in the page's language. Prices only when the owner shows them. */
function store_catalogue_jsonld(array $payload, string $lang, string $name, string $description): ?array {
    $products = array_slice($payload['products'] ?? [], 0, STORE_CATALOGUE_JSONLD_MAX);
    if ($products === []) return null;
    $ar = $lang === 'ar';
    $suffix = $ar ? '' : '?lang=en';
    $showPrices = (bool)($payload['settings']['show_prices'] ?? true);
    $items = [];
    foreach ($products as $i => $p) {
        $pname = $p[$ar ? 'name_ar' : 'name_en'] !== '' ? $p[$ar ? 'name_ar' : 'name_en'] : $p[$ar ? 'name_en' : 'name_ar'];
        $url = STORE_CATALOGUE_ORIGIN . '/product/' . rawurlencode((string)$p['slug']) . $suffix;
        $item = ['@type' => 'Product', 'name' => $pname, 'url' => $url];
        if ($p['image'] !== null) $item['image'] = STORE_CATALOGUE_ORIGIN . $p['image'];
        if ($showPrices) {
            $item['offers'] = ['@type' => 'Offer', 'url' => $url, 'priceCurrency' => 'KWD', 'price' => number_format((float)$p['price'], 3, '.', ''),
                'availability' => $p['in_stock'] ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'];
        }
        $items[] = ['@type' => 'ListItem', 'position' => $i + 1, 'item' => $item];
    }
    return [
        '@context' => 'https://schema.org', '@type' => 'CollectionPage',
        'name' => $name, 'description' => $description,
        'url' => STORE_CATALOGUE_ORIGIN . '/catalogue' . $suffix, 'inLanguage' => $ar ? 'ar' : 'en',
        'mainEntity' => ['@type' => 'ItemList', 'numberOfItems' => count($items), 'itemListElement' => $items],
    ];
}
