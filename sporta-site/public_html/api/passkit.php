<?php
// Sporta — Apple's PassKit web service, so a saved loyalty card updates itself (2026-10-03).
//
// Wallet calls this on its own; no page does. The card carries webServiceURL (this file) and an
// authenticationToken, and Wallet appends one of these paths, which arrive here as PATH_INFO:
//
//   POST   /v1/devices/<device>/registrations/<passType>/<serial>   the card was added to a phone
//   DELETE /v1/devices/<device>/registrations/<passType>/<serial>   ...and removed
//   GET    /v1/devices/<device>/registrations/<passType>?passesUpdatedSince=<tag>
//                                                                   which of my cards changed?
//   GET    /v1/passes/<passType>/<serial>                           the newest copy of one card
//   POST   /v1/log                                                  Wallet's own error reports
//
// THE FLOW: an order is paid -> store_wallet_touch() bumps that customer's card and sends an empty
// push through Apple -> the phone asks which cards changed -> fetches this card -> shows "Your
// balance is now N points". Nothing is pushed to a phone that never registered.
//
// THE TOKEN IS THE CREDENTIAL. Every route but /log needs "Authorization: ApplePass <token>" and
// the token must be that serial's own, compared in constant time. A wrong one is 401, the same for
// an unknown serial, so the route cannot be used to find out which serials exist.
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/wallet-setup.php';
require __DIR__ . '/wallet-pass.php';

$db = store_db();
store_throttle($db, 'passkit', 120, 60);

$path = (string) ($_SERVER['PATH_INFO'] ?? '');
if ($path === '') {
    // Some servers hand the whole URI over instead; take what follows the script's own name.
    $uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    $at = strpos($uri, '/passkit.php');
    $path = $at === false ? '' : substr($uri, $at + strlen('/passkit.php'));
}
$parts = array_values(array_filter(explode('/', $path), 'strlen'));
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function pk_out(int $code, ?array $body = null): void {
    http_response_code($code);
    header('Cache-Control: no-store');
    if ($body !== null) { header('Content-Type: application/json'); echo json_encode($body, JSON_UNESCAPED_SLASHES); }
    exit;
}

/** The serial's own row when the request carries its token; otherwise a 401 and nothing more. */
function pk_auth(PDO $db, string $serial): array {
    $h = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if ($h === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, 'Authorization') === 0) $h = (string) $v;
    }
    $given = preg_match('/^ApplePass\s+(\S+)$/', trim($h), $m) ? $m[1] : '';
    $q = $db->prepare("select *, unix_timestamp(updated_at) ts from wallet_passes where serial = ? and kind = 'loyalty' limit 1");
    $q->execute([$serial]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    $want = (string) ($row['auth_token'] ?? '');
    if (!$row || $want === '' || $given === '' || !hash_equals($want, $given)) pk_out(401);
    return $row;
}

$ok = fn (string $s) => preg_match('/^[A-Za-z0-9._-]{1,64}$/', $s) === 1;

// POST /v1/log — Wallet reporting a problem with this service. Kept short and to the PHP log.
if ($method === 'POST' && $parts === ['v1', 'log']) {
    $in = json_decode((string) file_get_contents('php://input', false, null, 0, 8192), true);
    foreach (array_slice((array) ($in['logs'] ?? []), 0, 10) as $line) error_log('passkit: ' . substr((string) $line, 0, 300));
    pk_out(200);
}

// /v1/devices/<device>/registrations/<passType>[/<serial>]
if (count($parts) >= 5 && $parts[0] === 'v1' && $parts[1] === 'devices' && $parts[3] === 'registrations') {
    [, , $device, , $type] = $parts;
    $serial = $parts[5] ?? null;
    if (!$ok($device) || $type !== WALLET_PASS_TYPE_ID || ($serial !== null && !$ok($serial))) pk_out(404);

    if ($serial !== null && $method === 'POST') {
        pk_auth($db, $serial);
        $in = json_decode((string) file_get_contents('php://input', false, null, 0, 4096), true);
        $push = (string) ($in['pushToken'] ?? '');
        if (!preg_match('/^[A-Fa-f0-9]{32,200}$/', $push)) pk_out(400);
        $had = $db->prepare('select 1 from wallet_registrations where device_id = ? and serial = ?');
        $had->execute([$device, $serial]);
        $db->prepare('insert into wallet_registrations (device_id, serial, push_token) values (?, ?, ?)
                      on duplicate key update push_token = values(push_token)')
           ->execute([$device, $serial, $push]);
        pk_out($had->fetchColumn() ? 200 : 201);
    }
    if ($serial !== null && $method === 'DELETE') {
        pk_auth($db, $serial);
        $db->prepare('delete from wallet_registrations where device_id = ? and serial = ?')->execute([$device, $serial]);
        pk_out(200);
    }
    if ($serial === null && $method === 'GET') {
        // No token on this one by Apple's design: the device id is the secret, and the answer is only
        // serial numbers, never a card.
        $since = (string) ($_GET['passesUpdatedSince'] ?? '');
        $sql = 'select p.serial, unix_timestamp(p.updated_at) t from wallet_registrations r
                join wallet_passes p on p.serial = r.serial where r.device_id = ?';
        $args = [$device];
        if (ctype_digit($since)) { $sql .= ' and unix_timestamp(p.updated_at) > ?'; $args[] = (int) $since; }
        $q = $db->prepare($sql);
        $q->execute($args);
        $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) pk_out(204);
        pk_out(200, ['serialNumbers' => array_column($rows, 'serial'), 'lastUpdated' => (string) max(array_map('intval', array_column($rows, 't')))]);
    }
    pk_out(405);
}

// GET /v1/passes/<passType>/<serial> — the newest copy of the card.
if ($method === 'GET' && count($parts) === 4 && $parts[0] === 'v1' && $parts[1] === 'passes') {
    [, , $type, $serial] = $parts;
    if ($type !== WALLET_PASS_TYPE_ID || !$ok($serial)) pk_out(404);
    $row = pk_auth($db, $serial);
    $stamp = (int) $row['ts'];
    $ims = strtotime((string) ($_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '')) ?: 0;
    if ($ims && $stamp <= $ims) pk_out(304);
    $cfg = store_config();
    $certDir = wallet_cert_dir($cfg);
    $teamId = wallet_team_id($cfg, $certDir);
    if ($teamId === '') pk_out(503);
    $pass = wallet_loyalty_pass($db, $teamId, $row);
    $db->prepare('update wallet_passes set points_at_issue = ?, updated_at = updated_at where serial = ?')
       ->execute([(int) $pass['storeCard']['headerFields'][0]['value'], $serial]);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $stamp) . ' GMT');
    wallet_send(wallet_build($pass, $certDir), 'sporta-loyalty.pkpass');
}

pk_out(404);
