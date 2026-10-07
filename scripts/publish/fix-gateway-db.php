<?php
/**
 * Point the payment endpoints at the shop's working orders database (2026-10-07, owner: "Yes, fix both").
 *
 * pay/config.php and knet/config.php each carry their own mysql_* login, and the server refuses it (error 1045), so
 * the gateways cannot read the saved /backends settings (test mode is ignored) or look up an order's amount. Both
 * files are built to INHERIT api/config.php when those four values are empty, so the fix is to empty them.
 *
 *   wget -qO f.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/fix-gateway-db.php && php f.php
 *
 * SAFE BY CONSTRUCTION:
 *  - a file is touched ONLY if its own login FAILS to connect; a working login is left alone;
 *  - the old file is copied first to config.php.bak-YYYYmmdd-HHMMSS (0600);
 *  - only the four 'mysql_host|name|user|pass' values change; no payment credential or other setting is read or written;
 *  - the result is re-included and must still be an array with the four values empty, or the backup is put back;
 *  - IDEMPOTENT, and it prints STATE only (never a value).
 */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$api = @include $ROOT . '/api/config.php';
if (!is_array($api)) { line('REFUSED api/config.php unreadable — nothing changed'); return; }
try { new PDO("mysql:host={$api['db_host']};dbname={$api['db_name']};charset=utf8mb4", $api['db_user'], $api['db_pass'], [PDO::ATTR_TIMEOUT => 5]); }
catch (Throwable $e) { line('REFUSED the shop login in api/config.php does not connect either — nothing changed'); return; }
foreach (['pay/config.php', 'knet/config.php'] as $rel) {
    $path = "$ROOT/$rel";
    $c = @include $path;
    if (!is_array($c)) { line("$rel UNREADABLE — left alone"); continue; }
    $own = array_filter(['host', 'name', 'user', 'pass'], fn ($k) => (string) ($c['mysql_' . $k] ?? '') !== '');
    if (!$own) { line("$rel STATE own-login=none (inherits api/config.php)"); continue; }
    $ok = false;
    try { new PDO("mysql:host={$c['mysql_host']};dbname={$c['mysql_name']};charset=utf8mb4", (string) $c['mysql_user'], (string) $c['mysql_pass'], [PDO::ATTR_TIMEOUT => 5]); $ok = true; } catch (Throwable $e) {}
    if ($ok) { line("$rel STATE own-login=works — left alone"); continue; }
    $src = file_get_contents($path);
    $bak = $path . '.bak-' . date('Ymd-His');
    if ($src === false || file_put_contents($bak, $src) === false) { line("$rel REFUSED could not write the backup — nothing changed"); continue; }
    @chmod($bak, 0600);
    $new = preg_replace('/([\'"]mysql_(?:host|name|user|pass)[\'"]\s*=>\s*)(?:\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")/', "$1''", $src, -1, $n);
    if ($new === null || $n !== 4) { line("$rel REFUSED expected 4 values, matched " . (int) $n . " — nothing changed"); @unlink($bak); continue; }
    if (file_put_contents($path, $new) === false) { line("$rel REFUSED could not write — nothing changed"); continue; }
    @chmod($path, 0600);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    $r = @include $path;
    $empty = is_array($r) && !array_filter(['host', 'name', 'user', 'pass'], fn ($k) => (string) ($r['mysql_' . $k] ?? '') !== '');
    if (!$empty) { copy($bak, $path); @chmod($path, 0600); line("$rel ROLLED-BACK result did not verify; backup restored"); continue; }
    line("$rel FIXED values-emptied=4 backup=" . basename($bak));
}
