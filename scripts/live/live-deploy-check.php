<?php
/**
 * What state is api/deploy.php actually in? READ-ONLY.
 *
 * WHY THIS EXISTS. `deploy.php` is on the live server and in NO COMMIT — it is
 * the one piece of PHP on this shop that nobody can review, diff or restore,
 * and `live-file-check.php` has reported it as `untracked` every run without
 * anyone being able to say whether it works. It was read once through the
 * Hostinger file API and found to be careful; careful and CONFIGURED are
 * different questions, and this asks the second one.
 *
 * Its whole behaviour hinges on a file it reads at request time —
 * `<domain>/storage/deploy.secret`, deliberately outside public_html. With no
 * secret every signed POST answers 500 `secret_not_configured`, so the endpoint
 * is inert while looking perfectly healthy from outside: a GET still answers
 * 405 either way. **The 405 proves the file is being executed, not that the
 * deploy works.** That distinction is the whole point of this script.
 *
 * IT PRINTS NO SECRET. It reports whether the file exists, its size and mode —
 * never a byte of its content. This repository is public and this script is
 * fetched over a URL anyone can read, which is why it must stay read-only and
 * why the one value it must never print is the one it is asking about.
 *
 * Nothing here writes, POSTs, or triggers a deploy. The endpoint is only probed
 * with a GET, which its own first branch refuses.
 */

$ROOT    = '/home/u130124229/domains/sporta.com.kw';
$WEBROOT = $ROOT . '/public_html';
$STORAGE = $ROOT . '/storage';
$WORK    = $STORAGE . '/deploy';

$bits = [];

/* ------------------------------------------------------------ the endpoint */
$dep = $WEBROOT . '/api/deploy.php';
$bits[] = 'file=' . (is_file($dep) ? filesize($dep) : 'MISSING');

/* -------------------------------------------------------------- the secret */
// The single thing that decides whether this endpoint can do anything.
if (is_file($STORAGE . '/deploy.secret')) {
    $s = $STORAGE . '/deploy.secret';
    $bits[] = 'secret=yes/' . filesize($s) . 'b/' . substr(sprintf('%o', fileperms($s)), -4)
            . '/' . (is_readable($s) ? 'readable' : 'UNREADABLE');
} else {
    $bits[] = 'secret=MISSING';
}

/* ------------------------------------------------- has it ever run at all? */
$bits[] = 'storage=' . (is_dir($STORAGE) ? 'yes' : 'MISSING');
$bits[] = 'work=' . (is_dir($WORK) ? 'yes' : 'MISSING');

$log = $WORK . '/deploy.log';
if (is_file($log)) {
    $lines = @file($log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $bits[] = 'log=' . count($lines) . 'lines';
    // The last two say more than a count: an endpoint that has only ever
    // logged FAIL lines is a different problem from one that has never run.
    foreach (array_slice($lines, -2) as $i => $l) {
        $bits[] = 'log' . $i . '=' . str_replace(' ', '_', substr($l, 0, 70));
    }
} else {
    $bits[] = 'log=NEVER-RAN';
}

$man = $WORK . '/manifest.json';
if (is_file($man)) {
    $j = json_decode((string) @file_get_contents($man), true);
    $bits[] = 'manifest=' . (is_array($j) ? (count($j['files'] ?? []) . 'files/v' . ($j['version'] ?? '?')
            . '/' . ($j['deployedAt'] ?? '?')) : 'UNREADABLE');
} else {
    $bits[] = 'manifest=none';
}

$zips = glob($WORK . '/artifact-*.zip') ?: [];
$bits[] = 'artifacts=' . count($zips);

/* ------------------------------------------- what the live URL answers now */
// GET only. Its first branch is a method check, so this cannot deploy anything.
// The loopback form, per CLAUDE.md: it works whether or not the name resolves.
$ch = curl_init('https://127.0.0.1/api/deploy.php');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 20,
]);
$body = (string) curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$j = json_decode($body, true);
$bits[] = 'GET=' . $code . '/' . (is_array($j) ? ($j['error'] ?? 'no-error-key') : 'not-json');

echo 'DEPLOY ' . implode(' ', $bits) . "\n";
