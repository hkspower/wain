<?php
/**
 * Publish the hero band's edge fade — 2 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-band-fade.php && php r.php
 *
 * Softens the hard edge where the phone hero's artwork ends and the 104px
 * band underneath it (holding the "Shop now" button and the carousel
 * controls) begins — a 28px gradient fade painted on the artwork's own box,
 * using .hero-strength's own darkest gradient stop at just over half
 * strength. The band itself, its height, the button and the controls are
 * all unchanged: a full overlay on phones was tried twice before and both
 * times covered the banners' own baked-in headline/strapline text (see the
 * long comment two sections up in sporta-ui.css). Desktop is untouched —
 * the fade is scoped to max-width:767px, where desktop already overlays the
 * button directly on the artwork and never had a band.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: two named paths,
 * each checked against the sha256 recorded here before it is written,
 * pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '45e8adea7866b213b54f7c1074ab0eee3677fe83';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css' => '1579c256693fe2d06fdafa12544973e59209c2cd3aa61c34a5f3a241a9f9bee9',
    'sw.js'                => '083dd59de401afaf5633422e53cd8b30049f79cfed017446f2a152a423c0f02d',
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

echo 'HERO-FADE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
