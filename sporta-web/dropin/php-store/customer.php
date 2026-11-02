<?php
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/customer-auth.php';

header('Cache-Control: no-store, private, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
$route = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
$get = ['me', 'orders'];
$post = ['register', 'login', 'logout', 'profile', 'forgot_password', 'reset_password', 'change_password'];
if (!in_array($route, array_merge($get, $post), true)) store_fail('not_found', 404);
if (($method !== 'GET' || !in_array($route, $get, true)) &&
    ($method !== 'POST' || !in_array($route, $post, true))) store_fail('method_not_allowed', 405);
if ($method === 'POST') {
    // No CORS is enabled. This custom header and JSON content type cannot be
    // submitted by a cross-origin HTML form; Strict cookies provide a second guard.
    if (($_SERVER['HTTP_X_SPORTA_CUSTOMER'] ?? '') !== '1' ||
        strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json' ||
        ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) store_fail('request_too_large', 413);
}
$db = store_db();
// Per CLIENT (an IPv4 address, or an IPv6 /64 — see store_rate_identity).
//
// Login has its own, larger row. It counts every attempt, successes included,
// and it is the limit a real shopper on a carrier's shared address is most
// likely to meet; the per-ACCOUNT window below is what actually stops somebody
// guessing one customer's password, so this one can afford to be generous.
$limit = match ($route) {
    'me' => [120, 60],
    'orders' => [60, 60],
    'login' => [20, 900],
    'register', 'forgot_password', 'reset_password', 'change_password' => [10, 900],
    default => [30, 900],
};
store_throttle($db, 'customer_' . $route, ...$limit);
if ($route === 'me') store_out(customer_current($db));
if ($route === 'logout') {
    customer_session_start();
    store_session_end();
    store_out(['ok' => true]);
}
if ($route === 'orders') {
    $user = customer_current_user($db);
    if ($user === null) store_fail('not_authenticated', 401);
    $page = $_GET['page'] ?? '1';
    if (!is_string($page) || !preg_match('/^[1-9][0-9]{0,3}$/D', $page) || (int)$page > 500) {
        store_fail('invalid_page');
    }
    store_out(customer_orders($db, (int)$user['id'], (int)$page));
}

// The customer table is part of install.mysql.sql. Never run DDL on a public
// registration or login request: the runtime DB user need not have CREATE,
// and store.php's exception handler reports a missing table as no_table/503.
$raw = file_get_contents('php://input', false, null, 0, 8193);
if ($raw === false || strlen($raw) > 8192) store_fail('request_too_large', 413);
$body = json_decode($raw, true);
if (!is_array($body)) store_fail('bad_request');
if ($route === 'register') {
    $input = customer_registration_input($body);
    if (isset($input['error'])) store_fail($input['error']);
    $user = customer_insert($db, $input);
    if ($user === null) store_fail('account_not_created', 409);
    customer_sign_in($user);
    store_out(customer_public($user), 201);
}
if ($route === 'login') {
    if (!is_string($body['email'] ?? null) || !is_string($body['password'] ?? null) ||
        strlen($body['email']) > 254 || strlen($body['password']) > 1024) store_fail('invalid_credentials', 401);
    // PER ACCOUNT, and really per account this time.
    //
    // This used to be store_throttle('customer_login_email_<hash>'), and
    // store_throttle keys on the CLIENT — so the bucket was per (email,
    // address), and anybody rotating addresses had unlimited guesses at one
    // customer's password. Now the bucket is the normalised email alone, ten
    // attempts per fifteen minutes from anywhere.
    //
    // Keyed on the EMAIL, not the customer id, and hit before the account is
    // looked up, so a 429 says nothing about whether the address has an
    // account. An address that is not a valid email is refused here, before
    // the database is asked: MySQL's collation would otherwise match
    // 'víctim@' to 'victim@', and every spelling of that kind was a fresh
    // window onto the same account.
    //
    // Accepted trade-off: anyone can keep a known address out of PASSWORD
    // sign-in for fifteen minutes at a time. A reset (which empties the window,
    // below) and guest checkout still work.
    $email = store_login_identity($body['email']);
    if ($email === '__invalid_email__') store_fail('invalid_credentials', 401);
    $account = store_rate_limit_hit($db, 'customer_login_identity', $email, 10, 900);
    if (!$account['allowed']) store_rate_limit_fail($account['retry_after']);
    $user = customer_authenticate($db, $email, $body['password']);
    if ($user === null) store_fail('invalid_credentials', 401);
    store_rate_limit_clear($db, 'customer_login_identity', $email);
    customer_sign_in($user);
    store_out(customer_public($user));
}

if ($route === 'forgot_password') {
    // Known, unknown and malformed addresses receive the same response.
    $email = is_string($body['email'] ?? null) ? mb_strtolower(trim($body['email'])) : '';
    // HOW MANY RESET MAILS ONE INBOX GETS, whoever asks and from wherever.
    //
    // This was store_throttle('customer_reset_email_<hash>', 5, 900), and
    // store_throttle keys on the CLIENT, so it was per (email, address): a
    // script spreading requests over many addresses could mail one customer
    // without end — and the mail goes out from the shop's own mailbox, whose
    // sending quota the warehouse's order mail shares.
    //
    // Two windows on the address alone, no client in the key: three an hour,
    // ten a day. Both are counted on every request, and over either one the
    // request is answered exactly like any other — {ok:true} — with no
    // database work and no mail, so the limit cannot be used to learn whether
    // the address has an account. The worst a stranger can do is use up one
    // address's resets for a day; its password and guest checkout still work.
    // The per-client window above (10 per 15 minutes) still applies.
    if (strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $hour = store_rate_limit_hit($db, 'customer_reset_email', $email, 3, 3600);
        $day = store_rate_limit_hit($db, 'customer_reset_email_day', $email, 10, 86400);
        $user = false;
        if ($hour['allowed'] && $day['allowed']) {
            $q = $db->prepare('select id, email from customer_accounts where email = ? limit 1');
            $q->execute([$email]);
            $user = $q->fetch(PDO::FETCH_ASSOC);
        }
        if ($user) {
            $token = bin2hex(random_bytes(32));
            $db->beginTransaction();
            try {
                $db->prepare('update customer_password_resets set used_at = now() where customer_id = ? and used_at is null')
                    ->execute([(int)$user['id']]);
                $db->prepare('insert into customer_password_resets (customer_id, token_hash, expires_at, request_ip)
                              values (?, ?, date_add(now(), interval 30 minute), ?)')
                    // The CLIENT, not the proxy in front of the server (which
                    // made every row the same value), and as an HMAC: a plain
                    // SHA-256 of an IPv4 address is reversed by trying all 2^32.
                    ->execute([(int)$user['id'], hash('sha256', $token),
                        store_rate_limit_key('customer_reset_ip', store_client_ip())]);
                $db->commit();
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                throw $e;
            }
            // URL fragments do not enter server logs or Referer headers. The
            // origin is fixed and never taken from Host or another input.
            $link = customer_reset_link($token);
            $safeLink = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $cfg = store_config();
            $cfg['mail_from'] = (string)($cfg['customer_mail_from'] ?? $cfg['mail_reply_to'] ?? $cfg['mail_from'] ?? '');
            $subject = 'Reset your Sporta account password';
            $text = "A password reset was requested for your Sporta account.\n\n"
                  . "Open this link within 30 minutes to choose a new password:\n{$link}\n\n"
                  . "If you did not request this, ignore the email. Your password will not change.\n";
            $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">'
                  . '<h2>Reset your Sporta password</h2>'
                  . '<p>This link expires in 30 minutes and can be used once.</p>'
                  . '<p><a href="' . $safeLink . '" style="display:inline-block;background:#99452b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Choose a new password</a></p>'
                  . '<p style="font-size:13px;color:#64748b">If you did not request this, ignore the email.</p>'
                  . '</div>';
            if (!store_send_admin_mail($cfg, (string)$user['email'], $subject, $text, $html, 'Sporta')) {
                // Never include the token or email in logs or the API result.
                error_log('Sporta customer password reset mail failed');
            }
        }
    }
    store_out(['ok' => true]);
}

if ($route === 'reset_password') {
    $token = is_string($body['token'] ?? null) ? strtolower(trim($body['token'])) : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    if (!customer_reset_token_valid($token)) store_fail('invalid_reset_token');
    if (!customer_password_valid($password)) store_fail('invalid_password');
    $db->beginTransaction();
    try {
        $q = $db->prepare('select r.id, r.customer_id, a.email
                             from customer_password_resets r
                             join customer_accounts a on a.id = r.customer_id
                            where r.token_hash = ? and r.used_at is null and r.expires_at > now()
                            limit 1 for update');
        $q->execute([hash('sha256', $token)]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $db->rollBack();
            store_fail('invalid_reset_token');
        }
        $db->prepare('update customer_accounts set password_hash = ? where id = ?')
            ->execute([customer_hash_password($password), (int)$row['customer_id']]);
        $db->prepare('update customer_password_resets set used_at = now() where customer_id = ? and used_at is null')
            ->execute([(int)$row['customer_id']]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    // A reset is proof of the mailbox, so it empties the account's sign-in
    // window: otherwise somebody keeping that window full would leave the
    // customer holding a new password they cannot use for fifteen minutes.
    store_rate_limit_clear($db, 'customer_login_identity', store_login_identity((string)$row['email']));
    // A reset can be opened while another customer is signed in on this
    // browser. Clear that session too so the UI and server agree afterward.
    customer_clear_session_if_present();
    store_out(['ok' => true]);
}

// No account identifier or email is ever accepted from the browser for these
// writes. The verified session determines the row they are allowed to touch.
$user = customer_current_user($db);
if ($user === null) store_fail('not_authenticated', 401);
if ($route === 'profile') {
    $input = customer_profile_input($body, (string)($user['phone'] ?? ''));
    if (isset($input['error'])) store_fail($input['error']);
    store_out(customer_profile_update($db, (int)$user['id'], $input));
}
if ($route === 'change_password') {
    $current = is_string($body['current_password'] ?? null) ? $body['current_password'] : '';
    $next = is_string($body['new_password'] ?? null) ? $body['new_password'] : '';
    if (!customer_password_valid($next)) store_fail('invalid_password');
    // PER ACCOUNT. The per-client window alone let somebody holding a stolen
    // customer session rotate addresses and guess the current password without
    // end. Five tries per fifteen minutes for the account, counted before the
    // check; past that the session itself is ended, so whoever is guessing has
    // to sign in again — with the password they are trying to find.
    if (!store_rate_limit_hit($db, 'customer_change_password_account', (string)$user['id'], 5, 900)['allowed']) {
        store_session_end();
        store_fail('not_authenticated', 401);
    }
    if (!customer_verify_password($current, (string)$user['password_hash'])) store_fail('invalid_credentials', 401);
    $db->beginTransaction();
    try {
        $q = $db->prepare('update customer_accounts set password_hash = ? where id = ? and password_hash = ?');
        $q->execute([customer_hash_password($next), (int)$user['id'], $user['password_hash']]);
        if ($q->rowCount() !== 1) {
            $db->rollBack();
            store_fail('invalid_credentials', 401);
        }
        $db->prepare('update customer_password_resets set used_at = now() where customer_id = ? and used_at is null')
            ->execute([(int)$user['id']]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    customer_clear_session_if_present();
    store_out(['ok' => true]);
}

store_fail('not_found', 404);
