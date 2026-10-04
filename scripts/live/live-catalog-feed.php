<?php
// READ-ONLY. The Meta/Instagram catalogue feed as the live shop serves it (rows, in-stock count, whether
// every row has an image), and the Instagram address the footer icon points at (?r=social, public).
header('Content-Type: text/plain; charset=utf-8');
function get(string $p): array { $ch = curl_init('https://www.sporta.com.kw' . $p);
  curl_setopt_array($ch, [CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_TIMEOUT => 15]);
  $b = (string) curl_exec($ch); $c = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $t = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE); curl_close($ch); return [$c, $t, $b]; }
foreach (['en' => '/api/catalog-feed.php', 'ar' => '/api/catalog-feed.php?lang=ar'] as $l => $u) {
  [$c, $t, $b] = get($u);
  $rows = array_map(fn ($x) => str_getcsv($x, ',', '"', ''), array_filter(preg_split('/\r?\n/', trim($b))));
  $head = array_shift($rows) ?: [];
  $ia = array_search('availability', $head); $ii = array_search('image_link', $head); $ip = array_search('price', $head);
  $in = count(array_filter($rows, fn ($r) => ($r[$ia] ?? '') === 'in stock'));
  $noimg = count(array_filter($rows, fn ($r) => ($r[$ii] ?? '') === ''));
  echo "FEED $l http=$c type=" . explode(';', $t)[0] . ' rows=' . count($rows) . " inStock=$in noImage=$noimg firstPrice=" . ($rows[0][$ip] ?? '-') . "\n";
}
[$c, , $b] = get('/api/api.php?r=social');
$s = json_decode($b, true);
$ig = is_array($s) ? ($s['instagram'] ?? ($s['social']['instagram'] ?? null)) : null;
echo "SOCIAL http=$c instagram=" . ($ig ?: 'NOT-SET') . ' keys=' . (is_array($s) ? implode(',', array_keys($s)) : 'not-json') . "\n";
