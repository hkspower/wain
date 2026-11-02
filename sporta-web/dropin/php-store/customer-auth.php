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
