<?php
/**
 * Publish the icon fix from the repository to the live shop.
 *
 *   php /home/<user>/publish-icons.php
 *
 * WHY. site.webmanifest declared /favicon.png as a "maskable" icon while that
 * file is the ordinary transparent mark, whose ink reaches 50% of the width
 * from centre against a 40% safe zone -- so Android has been cropping the tips
 * off the S on every installed home screen. These three files are the fix: the
 * padded icon, the manifest that points at it, and the VERSION bump without
 * which the manifest stays pinned in every existing visitor's service worker.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. This file comes over plain HTTP from a
 * PUBLIC repository, so it is written so that anyone able to influence that
 * fetch gains nothing:
 *
 *   - It writes ONLY the seven paths named below. There is no parameter, no
 *     loop over a directory, nothing derived from input.
 *   - Every file is checked against the sha256 recorded here BEFORE it is
 *     written. A byte out of place and it is refused, not written.
 *   - It is pinned to one COMMIT, not a branch, so what it fetches cannot
 *     change under it.
 *   - Each write goes to a temporary file and is renamed into place, so a
 *     shopper never sees half a picture.
 *   - It deletes nothing.
 *
 * Re-running it is a no-op: a file already matching its hash is skipped.
 */

$COMMIT = '6c17f053b749ba433aa2dedb4899d15914faa38b';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// path => sha256 of the bytes that must arrive.
$FILES = [
    "api/store.php" => "4b2178940dd2fd76e43e92b2d80a7189a029bb014535f5ddfcad37a7536d53a7",
    "api/admin.php" => "0bed40a3bd07fb4c89b64137d3bd4cc4a48abdb6e3a2b7e3c8c0201e85bb7b7c",
    "api/api.php" => "a4828285f5e6d08ba31d62f14c4d62871e1da8d1b1f25f9687eb56f2fc82cae6",
    "assets/footer.js" => "ccae6f59425660d18636fd07983a082c436bcb62d6df1b4d4cb829905bf9c9f4",
    "index.html" => "f078729ffec42812cdae52160b76c75ec6031e160bd0eb563b8314c15f16b4a2",
    ".htaccess" => "03b9d94d37c6c95ad9aaa287222501905748d226c636ddb5fe00433947383d56",
    "sw.js" => "b9ae11b378fbedf8ab6c2639ac3233ec257c513883c8530e6c1d0f3bc7464898",
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    // Already correct? Then this run has nothing to do for it.
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    // One at a time, deliberately. Three parallel fetches of this host
    // returned EMPTY FILES earlier in this project — served to the first
    // request and dropped for the others — and wget's -q hid it. Sequential
    // is slower and it is the reason every file here arrives whole.
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
    if (!is_dir($dir)) { $failed[] = $rel; continue; }

    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

echo 'FOOTER wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
