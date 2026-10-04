<?php
/**
 * Create the site_images table on the LIVE database — the logo and the features band the owner
 * replaces from /backends (2026-10-04). Reads the PUBLISHED api/siteimages.mysql.sql, so run it
 * AFTER publish-all.php.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-site-images.php && php c.php
 *
 * ORDER IS NOT CRITICAL: until the table exists the pictures are the shipped files (any failure
 * falls back to them) and the panel card says the shop is not set up yet. IDEMPOTENT, reports STATE,
 * ADDS and NEVER DROPS.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php'; $sqlPath = $root . '/api/siteimages.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/siteimages.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$sql = (string) file_get_contents($sqlPath);
$body = trim(preg_replace('/--[^\n]*/', '', $sql));
if (stripos($body, 'create table if not exists site_images') !== 0 || preg_match('/\b(drop|delete|update|truncate|alter)\b/i', preg_replace('/on update current_timestamp/i', '', $body))) {
    line('api/siteimages.mysql.sql is not the expected statement — nothing done'); exit;
}
$c = require $cfgPath;
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec(rtrim($body, "; \n"));
    $has = $db->query("show tables like 'site_images'")->fetchColumn() !== false;
    $rows = $has ? (int) $db->query('select count(*) from site_images')->fetchColumn() : 0;
    line("STATE site_images=" . ($has ? 'yes' : 'no') . " rows=$rows");
    line($has ? 'READY — the Pictures card in /backends can save.' : 'NOT READY');
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
