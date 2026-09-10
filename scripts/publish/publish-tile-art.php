<?php
/**
 * Publish the tile fix: drop the name bridge, add the Arabic women's frame.
 *
 *   php /home/<user>/publish-tile-art.php
 *
 * TWO FILES.
 *
 *   .htaccess                     loses the rewrite that bridged
 *                                 /cats/<crop>/<id>.jpg onto art-<id>.jpg.
 *   cats/mobile/art-women-rtl.jpg new. The app asks for it once it knows the
 *                                 reading direction; it was in the app and not
 *                                 on the server.
 *
 * WHY REMOVING A REWRITE IS THE FIX. The tile component renders TWO <picture>
 * blocks. The first asks for the plain name and carries a single jpeg; only
 * when that ERRORS does it fall to the second — and the second carries the webp
 * sources and the `-rtl` suffix that selects the Arabic composition. Bridging
 * the first name onto a real file meant the second never rendered. Measured in
 * a browser, both languages, 2026-09-09:
 *
 *   desktop  285 kB of jpeg  ->  203 kB of webp     82 kB a load
 *   phone    212 kB          ->  145 kB
 *   Arabic   art-men.jpg     ->  art-men-rtl.webp
 *
 * FOUR 404s COME BACK AND THEY ARE THE PRICE. 552 bytes each, and they are how
 * the component finds its better path. site-scan.sh, site-scan.mjs and
 * image-audit.mjs have all been told to expect exactly those four.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - two paths, named below, nothing derived from input
 *   - each checked against a sha256 recorded here BEFORE it is written
 *   - .htaccess REFUSED unless the live copy is exactly the version this was
 *     made against, with a timestamped backup kept beside it
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing
 *
 * THE CHECK ASKS THE SERVER WHAT IT SERVES, for three things reading the file
 * back cannot answer: that the plain name no longer resolves to an image, that
 * the real name still does, and that every inline script in the page is still
 * allowed by the policy — the trap that once silently disabled the boot script.
 */

$COMMIT = '30354f2';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/** The .htaccess this was made against — the copy published with the uploaders. */
$HTACCESS_MUST_BE = 'f782e39d61cd6968492cbf324a2792aac3d2af7823c0606c7c799487bc2f8505';

$FILES = [
    'cats/mobile/art-women-rtl.jpg' => '5f6d6a54ee334c137164d8243b4902470918290a84d87ae4033553e891df094f',
    '.htaccess'                     => 'f09e1308cffc48b9e1d1deacabc9e06a8c950e81246e75424aaf354869d376a6',
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
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** One loopback request: status, content-type, bytes, and the headers. */
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
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return [substr($res, 0, $hlen), substr($res, $hlen), $type];
};

[$h1, , $t1] = $get('/cats/desktop/men.jpg');          // must NOT be an image now
[, $b2, $t2] = $get('/cats/desktop/art-men-rtl.webp'); // must be
[, $b3, $t3] = $get('/cats/mobile/art-women-rtl.jpg'); // the new file
[$hdr, $page, ] = $get('/');

preg_match('/content-security-policy:([^\r\n]*)/i', $hdr, $m);
preg_match_all("/'sha256-([A-Za-z0-9+\/=]+)'/", $m[1] ?? '', $mm);
$allowed = $mm[1] ?? [];
preg_match_all('/<script(?![^>]*\ssrc=)[^>]*>(.*?)<\/script>/s', $page, $sm);
$blocked = 0;
foreach ($sm[1] as $s) {
    if (!in_array(base64_encode(hash('sha256', $s, true)), $allowed, true)) $blocked++;
}

echo 'TILEART wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' refused=' . (count($refused) ? implode(',', $refused) : '0')
   . ' plainName=' . (strpos($t1, 'image/') === 0 ? 'STILL-BRIDGED' : 'not-an-image')
   . ' rtlWebp=' . (strpos($t2, 'image/webp') === 0 ? strlen($b2) : 'MISSING')
   . ' womenRtl=' . (strpos($t3, 'image/') === 0 ? strlen($b3) : 'MISSING')
   . ' inlineBlocked=' . $blocked
   . "\n";
