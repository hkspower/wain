<?php
/**
 * What the bare apex (sporta.com.kw, no www) actually gets from the CDN.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-apex-check.php && php r.php
 *
 * READ-ONLY. GETs over the public name and prints status/headers/body start.
 * Nothing is written, nothing changed.
 *
 * WHY THIS EXISTS. Every live check in this repository asks
 * https://www.sporta.com.kw — live-edge-check.php says so in its own header,
 * about exactly this gap on a different axis (origin vs edge). Nobody has
 * ever asked the bare apex, because .htaccess is supposed to redirect it to
 * www at the origin. A visitor reported a CDN edge error page — "Whoops! 500
 * ... Request-Id: ...-nme-edge8" — on a URL bar reading plain
 * "sporta.com.kw", which is the CDN answering before the request ever reaches
 * that redirect rule, not a certificate problem and not PHP.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function probe(string $url): void {
    $ctx = stream_context_create(['http' => [
        'method' => 'GET', 'timeout' => 15, 'ignore_errors' => true,
        'header' => "User-Agent: sporta-apex-check\r\n",
        'follow_location' => 0,
    ], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        $e = error_get_last();
        line(sprintf('%-32s REFUSED %s', $url, trim(preg_replace('/\s+/', ' ', (string) ($e['message'] ?? 'unknown')))));
        return;
    }
    $status = 0;
    $location = null;
    $server = null;
    $reqId = null;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $status = (int) $m[1];
        if (stripos($h, 'location:') === 0) $location = trim(substr($h, 9));
        if (stripos($h, 'server:') === 0) $server = trim(substr($h, 7));
        if (stripos($h, 'x-request-id:') === 0 || stripos($h, 'request-id:') === 0) $reqId = trim(explode(':', $h, 2)[1]);
    }
    line(sprintf('%-32s status=%d server=%s location=%s reqId=%s bytes=%d',
        $url, $status, $server ?? '(none)', $location ?? '(none)', $reqId ?? '(none)', strlen($body)));
    if ($status >= 500 || stripos($body, 'whoops') !== false) {
        line('  body starts: ' . substr(preg_replace('/\s+/', ' ', strip_tags($body)), 0, 200));
    }
}

line('=== apex vs www, both schemes ===');
probe('http://sporta.com.kw/');
probe('https://sporta.com.kw/');
probe('http://www.sporta.com.kw/');
probe('https://www.sporta.com.kw/');

line('');
line('=== what DNS answers for each, from this server ===');
foreach (['sporta.com.kw', 'www.sporta.com.kw', 'static.sporta.com.kw'] as $host) {
    $ips = @gethostbynamel($host);
    line(sprintf('%-24s %s', $host, $ips ? implode(', ', $ips) : 'NO ANSWER'));
}
