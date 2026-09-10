<?php
/**
 * Publish the shell's ETag — one file, seo.php.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-seo-etag.php && php r.php
 *
 * WHAT IT CARRIES. `/` and every SPA route are rewritten to seo.php, which had
 * no ETag and no Last-Modified — so `max-age=0, must-revalidate` had nothing to
 * revalidate with and every navigation re-sent the whole 42 kB shell, in Chrome
 * and in Safari alike. seo.php now hashes its own output into an ETag and
 * answers a conditional request with an empty 304.
 *
 * ONE FILE, and it is the whole change: no .htaccess, no index.html, no CSP.
 * The bytes of the page are untouched — this only adds a response header and a
 * 304 branch — so every inline-script hash the policy names still matches. The
 * check below asks the server that anyway rather than assuming it.
 *
 * WHY THIS IS SAFE TO PUBLISH ONTO A LIVE SHOP. The failure mode of a wrong
 * ETag is a shopper pinned to a stale page, so the check does not stop at "a
 * 304 came back" — it asks for the page with a DELIBERATELY WRONG tag and
 * requires a full 200. A server that answers 304 to everything would satisfy
 * the first check and be the worst possible outcome.
 *
 * And seo.php is already fail-safe by design: any error at all falls through to
 * serving index.html verbatim. That branch sends the ETag too, which is correct
 * rather than sloppy — `max-age=0, must-revalidate` still forces the ask on
 * every visit, so the moment the fault clears the body differs, the tag differs,
 * and the shopper gets the good page.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in it,
 *     which makes a raw.githubusercontent ref ambiguous — it returns an EMPTY
 *     file and says nothing)
 *   - temp file + rename; deletes nothing
 *   - IDEMPOTENT: a file already matching its hash is skipped
 */

$COMMIT = 'af31c83';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'seo.php' => '83137853c289d5bc485115e6c748b0d190feb758d7d2abdc7d3af8740d8a8fab',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** A request over the loopback with its headers. Bypasses the CDN, which is
 *  what we want: this is a question about the ORIGIN. */
$ask = static function (string $path, array $extra = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $extra),
        CURLOPT_TIMEOUT        => 30,
    ]);
    $raw  = (string) curl_exec($ch);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $head = substr($raw, 0, $hs);
    $etag = preg_match('/^etag:\s*(.+)$/im', $head, $m) ? trim($m[1]) : '';
    return [$code, $etag, strlen(substr($raw, $hs)), $head];
};

/* The shell, then the two questions that matter, on the home page and on a
   deeper route — a rule that only reached `/` would be easy to miss. */
$out = [];
foreach (['/', '/shop'] as $path) {
    [$c1, $etag, $len1] = $ask($path);
    if ($etag === '') { $out[] = $path . '{200/' . $len1 . ' NO-ETAG}'; continue; }

    // 1. the same tag must cost nothing
    [$c2, , $len2] = $ask($path, ['If-None-Match: ' . $etag]);
    // 2. a WRONG tag must still deliver the page. A server answering 304 to
    //    everything passes (1) and pins every shopper to a page for ever.
    [$c3, , $len3] = $ask($path, ['If-None-Match: "not-the-tag"']);

    $out[] = $path . '{' . $c1 . '/' . $len1
           . ' match=' . $c2 . '/' . $len2
           . ' stale=' . $c3 . '/' . $len3 . '}';
}

/* The policy the server SENDS still names every inline script the page it
   SENDS carries. Reading .htaccess would only say what the repository thinks. */
[, , , $headHtml] = $ask('/');
$html = (function () {
    $ch = curl_init('https://127.0.0.1/');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false, CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT => 30,
    ]);
    $b = (string) curl_exec($ch); curl_close($ch); return $b;
})();
$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$blocked = 0;
foreach ($s[1] as $b) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $b, true)), $declared, true)) $blocked++;
}

echo 'SEOETAG wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | ' . implode(' ', $out)
   . ' inlineScripts=' . count($s[1]) . ' BLOCKED=' . $blocked
   . "\n";
