<?php
/**
 * What the LIVE shop has by way of images-in-the-database and SEO, measured on
 * the server.
 *
 *   php /home/<user>/live-seo-check.php
 *
 * READ-ONLY, like live-scan.php and for the same reason: it is fetched over
 * plain HTTP from a public repository by a cron job, so anything it can do,
 * anyone who can influence that fetch can do. SELECTs, file reads and loopback
 * GETs. Nothing here writes.
 *
 * IT PRINTS NO SECRET and no image bytes -- a product photograph is a data:
 * URI in a longtext column and one row would be larger than this whole output.
 * Counts, names and yes/no answers only.
 *
 * WHY THE TWO HALVES ARE ONE SCRIPT. They are the same question asked twice.
 * A garment with no photograph is invisible to a shopper AND has nothing for
 * Open Graph to show when its page is shared, so it is both a shop problem and
 * an SEO one; the product sitemap listing a URL whose page has no image is the
 * crawler's version of the same gap.
 *
 * The loopback carries the host in a header because the server cannot resolve
 * its own domain, and the redirect-free form is deliberate: a sitemap that
 * 301s is a sitemap the crawler follows once and then distrusts.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$HOST = 'www.sporta.com.kw';

function get(string $path, string $host): array
{
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => ['Host: ' . $host],
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => 25,
    ]);
    $body   = (string) curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, $body];
}

$out = [];

// ------------------------------------------------- images kept in the database
$cfg = @include $ROOT . '/api/config.php';
if (is_array($cfg)) {
    try {
        $pdo = new PDO(
            "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
            $cfg['db_user'], $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
        );

        $imgs = (int) $pdo->query('select count(*) from product_images')->fetchColumn();
        $withImg = (int) $pdo->query(
            'select count(*) from products p where p.active = 1 and exists' .
            ' (select 1 from product_images i where i.slug = p.slug)'
        )->fetchColumn();
        $active = (int) $pdo->query('select count(*) from products where active = 1')->fetchColumn();
        $out[] = "productImages={$imgs}rows photos={$withImg}/{$active}active";

        // A garment with no photograph cannot be sold and cannot be shared:
        // the card is blank and og:image has nothing to point at. Named, not
        // counted, because the list is what the owner works through.
        $noImg = $pdo->query(
            'select p.slug from products p where p.active = 1 and not exists' .
            ' (select 1 from product_images i where i.slug = p.slug) order by p.slug'
        )->fetchAll(PDO::FETCH_COLUMN);

        // A brand logo is a data: URI in the row, same as a photograph.
        $brands   = (int) $pdo->query('select count(*) from brands where active = 1')->fetchColumn();
        $brandLogo = (int) $pdo->query(
            "select count(*) from brands where active = 1 and logo is not null and logo <> ''"
        )->fetchColumn();
        $out[] = "brandLogos={$brandLogo}/{$brands}";
    } catch (Throwable $e) {
        $out[] = 'db=error';
    }
} else {
    $out[] = 'db=UNREADABLE';
}

// ------------------------------------------------------------ the icon files
// Each must answer 200 with bytes. A manifest naming an icon that 404s is an
// install prompt with a blank square in it.
$icons = ['/favicon.png', '/favicon-32.png', '/favicon-192.png',
          '/apple-touch-icon.png', '/og-image.png', '/site.webmanifest', '/favicon.ico'];
$iconOk = 0; $iconBad = [];
foreach ($icons as $p) {
    [$s, $b] = get($p, $HOST);
    if ($s === 200 && strlen($b) > 100) $iconOk++; else $iconBad[] = ltrim($p, '/') . '=' . $s;
}
$out[] = 'icons=' . $iconOk . '/' . count($icons) . (count($iconBad) ? ' MISSING:' . implode(',', $iconBad) : '');

// ------------------------------------------------------------------ the SEO
// The sitemaps as the crawler gets them, not as the repository has them.
foreach (['/sitemap.xml', '/sitemap-pages.xml', '/sitemap-products.xml', '/robots.txt'] as $p) {
    [$s, $b] = get($p, $HOST);
    $n = $p === '/robots.txt' ? strlen($b) : substr_count($b, '<loc>');
    $out[] = ltrim($p, '/') . '=' . $s . '/' . $n . ($p === '/robots.txt' ? 'B' : 'urls');
}
// lastmod is what tells a crawler a page is worth re-reading. Its absence is
// not an error; its absence on a catalogue that changes weekly is a waste.
[, $sp] = get('/sitemap-products.xml', $HOST);
$out[] = 'productLastmod=' . substr_count($sp, '<lastmod>');

echo 'SEO ' . implode(' | ', $out)
   . (isset($noImg) && $noImg ? "\nNOIMG " . implode(',', $noImg) : '')
   . "\n";
