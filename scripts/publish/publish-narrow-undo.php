<?php
/**
 * Publish ONLY the four files behind the backend-scan fixes that went in on
 * 2026-10-14 — and nothing else. A narrow alternative to publish-all.php, which
 * replaces every file that differs from the repository (~330 on the last check).
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha-of-THIS-file>/scripts/publish/publish-narrow-undo.php && php c.php
 *
 * Files, in this order (sw.js LAST, so a returning visitor's new worker only
 * appears once the code it caches is in place):
 *   api/store.php              N01: plain promo dates save as the start of the day
 *   api/admin.php              SEC-01: the Payments save returns booleans, not secrets;
 *                              PNL-02: an Undo whose count has moved is refused as stale
 *   assets/inventory-tools.js  PNL-02: Undo sends `expect`
 *   sw.js                      VERSION bump (v258-inventory-undo)
 *
 * Each body is checked against its sha256 BEFORE it is written, written to a
 * temp file in the same directory, renamed into place, then verified again from
 * the ABSOLUTE path. A mismatch or a failed write stops the run and names the
 * file; the files already written are left as they are (each is complete and
 * verified on its own).
 *
 * $COMMIT pins the CONTENT. The hashes below are of the files AT that commit.
 */

$COMMIT = '59d0ee0691d163604fdc5577a03e9a97171c343b';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/sporta-site/public_html/';

$FILES = [
    'api/store.php'             => '463e7ff59e0ec7a5940ad998ec21319eaf9a1f0c7fdf1ce2157c92a20741e396',
    'api/admin.php'             => '7ad289758abdf0ace156a6145d8854d194e3ced6993bed2b23c67dd7338cc79c',
    'assets/inventory-tools.js' => 'b2af510adf5daa27e653d59b79176de3ee1b9027b37db81ec873ccf3fc6c53da',
    'sw.js'                     => '9b4e286dfedf2589c429c1e936090af965cd777bc758841435fbf7cb809c9010',
];

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

line("NARROW commit={$COMMIT} files=" . count($FILES));

$wrote = 0; $same = 0;
foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; line('same ' . $rel); continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { line("STOP fetch {$rel} code={$code}"); exit(1); }
    if (hash('sha256', $body) !== $want) { line("STOP hash-mismatch {$rel} — nothing written for it"); exit(1); }

    $dir = dirname($target);
    if (!is_dir($dir)) { line("STOP no-dir {$rel}"); exit(1); }
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) {
        @chmod($target, 0644); $wrote++; line("wrote {$rel}");
    } else {
        line("STOP write-verify {$rel}"); exit(1);
    }
}

line("DONE wrote={$wrote} same={$same} of " . count($FILES));
