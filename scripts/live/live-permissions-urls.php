<?php
/**
 * Which of the "secret-looking" files in public_html can actually be FETCHED over HTTP? READ-ONLY.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-permissions-urls.php && php r.php
 *
 * live-permissions-full.php reports world-READABLE secret-looking files, and a file mode is not a
 * URL: .htaccess may well refuse them. This asks the server the real question, over the loopback
 * (so it works whether or not the public name resolves) with the Host header, for every such file
 * inside public_html, and reports the status code. A 200 is a leak; 403/404 is the rule holding.
 * It prints status codes and paths only, never a body, and sends GETs only.
 *
 * It also lists, by top-level folder, what the secret-looking files OUTSIDE public_html are, so a
 * pile of false positives (vendor config*.php in a trash folder) can be told from a real one.
 */
// A SLOW SCRIPT ON A PER-MINUTE JOB OVERLAPS ITSELF, and every overlapping run adds requests that
// keep the shop's rate limiter hot — so it never finishes and reports nothing. So: one run at a time
// (a flock; a second run exits at once) and the answer goes to ~/perm-urls.txt, which a separate
// `cat` job reads. Delete both jobs when it is read.
$lock = fopen('/home/u130124229/perm-urls.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit(0);
ob_start();
$ROOT = '/home/u130124229/domains/sporta.com.kw';
$DOC = $ROOT . '/public_html';
$RE = '/(^|\/)(config[^\/]*\.php|\.env[^\/]*|[^\/]*\.(secret|pem|key|p12|pfx|cer|crt|sql|log|bak|old|orig|zip|gz|tar|rar|7z|swp|sqlite|db))$|\/wallet-certs\/|\/invoices\//i';

$files = [];
$stack = [$DOC];
while ($stack) {
    $d = array_pop($stack);
    foreach ((@scandir($d) ?: []) as $i) {
        if ($i === '.' || $i === '..') continue;
        $f = "$d/$i";
        if (is_link($f)) continue;
        if (is_dir($f)) { $stack[] = $f; continue; }
        if (preg_match($RE, $f)) $files[] = substr($f, strlen($DOC));
    }
}
sort($files);
echo 'URLS candidates=' . count($files) . "\n";

$ctx = stream_context_create([
    'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true, 'peer_name' => 'www.sporta.com.kw'],
    'http' => ['method' => 'GET', 'header' => "Host: www.sporta.com.kw\r\n", 'timeout' => 5, 'ignore_errors' => true, 'follow_location' => 0],
]);
$by = [];
foreach ($files as $rel) {
    // 429 is the shop's own rate limiter answering, not an answer about the file: wait and ask again
    // (a throttled probe reads exactly like a protected file, which is the failure this guards).
    for ($try = 0; $try < 4; $try++) {
        $h = @file_get_contents('https://127.0.0.1' . str_replace('%2F', '/', rawurlencode($rel)), false, $ctx, 0, 64);
        $code = 0;
        foreach (($http_response_header ?? []) as $line) if (preg_match('#^HTTP/\S+ (\d{3})#', $line, $m)) $code = (int) $m[1];
        if ($code !== 429 && $code !== 503) break;
        sleep(8);
    }
    $by[$code][] = $rel;
    usleep(700000);
}
ksort($by);
foreach ($by as $code => $list) {
    echo "  $code x" . count($list) . ($code === 200 ? '  LEAK: ' . implode(' ; ', array_slice($list, 0, 12)) : '  e.g. ' . implode(' ; ', array_slice($list, 0, 3))) . "\n";
}

// outside public_html: top-level folder of each secret-looking, world-readable file
$out = [];
$stack = [$ROOT];
while ($stack) {
    $d = array_pop($stack);
    foreach ((@scandir($d) ?: []) as $i) {
        if ($i === '.' || $i === '..') continue;
        $f = "$d/$i";
        if ($f === $DOC || is_link($f)) continue;
        if (is_dir($f)) { $stack[] = $f; continue; }
        if (preg_match($RE, $f) && (@fileperms($f) & 0004)) {
            $rel = substr($f, strlen($ROOT) + 1);
            $top = strtok($rel, '/');
            if ($top === '.trash') $top = '.trash';
            $out[$top] = ($out[$top] ?? 0) + 1;
            if (strpos($rel, '/') === false || preg_match('/\.(zip|gz|tar|rar|7z|sql|log|bak|pem|key|secret|env)/i', $rel)) $ex[$top][] = $rel . '=' . substr(sprintf('%o', fileperms($f)), -4);
        }
    }
}
arsort($out);
foreach ($out as $top => $n) echo "OUTSIDE $top x$n" . (!empty($ex[$top]) ? '  ' . implode(' ; ', array_slice($ex[$top], 0, 6)) : '') . "\n";
file_put_contents('/home/u130124229/perm-urls.txt', ob_get_clean() . 'DONE ' . date('H:i:s') . "\n");
