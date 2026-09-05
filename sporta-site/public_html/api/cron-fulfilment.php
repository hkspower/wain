<?php
// Drains fulfilment_outbox and emails the logistics company. The native twin
// of the notify-warehouse Edge Function.
//
// Wire it in hPanel -> Advanced -> Cron Jobs, every 5 minutes:
//   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=<cron_key>"
//
// Safe to call at any moment from any of the schedule's overlapping runs: the
// claim marks attempts inside a transaction with FOR UPDATE SKIP LOCKED, so
// two runs racing cannot double-send, and a message that fails five times
// stops retrying and sits visibly in the table with its error.
//
// The email follows the same rules as render.mjs, because the reader is the
// same picker on the same warehouse floor: the SUBJECT carries the whole
// answer (order number, ship-or-hold, item count, area); COLLECT CASH is the
// loudest thing on the page with the amount beside it; sizes sit in their own
// column; Arabic and English together; plain text alongside HTML.

declare(strict_types=1);
require __DIR__ . '/store.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], (string)($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}
if (($cfg['warehouse_email'] ?? '') === '') {
    // Fail loudly BEFORE claiming — claiming rows we cannot send burns their
    // retry budget while the real problem is one missing setting.
    // 503, NOT 500, and the difference is who gets woken up.
    //
    // 500 means this server broke. 503 means the service is not available — which
    // is what "the owner has not filled this in yet" actually is, and it is what
    // cron-voice.php already answered for exactly the same condition two files
    // away. A shop that has not finished its setup is not a shop that is
    // broken, but wget in an hPanel cron box — and any monitor watching for
    // 5xx — cannot tell those apart from a 500.
    store_out(['error' => 'warehouse_email is not set in config.php — nothing would be delivered'], 503);
}

$db = store_db();

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
    // The shared sender in store.php — one copy of the MIME and the
    // =?UTF-8?B?…?= subject encoding, used by the customer's receipt too.
    $ok = store_send_mail($cfg, $cfg['warehouse_email'], $subject, $text, $html);
    $db->prepare('update fulfilment_outbox set sent_at = ?, last_error = ? where id = ?')
       ->execute([$ok ? date('Y-m-d H:i:s') : null, $ok ? null : 'mail() returned false', (int)$row['id']]);
    $ok ? $sent++ : $failed[] = (int)$row['id'];
}

store_out(['claimed' => count($rows), 'sent' => $sent, 'failed' => $failed]);

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
