<?php
/**
 * Does a revalidation actually cost a 304, or a whole file again?
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-revalidate-check.php && php r.php
 *
 * READ-ONLY. GETs, conditional GETs, and printed headers. Nothing is written
 * and no configuration value is printed — it is fetched over a public URL.
 *
 * WHY THIS AND NOT live-cache-check.php. That one reports what Cache-Control
 * the server sends, which is the policy. This asks what the policy COSTS, which
 * is a different question and the one a shopper pays.
 *
 * Most of this shop is `no-cache, must-revalidate` on purpose: the shell, the
 * worker, the fixed-name overlays, the products API. `no-cache` does NOT mean
 * "do not cache" — it means "cache it, but ask before reusing it". The asking
 * is only cheap if the response carries a VALIDATOR, an ETag or a
 * Last-Modified, and the server answers a conditional request with 304 and no
 * body.
 *
 * WITHOUT ONE, every single visit re-downloads the file in full and the
 * `no-cache` is a slower `no-store` with extra steps. store_out_cacheable()
 * uses those exact words about a mis-compared ETag, and nothing has ever
 * checked that it holds on the LIVE server — which is LiteSpeed, not the
 * Apache the rig runs, and does not implement every directive it is given.
 * `FileETag MTime Size` in particular is an Apache directive.
 *
 * BOTH BROWSERS, ONE MECHANISM. Chrome and Safari both revalidate `no-cache`
 * on every use and both honour 304; the difference between them is elsewhere.
 * So this measures the shared half — and it is the half that carries the bytes,
 * on a shop whose shell is 42 kB and whose products call is 21 kB.
 *
 * WHAT IT REPORTS PER RESOURCE:
 *   cc=       the Cache-Control in force
 *   etag/lm=  which validators came back (none = a revalidation cannot be cheap)
 *   inm=      status and body bytes for a conditional GET on the ETag
 *   ims=      the same for If-Modified-Since, which is the only one a browser
 *             has when there is no ETag
 *   vary=     Safari and every shared cache key on this; `*` is uncacheable
 *   setck=    Set-Cookie count, because a cookie on a public asset both
 *             defeats shared caching and is a cookie nobody meant to set
 */

$HOST = 'www.sporta.com.kw';

/** One request. Returns [status, headers(assoc, lowercased), body length]. */
function ask(string $path, string $host, array $extra = []): array
{
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: ' . $host], $extra),
        CURLOPT_TIMEOUT        => 30,
        // NO CURLOPT_ENCODING, deliberately — and note that setting it to ''
        // would do the OPPOSITE of what it looks like: '' means "accept every
        // encoding curl knows", not "none". Left unset, curl sends no
        // Accept-Encoding at all, the server answers identity, and a body
        // length here is the bytes the file IS rather than the bytes this
        // client happened to negotiate. Otherwise a 200 and a 304 stop being
        // comparable, which is the only comparison this script makes.
    ]);
    $raw  = (string) curl_exec($ch);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $head = [];
    foreach (explode("\r\n", substr($raw, 0, $hs)) as $line) {
        $i = strpos($line, ':');
        if ($i === false) continue;
        $k = strtolower(trim(substr($line, 0, $i)));
        $v = trim(substr($line, $i + 1));
        // Set-Cookie can repeat; everything else here is single.
        if ($k === 'set-cookie') { $head['set-cookie'][] = $v; continue; }
        $head[$k] = $v;
    }
    return [$code, $head, strlen(substr($raw, $hs))];
}

/* One of each KIND, because the policy is per class and not per file. The
   hashed asset is discovered from the shell rather than named: a hash written
   here would go stale at the next build and the run would report a 404 as a
   caching fault. */
$ch = curl_init('https://127.0.0.1/');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false, CURLOPT_HTTPHEADER => ['Host: ' . $HOST],
    CURLOPT_TIMEOUT => 30,
]);
$shellBody = (string) curl_exec($ch);
curl_close($ch);

$hashed = preg_match('#/assets/(index-[A-Za-z0-9_-]{8,}\.css)#', $shellBody, $m)
    ? '/assets/' . $m[1] : null;

$TARGETS = array_filter([
    'shell'    => '/',
    'worker'   => '/sw.js',
    'fixed'    => '/assets/sporta-ui.css',
    'hashed'   => $hashed,
    'api'      => '/api/api.php?r=products',
    'slides'   => '/api/api.php?r=slides',
    'image'    => '/cats/desktop/art-outlet.webp',
]);

$out = [];
foreach ($TARGETS as $name => $path) {
    [$code, $head, $len] = ask($path, $HOST);

    $etag = $head['etag'] ?? '';
    $lm   = $head['last-modified'] ?? '';
    $cc   = $head['cache-control'] ?? 'NONE';

    // The conditional requests a browser would actually send.
    $inm = $etag !== ''
        ? (function () use ($path, $HOST, $etag) {
            [$c, , $l] = ask($path, $HOST, ['If-None-Match: ' . $etag]);
            return $c . '/' . $l;
        })()
        : 'no-etag';
    $ims = $lm !== ''
        ? (function () use ($path, $HOST, $lm) {
            [$c, , $l] = ask($path, $HOST, ['If-Modified-Since: ' . $lm]);
            return $c . '/' . $l;
        })()
        : 'no-lm';

    $out[] = $name . '{' . $code . '/' . $len
           . ' cc=' . str_replace(' ', '', $cc)
           . ' v=' . ($etag !== '' ? 'etag' : '') . ($lm !== '' ? ($etag !== '' ? '+lm' : 'lm') : '')
           . ($etag === '' && $lm === '' ? 'NONE' : '')
           . ' inm=' . $inm . ' ims=' . $ims
           . ' vary=' . str_replace(' ', '', $head['vary'] ?? '-')
           . ' setck=' . count($head['set-cookie'] ?? [])
           . '}';
}

echo 'REVAL ' . implode(' ', $out) . "\n";
