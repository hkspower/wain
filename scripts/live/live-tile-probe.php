<?php
/**
 * Is the category-tile name bridge really gone from the live server?
 *
 * READ-ONLY. It fetches four URLs over the loopback and prints statuses and
 * byte counts. No configuration value is printed.
 *
 * WHY IT EXISTS. Publishing the .htaccess that removes the bridge reported
 * `plainName=STILL-BRIDGED` — /cats/desktop/men.jpg was still answering with an
 * image. The bytes had landed (sha256 verified after the write), so the
 * question is whether the SERVER is still applying the old rule: LiteSpeed
 * caches, and /cats/ is sent with max-age=86400 plus a month of
 * stale-while-revalidate, so a cached response can outlive the rule that made
 * it. This asks the same URL three ways to tell those apart:
 *
 *   plain            what a browser would get
 *   ?cachebust=      a URL the cache has never seen
 *   no-cache header  a request that asks for a fresh one
 *
 * If the cache-busted URL is not an image and the plain one is, the rule is
 * gone and a cached copy is the only thing left — which expires on its own and
 * needs nothing done. If ALL THREE are images, the rule is still in force and
 * the file on disk is not the file being read.
 */
$root = '/home/u130124229/domains/sporta.com.kw/public_html';

$ask = static function (string $path, array $headers = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $headers),
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return [$code, strpos($type, 'image/') === 0 ? 'image' : 'not-image', strlen($body)];
};

[$c1, $t1, $b1] = $ask('/cats/desktop/men.jpg');
[$c2, $t2, $b2] = $ask('/cats/desktop/men.jpg?cachebust=' . bin2hex(random_bytes(4)));
[$c3, $t3, $b3] = $ask('/cats/desktop/men.jpg', ['Cache-Control: no-cache', 'Pragma: no-cache']);
[$c4, $t4, $b4] = $ask('/cats/desktop/art-men.jpg');

// And what the file on disk actually says, which is the other half of the
// question: a rule cannot be in force if the line is not there.
$ht = @file_get_contents($root . '/.htaccess');
$hasRule = $ht !== false && strpos($ht, 'art-$2$3.$4') !== false;

echo 'TILEPROBE plain=' . $c1 . '/' . $t1 . '/' . $b1
   . ' cachebust=' . $c2 . '/' . $t2 . '/' . $b2
   . ' nocache=' . $c3 . '/' . $t3 . '/' . $b3
   . ' realName=' . $c4 . '/' . $t4 . '/' . $b4
   . ' ruleInFile=' . ($hasRule ? 'STILL-THERE' : 'gone')
   . ' htaccessBytes=' . (is_file($root . '/.htaccess') ? filesize($root . '/.htaccess') : 0)
   . "\n";
