<?php
/**
 * Write the VAPID key pair into the live api/config.php.
 *
 *   php r.php <base64 of the public key> <base64 of the private key>
 *
 * config.php is git-ignored — it holds the database password and every other
 * secret this shop has — so this cannot be a normal fetch-and-verify
 * publisher pinned to a commit; there is no commit to pin, and there must
 * never be one. It patches the live file in place instead, the same shape
 * reset-admin-password.php uses for the same reason: base64 arguments
 * (config.example.php's own generation output is base64url — letters,
 * digits, `_` and `-`, which survives this channel unquoted, but decoding it
 * from base64 anyway costs nothing and matches the one CLI convention this
 * project already uses for anything secret-shaped on this channel).
 *
 * REFUSES IF EITHER KEY IS ALREADY SET. config.example.php's own comment:
 * "THE PAIR IS PERMANENT. Every subscription a phone has already made is
 * bound to the public key it was created with... changing these silently
 * kills every existing subscription." A blank vapid_public is what makes it
 * safe to write once; a script that overwrote a real pair on a second run
 * would be the exact mistake that comment exists to prevent. If a real
 * subscriber ever exists, killing it needs to be a decision, not a rerun.
 *
 * REFUSES A PLACEHOLDER-SHAPED KEY TOO — empty after trimming whitespace, or
 * shorter than a real P-256 point/scalar can be — the same shape guard
 * reset-admin-password.php's own password-length check gives a different
 * secret.
 */

$PATH = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';

$pubB64 = $argv[1] ?? '';
$privB64 = $argv[2] ?? '';
$pub = $pubB64 === '' ? '' : base64_decode($pubB64, true);
$priv = $privB64 === '' ? '' : base64_decode($privB64, true);

if ($pub === false || $priv === false || $pub === '' || $priv === '') {
    echo "SETVAPID no_argument\n";
    exit;
}
// A real P-256 uncompressed point is 65 bytes -> 87 base64url chars; the
// private scalar is 32 bytes -> 43. Anything much shorter is not a key.
if (strlen($pub) < 80 || strlen($priv) < 40) {
    echo "SETVAPID key_too_short\n";
    exit;
}

$src = file_get_contents($PATH);
if ($src === false) {
    echo "SETVAPID cannot_read_config\n";
    exit;
}

if (!preg_match("/'vapid_public'\\s*=>\\s*'([^']*)'/", $src, $mPub)
    || !preg_match("/'vapid_private'\\s*=>\\s*'([^']*)'/", $src, $mPriv)) {
    echo "SETVAPID keys_not_found_in_config\n";
    exit;
}

if (trim($mPub[1]) !== '' || trim($mPriv[1]) !== '') {
    echo 'SETVAPID already_set pub_len=' . strlen($mPub[1]) . ' priv_len=' . strlen($mPriv[1]) . "\n";
    exit;
}

$new = preg_replace("/'vapid_public'\\s*=>\\s*'[^']*'/", "'vapid_public'  => '" . $pub . "'", $src, 1);
$new = preg_replace("/'vapid_private'\\s*=>\\s*'[^']*'/", "'vapid_private' => '" . $priv . "'", $new, 1);

if ($new === $src) {
    echo "SETVAPID no_change_made\n";
    exit;
}

$tmp = dirname($PATH) . '/.pub-' . bin2hex(random_bytes(6));
$ok = @file_put_contents($tmp, $new) === strlen($new);
if ($ok) $ok = @rename($tmp, $PATH);
@unlink($tmp);

if (!$ok) {
    echo "SETVAPID write_failed\n";
    exit;
}

@chmod($PATH, 0644);

$check = file_get_contents($PATH);
preg_match("/'vapid_public'\\s*=>\\s*'([^']*)'/", $check, $cPub);
preg_match("/'vapid_private'\\s*=>\\s*'([^']*)'/", $check, $cPriv);

echo 'SETVAPID wrote=1 pub_matches=' . ((($cPub[1] ?? '') === $pub) ? 'yes' : 'no')
   . ' priv_matches=' . ((($cPriv[1] ?? '') === $priv) ? 'yes' : 'no')
   . "\n";
