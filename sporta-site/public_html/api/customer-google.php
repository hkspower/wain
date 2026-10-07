<?php
/**
 * Sign a CUSTOMER in with Google — 2026-10-07. See the Google part of customer.php.
 *
 *   GET  /api/customer-google.php?return=/shop&remember=1   -> 302 to Google
 *   POST /api/customer-google.php  (id_token, state)        -> 303 back to the shop, signed in
 *
 * On any refusal it goes back to the page with ?signin=failed rather than showing an error page:
 * the shopper is mid-browse, and the sheet says what happened.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/security.php';
require __DIR__ . '/customer.php';

$db = store_db();
store_throttle($db, 'customer_google', 30, 600);

function cg_back(string $path, string $flag): void
{
    $sep = strpos($path, '?') === false ? '?' : '&';
    header('Cache-Control: no-store');
    header('Location: ' . $path . $sep . 'signin=' . $flag, true, 303);
    exit;
}

function cg_bind_cookie(string $v, int $life): void
{
    $https = store_is_https();
    setcookie($https ? '__Host-sporta_gstate' : 'sporta_gstate', $v, [
        'expires' => $life > 0 ? time() + $life : time() - 3600, 'path' => '/', 'secure' => $https,
        'httponly' => true, 'samesite' => $https ? 'None' : 'Lax',
    ]);
}

$client = customer_google_client($db);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $return = customer_return_path((string) ($_GET['return'] ?? '/'));
    if ($client === '' || (string) (store_config()['cron_key'] ?? '') === '') cg_back($return, 'failed');
    $nonce = sec_b64u(random_bytes(18));
    // BOUND TO THIS BROWSER. Without it, anyone could finish a Google sign-in with THEIR account and
    // post the result from their own page: the victim would be signed in as the attacker and type
    // their address into the attacker's account. The cookie holds a hash of this trip's nonce and
    // must come back with Google's post. SameSite=None because that post is cross-site (from
    // accounts.google.com) — Lax would not be sent. It lives ten minutes and is cleared on return.
    cg_bind_cookie(hash('sha256', 'cg|' . $nonce), 600);
    $q = http_build_query([
        'client_id'     => $client,
        'redirect_uri'  => sec_origin() . '/api/customer-google.php',
        'response_type' => 'id_token',
        'response_mode' => 'form_post',
        'scope'         => 'openid email profile',
        'nonce'         => $nonce,
        'state'         => customer_google_state($nonce, $return, ($_GET['remember'] ?? '1') !== '0', time()),
        'prompt'        => 'select_account',
    ]);
    header('Cache-Control: no-store');
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $q, true, 302);
    exit;
}

if ($method !== 'POST') store_fail('method_not_allowed', 405);

$state = customer_google_read_state((string) ($_POST['state'] ?? ''));
$bound = (string) ($_COOKIE[store_is_https() ? '__Host-sporta_gstate' : 'sporta_gstate'] ?? '');
cg_bind_cookie('', 0);
if ($state === null) cg_back('/', 'failed');
if ($bound === '' || !hash_equals(hash('sha256', 'cg|' . (string) ($state['n'] ?? '')), $bound)) cg_back(customer_return_path((string) ($state['r'] ?? '/')), 'failed');
$return = customer_return_path((string) ($state['r'] ?? '/'));
if ($client === '') cg_back($return, 'failed');

$claims = store_google_verify((string) ($_POST['id_token'] ?? ''), $client);
// The nonce ties the token to THIS trip: a token captured from another visit is refused here.
if ($claims === null || !hash_equals((string) ($state['n'] ?? ''), (string) ($claims['nonce'] ?? ''))) cg_back($return, 'failed');
$email = customer_email((string) $claims['email']);
if ($email === null) cg_back($return, 'failed');

customer_grant(customer_verified_account($db, $email, (string) ($claims['name'] ?? '')), !empty($state['m']));
cg_back($return, 'google');
