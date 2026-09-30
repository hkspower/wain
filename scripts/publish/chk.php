<?php
/**
 * Verify a login, from the same throwaway credential file mk.php uses.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/chk.php && php r.php
 *
 * Read-only against the admin account itself (a login attempt), but still
 * lives in scripts/publish/ rather than scripts/live/ because it can LOCK
 * the account on repeated wrong attempts — five failures locks it for
 * fifteen minutes, so this must never be run speculatively or in a loop.
 *
 * Same credential-file handling as mk.php: read once, delete immediately,
 * before doing anything else.
 */

$CRED = '/home/u130124229/.a';

$raw = @file_get_contents($CRED);
@unlink($CRED);

if ($raw === false || trim($raw) === '') {
    echo "CHKLOGIN no_credfile\n";
    exit;
}

$parts = explode('|', trim($raw), 2);
$email = $parts[0] ?? '';
$pass  = $parts[1] ?? '';

if ($email === '' || $pass === '') {
    echo "CHKLOGIN bad_credfile\n";
    exit;
}

$ch = curl_init('https://127.0.0.1/api/admin.php?r=login');
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

echo 'CHKLOGIN code=' . $code . ' body=' . substr((string) $out, 0, 200) . "\n";
