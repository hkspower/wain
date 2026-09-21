<?php
/**
 * Where /men (and its siblings) actually land, from every entry door a
 * shopper might use — bare domain, www, http, https.
 *
 * READ-ONLY. HEAD requests only.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-category-redirect-check.php && php r.php
 */

header('Content-Type: text/plain; charset=utf-8');

function probe(string $url): void {
    $ctx = stream_context_create(['http' => [
        'method' => 'HEAD', 'timeout' => 10, 'ignore_errors' => true,
        'follow_location' => 0,
        'header' => "User-Agent: sporta-cat-redirect-check\r\n",
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    $status = 0; $location = null;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $status = (int) $m[1];
        if (stripos($h, 'location:') === 0) $location = trim(substr($h, 9));
    }
    if ($body === false && $status === 0) { echo "$url -> REFUSED\n"; return; }
    echo "$url -> status=$status location=" . ($location ?? '(none)') . "\n";
}

foreach (['men', 'women', 'accessories', 'outlet'] as $slug) {
    foreach (['http://sporta.com.kw', 'https://sporta.com.kw', 'http://www.sporta.com.kw', 'https://www.sporta.com.kw'] as $base) {
        probe("$base/$slug");
    }
    echo "\n";
}
