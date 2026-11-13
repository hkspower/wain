<?php
// Sign in with Apple: the pure checks (dropin/php-store/apple-lib.php). No database, no network:
// Apple's keys are a local JWKS file, and the id_tokens are signed here with a generated key.
// Each refusal below is one attack the flow must stop. Output: "ok"/"FAIL" lines, exit 1 on any failure.
declare(strict_types=1);
require __DIR__ . '/../dropin/php-store/apple-lib.php';

$fails = 0; $passes = 0;
function check(bool $cond, string $label, string $detail = ''): void {
    global $fails, $passes;
    if ($cond) { $passes++; echo "ok   $label\n"; return; }
    $fails++; echo "FAIL $label" . ($detail !== '' ? "  — $detail" : '') . "\n";
}

$secret = str_repeat('s', 40);
$services = 'com.sporta.signin';
$now = 1_800_000_000;

// ---- switch and fail-closed
check(apple_enabled(['apple_signin_enabled' => true, 'apple_services_id' => $services, 'apple_state_secret' => $secret]), 'enabled only when the switch, the services id and a 32+ char secret are all set');
check(!apple_enabled(['apple_services_id' => $services, 'apple_state_secret' => $secret]), 'off when the switch is absent (the default)');
check(!apple_enabled(['apple_signin_enabled' => 'yes', 'apple_services_id' => $services, 'apple_state_secret' => $secret]), 'off unless the switch is the boolean true');
check(!apple_enabled(['apple_signin_enabled' => true, 'apple_services_id' => $services, 'apple_state_secret' => 'short']), 'off when the state secret is shorter than 32 characters');
check(!apple_enabled(['apple_signin_enabled' => true, 'apple_services_id' => ' ', 'apple_state_secret' => $secret]), 'off when the services id is blank');

// ---- signed state
[$state, $nonce] = apple_state_make($secret, $now);
check(apple_state_nonce($secret, $state, $now) === $nonce, 'a fresh state returns the nonce it was made with');
check(apple_state_nonce($secret, $state, $now + APPLE_STATE_TTL + 1) === null, 'an expired state is refused');
check(apple_state_nonce(str_repeat('x', 40), $state, $now) === null, 'a state made with another secret is refused');
[$p, $m] = explode('.', $state);
$forged = apple_b64url_encode(json_encode(['n' => str_repeat('a', 32), 'exp' => $now + 9999]));
check(apple_state_nonce($secret, "$forged.$m", $now) === null, 'a state whose payload was changed is refused');
check(apple_state_nonce($secret, 'nodot', $now) === null, 'a state without a signature is refused');
check(apple_state_nonce($secret, $state . 'x', $now) === null, 'a state with extra text after the signature is refused');

// ---- PEM: the bytes must be a key OpenSSL accepts, and the same key
$pair = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
$details = openssl_pkey_get_details($pair);
$n = $details['rsa']['n']; $e = $details['rsa']['e'];
$pem = apple_rsa_pem($n, $e);
$public = openssl_pkey_get_public($pem);
check($public !== false && openssl_pkey_get_details($public)['rsa']['n'] === $n, 'the PEM built from the JWK modulus and exponent is the same public key');

// ---- id_token
$kid = 'TESTKID1';
$jwksFile = sys_get_temp_dir() . '/apple-jwks-' . getmypid() . '.json';
file_put_contents($jwksFile, json_encode(['keys' => [[
    'kty' => 'RSA', 'kid' => $kid, 'use' => 'sig', 'alg' => 'RS256',
    'n' => apple_b64url_encode($n), 'e' => apple_b64url_encode($e),
]]]));
$cfg = ['apple_signin_enabled' => true, 'apple_services_id' => $services, 'apple_state_secret' => $secret, 'apple_jwks_url' => $jwksFile];

function jwt(array $header, array $claims, string $privatePem): string {
    $h = apple_b64url_encode(json_encode($header));
    $c = apple_b64url_encode(json_encode($claims));
    openssl_sign("$h.$c", $sig, openssl_pkey_get_private($privatePem), OPENSSL_ALGO_SHA256);
    return "$h.$c." . apple_b64url_encode($sig);
}
$good = [
    'iss' => APPLE_ISS, 'aud' => $services, 'exp' => $now + 600, 'iat' => $now,
    'sub' => '001234.abcdef.0001', 'nonce' => $nonce, 'email' => 'Shopper@Example.com', 'email_verified' => 'true',
];
$header = ['alg' => 'RS256', 'kid' => $kid];
$privatePem = null;
openssl_pkey_export($pair, $privatePem);

$token = jwt($header, $good, $privatePem);
$claims = apple_verify_id_token($token, $cfg, $nonce, $now);
check(is_array($claims) && $claims['sub'] === '001234.abcdef.0001', 'a token Apple signed for this app, with this nonce, verifies');
check(is_array($claims) && apple_verified_email($claims) === 'shopper@example.com', 'the verified email comes back lower-cased');

check(apple_verify_id_token($token, $cfg, str_repeat('0', 32), $now) === null, 'a token for another sign-in (wrong nonce) is refused');
check(apple_verify_id_token(jwt($header, array_merge($good, ['aud' => 'com.other.app']), $privatePem), $cfg, $nonce, $now) === null, 'a token for another app (wrong audience) is refused');
check(apple_verify_id_token(jwt($header, array_merge($good, ['iss' => 'https://evil.example']), $privatePem), $cfg, $nonce, $now) === null, 'a token from another issuer is refused');
check(apple_verify_id_token(jwt($header, array_merge($good, ['exp' => $now - 3600]), $privatePem), $cfg, $nonce, $now) === null, 'an expired token is refused');
check(apple_verify_id_token(jwt($header, array_merge($good, ['iat' => $now + 3600]), $privatePem), $cfg, $nonce, $now) === null, 'a token issued in the future is refused');
check(apple_verify_id_token(jwt(['alg' => 'RS256', 'kid' => 'NOTKEY'], $good, $privatePem), $cfg, $nonce, $now) === null, 'a token with an unknown key id is refused');
check(apple_verify_id_token(jwt(['alg' => 'HS256', 'kid' => $kid], $good, $privatePem), $cfg, $nonce, $now) === null, 'a token whose algorithm is not RS256 is refused (no alg downgrade)');
check(apple_verify_id_token(jwt(['alg' => 'none', 'kid' => $kid], $good, $privatePem), $cfg, $nonce, $now) === null, 'an unsigned token (alg none) is refused');

$parts = explode('.', $token);
$tampered = apple_b64url_encode(json_encode(array_merge($good, ['sub' => 'someone-else'])));
check(apple_verify_id_token("$parts[0].$tampered.$parts[2]", $cfg, $nonce, $now) === null, 'a token whose claims were changed after signing is refused');

$other = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
$otherPem = null; openssl_pkey_export($other, $otherPem);
check(apple_verify_id_token(jwt($header, $good, $otherPem), $cfg, $nonce, $now) === null, 'a token signed with another key (same kid) is refused');
check(apple_verify_id_token($token, array_merge($cfg, ['apple_jwks_url' => $jwksFile . '.missing']), $nonce, $now) === null, 'no keys from Apple means no sign-in');
check(apple_verify_id_token('not.a.token.at.all', $cfg, $nonce, $now) === null, 'something that is not a JWT is refused');

// ---- the email and name Apple sends
check(apple_verified_email(['email' => 'a@b.co', 'email_verified' => true]) === 'a@b.co', 'an email Apple verified as a boolean is accepted');
check(apple_verified_email(['email' => 'a@b.co', 'email_verified' => 'false']) === null, 'an email marked not verified is refused');
check(apple_verified_email(['email' => 'a@b.co']) === null, 'an email with no verified flag is refused');
check(apple_verified_email(['email' => 'not an address', 'email_verified' => true]) === null, 'a malformed email is refused');
check(apple_name_from_user_field('{"name":{"firstName":" Sara ","lastName":"Al-Ali"},"email":"x@y.z"}') === 'Sara Al-Ali', 'the first-sign-in name is trimmed and joined');
check(apple_name_from_user_field(null) === '' && apple_name_from_user_field('not json') === '', 'no or broken name field gives an empty name, not an error');

@unlink($jwksFile);
echo "\n$passes ok, $fails FAIL\n";
exit($fails === 0 ? 0 : 1);
