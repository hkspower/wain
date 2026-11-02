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

// ---- an order that is not happening is not mailed ----
//
// A cancelled order's UNSENT messages are closed without sending: marked sent,
// with last_error 'order cancelled' so the row says why it never went. The
// orders that matter here are the ones nobody meant — a bot's fake cash
// orders, or cash orders cancelled because nobody confirmed them (see
// store_stock_release) — which would otherwise queue up picking lists and go
// out in one burst the day mail starts working.
//
// ONLY WHILE THE WAREHOUSE HAS HEARD NOTHING ABOUT THE ORDER. Once anything
// for it has really been sent (a picking list, typically), a follow-up is the
// one message that must not be dropped: it is the "do not ship". So an order
// with any delivered message keeps every remaining one.
//
// Under the advisory lock above, so a second cron cannot claim these first.
$db->beginTransaction();
$suppress = $db->query(
    "select f.id from fulfilment_outbox f
       join orders o on o.id = f.order_id
      where f.sent_at is null and f.attempts < 5
        and o.fulfilment_status = 'cancelled'
        and not exists (select 1 from fulfilment_outbox s
                         where s.order_id = f.order_id and s.sent_at is not null
                           and coalesce(s.last_error, '') <> 'order cancelled')
      order by f.id limit 500"
)->fetchAll(PDO::FETCH_COLUMN);
if ($suppress) {
    $ids = implode(',', array_map('intval', $suppress));
    $db->exec("update fulfilment_outbox set sent_at = now(), last_error = 'order cancelled'
                where id in ($ids) and sent_at is null");
}
$db->commit();

// ---- claim ----
$db->beginTransaction();
$rows = $db->query(
    'select id, kind, payload from fulfilment_outbox
      where sent_at is null and attempts < 5
      order by created_at limit 20
        for update skip locked'
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn($r) => (int)$r['id'], $rows));
    $db->exec("update fulfilment_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

// ---- render + send ----
$sent = 0; $failed = [];
foreach ($rows as $row) {
    $p = json_decode($row['payload'], true) ?: [];
    [$subject, $text, $html] = sporta_render_warehouse($row['kind'], $p);
    $ok = sporta_send_mail($cfg, $subject, $text, $html);
    $db->prepare('update fulfilment_outbox set sent_at = ?, last_error = ? where id = ?')
       ->execute([$ok ? date('Y-m-d H:i:s') : null, $ok ? null : 'mail() returned false', (int)$row['id']]);
    $ok ? $sent++ : $failed[] = (int)$row['id'];
}

$unlock = $db->prepare('select release_lock(?)');
$unlock->execute([$lockName]);

store_out(['claimed' => count($rows), 'sent' => $sent, 'failed' => $failed,
           'suppressed' => count($suppress)]);

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

    $state = $cash ? 'COLLECT CASH' : ($paid ? 'PAID' : 'AWAITING PAYMENT — hold');
    $subject = "[SPORTA] {$track} · {$state} · {$count} item(s)" . ($area ? " · {$area}" : '');
    $banner = $cash ? "COLLECT {$amount} IN CASH ON DELIVERY"
            : ($paid ? 'PAID — ready to ship' : 'AWAITING PAYMENT — do not ship yet');

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
