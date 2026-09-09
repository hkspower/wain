<?php
/**
 * Publish both bulk uploaders and the helpers they share.
 *
 *   php /home/<user>/publish-uploaders.php
 *
 * FIVE FILES, and the ORDER THEY LAND IN DOES NOT MATTER but the order they
 * LOAD IN does. admin-upload.js defines window.sportaUpload; brand-logos.js and
 * product-photos.js each return immediately without it. index.html loads the
 * three as `defer` scripts in document order, which is what makes a half-
 * published set a missing card rather than a broken panel — so this can be run
 * again safely if it is interrupted.
 *
 *   assets/admin-upload.js    new. The request shape, the filename folding and
 *                             the WebP shrink, shared by both cards.
 *   assets/product-photos.js  new. The Catalogue screen's bulk photograph
 *                             uploader — photos=0/46 is what it is for.
 *   assets/brand-logos.js     changed: now uses the shared helpers instead of
 *                             its own copies.
 *   index.html                loads the three, in order.
 *   .htaccess                 adds admin-upload.js and product-photos.js to the
 *                             list of fixed-name files that must revalidate.
 *                             Forgetting that is how brand-logos.js spent an
 *                             hour on heuristic caching.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - five paths, named below, nothing derived from input
 *   - each checked against a sha256 recorded here BEFORE it is written
 *   - .htaccess additionally REFUSED unless the live copy is exactly the
 *     version this change was made against, with a timestamped backup kept
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing
 *
 * No service-worker bump: index.html is a navigation and neither script carries
 * a content hash, so sw.js treats all of them network-first.
 *
 * THE CHECK ASKS THE SERVER, not the files. Two things reading .htaccess back
 * would not answer: whether every inline script in the page it serves is still
 * allowed by the policy it sends — the trap that silently disabled the boot
 * script once already — and whether LiteSpeed actually applies the
 * Cache-Control directive rather than merely holding it.
 */

$COMMIT = '3927e62';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/** The .htaccess this change was made against — the copy published with the
 *  brand-logos cache rule. Anything else and the file is left alone. */
$HTACCESS_MUST_BE = 'f574b112851ddbf79bd1ce6a773d7304de37f8684047a19714efb9ddee8b1202';

$FILES = [
    'assets/admin-upload.js'   => 'a7325254d8357aa8ae12ba87d5e35f10f693b9ca42aa354e0145d0a37475a736',
    'assets/product-photos.js' => 'e2f9b09e866daf8d73992c8693a741b678355f7dbb5fb516e52c799baab98d87',
    'assets/brand-logos.js'    => '4130be8ed34ad5a000a3b1a2b3c66651a3f39ce49ff9986af7cf50ca753e90b8',
    'index.html'               => '6e7574b3cb9a2eeaca73779529cc79b8e74d1a235eddb8bf7889c7e39820d0b2',
    '.htaccess'                => 'f782e39d61cd6968492cbf324a2792aac3d2af7823c0606c7c799487bc2f8505',
];

$wrote = 0; $same = 0; $bad = []; $failed = []; $refused = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if ($rel === '.htaccess' && is_file($target)) {
        $now = hash_file('sha256', $target);
        if ($now !== $want && $now !== $HTACCESS_MUST_BE) { $refused[] = $rel; continue; }
    }

    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 90,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    if ($rel === '.htaccess' && is_file($target)) {
        @copy($target, $ROOT . '/.htaccess.bak-' . date('Ymd-His'));
    }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** One loopback request, headers and body. */
$get = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $res  = (string) curl_exec($ch);
    $hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [substr($res, 0, $hlen), substr($res, $hlen)];
};

[$hdr, $page] = $get('/');
preg_match('/content-security-policy:([^\r\n]*)/i', $hdr, $m);
preg_match_all("/'sha256-([A-Za-z0-9+\/=]+)'/", $m[1] ?? '', $mm);
$allowed = $mm[1] ?? [];
preg_match_all('/<script(?![^>]*\ssrc=)[^>]*>(.*?)<\/script>/s', $page, $sm);
$blocked = 0;
foreach ($sm[1] as $s) {
    if (!in_array(base64_encode(hash('sha256', $s, true)), $allowed, true)) $blocked++;
}

$cc = static function (array $r): string {
    return preg_match('/cache-control:\s*([^\r\n]*)/i', $r[0], $x) ? trim($x[1]) : 'NONE';
};
$up = $get('/assets/admin-upload.js');
$pp = $get('/assets/product-photos.js');

echo 'UPLOADERS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' refused=' . (count($refused) ? implode(',', $refused) : '0')
   . ' inlineBlocked=' . $blocked
   . ' tags=' . (strpos($page, '/assets/admin-upload.js') !== false
              && strpos($page, '/assets/product-photos.js') !== false ? 'ok' : 'MISSING')
   . ' sharedBytes=' . strlen($up[1]) . ' photosBytes=' . strlen($pp[1])
   . ' cache="' . $cc($pp) . '"'
   . "\n";
