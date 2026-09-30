<?php
/**
 * Publish the legacy KNET trandata IV fix — 1 file.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-knet-iv-fix.php && php r.php
 *
 * knet_encrypt()/knet_decrypt() used a fixed IV, 'PGKEYENCDECIVSPC'. KNET's
 * own iPayPipe library (decompiled, owner-supplied, never committed) derives
 * the IV from the Terminal Resource Key itself instead — see knet.php's own
 * header for the full account. The live knet/config.php still carries three
 * YOUR_* placeholders (checked before writing this), so knet_mode() falls
 * back to the official CBK route regardless of this fix — nothing live was
 * ever exploitable — but this is correct for the day real Tranportal
 * credentials are filled in.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: one named path,
 * checked against the sha256 recorded here before it is written, pinned to
 * one commit, idempotent.
 */

$COMMIT = '799c7524e7f50f66af455a61e21af2bf60a1fc3e';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'knet/knet.php' => 'fc392b526dd55f6650711523bf37402c53de9c98052ab35385d979e2f678e5c5',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

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

    $dir = dirname($target);
    if (!is_dir($dir)) { $failed[] = $rel; continue; }

    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

echo 'KNET-IV-FIX wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
