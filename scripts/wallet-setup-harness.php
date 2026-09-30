<?php
/**
 * Test harness for api/wallet-setup.php, driven by scripts/wallet-setup-test.mjs.
 *
 *   php scripts/wallet-setup-harness.php <case> <certDir> <workDir>
 *
 * One case per process, because store_fail() ends the process: a refusal is
 * the JSON the route would send, printed by the real code path.
 *
 * THE AUTHORITY IS A STAND-IN, made here, because the sandbox cannot reach
 * Apple. It is passed to wallet_install_cert() as a function argument, the
 * same seam production leaves null, so nothing about the checks is weakened
 * to suit the test.
 */
declare(strict_types=1);

[$_, $case, $dir, $work] = $argv + [null, null, null, null];
if (!$case || !$dir || !$work) { fwrite(STDERR, "usage: case certDir workDir\n"); exit(2); }

require __DIR__ . '/../sporta-site/public_html/api/store.php';
require __DIR__ . '/../sporta-site/public_html/api/wallet-setup.php';

$cfg = ['wallet_cert_dir' => $dir];

/** A certificate authority, made once per work dir and reused. */
function ca(string $work, string $name = 'ca'): array {
    $k = "$work/$name.key"; $c = "$work/$name.pem";
    if (!is_file($k)) {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        $csr = openssl_csr_new(['commonName' => "Stand-in WWDR $name"], $key, ['digest_alg' => 'sha256']);
        $crt = openssl_csr_sign($csr, null, $key, 30, ['digest_alg' => 'sha256']);
        openssl_x509_export($crt, $pem); openssl_pkey_export($key, $kp);
        file_put_contents($c, $pem); file_put_contents($k, $kp);
    }
    return [file_get_contents($c), file_get_contents($k)];
}

/** A pass certificate for $keyPem, issued by the stand-in authority. */
function issue(string $work, string $keyPem, string $uid, string $ou, int $days = 365, string $caName = 'ca'): string {
    [$caPem, $caKey] = ca($work, $caName);
    $dn = ['UID' => $uid, 'commonName' => "Pass Type ID: $uid", 'organizationalUnitName' => $ou,
           'organizationName' => 'Sporta Test', 'countryName' => 'KW'];
    $csr = openssl_csr_new($dn, $keyPem, ['digest_alg' => 'sha256']);
    $crt = openssl_csr_sign($csr, $caPem, $caKey, $days, ['digest_alg' => 'sha256'], random_int(1, PHP_INT_MAX));
    openssl_x509_export($crt, $pem);
    // Apple hands over DER, not PEM.
    return base64_decode(preg_replace('/-----[^-]+-----|\s/', '', $pem));
}

function freshKey(): string {
    $k = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
    openssl_pkey_export($k, $pem);
    return $pem;
}

$pending = fn () => (string) @file_get_contents("$dir/pending.key");
$authority = fn () => [ca($work)[0]];

switch ($case) {
    case 'status':
        echo json_encode(wallet_status($cfg));
        break;
    case 'request':
        $csr = wallet_make_request($cfg);
        echo json_encode(['csrOk' => str_contains($csr, 'CERTIFICATE REQUEST'), 'csrHasKey' => str_contains($csr, 'PRIVATE KEY')]);
        break;
    case 'install':         // the happy path, from the pending request
        echo json_encode(wallet_install_cert($cfg, issue($work, $pending(), WALLET_PASS_TYPE_ID, 'TEAM123456'), $authority()));
        break;
    case 'wrong-type':
        wallet_install_cert($cfg, issue($work, $pending(), 'pass.com.somebody.else', 'TEAM123456'), $authority());
        break;
    case 'expired':         // PHP will not issue one already expired: 0 days
                            // expires at the moment of issue, then wait past it
        $cer = issue($work, $pending(), WALLET_PASS_TYPE_ID, 'TEAM123456', 0);
        sleep(2);
        wallet_install_cert($cfg, $cer, $authority());
        break;
    case 'other-key':       // a request made on some other machine
        wallet_install_cert($cfg, issue($work, freshKey(), WALLET_PASS_TYPE_ID, 'TEAM123456'), $authority());
        break;
    case 'wrong-authority': // not signed by the intermediate offered
        wallet_install_cert($cfg, issue($work, $pending(), WALLET_PASS_TYPE_ID, 'TEAM123456', 365, 'rogue'), $authority());
        break;
    case 'garbage':
        wallet_install_cert($cfg, 'this is not a certificate', $authority());
        break;
    case 'empty-dir':       // the live config.php's `'wallet_cert_dir' => ''`
        echo json_encode(['dir' => wallet_cert_dir(['wallet_cert_dir' => ''])]);
        break;
    case 'team':
        echo json_encode(['team' => wallet_team_id(['wallet_team_id' => 'CONFIG0000'], $dir)]);
        break;
    default:
        fwrite(STDERR, "unknown case $case\n"); exit(2);
}
