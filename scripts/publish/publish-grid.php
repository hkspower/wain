<?php
/**
 * The product grid's tighter rows and heavier price — two files, one run.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-grid.php && php r.php
 *
 * WHAT IT PUBLISHES, and why the second file is not optional:
 *
 *   assets/sporta-ui.css   the row gap 42.08px -> 1.5rem, and .price-card
 *                          16.83px/700 inside a product-card grid. Both aimed by
 *                          structural selectors, because the grid has no class
 *                          of its own.
 *
 *   sw.js                  VERSION v10-refresh1 -> v11-grid1. sporta-ui.css is
 *                          one of fifteen FIXED-NAME assets, so a browser still
 *                          running an older worker holds whatever copy it first
 *                          cached and never asks again. Activating a new VERSION
 *                          deletes every cache that is not the current one, and
 *                          that is the only thing that frees them. Publishing
 *                          the CSS alone would reach new visitors and nobody
 *                          else — the exact fault behind "I change something and
 *                          the shop still shows the old version".
 *
 * NO .htaccess HERE, checked rather than assumed: neither file changes an
 * inline script in index.html, so no CSP hash moved and index.html is not in
 * this run. The check below still counts BLOCKED, because a policy and a page
 * that have drifted for any other reason are worth knowing about in the same
 * breath.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - two paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in it,
 *     which makes a raw.githubusercontent ref ambiguous — it returns an EMPTY
 *     file and says nothing)
 *   - temp file + rename; deletes nothing; creates no directory
 *   - fetched ONE AT A TIME, because concurrent fetches of raw.githubusercontent
 *     once produced one good file and two empty ones
 *   - IDEMPOTENT: a file already matching its hash is skipped, so re-running
 *     costs nothing and a half-finished run completes on the next one
 *
 * THE CHECK ASKS THE SERVER for the thing each change was made FOR rather than
 * for a byte count, over the loopback. `swVersion` is read from what the server
 * SERVES rather than from disk, because that is the string a returning browser
 * compares against its own worker.
 *
 * AND A CHECK RUN IN THE SAME BREATH AS THE WRITE CAN MEASURE THE STATE BEFORE
 * IT — this docroot has a writer that acts on a delay and LiteSpeed can hold an
 * old parse. If a line below contradicts a write this run verified by sha256,
 * re-ask a minute later before believing either.
 */

$COMMIT = '4f5b4048f62bcfffb3000b71e4bf614d829ecbc6';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/* sw.js LAST. In the window between the two writes, a visitor who activates the
   new worker before the CSS lands would drop their caches and re-fetch the OLD
   stylesheet — freeing the pin and then immediately re-pinning to the same file.
   CSS first makes that window harmless. */
$FILES = [
    'assets/sporta-ui.css' => '79fc7d062eb76235ad8ca6ed205e3093beb54ba768b57fb9e919903c2dee4675',
    'sw.js'                => 'b178cb2db59cfe681696bc8b51d48fcfa124968111112a4c85baf754adecb885',
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
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** What the live server serves for a path, with its headers. The public name is
 *  used only as a Host header — see CLAUDE.md on why this form keeps working
 *  whether or not the domain resolves. */
$serve = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [substr($out, 0, $size), substr($out, $size)];
};

[$headHtml, $html] = $serve('/');
[, $ui]            = $serve('/assets/sporta-ui.css');

/* Does the policy the server SENDS name the inline scripts the page CARRIES?
   Nothing in this run touches either, so anything but 0 is pre-existing drift —
   worth seeing, not caused here. */
$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$blocked = 0;
foreach ($s[1] as $b) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $b, true)), $declared, true)) $blocked++;
}

/* The two rules, asked for by their own text in the served stylesheet rather
   than by a byte count: a file of the right length with the wrong contents is
   exactly what a stale LiteSpeed parse looks like. */
$grid = 'main div.grid:has(> article > a[class*="aspect-"])';

echo 'GRID wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' rowGap=' . (strpos($ui, $grid . ' {') !== false
                   && strpos($ui, 'row-gap: 1.5rem') !== false ? 'ok' : 'MISSING')
   . ' priceSize=' . (strpos($ui, $grid . ' article .price-card') !== false ? 'ok' : 'MISSING')
   . ' uiBytes=' . strlen($ui)
   . ' swVersion=' . (preg_match("/const VERSION = '([^']+)'/", $serve('/sw.js')[1], $m2) ? $m2[1] : 'UNREADABLE')
   . ' inlineScripts=' . count($s[1]) . ' cspHashes=' . count($declared) . ' BLOCKED=' . $blocked
   . "\n";
