<?php
/**
 * How fast the live shop actually answers — read-only, from the server.
 *
 *   php /home/<user>/live-perf-check.php
 *
 * MEASURED FROM THE SERVER, ON PURPOSE. This project's own standing rule:
 * this environment's outbound network is an agent proxy that refuses
 * connections to the shop's own public domain outright — CLAUDE.md already
 * records that trap for DNS ("the resolver here is the agent proxy, and it
 * will confidently answer for a name it then declines to reach"), and it
 * holds just as much for timing: a number measured from a container that
 * cannot even open the connection is not a number about the shop.
 *
 * BOTH PATHS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. The loopback
 * (127.0.0.1 with a Host header) hits LiteSpeed directly and BYPASSES the
 * CDN — it is "how fast is the origin", not "how fast is a shopper's page".
 * The public hostname traverses hcdn the way a real visitor's request does.
 * live-edge-check.php already established this distinction for cache
 * headers; the same two paths matter here for timing too.
 *
 * WHAT THIS DOES NOT MEASURE. curl's timing is server-to-server: it has none
 * of a phone's radio latency, none of a browser's parse/render/paint cost,
 * and it fetches ONE request at a time rather than the dozen a page actually
 * makes in parallel. It answers "is the origin/edge slow to hand over
 * bytes", not "how long until a shopper sees something" — a real Core Web
 * Vitals reading needs a browser, which this channel cannot run. Read the
 * numbers as a floor, not the whole story.
 */

function timeIt(string $url, ?string $hostHeader = null, bool $loopback = false): array {
    $ch = curl_init($url);
    $headers = [];
    if ($hostHeader) $headers[] = 'Host: ' . $hostHeader;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => !$loopback,
        CURLOPT_SSL_VERIFYHOST => $loopback ? 0 : 2,
        CURLOPT_ENCODING       => '',   // accept gzip/br, same as a real browser
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $info = curl_getinfo($ch);
    curl_close($ch);
    if ($body === false) return ['error' => $err ?: 'unknown'];
    return [
        'code'        => $info['http_code'],
        'bytes'       => strlen($body),
        'dns_ms'      => round($info['namelookup_time'] * 1000),
        'connect_ms'  => round($info['connect_time'] * 1000),
        'ttfb_ms'     => round($info['starttransfer_time'] * 1000),
        'total_ms'    => round($info['total_time'] * 1000),
        'content_type'=> $info['content_type'],
    ];
}

function line(string $label, array $r): void {
    if (isset($r['error'])) { echo "$label ERROR {$r['error']}\n"; return; }
    echo "$label code={$r['code']} bytes={$r['bytes']} dns={$r['dns_ms']}ms"
       . " connect={$r['connect_ms']}ms ttfb={$r['ttfb_ms']}ms total={$r['total_ms']}ms\n";
}

// ------------------------------------------------------------ the home page
$origin = timeIt('https://127.0.0.1/', 'www.sporta.com.kw', true);
line('HOME origin', $origin);
$edge = timeIt('https://www.sporta.com.kw/');
line('HOME edge  ', $edge);

// -------------------------------------------------------------- the api
$originApi = timeIt('https://127.0.0.1/api/api.php?r=products', 'www.sporta.com.kw', true);
line('API  origin', $originApi);
$edgeApi = timeIt('https://www.sporta.com.kw/api/api.php?r=products');
line('API  edge  ', $edgeApi);

// --------------------------------------------- the storefront's own bundle
// Found from the home page's own markup, so this always asks about the
// bundle the shop is ACTUALLY serving today rather than a filename typed
// here that goes stale the next time the site is rebuilt.
$ch = curl_init('https://127.0.0.1/');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 30]);
$html = (string) curl_exec($ch);
curl_close($ch);

preg_match_all('/\/assets\/(index-[A-Za-z0-9_-]+\.(?:js|css))/', $html, $m);
$bundleFiles = array_unique($m[1] ?? []);
foreach ($bundleFiles as $f) {
    $r = timeIt('https://www.sporta.com.kw/assets/' . $f);
    line('BUNDLE edge ' . $f, $r);
}

echo "SUMMARY homeGap=" . (($edge['total_ms'] ?? 0) - ($origin['total_ms'] ?? 0)) . "ms"
   . " (edge minus origin — positive means the CDN adds time, negative means it's serving cached)\n";
