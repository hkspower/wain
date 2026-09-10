<?php
/**
 * Does the shopper's path behave like the origin's?
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-edge-check.php && php r.php
 *
 * READ-ONLY. GETs and printed headers. Nothing is written, no configuration
 * value is printed.
 *
 * WHY THIS EXISTS, and it is a gap in every cache measurement this project has
 * made. All of them — live-cache-check, live-revalidate-check, every
 * publisher's own verification — use the loopback form:
 *
 *     https://127.0.0.1/  with  Host: www.sporta.com.kw
 *
 * That reaches LiteSpeed directly and **BYPASSES THE CDN**. It is the right
 * tool for "did the bytes land", which is what it was written for. It is the
 * WRONG tool for "what does a shopper get", because a shopper's request
 * traverses hcdn first, and a CDN is a shared cache that may strip a header,
 * decline to forward a conditional request, or answer from its own copy.
 *
 * So a caching change can be perfect at the origin and worth nothing in
 * Kuwait, and every check this repository owns would report success. This asks
 * the PUBLIC name — which the server can resolve again since 2026-09-09 — and
 * puts the two answers side by side.
 *
 * WHAT IT ASKS, per page:
 *
 *   origin      status, ETag, Vary, bytes, over the loopback
 *   edge        the same over https://www.sporta.com.kw, plus the CDN's own
 *               x-hcdn-cache-status
 *   revalidate  a conditional request down BOTH paths. `origin304` proving 304
 *               while `edge304` does not is the whole failure this exists to
 *               find: the improvement lands on the origin and no shopper sees
 *               it.
 *   gzip        the same page asked for compressed, and its ETag compared with
 *               the identity one.
 *
 * WHY GZIP IS IN HERE. seo.php computes a STRONG ETag over the bytes it echoes,
 * and the web server may compress those bytes afterwards. If both encodings
 * come back under ONE strong tag and the response carries no
 * `Vary: Accept-Encoding`, then a shared cache holding the gzipped copy may
 * hand it to a client that never asked for it. That is a real hazard rather
 * than a tidy one, it belongs to the ETag rather than predating it, and the
 * only way to know is to ask — which is what `encTag=` and `vary=` below are
 * for. `same` there is the answer that needs a look, not the reassuring one.
 */

$PUBLIC = 'https://www.sporta.com.kw';

/**
 * One request. $via 'origin' pins to the loopback with a Host header, which
 * skips the CDN; 'edge' uses the real name and does not.
 */
function ask(string $via, string $path, array $extra = [], bool $gzip = false): array
{
    $url = $via === 'origin' ? 'https://127.0.0.1' . $path : 'https://www.sporta.com.kw' . $path;

    $ch = curl_init($url);
    $opt = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => $extra,
        // Not followed: a redirect is an answer in itself here, and following
        // one would quietly measure a different URL than the one named.
        CURLOPT_FOLLOWLOCATION => false,
    ];
    if ($via === 'origin') {
        // The certificate is for the public name, and this connects by address.
        $opt[CURLOPT_SSL_VERIFYPEER] = false;
        $opt[CURLOPT_SSL_VERIFYHOST] = false;
        $opt[CURLOPT_HTTPHEADER]     = array_merge(['Host: www.sporta.com.kw'], $extra);
    }
    // Only when asked: left unset, curl sends no Accept-Encoding at all and the
    // server answers identity, so a byte count is the file's own size.
    if ($gzip) $opt[CURLOPT_ENCODING] = 'gzip';
    curl_setopt_array($ch, $opt);

    $raw  = (string) curl_exec($ch);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    $head = substr($raw, 0, $hs);
    $get  = static function (string $name) use ($head): string {
        return preg_match('/^' . $name . ':\s*(.+)$/im', $head, $m) ? trim($m[1]) : '';
    };

    return [
        'code' => $code,
        'etag' => $get('etag'),
        'vary' => $get('vary') ?: '-',
        'cc'   => str_replace(' ', '', $get('cache-control')) ?: '-',
        'enc'  => $get('content-encoding') ?: 'identity',
        'cdn'  => $get('x-hcdn-cache-status') ?: '-',
        'len'  => strlen(substr($raw, $hs)),
        'err'  => $err,
    ];
}

$out = [];
foreach (['/', '/shop'] as $path) {
    $o = ask('origin', $path);
    $e = ask('edge', $path);

    // A conditional request down each path, using the tag that path gave.
    $o304 = $o['etag'] !== ''
        ? ask('origin', $path, ['If-None-Match: ' . $o['etag']])['code'] : 0;
    $e304 = $e['etag'] !== ''
        ? ask('edge', $path, ['If-None-Match: ' . $e['etag']])['code'] : 0;

    // And the compressed form, to see whether one strong tag covers both.
    $g = ask('origin', $path, [], true);

    $out[] = $path . '{'
        . 'origin=' . $o['code'] . '/' . $o['len'] . ($o['etag'] === '' ? '/NO-ETAG' : '')
        . ' edge=' . $e['code'] . '/' . $e['len'] . ($e['etag'] === '' ? '/NO-ETAG' : '')
        . ($e['err'] !== '' ? '/ERR' : '')
        . ' cdn=' . $e['cdn']
        . ' tagsMatch=' . ($o['etag'] !== '' && $o['etag'] === $e['etag'] ? 'yes'
                          : ($e['etag'] === '' ? 'edge-has-none' : 'DIFFER'))
        . ' origin304=' . $o304 . ' edge304=' . $e304
        . ' enc=' . $g['enc']
        . ' encTag=' . ($g['etag'] === '' ? 'none' : ($g['etag'] === $o['etag'] ? 'same' : 'differs'))
        . ' vary=' . $o['vary']
        . ' cc=' . $o['cc']
        . '}';
}

echo 'EDGE ' . implode(' ', $out) . "\n";
