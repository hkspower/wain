<?php
/**
 * THE PANEL'S ENTRY — /backends served without the storefront's scripts (2026-10-04, "faster panel").
 *
 * The mirror of what seo.php does for shoppers. index.html carries ~85 overlay scripts; seo.php strips
 * the 50 marked `data-panel` from every storefront page, and until today /backends was served straight
 * from index.html with every one of the OTHER kind — hero preload, card options, menu bar, checkout
 * fields, order progress, ~35 scripts and ~300 kB that find no shop markup on the panel and return.
 * A script tag marked `data-shop` is a storefront-only script; this file drops those from the panel.
 *
 * FAILS TOWARDS SENDING THEM, exactly as seo.php does: a regex that returns null or an empty result
 * leaves the shell as it was. An extra script costs bytes; a missing one costs a feature. Only a whole
 * <script … data-shop … src=…></script> tag is touched, never an inline script (the CSP names those by
 * hash, and this file must not change a byte of them).
 *
 * WHAT IS DELIBERATELY NOT MARKED, because the panel uses it: api-dedupe.js, config.js, theme.js (the
 * owner's colours apply to the panel too), custom-css.js (skips the panel itself), keyboard-hints.js
 * (the order drawer's number pads), home-banner.js (its `preview` export draws the editor's preview).
 * scripts/panel-scripts-test.mjs renders the signed-in panel with and without the marked scripts and
 * requires the same screen, so a script the panel quietly depended on cannot be marked by mistake.
 *
 * .htaccess:  RewriteRule ^backends(/.*)?$ /panel.php [L]    scripts/dev-router.php mirrors it.
 * The ETag is a hash of the body (a pure function of index.html — no clock, cookie or language), so a
 * returning admin gets a 304 until the shell is republished; `no-cache` keeps the ask on every load.
 */
declare(strict_types=1);

$shell = __DIR__ . '/index.html';
$html = @file_get_contents($shell);
if ($html === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Store shell missing.');
}

$stripped = @preg_replace('#[ \t]*<script\b(?=[^>]*\sdata-shop\b)(?=[^>]*\ssrc=)[^>]*></script>[ \t]*\r?\n?#', '', $html);
if (is_string($stripped) && strlen($stripped) > 1000 && strpos($stripped, '</html>') !== false) $html = $stripped;

$etag = '"' . sha1($html) . '"';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');
header('X-Robots-Tag: noindex');
header('ETag: ' . $etag);
$inm = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($inm !== '' && $inm !== '*') {
    foreach (explode(',', $inm) as $tag) {
        $tag = trim($tag);
        if (str_starts_with($tag, 'W/')) $tag = substr($tag, 2);
        if ($tag === $etag) { http_response_code(304); exit; }
    }
}
echo $html;
