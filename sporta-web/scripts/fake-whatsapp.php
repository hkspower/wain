<?php
// A fake WhatsApp Cloud API, for whatsapp-test.mjs.
//
// It speaks the shape the real Graph endpoint speaks — bearer auth, the
// /{phone-number-id}/messages path, a template payload in, a message id out —
// so cron-whatsapp.php can be tested against something that refuses the same
// things Meta refuses, rather than against a mock that agrees with everything.
//
// Refusals it reproduces, because each is a different real fix:
//   401  the token is wrong or expired
//   404  the phone number id does not exist
//   132001 template does not exist in this language  (Meta's own error code)
//   131026 the number is not on WhatsApp
//
// Every request is appended to the log so the test can assert what was
// actually sent — the language, the template name, and the positional
// variables in order.

declare(strict_types=1);

$LOG = getenv('FAKE_WA_LOG') ?: sys_get_temp_dir() . '/fake-wa.log';
$GOOD_TOKEN = getenv('FAKE_WA_TOKEN') ?: 'test-wa-token';
$GOOD_PHONE_ID = getenv('FAKE_WA_PHONE_ID') ?: '111222333';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$raw  = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true) ?: [];

header('Content-Type: application/json');

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if ($auth !== 'Bearer ' . $GOOD_TOKEN) {
    http_response_code(401);
    echo json_encode(['error' => ['message' => 'Invalid OAuth access token.', 'code' => 190]]);
    exit;
}

if (!preg_match('#/([^/]+)/messages$#', $path, $m)) {
    http_response_code(404);
    echo json_encode(['error' => ['message' => 'Unsupported path', 'code' => 803]]);
    exit;
}
if ($m[1] !== $GOOD_PHONE_ID) {
    http_response_code(404);
    echo json_encode(['error' => ['message' => 'Unsupported get request. Object with ID does not exist', 'code' => 803]]);
    exit;
}

file_put_contents($LOG, json_encode($body, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);

$tpl  = $body['template']['name'] ?? '';
$lang = $body['template']['language']['code'] ?? '';
$to   = (string)($body['to'] ?? '');

// A template that was never registered.
if ($tpl === 'no_such_template') {
    http_response_code(400);
    echo json_encode(['error' => [
        'message' => 'Template name does not exist in the translation',
        'code' => 132001,
        'error_data' => ['details' => "template name ($tpl) does not exist in $lang"],
    ]]);
    exit;
}
// Registered, but not in the language asked for — the trap when only the
// English version was approved.
if ($lang === 'ar' && $tpl === 'english_only_template') {
    http_response_code(400);
    echo json_encode(['error' => [
        'message' => 'Template name does not exist in the translation',
        'code' => 132001,
        'error_data' => ['details' => "template name ($tpl) does not exist in ar"],
    ]]);
    exit;
}
// A number with no WhatsApp account.
if (str_ends_with($to, '00000000')) {
    http_response_code(400);
    echo json_encode(['error' => [
        'message' => 'Receiver is incapable of receiving this message',
        'code' => 131026,
        'error_data' => ['details' => 'Receiver is not a WhatsApp user'],
    ]]);
    exit;
}

echo json_encode([
    'messaging_product' => 'whatsapp',
    'contacts' => [['input' => $to, 'wa_id' => $to]],
    'messages' => [['id' => 'wamid.TEST' . substr(hash('sha256', $raw), 0, 20)]],
]);
