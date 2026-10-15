<?php
/**
 * READ-ONLY. Finds old OpenCart installs on the account and reads ONLY their KNET / CBK payment settings,
 * asked for by the owner on 2026-10-15 ("scan any knet data from old opencart").
 *
 * 1. Walks the home directory for OpenCart config files (config.php defining DB_DATABASE and DIR_APPLICATION)
 *    and prints each one's path, database name and table prefix — NEVER the password.
 * 2. Connects with that file's own credentials and reads `<prefix>setting` rows whose code or key mentions
 *    knet, cbk, tij or tpay.
 * 3. SECRETS ARE MASKED: any key that looks like a secret (secret, key, pass, encrp, resource, token) is
 *    printed as set/empty + length + its last two characters. Only plainly non-secret keys (urls, modes,
 *    status, titles, ids) are printed in full.
 *
 * Nothing is written anywhere.
 *   wget -nv -O r.php <raw URL at a full commit SHA> && php r.php
 */
$home = '/home/u130124229';
$configs = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($home, FilesystemIterator::SKIP_DOTS | FilesystemIterator::FOLLOW_SYMLINKS), RecursiveIteratorIterator::SELF_FIRST);
$it->setMaxDepth(8);
foreach ($it as $f) {
    $p = $f->getPathname();
    if (preg_match('#/(node_modules|vendor|\.cagefs|cache|image|storage/cache|logs?)/#', $p)) continue;
    if (!$f->isFile() || $f->getFilename() !== 'config.php' || $f->getSize() > 20000) continue;
    $src = @file_get_contents($p);
    if ($src === false || strpos($src, 'DB_DATABASE') === false || strpos($src, 'DIR_APPLICATION') === false) continue;
    $c = [];
    foreach (['DB_HOSTNAME', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE', 'DB_PREFIX', 'DB_PORT'] as $k) {
        if (preg_match("/define\(\s*'$k'\s*,\s*'((?:[^'\\\\]|\\\\.)*)'/", $src, $m)) $c[$k] = stripslashes($m[1]);
    }
    $configs[$p] = $c;
}
echo 'OPENCART configs=', count($configs), "\n";
$secretish = '/(secret|key|pass|encrp|resource|token|pwd)/i';
$seenDb = [];
foreach ($configs as $p => $c) {
    $db = $c['DB_DATABASE'] ?? '?'; $px = $c['DB_PREFIX'] ?? 'oc_';
    echo 'CONFIG ', substr($p, strlen($home) + 1), ' db=', $db, ' prefix=', $px, "\n";
    if (isset($seenDb[$db . $px])) { echo "  (same database as above)\n"; continue; }
    $seenDb[$db . $px] = 1;
    try {
        $pdo = new PDO('mysql:host=' . ($c['DB_HOSTNAME'] ?? 'localhost') . ';port=' . ($c['DB_PORT'] ?? '3306') . ';dbname=' . $db . ';charset=utf8mb4',
            $c['DB_USERNAME'] ?? '', $c['DB_PASSWORD'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]);
    } catch (Throwable $e) { echo "  database: cannot connect (", substr($e->getMessage(), 0, 60), ")\n"; continue; }
    try {
        $q = $pdo->query("select `code`, `key`, `value` from `{$px}setting`
                           where `code` regexp 'knet|cbk|tij|tpay' or `key` regexp 'knet|cbk|tij|tpay'
                           order by `code`, `key`");
        $n = 0;
        foreach ($q as $r) {
            $n++;
            $v = (string) $r['value'];
            $shown = preg_match($secretish, $r['key'])
                ? ($v === '' ? 'EMPTY' : 'set len=' . strlen($v) . ' ends=..' . substr($v, -2))
                : (strlen($v) > 120 ? substr($v, 0, 120) . '…' : $v);
            echo '  ', $r['code'], ' | ', $r['key'], ' = ', $shown, "\n";
        }
        echo "  rows=$n\n";
        // Any recorded KNET/CBK transactions? Count only.
        foreach ($pdo->query("show tables like '{$px}%'")->fetchAll(PDO::FETCH_COLUMN) as $t) {
            if (preg_match('/knet|cbk|tpay/i', $t)) echo '  table ', $t, ' rows=', (int) $pdo->query("select count(*) from `$t`")->fetchColumn(), "\n";
        }
    } catch (Throwable $e) { echo "  settings: unreadable (", substr($e->getMessage(), 0, 60), ")\n"; }
}
echo "done\n";
