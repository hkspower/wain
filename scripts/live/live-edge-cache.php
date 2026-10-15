<?php
/**
 * READ-ONLY. What the CDN (hcdn) does with each KIND of response, asked over the PUBLIC name the
 * way a shopper's request goes (2026-10-15, "edge caching"). Each URL is fetched twice; the second
 * answer says whether the edge kept a copy (HIT) or passed it through (MISS/BYPASS/DYNAMIC).
 * Prints status, bytes, Cache-Control, the CDN status header, Age, ETag present, encoding, Vary.
 * Nothing is written; no configuration value is printed.
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
function head(string $url, array $extra = []): array {
    $ctx = stream_context_create([
        'http' => ['method' => 'GET', 'ignore_errors' => true, 'timeout' => 5,
                   'header' => implode("\r\n", array_merge(['Accept-Encoding: gzip, br', 'User-Agent: Mozilla/5.0 (edge-cache-check)'], $extra)) . "\r\n"],
        'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $t = microtime(true);
    $b = @file_get_contents($url, false, $ctx);
    $ms = (int) round((microtime(true) - $t) * 1000);
    $h = $http_response_header ?? [];
    $get = function ($n) use ($h) { foreach ($h as $l) if (stripos($l, $n . ':') === 0) return trim(substr($l, strlen($n) + 1)); return ''; };
    $code = 0; foreach ($h as $l) if (preg_match('#^HTTP/\S+\s+(\d+)#', $l, $m)) $code = (int) $m[1];
    return ['code' => $code, 'len' => strlen((string) $b), 'ms' => $ms, 'cc' => $get('Cache-Control'),
            'cdn' => $get('x-hcdn-cache-status') ?: $get('x-cache') ?: $get('cf-cache-status') ?: '-',
            'age' => $get('Age') ?: '-', 'etag' => $get('ETag'), 'enc' => $get('Content-Encoding') ?: '-',
            'vary' => $get('Vary') ?: '-', 'server' => $get('Server'), 'body' => (string) $b];
}
$W = 'https://www.sporta.com.kw';
$home = head($W . '/');
$js = preg_match('#/assets/index-[A-Za-z0-9_-]+\.js#', $home['body'], $m) ? $m[0] : '';
$prods = json_decode(head($W . '/api/api.php?r=products')['body'], true);
$slug = $prods['products'][0]['slug'] ?? ($prods[0]['slug'] ?? '');
$urls = ['/', '/shop', '/men', '/product/' . $slug, '/about', '/backends',
         '/assets/sporta-ui.css', '/assets/sporta-mobile.css', $js, '/sw.js', '/assets/rules-live.js',
         '/cats/mobile/art-men.webp', '/hero/desktop/1.webp', '/logo.png', '/favicon.ico',
         '/api/api.php?r=products', '/api/api.php?r=slides', '/api/api.php?r=status&id=NOSUCHORDER1',
         '/robots.txt', '/sitemap.xml'];
echo 'SERVER ', $home['server'], "\n";
foreach ($urls as $u) {
    if ($u === '' ) continue;
    $a = head($W . $u);
    $b = head($W . $u);
    $c = $a['etag'] !== '' ? head($W . $u, ['If-None-Match: ' . $a['etag']]) : null;
    echo str_pad(substr($u, 0, 44), 45), $b['code'], '/', $b['len'], ' ', $b['ms'], 'ms',
         ' cdn=', $a['cdn'], '>', $b['cdn'], ' age=', $b['age'], ' etag=', $a['etag'] !== '' ? 'y' : 'n',
         ' inm=', $c ? $c['code'] : '-', ' enc=', $b['enc'], ' vary=', $b['vary'], ' cc=', $b['cc'] ?: 'NONE', "\n";
    flush();
}
echo "done\n";
