<?php
/**
 * Apple Wallet live updates on the LIVE database (2026-10-03): wallet_passes.auth_token and the
 * wallet_registrations table, from the published api/walletweb.mysql.sql (one home for the schema).
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-wallet-web.php && php c.php
 *
 * RUN IT AFTER publish-all.php. Order is otherwise not critical: wallet.php issues a static card
 * (no update service) while the column is missing. Adds and never drops; reports STATE.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php';
$sqlPath = $root . '/api/walletweb.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/walletweb.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$sql = (string) file_get_contents($sqlPath);
$body = preg_replace('/--[^\n]*/', '', $sql);
if (stripos($body, 'create table if not exists wallet_registrations') === false
    || preg_match('/\b(drop|delete|truncate|update)\b/i', $body)
    || preg_match_all('/\balter\s+table\b/i', $body) !== 1 || stripos($body, 'add column if not exists auth_token') === false) {
    line('api/walletweb.mysql.sql is not the expected statements — nothing done');
    exit;
}
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) { line('database unreachable: ' . $e->getMessage()); exit; }

foreach (array_filter(array_map('trim', explode(';', $body))) as $stmt) {
    try { $db->exec($stmt); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
}
$col = 'no'; $tbl = 'no'; $regs = '?';
try { $col = $db->query("show columns from wallet_passes like 'auth_token'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $tbl = $db->query("show tables like 'wallet_registrations'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $regs = (string) $db->query('select count(*) from wallet_registrations')->fetchColumn(); } catch (Throwable $e) {}
line("STATE auth_token=$col wallet_registrations=$tbl registrations=$regs");
line($col === 'yes' && $tbl === 'yes' ? 'READY — new cards carry the update service.' : 'NOT READY — cards are issued without live updates.');
