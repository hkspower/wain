<?php
/**
 * Undo the solid, square tile design and restore the photographic category
 * tiles — two files, in order, the mirror image of publish-solid-tiles.php.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-tiles-photo-restored.php && php r.php
 *
 * WHAT THIS SHIPS. sporta-ui.css drops the solid-brand-colour tile rules
 * entirely, so the bundle's own photographic <picture> markup (art-men.webp,
 * art-women.webp etc, already live under /cats/) is what paints again. Asked
 * for by the owner: "use the old catogry images instood new design".
 *
 * ORDER MATTERS, for the same reason as the commit this undoes: sw.js LAST,
 * because it is what frees a returning visitor's cached copy of
 * sporta-ui.css. Publishing the CSS first is harmless — the old worker just
 * keeps serving the old (solid-tile) stylesheet a little longer, exactly as
 * designed; bumping the worker first would tell it to stop pinning a file
 * that has not changed on the server yet.
 *
 * $COMMIT pins the files; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin — an abbreviated sha here is a 404 that
 * reports nothing.
 */

$COMMIT = 'f33600ea7ba8e2e8caf1898e8b151dfc230437cc';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => '437d7e894c2d6cd89afa93da73128926ecca0d3b1d213431ae8574d879dbefa0',
    'sw.js'                => '0f569662963c94a66c48b6decbb5020c6659d92c71833cab4b609a585755cc7b',
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

echo 'TILESRESTORE wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hlen
   . ' api=' . $ac . '/' . $alen
   . ' css=' . $cc . '/' . ($cssNoCache ? 'no-cache' : 'CACHEABLE')
   . ' sw=' . $sc . '/' . ($swNoCache ? 'no-cache' : 'CACHEABLE')
   . "\n";
