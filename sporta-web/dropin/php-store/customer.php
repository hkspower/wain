<?php
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/customer-auth.php';

header('Cache-Control: no-store, private, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
$route = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
$get = ['me', 'orders', 'verify_email'];
$post = ['register', 'login', 'logout', 'profile', 'forgot_password', 'reset_password', 'change_password',
    'verify_resend'];
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
    'register', 'forgot_password', 'reset_password', 'change_password', 'verify_resend' => [10, 900],
    // A link opened from a mail client; a few retries and reloads are normal.
    'verify_email' => [30, 900],
    default => [30, 900],
};
store_throttle($db, 'customer_' . $route, ...$limit);
if ($route === 'me') {
    $me = customer_current_user($db);
    store_out($me === null ? null : customer_public_verified($db, $me));
}
// The link in the verification mail. A GET because it is opened from a mail
// client; it answers with a redirect to the account page that drops the token
// from the address bar, ?verified=1 when the link was good, ?verified=0 when it
// was unknown, used or expired. It signs nobody in: it proves the mailbox and
// nothing else, so a mail scanner that follows it changes no session.
if ($route === 'verify_email') {
    $token = is_string($_GET['token'] ?? null) ? strtolower(trim($_GET['token'])) : '';
    $ok = customer_verify_consume($db, $token) !== null;
    header('Location: /account?verified=' . ($ok ? '1' : '0'), true, 303);
    exit;
}
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
    // ONE ANSWER FOR NEW AND EXISTING ADDRESSES (audit M3, 2026-11-12).
    //
    // An address that already had an account used to get 409
    // account_not_created and a new one 201, so anybody could test a list of
    // emails against the shop - undoing the identical answers and dummy bcrypt
    // the sign-in and reset routes were built with. Now both get the same 201
    // and the same body (the name and email that were sent, phone empty,
    // email_verified false), after the same work: one bcrypt hash (in
    // customer_insert, before the INSERT that either lands or meets the UNIQUE
    // key). The mail comes after the answer has gone (store_out_early): a
    // verification link to a new account, a "you already have an account"
    // note to an existing one.
    //
    // What still differs is the session: a NEW account is signed in at once
    // (owner rule: an unverified account may sign in and shop, so a mail
    // outage locks nobody out), an existing one is not - its owner's password
    // was not given. The compiled /account page then asks for the orders, gets
    // 401 and shows "Your sign-in has expired. Please sign in again", which is
    // the right next step for somebody who already has an account. Hiding the
    // session too would mean not signing new accounts in until the mail is
    // verified, which the owner ruled out while outgoing mail is down.
    //
    // Per ADDRESS, whoever asks: five registrations an hour. Counted for every
    // address alike, so its refusal says nothing either.
    $addr = store_rate_limit_hit($db, 'customer_register_email', $input['email'], 5, 3600);
    if (!$addr['allowed']) store_rate_limit_fail($addr['retry_after']);
    $user = customer_insert($db, $input);
    $answer = ['name' => $input['name'], 'email' => $input['email'], 'phone' => '', 'email_verified' => false];
    if ($user !== null) {
        customer_sign_in($user);
        // This browser now owns the address: count its later attempts in its own
        // windows (see store_customer_device_for in store.php).
        store_customer_device_issue(store_login_identity((string)$user['email']));
        // Written now, so a request that follows the answer at once finds it.
        session_write_close();
    }
    store_out_early($answer, 201);
    try {
        if ($user !== null) customer_verify_send($db, $user);
        else customer_existing_notice($db, $input['email']);
    } catch (Throwable $e) {
        // The answer is gone; a failed mail must only be logged.
        error_log('Sporta customer registration mail unavailable');
    }
    exit;
}
if ($route === 'login') {
    if (!is_string($body['email'] ?? null) || !is_string($body['password'] ?? null) ||
        strlen($body['email']) > 254 || strlen($body['password']) > 1024) store_fail('invalid_credentials', 401);
    // PER ACCOUNT, and really per account this time.
    //
    // This used to be store_throttle('customer_login_email_<hash>'), and
    // store_throttle keys on the CLIENT, so the bucket was per (email,
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
    // A BROWSER THE CUSTOMER HAS USED IS COUNTED APART. Anyone can fill the
    // shared per-address window from rotating clients, and that alone must not
    // lock the customer out of their own account: a request carrying a valid
    // device cookie for this address (issued at register / sign-in / reset, see
    // store_customer_device_for) is charged to a window of its own — the same
    // ten per fifteen minutes, per address and device — and never touches the
    // shared one. The cookie skips nothing: the password is still checked every
    // time. Accepted trade-off: a browser the customer has never used (a new
    // phone, a cleared cookie jar) waits out the shared window while somebody
    // is filling it; a reset (not blocked by it for a known browser, below)
    // and guest checkout still work.
    $email = store_login_identity($body['email']);
    if ($email === '__invalid_email__') store_fail('invalid_credentials', 401);
    $device = store_customer_device_for($email);
    $loginBucket = $device === null ? 'customer_login_identity' : 'customer_login_device';
    $loginIdentity = $device === null ? $email : $email . '|' . $device;
    $account = store_rate_limit_hit($db, $loginBucket, $loginIdentity, 10, 900);
    if (!$account['allowed']) store_rate_limit_fail($account['retry_after']);
    $user = customer_authenticate($db, $email, $body['password']);
    if ($user === null) store_fail('invalid_credentials', 401);
    // The right password is proof of the account: empty the window this
    // attempt was charged to AND the shared one, so a customer is not left
    // behind a window somebody else filled.
    store_rate_limit_clear($db, $loginBucket, $loginIdentity);
    if ($device !== null) store_rate_limit_clear($db, 'customer_login_identity', $email);
    customer_sign_in($user);
    store_customer_device_issue($email);
    store_out(customer_public_verified($db, $user));
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
    //
    // A BROWSER THE CUSTOMER HAS USED HAS WINDOWS OF ITS OWN (the same three an
    // hour and ten a day, per address and device), exactly as at sign-in:
    // otherwise a stranger spending three requests an hour would leave the
    // customer with no reset mail at all, and with the sign-in window filled
    // the same way, no way back into the account. The cookie is no credential —
    // the mail still goes only to the address on file, and the link is still
    // the only way to a new password — so the worst it adds is a second set of
    // three an hour to that one inbox.
    // THE ANSWER GOES OUT BEFORE THE WORK (audit M3). The lookup, the token
    // and the mail relay used to run first, and only for a real account, so a
    // known address answered measurably later than an unknown one. Same fix
    // as the admin route: every address gets {ok:true} at the same moment and
    // the work happens after it (store_out_early). The limits below are
    // counted after the answer too, so they cannot be timed either.
    store_out_early(['ok' => true]);
    if (strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $device = store_customer_device_for($email);
        $resetIdentity = $device === null ? $email : $email . '|' . $device;
        $hour = store_rate_limit_hit($db, $device === null ? 'customer_reset_email' : 'customer_reset_device',
            $resetIdentity, 3, 3600);
        $day = store_rate_limit_hit($db, $device === null ? 'customer_reset_email_day' : 'customer_reset_device_day',
            $resetIdentity, 10, 86400);
        $user = false;
        if ($hour['allowed'] && $day['allowed']) {
            $q = $db->prepare('select id, email from customer_accounts where email = ? limit 1');
            $q->execute([$email]);
            $user = $q->fetch(PDO::FETCH_ASSOC);
        }
        if ($user) {
            $token = bin2hex(random_bytes(32));
            // Older links stay usable until this one has been handed to the
            // relay (audit L5): marked used only after a successful send, and
            // this row deleted if the send fails, as the admin route does.
            $db->prepare('insert into customer_password_resets (customer_id, token_hash, expires_at, request_ip)
                          values (?, ?, date_add(now(), interval 30 minute), ?)')
                // The CLIENT, not the proxy in front of the server (which
                // made every row the same value), and as an HMAC: a plain
                // SHA-256 of an IPv4 address is reversed by trying all 2^32.
                ->execute([(int)$user['id'], hash('sha256', $token),
                    store_rate_limit_key('customer_reset_ip', store_client_ip())]);
            $newResetId = (int)$db->lastInsertId();
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
            if (store_send_admin_mail($cfg, (string)$user['email'], $subject, $text, $html, 'Sporta')) {
                $db->prepare('update customer_password_resets set used_at = now()
                               where customer_id = ? and id <> ? and used_at is null')
                    ->execute([(int)$user['id'], $newResetId]);
            } else {
                $db->prepare('delete from customer_password_resets where id = ?')->execute([$newResetId]);
                // Never include the token or email in logs or the API result.
                error_log('Sporta customer password reset mail failed');
            }
        }
    }
    exit;
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
        // The link arrived in that mailbox: the address is proven (M4).
        customer_mark_verified($db, (int)$row['customer_id']);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    // A reset is proof of the mailbox, so it empties the account's sign-in
    // window: otherwise somebody keeping that window full would leave the
    // customer holding a new password they cannot use for fifteen minutes.
    $resetIdentity = store_login_identity((string)$row['email']);
    store_rate_limit_clear($db, 'customer_login_identity', $resetIdentity);
    $resetDevice = store_customer_device_for($resetIdentity);
    if ($resetDevice !== null) store_rate_limit_clear($db, 'customer_login_device', $resetIdentity . '|' . $resetDevice);
    // The mailbox is proven, so this browser is now one the customer uses: its
    // next attempts are counted in its own windows (store_customer_device_for).
    store_customer_device_issue($resetIdentity);
    // A reset can be opened while another customer is signed in on this
    // browser. Clear that session too so the UI and server agree afterward.
    customer_clear_session_if_present();
    store_out(['ok' => true]);
}

// No account identifier or email is ever accepted from the browser for these
// writes. The verified session determines the row they are allowed to touch.
$user = customer_current_user($db);
if ($user === null) store_fail('not_authenticated', 401);
if ($route === 'verify_resend') {
    // A new verification link for the signed-in account. Per ACCOUNT: three an
    // hour, ten a day, whoever asks. An already-verified account sends nothing.
    if (customer_email_verified($db, (int)$user['id'])) store_out(['ok' => true, 'already' => true]);
    if (!customer_verify_ready($db)) store_fail('verification_unavailable', 503);
    $hour = store_rate_limit_hit($db, 'customer_verify_resend', (string)$user['id'], 3, 3600);
    $day = store_rate_limit_hit($db, 'customer_verify_resend_day', (string)$user['id'], 10, 86400);
    if (!$hour['allowed'] || !$day['allowed']) {
        store_rate_limit_fail(max($hour['allowed'] ? 0 : $hour['retry_after'], $day['allowed'] ? 0 : $day['retry_after']));
    }
    store_out(['ok' => true, 'sent' => customer_verify_send($db, $user)]);
}
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
