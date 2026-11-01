<?php
// /api/birthday.php — the signed-in customer's birthday.
//   GET  ?r=get   → {birthday: "YYYY-MM-DD"|null, gift: {percent, days}|null}
//   POST ?r=set   {"birthday": "YYYY-MM-DD" | ""}   ("" clears it)
// Same guards as customer.php: X-Sporta-Customer header + JSON body + no
// cross-site POST, so a third-party page cannot set it for a signed-in shopper.
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/customer-auth.php';
require __DIR__ . '/birthday-lib.php';
header('Cache-Control: no-store, private');
header('Referrer-Policy: no-referrer');

$route = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
if (!in_array($route, ['get', 'set'], true)) store_fail('not_found', 404);
if (($route === 'get' && $method !== 'GET') || ($route === 'set' && $method !== 'POST')) store_fail('method_not_allowed', 405);
if ($method === 'POST') {
    if (($_SERVER['HTTP_X_SPORTA_CUSTOMER'] ?? '') !== '1' ||
        strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json' ||
        ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 1024) store_fail('request_too_large', 413);
}

$db = store_db();
store_throttle($db, 'customer_birthday_' . $route, ...($route === 'get' ? [120, 60] : [20, 900]));
if (!birthday_columns_ready($db)) store_fail('birthday_not_ready', 503);

$user = customer_current_user($db);
if ($user === null) store_fail('not_authenticated', 401);
$id = (int)$user['id'];
$settings = birthday_settings($db);
$gift = $settings['enabled'] ? ['percent' => $settings['percent'], 'days' => $settings['days']] : null;

if ($route === 'get') {
    $q = $db->prepare('select birthday from customer_accounts where id = ?');
    $q->execute([$id]);
    $b = $q->fetchColumn();
    store_out(['birthday' => is_string($b) && $b !== '' ? substr($b, 0, 10) : null, 'gift' => $gift]);
}

$raw = file_get_contents('php://input', false, null, 0, 1025);
$body = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($body) || !array_key_exists('birthday', $body)) store_fail('bad_request');
[$value, $error] = birthday_parse($body['birthday']);
if ($error !== null) store_fail($error);
// Re-setting the same date keeps its clock; a new date restarts the 30 days.
$db->prepare('update customer_accounts
    set birthday_set_at = case when birthday <=> ? then birthday_set_at when ? is null then null else now() end,
        birthday = ?
    where id = ?')->execute([$value, $value, $value, $id]);
store_out(['birthday' => $value, 'gift' => $gift]);
