<?php
/**
 * Publish the promo-strip removal and the سبورتا AI icon — 6 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-promo-bot.php && php r.php
 *
 * WHAT THIS CARRIES:
 *   1. The promo strip removed from the header (sporta-ui.css), and the
 *      boot shell (index.html) re-measured and shrunk to match the real
 *      header's new, shorter height — see CLAUDE.md, "remove promotion
 *      bar", for why the shell had to move too.
 *   2. A dedicated icon for the سبورتا AI launcher and its open panel
 *      (assistant-bot.png/.webp, new files) in place of the plain site
 *      favicon it used to reuse, wired up by assets/assistant-icon.js
 *      (new overlay).
 *   3. sw.js VERSION bumped, since sporta-ui.css and assistant-icon.js are
 *      both fixed-name cached assets.
 *
 * ORDER MATTERS a little here, in the direction of "harmless either way":
 * index.html referencing assistant-icon.js before that file exists is a
 * 404 for a deferred script, same as every other overlay's own publisher
 * already argues. Nothing here is a PHP change, so there is no fatal-error
 * window like a PHP publish would have.
 *
 * WHY IT IS SAFE TO FETCH AND RUN, same shape as every other publisher in
 * this directory:
 *   - six paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not the working branch
 *   - fetched ONE AT A TIME
 *   - temp file + rename; deletes nothing; idempotent
 */

$COMMIT = 'c174835164704302b483fbda83228c09114290f6';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'index.html'                => '3c4a990ee97c1be3b957035f6e8a06f5e4ebbb22e12ded873f633f26c8e51009',
    'assets/sporta-ui.css'      => 'fc2ec44f50ef82107f1c5ce4b6de7b82dfb048e19deef372e702e1fb77fe1732',
    'sw.js'                     => '27fb9e8db82dae5e4d994519659cea83e501c94f3b6381642c4f8f9442145a62',
    'assets/assistant-icon.js'  => '449958d4c49615a71e3e4ed3464bd42163ff0c37de01caea5f2824f559ca4f41',
    'assistant-bot.png'         => '1968893e2c7ca2ca60dd0db259d0c62fb49da81928354ae5cb0eef1ee2a6bb0f',
    'assistant-bot.webp'        => 'f23292794a840a37474a554499b97b19dd15ee0f42c8cd35c100fb157afc1a20',
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

/** What the live server serves, over the loopback so this works whether or
 *  not the public domain resolves and bypasses the CDN. */
$serve = static function (string $path, array $extra = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $extra),
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [substr($out, 0, $size), substr($out, $size), $code];
};

[$headHtml, $html, $homeCode] = $serve('/');
[, $swBody, $swCode]          = $serve('/sw.js');
[, $botBody, $botCode]        = $serve('/assistant-bot.webp');

$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$blocked = 0;
foreach ($s[1] as $b) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $b, true)), $declared, true)) $blocked++;
}

$swVersion = null;
if (preg_match("/VERSION\s*=\s*'([^']+)'/", $swBody, $vm)) $swVersion = $vm[1];

// Does the served page still carry the promo strip's own text? A quick,
// direct answer rather than trusting the CSS alone to have landed.
$hasPromoText = strpos($html, 'Delivery within 24 hours in Kuwait') !== false
    || strpos($html, 'التوصيل خلال ٢٤ ساعة') !== false;

echo 'PROMO-BOT wrote=' . $wrote . ' alreadyOk=' . $same
    . (count($bad) ? ' HASH-MISMATCH=' . implode(',', $bad) : '')
    . (count($failed) ? ' FAILED=' . implode(',', $failed) : '')
    . ' home=' . $homeCode . '/' . strlen($html)
    . ' botIcon=' . $botCode . '/' . strlen($botBody)
    . ' swVersion=' . ($swVersion ?? 'MISSING')
    . ' cspBlockedInline=' . $blocked
    . ' promoTextInMarkup=' . ($hasPromoText ? 'yes' : 'no')
    . "\n";
