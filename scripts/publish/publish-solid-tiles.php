<?php
/**
 * Publish the solid, square, full-width category tiles — two files, in order.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-solid-tiles.php && php r.php
 *
 * WHAT THIS SHIPS. sporta-ui.css hides each tile's photograph and paints a
 * flat brand colour instead (--brand-bright for men/women, --brand for
 * accessories, --brand-dark for outlet), forces the grid to one column at
 * every width, and switches the copy to ink for contrast on the brighter
 * ground. Nothing in index.html or the bundle changes — this is the overlay
 * pattern the storefront already uses for rules.js, google-signin.js and
 * panel-settings.js, applied to an existing fixed-name asset instead of a
 * new file, so there is no index.html reference to add.
 *
 * ORDER MATTERS. sw.js LAST, because it is the thing that frees a returning
 * visitor's cached copy of sporta-ui.css — publishing the new stylesheet
 * before the worker version bump is harmless (the old worker just keeps
 * serving the old copy a little longer, exactly as designed); publishing the
 * bump first would tell a worker to stop pinning a file that has not
 * actually changed on the server yet.
 *
 * $COMMIT pins the files; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin — an abbreviated sha here is a 404 that
 * reports nothing.
 */

$COMMIT = '12fd235a2ee5205959390110d8b9d38bdadcbee9';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => 'ee7b8e6282ed17e7114e9ef7850e768e81159e3529de37894467b2171ce19f80',
    'sw.js'                => '6edfb3061db99a9ad6832901b7c0d5678839bddf821967e22ad8301e28695fb5',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                            CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200 || $body === '') { $failed[] = $rel . '/http' . $code; break; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; break; }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }   // stop: the order is the safety
}

/* --------------------------------------------------- and ask the live server */
$head = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
                            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
                            CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25]);
    $out = (string) curl_exec($ch);
    $sz  = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $rc  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$rc, substr($out, 0, $sz), strlen(substr($out, $sz))];
};

[$hc, , $hlen]  = $head('/');
[$ac, , $alen]  = $head('/api/api.php?r=products');
[$cc, $ch2]     = $head('/assets/sporta-ui.css');
$cssNoCache     = stripos($ch2, 'no-cache') !== false;
[$sc, $sh]      = $head('/sw.js');
$swNoCache      = stripos($sh, 'no-cache') !== false;

echo 'SOLIDTILES wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hlen
   . ' api=' . $ac . '/' . $alen
   . ' css=' . $cc . '/' . ($cssNoCache ? 'no-cache' : 'CACHEABLE')
   . ' sw=' . $sc . '/' . ($swNoCache ? 'no-cache' : 'CACHEABLE')
   . "\n";
