<?php
/**
 * Apple Wallet: the shop's link to the owner's Apple Developer account.
 *
 * Asked for on 2026-09-26 as "link my apple dev with sporta", choosing a setup
 * card in /backends over the manual Keychain-and-openssl route in WALLET.md.
 * Used by admin.php (the three setup routes) and wallet.php (which signs).
 *
 * THE FLOW, all of it on this server:
 *
 *   1. wallet_make_request()  makes an RSA key and a certificate signing
 *      request. The key is written next to the certificates and NEVER leaves
 *      the server; only the request goes to the owner, to upload at Apple.
 *   2. Apple returns pass.cer. wallet_install_cert() checks it and, only if
 *      every check passes, installs it with its key and Apple's intermediate.
 *
 * WHY THE KEY IS "PENDING" UNTIL APPLE'S FILE ARRIVES. Making a new request
 * must not break a shop whose card already works (a renewal, or a mis-click).
 * So the new key waits as pending.key, and pass.key is replaced only when a
 * certificate that PROVES it belongs to that key is installed.
 *
 * THE TEAM ID HAS ONE HOME: THE CERTIFICATE. Apple writes it into the
 * certificate's subject (OU), and a pass whose teamIdentifier differs from its
 * signing certificate is refused by every iPhone. Reading it from the
 * certificate means it can never be mistyped and never disagree with the key
 * that signs. config.php's wallet_team_id is only a fallback for a shop set up
 * by hand before this existed.
 *
 * NOTHING HERE PRINTS A SECRET. The status reports whether each file is
 * present, the certificate's public facts (team id, expiry), never a byte of
 * the private key.
 */

declare(strict_types=1);

const WALLET_PASS_TYPE_ID = 'pass.kw.com.sporta.card';

/** Apple's Worldwide Developer Relations intermediates, newest first. Which one
 *  issued a given pass certificate has changed over the years (G4 today), so
 *  the one that actually verifies the certificate's signature is the one kept,
 *  rather than a name guessed here. */
const WALLET_WWDR_URLS = [
    'https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer',
    'https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer',
    'https://www.apple.com/certificateauthority/AppleWWDRCAG5.cer',
    'https://www.apple.com/certificateauthority/AppleWWDRCAG6.cer',
];

/** Outside public_html, so nothing here is ever served.
 *
 *  AN EMPTY SETTING MEANS UNSET. The live config.php carries
 *  `'wallet_cert_dir' => ''` (measured 2026-09-26), and `??` does not replace
 *  an empty string, so the old one-liner resolved to '' and every path became
 *  '/pass.pem' at the filesystem root. */
function wallet_cert_dir(array $cfg): string {
    $set = trim((string) ($cfg['wallet_cert_dir'] ?? ''));
    return rtrim($set !== '' ? $set : dirname(__DIR__, 2) . '/wallet-certs', '/');
}

/** DER or PEM in, PEM out; null when it is neither. */
function wallet_to_pem(string $bytes): ?string {
    if (str_contains($bytes, '-----BEGIN CERTIFICATE-----')) {
        return @openssl_x509_read($bytes) ? $bytes : null;
    }
    $pem = "-----BEGIN CERTIFICATE-----\n" . chunk_split(base64_encode($bytes), 64, "\n")
         . "-----END CERTIFICATE-----\n";
    return @openssl_x509_read($pem) ? $pem : null;
}

/** The team id Apple wrote into the certificate, or '' when there is none. */
function wallet_team_from_cert(string $certDir): string {
    $pem = @file_get_contents($certDir . '/pass.pem');
    if (!is_string($pem) || $pem === '') return '';
    $info = openssl_x509_parse($pem);
    $ou = $info['subject']['OU'] ?? '';
    if (is_array($ou)) $ou = (string) reset($ou);
    return preg_match('/^[A-Z0-9]{10}$/', (string) $ou) ? (string) $ou : '';
}

/** The team id the signer should use: the certificate's, else config's. */
function wallet_team_id(array $cfg, string $certDir): string {
    $fromCert = wallet_team_from_cert($certDir);
    return $fromCert !== '' ? $fromCert : (string) ($cfg['wallet_team_id'] ?? '');
}

/** What the setup card shows. Public facts only. */
function wallet_status(array $cfg): array {
    $dir = wallet_cert_dir($cfg);
    $pem = @file_get_contents($dir . '/pass.pem');
    $info = is_string($pem) && $pem !== '' ? openssl_x509_parse($pem) : false;
    $team = wallet_team_id($cfg, $dir);
    $expires = $info ? (int) ($info['validTo_time_t'] ?? 0) : 0;
    $haveCert = $info !== false;
    $haveKey  = is_file($dir . '/pass.key');
    $haveWwdr = is_file($dir . '/wwdr.pem');
    return [
        'pass_type_id'    => WALLET_PASS_TYPE_ID,
        'team_id'         => $team,
        'team_source'     => wallet_team_from_cert($dir) !== '' ? 'certificate' : ($team !== '' ? 'config' : 'none'),
        'certificate'     => $haveCert,
        'key'             => $haveKey,
        'apple_intermediate' => $haveWwdr,
        'request_pending' => is_file($dir . '/pending.key') && is_file($dir . '/pending.csr'),
        'expires'         => $expires > 0 ? gmdate('Y-m-d', $expires) : null,
        'expired'         => $expires > 0 && $expires < time(),
        'ready'           => $haveCert && $haveKey && $haveWwdr && $team !== '' && !($expires > 0 && $expires < time()),
    ];
}

function wallet_ensure_dir(string $dir): void {
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) store_fail('wallet_dir_not_writable', 500);
    @chmod($dir, 0700);
    if (!is_writable($dir)) store_fail('wallet_dir_not_writable', 500);
}

/** Write a file so it is never readable by anyone but this account, not even
 *  for the instant between write and chmod. */
function wallet_write_private(string $path, string $bytes): void {
    $old = umask(0077);
    $ok = @file_put_contents($path . '.tmp', $bytes) === strlen($bytes) && @rename($path . '.tmp', $path);
    umask($old);
    if (!$ok) { @unlink($path . '.tmp'); store_fail('wallet_dir_not_writable', 500); }
    @chmod($path, 0600);
}

/**
 * Step 1: a new key and the request for Apple. Returns the request (public;
 * it contains only the public half of the key).
 */
function wallet_make_request(array $cfg): string {
    $dir = wallet_cert_dir($cfg);
    wallet_ensure_dir($dir);
    $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
    if (!$key) store_fail('wallet_key_failed', 500);
    // Apple replaces the subject with its own; these fields only need to be
    // well-formed. The address is not collected and is not needed.
    $csr = openssl_csr_new(['commonName' => 'Sporta Wallet', 'organizationName' => 'Sporta', 'countryName' => 'KW'],
                           $key, ['digest_alg' => 'sha256']);
    if (!$csr || !openssl_csr_export($csr, $csrPem) || !openssl_pkey_export($key, $keyPem)) {
        store_fail('wallet_key_failed', 500);
    }
    wallet_write_private($dir . '/pending.key', $keyPem);
    wallet_write_private($dir . '/pending.csr', $csrPem);
    return $csrPem;
}

/**
 * Step 2: install Apple's certificate. Every check happens BEFORE anything is
 * written, so a wrong file changes nothing.
 *
 * $wwdrCandidates is a FUNCTION ARGUMENT, never a request field, so nothing a
 * visitor sends can substitute the authority a certificate is checked against.
 * Production passes null and the list is fetched from Apple; the test rig
 * passes its own stand-in authority, because the sandbox cannot reach Apple.
 */
function wallet_install_cert(array $cfg, string $cerBytes, ?array $wwdrCandidates = null): array {
    $dir = wallet_cert_dir($cfg);
    wallet_ensure_dir($dir);

    $pem = wallet_to_pem($cerBytes);
    if ($pem === null) store_fail('cert_unreadable');
    $info = openssl_x509_parse($pem);
    if (!$info) store_fail('cert_unreadable');

    // THE RIGHT KIND OF CERTIFICATE. A pass certificate names its pass type
    // in the subject's UID. An iOS app or push certificate uploaded here by
    // mistake would install happily and sign passes no iPhone accepts.
    $uid = $info['subject']['UID'] ?? ($info['subject']['userId'] ?? '');
    if (is_array($uid)) $uid = (string) reset($uid);
    if ((string) $uid !== WALLET_PASS_TYPE_ID) store_fail('cert_wrong_pass_type');

    if ((int) ($info['validTo_time_t'] ?? 0) < time()) store_fail('cert_expired');

    $ou = $info['subject']['OU'] ?? '';
    if (is_array($ou)) $ou = (string) reset($ou);
    if (!preg_match('/^[A-Z0-9]{10}$/', (string) $ou)) store_fail('cert_no_team_id');

    // WHICH KEY IT BELONGS TO. The pending one (a new request) or the current
    // one (a renewal made from the same key). Neither means the request was
    // made somewhere else, and the certificate is useless here without the
    // key that stayed on that other machine.
    $keyFile = null;
    foreach (['pending.key', 'pass.key'] as $candidate) {
        $k = @file_get_contents($dir . '/' . $candidate);
        if (is_string($k) && $k !== '' && openssl_x509_check_private_key($pem, $k)) { $keyFile = $candidate; break; }
    }
    if ($keyFile === null) store_fail('cert_key_mismatch');

    // APPLE'S INTERMEDIATE: the one that actually signed this certificate.
    $wwdrPem = null;
    $candidates = $wwdrCandidates;
    if ($candidates === null) {
        $candidates = [];
        foreach (WALLET_WWDR_URLS as $url) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 15]);
            $body = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if (is_string($body) && $code === 200) $candidates[] = $body;
        }
    }
    foreach ($candidates as $c) {
        $cp = wallet_to_pem((string) $c);
        if ($cp !== null && openssl_x509_verify($pem, $cp) === 1) { $wwdrPem = $cp; break; }
    }
    if ($wwdrPem === null) store_fail('wwdr_unavailable', 502);

    // Everything checked. Now, and only now, write.
    if ($keyFile === 'pending.key') {
        wallet_write_private($dir . '/pass.key', (string) file_get_contents($dir . '/pending.key'));
    }
    wallet_write_private($dir . '/pass.pem', $pem);
    wallet_write_private($dir . '/wwdr.pem', $wwdrPem);
    @unlink($dir . '/pending.key');
    @unlink($dir . '/pending.csr');

    return wallet_status($cfg);
}
