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

header('Content-Type: application/xml; charset=utf-8');
// Half an hour. Long enough that a crawl does not hit the database repeatedly,
// short enough that a product added in the admin is visible the same morning.
header('Cache-Control: public, max-age=1800');

$esc = fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' .
     ' xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";

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
        echo "  </url>\n";
    }
}
echo "</urlset>\n";
