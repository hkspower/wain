<?php
/**
 * Do all four category tiles fall to their GOOD <picture>, or does one of them
 * still resolve under its plain name?
 *
 * READ-ONLY. Four loopback fetches and one directory listing. Nothing is
 * written, no configuration value is printed.
 *
 * WHY IT EXISTS. The tile component renders TWO <picture> blocks. The first
 * asks for the PLAIN name (/cats/<crop>/<id>.jpg) and carries one jpeg; only
 * when that ERRORS does the browser fall to the second, which is the good one —
 * webp sources, and the -rtl suffix that selects the Arabic composition. So a
 * plain name that answers 200 is not a fixed 404, it is a tile permanently
 * pinned to the worse image, in the wrong language half the time.
 *
 * The internal rewrite that bridged the plain names onto art-<id>.jpg was
 * removed for exactly that reason, and three rigs now assert EXACTLY FOUR
 * plain-name 404s. live-file-check reported cats/desktop/outlet.jpg as a file
 * the repository does not track — so the bridge may be gone while a leftover
 * FILE keeps one tile bridged anyway, which no rig here can see because they
 * all run against the sandbox.
 *
 * Asked three ways per name, for the reason live-tile-probe.php records: /cats/
 * is served with max-age=86400 plus a month of stale-while-revalidate, so a
 * cached response can outlive the rule that made it. A cache-busted URL the
 * cache has never seen is the one that answers about the DISK.
 */
$root = '/home/u130124229/domains/sporta.com.kw/public_html';

$ask = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Cache-Control: no-cache'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return $code . (strpos($type, 'image/') === 0 ? '/img/' : '/non/') . strlen($body);
};

$out = [];
foreach (['men', 'women', 'kids', 'outlet'] as $id) {
    // Cache-busted, so the answer is about the disk rather than about a copy
    // cached while the bridge was still in force.
    $out[] = $id . '=' . $ask('/cats/desktop/' . $id . '.jpg?cb=' . bin2hex(random_bytes(4)));
}

// What is actually on disk under both crops, which is the other half: a URL
// that answers cannot be explained without knowing whether a file is there.
$dirs = [];
foreach (['desktop', 'phone'] as $crop) {
    $d = $root . '/cats/' . $crop;
    $f = is_dir($d) ? array_values(array_diff(scandir($d), ['.', '..'])) : [];
    sort($f);
    $dirs[] = $crop . '[' . implode(' ', $f) . ']';
}

echo 'TILENAMES ' . implode(' ', $out) . ' | ' . implode(' ', $dirs) . "\n";
