<?php
/**
 * Publish the shrunk assistant icon — 2 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-icon-resize.php && php r.php
 *
 * assistant-bot.png/.webp were the site's own 192px PWA icon reused as-is,
 * but the assistant panel only ever draws it at 28px or 20px — measured,
 * 9.6x oversampled at the smaller box, well beyond image-render-audit.mjs's
 * generous 3x (retina-covering) threshold. Downscaled to 96px via Lanczos
 * resampling — a reduction, so the artwork itself is unchanged, only
 * smaller. No sw.js VERSION bump needed: neither file is in the service
 * worker's PRECACHE list, and the 30-day cache-then-revalidate window these
 * get from .htaccess is the same tradeoff already accepted for favicon and
 * logo replacements.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: two named paths,
 * each checked against the sha256 recorded here before it is written,
 * pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '8f6d17d720e77d30542b33da3f1874753ea3ce7f';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assistant-bot.png'  => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
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

echo 'ICON-RESIZE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
