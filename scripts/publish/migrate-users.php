<?php
/**
 * Add the Users page's six columns on the LIVE database (2026-10-08) from the PUBLISHED
 * api/users.mysql.sql. Run AFTER publish-all.php. Order is not critical: until the columns exist every
 * sign-in and every signed-in session works as before (the code reads them with `select *` and a
 * missing one means "not set"), and the Users screen's routes answer `users_not_ready`.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-users.php && php c.php
 *
 * IDEMPOTENT, reports STATE, ADDS and NEVER DROPS. It refuses a file that is anything but the two
 * `alter table … add column if not exists` statements it was written for: an ALTER is a wider verb
 * than the `create table if not exists` the other migrators allow, so the shape is checked whole
 * rather than trusted — which tables, in which order, and every clause against the exact column and
 * type it must add, as a nullable column with no default but null.
 *
 * THE COLUMNS, NOT ONLY THE VERBS (2026-10-14, review). The first version checked that every clause
 * was an ADD COLUMN IF NOT EXISTS and stopped there, so a file adding a SEVENTH column, a NOT NULL
 * one with a default (a rewrite of every row of a live table), a UNIQUE one or a varchar(1) ran and
 * then reported READY 6/6 — STATE looked only at the names. Now the six are the only clauses
 * accepted, and STATE reads each column's TYPE back, so a column a different file added under the
 * right name with the wrong type reads `wrongtype`, not yes.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php'; $sqlPath = $root . '/api/users.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/users.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$body = preg_replace('/--[^\n]*/', '', (string) file_get_contents($sqlPath));
$stmts = array_values(array_filter(array_map('trim', explode(';', $body))));
// The six columns, by table, with the type each must have. One home for the shape check and STATE.
$WANT = ['customers'   => ['blocked_at' => 'timestamp', 'blocked_reason' => 'varchar(200)', 'blocked_by' => 'varchar(120)', 'signed_out_at' => 'timestamp'],
         'admin_users' => ['disabled_at' => 'timestamp', 'added_by' => 'varchar(120)']];
$tables = array_keys($WANT);
// Exactly two statements, on exactly these two tables, in this order, and every clause in them
// exactly `add column if not exists <one of the six> <its type> null [default null]` — so no NOT
// NULL, no other default, no UNIQUE or KEY or REFERENCES, no column that is not on the list, none
// twice. Anything else — a drop, a modify, a third statement, a seventh column — and nothing runs.
$shapeOk = count($stmts) === 2
    && !preg_match('/\b(drop|delete|update|truncate|create|modify|change|rename|insert|replace)\b/i', $body);
$seen = [];
if ($shapeOk) {
    foreach ($stmts as $i => $s) {
        if (!preg_match('/^alter table (\w+)\s+(.*)$/is', $s, $m) || strtolower($m[1]) !== $tables[$i]) { $shapeOk = false; break; }
        foreach (explode(',', $m[2]) as $cl) {
            if (!preg_match('/^\s*add column if not exists (\w+)\s+(timestamp|varchar\(\d+\))\s+null(?:\s+default\s+null)?\s*$/i', $cl, $c)) { $shapeOk = false; break 2; }
            $key = $tables[$i] . '.' . strtolower($c[1]);
            if (($WANT[$tables[$i]][strtolower($c[1])] ?? null) !== strtolower($c[2]) || isset($seen[$key])) { $shapeOk = false; break 2; }
            $seen[$key] = true;
        }
    }
}
if ($shapeOk && count($seen) !== 6) $shapeOk = false;   // a clause missing is a different file too
if (!$shapeOk) { line('api/users.mysql.sql is not the expected statements — nothing done'); exit; }
$c = require $cfgPath;
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach ($stmts as $stmt) {
        // Named, not swallowed: customers is created by migrate-customers.php, and a shop that never
        // ran it would fail the first statement here — the STATE line below says which half is missing.
        try { $db->exec($stmt); } catch (Throwable $e) { line('FAILED: ' . substr($stmt, 0, 24) . '… — ' . $e->getMessage()); }
    }
    $parts = []; $have = 0; $total = 0;
    foreach ($WANT as $t => $cols) foreach ($cols as $col => $type) {
        $total++;
        // The TYPE is read back too: `add column if not exists` leaves a column of the same name alone
        // whatever its type, so the name alone would call a varchar(1) blocked_reason ready.
        try { $q = $db->query("show columns from `$t` like '$col'"); $row = $q ? $q->fetch(PDO::FETCH_ASSOC) : false; } catch (Throwable $e) { $row = false; }
        $got = $row ? strtolower((string) $row['Type']) : null;
        $have += $got === $type ? 1 : 0;
        $parts[] = "$t.$col=" . ($got === null ? 'no' : ($got === $type ? 'yes' : "wrongtype($got)"));
    }
    line('STATE ' . implode(' ', $parts) . " columns=$have/$total");
    line($have === $total ? 'READY — the Users screen can block, sign out and switch off accounts.' : 'NOT READY');
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
