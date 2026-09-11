<?php
/**
 * Can anyone sign in to /backends on this shop?
 *
 *   php /home/<user>/live-admin-check.php
 *
 * READ-ONLY, and it prints NO EMAIL ADDRESS and no hash — only counts and
 * yes/no. This file is fetched over plain HTTP from a public repository, and an
 * administrator's address is half of a credential.
 *
 * WHY IT EXISTS. `admin.php` answers `no_admin_account` (409) when admin_users
 * is empty, so the panel can say "this shop has no administrator yet" rather
 * than telling the owner their correct password is wrong. Nothing reports which
 * of those two states the live shop is in until somebody tries to sign in and
 * fails — and "I cannot get into the panel" has at least four different causes:
 *
 *   no account at all          -> the register route is the way in, once
 *   an account with 2FA on     -> the code matters as much as the password
 *   an account, forgotten pass -> a hash has to be replaced by hand
 *   the table is not there     -> the schema was never imported
 *
 * They want different answers and they look identical from the outside.
 */

$CFG = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
$cfg = @include $CFG;
if (!is_array($cfg)) { echo "ADMIN failed=no-config\n"; exit; }

try {
    $db = new PDO(
        'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
        (string) $cfg['db_user'], (string) $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) { echo "ADMIN failed=no-db\n"; exit; }

$has = static function (PDO $db, string $t): bool {
    try { $db->query('select 1 from `' . $t . '` limit 1'); return true; }
    catch (Throwable $e) { return false; }
};

if (!$has($db, 'admin_users')) { echo "ADMIN table=MISSING (schema never imported)\n"; exit; }

$n = (int) $db->query('select count(*) from admin_users')->fetchColumn();

// Which optional columns this shop's table actually has — a shop set up before
// two-factor landed has neither, and asking for them would be a fatal error
// rather than an answer.
$cols = [];
foreach ($db->query('show columns from admin_users') as $c) $cols[] = $c['Field'];
$hasTotp = in_array('totp_secret', $cols, true);
$hasSeen = in_array('last_seen_at', $cols, true);

$totpOn = $hasTotp
    ? (int) $db->query('select count(*) from admin_users where totp_secret is not null and totp_secret <> \'\'')->fetchColumn()
    : -1;

// The most recent sign-in, to the DAY. Not the hour, and never the address:
// this says "somebody is using it" without saying who or exactly when.
$seen = 'n/a';
if ($hasSeen && $n > 0) {
    $d = $db->query('select date(max(last_seen_at)) from admin_users')->fetchColumn();
    $seen = $d ? (string) $d : 'never';
}

echo 'ADMIN accounts=' . $n
   . ' canRegister=' . ($n === 0 ? 'YES-first-account-only' : 'no-already-set-up')
   . ' twoFactorOn=' . ($totpOn < 0 ? 'column-absent' : $totpOn . '/' . $n)
   . ' lastSignIn=' . $seen
   . "\n";
