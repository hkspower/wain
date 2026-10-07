<?php
/**
 * Sporta — customer accounts: register, sign in, and see your own orders.
 *
 * WHAT THIS COSTS, said first because it was a deliberate property and this
 * ends it: the storefront has always set ZERO cookies for a shopper, measured
 * and re-asserted by a rig. A session needs one. So the trade made here is
 * narrower than "the shop sets cookies now" —
 *
 *     A COOKIE APPEARS ONLY WHEN SOMEBODY SIGNS IN OR REGISTERS.
 *
 * Browsing, searching, the cart, the checkout and every public route stay
 * cookie-free for a shopper who never opens an account, and `customer_me`
 * answers for a signed-out visitor WITHOUT starting a session — because a
 * route that starts one to tell you nobody is signed in gives a cookie to
 * every visitor who loads the page, which is the property gone by accident.
 *
 * WHICH ORDERS AN ACCOUNT CAN SEE, and this is the security decision:
 * `orders.customer_id`, written at checkout by a shopper who was signed in.
 * NEVER the phone number. Registration verifies no phone — this shop has no
 * SMS provider — so linking by phone would let anyone who knows a customer's
 * mobile read that person's name, address and everything they have bought.
 * The returns route gates on the phone only because it demands the order
 * REFERENCE with it, and the pair is something only the customer has. One of
 * those two facts is not a credential on its own.
 *
 * SO AN ACCOUNT STARTS EMPTY. That is the honest cost of not having phone
 * verification, and it is stated on the screen rather than hidden.
 *
 * IT IS NOT THE ADMIN SESSION. A separate cookie, a separate key, a separate
 * lifetime, and Lax rather than Strict — see store_session_start(), where the
 * bank's redirect is the reason. Nothing here can reach admin_users and
 * nothing here is consulted by store_session_admin().
 */

/** The signed-in customer's id, or null. Never starts a session. */
function customer_id(): ?int
{
    // NO SESSION IS STARTED TO ANSWER THIS. If the browser holds no shopper
    // cookie there is nobody to look up, and starting a session would MINT one
    // — handing a cookie to every visitor who merely loaded a page that asks
    // "am I signed in?". That is how a zero-cookie storefront stops being one,
    // silently, on a route that reads.
    $name = store_is_https() ? '__Host-sporta_shopper' : 'sporta_shopper';
    if (session_status() !== PHP_SESSION_ACTIVE && empty($_COOKIE[$name])) return null;
    store_session_start('shopper');

    $id = (int) ($_SESSION['customer_id'] ?? 0);
    if ($id < 1) return null;

    // The two clocks, ours rather than the garbage collector's, for the reason
    // store_session_admin() gives at length about the same pair.
    $seen  = (int) ($_SESSION['customer_seen'] ?? 0);
    $since = (int) ($_SESSION['customer_since'] ?? 0);
    $now   = time();
    if ($seen === 0 || $since === 0
        || $now - $seen  > (empty($_SESSION['customer_short']) ? STORE_CUSTOMER_IDLE_SECONDS : 86400)
        || $now - $since > STORE_CUSTOMER_ABSOLUTE_SECONDS) {
        store_session_end();
        return null;
    }
    // THE ACCOUNT'S KEY MUST STILL BE THE ONE SIGNED IN WITH. When the real owner proves an
    // address, customer_verified_account() replaces an unverified account's password — and a
    // squatter who was already signed in must lose that session too, not keep it for 90 days.
    try {
        $q = store_db()->prepare('select password_hash from customers where id = ? limit 1');
        $q->execute([$id]);
        $h = $q->fetchColumn();
    } catch (Throwable $e) { $h = null; }
    // A session signed in before this check existed carries no key: it adopts the current one once,
    // rather than signing every existing customer out.
    if (is_string($h) && !isset($_SESSION['customer_key'])) $_SESSION['customer_key'] = customer_key($h);
    if ($h === false || ($h !== null && !hash_equals((string) ($_SESSION['customer_key'] ?? ''), customer_key((string) $h)))) {
        store_session_end();
        return null;
    }
    $_SESSION['customer_seen'] = $now;
    return $id;
}

/** A short fingerprint of the account's password hash: changes whenever the password is replaced. */
function customer_key(string $hash): string { return substr(hash('sha256', 'customer-key|' . $hash), 0, 32); }

/**
 * Sign $id in, rotating the session id.
 *
 * $remember false = "Keep me signed in" unticked: the cookie ends when the browser closes and the
 * idle clock is one day instead of thirty. A session may already be open (a passkey challenge
 * lives in one), so it is closed and reopened with the new cookie lifetime first — the cookie
 * parameters cannot change while a session is active.
 */
function customer_grant(int $id, bool $remember = true): void
{
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    store_session_start('shopper', $remember);
    // ROTATE. A fixed id across the sign-in boundary is session fixation: an
    // attacker who can set the cookie before you sign in holds your session
    // after. store_admin_grant() does the same for the same reason.
    session_regenerate_id(true);
    unset($_SESSION['cpk_challenge']);
    $_SESSION['customer_id']    = $id;
    $_SESSION['customer_seen']  = time();
    $_SESSION['customer_since'] = time();
    $_SESSION['customer_short'] = $remember ? 0 : 1;
    $q = store_db()->prepare('select password_hash from customers where id = ? limit 1');
    $q->execute([$id]);
    $_SESSION['customer_key'] = customer_key((string) $q->fetchColumn());
}

/** An email, normalised, or null if it is not one. */
function customer_email(?string $raw): ?string
{
    $e = strtolower(trim((string) $raw));
    if ($e === '' || strlen($e) > 190) return null;
    return filter_var($e, FILTER_VALIDATE_EMAIL) === false ? null : $e;
}

/**
 * Create an account. Returns ['error' => token] or ['id' => int].
 *
 * THE SAME ANSWER FOR A TAKEN EMAIL AS FOR A BAD ONE? No — and that is
 * deliberate in the other direction from the admin login. A shop that refuses
 * to say "you already have an account" sends a returning customer round in
 * circles, and the fact leaks anyway: the sign-in screen next door will tell
 * them. What is protected is the PASSWORD, not the existence of the address.
 */
function customer_register(PDO $db, array $in): array
{
    $email = customer_email($in['email'] ?? null);
    if ($email === null) return ['error' => 'invalid_email'];

    $pw = (string) ($in['password'] ?? '');
    // Twelve, the same floor the admin accounts use. A shop that asks for
    // eight is a shop whose customers reuse an eight-character password.
    if (strlen($pw) < 12)   return ['error' => 'password_too_short'];
    if (strlen($pw) > 4096) return ['error' => 'password_too_long'];

    $name = trim((string) ($in['name'] ?? ''));
    if ($name !== '' && mb_strlen($name) > 120) return ['error' => 'invalid_name'];

    // The phone is OPTIONAL and, for now, decorative: nothing reads it to find
    // orders, for the reason in this file's header. It is asked for so the
    // shop can ring somebody about a delivery, and stored normalised so that a
    // verified link can be added later without a migration.
    $phone = null;
    if (trim((string) ($in['phone'] ?? '')) !== '') {
        $phone = store_phone((string) $in['phone']);
        if ($phone === null) return ['error' => 'invalid_phone'];
    }

    try {
        $q = $db->prepare('insert into customers (email, phone, name, password_hash)
                           values (?, ?, ?, ?)');
        $q->execute([$email, $phone, $name === '' ? null : $name,
                     password_hash($pw, PASSWORD_DEFAULT)]);
    } catch (PDOException $e) {
        // 23000 is the unique index on email. Anything else is a real fault
        // and must not be reported to a stranger as "that email is taken".
        if ($e->getCode() === '23000') return ['error' => 'email_taken'];
        throw $e;
    }
    return ['id' => (int) $db->lastInsertId()];
}

/**
 * Check an email and password. Returns ['error' => token] or ['id' => int].
 *
 * ONE ANSWER FOR BOTH MISSES, unlike register: "no such account" and "wrong
 * password" told apart is a way to ask this shop which of a list of addresses
 * has an account, one request at a time.
 */
function customer_login(PDO $db, array $in): array
{
    $email = customer_email($in['email'] ?? null);
    $pw    = (string) ($in['password'] ?? '');
    // The lookup still runs for an invalid address, and the verify still runs
    // for a missing account, so a bad email and a bad password cost the same
    // time. store_login() does this too, and for the same reason: the timing
    // is an oracle if it does not.
    $u = null;
    if ($email !== null) {
        $q = $db->prepare('select id, password_hash from customers where email = ? limit 1');
        $q->execute([$email]);
        $u = $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    $hash = $u['password_hash'] ?? password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    if (!$u || !password_verify($pw, $hash)) {
        // UNLIKE store_login(), there is no per-account lockout here — the
        // customers table carries no failed_attempts/locked_until columns,
        // and adding them is a schema change this finding does not need to
        // wait on. What store_login() calls "the shape of a spray" applies
        // just as much to a shop's customers as to its one admin account:
        // without this, nothing stops an unlimited number of password
        // guesses against any customer email, from one IP or spread across
        // many. Same bucket shape and limits store_login() already uses for
        // exactly this — counted only on failure, so a shopper who mistypes
        // their own password a few times is never touched.
        store_throttle($db, 'customer_login_fail', 50, 900);
        return ['error' => 'bad_credentials'];
    }

    try {
        $db->prepare('update customers set last_seen_at = now() where id = ?')
           ->execute([(int) $u['id']]);
    } catch (Throwable $e) {
        // Not worth failing a sign-in over. A missing timestamp is a smaller
        // problem than a customer who cannot get in.
    }
    return ['id' => (int) $u['id']];
}

/** The account, as the shop will show it back. Never the hash. */
function customer_profile(PDO $db, int $id): ?array
{
    $q = $db->prepare('select id, email, phone, name, created_at from customers where id = ? limit 1');
    $q->execute([$id]);
    $r = $q->fetch(PDO::FETCH_ASSOC);
    return $r ?: null;
}

/**
 * This customer's own orders.
 *
 * SCOPED BY customer_id IN THE QUERY, not filtered afterwards. A route that
 * fetches everything and then removes what does not belong is one refactor
 * away from forgetting to.
 */
function customer_orders(PDO $db, int $id): array
{
    $q = $db->prepare(
        'select track_id, amount, payment_status, payment_method, fulfilment_status,
                created_at, fulfilled_at
           from orders where customer_id = ? order by id desc limit 100'
    );
    $q->execute([$id]);
    return $q->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// =============================================================== fast sign-in
//
// Three ways in without typing a password, asked for on 2026-10-07: a passkey (Face ID /
// fingerprint), a six-digit code sent by email, and Google. All three end in customer_grant().
//
// THE PRE-HIJACK RULE. Registration with a password verifies no email, so somebody could open an
// account in another person's name and wait. When the REAL owner of that address later proves it
// (a code they received, or Google saying the address is theirs), an unverified account's password
// and passkeys are wiped before they are let in — or the squatter would keep a way in to an
// account the owner now uses. customer_verified_account() is the one place that decides this.

/** Find the account for a PROVED email, or open one. Returns its id. */
function customer_verified_account(PDO $db, string $email, ?string $name = null): int
{
    $q = $db->prepare('select id, verified_at from customers where email = ? limit 1');
    $q->execute([$email]);
    $u = $q->fetch(PDO::FETCH_ASSOC);
    if ($u) {
        if ($u['verified_at'] === null) {
            // See the pre-hijack rule above.
            $db->prepare('update customers set password_hash = ?, verified_at = now() where id = ?')
               ->execute([password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT), (int) $u['id']]);
            try { $db->prepare('delete from customer_passkeys where customer_id = ?')->execute([(int) $u['id']]); }
            catch (Throwable $e) { /* no table yet: nothing to remove */ }
        }
        $db->prepare('update customers set last_seen_at = now() where id = ?')->execute([(int) $u['id']]);
        return (int) $u['id'];
    }
    // A new account with no password at all: nobody knows a random one. The customer signs in by
    // the same route again, or sets nothing — there is nothing to forget.
    $name = $name !== null ? mb_substr(trim($name), 0, 120) : '';
    try {
        $db->prepare('insert into customers (email, name, password_hash, verified_at, last_seen_at) values (?, ?, ?, now(), now())')
           ->execute([$email, $name === '' ? null : $name, password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT)]);
        return (int) $db->lastInsertId();
    } catch (PDOException $e) {
        if ($e->getCode() !== '23000') throw $e;
        return customer_verified_account($db, $email, null);   // opened by a parallel request a moment ago
    }
}

/** Which fast ways in this shop can offer right now. No value is printed, only on/off. */
function customer_signin_methods(PDO $db): array
{
    $cfg = store_config();
    $code = (string) ($cfg['mail_from'] ?? '') !== '' && (string) ($cfg['cron_key'] ?? '') !== '';
    if ($code) { try { $db->query('select 1 from customer_login_codes limit 0'); } catch (Throwable $e) { $code = false; } }
    $pk = true;
    try { $db->query('select 1 from customer_passkeys limit 0'); } catch (Throwable $e) { $pk = false; }
    return ['code' => $code, 'passkey' => $pk, 'google' => customer_google_client($db) !== ''];
}

// ---------------------------------------------------------------- email codes
function customer_code_hash(string $email, string $code): string
{
    return hash_hmac('sha256', 'customer-code|' . $email . '|' . $code, (string) (store_config()['cron_key'] ?? ''));
}

/**
 * Send a sign-in code. ALWAYS answers the same, whether or not the address has an account and
 * whether or not a code went out (a per-address cap of three in fifteen minutes): the answer is not
 * a way to ask which addresses shop here, and the cap is not a way to flood somebody's inbox.
 */
function customer_code_send(PDO $db, array $in): array
{
    $email = customer_email($in['email'] ?? null);
    if ($email === null) return ['error' => 'invalid_email'];
    $cfg = store_config();
    if ((string) ($cfg['mail_from'] ?? '') === '' || (string) ($cfg['cron_key'] ?? '') === '') return ['error' => 'code_not_available'];
    try {
        $q = $db->prepare('select count(*) from customer_login_codes where email = ? and created_at > now() - interval 15 minute');
        $q->execute([$email]);
        if ((int) $q->fetchColumn() >= 3) return ['ok' => true];
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        // A newer code replaces the older ones: only the last one sent works.
        $db->prepare('update customer_login_codes set used_at = now() where email = ? and used_at is null')->execute([$email]);
        $db->prepare('insert into customer_login_codes (email, code_hash, expires_at) values (?, ?, now() + interval 10 minute)')
           ->execute([$email, customer_code_hash($email, $code)]);
    } catch (PDOException $e) {
        return ['error' => 'code_not_available'];
    }
    $ar = ($in['lang'] ?? 'ar') !== 'en';
    $subject = $ar ? 'رمز الدخول إلى سبورتا: ' . $code : 'Your Sporta sign-in code: ' . $code;
    $text = $ar
        ? "رمز الدخول: $code\n\nصالح لمدة ١٠ دقائق. إذا لم تطلبه فتجاهل هذه الرسالة."
        : "Your sign-in code: $code\n\nIt works for 10 minutes. If you did not ask for it, ignore this email.";
    $html = '<div dir="' . ($ar ? 'rtl' : 'ltr') . '" style="font-family:Arial,sans-serif;font-size:16px;color:#171a1e">'
          . '<p>' . ($ar ? 'رمز الدخول إلى سبورتا:' : 'Your Sporta sign-in code:') . '</p>'
          . '<p style="font-size:30px;font-weight:700;letter-spacing:6px;direction:ltr">' . $code . '</p>'
          . '<p style="color:#4b5563">' . ($ar ? 'صالح لمدة ١٠ دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.' : 'It works for 10 minutes. If you did not ask for it, ignore this email.') . '</p></div>';
    store_send_mail($cfg, $email, $subject, $text, $html);
    return ['ok' => true];
}

/** Check a code. Five wrong tries end that code. Returns ['error'] or ['id']. */
function customer_code_verify(PDO $db, array $in): array
{
    $email = customer_email($in['email'] ?? null);
    $code  = preg_replace('/\D/', '', strtr((string) ($in['code'] ?? ''), ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9']));
    if ($email === null || strlen($code) !== 6) return ['error' => 'bad_code'];
    try {
        $q = $db->prepare('select id, code_hash, attempts from customer_login_codes
                            where email = ? and used_at is null and expires_at > now() order by id desc limit 1');
        $q->execute([$email]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) { return ['error' => 'code_not_available']; }
    if (!$row) return ['error' => 'code_expired'];
    // A DAILY CAP PER ADDRESS across every code: five tries a code and three codes every fifteen
    // minutes would otherwise allow ~1,400 guesses a day at one account. Twenty wrong in a day
    // closes code sign-in for that address until the day has passed.
    $f = $db->prepare('select coalesce(sum(attempts), 0) from customer_login_codes where email = ? and created_at > now() - interval 1 day');
    $f->execute([$email]);
    if ((int) $f->fetchColumn() >= 20) return ['error' => 'code_expired'];
    // The try is COUNTED FIRST, and only while under five, in one statement: parallel requests
    // cannot each read "4 tries" and all get a guess.
    $t = $db->prepare('update customer_login_codes set attempts = attempts + 1 where id = ? and attempts < 5 and used_at is null');
    $t->execute([(int) $row['id']]);
    if ($t->rowCount() !== 1) return ['error' => 'code_expired'];
    if (!hash_equals((string) $row['code_hash'], customer_code_hash($email, $code))) return ['error' => 'bad_code'];
    // Spent BEFORE the account is opened, and only if still unspent: two requests racing with the
    // same code cannot both use it.
    $u = $db->prepare('update customer_login_codes set used_at = now() where id = ? and used_at is null');
    $u->execute([(int) $row['id']]);
    if ($u->rowCount() !== 1) return ['error' => 'code_expired'];
    return ['id' => customer_verified_account($db, $email)];
}

// ------------------------------------------------------------------ passkeys
// The verification is security.php's (the panel's passkeys), reused: the CBOR reader, the COSE
// key conversion, the origin and challenge checks. What differs is the table, the session (the
// shopper's, never the admin's) and that USER VERIFICATION IS ALWAYS REQUIRED — a customer has no
// second factor behind the passkey, so the passkey must be the face or the finger, not a tap.
function customer_pk_challenge_new(string $purpose): string
{
    store_session_start('shopper');
    $c = random_bytes(32);
    $_SESSION['cpk_challenge'] = ['purpose' => $purpose, 'value' => sec_b64u($c), 'at' => time()];
    return sec_b64u($c);
}
function customer_pk_challenge_take(string $purpose): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        $name = store_is_https() ? '__Host-sporta_shopper' : 'sporta_shopper';
        if (empty($_COOKIE[$name])) store_fail('passkey_challenge_expired', 401);
        store_session_start('shopper');
    }
    $c = $_SESSION['cpk_challenge'] ?? null;
    unset($_SESSION['cpk_challenge']);
    if (!is_array($c) || ($c['purpose'] ?? '') !== $purpose || time() - (int) ($c['at'] ?? 0) > 300) store_fail('passkey_challenge_expired', 401);
    return sec_unb64u((string) $c['value']);
}

function customer_passkeys_list(PDO $db, int $id): array
{
    try {
        $q = $db->prepare('select id, label, created_at, last_used_at from customer_passkeys where customer_id = ? order by id');
        $q->execute([$id]);
        return $q->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (PDOException $e) { store_fail('passkeys_not_ready', 503); }
}

function customer_passkey_register_options(PDO $db, int $id): array
{
    $me = customer_profile($db, $id);
    try {
        $q = $db->prepare('select credential_id from customer_passkeys where customer_id = ?'); $q->execute([$id]);
        $exclude = array_map(function ($k) { return ['type' => 'public-key', 'id' => sec_b64u((string) $k['credential_id'])]; }, $q->fetchAll());
    } catch (PDOException $e) { store_fail('passkeys_not_ready', 503); }
    return [
        'rp' => ['id' => sec_rp_id(), 'name' => 'Sporta'],
        'user' => ['id' => sec_b64u('sporta-customer-' . $id), 'name' => (string) $me['email'], 'displayName' => (string) ($me['name'] ?: $me['email'])],
        'challenge' => customer_pk_challenge_new('register'),
        'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -257]],
        'timeout' => 120000,
        'attestation' => 'none',
        'excludeCredentials' => $exclude,
        // REQUIRED, not preferred: signing in offers no email box, so the phone has to find the
        // passkey on its own, which only a discoverable credential can do.
        'authenticatorSelection' => ['residentKey' => 'required', 'requireResidentKey' => true, 'userVerification' => 'required'],
    ];
}

function customer_passkey_register(PDO $db, int $id, array $b): array
{
    $challenge = customer_pk_challenge_take('register');
    $resp = is_array($b['response'] ?? null) ? $b['response'] : [];
    $cdj = sec_unb64u((string) ($resp['clientDataJSON'] ?? ''));
    sec_client_data($cdj, 'webauthn.create', $challenge);
    try { $i = 0; $obj = sec_cbor(sec_unb64u((string) ($resp['attestationObject'] ?? '')), $i); } catch (Throwable $e) { store_fail('passkey_bad_attestation'); }
    $ad = is_array($obj) ? ($obj['authData']['bytes'] ?? '') : '';
    try { [$rpIdHash, $flags, $count, $credId, $cose] = sec_auth_data((string) $ad); } catch (Throwable $e) { store_fail('passkey_bad_attestation'); }
    if (!hash_equals(hash('sha256', sec_rp_id(), true), $rpIdHash)) store_fail('passkey_bad_rp');
    if (!($flags & 0x01)) store_fail('passkey_no_user_presence');
    if (!($flags & 0x04)) store_fail('passkey_no_user_verification');
    if (!$credId || !is_array($cose) || strlen($credId) > 400) store_fail('passkey_bad_attestation');
    $pem = sec_cose_to_pem($cose);
    if ($pem === null) store_fail('passkey_unsupported_key');
    $n = $db->prepare('select count(*) from customer_passkeys where customer_id = ?'); $n->execute([$id]);
    if ((int) $n->fetchColumn() >= 10) store_fail('passkey_limit', 409);
    $label = mb_substr(trim((string) ($b['label'] ?? '')), 0, 60);
    $transports = implode(',', array_slice(array_filter(array_map('strval', is_array($resp['transports'] ?? null) ? $resp['transports'] : [])), 0, 4));
    try {
        $db->prepare('insert into customer_passkeys (customer_id, credential_id, public_key, alg, sign_count, label, transports) values (?, ?, ?, ?, ?, ?, ?)')
           ->execute([$id, $credId, $pem[0], $pem[1], $count, $label !== '' ? $label : null, mb_substr($transports, 0, 80)]);
    } catch (PDOException $e) { store_fail('passkey_duplicate', 409); }
    return ['ok' => true];
}

function customer_passkey_login_options(): array
{
    return ['challenge' => customer_pk_challenge_new('login'), 'rpId' => sec_rp_id(), 'timeout' => 120000,
            'userVerification' => 'required', 'allowCredentials' => []];
}

/** Verify an assertion. Returns the customer id, or fails with one answer for every miss. */
function customer_passkey_login(PDO $db, array $b): int
{
    $challenge = customer_pk_challenge_take('login');
    $resp = is_array($b['response'] ?? null) ? $b['response'] : [];
    $credId = sec_unb64u((string) ($b['id'] ?? ($b['rawId'] ?? '')));
    if ($credId === '') store_fail('passkey_refused', 401);
    try {
        $q = $db->prepare('select id, customer_id, public_key, sign_count from customer_passkeys where credential_id = ?');
        $q->bindValue(1, $credId, PDO::PARAM_LOB); $q->execute();
        $k = $q->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) { store_fail('passkeys_not_ready', 503); }
    if (!$k) store_fail('passkey_refused', 401);
    $cdj = sec_unb64u((string) ($resp['clientDataJSON'] ?? ''));
    sec_client_data($cdj, 'webauthn.get', $challenge);
    $ad = sec_unb64u((string) ($resp['authenticatorData'] ?? ''));
    try { [$rpIdHash, $flags, $count] = sec_auth_data($ad); } catch (Throwable $e) { store_fail('passkey_refused', 401); }
    if (!hash_equals(hash('sha256', sec_rp_id(), true), $rpIdHash)) store_fail('passkey_refused', 401);
    if (($flags & 0x05) !== 0x05) store_fail('passkey_refused', 401);   // present AND verified
    $signed = $ad . hash('sha256', $cdj, true);
    if (openssl_verify($signed, sec_unb64u((string) ($resp['signature'] ?? '')), (string) $k['public_key'], OPENSSL_ALGO_SHA256) !== 1) store_fail('passkey_refused', 401);
    if ($count !== 0 && (int) $k['sign_count'] !== 0 && $count <= (int) $k['sign_count']) store_fail('passkey_refused', 401);
    $db->prepare('update customer_passkeys set sign_count = ?, last_used_at = now() where id = ?')->execute([$count, (int) $k['id']]);
    $db->prepare('update customers set last_seen_at = now() where id = ?')->execute([(int) $k['customer_id']]);
    return (int) $k['customer_id'];
}

// -------------------------------------------------------------------- Google
// The redirect flow, NOT Google's button script: the button would need accounts.google.com in
// the storefront's script-src, frame-src and connect-src on every page, and the storefront is
// deliberately kept free of third-party script. A plain navigation to Google needs no policy at
// all. Google posts the signed ID token back to api/customer-google.php (response_mode=form_post).
//
// The same client id as the panel's Google sign-in (/backends -> Settings), and the same switch.
// Its "Authorized redirect URIs" must list https://www.sporta.com.kw/api/customer-google.php.

function customer_google_client(PDO $db): string
{
    $g = store_setting($db, 'google_auth');
    $id = trim((string) ($g['client_id'] ?? ''));
    return ($id !== '' && !empty($g['enabled'])) ? $id : '';
}

/**
 * A signed, self-contained state: Google's form_post is a CROSS-SITE POST, on which the shopper's
 * SameSite=Lax cookie is not sent, so nothing can be kept in a session across the trip. The state
 * carries the nonce, the time, where to return to and the remember choice, signed with the shop's
 * key; the token must carry the same nonce, so a token minted for another visit is refused.
 */
function customer_google_state(string $nonce, string $return, bool $remember, int $at): string
{
    $p = sec_b64u(json_encode(['n' => $nonce, 't' => $at, 'r' => $return, 'm' => $remember ? 1 : 0]));
    return $p . '.' . sec_b64u(hash_hmac('sha256', 'customer-google|' . $p, (string) (store_config()['cron_key'] ?? ''), true));
}
function customer_google_read_state(string $state): ?array
{
    if ((string) (store_config()['cron_key'] ?? '') === '') return null;
    $parts = explode('.', $state);
    if (count($parts) !== 2) return null;
    $want = sec_b64u(hash_hmac('sha256', 'customer-google|' . $parts[0], (string) store_config()['cron_key'], true));
    if (!hash_equals($want, $parts[1])) return null;
    $s = json_decode(sec_unb64u($parts[0]), true);
    if (!is_array($s) || time() - (int) ($s['t'] ?? 0) > 600 || (int) ($s['t'] ?? 0) > time() + 60) return null;
    return $s;
}
/** A path on this shop to come back to, or '/'. Never another host. */
function customer_return_path(string $r): string
{
    return (strlen($r) <= 300 && preg_match('~^/(?![/\\\\])[^\s\\\\]*$~', $r)) ? $r : '/';
}
