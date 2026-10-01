<?php
/**
 * A GENTLE LOAD TEST of the live shop, run ON the server. Read-only.
 *
 *   php /home/<user>/live-load-test.php
 *
 * It sends ordinary GET requests — the pages and the product list a shopper loads — in four
 * stages of rising concurrency (1, 5, 10, 15 at once) and prints, per stage and per page, how
 * many answered, how many errored or were refused by the shop's own rate limiter (429/503), and
 * the median, 95th-percentile and slowest time in milliseconds. It signs in to nothing, places
 * no order and writes nothing; about 240 requests in all, over roughly half a minute — the
 * traffic of a busy minute, not an attack.
 *
 * It goes to https://127.0.0.1 with a Host header (see CLAUDE.md: the server cannot always
 * resolve its own name), so it measures the ORIGIN — LiteSpeed and PHP — and not the CDN in
 * front of it. A shopper's real path is a little faster for cached files and the same for PHP.
 *
 * It is fetched from a public repository by a cron job, so it must stay read-only and must
 * never be pointed at anything but the shop itself.
 */
$HOST = 'www.sporta.com.kw';
$PAGES = [
    'home'     => '/?lang=en',
    'products' => '/api/api.php?r=products',
    'shop'     => '/shop?lang=en',
    'men'      => '/men',
    'css'      => '/assets/sporta-ui.css',
];

function run_stage(array $urls, int $conc, string $host): array
{
    $mh = curl_multi_init();
    $res = [];            // name => list of [status, ms]
    $queue = $urls;       // list of [name, path]
    $active = [];
    $start = function () use (&$queue, &$active, $mh, $host) {
        $job = array_shift($queue);
        if (!$job) return;
        $ch = curl_init('https://127.0.0.1' . $job[1]);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER => ['Host: ' . $host, 'Accept-Encoding: gzip', 'User-Agent: sporta-load-test'],
            CURLOPT_TIMEOUT => 25, CURLOPT_ENCODING => '',
        ]);
        curl_multi_add_handle($mh, $ch);
        $active[(int) $ch] = [$ch, $job[0]];
    };
    for ($i = 0; $i < $conc; $i++) $start();
    do {
        curl_multi_exec($mh, $running);
        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle'];
            [$h, $name] = $active[(int) $ch];
            $res[$name][] = [(int) curl_getinfo($ch, CURLINFO_HTTP_CODE), curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000, $info['result']];
            curl_multi_remove_handle($mh, $ch); curl_close($ch); unset($active[(int) $ch]);
            $start();
        }
        if ($running) curl_multi_select($mh, 0.2);
    } while ($running || $queue);
    curl_multi_close($mh);
    return $res;
}

function pct(array $v, float $p): int
{
    sort($v);
    if (!$v) return 0;
    return (int) round($v[min(count($v) - 1, (int) floor($p * count($v)))]);
}

foreach ([1 => 10, 5 => 15, 10 => 20, 15 => 30] as $conc => $each) {
    $urls = [];
    for ($i = 0; $i < $each; $i++) foreach ($PAGES as $name => $path) $urls[] = [$name, $path];
    shuffle($urls);
    $t0 = microtime(true);
    $r = run_stage($urls, $conc, $HOST);
    $wall = microtime(true) - $t0;
    $line = [];
    $all = 0; $bad = 0;
    foreach ($PAGES as $name => $_) {
        $rows = $r[$name] ?? [];
        $ok = 0; $lim = 0; $err = 0; $ms = [];
        foreach ($rows as [$code, $t, $curl]) {
            $ms[] = $t; $all++;
            if ($curl !== 0 || $code >= 500 && $code !== 503 || $code === 0) { $err++; $bad++; }
            elseif ($code === 429 || $code === 503) { $lim++; $bad++; }
            elseif ($code >= 200 && $code < 400) $ok++;
            else { $err++; $bad++; }
        }
        $line[] = sprintf('%s ok=%d/%d lim=%d err=%d p50=%d p95=%d max=%d', $name, $ok, count($rows), $lim, $err,
            pct($ms, 0.5), pct($ms, 0.95), $ms ? (int) round(max($ms)) : 0);
    }
    echo sprintf("C%d reqs=%d bad=%d wall=%.1fs rps=%.1f | %s\n", $conc, $all, $bad, $wall, $all / max($wall, 0.001), implode(' | ', $line));
    flush();
    usleep(800000);
}
echo "DONE\n";
