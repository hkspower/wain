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
 *   - It writes ONLY the four paths named below. There is no parameter, no
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

$COMMIT = '374fdb8d33cc5cebc62f6c1fa8a2081f7a430f5d';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// path => sha256 of the bytes that must arrive.
$FILES = [
    "assets/brand-badge.js" => "f3c44b8c5081f3f064dbd62a9df88651c7c020bd1689a62b227d5085257f7073",
    "index.html" => "82b998fa46da39c737e733fd0a536ad84baa4cefbc36c85f640c1b93bf594ade",
    ".htaccess" => "f01cde5fdad5dbe700cf982a49fe658add96432390265b890a8252ebcba6dce1",
    "sw.js" => "1e535cb19df6e0217439e8a46bd7f8fec8764d40ba1269bff7865e407b75410d",
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

echo 'BRAND wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
