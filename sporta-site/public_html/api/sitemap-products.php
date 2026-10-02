<?php
// The product sitemap, from the DATABASE, at the moment Google asks for it.
//
// WHY THIS EXISTS. The static sitemap-products.xml is generated at BUILD time
// from sporta-html5/assets/products.js — the no-build fallback site's catalogue,
// a file the owner never opens. The real catalogue is MySQL, edited in
// /backends. The two agree today only because both were seeded from the same
// forty-six products, and they stop agreeing the first time a product is added
// or deactivated in the admin.
//
// What that failure looks like is the reason it is worth fixing rather than
// noting: it is SILENT IN BOTH DIRECTIONS. A new product is simply never
// crawled — no error, no warning, it just does not appear in Google for however
// many months pass before somebody checks. A removed one keeps being requested,
// and /product/<gone> answers 200 with a "not found" body, because the SPA
// answers 200 for every path; Google files those as soft-404s against the
// domain. Neither shows up in any test that asks "does this URL respond".
//
// Served through a rewrite so the URL does not change:
//   /sitemap-products.xml  ->  /api/sitemap-products.php
// and the rewrite is conditional on this file existing, so a deployment
// without it falls back to the static copy rather than 500ing.
//
// PUBLIC ON PURPOSE, and it is the one route here that should be: a sitemap
// nobody can fetch is not a sitemap. It reads nothing a visitor cannot already
// see on /shop — slug and a timestamp — and it is throttled like the rest.

declare(strict_types=1);
require __DIR__ . '/store.php';

$db = store_db();
store_throttle($db, 'sitemap', 30, 60);

// THE SAME ORIGIN THE REST OF THE SITE EMITS. Hard-coded rather than derived
// from HTTP_HOST: a request arriving at the bare domain or at the server's IP
// would otherwise mint a sitemap full of non-canonical URLs, which is the exact
// mistake the single-hop redirects elsewhere exist to prevent.
const SITEMAP_SITE = 'https://www.sporta.com.kw';

$rows = $db->query(
    // updated_at where the table has it, else created_at, else nothing — the
    // sitemap must not invent a lastmod, because a wrong one is worse than an
    // absent one: it tells a crawler nothing changed when something did.
    'select slug, created_at from products where active = 1 order by slug'
)->fetchAll();

// Products the owner has kept out of the sitemap in /backends → SEO (2026-10-02). Still on sale and
// still reachable; just not offered to crawlers. A fault reading the list excludes nothing.
try { $skip = array_flip(store_crawl($db)['exclude']); } catch (Throwable $e) { $skip = []; }
if ($skip) $rows = array_values(array_filter($rows, static fn ($r) => !isset($skip[(string) $r['slug']])));

// THE PHOTOGRAPHS, so Google Images and the shopping surfaces can find them. A product's pictures
// are rows in product_images, served from api.php?r=product_image at a URL carrying the content
// hash — the same URL the page's og:image and its JSON-LD already name (seo.php), so the sitemap
// and the page cannot disagree about which picture is which. At most five per product (the
// protocol allows 1,000; five is more than a card ever shows). robots.txt allows exactly that one
// route under /api/ — without it the picture would be listed here and disallowed there, which
// Search Console reports as "blocked by robots.txt".
$pictures = [];
try {
    foreach ($db->query('select slug, id, image_hash from product_images order by slug, sort, id')->fetchAll() as $p) {
        $slugP = (string) $p['slug'];
        if (count($pictures[$slugP] ?? []) >= 5) continue;
        $pictures[$slugP][] = SITEMAP_SITE . '/api/api.php?r=product_image&id=' . (int) $p['id']
            . '&v=' . substr((string) $p['image_hash'], 0, 12);
    }
} catch (Throwable $e) { /* no table yet: a sitemap without pictures is still a sitemap */ }
$names = [];
foreach ($db->query('select slug, name_en, name_ar from products where active = 1')->fetchAll() as $n) {
    $names[(string) $n['slug']] = [(string) $n['name_en'], (string) $n['name_ar']];
}

header('Content-Type: application/xml; charset=utf-8');
// Half an hour. Long enough that a crawl does not hit the database repeatedly,
// short enough that a product added in the admin is visible the same morning.
header('Cache-Control: public, max-age=1800');

$esc = fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' .
     ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' .
     ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";

foreach ($rows as $r) {
    $url = SITEMAP_SITE . '/product/' . rawurlencode((string) $r['slug']);
    // ARABIC IS THE DEFAULT, so the bare URL is the Arabic page and English
    // lives at ?lang=en. x-default points at the bare one. These three lines
    // are the same claim index.html, usePageMeta and the static sitemap make;
    // three sources saying three things is how an hreflang cluster is thrown
    // away, and npm run test:seo holds them together.
    $stamp = $r['created_at'] ? gmdate('c', strtotime((string) $r['created_at'])) : null;

    // BOTH LANGUAGES GET THEIR OWN <url> ENTRY, each carrying the same three
    // alternates. This is the shape the static sitemap already used and it is
    // the one Google asks for: every language version listed in its own right,
    // with a complete reciprocal set. Emitting only the Arabic URL — as the
    // first draft of this file did — halves the sitemap and leaves the English
    // pages discoverable only by being linked to, which for a shop whose SEO
    // problem was being indexed in one language is precisely the wrong half to
    // drop.
    foreach ([$url, $url . '?lang=en'] as $loc) {
        echo "  <url>\n";
        echo '    <loc>' . $esc($loc) . "</loc>\n";
        if ($stamp) echo '    <lastmod>' . $esc($stamp) . "</lastmod>\n";
        echo '    <xhtml:link rel="alternate" hreflang="ar" href="' . $esc($url) . "\"/>\n";
        echo '    <xhtml:link rel="alternate" hreflang="en" href="' . $esc($url . '?lang=en') . "\"/>\n";
        echo '    <xhtml:link rel="alternate" hreflang="x-default" href="' . $esc($url) . "\"/>\n";
        foreach ($pictures[(string) $r['slug']] ?? [] as $pic) {
            $title = $names[(string) $r['slug']][$loc === $url ? 1 : 0] ?? '';   // the page's own language
            echo '    <image:image><image:loc>' . $esc($pic) . '</image:loc>'
               . ($title !== '' ? '<image:title>' . $esc($title) . '</image:title>' : '')
               . "</image:image>\n";
        }
        echo "  </url>\n";
    }
}
echo "</urlset>\n";
