<?php
// Drains push_outbox onto the owner's phone. The third and last of this shop's
// outbox sweepers, and the same shape as the other two on purpose.
//
// Wire it in hPanel -> Advanced -> Cron Jobs, every minute:
//   wget -qO- "https://www.sporta.com.kw/api/cron-push.php?key=<cron_key>"
//
// EVERY MINUTE, not every five. The warehouse mail can wait — a picker reads it
// when they get to it. This is the alert that tells the owner an order exists,
// and an alert five minutes late is one the customer has already phoned about.
//
// Two deliveries, in order, and the second is not a duplicate of the first:
//
//   1. WEB PUSH to every registered device. This is the one that buzzes an
//      iPhone with the app closed.
//   2. n8n, as a FALLBACK, only when web push delivered to nobody — no device
//      registered, or every device failed. n8n can send a WhatsApp, an email,
//      a Telegram message; whatever the owner has wired up there is better
//      than an order nobody hears about.
//
// The fallback fires on "delivered to nobody", NOT on "something went wrong".
// If two phones are registered and one is dead, the owner has been told, and a
// second WhatsApp about the same order teaches them to ignore both.

declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/webpush.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], (string) ($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}
if (($cfg['vapid_public'] ?? '') === '' || ($cfg['vapid_private'] ?? '') === '') {
    // Fail BEFORE claiming, exactly as cron-fulfilment.php does: claiming rows
    // we cannot send burns their retry budget while the real problem is one
    // missing setting. store_queue_push() will not have written any either, so
    // this is only reachable if the keys were removed after the fact.
    // 503, NOT 500, and the difference is who gets woken up.
    //
    // 500 means this server broke. 503 means the service is not available — which
    // is what "the owner has not filled this in yet" actually is, and it is what
    // cron-voice.php already answered for exactly the same condition two files
    // away. A shop that has not finished its setup is not a shop that is
    // broken, but wget in an hPanel cron box — and any monitor watching for
    // 5xx — cannot tell those apart from a 500.
    store_out(['error' => 'vapid_public/vapid_private are not set in config.php'], 503);
}

$db = store_db();

// ---- claim ----
// FOR UPDATE SKIP LOCKED so two overlapping runs of a once-a-minute cron cannot
// send the same alert twice. Five attempts, then the row sits visibly with its
// error rather than retrying for ever.
$db->beginTransaction();
$rows = $db->query(
    'select id, order_id, kind, title, body, url from push_outbox
      where sent_at is null and attempts < 5
      order by created_at limit 20
        for update skip locked'
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn($r) => (int) $r['id'], $rows));
    $db->exec("update push_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

$subs = $db->query('select id, endpoint, p256dh, auth from push_subscriptions order by id')->fetchAll();

$vapid = [
    'public'  => (string) $cfg['vapid_public'],
    'private' => wp_b64_decode((string) $cfg['vapid_private']),
    'subject' => (string) ($cfg['vapid_subject'] ?: 'mailto:cs@sporta.com.kw'),
];
$vapidPoint = wp_b64_decode($vapid['public']);

$sent = 0; $failed = []; $fellBack = 0; $pruned = 0;

foreach ($rows as $row) {
    $payload = json_encode([
        'title' => $row['title'],
        'body'  => $row['body'],
        'url'   => $row['url'],
        // The tag collapses alerts for one order into one notification, so a
        // retry cannot leave two entries on the lock screen saying the same
        // thing. iOS honours this; so does Chrome.
        'tag'   => 'sporta-' . ($row['order_id'] === null ? $row['kind'] : 'order-' . $row['order_id']),
    ], JSON_UNESCAPED_UNICODE);

    $delivered = 0; $errors = [];
    foreach ($subs as $sub) {
        [$ok, $code, $err] = wp_send(
            ['endpoint' => $sub['endpoint'], 'p256dh' => $sub['p256dh'], 'auth' => $sub['auth']],
            $payload,
            ['public' => $vapidPoint, 'private' => $vapid['private'], 'subject' => $vapid['subject']],
            // TTL 12 hours. An order alert that surfaces two days later, when
            // the phone finally comes back online, is noise about something
            // already dealt with.
            43200
        );
        if ($ok) {
            $delivered++;
            $db->prepare('update push_subscriptions set last_ok_at = now(), last_error = null where id = ?')
               ->execute([(int) $sub['id']]);
            continue;
        }
        $errors[] = $code . ':' . $err;
        // 404/410 is the push service saying this subscription is GONE — a
        // deleted Home Screen icon, a reinstalled browser. It will answer 410
        // for ever, so a queue that keeps retrying it never drains and the
        // "last error" on every future alert is about a phone nobody owns.
        if ($code === 404 || $code === 410) {
            $db->prepare('delete from push_subscriptions where id = ?')->execute([(int) $sub['id']]);
            $pruned++;
        } else {
            $db->prepare('update push_subscriptions set last_error = ? where id = ?')
               ->execute([mb_substr((string) $err, 0, 300), (int) $sub['id']]);
        }
    }

    // ---- the fallback ----
    // Nobody got it. That is the case n8n exists for: the owner asked for both
    // precisely so that a phone left at home does not mean an unheard order.
    $note = null;
    if ($delivered === 0) {
        [$fbOk, $fbErr] = sporta_push_fallback($cfg, $row);
        if ($fbOk) { $fellBack++; $delivered = 1; $note = 'no device: sent via n8n'; }
        else       { $note = 'no device; n8n also failed: ' . $fbErr; }
    }

    $ok = $delivered > 0;
    if ($ok) $sent++; else $failed[] = (int) $row['id'];
    $db->prepare('update push_outbox set sent_at = ?, last_error = ? where id = ?')
       ->execute([
           $ok ? date('Y-m-d H:i:s') : null,
           $ok && $note === null ? null
               : mb_substr(trim(($note ?? '') . ' ' . implode(' | ', $errors)), 0, 500),
           (int) $row['id'],
       ]);
}

store_out(['claimed' => count($rows), 'devices' => count($subs), 'sent' => $sent,
           'fell_back_to_n8n' => $fellBack, 'pruned_dead_devices' => $pruned,
           'failed' => $failed]);

// ---------------------------------------------------------------------------

// The fallback POST. Deliberately the SAME signed shape as the assistant's
// hand-off — one workflow at the other end can tell them apart by `source` and
// verify both with one key, rather than the shop having two conventions for
// the same thing.
function sporta_push_fallback(array $cfg, array $row): array
{
    $url    = (string) ($cfg['n8n_webhook'] ?? '');
    $secret = (string) ($cfg['n8n_secret'] ?? '');
    if ($url === '') return [false, 'n8n_webhook is not set'];
    // NO SECRET, NO SEND — an empty key signs nothing, and the workflow at the
    // other end would then accept anyone holding the URL. Same rule, same
    // reason as assistant_handoff_send().
    if ($secret === '') return [false, 'n8n_secret is not set'];

    $payload = json_encode([
        'source'   => 'sporta-order-alert',
        'id'       => (int) $row['id'],
        'order_id' => $row['order_id'] === null ? null : (int) $row['order_id'],
        'kind'     => $row['kind'],
        'title'    => $row['title'],
        'body'     => $row['body'],
        'url'      => $row['url'],
        'reason'   => 'no push device was reachable',
        'at'       => gmdate('c'),
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        // Pinned, not inherited — see the note in pay/cbk.php.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Sporta-Signature: ' . hash_hmac('sha256', $payload, $secret),
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) return [false, 'curl: ' . ($err !== '' ? $err : 'failed')];
    if ($code < 200 || $code >= 300) return [false, "n8n answered $code"];
    return [true, null];
}
