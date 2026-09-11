<?php
/**
 * Publish the three fixes to api/deploy.php.
 *
 * ONE FILE, AND IT IS THE MOST SENSITIVE ONE ON THE SHOP: a signed endpoint that
 * writes into the live web root. Two things make this safe to publish rather
 * than merely quick.
 *
 * THE BASE WAS PROVED, NOT ASSUMED. The repository's copy was transcribed from
 * the server and its sha256 compared against the server's own —
 * 368355e52ec4fe2c…bbc2e on both sides, 240 lines and 8347 bytes either way —
 * BEFORE a line was changed. So what is published differs from what is there by
 * exactly the three fixes and nothing else. $WAS below is that hash, and this
 * script REFUSES to write if the live file is not it: something else has edited
 * deploy.php since, and overwriting that blind would discard it.
 *
 * IT HAS NEVER RUN. manifest=none, artifacts=0, and all three lines of its log
 * are FAIL bad_signature — so there is no working deploy to break. The guard
 * chain is unchanged either way: method, signature, replay window, sha shape
 * and host allow-list are byte-identical to what is live.
 *
 * THE FIXES
 *   - the size cap read only the declared Content-Length, so a chunked
 *     response from codeload.github.com capped at nothing;
 *   - the protected-path check on zip entries tested the first path segment,
 *     which in a GitHub archive is the `wain-<sha>` wrapper and never `api`,
 *     making that layer inert for every archive this endpoint deploys;
 *   - the staged path was stripped with str_replace rather than as a prefix.
 *
 * $COMMIT PINS THE FILE, NOT THIS SCRIPT — fetch the script from HEAD, and the
 * FULL forty characters, because an abbreviated sha 404s on
 * raw.githubusercontent and an unresolvable ref is an empty fetch.
 */

$COMMIT = '68cb1da53d120fc0fa76e793da33214debb57365';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$REL    = 'api/deploy.php';
$WAS    = '368355e52ec4fe2c5ddee00b521cc4143741143b4dde943585c38a55778bbc2e';
$WANT   = 'c9bfa1c1b73cc38ad182a4a01de0bff5541e9d2bc7a651e6f0bc0cece11aab00';

$target = $ROOT . '/' . $REL;
$bits   = [];

if (!is_file($target)) { echo "DEPLOYFIX file=MISSING\n"; return; }
$have = hash_file('sha256', $target);

if ($have === $WANT) {
    // Already published. Says the same thing on every run, which is what makes
    // it readable a minute later — the cron output is the LAST run's.
    echo 'DEPLOYFIX state=ALREADY-FIXED sha=' . substr($have, 0, 12)
       . ' bytes=' . filesize($target) . "\n";
    return;
}
if ($have !== $WAS) {
    // NOT OURS TO OVERWRITE. The live file is neither the base this change was
    // built on nor the result — somebody or something has edited it, and
    // publishing over that would throw the edit away with no record of it.
    echo 'DEPLOYFIX state=REFUSED-UNEXPECTED-BASE live=' . substr($have, 0, 12)
       . ' expectedBase=' . substr($WAS, 0, 12) . ' bytes=' . filesize($target) . "\n";
    return;
}

$ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
              . '/sporta-site/public_html/' . $REL);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                        CURLOPT_TIMEOUT => 60]);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!is_string($body) || $code !== 200 || $body === '') {
    echo 'DEPLOYFIX state=FETCH-FAILED http=' . $code . ' bytes=' . strlen((string) $body) . "\n";
    return;
}
if (hash('sha256', $body) !== $WANT) {
    echo 'DEPLOYFIX state=HASH-MISMATCH got=' . substr(hash('sha256', $body), 0, 12)
       . ' want=' . substr($WANT, 0, 12) . "\n";
    return;
}

// Keep the old one. A removal from a live server should be a rename, and that
// goes double for the one file that can write to the web root: this is the
// rollback, and it costs 8 kB.
@copy($target, $ROOT . '/../storage/deploy.php.before-' . gmdate('Ymd-His'));

// Scratch-then-rename, so no request ever reads half a PHP file — which would
// be a parse error served from the API directory.
$tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
$ok  = @file_put_contents($tmp, $body) === strlen($body);
if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
@unlink($tmp);
@chmod($target, 0644);

clearstatcache(true, $target);
$now = is_file($target) ? hash_file('sha256', $target) : 'gone';
$bits[] = 'state=' . ($now === $WANT ? 'PUBLISHED' : 'WRITE-FAILED');
$bits[] = 'sha=' . substr($now, 0, 12);
$bits[] = 'bytes=' . (is_file($target) ? filesize($target) : 0);

// AND THE ENDPOINT STILL EXECUTES. A syntax error in this file would be a 500
// from the API directory, and the 405 is what proves PHP parsed and ran it.
// GET only — its first branch is the method check, so this cannot deploy.
$ch = curl_init('https://127.0.0.1/api/deploy.php');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
                        CURLOPT_SSL_VERIFYHOST => false, CURLOPT_TIMEOUT => 20,
                        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw']]);
$r = (string) curl_exec($ch);
$rc = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$j = json_decode($r, true);
$bits[] = 'GET=' . $rc . '/' . (is_array($j) ? ($j['error'] ?? 'no-error-key') : 'NOT-JSON');

echo 'DEPLOYFIX ' . implode(' ', $bits) . "\n";
