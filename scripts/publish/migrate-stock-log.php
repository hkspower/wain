<?php
/**
 * Create the stock_log table on the LIVE database — a product's colour and
 * fits, picked in /backends (Catalogue screen). 2026-09-29.
 *
 *   wget -nv -O m.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-product-attrs.php && php m.php
 *
 * ORDER IS NOT CRITICAL: until the table exists every write of a history row is best-effort and swallowed,
 * so orders and stock edits work either way; the card says the history is not set up. IDEMPOTENT, ADDS ONLY, and
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

// Exactly as api/stocklog.mysql.sql carries it.
$sql = "create table if not exists stock_log (
  id           bigint unsigned not null auto_increment,
  at           timestamp       not null default current_timestamp,
  sku          varchar(30)     not null,
  slug         varchar(80)     not null,
  size         varchar(4)      not null,
  delta        int             not null,
  stock_after  int             null,
  reason       varchar(24)     not null,
  actor        varchar(80)     null,
  ref          varchar(40)     null,
  primary key (id),
  key idx_stock_log_slug (slug, id),
  key idx_stock_log_at (at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci";
try { $db->exec($sql); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }

$has = 'no'; $rows = '?';
try { $has = $db->query("show tables like 'stock_log'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $rows = (string) $db->query('select count(*) from stock_log')->fetchColumn(); } catch (Throwable $e) {}
line("STATE stock_log=$has rows=$rows");
line($has === 'yes' ? 'READY — stock changes are recorded from now on.' : 'NOT READY — the panel card will say so.');
