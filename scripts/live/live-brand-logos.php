<?php
// READ-ONLY. How many live products carry a brand, and how many of those brands have a logo — the
// two numbers that decide whether the grid's brand chip (assets/brand-badge.js) can show anything.
$ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => 'www.sporta.com.kw'],
    'http' => ['header' => "Host: www.sporta.com.kw\r\nAccept: application/json\r\n", 'timeout' => 8]]);
$body = @file_get_contents('https://127.0.0.1/api/api.php?r=products', false, $ctx);
$rows = json_decode((string) $body, true);
if (!is_array($rows)) { echo "BRAND fetch=FAIL bytes=" . strlen((string) $body) . "\n"; exit; }
$brands = []; $withBrand = 0; $withLogo = 0;
foreach ($rows as $r) {
    if (!empty($r['brand_slug'])) { $withBrand++; $brands[$r['brand_slug']] = !empty($r['brand_has_logo']); }
    if (!empty($r['brand_has_logo'])) $withLogo++;
}
$logos = array_keys(array_filter($brands));
echo 'BRAND products=' . count($rows) . " withBrand=$withBrand withLogo=$withLogo brands=" . count($brands)
   . ' brandsWithLogo=' . count($logos) . ' list=' . implode(',', array_map(fn ($k) => $k . ($brands[$k] ? '*' : ''), array_keys($brands))) . "\n";
