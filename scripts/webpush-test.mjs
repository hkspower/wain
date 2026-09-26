/**
 * The push encryption, against the RFC's own worked example.
 *
 *   node scripts/webpush-test.mjs
 *
 * No server, no database, no network — this is a known-answer test and it runs
 * anywhere PHP does.
 *
 * WHY THIS RIG HAD TO EXIST. api/webpush.php implements three specifications
 * by hand — RFC 8291 (the ECDH and the HKDF chain), RFC 8188 (the aes128gcm
 * framing) and RFC 8292 (the VAPID JWT) — because the shop runs on shared
 * hosting with no Composer and vendoring web-push-php's dozen packages was not
 * worth it. That decision is defensible. What made it dangerous is the failure
 * mode:
 *
 *     GET ONE BYTE WRONG AND EVERYTHING STILL REPORTS SUCCESS.
 *
 * The push service does not hold the key. It cannot read the payload either,
 * so it answers 201 Created for a correctly-framed body whatever the
 * ciphertext contains. The phone simply never buzzes. Nothing appears in any
 * log, no exception is thrown, and the only symptom is a customer who was
 * never told their order shipped. A wrong info string, the receiver and sender
 * keys swapped in the "WebPush: info" step, a 0x01 record delimiter instead of
 * 0x02 — each one is silent, and each one is a plausible typo.
 *
 * webpush.php's own header comment said this rig existed. It did not. The two
 * test hooks it needs were already in wp_encrypt's signature — the optional
 * $salt and $asKeys arguments exist for no other purpose — so the file was
 * written to be tested this way and then never was.
 *
 * WHAT A KNOWN-ANSWER TEST BUYS. Fixing the salt and the sender key pair makes
 * the whole encryption deterministic, so the RFC's published output is an exact
 * expected value: not "it produced 155 bytes that look right" but "it produced
 * these bytes". Every step is covered at once, because any error anywhere in
 * the chain changes the ciphertext completely.
 *
 * THE VECTOR IS RFC 8291 SECTION 5 VERBATIM. If this test ever fails, the
 * suspect is webpush.php, not the vector — check the code against the RFC
 * before touching either.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'

const API = new URL('../sporta-site/public_html/api/', import.meta.url).pathname
const TMP = '/tmp/sporta-webpush-probe.php'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

// --- RFC 8291 section 5, "Push Message Encryption Example" -----------------
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInm'
      + 'YWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQ'
      + 'exSgSxsj_Qulcy4a-fN',
}

// The probe runs inside PHP because that is where the implementation lives.
// It reports as JSON so a crash is distinguishable from a wrong answer.
const probe = `<?php
declare(strict_types=1);
require '${API}webpush.php';

$out = [];
$auth     = wp_b64_decode('${V.auth}');
$uaPublic = wp_b64_decode('${V.uaPublic}');
$asPub    = wp_b64_decode('${V.asPublic}');
$asPriv   = wp_b64_decode('${V.asPrivate}');
$salt     = wp_b64_decode('${V.salt}');

$out['auth_len']  = strlen($auth);
$out['ua_len']    = strlen($uaPublic);
$out['as_pub_len'] = strlen($asPub);

// Rebuild the sender key from the RFC's scalar so the ECDH is deterministic.
$asKey = wp_private_key_from_scalar($asPriv, $asPub);
$out['as_key_ok'] = $asKey !== false;

if ($asKey !== false) {
    [$body, $err] = wp_encrypt('${V.plaintext}', $uaPublic, $auth, $salt, [$asKey, $asPub]);
    $out['err']  = $err;
    $out['body'] = $body === null ? null : wp_b64_encode($body);
    $out['len']  = $body === null ? 0 : strlen($body);
}

// The two guards, which are the only inputs a caller controls.
[$b1, $e1] = wp_encrypt('x', substr($uaPublic, 0, 64), $auth);
$out['short_point'] = $e1;
[$b2, $e2] = wp_encrypt('x', $uaPublic, substr($auth, 0, 15));
$out['short_auth'] = $e2;

echo json_encode($out);
`

writeFileSync(TMP, probe)
let got
try {
  const raw = execFileSync('php', [TMP], { encoding: 'utf8' })
  got = JSON.parse(raw)
} catch (e) {
  console.log('FAIL the probe did not run —', (e.stdout || e.message || '').toString().slice(0, 400))
  process.exit(1)
} finally {
  try { unlinkSync(TMP) } catch {}
}

// --- the decoder, before anything that depends on it -----------------------
// base64url with the padding stripped. If this is wrong every length below is
// wrong too, and the ciphertext comparison would fail for a reason that has
// nothing to do with the encryption.
check(got.auth_len === 16, 'the auth secret decodes to 16 bytes', `got ${got.auth_len}`)
check(got.ua_len === 65, 'the receiver key decodes to a 65-byte P-256 point', `got ${got.ua_len}`)
check(got.as_pub_len === 65, 'the sender key decodes to a 65-byte P-256 point', `got ${got.as_pub_len}`)

// --- the key rebuilt from a raw scalar -------------------------------------
// wp_private_key_from_scalar hand-assembles a DER key, because PHP has no way
// to load a bare P-256 scalar. It is the least ordinary code in the file.
check(got.as_key_ok === true,
  'a private key can be rebuilt from a raw 32-byte scalar')

// --- and the answer --------------------------------------------------------
check(!got.err, 'the encryption reports no error', got.err || '')
check(got.body === V.body,
  'the encrypted body is byte-for-byte the one RFC 8291 section 5 publishes',
  got.body ? `got ${got.len} bytes\n       want ${V.body}\n       got  ${got.body}` : 'no body')

// --- the guards ------------------------------------------------------------
// Both are cheap and both protect against a subscription row that has been
// truncated in the database, which is the realistic way these get hit.
check(got.short_point === 'p256dh is not a 65-byte point',
  'a truncated p256dh is refused rather than encrypted to nothing', got.short_point || 'accepted')
check(got.short_auth === 'auth secret is not 16 bytes',
  'a truncated auth secret is refused', got.short_auth || 'accepted')

console.log(fails
  ? `\n${fails} failed`
  : '\nall ok — the push encryption matches the RFC, byte for byte')
process.exit(fails ? 1 : 0)
