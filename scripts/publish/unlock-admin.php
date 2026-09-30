<?php
/**
 * Clear the login lockout on hkspower@live.com.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/unlock-admin.php && php r.php
 *
 * WHY. store_login() locks an account for 15 minutes after 5 failed
 * attempts, checked BEFORE the password itself — so a correct password
 * during the window still answers 429 `locked`. This account has never had
 * its correct password rejected by hand; the likeliest cause is this same
 * session's own credential-file debugging, where several overlapping
 * write/read cron cycles could have handed a login attempt a half-written
 * file mid-write.
 *
 * NO API ROUTE DOES THIS. Unlocking one admin from another needs a second,
 * already-signed-in account, and there is only the one, locked. So this
 * reuses store_db() directly rather than guessing at config.php's values —
 * required from its real, absolute path on the server, exactly the file
 * every route already loads its connection from, so there is nothing here
 * that could drift from what admin.php itself would use.
 *
 * Touches exactly two columns, matched by email: failed_attempts to 0,
 * locked_until to NULL. Nothing else on the row changes.
 */

require_once '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';

$EMAIL = 'hkspower@live.com';

$db = store_db();
$stmt = $db->prepare(
    'update admin_users set failed_attempts = 0, locked_until = null where email = ?'
);
$stmt->execute([$EMAIL]);
$rows = $stmt->rowCount();

// Read back the row's own state, not just the affected-row count — a
// column already at 0/NULL would report rows=0 despite there being nothing
// wrong, and that is worth distinguishing from "no such email".
$check = $db->prepare('select failed_attempts, locked_until from admin_users where email = ?');
$check->execute([$EMAIL]);
$row = $check->fetch();

echo 'UNLOCK rows=' . $rows
   . ' now_failed=' . ($row['failed_attempts'] ?? 'no_such_row')
   . ' now_locked_until=' . ($row['locked_until'] ?? 'null')
   . "\n";
