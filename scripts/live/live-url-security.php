<?php
/**
 * Every URL the shop has, asked the security questions. READ-ONLY (GET / HEAD / OPTIONS / TRACE only).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-url-security.php && php r.php
 *   cat /home/u130124229/url-sec.txt        (a second job; the run takes minutes, see below)
 *
 * WHICH URLS: every page in the three sitemaps (both languages), every file under public_html
 * (assets, images, fonts, scripts — the whole docroot, mapped to its URL), every api/*.php script
 * asked bare (no parameters, so nothing it does on a request needs an id), and a list of probes an
 * attacker tries first: dotfiles, config, backups, source, directory listings, path traversal, open
 * redirect, host-header injection, CORS from a foreign origin, TRACE, plain http.
 *
 * WHAT IS ASKED OF EACH:
 *   - source      a .php / .sql / .env answering 200 with its own source is a leak (the body is sniffed
 *                 for "<?php" and never printed)
 *   - secrets     a secret-looking name answering 200
 *   - listing     a directory answering with an index
 *   - headers     every HTML page: HSTS, nosniff, frame protection, Referrer-Policy, a CSP
 *   - cookies     any Set-Cookie without Secure / HttpOnly / SameSite
 *   - disclosure  Server / X-Powered-By carrying a version
 *   - cors        a foreign Origin reflected back, or "*" with credentials
 *   - redirect    a redirect that leaves the shop
 *
 * HOW IT IS RUN, because three things in this repository's CLAUDE.md apply:
 *   - Over the loopback with a Host header (https://127.0.0.1), so it works whether or not the public
 *     name resolves. This reaches the origin and BYPASSES the CDN; the headers a shopper gets through
 *     hcdn are asked separately by live-edge-check.php.
 *   - A 429/503 is the shop's own limiter answering, NOT an answer about the URL: it waits and asks
 *     again, and anything still throttled is counted as UNKNOWN and says so. A throttled probe reads
 *     exactly like a protected file.
 *   - It takes minutes, longer than a `* * * * *` cycle, so it holds a lock (a second run exits at once)
 *     and writes ~/url-sec.txt as it goes; the last line is DONE. A run that overruns reports nothing
 *     to the panel, which is why the answer lives in a file.
 *
 * Optional CLI for a local rig: php live-url-security.php <base-url> <docroot> [host-header] [out-file]
 */
$BASE = $argv[1] ?? 'https://127.0.0.1';
$DOC = rtrim($argv[2] ?? '/home/u130124229/domains/sporta.com.kw/public_html', '/');
$HOST = $argv[3] ?? 'www.sporta.com.kw';
$OUT = $argv[4] ?? '/home/u130124229/url-sec.txt';
$lockPath = $OUT . '.lock';
$lock = fopen($lockPath, 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit(0);
file_put_contents($OUT, '');
function out(string $s): void { global $OUT; file_put_contents($OUT, $s . "\n", FILE_APPEND); }

$ctx = function (string $method = 'GET', array $hdr = []) use ($HOST) {
    $h = "Host: $HOST\r\nUser-Agent: sporta-security-scan\r\n";
    foreach ($hdr as $k => $v) $h .= "$k: $v\r\n";
    return stream_context_create([
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => $HOST],
        'http' => ['method' => $method, 'header' => $h, 'timeout' => 6, 'ignore_errors' => true, 'follow_location' => 0],
    ]);
};
/** @return array{code:int,headers:array<string,string[]>,body:string} */
function ask(string $url, string $method = 'GET', array $hdr = [], int $max = 4096): array
{
    global $ctx;
    for ($try = 0; $try < 3; $try++) {
        $body = @file_get_contents($url, false, $ctx($method, $hdr), 0, $max);
        $code = 0; $heads = [];
        foreach (($http_response_header ?? []) as $line) {
            if (preg_match('#^HTTP/\S+ (\d{3})#', $line, $m)) { $code = (int) $m[1]; $heads = []; continue; }
            if (strpos($line, ':') !== false) { [$k, $v] = explode(':', $line, 2); $heads[strtolower(trim($k))][] = trim($v); }
        }
        if ($code !== 429 && $code !== 503) break;
        sleep(6);
    }
    usleep(120000);
    return ['code' => $code, 'headers' => $heads, 'body' => $body === false ? '' : $body];
}
function hv(array $r, string $k): string { return implode(' | ', $r['headers'][$k] ?? []); }

$find = [];           // findings: [severity, url, what]
function finding(string $sev, string $url, string $what): void { global $find; $find[] = [$sev, $url, $what]; out("  $sev  $url  $what"); }
$counts = ['asked' => 0, 'unknown' => 0];

// ---------------------------------------------------------------- 1. the URL list
$urls = [];   // path => kind
$sm = ask($BASE . '/sitemap.xml', 'GET', [], 200000);
$locs = [];
if (preg_match_all('#<loc>([^<]+)</loc>#', $sm['body'], $m)) $locs = $m[1];
foreach ($locs as $l) {
    $r = ask($BASE . parse_url(html_entity_decode($l), PHP_URL_PATH), 'GET', [], 400000);
    if (preg_match_all('#<loc>([^<]+)</loc>#', $r['body'], $m2)) {
        foreach ($m2[1] as $u) { $p = parse_url(html_entity_decode($u)); $urls[($p['path'] ?? '/') . (isset($p['query']) ? '?' . $p['query'] : '')] = 'page'; }
    } elseif (strpos($r['body'], '<urlset') === false) {
        $p = parse_url(html_entity_decode($l)); $urls[($p['path'] ?? '/')] = 'page';
    }
}
foreach (['/', '/shop', '/cart', '/checkout', '/track', '/returns', '/backends', '/wishlist', '/card', '/men', '/women', '/accessories', '/outlet'] as $p) $urls[$p] = 'page';
$pages = count($urls);
$files = [];
$stack = [$DOC];
while ($stack) {
    $d = array_pop($stack);
    foreach ((@scandir($d) ?: []) as $i) {
        if ($i === '.' || $i === '..') continue;
        $f = "$d/$i";
        if (is_link($f)) continue;
        if (is_dir($f)) { $stack[] = $f; continue; }
        $files[] = substr($f, strlen($DOC));
    }
}
sort($files);
out('SCAN pages=' . $pages . ' docrootFiles=' . count($files) . ' base=' . $BASE);

$SECRET = '/(^|\/)(config[^\/]*\.php|\.env[^\/]*|\.htaccess|\.user\.ini|[^\/]*\.(secret|pem|key|p12|pfx|cer|crt|sql|log|bak|old|orig|zip|gz|tar|rar|7z|swp|sqlite|db|md|lock))$|\/wallet-certs\/|\/invoices\//i';
$PUBLIC_PHP = '#^/(api/[^/]+\.php|[a-z0-9_-]+\.php)$#i';

// ---------------------------------------------------------------- 2. pages: headers, cookies, disclosure
out('PAGES');
$hdrMiss = [];
foreach ($urls as $path => $_) {
    $r = ask($BASE . $path); $counts['asked']++;
    if ($r['code'] === 429 || $r['code'] === 503 || $r['code'] === 0) { $counts['unknown']++; continue; }
    if ($r['code'] >= 300 && $r['code'] < 400) {
        $loc = hv($r, 'location');
        if (preg_match('#^https?://#i', $loc) && !preg_match('#^https?://(www\.|static\.)?sporta\.com\.kw#i', $loc)) finding('HIGH', $path, "redirects off the shop to $loc");
        continue;
    }
    if ($r['code'] !== 200) { if ($r['code'] >= 500) finding('MED', $path, 'server error ' . $r['code']); continue; }
    $ct = hv($r, 'content-type');
    if (stripos($ct, 'text/html') === false) continue;
    foreach (['strict-transport-security' => 'HSTS', 'x-content-type-options' => 'nosniff', 'referrer-policy' => 'Referrer-Policy', 'content-security-policy' => 'CSP'] as $k => $name)
        if (hv($r, $k) === '') $hdrMiss[$name][] = $path;
    if (hv($r, 'x-frame-options') === '' && stripos(hv($r, 'content-security-policy'), 'frame-ancestors') === false) $hdrMiss['frame protection'][] = $path;
    if (preg_match('#x-robots-tag:.*noindex#i', implode("\n", array_map(fn($k) => "$k: " . hv($r, $k), array_keys($r['headers'])))) && $path === '/') finding('HIGH', $path, 'the home page is noindex');
    foreach ($r['headers']['set-cookie'] ?? [] as $c) {
        $miss = [];
        if (stripos($c, 'secure') === false) $miss[] = 'Secure';
        if (stripos($c, 'httponly') === false) $miss[] = 'HttpOnly';
        if (stripos($c, 'samesite') === false) $miss[] = 'SameSite';
        finding($miss ? 'MED' : 'INFO', $path, 'sets a cookie' . ($miss ? ' missing ' . implode('+', $miss) : ' (flags ok)') . ' — the storefront was meant to set none');
    }
}
foreach ($hdrMiss as $name => $list) finding('MED', $list[0], "$name missing on " . count($list) . ' page(s)' . (count($list) > 1 ? ' e.g. ' . implode(' ', array_slice($list, 0, 3)) : ''));
$root = ask($BASE . '/');
foreach (['server', 'x-powered-by'] as $k) if (preg_match('#\d+\.\d+#', hv($root, $k))) finding('LOW', '/', "$k discloses a version: " . hv($root, $k));

// ---------------------------------------------------------------- 3. every file in the docroot
out('FILES');
$tally = [];
foreach ($files as $rel) {
    $url = $BASE . str_replace('%2F', '/', rawurlencode($rel));
    $isSecret = (bool) preg_match($SECRET, $rel);
    $isPhp = (bool) preg_match('/\.(php\d?|phtml|phar|inc)$/i', $rel);
    $r = ask($url, 'GET', [], 2048); $counts['asked']++;
    $c = $r['code'];
    if ($c === 0 || $c === 429 || $c === 503) { $counts['unknown']++; $tally['unknown'] = ($tally['unknown'] ?? 0) + 1; continue; }
    $tally[$c] = ($tally[$c] ?? 0) + 1;
    if ($c !== 200) continue;
    if (strncmp(ltrim($r['body']), '<?php', 5) === 0)
        finding('CRITICAL', $rel, 'answers with its own PHP SOURCE');
    elseif ($isSecret && $isPhp && trim($r['body']) === '') finding('LOW', $rel, 'a config-style PHP file is reachable and runs (prints nothing); it should be refused outright');
    elseif ($isSecret && !preg_match('#^/(robots\.txt|sitemap[^/]*\.xml)$#', $rel)) finding('HIGH', $rel, 'a secret-looking file answers 200');
    if (!$isPhp && stripos(hv($r, 'content-type'), 'text/html') !== false && !preg_match('#\.html?$#i', $rel) && $rel !== '/index.html') finding('LOW', $rel, 'non-html file served as text/html');
}
ksort($tally);
out('  status counts: ' . json_encode($tally));

// ---------------------------------------------------------------- 4. api scripts, asked bare
out('API-SCRIPTS (bare GET, no parameters)');
foreach ($files as $rel) {
    if (!preg_match('#^/api/[^/]+\.php$#i', $rel)) continue;
    $r = ask($BASE . $rel, 'GET', [], 600); $counts['asked']++;
    $c = $r['code'];
    if ($c === 0 || $c === 429 || $c === 503) { $counts['unknown']++; out("  ?    $rel unanswered/throttled"); continue; }
    $b = substr(trim($r['body']), 0, 90);
    $note = '';
    if ($c === 200 && !preg_match('#config|store\.php#', $rel)) {
        // 200 to a bare GET is fine for public routes; it is a finding only if the body is not JSON/HTML/PDF/XML we expect.
        if (preg_match('/(warning|fatal error|stack trace|parse error|undefined (variable|index|constant))/i', $b)) { $note = ' PHP ERROR TEXT'; finding('MED', $rel, 'leaks PHP error text: ' . preg_replace('/\s+/', ' ', $b)); }
    }
    if (preg_match('/(warning|fatal error|stack trace|on line \d+|\/home\/u\d+)/i', $r['body']) && $note === '') finding('MED', $rel, 'body shows an error or a server path');
    out(sprintf('  %-4d %-34s %s', $c, $rel, str_replace("\n", ' ', $b)));
}

// ---------------------------------------------------------------- 5. probes
out('PROBES');
$probe = [
    '/.env', '/.git/config', '/.git/HEAD', '/.svn/entries', '/.DS_Store', '/config.php', '/api/config.php', '/api/store.php', '/pay/config.php', '/knet/config.php',
    '/phpinfo.php', '/info.php', '/test.php', '/admin.php', '/wp-login.php', '/wp-admin/', '/xmlrpc.php', '/server-status', '/server-info',
    '/backup.zip', '/backup.sql', '/db.sql', '/site.zip', '/public_html.zip', '/storage/', '/storage/deploy.secret', '/invoices/', '/wallet-certs/', '/.htaccess', '/.user.ini',
    '/composer.json', '/composer.lock', '/package.json', '/package-lock.json', '/vendor/', '/node_modules/', '/README.md', '/CLAUDE.md', '/KNET.md',
    '/api/site-manifest.txt', '/api/seed.mysql.sql', '/api/schema.mysql.sql', '/api/cron-backup.php', '/api/deploy.php', '/api/file-audit.php',
    '/assets/', '/images/', '/images/_uploads/', '/api/', '/cats/', '/fonts/', '/hero/', '/pay/', '/knet/', '/assets/leaflet/',
    '/assets/..%2f..%2fconfig.php', '/assets/%2e%2e/%2e%2e/config.php', '/..%2f..%2fetc/passwd', '/api/api.php?r=../../config', '/api/invoice-file.php?id=../../config',
    '/index.php', '/seo.php', '/panel.php', '/default.php',
];
$listing = '/(<title>Index of|Parent Directory|<h1>Index of|Directory listing for)/i';
foreach ($probe as $p) {
    $r = ask($BASE . $p, 'GET', [], 4096); $counts['asked']++;
    $c = $r['code'];
    if ($c === 0 || $c === 429 || $c === 503) { $counts['unknown']++; out("  ?    $p unanswered/throttled"); continue; }
    $b = $r['body'];
    if ($c === 200) {
        if (preg_match($listing, $b)) finding('HIGH', $p, 'DIRECTORY LISTING');
        elseif (strncmp(ltrim($b), '<?php', 5) === 0) finding('CRITICAL', $p, 'answers with PHP SOURCE');
        elseif (preg_match('#^/(\.env|\.git|\.svn|\.DS_Store|config|api/config|api/store|pay/config|knet/config|storage|invoices|wallet-certs|\.htaccess|\.user\.ini|composer|package|vendor|node_modules|backup|db\.sql|site\.zip|public_html\.zip|api/seed|api/schema|api/site-manifest|\.\.|assets/\.\.|assets/%2e|api/api\.php\?r=\.\.|api/invoice-file\.php\?id=\.\.|CLAUDE|KNET|README)#i', $p)) {
            // the SPA shell answering 200 for an unknown path is not the file: only flag when it is not the app's HTML
            if (stripos($b, '<div id="root"') === false && stripos($b, '<!doctype html') === false) finding('HIGH', $p, "answers 200 (" . strlen($b) . "+ bytes) — should be refused");
        }
    }
    if ($c >= 500) finding('MED', $p, "server error $c on a probe");
    out(sprintf('  %-4d %s', $c, $p));
}
// methods
$t = ask($BASE . '/', 'TRACE'); $counts['asked']++;
if ($t['code'] === 200) finding('MED', '/', 'TRACE is enabled');
$o = ask($BASE . '/api/api.php?r=slides', 'OPTIONS', ['Origin' => 'https://evil.example', 'Access-Control-Request-Method' => 'POST']); $counts['asked']++;
$acao = hv($o, 'access-control-allow-origin');
if ($acao === '*' || stripos($acao, 'evil.example') !== false) finding('HIGH', '/api/api.php', "CORS allows a foreign origin: $acao");
$g = ask($BASE . '/api/api.php?r=slides', 'GET', ['Origin' => 'https://evil.example']); $counts['asked']++;
$acao2 = hv($g, 'access-control-allow-origin');
if ($acao2 === '*' || stripos($acao2, 'evil.example') !== false) finding('HIGH', '/api/api.php?r=slides', "CORS reflects a foreign origin: $acao2");
if (stripos(hv($g, 'access-control-allow-credentials'), 'true') !== false && $acao2 !== '') finding('HIGH', '/api/api.php', 'CORS allows credentials to ' . $acao2);
// open redirect and host-header injection
foreach (['//evil.example/', '/\\evil.example', '/%2f%2fevil.example', '/?next=//evil.example', '/payment/result?trackid=%0d%0aSet-Cookie:x=1'] as $p) {
    $r = ask($BASE . $p); $counts['asked']++;
    $loc = hv($r, 'location');
    if ($loc !== '' && preg_match('#evil\.example#i', $loc)) finding('HIGH', $p, "redirects to $loc");
    if (hv($r, 'set-cookie') !== '' && stripos($p, 'Set-Cookie') !== false) finding('HIGH', $p, 'header injection: a cookie was set from the URL');
}
$hh = @file_get_contents($BASE . '/', false, stream_context_create([
    'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    'http' => ['method' => 'GET', 'header' => "Host: evil.example\r\nX-Forwarded-Host: evil.example\r\n", 'timeout' => 6, 'ignore_errors' => true, 'follow_location' => 0],
]), 0, 60000);
if ($hh !== false && preg_match('#(canonical|og:url)[^>]*evil\.example#i', $hh)) finding('MED', '/', 'a forged Host / X-Forwarded-Host is reflected into the page (canonical or og:url)');
// plain http
$h = @file_get_contents('http://127.0.0.1/', false, stream_context_create(['http' => ['method' => 'GET', 'header' => "Host: $HOST\r\n", 'timeout' => 6, 'ignore_errors' => true, 'follow_location' => 0]]), 0, 512);
$hc = 0; $hl = '';
foreach (($http_response_header ?? []) as $line) { if (preg_match('#^HTTP/\S+ (\d{3})#', $line, $m)) $hc = (int) $m[1]; if (stripos($line, 'location:') === 0) $hl = trim(substr($line, 9)); }
if ($BASE === 'https://127.0.0.1') {
    out("  plain http: $hc -> $hl");
    if (!in_array($hc, [301, 302, 308], true) || stripos($hl, 'https://') !== 0) finding('HIGH', 'http://', "plain http is not redirected to https ($hc $hl)");
}

// ---------------------------------------------------------------- 6. verdict
$bySev = [];
foreach ($find as $f) $bySev[$f[0]] = ($bySev[$f[0]] ?? 0) + 1;
$real = array_filter($find, fn($f) => $f[0] !== 'INFO');
out('SUMMARY asked=' . $counts['asked'] . ' unknown=' . $counts['unknown'] . ' findings=' . json_encode($bySev ?: new stdClass));
out($counts['unknown'] > 0 ? 'VERDICT=' . (count($real) ? 'FINDINGS' : 'CLEAN') . '-BUT-' . $counts['unknown'] . '-UNANSWERED (throttled or timed out: not an all-clear for those)' : 'VERDICT=' . (count($real) ? 'FINDINGS' : 'CLEAN'));
out('DONE');
