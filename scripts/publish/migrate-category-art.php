<?php
/**
 * Create the category_art table on the LIVE database — the home tiles the owner
 * replaces from /backends. 2026-09-29.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-category-art.php && php c.php
 *
 * ORDER IS NOT CRITICAL, unlike migrate-customers.php: until the table exists
 * the tile route serves the shipped files (any failure falls back to them), the
 * panel card says the shop is not set up yet, and admin.php refuses a save with
 * `cat_art_not_ready`. Nothing breaks either way; the card just cannot save.
 *
 * IDEMPOTENT, and it reports STATE rather than its own verb, so a per-minute
 * job's last-run output reads the same on every run. It ADDS and NEVER DROPS.
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

// Exactly as api/categoryart.mysql.sql carries it.
$sql = "create table if not exists category_art (
  tile        varchar(16)  not null,
  variant     varchar(16)  not null,
  fmt         varchar(4)   not null,
  bytes       mediumblob   not null,
  etag        char(32)     not null,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp,
  primary key (tile, variant, fmt),
  constraint cat_art_tile_ck    check (tile in ('men','women','accessories','outlet')),
  constraint cat_art_variant_ck check (variant in ('desktop','mobile','desktop-rtl','mobile-rtl')),
  constraint cat_art_fmt_ck     check (fmt in ('webp','jpg'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci";
try { $db->exec($sql); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }

$has = 'no'; $rows = '?';
try { $has = $db->query("show tables like 'category_art'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $rows = (string) $db->query('select count(*) from category_art')->fetchColumn(); } catch (Throwable $e) {}
line("STATE category_art=$has rows=$rows");
line($has === 'yes' ? 'READY — the panel can save tile pictures.' : 'NOT READY — the panel card will say so.');
