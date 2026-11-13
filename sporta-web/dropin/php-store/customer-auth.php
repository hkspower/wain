<?php
declare(strict_types=1);

// Independent customer identities: no query or session key grants admin access.
function customer_registration_input(array $body): array {
    foreach (['name', 'email', 'password'] as $key) {
        if (!isset($body[$key]) || !is_string($body[$key])) return ['error' => 'invalid_' . $key];
    }
    $name = trim($body['name']);
    $email = mb_strtolower(trim($body['email']));
    $password = $body['password']; // Never trim or alter a password.
    if (mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/\p{Cc}/u', $name)) return ['error' => 'invalid_name'];
    if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) return ['error' => 'invalid_email'];
    if (mb_strlen($password) < 12 || strlen($password) > 1024) return ['error' => 'invalid_password'];
    return ['name' => $name, 'email' => $email, 'password' => $password];
}

// Prehash the complete UTF-8 password so bcrypt's 72-byte limit cannot silently
// truncate a long password. The database stores only the salted password hash.
//
// The cost is NAMED, not PHP's default. customer_authenticate() verifies an
// unknown address against a fixed $2y$12$ dummy so it costs what a real account
// costs; with the default, that held only on PHP 8.4 (default 12) and a host on
// 8.3 (default 10) hashed real accounts at a quarter of the dummy's work —
// which made the response time say whether an address had an account. Keep the
// two in step: change this and the dummy together.
const CUSTOMER_BCRYPT_COST = 12;

function customer_hash_password(string $password): string {
    return password_hash(hash('sha256', $password), PASSWORD_BCRYPT, ['cost' => CUSTOMER_BCRYPT_COST]);
}
function customer_verify_password(string $password, string $hash): bool {
    return password_verify(hash('sha256', $password), $hash);
}

function customer_password_valid(string $password): bool {
    return mb_strlen($password) >= 12 && strlen($password) <= 1024;
}

function customer_reset_token_valid(string $token): bool {
    return preg_match('/^[a-f0-9]{64}$/D', $token) === 1;
}

function customer_reset_link(string $token): string {
    if (!customer_reset_token_valid($token)) throw new InvalidArgumentException('Invalid reset token');
    // Fragment tokens are never included in web-server request lines or
    // Referer headers, unlike ?token= in a query string.
    return 'https://www.sporta.com.kw/account?mode=reset#token=' . $token;
}

function customer_public(array $user): array {
    return ['name' => (string)$user['name'], 'email' => (string)$user['email'],
        'phone' => (string)($user['phone'] ?? '')];
}

// customer_public plus whether the mailbox is proven. A separate query, so the
// account selects stay the same before and after the verification migration (customers.mysql.sql);
// without that migration every account reads as unverified.
function customer_public_verified(PDO $db, array $user): array {
    $out = customer_public($user);
    $out['email_verified'] = customer_email_verified($db, (int)($user['id'] ?? 0));
    return $out;
}

function customer_email_verified(PDO $db, int $customerId): bool {
    if ($customerId < 1 || !customer_verify_ready($db)) return false;
    $q = $db->prepare('select email_verified_at is not null from customer_accounts where id = ?');
    $q->execute([$customerId]);
    return (int)$q->fetchColumn() === 1;
}

// ------------------------------------------------ email verification (M4)
//
// The link proves the mailbox: 256-bit token, only its SHA-256 stored, valid
// CUSTOMER_VERIFY_HOURS, single use, and a newer link replaces older ones only
// once the newer one has actually been handed to the mail relay (a mail outage
// must not destroy a link that already arrived). Opening it, or completing a
// password reset, sets customer_accounts.email_verified_at. An unverified
// account still signs in and shops; what waits for verification is anything
// that trusts the address itself - today, the birthday gift.
const CUSTOMER_VERIFY_HOURS = 24;

function customer_verify_link(string $token): string {
    if (!customer_reset_token_valid($token)) throw new InvalidArgumentException('Invalid verification token');
    // The origin is fixed, never taken from Host. A GET link (the live account
    // page has no screen that could read a fragment): the token is single use
    // and short-lived, and the route answers with a redirect that drops it.
    return 'https://www.sporta.com.kw/api/customer.php?r=verify_email&token=' . $token;
}

// The set-password mail for an account the checkout has just made (easy register). The same one-use
// link as a password reset (customer_password_resets, opened on /account), with a longer life: the
// shopper may read it after the order. True when the relay accepted it.
function customer_invite_send(PDO $db, int $customerId, string $email): bool {
    $token = bin2hex(random_bytes(32));
    $db->prepare('insert into customer_password_resets (customer_id, token_hash, expires_at, request_ip)
                  values (?, ?, date_add(now(), interval 7 day), ?)')
       ->execute([$customerId, hash('sha256', $token), store_rate_limit_key('customer_reset_ip', store_client_ip())]);
    $inviteId = (int)$db->lastInsertId();
    $link = customer_reset_link($token);
    $safeLink = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $subject = 'Set your Sporta password';
    $text = "Thank you for your Sporta order. We created an account for you with the details you gave us.\n\n"
          . "Open this link to choose your password:\n{$link}\n\n"
          . "The link works once and expires in 7 days. If you did not order from Sporta, ignore this email.\n";
    $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">'
          . '<h2>Set your Sporta password</h2>'
          . '<p>Thank you for your order. We created an account for you with the details you gave us.</p>'
          . '<p><a href="' . $safeLink . '" style="display:inline-block;background:#99452b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Choose my password</a></p>'
          . '<p style="font-size:13px;color:#64748b">This link works once and expires in 7 days. If you did not order from Sporta, ignore this email.</p>'
          . '</div>';
    if (store_send_admin_mail(customer_mail_cfg(), $email, $subject, $text, $html, 'Sporta')) return true;
    $db->prepare('delete from customer_password_resets where id = ?')->execute([$inviteId]);
    error_log('Sporta customer invite mail failed');
    return false;
}

function customer_mail_cfg(): array {
    $cfg = store_config();
    $cfg['mail_from'] = (string)($cfg['customer_mail_from'] ?? $cfg['mail_reply_to'] ?? $cfg['mail_from'] ?? '');
    return $cfg;
}

// Mail a fresh verification link. True when the relay accepted it.
function customer_verify_send(PDO $db, array $user): bool {
    if (!customer_verify_ready($db)) return false;
    $token = bin2hex(random_bytes(32));
    $db->prepare('insert into customer_email_verifications (customer_id, token_hash, expires_at)
                  values (?, ?, date_add(now(), interval ' . CUSTOMER_VERIFY_HOURS . ' hour))')
       ->execute([(int)$user['id'], hash('sha256', $token)]);
    $newId = (int)$db->lastInsertId();
    $link = customer_verify_link($token);
    $safe = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $subject = 'Confirm your Sporta email address';
    $text = "Welcome to Sporta.\n\nConfirm that this is your email address by opening this link within "
          . CUSTOMER_VERIFY_HOURS . " hours:\n{$link}\n\n"
          . "If you did not create a Sporta account, ignore this email.\n";
    $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">'
          . '<h2>Confirm your email address</h2>'
          . '<p>This link expires in ' . CUSTOMER_VERIFY_HOURS . ' hours and can be used once.</p>'
          . '<p><a href="' . $safe . '" style="display:inline-block;background:#99452b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Confirm my email</a></p>'
          . '<p style="font-size:13px;color:#64748b">If you did not create a Sporta account, ignore this email.</p>'
          . '</div>';
    if (store_send_admin_mail(customer_mail_cfg(), (string)$user['email'], $subject, $text, $html, 'Sporta')) {
        $db->prepare('update customer_email_verifications set used_at = now()
                       where customer_id = ? and id <> ? and used_at is null')
           ->execute([(int)$user['id'], $newId]);
        return true;
    }
    $db->prepare('delete from customer_email_verifications where id = ?')->execute([$newId]);
    error_log('Sporta customer verification mail failed');
    return false;
}

// Open a verification link. The customer id it proved, or null.
function customer_verify_consume(PDO $db, string $token): ?int {
    if (!customer_reset_token_valid($token) || !customer_verify_ready($db)) return null;
    $db->beginTransaction();
    try {
        $q = $db->prepare('select id, customer_id from customer_email_verifications
                            where token_hash = ? and used_at is null and expires_at > now()
                            limit 1 for update');
        $q->execute([hash('sha256', $token)]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $db->rollBack();
            return null;
        }
        $id = (int)$row['customer_id'];
        $db->prepare('update customer_email_verifications set used_at = now() where customer_id = ? and used_at is null')
           ->execute([$id]);
        customer_mark_verified($db, $id);
        $db->commit();
        return $id;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// The mailbox is proven (verification link, or a password reset link that
// arrived there). The first proof's time is kept.
function customer_mark_verified(PDO $db, int $customerId): void {
    if ($customerId < 1 || !customer_verify_ready($db)) return;
    $db->prepare('update customer_accounts set email_verified_at = coalesce(email_verified_at, now()) where id = ?')
       ->execute([$customerId]);
}

// "You already have an account." Sent when somebody registers an address that
// has one, so the registration answer itself can be the same for both kinds of
// address (audit M3). At most one an hour per address.
function customer_existing_notice(PDO $db, string $email): void {
    if (!store_rate_limit_once($db, 'customer_register_notice', $email, 3600)) return;
    $subject = 'You already have a Sporta account';
    $text = "Somebody tried to create a Sporta account with this email address, and you already have one.\n\n"
          . "If it was you, sign in at https://www.sporta.com.kw/account - or choose \"Forgot password\" there.\n"
          . "If it was not you, you can ignore this email. Nothing about your account has changed.\n";
    $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">'
          . '<h2>You already have a Sporta account</h2>'
          . '<p>Somebody tried to create a Sporta account with this email address, and you already have one.</p>'
          . '<p>If it was you, <a href="https://www.sporta.com.kw/account">sign in</a>, or choose &ldquo;Forgot password&rdquo; there.</p>'
          . '<p style="font-size:13px;color:#64748b">If it was not you, ignore this email. Nothing about your account has changed.</p>'
          . '</div>';
    if (!store_send_admin_mail(customer_mail_cfg(), $email, $subject, $text, $html, 'Sporta')) {
        error_log('Sporta customer existing-account notice mail failed');
    }
}

// Email changes need mailbox verification, so the profile editor cannot
// change it. A wrong email can be corrected with support after ownership is
// checked; merely knowing a password must not redirect future reset mail.
function customer_profile_input(array $body, string $existingPhone = ''): array {
    if (!is_string($body['name'] ?? null)) return ['error' => 'invalid_name'];
    $name = trim($body['name']);
    if (mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/\p{Cc}/u', $name)) {
        return ['error' => 'invalid_name'];
    }
    $phone = array_key_exists('phone', $body) ? $body['phone'] : $existingPhone;
    if (!is_string($phone) || strlen($phone) > 32) return ['error' => 'invalid_phone'];
    $phone = trim($phone);
    if ($phone !== '') {
        $phone = store_phone($phone);
        if ($phone === null) return ['error' => 'invalid_phone'];
    }
    return ['name' => $name, 'phone' => $phone ?: null];
}

function customer_profile_update(PDO $db, int $customerId, array $input): array {
    $db->prepare('update customer_accounts set name = ?, phone = ? where id = ?')
        ->execute([$input['name'], $input['phone'], $customerId]);
    $q = $db->prepare('select id, name, email, phone, password_hash from customer_accounts where id = ?');
    $q->execute([$customerId]);
    $user = $q->fetch(PDO::FETCH_ASSOC);
    if (!$user) throw new RuntimeException('Customer account disappeared during profile update');
    return customer_public($user);
}

// Only the account ID written by the authenticated checkout may find an order.
// Old guest orders are intentionally unclaimed, even if name or phone matches.
function customer_orders(PDO $db, int $customerId, int $page = 1): array {
    $perPage = 20;
    $offset = ($page - 1) * $perPage;
    $q = $db->prepare('select id, track_id, amount, payment_method, payment_status,
                             fulfilment_status, created_at
                        from orders where customer_account_id = ?
                       order by created_at desc, id desc limit 21 offset ?');
    $q->bindValue(1, $customerId, PDO::PARAM_INT);
    $q->bindValue(2, $offset, PDO::PARAM_INT);
    $q->execute();
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);
    $hasMore = count($rows) > $perPage;
    if ($hasMore) $rows = array_slice($rows, 0, $perPage);
    if (!$rows) return ['orders' => [], 'has_more' => false, 'page' => $page];
    $ids = array_map(static fn ($r) => (int)$r['id'], $rows);
    $markers = implode(',', array_fill(0, count($ids), '?'));
    $items = $db->prepare(
        'select oi.order_id, coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar,
                oi.qty, oi.unit_price, oi.size, oi.fit
           from order_items oi left join products p on p.id = oi.product_id
          where oi.order_id in (' . $markers . ') order by oi.id'
    );
    $items->execute($ids);
    $byOrder = [];
    foreach ($items->fetchAll(PDO::FETCH_ASSOC) as $item) {
        $id = (int)$item['order_id'];
        unset($item['order_id']);
        $item['qty'] = (int)$item['qty'];
        $item['unit_price'] = (float)$item['unit_price'];
        $byOrder[$id][] = $item;
    }
    $orders = array_map(static function (array $row) use ($byOrder): array {
        $id = (int)$row['id'];
        unset($row['id']);
        $row['amount'] = (float)$row['amount'];
        $row['items'] = $byOrder[$id] ?? [];
        // Opens this order's full invoice (/invoice/<track>?k=<key>); the
        // order number alone opens only the limited one (api.php ?r=invoice).
        $row['invoice_key'] = store_invoice_key((string)$row['track_id']);
        return $row;
    }, $rows);
    return ['orders' => $orders, 'has_more' => $hasMore, 'page' => $page];
}

function customer_insert(PDO $db, array $input): ?array {
    $hash = customer_hash_password($input['password']);
    try {
        $db->prepare('insert into customer_accounts (name, email, password_hash) values (?, ?, ?)')
            ->execute([$input['name'], $input['email'], $hash]);
    } catch (PDOException $error) {
        // The UNIQUE constraint also handles simultaneous registration attempts.
        if ($error->getCode() === '23000') return null;
        throw $error;
    }
    return ['id' => (int)$db->lastInsertId(), 'name' => $input['name'], 'email' => $input['email'], 'password_hash' => $hash];
}

function customer_authenticate(PDO $db, string $email, string $password): ?array {
    $query = $db->prepare('select id, name, email, phone, password_hash from customer_accounts where email = ? limit 1');
    $query->execute([mb_strtolower(trim($email))]);
    $user = $query->fetch(PDO::FETCH_ASSOC);
    // Fixed valid bcrypt shape at CUSTOMER_BCRYPT_COST (12). Unknown addresses
    // do password work too, without generating an extra hash on every failure.
    // Never build this at runtime.
    $dummy = '$2y$12$vNk3QOHYO.g/y1k6SJzYL.YjGRlwOp9P1TIeCDX.K6s9gFgNI8Bpe';
    $valid = customer_verify_password($password, $user['password_hash'] ?? $dummy);
    return $user && $valid ? $user : null;
}

function customer_session_valid(array $session, ?array $user, int $now): bool {
    $started = (int)($session['customer_started_at'] ?? 0);
    $seen = (int)($session['customer_seen_at'] ?? 0);
    $fingerprint = (string)($session['customer_fingerprint'] ?? '');
    return $user !== null && (int)($session['customer_id'] ?? 0) === (int)$user['id']
        && $started > 0 && $seen > 0 && $started <= $now && $seen <= $now
        && $now - $seen <= 8 * 3600 && $now - $started <= 7 * 86400
        && $fingerprint !== '' && hash_equals(hash('sha256', $user['password_hash']), $fingerprint);
}

function customer_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    $secure = store_is_https();
    session_name($secure ? '__Host-sporta_customer' : 'sporta_customer');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
}

function customer_sign_in(array $user): void {
    customer_session_start();
    session_regenerate_id(true);
    $_SESSION = ['customer_id' => (int)$user['id'], 'customer_started_at' => time(),
        'customer_seen_at' => time(), 'customer_fingerprint' => hash('sha256', $user['password_hash'])];
}

function customer_clear_session_if_present(): bool {
    $cookie = store_is_https() ? '__Host-sporta_customer' : 'sporta_customer';
    if (session_status() !== PHP_SESSION_ACTIVE && !isset($_COOKIE[$cookie])) return false;
    customer_session_start();
    store_session_end();
    return true;
}

function customer_current_user(PDO $db): ?array {
    $cookie = store_is_https() ? '__Host-sporta_customer' : 'sporta_customer';
    if (session_status() !== PHP_SESSION_ACTIVE && !isset($_COOKIE[$cookie])) return null;
    customer_session_start();
    if (empty($_SESSION['customer_id'])) return null;
    $query = $db->prepare('select id, name, email, phone, password_hash from customer_accounts where id = ?');
    $query->execute([(int)$_SESSION['customer_id']]);
    $user = $query->fetch(PDO::FETCH_ASSOC);
    if (!customer_session_valid($_SESSION, $user ?: null, time())) {
        store_session_end();
        return null;
    }
    $_SESSION['customer_seen_at'] = time();
    return $user;
}

function customer_current(PDO $db): ?array {
    $user = customer_current_user($db);
    return $user === null ? null : customer_public($user);
}
