<?php
/**
 * Create the product_attrs table on the LIVE database — a product's colour and
 * fits, picked in /backends (Catalogue screen). 2026-09-29.
 *
 *   wget -nv -O m.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-product-attrs.php && php m.php
 *
 * ORDER IS NOT CRITICAL: until the table exists the card says the shop is not
 * set up yet and admin.php refuses a save with `product_attrs_not_ready`;
 * nothing else reads the table, so nothing breaks. IDEMPOTENT, ADDS ONLY, and
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

// Exactly as api/productattrs.mysql.sql carries it.
$sql = "create table if not exists product_attrs (
  slug        varchar(80)  not null,
  colour      varchar(32)  null,
  fits        varchar(120) null,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp,
  primary key (slug)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci";
try { $db->exec($sql); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }

$has = 'no'; $rows = '?';
try { $has = $db->query("show tables like 'product_attrs'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $rows = (string) $db->query('select count(*) from product_attrs')->fetchColumn(); } catch (Throwable $e) {}
line("STATE product_attrs=$has rows=$rows");
line($has === 'yes' ? 'READY — the Catalogue card can save colour, fits and sizes.' : 'NOT READY — the panel card will say so.');
