<?php
/**
 * The product banner above "Shop by category", as the live shop serves it — 2026-10-01.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-home-banner-check.php && php r.php
 *
 * READ-ONLY. Public URLs over the loopback (pinned with CURLOPT_RESOLVE) and one
 * SELECT of the banner's switch; it writes nothing and prints no credential.
 *
 * It reports STATE, the same on every run: whether the table exists and the
 * banner is on, what ?r=home_banner answers, whether that answer set a cookie
 * (the storefront sets none), and whether the home page and the panel's shell
 * carry the two scripts. A route that answers 200 with {"banner": null} is the
 * HEALTHY state of a shop that has not switched the banner on.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function get(string $path): array {
    $ch = curl_init('https://www.sporta.com.kw' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_TIMEOUT => 8, CURLOPT_USERAGENT => 'sporta-home-banner-check',
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $raw = is_string($raw) ? $raw : '';
    return [$code, substr($raw, 0, $hlen), substr($raw, $hlen)];
}

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$table = 'unknown'; $enabled = '-';
$c = @include $ROOT . '/api/config.php';
if (is_array($c)) {
    try {
        $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
            (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $table = $db->query("show tables like 'home_banner'")->fetchColumn() !== false ? 'yes' : 'no';
        if ($table === 'yes') {
            $v = $db->query('select enabled from home_banner where id = 1')->fetchColumn();
            $enabled = $v === false ? 'no-row' : ((int) $v ? 'on' : 'off');
        }
    } catch (Throwable $e) { $table = 'db-error'; }
}
line("TABLE home_banner=$table enabled=$enabled");

[$code, $head, $body] = get('/api/api.php?r=home_banner&x=' . time());
$cookie = preg_match('/^set-cookie:/mi', $head) ? 'SET' : 'none';
$j = json_decode($body, true);
$shape = !is_array($j) || !array_key_exists('banner', $j) ? 'NOT-THE-ROUTE'
    : ($j['banner'] === null ? 'null' : 'banner:' . substr((string) ($j['banner']['title']['en'] ?? ''), 0, 40));
line("ROUTE home_banner=$code/" . strlen($body) . " answer=$shape cookie=$cookie");

[$code2] = get('/api/api.php?r=home_banner_image&v=000000000000');
line("ROUTE home_banner_image(no picture)=$code2");

[$hc, , $home] = get('/?lang=en&x=' . time());
[$pc, , $panel] = get('/backends?x=' . time());
line('HOME ' . $hc . '/' . strlen($home) . ' script=' . (strpos($home, '/assets/home-banner.js') !== false ? 'yes' : 'NO')
    . ' editorOnShop=' . (strpos($home, 'home-banner-editor.js') !== false ? 'LEAKED' : 'no'));
line('PANEL ' . $pc . '/' . strlen($panel) . ' editor=' . (strpos($panel, '/assets/home-banner-editor.js') !== false ? 'yes' : 'NO'));

[$cc, , $css] = get('/assets/sporta-ui.css?x=' . time());
[$jc, , $js] = get('/assets/home-banner.js?x=' . time());
[$ec, , $ed] = get('/assets/home-banner-editor.js?x=' . time());
line('ASSETS css=' . $cc . (strpos($css, '.sporta-home-banner__link') !== false ? '/has-banner-rules' : '/NO-banner-rules')
    . ' js=' . $jc . '/' . strlen($js) . ' editor=' . $ec . '/' . strlen($ed));
