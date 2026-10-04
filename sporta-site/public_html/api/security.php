<?php
/**
 * THE PANEL'S SIGN-IN HARDENING — 2026-10-04 ("make full backend login improve and full secure
 * backend"). Included by admin.php; store.php calls three small hooks from here (session row on
 * grant, row check on every request, row revoked on logout). Tables: api/security.mysql.sql.
 *
 *  1. ACTIVE SESSIONS (admin_sessions). A PHP session file cannot be listed or revoked from another
 *     browser, so every grant also writes a row keyed by sha256(session id). store_session_admin()
 *     requires the row to be present and not revoked; a session from before the table existed is
 *     ADOPTED (a row is written for it) rather than thrown out, so the migration signs nobody out.
 *     "Sign out everywhere" revokes every row but the current one; "sign out that device" one row.
 *     A password change revokes every OTHER session.
 *
 *  2. PASSKEYS (WebAuthn, admin_passkeys). Registration: attestation 'none', the authenticator data
 *     parsed here (CBOR decoded by hand — maps, arrays, byte/text strings, integers are all a COSE key
 *     needs), ES256 (P-256) and RS256 keys accepted, user verification REQUIRED. Sign-in: the
 *     assertion's clientDataJSON (type, challenge, origin) and authenticatorData (rpIdHash, UP, UV)
 *     are checked, the signature verified by OpenSSL over authData || sha256(clientDataJSON), the sign
 *     counter must not go backwards. A passkey with UV is possession + a biometric or PIN, so it signs
 *     in with no second code — that is what the second factor was for.
 *     The challenge lives in the PHP session (one per step, consumed on use, 5 minutes).
 *
 *  3. POLICIES (settings row `security`): `require_2fa` makes every account without TOTP or email OTP
 *     take an email code at sign-in anyway (when mail is configured; otherwise the setting cannot be
 *     switched on — a policy that locks the owner out is refused by name). `ip_allow` is a list of
 *     IPs/CIDRs that SIGN-IN routes accept from; saving a list that does not include the address you
 *     are saving from is refused (`ip_allow_locks_you_out`), and signed-in sessions are never cut.
 *
 *  4. BREACHED PASSWORDS: store_password_pwned() asks Have I Been Pwned's range API (k-anonymity: five
 *     hex characters of the SHA-1 leave, never the password), 2-second timeout, fail-OPEN — an API
 *     outage must not stop the owner changing a password. Applied on every route that sets one.
 */
declare(strict_types=1);

// ------------------------------------------------------------------ sessions
function sec_tables_ready(PDO $db): bool {
    static $ready = null;
    if ($ready !== null) return $ready;
    try { $db->query('select 1 from admin_sessions limit 1'); $db->query('select 1 from admin_passkeys limit 1'); $ready = true; }
    catch (Throwable $e) { $ready = false; }
    return $ready;
}
function sec_sid_hash(): string { return hash('sha256', (string) session_id()); }

/** Called from store_admin_grant(): record this browser. */
function sec_session_record(PDO $db, int $adminId, string $method = 'password'): void {
    try {
        if (!sec_tables_ready($db)) return;
        $db->prepare('insert into admin_sessions (sid_hash, admin_id, ip, agent, method) values (?, ?, ?, ?, ?)
                      on duplicate key update admin_id = values(admin_id), ip = values(ip), agent = values(agent), method = values(method), revoked_at = null, last_seen = now()')
           ->execute([sec_sid_hash(), $adminId, mb_substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45), mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200), mb_substr($method, 0, 16)]);
        if (random_int(1, 40) === 1) $db->exec('delete from admin_sessions where (revoked_at is not null and revoked_at < now() - interval 30 day) or last_seen < now() - interval 14 day');
    } catch (Throwable $e) { /* never block a sign-in on the ledger */ }
}
/** Called from store_session_admin(): is this session still allowed? Adopts rows the table never saw. */
function sec_session_alive(int $adminId): bool {
    try {
        $db = store_db();
        if (!sec_tables_ready($db)) return true;
        $q = $db->prepare('select id, revoked_at, last_seen from admin_sessions where sid_hash = ?');
        $q->execute([sec_sid_hash()]);
        $row = $q->fetch();
        if (!$row) { sec_session_record($db, $adminId, 'adopted'); return true; }
        if ($row['revoked_at'] !== null) return false;
        if (time() - strtotime((string) $row['last_seen']) > 60) $db->prepare('update admin_sessions set last_seen = now() where id = ?')->execute([(int) $row['id']]);
        return true;
    } catch (Throwable $e) { return true; }
}
/** Called from store_session_end(). */
function sec_session_revoke_current(): void {
    try { $db = store_db(); if (!sec_tables_ready($db)) return; $db->prepare('update admin_sessions set revoked_at = now() where sid_hash = ? and revoked_at is null')->execute([sec_sid_hash()]); } catch (Throwable $e) {}
}
function sec_sessions_list(PDO $db, int $adminId): array {
    $q = $db->prepare('select id, sid_hash, created_at, last_seen, ip, agent, method from admin_sessions where admin_id = ? and revoked_at is null order by last_seen desc');
    $q->execute([$adminId]);
    $me = sec_sid_hash(); $out = [];
    foreach ($q->fetchAll() as $s) $out[] = ['id' => (int) $s['id'], 'current' => $s['sid_hash'] === $me, 'created_at' => $s['created_at'], 'last_seen' => $s['last_seen'], 'ip' => $s['ip'], 'agent' => $s['agent'], 'method' => $s['method']];
    return $out;
}
function sec_sessions_revoke_others(PDO $db, int $adminId): int {
    $q = $db->prepare('update admin_sessions set revoked_at = now() where admin_id = ? and revoked_at is null and sid_hash <> ?');
    $q->execute([$adminId, sec_sid_hash()]);
    return $q->rowCount();
}

// ------------------------------------------------------------------ policies
function sec_policy(PDO $db): array {
    $s = store_setting($db, 'security');
    return ['require_2fa' => !empty($s['require_2fa']), 'ip_allow' => array_values(array_filter(array_map('strval', is_array($s['ip_allow'] ?? null) ? $s['ip_allow'] : [])))];
}
function sec_ip_in(string $ip, string $rule): bool {
    $rule = trim($rule);
    if ($rule === '') return false;
    if (strpos($rule, '/') === false) return inet_pton($ip) !== false && inet_pton($rule) !== false && inet_pton($ip) === inet_pton($rule);
    [$net, $bits] = explode('/', $rule, 2);
    $a = inet_pton($ip); $n = inet_pton($net);
    if ($a === false || $n === false || strlen($a) !== strlen($n) || !ctype_digit($bits)) return false;
    $bits = (int) $bits; $max = strlen($a) * 8;
    if ($bits < 0 || $bits > $max) return false;
    for ($i = 0; $i < $bits; $i++) {
        $byte = intdiv($i, 8); $mask = 0x80 >> ($i % 8);
        if ((ord($a[$byte]) & $mask) !== (ord($n[$byte]) & $mask)) return false;
    }
    return true;
}
function sec_ip_rule_ok(string $rule): bool {
    $rule = trim($rule);
    if ($rule === '' || strlen($rule) > 60) return false;
    if (strpos($rule, '/') === false) return inet_pton($rule) !== false;
    [$net, $bits] = explode('/', $rule, 2);
    $n = inet_pton($net);
    return $n !== false && ctype_digit($bits) && (int) $bits <= strlen($n) * 8;
}
/** Sign-in routes call this first: 403 when an allowlist exists and this address is not on it. */
function sec_signin_ip_gate(PDO $db): void {
    $p = sec_policy($db);
    if (!$p['ip_allow']) return;
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    foreach ($p['ip_allow'] as $rule) if (sec_ip_in($ip, $rule)) return;
    try { store_admin_login_log($db, 'ip_gate', 'ip_not_allowed', null, null); } catch (Throwable $e) {}
    store_fail('ip_not_allowed', 403);
}
/** The settings_save branch for `security`. */
function sec_policy_validate(PDO $db, array $v): array {
    $cfg = store_config();
    $req = !empty($v['require_2fa']);
    if ($req && trim((string) ($cfg['mail_from'] ?? '')) === '') store_fail('require_2fa_needs_mail');
    $rules = [];
    foreach (array_slice(is_array($v['ip_allow'] ?? null) ? $v['ip_allow'] : [], 0, 30) as $i => $r) {
        $r = trim((string) $r);
        if ($r === '') continue;
        if (!sec_ip_rule_ok($r)) store_fail('ip_allow_bad_rule_' . ($i + 1));
        $rules[] = $r;
    }
    if ($rules) {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $me = false; foreach ($rules as $r) if (sec_ip_in($ip, $r)) $me = true;
        if (!$me) store_fail('ip_allow_locks_you_out');
    }
    return ['require_2fa' => $req, 'ip_allow' => array_values(array_unique($rules))];
}

// --------------------------------------------------------- breached passwords
/** true = seen in a breach, false = not seen, null = could not ask (fail open). */
function store_password_pwned(string $password): ?bool {
    $sha = strtoupper(sha1($password));
    $ctx = stream_context_create(['http' => ['timeout' => 2, 'method' => 'GET', 'header' => "Add-Padding: true\r\nUser-Agent: Sporta-shop-password-check\r\n"]]);
    $body = @file_get_contents('https://api.pwnedpasswords.com/range/' . substr($sha, 0, 5), false, $ctx);
    if ($body === false || $body === '') return null;
    $suffix = substr($sha, 5);
    foreach (explode("\n", $body) as $line) {
        $line = trim($line);
        if ($line === '' || strncmp($line, $suffix, 35) !== 0) continue;
        $n = (int) substr($line, 36);
        return $n > 0;
    }
    return false;
}
/** The shared check for every route that sets a password: length, the weak-pattern list, breaches. */
function sec_password_refuse(string $new, string $email): void {
    if (strlen($new) < 12) store_fail('password_too_short');
    if (($weak = store_password_is_weak($new, $email)) !== null) store_fail($weak);
    if (store_password_pwned($new) === true) store_fail('password_pwned');
}

// ------------------------------------------------------------------- passkeys
function sec_b64u(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function sec_unb64u(string $s): string { $d = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true); return $d === false ? '' : $d; }
function sec_rp_id(): string { $h = strtolower((string) ($_SERVER['HTTP_HOST'] ?? 'localhost')); return preg_replace('/:\d+$/', '', $h); }
function sec_origin(): string { return (store_is_https() ? 'https://' : 'http://') . strtolower((string) ($_SERVER['HTTP_HOST'] ?? 'localhost')); }

/** A small CBOR decoder: exactly what attestationObject and a COSE key need. */
function sec_cbor(string $b, int &$i) {
    if ($i >= strlen($b)) throw new RuntimeException('cbor_eof');
    $ib = ord($b[$i++]); $maj = $ib >> 5; $ai = $ib & 0x1f;
    $len = $ai;
    if ($ai === 24) { $len = ord($b[$i]); $i += 1; }
    elseif ($ai === 25) { $len = unpack('n', substr($b, $i, 2))[1]; $i += 2; }
    elseif ($ai === 26) { $len = unpack('N', substr($b, $i, 4))[1]; $i += 4; }
    elseif ($ai === 27) { $len = unpack('J', substr($b, $i, 8))[1]; $i += 8; }
    elseif ($ai > 27) throw new RuntimeException('cbor_indefinite');
    switch ($maj) {
        case 0: return $len;
        case 1: return -1 - $len;
        case 2: $s = substr($b, $i, $len); $i += $len; return ['bytes' => $s];
        case 3: $s = substr($b, $i, $len); $i += $len; return $s;
        case 4: $a = []; for ($k = 0; $k < $len; $k++) $a[] = sec_cbor($b, $i); return $a;
        case 5: $m = []; for ($k = 0; $k < $len; $k++) { $key = sec_cbor($b, $i); $m[is_array($key) ? ($key['bytes'] ?? '') : (string) $key] = sec_cbor($b, $i); } return $m;
        case 7: if ($ai === 20) return false; if ($ai === 21) return true; if ($ai === 22) return null; throw new RuntimeException('cbor_simple');
        default: throw new RuntimeException('cbor_major');
    }
}
function sec_der_len(int $n): string { if ($n < 0x80) return chr($n); $s = ltrim(pack('N', $n), "\0"); return chr(0x80 | strlen($s)) . $s; }
function sec_der(int $tag, string $body): string { return chr($tag) . sec_der_len(strlen($body)) . $body; }
function sec_der_int(string $bin): string { $bin = ltrim($bin, "\0"); if ($bin === '' || (ord($bin[0]) & 0x80)) $bin = "\0" . $bin; return sec_der(0x02, $bin); }
/** COSE key map → [PEM, alg] or null. */
function sec_cose_to_pem(array $k): ?array {
    $kty = $k['1'] ?? null; $alg = (int) ($k['3'] ?? 0);
    if ($kty === 2 && $alg === -7 && ($k['-1'] ?? null) === 1) {   // EC2, ES256, P-256
        $x = $k['-2']['bytes'] ?? ''; $y = $k['-3']['bytes'] ?? '';
        if (strlen($x) !== 32 || strlen($y) !== 32) return null;
        $algId = sec_der(0x30, sec_der(0x06, "\x2a\x86\x48\xce\x3d\x02\x01") . sec_der(0x06, "\x2a\x86\x48\xce\x3d\x03\x01\x07"));
        $spki = sec_der(0x30, $algId . sec_der(0x03, "\0\x04" . $x . $y));
        return ["-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n", -7];
    }
    if ($kty === 3 && $alg === -257) {   // RSA, RS256
        $n = $k['-1']['bytes'] ?? ''; $e = $k['-2']['bytes'] ?? '';
        if (strlen($n) < 256 || $e === '') return null;
        $rsa = sec_der(0x30, sec_der_int($n) . sec_der_int($e));
        $algId = sec_der(0x30, sec_der(0x06, "\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01") . "\x05\x00");
        $spki = sec_der(0x30, $algId . sec_der(0x03, "\0" . $rsa));
        return ["-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n", -257];
    }
    return null;
}
/** authenticatorData → [rpIdHash, flags, signCount, credentialId|null, coseKey|null]. */
function sec_auth_data(string $ad): array {
    if (strlen($ad) < 37) throw new RuntimeException('authdata_short');
    $rpIdHash = substr($ad, 0, 32); $flags = ord($ad[32]); $count = unpack('N', substr($ad, 33, 4))[1];
    $credId = null; $cose = null;
    if ($flags & 0x40) {   // attested credential data
        $credLen = unpack('n', substr($ad, 53, 2))[1];
        $credId = substr($ad, 55, $credLen);
        $i = 55 + $credLen;
        $cose = sec_cbor($ad, $i);
    }
    return [$rpIdHash, $flags, $count, $credId, $cose];
}
function sec_client_data(string $json, string $type, string $challenge): void {
    $c = json_decode($json, true);
    if (!is_array($c) || ($c['type'] ?? '') !== $type) store_fail('passkey_bad_type');
    if (!hash_equals($challenge, sec_unb64u((string) ($c['challenge'] ?? '')))) store_fail('passkey_bad_challenge');
    if (strtolower((string) ($c['origin'] ?? '')) !== sec_origin()) store_fail('passkey_bad_origin');
}
function sec_challenge_new(string $purpose): string {
    store_session_start();
    $c = random_bytes(32);
    $_SESSION['pk_challenge'] = ['purpose' => $purpose, 'value' => sec_b64u($c), 'at' => time()];
    return sec_b64u($c);
}
function sec_challenge_take(string $purpose): string {
    store_session_start();
    $c = $_SESSION['pk_challenge'] ?? null;
    unset($_SESSION['pk_challenge']);
    if (!is_array($c) || ($c['purpose'] ?? '') !== $purpose || time() - (int) ($c['at'] ?? 0) > 300) store_fail('passkey_challenge_expired', 401);
    return sec_unb64u((string) $c['value']);
}

function sec_passkey_register_options(PDO $db, array $admin): array {
    $q = $db->prepare('select credential_id, transports from admin_passkeys where admin_id = ?'); $q->execute([(int) $admin['id']]);
    $exclude = [];
    foreach ($q->fetchAll() as $k) $exclude[] = ['type' => 'public-key', 'id' => sec_b64u((string) $k['credential_id'])];
    return [
        'rp' => ['id' => sec_rp_id(), 'name' => 'Sporta /backends'],
        'user' => ['id' => sec_b64u('sporta-admin-' . (int) $admin['id']), 'name' => (string) $admin['email'], 'displayName' => (string) $admin['email']],
        'challenge' => sec_challenge_new('register'),
        'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -257]],
        'timeout' => 120000,
        'attestation' => 'none',
        'excludeCredentials' => $exclude,
        'authenticatorSelection' => ['residentKey' => 'preferred', 'userVerification' => 'required'],
    ];
}
function sec_passkey_register(PDO $db, array $admin, array $b): array {
    $challenge = sec_challenge_take('register');
    $resp = is_array($b['response'] ?? null) ? $b['response'] : [];
    $cdj = sec_unb64u((string) ($resp['clientDataJSON'] ?? ''));
    sec_client_data($cdj, 'webauthn.create', $challenge);
    $att = sec_unb64u((string) ($resp['attestationObject'] ?? ''));
    try { $i = 0; $obj = sec_cbor($att, $i); } catch (Throwable $e) { store_fail('passkey_bad_attestation'); }
    $ad = is_array($obj) ? ($obj['authData']['bytes'] ?? '') : '';
    try { [$rpIdHash, $flags, $count, $credId, $cose] = sec_auth_data((string) $ad); } catch (Throwable $e) { store_fail('passkey_bad_attestation'); }
    if (!hash_equals(hash('sha256', sec_rp_id(), true), $rpIdHash)) store_fail('passkey_bad_rp');
    if (!($flags & 0x01)) store_fail('passkey_no_user_presence');
    if (!($flags & 0x04)) store_fail('passkey_no_user_verification');
    if (!$credId || !is_array($cose)) store_fail('passkey_bad_attestation');
    $pem = sec_cose_to_pem($cose);
    if ($pem === null) store_fail('passkey_unsupported_key');
    if (strlen($credId) > 400) store_fail('passkey_bad_attestation');
    $label = mb_substr(trim((string) ($b['label'] ?? '')), 0, 60);
    $transports = implode(',', array_slice(array_filter(array_map('strval', is_array($resp['transports'] ?? null) ? $resp['transports'] : [])), 0, 4));
    try {
        $db->prepare('insert into admin_passkeys (admin_id, credential_id, public_key, alg, sign_count, label, transports) values (?, ?, ?, ?, ?, ?, ?)')
           ->execute([(int) $admin['id'], $credId, $pem[0], $pem[1], $count, $label !== '' ? $label : null, mb_substr($transports, 0, 80)]);
    } catch (Throwable $e) { store_fail('passkey_duplicate', 409); }
    return ['ok' => true, 'id' => (int) $db->lastInsertId(), 'label' => $label];
}
function sec_passkey_login_options(PDO $db): array {
    return ['challenge' => sec_challenge_new('login'), 'rpId' => sec_rp_id(), 'timeout' => 120000, 'userVerification' => 'required', 'allowCredentials' => []];
}
/** Verifies the assertion. Returns the admin row to grant, or fails. */
function sec_passkey_login(PDO $db, array $b): array {
    $challenge = sec_challenge_take('login');
    store_throttle($db, 'passkey_login', 30, 900);
    $resp = is_array($b['response'] ?? null) ? $b['response'] : [];
    $credId = sec_unb64u((string) ($b['id'] ?? ($b['rawId'] ?? '')));
    if ($credId === '') store_fail('passkey_refused', 401);
    $q = $db->prepare('select k.id, k.admin_id, k.public_key, k.alg, k.sign_count, u.email, u.locked_until from admin_passkeys k join admin_users u on u.id = k.admin_id where k.credential_id = ?');
    $q->bindValue(1, $credId, PDO::PARAM_LOB); $q->execute();
    $k = $q->fetch();
    if (!$k) store_fail('passkey_refused', 401);
    if ($k['locked_until'] !== null && strtotime((string) $k['locked_until']) > time()) store_fail('locked', 429);
    $cdj = sec_unb64u((string) ($resp['clientDataJSON'] ?? ''));
    sec_client_data($cdj, 'webauthn.get', $challenge);
    $ad = sec_unb64u((string) ($resp['authenticatorData'] ?? ''));
    try { [$rpIdHash, $flags, $count] = sec_auth_data($ad); } catch (Throwable $e) { store_fail('passkey_refused', 401); }
    if (!hash_equals(hash('sha256', sec_rp_id(), true), $rpIdHash)) store_fail('passkey_bad_rp');
    if (!($flags & 0x01)) store_fail('passkey_refused', 401);
    $sig = sec_unb64u((string) ($resp['signature'] ?? ''));
    $signed = $ad . hash('sha256', $cdj, true);
    $ok = openssl_verify($signed, $sig, (string) $k['public_key'], OPENSSL_ALGO_SHA256);
    if ($ok !== 1) store_fail('passkey_refused', 401);
    if ($count !== 0 && (int) $k['sign_count'] !== 0 && $count <= (int) $k['sign_count']) store_fail('passkey_replayed', 401);
    $db->prepare('update admin_passkeys set sign_count = ?, last_used_at = now() where id = ?')->execute([$count, (int) $k['id']]);
    $uq = $db->prepare('select id, email, totp_enabled, totp_secret, email_otp_enabled from admin_users where id = ?'); $uq->execute([(int) $k['admin_id']]);
    $u = $uq->fetch();
    if (!$u) store_fail('passkey_refused', 401);
    $u['uv'] = (bool) ($flags & 0x04);
    return $u;
}
