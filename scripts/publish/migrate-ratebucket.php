<?php
/**
 * Create rate_bucket on the LIVE database (2026-10-07) from the PUBLISHED api/ratebucket.mysql.sql. Run AFTER
 * publish-all.php. Order is not critical: until the table exists store_throttle() falls back to the old fixed-window
 * rate_limit counter, so nothing is refused or broken in between.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-ratebucket.php && php c.php
 *
 * IDEMPOTENT, reports STATE, ADDS and NEVER DROPS.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php'; $sqlPath = $root . '/api/ratebucket.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/ratebucket.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$body = preg_replace('/--[^\n]*/', '', (string) file_get_contents($sqlPath));
if (preg_match_all('/\bcreate table if not exists\b/i', $body) !== 1 || preg_match('/\b(drop|delete|update|truncate|alter)\b/i', $body)) {
    line('api/ratebucket.mysql.sql is not the expected statement — nothing done'); exit;
}
$c = require $cfgPath;
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach (array_filter(array_map('trim', explode(';', $body))) as $stmt) $db->exec($stmt);
    $have = $db->query("show tables like 'rate_bucket'")->fetchColumn() !== false ? 1 : 0;
    $rows = $have ? (int) $db->query('select count(*) from rate_bucket')->fetchColumn() : 0;
    line("STATE rate_bucket=$have rows=$rows");
    line($have ? 'READY — the API limiter is now a token bucket.' : 'NOT READY');
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
