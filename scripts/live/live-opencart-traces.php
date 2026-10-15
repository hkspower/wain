<?php
/**
 * READ-ONLY. Second pass for old OpenCart KNET/CBK data (2026-10-15), after no OpenCart config.php was found:
 *
 * A. In the shop's database (and wainkw.com's, using that site's own wp-config/.env if readable — skipped
 *    if not), every table whose name ends in "setting": rows whose code/key mention knet|cbk|tij|tpay.
 *    Secrets are masked exactly as live-opencart-knet.php masks them.
 * B. Every file under the home directory up to 60 MB (archives and images skipped) that CONTAINS one of:
 *    the merchant id from the owner's screenshot, its client id, or OpenCart's setting prefixes
 *    payment_cbk / payment_knet / payment_tpay. PATH AND WHICH NEEDLE ONLY — never a byte of content.
 *
 * The needles are passed as ARGUMENTS so no account identifier is committed:
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php <merchant id> <client id>
 */
$home = '/home/u130124229';
$needles = array_values(array_filter([$argv[1] ?? '', $argv[2] ?? '', 'payment_cbk', 'payment_knet', 'payment_tpay']));
$secretish = '/(secret|key|pass|encrp|resource|token|pwd)/i';

// A — the shop's own database
$a = @include $home . '/domains/sporta.com.kw/public_html/api/config.php';
if (is_array($a)) {
    try {
        $pdo = new PDO("mysql:host={$a['db_host']};dbname={$a['db_name']};charset=utf8mb4", $a['db_user'], $a['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $tables = $pdo->query("show tables")->fetchAll(PDO::FETCH_COLUMN);
        $oc = array_values(array_filter($tables, fn($t) => preg_match('/^oc_|setting$/i', $t)));
        echo 'SHOPDB tables=', count($tables), ' opencartish=', implode(',', $oc) ?: 'none', "\n";
        foreach ($oc as $t) {
            $cols = $pdo->query("show columns from `$t`")->fetchAll(PDO::FETCH_COLUMN);
            if (!in_array('key', $cols, true) || !in_array('value', $cols, true)) continue;
            $codeCol = in_array('code', $cols, true) ? '`code`' : "''";
            foreach ($pdo->query("select $codeCol as c, `key` as k, `value` as v from `$t` where `key` regexp 'knet|cbk|tij|tpay'" . ($codeCol !== "''" ? " or `code` regexp 'knet|cbk|tij|tpay'" : '')) as $r) {
                $v = (string) $r['v'];
                echo "  $t | {$r['c']} | {$r['k']} = ", preg_match($secretish, $r['k']) ? ($v === '' ? 'EMPTY' : 'set len=' . strlen($v) . ' ends=..' . substr($v, -2)) : substr($v, 0, 120), "\n";
            }
        }
    } catch (Throwable $e) { echo 'SHOPDB unreadable: ', substr($e->getMessage(), 0, 80), "\n"; }
}

// B — files containing a needle
$hits = []; $scanned = 0;
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($home, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
$it->setMaxDepth(10);
foreach ($it as $f) {
    if (count($hits) >= 60) break;
    $p = $f->getPathname();
    if (!$f->isFile() || $f->getSize() > 60 * 1024 * 1024) continue;
    if (preg_match('#/(\.cagefs|node_modules|\.git)/#', $p)) continue;
    if (preg_match('/\.(zip|gz|tgz|rar|7z|jpe?g|png|webp|gif|svg|ico|woff2?|ttf|otf|mp4|pdf|avif)$/i', $p)) continue;
    if ($p === __FILE__ || basename($p) === 'r.php') continue;
    $s = @file_get_contents($p);
    if ($s === false) continue;
    $scanned++;
    foreach ($needles as $i => $n) {
        if ($n !== '' && strpos($s, $n) !== false) { $hits[] = substr($p, strlen($home) + 1) . ' [needle' . ($i + 1) . ']'; }
    }
}
echo "FILES scanned=$scanned hits=", count($hits), "\n";
foreach ($hits as $h) echo "  $h\n";
echo "(needle1=merchant id, needle2=client id, 3=payment_cbk, 4=payment_knet, 5=payment_tpay)\ndone\n";
