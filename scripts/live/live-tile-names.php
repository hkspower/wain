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

/* The names are DERIVED from the artwork on disk, not listed here. The first
   version of this script listed four by hand and two of them were invented —
   `kids`, which is not a category, and a `phone` crop that is really called
   `mobile`. Both answered exactly as a correct server would, so the run read as
   two more passing checks. A fixture typed from memory is a fixture chosen at
   random; the directory already knows the answer. */
$dirs = []; $out = []; $bridged = [];
foreach (['desktop', 'mobile'] as $crop) {
    $d = $root . '/cats/' . $crop;
    if (!is_dir($d)) { $dirs[] = $crop . '=NO-SUCH-DIR'; continue; }

    $files = array_values(array_diff(scandir($d), ['.', '..']));
    sort($files);
    $dirs[] = $crop . '[' . implode(' ', $files) . ']';

    $ids = [];
    foreach ($files as $f) {
        // art-<id>.jpg, minus the -rtl compositions and the infobar, which is
        // referenced by its real name and has no plain-name twin.
        if (preg_match('/^art-([a-z0-9-]+?)(-rtl)?\.jpg$/', $f, $m)) $ids[$m[1]] = true;
    }
    ksort($ids);

    foreach (array_keys($ids) as $id) {
        // Cache-busted, so the answer is about the disk rather than about a
        // copy cached while the bridge was still in force.
        $r = $ask('/cats/' . $crop . '/' . $id . '.jpg?cb=' . bin2hex(random_bytes(4)));
        $out[] = $crop . '/' . $id . '=' . $r;
        if (strpos($r, '200/') === 0) $bridged[] = $crop . '/' . $id;
    }
}

echo 'TILENAMES ' . implode(' ', $out)
   . ' STILL-BRIDGED=' . (count($bridged) ? implode(',', $bridged) : '0')
   . ' | ' . implode(' ', $dirs) . "\n";
