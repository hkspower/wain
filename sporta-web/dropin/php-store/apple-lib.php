<?php
// Sign in with Apple, the pure part: no database, no session, no output.
//
// The flow is Apple's hybrid one (response_type=code id_token, response_mode=form_post).
// The id_token that comes back in the POST is signed by Apple, so checking its
// signature against Apple's published keys is enough to know who signed in. No
// client secret is needed at runtime, which keeps a private key off this server.
//
// The sign-in state (a nonce, and an expiry) travels in the `state` value itself,
// signed with a server secret, instead of in a session cookie. Apple's callback
// is a cross-site POST, and a SameSite=Strict cookie is not sent on it.
declare(strict_types=1);

const APPLE_ISS = 'https://appleid.apple.com';
const APPLE_AUTHORIZE = 'https://appleid.apple.com/auth/authorize';
const APPLE_JWKS_DEFAULT = 'https://appleid.apple.com/auth/keys';
const APPLE_CALLBACK = 'https://www.sporta.com.kw/api/apple-auth.php';
const APPLE_STATE_TTL = 600;
const APPLE_CLOCK_SKEW = 60;

// Off unless the owner has switched it on AND the state secret is long enough to
// be a secret. Fails closed: a missing key or secret means the button never shows.
function apple_enabled(array $cfg): bool {
    return ($cfg['apple_signin_enabled'] ?? false) === true
        && is_string($cfg['apple_services_id'] ?? null) && trim($cfg['apple_services_id']) !== ''
        && is_string($cfg['apple_state_secret'] ?? null) && strlen($cfg['apple_state_secret']) >= 32;
}

function apple_b64url_encode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

// Strict: returns null on any character outside the alphabet or bad padding.
function apple_b64url_decode(string $text): ?string {
    if ($text === '' || preg_match('/[^A-Za-z0-9\-_]/', $text)) return null;
    $padded = strtr($text, '-_', '+/') . str_repeat('=', (4 - strlen($text) % 4) % 4);
    $raw = base64_decode($padded, true);
    return $raw === false ? null : $raw;
}

// [state, nonce]. The state is "<payload>.<hmac>", the payload a JSON {n, exp}.
function apple_state_make(string $secret, ?int $now = null): array {
    $now = $now ?? time();
    $nonce = bin2hex(random_bytes(16));
    $payload = apple_b64url_encode(json_encode(['n' => $nonce, 'exp' => $now + APPLE_STATE_TTL], JSON_THROW_ON_ERROR));
    $mac = apple_b64url_encode(hash_hmac('sha256', $payload, $secret, true));
    return [$payload . '.' . $mac, $nonce];
}

// The nonce the state was made with, or null when the state is forged, altered or expired.
function apple_state_nonce(string $secret, string $state, ?int $now = null): ?string {
    $now = $now ?? time();
    $parts = explode('.', $state);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return null;
    $mac = apple_b64url_decode($parts[1]);
    if ($mac === null || !hash_equals(hash_hmac('sha256', $parts[0], $secret, true), $mac)) return null;
    $raw = apple_b64url_decode($parts[0]);
    if ($raw === null) return null;
    try {
        $data = json_decode($raw, true, 4, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }
    if (!is_array($data) || !is_string($data['n'] ?? null) || !preg_match('/^[a-f0-9]{32}$/', $data['n'])) return null;
    if (!is_int($data['exp'] ?? null) || $data['exp'] < $now) return null;
    return $data['n'];
}

// ASN.1 DER for an RSA public key, the SubjectPublicKeyInfo form PHP's OpenSSL reads.
function apple_der(int $tag, string $body): string {
    $n = strlen($body);
    if ($n < 128) $len = chr($n);
    else {
        $bytes = ltrim(pack('N', $n), "\0");
        $len = chr(0x80 | strlen($bytes)) . $bytes;
    }
    return chr($tag) . $len . $body;
}

function apple_der_int(string $unsigned): string {
    $unsigned = ltrim($unsigned, "\0");
    if ($unsigned === '') $unsigned = "\0";
    if (ord($unsigned[0]) & 0x80) $unsigned = "\0" . $unsigned;
    return apple_der(0x02, $unsigned);
}

// $n and $e are the raw bytes of the JWK's modulus and exponent.
function apple_rsa_pem(string $n, string $e): string {
    $algorithm = apple_der(0x30, hex2bin('06092a864886f70d010101') . "\x05\x00"); // rsaEncryption, NULL
    $key = apple_der(0x30, apple_der_int($n) . apple_der_int($e));
    $spki = apple_der(0x30, $algorithm . apple_der(0x03, "\x00" . $key));
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

// Apple's published keys (JWKS). Tests point apple_jwks_url at a local file.
function apple_jwks(array $cfg): ?array {
    $url = is_string($cfg['apple_jwks_url'] ?? null) && $cfg['apple_jwks_url'] !== ''
        ? $cfg['apple_jwks_url'] : APPLE_JWKS_DEFAULT;
    $context = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true]]);
    $body = @file_get_contents($url, false, $context);
    if (!is_string($body)) return null;
    $data = json_decode($body, true);
    return is_array($data) && is_array($data['keys'] ?? null) ? $data : null;
}

// The verified claims of an Apple id_token, or null. Every check here is needed:
// the signature (it came from the browser), the issuer and audience (it is for
// THIS app), the expiry, and the nonce (it answers THIS sign-in, not an old one).
function apple_verify_id_token(string $jwt, array $cfg, string $nonce, ?int $now = null): ?array {
    $now = $now ?? time();
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) return null;
    $header = json_decode((string)apple_b64url_decode($parts[0]), true);
    $claims = json_decode((string)apple_b64url_decode($parts[1]), true);
    $signature = apple_b64url_decode($parts[2]);
    if (!is_array($header) || !is_array($claims) || $signature === null) return null;
    if (($header['alg'] ?? '') !== 'RS256' || !is_string($header['kid'] ?? null)) return null;

    $jwks = apple_jwks($cfg);
    if ($jwks === null) return null;
    $key = null;
    foreach ($jwks['keys'] as $candidate) {
        if (is_array($candidate) && ($candidate['kid'] ?? null) === $header['kid'] && ($candidate['kty'] ?? null) === 'RSA') {
            $key = $candidate;
            break;
        }
    }
    if ($key === null || !is_string($key['n'] ?? null) || !is_string($key['e'] ?? null)) return null;
    $n = apple_b64url_decode($key['n']);
    $e = apple_b64url_decode($key['e']);
    if ($n === null || $e === null) return null;
    $public = openssl_pkey_get_public(apple_rsa_pem($n, $e));
    if ($public === false) return null;
    if (openssl_verify($parts[0] . '.' . $parts[1], $signature, $public, OPENSSL_ALGO_SHA256) !== 1) return null;

    $audience = (string)($cfg['apple_services_id'] ?? '');
    if (($claims['iss'] ?? '') !== APPLE_ISS || $audience === '' || ($claims['aud'] ?? '') !== $audience) return null;
    if (!is_int($claims['exp'] ?? null) || $claims['exp'] < $now - APPLE_CLOCK_SKEW) return null;
    if (!is_int($claims['iat'] ?? null) || $claims['iat'] > $now + APPLE_CLOCK_SKEW) return null;
    if (!hash_equals($nonce, (string)($claims['nonce'] ?? ''))) return null;
    $sub = $claims['sub'] ?? null;
    if (!is_string($sub) || $sub === '' || strlen($sub) > 255) return null;
    return $claims;
}

// The email Apple verified, lower-cased, or null. Apple sends the flag as a boolean
// or as the string "true" depending on the flow; both are accepted, nothing else.
function apple_verified_email(array $claims): ?string {
    $email = $claims['email'] ?? null;
    $verified = $claims['email_verified'] ?? null;
    if (!is_string($email) || $email === '' || strlen($email) > 254) return null;
    if ($verified !== true && $verified !== 'true') return null;
    $email = strtolower(trim($email));
    return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
}

// The name Apple sends ONLY on the first sign-in, as a JSON string in the `user` field.
// Returns "" when there is none, and the caller falls back to the email's local part.
function apple_name_from_user_field(?string $user): string {
    if (!is_string($user) || $user === '' || strlen($user) > 2048) return '';
    try {
        $data = json_decode($user, true, 4, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return '';
    }
    $name = is_array($data['name'] ?? null) ? $data['name'] : [];
    $first = is_string($name['firstName'] ?? null) ? trim($name['firstName']) : '';
    $last = is_string($name['lastName'] ?? null) ? trim($name['lastName']) : '';
    return mb_substr(trim($first . ' ' . $last), 0, 80);
}
