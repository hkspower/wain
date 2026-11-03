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
//
// A message that fails five times leaves the every-run retry and is reported on
// the Activity page by kind and order number. It is NOT abandoned: in the first
// `warehouse_retry_window_minutes` of each hour (default 10, 0 switches it off)
// a failed row is tried again, up to 24 attempts in all, and the last failure
// is reported once more. A mail outage of half an hour used to strand every
// picking list and do-not-ship queued inside it for good.
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
// order's row lock. So a decision the shop makes while this run is in progress
// — an admin cancel, a reinstate, a delivery — is seen by the next message for
// that order. (Before this, a row was claimed and committed, and then mailed
// without anyone looking at the order again: a reinstate that landed during
// the run was overwritten, and the warehouse was told not to ship a live order.)
//
// THE MAIL IS SENT WITHOUT THE ORDER'S ROW LOCK. An earlier version kept the
// lock through mail() so that no decision could overtake a message already on
// its way. But a bank callback (KNET, T-Pay), the stock sweeper and every admin
// route take the same lock, and a relay that stalls for longer than the
// database's lock wait (50 s) made the callback fail with error 1205: a shopper
// who had paid saw the review page, the order stayed 'pending' with the money
// captured, and two hours later the sweeper gave its stock away. So a row goes
// in three steps (sporta_send_row): decide under the lock and mark it IN FLIGHT
// (sent_at set, last_error 'sending'), commit; mail with no lock held; take the
// lock again and record the result. While in flight the row reads as sent to
// everything that asks, which is what it will be a moment later, so a cancel
// made now is followed by its do-not-ship, and a reinstate made now answers a
// cancel the warehouse is about to read. If the mail then FAILS, the order is
// looked at again before the row goes back to being unsent. A run that dies
// mid-send leaves the in-flight mark behind; the next run (the advisory lock
// below means no other is running) turns those rows back into unsent ones.
//
// The rules themselves are in store_outbox_closed_reason() (store.php), one
// place for both passes. A row closed that way is marked sent with last_error
// saying why it never went: 'order cancelled', 'order shipped'. In short: a
// cancelled order's picking list and reinstate are never mailed; its payment
// and cancel are mailed only if the warehouse already holds a picking list for
// it; and an order that has shipped or been delivered gets no dispatch message
// (picking list, payment, or REINSTATED list).
//
// LOCK ORDER. Every change to what the warehouse is told takes the order's row
// lock first (the admin route, the sweeper, the callbacks, and the checkout
// that writes the picking list), and this drain does the same, so no two
// writers can wait on each other in opposite orders. The claim below moves
// only the attempts counter and decides nothing, so it takes no order lock.
//
// Under the advisory lock above, so a second cron cannot claim these first.

// A previous run that died between "in flight" and "recorded": nothing else can
// be sending (we hold the advisory lock), so these were never confirmed. Back to
// unsent; the attempt that was spent on them stays spent.
$db->prepare('update fulfilment_outbox set sent_at = null, last_error = ? where last_error = ? and sent_at is not null')
   ->execute(['interrupted', STORE_OUTBOX_SENDING]);

// How many attempts a row has left. The first five happen on consecutive runs;
// after that only inside the retry window at the top of each hour, until 24.
const SPORTA_FAST_ATTEMPTS = 5;
const SPORTA_SLOW_ATTEMPTS = 24;
$window = max(0, min(60, (int)($cfg['warehouse_retry_window_minutes'] ?? 10)));
$slowOpen = $window > 0 && (int)$db->query('select minute(now())')->fetchColumn() < $window;
$eligible = $slowOpen ? 'attempts < ' . SPORTA_SLOW_ATTEMPTS : 'attempts < ' . SPORTA_FAST_ATTEMPTS;

// Pass 1: every order that has an unsent row which may now be closed.
$candidates = $db->query(
    "select distinct f.order_id from fulfilment_outbox f
       join orders o on o.id = f.order_id
      where f.sent_at is null and f.{$eligible}
        and o.fulfilment_status in ('cancelled', 'shipped', 'delivered')
      order by f.order_id limit 500"
)->fetchAll(PDO::FETCH_COLUMN);
$suppressed = 0;
foreach ($candidates as $orderId) {
    $suppressed += sporta_close_unsent($db, (int)$orderId, $eligible);
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
    "select id, order_id, kind, payload, attempts from fulfilment_outbox
      where sent_at is null and {$eligible}
      order by created_at, id limit 20
        for update skip locked"
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn($r) => (int)$r['id'], $rows));
    $db->exec("update fulfilment_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

// Pass 2: each claimed row is decided under its order's lock and, if it may go,
// mailed with no lock held (sporta_send_row). A row the shop overtook is closed,
// not mailed.
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
function sporta_close_unsent(PDO $db, int $orderId, string $eligible): int {
    $db->beginTransaction();
    try {
        $status = sporta_lock_order($db, $orderId);
        $closed = 0;
        if ($status !== null) {
            $q = $db->prepare('select id, kind from fulfilment_outbox
                                where order_id = ? and sent_at is null and ' . $eligible . ' for update');
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

// Pass 2 for one claimed row, in three steps (see the header for why the order
// lock is not held through the mail):
//   1. under the order's lock: skip a row that is already settled, close one
//      the shop has overtaken, or mark the row IN FLIGHT and commit;
//   2. render and mail, holding no lock;
//   3. under the lock again: record the result. A failed send puts the row back
//      to unsent, unless the order changed meanwhile in a way that makes the
//      message moot, in which case it is closed instead.
//
// Returns 'sent', 'failed' (mail refused; the row stays unsent and is retried),
// 'closed' (the shop overtook it; nothing mailed, or nothing left to mail) or
// 'skipped' (the order is gone, or the row was already settled).
//
// The fifth failed attempt, and the last (24th), are reported to the owner on
// the Activity page with the kind and the order number in the key
// (warehouse_mail_failed_<kind>_<track>, warehouse_mail_gave_up_<kind>_<track>),
// so the owner can see WHICH order the warehouse never heard about.
function sporta_send_row(PDO $db, array $cfg, array $row, int $attempts): string {
    $orderId = (int)$row['order_id'];
    $id = (int)$row['id'];
    $kind = (string)$row['kind'];
    $p = json_decode((string)$row['payload'], true) ?: [];

    // 1.
    $db->beginTransaction();
    try {
        $status = sporta_lock_order($db, $orderId);
        $cur = $db->prepare('select sent_at from fulfilment_outbox where id = ? for update');
        $cur->execute([$id]);
        $state = $cur->fetch(PDO::FETCH_ASSOC);
        if ($status === null || !$state || $state['sent_at'] !== null) {
            $db->commit();
            return 'skipped';
        }
        $why = store_outbox_closed_reason($kind, $status, store_outbox_heard($db, $orderId));
        if ($why !== null) {
            $db->prepare('update fulfilment_outbox set sent_at = now(), last_error = ? where id = ?')
               ->execute([$why, $id]);
            $db->commit();
            return 'closed';
        }
        $db->prepare('update fulfilment_outbox set sent_at = now(), last_error = ? where id = ?')
           ->execute([STORE_OUTBOX_SENDING, $id]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }

    // 2. No transaction, no lock: a stalled relay holds up nothing but this run.
    try {
        [$subject, $text, $html] = sporta_render_warehouse($kind, $p);
        $ok = sporta_send_mail($cfg, $subject, $text, $html);
    } catch (Throwable $e) {
        $ok = false;
    }

    // 3.
    $db->beginTransaction();
    try {
        $status = sporta_lock_order($db, $orderId);
        if ($ok) {
            $db->prepare('update fulfilment_outbox set last_error = null where id = ? and last_error = ?')
               ->execute([$id, STORE_OUTBOX_SENDING]);
            $db->commit();
            return 'sent';
        }
        // Unsent again FIRST, so the in-flight row is not counted as the warehouse
        // having heard something when the order is looked at below.
        $db->prepare('update fulfilment_outbox set sent_at = null, last_error = ? where id = ?')
           ->execute(['mail() returned false', $id]);
        $why = $status === null ? null
             : store_outbox_closed_reason($kind, $status, store_outbox_heard($db, $orderId));
        if ($why !== null) {
            $db->prepare('update fulfilment_outbox set sent_at = now(), last_error = ? where id = ?')
               ->execute([$why, $id]);
            $db->commit();
            return 'closed';
        }
        if ($attempts === SPORTA_FAST_ATTEMPTS) {
            sporta_alert($db, 'warehouse_mail_failed', $kind, $p);
        } elseif ($attempts >= SPORTA_SLOW_ATTEMPTS) {
            sporta_alert($db, 'warehouse_mail_gave_up', $kind, $p);
        }
        $db->commit();
        return 'failed';
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// An Activity-page row for a message that is not getting through. The log has
// one text column, so the kind and the order number go in the key itself:
// warehouse_mail_failed_new_sp4kq7x9m. Lower case and [a-z0-9_] only, as
// store_system_event() requires; the order number is the shopper-facing track
// id, which is no more private than the order number on the warehouse's own mail.
function sporta_alert(PDO $db, string $what, string $kind, array $payload): void {
    $track = strtolower((string)preg_replace('/[^A-Za-z0-9]/', '', (string)($payload['track_id'] ?? '')));
    $kind = strtolower((string)preg_replace('/[^A-Za-z0-9]/', '', $kind));
    store_system_event($db, substr($what . '_' . $kind . ($track !== '' ? '_' . $track : ''), 0, 80));
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
