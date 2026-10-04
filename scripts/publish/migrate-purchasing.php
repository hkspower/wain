<?php
/**
 * Create the purchasing tables on the LIVE database (2026-10-04): suppliers, variant_supplier,
 * purchase_orders, purchase_order_items — from the PUBLISHED api/purchasing.mysql.sql. Run AFTER
 * publish-all.php. Order is not critical: without the tables the Purchasing card says the shop is not
 * set up yet and every purchasing route answers `purchasing_not_ready`; stock editing is untouched.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-purchasing.php && php c.php
 *
 * IDEMPOTENT, reports STATE, ADDS and NEVER DROPS.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php'; $sqlPath = $root . '/api/purchasing.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/purchasing.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$body = preg_replace('/--[^\n]*/', '', (string) file_get_contents($sqlPath));
if (preg_match_all('/\bcreate table if not exists\b/i', $body) !== 4 || preg_match('/\b(drop|delete|update|truncate|alter)\b/i', preg_replace('/on delete (cascade|set null)/i', '', $body))) {
    line('api/purchasing.mysql.sql is not the expected statements — nothing done'); exit;
}
$c = require $cfgPath;
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach (array_filter(array_map('trim', explode(';', $body))) as $stmt) $db->exec($stmt);
    $have = [];
    foreach (['suppliers', 'variant_supplier', 'purchase_orders', 'purchase_order_items'] as $t) $have[] = $db->query("show tables like '$t'")->fetchColumn() !== false ? 1 : 0;
    line('STATE tables=' . array_sum($have) . '/4');
    line(array_sum($have) === 4 ? 'READY — the Purchasing card in /backends can save.' : 'NOT READY');
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
