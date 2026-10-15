<?php
/**
 * READ-ONLY. What Googlebot gets from the LIVE sitemaps, over the public name (2026-10-15).
 * Follows /sitemap.xml to each child and asks every listed address: status, robots, canonical.
 * Also: robots.txt's Sitemap line, each file's Cache-Control and Content-Type, and whether each
 * indexable page of the shop is listed. Prints counts and every fault; nothing is written.
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
const SITE = 'https://www.sporta.com.kw';
function g(string $url): array {
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'ignore_errors' => true, 'timeout' => 6, 'follow_location' => 0,
        'header' => "User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)\r\nAccept-Encoding: identity\r\n"]]);
    $b = (string) @file_get_contents($url, false, $ctx);
    $h = $http_response_header ?? []; $code = 0; $hd = [];
    foreach ($h as $l) { if (preg_match('#^HTTP/\S+\s+(\d+)#', $l, $m)) $code = (int) $m[1]; elseif (strpos($l, ':')) { [$k, $v] = explode(':', $l, 2); $hd[strtolower(trim($k))] = trim($v); } }
    return [$code, $b, $hd];
}
$bad = [];
[$c, $rb, $rh] = g(SITE . '/robots.txt');
echo 'robots.txt ', $c, ' bytes=', strlen($rb), ' cc=', $rh['cache-control'] ?? '-', ' sitemapLine=', preg_match('#^Sitemap:\s*(\S+)#mi', $rb, $m) ? $m[1] : 'NONE', "\n"; flush();
[$c, $ix, $ih] = g(SITE . '/sitemap.xml');
echo 'sitemap.xml ', $c, ' bytes=', strlen($ix), ' type=', $ih['content-type'] ?? '-', ' cc=', $ih['cache-control'] ?? '-', "\n"; flush();
preg_match_all('#<loc>([^<]+)</loc>#', $ix, $kids);
$listed = [];
foreach ($kids[1] as $k) {
    [$c, $x, $h] = g(html_entity_decode($k));
    preg_match_all('#<url>(.*?)</url>#s', $x, $us);
    echo 'child ', basename($k), ' ', $c, ' urls=', count($us[1]), ' type=', $h['content-type'] ?? '-', ' cc=', $h['cache-control'] ?? '-', "\n"; flush();
    if ($c !== 200) $bad[] = "child $k answers $c";
    foreach ($us[1] as $u) {
        if (!preg_match('#<loc>([^<]+)</loc>#', $u, $lm)) continue;
        $loc = html_entity_decode($lm[1]);
        if (isset($listed[$loc])) $bad[] = "duplicate $loc"; $listed[$loc] = 1;
        if (preg_match('#<lastmod>([^<]+)</lastmod>#', $u, $mm) && strtotime($mm[1]) > time() + 86400) $bad[] = "future lastmod $loc";
    }
}
$n = 0;
foreach (array_keys($listed) as $loc) {
    [$c, $b, $h] = g($loc); $n++;
    if ($c !== 200) { $bad[] = "$c $loc" . (isset($h['location']) ? ' -> ' . $h['location'] : ''); continue; }
    $rob = preg_match('#<meta name="robots" content="([^"]+)"#i', $b, $m) ? $m[1] : '';
    $xr = $h['x-robots-tag'] ?? '';
    $can = preg_match('#<link rel="canonical" href="([^"]+)"#i', $b, $m) ? html_entity_decode($m[1]) : '';
    if (stripos($rob . $xr, 'noindex') !== false) $bad[] = "noindex but listed $loc";
    if ($can !== $loc) $bad[] = "canonical " . ($can ?: 'NONE') . " for $loc";
}
foreach (['/', '/shop', '/men', '/women', '/accessories', '/outlet', '/about', '/contact', '/terms', '/privacy', '/returns'] as $p) {
    foreach (['', '?lang=en'] as $q) {
        $u = SITE . $p . $q;
        if (isset($listed[$u])) continue;
        [$c, $b, $h] = g($u);
        $rob = preg_match('#<meta name="robots" content="([^"]+)"#i', $b, $m) ? $m[1] : '';
        if ($c === 200 && stripos($rob . ($h['x-robots-tag'] ?? ''), 'noindex') === false) $bad[] = "indexable but not listed $u";
    }
}
echo 'checked=', $n, ' faults=', count($bad), "\n";
foreach (array_slice($bad, 0, 60) as $b) echo '  ', $b, "\n";
echo "done\n";
