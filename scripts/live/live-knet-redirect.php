<?php
/**
 * READ-ONLY. Follows the KNET checkout redirect chain on the live server, hop by hop, over the loopback
 * (https://127.0.0.1 with Host: www.sporta.com.kw), with a track id that matches NO order — so no order is
 * touched, nothing is charged and no bank is asked to take money. Prints status + Location of each hop.
 *
 *   1. /config.js            what payBaseUrl the checkout uses (empty = https://www.sporta.com.kw/knet)
 *   2. /knet/pay.php         the checkout's KNET link: official mode answers 303 to /pay/pay.php ...&paytype=1
 *   3. /pay/pay.php          the CBK door: a track id with no order must be refused BEFORE any bank call
 *
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
$track = 'VERIFYNOSUCHORDER' . substr(gmdate('His'), 0, 6);
function hop(string $path): array {
    $ctx = stream_context_create([
        'http' => ['method' => 'GET', 'header' => "Host: www.sporta.com.kw\r\nX-Forwarded-Proto: https\r\n", 'follow_location' => 0, 'ignore_errors' => true, 'timeout' => 8],
        'ssl'  => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => 'www.sporta.com.kw'],
    ]);
    $body = @file_get_contents('https://127.0.0.1' . $path, false, $ctx);
    $h = $http_response_header ?? [];
    $code = 0; $loc = '-';
    foreach ($h as $l) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $l, $m)) $code = (int) $m[1];
        if (stripos($l, 'Location:') === 0) $loc = trim(substr($l, 9));
    }
    return [$code, $loc, (string) $body];
}
[$c, , $js] = hop('/config.js');
$base = preg_match("/payBaseUrl\s*:\s*'([^']*)'/", $js, $m) ? ($m[1] === '' ? '(empty → /knet)' : $m[1]) : '?';
echo "1 config.js=$c payBaseUrl=$base\n";

[$c, $loc, $b] = hop('/knet/pay.php?trackid=' . $track . '&lang=en');
echo "2 knet/pay.php=$c location=$loc body=" . substr(trim(preg_replace('/\s+/', ' ', strip_tags($b))), 0, 80) . "\n";

$next = $loc !== '-' ? $loc : '/pay/pay.php?trackid=' . $track . '&lang=en&paytype=1';
if (str_starts_with($next, 'https://www.sporta.com.kw')) $next = substr($next, strlen('https://www.sporta.com.kw'));
[$c, $loc, $b] = hop($next);
echo "3 " . strtok($next, '?') . "=$c location=$loc body=" . substr(trim(preg_replace('/\s+/', ' ', strip_tags($b))), 0, 100) . "\n";
