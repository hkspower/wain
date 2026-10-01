<?php
/**
 * The hero's first frame, on the LIVE server — 2026-10-01.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-hero-first-frame-check.php && php r.php
 *
 * READ-ONLY, public pages only, over the loopback (pinned with CURLOPT_RESOLVE).
 *
 * Three things the fix depends on that only the live server can answer:
 *   1. the home page's <html> carries the shop's Size (seo.php writes it), and
 *      /shop's does not;
 *   2. the boot script the page SENDS is allowed by the policy the server SENDS
 *      — it was edited, so its sha256 moved, and a stale hash means the browser
 *      silently refuses the script that sets the hero's height;
 *   3. a phone (an iPhone User-Agent) is handed the phone picture only in Full.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function get(string $path, string $ua = 'sporta-hero-first-frame'): array {
    $ch = curl_init('https://www.sporta.com.kw' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE        => ['www.sporta.com.kw:443:127.0.0.1'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,   // the loopback: content is the question, not TLS
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_USERAGENT      => $ua,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $hsize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $raw = is_string($raw) ? $raw : '';
    return [$code, substr($raw, 0, $hsize), substr($raw, $hsize)];
}

$bad = 0;

// 1. the attribute
[$c, $h, $home] = get('/');
[$c2, , $homeEn] = get('/?lang=en');
[$c3, , $shop] = get('/shop');
$tag = fn (string $html) => preg_match('#<html\b[^>]*>#i', $html, $m) ? $m[0] : 'NONE';
$size = preg_match('#<html\b[^>]*\bdata-hero-size="([a-z]+)"#i', $home, $m) ? $m[1] : '';
$sizeEn = preg_match('#<html\b[^>]*\bdata-hero-size="([a-z]+)"#i', $homeEn, $m) ? $m[1] : '';
$shopHas = (bool) preg_match('#<html\b[^>]*\bdata-hero-size=#i', $shop);
if ($size === '' || $size !== $sizeEn || $shopHas) $bad++;
line("HTML home=$c " . $tag($home) . "  en=" . ($sizeEn ?: 'NONE') . "  shop=$c3 " . ($shopHas ? 'HAS-IT' : 'none'));

// 2. every inline script the page sends, against the policy the server sends
$csp = preg_match('#^content-security-policy:\s*(.+)$#mi', $h, $m) ? trim($m[1]) : '';
preg_match_all("#'sha256-([A-Za-z0-9+/=]+)'#", $csp, $hm);
$allowed = array_flip($hm[1] ?? []);
$inline = 0; $ok = 0; $blocked = [];
if (preg_match_all('#<script(?![^>]*\bsrc=)(?![^>]*type="application/ld\+json")[^>]*>(.*?)</script>#s', $home, $sm)) {
    foreach ($sm[1] as $body) {
        $inline++;
        $hash = base64_encode(hash('sha256', $body, true));
        if (isset($allowed[$hash])) $ok++; else $blocked[] = substr($hash, 0, 10) . ':' . substr(trim(preg_replace('/\s+/', ' ', $body)), 0, 30);
    }
}
if ($csp === '' || $inline === 0 || $blocked) $bad++;
line("CSP hashes=" . count($allowed) . " inline=$inline allowed=$ok " . ($blocked ? 'BLOCKED=' . implode(' | ', $blocked) : 'blocked=0'));

// 3. the phone picture
$iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
[$c4, , $body] = get('/api/api.php?r=slides', $iphone);
$j = json_decode($body, true);
$heroSize = is_array($j) ? ($j['hero']['size'] ?? '-') : '-';
$phonePics = 0; $withPhone = 0; $total = 0;
foreach (($j['slides'] ?? []) as $s) {
    $total++;
    if (!empty($s['has_mobile_image'])) $withPhone++;
    if (str_contains((string) ($s['image'] ?? ''), 'mobile=1')) $phonePics++;
}
$expect = $heroSize === 'full' ? $withPhone : 0;
if (!is_array($j) || $phonePics !== $expect || $heroSize !== $size) $bad++;
line("SLIDES http=$c4 size=$heroSize slides=$total withPhonePicture=$withPhone iphoneGetsPhonePicture=$phonePics (expected $expect)");

line($bad ? "FIRST-FRAME $bad problem(s)" : 'FIRST-FRAME ok — the Size is on the page, its script is allowed, phones get their pictures in Full');
