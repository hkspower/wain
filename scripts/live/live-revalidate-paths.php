<?php
/**
 * READ-ONLY. For each URL: the ETag and the answer to a conditional request (If-None-Match), at the
 * ORIGIN (loopback) and at the EDGE (public name), plain and compressed (2026-10-15). A 200 where a
 * 304 is expected means every returning visit downloads the file again; this says which hop breaks it.
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
function req(string $base, string $path, string $enc, string $inm = ''): array {
    $edge = $base !== 'https://127.0.0.1';
    $h = ["User-Agent: Mozilla/5.0 (revalidate-paths)"];
    if (!$edge) $h[] = 'Host: www.sporta.com.kw';
    if ($enc !== '') $h[] = 'Accept-Encoding: ' . $enc;
    if ($inm !== '') $h[] = 'If-None-Match: ' . $inm;
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'ignore_errors' => true, 'timeout' => 5, 'header' => implode("\r\n", $h) . "\r\n"],
        'ssl' => $edge ? [] : ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => 'www.sporta.com.kw']]);
    @file_get_contents($base . $path, false, $ctx);
    $code = 0; $etag = '';
    foreach ($http_response_header ?? [] as $l) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $l, $m)) $code = (int) $m[1];
        if (stripos($l, 'ETag:') === 0) $etag = trim(substr($l, 5));
    }
    return [$code, $etag];
}
foreach (['/assets/sporta-ui.css', '/sw.js', '/cats/mobile/art-men.webp', '/logo.png', '/favicon.ico', '/api/api.php?r=products', '/'] as $p) {
    $out = [];
    foreach (['origin' => 'https://127.0.0.1', 'edge' => 'https://www.sporta.com.kw'] as $who => $base) {
        foreach (['plain' => '', 'br' => 'br, gzip'] as $e => $enc) {
            [$c, $t] = req($base, $p, $enc);
            $r = $t !== '' ? req($base, $p, $enc, $t)[0] : 0;
            $out[] = "$who.$e=" . $c . '/' . ($t === '' ? 'NOTAG' : substr($t, 0, 26)) . '/inm' . $r;
        }
    }
    echo str_pad($p, 28), implode('  ', $out), "\n";
    flush();
}
echo "done\n";
