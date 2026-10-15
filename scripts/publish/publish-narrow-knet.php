<?php
/**
 * Publish ONLY the two KNET files that store the response (K-064 §3.5.2) — nothing else.
 *
 *   wget -nv -O c.php <raw URL of this file at a full commit SHA> && php c.php
 *
 * Files: knet/knet.php (defines knet_store_response) and knet/callback.php (calls it). They go together.
 * They do NOT touch knet/config.php, which is git-ignored and is the owner's to restore.
 * Each body is checked against its sha256 BEFORE it is written, written beside its target, renamed into place,
 * then verified from the absolute path after the copy. A mismatch or failed write stops the run.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$COMMIT = '97df2b1';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/sporta-site/public_html/';

$FILES = [
    'knet/knet.php'     => 'c7beb435ba758ee0d18db571c41f4c40780e2a46f4cae2c1e25cf480168ff95e',
    'knet/callback.php' => 'e8888a71c1a93661413538d2744bd3529278fcf801ccbf687d6d1049ac4d7ef0',
];

line("NARROW KNET commit={$COMMIT} files=" . count($FILES));
$wrote = 0; $same = 0;
foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; line('same ' . $rel); continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { line("STOP fetch {$rel} code={$code}"); exit; }
    if (hash('sha256', $body) !== $want) { line("STOP hash-mismatch {$rel} — nothing written for it"); exit; }

    $dir = dirname($target);
    if (!is_dir($dir)) { line("STOP no-dir {$rel}"); exit; }
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) {
        @chmod($target, 0644); $wrote++; line("wrote {$rel}");
    } else {
        line("STOP write-verify {$rel}"); exit;
    }
}
line("DONE wrote={$wrote} same={$same} of " . count($FILES));
