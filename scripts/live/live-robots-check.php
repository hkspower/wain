<?php
// READ-ONLY. Fetched over a public raw.githubusercontent.com URL by a cron
// job on the live server (see CLAUDE.md, "the cron channel is the only way
// to write to the server") — must never write anything.
//
// Confirms robots.txt and the two static sitemaps the live server actually
// SENDS match what this repository has, and that the generated product
// sitemap answers through .htaccess's rewrite. Loopback, not the public
// hostname, per the standing rule: it reaches LiteSpeed directly regardless
// of DNS, at the cost of a certificate mismatch warning that is expected and
// harmless (see CLAUDE.md's cron section on -nv output).

function fetch($path) {
  $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
  $opts = ['http' => ['header' => "Host: www.sporta.com.kw\r\n", 'timeout' => 15]];
  $ctx = stream_context_create(array_merge_recursive(
    ['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]], $opts));
  $body = @file_get_contents('https://127.0.0.1' . $path, false, $ctx);
  $code = 0;
  foreach ($http_response_header ?? [] as $h) {
    if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
  }
  return [$code, $body === false ? '' : $body];
}

[$c1, $robots] = fetch('/robots.txt');
[$c2, $sitemap] = fetch('/sitemap.xml');
[$c3, $pages] = fetch('/sitemap-pages.xml');
[$c4, $products] = fetch('/sitemap-products.xml');

echo "robots=$c1/" . strlen($robots) . '/' . substr(hash('sha256', $robots), 0, 12)
  . " sitemap=$c2/" . strlen($sitemap) . '/' . substr(hash('sha256', $sitemap), 0, 12)
  . " pages=$c3/" . strlen($pages) . '/' . substr(hash('sha256', $pages), 0, 12)
  . " products=$c4/" . strlen($products) . '/' . substr(hash('sha256', $products), 0, 12) . "\n";
