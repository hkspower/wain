<?php
/**
 * READ-ONLY. Sends one harmless request to the live KNET callback (no real order, no result that could be
 * taken as a payment) and reports how it answers: status, reply style and whether it refuses over HTTPS.
 * Fetch from a full commit SHA and run once: wget -nv -O r.php <raw URL> && php r.php
 */
$url = 'https://127.0.0.1/knet/callback.php?trackid=LIVECHECKNOSUCH1&result=CAPTURED&amt=1.000';
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw', 'X-Forwarded-Proto: https'],
]);
$resp = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);
echo "callbackStatus=" . $code . "\n";
if ($resp === false) { echo "transport=" . $err . "\n"; exit; }
[$head, $body] = array_pad(explode("\r\n\r\n", $resp, 2), 2, '');
foreach (explode("\r\n", $head) as $h) {
    if (preg_match('/^(Location|Content-Type|Cache-Control):/i', $h)) echo $h . "\n";
}
echo "bodyStart=" . substr(preg_replace('/\s+/', ' ', $body), 0, 120) . "\n";
echo "done\n";
