<?php
/**
 * READ-ONLY. For each URL: the ETag and the answer to a conditional request (If-None-Match), at the
 * ORIGIN (loopback) and at the EDGE (public name), plain and compressed (2026-10-15). A 200 where a
 * 304 is expected means every returning visit downloads the file again; this says which hop breaks it.
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
function req(string $base, string $path, string $enc, string $inm = '', string $ims = ''): array {
    $edge = $base !== 'https://127.0.0.1';
    $h = ["User-Agent: Mozilla/5.0 (revalidate-paths)"];
    if (!$edge) $h[] = 'Host: www.sporta.com.kw';
    if ($enc !== '') $h[] = 'Accept-Encoding: ' . $enc;
    if ($inm !== '') $h[] = 'If-None-Match: ' . $inm;
    if ($ims !== '') $h[] = 'If-Modified-Since: ' . $ims;
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'ignore_errors' => true, 'timeout' => 5, 'header' => implode("\r\n", $h) . "\r\n"],
        'ssl' => $edge ? [] : ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => 'www.sporta.com.kw']]);
    @file_get_contents($base . $path, false, $ctx);
    $code = 0; $etag = ''; $lm = ''; $cc = ''; $cdn = '';
    foreach ($http_response_header ?? [] as $l) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $l, $m)) $code = (int) $m[1];
        if (stripos($l, 'ETag:') === 0) $etag = trim(substr($l, 5));
        if (stripos($l, 'Last-Modified:') === 0) $lm = trim(substr($l, 14));
        if (stripos($l, 'x-hcdn-cache-status:') === 0) $cdn = trim(substr($l, 20));
    }
    return [$code, $etag, $lm, $cdn];
}
foreach (['/assets/sporta-ui.css', '/cats/mobile/art-men.webp', '/favicon.ico', '/api/api.php?r=products'] as $p) {
    [$c, $t, $lm, $cdn] = req('https://www.sporta.com.kw', $p, 'br, gzip');
    $ims = $lm !== '' ? req('https://www.sporta.com.kw', $p, 'br, gzip', '', $lm) : [0, '', '', ''];
    $both = req('https://www.sporta.com.kw', $p, 'br, gzip', $t, $lm);
    $inm = req('https://www.sporta.com.kw', $p, 'br, gzip', $t);
    echo str_pad($p, 28), 'cdn=', $cdn, ' lastmod=', $lm === '' ? 'NONE' : 'y', ' inm=', $inm[0], '/', $inm[3], ' ims=', $ims[0], '/', $ims[3], ' both=', $both[0], "\n";
    flush();
}
echo "done\n";
