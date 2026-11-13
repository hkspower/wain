<?php
// Sign in with Apple for customers. One flow does both jobs: a new Apple ID
// creates the account, a known one signs in. Off until the owner switches it on
// (apple_signin_enabled) and the Apple keys are on the server (apple_services_id,
// apple_state_secret). See apple-lib.php for the checks and why there is no secret.
//
//   GET  ?action=status  → {"enabled": bool}          (the account page shows the button only when true)
//   GET  ?action=start   → 303 to Apple's sign-in page
//   POST (Apple, form_post) → verifies the id_token, signs the customer in, 303 to /account?apple=…
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/customer-auth.php';
require __DIR__ . '/apple-lib.php';

header('Cache-Control: no-store, private, max-age=0');
header('Referrer-Policy: no-referrer');

$cfg = store_config();
$enabled = apple_enabled($cfg);
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');

// The page answers with one word in the query; the account page turns it into a sentence.
function apple_done(string $result): never {
    header('Location: https://www.sporta.com.kw/account?apple=' . rawurlencode($result), true, 303);
    exit;
}

if ($method === 'GET' && $action === 'status') {
    store_out(['enabled' => $enabled]);
}

if ($method === 'GET' && $action === 'start') {
    if (!$enabled) apple_done('unavailable');
    [$state, $nonce] = apple_state_make((string)$cfg['apple_state_secret']);
    $query = http_build_query([
        'client_id' => (string)$cfg['apple_services_id'],
        'redirect_uri' => APPLE_CALLBACK,
        'response_type' => 'code id_token',
        'response_mode' => 'form_post',
        'scope' => 'name email',
        'state' => $state,
        'nonce' => $nonce,
    ], '', '&', PHP_QUERY_RFC3986);
    header('Location: ' . APPLE_AUTHORIZE . '?' . $query, true, 303);
    exit;
}

if ($method === 'POST') {
    // Apple posts the form cross-site, so no Sec-Fetch or custom-header check applies here: the
    // signed state and the id_token's own signature are what make this request trustworthy.
    if (!$enabled) apple_done('unavailable');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) apple_done('invalid');
    $state = is_string($_POST['state'] ?? null) ? $_POST['state'] : '';
    $idToken = is_string($_POST['id_token'] ?? null) ? $_POST['id_token'] : '';
    if (strlen($idToken) > 8192) apple_done('invalid');

    $nonce = apple_state_nonce((string)$cfg['apple_state_secret'], $state);
    if ($nonce === null) apple_done('expired');
    $claims = apple_verify_id_token($idToken, $cfg, $nonce);
    if ($claims === null) apple_done('invalid');
    $email = apple_verified_email($claims);
    if ($email === null) apple_done('no_email');
    $sub = (string)$claims['sub'];
    $name = apple_name_from_user_field(is_string($_POST['user'] ?? null) ? $_POST['user'] : null);

    $db = store_db();
    try {
        // 1. A known Apple ID signs in.
        $query = $db->prepare('select id, name, email, password_hash from customer_accounts where apple_sub = ? limit 1');
        $query->execute([$sub]);
        $user = $query->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($user === null) {
            $query = $db->prepare('select id, name, email, password_hash, apple_sub from customer_accounts where email = ? limit 1');
            $query->execute([$email]);
            $existing = $query->fetch(PDO::FETCH_ASSOC) ?: null;
            if ($existing !== null) {
                // 2. An account with this address is linked ONLY when its mailbox is already proven (the
                //    verification link or a reset). An unverified account can be created by anyone who
                //    knows the address, so linking it would hand that someone the account.
                if (($existing['apple_sub'] ?? null) !== null || !customer_email_verified($db, (int)$existing['id'])) {
                    apple_done('email_in_use');
                }
                $db->prepare('update customer_accounts set apple_sub = ? where id = ? and apple_sub is null')
                   ->execute([$sub, (int)$existing['id']]);
                $user = $existing;
            } else {
                // 3. A new customer. The password is random and never shown: the account signs in with Apple.
                $fallback = mb_substr((string)strstr($email, '@', true), 0, 80) ?: 'Customer';
                $hash = customer_hash_password(bin2hex(random_bytes(24)));
                $db->prepare('insert into customer_accounts (name, email, password_hash, apple_sub) values (?, ?, ?, ?)')
                   ->execute([$name !== '' ? $name : $fallback, $email, $hash, $sub]);
                $id = (int)$db->lastInsertId();
                // Apple has proven the mailbox, so the account starts verified.
                customer_mark_verified($db, $id);
                $user = ['id' => $id, 'name' => $name !== '' ? $name : $fallback, 'email' => $email, 'password_hash' => $hash];
            }
        }
    } catch (PDOException $error) {
        // Two first sign-ins for one address at once: the unique keys decide, and the loser is told to retry.
        if ($error->getCode() === '23000') apple_done('email_in_use');
        throw $error;
    }

    customer_sign_in($user);
    apple_done('ok');
}

http_response_code(404);
exit;
