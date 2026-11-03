<?php
// Sporta admin API — what the React /backends screen calls.
// Place at public_html/api/. Every route below ?r=login requires the session.
//
// The shapes returned here are the SAME shapes admin/api.js already hands the
// screens expected — stats keys, order columns, nested product names on
// items — so the admin UI does not know or care which backend it is on. The
// contract is the UI's, not the database's.

declare(strict_types=1);
require __DIR__ . '/store.php';

// Admin responses contain customer, order and inventory data. Browsers and
// shared proxies must never reuse them after sign-out or expose them through a
// back/forward cache snapshot.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$r = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db = store_db();

// ---------------------------------------------------------------- throttling
// This file had NONE, and the login windows are not a substitute for it.
//
// Those windows are PER ACCOUNT (and, for a browser the owner has signed in
// from, per account and browser) — five failures per fifteen minutes. They
// say nothing about an attacker who sprays one guess across a hundred
// addresses, or who simply hammers ?r=me (unauthenticated, and it runs a count
// over admin_users on every call). Neither is slowed by an account window,
// and both are free database load on shared hosting.
//
// The ceiling is deliberately high. An admin opening the dashboard fires a
// dozen requests before they have touched anything — stats, revenue, orders,
// items, products — and a limit that interrupts real work is one that gets
// removed. This is a bound on machines, not on people.
//
// LOGIN ATTEMPTS are counted separately inside store_login() before password
// hashing: one bucket follows the client and one the normalised email (or the
// email plus this browser's device cookie). A wrong password locks no account
// row — only wrong phone codes do. A valid password clears only the account
// bucket it was charged to; it never clears the client spray bucket.
// Signed-in dashboard requests never touch either login bucket.
store_throttle($db, 'admin', 240, 60);

if ($r === 'google_available' && $method === 'GET') {
    $cfg = store_config();
    store_out(['available' => !empty($cfg['google_oauth_client_id'])
        && !empty($cfg['google_oauth_client_secret'])]);
}

// ------------------------------------------------------------------- session
if ($r === 'login' && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) store_fail('request_too_large', 413);
    $b = store_body(16384);
    $who = store_login(
        is_string($b['email'] ?? null) ? $b['email'] : '',
        is_string($b['password'] ?? null) ? $b['password'] : ''
    );
    if (!empty($who['need_code'])) store_out(['need_code' => true], 202);
    if (!empty($who['need_password_change'])) {
        store_out(['email' => $who['email'], 'need_password_change' => true], 202);
    }
    store_out(['email' => $who['email']]);
}

if ($r === 'login_code' && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) store_fail('request_too_large', 413);
    $b = store_body(16384);
    $who = store_login_code(is_string($b['code'] ?? null) ? $b['code'] : '');
    store_out(['email' => $who['email']]);
}

if ($r === 'logout' && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    $leaving = store_session_admin();
    if ($leaving !== null) store_admin_event($db, $leaving, 'logout');
    // Clears the cookie as well as the server-side session. Emptying $_SESSION
    // and calling session_destroy() left the browser holding an id — expired
    // server-side, but still sent on every request, and still the thing an
    // attacker with the cookie would replay against a session PHP had not yet
    // collected. Nothing to end when the request carried no session — and
    // asking must not create one (see store_session_resume()).
    if (store_session_resume()) store_session_end();
    store_out(['ok' => true]);
}

if ($r === 'me') {
    // Looks for a session, never makes one: an anonymous ?r=me is the most
    // common request this file gets (every visitor to /backends), and a
    // session file made for each would live 30 days.
    store_session_resume();
    if (!empty($_SESSION['pending_admin_id']) && time() - (int)($_SESSION['pending_at'] ?? 0) <= 300) {
        store_out(['need_code' => true], 202);
    }
    $pendingChange = store_pending_password_change();
    if ($pendingChange !== null) {
        store_out(['email' => $pendingChange['email'], 'need_password_change' => true], 202);
    }
    // store_session_admin(), not store_session_start(): an expired session must
    // read as signed OUT here, or the dashboard renders around a session every
    // other route will refuse.
    $who = store_session_admin();
    if ($who === null) {
        // Not signed in — so answer the OTHER question the screen needs before
        // it offers a password box: is there anything to sign in to? Without
        // this, a server whose SQL was never imported and a server with no
        // account both look like a plain login, and the first thing the owner
        // learns is that their correct password is "wrong". One cheap count on
        // a tiny table, and only on the signed-out path.
        if ((int)$db->query('select count(*) from admin_users')->fetchColumn() === 0) {
            store_fail('no_admin_account', 409);
        }
        store_out(null);
    }
    store_out(['email' => $who['email']]);
}

if ($r === 'change_initial_password' && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json') {
        store_fail('bad_request', 403);
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) store_fail('request_too_large', 413);
    store_throttle($db, 'admin_initial_password', 12, 900);
    $pending = store_pending_password_change();
    if ($pending === null) store_fail('setup_expired', 401);
    $body = store_body(8192);
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    if (strlen($password) < 12 || strlen($password) > 1024) store_fail('password_length', 400);
    $db->beginTransaction();
    try {
        $q = $db->prepare(
            'select password_hash, must_change_password, temporary_password_used_at
               from admin_users where id = ? for update'
        );
        $q->execute([(int)$pending['id']]);
        $current = $q->fetch();
        if (!$current || (int)$current['must_change_password'] !== 1
            || $current['temporary_password_used_at'] === null
            || !hash_equals((string)$pending['password_hash'], (string)$current['password_hash'])) {
            $db->rollBack();
            store_session_end();
            store_fail('setup_expired', 401);
        }
        if (store_admin_verify_password($password, (string)$current['password_hash'])) {
            $db->rollBack();
            store_fail('password_reused', 400);
        }
        $db->prepare(
            'update admin_users set password_hash = ?, must_change_password = 0,
                    temporary_password_expires_at = null, temporary_password_used_at = null,
                    failed_attempts = 0, locked_until = null where id = ?'
        )->execute([store_admin_hash_password($password), (int)$pending['id']]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    // The next sign-in uses the permanent password and, where enabled, MFA.
    store_session_end();
    store_out(['ok' => true]);
}

// ---------------------------------------------------------- password reset
// These two routes intentionally sit before the session gate.  They never
// reveal whether an email exists: the same 200 response is returned for a
// typo, an unknown address, and a real address.  Tokens are random, single
// use, stored only as SHA-256 hashes, and expire after thirty minutes.
if (($r === 'forgot_password' || $r === 'reset_password') && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 12288) store_fail('request_too_large', 413);
    $body = store_body(12288);

    if ($r === 'forgot_password') {
        $email = is_string($body['email'] ?? null)
            ? mb_strtolower(trim($body['email'])) : '';
        $validEmail = strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL);

        // Count the client and the normalised address independently. Both are
        // hit before either can return, so a blocked IP cannot rotate emails
        // for free and rotating IPs cannot repeatedly mail one administrator.
        // The address counter is used for delivery suppression only: known and
        // unknown addresses still receive the same generic 200 response.
        $clientRate = store_rate_limit_hit(
            $db, 'admin_password_reset_ip', store_client_identity(), 8, 900
        );
        $emailRate = $validEmail
            ? store_rate_limit_hit($db, 'admin_password_reset_identity', $email, 3, 1800)
            : null;
        if (!$clientRate['allowed']) {
            store_rate_limit_fail($clientRate['retry_after']);
        }

        // THE ANSWER GOES OUT BEFORE THE WORK. Everything below — the lookup,
        // the token, the mail relay — happens only for a real account, and
        // done first it made a real address answer measurably slower than an
        // unknown one: the response time said which addresses were admins.
        // Now every address gets the same {ok:true} at the same moment, and
        // the work happens after it (see store_out_early). The per-address
        // window above still caps mail to one admin at three per half hour.
        store_out_early(['ok' => true]);
        try {
            // Keep reset credentials and used rows bounded without a cron. The
            // account index serves normal lookups; this small capped sweep
            // removes only credentials that have been unusable for a day.
            if (random_int(1, 20) === 1) {
                $db->exec(
                    'delete from admin_password_resets
                      where (expires_at < date_sub(now(), interval 1 day))
                         or (used_at is not null and used_at < date_sub(now(), interval 1 day))
                      limit 200'
                );
            }

            if ($validEmail && $emailRate['allowed']) {
                $q = $db->prepare('select id, email from admin_users where email = ? limit 1');
                $q->execute([$email]);
                $user = $q->fetch();
                if ($user) {
                    $raw = bin2hex(random_bytes(32));
                    $hash = hash('sha256', $raw);
                    $db->prepare(
                        'insert into admin_password_resets (admin_id, token_hash, expires_at, request_ip)
                         values (?, ?, date_add(now(), interval 30 minute), ?)'
                    )->execute([
                        (int)$user['id'],
                        $hash,
                        // An HMAC of the client, not a plain SHA-256: every
                        // IPv4 address hashed plainly is recovered by trying
                        // all 2^32 of them.
                        store_rate_limit_key('admin_reset_ip', store_client_ip()),
                    ]);
                    $newResetId = (int)$db->lastInsertId();

                    $cfg = store_config();
                    $base = trim((string)($cfg['admin_reset_url'] ?? 'https://www.sporta.com.kw/backends'));
                    // This is a configured origin/path, never a request Host
                    // header.  A malformed setting is ignored rather than
                    // creating a link to an attacker-controlled host.
                    $parts = parse_url($base);
                    if (($parts['scheme'] ?? '') !== 'https'
                        || !in_array(strtolower((string)($parts['host'] ?? '')), ['sporta.com.kw', 'www.sporta.com.kw'], true)) {
                        $base = 'https://www.sporta.com.kw/backends';
                    }
                    // Fragments are not sent to the web server, proxy access
                    // log or HTTP referrer. AdminApp consumes and removes this
                    // token immediately. Query-string links from older emails
                    // continue to work in the client for backwards compatibility.
                    $base = explode('#', $base, 2)[0];
                    $link = $base . '#reset=' . rawurlencode($raw);
                    $safeLink = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                    $subject = 'Sporta Backends password reset';
                    $text = "A password reset was requested for your Sporta Backends account.\n\n"
                          . "Open this link within 30 minutes to choose a new password:\n{$link}\n\n"
                          . "If you did not request this, you can ignore this email. Your password will not change.\n";
                    $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">'
                          . '<h2>Reset your Sporta Backends password</h2>'
                          . '<p>This link expires in 30 minutes and can be used once.</p>'
                          . '<p><a href="' . $safeLink . '" style="display:inline-block;background:#99452b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Choose a new password</a></p>'
                          . '<p style="font-size:13px;color:#64748b">If you did not request this, ignore this email. Your password will not change.</p>'
                          . '</div>';
                    $mailCfg = $cfg;
                    $mailCfg['mail_from'] = store_admin_recovery_sender($cfg);
                    if (store_send_admin_mail($mailCfg, (string)$user['email'], $subject, $text, $html)) {
                        // Only invalidate older links after the replacement was
                        // actually delivered. A mail outage must not destroy
                        // the last usable recovery email.
                        $db->prepare(
                            'update admin_password_resets set used_at = now()
                              where admin_id = ? and id <> ? and used_at is null'
                        )->execute([(int)$user['id'], $newResetId]);
                    } else {
                        // The browser already has its generic answer; remove
                        // the undelivered credential.
                        $db->prepare('delete from admin_password_resets where id = ?')->execute([$newResetId]);
                        error_log('Sporta admin password reset mail failed');
                    }
                }
            }
        } catch (Throwable $e) {
            // The response has been sent. Nothing may follow it, and the
            // reason belongs in the server log only.
            error_log('Sporta admin password reset failed after response: ' . get_class($e));
        }
        exit;
    }

    // Reset requests are throttled separately above.  Token submissions need
    // their own bucket as well: expired or malformed links must not be used to
    // make an unbounded stream of database lookups, while a legitimate user
    // can still retry a mistyped password without locking the account.
    store_throttle($db, 'password_reset_verify', 20, 300);
    $token = is_string($body['token'] ?? null) ? strtolower(trim($body['token'])) : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) store_fail('invalid_reset_token', 400);
    if (strlen($password) < 12 || strlen($password) > 1024) store_fail('password_length', 400);

    $hash = hash('sha256', $token);
    $db->beginTransaction();
    try {
        $q = $db->prepare(
            'select r.id, r.admin_id, u.email
               from admin_password_resets r join admin_users u on u.id = r.admin_id
              where r.token_hash = ? and r.used_at is null and r.expires_at > now()
              limit 1 for update'
        );
        $q->execute([$hash]);
        $row = $q->fetch();
        if (!$row) {
            $db->rollBack();
            store_fail('invalid_reset_token', 400);
        }
        $db->prepare('update admin_users set password_hash = ?, must_change_password = 0,
                      temporary_password_expires_at = null, temporary_password_used_at = null,
                      failed_attempts = 0, locked_until = null where id = ?')
           ->execute([store_admin_hash_password($password), (int)$row['admin_id']]);
        $db->prepare('update admin_password_resets set used_at = now() where admin_id = ? and used_at is null')
           ->execute([(int)$row['admin_id']]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    // A reset is proof of the mailbox, so it also empties the account's
    // SHARED sign-in window. Otherwise a stranger who keeps that window full
    // (five wrong passwords every fifteen minutes) would leave the owner, on
    // a browser they have never signed in from, holding a brand-new password
    // they cannot use. Browsers with a device cookie never needed this; a
    // reset is how a new browser gets in. The client window is left alone.
    store_rate_limit_clear($db, 'admin_login_identity', store_login_identity((string)$row['email']));
    store_out(['ok' => true]);
}

// Everything below this line is an admin.
$admin = store_require_admin();

if ($r === 'activity_log' && $method === 'GET') {
    $page = $_GET['page'] ?? '1';
    if (!is_string($page) || !preg_match('/^[1-9][0-9]{0,3}$/D', $page)
        || (int)$page > 500) store_fail('invalid_page', 400);
    $limit = 50;
    $offset = ((int)$page - 1) * $limit;
    $q = $db->prepare('select id, actor_email, action_key, created_at
                        from admin_activity_log order by id desc limit ? offset ?');
    $q->bindValue(1, $limit + 1, PDO::PARAM_INT);
    $q->bindValue(2, $offset, PDO::PARAM_INT);
    $q->execute();
    $rows = $q->fetchAll();
    store_out(['events' => array_slice($rows, 0, $limit), 'has_more' => count($rows) > $limit]);
}

// Only completed changes belong in the activity history. Some POST endpoints
// are reads or session checks, and must not appear as administrator edits.
$activityActions = [
    'google_unlink', 'mfa_cancel', 'mfa_start', 'crm_save', 'crm_create',
    'support_update', 'support_reply', 'return_status', 'clear_cache',
    'payment_config', 'fulfilment', 'cod_paid', 'card_settled',
    'product_image_upload', 'product_save', 'product_active', 'brand_save',
    // brand_delete was missing, so removing a brand for good — the one brand
    // write that cannot be undone — was the one that left no trace.
    'brand_active', 'brand_delete', 'brand_assign', 'customer', 'sync', 'inventory_adjust',
    'inventory_variant_save', 'set_stock', 'slide_save', 'slide_delete',
    'slide_reorder', 'font_upload', 'font_delete', 'checkout_settings',
    'inventory_finance', 'theme_settings', 'topbar_settings', 'seo_save',
    'settings_save', 'block_customer', 'unblock_customer', 'discount_save',
    'discount_active', 'discount_delete',
];
if ($method === 'POST' && in_array($r, $activityActions, true)) {
    register_shutdown_function(static function () use ($db, $admin, $r): void {
        $status = http_response_code();
        if (is_int($status) && $status >= 200 && $status < 300) {
            store_admin_event($db, $admin, $r);
        }
    });
}

if ($r === 'google_status' && $method === 'GET') {
    $cfg = store_config();
    $q = $db->prepare('select google_sub from admin_users where id = ?');
    $q->execute([$admin['id']]);
    store_out(['configured' => !empty($cfg['google_oauth_client_id']) && !empty($cfg['google_oauth_client_secret']),
        'linked' => (string)$q->fetchColumn() !== '']);
}

if ($r === 'google_unlink' && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json') {
        store_fail('bad_request', 403);
    }
    $db->prepare('update admin_users set google_sub = null where id = ?')->execute([$admin['id']]);
    store_out(['linked' => false]);
}

// ----------------------------------------------------- sign-in passcode setup
// Enrollment is a separate, password-confirmed step. Until a current phone
// code is verified, the secret stays in the server session and login remains
// password-only. Backup codes are generated and hashed in the same database
// transaction that enables TOTP, so enrollment cannot half-complete.
if ($r === 'mfa_status' && $method === 'GET') {
    $q = $db->prepare('select totp_enabled from admin_users where id = ?');
    $q->execute([$admin['id']]);
    store_out(['enabled' => (int)$q->fetchColumn() === 1]);
}

if (in_array($r, ['mfa_start', 'mfa_confirm', 'mfa_cancel'], true) && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json') {
        store_fail('bad_request', 403);
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 4096) store_fail('request_too_large', 413);
    $body = store_body(4096);

    if ($r === 'mfa_cancel') {
        store_session_start();
        unset($_SESSION['pending_totp_secret'], $_SESSION['pending_totp_at'],
              $_SESSION['pending_totp_admin_id'], $_SESSION['pending_totp_password_hash'],
              $_SESSION['pending_totp_attempts']);
        store_out(['ok' => true]);
    }

    store_throttle($db, 'mfa_setup', 12, 600);
    if ($r === 'mfa_start') {
        $q = $db->prepare('select email, password_hash, totp_enabled from admin_users where id = ?');
        $q->execute([$admin['id']]);
        $user = $q->fetch();
        if (!$user || (int)$user['totp_enabled'] === 1) store_fail('already_enabled', 409);
        if (!store_admin_verify_password((string)($body['password'] ?? ''), (string)$user['password_hash'])) {
            store_fail('bad_credentials', 401);
        }
        // Fail before offering a setup key if the additive migration has not
        // been installed. Enabling without backup-code storage risks lockout.
        try { $db->query('select 1 from admin_recovery_codes limit 1'); }
        catch (PDOException $e) { store_fail('mfa_storage_missing', 503); }

        $secret = store_totp_generate_secret();
        store_session_start();
        $_SESSION['pending_totp_secret'] = $secret;
        $_SESSION['pending_totp_at'] = time();
        $_SESSION['pending_totp_admin_id'] = (int)$admin['id'];
        $_SESSION['pending_totp_password_hash'] = hash('sha256', (string)$user['password_hash']);
        $_SESSION['pending_totp_attempts'] = 0;
        $issuer = 'Sporta Backends';
        $uri = 'otpauth://totp/' . rawurlencode($issuer . ':' . $user['email'])
             . '?secret=' . rawurlencode($secret) . '&issuer=' . rawurlencode($issuer)
             . '&algorithm=SHA1&digits=6&period=30';
        store_out(['secret' => $secret, 'uri' => $uri, 'expires_in' => 600]);
    }

    store_session_start();
    $secret = (string)($_SESSION['pending_totp_secret'] ?? '');
    $since = (int)($_SESSION['pending_totp_at'] ?? 0);
    $pendingId = (int)($_SESSION['pending_totp_admin_id'] ?? 0);
    $passwordFingerprint = (string)($_SESSION['pending_totp_password_hash'] ?? '');
    if ($secret === '' || $since < 1 || time() - $since > 600
        || $pendingId !== (int)$admin['id'] || $passwordFingerprint === '') {
        unset($_SESSION['pending_totp_secret'], $_SESSION['pending_totp_at'],
              $_SESSION['pending_totp_admin_id'], $_SESSION['pending_totp_password_hash'],
              $_SESSION['pending_totp_attempts']);
        store_fail('setup_expired', 401);
    }
    $step = store_totp_verify($secret, (string)($body['code'] ?? ''));
    if ($step === null) {
        $_SESSION['pending_totp_attempts'] = (int)($_SESSION['pending_totp_attempts'] ?? 0) + 1;
        if ($_SESSION['pending_totp_attempts'] >= 5) {
            unset($_SESSION['pending_totp_secret'], $_SESSION['pending_totp_at'],
                  $_SESSION['pending_totp_admin_id'], $_SESSION['pending_totp_password_hash'],
                  $_SESSION['pending_totp_attempts']);
            store_fail('setup_expired', 429);
        }
        store_fail('bad_code', 401);
    }

    $codes = store_recovery_codes_generate();
    $db->beginTransaction();
    try {
        $q = $db->prepare('select password_hash, totp_enabled from admin_users where id = ? for update');
        $q->execute([$admin['id']]);
        $current = $q->fetch();
        if (!$current || (int)$current['totp_enabled'] === 1
            || !hash_equals(hash('sha256', (string)$current['password_hash']), $passwordFingerprint)) {
            throw new RuntimeException('setup_changed');
        }
        $q = $db->prepare('update admin_users set totp_secret = ?, totp_enabled = 1, totp_last_step = ? where id = ? and totp_enabled = 0');
        $q->execute([$secret, $step, $admin['id']]);
        if ($q->rowCount() !== 1) throw new RuntimeException('setup_changed');
        store_recovery_replace($db, (int)$admin['id'], $codes);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($e instanceof RuntimeException && $e->getMessage() === 'setup_changed') {
            store_fail('setup_expired', 409);
        }
        store_fail('mfa_storage_missing', 503);
    }
    unset($_SESSION['pending_totp_secret'], $_SESSION['pending_totp_at'],
          $_SESSION['pending_totp_admin_id'], $_SESSION['pending_totp_password_hash'],
          $_SESSION['pending_totp_attempts']);
    // Other sessions lose access after the enrollment change. Keep this
    // password-confirmed session current so the backup codes can be saved.
    $_SESSION['admin_auth_fingerprint'] = store_admin_fingerprint([
        'password_hash' => $current['password_hash'],
        'totp_enabled' => 1,
        'totp_secret' => $secret,
    ]);
    store_out(['enabled' => true, 'recovery_codes' => $codes]);
}

// ------------------------------------------------------- internal CRM
// All CRM reads and writes sit after the admin session gate. Phone contacts
// describe guest-order contact points; account contacts use the account ID.
// They are never silently joined by matching phone or email strings.
if (in_array($r, ['crm_list', 'crm_detail', 'crm_save', 'crm_create', 'crm_note'], true)) {
    require_once __DIR__ . '/crm.php';
    $isWrite = in_array($r, ['crm_save', 'crm_create', 'crm_note'], true);
    if ($method !== ($isWrite ? 'POST' : 'GET')) store_fail('method_not_allowed', 405);
    store_throttle($db, $isWrite ? 'crm_write' : 'crm_read', $isWrite ? 30 : 60, 60);
    if ($isWrite) {
        if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1' ||
            strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json' ||
            ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) store_fail('request_too_large', 413);
    }
    $page = static function (string $name): int {
        $raw = $_GET[$name] ?? '1';
        if (!is_string($raw) || !preg_match('/^[1-9][0-9]{0,3}$/D', $raw) || (int)$raw > 500) {
            store_fail('invalid_page');
        }
        return (int)$raw;
    };
    if ($r === 'crm_list') {
        $query = $_GET['q'] ?? '';
        $status = $_GET['status'] ?? 'all';
        $source = $_GET['source'] ?? 'all';
        $due = $_GET['due'] ?? '0';
        if (!is_string($query) || mb_strlen($query) > 80 || preg_match('/[\x00-\x1f\x7f]/u', $query)
            || !is_string($status) || !in_array($status, ['all','new','active','follow_up','vip','inactive'], true)
            || !is_string($source) || !in_array($source, ['all','account','phone'], true)
            || !is_string($due) || !in_array($due, ['0','1'], true)) store_fail('invalid_filter');
        store_out(crm_list($db, $query, $page('page'), $status, $source, $due === '1'));
    }
    if ($r === 'crm_detail') {
        $key = $_GET['key'] ?? null;
        if (!is_string($key) || crm_parse_key($key) === null) store_fail('invalid_contact');
        $detail = crm_detail($db, $key, $page('orders_page'), $page('notes_page'));
        if ($detail === null) store_fail('not_found', 404);
        store_out($detail);
    }
    $body = store_body(8192);
    $input = in_array($r, ['crm_save', 'crm_create'], true) ? crm_save_input($body) : crm_note_input($body);
    if (isset($input['error'])) store_fail($input['error']);
    try {
        if ($r === 'crm_save') store_out(['contact' => crm_save($db, $input, (string)$admin['email'])]);
        if ($r === 'crm_create') store_out(['contact' => crm_create($db, $input, (string)$admin['email'])], 201);
        store_out(['note' => crm_add_note($db, $input, (string)$admin['email'])]);
    } catch (InvalidArgumentException $e) {
        if ($e->getMessage() === 'contact_exists') store_fail('contact_exists', 409);
        store_fail($e->getMessage() === 'not_found' ? 'not_found' : 'invalid_contact', 404);
    }
}

// ------------------------------------------------------ customer profiles
if (in_array($r, ['profiles_list', 'profile_detail'], true)) {
    require_once __DIR__ . '/profiles.php';
    if ($method !== 'GET') store_fail('method_not_allowed', 405);
    store_throttle($db, 'profiles_read', 90, 60);
    if ($r === 'profiles_list') {
        $query = $_GET['q'] ?? ''; $page = $_GET['page'] ?? '1';
        if (!is_string($query) || mb_strlen($query) > 80 || preg_match('/[\x00-\x1f\x7f]/u', $query) || !is_string($page) || !preg_match('/^[1-9][0-9]{0,3}$/D', $page) || (int)$page > 500) store_fail('invalid_filter');
        store_out(profiles_list($db, trim($query), (int)$page));
    }
    $id = $_GET['id'] ?? null;
    if (!is_string($id) || !preg_match('/^[1-9][0-9]{0,17}$/D', $id)) store_fail('invalid_profile');
    $detail = profiles_detail($db, (int)$id); if ($detail === null) store_fail('not_found', 404); store_out($detail);
}

// --------------------------------------------------- customer support queue
if (in_array($r, ['support_list', 'support_detail', 'support_update', 'support_reply'], true)) {
    require_once __DIR__ . '/support.php';
    $write = in_array($r, ['support_update', 'support_reply'], true);
    if ($method !== ($write ? 'POST' : 'GET')) store_fail('method_not_allowed', 405);
    store_throttle($db, $write ? 'support_admin_write' : 'support_admin_read', $write ? 30 : 90, 60);
    if ($write && (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1' || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json' || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site')) store_fail('bad_request', 403);
    if ($r === 'support_list') {
        $status = $_GET['status'] ?? 'all'; $query = $_GET['q'] ?? '';
        if (!is_string($status) || ($status !== 'all' && !in_array($status, SUPPORT_STATUSES, true)) || !is_string($query) || mb_strlen($query) > 80 || preg_match('/[\x00-\x1f\x7f]/u', $query)) store_fail('invalid_filter');
        store_out(support_admin_list($db, $status, trim($query)));
    }
    if ($r === 'support_detail') {
        $id = $_GET['id'] ?? null; if (!is_string($id) || !preg_match('/^[1-9][0-9]{0,17}$/D', $id)) store_fail('invalid_ticket');
        $detail = support_admin_detail($db, (int)$id); if ($detail === null) store_fail('not_found', 404); store_out($detail);
    }
    $body = support_body();
    try { store_out($r === 'support_update' ? support_admin_update($db, $body, (string)$admin['email']) : support_admin_reply($db, $body, (string)$admin['email'])); }
    catch (InvalidArgumentException $e) { store_fail($e->getMessage(), $e->getMessage() === 'not_found' ? 404 : 400); }
}

// ------------------------------------------------------- returns/exchanges
// Queue, item snapshots and private review history are visible only after the
// admin session gate above. Status changes are audited and never settle money
// or adjust stock; refund and replacement fulfilment remain separate actions.
if (in_array($r, ['return_requests', 'return_detail', 'return_status'], true)) {
    require_once __DIR__ . '/returns.php';
    $write = $r === 'return_status';
    if ($method !== ($write ? 'POST' : 'GET')) store_fail('method_not_allowed', 405);
    store_throttle($db, $write ? 'return_admin_write' : 'return_admin_read', $write ? 30 : 90, 60);
    if ($write && (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site'
        || (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192)) store_fail('bad_request', 403);
    if ($r === 'return_requests') {
        $status = $_GET['status'] ?? 'all';
        $search = $_GET['search'] ?? '';
        $rawPage = $_GET['page'] ?? '1';
        if (!is_string($status) || ($status !== 'all' && !in_array($status, RETURNS_STATUSES, true))
            || !is_string($search) || mb_strlen($search) > 80
            || preg_match('/[\x00-\x1f\x7f]/u', $search)
            || !is_string($rawPage) || !preg_match('/^[1-9][0-9]{0,2}$/D', $rawPage)
            || (int)$rawPage > 500) store_fail('invalid_filter');
        store_out(returns_admin_list($db, $status, trim($search), (int)$rawPage));
    }
    if ($r === 'return_detail') {
        $rawId = $_GET['id'] ?? null;
        if (!is_string($rawId) || !preg_match('/^[1-9][0-9]{0,17}$/D', $rawId)
            || filter_var($rawId, FILTER_VALIDATE_INT) === false) store_fail('invalid_request');
        $detail = returns_admin_detail($db, (int)$rawId);
        if ($detail === null) store_fail('not_found', 404);
        store_out($detail);
    }
    $body = returns_request_body();
    if (!is_int($body['id'] ?? null) || !is_string($body['status'] ?? null)
        || !is_string($body['expected_status'] ?? null)
        || !is_string($body['note'] ?? '')) store_fail('invalid_request');
    try {
        store_out(returns_admin_status($db, $body['id'], $body['status'],
            $body['expected_status'], $body['note'] ?? '', (string)$admin['email']));
    } catch (InvalidArgumentException $e) {
        $token = $e->getMessage();
        store_fail($token, $token === 'not_found' ? 404 :
            ($token === 'status_changed' || $token === 'invalid_transition' ? 409 : 400));
    }
}

// Refresh PHP's compiled script cache after a deployment. This intentionally
// leaves payment-token and voice caches alone: those are valid, expensive to
// rebuild, and unrelated to stale application code. The browser cache is
// cleared by the signed-in admin UI in the same action.
if ($r === 'clear_cache' && $method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    $phpCleared = function_exists('opcache_reset') ? (bool) @opcache_reset() : false;
    clearstatcache(true);
    store_out(['ok' => true, 'php_cache_cleared' => $phpCleared]);
}

// ------------------------------------------------------------ payment setup
// Payment credentials can be replaced from the authenticated backend without
// ever being read back into the browser. Blank secret fields mean "keep the
// current value". The gateway hosts are allowlisted because these files hold
// credentials that the payment endpoints transmit server-to-server.
if ($r === 'payment_config') {
    $root = dirname(__DIR__);
    $paths = [
        'knet' => sporta_config_path('knet', $root . '/knet/config.php'),
        'tpay' => sporta_config_path('tpay', $root . '/pay/config.php'),
    ];
    $loadConfig = static function (string $path): ?array {
        if (!is_file($path)) return null;
        $value = require $path;
        return is_array($value) ? $value : null;
    };
    $isConfigured = static function ($value): bool {
        $value = (string)$value;
        return trim($value) !== '' && !str_starts_with(trim($value), 'YOUR_');
    };
    $publicShape = static function (?array $cfg, string $gateway) use ($isConfigured): array {
        if ($cfg === null) return ['installed' => false];
        if ($gateway === 'knet') {
            $active = in_array(($cfg['env'] ?? ''), ['test', 'production'], true) ? (string)$cfg['env'] : 'test';
            $credentialState = [];
            foreach (['test', 'production'] as $slot) {
                $fallback = $slot === $active;
                $credentialState[$slot] = [
                    'has_tranportal_id' => $isConfigured($cfg[$slot . '_tranportal_id'] ?? ($fallback ? ($cfg['tranportal_id'] ?? '') : '')),
                    'has_tranportal_password' => $isConfigured($cfg[$slot . '_tranportal_password'] ?? ($fallback ? ($cfg['tranportal_password'] ?? '') : '')),
                    'has_resource_key' => $isConfigured($cfg[$slot . '_resource_key'] ?? ($fallback ? ($cfg['resource_key'] ?? '') : '')),
                ];
            }
            return [
                'installed' => true,
                'env' => (string)($cfg['env'] ?? 'test'),
                'test_url' => (string)($cfg['test_url'] ?? ''),
                'production_url' => (string)($cfg['production_url'] ?? ''),
                'response_url' => (string)($cfg['response_url'] ?? ''),
                'error_url' => (string)($cfg['error_url'] ?? ''),
                'result_page_url' => (string)($cfg['result_page_url'] ?? ''),
                'has_tranportal_id' => $isConfigured($cfg['tranportal_id'] ?? ''),
                'has_tranportal_password' => $isConfigured($cfg['tranportal_password'] ?? ''),
                'has_resource_key' => $isConfigured($cfg['resource_key'] ?? ''),
                'credentials' => $credentialState,
            ];
        }
        return [
            'installed' => true,
            'env' => (string)($cfg['env'] ?? 'test'),
            'test_base' => (string)($cfg['test_base'] ?? ''),
            'production_base' => (string)($cfg['production_base'] ?? ''),
            'return_url' => (string)($cfg['return_url'] ?? ''),
            'result_page_url' => (string)($cfg['result_page_url'] ?? ''),
            'has_client_id' => $isConfigured($cfg['client_id'] ?? ''),
            'has_client_secret' => $isConfigured($cfg['client_secret'] ?? ''),
            'has_encrp_key' => $isConfigured($cfg['encrp_key'] ?? ''),
        ];
    };

    if ($method === 'GET') {
        store_out([
            'knet' => $publicShape($loadConfig($paths['knet']), 'knet'),
            'tpay' => $publicShape($loadConfig($paths['tpay']), 'tpay'),
        ]);
    }
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) store_fail('request_too_large', 413);

    $body = store_body(32768);
    $gateway = strtolower(trim((string)($body['gateway'] ?? '')));
    if (!array_key_exists($gateway, $paths)) store_fail('invalid_gateway');
    $current = $loadConfig($paths[$gateway]);
    if ($current === null) store_fail('config_missing', 409);
    $env = strtolower(trim((string)($body['env'] ?? '')));
    if (!in_array($env, ['test', 'production'], true)) store_fail('invalid_environment');

    $url = static function ($value, array $hosts, string $field): string {
        $value = trim((string)$value);
        $parts = parse_url($value);
        $host = strtolower((string)($parts['host'] ?? ''));
        if (($parts['scheme'] ?? '') !== 'https' || !in_array($host, $hosts, true)) {
            store_fail('invalid_' . $field);
        }
        return $value;
    };
    $sportaUrl = static fn($value, string $field): string => $url(
        $value, ['sporta.com.kw', 'www.sporta.com.kw'], $field
    );
    $secret = static function (array $body, array $current, string $key, bool $trim = true): string {
        $incoming = (string)($body[$key] ?? '');
        if ($incoming === '') return (string)($current[$key] ?? '');
        return $trim ? trim($incoming) : $incoming;
    };

    $next = $current;
    $next['env'] = $env;
    if ($gateway === 'knet') {
        $next['test_url'] = $url($body['test_url'] ?? '', ['kpaytest.com.kw'], 'test_url');
        $next['production_url'] = $url($body['production_url'] ?? '', ['kpay.com.kw'], 'production_url');
        $next['response_url'] = $sportaUrl($body['response_url'] ?? '', 'response_url');
        $next['error_url'] = $sportaUrl($body['error_url'] ?? '', 'error_url');
        $next['result_page_url'] = $sportaUrl($body['result_page_url'] ?? '', 'result_page_url');
        $previousEnv = in_array(($current['env'] ?? ''), ['test', 'production'], true) ? (string)$current['env'] : 'test';
        foreach (['test', 'production'] as $slot) {
            foreach (['tranportal_id', 'tranportal_password', 'resource_key'] as $name) {
                $slotKey = $slot . '_' . $name;
                $fallback = $slot === $previousEnv ? (string)($current[$name] ?? '') : '';
                $existing = array_key_exists($slotKey, $current) ? (string)$current[$slotKey] : $fallback;
                $incoming = (string)($body[$slotKey] ?? '');
                $next[$slotKey] = $incoming === '' ? $existing : ($name === 'resource_key' ? $incoming : trim($incoming));
            }
        }
        $next['tranportal_id'] = (string)$next[$env . '_tranportal_id'];
        $next['tranportal_password'] = (string)$next[$env . '_tranportal_password'];
        $next['resource_key'] = (string)$next[$env . '_resource_key'];
        // Merchant ID and Terminal ID are identifiers, not secrets, and the
        // classic KPG request does not carry them (only the Tranportal ID
        // does) — they are kept for the operator and the bank's paperwork.
        // They are edited through `payment_identifiers` below; here the
        // active pair simply follows the environment, the same way the
        // Tranportal credentials do, so switching Test/Production never
        // leaves the live pair pointing at the test values.
        foreach (['merchant_id', 'terminal_id'] as $idName) {
            foreach (['test', 'production'] as $slot) {
                $slotKey = $slot . '_' . $idName;
                if (!array_key_exists($slotKey, $next)) {
                    $next[$slotKey] = $slot === $previousEnv ? store_clean_identifier($current[$idName] ?? '') : '';
                }
            }
            $next[$idName] = (string)$next[$env . '_' . $idName];
        }
        $next['language'] = 'USA';
        if (!$isConfigured($next['tranportal_id']) || !$isConfigured($next['tranportal_password'])) store_fail('merchant_credentials_required');
        if (strlen($next['resource_key']) !== 16 || trim($next['resource_key']) !== $next['resource_key']) store_fail('resource_key_must_be_16_bytes');
    } else {
        $next['test_base'] = $url($body['test_base'] ?? '', ['pgtest.cbk.com'], 'test_base');
        $next['production_base'] = $url($body['production_base'] ?? '', ['pg.cbk.com'], 'production_base');
        $next['return_url'] = $sportaUrl($body['return_url'] ?? '', 'return_url');
        $next['result_page_url'] = $sportaUrl($body['result_page_url'] ?? '', 'result_page_url');
        $next['client_id'] = $secret($body, $current, 'client_id');
        $next['client_secret'] = $secret($body, $current, 'client_secret');
        $next['encrp_key'] = $secret($body, $current, 'encrp_key', false);
        if (!$isConfigured($next['client_id']) || !$isConfigured($next['client_secret'])) store_fail('merchant_credentials_required');
        if (!$isConfigured($next['encrp_key'])) store_fail('encrypted_account_key_required');
        // CBK's Authorization entity: ClientId (Merchant API ID) max 50,
        // ClientSecret (Merchant API Password) max 100. Longer is a paste
        // error the bank would only report as a failed Authenticate.
        if (strlen($next['client_id']) > 50) store_fail('client_id_too_long');
        if (strlen($next['client_secret']) > 100) store_fail('client_secret_too_long');
    }

    $path = $paths[$gateway];
    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $php = "<?php\n// Managed by Sporta Backends. Secrets are never returned to the browser.\nreturn "
        . var_export($next, true) . ";\n";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) store_fail('config_not_writable', 500);
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        store_fail('config_not_writable', 500);
    }
    clearstatcache(true, $path);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    store_out(['gateway' => $gateway, 'config' => $publicShape($next, $gateway)]);
}

// ----------------------------------------------- KNET merchant / terminal IDs
// Two plain identifiers per environment, edited on their own so the secret
// form (which re-sends everything it holds) is never involved. Unlike the
// Tranportal password and the resource key they are not secrets and ARE
// returned, so the operator can see which pair is on file. Blank clears one.
// The Tranportal ID stays with the credentials in `payment_config`.
if ($r === 'payment_identifiers') {
    $path = sporta_config_path('knet', dirname(__DIR__) . '/knet/config.php');
    $cfg = is_file($path) ? require $path : null;
    if (!is_array($cfg)) store_fail('config_missing', 409);

    $active = in_array(($cfg['env'] ?? ''), ['test', 'production'], true) ? (string)$cfg['env'] : 'test';
    $shape = static function (array $c) use ($active): array {
        $out = ['env' => $active];
        foreach (['test', 'production'] as $slot) {
            foreach (['merchant_id', 'terminal_id'] as $name) {
                $out[$slot][$name] = store_clean_identifier(
                    $c[$slot . '_' . $name] ?? ($slot === $active ? ($c[$name] ?? '') : '')
                );
            }
        }
        return $out;
    };

    if ($method === 'GET') store_out($shape($cfg));
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 4096) store_fail('request_too_large', 413);

    $body = store_body(4096);
    $next = $cfg;
    foreach (['test', 'production'] as $slot) {
        foreach (['merchant_id', 'terminal_id'] as $name) {
            $key = $slot . '_' . $name;
            // All four must be sent: a missing one is a client bug, and
            // treating it as "clear" would silently wipe a saved identifier.
            if (!array_key_exists($key, $body) || !is_string($body[$key])) store_fail('invalid_identifier');
            $value = trim($body[$key]);
            if (!preg_match('/^[A-Za-z0-9._-]{0,40}$/D', $value)) store_fail('invalid_identifier');
            $next[$key] = $value;
        }
    }
    foreach (['merchant_id', 'terminal_id'] as $name) $next[$name] = (string)$next[$active . '_' . $name];

    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $php = "<?php\n// Managed by Sporta Backends. Secrets are never returned to the browser.\nreturn "
        . var_export($next, true) . ";\n";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) store_fail('config_not_writable', 500);
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        store_fail('config_not_writable', 500);
    }
    clearstatcache(true, $path);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    store_admin_event($db, $admin, 'payment_identifiers_save');
    store_out($shape($next));
}

// ------------------------------------------------ T-Pay Merchant Server IPs
// CBK asks for two "Merchant Server IP" values during onboarding and checks
// the caller's address against them. They are allowlist values on CBK's side:
// no request carries them, so nothing in the payment path reads them. They are
// kept here so the operator can see what was registered. Not secrets, and
// returned. Blank clears one; anything else must be a valid IPv4/IPv6 address.
// The ClientId, ClientSecret, ENCRP_KEY and return URL stay in `payment_config`.
if ($r === 'payment_server_ips') {
    $path = sporta_config_path('tpay', dirname(__DIR__) . '/pay/config.php');
    $cfg = is_file($path) ? require $path : null;
    if (!is_array($cfg)) store_fail('config_missing', 409);
    $shape = static fn (array $c): array => [
        'server_ip_1' => store_clean_identifier($c['server_ip_1'] ?? ''),
        'server_ip_2' => store_clean_identifier($c['server_ip_2'] ?? ''),
    ];

    if ($method === 'GET') store_out($shape($cfg));
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2048) store_fail('request_too_large', 413);

    $body = store_body(2048);
    $next = $cfg;
    foreach (['server_ip_1', 'server_ip_2'] as $key) {
        // Both must be sent; a missing one is a client bug, not "clear".
        if (!array_key_exists($key, $body) || !is_string($body[$key])) store_fail('invalid_server_ip');
        $value = trim($body[$key]);
        if ($value !== '' && filter_var($value, FILTER_VALIDATE_IP) === false) store_fail('invalid_server_ip');
        $next[$key] = $value;
    }

    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $php = "<?php\n// Managed by Sporta Backends. Secrets are never returned to the browser.\nreturn "
        . var_export($next, true) . ";\n";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) store_fail('config_not_writable', 500);
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        store_fail('config_not_writable', 500);
    }
    clearstatcache(true, $path);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    store_admin_event($db, $admin, 'payment_server_ips_save');
    store_out($shape($next));
}

// ------------------------------------------- KNET through the CBK (T-Pay) setup
// CBK's hosted page takes KNET (tij_MerchPayType 1) and T-Pay (2) with the SAME
// ClientId / ClientSecret / ENCRP_KEY. `knet_via_cbk` in the T-Pay config makes
// a KNET order be paid there instead of through the classic Tranportal
// endpoint, so one set of credentials covers both. Off by default. It can only
// be switched ON while the T-Pay credentials are really filled in; switching it
// off is always allowed, and it takes effect on the next payment.
if ($r === 'payment_knet_via_cbk') {
    $path = sporta_config_path('tpay', dirname(__DIR__) . '/pay/config.php');
    $cfg = is_file($path) ? require $path : null;
    if (!is_array($cfg)) store_fail('config_missing', 409);
    $ready = static fn (array $c): bool => store_clean_identifier($c['client_id'] ?? '') !== ''
        && store_clean_identifier($c['client_secret'] ?? '') !== ''
        && store_clean_identifier($c['encrp_key'] ?? '') !== '';
    $shape = static fn (array $c): array => ['enabled' => !empty($c['knet_via_cbk']), 'tpay_ready' => $ready($c)];

    if ($method === 'GET') store_out($shape($cfg));
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 1024) store_fail('request_too_large', 413);

    $body = store_body(1024);
    if (!array_key_exists('enabled', $body) || !is_bool($body['enabled'])) store_fail('invalid_value');
    if ($body['enabled'] && !$ready($cfg)) store_fail('tpay_credentials_required', 409);
    $next = $cfg;
    $next['knet_via_cbk'] = $body['enabled'];

    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $php = "<?php\n// Managed by Sporta Backends. Secrets are never returned to the browser.\nreturn "
        . var_export($next, true) . ";\n";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) store_fail('config_not_writable', 500);
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        store_fail('config_not_writable', 500);
    }
    clearstatcache(true, $path);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    store_admin_event($db, $admin, $body['enabled'] ? 'knet_via_cbk_on' : 'knet_via_cbk_off');
    store_out($shape($next));
}

// A signed-in operator needs to know whether KNET and T-Pay are actually
// ready, but merchant credentials must never cross the server boundary. This
// route therefore returns checks and host names only: no IDs, passwords,
// resource keys, encrypted account keys, database names, or IP addresses.
if ($r === 'payment_status') {
    $shop = store_config();
    $root = dirname(__DIR__);

    $configured = static function ($value, string $placeholder = 'YOUR_'): bool {
        $value = (string)$value;
        return trim($value) !== '' && !str_starts_with(trim($value), $placeholder);
    };
    $httpsSporta = static function ($value): bool {
        $parts = parse_url((string)$value);
        $host = strtolower((string)($parts['host'] ?? ''));
        return strtolower((string)($parts['scheme'] ?? '')) === 'https'
            && in_array($host, ['sporta.com.kw', 'www.sporta.com.kw'], true);
    };
    $gatewayHost = static function ($value): string {
        return strtolower((string)(parse_url((string)$value, PHP_URL_HOST) ?: ''));
    };
    $sameDb = static function (array $pay, array $store): bool {
        return trim((string)($pay['mysql_host'] ?? '')) === trim((string)($store['db_host'] ?? ''))
            && trim((string)($pay['mysql_name'] ?? '')) !== ''
            && hash_equals(trim((string)($store['db_name'] ?? '')), trim((string)($pay['mysql_name'] ?? '')))
            && trim((string)($pay['mysql_user'] ?? '')) !== ''
            && hash_equals(trim((string)($store['db_user'] ?? '')), trim((string)($pay['mysql_user'] ?? '')));
    };
    $load = static function (string $path): ?array {
        if (!is_file($path)) return null;
        $value = require $path;
        return is_array($value) ? $value : null;
    };
    $withStoreDb = static function (?array $pay, array $store): ?array {
        if ($pay === null) return null;
        foreach (['host' => 'mysql_host', 'name' => 'mysql_name', 'user' => 'mysql_user', 'pass' => 'mysql_pass'] as $from => $to) {
            if (($pay[$to] ?? '') === '' && array_key_exists('db_' . $from, $store)) {
                $pay[$to] = (string)$store['db_' . $from];
            }
        }
        return $pay;
    };

    $knet = $withStoreDb($load(sporta_config_path('knet', $root . '/knet/config.php')), $shop);
    if ($knet === null) {
        $knetStatus = ['installed' => false, 'ready' => false, 'mode' => 'unknown', 'gateway_host' => '', 'checks' => []];
    } else {
        $mode = (string)($knet['env'] ?? '');
        $key = (string)($knet['resource_key'] ?? '');
        $url = $mode === 'production' ? ($knet['production_url'] ?? '') : ($knet['test_url'] ?? '');
        $checks = [
            'merchant_credentials' => $configured($knet['tranportal_id'] ?? '') && $configured($knet['tranportal_password'] ?? ''),
            'resource_key' => $configured($key) && strlen($key) === 16 && trim($key) === $key,
            'return_urls' => $httpsSporta($knet['response_url'] ?? '') && $httpsSporta($knet['error_url'] ?? '') && $httpsSporta($knet['result_page_url'] ?? ''),
            'orders_database' => $sameDb($knet, $shop),
            'environment' => in_array($mode, ['test', 'production'], true),
        ];
        $knetStatus = ['installed' => true, 'ready' => !in_array(false, $checks, true), 'mode' => $mode, 'gateway_host' => $gatewayHost($url), 'checks' => $checks];
    }

    $tpay = $withStoreDb($load(sporta_config_path('tpay', $root . '/pay/config.php')), $shop);
    if ($tpay === null) {
        $tpayStatus = ['installed' => false, 'ready' => false, 'mode' => 'unknown', 'gateway_host' => '', 'checks' => []];
    } else {
        $mode = (string)($tpay['env'] ?? '');
        $base = $mode === 'production' ? ($tpay['production_base'] ?? '') : ($tpay['test_base'] ?? '');
        $checks = [
            'merchant_credentials' => $configured($tpay['client_id'] ?? '') && $configured($tpay['client_secret'] ?? ''),
            'encrypted_account_key' => $configured($tpay['encrp_key'] ?? ''),
            'return_urls' => $httpsSporta($tpay['return_url'] ?? '') && $httpsSporta($tpay['result_page_url'] ?? ''),
            'orders_database' => $sameDb($tpay, $shop),
            'environment' => in_array($mode, ['test', 'production'], true),
        ];
        $tpayStatus = ['installed' => true, 'ready' => !in_array(false, $checks, true), 'mode' => $mode, 'gateway_host' => $gatewayHost($base), 'checks' => $checks];
    }

    store_out(['knet' => $knetStatus, 'tpay' => $tpayStatus]);
}

// --------------------------------------------------------------------- stats
// Same columns as admin_order_stats — Overview reads these keys by name.
if ($r === 'stats') {
    $row = $db->query("
        select
          count(case when payment_status = 'paid' then 1 end)                          as paid_count,
          coalesce(sum(case when payment_status = 'paid' then amount end), 0)          as paid_revenue,
          count(case when payment_status = 'pending' then 1 end)                       as pending_count,
          count(case when payment_status = 'review' then 1 end)                        as review_count,
          count(case when payment_status = 'failed' then 1 end)                        as failed_count,
          count(case when payment_status = 'paid' and fulfilment_status = 'unfulfilled' then 1 end) as unfulfilled_count,
          count(case when payment_status = 'paid' and paid_at >= curdate() then 1 end) as paid_today,
          coalesce(sum(case when payment_status = 'paid' and paid_at >= curdate() then amount end), 0) as revenue_today,
          count(case when payment_status = 'paid' and paid_at >= curdate() - interval 7 day then 1 end) as paid_7d,
          coalesce(sum(case when payment_status = 'paid' and paid_at >= curdate() - interval 7 day then amount end), 0) as revenue_7d,
          count(case when payment_method = 'cod' and payment_status = 'pending' then 1 end) as cod_awaiting_count,
          coalesce(sum(case when payment_method = 'cod' and payment_status = 'pending' then amount end), 0) as cod_awaiting_amount
        from orders
    ")->fetch();
    store_out($row);
}

if ($r === 'revenue') {
    $days = max(1, min(60, (int)($_GET['days'] ?? 14)));
    $q = $db->prepare("
        select date(paid_at) as day, sum(amount) as revenue
          from orders
         where payment_status = 'paid' and paid_at >= curdate() - interval ? day
         group by date(paid_at) order by day
    ");
    $q->execute([$days]);
    store_out($q->fetchAll());
}

// -------------------------------------------------------------------- orders
if ($r === 'orders') {
    $sql = 'select id, track_id, amount, subtotal, discount_amount, discount_code, delivery_fee,
                   payment_status, payment_method, fulfilment_status,
                   paid_at, created_at, customer_name, customer_phone, customer_area,
                   customer_note, customer_governorate, customer_block, customer_street,
                   customer_building, customer_floor, customer_flat,
                   cbk_paymentid, cbk_reference, cbk_status,
                   -- Which ad produced the order. The whole point of recording
                   -- it is that the owner can see it beside the money.
                   utm_source, utm_medium, utm_campaign, referrer_host
              from orders';
    $where = [];
    $args = [];
    $payment = $_GET['payment'] ?? 'all';
    $fulfilment = $_GET['fulfilment'] ?? 'all';
    // "unpaid" is a staff-facing group for work queues: it deliberately
    // includes pending, review and failed orders while preserving the precise
    // status returned in each row. This does not change any payment record.
    if ($payment === 'unpaid') {
        $where[] = "payment_status <> 'paid'";
    } elseif (in_array($payment, ['paid','pending','review','failed'], true)) {
        $where[] = 'payment_status = ?'; $args[] = $payment;
    }
    if (in_array($fulfilment, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        $where[] = 'fulfilment_status = ?'; $args[] = $fulfilment;
    }
    $term = mb_substr(trim((string)($_GET['search'] ?? '')), 0, 80);
    if ($term !== '') {
        // Search the details an operator actually has when a customer calls.
        // Escape LIKE metacharacters so a typed % or _ is literal, while all
        // values remain bound parameters rather than SQL fragments.
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $term) . '%';
        $where[] = "(track_id like ? escape '!' or customer_name like ? escape '!' or customer_phone like ? escape '!')";
        array_push($args, $like, $like, $like);
    }
    if ($where) $sql .= ' where ' . implode(' and ', $where);
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, min(100000, (int)($_GET['offset'] ?? 0)));
    $sql .= ' order by created_at desc, id desc limit ' . $limit . ' offset ' . $offset;
    $q = $db->prepare($sql);
    $q->execute($args);
    $rows = $q->fetchAll();
    foreach ($rows as &$row) {
        foreach (['amount', 'subtotal', 'discount_amount', 'delivery_fee'] as $money) {
            $row[$money] = (float)$row[$money];
        }
        $row['id'] = (int)$row['id'];
    }
    store_out($rows);
}

if ($r === 'items') {
    // Nested `products` object, matching the join shape the Orders
    // screen already renders.
    $q = $db->prepare(
        // The name AS SOLD, falling back to the catalogue for lines placed
        // before order_items carried it. The owner reading an order in
        // /backends must see what the customer's invoice says, or a return
        // conversation has the two of them describing different items.
        'select oi.id, oi.qty, oi.unit_price, oi.size, oi.fit, p.slug,
                coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ?'
    );
    $q->execute([(int)($_GET['order'] ?? 0)]);
    $out = [];
    foreach ($q->fetchAll() as $row) {
        $out[] = [
            'id' => (int)$row['id'], 'qty' => (int)$row['qty'],
            'unit_price' => (float)$row['unit_price'],
            'size' => $row['size'], 'fit' => $row['fit'],
            'products' => ['slug' => $row['slug'], 'name_en' => $row['name_en'], 'name_ar' => $row['name_ar']],
        ];
    }
    store_out($out);
}

if ($r === 'fulfilment' && $method === 'POST') {
    $b = store_body();
    $status = (string)($b['status'] ?? '');
    if (!in_array($status, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        store_fail('invalid_status');
    }
    $orderId = (int)($b['order_id'] ?? 0);
    // ONE TRANSACTION for the status, its tracking event, the warehouse
    // message and the stock. Before this the status was written on its own,
    // so a cancel could land without its "do not ship", and a reinstate
    // could land without its stock.
    $db->beginTransaction();
    try {
        // FOR UPDATE: the sweeper and a payment callback take the same row
        // lock (store_stock_release), so a cancel and a release cannot both
        // act on one order.
        // cod_hold_expired: a cash order past its hold (cod_hold_hours, 0 = off),
        // still pending, is one the sweeper cancels. Computed here, from the same
        // setting and the same clock, so the refusal below matches the sweeper.
        $codHours = store_cod_hold_hours();
        $check = $db->prepare('select payment_status, payment_method, fulfilment_status,
                                      (created_at < (now() - interval ? hour)) as cod_hold_expired
                                 from orders where id = ? for update');
        $check->execute([max(1, $codHours), $orderId]);
        $order = $check->fetch();
        if (!$order) { $db->rollBack(); store_fail('order_not_found', 404); }
        // Prepaid orders must be confirmed by their gateway before they leave the
        // warehouse. COD is intentionally allowed while pending: collection is
        // part of delivery, not a prerequisite for dispatch.
        if (in_array($status, ['shipped', 'delivered'], true)
            && $order['payment_method'] !== 'cod'
            && $order['payment_status'] !== 'paid') {
            $db->rollBack();
            store_fail('payment_required_before_dispatch', 409);
        }
        // CANCELLING IS FOR AN ORDER THAT IS STILL HERE AND STILL UNPAID. A
        // delivered or shipped order is with the customer: a do-not-ship is a
        // lie, and the sweeper would put back a garment that is not on the
        // shelf. A paid order is money the shop holds: cancelling it would keep
        // its garment claimed for ever, because the sweeper never releases a
        // paid order. Both are refused, before anything is written. The returns
        // flow (returns.php) is where those are settled by a person.
        if ($status === 'cancelled' && $order['fulfilment_status'] !== 'cancelled') {
            if (in_array($order['fulfilment_status'], ['shipped', 'delivered'], true)) {
                $db->rollBack();
                store_fail('order_already_shipped', 409);
            }
            if ($order['payment_status'] === 'paid') {
                $db->rollBack();
                store_fail('order_paid', 409);
            }
        }
        // A cash order past its hold cannot be put back as UNFULFILLED: the
        // sweeper would cancel it again within fifteen minutes, and the owner
        // would see CANCEL, REINSTATE, CANCEL go out. Put back as packed (or
        // anything else), the sweeper never touches it, so that is allowed.
        if ($status === 'unfulfilled' && $order['fulfilment_status'] === 'cancelled'
            && $codHours > 0 && $order['payment_method'] === 'cod'
            && $order['payment_status'] === 'pending' && (int)$order['cod_hold_expired'] === 1) {
            $db->rollBack();
            store_fail('cod_hold_expired', 409);
        }
        $wasCancelled = $order['fulfilment_status'] === 'cancelled';
        // An order LEAVING 'cancelled' takes back what cancelling gave: its
        // garments are claimed again and its discount uses too
        // (store_order_reinstate), or the move is refused with the checkout's
        // own token. Without this, a re-marked order shipped from a shelf it
        // no longer held, and the warehouse that had been told "do not ship"
        // was never told otherwise.
        if ($wasCancelled && $status !== 'cancelled') {
            $refused = store_order_reinstate($db, $orderId);
            if ($refused !== null) {
                $db->rollBack();
                store_fail($refused[0], $refused[1]);
            }
        }
        $db->prepare('update orders set fulfilment_status = ?,
                        fulfilled_at = case when ? = \'delivered\' and fulfilled_at is null then now() else fulfilled_at end
                      where id = ?')
           ->execute([$status, $status, $orderId]);
        if ($order['fulfilment_status'] !== $status) store_tracking_event($db, $orderId, $status);
        // An order cancelled by hand gets the same "do not ship" as one the
        // sweeper cancels. Its picking list may already be with the warehouse
        // (a cash order's said COLLECT CASH), and the cancellation is only
        // real there if the warehouse hears it. Queued only on the change, so
        // re-saving a cancelled order does not mail it again.
        if ($status === 'cancelled' && !$wasCancelled) store_fulfilment_cancelled($db, $orderId);
        // Tell the customer it is on its way. Only on 'shipped': 'packed' is an
        // internal state that means nothing to a shopper, and 'delivered' arrives
        // after they are holding the bag. The unique index makes this safe to call
        // again when an order is re-marked, which the admin screen allows.
        if ($status === 'shipped') store_queue_whatsapp($db, $orderId, 'shipped');
        // And ask what they thought, once it is actually in their hands. 'delivered'
        // is the only honest moment for this: a review invitation that arrives
        // while the order is still with the courier is asking someone to rate a
        // parcel they have not opened. The unique index on (order_id, kind) makes
        // re-marking an order safe — the admin screen allows it, and it must not
        // send a second invitation.
        if ($status === 'delivered') store_queue_whatsapp($db, $orderId, 'review');
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    store_out(['ok' => true]);
}

// Settle (or un-settle) a cash order. The one narrow path that may touch
// payment_status, same as admin_set_cod_paid: card payments are confirmed by
// the bank's callback, never by a person with an admin session.
if ($r === 'cod_paid' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    $paid = (bool)($b['paid'] ?? true);
    $db->beginTransaction();
    try {
        $q = $db->prepare('select payment_method, payment_status, fulfilment_status from orders where id = ? for update');
        $q->execute([$id]);
        $o = $q->fetch();
        if (!$o) { $db->rollBack(); store_fail('order_not_found'); }
        if ($o['payment_method'] !== 'cod') { $db->rollBack(); store_fail('not_a_cash_order'); }
        // A CANCELLED order cannot be settled. Cancelling put its garments back
        // on the shelf and told the warehouse "do not ship"; marking the cash
        // paid would count a unit that is no longer held, and the books would
        // say the shop was paid for an order it has given up. The owner puts
        // the order back first (cancelled -> any other status reinstates its
        // stock), then settles it. 409, not 400: the request is right, the
        // order's state is not.
        if ($paid && $o['fulfilment_status'] === 'cancelled') {
            $db->rollBack();
            store_fail('order_cancelled', 409);
        }
        if (($paid && $o['payment_status'] !== 'pending')
            || (!$paid && $o['payment_status'] !== 'paid')) {
            $db->rollBack();
            store_fail($paid ? 'order_not_pending' : 'order_not_paid');
        }
        $db->prepare('update orders set payment_status = ?, paid_at = ? where id = ?')
           ->execute([$paid ? 'paid' : 'pending', $paid ? date('Y-m-d H:i:s') : null, $id]);
        // Cash collected is a settled outcome: the warehouse follow-up fires
        // exactly as it does when the bank confirms a card — except that an
        // order already shipped or delivered gets no "ship it" (COD-04). The
        // paid MARK is kept in every case: the money was collected.
        if ($paid) store_payment_settled($db, $id, 'paid', (string)$o['fulfilment_status']);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        store_fail('failed', 500);
    }
    $q2 = $db->prepare('select id, track_id, payment_status, paid_at from orders where id = ?');
    $q2->execute([$id]);
    store_out($q2->fetch());
}

// A card payment the bank took but the callback never reported.
//
// This is the one real gap the KNET flow leaves, and it is not hypothetical:
// KPG hands the result back through the CUSTOMER's browser, so a shopper who
// pays and then closes the tab, loses signal in a lift, or is bounced by a
// flaky redirect leaves the money captured at the bank and the order sitting
// at 'pending' — or at 'review', where callback.php parks anything it could
// not verify. Until now the admin had a warning telling them to check the KNET
// portal and NO control that could act on what they found there; cod_paid
// refuses cards by design, because an admin session must not be able to
// declare a card paid on a hunch.
//
// So: settling a card requires the bank's own payment id, typed in. That is
// the forcing function — you cannot fill it in without having opened the KNET
// portal and found the transaction. It is stored, and the status is recorded
// as MANUAL_BANK_CONFIRMED so a manual settlement can never be mistaken for
// the bank's own callback when the books are read later.
if ($r === 'card_settled' && $method === 'POST') {
    $b = store_body();
    $id  = (int)($b['order_id'] ?? 0);
    $ref = trim((string)($b['bank_reference'] ?? ''));
    // Long enough that it cannot be a shrug. KNET payment ids are numeric and
    // ~12 digits; this stays permissive about format because acquirers differ,
    // but not about the field being filled in.
    if (strlen($ref) < 6 || strlen($ref) > 60) store_fail('bank_reference_required');

    $db->beginTransaction();
    try {
        $q = $db->prepare('select payment_method, payment_status, fulfilment_status from orders where id = ? for update');
        $q->execute([$id]);
        $o = $q->fetch();
        if (!$o || $o['payment_method'] === 'cod' || $o['payment_status'] === 'paid') {
            $db->rollBack();
            if (!$o) store_fail('order_not_found');
            if ($o['payment_method'] === 'cod') store_fail('not_a_card_order');
            store_fail('order_already_paid');
        }
        // A CANCELLED card order cannot be settled by hand, for the reason
        // cod_paid gives: cancelling put its garment back on the shelf, and a
        // paid mark would sell a garment the shop no longer holds. The bank's
        // money is not lost — the order stays pending and the owner puts it back
        // (which claims the stock again, or refuses with out_of_stock), then
        // settles it. 409, the request is right and the order's state is not.
        if ($o['fulfilment_status'] === 'cancelled') {
            $db->rollBack();
            store_fail('order_cancelled', 409);
        }
        $db->prepare(
            "update orders set payment_status = 'paid', paid_at = ?,
                    cbk_status = 'MANUAL_BANK_CONFIRMED',
                    cbk_paymentid = ?, cbk_message = ?
              where id = ? and payment_status <> 'paid'"
        )->execute([
            date('Y-m-d H:i:s'),
            $ref,
            'settled in admin by ' . (string)($_SESSION['admin_email'] ?? '?'),
            $id,
        ]);
        // Same rule as cod_paid: no "ship it" for an order already out of the
        // shop or cancelled. The bank's money is still recorded above.
        store_payment_settled($db, $id, 'paid', (string)$o['fulfilment_status']);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        store_fail('failed', 500);
    }
    $q2 = $db->prepare('select id, track_id, payment_status, paid_at, cbk_status, cbk_paymentid from orders where id = ?');
    $q2->execute([$id]);
    store_out($q2->fetch());
}

// ---------------------------------------------------------------- products
// The product editor. `sync` pushes the whole shipped catalogue; this is the
// single-row companion — add a piece, change a price, take one off sale.
if ($r === 'products_all') {
    store_out($db->query(
        'select id, slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                image, images, active
           from products order by id desc'
    )->fetchAll());
}

// Lossless product-photo upload. The browser sends the original bytes as a
// data URL and this route writes those bytes unchanged: no canvas, resize or
// quality setting touches them. SVG is deliberately excluded because an SVG
// served from our own origin can contain active content.
if ($r === 'product_image_upload' && $method === 'POST') {
    $b = store_body();
    $data = (string)($b['data'] ?? '');
    $name = (string)($b['name'] ?? 'product-image');
    if (strlen($data) > 14 * 1024 * 1024) store_fail('image_too_large', 413);
    if (!preg_match('#^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$#', $data, $m)) {
        store_fail('image_bad_format');
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false || $bytes === '' || strlen($bytes) > 10 * 1024 * 1024) {
        store_fail('image_too_large', 413);
    }
    $info = @getimagesizefromstring($bytes);
    $mime = is_array($info) ? (string)($info['mime'] ?? '') : '';
    $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][$mime] ?? null;
    if ($ext === null || $mime !== $m[1]) store_fail('image_not_an_image');

    $stem = strtolower(pathinfo($name, PATHINFO_FILENAME));
    $stem = trim((string)preg_replace('/[^a-z0-9]+/', '-', $stem), '-');
    if ($stem === '') $stem = 'product-image';
    $stem = substr($stem, 0, 60);
    $relativeDir = '/images/products';
    $targetDir = dirname(__DIR__) . $relativeDir;
    if (!is_dir($targetDir) && !@mkdir($targetDir, 0755, true) && !is_dir($targetDir)) {
        store_fail('image_storage_unavailable', 500);
    }
    // Even though the MIME signature and fixed extension already exclude PHP,
    // make this directory non-executable at Apache too. A future upload change
    // must not accidentally turn product media into application code.
    $guard = "Options -Indexes\n<FilesMatch \"\\.(php|phtml|phar|cgi|pl|py|sh)$\">\n  Require all denied\n</FilesMatch>\n";
    if (!is_file($targetDir . '/.htaccess')) @file_put_contents($targetDir . '/.htaccess', $guard, LOCK_EX);
    $file = $stem . '-' . bin2hex(random_bytes(5)) . '.' . $ext;
    $target = $targetDir . '/' . $file;
    if (@file_put_contents($target, $bytes, LOCK_EX) !== strlen($bytes)) {
        @unlink($target);
        store_fail('image_write_failed', 500);
    }
    @chmod($target, 0644);
    store_out([
        'path' => $relativeDir . '/' . $file,
        'width' => (int)$info[0],
        'height' => (int)$info[1],
        'bytes' => strlen($bytes),
        'mime' => $mime,
    ]);
}

if ($r === 'product_save' && $method === 'POST') {
    $b = store_body();
    $rawId = $b['id'] ?? 0;
    if (!is_int($rawId) && !(is_string($rawId) && preg_match('/^[0-9]{1,10}$/D', $rawId))) {
        store_fail('invalid_product_id');
    }
    $id = (int)$rawId;
    if ($id < 0 || $id > 4294967295) store_fail('invalid_product_id');
    $slug = store_slug(store_input_string($b['slug'] ?? null, 'slug', 160));
    if ($slug === '' || strlen($slug) > 80) store_fail('invalid_slug');
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 160);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 160);
    // THE PRICE IS MONEY. Same three-decimal discipline the order path uses:
    // KWD has exactly three, and a price that arrives as 10.5 must be stored
    // as 10.500 or the fils quietly disappear.
    $price = store_product_money($b['price'] ?? null, 'price');
    $active = array_key_exists('active', $b) ? $b['active'] : true;
    if (!is_bool($active) && $active !== 0 && $active !== 1) store_fail('invalid_active');
    $active = (int)(bool)$active;

    // The sale price. Optional, and only meaningful BELOW the list price — a
    // "sale" above it would quietly overcharge, which is the kind of mistake
    // nobody reports because the customer just leaves. Refused here rather
    // than ignored at read time, so the admin says so instead of saving
    // something that does nothing.
    $salePrice = $b['sale_price'] ?? null;
    if ($salePrice === '' || $salePrice === null) {
        $salePrice = null;
        $saleFrom = $saleTo = null;
    } else {
        $salePrice = store_product_money($salePrice, 'sale_price');
        if ($salePrice >= (float)$price)  store_fail('sale_not_lower');
        $saleFrom = store_datetime($b['sale_starts_at'] ?? null);
        $saleTo   = store_datetime($b['sale_ends_at'] ?? null);
        if ($saleFrom !== null && $saleTo !== null && $saleFrom > $saleTo) store_fail('sale_dates_backwards');
    }
    $featured = array_key_exists('featured', $b) ? $b['featured'] : false;
    if (!is_bool($featured) && $featured !== 0 && $featured !== 1) store_fail('invalid_featured');
    $featured = (int)(bool)$featured;
    $rawFeaturedSort = $b['featured_sort'] ?? 0;
    if (!is_int($rawFeaturedSort)
        && !(is_string($rawFeaturedSort) && preg_match('/^[0-9]{1,6}$/D', $rawFeaturedSort))) {
        store_fail('invalid_featured_sort');
    }
    $featuredSort = (int)$rawFeaturedSort;
    if ($featuredSort > 100000) store_fail('invalid_featured_sort');

    // WHICH BRAND MADE IT. Checked against the brands table rather than stored
    // as typed: a slug with a typo would silently show no brand on the product
    // page, and "the logo did not appear" is a much harder thing to diagnose
    // than a save that refused. Empty clears it, which is how a product goes
    // back to having no brand.
    // EXTRA PHOTOGRAPHS, as a comma-separated list of same-origin paths.
    // store_internal_href is the same gate the hero buttons pass: a leading //
    // is a HOSTNAME, not a path, so an off-site URL cannot be spelled here.
    // Blank entries are dropped rather than becoming empty <img> tags.
    $extraImages = null;
    $rawImages = trim((string)($b['images'] ?? ''));
    if ($rawImages !== '') {
        $clean = [];
        foreach (explode(',', $rawImages) as $one) {
            $one = trim($one);
            if ($one === '') continue;
            $clean[] = store_internal_href($one);
        }
        $extraImages = $clean ? implode(',', $clean) : null;
    }

    $mainImage = trim((string)($b['image'] ?? ''));
    $mainImage = $mainImage === '' ? null : store_internal_href($mainImage);

    $brandSlug = trim((string)($b['brand_slug'] ?? ''));
    if ($brandSlug === '') {
        $brandSlug = null;
    } else {
        $q = $db->prepare('select 1 from brands where slug = ?');
        $q->execute([$brandSlug]);
        if (!$q->fetchColumn()) store_fail('unknown_brand');
    }

    try {
        if ($id > 0) {
            $db->prepare(
                'update products set slug = ?, name_en = ?, name_ar = ?, desc_en = ?, desc_ar = ?,
                        price = ?, sale_price = ?, sale_starts_at = ?, sale_ends_at = ?,
                        featured = ?, featured_sort = ?, category = ?, brand_slug = ?, image = ?, images = ?, active = ?
                  where id = ?'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        $mainImage, $extraImages, $active, $id]);
        } else {
            $db->prepare(
                'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                        sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                        image, images, active)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        $mainImage, $extraImages, $active]);
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('slug_taken');
        throw $e;
    }
    $q = $db->prepare('select id, slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug, image,
                images, active from products where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Take a product off sale. NOT a delete: order_items point at products by id,
// and a shop that deletes a sold product loses the line on every invoice that
// ever contained it. `active = 0` hides it from the storefront and keeps the
// history intact — the same reasoning as brands.
if ($r === 'product_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $db->prepare('update products set active = ? where id = ?')
       ->execute([empty($b['active']) ? 0 : 1, $id]);
    $q = $db->prepare('select id, slug, active from products where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('product_not_found');
    store_out($row);
}

// ------------------------------------------------------------------ brands
// The admin sees EVERY brand, disabled ones included — a switch you cannot
// see is a switch you cannot turn back on.
//
// Each row also says how many products carry it: `products` counts every one
// (shown or hidden — the number brand_delete's 409 brand_in_use is about) and
// `products_active` only the listed ones (the number a shopper will find at
// /shop?brand=<slug>, which is the same figure the public ?r=brands sends).
// Without them a brand with nothing behind it looks exactly like one with
// forty products, and the home strip was sending shoppers to six empty pages.
// One grouped pass over products, LEFT-joined so an unused brand reads 0.
if ($r === 'brands') {
    $rows = $db->query(
        'select b.id, b.slug, b.name_en, b.name_ar, b.logo, b.active, b.sort,
                coalesce(c.n, 0) as products, coalesce(c.n_active, 0) as products_active
           from brands b
           left join (select brand_slug, count(*) as n,
                             sum(case when active = 1 then 1 else 0 end) as n_active
                        from products
                       where brand_slug is not null
                       group by brand_slug) c on c.brand_slug = b.slug
          order by b.sort, b.name_en'
    )->fetchAll();
    // sum() comes back as a DECIMAL, i.e. a string through PDO; the admin
    // compares these to 0, and "0" is truthy in JavaScript.
    foreach ($rows as &$row) {
        $row['products'] = (int)$row['products'];
        $row['products_active'] = (int)$row['products_active'];
    }
    unset($row);
    store_out($rows);
}

// Every product, as the brand screen needs it to tag them: who makes it, and
// enough to recognise it by (names, category, shown or hidden). Not
// products_all — that carries both descriptions, every image path and the sale
// fields for all 46 rows, none of which a "which brand is this?" list uses —
// and not products_state, which has no names. No prices and no costs: this
// screen has no business with either.
if ($r === 'brand_products') {
    $rows = $db->query(
        'select slug, name_en, name_ar, brand_slug, active, category
           from products order by name_en, slug'
    )->fetchAll();
    foreach ($rows as &$row) $row['active'] = (int)$row['active'];
    unset($row);
    store_out($rows);
}

// Tag many products with one brand at once — or untag them (brand_slug null).
//
// This exists because the only other way is the product editor, one product
// at a time: the live catalogue had ONE of 46 products tagged, so every brand
// but one led to an empty shop page, and fixing that meant 45 trips through a
// form that also re-saves the price, the sale and the photos of each product.
// This route touches the brand column and nothing else.
//
// Body: {brand_slug: "<slug>" | null, products: ["<product slug>", …]}
//   - brand_slug must name a row in brands, shown or hidden (tagging ahead of
//     switching a brand on is a reasonable order of work) → else unknown_brand.
//     null clears. "" clears too, the same as product_save, because "" is what
//     a "No brand" option in a <select> sends. Whitespace only ("   ") is
//     NOT a clear: it names no brand → unknown_brand. The key itself must be
//     present: a client that forgot it must not untag 200 products by accident.
//   - products: a JSON array of 1–200 strings → else bad_request. Unknown
//     slugs are SKIPPED and counted, not refused: the list is typically built
//     from a screen that can be a few minutes stale, and one product deleted
//     meanwhile should not throw away the other 30 ticks.
//     "Unknown" is decided by the database's own comparison (the column's
//     collation), so a known product in another case is not counted skipped.
// Reply: {updated: <rows whose brand actually changed>, skipped: <unknown>}.
// `updated` is MySQL's affected-rows, so re-tagging a product with the brand
// it already has counts 0 — the honest number for "what did this change".
//
// Logged to admin_activity_log by the shutdown hook above ($activityActions).
if ($r === 'brand_assign' && $method === 'POST') {
    // 200 slugs of at most 80 characters is ~17 kB of JSON; 64 KiB is room
    // for that and nothing like the 16 MiB default meant for photo uploads.
    $b = store_body(64 * 1024);

    if (!array_key_exists('brand_slug', $b)) store_fail('bad_request');
    $want = $b['brand_slug'];
    if ($want !== null && !is_string($want)) store_fail('bad_request');
    $brandSlug = null;
    // Only null and exactly "" clear. "   " is not a "No brand" option, it is
    // a padded field, and it must not untag 200 products: it names no brand.
    if ($want !== null && $want !== '') {
        if (trim($want) === '') store_fail('unknown_brand');
        $q = $db->prepare('select slug from brands where slug = ?');
        $q->execute([trim($want)]);
        $found = $q->fetchColumn();
        if ($found === false) store_fail('unknown_brand');
        // The brand's own spelling, not the request's: the column is compared
        // case-insensitively, and the stored tag should match the brand row.
        $brandSlug = (string)$found;
        // brands.slug is varchar(80) but products.brand_slug is varchar(64).
        // A longer slug cannot be stored on a product at all (strict mode
        // refuses it, a lax server would truncate it into a tag that matches
        // no brand), so say so rather than 500.
        if (strlen($brandSlug) > 64) store_fail('brand_slug_too_long');
    }

    $list = $b['products'] ?? null;
    if (!is_array($list) || !array_is_list($list) || count($list) < 1 || count($list) > 200) {
        store_fail('bad_request');
    }
    foreach ($list as $s) {
        if (!is_string($s)) store_fail('bad_request');
    }
    // Exact duplicates would otherwise be counted twice.
    $slugs = array_values(array_unique($list));

    // Which product each requested slug names, as the DATABASE compares them.
    // products.slug is utf8mb4_unicode_ci: case, accents and trailing spaces
    // do not count, so "VANQUISH-TANK-NAVY" and "vanquish-tank-navy " both
    // name vanquish-tank-navy and the UPDATE below tags it. Comparing in PHP
    // would call them unknown and report them as skipped. One statement, one
    // unique-index lookup per slug: a row per request, the stored slug or NULL.
    $q = $db->prepare(implode(' union all ',
        array_fill(0, count($slugs), 'select (select slug from products where slug = ? limit 1) as m')));
    $q->execute($slugs);
    $matched = $q->fetchAll(PDO::FETCH_COLUMN);
    $known = array_values(array_unique(array_filter($matched, fn($m) => $m !== null)));
    $skipped = count(array_filter($matched, fn($m) => $m === null));

    $updated = 0;
    if ($known) {
        // ONE statement, every value bound: the slugs are the stored ones just
        // read back, so the update cannot reach a row the select did not see.
        $marks = implode(',', array_fill(0, count($known), '?'));
        $u = $db->prepare("update products set brand_slug = ? where slug in ($marks)");
        $u->execute(array_merge([$brandSlug], $known));
        $updated = $u->rowCount();
    }
    store_out(['updated' => $updated, 'skipped' => $skipped]);
}

// Create or rename a brand. One route for both: the admin screen has one form
// and the difference is whether an id came with it.
if ($r === 'brand_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 80);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 80);
    $slug = store_slug((string)($b['slug'] ?? '')) ?: store_slug($nameEn);
    if ($slug === '') store_fail('invalid_slug');
    $sort = (int)($b['sort'] ?? 0);
    // Absent means "leave the logo alone"; empty string means "remove it".
    $hasLogo = array_key_exists('logo', $b);
    $logo = $hasLogo ? store_data_image($b['logo']) : null;

    try {
        if ($id > 0) {
            $sql = 'update brands set slug = ?, name_en = ?, name_ar = ?, sort = ?'
                 . ($hasLogo ? ', logo = ?' : '') . ' where id = ?';
            $args = $hasLogo ? [$slug, $nameEn, $nameAr, $sort, $logo, $id]
                             : [$slug, $nameEn, $nameAr, $sort, $id];
            $db->prepare($sql)->execute($args);
        } else {
            $db->prepare('insert into brands (slug, name_en, name_ar, logo, sort) values (?, ?, ?, ?, ?)')
               ->execute([$slug, $nameEn, $nameAr, $logo, $sort]);
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        // The slug is unique, and two brands with one slug is a storefront
        // filter that shows the wrong things — name the clash, do not 500.
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('slug_taken');
        throw $e;
    }
    $q = $db->prepare('select id, slug, name_en, name_ar, logo, active, sort from brands where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Remove a brand for good. This used to not exist: "a brand with orders behind
// it is history". The rule is kept, narrowed to what can actually be checked:
// a brand that any product still points at (shown or hidden) is refused with
// 409 brand_in_use, because deleting it would leave those products with a brand
// that no longer exists and a storefront filter that shows nothing. Orders keep
// their own copy of the item name, so an unused brand has nothing behind it.
// Hiding stays the reversible answer for a brand that is in use.
if ($r === 'brand_delete' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $q = $db->prepare('select id, slug from brands where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('brand_not_found', 404);
    try {
        $n = $db->prepare('select count(*) from products where brand_slug = ?');
        $n->execute([$row['slug']]);
        $inUse = (int)$n->fetchColumn();
    } catch (Throwable $e) {
        $inUse = 0;   // products.brand_slug not installed: nothing can point at it
    }
    if ($inUse > 0) store_fail('brand_in_use', 409);
    $db->prepare('delete from brands where id = ?')->execute([$id]);
    store_out(['id' => $id, 'deleted' => true]);
}

// Show it, or stop showing it: the reversible alternative to brand_delete, and
// the only option for a brand that products still use.
if ($r === 'brand_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $on = !empty($b['active']);
    $db->prepare('update brands set active = ? where id = ?')->execute([$on ? 1 : 0, $id]);
    $q = $db->prepare('select id, slug, active from brands where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('brand_not_found');
    store_out($row);
}

if ($r === 'customer' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    if ($id < 1) store_fail('invalid_order');
    // Column allowlist — an admin edits the delivery details, not the money.
    // Apply the same bounds as checkout. The database columns are the final
    // safety net, but relying on truncation there can silently turn an address
    // into a different address.
    $limits = [
        'customer_name'        => [2, 80],
        'customer_area'        => [2, 60],
        'customer_block'       => [1, 12],
        'customer_street'      => [1, 40],
        'customer_building'    => [1, 24],
        'customer_floor'       => [1, 16],
        'customer_flat'        => [1, 16],
        'customer_note'        => [1, 280],
    ];
    $allowed = array_merge(array_keys($limits), ['customer_phone', 'customer_governorate']);
    $sets = []; $args = [];
    foreach (($b['fields'] ?? []) as $k => $v) {
        if (!in_array($k, $allowed, true)) continue;
        $value = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$v) ?? '');
        if ($k === 'customer_phone' && $value !== '') {
            $value = store_phone($value);
            if ($value === null) store_fail('invalid_phone');
        } elseif ($k === 'customer_governorate' && $value !== '') {
            if (!in_array($value, STORE_GOVERNORATES, true)) store_fail('invalid_governorate');
        } elseif (isset($limits[$k]) && $value !== '') {
            [$min, $max] = $limits[$k];
            $length = mb_strlen($value);
            if ($length < $min) store_fail('invalid_' . substr($k, 9));
            if ($length > $max) store_fail('too_long_' . substr($k, 9));
        }
        $sets[] = "`$k` = ?";
        $args[] = $value === '' ? null : $value;
    }
    if (!$sets) store_fail('nothing_to_update');
    $args[] = $id;
    $q = $db->prepare('update orders set ' . implode(', ', $sets) . ' where id = ?');
    $q->execute($args);
    if ($q->rowCount() === 0) {
        $exists = $db->prepare('select 1 from orders where id = ?');
        $exists->execute([$id]);
        if (!$exists->fetchColumn()) store_fail('order_not_found', 404);
    }
    store_out(['ok' => true]);
}

// ----------------------------------------------------------------- catalogue
if ($r === 'products_state') {
    store_out($db->query('select slug, price, active from products')->fetchAll());
}

if ($r === 'sync' && $method === 'POST') {
    // Upsert on slug, exactly like syncCatalog expects. The rows come
    // from the shipped catalogue via the admin UI; prices here are what
    // checkout charges, which is the entire reason this screen exists.
    $rows = store_body()['rows'] ?? [];
    if (!is_array($rows) || !$rows) store_fail('empty');
    $up = $db->prepare(
        'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, category, image, active)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on duplicate key update name_en = values(name_en), name_ar = values(name_ar),
           desc_en = values(desc_en), desc_ar = values(desc_ar), price = values(price),
           category = values(category), active = values(active)'
    );
    $n = 0;
    $db->beginTransaction();
    try {
        foreach ($rows as $p) {
            if (!is_array($p) || empty($p['slug'])) continue;
            $up->execute([
                (string)$p['slug'], (string)($p['name_en'] ?? ''), (string)($p['name_ar'] ?? ''),
                $p['desc_en'] ?? null, $p['desc_ar'] ?? null,
                number_format((float)($p['price'] ?? 0), 3, '.', ''),
                $p['category'] ?? null, $p['image'] ?? null,
                !empty($p['active']) ? 1 : 0,
            ]);
            $n++;
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    store_out(['count' => $n]);
}

// -------------------------------------------------------------------- stock
if ($r === 'variants') {
    if ($method !== 'GET') store_fail('method_not_allowed', 405);
    // The dashboard needs operational totals, not the old static shipment file.
    // A line is sold only when its order still owns the claimed stock and is
    // either paid or an active COD order. Failed/released payment holds are not
    // sales. Receipt/return/damage totals come from the immutable movement log.
    // cost_aed remains temporarily for older dashboard bundles; new code uses
    // unit_cost_kwd and never needs to know the supplier's source currency.
    $rows = $db->query(
        "select v.sku, v.slug, p.name_en, p.name_ar, p.category, p.price,
                v.size, v.stock, v.cost_aed, v.unit_cost_kwd,
                v.low_stock_threshold, v.inventory_version,
                coalesce(s.sold_qty, 0) as sold_qty,
                coalesce(m.received_qty, 0) as received_qty,
                coalesce(m.returned_qty, 0) as returned_qty,
                coalesce(m.damaged_qty, 0) as damaged_qty
           from product_variants v
           left join products p on p.slug = v.slug
           left join (
                select oi.product_id, oi.size, sum(oi.qty) as sold_qty
                  from order_items oi
                  join orders o on o.id = oi.order_id
                 where o.stock_claimed = 1 and o.stock_released = 0
                   and (o.payment_status = 'paid'
                        or (o.payment_method = 'cod'
                            and o.payment_status in ('pending', 'review')
                            and o.fulfilment_status <> 'cancelled'))
                 group by oi.product_id, oi.size
           ) s on s.product_id = p.id and s.size = v.size
           left join (
                select sku,
                       sum(case when type = 'receive' and delta > 0 then delta else 0 end) as received_qty,
                       sum(case when type = 'return' and delta > 0 then delta else 0 end) as returned_qty,
                       sum(case when type = 'damage' and delta < 0 then -delta else 0 end) as damaged_qty
                  from inventory_movements
                 group by sku
           ) m on m.sku = v.sku
          order by v.slug, v.size"
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['stock'] = (int)$row['stock'];
        $row['price'] = $row['price'] === null ? null : (float)$row['price'];
        $row['cost_aed'] = $row['cost_aed'] === null ? null : (float)$row['cost_aed'];
        $row['unit_cost_kwd'] = $row['unit_cost_kwd'] === null ? null : (float)$row['unit_cost_kwd'];
        $row['low_stock_threshold'] = (int)$row['low_stock_threshold'];
        $row['inventory_version'] = (int)$row['inventory_version'];
        $row['sold_qty'] = (int)$row['sold_qty'];
        $row['received_qty'] = (int)$row['received_qty'];
        $row['returned_qty'] = (int)$row['returned_qty'];
        $row['damaged_qty'] = (int)$row['damaged_qty'];
    }
    unset($row);
    store_out($rows);
}

// Shared inventory validation. The database remains the concurrency boundary;
// these checks make malformed requests fail before acquiring a row lock.
$inventorySku = static function (mixed $value): string {
    if (!is_string($value)) store_fail('invalid_sku');
    $sku = trim($value);
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/D', $sku)) store_fail('invalid_sku');
    return $sku;
};
$inventoryInteger = static function (mixed $value, string $field, int $min, int $max): int {
    if (!is_int($value)
        && !(is_string($value) && preg_match('/^(?:0|[1-9][0-9]{0,18})$/D', $value))) {
        store_fail('invalid_' . $field);
    }
    $n = (int)$value;
    if ($n < $min || $n > $max || (is_string($value) && (string)$n !== $value)) {
        store_fail($field === 'stock' || $field === 'target_stock'
            ? 'stock_out_of_range' : 'invalid_' . $field);
    }
    return $n;
};
$inventoryCost = static function (mixed $value): string {
    if (!is_int($value) && !is_float($value) && !is_string($value)) store_fail('invalid_unit_cost_kwd');
    $raw = (string)$value;
    if (!preg_match('/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/D', $raw)) {
        store_fail('invalid_unit_cost_kwd');
    }
    return number_format((float)$raw, 3, '.', '');
};
$inventoryVersion = static function (mixed $value) use ($inventoryInteger): int {
    return $inventoryInteger($value, 'expected_version', 0, PHP_INT_MAX - 1);
};
$inventoryWriteBody = static function (): array {
    if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        store_fail('bad_request', 403);
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) store_fail('request_too_large', 413);
    return store_body(8192);
};
$inventoryVariantShape = static function (array $row): array {
    return [
        'sku' => (string)$row['sku'],
        'slug' => (string)$row['slug'],
        'size' => (string)$row['size'],
        'stock' => (int)$row['stock'],
        'unit_cost_kwd' => $row['unit_cost_kwd'] === null ? null : (float)$row['unit_cost_kwd'],
        'low_stock_threshold' => (int)$row['low_stock_threshold'],
        'inventory_version' => (int)$row['inventory_version'],
    ];
};
$inventoryMovementShape = static function (array $row): array {
    return [
        'id' => (int)$row['id'],
        'sku' => (string)$row['sku'],
        'type' => (string)$row['type'],
        'before_stock' => (int)$row['before_stock'],
        'after_stock' => (int)$row['after_stock'],
        'delta' => (int)$row['delta'],
        'before_unit_cost_kwd' => $row['before_unit_cost_kwd'] === null ? null : (float)$row['before_unit_cost_kwd'],
        'after_unit_cost_kwd' => $row['after_unit_cost_kwd'] === null ? null : (float)$row['after_unit_cost_kwd'],
        'before_low_stock_threshold' => (int)$row['before_low_stock_threshold'],
        'after_low_stock_threshold' => (int)$row['after_low_stock_threshold'],
        'inventory_version' => (int)$row['inventory_version'],
        'note' => (string)$row['note'],
        'actor_admin_id' => $row['actor_admin_id'] === null ? null : (int)$row['actor_admin_id'],
        'actor_email' => (string)$row['actor_email'],
        'created_at' => (string)$row['created_at'],
    ];
};
$inventoryConflict = static function (PDO $db, array $row): never {
    if ($db->inTransaction()) $db->rollBack();
    store_out([
        'error' => 'stock_changed',
        'stock' => (int)$row['stock'],
        'unit_cost_kwd' => $row['unit_cost_kwd'] === null ? null : (float)$row['unit_cost_kwd'],
        'low_stock_threshold' => (int)$row['low_stock_threshold'],
        'inventory_version' => (int)$row['inventory_version'],
    ], 409);
};
$inventoryInsertMovement = static function (
    PDO $db,
    string $sku,
    string $type,
    int $beforeStock,
    int $afterStock,
    ?string $beforeCost,
    ?string $afterCost,
    int $beforeThreshold,
    int $afterThreshold,
    int $version,
    string $note,
    array $admin
): array {
    $q = $db->prepare(
        'insert into inventory_movements
            (sku, type, before_stock, after_stock, delta,
             before_unit_cost_kwd, after_unit_cost_kwd,
             before_low_stock_threshold, after_low_stock_threshold,
             inventory_version, note, actor_admin_id, actor_email)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $q->execute([
        $sku, $type, $beforeStock, $afterStock, $afterStock - $beforeStock,
        $beforeCost, $afterCost, $beforeThreshold, $afterThreshold,
        $version, $note, (int)$admin['id'], (string)$admin['email'],
    ]);
    $id = (int)$db->lastInsertId();
    $read = $db->prepare('select * from inventory_movements where id = ?');
    $read->execute([$id]);
    return $read->fetch();
};

if ($r === 'inventory_movements') {
    if ($method !== 'GET') store_fail('method_not_allowed', 405);
    $rawLimit = $_GET['limit'] ?? '50';
    $limit = $inventoryInteger($rawLimit, 'limit', 1, 200);
    $params = [];
    $where = '';
    if (array_key_exists('sku', $_GET) && $_GET['sku'] !== '') {
        $where = ' where sku = ?';
        $params[] = $inventorySku($_GET['sku']);
    }
    // $limit is validated above and is safe to place in the SQL literal. Native
    // PDO prepares do not portably accept a bound LIMIT value on every host.
    $q = $db->prepare('select * from inventory_movements' . $where . ' order by id desc limit ' . $limit);
    $q->execute($params);
    $rows = [];
    foreach ($q->fetchAll() as $row) $rows[] = $inventoryMovementShape($row);
    store_out($rows);
}

if ($r === 'inventory_adjust') {
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    $b = $inventoryWriteBody();
    $sku = $inventorySku($b['sku'] ?? null);
    $type = is_string($b['type'] ?? null) ? trim($b['type']) : '';
    if (!in_array($type, ['receive', 'return', 'damage', 'count'], true)) store_fail('invalid_adjustment_type');
    $expectedVersion = $inventoryVersion($b['expected_version'] ?? null);
    $note = store_text($b['note'] ?? null, 'note', 3, 500);
    $quantity = null;
    $targetStock = null;
    if ($type === 'count') {
        if (array_key_exists('quantity', $b)) store_fail('invalid_quantity');
        $targetStock = $inventoryInteger($b['target_stock'] ?? null, 'target_stock', 0, 999999);
    } else {
        if (array_key_exists('target_stock', $b)) store_fail('invalid_target_stock');
        $quantity = $inventoryInteger($b['quantity'] ?? null, 'quantity', 1, 999999);
    }
    $hasCost = array_key_exists('unit_cost_kwd', $b);
    $submittedCost = $hasCost ? $inventoryCost($b['unit_cost_kwd']) : null;

    $db->beginTransaction();
    try {
        $q = $db->prepare(
            'select sku, slug, size, stock, unit_cost_kwd, low_stock_threshold, inventory_version
               from product_variants where sku = ? for update'
        );
        $q->execute([$sku]);
        $row = $q->fetch();
        if (!$row) {
            $db->rollBack();
            store_fail('sku_not_found', 404);
        }
        if ((int)$row['inventory_version'] !== $expectedVersion) $inventoryConflict($db, $row);
        $beforeStock = (int)$row['stock'];
        $afterStock = $type === 'count' ? (int)$targetStock
            : ($type === 'damage' ? $beforeStock - (int)$quantity : $beforeStock + (int)$quantity);
        if ($afterStock < 0) {
            $db->rollBack();
            store_fail('insufficient_stock', 409);
        }
        if ($afterStock > 999999) {
            $db->rollBack();
            store_fail('stock_out_of_range');
        }
        $beforeCost = $row['unit_cost_kwd'] === null ? null
            : number_format((float)$row['unit_cost_kwd'], 3, '.', '');
        $afterCost = $hasCost ? $submittedCost : $beforeCost;
        $beforeThreshold = (int)$row['low_stock_threshold'];
        $version = (int)$row['inventory_version'] + 1;
        $u = $db->prepare(
            'update product_variants
                set stock = ?, unit_cost_kwd = ?, inventory_version = inventory_version + 1
              where sku = ? and inventory_version = ?'
        );
        $u->execute([$afterStock, $afterCost, $sku, $expectedVersion]);
        if ($u->rowCount() !== 1) $inventoryConflict($db, $row);
        $movement = $inventoryInsertMovement(
            $db, $sku, $type, $beforeStock, $afterStock, $beforeCost, $afterCost,
            $beforeThreshold, $beforeThreshold, $version, $note, $admin
        );
        $read = $db->prepare(
            'select sku, slug, size, stock, unit_cost_kwd, low_stock_threshold, inventory_version
               from product_variants where sku = ?'
        );
        $read->execute([$sku]);
        $variant = $read->fetch();
        $db->commit();
        store_out([
            'variant' => $inventoryVariantShape($variant),
            'movement' => $inventoryMovementShape($movement),
        ]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

if ($r === 'inventory_variant_save') {
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    $b = $inventoryWriteBody();
    $sku = $inventorySku($b['sku'] ?? null);
    $expectedVersion = $inventoryVersion($b['expected_version'] ?? null);
    $hasCost = array_key_exists('unit_cost_kwd', $b);
    $hasThreshold = array_key_exists('low_stock_threshold', $b);
    if (!$hasCost && !$hasThreshold) store_fail('empty_variant_update');
    $submittedCost = $hasCost ? $inventoryCost($b['unit_cost_kwd']) : null;
    $submittedThreshold = $hasThreshold
        ? $inventoryInteger($b['low_stock_threshold'], 'low_stock_threshold', 0, 999999) : null;
    $note = array_key_exists('note', $b)
        ? store_text($b['note'], 'note', 3, 500) : 'Inventory cost or threshold updated';

    $db->beginTransaction();
    try {
        $q = $db->prepare(
            'select sku, slug, size, stock, unit_cost_kwd, low_stock_threshold, inventory_version
               from product_variants where sku = ? for update'
        );
        $q->execute([$sku]);
        $row = $q->fetch();
        if (!$row) {
            $db->rollBack();
            store_fail('sku_not_found', 404);
        }
        if ((int)$row['inventory_version'] !== $expectedVersion) $inventoryConflict($db, $row);
        $beforeCost = $row['unit_cost_kwd'] === null ? null
            : number_format((float)$row['unit_cost_kwd'], 3, '.', '');
        $afterCost = $hasCost ? $submittedCost : $beforeCost;
        $beforeThreshold = (int)$row['low_stock_threshold'];
        $afterThreshold = $hasThreshold ? (int)$submittedThreshold : $beforeThreshold;
        if ($beforeCost === $afterCost && $beforeThreshold === $afterThreshold) {
            $db->commit();
            store_out(['variant' => $inventoryVariantShape($row), 'movement' => null]);
        }
        $u = $db->prepare(
            'update product_variants
                set unit_cost_kwd = ?, low_stock_threshold = ?, inventory_version = inventory_version + 1
              where sku = ? and inventory_version = ?'
        );
        $u->execute([$afterCost, $afterThreshold, $sku, $expectedVersion]);
        if ($u->rowCount() !== 1) $inventoryConflict($db, $row);
        $version = (int)$row['inventory_version'] + 1;
        $movement = $inventoryInsertMovement(
            $db, $sku, 'variant_update', (int)$row['stock'], (int)$row['stock'],
            $beforeCost, $afterCost, $beforeThreshold, $afterThreshold,
            $version, $note, $admin
        );
        $read = $db->prepare(
            'select sku, slug, size, stock, unit_cost_kwd, low_stock_threshold, inventory_version
               from product_variants where sku = ?'
        );
        $read->execute([$sku]);
        $variant = $read->fetch();
        $db->commit();
        store_out([
            'variant' => $inventoryVariantShape($variant),
            'movement' => $inventoryMovementShape($movement),
        ]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

if ($r === 'set_stock') {
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    $b = $inventoryWriteBody();
    $sku = $inventorySku($b['sku'] ?? null);
    $rawStock = $b['stock'] ?? null;
    if (!is_int($rawStock) && !(is_string($rawStock) && preg_match('/^\d{1,6}$/D', $rawStock))) {
        store_fail('stock_must_be_whole_number');
    }
    $stock = (int)$rawStock;
    if ($stock < 0 || $stock > 999999) store_fail('stock_out_of_range');
    $hasExpectedVersion = array_key_exists('expected_version', $b);
    $expectedVersion = $hasExpectedVersion ? $inventoryVersion($b['expected_version']) : null;

    // Compatibility route for the current dashboard. It now uses the same row
    // lock, version increment and audit trail as inventory_adjust. New clients
    // should send expected_version or use inventory_adjust(type=count).
    $db->beginTransaction();
    try {
        $q = $db->prepare(
            'select sku, slug, size, stock, unit_cost_kwd, low_stock_threshold, inventory_version
               from product_variants where sku = ? for update'
        );
        $q->execute([$sku]);
        $row = $q->fetch();
        if (!$row) {
            $db->rollBack();
            store_fail('sku_not_found', 404);
        }
        if ($hasExpectedVersion && (int)$row['inventory_version'] !== $expectedVersion) {
            $inventoryConflict($db, $row);
        }
        $beforeCost = $row['unit_cost_kwd'] === null ? null
            : number_format((float)$row['unit_cost_kwd'], 3, '.', '');
        $beforeVersion = (int)$row['inventory_version'];
        $u = $db->prepare(
            'update product_variants set stock = ?, inventory_version = inventory_version + 1
              where sku = ? and inventory_version = ?'
        );
        $u->execute([$stock, $sku, $beforeVersion]);
        if ($u->rowCount() !== 1) $inventoryConflict($db, $row);
        $version = $beforeVersion + 1;
        $inventoryInsertMovement(
            $db, $sku, 'legacy_set_stock', (int)$row['stock'], $stock,
            $beforeCost, $beforeCost, (int)$row['low_stock_threshold'],
            (int)$row['low_stock_threshold'], $version,
            'Legacy stock count set through the inventory dashboard', $admin
        );
        $read = $db->prepare(
            'select sku, slug, size, stock, unit_cost_kwd, low_stock_threshold, inventory_version
               from product_variants where sku = ?'
        );
        $read->execute([$sku]);
        $updated = $read->fetch();
        $db->commit();
        store_out($inventoryVariantShape($updated));
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// ------------------------------------------------------------------- slides
// The home hero. The photograph lives in the ROW, not on disk — the same rule
// the brand logos follow, and for the same reason: an endpoint that writes
// into the web root is a way in, and this server already hosted one.
//
// The admin sends the image already downscaled and re-encoded to WebP in the
// browser, so a 12-megapixel phone photo becomes ~200 kB before it is ever
// uploaded. store_data_image() is the floor under that, because a client-side
// limit is a suggestion.
if ($r === 'slides') {
    $rows = $db->query(
        'select id, sort, active, title_en, title_ar, subtitle_en, subtitle_ar,
                cta_label_en, cta_label_ar, cta_href, image_hash, image_w, image_h,
                focal_x, focal_y, updated_at
           from hero_slides order by sort, id'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['active'] = (bool)$row['active'];
        $row['sort'] = (int)$row['sort'];
        $row['focal_x'] = (int)$row['focal_x'];
        $row['focal_y'] = (int)$row['focal_y'];
        // The admin gets the same cacheable URL the storefront gets, rather
        // than a megabyte of base64 per slide in a list response.
        $row['image'] = $row['image_hash']
            ? 'api.php?r=slide_image&id=' . $row['id'] . '&v=' . substr((string)$row['image_hash'], 0, 16)
            : null;
        $row['width']  = $row['image_w'] === null ? null : (int)$row['image_w'];
        $row['height'] = $row['image_h'] === null ? null : (int)$row['image_h'];
        unset($row['image_hash'], $row['image_w'], $row['image_h']);
    }
    unset($row);
    store_out(['slides' => $rows, 'hero' => store_setting($db, 'hero')]);
}

if ($r === 'slide_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);

    // A slide with no photograph is a blank panel on the home page. The image
    // is required on CREATE; on edit, omitting it keeps the one already there
    // rather than wiping it, so changing a caption cannot lose the artwork.
    $image = null;
    if (($b['image'] ?? '') !== '') {
        $image = store_data_image((string)$b['image'], STORE_HERO_MAX);
    } elseif ($id === 0) {
        store_fail('image_required');
    }

    $focalX = max(0, min(100, (int)($b['focal_x'] ?? 50)));
    $focalY = max(0, min(100, (int)($b['focal_y'] ?? 50)));
    $fields = [
        'title_en'     => store_opt($b['title_en'] ?? null),
        'title_ar'     => store_opt($b['title_ar'] ?? null),
        'subtitle_en'  => store_opt($b['subtitle_en'] ?? null),
        'subtitle_ar'  => store_opt($b['subtitle_ar'] ?? null),
        'cta_label_en' => store_opt($b['cta_label_en'] ?? null),
        'cta_label_ar' => store_opt($b['cta_label_ar'] ?? null),
        // Same-origin paths only. A hero button is the most prominent link on
        // the site, so it may not be pointed at somebody else's domain from a
        // form — that is a redirect the shop's own design would be lending
        // credibility to.
        'cta_href'     => store_internal_href($b['cta_href'] ?? null),
        'active'       => !empty($b['active']) ? 1 : 0,
        'sort'         => (int)($b['sort'] ?? 0),
        'focal_x'      => $focalX,
        'focal_y'      => $focalY,
    ];
    if ($image !== null) {
        $fields['image'] = $image;
        // The hash is the cache key the storefront URL carries, so a replaced
        // photograph is a different URL and appears at once despite the
        // one-year immutable cache on the old one.
        $fields['image_hash'] = hash('sha256', $image);
        $fields['image_w'] = (int)($b['width'] ?? 0) ?: null;
        $fields['image_h'] = (int)($b['height'] ?? 0) ?: null;
    }

    $cols = array_keys($fields);
    if ($id > 0) {
        $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
        $db->prepare("update hero_slides set $set where id = ?")
           ->execute([...array_values($fields), $id]);
    } else {
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        $db->prepare('insert into hero_slides (' . implode(', ', $cols) . ") values ($ph)")
           ->execute(array_values($fields));
        $id = (int)$db->lastInsertId();
    }
    store_out(['id' => $id]);
}

if ($r === 'slide_delete' && $method === 'POST') {
    $b = store_body();
    // Slides are genuinely deletable, unlike products and brands: nothing
    // points at one. No order, no invoice and no history refers to a slide, so
    // removing it loses nothing but the picture.
    $db->prepare('delete from hero_slides where id = ?')->execute([(int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// Reorder in one call. Sending the whole order at once means the list can
// never be left half-renumbered by a failed second request.
if ($r === 'slide_reorder' && $method === 'POST') {
    $ids = store_body()['ids'] ?? [];
    if (!is_array($ids)) store_fail('bad_request');
    $db->beginTransaction();
    $up = $db->prepare('update hero_slides set sort = ? where id = ?');
    foreach (array_values($ids) as $i => $id) $up->execute([$i, (int)$id]);
    $db->commit();
    store_out(['ok' => true]);
}

// ------------------------------------------------------------------ settings
// How the slider plays, and the promo bar. Whitelisted by name and rebuilt
// field by field: a settings endpoint that stores whatever JSON it is handed
// is a place to park arbitrary data inside the shop's own configuration.
if ($r === 'font_list' && $method === 'GET') {
    $present = array_filter(store_font_library($db), static fn (array $font): bool =>
        is_file(store_font_directory() . '/' . $font['id'] . '.' . $font['format']));
    store_out(array_values($present));
}

if ($r === 'font_upload' && $method === 'POST') {
    if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    store_throttle($db, 'font_upload', 12, 60);
    $b = store_body(3 * 1024 * 1024);
    $name = store_text($b['name'] ?? null, 'font_name', 1, 80);
    $name = trim((string)preg_replace('/[<>]/u', '', $name));
    if ($name === '') store_fail('invalid_font_name');
    $data = $b['data'] ?? null;
    if (!is_string($data) || !preg_match('#^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/]+={0,2})$#D', $data, $m)) {
        store_fail('invalid_font_data');
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false || strlen($bytes) > STORE_FONT_MAX_BYTES) store_fail('font_too_large', 413);
    $format = store_font_format($bytes);
    if ($format === null) store_fail('invalid_font_file');
    $mime = strtolower($m[1]);
    $mimeByFormat = [
        'woff2' => ['font/woff2', 'application/font-woff2', 'application/octet-stream'],
        'woff'  => ['font/woff', 'application/font-woff', 'application/octet-stream'],
        'ttf'   => ['font/ttf', 'application/x-font-ttf', 'application/octet-stream'],
        'otf'   => ['font/otf', 'application/x-font-opentype', 'application/vnd.ms-opentype', 'application/octet-stream'],
    ];
    if (!in_array($mime, $mimeByFormat[$format], true)) store_fail('invalid_font_format');
    $originalExt = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if ($originalExt !== '' && $originalExt !== $format) store_fail('invalid_font_format');

    $dir = store_font_directory();
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        store_fail('font_storage_unavailable', 500);
    }
    $guard = "Options -Indexes\n<FilesMatch \"(?i)\\.(php|phtml|phar|cgi|pl|py|sh|html?|svg|js|css)$\">\n  Require all denied\n</FilesMatch>\n";
    if (!is_file($dir . '/.htaccess') && @file_put_contents($dir . '/.htaccess', $guard, LOCK_EX) !== strlen($guard)) {
        store_fail('font_storage_unavailable', 500);
    }
    $id = bin2hex(random_bytes(10));
    $target = $dir . '/' . $id . '.' . $format;
    $tmp = @tempnam($dir, '.font-upload-');
    if ($tmp === false || @file_put_contents($tmp, $bytes, LOCK_EX) !== strlen($bytes)
        || !@chmod($tmp, 0644) || !@rename($tmp, $target)) {
        if (is_string($tmp)) @unlink($tmp);
        store_fail('font_write_failed', 500);
    }
    $entry = ['id' => $id, 'name' => $name, 'path' => '/fonts/custom/' . $id . '.' . $format,
              'format' => $format, 'bytes' => strlen($bytes)];
    try {
        $db->beginTransaction();
        $library = array_filter(store_font_library($db, true), static fn (array $font): bool =>
            is_file(store_font_directory() . '/' . $font['id'] . '.' . $font['format']));
        if (count($library) >= 24 || array_sum(array_column($library, 'bytes')) + strlen($bytes) > 32 * 1024 * 1024) {
            $db->rollBack();
            @unlink($target);
            store_fail('font_library_full', 409);
        }
        $library[$id] = $entry;
        store_font_library_save($db, $library);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        @unlink($target);
        throw $e;
    }
    store_out($entry, 201);
}

if ($r === 'font_delete' && $method === 'POST') {
    if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    $b = store_body(4096);
    $id = $b['id'] ?? null;
    if (!is_string($id) || !preg_match('/^[a-f0-9]{20}$/D', $id)) store_fail('invalid_font_id');
    $quarantine = null;
    $target = null;
    try {
        $db->beginTransaction();
        $library = store_font_library($db, true);
        if (!isset($library[$id])) {
            $db->rollBack();
            store_fail('font_not_found', 404);
        }
        $theme = store_setting($db, 'theme');
        if (is_array($theme['fonts'] ?? null) && store_font_in_use($theme['fonts'], $id)) {
            $db->rollBack();
            store_fail('font_in_use', 409);
        }
        $target = store_font_directory() . '/' . $id . '.' . $library[$id]['format'];
        if (is_file($target)) {
            $quarantine = store_font_directory() . '/.deleted-' . $id . '-' . bin2hex(random_bytes(4));
            if (!@rename($target, $quarantine)) throw new RuntimeException('font_delete_failed');
        }
        unset($library[$id]);
        store_font_library_save($db, $library);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($quarantine !== null && $target !== null) @rename($quarantine, $target);
        store_fail('font_delete_failed', 500);
    }
    if ($quarantine !== null) @unlink($quarantine);
    store_out(['ok' => true]);
}

if ($r === 'checkout_settings') {
    $c = store_checkout_setting($db);
    store_out([
        'delivery_fee' => (float)store_kwd($c['delivery_fee_fils']),
        'methods' => $c['methods'],
        'default_method' => $c['default_method'],
        'notice_en' => $c['notice_en'],
        'notice_ar' => $c['notice_ar'],
    ]);
}

if ($r === 'inventory_finance') {
    $f = store_setting($db, 'inventory_finance');
    store_out([
        'delivery_expense' => (float)($f['delivery_expense'] ?? 0),
        'ads_expense' => (float)($f['ads_expense'] ?? 0),
        'fixed_expense' => (float)($f['fixed_expense'] ?? 0),
        'variable_expense' => (float)($f['variable_expense'] ?? 0),
        'returns_expense' => (float)($f['returns_expense'] ?? 0),
        'damage_expense' => (float)($f['damage_expense'] ?? 0),
    ]);
}

if ($r === 'theme_settings') {
    store_out(store_theme_with_fonts($db));
}

// Unlike the public slides payload, the editor needs the complete schedule.
// This route is below the administrator authentication gate and returns only
// the normalised, whitelisted topbar contract.
if ($r === 'topbar_settings') {
    store_out(store_topbar_setting($db));
}

// Search metadata is limited to known page paths and existing product IDs.
// The public URL, language alternates and indexing policy come from the
// renderer, never from administrator-supplied text.
if ($r === 'seo_settings' && $method === 'GET') {
    store_out(store_seo_admin_settings($db));
}

if ($r === 'seo_save' && $method === 'POST') {
    if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json') {
        store_fail('bad_request', 403);
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) store_fail('request_too_large', 413);
    $body = store_body(8192);
    $record = store_seo_validate_record($body);
    $scope = $body['scope'] ?? null;
    if ($scope === 'page') {
        $path = $body['path'] ?? null;
        if (!is_string($path)) store_fail('invalid_seo_path');
        store_out(store_seo_save_page($db, $path, $record));
    }
    if ($scope === 'product') {
        $rawId = $body['product_id'] ?? null;
        if (!is_int($rawId) && !(is_string($rawId) && preg_match('/^[1-9][0-9]{0,9}$/D', $rawId))) {
            store_fail('product_not_found', 404);
        }
        store_out(store_seo_save_product($db, (int)$rawId, $record));
    }
    store_fail('invalid_seo_scope');
}

if ($r === 'settings_save' && $method === 'POST') {
    $b = store_body();
    $name = (string)($b['name'] ?? '');
    $v = is_array($b['value'] ?? null) ? $b['value'] : [];

    if ($name === 'hero') {
        store_setting_save($db, 'hero', [
            // 2s floor: anything faster is unreadable, and WCAG 2.2.2 wants
            // moving content to be pausable, not merely slow. 30s ceiling
            // because past that the second slide is never seen.
            'speed_ms' => max(2000, min(30000, (int)($v['speed_ms'] ?? 6500))),
            'shuffle'  => !empty($v['shuffle']),
            'autoplay' => !empty($v['autoplay']),
            'size'     => in_array($v['size'] ?? '', ['short', 'tall', 'full'], true) ? $v['size'] : 'tall',
        ]);
    } elseif ($name === 'promo_bar') {
        $bool = static function (mixed $raw, string $field, bool $fallback): bool {
            if ($raw === null) return $fallback;
            if (is_bool($raw)) return $raw;
            if ($raw === 1 || $raw === '1') return true;
            if ($raw === 0 || $raw === '0') return false;
            store_fail("invalid_{$field}");
        };
        $enabled = $bool($v['enabled'] ?? null, 'topbar_enabled', false);
        $textEn = store_text($v['text_en'] ?? null, 'topbar_text_en', 0, 160);
        $textAr = store_text($v['text_ar'] ?? null, 'topbar_text_ar', 0, 160);
        if ($enabled && ($textEn === '' || $textAr === '')) store_fail('topbar_text_required');

        $startsAt = store_datetime($v['starts_at'] ?? null);
        $endsAt = store_datetime($v['ends_at'] ?? null);
        if ($startsAt !== null && $endsAt !== null && $startsAt >= $endsAt) {
            store_fail('invalid_topbar_schedule');
        }

        $tone = trim(store_input_string($v['tone'] ?? 'brand', 'topbar_tone', 16));
        if (!in_array($tone, ['brand', 'ink', 'silver'], true)) store_fail('invalid_topbar_tone');
        $alignment = trim(store_input_string($v['alignment'] ?? 'center', 'topbar_alignment', 16));
        if (!in_array($alignment, ['center', 'start'], true)) store_fail('invalid_topbar_alignment');

        $topbar = [
            'enabled'   => $enabled,
            'text_en'   => $textEn,
            'text_ar'   => $textAr,
            'href'      => store_internal_href($v['href'] ?? null) ?? '',
            'starts_at' => $startsAt,
            'ends_at'   => $endsAt,
            'tone'      => $tone,
            'show_dot'  => $bool($v['show_dot'] ?? null, 'topbar_show_dot', true),
            'alignment' => $alignment,
        ];
        store_setting_save($db, 'promo_bar', $topbar);
        // Return the value accepted by the server, not an earlier per-request
        // settings cache. This is what the editor uses as its clean baseline.
        store_out($topbar);
    } elseif ($name === 'checkout') {
        $enabled = array_values(array_filter(STORE_PAY_METHODS, fn ($m) => !empty($v[$m])));
        if (!$enabled) store_fail('payment_method_required');
        $fee = $v['delivery_fee'] ?? null;
        if (!is_numeric($fee) || (float)$fee < 0 || (float)$fee > 100) store_fail('invalid_delivery_fee');
        $feeFils = (int)round((float)$fee * 1000);
        $default = in_array((string)($v['default_method'] ?? ''), $enabled, true)
            ? (string)$v['default_method'] : $enabled[0];
        store_setting_save($db, 'checkout', [
            'delivery_fee_fils' => $feeFils,
            'knet' => in_array('knet', $enabled, true),
            'tpay' => in_array('tpay', $enabled, true),
            'cod' => in_array('cod', $enabled, true),
            'default_method' => $default,
            'notice_en' => mb_substr(trim((string)($v['notice_en'] ?? '')), 0, 240),
            'notice_ar' => mb_substr(trim((string)($v['notice_ar'] ?? '')), 0, 240),
        ]);
    } elseif ($name === 'inventory_finance') {
        $money = static function ($value): float {
            if (!is_numeric($value)) store_fail('invalid_expense');
            $n = (float)$value;
            if ($n < 0 || $n > 100000000) store_fail('invalid_expense');
            return round($n, 3);
        };
        store_setting_save($db, 'inventory_finance', [
            'delivery_expense' => $money($v['delivery_expense'] ?? 0),
            'ads_expense' => $money($v['ads_expense'] ?? 0),
            'fixed_expense' => $money($v['fixed_expense'] ?? 0),
            'variable_expense' => $money($v['variable_expense'] ?? 0),
            'returns_expense' => $money($v['returns_expense'] ?? 0),
            'damage_expense' => $money($v['damage_expense'] ?? 0),
        ]);
    } elseif ($name === 'theme') {
        $hex = static function ($value, $fallback): string {
            $v = strtolower(trim((string)$value));
            return preg_match('/^#[0-9a-f]{6}$/', $v) ? $v : $fallback;
        };
        $db->beginTransaction();
        try {
            $library = store_font_library($db, true);
            $current = store_setting($db, 'theme');
            $fontInput = array_key_exists('fonts', $v) ? ['fonts' => $v['fonts']] : $current;
            $fonts = store_font_choices($fontInput, $library, true);
            $savedTheme = [
            'brand' => $hex($v['brand'] ?? '', '#c76a42'),
            'accent' => $hex($v['accent'] ?? '', '#99452b'),
            'canvas' => $hex($v['canvas'] ?? '', '#ffffff'),
            'radius' => in_array((string)($v['radius'] ?? ''), ['10','16','24'], true) ? (string)$v['radius'] : '16',
            'dark' => !empty($v['dark']),
            'fonts' => $fonts,
            ];
            store_setting_save($db, 'theme', $savedTheme);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
        $assets = [];
        foreach (array_unique(array_values($fonts)) as $choice) {
            if (str_starts_with($choice, 'custom:')) {
                $id = substr($choice, 7);
                $assets[$id] = ['path' => $library[$id]['path'], 'format' => $library[$id]['format']];
            }
        }
        store_out([...$savedTheme, 'font_assets' => (object)$assets]);
    } else {
        store_fail('unknown_setting');
    }
    store_out(store_setting($db, $name));
}

// ------------------------------------------------------------- blocked numbers
// The manual half of the cash-on-delivery defence — see antifraud.mysql.sql.
// The automatic cap stops one number flooding the courier; this is where the
// owner records the number that already cost them three wasted trips.
if ($r === 'blocked') {
    store_out($db->query(
        'select id, phone, scope, reason, blocked_by, created_at
           from blocked_customers order by created_at desc limit 500'
    )->fetchAll());
}

if ($r === 'block_customer' && $method === 'POST') {
    $b = store_body();
    // Canonicalised with the SAME function the checkout uses, or the block is
    // recorded against a spelling the order path will never produce and
    // silently protects nothing.
    $phone = store_phone((string)($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    $scope = ($b['scope'] ?? 'cod') === 'all' ? 'all' : 'cod';
    $reason = mb_substr(trim((string)($b['reason'] ?? '')), 0, 200);

    $db->prepare(
        'insert into blocked_customers (phone, scope, reason, blocked_by) values (?, ?, ?, ?)
         on duplicate key update scope = values(scope), reason = values(reason),
                                 blocked_by = values(blocked_by)'
    )->execute([$phone, $scope, $reason === '' ? null : $reason,
                (string)($_SESSION['admin_email'] ?? '')]);
    store_out(['ok' => true, 'phone' => $phone, 'scope' => $scope]);
}

// Unblocking must be as easy as blocking. A block placed by mistake that
// cannot be undone from the same screen becomes a customer nobody can help.
if ($r === 'unblock_customer' && $method === 'POST') {
    $b = store_body();
    $phone = store_phone((string)($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    $db->prepare('delete from blocked_customers where phone = ?')->execute([$phone]);
    store_out(['ok' => true]);
}

// ----------------------------------------------------------------- discounts
if ($r === 'discounts') {
    $rows = $db->query('select * from discounts order by kind, code, id')->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['active'] = (bool)$row['active'];
        $row['value'] = (float)$row['value'];
        $row['min_order'] = (float)$row['min_order'];
        $row['usage_limit'] = (int)$row['usage_limit'];
        $row['used_count'] = (int)$row['used_count'];
        $row['live'] = $row['active'] && store_window_open($row['starts_at'], $row['ends_at'])
            && ($row['usage_limit'] === 0 || $row['used_count'] < $row['usage_limit']);
    }
    unset($row);
    store_out($rows);
}

if ($r === 'discount_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $kind = ($b['kind'] ?? 'code') === 'auto' ? 'auto' : 'code';
    $type = ($b['type'] ?? 'percent') === 'fixed' ? 'fixed' : 'percent';

    // Uppercase and stripped to A-Z0-9, so SAVE10 and save10 cannot both
    // exist and a code cannot carry a space the customer will never reproduce.
    $code = null;
    if ($kind === 'code') {
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($b['code'] ?? '')));
        if (strlen($code) < 3 || strlen($code) > 24) store_fail('invalid_code');
    }

    $value = (float)($b['value'] ?? 0);
    // 90% is the per-rule ceiling; store_discounts_for caps the STACK at 60%
    // of the order. Both exist: one stops a typo ("100" meaning 10), the other
    // stops two sane rules adding up to a free order.
    if ($type === 'percent' && ($value < 1 || $value > 90)) store_fail('invalid_percent');
    if ($type === 'fixed' && ($value <= 0 || $value > 9999)) store_fail('invalid_amount');

    $fields = [
        'kind'        => $kind,
        'code'        => $code,
        'label'       => store_text($b['label'] ?? null, 'label', 2, 80),
        'type'        => $type,
        'value'       => number_format($value, 3, '.', ''),
        'min_order'   => number_format(max(0, (float)($b['min_order'] ?? 0)), 3, '.', ''),
        'category'    => store_opt($b['category'] ?? null),
        'starts_at'   => store_datetime($b['starts_at'] ?? null),
        'ends_at'     => store_datetime($b['ends_at'] ?? null),
        'usage_limit' => max(0, (int)($b['usage_limit'] ?? 0)),
        'active'      => !empty($b['active']) ? 1 : 0,
    ];
    if ($fields['starts_at'] !== null && $fields['ends_at'] !== null
        && $fields['starts_at'] > $fields['ends_at']) store_fail('sale_dates_backwards');

    $cols = array_keys($fields);
    try {
        if ($id > 0) {
            $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
            $db->prepare("update discounts set $set where id = ?")
               ->execute([...array_values($fields), $id]);
        } else {
            $ph = implode(', ', array_fill(0, count($cols), '?'));
            $db->prepare('insert into discounts (' . implode(', ', $cols) . ") values ($ph)")
               ->execute(array_values($fields));
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('code_taken');
        throw $e;
    }
    $q = $db->prepare('select * from discounts where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Switched off, never deleted while it has been used: orders reference the
// code they were given, and a report that cannot explain why an order was
// 3 KWD cheaper is a report nobody trusts.
if ($r === 'discount_active' && $method === 'POST') {
    $b = store_body();
    $db->prepare('update discounts set active = ? where id = ?')
       ->execute([!empty($b['active']) ? 1 : 0, (int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

if ($r === 'discount_delete' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $q = $db->prepare('select code from discounts where id = ?');
    $q->execute([$id]);
    $code = $q->fetchColumn();
    if ($code !== false && $code !== null) {
        $u = $db->prepare('select count(*) from orders where discount_code = ?');
        $u->execute([$code]);
        if ((int)$u->fetchColumn() > 0) store_fail('discount_in_use', 409);
    }
    $db->prepare('delete from discounts where id = ?')->execute([$id]);
    store_out(['ok' => true]);
}

store_fail('not_found', 404);
