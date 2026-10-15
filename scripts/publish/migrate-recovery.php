<?php
/**
 * Adds the recovery-email columns to admin_users on the live database (2026-10-15).
 * Runs api/recovery.mysql.sql as PUBLISHED on the server, so run it AFTER publish-all.php. The order
 * does not matter for safety: until it has run, password reset works exactly as before and the
 * Security card says the database is behind.
 *
 * Refuses a file that is not exactly one `alter table admin_users add column if not exists …` of the
 * five expected columns. Reports STATE (each column and its type), so a later run reads the same.
 *   wget -nv -O r.php <raw URL of this file at a full commit SHA> && php r.php
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php'; $sqlPath = $root . '/api/recovery.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/recovery.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$body = trim(preg_replace('/--[^\n]*/', '', (string) file_get_contents($sqlPath)));
$WANT = ['recovery_email' => 'varchar(190)', 'recovery_verified_at' => 'timestamp', 'recovery_code_hash' => 'varchar(255)',
         'recovery_code_expires' => 'timestamp', 'recovery_code_tries' => 'int(11)'];
$stmts = array_values(array_filter(array_map('trim', explode(';', $body))));
$ok = count($stmts) === 1 && preg_match('/^alter table admin_users\s+(.*)$/is', $stmts[0], $m)
   && !preg_match('/\b(drop|delete|update|truncate|create|modify|change|rename|insert|replace)\b/i', $body);
$seen = [];
if ($ok) foreach (explode(',', $m[1]) as $cl) {
    if (!preg_match('/^\s*add column if not exists (\w+)\s+(varchar\(\d+\)|timestamp|int)\s+(null(\s+default\s+null)?|not null default 0)\s*$/i', $cl, $c)
        || !isset($WANT[strtolower($c[1])]) || isset($seen[strtolower($c[1])])) { $ok = false; break; }
    $seen[strtolower($c[1])] = true;
}
if (!$ok || count($seen) !== count($WANT)) { line('api/recovery.mysql.sql is not the expected statement — nothing done'); exit; }
$c = require $cfgPath;
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    try { $db->exec($stmts[0]); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
    $parts = []; $have = 0;
    foreach ($WANT as $col => $type) {
        try { $row = $db->query("show columns from admin_users like '$col'")->fetch(PDO::FETCH_ASSOC); } catch (Throwable $e) { $row = false; }
        $got = $row ? strtolower((string) $row['Type']) : null;
        $match = $got === $type || ($type === 'int(11)' && $got === 'int');
        $have += $match ? 1 : 0;
        $parts[] = "$col=" . ($got === null ? 'no' : ($match ? 'yes' : "wrongtype($got)"));
    }
    line('STATE ' . implode(' ', $parts) . " columns=$have/" . count($WANT));
    line($have === count($WANT) ? 'READY — the recovery email card works.' : 'NOT READY');
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
