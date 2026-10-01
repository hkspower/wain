<?php
/**
 * WHY DO TEN AT ONCE FAIL? Run on the server, read-only. live-load-test.php found that with 10
 * requests in flight the PHP endpoints (the product list, the category page) answered HTTP 500
 * for most of them while static pages stayed fine. This sends a burst of GETs at the product
 * list and prints WHAT the failures said — the status, the first bytes of the body, and the last
 * lines of the PHP error log — so the cause (database connections, memory, a lock) is read rather
 * than guessed. It writes nothing and prints no credential: bodies and log lines are cut to 220
 * characters, and any run of digits/letters that looks like a password in a DSN is not printed
 * because PDO messages never include it.
 */
$HOST = 'www.sporta.com.kw';
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$N = 12;
$mh = curl_multi_init(); $hs = [];
for ($i = 0; $i < $N; $i++) {
    $ch = curl_init('https://127.0.0.1/api/api.php?r=products&_b=' . $i);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER => ['Host: ' . $HOST, 'User-Agent: sporta-burst'], CURLOPT_TIMEOUT => 15]);
    curl_multi_add_handle($mh, $ch); $hs[] = $ch;
}
do { curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 0.2); } while ($run);
$codes = []; $firstBad = null;
foreach ($hs as $ch) {
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $body = (string) curl_multi_getcontent($ch);
    $codes[$code] = ($codes[$code] ?? 0) + 1;
    if ($code >= 500 && $firstBad === null) $firstBad = substr(preg_replace('/\s+/', ' ', $body), 0, 220);
}
ksort($codes);
echo 'BURST n=' . $N . ' codes=' . http_build_query($codes, '', ',') . "\n";
echo 'BODY ' . ($firstBad ?? '(no 5xx this time)') . "\n";
foreach ([$ROOT . '/error_log', $ROOT . '/api/error_log', dirname($ROOT) . '/error_log', '/home/u130124229/logs/error_log'] as $f) {
    if (!is_readable($f)) continue;
    $lines = @file($f, FILE_IGNORE_NEW_LINES) ?: [];
    echo 'LOG ' . basename(dirname($f)) . '/' . basename($f) . ' lines=' . count($lines) . ' size=' . filesize($f) . "\n";
    foreach (array_slice($lines, -4) as $l) echo '  ' . substr(preg_replace('/\s+/', ' ', $l), 0, 220) . "\n";
}
echo "DONE\n";
