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

$r = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db = store_db();

// ---------------------------------------------------------------- throttling
// This file had NONE, and the login lockout is not a substitute for it.
//
// That lockout is PER ACCOUNT — five failures freeze one email for fifteen
// minutes. It says nothing about an attacker who sprays one guess across a
// hundred addresses, or who simply hammers ?r=me (unauthenticated, and it runs
// a count over admin_users on every call). Neither is slowed by an account
// lock, and both are free database load on shared hosting.
//
// The ceiling is deliberately high. An admin opening the dashboard fires a
// dozen requests before they have touched anything — stats, revenue, orders,
// items, products — and a limit that interrupts real work is one that gets
// removed. This is a bound on machines, not on people.
//
// IT WAS 240 A MINUTE, AND THAT WAS NOT HIGH ENOUGH. Measured: signing in and
// clicking through every screen of the panel costs about 24 requests, so 240
// looks like ten times the headroom one person needs. Two things spend it much
// faster than that.
//
// The Stock screen saves one request per size row. The catalogue has 120 size
// rows waiting for counts to be typed into it, and an owner working through
// them steadily reaches 240 partway down the list — then the panel starts
// refusing saves, in the middle of a job, with no way to tell that from a
// broken server.
//
// And the counter is per IP, so everyone in the office shares one allowance.
// Two people on the panel at once each get half of it.
//
// 1200 is five minutes of one person working flat out, or twenty minutes of
// normal use, and it is still four hundred times what any human types. It
// bounds a script, which is all it was ever for; the thing that actually
// protects the password is the per-account lockout in store_login(), and that
// is untouched.
//
// Failed LOGINS are counted separately and inside store_login(), on the
// failure path only: a signed-in admin reloading their screen is not guessing,
// and the same distinction the discount route makes applies here.
store_throttle($db, 'admin', 1200, 60);

// ------------------------------------------------------------- sign-in log
// Every attempt at the admin door, with address and country — see
// store_admin_login_log(). One hook for all the doors: it reads back what was
// answered, so the doors themselves are untouched.
const ADMIN_LOGIN_ROUTES = [
    'login' => 'password', 'login_code' => 'code', 'google_login' => 'google', 'apple_login' => 'apple',
    'passcode_unlock' => 'passcode', 'password_reset_confirm' => 'reset', 'passkey_login' => 'passkey',
];
require_once __DIR__ . '/security.php';   // sessions, passkeys, policies, breached passwords (2026-10-04)
if ($method === 'POST' && isset(ADMIN_LOGIN_ROUTES[$r])) {
    ob_start();
    register_shutdown_function(function () use ($db, $r) {
        $body = (string) ob_get_clean();
        echo $body;
        // The browser gets its answer first; the lookup below can take a moment.
        if (function_exists('fastcgi_finish_request')) { @fastcgi_finish_request(); } else { @flush(); }
        $code = http_response_code();
        $j = json_decode($body, true);
        if (!is_array($j)) return;
        $result = $code >= 200 && $code < 300 ? (!empty($j['need_code']) ? 'code_needed' : 'ok') : (string) ($j['error'] ?? ('http_' . $code));
        $in = store_body();
        $email = isset($in['email']) ? strtolower(trim((string) $in['email'])) : null;
        $adminId = null;
        if (session_status() === PHP_SESSION_ACTIVE) {
            $adminId = (int) ($_SESSION['admin_id'] ?? $_SESSION['pending_admin_id'] ?? 0) ?: null;
            if ($email === null && !empty($_SESSION['admin_email'])) $email = (string) $_SESSION['admin_email'];
        }
        if ($adminId === null && $email) {
            $q = $db->prepare('select id from admin_users where email = ?');
            $q->execute([$email]);
            $adminId = (int) $q->fetchColumn() ?: null;
        }
        if ($adminId !== null && $email === null) {
            $q = $db->prepare('select email from admin_users where id = ?');
            $q->execute([$adminId]);
            $email = (string) $q->fetchColumn() ?: null;
        }
        store_admin_login_log($db, ADMIN_LOGIN_ROUTES[$r], $result, $adminId, $email);
    });
}

// ------------------------------------------------------------------- session
if ($r === 'login' && $method === 'POST') {
    store_require_admin_header();
    sec_signin_ip_gate($db);
    $b = store_body();
    $who = store_login((string)($b['email'] ?? ''), (string)($b['password'] ?? ''));
    // need_code is the whole point of the answer when a second factor is
    // enrolled — without it the screen has no way to know it should ask, and
    // would sit there believing it had signed in while every route said 401.
    store_out([
        'email' => $who['email'],
        'need_code' => !empty($who['need_code']),
        // WHICH factor, and where it went. Without these the screen can only
        // say "enter your code" — which is the wrong instruction for half the
        // accounts, and useless for the owner staring at an authenticator app
        // they never installed while a code sits in their inbox.
        'code_via' => $who['code_via'] ?? null,
        'code_sent_to' => $who['code_sent_to'] ?? null,
        // FALSE MEANS THE MAIL DID NOT GO. Said out loud so the screen can
        // tell them, rather than asking for a code that was never sent.
        'code_sent' => $who['code_sent'] ?? null,
    ]);
}

// Create the FIRST admin account — and only ever the first.
//
// THE GAP THIS FILLS IS ONE THIS FILE ALREADY NAMED. Both `me` and
// store_login() count admin_users and answer no_admin_account (409) when it is
// empty, so the panel can say "this shop has no administrator yet" instead of
// telling the owner their correct password is wrong. Neither offered a way
// forward: the only way to make that first account was to hand-write a row,
// with a hash minted by php -r, which is what scripts/sandbox.sh still does.
// So the shop shipped a screen that diagnoses a problem it cannot fix.
//
// IT IS NOT A SIGN-UP, AND THE DIFFERENCE IS THE WHOLE DESIGN. An admin panel
// that lets a stranger create an administrator is not a feature, it is the
// door left open. This route can only ever fire while admin_users holds
// NOTHING — the moment one account exists it answers already_set_up, and does
// so forever. On this shop, which has an administrator, it is inert: it cannot
// add a second account and it cannot reach the first.
//
// Adding a COLLEAGUE is a different job with a different answer — it belongs
// behind the gate below, done by someone already signed in, and it is
// deliberately not this route.
//
// ONE AT A TIME. Two requests arriving together would both count zero and both
// insert, and the second would either collide with the unique index on email
// or quietly create a second administrator nobody asked for. A named lock
// serialises them; the loser sees already_set_up, which is the truth by then.
// MySQL frees the lock when the connection closes, so the exits below cannot
// strand it even though they skip the release.
if ($r === 'register' && $method === 'POST') {
    store_require_admin_header();
    // Twenty a quarter of an hour, and the number is chosen for what this
    // throttle actually defends. There is no secret here to guess: the route
    // holds no credential, and on a shop with an administrator every answer it
    // gives is already_set_up. What it defends is the narrow window while
    // admin_users is empty, and the lock below, against being hammered.
    //
    // Six was the first value and it was too mean twice over. A person setting
    // a shop up mistypes an address and picks a short password before they get
    // it right, and each of those spends an attempt — validation runs before
    // the count, deliberately. And the live rig makes four register calls per
    // run, so two runs inside the window failed on the throttle rather than on
    // anything real. A test that fails because it was run twice is a bad test.
    store_throttle($db, 'admin_register', 20, 900);
    $b = store_body();
    $email = mb_strtolower(trim((string)($b['email'] ?? '')));
    $pass  = (string)($b['password'] ?? '');

    if ($email === '' || mb_strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        store_fail('bad_email');
    }
    // TWELVE, because that is what changing a password already demands further
    // down this file. A floor lower at the door than in the corridor protects
    // nothing.
    sec_password_refuse($pass, $email);
    // Twelve characters proves nothing on its own — see store_password_is_weak().
    if (($weak = store_password_is_weak($pass, $email)) !== null) store_fail($weak);

    if ((int)$db->query("select get_lock('sporta_admin_register', 5)")->fetchColumn() !== 1) {
        store_fail('busy', 503);
    }
    if ((int)$db->query('select count(*) from admin_users')->fetchColumn() > 0) {
        $db->query("select release_lock('sporta_admin_register')");
        store_fail('already_set_up', 409);
    }
    $ins = $db->prepare('insert into admin_users (email, password_hash) values (?, ?)');
    $ins->execute([$email, password_hash($pass, PASSWORD_DEFAULT)]);
    $id = (int)$db->lastInsertId();
    $db->query("select release_lock('sporta_admin_register')");

    // Signed in immediately, through the SAME function both login paths end in,
    // so a newly made administrator and a returning one cannot drift into
    // different ideas of what a session is. They chose the password one line
    // ago; asking them to type it again proves nothing.
    store_admin_grant($db, ['id' => $id, 'email' => $email]);
    store_out(['email' => $email]);
}

// Send the emailed code again, while sign-in is half done.
//
// ABOVE THE GATE, like login_code, because there is no session yet — only the
// pending marker. It can therefore only ever mail the ONE account that marker
// names, and only to the address already on that account: it is not a route
// that sends mail to an address of the caller's choosing.
if ($r === 'login_code_resend' && $method === 'POST') {
    store_require_admin_header();
    store_session_start();
    $id = (int)($_SESSION['pending_admin_id'] ?? 0);
    $since = (int)($_SESSION['pending_at'] ?? 0);
    if ($id === 0 || (string)($_SESSION['pending_via'] ?? '') !== 'email'
        || time() - $since > STORE_EMAIL_OTP_SECONDS) {
        store_fail('code_expired', 401);
    }
    $q = $db->prepare('select id, email, email_otp_enabled, email_otp_sent_at
                         from admin_users where id = ?');
    $q->execute([$id]);
    $u = $q->fetch();
    if (!$u || (int)$u['email_otp_enabled'] !== 1) store_fail('code_expired', 401);
    // One a minute, from the row itself rather than a counter that a new
    // session would reset. Also throttled per IP, because the row is per
    // account and a spray is per address.
    if ($u['email_otp_sent_at'] !== null
        && time() - strtotime((string)$u['email_otp_sent_at']) < STORE_EMAIL_OTP_RESEND_SECONDS) {
        store_fail('too_soon', 429);
    }
    store_throttle($db, 'otp_send', 6, 900);
    $code = store_email_otp_issue($db, $u);
    store_out(['sent' => store_email_otp_send($u, $code),
               'to' => store_mask_email((string)$u['email'])]);
}

// Step two of sign-in. Above the gate on purpose: there is no session yet, only
// the pending marker store_login() left, and that marker is worth nothing on
// its own — it names an account and expires in five minutes.
if ($r === 'login_code' && $method === 'POST') {
    store_require_admin_header();
    $b = store_body();
    $who = store_login_code((string)($b['code'] ?? ''));
    store_out(['email' => $who['email']]);
}

// ------------------------------------------------------------ Google sign-in
//
// BOTH OF THESE ARE ABOVE THE GATE, and they have to be: the whole point is to
// be reachable by somebody who is not signed in yet.
//
// `google_config` answers before any sign-in because the LOGIN SCREEN needs the
// client id to draw the button at all. That is not a leak — the client id is
// compiled into every page that uses Google sign-in anywhere on the web, and it
// is useless without a token Google will only mint for this origin. The SECRET
// half of Google sign-in does not exist in this flow; there is nothing here to
// withhold. It deliberately returns nothing else about the shop.
if ($r === 'google_config') {
    store_require_admin_header();
    $cfg = store_setting($db, 'google_auth');
    $id = trim((string)($cfg['client_id'] ?? ''));
    store_out([
        // ENABLED MEANS BOTH, so a half-configured shop draws no button rather
        // than one that fails when pressed.
        'enabled'   => $id !== '' && !empty($cfg['enabled']),
        'client_id' => $id === '' ? null : $id,
    ]);
}

// The token comes back to us and is verified HERE. Nothing the browser says
// about who it is survives past store_google_verify(); the only thing that
// signs anyone in is Google's signature over claims naming this client id.
if ($r === 'google_login' && $method === 'POST') {
    sec_signin_ip_gate($db);
    store_require_admin_header();
    $b = store_body();
    $who = store_google_login((string)($b['credential'] ?? ''));
    // The SAME shape as ?r=login, because the screen after it is the same
    // screen: an account with a second factor still has to prove it, and a
    // caller that treated these two answers differently would skip that step
    // for exactly the accounts that asked for it.
    store_out([
        'email'        => $who['email'],
        'need_code'    => !empty($who['need_code']),
        'code_via'     => $who['code_via'] ?? null,
        'code_sent_to' => $who['code_sent_to'] ?? null,
    ]);
}

// Saving the client id. BELOW the two routes above and deliberately different:
// reading the id is public because the login screen needs it, writing it is not
// — anyone who could set it could point the shop's sign-in at their own Google
// project and let their own accounts in. So this one goes through the gate like
// every other save.
//
// It is a WRITE only. Reading happens through `google_config` above, because a
// save with an empty body as a read would mean opening the settings screen
// rewrites the row — and a panel opened and closed would look, in any audit,
// like somebody deliberately changed the shop's sign-in.
if ($r === 'google_save' && $method === 'POST') {
    store_require_admin();
    $b = store_body();
    $id = trim((string)($b['client_id'] ?? ''));
    // Google's own format. Checked so a pasted mistake fails HERE, with a
    // message, rather than as a button that draws and then refuses everyone.
    if ($id !== '' && !preg_match('/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/', $id)) {
        store_fail('bad_client_id');
    }
    store_setting_save($db, 'google_auth', [
        'client_id' => $id,
        // An empty id cannot be enabled: that is the state that draws a button
        // which fails when pressed.
        'enabled'   => $id !== '' && !empty($b['enabled']),
    ]);
    $cfg = store_setting($db, 'google_auth');
    store_out(['client_id' => $cfg['client_id'], 'enabled' => !empty($cfg['enabled'])]);
}

// ------------------------------------------------------------- Apple sign-in
//
// SAME SHAPE AS GOOGLE'S, DELIBERATELY: read-side above the gate because the
// login screen needs the client id to draw a button before anyone is signed
// in; the token verified server-side and nothing the browser says about who
// it is survives past store_apple_verify(); the write gated because anyone
// who could set it could point sign-in at their own Apple project.
if ($r === 'apple_config') {
    store_require_admin_header();
    $cfg = store_setting($db, 'apple_auth');
    $id = trim((string)($cfg['client_id'] ?? ''));
    store_out([
        'enabled'   => $id !== '' && !empty($cfg['enabled']),
        'client_id' => $id === '' ? null : $id,
    ]);
}

if ($r === 'apple_login' && $method === 'POST') {
    sec_signin_ip_gate($db);
    store_require_admin_header();
    $b = store_body();
    $who = store_apple_login((string)($b['id_token'] ?? ''));
    store_out([
        'email'        => $who['email'],
        'need_code'    => !empty($who['need_code']),
        'code_via'     => $who['code_via'] ?? null,
        'code_sent_to' => $who['code_sent_to'] ?? null,
    ]);
}

if ($r === 'apple_save' && $method === 'POST') {
    store_require_admin();
    $b = store_body();
    $id = trim((string)($b['client_id'] ?? ''));
    // Apple's Services ID is a reverse-DNS-shaped identifier, e.g.
    // com.sporta.web.signin — lowercase letters, digits and hyphens, at least
    // one dot. Checked so a pasted mistake fails HERE rather than as a button
    // that draws and then refuses everyone.
    if ($id !== '' && !preg_match('/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i', $id)) {
        store_fail('bad_client_id');
    }
    store_setting_save($db, 'apple_auth', [
        'client_id' => $id,
        'enabled'   => $id !== '' && !empty($b['enabled']),
    ]);
    $cfg = store_setting($db, 'apple_auth');
    store_out(['client_id' => $cfg['client_id'], 'enabled' => !empty($cfg['enabled'])]);
}

// ========================================================= reset by email
//
// A FORGOTTEN PASSWORD, ANSWERED BY THE MAILBOX. Asks for an address, emails an
// 8-digit code (no link: a sign-in mail that carries a link is a phishing
// lesson, and this shop's other mails say so), and the code plus a new password
// set it. What holds it:
//   - the answer to the request is IDENTICAL whether or not the address has an
//     admin account, so the route cannot be used to list who runs the shop;
//   - the code is random, stored only as a hash, expires in 15 minutes, and is
//     burned by five wrong tries; one live code per account, re-requests are
//     spaced a minute apart;
//   - it proves the MAILBOX and nothing more: an account with a second factor
//     still has to pass it at sign-in, so a reset never signs anybody in;
//   - the new password meets the same rules as every other door (12+ characters,
//     not a common one), every trusted passcode device is removed, and the
//     owner is told by email that it happened.
const RESET_MINUTES = 15;
const RESET_MAX_TRIES = 5;

if ($r === 'password_reset_request' && $method === 'POST') {
    store_require_admin_header();
    store_throttle($db, 'admin_pw_reset', 6, 900);
    $b = store_body();
    $email = strtolower(trim((string) ($b['email'] ?? '')));
    if ($email !== '' && strlen($email) <= 190) {
        try {
            $q = $db->prepare('select id, email from admin_users where email = ?');
            $q->execute([$email]);
            $u = $q->fetch();
            if ($u) {
                $last = $db->prepare('select created_at from admin_password_resets where admin_id = ? and created_at > now() - interval 60 second');
                $last->execute([$u['id']]);
                if (!$last->fetchColumn()) {
                    $code = str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
                    $db->prepare('replace into admin_password_resets (admin_id, code_hash, attempts, expires_at) values (?,?,0,?)')
                       ->execute([$u['id'], password_hash($code, PASSWORD_DEFAULT), date('Y-m-d H:i:s', time() + RESET_MINUTES * 60)]);
                    $text = "Your Sporta panel password reset code is {$code}.\n\n"
                          . "It works once and expires in " . RESET_MINUTES . " minutes.\n"
                          . "If you did not ask for it, ignore this email — your password has not changed.\n\n"
                          . "رمز إعادة تعيين كلمة مرور لوحة سبورتا: {$code}\n"
                          . "صالح لمرة واحدة ولمدة " . RESET_MINUTES . " دقيقة. إن لم تطلبه فتجاهل الرسالة.";
                    $html = str_replace("\n", '<br>', '<p style="font:16px system-ui">' . htmlspecialchars($text, ENT_QUOTES, 'UTF-8') . '</p>');
                    store_send_mail(store_config(), (string) $u['email'], 'Sporta — password reset code / رمز إعادة التعيين', $text, $html);
                }
            }
        } catch (Throwable $e) { error_log('admin reset request: ' . $e->getMessage()); }
    }
    store_out(['ok' => true]);
}

if ($r === 'password_reset_confirm' && $method === 'POST') {
    store_require_admin_header();
    store_throttle($db, 'admin_pw_reset_confirm', 20, 900);
    $b = store_body();
    $email = strtolower(trim((string) ($b['email'] ?? '')));
    $code = preg_replace('/\D/', '', (string) ($b['code'] ?? ''));
    $new = (string) ($b['password'] ?? '');
    $refuse = static fn () => store_fail('reset_refused', 401);

    try {
        $q = $db->prepare('select u.id, u.email, r.code_hash, r.attempts, r.expires_at
                             from admin_users u join admin_password_resets r on r.admin_id = u.id where u.email = ?');
        $q->execute([$email]);
        $row = $q->fetch();
    } catch (Throwable $e) { $row = false; }
    if (!$row || strlen($code) !== 8 || strtotime((string) $row['expires_at']) < time() || (int) $row['attempts'] >= RESET_MAX_TRIES) {
        if ($row && (strtotime((string) $row['expires_at']) < time() || (int) $row['attempts'] >= RESET_MAX_TRIES)) {
            $db->prepare('delete from admin_password_resets where admin_id = ?')->execute([$row['id']]);
        }
        $refuse();
    }
    if (!password_verify($code, (string) $row['code_hash'])) {
        $db->prepare('update admin_password_resets set attempts = attempts + 1 where admin_id = ?')->execute([$row['id']]);
        $refuse();
    }
    // The code is right; now the password. A refusal here does NOT burn the code,
    // so a too-short first try does not cost the owner their reset.
    if (!hash_equals($new, (string) ($b['password2'] ?? ''))) store_fail('password_mismatch');
    sec_password_refuse($new, (string) $row['email']);

    $db->prepare('update admin_users set password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = null where id = ?')
       ->execute([password_hash($new, PASSWORD_DEFAULT), $row['id']]);
    $db->prepare('delete from admin_password_resets where admin_id = ?')->execute([$row['id']]);
    try { $db->prepare('delete from admin_devices where admin_id = ?')->execute([$row['id']]); } catch (Throwable $e) {}
    $note = "The password for your Sporta panel account was just changed using an email reset code.\n"
          . "If this was not you, reset it again now and check who has access to your mailbox.\n\n"
          . "تم تغيير كلمة مرور حسابك في لوحة سبورتا للتو برمز إعادة التعيين. إن لم تكن أنت، أعد التعيين فورًا.";
    store_send_mail(store_config(), (string) $row['email'], 'Sporta — your password was changed / تم تغيير كلمة المرور', $note,
        str_replace("\n", '<br>', '<p style="font:16px system-ui">' . htmlspecialchars($note, ENT_QUOTES, 'UTF-8') . '</p>'));
    store_out(['ok' => true]);
}

// ============================================================ passcode unlock
//
// A QUICK DOOR FOR A BROWSER THE OWNER ALREADY TRUSTED, NOT A SECOND PASSWORD.
// Sign in normally once — password and any second factor — and choose to trust
// this device; afterwards, when the session has timed out, a 6-digit passcode
// is enough on THAT browser. Every other browser still needs the password.
//
// What holds it: a random token in an HttpOnly, Secure, SameSite=Strict cookie
// (only ever set at enrolment, so shoppers never get one), stored here only as
// a SHA-256; the passcode itself as password_hash(); five wrong tries lock
// that device; the device expires (30 days rolling, 90 absolute); and a
// changed password deletes every device. Unlocking goes through
// store_admin_grant(), the same single place every sign-in ends in.
const PASSCODE_MAX_FAILS = 5;
const PASSCODE_ROLL_DAYS = 30;
const PASSCODE_ABS_DAYS  = 90;

/**
 * One social link, as the single https URL it will be stored as — or null if it is not a link
 * to that network. See the `social` branch of settings_save for why anything else is refused.
 *
 *   instagram   instagram.com/<name>      or a handle  (@sporta.kw, sporta.kw)
 *   snapchat    snapchat.com/add/<name>   or a username
 *   youtube     youtube.com/..., youtu.be/..., or an @handle
 *   tiktok      tiktok.com/@<name>        or a handle
 *   whatsapp    wa.me/<digits>, api.whatsapp.com/send?phone=<digits>, wa.link/<code>,
 *               or a bare number (an eight-digit Kuwaiti one gains 965)
 */
function admin_social_url(string $kind, string $raw): ?string
{
    $raw = trim($raw);
    if (mb_strlen($raw) > 200 || preg_match('/[\s<>"\'\\]/u', $raw)) return null;

    $hosts = [
        'instagram' => ['instagram.com', 'www.instagram.com'],
        'snapchat'  => ['snapchat.com', 'www.snapchat.com'],
        'youtube'   => ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
        'tiktok'    => ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'],
        'whatsapp'  => ['wa.me', 'api.whatsapp.com', 'wa.link', 'whatsapp.com', 'www.whatsapp.com', 'chat.whatsapp.com'],
    ];

    // A full link: https only, no credentials in it, and the host must be the network's.
    // WHAT COUNTS AS "A LINK" AND NOT "A HANDLE". A handle may itself contain a dot — sporta.kw is
    // the shop's own — so "looks like a domain" cannot be the test: sporta.kw would be read as a
    // site in Kuwait's domain and refused. It is a link only if it has a scheme, starts with //,
    // or starts with one of the networks' own hosts; everything else is a handle, which must be
    // plain characters and so can never smuggle in a path or another host.
    $known = '(?:www\.|m\.)?(?:instagram|snapchat|youtube|tiktok)\.com|youtu\.be|vm\.tiktok\.com|wa\.me|wa\.link|api\.whatsapp\.com|(?:www\.|chat\.)?whatsapp\.com';
    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $raw) || str_starts_with($raw, '//') || preg_match('#^(?:' . $known . ')(?:/|$)#i', $raw)) {
        $u = str_contains($raw, '://') || str_starts_with($raw, '//') ? $raw : 'https://' . $raw;
        $p = parse_url($u);
        if (!$p || strtolower((string)($p['scheme'] ?? 'https')) !== 'https' || isset($p['user']) || isset($p['pass']) || isset($p['port'])) return null;
        $host = strtolower((string)($p['host'] ?? ''));
        if (!in_array($host, $hosts[$kind], true)) return null;
        $path = (string)($p['path'] ?? '');
        $q = isset($p['query']) && $p['query'] !== '' ? '?' . $p['query'] : '';
        if ($kind === 'whatsapp' && $host === 'wa.me') {
            $d = preg_replace('/\D/', '', $path);
            if (!preg_match('/^[1-9]\d{7,14}$/', $d)) return null;
            return 'https://wa.me/' . $d;
        }
        if ($path === '' || $path === '/') return null;       // the network's front page is not a profile
        // one spelling per network: instagram.com and www.instagram.com are the same page
        $canon = ['instagram.com' => 'www.instagram.com', 'snapchat.com' => 'www.snapchat.com',
                  'youtube.com' => 'www.youtube.com', 'tiktok.com' => 'www.tiktok.com'];
        return 'https://' . ($canon[$host] ?? $host) . $path . $q;
    }

    // A handle or a number.
    $h = ltrim($raw, '@');
    if ($kind === 'whatsapp') {
        $d = preg_replace('/\D/', '', store_ascii_digits($raw));
        if (str_starts_with($d, '00')) $d = substr($d, 2);
        if (strlen($d) === 8) $d = '965' . $d;
        return preg_match('/^[1-9]\d{7,14}$/', $d) ? 'https://wa.me/' . $d : null;
    }
    if (!preg_match('/^[A-Za-z0-9._-]{1,60}$/', $h)) return null;
    return match ($kind) {
        'instagram' => 'https://www.instagram.com/' . $h,
        'snapchat'  => 'https://www.snapchat.com/add/' . $h,
        'youtube'   => 'https://www.youtube.com/@' . $h,
        'tiktok'    => 'https://www.tiktok.com/@' . $h,
        default     => null,
    };
}

function passcode_cookie_name(): string {
    return store_is_https() ? '__Host-sporta_dev' : 'sporta_dev';
}
function passcode_cookie_token(): string {
    $t = (string) ($_COOKIE[passcode_cookie_name()] ?? '');
    return preg_match('/^[a-f0-9]{64}$/', $t) ? $t : '';
}
function passcode_set_cookie(string $token, int $expires): void {
    setcookie(passcode_cookie_name(), $token, [
        'expires' => $expires, 'path' => '/', 'secure' => store_is_https(),
        'httponly' => true, 'samesite' => 'Strict',
    ]);
}
function passcode_device(PDO $db, string $token): ?array {
    if ($token === '') return null;
    try {
        $q = $db->prepare('select * from admin_devices where token_hash = ? and expires_at > now()');
        $q->execute([hash('sha256', $token)]);
        $row = $q->fetch();
        return $row ?: null;
    } catch (Throwable $e) { return null; }   // table not migrated: no device
}
// Digits only, exactly six, and not one of the guesses everybody tries first.
function passcode_valid(string $p): bool {
    if (!preg_match('/^[0-9]{6}$/', $p)) return false;
    if (preg_match('/^(\d)\1{5}$/', $p)) return false;
    return !in_array($p, ['123456', '654321', '012345', '123123', '121212', '112233', '123321'], true);
}

if ($r === 'passcode_status') {
    store_require_admin_header();
    $dev = passcode_device($db, passcode_cookie_token());
    store_out([
        'trusted' => $dev !== null,
        'locked'  => $dev !== null && (int)$dev['failed'] >= PASSCODE_MAX_FAILS,
    ]);
}

if ($r === 'passcode_unlock' && $method === 'POST') {
    sec_signin_ip_gate($db);
    store_require_admin_header();
    store_throttle($db, 'admin_passcode', 30, 900);
    $b = store_body();
    $pass = (string) ($b['passcode'] ?? '');
    $dev = passcode_device($db, passcode_cookie_token());
    // One answer for no cookie, expired, unknown and wrong: the route must not
    // say which browsers are trusted.
    if ($dev === null || !preg_match('/^[0-9]{6}$/', $pass)) store_fail('passcode_refused', 401);
    if ((int)$dev['failed'] >= PASSCODE_MAX_FAILS) store_fail('passcode_locked', 423);
    if (!password_verify($pass, (string)$dev['pass_hash'])) {
        $db->prepare('update admin_devices set failed = failed + 1 where id = ?')->execute([$dev['id']]);
        if ((int)$dev['failed'] + 1 >= PASSCODE_MAX_FAILS) store_fail('passcode_locked', 423);
        store_fail('passcode_refused', 401);
    }
    $uq = $db->prepare('select id, email, locked_until from admin_users where id = ?');
    $uq->execute([$dev['admin_id']]);
    $u = $uq->fetch();
    if (!$u || ($u['locked_until'] !== null && strtotime($u['locked_until']) > time())) {
        store_fail('passcode_refused', 401);
    }
    $abs = strtotime((string)$dev['created_at']) + PASSCODE_ABS_DAYS * 86400;
    $exp = min($abs, time() + PASSCODE_ROLL_DAYS * 86400);
    $db->prepare('update admin_devices set failed = 0, last_used_at = now(), expires_at = ? where id = ?')
       ->execute([date('Y-m-d H:i:s', $exp), $dev['id']]);
    passcode_set_cookie(passcode_cookie_token(), $exp);
    store_admin_grant($db, ['id' => (int)$u['id'], 'email' => $u['email']]);
    store_out(['email' => $u['email']]);
}

// PASSKEYS — the two public halves (sign-in). The registration halves sit behind the gate below.
if ($r === 'passkey_options_login' && $method === 'POST') {
    store_require_admin_header();
    sec_signin_ip_gate($db);
    if (!sec_tables_ready($db)) store_fail('passkeys_not_ready', 503);
    store_throttle($db, 'passkey_options', 60, 300);
    store_out(sec_passkey_login_options($db));
}
if ($r === 'passkey_login' && $method === 'POST') {
    store_require_admin_header();
    sec_signin_ip_gate($db);
    if (!sec_tables_ready($db)) store_fail('passkeys_not_ready', 503);
    $u = sec_passkey_login($db, store_body());
    $hasTotp = (int)($u['totp_enabled'] ?? 0) === 1 && (string)($u['totp_secret'] ?? '') !== '';
    $hasEmail = !$hasTotp && (int)($u['email_otp_enabled'] ?? 0) === 1;
    if (!$u['uv'] && ($hasTotp || $hasEmail)) {
        // No biometric/PIN on this authenticator: it counts as the password did, so the second factor is asked.
        store_session_start(); session_regenerate_id(true);
        unset($_SESSION['admin_id'], $_SESSION['admin_email']);
        $_SESSION['pending_admin_id'] = (int)$u['id']; $_SESSION['pending_at'] = time(); $_SESSION['pending_via'] = $hasTotp ? 'totp' : 'email'; $_SESSION['pending_forced'] = false;
        $out = ['email' => $u['email'], 'need_code' => true, 'code_via' => $hasTotp ? 'totp' : 'email'];
        if ($hasEmail) { $code = store_email_otp_issue($db, $u); $out['code_sent_to'] = store_mask_email((string)$u['email']); $out['code_sent'] = store_email_otp_send($u, $code); }
        store_out($out);
    }
    store_admin_grant($db, $u, 'passkey');
    store_out(['email' => $u['email'], 'need_code' => false, 'via' => 'passkey']);
}

if ($r === 'logout' && $method === 'POST') {
    store_session_start();
    // Clears the cookie as well as the server-side session. Emptying $_SESSION
    // and calling session_destroy() left the browser holding an id — expired
    // server-side, but still sent on every request, and still the thing an
    // attacker with the cookie would replay against a session PHP had not yet
    // collected.
    store_session_end();
    store_out(['ok' => true]);
}

if ($r === 'me') {
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
    // The Security screen needs these two on the very first render, and asking
    // for them separately would mean a flash of "two-factor: off" on a shop
    // that has it on.
    $u = $db->prepare('select totp_enabled, phone, must_change_password from admin_users where id = ?');
    $u->execute([$who['id']]);
    $row = $u->fetch() ?: [];
    store_out([
        'email'   => $who['email'],
        'phone'   => $row['phone'] ?? null,
        'totp'    => (int)($row['totp_enabled'] ?? 0) === 1,
        // Told here, on the very first thing the panel asks after signing in,
        // so it can show the forced-change screen before trying — and
        // failing — every other route with 403 must_change_password.
        'must_change_password' => (int)($row['must_change_password'] ?? 0) === 1,
    ]);
}

// Everything below this line is an admin.
//
// `account` and `account_update` are let through even with must_change_password
// still set — they are the read and the write that CLEAR it, and a route that
// forces a password change but blocks the only route that changes one would
// lock the owner out of their own recovery.
$admin = store_require_admin(in_array($r, ['account', 'account_update'], true));

// ---- sign-in security (api/security.php, 2026-10-04): the signed-in half
if ($r === 'security_state') {
    $ready = sec_tables_ready($db);
    $pk = []; $sess = [];
    if ($ready) {
        $q = $db->prepare('select id, label, alg, transports, created_at, last_used_at from admin_passkeys where admin_id = ? order by id'); $q->execute([(int) $admin['id']]);
        foreach ($q->fetchAll() as $k) $pk[] = ['id' => (int) $k['id'], 'label' => $k['label'], 'alg' => (int) $k['alg'], 'transports' => $k['transports'], 'created_at' => $k['created_at'], 'last_used_at' => $k['last_used_at']];
        $sess = sec_sessions_list($db, (int) $admin['id']);
    }
    $uq = $db->prepare('select totp_enabled, email_otp_enabled from admin_users where id = ?'); $uq->execute([(int) $admin['id']]); $me = $uq->fetch() ?: [];
    $cfg = store_config();
    store_out(['ready' => $ready, 'passkeys' => $pk, 'sessions' => $sess, 'policy' => sec_policy($db), 'ip' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
               'mail_ready' => trim((string) ($cfg['mail_from'] ?? '')) !== '', 'totp' => !empty($me['totp_enabled']), 'email_otp' => !empty($me['email_otp_enabled']),
               'webauthn_rp' => sec_rp_id()]);
}
if ($r === 'passkey_options_register' && $method === 'POST') {
    if (!sec_tables_ready($db)) store_fail('passkeys_not_ready', 503);
    store_out(sec_passkey_register_options($db, $admin));
}
if ($r === 'passkey_register' && $method === 'POST') {
    if (!sec_tables_ready($db)) store_fail('passkeys_not_ready', 503);
    store_out(sec_passkey_register($db, $admin, store_body()));
}
if ($r === 'passkey_remove' && $method === 'POST') {
    if (!sec_tables_ready($db)) store_fail('passkeys_not_ready', 503);
    $id = (int) (store_body()['id'] ?? 0);
    $q = $db->prepare('delete from admin_passkeys where id = ? and admin_id = ?'); $q->execute([$id, (int) $admin['id']]);
    if ($q->rowCount() === 0) store_fail('passkey_not_found', 404);
    store_out(['ok' => true]);
}
if ($r === 'session_revoke' && $method === 'POST') {
    if (!sec_tables_ready($db)) store_fail('sessions_not_ready', 503);
    $id = (int) (store_body()['id'] ?? 0);
    $q = $db->prepare('update admin_sessions set revoked_at = now() where id = ? and admin_id = ? and revoked_at is null and sid_hash <> ?'); $q->execute([$id, (int) $admin['id'], sec_sid_hash()]);
    if ($q->rowCount() === 0) store_fail('session_not_found', 404);
    store_out(['ok' => true]);
}
if ($r === 'sessions_revoke_others' && $method === 'POST') {
    if (!sec_tables_ready($db)) store_fail('sessions_not_ready', 503);
    store_out(['ok' => true, 'revoked' => sec_sessions_revoke_others($db, (int) $admin['id'])]);
}

// ---- payment status + connection test (signed in)
if ($r === 'payment_check') {
    // Cheap without `live=1`; the live test reaches out to the banks, so it is rationed.
    $live = ($_GET['live'] ?? '') === '1';
    if ($live) store_throttle($db, 'payment_check', 12, 300);
    require_once __DIR__ . '/payment-check.php';
    store_out(payment_check($db, $live));
}

// ---- sign-in history (signed in)
if ($r === 'login_log') {
    try {
        $rows = $db->query('select id, at, email, method, result, ip, country, country_name, new_ip, agent
                              from admin_login_log order by id desc limit 100')->fetchAll();
        $fails = (int) $db->query("select count(*) from admin_login_log where result not in ('ok','code_needed') and at > now() - interval 24 hour")->fetchColumn();
        store_out(['rows' => $rows, 'failures_24h' => $fails, 'ready' => true]);
    } catch (Throwable $e) { store_out(['rows' => [], 'failures_24h' => 0, 'ready' => false]); }
}

// ---- notification centre (signed in) — the bell in the panel's top bar.
// Nothing here is stored as a notification: the list is READ from the tables the
// shop already keeps (orders, return_requests, admin_login_log, product_variants),
// newest first, last seven days, so it cannot drift from the screens it points at.
// The only state is when each admin last opened the bell, in the `notif_seen`
// settings row keyed by admin id — "unread" is "newer than that".
// Stock is a CONDITION, not an event (no timestamp), so it is one standing line
// that never counts as unread. Contact-form messages are not stored by this shop
// (the form opens the customer's own app), so there is nothing to list for them.
if ($r === 'notifications' && $method === 'GET') {
    $seen = store_setting($db, 'notif_seen');
    // 'a'.id, not the bare id: store_setting() runs array_merge, which renumbers
    // integer-like keys, so a key of "1" comes back as 0 and nothing is ever read.
    $since = (string) ($seen['a' . $admin['id']] ?? '');
    $items = [];
    $add = function (string $kind, string $at, string $title, string $detail, string $screen) use (&$items) {
        $items[] = ['kind' => $kind, 'at' => $at, 'title' => $title, 'detail' => $detail, 'screen' => $screen];
    };
    try {
        $q = $db->query("select track_id, customer_name, amount, payment_method, payment_status, created_at, paid_at
                           from orders where created_at > now() - interval 7 day order by id desc limit 40");
        foreach ($q->fetchAll() as $o) {
            $who = trim((string) $o['customer_name']);
            $amt = number_format((float) $o['amount'], 3) . ' KWD';
            $add('order', (string) $o['created_at'], 'New order ' . $o['track_id'], trim($who . ' · ' . $amt . ' · ' . $o['payment_method']), 'Orders');
            if ($o['payment_status'] === 'paid' && $o['paid_at'] && $o['payment_method'] !== 'cod')
                $add('payment', (string) $o['paid_at'], 'Payment received ' . $o['track_id'], $amt, 'Orders');
            if ($o['payment_status'] === 'failed') $add('payment', (string) $o['created_at'], 'Payment failed ' . $o['track_id'], $amt, 'Orders');
            if ($o['payment_status'] === 'review') $add('payment', (string) $o['created_at'], 'Payment needs review ' . $o['track_id'], $amt, 'Orders');
        }
    } catch (Throwable $e) { /* a missing table is an empty section, not a broken bell */ }
    try {
        $q = $db->query("select rr.ref, rr.kind, rr.created_at, o.track_id from return_requests rr
                           join orders o on o.id = rr.order_id
                          where rr.status = 'new' and rr.created_at > now() - interval 7 day order by rr.id desc limit 20");
        foreach ($q->fetchAll() as $x)
            $add('return', (string) $x['created_at'], ($x['kind'] === 'return' ? 'Return' : 'Exchange') . ' request ' . $x['ref'], 'Order ' . $x['track_id'], 'Returns');
    } catch (Throwable $e) {}
    try {
        $q = $db->query("select at, email, result, country_name, new_ip from admin_login_log
                          where at > now() - interval 7 day
                            and (result not in ('ok','code_needed') or new_ip = 1) order by id desc limit 20");
        foreach ($q->fetchAll() as $x) {
            $bad = !in_array($x['result'], ['ok', 'code_needed'], true);
            $add('security', (string) $x['at'], $bad ? 'Failed sign-in attempt' : 'Sign-in from a new address',
                 trim(($x['email'] ?: 'unknown') . ($x['country_name'] ? ' · ' . $x['country_name'] : '')), 'Security');
        }
    } catch (Throwable $e) {}
    usort($items, fn($a, $b) => strcmp($b['at'], $a['at']));
    $items = array_slice($items, 0, 60);
    $unread = 0;
    foreach ($items as &$it) { $it['unread'] = $since === '' || $it['at'] > $since; if ($it['unread']) $unread++; }
    unset($it);
    $stock = ['low' => 0, 'out' => 0];
    try {
        $low = (int) (store_setting($db, 'inventory')['low'] ?? 5);
        $row = $db->query("select count(case when stock = 0 then 1 end) as o, count(case when stock > 0 and stock <= " . max(0, min(999, $low)) . " then 1 end) as l
                             from product_variants v join products p on p.slug = v.slug where p.active = 1")->fetch();
        $stock = ['low' => (int) $row['l'], 'out' => (int) $row['o']];
    } catch (Throwable $e) {}
    store_out(['items' => $items, 'unread' => $unread, 'stock' => $stock, 'now' => (string) $db->query('select now()')->fetchColumn()]);
}
if ($r === 'notifications_read' && $method === 'POST') {
    $seen = store_setting($db, 'notif_seen');
    // The DATABASE's clock, not PHP's: order times come from now() in MySQL, and the
    // two can sit in different timezones — comparing across them leaves rows unread for ever.
    $seen['a' . $admin['id']] = (string) $db->query('select now()')->fetchColumn();
    store_setting_save($db, 'notif_seen', $seen);
    store_out(['ok' => true]);
}

// ---- passcode management (signed in)
if ($r === 'passcode_enroll' && $method === 'POST') {
    $b = store_body();
    $pass = (string) ($b['passcode'] ?? '');
    if (!passcode_valid($pass)) store_fail('bad_passcode');
    $label = mb_substr(trim(strip_tags((string) ($b['label'] ?? ''))), 0, 80);
    $token = passcode_cookie_token();
    // Re-enrolling the same browser replaces its row rather than stacking one.
    if ($token !== '') $db->prepare('delete from admin_devices where token_hash = ?')->execute([hash('sha256', $token)]);
    $token = bin2hex(random_bytes(32));
    $exp = time() + PASSCODE_ROLL_DAYS * 86400;
    $db->prepare('insert into admin_devices (admin_id, token_hash, pass_hash, label, expires_at) values (?,?,?,?,?)')
       ->execute([$admin['id'], hash('sha256', $token), password_hash($pass, PASSWORD_DEFAULT), $label,
                  date('Y-m-d H:i:s', $exp)]);
    // A tidy-up: this admin's expired rows.
    $db->prepare('delete from admin_devices where admin_id = ? and expires_at <= now()')->execute([$admin['id']]);
    passcode_set_cookie($token, $exp);
    store_out(['ok' => true]);
}
if ($r === 'passcode_devices') {
    $cur = passcode_cookie_token();
    $curHash = $cur === '' ? '' : hash('sha256', $cur);
    try {
        $q = $db->prepare('select id, label, failed, created_at, last_used_at, expires_at, token_hash
                             from admin_devices where admin_id = ? and expires_at > now() order by id desc');
        $q->execute([$admin['id']]);
        $rows = $q->fetchAll();
    } catch (Throwable $e) { store_out(['devices' => [], 'ready' => false]); }
    $out = [];
    foreach ($rows as $d) {
        $out[] = ['id' => (int)$d['id'], 'label' => $d['label'], 'locked' => (int)$d['failed'] >= PASSCODE_MAX_FAILS,
                  'created_at' => $d['created_at'], 'last_used_at' => $d['last_used_at'],
                  'expires_at' => $d['expires_at'], 'current' => $curHash !== '' && hash_equals($d['token_hash'], $curHash)];
    }
    store_out(['devices' => $out, 'ready' => true]);
}
if ($r === 'passcode_remove' && $method === 'POST') {
    $b = store_body();
    $db->prepare('delete from admin_devices where id = ? and admin_id = ?')->execute([(int)($b['id'] ?? 0), $admin['id']]);
    store_out(['ok' => true]);
}

// RELEASE THE SESSION LOCK for every route but one. PHP's default file-based
// session handler holds an EXCLUSIVE lock on the session for as long as the
// script that opened it keeps running — so several admin.php requests
// sharing one browser tab's cookie never run concurrently no matter how many
// the browser sends at once; each waits for the ENTIRE previous one to
// finish first. Measured on the Catalogue screen, which fires one
// `product_images` request per garment the instant it opens — 46 on the
// seeded catalogue: every one of them queued up behind this lock, turning
// what the browser meant as ~46 parallel requests into 46 serial ones. That
// is invisible in a sandbox where each one costs a few milliseconds and is
// exactly the "switching to Catalogue is slow" a phone on a real network
// feels.
//
// `account_update` is excluded because it is the one route below this line
// that still WRITES to $_SESSION — a renamed email is refreshed there so the
// tab that just renamed itself is not signed out (see that route's own
// comment). Everything else past here only ever READS $_SESSION (an
// audit-log line naming who acted, mostly), which a closed session still
// allows — closing it stops further writes being saved, not existing reads.
if ($r !== 'account_update') {
    session_write_close();
}

// --------------------------------------------------------------- audit log
//
// ONE HOOK for every save route below, rather than one call added to each —
// see store_admin_audit_log()'s own comment in store.php for why a save
// route here is exactly the kind of thing this project has already watched
// go unwatched before.
//
// ob_start() is what makes "did a route actually answer" a fact this can
// read rather than guess. A POST naming an unknown $r matches none of the
// `if ($r === ...)` blocks below and falls off the end of the file having
// echoed nothing — PHP's response code still defaults to 200, so reading
// http_response_code() alone cannot tell that apart from a real save that
// succeeded. Buffering the output and checking whether anything was written
// to it can: store_out() always echoes a body before it exits, so an empty
// buffer means no route ran, whatever the code says.
ob_start();
register_shutdown_function(function () use ($admin, $r, $method) {
    $body = ob_get_clean();
    echo $body;   // unchanged for the client — buffering must not eat the response
    if ($method !== 'POST' || $body === '') return;
    $code = http_response_code();
    if ($code < 200 || $code >= 300) return;
    store_admin_audit_log($admin, $r, $code, store_body());
});

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
    $sql = 'select id, track_id, amount, payment_status, payment_method, fulfilment_status,
                   paid_at, created_at, customer_name, customer_phone, customer_email, customer_area,
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
    if (in_array($payment, ['paid','pending','review','failed'], true)) {
        $where[] = 'payment_status = ?'; $args[] = $payment;
    }
    if (in_array($fulfilment, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        $where[] = 'fulfilment_status = ?'; $args[] = $fulfilment;
    }
    $term = trim((string)($_GET['search'] ?? ''));
    if ($term !== '') { $where[] = 'track_id like ?'; $args[] = '%' . $term . '%'; }
    if ($where) $sql .= ' where ' . implode(' and ', $where);
    $sql .= ' order by created_at desc limit ' . max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $q = $db->prepare($sql);
    $q->execute($args);
    $rows = $q->fetchAll();
    foreach ($rows as &$row) { $row['amount'] = (float)$row['amount']; $row['id'] = (int)$row['id']; }
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
    // Each step keeps its own time (live tracking, 2026-10-04): set when the step is first reached,
    // never cleared, so re-marking an order does not lose when it really left.
    $db->prepare('update orders set fulfilment_status = ?,
                    packed_at    = case when ? = \'packed\'    and packed_at    is null then now() else packed_at    end,
                    shipped_at   = case when ? = \'shipped\'   and shipped_at   is null then now() else shipped_at   end,
                    fulfilled_at = case when ? = \'delivered\' then now() else fulfilled_at end
                  where id = ?')
       ->execute([$status, $status, $status, $status, $orderId]);
    // A delivered or cancelled order has no van to follow: its driver position goes, and the
    // driver link stops being accepted (driver.php checks the status).
    if (in_array($status, ['delivered', 'cancelled'], true)) {
        $db->prepare('delete from order_location where order_id = ?')->execute([$orderId]);
    }
    if ($status === 'packed') store_queue_whatsapp($db, $orderId, 'packed');
    if ($status === 'delivered') store_queue_whatsapp($db, $orderId, 'delivered');
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
    store_out(['ok' => true]);
}

// ---- live tracking (2026-10-04): the carrier and its number, the driver link, the last position.
if ($r === 'courier' && $method === 'POST') {
    $b = store_body();
    $orderId = (int)($b['order_id'] ?? 0);
    $courier = trim((string)($b['courier'] ?? ''));
    $ref = trim((string)($b['courier_ref'] ?? ''));
    if ($courier !== '' && !isset(STORE_COURIERS[$courier])) store_fail('invalid_courier');
    if ($ref !== '' && !preg_match('/^[A-Za-z0-9-]{3,80}$/', $ref)) store_fail('invalid_courier_ref');
    $db->prepare('update orders set courier = ?, courier_ref = ? where id = ?')
       ->execute([$courier === '' ? null : $courier, $ref === '' ? null : $ref, $orderId]);
    store_out(['ok' => true, 'courier' => $courier === '' ? null : $courier, 'courier_ref' => $ref === '' ? null : $ref,
               'courier_url' => store_courier_url($courier, $ref)]);
}
// ---- the setup checklist (2026-10-04, "improve all backend setup"): what is still unconfigured, where
// to fix it, and NEVER a value — only ready / missing / placeholder / partial. The same questions the
// live-*-check scripts ask, answered inside the panel. Reads only.
if ($r === 'setup_status') {
    $cfg = store_config();
    $set = static function (string $v): string {
        $v = trim($v);
        if ($v === '') return 'missing';
        if (stripos($v, 'YOUR_') === 0 || stripos($v, 'SANDBOX_NOT_A_REAL') !== false || stripos($v, 'CHANGEME') !== false || stripos($v, 'PLACEHOLDER') !== false) return 'placeholder';
        return 'ready';
    };
    $keys = static function (array $src, array $ks) use ($set): string {
        $states = array_map(fn ($k) => $set((string) ($src[$k] ?? '')), $ks);
        if (in_array('placeholder', $states, true)) return 'placeholder';
        $ready = count(array_filter($states, fn ($x) => $x === 'ready'));
        return $ready === count($ks) ? 'ready' : ($ready === 0 ? 'missing' : 'partial');
    };
    $items = [];
    $add = static function (string $key, string $state, string $where, array $detail = []) use (&$items) {
        $items[] = ['key' => $key, 'state' => $state, 'where' => $where] + $detail;
    };
    // payments
    $pay = @include dirname(__DIR__) . '/pay/config.php';
    $pay = is_array($pay) ? $pay : [];
    $add('cbk', $pay ? $keys($pay, ['client_id', 'client_secret', 'encrp_key']) : 'missing', 'payments',
         ['env' => ($pay['env'] ?? '') === 'test' ? 'test' : 'production']);
    $knetRow = store_setting($db, 'knet');
    $knetFile = @include dirname(__DIR__) . '/knet/config.php';
    $knetFile = is_array($knetFile) ? $knetFile : [];
    $tid = trim((string) ($knetRow['tranportal_id'] ?? '')) !== '' ? (string) $knetRow['tranportal_id'] : (string) ($knetFile['tranportal_id'] ?? '');
    $add('knet_tranportal', $set($tid), 'payments', ['source' => trim((string) ($knetRow['tranportal_id'] ?? '')) !== '' ? 'panel' : 'file']);
    $methods = store_rule($db, 'payment_methods');
    $add('payment_methods', is_array($methods) && $methods ? 'ready' : 'missing', 'payments', ['count' => is_array($methods) ? count($methods) : 0]);
    // messages
    $add('whatsapp', $keys($cfg, ['whatsapp_token', 'whatsapp_phone_number_id']), 'config', [
        'templates' => count(array_filter(['whatsapp_template_confirmed', 'whatsapp_template_shipped', 'whatsapp_template_packed', 'whatsapp_template_delivered', 'whatsapp_template_review'], fn ($k) => trim((string) ($cfg[$k] ?? '')) !== '')) . '/5']);
    $add('mail', $keys($cfg, ['mail_from']), 'config', ['warehouse' => $set((string) ($cfg['warehouse_email'] ?? ''))]);
    $add('push', $keys($cfg, ['vapid_public', 'vapid_private']), 'config');
    $add('assistant_n8n', $keys($cfg, ['n8n_webhook', 'n8n_secret']), 'config');
    $add('voice', $keys($cfg, ['tts_key', 'tts_voice_id']), 'config');
    $add('ai_research', $keys($cfg, ['ai_key']), 'config');
    $add('cron_key', $keys($cfg, ['cron_key']), 'config');
    // sign-in
    $g = store_setting($db, 'google_auth'); $add('google_signin', trim((string) ($g['client_id'] ?? '')) !== '' ? 'ready' : 'missing', 'security');
    $ap = store_setting($db, 'apple_auth'); $add('apple_signin', trim((string) ($ap['client_id'] ?? '')) !== '' ? 'ready' : 'missing', 'security');
    $me = store_session_admin();
    $tf = $me ? $db->prepare('select totp_enabled, email_otp_enabled from admin_users where id = ?') : null;
    if ($tf) { $tf->execute([(int) $me['id']]); $row = $tf->fetch() ?: []; }
    $add('two_factor', !empty($row['totp_enabled']) || !empty($row['email_otp_enabled']) ? 'ready' : 'missing', 'security');
    // wallet
    require_once __DIR__ . '/wallet-setup.php';
    $w = wallet_status($cfg);
    $add('wallet', $w['ready'] ? 'ready' : (($w['certificate'] || $w['key'] || $w['request_pending']) ? 'partial' : 'missing'), 'settings', ['expires' => $w['expires'], 'expired' => $w['expired']]);
    // content
    $active = (int) $db->query('select count(*) from products where active = 1')->fetchColumn();
    $withPhoto = (int) $db->query('select count(distinct p.slug) from products p join product_images i on i.slug = p.slug where p.active = 1')->fetchColumn();
    $add('product_photos', $active === 0 ? 'missing' : ($withPhoto === $active ? 'ready' : ($withPhoto === 0 ? 'missing' : 'partial')), 'catalogue', ['with' => $withPhoto, 'of' => $active]);
    $brands = $db->query('select slug from brands')->fetchAll(PDO::FETCH_COLUMN);
    $logos = count(array_filter($brands, fn ($b) => store_brand_logo_file((string) $b) !== null));
    $add('brand_logos', !$brands ? 'missing' : ($logos === count($brands) ? 'ready' : ($logos === 0 ? 'missing' : 'partial')), 'brands', ['with' => $logos, 'of' => count($brands)]);
    $withBrand = (int) $db->query("select count(*) from products where active = 1 and coalesce(brand_slug,'') <> ''")->fetchColumn();
    $add('product_brands', $active === 0 ? 'missing' : ($withBrand === $active ? 'ready' : ($withBrand === 0 ? 'missing' : 'partial')), 'catalogue', ['with' => $withBrand, 'of' => $active]);
    $noDesc = (int) $db->query("select count(*) from products where active = 1 and (coalesce(desc_en,'') = '' or coalesce(desc_ar,'') = '')")->fetchColumn();
    $add('product_descriptions', $active === 0 ? 'missing' : ($noDesc === 0 ? 'ready' : ($noDesc === $active ? 'missing' : 'partial')), 'catalogue', ['with' => $active - $noDesc, 'of' => $active]);
    $slides = (int) $db->query('select count(*) from hero_slides where active = 1')->fetchColumn();
    $add('hero_slides', $slides > 0 ? 'ready' : 'missing', 'slides', ['count' => $slides]);
    $social = store_setting($db, 'social');
    $add('instagram', trim((string) ($social['instagram'] ?? '')) !== '' ? 'ready' : 'missing', 'settings');
    $seo = store_setting($db, 'seo');
    $add('google_verification', trim((string) ($seo['google_verification'] ?? '')) !== '' ? 'ready' : 'missing', 'seo');
    $contact = store_setting($db, 'contact');
    $add('contact', trim((string) ($contact['phone'] ?? $cfg['shop_phone'] ?? '')) !== '' ? 'ready' : 'missing', 'settings');
    // backups
    $bdir = rtrim((string) ($cfg['backup_dir'] ?? ''), '/'); if ($bdir === '') $bdir = dirname(__DIR__, 3) . '/backups';
    $bk = glob("$bdir/sporta-*.json.gz") ?: []; rsort($bk, SORT_STRING);
    $newest = $bk ? (int) filemtime($bk[0]) : 0;
    $add('daily_backup', !$bk ? 'missing' : (time() - $newest > 2 * 86400 ? 'partial' : 'ready'), 'cron', ['count' => count($bk), 'newest' => $newest ? gmdate('Y-m-d', $newest) : null]);
    $summary = ['ready' => 0, 'partial' => 0, 'placeholder' => 0, 'missing' => 0];
    foreach ($items as $i) $summary[$i['state']]++;
    store_out(['items' => $items, 'summary' => $summary]);
}

if ($r === 'couriers') {
    $out = [];
    foreach (STORE_COURIERS as $k => [$en, $ar, $tpl]) $out[] = ['key' => $k, 'name_en' => $en, 'name_ar' => $ar, 'has_page' => $tpl !== null];
    store_out($out);
}
if ($r === 'driver_link') {
    $q = $db->prepare('select track_id, fulfilment_status from orders where id = ?');
    $q->execute([(int)($_GET['order_id'] ?? 0)]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found', 404);
    $cfg = store_config();
    if (($cfg['cron_key'] ?? '') === '') store_fail('no_cron_key', 503);
    $path = '/api/driver.php?o=' . rawurlencode($o['track_id']) . '&t=' . store_driver_sig($o['track_id']);
    store_out(['path' => $path, 'url' => 'https://www.sporta.com.kw' . $path,
               'usable' => in_array($o['fulfilment_status'], ['packed', 'shipped'], true), 'status' => $o['fulfilment_status']]);
}
if ($r === 'location') {
    $q = $db->prepare('select lat, lng, accuracy_m, updated_at, timestampdiff(second, updated_at, now()) as age_sec from order_location where order_id = ?');
    $q->execute([(int)($_GET['order_id'] ?? 0)]);
    $l = $q->fetch();
    store_out($l ? ['lat' => (float)$l['lat'], 'lng' => (float)$l['lng'], 'accuracy_m' => $l['accuracy_m'] === null ? null : (int)$l['accuracy_m'],
                    'updated_at' => $l['updated_at'], 'age_sec' => (int)$l['age_sec']] : null);
}

// Settle (or un-settle) a cash order. The one narrow path that may touch
// payment_status, same as admin_set_cod_paid: card payments are confirmed by
// the bank's callback, never by a person with an admin session.
if ($r === 'cod_paid' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    $paid = (bool)($b['paid'] ?? true);
    $q = $db->prepare('select payment_method, payment_status from orders where id = ?');
    $q->execute([$id]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found');
    if ($o['payment_method'] !== 'cod') store_fail('not_a_cash_order');
    if ($paid  && $o['payment_status'] !== 'pending') store_fail('order_not_pending');
    if (!$paid && $o['payment_status'] !== 'paid')    store_fail('order_not_paid');

    $db->beginTransaction();
    try {
        $db->prepare('update orders set payment_status = ?, paid_at = ? where id = ?')
           ->execute([$paid ? 'paid' : 'pending', $paid ? date('Y-m-d H:i:s') : null, $id]);
        // Cash collected is a settled outcome: the warehouse follow-up fires
        // exactly as it does when the bank confirms a card.
        if ($paid) store_payment_settled($db, $id, 'paid');
        // Un-marking takes the points back off the customer's Wallet card too.
        else store_wallet_touch($db, $id);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
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

    $q = $db->prepare('select payment_method, payment_status, cbk_paymentid from orders where id = ?');
    $q->execute([$id]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found');
    if ($o['payment_method'] === 'cod')  store_fail('not_a_card_order');
    if ($o['payment_status'] === 'paid') store_fail('order_already_paid');
    // Long enough that it cannot be a shrug. KNET payment ids are numeric and
    // ~12 digits; this stays permissive about format because acquirers differ,
    // but not about the field being filled in.
    if (strlen($ref) < 6 || strlen($ref) > 60) store_fail('bank_reference_required');

    $db->beginTransaction();
    try {
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
        store_payment_settled($db, $id, 'paid');
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
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
    // THE MAIN PHOTOGRAPH'S URL, so the panel's list can show one.
    //
    // A URL AND NOT THE BYTES, which is the same call ?r=product_images makes
    // and states its reasons for: a dozen data URIs in one JSON response is
    // megabytes down a connection in Kuwait to draw pictures the browser could
    // have cached, and this list is forty-six garments rather than a dozen. The
    // url is identical to the storefront's for the same photograph, so it is
    // very likely already in cache, and `w=96` asks the resizing route for a
    // thumbnail rather than the whole upload.
    //
    // FROM THE GALLERY, not from `products.image`. That column is selected
    // below because the shape has always carried it, and it is empty on every
    // row — measured, 0 of 46. product_images is where a photograph has lived
    // since the uploader was built, and `sort` is what makes one of them the
    // main one.
    $rows = $db->query(
        'select p.id, p.slug, p.name_en, p.name_ar, p.desc_en, p.desc_ar, p.price, p.sale_price,
                p.sale_starts_at, p.sale_ends_at, p.featured, p.featured_sort, p.category,
                p.brand_slug, p.image, p.active,
                (select i.id         from product_images i
                   where i.slug = p.slug order by i.sort, i.id limit 1) as thumb_id,
                (select i.image_hash from product_images i
                   where i.slug = p.slug order by i.sort, i.id limit 1) as thumb_hash
           from products p order by p.id desc'
    )->fetchAll();

    foreach ($rows as &$row) {
        $row['thumb'] = $row['thumb_id'] === null ? null
            : 'api.php?r=product_image&id=' . (int) $row['thumb_id']
              . '&v=' . substr((string) $row['thumb_hash'], 0, 12) . '&w=96';
        unset($row['thumb_id'], $row['thumb_hash']);
    }
    unset($row);

    store_out($rows);
}

// -------------------------------------------------- look a product up, propose
//
// The owner's "find all product info on the web, use it for missing fields
// only". It is a READ: it writes nothing, touches no row, and answers with a
// proposal the owner applies by pressing the panel's ordinary Save. See
// research.php for why that is the whole design rather than a setting.
//
// POST, not GET, although it changes nothing here: it spends the shop's money
// at an API and takes up to ninety seconds, and neither belongs on a verb a
// browser, a crawler or a prefetcher will replay on its own.
//
// LAZILY REQUIRED. A shop that has not published research.php yet must go on
// serving every other admin route rather than fatalling on all of them, and
// the panel asking for a feature the server does not have should hear that by
// name.
if ($r === 'product_research' && $method === 'POST') {
    $file = __DIR__ . '/research.php';
    if (!is_file($file)) store_fail('research_not_installed', 503);
    require_once $file;

    $b = store_body();
    $slug = store_slug((string) ($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');

    $q = $db->prepare('select slug, name_en, name_ar, desc_en, desc_ar, category, brand_slug
                         from products where slug = ? limit 1');
    $q->execute([$slug]);
    $p = $q->fetch(PDO::FETCH_ASSOC);
    if (!$p) store_fail('product_not_found', 404);

    $missing = research_missing($p);
    if (!$missing) {
        // NOT AN ERROR. "Everything is already filled in" is the answer the
        // owner most wants on a tidy catalogue, and a 4xx would make the panel
        // draw it in red.
        store_out(['slug' => $slug, 'missing' => [], 'fields' => [], 'sources' => [],
                   'notes' => 'Nothing is missing on this product.']);
    }

    $out = research_run(store_config(), $db, $p, $missing);
    if (isset($out['error'])) {
        // 503 for "this shop has not switched it on", which is a state rather
        // than a fault; 502 for the model or the network failing, which is.
        store_fail($out['error'], $out['error'] === 'ai_not_configured' ? 503 : 502);
    }

    // `missing` goes back with it so the panel can show what was asked for
    // beside what came back — a field that was asked about and NOT answered is
    // the model declining to guess, and that is worth seeing rather than
    // looking like a field nobody wanted.
    $out['slug'] = $slug;
    $out['missing'] = $missing;
    // CATEGORY CARRIES A POLICY. store_return_lookup() decides whether a
    // garment may be exchanged from it, so accepting one silently changes what
    // the shop promises about this product. Said here rather than only in the
    // panel, because the app's panel will read this route too.
    $out['policy_warning'] = isset($out['fields']['category'])
        ? 'The category decides whether this product can be exchanged. Check it before saving.'
        : null;
    store_out($out);
}

// -------------------------------------------------- guess one photo's product
//
// The Catalogue photo uploader already matches an unsorted file by FILENAME;
// a file that matches nothing waits for the owner to pick a garment from a
// dropdown. This looks at the PICTURE instead — a yellow t-shirt photo
// pre-fills that same dropdown with the yellow t-shirt product — and, like
// product_research above, WRITES NOTHING: the owner still presses Upload
// themselves. See photo-guess.php for the rest.
//
// POST, not GET, for the same reason product_research is: it spends the
// shop's money at an API on every call, which does not belong on a verb a
// prefetcher will replay.
//
// LAZILY REQUIRED, same shape as research.php, so a shop that has not
// published photo-guess.php yet goes on serving every other admin route.
if ($r === 'photo_guess' && $method === 'POST') {
    $file = __DIR__ . '/photo-guess.php';
    if (!is_file($file)) store_fail('photo_guess_not_installed', 503);
    require_once $file;

    $b = store_body();
    $image = (string) ($b['image'] ?? '');
    if ($image === '') store_fail('image_required');

    $out = photoguess_run(store_config(), $db, $image);
    if (isset($out['error'])) {
        store_fail($out['error'], $out['error'] === 'ai_not_configured' ? 503 : 502);
    }
    store_out($out);
}

// ------------------------------------------------- what a product rename carries
//
// EVERY PLACE A PRODUCT'S SLUG IS STORED AS A REFERENCE TO IT. product_save's
// rename moves each of these in the same transaction as the product row. The
// list used to be three tables long and its comment said that was "the list
// information_schema gives for a `slug` column"; by 2026-10-08 it was seven,
// and renaming a product left its colour and fits, its search title and
// description, its stock history, and the home banner pointing at a product
// that no longer existed — all still in the database, none reachable.
//
// It is a LIST AND NOT A QUERY on purpose. "Every column called slug" also
// matches brands.slug, and a future pages.slug or categories.slug: renaming a
// product called `outlet` would then rewrite a category. So the list says which
// columns hold a PRODUCT's slug, and scripts/product-rename-test.mjs reads every
// slug-shaped column a fully-migrated install has (the generated manifest in
// scripts/live/live-schema-full.php) and fails on any that is in neither this
// list nor its own short list of slugs that are not a product's (brands.slug,
// products.slug, products.brand_slug). A table added tomorrow is a decision,
// not a silent gap.
//
// The third value: true where the table holds ONE row per product (its primary
// key is the slug), so a row already sitting under the new slug — which no
// product owns, or the products update would already have failed on its unique
// key — is a leftover the product's own row replaces. Without it, the move would
// fail on the duplicate key and the owner would be told the slug is taken.
//
// What does NOT move, and why:
//   - The SKU. variant_save keeps a size's existing SKU, and it is printed on
//     the shelf labels; variant_supplier, purchase_order_items and stock_log.sku
//     find a size by it, so they stay attached because it does not change.
//   - order_items, reviews, returns: they reference the product by id, or the
//     order line by id, and record what was sold as it was sold.
//   - Links the owner typed (menu, footer, hero buttons, the banner's own link):
//     a URL is a URL; the product's page moves to its new address and an old
//     link to it breaks, the same as a link from Google or a social post.
//   - A shopper's wishlist and bag, which live in their browser.
function admin_product_slug_refs(): array {
    return [
        // table              column     one row per product
        ['product_images',   'slug',    false],   // the photo shoot
        ['product_variants', 'slug',    false],   // sizes and stock
        ['size_advice_log',  'slug',    false],   // what the assistant recommended, kept for review
        ['stock_log',        'slug',    false],   // the stock history the Inventory screen shows
        ['product_attrs',    'slug',    true],    // colour and fits
        ['product_seo',      'slug',    true],    // its own search title and description
        ['home_banner',      'product', false],   // the home page banner's product
    ];
}

if ($r === 'product_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $slug = store_slug((string)($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 160);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 160);
    // THE PRICE IS MONEY. Same three-decimal discipline the order path uses:
    // KWD has exactly three, and a price that arrives as 10.5 must be stored
    // as 10.500 or the fils quietly disappear.
    $price = (float)($b['price'] ?? 0);
    if ($price <= 0 || $price > 9999999) store_fail('invalid_price');
    $price = number_format($price, 3, '.', '');
    $active = array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : 1;

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
        $salePrice = (float)$salePrice;
        if ($salePrice <= 0)              store_fail('invalid_sale_price');
        if ($salePrice >= (float)$price)  store_fail('sale_not_lower');
        $salePrice = number_format($salePrice, 3, '.', '');
        $saleFrom = store_datetime($b['sale_starts_at'] ?? null);
        $saleTo   = store_datetime($b['sale_ends_at'] ?? null);
        if ($saleFrom !== null && $saleTo !== null && $saleFrom > $saleTo) store_fail('sale_dates_backwards');
    }
    $featured = !empty($b['featured']) ? 1 : 0;
    $featuredSort = (int)($b['featured_sort'] ?? 0);

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

    $brandSlug = trim((string)($b['brand_slug'] ?? ''));
    if ($brandSlug === '') {
        $brandSlug = null;
    } else {
        $q = $db->prepare('select 1 from brands where slug = ?');
        $q->execute([$brandSlug]);
        if (!$q->fetchColumn()) store_fail('unknown_brand');
    }

    // WHAT THE SLUG USED TO BE, read before the update overwrites it.
    //
    // product_images, product_variants and every other table in
    // admin_product_slug_refs() are keyed on products.slug rather than
    // products.id — a deliberate choice, so the
    // catalogue survives being re-imported from the supplier's export. The
    // cost of it is that there is no foreign key and no ON UPDATE CASCADE to
    // carry those rows when the slug changes, and this route lets the owner
    // change it: the slug is an editable field in the product form.
    //
    // So renaming a product silently detached everything hanging off it. Its
    // whole photo shoot stayed in product_images under the old name — not
    // shown on the storefront (?r=products looks up by the new slug and finds
    // nothing, so the grid goes back to a grey box), not visible in the admin
    // (which also lists by slug), and not servable (?r=product_image INNER
    // JOINs products and 404s). The bytes stay in the database forever with
    // nothing able to reach them. The size rows went the same way, which is
    // worse than losing pictures: the garment becomes untracked, every size
    // reads as in stock, and it can be oversold.
    //
    // Measured before this was written: rename one product, and the storefront
    // row's `image` goes from a URL to null while the photograph is still in
    // the table.
    $oldSlug = null;
    if ($id > 0) {
        $prev = $db->prepare('select slug from products where id = ?');
        $prev->execute([$id]);
        $oldSlug = (string)($prev->fetchColumn() ?: '');
        if ($oldSlug === '' || $oldSlug === $slug) $oldSlug = null;
    }

    // ONE TRANSACTION for the product row and its children. A rename that
    // moved the photographs and then failed to move the size rows would leave
    // a garment whose stock is somewhere else entirely, and the shop would
    // keep selling it. Either the whole rename lands or none of it does.
    $renaming = $oldSlug !== null;

    // WHICH OF THE REFERENCES THIS SHOP HAS. Several are optional tables, each
    // created by its own migration (product_attrs, product_seo, stock_log,
    // home_banner), and an `update` of a table that does not exist throws and
    // rolls the whole rename back — so a shop that has not run one migration
    // could not rename any product at all. Asked of information_schema rather
    // than caught per statement: a failed statement inside a transaction would
    // otherwise be skipped while the others committed, which is the half-moved
    // rename this transaction exists to prevent.
    //
    // And the column's width. product_seo.slug and home_banner.product are
    // varchar(64) where products.slug is varchar(80); a longer slug would be
    // refused mid-move (or, without strict mode, silently cut short and so
    // detached). Refused here, by name, before anything is written.
    $slugRefs = [];
    if ($renaming) {
        $widths = [];
        foreach ($db->query("select table_name as t, column_name as c, character_maximum_length as n
                               from information_schema.columns where table_schema = database()")->fetchAll() as $x) {
            $widths[$x['t'] . '.' . $x['c']] = (int)$x['n'];
        }
        foreach (admin_product_slug_refs() as [$t, $c, $one]) {
            if (!isset($widths["$t.$c"])) continue;   // not created on this shop: nothing to carry
            if ($widths["$t.$c"] > 0 && strlen($slug) > $widths["$t.$c"]) {
                $has = $db->prepare("select 1 from `$t` where `$c` = ? limit 1");
                $has->execute([$oldSlug]);
                if ($has->fetchColumn()) store_fail('slug_too_long');
            }
            $slugRefs[] = [$t, $c, $one];
        }
    }
    if ($renaming) $db->beginTransaction();
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
                        store_opt($b['image'] ?? null), $extraImages, $active, $id]);
        } else {
            $db->prepare(
                'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                        sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                        image, images, active)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        store_opt($b['image'] ?? null), $extraImages, $active]);
            $id = (int)$db->lastInsertId();
        }

        // Carry the children: every reference admin_product_slug_refs() names
        // that this shop has (see that function for what is NOT moved, and why).
        if ($renaming) {
            foreach ($slugRefs as [$t, $c, $one]) {
                if ($one) {
                    $has = $db->prepare("select 1 from `$t` where `$c` = ? limit 1");
                    $has->execute([$oldSlug]);
                    if (!$has->fetchColumn()) continue;
                    // `and c <> old`: the columns are utf8mb4_unicode_ci, so on a case-only
                    // rename (a hand-edited `ABC` saved back through store_slug as `abc`) the
                    // new slug MATCHES the product's own row, and a bare delete removed it.
                    $db->prepare("delete from `$t` where `$c` = ? and `$c` <> ?")->execute([$slug, $oldSlug]);
                }
                $db->prepare("update `$t` set `$c` = ? where `$c` = ?")->execute([$slug, $oldSlug]);
            }
            // The sitemap's excluded products are a list of slugs inside the
            // `crawl` settings row (/backends -> SEO). Left alone, a renamed
            // product the owner had kept out of Google would quietly go back in.
            $cr = $db->prepare("select value from settings where name = 'crawl' for update");
            $cr->execute();
            $crawl = json_decode((string)($cr->fetchColumn() ?: ''), true);
            if (is_array($crawl) && is_array($crawl['exclude'] ?? null) && in_array($oldSlug, $crawl['exclude'], true)) {
                $crawl['exclude'] = array_values(array_unique(array_map(
                    fn ($x) => $x === $oldSlug ? $slug : $x, $crawl['exclude'])));
                store_setting_save($db, 'crawl', $crawl);
            }
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($renaming && $db->inTransaction()) $db->rollBack();
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
// ---------------------------------------------- the home page's category tiles
//
// "make category images editor at backend". The four tiles (men, women,
// accessories, outlet) are files in /cats/; an owner's replacement is a set of
// rows in category_art, served in their place by api.php?r=cat_art, and deleting
// the rows puts the shipped art back. See categoryart.mysql.sql for why rows.
//
// The panel does the picture work in the browser (cover-crop to the two tile
// shapes, mirror for Arabic, encode webp + jpeg), so this server needs no image
// library. What it does NOT do is trust that: every picture is decoded and
// measured here, and a wrong size, a wrong type or a non-image is refused by
// name, so a tile can never be cropped by the page in a way nobody saw.
if ($r === 'cat_art_list') {
    $by = [];
    $ready = true;
    try {
        foreach ($db->query('select tile, count(*) n, max(updated_at) updated from category_art group by tile')->fetchAll() as $x) {
            $by[$x['tile']] = $x;
        }
    } catch (Throwable $e) {
        // Table not created yet on this shop: say so, do not 500 the screen.
        $ready = false;
    }
    $tiles = [];
    foreach (STORE_CAT_TILES as $t) {
        $x = $by[$t] ?? null;
        $tiles[] = ['tile' => $t, 'replaced' => $x !== null && (int)$x['n'] >= 8, 'updated_at' => $x['updated'] ?? null];
    }
    store_out(['ready' => $ready, 'tiles' => $tiles, 'sizes' => STORE_CAT_VARIANTS]);
}

// THE SITE'S OWN PICTURES (2026-10-04): the logo (dark and white marks) and the features band,
// replaced from the panel as rows that win over the shipped files (store_site_image_serve).
if ($r === 'site_images') {
    $out = [];
    foreach (STORE_SITE_IMAGES as $name => $spec) $out[$name] = ['fmts' => $spec['fmts'], 'max' => $spec['max'], 'replaced' => []];
    try {
        foreach ($db->query('select name, fmt, etag, updated_at from site_images')->fetchAll() as $r2) {
            if (isset($out[$r2['name']])) $out[$r2['name']]['replaced'][$r2['fmt']] = ['etag' => $r2['etag'], 'at' => $r2['updated_at']];
        }
        $ready = true;
    } catch (Throwable $e) { $ready = false; }
    store_out(['ready' => $ready, 'images' => $out]);
}
if ($r === 'site_image_save' && $method === 'POST') {
    $b = store_body();
    $name = (string)($b['name'] ?? '');
    $spec = STORE_SITE_IMAGES[$name] ?? null;
    if ($spec === null) store_fail('site_image_bad_name');
    $imgs = is_array($b['images'] ?? null) ? $b['images'] : [];
    $rows = [];
    foreach ($spec['fmts'] as $fmt) $rows[$fmt] = store_site_image_decode($imgs[$fmt] ?? null, $name, $fmt);
    try {
        $db->beginTransaction();
        $db->prepare('delete from site_images where name = ?')->execute([$name]);
        $ins = $db->prepare('insert into site_images (name, fmt, bytes, etag) values (?, ?, ?, ?)');
        foreach ($rows as $fmt => $bytes) {
            $ins->bindValue(1, $name); $ins->bindValue(2, $fmt); $ins->bindValue(3, $bytes, PDO::PARAM_LOB); $ins->bindValue(4, md5($bytes));
            $ins->execute();
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('site_image_save: ' . $e->getMessage());
        store_fail('site_image_not_ready', 503);
    }
    store_out(['ok' => true, 'name' => $name, 'replaced' => true]);
}
if ($r === 'site_image_reset' && $method === 'POST') {
    $b = store_body();
    $name = (string)($b['name'] ?? '');
    if (!isset(STORE_SITE_IMAGES[$name])) store_fail('site_image_bad_name');
    try { $db->prepare('delete from site_images where name = ?')->execute([$name]); }
    catch (Throwable $e) { store_fail('site_image_not_ready', 503); }
    store_out(['ok' => true, 'name' => $name, 'replaced' => false]);
}

if ($r === 'cat_art_save' && $method === 'POST') {
    $b = store_body();
    $tile = (string)($b['tile'] ?? '');
    if (!in_array($tile, STORE_CAT_TILES, true)) store_fail('invalid_tile');
    $imgs = is_array($b['images'] ?? null) ? $b['images'] : [];
    $rows = [];
    foreach (STORE_CAT_VARIANTS as $crop => [$w, $h]) {
        foreach (['', '-rtl'] as $rtl) {
            foreach (['webp', 'jpg'] as $fmt) {
                $key = $crop . $rtl;
                $bytes = store_cat_art_decode(is_array($imgs[$key] ?? null) ? ($imgs[$key][$fmt] ?? null) : null, $fmt, $w, $h);
                $rows[] = [$key, $fmt, $bytes];
            }
        }
    }
    try {
        $db->beginTransaction();
        $db->prepare('delete from category_art where tile = ?')->execute([$tile]);
        $ins = $db->prepare('insert into category_art (tile, variant, fmt, bytes, etag) values (?, ?, ?, ?, ?)');
        foreach ($rows as [$key, $fmt, $bytes]) {
            $ins->bindValue(1, $tile);
            $ins->bindValue(2, $key);
            $ins->bindValue(3, $fmt);
            $ins->bindValue(4, $bytes, PDO::PARAM_LOB);
            $ins->bindValue(5, md5($bytes));
            $ins->execute();
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('cat_art_save: ' . $e->getMessage());
        store_fail('cat_art_not_ready', 503);
    }
    store_out(['ok' => true, 'tile' => $tile, 'replaced' => true]);
}

if ($r === 'cat_art_reset' && $method === 'POST') {
    $b = store_body();
    $tile = (string)($b['tile'] ?? '');
    if (!in_array($tile, STORE_CAT_TILES, true)) store_fail('invalid_tile');
    try {
        $db->prepare('delete from category_art where tile = ?')->execute([$tile]);
    } catch (Throwable $e) {
        store_fail('cat_art_not_ready', 503);
    }
    store_out(['ok' => true, 'tile' => $tile, 'replaced' => false]);
}

// ---------------------------------------------- the home page's product banner
//
// Above "Shop by category" (2026-10-01, the owner's "one product banner"; the
// story is in store.php). ONE ROW, READ WHOLE AND WRITTEN WHOLE: the card sends
// every field on every save, so a save can never blank a field it did not
// mention — the trap brand_save fell into. The product picker reads the public
// ?r=products, which lists exactly the products the banner may show.
if ($r === 'home_banner_get') {
    $ready = true;
    $row = null;
    try {
        $q = $db->query('select enabled, product, kicker_en, kicker_ar, title_en, title_ar, button_en, button_ar,
                                href, image_w, image_h, etag, updated_at from home_banner where id = 1');
        $row = $q->fetch() ?: null;
    } catch (Throwable $e) {
        $ready = false;   // the table is not on this shop yet: the card says so
    }
    store_out([
        'ready'  => $ready,
        'max'    => STORE_BANNER_TEXT_MAX,
        'banner' => $row ? [
            'enabled'    => (bool)(int)$row['enabled'],
            'product'    => (string)($row['product'] ?? ''),
            'kicker'     => ['en' => (string)$row['kicker_en'], 'ar' => (string)$row['kicker_ar']],
            'title'      => ['en' => (string)$row['title_en'], 'ar' => (string)$row['title_ar']],
            'button'     => ['en' => (string)$row['button_en'], 'ar' => (string)$row['button_ar']],
            'href'       => (string)$row['href'],
            'image'      => $row['etag'] ? 'api.php?r=home_banner_image&v=' . substr((string)$row['etag'], 0, 12) : null,
            'image_size' => $row['etag'] ? [(int)$row['image_w'], (int)$row['image_h']] : null,
            'updated_at' => $row['updated_at'],
        ] : null,
    ]);
}

// ------------------------------------------------------------------ SEO SETUP
// 2026-10-02. One read for the whole SEO screen, so the panel never reconstructs state from pieces.
if ($r === 'seo_state') {
    $products = [];
    foreach ($db->query('select slug, name_en, name_ar from products where active = 1 order by name_en')->fetchAll() as $p) {
        $products[] = ['slug' => $p['slug'], 'name_en' => $p['name_en'], 'name_ar' => $p['name_ar']];
    }
    $seoRows = [];
    $ready = true;
    try {
        foreach ($db->query('select slug, title_en, title_ar, desc_en, desc_ar from product_seo')->fetchAll() as $row) $seoRows[$row['slug']] = $row;
    } catch (Throwable $e) { $ready = false; }
    foreach ($products as &$p) {
        $o = $seoRows[$p['slug']] ?? [];
        foreach (['title_en', 'title_ar', 'desc_en', 'desc_ar'] as $k) $p['seo_' . $k] = (string)($o[$k] ?? '');
    }
    unset($p);
    store_out([
        'seo'      => store_seo($db),
        'crawl'    => store_crawl($db),
        'image'    => store_seo_image_url($db),
        'bots'     => STORE_SEO_AI_BOTS,
        'products' => $products,
        'ready'    => $ready,
    ]);
}

// The share picture: a data: URI to set it, {remove: true} to go back to og-image.png.
if ($r === 'seo_image_save' && $method === 'POST') {
    $b = store_body();
    try {
        if (!empty($b['remove'])) {
            $db->exec('delete from seo_image where id = 1');
        } else {
            $img = store_seo_image_decode((string)($b['image'] ?? ''));
            $q = $db->prepare('insert into seo_image (id, image, image_type, image_w, image_h, etag) values (1, ?, ?, ?, ?, ?)
                               on duplicate key update image = values(image), image_type = values(image_type),
                               image_w = values(image_w), image_h = values(image_h), etag = values(etag)');
            $q->bindValue(1, $img['bytes'], PDO::PARAM_LOB);
            $q->bindValue(2, $img['type']);
            $q->bindValue(3, $img['w'], PDO::PARAM_INT);
            $q->bindValue(4, $img['h'], PDO::PARAM_INT);
            $q->bindValue(5, md5($img['bytes']));
            $q->execute();
        }
    } catch (PDOException $e) {
        error_log('seo_image_save: ' . $e->getMessage());
        store_fail('seo_not_ready', 503);
    }
    store_out(['ok' => true, 'image' => store_seo_image_url($db)]);
}

// One product's search title and description. Writes ONLY product_seo, never products, so it cannot
// disturb anything product_save owns. All four empty deletes the row (= the page's own text).
if ($r === 'seo_product_save' && $method === 'POST') {
    $b = store_body();
    $slug = (string)($b['slug'] ?? '');
    $q = $db->prepare('select 1 from products where slug = ?');
    $q->execute([$slug]);
    if ($slug === '' || !$q->fetchColumn()) store_fail('seo_unknown_product');
    $v = [
        'title_en' => store_seo_text($b['title_en'] ?? '', 70), 'title_ar' => store_seo_text($b['title_ar'] ?? '', 70),
        'desc_en'  => store_seo_text($b['desc_en'] ?? '', 200), 'desc_ar'  => store_seo_text($b['desc_ar'] ?? '', 200),
    ];
    try {
        if (implode('', $v) === '') {
            $db->prepare('delete from product_seo where slug = ?')->execute([$slug]);
        } else {
            $db->prepare('insert into product_seo (slug, title_en, title_ar, desc_en, desc_ar) values (?, ?, ?, ?, ?)
                          on duplicate key update title_en = values(title_en), title_ar = values(title_ar),
                          desc_en = values(desc_en), desc_ar = values(desc_ar)')
               ->execute([$slug, $v['title_en'], $v['title_ar'], $v['desc_en'], $v['desc_ar']]);
        }
    } catch (PDOException $e) {
        error_log('seo_product_save: ' . $e->getMessage());
        store_fail('seo_not_ready', 503);
    }
    store_out(['ok' => true, 'slug' => $slug] + $v);
}

if ($r === 'home_banner_save' && $method === 'POST') {
    $b = store_body();
    $enabled = !empty($b['enabled']) ? 1 : 0;
    $product = trim((string)($b['product'] ?? ''));
    if ($product !== '') {
        $q = $db->prepare('select 1 from products where slug = ? and active = 1');
        $q->execute([$product]);
        if (!$q->fetchColumn()) store_fail('banner_unknown_product');
    }
    $text = [];
    foreach (['kicker', 'title', 'button'] as $k) {
        $v = is_array($b[$k] ?? null) ? $b[$k] : [];
        $text[$k . '_en'] = store_banner_text($v['en'] ?? '', $k);
        $text[$k . '_ar'] = store_banner_text($v['ar'] ?? '', $k);
    }
    $href = store_banner_href((string)($b['href'] ?? ''));
    $img = null;
    if (is_string($b['image'] ?? null) && $b['image'] !== '') $img = store_banner_image_decode($b['image']);
    $removeImage = !empty($b['remove_image']);

    try {
        $had = $db->query('select etag from home_banner where id = 1')->fetchColumn();
    } catch (Throwable $e) {
        store_fail('home_banner_not_ready', 503);
    }
    // Switched ON with nothing to show would draw nothing and look broken: say so instead.
    // (Outside the try below on purpose, so a refusal can never be relabelled "not ready".)
    if ($enabled && $product === '' && $text['title_en'] === '' && $text['title_ar'] === ''
        && $img === null && (!$had || $removeImage)) {
        store_fail('banner_needs_content');
    }
    try {
        $cols = ['enabled' => $enabled, 'product' => $product !== '' ? $product : null, 'href' => $href] + $text;
        $sql = 'insert into home_banner (id, ' . implode(', ', array_keys($cols)) . ') values (1, '
             . implode(', ', array_fill(0, count($cols), '?')) . ') on duplicate key update '
             . implode(', ', array_map(fn ($c) => "$c = values($c)", array_keys($cols)));
        $db->prepare($sql)->execute(array_values($cols));
        if ($img !== null) {
            $u = $db->prepare('update home_banner set image = ?, image_type = ?, image_w = ?, image_h = ?, etag = ? where id = 1');
            $u->bindValue(1, $img['bytes'], PDO::PARAM_LOB);
            $u->bindValue(2, $img['type']);
            $u->bindValue(3, $img['w'], PDO::PARAM_INT);
            $u->bindValue(4, $img['h'], PDO::PARAM_INT);
            $u->bindValue(5, md5($img['bytes']));
            $u->execute();
        } elseif ($removeImage) {
            $db->exec('update home_banner set image = null, image_type = null, image_w = null, image_h = null, etag = null where id = 1');
        }
    } catch (Throwable $e) {
        error_log('home_banner_save: ' . $e->getMessage());
        store_fail('home_banner_not_ready', 503);
    }
    store_out(['ok' => true, 'banner' => store_home_banner_public($db)]);
}

if ($r === 'brands') {
    store_out($db->query(
        'select id, slug, name_en, name_ar, logo, active, sort from brands order by sort, name_en'
    )->fetchAll());
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

// Show it, or stop showing it. Never a delete: a brand with orders behind it
// is history, and disabling is the reversible answer.
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

// ---------------------------------------------- brand logos from a folder
// "select the images from file manager then assign their brand at backend".
// images/_uploads/ is where the owner drops any number of pictures at once
// through Hostinger's File Manager, in no particular naming order; these two
// routes are how /backends turns that folder into a picker.
//
// LISTED AS THUMBNAILS, NOT AS SEPARATE URLS. A candidate image cannot be
// pointed at with a plain <img src="admin.php?r=..."> the way a public asset
// is — every admin.php route sits behind the X-Sporta-Admin header and the
// session cookie, and an <img> tag can send neither. So each candidate
// carries its own data: URI in this response, exactly the shape brands.logo
// is already stored in, and the picker never makes a second request to show
// what it just listed.
if ($r === 'brand_image_candidates') {
    $out = [];
    foreach (store_brand_upload_candidates() as $c) {
        $bytes = @file_get_contents($c['path']);
        if ($bytes === false) continue;
        // A 200px thumbnail for the grid, never the full file — the same
        // width store_image_thumb() already names for "the queued-upload
        // strip". null means the shop cannot make one; the original bytes
        // are still small enough to show, the same fallback the function's
        // own header describes.
        $thumb = store_image_thumb($bytes, 200);
        $dataUri = $thumb !== null
            ? 'data:image/' . $thumb[1] . ';base64,' . base64_encode($thumb[0])
            : 'data:' . $c['mime'] . ';base64,' . base64_encode($bytes);
        $out[] = ['name' => $c['name'], 'mtime' => $c['mtime'], 'bytes' => $c['bytes'], 'dataUri' => $dataUri];
    }
    store_out($out);
}

if ($r === 'brand_image_assign' && $method === 'POST') {
    $b = store_body();
    $name = (string) ($b['name'] ?? '');
    $brandId = (int) ($b['brand_id'] ?? 0);

    $path = store_brand_upload_path($name);
    $mime = $path !== null ? store_brand_logo_mime($path) : null;
    if ($mime === null) store_fail('image_not_found', 404);

    $q = $db->prepare('select id from brands where id = ?');
    $q->execute([$brandId]);
    if (!$q->fetch()) store_fail('brand_not_found', 404);

    $bytes = file_get_contents($path);
    if ($bytes === false) store_fail('image_not_found', 404);

    // ONLY the logo column. brand_save's own comment warns that route blanks
    // name_en/name_ar/slug if a caller resends the logo without them; this
    // route never calls brand_save and never touches those three, so that
    // trap does not apply to it.
    $db->prepare('update brands set logo = ? where id = ?')
       ->execute(['data:' . $mime . ';base64,' . base64_encode($bytes), $brandId]);

    // ARCHIVED, NOT DELETED — the standing rule for removing anything from
    // this server's disk. A second assignment of the same picture, or an
    // owner who wants the original file back, both stay possible; a plain
    // unlink() would not allow either.
    $archiveDir = dirname($path) . '/_assigned';
    if (!is_dir($archiveDir)) @mkdir($archiveDir, 0755, true);
    $dest = $archiveDir . '/' . basename($path);
    $n = 1;
    while (file_exists($dest)) {
        $n++;
        $dest = $archiveDir . '/' . pathinfo($path, PATHINFO_FILENAME) . '-' . $n
              . (pathinfo($path, PATHINFO_EXTENSION) !== '' ? '.' . pathinfo($path, PATHINFO_EXTENSION) : '');
    }
    @rename($path, $dest);

    $q = $db->prepare('select id, slug, name_en, name_ar, logo, active, sort from brands where id = ?');
    $q->execute([$brandId]);
    store_out($q->fetch());
}

if ($r === 'customer' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    // Column allowlist — an admin edits the delivery details, not the money.
    $allowed = ['customer_name','customer_phone','customer_email','customer_governorate','customer_area',
                'customer_block','customer_street','customer_building',
                'customer_floor','customer_flat','customer_note'];
    $sets = []; $args = [];
    foreach (($b['fields'] ?? []) as $k => $v) {
        if (!in_array($k, $allowed, true)) continue;
        // The email is the one field here that is posted somewhere rather than
        // read by a driver, so a typo is not a cosmetic problem: it lands next
        // to a header in a mail() call. Validated with the same function the
        // checkout uses, and a bad one is refused rather than stored.
        if ($k === 'customer_email' && (string)$v !== '') {
            $v = store_email((string)$v);
            if ($v === null) store_fail('invalid_email');
        }
        $sets[] = "`$k` = ?"; $args[] = $v === '' ? null : (string)$v;
    }
    if (!$sets) store_fail('nothing_to_update');
    $args[] = $id;
    $db->prepare('update orders set ' . implode(', ', $sets) . ' where id = ?')->execute($args);
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
    // cost_aed IS included here — this is the admin, behind the session; the
    // public ?r=stock endpoint is the one that must never select it.
    $rows = $db->query(
        'select v.sku, v.slug, p.name_en, v.size, v.stock, v.cost_aed
           from product_variants v left join products p on p.slug = v.slug
          order by v.slug, v.size'
    )->fetchAll();
    foreach ($rows as &$row) { $row['stock'] = (int)$row['stock']; }
    store_out($rows);
}

if ($r === 'set_stock' && $method === 'POST') {
    $b = store_body();
    $stock = (int)($b['stock'] ?? -1);
    if ($stock < 0) store_fail('stock_cannot_be_negative');
    // The RPC discipline kept: only the count moves. Not the SKU, not the
    // slug, not the cost.
    $was = $db->prepare('select slug, size, stock from product_variants where sku = ?');
    $was->execute([(string)($b['sku'] ?? '')]);
    $wasRow = $was->fetch();
    $q = $db->prepare('update product_variants set stock = ? where sku = ?');
    $q->execute([$stock, (string)($b['sku'] ?? '')]);
    if ($wasRow) store_stock_log($db, (string)$b['sku'], $wasRow['slug'], $wasRow['size'],
                                 $stock - (int)$wasRow['stock'], $stock, 'set', $admin['email'] ?? null);
    if ($q->rowCount() === 0) {
        $chk = $db->prepare('select 1 from product_variants where sku = ?');
        $chk->execute([(string)($b['sku'] ?? '')]);
        if (!$chk->fetch()) store_fail('sku_not_found');
    }
    $q2 = $db->prepare('select sku, slug, size, stock from product_variants where sku = ?');
    $q2->execute([(string)($b['sku'] ?? '')]);
    store_out($q2->fetch());
}

// CREATE the size ladder, which nothing could do until now.
//
// THE GAP THIS CLOSES. product_save() writes no product_variants rows and
// set_stock() only moves one that already exists — it answers sku_not_found,
// correctly, on a garment that has no ladder. So a product added through
// /backends had NO sizes for a shopper to choose from, and was stock-UNTRACKED:
// store_stock_claim() skips a slug with no rows by design, so it could be
// ordered in any quantity forever. The only way to give it sizes was
// phpMyAdmin, once per size, per garment. That is 46 products' worth of typing
// and the reason the catalogue's ladders were never finished.
//
// The SKU is generated, never accepted from the client. It is the primary key
// and the handle set_stock() uses, and letting the browser name it invites a
// collision with another garment's row — one shop's ladder silently editing
// another's. slug+size is already unique in every way that matters, so the key
// is derived from exactly that.
if ($r === 'variant_save' && $method === 'POST') {
    $b = store_body();
    $slug = store_slug((string)($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');
    $size = strtoupper(trim((string)($b['size'] ?? '')));
    // The same list the CHECK constraint and the order path use. Read from the
    // constant rather than retyped, so a size added in one place cannot be
    // creatable here and unorderable at checkout.
    if (!in_array($size, store_rule($db, 'sizes'), true)) store_fail('invalid_size');

    // The garment has to exist. Without this the ladder can be built against a
    // typo'd slug, where it is invisible to the shop and to this screen's own
    // product list, and looks for all the world like the save silently failed.
    $chk = $db->prepare('select 1 from products where slug = ?');
    $chk->execute([$slug]);
    if (!$chk->fetch()) store_fail('product_not_found');

    $stock = (int)($b['stock'] ?? 0);
    if ($stock < 0) store_fail('stock_cannot_be_negative');
    // A wholesale cost is optional and is the one commercially sensitive number
    // in the schema. Null, never 0, when it is not given: 0 is a claim that the
    // garment cost nothing, and it would be believed by anything that averages.
    $cost = ($b['cost_aed'] ?? '') === '' || $b['cost_aed'] === null
        ? null : number_format((float)$b['cost_aed'], 2, '.', '');
    if ($cost !== null && (float)$cost < 0) store_fail('invalid_cost');

    // Capped at 30 so the key always fits varchar(30). Sizes are at most 3
    // characters plus the dash, so the slug gets 26.
    $sku = strtoupper(substr($slug, 0, 26) . '-' . $size);
    // A SIZE THAT ALREADY HAS A ROW IS EDITED, UNDER THE SKU IT ALREADY HAS. A shop
    // whose stock was imported from a supplier carries codes like A-TEK-BL-M, not
    // the slug-derived TEKNO-SHORTS-BLACK-M; deriving the key here made a SECOND
    // row for the same garment and size (two "M" lines, the old one still at its
    // old count, and stock_claim decrementing both). Found while testing the
    // inventory tools against exactly such a product.
    $existingSku = $db->prepare('select sku from product_variants where slug = ? and size = ? order by sku limit 1');
    $existingSku->execute([$slug, $size]);
    $found = $existingSku->fetchColumn();
    if ($found !== false) $sku = (string)$found;

    // ON DUPLICATE KEY on the SKU, so saving the same size twice EDITS rather
    // than erroring — the admin screen re-saves a row the operator is editing,
    // and a second click must not be a failure. The stock is set, not added:
    // this screen shows a number and writes back the number shown.
    $prev = $db->prepare('select stock from product_variants where sku = ?');
    $prev->execute([$sku]);
    $prevStock = $prev->fetchColumn();
    $q = $db->prepare(
        'insert into product_variants (sku, slug, size, stock, cost_aed)
              values (?, ?, ?, ?, ?)
         on duplicate key update stock = values(stock), cost_aed = values(cost_aed)'
    );
    $q->execute([$sku, $slug, $size, $stock, $cost]);
    store_stock_log($db, $sku, $slug, $size, $stock - ($prevStock === false ? 0 : (int)$prevStock), $stock, 'variant', $admin['email'] ?? null);

    $q2 = $db->prepare('select sku, slug, size, stock, cost_aed from product_variants where sku = ?');
    $q2->execute([$sku]);
    store_out($q2->fetch());
}

// ------------------------------------------------ colour, fits and sizes, picked
//
// "Make selectable and static size and shape and colour at backend" — the owner,
// 2026-09-29. Three pick-lists per product, every one built from a list the
// SERVER owns, so nothing here is typed and nothing typed here can reach the
// shop:
//   colour  a key of STORE_COLOURS, kept in product_attrs (one row per product);
//   fits    a subset of the shop's fits (the `rules` row), NULL = all of them;
//   sizes   the product's rows in product_variants, drawn from the shop's sizes.
//
// ONE WRITE ROUTE, and it touches nothing but those: not the product row (a
// full upsert three panels share), not a price, a photo or a stock count. A
// size already in stock is kept as it is; a size removed must be at stock 0 or
// the save is refused BY NAME before anything is written, because deleting a
// row with 12 in stock is deleting 12 garments from the count.
if ($r === 'product_attrs') {
    $ready = true;
    $rows = [];
    try {
        foreach ($db->query('select slug, colour, fits from product_attrs')->fetchAll() as $x) {
            $rows[$x['slug']] = ['colour' => $x['colour'], 'fits' => $x['fits'] === null || $x['fits'] === '' ? null : explode(',', $x['fits'])];
        }
    } catch (Throwable $e) {
        $ready = false;   // table not created on this shop yet: say so, do not 500 the screen
    }
    $sizes = [];
    foreach ($db->query('select slug, size, stock from product_variants order by slug, sku')->fetchAll() as $v) {
        $sizes[$v['slug']][] = ['size' => $v['size'], 'stock' => (int)$v['stock']];
    }
    $cols = [];
    foreach (STORE_COLOURS as $k => [$en, $ar, $hex]) $cols[] = ['key' => $k, 'en' => $en, 'ar' => $ar, 'hex' => $hex];
    store_out(['ready' => $ready, 'colours' => $cols, 'sizes' => store_rule($db, 'sizes'),
               'fits' => store_rule($db, 'fits'), 'rows' => (object)$rows, 'variants' => (object)$sizes]);
}

if ($r === 'product_attrs_save' && $method === 'POST') {
    $b = store_body();
    $slug = store_slug((string)($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');
    $chk = $db->prepare('select 1 from products where slug = ?');
    $chk->execute([$slug]);
    if (!$chk->fetch()) store_fail('product_not_found');

    $colour = trim((string)($b['colour'] ?? ''));
    if ($colour !== '' && !isset(STORE_COLOURS[$colour])) store_fail('invalid_colour');

    $allowedFits = store_rule($db, 'fits');
    $fits = [];
    foreach ((array)($b['fits'] ?? []) as $f) {
        $f = (string)$f;
        if (!in_array($f, $allowedFits, true)) store_fail('invalid_fit');
        $fits[$f] = true;
    }
    $fits = array_keys($fits);

    $allowedSizes = store_rule($db, 'sizes');
    $want = [];
    foreach ((array)($b['sizes'] ?? []) as $sz) {
        $sz = strtoupper(trim((string)$sz));
        if (!in_array($sz, $allowedSizes, true)) store_fail('invalid_size');
        $want[$sz] = true;
    }
    if (!$want) store_fail('at_least_one_size');

    $have = $db->prepare('select size, stock from product_variants where slug = ?');
    $have->execute([$slug]);
    $haveMap = [];
    foreach ($have->fetchAll() as $v) $haveMap[$v['size']] = (int)$v['stock'];
    foreach ($haveMap as $sz => $stock) {
        if (!isset($want[$sz]) && $stock > 0) store_fail('size_has_stock:' . $sz . ':' . $stock);
    }

    try {
        $db->beginTransaction();
        $db->prepare('insert into product_attrs (slug, colour, fits) values (?, ?, ?)
                      on duplicate key update colour = values(colour), fits = values(fits)')
           ->execute([$slug, $colour === '' ? null : $colour, $fits ? implode(',', $fits) : null]);
        // Same SKU formula as variant_save, or the panel later writes a SECOND row
        // for the same garment and size.
        $add = $db->prepare('insert into product_variants (sku, slug, size, stock, cost_aed) values (?, ?, ?, 0, null)
                             on duplicate key update sku = sku');
        foreach (array_keys($want) as $sz) {
            if (!isset($haveMap[$sz])) $add->execute([strtoupper(substr($slug, 0, 26) . '-' . $sz), $slug, $sz]);
        }
        $drop = $db->prepare('delete from product_variants where slug = ? and size = ? and stock = 0');
        foreach (array_keys($haveMap) as $sz) {
            if (!isset($want[$sz])) $drop->execute([$slug, $sz]);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('product_attrs_save: ' . $e->getMessage());
        store_fail('product_attrs_not_ready', 503);
    }
    store_out(['ok' => true, 'slug' => $slug, 'colour' => $colour === '' ? null : $colour, 'fits' => $fits ?: null,
               'sizes' => array_keys($want)]);
}

// Remove a size from the ladder.
//
// REFUSED WHILE STOCK IS ON IT, unless the caller says so explicitly. Deleting
// a variant that holds stock is indistinguishable, afterwards, from that stock
// having been sold — the row is simply gone and the count with it. A garment
// discontinued at 12 pieces is a stocktake question, not a click.
//
// The row is NOT protected by a foreign key the way products are: order_items
// records a size STRING, not a variant id, so deleting the ladder does not
// touch order history and an old order keeps saying 'L' for ever. That is why
// this check has to live here.
if ($r === 'variant_delete' && $method === 'POST') {
    $b = store_body();
    $sku = (string)($b['sku'] ?? '');
    $q = $db->prepare('select slug, size, stock from product_variants where sku = ?');
    $q->execute([$sku]);
    $row = $q->fetch();
    if (!$row) store_fail('sku_not_found');
    if ((int)$row['stock'] > 0 && empty($b['force'])) store_fail('variant_has_stock');
    $db->prepare('delete from product_variants where sku = ?')->execute([$sku]);
    store_stock_log($db, $sku, $row['slug'], $row['size'], -(int)$row['stock'], 0, 'delete', $admin['email'] ?? null);
    store_out(['deleted' => $sku]);
}

// ---------------------------------------------------- inventory: tools and history
//
// "improve inventory" — the owner, 2026-09-30: find and edit faster, low-stock
// warnings, a history of changes, and spreadsheet import/export. The screen
// itself is the bundle's (a table of every size, an input per stock count); these
// routes are what the overlay (assets/inventory-tools.js) reads and writes.
//
// THE LOW-STOCK LINE is one number in the `inventory` settings row, default 5.
// It only COLOURS things and counts them: nothing hides a product or refuses an
// order because of it (that is `stock = 0`, and the shop already does that).
if ($r === 'inventory_meta') {
    $set = store_setting($db, 'inventory');
    $low = isset($set['low']) ? max(0, min(999, (int)$set['low'])) : 5;
    $hidden = $db->query('select slug from products where active = 0')->fetchAll(PDO::FETCH_COLUMN);
    $logReady = true;
    try { $db->query('select 1 from stock_log limit 1'); } catch (Throwable $e) { $logReady = false; }
    // The badge count (2026-10-04): sizes of ACTIVE products at or under the line, and how many of those are out.
    $att = $db->prepare('select count(*) as n, sum(v.stock = 0) as o from product_variants v join products p on p.slug = v.slug where p.active = 1 and v.stock <= ?');
    $att->execute([$low]); $a = $att->fetch();
    $purchasing = true;
    try { $db->query('select 1 from purchase_orders limit 1'); } catch (Throwable $e) { $purchasing = false; }
    store_out(['low' => $low, 'hidden' => array_values($hidden), 'log_ready' => $logReady,
               'attention' => (int) ($a['n'] ?? 0), 'out' => (int) ($a['o'] ?? 0),
               'alert_email' => (string) ($set['alert_email'] ?? ''), 'alert_sent_on' => (string) ($set['alert_sent_on'] ?? ''),
               'purchasing_ready' => $purchasing]);
}

if ($r === 'inventory_low_save' && $method === 'POST') {
    $rawLow = store_body()['low'] ?? null;
    if (!is_int($rawLow) && !(is_string($rawLow) && preg_match('/^\d{1,3}$/', trim($rawLow)))) store_fail('invalid_low');
    $low = (int)$rawLow;
    if ($low < 0 || $low > 999) store_fail('invalid_low');
    $set = store_setting($db, 'inventory');
    $set['low'] = $low;
    // The alert address (cron-lowstock.php): optional; a bad one is refused by name, an empty one clears it.
    $b0 = store_body();
    if (array_key_exists('alert_email', $b0)) {
        $ae = trim((string) $b0['alert_email']);
        if ($ae !== '' && (mb_strlen($ae) > 120 || !filter_var($ae, FILTER_VALIDATE_EMAIL))) store_fail('invalid_alert_email');
        $set['alert_email'] = $ae;
    }
    store_setting_save($db, 'inventory', $set);
    store_out(['ok' => true, 'low' => $low, 'alert_email' => (string) ($set['alert_email'] ?? '')]);
}

if ($r === 'inventory_log') {
    $slug = trim((string)($_GET['slug'] ?? ''));
    $limit = max(1, min(200, (int)($_GET['limit'] ?? 60)));
    try {
        $sql = 'select l.id, l.at, l.sku, l.slug, p.name_en, l.size, l.delta, l.stock_after, l.reason, l.actor, l.ref
                  from stock_log l left join products p on p.slug = l.slug'
             . ($slug !== '' ? ' where l.slug = ?' : '') . ' order by l.id desc limit ' . $limit;
        $q = $db->prepare($sql);
        $q->execute($slug !== '' ? [$slug] : []);
        $rows = $q->fetchAll();
    } catch (Throwable $e) {
        store_out(['ready' => false, 'rows' => []]);
    }
    foreach ($rows as &$row) { $row['delta'] = (int)$row['delta']; $row['stock_after'] = $row['stock_after'] === null ? null : (int)$row['stock_after']; }
    store_out(['ready' => true, 'rows' => $rows]);
}

// ONE ROUTE FOR "SAVE ALL SIZES OF A PRODUCT" AND "APPLY A SPREADSHEET". A list of
// {sku, stock}; `dry` answers what WOULD change and writes nothing (the import's
// preview). An apply is ALL OR NOTHING: one unknown SKU, one negative or
// non-numeric count refuses the whole batch with every problem named, because a
// spreadsheet half-applied is a stock room nobody can reconcile. Only the COUNT
// moves — never the SKU, the slug, the cost or the sizes offered.
if ($r === 'inventory_apply' && $method === 'POST') {
    $b = store_body();
    $changes = is_array($b['changes'] ?? null) ? $b['changes'] : [];
    if (!$changes) store_fail('nothing_to_apply');
    if (count($changes) > 600) store_fail('too_many_rows');
    $reason = in_array($b['reason'] ?? '', ['bulk', 'import', 'undo', 'scan'], true) ? $b['reason'] : 'bulk';
    $dry = !empty($b['dry']);
    $get = $db->prepare('select slug, size, stock from product_variants where sku = ?');
    $out = []; $bad = 0; $seen = [];
    foreach ($changes as $c) {
        $sku = trim((string)($c['sku'] ?? ''));
        $raw = $c['stock'] ?? null;
        $row = ['sku' => $sku, 'status' => 'ok'];
        if ($sku === '' || isset($seen[$sku])) { $row['status'] = $sku === '' ? 'no_sku' : 'duplicate_sku'; $bad++; $out[] = $row; continue; }
        $seen[$sku] = true;
        if (!is_int($raw) && !(is_string($raw) && preg_match('/^\d{1,7}$/', trim($raw)))) { $row['status'] = 'invalid_stock'; $bad++; $out[] = $row; continue; }
        $new = (int)$raw;
        if ($new < 0 || $new > 1000000) { $row['status'] = 'invalid_stock'; $bad++; $out[] = $row; continue; }
        $get->execute([$sku]);
        $cur = $get->fetch();
        if (!$cur) { $row['status'] = 'unknown_sku'; $bad++; $out[] = $row; continue; }
        $row += ['slug' => $cur['slug'], 'size' => $cur['size'], 'before' => (int)$cur['stock'], 'after' => $new];
        if ($row['before'] === $new) $row['status'] = 'same';
        $out[] = $row;
    }
    $changed = count(array_filter($out, fn($r0) => $r0['status'] === 'ok'));
    if ($dry) store_out(['dry' => true, 'rows' => $out, 'errors' => $bad, 'changed' => $changed]);
    if ($bad > 0) store_out(['error' => 'batch_refused', 'rows' => $out, 'errors' => $bad, 'changed' => 0], 400);
    try {
        $db->beginTransaction();
        $upd = $db->prepare('update product_variants set stock = ? where sku = ?');
        foreach ($out as $row) {
            if ($row['status'] !== 'ok') continue;
            $upd->execute([$row['after'], $row['sku']]);
            store_stock_log($db, $row['sku'], $row['slug'], $row['size'], $row['after'] - $row['before'], $row['after'], $reason, $admin['email'] ?? null);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('inventory_apply: ' . $e->getMessage());
        store_fail('failed', 500);
    }
    store_out(['ok' => true, 'rows' => $out, 'errors' => 0, 'changed' => $changed]);
}

// ------------------------------------------------------------- purchasing
// 2026-10-04, "improve inventory" → purchasing & suppliers. Tables in api/purchasing.mysql.sql. Every
// route answers `purchasing_not_ready` (503) until they exist. A purchase order is a plan until it is
// RECEIVED; receiving is the only moment stock moves, through the same stock_log every other change
// uses (reason 'purchase', ref 'PO-<id>'). The wholesale cost stays inside the gate.
function admin_purchasing_ready(PDO $db): void {
    try { $db->query('select 1 from purchase_orders limit 1'); } catch (Throwable $e) { store_fail('purchasing_not_ready', 503); }
}
if ($r === 'suppliers') {
    admin_purchasing_ready($db);
    $rows = $db->query('select s.id, s.name, s.contact, s.lead_days, s.note, (select count(*) from variant_supplier vs where vs.supplier_id = s.id) as skus from suppliers s order by s.name')->fetchAll();
    foreach ($rows as &$x) { $x['id'] = (int) $x['id']; $x['lead_days'] = (int) $x['lead_days']; $x['skus'] = (int) $x['skus']; }
    store_out($rows);
}
if ($r === 'supplier_save' && $method === 'POST') {
    admin_purchasing_ready($db);
    $b = store_body();
    $id = (int) ($b['id'] ?? 0);
    $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 80);
    if ($name === '') store_fail('supplier_name_required');
    $contact = mb_substr(trim((string) ($b['contact'] ?? '')), 0, 160);
    $lead = (int) ($b['lead_days'] ?? 14);
    if ($lead < 0 || $lead > 365) store_fail('invalid_lead_days');
    $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 300);
    if ($id > 0) {
        $db->prepare('update suppliers set name = ?, contact = ?, lead_days = ?, note = ? where id = ?')->execute([$name, $contact, $lead, $note, $id]);
    } else {
        $db->prepare('insert into suppliers (name, contact, lead_days, note) values (?, ?, ?, ?)')->execute([$name, $contact, $lead, $note]);
        $id = (int) $db->lastInsertId();
    }
    // Which sizes this supplier provides: a list of SKUs replaces the previous list for THIS supplier only.
    if (array_key_exists('skus', $b) && is_array($b['skus'])) {
        $known = $db->prepare('select 1 from product_variants where sku = ?');
        $db->prepare('delete from variant_supplier where supplier_id = ?')->execute([$id]);
        $put = $db->prepare('insert into variant_supplier (sku, supplier_id) values (?, ?) on duplicate key update supplier_id = values(supplier_id)');
        foreach (array_slice($b['skus'], 0, 2000) as $sku) {
            $sku = trim((string) $sku); if ($sku === '') continue;
            $known->execute([$sku]); if (!$known->fetchColumn()) store_fail('unknown_sku:' . $sku);
            $put->execute([$sku, $id]);
        }
    }
    store_out(['ok' => true, 'id' => $id]);
}
if ($r === 'supplier_delete' && $method === 'POST') {
    admin_purchasing_ready($db);
    $id = (int) (store_body()['id'] ?? 0);
    $open = $db->prepare("select count(*) from purchase_orders where supplier_id = ? and status = 'open'"); $open->execute([$id]);
    if ((int) $open->fetchColumn() > 0) store_fail('supplier_has_open_orders');
    $db->prepare('delete from suppliers where id = ?')->execute([$id]);
    store_out(['ok' => true]);
}
// WHAT TO REORDER. For every size of an active product: units sold in the last 30 days (paid or cash
// orders that were not cancelled), the daily rate, the days of cover left, and a suggested quantity
// when cover is short of the supplier's lead time plus a 14-day cushion. Suggested = ceil(rate ×
// (lead + 14)) − stock − already on open orders, never under 1 when the size is sold out and has
// sold at all. Pure arithmetic over the shop's own orders — no forecast, no model.
if ($r === 'reorder_suggestions') {
    admin_purchasing_ready($db);
    $days = max(7, min(180, (int) ($_GET['days'] ?? 30)));
    $sold = $db->prepare("select p.slug, oi.size, sum(oi.qty) as n from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
                          where o.created_at >= date_sub(now(), interval ? day) and o.fulfilment_status <> 'cancelled' and o.payment_status in ('paid','pending')
                          group by p.slug, oi.size");
    $sold->execute([$days]);
    $rate = [];
    foreach ($sold->fetchAll() as $x) $rate[$x['slug'] . '|' . ($x['size'] ?? '')] = (int) $x['n'];
    $onOrder = [];
    foreach ($db->query("select i.sku, sum(i.qty) as q from purchase_order_items i join purchase_orders po on po.id = i.po_id where po.status = 'open' group by i.sku")->fetchAll() as $x) $onOrder[$x['sku']] = (int) $x['q'];
    $rows = $db->query('select v.sku, v.slug, v.size, v.stock, v.cost_aed, p.name_en, p.price, vs.supplier_id, s.name as supplier, coalesce(s.lead_days, 14) as lead_days
                        from product_variants v join products p on p.slug = v.slug left join variant_supplier vs on vs.sku = v.sku left join suppliers s on s.id = vs.supplier_id
                        where p.active = 1 order by p.name_en, v.sku')->fetchAll();
    $out = [];
    foreach ($rows as $v) {
        $n = $rate[$v['slug'] . '|' . $v['size']] ?? 0;
        $daily = $n / $days;
        $stock = (int) $v['stock']; $lead = (int) $v['lead_days']; $open = $onOrder[$v['sku']] ?? 0;
        $cover = $daily > 0 ? ($stock + $open) / $daily : null;
        $horizon = $lead + 14;
        $suggest = 0;
        if ($daily > 0 && ($cover === null || $cover < $horizon)) $suggest = max(0, (int) ceil($daily * $horizon) - $stock - $open);
        if ($stock === 0 && $n > 0 && $suggest < 1) $suggest = 1;
        if ($suggest <= 0) continue;
        $out[] = ['sku' => $v['sku'], 'slug' => $v['slug'], 'name_en' => $v['name_en'], 'size' => $v['size'], 'stock' => $stock, 'on_order' => $open,
                  'sold' => $n, 'per_day' => round($daily, 2), 'days_cover' => $cover === null ? null : (int) floor($cover),
                  'suggest' => $suggest, 'supplier_id' => $v['supplier_id'] === null ? null : (int) $v['supplier_id'], 'supplier' => $v['supplier'], 'lead_days' => $lead,
                  'cost_aed' => $v['cost_aed'] === null ? null : (float) $v['cost_aed']];
    }
    usort($out, fn ($a, $b2) => ($a['days_cover'] ?? -1) <=> ($b2['days_cover'] ?? -1) ?: $b2['suggest'] <=> $a['suggest']);
    store_out(['days' => $days, 'rows' => $out]);
}
if ($r === 'po_list') {
    admin_purchasing_ready($db);
    $status = in_array($_GET['status'] ?? '', ['open', 'received', 'cancelled'], true) ? $_GET['status'] : null;
    $sql = 'select po.id, po.supplier_id, s.name as supplier, po.status, po.note, po.expected_on, po.created_by, po.created_at, po.received_at,
                   (select count(*) from purchase_order_items i where i.po_id = po.id) as lines_n, (select coalesce(sum(i.qty),0) from purchase_order_items i where i.po_id = po.id) as units
            from purchase_orders po left join suppliers s on s.id = po.supplier_id' . ($status ? ' where po.status = ?' : '') . ' order by po.status = "open" desc, po.id desc limit 100';
    $q = $db->prepare($sql); $q->execute($status ? [$status] : []);
    $pos = $q->fetchAll();
    $items = $db->prepare('select i.sku, i.qty, i.cost_aed, v.size, v.slug, p.name_en from purchase_order_items i left join product_variants v on v.sku = i.sku left join products p on p.slug = v.slug where i.po_id = ? order by p.name_en, v.sku');
    foreach ($pos as &$po) {
        $po['id'] = (int) $po['id']; $po['lines_n'] = (int) $po['lines_n']; $po['units'] = (int) $po['units'];
        $items->execute([$po['id']]);
        $po['items'] = array_map(fn ($i) => ['sku' => $i['sku'], 'qty' => (int) $i['qty'], 'cost_aed' => $i['cost_aed'] === null ? null : (float) $i['cost_aed'], 'size' => $i['size'], 'slug' => $i['slug'], 'name_en' => $i['name_en']], $items->fetchAll());
    }
    store_out($pos);
}
if ($r === 'po_save' && $method === 'POST') {
    admin_purchasing_ready($db);
    $b = store_body();
    $id = (int) ($b['id'] ?? 0);
    $supplier = isset($b['supplier_id']) && (int) $b['supplier_id'] > 0 ? (int) $b['supplier_id'] : null;
    if ($supplier !== null) { $k = $db->prepare('select 1 from suppliers where id = ?'); $k->execute([$supplier]); if (!$k->fetchColumn()) store_fail('unknown_supplier'); }
    $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 300);
    // A plain date (the card's date box), optional; anything else is refused by name.
    $expRaw = trim((string) ($b['expected_on'] ?? ''));
    $expected = null;
    if ($expRaw !== '') {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $expRaw, $dm) || !checkdate((int) $dm[2], (int) $dm[3], (int) $dm[1])) store_fail('invalid_expected_on');
        $expected = $expRaw;
    }
    $items = is_array($b['items'] ?? null) ? $b['items'] : [];
    if (!$items) store_fail('po_empty');
    if (count($items) > 300) store_fail('too_many_rows');
    $known = $db->prepare('select 1 from product_variants where sku = ?');
    $clean = []; $seen = [];
    foreach ($items as $i => $it) {
        $sku = trim((string) ($it['sku'] ?? '')); $qty = (int) ($it['qty'] ?? 0);
        if ($sku === '' || isset($seen[$sku])) store_fail('po_line_' . ($i + 1) . ($sku === '' ? '_no_sku' : '_duplicate'));
        $seen[$sku] = true;
        $known->execute([$sku]); if (!$known->fetchColumn()) store_fail('unknown_sku:' . $sku);
        if ($qty < 1 || $qty > 100000) store_fail('po_line_' . ($i + 1) . '_qty');
        $cost = isset($it['cost_aed']) && $it['cost_aed'] !== '' && $it['cost_aed'] !== null ? (float) $it['cost_aed'] : null;
        if ($cost !== null && ($cost < 0 || $cost > 1000000)) store_fail('po_line_' . ($i + 1) . '_cost');
        $clean[] = [$sku, $qty, $cost];
    }
    try {
        $db->beginTransaction();
        if ($id > 0) {
            $st = $db->prepare('select status from purchase_orders where id = ? for update'); $st->execute([$id]);
            $cur = $st->fetchColumn();
            if ($cur === false) store_fail('po_not_found', 404);
            if ($cur !== 'open') store_fail('po_not_open');
            $db->prepare('update purchase_orders set supplier_id = ?, note = ?, expected_on = ? where id = ?')->execute([$supplier, $note, $expected, $id]);
            $db->prepare('delete from purchase_order_items where po_id = ?')->execute([$id]);
        } else {
            $db->prepare('insert into purchase_orders (supplier_id, note, expected_on, created_by) values (?, ?, ?, ?)')->execute([$supplier, $note, $expected, $admin['email'] ?? null]);
            $id = (int) $db->lastInsertId();
        }
        $ins = $db->prepare('insert into purchase_order_items (po_id, sku, qty, cost_aed) values (?, ?, ?, ?)');
        foreach ($clean as [$sku, $qty, $cost]) $ins->execute([$id, $sku, $qty, $cost]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($e instanceof StoreFail) throw $e;
        error_log('po_save: ' . $e->getMessage()); store_fail('failed', 500);
    }
    store_out(['ok' => true, 'id' => $id, 'lines' => count($clean)]);
}
// RECEIVING: stock += qty for every line, in one transaction, each line logged. Idempotent by state:
// a PO already received answers po_not_open and moves nothing.
if ($r === 'po_receive' && $method === 'POST') {
    admin_purchasing_ready($db);
    $id = (int) (store_body()['id'] ?? 0);
    try {
        $db->beginTransaction();
        $st = $db->prepare('select status from purchase_orders where id = ? for update'); $st->execute([$id]);
        $cur = $st->fetchColumn();
        if ($cur === false) store_fail('po_not_found', 404);
        if ($cur !== 'open') store_fail('po_not_open');
        $lines = $db->prepare('select i.sku, i.qty, i.cost_aed, v.slug, v.size, v.stock from purchase_order_items i join product_variants v on v.sku = i.sku where i.po_id = ? for update');
        $lines->execute([$id]);
        $upd = $db->prepare('update product_variants set stock = stock + ?, cost_aed = coalesce(?, cost_aed) where sku = ?');
        $moved = 0;
        foreach ($lines->fetchAll() as $l) {
            $upd->execute([(int) $l['qty'], $l['cost_aed'], $l['sku']]);
            store_stock_log($db, (string) $l['sku'], (string) $l['slug'], (string) $l['size'], (int) $l['qty'], (int) $l['stock'] + (int) $l['qty'], 'purchase', $admin['email'] ?? null, 'PO-' . $id);
            $moved += (int) $l['qty'];
        }
        $db->prepare("update purchase_orders set status = 'received', received_at = now() where id = ?")->execute([$id]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($e instanceof StoreFail) throw $e;
        error_log('po_receive: ' . $e->getMessage()); store_fail('failed', 500);
    }
    store_out(['ok' => true, 'id' => $id, 'units' => $moved]);
}
if ($r === 'po_cancel' && $method === 'POST') {
    admin_purchasing_ready($db);
    $id = (int) (store_body()['id'] ?? 0);
    $n = $db->prepare("update purchase_orders set status = 'cancelled' where id = ? and status = 'open'"); $n->execute([$id]);
    if ($n->rowCount() === 0) store_fail('po_not_open');
    store_out(['ok' => true, 'id' => $id]);
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
                focal_x, focal_y, updated_at, image_mobile_hash, image_mobile_w, image_mobile_h
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
        $row['image_mobile'] = $row['image_mobile_hash']
            ? 'api.php?r=slide_image&id=' . $row['id'] . '&mobile=1&v=' . substr((string)$row['image_mobile_hash'], 0, 16)
            : null;
        $row['mobile_width']  = $row['image_mobile_w'] === null ? null : (int)$row['image_mobile_w'];
        $row['mobile_height'] = $row['image_mobile_h'] === null ? null : (int)$row['image_mobile_h'];
        unset($row['image_hash'], $row['image_w'], $row['image_h'],
              $row['image_mobile_hash'], $row['image_mobile_w'], $row['image_mobile_h']);
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

    // The phone composition, entirely optional and validated with the SAME
    // rigor as the desktop image — reusing store_data_image() rather than a
    // second, weaker check, per this project's own rule against inventing a
    // parallel path for a field that must be trusted just as much. Omitting
    // it on edit keeps whatever mobile image is already there, exactly like
    // the desktop field above; there is no way to send an empty string here
    // to WIPE it — that would need slide_delete or a dedicated clear, which
    // does not exist yet.
    $imageMobile = null;
    if (($b['image_mobile'] ?? '') !== '') {
        $imageMobile = store_data_image((string)$b['image_mobile'], STORE_HERO_MAX);
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
    if ($imageMobile !== null) {
        $fields['image_mobile']      = $imageMobile;
        $fields['image_mobile_hash'] = hash('sha256', $imageMobile);
        $fields['image_mobile_w']    = (int)($b['mobile_width'] ?? 0) ?: null;
        $fields['image_mobile_h']    = (int)($b['mobile_height'] ?? 0) ?: null;
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

// ------------------------------------------------------- product photographs
//
// The shoot for one garment: list, add, remove, reorder. Same shape as the
// slide routes above it, and the same rule — the bytes are a row, validated by
// store_data_image(), never a file. api.php?r=product_image serves them.
//
// Keyed on SLUG throughout, because that is what product_images stores and
// what the admin's product form already holds. The slug is checked against
// products on the way in, so a photograph cannot be filed under a garment that
// does not exist and then be invisible everywhere.
if ($r === 'product_images') {
    $slug = trim((string)($_GET['slug'] ?? ''));
    $q = $db->prepare(
        'select id, sort, image_hash, image_w, image_h
           from product_images where slug = ? order by sort, id'
    );
    $q->execute([$slug]);
    $rows = $q->fetchAll();
    foreach ($rows as &$row) {
        $row['id']   = (int)$row['id'];
        $row['sort'] = (int)$row['sort'];
        // The URL, not the base64 — the admin screen shows a strip of
        // thumbnails, and a dozen data: URIs in one JSON response is megabytes
        // down a connection in Kuwait to draw pictures the browser could have
        // cached. Identical URL to the storefront's, so it is very likely
        // already in cache.
        $row['url']  = 'api.php?r=product_image&id=' . $row['id']
                     . '&v=' . substr((string)$row['image_hash'], 0, 12);
        $row['width']  = $row['image_w'] === null ? null : (int)$row['image_w'];
        $row['height'] = $row['image_h'] === null ? null : (int)$row['image_h'];
        unset($row['image_hash'], $row['image_w'], $row['image_h']);
    }
    unset($row);
    store_out(['images' => $rows]);
}

if ($r === 'product_image_add' && $method === 'POST') {
    $b = store_body();
    $slug = trim((string)($b['slug'] ?? ''));

    $known = $db->prepare('select 1 from products where slug = ?');
    $known->execute([$slug]);
    if (!$known->fetchColumn()) store_fail('product_not_found');

    // The cap is counted BEFORE the insert and inside the same transaction as
    // it, so two tabs adding the twelfth and thirteenth photograph at the same
    // moment cannot both read eleven and both proceed. The same shape as the
    // single-use discount claim, for the same reason.
    $db->beginTransaction();
    $n = $db->prepare('select count(*) from product_images where slug = ? for update');
    $n->execute([$slug]);
    if ((int)$n->fetchColumn() >= STORE_PRODUCT_IMAGE_LIMIT) {
        $db->rollBack();
        store_fail('too_many_images');
    }

    // store_data_image() is the gate: png/jpeg/webp only, never SVG, and the
    // DECODED bytes must begin with that format's magic number. It throws
    // rather than returning null for anything present but invalid, so a
    // rejected photograph is an error the admin can read and not a save that
    // silently stored nothing.
    $image = store_data_image((string)($b['image'] ?? ''), STORE_PRODUCT_IMAGE_MAX);
    if ($image === null) { $db->rollBack(); store_fail('image_required'); }

    // Appended last. The first photograph in `sort` order is the main one, and
    // an upload quietly becoming the front of the shoot is not what anybody
    // means by "add a photo" — reordering is a separate, deliberate act.
    $next = $db->prepare('select coalesce(max(sort), -1) + 1 from product_images where slug = ?');
    $next->execute([$slug]);

    // Hashed in PHP, exactly as slide_save does it — one implementation of
    // "what is this photograph's cache key", not one here and a sha2() in SQL
    // that has to be trusted to agree with it.
    $hash = hash('sha256', $image);
    $ins = $db->prepare(
        'insert into product_images (slug, sort, image, image_hash, image_w, image_h)
         values (?, ?, ?, ?, ?, ?)'
    );
    $ins->execute([$slug, (int)$next->fetchColumn(), $image, $hash,
                   (int)($b['width'] ?? 0) ?: null, (int)($b['height'] ?? 0) ?: null]);
    $id = (int)$db->lastInsertId();
    $db->commit();

    store_out(['id' => $id, 'url' => 'api.php?r=product_image&id=' . $id . '&v=' . substr($hash, 0, 12)]);
}

if ($r === 'product_image_delete' && $method === 'POST') {
    $id = (int)(store_body()['id'] ?? 0);
    $del = $db->prepare('delete from product_images where id = ?');
    $del->execute([$id]);
    try { $db->prepare('delete from product_image_thumbs where image_id = ?')->execute([$id]); } catch (Throwable $e) { /* table optional */ }
    // Not an error when it is already gone: the admin may have deleted it in
    // another tab, and "it is not there" is the outcome that was asked for.
    store_out(['ok' => true, 'deleted' => $del->rowCount()]);
}

if ($r === 'product_image_reorder' && $method === 'POST') {
    $b = store_body();
    $slug = trim((string)($b['slug'] ?? ''));
    $ids = $b['ids'] ?? [];
    if ($slug === '' || !is_array($ids)) store_fail('bad_request');
    $db->beginTransaction();
    // `and slug = ?` is not decoration. Without it a crafted list of ids would
    // renumber photographs belonging to OTHER garments — scrambling a shoot
    // the admin was not looking at, with nothing on screen to show it had
    // happened.
    $up = $db->prepare('update product_images set sort = ? where id = ? and slug = ?');
    foreach (array_values($ids) as $i => $id) $up->execute([$i, (int)$id, $slug]);
    $db->commit();
    store_out(['ok' => true]);
}

// ------------------------------------------------------------------ settings
// How the slider plays, and the promo bar. Whitelisted by name and rebuilt
// field by field: a settings endpoint that stores whatever JSON it is handed
// is a place to park arbitrary data inside the shop's own configuration.
if ($r === 'settings_save' && $method === 'POST') {
    $b = store_body();
    $name = (string)($b['name'] ?? '');
    $v = is_array($b['value'] ?? null) ? $b['value'] : [];

    if ($name === 'theme') {
        // THE THEME. Twelve fields, and unlike the footer every one of them has
        // a SHAPE, so every one is validated rather than capped.
        //
        // A theme is not prose: a value that is not a colour does not look
        // wrong, it produces a declaration the browser discards, and the
        // owner sees no change and no error and concludes the feature is
        // broken. So a malformed value is REFUSED here, loudly, with the field
        // named — rather than stored and silently ignored by the stylesheet.
        //
        // EMPTY IS ALWAYS ALLOWED and always means "leave the built stylesheet
        // alone". That is the state every shop starts in and the way back from
        // an edit that turned out wrong, so clearing a field must never fail.
        //
        // THE TWO COLOUR FORMATS ARE NOT INTERCHANGEABLE, and this is the part
        // that would otherwise cost an afternoon. --brand is used as a plain
        // colour (`#e0561c`). --accent-text is consumed as
        // `hsl(var(--accent-text))`, so it must be a BARE HSL TRIPLE with no
        // hsl() and no commas — storing a hex there yields hsl(#e0561c), which
        // is not a colour, and the page loses its accent entirely.
        //
        // `accent` USED TO BE HERE AND IS GONE. Measured 2026-09-09: --accent
        // is declared on :root and read by NOTHING — `.text-accent` resolves to
        // --accent-text, and `var(--accent)` appears in no stylesheet in this
        // project. It was a field in the editor that changed the shop in no way
        // at all. Any value a shop already saved simply stops being written
        // back; it was inert the whole time.
        // ONE VALIDATOR FOR THREE THEMES, 2026-10-02. The row carries the
        // all-devices theme at the top and two optional overrides, `phone`
        // (below 768px) and `desktop` (768px and up), each held to exactly
        // the same rules — a device override is not a looser channel.
        $theme = static function (array $v): array {
        $err = null;
        $one = static function (string $k, string $re) use ($v, &$err): string {
            $raw = trim((string) ($v[$k] ?? ''));
            if ($raw === '' || $err !== null) return '';
            if (!preg_match($re, $raw)) { $err = $k; return ''; }
            return $raw;
        };

        $HEX = '/^#[0-9A-Fa-f]{6}$/';
        // "H S% L%" — the three numbers Tailwind expects, spaces only.
        $HSL = '/^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/';
        // A font NAME, not a stack: the shop self-hosts four faces and a stack
        // naming a fifth would silently fetch nothing and fall back. Letters,
        // digits, spaces and hyphens, and the browser gets the fallbacks.
        $FONT = '/^[A-Za-z0-9 \-]{2,40}$/';
        // A CSS length WITH A CEILING, and the ceiling is the point.
        //
        // A pattern alone is not enough here. '99rem' matches any sane-looking
        // length regex and is a catastrophe: --spacing is Tailwind's base unit
        // and EVERY padding and margin in the shop is a multiple of it, so
        // ninety-nine of them is a page whose first element is off the bottom
        // of the screen. The radius knob scales three corner sizes and does
        // the same thing to every card and button.
        //
        // So these two are range-checked, not just shape-checked. The built
        // values are --spacing .25rem and radii .375/.5/.75rem; the bounds
        // below are generous around them and nowhere near destructive.
        $len = static function (string $k, float $maxRem) use ($v, &$err): string {
            $raw = trim((string) ($v[$k] ?? ''));
            if ($raw === '' || $err !== null) return '';
            if (!preg_match('/^([0-9]{1,3}(\.[0-9]{1,3})?)(px|rem)$/', $raw, $m)) {
                $err = $k; return '';
            }
            // One scale to compare on. 16px to the rem is the browser default
            // and the only figure available server-side; a visitor who has
            // changed their base size shifts both the built values and this
            // one together, so the RELATIONSHIP the bound protects survives.
            $rem = $m[3] === 'px' ? ((float) $m[1]) / 16.0 : (float) $m[1];
            if ($rem > $maxRem) { $err = $k; return ''; }
            return $raw;
        };

        // THE FREE-FORM STYLESHEET. Everything else here has a shape; this one
        // cannot, so it is bounded rather than parsed:
        //
        //   20 kB, which is three times the hand-written sporta-ui additions
        //   and far short of anything that arrived by accident.
        //
        //   NO `</` ANYWHERE. That sequence never appears in valid CSS and is
        //   the only thing that could end the <style> element and become
        //   markup. assets/theme.js assigns this with textContent, which does
        //   not parse markup at all, so this is defence in depth rather than
        //   the only guard — but the next thing that consumes this value may
        //   not be so careful, and the rule costs one line.
        //
        //   NO NUL BYTES, which nothing legitimate contains and which truncate
        //   strings in half the things that will touch this.
        //
        // It is NOT validated as CSS. A browser ignores a declaration it
        // cannot parse, so a typo costs the rule and nothing else — and a
        // server that tried to be a CSS parser would reject tomorrow's valid
        // syntax, which is a worse failure than a rule that does not apply.
        $css = (string) ($v['css'] ?? '');
        if ($css !== '' && $err === null) {
            if (strlen($css) > 20000)          $err = 'css_too_long';
            elseif (strpos($css, '</') !== false) $err = 'css_has_markup';
            elseif (strpos($css, "\0") !== false) $err = 'css_has_nul';
        }

        $out = [
            'brand'             => $one('brand', $HEX),
            'accent_text_light' => $one('accent_text_light', $HSL),
            'accent_text_dark'  => $one('accent_text_dark', $HSL),
            'font_head'         => $one('font_head', $FONT),
            'font_body'         => $one('font_body', $FONT),
            // 2rem of corner is a pill; 0.5rem of base spacing is double the
            // built value and already a very airy shop. Beyond either, the
            // owner is not theming, they are breaking the page.
            'radius'            => $len('radius', 2.0),
            'space'             => $len('space', 0.5),
            // THE FOUR SURFACES --brand DOES NOT REACH, added 2026-09-19.
            //
            // Every other colour in this shop follows `brand` above, because
            // make-brand-tokens.mjs re-states 48 compiled rules in terms of
            // the token. These four cannot be reached that way and each for
            // its own reason, which is why they are fields rather than
            // derivations:
            //
            //   header_bg      #2b2b2b, asked for on 2026-09-17. It is an
            //                  !important declaration inside @layer
            //                  utilities, and for important declarations the
            //                  cascade reverses layer order — so no unlayered
            //                  override could win it. sporta-ui.css reads
            //                  var(--sp-header-bg, #2b2b2b) instead.
            //   tabbar_bg      #ffffff, and tabbar_active #4f46e5, both in
            //   tabbar_active  the compiled bundle, which has no source in
            //                  this repository. The indigo is Tailwind's
            //                  stock colour and belongs to no Sporta palette.
            //   secondary_bg   was --sp-silver, which is ALSO the prose
            //                  colour in four other rules of sporta-dark.css;
            //                  repointing it would have recoloured the text.
            //
            // HEX, NOT HSL, for all four — unlike accent_text_* above. These
            // are consumed as plain colours (`background: var(--x)`), never
            // wrapped in hsl(), so the triple that accent-text needs would be
            // exactly wrong here and produce no declaration at all.
            //
            // dark-white is deliberately NOT wired to any of these. That
            // theme exists to be greyscale; a brand colour reaching into it
            // would defeat the one thing it is for.
            'header_bg'         => $one('header_bg', $HEX),
            'tabbar_bg'         => $one('tabbar_bg', $HEX),
            'tabbar_active'     => $one('tabbar_active', $HEX),
            'secondary_bg'      => $one('secondary_bg', $HEX),
            // page_bg — the shop's main background, added 2026-09-20. Same
            // shape as the four above and for the same reason: [data-theme=dark]
            // body{background-color:#202429} is a compiled rule this repository
            // cannot edit, so sporta-ui.css reads var(--sp-page-bg, #202429).
            'page_bg'           => $one('page_bg', $HEX),
            'css'               => $err === null ? trim($css) : '',
        ];
        return [$out, $err];
        };

        [$out, $err] = $theme($v);
        if ($err !== null) store_fail('invalid_theme_' . $err);
        // A save that does not MENTION a device keeps what is stored, so the
        // older whole-row editors (theme-colors.js, custom-css.js) cannot wipe
        // an override they know nothing about. Sending one replaces it whole;
        // empty fields are dropped, and empty means "same as all devices".
        $cur = store_setting($db, 'theme');
        foreach (['phone', 'desktop'] as $dev) {
            if (array_key_exists($dev, $v)) {
                [$o, $e] = $theme(is_array($v[$dev]) ? $v[$dev] : []);
                if ($e !== null) store_fail('invalid_theme_' . $dev . '_' . $e);
                $out[$dev] = array_filter($o, static fn($x) => $x !== '');
            } else {
                $out[$dev] = is_array($cur[$dev] ?? null) ? $cur[$dev] : [];
            }
        }
        store_setting_save($db, 'theme', $out);
        store_out(store_setting($db, 'theme'));
    }

    if ($name === 'footer') {
        // THE FOOTER'S PROSE. Ten fields, five in each language.
        //
        // Nothing here is refused for being empty: empty means "use the text
        // that is built into the page", which is the state every shop starts
        // in and the way back if an edit turns out wrong. That is also why
        // there is no required-field check — clearing one field must not fail
        // the save and lose the edit made to another.
        //
        // Capped rather than validated. This is prose in two languages: there
        // is no shape to check beyond "not an essay", and a cap is what stops
        // a paste accident putting a page of text in the footer of every
        // screen. mb_substr, not substr, because Arabic is multi-byte and
        // cutting mid-character produces a broken glyph.
        $cap = static fn(string $k, int $n): string
            => mb_substr(trim((string) ($v[$k] ?? '')), 0, $n);
        store_setting_save($db, 'footer', [
            'tagline_ar'    => $cap('tagline_ar', 300),
            'tagline_en'    => $cap('tagline_en', 300),
            'club_title_ar' => $cap('club_title_ar', 80),
            'club_title_en' => $cap('club_title_en', 80),
            'club_text_ar'  => $cap('club_text_ar', 200),
            'club_text_en'  => $cap('club_text_en', 200),
            'rights_ar'     => $cap('rights_ar', 120),
            'rights_en'     => $cap('rights_en', 120),
            'managed_ar'    => $cap('managed_ar', 200),
            'managed_en'    => $cap('managed_en', 200),
        ]);
    } elseif ($name === 'knet') {
        // THE KNET TRANPORTAL CREDENTIALS — all three fields since 2026-09-18,
        // on the owner's explicit request after being shown the cost: putting
        // the password and the resource key in the same row as everything
        // else means an SQL injection ANYWHERE in the shop hands over a
        // working, signing gateway rather than a merchant number. See the
        // note beside STORE_SETTING_DEFAULTS in api/store.php.
        //
        // WHAT A WRONG VALUE COSTS, which is why this is the strictest
        // validation in this function. Every other setting here is text on a
        // page: a mistyped address looks wrong and someone says so. A mistyped
        // credential is a shop that takes the customer to KNET and is refused
        // there, on every order, with nothing in the shop's own logs saying
        // why — the gateway rejects the merchant, not the basket.
        //
        // EACH FIELD IS INDEPENDENT AND OPTIONAL IN THE REQUEST. array_key_exists,
        // not `?? ''`: a request that omits a key leaves that field exactly as
        // it was, so changing the password does not require resending the ID
        // and the resource key blind. A key that IS present and empty clears
        // that one field back to knet/config.php — the way out if a saved
        // value turns out to be wrong, without needing server access at the
        // exact moment the shop cannot take money.
        $current = store_setting($db, 'knet');
        $next = $current;

        if (array_key_exists('tranportal_id', $v)) {
            // Digits and letters only, 3 to 32 of them. KNET issues numeric
            // IDs (the shipped example is 626101) but has issued alphanumeric
            // ones, and refusing a valid ID the bank gave the owner is its
            // own failure — they would have no way to enter it and no idea
            // why.
            $id = trim((string) $v['tranportal_id']);
            if ($id !== '' && !preg_match('/^[A-Za-z0-9]{3,32}$/', $id)) {
                store_fail('invalid_tranportal_id');
            }
            // The placeholder knet/config.php ships with. Saving it would
            // read as "configured" to knet_legacy_configured() and pin the
            // shop to the legacy path with an ID that cannot take a payment.
            if (in_array(strtoupper($id), ['YOUR_TRANPORTAL_ID', 'TRANPORTAL_ID', 'CHANGEME'], true)) {
                store_fail('placeholder_tranportal_id');
            }
            $next['tranportal_id'] = $id;
        }

        if (array_key_exists('tranportal_password', $v)) {
            // No format KNET publishes to validate against — unlike the ID and
            // the key, this one is free text from the bank. A generous but
            // finite cap (200) is still worth having: without one, a request
            // this large is a row this large, forever, in a table read on
            // every payment.
            $password = trim((string) $v['tranportal_password']);
            if (mb_strlen($password) > 200) {
                store_fail('tranportal_password_too_long');
            }
            if (in_array(strtoupper($password), ['YOUR_TRANPORTAL_PASSWORD', 'CHANGEME'], true)) {
                store_fail('placeholder_tranportal_password');
            }
            $next['tranportal_password'] = $password;
        }

        if (array_key_exists('resource_key', $v)) {
            // THE PLACEHOLDER CHECK GOES FIRST. 'YOUR_TERMINAL_RESOURCE_KEY'
            // is 27 characters, not 16 — checking length first would refuse
            // it as resource_key_wrong_length, true but not the useful
            // answer, and the placeholder branch below it would be dead code
            // no input could ever reach.
            $key = (string) $v['resource_key'];
            if (strtoupper($key) === 'YOUR_TERMINAL_RESOURCE_KEY') {
                store_fail('placeholder_resource_key');
            }
            // EXACTLY 16 bytes — AES-128 takes nothing else. knet_assert_key()
            // throws on any other length and the shopper gets "Payment init
            // failed", so this is checked here rather than left for the
            // gateway to discover mid-checkout.
            if ($key !== '' && strlen($key) !== 16) {
                store_fail('resource_key_wrong_length');
            }
            $next['resource_key'] = $key;
        }

        // ---- 2026-09-30: mode, environment, language, and the CBK credentials.
        // Same contract as the three above: a key that is absent is left
        // alone, a key present and empty clears that one field back to the
        // config file.
        //
        // ENVIRONMENT AND MODE ARE ENUMS, NEVER FREE TEXT. knet_gateway_url()
        // treats anything but the exact string 'test' as LIVE, so a typo
        // saved here would silently send shoppers to the real bank; only the
        // two real words are accepted.
        if (array_key_exists('mode', $v)) {
            $m = strtolower(trim((string) $v['mode']));
            if (!in_array($m, ['', 'legacy', 'official'], true)) store_fail('invalid_mode');
            $next['mode'] = $m;
        }
        if (array_key_exists('env', $v)) {
            $e = strtolower(trim((string) $v['env']));
            if (!in_array($e, ['', 'test', 'production'], true)) store_fail('invalid_env');
            $next['env'] = $e;
        }
        if (array_key_exists('lang_en', $v)) {
            $l = trim((string) $v['lang_en']);
            if (!in_array($l, ['', 'EN', 'USA', 'ENG'], true)) store_fail('invalid_lang_en');
            $next['lang_en'] = $l;
        }
        // The CBK credentials: printable characters only, no spaces, capped.
        // A pasted newline or a trailing space is the commonest way to a
        // credential the bank refuses, and refusing it HERE names the fault.
        foreach (['cbk_client_id', 'cbk_client_secret', 'cbk_encrp_key',
                  'cbk_test_client_id', 'cbk_test_client_secret', 'cbk_test_encrp_key'] as $f) {
            if (!array_key_exists($f, $v)) continue;
            $x = (string) $v[$f];
            if ($x !== trim($x) || ($x !== '' && !preg_match('/^[\x21-\x7E]{1,200}$/', $x))) {
                store_fail('invalid_' . $f);
            }
            if ($x !== '' && (str_starts_with(strtoupper($x), 'YOUR_') || str_starts_with(strtoupper($x), 'SANDBOX_NOT_A_REAL'))) {
                store_fail('placeholder_' . $f);
            }
            $next[$f] = $x;
        }

        store_setting_save($db, 'knet', $next);
    } elseif ($name === 'hero') {
        store_setting_save($db, 'hero', [
            // 2s floor: anything faster is unreadable, and WCAG 2.2.2 wants
            // moving content to be pausable, not merely slow. 30s ceiling
            // because past that the second slide is never seen.
            'speed_ms' => max(2000, min(30000, (int)($v['speed_ms'] ?? 6500))),
            'shuffle'  => !empty($v['shuffle']),
            'autoplay' => !empty($v['autoplay']),
            'size'     => in_array($v['size'] ?? '', ['short', 'tall', 'full'], true) ? $v['size'] : 'tall',
        ]);
    } elseif ($name === 'security') {
        // SIGN-IN POLICIES: require a second factor; an IP allowlist for signing in. sec_policy_validate
        // refuses a list that would lock out the browser saving it, and require_2fa without a mailer.
        store_setting_save($db, 'security', sec_policy_validate($db, $v));
    } elseif ($name === 'home_layout') {
        // THE HOME PAGE'S SHAPE — store_home_layout_validate() says what is accepted and what is
        // refused by name. Empty lists mean "the built-in", which is also the state before any save.
        store_setting_save($db, 'home_layout', store_home_layout_validate($v));
    } elseif ($name === 'promo_bar') {
        store_setting_save($db, 'promo_bar', [
            'enabled'   => !empty($v['enabled']),
            'text_en'   => mb_substr(trim((string)($v['text_en'] ?? '')), 0, 160),
            'text_ar'   => mb_substr(trim((string)($v['text_ar'] ?? '')), 0, 160),
            'href'      => store_internal_href($v['href'] ?? null) ?? '',
            'starts_at' => store_datetime($v['starts_at'] ?? null),
            'ends_at'   => store_datetime($v['ends_at'] ?? null),
        ]);
    } elseif ($name === 'seo') {
        // THE HOME PAGE'S SEARCH TEXT AND GOOGLE'S TOKEN. Empty = seo.php's built-in text, no tag.
        // Lengths are what a result shows before it cuts: ~60 for a title, ~160 for a description;
        // the caps leave room past that rather than truncating what the owner meant.
        store_setting_save($db, 'seo', [
            'title_en' => store_seo_text($v['title_en'] ?? '', 70),
            'title_ar' => store_seo_text($v['title_ar'] ?? '', 70),
            'desc_en'  => store_seo_text($v['desc_en'] ?? '', 200),
            'desc_ar'  => store_seo_text($v['desc_ar'] ?? '', 200),
            'google_verification' => store_seo_verification((string)($v['google_verification'] ?? '')),
        ]);
    } elseif ($name === 'crawl') {
        // ROBOTS.TXT SWITCHES AND THE SITEMAP. Every value is checked here, so robots.php and the
        // sitemap generators only ever read what passed: a bot from the switchable list, a Disallow
        // rule that hides none of the shop's key pages, a sitemap link on this shop's own host, a
        // product that exists. At least one sitemap section or link must stay on.
        $sec = is_array($v['sections'] ?? null) ? $v['sections'] : [];
        $sections = [];
        foreach (['pages', 'categories', 'products'] as $k) $sections[$k] = !empty($sec[$k]);
        $custom = [];
        foreach (array_slice(is_array($v['custom'] ?? null) ? $v['custom'] : [], 0, 50) as $u) {
            if (trim((string)$u) === '') continue;
            $custom[] = store_seo_custom_url((string)$u);
        }
        if (!array_filter($sections) && !$custom) store_fail('sitemap_empty');
        $exclude = [];
        $known = $db->prepare('select 1 from products where slug = ?');
        foreach (array_slice(is_array($v['exclude'] ?? null) ? $v['exclude'] : [], 0, 500) as $slug) {
            $known->execute([(string)$slug]);
            if ($known->fetchColumn()) $exclude[] = (string)$slug;
        }
        $block = [];
        foreach (is_array($v['block'] ?? null) ? $v['block'] : [] as $bot) {
            if (!in_array($bot, STORE_SEO_AI_BOTS, true)) store_fail('robots_unknown_bot');
            $block[] = $bot;
        }
        $disallow = [];
        foreach (array_slice(is_array($v['disallow'] ?? null) ? $v['disallow'] : [], 0, 20) as $rule) {
            if (trim((string)$rule) === '') continue;
            $disallow[] = store_robots_rule((string)$rule);
        }
        store_setting_save($db, 'crawl', [
            'sections' => $sections,
            'custom'   => array_values(array_unique($custom)),
            'exclude'  => array_values(array_unique($exclude)),
            'block'    => array_values(array_unique($block)),
            'disallow' => array_values(array_unique($disallow)),
        ]);
    } elseif ($name === 'footer_links') {
        // THE FOOTER'S LINK COLUMNS. At most 4 columns of 8 links. A column needs a title in at
        // least one language and a link needs a label in at least one and a target; a blank
        // column or link is DROPPED rather than refused, so clearing the last row empties the
        // list ("use the built-in footer"). A target that is not a path on this shop or an
        // https address is refused by name (store_footer_href), with the column and link number.
        $cols = is_array($v['columns'] ?? null) ? array_slice($v['columns'], 0, 4) : [];
        $out = [];
        foreach ($cols as $ci => $c) {
            if (!is_array($c)) continue;
            $te = mb_substr(trim((string)($c['title_en'] ?? '')), 0, 40);
            $ta = mb_substr(trim((string)($c['title_ar'] ?? '')), 0, 40);
            $links = [];
            foreach (array_slice(is_array($c['links'] ?? null) ? $c['links'] : [], 0, 8) as $li => $l) {
                if (!is_array($l)) continue;
                $le = mb_substr(trim((string)($l['label_en'] ?? '')), 0, 40);
                $la = mb_substr(trim((string)($l['label_ar'] ?? '')), 0, 40);
                $href = trim((string)($l['href'] ?? ''));
                if ($le === '' && $la === '' && $href === '') continue;
                if ($le === '' && $la === '') store_fail('footer_link_label_' . ($ci + 1) . '_' . ($li + 1));
                if ($href === '') store_fail('footer_link_target_' . ($ci + 1) . '_' . ($li + 1));
                $links[] = ['label_en' => $le, 'label_ar' => $la, 'href' => store_footer_href($href)];
            }
            if ($te === '' && $ta === '' && !$links) continue;
            if ($te === '' && $ta === '') store_fail('footer_column_title_' . ($ci + 1));
            if (!$links) store_fail('footer_column_empty_' . ($ci + 1));
            $out[] = ['title_en' => $te, 'title_ar' => $ta, 'links' => $links];
        }
        store_setting_save($db, 'footer_links', ['columns' => $out]);
    } elseif ($name === 'social') {
        // THE SHOP'S SOCIAL LINKS. Each is a profile URL on that network's own domain, or just
        // the handle (which is what an owner types), and either is stored as one https URL.
        //
        // A LINK TO ANYWHERE ELSE IS REFUSED, BY NAME. These URLs are printed in the footer of
        // every page as an icon people trust, and an owner's typo or a pasted tracking redirect
        // must not turn a Snapchat icon into a link to a stranger's site. Empty is fine and
        // means "not shown" (for WhatsApp: "use the contact number").
        $out = [];
        foreach (['instagram', 'snapchat', 'youtube', 'tiktok', 'whatsapp'] as $kind) {
            $raw = trim((string)($v[$kind] ?? ''));
            if ($raw === '') { $out[$kind] = ''; continue; }
            $url = admin_social_url($kind, $raw);
            if ($url === null) store_fail('invalid_' . $kind);
            $out[$kind] = $url;
        }
        store_setting_save($db, 'social', $out);
    } elseif ($name === 'contact') {
        // HOW TO REACH THE SHOP.
        //
        // Every field is optional and an empty one means "do not show this",
        // which is why nothing here is store_fail'd for being blank — the
        // owner clearing the address should clear the address, not refuse the
        // whole save and lose the edit they made to the phone number beside it.
        //
        // What IS refused is a value that is present and wrong, because that is
        // the one that reaches a customer: a mistyped email on the contact page
        // is a customer who writes to nobody, and the shop never finds out.
        $email = trim((string)($v['email'] ?? ''));
        if ($email !== '' && store_email($email) === null) store_fail('invalid_email');

        // THE WHATSAPP NUMBER IS NORMALISED TO DIGITS WITH A COUNTRY CODE,
        // because that is the only thing wa.me accepts and a link that opens on
        // an error is indistinguishable from the shop having no WhatsApp at all.
        //
        // IT USED TO GO THROUGH store_phone(), AND THAT REFUSED THE SHOP'S OWN
        // NUMBER. store_phone() is the CHECKOUT's validator: it requires
        // `^[569]\d{7}$`, which is a Kuwaiti MOBILE, because a customer who
        // mistypes their number is a delivery nobody can chase. This is not a
        // customer's mobile — it is the shop's own line, and
        // STORE_SETTING_DEFAULTS ships `96522091914`, a landline starting 2.
        // Fed its own default the save answered invalid_whatsapp, so the one
        // value every shop starts with could not be saved back, and an owner
        // opening the contact editor and pressing Save without touching
        // anything was refused with no way to tell why.
        //
        // So the rule here is what wa.me actually needs rather than what the
        // checkout needs: digits, with a country code, of a plausible length.
        // A bare eight-digit Kuwaiti number — landline or mobile — gains 965,
        // which is what an owner types. Text still fails, which is the case
        // this check exists for.
        $wa = trim((string)($v['whatsapp'] ?? ''));
        if ($wa !== '') {
            $d = preg_replace('/\D/', '', store_ascii_digits($wa));
            if (str_starts_with($d, '00')) $d = substr($d, 2);
            // Eight digits alone is a local Kuwaiti number and nothing else:
            // no country code is that short, so there is no number this could
            // be mistaking for an international one.
            if (strlen($d) === 8) $d = '965' . $d;
            // E.164 allows up to fifteen; under eight there is no country on
            // earth whose numbers are that short, so it is a typo.
            if (!preg_match('/^[1-9]\d{7,14}$/', $d)) store_fail('invalid_whatsapp');
            $wa = $d;
        }

        // The DISPLAY phone is deliberately NOT normalised. It is what appears
        // on the page and on the invoice, and shops write their number with
        // spaces for a reason; forcing it to 96522091914 would make every page
        // read like a database field. It is only ever printed, never dialled
        // programmatically — the tel: link is built from its digits at render.
        store_setting_save($db, 'contact', [
            'phone'      => mb_substr(trim((string)($v['phone'] ?? '')), 0, 32),
            'whatsapp'   => (string)$wa,
            'email'      => $email,
            'address_ar' => mb_substr(trim((string)($v['address_ar'] ?? '')), 0, 160),
            'address_en' => mb_substr(trim((string)($v['address_en'] ?? '')), 0, 160),
            'hours_ar'   => mb_substr(trim((string)($v['hours_ar'] ?? '')), 0, 120),
            'hours_en'   => mb_substr(trim((string)($v['hours_en'] ?? '')), 0, 120),
            // An instagram HANDLE, not a URL: the link is built from it, so a
            // full https:// pasted in here would produce a broken address. The
            // leading @ people habitually type is stripped rather than refused.
            'instagram'  => preg_replace('/[^A-Za-z0-9._]/', '',
                                mb_substr(trim((string)($v['instagram'] ?? '')), 0, 40)),
            // A TikTok HANDLE, same shape and same reasoning as instagram just
            // above — a leading @ is stripped rather than refused, since the
            // built link already carries its own @.
            'tiktok'     => preg_replace('/[^A-Za-z0-9._]/', '',
                                mb_substr(trim((string)($v['tiktok'] ?? '')), 0, 40)),
            // A Snapchat username, same shape again. UNLIKE instagram/tiktok,
            // nothing in the built storefront's footer has an existing
            // Snapchat link to swap — checked, `grep`ing the compiled bundle
            // for "snapchat" finds nothing at all, so contact.js's literal-
            // string-swap technique has no anchor to attach to here. This
            // field is stored and validated the same way, ready for whichever
            // surface reads it, but the storefront footer will not show it
            // until that surface exists.
            'snapchat'   => preg_replace('/[^A-Za-z0-9._-]/', '',
                                mb_substr(trim((string)($v['snapchat'] ?? '')), 0, 40)),
        ]);
    } elseif ($name === 'contact_emails') {
        // FOUR MORE ADDRESSES, admin-only — never shown to a shopper and never
        // wired into what cron-fulfilment.php or store.php actually mail. Each
        // is optional; a value that is PRESENT and not a real email is refused,
        // same reasoning as the public contact email above: a mistyped address
        // recorded here is one nobody will ever notice is wrong.
        $emails = [];
        foreach (['alternative', 'orders', 'b2b', 'customers'] as $key) {
            $val = trim((string)($v[$key] ?? ''));
            if ($val !== '' && store_email($val) === null) store_fail('invalid_email:' . $key);
            $emails[$key] = $val;
        }
        store_setting_save($db, 'contact_emails', $emails);
    } elseif ($name === 'legal') {
        // THE POLICY PAGES' PROSE. Six fields, three pages, two languages.
        //
        // Capped rather than shaped, same as the footer: this is prose and
        // there is no format to check beyond "not larger than a page can
        // reasonably hold". 20,000 characters is roughly the length of the
        // built Terms page's own English text times four — generous, and far
        // short of anything that arrived by accident.
        //
        // EMPTY IS ALWAYS ALLOWED, same rule as footer and contact: it means
        // "leave the bundle's own text alone", which is the state every shop
        // starts in and the way back if a rewrite goes wrong. Nothing here is
        // store_fail'd for being blank.
        //
        // NO `</`, for the same reason theme.js's custom-CSS field refuses it:
        // assets/legal-pages.js renders each paragraph with textContent, which
        // parses no markup at all and cannot be closed by this sequence — but
        // the next thing that reads this value back (an editor's own preview,
        // a future export) may not be so careful, and the rule costs one line
        // per field.
        $prose = static function (string $k) use ($v, &$err): string {
            $raw = trim((string) ($v[$k] ?? ''));
            if ($raw === '' || $err !== null) return '';
            if (mb_strlen($raw) > 20000) { $err = $k . '_too_long'; return ''; }
            if (strpos($raw, '</') !== false) { $err = $k . '_has_markup'; return ''; }
            if (strpos($raw, "\0") !== false) { $err = $k . '_has_nul'; return ''; }
            return $raw;
        };
        $err = null;
        $out = [
            'privacy_en' => $prose('privacy_en'), 'privacy_ar' => $prose('privacy_ar'),
            'terms_en'   => $prose('terms_en'),   'terms_ar'   => $prose('terms_ar'),
            'returns_en' => $prose('returns_en'), 'returns_ar' => $prose('returns_ar'),
        ];
        if ($err !== null) store_fail('invalid_legal_' . $err);
        store_setting_save($db, 'legal', $out);
    } elseif ($name === 'site_text') {
        // THE REST OF THE SITE'S WORDS — every heading, button, empty state and
        // error message the bundle can say, which until now no panel could
        // touch at all.
        //
        // WHY IT STORES THE ORIGINAL AS WELL AS THE REPLACEMENT. The
        // storefront's vocabulary lives in one object inside the compiled
        // bundle, scoped to its module and attached to no global, so nothing at
        // runtime can read it. assets/site-text.js therefore swaps by matching
        // the shipped literal — the same method footer.js has used since it was
        // written — and the literal has to come from somewhere. Keeping it here
        // means the storefront overlay needs this row and nothing else: no
        // catalogue fetch, no 51 kB of JSON on a page a shopper is reading.
        //
        // ONLY WHAT CHANGED IS STORED, which is what keeps this cheap. A shop
        // that has rewritten five lines gives the overlay ten literals to look
        // for, exactly as many as footer.js carries today — not four hundred.
        // An entry whose replacement is empty or identical to the original is
        // dropped rather than saved, so clearing a field really does remove it.
        //
        // BOTH LANGUAGES, ALWAYS, and the reason is in the bundle's own
        // behaviour: switching language re-renders every string straight from
        // that object, so a replacement recorded for English alone vanishes the
        // moment somebody presses the toggle. A shop can leave one side blank
        // deliberately; what it cannot do is have a half-applied edit it
        // believes is applied.
        $err = null;
        $one = static function ($raw, string $where) use (&$err): ?string {
            if (!is_string($raw)) { $err = $err ?? $where . '_not_text'; return null; }
            $s = trim($raw);
            if ($s === '') return '';
            // 600 is several times the longest line the bundle ships (a
            // category card's description, about sixty characters) and far
            // short of anything pasted in by accident. This is a label, not a
            // page — the policy pages have their own field and their own cap.
            if (mb_strlen($s) > 600)          { $err = $err ?? $where . '_too_long';  return null; }
            if (strpos($s, '</') !== false)   { $err = $err ?? $where . '_has_markup'; return null; }
            if (strpos($s, "\0") !== false)   { $err = $err ?? $where . '_has_nul';    return null; }
            return $s;
        };

        $out = [];
        $n = 0;
        foreach ($v as $key => $pair) {
            if ($err !== null) break;
            // The dotted path the catalogue uses — `services.delivery.t`,
            // `heroSlides.0.title`. Anything else did not come from the
            // generator and is not a string this shop says.
            if (!is_string($key) || !preg_match('/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/', $key)) {
                store_fail('invalid_site_text_key');
            }
            if (++$n > 500) store_fail('invalid_site_text_too_many');
            if (!is_array($pair)) { $err = $key . '_not_a_pair'; break; }

            $entry = [];
            foreach (['en', 'ar'] as $lang) {
                $side = $pair[$lang] ?? null;
                if ($side === null) continue;
                if (!is_array($side) || count($side) !== 2) { $err = $key . '_' . $lang . '_not_a_pair'; break 2; }
                $from = $one($side[0], $key . '_' . $lang . '_from');
                $to   = $one($side[1], $key . '_' . $lang . '_to');
                if ($err !== null) break 2;
                // Nothing to swap: no original to match on, no replacement, or
                // a replacement identical to what the shop already says.
                if ($from === '' || $to === '' || $from === $to) continue;
                $entry[$lang] = [$from, $to];
            }
            if ($entry !== []) $out[$key] = $entry;
        }
        if ($err !== null) store_fail('invalid_site_text_' . $err);

        // The same ceiling the custom-CSS field has, for the same reason: this
        // is the one field here with no shape beyond "prose", and a settings
        // row is read on requests that have nothing to do with it.
        if (strlen((string) json_encode($out, JSON_UNESCAPED_UNICODE)) > 65536) {
            store_fail('invalid_site_text_too_large');
        }
        store_setting_save($db, 'site_text', $out);
        store_out(store_setting($db, 'site_text'));
    } elseif ($name === 'rules') {
        // THE SHOP'S NUMBERS. store.php's store_rule_defaults() is the home of
        // the defaults and the long explanation; this is the gate.
        //
        // EVERY FIELD IS OPTIONAL and an absent one keeps what is stored, so a
        // panel that sends one field does not silently reset the other eight.
        // That is the opposite of the footer's rule, and deliberately: a blank
        // footer line means "no line", while a blank delivery fee does not mean
        // "delivery is free" — it means the field was not on the form.
        $cur = store_rules($db);

        // A number the owner can see the effect of is still a number that can
        // be typed wrong, and each of these fails in a direction that costs
        // money rather than looking odd. So each is clamped to a range with a
        // reason, and a value outside it is REFUSED with its own name rather
        // than quietly pulled to the edge — a delivery fee silently clamped
        // from 100.000 to 50.000 is a shop charging something nobody chose.
        $int = static function (string $key, int $lo, int $hi) use ($v, $cur): int {
            if (!array_key_exists($key, $v)) return (int) $cur[$key];
            $raw = $v[$key];
            if (!is_int($raw) && !(is_string($raw) && preg_match('/^\d+$/', trim($raw)))) {
                store_fail('rule_not_a_number:' . $key);
            }
            $n = (int) $raw;
            if ($n < $lo || $n > $hi) store_fail('rule_out_of_range:' . $key);
            return $n;
        };

        // A list must be a SUBSET of what shipped, non-empty, and is stored in
        // the order given — the panel's ordering is what the shop displays.
        $subset = static function (string $key, array $allowed) use ($v, $cur): array {
            if (!array_key_exists($key, $v)) return $cur[$key];
            if (!is_array($v[$key])) store_fail('rule_not_a_list:' . $key);
            $out = [];
            foreach ($v[$key] as $item) {
                $s = is_string($item) ? trim($item) : '';
                if (!in_array($s, $allowed, true)) store_fail('rule_unknown_value:' . $key . ':' . $s);
                if (!in_array($s, $out, true)) $out[] = $s;   // a duplicate is a slip, not a refusal
            }
            // An empty list is refused rather than stored. store_rules() would
            // read it back as absence and serve the default, so the panel would
            // show the full list again and the owner would conclude the save
            // did not work — which is worse than being told no.
            if ($out === []) store_fail('rule_empty_list:' . $key);
            return $out;
        };

        $sizes = $subset('sizes', STORE_SIZES);
        $fits  = $subset('fits',  STORE_FITS);
        $govs  = $subset('governorates', STORE_GOVERNORATES);
        $payMethods = $subset('payment_methods', STORE_PAY_METHODS);

        // THE ORPHAN GUARD, and the reason sizes are not simply a free list.
        //
        // Dropping a size the shop has stock rows for does not tidy anything:
        // those product_variants rows stay, keep their stock, and stop being
        // orderable — store_price_lines refuses the size at checkout. The
        // garment goes on showing a size nobody can buy, and nothing reports
        // it. So the save is refused and the sizes are NAMED with how many rows
        // each one holds, because "you cannot remove XL" is not actionable and
        // "XL has 7 stock rows" is.
        $dropped = array_values(array_diff(STORE_SIZES, $sizes));
        if ($dropped) {
            $q = $db->prepare(
                'select size, count(*) c from product_variants
                  where size in (' . implode(',', array_fill(0, count($dropped), '?')) . ')
                  group by size having c > 0'
            );
            $q->execute($dropped);
            $inUse = [];
            foreach ($q as $row) $inUse[] = $row['size'] . '(' . (int) $row['c'] . ')';
            if ($inUse) store_fail('rule_size_in_use:' . implode(',', $inUse));
        }

        $discountMax = $int('discount_max_pct', 1, 90);
        $reward      = $int('review_reward_pct', 0, 90);
        // A review reward is issued as a discount, and store_discounts_for caps
        // the total at discount_max_pct. A reward above the cap would be
        // written, look right in the panel, and then be trimmed at checkout —
        // the customer is promised 30% and given 20%, and only they find out.
        if ($reward > $discountMax) store_fail('rule_reward_above_cap');

        store_setting_save($db, 'rules', [
            // 0 is allowed and means delivery is free for everyone, which is a
            // real choice; the ceiling is 50.000 KWD, far past any real fee and
            // low enough that a fils/KWD mix-up (1000 typed as 1000000) is
            // caught rather than charged.
            'delivery_fee_fils'  => $int('delivery_fee_fils', 0, 50000),
            'free_delivery_fils' => $int('free_delivery_fils', 0, 1000000),
            'return_days'        => $int('return_days', 1, 365),
            'outlet_discount_pct' => $int('outlet_discount_pct', 1, 90),
            'cod_open_max'       => $int('cod_open_max', 1, 50),
            'cod_max_fils'       => $int('cod_max_fils', 0, 10000000),
            'review_reward_pct'  => $reward,
            'discount_max_pct'   => $discountMax,
            'governorates'       => $govs,
            'sizes'              => $sizes,
            'fits'               => $fits,
            'payment_methods'    => $payMethods,
        ]);
    } else {
        store_fail('unknown_setting');
    }
    // `rules` is not in STORE_SETTING_DEFAULTS — its defaults are built at call
    // time, because several of the constants behind them are declared later in
    // store.php than that array is. So it reads back through its own accessor.
    store_out($name === 'rules' ? store_rules($db) : store_setting($db, $name));
}

// --------------------------------------------------------------- knet, read
// THE PANEL'S OTHER SETTINGS ARE READ FROM THE STOREFRONT, AND THIS ONE MUST
// NOT BE. src/lib/admin.ts says so at length: the promo bar and the contact
// details come back on api.php?r=slides because reading the panel's idea of
// the bar from a different endpoint than the shop's would let the two
// disagree invisibly. That reasoning is right for a bar a customer sees.
//
// It is exactly wrong here. api.php is public — anyone may call ?r=slides —
// and the Tranportal ID is not a thing to hand to anyone who asks. So this is
// its own admin route, behind the same session and the same X-Sporta-Admin
// gate as every other route in this file, and the storefront gains no way to
// read it at all.
//
// It answers what is IN THE DATABASE, which is not necessarily what the
// gateway is using: an empty value here means knet/config.php's ID is in
// force. `source` says which, so the panel can tell the owner "this is the
// one taking payments" rather than showing them an empty box beside a shop
// that is charging cards perfectly well.
// THE SHOP'S NUMBERS, all nine, for the panel that edits them.
//
// WHY THIS EXISTS WHEN ?r=slides ALREADY CARRIES THEM: that one carries the
// PUBLIC SIX. cod_open_max, discount_max_pct and review_reward_pct are withheld
// there because each tells anyone probing the shop exactly where its edge is.
// The panel has to show all nine or the owner cannot edit the three it hides,
// so they are read here instead — behind the same session and the same
// X-Sporta-Admin gate as every other route in this file. Same reasoning as
// ?r=knet directly below: a value the storefront must not hand out gets an
// admin route rather than a public one.
//
// AND IT IS A READ, not a save with an empty body. Reading by writing would
// mean opening the settings screen rewrites the row — so a panel opened and
// closed would look, in any audit, exactly like a deliberate change.
// CUSTOM FONTS. Uploaded once here, stored as base64 inside a settings row —
// the same data-URI-in-MySQL pattern as brand logos and product photos, and
// for the same reason store_data_image() already gives: "nothing on this
// server needs write access to the web root." A font is picked by FAMILY
// NAME (validated with the same $FONT regex theme_save uses, since it is
// what ends up in a font-family rule), never by filename.
//
// EVERY BYTE IS CHECKED BEFORE IT IS STORED, with store_font_mime() — the
// same "ask the bytes, not the name" discipline as store_brand_logo_mime().
// A file that is not really a font is refused here rather than stored and
// silently failing to render for every visitor.
//
// FIVE FONTS AND 400 KB EACH IS THE CEILING. A shop's whole theme is two
// faces (heading, body); five leaves room to try alternatives without
// bloating a settings row that is fetched on every ?r=theme request. 400 KB
// covers a subset woff2 comfortably and refuses an unsubset TTF outright.
if ($r === 'fonts' && $method === 'GET') {
    $row = store_setting($db, 'custom_fonts');
    $list = is_array($row['fonts'] ?? null) ? $row['fonts'] : [];
    $out = [];
    foreach ($list as $f) {
        $out[] = [
            'id'     => (string) ($f['id'] ?? ''),
            'family' => (string) ($f['family'] ?? ''),
            'mime'   => (string) ($f['mime'] ?? ''),
            'bytes'  => isset($f['data']) ? (int) (strlen((string) $f['data']) * 3 / 4) : 0,
        ];
    }
    store_out(['fonts' => $out]);
}

if ($r === 'font_upload' && $method === 'POST') {
    $b = store_body();
    $family = trim((string) ($b['family'] ?? ''));
    $data   = (string) ($b['data'] ?? '');
    if (!preg_match('/^[A-Za-z0-9 \-]{2,40}$/', $family)) store_fail('invalid_font_family');
    $bytes = base64_decode($data, true);
    if ($bytes === false || $bytes === '') store_fail('invalid_font_data');
    if (strlen($bytes) > 400000) store_fail('font_too_large');
    $mime = store_font_mime($bytes);
    if ($mime === null) store_fail('not_a_font');

    $row = store_setting($db, 'custom_fonts');
    $list = is_array($row['fonts'] ?? null) ? $row['fonts'] : [];
    // Same family name replaces the old upload rather than growing the list
    // for ever — a re-upload is how the owner corrects a bad file.
    $list = array_values(array_filter($list, static fn($f) => ($f['family'] ?? '') !== $family));
    if (count($list) >= 5) store_fail('too_many_fonts');
    $list[] = [
        'id'     => bin2hex(random_bytes(6)),
        'family' => $family,
        'mime'   => $mime,
        'data'   => base64_encode($bytes),
    ];
    store_setting_save($db, 'custom_fonts', ['fonts' => $list]);
    store_out(['ok' => true]);
}

if ($r === 'font_delete' && $method === 'POST') {
    $b = store_body();
    $id = (string) ($b['id'] ?? '');
    $row = store_setting($db, 'custom_fonts');
    $list = is_array($row['fonts'] ?? null) ? $row['fonts'] : [];
    $list = array_values(array_filter($list, static fn($f) => ($f['id'] ?? '') !== $id));
    store_setting_save($db, 'custom_fonts', ['fonts' => $list]);
    store_out(['ok' => true]);
}

if ($r === 'rules' && $method === 'GET') {
    store_out([
        'rules'    => store_rules($db),
        // What the shop shipped with, so the panel can offer "back to the
        // default" per field and show which values are the owner's own.
        'defaults' => store_rule_defaults(),
        // The full sets a list may be drawn from. The panel must not invent
        // these: sizes and fits are pinned by the schema's CHECK constraints,
        // and a picker offering a size MySQL will refuse is a checkout that
        // dies on its last step.
        'allowed'  => [
            'sizes'            => STORE_SIZES,
            'fits'             => STORE_FITS,
            'governorates'     => STORE_GOVERNORATES,
            'payment_methods'  => STORE_PAY_METHODS,
        ],
    ]);
}

// --------------------------------------------------------- contact_emails, read
// ADMIN-ONLY, same reasoning as knet below rather than as contact above: this
// is never read by api.php, so it does not belong on the storefront route —
// a value with nowhere on the shop to appear has no business being public.
if ($r === 'contact_emails' && $method === 'GET') {
    store_out(store_setting($db, 'contact_emails'));
}

// ------------------------------------------------------------ Apple Wallet
// "link my apple dev with sporta", 2026-09-26. The three steps of the setup
// card on Settings; the logic and its reasoning are in wallet-setup.php. Behind
// the gate like knet: installing a certificate decides whose name every
// Wallet card the shop issues is signed in.
if (str_starts_with($r, 'wallet_')) {
    require_once __DIR__ . '/wallet-setup.php';
    $wcfg = store_config();
    if ($r === 'wallet_setup' && $method === 'GET') {
        store_out(wallet_status($wcfg));
    }
    if ($r === 'wallet_request' && $method === 'POST') {
        store_out(['csr' => wallet_make_request($wcfg), 'filename' => 'sporta-wallet.certSigningRequest']);
    }
    if ($r === 'wallet_cert' && $method === 'POST') {
        $b = store_body();
        // base64 of the .cer Apple hands over. 16 KB of base64 is ~12 KB of
        // certificate, several times the size of a real one (~1.5 KB).
        $b64 = (string) ($b['cer'] ?? '');
        if ($b64 === '' || strlen($b64) > 16384) store_fail('cert_unreadable');
        $bytes = base64_decode($b64, true);
        if ($bytes === false) store_fail('cert_unreadable');
        store_out(wallet_install_cert($wcfg, $bytes));
    }
}

if ($r === 'knet' && $method === 'GET') {
    $set = store_setting($db, 'knet');
    $id  = (string) ($set['tranportal_id'] ?? '');
    // NEVER THE VALUES THEMSELVES, same discipline as pay/config.php's status
    // below — a saved password or resource key is a bearer credential, and
    // this route answers whether ONE IS SAVED, not what it is.
    $passwordSet = (string) ($set['tranportal_password'] ?? '') !== '';
    $keySet      = (string) ($set['resource_key'] ?? '') !== '';

    // THE CBK HOSTED GATEWAY'S OWN STATUS — pay/config.php, a DIFFERENT file
    // from the Tranportal ID above and the reason this route now answers with
    // more than one thing. KNET.md and this project's own notes record the
    // commonest go-live failure as this file shipping with its credentials
    // still `YOUR_CLIENT_ID` / `YOUR_CLIENT_SECRET` / `YOUR_ENCRP_KEY` — a shop
    // that LOOKS configured (every key present, non-empty) and fails at the
    // bank on every single order, with nothing in the panel ever having said
    // so. This is the first thing that says so.
    //
    // NEVER THE VALUES THEMSELVES. client_secret and encrp_key are bearer
    // credentials — booleans only, the same discipline knet_config() already
    // applies to the Tranportal ID's own file-vs-database question.
    $payFile = __DIR__ . '/../pay/config.php';
    $pay = null;
    if (is_file($payFile)) {
        $cfg = @require $payFile;
        if (is_array($cfg)) {
            // A placeholder READS as configured to anything that only checks
            // "is this empty" — both config.example.php's YOUR_* and the
            // sandbox's SANDBOX_NOT_A_REAL_* pass that test and neither can
            // take a payment. Checked here so the panel cannot make the
            // mistake this project has already made once.
            $isPlaceholder = static function ($v): bool {
                $v = strtoupper(trim((string) $v));
                return $v === '' || str_starts_with($v, 'YOUR_') || str_starts_with($v, 'SANDBOX_NOT_A_REAL');
            };
            // What the gateway will actually USE: the values saved in the
            // panel win over pay/config.php, exactly as cbk_apply_saved()
            // applies them, so this readiness cannot say "placeholder" about
            // a credential the shop is in fact sending.
            require_once __DIR__ . '/../pay/cbk-sets.php';
            if (in_array($set['env'] ?? '', ['test', 'production'], true)) $cfg['env'] = $set['env'];
            $active = (($cfg['env'] ?? '') === 'production') ? 'production' : 'test';
            // BOTH SETS are reported, each as the gateway would assemble it in that mode
            // (cbk_saved_set(): production never borrows a test value; test falls back to the
            // shared one), so the panel can say "Test ready, Production not" before the switch.
            $sets = [];
            foreach (['test', 'production'] as $mode) {
                $c = $cfg;
                foreach (cbk_saved_set($set, $mode) as $to => $x) if ($x !== '') $c[$to] = $x;
                $a = !$isPlaceholder($c['client_id'] ?? ''); $b = !$isPlaceholder($c['client_secret'] ?? ''); $k = !$isPlaceholder($c['encrp_key'] ?? '');
                $sets[$mode] = ['ready' => $a && $b && $k, 'client_id_set' => $a, 'client_secret_set' => $b, 'encrp_key_set' => $k];
            }
            $pay = ['env' => $active] + $sets[$active] + ['sets' => $sets];
        }
    }

    store_out([
        'tranportal_id'            => $id,
        'source'                   => $id === '' ? 'file' : 'database',
        'tranportal_password_set'  => $passwordSet,
        'tranportal_password_source' => $passwordSet ? 'database' : 'file',
        'resource_key_set'         => $keySet,
        'resource_key_source'      => $keySet ? 'database' : 'file',
        // 2026-09-30. Mode / env / language come back as the SAVED value
        // ('' = the file decides); the CBK credentials as booleans only.
        'mode'    => (string) ($set['mode'] ?? ''),
        'env'     => (string) ($set['env'] ?? ''),
        'lang_en' => (string) ($set['lang_en'] ?? ''),
        'cbk_client_id_set'     => (string) ($set['cbk_client_id'] ?? '') !== '',
        'cbk_client_secret_set' => (string) ($set['cbk_client_secret'] ?? '') !== '',
        'cbk_encrp_key_set'     => (string) ($set['cbk_encrp_key'] ?? '') !== '',
        'cbk_test_client_id_set'     => (string) ($set['cbk_test_client_id'] ?? '') !== '',
        'cbk_test_client_secret_set' => (string) ($set['cbk_test_client_secret'] ?? '') !== '',
        'cbk_test_encrp_key_set'     => (string) ($set['cbk_test_encrp_key'] ?? '') !== '',
        // null, not a fourth false — a MISSING or unreadable config.php is a
        // different fault from one that is readable and holds placeholders,
        // and the panel should be able to tell "not configured" from
        // "cannot even find pay/config.php" rather than reporting both as
        // one flat "not ready".
        'pay' => $pay,
    ]);
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
// ---------------------------------------------------------------------- CRM
//
// "A customer", grouped by PHONE NUMBER. There is no populated customer
// accounts table yet — `customers` exists (2026-09-19) but has real signups
// of zero — so a directory built from it would show nothing. Every order
// this shop has ever taken carries a phone, guest or not, and that is the
// real data. `orders.customer_phone` is canonicalised by store_phone() at
// checkout — the same function blocked_customers.phone and customers.phone
// are canonicalised through — so all three can be compared by plain equality
// with no re-normalising here.
//
// BLOCKING, MADE VISIBLE. block_customer/unblock_customer have existed since
// this shop's early days, called from a button on the order screen — and
// nothing anywhere lists who is currently blocked or why. An admin wanting to
// know had no way to ask except phpMyAdmin. Every blocked phone is shown here,
// including one that has never placed an order: blocking does not require an
// order to exist, and a proactive block on a number the owner already
// suspects would otherwise vanish from every screen the moment it was made.
// ------------------------------------------------------------- CRM notes
//
// Private notes and tags per customer, keyed by the canonical phone — see
// api/customernotes.mysql.sql. The table is created here on first use as
// well as by that file, so a shop that never imports the SQL still gets the
// feature: the CRM is used from a phone in a shop, not from phpMyAdmin.
//
// FAILS QUIET ON READ, LOUD ON WRITE. If the table cannot exist (no CREATE
// privilege), the list and the profile simply carry no notes — the CRM they
// already had keeps working — while a save answers 503 by name instead of
// pretending to have kept something.
function crm_notes_ready(PDO $db): bool {
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $db->exec(
            "create table if not exists customer_notes (
               phone varchar(15) not null primary key,
               note text null,
               tags varchar(400) not null default '',
               updated_by varchar(190) null,
               updated_at timestamp not null default current_timestamp on update current_timestamp
             ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci"
        );
        return $ready = true;
    } catch (Throwable $e) {
        return $ready = false;
    }
}

/** phone => ['note' => ?string, 'tags' => string[], ...] for every noted phone. */
function crm_notes_all(PDO $db): array {
    if (!crm_notes_ready($db)) return [];
    $out = [];
    foreach ($db->query('select phone, note, tags, updated_by, updated_at from customer_notes')->fetchAll() as $n) {
        $out[(string) $n['phone']] = [
            'note' => $n['note'],
            'tags' => crm_tags_split((string) $n['tags']),
            'updated_by' => $n['updated_by'],
            'updated_at' => $n['updated_at'],
        ];
    }
    return $out;
}

function crm_tags_split(string $s): array {
    return array_values(array_filter(array_map('trim', explode(',', $s)), 'strlen'));
}

// A tag is a short label, not a sentence: trimmed, commas (the separator)
// removed, 24 characters, ten per customer, and the same tag once however it
// is capitalised. Arabic is allowed — mb_ functions throughout.
function crm_tags_clean($in): array {
    if (!is_array($in)) return [];
    $seen = []; $out = [];
    foreach ($in as $t) {
        $t = trim(mb_substr(str_replace(',', ' ', (string) $t), 0, 24));
        $t = preg_replace('~\s+~u', ' ', $t) ?? '';
        if ($t === '') continue;
        $k = mb_strtolower($t);
        if (isset($seen[$k])) continue;
        $seen[$k] = true; $out[] = $t;
        if (count($out) === 10) break;
    }
    return $out;
}

if ($r === 'crm_customers') {
    $q = trim((string) ($_GET['q'] ?? ''));

    // THE AGGREGATE, in one pass: count, paid total, first/last order — and
    // the id of the LATEST order, so the name and email shown are the most
    // recent the customer gave rather than a random one. Joining back to that
    // one row is the same shape products_all uses for a thumbnail: one
    // subquery decides which row wins, then an ordinary join reads it.
    $rows = $db->query(
        "select agg.phone, latest.customer_name as name, latest.customer_email as email,
                agg.order_count, agg.paid_count, agg.paid_total,
                agg.first_order_at, agg.last_order_at,
                bc.scope as blocked_scope, bc.reason as blocked_reason,
                (c.id is not null) as has_account
           from (
             select customer_phone as phone, count(*) as order_count,
                    sum(payment_status = 'paid') as paid_count,
                    sum(case when payment_status = 'paid' then amount else 0 end) as paid_total,
                    min(created_at) as first_order_at, max(created_at) as last_order_at,
                    max(id) as latest_id
               from orders
              where customer_phone is not null and customer_phone <> ''
              group by customer_phone
           ) agg
           join orders latest on latest.id = agg.latest_id
           left join blocked_customers bc on bc.phone = agg.phone
           left join customers c on c.phone = agg.phone

           union all

           -- A BLOCKED PHONE WITH NO ORDER AT ALL. block_customer accepts any
           -- phone the admin types in; it does not require one to have
           -- ordered. Without this half, blocking a number nobody has bought
           -- from yet — the exact case an owner would want a record of —
           -- would not appear on this screen, which is the gap being fixed.
           select bc.phone, null, null, 0, 0, 0.000, null, null,
                  bc.scope, bc.reason, (c.id is not null)
             from blocked_customers bc
             left join customers c on c.phone = bc.phone
            where not exists (select 1 from orders o where o.customer_phone = bc.phone)"
    )->fetchAll();

    // FILTERED IN PHP, NOT SQL, because the search has to reach across a UNION
    // of two differently-shaped halves and a phone that has never ordered has
    // no name or email to match against — a WHERE on the outer query would
    // need the same union twice. This list is bounded by the shop's own
    // customer count, which will not be large enough to make that a cost.
    // Notes and tags ride along on every row, and the search reaches them too:
    // "VIP" should find the customers tagged VIP.
    $notes = crm_notes_all($db);

    if ($q !== '') {
        $needle = mb_strtolower($q);
        $digits = preg_replace('~\D~', '', $q) ?? '';
        $rows = array_values(array_filter($rows, function ($r) use ($needle, $digits, $notes) {
            if ($digits !== '' && str_contains((string) $r['phone'], $digits)) return true;
            if ($needle === '') return false;
            $n = $notes[(string) $r['phone']] ?? null;
            return str_contains(mb_strtolower((string) ($r['name'] ?? '')), $needle)
                || str_contains(mb_strtolower((string) ($r['email'] ?? '')), $needle)
                || ($n && str_contains(mb_strtolower(implode(' ', $n['tags']) . ' ' . (string) $n['note']), $needle));
        }));
    }

    usort($rows, static fn($a, $b) => strcmp((string) $b['last_order_at'], (string) $a['last_order_at']));
    $rows = array_slice($rows, 0, 300);

    foreach ($rows as &$row) {
        $row['order_count'] = (int) $row['order_count'];
        $row['paid_count']  = (int) $row['paid_count'];
        $row['paid_total']  = (float) $row['paid_total'];
        $row['has_account'] = (bool) $row['has_account'];
        $row['blocked']     = $row['blocked_scope'] !== null;
        $n = $notes[(string) $row['phone']] ?? null;
        $row['tags']        = $n ? $n['tags'] : [];
        $row['has_note']    = $n !== null && trim((string) $n['note']) !== '';
    }
    unset($row);
    store_out($rows);
}

// One customer's full record — order history, reviews, return requests, and
// the block if one exists. Read-only; blocking and unblocking still go
// through the routes that already existed, so there is one place that writes
// a block and one place (this) that ever needs to explain what it means.
if ($r === 'crm_customer') {
    $phone = store_phone((string) ($_GET['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');

    $orders = $db->prepare(
        'select track_id, amount, payment_status, payment_method, fulfilment_status,
                created_at, fulfilled_at
           from orders where customer_phone = ? order by id desc limit 200'
    );
    $orders->execute([$phone]);
    $orders = $orders->fetchAll();

    // Reviews are attached to an ORDER, not a phone, so this reaches them
    // through the same orders this customer has actually placed — a review
    // cannot belong to a customer who never checked out.
    $reviews = $db->prepare(
        'select r.rating, r.comment, r.lang, r.published, r.created_at, o.track_id
           from reviews r join orders o on o.id = r.order_id
          where o.customer_phone = ? order by r.created_at desc limit 100'
    );
    $reviews->execute([$phone]);
    $reviews = $reviews->fetchAll();

    // return_requests carries its OWN phone — the one the request was made
    // from, which the table's own schema comment says may differ from the
    // order's if the customer has since changed number — so this is read by
    // the request's phone rather than joined through the order.
    $returns = $db->prepare(
        'select rr.ref, rr.kind, rr.status, rr.reason, rr.created_at, rr.decided_at, o.track_id
           from return_requests rr join orders o on o.id = rr.order_id
          where rr.phone = ? order by rr.created_at desc limit 100'
    );
    $returns->execute([$phone]);
    $returns = $returns->fetchAll();

    $block = $db->prepare('select scope, reason, blocked_by, created_at from blocked_customers where phone = ?');
    $block->execute([$phone]);
    $block = $block->fetch() ?: null;

    $account = $db->prepare('select id, email, name, created_at, last_seen_at from customers where phone = ?');
    $account->execute([$phone]);
    $account = $account->fetch() ?: null;

    if (!$orders && !$block && !$account) store_fail('customer_not_found', 404);

    foreach ($reviews as &$rv) $rv['published'] = (bool) $rv['published'];
    unset($rv);

    store_out([
        'phone' => $phone,
        'orders' => $orders,
        'reviews' => $reviews,
        'returns' => $returns,
        'blocked' => $block,
        'account' => $account,
        'notes'   => crm_notes_all($db)[$phone] ?? ['note' => null, 'tags' => [], 'updated_by' => null, 'updated_at' => null],
    ]);
}

// Save one customer's note and tags. The whole pair is sent and stored, so
// the screen never has to merge; an empty note and no tags deletes the row
// rather than leaving an empty one behind.
if ($r === 'crm_note_save' && $method === 'POST') {
    $b = store_body();
    $phone = store_phone((string) ($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    if (!crm_notes_ready($db)) store_fail('notes_not_available', 503);

    $note = trim(mb_substr((string) ($b['note'] ?? ''), 0, 2000));
    $tags = crm_tags_clean($b['tags'] ?? []);

    if ($note === '' && !$tags) {
        $db->prepare('delete from customer_notes where phone = ?')->execute([$phone]);
    } else {
        $db->prepare(
            'insert into customer_notes (phone, note, tags, updated_by) values (?, ?, ?, ?)
             on duplicate key update note = values(note), tags = values(tags),
                                     updated_by = values(updated_by)'
        )->execute([$phone, $note === '' ? null : $note, implode(',', $tags),
                    (string) ($_SESSION['admin_email'] ?? '')]);
    }
    store_out(['ok' => true, 'phone' => $phone, 'note' => $note === '' ? null : $note, 'tags' => $tags]);
}

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

// ================================================================== reviews
//
// WHAT WAS WRONG. The shop asks every customer what they thought and pays 20%
// for the answer — and the answer was written to `reviews.comment` and never
// read again. Not by the storefront, not here, not by any route. Forty-six
// products, a discount code spent on each reply, and no screen anywhere that
// could show one. The feature was collecting the data and throwing away the
// point of collecting it.
//
// Admin-only, and deliberately so: these are unmoderated free-text strings from
// the public, and `reviews.published` exists precisely because the owner has not
// decided which of them should ever appear on a product page. Reading them is
// step one; putting them on the shop is a separate decision.
if ($r === 'reviews') {
    $rows = $db->query(
        "select v.id, v.rating, v.comment, v.lang, v.reward_code, v.published,
                v.created_at, o.track_id, o.customer_name
           from reviews v
           join orders o on o.id = v.order_id
          order by v.created_at desc
          limit 300"
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['rating'] = (int)$row['rating'];
        $row['published'] = (bool)$row['published'];
    }
    unset($row);
    // The averages the owner actually wants at a glance, computed here rather
    // than in the browser so a 300-row page limit cannot silently change them.
    $stats = $db->query(
        'select count(*) as total, round(avg(rating), 2) as average,
                count(case when comment is not null and comment <> \'\' then 1 end) as with_comment
           from reviews'
    )->fetch();
    store_out(['reviews' => $rows, 'stats' => [
        'total' => (int)($stats['total'] ?? 0),
        'average' => $stats['average'] === null ? null : (float)$stats['average'],
        'with_comment' => (int)($stats['with_comment'] ?? 0),
    ]]);
}

// Show it on the product page, or do not. Nothing reads `published` on the
// storefront yet — this records the decision so that when something does, the
// owner has already made it rather than publishing 300 strings at once.
// --------------------------------------------------------------- سبورتا AI
//
// What the assistant COULD NOT answer. Every row is a customer who was told a
// colleague would follow up, so this screen is a to-do list rather than a log —
// and `sent_at`/`last_error` make visible the case the old fire-and-forget
// handoff hid completely: n8n never took it.
if ($r === 'assistant_log') {
    $rows = $db->query(
        'select id, intent, lang, message, reply, created_at, sent_at, attempts,
                last_error, handled_at
           from assistant_outbox
          order by created_at desc
          limit 200'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['attempts'] = (int) $row['attempts'];
        // Stuck for good, so the screen can say so rather than showing an
        // ordinary unsent row that will never move again.
        $row['gave_up'] = $row['sent_at'] === null && $row['attempts'] >= 5;
    }
    store_out($rows);
}

// Mark one dealt with BY A PERSON. Deliberately separate from sent_at: the
// webhook delivering is not the same event as somebody actually replying to
// the customer, and conflating them would let a green queue stand in for work
// nobody did.
if ($r === 'assistant_handled' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $on = !empty($b['handled']);
    $q = $db->prepare('update assistant_outbox set handled_at = ? where id = ?');
    $q->execute([$on ? date('Y-m-d H:i:s') : null, $id]);
    if ($q->rowCount() === 0) {
        $chk = $db->prepare('select 1 from assistant_outbox where id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) store_fail('not_found');
    }
    store_out(['id' => $id, 'handled' => $on]);
}

// ------------------------------------------------- the answers the shop wrote
//
// assistant_log above is the list of questions the shop COULD NOT answer.
// These four routes are how that list gets shorter: the owner reads a question
// nobody could handle, writes the answer once, and the assistant returns it
// verbatim from then on (assistant.php, assistant_qa_match).
//
// The phrase stored is a set of KEYWORDS, not a sentence — the matcher folds
// both sides and requires every significant word to be present, so "جمعه
// مفتوح" catches "هل انتم مفتوحين يوم الجمعة؟" and a full sentence would catch
// almost nothing. The screen says so; this is the note for whoever reads the
// route first.
if ($r === 'qa') {
    $rows = $db->query(
        'select id, q_ar, q_en, a_ar, a_en, active, hits, last_hit_at, updated_at
           from assistant_qa
          order by active desc, hits desc, id'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['active'] = (int) $row['active'] === 1;
        $row['hits']   = (int) $row['hits'];
    }
    store_out($rows);
}

if ($r === 'qa_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);

    $qAr = trim((string)($b['q_ar'] ?? ''));
    $qEn = trim((string)($b['q_en'] ?? ''));
    $aAr = trim((string)($b['a_ar'] ?? ''));
    $aEn = trim((string)($b['a_en'] ?? ''));

    // A row with no question matches nothing and would sit in the list looking
    // like a working answer. Refuse it here rather than store a dead row.
    if ($qAr === '' && $qEn === '') store_fail('question_required');
    // Both answers, because a shop that replies to Arabic in English has not
    // replied. The matcher will fall back if one is somehow blank, but nothing
    // should be able to create that state deliberately.
    if ($aAr === '' || $aEn === '') store_fail('answer_required');

    // The column widths, checked before MySQL truncates silently under a
    // non-strict mode — a half-stored answer is worse than a refused one.
    if (mb_strlen($qAr) > 200 || mb_strlen($qEn) > 200) store_fail('question_too_long');
    if (mb_strlen($aAr) > 1000 || mb_strlen($aEn) > 1000) store_fail('answer_too_long');

    if ($id > 0) {
        $q = $db->prepare('update assistant_qa set q_ar = ?, q_en = ?, a_ar = ?, a_en = ? where id = ?');
        $q->execute([$qAr, $qEn, $aAr, $aEn, $id]);
        $chk = $db->prepare('select 1 from assistant_qa where id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) store_fail('not_found');
    } else {
        $db->prepare('insert into assistant_qa (q_ar, q_en, a_ar, a_en) values (?, ?, ?, ?)')
           ->execute([$qAr, $qEn, $aAr, $aEn]);
        $id = (int) $db->lastInsertId();
    }

    $row = $db->prepare('select id, q_ar, q_en, a_ar, a_en, active, hits, last_hit_at, updated_at
                           from assistant_qa where id = ?');
    $row->execute([$id]);
    $out = $row->fetch();
    $out['active'] = (int) $out['active'] === 1;
    $out['hits']   = (int) $out['hits'];
    store_out($out);
}

// Hidden, not deleted — the same convention as brands, and for a sharper
// reason: an answer that turned out to be wrong must stop being given at once,
// and must still be readable by whoever asks why the shop said it.
if ($r === 'qa_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $on = !empty($b['active']);
    $q = $db->prepare('update assistant_qa set active = ? where id = ?');
    $q->execute([$on ? 1 : 0, $id]);
    if ($q->rowCount() === 0) {
        $chk = $db->prepare('select 1 from assistant_qa where id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) store_fail('not_found');
    }
    store_out(['id' => $id, 'active' => $on]);
}

// WHAT THIS ANSWER WOULD DO, without waiting for a customer to ask. The owner
// types a question the way a customer would and sees which row fires — the one
// check that catches a phrase written as a sentence, which is the mistake this
// design invites. Read-only: it never increments hits and never hands off.
if ($r === 'qa_try' && $method === 'POST') {
    $b = store_body();
    $text = trim((string)($b['message'] ?? ''));
    if ($text === '') store_fail('message_required');

    require_once __DIR__ . '/assistant.php';
    $hay = assistant_normalise($text);
    $rows = $db->query('select id, q_ar, q_en from assistant_qa where active = 1 order by id')
               ->fetchAll(PDO::FETCH_ASSOC);

    $best = 0; $bestWords = 0;
    foreach ($rows as $row) {
        foreach ([$row['q_ar'], $row['q_en']] as $phrase) {
            $phrase = assistant_normalise((string)$phrase);
            if ($phrase === '') continue;
            $words = array_values(array_filter(explode(' ', $phrase),
                static fn($w) => mb_strlen($w) > 1));
            if (!$words) continue;
            $all = true;
            foreach ($words as $w) if (mb_strpos($hay, $w) === false) { $all = false; break; }
            if ($all && count($words) > $bestWords) { $bestWords = count($words); $best = (int)$row['id']; }
        }
    }
    store_out(['id' => $best ?: null, 'words' => $bestWords]);
}

if ($r === 'review_publish' && $method === 'POST') {
    $b = store_body();
    $db->prepare('update reviews set published = ? where id = ?')
       ->execute([!empty($b['published']) ? 1 : 0, (int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// ================================================== returns and exchanges
//
// A to-do list, not a log. Every row is a customer waiting to hear whether a
// courier is coming, and the ones at the top are the ones nobody has looked at.

if ($r === 'returns') {
    $status = trim((string)($_GET['status'] ?? ''));
    $ok = ['new','approved','picked_up','refunded','rejected','cancelled'];
    $where = in_array($status, $ok, true) ? 'where rr.status = ?' : '';
    $q = $db->prepare(
        "select rr.id, rr.ref, rr.kind, rr.status, rr.reason, rr.lang, rr.phone,
                rr.staff_note, rr.created_at, rr.decided_at,
                o.track_id, o.customer_name, o.payment_method, o.amount,
                o.created_at as ordered_at, o.fulfilled_at
           from return_requests rr
           join orders o on o.id = rr.order_id
           $where
          order by rr.created_at desc limit 300"
    );
    $q->execute($where === '' ? [] : [$status]);
    $rows = $q->fetchAll();

    // The lines, fetched for every listed request in ONE query rather than one
    // query per row. Thirty requests on a screen is thirty round trips to
    // MariaDB otherwise, and the screen is the one the shop opens every day.
    $byRequest = [];
    if ($rows) {
        $ids = array_column($rows, 'id');
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $li = $db->prepare(
            "select ri.request_id, ri.qty, ri.want_size,
                    oi.size, oi.unit_price,
                    coalesce(oi.name_en, p.name_en) as name_en,
                    coalesce(oi.name_ar, p.name_ar) as name_ar,
                    p.slug, p.image
               from return_request_items ri
               join order_items oi on oi.id = ri.order_item_id
               join products p on p.id = oi.product_id
              where ri.request_id in ($in) order by ri.id"
        );
        $li->execute($ids);
        foreach ($li->fetchAll() as $l) {
            $rid = (int)$l['request_id'];
            unset($l['request_id']);
            $l['qty'] = (int)$l['qty'];
            $l['unit_price'] = (float)$l['unit_price'];
            $byRequest[$rid][] = $l;
        }
    }
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['amount'] = (float)$row['amount'];
        $row['items'] = $byRequest[(int)$row['id']] ?? [];
    }
    unset($row);

    // The counts the owner wants at a glance, computed here rather than from
    // the 300-row page — a limit must not silently change a total.
    $counts = [];
    foreach ($db->query('select status, count(*) as n from return_requests group by status')
                ->fetchAll() as $c) $counts[$c['status']] = (int)$c['n'];
    store_out(['returns' => $rows, 'counts' => $counts]);
}

if ($r === 'return_status' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $to = (string)($b['status'] ?? '');
    // The SAME list the CHECK constraint carries. A status the database would
    // refuse must be refused here, with a name, rather than arriving as a
    // driver-level exception the panel shows as "something went wrong".
    if (!in_array($to, ['new','approved','picked_up','refunded','rejected','cancelled'], true)) {
        store_out(['error' => 'bad_status'], 422);
    }
    $note = store_opt($b['note'] ?? null);
    // REJECTING WITHOUT A REASON IS NOT ALLOWED. The customer is told why, and
    // "no reason given" is not a thing the shop should be able to send.
    if ($to === 'rejected' && ($note === null || $note === '')) {
        store_out(['error' => 'reason_required'], 422);
    }
    $q = $db->prepare('select status from return_requests where id = ?');
    $q->execute([$id]);
    if ($q->fetchColumn() === false) store_out(['error' => 'not_found'], 404);

    // decided_at is set the first time it leaves 'new' and never moved again:
    // it answers "how long did the customer wait to hear", which a later
    // status change would erase.
    $db->prepare(
        "update return_requests
            set status = ?,
                staff_note = coalesce(?, staff_note),
                decided_at = case when decided_at is null and ? <> 'new'
                                  then current_timestamp else decided_at end
          where id = ?"
    )->execute([$to, $note, $to, $id]);
    store_out(['ok' => true]);
}

// ================================================================== account
//
// The four changes that decide who can sign in tomorrow: the password, the
// email, the mobile number, and whether a second factor is required at all.
//
// EVERY ONE OF THEM COSTS THE CURRENT PASSWORD PLUS A FRESH CODE. A session
// cookie is a bearer token and an unlocked laptop is enough to hold one; these
// are precisely the changes that would turn five minutes at someone's desk
// into permanent ownership of the shop. Asking again for both factors means
// the person making the change is the person who owns the account right now,
// not whoever the browser happens to belong to.

if ($r === 'account') {
    $q = $db->prepare('select email, phone, totp_enabled, email_otp_enabled, last_login_at
                         from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);
    store_out([
        'email' => $u['email'],
        'phone' => $u['phone'],
        'totp'  => (int)$u['totp_enabled'] === 1,
        // Missing until now — the Security screen needs to tell an admin
        // which second factor is on, and me()'s own `totp` field only ever
        // answered half that question. TOTP wins where both are enrolled
        // (store_login() checks it first), so both are reported rather than
        // one collapsed answer that would hide an email code an admin had
        // turned on and then forgotten, believing TOTP was the only door.
        'email_otp' => (int)($u['email_otp_enabled'] ?? 0) === 1,
        'last_login_at' => $u['last_login_at'],
    ]);
}

// Begin enrolment: mint a secret and hand back what the phone needs.
//
// The secret is STORED but totp_enabled stays 0 until a code proves the phone
// actually has it. Enabling first and confirming later is how an owner ends up
// locked out by a mistyped scan.
if ($r === 'totp_begin' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select password_hash, totp_enabled, email from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);
    // Re-enrolling would silently invalidate the phone that currently works,
    // so it needs the same ceremony as turning it off.
    if ((int)$u['totp_enabled'] === 1) store_fail('already_enrolled', 409);
    // The password, even here. Otherwise an unlocked laptop can enrol an
    // attacker's OWN phone as the second factor and lock the owner out of
    // their shop with the owner's own password still working.
    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }

    $secret = store_totp_secret();
    $db->prepare('update admin_users set totp_secret = ?, totp_last_step = null where id = ?')
       ->execute([$secret, $admin['id']]);
    store_out([
        'secret' => $secret,
        'uri'    => store_totp_uri($secret, (string)$u['email']),
    ]);
}

// Finish enrolment: a code from the phone, checked against the stored secret.
if ($r === 'totp_enable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select totp_secret, totp_enabled from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || (string)$u['totp_secret'] === '') store_fail('not_started', 409);
    if ((int)$u['totp_enabled'] === 1) store_fail('already_enrolled', 409);

    store_throttle($db, 'totp', 10, 300);
    if (!store_totp_claim($db, (int)$admin['id'], (string)$u['totp_secret'], (string)($b['code'] ?? ''))) {
        store_fail('bad_code', 401);
    }
    $db->prepare('update admin_users set totp_enabled = 1 where id = ?')->execute([$admin['id']]);
    store_out(['ok' => true, 'totp' => true]);
}

// Turn it off. Password AND a working code — if the phone is lost, this is not
// the route: reset-admin.php on the server is, because that one proves you can
// read config.php rather than that you can hold the phone.
// ------------------------------------------- the emailed code, as a factor
//
// The same three-step ceremony TOTP has, for the same reasons, and one extra
// one that matters more here than it does there.
//
// THE EXTRA ONE: enrolling PROVES THE MAIL ARRIVES. otp_begin sends a code and
// otp_enable will not switch the factor on until that code comes back, so an
// owner cannot lock the door with a key they never received. TOTP does not
// need this — the app shows the code whether or not anything works — but a
// second factor that depends on a mail server nobody has tested is the one way
// this feature could take the shop away from its owner.

if ($r === 'otp_begin' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select id, email, password_hash, email_otp_enabled, email_otp_sent_at
                         from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);
    if ((int)$u['email_otp_enabled'] === 1) store_fail('already_enrolled', 409);

    // The password, even here, and for the reason totp_begin gives: without it
    // an unlocked laptop enrols a factor the owner does not hold.
    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    $code = store_email_otp_issue($db, $u);
    $sent = store_email_otp_send($u, $code, ($b['lang'] ?? '') === 'en' ? 'en' : 'ar');
    // `sent` false is not an error to hide: it is the answer to "will this
    // work", asked at the only moment when finding out is free.
    store_out(['sent' => $sent, 'to' => store_mask_email((string)$u['email'])]);
}

if ($r === 'otp_enable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select email_otp_enabled, email_otp_hash from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || $u['email_otp_hash'] === null) store_fail('not_started', 409);
    if ((int)$u['email_otp_enabled'] === 1) store_fail('already_enrolled', 409);

    store_throttle($db, 'totp', 10, 300);
    if (!store_email_otp_claim($db, (int)$admin['id'], (string)($b['code'] ?? ''))) {
        store_fail('bad_code', 401);
    }
    $db->prepare('update admin_users set email_otp_enabled = 1 where id = ?')->execute([$admin['id']]);
    store_out(['ok' => true, 'email_otp' => true]);
}

// A fresh code for an admin who is ALREADY signed in, because the one they
// signed in with was consumed on use and store_require_fresh_code() needs a
// live one before a password, an email or a phone number can change.
//
// It mails the signed-in account's OWN address and nothing else — there is no
// recipient in the body to choose — and it is throttled twice: once a minute
// from the row, six times in fifteen minutes from the IP.
if ($r === 'otp_send' && $method === 'POST') {
    $q = $db->prepare('select id, email, email_otp_enabled, email_otp_sent_at
                         from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || (int)$u['email_otp_enabled'] !== 1) store_fail('not_enrolled', 409);
    if ($u['email_otp_sent_at'] !== null
        && time() - strtotime((string)$u['email_otp_sent_at']) < STORE_EMAIL_OTP_RESEND_SECONDS) {
        store_fail('too_soon', 429);
    }
    store_throttle($db, 'otp_send', 6, 900);
    $code = store_email_otp_issue($db, $u);
    store_out(['sent' => store_email_otp_send($u, $code),
               'to' => store_mask_email((string)$u['email'])]);
}

// Turning it OFF costs the password and a live code, exactly as turning TOTP
// off does: it is a change to who can sign in tomorrow, and an unlocked laptop
// must not be enough to make it.
if ($r === 'otp_disable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select password_hash, email_otp_enabled from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || (int)$u['email_otp_enabled'] !== 1) store_fail('not_enrolled', 409);

    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    store_throttle($db, 'totp', 10, 300);
    if (!store_email_otp_claim($db, (int)$admin['id'], (string)($b['code'] ?? ''))) {
        store_fail('bad_code', 401);
    }
    $db->prepare('update admin_users set email_otp_enabled = 0, email_otp_hash = null,
                      email_otp_expires = null, email_otp_attempts = 0 where id = ?')
       ->execute([$admin['id']]);
    store_out(['ok' => true, 'email_otp' => false]);
}

if ($r === 'totp_disable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select password_hash from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    store_throttle($db, 'account', 10, 300);
    if (!$u || !password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    store_require_fresh_code($db, $admin, (string)($b['code'] ?? ''));
    $db->prepare('update admin_users set totp_enabled = 0, totp_secret = null, totp_last_step = null where id = ?')
       ->execute([$admin['id']]);
    store_out(['ok' => true, 'totp' => false]);
}

// Change the password, the email, or the mobile number. One route, because
// they carry the same authority and must not drift into three different ideas
// of how much proof a change needs.
if ($r === 'account_update' && $method === 'POST') {
    $b = store_body();

    $q = $db->prepare('select email, phone, password_hash from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);

    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    store_require_fresh_code($db, $admin, (string)($b['code'] ?? ''));

    $sets = [];
    $args = [];

    if (array_key_exists('new_password', $b) && (string)$b['new_password'] !== '') {
        $new = (string)$b['new_password'];
        // Twelve, the same floor setup-admin.php and reset-admin.php enforce.
        // Three places agreeing is the point: a password rule that is stricter
        // in one door than another is the weakest of the three.
        // Typed twice, for the same reason reset-admin.php asks twice: a typo
        // here signs you out of a shop you can no longer sign in to.
        if (!hash_equals($new, (string)($b['new_password2'] ?? ''))) store_fail('password_mismatch');
        // Length, the weak-pattern list and the breach check — the same bar the reset route sets (2026-10-04).
        sec_password_refuse($new, (string) $u['email']);
        // A new password signs every OTHER browser out (the sessions ledger); this one stays.
        try { if (sec_tables_ready($db)) sec_sessions_revoke_others($db, (int) $admin['id']); } catch (Throwable $e) {}
        $sets[] = 'password_hash = ?';
        $args[] = password_hash($new, PASSWORD_DEFAULT);
        // THIS is where must_change_password clears — a chosen password is a
        // real one whether the account was flagged or not, so this always
        // runs alongside the hash rather than only when the flag was set.
        $sets[] = 'must_change_password = 0';
    }

    if (array_key_exists('email', $b)) {
        $email = mb_strtolower(trim((string)$b['email']));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) store_fail('invalid_email');
        if (mb_strlen($email) > 120) store_fail('invalid_email');
        if ($email !== $u['email']) {
            $dupe = $db->prepare('select 1 from admin_users where email = ? and id <> ?');
            $dupe->execute([$email, $admin['id']]);
            if ($dupe->fetchColumn()) store_fail('email_taken', 409);
            $sets[] = 'email = ?';
            $args[] = $email;
        }
    }

    if (array_key_exists('phone', $b)) {
        $phone = trim((string)$b['phone']);
        if ($phone === '') {
            $sets[] = 'phone = ?';
            $args[] = null;
        } else {
            // Digits, spaces and a leading + only. This is the owner's own
            // number and it is not dialled by any code — but a free-text column
            // on an admin row is somewhere to hide a payload, and refusing is
            // cheaper than remembering to escape it everywhere it is shown.
            if (!preg_match('/^\+?[0-9 ]{6,19}$/', $phone)) store_fail('invalid_phone');
            $sets[] = 'phone = ?';
            $args[] = $phone;
        }
    }

    // Checked AFTER the email block, against whichever address will be in
    // effect once this save lands — an admin changing their email and their
    // password in the same request must not have the new password checked
    // against the address they are leaving.
    if (isset($new)) {
        $effectiveEmail = $email ?? $u['email'];
        if (($weak = store_password_is_weak($new, (string)$effectiveEmail)) !== null) store_fail($weak);
    }

    if (!$sets) store_fail('nothing_to_update');

    $args[] = $admin['id'];
    $db->prepare('update admin_users set ' . implode(', ', $sets) . ' where id = ?')->execute($args);

    // A CHANGED PASSWORD ENDS EVERY SESSION, INCLUDING THIS ONE. The reason
    // people change a password is that they think someone else may have it,
    // and leaving the other browser signed in is exactly the thing they were
    // trying to stop. The email is refreshed in the session instead, so a
    // rename does not sign the owner out of their own screen.
    if (in_array('password_hash = ?', $sets, true)) {
        try { $db->prepare('delete from admin_devices where admin_id = ?')->execute([$admin['id']]); } catch (Throwable $e) {}
        store_session_end();
        store_out(['ok' => true, 'signed_out' => true]);
    }
    if (array_key_exists('email', $b) && in_array('email = ?', $sets, true)) {
        $_SESSION['admin_email'] = $args[array_search('email = ?', $sets, true)];
    }
    store_out(['ok' => true]);
}

// ---------------------------------------------------------------- Web Push
// The owner's phone. See push.mysql.sql for the shape and webpush.php for the
// crypto; these four routes are only the plumbing between the two.

// What the Notifications screen needs on its first render, in one call: the
// key the browser must subscribe with, whether the feature is configured at
// all, and which devices are already signed up.
if ($r === 'push_state') {
    $cfg = store_config();
    $ready = ($cfg['vapid_public'] ?? '') !== '' && ($cfg['vapid_private'] ?? '') !== '';
    $subs = [];
    $recent = [];
    if ($ready) {
        // A shop that has the keys but has not imported push.mysql.sql would
        // 500 here on a missing table. Answer "configured, no devices" instead:
        // the screen then says exactly what is wrong in its own words.
        try {
            $subs = $db->query(
                'select id, label, created_at, last_ok_at, last_error,
                        substring(endpoint, 1, 40) as endpoint_head
                   from push_subscriptions order by id'
            )->fetchAll();
            $recent = $db->query(
                'select id, title, body, created_at, sent_at, attempts, last_error
                   from push_outbox order by id desc limit 10'
            )->fetchAll();
        } catch (Throwable $e) {
            store_out(['ready' => false, 'reason' => 'no_table',
                       'public_key' => '', 'subscriptions' => [], 'recent' => []]);
        }
    }
    store_out([
        'ready'         => $ready,
        'reason'        => $ready ? '' : 'no_keys',
        // The PUBLIC half only. The private scalar never leaves the server —
        // it is what proves a push came from this shop.
        'public_key'    => $ready ? (string) $cfg['vapid_public'] : '',
        'subscriptions' => $subs,
        'recent'        => $recent,
    ]);
}

// Record this browser. The body is PushSubscription.toJSON() plus a label.
if ($r === 'push_subscribe' && $method === 'POST') {
    $b = store_body();
    $endpoint = trim((string) ($b['endpoint'] ?? ''));
    $p256dh   = trim((string) ($b['p256dh'] ?? ''));
    $auth     = trim((string) ($b['auth'] ?? ''));

    // Only the two push services this shop can actually reach, over TLS. A
    // subscription is an outbound POST the cron makes on a schedule with no
    // human watching; an arbitrary URL in this column is a server-side request
    // forgery with a cron job driving it.
    if (!preg_match('~^https://[a-z0-9.-]+\.(apple|googleapis|mozilla)\.com/~i', $endpoint)
        || strlen($endpoint) > 500) {
        store_fail('bad_endpoint');
    }
    require_once __DIR__ . '/webpush.php';
    // Validate the keys HERE, where a person is watching, rather than at 3am in
    // a cron whose only symptom is a phone that never buzzes.
    if (strlen(wp_b64_decode($p256dh)) !== 65) store_fail('bad_p256dh');
    if (strlen(wp_b64_decode($auth)) !== 16)   store_fail('bad_auth');

    // Re-subscribing the same phone must not add a second row — the browser
    // hands back the identical endpoint, and two rows would mean two buzzes.
    $db->prepare(
        'insert into push_subscriptions (endpoint, endpoint_hash, p256dh, auth, label)
         values (?, ?, ?, ?, ?)
         on duplicate key update p256dh = values(p256dh), auth = values(auth),
                                 label = values(label), last_error = null'
    )->execute([$endpoint, hash('sha256', $endpoint), $p256dh, $auth,
                mb_substr(trim((string) ($b['label'] ?? '')), 0, 60)]);
    store_out(['ok' => true]);
}

// Stop notifying one device. By id, from the list the screen already has.
if ($r === 'push_unsubscribe' && $method === 'POST') {
    $b = store_body();
    $db->prepare('delete from push_subscriptions where id = ?')->execute([(int) ($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// Queue a test alert. NOT a direct send: it goes through the same outbox and
// the same cron as a real order, so a green test proves the path an order will
// actually take rather than a second one written to look like it.
if ($r === 'push_test' && $method === 'POST') {
    $db->prepare('insert into push_outbox (order_id, kind, title, body, url) values (null, ?, ?, ?, ?)')
       ->execute(['test', 'سبورتا · تجربة', 'إذا وصلك هذا، فإشعارات الطلبات تعمل.', '/backends']);
    store_out(['ok' => true]);
}

// ------------------------------------------------------------- size charts
//
// The numbers behind "what is my size?". They are seeded from the guide the
// site has always published and they are NOT ours — they belong to whoever
// cuts the garments. is_default marks a row nobody has checked against a real
// garment yet, and the screen says so, because advice built on unverified
// numbers should not look identical to advice built on the factory's spec.

if ($r === 'size_charts') {
    $rows = $db->query(
        'select id, chart, size, chest_min, chest_max, waist_min, waist_max,
                hip_min, hip_max, length_cm, is_default, sort
           from size_charts order by chart, sort, id'
    )->fetchAll();
    // How much the advice is actually being used, and on what. A chart nobody
    // consults is not worth an afternoon with a tape measure; one that answers
    // fifty questions a week is.
    $stats = $db->query(
        "select count(*) total,
                sum(confidence = 'high') measured,
                sum(confidence = 'low') estimated,
                sum(outcome = 'returned') returned
           from size_advice_log where created_at > date_sub(now(), interval 30 day)"
    )->fetch() ?: [];
    store_out(['rows' => $rows, 'stats' => $stats]);
}

if ($r === 'size_chart_save' && $method === 'POST') {
    $b = store_body();
    $id = (int) ($b['id'] ?? 0);
    // A band is only a band if its top is at or above its bottom. A row saved
    // the wrong way round does not error anywhere — it silently matches
    // NOBODY, and the adviser then answers every body with the last size in
    // the chart.
    $pair = function (string $lo, string $hi) use ($b) {
        $a = $b[$lo] === '' || $b[$lo] === null ? null : (int) $b[$lo];
        $z = $b[$hi] === '' || $b[$hi] === null ? null : (int) $b[$hi];
        if ($a === null || $z === null) return [null, null];
        if ($a < 30 || $z > 250 || $z < $a) store_fail('bad_range');
        return [$a, $z];
    };
    [$c1, $c2] = $pair('chest_min', 'chest_max');
    [$w1, $w2] = $pair('waist_min', 'waist_max');
    [$h1, $h2] = $pair('hip_min', 'hip_max');
    if ($c1 === null || $w1 === null) store_fail('chest_and_waist_required');

    $size = strtoupper(trim((string) ($b['size'] ?? '')));
    if (!in_array($size, ['S','M','L','XL','2XL','3XL','4XL','5XL'], true)) store_fail('bad_size');
    $chart = preg_replace('/[^a-z0-9_-]/', '', strtolower(trim((string) ($b['chart'] ?? ''))));
    if ($chart === '') store_fail('bad_chart');

    $args = [$chart, $size, $c1, $c2, $w1, $w2, $h1, $h2,
             ($b['length_cm'] ?? '') === '' ? null : (int) $b['length_cm'],
             (int) ($b['sort'] ?? 0)];
    if ($id > 0) {
        // Any hand-edited row stops being a default, by definition: somebody
        // has now looked at it.
        $db->prepare('update size_charts set chart=?, size=?, chest_min=?, chest_max=?,
                        waist_min=?, waist_max=?, hip_min=?, hip_max=?, length_cm=?, sort=?,
                        is_default = 0 where id = ?')
           ->execute([...$args, $id]);
    } else {
        $db->prepare('insert into size_charts (chart, size, chest_min, chest_max, waist_min,
                        waist_max, hip_min, hip_max, length_cm, sort, is_default)
                      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                      on duplicate key update chest_min=values(chest_min), chest_max=values(chest_max),
                        waist_min=values(waist_min), waist_max=values(waist_max),
                        hip_min=values(hip_min), hip_max=values(hip_max),
                        length_cm=values(length_cm), sort=values(sort), is_default=0')
           ->execute($args);
    }
    store_out(['ok' => true]);
}

// What the shop has been telling people, newest first. The one screen that
// says whether the chart is any good.
if ($r === 'size_advice_log') {
    store_out($db->query(
        'select id, created_at, slug, lang, height_cm, weight_kg, chest_cm, waist_cm,
                hip_cm, usual_size, prefers, size, fit, confidence, outcome
           from size_advice_log order by id desc limit 100'
    )->fetchAll());
}

// ===========================================================================
// ACCOUNTING
//
// The ledger itself is in accounting.php; these routes are only a door onto
// it. Two rules hold across all of them:
//
//   * Every route degrades to a clear "not installed" rather than a 500 if
//     accounting.mysql.sql has not been imported. A shop mid-upgrade must be
//     told what to do, not shown a stack trace.
//   * Nothing here can edit or delete a posted entry, because acc_post() is
//     the only writer and it does not offer either. A correction is a
//     reversal, and that is a route of its own.
// ===========================================================================

// Is the ledger installed? Asked once, cached for the request, and every
// accounting route below is guarded by it.
function admin_acc_ready(PDO $db): bool {
    static $ready = null;
    if ($ready === null) {
        try {
            $db->query('select 1 from accounts limit 1');
            require_once __DIR__ . '/accounting.php';
            $ready = true;
        } catch (Throwable $e) {
            $ready = false;
        }
    }
    return $ready;
}

if (str_starts_with($r, 'acc_') && !admin_acc_ready($db)) {
    // 200 with a flag, not an error status: this is a normal state for a shop
    // that has not run the migration, and the screen renders instructions from
    // it. A 500 here would read as a broken admin.
    store_out(['installed' => false,
               'hint' => 'Import dropin/php-store/accounting.mysql.sql in phpMyAdmin.']);
}

// The Accounting screen's opening state: is posting on, what is the rate, and
// how much is owed to the ledger. The last of those is the number that matters
// — a ledger can balance perfectly while missing a week of sales.
if ($r === 'acc_summary') {
    $unposted = acc_unposted_orders($db);
    $owed = 0;
    foreach ($unposted as $o) $owed += store_fils($o['amount']);
    store_out([
        'installed' => true,
        'settings'  => acc_settings($db),
        'unposted_count' => count($unposted),
        'unposted_total' => store_kwd($owed),
        'unposted' => array_slice($unposted, 0, 25),
    ]);
}

if ($r === 'acc_accounts') {
    store_out(acc_accounts($db));
}

if ($r === 'acc_trial_balance') {
    store_out(acc_trial_balance($db, $_GET['from'] ?? null, $_GET['to'] ?? null));
}

if ($r === 'acc_pl') {
    store_out(acc_profit_loss($db, admin_acc_date($_GET['from'] ?? null, '-1 month'),
                                   admin_acc_date($_GET['to'] ?? null, 'now')));
}

if ($r === 'acc_bs') {
    store_out(acc_balance_sheet($db, admin_acc_date($_GET['as_at'] ?? null, 'now')));
}

if ($r === 'acc_journal') {
    store_out(['entries' => acc_journal($db, $_GET['from'] ?? null, $_GET['to'] ?? null,
                                        min(200, max(1, (int)($_GET['limit'] ?? 100))))]);
}

// A date from the query string, or a sensible default. VALIDATED rather than
// interpolated: these reach a prepared statement, so this is not an injection
// guard — it is a guard against a malformed date silently selecting nothing
// and the screen reporting a month of zero sales as though that were the
// answer.
function admin_acc_date(?string $v, string $fallback): string {
    if ($v !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return $v;
    return date('Y-m-d', strtotime($fallback));
}

// A manual entry — an expense, an owner contribution, an opening balance.
//
// The lines arrive from the browser and are checked HERE as well as in
// acc_post(), because the two checks answer different questions: this one
// rejects a shape the screen should never have sent, and acc_post() enforces
// the accounting rule. Neither substitutes for the other.
if ($r === 'acc_entry_add' && $method === 'POST') {
    $b = store_body();
    $date = admin_acc_date($b['date'] ?? null, 'now');
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200);
    if ($memo === '') store_fail('memo_required');

    $lines = [];
    foreach ((array)($b['lines'] ?? []) as $l) {
        $code = trim((string)($l['code'] ?? ''));
        if ($code === '') continue;
        // Amounts arrive as KWD strings from a form and become fils here, once.
        $debit  = store_fils($l['debit']  ?? 0);
        $credit = store_fils($l['credit'] ?? 0);
        if ($debit < 0 || $credit < 0) store_fail('negative_amount');
        $lines[] = ['code' => $code, 'debit' => $debit, 'credit' => $credit,
                    'memo' => mb_substr(trim((string)($l['memo'] ?? '')), 0, 200)];
    }
    if (count($lines) < 2) store_fail('two_lines_required');

    try {
        $id = acc_post($db, $date, $memo, $lines, 'manual', null, null,
                       (string)($_SESSION['admin_email'] ?? ''));
    } catch (InvalidArgumentException | RuntimeException $e) {
        // The message is the accounting rule that was broken — "entry does not
        // balance — debits 5.000 vs credits 4.999" — and it is exactly what
        // the person typing needs to see. A generic 'failed' would send them
        // to count the figures themselves.
        //
        // ONLY THOSE TWO CLASSES, and that is the fix. This used to catch
        // Throwable and hand the message straight out, but acc_post() also
        // runs SQL: a PDOException escaping it put the driver's text — the
        // statement, the column, the constraint name — on the Accounting
        // screen. accounting.php throws nothing but these two, and every one
        // of the six is a sentence written for a bookkeeper.
        store_fail($e->getMessage());
    } catch (Throwable $e) {
        // Anything else is this shop's problem, not the bookkeeper's. It goes
        // to the server log, where it can be read by someone who can act on
        // it, and the screen says only that the entry did not post.
        error_log('acc_entry_add: ' . $e->getMessage());
        store_fail('could_not_post');
    }
    store_out(['id' => $id]);
}

if ($r === 'acc_entry_reverse' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['entry_id'] ?? 0);
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200) ?: 'Reversal';
    $new = acc_reverse($db, $id, $memo, (string)($_SESSION['admin_email'] ?? ''));
    if ($new === null) store_fail('cannot_reverse');
    store_out(['id' => $new]);
}

// Post the backlog — every paid order the ledger has not seen.
//
// Bounded per call, and that is not caution about time: it is so the screen
// can show what happened and be pressed again. A single call that posts nine
// hundred orders and returns one number is a call nobody can check.
if ($r === 'acc_post_unposted' && $method === 'POST') {
    if (!(acc_settings($db)['posting_enabled'] ?? false)) store_fail('posting_disabled');
    $done = 0; $failed = [];
    foreach (array_slice(acc_unposted_orders($db), 0, 100) as $o) {
        try {
            $done += acc_post_order($db, (int)$o['id'], (string)($_SESSION['admin_email'] ?? ''));
        } catch (InvalidArgumentException | RuntimeException $e) {
            // One bad order must not stop the other ninety-nine. It is named
            // instead, so it can be fixed at its source.
            //
            // THESE TWO CLASSES ONLY, for the reason given at acc_entry_add
            // above: acc_post_order() runs four prepared statements, so a
            // PDOException caught here would put the driver's text — the
            // statement, the column, the constraint name — on the Accounting
            // screen next to a customer's track ID. The two classes
            // accounting.php raises are sentences written for a bookkeeper;
            // anything else is this shop's problem, not theirs.
            $failed[] = ['track_id' => $o['track_id'], 'why' => $e->getMessage()];
        } catch (Throwable $e) {
            error_log('acc_post_unposted ' . $o['track_id'] . ': ' . $e->getMessage());
            $failed[] = ['track_id' => $o['track_id'], 'why' => 'could_not_post'];
        }
    }
    store_out(['posted' => $done, 'failed' => $failed,
               'remaining' => count(acc_unposted_orders($db))]);
}

if ($r === 'acc_settings_save' && $method === 'POST') {
    $b = store_body();
    $cur = acc_settings($db);
    $rate = trim((string)($b['aed_to_kwd'] ?? $cur['aed_to_kwd']));
    // A rate of zero would post every cost of goods as nothing, balance
    // perfectly, and report a margin of 100%. Refused rather than stored.
    if (!preg_match('/^\d+(\.\d{1,6})?$/', $rate) || (float)$rate <= 0) store_fail('bad_rate');
    store_setting_save($db, 'accounting', [
        'aed_to_kwd' => $rate,
        'posting_enabled' => (bool)($b['posting_enabled'] ?? $cur['posting_enabled']),
    ]);
    store_out(['ok' => true]);
}

// Add or rename an account. SYSTEM accounts cannot be touched: the posting
// rules name them by code, and renaming 4000 out from under acc_post_order()
// breaks posting on a live shop at the moment of a payment.
if ($r === 'acc_account_save' && $method === 'POST') {
    $b = store_body();
    $code = trim((string)($b['code'] ?? ''));
    $type = (string)($b['type'] ?? '');
    if (!preg_match('/^[0-9]{4}$/', $code)) store_fail('bad_code');
    if (!in_array($type, ['asset','liability','equity','revenue','expense'], true)) store_fail('bad_type');
    $nameEn = mb_substr(trim((string)($b['name_en'] ?? '')), 0, 80);
    $nameAr = mb_substr(trim((string)($b['name_ar'] ?? '')), 0, 80) ?: $nameEn;
    if ($nameEn === '') store_fail('name_required');

    $q = $db->prepare('select is_system from accounts where code = ?');
    $q->execute([$code]);
    $existing = $q->fetch();
    if ($existing && (int)$existing['is_system'] === 1) store_fail('system_account');

    $side = in_array($type, ['asset','expense'], true) ? 'debit' : 'credit';
    $db->prepare('insert into accounts (code, name_en, name_ar, type, normal_side, is_system, active)
                  values (?, ?, ?, ?, ?, 0, 1)
                  on duplicate key update name_en = values(name_en), name_ar = values(name_ar),
                                          type = values(type), normal_side = values(normal_side)')
       ->execute([$code, $nameEn, $nameAr, $type, $side]);
    store_out(['ok' => true]);
}

// ------------------------------------------------------------- audit log
//
// The read side of store_admin_audit_log(). `before_id` pages backward
// through it — the newest 100 by default, or the 100 older than a given id,
// which is a page of history rather than a live feed that has to agree with
// itself while more rows are still being written.
if ($r === 'audit_log') {
    $beforeId = (int) ($_GET['before_id'] ?? 0);
    $q = $beforeId > 0
        ? $db->prepare('select id, admin_email, route, status_code, summary, created_at
                          from admin_audit_log where id < ? order by id desc limit 100')
        : $db->prepare('select id, admin_email, route, status_code, summary, created_at
                          from admin_audit_log order by id desc limit 100');
    $q->execute($beforeId > 0 ? [$beforeId] : []);
    $rows = array_map(function ($row) {
        $row['summary'] = $row['summary'] !== null ? json_decode($row['summary'], true) : null;
        return $row;
    }, $q->fetchAll());
    store_out(['rows' => $rows]);
}

// ------------------------------------------------------------------ backup
//
// A full, owner-downloadable backup of the shop's OWN data: everything a
// restore needs to bring the catalogue, the orders, the books and the settings
// back to a known point, and nothing a restore must never touch.
//
// WHAT IS IN IT: BACKUP_TABLES in api/backup-build.php — every table the owner
// or a customer writes. WHAT IS NEVER IN IT: BACKUP_EXCLUDED beside it, each
// with its reason (logs, sessions and credentials, outboxes, counters, caches),
// plus two redactions inside rows that do travel — the admins' second factor,
// and the payment secrets the Payments screen keeps in settings.knet. That list
// was fourteen tables until 2026-10-08 and the accounting ledger was named
// here as "operational and transient"; it is the shop's books, and a restore
// that put the orders back and left the books alone would leave the two
// disagreeing about every sale since. config.php and the Wallet certificate
// are files, and this route reads only the database.
//
//   - admin_users.totp_secret is dropped, and totp_enabled is forced to 0 in
//     the EXPORTED copy only (never written back to the live row here). A
//     second-factor secret sitting in a file the owner can hand to anyone is a
//     secret that no longer proves anything. The cost, said plainly in the
//     preview: RESTORING admin_users switches every account's 2FA off. The
//     owner re-enrols afterwards.
//
// REPLACE, NOT MERGE — read this before changing either half of it. Import
// WHOLESALE REPLACES every table the FILE NAMES: an older backup will remove a
// product added since it was taken, revert a price edited since, and put back
// a phone number that was later unblocked. That is the decision, made on
// purpose and stated here so the code and the words agree: a "restore" that
// quietly keeps newer live edits is not a restore, it is an upsert wearing a
// restore's name — and CLAUDE.md already carries the cost of that exact
// confusion in the section on IMPORT-THIS-ONE.sql silently overwriting live
// prices while its own header said it did not. So: the panel's copy says
// REPLACE, the preview lists what would be REMOVED as prominently as what
// would be ADDED or CHANGED, and the restore is delete-then-insert inside one
// transaction rather than an `on duplicate key update`.
//
// A TABLE THE FILE DOES NOT NAME IS KEPT, and that is not merge: it is a table
// that backup does not contain. It matters the day the list grows — the
// eighteen tables added on 2026-10-08 are in no backup written before then,
// and treating "absent" as "empty" would have deleted the books, the suppliers
// and the purchase orders on the first restore of an older file.
require_once __DIR__ . '/backup-build.php';   // BACKUP_TABLES, backup_write, backup_diff, backup_restore

// The token that ties backup_import to a backup_preview of the SAME payload.
// It is not a secret and needs none: session_write_close() has already run
// by the time any route here executes (see the top of this file), so there
// is no per-admin server-side state left to stash a preview id in between two
// requests. What it buys instead is purely mechanical — the panel cannot
// reach the write route without first having computed this over the exact
// bytes it is about to send, which is what makes "preview, then a second,
// explicit confirmation" a shape the SERVER enforces rather than one the
// panel merely follows.
function backup_token(array $data): string {
    return hash('sha256', json_encode($data, JSON_UNESCAPED_UNICODE));
}

if ($r === 'backup_export' && $method === 'GET') {
    // Written to a temporary stream first (memory up to 1 MB, then a temp file
    // PHP removes at exit), so a failure halfway is a clean 500 rather than a
    // 200 carrying half a backup — and nothing ever holds the shop's photographs
    // as one PHP array, which is what store_out(backup_build()) did.
    $tmp = fopen('php://temp/maxmemory:1048576', 'w+b');
    try {
        backup_write($db, function (string $s) use ($tmp) {
            if (fwrite($tmp, $s) !== strlen($s)) throw new RuntimeException('backup temp write failed');
        });
    } catch (Throwable $e) {
        error_log('backup_export: ' . $e->getMessage());
        store_fail('backup_failed', 500);
    }
    rewind($tmp);
    // The audit hook at the top of this file buffers every response to see
    // whether a route answered. A GET is never logged, and buffering a whole
    // backup there would put it in memory twice more — so the plain buffers
    // are flushed (nothing is in them yet) and one empty buffer is reopened
    // for the hook to find at shutdown. A compression handler, if the host
    // runs one, is left where it is — which is also why no Content-Length is
    // sent: under compression it would be the wrong number.
    while (ob_get_level() > 0 && (ob_get_status()['name'] ?? '') === 'default output handler') ob_end_flush();
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    fpassthru($tmp);
    fclose($tmp);
    ob_start();
    exit;
}

if ($r === 'backup_preview' && $method === 'POST') {
    $b = store_body();
    $data = is_array($b['data'] ?? null) ? $b['data'] : null;
    $tables = is_array($data['tables'] ?? null) ? $data['tables'] : null;
    if ($data === null || $tables === null) store_fail('bad_backup_file');

    $d = backup_diff($db, $data);
    // A table the FILE names that this shop's backup does not — an older or
    // newer format, a hand-edited file, or a table deliberately left out — is
    // reported rather than silently ignored, because a silently-ignored table
    // is a table the owner thinks was restored and was not.
    $unknownTables = array_values(array_diff(array_keys($tables), BACKUP_TABLES));
    // Tables this backup does not contain at all: a restore KEEPS them as they
    // are. Named, so "kept" is something the owner reads rather than infers.
    $notInFile = [];
    foreach ($d['tables'] as $t => $x) if (!$x['in_file'] && $x['on_this_shop']) $notInFile[] = $t;

    store_out([
        'tables'          => $d['tables'],
        'unknown_tables'  => $unknownTables,
        'not_in_file'     => $notInFile,
        // In the file with rows, but not on this shop: a migration to run
        // first. backup_import refuses while this is non-empty.
        'missing_here'    => $d['missing_here'],
        'format'          => $data['format'] ?? null,
        'exported_at'     => $data['exported_at'] ?? null,
        // Echoed back so the panel can show it, and required back verbatim by
        // backup_import — see backup_token()'s own comment.
        'token'           => backup_token($data),
    ]);
}

if ($r === 'backup_import' && $method === 'POST') {
    $b = store_body();
    $data = is_array($b['data'] ?? null) ? $b['data'] : null;
    $tables = is_array($data['tables'] ?? null) ? $data['tables'] : null;
    if ($data === null || $tables === null) store_fail('bad_backup_file');

    // BOTH GATES, NOT EITHER. `confirm` alone would let a resent or replayed
    // request through; the token alone would let the panel skip showing the
    // preview and confirm blind. Together they mean: this exact file was
    // previewed (the token proves the bytes match what a preview computed
    // it over) AND a human pressed the second, separate button.
    if (($b['confirm'] ?? false) !== true) store_fail('confirm_required');
    if ((string) ($b['token'] ?? '') !== backup_token($data)) store_fail('stale_or_missing_preview');

    // Every row of the file is checked against the real schema before any
    // table is touched (backup_restore_check), then the tables it names are
    // replaced in one transaction.
    $result = backup_restore($db, $data);

    store_out(['ok' => true, 'restored_at' => gmdate('c'), 'tables' => $result]);
}

store_fail('not_found', 404);
