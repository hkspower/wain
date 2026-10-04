<?php
/**
 * Live tracking on the LIVE database (2026-10-04): orders.packed_at/shipped_at/courier/courier_ref, the
 * order_location table, and 'packed'/'delivered' as WhatsApp kinds — from the published
 * api/livetrack.mysql.sql (one home for the schema).
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-livetrack.php && php c.php
 *
 * RUN IT AFTER publish-all.php, and the ORDER MATTERS THIS TIME: the published admin.php writes
 * packed_at/shipped_at on every status change, so marking an order packed against the old table is a
 * 500 in /backends until this has run. Run it in the same minute as the publish. Adds and never
 * drops data (the one DROP is the whatsapp kind CHECK, re-added wider on the next line). Reports STATE.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php';
$sqlPath = $root . '/api/livetrack.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/livetrack.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$sql = (string) file_get_contents($sqlPath);
$body = preg_replace('/--[^\n]*/', '', $sql);
if (stripos($body, 'create table if not exists order_location') === false
    || preg_match('/\b(delete|truncate|update|drop\s+table)\b/i', $body)
    || preg_match_all('/\balter\s+table\s+orders\s+add\s+column\s+if\s+not\s+exists\b/i', $body) !== 4
    || stripos($body, "check (kind in ('confirmed','packed','shipped','delivered','review'))") === false) {
    line('api/livetrack.mysql.sql is not the expected statements — nothing done');
    exit;
}
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) { line('database unreachable: ' . $e->getMessage()); exit; }

foreach (array_filter(array_map('trim', explode(';', $body))) as $stmt) {
    if (stripos($stmt, 'set names') === 0) continue;
    try { $db->exec($stmt); } catch (Throwable $e) { line('FAILED: ' . substr($stmt, 0, 60) . ' — ' . $e->getMessage()); }
}
$cols = 0; $tbl = 'no'; $kinds = '?';
try { foreach (['packed_at', 'shipped_at', 'courier', 'courier_ref'] as $k) if ($db->query("show columns from orders like '$k'")->fetchColumn() !== false) $cols++; } catch (Throwable $e) {}
try { $tbl = $db->query("show tables like 'order_location'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try {
    $ck = (string) $db->query("select check_clause from information_schema.check_constraints where constraint_schema = database() and constraint_name = 'wa_kind_ck'")->fetchColumn();
    $kinds = str_contains($ck, 'packed') && str_contains($ck, 'delivered') ? '5' : '3';
} catch (Throwable $e) {}
line("STATE orderColumns=$cols/4 order_location=$tbl whatsappKinds=$kinds");
line($cols === 4 && $tbl === 'yes' ? 'READY — /backends can mark steps and mint driver links.' : 'NOT READY — do not mark orders in /backends until this is fixed.');
