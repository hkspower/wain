<?php
/**
 * Config, storage and URL behaviour, measured on the live server.
 *
 *   php /home/<user>/live-config-url.php
 *
 * READ-ONLY. Reads files, runs SELECTs against information_schema, and makes
 * loopback requests. It writes nothing, and it is fetched over plain HTTP from
 * a public repository, so that is a property rather than a preference.
 *
 * IT PRINTS NO SECRET. It reads api/config.php — that is where the database
 * password, the cron key and the bank credentials live — and prints only the
 * NAMES of keys that are empty. A name says "this feature is unconfigured";
 * a value would be the credential itself.
 *
 * The loopback carries the host in a header because the server cannot resolve
 * its own domain, and the redirect tests need FOLLOWLOCATION off or every one
 * of them answers 200 from the page it lands on.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$HOST = 'www.sporta.com.kw';

function head(string $path, string $host): array
{
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_NOBODY         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => ['Host: ' . $host],
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $raw  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $loc  = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);
    return [$code, $loc];
}

// ------------------------------------------------------------------ config
$out = [];

$cfg = @include $ROOT . '/api/config.php';
if (is_array($cfg)) {
    $empty = [];
    foreach ($cfg as $k => $v) {
        if ($v === '' || $v === null) $empty[] = $k;
    }
    $out[] = 'apiKeys=' . count($cfg) . ' empty=' . (count($empty) ? implode(',', $empty) : 'none');
} else {
    $out[] = 'apiKeys=UNREADABLE';
}

// The public site config. These four decide where the shop talks to; they are
// served to every visitor so nothing here is a secret.
$js = @file_get_contents($ROOT . '/config.js');
if ($js !== false) {
    $pick = function (string $key) use ($js): string {
        return preg_match('/' . $key . '\s*:\s*([^,\n]+)/', $js, $m) ? trim($m[1]) : '?';
    };
    $out[] = 'siteCfg pay=' . $pick('payBaseUrl') . ' cbk=' . $pick('cbkBaseUrl')
           . ' api=' . $pick('phpApiUrl') . ' tpay=' . $pick('tpayEnabled');
}

foreach (['knet', 'pay'] as $gw) {
    $g = @include $ROOT . '/' . $gw . '/config.php';
    if (is_array($g)) {
        // NAME them, for the same reason api/config.php's are named: "16 keys,
        // one empty" is a number to worry about, and the name is a thing the
        // owner can act on -- it says whether the gap is a credential the bank
        // has not issued yet or a setting nobody filled in. Still names only.
        $blank = [];
        foreach ($g as $k => $v) if ($v === '' || $v === null) $blank[] = $k;
        $out[] = $gw . 'Cfg=' . count($g) . 'keys empty='
               . (count($blank) ? implode(',', $blank) : 'none');
    } else {
        $out[] = $gw . 'Cfg=MISSING';
    }
}

// ----------------------------------------------------------------- storage
$bytes = 0; $files = 0;
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($ROOT, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::SELF_FIRST
);
foreach ($it as $f) { if ($f->isFile()) { $bytes += $f->getSize(); $files++; } }
$out[] = 'docroot=' . round($bytes / 1048576, 1) . 'MB/' . $files . 'files';

if (is_array($cfg)) {
    try {
        $pdo = new PDO(
            "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
            $cfg['db_user'], $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
        );
        $q = $pdo->prepare(
            'select round(sum(data_length + index_length) / 1048576, 1)' .
            ' from information_schema.tables where table_schema = ?'
        );
        $q->execute([$cfg['db_name']]);
        $out[] = 'db=' . (float) $q->fetchColumn() . 'MB';
    } catch (Throwable $e) { $out[] = 'db=?'; }
}

// --------------------------------------------------------------------- url
// Each of these must move the visitor exactly once. A shop that answers 200 on
// two spellings of the same page is two pages to a crawler.
$urls = [
    ['/index.html', $HOST, 301],
    ['/shop/',      $HOST, 301],
    ['/admin',      $HOST, 302],
    ['/shop',       $HOST, 200],
];
$urlOk = 0; $urlBad = [];
foreach ($urls as [$p, $h, $want]) {
    [$code] = head($p, $h);
    if ($code === $want) $urlOk++; else $urlBad[] = $p . '=' . $code . '(want' . $want . ')';
}
// The bare domain must land on www, in ONE hop.
[$bareCode, $bareLoc] = head('/', 'sporta.com.kw');
$bareOk = ($bareCode === 301 && str_starts_with($bareLoc, 'https://www.sporta.com.kw'));
$out[] = 'urls=' . $urlOk . '/' . count($urls)
       . ' bare=' . ($bareOk ? 'ok' : $bareCode . '/' . ($bareLoc ?: 'no-location'))
       . (count($urlBad) ? ' BAD:' . implode(',', $urlBad) : '');

echo 'CFG ' . implode(' | ', $out) . "\n";
