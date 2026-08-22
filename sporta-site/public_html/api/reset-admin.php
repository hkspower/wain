<?php
// Set a new password on an EXISTING admin account — then DELETE THIS FILE.
//
// WHY THIS EXISTS. Sign-in at /backends is an email and a password in
// admin_users, and until this file there was no way back from losing it. There
// is no reset email — the shop has no outbound mail path it can trust for
// this; order mail already needs SPF/DKIM/DMARC that are not published yet, so
// a recovery link would go to spam, which is the worst possible place for one.
// And setup-admin.php cannot help: it refuses outright the moment the table
// holds a row, by design.
//
// So the documented recovery was `delete from admin_users;` in phpMyAdmin
// followed by re-uploading setup-admin.php — destroying the account to change
// its password, through the one tool with unrestricted access to the whole
// database. That is a lot of loaded gun for a forgotten password.
//
// THE LOCKS, and they are the same three setup-admin.php has, minus the one
// that cannot apply:
//   1. It requires the cron_key from config.php — so it is already limited to
//      someone who can read the server's own configuration. That is the whole
//      authority here, which is exactly why the file must not stay.
//   2. It changes an account that already exists and creates nothing. It
//      cannot add an admin, so it cannot be used to quietly grant access; a
//      changed password is noticed the next time the real owner signs in,
//      where a new account might never be.
//   3. It nags to be deleted, and publish-ftps.mjs treats it like the other
//      setup tools: never uploaded unless --setup-tools is passed.
//
// It cannot be locked to "empty table" the way setup-admin.php is, because a
// non-empty table is precisely when it is needed. The cron key is doing the
// work, so a shop that has ever exposed its cron key should rotate that first.

declare(strict_types=1);
require __DIR__ . '/store.php';

$cfg = store_config();
$db = store_db();

$msg = '';
$ok = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    // hash_equals, not ===: a key compared byte by byte with early exit leaks
    // its length and then its content to anything that can time the answer.
    // Same comparison the cron endpoints use.
    $key = (string)($_POST['key'] ?? '');
    if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], $key)) {
        http_response_code(403);
        exit('Wrong key. Use the cron_key value from config.php.');
    }

    $email = mb_strtolower(trim((string)($_POST['email'] ?? '')));
    $pass  = (string)($_POST['password'] ?? '');
    $again = (string)($_POST['password2'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $msg = 'That is not an email address.';
    } elseif (strlen($pass) < 12) {
        // Twelve, matching setup-admin.php. This password guards every order
        // and every customer address in the shop, and it has no second factor.
        $msg = 'Use at least 12 characters.';
    } elseif (!hash_equals($pass, $again)) {
        // TYPED TWICE, which setup-admin.php does not ask for and should. A
        // mistyped password at CREATION is discovered immediately, at the
        // login screen thirty seconds later. A mistyped password at RESET
        // locks out the person who just used the recovery tool, and the only
        // thing left to try is the tool they were told to delete.
        $msg = 'The two passwords do not match.';
    } else {
        $q = $db->prepare('select id from admin_users where email = ?');
        $q->execute([$email]);
        $id = $q->fetchColumn();
        if ($id === false) {
            // Naming the accounts is safe here and saves a support round trip:
            // this page already requires the cron key, and anyone holding that
            // can read admin_users directly. The likeliest reason to be here
            // is a half-remembered address.
            $known = $db->query('select email from admin_users order by id')->fetchAll(PDO::FETCH_COLUMN);
            $msg = 'No admin account with that email. On this server: '
                 . ($known ? htmlspecialchars(implode(', ', $known)) : 'none at all — use setup-admin.php instead.');
        } else {
            // The lock is cleared with the password. Five failed attempts
            // freeze the account for fifteen minutes, and someone who has just
            // been guessing at their own forgotten password has almost
            // certainly tripped it — so without this the reset "works" and
            // the next sign-in is still refused, which reads as the reset
            // having failed.
            // THE SECOND FACTOR COMES OFF TOO, and this is the only route that
            // can do it. The admin's own Security screen needs a working code
            // to disable two-factor — correctly, since otherwise a session
            // cookie alone would be enough to remove it. But that leaves the
            // owner whose phone was lost, stolen or wiped with a password they
            // know, a code they cannot produce, and no way in at all.
            //
            // Clearing it here is safe for the same reason the whole file is:
            // it takes the cron_key, which means it takes someone who can
            // already read config.php. It is also honest — the owner is told
            // on the next screen that two-factor is now off and needs
            // re-enrolling, rather than discovering it at the next sign-in.
            $hadTotp = false;
            $t = $db->prepare('select totp_enabled from admin_users where id = ?');
            $t->execute([$id]);
            $hadTotp = (int)$t->fetchColumn() === 1;

            $db->prepare(
                'update admin_users
                    set password_hash = ?, failed_attempts = 0, locked_until = null,
                        totp_enabled = 0, totp_secret = null, totp_last_step = null
                  where id = ?'
            )->execute([password_hash($pass, PASSWORD_DEFAULT), $id]);
            $ok = 'Password changed for ' . htmlspecialchars($email) . '.'
                . ($hadTotp ? ' Two-factor was switched OFF — enrol your phone again from Security.' : '');
        }
    }
}
?><!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Sporta — reset the admin password</title>
<body style="font-family:sans-serif;max-width:26rem;margin:4rem auto">
<h1>Reset the admin password</h1>
<p>This also switches <b>two-factor off</b>, which is the way back in when the
phone holding the codes is lost. You re-enrol from Security after signing in.</p>
<p style="color:#b45309"><b>Delete this file from the server as soon as you have signed in.</b>
It changes an admin password for anyone holding the cron key.</p>
<?php if ($ok): ?>
  <p style="color:#166534"><b><?= $ok ?></b></p>
  <p>Now <b>delete <code>api/reset-admin.php</code></b> from the server, then sign in at
     <a href="/backends">/backends</a>.</p>
<?php else: ?>
  <?php if ($msg) echo '<p style="color:#b91c1c">' . $msg . '</p>'; ?>
  <form method="post">
    <p><label>Setup key (cron_key from config.php)<br><input name="key" type="password" required style="width:100%"></label></p>
    <p><label>Admin email<br><input name="email" type="email" required style="width:100%"></label></p>
    <p><label>New password (12+ characters)<br><input name="password" type="password" minlength="12" required style="width:100%"></label></p>
    <p><label>New password again<br><input name="password2" type="password" minlength="12" required style="width:100%"></label></p>
    <p><button>Change the password</button></p>
  </form>
<?php endif; ?>
</body>
