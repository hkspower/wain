<?php
/**
 * Publish the theme editor: seven files, checked before and after.
 *
 *   php /home/<user>/publish-theme.php
 *
 * WHY. The owner can now set the shop's colours, fonts and corner radius in
 * /backends. Every field is empty by default and empty emits nothing, so this
 * publish must leave the live shop looking EXACTLY as it does now — that is the
 * property the check at the bottom actually tests.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - seven paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * AND IT VERIFIES ITSELF. Three of these — .htaccess, api/store.php,
 * api/api.php — can take the shop down rather than degrade it. Every target is
 * backed up beside itself first; afterwards the home page, the products API and
 * the new theme route are all fetched over the loopback, and ANY of them
 * failing rolls all seven back.
 *
 * Re-running it is a no-op.
 */

$COMMIT = '123a36f';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    ".htaccess" => "b2171fa61ccd4645f5b12428bb95e0d3332b6477182f6bbd6cee137bf79e20ab",
    "index.html" => "f81d87eaa9671f77b15802e1e8fa4d32996e6bb82bfaa17b5393a89717dc8f5e",
    "sw.js" => "26575627390fbf555755c2632372bf206b4296a792dbeb77a0386d60fcf7558a",
    "assets/theme.js" => "2d95092b8d213999272eedfd6ecd8260e25a46471b10871722594c3c9d41fcf9",
    "api/store.php" => "85f732e836e9607c3334097e4fad339721ad84c3c0c350ed5dc8aabccbcdfaa9",
    "api/admin.php" => "dd9ddf0ab482ef425fcb05f471e4241f32a8b860d08e7a73bb08811baee541a0",
    "api/api.php" => "ecd7d93323514a00b61b1a83bb7492e24f8267f202dcf0864400e3ca5fa63b33",
];

/** One loopback GET. Works whether or not the domain resolves. */
function pub_get(string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, is_string($body) ? $body : ''];
}

$wrote = 0; $same = 0; $bad = []; $failed = []; $backups = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    // ONE AT A TIME: three parallel fetches of this host have returned empty
    // files in this project before, and -q hid it.
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
    if (!is_dir(dirname($target))) { $failed[] = $rel; continue; }

    if (is_file($target)) {
        $bk = $target . '.bak-' . date('Ymd-His');
        if (!@copy($target, $bk)) { $failed[] = $rel; continue; }
        $backups[$target] = $bk;
    }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

$verdict = 'notchecked';
if ($wrote > 0) {
    [$hc, $hb] = pub_get('/');
    [$pc, $pb] = pub_get('/api/api.php?r=products');
    [$tc, $tb] = pub_get('/api/api.php?r=theme');
    // The theme route must answer, and must answer with the EMPTY defaults —
    // nothing has been saved, so anything else means this publish changed how
    // the shop looks, which it must not.
    $themeOk = $tc === 200 && $tb !== '' && strpos($tb, '"brand":""') !== false;
    if ($hc === 200 && strlen($hb) > 1000 && $pc === 200 && strlen($pb) > 1000 && $themeOk) {
        $verdict = 'ok';
    } else {
        foreach ($backups as $target => $bk) @copy($bk, $target);
        [$rc] = pub_get('/');
        $verdict = 'ROLLEDBACK:home' . $hc . ',products' . $pc . ',theme' . $tc
                 . ($rc === 200 ? '-recovered' : '-STILLDOWN');
    }
}

echo 'THEME wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES)
   . ' shop=' . $verdict . "\n";
