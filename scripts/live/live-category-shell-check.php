<?php
/**
 * The four category pages as the LIVE server renders them — 2026-10-01.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-category-shell-check.php && php r.php
 *
 * READ-ONLY. GET requests to the origin over the loopback (pinned with
 * CURLOPT_RESOLVE, so the CDN is not in the path); it writes nothing and
 * prints no configuration value.
 *
 * WHY IT EXISTS. category.php is rendered by PHP from the live catalogue, and
 * it finds the bundle's content-hashed stylesheet by reading the live
 * index.html at request time. A sandbox run vouches for neither. Since the
 * owner's "one card" / "shop header and footer" choices of 2026-10-01, each
 * page should: wear the shop's header and footer, link the bundle CSS,
 * sporta-dark.css and sporta-ui.css, draw the /shop card with one heart per
 * card, and set the browser bar to the header's #2d3034.
 *
 * One line per page, printed as it is measured — a run cut short still says
 * what it got.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function get(string $path): array {
    $ch = curl_init('https://www.sporta.com.kw' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE        => ['www.sporta.com.kw:443:127.0.0.1'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => false,   // the loopback: content is the question, not TLS
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_USERAGENT      => 'sporta-category-shell-check',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$code, is_string($body) ? $body : ''];
}

$bundleCss = null;
$bad = 0;
foreach (['men', 'women', 'accessories', 'outlet'] as $slug) {
    foreach (['', '?lang=en'] as $q) {
        [$code, $html] = get('/' . $slug . $q);
        $cards  = substr_count($html, '<article');
        $hearts = substr_count($html, 'data-sporta-heart=');
        $header = strpos($html, '<header class="app-header') !== false ? 'yes' : 'NO';
        $footer = strpos($html, 'class="app-footer') !== false ? 'yes' : 'NO';
        $ui     = strpos($html, 'href="/assets/sporta-ui.css"') !== false ? 'yes' : 'NO';
        $dark   = strpos($html, 'href="/assets/sporta-dark.css"') !== false ? 'yes' : 'NO';
        $m = [];
        preg_match('#href="(/assets/index-[A-Za-z0-9_-]+\.css)"#', $html, $m);
        if (!empty($m[1])) $bundleCss = $m[1];
        $tc = [];
        preg_match('#<meta name="theme-color" content="([^"]+)"#', $html, $tc);
        $ok = $code === 200 && $header === 'yes' && $footer === 'yes' && $ui === 'yes' && $dark === 'yes'
            && !empty($m[1]) && ($tc[1] ?? '') === '#2d3034' && $hearts === $cards;
        if (!$ok) $bad++;
        line(sprintf('/%s%s %d/%d header=%s footer=%s ui=%s dark=%s bundleCss=%s theme=%s cards=%d hearts=%d%s',
            $slug, $q, $code, strlen($html), $header, $footer, $ui, $dark,
            $m[1] ?? 'NONE', $tc[1] ?? 'NONE', $cards, $hearts, $ok ? '' : '  <-- not as expected'));
    }
}

/* The stylesheet the pages name must exist: it is read out of index.html at
   request time, and a name that resolves to nothing is an unstyled page. */
if ($bundleCss !== null) {
    [$code, $css] = get($bundleCss);
    if ($code !== 200 || strlen($css) < 1000) $bad++;
    line("bundleCss $bundleCss -> $code/" . strlen($css));
} else {
    $bad++;
    line('bundleCss NONE named on any page');
}

line($bad ? "CATEGORY-SHELL $bad problem(s)" : 'CATEGORY-SHELL ok — 8 pages: shop header, footer, stylesheets, one heart per card');
