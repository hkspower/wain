<?php
// The CATEGORY PAGES' sitemap — /men, /women, /accessories, /outlet — from the database.
//
// WHY THIS EXISTS (2026-10-01, "improve google seo sitemap and robot txt"). The four category
// pages are real, server-rendered pages (category.php: a title, a description, a canonical, the
// hreflang pair, the whole product list in the HTML) and the home page's four big tiles link to
// them — and NEITHER sitemap listed them. sitemap-pages.xml is a static file built before they
// existed, and sitemap-products.xml lists products. So the pages Google is best placed to rank
// for "men's sportswear Kuwait" were discoverable only by following links, and they were listed
// nowhere that says "this is a page to index".
//
// ONLY A CATEGORY WITH A PRODUCT IN IT IS LISTED. category.php answers an empty one with a "no
// products yet" notice; submitting a thin page to a search engine is how a site earns a
// "crawled, currently not indexed" report against it.
//
// lastmod IS THE NEWEST PRODUCT ADDED TO THAT CATEGORY, or absent — never invented. `products`
// has no updated_at column, only created_at, so an edit to an existing product's price or name
// cannot move this date; that is a limit of what is recorded, not a claim, and an absent value
// is better than a wrong one (a crawler that is told nothing changed will believe it).
//
// Served through a rewrite so the URL does not change: /sitemap-categories.xml ->
// /api/sitemap-categories.php, conditional on this file existing. Public on purpose, throttled
// like the other sitemap, and it reads nothing a visitor cannot see on the page.
declare(strict_types=1);
require __DIR__ . '/store.php';

$db = store_db();
store_throttle($db, 'sitemap', 30, 60);

const SITEMAP_SITE = 'https://www.sporta.com.kw';
// the category.php slugs, in the order the home page shows them
const SITEMAP_CATEGORIES = ['men', 'women', 'accessories', 'outlet'];

$found = [];
foreach ($db->query('select category, count(*) as n, max(created_at) as newest from products where active = 1 group by category')->fetchAll() as $r) {
    $found[(string) $r['category']] = $r;
}

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=1800');
$esc = fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";
foreach (SITEMAP_CATEGORIES as $slug) {
    $row = $found[$slug] ?? null;
    if (!$row || (int) $row['n'] < 1) continue;
    $ar = SITEMAP_SITE . '/' . $slug;                 // Arabic is the default: the bare URL
    $en = $ar . '?lang=en';
    $stamp = $row['newest'] ? gmdate('c', strtotime((string) $row['newest'])) : null;
    // Each language version is listed in its own right, with the full reciprocal set — the same
    // shape as the product sitemap, and the one Google asks for.
    foreach ([$ar, $en] as $loc) {
        echo "  <url>\n    <loc>" . $esc($loc) . "</loc>\n";
        if ($stamp) echo '    <lastmod>' . $esc($stamp) . "</lastmod>\n";
        echo '    <xhtml:link rel="alternate" hreflang="ar" href="' . $esc($ar) . "\"/>\n";
        echo '    <xhtml:link rel="alternate" hreflang="en" href="' . $esc($en) . "\"/>\n";
        echo '    <xhtml:link rel="alternate" hreflang="x-default" href="' . $esc($ar) . "\"/>\n";
        echo "  </url>\n";
    }
}
echo "</urlset>\n";
