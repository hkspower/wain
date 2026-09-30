<?php
/**
 * What is in the web root that the repository does not know about — and can a
 * stranger fetch it?
 *
 *   php /home/<user>/live-stray-check.php
 *
 * READ-ONLY. It lists names and sizes and asks the server for each one over the
 * loopback. It prints no file CONTENT.
 *
 * WHY live-file-check CANNOT ANSWER THIS. That one walks a manifest: for every
 * path the repository tracks it reports same, differ or missing, plus a short
 * $MUSTNOT list of names that must never appear. Both halves are lists written
 * in advance — so a file nobody thought of is invisible to it. A stray upload,
 * a leftover from a hand-over, or a backup a publisher wrote itself is exactly
 * the file that is not on either list.
 *
 * The .htaccess deny block already carries this lesson about UPLOAD-THIS.txt:
 * "a note like that will be written again... this denies the EXTENSION and
 * names the exceptions, rather than denying the filename and waiting to be
 * surprised". This is the same idea aimed at the directory instead of the rule.
 *
 * WHAT IT REPORTS. Every file in the docroot's top level that the repository
 * does not track, and for each one whether the live server SERVES it — because
 * a stray file that 403s is untidy, and a stray file that 200s is a leak.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

// What the repository tracks at the top level, as of the commit this file was
// fetched from. Written out rather than derived: this script runs on a server
// with no checkout to compare against.
$KNOWN = [
    '.htaccess', 'apple-touch-icon.png', 'card.html', 'config.js', 'default.php',
    'favicon-192.png', 'favicon-32.png', 'favicon-maskable.png', 'favicon.ico',
    'favicon.png', 'index.html', 'llms.txt', 'logo-white.png', 'logo-white.webp',
    'logo.png', 'logo.webp', 'og-image.png', 'returns-request.html', 'robots.txt',
    'seo.php', 'site.webmanifest', 'sitemap-pages.xml', 'sitemap-products.xml',
    'sitemap.xml', 'sw.js',
];

/** Status and byte count for a path, as the live server answers it. */
$serve = static function (string $name): string {
    $ch = curl_init('https://127.0.0.1/' . rawurlencode($name));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    // 200 with the SPA shell is the catch-all answering, not the file — those
    // are the same length every time and are not a leak.
    return $code . ($code === 200 ? '/' . strlen($body) . 'B' : '');
};

$strays = [];
foreach (scandir($ROOT) ?: [] as $name) {
    if ($name === '.' || $name === '..') continue;
    if (!is_file($ROOT . '/' . $name)) continue;
    if (in_array($name, $KNOWN, true)) continue;
    $strays[] = $name . '(' . round(filesize($ROOT . '/' . $name) / 1024) . 'kB,' . $serve($name) . ')';
}

echo 'STRAY topLevelUntracked=' . count($strays)
   . ($strays ? ' ' . implode(' ', $strays) : '')
   . "\n";
