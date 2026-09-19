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
        || $now - $seen  > STORE_CUSTOMER_IDLE_SECONDS
        || $now - $since > STORE_CUSTOMER_ABSOLUTE_SECONDS) {
        store_session_end();
        return null;
    }
    $_SESSION['customer_seen'] = $now;
    return $id;
}

/** Sign $id in, rotating the session id. */
function customer_grant(int $id): void
{
    store_session_start('shopper');
    // ROTATE. A fixed id across the sign-in boundary is session fixation: an
    // attacker who can set the cookie before you sign in holds your session
    // after. store_admin_grant() does the same for the same reason.
    session_regenerate_id(true);
    $_SESSION['customer_id']    = $id;
    $_SESSION['customer_seen']  = time();
    $_SESSION['customer_since'] = time();
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
    if (!$u || !password_verify($pw, $hash)) return ['error' => 'bad_credentials'];

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
