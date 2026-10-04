<?php
/**
 * Create admin_sessions and admin_passkeys on the LIVE database (2026-10-04) from the PUBLISHED
 * api/security.mysql.sql. Run AFTER publish-all.php. Order is not critical: until the tables exist
 * store_session_admin() treats every session as alive (fail-open), passkey routes answer
 * `passkeys_not_ready`, and the Sign-in security card says so. Nobody is signed out by this.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-security.php && php c.php
 *
 * IDEMPOTENT, reports STATE, ADDS and NEVER DROPS.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php'; $sqlPath = $root . '/api/security.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/security.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$body = preg_replace('/--[^\n]*/', '', (string) file_get_contents($sqlPath));
if (preg_match_all('/\bcreate table if not exists\b/i', $body) !== 2 || preg_match('/\b(drop|delete|update|truncate|alter)\b/i', preg_replace('/on delete cascade/i', '', $body))) {
    line('api/security.mysql.sql is not the expected statements — nothing done'); exit;
}
$c = require $cfgPath;
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach (array_filter(array_map('trim', explode(';', $body))) as $stmt) $db->exec($stmt);
    $have = 0; foreach (['admin_sessions', 'admin_passkeys'] as $t) $have += $db->query("show tables like '$t'")->fetchColumn() !== false ? 1 : 0;
    line("STATE tables=$have/2");
    line($have === 2 ? 'READY — passkeys and the session list work; existing sessions are adopted on their next request.' : 'NOT READY');
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
