<?php
/**
 * What theme is the LIVE shop wearing, and what does its stylesheet cost?
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-theme-check.php && php r.php
 *
 * READ-ONLY. Five GETs over the loopback, every one of them a URL any visitor
 * can already fetch. Nothing is written and no configuration value is read.
 *
 * WHY. The sandbox has NO theme row, so every theme rig measures the shipped
 * defaults. The owner's /backends colour picker, fonts, radius and custom CSS
 * live in a settings row on the server, and a scan of "the theme" that never
 * asked what that row holds is a scan of a shop nobody visits. `?r=theme` is
 * public (theme.js fetches it on every page), so asking it here is asking what
 * every shopper's browser is already told.
 *
 * THE SECOND HALF IS THE WIRE. sporta-ui.css is built from commented sources,
 * and the comments ship. This asks the server for each stylesheet the way a
 * browser does (Accept-Encoding: gzip) and prints the bytes that actually
 * travel, so the cost is a measurement rather than a local estimate.
 *
 * Echoes each line as it is measured: an overrunning cron job reports nothing,
 * so a run cut short should still say what it got.
 */

$HOST = 'www.sporta.com.kw';

$get = static function (string $path, bool $gzip) use ($HOST): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    $h = ['Host: ' . $HOST];
    if ($gzip) $h[] = 'Accept-Encoding: gzip';
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => $h,
        CURLOPT_TIMEOUT        => 6,
        CURLOPT_CONNECTTIMEOUT => 3,
    ]);
    $raw  = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $head = substr($raw, 0, $hs);
    $enc  = preg_match('/^content-encoding:\s*(\S+)/mi', $head, $m) ? $m[1] : 'identity';
    return [$code, substr($raw, $hs), $enc];
};

// ---- 1. the owner's theme row, as every visitor's browser receives it ------
[$code, $body] = $get('/api/api.php?r=theme', false);
$t = json_decode($body, true);
if (!is_array($t)) {
    echo "THEME code=$code unreadable bytes=" . strlen($body) . "\n";
} else {
    $set = [];
    foreach ($t as $k => $v) {
        if ($k === 'css' || !is_string($v) || $v === '') continue;
        // Colours, font names and numbers only; anything else is truncated.
        $set[] = $k . '=' . substr(preg_replace('/[^#\w .,%()-]/', '?', $v), 0, 40);
    }
    echo 'THEME code=' . $code . ' fieldsSet=' . count($set) . '/' . (count($t) - 1)
        . ($set ? ' ' . implode(' ', $set) : ' (all empty: the shipped look)') . "\n";
    $css = is_string($t['css'] ?? null) ? $t['css'] : '';
    echo 'CUSTOMCSS bytes=' . strlen($css)
        . ($css === '' ? '' : ' rules=' . substr_count($css, '{') . ' important=' . substr_count($css, '!important')
            . ' head=' . substr(preg_replace('/\s+/', ' ', $css), 0, 300)) . "\n";
}

// ---- 2. owner-edited wording: only how much, never what ---------------------
[$code, $body] = $get('/api/api.php?r=site_text', false);
$s = json_decode($body, true);
echo 'SITETEXT code=' . $code . ' keys=' . (is_array($s) ? count($s, COUNT_RECURSIVE) : 'unreadable') . "\n";

// ---- 3. what each stylesheet costs on the wire ------------------------------
[$code, $html] = $get('/', false);
$bundle = preg_match('~/assets/(index-[\w-]+\.css)~', $html, $m) ? '/assets/' . $m[1] : null;
foreach (array_filter(['/assets/sporta-ui.css', '/assets/sporta-dark.css', $bundle]) as $p) {
    [$c, $b, $enc] = $get($p, true);
    $plain = $enc === 'gzip' ? @gzdecode($b) : $b;
    $plainLen = is_string($plain) ? strlen($plain) : -1;
    $noComments = is_string($plain) ? strlen(preg_replace('~/\*.*?\*/~s', '', $plain)) : -1;
    echo 'CSS ' . $p . ' code=' . $c . ' wire=' . strlen($b) . '/' . $enc
        . ' plain=' . $plainLen . ' withoutComments=' . $noComments . "\n";
}
