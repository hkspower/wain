<?php
/**
 * READ-ONLY. The facts the footer pages state, as the LIVE shop holds them (2026-10-15, "check all information
 * at footer pages"). Asks the shop's own PUBLIC routes over the loopback, so it prints only what any visitor
 * can already fetch: rules, promo bar, contact, social, footer texts and links, legal-page overrides, brands,
 * and how many site_text overrides exist. Then reads /about /terms /privacy /returns and greps for the
 * numbers and claims those pages make.
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
function get(string $path): string {
    $ctx = stream_context_create([
        'http' => ['method' => 'GET', 'header' => "Host: www.sporta.com.kw\r\nAccept-Language: en\r\n", 'ignore_errors' => true, 'timeout' => 6],
        'ssl'  => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => 'www.sporta.com.kw'],
    ]);
    return (string) @file_get_contents('https://127.0.0.1' . $path, false, $ctx);
}
$j = fn($r) => json_decode(get('/api/api.php?r=' . $r), true);
$s = $j('slides') ?? [];
echo 'RULES ', json_encode(array_intersect_key($s['rules'] ?? [], array_flip(['delivery_fee_fils', 'free_delivery_fils', 'return_days', 'payment_methods', 'governorates']))), "\n";
echo 'PROMO ', json_encode($s['promo_bar'] ?? null, JSON_UNESCAPED_UNICODE), "\n";
flush();
foreach (['contact', 'social', 'footer', 'footer_links'] as $r) { echo strtoupper($r), ' ', substr(json_encode($j($r), JSON_UNESCAPED_UNICODE), 0, 700), "\n"; flush(); }
$legal = $j('legal');
echo 'LEGAL ', is_array($legal) ? implode(',', array_map(fn($k, $v) => $k . '=' . (is_string($v) ? strlen($v) : json_encode($v)), array_keys($legal), $legal)) : 'none', "\n";
$st = $j('site_text');
echo 'SITETEXT keys=', is_array($st) ? count($st, COUNT_RECURSIVE) : 0, "\n";
$b = $j('brands');
$names = array_map(fn($x) => $x['name_en'] ?? $x['slug'] ?? '?', $b['brands'] ?? (is_array($b) ? $b : []));
echo 'BRANDS ', implode(',', $names), "\n";
flush();
foreach (['/about', '/terms', '/privacy', '/returns'] as $p) {
    $h = get($p . '?lang=en');
    preg_match('#<title>(.*?)</title>#s', $h, $t);
    echo 'PAGE ', $p, ' bytes=', strlen($h), ' title=', trim($t[1] ?? '?'), "\n";
}
echo "done\n";
