<?php
// Sporta native store backend — shared core.
//
// This is the backend: MySQL on the same Hostinger plan, PHP on
// the same host that already runs the payment endpoints. It is the model the
// owner's previous OpenCart site used, and it exists so the shop can run with
// no third-party backend at all.
//
// EVERY RULE HERE IS A PORT, NOT AN INVENTION. create_order's validation,
// server-side pricing, idempotency, the size/fit lists, the outbox — each was
// designed and argued over in the Postgres schema this shop started on, and
// this file carries the same
// decisions into PHP. When a rule looks arbitrary ("why 99?"), the reasoning
// lives in the SQL file of the same name; keep the two in step or the two
// backends will accept different orders.
//
// SECURITY POSTURE. This runs on the host that takes the money, so the rules
// that governed the payment dropins govern this too:
//   * config.php holds the DB password and the admin hash — server-only, never
//     committed, never in the zip, denied by name in .htaccess.
//   * Nothing here writes files. The lesson of sporta-deploy.php stands: an
//     endpoint that writes files is a way in, not a bridge.
//   * The browser is never trusted: prices come from the products table, and
//     every admin write goes through the session guard below.

declare(strict_types=1);

// ---------------------------------------------------------------- config + db

function store_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) {
            store_out(['error' => 'not_configured',
                       'hint'  => 'copy config.example.php to config.php and fill in the MySQL details'], 500);
        }
        $cfg = require $path;
    }
    return $cfg;
}

function store_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = store_config();
        try {
            // ERRMODE_EXCEPTION everywhere: a silent false from PDO is how a
            // half-written order happens. utf8mb4 because the catalogue is
            // Arabic.
            $pdo = new PDO(
                "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
                $c['db_user'],
                $c['db_pass'],
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    // Real prepared statements. Emulated ones interpolate, and
                    // an endpoint fed raw JSON from the internet does not.
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        } catch (PDOException $e) {
            // FAILING TO CONNECT IS NOT THE SAME AS A QUERY FAILING, and the
            // difference is the whole point of this branch.
            //
            // Without it, a typo in config.php's db_pass came out of the
            // exception handler below as the generic 'failed', the admin had
            // no branch for that, and it fell through to the last thing on the
            // list — "Wrong email or password." So the owner retyped a correct
            // password five times and locked the account for fifteen minutes,
            // over a wrong DATABASE password. Every one of these errors means
            // "one of the four values in config.php is wrong", and MySQL says
            // WHICH, so it is passed on rather than thrown away.
            $code = (int) ($e->errorInfo[1] ?? 0);
            $which = match ($code) {
                1045    => 'db_user or db_pass',
                1044    => 'db_user has no privileges on db_name',
                1049    => 'db_name',
                2002,
                2005    => 'db_host',
                default => 'one of the four values',
            };
            store_out(['error' => 'db_unreachable', 'cause' => $which], 500);
        }
    }
    return $pdo;
}

// ---------------------------------------------------------------- error floor
//
// Any database error that is not caught locally used to escape as a PHP fatal:
// the browser got HTML instead of JSON (so the admin screen showed a blank
// panel rather than a reason), and on a host with display_errors on, the
// message itself names the database and the SQL. Neither belongs in a
// response. One handler turns both into a JSON token.
//
// The missing-table case is told apart on purpose. It is not an outage — it
// means the SQL was never imported, and it has a specific fix the admin
// screens spell out.
set_exception_handler(function (Throwable $e): void {
    $isMissingTable = $e instanceof PDOException
        && (($e->errorInfo[1] ?? 0) === 1146 || str_contains($e->getMessage(), '42S02'));
    store_out(['error' => $isMissingTable ? 'no_table' : 'failed'], $isMissingTable ? 503 : 500);
});

// ------------------------------------------------------------------ responses

function store_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    // No CORS headers on purpose. The SPA and this API live on the same origin
    // (www.sporta.com.kw), and an API nobody else may call should not invite
    // anybody else to call it. A backend hosted somewhere else needs CORS
    // precisely because it IS a different origin; this one is not.
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// The same stable machine tokens create_order raises, so the storefront's
// existing error translations keep working unchanged against this backend.
function store_fail(string $token, int $code = 400): void {
    store_out(['error' => $token], $code);
}

function store_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

// ------------------------------------------------------------------ validation
// The checkout helpers, same names as the Postgres functions they replace, same
// error tokens, same limits.

const STORE_GOVERNORATES = ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra'];
const STORE_SIZES        = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'];
const STORE_FITS         = ['normal', 'slim', 'loose', 'oversize', 'boxy', 'tank'];
const STORE_PAY_METHODS  = ['knet', 'tpay', 'cod'];

// Arabic-Indic and Extended digits to ASCII — an Arabic keyboard types ٤ for 4,
// and a phone field that rejects half the country's keyboards is broken.
function store_ascii_digits(string $s): string {
    return strtr($s, [
        '٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
        '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
    ]);
}

// A Kuwaiti mobile: 8 digits starting 5, 6 or 9, with 965 prefixes tolerated.
// Returns the 965-prefixed canonical form or null — same as normalise_kw_phone.
function store_phone(?string $raw): ?string {
    $d = preg_replace('/\D/', '', store_ascii_digits((string)$raw));
    if (str_starts_with($d, '00965')) $d = substr($d, 5);
    elseif (strlen($d) > 8 && str_starts_with($d, '965')) $d = substr($d, 3);
    if (!preg_match('/^[569]\d{7}$/', $d)) return null;
    return '965' . $d;
}

// checkout_text: trim, strip control characters, enforce length — raising the
// same missing_/too_long_ tokens the SQL raises so messages translate.
function store_text(?string $v, string $field, int $min, int $max): string {
    $t = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$v) ?? '');
    if (mb_strlen($t) < $min) store_fail("missing_{$field}");
    if (mb_strlen($t) > $max) store_fail("too_long_{$field}");
    return $t;
}

function store_opt(?string $v): ?string {
    $t = trim((string)$v);
    return $t === '' ? null : mb_substr($t, 0, 280);
}

// ------------------------------------------------------------------ outbox

// The fulfilment snapshot, identical in shape to fulfilment_payload() in
// the Postgres trigger it replaces — render.mjs and the email tests already
// define what the warehouse reads, and this must produce the same document.
function store_fulfilment_payload(PDO $db, int $orderId): array {
    $o = $db->prepare('select * from orders where id = ?');
    $o->execute([$orderId]);
    $ord = $o->fetch();
    $it = $db->prepare(
        'select p.name_en, p.name_ar, p.slug as sku, oi.qty, oi.size, oi.fit
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by p.name_en, oi.size'
    );
    $it->execute([$orderId]);
    return [
        'track_id'       => $ord['track_id'],
        'placed_at'      => $ord['created_at'],
        'amount_kwd'     => (float)$ord['amount'],
        'payment_method' => $ord['payment_method'],
        'payment_status' => $ord['payment_status'],
        'collect_cash'   => $ord['payment_method'] === 'cod' && $ord['payment_status'] !== 'paid',
        'customer'       => ['name' => $ord['customer_name'], 'phone' => $ord['customer_phone']],
        'address'        => [
            'governorate' => $ord['customer_governorate'],
            'area'        => $ord['customer_area'],
            'block'       => $ord['customer_block'],
            'street'      => $ord['customer_street'],
            'building'    => $ord['customer_building'],
            'floor'       => $ord['customer_floor'],
            'flat'        => $ord['customer_flat'],
            'note'        => $ord['customer_note'],
        ],
        'items'          => $it->fetchAll(),
    ];
}

function store_queue_fulfilment(PDO $db, int $orderId, string $kind): void {
    // One 'new' message per order, enforced by the unique index — a retry
    // cannot produce two picking lists. INSERT IGNORE is MySQL's on-conflict-
    // do-nothing.
    $payload = json_encode(store_fulfilment_payload($db, $orderId), JSON_UNESCAPED_UNICODE);
    if ($kind === 'new') {
        $db->prepare('insert ignore into fulfilment_outbox (order_id, kind, payload) values (?, ?, ?)')
           ->execute([$orderId, $kind, $payload]);
    } else {
        $db->prepare('insert into fulfilment_outbox (order_id, kind, payload) values (?, ?, ?)')
           ->execute([$orderId, $kind, $payload]);
    }
}

// Called wherever payment_status reaches a settled state — the callback and
// the admin's mark-cash-paid. Mirrors trg_queue_fulfilment_payment.
function store_payment_settled(PDO $db, int $orderId, string $newStatus): void {
    if (in_array($newStatus, ['paid', 'failed'], true)) {
        store_queue_fulfilment($db, $orderId, 'payment');
    }
}

// A logo submitted from the admin, as a data: URL.
//
// The shop needs brand logos and the owner has no shell, so they arrive
// through the browser — but nothing here writes a file. The lesson of
// sporta-deploy.php stands: an endpoint that writes files is a way in. The
// image becomes a row instead, and this is the gate it has to pass:
//
//   * png / jpeg / webp ONLY. Never SVG — an SVG is a document that can carry
//     script, and it would be served from our own origin.
//   * the base64 must actually decode, and the DECODED bytes must begin with
//     that format's magic number, so "data:image/png;base64,<some html>" is
//     rejected rather than stored and later served as an image.
//   * a hard size cap. The admin downscales before sending; this is the floor
//     under that, because a client-side limit is a suggestion.
//
// Returns the normalised data URL, or null when there is nothing to store.
// Anything present but invalid fails the request outright — silently dropping
// a logo would look like a save that worked.
const STORE_LOGO_MAX = 160000;   // ~160 kB of base64, ~120 kB of image
// A hero photograph is a different order of magnitude from a brand logo: it
// fills the viewport, and the admin sends it downscaled to 1600px WebP. This
// is the floor under that, not the target. It is NOT inlined into the
// storefront's JSON — r=slide_image serves it as a cacheable image — so the
// size buys quality on the one image the home page is built around.
const STORE_HERO_MAX = 1200000;  // ~1.2 MB of base64, ~900 kB of image

function store_data_image(?string $raw, int $max = STORE_LOGO_MAX): ?string {
    $v = trim((string)$raw);
    if ($v === '') return null;
    if (strlen($v) > $max) store_fail('logo_too_large');
    if (!preg_match('#^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$#', $v, $m)) {
        store_fail('logo_bad_format');
    }
    $bytes = base64_decode(preg_replace('/\s+/', '', $m[2]), true);
    if ($bytes === false || strlen($bytes) < 32) store_fail('logo_bad_format');
    $magic = [
        'png'  => "\x89PNG\r\n\x1a\n",
        'jpeg' => "\xff\xd8\xff",
        'webp' => 'RIFF',
    ][$m[1]];
    if (!str_starts_with($bytes, $magic)) store_fail('logo_not_an_image');
    // webp carries RIFF....WEBP; check the second marker too.
    if ($m[1] === 'webp' && substr($bytes, 8, 4) !== 'WEBP') store_fail('logo_not_an_image');
    return 'data:image/' . $m[1] . ';base64,' . preg_replace('/\s+/', '', $m[2]);
}

// A brand slug: what the storefront will filter on, so it is url-safe or it is
// nothing. Derived from the English name when the admin does not supply one.
function store_slug(string $s): string {
    $slug = strtolower(trim($s));
    $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
    return trim((string)$slug, '-');
}

// ------------------------------------------------------------- guessing guard
//
// A public endpoint that answers "is this code real?" is an oracle, and an
// unthrottled oracle is a code generator. `?r=discount` is exactly that: no
// session, an unlimited number of tries, and a different answer for a code
// that exists. A script can walk SAVE10, SAVE15, SAVE20 … in seconds and find
// every live discount the shop has.
//
// The throttle is deliberately cheap and stateless-ish: a per-IP counter in
// the same MySQL the request is already talking to, in a fixed window. No new
// table, no cache server, no per-request file writes — this runs on shared
// hosting where none of those exist.
//
// It counts only FAILED lookups. A customer with a real code who re-checks
// their basket four times is not attacking anything, and throttling them would
// break the feature to protect it.
function store_throttle(PDO $db, string $bucket, int $max, int $windowSec): void {
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if ($ip === '') return;
    // The IP is HASHED. This is abuse control, not a visitor log, and a table
    // of who-asked-what is a privacy liability the shop has no use for.
    $key = substr(hash('sha256', $bucket . '|' . $ip), 0, 32);
    $now = time();
    $windowStart = $now - ($now % $windowSec);

    $db->prepare(
        'insert into rate_limit (bucket_key, window_start, hits) values (?, ?, 1)
         on duplicate key update hits = hits + 1'
    )->execute([$key, $windowStart]);

    $q = $db->prepare('select hits from rate_limit where bucket_key = ? and window_start = ?');
    $q->execute([$key, $windowStart]);
    if ((int) $q->fetchColumn() > $max) {
        // 429 with no detail: telling a guesser how long to wait is telling it
        // how fast to go.
        store_fail('too_many_attempts', 429);
    }

    // Opportunistic sweep, ~1 request in 50, so the table cannot grow without
    // bound on a shop that never runs a cron for it.
    if (random_int(1, 50) === 1) {
        $db->prepare('delete from rate_limit where window_start < ?')
           ->execute([$windowStart - ($windowSec * 4)]);
    }
}

// ------------------------------------------------------------------ admin auth

// Is this request really over HTTPS?
//
// Hostinger terminates TLS at a proxy, so PHP sees a PLAIN HTTP request even
// when the browser is on https:// — $_SERVER['HTTPS'] is empty and
// SERVER_PORT is 80. The payment endpoints have always known this
// (knet_require_https, cbk_require_https); the admin session did not, and the
// consequence was worse than a wrong answer: the session cookie was issued
// WITHOUT the Secure flag on the live site, so any request that ever left over
// plain HTTP would carry the admin session with it in clear text.
//
// Same three signals the gateways use, and for the same reason.
function store_is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
}

// How long a signed-in admin stays signed in, enforced on the SERVER.
//
// The cookie itself is a session cookie, so closing the browser ends it — but
// a desktop browser is not closed for weeks, and until now nothing else ended
// it either. These two are the ordinary pair: idle expiry for a machine walked
// away from, absolute expiry so a session cannot live indefinitely by being
// touched. Generous on purpose; this is a shop, not a bank, and a re-login
// every hour would only teach the owner to leave the password in a browser.
const STORE_ADMIN_IDLE_SECONDS     = 8 * 3600;
const STORE_ADMIN_ABSOLUTE_SECONDS = 7 * 86400;

function store_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    // See store_is_https(): reading $_SERVER['HTTPS'] alone left this false on
    // the live server, behind Hostinger's TLS proxy.
    $secure = store_is_https();
    // __Host- is a promise the BROWSER enforces, and it is free: a cookie with
    // that prefix is only accepted when it is Secure, Path=/ and carries no
    // Domain — which this one already is. What it buys is that no other host
    // can write it. Without the prefix, anything able to set a cookie for a
    // sibling or parent name (a subdomain on the same account, a plain-HTTP
    // page on this one) can plant a session id that this site would then read
    // back as its own. With it, the cookie belongs to exactly this origin.
    //
    // Only over HTTPS, because a browser must REJECT a __Host- cookie that is
    // not Secure — using the prefix on http would lock the admin out of a
    // local or half-configured server entirely.
    session_name($secure ? '__Host-sporta_admin' : 'sporta_admin');
    session_set_cookie_params([
        'lifetime' => 0,            // session cookie: closes with the browser
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,         // no script access — this cookie IS the admin
        'samesite' => 'Strict',     // the CSRF defence: no cross-site request carries it
    ]);
    session_start();
}

// Ends the session and the cookie together. Unsetting $_SESSION alone leaves
// the browser holding an id that still resolves, which is how a "signed out"
// admin turns out not to be.
function store_session_end(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'],
        ]);
    }
    session_destroy();
}

// Who is signed in, or null — and the ONE place a session's age is judged.
//
// It has to be one place. The first version put the expiry inside
// store_require_admin(), which every data route calls; ?r=me does not, because
// it has to answer before anyone is signed in. So a session nine hours idle
// still answered "signed in", the dashboard rendered, and then every panel on
// it 401'd — an expiry that reported itself as eight broken screens. Both
// callers come through here now.
//
// Expiry is ours rather than PHP's garbage collector's, because that collector
// is shared hosting's to configure: its lifetime is whatever the host set, it
// only runs probabilistically, and it cannot tell an idle session from an old
// one. Two clocks, both ours — idle, and absolute.
function store_session_admin(): ?array {
    store_session_start();
    if (empty($_SESSION['admin_id'])) return null;
    $now = time();
    $started = (int) ($_SESSION['started_at'] ?? $now);
    $seen    = (int) ($_SESSION['seen_at'] ?? $now);
    if ($now - $seen > STORE_ADMIN_IDLE_SECONDS
        || $now - $started > STORE_ADMIN_ABSOLUTE_SECONDS) {
        store_session_end();
        return null;
    }
    $_SESSION['seen_at'] = $now;
    return ['id' => (int)$_SESSION['admin_id'], 'email' => $_SESSION['admin_email'] ?? ''];
}

// Every admin DATA route calls this first. 401, not a redirect: the caller is
// the React admin, and JSON is what it can act on.
function store_require_admin(): array {
    $who = store_session_admin();
    if ($who === null) store_fail('not_signed_in', 401);
    // SameSite=Strict stops the cookie travelling cross-site; this header stops
    // the residual cases (old browsers, subdomain surprises). The React admin
    // always sends it; nothing else has a reason to.
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    return $who;
}

// Login with per-account throttling kept in the database, not the session —
// an attacker does not keep your session for you. Five failures lock the
// account for fifteen minutes; the lock releases itself.
function store_login(string $email, string $password): array {
    $db = store_db();

    // Nobody has been created yet. Answering "wrong email or password" here is
    // technically true and completely useless: the owner types the password
    // they meant to set, is told it is wrong, and goes looking for a typo that
    // does not exist. Say what is actually missing instead.
    //
    // This leaks only that the shop has no admin yet — which an empty
    // catalogue already announces — and it cannot enumerate accounts, because
    // it can only ever fire when the table holds NONE.
    if ((int)$db->query('select count(*) from admin_users')->fetchColumn() === 0) {
        store_fail('no_admin_account', 409);
    }

    $q = $db->prepare('select id, email, password_hash, failed_attempts, locked_until from admin_users where email = ?');
    $q->execute([mb_strtolower(trim($email))]);
    $u = $q->fetch();

    if ($u && $u['locked_until'] !== null && strtotime($u['locked_until']) > time()) {
        store_fail('locked', 429);
    }

    // password_verify runs even for an unknown email (against a throwaway
    // hash), so a missing account and a wrong password take the same time.
    $hash = $u['password_hash'] ?? password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    if (!$u || !password_verify($password, $hash)) {
        if ($u) {
            $fails = (int)$u['failed_attempts'] + 1;
            $db->prepare('update admin_users set failed_attempts = ?, locked_until = ? where id = ?')
               ->execute([$fails, $fails >= 5 ? date('Y-m-d H:i:s', time() + 900) : null, $u['id']]);
        }
        store_fail('bad_credentials', 401);
    }

    $db->prepare('update admin_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ?')
       ->execute([$u['id']]);

    store_session_start();
    session_regenerate_id(true); // a fresh id on privilege change, always
    $_SESSION['admin_id'] = (int)$u['id'];
    $_SESSION['admin_email'] = $u['email'];
    $_SESSION['started_at'] = time();
    $_SESSION['seen_at'] = time();
    return ['id' => (int)$u['id'], 'email' => $u['email']];
}

// ---------------------------------------------------------------- settings
//
// Small named pieces of configuration the owner edits without a deploy: the
// slider's speed and size, the promo bar's text. Stored as JSON in one table
// so adding a setting is an INSERT, not a migration on a live shop.
//
// Reads are cached per request. api.php?r=slides asks for two of these and the
// home page asks for the same two again on the next request; there is no
// reason for either to hit the table twice.
function store_settings(PDO $db): array {
    static $all = null;
    if ($all === null) {
        $all = [];
        foreach ($db->query('select name, value from settings') as $row) {
            $decoded = json_decode((string)$row['value'], true);
            $all[$row['name']] = is_array($decoded) ? $decoded : [];
        }
    }
    return $all;
}

// One setting, merged over its defaults.
//
// The defaults live in PHP as well as in the seed row, and that is deliberate:
// a shop that imported schema.mysql.sql before this feature has no row at all,
// and a home page that renders nothing because a SELECT missed is a worse
// outcome than a home page that renders the values it shipped with.
const STORE_SETTING_DEFAULTS = [
    'hero'      => ['speed_ms' => 6500, 'shuffle' => false, 'size' => 'tall', 'autoplay' => true],
    'promo_bar' => ['enabled' => false, 'text_en' => '', 'text_ar' => '', 'href' => '',
                    'starts_at' => null, 'ends_at' => null],
];

function store_setting(PDO $db, string $name): array {
    return array_merge(STORE_SETTING_DEFAULTS[$name] ?? [], store_settings($db)[$name] ?? []);
}

function store_setting_save(PDO $db, string $name, array $value): void {
    $db->prepare('insert into settings (name, value) values (?, ?)
                  on duplicate key update value = values(value)')
       ->execute([$name, json_encode($value, JSON_UNESCAPED_UNICODE)]);
}

// Is a dated window open right now? Either end may be null, meaning "no bound".
// Everything is compared in the database's own clock via gmdate, the same
// clock paid_at and created_at are written with, so a promotion cannot appear
// to start an hour early because PHP and MySQL disagree about the timezone.
function store_window_open(?string $starts, ?string $ends, ?string $now = null): bool {
    $now = $now ?? gmdate('Y-m-d H:i:s');
    if ($starts !== null && $starts !== '' && $starts > $now) return false;
    if ($ends   !== null && $ends   !== '' && $ends   < $now) return false;
    return true;
}

// ------------------------------------------------------------------- pricing
//
// THE price of a product right now, in integer fils.
//
// A sale price only counts inside its window and only if it is actually lower.
// Both guards matter: an expired sale that still applied would be a permanent
// unannounced discount, and a "sale" above the list price would quietly
// overcharge — the kind of mistake nobody reports because the customer just
// leaves. When either is true, the list price wins.
//
// Fils, not floats. KWD has exactly three decimals, so 10.000 KWD is 10000
// fils and integer arithmetic is exact. This is the same rule create_order
// already followed for line totals; percentages make it matter more, not less.
function store_fils(string|float|null $kwd): int {
    return (int)round(((float)$kwd) * 1000);
}

function store_kwd(int $fils): string {
    return number_format($fils / 1000, 3, '.', '');
}

function store_effective_price(array $product, ?string $now = null): array {
    $list = store_fils($product['price'] ?? 0);
    $sale = isset($product['sale_price']) && $product['sale_price'] !== null
        ? store_fils($product['sale_price'])
        : null;
    $on = $sale !== null
        && $sale > 0
        && $sale < $list
        && store_window_open($product['sale_starts_at'] ?? null, $product['sale_ends_at'] ?? null, $now);
    return ['fils' => $on ? $sale : $list, 'list_fils' => $list, 'on_sale' => $on];
}

// ----------------------------------------------------------------- discounts
//
// Everything below runs on the SERVER, from rows the browser cannot touch.
// The browser may name a code; it may never name an amount. That is the same
// rule that governs product prices, and it is load-bearing in exactly the same
// way: /pay/pay.php charges orders.amount, so anything that can move
// orders.amount can move what the bank collects.
//
// Order of application, fixed and documented because "which discount wins" is
// the question every shop eventually gets asked:
//   1. every qualifying AUTOMATIC rule, best first
//   2. then at most ONE typed code
//   3. the total is capped at STORE_DISCOUNT_MAX_PCT of the subtotal
// The cap is the backstop against a stacking mistake being a free order.
const STORE_DISCOUNT_MAX_PCT = 60;

// What one rule takes off, in fils. `$eligibleFils` is the part of the order
// the rule may act on — the whole subtotal, or just one category's lines.
function store_discount_amount(array $d, int $eligibleFils): int {
    if ($eligibleFils <= 0) return 0;
    $off = $d['type'] === 'percent'
        // intdiv, so a percentage of an odd number of fils rounds DOWN and the
        // shop never gives away a fil it did not mean to.
        ? intdiv($eligibleFils * (int)round((float)$d['value']), 100)
        : store_fils($d['value']);
    return max(0, min($off, $eligibleFils));
}

// Every live rule, with the typed code (if any) resolved.
//
// Returns ['applied' => [...], 'total_fils' => int, 'error' => ?string]. An
// unusable code is reported, never silently ignored: a customer who typed
// SAVE10 and was charged full price will not assume they mistyped, they will
// assume the shop cheated them.
function store_discounts_for(PDO $db, array $lines, int $subtotalFils, ?string $code): array {
    $now = gmdate('Y-m-d H:i:s');
    $applied = [];
    $error = null;

    // How much of this order sits in each category, so a category-restricted
    // rule acts on its own lines only.
    $byCategory = [];
    foreach ($lines as $l) {
        $cat = (string)($l['category'] ?? '');
        $byCategory[$cat] = ($byCategory[$cat] ?? 0) + $l['line_fils'];
    }
    $eligible = function (?string $cat) use ($subtotalFils, $byCategory): int {
        return ($cat === null || $cat === '') ? $subtotalFils : ($byCategory[$cat] ?? 0);
    };

    $usable = function (array $d) use ($now, $subtotalFils, $eligible): ?string {
        if (!(int)$d['active'])                                        return 'discount_inactive';
        if (!store_window_open($d['starts_at'], $d['ends_at'], $now))  return 'discount_expired';
        if ((int)$d['usage_limit'] > 0
            && (int)$d['used_count'] >= (int)$d['usage_limit'])        return 'discount_used_up';
        if ($subtotalFils < store_fils($d['min_order']))               return 'discount_min_order';
        if ($eligible($d['category']) <= 0)                            return 'discount_not_applicable';
        return null;
    };

    // 1. automatic rules — best first, so if two apply the customer gets the
    //    better one at the front and the cap (if it bites) trims the weaker.
    $autos = $db->query("select * from discounts where kind = 'auto' and active = 1")->fetchAll();
    $scored = [];
    foreach ($autos as $d) {
        if ($usable($d) !== null) continue;
        $off = store_discount_amount($d, $eligible($d['category']));
        if ($off > 0) $scored[] = ['d' => $d, 'off' => $off];
    }
    usort($scored, fn ($a, $b) => $b['off'] <=> $a['off']);
    foreach ($scored as $s) {
        $applied[] = ['id' => (int)$s['d']['id'], 'code' => null, 'label' => $s['d']['label'],
                      'fils' => $s['off']];
    }

    // 2. one typed code
    $code = strtoupper(trim((string)$code));
    if ($code !== '') {
        $q = $db->prepare("select * from discounts where kind = 'code' and code = ?");
        $q->execute([$code]);
        $d = $q->fetch();
        if (!$d) {
            $error = 'discount_unknown';
        } elseif (($why = $usable($d)) !== null) {
            $error = $why;
        } else {
            $off = store_discount_amount($d, $eligible($d['category']));
            if ($off <= 0) $error = 'discount_not_applicable';
            else $applied[] = ['id' => (int)$d['id'], 'code' => $d['code'], 'label' => $d['label'],
                               'fils' => $off];
        }
    }

    // 3. the cap. Trimmed from the LAST rule backwards so the first (best)
    //    discount survives intact and the customer sees the one they were
    //    promised, not two halves of two.
    $cap = intdiv($subtotalFils * STORE_DISCOUNT_MAX_PCT, 100);
    $total = array_sum(array_column($applied, 'fils'));
    for ($i = count($applied) - 1; $i >= 0 && $total > $cap; $i--) {
        $trim = min($applied[$i]['fils'], $total - $cap);
        $applied[$i]['fils'] -= $trim;
        $total -= $trim;
    }
    $applied = array_values(array_filter($applied, fn ($a) => $a['fils'] > 0));

    return ['applied' => $applied, 'total_fils' => array_sum(array_column($applied, 'fils')),
            'error' => $error];
}

// Claim the usage slots, inside the order's own transaction.
//
// The guarded UPDATE is the whole point: `used_count < usage_limit` in the
// WHERE means two simultaneous checkouts cannot both take the last use of a
// one-per-shop code. If the claim does not land, the caller must fail the
// order rather than honour a discount that is gone — a code that can be used
// twice is a code that can be used a thousand times.
function store_discounts_claim(PDO $db, array $applied): bool {
    // Prepared once, executed per rule — the same shape store_price_lines()
    // uses for the cart. Re-preparing identical SQL inside a loop is a round
    // trip per iteration for nothing.
    $st = $db->prepare(
        'update discounts set used_count = used_count + 1
          where id = ? and (usage_limit = 0 or used_count < usage_limit)'
    );
    foreach ($applied as $a) {
        $st->execute([$a['id']]);
        if ($st->rowCount() !== 1) return false;
    }
    return true;
}

// ------------------------------------------------------------- pricing a cart
//
// Turn the browser's items into priced lines. ONE implementation, used by both
// create_order and the discount preview — a preview computed by different code
// from the charge is a preview that can promise a total the checkout refuses,
// and the customer sees the shop change its price at the last step.
//
// Every line is validated before anything is written, so a bad cart is
// rejected with the token naming the problem rather than a rolled-back
// mystery. The unit price is the EFFECTIVE price (a live sale, else the list
// price), read from the table at this instant. Nothing the browser sent has
// been near it.
function store_price_lines(PDO $db, array $items): array {
    $lines = [];
    $q = $db->prepare(
        'select id, price, sale_price, sale_starts_at, sale_ends_at, category
           from products where slug = ? and active = 1'
    );
    foreach ($items as $item) {
        $qty = (int)($item['qty'] ?? 1);
        if ($qty < 1 || $qty > 99) store_fail('invalid_qty');

        $size = strtoupper(trim((string)($item['size'] ?? '')));
        $fit  = strtolower(trim((string)($item['fit'] ?? '')));
        // Rejected, never silently dropped — a dropped size is an order that
        // looks complete and does not say which size to pack.
        if ($size !== '' && !in_array($size, STORE_SIZES, true)) store_fail('invalid_size');
        if ($fit  !== '' && !in_array($fit,  STORE_FITS,  true)) store_fail('invalid_fit');

        $q->execute([(string)($item['slug'] ?? '')]);
        $prod = $q->fetch();
        if (!$prod) store_fail('unavailable_' . (string)($item['slug'] ?? '?'));

        // A SIZE IS REQUIRED EXACTLY WHEN THE PRODUCT HAS SIZES.
        //
        // The comment four lines up says a dropped size is "an order that
        // looks complete and does not say which size to pack" — and then an
        // ABSENT size was accepted, because only an invalid one was rejected.
        // The browser's size ladder is what enforced it, which makes the rule
        // a front-end convention rather than a rule: anything posting
        // straight to /api could book a t-shirt with no size, and the
        // warehouse would get an order it cannot fill.
        //
        // Conditional on the catalogue, not hard-coded, because it has to
        // stay true for both halves of it. Nineteen active products — a
        // backpack, a cap, a phone strap — have no size rows at all and must
        // remain orderable without one. So the question asked is the only one
        // that means anything: does THIS product have sizes, and did the order
        // name one?
        if ($size === '') {
            $hasSizes = $db->prepare('select 1 from product_variants where slug = ? limit 1');
            $hasSizes->execute([(string)($item['slug'] ?? '')]);
            if ($hasSizes->fetchColumn()) store_fail('size_required_' . (string)($item['slug'] ?? '?'));
        }

        $eff = store_effective_price($prod);
        $lines[] = [
            'product_id' => (int)$prod['id'],
            'qty'        => $qty,
            'unit_price' => store_kwd($eff['fils']),
            'unit_fils'  => $eff['fils'],
            'line_fils'  => $eff['fils'] * $qty,
            'category'   => $prod['category'],
            'size'       => $size === '' ? null : $size,
            'fit'        => $fit  === '' ? null : $fit,
        ];
    }
    return $lines;
}

// A datetime from the admin's <input type="datetime-local">, or null.
//
// The browser sends "2026-08-14T18:00" with no zone. The whole system compares
// against gmdate(), so the value is stored verbatim as UTC and the admin form
// says so — the alternative is guessing a timezone, and a promotion that
// starts three hours early because the server disagreed with the browser is a
// bug nobody can see until a customer gets a price nobody meant to offer.
function store_datetime(?string $raw): ?string {
    $v = trim((string)$raw);
    if ($v === '') return null;
    $v = str_replace('T', ' ', $v);
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $v)) store_fail('invalid_date');
    return strlen($v) === 16 ? $v . ':00' : $v;
}

// A link the admin may point a hero button or the promo bar at.
//
// SAME ORIGIN ONLY. These are the most prominent links on the site, rendered
// inside the shop's own design, so an off-site URL here would be the brand
// lending its credibility to somewhere else — and a "javascript:" or "data:"
// one would be script execution from a form field. A path, or nothing.
function store_internal_href(?string $raw): ?string {
    $v = trim((string)$raw);
    if ($v === '') return null;
    // A LEADING DOUBLE SLASH IS NOT A PATH, IT IS A HOSTNAME. //evil.com is a
    // protocol-relative URL: the browser reads it as https://evil.com and
    // leaves the shop. It starts with / and contains only characters from the
    // list below, so the original pattern accepted it — a function whose only
    // job is "same-origin paths" handing back an off-site link.
    //
    // It takes an admin session to set one, so this is not an open door; it is
    // the difference between one compromised login and a phishing page that
    // real customers reach by clicking the hero button on sporta.com.kw. A
    // link that leaves the site should never be spellable here at all.
    //
    // Backslash was already refused by the character list, which matters more
    // than it used to: react-router treats a backslash the way browsers do
    // (CVE-2025-68470 and its bypass), so \\evil.com is the same trick in
    // different punctuation. Both are now refused explicitly.
    if (!preg_match('#^/(?![/\\\\])[A-Za-z0-9/_\-\?=&%\.]{0,180}$#', $v)) store_fail('invalid_link');
    return $v;
}
