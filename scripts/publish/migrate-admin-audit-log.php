<?php
// 2026-10-03: the live database lacks admin_audit_log (found by live-schema-full.php). admin.php writes a
// row per panel save and reads the list for the activity screen, so without the table that log is empty.
// The statement is database-sql/11-admin-audit-log.sql verbatim: create-if-not-exists only, never drops.
// Safe to run twice; reports STATE.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
try {
    $db = store_db();
    $db->exec("create table if not exists admin_audit_log (
      id           int unsigned auto_increment primary key,
      admin_id     int unsigned null,
      admin_email  varchar(120) not null,
      route        varchar(64) not null,
      status_code  smallint unsigned not null,
      summary      text null,
      created_at   timestamp not null default current_timestamp
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci");
    $db->exec('create index if not exists idx_audit_created on admin_audit_log (created_at)');
    $cols = $db->query("select count(*) from information_schema.columns where table_schema = database() and table_name = 'admin_audit_log'")->fetchColumn();
    echo 'STATE admin_audit_log columns=' . $cols . '/7 rows=' . $db->query('select count(*) from admin_audit_log')->fetchColumn() . "\n";
} catch (Throwable $e) { echo 'STATE error=' . $e->getMessage() . "\n"; }
