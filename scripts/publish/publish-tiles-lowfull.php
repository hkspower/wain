<?php
/**
 * Publish the shorter, true-full-width, square-cornered category tiles.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-tiles-lowfull.php && php r.php
 *
 * Revises publish-solid-tiles.php's square version, shipped the same day:
 * the tiles go from 1:1 (capped at 480px) to 2.5:1 (no cap — the full width
 * of the container), and border-radius goes to 0 on all four. Same two
 * files, same order (sw.js last, so the VERSION bump lands after the
 * stylesheet it is bumping for).
 *
 * $COMMIT pins the files; fetch this script from HEAD. Full forty
 * characters, per test:publish-pin.
 */

$COMMIT = '98921f3c3f597482697b9a329965a8dc9d071db2';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => '4914daace1d46c8400c88475cc35f89d786a047caefce86515e73e6d51181202',
    'sw.js'                => '50ffa8d2e85719e8289e849e3d7f8031da4449f301d14d2aa29b7cae10463346',
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
    else { $failed[] = $rel . '/write'; break; }
}

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

[$hc, , $hlen] = $head('/');
[$ac, , $alen] = $head('/api/api.php?r=products');
[$cc, $ch2]    = $head('/assets/sporta-ui.css');
[$sc, $sh]     = $head('/sw.js');

echo 'TILESLOWFULL wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hlen
   . ' api=' . $ac . '/' . $alen
   . ' css=' . $cc . '/' . (stripos($ch2, 'no-cache') !== false ? 'no-cache' : 'CACHEABLE')
   . ' sw=' . $sc . '/' . (stripos($sh, 'no-cache') !== false ? 'no-cache' : 'CACHEABLE')
   . "\n";
