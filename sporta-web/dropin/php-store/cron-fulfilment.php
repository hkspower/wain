<?php
// Drains fulfilment_outbox and emails the logistics company. The native twin
// of the notify-warehouse Edge Function.
//
// On the VPS, run with PHP CLI and --run from a host scheduler every 5 minutes.
// Shared-hosting HTTP schedules can still use the configured cron_key.
//
// One run holds a MariaDB advisory lock through the external send. Row locks
// alone are insufficient: after the claim transaction commits, another cron
// could otherwise claim the still-unsent row before the first email finishes.
// A message that fails five times stops retrying and remains visible.
//
// The email follows the same rules as render.mjs, because the reader is the
// same picker on the same warehouse floor: the SUBJECT carries the whole
// answer (order number, ship-or-hold, item count, area); COLLECT CASH is the
// loudest thing on the page with the amount beside it; sizes sit in their own
// column; Arabic and English together; plain text alongside HTML.

declare(strict_types=1);
require __DIR__ . '/store.php';
require_once __DIR__ . '/cron-auth.php';

$cfg = store_config();
if (!sporta_cron_authorized($cfg, PHP_SAPI, $_GET, $GLOBALS['argv'] ?? [], ['--run'])) {
    store_fail('forbidden', 403);
}
if (($cfg['warehouse_email'] ?? '') === '') {
    // Fail loudly BEFORE claiming — claiming rows we cannot send burns their
    // retry budget while the real problem is one missing setting.
    store_out(['error' => 'warehouse_email is not set in config.php — nothing would be delivered'], 500);
}

$db = store_db();

// Keep the lock on this PDO connection until after every send result is saved.
// MariaDB releases it automatically if PHP exits unexpectedly.
$lockName = 'sporta_fulfilment_outbox_cron';
$lock = $db->prepare('select get_lock(?, 0)');
$lock->execute([$lockName]);
$acquired = $lock->fetchColumn();
if ((string)$acquired === '0') store_out(['claimed' => 0, 'sent' => 0, 'failed' => [], 'busy' => true]);
if ((string)$acquired !== '1') store_fail('queue_lock_unavailable', 503);

// ---- what the warehouse is told, and only what is still true ----
//
// Every message here is decided TWICE, and the second decision is the one that
// counts. The first is a batch pass that closes what can no longer go; the
// second happens for each row immediately before it is mailed, under the
// order's row lock, and the mail is sent while that lock is held. So a
// decision the shop makes while this run is in progress — an admin cancel, a
// reinstate, a delivery — is seen by the next message for that order, and a
// message that is already on its way cannot be overtaken by one of the shop's
// decisions. (Before this, a row was claimed and committed, and then mailed
// without anyone looking at the order again: a reinstate that landed during
// the run was overwritten, and the warehouse was told not to ship a live order.)
//
// The rules themselves are in store_outbox_closed_reason() (store.php), one
// place for both passes. A row closed that way is marked sent with last_error
// saying why it never went: 'order cancelled', 'order shipped'. In short: a
// cancelled order's picking list and reinstate are never mailed; its payment
// and cancel are mailed only if the warehouse already holds a picking list for
// it; and an order that has shipped or been delivered gets no dispatch message.
//
// LOCK ORDER. Every writer of an order's warehouse rows takes the order's row
// lock first (the admin route, the sweeper, the callbacks), and this drain
// does the same, so the two cannot wait on each other in opposite orders.
//
// Under the advisory lock above, so a second cron cannot claim these first.

// Pass 1: every order that has an unsent row which may now be closed.
$candidates = $db->query(
    "select distinct f.order_id from fulfilment_outbox f
       join orders o on o.id = f.order_id
      where f.sent_at is null and f.attempts < 5
        and o.fulfilment_status in ('cancelled', 'shipped', 'delivered')
      order by f.order_id limit 500"
)->fetchAll(PDO::FETCH_COLUMN);
$suppressed = 0;
foreach ($candidates as $orderId) {
    $suppressed += sporta_close_unsent($db, (int)$orderId);
}

// ---- claim ----
//
// ORDER OF SENDING. A picking list must go before the "do not ship" that
// follows it for the same order. created_at is only whole seconds, so two
// rows queued in one second tie on it; the id tie-break is the order the
// shop queued them in, and the picking list is always queued first (it is
// written with the order, the cancel later).
$db->beginTransaction();
$rows = $db->query(
    'select id, order_id, kind, payload, attempts from fulfilment_outbox
      where sent_at is null and attempts < 5
      order by created_at, id limit 20
        for update skip locked'
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn($r) => (int)$r['id'], $rows));
    $db->exec("update fulfilment_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

// Pass 2: each claimed row is decided and, if it may go, mailed, under its
// order's lock (sporta_send_row). A row the shop overtook is closed, not mailed.
$sent = 0; $failed = [];
foreach ($rows as $row) {
    $outcome = sporta_send_row($db, $cfg, $row, (int)$row['attempts'] + 1);
    if ($outcome === 'sent') $sent++;
    elseif ($outcome === 'failed') $failed[] = (int)$row['id'];
    elseif ($outcome === 'closed') $suppressed++;
}

$unlock = $db->prepare('select release_lock(?)');
$unlock->execute([$lockName]);

store_out(['claimed' => count($rows), 'sent' => $sent, 'failed' => $failed,
           'suppressed' => $suppressed]);

// ---------------------------------------------------------------------------

// The order's fulfilment status, read under its row lock. Null when the order
// is gone (its rows go with it, by the foreign key).
function sporta_lock_order(PDO $db, int $orderId): ?string {
    $q = $db->prepare('select fulfilment_status from orders where id = ? for update');
    $q->execute([$orderId]);
    $status = $q->fetchColumn();
    return $status === false ? null : (string)$status;
}

// Pass 1 for one order: close every unsent row that must not go. One
// transaction under the order's lock, so no shop decision lands between the
// reading of the status and the closing of the rows. Returns how many closed.
function sporta_close_unsent(PDO $db, int $orderId): int {
    $db->beginTransaction();
    try {
        $status = sporta_lock_order($db, $orderId);
        $closed = 0;
        if ($status !== null) {
            $q = $db->prepare('select id, kind from fulfilment_outbox
                                where order_id = ? and sent_at is null and attempts < 5 for update');
            $q->execute([$orderId]);
            foreach ($q->fetchAll() as $r) {
                $why = store_outbox_closed_reason((string)$r['kind'], $status, store_outbox_heard($db, $orderId));
                if ($why === null) continue;
                $db->prepare('update fulfilment_outbox set sent_at = now(), last_error = ? where id = ?')
                   ->execute([$why, (int)$r['id']]);
                $closed++;
            }
        }
        $db->commit();
        return $closed;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// Pass 2 for one claimed row. The decision and the mail happen in ONE
// transaction under the order's lock, and the lock is held through the mail:
// an admin cancel or reinstate of this order waits for the send to finish and
// then sees the row as sent, so its do-not-ship or its REINSTATED list is
// decided on what the warehouse really holds. A mail is one sendmail call, so
// the wait is short.
//
// Returns 'sent', 'failed' (mail refused; the row stays unsent and is retried
// until its fifth attempt), 'closed' (the shop overtook it; nothing mailed) or
// 'skipped' (the order is gone, or the row was already settled).
//
// A row that fails its fifth attempt is reported to the owner on the Activity
// page: from then on it is never retried by the drain, so nothing else would
// say that the warehouse was never told.
function sporta_send_row(PDO $db, array $cfg, array $row, int $attempts): string {
    $orderId = (int)$row['order_id'];
    $db->beginTransaction();
    try {
        $status = sporta_lock_order($db, $orderId);
        $cur = $db->prepare('select sent_at from fulfilment_outbox where id = ? for update');
        $cur->execute([(int)$row['id']]);
        $state = $cur->fetch(PDO::FETCH_ASSOC);
        if ($status === null || !$state || $state['sent_at'] !== null) {
            $db->commit();
            return 'skipped';
        }
        $why = store_outbox_closed_reason((string)$row['kind'], $status, store_outbox_heard($db, $orderId));
        if ($why !== null) {
            $db->prepare('update fulfilment_outbox set sent_at = now(), last_error = ? where id = ?')
               ->execute([$why, (int)$row['id']]);
            $db->commit();
            return 'closed';
        }
        $p = json_decode($row['payload'], true) ?: [];
        [$subject, $text, $html] = sporta_render_warehouse((string)$row['kind'], $p);
        $ok = sporta_send_mail($cfg, $subject, $text, $html);
        $db->prepare('update fulfilment_outbox set sent_at = ?, last_error = ? where id = ?')
           ->execute([$ok ? date('Y-m-d H:i:s') : null, $ok ? null : 'mail() returned false', (int)$row['id']]);
        if (!$ok && $attempts >= 5) store_system_event($db, 'warehouse_mail_failed');
        $db->commit();
        return $ok ? 'sent' : 'failed';
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// ---------------------------------------------------------------------------

function sporta_render_warehouse(string $kind, array $p): array {
    $track = (string)($p['track_id'] ?? '?');
    $amount = 'KWD ' . number_format((float)($p['amount_kwd'] ?? 0), 3, '.', '');
    $items = $p['items'] ?? [];
    $count = array_sum(array_map(fn($i) => (int)($i['qty'] ?? 0), $items));
    $area = $p['address']['area'] ?? '';
    $cash = !empty($p['collect_cash']);
    $paid = ($p['payment_status'] ?? '') === 'paid';

    if ($kind === 'payment') {
        $subject = $paid
            ? "[SPORTA] {$track} · PAYMENT CONFIRMED — ship it"
            : "[SPORTA] {$track} · PAYMENT FAILED — do not ship";
        $line = $paid ? 'Payment confirmed. This order can be shipped.'
                      : 'Payment FAILED or was abandoned. Do NOT ship this order.';
        $lineAr = $paid ? 'تم تأكيد الدفع. يمكن شحن هذا الطلب.'
                        : 'فشل الدفع أو تم التخلي عنه. لا تشحن هذا الطلب.';
        $text = "{$subject}\n\n{$line}\n{$lineAr}\n\nOrder: {$track}\nTotal: {$amount}\n";
        $html = '<div style="font-family:sans-serif"><div style="background:' . ($paid ? '#14532d' : '#7f1d1d')
              . ';color:#fff;padding:16px;border-radius:10px"><b>' . htmlspecialchars("{$track} — {$line}")
              . '</b><div dir="rtl">' . htmlspecialchars($lineAr) . '</div></div></div>';
        return [$subject, $text, $html];
    }

    // THE ORDER WAS CANCELLED after the warehouse heard about it — by the
    // owner in /backends, or by the sweeper for a cash order nobody confirmed
    // within cod_hold_hours. The picking list for a cash order said COLLECT
    // CASH, which means ship; this is the message that takes that back. Red,
    // like a failed payment, and the subject carries the whole answer.
    if ($kind === 'cancel') {
        $subject = "[SPORTA] {$track} · CANCELLED — do not ship";
        $line = 'This order has been CANCELLED. Do NOT ship it. If it has already left, contact the shop.';
        $lineAr = 'تم إلغاء هذا الطلب. لا تشحنه. إذا كان قد خرج للتوصيل فتواصل مع المتجر.';
        $text = "{$subject}\n\n{$line}\n{$lineAr}\n\nOrder: {$track}\nTotal: {$amount}\n";
        $html = '<div style="font-family:sans-serif"><div style="background:#7f1d1d;color:#fff;padding:16px;border-radius:10px"><b>'
              . htmlspecialchars("{$track} — {$line}") . '</b><div dir="rtl">' . htmlspecialchars($lineAr)
              . '</div></div></div>';
        return [$subject, $text, $html];
    }

    // 'reinstate': the owner put a cancelled order back after a "do not ship"
    // had really gone out. The full picking list again, saying so first.
    $again = $kind === 'reinstate' ? 'REINSTATED — ignore the cancellation · ' : '';
    $state = $cash ? 'COLLECT CASH' : ($paid ? 'PAID' : 'AWAITING PAYMENT — hold');
    $subject = "[SPORTA] {$track} · {$again}{$state} · {$count} item(s)" . ($area ? " · {$area}" : '');
    $banner = $again . ($cash ? "COLLECT {$amount} IN CASH ON DELIVERY"
            : ($paid ? 'PAID — ready to ship' : 'AWAITING PAYMENT — do not ship yet'));

    $a = $p['address'] ?? [];
    $addr = implode(', ', array_filter([
        ($a['block'] ?? '') !== '' ? 'Block ' . $a['block'] : null,
        ($a['street'] ?? '') !== '' ? 'Street ' . $a['street'] : null,
        ($a['building'] ?? '') !== '' ? 'Building ' . $a['building'] : null,
        ($a['floor'] ?? null) ? 'Floor ' . $a['floor'] : null,
        ($a['flat'] ?? null) ? 'Flat ' . $a['flat'] : null,
    ])) . ' — ' . implode(', ', array_filter([$a['area'] ?? null, $a['governorate'] ?? null]));

    $textItems = ''; $htmlItems = '';
    foreach ($items as $i) {
        $opts = implode(' · ', array_filter([(string)($i['size'] ?? ''), (string)($i['fit'] ?? '')]));
        $textItems .= "  {$i['qty']} x  {$i['name_en']}" . ($opts ? "  [{$opts}]" : '') . "\n        {$i['sku']}\n";
        $htmlItems .= '<tr><td style="padding:6px;border-bottom:1px solid #eee;text-align:center;font-weight:700">'
            . (int)$i['qty'] . '</td><td style="padding:6px;border-bottom:1px solid #eee">'
            . htmlspecialchars((string)$i['name_en']) . '<br><span dir="rtl" style="color:#555">'
            . htmlspecialchars((string)$i['name_ar']) . '</span></td><td style="padding:6px;border-bottom:1px solid #eee;font-weight:700">'
            . htmlspecialchars($opts ?: '—') . '</td></tr>';
    }

    $c = $p['customer'] ?? [];
    $note = (string)($a['note'] ?? '');
    $text = "{$subject}\n\n{$banner}\n\nORDER      {$track}\nPAYMENT    " . ($p['payment_method'] ?? '')
          . " — " . ($p['payment_status'] ?? '') . "\nTOTAL      {$amount}\n\nDELIVER TO\n  "
          . ($c['name'] ?? '') . "\n  +" . ($c['phone'] ?? '') . "\n  {$addr}\n"
          . ($note !== '' ? "  Note: {$note}\n" : '') . "\nPACK\n{$textItems}";

    $html = '<div style="font-family:sans-serif;max-width:640px">'
        . '<div style="background:' . ($cash ? '#7c2d12' : ($paid ? '#14532d' : '#7f1d1d'))
        . ';color:#fff;padding:16px;border-radius:10px;font-size:18px;font-weight:800">'
        . htmlspecialchars($banner) . '</div>'
        . '<p><b>' . htmlspecialchars((string)($c['name'] ?? '')) . '</b><br>+'
        . htmlspecialchars((string)($c['phone'] ?? '')) . '<br>' . htmlspecialchars($addr)
        . ($note !== '' ? '<br><b>Note:</b> ' . htmlspecialchars($note) : '') . '</p>'
        . '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">'
        . '<tr style="background:#f1f5f9"><th style="padding:6px">Qty</th><th style="padding:6px;text-align:left">Item</th>'
        . '<th style="padding:6px;text-align:left">Size / Fit</th></tr>' . $htmlItems . '</table>'
        . '<p style="color:#666;font-size:12px">' . htmlspecialchars("{$track} · {$amount}") . '</p></div>';

    return [$subject, $text, $html];
}

function sporta_send_mail(array $cfg, string $subject, string $text, string $html): bool {
    // DMARC checks the visible From domain against SPF and/or DKIM.  Keep the
    // SMTP envelope sender on the same sporta.com.kw address so Hostinger's SPF
    // result is aligned as well as the header From address.  Reject control
    // characters here because these values come from a server config file and
    // are inserted into mail headers.
    $from = trim((string)($cfg['mail_from'] ?? ''));
    $replyTo = trim((string)($cfg['mail_reply_to'] ?? ''));
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)
        || !filter_var($replyTo, FILTER_VALIDATE_EMAIL)
        || !preg_match('/@(?:www\.)?sporta\.com\.kw$/i', $from)
        || preg_match('/[\r\n]/', $from . $replyTo)) {
        return false;
    }
    $boundary = 'sp' . bin2hex(random_bytes(12));
    $headers = implode("\r\n", [
        'From: Sporta Orders <' . $from . '>',
        'Reply-To: ' . $replyTo,
        'MIME-Version: 1.0',
        "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
    ]);
    // Plain text FIRST, HTML second — the order multipart/alternative expects,
    // and warehouse mail clients are exactly where the text part gets read.
    $body = "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$text}\r\n"
          . "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{$html}\r\n--{$boundary}--";
    // =?UTF-8?B?...?= so the Arabic in a subject survives every relay.
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    return mail($cfg['warehouse_email'], $encSubject, $body, $headers, '-f' . $from);
}
