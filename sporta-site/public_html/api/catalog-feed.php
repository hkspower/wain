<?php
/**
 * The product catalogue as a Meta (Facebook / Instagram Shopping) data feed — 2026-10-04.
 *
 *   https://www.sporta.com.kw/api/catalog-feed.php            English
 *   https://www.sporta.com.kw/api/catalog-feed.php?lang=ar    Arabic (Meta's "language feed")
 *
 * Paste the first URL into Meta Commerce Manager -> Catalogue -> Data sources -> Data feed -> scheduled
 * feed, daily. Meta then fetches it on its own; nothing here talks to Meta.
 *
 * ONE ROW PER GARMENT AND COLOUR, the same unit the shop sells and photographs. `item_group_id` is the
 * style (the slug without its colour, store_colour_from_slug()), so Instagram shows the colours of one
 * style as variants of one product. Sizes are not rows: a row is "in stock" when ANY size has stock.
 *
 * WHAT IT NEVER CARRIES: stock counts, cost, or anything withheld from ?r=products. The price is
 * store_effective_price() — the one the checkout charges — so a sale shows as sale_price over price, and
 * the sale window itself is resolved here and never sent, as api.php does.
 *
 * A GARMENT WITHOUT A PHOTOGRAPH IS LEFT OUT: Meta rejects a row with no image_link, and a rejected row
 * reads in Commerce Manager as a broken feed rather than as one missing photo.
 *
 * Public, read-only, no cookie, no session. Cached for an hour; the catalogue changes by hand.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';

$lang = (($_GET['lang'] ?? 'en') === 'ar') ? 'ar' : 'en';
$base = 'https://www.sporta.com.kw';

try {
    $db = store_db();
    $rows = $db->query(
        'select p.slug, p.name_en, p.name_ar, p.desc_en, p.desc_ar, p.price, p.sale_price, p.sale_starts_at,
                p.sale_ends_at, p.category, p.brand_slug, b.name_en brand_en, b.name_ar brand_ar,
                exists(select 1 from product_variants v where v.slug = p.slug and v.stock > 0) in_stock
           from products p left join brands b on b.slug = p.brand_slug
          where p.active = 1 order by p.slug'
    )->fetchAll(PDO::FETCH_ASSOC);
    $shots = [];
    foreach ($db->query('select slug, id, image_hash from product_images order by slug, sort, id') as $s) {
        $shots[$s['slug']][] = $base . '/api/api.php?r=product_image&id=' . (int) $s['id'] . '&v=' . substr((string) $s['image_hash'], 0, 12);
    }
} catch (Throwable $e) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    header('Retry-After: 600');
    echo "catalogue unavailable\n";
    exit;
}

$cols = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link',
         'additional_image_link', 'brand', 'item_group_id', 'color', 'google_product_category', 'product_type'];
$cat = ['women' => ["Women's activewear", 'ملابس رياضية نسائية'], 'men' => ["Men's activewear", 'ملابس رياضية رجالية'],
        'accessories' => ['Accessories', 'إكسسوارات'], 'outlet' => ['Outlet', 'أوتلت']];

$out = fopen('php://temp', 'w+');
fputcsv($out, $cols, ',', '"', '');
foreach ($rows as $r) {
    $imgs = $shots[$r['slug']] ?? [];
    if (!$imgs) continue;
    $eff = store_effective_price($r);
    $kwd = fn (int $fils): string => number_format($fils / 1000, 3, '.', '') . ' KWD';
    [$colourKey, $stem] = store_colour_from_slug((string) $r['slug']);
    $name = $lang === 'ar' ? ($r['name_ar'] ?: $r['name_en']) : ($r['name_en'] ?: $r['name_ar']);
    $desc = trim((string) ($lang === 'ar' ? ($r['desc_ar'] ?: $r['desc_en']) : ($r['desc_en'] ?: $r['desc_ar'])));
    if ($desc === '') $desc = (string) $name;   // Meta requires a description
    $brand = $lang === 'ar' ? ($r['brand_ar'] ?: $r['brand_en']) : ($r['brand_en'] ?: $r['brand_ar']);
    fputcsv($out, [
        $r['slug'],
        mb_substr((string) $name, 0, 150),
        mb_substr(preg_replace('/\s+/u', ' ', $desc) ?? $desc, 0, 5000),
        $r['in_stock'] ? 'in stock' : 'out of stock',
        'new',
        $kwd($eff['list_fils']),
        $eff['on_sale'] ? $kwd($eff['fils']) : '',
        $base . '/product/' . rawurlencode((string) $r['slug']) . ($lang === 'en' ? '?lang=en' : ''),
        $imgs[0],
        implode(',', array_slice($imgs, 1, 10)),
        $brand ?: 'Sporta',
        $stem ?? $r['slug'],
        $colourKey !== null ? STORE_COLOURS[$colourKey][$lang === 'ar' ? 1 : 0] : '',
        'Apparel & Accessories',
        ($cat[$r['category']] ?? [ucfirst((string) $r['category']), (string) $r['category']])[$lang === 'ar' ? 1 : 0],
    ], ',', '"', '');
}
rewind($out);
$csv = stream_get_contents($out);

$etag = '"' . substr(hash('sha256', $csv), 0, 32) . '"';
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: inline; filename="sporta-catalog-' . $lang . '.csv"');
header('Cache-Control: public, max-age=3600');
header('ETag: ' . $etag);
header('X-Robots-Tag: noindex');
foreach (explode(',', (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) as $t) {
    if (trim(preg_replace('/^W\//', '', trim($t)) ?? '') === $etag) { http_response_code(304); exit; }
}
echo $csv;
