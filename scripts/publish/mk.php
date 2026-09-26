<?php
/**
 * Create the FIRST admin account, from a credential file this script itself
 * deletes the moment it has read it.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/mk.php && php r.php
 *
 * WHY THIS EXISTS. admin.php's own `register` route already does the real
 * work — creates the first admin_users row and signs it in, and refuses
 * with `already_set_up` the instant a second one would be needed — but the
 * website panel's own UI never calls it: its "no admin account" screen
 * tells the owner to visit `api/setup-admin.php`, which does not exist on
 * this server. This is the workaround for that gap, not a new feature.
 *
 * THE CREDENTIAL NEVER TOUCHES THIS REPOSITORY, which is public. It travels
 * as a base64 `email|password` blob written to `/home/u130124229/.a` by a
 * SEPARATE, short cron command — see CLAUDE.md's cron section on payload
 * size: ~64 characters of base64 is the ceiling for a reliable write, and
 * this credential fits it. This script's only job is to read that file,
 * use it once, and delete it before doing anything else — so a failed or
 * interrupted run cannot leave a plaintext password sitting in the home
 * directory any longer than it has to.
 *
 * ONE LINE of output, because cron returns only the last one.
 */

$CRED = '/home/u130124229/.a';

$raw = @file_get_contents($CRED);
@unlink($CRED);

if ($raw === false || trim($raw) === '') {
    echo "MKADMIN no_credfile\n";
    exit;
}

$parts = explode('|', trim($raw), 2);
$email = $parts[0] ?? '';
$pass  = $parts[1] ?? '';

if ($email === '' || $pass === '') {
    echo "MKADMIN bad_credfile\n";
    exit;
}

$ch = curl_init('https://127.0.0.1/api/admin.php?r=register');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER => [
        'Host: www.sporta.com.kw',
        'X-Sporta-Admin: 1',
        'Content-Type: application/json',
    ],
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $pass]),
    CURLOPT_TIMEOUT => 25,
]);
$out  = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// The response body is echoed back capped at 200 chars — it is either the
// created email (safe, already known to whoever ran this) or a machine
// error token (already_set_up, bad_email, password_too_short), never a
// password.
echo 'MKADMIN code=' . $code . ' body=' . substr((string) $out, 0, 200) . "\n";
