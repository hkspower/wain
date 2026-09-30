<?php
/**
 * Verify the new password actually works, by attempting a real sign-in —
 * not by trusting reset-admin-password.php's own report, per this session's
 * standing practice of confirming a write by asking the LIVE server rather
 * than the writer's own account of itself.
 *
 * The password is base64'd here rather than typed as a literal, only so it
 * survives the cron transport unmangled (it contains `&` and `#`); it is
 * still deleted from history the moment this one-off script has run once,
 * exactly like every other throwaway verifier in scripts/publish/.
 */
$EMAIL = 'hkspower@live.com';
$PASS  = base64_decode('N21vMGdpR0AjOE4xUCYwRlB3KyY=');

$jar = tempnam(sys_get_temp_dir(), 'ck');
$ch = curl_init('https://127.0.0.1/api/admin.php?r=login');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_COOKIEJAR => $jar,
    CURLOPT_COOKIEFILE => $jar,
    CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1', 'Content-Type: application/json'],
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $EMAIL, 'password' => $PASS]),
    CURLOPT_TIMEOUT => 25,
]);
$out = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
@unlink($jar);

echo 'VERIFYRESET code=' . $code . ' body=' . substr((string) $out, 0, 200) . "\n";
