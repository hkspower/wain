<?php
/**
 * Publish the hero banners from the repository to the live shop.
 *
 *   php /home/<user>/publish-hero.php
 *
 * WHY. A folder audit found all twenty cats/art-* files differing between the
 * repository and the server, the server's consistently smaller. The repository
 * is the source of truth for artwork, so this brings the shop to it.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. This file comes over plain HTTP from a
 * PUBLIC repository, so it is written so that anyone able to influence that
 * fetch gains nothing:
 *
 *   - It writes ONLY the ten paths named below, all under hero/. There is
 *     no parameter, no loop over a directory, nothing derived from input.
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

$COMMIT = '0e9a78ddbe5a2c2e6490c98594ec54f7fd48f726';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// path => sha256 of the bytes that must arrive.
$FILES = [
    "hero/mobile/bodybuilding-men.webp" => "5484ac27210d9ec63706411eae516d56c71a6c143645f24c3f4d775b6cf32823",
    "hero/mobile/bodybuilding-women.webp" => "d0d210e2220e383110b47f79fbae40db8b02c162a3d673699018aee32f7ad236",
    "hero/mobile/cardio-men.webp" => "bc0e59d337786202650af4325d032f92ebd71bb515853caef7b024c40d108d77",
    "hero/mobile/cardio-women.webp" => "0db9c09ecb41c1d6ed7473fe59efed3b3e68a3c525b0326f8f700be918bf8e66",
    "hero/mobile/crossfit-men.webp" => "4bfa626816516c805d31ab73170ff4b8dbe692570e6bc4ad835842c9b6311a38",
    "hero/desktop/bodybuilding-men.webp" => "619cf45e749830106a81cbc4e7846153319034b1ee1f09afd23f35f48ffb2aec",
    "hero/desktop/bodybuilding-women.webp" => "157f046e6a987199d94f2a77abc683faf80362b63572881bb5a99f85345613b5",
    "hero/desktop/cardio-men.webp" => "c57816624920687f36eff47771c692956fb7554cdb71816dd5f158602556d7ba",
    "hero/desktop/cardio-women.webp" => "1bbf419d8f6fba16ccda266e56e5488487c64b2829406ecbbba5b837b5702d5c",
    "hero/desktop/crossfit-men.webp" => "d405b8e7976a80a59a5a399f2c0b1ea0e45a05e7875a1c18341240e46a03c38c",
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

echo 'HERO wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
