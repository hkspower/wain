<?php
/**
 * What a shopper and a crawler get on a PRODUCT page of the live shop.
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-product-check.php && php c.php
 *
 * READ-ONLY. GETs only; it writes nothing and changes nothing.
 *
 * WHY NOT THE SANDBOX. The local rigs measure a catalogue where sandbox.sh has
 * topped every size to 20 and the seed supplies the copy. The live shop has the
 * owner's own products, the owner's stock, and — measured repeatedly — NO
 * PHOTOGRAPHS. The questions below only have real answers on the real data.
 *
 * IT ASKS OVER THE PUBLIC NAME so the request crosses the CDN the way a
 * shopper's does, and it picks the product to look at FROM THE SHOP'S OWN
 * CATALOGUE rather than naming a slug here — a slug typed into a checker is a
 * fixture chosen at random, which this project has recorded three times.
 */
header('Content-Type: text/plain; charset=utf-8');
@ini_set('default_socket_timeout', '10');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function get(string $url): array {
    $ctx = stream_context_create(['http' => ['timeout' => 10, 'ignore_errors' => true,
        'header' => "User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1)\r\n"]]);
    $b = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('~^HTTP/\S+\s+(\d{3})~', $h, $m)) $code = (int)$m[1];
    return ['code' => $code, 'body' => (string) $b];
}

$site = 'https://www.sporta.com.kw';
$api  = get($site . '/api/api.php?r=products');
$j    = json_decode($api['body'], true);
$rows = $j['products'] ?? $j ?? [];
line('catalogue ' . $api['code'] . ' products=' . (is_array($rows) ? count($rows) : 0));
if (!is_array($rows) || !$rows) { line('no catalogue — nothing to look at'); exit; }

// HOW MANY HAVE A PHOTOGRAPH AT ALL. The single most visible thing about this
// shop, and it is a property of the CATALOGUE rather than of one page.
$withImage = 0; $withDesc = 0;
foreach ($rows as $r) {
    if (trim((string)($r['image'] ?? '')) !== '' || !empty($r['images'])) $withImage++;
    if (trim((string)($r['desc_ar'] ?? $r['desc'] ?? '')) !== '') $withDesc++;
}
line(sprintf('photos=%d/%d  descriptions=%d/%d', $withImage, count($rows), $withDesc, count($rows)));

$slug = (string) ($rows[0]['slug'] ?? '');
line('looking at: ' . $slug);

foreach (['ar' => '', 'en' => '?lang=en'] as $lang => $q) {
    $r = get($site . '/product/' . rawurlencode($slug) . $q);
    $b = $r['body'];
    preg_match('~<title[^>]*>([^<]*)~i', $b, $t);
    preg_match('~<html[^>]*\blang="([^"]*)"~i', $b, $l);
    preg_match('~<html[^>]*\bdir="([^"]*)"~i', $b, $d);
    preg_match('~<link[^>]+rel="canonical"[^>]+href="([^"]*)~i', $b, $c);
    preg_match('~<meta[^>]+property="og:image"[^>]+content="([^"]*)~i', $b, $og);
    preg_match('~<meta[^>]+name="description"[^>]+content="([^"]*)~i', $b, $de);
    $ld = substr_count($b, 'application/ld+json');
    line('');
    line(sprintf('%-3s %d/%d  lang=%s dir=%s  ld+json=%d', $lang, $r['code'], strlen($b),
        $l[1] ?? '-', $d[1] ?? '-', $ld));
    line('    title=' . substr(trim($t[1] ?? '-'), 0, 60));
    line('    desc=' . substr(trim($de[1] ?? '-'), 0, 60));
    line('    canonical=' . ($c[1] ?? '-'));
    // THE ONE WORTH READING. Every product sharing one og:image is every
    // product sharing one picture in a search result and on WhatsApp.
    $ogv = $og[1] ?? '-';
    line('    og:image=' . $ogv . (str_contains($ogv, 'og-image.png')
        ? '   <-- the shop-wide fallback, not this product' : ''));
}
