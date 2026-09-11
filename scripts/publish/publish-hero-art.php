<?php
/**
 * Publish the 1600px hero art for phones.
 *
 *   php /home/<user>/publish-hero-art.php
 *
 * WHY. hero/mobile was 1000px and the box crops ~17% of it, so a 393px phone at
 * DPR 3 got 833 pixels of picture where it wanted 1179 — upscaled 1.4x, and
 * worse on a larger phone. The desktop art is the same photograph at 1600px, so
 * these five ARE that file: same crop, same focal point, more pixels. Measured
 * in Chromium before and after; 393@3x and 430@3x both go from upscaled to
 * sharp. It costs about 21 kB on the phone's largest image.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - five paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * NO SERVICE-WORKER VERSION BUMP, deliberately. /hero/ is already handled as
 * replaceable at both layers: .htaccess gives it a day fresh then
 * stale-while-revalidate, and sw.js rule 2b serves the cached copy instantly
 * and refreshes it behind. A returning visitor sees the old banner once more
 * and the new one thereafter, which is what those rules were written for.
 *
 * The check at the end reads the bytes BACK OVER HTTP and confirms the server
 * is serving 1600px art — not merely that the file on disk is right, which is
 * a different claim when a cache sits in front of it.
 */

$COMMIT = '928eb04';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    "hero/mobile/bodybuilding-men.webp" => "619cf45e749830106a81cbc4e7846153319034b1ee1f09afd23f35f48ffb2aec",
    "hero/mobile/bodybuilding-women.webp" => "157f046e6a987199d94f2a77abc683faf80362b63572881bb5a99f85345613b5",
    "hero/mobile/cardio-men.webp" => "c57816624920687f36eff47771c692956fb7554cdb71816dd5f158602556d7ba",
    "hero/mobile/cardio-women.webp" => "1bbf419d8f6fba16ccda266e56e5488487c64b2829406ecbbba5b837b5702d5c",
    "hero/mobile/crossfit-men.webp" => "d405b8e7976a80a59a5a399f2c0b1ea0e45a05e7875a1c18341240e46a03c38c",
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    // ONE AT A TIME. Five parallel fetches of this host is exactly the shape
    // that returned empty files in this project before.
    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = basename($rel); continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = basename($rel); continue; }
    if (!is_dir(dirname($target))) { $failed[] = basename($rel); continue; }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = basename($rel);
}

// WHAT THE SERVER SERVES, over the loopback, not what is on disk.
$servedW = 0;
$ch = curl_init('https://127.0.0.1/hero/mobile/bodybuilding-men.webp');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$img = curl_exec($ch);
curl_close($ch);
if (is_string($img) && $img !== '') {
    $tmp = sys_get_temp_dir() . '/sporta-hero-' . bin2hex(random_bytes(4)) . '.webp';
    if (@file_put_contents($tmp, $img)) {
        $sz = @getimagesize($tmp);
        if ($sz) $servedW = (int) $sz[0];
        @unlink($tmp);
    }
}

echo 'HEROART wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES)
   . ' servedWidth=' . ($servedW ?: 'unknown')
   . ' phoneDpr3=' . ($servedW >= 1420 ? 'sharp' : 'STILL-SOFT') . "\n";
