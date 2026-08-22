<?php
// Web Push, written out rather than pulled in.
//
// WHY THERE IS NO LIBRARY HERE. The shop runs on Hostinger shared hosting with
// no shell and no Composer, and the whole project's position is that nothing
// runs on the server that does not have to. web-push-php pulls in a dozen
// packages to do what this file does in two hundred lines, and every one of
// them would have to be vendored into the deploy and audited. PHP 8.4 already
// ships everything required: openssl for P-256 and ECDH, hash_hkdf() for the
// key derivation, and AES-128-GCM in openssl_encrypt().
//
// WHAT THIS IMPLEMENTS, precisely, because "web push" names three specifications
// that have to agree byte for byte or the phone silently shows nothing:
//
//   RFC 8291  Message Encryption for Web Push — the ECDH, the HKDF chain and
//             what goes in the record header.
//   RFC 8188  Encrypted Content-Encoding (aes128gcm) — the framing that header
//             belongs to.
//   RFC 8292  VAPID — the ES256 JWT that identifies this server to Apple's and
//             Google's push services, so the subscription cannot be used by
//             anyone who has intercepted the endpoint URL.
//
// THE FAILURE MODE IS SILENCE, WHICH IS WHY THIS FILE IS TESTED AGAINST THE
// RFC'S OWN VECTOR. Get one byte of the info strings wrong and the push service
// still answers 201 Created — it cannot read the payload either. The phone
// simply never buzzes, and there is nothing in any log to say why. So
// scripts/webpush-test.mjs reproduces RFC 8291 section 5's worked example and
// compares the whole encrypted body; that is a known-answer test, and it is the
// only honest way to check this offline.

declare(strict_types=1);

// ----------------------------------------------------------------- base64url
//
// Web Push is base64url everywhere and PHP has no builtin for it. Padding is
// stripped on the way out and restored on the way in, because subscriptions
// arrive from the browser unpadded and openssl will not take a short string.
function wp_b64_encode(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function wp_b64_decode(string $txt): string
{
    $txt = strtr(trim($txt), '-_', '+/');
    $pad = strlen($txt) % 4;
    if ($pad) $txt .= str_repeat('=', 4 - $pad);
    $out = base64_decode($txt, true);
    return $out === false ? '' : $out;
}

// ------------------------------------------------------------- P-256 keys
//
// A subscription's p256dh, and a VAPID key pair, are both uncompressed P-256
// points: 0x04 followed by 32 bytes of X and 32 of Y. openssl will not accept
// those 65 bytes on their own — it wants a key resource — so they are wrapped
// in the minimum DER that names the curve and carries the point.
//
// This is the one place where hand-rolling is genuinely awkward, and it is
// still smaller than a dependency: the prefix below is a fixed
// SubjectPublicKeyInfo header for id-ecPublicKey over prime256v1, and only the
// 65 point bytes ever change.
const WP_P256_SPKI_PREFIX = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01"
                          . "\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00";

function wp_public_key_from_point(string $point): \OpenSSLAsymmetricKey|false
{
    if (strlen($point) !== 65 || $point[0] !== "\x04") return false;
    $der = WP_P256_SPKI_PREFIX . $point;
    $pem = "-----BEGIN PUBLIC KEY-----\n"
         . chunk_split(base64_encode($der), 64, "\n")
         . "-----END PUBLIC KEY-----\n";
    return openssl_pkey_get_public($pem);
}

// A private key from its raw 32-byte scalar, which is how VAPID keys are
// published and how the RFC's test vector gives the application server key.
// The public point is required by the DER structure, so it is passed in.
function wp_private_key_from_scalar(string $scalar, string $point): \OpenSSLAsymmetricKey|false
{
    if (strlen($scalar) !== 32 || strlen($point) !== 65) return false;
    // RFC 5915 ECPrivateKey, explicit about the curve, with the public key in
    // the [1] tag. Lengths are fixed because P-256 sizes never vary here.
    $der = "\x30\x77\x02\x01\x01\x04\x20" . $scalar
         . "\xa0\x0a\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07"
         . "\xa1\x44\x03\x42\x00" . $point;
    $pem = "-----BEGIN EC PRIVATE KEY-----\n"
         . chunk_split(base64_encode($der), 64, "\n")
         . "-----END EC PRIVATE KEY-----\n";
    return openssl_pkey_get_private($pem);
}

/** A fresh P-256 pair: [private key resource, 65-byte uncompressed point]. */
function wp_generate_keypair(): array
{
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if ($key === false) return [false, ''];
    $d = openssl_pkey_get_details($key);
    // Left-pad: openssl returns the raw coordinates and a leading zero byte is
    // dropped, which happens about once in 256 keys and produces a 64-byte
    // point that every push service rejects.
    $x = str_pad($d['ec']['x'], 32, "\x00", STR_PAD_LEFT);
    $y = str_pad($d['ec']['y'], 32, "\x00", STR_PAD_LEFT);
    return [$key, "\x04" . $x . $y];
}

// ------------------------------------------------------------ the encryption
//
// RFC 8291 section 3.4, in order. Every info string below is exact, including
// the trailing NUL bytes; they are what the vector test is really checking.
//
// $salt and $asKeys exist as parameters ONLY so the known-answer test can pin
// them. Real sends pass null and get fresh randomness, which is required —
// reusing a salt with the same key leaks the plaintext of both messages.
function wp_encrypt(string $payload, string $uaPublic, string $authSecret,
                    ?string $salt = null, ?array $asKeys = null): array
{
    if (strlen($uaPublic) !== 65) return [null, 'p256dh is not a 65-byte point'];
    if (strlen($authSecret) !== 16) return [null, 'auth secret is not 16 bytes'];

    $salt ??= random_bytes(16);
    [$asKey, $asPublic] = $asKeys ?? wp_generate_keypair();
    if ($asKey === false) return [null, 'could not generate a key pair'];

    $uaKey = wp_public_key_from_point($uaPublic);
    if ($uaKey === false) return [null, 'p256dh is not a valid P-256 point'];

    $shared = openssl_pkey_derive($uaKey, $asKey, 32);
    if ($shared === false) return [null, 'ECDH failed'];

    // The "WebPush: info" step is what binds the derived key to BOTH parties'
    // public keys, so a shared secret cannot be replayed against a different
    // subscription. The order is receiver then sender, and swapping them
    // produces a plausible-looking key that decrypts to nothing.
    $ikm = hash_hkdf('sha256', $shared, 32,
                     "WebPush: info\x00" . $uaPublic . $asPublic, $authSecret);

    $cek   = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt);

    // 0x02 is the last-record delimiter of RFC 8188. A single record is always
    // the last one, and using 0x01 here is the classic mistake — it means "more
    // records follow" and the browser waits for a record that never arrives.
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek,
                              OPENSSL_RAW_DATA, $nonce, $tag);
    if ($cipher === false) return [null, 'AES-GCM failed'];

    // salt(16) | record size(4, big-endian) | key id length(1) | key id(65)
    $body = $salt . pack('N', 4096) . chr(65) . $asPublic . $cipher . $tag;
    return [$body, null];
}

// ------------------------------------------------------------------- VAPID
//
// An ES256 JWT saying who this server is, valid for a few hours, addressed to
// the origin of the push service. Apple rejects a token whose `aud` is not the
// exact scheme+host of the endpoint, which is the commonest reason a push that
// works on Chrome fails on iPhone.
function wp_vapid_header(string $endpoint, string $subject,
                         string $publicPoint, string $privateScalar,
                         ?int $now = null): array
{
    $now ??= time();
    $parts = parse_url($endpoint);
    if (!isset($parts['scheme'], $parts['host'])) return [null, 'endpoint is not a URL'];
    // THE PORT BELONGS IN `aud` WHEN THERE IS ONE. An origin is
    // scheme://host[:port], and dropping the port produced a token addressed to
    // something else — caught by webpush-e2e-test.mjs, whose push service runs
    // on 127.0.0.1:8105 and rejected every push with 403. Apple and Google are
    // both on 443, so this would never have failed in production and would
    // never have been found there either.
    $aud = $parts['scheme'] . '://' . $parts['host']
         . (isset($parts['port']) && !in_array((int) $parts['port'], [80, 443], true)
              ? ':' . (int) $parts['port'] : '');

    $header  = wp_b64_encode(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    // 12 hours. The maximum any push service accepts is 24; going near the
    // limit means a token minted just before a clock skew is already expired.
    $claims  = wp_b64_encode(json_encode([
        'aud' => $aud, 'exp' => $now + 43200, 'sub' => $subject,
    ], JSON_UNESCAPED_SLASHES));
    $signing = $header . '.' . $claims;

    $key = wp_private_key_from_scalar($privateScalar, $publicPoint);
    if ($key === false) return [null, 'VAPID private key is not valid'];
    if (!openssl_sign($signing, $der, $key, OPENSSL_ALGO_SHA256)) {
        return [null, 'could not sign the VAPID token'];
    }

    // openssl signs to DER (a SEQUENCE of two INTEGERs). JOSE wants the raw
    // 64-byte r||s. The INTEGERs are signed, so a high bit sets a leading zero
    // that has to come off, and a short value has to be padded back up to 32.
    $raw = wp_der_to_raw_signature($der);
    if ($raw === null) return [null, 'could not convert the signature'];

    return [[
        'Authorization: vapid t=' . $signing . '.' . wp_b64_encode($raw)
            . ', k=' . wp_b64_encode($publicPoint),
    ], null];
}

function wp_der_to_raw_signature(string $der): ?string
{
    $p = 0;
    if (($der[$p++] ?? '') !== "\x30") return null;
    $len = ord($der[$p++] ?? "\x00");
    if ($len & 0x80) $p += $len & 0x7f;          // long form: skip the length bytes
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        if (($der[$p++] ?? '') !== "\x02") return null;
        $n = ord($der[$p++] ?? "\x00");
        $v = substr($der, $p, $n);
        $p += $n;
        $v = ltrim($v, "\x00");                   // drop the sign byte
        if (strlen($v) > 32) return null;
        $out .= str_pad($v, 32, "\x00", STR_PAD_LEFT);
    }
    return strlen($out) === 64 ? $out : null;
}

// --------------------------------------------------------------- the send
//
// Returns [ok, httpStatus, error]. A 404 or 410 means the subscription is dead
// and the caller must DELETE it — a push service will keep answering 410 for a
// removed Home Screen icon for ever, and a queue that retries those never
// drains.
function wp_send(array $sub, string $payload, array $vapid, int $ttl = 86400): array
{
    $endpoint = (string) ($sub['endpoint'] ?? '');
    if ($endpoint === '') return [false, 0, 'no endpoint'];

    [$body, $err] = wp_encrypt(
        $payload,
        wp_b64_decode((string) ($sub['p256dh'] ?? '')),
        wp_b64_decode((string) ($sub['auth'] ?? '')),
    );
    if ($body === null) return [false, 0, $err];

    [$auth, $verr] = wp_vapid_header($endpoint, $vapid['subject'], $vapid['public'], $vapid['private']);
    if ($auth === null) return [false, 0, $verr];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => array_merge($auth, [
            'Content-Type: application/octet-stream',
            'Content-Encoding: aes128gcm',
            'TTL: ' . $ttl,
            // Apple drops a normal-priority push to a sleeping phone. An order
            // is the reason the owner installed this.
            'Urgency: high',
        ]),
    ]);
    $res  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($res === false) return [false, 0, 'curl: ' . ($cerr !== '' ? $cerr : 'failed')];
    if ($code >= 200 && $code < 300) return [true, $code, null];
    return [false, $code, 'push service answered ' . $code . ' ' . substr((string) $res, 0, 200)];
}
