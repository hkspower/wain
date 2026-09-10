<?php
/**
 * Is today's work actually ON the live server?
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-updated-check.php && php r.php
 *
 * READ-ONLY. Timestamps, hashes and GETs. Nothing is written; no configuration
 * value is printed.
 *
 * TWO QUESTIONS, AND THE SECOND IS THE ONE THAT MATTERS.
 *
 *   1. WHEN was each file last written, by the server's own clock. A date is
 *      what "updated today" asks for and a hash cannot answer it: a file
 *      republished with identical bytes is `same` either way.
 *
 *   2. Does the shop DO the things only today's code does. Bytes on disk are
 *      not behaviour — this repository has a docroot with a writer that puts a
 *      file back a minute after it is removed, and a CDN in front of it, so
 *      "the file is there" and "the shop behaves" are genuinely separate
 *      claims. Each marker below is something that was IMPOSSIBLE yesterday:
 *
 *        shellEtag   `/` carries an ETag at all — seo.php gained it today, and
 *                    before that every navigation re-sent 42 kB
 *        shell304    and a conditional request is answered with an empty 304,
 *                    which is the whole point of the ETag
 *        rulesFeed   ?r=slides carries the six public shop rules — api.php
 *                    gained that today
 *        rulesRoute  admin.php?r=rules exists and is GATED (401 without a
 *                    session). A 404 means the file is old; a 200 would mean
 *                    the shop's own numbers are readable by anyone, which is
 *                    worse than not having shipped
 *        rulesCard   /assets/rules.js answers — a file that did not exist
 *        cardTag     and index.html actually references it, because an
 *                    unreferenced file is a file nobody loads
 *
 * WHY BOTH. A hash match with an old date would mean somebody else wrote the
 * same bytes; a fresh date with a failing marker would mean the write landed
 * and the shop still does not do it. Neither alone is an answer.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$TODAY = gmdate('Y-m-d');

/* The files published today, in the order they were published. The hash is NOT
   listed here: live-file-check.php owns that comparison against a generated
   manifest, and a second hand-written copy would be a second home for it — the
   exact staleness this repository keeps re-learning. This asks only WHEN. */
$FILES = [
    'api/store.php', 'api/api.php', 'api/admin.php',
    'assets/rules.js', 'index.html', 'sw.js', 'seo.php',
];

$dates = [];
$todayCount = 0;
foreach ($FILES as $rel) {
    $p = $ROOT . '/' . $rel;
    if (!is_file($p)) { $dates[] = basename($rel) . '=ABSENT'; continue; }
    $d = gmdate('m-d H:i', filemtime($p));
    if (str_starts_with(gmdate('Y-m-d', filemtime($p)), $TODAY)) $todayCount++;
    $dates[] = basename($rel) . '=' . $d;
}

/** A request over the loopback: the origin, not the CDN. */
function ask(string $path, array $extra = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $extra),
        CURLOPT_TIMEOUT        => 30,
    ]);
    $raw  = (string) curl_exec($ch);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $head = substr($raw, 0, $hs);
    $etag = preg_match('/^etag:\s*(.+)$/im', $head, $m) ? trim($m[1]) : '';
    return [$code, $etag, substr($raw, $hs)];
}

[$shellCode, $shellEtag, $shellBody] = ask('/');
$shell304 = $shellEtag !== '' ? ask('/', ['If-None-Match: ' . $shellEtag])[0] : 0;

[, , $slides] = ask('/api/api.php?r=slides');
$j = json_decode($slides, true);
$r = is_array($j) && isset($j['rules']) && is_array($j['rules']) ? $j['rules'] : null;

// The admin route must EXIST and must REFUSE. 404 = old file; 200 = a leak.
[$rulesCode] = ask('/api/admin.php?r=rules', ['X-Sporta-Admin: 1']);

[$cardCode] = ask('/assets/rules.js');

echo 'UPDATED serverDay=' . $TODAY
   . ' filesWrittenToday=' . $todayCount . '/' . count($FILES)
   . ' | ' . implode(' ', $dates)
   . ' | shellEtag=' . ($shellEtag === '' ? 'NONE' : 'yes')
   . ' shell304=' . $shell304
   . ' rulesFeed=' . ($r === null ? 'MISSING' : count($r))
   . ' rulesRoute=' . $rulesCode . ($rulesCode === 401 ? '(gated)' : ($rulesCode === 200 ? '(LEAK)' : ''))
   . ' rulesCard=' . $cardCode
   . ' cardTag=' . (strpos($shellBody, '/assets/rules.js') !== false ? 'ok' : 'MISSING')
   . "\n";
