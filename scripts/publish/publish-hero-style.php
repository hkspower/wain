<?php
/**
 * Publish the hero's reduced shadows and headline type.
 *
 *   php /home/<user>/publish-hero-style.php
 *
 * ONE FILE: assets/sporta-ui.css. It carries the three shadow reductions the
 * owner asked for — the blurred backdrop, the orange wash and the CTA glow —
 * and the headline line-height and Latin-only tracking that apply to an
 * uploaded photo slide.
 *
 * NO SERVICE-WORKER VERSION BUMP, and that is checked rather than assumed.
 * sw.js pins only content-hashed names: HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css)$/,
 * and `sporta-ui.css` has no hash, so IMMUTABLE() is false and it falls to
 * rule 3, network-first. .htaccess also sends it no-cache, must-revalidate.
 * Both layers therefore hand a visitor the new file on their next request. A
 * bump here would only throw away everyone's warm cache for nothing.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * The check reads the file BACK OVER HTTP and looks for the new rules in the
 * bytes the server serves — not on disk, which is a different claim when a
 * cache sits in front.
 */

$COMMIT = '2869ecc';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = ["assets/sporta-ui.css" => "07a6acc355fb5695bb25fe5b66b391e46a9e3878727f5709a930d15bb996d34e"];

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
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

// What the SERVER hands out, and whether the new rules are in it.
$ch = curl_init('https://127.0.0.1/assets/sporta-ui.css');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$served = (string) curl_exec($ch);
curl_close($ch);

$hasHaze = strpos($served, 'blur(26px)') !== false;
$hasWash = strpos($served, '#ff7b1729') !== false;
$hasType = strpos($served, 'line-height: 1.12') !== false;

echo 'HEROSTYLE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' servedBytes=' . strlen($served)
   . ' haze=' . ($hasHaze ? 'ok' : 'MISSING')
   . ' wash=' . ($hasWash ? 'ok' : 'MISSING')
   . ' type=' . ($hasType ? 'ok' : 'MISSING') . "\n";
