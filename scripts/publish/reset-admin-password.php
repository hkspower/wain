<?php
/**
 * Set a new password for hkspower@live.com, from a credential file this
 * script itself deletes the moment it has read it — same pattern mk.php used
 * to create the account, for the same reason: the password must never touch
 * this repository, which is public.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/reset-admin-password.php && php r.php
 *
 * WHY THIS INSTEAD OF api/reset-admin.php. That route is one CLAUDE.md and
 * live-file-check.php both record as a file that must NEVER be on the live
 * server — it changed the admin password on request with no password check
 * at all, and this repository does not even carry it. This script needs no
 * counterpart on the server: it reuses store_db() directly, exactly the way
 * unlock-admin.php already did for the account's lockout.
 *
 * THE CREDENTIAL FILE holds `email|newpassword`, base64, written by a
 * SEPARATE short cron command to /home/u130124229/.a — the ~64-character
 * ceiling CLAUDE.md's cron section documents. Read once, deleted before
 * anything else runs, so a failed or interrupted run cannot leave a
 * plaintext password sitting in the home directory any longer than it has to.
 *
 * ALSO CLEARS THE LOCKOUT on the same row, in the same statement — a locked
 * account with a freshly reset password would still answer 429 on the very
 * next sign-in, which is not what "reset" means to the person doing it.
 *
 * password_hash() with the DEFAULT algorithm, exactly what store_login()
 * verifies against and what account_update() uses for every other password
 * change — one implementation of "how a password becomes a hash" for the
 * whole shop, not a second one written here that could drift from it.
 */

require_once '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';

$CRED = '/home/u130124229/.a';

$raw = @file_get_contents($CRED);
@unlink($CRED);

if ($raw === false || trim($raw) === '') {
    echo "RESETPW no_credfile\n";
    exit;
}

$parts = explode('|', trim($raw), 2);
$email = $parts[0] ?? '';
$pass  = $parts[1] ?? '';

if ($email === '' || $pass === '') {
    echo "RESETPW bad_credfile\n";
    exit;
}

// The same floor account_update() and the original setup enforce — a reset
// password that is weaker than the panel would ever accept is a hole the
// panel itself does not have.
if (strlen($pass) < 12) {
    echo "RESETPW password_too_short\n";
    exit;
}

$db = store_db();
$hash = password_hash($pass, PASSWORD_DEFAULT);
$stmt = $db->prepare(
    'update admin_users set password_hash = ?, failed_attempts = 0, locked_until = null where email = ?'
);
$stmt->execute([$hash, $email]);
$rows = $stmt->rowCount();

$check = $db->prepare('select email, failed_attempts, locked_until from admin_users where email = ?');
$check->execute([$email]);
$row = $check->fetch();

echo 'RESETPW rows=' . $rows
   . ' found=' . ($row ? $row['email'] : 'no_such_row')
   . ' now_failed=' . ($row['failed_attempts'] ?? 'n/a')
   . ' now_locked_until=' . ($row['locked_until'] ?? 'null')
   . "\n";
