<?php
/**
 * Is a SHOPPER being served the asset the origin holds?
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-asset-freshness.php && php r.php
 *
 * READ-ONLY. GETs and printed headers. Nothing is written, nothing is purged,
 * and no configuration value is printed.
 *
 * WHY, when live-file-check.php already compares the docroot with the
 * repository. Because that question and this one have different answers, and
 * this project has already been caught by the gap between them. live-file-check
 * and every publisher read the FILE, or read it back over the loopback:
 *
 *     https://127.0.0.1/  with  Host: www.sporta.com.kw
 *
 * which reaches LiteSpeed directly and BYPASSES hcdn. A stylesheet can be
 * byte-perfect on disk and byte-perfect over the loopback while the CDN goes on
 * handing every real visitor the copy it cached before the publish. Then the
 * owner says the shop has not changed, and every check this repository owns
 * reports success — which is exactly what CLAUDE.md records happening on
 * 2026-09-10, when all three cache layers measured innocent and the stale copy
 * was in none of them.
 *
 * live-edge-check.php asks this of `/` and `/shop`. It does NOT ask it of the
 * assets, and the assets are where a fixed-name file gets pinned.
 *
 * NO EXPECTED HASH IS WRITTEN IN HERE, deliberately. Two scripts in this
 * repository carried hardcoded manifests, both went stale, and both then
 * reported the REPOSITORY's staleness as the SERVER's — which points at work
 * that is already done. This compares the two live paths with each other and
 * prints the origin's own sha256 for the reader to check against the repo. A
 * number it does not store cannot go out of date.
 *
 * HOW TO READ IT:
 *
 *   same=yes                 the edge is serving what the origin holds. Done.
 *   same=NO                  the CDN is holding an older copy — this is the
 *                            case a cache purge fixes, and the only one.
 *   cdn=HIT                  the edge answered from its own cache. Not a fault
 *                            by itself; read `same` to know whether it matters.
 *   cdn=BYPASS / MISS        the edge went to the origin for this request.
 *   edge=000                 the public name could not be reached FROM THE
 *                            SERVER. Not a verdict about the shop — say so
 *                            rather than reporting the edge as broken.
 *
 * A service worker sits BELOW all of this and is not measurable from here: a
 * returning visitor running an old worker is pinned regardless of what either
 * path says, and only a sw.js VERSION bump frees them. That is why sw.js is one
 * of the files asked about.
 */

// TWO PATHS AND A SHORT TIMEOUT, and that is a property of the CHANNEL rather
// than of the question. Measured 2026-09-17: a job that finishes fast has its
// output captured, and a long one comes back EMPTY — the publisher that wrote
// four files printed nothing across three ticks while having done the work, and
// the first version of this script (4 paths, 8 requests, 25s timeouts each)
// did the same. The `sha256sum` jobs beside them, which return instantly,
// printed every time. So: few requests, short timeouts, and every line echoed
// AS IT IS MEASURED rather than accumulated into one echo at the end, so a run
// that is cut short still reports what it managed to ask.
$PATHS = ['/assets/sporta-ui.css', '/sw.js'];

$get = static function (string $url, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_ENCODING       => '',   // ask for identity+gzip and let curl undo it,
                                        // so the sha256 is of the CONTENT either way
    ]);
    $raw  = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $head = substr($raw, 0, $hs);
    $body = substr($raw, $hs);
    $hdr  = static function (string $name) use ($head): string {
        return preg_match('/^' . preg_quote($name, '/') . ':\s*(.*)$/mi', $head, $m)
            ? trim($m[1]) : '';
    };
    return [
        'code' => $code,
        'len'  => strlen($body),
        'sha'  => $body === '' ? '' : substr(hash('sha256', $body), 0, 12),
        'cc'   => $hdr('Cache-Control'),
        'cdn'  => $hdr('x-hcdn-cache-status'),
    ];
};

echo "ASSETFRESH\n";
foreach ($PATHS as $path) {
    // The origin, over the loopback with the public name in the Host header.
    $o = $get('https://127.0.0.1' . $path, ['Host: www.sporta.com.kw']);
    // The shopper's path, through the CDN, cache-busted NOWHERE — asking for the
    // plain URL is the whole point: a ?cb= would route around the very cache
    // under test and always report success.
    $e = $get('https://www.sporta.com.kw' . $path);

    $same = ($o['sha'] !== '' && $o['sha'] === $e['sha']) ? 'yes'
          : ($e['code'] === 0 ? 'edge-unreachable' : 'NO');

    echo $path
        . ' origin=' . $o['code'] . '/' . $o['len'] . '/' . ($o['sha'] ?: 'none')
        . ' edge=' . $e['code'] . '/' . $e['len'] . '/' . ($e['sha'] ?: 'none')
        . ' same=' . $same
        . ' cdn=' . ($e['cdn'] ?: '-')
        . ' cc=' . (str_replace(' ', '', $o['cc']) ?: '-')
        . "\n";
    @ob_flush(); @flush();
}
