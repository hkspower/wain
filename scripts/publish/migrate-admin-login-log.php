<?php
/**
 * Create the admin_login_log table on the LIVE database — the admin sign-in log (and its country cache) for /backends. 2026-09-30.
 *
 *   wget -nv -O m.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-admin-login-log.php && php m.php
 *
 * ORDER IS NOT CRITICAL: until the table exists logging is best-effort and silent until the tables exist, so sign-in is
 * unaffected either way; the Security card says the log is not set up. IDEMPOTENT, ADDS ONLY, and
 * it reports STATE (table present, rows) so a per-minute job's last output
 * reads the same on every run.
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
} catch (Throwable $e) { line('database unreachable: ' . $e->getMessage()); exit; }

// Exactly as api/adminloginlog.mysql.sql carries it.
$sqls = [
"create table if not exists admin_login_log (
  id            bigint unsigned not null auto_increment,
  at            timestamp    not null default current_timestamp,
  admin_id      int unsigned null,
  email         varchar(190) null,
  method        varchar(16)  not null,
  result        varchar(40)  not null,
  ip            varchar(45)  not null,
  country       varchar(2)   null,
  country_name  varchar(80)  null,
  new_ip        tinyint(1)   not null default 0,
  agent         varchar(160) null,
  primary key (id),
  key idx_login_log_at (at),
  key idx_login_log_ip (ip, at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci",
"create table if not exists admin_ip_geo (
  ip            varchar(45) not null,
  country       varchar(2)  null,
  country_name  varchar(80) null,
  looked_up_at  timestamp   not null default current_timestamp,
  primary key (ip)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci"
];
foreach ($sqls as $sql) { try { $db->exec($sql); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); } }

$has = 'no'; $rows = '?';
try { $has = $db->query("show tables like 'admin_login_log'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $rows = (string) $db->query('select count(*) from admin_login_log')->fetchColumn(); } catch (Throwable $e) {}
line("STATE admin_login_log=$has rows=$rows");
line($has === 'yes' ? 'READY — sign-ins are logged from now on.' : 'NOT READY — the panel card will say so.');
