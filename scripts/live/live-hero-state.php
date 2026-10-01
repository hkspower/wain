<?php
/**
 * The hero as the LIVE shop configures it — the Slides screen's size, the
 * timing, and each active slide's picture shape. 2026-10-01.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-hero-state.php && php r.php
 *
 * READ-ONLY, and PUBLIC DATA ONLY: it asks ?r=slides over the loopback (the
 * origin, pinned with CURLOPT_RESOLVE), the same answer every visitor's
 * browser gets. No database, no configuration.
 *
 * Why the shapes: the hero box is a fixed height (the Size setting) and every
 * picture is drawn into it with object-fit: cover, so a picture WIDER than the
 * box shows only a horizontal band of itself. The ratio printed per slide is
 * what decides how much of it a visitor sees.
 */

header('Content-Type: text/plain; charset=utf-8');

$ch = curl_init('https://www.sporta.com.kw/api/api.php?r=slides');
curl_setopt_array($ch, [
    CURLOPT_RESOLVE        => ['www.sporta.com.kw:443:127.0.0.1'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,   // the loopback: content is the question, not TLS
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_USERAGENT      => 'sporta-hero-state',
]);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

$j = json_decode(is_string($body) ? $body : '', true);
if (!is_array($j)) { echo "HTTP $code — not JSON\n"; return; }

$h = is_array($j['hero'] ?? null) ? $j['hero'] : [];
echo 'HERO size=' . ($h['size'] ?? '-')
    . ' autoplay=' . json_encode($h['autoplay'] ?? null)
    . ' speed_ms=' . json_encode($h['speed_ms'] ?? null)
    . ' shuffle=' . json_encode($h['shuffle'] ?? null) . "\n";

$ratio = fn ($w, $h) => ($w > 0 && $h > 0) ? number_format($w / $h, 2) : '-';
foreach (($j['slides'] ?? []) as $s) {
    $w = (int) ($s['width'] ?? 0);  $hh = (int) ($s['height'] ?? 0);
    $mw = (int) ($s['mobile_width'] ?? 0);  $mh = (int) ($s['mobile_height'] ?? 0);
    echo 'SLIDE id=' . ($s['id'] ?? '?') . ' sort=' . ($s['sort'] ?? '?')
        . " desktop={$w}x{$hh} ratio=" . $ratio($w, $hh)
        . ' mobile=' . (!empty($s['has_mobile_image']) ? "{$mw}x{$mh} ratio=" . $ratio($mw, $mh) : 'none')
        . ' focal=' . ($s['focal_x'] ?? '-') . ',' . ($s['focal_y'] ?? '-')
        . ' text=' . ((($s['title_en'] ?? '') . ($s['title_ar'] ?? '')) !== '' ? 'yes' : 'no') . "\n";
}
echo 'SUMMARY slides=' . count($j['slides'] ?? []) . " http=$code\n";
