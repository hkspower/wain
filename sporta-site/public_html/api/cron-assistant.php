<?php
// Drains assistant_outbox and posts each hand-off to n8n.
//
// Wire it in hPanel -> Advanced -> Cron Jobs, every 5 minutes:
//   wget -qO- "https://www.sporta.com.kw/api/cron-assistant.php?key=<cron_key>"
//
// WHY A CRON AND NOT THE REQUEST. سبورتا AI used to POST to n8n inline and
// ignore the answer, so a webhook that was down, slow or rate-limited lost the
// hand-off in silence — a customer told "a colleague will follow up" and no
// colleague told. This is the same shape as cron-fulfilment.php and for the
// same reason: the row is written while the customer is there, the network
// happens where a failure can be retried and seen.
//
// Claiming is FOR UPDATE SKIP LOCKED inside a transaction, so two overlapping
// runs of the schedule cannot send the same hand-off twice; a row that fails
// five times stops retrying and sits in the table with its error, where the
// admin screen shows it.

declare(strict_types=1);
require __DIR__ . '/store.php';
require_once __DIR__ . '/assistant.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], (string)($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}

// FAIL BEFORE CLAIMING. Claiming rows we cannot possibly deliver burns their
// retry budget — five runs later they are dead in the table and the real
// problem was one unset setting. Same guard as cron-fulfilment.php.
if (($cfg['n8n_webhook'] ?? '') === '') {
    // 503, NOT 500, and the difference is who gets woken up.
    //
    // 500 means this server broke. 503 means the service is not available — which
    // is what "the owner has not filled this in yet" actually is, and it is what
    // cron-voice.php already answered for exactly the same condition two files
    // away. A shop that has not finished its setup is not a shop that is
    // broken, but wget in an hPanel cron box — and any monitor watching for
    // 5xx — cannot tell those apart from a 500.
    store_out(['error' => 'n8n_webhook is not set in config.php — nothing would be delivered'], 503);
}
if (($cfg['n8n_secret'] ?? '') === '') {
    // Deliberately as fatal as a missing URL. Signing with an empty key is a
    // signature that proves nothing, and the workflow at the other end would
    // accept anything anyone who has seen the URL cared to send.
    store_out(['error' => 'n8n_secret is not set in config.php — the hand-off would be unauthenticated'], 503);
}

$db = store_db();

// ---- claim ----
$db->beginTransaction();
$rows = $db->query(
    'select id, intent, lang, message, reply, created_at from assistant_outbox
      where sent_at is null and attempts < 5
      order by created_at limit 20
        for update skip locked'
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn($r) => (int)$r['id'], $rows));
    $db->exec("update assistant_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

// ---- send ----
$sent = 0; $failed = [];
$mark = $db->prepare('update assistant_outbox set sent_at = ?, last_error = ? where id = ?');
foreach ($rows as $row) {
    [$ok, $err] = assistant_handoff_send($cfg, $row);
    $mark->execute([$ok ? date('Y-m-d H:i:s') : null, $err, (int)$row['id']]);
    $ok ? $sent++ : $failed[] = ['id' => (int)$row['id'], 'error' => $err];
}

// How many are stuck for good, so a green run does not hide a dead queue.
$dead = (int) $db->query(
    'select count(*) from assistant_outbox where sent_at is null and attempts >= 5'
)->fetchColumn();

store_out(['claimed' => count($rows), 'sent' => $sent, 'failed' => $failed, 'gave_up' => $dead]);
