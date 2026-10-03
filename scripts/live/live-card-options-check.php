<?php
/**
 * The product cards' colour circles and size boxes, as the live shop's ?r=products feeds them —
 * 2026-10-03 (assets/card-options.js).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-card-options-check.php && php r.php
 *
 * READ-ONLY. Two GETs of the public catalogue over the loopback (pinned with CURLOPT_RESOLVE);
 * it writes nothing, opens no database and prints no credential.
 *
 * It reports STATE, the same on every run:
 *   rows=          active products in the response
 *   coloured=      products with a colour (product_attrs, else read off the slug)
 *   styles=        distinct style_key values, and how many of them hold 2+ colours
 *   withSizes=     products with at least one size box
 *   soldOutBoxes=  size boxes that will be greyed and crossed out
 *   countKeys=     keys anywhere in the response that look like a stock count, cost or qty
 *                  other than in_stock — must be 0: the route must never carry a count
 *   etag= / 304=   the route is still cacheable: it sends an ETag and answers its own tag 304
 * Expected on the live shop the day it shipped: coloured=29, styles 9 or more.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function get(string $path, array $headers = []): array {
    $ch = curl_init('https://www.sporta.com.kw' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_TIMEOUT => 10, CURLOPT_USERAGENT => 'sporta-card-options-check', CURLOPT_HTTPHEADER => $headers,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $raw = is_string($raw) ? $raw : '';
    return [$code, substr($raw, 0, $hlen), substr($raw, $hlen)];
}

[$code, $head, $body] = get('/api/api.php?r=products');
$rows = json_decode($body, true);
if ($code !== 200 || !is_array($rows)) { line("FETCH products=$code/" . strlen($body) . ' NOT-JSON — nothing below is a measurement'); exit; }
line("FETCH products=$code/" . strlen($body));

$coloured = 0; $withSizes = 0; $soldOut = 0; $boxes = 0; $styles = []; $missingFields = 0;
foreach ($rows as $r) {
    if (!array_key_exists('style_key', $r) || !array_key_exists('size_options', $r)) $missingFields++;
    if (!empty($r['colour']['key'])) { $coloured++; if (!empty($r['style_key'])) $styles[$r['style_key']][$r['colour']['key']] = 1; }
    $opts = is_array($r['size_options'] ?? null) ? $r['size_options'] : [];
    if ($opts) $withSizes++;
    foreach ($opts as $o) { $boxes++; if (($o['in_stock'] ?? null) === false) $soldOut++; }
}
$multi = count(array_filter($styles, fn ($c) => count($c) >= 2));
$countKeys = 0;
$walk = function ($x) use (&$walk, &$countKeys) {
    if (!is_array($x)) return;
    foreach ($x as $k => $v) { if (is_string($k) && $k !== 'in_stock' && preg_match('/stock|cost|qty/i', $k)) $countKeys++; $walk($v); }
};
$walk($rows);
line('CARDS rows=' . count($rows) . " coloured=$coloured styles=" . count($styles) . " multiColour=$multi withSizes=$withSizes boxes=$boxes soldOutBoxes=$soldOut countKeys=$countKeys"
    . ($missingFields ? " MISSING-FIELDS=$missingFields (the new api.php is not live)" : ''));

$etag = preg_match('/^etag:\s*(.+)$/mi', $head, $m) ? trim($m[1]) : '';
[$code2] = $etag !== '' ? get('/api/api.php?r=products', ['If-None-Match: ' . $etag]) : [0];
line('CACHE etag=' . ($etag !== '' ? 'yes' : 'NO') . ' 304=' . ($code2 === 304 ? 'yes' : "NO($code2)"));
