<?php
/**
 * Where does a word on the live shop come from? 2026-10-02. READ-ONLY, PUBLIC DATA ONLY:
 * asks the shop's own public routes over the loopback and prints every line of JSON that
 * contains "جديد" (new), with the route it came from. No database, no configuration.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-find-text.php && php r.php
 */
header('Content-Type: text/plain; charset=utf-8');
$needle = 'جديد';
foreach (['site_text', 'home_banner', 'footer', 'contact', 'legal', 'social', 'slides'] as $r) {
    $ch = curl_init("https://www.sporta.com.kw/api/api.php?r=$r");
    curl_setopt_array($ch, [CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_TIMEOUT => 8]);
    $b = (string) curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    $j = json_decode($b, true);
    $hits = [];
    $walk = function ($v, $path) use (&$walk, &$hits, $needle) {
        if (is_array($v)) { foreach ($v as $k => $x) $walk($x, "$path.$k"); return; }
        if (is_string($v) && mb_strpos($v, $needle) !== false) $hits[] = "$path=" . mb_substr($v, 0, 80);
    };
    $walk($j, $r);
    echo "$r http=$code hits=" . count($hits) . "\n";
    foreach ($hits as $h) echo "  $h\n";
}
