<?php
// Drains whatsapp_outbox and sends each message through the WhatsApp Cloud API.
// The customer-facing twin of cron-fulfilment.php.
//
// Wire it in hPanel -> Advanced -> Cron Jobs, every 5 minutes:
//   wget -qO- "https://www.sporta.com.kw/api/cron-whatsapp.php?key=<cron_key>"
//
// It is HTTP-gated rather than run from a shell because THERE IS NO SHELL on
// this account — SSH is off permanently, and a cron that needs one is a cron
// that never runs. Same gate as cron-fulfilment.php and cron-voice.php.
//
// Safe under overlapping runs: the claim marks attempts inside a transaction
// with FOR UPDATE SKIP LOCKED, so two runs racing cannot double-send, and a
// message that fails five times stops retrying and sits visibly in the table
// with its error.
//
// ---------------------------------------------------------------------------
// WHY EVERY MESSAGE IS A TEMPLATE
//
// The Cloud API only lets a business send freeform text inside a 24-hour
// window that OPENS WHEN THE CUSTOMER MESSAGES YOU. A shopper who has just
// paid has not messaged anybody, so that window is shut and always will be:
// every message this file sends is business-initiated, and business-initiated
// means a template Meta approved in advance.
//
// That is not a detail to discover in production. A freeform send outside the
// window does not bounce loudly — it returns an error the shop would only see
// in last_error, while the customer waits for a confirmation that is never
// coming. So the template name is required configuration, and a missing one
// stops the queue rather than sending something that cannot arrive.
//
// Templates are created in Meta Business Manager, not here. Each needs an
// Arabic and an English version registered under the SAME name — the Cloud API
// picks the language at send time from the `language.code` this file passes,
// and the shop stores which one the customer was reading.

declare(strict_types=1);
require __DIR__ . '/store.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], (string)($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}

// Fail loudly BEFORE claiming. Claiming rows we cannot possibly send burns
// their retry budget — five attempts, gone — while the real problem is one
// missing setting that nobody has looked at yet.
$token   = (string)($cfg['whatsapp_token'] ?? '');
$phoneId = (string)($cfg['whatsapp_phone_number_id'] ?? '');
if ($token === '' || $phoneId === '') {
    store_out(['error' => 'whatsapp_token / whatsapp_phone_number_id are not set in config.php — nothing would be delivered'], 500);
}

$db = store_db();

// ---- claim ----
$db->beginTransaction();
$rows = $db->query(
    'select id, kind, to_e164, template, lang, payload from whatsapp_outbox
      where sent_at is null and attempts < 5
      order by created_at limit 20
        for update skip locked'
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn ($r) => (int)$r['id'], $rows));
    $db->exec("update whatsapp_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

// ---- send ----
$sent = 0; $failed = [];
foreach ($rows as $row) {
    [$ok, $messageId, $error] = sporta_wa_send($cfg, $row);
    $db->prepare('update whatsapp_outbox set sent_at = ?, wa_message_id = ?, last_error = ? where id = ?')
       ->execute([
           $ok ? date('Y-m-d H:i:s') : null,
           $messageId,
           $ok ? null : mb_substr((string)$error, 0, 500),
           (int)$row['id'],
       ]);
    $ok ? $sent++ : $failed[] = (int)$row['id'];
}

store_out(['claimed' => count($rows), 'sent' => $sent, 'failed' => $failed]);

// ---------------------------------------------------------------------------
// One template message. Returns [ok, message_id, error].
function sporta_wa_send(array $cfg, array $row): array {
    $base = rtrim((string)($cfg['whatsapp_api_base'] ?? 'https://graph.facebook.com/v21.0'), '/');
    $url  = $base . '/' . rawurlencode((string)$cfg['whatsapp_phone_number_id']) . '/messages';

    $p = json_decode((string)$row['payload'], true) ?: [];
    // The template's {{1}}, {{2}}, {{3}} — POSITIONAL, so the order here is the
    // order they must be declared in Meta's console. Documented in
    // WHATSAPP.md; getting it wrong silently swaps the name and the order
    // number in every message.
    $vars = [
        (string)($p['name'] ?? ''),
        (string)($p['track_id'] ?? ''),
        (string)($p['amount'] ?? ''),
    ];

    $body = [
        'messaging_product' => 'whatsapp',
        'to'   => (string)$row['to_e164'],
        'type' => 'template',
        'template' => [
            'name'     => (string)$row['template'],
            'language' => ['code' => (string)$row['lang']],
            'components' => [[
                'type' => 'body',
                'parameters' => array_map(fn ($v) => ['type' => 'text', 'text' => $v], $vars),
            ]],
        ],
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $cfg['whatsapp_token'],
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
    ]);
    $res  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $cErr = curl_error($ch);
    curl_close($ch);

    if ($res === false) return [false, null, 'curl: ' . $cErr];
    $j = json_decode((string)$res, true);

    if ($code >= 200 && $code < 300 && isset($j['messages'][0]['id'])) {
        return [true, (string)$j['messages'][0]['id'], null];
    }

    // Meta's errors are structured and worth keeping whole-ish: the difference
    // between "template does not exist", "template not approved for this
    // language" and "number not on WhatsApp" is the difference between three
    // completely different fixes, and last_error is the only place anyone will
    // see it. The TOKEN is never echoed into it.
    $msg = $j['error']['message'] ?? ('HTTP ' . $code);
    $sub = $j['error']['error_data']['details'] ?? '';
    return [false, null, trim($msg . ($sub ? ' — ' . $sub : ''))];
}
