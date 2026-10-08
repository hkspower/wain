<?php
/**
 * Can anyone sign in to /backends on this shop?
 *
 *   php /home/<user>/live-admin-check.php
 *   php scripts/live/live-admin-check.php      (from a checkout: the sandbox database)
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

$LIVE = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
$CFG = is_file($LIVE) ? $LIVE : dirname(__DIR__, 2) . '/sporta-site/public_html/api/config.php';
$cfg = @include $CFG;
if (!is_array($cfg)) { echo "ADMIN failed=no-config\n"; exit; }

try {
    $db = new PDO(
        'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
        (string) $cfg['db_user'], (string) $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) { echo "ADMIN failed=no-db\n"; exit; }

// Only error 1146 means the table is not there. Any other failure is printed as its number rather
// than read as "missing", which would send the owner to re-import a schema that is already in place.
try { $db->query('select 1 from admin_users limit 1'); }
catch (Throwable $e) {
    $no = $e instanceof PDOException ? (int) ($e->errorInfo[1] ?? 0) : 0;
    echo $no === 1146 ? "ADMIN table=MISSING (schema never imported)\n" : "ADMIN failed=query-error-$no\n";
    exit;
}

$n = (int) $db->query('select count(*) from admin_users')->fetchColumn();

// Which optional columns this shop's table actually has — a shop set up before
// two-factor landed has neither, and asking for them would be a fatal error
// rather than an answer.
$cols = [];
foreach ($db->query('show columns from admin_users') as $c) $cols[] = $c['Field'];
// Two-factor by the SIGN-IN's own rule (store.php: `totp_enabled = 1` with a secret, or
// `email_otp_enabled = 1`). This counted `totp_secret is not null` until 2026-10-08, which is wrong
// both ways: admin.php stores the secret BEFORE a code proves the phone and leaves totp_enabled at 0,
// so an abandoned enrolment read as 2FA on, while an account protected by an emailed code read as off.
$hasTotp  = in_array('totp_secret', $cols, true) && in_array('totp_enabled', $cols, true);
$hasEmail = in_array('email_otp_enabled', $cols, true);
// last_login_at, set by store_admin_grant() on every successful sign-in (1-schema.mysql.sql). This
// read `last_seen_at` until 2026-10-08 — a column admin_users has never had (customers has one) — so
// the check below was always false and every run printed lastSignIn=n/a, however recently anyone
// had signed in. A missing optional column and a misspelt one look the same from here: `lastSignIn=`
// now says which.
$hasSeen = in_array('last_login_at', $cols, true);

// Whole statements, not a WHERE assembled from pieces: schema-usage-audit.mjs prepares each literal
// against a fresh install, and a clause built with implode() is one it cannot see into.
$factorSql = $hasTotp && $hasEmail
    ? "select count(*) from admin_users where (totp_enabled = 1 and totp_secret is not null and totp_secret <> '') or email_otp_enabled = 1"
    : ($hasTotp
        ? "select count(*) from admin_users where totp_enabled = 1 and totp_secret is not null and totp_secret <> ''"
        : ($hasEmail ? 'select count(*) from admin_users where email_otp_enabled = 1' : ''));
$totpOn = $factorSql !== '' ? (int) $db->query($factorSql)->fetchColumn() : -1;

// The most recent sign-in, to the DAY. Not the hour, and never the address:
// this says "somebody is using it" without saying who or exactly when.
$seen = 'n/a';
if ($hasSeen && $n > 0) {
    $d = $db->query('select date(max(last_login_at)) from admin_users')->fetchColumn();
    $seen = $d ? (string) $d : 'never';
}

echo 'ADMIN accounts=' . $n
   . ' canRegister=' . ($n === 0 ? 'YES-first-account-only' : 'no-already-set-up')
   . ' twoFactorOn=' . ($totpOn < 0 ? 'column-absent' : $totpOn . '/' . $n)
   . ' lastSignIn=' . ($hasSeen ? $seen : 'column-absent')
   . "\n";
