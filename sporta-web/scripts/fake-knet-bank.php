<?php
// A fake KNET (KPG) gateway, for scripts/knet-test.mjs.
//
// It speaks the REAL protocol as KNET's own iPayPipe 1.0 plug-in writes and
// reads it (decompiled read-only; sporta-web/KNET-IPAYPIPE-CHECK.md), so the
// integration is exercised rather than mocked:
//
//   * AES-128-CBC trandata with the 16-byte resource key as BOTH the key and
//     the IV (AESAlgorithm.java:22, :44), PKCS7 padding, hex — done HERE with
//     openssl directly, not with knet.php's helpers, so a mistake in those is
//     not mirrored by the thing that is meant to catch it;
//   * the request plaintext read RAW, the way the plug-in's parsetrandata reads
//     it (iPayPipe.java:776-779): split on '&', split each pair on '=', keep a
//     pair only when that gives exactly two parts, decode NOTHING. A merchant
//     that URL-encodes its values (Sporta did, until D1) has its responseURL
//     arrive here as "http%3A%2F%2F..." — which this bank then tries, and fails,
//     to call, exactly as a raw reader would; and its password "p@ss!" as
//     "p%40ss%21", which is refused as a wrong credential;
//   * the reply trandata built RAW too ("result=NOT CAPTURED"), never with the
//     merchant's own builder (that would make the two agree by construction);
//   * the same field names and CAPTURED / NOT CAPTURED / CANCELED results.
//
// It exists because the real bank cannot be reached from a test: kpaytest.com.kw
// needs live Tranportal credentials and a network this sandbox does not have,
// and "we think the encryption is right" is not something to find out in
// production with a customer's money.
//
// It deliberately behaves like the awkward parts of the real thing:
//   * it VALIDATES the tranportal id and password out of the trandata, so a
//     wrong credential fails here rather than silently passing;
//   * it can answer server-to-server (reading REDIRECT= out of the merchant's
//     reply) as well as by browser redirect, because KPG does both and the
//     merchant has to survive either;
//   * it echoes `amt` back, which is what the callback's amount check reads;
//   * ?deliver=none takes the payment and never calls the merchant back — the
//     shopper who closed the tab — and /tranPipe.htm answers the plug-in-style
//     XML inquiry about it afterwards (KNET-IPAYPIPE-CHECK.md D2).
//
//   php -S 127.0.0.1:8097 -t scripts   (see knet-test.mjs)
//   FAKE_KNET_CONFIG=<path>  the merchant config to read (default: dropin/php-knet/config.php)
//   FAKE_KNET_STATE=<path>   where captured payments and inquiries are kept

declare(strict_types=1);

$cfg = require (getenv('FAKE_KNET_CONFIG') ?: __DIR__ . '/../dropin/php-knet/config.php');
$stateFile = getenv('FAKE_KNET_STATE') ?: sys_get_temp_dir() . '/fake-knet-bank-state.json';

// ------------------------------------------------------------- the bank's own crypto
function bank_aes_encrypt(string $plain, string $key): string
{
    $raw = openssl_encrypt($plain, 'AES-128-CBC', $key, OPENSSL_RAW_DATA, $key);
    return strtoupper(bin2hex((string) $raw));
}
function bank_aes_decrypt(string $hex, string $key): ?string
{
    if (strlen($key) !== 16 || $hex === '' || strlen($hex) % 2 !== 0 || !ctype_xdigit($hex)) return null;
    $out = openssl_decrypt((string) hex2bin($hex), 'AES-128-CBC', $key, OPENSSL_RAW_DATA, $key);
    return $out === false ? null : $out;
}

// parsetrandata, as the plug-in has it: Scanner(trandata).useDelimiter("&"),
// then s.next().split("=") and "if (sObj.length != 2) continue". Java's split
// drops trailing empty strings, so "udf1=" is ONE part and is skipped, and a
// value holding '=' is three parts and is skipped. No decoding anywhere.
/** @return array{0: array<string,string>, 1: int} the pairs, and how many were empty */
function bank_parse_raw(string $plain): array
{
    $out = [];
    $empty = 0;
    foreach (explode('&', $plain) as $pair) {
        if ($pair === '') continue;
        $parts = explode('=', $pair);
        while ($parts !== [] && end($parts) === '') array_pop($parts);
        if (count($parts) === 1 && str_ends_with($pair, '=')) $empty++;
        if (count($parts) !== 2) continue;
        $out[$parts[0]] = $parts[1];
    }
    return [$out, $empty];
}

// The reply, raw: key=value joined by '&'. No encoding.
function bank_build_raw(array $fields): string
{
    $pairs = [];
    foreach ($fields as $k => $v) $pairs[] = $k . '=' . $v;
    return implode('&', $pairs);
}

// Captured payments and the inquiries asked about them, shared by the requests
// of one test run.
function bank_state(string $file, ?callable $change = null): array
{
    $h = fopen($file, 'c+');
    flock($h, LOCK_EX);
    $raw = stream_get_contents($h);
    $state = json_decode($raw !== false && $raw !== '' ? $raw : '{}', true) ?: [];
    $state += ['payments' => [], 'inquiries' => [], 'down' => false, 'slow' => 0];
    if ($change !== null) {
        $state = $change($state);
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, json_encode($state, JSON_UNESCAPED_SLASHES));
        fflush($h);
    }
    flock($h, LOCK_UN);
    fclose($h);
    return $state;
}

// ------------------------------------------------------------------ the inquiry
// iPayTransactionPipe.performTranPortalTransaction: an application/xml POST of a
// plain <request> to <webaddress>/tranPipe.htm?param=tranInit, answered with flat
// <tag>value</tag> pairs (iPayPipe.parseResponse reads them one after another).
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if (str_ends_with($path, '/tranPipe.htm')) {
    header('Content-Type: text/xml; charset=utf-8');
    $state = bank_state($stateFile);
    if (!empty($state['down'])) {
        http_response_code(503);
        exit('Service Unavailable');
    }
    if ((int) $state['slow'] > 0) sleep((int) $state['slow']);
    $xml = (string) file_get_contents('php://input');
    $tags = [];
    $inner = preg_match('#^<request>(.*)</request>$#s', trim($xml), $w) ? $w[1] : '';
    preg_match_all('#<([A-Za-z][A-Za-z0-9]*)>(.*?)</\1>#s', $inner, $m, PREG_SET_ORDER);
    foreach ($m as $t) $tags[$t[1]] = $t[2];
    $ctype = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    $credOk = ($tags['id'] ?? '') === (string) $cfg['tranportal_id'] && ($tags['password'] ?? '') === (string) $cfg['tranportal_password'];
    $record = [
        'method' => $_SERVER['REQUEST_METHOD'] ?? '', 'param' => (string) ($_GET['param'] ?? ''),
        'content_type' => $ctype, 'credentials_ok' => $credOk,
        'tags' => array_keys($tags), 'action' => $tags['action'] ?? '', 'trackid' => $tags['trackid'] ?? '',
        'transid' => $tags['transid'] ?? '', 'udf5' => $tags['udf5'] ?? '', 'amt' => $tags['amt'] ?? '',
        'currencycode' => $tags['currencycode'] ?? '', 'xml_starts' => substr($xml, 0, 9),
    ];
    bank_state($stateFile, static function (array $s) use ($record) { $s['inquiries'][] = $record; return $s; });
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_GET['param'] ?? '') !== 'tranInit' || !str_starts_with($ctype, 'application/xml')) {
        exit('<result>!ERROR!-IPAY0100000-Invalid request</result>');
    }
    if (!$credOk) exit('<error_code_tag>IPAY0100014</error_code_tag><result>!ERROR!-IPAY0100014-Invalid Tranportal ID</result>');
    // The bank's inquiry code is whatever this terminal was told; the fake bank
    // accepts only the one in the merchant config, so a wrong code fails here.
    if (($tags['action'] ?? '') !== (string) ($cfg['inquiry_action'] ?? '')) {
        exit('<error_code_tag>IPAY0100005</error_code_tag><result>!ERROR!-IPAY0100005-Invalid action type</result>');
    }
    $p = $state['payments'][$tags['trackid'] ?? ''] ?? null;
    if ($p === null) exit('<result>NOT FOUND</result><trackid>' . ($tags['trackid'] ?? '') . '</trackid>');
    exit('<result>' . $p['result'] . '</result><auth>' . $p['auth'] . '</auth><ref>' . $p['ref'] . '</ref>'
        . '<avr>N</avr><postdate>' . $p['postdate'] . '</postdate><tranid>' . $p['tranid'] . '</tranid>'
        . '<trackid>' . ($p['trackid_echo'] ?? $tags['trackid']) . '</trackid><payid>' . $p['paymentid'] . '</payid>'
        . '<udf5>' . $p['udf5'] . '</udf5><amt>' . $p['amt'] . '</amt><authRespCode>' . $p['authRespCode'] . '</authRespCode>');
}

// ------------------------------------------------------------- the hosted page
$in  = $_POST + $_GET;
header('Content-Type: application/json; charset=utf-8');

$trandata = (string) ($in['trandata'] ?? '');
if ($trandata === '') {
    http_response_code(400);
    exit(json_encode(['bank_error' => 'no trandata']));
}

// Decrypt exactly as the bank would. A wrong resource key dies here.
$plain = bank_aes_decrypt($trandata, (string) $cfg['resource_key']);
if ($plain === null) {
    http_response_code(400);
    exit(json_encode(['bank_error' => 'decrypt failed']));
}
[$fields, $emptyPairs] = bank_parse_raw($plain);

// The bank authenticates the merchant on every request — on the RAW values.
if (($fields['id'] ?? '') !== (string) $cfg['tranportal_id']
    || ($fields['password'] ?? '') !== (string) $cfg['tranportal_password']) {
    http_response_code(401);
    exit(json_encode(['bank_error' => 'bad tranportal credentials', 'got_id' => $fields['id'] ?? '']));
}

// The test drives the outcome: ?outcome=captured|notcaptured|canceled, and
// ?amt= to overpay/underpay so the callback's amount check can be proven.
$outcome = strtolower((string) ($in['outcome'] ?? 'captured'));
$result  = ['captured' => 'CAPTURED', 'notcaptured' => 'NOT CAPTURED', 'canceled' => 'CANCELED'][$outcome]
    ?? 'CAPTURED';
$amt = (string) ($in['amt'] ?? ($fields['amt'] ?? ''));

$payment = [
    'paymentid' => '100202' . random_int(100000, 999999),
    'result'    => $result,
    'auth'      => $result === 'CAPTURED' ? 'B35434' : '',
    'ref'       => '90890' . random_int(10000, 99999),
    'tranid'    => (string) random_int(1000000000, 9999999999),
    'postdate'  => gmdate('md'),
    'trackid'   => (string) ($fields['trackid'] ?? ''),
    'udf1'      => (string) ($fields['udf1'] ?? ''),
    'udf2'      => (string) ($fields['udf2'] ?? ''),
    'udf3'      => (string) ($fields['udf3'] ?? ''),
    'udf4'      => (string) ($fields['udf4'] ?? ''),
    'udf5'      => (string) ($fields['udf5'] ?? ''),
    'amt'       => $amt,
    'authRespCode' => $result === 'CAPTURED' ? '00' : '05',
];
// Every payment is remembered, delivered or not, so an inquiry can be answered.
bank_state($stateFile, static function (array $s) use ($payment) {
    $s['payments'][$payment['trackid']] = $payment;
    return $s;
});

$deliver = strtolower((string) ($in['deliver'] ?? 'post'));
if ($deliver === 'none') {
    // The shopper closed the tab: money taken, the merchant never told.
    exit(json_encode(['bank_result' => $result, 'delivered' => false, 'trackid' => $payment['trackid'],
        'paymentid' => $payment['paymentid'], 'empty_pairs' => $emptyPairs], JSON_UNESCAPED_SLASHES));
}

$encrypted = bank_aes_encrypt(bank_build_raw($payment), (string) $cfg['resource_key']);

// Deliver the result to the merchant the way the bank does: POST trandata to
// responseURL, then read REDIRECT= out of the reply and report where the
// customer would be sent. The test asserts on that landing URL, which is
// exactly what a stranded customer would fail to reach. responseURL is the RAW
// value out of the request: an encoded one is not a URL and the call fails.
$target = (string) ($fields['responseURL'] ?? '');
$ch = curl_init();
$urlOk = $target !== '' && curl_setopt($ch, CURLOPT_URL, $target);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['trandata' => $encrypted, 'paymentid' => '1']),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    // The real gateway does not follow redirects: it wants the REDIRECT= token
    // in the body. Not following is the whole point of this test.
    CURLOPT_FOLLOWLOCATION => false,
    // The merchant refuses plain HTTP; the proxy header is how Hostinger tells
    // it the edge terminated TLS, and it is how this rig does too.
    CURLOPT_HTTPHEADER     => ['X-Forwarded-Proto: https'],
]);
$body = $urlOk ? (string) curl_exec($ch) : '';
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$loc  = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
curl_close($ch);

$landing = '';
if (preg_match('/REDIRECT=(\S+)/', $body, $m)) {
    $landing = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
} elseif ($loc !== '') {
    $landing = $loc;   // a 302-style merchant; the browser would follow it
}

echo json_encode([
    'bank_result'   => $result,
    'merchant_code' => $code,
    'landing'       => $landing,
    'used_token'    => $landing !== '' && str_contains($body, 'REDIRECT='),
    // K-064 §5 / §10.2.1: the notification reply is ONE line, REDIRECT=<url>,
    // with no HTML and no HTTP redirect — anything else may make KNET void the
    // payment. A loose /REDIRECT=/ match hid a reply that also carried a page.
    'strict_reply'  => $code === 200 && $loc === '' && preg_match('/\\AREDIRECT=\\S+\\s*\\z/', $body) === 1,
    // What the raw reader made of the request: the response URL it called, and
    // how many "key=" pairs with no value arrived (the plug-in sends none).
    'response_url'  => $target,
    'empty_pairs'   => $emptyPairs,
], JSON_UNESCAPED_SLASHES);
