<?php
// One-time admin account creation — then DELETE THIS FILE from the server.
//
// The owner has no shell, so password_hash() has to run somewhere they can
// reach; this is that somewhere, following the exact pattern of the KNET
// setup-config.php (used once, then removed, and npm run publish refuses to
// re-upload it without --setup-tools).
//
// Three locks, because a page that creates admin accounts is the most
// dangerous file in the folder:
//   1. It only works while the admin_users table is EMPTY. The moment the
//      first account exists, this page refuses — it can bootstrap, never add.
//   2. It requires the cron_key from config.php, which only someone who can
//      already read the server's config possesses.
//   3. It nags to be deleted, and the publish script treats it like the other
//      setup tools: never re-uploaded.

declare(strict_types=1);
require __DIR__ . '/store.php';

$cfg = store_config();
$db = store_db();

$count = (int)$db->query('select count(*) from admin_users')->fetchColumn();
if ($count > 0) {
    http_response_code(403);
    exit('An admin account already exists. This page only works on an empty admin_users table — delete this file from the server.');
}

$msg = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $key = (string)($_POST['key'] ?? '');
    if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], $key)) {
        http_response_code(403);
        exit('Wrong key. Use the cron_key value from config.php.');
    }
    $email = mb_strtolower(trim((string)($_POST['email'] ?? '')));
    $pass = (string)($_POST['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $msg = 'That is not an email address.';
    } elseif (strlen($pass) < 12) {
        // Twelve, not eight: this password guards the shop's orders and every
        // customer address in them, and it has no second factor.
        $msg = 'Use at least 12 characters.';
    } else {
        $db->prepare('insert into admin_users (email, password_hash) values (?, ?)')
           ->execute([$email, password_hash($pass, PASSWORD_DEFAULT)]);
        exit('Admin created for ' . htmlspecialchars($email)
           . '. NOW DELETE setup-admin.php FROM THE SERVER, then sign in at /admin.');
    }
}
?><!doctype html>
<meta charset="utf-8">
<title>Sporta — create the admin account</title>
<body style="font-family:sans-serif;max-width:26rem;margin:4rem auto">
<h1>Create the admin account</h1>
<p style="color:#b45309"><b>Delete this file from the server as soon as the account is created.</b></p>
<?php if ($msg) echo '<p style="color:#b91c1c">' . htmlspecialchars($msg) . '</p>'; ?>
<form method="post">
  <p><label>Setup key (cron_key from config.php)<br><input name="key" type="password" required style="width:100%"></label></p>
  <p><label>Email<br><input name="email" type="email" required style="width:100%"></label></p>
  <p><label>Password (12+ characters)<br><input name="password" type="password" minlength="12" required style="width:100%"></label></p>
  <p><button>Create admin</button></p>
</form>
</body>
