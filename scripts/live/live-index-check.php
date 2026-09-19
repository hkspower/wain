<?php
/**
 * Can Google actually index this shop? Asked of the live server, as Googlebot.
 *
 * READ-ONLY. It makes GET requests and writes nothing — the rule for anything
 * fetched over a public URL from a public repository.
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-index-check.php && php c.php
 *
 * WHY IT IS NOT A READ OF robots.txt. Every file in this repository says the
 * right thing; the question is what the SERVER sends, and this project has
 * already been caught twice on the gap. `.htaccess` carries
 *
 *     Header set X-Robots-Tag "noindex" env=SPORTA_ASSET_HOST
 *
 * and the entry in CLAUDE.md that proves `Header set … env=` works on LiteSpeed
 * proves only the POSITIVE half — that static.sporta.com.kw gets the header.
 * Nobody has ever asked whether www gets it too. If LiteSpeed evaluated that
 * `env=` wrongly, every page of the shop would carry `noindex` and Google would
 * crawl the site and index none of it, silently, for ever. That is the single
 * failure that would make "connect to google index" impossible however carefully
 * the sitemaps were submitted, and it costs one header to rule out.
 *
 * IT ASKS AS GOOGLEBOT, over the PUBLIC name. A crawler's request traverses the
 * CDN like a shopper's, and a shared cache may hold or strip a header — the same
 * argument `live-edge-check.php` makes, and the loopback cannot answer it.
 * Where a difference matters the loopback is asked too, so the two are side by
 * side rather than one standing in for the other.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Verifying the property in Search Console and
 * submitting the sitemap need the owner's Google account, and nothing here can
 * or should hold that. This answers the question that comes first: if the
 * property were verified this minute, would Google be able to index the shop?
 *
 * ECHO AS IT MEASURES, never at the end — a run cut short must still report what
 * it got, and this channel has cut runs short before.
 */

header('Content-Type: text/plain; charset=utf-8');
@ini_set('default_socket_timeout', '8');

const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

/** GET $path over the public name (the crawler's path, through the CDN). */
function edge(string $path): array { return get('https://www.sporta.com.kw' . $path, false); }

/** GET $path over the loopback (LiteSpeed directly, CDN bypassed). */
function origin(string $path): array { return get('https://127.0.0.1' . $path, true); }

function get(string $url, bool $loopback): array {
    $opts = ['http' => [
        'method'        => 'GET',
        'timeout'       => 8,
        'ignore_errors' => true,
        'header'        => "User-Agent: " . UA . "\r\n"
                         . ($loopback ? "Host: www.sporta.com.kw\r\n" : ''),
    ]];
    // Verification off on the LOOPBACK only, and for the documented reason: it
    // connects by address while the certificate is for the public name. The
    // edge request keeps verification ON, so a broken chain shows up here too.
    // `allow_self_signed` and an explicit `peer_name` are both load-bearing:
    // without them the loopback fetch returns false, and a fetch that never
    // happened printed `same=NO <-- the CDN is serving something else` on the
    // first run. A false alarm about the CDN is exactly the alarm the owner
    // would be asked to act on.
    if ($loopback) $opts['ssl'] = [
        'verify_peer' => false, 'verify_peer_name' => false,
        'allow_self_signed' => true, 'SNI_enabled' => true,
        'peer_name' => 'www.sporta.com.kw',
    ];

    $body = @file_get_contents($url, false, stream_context_create($opts));
    if ($body === false) return ['code' => 0, 'body' => '', 'headers' => []];

    $code = 0; $headers = [];
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('~^HTTP/\S+\s+(\d{3})~', $h, $m)) { $code = (int) $m[1]; continue; }
        $i = strpos($h, ':');
        if ($i !== false) $headers[strtolower(substr($h, 0, $i))] = trim(substr($h, $i + 1));
    }
    return ['code' => $code, 'body' => $body, 'headers' => $headers];
}

line('=== is the shop allowed to be indexed at all ===');
// The one that would make everything else pointless. A page carrying noindex is
// crawled and then dropped, and nothing anywhere reports it.
foreach (['/' => 'home', '/shop' => 'shop', '/product/gymshark-phone-strap' => 'product'] as $path => $what) {
    $e = edge($path);
    $tag = $e['headers']['x-robots-tag'] ?? '';
    $meta = '';
    if (preg_match('~<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']*)~i', $e['body'], $m)) $meta = $m[1];
    line(sprintf(
        '%-8s %d/%-6d  X-Robots-Tag=%-12s metaRobots=%-22s %s',
        $what, $e['code'], strlen($e['body']),
        $tag === '' ? '(none)' : $tag,
        $meta === '' ? '(none)' : $meta,
        (stripos($tag, 'noindex') !== false || stripos($meta, 'noindex') !== false)
            ? '<-- WILL NOT BE INDEXED' : 'indexable'
    ));
}
// The negative half of the asset-host rule, which nothing had ever checked: the
// header must be on static and NOT on www. Both are asked, in one line, because
// either alone is the wrong answer to a different question.
$s = get('https://static.sporta.com.kw/assets/sporta-ui.css', false);
line('assetHost X-Robots-Tag=' . ($s['headers']['x-robots-tag'] ?? '(none)')
   . '  (must be noindex here and absent on www — one rule, both halves)');

line('');
line('=== what a crawler is told, and what it is given ===');
$r = edge('/robots.txt');
$allowed = preg_match('~User-agent:\s*Googlebot~i', $r['body']) ? 'named' : 'wildcard-only';
line(sprintf('robots.txt  %d/%d  googlebotGroup=%s  disallowRoot=%s  sitemapLine=%s',
    $r['code'], strlen($r['body']), $allowed,
    preg_match('~^\s*Disallow:\s*/\s*$~mi', $r['body']) ? 'YES <-- crawling is OFF' : 'no',
    preg_match('~^\s*Sitemap:\s*(\S+)~mi', $r['body'], $m) ? $m[1] : 'MISSING'));

foreach (['/sitemap.xml', '/sitemap-pages.xml', '/sitemap-products.xml'] as $path) {
    $x = edge($path);
    $urls = substr_count($x['body'], '<loc>');
    $mods = [];
    if (preg_match_all('~<lastmod>([^<]{10})~', $x['body'], $m)) $mods = array_unique($m[1]);
    sort($mods);
    line(sprintf('%-22s %d/%-6d locs=%-4d newestLastmod=%s',
        $path, $x['code'], strlen($x['body']), $urls, $mods ? end($mods) : '(none)'));
}
// sitemap-products.xml is REWRITTEN to api/sitemap-products.php, so the file in
// the docroot is not what is served — and the two carry different dates. If the
// rewrite is not live, the crawler gets a July snapshot of a catalogue the owner
// has edited since, which is a stale index rather than an error.
$p = edge('/api/sitemap-products.php');
line('generator direct: ' . $p['code'] . '/' . strlen($p['body'])
   . '  (a different byte count from sitemap-products.xml above means the rewrite is NOT live)');

line('');
line('=== is the property claimable, and is the page worth indexing ===');
$home = edge('/');
$ver = preg_match('~google-site-verification["\'\s:=]+([A-Za-z0-9_-]{20,})~', $home['body'], $m) ? $m[1] : '';
line('googleSiteVerification=' . ($ver !== '' ? substr($ver, 0, 12) . '…' : 'NONE — Search Console cannot verify by meta tag yet'));
$g = get('https://www.sporta.com.kw/google' . 'site-verification-probe.html', false);
line('a missing file answers ' . $g['code'] . ' (an HTML-file verification needs this to be 404 until the real one is uploaded)');

// seo.php exists precisely so a crawler gets real text rather than an empty
// shell. Whether it does is a property of the SERVER: `php -S` reads no
// .htaccess, so no rig here has ever seen this page.
preg_match('~<title[^>]*>([^<]*)~i', $home['body'], $t);
preg_match('~<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']*)~i', $home['body'], $c);
$hre = preg_match_all('~rel=["\']alternate["\'][^>]+hreflang~i', $home['body']);
line('title=' . trim($t[1] ?? '(none)'));
line('canonical=' . ($c[1] ?? '(none)') . '  hreflangLinks=' . $hre);
$o = origin('/');
// A fetch that FAILED and a fetch that DIFFERED are different findings, and
// only one of them is about the CDN. Saying which costs one branch.
$verdict = $o['code'] === 0
    ? '  originFetchFAILED — this line says nothing about the CDN'
    : ((strlen($o['body']) === strlen($home['body']))
        ? '  same=yes'
        : '  same=NO <-- the CDN is serving something else');
line('origin=' . $o['code'] . '/' . strlen($o['body']) . '  edge=' . $home['code'] . '/' . strlen($home['body'])
   . '  cdn=' . ($home['headers']['x-hcdn-cache-status'] ?? '-') . $verdict);
