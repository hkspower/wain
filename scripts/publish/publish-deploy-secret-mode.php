<?php
/**
 * Take the deploy secret off world-read. One chmod, and the full log.
 *
 * WHAT IS WRONG. `storage/deploy.secret` is the HMAC key that authorises
 * api/deploy.php to write files into the live web root. deploy.php's own header
 * specifies `0600`; it was measured at **0644** on 2026-09-11 — world-readable
 * on SHARED HOSTING, where "world" is other accounts on the same machine. The
 * key is 64 bytes and anyone holding it can deploy static files onto the shop.
 *
 * WHY THIS IS SAFE TO DO WITHOUT ASKING. chmod 0600 only REMOVES access, and it
 * removes it from everyone except the account that owns the file — which is the
 * account PHP runs as, so deploy.php reads it exactly as before. There is no
 * configuration in which 0644 works and 0600 does not. It cannot break a deploy
 * that works, and this one has never worked at all: manifest=none, artifacts=0,
 * and every line in its log is a FAIL.
 *
 * ROTATION IS A DIFFERENT QUESTION and is NOT done here. The key has been
 * world-readable for an unknown length of time, so tightening the mode does not
 * un-expose it — only a new secret does, and generating one is the owner's call
 * because it is the thing they would have to carry to whatever signs the
 * requests. This script never reads, prints or writes the secret's CONTENT.
 *
 * IT REPORTS STATE, NOT ITS OWN VERB. CLAUDE.md: cron keeps the last run's
 * output, and on a per-minute job that is not the run that acted. `mode=0600`
 * reads the same whether this run changed it or found it already right, which
 * is what makes the answer trustworthy a minute later.
 */

$ROOT   = '/home/u130124229/domains/sporta.com.kw';
$SECRET = $ROOT . '/storage/deploy.secret';
$WORK   = $ROOT . '/storage/deploy';

$bits = [];

if (!is_file($SECRET)) {
    echo "SECRET file=MISSING\n";
    return;
}

// Tighten. @ because a failure must be reported as the resulting MODE rather
// than as an exception — the mode below is the only thing worth believing.
@chmod($SECRET, 0600);

// Read back from the absolute path, after the change, per the standing rule
// that a check which cannot fail is not a check.
clearstatcache(true, $SECRET);
$mode = substr(sprintf('%o', fileperms($SECRET)), -4);
$bits[] = 'mode=' . $mode;
$bits[] = 'size=' . filesize($SECRET) . 'b';
$bits[] = 'readableByUs=' . (is_readable($SECRET) ? 'yes' : 'NO');

// The directory matters too: a 0600 file inside a world-traversable directory
// is still reachable by name, and 'storage' is a sibling of public_html rather
// than under it, so nothing here is served over HTTP either way.
clearstatcache(true, dirname($SECRET));
$bits[] = 'dirMode=' . substr(sprintf('%o', fileperms(dirname($SECRET))), -4);

// The WHOLE log this time — the earlier check printed the last two of three,
// and the shape of who has been probing this endpoint is worth reading in full.
$log = $WORK . '/deploy.log';
if (is_file($log)) {
    $lines = @file($log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $bits[] = 'log=' . count($lines);
    foreach ($lines as $i => $l) $bits[] = 'L' . $i . '=' . str_replace(' ', '_', substr($l, 0, 78));
} else {
    $bits[] = 'log=NEVER-RAN';
}

echo 'SECRET ' . implode(' ', $bits) . "\n";
