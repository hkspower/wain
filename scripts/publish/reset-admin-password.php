<?php
/**
 * Set a new password for hkspower@live.com, from a base64 CLI argument —
 * never a file, and never a literal in this script, which is public.
 *
 *   php r.php <base64 of the new password, nothing else>
 *
 * THE EMAIL IS NOT IN THE ARGUMENT. It is the $EMAIL constant below, edited
 * in the repository if the account this recovers is ever a different
 * address — an earlier version of this comment said the argument was
 * "email|newpassword" and the code has never read it that way; base64_decode
 * of the whole argument IS the password, trimmed, nothing split out of it.
 *
 * WHY AN ARGUMENT, NOT THE CREDENTIAL-FILE PATTERN mk.php AND unlock-admin.php
 * USED. That pattern is two separate cron jobs — one writes the file, one
 * reads it — and it raced here exactly the way this project's own notes
 * already warned it could for chk.php: two independently-scheduled per-minute
 * jobs, no guarantee the read fires after a write and before whatever
 * deletes or overwrites it. Passing the credential as `argv[1]` collapses
 * the whole operation into ONE shell command, one process, no file and
 * nothing to race — the fetch, the decode and the database write all happen
 * inside a single cron tick.
 *
 * `argv[1]` is base64 rather than plain text only because the password
 * contains `&` and `#`, which CLAUDE.md's cron section already documents as
 * unsafe unquoted — base64 is letters/digits/+/=, which survives that
 * transport untouched.
 *
 * WHY THIS INSTEAD OF api/reset-admin.php. That route is one CLAUDE.md and
 * live-file-check.php both record as a file that must NEVER be on the live
 * server — it changed the admin password on request with no password check
 * at all, and this repository does not even carry it. This script needs no
 * counterpart on the server: it reuses store_db() directly, exactly the way
 * unlock-admin.php already did for the account's lockout.
 *
 * ALSO CLEARS THE LOCKOUT on the same row, in the same statement — a locked
 * account with a freshly reset password would still answer 429 on the very
 * next sign-in, which is not what "reset" means to the person doing it.
 *
 * password_hash() with the DEFAULT algorithm, exactly what store_login()
 * verifies against and what account_update() uses for every other password
 * change — one implementation of "how a password becomes a hash" for the
 * whole shop, not a second one written here that could drift from it.
 *
 * ALSO SETS must_change_password. Whatever this script is passed on the
 * command line has already travelled through a base64 CLI argument in a
 * cron command panel that at least one other person can read, which makes it
 * a TEMPORARY password by definition rather than a real one — see
 * 10-must-change-password.sql. Signing in still works with it; every other
 * route refuses with must_change_password until the owner picks a real one
 * from inside /backends -> Account, which is the one route that clears it.
 */

require_once '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';

$EMAIL = 'hkspower@live.com';

$b64 = $argv[1] ?? '';
$raw = $b64 === '' ? '' : base64_decode($b64, true);

if ($raw === false || $raw === '') {
    echo "RESETPW no_argument\n";
    exit;
}

$pass = trim($raw);
if ($pass === '') {
    echo "RESETPW empty_password\n";
    exit;
}

// The same floor account_update() and the original setup enforce — a reset
// password that is weaker than the panel would ever accept is a hole the
// panel itself does not have.
if (strlen($pass) < 12) {
    echo "RESETPW password_too_short\n";
    exit;
}

// AND THE SAME WEAK-PASSWORD CHECK, found missing by a security review of
// this file: the length floor alone lets '111111111111' or 'sportasporta'
// through — both 12 characters, both something store_password_is_weak()
// refuses on every OTHER route that sets a credential. This script exists
// for the one moment the panel's own gate cannot be reached; it must not be
// a weaker gate than the one it stands in for, even for the short window
// before must_change_password forces a real password.
if (($weak = store_password_is_weak($pass, $EMAIL)) !== null) {
    echo "RESETPW $weak\n";
    exit;
}

$db = store_db();
$hash = password_hash($pass, PASSWORD_DEFAULT);
$stmt = $db->prepare(
    'update admin_users set password_hash = ?, failed_attempts = 0, locked_until = null,
                            must_change_password = 1 where email = ?'
);
$stmt->execute([$hash, $EMAIL]);
$rows = $stmt->rowCount();

$check = $db->prepare('select email, failed_attempts, locked_until, must_change_password
                         from admin_users where email = ?');
$check->execute([$EMAIL]);
$row = $check->fetch();

echo 'RESETPW rows=' . $rows
   . ' found=' . ($row ? $row['email'] : 'no_such_row')
   . ' now_failed=' . ($row['failed_attempts'] ?? 'n/a')
   . ' now_locked_until=' . ($row['locked_until'] ?? 'null')
   . ' must_change_password=' . ($row['must_change_password'] ?? 'n/a')
   . "\n";
