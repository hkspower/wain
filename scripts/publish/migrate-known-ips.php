<?php
/**
 * Create admin_known_ips on the LIVE database — the table the new
 * "security alert for any unknown login" feature reads and writes.
 *
 *   wget -qO k.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-known-ips.php && php k.php
 *
 * MUST RUN BEFORE api/store.php IS PUBLISHED, same ordering reason
 * migrate-customers.php gives for itself — except this one degrades safely
 * rather than failing outright if the order is ever reversed:
 * store_admin_alert_new_ip() wraps its whole body in try/catch and treats a
 * missing table exactly like must_change_password and email OTP before it —
 * a sign-in succeeding is what matters, the alert is a record of it, never a
 * precondition. Publishing this migration first still means the feature is
 * live from the moment the code lands, rather than silently doing nothing on
 * every sign-in until somebody notices the table is missing.
 *
 * IDEMPOTENT. `create table if not exists` does nothing on a second run, and
 * the output reports STATE rather than its own verb, for the same reason
 * migrate-customers.php's own header gives: a per-minute cron job's captured
 * output is the LAST run's, and "I created it" read a minute later is
 * indistinguishable from a path that was always wrong.
 *
 * ADDS AND NEVER DROPS. No existing table, column or row is touched.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }

try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) {
    line('database unreachable: ' . $e->getMessage());
    exit;
}

// Exactly as sporta-site/database-sql/12-known-login-ips.sql carries it —
// repeated here rather than fetched, so this migration has only one way to
// half-happen.
try {
    $db->exec(
        "create table if not exists admin_known_ips (
            admin_id   int unsigned not null,
            ip         varchar(45) not null,
            first_seen timestamp not null default current_timestamp,
            last_seen  timestamp not null default current_timestamp,
            primary key (admin_id, ip),
            constraint fk_known_ip_admin foreign key (admin_id)
              references admin_users (id) on delete cascade
        ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci"
    );
} catch (Throwable $e) {
    line('create table failed: ' . $e->getMessage());
    exit;
}

$exists = (int) $db->query(
    "select count(*) from information_schema.tables
      where table_schema = database() and table_name = 'admin_known_ips'"
)->fetchColumn();

line('STATE admin_known_ips=' . ($exists ? 'yes' : 'no'));
line($exists ? 'READY — api/store.php may be published now.' : 'NOT READY — table missing after create attempt.');
