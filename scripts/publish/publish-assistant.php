<?php
/**
 * Publish the assistant that no longer reads "sports bras" as an order number.
 *
 *   php /home/<user>/publish-assistant.php
 *
 * WHY. assistant_find_track() welded any run beginning "sp" onto the words
 * after it, so SPORTS BRAS became SPORTSBRAS, matched the track-id pattern,
 * and the shopper was answered "Send me your order number". Measured on the
 * sandbox before the fix, every one of these was read as an order lookup:
 * sports bras, sports bra, sportswear, special offers, spring collection, and
 * "can I speak to someone" — which meant the one message that must reach a
 * human never did. Six other routing faults ship with it; see the commit.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * AND IT VERIFIES ITSELF AFTERWARDS, because this file is on the checkout's
 * own include path and a broken one is a shop that cannot answer anybody. The
 * previous copy is kept beside it, the live assistant is asked one ordinary
 * question over the loopback, and anything but a sane answer rolls it back.
 *
 * Re-running it is a no-op.
 */

$COMMIT = '88e1181fa609af79ec302f282ac4e0ee425efb65';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    "api/assistant.php" => "f76fbd923ca4ac6935109d6cb0e1490f1aa96c882b4fdd3a19b056bd0a707acc",
];

/** Ask the live assistant the question this whole change is about. */
function pub_ask(string $msg): array {
    $ch = curl_init('https://127.0.0.1/api/api.php?r=assistant');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['message' => $msg, 'lang' => 'en']),
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($body)) return ['intent' => 'HTTP' . $code];
    $j = json_decode($body, true);
    return is_array($j) ? $j : ['intent' => 'unparsable'];
}

$wrote = 0; $same = 0; $bad = []; $failed = []; $backups = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    if (is_file($target)) {
        $bk = $target . '.bak-' . date('Ymd-His');
        if (!@copy($target, $bk)) { $failed[] = $rel; continue; }
        $backups[$target] = $bk;
    }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

// THE CHECK. "do you have sports bras" must NOT come back as an order lookup,
// and the assistant must still answer at all.
$verdict = 'notchecked';
if ($wrote > 0) {
    $a = pub_ask('do you have sports bras');
    $intent = (string) ($a['intent'] ?? '?');
    $alive  = $intent !== '?' && strpos($intent, 'HTTP') !== 0 && $intent !== 'unparsable';
    if ($alive && $intent !== 'order_status') {
        $verdict = 'ok:' . $intent;
    } else {
        foreach ($backups as $target => $bk) @copy($bk, $target);
        $verdict = 'ROLLEDBACK:' . $intent;
    }
}

echo 'ASSISTANT wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' sportsBras=' . $verdict . "\n";
