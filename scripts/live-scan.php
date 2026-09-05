<?php
/**
 * A full scan of the LIVE shop, run ON the live server.
 *
 *   php /home/<user>/live-scan.php
 *
 * WHY IT IS A SCRIPT ON THE SERVER rather than a rig here. Everything in
 * scripts/ that scans the site drives it over HTTP from this checkout, and this
 * environment's egress policy refuses www.sporta.com.kw — so none of them can
 * see production. The cron channel can, but it carries one short command and
 * returns only the LAST LINE of the output, which is enough for one number and
 * not for a scan. This runs everything in one process and prints one line.
 *
 * It is READ-ONLY. It requests pages, reads file sizes and runs SELECTs. There
 * is no statement here that writes, and there must never be: it is fetched over
 * plain HTTP from a public repository by a cron job, so anything it can do,
 * anyone who can influence that fetch can do.
 *
 * IT PRINTS NO SECRET. It reads api/config.php because that is where the
 * database credentials live, and it prints only counts and yes/no answers.
 *
 * The loopback is not a detail either: the server cannot resolve its own
 * domain (see CLAUDE.md), so every request here goes to 127.0.0.1 with the
 * host in a header, over https because port 80 answers with a redirect.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$HOST = 'www.sporta.com.kw';

/** One loopback request. Returns [status, bytes, headers]. */
function get(string $path, string $host): array
{
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => ['Host: ' . $host],
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    $raw = curl_exec($ch);
    if ($raw === false) { curl_close($ch); return [0, 0, '']; }
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hlen   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [$status, strlen($raw) - $hlen, substr($raw, 0, $hlen)];
}

$fail = [];

// ---------------------------------------------------------------- 1. pages
// A page that answers 200 with almost nothing in it is not a working page —
// this is a single-page app, so the shell is ~38 kB and anything much under
// that means the server sent an error document with a 200 on it.
$pages = ['/', '/shop', '/cart', '/track', '/returns', '/about', '/contact', '/privacy', '/terms'];
$pagesOk = 0;
foreach ($pages as $p) {
    [$s, $n] = get($p, $HOST);
    if ($s === 200 && $n > 20000) $pagesOk++;
    else $fail[] = "page$p=$s/$n";
}

// ------------------------------------------------------------------ 2. api
$apiOk = 0;
foreach (['products', 'brands', 'slides'] as $r) {
    [$s, $n] = get('/api/api.php?r=' . $r, $HOST);
    if ($s === 200 && $n > 2) $apiOk++;
    else $fail[] = "api:$r=$s/$n";
}

// ------------------------------------------------------------- 3. security
// Each of these must NOT come back with its contents. A 403 or 404 is right;
// a 200 carrying bytes is a credential, a schema or a repository on display.
$secret = [
    '/api/config.php',
    '/api/schema.mysql.sql',
    '/.git/config',
    '/api/store.php',
];
$secOk = 0;
foreach ($secret as $p) {
    [$s, $n] = get($p, $HOST);
    if ($s === 403 || $s === 404 || $n === 0) $secOk++;
    else $fail[] = "OPEN$p=$s/$n";
}

// ---------------------------------------------------------------- 4. cache
// The seven fixed-name files under /assets must revalidate. They carry every
// correction made since the build and a stale one is a half-applied site.
$fixed = ['sporta-ui.css', 'sporta-dark.css', 'contact.js', 'card.js',
          'returns-link.js', 'returns-request.js', 'track-guard.js'];
$cacheOk = 0;
foreach ($fixed as $f) {
    [$s, , $h] = get('/assets/' . $f, $HOST);
    if ($s === 200 && stripos($h, 'no-cache') !== false) $cacheOk++;
    else $fail[] = "cache:$f=" . $s . (stripos($h, 'max-age') !== false ? '/max-age' : '');
}

// ----------------------------------------------------------------- 5. files
// Present and non-empty. sw.js is listed because a truncated service worker
// is the one file that can pin every other file.
$want = ['index.html', 'sw.js', 'config.js', '.htaccess',
         'assets/sporta-ui.css', 'api/api.php', 'api/store.php', 'api/config.php'];
$filesOk = 0;
foreach ($want as $f) {
    $p = $ROOT . '/' . $f;
    if (is_file($p) && filesize($p) > 0) $filesOk++;
    else $fail[] = "file:$f";
}

// -------------------------------------------------------------------- 6. db
$db = 'unreachable';
$qa = '?';
$cfg = @include $ROOT . '/api/config.php';
if (is_array($cfg)) {
    try {
        $pdo = new PDO(
            "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
            $cfg['db_user'], $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
        );
        $p = (int) $pdo->query('select count(*) from products where active = 1')->fetchColumn();
        $o = (int) $pdo->query('select count(*) from orders')->fetchColumn();
        $v = (int) $pdo->query('select count(*) from product_variants')->fetchColumn();
        // A garment with no size rows shows no size to pick and cannot be
        // ordered. db-audit.php reports this against a checkout; here it is
        // asked of the shop that is actually taking money.
        $nov = (int) $pdo->query(
            'select count(*) from products p where p.active = 1 and not exists' .
            ' (select 1 from product_variants v where v.slug = p.slug)'
        )->fetchColumn();
        // NAME them, not just count them. "19 products cannot be ordered" is a
        // number to worry about; the list is a thing the owner can act on, and
        // it is what says whether a repair written for 15 garments covers them.
        $novList = $pdo->query(
            'select p.slug from products p where p.active = 1 and not exists' .
            ' (select 1 from product_variants v where v.slug = p.slug) order by p.slug'
        )->fetchAll(PDO::FETCH_COLUMN);
        $db = "{$p}p/{$o}o/{$v}v/nosize={$nov}";
        // The one table the سبورتا AI answers come from. Absent is not an
        // error — the feature fails closed and silently — but it is the
        // difference between "nobody asked" and "it cannot answer".
        $qa = $pdo->query("show tables like 'assistant_qa'")->fetchColumn() ? 'yes' : 'MISSING';

        // WHAT WOULD GO OUT IF THE DORMANT CRON JOBS WERE RESTARTED.
        //
        // Three of them — whatsapp, customer-mail, fulfilment — were left on
        // the broken domain form on purpose (see CLAUDE.md): each drains an
        // outbox, and a queue that has been dead for months sends its whole
        // backlog to real people the moment it runs. sent_at IS NULL is the
        // row that has not gone yet, so this is the number that decides
        // whether repairing those jobs is safe or is a mailshot.
        $pend = [];
        foreach (['whatsapp_outbox' => 'wa', 'customer_mail_outbox' => 'mail',
                  'fulfilment_outbox' => 'ful'] as $t => $label) {
            try {
                $n = (int) $pdo->query("select count(*) from `$t` where sent_at is null")->fetchColumn();
                $a = (int) $pdo->query("select count(*) from `$t`")->fetchColumn();
                $pend[] = "$label=$n/$a";
            } catch (Throwable $e) { $pend[] = "$label=?"; }
        }
        $qa .= ' pending=' . implode(',', $pend);
    } catch (Throwable $e) {
        $db = 'error';
        $fail[] = 'db';
    }
} else {
    $fail[] = 'config';
}

// ------------------------------------------------------------------ report
// ONE LINE, because cron returns only the last one. Failures are named rather
// than counted: a scan that says "3 problems" and not which ones is a scan you
// have to run again.
echo 'SCAN'
   . ' pages=' . $pagesOk . '/' . count($pages)
   . ' api=' . $apiOk . '/3'
   . ' sec=' . $secOk . '/' . count($secret)
   . ' cache=' . $cacheOk . '/' . count($fixed)
   . ' files=' . $filesOk . '/' . count($want)
   . ' db=' . $db
   . ' qa=' . $qa
   . ' php=' . PHP_VERSION
   . ' | ' . ($fail ? 'PROBLEMS: ' . implode(' ', array_slice($fail, 0, 12)) : 'no problems')
   . (isset($novList) && $novList ? "\nNOSIZE " . implode(',', $novList) : '')
   . "\n";
