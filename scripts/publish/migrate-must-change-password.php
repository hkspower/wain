<?php
/**
 * Add admin_users.must_change_password to the LIVE database.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/migrate-must-change-password.php && php r.php
 *
 * The one-line ALTER from sporta-site/database-sql/10-must-change-password.sql,
 * run directly through store_db() rather than fetched as a .sql file and
 * imported — there is no import tool reachable from cron, and one ALTER does
 * not need one. `add column if not exists` is idempotent, same as the file
 * it mirrors: safe to run twice, safe to run before or after the code that
 * depends on it (the column merely goes unused until admin.php and store.php
 * are published).
 *
 * MUST land before (or in the same breath as) publish-must-change-password-code.php.
 * The new admin.php/store.php read and write this column on every gated
 * admin request; publishing the code first would fatal every /backends
 * request with an unknown-column error until this runs.
 */

require_once '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';

$db = store_db();
$db->exec("alter table admin_users add column if not exists must_change_password tinyint(1) not null default 0");

$check = $db->query("show columns from admin_users like 'must_change_password'")->fetch();

echo 'MIGRATE-MUST-CHANGE-PASSWORD column=' . ($check ? 'present' : 'MISSING')
   . ' type=' . ($check['Type'] ?? 'n/a')
   . ' default=' . ($check['Default'] ?? 'n/a')
   . "\n";
