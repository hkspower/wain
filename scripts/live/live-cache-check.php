<?php
/**
 * What Cache-Control the LIVE server sends for every kind of file it serves.
 *
 *   php /home/<user>/live-cache-check.php
 *
 * READ-ONLY. It makes GET requests and prints response headers. Nothing here
 * writes, which matters because it is fetched over plain HTTP from a public
 * repository by a cron job.
 *
 * WHY IT ASKS THE SERVER RATHER THAN READING .htaccess. Recorded in CLAUDE.md
 * after it cost an afternoon: the repository's copy of a rule is not evidence
 * about the server. A restore rolled .htaccess back 8 kB once and the file in
 * git kept claiming a rule the live site had never had. Ask what header comes
 * back.
 *
 * THE CATEGORIES MATTER MORE THAN THE FILES. There are only four kinds of
 * thing here and each wants a different answer:
 *
 *   content-hashed (index-TIUCmnwm.css)  immutable, a year, never revalidated
 *   fixed-name code (sporta-ui.css)      no-cache — the name never changes, so
 *                                        a cached copy CAN be stale
 *   the shell (/, /index.html)           no-cache — a deploy has to be picked
 *                                        up on the next visit
 *   the worker (sw.js)                   no-cache — the one file that, if
 *                                        cached, freezes every other file
 *
 * One line, because cron returns only the last one.
 */

$HOST = 'www.sporta.com.kw';

function cc(string $path, string $host): string
{
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_NOBODY         => false,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => ['Host: ' . $host],
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $raw = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    if ($code !== 200) return $code . '!';
    $head = substr($raw, 0, $hlen);
    if (!preg_match('/^Cache-Control:\s*(.+)$/mi', $head, $m)) return 'NONE';
    // Compressed to fit one line: the distinction that matters is
    // revalidate-vs-not and how long, not the exact spelling.
    $v = strtolower(trim($m[1]));
    if (str_contains($v, 'no-store'))  return 'no-store';
    if (str_contains($v, 'no-cache'))  return 'no-cache';
    if (preg_match('/max-age=(\d+)/', $v, $a)) {
        $s = (int) $a[1];
        return 'max-age=' . ($s >= 86400 ? intdiv($s, 86400) . 'd' : $s . 's')
             . (str_contains($v, 'immutable') ? '+imm' : '');
    }
    return $v;
}

$paths = [
    'shell'     => '/',
    'indexhtml' => '/index.html',
    'sw'        => '/sw.js',
    'configjs'  => '/config.js',
    'manifest'  => '/site.webmanifest',
    'hashedcss' => '/assets/index-TIUCmnwm.css',
    'uicss'     => '/assets/sporta-ui.css',
    'darkcss'   => '/assets/sporta-dark.css',
    'cardjs'    => '/assets/card.js',
    'favico'    => '/favicon.ico',
    'fav32'     => '/favicon-32.png',
    'maskable'  => '/favicon-maskable.png',
    'logo'      => '/logo.webp',
    'heroimg'   => '/hero/desktop/bodybuilding-men.webp',
    'catimg'    => '/cats/desktop/art-accessories.webp',
    'font'      => '/fonts/alexandria-var-latin.woff2',
    'api'       => '/api/api.php?r=products',
];

$out = [];
foreach ($paths as $label => $p) $out[] = $label . '=' . cc($p, $HOST);
echo 'CACHE ' . implode(' ', $out) . "\n";
