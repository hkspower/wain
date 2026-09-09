<?php
/**
 * What the LIVE assistant answers to the questions that used to break it.
 *
 *   php /home/<user>/live-assistant-check.php
 *
 * READ-ONLY. It asks the shop's own chat endpoint a handful of questions over
 * the loopback and prints the intent each one was given. It writes nothing,
 * which matters because it is fetched over plain HTTP from a public repository
 * by a cron job.
 *
 * WHY IT EXISTS. assistant_find_track() used to weld any run beginning "sp"
 * onto the words after it, so "do you have sports bras" became SPORTSBRAS,
 * matched the order-number pattern, and a shopper in a SPORTSWEAR shop was
 * answered "Send me your order number". The publisher checks one question
 * after it writes; this asks the whole set, any time, without writing.
 *
 * The loopback form with the Host header is used deliberately — it works
 * whether or not the domain resolves, which is the reason it is written this
 * way everywhere in this project.
 *
 * ONE LINE, because cron returns only the last one.
 */

/** @return string the intent the shop gave this message */
function chk_ask(string $msg): string {
    $ch = curl_init('https://127.0.0.1/api/api.php?r=assistant');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['message' => $msg, 'lang' => 'en'],
                                              JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($body)) return 'HTTP' . $code;
    $j = json_decode($body, true);
    return is_array($j) ? (string) ($j['intent'] ?? 'none') : 'unparsable';
}

// message => the intent it must NOT be. Every one of these was measured
// answering 'order_status' before 2026-09-09.
$MUST_NOT = [
    'do you have sports bras' => 'order_status',
    'do you sell sportswear'  => 'order_status',
    'can I speak to someone'  => 'order_status',
    'any special offers'      => 'order_status',
];

// message => the intent it MUST be. The six other routing faults fixed the
// same day, so a rollback of any one of them shows up here too.
$MUST_BE = [
    'my package never came'         => 'order_status',
    'what time do you close today'  => 'hours',
    'can I pay cash when it arrives' => 'payment',
    'is there a discount code'      => 'recommend',
    'i want to buy 20 shirts for my team' => 'contact',
];

$bad = [];
foreach ($MUST_NOT as $msg => $forbidden) {
    $got = chk_ask($msg);
    // A throttled or dead endpoint is not a pass. Anything that is not a real
    // intent is reported rather than quietly counted as success.
    if ($got === $forbidden || $got === 'none' || $got === 'unparsable'
        || strpos($got, 'HTTP') === 0) {
        $bad[] = substr($msg, 0, 18) . '=' . $got;
    }
    usleep(400000);   // the endpoint is rationed per IP; do not trip it
}
foreach ($MUST_BE as $msg => $want) {
    $got = chk_ask($msg);
    if ($got !== $want) $bad[] = substr($msg, 0, 18) . '=' . $got . '(want ' . $want . ')';
    usleep(400000);
}

$total = count($MUST_NOT) + count($MUST_BE);
echo 'ASSISTANT checked=' . $total
   . ' wrong=' . (count($bad) ? count($bad) . ':' . implode(',', $bad) : '0') . "\n";
