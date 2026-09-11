<?php
/**
 * Publish the three fixes to api/deploy.php.
 *
 * ONE FILE, AND IT IS THE MOST SENSITIVE ONE ON THE SHOP: a signed endpoint that
 * writes into the live web root. Two things make this safe to publish rather
 * than merely quick.
 *
 * THE BASE WAS PROVED, NOT ASSUMED. $WAS is the sha256 of what should be on the
 * server right now — the round published earlier today, itself verified against
 * the server's own hash before a line of it was changed. This script REFUSES to
 * write if the live file is not exactly that: something else has edited
 * deploy.php since, and overwriting that blind would discard it with no record.
 *
 * IT HAS NEVER RUN. manifest=none, artifacts=0, and all three lines of its log
 * are FAIL bad_signature — so there is no working deploy to break. The guard
 * chain is unchanged either way: method, signature, replay window, sha shape
 * and host allow-list are byte-identical to what is live.
 *
 * THIS ROUND IS A SECURITY FIX, and it is the one that matters most of the five
 * this endpoint has had. The header's promise — "never executes downloaded
 * code; .php in an artifact is refused" — was FALSE, because the .php regex was
 * the only execution guard of its kind. Measured against the real functions,
 * all of these were accepted and written:
 *
 *     assets/.user.ini    assets/.htaccess    assets/x.php5    assets/x.pht
 *
 * `.user.ini` is PHP's per-directory config under CGI/FastCGI: auto_prepend_file
 * in it runs an arbitrary file on every request to that directory, with no .php
 * entry anywhere in the archive. `.htaccess` can map any extension to the PHP
 * handler. PROTECTED_PATHS does list `.htaccess`, but isProtected() tests the
 * FIRST path segment, so it guarded the web root's own and nothing deeper.
 *
 * AND a failed @copy was silent — ok:true with a smaller count — after which the
 * prune deleted the still-good OLD file for being absent from the short new
 * manifest. The replacement did not arrive and the original was removed.
 *
 * The earlier round's three fixes (the size cap on a chunked response, the inert
 * protected-path check on wrapped archives, the str_replace prefix strip) are
 * already live and are carried forward unchanged.
 *
 * $COMMIT PINS THE FILE, NOT THIS SCRIPT — fetch the script from HEAD, and the
 * FULL forty characters, because an abbreviated sha 404s on
 * raw.githubusercontent and an unresolvable ref is an empty fetch.
 */

$COMMIT = 'f910543bd96369b7460bb7562859f07394283a4d';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$REL    = 'api/deploy.php';
$WAS    = 'c9bfa1c1b73cc38ad182a4a01de0bff5541e9d2bc7a651e6f0bc0cece11aab00';
$WANT   = 'e3ab2a969bb4745a5f8b4b90e07d0881f08566b3757d216af0a2699ea12c01b7';

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
