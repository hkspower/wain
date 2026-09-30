<?php
/**
 * Did the grid change reach a SHOPPER, not just the origin?
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-grid-check.php && php r.php
 *
 * READ-ONLY. GETs only. Nothing is written; no configuration value is printed.
 *
 * WHY A SECOND ASK. publish-grid.php verified both files by sha256 at write
 * time and then asked the LOOPBACK what the server serves. Both are necessary
 * and neither is the shopper's path:
 *
 *   - the loopback reaches LiteSpeed directly and BYPASSES the CDN, so a
 *     stylesheet can be perfect at the origin and stale in Kuwait
 *   - a check run in the same breath as a write can measure the state BEFORE
 *     it: this docroot has a writer that acts on a delay, and LiteSpeed has
 *     been seen holding an old parse seconds after a verified write
 *
 * So this asks both paths for the same two rules and puts them side by side.
 * `edgeSha` equal to `originSha` is the answer that matters; unequal means the
 * CDN is still holding a copy from before the publish, which is a wait rather
 * than a fault — re-run it rather than republishing.
 *
 * THE WORKER IS ASKED AT THE EDGE for the same reason. The VERSION string is
 * what a returning browser compares against its own worker, and a browser
 * fetches it through the CDN like everything else. v11-grid1 is what frees a
 * visitor pinned to an older sporta-ui.css; v10-refresh1 at the edge would mean
 * the fix has landed and nobody who already visited will see it.
 *
 * The rules are matched by their own TEXT rather than by a byte count, because
 * a file of the right length with the wrong contents is exactly what a stale
 * cache looks like.
 */

/** One GET. $via 'origin' pins to the loopback with a Host header, which skips
 *  the CDN; 'edge' uses the public name and does not. */
function ask(string $via, string $path): array
{
    $ch = curl_init(($via === 'origin' ? 'https://127.0.0.1' : 'https://www.sporta.com.kw') . $path);
    $opt = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FOLLOWLOCATION => false,
    ];
    if ($via === 'origin') {
        $opt[CURLOPT_SSL_VERIFYPEER] = false;
        $opt[CURLOPT_SSL_VERIFYHOST] = false;
        $opt[CURLOPT_HTTPHEADER]     = ['Host: www.sporta.com.kw'];
    }
    curl_setopt_array($ch, $opt);
    $raw  = (string) curl_exec($ch);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $head = substr($raw, 0, $hs);
    $body = substr($raw, $hs);
    return [
        'code' => $code,
        'body' => $body,
        'len'  => strlen($body),
        'sha'  => substr(hash('sha256', $body), 0, 12),
        'cdn'  => preg_match('/^x-hcdn-cache-status:\s*(.+)$/im', $head, $m) ? trim($m[1]) : '-',
    ];
}

$GRID = 'main div.grid:has(> article > a[class*="aspect-"])';

$o = ask('origin', '/assets/sporta-ui.css');
$e = ask('edge',   '/assets/sporta-ui.css');

$has = static function (string $css) use ($GRID): string {
    $gap   = strpos($css, $GRID . ' {') !== false && strpos($css, 'row-gap: 1.5rem') !== false;
    $price = strpos($css, $GRID . ' article .price-card') !== false;
    return ($gap ? 'gap' : 'NO-GAP') . '+' . ($price ? 'price' : 'NO-PRICE');
};

$swO = ask('origin', '/sw.js');
$swE = ask('edge',   '/sw.js');
$ver = static fn (string $b): string =>
    preg_match("/const VERSION = '([^']+)'/", $b, $m) ? $m[1] : 'UNREADABLE';

echo 'GRIDLIVE'
   . ' origin=' . $o['code'] . '/' . $o['len'] . ' originRules=' . $has($o['body'])
   . ' edge=' . $e['code'] . '/' . $e['len'] . ' edgeRules=' . $has($e['body'])
   . ' cdn=' . $e['cdn']
   . ' originSha=' . $o['sha'] . ' edgeSha=' . $e['sha']
   . ' cssMatch=' . ($o['sha'] === $e['sha'] ? 'yes' : 'DIFFER')
   . ' | swOrigin=' . $ver($swO['body']) . ' swEdge=' . $ver($swE['body'])
   . "\n";
