<?php
/**
 * Publish the first-admin registration form, the must-change-password
 * banner it turned out was still missing, and the corrected .htaccess.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-first-admin-and-htaccess.php && php r.php
 *
 * FOUR FILES, not three. live-file-check.php was run before this publisher
 * was written and reported `missing=2:assets/first-admin.js,
 * assets/force-password-notice.js` — the second one was never actually
 * published in the earlier "codes only, no assets" round (deliberately, per
 * that instruction), so index.html would have referenced a file the server
 * did not have. Caught before publishing rather than after.
 *
 * .htaccess is included because it now names first-admin.js,
 * force-password-notice.js, footer-payment-icons.js and trust-strip.js in
 * its no-cache FilesMatch — see the commit this ships from for why: two of
 * those four were being served `public, max-age=31536000, immutable` on the
 * live server, a year of caching on files that get edited, because
 * htaccess-test.mjs's own looksHashed() had a blind spot for hyphenated
 * multi-word filenames.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: each path checked
 * against the sha256 recorded here before it is written, pinned to one
 * commit, fetched one at a time, idempotent.
 */

$COMMIT = '4828820e594d373976d5e3350f0693755340ab0d';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/first-admin.js'          => '6a32ca37d71936f7783d9d4f436c385a69df36c78618ad30d1e70e78c81ef65f',
    'assets/force-password-notice.js' => '79f095525ce54694729e775e0c84c18f4be6991c402a04483bb55a1718d54c83',
    '.htaccess'                      => '058fe5a77282f13ac4790cb8999fe9a9ff7dc711ffec2137aeb519590c7c1dc7',
    'index.html'                     => 'c81fcb06033dbb1e08b25b0bb336532ac38e778ddeb022c62501c7ecc06c2892',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

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

echo 'FIRST-ADMIN-AND-HTACCESS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
