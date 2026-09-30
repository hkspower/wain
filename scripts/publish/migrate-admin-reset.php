<?php
/**
 * Create the admin_password_resets table on the LIVE database — password reset codes for /backends. 2026-09-30.
 *
 *   wget -nv -O m.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-admin-reset.php && php m.php
 *
 * ORDER IS NOT CRITICAL: until the table exists the reset routes answer as if no account matched, so nothing breaks; the
 * forgot-password form just cannot succeed. IDEMPOTENT, ADDS ONLY, and
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

// Exactly as api/adminreset.mysql.sql carries it.
$sql = "create table if not exists admin_password_resets (
  admin_id    int unsigned not null,
  code_hash   varchar(255) not null,
  attempts    tinyint unsigned not null default 0,
  created_at  timestamp    not null default current_timestamp,
  expires_at  datetime     not null,
  primary key (admin_id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci";
try { $db->exec($sql); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }

$has = 'no'; $rows = '?';
try { $has = $db->query("show tables like 'admin_password_resets'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $rows = (string) $db->query('select count(*) from admin_password_resets')->fetchColumn(); } catch (Throwable $e) {}
line("STATE admin_password_resets=$has rows=$rows");
line($has === 'yes' ? 'READY — forgot-password by email works.' : 'NOT READY — the panel card will say so.');
