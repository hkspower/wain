<?php
// Optional Google OpenID Connect for existing Sporta administrators.
// Accounts are linked by Google's stable subject, never by email alone.
declare(strict_types=1);
require __DIR__ . '/store.php';

header('Cache-Control: no-store, private, max-age=0');
header('Referrer-Policy: no-referrer');
$callback ='https://www.sporta.com.kw/api/admin-google.php';
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : 'callback';
if (!in_array($action, ['start', 'callback', 'finish-link'], true)) {
    http_response_code(404);
    exit;
}
$cfg = store_config();
$clientId = trim((string)($cfg['google_oauth_client_id'] ?? ''));
$clientSecret = trim((string)($cfg['google_oauth_client_secret'] ?? ''));

function google_redirect(string $result): never {
    $tab = in_array($result, ['finish_link', 'linked', 'already_linked'], true) ? 'tab=settings&' : '';
    // No slash before "?": public/.htaccess answers /backends/ with a 404, and
    // /backends (RewriteRule ^backends/?$) serves the admin shell.
    header('Location: https://www.sporta.com.kw/backends?' . $tab . 'google=' . rawurlencode($result), true, 303);
    exit;
}

function google_oauth_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    // ALWAYS the host's own save path and sweep lifetime, never whatever the
    // request has set so far. `start?intent=link` reads the signed-in admin
    // first, and that points session.save_path at the admin session directory
    // (30-day lifetime) for the rest of the request, so this flow session
    // (state, nonce, PKCE verifier) was written THERE; the callback request
    // opens this session first, with the default path, found nothing, and the
    // owner landed on ?google=invalid — the Google account never linked. Both
    // requests now name the same place, and the short flow session is never in
    // the directory whose files must outlive a month (or swept by a request
    // that thinks a day is long enough).
    $host = store_session_host_defaults();
    ini_set('session.save_path', $host['save_path']);
    ini_set('session.gc_maxlifetime', $host['gc_maxlifetime']);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    $secure = store_is_https();
    session_name($secure ? '__Host-sporta_google' : 'sporta_google');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure,
        'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}

function google_clear_session(): void {
    $_SESSION = [];
    $params = session_get_cookie_params();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/',
        'secure' => $params['secure'], 'httponly' => true, 'samesite' => 'Lax']);
    session_destroy();
    session_write_close();
}

function google_http_json(string $url, ?array $fields = null): array {
    if (!function_exists('curl_init')) google_redirect('unavailable');
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    if ($fields !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($fields, '', '&', PHP_QUERY_RFC3986));
    }
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!is_string($body) || $code !== 200 || strlen($body) > 65536) google_redirect('unavailable');
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) google_redirect('unavailable');
    return $decoded;
}

function google_b64url(string $value): string|false {
    if (!preg_match('/^[A-Za-z0-9_-]+$/D', $value)) return false;
    return base64_decode(strtr($value, '-_', '+/'), true);
}

function google_verified_claims(string $token, string $audience, string $nonce): array {
    $parts = explode('.', $token);
    if (count($parts) !== 3 || strlen($token) > 12000) google_redirect('invalid');
    [$header64, $payload64, $signature64] = $parts;
    $header = json_decode((string)google_b64url($header64), true);
    $claims = json_decode((string)google_b64url($payload64), true);
    $signature = google_b64url($signature64);
    if (!is_array($header) || !is_array($claims) || $signature === false
        || ($header['alg'] ?? '') !== 'RS256' || !is_string($header['kid'] ?? null)
        || !preg_match('/^[A-Za-z0-9_-]{1,128}$/D', $header['kid'])) google_redirect('invalid');
    $certs = google_http_json('https://www.googleapis.com/oauth2/v1/certs');
    $cert = $certs[$header['kid']] ?? null;
    if (!is_string($cert) || openssl_verify($header64 . '.' . $payload64,
        $signature, $cert, OPENSSL_ALGO_SHA256) !== 1) google_redirect('invalid');
    $now = time();
    if (!in_array($claims['iss'] ?? null, ['https://accounts.google.com', 'accounts.google.com'], true)
        || ($claims['aud'] ?? null) !== $audience
        || (isset($claims['azp']) && $claims['azp'] !== $audience)
        || !is_numeric($claims['exp'] ?? null) || (int)$claims['exp'] <= $now
        || !is_numeric($claims['iat'] ?? null) || (int)$claims['iat'] > $now + 60
        || (int)$claims['iat'] < $now - 3600
        || !is_string($claims['nonce'] ?? null) || !hash_equals($nonce, $claims['nonce'])
        || !is_string($claims['sub'] ?? null) || !preg_match('/^[0-9]{1,255}$/D', $claims['sub'])) {
        google_redirect('invalid');
    }
    return $claims;
}

if ($clientId === '' || $clientSecret === '' || !store_is_https()) google_redirect('unavailable');
$db = store_db();
store_throttle($db, 'admin_google_' . $action, 20, 900);

if ($action === 'start' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $intent = ($_GET['intent'] ?? '') === 'link' ? 'link' : 'login';
    $adminId = 0;
    if ($intent === 'link') {
        $admin = store_session_admin();
        if ($admin === null) google_redirect('sign_in_first');
        $adminId = (int)$admin['id'];
        session_write_close();
    }
    google_oauth_session();
    session_regenerate_id(true);
    $state = bin2hex(random_bytes(32));
    $nonce = bin2hex(random_bytes(32));
    $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $_SESSION['google_flow'] = ['state' => $state, 'nonce' => $nonce,
        'verifier' => $verifier, 'intent' => $intent, 'admin_id' => $adminId, 'at' => time()];
    session_write_close();
    $params = ['client_id' => $clientId, 'redirect_uri' => $callback,
        'response_type' => 'code', 'scope' => 'openid', 'state' => $state,
        'nonce' => $nonce, 'code_challenge_method' => 'S256',
        'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=')];
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986), true, 302);
    exit;
}

if ($action === 'callback' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    google_oauth_session();
    $flow = $_SESSION['google_flow'] ?? null;
    unset($_SESSION['google_flow']); // one use, even when the exchange fails
    if (!is_array($flow) || time() - (int)($flow['at'] ?? 0) > 300
        || !is_string($_GET['state'] ?? null)
        || !hash_equals((string)($flow['state'] ?? ''), $_GET['state'])) google_redirect('invalid');
    if (!is_string($_GET['code'] ?? null) || strlen($_GET['code']) > 2048) google_redirect('cancelled');
    $tokens = google_http_json('https://oauth2.googleapis.com/token', [
        'code' => $_GET['code'], 'client_id' => $clientId, 'client_secret' => $clientSecret,
        'redirect_uri' => $callback, 'grant_type' => 'authorization_code',
        'code_verifier' => $flow['verifier'],
    ]);
    $claims = google_verified_claims((string)($tokens['id_token'] ?? ''), $clientId, (string)$flow['nonce']);
    if ($flow['intent'] === 'link') {
        $_SESSION['google_link'] = ['sub' => $claims['sub'], 'admin_id' => (int)$flow['admin_id'], 'at' => time()];
        session_write_close();
        google_redirect('finish_link');
    }
    google_clear_session();
    $q = $db->prepare('select id, email, password_hash, must_change_password,
                             (locked_until is not null and locked_until > now()) as is_locked,
                             totp_enabled, totp_secret, google_sub
                        from admin_users where google_sub = ? limit 1');
    $q->execute([$claims['sub']]);
    $user = $q->fetch();
    if (!$user || (int)$user['must_change_password'] !== 0) google_redirect('not_linked');
    if ((int)$user['is_locked'] === 1) google_redirect('locked');
    if ((int)$user['totp_enabled'] === 1) {
        if (store_totp_decode((string)$user['totp_secret']) === '') google_redirect('unavailable');
        store_session_start();
        session_regenerate_id(true);
        $_SESSION['pending_admin_id'] = (int)$user['id'];
        $_SESSION['pending_at'] = time();
        $_SESSION['pending_auth_fingerprint'] = hash('sha256', (string)$user['password_hash']);
        session_write_close();
        google_redirect('verify');
    }
    store_admin_grant($db, $user);
    session_write_close();
    google_redirect('success');
}

if ($action === 'finish-link' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') google_redirect('invalid');
    google_oauth_session();
    $link = $_SESSION['google_link'] ?? null;
    unset($_SESSION['google_link']);
    session_write_close();
    if (!is_array($link) || time() - (int)($link['at'] ?? 0) > 120) google_redirect('invalid');
    $admin = store_session_admin();
    if ($admin === null || (int)$admin['id'] !== (int)$link['admin_id']) google_redirect('sign_in_first');
    $q = $db->prepare('select id from admin_users where google_sub = ? and id <> ? limit 1');
    $q->execute([$link['sub'], $admin['id']]);
    if ($q->fetch()) google_redirect('already_linked');
    // Two administrators can pass the check above at the same moment. google_sub
    // is UNIQUE, so the second UPDATE fails with MySQL 1062 (duplicate entry);
    // that is the same answer as the check, not a server error.
    try {
        $db->prepare('update admin_users set google_sub = ? where id = ?')->execute([$link['sub'], $admin['id']]);
    } catch (PDOException $e) {
        if ((int)($e->errorInfo[1] ?? 0) !== 1062) throw $e;
        google_redirect('already_linked');
    }
    store_admin_event($db, $admin, 'google_link');
    store_out(['linked' => true]);
}

http_response_code(404);
exit;
